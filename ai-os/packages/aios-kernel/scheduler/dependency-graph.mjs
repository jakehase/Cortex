export const surfaceId = "aios_scheduler_dependency-graph_058";
export const surfaceGroup = "scheduler";
export const surfaceName = "dependency-graph";

const stateVersion = 1;
const terminalStatuses = new Set(['succeeded', 'failed', 'skipped']);
const activeStatuses = new Set(['pending', 'ready', 'running', 'blocked']);
const mutatingRoles = new Set(['owner', 'scheduler-admin', 'scheduler-operator']);
const readOnlyRoles = new Set(['viewer', 'auditor', 'scheduler-viewer']);
const handoffExportRoles = new Set(['owner', 'scheduler-admin', 'scheduler-operator', 'scheduler-handoff-exporter']);
const graphWritePermission = 'scheduler:dependency-graph:write';
const graphReadPermission = 'scheduler:dependency-graph:read';
const graphHandoffExportPermission = 'scheduler:dependency-graph:handoff:export';
const defaultMaxAttempts = 3;
const defaultRetryBackoffMs = 30_000;
const maxRetryBackoffMs = 15 * 60_000;
const defaultExecutionLeaseTtlMs = 10 * 60_000;
const maxExecutionLeaseTtlMs = 24 * 60 * 60_000;
const maxAnalyticsHistoryEntries = 24;
const analyticsCounterFields = [
  'nodeCount',
  'edgeCount',
  'openNodeCount',
  'terminalCount',
  'readyCount',
  'blockedCount',
  'runningCount',
  'pendingCount',
  'succeededCount',
  'failedCount',
  'skippedCount',
  'degradedFailureCount',
  'retryableFailureCount',
  'maxAttemptsConsumed',
  'totalAttempts',
  'recoveredNodeCount',
  'issueCount',
  'completionPercent',
  'dispatchableCount',
  'claimableHandoffCount',
  'rejectedHandoffCount',
  'providerCount',
  'usableProviderCount',
  'staleProviderCount',
  'boundaryHiddenDependencyCount',
  'boundaryRejectedEdgeCount',
  'pendingHandoffAcknowledgementCount',
  'failedHandoffAcknowledgementCount',
  'unknownHandoffAcknowledgementCount',
  'dispatchGateBlockedCount',
  'graphCriticalBlockerCount',
  'graphStructuralErrorCount',
  'lifecyclePausedCount',
  'handoffExportBlockedCount'
];
const maxConcurrentRunsLimit = 100;
const lifecycleDisableReasons = new Set(['dependency-remediation', 'external-provider-hold', 'maintenance-window', 'manual-skip', 'operator-hold']);
const schedulingControlCommands = new Set(['configure-settings', 'pause-scheduling', 'resume-scheduling']);
const nodeLifecycleCommands = new Set(['disable-node', 'enable-node', 'skip-node']);
const handoffReceiptStatuses = new Set(['sent', 'delivered', 'accepted', 'rejected', 'failed']);
const providerContractCapabilities = new Set([
  'dependency-graph:read',
  'dependency-graph:claim-ready',
  'dependency-graph:report-running',
  'dependency-graph:report-success',
  'dependency-graph:report-failure',
  'dependency-graph:sync-state',
  'dependency-graph:audit-handoff'
]);
const requiredProviderCapabilities = [
  'dependency-graph:claim-ready',
  'dependency-graph:report-running',
  'dependency-graph:report-success',
  'dependency-graph:report-failure'
];
const providerDeliveryModes = new Set(['inline', 'webhook', 'queue', 'poll']);
const durableDeliveryModes = new Set(['webhook', 'queue']);
const defaultProviderBatchSize = 10;

function asIsoTimestamp(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date().toISOString();
}

function cloneRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function listFrom(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}

function numberFrom(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0);
}

function uniqueStringList(...values) {
  return [...new Set(values.flatMap((value) => {
    if (Array.isArray(value)) return listFrom(value);
    return typeof value === 'string' && value.length > 0 ? [value] : [];
  }))];
}

function boundedPositiveInteger(value, fallback, upperBound) {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, upperBound);
}

function stableCommandValue(value) {
  if (Array.isArray(value)) return value.map(stableCommandValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !['commandId', 'idempotencyKey', 'requestId', 'traceId', 'observedAt', 'submittedAt'].includes(key))
      .sort()
      .map((key) => [key, stableCommandValue(value[key])])
  );
}

function commandIdempotencyFingerprint(command) {
  if (!command || typeof command !== 'object') return null;
  const fingerprint = stableCommandValue(command);
  return JSON.stringify(fingerprint);
}

function normalizeAppliedCommandEntry(entry, boundary) {
  if (typeof entry?.id !== 'string' || entry.id.length === 0) return null;
  if (!recordMatchesBoundary(entry, boundary)) return null;
  return {
    id: entry.id,
    type: typeof entry.type === 'string' ? entry.type : 'unknown',
    at: asIsoTimestamp(entry.at),
    actorId: typeof entry.actorId === 'string' ? entry.actorId : null,
    tenantId: typeof entry.tenantId === 'string' ? entry.tenantId : boundary.tenantId || null,
    workspaceId: typeof entry.workspaceId === 'string' ? entry.workspaceId : boundary.workspaceId || null,
    commandFingerprint: typeof entry.commandFingerprint === 'string' ? entry.commandFingerprint : null,
    status: ['applied', 'idempotent'].includes(entry.status) ? entry.status : 'applied'
  };
}

function nullableIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function addMilliseconds(isoTimestamp, milliseconds) {
  const base = Date.parse(isoTimestamp);
  return new Date((Number.isFinite(base) ? base : Date.now()) + milliseconds).toISOString();
}

function retryBackoffForAttempt(attempts, retryAfterMs) {
  if (Number.isInteger(retryAfterMs) && retryAfterMs > 0) return Math.min(retryAfterMs, maxRetryBackoffMs);
  const exponent = Math.max(0, Math.min(attempts - 1, 5));
  return Math.min(defaultRetryBackoffMs * 2 ** exponent, maxRetryBackoffMs);
}

function retryWindowOpen(node, now) {
  if (node.status !== 'failed') return false;
  if (node.attempts >= node.maxAttempts) return false;
  if (typeof node.retryAfter !== 'string') return true;
  const retryAfter = Date.parse(node.retryAfter);
  const observed = Date.parse(now);
  return !Number.isFinite(retryAfter) || !Number.isFinite(observed) || retryAfter <= observed;
}

function normalizeExecutionLease(rawLease, node, now, boundary) {
  const lease = cloneRecord(rawLease || node.executionLease || node.lease);
  const leaseId = firstString(lease.leaseId, lease.id, lease.claimId);
  if (!leaseId) return null;
  if (!recordMatchesBoundary(lease, boundary)) return null;
  const acquiredAt = asIsoTimestamp(lease.acquiredAt || lease.claimedAt || node.updatedAt || now);
  const ttlMs = boundedPositiveInteger(lease.ttlMs, defaultExecutionLeaseTtlMs, maxExecutionLeaseTtlMs);
  return stampBoundary({
    leaseId,
    providerId: firstString(lease.providerId, lease.ownerProviderId, lease.provider) || null,
    holderId: firstString(lease.holderId, lease.workerId, lease.actorId, lease.ownerId) || null,
    acquiredAt,
    heartbeatAt: nullableIsoTimestamp(lease.heartbeatAt) || acquiredAt,
    expiresAt: nullableIsoTimestamp(lease.expiresAt) || addMilliseconds(acquiredAt, ttlMs),
    ttlMs,
    bootId: firstString(lease.bootId, node.bootId) || null,
    epoch: Number.isInteger(lease.epoch) && lease.epoch >= 0 ? lease.epoch : 0
  }, boundary);
}

function buildExecutionLease(command, state, boundary, now) {
  const ttlMs = boundedPositiveInteger(command.leaseTtlMs, defaultExecutionLeaseTtlMs, maxExecutionLeaseTtlMs);
  const leaseId = firstString(
    command.leaseId,
    command.claimId,
    command.commandId && `${command.commandId}:lease`,
    `${command.nodeId}:${state.epoch}:${now}`
  );
  return stampBoundary({
    leaseId,
    providerId: firstString(command.providerId, command.ownerProviderId) || null,
    holderId: firstString(command.holderId, command.workerId, boundary.actorId) || null,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: addMilliseconds(now, ttlMs),
    ttlMs,
    bootId: state.bootId || null,
    epoch: state.epoch
  }, boundary);
}

function leaseExpired(lease, now) {
  if (!lease || typeof lease.expiresAt !== 'string') return false;
  const expiresAt = Date.parse(lease.expiresAt);
  const observed = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(observed) && expiresAt <= observed;
}

function normalizeProviderCapabilityList(value) {
  return [...new Set(listFrom(value))]
    .filter((capability) => providerContractCapabilities.has(capability))
    .sort();
}

function normalizeNodeProviderRequirements(rawNode) {
  const contract = cloneRecord(rawNode.providerRequirements || rawNode.providerContract || rawNode.provider);
  const requestedCapabilities = uniqueStringList(
    contract.requiredCapabilities,
    contract.capabilities,
    rawNode.requiredProviderCapabilities,
    rawNode.providerCapabilities
  );
  const requiredCapabilities = requestedCapabilities
    .filter((capability) => providerContractCapabilities.has(capability))
    .sort();
  const unsupportedCapabilities = requestedCapabilities
    .filter((capability) => !providerContractCapabilities.has(capability))
    .sort();
  const providerId = firstString(
    contract.providerId,
    contract.id,
    rawNode.providerId,
    rawNode.ownerProviderId
  ) || null;
  const handoffRequired = contract.handoffRequired === true
    || rawNode.handoffRequired === true
    || rawNode.externalHandoffRequired === true
    || providerId !== null
    || requiredCapabilities.length > 0
    || unsupportedCapabilities.length > 0;

  return {
    schema: 'scheduler.dependencyGraph.nodeProviderRequirements.v1',
    handoffRequired,
    providerId,
    requiredCapabilities,
    unsupportedCapabilities,
    serviceRef: firstString(contract.serviceRef, rawNode.serviceRef) || null,
    syncCursor: firstString(contract.syncCursor, contract.cursor, rawNode.providerSyncCursor) || null
  };
}

function normalizeProviderHandoffPolicy(rawContract) {
  const contract = cloneRecord(rawContract);
  const handoff = cloneRecord(contract.handoff || contract.delivery || contract.handoffPolicy);
  const deliveryMode = providerDeliveryModes.has(handoff.deliveryMode)
    ? handoff.deliveryMode
    : providerDeliveryModes.has(contract.deliveryMode)
      ? contract.deliveryMode
      : firstString(contract.handoffRef, contract.callbackRef, contract.webhookRef)
        ? 'webhook'
        : 'inline';
  const acknowledgementRequired = handoff.acknowledgementRequired !== false;
  const maxBatchSize = boundedPositiveInteger(
    handoff.maxBatchSize || contract.maxBatchSize,
    defaultProviderBatchSize,
    maxConcurrentRunsLimit
  );
  const receiptTtlMs = boundedPositiveInteger(
    handoff.receiptTtlMs || contract.receiptTtlMs,
    defaultExecutionLeaseTtlMs,
    maxExecutionLeaseTtlMs
  );
  const replayWindowMs = boundedPositiveInteger(
    handoff.replayWindowMs || contract.replayWindowMs,
    60 * 60_000,
    7 * 24 * 60 * 60_000
  );

  return {
    schema: 'scheduler.dependencyGraph.providerHandoffPolicy.v1',
    deliveryMode,
    acknowledgementRequired,
    maxBatchSize,
    receiptTtlMs,
    replayWindowMs,
    requiresHandoffRef: durableDeliveryModes.has(deliveryMode),
    receiptStatuses: [...handoffReceiptStatuses].sort(),
    idempotency: {
      required: true,
      keyField: 'claimCommand.commandId',
      replayWindowMs
    }
  };
}

function normalizeProviderContract(rawContract, now, boundary) {
  const contract = cloneRecord(rawContract);
  const providerId = firstString(contract.providerId, contract.id, contract.name);
  if (!providerId || !recordMatchesBoundary(contract, boundary)) return null;
  const declaredCapabilities = normalizeProviderCapabilityList(contract.capabilities);
  const serviceLevel = cloneRecord(contract.serviceLevel || contract.slo);
  const sync = cloneRecord(contract.sync || contract.syncMetadata);
  const handoffPolicy = normalizeProviderHandoffPolicy(contract);
  const staleAfterMs = boundedPositiveInteger(sync.staleAfterMs, 5 * 60_000, 24 * 60 * 60_000);
  const lastSyncedAt = nullableIsoTimestamp(sync.lastSyncedAt);
  const observedAt = asIsoTimestamp(sync.observedAt || contract.observedAt || now);
  const handoffRef = firstString(contract.handoffRef, contract.callbackRef, contract.webhookRef) || null;

  return stampBoundary({
    providerId,
    serviceRef: firstString(contract.serviceRef, contract.service, contract.endpointRef) || null,
    contractVersion: firstString(contract.contractVersion, contract.version) || 'scheduler-provider.v1',
    mode: ['push', 'pull', 'hybrid'].includes(contract.mode) ? contract.mode : 'hybrid',
    capabilities: declaredCapabilities,
    missingRequiredCapabilities: requiredProviderCapabilities.filter((capability) => !declaredCapabilities.includes(capability)),
    serviceLevel: {
      tier: firstString(serviceLevel.tier, contract.tier) || 'standard',
      maxInFlight: boundedPositiveInteger(serviceLevel.maxInFlight, 1, maxConcurrentRunsLimit),
      heartbeatMs: boundedPositiveInteger(serviceLevel.heartbeatMs, 60_000, 60 * 60_000)
    },
    sync: {
      cursor: firstString(sync.cursor, sync.watermark) || null,
      lastSyncedAt,
      observedAt,
      staleAfterMs,
      stale: !lastSyncedAt || Date.parse(lastSyncedAt) + staleAfterMs < Date.parse(observedAt),
      conflictPolicy: ['provider-wins', 'kernel-wins', 'manual-review'].includes(sync.conflictPolicy)
        ? sync.conflictPolicy
        : 'kernel-wins'
    },
    handoffPolicy,
    handoffRef,
    auditRef: firstString(contract.auditRef, contract.auditSinkRef) || null,
    enabled: contract.enabled !== false,
    updatedAt: asIsoTimestamp(contract.updatedAt || now)
  }, boundary);
}

function normalizeProviderContracts(input, persisted, now, boundary) {
  const contractEntries = [
    ...(Array.isArray(persisted.providerContracts) ? persisted.providerContracts : []),
    ...(Array.isArray(input.providerContracts) ? input.providerContracts : []),
    ...(input.providerContract ? [input.providerContract] : []),
    ...(input.integrationProvider ? [input.integrationProvider] : [])
  ];
  const contracts = {};
  for (const rawContract of contractEntries) {
    const contract = normalizeProviderContract(rawContract, now, boundary);
    if (contract) contracts[contract.providerId] = { ...contracts[contract.providerId], ...contract };
  }
  return Object.values(contracts).sort((a, b) => a.providerId.localeCompare(b.providerId));
}

function normalizeRecoveryLogEntry(entry, boundary) {
  if (!entry || typeof entry !== 'object') return null;
  if (!recordMatchesBoundary(entry, boundary)) return null;
  const recovered = Array.isArray(entry.recovered)
    ? entry.recovered
      .map((item) => {
        if (typeof item === 'string') return { nodeId: item, recoveredStatus: null };
        if (!item || typeof item !== 'object') return null;
        const nodeId = firstString(item.nodeId, item.id);
        return nodeId
          ? {
            nodeId,
            leaseId: firstString(item.leaseId) || null,
            providerId: firstString(item.providerId) || null,
            holderId: firstString(item.holderId) || null,
            previousStatus: firstString(item.previousStatus) || null,
            recoveredStatus: firstString(item.recoveredStatus, item.status) || null,
            expiredAt: nullableIsoTimestamp(item.expiredAt)
          }
          : null;
      })
      .filter(Boolean)
    : [];
  return stampBoundary({
    at: asIsoTimestamp(entry.at),
    bootId: firstString(entry.bootId) || null,
    previousBootId: firstString(entry.previousBootId) || null,
    epoch: Number.isInteger(entry.epoch) && entry.epoch >= 0 ? entry.epoch : null,
    reason: firstString(entry.reason) || 'restart-recovery',
    recovered,
    recoveredCount: recovered.length
  }, boundary);
}

function normalizeAnalyticsHistoryEntry(entry, boundary) {
  if (!entry || typeof entry !== 'object') return null;
  if (!recordMatchesBoundary(entry, boundary)) return null;
  const rawCounters = cloneRecord(entry.counters);
  const counters = Object.fromEntries(
    analyticsCounterFields.map((field) => [field, numberFrom(rawCounters[field], 0)])
  );
  const queues = cloneRecord(entry.queues);

  return stampBoundary({
    at: asIsoTimestamp(entry.at),
    epoch: Number.isInteger(entry.epoch) && entry.epoch >= 0 ? entry.epoch : 0,
    bootId: firstString(entry.bootId) || null,
    command: {
      applied: entry.command?.applied === true,
      idempotent: entry.command?.idempotent === true,
      rejected: entry.command?.rejected === true,
      type: firstString(entry.command?.type) || null
    },
    counters,
    queues: {
      ready: listFrom(queues.ready).slice(0, 25),
      blocked: listFrom(queues.blocked).slice(0, 25),
      retryableFailures: listFrom(queues.retryableFailures).slice(0, 25),
      dispatchable: listFrom(queues.dispatchable).slice(0, 25),
      claimableHandoffs: listFrom(queues.claimableHandoffs).slice(0, 25)
    },
    healthMode: firstString(entry.healthMode) || 'unknown',
    nextAction: firstString(entry.nextAction) || null
  }, boundary);
}

function normalizeLifecycleSettings(input, persisted) {
  const source = cloneRecord(input.settings || input.schedulerSettings || persisted.settings);
  const validation = [];
  const maxConcurrentRuns = boundedPositiveInteger(source.maxConcurrentRuns, 4, maxConcurrentRunsLimit);
  const defaultNodeMaxAttempts = boundedPositiveInteger(source.defaultNodeMaxAttempts, defaultMaxAttempts, 20);
  const retryBackoffMs = boundedPositiveInteger(source.retryBackoffMs, defaultRetryBackoffMs, maxRetryBackoffMs);
  const schedulingEnabled = source.schedulingEnabled !== false;
  const autoPromoteReady = source.autoPromoteReady !== false;
  const requireResultRefOnSuccess = source.requireResultRefOnSuccess === true;

  if ('maxConcurrentRuns' in source && source.maxConcurrentRuns !== maxConcurrentRuns) {
    validation.push({
      field: 'settings.maxConcurrentRuns',
      severity: 'warning',
      message: `maxConcurrentRuns must be a positive integer no greater than ${maxConcurrentRunsLimit}`,
      appliedValue: maxConcurrentRuns
    });
  }
  if ('defaultNodeMaxAttempts' in source && source.defaultNodeMaxAttempts !== defaultNodeMaxAttempts) {
    validation.push({
      field: 'settings.defaultNodeMaxAttempts',
      severity: 'warning',
      message: 'defaultNodeMaxAttempts must be a positive integer no greater than 20',
      appliedValue: defaultNodeMaxAttempts
    });
  }
  if ('retryBackoffMs' in source && source.retryBackoffMs !== retryBackoffMs) {
    validation.push({
      field: 'settings.retryBackoffMs',
      severity: 'warning',
      message: `retryBackoffMs must be a positive integer no greater than ${maxRetryBackoffMs}`,
      appliedValue: retryBackoffMs
    });
  }
  if ('schedulingEnabled' in source && typeof source.schedulingEnabled !== 'boolean') {
    validation.push({
      field: 'settings.schedulingEnabled',
      severity: 'warning',
      message: 'schedulingEnabled must be boolean; invalid values default to enabled',
      appliedValue: schedulingEnabled
    });
  }
  if ('autoPromoteReady' in source && typeof source.autoPromoteReady !== 'boolean') {
    validation.push({
      field: 'settings.autoPromoteReady',
      severity: 'warning',
      message: 'autoPromoteReady must be boolean; invalid values default to enabled',
      appliedValue: autoPromoteReady
    });
  }
  if ('requireResultRefOnSuccess' in source && typeof source.requireResultRefOnSuccess !== 'boolean') {
    validation.push({
      field: 'settings.requireResultRefOnSuccess',
      severity: 'warning',
      message: 'requireResultRefOnSuccess must be boolean; invalid values default to false',
      appliedValue: requireResultRefOnSuccess
    });
  }

  return {
    schedulingEnabled,
    maxConcurrentRuns,
    defaultNodeMaxAttempts,
    retryBackoffMs,
    autoPromoteReady,
    requireResultRefOnSuccess,
    pausedReason: schedulingEnabled ? null : firstString(source.pausedReason, input.pausedReason) || 'scheduling paused by lifecycle settings',
    updatedAt: asIsoTimestamp(source.updatedAt || input.now),
    validation
  };
}

function normalizeBoundaryContext(input) {
  const persisted = cloneRecord(input.persistedState || input.state);
  const security = cloneRecord(input.security || input.auth || input.context);
  const roles = [...new Set([...listFrom(input.roles), ...listFrom(security.roles)])];
  const permissions = [...new Set([...listFrom(input.permissions), ...listFrom(security.permissions)])];
  const tenantId = firstString(input.tenantId, security.tenantId, persisted.tenantId);
  const workspaceId = firstString(input.workspaceId, security.workspaceId, persisted.workspaceId);
  const actorId = firstString(input.actorId, input.userId, security.actorId, security.userId);
  const scoped = Boolean(tenantId || workspaceId);
  const canWrite = !scoped || permissions.includes(graphWritePermission) || roles.some((role) => mutatingRoles.has(role));
  const canRead = !scoped || canWrite || permissions.includes(graphReadPermission) || roles.some((role) => readOnlyRoles.has(role));
  const canExportHandoff = canRead && (
    !scoped
    || canWrite
    || permissions.includes(graphHandoffExportPermission)
    || roles.some((role) => handoffExportRoles.has(role))
  );

  return {
    tenantId,
    workspaceId,
    actorId,
    roles,
    permissions,
    scoped,
    canRead,
    canWrite,
    canExportHandoff,
    auditSinkRef: firstString(input.auditSinkRef, security.auditSinkRef),
    deniedReason: scoped && !canRead ? 'actor is not authorized to read scheduler dependency graph scope' : undefined,
    handoffDeniedReason: canRead && !canExportHandoff
      ? 'actor is not authorized to export scheduler dependency graph provider handoff claims'
      : undefined
  };
}

function stampBoundary(record, boundary) {
  const stamped = { ...record };
  if (boundary.tenantId && typeof stamped.tenantId !== 'string') stamped.tenantId = boundary.tenantId;
  if (boundary.workspaceId && typeof stamped.workspaceId !== 'string') stamped.workspaceId = boundary.workspaceId;
  return stamped;
}

function recordMatchesBoundary(record, boundary) {
  if (!boundary.scoped) return true;
  if (boundary.tenantId && typeof record.tenantId === 'string' && record.tenantId !== boundary.tenantId) return false;
  if (boundary.workspaceId && typeof record.workspaceId === 'string' && record.workspaceId !== boundary.workspaceId) return false;
  return true;
}

function commandMatchesBoundary(command, boundary) {
  if (!boundary.scoped) return true;
  if (boundary.tenantId && typeof command.tenantId === 'string' && command.tenantId !== boundary.tenantId) return false;
  if (boundary.workspaceId && typeof command.workspaceId === 'string' && command.workspaceId !== boundary.workspaceId) return false;
  return true;
}

function normalizeNode(rawNode, now, boundary = {}, settings = {}) {
  const node = typeof rawNode === 'string' ? { id: rawNode } : cloneRecord(rawNode);
  if (typeof node.id !== 'string' || node.id.length === 0) return null;
  if (!recordMatchesBoundary(node, boundary)) return null;
  const status = activeStatuses.has(node.status) || terminalStatuses.has(node.status) ? node.status : 'pending';
  const disabledUntil = nullableIsoTimestamp(node.disabledUntil);
  const normalized = stampBoundary({
    id: node.id,
    status,
    enabled: node.enabled !== false,
    dependsOn: [...new Set(listFrom(node.dependsOn))].filter((id) => id !== node.id),
    attempts: Number.isInteger(node.attempts) && node.attempts >= 0 ? node.attempts : 0,
    maxAttempts: boundedPositiveInteger(node.maxAttempts, settings.defaultNodeMaxAttempts || defaultMaxAttempts, 20),
    updatedAt: asIsoTimestamp(node.updatedAt || now),
    resultRef: typeof node.resultRef === 'string' ? node.resultRef : undefined,
    failure: typeof node.failure === 'string' ? node.failure : undefined,
    errorCode: typeof node.errorCode === 'string' ? node.errorCode : undefined,
    failureAction: typeof node.failureAction === 'string' ? node.failureAction : undefined,
    retryAfter: typeof node.retryAfter === 'string' ? node.retryAfter : undefined,
    disabledReason: typeof node.disabledReason === 'string' ? node.disabledReason : undefined,
    disabledUntil: disabledUntil || undefined,
    degraded: node.degraded === true,
    providerRequirements: normalizeNodeProviderRequirements(node),
    executionLease: undefined
  }, boundary);
  normalized.executionLease = status === 'running'
    ? normalizeExecutionLease(node.executionLease || node.lease, normalized, now, boundary) || {
      ...stampBoundary({
        leaseId: `${normalized.id}:imported:${now}`,
        providerId: null,
        holderId: null,
        acquiredAt: normalized.updatedAt,
        heartbeatAt: normalized.updatedAt,
        expiresAt: addMilliseconds(normalized.updatedAt, defaultExecutionLeaseTtlMs),
        ttlMs: defaultExecutionLeaseTtlMs,
        bootId: null,
        epoch: 0
      }, boundary)
    }
    : undefined;
  return normalized;
}

