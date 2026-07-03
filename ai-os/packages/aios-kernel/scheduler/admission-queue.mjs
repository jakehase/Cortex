export const surfaceId = "aios_scheduler_admission-queue_051";
export const surfaceGroup = "scheduler";
export const surfaceName = "admission-queue";

const WRITE_ROLES = new Set(['owner', 'admin', 'scheduler', 'operator']);
const READ_ROLES = new Set([...WRITE_ROLES, 'viewer', 'auditor']);
const DEFAULT_QUEUE_LIMIT = 25;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const DEFAULT_HEALTH_TTL_MS = 60000;
const MAX_HEALTH_TTL_MS = 300000;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;
const DEFAULT_DEGRADED_PRIORITY_FLOOR = 60;
const DEFAULT_SAME_FAILURE_RETRY_LIMIT = 3;
const DEFAULT_DEPENDENCY_FAILURE_RETRY_LIMIT = 2;
const DEFAULT_DEPENDENCY_FAILURE_BACKOFF_MS = 5000;
const HEALTHY_STATES = new Set(['healthy', 'ready', 'ok']);
const DEGRADED_STATES = new Set(['degraded', 'draining', 'maintenance']);
const LIFECYCLE_COMMANDS = new Set(['admit', 'enable', 'disable', 'pause', 'resume', 'drain']);
const SCHEDULE_MODES = new Set(['immediate', 'manual', 'windowed', 'drain-only']);
const CONTROL_COMMANDS = new Set([
  'scheduler.admission_queue.lifecycle.enable',
  'scheduler.admission_queue.lifecycle.disable',
  'scheduler.admission_queue.lifecycle.pause',
  'scheduler.admission_queue.lifecycle.resume',
  'scheduler.admission_queue.lifecycle.drain',
  'scheduler.admission_queue.window.update',
  'scheduler.admission_queue.release',
  'scheduler.admission_queue.controls.release',
  'scheduler.admission_queue.priority_floor.update'
]);
const DEFAULT_HISTORY_LIMIT = 8;
const BACKLOG_STALE_MS = 5 * 60 * 1000;
const BACKLOG_CRITICAL_MS = 15 * 60 * 1000;
const WINDOW_STATES = new Set(['active', 'pending', 'expired', 'not-configured', 'invalid']);
const PROVIDER_CONTRACT_VERSION = 'aios.scheduler.provider.v1';
const DEFAULT_PROVIDER_SYNC_TTL_MS = 120000;
const MAX_PROVIDER_SYNC_TTL_MS = 600000;
const PROVIDER_READY_STATES = new Set(['active', 'ready', 'healthy']);
const PROVIDER_DEGRADED_STATES = new Set(['degraded', 'throttled']);
const CLIENT_RESPONSE_MODES = new Set(['sync', 'async', 'stream', 'fire-and-forget']);
const PROVIDER_HANDOFF_MODES = new Set(['in-process', 'external-dispatch', 'webhook', 'queue', 'event-bus']);
const DEFAULT_PROVIDER_QUEUE_LIMIT = 100;
const MAX_PROVIDER_QUEUE_LIMIT = 10000;
const MAX_PROVIDER_IN_FLIGHT = 10000;
const DEFAULT_PROVIDER_ACK_DEADLINE_MS = 15000;
const MAX_PROVIDER_ACK_DEADLINE_MS = 120000;
const DEFAULT_CLIENT_ACK_DEADLINE_MS = 30000;
const MAX_CLIENT_ACK_DEADLINE_MS = 300000;
const CLIENT_DELIVERY_CHANNELS = new Set(['inline-response', 'stream-event', 'callback', 'poll', 'audit-receipt', 'remediation']);
const MAX_DEPENDENCY_IDS = 50;
const DEPENDENCY_HANDOFF_SCHEMA = 'aios.scheduler.admission_queue.dependency_handoff.v1';
const PERSISTED_STATE_SCHEMA = 'aios.scheduler.admission_queue.persisted_state.v1';
const RECOVERED_COMMAND_STATES = new Set(['admitted', 'dispatchable', 'handed-off', 'awaiting-client-ack', 'completed']);
const TERMINAL_RECOVERED_STATES = new Set(['completed', 'cancelled', 'rejected']);
const PROVIDER_RECOVERY_STATES = new Set(['dispatchable', 'handed-off']);
const CLIENT_RECOVERY_STATES = new Set(['awaiting-client-ack']);
const ACK_RECOVERY_STATES = new Set(['handed-off', 'awaiting-client-ack']);
const MAX_RECOVERED_COMMANDS = 200;
const SCHEDULER_PERMISSION_PREFIX = 'scheduler:';
const ADMISSION_SCOPE_SCHEMA = 'aios.scheduler.admission_queue.admission_scope.v1';
const QUEUE_CAPACITY_SCHEMA = 'aios.scheduler.admission_queue.capacity.v1';
const QUEUE_ADMISSION_STATE_SCHEMA = 'aios.scheduler.admission_queue.admission_state.v1';
const LIFECYCLE_CONTROL_OPERATION_SCHEMA = 'aios.scheduler.admission_queue.lifecycle_control_operation.v1';
const DEFAULT_CONTROL_OPERATION_TTL_MS = 5 * 60 * 1000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeId(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeActor(actor = {}) {
  const roles = asArray(actor.roles)
    .filter(role => typeof role === 'string')
    .map(role => role.trim().toLowerCase())
    .filter(Boolean);

  return {
    id: normalizeId(actor.id, 'anonymous'),
    tenantId: normalizeId(actor.tenantId, null),
    workspaceId: normalizeId(actor.workspaceId, null),
    roles,
    permissions: new Set(asArray(actor.permissions)
      .filter(permission => typeof permission === 'string')
      .map(permission => permission.trim().toLowerCase())
      .filter(Boolean))
  };
}

function normalizeWorkspace(input = {}, actor) {
  return {
    tenantId: normalizeId(input.tenantId, actor.tenantId || 'default-tenant'),
    workspaceId: normalizeId(input.workspaceId, actor.workspaceId || 'default-workspace')
  };
}

function normalizeRetryAttempt(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_RETRY_ATTEMPTS) : 0;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function normalizeStringSet(value) {
  return new Set(asArray(value)
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim()));
}

function normalizeCodeSet(value) {
  return new Set(asArray(value)
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim().toLowerCase()));
}

function normalizeNonNegativeInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function normalizeQueueCapacity(input = {}, queueLimit, now) {
  const source = input.queueState && typeof input.queueState === 'object'
    ? input.queueState
    : input.admissionQueue && typeof input.admissionQueue === 'object'
      ? input.admissionQueue
      : input.queue && typeof input.queue === 'object'
        ? input.queue
        : {};
  const validation = { errors: [], warnings: [] };
  const queued = normalizeNonNegativeInteger(
    source.queued ?? source.currentDepth ?? source.depth ?? input.currentQueueDepth,
    0,
    queueLimit
  );
  const inFlight = normalizeNonNegativeInteger(
    source.inFlight ?? source.active ?? source.processing ?? input.inFlightAdmissions,
    0,
    queueLimit
  );
  const reserved = normalizeNonNegativeInteger(
    source.reserved ?? source.leased ?? source.pendingAcceptances ?? input.reservedAdmissions,
    0,
    queueLimit
  );
  const retryAfterMs = Number.isFinite(source.retryAfterMs ?? input.queueRetryAfterMs) && (source.retryAfterMs ?? input.queueRetryAfterMs) >= 0
    ? Math.min(Math.floor(source.retryAfterMs ?? input.queueRetryAfterMs), MAX_BACKOFF_MS)
    : null;
  const resetAt = normalizeId(source.resetAt || source.capacityResetAt || input.queueCapacityResetAt, null);
  const resetMs = timestampMs(resetAt);
  const nowMs = timestampMs(now);
  const resetInMs = resetMs !== null && nowMs !== null ? Math.max(0, resetMs - nowMs) : null;
  const occupied = queued + inFlight + reserved;
  const availableSlots = Math.max(0, queueLimit - occupied);
  const overLimit = occupied > queueLimit;
  const full = availableSlots === 0;

  if ((source.queued ?? source.currentDepth ?? source.depth ?? input.currentQueueDepth) !== undefined
    && !Number.isInteger(source.queued ?? source.currentDepth ?? source.depth ?? input.currentQueueDepth)) {
    validation.warnings.push('queue-depth-defaulted');
  }
  if ((source.inFlight ?? source.active ?? source.processing ?? input.inFlightAdmissions) !== undefined
    && !Number.isInteger(source.inFlight ?? source.active ?? source.processing ?? input.inFlightAdmissions)) {
    validation.warnings.push('queue-in-flight-defaulted');
  }
  if ((source.reserved ?? source.leased ?? source.pendingAcceptances ?? input.reservedAdmissions) !== undefined
    && !Number.isInteger(source.reserved ?? source.leased ?? source.pendingAcceptances ?? input.reservedAdmissions)) {
    validation.warnings.push('queue-reserved-defaulted');
  }
  if ((source.retryAfterMs ?? input.queueRetryAfterMs) !== undefined && retryAfterMs === null) {
    validation.warnings.push('queue-retry-after-ignored');
  }
  if (resetAt && resetMs === null) {
    validation.errors.push('queue-capacity-reset-at-invalid');
  }
  if (overLimit) {
    validation.warnings.push('queue-occupied-over-limit');
  }
  if (full) {
    validation.warnings.push('queue-capacity-full');
  }

  return {
    schema: QUEUE_CAPACITY_SCHEMA,
    limit: queueLimit,
    queued,
    inFlight,
    reserved,
    occupied,
    availableSlots,
    full,
    overLimit,
    acceptingNewWork: validation.errors.length === 0 && availableSlots > 0,
    retryAfterMs,
    resetAt,
    resetInMs,
    validation,
    proof: {
      boundedByEffectiveLimit: queued <= queueLimit && inFlight <= queueLimit && reserved <= queueLimit,
      availableSlotsDerived: availableSlots === Math.max(0, queueLimit - occupied),
      fullExplained: full === (availableSlots === 0)
    }
  };
}

function normalizeProviderCapacity(raw = {}, now) {
  const source = raw.capacity && typeof raw.capacity === 'object'
    ? raw.capacity
    : raw.backpressure && typeof raw.backpressure === 'object'
      ? raw.backpressure
      : {};
  const validation = { errors: [], warnings: [] };
  const queueDepth = normalizeNonNegativeInteger(
    source.queueDepth ?? source.queued ?? raw.queueDepth,
    0,
    MAX_PROVIDER_QUEUE_LIMIT
  );
  const queueLimit = normalizePositiveInteger(
    source.queueLimit ?? source.maxQueueDepth ?? raw.queueLimit,
    DEFAULT_PROVIDER_QUEUE_LIMIT,
    MAX_PROVIDER_QUEUE_LIMIT
  );
  const inFlight = normalizeNonNegativeInteger(
    source.inFlight ?? source.activeDispatches ?? raw.inFlight,
    0,
    MAX_PROVIDER_IN_FLIGHT
  );
  const maxInFlight = normalizePositiveInteger(
    source.maxInFlight ?? source.concurrentLimit ?? raw.maxInFlight,
    MAX_PROVIDER_IN_FLIGHT,
    MAX_PROVIDER_IN_FLIGHT
  );
  const retryAfterMs = Number.isFinite(source.retryAfterMs ?? raw.retryAfterMs) && (source.retryAfterMs ?? raw.retryAfterMs) >= 0
    ? Math.min(Math.floor(source.retryAfterMs ?? raw.retryAfterMs), MAX_BACKOFF_MS)
    : null;
  const resetAt = normalizeId(source.resetAt || source.capacityResetAt || raw.capacityResetAt, null);
  const resetMs = timestampMs(resetAt);
  const nowMs = timestampMs(now);
  const resetInMs = resetMs !== null && nowMs !== null ? Math.max(0, resetMs - nowMs) : null;
  const saturated = source.saturated === true
    || raw.saturated === true
    || queueDepth >= queueLimit
    || inFlight >= maxInFlight;
  const acceptingNewWork = source.acceptingNewWork === false || raw.acceptingNewWork === false
    ? false
    : !saturated;

  if ((source.queueDepth ?? source.queued ?? raw.queueDepth) !== undefined && !Number.isInteger(source.queueDepth ?? source.queued ?? raw.queueDepth)) {
    validation.warnings.push('provider-queue-depth-defaulted');
  }
  if ((source.queueLimit ?? source.maxQueueDepth ?? raw.queueLimit) !== undefined && queueLimit === DEFAULT_PROVIDER_QUEUE_LIMIT) {
    validation.warnings.push('provider-queue-limit-defaulted');
  }
  if ((source.inFlight ?? source.activeDispatches ?? raw.inFlight) !== undefined && !Number.isInteger(source.inFlight ?? source.activeDispatches ?? raw.inFlight)) {
    validation.warnings.push('provider-in-flight-defaulted');
  }
  if ((source.maxInFlight ?? source.concurrentLimit ?? raw.maxInFlight) !== undefined && maxInFlight === MAX_PROVIDER_IN_FLIGHT) {
    validation.warnings.push('provider-concurrency-limit-defaulted');
  }
  if ((source.retryAfterMs ?? raw.retryAfterMs) !== undefined && retryAfterMs === null) {
    validation.warnings.push('provider-retry-after-ignored');
  }
  if (resetAt && resetMs === null) {
    validation.errors.push('provider-capacity-reset-at-invalid');
  }
  if (queueDepth > queueLimit) {
    validation.warnings.push('provider-queue-depth-over-limit');
  }
  if (inFlight > maxInFlight) {
    validation.warnings.push('provider-in-flight-over-limit');
  }
  if (!acceptingNewWork) {
    validation.warnings.push('provider-capacity-saturated');
  }

  return {
    schema: 'aios.scheduler.admission_queue.provider_capacity.v1',
    acceptingNewWork,
    saturated,
    queueDepth,
    queueLimit,
    queueRemaining: Math.max(0, queueLimit - queueDepth),
    inFlight,
    maxInFlight,
    dispatchSlotsRemaining: Math.max(0, maxInFlight - inFlight),
    retryAfterMs,
    resetAt,
    resetInMs,
    validation
  };
}

function normalizeProviderContract(raw = {}, index, now, workspace, fallbackInternal = false) {
  const validation = { errors: [], warnings: [] };
  const state = typeof raw.state === 'string' && raw.state.trim()
    ? raw.state.trim().toLowerCase()
    : fallbackInternal
      ? 'active'
      : 'unknown';
  const tenantId = normalizeId(raw.tenantId, workspace.tenantId);
  const workspaceId = normalizeId(raw.workspaceId, workspace.workspaceId);
  const routes = normalizeStringSet(raw.routes || raw.routePatterns || (fallbackInternal ? ['*'] : []));
  const capabilities = normalizeStringSet(raw.capabilities || raw.capabilityIds || (fallbackInternal ? ['*'] : []));
  const responseModes = new Set([...normalizeStringSet(raw.responseModes || raw.clientResponseModes || (fallbackInternal ? [...CLIENT_RESPONSE_MODES] : ['async']))]
    .map(mode => mode.toLowerCase()));
  const serviceClass = normalizeId(raw.serviceClass || raw.service?.class || raw.serviceType, fallbackInternal ? 'hosted-kernel' : null);
  const serviceNamespace = normalizeId(raw.serviceNamespace || raw.service?.namespace || raw.namespace, 'scheduler');
  const serviceContractId = normalizeId(raw.serviceContractId || raw.contractId || raw.service?.contractId, `${serviceNamespace}:${serviceClass || 'provider'}:${index + 1}`);
  const supportedVersions = asArray(raw.supportedContractVersions || raw.contractVersions)
    .filter(version => typeof version === 'string' && version.trim())
    .map(version => version.trim());
  const advertisedVersions = supportedVersions.length ? supportedVersions : [PROVIDER_CONTRACT_VERSION];
  const acceptedContractVersion = advertisedVersions.includes(PROVIDER_CONTRACT_VERSION)
    ? PROVIDER_CONTRACT_VERSION
    : null;
  const syncInput = raw.sync && typeof raw.sync === 'object'
    ? raw.sync
    : raw.syncMetadata && typeof raw.syncMetadata === 'object'
      ? raw.syncMetadata
      : {};
  const lastSyncedAt = normalizeId(syncInput.lastSyncedAt || raw.lastSyncedAt || raw.syncedAt, null);
  const nowMs = timestampMs(now);
  const lastSyncedMs = timestampMs(lastSyncedAt);
  const syncTtlMs = normalizePositiveInteger(
    syncInput.ttlMs || raw.syncTtlMs,
    DEFAULT_PROVIDER_SYNC_TTL_MS,
    MAX_PROVIDER_SYNC_TTL_MS
  );
  const syncAgeMs = lastSyncedMs !== null && nowMs !== null ? Math.max(0, nowMs - lastSyncedMs) : null;
  const syncStale = syncAgeMs !== null && syncAgeMs > syncTtlMs;
  const externalHandoff = raw.externalHandoff === true || raw.handoff?.enabled === true;
  const handoffMode = externalHandoff ? normalizeId(raw.handoff?.mode || raw.handoffMode, 'external-dispatch') : 'in-process';
  const handoffAckRequired = raw.handoff?.ackRequired === true || raw.handoffAckRequired === true;
  const capacity = normalizeProviderCapacity(raw, now);

  if (tenantId !== workspace.tenantId || workspaceId !== workspace.workspaceId) {
    validation.errors.push('provider-scope-mismatch');
  }
  if (!acceptedContractVersion) {
    validation.errors.push('provider-contract-version-unsupported');
  }
  if (!routes.size) {
    validation.errors.push('provider-routes-required');
  }
  if (!capabilities.size) {
    validation.errors.push('provider-capabilities-required');
  }
  if (!responseModes.size) {
    validation.errors.push('provider-response-modes-required');
  }
  for (const mode of responseModes) {
    if (!CLIENT_RESPONSE_MODES.has(mode)) {
      validation.errors.push('provider-response-mode-invalid');
      break;
    }
  }
  if (!serviceClass) {
    validation.warnings.push('provider-service-class-missing');
  }
  if (!PROVIDER_READY_STATES.has(state) && !PROVIDER_DEGRADED_STATES.has(state)) {
    validation.warnings.push('provider-state-not-ready');
  }
  if (lastSyncedAt && lastSyncedMs === null) {
    validation.errors.push('provider-sync-timestamp-invalid');
  }
  if (syncStale) {
    validation.warnings.push('provider-sync-stale');
  }
  if (externalHandoff && !normalizeId(raw.handoff?.endpoint || raw.endpoint, null)) {
    validation.errors.push('provider-handoff-endpoint-required');
  }
  if (!PROVIDER_HANDOFF_MODES.has(handoffMode)) {
    validation.errors.push('provider-handoff-mode-invalid');
  }
  validation.errors.push(...capacity.validation.errors);
  validation.warnings.push(...capacity.validation.warnings);

  return {
    schema: 'aios.scheduler.admission_queue.provider_contract.v1',
    id: normalizeId(raw.id || raw.providerId, fallbackInternal ? 'hosted-kernel-internal' : `provider-${index + 1}`),
    tenantId,
    workspaceId,
    state,
    degraded: PROVIDER_DEGRADED_STATES.has(state),
    routes,
    capabilities,
    responseModes,
    service: {
      schema: 'aios.scheduler.admission_queue.provider_service.v1',
      contractId: serviceContractId,
      namespace: serviceNamespace,
      class: serviceClass,
      responseModes: [...responseModes].sort()
    },
    supportedContractVersions: advertisedVersions,
    acceptedContractVersion,
    externalHandoff,
    handoffMode,
    handoffEndpoint: externalHandoff ? normalizeId(raw.handoff?.endpoint || raw.endpoint, null) : null,
    handoffAckRequired,
    sync: {
      cursor: normalizeId(syncInput.cursor || raw.syncCursor, null),
      generation: Number.isInteger(syncInput.generation) && syncInput.generation >= 0 ? syncInput.generation : null,
      lastSyncedAt,
      ttlMs: syncTtlMs,
      ageMs: syncAgeMs,
      stale: syncStale
    },
    capacity,
    validation,
    available: validation.errors.length === 0 && PROVIDER_READY_STATES.has(state) && !syncStale && capacity.acceptingNewWork,
    canServeDegraded: validation.errors.length === 0 && PROVIDER_DEGRADED_STATES.has(state) && capacity.acceptingNewWork
  };
}

function providerMatchesRequest(provider, request) {
  const routeMatches = provider.routes.has('*') || provider.routes.has(request.route);
  const capabilityMatches = provider.capabilities.has('*') || provider.capabilities.has(request.capability);
  const providerRequested = !request.providerId || request.providerId === provider.id;
  return routeMatches && capabilityMatches && providerRequested;
}

function providerRequirementViolations(provider, request) {
  const requirements = request.providerRequirements;
  if (!requirements) {
    return [];
  }
  const violations = [];
  if (requirements.requiredResponseMode && !provider.responseModes.has(requirements.requiredResponseMode)) {
    violations.push('provider-response-mode-unavailable');
  }
  if (requirements.requiredServiceClass && provider.service.class !== requirements.requiredServiceClass) {
    violations.push('provider-service-class-unavailable');
  }
  if (requirements.requireExternalHandoff && !provider.externalHandoff) {
    violations.push('provider-external-handoff-required');
  }
  if (requirements.requiredHandoffMode && provider.handoffMode !== requirements.requiredHandoffMode) {
    violations.push('provider-handoff-mode-unavailable');
  }
  if (requirements.requireFreshSync && provider.sync.stale) {
    violations.push('provider-fresh-sync-required');
  }
  if (requirements.minSyncGeneration !== null && (provider.sync.generation === null || provider.sync.generation < requirements.minSyncGeneration)) {
    violations.push('provider-sync-generation-too-low');
  }
  if (provider.capacity.queueRemaining < requirements.minQueueRemaining) {
    violations.push('provider-queue-reservation-unavailable');
  }
  if (provider.capacity.dispatchSlotsRemaining < requirements.minDispatchSlots) {
    violations.push('provider-dispatch-slot-unavailable');
  }
  return violations;
}

function normalizeProviderContracts(input, now, workspace) {
  const rawProviders = asArray(input.providerContracts || input.providers || input.serviceProviders);
  const providers = rawProviders.length
    ? rawProviders.map((provider, index) => normalizeProviderContract(provider, index, now, workspace, false))
    : [normalizeProviderContract({}, 0, now, workspace, true)];
  const byId = new Map(providers.map(provider => [provider.id, provider]));

  return {
    schema: 'aios.scheduler.admission_queue.provider_registry.v1',
    requiredContractVersion: PROVIDER_CONTRACT_VERSION,
    declared: rawProviders.length > 0,
    providers,
    byId,
    validation: {
      errors: providers.flatMap(provider => provider.validation.errors.map(error => `${provider.id}:${error}`)),
      warnings: providers.flatMap(provider => provider.validation.warnings.map(warning => `${provider.id}:${warning}`))
    }
  };
}

function negotiateProvider(request, registry) {
  const matching = registry.providers.filter(provider => providerMatchesRequest(provider, request));
  const scored = matching.map(provider => ({
    provider,
    requirementViolations: providerRequirementViolations(provider, request)
  }));
  const eligible = scored.filter(item => item.requirementViolations.length === 0).map(item => item.provider);
  const available = eligible.find(provider => provider.available);
  const degraded = eligible.find(provider => provider.canServeDegraded);
  const capacityBlocked = eligible.find(provider => provider.validation.errors.length === 0 && !provider.capacity.acceptingNewWork);
  const selected = available || degraded || capacityBlocked || eligible[0] || matching[0] || null;
  const selectedRequirementViolations = scored.find(item => item.provider.id === selected?.id)?.requirementViolations || [];
  const validation = { errors: [], warnings: [] };

  if (request.providerId && !registry.byId.has(request.providerId)) {
    validation.errors.push('requested-provider-unknown');
  }
  if (!matching.length) {
    validation.errors.push('provider-capability-unavailable');
  } else if (!eligible.length) {
    validation.errors.push(...selectedRequirementViolations);
  } else if (!available && !degraded && capacityBlocked) {
    validation.errors.push('provider-backpressure');
  } else if (!available && !degraded) {
    validation.errors.push('provider-not-ready');
  } else if (!available && degraded) {
    validation.warnings.push('provider-degraded-selected');
  }
  if (selected?.sync.stale) {
    validation.warnings.push('provider-sync-stale');
  }

  return {
    schema: 'aios.scheduler.admission_queue.provider_negotiation.v1',
    requestId: request.id,
    requestedProviderId: request.providerId,
    selectedProviderId: selected?.id || null,
    contractVersion: selected?.acceptedContractVersion || null,
    externalHandoff: Boolean(selected?.externalHandoff),
    handoffMode: selected?.handoffMode || null,
    handoffEndpoint: selected?.handoffEndpoint || null,
    handoffAckRequired: Boolean(selected?.handoffAckRequired),
    service: selected?.service || null,
    syncCursor: selected?.sync.cursor || null,
    syncGeneration: selected?.sync.generation ?? null,
    degradedProvider: Boolean(selected?.degraded),
    providerCapacity: selected?.capacity || null,
    retryAfterMs: selected?.capacity?.retryAfterMs || null,
    requirementViolations: selectedRequirementViolations,
    validation,
    ready: validation.errors.length === 0
  };
}

function buildExternalHandoffState(request, decision, providerNegotiation, now) {
  if (decision.recovery?.idempotentReplay) {
    return {
      schema: 'aios.scheduler.admission_queue.external_handoff.v1',
      required: false,
      state: `recovered-${decision.recovery.state}`,
      providerId: providerNegotiation.selectedProviderId || decision.recovery.providerId || null,
      contractVersion: providerNegotiation.contractVersion,
      handoffMode: providerNegotiation.handoffMode,
      handoffEndpoint: providerNegotiation.handoffEndpoint,
      ackRequired: false,
      syncCursor: providerNegotiation.syncCursor,
      syncGeneration: providerNegotiation.syncGeneration,
      issuedAt: now,
      dispatchToken: decision.recovery.dispatchToken || `${request.tenantId}:${request.workspaceId}:${request.id}:recovered`
    };
  }
  if (decision.status !== 'admitted' || !providerNegotiation.ready) {
    return {
      required: false,
      state: decision.status === 'admitted' ? 'not-required' : 'blocked-before-handoff',
      providerId: providerNegotiation.selectedProviderId,
      reason: decision.reasons?.[0] || null
    };
  }
  return {
    schema: 'aios.scheduler.admission_queue.external_handoff.v1',
    required: providerNegotiation.externalHandoff,
    state: providerNegotiation.externalHandoff ? 'ready-to-handoff' : 'in-process-dispatch',
    providerId: providerNegotiation.selectedProviderId,
    contractVersion: providerNegotiation.contractVersion,
    handoffMode: providerNegotiation.handoffMode,
    handoffEndpoint: providerNegotiation.handoffEndpoint,
    ackRequired: providerNegotiation.handoffAckRequired,
    syncCursor: providerNegotiation.syncCursor,
    syncGeneration: providerNegotiation.syncGeneration,
    issuedAt: now,
    dispatchToken: `${request.tenantId}:${request.workspaceId}:${request.id}:${providerNegotiation.selectedProviderId || 'internal'}`
  };
}

function buildProviderDispatchContract(request, decision, providerNegotiation, externalHandoff, now) {
  const capacity = providerNegotiation.providerCapacity;
  const recoveredReplay = decision.recovery?.idempotentReplay === true;
  const admitted = decision.status === 'admitted' && (providerNegotiation.ready || recoveredReplay);
  return {
    schema: 'aios.scheduler.admission_queue.provider_dispatch_contract.v1',
    requestId: request.id,
    state: recoveredReplay ? `recovered-${decision.recovery.state}` : admitted ? 'dispatchable' : 'not-dispatchable',
    issuedAt: now,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    route: request.route,
    capability: request.capability,
    providerId: providerNegotiation.selectedProviderId || decision.recovery?.providerId || null,
    contractVersion: providerNegotiation.contractVersion,
    service: providerNegotiation.service,
    responseMode: request.clientRuntime.responseMode,
    externalHandoffRequired: Boolean(externalHandoff.required),
    handoffMode: externalHandoff.handoffMode || providerNegotiation.handoffMode,
    handoffEndpoint: externalHandoff.handoffEndpoint || providerNegotiation.handoffEndpoint,
    dispatchToken: admitted ? externalHandoff.dispatchToken : null,
    sync: {
      cursor: providerNegotiation.syncCursor,
      generation: providerNegotiation.syncGeneration,
      freshRequired: Boolean(request.providerRequirements?.requireFreshSync)
    },
    reservation: capacity
      ? {
          queueSlotReserved: admitted && capacity.queueRemaining > 0,
          dispatchSlotReserved: admitted && capacity.dispatchSlotsRemaining > 0,
          queueRemainingAfterReservation: admitted ? Math.max(0, capacity.queueRemaining - 1) : capacity.queueRemaining,
          dispatchSlotsAfterReservation: admitted ? Math.max(0, capacity.dispatchSlotsRemaining - 1) : capacity.dispatchSlotsRemaining
        }
      : null,
    requirementViolations: providerNegotiation.requirementViolations || [],
    recovery: recoveredReplay
      ? {
          idempotentReplay: true,
          state: decision.recovery.state,
          commandId: decision.recovery.commandId,
          idempotencyKey: decision.recovery.idempotencyKey
        }
      : null,
    proof: {
      providerReady: providerNegotiation.ready || recoveredReplay,
      versionAccepted: recoveredReplay || providerNegotiation.contractVersion === PROVIDER_CONTRACT_VERSION,
      responseModeNegotiated: recoveredReplay || Boolean(providerNegotiation.service?.responseModes?.includes(request.clientRuntime.responseMode)),
      capacityReserved: recoveredReplay || !capacity || (capacity.acceptingNewWork && capacity.queueRemaining > 0 && capacity.dispatchSlotsRemaining > 0),
      externalEndpointPresent: !externalHandoff.required || Boolean(externalHandoff.handoffEndpoint)
    }
  };
}

function buildProviderAcknowledgementContract(request, decision, providerNegotiation, externalHandoff, dispatchContract, now) {
  const recoveredReplay = decision.recovery?.idempotentReplay === true;
  const dispatchable = dispatchContract?.state === 'dispatchable' || recoveredReplay;
  const ackRequired = dispatchable && Boolean(
    externalHandoff.ackRequired
      || providerNegotiation.handoffAckRequired
      || request.clientRuntime.requestAck
      || request.clientRuntime.responseMode === 'sync'
  );
  const ackDeadlineMs = ackRequired
    ? Math.min(
        MAX_PROVIDER_ACK_DEADLINE_MS,
        Math.max(
          DEFAULT_PROVIDER_ACK_DEADLINE_MS,
          providerNegotiation.retryAfterMs || DEFAULT_PROVIDER_ACK_DEADLINE_MS
        )
      )
    : null;
  const receiptCommand = externalHandoff.required
    ? 'scheduler.provider_contract.handoff.ack'
    : 'scheduler.provider_contract.dispatch.ack';
  const validation = { errors: [], warnings: [] };

  if (ackRequired && !providerNegotiation.selectedProviderId && !decision.recovery?.providerId) {
    validation.errors.push('provider-ack-provider-required');
  }
  if (ackRequired && externalHandoff.required && !externalHandoff.handoffEndpoint) {
    validation.errors.push('provider-ack-endpoint-required');
  }
  if (ackRequired && !dispatchContract?.dispatchToken && !decision.recovery?.dispatchToken) {
    validation.errors.push('provider-ack-dispatch-token-required');
  }
  if (ackRequired && providerNegotiation.syncGeneration === null && !recoveredReplay) {
    validation.warnings.push('provider-ack-sync-generation-missing');
  }
  if (ackRequired && request.clientRuntime.responseMode === 'sync' && externalHandoff.required) {
    validation.warnings.push('provider-ack-sync-client-waits-on-external-handoff');
  }

  const state = !dispatchable
    ? 'not-applicable'
    : recoveredReplay
      ? `recovered-${decision.recovery.state}`
      : ackRequired
        ? 'awaiting-provider-ack'
        : 'ack-not-required';

  return {
    schema: 'aios.scheduler.admission_queue.provider_acknowledgement.v1',
    requestId: request.id,
    state,
    issuedAt: now,
    providerId: providerNegotiation.selectedProviderId || decision.recovery?.providerId || null,
    serviceContractId: dispatchContract?.service?.contractId || providerNegotiation.service?.contractId || null,
    contractVersion: providerNegotiation.contractVersion,
    responseMode: request.clientRuntime.responseMode,
    receiptCommand,
    ackRequired,
    ackDeadlineMs,
    receiptKey: ackRequired || recoveredReplay
      ? `${request.tenantId}:${request.workspaceId}:${request.id}:${providerNegotiation.selectedProviderId || decision.recovery?.providerId || 'provider'}:ack`
      : null,
    dispatchToken: dispatchContract?.dispatchToken || decision.recovery?.dispatchToken || null,
    correlationId: request.clientRuntime.correlationId || `${request.tenantId}:${request.workspaceId}:${request.id}`,
    handoff: {
      external: Boolean(externalHandoff.required),
      mode: externalHandoff.handoffMode || providerNegotiation.handoffMode,
      endpoint: externalHandoff.handoffEndpoint || providerNegotiation.handoffEndpoint,
      syncCursor: externalHandoff.syncCursor || providerNegotiation.syncCursor,
      syncGeneration: externalHandoff.syncGeneration ?? providerNegotiation.syncGeneration
    },
    validation,
    proof: {
      dispatchable,
      ackStateExplained: state !== 'awaiting-provider-ack' || ackRequired,
      providerIdentified: !ackRequired || Boolean(providerNegotiation.selectedProviderId || decision.recovery?.providerId),
      receiptCommandRoutable: receiptCommand.startsWith('scheduler.provider_contract.'),
      deadlineBounded: ackDeadlineMs === null || ackDeadlineMs <= MAX_PROVIDER_ACK_DEADLINE_MS,
      handoffEndpointPresent: !ackRequired || !externalHandoff.required || Boolean(externalHandoff.handoffEndpoint)
    }
  };
}

