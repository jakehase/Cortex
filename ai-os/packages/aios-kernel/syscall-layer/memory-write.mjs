export const surfaceId = "aios_syscall-layer_memory-write_027";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "memory-write";

const DEFAULT_ALLOWED_ROLES = ['kernel', 'service', 'workspace-admin', 'memory-writer'];
const DEFAULT_REQUIRED_CAPABILITY = 'memory:write';
const DEFAULT_MEMORY_NAMESPACE = 'hosted-kernel';
const DEFAULT_PROTECTED_NAMESPACES = ['hosted-kernel', 'kernel'];
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 10_000;
const DEFAULT_MAX_WRITE_ATTEMPTS = 5;
const DEFAULT_MAX_PENDING_COMMANDS = 50;
const DEGRADED_MAX_PAYLOAD_BYTES = 32 * 1024;
const STALE_PREPARED_COMMAND_MS = 5 * 60 * 1000;
const SUPPORTED_LIFECYCLE_COMMANDS = ['enable', 'disable', 'pause', 'resume', 'drain', 'schedule'];
const SUPPORTED_DRAIN_MODES = ['pending-only', 'pending-and-scheduled', 'all-held'];
const SUPPORTED_PROVIDER_CAPABILITIES = [
  'memory.write.prepare',
  'memory.write.commit',
  'memory.write.audit',
  'memory.write.sync-metadata',
  'memory.write.ttl',
  'memory.write.expected-revision',
  'memory.write.scheduled-handoff',
  'memory.write.external-handoff',
  'memory.write.lifecycle-command',
  'memory.write.protected-namespace'
];
const NON_RETRYABLE_FAILURE_CODES = [
  'checksum_mismatch',
  'journal_corrupt',
  'state_corrupt',
  'schema_incompatible'
];
const FAILURE_RECOVERY_ACTIONS = {
  checksum_mismatch: 'quarantine-corrupt-journal-and-rebuild-index',
  journal_corrupt: 'restore-journal-from-replica-before-write',
  state_corrupt: 'restore-memory-state-snapshot-before-write',
  schema_incompatible: 'deploy-compatible-memory-schema-or-migration'
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(asString).filter(Boolean))];
}

function normalizeActor(input = {}) {
  const source = isObject(input.actor) ? input.actor : input;
  const roles = uniqueStrings(source.roles);
  const capabilities = uniqueStrings(source.capabilities || source.permissions);
  return {
    actorId: asString(source.actorId || source.id || source.subject) || 'anonymous',
    tenantId: asString(source.tenantId),
    workspaceId: asString(source.workspaceId),
    roles,
    capabilities,
    delegationId: asString(source.delegationId || source.sessionId)
  };
}

function normalizeScope(input = {}, actor = {}) {
  const requested = isObject(input.scope) ? input.scope : input;
  return {
    tenantId: asString(requested.tenantId) || actor.tenantId,
    workspaceId: asString(requested.workspaceId) || actor.workspaceId,
    namespace: asString(requested.namespace) || DEFAULT_MEMORY_NAMESPACE,
    memoryKey: asString(requested.memoryKey || requested.key || input.memoryKey || input.key)
  };
}

function normalizeWrite(input = {}) {
  const write = isObject(input.write) ? input.write : input;
  const value = Object.hasOwn(write, 'value') ? write.value : write.payload;
  return {
    value,
    valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    mode: asString(write.mode) || 'replace',
    reason: asString(write.reason || input.reason),
    expectedRevision: asString(write.expectedRevision || input.expectedRevision),
    commandId: asString(write.commandId || input.commandId || input.idempotencyKey),
    scheduledAt: asString(write.scheduledAt || input.scheduledAt),
    ttlSeconds: Number.isFinite(write.ttlSeconds) && write.ttlSeconds > 0 ? Math.floor(write.ttlSeconds) : undefined
  };
}

function normalizeScopeBindings(input = {}, actor = {}) {
  const policy = isObject(input.policy) ? input.policy : {};
  const rawBindings = [
    ...(Array.isArray(input.scopeBindings) ? input.scopeBindings : []),
    ...(Array.isArray(input.workspaceBindings) ? input.workspaceBindings : []),
    ...(Array.isArray(policy.scopeBindings) ? policy.scopeBindings : []),
    ...(Array.isArray(actor.scopeBindings) ? actor.scopeBindings : []),
    ...(Array.isArray(actor.workspaceBindings) ? actor.workspaceBindings : [])
  ];
  return rawBindings
    .filter(isObject)
    .map((binding) => ({
      tenantId: asString(binding.tenantId) || actor.tenantId,
      workspaceId: asString(binding.workspaceId),
      namespace: asString(binding.namespace || binding.memoryNamespace),
      role: asString(binding.role || binding.permissionRole),
      capability: asString(binding.capability || binding.permission),
      delegationId: asString(binding.delegationId || binding.grantId || binding.id),
      expiresAt: asString(binding.expiresAt),
      readOnly: binding.readOnly === true,
      allowProtectedNamespace: binding.allowProtectedNamespace === true
    }))
    .filter((binding) => binding.workspaceId || binding.namespace || binding.role || binding.capability || binding.delegationId);
}

function bindingMatchesScope(binding, scope, policy, now) {
  const tenantMatches = !binding.tenantId || !scope.tenantId || binding.tenantId === scope.tenantId;
  const workspaceMatches = !binding.workspaceId || binding.workspaceId === scope.workspaceId || binding.workspaceId === '*';
  const namespaceMatches = !binding.namespace || binding.namespace === scope.namespace || binding.namespace === '*';
  const roleMatches = !binding.role || policy.allowedRoles.includes(binding.role);
  const capabilityMatches = !binding.capability || binding.capability === policy.requiredCapability || binding.capability === 'memory:write:any-workspace';
  const active = !binding.expiresAt || binding.expiresAt > now;
  return tenantMatches && workspaceMatches && namespaceMatches && roleMatches && capabilityMatches && active;
}

function resolveScopeBinding({ now, actor, scope, policy, scopeBindings }) {
  const matchingBindings = scopeBindings.filter((binding) => bindingMatchesScope(binding, scope, policy, now));
  const writeBinding = matchingBindings.find((binding) => !binding.readOnly);
  const crossWorkspace = Boolean(actor.workspaceId && scope.workspaceId && actor.workspaceId !== scope.workspaceId);
  const delegatedByCapability = crossWorkspace && actor.capabilities.includes('memory:write:any-workspace');
  const delegatedByBinding = crossWorkspace && Boolean(writeBinding?.delegationId || writeBinding?.workspaceId === scope.workspaceId);
  const protectedNamespace = policy.protectedNamespaces.includes(scope.namespace);
  const protectedNamespaceAllowed = !protectedNamespace
    || actor.roles.includes('kernel')
    || actor.capabilities.includes('memory:write:protected-namespace')
    || matchingBindings.some((binding) => binding.allowProtectedNamespace && !binding.readOnly);
  return {
    contractType: 'kernel.memory.write.scope-binding.v1',
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey || null,
    crossWorkspace,
    protectedNamespace,
    protectedNamespaceAllowed,
    matchedBindingCount: matchingBindings.length,
    writeBindingId: writeBinding?.delegationId || null,
    bindingDelegated: delegatedByBinding,
    capabilityDelegated: delegatedByCapability,
    workspaceWriteAuthorized: !crossWorkspace || (delegatedByCapability && delegatedByBinding),
    readOnlyMatched: matchingBindings.length > 0 && !writeBinding
  };
}