function collectBoundaryDependencyContext(nodeEntries, inputNodes, inputEdges, boundary) {
  const hiddenNodes = new Set();
  const rejectedEdges = [];
  const addHiddenNode = (rawNode) => {
    const node = typeof rawNode === 'string' ? { id: rawNode } : cloneRecord(rawNode);
    if (typeof node.id !== 'string' || node.id.length === 0) return;
    if (!recordMatchesBoundary(node, boundary)) hiddenNodes.add(node.id);
  };

  for (const rawNode of [...nodeEntries, ...inputNodes]) addHiddenNode(rawNode);
  for (const rawEdge of inputEdges) {
    const edge = cloneRecord(rawEdge);
    const from = typeof edge.from === 'string' ? edge.from : edge.dependency;
    const to = typeof edge.to === 'string' ? edge.to : edge.dependent;
    if (!from || !to || from === to) continue;
    if (recordMatchesBoundary(edge, boundary)) continue;
    rejectedEdges.push({
      from,
      to,
      tenantId: typeof edge.tenantId === 'string' ? edge.tenantId : null,
      workspaceId: typeof edge.workspaceId === 'string' ? edge.workspaceId : null,
      reason: 'edge record is outside the active scheduler dependency graph scope'
    });
  }

  return { hiddenNodes, rejectedEdges };
}

function buildDependencyBoundaryState(state, boundarySeed = {}) {
  const hiddenNodeIds = new Set(boundarySeed.hiddenNodeIds || []);
  const rejectedEdges = Array.isArray(boundarySeed.rejectedEdges) ? boundarySeed.rejectedEdges : [];
  const hiddenDependencies = Object.values(state.nodes)
    .flatMap((node) => node.dependsOn
      .filter((dependencyId) => !state.nodes[dependencyId] && hiddenNodeIds.has(dependencyId))
      .map((dependencyId) => ({
        nodeId: node.id,
        dependencyId,
        reason: 'dependency node exists outside the active tenant/workspace scope',
        action: 'evaluate the graph with a scope that includes both nodes or replace the cross-scope dependency with an approved handoff'
      })));
  const rejectedEdgeImpacts = rejectedEdges
    .filter((edge) => state.nodes[edge.to] || state.nodes[edge.from])
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      visibleEndpointIds: [edge.from, edge.to].filter((nodeId) => state.nodes[nodeId]),
      tenantId: edge.tenantId,
      workspaceId: edge.workspaceId,
      reason: edge.reason,
      action: 'resubmit the edge in the active scheduler scope or query the graph with matching tenant/workspace context'
    }));

  return {
    schema: 'scheduler.dependencyGraph.dependencyBoundary.v1',
    scoped: state.tenantId !== undefined || state.workspaceId !== undefined,
    tenantId: state.tenantId || null,
    workspaceId: state.workspaceId || null,
    hiddenDependencyCount: hiddenDependencies.length,
    rejectedEdgeCount: rejectedEdgeImpacts.length,
    hiddenNodeIds: [...hiddenNodeIds].sort().slice(0, 50),
    hiddenDependencies,
    rejectedEdges: rejectedEdgeImpacts,
    issueCodes: [
      ...(hiddenDependencies.length > 0 ? ['dependency-outside-scope'] : []),
      ...(rejectedEdgeImpacts.length > 0 ? ['dependency-edge-outside-scope'] : [])
    ],
    nextAction: hiddenDependencies[0]?.action || rejectedEdgeImpacts[0]?.action || null
  };
}

function normalizePersistedState(input, now, boundary) {
  const persisted = cloneRecord(input.persistedState || input.state);
  const settings = normalizeLifecycleSettings(input, persisted);
  const providerContracts = boundary.deniedReason ? [] : normalizeProviderContracts(input, persisted, now, boundary);
  const nodeEntries = Array.isArray(persisted.nodes) ? persisted.nodes : Object.values(cloneRecord(persisted.nodes));
  const inputNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const inputEdges = Array.isArray(input.edges) ? input.edges : [];
  const boundaryDependencies = collectBoundaryDependencyContext(nodeEntries, inputNodes, inputEdges, boundary);
  const commandEntries = Array.isArray(persisted.appliedCommands) ? persisted.appliedCommands : [];
  const nodes = {};

  if (boundary.deniedReason) {
    return {
      version: persisted.version === stateVersion ? persisted.version : stateVersion,
      bootId: undefined,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      settings,
      providerContracts: [],
      epoch: Number.isInteger(persisted.epoch) && persisted.epoch >= 0 ? persisted.epoch : 0,
      nodes,
      appliedCommands: [],
      recoveryLog: [],
      analyticsHistory: [],
      dependencyBoundary: buildDependencyBoundaryState({
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        nodes
      }, {
        hiddenNodeIds: [...boundaryDependencies.hiddenNodes],
        rejectedEdges: boundaryDependencies.rejectedEdges
      })
    };
  }

  for (const rawNode of nodeEntries) {
    const node = normalizeNode(rawNode, now, boundary, settings);
    if (node) nodes[node.id] = node;
  }

  for (const rawNode of inputNodes) {
    const node = normalizeNode(rawNode, now, boundary, settings);
    if (node && !nodes[node.id]) nodes[node.id] = node;
  }

  for (const edge of inputEdges) {
    if (!recordMatchesBoundary(edge || {}, boundary)) continue;
    const from = typeof edge?.from === 'string' ? edge.from : edge?.dependency;
    const to = typeof edge?.to === 'string' ? edge.to : edge?.dependent;
    if (!from || !to || from === to) continue;
    nodes[from] ||= normalizeNode(from, now, boundary, settings);
    nodes[to] ||= normalizeNode(to, now, boundary, settings);
    if (!nodes[from] || !nodes[to]) continue;
    nodes[to].dependsOn = [...new Set([...nodes[to].dependsOn, from])];
  }

  return {
    version: persisted.version === stateVersion ? persisted.version : stateVersion,
    bootId: typeof persisted.bootId === 'string' ? persisted.bootId : undefined,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    settings,
    providerContracts,
    epoch: Number.isInteger(persisted.epoch) && persisted.epoch >= 0 ? persisted.epoch : 0,
    nodes,
    appliedCommands: commandEntries
      .map((entry) => normalizeAppliedCommandEntry(entry, boundary))
      .filter(Boolean)
      .slice(-100),
    recoveryLog: Array.isArray(persisted.recoveryLog)
      ? persisted.recoveryLog
        .map((entry) => normalizeRecoveryLogEntry(entry, boundary))
        .filter(Boolean)
        .slice(-50)
      : [],
    analyticsHistory: Array.isArray(persisted.analyticsHistory)
      ? persisted.analyticsHistory
        .map((entry) => normalizeAnalyticsHistoryEntry(entry, boundary))
        .filter(Boolean)
        .slice(-maxAnalyticsHistoryEntries)
      : [],
    dependencyBoundary: buildDependencyBoundaryState({
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      nodes
    }, {
      hiddenNodeIds: [...boundaryDependencies.hiddenNodes],
      rejectedEdges: boundaryDependencies.rejectedEdges
    })
  };
}

function deriveRunnableStatus(state, nodeId) {
  const node = state.nodes[nodeId];
  if (!node || terminalStatuses.has(node.status) || node.status === 'running') return node?.status || 'missing';
  if (node.enabled === false) return 'blocked';
  const unmet = node.dependsOn.filter((dependencyId) => state.nodes[dependencyId]?.status !== 'succeeded');
  return unmet.length === 0 ? 'ready' : 'blocked';
}

function dependencyDepth(state, nodeId, seen = new Set()) {
  if (seen.has(nodeId)) return 0;
  const node = state.nodes[nodeId];
  if (!node || node.dependsOn.length === 0) return 0;
  const nextSeen = new Set([...seen, nodeId]);
  return 1 + Math.max(...node.dependsOn.map((dependencyId) => dependencyDepth(state, dependencyId, nextSeen)));
}

function dependencySuccessProof(state, node) {
  const dependencyStates = node.dependsOn
    .map((dependencyId) => {
      const dependency = state.nodes[dependencyId] || null;
      return {
        dependencyId,
        status: dependency?.status || 'missing',
        terminal: dependency ? terminalStatuses.has(dependency.status) : false,
        satisfied: dependency?.status === 'succeeded',
        resultRef: dependency?.resultRef || null,
        updatedAt: dependency?.updatedAt || null
      };
    })
    .sort((a, b) => a.dependencyId.localeCompare(b.dependencyId));

  return {
    schema: 'scheduler.dependencyGraph.readyProof.v1',
    dependencyCount: dependencyStates.length,
    satisfiedDependencyCount: dependencyStates.filter((dependency) => dependency.satisfied).length,
    unsatisfiedDependencyCount: dependencyStates.filter((dependency) => !dependency.satisfied).length,
    dependenciesSatisfied: dependencyStates.every((dependency) => dependency.satisfied),
    dependencies: dependencyStates
  };
}

function readyFrontierEntry(state, node, now) {
  const proof = dependencySuccessProof(state, node);
  const providerReadiness = providerReadinessForNode(state, node, now);
  return {
    nodeId: node.id,
    status: node.status,
    enabled: node.enabled,
    dependencyDepth: dependencyDepth(state, node.id),
    dependencyCount: node.dependsOn.length,
    updatedAt: node.updatedAt || now,
    claimable: node.enabled !== false && proof.dependenciesSatisfied && providerReadiness.claimable,
    providerReadiness,
    proof
  };
}

function providerContractNodeDecision(contract, requiredCapabilities, now) {
  const lastSyncedAt = nullableIsoTimestamp(contract.sync?.lastSyncedAt);
  const observedAt = asIsoTimestamp(contract.sync?.observedAt || now);
  const staleAfterMs = boundedPositiveInteger(contract.sync?.staleAfterMs, 5 * 60_000, 24 * 60 * 60_000);
  const stale = contract.sync?.stale === true
    || !lastSyncedAt
    || Date.parse(lastSyncedAt) + staleAfterMs < Date.parse(observedAt);
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !contract.capabilities.includes(capability));
  const handoffPolicy = contract.handoffPolicy || normalizeProviderHandoffPolicy(contract);
  const deliveryBlocked = handoffPolicy.requiresHandoffRef && !contract.handoffRef;
  const enabled = contract.enabled !== false;
  const usable = enabled && !stale && missingCapabilities.length === 0 && !deliveryBlocked;

  return {
    providerId: contract.providerId,
    usable,
    enabled,
    stale,
    missingCapabilities,
    deliveryBlocked,
    handoffRef: contract.handoffRef || null,
    sync: {
      cursor: contract.sync?.cursor || null,
      lastSyncedAt,
      observedAt,
      staleAfterMs,
      conflictPolicy: contract.sync?.conflictPolicy || 'kernel-wins'
    },
    reason: usable
      ? 'provider satisfies node provider requirements'
      : !enabled
        ? 'provider contract is disabled'
        : stale
          ? 'provider sync metadata is stale or missing'
          : missingCapabilities.length > 0
            ? `provider is missing ${missingCapabilities.join(', ')}`
            : deliveryBlocked
              ? `${handoffPolicy.deliveryMode} delivery requires handoffRef`
              : 'provider contract cannot service this node'
  };
}

function providerReadinessForNode(state, node, now) {
  const requirements = node.providerRequirements || normalizeNodeProviderRequirements(node);
  const requiredCapabilities = uniqueStringList(requiredProviderCapabilities, requirements.requiredCapabilities);
  const contracts = Array.isArray(state.providerContracts) ? state.providerContracts : [];
  const scopedContracts = requirements.providerId
    ? contracts.filter((contract) => contract.providerId === requirements.providerId)
    : contracts;
  const providerDecisions = scopedContracts
    .map((contract) => providerContractNodeDecision(contract, requiredCapabilities, now))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || a.providerId.localeCompare(b.providerId));
  const selectedProvider = providerDecisions.find((provider) => provider.usable) || null;
  const claimable = !requirements.handoffRequired || Boolean(selectedProvider);
  const blockers = [
    ...(requirements.unsupportedCapabilities.length > 0
      ? [{
        code: 'provider-capability-unsupported',
        severity: 'error',
        message: `${node.id} requires unsupported provider capability ${requirements.unsupportedCapabilities.join(', ')}`,
        action: 'remove unsupported node provider capabilities or register a supported scheduler provider contract',
        unsupportedCapabilities: requirements.unsupportedCapabilities
      }]
      : []),
    ...(requirements.handoffRequired && contracts.length === 0
      ? [{
        code: 'provider-contract-missing',
        severity: 'warning',
        message: `${node.id} requires external provider handoff but no provider contracts are registered`,
        action: 'register a scheduler provider contract with claim/report capabilities'
      }]
      : []),
    ...(requirements.handoffRequired && contracts.length > 0 && scopedContracts.length === 0
      ? [{
        code: 'provider-contract-not-found',
        severity: 'warning',
        message: `${node.id} requires provider ${requirements.providerId}`,
        action: `register or sync provider contract ${requirements.providerId}`,
        providerId: requirements.providerId
      }]
      : []),
    ...(requirements.handoffRequired && scopedContracts.length > 0 && !selectedProvider
      ? [{
        code: 'provider-contract-not-usable-for-node',
        severity: 'warning',
        message: `${node.id} has no synced provider contract that satisfies its node requirements`,
        action: providerDecisions[0]?.reason === 'provider sync metadata is stale or missing'
          ? 'refresh provider sync metadata before selecting the ready frontier'
          : 'update provider capabilities or handoffRef before exporting this node',
        providers: providerDecisions.slice(0, 5)
      }]
      : [])
  ];

  return {
    schema: 'scheduler.dependencyGraph.nodeProviderReadiness.v1',
    handoffRequired: requirements.handoffRequired,
    claimable,
    selectedProviderId: selectedProvider?.providerId || null,
    providerId: requirements.providerId,
    requiredCapabilities,
    unsupportedCapabilities: requirements.unsupportedCapabilities,
    serviceRef: requirements.serviceRef,
    syncCursor: requirements.syncCursor,
    providerCount: scopedContracts.length,
    usableProviderIds: providerDecisions.filter((provider) => provider.usable).map((provider) => provider.providerId),
    providers: providerDecisions.slice(0, 10),
    blockers,
    nextAction: blockers[0]?.action || (selectedProvider ? `handoff ${node.id} to ${selectedProvider.providerId}` : null)
  };
}

function structuralGraphIssues(state, cycle, boundaryIssues) {
  const missing = dependencyIssues(state).map((issue) => ({
    code: 'missing-dependency',
    severity: 'error',
    message: `${issue.nodeId} depends on missing node ${issue.dependencyId}`,
    ...issue
  }));
  const cycleIssue = cycle
    ? [{
      severity: 'error',
      code: 'dependency-cycle',
      cycle,
      message: `dependency cycle detected: ${cycle.join(' -> ')}`,
      action: 'remove or invert one edge in the cycle'
    }]
    : [];
  return [
    ...missing,
    ...boundaryIssues,
    ...cycleIssue
  ];
}

function groupBlockerEntries(blockerEntries) {
  const byCode = {};
  const bySeverity = {};
  const firstByNode = {};

  for (const blocker of blockerEntries) {
    byCode[blocker.code] = (byCode[blocker.code] || 0) + 1;
    bySeverity[blocker.severity] = (bySeverity[blocker.severity] || 0) + 1;
    firstByNode[blocker.nodeId] ||= {
      code: blocker.code,
      severity: blocker.severity,
      dependencyId: blocker.dependencyId || null,
      action: blocker.action || null
    };
  }

  return { byCode, bySeverity, firstByNode };
}

function dependencyBlocker(node, dependencyId, dependency, cycleNodes, now) {
  if (!dependency) {
    return {
      code: 'dependency-missing',
      dependencyId,
      severity: 'error',
      message: `${node.id} depends on missing node ${dependencyId}`,
      action: `add missing dependency node ${dependencyId} or remove it from ${node.id}`
    };
  }
  if (cycleNodes.has(node.id) && cycleNodes.has(dependencyId)) {
    return {
      code: 'dependency-cycle',
      dependencyId,
      severity: 'error',
      dependencyStatus: dependency.status,
      message: `${node.id} is blocked by a dependency cycle involving ${dependencyId}`,
      action: 'remove or invert one edge in the cycle'
    };
  }
  if (dependency.status === 'failed') {
    return {
      code: 'dependency-failed',
      dependencyId,
      severity: dependency.degraded || dependency.attempts >= dependency.maxAttempts ? 'error' : 'warning',
      dependencyStatus: dependency.status,
      message: `${node.id} is blocked because dependency ${dependencyId} failed`,
      action: retryWindowOpen(dependency, now)
        ? `issue retry-node for ${dependencyId}`
        : `remediate ${dependencyId} before retrying or resetting it`
    };
  }
  if (dependency.status === 'skipped') {
    return {
      code: 'dependency-skipped',
      dependencyId,
      severity: 'error',
      dependencyStatus: dependency.status,
      message: `${node.id} is blocked because dependency ${dependencyId} was skipped`,
      action: `reset ${dependencyId} or remove it from ${node.id}`
    };
  }
  return {
    code: 'dependency-not-succeeded',
    dependencyId,
    severity: 'info',
    dependencyStatus: dependency.status,
    message: `${node.id} is waiting for dependency ${dependencyId}`,
    action: terminalStatuses.has(dependency.status)
      ? `inspect terminal dependency ${dependencyId}`
      : `wait for ${dependencyId} to succeed`
  };
}

function dependencyBoundaryIssues(state) {
  const boundaryState = state.dependencyBoundary || buildDependencyBoundaryState(state);
  return [
    ...boundaryState.hiddenDependencies.map((dependency) => ({
      nodeId: dependency.nodeId,
      dependencyId: dependency.dependencyId,
      severity: 'error',
      code: 'dependency-outside-scope',
      message: `${dependency.nodeId} depends on ${dependency.dependencyId}, which is outside the active scheduler dependency graph scope`,
      action: dependency.action
    })),
    ...boundaryState.rejectedEdges.map((edge) => ({
      nodeId: edge.to || null,
      dependencyId: edge.from || null,
      severity: 'warning',
      code: 'dependency-edge-outside-scope',
      message: `dependency edge ${edge.from} -> ${edge.to} was rejected by the active scheduler scope`,
      action: edge.action
    }))
  ];
}

function buildDependencyGraphValidation(state, now) {
  const nodes = Object.values(state.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const cycle = detectCycle(state);
  const cycleNodes = new Set(cycle || []);
  const boundaryIssues = dependencyBoundaryIssues(state);
  const structuralIssues = structuralGraphIssues(state, cycle, boundaryIssues);
  const blockersByNode = {};
  const readyCandidates = [];

  for (const node of nodes) {
    if (terminalStatuses.has(node.status) || node.status === 'running') continue;
    const blockers = [];
    if (node.enabled === false) {
      blockers.push({
        code: 'node-disabled',
        severity: 'warning',
        message: `${node.id} is disabled`,
        action: node.disabledUntil ? `wait until ${node.disabledUntil} or issue enable-node for ${node.id}` : `issue enable-node for ${node.id}`,
        disabledReason: node.disabledReason || null,
        disabledUntil: node.disabledUntil || null
      });
    }
    for (const dependencyId of node.dependsOn) {
      const dependency = state.nodes[dependencyId];
      if (dependency?.status === 'succeeded') continue;
      const boundaryIssue = boundaryIssues.find((issue) => issue.nodeId === node.id && issue.dependencyId === dependencyId);
      if (boundaryIssue) {
        blockers.push({
          code: boundaryIssue.code,
          dependencyId,
          severity: boundaryIssue.severity,
          message: boundaryIssue.message,
          action: boundaryIssue.action
        });
        continue;
      }
      blockers.push(dependencyBlocker(node, dependencyId, dependency, cycleNodes, now));
    }
    if (cycleNodes.has(node.id) && !blockers.some((blocker) => blocker.code === 'dependency-cycle')) {
      blockers.push({
        code: 'dependency-cycle',
        severity: 'error',
        message: `${node.id} is part of a dependency cycle`,
        action: 'remove or invert one edge in the cycle'
      });
    }
    const providerReadiness = providerReadinessForNode(state, node, now);
    if (!providerReadiness.claimable) {
      blockers.push(...providerReadiness.blockers.map((blocker) => ({
        ...blocker,
        providerId: providerReadiness.providerId || null,
        requiredCapabilities: providerReadiness.requiredCapabilities,
        providerReadiness
      })));
    }
    if (blockers.length > 0) {
      blockersByNode[node.id] = blockers;
    } else {
      readyCandidates.push(node);
    }
  }

  const readyFrontier = readyCandidates
    .map((node) => readyFrontierEntry(state, node, now))
    .sort((a, b) => a.dependencyDepth - b.dependencyDepth
      || a.dependencyCount - b.dependencyCount
      || a.updatedAt.localeCompare(b.updatedAt)
      || a.nodeId.localeCompare(b.nodeId));
  const blockerEntries = Object.entries(blockersByNode)
    .flatMap(([nodeId, blockers]) => blockers.map((blocker) => ({ nodeId, ...blocker })));
  const blockerGroups = groupBlockerEntries(blockerEntries);
  const structurallyValid = !structuralIssues.some((issue) => issue.severity === 'error');

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.graphValidation.v1',
    valid: structurallyValid && !blockerEntries.some((blocker) => blocker.severity === 'error'),
    structurallyValid,
    runnable: readyFrontier.length > 0,
    cycle,
    cycleNodes: [...cycleNodes].sort(),
    readyFrontier,
    readyNodeIds: readyFrontier.map((entry) => entry.nodeId),
    blockedNodeIds: Object.keys(blockersByNode).sort(),
    blockersByNode,
    blockerSummary: {
      total: blockerEntries.length,
      errorCount: blockerGroups.bySeverity.error || 0,
      warningCount: blockerGroups.bySeverity.warning || 0,
      infoCount: blockerGroups.bySeverity.info || 0,
      codes: Object.keys(blockerGroups.byCode).sort(),
      byCode: blockerGroups.byCode,
      bySeverity: blockerGroups.bySeverity,
      firstByNode: blockerGroups.firstByNode
    },
    structuralSummary: {
      issueCount: structuralIssues.length,
      errorCount: structuralIssues.filter((issue) => issue.severity === 'error').length,
      warningCount: structuralIssues.filter((issue) => issue.severity === 'warning').length,
      codes: [...new Set(structuralIssues.map((issue) => issue.code))].sort(),
      missingDependencyCount: structuralIssues.filter((issue) => issue.code === 'missing-dependency').length,
      boundaryIssueCount: structuralIssues.filter((issue) => issue.code?.startsWith('dependency-') && issue.code?.includes('scope')).length,
      cycleCount: cycle ? 1 : 0
    },
    issues: structuralIssues
  };
}

function refreshDerivedStatuses(state, now) {
  const graphValidation = buildDependencyGraphValidation(state, now);
  const readySet = new Set(graphValidation.readyNodeIds);
  const blockedSet = new Set(graphValidation.blockedNodeIds);
  for (const node of Object.values(state.nodes)) {
    const nextStatus = readySet.has(node.id)
      ? 'ready'
      : blockedSet.has(node.id)
        ? 'blocked'
        : deriveRunnableStatus(state, node.id);
    if ((node.status === 'pending' || node.status === 'ready' || node.status === 'blocked') && nextStatus !== node.status) {
      node.status = nextStatus;
      node.updatedAt = now;
    }
  }
  return {
    ready: graphValidation.readyNodeIds,
    blocked: graphValidation.blockedNodeIds,
    graphValidation
  };
}

function applyLifecycleTimers(state, now) {
  const resumed = [];
  const observed = Date.parse(now);
  if (!Number.isFinite(observed)) return resumed;
  for (const node of Object.values(state.nodes)) {
    if (node.enabled !== false || typeof node.disabledUntil !== 'string') continue;
    const disabledUntil = Date.parse(node.disabledUntil);
    if (!Number.isFinite(disabledUntil) || disabledUntil > observed) continue;
    node.enabled = true;
    node.disabledReason = undefined;
    node.disabledUntil = undefined;
    if (node.status === 'blocked') node.status = 'pending';
    node.updatedAt = now;
    resumed.push(node.id);
  }
  return resumed;
}