function normalizeClientRuntimeState(raw = {}, actor, workspace) {
  const source = raw.clientState && typeof raw.clientState === 'object'
    ? raw.clientState
    : raw.client && typeof raw.client === 'object'
      ? raw.client
      : {};
  const responseMode = normalizeId(source.responseMode || source.mode, 'async').toLowerCase();
  const validation = { errors: [], warnings: [] };
  const returnRoute = normalizeId(source.returnRoute || source.callbackRoute || source.redirectRoute, null);
  const callbackCommand = normalizeId(source.callbackCommand || source.command, null);
  const idempotencyKey = normalizeId(source.idempotencyKey || source.idempotency || raw.idempotencyKey, null);
  const correlationId = normalizeId(source.correlationId || raw.correlationId, null);
  const sessionId = normalizeId(source.sessionId || source.clientSessionId, null);
  const requestAck = source.requestAck === true || source.requiresAck === true || raw.requiresClientAck === true;

  if (!CLIENT_RESPONSE_MODES.has(responseMode)) {
    validation.errors.push('client-response-mode-invalid');
  }
  if (requestAck && !returnRoute && !callbackCommand) {
    validation.warnings.push('client-ack-route-missing');
  }
  if (responseMode === 'sync' && requestAck) {
    validation.warnings.push('client-sync-ack-redundant');
  }
  if ((responseMode === 'stream' || responseMode === 'async') && !correlationId) {
    validation.warnings.push('client-correlation-id-recommended');
  }

  return {
    schema: 'aios.scheduler.admission_queue.client_runtime.v1',
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    actorId: actor.id,
    clientId: normalizeId(source.clientId || raw.clientId, actor.id),
    sessionId,
    correlationId,
    idempotencyKey,
    responseMode,
    returnRoute,
    callbackCommand,
    requestAck,
    validation
  };
}

function mergeRequestClientRuntime(raw = {}, rootClient) {
  const source = raw.clientState && typeof raw.clientState === 'object'
    ? raw.clientState
    : raw.client && typeof raw.client === 'object'
      ? raw.client
      : {};
  const responseMode = normalizeId(source.responseMode || source.mode, rootClient.responseMode).toLowerCase();
  const requestAck = source.requestAck === true
    || source.requiresAck === true
    || raw.requiresClientAck === true
    || rootClient.requestAck;
  const client = {
    schema: rootClient.schema,
    tenantId: rootClient.tenantId,
    workspaceId: rootClient.workspaceId,
    actorId: rootClient.actorId,
    clientId: normalizeId(source.clientId || raw.clientId, rootClient.clientId),
    sessionId: normalizeId(source.sessionId || source.clientSessionId, rootClient.sessionId),
    correlationId: normalizeId(source.correlationId || raw.correlationId, rootClient.correlationId),
    idempotencyKey: normalizeId(source.idempotencyKey || source.idempotency || raw.idempotencyKey, rootClient.idempotencyKey),
    responseMode,
    returnRoute: normalizeId(source.returnRoute || source.callbackRoute || source.redirectRoute, rootClient.returnRoute),
    callbackCommand: normalizeId(source.callbackCommand || source.command, rootClient.callbackCommand),
    requestAck,
    validation: { errors: [...rootClient.validation.errors], warnings: [...rootClient.validation.warnings] }
  };

  if (!CLIENT_RESPONSE_MODES.has(responseMode) && !client.validation.errors.includes('client-response-mode-invalid')) {
    client.validation.errors.push('client-response-mode-invalid');
  }
  if (requestAck && !client.returnRoute && !client.callbackCommand && !client.validation.warnings.includes('client-ack-route-missing')) {
    client.validation.warnings.push('client-ack-route-missing');
  }
  if ((responseMode === 'stream' || responseMode === 'async') && !client.correlationId && !client.validation.warnings.includes('client-correlation-id-recommended')) {
    client.validation.warnings.push('client-correlation-id-recommended');
  }
  return client;
}

function buildDependencyWorkflowHandoff(request, decision, now) {
  const dependency = request.dependencyState || {};
  const client = request.clientRuntime || {};
  const operatorOverride = buildOperatorOverrideQueueMetadata(request.operatorOverride || {});
  const correlationId = client.correlationId || `${request.tenantId}:${request.workspaceId}:${request.id}`;
  const held = Boolean(dependency.held || decision.reasons?.includes('dependency-hold'));
  const failed = asArray(dependency.failedDependencyIds).length > 0 && !dependency.overrideReleased;
  const required = Boolean(dependency.required || asArray(dependency.dependencyIds).length > 0);
  const releaseReady = dependency.overrideReleased === true || (!held && !failed && required);
  const state = !required
    ? 'not-required'
    : dependency.overrideReleased
      ? 'released-by-operator-override'
      : failed
        ? 'blocked-by-failed-dependency'
        : held
          ? 'waiting-on-dependencies'
          : decision.status === 'admitted'
            ? 'dependencies-satisfied'
            : 'dependencies-satisfied-pending-admission';
  const command = !required
    ? 'scheduler.admission_queue.dependencies.confirm'
    : dependency.overrideReleased
      ? 'scheduler.admission_queue.dependencies.release'
      : failed
        ? 'scheduler.admission_queue.dependencies.inspect'
        : held
          ? 'scheduler.admission_queue.dependencies.wait'
          : 'scheduler.admission_queue.dependencies.resume';
  const clientChannel = client.responseMode === 'stream'
    ? 'stream-event'
    : client.returnRoute || client.callbackCommand
      ? 'callback'
      : client.responseMode === 'sync'
        ? 'inline-response'
        : 'poll';
  const clientRoute = clientChannel === 'callback'
    ? client.returnRoute || client.callbackCommand
    : clientChannel === 'stream-event'
      ? 'scheduler.admission_queue.client.workflow'
      : clientChannel === 'inline-response'
        ? 'scheduler.admission_queue.inline'
        : `${request.tenantId}:${request.workspaceId}:${request.id}:dependencies`;

  return {
    schema: DEPENDENCY_HANDOFF_SCHEMA,
    requestId: request.id,
    issuedAt: now,
    required,
    state,
    command,
    releaseReady,
    held,
    failed,
    dependencyIds: asArray(dependency.dependencyIds),
    satisfiedDependencyIds: asArray(dependency.satisfiedDependencyIds),
    unresolvedDependencyIds: asArray(dependency.unresolvedDependencyIds),
    failedDependencyIds: asArray(dependency.failedDependencyIds),
    waitOnCount: asArray(dependency.unresolvedDependencyIds).length,
    resumeToken: `${request.tenantId}:${request.workspaceId}:${request.id}:dependencies:${correlationId}`,
    correlationId,
    clientNotification: {
      channel: clientChannel,
      route: clientRoute,
      command: held || failed
        ? 'scheduler.admission_queue.client.dependency_update'
        : 'scheduler.admission_queue.client.resume',
      readyForClient: !held && !failed,
      messageCode: !required
        ? 'dependencies-not-required'
        : dependency.overrideReleased
          ? 'dependencies-released-by-operator'
          : failed
            ? 'dependencies-failed'
            : held
              ? 'dependencies-waiting'
              : 'dependencies-satisfied'
    },
    operatorOverride,
    operatorAction: held || failed
      ? {
          available: request.operatorOverride?.requested === true || request.operatorOverride?.active === true,
          active: request.operatorOverride?.active === true,
          command: 'scheduler.admission_queue.dependencies.release',
          settingsPatch: {
            operatorOverride: {
              enabled: true,
              bypassDependencies: true,
              reason: request.operatorOverride?.reason || 'dependency-release'
            }
          }
        }
      : null,
    proof: {
      dependenciesAccounted: !required || asArray(dependency.dependencyIds).length > 0,
      heldExplained: !held || asArray(dependency.unresolvedDependencyIds).length > 0,
      failedExplained: !failed || asArray(dependency.failedDependencyIds).length > 0,
      overrideReleaseExplained: !dependency.overrideReleased || operatorOverride.dependencyEffect === 'dependencies-released',
      clientRoutePresent: Boolean(clientRoute),
      commandRoutable: command.startsWith('scheduler.admission_queue.dependencies.')
    }
  };
}

function buildClientDeliveryServiceContract(request, decision, externalHandoff, providerAck, workflowState, dependencyHandoff, now) {
  const client = request.clientRuntime;
  const admitted = decision.status === 'admitted';
  const recoveredReplay = decision.recovery?.idempotentReplay === true;
  const callbackReady = Boolean(client.returnRoute || client.callbackCommand);
  const correlationId = client.correlationId || `${request.tenantId}:${request.workspaceId}:${request.id}`;
  const ackRequired = admitted && client.requestAck && !recoveredReplay;
  const providerGateRequired = admitted && providerAck?.ackRequired && providerAck.state === 'awaiting-provider-ack';
  const dependencyGateRequired = dependencyHandoff?.held === true || dependencyHandoff?.failed === true;
  const channel = !admitted
    ? dependencyGateRequired
      ? dependencyHandoff.clientNotification.channel
      : 'remediation'
    : client.responseMode === 'sync'
      ? 'inline-response'
      : client.responseMode === 'stream'
        ? 'stream-event'
        : ackRequired && !callbackReady
          ? 'poll'
          : client.responseMode === 'fire-and-forget'
            ? 'audit-receipt'
            : callbackReady
              ? 'callback'
              : 'poll';
  const route = channel === 'callback'
    ? client.returnRoute || client.callbackCommand
    : channel === 'stream-event'
      ? 'scheduler.admission_queue.client.workflow'
      : channel === 'inline-response'
        ? 'scheduler.admission_queue.inline'
        : channel === 'audit-receipt'
          ? 'scheduler.admission_queue.audit_receipt'
          : channel === 'poll'
            ? `${request.tenantId}:${request.workspaceId}:${request.id}:client-status`
            : 'scheduler.admission_queue.client.remediate';
  const validation = { errors: [], warnings: [] };

  if (!CLIENT_DELIVERY_CHANNELS.has(channel)) {
    validation.errors.push('client-delivery-channel-invalid');
  }
  if (channel === 'callback' && !route) {
    validation.errors.push('client-delivery-callback-route-required');
  }
  if (channel === 'stream-event' && !correlationId) {
    validation.errors.push('client-delivery-correlation-required');
  }
  if (ackRequired && channel === 'audit-receipt') {
    validation.warnings.push('client-delivery-audit-receipt-promoted');
  }
  if (providerGateRequired && channel === 'inline-response') {
    validation.warnings.push('client-delivery-inline-waits-on-provider-ack');
  }
  if (dependencyGateRequired && !dependencyHandoff.clientNotification.route) {
    validation.errors.push('client-delivery-dependency-route-required');
  }
  if (dependencyGateRequired && channel === 'inline-response') {
    validation.warnings.push('client-delivery-inline-waits-on-dependencies');
  }

  return {
    schema: 'aios.scheduler.admission_queue.client_delivery_service.v1',
    requestId: request.id,
    issuedAt: now,
    state: workflowState,
    channel,
    route: dependencyGateRequired ? dependencyHandoff.clientNotification.route : route,
    command: dependencyGateRequired
      ? dependencyHandoff.clientNotification.command
      : client.callbackCommand || (admitted ? 'scheduler.admission_queue.client.resume' : 'scheduler.admission_queue.client.remediate'),
    clientId: client.clientId,
    sessionId: client.sessionId,
    correlationId,
    responseMode: client.responseMode,
    ackRequired,
    providerGateRequired,
    dependencyGateRequired,
    providerReceiptKey: providerAck?.receiptKey || null,
    dependencyResumeToken: dependencyHandoff?.resumeToken || null,
    externalHandoffRequired: Boolean(externalHandoff.required),
    handoffState: externalHandoff.state || null,
    readyForClient: admitted && !providerGateRequired && !dependencyGateRequired,
    validation,
    proof: {
      knownChannel: CLIENT_DELIVERY_CHANNELS.has(channel),
      routePresent: Boolean(dependencyGateRequired ? dependencyHandoff.clientNotification.route : route),
      correlationStable: Boolean(correlationId),
      providerGateExplained: !providerGateRequired || Boolean(providerAck?.receiptKey),
      dependencyGateExplained: !dependencyGateRequired || Boolean(dependencyHandoff?.resumeToken),
      callbackRoutePresentWhenNeeded: channel !== 'callback' || Boolean(dependencyGateRequired ? dependencyHandoff.clientNotification.route : route)
    }
  };
}

function buildClientResumeContract(request, decision, externalHandoff, workflowState, dependencyHandoff, now) {
  const client = request.clientRuntime;
  const admitted = decision.status === 'admitted';
  const recoveredReplay = decision.recovery?.idempotentReplay === true;
  const providerAck = decision.providerAcknowledgement || null;
  const correlationId = client.correlationId || `${request.tenantId}:${request.workspaceId}:${request.id}`;
  const resumeToken = client.idempotencyKey || externalHandoff.dispatchToken || `${request.tenantId}:${request.workspaceId}:${request.id}:client`;
  const callbackCommand = client.callbackCommand || (admitted ? 'scheduler.admission_queue.client.resume' : 'scheduler.admission_queue.client.remediate');
  const ackRequired = admitted && client.requestAck && !recoveredReplay;
  const deliveryContract = buildClientDeliveryServiceContract(request, decision, externalHandoff, providerAck, workflowState, dependencyHandoff, now);
  const ackDeadlineMs = ackRequired
    ? Math.min(
        MAX_CLIENT_ACK_DEADLINE_MS,
        Math.max(
          DEFAULT_CLIENT_ACK_DEADLINE_MS,
          providerAck?.ackDeadlineMs || DEFAULT_CLIENT_ACK_DEADLINE_MS
        )
      )
    : null;
  const validation = {
    errors: [],
    warnings: [...client.validation.warnings]
  };

  if (admitted && client.responseMode === 'async' && deliveryContract.channel === 'poll') {
    validation.warnings.push('client-async-fell-back-to-poll');
  }
  if (admitted && client.responseMode === 'fire-and-forget' && ackRequired) {
    validation.warnings.push('client-fire-and-forget-ack-promoted-to-poll');
  }
  if (admitted && externalHandoff.required && providerAck?.ackRequired && !providerAck.receiptKey) {
    validation.errors.push('client-provider-ack-receipt-missing');
  }
  if ((dependencyHandoff?.held || dependencyHandoff?.failed) && !dependencyHandoff.resumeToken) {
    validation.errors.push('client-dependency-resume-token-missing');
  }
  validation.errors.push(...deliveryContract.validation.errors);
  validation.warnings.push(...deliveryContract.validation.warnings);

  return {
    schema: 'aios.scheduler.admission_queue.client_resume_contract.v1',
    requestId: request.id,
    issuedAt: now,
    state: workflowState,
    delivery: {
      channel: deliveryContract.channel,
      responseMode: client.responseMode,
      returnRoute: client.returnRoute,
      callbackCommand,
      streamEvent: client.responseMode === 'stream' ? 'scheduler.admission_queue.client.workflow' : null,
      pollKey: deliveryContract.channel === 'poll' ? deliveryContract.route : null,
      service: deliveryContract
    },
    resume: {
      token: resumeToken,
      command: callbackCommand,
      correlationId,
      idempotencyKey: client.idempotencyKey || resumeToken,
      dispatchToken: externalHandoff.dispatchToken || decision.dispatchContract?.dispatchToken || null,
      providerReceiptKey: providerAck?.receiptKey || null,
      providerAckState: providerAck?.state || null,
      providerAckDeadlineMs: providerAck?.ackDeadlineMs || null,
      clientAckRequired: ackRequired,
      clientAckDeadlineMs: ackDeadlineMs,
      readyForClient: deliveryContract.readyForClient,
      externalHandoffRequired: Boolean(externalHandoff.required)
    },
    dependency: dependencyHandoff
      ? {
          state: dependencyHandoff.state,
          command: dependencyHandoff.command,
          resumeToken: dependencyHandoff.resumeToken,
          unresolvedDependencyIds: dependencyHandoff.unresolvedDependencyIds,
          failedDependencyIds: dependencyHandoff.failedDependencyIds,
          operatorOverrideActive: dependencyHandoff.operatorOverride.active,
          clientNotification: dependencyHandoff.clientNotification
        }
      : null,
    userVisible: {
      status: admitted ? 'accepted' : 'blocked',
      messageCode: dependencyHandoff?.held
        ? 'blocked-dependencies-waiting'
        : dependencyHandoff?.failed
          ? 'blocked-dependencies-failed'
          : admitted
        ? externalHandoff.required
          ? 'accepted-provider-handoff-pending'
          : ackRequired
            ? 'accepted-client-ack-required'
            : 'accepted-dispatch-ready'
        : 'admission-blocked',
      nextCommand: dependencyHandoff?.held || dependencyHandoff?.failed
        ? dependencyHandoff.command
        : admitted ? callbackCommand : 'scheduler.admission_queue.client.remediate',
      waitOnProviderAck: Boolean(providerAck?.ackRequired && providerAck.state === 'awaiting-provider-ack'),
      waitOnDependencies: Boolean(dependencyHandoff?.held || dependencyHandoff?.failed),
      dependencyCommand: dependencyHandoff?.command || null
    },
    validation,
    proof: {
      responseModeMapped: CLIENT_RESPONSE_MODES.has(client.responseMode),
      correlationStable: Boolean(correlationId),
      resumeTokenStable: Boolean(resumeToken),
      admittedStateHasDispatchReference: !admitted || Boolean(externalHandoff.dispatchToken || decision.dispatchContract?.dispatchToken || recoveredReplay),
      ackDeadlineBounded: ackDeadlineMs === null || ackDeadlineMs <= MAX_CLIENT_ACK_DEADLINE_MS,
      deliveryServiceReady: deliveryContract.proof.knownChannel && deliveryContract.proof.routePresent,
      callbackCommandRoutable: !ackRequired || Boolean(callbackCommand),
      dependencyHandoffRoutable: !dependencyHandoff?.required || dependencyHandoff.proof.commandRoutable
    }
  };
}

function buildClientWorkflowHandoff(request, decision, externalHandoff, now) {
  const client = request.clientRuntime;
  const accepted = decision.status === 'admitted';
  const waitForExternal = accepted && externalHandoff.required;
  const recoveredReplay = decision.recovery?.idempotentReplay === true;
  const waitForAck = accepted && client.requestAck && !recoveredReplay;
  const dependencyHandoff = decision.dependencyHandoff || buildDependencyWorkflowHandoff(request, decision, now);
  const waitForDependencies = dependencyHandoff.held || dependencyHandoff.failed;
  const state = waitForDependencies
    ? dependencyHandoff.state
    : !accepted
      ? 'blocked-before-client-handoff'
    : recoveredReplay
      ? `recovered-${decision.recovery.state}`
      : waitForExternal
      ? 'awaiting-provider-dispatch'
      : waitForAck
        ? 'awaiting-client-ack'
        : 'client-notification-ready';

  const resumeContract = buildClientResumeContract(request, decision, externalHandoff, state, dependencyHandoff, now);

  return {
    schema: 'aios.scheduler.admission_queue.client_workflow_handoff.v1',
    requestId: request.id,
    state,
    issuedAt: now,
    responseMode: client.responseMode,
    clientId: client.clientId,
    sessionId: client.sessionId,
    correlationId: client.correlationId || `${request.tenantId}:${request.workspaceId}:${request.id}`,
    idempotencyKey: client.idempotencyKey || externalHandoff.dispatchToken || null,
    returnRoute: client.returnRoute,
    callbackCommand: client.callbackCommand || (accepted ? 'scheduler.admission_queue.client.resume' : 'scheduler.admission_queue.client.remediate'),
    requiresClientAck: waitForAck,
    dependencyHandoff,
    waitOnDependencies: waitForDependencies,
    externalHandoffRequired: Boolean(externalHandoff.required),
    providerId: externalHandoff.providerId || decision.providerNegotiation?.selectedProviderId || null,
    resumeContract,
    deliveryService: resumeContract.delivery.service,
    validation: {
      errors: [
        ...client.validation.errors,
        ...resumeContract.validation.errors
      ],
      warnings: [
        ...client.validation.warnings,
        ...resumeContract.validation.warnings.filter(warning => !client.validation.warnings.includes(warning))
      ]
    }
  };
}

function normalizeKernelHealth(input = {}, now) {
  const rawStatus = typeof input.status === 'string' ? input.status.trim().toLowerCase() : 'healthy';
  const status = rawStatus || 'healthy';
  const failureCode = normalizeId(input.failureCode || input.errorCode, null);
  const validation = { errors: [], warnings: [] };
  const retryAfterMs = Number.isFinite(input.retryAfterMs) && input.retryAfterMs >= 0
    ? Math.min(Math.floor(input.retryAfterMs), MAX_BACKOFF_MS)
    : null;
  if (input.retryAfterMs !== undefined && retryAfterMs === null) {
    validation.warnings.push('health-retry-after-ignored');
  }
  const saturatedRoutes = new Set(asArray(input.saturatedRoutes)
    .filter(route => typeof route === 'string' && route.trim())
    .map(route => route.trim()));
  const blockedCapabilities = new Set(asArray(input.blockedCapabilities)
    .filter(capability => typeof capability === 'string' && capability.trim())
    .map(capability => capability.trim()));
  const observedAt = normalizeId(input.observedAt || input.checkedAt || input.heartbeatAt, null);
  const observedMs = timestampMs(observedAt);
  const nowMs = timestampMs(now);
  const heartbeatTtlMs = normalizePositiveInteger(input.heartbeatTtlMs, DEFAULT_HEALTH_TTL_MS, MAX_HEALTH_TTL_MS);
  const signalAgeMs = observedMs !== null && nowMs !== null ? Math.max(0, nowMs - observedMs) : null;
  if (observedAt && observedMs === null) {
    validation.errors.push('health-observed-at-invalid');
  }
  const stale = signalAgeMs !== null && signalAgeMs > heartbeatTtlMs;
  if (stale) {
    validation.warnings.push('health-signal-stale');
  }
  if (input.heartbeatTtlMs !== undefined && heartbeatTtlMs === DEFAULT_HEALTH_TTL_MS && input.heartbeatTtlMs !== DEFAULT_HEALTH_TTL_MS) {
    validation.warnings.push('health-ttl-defaulted');
  }
  const consecutiveFailures = Number.isInteger(input.consecutiveFailures) && input.consecutiveFailures > 0
    ? Math.min(input.consecutiveFailures, 100)
    : 0;
  const failureBudgetRemaining = Number.isInteger(input.failureBudgetRemaining) && input.failureBudgetRemaining >= 0
    ? Math.min(input.failureBudgetRemaining, 1000)
    : null;
  const breakerThreshold = normalizePositiveInteger(
    input.circuitBreakerThreshold,
    DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
    50
  );
  const circuitOpen = input.circuitOpen === true
    || failureBudgetRemaining === 0
    || consecutiveFailures >= breakerThreshold
    || validation.errors.length > 0;
  const degradedPriorityFloor = Number.isFinite(input.degradedPriorityFloor)
    ? Math.max(0, Math.min(100, Math.floor(input.degradedPriorityFloor)))
    : DEFAULT_DEGRADED_PRIORITY_FLOOR;
  const sameFailureRetryLimit = normalizePositiveInteger(
    input.sameFailureRetryLimit || input.repeatFailureRetryLimit,
    DEFAULT_SAME_FAILURE_RETRY_LIMIT,
    MAX_RETRY_ATTEMPTS
  );
  const nonRetryableFailureCodes = normalizeCodeSet(input.nonRetryableFailureCodes || input.terminalFailureCodes);
  const retryableFailureCodes = normalizeCodeSet(input.retryableFailureCodes);
  const failureCodeNormalized = failureCode ? failureCode.toLowerCase() : null;
  const terminalFailure = Boolean(failureCodeNormalized && nonRetryableFailureCodes.has(failureCodeNormalized));
  if (input.degradedPriorityFloor !== undefined && !Number.isFinite(input.degradedPriorityFloor)) {
    validation.warnings.push('degraded-priority-floor-defaulted');
  }
  if ((input.sameFailureRetryLimit || input.repeatFailureRetryLimit) !== undefined && sameFailureRetryLimit === DEFAULT_SAME_FAILURE_RETRY_LIMIT) {
    validation.warnings.push('same-failure-retry-limit-defaulted');
  }
  if (terminalFailure) {
    validation.warnings.push('health-terminal-failure-code');
  }
  if (circuitOpen) {
    validation.warnings.push('health-circuit-open');
  }

  return {
    schema: 'aios.scheduler.admission_queue.kernel_health.v1',
    status,
    isReady: HEALTHY_STATES.has(status),
    isDegraded: DEGRADED_STATES.has(status),
    failureCode,
    failureCodeNormalized,
    retryAfterMs,
    observedAt,
    heartbeatTtlMs,
    signalAgeMs,
    stale,
    consecutiveFailures,
    failureBudgetRemaining,
    breakerThreshold,
    circuitOpen,
    degradedPriorityFloor,
    sameFailureRetryLimit,
    nonRetryableFailureCodes,
    retryableFailureCodes,
    terminalFailure,
    saturatedRoutes,
    blockedCapabilities,
    validation
  };
}

function sameHealthFailureExceeded(request, health) {
  if (!health.failureCodeNormalized || !request.lastFailureCode) {
    return false;
  }
  return request.lastFailureCode.toLowerCase() === health.failureCodeNormalized
    && request.retryAttempt >= health.sameFailureRetryLimit;
}

function buildHealthRetryGuard(request, health) {
  const sameFailure = Boolean(
    health.failureCodeNormalized
      && request.lastFailureCode
      && request.lastFailureCode.toLowerCase() === health.failureCodeNormalized
  );
  const terminal = Boolean(health.terminalFailure || sameHealthFailureExceeded(request, health));
  const retryableOverride = health.retryableFailureCodes.has(request.lastFailureCode?.toLowerCase?.() || '')
    || health.retryableFailureCodes.has(health.failureCodeNormalized || '');

  return {
    schema: 'aios.scheduler.admission_queue.health_retry_guard.v1',
    requestId: request.id,
    lastFailureCode: request.lastFailureCode,
    activeFailureCode: health.failureCode,
    sameFailure,
    retryAttempt: request.retryAttempt,
    sameFailureRetryLimit: health.sameFailureRetryLimit,
    terminal,
    terminalReason: terminal
      ? health.terminalFailure
        ? 'terminal-health-failure-code'
        : 'same-health-failure-retry-limit'
      : null,
    retryableOverride,
    remainingAttemptsForSameFailure: sameFailure
      ? Math.max(0, health.sameFailureRetryLimit - request.retryAttempt)
      : health.sameFailureRetryLimit,
    actionRequired: terminal && !retryableOverride
      ? 'inspect-hosted-kernel-failure-before-retry'
      : 'retry-allowed-with-backoff'
  };
}

function normalizeScheduleWindow(raw = {}, scheduleMode, now) {
  const windowInput = raw.scheduleWindow && typeof raw.scheduleWindow === 'object'
    ? raw.scheduleWindow
    : raw.window && typeof raw.window === 'object'
      ? raw.window
      : {};
  const validation = { errors: [], warnings: [] };
  const nowMs = timestampMs(now);
  const opensAt = normalizeId(windowInput.opensAt || raw.windowOpensAt || raw.opensAt, null);
  const closesAt = normalizeId(windowInput.closesAt || raw.windowClosesAt || raw.closesAt, null);
  const opensMs = timestampMs(opensAt);
  const closesMs = timestampMs(closesAt);
  const requiresWindow = scheduleMode === 'windowed';

  if (opensAt && opensMs === null) {
    validation.errors.push('schedule-window-opens-at-invalid');
  }
  if (closesAt && closesMs === null) {
    validation.errors.push('schedule-window-closes-at-invalid');
  }
  if (requiresWindow && !opensAt) {
    validation.errors.push('schedule-window-opens-at-required');
  }
  if (requiresWindow && !closesAt) {
    validation.errors.push('schedule-window-closes-at-required');
  }
  if (opensMs !== null && closesMs !== null && opensMs >= closesMs) {
    validation.errors.push('schedule-window-range-invalid');
  }

  let state = 'not-configured';
  if (validation.errors.length) {
    state = 'invalid';
  } else if (opensMs !== null && closesMs !== null && nowMs !== null) {
    if (nowMs < opensMs) {
      state = 'pending';
    } else if (nowMs > closesMs) {
      state = 'expired';
    } else {
      state = 'active';
    }
  } else if (opensMs !== null || closesMs !== null) {
    validation.warnings.push('schedule-window-partial');
  }
  if (scheduleMode !== 'windowed' && (opensAt || closesAt)) {
    validation.warnings.push('schedule-window-ignored-for-mode');
  }
  if (nowMs === null && requiresWindow) {
    validation.warnings.push('schedule-window-now-unparseable');
  }

  return {
    schema: 'aios.scheduler.admission_queue.schedule_window.v1',
    id: normalizeId(windowInput.id || raw.windowId, null),
    mode: scheduleMode,
    opensAt,
    closesAt,
    state: WINDOW_STATES.has(state) ? state : 'invalid',
    active: scheduleMode !== 'windowed' || state === 'active',
    nextActivationAt: state === 'pending' ? opensAt : null,
    closedAt: state === 'expired' ? closesAt : null,
    validation
  };
}

function normalizeLifecycleControlIntent(raw = {}, command, scheduleMode, scheduleWindow, actor, now) {
  const source = raw.controlIntent && typeof raw.controlIntent === 'object'
    ? raw.controlIntent
    : raw.control && typeof raw.control === 'object'
      ? raw.control
      : {};
  const requestedCommand = normalizeId(
    source.command || source.controlCommand || raw.controlCommand || raw.requestedControlCommand,
    null
  );
  const normalizedCommand = requestedCommand ? requestedCommand.trim().toLowerCase() : null;
  const validation = { errors: [], warnings: [] };
  const requestedBy = normalizeId(source.requestedBy || source.actorId, actor?.id || 'system');
  const reason = normalizeId(source.reason || raw.reason || raw.pauseReason || raw.disableReason, null);
  const releaseRequestIds = new Set(asArray(source.releaseRequestIds || source.requestIds || raw.releaseRequestIds)
    .filter(id => typeof id === 'string' && id.trim())
    .map(id => id.trim()));
  const routeHolds = new Set(asArray(source.disabledRoutes || source.routeHolds || source.routes)
    .filter(route => typeof route === 'string' && route.trim())
    .map(route => route.trim()));
  const capabilityHolds = new Set(asArray(source.disabledCapabilities || source.capabilityHolds || source.capabilities)
    .filter(capability => typeof capability === 'string' && capability.trim())
    .map(capability => capability.trim()));
  const priorityFloor = Number.isFinite(source.lowPriorityFloor ?? source.priorityFloor)
    ? Math.max(0, Math.min(100, Math.floor(source.lowPriorityFloor ?? source.priorityFloor)))
    : null;
  const windowPatchInput = source.scheduleWindow && typeof source.scheduleWindow === 'object'
    ? source.scheduleWindow
    : source.window && typeof source.window === 'object'
      ? source.window
      : {};
  const windowPatch = {
    opensAt: normalizeId(windowPatchInput.opensAt || source.opensAt || raw.windowOpensAt || raw.opensAt, scheduleWindow.opensAt),
    closesAt: normalizeId(windowPatchInput.closesAt || source.closesAt || raw.windowClosesAt || raw.closesAt, scheduleWindow.closesAt)
  };
  const settingsPatch = {};

  if (normalizedCommand && !CONTROL_COMMANDS.has(normalizedCommand)) {
    validation.errors.push('lifecycle-control-command-invalid');
  }
  if (normalizedCommand?.startsWith('scheduler.admission_queue.lifecycle.') && reason === null) {
    validation.warnings.push('lifecycle-control-reason-recommended');
  }
  if (normalizedCommand === 'scheduler.admission_queue.lifecycle.enable') {
    settingsPatch.enabled = true;
    settingsPatch.command = 'enable';
    settingsPatch.scheduleMode = scheduleMode === 'drain-only' ? 'immediate' : scheduleMode;
  } else if (normalizedCommand === 'scheduler.admission_queue.lifecycle.disable') {
    settingsPatch.enabled = false;
    settingsPatch.command = 'disable';
    settingsPatch.reason = reason;
  } else if (normalizedCommand === 'scheduler.admission_queue.lifecycle.pause') {
    settingsPatch.command = 'pause';
    settingsPatch.reason = reason;
  } else if (normalizedCommand === 'scheduler.admission_queue.lifecycle.resume') {
    settingsPatch.enabled = true;
    settingsPatch.command = 'resume';
    settingsPatch.scheduleMode = scheduleMode === 'drain-only' ? 'immediate' : scheduleMode;
  } else if (normalizedCommand === 'scheduler.admission_queue.lifecycle.drain') {
    settingsPatch.command = 'drain';
    settingsPatch.scheduleMode = 'drain-only';
    settingsPatch.reason = reason;
  } else if (normalizedCommand === 'scheduler.admission_queue.window.update') {
    settingsPatch.scheduleMode = 'windowed';
    settingsPatch.scheduleWindow = windowPatch;
    if (!windowPatch.opensAt || !windowPatch.closesAt) {
      validation.errors.push('lifecycle-window-update-range-required');
    }
  } else if (normalizedCommand === 'scheduler.admission_queue.release') {
    settingsPatch.manualReleaseIds = [...releaseRequestIds].sort();
    if (!releaseRequestIds.size) {
      validation.errors.push('lifecycle-release-request-ids-required');
    }
  } else if (normalizedCommand === 'scheduler.admission_queue.controls.release') {
    settingsPatch.disabledRoutes = [...routeHolds].sort();
    settingsPatch.disabledCapabilities = [...capabilityHolds].sort();
    if (!routeHolds.size && !capabilityHolds.size) {
      validation.errors.push('lifecycle-control-release-target-required');
    }
  } else if (normalizedCommand === 'scheduler.admission_queue.priority_floor.update') {
    settingsPatch.lowPriorityFloor = priorityFloor;
    if (priorityFloor === null) {
      validation.errors.push('lifecycle-priority-floor-required');
    }
  } else if (!normalizedCommand) {
    settingsPatch.command = command;
  }

  return {
    schema: 'aios.scheduler.admission_queue.lifecycle_control_intent.v1',
    requestedCommand: normalizedCommand,
    requestedBy,
    requestedAt: now,
    reason,
    settingsPatch,
    releaseRequestIds: [...releaseRequestIds].sort(),
    routeHolds: [...routeHolds].sort(),
    capabilityHolds: [...capabilityHolds].sort(),
    scheduleWindowPatch: normalizedCommand === 'scheduler.admission_queue.window.update' ? windowPatch : null,
    validation,
    proof: {
      commandKnown: !normalizedCommand || CONTROL_COMMANDS.has(normalizedCommand),
      patchGenerated: Object.keys(settingsPatch).length > 0,
      actorAttributed: Boolean(requestedBy),
      windowPatchComplete: normalizedCommand !== 'scheduler.admission_queue.window.update' || Boolean(windowPatch.opensAt && windowPatch.closesAt),
      releaseTargetsPresent: normalizedCommand !== 'scheduler.admission_queue.release' || releaseRequestIds.size > 0
    }
  };
}