function payloadSizeBytes(value) {
  if (typeof value === 'undefined') return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

function classifyPayloadSize(bytes) {
  if (bytes === 0) return 'empty';
  if (bytes <= 1024) return 'small';
  if (bytes <= 32 * 1024) return 'medium';
  return 'large';
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeDependencyHealth(input = {}) {
  const source = isObject(input.operationalHealth) ? input.operationalHealth
    : isObject(input.health) ? input.health
      : {};
  const persistence = isObject(source.persistence) ? source.persistence : {};
  const journal = isObject(source.journal) ? source.journal : {};
  const storage = isObject(source.storage) ? source.storage : {};
  return {
    persistenceAvailable: persistence.available !== false && source.persistenceAvailable !== false,
    journalWritable: journal.writable !== false && source.journalWritable !== false,
    storageWritable: storage.writable !== false && source.storageWritable !== false,
    degradedMode: source.degradedMode === true || input.degradedMode === true,
    circuitOpenUntil: asString(source.circuitOpenUntil || input.circuitOpenUntil),
    lastFailureCode: asString(source.lastFailureCode || persistence.lastFailureCode || journal.lastFailureCode || storage.lastFailureCode),
    lastFailureAt: asString(source.lastFailureAt || persistence.lastFailureAt || journal.lastFailureAt || storage.lastFailureAt),
    failureCount: boundedInteger(source.failureCount ?? input.failureCount, 0, 0, 1_000),
    attempt: boundedInteger(source.attempt ?? input.attempt, 1, 1, 1_000),
    retryBaseMs: boundedInteger(source.retryBaseMs ?? input.retryBaseMs, DEFAULT_RETRY_BASE_MS, 25, DEFAULT_RETRY_MAX_MS),
    retryMaxMs: boundedInteger(source.retryMaxMs ?? input.retryMaxMs, DEFAULT_RETRY_MAX_MS, 100, 60_000),
    maxAttempts: boundedInteger(source.maxAttempts ?? input.maxAttempts, DEFAULT_MAX_WRITE_ATTEMPTS, 1, 25),
    maxPendingCommands: boundedInteger(source.maxPendingCommands ?? input.maxPendingCommands, DEFAULT_MAX_PENDING_COMMANDS, 1, 1_000)
  };
}

function normalizeProviderContract(input = {}) {
  const source = isObject(input.providerContract) ? input.providerContract
    : isObject(input.provider) ? input.provider
      : isObject(input.serviceContract) ? input.serviceContract
        : isObject(input.integrationProvider) ? input.integrationProvider
          : {};
  const sync = isObject(source.sync) ? source.sync
    : isObject(source.syncMetadata) ? source.syncMetadata
      : isObject(input.syncMetadata) ? input.syncMetadata
        : {};
  const executionMode = asString(source.executionMode || source.mode || source.commitMode) || 'inline';
  const sourceCapabilities = uniqueStrings([
    ...(Array.isArray(source.capabilities) ? source.capabilities : []),
    ...(Array.isArray(source.providedCapabilities) ? source.providedCapabilities : [])
  ]);
  const advertisedCapabilities = sourceCapabilities.length ? sourceCapabilities : SUPPORTED_PROVIDER_CAPABILITIES;
  return {
    contractType: 'kernel.memory.write.provider-contract.v1',
    providerId: asString(source.providerId || source.id || source.name) || 'hosted-kernel-memory-provider',
    providerKind: asString(source.providerKind || source.kind || source.type) || 'hosted-kernel',
    executionMode: ['inline', 'external-handoff', 'mirror-only'].includes(executionMode) ? executionMode : 'inline',
    disabled: source.disabled === true || source.available === false,
    advertisedCapabilities,
    requiredCapabilities: uniqueStrings(source.requiredCapabilities || input.requiredProviderCapabilities),
    handoffQueue: asString(source.handoffQueue || source.queue || source.topic) || 'kernel.memory.write.handoff',
    serviceEndpoint: asString(source.serviceEndpoint || source.endpoint || source.url),
    sync: {
      cursor: asString(sync.cursor || sync.syncCursor || source.cursor),
      sequence: Number.isFinite(sync.sequence) ? Math.max(0, Math.floor(sync.sequence)) : null,
      watermark: asString(sync.watermark || sync.highWatermark || source.watermark),
      etag: asString(sync.etag || source.etag),
      lastSyncedAt: asString(sync.lastSyncedAt || sync.syncedAt || source.lastSyncedAt),
      externalRevision: asString(sync.externalRevision || source.externalRevision)
    }
  };
}

function normalizeClientRuntimeState(input = {}, actor = {}, scope = {}) {
  const source = isObject(input.clientRuntime) ? input.clientRuntime
    : isObject(input.clientState) ? input.clientState
      : isObject(input.requestClient) ? input.requestClient
        : {};
  const requestedReturn = isObject(source.returnRoute) ? source.returnRoute : {};
  const optimistic = isObject(source.optimisticUpdate) ? source.optimisticUpdate
    : isObject(source.optimisticMutation) ? source.optimisticMutation
      : {};
  return {
    stateType: 'kernel.memory.write.client-runtime-state.v1',
    requestId: asString(source.requestId || input.requestId || input.traceId),
    sessionId: asString(source.sessionId || actor.delegationId),
    viewId: asString(source.viewId || source.panelId || source.screenId),
    workflowId: asString(source.workflowId || input.workflowId),
    correlationId: asString(source.correlationId || input.correlationId),
    returnRoute: {
      routeName: asString(requestedReturn.routeName || requestedReturn.name || source.returnRouteName) || 'memory.write.result',
      workspaceId: asString(requestedReturn.workspaceId) || scope.workspaceId || actor.workspaceId,
      href: asString(requestedReturn.href || requestedReturn.url),
      replaceHistory: requestedReturn.replaceHistory === true || source.replaceHistory === true
    },
    optimisticUpdate: {
      mutationId: asString(optimistic.mutationId || optimistic.id || source.optimisticMutationId),
      enabled: optimistic.enabled !== false && source.optimisticUpdateEnabled !== false,
      rollbackOnDeny: optimistic.rollbackOnDeny !== false,
      invalidateKeys: uniqueStrings(optimistic.invalidateKeys || source.invalidateKeys)
    },
    requestedPresentation: asString(source.presentation || source.resultPresentation) || 'inline-status',
    clientCapabilities: uniqueStrings(source.capabilities || source.clientCapabilities),
    handoffPreference: asString(source.handoffPreference || source.workflowHandoff) || 'auto'
  };
}

function buildProviderNegotiation({ now, scope, write, commandId, lifecycleControl, providerContract }) {
  const required = uniqueStrings([
    'memory.write.prepare',
    'memory.write.commit',
    'memory.write.audit',
    'memory.write.sync-metadata',
    write.ttlSeconds ? 'memory.write.ttl' : '',
    write.expectedRevision ? 'memory.write.expected-revision' : '',
    lifecycleControl.lifecycleCommand ? 'memory.write.lifecycle-command' : '',
    lifecycleControl.scheduling.scheduledAt ? 'memory.write.scheduled-handoff' : '',
    providerContract.executionMode === 'external-handoff' ? 'memory.write.external-handoff' : '',
    providerContract.executionMode === 'mirror-only' ? 'memory.write.external-handoff' : '',
    scope.namespace && DEFAULT_PROTECTED_NAMESPACES.includes(scope.namespace) ? 'memory.write.protected-namespace' : '',
    ...providerContract.requiredCapabilities
  ]);
  const missingCapabilities = required.filter((capability) => !providerContract.advertisedCapabilities.includes(capability));
  const syncMetadata = {
    syncType: 'kernel.memory.write.provider-sync.v1',
    stateKey: memoryStateKey(scope),
    commandId,
    providerId: providerContract.providerId,
    cursor: providerContract.sync.cursor || null,
    sequence: providerContract.sync.sequence,
    watermark: providerContract.sync.watermark || null,
    etag: providerContract.sync.etag || null,
    externalRevision: providerContract.sync.externalRevision || null,
    lastSyncedAt: providerContract.sync.lastSyncedAt || null,
    nextSequence: Number.isFinite(providerContract.sync.sequence) ? providerContract.sync.sequence + 1 : null,
    stale: providerContract.sync.lastSyncedAt ? compareIsoInstant(providerContract.sync.lastSyncedAt, now) > 0 : false
  };
  const executionBlocked = providerContract.disabled || missingCapabilities.length > 0 || syncMetadata.stale;
  return {
    negotiationType: 'kernel.memory.write.provider-negotiation.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    provider: {
      providerId: providerContract.providerId,
      providerKind: providerContract.providerKind,
      executionMode: providerContract.executionMode,
      handoffQueue: providerContract.handoffQueue,
      serviceEndpoint: providerContract.serviceEndpoint || null,
      disabled: providerContract.disabled
    },
    requiredCapabilities: required,
    advertisedCapabilities: providerContract.advertisedCapabilities,
    missingCapabilities,
    syncMetadata,
    executionBlocked,
    localApplyAllowed: providerContract.executionMode === 'inline' && !executionBlocked,
    externalHandoffRequired: ['external-handoff', 'mirror-only'].includes(providerContract.executionMode),
    nextAction: executionBlocked
      ? providerContract.disabled ? 'select-available-memory-provider'
        : syncMetadata.stale ? 'refresh-provider-sync-metadata'
          : 'negotiate-memory-provider-capabilities'
      : providerContract.executionMode === 'external-handoff' ? 'enqueue-external-memory-write'
        : providerContract.executionMode === 'mirror-only' ? 'mirror-memory-write-to-provider'
          : 'commit-with-hosted-kernel-provider'
  };
}

function buildExternalProviderHandoff({ now, actor, scope, write, commandId, decision, providerNegotiation, restartSafeStatus, memoryMutationPlan }) {
  const handoffReady = decision === 'accepted'
    && providerNegotiation.externalHandoffRequired
    && !providerNegotiation.executionBlocked
    && restartSafeStatus.safeToApply;
  return {
    handoffType: 'kernel.memory.write.external-provider-handoff.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    providerId: providerNegotiation.provider.providerId,
    providerKind: providerNegotiation.provider.providerKind,
    executionMode: providerNegotiation.provider.executionMode,
    queue: providerNegotiation.provider.handoffQueue,
    serviceEndpoint: providerNegotiation.provider.serviceEndpoint,
    ready: handoffReady,
    status: providerNegotiation.executionBlocked ? 'blocked'
      : !providerNegotiation.externalHandoffRequired ? 'not-required'
        : handoffReady ? 'ready'
          : 'held',
    envelope: handoffReady ? {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      namespace: scope.namespace,
      memoryKey: scope.memoryKey,
      commandId,
      actorId: actor.actorId,
      writeMode: write.mode,
      ttlSeconds: write.ttlSeconds || null,
      expectedRevision: write.expectedRevision || null,
      previousRevision: memoryMutationPlan.currentRevision,
      nextRevision: memoryMutationPlan.nextRevision,
      value: memoryMutationPlan.nextValue,
      mutationPlan: {
        planType: memoryMutationPlan.planType,
        operation: memoryMutationPlan.operation,
        previousPayloadShape: memoryMutationPlan.previousPayloadShape,
        incomingPayloadShape: memoryMutationPlan.incomingPayloadShape,
        nextPayloadShape: memoryMutationPlan.nextPayloadShape,
        expiresAt: memoryMutationPlan.expiresAt
      },
      syncMetadata: providerNegotiation.syncMetadata
    } : null,
    nextAction: providerNegotiation.nextAction
  };
}

function buildProviderServiceOperationContract({ now, actor, scope, write, commandId, decision, providerNegotiation, externalProviderHandoff, memoryMutationPlan, restartSafeStatus }) {
  const serviceOperationId = `${memoryStateKey(scope)}:${commandId}:${providerNegotiation.provider.providerId}:provider-service`;
  const externalMode = providerNegotiation.externalHandoffRequired;
  const localMode = providerNegotiation.localApplyAllowed;
  const capabilitySatisfied = providerNegotiation.missingCapabilities.length === 0;
  const syncAccepted = !providerNegotiation.syncMetadata.stale;
  const operationReady = decision === 'accepted'
    && memoryMutationPlan.valid
    && restartSafeStatus.safeToApply
    && capabilitySatisfied
    && syncAccepted
    && !providerNegotiation.provider.disabled
    && (localMode || externalProviderHandoff.ready);
  const serviceState = providerNegotiation.executionBlocked ? 'blocked'
    : externalMode ? externalProviderHandoff.ready ? 'ready-for-external-dispatch' : 'held-for-external-dispatch'
      : localMode && operationReady ? 'ready-for-hosted-kernel-commit'
        : localMode ? 'held-for-hosted-kernel-commit'
          : 'provider-observe-only';
  const ackDeadlineMs = externalMode ? 30_000 : 0;
  const nowMs = Date.parse(now);

  return {
    contractType: 'kernel.memory.write.provider-service-operation.v1',
    generatedAt: now,
    serviceOperationId,
    stateKey: memoryStateKey(scope),
    commandId,
    providerId: providerNegotiation.provider.providerId,
    providerKind: providerNegotiation.provider.providerKind,
    executionMode: providerNegotiation.provider.executionMode,
    serviceState,
    operationReady,
    route: {
      syscall: 'memory.write',
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      namespace: scope.namespace,
      memoryKey: scope.memoryKey || null,
      actorId: actor.actorId,
      queue: externalProviderHandoff.queue || providerNegotiation.provider.handoffQueue,
      serviceEndpoint: providerNegotiation.provider.serviceEndpoint || null
    },
    negotiatedCapabilities: {
      required: providerNegotiation.requiredCapabilities,
      advertised: providerNegotiation.advertisedCapabilities,
      missing: providerNegotiation.missingCapabilities,
      satisfied: capabilitySatisfied
    },
    syncCommit: {
      syncType: 'kernel.memory.write.provider-sync-commit.v1',
      currentCursor: providerNegotiation.syncMetadata.cursor,
      currentSequence: providerNegotiation.syncMetadata.sequence,
      nextSequence: providerNegotiation.syncMetadata.nextSequence,
      watermark: providerNegotiation.syncMetadata.watermark,
      etag: providerNegotiation.syncMetadata.etag,
      expectedExternalRevision: providerNegotiation.syncMetadata.externalRevision,
      proposedMemoryRevision: memoryMutationPlan.nextRevision,
      stale: providerNegotiation.syncMetadata.stale,
      accepted: syncAccepted
    },
    deliveryContract: {
      deliveryType: externalMode ? 'queued-provider-command' : localMode ? 'hosted-kernel-inline-command' : 'provider-observation',
      dispatchReady: externalProviderHandoff.ready || (localMode && operationReady),
      idempotencyKey: `${providerNegotiation.provider.providerId}:${commandId}`,
      ackRequired: externalMode,
      ackDeadlineMs,
      ackToken: externalMode ? `${serviceOperationId}:ack` : null,
      resumeToken: `${serviceOperationId}:resume`,
      dedupeKey: `${memoryStateKey(scope)}:${commandId}:${providerNegotiation.provider.providerId}`
    },
    externalState: {
      stateType: 'kernel.memory.write.provider-external-state.v1',
      status: externalMode
        ? externalProviderHandoff.ready ? 'awaiting-provider-ack' : externalProviderHandoff.status
        : localMode ? 'local-provider-commit'
          : 'not-required',
      handoffReady: externalProviderHandoff.ready,
      handoffQueue: externalProviderHandoff.queue || null,
      commandRecordStatus: externalMode ? 'handoff-pending' : localMode ? 'prepared' : 'observed',
      providerAckExpectedAt: ackDeadlineMs && Number.isFinite(nowMs) ? new Date(nowMs + ackDeadlineMs).toISOString() : null,
      nextAction: externalMode ? providerNegotiation.nextAction : localMode ? 'commit-with-hosted-kernel-provider' : 'observe-provider-mirror'
    },
    proof: {
      capabilitySatisfied,
      syncAccepted,
      providerAvailable: !providerNegotiation.provider.disabled,
      restartSafe: restartSafeStatus.safeToApply,
      mutationMaterialized: memoryMutationPlan.valid,
      handoffReady: externalProviderHandoff.ready,
      localApplyAllowed: localMode,
      operationReady
    },
    nextAction: operationReady
      ? externalMode ? 'dispatch-provider-service-operation'
        : localMode ? 'commit-provider-service-operation-inline'
          : 'observe-provider-service-operation'
      : providerNegotiation.nextAction
  };
}

function compareIsoInstant(left, right) {
  if (!left || !right) return 0;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
  return leftTime === rightTime ? 0 : leftTime > rightTime ? 1 : -1;
}

function isFutureInstant(value, now) {
  return compareIsoInstant(value, now) > 0;
}

function hasInvalidInstant(value) {
  return Boolean(value) && !Number.isFinite(Date.parse(value));
}

function normalizeLifecycleCommandSettings(source = {}, input = {}, write = {}) {
  const commandSettings = isObject(source.commandSettings) ? source.commandSettings
    : isObject(source.commandOptions) ? source.commandOptions
      : isObject(input.lifecycleCommandSettings) ? input.lifecycleCommandSettings
        : isObject(input.commandSettings) ? input.commandSettings
          : {};
  const requestedEnabled = commandSettings.enabled === true || commandSettings.memoryWriteEnabled === true
    ? true
    : commandSettings.enabled === false || commandSettings.memoryWriteEnabled === false
      ? false
      : null;
  const scheduledAt = asString(commandSettings.scheduledAt || commandSettings.holdUntil || input.lifecycleScheduledAt || write.scheduledAt);
  const disabledUntil = asString(commandSettings.disabledUntil || commandSettings.disableUntil);
  const pausedUntil = asString(commandSettings.pausedUntil || commandSettings.pauseUntil);
  return {
    settingsType: 'kernel.memory.write.lifecycle-command-settings.v1',
    requestedEnabled,
    disabledUntil: disabledUntil || null,
    pausedUntil: pausedUntil || null,
    scheduledAt: scheduledAt || null,
    reason: asString(commandSettings.reason || commandSettings.changeReason || input.lifecycleCommandReason),
    drainMode: asString(commandSettings.drainMode || commandSettings.queueMode) || 'pending-only',
    notifyClients: commandSettings.notifyClients !== false,
    maxPendingCommands: Number.isFinite(commandSettings.maxPendingCommands) && commandSettings.maxPendingCommands > 0
      ? Math.floor(commandSettings.maxPendingCommands)
      : null,
    invalidInstants: [
      hasInvalidInstant(disabledUntil) ? 'disabledUntil' : '',
      hasInvalidInstant(pausedUntil) ? 'pausedUntil' : '',
      hasInvalidInstant(scheduledAt) ? 'scheduledAt' : ''
    ].filter(Boolean)
  };
}

function normalizeMemoryWriteLifecycle(input = {}, actor = {}, write = {}, now = new Date().toISOString()) {
  const source = isObject(input.lifecycleSettings) ? input.lifecycleSettings
    : isObject(input.lifecycle) ? input.lifecycle
      : isObject(input.settings) ? input.settings
        : {};
  const settingsRevision = asString(source.settingsRevision || source.revision || source.lifecycleRevision || input.lifecycleSettingsRevision);
  const allowedModes = uniqueStrings(source.allowedModes || source.writeModes);
  const lifecycleCommand = asString(source.command || input.lifecycleCommand);
  const commandSettings = normalizeLifecycleCommandSettings(source, input, write);
  const disabledUntil = asString(source.disabledUntil || source.disableUntil);
  const pausedUntil = asString(source.pausedUntil || source.pauseUntil);
  const maintenance = isObject(source.maintenanceWindow) ? source.maintenanceWindow : {};
  const maintenanceStartsAt = asString(maintenance.startsAt || source.maintenanceStartsAt);
  const maintenanceEndsAt = asString(maintenance.endsAt || source.maintenanceEndsAt);
  const scheduledAt = lifecycleCommand === 'schedule' && commandSettings.scheduledAt
    ? commandSettings.scheduledAt
    : write.scheduledAt;
  const scheduleDue = !scheduledAt || compareIsoInstant(scheduledAt, now) <= 0;
  const commandScheduledForFuture = lifecycleCommand === 'schedule' && Boolean(scheduledAt) && !scheduleDue;
  const enabled = source.enabled !== false
    && source.memoryWriteEnabled !== false
    && input.memoryWriteEnabled !== false;
  const disabledActive = !enabled || isFutureInstant(disabledUntil, now);
  const pausedActive = isFutureInstant(pausedUntil, now);
  const maintenanceActive = Boolean(
    maintenanceStartsAt
    && maintenanceEndsAt
    && compareIsoInstant(maintenanceStartsAt, now) <= 0
    && compareIsoInstant(maintenanceEndsAt, now) > 0
  );
  const requiresReason = source.requireReason === true || source.reasonRequired === true;
  const maxTtlSeconds = Number.isFinite(source.maxTtlSeconds) && source.maxTtlSeconds > 0
    ? Math.floor(source.maxTtlSeconds)
    : null;
  const modeAllowed = allowedModes.length === 0 || allowedModes.includes(write.mode);
  const configureAuthorized = actor.roles.includes('kernel')
    || actor.roles.includes('workspace-admin')
    || actor.capabilities.includes('memory:write:configure');
  const writeSource = isObject(input.write) ? input.write : input;
  const lifecycleCommandOnly = Boolean(lifecycleCommand)
    && !Object.hasOwn(writeSource, 'value')
    && !Object.hasOwn(writeSource, 'payload')
    && !Object.hasOwn(input, 'payload');
  const lifecycleCommandSupported = !lifecycleCommand || SUPPORTED_LIFECYCLE_COMMANDS.includes(lifecycleCommand);
  const drainModeSupported = !lifecycleCommand || lifecycleCommand !== 'drain' || SUPPORTED_DRAIN_MODES.includes(commandSettings.drainMode);
  const enableWouldChangeState = lifecycleCommand !== 'enable' || !enabled || disabledActive || pausedActive;
  const disableWouldChangeState = lifecycleCommand !== 'disable'
    || enabled
    || !disabledUntil
    || (commandSettings.disabledUntil && commandSettings.disabledUntil !== disabledUntil);
  const pauseWouldChangeState = lifecycleCommand !== 'pause'
    || !pausedActive
    || (commandSettings.pausedUntil && commandSettings.pausedUntil !== pausedUntil);
  const resumeWouldChangeState = lifecycleCommand !== 'resume' || pausedActive;
  const scheduleWouldChangeState = lifecycleCommand !== 'schedule'
    || commandScheduledForFuture
    || (commandSettings.scheduledAt && commandSettings.scheduledAt !== write.scheduledAt);
  const commandEffective = !lifecycleCommand
    || !lifecycleCommandSupported
    || (lifecycleCommand === 'enable' && enableWouldChangeState)
    || (lifecycleCommand === 'disable' && disableWouldChangeState)
    || (lifecycleCommand === 'pause' && pauseWouldChangeState)
    || (lifecycleCommand === 'resume' && resumeWouldChangeState)
    || (lifecycleCommand === 'drain' && drainModeSupported)
    || (lifecycleCommand === 'schedule' && scheduleWouldChangeState);
  const adminCommandCanBypassAdmission = configureAuthorized
    && ['enable', 'resume', 'drain', 'schedule'].includes(lifecycleCommand)
    && lifecycleCommandSupported;
  const blocked = disabledActive || pausedActive || maintenanceActive || !scheduleDue || !modeAllowed
    || (requiresReason && !write.reason)
    || Boolean(maxTtlSeconds && write.ttlSeconds && write.ttlSeconds > maxTtlSeconds);
  const writeBlocked = adminCommandCanBypassAdmission ? false : blocked;
  const requestedSettings = {
    settingsType: 'kernel.memory.write.lifecycle-next-settings.v1',
    enabled: lifecycleCommand === 'enable' ? true
      : lifecycleCommand === 'disable' ? false
        : commandSettings.requestedEnabled ?? enabled,
    disabledUntil: lifecycleCommand === 'disable' ? commandSettings.disabledUntil || disabledUntil || null
      : lifecycleCommand === 'enable' ? null
        : disabledUntil || null,
    pausedUntil: lifecycleCommand === 'pause' ? commandSettings.pausedUntil || pausedUntil || null
      : lifecycleCommand === 'resume' ? null
        : pausedUntil || null,
    scheduledAt: lifecycleCommand === 'schedule' ? scheduledAt || null : write.scheduledAt || null,
    drainMode: lifecycleCommand === 'drain' ? commandSettings.drainMode : null,
    notifyClients: commandSettings.notifyClients,
    changeReason: commandSettings.reason || null
  };

  return {
    controlType: 'kernel.memory.write.lifecycle-control.v1',
    generatedAt: now,
    enabled,
    lifecycleCommand: lifecycleCommand || null,
    lifecycleCommandOnly,
    lifecycleCommandSupported,
    lifecycleCommandEffective: commandEffective,
    lifecycleSettingsRevision: settingsRevision || null,
    configureAuthorized,
    commandSettings,
    requestedSettings,
    allowedModes: allowedModes.length ? allowedModes : ['replace', 'merge', 'append'],
    modeAllowed,
    requireReason: requiresReason,
    reasonSatisfied: !requiresReason || Boolean(write.reason),
    maxTtlSeconds,
    ttlAllowed: !maxTtlSeconds || !write.ttlSeconds || write.ttlSeconds <= maxTtlSeconds,
    drainModeSupported,
    disabledUntil: disabledUntil || null,
    pausedUntil: pausedUntil || null,
    maintenanceWindow: {
      startsAt: maintenanceStartsAt || null,
      endsAt: maintenanceEndsAt || null,
      active: maintenanceActive
    },
    scheduling: {
      scheduledAt: scheduledAt || null,
      due: scheduleDue,
      holdUntil: scheduleDue ? null : scheduledAt || null,
      requestedByCommand: lifecycleCommand === 'schedule',
      commandScheduledForFuture
    },
    writeAdmission: {
      disabledActive,
      pausedActive,
      blocked: writeBlocked,
      settingsBlocked: blocked,
      adminCommandBypass: adminCommandCanBypassAdmission,
      nextAction: blocked
        ? adminCommandCanBypassAdmission ? 'apply-lifecycle-command'
          : disabledActive ? 'enable-memory-write-lifecycle'
            : pausedActive ? 'wait-for-memory-write-resume'
            : maintenanceActive ? 'wait-for-maintenance-window-end'
              : !scheduleDue ? 'wait-until-scheduled-time'
                : !modeAllowed ? 'choose-allowed-write-mode'
                  : requiresReason && !write.reason ? 'provide-write-reason'
                    : 'adjust-memory-write-settings'
        : 'continue-memory-write-plan'
    }
  };
}

function lifecycleValidationErrors(lifecycleControl, write) {
  const errors = [];
  if (lifecycleControl.lifecycleCommand && !lifecycleControl.lifecycleCommandSupported) {
    errors.push({
      code: 'memory_write_lifecycle_command_invalid',
      message: 'Memory write lifecycle command must be enable, disable, pause, resume, drain, or schedule.',
      command: lifecycleControl.lifecycleCommand,
      action: 'choose-supported-lifecycle-command'
    });
  }
  if (lifecycleControl.lifecycleCommand && !lifecycleControl.configureAuthorized) {
    errors.push({
      code: 'memory_write_lifecycle_command_unauthorized',
      message: 'Memory write lifecycle commands require kernel, workspace-admin, or memory:write:configure.',
      command: lifecycleControl.lifecycleCommand,
      action: 'request-memory-write-lifecycle-permission'
    });
  }
  if (lifecycleControl.commandSettings.invalidInstants.length) {
    errors.push({
      code: 'memory_write_lifecycle_command_settings_invalid',
      message: 'Lifecycle command settings contain invalid ISO instant values.',
      invalidFields: lifecycleControl.commandSettings.invalidInstants,
      action: 'correct-lifecycle-command-settings'
    });
  }
  if (!lifecycleControl.drainModeSupported) {
    errors.push({
      code: 'memory_write_lifecycle_drain_mode_invalid',
      message: 'Drain lifecycle command requires drainMode pending-only, pending-and-scheduled, or all-held.',
      drainMode: lifecycleControl.commandSettings.drainMode,
      supportedDrainModes: SUPPORTED_DRAIN_MODES,
      action: 'choose-supported-drain-mode'
    });
  }
  if (lifecycleControl.lifecycleCommand === 'schedule' && !lifecycleControl.scheduling.scheduledAt) {
    errors.push({
      code: 'memory_write_lifecycle_schedule_missing_time',
      message: 'Schedule lifecycle command requires scheduledAt or lifecycleCommandSettings.scheduledAt.',
      action: 'provide-scheduled-time'
    });
  }
  if (lifecycleControl.lifecycleCommand === 'schedule' && lifecycleControl.lifecycleCommandOnly && lifecycleControl.scheduling.scheduledAt && lifecycleControl.scheduling.due) {
    errors.push({
      code: 'memory_write_lifecycle_schedule_not_future',
      message: 'Lifecycle-only schedule commands must target a future scheduledAt instant.',
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      action: 'provide-future-scheduled-time'
    });
  }
  if (lifecycleControl.lifecycleCommand === 'disable' && lifecycleControl.requestedSettings.disabledUntil && compareIsoInstant(lifecycleControl.requestedSettings.disabledUntil, lifecycleControl.generatedAt) <= 0) {
    errors.push({
      code: 'memory_write_lifecycle_disable_until_not_future',
      message: 'Lifecycle disable disabledUntil must be a future instant when provided.',
      disabledUntil: lifecycleControl.requestedSettings.disabledUntil,
      action: 'provide-future-disabled-until'
    });
  }
  if (lifecycleControl.lifecycleCommand === 'pause' && lifecycleControl.requestedSettings.pausedUntil && compareIsoInstant(lifecycleControl.requestedSettings.pausedUntil, lifecycleControl.generatedAt) <= 0) {
    errors.push({
      code: 'memory_write_lifecycle_pause_until_not_future',
      message: 'Lifecycle pause pausedUntil must be a future instant when provided.',
      pausedUntil: lifecycleControl.requestedSettings.pausedUntil,
      action: 'provide-future-paused-until'
    });
  }
  if (lifecycleControl.lifecycleCommand && lifecycleControl.lifecycleCommandSupported && !lifecycleControl.lifecycleCommandEffective) {
    errors.push({
      code: 'memory_write_lifecycle_command_noop',
      message: 'Lifecycle command would not change hosted-kernel memory-write settings.',
      command: lifecycleControl.lifecycleCommand,
      action: 'choose-effective-lifecycle-command'
    });
  }
  if (lifecycleControl.lifecycleCommand === 'disable' && lifecycleControl.requireReason && !lifecycleControl.commandSettings.reason && !write.reason) {
    errors.push({
      code: 'memory_write_lifecycle_disable_reason_required',
      message: 'Lifecycle settings require a reason before disabling memory writes.',
      action: 'provide-lifecycle-command-reason'
    });
  }
  if (lifecycleControl.writeAdmission.disabledActive && !lifecycleControl.writeAdmission.adminCommandBypass) {
    errors.push({
      code: 'memory_write_disabled',
      message: 'Memory writes are disabled by lifecycle settings.',
      disabledUntil: lifecycleControl.disabledUntil,
      action: 'enable-memory-write-lifecycle',
      retryable: Boolean(lifecycleControl.disabledUntil)
    });
  }
  if (lifecycleControl.writeAdmission.pausedActive && !lifecycleControl.writeAdmission.adminCommandBypass) {
    errors.push({
      code: 'memory_write_paused',
      message: 'Memory writes are paused by lifecycle settings.',
      pausedUntil: lifecycleControl.pausedUntil,
      action: 'wait-for-memory-write-resume',
      retryable: true
    });
  }
  if (lifecycleControl.maintenanceWindow.active) {
    errors.push({
      code: 'memory_write_maintenance_window_active',
      message: 'Memory writes are held while the lifecycle maintenance window is active.',
      maintenanceWindow: lifecycleControl.maintenanceWindow,
      action: 'wait-for-maintenance-window-end',
      retryable: true
    });
  }
  if (!lifecycleControl.modeAllowed) {
    errors.push({
      code: 'memory_write_mode_disabled_by_settings',
      message: 'Memory write mode is disabled by lifecycle settings.',
      writeMode: write.mode,
      allowedModes: lifecycleControl.allowedModes,
      action: 'choose-allowed-write-mode'
    });
  }
  if (!lifecycleControl.reasonSatisfied) {
    errors.push({
      code: 'memory_write_reason_required',
      message: 'Lifecycle settings require a write reason.',
      action: 'provide-write-reason'
    });
  }
  if (!lifecycleControl.ttlAllowed) {
    errors.push({
      code: 'memory_write_ttl_exceeds_settings',
      message: 'Memory write TTL exceeds lifecycle settings.',
      ttlSeconds: write.ttlSeconds,
      maxTtlSeconds: lifecycleControl.maxTtlSeconds,
      action: 'reduce-memory-write-ttl'
    });
  }
  return errors;
}

function omitUndefinedSettings(settings) {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => typeof value !== 'undefined')
  );
}

function buildLifecycleSettingsTransition({ now, scope, commandId, lifecycleControl, effect }) {
  const currentSettings = {
    enabled: lifecycleControl.enabled,
    disabledUntil: lifecycleControl.disabledUntil,
    pausedUntil: lifecycleControl.pausedUntil,
    allowedModes: lifecycleControl.allowedModes,
    requireReason: lifecycleControl.requireReason,
    maxTtlSeconds: lifecycleControl.maxTtlSeconds,
    maintenanceWindow: lifecycleControl.maintenanceWindow
  };
  const requested = lifecycleControl.requestedSettings;
  const targetSettings = omitUndefinedSettings({
    enabled: requested.enabled,
    disabledUntil: requested.disabledUntil,
    pausedUntil: requested.pausedUntil,
    scheduledAt: requested.scheduledAt,
    drainPending: effect.drainPending === true ? true : undefined,
    drainMode: effect.drainMode || undefined,
    notifyClients: requested.notifyClients,
    changeReason: requested.changeReason,
    lastLifecycleCommand: lifecycleControl.lifecycleCommand,
    lastLifecycleCommandAt: now,
    lastLifecycleCommandId: commandId
  });
  const patch = omitUndefinedSettings({
    ...effect.settingsPatch,
    lastLifecycleCommand: lifecycleControl.lifecycleCommand,
    lastLifecycleCommandAt: now,
    lastLifecycleCommandId: commandId
  });
  const previousRevision = lifecycleControl.lifecycleSettingsRevision || null;
  const nextRevision = `lifecycle-${revisionHash({
    stateKey: memoryStateKey(scope),
    commandId,
    previousRevision,
    patch
  })}`;

  return {
    transitionType: 'kernel.memory.write.lifecycle-settings-transition.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    previousRevision,
    nextRevision,
    currentSettings,
    targetSettings,
    settingsPatch: patch,
    auditLabels: uniqueStrings([
      lifecycleControl.lifecycleCommand,
      lifecycleControl.configureAuthorized ? 'authorized' : 'unauthorized',
      lifecycleControl.lifecycleCommandEffective ? 'effective' : 'noop',
      lifecycleControl.scheduling.commandScheduledForFuture ? 'future-schedule' : '',
      lifecycleControl.requestedSettings.notifyClients ? 'notify-clients' : 'silent'
    ]),
    proof: {
      supportedCommand: lifecycleControl.lifecycleCommandSupported,
      authorized: lifecycleControl.configureAuthorized,
      effective: lifecycleControl.lifecycleCommandEffective,
      drainModeSupported: lifecycleControl.drainModeSupported,
      scheduledForFuture: lifecycleControl.scheduling.commandScheduledForFuture,
      revisioned: Boolean(nextRevision)
    },
    nextAction: lifecycleControl.configureAuthorized
      ? lifecycleControl.lifecycleCommandEffective ? effect.nextAction || 'persist-lifecycle-settings'
        : 'choose-effective-lifecycle-command'
      : 'request-memory-write-lifecycle-permission'
  };
}