function detectCycle(state) {
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(nodeId) {
    if (visiting.has(nodeId)) return [...path.slice(path.indexOf(nodeId)), nodeId];
    if (visited.has(nodeId) || !state.nodes[nodeId]) return null;
    visiting.add(nodeId);
    path.push(nodeId);
    for (const dependencyId of state.nodes[nodeId].dependsOn) {
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }

  for (const nodeId of Object.keys(state.nodes)) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

function dependencyIssues(state) {
  return Object.values(state.nodes)
    .flatMap((node) => node.dependsOn
      .filter((dependencyId) => !state.nodes[dependencyId])
      .map((dependencyId) => ({
        nodeId: node.id,
        dependencyId,
        severity: 'error',
        action: `add missing dependency node ${dependencyId} or remove it from ${node.id}`
      })));
}

function applyRecovery(state, input, now) {
  const bootId = typeof input.bootId === 'string' && input.bootId.length > 0 ? input.bootId : state.bootId;
  const previousBootId = state.bootId || null;
  const forced = input.recover === true;
  const bootChanged = Boolean(bootId && state.bootId && bootId !== state.bootId);
  const shouldRecover = forced || bootChanged;
  const recovered = [];
  if (!shouldRecover) {
    state.bootId = bootId;
    return recovered;
  }

  for (const node of Object.values(state.nodes)) {
    if (node.status === 'running') {
      const expiredLease = node.executionLease || null;
      const recoveredStatus = deriveRunnableStatus(state, node.id) === 'ready' ? 'ready' : 'blocked';
      node.executionLease = undefined;
      node.status = recoveredStatus;
      node.updatedAt = now;
      recovered.push({
        nodeId: node.id,
        previousStatus: 'running',
        recoveredStatus,
        leaseId: expiredLease?.leaseId || null,
        providerId: expiredLease?.providerId || null,
        holderId: expiredLease?.holderId || null,
        expiredAt: expiredLease?.expiresAt || null,
        reason: bootChanged ? 'boot-id-changed' : 'forced-recovery'
      });
    }
  }
  state.bootId = bootId;
  state.epoch += 1;
  if (recovered.length > 0) {
    state.recoveryLog.push(stampBoundary({
      at: now,
      bootId: bootId || null,
      previousBootId,
      epoch: state.epoch,
      reason: bootChanged ? 'boot-id-changed' : 'forced-recovery',
      recovered,
      recoveredCount: recovered.length
    }, state));
    state.recoveryLog = state.recoveryLog.slice(-50);
  }
  return recovered;
}

function recoverExpiredExecutionLeases(state, now) {
  const recovered = [];
  for (const node of Object.values(state.nodes)) {
    if (node.status !== 'running' || !leaseExpired(node.executionLease, now)) continue;
    const expiredLease = node.executionLease;
    node.executionLease = undefined;
    node.status = deriveRunnableStatus(state, node.id) === 'ready' ? 'ready' : 'blocked';
    node.updatedAt = now;
    recovered.push({
      nodeId: node.id,
      leaseId: expiredLease.leaseId,
      providerId: expiredLease.providerId,
      holderId: expiredLease.holderId,
      expiredAt: expiredLease.expiresAt,
      recoveredStatus: node.status
    });
  }
  if (recovered.length > 0) {
    state.epoch += 1;
    state.recoveryLog.push(stampBoundary({
      at: now,
      bootId: state.bootId || null,
      previousBootId: state.bootId || null,
      epoch: state.epoch,
      reason: 'execution-lease-expired',
      recovered,
      recoveredCount: recovered.length
    }, state));
    state.recoveryLog = state.recoveryLog.slice(-50);
  }
  return recovered;
}

function validateCommand(command) {
  if (!command || typeof command !== 'object') return null;
  const type = command.type;
  if (![
    'add-node',
    'add-edge',
    'mark-running',
    'mark-succeeded',
    'mark-failed',
    'reset-node',
    'retry-node',
    'configure-settings',
    'pause-scheduling',
    'resume-scheduling',
    'disable-node',
    'enable-node',
    'skip-node'
  ].includes(type)) {
    return `unsupported command type: ${String(type)}`;
  }
  if (type === 'configure-settings') {
    const settings = cloneRecord(command.settings);
    const hasInlineSetting = [
      'schedulingEnabled',
      'maxConcurrentRuns',
      'defaultNodeMaxAttempts',
      'retryBackoffMs',
      'autoPromoteReady',
      'requireResultRefOnSuccess'
    ].some((field) => field in command);
    if (Object.keys(settings).length === 0 && !hasInlineSetting) {
      return 'configure-settings requires settings or inline lifecycle setting fields';
    }
    return null;
  }
  if (schedulingControlCommands.has(type)) return null;
  if (type === 'add-edge') {
    if (typeof command.from !== 'string' || typeof command.to !== 'string' || command.from === command.to) {
      return 'add-edge requires distinct string from/to ids';
    }
    return null;
  }
  if (typeof command.nodeId !== 'string' || command.nodeId.length === 0) {
    return `${type} requires nodeId`;
  }
  if (type === 'disable-node' && 'disabledUntil' in command && !nullableIsoTimestamp(command.disabledUntil)) {
    return 'disable-node disabledUntil must be an ISO timestamp when supplied';
  }
  return null;
}

function applySettingsCommand(state, command, now) {
  if (command.type === 'pause-scheduling') {
    state.settings = {
      ...state.settings,
      schedulingEnabled: false,
      pausedReason: firstString(command.reason, command.pausedReason) || 'scheduling paused by command',
      updatedAt: now,
      validation: []
    };
    return { applied: true, idempotent: false };
  }
  if (command.type === 'resume-scheduling') {
    state.settings = {
      ...state.settings,
      schedulingEnabled: true,
      pausedReason: null,
      updatedAt: now,
      validation: []
    };
    return { applied: true, idempotent: false };
  }
  const inlineSettings = {};
  for (const field of ['maxConcurrentRuns', 'defaultNodeMaxAttempts', 'retryBackoffMs', 'autoPromoteReady', 'requireResultRefOnSuccess']) {
    if (field in command) inlineSettings[field] = command[field];
  }
  const nextSettings = normalizeLifecycleSettings({
    now,
    settings: {
      ...state.settings,
      ...cloneRecord(command.settings),
      ...inlineSettings,
      schedulingEnabled: typeof command.schedulingEnabled === 'boolean'
        ? command.schedulingEnabled
        : cloneRecord(command.settings).schedulingEnabled,
      pausedReason: firstString(command.pausedReason, command.reason, cloneRecord(command.settings).pausedReason)
    }
  }, {});
  state.settings = nextSettings;
  return {
    applied: true,
    idempotent: false,
    settingsValidation: nextSettings.validation
  };
}

function appendAppliedCommand(state, command, now, boundary) {
  const id = typeof command?.commandId === 'string' ? command.commandId : undefined;
  if (!id) return;
  state.appliedCommands.push({
    id,
    type: command.type,
    at: now,
    actorId: boundary.actorId || null,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    commandFingerprint: commandIdempotencyFingerprint(command),
    status: 'applied'
  });
  state.appliedCommands = state.appliedCommands.slice(-100);
}

function applyCommand(state, command, now, boundary) {
  if (boundary.deniedReason) {
    return { applied: false, idempotent: false, error: boundary.deniedReason, boundary: 'read-denied' };
  }
  if (!boundary.canWrite) {
    return { applied: false, idempotent: false, error: 'actor is not authorized to mutate scheduler dependency graph scope', boundary: 'write-denied' };
  }
  if (!commandMatchesBoundary(command, boundary)) {
    return { applied: false, idempotent: false, error: 'command tenant/workspace does not match scheduler dependency graph scope', boundary: 'scope-mismatch' };
  }

  const id = typeof command?.commandId === 'string' ? command.commandId : undefined;
  const commandFingerprint = commandIdempotencyFingerprint(command);
  const previousCommand = id ? state.appliedCommands.find((entry) => entry.id === id) : null;
  if (previousCommand) {
    if (previousCommand.commandFingerprint && commandFingerprint && previousCommand.commandFingerprint !== commandFingerprint) {
      return {
        applied: false,
        idempotent: false,
        error: 'commandId has already been applied with a different scheduler dependency graph payload',
        details: {
          commandId: id,
          previousType: previousCommand.type,
          requestedType: command.type,
          conflict: 'idempotency-key-reuse'
        }
      };
    }
    return {
      applied: false,
      idempotent: true,
      reason: 'command already applied',
      details: {
        commandId: id,
        previousType: previousCommand.type,
        appliedAt: previousCommand.at,
        fingerprintMatched: Boolean(previousCommand.commandFingerprint && commandFingerprint)
      }
    };
  }

  const validationError = validateCommand(command);
  if (validationError) return { applied: false, idempotent: false, error: validationError };

  if (schedulingControlCommands.has(command.type)) {
    const settingsResult = applySettingsCommand(state, command, now);
    appendAppliedCommand(state, command, now, boundary);
    return settingsResult;
  }

  if (command.type === 'add-node') {
    const node = normalizeNode({
      id: command.nodeId,
      dependsOn: command.dependsOn,
      status: command.status,
      maxAttempts: command.maxAttempts,
      providerRequirements: command.providerRequirements,
      providerId: command.providerId,
      requiredProviderCapabilities: command.requiredProviderCapabilities,
      handoffRequired: command.handoffRequired,
      externalHandoffRequired: command.externalHandoffRequired,
      serviceRef: command.serviceRef,
      providerSyncCursor: command.providerSyncCursor,
      tenantId: command.tenantId,
      workspaceId: command.workspaceId
    }, now, boundary, state.settings);
    if (!node) return { applied: false, idempotent: false, error: 'node is outside scheduler dependency graph scope', boundary: 'scope-mismatch' };
    state.nodes[node.id] = { ...node, ...state.nodes[node.id], dependsOn: node.dependsOn };
  } else if (command.type === 'add-edge') {
    state.nodes[command.from] ||= normalizeNode({ id: command.from, tenantId: command.tenantId, workspaceId: command.workspaceId }, now, boundary, state.settings);
    state.nodes[command.to] ||= normalizeNode({ id: command.to, tenantId: command.tenantId, workspaceId: command.workspaceId }, now, boundary, state.settings);
    if (!state.nodes[command.from] || !state.nodes[command.to]) {
      return { applied: false, idempotent: false, error: 'edge endpoints are outside scheduler dependency graph scope', boundary: 'scope-mismatch' };
    }
    state.nodes[command.to].dependsOn = [...new Set([...state.nodes[command.to].dependsOn, command.from])];
    const cycle = detectCycle(state);
    if (cycle) {
      state.nodes[command.to].dependsOn = state.nodes[command.to].dependsOn.filter((id) => id !== command.from);
      return { applied: false, idempotent: false, error: 'add-edge would create a dependency cycle', details: { cycle } };
    }
    state.nodes[command.to].updatedAt = now;
  } else {
    state.nodes[command.nodeId] ||= normalizeNode({ id: command.nodeId, tenantId: command.tenantId, workspaceId: command.workspaceId }, now, boundary, state.settings);
    if (!state.nodes[command.nodeId]) {
      return { applied: false, idempotent: false, error: 'node is outside scheduler dependency graph scope', boundary: 'scope-mismatch' };
    }
    const node = state.nodes[command.nodeId];
    if (nodeLifecycleCommands.has(command.type)) {
      if (command.type === 'disable-node') {
        node.enabled = false;
        node.status = terminalStatuses.has(node.status) ? node.status : 'blocked';
        const requestedReason = firstString(command.reason, command.disabledReason);
        node.disabledReason = lifecycleDisableReasons.has(requestedReason)
          ? requestedReason
          : requestedReason || 'disabled by scheduler lifecycle command';
        node.disabledUntil = nullableIsoTimestamp(command.disabledUntil) || undefined;
        node.executionLease = undefined;
      }
      if (command.type === 'enable-node') {
        node.enabled = true;
        node.disabledReason = undefined;
        node.disabledUntil = undefined;
        if (node.status === 'blocked' || node.status === 'skipped') {
          node.status = deriveRunnableStatus(state, node.id) === 'ready' ? 'ready' : 'pending';
        }
      }
      if (command.type === 'skip-node') {
        node.status = 'skipped';
        node.enabled = false;
        node.disabledReason = firstString(command.reason, command.disabledReason) || 'skipped by scheduler lifecycle command';
        node.executionLease = undefined;
      }
    }
    if (command.type === 'mark-running') {
      if (state.settings.schedulingEnabled === false) {
        return { applied: false, idempotent: false, error: 'cannot run node while scheduler dependency graph scheduling is paused' };
      }
      if (node.enabled === false) return { applied: false, idempotent: false, error: 'cannot run disabled scheduler dependency graph node' };
      if (deriveRunnableStatus(state, node.id) !== 'ready') return { applied: false, idempotent: false, error: 'cannot run node before dependencies succeed' };
      node.status = 'running';
      node.attempts += 1;
      node.executionLease = buildExecutionLease(command, state, boundary, now);
    }
    if (command.type === 'mark-succeeded') {
      if (node.status === 'succeeded' && (!command.resultRef || command.resultRef === node.resultRef)) {
        return { applied: false, idempotent: true, reason: 'node already succeeded' };
      }
      if (state.settings.requireResultRefOnSuccess && typeof command.resultRef !== 'string') {
        return { applied: false, idempotent: false, error: 'mark-succeeded requires resultRef when lifecycle settings require proof output' };
      }
      node.status = 'succeeded';
      node.enabled = true;
      node.resultRef = typeof command.resultRef === 'string' ? command.resultRef : node.resultRef;
      node.failure = undefined;
      node.errorCode = undefined;
      node.failureAction = undefined;
      node.retryAfter = undefined;
      node.disabledReason = undefined;
      node.disabledUntil = undefined;
      node.degraded = false;
      node.executionLease = undefined;
    }
    if (command.type === 'mark-failed') {
      if (node.status === 'failed' && firstString(command.errorCode, 'node-failed') === node.errorCode) {
        return { applied: false, idempotent: true, reason: 'node already failed with matching errorCode' };
      }
      node.status = 'failed';
      node.failure = typeof command.failure === 'string' ? command.failure : 'failed without detail';
      node.errorCode = typeof command.errorCode === 'string' ? command.errorCode : 'node-failed';
      node.failureAction = typeof command.failureAction === 'string' ? command.failureAction : 'inspect failure, fix the underlying condition, then issue retry-node or reset-node';
      node.retryAfter = node.attempts < node.maxAttempts
        ? addMilliseconds(now, retryBackoffForAttempt(node.attempts, command.retryAfterMs || state.settings.retryBackoffMs))
        : undefined;
      node.degraded = node.attempts >= node.maxAttempts;
      node.executionLease = undefined;
    }
    if (command.type === 'reset-node') {
      node.status = 'pending';
      node.enabled = true;
      node.failure = undefined;
      node.resultRef = undefined;
      node.errorCode = undefined;
      node.failureAction = undefined;
      node.retryAfter = undefined;
      node.disabledReason = undefined;
      node.disabledUntil = undefined;
      node.degraded = false;
      node.executionLease = undefined;
    }
    if (command.type === 'retry-node') {
      if (node.status !== 'failed') return { applied: false, idempotent: true, reason: 'node is not in failed state' };
      if (!retryWindowOpen(node, now)) {
        return {
          applied: false,
          idempotent: false,
          error: 'retry-node rejected until retryAfter',
          details: { retryAfter: node.retryAfter, attempts: node.attempts, maxAttempts: node.maxAttempts }
        };
      }
      node.status = 'pending';
      node.status = deriveRunnableStatus(state, node.id) === 'ready' ? 'ready' : 'blocked';
      node.failure = undefined;
      node.errorCode = undefined;
      node.failureAction = undefined;
      node.retryAfter = undefined;
      node.degraded = false;
      node.executionLease = undefined;
    }
    node.updatedAt = now;
  }

  appendAppliedCommand(state, command, now, boundary);
  return { applied: true, idempotent: false };
}

function commandLifecycleDomain(type) {
  if (schedulingControlCommands.has(type)) return 'scheduler-settings';
  if (nodeLifecycleCommands.has(type)) return 'node-lifecycle';
  if (['mark-running', 'mark-succeeded', 'mark-failed', 'retry-node', 'reset-node'].includes(type)) return 'node-execution';
  if (['add-node', 'add-edge'].includes(type)) return 'graph-topology';
  return 'preview';
}

function buildCommandLifecycleReceipt(command, commandResult, state, boundary, now) {
  const type = firstString(command?.type) || null;
  const nodeId = firstString(command?.nodeId, command?.to, command?.from) || null;
  const targetNode = nodeId ? state.nodes[nodeId] || null : null;
  const appliedEntry = typeof command?.commandId === 'string'
    ? state.appliedCommands.find((entry) => entry.id === command.commandId) || null
    : null;
  const lifecycleDomain = commandLifecycleDomain(type);
  const accepted = commandResult.applied === true || commandResult.idempotent === true;
  const rejectionCode = commandResult.error
    ? commandResult.boundary
      ? `boundary-${commandResult.boundary}`
      : 'command-validation-rejected'
    : null;
  const settingsChanged = lifecycleDomain === 'scheduler-settings' && commandResult.applied === true;
  const nodeChanged = Boolean(targetNode && commandResult.applied === true && lifecycleDomain !== 'scheduler-settings');
  const allowedFollowups = [];

  if (state.settings.schedulingEnabled === false && boundary.canWrite) {
    allowedFollowups.push({ type: 'resume-scheduling', reason: state.settings.pausedReason || 'scheduling-paused' });
  }
  if (targetNode && boundary.canWrite) {
    if (targetNode.enabled === false && targetNode.status !== 'skipped') {
      allowedFollowups.push(commandTemplate('enable-node', targetNode.id, boundary));
    }
    if (targetNode.status === 'failed' && retryWindowOpen(targetNode, now)) {
      allowedFollowups.push(commandTemplate('retry-node', targetNode.id, boundary));
    }
    if (targetNode.status === 'running') {
      allowedFollowups.push(commandTemplate('mark-succeeded', targetNode.id, boundary, {
        resultRef: state.settings.requireResultRefOnSuccess ? '<required-result-ref>' : undefined
      }));
      allowedFollowups.push(commandTemplate('mark-failed', targetNode.id, boundary, { errorCode: 'node-failed' }));
    }
  }

  const nextAction = commandResult.error
    ? commandResult.boundary
      ? 'refresh actor scope or scheduler permissions before resubmitting this lifecycle command'
      : 'correct the lifecycle command payload and resubmit with a new commandId'
    : commandResult.idempotent
      ? 'reuse the existing command result and continue from the current scheduler state'
      : allowedFollowups.length > 0
        ? `submit ${allowedFollowups[0].type}${allowedFollowups[0].nodeId ? ` for ${allowedFollowups[0].nodeId}` : ''}`
        : settingsChanged
          ? 'persist lifecycle settings and recompute scheduler dispatch state'
          : nodeChanged
            ? `persist ${targetNode.id} lifecycle state and recompute dependent nodes`
            : 'observe scheduler dependency graph state';

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.lifecycleCommandReceipt.v1',
    commandId: typeof command?.commandId === 'string' ? command.commandId : null,
    commandType: type,
    lifecycleDomain,
    accepted,
    applied: commandResult.applied === true,
    idempotent: commandResult.idempotent === true,
    rejected: Boolean(commandResult.error),
    rejectionCode,
    reason: commandResult.error || commandResult.reason || null,
    boundary: boundaryScopeDescriptor(boundary),
    target: targetNode
      ? {
        nodeId: targetNode.id,
        status: targetNode.status,
        enabled: targetNode.enabled,
        disabledReason: targetNode.disabledReason || null,
        disabledUntil: targetNode.disabledUntil || null,
        retryAfter: targetNode.retryAfter || null,
        executionLeaseId: targetNode.executionLease?.leaseId || null
      }
      : null,
    settings: {
      schedulingEnabled: state.settings.schedulingEnabled,
      autoPromoteReady: state.settings.autoPromoteReady,
      maxConcurrentRuns: state.settings.maxConcurrentRuns,
      defaultNodeMaxAttempts: state.settings.defaultNodeMaxAttempts,
      retryBackoffMs: state.settings.retryBackoffMs,
      requireResultRefOnSuccess: state.settings.requireResultRefOnSuccess,
      pausedReason: state.settings.pausedReason || null,
      validation: state.settings.validation
    },
    ledger: {
      recorded: Boolean(appliedEntry),
      recordedAt: appliedEntry?.at || null,
      fingerprinted: typeof appliedEntry?.commandFingerprint === 'string',
      status: appliedEntry?.status || (commandResult.idempotent ? 'idempotent' : commandResult.error ? 'rejected' : 'preview')
    },
    proof: {
      stateEpoch: state.epoch,
      commandFingerprint: commandIdempotencyFingerprint(command),
      settingsChanged,
      nodeChanged,
      requiredWritePermission: graphWritePermission
    },
    allowedFollowups: allowedFollowups.slice(0, 5),
    nextAction
  };
}

function buildAuditHandoff(boundary, commandResult, state, now) {
  const lastCommand = state.appliedCommands[state.appliedCommands.length - 1];
  return {
    at: now,
    sinkRef: boundary.auditSinkRef || null,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    actorId: boundary.actorId || null,
    decision: commandResult.error ? 'denied-or-rejected' : commandResult.applied ? 'accepted' : 'observed',
    boundary: commandResult.boundary || (boundary.scoped ? 'scoped' : 'unscoped'),
    stateEpoch: state.epoch,
    commandId: lastCommand?.id || null
  };
}

function buildOperationalHealth(state, commandResult, derived, now, commandReceipt = null) {
  const nodes = Object.values(state.nodes);
  const graphValidation = derived.graphValidation || buildDependencyGraphValidation(state, now);
  const disabledNodes = nodes
    .filter((node) => node.enabled === false)
    .map((node) => ({
      nodeId: node.id,
      reason: node.disabledReason || 'disabled',
      disabledUntil: node.disabledUntil || null,
      action: node.disabledUntil ? `wait until ${node.disabledUntil} or issue enable-node for ${node.id}` : `issue enable-node for ${node.id}`
    }));
  const failures = nodes
    .filter((node) => node.status === 'failed')
    .map((node) => {
      const retryable = retryWindowOpen(node, now);
      return {
        nodeId: node.id,
        errorCode: node.errorCode || 'node-failed',
        message: node.failure || 'failed without detail',
        attempts: node.attempts,
        maxAttempts: node.maxAttempts,
        retryable,
        retryAfter: node.retryAfter || null,
        degraded: node.degraded || node.attempts >= node.maxAttempts,
        action: retryable
          ? `issue retry-node for ${node.id}`
          : node.attempts >= node.maxAttempts
            ? `issue reset-node for ${node.id} after remediation`
            : `wait until ${node.retryAfter || 'the retry window opens'}`
      };
    });
  const blockedWithoutReady = derived.ready.length === 0 && derived.blocked.length > 0 && failures.length === 0;
  const rejectedCommand = commandResult.error
    ? [{
      severity: 'error',
      code: commandReceipt?.rejectionCode || 'command-rejected',
      message: commandResult.error,
      action: commandReceipt?.nextAction || 'correct the command and resubmit with a new commandId'
    }]
    : [];
  const issues = [
    ...rejectedCommand,
    ...state.settings.validation.map((issue) => ({ code: 'settings-normalized', ...issue, action: 'resubmit configure-settings with valid scheduler lifecycle bounds' })),
    ...(state.settings.schedulingEnabled === false
      ? [{
        severity: 'warning',
        code: 'scheduling-paused',
        message: state.settings.pausedReason || 'scheduling is paused',
        action: 'issue resume-scheduling when lifecycle gates are satisfied'
      }]
      : []),
    ...disabledNodes.map((node) => ({ severity: 'warning', code: 'node-disabled', ...node })),
    ...graphValidation.issues,
    ...Object.entries(graphValidation.blockersByNode)
      .flatMap(([nodeId, blockers]) => blockers
        .filter((blocker) => blocker.code !== 'node-disabled')
        .map((blocker) => ({
          severity: blocker.severity,
          code: blocker.code,
          nodeId,
          dependencyId: blocker.dependencyId || null,
          dependencyStatus: blocker.dependencyStatus || null,
          message: blocker.message,
          action: blocker.action
        }))),
    ...(blockedWithoutReady ? [{ severity: 'warning', code: 'no-runnable-nodes', action: 'wait for dependencies or inspect blockedNodes for stalled prerequisites' }] : [])
  ];
  const degraded = failures.some((failure) => failure.degraded) || issues.some((issue) => issue.severity === 'error');

  return {
    mode: degraded ? 'degraded' : issues.length > 0 ? 'attention-required' : 'healthy',
    degraded,
    retryPolicy: {
      defaultMaxAttempts,
      defaultBackoffMs: defaultRetryBackoffMs,
      maxBackoffMs: maxRetryBackoffMs
    },
    disabledNodes,
    failures,
    issues,
    nextAction: commandReceipt?.nextAction || issues[0]?.action || failures.find((failure) => failure.retryable)?.action || null
  };
}

function buildSchedulingPlan(state, nodes, derived, health, now) {
  const graphValidation = derived.graphValidation || buildDependencyGraphValidation(state, now);
  const running = nodes.filter((node) => node.status === 'running').map((node) => node.id);
  const runningLeases = nodes
    .filter((node) => node.status === 'running')
    .map((node) => ({
      nodeId: node.id,
      leaseId: node.executionLease?.leaseId || null,
      providerId: node.executionLease?.providerId || null,
      holderId: node.executionLease?.holderId || null,
      expiresAt: node.executionLease?.expiresAt || null,
      expired: leaseExpired(node.executionLease, now)
    }));
  const availableSlots = Math.max(0, state.settings.maxConcurrentRuns - running.length);
  const enabledReady = derived.ready.filter((nodeId) => state.nodes[nodeId]?.enabled !== false);
  const dispatchable = state.settings.schedulingEnabled === false || state.settings.autoPromoteReady === false
    ? []
    : enabledReady.slice(0, availableSlots);
  const dispatchHealthGate = buildDispatchHealthGate(state, nodes, graphValidation, health, {
    running,
    availableSlots,
    enabledReady,
    dispatchable
  }, now);
  const lifecycleBlocked = [
    ...health.disabledNodes.map((node) => ({ nodeId: node.nodeId, reason: 'disabled', action: node.action })),
    ...(state.settings.schedulingEnabled === false
      ? enabledReady.map((nodeId) => ({ nodeId, reason: 'scheduling-paused', action: 'issue resume-scheduling' }))
      : []),
    ...(state.settings.autoPromoteReady === false
      ? enabledReady.map((nodeId) => ({ nodeId, reason: 'auto-promote-disabled', action: `issue mark-running for ${nodeId} when an external dispatcher claims it` }))
      : [])
  ];

  return {
    generatedAt: now,
    schedulingEnabled: state.settings.schedulingEnabled,
    autoPromoteReady: state.settings.autoPromoteReady,
    maxConcurrentRuns: state.settings.maxConcurrentRuns,
    running,
    runningLeases,
    availableSlots,
    dispatchHealthGate,
    readyCandidates: enabledReady,
    readyFrontier: graphValidation.readyFrontier,
    dispatchable,
    lifecycleBlocked,
    graphBlocked: graphValidation.blockedNodeIds.map((nodeId) => ({
      nodeId,
      blockers: graphValidation.blockersByNode[nodeId] || []
    })),
    frontierPolicy: {
      schema: 'scheduler.dependencyGraph.readyFrontierPolicy.v1',
      order: ['dependencyDepth', 'dependencyCount', 'updatedAt', 'nodeId'],
      capacityBoundedBy: 'settings.maxConcurrentRuns - runningCount',
      excludes: ['terminal', 'running', 'disabled', 'unmet-dependency', 'dependency-cycle']
    },
    nextAction: dispatchable.length > 0
      ? `dispatch ${dispatchable[0]} with mark-running`
      : dispatchHealthGate.nextAction
  };
}

function buildDispatchHealthGate(state, nodes, graphValidation, health, capacity, now) {
  const openNodes = nodes.filter((node) => !terminalStatuses.has(node.status));
  const failedNodes = health.failures.map((failure) => ({
    nodeId: failure.nodeId,
    retryable: failure.retryable,
    retryAfter: failure.retryAfter,
    degraded: failure.degraded,
    action: failure.action
  }));
  const terminalBlockers = Object.entries(graphValidation.blockersByNode)
    .flatMap(([nodeId, blockers]) => blockers
      .filter((blocker) => blocker.severity === 'error')
      .map((blocker) => ({
        nodeId,
        code: blocker.code,
        dependencyId: blocker.dependencyId || null,
        action: blocker.action || null
      })))
    .slice(0, 25);
  const retryableFailures = failedNodes.filter((failure) => failure.retryable);
  const waitingBackoffFailures = failedNodes.filter((failure) => !failure.retryable && !failure.degraded && failure.retryAfter);
  const capacityBlocked = capacity.enabledReady.length > 0 && capacity.availableSlots <= 0;
  const dispatchDeniedReasons = [
    ...(state.settings.schedulingEnabled === false
      ? [{
        code: 'scheduling-paused',
        severity: 'warning',
        message: state.settings.pausedReason || 'scheduler dependency graph dispatch is paused',
        action: 'issue resume-scheduling before dispatching ready nodes',
        blocksDispatch: true
      }]
      : []),
    ...(state.settings.autoPromoteReady === false && capacity.enabledReady.length > 0
      ? [{
        code: 'auto-promote-disabled',
        severity: 'warning',
        message: 'ready nodes require an explicit dispatcher claim because autoPromoteReady is disabled',
        action: `issue mark-running for ${capacity.enabledReady[0]} or re-enable autoPromoteReady`,
        blocksDispatch: true,
        nodeId: capacity.enabledReady[0]
      }]
      : []),
    ...(capacityBlocked
      ? [{
        code: 'dispatch-capacity-exhausted',
        severity: 'warning',
        message: `all ${state.settings.maxConcurrentRuns} scheduler dependency graph execution slot(s) are in use`,
        action: 'wait for running nodes to complete or increase settings.maxConcurrentRuns',
        blocksDispatch: true,
        runningNodeIds: capacity.running
      }]
      : []),
    ...(graphValidation.structuralSummary.errorCount > 0
      ? [{
        code: 'graph-structural-errors',
        severity: 'error',
        message: 'dependency graph structural validation errors block safe dispatch',
        action: graphValidation.issues.find((issue) => issue.severity === 'error')?.action || 'fix dependency graph validation errors before dispatch',
        blocksDispatch: true,
        issueCodes: graphValidation.structuralSummary.codes
      }]
      : []),
    ...(terminalBlockers.length > 0 && capacity.enabledReady.length === 0
      ? [{
        code: 'frontier-blocked-by-errors',
        severity: 'error',
        message: 'no ready frontier can be selected because dependency blockers contain errors',
        action: terminalBlockers[0]?.action || 'resolve dependency blockers before dispatch',
        blocksDispatch: true,
        blockers: terminalBlockers
      }]
      : []),
    ...(retryableFailures.length > 0 && capacity.enabledReady.length === 0
      ? [{
        code: 'retryable-failures-awaiting-operator',
        severity: 'warning',
        message: 'failed nodes are retryable but must be retried before dependent work can run',
        action: retryableFailures[0].action,
        blocksDispatch: true,
        retryableNodeIds: retryableFailures.map((failure) => failure.nodeId)
      }]
      : []),
    ...(waitingBackoffFailures.length > 0 && capacity.enabledReady.length === 0
      ? [{
        code: 'retry-backoff-active',
        severity: 'info',
        message: 'failed nodes are waiting for retry backoff windows',
        action: waitingBackoffFailures[0].action,
        blocksDispatch: true,
        retryAfter: waitingBackoffFailures.map((failure) => failure.retryAfter).sort()[0] || null
      }]
      : []),
    ...(openNodes.length > 0 && capacity.enabledReady.length === 0 && graphValidation.blockerSummary.total === 0 && failedNodes.length === 0
      ? [{
        code: 'frontier-empty',
        severity: 'info',
        message: 'open nodes exist but no dispatchable ready frontier is currently available',
        action: capacity.running.length > 0 ? 'wait for running nodes to complete' : 'inspect pending node dependencies and scheduler status',
        blocksDispatch: true
      }]
      : [])
  ];
  const hardBlocked = dispatchDeniedReasons.some((reason) => reason.severity === 'error');
  const stateLabel = capacity.dispatchable.length > 0
    ? 'dispatch-ready'
    : openNodes.length === 0
      ? 'settled'
      : hardBlocked
        ? 'blocked'
        : dispatchDeniedReasons.length > 0
          ? 'waiting'
          : 'idle';

  return {
    schema: 'scheduler.dependencyGraph.dispatchHealthGate.v1',
    generatedAt: now,
    state: stateLabel,
    dispatchAllowed: capacity.dispatchable.length > 0,
    blocked: stateLabel === 'blocked',
    capacity: {
      maxConcurrentRuns: state.settings.maxConcurrentRuns,
      runningCount: capacity.running.length,
      availableSlots: capacity.availableSlots,
      readyCandidateCount: capacity.enabledReady.length,
      dispatchableCount: capacity.dispatchable.length
    },
    frontier: {
      readyNodeIds: graphValidation.readyNodeIds,
      selectedNodeIds: capacity.dispatchable,
      blockedNodeIds: graphValidation.blockedNodeIds,
      blockerCodes: graphValidation.blockerSummary.codes
    },
    failures: {
      failedNodeCount: failedNodes.length,
      retryableNodeIds: retryableFailures.map((failure) => failure.nodeId),
      degradedNodeIds: failedNodes.filter((failure) => failure.degraded).map((failure) => failure.nodeId),
      nextRetryAfter: waitingBackoffFailures.map((failure) => failure.retryAfter).filter(Boolean).sort()[0] || null
    },
    deniedReasons: dispatchDeniedReasons,
    nextAction: capacity.dispatchable.length > 0
      ? `dispatch ${capacity.dispatchable[0]} with mark-running`
      : dispatchDeniedReasons[0]?.action || (capacity.running.length > 0 ? 'wait for running nodes to complete' : null)
  };
}

function commandTemplate(type, nodeId, boundary, extra = {}) {
  return {
    type,
    nodeId,
    tenantId: boundary.tenantId || undefined,
    workspaceId: boundary.workspaceId || undefined,
    ...extra
  };
}

function lifecycleBlockerRemediationCommand(blocker, node, state, boundary, now) {
  if (!boundary.canWrite || !blocker || !node) return null;
  if (blocker.code === 'node-disabled' && node.status !== 'skipped') {
    return commandTemplate('enable-node', node.id, boundary);
  }
  if (blocker.code === 'dependency-failed') {
    const dependency = state.nodes[blocker.dependencyId];
    if (!dependency) return null;
    if (retryWindowOpen(dependency, now)) return commandTemplate('retry-node', dependency.id, boundary);
    if (dependency.degraded || dependency.attempts >= dependency.maxAttempts) {
      return commandTemplate('reset-node', dependency.id, boundary);
    }
    return null;
  }
  if (blocker.code === 'dependency-skipped' && typeof blocker.dependencyId === 'string') {
    return commandTemplate('reset-node', blocker.dependencyId, boundary);
  }
  if (blocker.code === 'dependency-not-succeeded') {
    const dependency = state.nodes[blocker.dependencyId];
    if (dependency?.status === 'ready') return commandTemplate('mark-running', dependency.id, boundary);
    if (dependency?.status === 'failed' && retryWindowOpen(dependency, now)) {
      return commandTemplate('retry-node', dependency.id, boundary);
    }
  }
  return null;
}

function lifecycleBlockerControl(blocker, node, state, boundary, now) {
  const dependency = typeof blocker?.dependencyId === 'string' ? state.nodes[blocker.dependencyId] || null : null;
  const command = lifecycleBlockerRemediationCommand(blocker, node, state, boundary, now);
  const retryAfter = dependency?.retryAfter || null;
  const waitUntil = retryAfter || node.disabledUntil || null;

  return {
    code: blocker.code,
    severity: blocker.severity || 'info',
    nodeId: node.id,
    dependencyId: blocker.dependencyId || null,
    dependencyStatus: blocker.dependencyStatus || dependency?.status || null,
    message: blocker.message || blocker.action || 'scheduler dependency graph node is blocked',
    action: blocker.action || null,
    command,
    commandAvailable: Boolean(command),
    waitUntil,
    stale: waitUntil ? Date.parse(waitUntil) <= Date.parse(now) : false
  };
}

function lifecycleBlockedActionState(node, blockerControls, boundary) {
  const blockingErrors = blockerControls.filter((blocker) => blocker.severity === 'error');
  const suggested = blockerControls.find((blocker) => blocker.commandAvailable)
    || blockerControls.find((blocker) => blocker.waitUntil)
    || blockerControls[0]
    || null;

  return {
    state: blockerControls.length === 0
      ? 'clear'
      : blockingErrors.length > 0
        ? 'blocked'
        : 'waiting',
    primaryBlockerCode: suggested?.code || null,
    blockerCount: blockerControls.length,
    errorCount: blockingErrors.length,
    canRemediate: Boolean(suggested?.commandAvailable),
    suggestedCommand: suggested?.command || null,
    nextAction: suggested?.commandAvailable
      ? `submit ${suggested.command.type}${suggested.command.nodeId ? ` for ${suggested.command.nodeId}` : ''}`
      : suggested?.waitUntil
        ? `wait until ${suggested.waitUntil}`
        : suggested?.action || (!boundary.canWrite ? 'write permission required to remediate this node' : null),
    targetStatus: node.status
  };
}

function buildLifecycleControlState(state, nodes, schedulingPlan, health, boundary, now, commandReceipt = null) {
  const canMutate = boundary.canWrite && !boundary.deniedReason;
  const schedulerBlockedReason = state.settings.schedulingEnabled === false
    ? state.settings.pausedReason || 'scheduling is paused'
    : null;
  const retryableFailures = new Set(health.failures.filter((failure) => failure.retryable).map((failure) => failure.nodeId));
  const disabledNodeIds = new Set(health.disabledNodes.map((node) => node.nodeId));
  const graphBlockersByNode = Object.fromEntries(
    (Array.isArray(schedulingPlan.graphBlocked) ? schedulingPlan.graphBlocked : [])
      .map((entry) => [entry.nodeId, Array.isArray(entry.blockers) ? entry.blockers : []])
  );
  const nodeControls = nodes.slice(0, 100).map((node) => {
    const runnable = schedulingPlan.dispatchable.includes(node.id);
    const retryable = retryableFailures.has(node.id);
    const terminal = terminalStatuses.has(node.status);
    const blockedByDependencies = node.dependsOn.filter((dependencyId) => state.nodes[dependencyId]?.status !== 'succeeded');
    const blockerControls = (graphBlockersByNode[node.id] || [])
      .map((blocker) => lifecycleBlockerControl(blocker, node, state, boundary, now));
    const blockedActionState = lifecycleBlockedActionState(node, blockerControls, boundary);
    const disableAllowed = canMutate && node.enabled !== false && !terminal;
    const enableAllowed = canMutate && node.enabled === false && node.status !== 'skipped';
    const skipAllowed = canMutate && !terminal && node.status !== 'running';
    const retryAllowed = canMutate && retryable;
    const runAllowed = canMutate && runnable;
    const completeAllowed = canMutate && node.status === 'running';

    return {
      nodeId: node.id,
      status: node.status,
      enabled: node.enabled,
      disabledReason: node.disabledReason || null,
      disabledUntil: node.disabledUntil || null,
      blockedByDependencies,
      blockedActionState,
      blockerControls,
      controls: {
        disable: {
          allowed: disableAllowed,
          command: disableAllowed ? commandTemplate('disable-node', node.id, boundary, { reason: 'operator-hold' }) : null,
          reason: disableAllowed ? null : terminal ? 'terminal nodes cannot be disabled' : !canMutate ? 'write permission required' : 'node is already disabled'
        },
        enable: {
          allowed: enableAllowed,
          command: enableAllowed ? commandTemplate('enable-node', node.id, boundary) : null,
          reason: enableAllowed ? null : !canMutate ? 'write permission required' : node.status === 'skipped' ? 'skipped nodes require reset-node before enable' : 'node is already enabled'
        },
        skip: {
          allowed: skipAllowed,
          command: skipAllowed ? commandTemplate('skip-node', node.id, boundary, { reason: 'manual-skip' }) : null,
          reason: skipAllowed ? null : node.status === 'running' ? 'running nodes must finish or fail before skip' : terminal ? 'terminal nodes are already closed' : 'write permission required'
        },
        retry: {
          allowed: retryAllowed,
          command: retryAllowed ? commandTemplate('retry-node', node.id, boundary) : null,
          reason: retryAllowed ? null : node.status !== 'failed' ? 'node is not failed' : 'retry window is not open'
        },
        run: {
          allowed: runAllowed,
          command: runAllowed ? commandTemplate('mark-running', node.id, boundary) : null,
          reason: runAllowed
            ? null
            : schedulerBlockedReason || blockedActionState.nextAction || (node.enabled === false ? 'node disabled' : blockedByDependencies.length > 0 ? 'dependencies are not complete' : 'node is not dispatchable')
        },
        complete: {
          successAllowed: completeAllowed,
          failureAllowed: completeAllowed,
          successCommand: completeAllowed ? commandTemplate('mark-succeeded', node.id, boundary, { resultRef: state.settings.requireResultRefOnSuccess ? '<required-result-ref>' : undefined }) : null,
          failureCommand: completeAllowed ? commandTemplate('mark-failed', node.id, boundary, { errorCode: 'node-failed' }) : null
        }
      }
    };
  });
  const actionableBlockerControl = nodeControls
    .find((node) => node.blockedActionState.suggestedCommand)
    ?.blockedActionState || null;
  const blockedControlSummary = nodeControls.reduce((summary, node) => {
    if (node.blockedActionState.state === 'clear') return summary;
    summary.total += 1;
    summary.error += node.blockedActionState.errorCount > 0 ? 1 : 0;
    summary.remediable += node.blockedActionState.canRemediate ? 1 : 0;
    if (node.blockedActionState.primaryBlockerCode) {
      summary.codes[node.blockedActionState.primaryBlockerCode] = (summary.codes[node.blockedActionState.primaryBlockerCode] || 0) + 1;
    }
    return summary;
  }, { total: 0, error: 0, remediable: 0, codes: {} });

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.lifecycleControls.v1',
    canMutate,
    settings: {
      pause: {
        allowed: canMutate && state.settings.schedulingEnabled !== false,
        command: canMutate && state.settings.schedulingEnabled !== false ? { type: 'pause-scheduling', reason: 'operator-hold' } : null
      },
      resume: {
        allowed: canMutate && state.settings.schedulingEnabled === false,
        command: canMutate && state.settings.schedulingEnabled === false ? { type: 'resume-scheduling' } : null
      },
      configure: {
        allowed: canMutate,
        commandShape: {
          type: 'configure-settings',
          settings: ['schedulingEnabled', 'autoPromoteReady', 'maxConcurrentRuns', 'defaultNodeMaxAttempts', 'retryBackoffMs', 'requireResultRefOnSuccess']
        }
      }
    },
    capacity: {
      runningCount: schedulingPlan.running.length,
      maxConcurrentRuns: state.settings.maxConcurrentRuns,
      availableSlots: schedulingPlan.availableSlots,
      dispatchableCount: schedulingPlan.dispatchable.length
    },
    disableReasons: [...lifecycleDisableReasons].sort(),
    disabledNodeIds: [...disabledNodeIds].sort(),
    blockedControlSummary: {
      ...blockedControlSummary,
      codes: Object.keys(blockedControlSummary.codes).sort().reduce((codes, code) => {
        codes[code] = blockedControlSummary.codes[code];
        return codes;
      }, {})
    },
    nodeControls,
    commandReceipt,
    nextCommand: nodeControls.find((node) => node.controls.run.allowed)?.controls.run.command
      || nodeControls.find((node) => node.controls.retry.allowed)?.controls.retry.command
      || actionableBlockerControl?.suggestedCommand
      || commandReceipt?.allowedFollowups?.[0]
      || (state.settings.schedulingEnabled === false && canMutate ? { type: 'resume-scheduling' } : null)
  };
}