function buildLifecycleCommandResult(settings, actor, now) {
  const commandToState = {
    admit: settings.acceptingNewWork ? 'accepting' : settings.state,
    enable: settings.acceptingNewWork ? 'accepting' : settings.state,
    resume: settings.acceptingNewWork ? 'accepting' : settings.state,
    disable: 'disabled',
    pause: 'paused',
    drain: 'draining'
  };
  const resultingState = commandToState[settings.command] || settings.state;
  const effects = [];

  if (settings.command === 'disable') {
    effects.push('new-admissions-blocked', 'queued-work-preserved');
  } else if (settings.command === 'pause') {
    effects.push('new-admissions-held', 'retryable-backpressure-issued');
  } else if (settings.command === 'drain') {
    effects.push('new-admissions-held', 'inflight-work-drains');
  } else if (settings.command === 'enable' || settings.command === 'resume') {
    effects.push(settings.acceptingNewWork ? 'new-admissions-enabled' : 'enable-command-pending-on-controls');
  } else {
    effects.push(settings.acceptingNewWork ? 'admission-window-open' : 'admission-window-held');
  }
  if (settings.scheduleWindow.mode === 'windowed') {
    effects.push(`schedule-window-${settings.scheduleWindow.state}`);
  }
  if (settings.disabledRoutes.size || settings.disabledCapabilities.size) {
    effects.push('route-capability-holds-active');
  }
  if (settings.lowPriorityFloor !== null) {
    effects.push('priority-floor-active');
  }

  return {
    schema: 'aios.scheduler.admission_queue.lifecycle_command_result.v1',
    command: settings.command,
    requestedBy: actor.id,
    appliedAt: now,
    resultingState,
    acceptingNewWork: settings.acceptingNewWork,
    effects,
    requiresOperatorAction: settings.validation.errors.length > 0 || !settings.acceptingNewWork,
    reason: settings.reason,
    validation: settings.validation
  };
}

function lifecycleSettingsPatchForCommand(settings, command) {
  if (command === 'scheduler.admission_queue.lifecycle.enable') {
    return {
      enabled: true,
      command: 'enable',
      scheduleMode: settings.scheduleMode === 'drain-only' ? 'immediate' : settings.scheduleMode
    };
  }
  if (command === 'scheduler.admission_queue.lifecycle.disable') {
    return { enabled: false, command: 'disable' };
  }
  if (command === 'scheduler.admission_queue.lifecycle.pause') {
    return { command: 'pause' };
  }
  if (command === 'scheduler.admission_queue.lifecycle.resume') {
    return {
      enabled: true,
      command: 'resume',
      scheduleMode: settings.scheduleMode === 'drain-only' ? 'immediate' : settings.scheduleMode
    };
  }
  if (command === 'scheduler.admission_queue.lifecycle.drain') {
    return { command: 'drain', scheduleMode: 'drain-only' };
  }
  if (command === 'scheduler.admission_queue.window.update') {
    return {
      scheduleMode: 'windowed',
      scheduleWindow: {
        opensAt: settings.scheduleWindow.nextActivationAt || settings.scheduleWindow.opensAt,
        closesAt: settings.scheduleWindow.closesAt
      }
    };
  }
  if (command === 'scheduler.admission_queue.release') {
    return { manualReleaseIds: [...settings.manualReleaseIds].sort() };
  }
  if (command === 'scheduler.admission_queue.controls.release') {
    return { disabledRoutes: [], disabledCapabilities: [] };
  }
  if (command === 'scheduler.admission_queue.priority_floor.update') {
    return { lowPriorityFloor: settings.lowPriorityFloor };
  }
  return null;
}

function buildLifecycleControlPlane(settings, actor, now) {
  const blockers = [];
  const commandOptions = [];
  const addCommand = (command, enabled, reason, extra = {}) => {
    commandOptions.push({
      command,
      enabled,
      reason,
      issuedBy: actor.id,
      issuedAt: now,
      stateBeforeCommand: settings.state,
      settingsPatch: settings.controlIntent.requestedCommand === command
        ? settings.controlIntent.settingsPatch
        : lifecycleSettingsPatchForCommand(settings, command),
      ...extra
    });
  };

  if (settings.validation.errors.length) {
    blockers.push('settings-validation-errors');
  }
  if (settings.state === 'disabled') {
    blockers.push('queue-disabled');
  }
  if (settings.state === 'paused') {
    blockers.push('queue-paused');
  }
  if (settings.state === 'draining') {
    blockers.push('queue-draining');
  }
  if (settings.scheduleWindow.state === 'pending') {
    blockers.push('schedule-window-pending');
  }
  if (settings.scheduleWindow.state === 'expired') {
    blockers.push('schedule-window-expired');
  }
  if (settings.scheduleWindow.state === 'invalid') {
    blockers.push('schedule-window-invalid');
  }
  if (settings.disabledRoutes.size) {
    blockers.push('route-holds-active');
  }
  if (settings.disabledCapabilities.size) {
    blockers.push('capability-holds-active');
  }
  if (settings.manualReleaseRequired) {
    blockers.push('manual-release-mode');
  }
  if (settings.lowPriorityFloor !== null) {
    blockers.push('priority-floor-active');
  }

  addCommand('scheduler.admission_queue.lifecycle.enable', settings.state === 'disabled', 'enable-new-admissions', {
    resultingState: settings.scheduleMode === 'drain-only' ? 'draining' : 'accepting'
  });
  addCommand('scheduler.admission_queue.lifecycle.disable', settings.state !== 'disabled', 'block-new-admissions');
  addCommand('scheduler.admission_queue.lifecycle.pause', settings.acceptingNewWork, 'temporarily-hold-new-admissions');
  addCommand('scheduler.admission_queue.lifecycle.resume', ['paused', 'draining', 'window-pending', 'window-expired'].includes(settings.state), 'resume-held-admissions', {
    requiresWindowUpdate: settings.scheduleWindow.state === 'expired'
  });
  addCommand('scheduler.admission_queue.lifecycle.drain', settings.state !== 'draining', 'stop-new-admissions-and-drain-inflight');
  addCommand('scheduler.admission_queue.window.update', settings.scheduleMode === 'windowed' && settings.scheduleWindow.state !== 'active', 'repair-or-open-schedule-window', {
    currentWindowState: settings.scheduleWindow.state,
    opensAt: settings.scheduleWindow.opensAt,
    closesAt: settings.scheduleWindow.closesAt
  });
  addCommand('scheduler.admission_queue.release', settings.manualReleaseRequired, 'release-manual-mode-request', {
    releasedRequestCount: settings.manualReleaseIds.size
  });
  addCommand('scheduler.admission_queue.controls.release', settings.disabledRoutes.size > 0 || settings.disabledCapabilities.size > 0, 'release-route-or-capability-holds', {
    routeHolds: [...settings.disabledRoutes].sort(),
    capabilityHolds: [...settings.disabledCapabilities].sort()
  });
  addCommand('scheduler.admission_queue.priority_floor.update', settings.lowPriorityFloor !== null, 'adjust-priority-floor', {
    activeFloor: settings.lowPriorityFloor
  });

  const primaryAction = commandOptions.find(option => option.enabled && [
    'scheduler.admission_queue.lifecycle.enable',
    'scheduler.admission_queue.lifecycle.resume',
    'scheduler.admission_queue.window.update',
    'scheduler.admission_queue.release',
    'scheduler.admission_queue.controls.release',
    'scheduler.admission_queue.priority_floor.update'
  ].includes(option.command)) || commandOptions.find(option => option.enabled) || null;

  return {
    schema: 'aios.scheduler.admission_queue.lifecycle_control_plane.v1',
    state: settings.state,
    acceptingNewWork: settings.acceptingNewWork,
    blockers,
    commands: commandOptions,
    nextActionState: primaryAction
      ? {
          type: 'lifecycle-control',
          command: primaryAction.command,
          reason: primaryAction.reason,
          blockedBy: blockers,
          requestScoped: primaryAction.command === 'scheduler.admission_queue.release',
          enabled: primaryAction.enabled,
          settingsPatch: primaryAction.settingsPatch
        }
      : {
          type: 'none',
          command: null,
          reason: 'admission-controls-clear',
          blockedBy: blockers,
          requestScoped: false,
          enabled: false,
          settingsPatch: null
        },
    proof: {
      commandsKnown: commandOptions.every(option => CONTROL_COMMANDS.has(option.command)),
      blockingStateExplained: settings.acceptingNewWork || blockers.length > 0,
      enableDisableMutuallyExclusive: !(settings.state === 'disabled' && settings.acceptingNewWork),
      scheduleWindowRepresented: settings.scheduleMode !== 'windowed' || blockers.some(code => code.startsWith('schedule-window-')) || settings.scheduleWindow.state === 'active',
      routeCapabilityHoldsRepresented: settings.disabledRoutes.size + settings.disabledCapabilities.size === 0 || blockers.includes('route-holds-active') || blockers.includes('capability-holds-active'),
      requestedControlValidated: settings.controlIntent.validation.errors.length === 0
        && settings.controlIntent.proof.commandKnown
        && settings.controlIntent.proof.patchGenerated
    }
  };
}

function buildLifecycleControlOperation(settings, actor, now) {
  const controlPlane = settings.controlPlane || null;
  const intent = settings.controlIntent || {};
  const nextAction = controlPlane?.nextActionState || null;
  const requestedCommand = intent.requestedCommand || null;
  const command = requestedCommand || nextAction?.command || null;
  const commandOption = controlPlane?.commands?.find(option => option.command === command) || null;
  const settingsPatch = requestedCommand
    ? intent.settingsPatch
    : commandOption?.settingsPatch || nextAction?.settingsPatch || null;
  const validation = { errors: [], warnings: [] };
  const nowMs = timestampMs(now);
  const expiresAt = nowMs === null
    ? null
    : new Date(nowMs + DEFAULT_CONTROL_OPERATION_TTL_MS).toISOString();
  const writeAuthorized = actor.roles.some(role => WRITE_ROLES.has(role))
    || actor.permissions.has('scheduler:admission_queue:control')
    || actor.permissions.has('scheduler:admission_queue:lifecycle')
    || actor.permissions.has('scheduler:admit');

  if (command && !CONTROL_COMMANDS.has(command)) {
    validation.errors.push('lifecycle-control-operation-command-invalid');
  }
  if (requestedCommand && intent.validation?.errors?.length) {
    validation.errors.push(...intent.validation.errors);
  }
  if (requestedCommand && !writeAuthorized) {
    validation.errors.push('lifecycle-control-operation-permission-required');
  } else if (command && !writeAuthorized) {
    validation.warnings.push('lifecycle-control-operation-permission-required');
  }
  if (command && !settingsPatch) {
    validation.errors.push('lifecycle-control-operation-settings-patch-required');
  }
  if (commandOption && commandOption.enabled === false && requestedCommand !== command) {
    validation.warnings.push('lifecycle-control-operation-currently-disabled');
  }
  if (settings.validation.errors.length && command !== 'scheduler.admission_queue.settings.update') {
    validation.warnings.push('lifecycle-settings-invalid-before-operation');
  }
  if (settings.state === 'disabled' && command === 'scheduler.admission_queue.lifecycle.disable') {
    validation.warnings.push('lifecycle-disable-operation-idempotent');
  }
  if (settings.acceptingNewWork && command === 'scheduler.admission_queue.lifecycle.resume') {
    validation.warnings.push('lifecycle-resume-operation-idempotent');
  }
  if (requestedCommand && !intent.reason && requestedCommand.startsWith('scheduler.admission_queue.lifecycle.')) {
    validation.warnings.push('lifecycle-control-operation-reason-recommended');
  }

  const target = command === 'scheduler.admission_queue.release'
    ? 'request'
    : command === 'scheduler.admission_queue.controls.release'
      ? 'route-capability-controls'
      : command === 'scheduler.admission_queue.window.update'
        ? 'schedule-window'
        : command === 'scheduler.admission_queue.priority_floor.update'
          ? 'priority-floor'
          : 'queue-lifecycle';
  const operationId = command
    ? `${settings.schema}:${settings.state}:${command}:${actor.id}:${now}`
    : null;

  return {
    schema: LIFECYCLE_CONTROL_OPERATION_SCHEMA,
    state: !command
      ? 'not-required'
      : validation.errors.length
        ? 'blocked'
        : requestedCommand
          ? 'requested'
          : commandOption?.enabled
            ? 'recommended'
            : 'available-disabled',
    command,
    target,
    operationId,
    idempotencyKey: operationId,
    requestedCommand,
    requestedBy: intent.requestedBy || actor.id,
    issuedBy: actor.id,
    issuedAt: now,
    expiresAt,
    ttlMs: DEFAULT_CONTROL_OPERATION_TTL_MS,
    currentState: settings.state,
    acceptingNewWork: settings.acceptingNewWork,
    writeAuthorized,
    reason: intent.reason || commandOption?.reason || nextAction?.reason || null,
    blockedBy: [...new Set([
      ...asArray(nextAction?.blockedBy),
      ...settings.validation.errors
    ])].sort(),
    requestScoped: Boolean(nextAction?.requestScoped || command === 'scheduler.admission_queue.release'),
    settingsPatch,
    releaseRequestIds: intent.releaseRequestIds || [],
    routeHolds: intent.routeHolds || [...settings.disabledRoutes].sort(),
    capabilityHolds: intent.capabilityHolds || [...settings.disabledCapabilities].sort(),
    scheduleWindowPatch: intent.scheduleWindowPatch || null,
    validation,
    proof: {
      commandKnown: !command || CONTROL_COMMANDS.has(command),
      actorCanWrite: !command || writeAuthorized,
      patchPresentWhenNeeded: !command || Boolean(settingsPatch),
      operationExpires: expiresAt === null || timestampMs(expiresAt) > nowMs,
      requestedIntentPreserved: !requestedCommand || command === requestedCommand
    }
  };
}

function normalizeLifecycleSettings(input = {}, now, actor) {
  const raw = input && typeof input === 'object' ? input : {};
  const errors = [];
  const warnings = [];
  const command = typeof raw.command === 'string' && raw.command.trim()
    ? raw.command.trim().toLowerCase()
    : 'admit';
  const scheduleMode = typeof raw.scheduleMode === 'string' && raw.scheduleMode.trim()
    ? raw.scheduleMode.trim().toLowerCase()
    : 'immediate';
  const enabled = raw.enabled === undefined ? true : raw.enabled === true;
  const maxAdmitsPerWindow = Number.isInteger(raw.maxAdmitsPerWindow) && raw.maxAdmitsPerWindow > 0
    ? raw.maxAdmitsPerWindow
    : null;
  const disabledRoutes = new Set(asArray(raw.disabledRoutes)
    .filter(route => typeof route === 'string' && route.trim())
    .map(route => route.trim()));
  const disabledCapabilities = new Set(asArray(raw.disabledCapabilities)
    .filter(capability => typeof capability === 'string' && capability.trim())
    .map(capability => capability.trim()));
  const manualReleaseIds = new Set(asArray(raw.manualReleaseIds || raw.releaseRequestIds)
    .filter(id => typeof id === 'string' && id.trim())
    .map(id => id.trim()));
  const lowPriorityFloor = Number.isFinite(raw.lowPriorityFloor)
    ? Math.max(0, Math.min(100, Math.floor(raw.lowPriorityFloor)))
    : null;

  if (!LIFECYCLE_COMMANDS.has(command)) {
    errors.push('invalid-lifecycle-command');
  }
  if (!SCHEDULE_MODES.has(scheduleMode)) {
    errors.push('invalid-schedule-mode');
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    warnings.push('enabled-coerced');
  }
  if (raw.maxAdmitsPerWindow !== undefined && maxAdmitsPerWindow === null) {
    warnings.push('max-admits-per-window-ignored');
  }
  if (raw.lowPriorityFloor !== undefined && !Number.isFinite(raw.lowPriorityFloor)) {
    warnings.push('low-priority-floor-ignored');
  }
  if ((command === 'disable' || command === 'pause' || command === 'drain') && !normalizeId(raw.reason || raw.pauseReason || raw.disableReason, null)) {
    warnings.push('lifecycle-reason-recommended');
  }
  if (command === 'drain' && scheduleMode !== 'drain-only') {
    warnings.push('drain-command-overrides-schedule-mode');
  }
  if (command === 'disable' && raw.enabled === true) {
    warnings.push('disable-command-overrides-enabled-flag');
  }
  if ((command === 'enable' || command === 'resume') && enabled === false) {
    errors.push('enable-command-conflicts-with-disabled-flag');
  }

  const disabled = !enabled || command === 'disable';
  const paused = command === 'pause';
  const draining = command === 'drain' || scheduleMode === 'drain-only';
  const manual = scheduleMode === 'manual';
  const scheduleWindow = normalizeScheduleWindow(raw, scheduleMode, now);
  const controlIntent = normalizeLifecycleControlIntent(raw, command, scheduleMode, scheduleWindow, actor, now);
  errors.push(...scheduleWindow.validation.errors);
  warnings.push(...scheduleWindow.validation.warnings);
  errors.push(...controlIntent.validation.errors);
  warnings.push(...controlIntent.validation.warnings);
  const windowHeld = scheduleMode === 'windowed' && scheduleWindow.state !== 'active';
  const acceptingNewWork = enabled && !disabled && !paused && !draining && !windowHeld;
  const state = disabled
    ? 'disabled'
    : paused
      ? 'paused'
      : draining
        ? 'draining'
        : windowHeld
          ? `window-${scheduleWindow.state}`
          : 'accepting';
  const settings = {
    schema: 'aios.scheduler.admission_queue.lifecycle_settings.v1',
    command,
    enabled,
    scheduleMode,
    state,
    acceptingNewWork,
    maxAdmitsPerWindow,
    lowPriorityFloor,
    disabledRoutes,
    disabledCapabilities,
    manualReleaseIds,
    scheduleWindow,
    controlIntent,
    reason: normalizeId(raw.reason || raw.pauseReason || raw.disableReason, null),
    validation: { errors, warnings }
  };

  settings.manualReleaseRequired = manual;
  settings.commandResult = buildLifecycleCommandResult(settings, actor || { id: 'system' }, now);
  settings.controlPlane = buildLifecycleControlPlane(settings, actor || { id: 'system' }, now);
  settings.controlOperation = buildLifecycleControlOperation(settings, actor || { id: 'system', roles: [], permissions: new Set() }, now);
  settings.controlSummary = {
    enablement: disabled ? 'disabled' : 'enabled',
    lifecycleHold: paused || draining || windowHeld,
    scheduleMode,
    windowState: scheduleWindow.state,
    routeHolds: disabledRoutes.size,
    capabilityHolds: disabledCapabilities.size,
    releasedManualRequests: manualReleaseIds.size,
    priorityFloorActive: lowPriorityFloor !== null,
    nextControlCommand: settings.controlOperation.command,
    nextControlState: settings.controlOperation.state,
    nextControlOperationId: settings.controlOperation.operationId
  };
  return settings;
}

function validateRequest(raw = {}, request) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object') {
    errors.push('request-not-object');
  }
  if (typeof raw?.route !== 'string' || !raw.route.trim()) {
    errors.push('missing-route');
  }
  if (typeof raw?.capability !== 'string' || !raw.capability.trim()) {
    errors.push('missing-capability');
  }
  if (typeof raw?.tenantId === 'string' && raw.tenantId.trim() && request.tenantId !== raw.tenantId.trim()) {
    warnings.push('tenant-id-normalized');
  }
  if (typeof raw?.workspaceId === 'string' && raw.workspaceId.trim() && request.workspaceId !== raw.workspaceId.trim()) {
    warnings.push('workspace-id-normalized');
  }
  if (raw?.priority !== undefined && !Number.isFinite(raw.priority)) {
    warnings.push('priority-defaulted');
  }
  if (request.retryAttempt >= MAX_RETRY_ATTEMPTS) {
    errors.push('retry-attempts-exhausted');
  }
  const requiredPermissions = asArray(raw?.requires)
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim());
  if (requiredPermissions.some(permission => permission.includes(' ') || permission.length > 128)) {
    errors.push('required-permission-invalid');
  }
  if (requiredPermissions.some(permission => !permission.includes(':'))) {
    warnings.push('required-permission-normalized');
  }
  errors.push(...request.providerRequirements.validation.errors);
  warnings.push(...request.providerRequirements.validation.warnings);
  errors.push(...request.operatorOverride.validation.errors);
  warnings.push(...request.operatorOverride.validation.warnings);
  errors.push(...request.dependencyState.validation.errors);
  warnings.push(...request.dependencyState.validation.warnings);
  errors.push(...request.clientRuntime.validation.errors);
  warnings.push(...request.clientRuntime.validation.warnings);

  return { errors, warnings };
}

function retryDelayFor(request, context) {
  if (context.health.retryAfterMs !== null) {
    return context.health.retryAfterMs;
  }
  const exponentialDelay = BASE_BACKOFF_MS * (2 ** request.retryAttempt);
  const priorityDiscount = request.priority >= 80 ? 0.5 : request.priority <= 20 ? 1.5 : 1;
  return Math.min(MAX_BACKOFF_MS, Math.max(BASE_BACKOFF_MS, Math.floor(exponentialDelay * priorityDiscount)));
}

function actionableError(code, message, action, retryable = true) {
  return { code, message, action, retryable };
}

function healthFailureState(health, extra = {}) {
  return {
    terminal: false,
    retryable: true,
    degradedMode: health.isDegraded,
    kernelStatus: health.status,
    failureCode: health.failureCode,
    staleHealthSignal: health.stale,
    circuitOpen: health.circuitOpen,
    consecutiveFailures: health.consecutiveFailures,
    failureBudgetRemaining: health.failureBudgetRemaining,
    ...extra
  };
}

function nextActionForDecision(request, decision, context) {
  if (decision.status === 'admitted') {
    if (decision.providerAcknowledgement?.ackRequired && decision.providerAcknowledgement?.state === 'awaiting-provider-ack') {
      return {
        type: 'provider-ack',
        label: decision.externalHandoff?.required
          ? 'Wait for provider handoff receipt'
          : 'Wait for provider dispatch receipt',
        command: decision.providerAcknowledgement.receiptCommand,
        requestId: request.id,
        providerId: decision.providerAcknowledgement.providerId,
        serviceContractId: decision.providerAcknowledgement.serviceContractId,
        receiptKey: decision.providerAcknowledgement.receiptKey,
        dispatchToken: decision.providerAcknowledgement.dispatchToken,
        ackDeadlineMs: decision.providerAcknowledgement.ackDeadlineMs,
        externalHandoffRequired: Boolean(decision.externalHandoff?.required),
        clientResumeToken: decision.clientWorkflow?.resumeContract?.resume?.token || null,
        clientDeliveryChannel: decision.clientWorkflow?.resumeContract?.delivery?.channel || null
      };
    }
    if (decision.clientWorkflow?.requiresClientAck) {
      return {
        type: 'client-ack',
        label: 'Resume client workflow after scheduler dispatch',
        command: decision.clientWorkflow.callbackCommand,
        requestId: request.id,
        correlationId: decision.clientWorkflow.correlationId,
        returnRoute: decision.clientWorkflow.returnRoute,
        resumeToken: decision.clientWorkflow.resumeContract?.resume?.token || null,
        deliveryChannel: decision.clientWorkflow.resumeContract?.delivery?.channel || null,
        clientAckDeadlineMs: decision.clientWorkflow.resumeContract?.resume?.clientAckDeadlineMs || null
      };
    }
    return {
      type: 'dispatch',
      label: decision.externalHandoff?.required
        ? 'Hand off to scheduler provider'
        : 'Dispatch through hosted scheduler',
      command: decision.externalHandoff?.required
        ? 'scheduler.provider_contract.dispatch'
        : 'scheduler.dispatch',
      route: request.route,
      providerId: decision.providerNegotiation?.selectedProviderId || null,
      serviceContractId: decision.dispatchContract?.service?.contractId || null,
      dispatchToken: decision.dispatchContract?.dispatchToken || decision.externalHandoff?.dispatchToken || null,
      clientResumeToken: decision.clientWorkflow?.resumeContract?.resume?.token || null,
      clientDeliveryChannel: decision.clientWorkflow?.resumeContract?.delivery?.channel || null
    };
  }
  if (decision.validation?.errors?.length) {
    return {
      type: 'repair-request',
      label: 'Repair admission request fields',
      command: 'scheduler.admission_queue.request.update',
      requiredFixes: decision.validation.errors
    };
  }
  if (decision.admissionBoundary?.decision?.denied) {
    return {
      type: 'repair-boundary',
      label: 'Repair scheduler tenant, workspace, or permission boundary',
      command: 'scheduler.admission_queue.boundary.remediate',
      requestId: request.id,
      violations: decision.admissionBoundary.decision.violations,
      missingPermissions: decision.admissionBoundary.missingPermissions,
      deniedScopes: decision.admissionBoundary.scopedAdmission?.deniedScopes || [],
      permissionHandoffCommand: decision.admissionBoundary.scopedAdmission?.audit?.handoffCommand || null,
      requestedTenantId: decision.admissionBoundary.requestedTenantId,
      requestedWorkspaceId: decision.admissionBoundary.requestedWorkspaceId
    };
  }
  if (decision.reasons?.includes('settings-invalid')) {
    return {
      type: 'repair-settings',
      label: 'Repair lifecycle settings before admission resumes',
      command: 'scheduler.admission_queue.settings.update',
      requiredFixes: context.lifecycle.validation.errors,
      requestedControl: context.lifecycle.controlIntent.requestedCommand,
      settingsPatch: context.lifecycle.controlIntent.settingsPatch,
      controlOperation: context.lifecycle.controlOperation
    };
  }
  if (decision.reasons?.includes('queue-disabled') || decision.reasons?.includes('queue-paused') || decision.reasons?.includes('queue-draining')) {
    return {
      type: 'lifecycle-command',
      label: context.lifecycle.controlPlane.nextActionState.reason === 'enable-new-admissions'
        ? 'Enable scheduler admission queue'
        : 'Resume scheduler admission queue',
      command: context.lifecycle.controlPlane.nextActionState.command || 'scheduler.admission_queue.lifecycle.resume',
      currentState: context.lifecycle.state,
      requestedControl: context.lifecycle.controlIntent.requestedCommand,
      settingsPatch: context.lifecycle.controlPlane.nextActionState.settingsPatch
        || context.lifecycle.controlIntent.settingsPatch,
      controlOperation: context.lifecycle.controlOperation
    };
  }
  if (decision.reasons?.includes('health-circuit-open')) {
    return {
      type: 'restore-kernel-health',
      label: 'Close hosted-kernel health circuit',
      command: 'scheduler.kernel_health.restore',
      failureCode: context.health.failureCode,
      consecutiveFailures: context.health.consecutiveFailures,
      retryAfterMs: decision.retryAfterMs || retryDelayFor(request, context)
    };
  }
  if (decision.reasons?.includes('same-health-failure-retry-limit') || decision.reasons?.includes('terminal-health-failure-code')) {
    return {
      type: 'inspect-health-failure',
      label: 'Inspect hosted-kernel failure before retrying admission',
      command: 'scheduler.kernel_health.failure.inspect',
      requestId: request.id,
      failureCode: context.health.failureCode,
      lastFailureCode: request.lastFailureCode,
      retryAttempt: request.retryAttempt,
      sameFailureRetryLimit: context.health.sameFailureRetryLimit
    };
  }
  if (decision.reasons?.includes('health-signal-stale')) {
    return {
      type: 'refresh-health-signal',
      label: 'Refresh hosted-kernel heartbeat before admission',
      command: 'scheduler.kernel_health.refresh',
      observedAt: context.health.observedAt,
      heartbeatTtlMs: context.health.heartbeatTtlMs
    };
  }
  if (decision.reasons?.includes('manual-release-required')) {
    return {
      type: 'manual-release',
      label: 'Approve request for manual scheduler release',
      command: 'scheduler.admission_queue.release',
      requestId: request.id,
      releasedRequestIds: [...context.lifecycle.manualReleaseIds].sort(),
      controlOperation: context.lifecycle.controlOperation,
      settingsPatch: {
        manualReleaseIds: [...new Set([...context.lifecycle.manualReleaseIds, request.id])].sort()
      }
    };
  }
  if (decision.reasons?.includes('failed-dependency-hold')) {
    const dependencyFailure = decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
      ? decision.failureState
      : buildDependencyFailureState(request, context, decision.status === 'rejected');
    return {
      type: dependencyFailure.terminal ? 'inspect-failed-dependencies' : 'failed-dependency-hold',
      label: dependencyFailure.terminal
        ? 'Inspect failed scheduler dependencies before retrying admission'
        : 'Wait for failed scheduler dependencies or release with operator override',
      command: dependencyFailure.terminal
        ? dependencyFailure.inspectCommand
        : request.operatorOverride.active
          ? dependencyFailure.releaseCommand
          : 'scheduler.admission_queue.dependencies.wait',
      requestId: request.id,
      failedDependencyIds: dependencyFailure.failedDependencyIds,
      unresolvedDependencyIds: dependencyFailure.unresolvedDependencyIds,
      retryAttempt: dependencyFailure.retryAttempt,
      retryLimit: dependencyFailure.retryLimit,
      retryAfterMs: dependencyFailure.retryAfterMs,
      operatorOverrideActive: dependencyFailure.operatorOverrideActive,
      operatorOverrideRequested: dependencyFailure.operatorOverrideRequested,
      actionRequired: dependencyFailure.actionRequired,
      settingsPatch: dependencyFailure.settingsPatch
    };
  }
  if (decision.reasons?.includes('dependency-hold')) {
    return {
      type: 'dependency-hold',
      label: 'Wait for scheduler dependencies before admission',
      command: request.operatorOverride.active
        ? 'scheduler.admission_queue.dependencies.release'
        : 'scheduler.admission_queue.dependencies.wait',
      requestId: request.id,
      dependencyIds: request.dependencyState.dependencyIds,
      unresolvedDependencyIds: request.dependencyState.unresolvedDependencyIds,
      failedDependencyIds: request.dependencyState.failedDependencyIds,
      operatorOverrideActive: request.operatorOverride.active,
      settingsPatch: request.operatorOverride.active
        ? {
            operatorOverride: {
              enabled: true,
              bypassDependencies: true,
              reason: request.operatorOverride.reason
            }
          }
        : null
    };
  }
  if (decision.reasons?.includes('schedule-window-pending')) {
    return {
      type: 'wait-for-schedule-window',
      label: 'Wait for scheduler admission window',
      command: 'scheduler.admission_queue.window.wait',
      opensAt: context.lifecycle.scheduleWindow.nextActivationAt,
      requestId: request.id
    };
  }
  if (decision.reasons?.includes('schedule-window-expired')) {
    return {
      type: 'update-schedule-window',
      label: 'Create a new scheduler admission window',
      command: 'scheduler.admission_queue.window.update',
      closedAt: context.lifecycle.scheduleWindow.closedAt,
      requestId: request.id,
      settingsPatch: context.lifecycle.controlIntent.requestedCommand === 'scheduler.admission_queue.window.update'
        ? context.lifecycle.controlIntent.settingsPatch
        : { scheduleMode: 'windowed', scheduleWindow: { opensAt: null, closesAt: null } }
    };
  }
  if (decision.reasons?.includes('scheduling-control-held')) {
    return {
      type: 'release-scheduling-control',
      label: 'Release route or capability hold',
      command: 'scheduler.admission_queue.controls.release',
      routeHeld: context.lifecycle.disabledRoutes.has(request.route),
      capabilityHeld: context.lifecycle.disabledCapabilities.has(request.capability),
      routeHolds: [...context.lifecycle.disabledRoutes].sort(),
      capabilityHolds: [...context.lifecycle.disabledCapabilities].sort(),
      controlOperation: context.lifecycle.controlOperation,
      settingsPatch: {
        disabledRoutes: [...context.lifecycle.disabledRoutes].filter(route => route !== request.route).sort(),
        disabledCapabilities: [...context.lifecycle.disabledCapabilities].filter(capability => capability !== request.capability).sort()
      }
    };
  }
  if (decision.reasons?.includes('below-priority-floor')) {
    return {
      type: 'adjust-priority-floor',
      label: 'Adjust scheduler priority floor',
      command: 'scheduler.admission_queue.priority_floor.update',
      requestPriority: request.priority,
      activeFloor: context.lifecycle.lowPriorityFloor,
      minimumPriorityNeeded: context.lifecycle.lowPriorityFloor,
      controlOperation: context.lifecycle.controlOperation,
      settingsPatch: { lowPriorityFloor: request.priority }
    };
  }
  if (decision.reasons?.includes('queue-capacity-exhausted') || decision.reasons?.includes('queue-limit')) {
    return {
      type: 'queue-capacity',
      label: 'Wait for scheduler admission queue capacity',
      command: 'scheduler.admission_queue.capacity.wait',
      requestId: request.id,
      retryAfterMs: decision.retryAfterMs || context.queueCapacity.retryAfterMs || retryDelayFor(request, context),
      limit: context.queueCapacity.limit,
      occupied: context.queueCapacity.occupied,
      queued: context.queueCapacity.queued,
      inFlight: context.queueCapacity.inFlight,
      reserved: context.queueCapacity.reserved,
      availableSlots: Math.max(0, context.queueCapacity.availableSlots - context.admittedCount),
      resetAt: context.queueCapacity.resetAt
    };
  }
  if (decision.reasons?.includes('provider-capability-unavailable')) {
    return {
      type: 'register-provider-capability',
      label: 'Register a scheduler provider for this route and capability',
      command: 'scheduler.provider_contract.register',
      route: request.route,
      capability: request.capability,
      requestedProviderId: request.providerId
    };
  }
  if (decision.reasons?.includes('provider-not-ready') || decision.reasons?.includes('requested-provider-unknown')) {
    return {
      type: 'refresh-provider-contract',
      label: 'Refresh scheduler provider contract and sync metadata',
      command: 'scheduler.provider_contract.sync',
      providerId: request.providerId || decision.providerNegotiation?.selectedProviderId || null,
      requiredContractVersion: context.providerRegistry.requiredContractVersion
    };
  }
  if (decision.reasons?.some(reason => [
    'provider-response-mode-unavailable',
    'provider-service-class-unavailable',
    'provider-external-handoff-required',
    'provider-handoff-mode-unavailable',
    'provider-fresh-sync-required',
    'provider-sync-generation-too-low',
    'provider-queue-reservation-unavailable',
    'provider-dispatch-slot-unavailable'
  ].includes(reason))) {
    return {
      type: 'renegotiate-provider-contract',
      label: 'Negotiate a provider contract that satisfies request service requirements',
      command: 'scheduler.provider_contract.negotiate',
      providerId: decision.providerNegotiation?.selectedProviderId || request.providerId || null,
      requiredContractVersion: context.providerRegistry.requiredContractVersion,
      providerRequirements: request.providerRequirements,
      requirementViolations: decision.providerNegotiation?.requirementViolations || decision.reasons
    };
  }
  if (decision.reasons?.includes('provider-backpressure')) {
    return {
      type: 'provider-backpressure',
      label: 'Wait for scheduler provider capacity',
      command: 'scheduler.provider_contract.capacity.wait',
      providerId: decision.providerNegotiation?.selectedProviderId || request.providerId || null,
      retryAfterMs: decision.retryAfterMs || decision.providerNegotiation?.retryAfterMs || retryDelayFor(request, context),
      queueDepth: decision.providerNegotiation?.providerCapacity?.queueDepth ?? null,
      queueLimit: decision.providerNegotiation?.providerCapacity?.queueLimit ?? null,
      inFlight: decision.providerNegotiation?.providerCapacity?.inFlight ?? null,
      maxInFlight: decision.providerNegotiation?.providerCapacity?.maxInFlight ?? null
    };
  }
  if (decision.retryAfterMs) {
    return {
      type: 'retry-after',
      label: 'Retry admission after backoff',
      command: 'scheduler.admission_queue.retry',
      retryAfterMs: decision.retryAfterMs
    };
  }
  return {
    type: 'review',
    label: 'Review scheduler admission policy outcome',
    command: 'scheduler.admission_queue.review'
  };
}