function buildLifecycleCommandActivation({ now, scope, commandId, lifecycleControl, effect }) {
  const command = lifecycleControl.lifecycleCommand;
  const requested = lifecycleControl.requestedSettings;
  const scheduledAt = command === 'schedule' ? lifecycleControl.scheduling.scheduledAt : requested.scheduledAt;
  const scheduledFuture = command === 'schedule' && Boolean(scheduledAt) && !lifecycleControl.scheduling.due;
  const settingsWriteRequired = Boolean(command) && lifecycleControl.configureAuthorized && lifecycleControl.lifecycleCommandEffective;
  const queueSelector = command === 'drain'
    ? requested.drainMode === 'all-held' ? 'pending,scheduled,paused'
      : requested.drainMode === 'pending-and-scheduled' ? 'pending,scheduled'
        : 'pending'
    : scheduledFuture ? 'scheduled-lifecycle'
      : 'settings';
  const activationStatus = !command ? 'not-requested'
    : !lifecycleControl.lifecycleCommandSupported ? 'unsupported'
      : !lifecycleControl.configureAuthorized ? 'unauthorized'
        : !lifecycleControl.lifecycleCommandEffective ? 'noop'
          : scheduledFuture ? 'scheduled'
            : command === 'drain' ? 'drain-ready'
              : 'ready';
  const nextAction = activationStatus === 'ready' || activationStatus === 'drain-ready'
    ? effect.nextAction || 'persist-lifecycle-settings'
    : activationStatus === 'scheduled' ? 'persist-scheduled-lifecycle-control'
      : activationStatus === 'noop' ? 'choose-effective-lifecycle-command'
        : activationStatus === 'unauthorized' ? 'request-memory-write-lifecycle-permission'
          : activationStatus === 'unsupported' ? 'choose-supported-lifecycle-command'
            : 'continue-memory-write-plan';

  return {
    activationType: 'kernel.memory.write.lifecycle-command-activation.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    lifecycleCommand: command || null,
    status: activationStatus,
    settingsWriteRequired,
    schedule: {
      requested: command === 'schedule',
      scheduledAt: scheduledAt || null,
      due: lifecycleControl.scheduling.due,
      future: scheduledFuture,
      resumeAfter: scheduledFuture ? scheduledAt : null
    },
    enablement: {
      currentEnabled: lifecycleControl.enabled,
      nextEnabled: Object.hasOwn(effect, 'enabled') ? effect.enabled : requested.enabled,
      disabledUntil: Object.hasOwn(effect, 'disabledUntil') ? effect.disabledUntil ?? null : requested.disabledUntil,
      pausedUntil: Object.hasOwn(effect, 'pausedUntil') ? effect.pausedUntil ?? null : requested.pausedUntil
    },
    queueControl: {
      selector: queueSelector,
      drainPending: effect.drainPending === true,
      drainMode: effect.drainMode || null,
      notifyClients: requested.notifyClients,
      maxPendingCommandsHint: lifecycleControl.commandSettings.maxPendingCommands || null
    },
    nextAction
  };
}

function buildLifecycleCommandPlan({ now, actor, scope, commandId, lifecycleControl }) {
  if (!lifecycleControl.lifecycleCommand) {
    return {
      commandType: 'kernel.memory.write.lifecycle.noop.v1',
      generatedAt: now,
      commandId,
      stateKey: memoryStateKey(scope),
      nextAction: lifecycleControl.writeAdmission.nextAction,
      reason: 'no-lifecycle-command-requested'
    };
  }
  const effectByCommand = {
    enable: {
      enabled: true,
      pausedUntil: null,
      disabledUntil: null,
      settingsPatch: {
        memoryWriteEnabled: true,
        disabledUntil: null,
        pausedUntil: null
      },
      nextAction: 'accept-new-memory-writes'
    },
    disable: {
      enabled: false,
      disabledUntil: lifecycleControl.requestedSettings.disabledUntil,
      settingsPatch: {
        memoryWriteEnabled: false,
        disabledUntil: lifecycleControl.requestedSettings.disabledUntil,
        changeReason: lifecycleControl.requestedSettings.changeReason
      },
      nextAction: 'block-new-memory-writes'
    },
    pause: {
      enabled: lifecycleControl.enabled,
      pausedUntil: lifecycleControl.requestedSettings.pausedUntil,
      settingsPatch: {
        pausedUntil: lifecycleControl.requestedSettings.pausedUntil,
        changeReason: lifecycleControl.requestedSettings.changeReason
      },
      nextAction: 'hold-memory-writes-until-resume'
    },
    resume: {
      enabled: lifecycleControl.enabled,
      pausedUntil: null,
      settingsPatch: {
        pausedUntil: null
      },
      nextAction: 'resume-memory-write-admission'
    },
    drain: {
      enabled: lifecycleControl.enabled,
      drainPending: true,
      drainMode: lifecycleControl.requestedSettings.drainMode,
      settingsPatch: {
        drainPending: true,
        drainMode: lifecycleControl.requestedSettings.drainMode
      },
      nextAction: 'drain-pending-memory-write-journal'
    },
    schedule: {
      enabled: lifecycleControl.enabled,
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      settingsPatch: {
        scheduledAt: lifecycleControl.scheduling.scheduledAt,
        notifyClients: lifecycleControl.requestedSettings.notifyClients
      },
      nextAction: lifecycleControl.scheduling.due ? 'apply-memory-write' : 'wait-until-scheduled-time'
    }
  };
  const effect = effectByCommand[lifecycleControl.lifecycleCommand] || {
    nextAction: 'reject-unsupported-lifecycle-command'
  };
  const settingsTransition = buildLifecycleSettingsTransition({ now, scope, commandId, lifecycleControl, effect });
  const activation = buildLifecycleCommandActivation({ now, scope, commandId, lifecycleControl, effect });
  const commandAcknowledgement = {
    acknowledgementType: 'kernel.memory.write.lifecycle-command-ack.v1',
    generatedAt: now,
    commandId,
    lifecycleCommand: lifecycleControl.lifecycleCommand,
    accepted: lifecycleControl.configureAuthorized
      && lifecycleControl.lifecycleCommandSupported
      && lifecycleControl.lifecycleCommandEffective
      && lifecycleControl.drainModeSupported,
    status: activation.status,
    settingsRevision: lifecycleControl.lifecycleSettingsRevision || null,
    nextSettingsRevision: settingsTransition.nextRevision,
    notifyClients: lifecycleControl.requestedSettings.notifyClients,
    clientEventName: `memory.write.lifecycle.${activation.status}`,
    schedulerToken: activation.schedule.future ? `${memoryStateKey(scope)}:${commandId}:lifecycle:${activation.schedule.scheduledAt}` : null,
    nextAction: activation.nextAction
  };
  return {
    commandType: 'kernel.memory.write.lifecycle.command.v1',
    generatedAt: now,
    commandId,
    stateKey: memoryStateKey(scope),
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey || null,
    requestedBy: actor.actorId,
    lifecycleCommand: lifecycleControl.lifecycleCommand,
    authorized: lifecycleControl.configureAuthorized,
    accepted: commandAcknowledgement.accepted,
    effect,
    activation,
    commandAcknowledgement,
    settingsTransition,
    settingsSnapshot: {
      revision: lifecycleControl.lifecycleSettingsRevision,
      enabled: lifecycleControl.enabled,
      allowedModes: lifecycleControl.allowedModes,
      requireReason: lifecycleControl.requireReason,
      maxTtlSeconds: lifecycleControl.maxTtlSeconds,
      disabledUntil: lifecycleControl.disabledUntil,
      pausedUntil: lifecycleControl.pausedUntil,
      maintenanceWindow: lifecycleControl.maintenanceWindow,
      requestedSettings: lifecycleControl.requestedSettings
    },
    settingsPatch: settingsTransition.settingsPatch,
    nextLifecycleRevision: settingsTransition.nextRevision,
    nextAction: activation.nextAction
  };
}

function retryDelayMs(health) {
  const exponent = Math.min(health.attempt - 1 + health.failureCount, 8);
  return Math.min(health.retryMaxMs, health.retryBaseMs * (2 ** exponent));
}

function buildOperationalHealth({ now, actor, scope, write, persistedState, dependencyHealth }) {
  const circuitOpen = dependencyHealth.circuitOpenUntil && compareIsoInstant(dependencyHealth.circuitOpenUntil, now) > 0;
  const unavailableReasons = [];
  if (!dependencyHealth.persistenceAvailable) unavailableReasons.push('persistence-unavailable');
  if (!dependencyHealth.journalWritable) unavailableReasons.push('journal-readonly');
  if (!dependencyHealth.storageWritable) unavailableReasons.push('storage-readonly');
  if (circuitOpen) unavailableReasons.push('circuit-open');

  const payloadBytes = payloadSizeBytes(write.value);
  const degradedReasons = [];
  if (dependencyHealth.degradedMode) degradedReasons.push('operator-degraded-mode');
  if (persistedState.recovered) degradedReasons.push('recovered-state');
  if (dependencyHealth.lastFailureCode) degradedReasons.push('recent-failure');
  if (payloadBytes > 32 * 1024) degradedReasons.push('large-payload');

  const status = unavailableReasons.length ? 'unavailable' : degradedReasons.length ? 'degraded' : 'healthy';
  const retryable = status === 'unavailable' && dependencyHealth.attempt < dependencyHealth.maxAttempts;
  const delayMs = retryable ? retryDelayMs(dependencyHealth) : 0;
  return {
    healthType: 'kernel.memory.write.operational-health.v1',
    generatedAt: now,
    status,
    stateKey: memoryStateKey(scope),
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    namespace: scope.namespace,
    actorId: actor.actorId,
    degraded: status === 'degraded',
    unavailable: status === 'unavailable',
    safeToPrepare: status !== 'unavailable',
    safeToCommit: status === 'healthy' || (status === 'degraded' && payloadBytes <= DEGRADED_MAX_PAYLOAD_BYTES),
    unavailableReasons,
    degradedReasons,
    failureState: {
      lastFailureCode: dependencyHealth.lastFailureCode || null,
      lastFailureAt: dependencyHealth.lastFailureAt || null,
      failureCount: dependencyHealth.failureCount,
      circuitOpenUntil: dependencyHealth.circuitOpenUntil || null,
      nonRetryable: NON_RETRYABLE_FAILURE_CODES.includes(dependencyHealth.lastFailureCode)
    },
    retryPlan: {
      retryable,
      attempt: dependencyHealth.attempt,
      maxAttempts: dependencyHealth.maxAttempts,
      retryAfterMs: delayMs,
      nextAction: retryable ? 'retry-after-backoff' : status === 'unavailable' ? 'escalate-dependency-health' : 'commit-with-audit'
    }
  };
}

function buildOperationalHealthIncident({ now, scope, commandId, dependencyHealth, operationalHealth, providerNegotiation, writeSafetyGate, actionableErrors }) {
  const nonRetryable = operationalHealth.failureState.nonRetryable;
  const providerBlocked = providerNegotiation.executionBlocked;
  const gateBlocked = !writeSafetyGate.safeToPrepare || !writeSafetyGate.safeToCommit;
  const retryExhausted = operationalHealth.unavailable
    && !operationalHealth.retryPlan.retryable
    && dependencyHealth.attempt >= dependencyHealth.maxAttempts;
  const incidentOpen = operationalHealth.unavailable || gateBlocked || providerBlocked || retryExhausted;
  const retryAfterMs = operationalHealth.retryPlan.retryAfterMs;
  const retryWindowEndsAt = retryAfterMs && Number.isFinite(Date.parse(now))
    ? new Date(Date.parse(now) + retryAfterMs).toISOString()
    : null;
  const primaryFailureCode = operationalHealth.failureState.lastFailureCode
    || actionableErrors[0]?.code
    || (providerBlocked ? 'provider_blocked' : operationalHealth.status);
  const severity = nonRetryable ? 'critical'
    : retryExhausted ? 'major'
      : operationalHealth.unavailable || providerBlocked ? 'degraded'
        : gateBlocked ? 'warning'
          : operationalHealth.degraded ? 'notice'
            : 'none';
  const operatorActions = uniqueStrings([
    nonRetryable ? FAILURE_RECOVERY_ACTIONS[dependencyHealth.lastFailureCode] || 'repair-memory-store-before-retry' : '',
    retryExhausted ? 'escalate-memory-write-dependency-health' : '',
    operationalHealth.unavailable && operationalHealth.retryPlan.retryable ? 'retry-memory-write-after-backoff' : '',
    providerNegotiation.provider.disabled ? 'select-available-memory-provider' : '',
    providerNegotiation.missingCapabilities.length ? 'negotiate-memory-provider-capabilities' : '',
    providerNegotiation.syncMetadata.stale ? 'refresh-provider-sync-metadata' : '',
    writeSafetyGate.pendingQueue.saturated ? 'drain-memory-write-journal' : '',
    writeSafetyGate.recoveredState.requiresExpectedRevision ? 'refresh-memory-revision' : '',
    operationalHealth.degraded ? 'monitor-degraded-memory-write-policy' : ''
  ]);

  return {
    incidentType: 'kernel.memory.write.operational-health-incident.v1',
    generatedAt: now,
    incidentId: `${memoryStateKey(scope)}:${commandId}:health`,
    stateKey: memoryStateKey(scope),
    commandId,
    open: incidentOpen || operationalHealth.degraded,
    severity,
    primaryFailureCode,
    status: incidentOpen ? 'action-required' : operationalHealth.degraded ? 'degraded-observe' : 'healthy',
    retryBudget: {
      retryable: operationalHealth.retryPlan.retryable && !nonRetryable,
      attempt: dependencyHealth.attempt,
      remainingAttempts: Math.max(0, dependencyHealth.maxAttempts - dependencyHealth.attempt),
      maxAttempts: dependencyHealth.maxAttempts,
      retryAfterMs,
      retryWindowEndsAt
    },
    degradedModePolicy: {
      active: operationalHealth.degraded,
      allowedWriteMode: operationalHealth.degraded ? 'replace' : 'any',
      maxPayloadBytes: operationalHealth.degraded ? DEGRADED_MAX_PAYLOAD_BYTES : null,
      reasons: operationalHealth.degradedReasons
    },
    dependencySnapshot: {
      persistenceAvailable: dependencyHealth.persistenceAvailable,
      journalWritable: dependencyHealth.journalWritable,
      storageWritable: dependencyHealth.storageWritable,
      circuitOpenUntil: dependencyHealth.circuitOpenUntil || null,
      lastFailureCode: dependencyHealth.lastFailureCode || null,
      lastFailureAt: dependencyHealth.lastFailureAt || null,
      failureCount: dependencyHealth.failureCount
    },
    providerSnapshot: {
      providerId: providerNegotiation.provider.providerId,
      disabled: providerNegotiation.provider.disabled,
      executionMode: providerNegotiation.provider.executionMode,
      missingCapabilities: providerNegotiation.missingCapabilities,
      syncStale: providerNegotiation.syncMetadata.stale,
      nextAction: providerNegotiation.nextAction
    },
    blockedSurfaces: uniqueStrings([
      operationalHealth.unavailable ? 'persistence-path' : '',
      writeSafetyGate.pendingQueue.saturated ? 'pending-command-queue' : '',
      writeSafetyGate.failureState.locked ? 'failure-state-lock' : '',
      writeSafetyGate.recoveredState.requiresExpectedRevision ? 'recovered-revision-guard' : '',
      providerBlocked ? 'provider-negotiation' : ''
    ]),
    operatorActions,
    userAction: actionableErrors[0]?.action || (operationalHealth.degraded ? 'retry-when-memory-write-health-is-healthy' : 'continue-memory-write-plan'),
    clientMessage: incidentOpen
      ? 'Memory write is held by operational health checks.'
      : operationalHealth.degraded ? 'Memory write is running under degraded-mode safeguards.'
        : 'Memory write health checks passed.'
  };
}

function buildWriteSafetyGate({ now, scope, write, commandId, persistedState, dependencyHealth, operationalHealth }) {
  const payloadBytes = payloadSizeBytes(write.value);
  const pendingCommandIds = uniqueStrings(persistedState.pendingCommandIds);
  const pendingCurrentCommand = pendingCommandIds.includes(commandId);
  const pendingOtherCount = pendingCommandIds.filter((pendingId) => pendingId !== commandId).length;
  const queueSaturated = pendingOtherCount >= dependencyHealth.maxPendingCommands;
  const nonRetryableFailure = NON_RETRYABLE_FAILURE_CODES.includes(dependencyHealth.lastFailureCode);
  const recoveredBlindWrite = persistedState.recovered && !write.expectedRevision && !pendingCurrentCommand;
  const degradedModeUnsafe = operationalHealth.degraded && ['merge', 'append'].includes(write.mode);
  const degradedPayloadTooLarge = operationalHealth.degraded && payloadBytes > DEGRADED_MAX_PAYLOAD_BYTES;
  const gateErrors = [];

  if (nonRetryableFailure) {
    gateErrors.push({
      code: 'memory_write_failure_state_locked',
      message: 'Memory write is locked because the last persistence failure requires operator recovery.',
      lastFailureCode: dependencyHealth.lastFailureCode,
      lastFailureAt: dependencyHealth.lastFailureAt || null,
      action: 'repair-memory-store-before-retry',
      retryable: false
    });
  }
  if (queueSaturated && !pendingCurrentCommand) {
    gateErrors.push({
      code: 'memory_write_pending_queue_saturated',
      message: 'Memory write cannot enqueue because this memory key has too many unresolved pending commands.',
      pendingCommandCount: pendingOtherCount,
      maxPendingCommands: dependencyHealth.maxPendingCommands,
      action: 'drain-memory-write-journal',
      retryable: operationalHealth.retryPlan.retryable,
      retryAfterMs: operationalHealth.retryPlan.retryAfterMs
    });
  }
  if (recoveredBlindWrite) {
    gateErrors.push({
      code: 'memory_write_recovered_revision_required',
      message: 'Recovered memory state requires expectedRevision before accepting a new write.',
      currentRevision: persistedState.currentRevision || null,
      action: 'refresh-memory-revision'
    });
  }
  if (degradedModeUnsafe) {
    gateErrors.push({
      code: 'memory_write_degraded_mode_requires_replace',
      message: 'Degraded memory-write mode only accepts replace writes to avoid replay-order dependent updates.',
      writeMode: write.mode,
      degradedReasons: operationalHealth.degradedReasons,
      action: 'retry-merge-or-append-when-healthy',
      retryable: operationalHealth.retryPlan.retryable
    });
  }
  if (degradedPayloadTooLarge) {
    gateErrors.push({
      code: 'memory_write_degraded_large_payload',
      message: 'Degraded memory-write mode only accepts payloads up to 32 KiB.',
      payloadBytes,
      maxPayloadBytes: DEGRADED_MAX_PAYLOAD_BYTES,
      degradedReasons: operationalHealth.degradedReasons,
      action: 'retry when memory persistence health returns to healthy',
      retryable: operationalHealth.retryPlan.retryable
    });
  }

  return {
    gateType: 'kernel.memory.write.commit-safety-gate.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    safeToPrepare: operationalHealth.safeToPrepare && !nonRetryableFailure && (!queueSaturated || pendingCurrentCommand),
    safeToCommit: operationalHealth.safeToCommit && gateErrors.length === 0,
    pendingQueue: {
      currentCommandPending: pendingCurrentCommand,
      pendingCommandCount: pendingOtherCount,
      maxPendingCommands: dependencyHealth.maxPendingCommands,
      saturated: queueSaturated
    },
    recoveredState: {
      recovered: persistedState.recovered,
      currentRevision: persistedState.currentRevision || null,
      requiresExpectedRevision: recoveredBlindWrite
    },
    degradedMode: {
      active: operationalHealth.degraded,
      allowedWriteMode: operationalHealth.degraded ? 'replace' : 'any',
      payloadBytes,
      maxPayloadBytes: DEGRADED_MAX_PAYLOAD_BYTES
    },
    failureState: {
      locked: nonRetryableFailure,
      lastFailureCode: dependencyHealth.lastFailureCode || null,
      lastFailureAt: dependencyHealth.lastFailureAt || null
    },
    gateErrors,
    nextAction: gateErrors.length
      ? gateErrors[0].action || 'fix-request-and-resubmit'
      : pendingCurrentCommand ? 'resume-pending-command'
        : 'prepare-and-commit'
  };
}

function memoryStateKey(scope) {
  return `${scope.tenantId || 'unknown'}:${scope.workspaceId || 'unknown'}:${scope.namespace}:${scope.memoryKey || 'missing-key'}`;
}

function stableValueSignature(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableValueSignature(entry, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValueSignature(value[key], seen)}`).join(',')}}`;
}

function deriveCommandId({ input, actor, scope, write }) {
  const requested = isObject(input.command) ? input.command : input;
  const provided = asString(requested.commandId || requested.idempotencyKey || write.commandId);
  if (provided) return { commandId: provided, source: 'caller' };
  const basis = [
    actor.actorId,
    memoryStateKey(scope),
    write.mode,
    write.expectedRevision || 'unconditional',
    write.ttlSeconds || 'no-ttl',
    write.reason || 'unspecified',
    payloadSizeBytes(write.value),
    stableValueSignature(write.value)
  ].join('|');
  let hash = 0;
  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash << 5) - hash + basis.charCodeAt(index)) | 0;
  }
  return { commandId: `memory-write-${Math.abs(hash).toString(36)}`, source: 'derived' };
}

function normalizePersistedState(input = {}, scope = {}) {
  const source = isObject(input.persistedState) ? input.persistedState : isObject(input.state) ? input.state : {};
  const stateKey = memoryStateKey(scope);
  const scoped = isObject(source.memory) && isObject(source.memory[stateKey]) ? source.memory[stateKey] : {};
  const hasScopedValue = Object.hasOwn(scoped, 'value');
  const hasSourceValue = Object.hasOwn(source, 'value');
  return {
    stateType: 'kernel.memory.write.persisted-state.v1',
    stateKey,
    recovered: source.recovered === true || source.recoveryMode === true,
    restartEpoch: asString(source.restartEpoch || source.bootId || input.restartEpoch),
    currentRevision: asString(scoped.currentRevision || scoped.revision || source.currentRevision || source.revision),
    currentValuePresent: hasScopedValue || hasSourceValue,
    currentValue: hasScopedValue ? scoped.value : hasSourceValue ? source.value : undefined,
    lastCommittedAt: asString(scoped.lastCommittedAt || source.lastCommittedAt),
    appliedCommandIds: uniqueStrings(scoped.appliedCommandIds || source.appliedCommandIds || source.appliedCommands),
    pendingCommandIds: uniqueStrings(scoped.pendingCommandIds || source.pendingCommandIds || source.pendingCommands),
    lastCommandId: asString(scoped.lastCommandId || source.lastCommandId)
  };
}