function providerWorkloadSummary(providerId, schedulingPlan) {
  const runningLeases = Array.isArray(schedulingPlan.runningLeases) ? schedulingPlan.runningLeases : [];
  const activeLeases = runningLeases
    .filter((lease) => lease.providerId === providerId && lease.expired !== true)
    .map((lease) => ({
      nodeId: lease.nodeId,
      leaseId: lease.leaseId,
      holderId: lease.holderId,
      expiresAt: lease.expiresAt
    }));
  const expiredLeases = runningLeases
    .filter((lease) => lease.providerId === providerId && lease.expired === true)
    .map((lease) => ({
      nodeId: lease.nodeId,
      leaseId: lease.leaseId,
      holderId: lease.holderId,
      expiresAt: lease.expiresAt
    }));

  return {
    activeLeaseCount: activeLeases.length,
    expiredLeaseCount: expiredLeases.length,
    activeLeases: activeLeases.slice(0, 25),
    expiredLeases: expiredLeases.slice(0, 25)
  };
}

function providerDeliveryReadiness(contract) {
  const handoffPolicy = contract.handoffPolicy || normalizeProviderHandoffPolicy(contract);
  const deliveryBlocked = handoffPolicy.requiresHandoffRef && !contract.handoffRef;
  const optionalCapabilities = [];
  if (handoffPolicy.acknowledgementRequired) optionalCapabilities.push('dependency-graph:audit-handoff');
  if (contract.sync?.conflictPolicy === 'manual-review') optionalCapabilities.push('dependency-graph:sync-state');
  const missingOptionalCapabilities = optionalCapabilities
    .filter((capability) => !contract.capabilities.includes(capability));

  return {
    handoffPolicy,
    deliveryBlocked,
    missingOptionalCapabilities,
    reason: deliveryBlocked
      ? `${handoffPolicy.deliveryMode} delivery requires handoffRef`
      : missingOptionalCapabilities.length > 0
        ? `provider can run work but lacks optional ${missingOptionalCapabilities.join(', ')}`
        : 'provider delivery contract is ready'
  };
}

function negotiateProviderCapabilities(state, schedulingPlan, now) {
  const contracts = Array.isArray(state.providerContracts) ? state.providerContracts : [];
  const dispatchable = new Set(Array.isArray(schedulingPlan.dispatchable) ? schedulingPlan.dispatchable : []);
  const frontierByNode = new Map((Array.isArray(schedulingPlan.readyFrontier) ? schedulingPlan.readyFrontier : [])
    .map((entry) => [entry.nodeId, entry]));
  const providers = contracts.map((contract) => {
    const acceptedCapabilities = contract.enabled === false ? [] : contract.capabilities;
    const missingRequiredCapabilities = requiredProviderCapabilities
      .filter((capability) => !acceptedCapabilities.includes(capability));
    const stale = Boolean(contract.sync?.stale);
    const workload = providerWorkloadSummary(contract.providerId, schedulingPlan);
    const delivery = providerDeliveryReadiness(contract);
    const maxInFlight = contract.serviceLevel.maxInFlight;
    const availableInFlight = Math.max(0, maxInFlight - workload.activeLeaseCount);
    const batchCapacity = Math.min(availableInFlight, delivery.handoffPolicy.maxBatchSize);
    const usable = contract.enabled !== false
      && missingRequiredCapabilities.length === 0
      && !stale
      && !delivery.deliveryBlocked
      && availableInFlight > 0;
    const nodeEligibleIds = [...dispatchable]
      .filter((nodeId) => {
        const readiness = frontierByNode.get(nodeId)?.providerReadiness;
        if (!readiness?.claimable) return false;
        if (readiness.handoffRequired) return readiness.selectedProviderId === contract.providerId;
        return usable;
      })
      .sort();
    const nodeClaimCapacity = usable ? Math.min(batchCapacity, nodeEligibleIds.length) : 0;

    return {
      providerId: contract.providerId,
      tenantId: contract.tenantId || null,
      workspaceId: contract.workspaceId || null,
      serviceRef: contract.serviceRef,
      contractVersion: contract.contractVersion,
      mode: contract.mode,
      enabled: contract.enabled,
      usable,
      acceptedCapabilities,
      missingRequiredCapabilities,
      missingOptionalCapabilities: delivery.missingOptionalCapabilities,
      maxInFlight,
      availableInFlight,
      batchCapacity,
      nodeClaimCapacity,
      eligibleNodeIds: nodeEligibleIds.slice(0, batchCapacity),
      workload,
      sync: contract.sync,
      handoffPolicy: delivery.handoffPolicy,
      handoffRef: contract.handoffRef,
      auditRef: contract.auditRef,
      reason: usable
        ? `provider can claim ${batchCapacity} dependency graph node(s)`
        : stale
          ? 'provider sync metadata is stale'
          : missingRequiredCapabilities.length > 0
            ? `provider is missing ${missingRequiredCapabilities.join(', ')}`
            : delivery.deliveryBlocked
              ? delivery.reason
              : availableInFlight <= 0
                ? 'provider has no available in-flight capacity'
                : 'provider contract is disabled'
    };
  });
  const selectedProvider = providers
    .filter((provider) => provider.usable && provider.nodeClaimCapacity > 0)
    .sort((a, b) => b.nodeClaimCapacity - a.nodeClaimCapacity
      || b.batchCapacity - a.batchCapacity
      || b.availableInFlight - a.availableInFlight
      || a.providerId.localeCompare(b.providerId))[0] || null;

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.providerNegotiation.v1',
    requiredCapabilities: requiredProviderCapabilities,
    supportedCapabilities: [...providerContractCapabilities].sort(),
    providerCount: providers.length,
    selectedProviderId: selectedProvider?.providerId || null,
    dispatchCapacity: selectedProvider
      ? selectedProvider.nodeClaimCapacity
      : 0,
    capacity: {
      dispatchableCount: schedulingPlan.dispatchable.length,
      totalAvailableInFlight: providers.reduce((total, provider) => total + provider.availableInFlight, 0),
      totalActiveLeases: providers.reduce((total, provider) => total + provider.workload.activeLeaseCount, 0),
      totalExpiredLeases: providers.reduce((total, provider) => total + provider.workload.expiredLeaseCount, 0)
    },
    providers,
    decision: selectedProvider
      ? 'ready-for-provider-handoff'
      : providers.length > 0
        ? 'no-usable-provider-contract'
        : 'kernel-local-dispatch-only'
  };
}

function boundaryScopeDescriptor(boundary) {
  return {
    scoped: boundary.scoped,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    actorId: boundary.actorId || null,
    canRead: boundary.canRead,
    canWrite: boundary.canWrite,
    canExportHandoff: boundary.canExportHandoff,
    requiredReadPermission: graphReadPermission,
    requiredWritePermission: graphWritePermission,
    requiredHandoffExportPermission: graphHandoffExportPermission
  };
}

function buildBoundaryRejection(reason, nodeId, providerId, boundary, now, details = {}) {
  return {
    eligible: false,
    nodeId,
    providerId: providerId || null,
    reason,
    details,
    boundary: boundaryScopeDescriptor(boundary),
    auditEvent: {
      type: 'scheduler.dependencyGraph.providerClaimBoundaryRejected',
      at: now,
      nodeId,
      providerId: providerId || null,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      reason,
      details
    }
  };
}

function buildHandoffExportBoundaryDecision(state, schedulingPlan, selectedProvider, boundary, now) {
  const dispatchableCount = Array.isArray(schedulingPlan.dispatchable) ? schedulingPlan.dispatchable.length : 0;
  const providerId = selectedProvider?.providerId || null;
  const scope = boundaryScopeDescriptor(boundary);
  const baseDecision = {
    schema: 'scheduler.dependencyGraph.handoffExportBoundary.v1',
    generatedAt: now,
    stateEpoch: state.epoch,
    providerId,
    scope,
    allowed: true,
    reason: null,
    candidateVisibility: 'full',
    dispatchableCount,
    requiredPermissions: [graphReadPermission, graphHandoffExportPermission],
    auditEvent: null
  };
  const denied = (reason, candidateVisibility, details = {}) => ({
    ...baseDecision,
    allowed: false,
    reason,
    candidateVisibility,
    details,
    auditEvent: {
      type: 'scheduler.dependencyGraph.providerHandoffExportDenied',
      at: now,
      providerId,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      actorId: boundary.actorId || null,
      reason,
      dispatchableCount,
      details
    }
  });

  if (!boundary.canRead) {
    return denied(boundary.deniedReason || 'read permission required before provider handoff export', 'none');
  }
  if (!boundary.canExportHandoff) {
    return denied(
      boundary.handoffDeniedReason || 'handoff export permission required before provider claim preparation',
      'count-only',
      {
        canWrite: boundary.canWrite,
        requiredExportPermission: graphHandoffExportPermission
      }
    );
  }
  if (selectedProvider && !recordMatchesBoundary(selectedProvider, boundary)) {
    return denied('selected provider contract is outside the active tenant/workspace handoff scope', 'none', {
      providerTenantId: selectedProvider.tenantId || null,
      providerWorkspaceId: selectedProvider.workspaceId || null
    });
  }

  return baseDecision;
}

function validateProviderClaimBoundary(state, nodeId, selectedProvider, boundary, now) {
  const providerId = selectedProvider?.providerId;
  const node = state.nodes[nodeId];
  if (!node) {
    return buildBoundaryRejection('node-missing-from-scoped-state', nodeId, providerId, boundary, now);
  }
  if (!recordMatchesBoundary(node, boundary)) {
    return buildBoundaryRejection('node-outside-active-tenant-workspace', nodeId, providerId, boundary, now, {
      nodeTenantId: node.tenantId || null,
      nodeWorkspaceId: node.workspaceId || null
    });
  }
  if (!selectedProvider || !recordMatchesBoundary(selectedProvider, boundary)) {
    return buildBoundaryRejection('provider-contract-outside-active-tenant-workspace', nodeId, providerId, boundary, now, {
      providerTenantId: selectedProvider?.tenantId || null,
      providerWorkspaceId: selectedProvider?.workspaceId || null
    });
  }
  if (!boundary.canExportHandoff) {
    return buildBoundaryRejection('actor-cannot-export-provider-claim', nodeId, providerId, boundary, now, {
      requiredExportPermission: graphHandoffExportPermission,
      canWrite: boundary.canWrite
    });
  }
  if (node.status !== 'ready') {
    return buildBoundaryRejection('node-is-not-ready-for-provider-claim', nodeId, providerId, boundary, now, {
      status: node.status
    });
  }
  if (node.enabled === false) {
    return buildBoundaryRejection('node-disabled-for-provider-claim', nodeId, providerId, boundary, now, {
      disabledReason: node.disabledReason || null,
      disabledUntil: node.disabledUntil || null
    });
  }
  const unmetDependencies = node.dependsOn.filter((dependencyId) => state.nodes[dependencyId]?.status !== 'succeeded');
  if (unmetDependencies.length > 0) {
    return buildBoundaryRejection('node-has-unmet-scoped-dependencies', nodeId, providerId, boundary, now, {
      unmetDependencies
    });
  }
  const providerReadiness = providerReadinessForNode(state, node, now);
  if (!providerReadiness.claimable || (providerReadiness.handoffRequired && providerReadiness.selectedProviderId !== providerId)) {
    return buildBoundaryRejection('provider-contract-does-not-satisfy-node-requirements', nodeId, providerId, boundary, now, {
      requiredCapabilities: providerReadiness.requiredCapabilities,
      requiredProviderId: providerReadiness.providerId || null,
      selectedProviderId: providerReadiness.selectedProviderId,
      blockers: providerReadiness.blockers
    });
  }
  return {
    eligible: true,
    nodeId,
    providerId,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    proof: {
      schema: 'scheduler.dependencyGraph.boundaryClaimProof.v1',
      nodeId,
      providerId,
      stateEpoch: state.epoch,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      nodeStatus: node.status,
      dependencyCount: node.dependsOn.length,
      providerReadiness,
      checkedAt: now
    }
  };
}