function incrementMetric(container, key, field, amount = 1) {
  if (!key) {
    return;
  }
  if (!container[key]) {
    container[key] = { admitted: 0, deferred: 0, rejected: 0, total: 0 };
  }
  container[key][field] = (container[key][field] || 0) + amount;
  container[key].total += amount;
}

function incrementCounter(container, key, amount = 1) {
  if (!key) {
    return;
  }
  container[key] = (container[key] || 0) + amount;
}

function sortedCounterEntries(counter, limit = 10) {
  return Object.entries(counter)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

function buildLatencyStats(values) {
  const sorted = values
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return {
      observed: 0,
      minMs: null,
      maxMs: null,
      averageMs: null,
      p50Ms: null,
      p95Ms: null
    };
  }
  const percentile = rank => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * rank))];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    observed: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    averageMs: Math.floor(total / sorted.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95)
  };
}

function classifyBacklogAge(latencyMs, decision) {
  if (!Number.isFinite(latencyMs)) {
    return 'unobserved';
  }
  if (decision.status === 'admitted' && !decision.providerAcknowledgement?.ackRequired && !decision.clientWorkflow?.requiresClientAck) {
    return 'cleared';
  }
  if (latencyMs >= BACKLOG_CRITICAL_MS) {
    return 'critical';
  }
  if (latencyMs >= BACKLOG_STALE_MS) {
    return 'stale';
  }
  return decision.status === 'admitted' ? 'post-admission-wait' : 'fresh';
}

function classifyReportBucket(request, decision, backlogAgeClass) {
  if (decision.reasons?.includes('dependency-hold') || decision.reasons?.includes('failed-dependency-hold')) {
    return request.operatorOverride?.active ? 'dependency-override-release' : 'dependency-wait';
  }
  if (decision.reasons?.includes('queue-capacity-exhausted') || decision.reasons?.includes('queue-limit')) {
    return 'queue-capacity';
  }
  if (decision.reasons?.includes('provider-backpressure')) {
    return 'provider-capacity';
  }
  if (decision.providerAcknowledgement?.ackRequired) {
    return 'provider-ack-wait';
  }
  if (decision.clientWorkflow?.requiresClientAck) {
    return 'client-ack-wait';
  }
  if (decision.admissionBoundary?.decision?.denied) {
    return 'permission-boundary';
  }
  if (backlogAgeClass === 'critical' || backlogAgeClass === 'stale') {
    return 'aging-backlog';
  }
  return decision.status === 'admitted' ? 'dispatch-ready' : decision.status;
}

function exportChecksumForRows(rows) {
  const modulus = 2147483647;
  let checksum = 17;
  for (const row of rows) {
    const material = [
      row.requestId,
      row.status,
      row.actionType,
      row.actionOperationId,
      row.reportBucket,
      row.providerId,
      row.reasonCodes.join('|'),
      row.warningCodes.join('|')
    ].map(value => value ?? '').join('#');
    for (let index = 0; index < material.length; index += 1) {
      checksum = (checksum * 31 + material.charCodeAt(index)) % modulus;
    }
  }
  return checksum.toString(36);
}

function normalizeHistorySnapshot(snapshot, index) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const counts = snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : {};
  const admitted = Number.isFinite(counts.admitted) ? Math.max(0, Math.floor(counts.admitted)) : 0;
  const deferred = Number.isFinite(counts.deferred) ? Math.max(0, Math.floor(counts.deferred)) : 0;
  const rejected = Number.isFinite(counts.rejected) ? Math.max(0, Math.floor(counts.rejected)) : 0;
  const total = Number.isFinite(counts.total)
    ? Math.max(0, Math.floor(counts.total))
    : admitted + deferred + rejected;

  return {
    id: normalizeId(snapshot.id, `history-${index + 1}`),
    at: normalizeId(snapshot.at || snapshot.generatedAt, null),
    tenantId: normalizeId(snapshot.tenantId, null),
    workspaceId: normalizeId(snapshot.workspaceId, null),
    healthStatus: normalizeId(snapshot.healthStatus || snapshot.kernelStatus, null),
    queueLimit: Number.isInteger(snapshot.queueLimit) && snapshot.queueLimit > 0 ? snapshot.queueLimit : null,
    counts: { admitted, deferred, rejected, total },
    exported: Boolean(snapshot.exported)
  };
}

function normalizeHistory(input, workspace) {
  return asArray(input.history || input.historySnapshots)
    .map(normalizeHistorySnapshot)
    .filter(Boolean)
    .filter(snapshot => {
      const tenantMatches = !snapshot.tenantId || snapshot.tenantId === workspace.tenantId;
      const workspaceMatches = !snapshot.workspaceId || snapshot.workspaceId === workspace.workspaceId;
      return tenantMatches && workspaceMatches;
    })
    .slice(-DEFAULT_HISTORY_LIMIT);
}

function buildAnalytics(decisions, history, queueLimit, queueCapacity, now, workspace, actor, health) {
  const byRoute = {};
  const byCapability = {};
  const byProvider = {};
  const statusCounters = { admitted: 0, deferred: 0, rejected: 0, total: 0 };
  const reasonCounts = {};
  const actionTypeCounts = {};
  const retryableRequestIds = [];
  const terminalRequestIds = [];
  const validationWarningCounts = {};
  const providerWarningCounts = {};
  const clientWarningCounts = {};
  const boundaryViolationCounts = {};
  const backlogAgeCounts = {};
  const reportBucketCounts = {};
  const boundaryDeniedRequestIds = [];
  const scopedPermissionDeniedRequestIds = [];
  const scopedPermissionStreamCounts = {};
  const externalHandoffRequestIds = [];
  const awaitingClientAckRequestIds = [];
  const awaitingProviderAckRequestIds = [];
  const providerAckValidationRequestIds = [];
  const providerBackpressureRequestIds = [];
  const dispatchContractRequestIds = [];
  const dependencyHeldRequestIds = [];
  const dependencyFailedRequestIds = [];
  const dependencyHandoffRequestIds = [];
  const dependencyClientWaitRequestIds = [];
  const operatorOverrideRequestIds = [];
  const providerCapacity = {};
  const admissionLatencyMs = [];
  const exportRows = [];
  const staleBacklogRequestIds = [];
  const criticalBacklogRequestIds = [];
  const unresolvedReportRequestIds = [];
  let oldestOpenBacklog = null;
  let retryAfterTotalMs = 0;
  let retryAfterCount = 0;
  const nowMs = timestampMs(now);

  for (const { request, decision } of decisions) {
    incrementCounter(statusCounters, decision.status);
    statusCounters.total += 1;
    incrementMetric(byRoute, request.route, decision.status);
    incrementMetric(byCapability, request.capability, decision.status);
    incrementMetric(byProvider, decision.providerNegotiation?.selectedProviderId || 'unassigned', decision.status);
    for (const reason of decision.reasons || []) {
      incrementCounter(reasonCounts, reason);
    }
    incrementCounter(actionTypeCounts, decision.nextAction?.type || 'none');
    const submittedMs = timestampMs(request.submittedAt);
    const latencyMs = submittedMs !== null && nowMs !== null ? Math.max(0, nowMs - submittedMs) : null;
    if (latencyMs !== null) {
      admissionLatencyMs.push(latencyMs);
    }
    const backlogAgeClass = classifyBacklogAge(latencyMs, decision);
    const reportBucket = classifyReportBucket(request, decision, backlogAgeClass);
    incrementCounter(backlogAgeCounts, backlogAgeClass);
    incrementCounter(reportBucketCounts, reportBucket);
    if (backlogAgeClass === 'stale') {
      staleBacklogRequestIds.push(request.id);
    } else if (backlogAgeClass === 'critical') {
      criticalBacklogRequestIds.push(request.id);
    }
    if (decision.status !== 'admitted' || decision.providerAcknowledgement?.ackRequired || decision.clientWorkflow?.requiresClientAck) {
      unresolvedReportRequestIds.push(request.id);
      if (latencyMs !== null && (!oldestOpenBacklog || latencyMs > oldestOpenBacklog.ageMs)) {
        oldestOpenBacklog = {
          requestId: request.id,
          ageMs: latencyMs,
          status: decision.status,
          reportBucket,
          actionType: decision.nextAction?.type || null
        };
      }
    }
    const selectedProviderId = decision.providerNegotiation?.selectedProviderId;
    const capacity = decision.providerNegotiation?.providerCapacity;
    if (selectedProviderId && capacity && !providerCapacity[selectedProviderId]) {
      providerCapacity[selectedProviderId] = {
        acceptingNewWork: capacity.acceptingNewWork,
        saturated: capacity.saturated,
        queueDepth: capacity.queueDepth,
        queueLimit: capacity.queueLimit,
        queueRemaining: capacity.queueRemaining,
        inFlight: capacity.inFlight,
        maxInFlight: capacity.maxInFlight,
        dispatchSlotsRemaining: capacity.dispatchSlotsRemaining,
        retryAfterMs: capacity.retryAfterMs
      };
    }
    if (decision.failureState?.retryable) {
      retryableRequestIds.push(request.id);
    }
    if (decision.failureState?.terminal) {
      terminalRequestIds.push(request.id);
    }
    if (decision.externalHandoff?.required) {
      externalHandoffRequestIds.push(request.id);
    }
    if (decision.clientWorkflow?.requiresClientAck) {
      awaitingClientAckRequestIds.push(request.id);
    }
    if (decision.providerAcknowledgement?.ackRequired) {
      awaitingProviderAckRequestIds.push(request.id);
    }
    if (decision.providerAcknowledgement?.validation?.errors?.length) {
      providerAckValidationRequestIds.push(request.id);
    }
    if (decision.admissionBoundary?.decision?.denied) {
      boundaryDeniedRequestIds.push(request.id);
      for (const violation of decision.admissionBoundary.decision.violations) {
        boundaryViolationCounts[violation] = (boundaryViolationCounts[violation] || 0) + 1;
      }
    }
    if (decision.admissionBoundary?.scopedAdmission?.deniedScopes?.length) {
      scopedPermissionDeniedRequestIds.push(request.id);
    }
    incrementCounter(scopedPermissionStreamCounts, decision.admissionBoundary?.scopedAdmission?.audit?.stream);
    if (decision.reasons?.includes('provider-backpressure')) {
      providerBackpressureRequestIds.push(request.id);
    }
    if (request.dependencyState?.held || decision.reasons?.includes('dependency-hold')) {
      dependencyHeldRequestIds.push(request.id);
    }
    if (request.dependencyState?.failed || decision.reasons?.includes('failed-dependency-hold')) {
      dependencyFailedRequestIds.push(request.id);
    }
    if (decision.dependencyHandoff?.required) {
      dependencyHandoffRequestIds.push(request.id);
    }
    if (decision.dependencyHandoff?.held || decision.dependencyHandoff?.failed) {
      dependencyClientWaitRequestIds.push(request.id);
    }
    if (request.operatorOverride?.active) {
      operatorOverrideRequestIds.push(request.id);
    }
    if (decision.dispatchContract?.state === 'dispatchable') {
      dispatchContractRequestIds.push(request.id);
    }
    for (const warning of decision.validation?.warnings || []) {
      validationWarningCounts[warning] = (validationWarningCounts[warning] || 0) + 1;
    }
    for (const warning of decision.providerNegotiation?.validation?.warnings || []) {
      providerWarningCounts[warning] = (providerWarningCounts[warning] || 0) + 1;
    }
    for (const warning of decision.clientWorkflow?.validation?.warnings || request.clientRuntime?.validation?.warnings || []) {
      clientWarningCounts[warning] = (clientWarningCounts[warning] || 0) + 1;
    }
    if (Number.isFinite(decision.retryAfterMs)) {
      retryAfterTotalMs += decision.retryAfterMs;
      retryAfterCount += 1;
    }
    exportRows.push({
      schema: 'aios.scheduler.admission_queue.analytics_row.v1',
      generatedAt: now,
      tenantId: request.tenantId || workspace.tenantId,
      workspaceId: request.workspaceId || workspace.workspaceId,
      requestId: request.id,
      queuePosition: request.queueMetadata?.position || null,
      queueReadyPosition: request.queueMetadata?.readyPosition || null,
      effectivePriority: request.queueMetadata?.effectivePriority ?? request.priority ?? null,
      status: decision.status,
      route: request.route || null,
      capability: request.capability || null,
      priority: Number.isFinite(request.priority) ? request.priority : null,
      providerId: selectedProviderId || null,
      responseMode: decision.clientWorkflow?.responseMode || request.clientRuntime?.responseMode || null,
      actionType: decision.nextAction?.type || null,
      actionCommand: decision.nextAction?.command || null,
      actionOperationId: decision.nextAction?.controlOperation?.operationId || null,
      actionControlState: decision.nextAction?.controlOperation?.state || null,
      reportBucket,
      backlogAgeClass,
      retryAfterMs: Number.isFinite(decision.retryAfterMs) ? decision.retryAfterMs : null,
      latencyMs,
      queueCapacity: {
        limit: queueCapacity.limit,
        occupiedAtWindowStart: queueCapacity.occupied,
        availableAtWindowStart: queueCapacity.availableSlots,
        acceptedBeforeRequest: Math.max(0, (request.queueMetadata?.readyPosition || 1) - 1),
        capacityReason: decision.reasons?.includes('queue-capacity-exhausted') ? 'queue-capacity-exhausted' : null
      },
      queueAdmissionState: decision.queueAdmissionState
        ? {
            state: decision.queueAdmissionState.state,
            ready: decision.queueAdmissionState.ready,
            readyPosition: decision.queueAdmissionState.readyPosition,
            readyAhead: decision.queueAdmissionState.readyAhead,
            projectedSlot: decision.queueAdmissionState.projectedSlot,
            capacityAvailableForPosition: decision.queueAdmissionState.capacityAvailableForPosition,
            dependencyOverrideReleased: decision.queueAdmissionState.dependencyOverrideReleased,
            operatorOverrideEffect: decision.queueAdmissionState.operatorOverride.priorityEffect
          }
        : null,
      dependencyHandoff: decision.dependencyHandoff
        ? {
            state: decision.dependencyHandoff.state,
            command: decision.dependencyHandoff.command,
            releaseReady: decision.dependencyHandoff.releaseReady,
            waitOnCount: decision.dependencyHandoff.waitOnCount,
            clientChannel: decision.dependencyHandoff.clientNotification.channel,
            clientRoute: decision.dependencyHandoff.clientNotification.route,
            messageCode: decision.dependencyHandoff.clientNotification.messageCode,
            operatorOverrideEffect: decision.dependencyHandoff.operatorOverride.priorityEffect,
            operatorDependencyEffect: decision.dependencyHandoff.operatorOverride.dependencyEffect
          }
        : null,
      reasonCodes: asArray(decision.reasons),
      dependencyHeld: Boolean(request.dependencyState?.held),
      dependencyFailed: Boolean(request.dependencyState?.failed),
      unresolvedDependencyIds: request.dependencyState?.unresolvedDependencyIds || [],
      failedDependencyIds: request.dependencyState?.failedDependencyIds || [],
      dependencyFailure: decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
        ? {
            terminal: decision.failureState.terminal,
            retryable: decision.failureState.retryable,
            retryAttempt: decision.failureState.retryAttempt,
            retryLimit: decision.failureState.retryLimit,
            retryAfterMs: decision.failureState.retryAfterMs,
            actionRequired: decision.failureState.actionRequired
          }
        : null,
      operatorOverrideActive: Boolean(request.operatorOverride?.active),
      operatorOverrideReason: request.operatorOverride?.reason || null,
      warningCodes: [
        ...asArray(decision.validation?.warnings),
        ...asArray(decision.providerNegotiation?.validation?.warnings),
        ...asArray(decision.clientWorkflow?.validation?.warnings || request.clientRuntime?.validation?.warnings),
        ...asArray(decision.providerAcknowledgement?.validation?.warnings)
      ],
      boundaryDenied: Boolean(decision.admissionBoundary?.decision?.denied),
      scopedPermissionDenied: Boolean(decision.admissionBoundary?.scopedAdmission?.deniedScopes?.length),
      permissionAuditStream: decision.admissionBoundary?.scopedAdmission?.audit?.stream || null,
      externalHandoffRequired: Boolean(decision.externalHandoff?.required),
      dispatchContractState: decision.dispatchContract?.state || null,
      providerAckState: decision.providerAcknowledgement?.state || null,
      providerAckRequired: Boolean(decision.providerAcknowledgement?.ackRequired),
      providerAckDeadlineMs: decision.providerAcknowledgement?.ackDeadlineMs || null,
      clientDelivery: decision.clientWorkflow?.deliveryService
        ? {
            channel: decision.clientWorkflow.deliveryService.channel,
            route: decision.clientWorkflow.deliveryService.route,
            providerGateRequired: decision.clientWorkflow.deliveryService.providerGateRequired,
            readyForClient: decision.clientWorkflow.deliveryService.readyForClient
          }
        : null
    });
  }

  const currentTotal = decisions.length;
  const lastSnapshot = history[history.length - 1] || null;
  const previousTotal = lastSnapshot?.counts?.total || 0;
  const utilization = queueLimit > 0 ? Number((currentTotal / queueLimit).toFixed(3)) : 0;
  const currentSnapshot = {
    schema: 'aios.scheduler.admission_queue.history_snapshot.v1',
    id: `${workspace.tenantId}:${workspace.workspaceId}:admission-window:${now}`,
    at: now,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    generatedBy: actor.id,
    healthStatus: health?.status || null,
    queueLimit,
    counts: {
      admitted: statusCounters.admitted,
      deferred: statusCounters.deferred,
      rejected: statusCounters.rejected,
      total: statusCounters.total
    },
    exported: false,
    topReasons: sortedCounterEntries(reasonCounts, 5),
    topActions: sortedCounterEntries(actionTypeCounts, 5)
  };
  const exportIntegrity = {
    schema: 'aios.scheduler.admission_queue.export_integrity.v1',
    batchId: `${workspace.tenantId}:${workspace.workspaceId}:${now}:${exportRows.length}`,
    rowCount: exportRows.length,
    checksum: exportChecksumForRows(exportRows),
    complete: exportRows.length === currentTotal,
    unresolvedRequestCount: unresolvedReportRequestIds.length,
    staleBacklogCount: staleBacklogRequestIds.length,
    criticalBacklogCount: criticalBacklogRequestIds.length
  };

  return {
    statusCounters,
    byRoute,
    byCapability,
    byProvider,
    reasonCounts,
    actionTypeCounts,
    topReasons: sortedCounterEntries(reasonCounts),
    topActions: sortedCounterEntries(actionTypeCounts),
    retryableRequestIds,
    terminalRequestIds,
    externalHandoffRequestIds,
    dispatchContractRequestIds,
    awaitingProviderAckRequestIds,
    providerAckValidationRequestIds,
    providerBackpressureRequestIds,
    dependencyHeldRequestIds,
    dependencyFailedRequestIds,
    dependencyHandoffRequestIds,
    dependencyClientWaitRequestIds,
    operatorOverrideRequestIds,
    validationWarningCounts,
    providerWarningCounts,
    clientWarningCounts,
    backlogAgeCounts,
    reportBucketCounts,
    staleBacklogRequestIds,
    criticalBacklogRequestIds,
    unresolvedReportRequestIds,
    oldestOpenBacklog,
    boundaryViolationCounts,
    boundaryDeniedRequestIds,
    scopedPermissionDeniedRequestIds,
    scopedPermissionStreamCounts,
    providerCapacity,
    queueCapacity: {
      schema: queueCapacity.schema,
      limit: queueCapacity.limit,
      queued: queueCapacity.queued,
      inFlight: queueCapacity.inFlight,
      reserved: queueCapacity.reserved,
      occupied: queueCapacity.occupied,
      availableSlots: queueCapacity.availableSlots,
      full: queueCapacity.full,
      overLimit: queueCapacity.overLimit,
      retryAfterMs: queueCapacity.retryAfterMs,
      resetAt: queueCapacity.resetAt,
      validation: queueCapacity.validation
    },
    latency: buildLatencyStats(admissionLatencyMs),
    exportRows,
    exportIntegrity,
    currentSnapshot,
    averageRetryAfterMs: retryAfterCount ? Math.floor(retryAfterTotalMs / retryAfterCount) : 0,
    awaitingClientAckRequestIds,
    queueUtilization: utilization,
    historyDelta: {
      previousSnapshotId: lastSnapshot?.id || null,
      requestCountChange: currentTotal - previousTotal,
      previousTotal
    },
    reportingState: {
      schema: 'aios.scheduler.admission_queue.reporting_state.v1',
      exportReady: true,
      rowCount: exportRows.length,
      snapshotId: currentSnapshot.id,
      exportBatchId: exportIntegrity.batchId,
      exportChecksum: exportIntegrity.checksum,
      historyWindowSize: history.length,
      historyLimit: DEFAULT_HISTORY_LIMIT,
      hasPriorSnapshot: Boolean(lastSnapshot),
      changedSinceLastSnapshot: currentTotal !== previousTotal,
      saturatedWindow: queueLimit > 0 && currentTotal >= queueLimit,
      capacityExhausted: queueCapacity.availableSlots <= statusCounters.admitted,
      backlogAging: criticalBacklogRequestIds.length > 0
        ? 'critical'
        : staleBacklogRequestIds.length > 0
          ? 'stale'
          : unresolvedReportRequestIds.length > 0
            ? 'open'
            : 'clear',
      generatedAt: now
    }
  };
}

function buildTimeline({ now, health, counts, analytics, history, providerRegistry }) {
  const historyEvents = history.map(snapshot => ({
    type: 'history-snapshot',
    at: snapshot.at,
    id: snapshot.id,
    healthStatus: snapshot.healthStatus,
    counts: snapshot.counts,
    exported: snapshot.exported
  }));
  const reportEvents = [
    {
      type: 'analytics-snapshot-ready',
      at: now,
      id: analytics.currentSnapshot.id,
      counts: analytics.currentSnapshot.counts,
      exportRows: analytics.reportingState.rowCount,
      changedSinceLastSnapshot: analytics.reportingState.changedSinceLastSnapshot,
      saturatedWindow: analytics.reportingState.saturatedWindow,
      backlogAging: analytics.reportingState.backlogAging,
      exportBatchId: analytics.reportingState.exportBatchId,
      topReasons: analytics.currentSnapshot.topReasons
    }
  ];

  return [
    ...historyEvents,
    ...reportEvents,
    {
      type: 'current-admission-window',
      at: now,
      healthStatus: health.status,
      counts: { ...counts, total: counts.admitted + counts.deferred + counts.rejected },
      queueUtilization: analytics.queueUtilization,
      retryableRequests: analytics.retryableRequestIds.length,
      terminalRequests: analytics.terminalRequestIds.length,
      externalHandoffs: analytics.externalHandoffRequestIds.length,
      awaitingClientAck: analytics.awaitingClientAckRequestIds.length,
      awaitingProviderAck: analytics.awaitingProviderAckRequestIds.length,
      staleBacklog: analytics.staleBacklogRequestIds.length,
      criticalBacklog: analytics.criticalBacklogRequestIds.length,
      oldestOpenBacklog: analytics.oldestOpenBacklog,
      providerContracts: providerRegistry.providers.length,
      providerRegistryDeclared: providerRegistry.declared,
      providerCapacityBlocked: analytics.providerBackpressureRequestIds.length,
      queueCapacity: analytics.queueCapacity
    }
  ];
}

function buildExportSummary({ now, workspace, actor, counts, analytics, timeline, providerRegistry }) {
  const total = counts.admitted + counts.deferred + counts.rejected;
  return {
    schema: 'aios.scheduler.admission_queue.analytics.v1',
    generatedAt: now,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    generatedBy: actor.id,
    totals: { ...counts, total },
    queueUtilization: analytics.queueUtilization,
    counters: {
      status: analytics.statusCounters,
      reasons: analytics.reasonCounts,
      actions: analytics.actionTypeCounts,
      topReasons: analytics.topReasons,
      topActions: analytics.topActions
    },
    backlog: {
      ageBuckets: analytics.backlogAgeCounts,
      reportBuckets: analytics.reportBucketCounts,
      staleRequestIds: analytics.staleBacklogRequestIds,
      criticalRequestIds: analytics.criticalBacklogRequestIds,
      unresolvedRequestIds: analytics.unresolvedReportRequestIds,
      oldestOpen: analytics.oldestOpenBacklog
    },
    latency: analytics.latency,
    retry: {
      retryable: analytics.retryableRequestIds.length,
      terminal: analytics.terminalRequestIds.length,
      averageRetryAfterMs: analytics.averageRetryAfterMs
    },
    dimensions: {
      routes: Object.keys(analytics.byRoute).sort(),
      capabilities: Object.keys(analytics.byCapability).sort(),
      providers: Object.keys(analytics.byProvider).sort()
    },
    providerSync: {
      declared: providerRegistry.declared,
      requiredContractVersion: providerRegistry.requiredContractVersion,
      availableProviders: providerRegistry.providers.filter(provider => provider.available).length,
      degradedProviders: providerRegistry.providers.filter(provider => provider.canServeDegraded).length,
      staleProviders: providerRegistry.providers.filter(provider => provider.sync.stale).length,
      saturatedProviders: providerRegistry.providers.filter(provider => !provider.capacity.acceptingNewWork).length,
      capacityBlockedRequests: analytics.providerBackpressureRequestIds.length,
      externalHandoffs: analytics.externalHandoffRequestIds.length,
      dispatchContractsIssued: analytics.dispatchContractRequestIds.length,
      providerAcksAwaiting: analytics.awaitingProviderAckRequestIds.length,
      providerAckValidationErrors: analytics.providerAckValidationRequestIds.length
    },
    providerCapacity: analytics.providerCapacity,
    clientWorkflow: {
      awaitingAck: analytics.awaitingClientAckRequestIds.length,
      warningCodes: Object.keys(analytics.clientWarningCounts).sort()
    },
    queuePolicy: {
      dependencyHeldRequests: analytics.dependencyHeldRequestIds.length,
      dependencyFailedRequests: analytics.dependencyFailedRequestIds.length,
      dependencyHandoffs: analytics.dependencyHandoffRequestIds.length,
      dependencyClientWaits: analytics.dependencyClientWaitRequestIds.length,
      operatorOverrideRequests: analytics.operatorOverrideRequestIds.length,
      capacity: analytics.queueCapacity
    },
    boundary: {
      deniedRequests: analytics.boundaryDeniedRequestIds.length,
      violationCodes: Object.keys(analytics.boundaryViolationCounts).sort(),
      scopedPermissionDeniedRequests: analytics.scopedPermissionDeniedRequestIds.length,
      permissionAuditStreams: Object.keys(analytics.scopedPermissionStreamCounts).sort()
    },
    historySnapshot: analytics.currentSnapshot,
    reportingState: analytics.reportingState,
    exportIntegrity: analytics.exportIntegrity,
    rows: analytics.exportRows,
    timelineEvents: timeline.length,
    exportReady: true
  };
}

function hasAdmissionPermission(actor) {
  return actor.roles.some(role => WRITE_ROLES.has(role)) || actor.permissions.has('scheduler:admit');
}

function hasScopedAdmissionPermission(actor) {
  return [...actor.permissions].some(permission => {
    return permission.startsWith('scheduler:route:')
      || permission.startsWith('scheduler:capability:')
      || permission.startsWith('scheduler:tenant:')
      || permission.startsWith('scheduler:workspace:');
  });
}

function hasQueueReadPermission(actor) {
  return actor.roles.some(role => READ_ROLES.has(role)) || actor.permissions.has('scheduler:read');
}

function normalizeRequiredPermission(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const permission = value.trim().toLowerCase();
  return permission.includes(':') ? permission : `${SCHEDULER_PERMISSION_PREFIX}${permission}`;
}