function normalizePersistedCommandRecords(input = {}, scope = {}) {
  const source = isObject(input.persistedState) ? input.persistedState : isObject(input.state) ? input.state : {};
  const stateKey = memoryStateKey(scope);
  const scoped = isObject(source.memory) && isObject(source.memory[stateKey]) ? source.memory[stateKey] : {};
  const rawRecords = [
    ...(Array.isArray(source.commandJournal) ? source.commandJournal : []),
    ...(Array.isArray(source.commands) ? source.commands : []),
    ...(Array.isArray(scoped.commandJournal) ? scoped.commandJournal : []),
    ...(Array.isArray(scoped.commands) ? scoped.commands : [])
  ];
  const pendingObjects = [
    ...(Array.isArray(source.pendingCommands) ? source.pendingCommands : []),
    ...(Array.isArray(scoped.pendingCommands) ? scoped.pendingCommands : [])
  ].filter(isObject).map((record) => ({ ...record, status: record.status || 'pending' }));
  const appliedObjects = [
    ...(Array.isArray(source.appliedCommands) ? source.appliedCommands : []),
    ...(Array.isArray(scoped.appliedCommands) ? scoped.appliedCommands : [])
  ].filter(isObject).map((record) => ({ ...record, status: record.status || 'applied' }));
  const records = [...rawRecords, ...pendingObjects, ...appliedObjects]
    .filter(isObject)
    .map((record) => {
      const rawStatus = asString(record.status || record.state || record.phase) || 'observed';
      const status = ['committed', 'commit', 'complete', 'succeeded'].includes(rawStatus) ? 'applied'
        : ['denied', 'failed-validation'].includes(rawStatus) ? 'rejected'
          : ['prepared', 'pending', 'handoff-pending', 'retrying', 'applied', 'rejected'].includes(rawStatus) ? rawStatus
            : 'observed';
      return {
        recordType: 'kernel.memory.write.persisted-command-record.v1',
        commandId: asString(record.commandId || record.id || record.idempotencyKey),
        status,
        stateKey: asString(record.stateKey) || stateKey,
        providerId: asString(record.providerId),
        writeMode: asString(record.writeMode || record.mode),
        expectedRevision: asString(record.expectedRevision),
        previousRevision: asString(record.previousRevision),
        nextRevision: asString(record.nextRevision || record.revision),
        preparedAt: asString(record.preparedAt),
        handoffAt: asString(record.handoffAt || record.enqueuedAt),
        committedAt: asString(record.committedAt || record.appliedAt),
        rejectedAt: asString(record.rejectedAt || record.deniedAt),
        lastObservedAt: asString(record.lastObservedAt || record.updatedAt || record.createdAt),
        failureCode: asString(record.failureCode || record.errorCode),
        resumeToken: asString(record.resumeToken),
        attempt: boundedInteger(record.attempt, 0, 0, 1_000)
      };
    })
    .filter((record) => record.commandId && record.stateKey === stateKey);
  const byCommand = new Map();
  for (const record of records) {
    const previous = byCommand.get(record.commandId);
    const previousObservedAt = previous ? Date.parse(previous.lastObservedAt || previous.committedAt || previous.preparedAt || '') : 0;
    const nextObservedAt = Date.parse(record.lastObservedAt || record.committedAt || record.preparedAt || '');
    if (!previous || (Number.isFinite(nextObservedAt) && nextObservedAt >= (Number.isFinite(previousObservedAt) ? previousObservedAt : 0))) {
      byCommand.set(record.commandId, record);
    }
  }
  return [...byCommand.values()].slice(-100);
}

function buildPersistedRecoveryEnvelope({ now, scope, commandId, persistedState, commandRecords }) {
  const currentRecord = commandRecords.find((record) => record.commandId === commandId) || null;
  const currentStatus = currentRecord?.status || (
    persistedState.appliedCommandIds.includes(commandId) ? 'applied'
      : persistedState.pendingCommandIds.includes(commandId) ? 'pending'
        : 'new'
  );
  const preparedAt = currentRecord?.preparedAt || null;
  const preparedAgeMs = preparedAt && Number.isFinite(Date.parse(preparedAt)) && Number.isFinite(Date.parse(now))
    ? Math.max(0, Date.parse(now) - Date.parse(preparedAt))
    : 0;
  const stalePrepared = ['prepared', 'pending', 'handoff-pending'].includes(currentStatus) && preparedAgeMs > STALE_PREPARED_COMMAND_MS;
  const unresolvedRecords = commandRecords.filter((record) => ['prepared', 'pending', 'handoff-pending', 'retrying'].includes(record.status));
  const failedRecords = commandRecords.filter((record) => record.failureCode);
  const replayAction = currentStatus === 'applied' ? 'return-idempotent-success'
    : currentStatus === 'rejected' ? 'return-idempotent-rejection'
      : currentStatus === 'handoff-pending' ? 'confirm-provider-handoff-before-retry'
        : stalePrepared ? 'recover-stale-prepared-command'
          : currentStatus === 'pending' || currentStatus === 'prepared' ? 'resume-prepared-command'
            : 'prepare-new-command';
  return {
    envelopeType: 'kernel.memory.write.persisted-recovery-envelope.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    restartEpoch: persistedState.restartEpoch || null,
    recovered: persistedState.recovered,
    currentCommand: currentRecord,
    commandStatus: currentStatus,
    idempotency: {
      duplicateApplied: currentStatus === 'applied',
      duplicateRejected: currentStatus === 'rejected',
      pendingReplay: ['prepared', 'pending', 'handoff-pending', 'retrying'].includes(currentStatus),
      outcomeKnown: ['applied', 'rejected'].includes(currentStatus),
      replayAction
    },
    unresolved: {
      count: unresolvedRecords.length,
      commandIds: unresolvedRecords.map((record) => record.commandId),
      oldestPreparedAt: unresolvedRecords.map((record) => record.preparedAt).filter(Boolean).sort()[0] || null
    },
    stalePrepared: {
      active: stalePrepared,
      preparedAt,
      ageMs: preparedAgeMs,
      thresholdMs: STALE_PREPARED_COMMAND_MS,
      action: stalePrepared ? 'read-journal-before-commit' : 'none'
    },
    failureDigest: {
      count: failedRecords.length,
      lastFailureCode: failedRecords.at(-1)?.failureCode || null,
      lastFailedCommandId: failedRecords.at(-1)?.commandId || null
    },
    records: commandRecords.slice(-20)
  };
}

function addSecondsIso(now, seconds) {
  if (!seconds) return null;
  const base = Date.parse(now);
  if (!Number.isFinite(base)) return null;
  return new Date(base + seconds * 1000).toISOString();
}

function revisionHash(value) {
  const basis = stableValueSignature(value);
  let hash = 0;
  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash << 5) - hash + basis.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildMemoryMutationPlan({ now, scope, write, commandId, persistedState, lifecycleControl }) {
  const currentValue = persistedState.currentValue;
  const currentValuePresent = persistedState.currentValuePresent;
  const mutationErrors = [];
  let nextValue;

  if (lifecycleControl.lifecycleCommandOnly) {
    return {
      planType: 'kernel.memory.write.mutation-plan.v1',
      generatedAt: now,
      stateKey: memoryStateKey(scope),
      commandId,
      operation: 'lifecycle-settings-only',
      valid: true,
      currentRevision: persistedState.currentRevision || null,
      nextRevision: persistedState.currentRevision || null,
      currentValuePresent,
      previousPayloadShape: currentValuePresent ? previewPayloadShape(currentValue) : null,
      incomingPayloadShape: null,
      nextPayloadShape: null,
      nextValue: undefined,
      expiresAt: null,
      mutationErrors,
      nextAction: 'persist-lifecycle-settings'
    };
  }

  if (write.mode === 'replace') {
    nextValue = write.value;
  } else if (write.mode === 'merge') {
    if (!isObject(write.value)) {
      mutationErrors.push({
        code: 'memory_write_merge_payload_invalid',
        message: 'Merge writes require an object payload.',
        action: 'send-object-merge-payload'
      });
    }
    if (currentValuePresent && !isObject(currentValue)) {
      mutationErrors.push({
        code: 'memory_write_merge_target_invalid',
        message: 'Merge writes require the existing memory value to be an object.',
        currentValueType: currentValue === null ? 'null' : Array.isArray(currentValue) ? 'array' : typeof currentValue,
        action: 'refresh-or-replace-memory-value'
      });
    }
    nextValue = mutationErrors.length ? undefined : {
      ...(currentValuePresent ? currentValue : {}),
      ...write.value
    };
  } else if (write.mode === 'append') {
    if (Array.isArray(write.value)) {
      if (currentValuePresent && !Array.isArray(currentValue)) {
        mutationErrors.push({
          code: 'memory_write_append_target_invalid',
          message: 'Array append writes require the existing memory value to be an array.',
          currentValueType: currentValue === null ? 'null' : typeof currentValue,
          action: 'refresh-or-replace-memory-value'
        });
      }
      nextValue = mutationErrors.length ? undefined : [
        ...(currentValuePresent ? currentValue : []),
        ...write.value
      ];
    } else if (typeof write.value === 'string') {
      if (currentValuePresent && typeof currentValue !== 'string') {
        mutationErrors.push({
          code: 'memory_write_append_target_invalid',
          message: 'String append writes require the existing memory value to be a string.',
          currentValueType: currentValue === null ? 'null' : Array.isArray(currentValue) ? 'array' : typeof currentValue,
          action: 'refresh-or-replace-memory-value'
        });
      }
      nextValue = mutationErrors.length ? undefined : `${currentValuePresent ? currentValue : ''}${write.value}`;
    } else {
      mutationErrors.push({
        code: 'memory_write_append_payload_invalid',
        message: 'Append writes require an array or string payload.',
        payloadType: write.valueType,
        action: 'send-array-or-string-append-payload'
      });
    }
  }

  const valid = mutationErrors.length === 0 && typeof nextValue !== 'undefined';
  const nextRevision = valid
    ? `memrev-${revisionHash({
        stateKey: memoryStateKey(scope),
        commandId,
        previousRevision: persistedState.currentRevision || null,
        value: nextValue
      })}`
    : null;

  return {
    planType: 'kernel.memory.write.mutation-plan.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    operation: write.mode,
    valid,
    currentRevision: persistedState.currentRevision || null,
    nextRevision,
    currentValuePresent,
    previousPayloadShape: currentValuePresent ? previewPayloadShape(currentValue) : null,
    incomingPayloadShape: previewPayloadShape(write.value),
    nextPayloadShape: valid ? previewPayloadShape(nextValue) : null,
    nextValue,
    expiresAt: valid ? addSecondsIso(now, write.ttlSeconds) : null,
    mutationErrors,
    nextAction: valid ? 'commit-materialized-memory-value' : mutationErrors[0]?.action || 'fix-memory-mutation'
  };
}

function buildRestartSafeStatus({ now, decision, persistedState, persistedRecovery, commandId, errors, lifecycleControl }) {
  const alreadyApplied = persistedState.appliedCommandIds.includes(commandId);
  const pendingReplay = persistedState.pendingCommandIds.includes(commandId);
  const idempotentApplied = alreadyApplied || persistedRecovery.idempotency.duplicateApplied;
  const idempotentRejected = persistedRecovery.idempotency.duplicateRejected;
  const journalReplay = pendingReplay || persistedRecovery.idempotency.pendingReplay;
  const revisionConflict = errors.some((error) => error.code === 'expected_revision_conflict');
  const status = idempotentApplied ? 'already-applied'
    : idempotentRejected ? 'already-rejected'
      : decision === 'denied' ? revisionConflict ? 'revision-conflict' : 'denied'
        : persistedRecovery.stalePrepared.active ? 'recovery-review-required'
          : journalReplay ? 'pending-retry'
            : lifecycleControl && !lifecycleControl.scheduling.due ? 'scheduled-hold'
              : 'ready-to-commit';
  return {
    statusType: 'kernel.memory.write.restart-safe-status.v1',
    generatedAt: now,
    stateKey: persistedState.stateKey,
    commandId,
    status,
    restartEpoch: persistedState.restartEpoch || null,
    recovered: persistedState.recovered,
    duplicateCommand: idempotentApplied || idempotentRejected,
    pendingReplay: journalReplay,
    recoveryReviewRequired: persistedRecovery.stalePrepared.active,
    persistedCommandStatus: persistedRecovery.commandStatus,
    idempotencyOutcome: persistedRecovery.idempotency.replayAction,
    currentRevision: persistedState.currentRevision || null,
    lastCommittedAt: persistedState.lastCommittedAt || null,
    safeToApply: decision === 'accepted' && !idempotentApplied && !persistedRecovery.stalePrepared.active && status !== 'scheduled-hold',
    terminal: decision === 'denied' || idempotentApplied || idempotentRejected,
    recoveryEnvelope: {
      envelopeType: persistedRecovery.envelopeType,
      unresolvedCount: persistedRecovery.unresolved.count,
      stalePrepared: persistedRecovery.stalePrepared.active,
      lastFailureCode: persistedRecovery.failureDigest.lastFailureCode,
      replayAction: persistedRecovery.idempotency.replayAction
    },
    nextAction: status === 'scheduled-hold'
      ? 'wait-until-scheduled-time'
      : status === 'recovery-review-required' ? 'read-journal-before-commit'
      : idempotentApplied ? 'no-op-already-applied'
        : idempotentRejected ? 'no-op-already-rejected'
          : decision === 'denied' ? 'resolve-memory-write-errors'
            : journalReplay ? persistedRecovery.idempotency.replayAction
            : 'apply-memory-write'
  };
}

function buildPersistenceCommands({ now, actor, scope, write, commandId, commandSource, persistedState, persistedRecovery, restartSafeStatus, lifecycleControl, lifecycleCommandPlan, providerNegotiation, memoryMutationPlan }) {
  const base = {
    stateKey: persistedState.stateKey,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey,
    commandId,
    commandSource,
    actorId: actor.actorId,
    restartEpoch: persistedState.restartEpoch || null,
    recoveryReplayAction: persistedRecovery.idempotency.replayAction
  };
  if (lifecycleControl.lifecycleCommandOnly && lifecycleCommandPlan.accepted === true && restartSafeStatus.status !== 'denied') {
    return [{
      commandType: 'kernel.memory.write.persistence.lifecycle-settings.v1',
      ...base,
      lifecycleCommand: lifecycleControl.lifecycleCommand,
      appliedAt: now,
      authorized: lifecycleControl.configureAuthorized,
      activation: lifecycleCommandPlan.activation,
      commandAcknowledgement: lifecycleCommandPlan.commandAcknowledgement,
      settingsPatch: lifecycleCommandPlan.settingsPatch,
      settingsTransition: lifecycleCommandPlan.settingsTransition,
      previousLifecycleRevision: lifecycleCommandPlan.settingsTransition?.previousRevision || null,
      nextLifecycleRevision: lifecycleCommandPlan.settingsTransition?.nextRevision || null,
      previousSettings: {
        enabled: lifecycleControl.enabled,
        disabledUntil: lifecycleControl.disabledUntil,
        pausedUntil: lifecycleControl.pausedUntil,
        maintenanceWindow: lifecycleControl.maintenanceWindow,
        allowedModes: lifecycleControl.allowedModes,
        requireReason: lifecycleControl.requireReason,
        maxTtlSeconds: lifecycleControl.maxTtlSeconds
      },
      nextAction: lifecycleControl.lifecycleCommand === 'schedule'
        ? lifecycleControl.scheduling.due ? 'apply-scheduled-lifecycle-command' : 'hold-until-lifecycle-schedule'
        : lifecycleCommandPlan.nextAction
    }];
  }
  if (restartSafeStatus.status === 'already-applied') {
    return [{
      commandType: 'kernel.memory.write.persistence.noop.v1',
      ...base,
      reason: 'command-already-applied',
      observedRevision: persistedState.currentRevision || null
    }];
  }
  if (restartSafeStatus.status === 'already-rejected') {
    return [{
      commandType: 'kernel.memory.write.persistence.noop.v1',
      ...base,
      reason: 'command-already-rejected',
      observedRevision: persistedState.currentRevision || null,
      originalRecord: persistedRecovery.currentCommand
    }];
  }
  if (restartSafeStatus.status === 'recovery-review-required') {
    return [{
      commandType: 'kernel.memory.write.persistence.recovery-review.v1',
      ...base,
      reason: 'stale-prepared-command',
      observedRevision: persistedState.currentRevision || null,
      stalePrepared: persistedRecovery.stalePrepared,
      unresolvedCommandIds: persistedRecovery.unresolved.commandIds,
      nextAction: 'read-journal-before-commit'
    }];
  }
  if (restartSafeStatus.status === 'revision-conflict' || restartSafeStatus.status === 'denied') {
    return [{
      commandType: 'kernel.memory.write.persistence.reject.v1',
      ...base,
      reason: restartSafeStatus.status,
      observedRevision: persistedState.currentRevision || null,
      expectedRevision: write.expectedRevision || null
    }];
  }
  if (!lifecycleControl.scheduling.due) {
    return [{
      commandType: 'kernel.memory.write.persistence.schedule.v1',
      ...base,
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      holdUntil: lifecycleControl.scheduling.holdUntil,
      expectedRevision: write.expectedRevision || null,
      writeMode: write.mode,
      ttlSeconds: write.ttlSeconds || null
    }];
  }
  if (providerNegotiation?.externalHandoffRequired && !providerNegotiation.executionBlocked) {
    return [
      {
      commandType: 'kernel.memory.write.persistence.prepare.v1',
      ...base,
      preparedAt: now,
      expectedRevision: write.expectedRevision || null,
      providerId: providerNegotiation.provider.providerId,
      mutationPlanType: memoryMutationPlan.planType,
      nextRevision: memoryMutationPlan.nextRevision,
      expiresAt: memoryMutationPlan.expiresAt,
      pendingCommandIds: uniqueStrings([...persistedState.pendingCommandIds, commandId])
    },
    {
      commandType: 'kernel.memory.write.persistence.provider-handoff.v1',
        ...base,
        handoffAt: now,
        providerId: providerNegotiation.provider.providerId,
        providerKind: providerNegotiation.provider.providerKind,
        handoffQueue: providerNegotiation.provider.handoffQueue,
      syncMetadata: providerNegotiation.syncMetadata,
      writeMode: write.mode,
      ttlSeconds: write.ttlSeconds || null,
      previousRevision: persistedState.currentRevision || null,
      nextRevision: memoryMutationPlan.nextRevision,
      materializedPayloadShape: memoryMutationPlan.nextPayloadShape,
      expiresAt: memoryMutationPlan.expiresAt,
      pendingCommandIds: uniqueStrings([...persistedState.pendingCommandIds, commandId])
    }
  ];
  }
  return [
    {
    commandType: 'kernel.memory.write.persistence.prepare.v1',
    ...base,
    preparedAt: now,
    expectedRevision: write.expectedRevision || null,
    mutationPlanType: memoryMutationPlan.planType,
    nextRevision: memoryMutationPlan.nextRevision,
    expiresAt: memoryMutationPlan.expiresAt,
    pendingCommandIds: uniqueStrings([...persistedState.pendingCommandIds, commandId])
  },
  {
    commandType: 'kernel.memory.write.persistence.commit.v1',
      ...base,
      commitAfterMemoryApply: true,
    writeMode: write.mode,
    ttlSeconds: write.ttlSeconds || null,
    previousRevision: persistedState.currentRevision || null,
    nextRevision: memoryMutationPlan.nextRevision,
    materializedValue: memoryMutationPlan.nextValue,
    materializedPayloadShape: memoryMutationPlan.nextPayloadShape,
    expiresAt: memoryMutationPlan.expiresAt,
    appliedCommandIds: uniqueStrings([...persistedState.appliedCommandIds, commandId]),
    pendingCommandIds: persistedState.pendingCommandIds.filter((pendingId) => pendingId !== commandId)
  }
];
}