function buildProviderClaimEnvelope(state, nodeId, selectedProvider, boundary, now) {
  const node = state.nodes[nodeId];
  const providerReadiness = node ? providerReadinessForNode(state, node, now) : null;
  const handoffId = `${state.epoch}:${selectedProvider.providerId}:${nodeId}`;
  const commandId = `handoff:${handoffId}:claim`;
  const leaseId = `lease:${handoffId}`;
  const handoffPolicy = selectedProvider.handoffPolicy || normalizeProviderHandoffPolicy(selectedProvider);
  const leaseTtlMs = Math.min(
    selectedProvider.sync?.staleAfterMs || handoffPolicy.receiptTtlMs || defaultExecutionLeaseTtlMs,
    defaultExecutionLeaseTtlMs
  );
  const tenantId = boundary.tenantId || undefined;
  const workspaceId = boundary.workspaceId || undefined;

  return {
    handoffId,
    nodeId,
    providerId: selectedProvider.providerId,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    claimCommand: {
      commandId,
      type: 'mark-running',
      nodeId,
      providerId: selectedProvider.providerId,
      holderId: selectedProvider.providerId,
      leaseId,
      leaseTtlMs,
      tenantId,
      workspaceId
    },
    completionCommands: {
      success: {
        type: 'mark-succeeded',
        nodeId,
        providerId: selectedProvider.providerId,
        requiresResultRef: state.settings.requireResultRefOnSuccess === true,
        requiredFields: state.settings.requireResultRefOnSuccess === true ? ['commandId', 'resultRef'] : ['commandId']
      },
      failure: {
        type: 'mark-failed',
        nodeId,
        providerId: selectedProvider.providerId,
        fields: ['commandId', 'failure', 'errorCode', 'failureAction', 'retryAfterMs']
      }
    },
    lease: {
      leaseId,
      ttlMs: leaseTtlMs,
      expiresAt: addMilliseconds(now, leaseTtlMs),
      epoch: state.epoch
    },
    delivery: {
      mode: handoffPolicy.deliveryMode,
      acknowledgementRequired: handoffPolicy.acknowledgementRequired,
      receiptTtlMs: handoffPolicy.receiptTtlMs,
      receiptDueAt: addMilliseconds(now, handoffPolicy.receiptTtlMs),
      handoffRef: selectedProvider.handoffRef || null,
      auditRef: selectedProvider.auditRef || boundary.auditSinkRef || null
    },
    proof: {
      schema: 'scheduler.dependencyGraph.handoffProof.v1',
      requiredForClaim: ['handoffId', 'commandId', 'leaseId', 'providerId', 'nodeId'],
      requiredForCompletion: state.settings.requireResultRefOnSuccess === true
        ? ['handoffId', 'commandId', 'nodeId', 'status', 'resultRef']
        : ['handoffId', 'commandId', 'nodeId', 'status'],
      idempotencyKey: commandId,
      deliveryMode: handoffPolicy.deliveryMode,
      acknowledgementRequired: handoffPolicy.acknowledgementRequired,
      receiptDueAt: addMilliseconds(now, handoffPolicy.receiptTtlMs),
      providerRequirements: providerReadiness
        ? {
          handoffRequired: providerReadiness.handoffRequired,
          requiredCapabilities: providerReadiness.requiredCapabilities,
          selectedProviderId: providerReadiness.selectedProviderId,
          syncCursor: providerReadiness.syncCursor
        }
        : null
    },
    auditEvent: {
      type: 'scheduler.dependencyGraph.providerClaimPrepared',
      at: now,
      handoffId,
      commandId,
      nodeId,
      providerId: selectedProvider.providerId,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      stateEpoch: state.epoch,
      deliveryMode: handoffPolicy.deliveryMode,
      acknowledgementRequired: handoffPolicy.acknowledgementRequired
    },
    handoffRef: selectedProvider.handoffRef,
    auditRef: selectedProvider.auditRef || boundary.auditSinkRef || null
  };
}

function buildExternalHandoffState(state, schedulingPlan, negotiation, boundary, now) {
  const selectedProvider = negotiation.providers.find((provider) => provider.providerId === negotiation.selectedProviderId) || null;
  const handoffExportBoundary = buildHandoffExportBoundaryDecision(state, schedulingPlan, selectedProvider, boundary, now);
  const providerEligibleNodes = selectedProvider
    ? selectedProvider.eligibleNodeIds.filter((nodeId) => schedulingPlan.dispatchable.includes(nodeId))
    : [];
  const candidateNodes = handoffExportBoundary.allowed && selectedProvider
    ? providerEligibleNodes.slice(0, negotiation.dispatchCapacity)
    : [];
  const boundaryDecisions = handoffExportBoundary.allowed && selectedProvider
    ? candidateNodes.map((nodeId) => validateProviderClaimBoundary(state, nodeId, selectedProvider, boundary, now))
    : [];
  const claimableNodes = boundaryDecisions
    .filter((decision) => decision.eligible)
    .map((decision) => decision.nodeId);
  const rejectedClaims = [
    ...boundaryDecisions.filter((decision) => !decision.eligible),
    ...(!handoffExportBoundary.allowed && handoffExportBoundary.reason
      ? [{
        eligible: false,
        nodeId: null,
        providerId: selectedProvider?.providerId || null,
        reason: handoffExportBoundary.reason,
        details: {
          candidateVisibility: handoffExportBoundary.candidateVisibility,
          dispatchableCount: handoffExportBoundary.dispatchableCount,
          requiredExportPermission: graphHandoffExportPermission
        },
        auditEvent: handoffExportBoundary.auditEvent
      }]
      : [])
  ];
  const handoffItems = selectedProvider
    ? claimableNodes.map((nodeId) => buildProviderClaimEnvelope(state, nodeId, selectedProvider, boundary, now))
    : [];
  const boundaryManifest = {
    schema: 'scheduler.dependencyGraph.handoffBoundaryManifest.v1',
    generatedAt: now,
    stateEpoch: state.epoch,
    providerId: selectedProvider?.providerId || null,
    scope: boundaryScopeDescriptor(boundary),
    handoffExportBoundary,
    candidateNodeCount: handoffExportBoundary.allowed ? candidateNodes.length : handoffExportBoundary.dispatchableCount,
    candidateVisibility: handoffExportBoundary.candidateVisibility,
    eligibleNodeCount: claimableNodes.length,
    rejectedNodeCount: rejectedClaims.length,
    eligibleProofs: boundaryDecisions
      .filter((decision) => decision.eligible)
      .map((decision) => decision.proof),
    rejectedClaims: rejectedClaims.map((decision) => ({
      nodeId: decision.nodeId,
      providerId: decision.providerId,
      reason: decision.reason,
      details: decision.details
    })),
    auditEvents: rejectedClaims
      .map((decision) => decision.auditEvent)
      .filter(Boolean)
  };
  const dispatchManifest = {
    schema: 'scheduler.dependencyGraph.providerDispatchManifest.v1',
    manifestId: `${state.epoch}:${selectedProvider?.providerId || 'local'}:${claimableNodes.join(',') || 'empty'}`,
    generatedAt: now,
    providerId: selectedProvider?.providerId || null,
    stateEpoch: state.epoch,
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    claimableNodeCount: claimableNodes.length,
    rejectedNodeCount: rejectedClaims.length,
    deliveryMode: selectedProvider?.handoffPolicy?.deliveryMode || null,
    acknowledgementRequired: selectedProvider?.handoffPolicy?.acknowledgementRequired === true,
    providerCapacity: selectedProvider
      ? {
        maxInFlight: selectedProvider.maxInFlight,
        availableInFlight: selectedProvider.availableInFlight,
        batchCapacity: selectedProvider.batchCapacity,
        activeLeaseCount: selectedProvider.workload.activeLeaseCount
      }
      : null,
    commandIds: handoffItems.map((item) => item.claimCommand.commandId),
    leaseIds: handoffItems.map((item) => item.lease.leaseId),
    receiptDueAt: handoffItems
      .map((item) => item.delivery.receiptDueAt)
      .sort()[0] || null,
    proofSchema: 'scheduler.dependencyGraph.handoffProof.v1',
    boundaryProofSchema: boundaryManifest.schema,
    boundaryProofs: boundaryManifest.eligibleProofs,
    auditEvents: [
      ...handoffItems.map((item) => item.auditEvent),
      ...boundaryManifest.auditEvents
    ]
  };

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.externalHandoff.v1',
    state: claimableNodes.length > 0
      ? 'handoff-ready'
      : !handoffExportBoundary.allowed && handoffExportBoundary.reason
        ? 'export-boundary-blocked'
      : rejectedClaims.length > 0
        ? 'boundary-blocked'
      : schedulingPlan.dispatchable.length > 0
        ? 'awaiting-provider-contract'
        : 'nothing-to-handoff',
    providerId: selectedProvider?.providerId || null,
    handoffRef: selectedProvider?.handoffRef || null,
    claimableNodes,
    candidateNodes,
    handoffExportBoundary,
    rejectedClaims: boundaryManifest.rejectedClaims,
    items: handoffItems,
    dispatchManifest,
    boundaryManifest,
    sync: selectedProvider?.sync || null,
    delivery: selectedProvider
      ? {
        policy: selectedProvider.handoffPolicy,
        mode: selectedProvider.handoffPolicy.deliveryMode,
        acknowledgementRequired: selectedProvider.handoffPolicy.acknowledgementRequired,
        receiptTtlMs: selectedProvider.handoffPolicy.receiptTtlMs,
        receiptDueAt: dispatchManifest.receiptDueAt,
        handoffRef: selectedProvider.handoffRef || null,
        auditRef: selectedProvider.auditRef || boundary.auditSinkRef || null
      }
      : null,
    nextAction: claimableNodes.length > 0
      ? `send ${claimableNodes.length} claimable node(s) to ${selectedProvider.providerId}`
      : !handoffExportBoundary.allowed && handoffExportBoundary.reason
        ? handoffExportBoundary.reason
      : rejectedClaims.length > 0
        ? 'resolve tenant/workspace or write-permission boundary rejection before provider handoff'
      : negotiation.decision === 'no-usable-provider-contract'
        ? 'refresh provider sync metadata or supply required scheduler provider capabilities'
        : schedulingPlan.nextAction
  };
}

function normalizeClientRuntimeContext(input, boundary, now) {
  const request = cloneRecord(input.request);
  const client = cloneRecord(input.client || input.clientRuntime || input.clientState);
  const workflow = cloneRecord(input.workflow || request.workflow || client.workflow);
  const mode = firstString(client.handoffMode, request.handoffMode, workflow.handoffMode);
  const requestedNodeIds = uniqueStringList(
    request.nodeIds,
    request.requestedNodeIds,
    client.nodeIds,
    client.requestedNodeIds,
    input.requestedNodeIds
  );
  const acknowledgedHandoffIds = uniqueStringList(
    client.acknowledgedHandoffIds,
    client.receivedHandoffIds,
    request.acknowledgedHandoffIds
  );
  const handoffAcknowledgements = normalizeHandoffAcknowledgements(
    [
      client.handoffAcknowledgements,
      client.handoffReceipts,
      client.providerHandoffReceipts,
      request.handoffAcknowledgements,
      request.handoffReceipts,
      workflow.handoffAcknowledgements,
      workflow.handoffReceipts,
      acknowledgedHandoffIds.map((handoffId) => ({ handoffId, status: 'accepted', source: 'legacy-acknowledgedHandoffIds' }))
    ],
    boundary,
    now
  );

  return {
    schema: 'scheduler.dependencyGraph.clientRuntime.v1',
    requestId: firstString(request.requestId, client.requestId, input.requestId) || null,
    sessionId: firstString(client.sessionId, request.sessionId, input.sessionId) || null,
    workflowId: firstString(workflow.workflowId, workflow.id, request.workflowId, client.workflowId) || null,
    routeRef: firstString(request.routeRef, client.routeRef, workflow.routeRef) || null,
    deliveryMode: ['inline', 'provider-handoff', 'client-poll', 'audit-only'].includes(mode) ? mode : 'inline',
    requestedNodeIds,
    acknowledgedHandoffIds: handoffAcknowledgements
      .filter((acknowledgement) => acknowledgement.acknowledged)
      .map((acknowledgement) => acknowledgement.handoffId),
    handoffAcknowledgements,
    clientCursor: firstString(client.cursor, client.stateCursor, request.cursor) || null,
    observedAt: asIsoTimestamp(client.observedAt || request.observedAt || now),
    tenantId: boundary.tenantId || null,
    workspaceId: boundary.workspaceId || null,
    actorId: boundary.actorId || null
  };
}

function normalizeHandoffAcknowledgements(sources, boundary, now) {
  const entries = sources.flatMap((source) => {
    if (Array.isArray(source)) return source;
    return source && typeof source === 'object' ? Object.values(source) : [];
  });
  const acknowledgements = {};

  for (const rawEntry of entries) {
    const entry = typeof rawEntry === 'string' ? { handoffId: rawEntry } : cloneRecord(rawEntry);
    const handoffId = firstString(entry.handoffId, entry.id, entry.receiptId);
    if (!handoffId || !recordMatchesBoundary(entry, boundary)) continue;
    const status = handoffReceiptStatuses.has(entry.status) ? entry.status : 'accepted';
    const previous = acknowledgements[handoffId] || {};
    acknowledgements[handoffId] = {
      handoffId,
      nodeId: firstString(entry.nodeId, previous.nodeId) || null,
      providerId: firstString(entry.providerId, previous.providerId) || null,
      commandId: firstString(entry.commandId, entry.claimCommandId, previous.commandId) || null,
      status,
      acknowledged: ['delivered', 'accepted'].includes(status),
      receiptRef: firstString(entry.receiptRef, entry.auditRef, previous.receiptRef) || null,
      source: firstString(entry.source, previous.source) || 'client-runtime',
      receivedAt: asIsoTimestamp(entry.receivedAt || entry.acknowledgedAt || entry.observedAt || previous.receivedAt || now),
      errorCode: status === 'rejected' || status === 'failed'
        ? firstString(entry.errorCode, previous.errorCode, 'handoff-receipt-rejected')
        : null,
      message: firstString(entry.message, entry.reason, previous.message) || null,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null
    };
  }

  return Object.values(acknowledgements).sort((a, b) => a.handoffId.localeCompare(b.handoffId));
}

function workflowQueueCommandForNode(node, handoffItem, schedulingPlan, boundary, state) {
  const nodeId = firstString(node.id, node.nodeId);
  if (!nodeId) return null;
  if (!boundary.canWrite) return null;
  if (handoffItem) return handoffItem.claimCommand;
  if (schedulingPlan.dispatchable.includes(nodeId)) {
    return commandTemplate('mark-running', nodeId, boundary);
  }
  if (node.status === 'failed' && retryWindowOpen(node, schedulingPlan.generatedAt)) {
    return commandTemplate('retry-node', nodeId, boundary);
  }
  if (node.enabled === false && node.status !== 'skipped') {
    return commandTemplate('enable-node', nodeId, boundary);
  }
  if (node.status === 'running') {
    return commandTemplate('mark-succeeded', nodeId, boundary, {
      resultRef: state.settings.requireResultRefOnSuccess ? '<required-result-ref>' : undefined
    });
  }
  return null;
}

function buildClientWorkflowQueue(state, visibleNodes, schedulingPlan, externalHandoff, clientRuntime, boundary, now) {
  const requested = new Set(clientRuntime.requestedNodeIds);
  const dispatchable = new Set(schedulingPlan.dispatchable);
  const readyCandidates = new Set(schedulingPlan.readyCandidates);
  const handoffByNode = new Map(externalHandoff.items.map((item) => [item.nodeId, item]));
  const acceptedHandoffIds = new Set(clientRuntime.acknowledgedHandoffIds);
  const receiptFailures = new Map(clientRuntime.handoffAcknowledgements
    .filter((acknowledgement) => ['rejected', 'failed'].includes(acknowledgement.status))
    .map((acknowledgement) => [acknowledgement.handoffId, acknowledgement]));
  const graphBlocked = new Map((schedulingPlan.graphBlocked || [])
    .map((entry) => [entry.nodeId, Array.isArray(entry.blockers) ? entry.blockers : []]));
  const queueEntries = visibleNodes.map((node) => {
    const handoffItem = handoffByNode.get(node.nodeId) || null;
    const sourceNode = state.nodes[node.nodeId] || node;
    const handoffId = handoffItem?.handoffId || null;
    const receiptFailure = handoffId ? receiptFailures.get(handoffId) || null : null;
    const blockers = graphBlocked.get(node.nodeId) || [];
    const command = workflowQueueCommandForNode(sourceNode, handoffItem, schedulingPlan, boundary, state);
    const readyForProvider = Boolean(handoffItem && !acceptedHandoffIds.has(handoffId) && !receiptFailure);
    const readyForLocalRun = dispatchable.has(node.nodeId) && !handoffItem;
    const blockedByReceipt = Boolean(receiptFailure);
    const waitingForRunning = sourceNode.status === 'running';
    const stateLabel = readyForProvider
      ? 'provider-handoff-ready'
      : readyForLocalRun
        ? 'local-dispatch-ready'
        : blockedByReceipt
          ? 'handoff-receipt-blocked'
          : blockers.some((blocker) => blocker.severity === 'error')
            ? 'blocked'
            : waitingForRunning
              ? 'running'
              : terminalStatuses.has(sourceNode.status)
                ? 'complete'
                : readyCandidates.has(node.nodeId)
                  ? 'ready-waiting'
                  : 'waiting';
    const primaryBlocker = blockers[0] || null;

    return {
      nodeId: node.nodeId,
      requested: requested.has(node.nodeId),
      state: stateLabel,
      status: sourceNode.status,
      priority: readyForProvider || readyForLocalRun ? 'high' : blockedByReceipt || primaryBlocker?.severity === 'error' ? 'blocked' : 'normal',
      handoffId,
      providerId: handoffItem?.providerId || null,
      command,
      commandAvailable: Boolean(command),
      blockedBy: receiptFailure
        ? [{
          code: 'handoff-receipt-failed',
          severity: 'error',
          handoffId: receiptFailure.handoffId,
          status: receiptFailure.status,
          message: receiptFailure.message || receiptFailure.errorCode || 'provider handoff receipt failed',
          action: 'resolve the provider receipt failure and refresh the workflow handoff preview'
        }]
        : blockers.slice(0, 5).map((blocker) => ({
          code: blocker.code,
          severity: blocker.severity,
          dependencyId: blocker.dependencyId || null,
          message: blocker.message,
          action: blocker.action || null
        })),
      nextAction: readyForProvider
        ? `send claim command for ${node.nodeId} to provider ${handoffItem.providerId}`
        : readyForLocalRun
          ? `submit mark-running for ${node.nodeId}`
          : receiptFailure
            ? 'request a fresh handoff after provider receipt remediation'
            : command
              ? `submit ${command.type}${command.nodeId ? ` for ${command.nodeId}` : ''}`
              : primaryBlocker?.action || schedulingPlan.nextAction || null
    };
  });
  const actionable = queueEntries.filter((entry) => entry.commandAvailable && ['high', 'normal'].includes(entry.priority));
  const blocked = queueEntries.filter((entry) => entry.blockedBy.length > 0 || entry.priority === 'blocked');

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.clientWorkflowQueue.v1',
    state: actionable.length > 0
      ? 'actionable'
      : blocked.length > 0
        ? 'blocked'
        : queueEntries.some((entry) => entry.state === 'running')
          ? 'in-progress'
          : 'waiting',
    cursor: clientRuntime.clientCursor || null,
    currentCursor: [
      state.epoch,
      schedulingPlan.dispatchable.join(','),
      externalHandoff.dispatchManifest.manifestId,
      queueEntries.map((entry) => `${entry.nodeId}:${entry.state}`).join(',')
    ].join('|'),
    requestedNodeIds: clientRuntime.requestedNodeIds,
    actionableCount: actionable.length,
    blockedCount: blocked.length,
    entries: queueEntries,
    nextCommand: actionable[0]?.command || null,
    nextAction: actionable[0]?.nextAction || blocked[0]?.nextAction || schedulingPlan.nextAction || externalHandoff.nextAction || null
  };
}

function buildClientWorkflowHandoff(state, nodes, schedulingPlan, externalHandoff, boundary, input, now, commandReceipt = null) {
  const clientRuntime = normalizeClientRuntimeContext(input, boundary, now);
  const requested = new Set(clientRuntime.requestedNodeIds);
  const acknowledgementsById = new Map(clientRuntime.handoffAcknowledgements.map((acknowledgement) => [acknowledgement.handoffId, acknowledgement]));
  const acknowledged = new Set(clientRuntime.acknowledgedHandoffIds);
  const actionableReceiptStatuses = new Set(['sent', 'rejected', 'failed']);
  const candidateIds = new Set([
    ...clientRuntime.requestedNodeIds,
    ...schedulingPlan.dispatchable,
    ...schedulingPlan.readyCandidates,
    ...schedulingPlan.running,
    ...externalHandoff.claimableNodes
  ]);
  const visibleNodes = nodes
    .filter((node) => candidateIds.size === 0 || candidateIds.has(node.id))
    .slice(0, 50)
    .map((node) => {
      const handoffItem = externalHandoff.items.find((item) => item.nodeId === node.id) || null;
      const handoffId = handoffItem?.handoffId || null;
      return {
        nodeId: node.id,
        status: node.status,
        enabled: node.enabled,
        requested: requested.has(node.id),
        dependsOn: node.dependsOn,
        resultRef: node.resultRef || null,
        failure: node.failure || null,
        retryAfter: node.retryAfter || null,
        executionLease: node.executionLease
          ? {
            leaseId: node.executionLease.leaseId,
            providerId: node.executionLease.providerId,
            holderId: node.executionLease.holderId,
            expiresAt: node.executionLease.expiresAt,
            expired: leaseExpired(node.executionLease, now)
          }
          : null,
        handoff: handoffItem
          ? {
            handoffId,
            providerId: handoffItem.providerId,
            handoffRef: handoffItem.handoffRef || null,
            auditRef: handoffItem.auditRef || null,
            delivery: handoffItem.delivery,
            acknowledged: acknowledged.has(handoffId),
            acknowledgement: acknowledgementsById.get(handoffId) || null,
            claimCommand: handoffItem.claimCommand,
            completionCommands: handoffItem.completionCommands,
            lease: handoffItem.lease,
            proof: handoffItem.proof
          }
          : null
      };
    });
  const claimCommands = visibleNodes
    .filter((node) => node.handoff && !node.handoff.acknowledged)
    .map((node) => node.handoff.claimCommand);
  const visibleHandoffIds = new Set(visibleNodes
    .map((node) => node.handoff?.handoffId)
    .filter((handoffId) => typeof handoffId === 'string'));
  const actionableReceipts = clientRuntime.handoffAcknowledgements
    .filter((acknowledgement) => actionableReceiptStatuses.has(acknowledgement.status))
    .map((acknowledgement) => ({
      handoffId: acknowledgement.handoffId,
      nodeId: acknowledgement.nodeId,
      providerId: acknowledgement.providerId,
      status: acknowledgement.status,
      commandId: acknowledgement.commandId,
      errorCode: acknowledgement.errorCode,
      message: acknowledgement.message,
      action: acknowledgement.status === 'sent'
        ? 'wait for provider delivery confirmation or resend the claim command if the client cursor advances'
        : 'inspect the provider receipt, remediate the handoff failure, and request a fresh claim command'
    }));
  const unknownAcknowledgements = clientRuntime.handoffAcknowledgements
    .filter((acknowledgement) => !visibleHandoffIds.has(acknowledgement.handoffId))
    .map((acknowledgement) => ({
      handoffId: acknowledgement.handoffId,
      status: acknowledgement.status,
      receivedAt: acknowledgement.receivedAt,
      reason: 'receipt does not match a currently visible handoff in this scoped workflow response'
    }));
  const localDispatchCommands = boundary.canWrite && externalHandoff.providerId === null
    ? schedulingPlan.dispatchable.map((nodeId) => ({
      type: 'mark-running',
      nodeId,
      tenantId: boundary.tenantId || undefined,
      workspaceId: boundary.workspaceId || undefined
    }))
    : [];
  const stateCursor = [
    state.epoch,
    schedulingPlan.dispatchable.join(','),
    schedulingPlan.running.join(','),
    externalHandoff.state
  ].join('|');
  const status = !boundary.canRead
    ? 'read-denied'
    : claimCommands.length > 0
      ? 'provider-handoff-ready'
      : localDispatchCommands.length > 0
        ? 'client-dispatch-ready'
        : schedulingPlan.nextAction
          ? 'waiting-on-workflow'
          : 'settled';
  const workflowQueue = buildClientWorkflowQueue(
    state,
    visibleNodes,
    schedulingPlan,
    externalHandoff,
    clientRuntime,
    boundary,
    now
  );

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.clientWorkflowHandoff.v1',
    status,
    clientRuntime,
    statePatch: {
      cursor: stateCursor,
      epoch: state.epoch,
      providerId: externalHandoff.providerId,
      handoffState: externalHandoff.state,
      readyQueue: schedulingPlan.readyCandidates,
      dispatchable: schedulingPlan.dispatchable,
      visibleNodeCount: visibleNodes.length,
      workflowQueueState: workflowQueue.state,
      workflowQueueCursor: workflowQueue.currentCursor,
      nextWorkflowNodeId: workflowQueue.entries.find((entry) => entry.commandAvailable)?.nodeId || null
    },
    visibleNodes,
    workflowQueue,
    actions: {
      canMutate: boundary.canWrite,
      claimCommands,
      localDispatchCommands,
      acknowledgementRequired: claimCommands.length > 0,
      acknowledgementContract: {
        schema: 'scheduler.dependencyGraph.handoffAcknowledgement.v1',
        requiredFields: ['handoffId', 'status', 'receivedAt'],
        allowedStatuses: [...handoffReceiptStatuses],
        terminalStatuses: ['accepted', 'rejected', 'failed']
      },
      acknowledgementSummary: {
        total: clientRuntime.handoffAcknowledgements.length,
        accepted: clientRuntime.handoffAcknowledgements.filter((acknowledgement) => acknowledgement.status === 'accepted').length,
        delivered: clientRuntime.handoffAcknowledgements.filter((acknowledgement) => acknowledgement.status === 'delivered').length,
        pending: clientRuntime.handoffAcknowledgements.filter((acknowledgement) => acknowledgement.status === 'sent').length,
        rejected: clientRuntime.handoffAcknowledgements.filter((acknowledgement) => acknowledgement.status === 'rejected').length,
        failed: clientRuntime.handoffAcknowledgements.filter((acknowledgement) => acknowledgement.status === 'failed').length,
        unknown: unknownAcknowledgements.length
      },
      actionableReceipts,
      unknownAcknowledgements,
      dispatchManifest: externalHandoff.dispatchManifest,
      boundaryManifest: externalHandoff.boundaryManifest,
      lifecycleCommandReceipt: commandReceipt,
      acknowledgeHandoffIds: visibleNodes
        .map((node) => node.handoff?.handoffId)
        .filter((handoffId) => typeof handoffId === 'string' && !acknowledged.has(handoffId))
    },
    nextAction: status === 'provider-handoff-ready'
      ? `persist handoff ids and send ${claimCommands.length} claim command(s) to provider ${externalHandoff.providerId}`
      : actionableReceipts.length > 0
        ? actionableReceipts[0].action
      : status === 'client-dispatch-ready'
        ? `submit ${localDispatchCommands.length} mark-running command(s) from the client workflow`
        : workflowQueue.nextAction || commandReceipt?.nextAction || externalHandoff.nextAction || schedulingPlan.nextAction
  };
}