function normalizePermissionSubject(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function scopedPermissionCandidates(kind, value, action = 'admit') {
  const subject = normalizePermissionSubject(value);
  if (!subject) {
    return [];
  }
  return [
    `${SCHEDULER_PERMISSION_PREFIX}${kind}:${subject}`,
    `${SCHEDULER_PERMISSION_PREFIX}${kind}:${subject}:${action}`,
    `${SCHEDULER_PERMISSION_PREFIX}${kind}:*`,
    `${SCHEDULER_PERMISSION_PREFIX}${kind}:*:${action}`
  ];
}

function permissionSetHasAny(permissionSet, candidates) {
  return candidates.some(candidate => permissionSet.has(candidate));
}

function buildScopedAdmissionContract(request, context, requiredPermissions) {
  const actorPermissions = context.actor.permissions;
  const routeCandidates = scopedPermissionCandidates('route', request.route);
  const capabilityCandidates = scopedPermissionCandidates('capability', request.capability);
  const tenantCandidates = scopedPermissionCandidates('tenant', request.tenantId);
  const workspaceCandidates = scopedPermissionCandidates('workspace', request.workspaceId);
  const routeGranted = permissionSetHasAny(actorPermissions, routeCandidates);
  const capabilityGranted = permissionSetHasAny(actorPermissions, capabilityCandidates);
  const tenantGranted = permissionSetHasAny(actorPermissions, tenantCandidates);
  const workspaceGranted = permissionSetHasAny(actorPermissions, workspaceCandidates);
  const actorTenantMatches = !context.actor.tenantId || context.actor.tenantId === context.workspace.tenantId;
  const actorWorkspaceMatches = !context.actor.workspaceId || context.actor.workspaceId === context.workspace.workspaceId;
  const actorOwnsWorkspaceScope = actorTenantMatches && actorWorkspaceMatches;
  const broadAdmissionGrant = context.canAdmit === true;
  const scopedAdmissionGrant = (routeGranted || capabilityGranted) && (tenantGranted || workspaceGranted || actorOwnsWorkspaceScope);
  const routeAllowed = broadAdmissionGrant || routeGranted;
  const capabilityAllowed = broadAdmissionGrant || capabilityGranted;
  const scopeAllowed = broadAdmissionGrant || scopedAdmissionGrant;
  const deniedScopes = [];

  if (!scopeAllowed) {
    deniedScopes.push('admission-scope');
  }
  if (!routeAllowed) {
    deniedScopes.push('route-scope');
  }
  if (!capabilityAllowed) {
    deniedScopes.push('capability-scope');
  }

  return {
    schema: ADMISSION_SCOPE_SCHEMA,
    requestId: request.id,
    route: request.route,
    capability: request.capability,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    broadAdmissionGrant,
    scopedAdmissionGrant,
    routeGranted,
    capabilityGranted,
    tenantGranted,
    workspaceGranted,
    actorOwnsWorkspaceScope,
    scopeAllowed,
    routeAllowed,
    capabilityAllowed,
    deniedScopes,
    requiredPermissions,
    evaluatedPermissions: {
      route: routeCandidates,
      capability: capabilityCandidates,
      tenant: tenantCandidates,
      workspace: workspaceCandidates
    },
    audit: {
      stream: scopeAllowed && routeAllowed && capabilityAllowed
        ? 'scheduler.admission_queue.scope.allowed'
        : 'scheduler.admission_queue.scope.denied',
      handoffRequired: deniedScopes.length > 0,
      handoffCommand: deniedScopes.length
        ? 'scheduler.admission_queue.permissions.remediate'
        : 'scheduler.admission_queue.permissions.confirm'
    },
    proof: {
      broadGrantChecked: typeof broadAdmissionGrant === 'boolean',
      routeScopeEvaluated: routeCandidates.length > 0 && typeof routeGranted === 'boolean',
      capabilityScopeEvaluated: capabilityCandidates.length > 0 && typeof capabilityGranted === 'boolean',
      tenantOrWorkspaceScopeEvaluated: tenantCandidates.length > 0 && workspaceCandidates.length > 0,
      denialExplained: deniedScopes.length === 0 || deniedScopes.every(Boolean)
    }
  };
}

function buildAdmissionBoundary(request, context) {
  const requiredPermissions = [...new Set(asArray(request.requires)
    .map(normalizeRequiredPermission)
    .filter(Boolean))].sort();
  const actorRoles = [...new Set(context.actor.roles)].sort();
  const actorPermissions = [...context.actor.permissions].sort();
  const tenantScoped = request.tenantId === context.workspace.tenantId;
  const workspaceScoped = request.workspaceId === context.workspace.workspaceId;
  const hasWriterRole = actorRoles.some(role => WRITE_ROLES.has(role));
  const hasReaderRole = actorRoles.some(role => READ_ROLES.has(role));
  const missingPermissions = requiredPermissions
    .filter(permission => !context.actor.permissions.has(permission));
  const scopedAdmission = buildScopedAdmissionContract(request, context, requiredPermissions);
  const violations = [];

  if (!tenantScoped) {
    violations.push('tenant-boundary');
  }
  if (!workspaceScoped) {
    violations.push('workspace-boundary');
  }
  if (!scopedAdmission.scopeAllowed) {
    violations.push('missing-admission-permission');
  }
  if (!scopedAdmission.routeAllowed) {
    violations.push('missing-route-permission');
  }
  if (!scopedAdmission.capabilityAllowed) {
    violations.push('missing-capability-permission');
  }
  for (const permission of missingPermissions) {
    violations.push(`missing:${permission}`);
  }

  const allowed = violations.length === 0;
  return {
    schema: 'aios.scheduler.admission_queue.boundary.v1',
    requestId: request.id,
    tenantId: context.workspace.tenantId,
    workspaceId: context.workspace.workspaceId,
    requestedTenantId: request.tenantId,
    requestedWorkspaceId: request.workspaceId,
    actor: {
      id: context.actor.id,
      tenantId: context.actor.tenantId,
      workspaceId: context.actor.workspaceId,
      roles: actorRoles,
      permissions: actorPermissions
    },
    roleGrants: {
      writerRole: hasWriterRole,
      readerRole: hasReaderRole,
      explicitAdmit: context.actor.permissions.has('scheduler:admit'),
      explicitRead: context.actor.permissions.has('scheduler:read')
    },
    scopedAdmission,
    requiredPermissions,
    missingPermissions,
    isolation: {
      tenantScoped,
      workspaceScoped,
      sameActorTenant: !context.actor.tenantId || context.actor.tenantId === context.workspace.tenantId,
      sameActorWorkspace: !context.actor.workspaceId || context.actor.workspaceId === context.workspace.workspaceId
    },
    decision: {
      allowed,
      denied: !allowed,
      violations,
      disposition: allowed ? 'admit-boundary-clear' : 'deny-before-scheduler-controls',
      auditStream: allowed ? 'scheduler.admission_queue.allowed' : 'scheduler.admission_queue.denied',
      redactRequestBody: context.canRead !== true,
      handoffBlocked: !allowed
    },
    proof: {
      tenantBoundaryEnforced: tenantScoped || violations.includes('tenant-boundary'),
      workspaceBoundaryEnforced: workspaceScoped || violations.includes('workspace-boundary'),
      admissionPermissionChecked: scopedAdmission.scopeAllowed || violations.includes('missing-admission-permission'),
      routePermissionChecked: scopedAdmission.routeAllowed || violations.includes('missing-route-permission'),
      capabilityPermissionChecked: scopedAdmission.capabilityAllowed || violations.includes('missing-capability-permission'),
      requiredPermissionsChecked: missingPermissions.length === 0 || missingPermissions.every(permission => violations.includes(`missing:${permission}`)),
      readBoundaryEvaluated: typeof context.canRead === 'boolean'
    }
  };
}

function hasOperatorOverridePermission(actor) {
  return actor.roles.some(role => ['owner', 'admin', 'operator'].includes(role))
    || actor.permissions.has('scheduler:override')
    || actor.permissions.has('scheduler:admission_queue:override');
}

function normalizeOperatorOverride(raw = {}, actor, now) {
  const source = raw.operatorOverride && typeof raw.operatorOverride === 'object'
    ? raw.operatorOverride
    : raw.override && typeof raw.override === 'object'
      ? raw.override
      : {};
  const requested = source.enabled === true
    || raw.operatorOverride === true
    || raw.override === true;
  const validation = { errors: [], warnings: [] };
  const priorityBoost = Number.isFinite(source.priorityBoost)
    ? Math.max(0, Math.min(100, Math.floor(source.priorityBoost)))
    : 0;
  const priorityOverride = Number.isFinite(source.priority)
    ? Math.max(0, Math.min(100, Math.floor(source.priority)))
    : null;
  const bypassDependencies = requested && (source.bypassDependencies === true || source.releaseDependencies === true);
  const reason = normalizeId(source.reason || raw.overrideReason, null);
  const authorized = requested ? hasOperatorOverridePermission(actor) : false;

  if (requested && !authorized) {
    validation.errors.push('operator-override-permission-required');
  }
  if (requested && !reason) {
    validation.warnings.push('operator-override-reason-recommended');
  }
  if (source.priorityBoost !== undefined && !Number.isFinite(source.priorityBoost)) {
    validation.warnings.push('operator-override-priority-boost-ignored');
  }
  if (source.priority !== undefined && !Number.isFinite(source.priority)) {
    validation.warnings.push('operator-override-priority-ignored');
  }

  return {
    schema: 'aios.scheduler.admission_queue.operator_override.v1',
    requested,
    authorized,
    active: requested && authorized && validation.errors.length === 0,
    requestedBy: normalizeId(source.requestedBy || source.actorId, actor.id),
    requestedAt: normalizeId(source.requestedAt, now),
    reason,
    priorityBoost,
    priorityOverride,
    bypassDependencies,
    metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : null,
    validation
  };
}

function normalizeDependencyState(raw = {}, requestId, operatorOverride) {
  const rawDependencies = asArray(raw.dependencies || raw.dependsOn || raw.dependencyIds)
    .slice(0, MAX_DEPENDENCY_IDS);
  const completedIds = normalizeStringSet(raw.completedDependencyIds || raw.completedDependencies);
  const failedIds = normalizeStringSet(raw.failedDependencyIds || raw.failedDependencies);
  const dependencies = rawDependencies
    .map((dependency, index) => {
      const id = typeof dependency === 'string'
        ? dependency.trim()
        : normalizeId(dependency?.id || dependency?.requestId || dependency?.dependencyId, null);
      if (!id) {
        return null;
      }
      const rawStatus = typeof dependency === 'object' && dependency
        ? normalizeId(dependency.status || dependency.state, null)
        : null;
      const status = failedIds.has(id)
        ? 'failed'
        : completedIds.has(id)
          ? 'completed'
          : rawStatus
            ? rawStatus.toLowerCase()
            : 'pending';
      return { id, status, index };
    })
    .filter(Boolean);
  const validation = { errors: [], warnings: [] };
  const failureRetryLimit = normalizeNonNegativeInteger(
    raw.dependencyFailureRetryLimit ?? raw.failedDependencyRetryLimit,
    DEFAULT_DEPENDENCY_FAILURE_RETRY_LIMIT,
    MAX_RETRY_ATTEMPTS
  );
  const failureRetryAfterMs = Number.isFinite(raw.dependencyFailureRetryAfterMs ?? raw.failedDependencyRetryAfterMs)
    && (raw.dependencyFailureRetryAfterMs ?? raw.failedDependencyRetryAfterMs) >= 0
    ? Math.min(Math.floor(raw.dependencyFailureRetryAfterMs ?? raw.failedDependencyRetryAfterMs), MAX_BACKOFF_MS)
    : null;
  const duplicateIds = dependencies
    .map(dependency => dependency.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);

  if (rawDependencies.length >= MAX_DEPENDENCY_IDS && asArray(raw.dependencies || raw.dependsOn || raw.dependencyIds).length > MAX_DEPENDENCY_IDS) {
    validation.warnings.push('dependency-list-truncated');
  }
  if (dependencies.some(dependency => dependency.id === requestId)) {
    validation.errors.push('dependency-self-reference');
  }
  if (duplicateIds.length) {
    validation.warnings.push('dependency-duplicates-collapsed');
  }
  if ((raw.dependencyFailureRetryLimit ?? raw.failedDependencyRetryLimit) !== undefined
    && failureRetryLimit === DEFAULT_DEPENDENCY_FAILURE_RETRY_LIMIT) {
    validation.warnings.push('dependency-failure-retry-limit-defaulted');
  }
  if ((raw.dependencyFailureRetryAfterMs ?? raw.failedDependencyRetryAfterMs) !== undefined && failureRetryAfterMs === null) {
    validation.warnings.push('dependency-failure-retry-after-ignored');
  }

  const uniqueDependencies = [...new Map(dependencies.map(dependency => [dependency.id, dependency])).values()];
  const unresolved = uniqueDependencies.filter(dependency => !['completed', 'satisfied', 'released'].includes(dependency.status));
  const failed = uniqueDependencies.filter(dependency => ['failed', 'cancelled', 'rejected'].includes(dependency.status));
  const overrideReleased = operatorOverride.active && operatorOverride.bypassDependencies;
  const failedTerminal = !overrideReleased
    && failed.length > 0
    && failureRetryLimit > 0
    && normalizeRetryAttempt(raw.retryAttempt) >= failureRetryLimit;

  return {
    schema: 'aios.scheduler.admission_queue.dependency_state.v1',
    required: uniqueDependencies.length > 0,
    held: uniqueDependencies.length > 0 && unresolved.length > 0 && !overrideReleased,
    failed: failed.length > 0 && !overrideReleased,
    failedTerminal,
    failureRetryLimit,
    failureRetryAfterMs,
    overrideReleased,
    dependencyIds: uniqueDependencies.map(dependency => dependency.id).sort(),
    satisfiedDependencyIds: uniqueDependencies
      .filter(dependency => ['completed', 'satisfied', 'released'].includes(dependency.status))
      .map(dependency => dependency.id)
      .sort(),
    unresolvedDependencyIds: unresolved.map(dependency => dependency.id).sort(),
    failedDependencyIds: failed.map(dependency => dependency.id).sort(),
    validation
  };
}

function buildOperatorOverrideQueueMetadata(operatorOverride) {
  return {
    schema: 'aios.scheduler.admission_queue.operator_override_metadata.v1',
    requested: operatorOverride.requested,
    authorized: operatorOverride.authorized,
    active: operatorOverride.active,
    requestedBy: operatorOverride.requestedBy,
    requestedAt: operatorOverride.requestedAt,
    reason: operatorOverride.reason,
    priorityBoost: operatorOverride.priorityBoost,
    priorityOverride: operatorOverride.priorityOverride,
    bypassDependencies: operatorOverride.bypassDependencies,
    priorityEffect: operatorOverride.active
      ? operatorOverride.priorityOverride !== null
        ? 'priority-overridden'
        : operatorOverride.priorityBoost > 0
          ? 'priority-boosted'
          : 'override-audited'
      : operatorOverride.requested
        ? 'override-not-active'
        : 'none',
    dependencyEffect: operatorOverride.active && operatorOverride.bypassDependencies
      ? 'dependencies-released'
      : 'dependencies-enforced',
    validation: operatorOverride.validation
  };
}

function buildDependencyFailureState(request, context, terminal = false) {
  const dependency = request.dependencyState || {};
  const retryAfterMs = dependency.failureRetryAfterMs
    || Math.min(MAX_BACKOFF_MS, Math.max(DEFAULT_DEPENDENCY_FAILURE_BACKOFF_MS, retryDelayFor(request, context)));
  const failedDependencyIds = asArray(dependency.failedDependencyIds);
  const unresolvedDependencyIds = asArray(dependency.unresolvedDependencyIds);
  return {
    schema: 'aios.scheduler.admission_queue.dependency_failure.v1',
    terminal,
    retryable: !terminal,
    dependencyFailed: failedDependencyIds.length > 0,
    failedDependencyIds,
    unresolvedDependencyIds,
    retryAttempt: request.retryAttempt,
    retryLimit: dependency.failureRetryLimit,
    retryAfterMs: terminal ? null : retryAfterMs,
    operatorOverrideRequested: request.operatorOverride.requested,
    operatorOverrideActive: request.operatorOverride.active,
    operatorOverrideAvailable: request.operatorOverride.authorized || request.operatorOverride.requested,
    releaseCommand: 'scheduler.admission_queue.dependencies.release',
    inspectCommand: 'scheduler.admission_queue.dependencies.inspect',
    actionRequired: terminal
      ? 'inspect-failed-dependencies-before-retry'
      : request.operatorOverride.active
        ? 'release-failed-dependencies-with-operator-override'
        : 'wait-for-dependency-recovery-or-request-override',
    settingsPatch: request.operatorOverride.active
      ? {
          operatorOverride: {
            enabled: true,
            bypassDependencies: true,
            reason: request.operatorOverride.reason || 'failed-dependency-release'
          }
        }
      : null,
    proof: {
      failedDependenciesNamed: failedDependencyIds.length > 0,
      retryBounded: terminal || retryAfterMs <= MAX_BACKOFF_MS,
      terminalExplained: !terminal || request.retryAttempt >= dependency.failureRetryLimit,
      overrideReleaseRoutable: !request.operatorOverride.active || request.operatorOverride.bypassDependencies === true
    }
  };
}

function buildQueueAdmissionState(request, queueCapacity, admittedCount, contextReady = true) {
  const readyPosition = request.queueMetadata?.readyPosition || null;
  const readyAhead = readyPosition === null ? null : Math.max(0, readyPosition - 1);
  const projectedSlot = readyPosition === null ? null : queueCapacity.occupied + readyPosition;
  const capacityAvailableForPosition = readyPosition !== null
    && queueCapacity.validation.errors.length === 0
    && readyPosition <= queueCapacity.availableSlots;
  const consumedAdmissionSlot = request.queueMetadata?.ready === true && admittedCount < queueCapacity.availableSlots;
  const holdReasons = [...new Set([
    ...asArray(request.queueMetadata?.holdReasons),
    ...asArray(request.dependencyState?.validation?.errors)
  ])].sort();
  const state = !request.queueMetadata?.ready
    ? 'held'
    : !contextReady
      ? 'blocked-after-readiness'
      : capacityAvailableForPosition
        ? 'ready'
        : 'capacity-wait';

  return {
    schema: QUEUE_ADMISSION_STATE_SCHEMA,
    requestId: request.id,
    state,
    ready: request.queueMetadata?.ready === true,
    readyPosition,
    readyAhead,
    position: request.queueMetadata?.position || null,
    projectedSlot,
    capacityAvailableForPosition,
    consumedAdmissionSlot,
    availableSlotsAtEvaluation: queueCapacity.availableSlots,
    occupiedAtEvaluation: queueCapacity.occupied,
    admittedBeforeEvaluation: admittedCount,
    dependencyHeld: Boolean(request.dependencyState?.held),
    dependencyOverrideReleased: Boolean(request.dependencyState?.overrideReleased),
    holdReasons,
    operatorOverride: buildOperatorOverrideQueueMetadata(request.operatorOverride),
    proof: {
      heldRequestsHaveNoReadyPosition: request.queueMetadata?.ready || readyPosition === null,
      readyPositionBounded: readyPosition === null || readyPosition > 0,
      capacityDecisionUsesReadyPosition: !capacityAvailableForPosition || readyPosition <= queueCapacity.availableSlots,
      dependencyHoldExplained: !request.dependencyState?.held || holdReasons.includes('dependency-hold'),
      overrideMetadataAttributed: !request.operatorOverride?.requested || Boolean(request.operatorOverride.requestedBy)
    }
  };
}

function buildQueueMetadata(request, index, now) {
  const submittedMs = timestampMs(request.submittedAt);
  const effectivePriority = request.operatorOverride.active && request.operatorOverride.priorityOverride !== null
    ? request.operatorOverride.priorityOverride
    : Math.min(100, request.priority + (request.operatorOverride.active ? request.operatorOverride.priorityBoost : 0));
  const dependencyHeld = request.dependencyState.held;
  const failedDependencyHeld = request.dependencyState.failedDependencyIds.length > 0 && !request.dependencyState.overrideReleased;
  const ready = !dependencyHeld && !failedDependencyHeld && request.dependencyState.validation.errors.length === 0;
  return {
    schema: 'aios.scheduler.admission_queue.queue_metadata.v1',
    requestId: request.id,
    inputIndex: index,
    submittedAt: request.submittedAt,
    submittedMs,
    dependencyHeld,
    failedDependencyHeld,
    ready,
    readinessClass: ready
      ? request.operatorOverride.active
        ? 'operator-ready'
        : 'ready'
      : request.dependencyState.overrideReleased
        ? 'override-released'
        : 'held',
    priority: request.priority,
    effectivePriority,
    retryAttempt: request.retryAttempt,
    operatorOverrideActive: request.operatorOverride.active,
    operatorOverride: buildOperatorOverrideQueueMetadata(request.operatorOverride),
    holdReasons: [
      dependencyHeld ? 'dependency-hold' : null,
      failedDependencyHeld ? 'failed-dependency-hold' : null,
      ...request.dependencyState.validation.errors
    ].filter(Boolean),
    orderKey: {
      heldRank: ready ? 0 : 1,
      overrideRank: request.operatorOverride.active ? 0 : 1,
      priorityRank: -effectivePriority,
      retryRank: request.retryAttempt,
      submittedRank: submittedMs ?? Number.MAX_SAFE_INTEGER,
      inputRank: index
    }
  };
}

function compareQueueMetadata(left, right) {
  const a = left.queueMetadata.orderKey;
  const b = right.queueMetadata.orderKey;
  return a.heldRank - b.heldRank
    || a.overrideRank - b.overrideRank
    || a.priorityRank - b.priorityRank
    || a.retryRank - b.retryRank
    || a.submittedRank - b.submittedRank
    || a.inputRank - b.inputRank
    || left.id.localeCompare(right.id);
}

function buildAdmissionQueuePlan(requests, now) {
  const decorated = requests
    .map((request, index) => ({
      ...request,
      queueMetadata: buildQueueMetadata(request, index, now)
    }))
    .sort(compareQueueMetadata);
  const readyOrder = decorated.filter(request => request.queueMetadata.ready);
  const ordered = decorated
    .map((request, index) => ({
      ...request,
      queueMetadata: {
        ...request.queueMetadata,
        position: index + 1,
        readyPosition: request.queueMetadata.ready
          ? readyOrder.findIndex(candidate => candidate.id === request.id) + 1
          : null
      }
    }));

  return {
    schema: 'aios.scheduler.admission_queue.ordering_plan.v1',
    generatedAt: now,
    requestCount: ordered.length,
    orderedRequests: ordered,
    readyRequestIds: ordered.filter(request => request.queueMetadata.ready).map(request => request.id),
    dependencyHeldRequestIds: ordered.filter(request => request.dependencyState.held).map(request => request.id),
    dependencyFailedRequestIds: ordered.filter(request => request.dependencyState.failed).map(request => request.id),
    overrideRequestIds: ordered.filter(request => request.operatorOverride.active).map(request => request.id),
    order: ordered.map(request => ({
      requestId: request.id,
      position: request.queueMetadata.position,
      readyPosition: request.queueMetadata.readyPosition,
      ready: request.queueMetadata.ready,
      readinessClass: request.queueMetadata.readinessClass,
      effectivePriority: request.queueMetadata.effectivePriority,
      dependencyHeld: request.queueMetadata.dependencyHeld,
      failedDependencyHeld: request.queueMetadata.failedDependencyHeld,
      dependencyOverrideReleased: request.dependencyState.overrideReleased,
      operatorOverrideActive: request.queueMetadata.operatorOverrideActive,
      operatorOverrideEffect: request.queueMetadata.operatorOverride.priorityEffect,
      holdReasons: request.queueMetadata.holdReasons
    }))
  };
}

function normalizeRequest(raw, index, workspace, clientRuntime, actor, now) {
  const id = normalizeId(raw?.id, `request-${index + 1}`);
  const route = typeof raw?.route === 'string' && raw.route.trim() ? raw.route.trim() : 'kernel.task';
  const tenantId = normalizeId(raw?.tenantId, workspace.tenantId);
  const workspaceId = normalizeId(raw?.workspaceId, workspace.workspaceId);
  const priority = Number.isFinite(raw?.priority) ? Math.max(0, Math.min(100, raw.priority)) : 50;
  const capability = normalizeId(raw?.capability, 'scheduler.dispatch');
  const requestClientRuntime = mergeRequestClientRuntime(raw, clientRuntime);
  const providerRequirements = normalizeProviderRequirements(raw, requestClientRuntime);
  const operatorOverride = normalizeOperatorOverride(raw, actor, now);
  const dependencyState = normalizeDependencyState(raw, id, operatorOverride);

  return {
    id,
    tenantId,
    workspaceId,
    route,
    capability,
    priority,
    submittedAt: normalizeId(raw?.submittedAt, null),
    retryAttempt: normalizeRetryAttempt(raw?.retryAttempt),
    lastFailureCode: normalizeId(raw?.lastFailureCode || raw?.failureCode, null),
    providerId: normalizeId(raw?.providerId || raw?.preferredProviderId, null),
    providerRequirements,
    dependencyState,
    operatorOverride,
    requires: asArray(raw?.requires).filter(item => typeof item === 'string' && item.trim()),
    clientRuntime: requestClientRuntime
  };
}

function normalizeProviderRequirements(raw = {}, clientRuntime) {
  const source = raw.providerRequirements && typeof raw.providerRequirements === 'object'
    ? raw.providerRequirements
    : raw.serviceRequirements && typeof raw.serviceRequirements === 'object'
      ? raw.serviceRequirements
      : {};
  const validation = { errors: [], warnings: [] };
  const requiredResponseMode = normalizeId(source.responseMode || source.requiredResponseMode, clientRuntime.responseMode).toLowerCase();
  const requiredHandoffMode = normalizeId(source.handoffMode || source.requiredHandoffMode, null);
  const minQueueRemaining = normalizeNonNegativeInteger(source.minQueueRemaining, 0, MAX_PROVIDER_QUEUE_LIMIT);
  const minDispatchSlots = normalizeNonNegativeInteger(source.minDispatchSlots || source.minDispatchSlotsRemaining, 0, MAX_PROVIDER_IN_FLIGHT);
  const minSyncGeneration = source.minSyncGeneration === undefined
    ? null
    : normalizeNonNegativeInteger(source.minSyncGeneration, null, Number.MAX_SAFE_INTEGER);

  if (!CLIENT_RESPONSE_MODES.has(requiredResponseMode)) {
    validation.errors.push('provider-required-response-mode-invalid');
  }
  if (requiredHandoffMode && !PROVIDER_HANDOFF_MODES.has(requiredHandoffMode)) {
    validation.errors.push('provider-required-handoff-mode-invalid');
  }
  if (source.minQueueRemaining !== undefined && minQueueRemaining === 0 && source.minQueueRemaining !== 0) {
    validation.warnings.push('provider-min-queue-remaining-defaulted');
  }
  if ((source.minDispatchSlots ?? source.minDispatchSlotsRemaining) !== undefined && minDispatchSlots === 0 && (source.minDispatchSlots ?? source.minDispatchSlotsRemaining) !== 0) {
    validation.warnings.push('provider-min-dispatch-slots-defaulted');
  }
  if (source.minSyncGeneration !== undefined && minSyncGeneration === null) {
    validation.warnings.push('provider-min-sync-generation-ignored');
  }

  return {
    schema: 'aios.scheduler.admission_queue.provider_requirements.v1',
    requiredResponseMode,
    requiredServiceClass: normalizeId(source.serviceClass || source.requiredServiceClass, null),
    requireExternalHandoff: source.requireExternalHandoff === true || source.externalHandoffRequired === true,
    requiredHandoffMode,
    requireFreshSync: source.requireFreshSync === true || source.freshSyncRequired === true,
    minSyncGeneration,
    minQueueRemaining,
    minDispatchSlots,
    validation
  };
}

function decideRequest(request, context) {
  const reasons = [];
  const validation = request.validation || { errors: [], warnings: [] };
  const admissionBoundary = buildAdmissionBoundary(request, context);
  const healthRetryGuard = buildHealthRetryGuard(request, context.health);
  const queueAdmissionState = buildQueueAdmissionState(
    request,
    context.queueCapacity,
    context.admittedCount,
    context.lifecycle.acceptingNewWork && context.health.circuitOpen !== true
  );
  if (validation.errors.length) {
    return {
      status: 'rejected',
      reasons: validation.errors,
      validation,
      admissionBoundary,
      healthRetryGuard,
      queueAdmissionState,
      failureState: {
        terminal: validation.errors.includes('retry-attempts-exhausted'),
        retryable: false
      },
      error: actionableError(
        'ADMISSION_REQUEST_INVALID',
        'Admission request failed scheduler queue validation.',
        'Correct the request route, capability, tenant/workspace scope, and retry metadata before resubmitting.',
        false
      )
    };
  }
  reasons.push(...admissionBoundary.decision.violations);

  if (reasons.length) {
    return {
      status: 'rejected',
      reasons,
      validation,
      admissionBoundary,
      healthRetryGuard,
      queueAdmissionState,
      failureState: { terminal: true, retryable: false },
      error: actionableError(
        'ADMISSION_POLICY_DENIED',
        'Admission request does not satisfy tenant, workspace, or permission policy.',
        'Resubmit from the owning workspace with a scheduler role or the missing permission grants.',
        false
      )
    };
  }
  if (healthRetryGuard.terminal && !healthRetryGuard.retryableOverride) {
    return {
      status: 'rejected',
      reasons: [healthRetryGuard.terminalReason, context.health.failureCode].filter(Boolean),
      validation,
      admissionBoundary,
      healthRetryGuard,
      queueAdmissionState,
      failureState: healthFailureState(context.health, {
        terminal: true,
        retryable: false,
        lastFailureCode: request.lastFailureCode,
        retryAttempt: request.retryAttempt,
        sameFailureRetryLimit: context.health.sameFailureRetryLimit,
        terminalReason: healthRetryGuard.terminalReason
      }),
      error: actionableError(
        'ADMISSION_HEALTH_FAILURE_TERMINAL',
        'Admission retry matches a hosted-kernel failure that requires operator inspection.',
        'Inspect the hosted-kernel failure, clear or reclassify the health signal, then resubmit with a fresh retry budget.',
        false
      )
    };
  }
  if (context.lifecycle.validation.errors.length) {
    return {
      status: 'deferred',
      reasons: ['settings-invalid', ...context.lifecycle.validation.errors],
      validation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: retryDelayFor(request, context),
      failureState: {
        terminal: false,
        retryable: true,
        lifecycleState: context.lifecycle.state
      },
      error: actionableError(
        'ADMISSION_SETTINGS_INVALID',
        'Scheduler admission lifecycle settings are invalid.',
        'Correct the lifecycle command or scheduling mode before admitting hosted-kernel work.'
      )
    };
  }
  if (!context.lifecycle.acceptingNewWork) {
    let reason = 'queue-draining';
    if (context.lifecycle.scheduleMode === 'windowed' && context.lifecycle.scheduleWindow.state === 'pending') {
      reason = 'schedule-window-pending';
    } else if (context.lifecycle.scheduleMode === 'windowed' && context.lifecycle.scheduleWindow.state === 'expired') {
      reason = 'schedule-window-expired';
    } else if (context.lifecycle.state === 'disabled') {
      reason = 'queue-disabled';
    } else if (context.lifecycle.state === 'paused') {
      reason = 'queue-paused';
    }
    return {
      status: 'deferred',
      reasons: [reason, context.lifecycle.reason].filter(Boolean),
      validation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: retryDelayFor(request, context),
      failureState: {
        terminal: false,
        retryable: true,
        lifecycleState: context.lifecycle.state
      },
      error: actionableError(
        'ADMISSION_LIFECYCLE_HELD',
        'Scheduler admission queue is not accepting new hosted-kernel work.',
        'Resume or enable the queue when lifecycle controls allow new admissions.'
      )
    };
  }
  if (request.dependencyState.held) {
    if (request.dependencyState.failed) {
      const terminal = request.dependencyState.failedTerminal;
      const dependencyFailure = buildDependencyFailureState(request, context, terminal);
      return {
        status: terminal ? 'rejected' : 'deferred',
        reasons: [
          'failed-dependency-hold',
          ...request.dependencyState.failedDependencyIds.map(id => `dependency-failed:${id}`)
        ],
        validation,
        healthRetryGuard,
        queueAdmissionState,
        retryAfterMs: dependencyFailure.retryAfterMs,
        failureState: dependencyFailure,
        error: actionableError(
          terminal
            ? 'ADMISSION_DEPENDENCY_FAILED_TERMINAL'
            : 'ADMISSION_DEPENDENCY_FAILED',
          terminal
            ? 'Scheduler admission dependency failed repeatedly and requires operator inspection.'
            : 'Scheduler admission is blocked by a failed upstream dependency.',
          terminal
            ? 'Inspect or replace the failed dependency before resubmitting this request.'
            : 'Recover the failed dependency or submit an authorized operator override to release the dependency hold.',
          !terminal
        )
      };
    }
    return {
      status: 'deferred',
      reasons: ['dependency-hold', ...request.dependencyState.unresolvedDependencyIds.map(id => `dependency:${id}`)],
      validation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: retryDelayFor(request, context),
      failureState: {
        terminal: false,
        retryable: true,
        dependencyHeld: true,
        unresolvedDependencyIds: request.dependencyState.unresolvedDependencyIds,
        failedDependencyIds: request.dependencyState.failedDependencyIds,
        operatorOverrideAvailable: request.operatorOverride.requested
      },
      error: actionableError(
        'ADMISSION_DEPENDENCY_HELD',
        'Scheduler admission is waiting on unresolved request dependencies.',
        'Complete the dependency requests or submit an authorized operator override to release the hold.'
      )
    };
  }
  if (context.lifecycle.disabledRoutes.has(request.route) || context.lifecycle.disabledCapabilities.has(request.capability)) {
    return {
      status: 'deferred',
      reasons: ['scheduling-control-held'],
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: { terminal: false, retryable: true, lifecycleState: context.lifecycle.state },
      error: actionableError(
        'ADMISSION_ROUTE_HELD',
        'Request route or capability is currently held by scheduler controls.',
        'Remove the route/capability hold or retry through an enabled scheduler path.'
      )
    };
  }
  if (context.lifecycle.scheduleMode === 'manual' && !context.lifecycle.manualReleaseIds.has(request.id)) {
    return {
      status: 'deferred',
      reasons: ['manual-release-required'],
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: { terminal: false, retryable: true, lifecycleState: context.lifecycle.state },
      error: actionableError(
        'ADMISSION_MANUAL_RELEASE_REQUIRED',
        'Manual scheduling mode requires an explicit release for this request.',
        'Add the request id to manualReleaseIds or switch the queue to immediate scheduling.'
      )
    };
  }
  if (context.lifecycle.lowPriorityFloor !== null && request.priority < context.lifecycle.lowPriorityFloor) {
    return {
      status: 'deferred',
      reasons: ['below-priority-floor'],
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: { terminal: false, retryable: true, lifecycleState: context.lifecycle.state },
      error: actionableError(
        'ADMISSION_PRIORITY_HELD',
        'Request priority is below the active scheduler admission floor.',
        'Raise request priority or lower the lifecycle lowPriorityFloor setting.'
      )
    };
  }
  if (context.health.circuitOpen) {
    return {
      status: 'deferred',
      reasons: [
        'health-circuit-open',
        ...context.health.validation.errors,
        context.health.failureCode
      ].filter(Boolean),
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: healthFailureState(context.health, {
        terminal: context.health.validation.errors.length > 0,
        retryable: context.health.validation.errors.length === 0,
        breakerThreshold: context.health.breakerThreshold
      }),
      error: actionableError(
        'ADMISSION_HEALTH_CIRCUIT_OPEN',
        'Hosted-kernel admission is blocked by the scheduler health circuit.',
        'Restore the kernel health signal or clear the failure budget before retrying.',
        context.health.validation.errors.length === 0
      )
    };
  }
  if (context.health.stale && request.priority < 90) {
    return {
      status: 'deferred',
      reasons: ['health-signal-stale'],
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: healthFailureState(context.health, {
        signalAgeMs: context.health.signalAgeMs,
        heartbeatTtlMs: context.health.heartbeatTtlMs
      }),
      error: actionableError(
        'ADMISSION_HEALTH_SIGNAL_STALE',
        'Hosted-kernel health heartbeat is stale for this admission window.',
        'Refresh scheduler health or retry after heartbeat recovery confirms capacity.'
      )
    };
  }
  if (context.health.isDegraded && request.priority < context.health.degradedPriorityFloor) {
    return {
      status: 'deferred',
      reasons: ['degraded-priority-shed'],
      validation,
      healthRetryGuard,
      retryAfterMs: retryDelayFor(request, context),
      failureState: healthFailureState(context.health, {
        degradedPriorityFloor: context.health.degradedPriorityFloor
      }),
      error: actionableError(
        'ADMISSION_DEGRADED_PRIORITY_HELD',
        'Hosted kernel is in degraded mode and is shedding lower-priority admission work.',
        'Raise priority for urgent work or retry after degraded mode clears.'
      )
    };
  }
  if (!context.health.isReady) {
    const routeSaturated = context.health.saturatedRoutes.has(request.route);
    const capabilityBlocked = context.health.blockedCapabilities.has(request.capability);
    if (!context.health.isDegraded || routeSaturated || capabilityBlocked) {
      const reason = context.health.isDegraded ? 'degraded-capacity-route-blocked' : 'kernel-not-ready';
      return {
        status: 'deferred',
        reasons: [reason, context.health.failureCode].filter(Boolean),
        validation,
        healthRetryGuard,
        retryAfterMs: retryDelayFor(request, context),
        failureState: healthFailureState(context.health, {
          routeSaturated,
          capabilityBlocked
        }),
        error: actionableError(
          'ADMISSION_KERNEL_UNAVAILABLE',
          'Hosted kernel admission is temporarily unavailable for this request.',
          'Retry after the supplied backoff or route through an available scheduler capability.'
        )
      };
    }
  }
  const remainingQueueSlots = Math.max(0, context.queueCapacity.availableSlots - context.admittedCount);
  if (context.queueCapacity.validation.errors.length || !queueAdmissionState.capacityAvailableForPosition) {
    return {
      status: 'deferred',
      reasons: [
        !queueAdmissionState.capacityAvailableForPosition ? 'queue-capacity-exhausted' : null,
        ...context.queueCapacity.validation.errors
      ].filter(Boolean),
      validation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: context.queueCapacity.retryAfterMs || retryDelayFor(request, context),
      failureState: {
        terminal: false,
        retryable: true,
        queueCapacity: {
          limit: context.queueCapacity.limit,
          occupied: context.queueCapacity.occupied,
          queued: context.queueCapacity.queued,
          inFlight: context.queueCapacity.inFlight,
          reserved: context.queueCapacity.reserved,
          availableSlots: remainingQueueSlots,
          resetAt: context.queueCapacity.resetAt,
          readyPosition: queueAdmissionState.readyPosition,
          readyAhead: queueAdmissionState.readyAhead,
          projectedSlot: queueAdmissionState.projectedSlot
        }
      },
      error: actionableError(
        'ADMISSION_QUEUE_CAPACITY_EXHAUSTED',
        'Scheduler admission queue has no available capacity for this workspace.',
        'Wait for queued, in-flight, or reserved admissions to drain before retrying.'
      )
    };
  }
  const providerNegotiation = negotiateProvider(request, context.providerRegistry);
  if (!providerNegotiation.ready) {
    const providerRetryAfterMs = providerNegotiation.retryAfterMs || retryDelayFor(request, context);
    return {
      status: 'deferred',
      reasons: providerNegotiation.validation.errors,
      validation,
      providerNegotiation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: providerRetryAfterMs,
      failureState: {
        terminal: false,
        retryable: true,
        providerId: providerNegotiation.selectedProviderId,
        requestedProviderId: request.providerId,
        contractVersion: providerNegotiation.contractVersion,
        providerCapacity: providerNegotiation.providerCapacity
          ? {
              acceptingNewWork: providerNegotiation.providerCapacity.acceptingNewWork,
              saturated: providerNegotiation.providerCapacity.saturated,
              queueRemaining: providerNegotiation.providerCapacity.queueRemaining,
              dispatchSlotsRemaining: providerNegotiation.providerCapacity.dispatchSlotsRemaining
            }
          : null
      },
      error: actionableError(
        providerNegotiation.validation.errors.includes('provider-backpressure')
          ? 'ADMISSION_PROVIDER_BACKPRESSURE'
          : 'ADMISSION_PROVIDER_CONTRACT_UNAVAILABLE',
        providerNegotiation.validation.errors.includes('provider-backpressure')
          ? 'Scheduler admission provider is saturated for this route and capability.'
          : 'Scheduler admission could not negotiate a ready provider contract for this route and capability.',
        providerNegotiation.validation.errors.includes('provider-backpressure')
          ? 'Retry after provider capacity is available or route through a provider with remaining dispatch slots.'
          : 'Register, refresh, or recover the provider contract before dispatching hosted-kernel work.'
      )
    };
  }
  if (context.admittedCount >= context.queueLimit) {
    return {
      status: 'deferred',
      reasons: ['queue-limit', 'queue-capacity-exhausted'],
      validation,
      healthRetryGuard,
      queueAdmissionState,
      retryAfterMs: context.queueCapacity.retryAfterMs || retryDelayFor(request, context),
      failureState: healthFailureState(context.health, {
        queueCapacity: {
          limit: context.queueCapacity.limit,
          occupied: context.queueCapacity.occupied,
          queued: context.queueCapacity.queued,
          inFlight: context.queueCapacity.inFlight,
          reserved: context.queueCapacity.reserved,
          availableSlots: 0,
          resetAt: context.queueCapacity.resetAt
        }
      }),
      error: actionableError(
        'ADMISSION_QUEUE_LIMIT',
        'Admission queue is at its configured limit.',
        'Retry after the supplied backoff or increase queue capacity for this workspace.'
      )
    };
  }
  return {
    status: 'admitted',
    reasons: [context.health.isDegraded ? 'admitted-in-degraded-mode' : 'within-tenant-workspace-boundary'],
    validation,
    admissionBoundary,
    providerNegotiation,
    healthRetryGuard,
    queueAdmissionState,
    failureState: {
      terminal: false,
      retryable: false,
      degradedMode: context.health.isDegraded,
      kernelStatus: context.health.status,
      staleHealthSignal: context.health.stale,
      circuitOpen: context.health.circuitOpen
    }
  };
}

function buildAuditRecord({ request, decision, actor, workspace, queueCapacity, now }) {
  return {
    surfaceId,
    event: 'scheduler.admission_queue.decision',
    at: now,
    actorId: actor.id,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    requestId: request.id,
    route: request.route,
    capability: request.capability,
    queue: request.queueMetadata || null,
    queueAdmissionState: decision.queueAdmissionState || null,
    queueCapacity: queueCapacity
      ? {
          schema: queueCapacity.schema,
          limit: queueCapacity.limit,
          occupied: queueCapacity.occupied,
          queued: queueCapacity.queued,
          inFlight: queueCapacity.inFlight,
          reserved: queueCapacity.reserved,
          availableSlots: queueCapacity.availableSlots,
          full: queueCapacity.full,
          resetAt: queueCapacity.resetAt,
          validation: queueCapacity.validation
        }
      : null,
    dependencyState: request.dependencyState || null,
    dependencyHandoff: decision.dependencyHandoff
      ? {
          schema: decision.dependencyHandoff.schema,
          state: decision.dependencyHandoff.state,
          command: decision.dependencyHandoff.command,
          resumeToken: decision.dependencyHandoff.resumeToken,
          unresolvedDependencyIds: decision.dependencyHandoff.unresolvedDependencyIds,
          failedDependencyIds: decision.dependencyHandoff.failedDependencyIds,
          clientNotification: decision.dependencyHandoff.clientNotification,
          operatorAction: decision.dependencyHandoff.operatorAction,
          proof: decision.dependencyHandoff.proof
        }
      : null,
    operatorOverride: request.operatorOverride
      ? {
          schema: request.operatorOverride.schema,
          requested: request.operatorOverride.requested,
          authorized: request.operatorOverride.authorized,
          active: request.operatorOverride.active,
          requestedBy: request.operatorOverride.requestedBy,
          requestedAt: request.operatorOverride.requestedAt,
          reason: request.operatorOverride.reason,
          priorityBoost: request.operatorOverride.priorityBoost,
          priorityOverride: request.operatorOverride.priorityOverride,
          bypassDependencies: request.operatorOverride.bypassDependencies,
          validation: request.operatorOverride.validation
        }
      : null,
    providerId: decision.providerNegotiation?.selectedProviderId || null,
    providerContractVersion: decision.providerNegotiation?.contractVersion || null,
    providerCapacityState: decision.providerNegotiation?.providerCapacity
      ? {
          acceptingNewWork: decision.providerNegotiation.providerCapacity.acceptingNewWork,
          saturated: decision.providerNegotiation.providerCapacity.saturated,
          queueDepth: decision.providerNegotiation.providerCapacity.queueDepth,
          queueLimit: decision.providerNegotiation.providerCapacity.queueLimit,
          inFlight: decision.providerNegotiation.providerCapacity.inFlight,
          maxInFlight: decision.providerNegotiation.providerCapacity.maxInFlight
        }
      : null,
    providerService: decision.dispatchContract?.service || decision.providerNegotiation?.service || null,
    permissionAuditHandoff: decision.admissionBoundary?.scopedAdmission
      ? {
          schema: decision.admissionBoundary.scopedAdmission.schema,
          stream: decision.admissionBoundary.scopedAdmission.audit.stream,
          command: decision.admissionBoundary.scopedAdmission.audit.handoffCommand,
          handoffRequired: decision.admissionBoundary.scopedAdmission.audit.handoffRequired,
          deniedScopes: decision.admissionBoundary.scopedAdmission.deniedScopes,
          routeAllowed: decision.admissionBoundary.scopedAdmission.routeAllowed,
          capabilityAllowed: decision.admissionBoundary.scopedAdmission.capabilityAllowed,
          scopeAllowed: decision.admissionBoundary.scopedAdmission.scopeAllowed
        }
      : null,
    admissionBoundary: decision.admissionBoundary
      ? {
          schema: decision.admissionBoundary.schema,
          disposition: decision.admissionBoundary.decision.disposition,
          auditStream: decision.admissionBoundary.decision.auditStream,
          violations: decision.admissionBoundary.decision.violations,
          missingPermissions: decision.admissionBoundary.missingPermissions,
          tenantScoped: decision.admissionBoundary.isolation.tenantScoped,
          workspaceScoped: decision.admissionBoundary.isolation.workspaceScoped,
          redactRequestBody: decision.admissionBoundary.decision.redactRequestBody,
          scopedAdmission: decision.admissionBoundary.scopedAdmission
            ? {
                schema: decision.admissionBoundary.scopedAdmission.schema,
                scopeAllowed: decision.admissionBoundary.scopedAdmission.scopeAllowed,
                routeAllowed: decision.admissionBoundary.scopedAdmission.routeAllowed,
                capabilityAllowed: decision.admissionBoundary.scopedAdmission.capabilityAllowed,
                deniedScopes: decision.admissionBoundary.scopedAdmission.deniedScopes,
                audit: decision.admissionBoundary.scopedAdmission.audit
              }
            : null
        }
      : null,
    dispatchContractState: decision.dispatchContract?.state || null,
    dispatchToken: decision.dispatchContract?.dispatchToken || null,
    providerAcknowledgementState: decision.providerAcknowledgement?.state || null,
    providerAcknowledgement: decision.providerAcknowledgement
      ? {
          schema: decision.providerAcknowledgement.schema,
          ackRequired: decision.providerAcknowledgement.ackRequired,
          ackDeadlineMs: decision.providerAcknowledgement.ackDeadlineMs,
          receiptCommand: decision.providerAcknowledgement.receiptCommand,
          receiptKey: decision.providerAcknowledgement.receiptKey,
          validation: decision.providerAcknowledgement.validation
        }
      : null,
    externalHandoffState: decision.externalHandoff?.state || null,
    clientWorkflowState: decision.clientWorkflow?.state || null,
    clientResumeContract: decision.clientWorkflow?.resumeContract
      ? {
          schema: decision.clientWorkflow.resumeContract.schema,
          deliveryChannel: decision.clientWorkflow.resumeContract.delivery.channel,
          deliveryService: decision.clientWorkflow.deliveryService || decision.clientWorkflow.resumeContract.delivery.service || null,
          resumeCommand: decision.clientWorkflow.resumeContract.resume.command,
          clientAckRequired: decision.clientWorkflow.resumeContract.resume.clientAckRequired,
          clientAckDeadlineMs: decision.clientWorkflow.resumeContract.resume.clientAckDeadlineMs,
          readyForClient: decision.clientWorkflow.resumeContract.resume.readyForClient,
          providerReceiptKey: decision.clientWorkflow.resumeContract.resume.providerReceiptKey,
          dependency: decision.clientWorkflow.resumeContract.dependency,
          validation: decision.clientWorkflow.resumeContract.validation
        }
      : null,
    clientCorrelationId: decision.clientWorkflow?.correlationId || request.clientRuntime?.correlationId || null,
    clientResponseMode: decision.clientWorkflow?.responseMode || request.clientRuntime?.responseMode || null,
    recovery: decision.recovery || null,
    status: decision.status,
    reasons: decision.reasons,
    retryAfterMs: decision.retryAfterMs || null,
    failureState: decision.failureState || null,
    healthRetryGuard: decision.healthRetryGuard || null,
    errorCode: decision.error?.code || null,
    nextAction: decision.nextAction || null,
    lifecycleControlOperation: decision.nextAction?.controlOperation || null,
    validation: decision.validation || { errors: [], warnings: [] }
  };
}

function serializeProviderContract(provider) {
  return {
    schema: provider.schema,
    id: provider.id,
    tenantId: provider.tenantId,
    workspaceId: provider.workspaceId,
    state: provider.state,
    degraded: provider.degraded,
    routes: [...provider.routes].sort(),
    capabilities: [...provider.capabilities].sort(),
    responseModes: [...provider.responseModes].sort(),
    service: provider.service,
    supportedContractVersions: provider.supportedContractVersions,
    acceptedContractVersion: provider.acceptedContractVersion,
    externalHandoff: provider.externalHandoff,
    handoffMode: provider.handoffMode,
    handoffEndpoint: provider.externalHandoff ? provider.handoffEndpoint : null,
    handoffAckRequired: provider.handoffAckRequired,
    sync: provider.sync,
    capacity: provider.capacity,
    available: provider.available,
    canServeDegraded: provider.canServeDegraded,
    validation: provider.validation
  };
}

function buildValidationSummary({ health, lifecycle, providerRegistry, persistedState, queueCapacity, decisions }) {
  const decisionErrors = decisions.flatMap(({ request, decision }) => {
    return [
      ...asArray(decision.validation?.errors).map(code => ({
        scope: 'request',
        requestId: request.id,
        code
      })),
      ...asArray(decision.admissionBoundary?.decision?.denied
        ? decision.admissionBoundary.decision.violations
        : []).map(code => ({
        scope: 'admission-boundary',
        requestId: request.id,
        code
      })),
      ...asArray(decision.admissionBoundary?.scopedAdmission?.deniedScopes).map(code => ({
        scope: 'admission-scope',
        requestId: request.id,
        code
      })),
      ...asArray(decision.providerAcknowledgement?.validation?.errors).map(code => ({
        scope: 'provider-acknowledgement',
        requestId: request.id,
        providerId: decision.providerAcknowledgement?.providerId || null,
        code
      })),
      ...asArray(decision.clientWorkflow?.deliveryService?.validation?.errors).map(code => ({
        scope: 'client-delivery',
        requestId: request.id,
        code
      }))
    ];
  });
  const decisionWarnings = decisions.flatMap(({ request, decision }) => {
    return [
      ...asArray(decision.validation?.warnings).map(code => ({ scope: 'request', requestId: request.id, code })),
      ...asArray(decision.providerNegotiation?.validation?.warnings).map(code => ({
        scope: 'provider',
        requestId: request.id,
        providerId: decision.providerNegotiation?.selectedProviderId || null,
        code
      })),
      ...asArray(decision.providerNegotiation?.providerCapacity?.validation?.warnings).map(code => ({
        scope: 'provider-capacity',
        requestId: request.id,
        providerId: decision.providerNegotiation?.selectedProviderId || null,
        code
      })),
      ...asArray(decision.clientWorkflow?.validation?.warnings || request.clientRuntime?.validation?.warnings).map(code => ({
        scope: 'client-runtime',
        requestId: request.id,
        code
      })),
      ...asArray(decision.providerAcknowledgement?.validation?.warnings).map(code => ({
        scope: 'provider-acknowledgement',
        requestId: request.id,
        providerId: decision.providerAcknowledgement?.providerId || null,
        code
      }))
    ];
  });
  const errors = [
    ...asArray(health.validation?.errors).map(code => ({ scope: 'health', code })),
    ...asArray(lifecycle.validation?.errors).map(code => ({ scope: 'lifecycle', code })),
    ...asArray(lifecycle.controlOperation?.validation?.errors).map(code => ({
      scope: 'lifecycle-control-operation',
      code,
      command: lifecycle.controlOperation?.command || null,
      operationId: lifecycle.controlOperation?.operationId || null
    })),
    ...asArray(providerRegistry.validation?.errors).map(code => ({ scope: 'provider-registry', code })),
    ...asArray(persistedState?.validation?.errors).map(code => ({ scope: 'persisted-state', code })),
    ...asArray(queueCapacity?.validation?.errors).map(code => ({ scope: 'queue-capacity', code })),
    ...decisionErrors
  ];
  const warnings = [
    ...asArray(health.validation?.warnings).map(code => ({ scope: 'health', code })),
    ...asArray(lifecycle.validation?.warnings).map(code => ({ scope: 'lifecycle', code })),
    ...asArray(lifecycle.controlOperation?.validation?.warnings).map(code => ({
      scope: 'lifecycle-control-operation',
      code,
      command: lifecycle.controlOperation?.command || null,
      operationId: lifecycle.controlOperation?.operationId || null
    })),
    ...asArray(providerRegistry.validation?.warnings).map(code => ({ scope: 'provider-registry', code })),
    ...asArray(persistedState?.validation?.warnings).map(code => ({ scope: 'persisted-state', code })),
    ...asArray(queueCapacity?.validation?.warnings).map(code => ({ scope: 'queue-capacity', code })),
    ...decisionWarnings
  ];

  return {
    schema: 'aios.scheduler.admission_queue.validation_summary.v1',
    valid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings
  };
}

function summarizeStepValidation(request, decision) {
  const errors = [
    ...asArray(decision.validation?.errors).map(code => ({ scope: 'request', code })),
      ...asArray(decision.admissionBoundary?.decision?.violations).map(code => ({ scope: 'admission-boundary', code })),
    ...asArray(decision.admissionBoundary?.scopedAdmission?.deniedScopes).map(code => ({ scope: 'admission-scope', code })),
    ...asArray(decision.providerNegotiation?.validation?.errors).map(code => ({ scope: 'provider-negotiation', code })),
    ...asArray(decision.providerAcknowledgement?.validation?.errors).map(code => ({ scope: 'provider-acknowledgement', code })),
    ...asArray(decision.clientWorkflow?.deliveryService?.validation?.errors).map(code => ({ scope: 'client-delivery', code }))
  ];
  const warnings = [
    ...asArray(decision.validation?.warnings).map(code => ({ scope: 'request', code })),
    ...asArray(request.providerRequirements?.validation?.warnings).map(code => ({ scope: 'provider-requirements', code })),
    ...asArray(decision.providerNegotiation?.validation?.warnings).map(code => ({ scope: 'provider-negotiation', code })),
    ...asArray(decision.providerNegotiation?.providerCapacity?.validation?.warnings).map(code => ({ scope: 'provider-capacity', code })),
    ...asArray(decision.clientWorkflow?.validation?.warnings || request.clientRuntime?.validation?.warnings).map(code => ({ scope: 'client-runtime', code })),
    ...asArray(decision.providerAcknowledgement?.validation?.warnings).map(code => ({ scope: 'provider-acknowledgement', code }))
  ];

  return {
    schema: 'aios.scheduler.admission_queue.step_validation.v1',
    requestId: request.id,
    valid: errors.length === 0,
    accepted: decision.status === 'admitted',
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    proof: {
      requestValidationIncluded: Array.isArray(decision.validation?.errors) && Array.isArray(decision.validation?.warnings),
      boundaryIncluded: Boolean(decision.admissionBoundary?.decision),
      providerNegotiationIncluded: Boolean(decision.providerNegotiation?.validation),
      acknowledgementIncluded: Boolean(decision.providerAcknowledgement?.validation),
      dependencyStateIncluded: Boolean(request.dependencyState?.schema),
      operatorOverrideIncluded: Boolean(request.operatorOverride?.schema)
    }
  };
}

function buildStepReadiness(request, decision, readiness) {
  const providerCapacity = decision.providerNegotiation?.providerCapacity || null;
  const admitted = decision.status === 'admitted';
  const dispatchable = decision.dispatchContract?.state === 'dispatchable'
    || decision.dispatchContract?.recovery?.idempotentReplay === true;
  const blockers = [
    ...asArray(decision.reasons),
    ...asArray(decision.validation?.errors),
    ...asArray(decision.admissionBoundary?.scopedAdmission?.deniedScopes),
    ...asArray(decision.providerNegotiation?.requirementViolations),
    ...asArray(decision.providerAcknowledgement?.validation?.errors),
    ...asArray(decision.clientWorkflow?.deliveryService?.validation?.errors)
  ].filter(Boolean);

  return {
    schema: 'aios.scheduler.admission_queue.step_readiness.v1',
    requestId: request.id,
    state: admitted
      ? dispatchable
        ? 'dispatch-ready'
        : 'accepted-not-dispatchable'
      : decision.status === 'rejected'
        ? 'rejected'
        : 'blocked',
    accepted: admitted,
    dispatchable,
    ackRequired: Boolean(decision.providerAcknowledgement?.ackRequired || decision.clientWorkflow?.requiresClientAck),
    queueReady: decision.queueAdmissionState?.ready === true && decision.queueAdmissionState?.state !== 'capacity-wait',
    queueAdmissionState: decision.queueAdmissionState || null,
    providerReady: Boolean(decision.providerNegotiation?.ready || decision.recovery?.idempotentReplay),
    capacityReady: !providerCapacity || (providerCapacity.acceptingNewWork && providerCapacity.queueRemaining > 0 && providerCapacity.dispatchSlotsRemaining > 0),
    queueCapacityReady: !blockers.includes('queue-capacity-exhausted') && !blockers.includes('queue-limit'),
    dependencyReady: !request.dependencyState?.held,
    lifecycleReady: !blockers.some(code => typeof code === 'string' && (
      code.startsWith('queue-')
        || code.startsWith('schedule-window-')
        || code === 'manual-release-required'
        || code === 'scheduling-control-held'
        || code === 'below-priority-floor'
    )),
    healthReady: !blockers.some(code => typeof code === 'string' && (
      code.startsWith('health-')
        || code === 'kernel-not-ready'
        || code === 'degraded-priority-shed'
        || code === 'degraded-capacity-route-blocked'
    )),
    permissionReady: !blockers.some(code => typeof code === 'string' && (
      code.endsWith('-scope')
        || code === 'missing-admission-permission'
        || code === 'missing-route-permission'
        || code === 'missing-capability-permission'
    )),
    blockers: [...new Set(blockers)].sort()
  };
}

function buildAcceptanceGate({ step, validation, readiness }) {
  const failedChecks = [];
  if (!step.queueReady) failedChecks.push('queue-not-ready');
  if (!validation.valid) failedChecks.push('step-validation-errors');
  if (!step.dispatchable) failedChecks.push('dispatch-contract-not-ready');
  if (!step.providerReady) failedChecks.push('provider-not-ready');
  if (!step.capacityReady) failedChecks.push('provider-capacity-unavailable');
  if (!step.queueCapacityReady) failedChecks.push('queue-capacity-exhausted');
  if (!step.dependencyReady) {
    failedChecks.push(step.blockers.includes('failed-dependency-hold') ? 'failed-dependency-hold' : 'dependency-hold');
  }
  if (!step.lifecycleReady) failedChecks.push('lifecycle-control-blocked');
  if (!step.healthReady) failedChecks.push('health-gate-blocked');
  if (!step.permissionReady) failedChecks.push('permission-scope-blocked');

  return {
    schema: 'aios.scheduler.admission_queue.step_acceptance_gate.v1',
    requestId: step.requestId,
    acceptAllowed: failedChecks.length === 0,
    failedChecks,
    requiredBeforeAccept: failedChecks.length
      ? failedChecks
      : ['dispatch-token-present', 'provider-contract-ready', 'client-workflow-shaped'],
    proof: {
      validationChecked: validation.schema === 'aios.scheduler.admission_queue.step_validation.v1',
      readinessChecked: step.schema === 'aios.scheduler.admission_queue.step_readiness.v1',
      gateExplainsFailure: failedChecks.length === 0 || failedChecks.every(Boolean)
    }
  };
}

function buildAcceptanceExecutionSummary({ preview, readiness, validationSummary }) {
  const runnableSteps = preview.nextSteps.filter(step => step.acceptanceGate.acceptAllowed);
  const blockedSteps = preview.nextSteps.filter(step => !step.acceptanceGate.acceptAllowed);
  const warningCodes = [...new Set(preview.nextSteps.flatMap(step => [
    ...asArray(step.validation?.warnings).map(warning => warning.code || warning),
    ...asArray(step.providerAcknowledgement?.validation?.warnings),
    ...asArray(step.clientResumeContract?.proof?.deliveryServiceReady === false ? ['client-delivery-service-not-ready'] : [])
  ]).filter(Boolean))].sort();
  const errorCodes = [...new Set([
    ...asArray(validationSummary.errors).map(error => error.code || error),
    ...blockedSteps.flatMap(step => step.acceptanceGate.failedChecks)
  ].filter(Boolean))].sort();
  const operatorReviewRequestIds = preview.nextSteps
    .filter(step => step.operatorOverride?.requested || step.dependencyState?.held || step.dependencyState?.failed || step.action?.type === 'manual-release')
    .map(step => step.requestId);
  const waitingRequestIds = preview.nextSteps
    .filter(step => [
      'provider-ack',
      'client-ack',
      'dependency-hold',
      'failed-dependency-hold',
      'inspect-failed-dependencies',
      'queue-capacity',
      'provider-backpressure',
      'retry-after'
    ].includes(step.action?.type))
    .map(step => step.requestId);
  const dependencyWaits = preview.nextSteps
    .filter(step => step.dependencyHandoff?.held || step.dependencyHandoff?.failed)
    .map(step => ({
      requestId: step.requestId,
      state: step.dependencyHandoff.state,
      command: step.dependencyHandoff.command,
      resumeToken: step.dependencyHandoff.resumeToken,
      waitOnCount: step.dependencyHandoff.waitOnCount,
      clientChannel: step.dependencyHandoff.clientNotification.channel,
      operatorOverrideActive: step.dependencyHandoff.operatorOverride.active
    }));
  const dependencyFailures = preview.nextSteps
    .filter(step => step.dependencyFailure)
    .map(step => ({
      requestId: step.requestId,
      terminal: step.dependencyFailure.terminal,
      retryable: step.dependencyFailure.retryable,
      failedDependencyIds: step.dependencyFailure.failedDependencyIds,
      retryAttempt: step.dependencyFailure.retryAttempt,
      retryLimit: step.dependencyFailure.retryLimit,
      retryAfterMs: step.dependencyFailure.retryAfterMs,
      actionRequired: step.dependencyFailure.actionRequired,
      nextCommand: step.action?.command || null
    }));
  const messageCode = blockedSteps.length
    ? runnableSteps.length
      ? 'admission-preview-partially-acceptable'
      : 'admission-preview-blocked'
    : 'admission-preview-acceptable';
  const remediationItems = blockedSteps.map(step => ({
    requestId: step.requestId,
    status: step.status,
    nextActionType: step.action?.type || 'review',
    nextCommand: step.action?.command || 'scheduler.admission_queue.review',
    controlOperationId: step.action?.controlOperation?.operationId || null,
    controlOperationState: step.action?.controlOperation?.state || null,
    failedChecks: step.acceptanceGate.failedChecks,
    requiredBeforeAccept: step.acceptanceGate.requiredBeforeAccept,
    retryAfterMs: step.retryAfterMs,
    reasonCodes: step.reasons,
    settingsPatch: step.action?.settingsPatch || null
  }));

  return {
    schema: 'aios.scheduler.admission_queue.acceptance_execution_summary.v1',
    state: runnableSteps.length === preview.nextSteps.length && readiness.ready && validationSummary.valid
      ? 'ready'
      : runnableSteps.length > 0
        ? 'partial'
        : 'blocked',
    totalRequests: preview.nextSteps.length,
    runnableRequestIds: runnableSteps.map(step => step.requestId),
    blockedRequestIds: blockedSteps.map(step => step.requestId),
    waitingRequestIds,
    operatorReviewRequestIds,
    dependencyWaits,
    dependencyFailures,
    clientVisible: {
      messageCode,
      primaryCommand: blockedSteps[0]?.action?.command || 'scheduler.admission_queue.accept',
      firstBlockingRequestId: blockedSteps[0]?.requestId || null,
      firstBlockingReason: blockedSteps[0]?.reasons?.[0] || null,
      dependencyMessageCode: dependencyWaits[0]?.state || null,
      dependencyFailureCode: dependencyFailures[0]?.terminal
        ? 'dependency-failure-terminal'
        : dependencyFailures[0]
          ? 'dependency-failure-retryable'
          : null,
      retryAfterMs: blockedSteps.find(step => Number.isFinite(step.retryAfterMs))?.retryAfterMs || null
    },
    dispatchPlan: runnableSteps.map(step => ({
      requestId: step.requestId,
      providerId: step.providerId,
      dispatchState: step.dispatchContract?.state || null,
      serviceContractId: step.dispatchContract?.serviceContractId || null,
      externalHandoffRequired: step.externalHandoffRequired,
      providerAckRequired: Boolean(step.providerAcknowledgement?.ackRequired),
      clientDeliveryChannel: step.clientResumeContract?.deliveryChannel || null,
      clientReady: step.clientResumeContract?.readyForClient === true
    })),
    remediationItems,
    validationRollup: {
      valid: validationSummary.valid,
      errorCodes,
      warningCodes,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount
    },
    proof: {
      allRunnableStepsGateAllowed: runnableSteps.every(step => step.acceptanceGate.acceptAllowed),
      blockedStepsHaveRemediation: remediationItems.every(item => Boolean(item.nextCommand)),
      dependencyFailuresActionable: dependencyFailures.every(item => Boolean(item.nextCommand) && item.failedDependencyIds.length > 0),
      clientMessageExplainsState: (blockedSteps.length === 0 && messageCode === 'admission-preview-acceptable')
        || (blockedSteps.length > 0 && runnableSteps.length > 0 && messageCode === 'admission-preview-partially-acceptable')
        || (blockedSteps.length > 0 && runnableSteps.length === 0 && messageCode === 'admission-preview-blocked'),
      validationCountsSourced: Number.isInteger(validationSummary.errorCount) && Number.isInteger(validationSummary.warningCount)
    }
  };
}

function buildReadinessSummary({ health, lifecycle, providerRegistry, canAdmit, canUseScopedAdmission, canRead, counts, queueLimit, queueCapacity, queuePlan }) {
  const readyProviders = providerRegistry.providers.filter(provider => provider.available).length;
  const capacityBlockedProviders = providerRegistry.providers.filter(provider => !provider.capacity.acceptingNewWork).length;
  const capacityRemaining = Math.max(0, queueCapacity.availableSlots - counts.admitted);
  const blockers = [];

  if (!canRead) blockers.push('read-permission-required-for-preview');
  if (!canAdmit && !canUseScopedAdmission) blockers.push('admission-permission-required');
  if (!lifecycle.acceptingNewWork) blockers.push(`lifecycle-${lifecycle.state}`);
  if (lifecycle.validation.errors.length) blockers.push('lifecycle-validation-errors');
  if (health.circuitOpen) blockers.push('health-circuit-open');
  if (!health.isReady && !health.isDegraded) blockers.push('kernel-not-ready');
  if (!readyProviders) blockers.push('provider-ready-contract-required');
  if (!readyProviders && capacityBlockedProviders) blockers.push('provider-capacity-required');
  if (queuePlan?.dependencyHeldRequestIds?.length) blockers.push('dependency-holds-active');
  if (queuePlan?.dependencyFailedRequestIds?.length) blockers.push('dependency-failures-active');
  if (queueCapacity.validation.errors.length) blockers.push('queue-capacity-invalid');
  if (capacityRemaining === 0) blockers.push('queue-capacity-exhausted');

  return {
    schema: 'aios.scheduler.admission_queue.readiness.v1',
    state: blockers.length ? 'blocked' : health.isDegraded ? 'degraded-ready' : 'ready',
    ready: blockers.length === 0,
    blockers,
    capacityRemaining,
    queueLimit,
    queueCapacity: {
      schema: queueCapacity.schema,
      occupied: queueCapacity.occupied,
      queued: queueCapacity.queued,
      inFlight: queueCapacity.inFlight,
      reserved: queueCapacity.reserved,
      availableSlots: queueCapacity.availableSlots,
      full: queueCapacity.full,
      overLimit: queueCapacity.overLimit,
      resetAt: queueCapacity.resetAt,
      validation: queueCapacity.validation
    },
    acceptedThisWindow: counts.admitted,
    controls: {
      canRead,
      canAdmit,
      canUseScopedAdmission,
      lifecycleState: lifecycle.state,
      acceptingNewWork: lifecycle.acceptingNewWork,
      healthStatus: health.status,
      providerContractsReady: readyProviders,
      providerContractsDeclared: providerRegistry.declared,
      providerCapacityBlocked: capacityBlockedProviders,
      dependencyHeldRequests: queuePlan?.dependencyHeldRequestIds?.length || 0,
      dependencyFailedRequests: queuePlan?.dependencyFailedRequestIds?.length || 0,
      operatorOverrideRequests: queuePlan?.overrideRequestIds?.length || 0,
      existingQueueOccupied: queueCapacity.occupied,
      existingQueueAvailable: queueCapacity.availableSlots,
      nextControlCommand: lifecycle.controlOperation?.command || null,
      nextControlState: lifecycle.controlOperation?.state || null,
      nextControlOperationId: lifecycle.controlOperation?.operationId || null,
      controlOperationAuthorized: lifecycle.controlOperation?.writeAuthorized === true
    }
  };
}

function buildAdmissionPreview({ decisions, counts, readiness }) {
  const nextSteps = decisions.map(({ request, decision }) => ({
    request,
    decision,
    validation: summarizeStepValidation(request, decision),
    readiness: null,
    acceptanceGate: null
  })).map(item => {
    const stepReadiness = buildStepReadiness(item.request, item.decision, readiness);
    const acceptanceGate = buildAcceptanceGate({
      step: stepReadiness,
      validation: item.validation,
      readiness
    });
    return {
      requestId: item.request.id,
      status: item.decision.status,
      route: item.request.route,
      capability: item.request.capability,
      queue: item.request.queueMetadata || null,
      queueAdmissionState: item.decision.queueAdmissionState || null,
      dependencyState: item.request.dependencyState || null,
      dependencyFailure: item.decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
        ? {
            schema: item.decision.failureState.schema,
            terminal: item.decision.failureState.terminal,
            retryable: item.decision.failureState.retryable,
            failedDependencyIds: item.decision.failureState.failedDependencyIds,
            unresolvedDependencyIds: item.decision.failureState.unresolvedDependencyIds,
            retryAttempt: item.decision.failureState.retryAttempt,
            retryLimit: item.decision.failureState.retryLimit,
            retryAfterMs: item.decision.failureState.retryAfterMs,
            operatorOverrideRequested: item.decision.failureState.operatorOverrideRequested,
            operatorOverrideActive: item.decision.failureState.operatorOverrideActive,
            actionRequired: item.decision.failureState.actionRequired,
            inspectCommand: item.decision.failureState.inspectCommand,
            releaseCommand: item.decision.failureState.releaseCommand,
            proof: item.decision.failureState.proof
          }
        : null,
      dependencyHandoff: item.decision.dependencyHandoff
        ? {
            schema: item.decision.dependencyHandoff.schema,
            state: item.decision.dependencyHandoff.state,
            command: item.decision.dependencyHandoff.command,
            releaseReady: item.decision.dependencyHandoff.releaseReady,
            resumeToken: item.decision.dependencyHandoff.resumeToken,
            dependencyIds: item.decision.dependencyHandoff.dependencyIds,
            unresolvedDependencyIds: item.decision.dependencyHandoff.unresolvedDependencyIds,
            failedDependencyIds: item.decision.dependencyHandoff.failedDependencyIds,
            waitOnCount: item.decision.dependencyHandoff.waitOnCount,
            clientNotification: item.decision.dependencyHandoff.clientNotification,
            operatorOverride: item.decision.dependencyHandoff.operatorOverride,
            operatorAction: item.decision.dependencyHandoff.operatorAction,
            proof: item.decision.dependencyHandoff.proof
          }
        : null,
      operatorOverride: item.request.operatorOverride
        ? {
            schema: item.request.operatorOverride.schema,
            requested: item.request.operatorOverride.requested,
            authorized: item.request.operatorOverride.authorized,
            active: item.request.operatorOverride.active,
            requestedBy: item.request.operatorOverride.requestedBy,
            requestedAt: item.request.operatorOverride.requestedAt,
            reason: item.request.operatorOverride.reason,
            priorityBoost: item.request.operatorOverride.priorityBoost,
            priorityOverride: item.request.operatorOverride.priorityOverride,
            bypassDependencies: item.request.operatorOverride.bypassDependencies,
            validation: item.request.operatorOverride.validation
          }
        : null,
      providerId: item.decision.providerNegotiation?.selectedProviderId || null,
      admissionBoundary: item.decision.admissionBoundary
        ? {
            disposition: item.decision.admissionBoundary.decision.disposition,
            violations: item.decision.admissionBoundary.decision.violations,
            missingPermissions: item.decision.admissionBoundary.missingPermissions,
            tenantScoped: item.decision.admissionBoundary.isolation.tenantScoped,
            workspaceScoped: item.decision.admissionBoundary.isolation.workspaceScoped,
            scopedAdmission: item.decision.admissionBoundary.scopedAdmission
              ? {
                  scopeAllowed: item.decision.admissionBoundary.scopedAdmission.scopeAllowed,
                  routeAllowed: item.decision.admissionBoundary.scopedAdmission.routeAllowed,
                  capabilityAllowed: item.decision.admissionBoundary.scopedAdmission.capabilityAllowed,
                  deniedScopes: item.decision.admissionBoundary.scopedAdmission.deniedScopes,
                  auditStream: item.decision.admissionBoundary.scopedAdmission.audit.stream,
                  handoffCommand: item.decision.admissionBoundary.scopedAdmission.audit.handoffCommand
                }
              : null
          }
        : null,
      providerRequirements: item.request.providerRequirements || null,
      providerCapacity: item.decision.providerNegotiation?.providerCapacity
        ? {
            acceptingNewWork: item.decision.providerNegotiation.providerCapacity.acceptingNewWork,
            saturated: item.decision.providerNegotiation.providerCapacity.saturated,
            queueRemaining: item.decision.providerNegotiation.providerCapacity.queueRemaining,
            dispatchSlotsRemaining: item.decision.providerNegotiation.providerCapacity.dispatchSlotsRemaining
          }
        : null,
      dispatchContract: item.decision.dispatchContract
        ? {
            state: item.decision.dispatchContract.state,
            providerId: item.decision.dispatchContract.providerId,
            serviceContractId: item.decision.dispatchContract.service?.contractId || null,
            responseMode: item.decision.dispatchContract.responseMode,
            externalHandoffRequired: item.decision.dispatchContract.externalHandoffRequired,
            sync: item.decision.dispatchContract.sync,
            proof: item.decision.dispatchContract.proof
          }
        : null,
      providerAcknowledgement: item.decision.providerAcknowledgement
        ? {
            state: item.decision.providerAcknowledgement.state,
            providerId: item.decision.providerAcknowledgement.providerId,
            ackRequired: item.decision.providerAcknowledgement.ackRequired,
            ackDeadlineMs: item.decision.providerAcknowledgement.ackDeadlineMs,
            receiptCommand: item.decision.providerAcknowledgement.receiptCommand,
            receiptKey: item.decision.providerAcknowledgement.receiptKey,
            validation: item.decision.providerAcknowledgement.validation,
            proof: item.decision.providerAcknowledgement.proof
          }
        : null,
      externalHandoffRequired: Boolean(item.decision.externalHandoff?.required),
      clientWorkflowState: item.decision.clientWorkflow?.state || null,
      clientCorrelationId: item.decision.clientWorkflow?.correlationId || null,
      clientResponseMode: item.decision.clientWorkflow?.responseMode || null,
      clientResumeContract: item.decision.clientWorkflow?.resumeContract
        ? {
            state: item.decision.clientWorkflow.resumeContract.state,
            deliveryChannel: item.decision.clientWorkflow.resumeContract.delivery.channel,
            deliveryService: item.decision.clientWorkflow.deliveryService
              ? {
                  schema: item.decision.clientWorkflow.deliveryService.schema,
                  channel: item.decision.clientWorkflow.deliveryService.channel,
                  route: item.decision.clientWorkflow.deliveryService.route,
                  command: item.decision.clientWorkflow.deliveryService.command,
                  providerGateRequired: item.decision.clientWorkflow.deliveryService.providerGateRequired,
                  providerReceiptKey: item.decision.clientWorkflow.deliveryService.providerReceiptKey,
                  readyForClient: item.decision.clientWorkflow.deliveryService.readyForClient
                }
              : null,
            resumeCommand: item.decision.clientWorkflow.resumeContract.resume.command,
            clientAckRequired: item.decision.clientWorkflow.resumeContract.resume.clientAckRequired,
            clientAckDeadlineMs: item.decision.clientWorkflow.resumeContract.resume.clientAckDeadlineMs,
            readyForClient: item.decision.clientWorkflow.resumeContract.resume.readyForClient,
            dependency: item.decision.clientWorkflow.resumeContract.dependency,
            messageCode: item.decision.clientWorkflow.resumeContract.userVisible.messageCode,
            proof: item.decision.clientWorkflow.resumeContract.proof
          }
        : null,
      validation: item.validation,
      readiness: stepReadiness,
      acceptanceGate,
      healthRetryGuard: item.decision.healthRetryGuard
        ? {
            terminal: item.decision.healthRetryGuard.terminal,
            terminalReason: item.decision.healthRetryGuard.terminalReason,
            sameFailure: item.decision.healthRetryGuard.sameFailure,
            retryAttempt: item.decision.healthRetryGuard.retryAttempt,
            sameFailureRetryLimit: item.decision.healthRetryGuard.sameFailureRetryLimit,
            remainingAttemptsForSameFailure: item.decision.healthRetryGuard.remainingAttemptsForSameFailure,
            actionRequired: item.decision.healthRetryGuard.actionRequired
          }
        : null,
      action: item.decision.nextAction || null,
      retryAfterMs: item.decision.retryAfterMs || null,
      reasons: item.decision.reasons || []
    };
  });
  const firstBlockingStep = nextSteps.find(step => step.status !== 'admitted') || null;
  const acceptedSteps = nextSteps.filter(step => step.acceptanceGate.acceptAllowed);

  return {
    schema: 'aios.scheduler.admission_queue.preview.v1',
    title: readiness.ready ? 'Admission preview ready' : 'Admission preview blocked',
    outcome: counts.rejected > 0 ? 'contains-rejections' : counts.deferred > 0 ? 'requires-action' : 'ready-to-accept',
    counts: { ...counts, total: counts.admitted + counts.deferred + counts.rejected },
    firstBlockingStep,
    nextSteps,
    dispatchableRequestIds: nextSteps
      .filter(step => step.status === 'admitted')
      .map(step => step.requestId),
    retryableRequestIds: nextSteps
      .filter(step => step.retryAfterMs !== null)
      .map(step => step.requestId),
    acceptanceReadyRequestIds: acceptedSteps.map(step => step.requestId),
    validation: {
      validStepCount: nextSteps.filter(step => step.validation.valid).length,
      invalidStepCount: nextSteps.filter(step => !step.validation.valid).length,
      warningStepCount: nextSteps.filter(step => step.validation.warningCount > 0).length
    },
    readiness: {
      dispatchReadyRequestIds: nextSteps.filter(step => step.readiness.dispatchable).map(step => step.requestId),
      blockedRequestIds: nextSteps.filter(step => step.readiness.blockers.length > 0).map(step => step.requestId),
      gateFailureCodes: [...new Set(nextSteps.flatMap(step => step.acceptanceGate.failedChecks))].sort()
    }
  };
}

function buildAcceptanceContract({ now, workspace, actor, readiness, preview, validationSummary }) {
  const acceptanceGateFailures = [...new Set(preview.nextSteps.flatMap(step => step.acceptanceGate.failedChecks))].sort();
  const executionSummary = buildAcceptanceExecutionSummary({ preview, readiness, validationSummary });
  const acceptAllowed = readiness.ready
    && preview.outcome === 'ready-to-accept'
    && validationSummary.valid
    && acceptanceGateFailures.length === 0;
  const boundaryBlockedRequestIds = preview.nextSteps
    .filter(step => step.admissionBoundary?.violations?.length)
    .map(step => step.requestId);
  return {
    schema: 'aios.scheduler.admission_queue.acceptance.v1',
    issuedAt: now,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    actorId: actor.id,
    acceptAllowed,
    requiredCommand: acceptAllowed
      ? 'scheduler.admission_queue.accept'
      : preview.firstBlockingStep?.action?.command || 'scheduler.admission_queue.remediate',
    acceptanceToken: acceptAllowed
      ? `${workspace.tenantId}:${workspace.workspaceId}:${actor.id}:${preview.counts.total}:${now}`
      : null,
    acceptedRequestIds: acceptAllowed ? preview.dispatchableRequestIds : [],
    blockedRequestIds: preview.nextSteps
      .filter(step => step.status !== 'admitted')
      .map(step => step.requestId),
    acceptanceReadyRequestIds: preview.acceptanceReadyRequestIds,
    boundaryBlockedRequestIds,
    gateFailures: acceptanceGateFailures,
    executionSummary,
    perRequestGate: preview.nextSteps.map(step => ({
      requestId: step.requestId,
      acceptAllowed: step.acceptanceGate.acceptAllowed,
      failedChecks: step.acceptanceGate.failedChecks,
      requiredBeforeAccept: step.acceptanceGate.requiredBeforeAccept,
      nextCommand: step.action?.command || null,
      controlOperation: step.action?.controlOperation || null,
      settingsPatch: step.action?.settingsPatch || null
    })),
    validation: {
      valid: validationSummary.valid,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount
    },
    readinessState: readiness.state,
    proof: {
      previewGateEvaluated: preview.nextSteps.every(step => step.acceptanceGate.schema === 'aios.scheduler.admission_queue.step_acceptance_gate.v1'),
      noHiddenGateFailures: acceptAllowed === (acceptanceGateFailures.length === 0 && readiness.ready && validationSummary.valid && preview.outcome === 'ready-to-accept'),
      acceptedIdsDispatchable: !acceptAllowed || preview.dispatchableRequestIds.length === preview.counts.admitted,
      executionSummaryConsistent: executionSummary.runnableRequestIds.length === preview.acceptanceReadyRequestIds.length
        && executionSummary.blockedRequestIds.length === preview.nextSteps.length - preview.acceptanceReadyRequestIds.length
    }
  };
}

function stableRecoveryStatusForCommand(command) {
  if (command.validation?.errors?.length) {
    return 'invalid-persisted-command';
  }
  if (command.supersededBy) {
    return 'superseded-idempotency-record';
  }
  if (command.leaseExpired && !command.terminal) {
    if (PROVIDER_RECOVERY_STATES.has(command.state)) {
      return 'provider-lease-expired';
    }
    if (CLIENT_RECOVERY_STATES.has(command.state)) {
      return 'client-ack-window-expired';
    }
    return 'replay-window-expired';
  }
  if (command.terminal) {
    return command.state === 'completed'
      ? 'completed-replay'
      : `terminal-${command.state}`;
  }
  if (PROVIDER_RECOVERY_STATES.has(command.state)) {
    return command.dispatchToken ? 'resume-provider-dispatch' : 'resume-provider-dispatch-missing-token';
  }
  if (CLIENT_RECOVERY_STATES.has(command.state)) {
    return command.correlationId ? 'resume-client-ack' : 'resume-client-ack-missing-correlation';
  }
  if (command.replayableAdmission) {
    return 'admission-replay';
  }
  return 'not-replayable';
}

function buildRecoveryCommand(command, now) {
  const base = {
    schema: 'aios.scheduler.admission_queue.recovery_command.v1',
    commandId: command.id,
    requestId: command.requestId,
    idempotencyKey: command.idempotencyKey,
    state: command.state,
    status: command.restartStatus,
    issuedAt: now,
    providerId: command.providerId,
    dispatchToken: command.dispatchToken,
    correlationId: command.correlationId,
    sequence: command.sequence,
    duplicateOf: command.supersededBy || null,
    leaseExpired: command.leaseExpired,
    expiresAt: command.expiresAt
  };

  if (command.supersededBy) {
    return {
      ...base,
      command: 'scheduler.admission_queue.recovery.idempotency.confirm',
      action: 'ignore-superseded-idempotency-record',
      restartSafe: true,
      requiresOperator: false
    };
  }
  if (command.leaseExpired && !command.terminal) {
    return {
      ...base,
      command: PROVIDER_RECOVERY_STATES.has(command.state)
        ? 'scheduler.provider_contract.lease.reconcile'
        : CLIENT_RECOVERY_STATES.has(command.state)
          ? 'scheduler.admission_queue.client_ack.reconcile'
          : 'scheduler.admission_queue.recovery.inspect',
      action: PROVIDER_RECOVERY_STATES.has(command.state)
        ? 'reconcile-expired-provider-dispatch-lease'
        : CLIENT_RECOVERY_STATES.has(command.state)
          ? 'reconcile-expired-client-ack-window'
          : 'inspect-expired-replay-window',
      restartSafe: false,
      requiresOperator: true
    };
  }
  if (command.terminal) {
    return {
      ...base,
      command: 'scheduler.admission_queue.recovery.terminal.replay',
      action: command.state === 'completed' ? 'return-completed-result' : 'return-terminal-status',
      restartSafe: true,
      requiresOperator: false
    };
  }
  if (PROVIDER_RECOVERY_STATES.has(command.state)) {
    return {
      ...base,
      command: ACK_RECOVERY_STATES.has(command.state)
        ? 'scheduler.provider_contract.handoff.resume'
        : 'scheduler.provider_contract.dispatch.resume',
      action: command.dispatchToken ? 'resume-provider-work' : 'repair-missing-dispatch-token',
      restartSafe: Boolean(command.dispatchToken),
      requiresOperator: !command.dispatchToken
    };
  }
  if (CLIENT_RECOVERY_STATES.has(command.state)) {
    return {
      ...base,
      command: 'scheduler.admission_queue.client.resume',
      action: command.correlationId ? 'resume-client-workflow' : 'repair-missing-client-correlation',
      restartSafe: Boolean(command.correlationId),
      requiresOperator: !command.correlationId
    };
  }
  return {
    ...base,
    command: command.replayableAdmission
      ? 'scheduler.admission_queue.recovery.replay'
      : 'scheduler.admission_queue.recovery.inspect',
    action: command.replayableAdmission ? 'replay-admission-decision' : 'inspect-non-replayable-command',
    restartSafe: command.replayableAdmission,
    requiresOperator: !command.replayableAdmission
  };
}

function normalizePersistedCommand(raw = {}, index, workspace, now) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const tenantId = normalizeId(raw.tenantId, workspace.tenantId);
  const workspaceId = normalizeId(raw.workspaceId, workspace.workspaceId);
  const idempotencyKey = normalizeId(raw.idempotencyKey || raw.idempotency || raw.commandKey, null);
  const requestId = normalizeId(raw.requestId || raw.id, null);
  const state = normalizeId(raw.state || raw.status || raw.stage, 'unknown').toLowerCase();
  const validation = { errors: [], warnings: [] };
  const recordedAt = normalizeId(raw.recordedAt || raw.updatedAt || raw.at, null);
  const recordedMs = timestampMs(recordedAt);
  const expiresAt = normalizeId(raw.expiresAt || raw.deadlineAt || raw.leaseExpiresAt, null);
  const expiresMs = timestampMs(expiresAt);
  const nowMs = timestampMs(now);
  const commandName = normalizeId(raw.command || raw.commandName || raw.type, 'scheduler.admission_queue.accept');
  const attempt = normalizeRetryAttempt(raw.attempt || raw.retryAttempt);
  const sequence = normalizeNonNegativeInteger(raw.sequence ?? raw.generation ?? raw.version, index + 1, Number.MAX_SAFE_INTEGER);
  const leaseExpired = expiresMs !== null && nowMs !== null && expiresMs <= nowMs;

  if (tenantId !== workspace.tenantId || workspaceId !== workspace.workspaceId) {
    validation.errors.push('persisted-command-scope-mismatch');
  }
  if (!idempotencyKey && !requestId) {
    validation.errors.push('persisted-command-identity-required');
  }
  if (recordedAt && recordedMs === null) {
    validation.warnings.push('persisted-command-recorded-at-invalid');
  }
  if (expiresAt && expiresMs === null) {
    validation.warnings.push('persisted-command-expires-at-invalid');
  }
  if (expiresMs !== null && recordedMs !== null && expiresMs < recordedMs) {
    validation.warnings.push('persisted-command-expired-before-recorded');
  }
  if (leaseExpired) {
    validation.warnings.push('persisted-command-lease-expired');
  }
  if (state === 'unknown') {
    validation.warnings.push('persisted-command-state-unknown');
  }

  const command = {
    schema: 'aios.scheduler.admission_queue.persisted_command.v1',
    id: normalizeId(raw.commandId || raw.ledgerId, `persisted-command-${index + 1}`),
    tenantId,
    workspaceId,
    requestId,
    idempotencyKey,
    state,
    terminal: TERMINAL_RECOVERED_STATES.has(state),
    replayableAdmission: RECOVERED_COMMAND_STATES.has(state),
    command: commandName,
    sequence,
    attempt,
    providerId: normalizeId(raw.providerId, null),
    dispatchToken: normalizeId(raw.dispatchToken || raw.token, null),
    correlationId: normalizeId(raw.correlationId, null),
    clientWorkflowState: normalizeId(raw.clientWorkflowState || raw.workflowState, null),
    recordedAt,
    recordedMs,
    expiresAt,
    expiresMs,
    leaseExpired,
    supersededBy: null,
    idempotencyGroupKey: idempotencyKey || requestId || null,
    validation
  };
  command.restartStatus = stableRecoveryStatusForCommand(command);
  command.restartSafe = command.validation.errors.length === 0
    && (command.replayableAdmission || command.terminal)
    && (!command.leaseExpired || command.terminal)
    && !command.restartStatus.endsWith('missing-token')
    && !command.restartStatus.endsWith('missing-correlation');
  return command;
}