function buildPersistedStateShape({ now, scope, commandId, persistedState, persistedRecovery, restartSafeStatus, persistenceCommands, memoryMutationPlan, lifecycleCommandPlan, providerNegotiation }) {
  const stateKey = persistedState.stateKey;
  const terminalReplay = ['already-applied', 'already-rejected'].includes(restartSafeStatus.status);
  const commitCommand = persistenceCommands.find((command) => command.commandType.endsWith('.commit.v1')) || null;
  const handoffCommand = persistenceCommands.find((command) => command.commandType.endsWith('.provider-handoff.v1')) || null;
  const scheduleCommand = persistenceCommands.find((command) => command.commandType.endsWith('.schedule.v1')) || null;
  const rejectCommand = persistenceCommands.find((command) => command.commandType.endsWith('.reject.v1')) || null;
  const lifecycleCommand = persistenceCommands.find((command) => command.commandType.endsWith('.lifecycle-settings.v1')) || null;
  const prepareCommand = persistenceCommands.find((command) => command.commandType.endsWith('.prepare.v1')) || null;
  const unresolvedAfter = uniqueStrings([
    ...persistedRecovery.unresolved.commandIds.filter((id) => id !== commandId),
    prepareCommand || handoffCommand || scheduleCommand ? commandId : ''
  ]);
  const appliedAfter = commitCommand
    ? uniqueStrings([...persistedState.appliedCommandIds, commandId])
    : persistedState.appliedCommandIds;
  const pendingAfter = commitCommand || rejectCommand || terminalReplay || lifecycleCommand
    ? persistedState.pendingCommandIds.filter((id) => id !== commandId)
    : uniqueStrings([...persistedState.pendingCommandIds, ...(prepareCommand || handoffCommand || scheduleCommand ? [commandId] : [])]);
  const recordStatus = commitCommand ? 'applied'
    : rejectCommand ? 'rejected'
      : handoffCommand ? 'handoff-pending'
        : scheduleCommand ? 'pending'
          : prepareCommand ? 'prepared'
            : lifecycleCommand ? 'applied'
              : terminalReplay ? restartSafeStatus.persistedCommandStatus
                : restartSafeStatus.status === 'recovery-review-required' ? 'requires-review'
                  : 'observed';
  const commandRecord = {
    recordType: 'kernel.memory.write.persisted-command-record.v1',
    commandId,
    stateKey,
    status: recordStatus,
    providerId: providerNegotiation.provider.providerId,
    writeMode: memoryMutationPlan.operation,
    expectedRevision: prepareCommand?.expectedRevision || rejectCommand?.expectedRevision || null,
    previousRevision: commitCommand?.previousRevision || handoffCommand?.previousRevision || memoryMutationPlan.currentRevision,
    nextRevision: commitCommand?.nextRevision || handoffCommand?.nextRevision || prepareCommand?.nextRevision || memoryMutationPlan.nextRevision,
    preparedAt: prepareCommand?.preparedAt || null,
    handoffAt: handoffCommand?.handoffAt || null,
    committedAt: commitCommand ? now : lifecycleCommand ? lifecycleCommand.appliedAt : null,
    rejectedAt: rejectCommand ? now : null,
    lastObservedAt: now,
    failureCode: rejectCommand?.reason || null,
    resumeToken: `${stateKey}:${commandId}:resume`,
    attempt: 0
  };
  const memoryPatch = commitCommand ? {
    value: commitCommand.materializedValue,
    previousRevision: commitCommand.previousRevision || null,
    currentRevision: commitCommand.nextRevision,
    nextRevision: commitCommand.nextRevision,
    lastCommittedAt: now,
    lastCommandId: commandId,
    appliedCommandIds: appliedAfter,
    pendingCommandIds: pendingAfter
  } : {
    previousRevision: persistedState.currentRevision || null,
    currentRevision: persistedState.currentRevision || null,
    nextRevision: memoryMutationPlan.nextRevision,
    lastCommandId: commandId,
    appliedCommandIds: appliedAfter,
    pendingCommandIds: pendingAfter
  };
  const lifecyclePatch = lifecycleCommand ? {
    lifecycleSettingsRevision: lifecycleCommand.nextLifecycleRevision,
    settingsPatch: lifecycleCommand.settingsPatch,
    lastLifecycleCommandId: commandId,
    lastLifecycleCommandAt: now
  } : lifecycleCommandPlan.accepted === true ? {
    lifecycleSettingsRevision: lifecycleCommandPlan.nextLifecycleRevision || null,
    settingsPatch: lifecycleCommandPlan.settingsPatch || null,
    lastLifecycleCommandId: commandId,
    lastLifecycleCommandAt: now
  } : null;

  return {
    shapeType: 'kernel.memory.write.persisted-state-shape.v1',
    generatedAt: now,
    stateKey,
    commandId,
    restartEpoch: persistedState.restartEpoch || null,
    status: restartSafeStatus.status,
    idempotencyOutcome: restartSafeStatus.idempotencyOutcome,
    commandRecord,
    indexes: {
      appliedCommandIds: appliedAfter,
      pendingCommandIds: pendingAfter,
      unresolvedCommandIds: unresolvedAfter,
      commandJournalAppendRequired: !terminalReplay,
      commandRecordDedupeKey: `${stateKey}:${commandId}:${recordStatus}`
    },
    memoryPatch,
    lifecyclePatch,
    providerPatch: handoffCommand ? {
      providerId: handoffCommand.providerId,
      providerKind: handoffCommand.providerKind,
      handoffQueue: handoffCommand.handoffQueue,
      syncMetadata: handoffCommand.syncMetadata,
      externalStatus: 'handoff-pending'
    } : null,
    recoveryPolicy: {
      replayAction: persistedRecovery.idempotency.replayAction,
      terminalReplay,
      requiresJournalRead: restartSafeStatus.status === 'recovery-review-required',
      safeToCompactPending: recordStatus === 'applied' || recordStatus === 'rejected',
      nextAction: restartSafeStatus.status === 'recovery-review-required'
        ? 'read-journal-before-commit'
        : terminalReplay ? 'preserve-existing-command-record'
          : recordStatus === 'handoff-pending' ? 'persist-provider-handoff-record'
            : recordStatus === 'applied' ? 'persist-commit-and-compact-pending'
              : recordStatus === 'rejected' ? 'persist-rejection-and-compact-pending'
                : 'persist-command-record'
    }
  };
}

function buildAnalyticsCounterSet({ actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation }) {
  const payloadBytes = payloadSizeBytes(write.value);
  const denialCodes = errors.map((error) => error.code);
  const counters = {
    totalWritePlans: 1,
    acceptedWritePlans: decision === 'accepted' ? 1 : 0,
    deniedWritePlans: decision === 'denied' ? 1 : 0,
    crossWorkspaceAttempts: actor.workspaceId && scope.workspaceId && actor.workspaceId !== scope.workspaceId ? 1 : 0,
    delegatedWorkspaceWrites: scopeBinding.workspaceWriteAuthorized && scopeBinding.crossWorkspace ? 1 : 0,
    protectedNamespaceWrites: scopeBinding.protectedNamespace ? 1 : 0,
    bindingScopedWrites: scopeBinding.writeBindingId ? 1 : 0,
    ttlWrites: write.ttlSeconds ? 1 : 0,
    expectedRevisionWrites: write.expectedRevision ? 1 : 0,
    lifecycleHeldWrites: lifecycleControl.writeAdmission.blocked ? 1 : 0,
    scheduledWrites: write.scheduledAt ? 1 : 0,
    providerNegotiatedWrites: providerNegotiation ? 1 : 0,
    providerHandoffWrites: providerNegotiation?.externalHandoffRequired ? 1 : 0,
    providerCapabilityMisses: providerNegotiation?.missingCapabilities.length || 0,
    payloadBytes
  };
  return {
    counterType: 'kernel.memory.write.analytics.counters',
    surfaceId,
    dimensions: {
      tenantId: scope.tenantId || 'unknown-tenant',
      workspaceId: scope.workspaceId || 'unknown-workspace',
      namespace: scope.namespace,
      writeMode: write.mode,
      decision,
      payloadType: write.valueType,
      payloadSizeClass: classifyPayloadSize(payloadBytes),
      lifecycleNextAction: lifecycleControl.writeAdmission.nextAction,
      providerId: providerNegotiation?.provider.providerId || 'hosted-kernel-memory-provider',
      providerExecutionMode: providerNegotiation?.provider.executionMode || 'inline',
      providerNextAction: providerNegotiation?.nextAction || 'commit-with-hosted-kernel-provider'
    },
    counters,
    denialCodes
  };
}

function buildHistorySnapshot({ now, actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation }) {
  const revisionGuard = write.expectedRevision || 'unconditional';
  return {
    snapshotType: 'kernel.memory.write.history',
    capturedAt: now,
    surfaceId,
    key: memoryStateKey(scope),
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey || null,
    actorId: actor.actorId,
    decision,
    writeMode: write.mode,
    reason: write.reason || 'unspecified',
    revisionGuard,
    ttlSeconds: write.ttlSeconds || null,
    scopeBinding: {
      crossWorkspace: scopeBinding.crossWorkspace,
      workspaceWriteAuthorized: scopeBinding.workspaceWriteAuthorized,
      protectedNamespace: scopeBinding.protectedNamespace,
      writeBindingId: scopeBinding.writeBindingId
    },
    lifecycleControl: {
      enabled: lifecycleControl.enabled,
      lifecycleCommand: lifecycleControl.lifecycleCommand,
      nextAction: lifecycleControl.writeAdmission.nextAction,
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      blocked: lifecycleControl.writeAdmission.blocked
    },
    providerContract: {
      providerId: providerNegotiation.provider.providerId,
      providerKind: providerNegotiation.provider.providerKind,
      executionMode: providerNegotiation.provider.executionMode,
      missingCapabilities: providerNegotiation.missingCapabilities,
      syncCursor: providerNegotiation.syncMetadata.cursor,
      syncSequence: providerNegotiation.syncMetadata.sequence,
      nextAction: providerNegotiation.nextAction
    },
    payload: {
      valueType: write.valueType,
      sizeBytes: payloadSizeBytes(write.value)
    },
    denialCodes: errors.map((error) => error.code)
  };
}

function buildTimelineEvent({ now, actor, scope, write, decision, errors }) {
  const severity = decision === 'accepted' ? 'info' : errors.some((error) => error.code.includes('tenant') || error.code.includes('workspace')) ? 'warning' : 'notice';
  return {
    eventType: 'kernel.memory.write.timeline',
    occurredAt: now,
    surfaceId,
    severity,
    title: decision === 'accepted' ? 'Memory write accepted' : 'Memory write denied',
    summary: `${write.mode} ${scope.namespace}/${scope.memoryKey || 'missing-key'} by ${actor.actorId}`,
    route: {
      syscall: 'memory.write',
      surfaceGroup,
      surfaceName
    },
    tags: uniqueStrings([
      decision,
      write.mode,
      write.valueType,
      scope.namespace,
      ...errors.map((error) => error.code)
    ])
  };
}

function buildExportSummary({ now, actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation }) {
  const denialCodes = errors.map((error) => error.code);
  return {
    exportType: 'kernel.memory.write.summary.v1',
    generatedAt: now,
    surfaceId,
    row: {
      occurredAt: now,
      decision,
      tenantId: scope.tenantId || '',
      workspaceId: scope.workspaceId || '',
      namespace: scope.namespace,
      memoryKey: scope.memoryKey || '',
      actorId: actor.actorId,
      writeMode: write.mode,
      valueType: write.valueType,
      payloadBytes: payloadSizeBytes(write.value),
      ttlSeconds: write.ttlSeconds || '',
      expectedRevision: write.expectedRevision || '',
      scopeBindingId: scopeBinding.writeBindingId || '',
      crossWorkspace: scopeBinding.crossWorkspace ? 'true' : 'false',
      protectedNamespace: scopeBinding.protectedNamespace ? 'true' : 'false',
      lifecycleNextAction: lifecycleControl.writeAdmission.nextAction,
      scheduledAt: lifecycleControl.scheduling.scheduledAt || '',
      providerId: providerNegotiation.provider.providerId,
      providerKind: providerNegotiation.provider.providerKind,
      providerExecutionMode: providerNegotiation.provider.executionMode,
      providerNextAction: providerNegotiation.nextAction,
      syncCursor: providerNegotiation.syncMetadata.cursor || '',
      syncSequence: Number.isFinite(providerNegotiation.syncMetadata.sequence) ? String(providerNegotiation.syncMetadata.sequence) : '',
      denialCodes: denialCodes.join(',')
    },
    columns: [
      'occurredAt',
      'decision',
      'tenantId',
      'workspaceId',
      'namespace',
      'memoryKey',
      'actorId',
      'writeMode',
      'valueType',
      'payloadBytes',
      'ttlSeconds',
      'expectedRevision',
      'scopeBindingId',
      'crossWorkspace',
      'protectedNamespace',
      'lifecycleNextAction',
      'scheduledAt',
      'providerId',
      'providerKind',
      'providerExecutionMode',
      'providerNextAction',
      'syncCursor',
      'syncSequence',
      'denialCodes'
    ]
  };
}

function normalizeAnalyticsHistory(input = {}) {
  const source = isObject(input.analyticsHistory) ? input.analyticsHistory
    : isObject(input.memoryWriteAnalytics) ? input.memoryWriteAnalytics
      : isObject(input.reportingHistory) ? input.reportingHistory
        : {};
  const snapshots = [
    ...(Array.isArray(source.snapshots) ? source.snapshots : []),
    ...(Array.isArray(source.historySnapshots) ? source.historySnapshots : [])
  ].filter(isObject).slice(-20);
  const timeline = [
    ...(Array.isArray(source.timeline) ? source.timeline : []),
    ...(Array.isArray(source.timelineEvents) ? source.timelineEvents : [])
  ].filter(isObject).slice(-20);
  const counters = isObject(source.counters) ? source.counters
    : isObject(source.counterTotals) ? source.counterTotals
      : {};
  return {
    historyType: 'kernel.memory.write.analytics-history-input.v1',
    snapshots,
    timeline,
    counters: Object.fromEntries(
      Object.entries(counters)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => [key, Math.max(0, Math.floor(value))])
    ),
    lastExportedAt: asString(source.lastExportedAt || source.exportedAt),
    lastSnapshotSequence: boundedInteger(source.lastSnapshotSequence ?? source.snapshotSequence, snapshots.length, 0, 1_000_000)
  };
}

function mergeCounterTotals(previousCounters = {}, currentCounters = {}) {
  const keys = uniqueStrings([...Object.keys(previousCounters), ...Object.keys(currentCounters)]);
  return Object.fromEntries(
    keys.map((key) => [
      key,
      Math.max(0, Math.floor(Number(previousCounters[key]) || 0)) + Math.max(0, Math.floor(Number(currentCounters[key]) || 0))
    ])
  );
}

function buildAnalyticsReportingBundle({ now, scope, commandId, decision, analyticsHistory, analyticsCounters, historySnapshot, timelineEvent, exportSummary, validationSummary, providerNegotiation, clientWorkflowHandoff }) {
  const cumulativeCounters = mergeCounterTotals(analyticsHistory.counters, analyticsCounters.counters);
  const snapshotSequence = analyticsHistory.lastSnapshotSequence + 1;
  const stateKey = memoryStateKey(scope);
  const recentSnapshots = [...analyticsHistory.snapshots, historySnapshot].slice(-10);
  const recentTimeline = [...analyticsHistory.timeline, timelineEvent].slice(-10);
  const acceptedTotal = cumulativeCounters.acceptedWritePlans || 0;
  const deniedTotal = cumulativeCounters.deniedWritePlans || 0;
  const totalPlans = Math.max(1, cumulativeCounters.totalWritePlans || acceptedTotal + deniedTotal);
  const exportPartition = [
    scope.tenantId || 'unknown-tenant',
    scope.workspaceId || 'unknown-workspace',
    scope.namespace,
    now.slice(0, 10)
  ].map((part) => String(part).replaceAll(/[^a-zA-Z0-9._-]/g, '_')).join('/');

  return {
    bundleType: 'kernel.memory.write.analytics-reporting-bundle.v1',
    generatedAt: now,
    surfaceId,
    stateKey,
    commandId,
    history: {
      snapshotSequence,
      retainedSnapshotCount: recentSnapshots.length,
      currentSnapshot: {
        ...historySnapshot,
        snapshotSequence
      },
      recentSnapshots,
      lastDecision: decision,
      lastDenialCodes: historySnapshot.denialCodes,
      retentionHint: 'retain-last-10-per-memory-key'
    },
    counters: {
      dimensions: analyticsCounters.dimensions,
      current: analyticsCounters.counters,
      previous: analyticsHistory.counters,
      cumulative: cumulativeCounters,
      rates: {
        acceptanceRate: acceptedTotal / totalPlans,
        denialRate: deniedTotal / totalPlans,
        providerHandoffRate: (cumulativeCounters.providerHandoffWrites || 0) / totalPlans,
        protectedNamespaceRate: (cumulativeCounters.protectedNamespaceWrites || 0) / totalPlans
      }
    },
    timelineReport: {
      retainedEventCount: recentTimeline.length,
      currentEvent: timelineEvent,
      recentEvents: recentTimeline,
      milestones: [
        { id: 'validated', status: validationSummary.blocked ? 'blocked' : 'passed', at: now, action: validationSummary.blockingReasons[0]?.action || 'continue-memory-write-plan' },
        { id: 'provider', status: providerNegotiation.executionBlocked ? 'blocked' : providerNegotiation.externalHandoffRequired ? 'handoff' : 'inline', at: now, action: providerNegotiation.nextAction },
        { id: 'client-workflow', status: clientWorkflowHandoff.workflow.state, at: now, action: clientWorkflowHandoff.workflow.primaryAction }
      ]
    },
    exportManifest: {
      exportType: 'csv-rowset',
      ready: true,
      partition: exportPartition,
      fileName: `memory-write-${scope.memoryKey || 'missing-key'}-${snapshotSequence}.csv`,
      columns: exportSummary.columns,
      rows: [exportSummary.row],
      dedupeKey: `${stateKey}:${commandId}:${snapshotSequence}`,
      lastExportedAt: analyticsHistory.lastExportedAt || null,
      nextAction: 'append-memory-write-analytics-row'
    }
  };
}

function validateWrite({ actor, scope, write, policy, persistedState, scopeBinding, operationalHealth, writeSafetyGate, lifecycleControl, providerNegotiation, memoryMutationPlan }) {
  const errors = [];
  const dataWriteRequired = !lifecycleControl.lifecycleCommandOnly;
  const relevantGateErrors = dataWriteRequired
    ? writeSafetyGate.gateErrors
    : writeSafetyGate.gateErrors.filter((error) => [
        'memory_write_failure_state_locked',
        'memory_write_pending_queue_saturated'
      ].includes(error.code));
  errors.push(...lifecycleValidationErrors(lifecycleControl, write));
  if (!actor.tenantId) errors.push({ code: 'actor_tenant_required', message: 'Memory writes require an actor tenant.' });
  if (!scope.tenantId) errors.push({ code: 'scope_tenant_required', message: 'Memory writes require a target tenant.' });
  if (!scope.workspaceId) errors.push({ code: 'workspace_required', message: 'Memory writes require a target workspace.' });
  if (dataWriteRequired && !scope.memoryKey) errors.push({ code: 'memory_key_required', message: 'Memory writes require a memory key.' });
  if (actor.tenantId && scope.tenantId && actor.tenantId !== scope.tenantId) {
    errors.push({ code: 'cross_tenant_write_denied', message: 'Actor tenant must match target memory tenant.' });
  }
  if (scopeBinding.crossWorkspace && !scopeBinding.workspaceWriteAuthorized) {
    errors.push({
      code: 'cross_workspace_write_denied',
      message: 'Cross-workspace memory writes require both the delegation capability and a matching workspace binding.',
      requiredCapability: 'memory:write:any-workspace',
      writeBindingId: scopeBinding.writeBindingId
    });
  }
  if (scopeBinding.readOnlyMatched) {
    errors.push({ code: 'workspace_binding_read_only', message: 'Matched workspace binding is read-only and cannot authorize memory writes.' });
  }
  if (scopeBinding.protectedNamespace && !scopeBinding.protectedNamespaceAllowed) {
    errors.push({
      code: 'protected_namespace_denied',
      message: 'Protected kernel namespaces require kernel role, protected namespace capability, or an explicit protected binding.'
    });
  }
  if (!policy.allowedRoles.some((role) => actor.roles.includes(role))) {
    errors.push({ code: 'role_denied', message: 'Actor role is not allowed to write kernel memory.' });
  }
  if (!actor.capabilities.includes(policy.requiredCapability)) {
    errors.push({ code: 'capability_denied', message: `Actor is missing ${policy.requiredCapability}.` });
  }
  if (dataWriteRequired && !['replace', 'merge', 'append'].includes(write.mode)) {
    errors.push({ code: 'write_mode_invalid', message: 'Memory write mode must be replace, merge, or append.' });
  }
  if (dataWriteRequired && write.valueType === 'undefined') {
    errors.push({ code: 'payload_required', message: 'Memory writes require a payload value.' });
  }
  if (dataWriteRequired && !memoryMutationPlan.valid) {
    errors.push(...memoryMutationPlan.mutationErrors);
  }
  if (operationalHealth.unavailable) {
    errors.push({
      code: 'memory_write_dependency_unavailable',
      message: 'Memory write cannot safely prepare because the persistence path is unavailable.',
      reasons: operationalHealth.unavailableReasons,
      retryable: operationalHealth.retryPlan.retryable,
      retryAfterMs: operationalHealth.retryPlan.retryAfterMs
    });
  }
  if (!writeSafetyGate.safeToPrepare || (dataWriteRequired && !writeSafetyGate.safeToCommit) || relevantGateErrors.length) {
    errors.push(...relevantGateErrors);
  }
  if (providerNegotiation.provider.disabled) {
    errors.push({
      code: 'memory_write_provider_unavailable',
      message: 'Selected memory write provider is unavailable.',
      providerId: providerNegotiation.provider.providerId,
      action: 'select-available-memory-provider',
      retryable: false
    });
  }
  if (providerNegotiation.missingCapabilities.length) {
    errors.push({
      code: 'memory_write_provider_capability_mismatch',
      message: 'Selected memory write provider does not advertise required memory write capabilities.',
      providerId: providerNegotiation.provider.providerId,
      missingCapabilities: providerNegotiation.missingCapabilities,
      action: 'negotiate-memory-provider-capabilities'
    });
  }
  if (providerNegotiation.syncMetadata.stale) {
    errors.push({
      code: 'memory_write_provider_sync_metadata_invalid',
      message: 'Provider sync metadata is ahead of the current syscall time and must be refreshed before handoff.',
      providerId: providerNegotiation.provider.providerId,
      lastSyncedAt: providerNegotiation.syncMetadata.lastSyncedAt,
      action: 'refresh-provider-sync-metadata',
      retryable: true
    });
  }
  if (dataWriteRequired && write.expectedRevision && persistedState.currentRevision && write.expectedRevision !== persistedState.currentRevision) {
    errors.push({
      code: 'expected_revision_conflict',
      message: 'Expected revision does not match the recovered memory revision.',
      expectedRevision: write.expectedRevision,
      currentRevision: persistedState.currentRevision
    });
  }
  return errors;
}

function buildActionableErrors({ now, errors, operationalHealth }) {
  return errors.map((error) => {
    const retryable = error.retryable === true || error.code === 'memory_write_dependency_unavailable';
    const action = error.action
      || (retryable && operationalHealth.retryPlan.retryable ? 'retry-after-backoff'
        : error.code === 'expected_revision_conflict' ? 'refresh-memory-revision'
          : error.code.includes('capability') || error.code.includes('role') ? 'request-memory-write-permission'
            : error.code.includes('workspace') || error.code.includes('tenant') ? 'correct-target-scope'
              : 'fix-request-and-resubmit');
    return {
      errorType: 'kernel.memory.write.actionable-error.v1',
      generatedAt: now,
      code: error.code,
      message: error.message,
      action,
      retryable: retryable && operationalHealth.retryPlan.retryable,
      retryAfterMs: retryable ? operationalHealth.retryPlan.retryAfterMs : 0,
      terminal: !(retryable && operationalHealth.retryPlan.retryable),
      details: Object.fromEntries(
        Object.entries(error)
          .filter(([key]) => !['code', 'message'].includes(key))
      )
    };
  });
}