function buildPreviewAcceptanceContract(state, nodes, health, schedulingPlan, providerNegotiation, externalHandoff, clientWorkflowHandoff, boundary, commandResult, now, commandReceipt = null) {
  const issueEntries = [
    ...health.issues.map((issue) => ({
      severity: issue.severity || 'info',
      code: issue.code || 'scheduler-issue',
      message: issue.message || issue.reason || issue.action || 'scheduler dependency graph requires attention',
      nodeId: issue.nodeId || null,
      action: issue.action || null
    })),
    ...externalHandoff.rejectedClaims.map((claim) => ({
      severity: 'error',
      code: 'handoff-claim-rejected',
      message: claim.reason,
      nodeId: claim.nodeId,
      action: 'resolve provider claim boundary rejection before accepting handoff'
    })),
    ...(providerNegotiation.decision === 'no-usable-provider-contract'
      ? [{
        severity: 'warning',
        code: 'provider-contract-not-usable',
        message: 'no provider contract currently satisfies dependency graph handoff requirements',
        nodeId: null,
        action: 'refresh provider sync metadata or register required provider capabilities'
      }]
      : [])
  ];
  const validationSummary = {
    schema: 'scheduler.dependencyGraph.validationSummary.v1',
    valid: !commandResult.error && !issueEntries.some((issue) => issue.severity === 'error'),
    errorCount: issueEntries.filter((issue) => issue.severity === 'error').length,
    warningCount: issueEntries.filter((issue) => issue.severity === 'warning').length,
    infoCount: issueEntries.filter((issue) => issue.severity === 'info').length,
    commandAccepted: commandResult.applied === true,
    commandIdempotent: commandResult.idempotent === true,
    commandRejectedReason: commandResult.error || null,
    lifecycleCommandReceipt: commandReceipt,
    issues: issueEntries.slice(0, 25)
  };
  const nodePreview = nodes.slice(0, 50).map((node) => {
    const isDispatchable = schedulingPlan.dispatchable.includes(node.id);
    const handoffItem = externalHandoff.items.find((item) => item.nodeId === node.id) || null;
    const failure = health.failures.find((entry) => entry.nodeId === node.id) || null;
    const blockers = [
      ...node.dependsOn.filter((dependencyId) => state.nodes[dependencyId]?.status !== 'succeeded')
        .map((dependencyId) => ({ code: 'dependency-not-succeeded', dependencyId })),
      ...(node.enabled === false ? [{ code: 'node-disabled', reason: node.disabledReason || 'disabled' }] : []),
      ...(failure ? [{ code: failure.retryable ? 'failure-retryable' : 'failure-blocking', errorCode: failure.errorCode }] : [])
    ];
    return {
      nodeId: node.id,
      status: node.status,
      readiness: isDispatchable
        ? 'dispatchable'
        : handoffItem
          ? 'provider-handoff-ready'
          : blockers.length > 0
            ? 'blocked'
            : terminalStatuses.has(node.status)
              ? 'complete'
              : 'waiting',
      acceptedForHandoff: Boolean(handoffItem),
      providerId: handoffItem?.providerId || null,
      blockers,
      nextStep: handoffItem
        ? `accept handoff ${handoffItem.handoffId} and submit ${handoffItem.claimCommand.commandId}`
        : isDispatchable
          ? `submit mark-running for ${node.id}`
          : failure?.action || blockers[0]?.code || null
    };
  });
  const nextSteps = [
    ...externalHandoff.items.map((item) => ({
      priority: 'high',
      type: 'accept-provider-handoff',
      nodeId: item.nodeId,
      providerId: item.providerId,
      command: item.claimCommand,
      proof: item.proof,
      label: `Accept provider handoff for ${item.nodeId}`
    })),
    ...clientWorkflowHandoff.actions.localDispatchCommands.map((command) => ({
      priority: 'high',
      type: 'run-locally',
      nodeId: command.nodeId,
      command,
      label: `Run ${command.nodeId} locally`
    })),
    ...health.failures.filter((failure) => failure.retryable).map((failure) => ({
      priority: 'medium',
      type: 'retry-failed-node',
      nodeId: failure.nodeId,
      command: { type: 'retry-node', nodeId: failure.nodeId, tenantId: boundary.tenantId || undefined, workspaceId: boundary.workspaceId || undefined },
      label: `Retry ${failure.nodeId}`
    }))
  ].slice(0, 25);

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.previewAcceptance.v1',
    acceptance: {
      state: commandResult.error ? 'rejected' : commandResult.applied ? 'accepted' : commandResult.idempotent ? 'already-accepted' : 'preview-only',
      accepted: commandResult.applied === true || commandResult.idempotent === true,
      canAcceptNextStep: boundary.canWrite && nextSteps.length > 0 && validationSummary.errorCount === 0,
      readOnly: !boundary.canWrite,
      reason: commandResult.error || commandResult.reason || null
    },
    readiness: {
      state: nextSteps.length > 0
        ? 'actionable'
        : validationSummary.errorCount > 0
          ? 'blocked'
          : schedulingPlan.running.length > 0
            ? 'in-progress'
            : 'settled',
      providerReady: externalHandoff.state === 'handoff-ready',
      localReady: clientWorkflowHandoff.status === 'client-dispatch-ready',
      dispatchableCount: schedulingPlan.dispatchable.length,
      claimableCount: externalHandoff.claimableNodes.length,
      runningCount: schedulingPlan.running.length
    },
    validationSummary,
    preview: {
      cursor: clientWorkflowHandoff.statePatch.cursor,
      providerDecision: providerNegotiation.decision,
      handoffState: externalHandoff.state,
      visibleNodeCount: nodePreview.length,
      nodes: nodePreview
    },
    nextSteps
  };
}

function nextStepCommandShape(step) {
  const command = cloneRecord(step.command);
  const requiredFields = ['type'];
  if (typeof command.nodeId === 'string') requiredFields.push('nodeId');
  if (typeof command.commandId === 'string') requiredFields.push('commandId');
  if (step.type === 'accept-provider-handoff') requiredFields.push('providerId', 'leaseId');
  if (step.type === 'retry-failed-node') requiredFields.push('nodeId');
  return {
    type: step.type,
    label: step.label,
    nodeId: step.nodeId || command.nodeId || null,
    providerId: step.providerId || command.providerId || null,
    requiredFields: [...new Set(requiredFields)],
    command,
    proof: step.proof || null
  };
}

function buildRouteAcceptanceDecisionMatrix(previewAcceptance, clientWorkflowHandoff, externalHandoff, operationalErrors, readinessGates, nextStepContracts, boundary, now) {
  const failedGates = readinessGates
    .filter((gate) => !gate.passed)
    .map((gate) => ({
      gate: gate.gate,
      reason: gate.reason || 'acceptance gate did not pass'
    }));
  const pendingAcknowledgements = clientWorkflowHandoff.actions.acknowledgeHandoffIds || [];
  const acceptedReceipts = new Set(
    clientWorkflowHandoff.clientRuntime.handoffAcknowledgements
      .filter((acknowledgement) => acknowledgement.status === 'accepted')
      .map((acknowledgement) => acknowledgement.handoffId)
  );
  const rejectedReceipts = clientWorkflowHandoff.clientRuntime.handoffAcknowledgements
    .filter((acknowledgement) => ['rejected', 'failed'].includes(acknowledgement.status))
    .map((acknowledgement) => ({
      handoffId: acknowledgement.handoffId,
      nodeId: acknowledgement.nodeId,
      providerId: acknowledgement.providerId,
      status: acknowledgement.status,
      errorCode: acknowledgement.errorCode,
      action: 'request a fresh preview after resolving the provider receipt failure'
    }));
  const staleCursor = clientWorkflowHandoff.clientRuntime.clientCursor
    && clientWorkflowHandoff.clientRuntime.clientCursor !== clientWorkflowHandoff.statePatch.cursor;
  const globalBlockers = [
    ...failedGates.map((gate) => ({
      code: `gate-${gate.gate}`,
      severity: gate.gate === 'validation' || gate.gate === 'operational-errors' ? 'error' : 'warning',
      message: gate.reason,
      action: gate.gate === 'write-scope'
        ? 'retry with an actor that can mutate this scheduler dependency graph scope'
        : gate.reason
    })),
    ...(staleCursor
      ? [{
        code: 'stale-client-cursor',
        severity: 'error',
        message: 'client cursor does not match the current route preview cursor',
        action: 'refresh the route preview before accepting a next step',
        clientCursor: clientWorkflowHandoff.clientRuntime.clientCursor,
        currentCursor: clientWorkflowHandoff.statePatch.cursor
      }]
      : []),
    ...rejectedReceipts.map((receipt) => ({
      code: 'handoff-receipt-rejected',
      severity: 'error',
      message: `handoff receipt ${receipt.handoffId} is ${receipt.status}`,
      action: receipt.action,
      nodeId: receipt.nodeId,
      providerId: receipt.providerId,
      errorCode: receipt.errorCode
    }))
  ];
  const stepDecisions = nextStepContracts.map((step, index) => {
    const needsHandoffExport = step.type === 'accept-provider-handoff';
    const proofPresent = step.type !== 'accept-provider-handoff' || Boolean(step.proof);
    const commandId = step.command?.commandId || null;
    const handoffId = step.proof?.idempotencyKey === commandId
      ? firstString(step.command?.commandId)?.replace(/^handoff:/, '').replace(/:claim$/, '')
      : null;
    const stepBlockers = [
      ...globalBlockers,
      ...(needsHandoffExport && !boundary.canExportHandoff
        ? [{
          code: 'handoff-export-permission-required',
          severity: 'error',
          message: 'accepting provider handoff requires handoff export permission',
          action: 'retry with handoff export permission before accepting provider claim commands'
        }]
        : []),
      ...(needsHandoffExport && externalHandoff.handoffExportBoundary.allowed === false
        ? [{
          code: 'handoff-export-boundary-blocked',
          severity: 'error',
          message: externalHandoff.handoffExportBoundary.reason || 'provider handoff export boundary is blocked',
          action: externalHandoff.handoffExportBoundary.reason || 'resolve handoff export boundary before accepting'
        }]
        : []),
      ...(!proofPresent
        ? [{
          code: 'acceptance-proof-missing',
          severity: 'error',
          message: `${step.type} requires proof data before acceptance`,
          action: 'refresh preview so nextStepContracts include proof data'
        }]
        : [])
    ];
    const hardBlocked = stepBlockers.some((blocker) => blocker.severity === 'error');

    return {
      ordinal: index + 1,
      type: step.type,
      label: step.label,
      nodeId: step.nodeId,
      providerId: step.providerId,
      commandType: step.command?.type || null,
      commandId,
      handoffId,
      selectable: !hardBlocked && boundary.canWrite,
      acceptedReceiptPresent: handoffId ? acceptedReceipts.has(handoffId) : false,
      requiredFields: step.requiredFields,
      blockers: stepBlockers,
      acceptanceBody: {
        previewIdField: 'previewId',
        cursor: clientWorkflowHandoff.statePatch.cursor,
        selectedStepType: step.type,
        nodeId: step.nodeId,
        providerId: step.providerId,
        command: step.command
      },
      nextAction: hardBlocked
        ? stepBlockers.find((blocker) => blocker.severity === 'error')?.action
        : `submit acceptance for ${step.type}${step.nodeId ? ` on ${step.nodeId}` : ''}`
    };
  });
  const selectableSteps = stepDecisions.filter((step) => step.selectable);

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.routeAcceptanceDecisionMatrix.v1',
    state: selectableSteps.length > 0
      ? 'selectable'
      : globalBlockers.some((blocker) => blocker.severity === 'error')
        ? 'blocked'
        : nextStepContracts.length > 0
          ? 'waiting-on-gates'
          : 'no-actionable-step',
    submitAllowed: selectableSteps.length > 0 && previewAcceptance.acceptance.canAcceptNextStep,
    selectedDefault: selectableSteps[0] || null,
    failedGates,
    globalBlockers,
    receiptState: {
      acknowledgementRequired: clientWorkflowHandoff.actions.acknowledgementRequired === true,
      pendingHandoffIds: pendingAcknowledgements,
      acceptedHandoffIds: [...acceptedReceipts].sort(),
      rejectedReceipts,
      unknownAcknowledgements: clientWorkflowHandoff.actions.unknownAcknowledgements
    },
    cursorState: {
      currentCursor: clientWorkflowHandoff.statePatch.cursor,
      clientCursor: clientWorkflowHandoff.clientRuntime.clientCursor,
      stale: Boolean(staleCursor)
    },
    steps: stepDecisions,
    nextAction: selectableSteps[0]?.nextAction
      || globalBlockers[0]?.action
      || operationalErrors.nextAction
      || previewAcceptance.readiness.state
  };
}

function buildRoutePreviewAcceptancePacket(previewAcceptance, clientWorkflowHandoff, externalHandoff, lifecycleControls, operationalErrors, boundary, now) {
  const cursor = clientWorkflowHandoff.statePatch.cursor;
  const previewId = [
    surfaceId,
    clientWorkflowHandoff.statePatch.epoch,
    externalHandoff.dispatchManifest.manifestId,
    cursor
  ].join(':');
  const routeState = operationalErrors.state === 'blocked'
    ? 'blocked'
    : previewAcceptance.acceptance.readOnly
      ? 'read-only-preview'
      : previewAcceptance.readiness.state === 'actionable'
        ? 'ready-for-acceptance'
        : previewAcceptance.readiness.state;
  const nextStepContracts = previewAcceptance.nextSteps.map(nextStepCommandShape);
  const blockingReasons = [
    ...previewAcceptance.validationSummary.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({
        code: issue.code,
        nodeId: issue.nodeId || null,
        message: issue.message,
        action: issue.action || null
      })),
    ...operationalErrors.errors
      .filter((error) => error.severity === 'error')
      .map((error) => ({
        code: error.code,
        nodeId: error.nodeId || null,
        providerId: error.providerId || null,
        message: error.message,
        action: error.action || null
      }))
  ].slice(0, 25);
  const acceptanceRequirements = {
    schema: 'scheduler.dependencyGraph.routeAcceptanceRequirements.v1',
    requiredBodyFields: ['previewId', 'cursor', 'selectedStepType'],
    optionalBodyFields: ['nodeId', 'providerId', 'commandId', 'receiptRef'],
    idempotency: {
      required: true,
      field: 'command.commandId',
      replayWindowMs: externalHandoff.delivery?.policy?.replayWindowMs || 60 * 60_000
    },
    acknowledgement: {
      required: clientWorkflowHandoff.actions.acknowledgementRequired === true,
      contract: clientWorkflowHandoff.actions.acknowledgementContract,
      pendingHandoffIds: clientWorkflowHandoff.actions.acknowledgeHandoffIds
    },
    permissions: {
      canRead: boundary.canRead,
      canWrite: boundary.canWrite,
      canExportHandoff: boundary.canExportHandoff,
      requiredWritePermission: graphWritePermission,
      requiredHandoffExportPermission: graphHandoffExportPermission
    }
  };
  const readinessGates = [
    {
      gate: 'read-scope',
      passed: boundary.canRead,
      reason: boundary.canRead ? null : 'read permission required before preview can be rendered'
    },
    {
      gate: 'write-scope',
      passed: boundary.canWrite,
      reason: boundary.canWrite ? null : 'write permission required to accept the next scheduler step'
    },
    {
      gate: 'handoff-export-scope',
      passed: externalHandoff.providerId === null || externalHandoff.handoffExportBoundary.allowed,
      reason: externalHandoff.providerId === null || externalHandoff.handoffExportBoundary.allowed
        ? null
        : externalHandoff.handoffExportBoundary.reason || 'handoff export permission required before provider claim preparation'
    },
    {
      gate: 'validation',
      passed: previewAcceptance.validationSummary.errorCount === 0,
      reason: previewAcceptance.validationSummary.errorCount === 0 ? null : 'validation errors block acceptance'
    },
    {
      gate: 'actionable-next-step',
      passed: nextStepContracts.length > 0,
      reason: nextStepContracts.length > 0 ? null : 'no scheduler next step is currently actionable'
    },
    {
      gate: 'dispatch-health',
      passed: operationalErrors.dispatchGate?.blocked !== true,
      reason: operationalErrors.dispatchGate?.blocked === true
        ? operationalErrors.dispatchGate.deniedReasons[0]?.message || 'scheduler dispatch health gate is blocked'
        : null
    },
    {
      gate: 'operational-errors',
      passed: operationalErrors.state !== 'blocked',
      reason: operationalErrors.state !== 'blocked' ? null : operationalErrors.nextAction || 'clear operational errors before acceptance'
    }
  ];
  const acceptanceDecisionMatrix = buildRouteAcceptanceDecisionMatrix(
    previewAcceptance,
    clientWorkflowHandoff,
    externalHandoff,
    operationalErrors,
    readinessGates,
    nextStepContracts,
    boundary,
    now
  );

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.routePreviewAcceptance.v1',
    previewId,
    routeState,
    cursor,
    canSubmitAcceptance: acceptanceDecisionMatrix.submitAllowed,
    validationSummary: {
      schema: previewAcceptance.validationSummary.schema,
      valid: previewAcceptance.validationSummary.valid,
      errorCount: previewAcceptance.validationSummary.errorCount,
      warningCount: previewAcceptance.validationSummary.warningCount,
      issueCodes: [...new Set(previewAcceptance.validationSummary.issues.map((issue) => issue.code))].sort()
    },
    readinessGates,
    dispatchHealthGate: operationalErrors.dispatchGate,
    acceptanceRequirements,
    acceptanceDecisionMatrix,
    nextStepContracts,
    blockingReasons,
    routeActions: {
      preview: {
        method: 'GET',
        contract: 'scheduler.dependencyGraph.routePreviewAcceptance.v1',
        cursor
      },
      validate: {
        method: 'POST',
        contract: 'scheduler.dependencyGraph.validationSummary.v1',
        requiredBodyFields: acceptanceRequirements.requiredBodyFields
      },
      accept: {
        method: 'POST',
        contract: 'scheduler.dependencyGraph.lifecycleCommandReceipt.v1',
        enabled: acceptanceDecisionMatrix.submitAllowed,
        nextCommand: lifecycleControls.nextCommand
      }
    },
    nextAction: acceptanceDecisionMatrix.nextAction
      || blockingReasons[0]?.action
      || nextStepContracts[0]?.label
      || clientWorkflowHandoff.nextAction
      || externalHandoff.nextAction
      || null
  };
}

function buildOperationalErrorContract(state, nodes, health, schedulingPlan, providerNegotiation, externalHandoff, boundary, commandResult, now) {
  const errors = [];
  const pushError = (error) => {
    errors.push({
      severity: error.severity || 'warning',
      code: error.code,
      nodeId: error.nodeId || null,
      providerId: error.providerId || null,
      message: error.message,
      retryable: error.retryable === true,
      retryAfter: error.retryAfter || null,
      action: error.action || null,
      command: error.command || null,
      evidence: error.evidence || {}
    });
  };

  if (commandResult.error) {
    pushError({
      severity: 'error',
      code: commandResult.boundary ? `boundary-${commandResult.boundary}` : 'command-rejected',
      message: commandResult.error,
      retryable: false,
      action: commandResult.boundary ? 'refresh actor scope/permissions before resubmitting' : 'correct the command payload and resubmit with a new commandId',
      evidence: { boundary: commandResult.boundary || null, details: commandResult.details || null }
    });
  }

  for (const failure of health.failures) {
    pushError({
      severity: failure.degraded ? 'error' : 'warning',
      code: failure.degraded ? 'node-failure-degraded' : failure.retryable ? 'node-failure-retryable' : 'node-failure-backoff',
      nodeId: failure.nodeId,
      message: failure.message,
      retryable: failure.retryable,
      retryAfter: failure.retryAfter,
      action: failure.action,
      command: failure.retryable && boundary.canWrite
        ? commandTemplate('retry-node', failure.nodeId, boundary)
        : failure.degraded && boundary.canWrite
          ? commandTemplate('reset-node', failure.nodeId, boundary)
          : null,
      evidence: {
        errorCode: failure.errorCode,
        attempts: failure.attempts,
        maxAttempts: failure.maxAttempts
      }
    });
  }

  for (const lease of schedulingPlan.runningLeases) {
    if (lease.expired) {
      pushError({
        severity: 'error',
        code: 'execution-lease-expired',
        nodeId: lease.nodeId,
        providerId: lease.providerId,
        message: `execution lease expired for running node ${lease.nodeId}`,
        retryable: true,
        action: 'rerun scheduler reducer to recover the expired lease, then dispatch the node again if ready',
        evidence: { leaseId: lease.leaseId, holderId: lease.holderId, expiredAt: lease.expiresAt }
      });
    }
  }

  for (const reason of schedulingPlan.dispatchHealthGate?.deniedReasons || []) {
    const retryCommand = reason.code === 'retryable-failures-awaiting-operator' && Array.isArray(reason.retryableNodeIds)
      ? reason.retryableNodeIds
        .map((nodeId) => boundary.canWrite ? commandTemplate('retry-node', nodeId, boundary) : null)
        .filter(Boolean)[0] || null
      : null;
    const command = reason.code === 'scheduling-paused' && boundary.canWrite
      ? { type: 'resume-scheduling', tenantId: boundary.tenantId || undefined, workspaceId: boundary.workspaceId || undefined }
      : reason.code === 'auto-promote-disabled' && boundary.canWrite && typeof reason.nodeId === 'string'
        ? commandTemplate('mark-running', reason.nodeId, boundary)
        : retryCommand;
    pushError({
      severity: reason.severity === 'error' ? 'error' : 'warning',
      code: `dispatch-gate-${reason.code}`,
      nodeId: reason.nodeId || null,
      message: reason.message,
      retryable: ['retryable-failures-awaiting-operator', 'retry-backoff-active', 'dispatch-capacity-exhausted'].includes(reason.code),
      retryAfter: reason.retryAfter || null,
      action: reason.action,
      command,
      evidence: {
        dispatchGateState: schedulingPlan.dispatchHealthGate.state,
        blocksDispatch: reason.blocksDispatch === true,
        readyCandidateCount: schedulingPlan.dispatchHealthGate.capacity.readyCandidateCount,
        dispatchableCount: schedulingPlan.dispatchHealthGate.capacity.dispatchableCount,
        availableSlots: schedulingPlan.dispatchHealthGate.capacity.availableSlots,
        issueCodes: reason.issueCodes || [],
        retryableNodeIds: reason.retryableNodeIds || [],
        runningNodeIds: reason.runningNodeIds || []
      }
    });
  }

  if (providerNegotiation.decision === 'no-usable-provider-contract' && schedulingPlan.dispatchable.length > 0) {
    pushError({
      severity: 'warning',
      code: 'provider-handoff-unavailable',
      message: 'dispatchable scheduler nodes cannot be exported because no provider contract is currently usable',
      retryable: true,
      action: 'refresh provider sync metadata or register required dependency graph provider capabilities',
      evidence: {
        dispatchable: schedulingPlan.dispatchable,
        providerCount: providerNegotiation.providerCount,
        requiredCapabilities: providerNegotiation.requiredCapabilities
      }
    });
  }

  for (const claim of externalHandoff.rejectedClaims) {
    pushError({
      severity: 'error',
      code: 'provider-claim-rejected',
      nodeId: claim.nodeId,
      providerId: claim.providerId,
      message: claim.reason,
      retryable: false,
      action: claim.nodeId
        ? 'resolve provider claim boundary rejection before exporting the node'
        : 'grant handoff export permission or switch actor scope before provider handoff export',
      evidence: claim.details || {}
    });
  }

  const degradedNodes = nodes
    .filter((node) => node.degraded === true || (node.status === 'failed' && node.attempts >= node.maxAttempts))
    .map((node) => node.id);
  const blockedByOperationalError = errors.some((error) => error.severity === 'error') || schedulingPlan.dispatchHealthGate?.blocked === true;
  const retryableCommands = errors
    .filter((error) => error.retryable && error.command)
    .map((error) => error.command)
    .slice(0, 25);

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.operationalErrors.v1',
    state: blockedByOperationalError
      ? 'blocked'
      : errors.length > 0
        ? 'action-required'
        : health.mode === 'healthy'
          ? 'clear'
          : 'monitor',
    degradedMode: {
      active: health.degraded || degradedNodes.length > 0,
      degradedNodes,
      policy: degradedNodes.length > 0
        ? 'hold provider handoff for degraded nodes until reset-node or remediation succeeds'
        : 'continue dispatch for healthy ready nodes'
    },
    dispatchGate: schedulingPlan.dispatchHealthGate || null,
    retry: {
      policy: {
        defaultBackoffMs: defaultRetryBackoffMs,
        maxBackoffMs: maxRetryBackoffMs,
        maxAttempts: state.settings.defaultNodeMaxAttempts
      },
      commandCount: retryableCommands.length,
      commands: retryableCommands
    },
    errors,
    nextAction: errors[0]?.action || health.nextAction || schedulingPlan.nextAction || null
  };
}