function persistedCommandSortRank(command) {
  return [
    command.sequence,
    command.recordedMs ?? -1,
    command.terminal ? 1 : 0,
    command.id
  ];
}

function comparePersistedCommandFreshness(left, right) {
  const a = persistedCommandSortRank(left);
  const b = persistedCommandSortRank(right);
  return b[0] - a[0]
    || b[1] - a[1]
    || b[2] - a[2]
    || b[3].localeCompare(a[3]);
}

function reconcilePersistedIdempotency(commands) {
  const groups = new Map();
  for (const command of commands) {
    if (!command.idempotencyGroupKey || command.validation.errors.length) {
      continue;
    }
    if (!groups.has(command.idempotencyGroupKey)) {
      groups.set(command.idempotencyGroupKey, []);
    }
    groups.get(command.idempotencyGroupKey).push(command);
  }

  const duplicateGroups = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) {
      continue;
    }
    const ordered = [...group].sort(comparePersistedCommandFreshness);
    const latest = ordered[0];
    const states = [...new Set(ordered.map(command => command.state))].sort();
    duplicateGroups.push({
      key,
      latestCommandId: latest.id,
      latestRequestId: latest.requestId,
      commandIds: ordered.map(command => command.id),
      requestIds: [...new Set(ordered.map(command => command.requestId).filter(Boolean))].sort(),
      states,
      stable: ordered.every(command => command.requestId === latest.requestId)
    });
    for (const command of ordered.slice(1)) {
      command.supersededBy = latest.id;
      command.restartStatus = stableRecoveryStatusForCommand(command);
      command.restartSafe = true;
    }
  }
  return duplicateGroups;
}