function previewPayloadShape(value) {
  if (Array.isArray(value)) {
    return {
      shapeType: 'array',
      itemCount: value.length,
      previewKeys: []
    };
  }
  if (isObject(value)) {
    return {
      shapeType: 'object',
      itemCount: Object.keys(value).length,
      previewKeys: Object.keys(value).sort().slice(0, 8)
    };
  }
  return {
    shapeType: value === null ? 'null' : typeof value,
    itemCount: typeof value === 'string' ? value.length : 0,
    previewKeys: []
  };
}

function buildValidationSummary({ now, decision, errors, actionableErrors, operationalHealth, healthIncident, writeSafetyGate, lifecycleControl, providerNegotiation, restartSafeStatus }) {
  const blockingReasons = actionableErrors
    .filter((error) => error.terminal || error.retryable)
    .map((error) => ({
      code: error.code,
      action: error.action,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs
    }));
  const checks = [
    {
      checkId: 'permission-and-scope',
      status: errors.some((error) => ['actor_tenant_required', 'scope_tenant_required', 'workspace_required', 'memory_key_required', 'cross_tenant_write_denied', 'cross_workspace_write_denied', 'role_denied', 'capability_denied', 'protected_namespace_denied'].includes(error.code)) ? 'blocked' : 'passed'
    },
    {
      checkId: 'payload-and-mode',
      status: errors.some((error) => ['write_mode_invalid', 'payload_required', 'memory_write_ttl_exceeds_settings'].includes(error.code)) ? 'blocked' : 'passed'
    },
    {
      checkId: 'lifecycle-admission',
      status: lifecycleControl.writeAdmission.blocked ? 'held' : 'passed',
      nextAction: lifecycleControl.writeAdmission.nextAction
    },
    {
      checkId: 'commit-safety',
      status: writeSafetyGate.safeToCommit ? 'passed' : 'blocked',
      nextAction: writeSafetyGate.nextAction
    },
    {
      checkId: 'operational-health',
      status: healthIncident.status === 'healthy' ? 'passed'
        : healthIncident.status === 'degraded-observe' ? 'degraded'
          : 'blocked',
      severity: healthIncident.severity,
      nextAction: healthIncident.operatorActions[0] || healthIncident.userAction
    },
    {
      checkId: 'provider-readiness',
      status: providerNegotiation.executionBlocked ? 'blocked' : providerNegotiation.externalHandoffRequired ? 'handoff' : 'passed',
      nextAction: providerNegotiation.nextAction
    },
    {
      checkId: 'restart-safety',
      status: restartSafeStatus.safeToApply ? 'passed' : restartSafeStatus.status,
      nextAction: restartSafeStatus.nextAction
    }
  ];
  return {
    summaryType: 'kernel.memory.write.validation-summary.v1',
    generatedAt: now,
    decision,
    accepted: decision === 'accepted',
    ready: decision === 'accepted' && restartSafeStatus.safeToApply && writeSafetyGate.safeToCommit && !providerNegotiation.executionBlocked,
    blocked: decision === 'denied',
    held: restartSafeStatus.status === 'scheduled-hold' || lifecycleControl.writeAdmission.blocked,
    health: operationalHealth.status,
    healthIncident: {
      incidentId: healthIncident.incidentId,
      open: healthIncident.open,
      severity: healthIncident.severity,
      status: healthIncident.status,
      primaryFailureCode: healthIncident.primaryFailureCode,
      retryable: healthIncident.retryBudget.retryable,
      retryAfterMs: healthIncident.retryBudget.retryAfterMs,
      operatorActions: healthIncident.operatorActions
    },
    checkCount: checks.length,
    passedCount: checks.filter((check) => check.status === 'passed').length,
    checks,
    blockingReasons,
    denialCodes: errors.map((error) => error.code)
  };
}

function buildPreviewAcceptanceContract({ now, actor, scope, write, commandId, decision, validationSummary, restartSafeStatus, providerNegotiation, externalProviderHandoff }) {
  const payloadBytes = payloadSizeBytes(write.value);
  const canAccept = decision === 'accepted'
    && validationSummary.ready
    && (providerNegotiation.localApplyAllowed || externalProviderHandoff.ready);
  const acceptanceState = decision === 'denied' ? 'blocked'
    : restartSafeStatus.status === 'scheduled-hold' ? 'scheduled'
      : externalProviderHandoff.ready ? 'ready-for-provider-handoff'
        : providerNegotiation.localApplyAllowed && restartSafeStatus.safeToApply ? 'ready-for-local-commit'
          : 'accepted-held';
  return {
    contractType: 'kernel.memory.write.preview-acceptance.v1',
    generatedAt: now,
    surfaceId,
    stateKey: memoryStateKey(scope),
    commandId,
    actorLabel: actor.actorId,
    targetLabel: `${scope.namespace}/${scope.memoryKey || 'missing-key'}`,
    preview: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      namespace: scope.namespace,
      memoryKey: scope.memoryKey || null,
      mode: write.mode,
      reason: write.reason || null,
      expectedRevision: write.expectedRevision || null,
      ttlSeconds: write.ttlSeconds || null,
      scheduledAt: write.scheduledAt || null,
      payloadType: write.valueType,
      payloadBytes,
      payloadSizeClass: classifyPayloadSize(payloadBytes),
      payloadShape: previewPayloadShape(write.value)
    },
    acceptance: {
      state: acceptanceState,
      canAccept,
      requiresUserConfirmation: canAccept && (write.mode !== 'replace' || providerNegotiation.externalHandoffRequired || Boolean(write.ttlSeconds)),
      localCommitReady: providerNegotiation.localApplyAllowed && restartSafeStatus.safeToApply,
      providerHandoffReady: externalProviderHandoff.ready,
      scheduledHold: restartSafeStatus.status === 'scheduled-hold',
      nextAction: decision === 'denied' ? 'resolve-memory-write-errors' : restartSafeStatus.nextAction
    },
    validationSummary
  };
}

function buildNextStepContracts({ now, scope, commandId, decision, actionableErrors, validationSummary, restartSafeStatus, lifecycleCommandPlan, providerNegotiation, externalProviderHandoff, providerServiceOperation, persistenceCommands }) {
  const routeBase = {
    surfaceId,
    syscall: 'memory.write',
    stateKey: memoryStateKey(scope),
    commandId
  };
  const lifecycleStep = lifecycleCommandPlan.accepted === true
    ? {
        stepType: 'kernel.memory.write.next-step.lifecycle-control.v1',
        ...routeBase,
        label: 'Lifecycle control',
        ready: lifecycleCommandPlan.activation?.status === 'ready'
          || lifecycleCommandPlan.activation?.status === 'drain-ready'
          || lifecycleCommandPlan.activation?.status === 'scheduled',
        action: lifecycleCommandPlan.nextAction,
        dispatch: {
          activation: lifecycleCommandPlan.activation,
          acknowledgement: lifecycleCommandPlan.commandAcknowledgement,
          settingsPatch: lifecycleCommandPlan.settingsPatch,
          persistenceCommand: persistenceCommands.find((command) => command.commandType.endsWith('.lifecycle-settings.v1')) || null
        }
      }
    : null;
  const acceptedStep = lifecycleStep || (providerNegotiation.externalHandoffRequired
    ? {
        stepType: 'kernel.memory.write.next-step.provider-handoff.v1',
        ...routeBase,
        label: 'Provider handoff',
        ready: externalProviderHandoff.ready,
        action: providerNegotiation.nextAction,
        dispatch: externalProviderHandoff.ready ? {
          queue: externalProviderHandoff.queue,
          providerId: externalProviderHandoff.providerId,
          envelope: externalProviderHandoff.envelope,
          serviceOperation: providerServiceOperation
        } : null
      }
    : {
        stepType: 'kernel.memory.write.next-step.local-commit.v1',
        ...routeBase,
        label: 'Local commit',
        ready: restartSafeStatus.safeToApply && providerNegotiation.localApplyAllowed,
        action: restartSafeStatus.nextAction,
        dispatch: restartSafeStatus.safeToApply ? {
          commands: persistenceCommands.map((command) => command.commandType),
          commitCommand: persistenceCommands.find((command) => command.commandType.endsWith('.commit.v1')) || null
        } : null
      });
  const remediationSteps = actionableErrors.map((error) => ({
    stepType: 'kernel.memory.write.next-step.remediation.v1',
    ...routeBase,
    label: error.code,
    ready: false,
    action: error.action,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    terminal: error.terminal,
    details: error.details
  }));
  return {
    contractType: 'kernel.memory.write.next-step-contracts.v1',
    generatedAt: now,
    decision,
    route: routeBase,
    primaryStep: decision === 'accepted' ? acceptedStep : remediationSteps[0] || null,
    steps: decision === 'accepted' ? [acceptedStep] : remediationSteps,
    readiness: {
      ready: validationSummary.ready,
      held: validationSummary.held,
      blocked: validationSummary.blocked,
      nextAction: decision === 'accepted' ? acceptedStep.action : remediationSteps[0]?.action || 'fix-request-and-resubmit'
    }
  };
}

function buildClientWorkflowHandoff({ now, actor, scope, write, commandId, decision, clientRuntimeState, previewAcceptance, validationSummary, nextStepContracts, restartSafeStatus, lifecycleCommandPlan, providerNegotiation, externalProviderHandoff, providerServiceOperation, persistenceCommands, actionableErrors }) {
  const accepted = decision === 'accepted';
  const blocked = decision === 'denied';
  const lifecycleControl = accepted && lifecycleCommandPlan.accepted === true;
  const scheduled = restartSafeStatus.status === 'scheduled-hold';
  const providerHandoff = accepted && providerNegotiation.externalHandoffRequired;
  const localCommit = accepted && providerNegotiation.localApplyAllowed && restartSafeStatus.safeToApply;
  const terminal = blocked || restartSafeStatus.terminal || restartSafeStatus.status === 'already-applied';
  const workflowState = blocked ? 'blocked'
    : lifecycleControl ? lifecycleCommandPlan.activation.status === 'scheduled' ? 'lifecycle-scheduled' : 'lifecycle-ready'
      : scheduled ? 'scheduled'
        : providerHandoff ? externalProviderHandoff.ready ? 'handoff-ready' : 'handoff-held'
          : localCommit ? 'commit-ready'
            : terminal ? restartSafeStatus.status
              : 'accepted-held';
  const primaryAction = blocked
    ? actionableErrors[0]?.action || 'fix-request-and-resubmit'
    : lifecycleControl ? lifecycleCommandPlan.nextAction
      : providerHandoff ? providerNegotiation.nextAction
        : restartSafeStatus.nextAction;
  const resumeTokenParts = [
    surfaceId,
    commandId,
    clientRuntimeState.workflowId || clientRuntimeState.requestId || actor.actorId,
    memoryStateKey(scope)
  ];
  const routeParams = {
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey || null,
    commandId,
    decision,
    workflowState
  };
  return {
    handoffType: 'kernel.memory.write.client-workflow-handoff.v1',
    generatedAt: now,
    surfaceId,
    stateKey: memoryStateKey(scope),
    commandId,
    requestId: clientRuntimeState.requestId || null,
    sessionId: clientRuntimeState.sessionId || null,
    workflowId: clientRuntimeState.workflowId || null,
    correlationId: clientRuntimeState.correlationId || commandId,
    target: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      namespace: scope.namespace,
      memoryKey: scope.memoryKey || null,
      label: `${scope.namespace}/${scope.memoryKey || 'missing-key'}`
    },
    workflow: {
      state: workflowState,
      terminal,
      blocked,
      lifecycleControl,
      scheduled,
      providerHandoff,
      localCommit,
      requiresUserConfirmation: previewAcceptance.acceptance.requiresUserConfirmation,
      primaryAction,
      nextStepType: nextStepContracts.primaryStep?.stepType || null,
      readiness: nextStepContracts.readiness
    },
    returnRoute: {
      routeName: clientRuntimeState.returnRoute.routeName,
      href: clientRuntimeState.returnRoute.href || null,
      replaceHistory: clientRuntimeState.returnRoute.replaceHistory,
      params: routeParams
    },
    clientMutation: {
      mutationId: clientRuntimeState.optimisticUpdate.mutationId || commandId,
      optimisticUpdateEnabled: clientRuntimeState.optimisticUpdate.enabled && accepted,
      rollbackRequired: blocked && clientRuntimeState.optimisticUpdate.rollbackOnDeny,
      invalidateKeys: uniqueStrings([
        `memory:${memoryStateKey(scope)}`,
        `workspace:${scope.workspaceId || 'unknown'}:memory`,
        ...clientRuntimeState.optimisticUpdate.invalidateKeys
      ]),
      previewPayload: {
        writeMode: write.mode,
        valueType: write.valueType,
        payloadBytes: payloadSizeBytes(write.value),
        expectedRevision: write.expectedRevision || null,
        ttlSeconds: write.ttlSeconds || null
      }
    },
    dispatch: {
      kind: lifecycleControl ? 'lifecycle-control'
        : providerHandoff ? 'provider-handoff'
        : localCommit ? 'local-persistence'
          : blocked ? 'client-remediation'
            : scheduled ? 'scheduled-resume'
              : 'status-refresh',
      ready: lifecycleControl ? nextStepContracts.primaryStep?.ready === true
        : providerHandoff ? externalProviderHandoff.ready
        : localCommit ? true
          : blocked ? false
            : scheduled,
      resumeToken: resumeTokenParts.map((part) => String(part).replaceAll(':', '_')).join(':'),
      lifecycleActivation: lifecycleControl ? lifecycleCommandPlan.activation : null,
      lifecycleAcknowledgement: lifecycleControl ? lifecycleCommandPlan.commandAcknowledgement : null,
      providerEnvelope: providerHandoff ? externalProviderHandoff.envelope : null,
      providerServiceOperation: providerHandoff ? providerServiceOperation : null,
      persistenceCommandTypes: localCommit || scheduled || lifecycleControl ? persistenceCommands.map((command) => command.commandType) : [],
      remediationCodes: blocked ? actionableErrors.map((error) => error.code) : []
    },
    presentation: {
      requested: clientRuntimeState.requestedPresentation,
      banner: blocked ? 'Memory write needs attention'
        : lifecycleControl ? lifecycleCommandPlan.activation.status === 'scheduled' ? 'Memory write lifecycle scheduled' : 'Memory write lifecycle ready'
          : scheduled ? 'Memory write scheduled'
            : providerHandoff ? 'Memory write ready for provider handoff'
              : localCommit ? 'Memory write ready to commit'
                : 'Memory write accepted',
      severity: blocked ? 'error' : scheduled || providerHandoff || lifecycleCommandPlan.activation?.status === 'scheduled' ? 'warning' : 'success',
      validationReady: validationSummary.ready,
      validationHeld: validationSummary.held,
      acceptanceState: previewAcceptance.acceptance.state
    }
  };
}