function buildAnalyticsSnapshot(state, nodes, derived, health, commandResult, recovered, commandType, now, reportingContext = {}) {
  const statusCounts = nodes.reduce((counts, node) => {
    counts[node.status] = (counts[node.status] || 0) + 1;
    return counts;
  }, {});
  const schedulingPlan = cloneRecord(reportingContext.schedulingPlan);
  const providerNegotiation = cloneRecord(reportingContext.providerNegotiation);
  const externalHandoff = cloneRecord(reportingContext.externalHandoff);
  const clientWorkflowHandoff = cloneRecord(reportingContext.clientWorkflowHandoff);
  const acknowledgementSummary = cloneRecord(clientWorkflowHandoff.actions?.acknowledgementSummary);
  const graphValidation = derived.graphValidation || {};
  const dispatchHealthGate = cloneRecord(schedulingPlan.dispatchHealthGate);
  const handoffExportBoundary = cloneRecord(externalHandoff.handoffExportBoundary);
  const providers = Array.isArray(providerNegotiation.providers) ? providerNegotiation.providers : [];
  const edgeCount = nodes.reduce((total, node) => total + node.dependsOn.length, 0);
  const terminalCount = nodes.filter((node) => terminalStatuses.has(node.status)).length;
  const dependencyBoundary = state.dependencyBoundary || buildDependencyBoundaryState(state);
  const failedCount = statusCounts.failed || 0;
  const succeededCount = statusCounts.succeeded || 0;
  const totalAttempts = nodes.reduce((total, node) => total + node.attempts, 0);
  const maxAttemptsConsumed = nodes.filter((node) => node.status === 'failed' && node.attempts >= node.maxAttempts).length;
  const retryableFailureCount = health.failures.filter((failure) => failure.retryable).length;
  const blockedCount = statusCounts.blocked || 0;
  const readyCount = statusCounts.ready || 0;
  const openNodeCount = nodes.length - terminalCount;
  const completionPercent = nodes.length === 0 ? 100 : Math.round((terminalCount / nodes.length) * 100);

  return {
    at: now,
    epoch: state.epoch,
    bootId: state.bootId || null,
    tenantId: state.tenantId || null,
    workspaceId: state.workspaceId || null,
    command: {
      applied: commandResult.applied === true,
      idempotent: commandResult.idempotent === true,
      rejected: Boolean(commandResult.error),
      type: firstString(commandType, state.appliedCommands[state.appliedCommands.length - 1]?.type) || null
    },
    counters: {
      nodeCount: nodes.length,
      edgeCount,
      openNodeCount,
      terminalCount,
      readyCount,
      blockedCount,
      runningCount: statusCounts.running || 0,
      pendingCount: statusCounts.pending || 0,
      succeededCount,
      failedCount,
      skippedCount: statusCounts.skipped || 0,
      degradedFailureCount: health.failures.filter((failure) => failure.degraded).length,
      retryableFailureCount,
      maxAttemptsConsumed,
      totalAttempts,
      recoveredNodeCount: recovered.length,
      issueCount: health.issues.length,
      completionPercent,
      dispatchableCount: Array.isArray(schedulingPlan.dispatchable) ? schedulingPlan.dispatchable.length : 0,
      claimableHandoffCount: Array.isArray(externalHandoff.claimableNodes) ? externalHandoff.claimableNodes.length : 0,
      rejectedHandoffCount: Array.isArray(externalHandoff.rejectedClaims) ? externalHandoff.rejectedClaims.length : 0,
      providerCount: numberFrom(providerNegotiation.providerCount, providers.length),
      usableProviderCount: providers.filter((provider) => provider.usable === true).length,
      staleProviderCount: providers.filter((provider) => provider.sync?.stale === true).length,
      boundaryHiddenDependencyCount: dependencyBoundary.hiddenDependencyCount,
      boundaryRejectedEdgeCount: dependencyBoundary.rejectedEdgeCount,
      pendingHandoffAcknowledgementCount: numberFrom(acknowledgementSummary.pending, 0),
      failedHandoffAcknowledgementCount: numberFrom(acknowledgementSummary.failed, 0) + numberFrom(acknowledgementSummary.rejected, 0),
      unknownHandoffAcknowledgementCount: numberFrom(acknowledgementSummary.unknown, 0),
      dispatchGateBlockedCount: dispatchHealthGate.blocked === true ? 1 : 0,
      graphCriticalBlockerCount: numberFrom(graphValidation.blockerSummary?.errorCount, 0),
      graphStructuralErrorCount: numberFrom(graphValidation.structuralSummary?.errorCount, 0),
      lifecyclePausedCount: state.settings.schedulingEnabled === false ? 1 : 0,
      handoffExportBlockedCount: handoffExportBoundary.allowed === false ? 1 : 0
    },
    queues: {
      ready: derived.ready.slice(0, 25),
      blocked: derived.blocked.slice(0, 25),
      retryableFailures: health.failures.filter((failure) => failure.retryable).map((failure) => failure.nodeId).slice(0, 25),
      dispatchable: Array.isArray(schedulingPlan.dispatchable) ? schedulingPlan.dispatchable.slice(0, 25) : [],
      claimableHandoffs: Array.isArray(externalHandoff.claimableNodes) ? externalHandoff.claimableNodes.slice(0, 25) : []
    },
    healthMode: health.mode,
    nextAction: health.nextAction
  };
}

function analyticsDelta(currentCounters, previousCounters = {}) {
  return Object.fromEntries(
    analyticsCounterFields.map((field) => [
      field,
      numberFrom(currentCounters[field], 0) - numberFrom(previousCounters[field], currentCounters[field])
    ])
  );
}

function analyticsTrend(delta) {
  const failurePressure = numberFrom(delta.failedCount) + numberFrom(delta.degradedFailureCount) + numberFrom(delta.retryableFailureCount);
  const handoffPressure = numberFrom(delta.rejectedHandoffCount) + numberFrom(delta.failedHandoffAcknowledgementCount);
  const gatePressure = numberFrom(delta.dispatchGateBlockedCount) + numberFrom(delta.graphCriticalBlockerCount) + numberFrom(delta.graphStructuralErrorCount);
  const throughput = numberFrom(delta.succeededCount) + numberFrom(delta.skippedCount) + numberFrom(delta.recoveredNodeCount);
  if (handoffPressure > 0) return 'handoff-pressure-increased';
  if (failurePressure > 0) return 'failure-pressure-increased';
  if (gatePressure > 0) return 'scheduler-gates-tightened';
  if (numberFrom(delta.blockedCount) > 0 && numberFrom(delta.readyCount) <= 0) return 'blocked-backlog-increased';
  if (numberFrom(delta.claimableHandoffCount) > 0 || numberFrom(delta.dispatchableCount) > 0) return 'handoff-or-dispatch-ready';
  if (numberFrom(delta.runningCount) > 0 || numberFrom(delta.readyCount) > 0) return 'work-ready';
  if (throughput > 0 || numberFrom(delta.completionPercent) > 0) return 'progressing';
  if (numberFrom(delta.openNodeCount) < 0) return 'closing';
  return 'unchanged';
}

function buildAnalyticsExportReadiness(history, exportRows, summary, timelineState, snapshot, now) {
  const latestCounters = snapshot.counters || {};
  const historyComplete = history.length <= maxAnalyticsHistoryEntries;
  const exportColumns = Object.keys(exportRows[0] || {});
  const missingCounterColumns = analyticsCounterFields.filter((field) => !exportColumns.includes(field));
  const blockers = [
    ...(summary.exportReady ? [] : [{
      code: 'no-export-rows',
      severity: 'error',
      message: 'analytics export has no rows to emit',
      action: 'run the dependency graph reducer with at least one visible scheduler snapshot'
    }]),
    ...(missingCounterColumns.length === 0 ? [] : [{
      code: 'missing-counter-columns',
      severity: 'error',
      message: 'analytics export rows are missing declared scheduler counter columns',
      action: 'include every analyticsCounterFields value in export.rows before writing the report',
      columns: missingCounterColumns
    }]),
    ...(timelineState.state === 'export-blocked' ? [{
      code: 'timeline-export-blocked',
      severity: 'error',
      message: 'timeline state reports export-blocking handoff or provider issues',
      action: timelineState.alerts[0]?.action || 'inspect analytics.timelineState.alerts before exporting'
    }] : []),
    ...(numberFrom(latestCounters.handoffExportBlockedCount) > 0 ? [{
      code: 'handoff-export-boundary-blocked',
      severity: 'error',
      message: 'current snapshot contains a blocked provider handoff export boundary',
      action: 'grant handoff export permission or change tenant/workspace scope before exporting claim analytics'
    }] : []),
    ...(numberFrom(latestCounters.graphStructuralErrorCount) > 0 ? [{
      code: 'graph-structural-errors-present',
      severity: 'error',
      message: 'current snapshot contains dependency graph structural errors',
      action: 'resolve missing dependencies or cycles before treating frontier analytics as dispatch-safe'
    }] : []),
    ...(historyComplete ? [] : [{
      code: 'history-retention-truncated',
      severity: 'warning',
      message: 'analytics history exceeded the retained snapshot limit',
      action: 'use report.window.firstAt and report.window.lastAt as the bounded export interval'
    }]),
    ...(numberFrom(latestCounters.unknownHandoffAcknowledgementCount) > 0 ? [{
      code: 'unknown-handoff-acknowledgements',
      severity: 'warning',
      message: 'client receipts reference handoffs not visible in the current scoped workflow response',
      action: 'reconcile clientWorkflowHandoff.actions.unknownAcknowledgements before provider receipt export'
    }] : []),
    ...(numberFrom(latestCounters.lifecyclePausedCount) > 0 ? [{
      code: 'scheduler-paused',
      severity: 'info',
      message: 'scheduler lifecycle is paused in the current analytics snapshot',
      action: 'resume scheduling before expecting dispatchable counts to increase'
    }] : [])
  ];
  const state = blockers.some((blocker) => blocker.severity === 'error')
    ? 'blocked'
    : blockers.some((blocker) => blocker.severity === 'warning')
      ? 'export-with-warnings'
      : 'ready';

  return {
    schema: 'scheduler.dependencyGraph.analyticsExportReadiness.v1',
    generatedAt: now,
    state,
    exportable: state !== 'blocked',
    reportId: summary.reportId,
    rowCount: exportRows.length,
    columnCount: exportColumns.length,
    requiredCounterColumns: analyticsCounterFields,
    missingCounterColumns,
    latestSnapshot: {
      at: snapshot.at,
      epoch: snapshot.epoch,
      healthMode: snapshot.healthMode,
      trend: summary.trend,
      completionPercent: numberFrom(latestCounters.completionPercent),
      dispatchableCount: numberFrom(latestCounters.dispatchableCount),
      claimableHandoffCount: numberFrom(latestCounters.claimableHandoffCount),
      graphCriticalBlockerCount: numberFrom(latestCounters.graphCriticalBlockerCount)
    },
    watermark: timelineState.exportWatermark,
    blockers,
    nextAction: blockers.find((blocker) => blocker.severity === 'error')?.action
      || blockers[0]?.action
      || 'write analytics.export.rows with analytics.export.summary and timelineState'
  };
}

function buildAnalyticsTimelineState(history, exportRows, snapshot, delta, summary, now) {
  const latest = history[history.length - 1] || snapshot;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const latestCounters = latest.counters || {};
  const previousCounters = previous?.counters || {};
  const openNodeDelta = numberFrom(latestCounters.openNodeCount) - numberFrom(previousCounters.openNodeCount, latestCounters.openNodeCount);
  const completionDelta = numberFrom(latestCounters.completionPercent) - numberFrom(previousCounters.completionPercent, latestCounters.completionPercent);
  const handoffBacklog = numberFrom(latestCounters.claimableHandoffCount) + numberFrom(latestCounters.pendingHandoffAcknowledgementCount);
  const blockedBacklog = numberFrom(latestCounters.blockedCount) + numberFrom(latestCounters.failedCount);
  const exportWatermark = exportRows.length > 0
    ? `${exportRows[0].at}:${exportRows[exportRows.length - 1].at}:${exportRows.length}`
    : `${snapshot.at}:empty`;
  const milestones = history
    .filter((entry, index, entries) => {
      if (index === 0) return true;
      const prior = entries[index - 1];
      return entry.healthMode !== prior.healthMode
        || entry.command?.rejected === true
        || numberFrom(entry.counters.completionPercent) !== numberFrom(prior.counters.completionPercent)
        || numberFrom(entry.counters.claimableHandoffCount) !== numberFrom(prior.counters.claimableHandoffCount);
    })
    .slice(-12)
    .map((entry) => ({
      at: entry.at,
      epoch: entry.epoch,
      healthMode: entry.healthMode,
      commandType: entry.command?.type || null,
      completionPercent: numberFrom(entry.counters.completionPercent),
      openNodeCount: numberFrom(entry.counters.openNodeCount),
      claimableHandoffCount: numberFrom(entry.counters.claimableHandoffCount),
      rejectedHandoffCount: numberFrom(entry.counters.rejectedHandoffCount)
    }));
  const alerts = [
    ...(numberFrom(latestCounters.rejectedHandoffCount) > 0
      ? [{ code: 'handoff-rejections-present', severity: 'error', count: numberFrom(latestCounters.rejectedHandoffCount), action: 'inspect externalHandoff.boundaryManifest before exporting more claim commands' }]
      : []),
    ...(numberFrom(latestCounters.failedHandoffAcknowledgementCount) > 0
      ? [{ code: 'handoff-receipts-failed', severity: 'warning', count: numberFrom(latestCounters.failedHandoffAcknowledgementCount), action: 'review clientWorkflowHandoff actionable receipts and provider receipts' }]
      : []),
    ...(numberFrom(latestCounters.staleProviderCount) > 0
      ? [{ code: 'provider-sync-stale', severity: 'warning', count: numberFrom(latestCounters.staleProviderCount), action: 'refresh provider sync metadata before relying on hosted handoff capacity' }]
      : [])
  ];

  return {
    schema: 'scheduler.dependencyGraph.analyticsTimelineState.v1',
    generatedAt: now,
    state: alerts.some((alert) => alert.severity === 'error')
      ? 'export-blocked'
      : handoffBacklog > 0
        ? 'handoff-active'
        : blockedBacklog > 0
          ? 'attention-required'
          : numberFrom(latestCounters.openNodeCount) > 0
            ? 'in-progress'
            : 'settled',
    exportWatermark,
    velocity: {
      openNodeDelta,
      completionDelta,
      trend: summary.trend
    },
    backlog: {
      openNodeCount: numberFrom(latestCounters.openNodeCount),
      blockedOrFailedCount: blockedBacklog,
      handoffBacklog,
      dispatchableCount: numberFrom(latestCounters.dispatchableCount)
    },
    milestones,
    alerts,
    partitions: {
      tenantId: snapshot.tenantId || 'global',
      workspaceId: snapshot.workspaceId || 'default',
      bootId: snapshot.bootId || 'unknown',
      epoch: snapshot.epoch
    }
  };
}

function buildAnalyticsExportSummary(history, exportRows, snapshot, delta, now) {
  const first = history[0] || snapshot;
  const last = history[history.length - 1] || snapshot;
  const aggregate = history.reduce((totals, entry) => {
    totals.maxBlockedCount = Math.max(totals.maxBlockedCount, numberFrom(entry.counters.blockedCount));
    totals.maxFailedCount = Math.max(totals.maxFailedCount, numberFrom(entry.counters.failedCount));
    totals.maxRunningCount = Math.max(totals.maxRunningCount, numberFrom(entry.counters.runningCount));
    totals.recoveredNodeCount += numberFrom(entry.counters.recoveredNodeCount);
    totals.totalAttempts += numberFrom(entry.counters.totalAttempts);
    totals.issueCount += numberFrom(entry.counters.issueCount);
    totals.maxDispatchableCount = Math.max(totals.maxDispatchableCount, numberFrom(entry.counters.dispatchableCount));
    totals.maxClaimableHandoffCount = Math.max(totals.maxClaimableHandoffCount, numberFrom(entry.counters.claimableHandoffCount));
    totals.rejectedHandoffCount += numberFrom(entry.counters.rejectedHandoffCount);
    totals.failedHandoffAcknowledgementCount += numberFrom(entry.counters.failedHandoffAcknowledgementCount);
    totals.unknownHandoffAcknowledgementCount += numberFrom(entry.counters.unknownHandoffAcknowledgementCount);
    totals.dispatchGateBlockedSnapshotCount += numberFrom(entry.counters.dispatchGateBlockedCount) > 0 ? 1 : 0;
    totals.maxGraphCriticalBlockerCount = Math.max(totals.maxGraphCriticalBlockerCount, numberFrom(entry.counters.graphCriticalBlockerCount));
    totals.maxGraphStructuralErrorCount = Math.max(totals.maxGraphStructuralErrorCount, numberFrom(entry.counters.graphStructuralErrorCount));
    totals.lifecyclePausedSnapshotCount += numberFrom(entry.counters.lifecyclePausedCount) > 0 ? 1 : 0;
    totals.handoffExportBlockedSnapshotCount += numberFrom(entry.counters.handoffExportBlockedCount) > 0 ? 1 : 0;
    if (entry.command?.applied) totals.appliedCommandCount += 1;
    if (entry.command?.rejected) totals.rejectedCommandCount += 1;
    return totals;
  }, {
    maxBlockedCount: 0,
    maxFailedCount: 0,
    maxRunningCount: 0,
    recoveredNodeCount: 0,
    totalAttempts: 0,
    issueCount: 0,
    maxDispatchableCount: 0,
    maxClaimableHandoffCount: 0,
    rejectedHandoffCount: 0,
    failedHandoffAcknowledgementCount: 0,
    unknownHandoffAcknowledgementCount: 0,
    dispatchGateBlockedSnapshotCount: 0,
    maxGraphCriticalBlockerCount: 0,
    maxGraphStructuralErrorCount: 0,
    lifecyclePausedSnapshotCount: 0,
    handoffExportBlockedSnapshotCount: 0,
    appliedCommandCount: 0,
    rejectedCommandCount: 0
  });
  const healthModes = [...new Set(history.map((entry) => entry.healthMode))].filter(Boolean).sort();
  const reportId = [
    surfaceId,
    snapshot.tenantId || 'global',
    snapshot.workspaceId || 'default',
    snapshot.epoch,
    snapshot.at
  ].join(':');

  return {
    schema: 'scheduler.dependencyGraph.analyticsExportSummary.v1',
    reportId,
    generatedAt: now,
    window: {
      firstAt: first.at,
      lastAt: last.at,
      snapshotCount: history.length,
      retentionLimit: maxAnalyticsHistoryEntries
    },
    scope: {
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      bootId: snapshot.bootId,
      epoch: snapshot.epoch
    },
    aggregate,
    trend: analyticsTrend(delta),
    delta,
    healthModes,
    exportReady: exportRows.length > 0,
    rowCount: exportRows.length,
    nextAction: snapshot.nextAction || (aggregate.rejectedCommandCount > 0 ? 'inspect rejected scheduler dependency graph commands' : null)
  };
}

function buildAnalyticsReport(state, snapshot, now) {
  const history = [...state.analyticsHistory, snapshot].slice(-maxAnalyticsHistoryEntries);
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const previousCounters = previous?.counters || {};
  const current = snapshot.counters;
  const delta = analyticsDelta(current, previousCounters);
  const exportRows = history.map((entry) => ({
    at: entry.at,
    epoch: entry.epoch,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    bootId: entry.bootId,
    commandType: entry.command?.type || null,
    commandApplied: entry.command?.applied === true,
    commandRejected: entry.command?.rejected === true,
    nodeCount: entry.counters.nodeCount,
    edgeCount: entry.counters.edgeCount,
    openNodeCount: entry.counters.openNodeCount,
    readyCount: entry.counters.readyCount,
    blockedCount: entry.counters.blockedCount,
    runningCount: entry.counters.runningCount,
    pendingCount: entry.counters.pendingCount,
    succeededCount: entry.counters.succeededCount,
    failedCount: entry.counters.failedCount,
    skippedCount: entry.counters.skippedCount,
    degradedFailureCount: entry.counters.degradedFailureCount,
    retryableFailureCount: entry.counters.retryableFailureCount,
    dispatchableCount: entry.counters.dispatchableCount,
    claimableHandoffCount: entry.counters.claimableHandoffCount,
    rejectedHandoffCount: entry.counters.rejectedHandoffCount,
    providerCount: entry.counters.providerCount,
    usableProviderCount: entry.counters.usableProviderCount,
    staleProviderCount: entry.counters.staleProviderCount,
    boundaryHiddenDependencyCount: entry.counters.boundaryHiddenDependencyCount,
    boundaryRejectedEdgeCount: entry.counters.boundaryRejectedEdgeCount,
    pendingHandoffAcknowledgementCount: entry.counters.pendingHandoffAcknowledgementCount,
    failedHandoffAcknowledgementCount: entry.counters.failedHandoffAcknowledgementCount,
    unknownHandoffAcknowledgementCount: entry.counters.unknownHandoffAcknowledgementCount,
    dispatchGateBlockedCount: entry.counters.dispatchGateBlockedCount,
    graphCriticalBlockerCount: entry.counters.graphCriticalBlockerCount,
    graphStructuralErrorCount: entry.counters.graphStructuralErrorCount,
    lifecyclePausedCount: entry.counters.lifecyclePausedCount,
    handoffExportBlockedCount: entry.counters.handoffExportBlockedCount,
    recoveredNodeCount: entry.counters.recoveredNodeCount,
    issueCount: entry.counters.issueCount,
    completionPercent: entry.counters.completionPercent,
    healthMode: entry.healthMode
  }));
  const summary = buildAnalyticsExportSummary(history, exportRows, snapshot, delta, now);
  const timelineState = buildAnalyticsTimelineState(history, exportRows, snapshot, delta, summary, now);
  const exportReadiness = buildAnalyticsExportReadiness(history, exportRows, summary, timelineState, snapshot, now);

  state.analyticsHistory = history;
  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.analyticsReport.v1',
    retentionLimit: maxAnalyticsHistoryEntries,
    reportId: summary.reportId,
    snapshot,
    delta,
    trend: summary.trend,
    timeline: history.map((entry) => ({
      at: entry.at,
      epoch: entry.epoch,
      healthMode: entry.healthMode,
      completionPercent: entry.counters.completionPercent,
      openNodeCount: entry.counters.openNodeCount,
      readyCount: entry.counters.readyCount,
      blockedCount: entry.counters.blockedCount,
      runningCount: entry.counters.runningCount,
      failedCount: entry.counters.failedCount,
      retryableFailureCount: entry.counters.retryableFailureCount,
      dispatchableCount: entry.counters.dispatchableCount,
      claimableHandoffCount: entry.counters.claimableHandoffCount,
      rejectedHandoffCount: entry.counters.rejectedHandoffCount,
      pendingHandoffAcknowledgementCount: entry.counters.pendingHandoffAcknowledgementCount,
      failedHandoffAcknowledgementCount: entry.counters.failedHandoffAcknowledgementCount,
      unknownHandoffAcknowledgementCount: entry.counters.unknownHandoffAcknowledgementCount,
      dispatchGateBlockedCount: entry.counters.dispatchGateBlockedCount,
      graphCriticalBlockerCount: entry.counters.graphCriticalBlockerCount,
      graphStructuralErrorCount: entry.counters.graphStructuralErrorCount,
      lifecyclePausedCount: entry.counters.lifecyclePausedCount,
      handoffExportBlockedCount: entry.counters.handoffExportBlockedCount,
      commandType: entry.command?.type || null,
      commandRejected: entry.command?.rejected === true
    })),
    timelineState,
    reporting: {
      ...summary,
      timelineState,
      exportReadiness
    },
    export: {
      format: 'jsonl-ready',
      schema: 'scheduler.dependencyGraph.analytics.v1',
      primaryKey: ['tenantId', 'workspaceId', 'at', 'epoch'],
      reportId: summary.reportId,
      generatedAt: now,
      columns: Object.keys(exportRows[0] || {}),
      rows: exportRows,
      summary,
      timelineState,
      readiness: exportReadiness
    }
  };
}