function normalizePersistedState(input = {}, workspace, now) {
  const raw = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.stateSnapshot && typeof input.stateSnapshot === 'object'
      ? input.stateSnapshot
      : input.recoveredState && typeof input.recoveredState === 'object'
        ? input.recoveredState
        : {};
  const validation = { errors: [], warnings: [] };
  const checkpointAt = normalizeId(raw.checkpointAt || raw.lastCheckpointAt || raw.persistedAt, null);
  const checkpointMs = timestampMs(checkpointAt);
  const nowMs = timestampMs(now);
  const generation = normalizeNonNegativeInteger(raw.generation, 0, Number.MAX_SAFE_INTEGER);
  const commands = asArray(raw.commands || raw.commandLedger || raw.idempotencyLedger)
    .slice(-MAX_RECOVERED_COMMANDS)
    .map((command, index) => normalizePersistedCommand(command, index, workspace, now))
    .filter(Boolean);
  const byRequestId = new Map();
  const byIdempotencyKey = new Map();
  const idempotencyOwners = new Map();
  const duplicateKeys = new Set();
  const recoveryCommands = [];
  const duplicateGroups = reconcilePersistedIdempotency(commands);

  if (checkpointAt && checkpointMs === null) {
    validation.errors.push('persisted-state-checkpoint-invalid');
  }
  if (raw.generation !== undefined && generation === 0 && raw.generation !== 0) {
    validation.warnings.push('persisted-state-generation-defaulted');
  }
  for (const command of commands) {
    validation.errors.push(...command.validation.errors.map(error => `${command.id}:${error}`));
    validation.warnings.push(...command.validation.warnings.map(warning => `${command.id}:${warning}`));
    if (command.idempotencyKey) {
      const owner = idempotencyOwners.get(command.idempotencyKey);
      if (owner && owner !== command.requestId) {
        duplicateKeys.add(command.idempotencyKey);
      } else {
        idempotencyOwners.set(command.idempotencyKey, command.requestId);
      }
    }
    if (!command.validation.errors.length) {
      if (command.requestId && (!byRequestId.has(command.requestId) || command.sequence >= (byRequestId.get(command.requestId).sequence ?? -1))) {
        byRequestId.set(command.requestId, command);
      }
      if (command.idempotencyKey && (!byIdempotencyKey.has(command.idempotencyKey) || command.sequence >= (byIdempotencyKey.get(command.idempotencyKey).sequence ?? -1))) {
        byIdempotencyKey.set(command.idempotencyKey, command);
      }
      recoveryCommands.push(buildRecoveryCommand(command, now));
    }
  }
  if (duplicateKeys.size) {
    validation.errors.push(...[...duplicateKeys].sort().map(key => `idempotency-key-conflict:${key}`));
  }

  const restartAgeMs = checkpointMs !== null && nowMs !== null ? Math.max(0, nowMs - checkpointMs) : null;
  const activeCommands = commands.filter(command => !command.supersededBy);
  const replayable = activeCommands.filter(command => command.replayableAdmission);
  const restartBlocked = activeCommands.filter(command => command.validation.errors.length || !command.restartSafe);
  const expiredLeases = activeCommands.filter(command => command.leaseExpired && !command.terminal);
  return {
    schema: PERSISTED_STATE_SCHEMA,
    declared: Object.keys(raw).length > 0,
    checkpointAt,
    generation,
    restartAgeMs,
    recoveredAt: now,
    commands,
    byRequestId,
    byIdempotencyKey,
    recoveryCommands,
    duplicateGroups,
    restartEpoch: `${workspace.tenantId}:${workspace.workspaceId}:${generation}:${checkpointAt || 'uncheckpointed'}`,
    statusSemantics: {
      schema: 'aios.scheduler.admission_queue.restart_status.v1',
      state: validation.errors.length
        ? 'unsafe'
        : replayable.length
          ? 'replayable'
          : commands.length
            ? 'inspect-only'
            : 'empty',
      checkpointObserved: Boolean(checkpointAt),
      checkpointAgeMs: restartAgeMs,
      latestSequence: commands.reduce((max, command) => Math.max(max, command.sequence), 0),
      replayableRequestIds: replayable.map(command => command.requestId).filter(Boolean).sort(),
      blockedCommandIds: restartBlocked.map(command => command.id).sort(),
      expiredLeaseCommandIds: expiredLeases.map(command => command.id).sort(),
      supersededCommandIds: commands.filter(command => command.supersededBy).map(command => command.id).sort(),
      duplicateIdempotencyGroups: duplicateGroups,
      recoveryCommandCount: recoveryCommands.length
    },
    summary: {
      recoveredCommands: commands.length,
      replayableAdmissions: replayable.length,
      terminalCommands: commands.filter(command => command.terminal).length,
      scopedCommands: commands.filter(command => !command.validation.errors.length).length,
      restartBlockedCommands: restartBlocked.length,
      supersededCommands: commands.filter(command => command.supersededBy).length,
      expiredLeases: expiredLeases.length,
      duplicateIdempotencyGroups: duplicateGroups.length
    },
    validation,
    restartSafe: validation.errors.length === 0 && restartBlocked.length === 0
  };
}

function recoveredCommandForRequest(request, persistedState) {
  return request.clientRuntime?.idempotencyKey
    ? persistedState.byIdempotencyKey.get(request.clientRuntime.idempotencyKey) || persistedState.byRequestId.get(request.id) || null
    : persistedState.byRequestId.get(request.id) || null;
}

function applyRecoveredCommandDecision(request, decision, recoveredCommand, now) {
  if (!recoveredCommand) {
    return decision;
  }
  decision.recovery = {
    schema: 'aios.scheduler.admission_queue.recovery_decision.v1',
    state: recoveredCommand.state,
    restartStatus: recoveredCommand.restartStatus,
    generationSafe: recoveredCommand.restartSafe,
    idempotentReplay: recoveredCommand.restartSafe,
    terminalCommand: recoveredCommand.terminal,
    commandId: recoveredCommand.id,
    idempotencyKey: recoveredCommand.idempotencyKey,
    providerId: recoveredCommand.providerId,
    dispatchToken: recoveredCommand.dispatchToken,
    correlationId: recoveredCommand.correlationId,
    recoveredAt: now
  };
  if (!recoveredCommand.restartSafe) {
    return decision;
  }
  if (recoveredCommand.terminal && recoveredCommand.state !== 'completed') {
    decision.status = 'rejected';
    decision.reasons = ['idempotent-terminal-replay', `recovered-${recoveredCommand.state}`];
    decision.retryAfterMs = null;
    decision.error = actionableError(
      'ADMISSION_RECOVERED_TERMINAL_COMMAND',
      'Admission request matched a terminal persisted scheduler command.',
      'Return the persisted terminal status to the client instead of dispatching duplicate hosted-kernel work.',
      false
    );
    decision.failureState = {
      terminal: true,
      retryable: false,
      recovered: true,
      recoveredState: recoveredCommand.state,
      restartStatus: recoveredCommand.restartStatus
    };
    return decision;
  }
  if (decision.status === 'rejected' || !recoveredCommand.replayableAdmission) {
    return decision;
  }
  decision.status = 'admitted';
  decision.reasons = ['idempotent-replay', `recovered-${recoveredCommand.state}`];
  decision.retryAfterMs = null;
  decision.error = null;
  decision.failureState = {
    terminal: false,
    retryable: false,
    recovered: true,
    recoveredState: recoveredCommand.state,
    dispatchToken: recoveredCommand.dispatchToken
  };
  return decision;
}