function buildClientDeliveryContract({ now, scope, write, commandId, decision, clientRuntimeState, clientWorkflowHandoff, validationSummary, nextStepContracts, actionableErrors }) {
  const advertised = clientRuntimeState.clientCapabilities;
  const requiredCapabilities = uniqueStrings([
    'memory.write.status-event',
    clientWorkflowHandoff.workflow.lifecycleControl ? 'memory.write.lifecycle-control' : '',
    clientWorkflowHandoff.workflow.localCommit ? 'memory.write.local-commit' : '',
    clientWorkflowHandoff.workflow.providerHandoff ? 'memory.write.provider-handoff' : '',
    clientWorkflowHandoff.workflow.scheduled ? 'memory.write.scheduled-resume' : '',
    clientWorkflowHandoff.clientMutation.optimisticUpdateEnabled ? 'memory.write.optimistic-ack' : '',
    clientWorkflowHandoff.clientMutation.rollbackRequired ? 'memory.write.optimistic-rollback' : '',
    clientWorkflowHandoff.returnRoute.href ? 'memory.write.route-href' : 'memory.write.route-name'
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !advertised.includes(capability));
  const fallbackMode = missingCapabilities.length
    ? clientWorkflowHandoff.workflow.blocked ? 'error-summary'
      : clientWorkflowHandoff.workflow.lifecycleControl ? 'settings-status-refresh'
      : clientWorkflowHandoff.workflow.scheduled ? 'poll-status'
        : clientWorkflowHandoff.workflow.providerHandoff ? 'server-dispatch'
          : 'refresh-memory-view'
    : 'native-client-workflow';
  const eventName = decision === 'accepted'
    ? clientWorkflowHandoff.workflow.lifecycleControl ? clientWorkflowHandoff.dispatch.lifecycleAcknowledgement?.clientEventName || 'memory.write.lifecycle.ready'
      : clientWorkflowHandoff.workflow.scheduled ? 'memory.write.scheduled'
        : clientWorkflowHandoff.workflow.providerHandoff ? 'memory.write.provider-handoff-ready'
          : clientWorkflowHandoff.workflow.localCommit ? 'memory.write.commit-ready'
            : 'memory.write.accepted'
    : 'memory.write.denied';
  const eventPayload = {
    eventType: 'kernel.memory.write.client-event.v1',
    eventName,
    commandId,
    stateKey: memoryStateKey(scope),
    correlationId: clientWorkflowHandoff.correlationId,
    workflowState: clientWorkflowHandoff.workflow.state,
    decision,
    target: clientWorkflowHandoff.target,
    route: clientWorkflowHandoff.returnRoute,
    dispatch: {
      kind: clientWorkflowHandoff.dispatch.kind,
      ready: clientWorkflowHandoff.dispatch.ready,
      resumeToken: clientWorkflowHandoff.dispatch.resumeToken,
      lifecycleActivationStatus: clientWorkflowHandoff.dispatch.lifecycleActivation?.status || null
    },
    mutation: {
      mutationId: clientWorkflowHandoff.clientMutation.mutationId,
      optimisticUpdateEnabled: clientWorkflowHandoff.clientMutation.optimisticUpdateEnabled,
      rollbackRequired: clientWorkflowHandoff.clientMutation.rollbackRequired,
      invalidateKeys: clientWorkflowHandoff.clientMutation.invalidateKeys
    },
    presentation: clientWorkflowHandoff.presentation
  };
  const acknowledgementRequired = decision === 'accepted'
    && (clientWorkflowHandoff.workflow.lifecycleControl
      || clientWorkflowHandoff.workflow.requiresUserConfirmation
      || clientWorkflowHandoff.workflow.providerHandoff
      || clientWorkflowHandoff.clientMutation.optimisticUpdateEnabled);
  return {
    contractType: 'kernel.memory.write.client-delivery-contract.v1',
    generatedAt: now,
    stateKey: memoryStateKey(scope),
    commandId,
    requestId: clientRuntimeState.requestId || null,
    workflowId: clientRuntimeState.workflowId || null,
    viewId: clientRuntimeState.viewId || null,
    requiredCapabilities,
    advertisedCapabilities: advertised,
    missingCapabilities,
    deliveryReady: missingCapabilities.length === 0 || fallbackMode !== 'native-client-workflow',
    fallbackMode,
    channel: {
      mode: missingCapabilities.length ? 'compatibility-fallback' : 'client-native',
      presentation: clientRuntimeState.requestedPresentation,
      returnRouteName: clientWorkflowHandoff.returnRoute.routeName,
      returnHref: clientWorkflowHandoff.returnRoute.href || null,
      replaceHistory: clientWorkflowHandoff.returnRoute.replaceHistory
    },
    event: eventPayload,
    acknowledgement: {
      required: acknowledgementRequired,
      ackType: acknowledgementRequired ? 'memory-write-client-ack' : 'not-required',
      ackToken: clientWorkflowHandoff.dispatch.lifecycleAcknowledgement?.schedulerToken
        || (acknowledgementRequired ? `${commandId}:${clientWorkflowHandoff.clientMutation.mutationId}:${clientWorkflowHandoff.workflow.state}` : null),
      dedupeKey: `${memoryStateKey(scope)}:${commandId}:${eventName}`,
      expectedAction: acknowledgementRequired ? clientWorkflowHandoff.workflow.primaryAction : 'observe-status-event'
    },
    remediation: decision === 'denied' ? actionableErrors.map((error) => ({
      code: error.code,
      action: error.action,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs
    })) : [],
    validation: {
      ready: validationSummary.ready,
      held: validationSummary.held,
      blocked: validationSummary.blocked,
      nextAction: nextStepContracts.readiness.nextAction,
      denialCodes: validationSummary.denialCodes
    },
    payloadPreview: {
      mode: write.mode,
      valueType: write.valueType,
      payloadBytes: payloadSizeBytes(write.value),
      payloadSizeClass: classifyPayloadSize(payloadSizeBytes(write.value))
    }
  };
}

function buildClientReviewPacket({ now, actor, scope, write, commandId, decision, previewAcceptance, validationSummary, nextStepContracts, clientWorkflowHandoff, clientDeliveryContract, providerServiceOperation, memoryMutationPlan, persistenceCommands, actionableErrors }) {
  const accepted = decision === 'accepted';
  const blocked = decision === 'denied';
  const routeParams = clientWorkflowHandoff.returnRoute.params;
  const primaryStep = nextStepContracts.primaryStep;
  const confirmRequired = previewAcceptance.acceptance.requiresUserConfirmation
    || clientDeliveryContract.acknowledgement.required;
  const acceptanceDisabledReasons = uniqueStrings([
    blocked ? 'validation-blocked' : '',
    validationSummary.held ? 'held-by-schedule-or-lifecycle' : '',
    accepted && !nextStepContracts.readiness.ready && !validationSummary.held ? 'not-ready-for-dispatch' : '',
    clientDeliveryContract.deliveryReady ? '' : 'client-delivery-not-ready',
    primaryStep && !primaryStep.ready && accepted ? 'primary-step-not-ready' : ''
  ]);
  const routeIntents = [
    {
      intentType: 'kernel.memory.write.route-intent.review.v1',
      id: 'preview',
      label: 'Preview',
      routeName: clientWorkflowHandoff.returnRoute.routeName,
      params: routeParams,
      selected: true,
      enabled: true
    },
    {
      intentType: 'kernel.memory.write.route-intent.accept.v1',
      id: 'accept',
      label: confirmRequired ? 'Confirm write' : 'Accept write',
      routeName: 'memory.write.accept',
      params: {
        ...routeParams,
        ackToken: clientDeliveryContract.acknowledgement.ackToken,
        resumeToken: clientWorkflowHandoff.dispatch.resumeToken
      },
      selected: false,
      enabled: accepted && acceptanceDisabledReasons.length === 0
    },
    {
      intentType: 'kernel.memory.write.route-intent.next-step.v1',
      id: 'next-step',
      label: primaryStep?.label || 'Next step',
      routeName: 'memory.write.next-step',
      params: {
        ...routeParams,
        stepType: primaryStep?.stepType || null,
        action: nextStepContracts.readiness.nextAction
      },
      selected: false,
      enabled: accepted && Boolean(primaryStep)
    }
  ];
  const remediationIntents = actionableErrors.map((error) => ({
    intentType: 'kernel.memory.write.route-intent.remediation.v1',
    id: error.code,
    label: error.action,
    routeName: 'memory.write.remediate',
    params: {
      ...routeParams,
      code: error.code,
      action: error.action,
      retryAfterMs: error.retryAfterMs
    },
    selected: false,
    enabled: blocked || error.retryable
  }));

  return {
    packetType: 'kernel.memory.write.client-review-packet.v1',
    generatedAt: now,
    surfaceId,
    stateKey: memoryStateKey(scope),
    commandId,
    actorId: actor.actorId,
    decision,
    reviewStatus: blocked ? 'blocked'
      : validationSummary.held ? 'held'
        : acceptanceDisabledReasons.length ? 'needs-review'
          : confirmRequired ? 'awaiting-confirmation'
            : 'ready',
    title: blocked ? 'Memory write blocked'
      : validationSummary.held ? 'Memory write held'
        : confirmRequired ? 'Review memory write'
          : 'Memory write ready',
    target: clientWorkflowHandoff.target,
    preview: previewAcceptance.preview,
    acceptanceControls: {
      enabled: accepted && acceptanceDisabledReasons.length === 0,
      confirmationRequired: confirmRequired,
      acknowledgementRequired: clientDeliveryContract.acknowledgement.required,
      acknowledgementType: clientDeliveryContract.acknowledgement.ackType,
      ackToken: clientDeliveryContract.acknowledgement.ackToken,
      resumeToken: clientWorkflowHandoff.dispatch.resumeToken,
      disabledReasons: acceptanceDisabledReasons,
      expectedAction: clientDeliveryContract.acknowledgement.expectedAction,
      optimisticMutationId: clientWorkflowHandoff.clientMutation.mutationId,
      rollbackRequired: clientWorkflowHandoff.clientMutation.rollbackRequired
    },
    readiness: {
      ready: nextStepContracts.readiness.ready,
      held: nextStepContracts.readiness.held,
      blocked: nextStepContracts.readiness.blocked,
      primaryAction: clientWorkflowHandoff.workflow.primaryAction,
      nextAction: nextStepContracts.readiness.nextAction,
      workflowState: clientWorkflowHandoff.workflow.state,
      dispatchKind: clientWorkflowHandoff.dispatch.kind,
      dispatchReady: clientWorkflowHandoff.dispatch.ready,
      deliveryFallbackMode: clientDeliveryContract.fallbackMode
    },
    validation: {
      summaryType: validationSummary.summaryType,
      checkCount: validationSummary.checkCount,
      passedCount: validationSummary.passedCount,
      denialCodes: validationSummary.denialCodes,
      checks: validationSummary.checks.map((check) => ({
        checkId: check.checkId,
        status: check.status,
        nextAction: check.nextAction || null
      }))
    },
    explainability: {
      proofType: 'kernel.memory.write.client-review-proof.v1',
      materializedMutation: memoryMutationPlan.valid,
      currentRevision: memoryMutationPlan.currentRevision,
      nextRevision: memoryMutationPlan.nextRevision,
      expiresAt: memoryMutationPlan.expiresAt,
      providerServiceState: providerServiceOperation.serviceState,
      providerOperationReady: providerServiceOperation.operationReady,
      persistenceCommandTypes: persistenceCommands.map((command) => command.commandType),
      primaryStepType: primaryStep?.stepType || null,
      primaryStepReady: primaryStep?.ready === true,
      clientEventName: clientDeliveryContract.event.eventName,
      clientDeliveryReady: clientDeliveryContract.deliveryReady
    },
    routeIntents: blocked ? [routeIntents[0], ...remediationIntents] : routeIntents,
    remediation: blocked ? actionableErrors.map((error) => ({
      code: error.code,
      message: error.message,
      action: error.action,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      terminal: error.terminal
    })) : [],
    presentation: {
      requested: clientWorkflowHandoff.presentation.requested,
      banner: clientWorkflowHandoff.presentation.banner,
      severity: clientWorkflowHandoff.presentation.severity,
      clientEventName: clientDeliveryContract.event.eventName,
      returnRoute: clientWorkflowHandoff.returnRoute
    }
  };
}

function buildAuditHandoff({ now, actor, scope, write, decision, errors, scopeBinding, writeSafetyGate, healthIncident, lifecycleControl, lifecycleCommandPlan, providerNegotiation, externalProviderHandoff, providerServiceOperation, clientWorkflowHandoff, clientDeliveryContract, memoryMutationPlan, persistedRecovery, persistedStateShape }) {
  return {
    auditType: 'kernel.memory.write',
    occurredAt: now,
    surfaceId,
    actorId: actor.actorId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey,
    decision,
    reason: write.reason || 'unspecified',
    writeMode: write.mode,
    expectedRevision: write.expectedRevision || null,
    nextRevision: memoryMutationPlan.nextRevision,
    delegationId: actor.delegationId || null,
    memoryMutationPlan: {
      planType: memoryMutationPlan.planType,
      operation: memoryMutationPlan.operation,
      valid: memoryMutationPlan.valid,
      currentRevision: memoryMutationPlan.currentRevision,
      nextRevision: memoryMutationPlan.nextRevision,
      expiresAt: memoryMutationPlan.expiresAt,
      previousPayloadShape: memoryMutationPlan.previousPayloadShape,
      incomingPayloadShape: memoryMutationPlan.incomingPayloadShape,
      nextPayloadShape: memoryMutationPlan.nextPayloadShape,
      mutationErrorCodes: memoryMutationPlan.mutationErrors.map((error) => error.code),
      nextAction: memoryMutationPlan.nextAction
    },
    persistedRecovery: {
      envelopeType: persistedRecovery.envelopeType,
      commandStatus: persistedRecovery.commandStatus,
      replayAction: persistedRecovery.idempotency.replayAction,
      duplicateApplied: persistedRecovery.idempotency.duplicateApplied,
      duplicateRejected: persistedRecovery.idempotency.duplicateRejected,
      pendingReplay: persistedRecovery.idempotency.pendingReplay,
      stalePrepared: persistedRecovery.stalePrepared.active,
      unresolvedCount: persistedRecovery.unresolved.count,
      lastFailureCode: persistedRecovery.failureDigest.lastFailureCode
    },
    persistedStateShape: {
      shapeType: persistedStateShape.shapeType,
      status: persistedStateShape.status,
      commandRecordStatus: persistedStateShape.commandRecord.status,
      commandRecordDedupeKey: persistedStateShape.indexes.commandRecordDedupeKey,
      commandJournalAppendRequired: persistedStateShape.indexes.commandJournalAppendRequired,
      pendingCommandIds: persistedStateShape.indexes.pendingCommandIds,
      appliedCommandIds: persistedStateShape.indexes.appliedCommandIds,
      providerExternalStatus: persistedStateShape.providerPatch?.externalStatus || null,
      recoveryNextAction: persistedStateShape.recoveryPolicy.nextAction
    },
    scopeBinding: {
      contractType: scopeBinding.contractType,
      writeBindingId: scopeBinding.writeBindingId,
      crossWorkspace: scopeBinding.crossWorkspace,
      workspaceWriteAuthorized: scopeBinding.workspaceWriteAuthorized,
      protectedNamespace: scopeBinding.protectedNamespace,
      protectedNamespaceAllowed: scopeBinding.protectedNamespaceAllowed
    },
    writeSafetyGate: {
      gateType: writeSafetyGate.gateType,
      safeToPrepare: writeSafetyGate.safeToPrepare,
      safeToCommit: writeSafetyGate.safeToCommit,
      pendingQueueSaturated: writeSafetyGate.pendingQueue.saturated,
      recoveredRevisionRequired: writeSafetyGate.recoveredState.requiresExpectedRevision,
      failureStateLocked: writeSafetyGate.failureState.locked,
      nextAction: writeSafetyGate.nextAction
    },
    healthIncident: {
      incidentType: healthIncident.incidentType,
      incidentId: healthIncident.incidentId,
      open: healthIncident.open,
      severity: healthIncident.severity,
      status: healthIncident.status,
      primaryFailureCode: healthIncident.primaryFailureCode,
      blockedSurfaces: healthIncident.blockedSurfaces,
      operatorActions: healthIncident.operatorActions,
      retryBudget: healthIncident.retryBudget
    },
    lifecycleControl: {
      controlType: lifecycleControl.controlType,
      enabled: lifecycleControl.enabled,
      lifecycleCommand: lifecycleControl.lifecycleCommand,
      configureAuthorized: lifecycleControl.configureAuthorized,
      lifecycleCommandEffective: lifecycleControl.lifecycleCommandEffective,
      lifecycleSettingsRevision: lifecycleControl.lifecycleSettingsRevision,
      modeAllowed: lifecycleControl.modeAllowed,
      drainModeSupported: lifecycleControl.drainModeSupported,
      scheduling: lifecycleControl.scheduling,
      nextAction: lifecycleControl.writeAdmission.nextAction,
      commandPlan: lifecycleCommandPlan.lifecycleCommand ? {
        commandType: lifecycleCommandPlan.commandType,
        accepted: lifecycleCommandPlan.accepted,
        activation: lifecycleCommandPlan.activation,
        acknowledgement: lifecycleCommandPlan.commandAcknowledgement,
        settingsPatch: lifecycleCommandPlan.settingsPatch,
        settingsTransition: lifecycleCommandPlan.settingsTransition,
        nextAction: lifecycleCommandPlan.nextAction
      } : null
    },
    providerContract: {
      negotiationType: providerNegotiation.negotiationType,
      providerId: providerNegotiation.provider.providerId,
      providerKind: providerNegotiation.provider.providerKind,
      executionMode: providerNegotiation.provider.executionMode,
      missingCapabilities: providerNegotiation.missingCapabilities,
      syncMetadata: providerNegotiation.syncMetadata,
      nextAction: providerNegotiation.nextAction
    },
    externalProviderHandoff: {
      handoffType: externalProviderHandoff.handoffType,
      status: externalProviderHandoff.status,
      ready: externalProviderHandoff.ready,
      queue: externalProviderHandoff.queue,
      serviceEndpoint: externalProviderHandoff.serviceEndpoint
    },
    providerServiceOperation: {
      contractType: providerServiceOperation.contractType,
      serviceOperationId: providerServiceOperation.serviceOperationId,
      serviceState: providerServiceOperation.serviceState,
      operationReady: providerServiceOperation.operationReady,
      deliveryType: providerServiceOperation.deliveryContract.deliveryType,
      ackRequired: providerServiceOperation.deliveryContract.ackRequired,
      externalStatus: providerServiceOperation.externalState.status,
      syncAccepted: providerServiceOperation.syncCommit.accepted,
      nextAction: providerServiceOperation.nextAction
    },
    clientWorkflowHandoff: {
      handoffType: clientWorkflowHandoff.handoffType,
      workflowState: clientWorkflowHandoff.workflow.state,
      primaryAction: clientWorkflowHandoff.workflow.primaryAction,
      dispatchKind: clientWorkflowHandoff.dispatch.kind,
      lifecycleActivationStatus: clientWorkflowHandoff.dispatch.lifecycleActivation?.status || null,
      returnRouteName: clientWorkflowHandoff.returnRoute.routeName,
      mutationId: clientWorkflowHandoff.clientMutation.mutationId
    },
    clientDeliveryContract: {
      contractType: clientDeliveryContract.contractType,
      eventName: clientDeliveryContract.event.eventName,
      fallbackMode: clientDeliveryContract.fallbackMode,
      missingCapabilities: clientDeliveryContract.missingCapabilities,
      acknowledgementRequired: clientDeliveryContract.acknowledgement.required,
      deliveryReady: clientDeliveryContract.deliveryReady
    },
    deniedCodes: errors.map((error) => error.code)
  };
}

function buildBoundaryProof({ actor, scope, write, decision, errors, scopeBinding, writeSafetyGate, healthIncident, lifecycleControl, lifecycleCommandPlan, providerNegotiation, providerServiceOperation, clientWorkflowHandoff, clientDeliveryContract, memoryMutationPlan, persistedRecovery, persistedStateShape }) {
  return {
    proofType: 'hosted-kernel-memory-write-boundary',
    decision,
    tenantBoundary: actor.tenantId && scope.tenantId && actor.tenantId === scope.tenantId ? 'same-tenant' : 'unverified',
    workspaceBoundary: actor.workspaceId === scope.workspaceId ? 'same-workspace' : scopeBinding.workspaceWriteAuthorized ? 'bound-delegated-workspace' : 'unverified',
    permissionBoundary: errors.some((error) => error.code === 'role_denied' || error.code === 'capability_denied' || error.code === 'protected_namespace_denied') ? 'denied' : 'satisfied',
    commitSafetyBoundary: writeSafetyGate.safeToCommit ? 'satisfied' : 'blocked',
    operationalHealthBoundary: healthIncident.status === 'healthy' ? 'satisfied'
      : healthIncident.status === 'degraded-observe' ? 'degraded-mode'
        : `blocked:${healthIncident.severity}`,
    lifecycleBoundary: lifecycleControl.writeAdmission.blocked
      ? lifecycleControl.scheduling.due ? 'blocked-by-settings' : 'scheduled-hold'
      : 'satisfied',
    providerBoundary: providerNegotiation.executionBlocked ? 'blocked'
      : providerNegotiation.externalHandoffRequired ? 'external-handoff'
        : 'hosted-kernel-inline',
    recoveryBoundary: persistedRecovery.stalePrepared.active ? 'journal-review-required'
      : persistedRecovery.idempotency.duplicateApplied ? 'idempotent-applied'
        : persistedRecovery.idempotency.duplicateRejected ? 'idempotent-rejected'
          : persistedRecovery.idempotency.pendingReplay ? 'pending-command-replay'
            : 'new-command',
    clientWorkflowBoundary: clientWorkflowHandoff.workflow.blocked ? 'client-remediation'
      : clientWorkflowHandoff.workflow.scheduled ? 'scheduled-client-resume'
        : clientWorkflowHandoff.workflow.providerHandoff ? 'provider-client-handoff'
          : clientWorkflowHandoff.workflow.localCommit ? 'local-client-commit'
            : 'client-status-refresh',
    clientDeliveryBoundary: clientDeliveryContract.missingCapabilities.length
      ? `fallback:${clientDeliveryContract.fallbackMode}`
      : 'native-client-workflow',
    scopeBinding,
    writeSafetyGate: {
      safeToPrepare: writeSafetyGate.safeToPrepare,
      safeToCommit: writeSafetyGate.safeToCommit,
      nextAction: writeSafetyGate.nextAction,
      gateErrorCodes: writeSafetyGate.gateErrors.map((error) => error.code)
    },
    healthIncident: {
      incidentId: healthIncident.incidentId,
      status: healthIncident.status,
      severity: healthIncident.severity,
      primaryFailureCode: healthIncident.primaryFailureCode,
      retryable: healthIncident.retryBudget.retryable,
      blockedSurfaces: healthIncident.blockedSurfaces,
      operatorActions: healthIncident.operatorActions
    },
    payloadContract: {
      valueType: write.valueType,
      mode: write.mode,
      ttlSeconds: write.ttlSeconds || null,
      materialized: memoryMutationPlan.valid,
      currentRevision: memoryMutationPlan.currentRevision,
      nextRevision: memoryMutationPlan.nextRevision,
      expiresAt: memoryMutationPlan.expiresAt,
      mutationErrorCodes: memoryMutationPlan.mutationErrors.map((error) => error.code)
    },
    lifecycleControl: {
      enabled: lifecycleControl.enabled,
      allowedModes: lifecycleControl.allowedModes,
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      commandEffective: lifecycleControl.lifecycleCommandEffective,
      drainModeSupported: lifecycleControl.drainModeSupported,
      settingsRevision: lifecycleControl.lifecycleSettingsRevision,
      transitionProof: lifecycleCommandPlan.settingsTransition?.proof || null,
      activationStatus: lifecycleCommandPlan.activation?.status || null,
      acknowledgement: lifecycleCommandPlan.commandAcknowledgement || null,
      nextLifecycleRevision: lifecycleCommandPlan.nextLifecycleRevision || null,
      nextAction: lifecycleControl.writeAdmission.nextAction
    },
    providerNegotiation: {
      providerId: providerNegotiation.provider.providerId,
      providerKind: providerNegotiation.provider.providerKind,
      executionMode: providerNegotiation.provider.executionMode,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      missingCapabilities: providerNegotiation.missingCapabilities,
      syncMetadata: providerNegotiation.syncMetadata,
      nextAction: providerNegotiation.nextAction
    },
    providerServiceOperation: {
      serviceOperationId: providerServiceOperation.serviceOperationId,
      serviceState: providerServiceOperation.serviceState,
      operationReady: providerServiceOperation.operationReady,
      deliveryContract: providerServiceOperation.deliveryContract,
      externalState: providerServiceOperation.externalState,
      proof: providerServiceOperation.proof,
      nextAction: providerServiceOperation.nextAction
    },
    persistedRecovery: {
      commandStatus: persistedRecovery.commandStatus,
      replayAction: persistedRecovery.idempotency.replayAction,
      unresolvedCommandIds: persistedRecovery.unresolved.commandIds,
      stalePrepared: persistedRecovery.stalePrepared,
      failureDigest: persistedRecovery.failureDigest
    },
    persistedStateShape: {
      status: persistedStateShape.status,
      commandRecord: persistedStateShape.commandRecord,
      indexes: persistedStateShape.indexes,
      memoryPatch: {
        previousRevision: persistedStateShape.memoryPatch.previousRevision,
        currentRevision: persistedStateShape.memoryPatch.currentRevision,
        nextRevision: persistedStateShape.memoryPatch.nextRevision,
        pendingCommandIds: persistedStateShape.memoryPatch.pendingCommandIds,
        appliedCommandIds: persistedStateShape.memoryPatch.appliedCommandIds
      },
      lifecyclePatch: persistedStateShape.lifecyclePatch,
      providerPatch: persistedStateShape.providerPatch,
      recoveryPolicy: persistedStateShape.recoveryPolicy
    },
    clientWorkflowHandoff: {
      workflowState: clientWorkflowHandoff.workflow.state,
      terminal: clientWorkflowHandoff.workflow.terminal,
      primaryAction: clientWorkflowHandoff.workflow.primaryAction,
      dispatchKind: clientWorkflowHandoff.dispatch.kind,
      lifecycleActivationStatus: clientWorkflowHandoff.dispatch.lifecycleActivation?.status || null,
      resumeToken: clientWorkflowHandoff.dispatch.resumeToken,
      returnRoute: clientWorkflowHandoff.returnRoute.routeName
    },
    clientDeliveryContract: {
      eventName: clientDeliveryContract.event.eventName,
      requiredCapabilities: clientDeliveryContract.requiredCapabilities,
      missingCapabilities: clientDeliveryContract.missingCapabilities,
      fallbackMode: clientDeliveryContract.fallbackMode,
      acknowledgementRequired: clientDeliveryContract.acknowledgement.required,
      dedupeKey: clientDeliveryContract.acknowledgement.dedupeKey
    },
    denialCodes: errors.map((error) => error.code)
  };
}

export function planMemoryWrite(input = {}) {
  const now = input.now || new Date().toISOString();
  const actor = normalizeActor(input);
  const scope = normalizeScope(input, actor);
  const write = normalizeWrite(input);
  const clientRuntimeState = normalizeClientRuntimeState(input, actor, scope);
  const persistedState = normalizePersistedState(input, scope);
  const analyticsHistory = normalizeAnalyticsHistory(input);
  const dependencyHealth = normalizeDependencyHealth(input);
  const lifecycleControl = normalizeMemoryWriteLifecycle(input, actor, write, now);
  const operationalHealth = buildOperationalHealth({ now, actor, scope, write, persistedState, dependencyHealth });
  const command = deriveCommandId({ input, actor, scope, write });
  const persistedCommandRecords = normalizePersistedCommandRecords(input, scope);
  const persistedRecovery = buildPersistedRecoveryEnvelope({
    now,
    scope,
    commandId: command.commandId,
    persistedState,
    commandRecords: persistedCommandRecords
  });
  const providerContract = normalizeProviderContract(input);
  const lifecycleCommandPlan = buildLifecycleCommandPlan({
    now,
    actor,
    scope,
    commandId: command.commandId,
    lifecycleControl
  });
  const writeSafetyGate = buildWriteSafetyGate({
    now,
    scope,
    write,
    commandId: command.commandId,
    persistedState,
    dependencyHealth,
    operationalHealth
  });
  const memoryMutationPlan = buildMemoryMutationPlan({
    now,
    scope,
    write,
    commandId: command.commandId,
    persistedState,
    lifecycleControl
  });
  const providerNegotiation = buildProviderNegotiation({
    now,
    scope,
    write,
    commandId: command.commandId,
    lifecycleControl,
    providerContract
  });
  const policy = {
    allowedRoles: uniqueStrings(input.allowedRoles).length ? uniqueStrings(input.allowedRoles) : DEFAULT_ALLOWED_ROLES,
    requiredCapability: asString(input.requiredCapability) || DEFAULT_REQUIRED_CAPABILITY,
    protectedNamespaces: uniqueStrings(input.protectedNamespaces).length ? uniqueStrings(input.protectedNamespaces) : DEFAULT_PROTECTED_NAMESPACES
  };
  const scopeBindings = normalizeScopeBindings(input, actor);
  const scopeBinding = resolveScopeBinding({ now, actor, scope, policy, scopeBindings });
  const errors = validateWrite({ actor, scope, write, policy, persistedState, scopeBinding, operationalHealth, writeSafetyGate, lifecycleControl, providerNegotiation, memoryMutationPlan });
  const decision = errors.length ? 'denied' : 'accepted';
  const actionableErrors = buildActionableErrors({ now, errors, operationalHealth });
  const healthIncident = buildOperationalHealthIncident({
    now,
    scope,
    commandId: command.commandId,
    dependencyHealth,
    operationalHealth,
    providerNegotiation,
    writeSafetyGate,
    actionableErrors
  });
  const restartSafeStatus = buildRestartSafeStatus({
    now,
    decision,
    persistedState,
    persistedRecovery,
    commandId: command.commandId,
    errors,
    lifecycleControl
  });
  const externalProviderHandoff = buildExternalProviderHandoff({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    decision,
    providerNegotiation,
    restartSafeStatus,
    memoryMutationPlan
  });
  const providerServiceOperation = buildProviderServiceOperationContract({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    decision,
    providerNegotiation,
    externalProviderHandoff,
    memoryMutationPlan,
    restartSafeStatus
  });
  const validationSummary = buildValidationSummary({
    now,
    decision,
    errors,
    actionableErrors,
    operationalHealth,
    healthIncident,
    writeSafetyGate,
    lifecycleControl,
    providerNegotiation,
    restartSafeStatus
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    decision,
    validationSummary,
    restartSafeStatus,
    providerNegotiation,
    externalProviderHandoff
  });
  const persistenceCommands = buildPersistenceCommands({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    commandSource: command.source,
    persistedState,
    persistedRecovery,
    restartSafeStatus,
    lifecycleControl,
    lifecycleCommandPlan,
    providerNegotiation,
    memoryMutationPlan
  });
  const persistedStateShape = buildPersistedStateShape({
    now,
    scope,
    commandId: command.commandId,
    persistedState,
    persistedRecovery,
    restartSafeStatus,
    persistenceCommands,
    memoryMutationPlan,
    lifecycleCommandPlan,
    providerNegotiation
  });
  const nextStepContracts = buildNextStepContracts({
    now,
    scope,
    commandId: command.commandId,
    decision,
    actionableErrors,
    validationSummary,
    restartSafeStatus,
    lifecycleCommandPlan,
    providerNegotiation,
    externalProviderHandoff,
    providerServiceOperation,
    persistenceCommands
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    decision,
    clientRuntimeState,
    previewAcceptance,
    validationSummary,
    nextStepContracts,
    restartSafeStatus,
    lifecycleCommandPlan,
    providerNegotiation,
    externalProviderHandoff,
    providerServiceOperation,
    persistenceCommands,
    actionableErrors
  });
  const clientDeliveryContract = buildClientDeliveryContract({
    now,
    scope,
    write,
    commandId: command.commandId,
    decision,
    clientRuntimeState,
    clientWorkflowHandoff,
    validationSummary,
    nextStepContracts,
    actionableErrors
  });
  const clientReviewPacket = buildClientReviewPacket({
    now,
    actor,
    scope,
    write,
    commandId: command.commandId,
    decision,
    previewAcceptance,
    validationSummary,
    nextStepContracts,
    clientWorkflowHandoff,
    clientDeliveryContract,
    providerServiceOperation,
    memoryMutationPlan,
    persistenceCommands,
    actionableErrors
  });
  const analyticsCounters = buildAnalyticsCounterSet({ actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation });
  const historySnapshot = buildHistorySnapshot({ now, actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation });
  const timelineEvent = buildTimelineEvent({ now, actor, scope, write, decision, errors });
  const exportSummary = buildExportSummary({ now, actor, scope, write, decision, errors, scopeBinding, lifecycleControl, providerNegotiation });
  const analyticsReporting = buildAnalyticsReportingBundle({
    now,
    scope,
    commandId: command.commandId,
    decision,
    analyticsHistory,
    analyticsCounters,
    historySnapshot,
    timelineEvent,
    exportSummary,
    validationSummary,
    providerNegotiation,
    clientWorkflowHandoff
  });
  const memoryWrite = decision === 'accepted' && !lifecycleControl.lifecycleCommandOnly && restartSafeStatus.safeToApply && providerNegotiation.localApplyAllowed && memoryMutationPlan.valid ? {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    namespace: scope.namespace,
    memoryKey: scope.memoryKey,
    commandId: command.commandId,
    mode: write.mode,
    value: memoryMutationPlan.nextValue,
    previousRevision: persistedState.currentRevision || null,
    nextRevision: memoryMutationPlan.nextRevision,
    expectedRevision: write.expectedRevision || null,
    ttlSeconds: write.ttlSeconds || null,
    expiresAt: memoryMutationPlan.expiresAt,
    payloadShape: memoryMutationPlan.nextPayloadShape,
    committedBy: actor.actorId
  } : null;

  return {
    ok: decision === 'accepted',
    decision,
    generatedAt: now,
    surfaceId,
    scope,
    actor: {
      actorId: actor.actorId,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      roles: actor.roles,
      capabilities: actor.capabilities
    },
    policy,
    scopeBinding,
    clientRuntimeState,
    analyticsHistory,
    memoryWrite,
    command: {
      commandType: 'kernel.memory.write.command.v1',
      commandId: command.commandId,
      source: command.source,
      idempotent: true,
      stateKey: persistedState.stateKey
    },
    persistedState,
    operationalHealth,
    healthIncident,
    lifecycleControl,
    lifecycleCommandPlan,
    providerContract,
    providerNegotiation,
    externalProviderHandoff,
    providerServiceOperation,
    writeSafetyGate,
    memoryMutationPlan,
    persistedCommandRecords,
    persistedRecovery,
    restartSafeStatus,
    persistenceCommands,
    persistedStateShape,
    previewAcceptance,
    validationSummary,
    nextStepContracts,
    clientWorkflowHandoff,
    clientDeliveryContract,
    clientReviewPacket,
    errors,
    actionableErrors,
    auditHandoff: buildAuditHandoff({ now, actor, scope, write, decision, errors, scopeBinding, writeSafetyGate, healthIncident, lifecycleControl, lifecycleCommandPlan, providerNegotiation, externalProviderHandoff, providerServiceOperation, clientWorkflowHandoff, clientDeliveryContract, memoryMutationPlan, persistedRecovery, persistedStateShape }),
    boundaryProof: buildBoundaryProof({ actor, scope, write, decision, errors, scopeBinding, writeSafetyGate, healthIncident, lifecycleControl, lifecycleCommandPlan, providerNegotiation, providerServiceOperation, clientWorkflowHandoff, clientDeliveryContract, memoryMutationPlan, persistedRecovery, persistedStateShape }),
    analyticsCounters,
    historySnapshot,
    timelineEvent,
    exportSummary,
    analyticsReporting,
    reportingState: {
      reportType: 'kernel.memory.write.reporting-state',
      surfaceId,
      generatedAt: now,
      exportReady: true,
      analyticsBundleType: analyticsReporting.bundleType,
      analyticsSnapshotSequence: analyticsReporting.history.snapshotSequence,
      analyticsRetainedSnapshotCount: analyticsReporting.history.retainedSnapshotCount,
      analyticsRetainedEventCount: analyticsReporting.timelineReport.retainedEventCount,
      analyticsAcceptanceRate: analyticsReporting.counters.rates.acceptanceRate,
      analyticsDenialRate: analyticsReporting.counters.rates.denialRate,
      analyticsProviderHandoffRate: analyticsReporting.counters.rates.providerHandoffRate,
      analyticsProtectedNamespaceRate: analyticsReporting.counters.rates.protectedNamespaceRate,
      analyticsExportPartition: analyticsReporting.exportManifest.partition,
      analyticsExportFileName: analyticsReporting.exportManifest.fileName,
      analyticsExportDedupeKey: analyticsReporting.exportManifest.dedupeKey,
      analyticsTimelineMilestones: analyticsReporting.timelineReport.milestones,
      accepted: decision === 'accepted',
      historyKey: historySnapshot.key,
      restartSafeStatus: restartSafeStatus.status,
      restartNextAction: restartSafeStatus.nextAction,
      restartIdempotencyOutcome: restartSafeStatus.idempotencyOutcome,
      restartRecoveryReviewRequired: restartSafeStatus.recoveryReviewRequired,
      persistedCommandStatus: restartSafeStatus.persistedCommandStatus,
      persistedRecoveryUnresolvedCount: persistedRecovery.unresolved.count,
      persistedRecoveryReplayAction: persistedRecovery.idempotency.replayAction,
      persistedRecoveryStalePrepared: persistedRecovery.stalePrepared.active,
      persistedStateShapeStatus: persistedStateShape.status,
      persistedStateRecordStatus: persistedStateShape.commandRecord.status,
      persistedStateDedupeKey: persistedStateShape.indexes.commandRecordDedupeKey,
      persistedStateAppendRequired: persistedStateShape.indexes.commandJournalAppendRequired,
      persistedStateRecoveryAction: persistedStateShape.recoveryPolicy.nextAction,
      persistedStatePendingAfter: persistedStateShape.indexes.pendingCommandIds,
      persistedStateAppliedAfter: persistedStateShape.indexes.appliedCommandIds,
      operationalHealth: operationalHealth.status,
      healthIncidentStatus: healthIncident.status,
      healthIncidentSeverity: healthIncident.severity,
      healthIncidentPrimaryFailureCode: healthIncident.primaryFailureCode,
      healthIncidentOpen: healthIncident.open,
      healthIncidentActions: healthIncident.operatorActions,
      healthIncidentBlockedSurfaces: healthIncident.blockedSurfaces,
      healthIncidentRetryWindowEndsAt: healthIncident.retryBudget.retryWindowEndsAt,
      lifecycleEnabled: lifecycleControl.enabled,
      lifecycleNextAction: lifecycleControl.writeAdmission.nextAction,
      lifecycleCommandAccepted: lifecycleCommandPlan.accepted === true,
      lifecycleCommandEffective: lifecycleControl.lifecycleCommandEffective,
      lifecycleActivationStatus: lifecycleCommandPlan.activation?.status || null,
      lifecycleSchedulerToken: lifecycleCommandPlan.commandAcknowledgement?.schedulerToken || null,
      lifecycleNotifyClients: lifecycleCommandPlan.commandAcknowledgement?.notifyClients === true,
      lifecycleDrainModeSupported: lifecycleControl.drainModeSupported,
      lifecycleSettingsRevision: lifecycleControl.lifecycleSettingsRevision,
      lifecycleNextRevision: lifecycleCommandPlan.nextLifecycleRevision || null,
      lifecycleCommandAckEvent: lifecycleCommandPlan.commandAcknowledgement?.clientEventName || null,
      lifecycleSettingsPatch: lifecycleCommandPlan.settingsPatch || null,
      lifecycleTransitionLabels: lifecycleCommandPlan.settingsTransition?.auditLabels || [],
      scheduledAt: lifecycleControl.scheduling.scheduledAt,
      scheduledHold: restartSafeStatus.status === 'scheduled-hold',
      providerId: providerNegotiation.provider.providerId,
      providerKind: providerNegotiation.provider.providerKind,
      providerExecutionMode: providerNegotiation.provider.executionMode,
      providerNextAction: providerNegotiation.nextAction,
      providerLocalApplyAllowed: providerNegotiation.localApplyAllowed,
      providerHandoffRequired: providerNegotiation.externalHandoffRequired,
      providerHandoffStatus: externalProviderHandoff.status,
      providerHandoffReady: externalProviderHandoff.ready,
      providerMissingCapabilities: providerNegotiation.missingCapabilities,
      providerSyncCursor: providerNegotiation.syncMetadata.cursor,
      providerSyncSequence: providerNegotiation.syncMetadata.sequence,
      providerServiceOperationId: providerServiceOperation.serviceOperationId,
      providerServiceState: providerServiceOperation.serviceState,
      providerServiceReady: providerServiceOperation.operationReady,
      providerServiceDeliveryType: providerServiceOperation.deliveryContract.deliveryType,
      providerServiceAckRequired: providerServiceOperation.deliveryContract.ackRequired,
      providerServiceAckToken: providerServiceOperation.deliveryContract.ackToken,
      providerServiceExternalStatus: providerServiceOperation.externalState.status,
      providerServiceSyncAccepted: providerServiceOperation.syncCommit.accepted,
      degradedMode: operationalHealth.degraded,
      writeSafetyGate: writeSafetyGate.safeToCommit ? 'pass' : 'blocked',
      gateNextAction: writeSafetyGate.nextAction,
      previewAcceptanceState: previewAcceptance.acceptance.state,
      previewCanAccept: previewAcceptance.acceptance.canAccept,
      previewRequiresConfirmation: previewAcceptance.acceptance.requiresUserConfirmation,
      validationReady: validationSummary.ready,
      validationBlocked: validationSummary.blocked,
      validationHeld: validationSummary.held,
      validationPassedCount: validationSummary.passedCount,
      validationCheckCount: validationSummary.checkCount,
      nextStepAction: nextStepContracts.readiness.nextAction,
      nextStepReady: nextStepContracts.readiness.ready,
      nextStepType: nextStepContracts.primaryStep?.stepType || null,
      clientWorkflowState: clientWorkflowHandoff.workflow.state,
      clientWorkflowAction: clientWorkflowHandoff.workflow.primaryAction,
      clientWorkflowDispatchKind: clientWorkflowHandoff.dispatch.kind,
      clientWorkflowReady: clientWorkflowHandoff.dispatch.ready,
      clientWorkflowReturnRoute: clientWorkflowHandoff.returnRoute.routeName,
      clientWorkflowMutationId: clientWorkflowHandoff.clientMutation.mutationId,
      clientWorkflowRollbackRequired: clientWorkflowHandoff.clientMutation.rollbackRequired,
      clientDeliveryEventName: clientDeliveryContract.event.eventName,
      clientDeliveryFallbackMode: clientDeliveryContract.fallbackMode,
      clientDeliveryReady: clientDeliveryContract.deliveryReady,
      clientDeliveryMissingCapabilities: clientDeliveryContract.missingCapabilities,
      clientDeliveryAckRequired: clientDeliveryContract.acknowledgement.required,
      clientDeliveryAckType: clientDeliveryContract.acknowledgement.ackType,
      clientDeliveryDedupeKey: clientDeliveryContract.acknowledgement.dedupeKey,
      clientReviewStatus: clientReviewPacket.reviewStatus,
      clientReviewTitle: clientReviewPacket.title,
      clientReviewAcceptanceEnabled: clientReviewPacket.acceptanceControls.enabled,
      clientReviewConfirmationRequired: clientReviewPacket.acceptanceControls.confirmationRequired,
      clientReviewDisabledReasons: clientReviewPacket.acceptanceControls.disabledReasons,
      clientReviewRouteIntentIds: clientReviewPacket.routeIntents.map((intent) => intent.id),
      clientReviewPrimaryRoute: clientReviewPacket.routeIntents.find((intent) => intent.enabled)?.routeName || clientWorkflowHandoff.returnRoute.routeName,
      clientReviewPrimaryAction: clientReviewPacket.readiness.primaryAction,
      clientReviewDispatchReady: clientReviewPacket.readiness.dispatchReady,
      clientReviewValidationChecks: clientReviewPacket.validation.checks,
      clientReviewProof: clientReviewPacket.explainability,
      pendingQueueSaturated: writeSafetyGate.pendingQueue.saturated,
      failureStateLocked: writeSafetyGate.failureState.locked,
      memoryMutationValid: memoryMutationPlan.valid,
      memoryMutationOperation: memoryMutationPlan.operation,
      memoryMutationNextRevision: memoryMutationPlan.nextRevision,
      memoryMutationExpiresAt: memoryMutationPlan.expiresAt,
      memoryMutationNextAction: memoryMutationPlan.nextAction,
      retryable: operationalHealth.retryPlan.retryable,
      retryAfterMs: operationalHealth.retryPlan.retryAfterMs,
      safeToApply: restartSafeStatus.safeToApply,
      commandId: command.commandId,
      scopeBindingId: scopeBinding.writeBindingId,
      crossWorkspace: scopeBinding.crossWorkspace,
      protectedNamespace: scopeBinding.protectedNamespace,
      timelineSeverity: timelineEvent.severity,
      counterDimensions: analyticsCounters.dimensions,
      exportColumns: exportSummary.columns
    }
  };
}

export function describeMemoryWriteSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const sample = planMemoryWrite({
    ...input,
    now,
    actor: input.actor || {
      actorId: 'surface-describer',
      tenantId: input.tenantId || 'tenant-preview',
      workspaceId: input.workspaceId || 'workspace-preview',
      roles: ['kernel'],
      capabilities: [DEFAULT_REQUIRED_CAPABILITY]
    },
    scope: input.scope || {
      tenantId: input.tenantId || 'tenant-preview',
      workspaceId: input.workspaceId || 'workspace-preview',
      namespace: DEFAULT_MEMORY_NAMESPACE,
      memoryKey: input.memoryKey || 'surface-preview'
    },
    write: input.write || {
      value: { preview: true },
      mode: 'replace',
      reason: 'surface-description'
    }
  });
  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      syscall: 'memory.write',
      accepts: ['actor', 'scope', 'write', 'commandId', 'persistedState', 'state.commandJournal', 'state.commands', 'state.pendingCommands', 'state.appliedCommands', 'operationalHealth', 'health', 'lifecycleSettings', 'settings', 'lifecycleCommand', 'scheduledAt', 'maxPendingCommands', 'allowedRoles', 'requiredCapability', 'protectedNamespaces', 'scopeBindings', 'workspaceBindings', 'providerContract', 'provider', 'serviceContract', 'integrationProvider', 'syncMetadata', 'requiredProviderCapabilities', 'clientRuntime', 'clientState', 'requestClient', 'requestId', 'workflowId', 'correlationId', 'analyticsHistory', 'memoryWriteAnalytics', 'reportingHistory'],
      emits: ['memoryWrite', 'command', 'persistedState', 'persistedCommandRecords', 'persistedRecovery', 'persistedStateShape', 'operationalHealth', 'healthIncident', 'lifecycleControl', 'lifecycleCommandPlan', 'providerContract', 'providerNegotiation', 'externalProviderHandoff', 'providerServiceOperation', 'writeSafetyGate', 'restartSafeStatus', 'persistenceCommands', 'previewAcceptance', 'validationSummary', 'nextStepContracts', 'clientRuntimeState', 'clientWorkflowHandoff', 'clientDeliveryContract', 'clientReviewPacket', 'auditHandoff', 'boundaryProof', 'analyticsHistory', 'analyticsCounters', 'historySnapshot', 'timelineEvent', 'exportSummary', 'analyticsReporting', 'reportingState', 'errors', 'actionableErrors'],
      defaultNamespace: DEFAULT_MEMORY_NAMESPACE
    },
    permissions: {
      allowedRoles: DEFAULT_ALLOWED_ROLES,
      requiredCapability: DEFAULT_REQUIRED_CAPABILITY,
      crossWorkspaceDelegation: 'memory:write:any-workspace plus matching scope binding',
      protectedNamespaceCapability: 'memory:write:protected-namespace'
    },
    boundaryBehavior: {
      tenantIsolation: 'actor tenant must match target tenant',
      workspaceScoping: 'actor workspace must match target workspace unless delegated by capability and matching scope binding',
      protectedNamespaces: 'protected namespaces require kernel role, protected namespace capability, or an explicit protected binding',
      safeFailure: 'denied plans emit audit/proof output and no memoryWrite payload',
      restartSafety: 'persisted command ids shape replay as already-applied, pending-retry, ready-to-commit, or revision-conflict',
      persistedRecovery: 'persisted command journals are normalized into typed recovery records so committed, rejected, pending, handoff-pending, and stale prepared commands produce idempotent no-op, resume, provider-confirmation, or journal-review commands after restart',
      persistedStateShape: 'accepted, denied, scheduled, provider-handoff, lifecycle, and replayed commands emit a typed durable state shape with command-record status, dedupe key, memory patch, lifecycle patch, provider patch, compacted pending/applied indexes, and recovery policy for restart-safe persistence',
      operationalHealth: 'unavailable persistence paths deny writes with retry/backoff guidance; degraded mode allows only bounded replace commits',
      healthIncidents: 'dependency, provider, queue, recovered-state, and failure-lock signals are converted into a typed incident with severity, retry budget, degraded-mode policy, blocked surfaces, operator actions, and client-facing remediation',
      lifecycleControls: 'settings can disable, pause, constrain modes, require reasons, cap TTLs, authorize lifecycle commands, and hold future scheduled writes without emitting an immediate memory payload',
      commitSafetyGate: 'recovered state requires revision guards, saturated pending queues block new commands, and non-retryable persistence failures lock writes until repair',
      providerContracts: 'provider metadata negotiates memory write capabilities, sync cursors, execution mode, and external handoff readiness before local apply or provider enqueue',
      providerServiceOperations: 'negotiated provider contracts are shaped into service-operation records with route metadata, sync-commit expectations, idempotent delivery keys, acknowledgement tokens, external command state, and proof flags for local or external provider execution',
      previewAcceptance: 'plans emit user-visible preview, acceptance state, validation readiness, and route-consumable next steps before clients commit or hand off writes',
      clientWorkflowHandoff: 'caller request and client runtime state are normalized into resume tokens, return routes, optimistic mutation handling, dispatch kind, and presentation state for UI workflow continuation',
      clientDeliveryContract: 'client capabilities are compared with required memory-write workflow features to emit native events, compatibility fallback mode, acknowledgement tokens, dedupe keys, and rollback/remediation payloads',
      clientReviewPacket: 'preview, validation checks, acceptance controls, acknowledgement tokens, route intents, remediation actions, and explainable proof fields are composed into one UI-ready review packet for route handlers and clients',
      analyticsReporting: 'prior analytics history is normalized into cumulative counters, bounded history snapshots, timeline milestones, export manifests, and reporting-state rates for hosted-kernel memory-write dashboards'
    },
    samplePlan: sample,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

describeMemoryWriteSurface.planMemoryWrite = planMemoryWrite;

export default describeMemoryWriteSurface;