function buildRestartStatusContract(state, recovered, expiredLeaseRecovery, lifecycleResumed, commandResult, now) {
  const recoveredNodes = [
    ...recovered.map((entry) => ({
      nodeId: entry.nodeId,
      previousStatus: entry.previousStatus || 'running',
      recoveredStatus: entry.recoveredStatus || null,
      leaseId: entry.leaseId || null,
      providerId: entry.providerId || null,
      holderId: entry.holderId || null,
      reason: entry.reason || 'restart-recovery'
    })),
    ...expiredLeaseRecovery.map((entry) => ({
      nodeId: entry.nodeId,
      previousStatus: 'running',
      recoveredStatus: entry.recoveredStatus,
      leaseId: entry.leaseId || null,
      providerId: entry.providerId || null,
      holderId: entry.holderId || null,
      reason: 'execution-lease-expired'
    }))
  ];
  const latestRecovery = state.recoveryLog[state.recoveryLog.length - 1] || null;
  const restartSafe = Boolean(state.bootId)
    || recoveredNodes.length > 0
    || lifecycleResumed.length > 0
    || state.recoveryLog.length > 0;
  const commandLedgerTail = state.appliedCommands.slice(-10).map((entry) => ({
    id: entry.id,
    type: entry.type,
    at: entry.at,
    actorId: entry.actorId,
    status: entry.status,
    fingerprinted: typeof entry.commandFingerprint === 'string'
  }));

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.restartStatus.v1',
    state: expiredLeaseRecovery.length > 0
        ? 'lease-recovered'
      : recovered.length > 0
        ? 'recovered'
        : lifecycleResumed.length > 0
          ? 'timer-resumed'
          : commandResult.idempotent
            ? 'idempotent-replay'
            : restartSafe
              ? 'restart-safe'
              : 'stateless',
    boot: {
      bootId: state.bootId || null,
      epoch: state.epoch,
      latestRecoveryReason: latestRecovery?.reason || null,
      latestRecoveryAt: latestRecovery?.at || null,
      recoveryLogCount: state.recoveryLog.length
    },
    recoveredNodes,
    lifecycleResumedNodes: lifecycleResumed,
    idempotency: {
      commandAccepted: commandResult.applied === true,
      commandIdempotent: commandResult.idempotent === true,
      commandRejected: Boolean(commandResult.error),
      commandConflict: commandResult.details?.conflict === 'idempotency-key-reuse',
      ledgerSize: state.appliedCommands.length,
      ledgerTail: commandLedgerTail
    },
    persistence: {
      requiredFields: ['version', 'bootId', 'epoch', 'nodes', 'appliedCommands', 'recoveryLog', 'analyticsHistory'],
      commandLedgerLimit: 100,
      recoveryLogLimit: 50,
      analyticsHistoryLimit: maxAnalyticsHistoryEntries,
      nextWriteReason: commandResult.applied
        ? 'command-applied'
        : recoveredNodes.length > 0
          ? 'recovery-applied'
          : lifecycleResumed.length > 0
            ? 'lifecycle-timer-resumed'
            : commandResult.idempotent
              ? 'idempotent-replay-observed'
              : 'state-observed'
    },
    proof: {
      restartSafe,
      recoveredNodeCount: recoveredNodes.length,
      resumedNodeCount: lifecycleResumed.length,
      commandLedgerFingerprinted: commandLedgerTail.every((entry) => entry.fingerprinted),
      statusSemantics: {
        runningOnPreviousBoot: 'ready-or-blocked-after-recovery',
        expiredLease: 'ready-or-blocked-after-lease-clear',
        duplicateCommandId: 'idempotent-when-fingerprint-matches'
      }
    }
  };
}

function restartStatusRank(status) {
  const ranks = {
    pending: 0,
    blocked: 1,
    ready: 2,
    running: 3,
    failed: 4,
    skipped: 5,
    succeeded: 6
  };
  return Number.isInteger(ranks[status]) ? ranks[status] : -1;
}

function nodePersistenceImage(node, now) {
  const lease = node.executionLease || null;
  return {
    id: node.id,
    status: node.status,
    enabled: node.enabled,
    dependsOn: [...node.dependsOn].sort(),
    attempts: node.attempts,
    maxAttempts: node.maxAttempts,
    updatedAt: node.updatedAt || now,
    resultRef: node.resultRef || undefined,
    failure: node.failure || undefined,
    errorCode: node.errorCode || undefined,
    failureAction: node.failureAction || undefined,
    retryAfter: node.retryAfter || undefined,
    disabledReason: node.disabledReason || undefined,
    disabledUntil: node.disabledUntil || undefined,
    degraded: node.degraded === true,
    providerRequirements: node.providerRequirements,
    executionLease: lease
      ? {
        leaseId: lease.leaseId,
        providerId: lease.providerId || null,
        holderId: lease.holderId || null,
        acquiredAt: lease.acquiredAt,
        heartbeatAt: lease.heartbeatAt,
        expiresAt: lease.expiresAt,
        ttlMs: lease.ttlMs,
        bootId: lease.bootId || null,
        epoch: lease.epoch
      }
      : undefined
  };
}

function buildPersistenceCheckpoint(state, graphValidation, schedulingPlan, restartStatus, commandResult, now) {
  const nodes = Object.values(state.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const runningNodes = nodes.filter((node) => node.status === 'running');
  const expiredRunningNodes = runningNodes.filter((node) => leaseExpired(node.executionLease, now));
  const blockedByErrors = graphValidation.blockerSummary.errorCount > 0;
  const commandWatermark = state.appliedCommands.length > 0
    ? state.appliedCommands[state.appliedCommands.length - 1].id
    : null;
  const nodeStatusWatermark = nodes
    .map((node) => `${node.id}:${node.status}:${node.attempts}:${node.updatedAt || now}`)
    .join('|');
  const recoveryActions = [
    ...expiredRunningNodes.map((node) => ({
      type: 'recover-expired-lease',
      nodeId: node.id,
      leaseId: node.executionLease?.leaseId || null,
      action: 'clear executionLease and recompute ready/blocked status on the next reducer pass'
    })),
    ...runningNodes
      .filter((node) => node.executionLease?.bootId && state.bootId && node.executionLease.bootId !== state.bootId)
      .map((node) => ({
        type: 'recover-foreign-boot-lease',
        nodeId: node.id,
        leaseId: node.executionLease?.leaseId || null,
        leaseBootId: node.executionLease?.bootId || null,
        action: 'treat previous-boot running state as unowned and recompute readiness before dispatch'
      })),
    ...(graphValidation.cycle
      ? [{
        type: 'hold-cyclic-frontier',
        nodeId: null,
        cycle: graphValidation.cycle,
        action: 'persist graphValidation and block dispatch until one dependency edge is removed or inverted'
      }]
      : [])
  ];

  return {
    generatedAt: now,
    schema: 'scheduler.dependencyGraph.persistenceCheckpoint.v1',
    checkpointId: [
      state.tenantId || 'global',
      state.workspaceId || 'default',
      state.epoch,
      commandWatermark || 'no-command',
      nodes.length,
      graphValidation.readyNodeIds.join(',')
    ].join(':'),
    stateVersion,
    durable: commandResult.applied === true
      || restartStatus.recoveredNodes.length > 0
      || restartStatus.lifecycleResumedNodes.length > 0
      || expiredRunningNodes.length > 0,
    writeReason: restartStatus.persistence.nextWriteReason,
    commandWatermark,
    nodeStatusWatermark,
    statusSemantics: {
      restartSafeStatuses: ['pending', 'ready', 'blocked', 'failed', 'skipped', 'succeeded'],
      volatileStatuses: ['running'],
      runningRequiresLease: true,
      runningLeaseRecovery: 'clear lease and derive ready/blocked when boot changes or lease expires',
      readyFrontierSource: graphValidation.schema
    },
    persistableState: {
      version: stateVersion,
      bootId: state.bootId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      epoch: state.epoch,
      settings: state.settings,
      providerContracts: state.providerContracts,
      nodes: nodes.map((node) => nodePersistenceImage(node, now)),
      appliedCommands: state.appliedCommands,
      recoveryLog: state.recoveryLog,
      analyticsHistory: state.analyticsHistory,
      dependencyBoundary: state.dependencyBoundary
    },
    restartIndex: {
      readyNodeIds: graphValidation.readyNodeIds,
      blockedNodeIds: graphValidation.blockedNodeIds,
      dispatchableNodeIds: schedulingPlan.dispatchable,
      runningNodeIds: runningNodes.map((node) => node.id),
      expiredLeaseNodeIds: expiredRunningNodes.map((node) => node.id),
      terminalNodeIds: nodes.filter((node) => terminalStatuses.has(node.status)).map((node) => node.id),
      highestStatusRank: Math.max(-1, ...nodes.map((node) => restartStatusRank(node.status)))
    },
    recoveryPlan: {
      requiredOnBoot: recoveryActions.length > 0,
      actions: recoveryActions,
      blockerSummary: graphValidation.blockerSummary,
      nextAction: recoveryActions[0]?.action || restartStatus.persistence.nextWriteReason
    },
    idempotency: {
      ledgerSize: state.appliedCommands.length,
      latestCommandId: commandWatermark,
      latestCommandFingerprint: state.appliedCommands[state.appliedCommands.length - 1]?.commandFingerprint || null,
      duplicateCommandSemantics: 'return idempotent without mutating persisted node state when commandId and fingerprint match'
    },
    validation: {
      graphValid: graphValidation.valid,
      structurallyValid: graphValidation.structurallyValid,
      blockedByErrors,
      issueCodes: [...new Set([
        ...graphValidation.issues.map((issue) => issue.code),
        ...graphValidation.blockerSummary.codes
      ])].filter(Boolean).sort()
    }
  };
}

export function describeDependencyGraphSurface(input = {}) {
  const now = asIsoTimestamp(input.now);
  const boundary = normalizeBoundaryContext(input);
  const state = normalizePersistedState(input, now, boundary);
  const recovered = boundary.deniedReason ? [] : applyRecovery(state, input, now);
  const commandResult = boundary.deniedReason
    ? { applied: false, idempotent: false, error: boundary.deniedReason, boundary: 'read-denied' }
    : input.command
      ? applyCommand(state, input.command, now, boundary)
      : { applied: false, idempotent: false, reason: 'no command supplied' };
  const lifecycleResumed = boundary.deniedReason ? [] : applyLifecycleTimers(state, now);
  const expiredLeaseRecovery = boundary.deniedReason ? [] : recoverExpiredExecutionLeases(state, now);
  const derived = refreshDerivedStatuses(state, now);
  const graphValidation = derived.graphValidation;
  const nodes = Object.values(state.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const statusCounts = nodes.reduce((counts, node) => {
    counts[node.status] = (counts[node.status] || 0) + 1;
    return counts;
  }, {});
  const openNodeCount = nodes.filter((node) => !terminalStatuses.has(node.status)).length;
  const lifecycleCommandReceipt = buildCommandLifecycleReceipt(input.command, commandResult, state, boundary, now);
  const health = buildOperationalHealth(state, commandResult, derived, now, lifecycleCommandReceipt);
  const schedulingPlan = buildSchedulingPlan(state, nodes, derived, health, now);
  const lifecycleControls = buildLifecycleControlState(state, nodes, schedulingPlan, health, boundary, now, lifecycleCommandReceipt);
  const retryableFailureCount = health.failures.filter((failure) => failure.retryable).length;
  const providerNegotiation = negotiateProviderCapabilities(state, schedulingPlan, now);
  const externalHandoff = buildExternalHandoffState(state, schedulingPlan, providerNegotiation, boundary, now);
  const clientWorkflowHandoff = buildClientWorkflowHandoff(state, nodes, schedulingPlan, externalHandoff, boundary, input, now, lifecycleCommandReceipt);
  const analytics = buildAnalyticsReport(
    state,
    buildAnalyticsSnapshot(
      state,
      nodes,
      derived,
      health,
      commandResult,
      [...recovered, ...expiredLeaseRecovery.map((entry) => entry.nodeId)],
      input.command?.type,
      now,
      {
        schedulingPlan,
        providerNegotiation,
        externalHandoff,
        clientWorkflowHandoff
      }
    ),
    now
  );
  const previewAcceptance = buildPreviewAcceptanceContract(
    state,
    nodes,
    health,
    schedulingPlan,
    providerNegotiation,
    externalHandoff,
    clientWorkflowHandoff,
    boundary,
    commandResult,
    now,
    lifecycleCommandReceipt
  );
  const operationalErrors = buildOperationalErrorContract(
    state,
    nodes,
    health,
    schedulingPlan,
    providerNegotiation,
    externalHandoff,
    boundary,
    commandResult,
    now
  );
  const routePreviewAcceptance = buildRoutePreviewAcceptancePacket(
    previewAcceptance,
    clientWorkflowHandoff,
    externalHandoff,
    lifecycleControls,
    operationalErrors,
    boundary,
    now
  );
  const restartStatus = buildRestartStatusContract(
    state,
    recovered,
    expiredLeaseRecovery,
    lifecycleResumed,
    commandResult,
    now
  );
  const persistenceCheckpoint = buildPersistenceCheckpoint(
    state,
    graphValidation,
    schedulingPlan,
    restartStatus,
    commandResult,
    now
  );
  state.persistenceCheckpoint = persistenceCheckpoint;

  return {
    ok: !commandResult.error && !health.degraded,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel scheduler dependency graph state reducer v1',
    status: health.degraded
      ? 'degraded'
      : retryableFailureCount > 0
        ? 'retryable-failure'
        : health.failures.length > 0
          ? 'retry-waiting'
          : openNodeCount === 0
            ? 'settled'
            : derived.ready.length > 0
              ? 'runnable'
              : 'waiting',
    state,
    readyQueue: derived.ready,
    blockedNodes: derived.blocked,
    dependencyBoundary: state.dependencyBoundary,
    graphValidation,
    schedulingPlan,
    lifecycleControls,
    lifecycleCommandReceipt,
    providerNegotiation,
    externalHandoff,
    clientWorkflowHandoff,
    previewAcceptance,
    routePreviewAcceptance,
    operationalErrors,
    restartStatus,
    persistenceCheckpoint,
    health,
    analytics,
    boundary: {
      scoped: boundary.scoped,
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null,
      actorId: boundary.actorId || null,
      canRead: boundary.canRead,
      canWrite: boundary.canWrite,
      canExportHandoff: boundary.canExportHandoff,
      requiredHandoffExportPermission: graphHandoffExportPermission
    },
    audit: {
      command: commandResult,
      recovered,
      expiredLeaseRecovery,
      lifecycleResumed,
      statusCounts,
      settingsValidation: state.settings.validation,
      lifecycleCommandReceipt,
      lifecycleNextCommand: lifecycleControls.nextCommand,
      lifecycleDisabledNodeIds: lifecycleControls.disabledNodeIds,
      lifecycleBlockedControlSummary: lifecycleControls.blockedControlSummary,
      analyticsSnapshot: analytics.snapshot,
      analyticsReportId: analytics.reportId,
      analyticsTrend: analytics.trend,
      analyticsTimelineCount: analytics.timeline.length,
      analyticsTimelineState: analytics.timelineState.state,
      analyticsTimelineAlerts: analytics.timelineState.alerts,
      analyticsExportWatermark: analytics.timelineState.exportWatermark,
      analyticsExportRowCount: analytics.export.rows.length,
      analyticsExportReadiness: analytics.export.readiness,
      analyticsReportingWindow: analytics.reporting.window,
      dependencyBoundary: state.dependencyBoundary,
      providerNegotiation,
      externalHandoffState: externalHandoff.state,
      handoffExportBoundary: externalHandoff.handoffExportBoundary,
      handoffBoundaryManifest: externalHandoff.boundaryManifest,
      clientWorkflowHandoffState: clientWorkflowHandoff.status,
      clientWorkflowQueueState: clientWorkflowHandoff.workflowQueue.state,
      clientWorkflowQueueActionableCount: clientWorkflowHandoff.workflowQueue.actionableCount,
      clientWorkflowQueueBlockedCount: clientWorkflowHandoff.workflowQueue.blockedCount,
      clientStateCursor: clientWorkflowHandoff.statePatch.cursor,
      previewAcceptanceState: previewAcceptance.acceptance.state,
      routePreviewAcceptanceState: routePreviewAcceptance.routeState,
      routePreviewCanSubmitAcceptance: routePreviewAcceptance.canSubmitAcceptance,
      routeAcceptanceDecisionState: routePreviewAcceptance.acceptanceDecisionMatrix.state,
      routeAcceptanceSelectableStepCount: routePreviewAcceptance.acceptanceDecisionMatrix.steps.filter((step) => step.selectable).length,
      dispatchHealthGateState: schedulingPlan.dispatchHealthGate.state,
      dispatchHealthGateDeniedReasonCount: schedulingPlan.dispatchHealthGate.deniedReasons.length,
      validationSummary: previewAcceptance.validationSummary,
      routeValidationSummary: routePreviewAcceptance.validationSummary,
      operationalErrorState: operationalErrors.state,
      operationalErrorCount: operationalErrors.errors.length,
      operationalRetryCommandCount: operationalErrors.retry.commandCount,
      graphValidation,
      readyFrontier: graphValidation.readyFrontier,
      graphBlockerSummary: graphValidation.blockerSummary,
      restartStatusState: restartStatus.state,
      restartPersistence: restartStatus.persistence,
      persistenceCheckpoint: {
        checkpointId: persistenceCheckpoint.checkpointId,
        durable: persistenceCheckpoint.durable,
        writeReason: persistenceCheckpoint.writeReason,
        recoveryRequiredOnBoot: persistenceCheckpoint.recoveryPlan.requiredOnBoot,
        recoveryActionCount: persistenceCheckpoint.recoveryPlan.actions.length
      },
      degradedMode: operationalErrors.degradedMode,
      nodeCount: nodes.length,
      restartSafe: restartStatus.proof.restartSafe,
      handoff: buildAuditHandoff(boundary, commandResult, state, now)
    },
    proof: {
      stateVersion,
      persistedFields: ['version', 'bootId', 'tenantId', 'workspaceId', 'settings', 'providerContracts', 'epoch', 'nodes', 'appliedCommands', 'recoveryLog', 'analyticsHistory', 'dependencyBoundary', 'persistenceCheckpoint'],
      idempotencyKey: typeof input.command?.commandId === 'string' ? input.command.commandId : null,
      boundaryKeys: ['tenantId', 'workspaceId', 'actorId', 'roles', 'permissions'],
      requiredWritePermission: graphWritePermission,
      requiredHandoffExportPermission: graphHandoffExportPermission,
      terminalStatuses: [...terminalStatuses],
      activeStatuses: [...activeStatuses],
      graphValidationSchema: graphValidation.schema,
      graphValidationFields: ['valid', 'cycle', 'cycleNodes', 'readyFrontier', 'readyNodeIds', 'blockedNodeIds', 'blockersByNode', 'blockerSummary', 'issues'],
      dependencyBoundarySchema: state.dependencyBoundary.schema,
      dependencyBoundaryFields: ['scoped', 'tenantId', 'workspaceId', 'hiddenDependencyCount', 'rejectedEdgeCount', 'hiddenNodeIds', 'hiddenDependencies', 'rejectedEdges', 'issueCodes', 'nextAction'],
      readyFrontierPolicySchema: schedulingPlan.frontierPolicy.schema,
      readyFrontierOrder: schedulingPlan.frontierPolicy.order,
      analyticsReportSchema: analytics.schema,
      analyticsSchema: analytics.export.schema,
      analyticsExportSummarySchema: analytics.export.summary.schema,
      analyticsTimelineStateSchema: analytics.timelineState.schema,
      analyticsExportReadinessSchema: analytics.export.readiness.schema,
      analyticsCounterFields,
      analyticsTimelineFields: ['at', 'epoch', 'healthMode', 'completionPercent', 'openNodeCount', 'readyCount', 'blockedCount', 'runningCount', 'failedCount', 'retryableFailureCount', 'dispatchableCount', 'claimableHandoffCount', 'rejectedHandoffCount', 'pendingHandoffAcknowledgementCount', 'failedHandoffAcknowledgementCount', 'unknownHandoffAcknowledgementCount', 'dispatchGateBlockedCount', 'graphCriticalBlockerCount', 'graphStructuralErrorCount', 'lifecyclePausedCount', 'handoffExportBlockedCount', 'commandType', 'commandRejected'],
      analyticsTimelineStateFields: ['state', 'exportWatermark', 'velocity', 'backlog', 'milestones', 'alerts', 'partitions'],
      analyticsExportReadinessFields: ['state', 'exportable', 'reportId', 'rowCount', 'columnCount', 'missingCounterColumns', 'latestSnapshot', 'watermark', 'blockers', 'nextAction'],
      analyticsExportColumns: analytics.export.columns,
      lifecycleCommands: [...schedulingControlCommands, ...nodeLifecycleCommands],
      schedulingControls: ['schedulingEnabled', 'autoPromoteReady', 'maxConcurrentRuns', 'requireResultRefOnSuccess'],
      retryCommand: 'retry-node',
      failureFields: ['failure', 'errorCode', 'failureAction', 'retryAfter', 'attempts', 'maxAttempts', 'degraded'],
      nodeLifecycleFields: ['enabled', 'disabledReason', 'disabledUntil', 'executionLease'],
      lifecycleControlsSchema: lifecycleControls.schema,
      lifecycleCommandReceiptSchema: lifecycleCommandReceipt.schema,
      lifecycleCommandReceiptFields: ['commandId', 'commandType', 'lifecycleDomain', 'accepted', 'rejected', 'target', 'settings', 'ledger', 'proof', 'allowedFollowups', 'nextAction'],
      lifecycleControlFields: ['settings', 'capacity', 'disableReasons', 'disabledNodeIds', 'blockedControlSummary', 'nodeControls', 'commandReceipt', 'nextCommand'],
      lifecycleNodeControlFields: ['nodeId', 'status', 'enabled', 'blockedByDependencies', 'blockedActionState', 'blockerControls', 'controls'],
      lifecycleDisableReasons: lifecycleControls.disableReasons,
      executionLeaseSchema: 'scheduler.dependencyGraph.executionLease.v1',
      executionLeaseFields: ['leaseId', 'providerId', 'holderId', 'acquiredAt', 'heartbeatAt', 'expiresAt', 'ttlMs', 'bootId', 'epoch'],
      executionLeaseDefaults: {
        ttlMs: defaultExecutionLeaseTtlMs,
        maxTtlMs: maxExecutionLeaseTtlMs,
        recoveryReason: 'execution-lease-expired'
      },
      providerContractSchema: providerNegotiation.schema,
      externalHandoffSchema: externalHandoff.schema,
      providerDispatchManifestSchema: externalHandoff.dispatchManifest.schema,
      providerDispatchManifestFields: ['manifestId', 'providerId', 'stateEpoch', 'claimableNodeCount', 'rejectedNodeCount', 'deliveryMode', 'acknowledgementRequired', 'providerCapacity', 'commandIds', 'leaseIds', 'receiptDueAt', 'proofSchema', 'boundaryProofSchema', 'boundaryProofs', 'auditEvents'],
      handoffBoundaryManifestSchema: externalHandoff.boundaryManifest.schema,
      handoffExportBoundarySchema: externalHandoff.handoffExportBoundary.schema,
      handoffExportBoundaryFields: ['allowed', 'reason', 'candidateVisibility', 'dispatchableCount', 'requiredPermissions', 'auditEvent'],
      handoffBoundaryManifestFields: ['scope', 'handoffExportBoundary', 'candidateNodeCount', 'candidateVisibility', 'eligibleNodeCount', 'rejectedNodeCount', 'eligibleProofs', 'rejectedClaims', 'auditEvents'],
      providerHandoffProofSchema: 'scheduler.dependencyGraph.handoffProof.v1',
      providerHandoffPolicySchema: 'scheduler.dependencyGraph.providerHandoffPolicy.v1',
      providerHandoffPolicyFields: ['deliveryMode', 'acknowledgementRequired', 'maxBatchSize', 'receiptTtlMs', 'replayWindowMs', 'requiresHandoffRef', 'receiptStatuses', 'idempotency'],
      providerBoundaryClaimProofSchema: 'scheduler.dependencyGraph.boundaryClaimProof.v1',
      clientWorkflowHandoffSchema: clientWorkflowHandoff.schema,
      clientWorkflowQueueSchema: clientWorkflowHandoff.workflowQueue.schema,
      clientWorkflowQueueFields: ['state', 'cursor', 'currentCursor', 'requestedNodeIds', 'actionableCount', 'blockedCount', 'entries', 'nextCommand', 'nextAction'],
      clientRuntimeSchema: clientWorkflowHandoff.clientRuntime.schema,
      handoffAcknowledgementSchema: clientWorkflowHandoff.actions.acknowledgementContract.schema,
      handoffAcknowledgementStatuses: clientWorkflowHandoff.actions.acknowledgementContract.allowedStatuses,
      handoffAcknowledgementFields: ['handoffId', 'nodeId', 'providerId', 'commandId', 'status', 'acknowledged', 'receiptRef', 'source', 'receivedAt', 'errorCode', 'message'],
      previewAcceptanceSchema: previewAcceptance.schema,
      validationSummarySchema: previewAcceptance.validationSummary.schema,
      previewAcceptanceFields: ['acceptance', 'readiness', 'validationSummary', 'preview', 'nextSteps'],
      routePreviewAcceptanceSchema: routePreviewAcceptance.schema,
      routePreviewAcceptanceFields: ['previewId', 'routeState', 'cursor', 'canSubmitAcceptance', 'validationSummary', 'readinessGates', 'dispatchHealthGate', 'acceptanceRequirements', 'acceptanceDecisionMatrix', 'nextStepContracts', 'routeActions'],
      routeAcceptanceRequirementSchema: routePreviewAcceptance.acceptanceRequirements.schema,
      routeAcceptanceDecisionMatrixSchema: routePreviewAcceptance.acceptanceDecisionMatrix.schema,
      routeAcceptanceDecisionMatrixFields: ['state', 'submitAllowed', 'selectedDefault', 'failedGates', 'globalBlockers', 'receiptState', 'cursorState', 'steps', 'nextAction'],
      routeAcceptanceRequiredFields: routePreviewAcceptance.acceptanceRequirements.requiredBodyFields,
      routeNextStepTypes: [...new Set(routePreviewAcceptance.nextStepContracts.map((step) => step.type))],
      operationalErrorsSchema: operationalErrors.schema,
      operationalErrorFields: ['state', 'degradedMode', 'dispatchGate', 'retry', 'errors', 'nextAction'],
      operationalErrorCodes: [...new Set(operationalErrors.errors.map((error) => error.code))],
      dispatchHealthGateSchema: schedulingPlan.dispatchHealthGate.schema,
      dispatchHealthGateFields: ['state', 'dispatchAllowed', 'blocked', 'capacity', 'frontier', 'failures', 'deniedReasons', 'nextAction'],
      restartStatusSchema: restartStatus.schema,
      restartStatusFields: ['boot', 'recoveredNodes', 'lifecycleResumedNodes', 'idempotency', 'persistence', 'proof'],
      persistenceCheckpointSchema: persistenceCheckpoint.schema,
      persistenceCheckpointFields: ['checkpointId', 'durable', 'writeReason', 'persistableState', 'restartIndex', 'recoveryPlan', 'idempotency', 'validation'],
      explainableNextStepTypes: ['accept-provider-handoff', 'run-locally', 'retry-failed-node'],
      clientStatePatchFields: ['cursor', 'epoch', 'providerId', 'handoffState', 'readyQueue', 'dispatchable', 'visibleNodeCount', 'workflowQueueState', 'workflowQueueCursor', 'nextWorkflowNodeId'],
      providerRequiredCapabilities: requiredProviderCapabilities
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeDependencyGraphSurface;