export function describeAdmissionQueueSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const actor = normalizeActor(input.actor);
  const workspace = normalizeWorkspace(input.workspace, actor);
  const persistedState = normalizePersistedState(input, workspace, now);
  const clientRuntime = normalizeClientRuntimeState(input, actor, workspace);
  const queueLimit = Number.isInteger(input.queueLimit) && input.queueLimit > 0 ? input.queueLimit : DEFAULT_QUEUE_LIMIT;
  const lifecycle = normalizeLifecycleSettings(input.lifecycleSettings || input.settings, now, actor);
  const effectiveQueueLimit = lifecycle.maxAdmitsPerWindow
    ? Math.min(queueLimit, lifecycle.maxAdmitsPerWindow)
    : queueLimit;
  const queueCapacity = normalizeQueueCapacity(input, effectiveQueueLimit, now);
  const health = normalizeKernelHealth(input.health || input.kernelHealth, now);
  const providerRegistry = normalizeProviderContracts(input, now, workspace);
  const requests = asArray(input.requests).map((request, index) => {
    const normalized = normalizeRequest(request, index, workspace, clientRuntime, actor, now);
    return {
      ...normalized,
      validation: validateRequest(request, normalized)
    };
  });
  const queuePlan = buildAdmissionQueuePlan(requests, now);
  const canRead = hasQueueReadPermission(actor);
  const canAdmit = hasAdmissionPermission(actor);
  const canUseScopedAdmission = hasScopedAdmissionPermission(actor);
  const context = {
    actor,
    workspace,
    queueLimit: effectiveQueueLimit,
    canAdmit,
    canRead,
    health,
    lifecycle,
    providerRegistry,
    queueCapacity,
    admittedCount: 0
  };
  const decisions = queuePlan.orderedRequests.map(request => {
    const recoveredCommand = recoveredCommandForRequest(request, persistedState);
    const decision = applyRecoveredCommandDecision(
      request,
      decideRequest(request, context),
      persistedState.restartSafe ? recoveredCommand : null,
      now
    );
    if (!decision.queueAdmissionState) {
      decision.queueAdmissionState = buildQueueAdmissionState(request, queueCapacity, context.admittedCount, decision.status === 'admitted');
    }
    if (!decision.admissionBoundary) {
      decision.admissionBoundary = buildAdmissionBoundary(request, context);
    }
    if (!decision.providerNegotiation) {
      decision.providerNegotiation = negotiateProvider(request, providerRegistry);
    }
    decision.dependencyHandoff = buildDependencyWorkflowHandoff(request, decision, now);
    decision.externalHandoff = buildExternalHandoffState(request, decision, decision.providerNegotiation, now);
    decision.dispatchContract = buildProviderDispatchContract(request, decision, decision.providerNegotiation, decision.externalHandoff, now);
    decision.providerAcknowledgement = buildProviderAcknowledgementContract(request, decision, decision.providerNegotiation, decision.externalHandoff, decision.dispatchContract, now);
    decision.clientWorkflow = buildClientWorkflowHandoff(request, decision, decision.externalHandoff, now);
    decision.nextAction = nextActionForDecision(request, decision, context);
    if (decision.status === 'admitted') {
      context.admittedCount += 1;
    }
    return { request, decision };
  });
  const visibleDecisions = canRead
    ? decisions
    : decisions.map(({ request, decision }) => ({
        request: { id: request.id, tenantId: request.tenantId, workspaceId: request.workspaceId },
        decision: decision.status === 'admitted'
          ? {
              status: 'deferred',
              reasons: ['missing-read-permission'],
              nextAction: {
                type: 'request-access',
                label: 'Request scheduler read permission',
                command: 'scheduler.admission_queue.access.request'
              }
            }
          : decision
      }));
  const counts = visibleDecisions.reduce((memo, item) => {
    memo[item.decision.status] = (memo[item.decision.status] || 0) + 1;
    return memo;
  }, { admitted: 0, deferred: 0, rejected: 0 });
  const history = normalizeHistory(input, workspace);
  const analytics = buildAnalytics(visibleDecisions, history, effectiveQueueLimit, queueCapacity, now, workspace, actor, health);
  const timeline = buildTimeline({ now, health, counts, analytics, history, providerRegistry });
  const exportSummary = buildExportSummary({ now, workspace, actor, counts, analytics, timeline, providerRegistry });
  const validationSummary = buildValidationSummary({ health, lifecycle, providerRegistry, persistedState, queueCapacity, decisions: visibleDecisions });
  const readiness = buildReadinessSummary({
    health,
    lifecycle,
    providerRegistry,
    canAdmit,
    canUseScopedAdmission,
    canRead,
    counts,
    queueLimit: effectiveQueueLimit,
    queueCapacity,
    queuePlan
  });
  const preview = buildAdmissionPreview({ decisions: visibleDecisions, counts, readiness });
  const acceptance = buildAcceptanceContract({ now, workspace, actor, readiness, preview, validationSummary });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      input: {
        actor: '{ id, tenantId, workspaceId, roles[], permissions[] }',
        workspace: '{ tenantId, workspaceId }',
        client: '{ clientId, sessionId, correlationId, idempotencyKey, responseMode, returnRoute, callbackCommand, requestAck }',
        health: '{ status, failureCode, retryAfterMs, observedAt, heartbeatTtlMs, consecutiveFailures, failureBudgetRemaining, circuitOpen, degradedPriorityFloor, sameFailureRetryLimit, nonRetryableFailureCodes[], retryableFailureCodes[], saturatedRoutes[], blockedCapabilities[] }',
        providerContracts: '[{ id, tenantId, workspaceId, state, routes[], capabilities[], responseModes[], serviceClass, serviceNamespace, supportedContractVersions[], externalHandoff, handoff, sync, capacity: { queueDepth, queueLimit, inFlight, maxInFlight, retryAfterMs, resetAt } }]',
        persistedState: '{ checkpointAt, generation, commandLedger[]/idempotencyLedger[] with requestId, idempotencyKey, state, providerId, dispatchToken, correlationId }',
        requests: '[{ id, tenantId, workspaceId, route, capability, priority, dependencies/dependsOn[], completedDependencyIds[], operatorOverride, retryAttempt, lastFailureCode, providerId, providerRequirements, requires[], clientState }]',
        history: '[{ id, at, tenantId, workspaceId, healthStatus, queueLimit, counts, exported }]',
        lifecycleSettings: '{ enabled, command, scheduleMode, scheduleWindow, maxAdmitsPerWindow, disabledRoutes[], disabledCapabilities[], manualReleaseIds[], lowPriorityFloor, controlIntent/controlCommand, reason }',
        queueLimit: 'positive integer; defaults to hosted-kernel queue limit',
        queueState: '{ queued/currentDepth, inFlight, reserved, retryAfterMs, resetAt } for existing admission queue occupancy'
      },
        output: {
        decisions: '[{ request: { ...request, queueMetadata, dependencyState, operatorOverride }, decision: { status, reasons[], retryAfterMs, validation, providerNegotiation, dispatchContract, providerAcknowledgement, externalHandoff, healthRetryGuard, failureState, error, nextAction } }]',
        preview: 'user-visible admission preview with dispatchable ids, blocking step, and per-request next actions',
        acceptance: 'acceptance command contract and token for clients/routes when the preview is ready',
        readiness: 'queue readiness state with blockers, capacity, and control signals',
        healthRetryGuard: 'per-request retry guard for repeated hosted-kernel failure codes and terminal health failure classifications',
        validationSummary: 'flattened health/lifecycle/provider/request validation errors and warnings',
        providerRegistry: 'normalized provider/service contracts with sync freshness, capacity/backpressure, and capability negotiation readiness',
        persistedState: 'restart recovery contract with scoped idempotency ledger, replayable command lookup, checkpoint status, restart epoch, and concrete recovery commands',
        dispatchContract: 'per-admitted-request provider dispatch envelope with service contract, sync cursor/generation, reservation proof, and handoff endpoint',
        providerAcknowledgement: 'per-dispatch provider receipt obligation with ack command, deadline, correlation key, handoff sync metadata, validation, and proof',
        analytics: '{ statusCounters, reasonCounts, actionTypeCounts, byRoute, byCapability, byProvider, backlogAgeCounts, reportBucketCounts, latency, exportRows, exportIntegrity, currentSnapshot, reportingState, historyDelta }',
        reporting: 'export-ready analytics rows, backlog aging counters, current history snapshot, export integrity metadata, and reporting state for admission dashboards',
        clientRuntime: 'normalized client/session/correlation/idempotency contract and per-request workflow handoff state',
        lifecycle: 'effective enable/disable/pause/drain/manual scheduling controls, command options, next-action state, executable control operation, and validation',
        queueCapacity: 'effective admission queue occupancy, available slots, reset metadata, and capacity validation',
        exportSummary: 'schema-stamped admission queue analytics summary for downstream reporting',
        timeline: 'ordered history snapshots plus current admission window state',
        auditHandoff: 'append-only decision records for scheduler audit streams',
        admissionBoundary: 'per-request tenant/workspace/role/permission boundary contract with denial disposition and audit stream routing',
        admissionScope: 'per-request route/capability/tenant/workspace scoped grant contract with permission audit handoff routing',
        clientWorkflow: 'client-visible resume/ack handoff per request with correlation, idempotency keys, delivery service route, and provider-gated readiness',
        dependencyHandoff: 'per-request dependency wait/release workflow with client notification route, resume token, and operator override action metadata',
        proof: 'tenant/workspace isolation, permission-boundary, health, and retry/backoff summary'
      }
    },
    workspace,
    actor: {
      id: actor.id,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      roles: actor.roles,
      permissions: [...actor.permissions].sort()
    },
    permissions: {
      canRead,
      canAdmit,
      canUseScopedAdmission,
      writeRoles: [...WRITE_ROLES].sort(),
      readRoles: [...READ_ROLES].sort(),
      scopedGrantPatterns: [
        'scheduler:route:<route>',
        'scheduler:route:<route>:admit',
        'scheduler:capability:<capability>',
        'scheduler:capability:<capability>:admit',
        'scheduler:tenant:<tenantId>:admit',
        'scheduler:workspace:<workspaceId>:admit'
      ]
    },
    admissionBoundary: {
      schema: 'aios.scheduler.admission_queue.boundary_summary.v1',
      tenantId: workspace.tenantId,
      workspaceId: workspace.workspaceId,
      deniedRequests: analytics.boundaryDeniedRequestIds,
      violationCounts: analytics.boundaryViolationCounts,
      scopedPermissionDeniedRequests: analytics.scopedPermissionDeniedRequestIds,
      scopedPermissionStreamCounts: analytics.scopedPermissionStreamCounts,
      auditStreams: [...new Set(decisions
        .map(item => item.decision.admissionBoundary?.decision?.auditStream)
        .filter(Boolean))].sort(),
      permissionAuditStreams: [...new Set(decisions
        .map(item => item.decision.admissionBoundary?.scopedAdmission?.audit?.stream)
        .filter(Boolean))].sort(),
      redactionRequired: !canRead
    },
    clientRuntime: {
      schema: clientRuntime.schema,
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      correlationId: clientRuntime.correlationId,
      idempotencyKey: clientRuntime.idempotencyKey,
      responseMode: clientRuntime.responseMode,
      returnRoute: clientRuntime.returnRoute,
      callbackCommand: clientRuntime.callbackCommand,
      requestAck: clientRuntime.requestAck,
      validation: clientRuntime.validation
    },
    health: {
      status: health.status,
      ready: health.isReady,
      degraded: health.isDegraded,
      failureCode: health.failureCode,
      retryAfterMs: health.retryAfterMs,
      observedAt: health.observedAt,
      heartbeatTtlMs: health.heartbeatTtlMs,
      signalAgeMs: health.signalAgeMs,
      stale: health.stale,
      consecutiveFailures: health.consecutiveFailures,
      failureBudgetRemaining: health.failureBudgetRemaining,
      breakerThreshold: health.breakerThreshold,
      circuitOpen: health.circuitOpen,
      degradedPriorityFloor: health.degradedPriorityFloor,
      sameFailureRetryLimit: health.sameFailureRetryLimit,
      nonRetryableFailureCodes: [...health.nonRetryableFailureCodes].sort(),
      retryableFailureCodes: [...health.retryableFailureCodes].sort(),
      terminalFailure: health.terminalFailure,
      saturatedRoutes: [...health.saturatedRoutes].sort(),
      blockedCapabilities: [...health.blockedCapabilities].sort(),
      validation: health.validation,
      operationalMode: health.circuitOpen
        ? 'circuit-open'
        : health.isDegraded
          ? 'degraded'
          : health.stale
            ? 'stale-signal'
            : health.isReady
              ? 'ready'
              : 'unavailable'
    },
    providerRegistry: {
      schema: providerRegistry.schema,
      requiredContractVersion: providerRegistry.requiredContractVersion,
      declared: providerRegistry.declared,
      providers: providerRegistry.providers.map(serializeProviderContract),
      validation: providerRegistry.validation,
      summary: {
        total: providerRegistry.providers.length,
        available: providerRegistry.providers.filter(provider => provider.available).length,
        degraded: providerRegistry.providers.filter(provider => provider.canServeDegraded).length,
        externalHandoffCapable: providerRegistry.providers.filter(provider => provider.externalHandoff).length,
        staleSync: providerRegistry.providers.filter(provider => provider.sync.stale).length,
        capacityBlocked: providerRegistry.providers.filter(provider => !provider.capacity.acceptingNewWork).length,
        queueRemaining: providerRegistry.providers.reduce((total, provider) => total + provider.capacity.queueRemaining, 0),
        dispatchSlotsRemaining: providerRegistry.providers.reduce((total, provider) => total + provider.capacity.dispatchSlotsRemaining, 0)
      }
    },
    persistedState: {
      schema: persistedState.schema,
      declared: persistedState.declared,
      checkpointAt: persistedState.checkpointAt,
      generation: persistedState.generation,
      restartEpoch: persistedState.restartEpoch,
      restartAgeMs: persistedState.restartAgeMs,
      recoveredAt: persistedState.recoveredAt,
      restartSafe: persistedState.restartSafe,
      statusSemantics: persistedState.statusSemantics,
      summary: persistedState.summary,
      validation: persistedState.validation,
      commands: persistedState.commands.map(command => ({
        schema: command.schema,
        id: command.id,
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        state: command.state,
        terminal: command.terminal,
        replayableAdmission: command.replayableAdmission,
        command: command.command,
        sequence: command.sequence,
        attempt: command.attempt,
        restartStatus: command.restartStatus,
        restartSafe: command.restartSafe,
        providerId: command.providerId,
        dispatchToken: command.dispatchToken,
        correlationId: command.correlationId,
        clientWorkflowState: command.clientWorkflowState,
        recordedAt: command.recordedAt,
        expiresAt: command.expiresAt,
        leaseExpired: command.leaseExpired,
        supersededBy: command.supersededBy,
        idempotencyGroupKey: command.idempotencyGroupKey,
        validation: command.validation
      })),
      recoveryCommands: persistedState.recoveryCommands
    },
    lifecycle: {
      schema: lifecycle.schema,
      command: lifecycle.command,
      enabled: lifecycle.enabled,
      scheduleMode: lifecycle.scheduleMode,
      state: lifecycle.state,
      acceptingNewWork: lifecycle.acceptingNewWork,
        maxAdmitsPerWindow: lifecycle.maxAdmitsPerWindow,
        effectiveQueueLimit,
        lowPriorityFloor: lifecycle.lowPriorityFloor,
        scheduleWindow: lifecycle.scheduleWindow,
        controlIntent: lifecycle.controlIntent,
        disabledRoutes: [...lifecycle.disabledRoutes].sort(),
        disabledCapabilities: [...lifecycle.disabledCapabilities].sort(),
        manualReleaseIds: [...lifecycle.manualReleaseIds].sort(),
        commandResult: lifecycle.commandResult,
        controlPlane: lifecycle.controlPlane,
        controlOperation: lifecycle.controlOperation,
        manualReleaseRequired: lifecycle.manualReleaseRequired,
        controlSummary: lifecycle.controlSummary,
        reason: lifecycle.reason,
        validation: lifecycle.validation
      },
    queue: {
      limit: effectiveQueueLimit,
      configuredLimit: queueLimit,
      capacity: {
        schema: queueCapacity.schema,
        limit: queueCapacity.limit,
        queued: queueCapacity.queued,
        inFlight: queueCapacity.inFlight,
        reserved: queueCapacity.reserved,
        occupied: queueCapacity.occupied,
        availableSlots: queueCapacity.availableSlots,
        full: queueCapacity.full,
        overLimit: queueCapacity.overLimit,
        acceptingNewWork: queueCapacity.acceptingNewWork,
        retryAfterMs: queueCapacity.retryAfterMs,
        resetAt: queueCapacity.resetAt,
        resetInMs: queueCapacity.resetInMs,
        validation: queueCapacity.validation,
        proof: queueCapacity.proof
      },
      orderingPlan: {
        schema: queuePlan.schema,
        generatedAt: queuePlan.generatedAt,
        requestCount: queuePlan.requestCount,
        readyRequestIds: queuePlan.readyRequestIds,
        dependencyHeldRequestIds: queuePlan.dependencyHeldRequestIds,
        dependencyFailedRequestIds: queuePlan.dependencyFailedRequestIds,
        overrideRequestIds: queuePlan.overrideRequestIds,
        order: queuePlan.order
      },
      admissionStates: visibleDecisions.map(({ request, decision }) => ({
        requestId: request.id,
        state: decision.queueAdmissionState?.state || null,
        ready: decision.queueAdmissionState?.ready === true,
        readyPosition: decision.queueAdmissionState?.readyPosition || null,
        capacityAvailableForPosition: decision.queueAdmissionState?.capacityAvailableForPosition === true,
        dependencyHeld: decision.queueAdmissionState?.dependencyHeld === true,
        dependencyFailed: request.dependencyState?.failed === true,
        dependencyOverrideReleased: decision.queueAdmissionState?.dependencyOverrideReleased === true,
        operatorOverrideEffect: decision.queueAdmissionState?.operatorOverride?.priorityEffect || null
      })),
      dependencyHandoffs: visibleDecisions.map(({ request, decision }) => ({
        requestId: request.id,
        state: decision.dependencyHandoff?.state || null,
        command: decision.dependencyHandoff?.command || null,
        releaseReady: decision.dependencyHandoff?.releaseReady === true,
        held: decision.dependencyHandoff?.held === true,
        failed: decision.dependencyHandoff?.failed === true,
        failureTerminal: decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
          ? decision.failureState.terminal
          : false,
        failureRetryAfterMs: decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
          ? decision.failureState.retryAfterMs
          : null,
        waitOnCount: decision.dependencyHandoff?.waitOnCount || 0,
        clientChannel: decision.dependencyHandoff?.clientNotification?.channel || null,
        clientRoute: decision.dependencyHandoff?.clientNotification?.route || null,
        clientMessageCode: decision.dependencyHandoff?.clientNotification?.messageCode || null,
        operatorOverrideEffect: decision.dependencyHandoff?.operatorOverride?.priorityEffect || null,
        operatorDependencyEffect: decision.dependencyHandoff?.operatorOverride?.dependencyEffect || null
      })),
      counts,
      decisions: visibleDecisions
    },
    preview,
    acceptance,
    readiness,
    validationSummary,
    analytics,
    reporting: {
      schema: 'aios.scheduler.admission_queue.reporting.v1',
      generatedAt: now,
      state: analytics.reportingState,
      counters: {
        status: analytics.statusCounters,
        topReasons: analytics.topReasons,
        topActions: analytics.topActions
      },
      latency: analytics.latency,
      backlog: {
        ageBuckets: analytics.backlogAgeCounts,
        reportBuckets: analytics.reportBucketCounts,
        staleRequestIds: analytics.staleBacklogRequestIds,
        criticalRequestIds: analytics.criticalBacklogRequestIds,
        unresolvedRequestIds: analytics.unresolvedReportRequestIds,
        oldestOpen: analytics.oldestOpenBacklog
      },
      currentSnapshot: analytics.currentSnapshot,
      exportIntegrity: analytics.exportIntegrity,
      exportRows: analytics.exportRows
    },
    history,
    timeline,
    exportSummary,
    auditHandoff: visibleDecisions.map(item => buildAuditRecord({
      request: item.request,
      decision: item.decision,
      actor,
      workspace,
      queueCapacity,
      now
    })),
    proof: {
      tenantIsolated: decisions.every(item => item.request.tenantId === workspace.tenantId || item.decision.status === 'rejected'),
      workspaceScoped: decisions.every(item => item.request.workspaceId === workspace.workspaceId || item.decision.status === 'rejected'),
      deniedWithoutAdmissionPermission: !canAdmit && decisions.every(item => item.decision.status === 'rejected'),
      redactedWithoutReadPermission: !canRead,
      healthGated: health.isReady || decisions.every(item => {
        return item.decision.status !== 'admitted'
          || health.isDegraded
          || item.decision.recovery?.idempotentReplay === true;
      }),
      healthCircuitApplied: !health.circuitOpen || decisions.every(item => {
        return item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      staleHealthBackpressureApplied: !health.stale || decisions.every(item => {
        return item.request.priority >= 90
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      degradedPrioritySheddingApplied: !health.isDegraded || decisions.every(item => {
        return item.request.priority >= health.degradedPriorityFloor
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      healthValidationSurfaced: Array.isArray(health.validation.errors) && Array.isArray(health.validation.warnings),
      retryBackoffBounded: decisions.every(item => !item.decision.retryAfterMs || item.decision.retryAfterMs <= MAX_BACKOFF_MS),
      terminalHealthFailuresRejected: decisions.every(item => {
        if (!item.decision.healthRetryGuard?.terminal || item.decision.healthRetryGuard?.retryableOverride) {
          return true;
        }
        return item.decision.status === 'rejected'
          && item.decision.error?.code === 'ADMISSION_HEALTH_FAILURE_TERMINAL'
          && item.decision.nextAction?.type === 'inspect-health-failure'
          && item.decision.failureState?.terminal === true;
      }),
      healthRetryGuardAttached: decisions.every(item => {
        return item.decision.healthRetryGuard?.schema === 'aios.scheduler.admission_queue.health_retry_guard.v1'
          && item.decision.healthRetryGuard.requestId === item.request.id
          && Number.isInteger(item.decision.healthRetryGuard.sameFailureRetryLimit);
      }),
      analyticsExportReady: exportSummary.exportReady && exportSummary.schema === 'aios.scheduler.admission_queue.analytics.v1',
      analyticsCountersConsistent: analytics.statusCounters.total === visibleDecisions.length
        && analytics.statusCounters.admitted === counts.admitted
        && analytics.statusCounters.deferred === counts.deferred
        && analytics.statusCounters.rejected === counts.rejected,
      analyticsRowsExportable: analytics.exportRows.length === visibleDecisions.length
        && analytics.exportRows.every(row => row.schema === 'aios.scheduler.admission_queue.analytics_row.v1' && row.generatedAt === now),
      analyticsBacklogClassified: analytics.exportRows.every(row => Boolean(row.backlogAgeClass) && Boolean(row.reportBucket))
        && analytics.exportIntegrity.complete === (analytics.exportIntegrity.rowCount === visibleDecisions.length)
        && analytics.reportingState.exportBatchId === analytics.exportIntegrity.batchId
        && analytics.reportingState.exportChecksum === analytics.exportIntegrity.checksum,
      reportingSnapshotCurrent: analytics.currentSnapshot.schema === 'aios.scheduler.admission_queue.history_snapshot.v1'
        && analytics.currentSnapshot.at === now
        && analytics.currentSnapshot.counts.total === visibleDecisions.length
        && analytics.reportingState.snapshotId === analytics.currentSnapshot.id,
      lifecycleSettingsValid: lifecycle.validation.errors.length === 0,
      lifecycleCommandAudited: lifecycle.commandResult.schema === 'aios.scheduler.admission_queue.lifecycle_command_result.v1'
        && lifecycle.commandResult.command === lifecycle.command,
      lifecycleControlPlaneAttached: lifecycle.controlPlane.schema === 'aios.scheduler.admission_queue.lifecycle_control_plane.v1'
        && Array.isArray(lifecycle.controlPlane.commands)
        && lifecycle.controlPlane.proof.commandsKnown === true
        && Boolean(lifecycle.controlPlane.nextActionState?.type),
      lifecycleControlOperationAttached: lifecycle.controlOperation.schema === LIFECYCLE_CONTROL_OPERATION_SCHEMA
        && lifecycle.controlOperation.issuedAt === now
        && lifecycle.controlOperation.proof.commandKnown === true
        && lifecycle.controlSummary.nextControlOperationId === lifecycle.controlOperation.operationId,
      lifecycleControlIntentAudited: lifecycle.controlIntent.schema === 'aios.scheduler.admission_queue.lifecycle_control_intent.v1'
        && lifecycle.controlIntent.requestedAt === now
        && lifecycle.controlIntent.proof.actorAttributed === true
        && lifecycle.controlPlane.proof.requestedControlValidated === (lifecycle.controlIntent.validation.errors.length === 0
          && lifecycle.controlIntent.proof.commandKnown
          && lifecycle.controlIntent.proof.patchGenerated),
      lifecycleNextActionExplained: lifecycle.acceptingNewWork
        || lifecycle.controlPlane.blockers.length > 0
        || lifecycle.controlPlane.nextActionState.type === 'none',
      persistedStateShaped: persistedState.schema === PERSISTED_STATE_SCHEMA
        && Array.isArray(persistedState.commands)
        && Array.isArray(persistedState.recoveryCommands)
        && persistedState.statusSemantics?.schema === 'aios.scheduler.admission_queue.restart_status.v1'
        && Boolean(persistedState.restartEpoch)
        && Number.isInteger(persistedState.summary.recoveredCommands),
      persistedStateRestartSafe: !persistedState.declared || persistedState.restartSafe === (persistedState.validation.errors.length === 0
        && persistedState.statusSemantics.blockedCommandIds.length === 0),
      persistedRecoveryCommandsActionable: persistedState.recoveryCommands.every(command => {
        return command.schema === 'aios.scheduler.admission_queue.recovery_command.v1'
          && Boolean(command.command)
          && Boolean(command.action)
          && command.issuedAt === now;
      }),
      idempotentRecoveryApplied: decisions.every(item => {
        const recovered = recoveredCommandForRequest(item.request, persistedState);
        if (!persistedState.restartSafe || !recovered?.restartSafe || item.decision.status === 'rejected') {
          return true;
        }
        return item.decision.recovery?.idempotentReplay === true
          && item.decision.reasons?.includes('idempotent-replay')
          && item.decision.retryAfterMs === null;
      }),
      readinessContractAttached: readiness.schema === 'aios.scheduler.admission_queue.readiness.v1'
        && Number.isInteger(readiness.capacityRemaining)
        && Array.isArray(readiness.blockers),
      previewContractAttached: preview.schema === 'aios.scheduler.admission_queue.preview.v1'
        && Array.isArray(preview.nextSteps)
        && preview.nextSteps.every(step => Boolean(step.requestId) && Boolean(step.status)),
      acceptanceContractConsistent: acceptance.schema === 'aios.scheduler.admission_queue.acceptance.v1'
        && acceptance.acceptAllowed === (readiness.ready
          && preview.outcome === 'ready-to-accept'
          && validationSummary.valid
          && acceptance.gateFailures.length === 0)
        && Array.isArray(acceptance.blockedRequestIds),
      queueOrderingApplied: queuePlan.schema === 'aios.scheduler.admission_queue.ordering_plan.v1'
        && queuePlan.orderedRequests.length === requests.length
        && decisions.every((item, index) => item.request.queueMetadata?.position === index + 1),
      queueAdmissionStatesAttached: decisions.every(item => {
        return item.decision.queueAdmissionState?.schema === QUEUE_ADMISSION_STATE_SCHEMA
          && item.decision.queueAdmissionState.requestId === item.request.id
          && item.decision.queueAdmissionState.proof?.capacityDecisionUsesReadyPosition === true;
      }),
      queueCapacityContractAttached: queueCapacity.schema === QUEUE_CAPACITY_SCHEMA
        && queueCapacity.limit === effectiveQueueLimit
        && queueCapacity.proof.availableSlotsDerived === true
        && readiness.queueCapacity?.availableSlots === queueCapacity.availableSlots
        && analytics.queueCapacity?.availableSlots === queueCapacity.availableSlots,
      queueCapacityGateApplied: queueCapacity.validation.errors.length
        ? decisions.every(item => item.decision.status !== 'admitted' || item.decision.recovery?.idempotentReplay === true)
        : decisions.filter(item => item.decision.status === 'admitted' && item.decision.recovery?.idempotentReplay !== true).length <= queueCapacity.availableSlots,
      queueCapacityActionable: decisions.every(item => {
        if (!item.decision.reasons?.includes('queue-capacity-exhausted')) {
          return true;
        }
        return item.decision.nextAction?.type === 'queue-capacity'
          && item.decision.error?.code === 'ADMISSION_QUEUE_CAPACITY_EXHAUSTED'
          && Number.isFinite(item.decision.retryAfterMs);
      }),
      dependencyHoldsApplied: decisions.every(item => {
        return !item.request.dependencyState?.held
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      dependencyFailuresActionable: decisions.every(item => {
        if (!item.request.dependencyState?.failed) {
          return true;
        }
        return item.decision.status !== 'admitted'
          && item.decision.failureState?.schema === 'aios.scheduler.admission_queue.dependency_failure.v1'
          && item.decision.nextAction?.command?.startsWith('scheduler.admission_queue.dependencies.')
          && item.decision.error?.code?.startsWith('ADMISSION_DEPENDENCY_FAILED');
      }),
      dependencyFailureBackoffBounded: decisions.every(item => {
        if (item.decision.failureState?.schema !== 'aios.scheduler.admission_queue.dependency_failure.v1') {
          return true;
        }
        return item.decision.failureState.terminal
          || (Number.isFinite(item.decision.failureState.retryAfterMs) && item.decision.failureState.retryAfterMs <= MAX_BACKOFF_MS);
      }),
      dependencyHandoffsAttached: decisions.every(item => {
        return item.decision.dependencyHandoff?.schema === DEPENDENCY_HANDOFF_SCHEMA
          && item.decision.dependencyHandoff.requestId === item.request.id
          && item.decision.dependencyHandoff.proof?.commandRoutable === true
          && item.decision.clientWorkflow?.resumeContract?.dependency?.state === item.decision.dependencyHandoff.state;
      }),
      dependencyClientWaitsRouted: decisions.every(item => {
        const handoff = item.decision.dependencyHandoff;
        if (!handoff?.held && !handoff?.failed) {
          return true;
        }
        return item.decision.clientWorkflow?.waitOnDependencies === true
          && item.decision.clientWorkflow?.deliveryService?.dependencyGateRequired === true
          && item.decision.clientWorkflow?.resumeContract?.userVisible?.waitOnDependencies === true
          && item.decision.clientWorkflow?.resumeContract?.userVisible?.dependencyCommand === handoff.command;
      }),
      operatorOverridesAudited: decisions.every(item => {
        return !item.request.operatorOverride?.requested
          || item.request.operatorOverride.schema === 'aios.scheduler.admission_queue.operator_override.v1';
      }),
      admissionBoundaryContractsAttached: decisions.every(item => {
        return item.decision.admissionBoundary?.schema === 'aios.scheduler.admission_queue.boundary.v1'
          && item.decision.admissionBoundary.requestId === item.request.id
          && Array.isArray(item.decision.admissionBoundary.decision.violations);
      }),
      admissionBoundaryDenialsTerminal: decisions.every(item => {
        if (!item.decision.admissionBoundary?.decision?.denied) {
          return true;
        }
        return item.decision.status === 'rejected'
          && (item.decision.failureState?.terminal === true || item.decision.validation?.errors?.length > 0)
          && ['repair-boundary', 'repair-request'].includes(item.decision.nextAction?.type);
      }),
      admissionBoundaryAuditRouted: decisions.every(item => {
        const stream = item.decision.admissionBoundary?.decision?.auditStream;
        return stream === 'scheduler.admission_queue.allowed'
          || stream === 'scheduler.admission_queue.denied';
      }),
      validationSummaryAttached: validationSummary.schema === 'aios.scheduler.admission_queue.validation_summary.v1'
        && validationSummary.errorCount === validationSummary.errors.length
        && validationSummary.warningCount === validationSummary.warnings.length,
      providerContractsNormalized: providerRegistry.providers.every(provider => {
        return provider.schema === 'aios.scheduler.admission_queue.provider_contract.v1'
          && Array.isArray(serializeProviderContract(provider).routes)
          && Array.isArray(serializeProviderContract(provider).capabilities);
      }),
      providerCapacityNormalized: providerRegistry.providers.every(provider => {
        return provider.capacity?.schema === 'aios.scheduler.admission_queue.provider_capacity.v1'
          && Number.isInteger(provider.capacity.queueDepth)
          && Number.isInteger(provider.capacity.queueLimit)
          && Number.isInteger(provider.capacity.inFlight)
          && Number.isInteger(provider.capacity.maxInFlight);
      }),
      providerBackpressureApplied: decisions.every(item => {
        const capacity = item.decision.providerNegotiation?.providerCapacity;
        return !capacity
          || capacity.acceptingNewWork
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      providerBackpressureActionable: decisions.every(item => {
        if (!item.decision.reasons?.includes('provider-backpressure')) {
          return true;
        }
        return item.decision.error?.code === 'ADMISSION_PROVIDER_BACKPRESSURE'
          && item.decision.nextAction?.type === 'provider-backpressure'
          && Number.isFinite(item.decision.retryAfterMs);
      }),
      providerNegotiationAttached: visibleDecisions.every(item => {
        return item.decision.status !== 'admitted'
          || Boolean(item.decision.providerNegotiation?.selectedProviderId)
          || item.decision.recovery?.idempotentReplay === true;
      }),
      providerRequirementsEnforced: decisions.every(item => {
        return item.decision.status !== 'admitted'
          || item.decision.providerNegotiation?.requirementViolations?.length === 0
          || item.decision.recovery?.idempotentReplay === true;
      }),
      providerRequirementFailuresActionable: decisions.every(item => {
        if (!item.decision.providerNegotiation?.requirementViolations?.length) {
          return true;
        }
        return item.decision.status !== 'admitted'
          && item.decision.nextAction?.type === 'renegotiate-provider-contract';
      }),
      providerContractVersionAccepted: decisions.every(item => {
        return item.decision.status !== 'admitted'
          || item.decision.providerNegotiation?.contractVersion === providerRegistry.requiredContractVersion
          || item.decision.recovery?.idempotentReplay === true;
      }),
      providerServiceContractsSerialized: providerRegistry.providers.every(provider => {
        return provider.service?.schema === 'aios.scheduler.admission_queue.provider_service.v1'
          && Boolean(provider.service.contractId)
          && Array.isArray(provider.service.responseModes);
      }),
      providerDispatchContractsAttached: decisions.every(item => {
        return item.decision.status !== 'admitted'
          || item.decision.dispatchContract?.state === 'dispatchable'
          || item.decision.dispatchContract?.recovery?.idempotentReplay === true;
      }),
      providerDispatchContractProofsAttached: decisions.every(item => {
        if (item.decision.status !== 'admitted') {
          return true;
        }
        return item.decision.dispatchContract?.proof?.versionAccepted === true
          && item.decision.dispatchContract?.proof?.responseModeNegotiated === true
          && item.decision.dispatchContract?.proof?.capacityReserved === true;
      }),
      providerAcknowledgementContractsAttached: decisions.every(item => {
        return item.decision.providerAcknowledgement?.schema === 'aios.scheduler.admission_queue.provider_acknowledgement.v1'
          && item.decision.providerAcknowledgement.requestId === item.request.id
          && Boolean(item.decision.providerAcknowledgement.state);
      }),
      providerAcknowledgementProofsAttached: decisions.every(item => {
        const ack = item.decision.providerAcknowledgement;
        if (!ack?.ackRequired) {
          return true;
        }
        return ack.proof?.providerIdentified === true
          && ack.proof?.receiptCommandRoutable === true
          && ack.proof?.deadlineBounded === true
          && ack.validation.errors.length === 0;
      }),
      providerAckDeadlinesBounded: decisions.every(item => {
        const deadline = item.decision.providerAcknowledgement?.ackDeadlineMs;
        return deadline === null || (Number.isInteger(deadline) && deadline <= MAX_PROVIDER_ACK_DEADLINE_MS);
      }),
      providerAckNextActionsAttached: decisions.every(item => {
        if (!item.decision.providerAcknowledgement?.ackRequired || item.decision.providerAcknowledgement.state !== 'awaiting-provider-ack') {
          return true;
        }
        return item.decision.nextAction?.type === 'provider-ack'
          && item.decision.nextAction?.command === item.decision.providerAcknowledgement.receiptCommand
          && item.decision.nextAction?.receiptKey === item.decision.providerAcknowledgement.receiptKey;
      }),
      externalHandoffStateAttached: !canRead || visibleDecisions.every(item => Boolean(item.decision.externalHandoff?.state)),
      clientWorkflowStateAttached: !canRead || visibleDecisions.every(item => Boolean(item.decision.clientWorkflow?.state)),
      clientRuntimeContractAttached: requests.every(item => {
        return item.clientRuntime?.schema === 'aios.scheduler.admission_queue.client_runtime.v1'
          && CLIENT_RESPONSE_MODES.has(item.clientRuntime.responseMode);
      }),
      clientResumeContractsAttached: decisions.every(item => {
        const contract = item.decision.clientWorkflow?.resumeContract;
        return contract?.schema === 'aios.scheduler.admission_queue.client_resume_contract.v1'
          && contract.requestId === item.request.id
          && Boolean(contract.delivery?.channel)
          && contract.delivery?.service?.schema === 'aios.scheduler.admission_queue.client_delivery_service.v1'
          && contract.proof?.deliveryServiceReady === true
          && Boolean(contract.resume?.command)
          && contract.proof?.responseModeMapped === true
          && contract.validation.errors.length === 0;
      }),
      clientWorkflowCorrelationAttached: decisions.every(item => {
        return Boolean(item.decision.clientWorkflow?.correlationId)
          && Boolean(item.decision.clientWorkflow?.idempotencyKey || item.decision.status !== 'admitted');
      }),
      clientAckNextActionsAttached: decisions.every(item => {
        if (!item.decision.clientWorkflow?.requiresClientAck) {
          return true;
        }
        if (item.decision.providerAcknowledgement?.ackRequired && item.decision.providerAcknowledgement.state === 'awaiting-provider-ack') {
          return item.decision.nextAction?.type === 'provider-ack'
            && item.decision.nextAction?.command === item.decision.providerAcknowledgement.receiptCommand;
        }
        return item.decision.nextAction?.type === 'client-ack'
          && item.decision.nextAction?.command === item.decision.clientWorkflow.callbackCommand;
      }),
      clientDeliveryServiceContractsAttached: decisions.every(item => {
        const service = item.decision.clientWorkflow?.deliveryService;
        return service?.schema === 'aios.scheduler.admission_queue.client_delivery_service.v1'
          && service.requestId === item.request.id
          && CLIENT_DELIVERY_CHANNELS.has(service.channel)
          && Boolean(service.route)
          && service.proof?.knownChannel === true
          && service.proof?.routePresent === true
          && service.validation.errors.length === 0;
      }),
      externalHandoffSyncMetadataAttached: visibleDecisions.every(item => {
        if (!item.decision.externalHandoff?.required) {
          return true;
        }
        return Boolean(item.decision.externalHandoff.syncCursor || item.decision.providerNegotiation?.selectedProviderId);
      }),
      scheduleWindowValidated: lifecycle.scheduleMode !== 'windowed'
        || ['active', 'pending', 'expired', 'invalid'].includes(lifecycle.scheduleWindow.state),
      scheduleWindowControlsApplied: lifecycle.scheduleMode !== 'windowed'
        || lifecycle.scheduleWindow.active
        || decisions.every(item => item.decision.status !== 'admitted' || item.decision.recovery?.idempotentReplay === true),
      routeCapabilityControlsApplied: decisions.every(item => {
        const routeHeld = lifecycle.disabledRoutes.has(item.request.route);
        const capabilityHeld = lifecycle.disabledCapabilities.has(item.request.capability);
        return (!routeHeld && !capabilityHeld)
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      priorityFloorControlsApplied: lifecycle.lowPriorityFloor === null || decisions.every(item => {
        return item.request.priority >= lifecycle.lowPriorityFloor
          || item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      lifecycleControlsApplied: decisions.every(item => {
        if (lifecycle.acceptingNewWork && lifecycle.validation.errors.length === 0) {
          return true;
        }
        return item.decision.status !== 'admitted'
          || item.decision.recovery?.idempotentReplay === true;
      }),
      nextActionsAttached: visibleDecisions.every(item => Boolean(item.decision.nextAction?.type)),
      historyScoped: history.every(snapshot => {
        const tenantMatches = !snapshot.tenantId || snapshot.tenantId === workspace.tenantId;
        const workspaceMatches = !snapshot.workspaceId || snapshot.workspaceId === workspace.workspaceId;
        return tenantMatches && workspaceMatches;
      }),
      timelineIncludesCurrentWindow: timeline.some(event => event.type === 'current-admission-window' && event.at === now),
      actionableErrors: decisions.filter(item => item.decision.error).map(item => ({
        requestId: item.request.id,
        code: item.decision.error.code,
        retryable: item.decision.error.retryable
      })),
      requestCount: requests.length
    },
    evidence: asArray(input.evidence)
  };
}

export default describeAdmissionQueueSurface;
