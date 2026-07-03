export const surfaceId = "aios_artifact-filesystem_quarantine-record_035";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "quarantine-record";

const ROLE_PERMISSIONS = new Map([
  ['owner', ['quarantine:read', 'quarantine:write', 'audit:handoff']],
  ['admin', ['quarantine:read', 'quarantine:write', 'audit:handoff']],
  ['operator', ['quarantine:read', 'quarantine:write']],
  ['auditor', ['quarantine:read', 'audit:handoff']],
  ['viewer', ['quarantine:read']]
]);

const ACTION_PERMISSIONS = {
  read: 'quarantine:read',
  record: 'quarantine:write',
  release: 'quarantine:write',
  handoff: 'audit:handoff'
};

const DEFAULT_ACTION = 'record';
const BOUNDARY_REASONS = new Set([
  'malware-scan',
  'policy-violation',
  'tenant-boundary',
  'workspace-boundary',
  'permission-boundary',
  'integrity-mismatch',
  'manual-review'
]);

const VALID_ACTIONS = new Set(Object.keys(ACTION_PERMISSIONS));
const HEALTHY_STATES = new Set(['ok', 'healthy', 'ready']);
const DEGRADED_STATES = new Set(['degraded', 'slow', 'readonly', 'rate-limited']);
const DOWN_STATES = new Set(['down', 'offline', 'failed', 'unavailable']);
const RETRYABLE_DENIALS = new Set([
  'quarantine-store-unavailable',
  'audit-sink-unavailable',
  'quarantine-store-degraded',
  'audit-sink-degraded',
  'quarantine-store-health-stale',
  'audit-sink-health-stale',
  'quarantine-store-circuit-open',
  'audit-sink-circuit-open',
  'missing-evidence-for-release'
]);
const VALID_LIFECYCLE_COMMANDS = new Set(['record', 'pause', 'resume', 'disable', 'enable', 'release', 'handoff']);
const VALID_SCHEDULE_MODES = new Set(['immediate', 'delayed', 'maintenance-window', 'manual']);
const VALID_NEXT_ACTIONS = new Set(['record', 'release', 'reconcile', 'retry', 'handoff', 'wait', 'blocked']);
const ACTION_LIFECYCLE_COMMANDS = new Set(['record', 'release', 'handoff']);
const CONTROL_LIFECYCLE_COMMANDS = new Set(['pause', 'resume', 'disable', 'enable']);
const LIFECYCLE_COMMAND_EFFECTS = {
  pause: { enabled: false, state: 'paused', nextAction: 'wait' },
  disable: { enabled: false, state: 'disabled', nextAction: 'wait' },
  resume: { enabled: true, state: 'resumed', nextAction: null },
  enable: { enabled: true, state: 'enabled', nextAction: null }
};
const VALID_EXTERNAL_HANDOFF_STATES = new Set(['not-required', 'ready', 'pending', 'accepted', 'failed', 'blocked']);
const VALID_CLIENT_ACK_STATES = new Set(['unseen', 'previewed', 'acknowledged', 'submitted', 'accepted', 'rejected']);
const VALID_PERSISTED_COMMAND_STATES = new Set(['missing', 'intent-persisted', 'commit-pending', 'committed', 'failed', 'rolled-back']);
const TERMINAL_PERSISTED_COMMAND_STATES = new Set(['committed', 'failed', 'rolled-back']);
const VALID_RECOVERY_JOURNAL_STEPS = new Set([
  'intent-written',
  'store-commit-started',
  'store-commit-confirmed',
  'audit-emit-started',
  'audit-emit-confirmed',
  'recovery-started',
  'recovery-confirmed',
  'rollback-started',
  'rollback-confirmed'
]);
const VALID_PROVIDER_ENDPOINT_PURPOSES = new Set(['record', 'release', 'handoff', 'audit', 'health', 'sync']);
const VALID_PROVIDER_ENDPOINT_PROTOCOLS = new Set(['https:', 'http:', 'aios:', 'kernel:']);
const VALID_PROVIDER_SYNC_STATES = new Set(['idle', 'dirty', 'syncing', 'synced', 'conflict', 'failed', 'paused']);
const VALID_PROVIDER_SYNC_DIRECTIONS = new Set(['inbound', 'outbound', 'bidirectional', 'none']);
const VALID_ARTIFACT_QUARANTINE_STATES = new Set([
  'unknown',
  'clear',
  'quarantined',
  'pending-review',
  'pending-release',
  'release-approved',
  'released',
  'handoff-pending',
  'handoff-accepted'
]);
const ACTION_ALLOWED_STATES = {
  read: VALID_ARTIFACT_QUARANTINE_STATES,
  record: new Set(['unknown', 'clear', 'quarantined', 'pending-review', 'handoff-pending']),
  release: new Set(['quarantined', 'pending-review', 'pending-release', 'release-approved', 'handoff-accepted']),
  handoff: new Set(['quarantined', 'pending-review', 'pending-release', 'handoff-pending'])
};
const ACTION_PROVIDER_CAPABILITIES = {
  read: ['quarantine.record.read'],
  record: ['quarantine.record.write', 'audit.event.emit'],
  release: ['quarantine.release.write', 'audit.event.emit'],
  handoff: ['audit.handoff.write', 'external.handoff.track']
};
const DEFAULT_PROVIDER_CAPABILITIES = [...new Set(Object.values(ACTION_PROVIDER_CAPABILITIES).flat())];
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const MIN_REVIEW_INTERVAL_MINUTES = 5;
const MAX_REVIEW_INTERVAL_MINUTES = 10080;
const MAX_DELAYED_SCHEDULE_DAYS = 30;
const MAX_MAINTENANCE_WINDOW_HOURS = 12;
const DEPENDENCY_HEALTH_MAX_AGE_MS = 120000;
const CIRCUIT_OPEN_FAILURE_THRESHOLD = 3;
const MAX_DEPENDENCY_RETRY_AFTER_MS = 60000;
const MAX_RETRY_ATTEMPTS_BEFORE_OPERATOR = 5;
const EXPORT_SCHEMA_VERSION = 'artifact-filesystem.quarantine-record.analytics-export.v1';
const EXPORT_COLUMNS = [
  'generatedAt',
  'partitionKey',
  'scopedKey',
  'tenantId',
  'workspaceId',
  'artifactId',
  'actorId',
  'action',
  'decision',
  'status',
  'deniedReasonCount',
  'evidenceCount',
  'healthState',
  'providerSyncStatus',
  'persistedReplayStatus',
  'custodyStatus',
  'artifactTransition',
  'clientRouteState'
];
const ACTION_CRITICAL_DEPENDENCIES = {
  read: ['quarantineStore'],
  record: ['quarantineStore', 'auditSink'],
  release: ['quarantineStore', 'auditSink'],
  handoff: ['auditSink']
};
const FAILURE_SEVERITY_RANK = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};
const OPERATIONAL_RUNBOOKS = {
  'critical-dependency-blocked': {
    owner: 'kernel-storage-operator',
    action: 'restore-critical-dependency',
    escalation: 'page-oncall',
    message: 'Critical quarantine dependencies must be restored before artifact state can move.'
  },
  'circuit-open-degraded': {
    owner: 'kernel-platform-operator',
    action: 'wait-for-circuit-cooldown',
    escalation: 'observe',
    message: 'Dependency circuit breakers are open; preserve idempotency and retry after cooldown.'
  },
  'health-stale-degraded': {
    owner: 'kernel-health-operator',
    action: 'refresh-dependency-health',
    escalation: 'ticket',
    message: 'Dependency health is stale; refresh health before accepting state changes.'
  },
  'degraded-mode': {
    owner: 'artifact-workflow-operator',
    action: 'commit-intent-and-reconcile',
    escalation: 'ticket',
    message: 'Quarantine can preserve intent but requires reconciliation after dependencies recover.'
  },
  'request-blocked': {
    owner: 'requesting-client',
    action: 'fix-request-and-resubmit',
    escalation: 'none',
    message: 'The request is blocked by validation, permission, lifecycle, provider, or custody state.'
  },
  nominal: {
    owner: 'hosted-kernel',
    action: 'continue',
    escalation: 'none',
    message: 'Quarantine dependencies and request state are ready.'
  }
};

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(textOrNull)
    .filter(Boolean))];
}

function permissionSet(actor = {}) {
  const permissions = new Set(uniqueStrings(actor.permissions));
  for (const role of uniqueStrings(actor.roles)) {
    for (const permission of ROLE_PERMISSIONS.get(role) || []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

function collectScopedStrings(...values) {
  return uniqueStrings(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []));
}

function normalizeActorBoundary(actor = {}, input = {}, scope = {}) {
  const source = actor.boundary && typeof actor.boundary === 'object'
    ? actor.boundary
    : actor.scope && typeof actor.scope === 'object'
      ? actor.scope
      : actor.access && typeof actor.access === 'object'
        ? actor.access
        : input.actorAccess && typeof input.actorAccess === 'object'
          ? input.actorAccess
          : {};
  const workspaceGrants = Array.isArray(source.workspaceGrants)
    ? source.workspaceGrants
    : Array.isArray(source.grants)
      ? source.grants
      : [];
  const grantedTenants = collectScopedStrings(
    source.tenantIds,
    source.tenants,
    source.allowedTenantIds,
    actor.tenantIds,
    actor.allowedTenantIds
  );
  const grantedWorkspaces = collectScopedStrings(
    source.workspaceIds,
    source.workspaces,
    source.allowedWorkspaceIds,
    actor.workspaceIds,
    actor.allowedWorkspaceIds
  );
  const grantedScopedKeys = collectScopedStrings(source.scopedKeys, source.allowedScopedKeys);

  for (const grant of workspaceGrants) {
    if (!grant || typeof grant !== 'object') continue;
    const grantTenantId = textOrNull(grant.tenantId);
    const grantWorkspaceId = textOrNull(grant.workspaceId);
    const grantScopedKey = textOrNull(grant.scopedKey);
    if (grantTenantId) grantedTenants.push(grantTenantId);
    if (grantWorkspaceId) grantedWorkspaces.push(grantWorkspaceId);
    if (grantScopedKey) grantedScopedKeys.push(grantScopedKey);
    if (grantTenantId && grantWorkspaceId) grantedScopedKeys.push(`${grantTenantId}:${grantWorkspaceId}`);
  }

  const tenantIds = [...new Set(grantedTenants)];
  const workspaceIds = [...new Set(grantedWorkspaces)];
  const scopedKeys = [...new Set(grantedScopedKeys)];
  const scopedKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}`;
  const explicit = Boolean(tenantIds.length || workspaceIds.length || scopedKeys.length || source.enforce === true);
  const tenantAllowed = !explicit || tenantIds.length === 0 || tenantIds.includes('*') || tenantIds.includes(scope.tenantId);
  const workspaceAllowed = !explicit || workspaceIds.length === 0 || workspaceIds.includes('*') || workspaceIds.includes(scope.workspaceId);
  const scopedKeyAllowed = !explicit || scopedKeys.length === 0 || scopedKeys.includes('*') || scopedKeys.includes(scopedKey);
  const blockedReasons = [];

  if (!tenantAllowed) blockedReasons.push('actor-tenant-boundary-mismatch');
  if (!workspaceAllowed) blockedReasons.push('actor-workspace-boundary-mismatch');
  if (!scopedKeyAllowed) blockedReasons.push('actor-scoped-key-boundary-mismatch');

  return {
    schema: 'artifact-filesystem.quarantine-record.actor-boundary.v1',
    mode: explicit ? 'enforced' : 'implicit-hosted-kernel',
    status: blockedReasons.length ? 'blocked' : explicit ? 'satisfied' : 'not-declared',
    scopedKey,
    grantedTenantIds: tenantIds,
    grantedWorkspaceIds: workspaceIds,
    grantedScopedKeys: scopedKeys,
    checks: {
      tenantAllowed,
      workspaceAllowed,
      scopedKeyAllowed
    },
    deniedReasons: blockedReasons,
    handoffIsolationKey: `${scope.tenantId || 'missing-tenant'}/${scope.workspaceId || 'missing-workspace'}/${textOrNull(actor.id) || textOrNull(input.actorId) || 'anonymous'}`
  };
}

function normalizeScope(input = {}) {
  const tenantId = textOrNull(input.tenantId ?? input.tenant?.id);
  const workspaceId = textOrNull(input.workspaceId ?? input.workspace?.id);
  const artifactId = textOrNull(input.artifactId ?? input.artifact?.id);
  const action = textOrNull(input.action) || DEFAULT_ACTION;

  return { tenantId, workspaceId, artifactId, action };
}

function normalizeEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return { id: `evidence-${index + 1}`, kind: 'note', summary: entry };
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const id = textOrNull(entry.id) || `evidence-${index + 1}`;
      const kind = textOrNull(entry.kind) || textOrNull(entry.type) || 'artifact-signal';
      const summary = textOrNull(entry.summary) || textOrNull(entry.reason) || textOrNull(entry.message);
      const digest = textOrNull(entry.digest) || textOrNull(entry.sha256);

      return { id, kind, summary, digest };
    })
    .filter(Boolean);
}

function normalizeDependencyHealth(input = {}, action = DEFAULT_ACTION, now = new Date().toISOString()) {
  const dependencies = input.dependencies && typeof input.dependencies === 'object' ? input.dependencies : {};
  const quarantineStore = normalizeDependency('quarantineStore', input.quarantineStore ?? dependencies.quarantineStore, now);
  const auditSink = normalizeDependency('auditSink', input.auditSink ?? dependencies.auditSink, now);
  const allDependencies = [quarantineStore, auditSink];
  const criticalNames = ACTION_CRITICAL_DEPENDENCIES[action] || ACTION_CRITICAL_DEPENDENCIES[DEFAULT_ACTION];
  const critical = allDependencies.filter((dependency) => criticalNames.includes(dependency.name));
  const unavailable = allDependencies.filter((dependency) => dependency.unavailable);
  const degraded = allDependencies.filter((dependency) => dependency.degraded);
  const stale = allDependencies.filter((dependency) => dependency.stale);
  const circuitOpen = allDependencies.filter((dependency) => dependency.circuitOpen);
  const criticalUnavailable = critical.filter((dependency) => dependency.unavailable);
  const criticalDegraded = critical.filter((dependency) => dependency.degraded);
  const degradedMode = Boolean(input.degradedMode || quarantineStore.degraded || auditSink.degraded);

  return {
    degradedMode: degradedMode || stale.length > 0 || circuitOpen.length > 0,
    dependencies: allDependencies,
    criticalDependencyNames: criticalNames,
    critical,
    unavailable,
    degraded,
    stale,
    circuitOpen,
    criticalUnavailable,
    criticalDegraded,
    blockingDependencyNames: criticalUnavailable.map((dependency) => dependency.name),
    degradedDependencyNames: criticalDegraded.map((dependency) => dependency.name),
    retryAfterMs: allDependencies
      .map((dependency) => dependency.retryAfterMs)
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0) || null
  };
}

function normalizeHistorySnapshots(history, fallbackNow) {
  return (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const generatedAt = textOrNull(entry.generatedAt) || textOrNull(entry.at) || textOrNull(entry.timestamp) || fallbackNow;
      const decision = textOrNull(entry.decision) || (entry.allowed === true ? 'allow' : entry.allowed === false ? 'deny' : null);
      const status = textOrNull(entry.status) || textOrNull(entry.quarantine?.status);
      const action = textOrNull(entry.action) || DEFAULT_ACTION;
      const deniedReasons = uniqueStrings(entry.deniedReasons || entry.decision?.deniedReasons);
      const quarantineReasons = uniqueStrings(entry.quarantineReasons || entry.reasons || entry.quarantine?.reasons);
      const evidenceCount = Number.isFinite(entry.evidenceCount)
        ? Math.max(0, Math.round(entry.evidenceCount))
        : Array.isArray(entry.evidence)
          ? entry.evidence.length
          : 0;

      return {
        id: textOrNull(entry.id) || `snapshot-${index + 1}`,
        generatedAt,
        action,
        decision: decision === 'allow' || decision === 'deny' ? decision : null,
        status,
        deniedReasons,
        quarantineReasons,
        evidenceCount,
        exportFingerprint: textOrNull(entry.exportFingerprint)
          || textOrNull(entry.fingerprint)
          || [
            textOrNull(entry.id) || `snapshot-${index + 1}`,
            generatedAt,
            action,
            decision || 'unknown',
            status || 'unknown'
          ].join('|'),
        source: textOrNull(entry.source) || textOrNull(entry.origin) || 'history-input',
        requestId: textOrNull(entry.requestId),
        idempotencyKey: textOrNull(entry.idempotencyKey)
      };
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt));
}

function normalizeDependency(name, value, now) {
  if (value === false) {
    return {
      name,
      state: 'unavailable',
      unavailable: true,
      degraded: false,
      stale: false,
      circuitOpen: false,
      failureCount: 0,
      consecutiveFailureCount: 0,
      retryAfterMs: null
    };
  }

  if (!value || value === true) {
    return {
      name,
      state: 'ok',
      unavailable: false,
      degraded: false,
      stale: false,
      circuitOpen: false,
      failureCount: 0,
      consecutiveFailureCount: 0,
      retryAfterMs: null
    };
  }

  const state = textOrNull(value.state) || textOrNull(value.status) || 'ok';
  const normalizedState = state.toLowerCase();
  const observedAt = textOrNull(value.observedAt) || textOrNull(value.checkedAt) || textOrNull(value.updatedAt);
  const observedAgeMs = observedAt && Number.isFinite(Date.parse(observedAt))
    ? Math.max(0, Date.parse(now) - Date.parse(observedAt))
    : null;
  const stale = observedAgeMs !== null && observedAgeMs > DEPENDENCY_HEALTH_MAX_AGE_MS;
  const failureCount = positiveIntegerOrNull(value.failureCount ?? value.failures) || 0;
  const consecutiveFailureCount = positiveIntegerOrNull(value.consecutiveFailureCount ?? value.consecutiveFailures) || 0;
  const circuitOpen = normalizedState === 'circuit-open' || consecutiveFailureCount >= CIRCUIT_OPEN_FAILURE_THRESHOLD || value.circuitOpen === true;
  const retryAfterMs = positiveIntegerOrNull(value.retryAfterMs ?? value.retryAfterMilliseconds);
  const unavailable = DOWN_STATES.has(normalizedState) || value.available === false || value.ok === false || circuitOpen;
  const degraded = !unavailable && (DEGRADED_STATES.has(normalizedState) || value.degraded === true || stale || failureCount > 0);
  const latencyMs = Number.isFinite(value.latencyMs) ? Math.max(0, Math.round(value.latencyMs)) : null;

  return {
    name,
    state: HEALTHY_STATES.has(normalizedState) && !stale ? 'ok' : normalizedState,
    unavailable,
    degraded,
    stale,
    circuitOpen,
    observedAt,
    observedAgeMs,
    failureCount,
    consecutiveFailureCount,
    retryAfterMs: retryAfterMs === null ? null : Math.min(MAX_DEPENDENCY_RETRY_AFTER_MS, retryAfterMs),
    message: textOrNull(value.message) || textOrNull(value.reason),
    latencyMs
  };
}

function normalizeProviderEndpoint(entry, index) {
  const source = typeof entry === 'string' ? { url: entry } : entry && typeof entry === 'object' ? entry : {};
  const url = textOrNull(source.url) || textOrNull(source.endpoint) || textOrNull(source.href);
  const purpose = (textOrNull(source.purpose) || textOrNull(source.action) || 'sync').toLowerCase();
  const protocol = url && /^[a-z][a-z0-9+.-]*:/i.test(url) ? url.slice(0, url.indexOf(':') + 1).toLowerCase() : null;
  const timeoutMs = positiveIntegerOrNull(source.timeoutMs ?? source.timeoutMilliseconds);

  return {
    id: textOrNull(source.id) || textOrNull(source.endpointId) || `endpoint-${index + 1}`,
    purpose,
    url,
    method: (textOrNull(source.method) || (purpose === 'health' ? 'GET' : 'POST')).toUpperCase(),
    capability: textOrNull(source.capability) || (purpose === 'audit' ? 'audit.event.emit' : purpose === 'handoff' ? 'external.handoff.track' : null),
    authRef: textOrNull(source.authRef) || textOrNull(source.credentialRef),
    protocol,
    validPurpose: VALID_PROVIDER_ENDPOINT_PURPOSES.has(purpose),
    validProtocol: !url || !protocol || VALID_PROVIDER_ENDPOINT_PROTOCOLS.has(protocol),
    signed: source.signed === true || source.requiresSignature === true,
    timeoutMs: timeoutMs === null ? null : Math.min(30000, timeoutMs)
  };
}

function normalizeProviderSyncMetadata(source = {}, input = {}, now) {
  const syncSource = source.syncMetadata && typeof source.syncMetadata === 'object'
    ? source.syncMetadata
    : source.sync && typeof source.sync === 'object'
      ? source.sync
      : input.providerSync && typeof input.providerSync === 'object'
        ? input.providerSync
        : {};
  const rawState = textOrNull(syncSource.state) || textOrNull(syncSource.status) || 'idle';
  const syncState = rawState.toLowerCase();
  const rawDirection = textOrNull(syncSource.direction) || textOrNull(syncSource.mode) || 'outbound';
  const direction = rawDirection.toLowerCase();
  const localRevision = textOrNull(syncSource.localRevision) || textOrNull(syncSource.artifactRevision);
  const upstreamRevision = textOrNull(syncSource.upstreamRevision) || textOrNull(syncSource.remoteRevision);
  const dirty = syncSource.dirty === true
    || syncState === 'dirty'
    || Boolean(localRevision && upstreamRevision && localRevision !== upstreamRevision);

  return {
    schema: 'artifact-filesystem.quarantine-record.provider-sync-metadata.v1',
    state: VALID_PROVIDER_SYNC_STATES.has(syncState) ? syncState : 'idle',
    rawState,
    direction: VALID_PROVIDER_SYNC_DIRECTIONS.has(direction) ? direction : 'outbound',
    rawDirection,
    cursor: textOrNull(syncSource.cursor) || textOrNull(syncSource.syncCursor),
    checkpointId: textOrNull(syncSource.checkpointId) || textOrNull(syncSource.watermark),
    localRevision,
    upstreamRevision,
    conflictPolicy: textOrNull(syncSource.conflictPolicy) || 'fail-closed',
    dirty,
    lastPulledAt: textOrNull(syncSource.lastPulledAt) || textOrNull(syncSource.lastReadAt),
    lastPushedAt: textOrNull(syncSource.lastPushedAt) || textOrNull(syncSource.lastWrittenAt),
    normalizedAt: now
  };
}

function normalizeProviderContract(input = {}, action, now) {
  const hasExplicitProvider = (input.provider && typeof input.provider === 'object')
    || (input.integrationProvider && typeof input.integrationProvider === 'object')
    || (input.serviceContract && typeof input.serviceContract === 'object');
  const source = input.provider && typeof input.provider === 'object'
    ? input.provider
    : input.integrationProvider && typeof input.integrationProvider === 'object'
      ? input.integrationProvider
      : input.serviceContract && typeof input.serviceContract === 'object'
        ? input.serviceContract
        : {};
  const externalSource = source.externalHandoff && typeof source.externalHandoff === 'object'
    ? source.externalHandoff
    : input.externalHandoff && typeof input.externalHandoff === 'object'
      ? input.externalHandoff
      : {};
  const declaredCapabilities = uniqueStrings(source.capabilities || source.capabilityIds || source.supportedCapabilities)
    .map((capability) => capability.toLowerCase());
  const requiredCapabilities = ACTION_PROVIDER_CAPABILITIES[action] || ACTION_PROVIDER_CAPABILITIES[DEFAULT_ACTION];
  const effectiveCapabilities = declaredCapabilities.length
    ? declaredCapabilities
    : hasExplicitProvider
      ? []
      : DEFAULT_PROVIDER_CAPABILITIES;
  const missingCapabilities = requiredCapabilities.filter((capability) => !effectiveCapabilities.includes(capability));
  const externalState = textOrNull(externalSource.state) || textOrNull(externalSource.status) || 'not-required';
  const endpointSource = Array.isArray(source.endpoints)
    ? source.endpoints
    : Array.isArray(source.serviceEndpoints)
      ? source.serviceEndpoints
      : Array.isArray(input.providerEndpoints)
        ? input.providerEndpoints
        : [];
  const serviceEndpoints = endpointSource.map(normalizeProviderEndpoint);
  const syncMetadata = normalizeProviderSyncMetadata(source, input, now);
  const providerRequired = source.required === true
    || input.providerRequired === true
    || hasExplicitProvider;

  return {
    schema: 'artifact-filesystem.quarantine-record.provider-contract.v1',
    providerId: textOrNull(source.providerId) || textOrNull(source.id) || 'hosted-kernel',
    serviceName: textOrNull(source.serviceName) || textOrNull(source.name) || 'artifact-quarantine-provider',
    contractVersion: textOrNull(source.contractVersion) || textOrNull(source.version) || 'v1',
    required: Boolean(providerRequired),
    requiredCapabilities,
    declaredCapabilities,
    effectiveCapabilities,
    missingCapabilities,
    serviceEndpoints,
    syncMetadata,
    negotiation: {
      status: missingCapabilities.length ? 'blocked' : declaredCapabilities.length ? 'satisfied' : 'implicit-hosted-kernel',
      requestedAction: action,
      negotiatedAt: now,
      endpointCount: serviceEndpoints.length,
      syncState: syncMetadata.state,
      syncDirty: syncMetadata.dirty
    },
    externalHandoff: {
      state: externalState,
      handoffId: textOrNull(externalSource.handoffId) || textOrNull(externalSource.id),
      endpoint: textOrNull(externalSource.endpoint) || textOrNull(externalSource.url),
      cursor: textOrNull(externalSource.cursor) || textOrNull(externalSource.syncCursor),
      lastSyncedAt: textOrNull(externalSource.lastSyncedAt) || textOrNull(externalSource.syncedAt),
      acknowledgedBy: textOrNull(externalSource.acknowledgedBy),
      receiptId: textOrNull(externalSource.receiptId) || textOrNull(externalSource.ackReceiptId),
      acceptedAt: textOrNull(externalSource.acceptedAt) || textOrNull(externalSource.acknowledgedAt),
      leaseExpiresAt: textOrNull(externalSource.leaseExpiresAt) || textOrNull(externalSource.expiresAt),
      failureCode: textOrNull(externalSource.failureCode) || textOrNull(externalSource.errorCode),
      retryToken: textOrNull(externalSource.retryToken),
      tenantId: textOrNull(externalSource.tenantId),
      workspaceId: textOrNull(externalSource.workspaceId),
      partitionKey: textOrNull(externalSource.partitionKey),
      scopedKey: textOrNull(externalSource.scopedKey),
      isolationKey: textOrNull(externalSource.isolationKey) || textOrNull(externalSource.handoffIsolationKey)
    }
  };
}

function normalizeClientRequestState(input = {}, scope, action, now) {
  const source = input.client && typeof input.client === 'object'
    ? input.client
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const routeSource = source.route && typeof source.route === 'object'
    ? source.route
    : input.route && typeof input.route === 'object'
      ? input.route
      : {};
  const requestSource = source.request && typeof source.request === 'object'
    ? source.request
    : {};
  const artifactRevision = textOrNull(source.artifactRevision)
    || textOrNull(requestSource.artifactRevision)
    || textOrNull(input.artifactRevision);
  const expectedArtifactRevision = textOrNull(source.expectedArtifactRevision)
    || textOrNull(requestSource.expectedArtifactRevision)
    || textOrNull(input.expectedArtifactRevision);
  const ackState = textOrNull(source.ackState)
    || textOrNull(source.status)
    || (source.acknowledged === true ? 'acknowledged' : 'unseen');
  const routeIntent = textOrNull(routeSource.intent)
    || textOrNull(routeSource.name)
    || `artifact-filesystem/quarantine-record/${action}`;
  const routeTenantId = textOrNull(routeSource.tenantId) || textOrNull(routeSource.params?.tenantId);
  const routeWorkspaceId = textOrNull(routeSource.workspaceId) || textOrNull(routeSource.params?.workspaceId);
  const routeArtifactId = textOrNull(routeSource.artifactId) || textOrNull(routeSource.params?.artifactId);
  const idempotencyKey = textOrNull(source.idempotencyKey)
    || textOrNull(requestSource.idempotencyKey)
    || textOrNull(input.idempotencyKey)
    || `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}:${action}`;

  return {
    schema: 'artifact-filesystem.quarantine-record.client-request.v1',
    requestId: textOrNull(source.requestId) || textOrNull(requestSource.id) || textOrNull(input.requestId) || `quarantine-${Date.parse(now) || 0}`,
    sessionId: textOrNull(source.sessionId) || textOrNull(input.sessionId),
    surfaceRoute: routeIntent,
    routeParams: {
      tenantId: routeTenantId,
      workspaceId: routeWorkspaceId,
      artifactId: routeArtifactId
    },
    idempotencyKey,
    ackState,
    acknowledgedRiskCodes: uniqueStrings(source.acknowledgedRiskCodes || source.acknowledgedRisks || input.acknowledgedRiskCodes),
    artifactRevision,
    expectedArtifactRevision,
    staleRevision: Boolean(artifactRevision && expectedArtifactRevision && artifactRevision !== expectedArtifactRevision),
    optimisticClientState: {
      pending: source.pending === true || requestSource.pending === true,
      dirty: source.dirty === true || requestSource.dirty === true,
      offlineQueued: source.offlineQueued === true || requestSource.offlineQueued === true
    },
    normalizedAt: now
  };
}

function normalizeArtifactState(input = {}, scope, action, evidence, now) {
  const source = input.artifact && typeof input.artifact === 'object' ? input.artifact : {};
  const quarantineSource = source.quarantine && typeof source.quarantine === 'object'
    ? source.quarantine
    : input.quarantineState && typeof input.quarantineState === 'object'
      ? input.quarantineState
      : {};
  const rawState = textOrNull(quarantineSource.state)
    || textOrNull(quarantineSource.status)
    || textOrNull(input.artifactState)
    || (action === 'record' ? 'clear' : 'unknown');
  const state = rawState.toLowerCase();
  const stateRecognized = VALID_ARTIFACT_QUARANTINE_STATES.has(state);
  const currentState = stateRecognized ? state : 'unknown';
  const revision = textOrNull(source.revision)
    || textOrNull(source.version)
    || textOrNull(input.artifactRevision);
  const quarantineRecordId = textOrNull(quarantineSource.recordId)
    || textOrNull(quarantineSource.id)
    || textOrNull(input.quarantineRecordId);
  const currentRecordDigest = textOrNull(quarantineSource.digest)
    || textOrNull(quarantineSource.recordDigest)
    || textOrNull(input.quarantineRecordDigest);
  const contentDigest = textOrNull(source.digest)
    || textOrNull(source.sha256)
    || textOrNull(input.artifactDigest);
  const releaseAuthorizationIds = collectScopedStrings(
    quarantineSource.releaseAuthorizationIds,
    input.releaseAuthorizationIds,
    evidence
      .filter((item) => item.kind === 'release-authorization' || item.kind === 'operator-approval')
      .map((item) => item.id)
  );
  const nextState = action === 'release'
    ? 'released'
    : action === 'handoff'
      ? 'handoff-pending'
      : action === 'record'
        ? 'quarantined'
        : currentState;
  const allowedStates = ACTION_ALLOWED_STATES[action] || ACTION_ALLOWED_STATES.record;

  return {
    schema: 'artifact-filesystem.quarantine-record.artifact-state.v1',
    artifactId: scope.artifactId,
    currentState,
    rawState,
    stateRecognized,
    nextState,
    transition: `${currentState}->${nextState}`,
    revision,
    contentDigest,
    quarantineRecordId,
    currentRecordDigest,
    releaseAuthorizationIds,
    transitionAllowed: allowedStates.has(currentState),
    normalizedAt: now
  };
}

function normalizePersistedState(input = {}, scope, action, clientRequestState, artifactState, now) {
  const source = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.quarantineRecord && typeof input.quarantineRecord === 'object'
      ? input.quarantineRecord
      : input.stateStore && typeof input.stateStore === 'object'
        ? input.stateStore
        : {};
  const commandSource = source.command && typeof source.command === 'object' ? source.command : source;
  const storedScope = source.scope && typeof source.scope === 'object' ? source.scope : source;
  const storedCommandState = textOrNull(commandSource.state)
    || textOrNull(commandSource.status)
    || (source.exists === true ? 'committed' : 'missing');
  const normalizedCommandState = storedCommandState.toLowerCase();
  const stateRecognized = VALID_PERSISTED_COMMAND_STATES.has(normalizedCommandState);
  const state = stateRecognized ? normalizedCommandState : 'missing';
  const storedAction = textOrNull(commandSource.action) || textOrNull(source.action);
  const storedIdempotencyKey = textOrNull(commandSource.idempotencyKey) || textOrNull(source.idempotencyKey);
  const storedRequestId = textOrNull(commandSource.requestId) || textOrNull(source.requestId);
  const storedTenantId = textOrNull(storedScope.tenantId);
  const storedWorkspaceId = textOrNull(storedScope.workspaceId);
  const storedArtifactId = textOrNull(storedScope.artifactId);
  const storedRevision = textOrNull(commandSource.artifactRevision)
    || textOrNull(source.artifactRevision)
    || textOrNull(source.revision);
  const storedRecordId = textOrNull(source.recordId) || textOrNull(source.quarantineRecordId) || artifactState.quarantineRecordId;
  const storedRecordDigest = textOrNull(source.recordDigest) || textOrNull(source.digest) || artifactState.currentRecordDigest;
  const storedTransition = textOrNull(commandSource.transition) || textOrNull(source.transition);
  const lastCommittedAt = textOrNull(source.lastCommittedAt) || textOrNull(source.committedAt);
  const recoveredAt = textOrNull(source.recoveredAt) || (source.recovered === true ? now : null);
  const recoveryJournal = normalizeRecoveryJournalEntries(source.recoveryJournal || source.journal || commandSource.journal, now);
  const scopeMatches = (!storedTenantId || storedTenantId === scope.tenantId)
    && (!storedWorkspaceId || storedWorkspaceId === scope.workspaceId)
    && (!storedArtifactId || storedArtifactId === scope.artifactId);
  const idempotencyMatches = Boolean(storedIdempotencyKey && storedIdempotencyKey === clientRequestState.idempotencyKey);
  const actionMatches = !storedAction || storedAction === action;
  const revisionMatches = !storedRevision || !artifactState.revision || storedRevision === artifactState.revision;
  const sameCommand = idempotencyMatches && scopeMatches && actionMatches;
  const replayStatus = state === 'missing'
    ? 'new-command'
    : sameCommand && state === 'committed'
      ? 'idempotent-committed-replay'
      : sameCommand && !TERMINAL_PERSISTED_COMMAND_STATES.has(state)
        ? 'restart-recovery-pending'
        : idempotencyMatches
          ? 'idempotency-conflict'
          : revisionMatches
      ? 'prior-state-observed'
      : 'stored-revision-stale';
  const restartRecovery = buildRestartRecoveryState({
    scope,
    action,
    clientRequestState,
    artifactState,
    state,
    replayStatus,
    storedAction,
    storedRequestId,
    storedIdempotencyKey,
    storedRevision,
    storedRecordId,
    storedRecordDigest,
    storedTransition,
    lastCommittedAt,
    recoveredAt,
    scopeMatches,
    actionMatches,
    revisionMatches,
    recoveryJournal,
    now
  });

  return {
    schema: 'artifact-filesystem.quarantine-record.persisted-state.v1',
    state,
    rawState: storedCommandState,
    stateRecognized,
    replayStatus,
    restartSafe: replayStatus === 'new-command'
      || replayStatus === 'idempotent-committed-replay'
      || replayStatus === 'restart-recovery-pending',
    idempotency: {
      requestedKey: clientRequestState.idempotencyKey,
      storedKey: storedIdempotencyKey,
      matches: idempotencyMatches
    },
    storedCommand: {
      requestId: storedRequestId,
      action: storedAction,
      actionMatches,
      scopeMatches,
      revision: storedRevision,
      revisionMatches
    },
    storedScope: {
      tenantId: storedTenantId,
      workspaceId: storedWorkspaceId,
      artifactId: storedArtifactId
    },
    record: {
      recordId: storedRecordId,
      digest: storedRecordDigest,
      transition: storedTransition,
      lastCommittedAt,
      recoveredAt
    },
    restartRecovery,
    normalizedAt: now
  };
}

function normalizeRecoveryJournalEntries(entries, fallbackNow) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const rawStep = textOrNull(entry.step) || textOrNull(entry.type) || textOrNull(entry.event) || 'recovery-started';
      const step = rawStep.toLowerCase();
      const at = textOrNull(entry.at) || textOrNull(entry.timestamp) || textOrNull(entry.generatedAt) || fallbackNow;

      return {
        ordinal: index + 1,
        step: VALID_RECOVERY_JOURNAL_STEPS.has(step) ? step : 'recovery-started',
        rawStep,
        at,
        requestId: textOrNull(entry.requestId),
        idempotencyKey: textOrNull(entry.idempotencyKey),
        recordId: textOrNull(entry.recordId) || textOrNull(entry.quarantineRecordId),
        digest: textOrNull(entry.digest) || textOrNull(entry.recordDigest),
        checkpointId: textOrNull(entry.checkpointId) || textOrNull(entry.cursor),
        ok: entry.ok !== false && entry.failed !== true,
        message: textOrNull(entry.message) || textOrNull(entry.reason)
      };
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.ordinal - right.ordinal);
}

function buildRestartRecoveryState({
  scope,
  action,
  clientRequestState,
  artifactState,
  state,
  replayStatus,
  storedAction,
  storedRequestId,
  storedIdempotencyKey,
  storedRevision,
  storedRecordId,
  storedRecordDigest,
  storedTransition,
  lastCommittedAt,
  recoveredAt,
  scopeMatches,
  actionMatches,
  revisionMatches,
  recoveryJournal,
  now
}) {
  const requestedTransition = artifactState.transition;
  const commandFingerprint = [
    scope.tenantId || 'missing-tenant',
    scope.workspaceId || 'missing-workspace',
    scope.artifactId || 'missing-artifact',
    action,
    clientRequestState.idempotencyKey,
    artifactState.revision || 'unversioned',
    requestedTransition
  ].map((part) => encodeURIComponent(part)).join(':');
  const journalSteps = new Set(recoveryJournal.map((entry) => entry.step));
  const intentDurable = state !== 'missing' || journalSteps.has('intent-written');
  const commitStarted = state === 'commit-pending' || journalSteps.has('store-commit-started');
  const storeCommitConfirmed = state === 'committed' || journalSteps.has('store-commit-confirmed');
  const auditConfirmed = journalSteps.has('audit-emit-confirmed');
  const rollbackConfirmed = state === 'rolled-back' || journalSteps.has('rollback-confirmed');
  const failedJournalEntries = recoveryJournal.filter((entry) => !entry.ok);
  const resumeFromStep = replayStatus === 'new-command'
    ? 'persist-intent'
    : replayStatus === 'restart-recovery-pending'
      ? storeCommitConfirmed && !auditConfirmed
        ? 'emit-audit'
        : commitStarted && !storeCommitConfirmed
          ? 'verify-store-commit'
          : 'commit-record'
      : replayStatus === 'idempotent-committed-replay'
        ? 'return-committed-receipt'
        : rollbackConfirmed
          ? 'return-rollback-receipt'
          : 'block-for-reconcile';
  const status = replayStatus === 'idempotent-committed-replay'
    ? 'stable-committed'
    : replayStatus === 'restart-recovery-pending'
      ? 'recoverable-in-flight'
      : replayStatus === 'new-command'
        ? 'intent-required'
        : replayStatus === 'prior-state-observed'
          ? 'observe-only'
          : 'blocked';
  const commands = [
    {
      name: 'persist-intent',
      idempotent: true,
      enabled: replayStatus === 'new-command',
      idempotencyKey: clientRequestState.idempotencyKey,
      expectedState: 'intent-persisted'
    },
    {
      name: 'verify-store-commit',
      idempotent: true,
      enabled: resumeFromStep === 'verify-store-commit',
      idempotencyKey: storedIdempotencyKey || clientRequestState.idempotencyKey,
      expectedState: 'commit-pending'
    },
    {
      name: 'commit-record',
      idempotent: true,
      enabled: resumeFromStep === 'commit-record',
      idempotencyKey: storedIdempotencyKey || clientRequestState.idempotencyKey,
      expectedState: 'committed'
    },
    {
      name: 'emit-audit',
      idempotent: true,
      enabled: resumeFromStep === 'emit-audit',
      idempotencyKey: storedIdempotencyKey || clientRequestState.idempotencyKey,
      expectedState: 'committed'
    },
    {
      name: 'return-committed-receipt',
      idempotent: true,
      enabled: replayStatus === 'idempotent-committed-replay',
      idempotencyKey: storedIdempotencyKey || clientRequestState.idempotencyKey,
      expectedState: 'committed'
    }
  ];

  return {
    schema: 'artifact-filesystem.quarantine-record.restart-recovery.v1',
    status,
    resumeFromStep,
    commandFingerprint,
    restartSafe: replayStatus === 'new-command'
      || replayStatus === 'restart-recovery-pending'
      || replayStatus === 'idempotent-committed-replay',
    durableIntentPresent: intentDurable,
    storeCommitStarted: commitStarted,
    storeCommitConfirmed,
    auditConfirmed,
    rollbackConfirmed,
    failedJournalEntryCount: failedJournalEntries.length,
    checkpoint: {
      generatedAt: now,
      requestedRequestId: clientRequestState.requestId,
      storedRequestId,
      requestedIdempotencyKey: clientRequestState.idempotencyKey,
      storedIdempotencyKey,
      requestedAction: action,
      storedAction,
      requestedTransition,
      storedTransition,
      artifactRevision: artifactState.revision,
      storedRevision,
      recordId: storedRecordId,
      recordDigest: storedRecordDigest,
      lastCommittedAt,
      recoveredAt
    },
    comparison: {
      scopeMatches,
      actionMatches,
      revisionMatches,
      transitionMatches: !storedTransition || storedTransition === requestedTransition
    },
    commands,
    nextCommand: commands.find((command) => command.enabled)?.name || resumeFromStep,
    journal: recoveryJournal
  };
}

function validatePersistedState(persistedState) {
  const errors = [];

  if (!persistedState.stateRecognized) {
    errors.push({
      code: 'invalid-persisted-command-state',
      field: 'persistedState.state',
      message: `Unsupported persisted quarantine command state "${persistedState.rawState}".`,
      expected: [...VALID_PERSISTED_COMMAND_STATES].sort()
    });
  }

  if (persistedState.replayStatus === 'idempotency-conflict') {
    errors.push({
      code: 'idempotency-conflict',
      field: 'client.idempotencyKey',
      message: 'The idempotency key is already associated with a different quarantine command or scope.'
    });
  }

  if (persistedState.replayStatus === 'stored-revision-stale') {
    errors.push({
      code: 'stale-persisted-artifact-revision',
      field: 'persistedState.artifactRevision',
      message: 'Persisted quarantine state was written for a different artifact revision and must be reconciled before committing.'
    });
  }

  if (persistedState.restartRecovery.status === 'recoverable-in-flight'
    && persistedState.restartRecovery.resumeFromStep === 'emit-audit'
    && !persistedState.restartRecovery.checkpoint.recordId) {
    errors.push({
      code: 'recovery-record-id-missing',
      field: 'persistedState.recordId',
      message: 'Recovered quarantine commits that have reached audit emission require a persisted record id.'
    });
  }

  return errors;
}

function validateArtifactStateContract(artifactState, action) {
  const errors = [];

  if (!artifactState.stateRecognized) {
    errors.push({
      code: 'invalid-artifact-quarantine-state',
      field: 'artifact.quarantine.state',
      message: `Unsupported artifact quarantine state "${artifactState.rawState}".`,
      expected: [...VALID_ARTIFACT_QUARANTINE_STATES].sort()
    });
  }

  if (!artifactState.transitionAllowed) {
    errors.push({
      code: 'invalid-quarantine-state-transition',
      field: 'artifact.quarantine.state',
      message: `Cannot perform quarantine action "${action}" from artifact state "${artifactState.currentState}".`,
      expected: [...(ACTION_ALLOWED_STATES[action] || ACTION_ALLOWED_STATES.record)].sort()
    });
  }

  if (action === 'release' && artifactState.releaseAuthorizationIds.length === 0) {
    errors.push({
      code: 'missing-release-authorization',
      field: 'evidence',
      message: 'Release actions require release-authorization or operator-approval evidence linked into the artifact state transition.'
    });
  }

  return errors;
}

function buildArtifactTransitionProof({ scope, actorId, action, allowed, artifactState, evidence, providerSyncState, clientRequestState, persistedState, now }) {
  return {
    schema: 'artifact-filesystem.quarantine-record.transition-proof.v1',
    generatedAt: now,
    scopedKey: `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`,
    actorId,
    action,
    decision: allowed ? 'commit-transition' : 'block-transition',
    fromState: artifactState.currentState,
    toState: allowed ? artifactState.nextState : artifactState.currentState,
    transition: allowed ? artifactState.transition : `${artifactState.currentState}->${artifactState.currentState}`,
    artifactRevision: artifactState.revision,
    artifactDigest: artifactState.contentDigest,
    previousQuarantineRecordId: artifactState.quarantineRecordId,
    previousQuarantineRecordDigest: artifactState.currentRecordDigest,
    persistedRecordId: persistedState.record.recordId,
    persistedRecordDigest: persistedState.record.digest,
    persistedReplayStatus: persistedState.replayStatus,
    restartSafe: persistedState.restartSafe,
    restartRecoveryStatus: persistedState.restartRecovery.status,
    restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
    commandFingerprint: persistedState.restartRecovery.commandFingerprint,
    releaseAuthorizationIds: artifactState.releaseAuthorizationIds,
    evidenceRefs: evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      digest: item.digest || null
    })),
    providerSyncStatus: providerSyncState.syncStatus,
    providerSyncState: providerSyncState.syncMetadata.state,
    providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
    selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
    clientRequestId: clientRequestState.requestId
  };
}

function validateClientRequestState(clientState, scope) {
  const errors = [];
  const routeChecks = [
    ['tenantId', clientState.routeParams.tenantId, scope.tenantId, 'client.route.tenantId'],
    ['workspaceId', clientState.routeParams.workspaceId, scope.workspaceId, 'client.route.workspaceId'],
    ['artifactId', clientState.routeParams.artifactId, scope.artifactId, 'client.route.artifactId']
  ];

  if (!VALID_CLIENT_ACK_STATES.has(clientState.ackState)) {
    errors.push({
      code: 'invalid-client-ack-state',
      field: 'client.ackState',
      message: `Unsupported client acknowledgement state "${clientState.ackState}".`,
      expected: [...VALID_CLIENT_ACK_STATES].sort()
    });
  }

  if (clientState.idempotencyKey.length > 240) {
    errors.push({
      code: 'client-idempotency-key-too-long',
      field: 'client.idempotencyKey',
      message: 'Client idempotency keys must be 240 characters or fewer.'
    });
  }

  for (const [, routeValue, scopeValue, field] of routeChecks) {
    if (routeValue && scopeValue && routeValue !== scopeValue) {
      errors.push({
        code: 'client-route-scope-mismatch',
        field,
        message: 'Client route parameters must match the quarantine record scope before handoff.'
      });
    }
  }

  if (clientState.staleRevision) {
    errors.push({
      code: 'stale-client-artifact-revision',
      field: 'client.expectedArtifactRevision',
      message: 'Client artifact revision is stale; refresh artifact state before submitting quarantine workflow changes.'
    });
  }

  return errors;
}

function validateProviderContract(providerContract, now) {
  const errors = [];
  const endpointErrors = providerContract.serviceEndpoints
    .filter((endpoint) => !endpoint.validPurpose || !endpoint.validProtocol || (providerContract.required && !endpoint.url));
  const handoffEndpointAvailable = providerContract.serviceEndpoints
    .some((endpoint) => (endpoint.purpose === 'handoff' || endpoint.purpose === 'sync') && endpoint.url && endpoint.validProtocol);
  const handoffStateRequiresTarget = providerContract.externalHandoff.state === 'ready'
    || providerContract.externalHandoff.state === 'pending';
  const leaseExpiresAtMs = Date.parse(providerContract.externalHandoff.leaseExpiresAt);

  if (!providerContract.providerId) {
    errors.push({
      code: 'missing-provider-id',
      field: 'provider.providerId',
      message: 'External quarantine provider contracts require a providerId.'
    });
  }

  if (endpointErrors.length) {
    errors.push({
      code: 'invalid-provider-endpoint-contract',
      field: 'provider.endpoints',
      message: 'Provider service endpoints must use a supported purpose, protocol, and URL when the provider contract is required.',
      expected: {
        purposes: [...VALID_PROVIDER_ENDPOINT_PURPOSES].sort(),
        protocols: [...VALID_PROVIDER_ENDPOINT_PROTOCOLS].sort()
      }
    });
  }

  if (!VALID_EXTERNAL_HANDOFF_STATES.has(providerContract.externalHandoff.state)) {
    errors.push({
      code: 'invalid-external-handoff-state',
      field: 'provider.externalHandoff.state',
      message: `Unsupported external handoff state "${providerContract.externalHandoff.state}".`,
      expected: [...VALID_EXTERNAL_HANDOFF_STATES].sort()
    });
  }

  if (handoffStateRequiresTarget && !providerContract.externalHandoff.endpoint && !handoffEndpointAvailable) {
    errors.push({
      code: 'external-handoff-target-missing',
      field: 'provider.externalHandoff.endpoint',
      message: 'Ready or pending external handoffs require either an external handoff endpoint or a negotiated provider handoff/sync endpoint.'
    });
  }

  if (providerContract.externalHandoff.state === 'accepted' && !providerContract.externalHandoff.receiptId) {
    errors.push({
      code: 'external-handoff-receipt-missing',
      field: 'provider.externalHandoff.receiptId',
      message: 'Accepted external handoffs must include a receipt id for audit replay and recovery.'
    });
  }

  if (providerContract.externalHandoff.leaseExpiresAt && (!Number.isFinite(leaseExpiresAtMs) || leaseExpiresAtMs <= Date.parse(now))) {
    errors.push({
      code: 'external-handoff-lease-expired',
      field: 'provider.externalHandoff.leaseExpiresAt',
      message: 'External handoff leases must be valid future timestamps before the quarantine workflow can continue.'
    });
  }

  if (providerContract.syncMetadata.state === 'conflict') {
    errors.push({
      code: 'provider-sync-conflict',
      field: 'provider.syncMetadata.state',
      message: 'Provider sync metadata reports a conflict; reconcile the checkpoint before committing quarantine state.'
    });
  }

  if (providerContract.syncMetadata.state === 'failed') {
    errors.push({
      code: 'provider-sync-failed',
      field: 'provider.syncMetadata.state',
      message: 'Provider sync metadata reports a failed checkpoint; retry or recover the provider handoff before continuing.'
    });
  }

  if (providerContract.required && providerContract.missingCapabilities.length) {
    errors.push({
      code: 'provider-capability-missing',
      field: 'provider.capabilities',
      message: 'Provider contract does not advertise every capability required for this quarantine action.',
      expected: providerContract.requiredCapabilities,
      missing: providerContract.missingCapabilities
    });
  }

  if (providerContract.externalHandoff.state === 'failed' || providerContract.externalHandoff.state === 'blocked') {
    errors.push({
      code: 'external-handoff-blocked',
      field: 'provider.externalHandoff.state',
      message: providerContract.externalHandoff.failureCode
        ? `External quarantine handoff is blocked by ${providerContract.externalHandoff.failureCode} and must be reconciled before this action can complete.`
        : 'External quarantine handoff is blocked and must be reconciled before this action can complete.'
    });
  }

  return errors;
}

function buildCustodyBoundaryContract({ input = {}, scope, actorId, actorBoundary, providerContract, clientRequestState, persistedState, now }) {
  const source = input.custody && typeof input.custody === 'object'
    ? input.custody
    : input.handoffCustody && typeof input.handoffCustody === 'object'
      ? input.handoffCustody
      : input.auditCustody && typeof input.auditCustody === 'object'
        ? input.auditCustody
        : {};
  const expectedPartitionKey = `${scope.tenantId || 'missing-tenant'}/${scope.workspaceId || 'missing-workspace'}`;
  const expectedScopedKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`;
  const expectedWorkspaceKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}`;
  const requestedPartitionKey = textOrNull(source.partitionKey) || textOrNull(input.partitionKey);
  const requestedScopedKey = textOrNull(source.scopedKey) || textOrNull(source.recordKey) || textOrNull(input.scopedKey);
  const requestedIsolationKey = textOrNull(source.isolationKey) || textOrNull(source.handoffIsolationKey);
  const externalHandoff = providerContract.externalHandoff;
  const persistedScopeDeclared = Boolean(
    persistedState.storedScope.tenantId
      || persistedState.storedScope.workspaceId
      || persistedState.storedScope.artifactId
  );
  const persistedScopeMatches = !persistedScopeDeclared || (
    (!persistedState.storedScope.tenantId || persistedState.storedScope.tenantId === scope.tenantId)
      && (!persistedState.storedScope.workspaceId || persistedState.storedScope.workspaceId === scope.workspaceId)
      && (!persistedState.storedScope.artifactId || persistedState.storedScope.artifactId === scope.artifactId)
  );
  const externalTenantMatches = !externalHandoff.tenantId || externalHandoff.tenantId === scope.tenantId;
  const externalWorkspaceMatches = !externalHandoff.workspaceId || externalHandoff.workspaceId === scope.workspaceId;
  const externalPartitionMatches = !externalHandoff.partitionKey || externalHandoff.partitionKey === expectedPartitionKey;
  const externalScopedKeyMatches = !externalHandoff.scopedKey || externalHandoff.scopedKey === expectedScopedKey;
  const externalIsolationMatches = !externalHandoff.isolationKey || externalHandoff.isolationKey === actorBoundary.handoffIsolationKey;
  const requestedPartitionMatches = !requestedPartitionKey || requestedPartitionKey === expectedPartitionKey;
  const requestedScopedKeyMatches = !requestedScopedKey || requestedScopedKey === expectedScopedKey || requestedScopedKey === expectedWorkspaceKey;
  const requestedIsolationMatches = !requestedIsolationKey || requestedIsolationKey === actorBoundary.handoffIsolationKey;
  const clientScopeMatches = Object.values(clientRequestState.routeParams).every((value) => !value)
    || (
      (!clientRequestState.routeParams.tenantId || clientRequestState.routeParams.tenantId === scope.tenantId)
        && (!clientRequestState.routeParams.workspaceId || clientRequestState.routeParams.workspaceId === scope.workspaceId)
        && (!clientRequestState.routeParams.artifactId || clientRequestState.routeParams.artifactId === scope.artifactId)
    );
  const violationChecks = [
    ['custody-partition-mismatch', requestedPartitionMatches],
    ['custody-scoped-key-mismatch', requestedScopedKeyMatches],
    ['custody-isolation-key-mismatch', requestedIsolationMatches],
    ['provider-handoff-tenant-mismatch', externalTenantMatches],
    ['provider-handoff-workspace-mismatch', externalWorkspaceMatches],
    ['provider-handoff-partition-mismatch', externalPartitionMatches],
    ['provider-handoff-scoped-key-mismatch', externalScopedKeyMatches],
    ['provider-handoff-isolation-mismatch', externalIsolationMatches],
    ['persisted-custody-scope-mismatch', persistedScopeMatches],
    ['client-custody-route-mismatch', clientScopeMatches]
  ];
  const violations = violationChecks
    .filter(([, passed]) => !passed)
    .map(([code]) => code);

  return {
    schema: 'artifact-filesystem.quarantine-record.custody-boundary.v1',
    generatedAt: now,
    status: violations.length ? 'blocked' : 'satisfied',
    expected: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      artifactId: scope.artifactId,
      partitionKey: expectedPartitionKey,
      scopedKey: expectedScopedKey,
      workspaceScopedKey: expectedWorkspaceKey,
      handoffIsolationKey: actorBoundary.handoffIsolationKey
    },
    requested: {
      partitionKey: requestedPartitionKey,
      scopedKey: requestedScopedKey,
      isolationKey: requestedIsolationKey,
      actorId
    },
    persistedScope: {
      declared: persistedScopeDeclared,
      matches: persistedScopeMatches,
      tenantId: persistedState.storedScope.tenantId,
      workspaceId: persistedState.storedScope.workspaceId,
      artifactId: persistedState.storedScope.artifactId,
      replayStatus: persistedState.replayStatus
    },
    externalHandoffScope: {
      state: externalHandoff.state,
      tenantId: externalHandoff.tenantId,
      workspaceId: externalHandoff.workspaceId,
      partitionKey: externalHandoff.partitionKey,
      scopedKey: externalHandoff.scopedKey,
      isolationKey: externalHandoff.isolationKey
    },
    checks: {
      requestedPartitionMatches,
      requestedScopedKeyMatches,
      requestedIsolationMatches,
      externalTenantMatches,
      externalWorkspaceMatches,
      externalPartitionMatches,
      externalScopedKeyMatches,
      externalIsolationMatches,
      persistedScopeMatches,
      clientScopeMatches
    },
    violations,
    auditPartition: {
      stream: 'artifact-filesystem.quarantine-record',
      partitionKey: expectedPartitionKey,
      dedupeKey: `${expectedScopedKey}:${clientRequestState.idempotencyKey}`,
      custodyRoute: `/kernel/tenants/${encodeURIComponent(scope.tenantId || 'missing-tenant')}/workspaces/${encodeURIComponent(scope.workspaceId || 'missing-workspace')}/artifacts/${encodeURIComponent(scope.artifactId || 'missing-artifact')}/quarantine-record/custody`
    }
  };
}

function validateCustodyBoundary(custodyBoundary) {
  return custodyBoundary.violations.map((code) => ({
    code,
    field: code.startsWith('provider-handoff') ? 'provider.externalHandoff' : 'custody',
    message: 'Quarantine custody scope must remain inside the requested tenant/workspace/artifact boundary.'
  }));
}

function buildProviderSyncState({ providerContract, allowed, health, retryPlan, now }) {
  const handoff = providerContract.externalHandoff;
  const syncMetadata = providerContract.syncMetadata;
  const handoffEndpoint = providerContract.serviceEndpoints.find((endpoint) => endpoint.purpose === 'handoff' && endpoint.url)
    || providerContract.serviceEndpoints.find((endpoint) => endpoint.purpose === 'sync' && endpoint.url)
    || null;
  const handoffRequired = handoff.state !== 'not-required' || providerContract.requiredCapabilities.includes('external.handoff.track');
  const blocked = providerContract.missingCapabilities.length > 0
    || handoff.state === 'failed'
    || handoff.state === 'blocked'
    || syncMetadata.state === 'conflict'
    || syncMetadata.state === 'failed';
  const syncStatus = blocked
    ? 'blocked'
    : health.degradedMode
      ? 'deferred'
      : allowed && handoffRequired
        ? handoff.state === 'accepted'
          ? 'synced'
          : 'handoff-pending'
        : allowed
          ? 'local-commit-ready'
          : retryPlan.retryable
            ? 'retry-pending'
            : 'not-synced';

  return {
    schema: 'artifact-filesystem.quarantine-record.provider-sync.v1',
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    syncStatus,
    handoffRequired,
    syncMetadata,
    serviceEndpoints: providerContract.serviceEndpoints,
    selectedHandoffEndpoint: handoffEndpoint,
    externalHandoff: handoff,
    metadata: {
      negotiatedCapabilityCount: providerContract.effectiveCapabilities.length,
      requiredCapabilityCount: providerContract.requiredCapabilities.length,
      missingCapabilityCount: providerContract.missingCapabilities.length,
      endpointCount: providerContract.serviceEndpoints.length,
      validEndpointCount: providerContract.serviceEndpoints.filter((endpoint) => endpoint.validPurpose && endpoint.validProtocol && endpoint.url).length,
      syncDirty: syncMetadata.dirty,
      syncCheckpointId: syncMetadata.checkpointId,
      generatedAt: now,
      nextSyncAfter: retryPlan.nextAttemptNotBefore
    }
  };
}

function buildAnalyticsCounters({ allowed, action, reasons, evidence, health, deniedReasons, validationErrors, historySnapshots, persistedState }) {
  const reasonCounts = Object.fromEntries(reasons.map((reason) => [reason, 1]));
  const denialCounts = Object.fromEntries(deniedReasons.map((reason) => [reason, 1]));

  for (const snapshot of historySnapshots) {
    for (const reason of snapshot.quarantineReasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    for (const reason of snapshot.deniedReasons) {
      denialCounts[reason] = (denialCounts[reason] || 0) + 1;
    }
  }

  return {
    totalSnapshots: historySnapshots.length + 1,
    allowedRecords: historySnapshots.filter((snapshot) => snapshot.decision === 'allow').length + (allowed ? 1 : 0),
    deniedRecords: historySnapshots.filter((snapshot) => snapshot.decision === 'deny').length + (allowed ? 0 : 1),
    currentAction: action,
    currentEvidenceCount: evidence.length,
    currentReasonCount: reasons.length,
    currentDeniedReasonCount: deniedReasons.length,
    validationErrorCount: validationErrors.length,
    degradedDependencyCount: health.degraded.length,
    unavailableDependencyCount: health.unavailable.length,
    restartSafeCommand: persistedState.restartSafe ? 1 : 0,
    idempotentReplayCount: persistedState.replayStatus === 'idempotent-committed-replay' ? 1 : 0,
    recoveryPendingCount: persistedState.replayStatus === 'restart-recovery-pending' ? 1 : 0,
    recoveryJournalEntryCount: persistedState.restartRecovery.journal.length,
    recoveryFailedJournalEntryCount: persistedState.restartRecovery.failedJournalEntryCount,
    reasonCounts,
    denialCounts
  };
}

function buildTimeline({ now, scope, actorId, allowed, reasons, evidence, health, deniedReasons, retryPlan, historySnapshots, lifecycleControl, providerSyncState, clientRequestState, persistedState, actorBoundary, custodyBoundary, artifactTransitionProof, operationalIncident }) {
  const historyEvents = historySnapshots.map((snapshot) => ({
    at: snapshot.generatedAt,
    type: 'quarantine.snapshot',
    action: snapshot.action,
    decision: snapshot.decision || 'unknown',
    status: snapshot.status || 'unknown',
    deniedReasons: snapshot.deniedReasons,
    evidenceCount: snapshot.evidenceCount
  }));

  return [
    ...historyEvents,
    {
      at: now,
      type: 'quarantine.request.received',
      action: scope.action,
      actorId,
      scopedKey: `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`,
      requestId: clientRequestState.requestId,
      idempotencyKey: clientRequestState.idempotencyKey,
      clientAckState: clientRequestState.ackState
    },
    {
      at: now,
      type: allowed ? 'quarantine.record.accepted' : 'quarantine.record.denied',
      decision: allowed ? 'allow' : 'deny',
      quarantineReasons: reasons,
      deniedReasons,
      evidenceCount: evidence.length,
      healthState: health.degradedMode ? 'degraded' : 'healthy'
    },
    {
      at: lifecycleControl.nextAction.availableAt,
      type: 'quarantine.lifecycle.next-action',
      command: lifecycleControl.command,
      state: lifecycleControl.nextAction.state,
      reason: lifecycleControl.nextAction.reason,
      scheduleMode: lifecycleControl.schedule.mode
    },
    {
      at: persistedState.record.lastCommittedAt || persistedState.record.recoveredAt || now,
      type: 'quarantine.persisted-state.replayed',
      state: persistedState.state,
      replayStatus: persistedState.replayStatus,
      restartSafe: persistedState.restartSafe,
      restartRecoveryStatus: persistedState.restartRecovery.status,
      restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint,
      storedRequestId: persistedState.storedCommand.requestId,
      storedAction: persistedState.storedCommand.action,
      storedRecordId: persistedState.record.recordId
    },
    {
      at: now,
      type: 'quarantine.provider.sync-state',
      providerId: providerSyncState.providerId,
      syncStatus: providerSyncState.syncStatus,
      handoffRequired: providerSyncState.handoffRequired,
      syncState: providerSyncState.syncMetadata.state,
      checkpointId: providerSyncState.syncMetadata.checkpointId,
      selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
      missingCapabilityCount: providerSyncState.metadata.missingCapabilityCount
    },
    {
      at: operationalIncident.generatedAt,
      type: 'quarantine.operational.incident',
      severity: operationalIncident.severity,
      failureState: operationalIncident.failureState,
      recoveryAction: operationalIncident.recoveryAction,
      runbookAction: operationalIncident.operatorRunbook.action,
      escalation: operationalIncident.operatorRunbook.escalation,
      primaryErrorCode: operationalIncident.errorSummary.primaryCode,
      safeToReleaseArtifact: operationalIncident.safeToReleaseArtifact,
      writeIntentRequired: operationalIncident.writeIntentRequired,
      retryAfterMs: operationalIncident.retry.retryAfterMs
    },
    {
      at: now,
      type: 'quarantine.client.workflow-state',
      routeIntent: clientRequestState.surfaceRoute,
      staleRevision: clientRequestState.staleRevision,
      offlineQueued: clientRequestState.optimisticClientState.offlineQueued,
      acknowledgedRiskCodes: clientRequestState.acknowledgedRiskCodes
    },
    {
      at: now,
      type: 'quarantine.actor.boundary-proof',
      mode: actorBoundary.mode,
      status: actorBoundary.status,
      scopedKey: actorBoundary.scopedKey,
      handoffIsolationKey: actorBoundary.handoffIsolationKey,
      deniedReasons: actorBoundary.deniedReasons
    },
    {
      at: custodyBoundary.generatedAt,
      type: 'quarantine.custody.boundary-proof',
      status: custodyBoundary.status,
      partitionKey: custodyBoundary.expected.partitionKey,
      scopedKey: custodyBoundary.expected.scopedKey,
      violationCount: custodyBoundary.violations.length,
      violations: custodyBoundary.violations
    },
    {
      at: artifactTransitionProof.generatedAt,
      type: 'quarantine.artifact.transition-proof',
      decision: artifactTransitionProof.decision,
      fromState: artifactTransitionProof.fromState,
      toState: artifactTransitionProof.toState,
      transition: artifactTransitionProof.transition,
      evidenceRefCount: artifactTransitionProof.evidenceRefs.length
    },
    ...(retryPlan.nextAttemptNotBefore ? [{
      at: retryPlan.nextAttemptNotBefore,
      type: 'quarantine.retry.available',
      retryAfterMs: retryPlan.retryAfterMs,
      strategy: retryPlan.strategy
    }] : [])
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function countBy(values, fallbackKey = 'unknown') {
  return values.reduce((counts, value) => {
    const key = textOrNull(value) || fallbackKey;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function isoDay(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : 'unknown-date';
}

function exportLineageKey(...parts) {
  return parts
    .map((part) => encodeURIComponent(textOrNull(part) || 'missing'))
    .join(':');
}

function buildAnalyticsExportManifest({ now, scope, actorId, allowed, reasons, evidence, deniedReasons, timeline, historySnapshots, analyticsCounters, clientRequestState, providerSyncState, persistedState, custodyBoundary, artifactTransitionProof, operationalIncident }) {
  const partitionKey = `${scope.tenantId || 'missing-tenant'}/${scope.workspaceId || 'missing-workspace'}`;
  const scopedKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`;
  const snapshotFingerprints = [
    ...historySnapshots.map((snapshot) => snapshot.exportFingerprint),
    exportLineageKey(
      scopedKey,
      clientRequestState.requestId,
      scope.action,
      allowed ? 'allow' : 'deny',
      artifactTransitionProof.transition,
      persistedState.replayStatus
    )
  ];
  const deniedReasonFingerprints = uniqueDeniedReasonExportRows({ deniedReasons, scope, now, scopedKey, clientRequestState });
  const timelineCursor = timeline.length
    ? exportLineageKey(scopedKey, timeline[timeline.length - 1].at, timeline[timeline.length - 1].type, timeline.length)
    : exportLineageKey(scopedKey, now, 'empty-timeline', 0);
  const evidenceDigestCount = evidence.filter((item) => item.digest).length;

  return {
    schema: EXPORT_SCHEMA_VERSION,
    generatedAt: now,
    partitionKey,
    scopedKey,
    lineage: {
      exportId: exportLineageKey(scopedKey, clientRequestState.requestId, now),
      batchKey: exportLineageKey(partitionKey, isoDay(now), providerSyncState.providerId),
      incrementalCursor: timelineCursor,
      requestId: clientRequestState.requestId,
      idempotencyKey: clientRequestState.idempotencyKey,
      actorId,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint,
      transitionFingerprint: exportLineageKey(scopedKey, artifactTransitionProof.transition, artifactTransitionProof.decision),
      currentSnapshotFingerprint: exportLineageKey(
        scopedKey,
        clientRequestState.requestId,
        clientRequestState.idempotencyKey,
        scope.action,
        allowed ? 'allow' : 'deny',
        artifactTransitionProof.transition,
        persistedState.replayStatus
      )
    },
    columns: EXPORT_COLUMNS,
    quality: {
      ready: custodyBoundary.status === 'satisfied' && persistedState.restartSafe,
      decisionComplete: typeof allowed === 'boolean' && Boolean(artifactTransitionProof.decision),
      evidenceDigestCoverage: evidence.length ? evidenceDigestCount / evidence.length : 1,
      missingDigestCount: Math.max(0, evidence.length - evidenceDigestCount),
      deniedReasonRows: deniedReasonFingerprints.length,
      historyFingerprintCount: snapshotFingerprints.filter(Boolean).length,
      duplicateHistoryFingerprintCount: snapshotFingerprints.length - new Set(snapshotFingerprints.filter(Boolean)).size,
      operationalSeverity: operationalIncident.severity,
      custodyStatus: custodyBoundary.status,
      persistedReplayStatus: persistedState.replayStatus
    },
    rollups: {
      totalSnapshots: analyticsCounters.totalSnapshots,
      allowedRecords: analyticsCounters.allowedRecords,
      deniedRecords: analyticsCounters.deniedRecords,
      currentReasonCount: reasons.length,
      currentDeniedReasonCount: deniedReasons.length,
      timelineEventCount: timeline.length,
      providerSyncStatus: providerSyncState.syncStatus,
      artifactTransition: artifactTransitionProof.transition
    },
    rows: {
      deniedReasons: deniedReasonFingerprints,
      evidence: evidence.map((item, index) => ({
        ordinal: index + 1,
        scopedKey,
        evidenceId: item.id,
        kind: item.kind,
        digest: item.digest || null,
        exportKey: exportLineageKey(scopedKey, clientRequestState.requestId, item.id, item.digest || item.kind)
      })),
      historyFingerprints: snapshotFingerprints.filter(Boolean).map((fingerprint, index) => ({
        ordinal: index + 1,
        fingerprint
      }))
    }
  };
}

function uniqueDeniedReasonExportRows({ deniedReasons, scope, now, scopedKey, clientRequestState }) {
  return deniedReasons.map((reason, index) => ({
    ordinal: index + 1,
    scopedKey,
    generatedAt: now,
    action: scope.action,
    reason,
    requestId: clientRequestState.requestId,
    exportKey: exportLineageKey(scopedKey, clientRequestState.requestId, scope.action, reason)
  }));
}

function buildReportingState({ now, scope, actorId, allowed, reasons, evidence, health, deniedReasons, analyticsCounters, analyticsExportManifest, timeline, historySnapshots, lifecycleControl, providerSyncState, clientRequestState, persistedState, custodyBoundary, artifactTransitionProof, clientRouteCommand, operationalIncident }) {
  const scopedKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`;
  const currentSnapshot = {
    id: clientRequestState.requestId,
    generatedAt: now,
    action: scope.action,
    decision: allowed ? 'allow' : 'deny',
    status: allowed ? artifactTransitionProof.toState : artifactTransitionProof.fromState,
    deniedReasons,
    quarantineReasons: reasons,
    evidenceCount: evidence.length,
    providerSyncStatus: providerSyncState.syncStatus,
    persistedReplayStatus: persistedState.replayStatus,
    artifactTransition: artifactTransitionProof.transition,
    exportFingerprint: analyticsExportManifest.lineage.currentSnapshotFingerprint,
    source: 'current-request',
    requestId: clientRequestState.requestId,
    idempotencyKey: clientRequestState.idempotencyKey
  };
  const snapshots = [...historySnapshots, currentSnapshot];
  const snapshotDays = [...new Set(snapshots.map((snapshot) => isoDay(snapshot.generatedAt)))].sort();
  const timelineEventCounts = countBy(timeline.map((event) => event.type));
  const timelineDecisionCounts = countBy(timeline.map((event) => event.decision).filter(Boolean));
  const pendingTimeline = timeline.filter((event) => Date.parse(event.at) > Date.parse(now));
  const lastTimelineEvent = timeline[timeline.length - 1] || null;
  const priorEvidenceCount = historySnapshots.reduce((sum, snapshot) => sum + snapshot.evidenceCount, 0);
  const priorDeniedCount = historySnapshots.filter((snapshot) => snapshot.decision === 'deny').length;
  const flatSummaryRow = {
    schema: 'artifact-filesystem.quarantine-record.export-row.v1',
    generatedAt: now,
    partitionKey: `${scope.tenantId || 'missing-tenant'}/${scope.workspaceId || 'missing-workspace'}`,
    scopedKey,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    artifactId: scope.artifactId,
    actorId,
    action: scope.action,
    decision: currentSnapshot.decision,
    status: currentSnapshot.status,
    deniedReasonCount: deniedReasons.length,
    deniedReasons: deniedReasons.join('|'),
    quarantineReasons: reasons.join('|'),
    evidenceCount: evidence.length,
    evidenceDigests: evidence.map((item) => item.digest).filter(Boolean).join('|'),
    healthState: health.degradedMode ? 'degraded' : 'healthy',
    operationalSeverity: operationalIncident.severity,
    operationalFailureState: operationalIncident.failureState,
    operationalRecoveryAction: operationalIncident.recoveryAction,
    operationalRunbookAction: operationalIncident.operatorRunbook.action,
    operationalEscalation: operationalIncident.operatorRunbook.escalation,
    operationalPrimaryErrorCode: operationalIncident.errorSummary.primaryCode,
    degradedCapabilityMode: operationalIncident.degradedCapabilities.mode,
    writeIntentRequired: operationalIncident.writeIntentRequired,
    safeToReleaseArtifact: operationalIncident.safeToReleaseArtifact,
    retryAttemptsRemaining: operationalIncident.retry.budget.attemptsRemaining,
    operatorEscalationRequired: operationalIncident.retry.budget.operatorEscalationRequired,
    degradedDependencyCount: health.degraded.length,
    unavailableDependencyCount: health.unavailable.length,
    lifecycleState: lifecycleControl.state,
    lifecycleScheduleStatus: lifecycleControl.schedule.status,
    lifecycleControlPlaneStatus: lifecycleControl.controlPlane.status,
    lifecycleControlPolicyId: lifecycleControl.controlPlane.policyId,
    lifecycleControlAuditKey: lifecycleControl.controlPlane.auditKey,
    lifecycleControlChangeTicket: lifecycleControl.controlPlane.changeTicket,
    lifecycleCommandExecutionState: lifecycleControl.commandExecution.executionState,
    lifecycleCommandCanExecute: lifecycleControl.commandExecution.canExecute,
    nextAction: lifecycleControl.nextAction.state,
    nextActionAt: lifecycleControl.nextAction.availableAt,
    providerId: providerSyncState.providerId,
    providerSyncStatus: providerSyncState.syncStatus,
    externalHandoffState: providerSyncState.externalHandoff.state,
    providerSyncState: providerSyncState.syncMetadata.state,
    providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
    providerSyncDirty: providerSyncState.syncMetadata.dirty,
    selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
    requestId: clientRequestState.requestId,
    idempotencyKey: clientRequestState.idempotencyKey,
    clientAckState: clientRequestState.ackState,
    persistedState: persistedState.state,
    persistedReplayStatus: persistedState.replayStatus,
    restartSafe: persistedState.restartSafe,
    restartRecoveryStatus: persistedState.restartRecovery.status,
    restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
    commandFingerprint: persistedState.restartRecovery.commandFingerprint,
    custodyStatus: custodyBoundary.status,
    custodyViolationCount: custodyBoundary.violations.length,
    custodyPartitionKey: custodyBoundary.expected.partitionKey,
    custodyDedupeKey: custodyBoundary.auditPartition.dedupeKey,
    artifactTransition: artifactTransitionProof.transition,
    artifactFromState: artifactTransitionProof.fromState,
    artifactToState: artifactTransitionProof.toState,
    clientRouteState: clientRouteCommand.commandState,
    clientPrimaryCommand: clientRouteCommand.primaryCommand,
    clientSubmitEnabled: clientRouteCommand.submitEnabled,
    clientPreviewRoute: clientRouteCommand.routes.preview.href,
    clientAcceptRoute: clientRouteCommand.routes.accept.href,
    clientNextStepRoute: clientRouteCommand.routes.nextStep.href
  };

  return {
    schema: 'artifact-filesystem.quarantine-record.reporting-state.v1',
    generatedAt: now,
    scopedKey,
    currentSnapshot,
    historyWindow: {
      snapshotCount: snapshots.length,
      firstSnapshotAt: snapshots[0]?.generatedAt || now,
      lastSnapshotAt: snapshots[snapshots.length - 1]?.generatedAt || now,
      daysCovered: snapshotDays.length,
      dayBuckets: snapshotDays.map((day) => ({
        day,
        count: snapshots.filter((snapshot) => isoDay(snapshot.generatedAt) === day).length
      })),
      actionCounts: countBy(snapshots.map((snapshot) => snapshot.action)),
      decisionCounts: countBy(snapshots.map((snapshot) => snapshot.decision)),
      statusCounts: countBy(snapshots.map((snapshot) => snapshot.status))
    },
    periodDeltas: {
      evidenceCountDelta: evidence.length - priorEvidenceCount,
      deniedRecordDelta: (allowed ? 0 : 1) - priorDeniedCount,
      currentDeniedReasonCount: deniedReasons.length,
      reasonCounts: analyticsCounters.reasonCounts,
      denialCounts: analyticsCounters.denialCounts
    },
    timelineState: {
      eventCount: timeline.length,
      lastEventType: lastTimelineEvent?.type || null,
      lastEventAt: lastTimelineEvent?.at || null,
      pendingEventCount: pendingTimeline.length,
      pendingEventTypes: [...new Set(pendingTimeline.map((event) => event.type))],
      eventTypeCounts: timelineEventCounts,
      decisionCounts: timelineDecisionCounts,
      nextReportAt: lifecycleControl.nextAction.availableAt
    },
    exportPackage: {
      ready: true,
      manifest: analyticsExportManifest,
      formats: ['json', 'jsonl', 'csv'],
      columns: analyticsExportManifest.columns,
      summaryRow: flatSummaryRow,
      historyRows: snapshots.map((snapshot) => ({
        scopedKey,
        generatedAt: snapshot.generatedAt,
        action: snapshot.action,
        decision: snapshot.decision || 'unknown',
        status: snapshot.status || 'unknown',
        deniedReasons: snapshot.deniedReasons.join('|'),
        quarantineReasons: snapshot.quarantineReasons.join('|'),
        evidenceCount: snapshot.evidenceCount,
        exportFingerprint: snapshot.exportFingerprint,
        source: snapshot.source,
        requestId: snapshot.requestId || null,
        idempotencyKey: snapshot.idempotencyKey || null
      })),
      timelineRows: timeline.map((event, index) => ({
        scopedKey,
        ordinal: index + 1,
        at: event.at,
        type: event.type,
        action: event.action || scope.action,
        decision: event.decision || null,
        state: event.state || event.syncStatus || event.status || null,
        retryAfterMs: event.retryAfterMs || null
      })),
      clientRouteCommand
    }
  };
}

function buildExportSummary({ scope, actorId, allowed, reasons, evidence, health, deniedReasons, retryPlan, analyticsCounters, analyticsExportManifest, timeline, lifecycleControl, providerSyncState, clientRequestState, persistedState, workflowHandoff, actorBoundary, custodyBoundary, artifactTransitionProof, clientRouteCommand, operationalIncident }) {
  const reportStatus = allowed
    ? 'export-ready'
    : retryPlan.retryable
      ? 'export-ready-with-retry'
      : 'export-ready-denial';

  return {
    schema: 'artifact-filesystem.quarantine-record.export.v1',
    reportStatus,
    partitionKey: `${scope.tenantId || 'missing-tenant'}/${scope.workspaceId || 'missing-workspace'}`,
    recordKey: `${scope.artifactId || 'missing-artifact'}:${scope.action}`,
    actorId,
    decision: allowed ? 'allow' : 'deny',
    deniedReasons,
    quarantineReasons: reasons,
    evidenceDigests: evidence.map((item) => item.digest).filter(Boolean),
    analyticsExportManifest,
    exportLineage: analyticsExportManifest.lineage,
    exportQuality: analyticsExportManifest.quality,
    healthState: health.degradedMode ? 'degraded' : 'healthy',
    operationalSeverity: operationalIncident.severity,
    operationalFailureState: operationalIncident.failureState,
    operationalRecoveryAction: operationalIncident.recoveryAction,
    operationalRunbookAction: operationalIncident.operatorRunbook.action,
    operationalEscalation: operationalIncident.operatorRunbook.escalation,
    operationalPrimaryErrorCode: operationalIncident.errorSummary.primaryCode,
    degradedCapabilityMode: operationalIncident.degradedCapabilities.mode,
    retryAttemptsRemaining: operationalIncident.retry.budget.attemptsRemaining,
    operatorEscalationRequired: operationalIncident.retry.budget.operatorEscalationRequired,
    counters: analyticsCounters,
    timelineEventCount: timeline.length,
    retryable: retryPlan.retryable,
    lifecycleState: lifecycleControl.state,
    nextAction: lifecycleControl.nextAction.state,
    scheduledFor: lifecycleControl.schedule.scheduledFor,
    lifecycleControlPlaneStatus: lifecycleControl.controlPlane.status,
    lifecycleControlPolicyId: lifecycleControl.controlPlane.policyId,
    lifecycleControlAuditKey: lifecycleControl.controlPlane.auditKey,
    lifecycleControlChangeTicket: lifecycleControl.controlPlane.changeTicket,
    providerSyncStatus: providerSyncState.syncStatus,
    providerId: providerSyncState.providerId,
    externalHandoffState: providerSyncState.externalHandoff.state,
    providerSyncState: providerSyncState.syncMetadata.state,
    providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
    providerSyncDirty: providerSyncState.syncMetadata.dirty,
    selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
    clientRequestId: clientRequestState.requestId,
    clientAckState: clientRequestState.ackState,
    persistedState: persistedState.state,
    persistedReplayStatus: persistedState.replayStatus,
    restartSafe: persistedState.restartSafe,
    restartRecoveryStatus: persistedState.restartRecovery.status,
    restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
    commandFingerprint: persistedState.restartRecovery.commandFingerprint,
    persistedRecordId: persistedState.record.recordId,
    actorBoundaryStatus: actorBoundary.status,
    handoffIsolationKey: actorBoundary.handoffIsolationKey,
    custodyStatus: custodyBoundary.status,
    custodyViolationCount: custodyBoundary.violations.length,
    custodyPartitionKey: custodyBoundary.expected.partitionKey,
    custodyDedupeKey: custodyBoundary.auditPartition.dedupeKey,
    workflowHandoffStatus: workflowHandoff.status,
    workflowResumeToken: workflowHandoff.resumeToken,
    artifactTransition: artifactTransitionProof.transition,
    artifactFromState: artifactTransitionProof.fromState,
    artifactToState: artifactTransitionProof.toState,
    artifactTransitionDecision: artifactTransitionProof.decision,
    clientRouteState: clientRouteCommand.commandState,
    clientPrimaryCommand: clientRouteCommand.primaryCommand,
    clientSubmitEnabled: clientRouteCommand.submitEnabled,
    clientAcceptRoute: clientRouteCommand.routes.accept.href,
    clientNextStepRoute: clientRouteCommand.routes.nextStep.href
  };
}

function addMillisecondsToIso(value, milliseconds) {
  const timestamp = Date.parse(value);
  const base = Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(base + milliseconds).toISOString();
}

function positiveIntegerOrNull(value) {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function normalizeLifecycleControlPolicy(source = {}, input = {}, scope = {}) {
  const policy = source.policy && typeof source.policy === 'object'
    ? source.policy
    : input.lifecyclePolicy && typeof input.lifecyclePolicy === 'object'
      ? input.lifecyclePolicy
      : {};
  const allowedControlCommands = uniqueStrings(policy.allowedControlCommands || policy.commands)
    .map((command) => command.toLowerCase())
    .filter((command) => CONTROL_LIFECYCLE_COMMANDS.has(command));
  const requireChangeTicketFor = uniqueStrings(policy.requireChangeTicketFor || policy.ticketRequiredFor)
    .map((command) => command.toLowerCase())
    .filter((command) => CONTROL_LIFECYCLE_COMMANDS.has(command));
  const scopedPolicyKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}`;

  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle-control-policy.v1',
    policyId: textOrNull(policy.policyId) || textOrNull(policy.id) || `hosted-kernel:${scopedPolicyKey}`,
    mode: textOrNull(policy.mode) || 'hosted-kernel-managed',
    allowedControlCommands: allowedControlCommands.length ? allowedControlCommands : [...CONTROL_LIFECYCLE_COMMANDS].sort(),
    requireChangeTicketFor: requireChangeTicketFor.length ? requireChangeTicketFor : ['disable', 'pause'],
    maxDelayedScheduleDays: positiveIntegerOrNull(policy.maxDelayedScheduleDays) || MAX_DELAYED_SCHEDULE_DAYS,
    maxMaintenanceWindowHours: positiveIntegerOrNull(policy.maxMaintenanceWindowHours) || MAX_MAINTENANCE_WINDOW_HOURS,
    requireDisableUntil: policy.requireDisableUntil === true,
    allowAutoRelease: policy.allowAutoRelease === true,
    changeTicket: textOrNull(source.changeTicket)
      || textOrNull(source.changeTicketId)
      || textOrNull(policy.changeTicket)
      || textOrNull(input.changeTicket),
    disableUntil: textOrNull(source.disableUntil) || textOrNull(policy.disableUntil) || textOrNull(input.disableUntil),
    scopeLock: {
      tenantId: textOrNull(policy.tenantId),
      workspaceId: textOrNull(policy.workspaceId),
      scopedKey: textOrNull(policy.scopedKey)
    }
  };
}

function normalizeLifecycleSettings(input = {}, now) {
  const source = input.lifecycle && typeof input.lifecycle === 'object'
    ? input.lifecycle
    : input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
      ? input.lifecycleSettings
      : {};
  const enabled = source.enabled !== false && input.quarantineEnabled !== false;
  const rawCommand = textOrNull(source.command) || textOrNull(input.lifecycleCommand) || textOrNull(input.command) || null;
  const command = rawCommand ? rawCommand.toLowerCase() : null;
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const rawScheduleMode = textOrNull(schedule.mode) || textOrNull(source.scheduleMode) || 'immediate';
  const scheduleMode = rawScheduleMode.toLowerCase();
  const runAt = textOrNull(schedule.runAt) || textOrNull(source.runAt);
  const maintenanceWindowStart = textOrNull(schedule.maintenanceWindowStart) || textOrNull(source.maintenanceWindowStart);
  const maintenanceWindowEnd = textOrNull(schedule.maintenanceWindowEnd) || textOrNull(source.maintenanceWindowEnd);
  const retentionDays = positiveIntegerOrNull(source.retentionDays ?? input.retentionDays) ?? DEFAULT_RETENTION_DAYS;
  const reviewIntervalMinutes = positiveIntegerOrNull(source.reviewIntervalMinutes ?? input.reviewIntervalMinutes) ?? 1440;
  const autoRelease = source.autoRelease === true || input.autoRelease === true;
  const requiresOperatorReview = source.requiresOperatorReview !== false;
  const autoReleaseApprovalRef = textOrNull(source.autoReleaseApprovalRef) || textOrNull(input.autoReleaseApprovalRef);
  const rawRequestedNextAction = textOrNull(source.nextAction) || textOrNull(input.nextAction);
  const requestedNextAction = rawRequestedNextAction ? rawRequestedNextAction.toLowerCase() : null;
  const policy = normalizeLifecycleControlPolicy(source, input, {
    tenantId: textOrNull(input.tenantId ?? input.tenant?.id),
    workspaceId: textOrNull(input.workspaceId ?? input.workspace?.id)
  });

  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle-settings.v1',
    enabled,
    command,
    rawCommand,
    schedule: {
      mode: scheduleMode,
      rawMode: rawScheduleMode,
      runAt,
      maintenanceWindowStart,
      maintenanceWindowEnd
    },
    retentionDays,
    reviewIntervalMinutes,
    autoRelease,
    requiresOperatorReview,
    autoReleaseApprovalRef,
    requestedNextAction,
    controlPolicy: policy,
    normalizedAt: now
  };
}

function validateLifecycleSettings(lifecycle, now, action = DEFAULT_ACTION, scope = {}) {
  const errors = [];
  const scopedPolicyKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}`;

  if (lifecycle.command && !VALID_LIFECYCLE_COMMANDS.has(lifecycle.command)) {
    errors.push({
      code: 'invalid-lifecycle-command',
      field: 'lifecycle.command',
      message: `Unsupported quarantine lifecycle command "${lifecycle.command}".`,
      expected: [...VALID_LIFECYCLE_COMMANDS].sort()
    });
  }

  if (ACTION_LIFECYCLE_COMMANDS.has(lifecycle.command) && lifecycle.command !== action) {
    errors.push({
      code: 'lifecycle-command-action-mismatch',
      field: 'lifecycle.command',
      message: `Lifecycle command "${lifecycle.command}" must match quarantine action "${action}" before it can be executed.`,
      expected: [action]
    });
  }

  if (CONTROL_LIFECYCLE_COMMANDS.has(lifecycle.command) && lifecycle.requestedNextAction && lifecycle.requestedNextAction !== 'wait') {
    errors.push({
      code: 'lifecycle-control-next-action-conflict',
      field: 'lifecycle.nextAction',
      message: `Lifecycle control command "${lifecycle.command}" cannot force next action "${lifecycle.requestedNextAction}".`,
      expected: ['wait']
    });
  }

  if (CONTROL_LIFECYCLE_COMMANDS.has(lifecycle.command)
    && !lifecycle.controlPolicy.allowedControlCommands.includes(lifecycle.command)) {
    errors.push({
      code: 'lifecycle-control-command-disallowed',
      field: 'lifecycle.command',
      message: `Lifecycle control command "${lifecycle.command}" is not allowed by the hosted-kernel lifecycle policy.`,
      expected: lifecycle.controlPolicy.allowedControlCommands
    });
  }

  if (CONTROL_LIFECYCLE_COMMANDS.has(lifecycle.command)
    && lifecycle.controlPolicy.requireChangeTicketFor.includes(lifecycle.command)
    && !lifecycle.controlPolicy.changeTicket) {
    errors.push({
      code: 'lifecycle-control-change-ticket-missing',
      field: 'lifecycle.changeTicket',
      message: `Lifecycle control command "${lifecycle.command}" requires a change ticket for audit handoff.`
    });
  }

  if (lifecycle.controlPolicy.scopeLock.tenantId && lifecycle.controlPolicy.scopeLock.tenantId !== scope.tenantId) {
    errors.push({
      code: 'lifecycle-policy-tenant-mismatch',
      field: 'lifecycle.policy.tenantId',
      message: 'Lifecycle control policy tenant lock must match the requested quarantine scope.'
    });
  }

  if (lifecycle.controlPolicy.scopeLock.workspaceId && lifecycle.controlPolicy.scopeLock.workspaceId !== scope.workspaceId) {
    errors.push({
      code: 'lifecycle-policy-workspace-mismatch',
      field: 'lifecycle.policy.workspaceId',
      message: 'Lifecycle control policy workspace lock must match the requested quarantine scope.'
    });
  }

  if (lifecycle.controlPolicy.scopeLock.scopedKey && lifecycle.controlPolicy.scopeLock.scopedKey !== scopedPolicyKey) {
    errors.push({
      code: 'lifecycle-policy-scope-mismatch',
      field: 'lifecycle.policy.scopedKey',
      message: 'Lifecycle control policy scopedKey must match the requested tenant/workspace quarantine scope.'
    });
  }

  if (lifecycle.command === 'disable' && lifecycle.controlPolicy.requireDisableUntil && !lifecycle.controlPolicy.disableUntil) {
    errors.push({
      code: 'lifecycle-disable-until-missing',
      field: 'lifecycle.disableUntil',
      message: 'Disable lifecycle commands require a disableUntil timestamp under the active hosted-kernel policy.'
    });
  }

  if (lifecycle.controlPolicy.disableUntil) {
    const disableUntilMs = Date.parse(lifecycle.controlPolicy.disableUntil);
    if (!Number.isFinite(disableUntilMs) || disableUntilMs <= Date.parse(now)) {
      errors.push({
        code: 'invalid-lifecycle-disable-until',
        field: 'lifecycle.disableUntil',
        message: 'Lifecycle disableUntil must be a valid future ISO timestamp.'
      });
    }
  }

  if (!VALID_SCHEDULE_MODES.has(lifecycle.schedule.mode)) {
    errors.push({
      code: 'invalid-schedule-mode',
      field: 'lifecycle.schedule.mode',
      message: `Unsupported quarantine schedule mode "${lifecycle.schedule.mode}".`,
      expected: [...VALID_SCHEDULE_MODES].sort()
    });
  }

  if (lifecycle.schedule.runAt) {
    const runAtMs = Date.parse(lifecycle.schedule.runAt);
    if (!Number.isFinite(runAtMs)) {
      errors.push({
        code: 'invalid-schedule-run-at',
        field: 'lifecycle.schedule.runAt',
        message: 'Scheduled quarantine runAt must be a valid ISO timestamp.'
      });
    } else if (runAtMs < Date.parse(now) && lifecycle.schedule.mode !== 'manual') {
      errors.push({
        code: 'schedule-run-at-in-past',
        field: 'lifecycle.schedule.runAt',
        message: 'Scheduled quarantine runAt must not be in the past for automated lifecycle commands.'
      });
    } else if (lifecycle.schedule.mode === 'delayed'
      && runAtMs - Date.parse(now) > lifecycle.controlPolicy.maxDelayedScheduleDays * 86400000) {
      errors.push({
        code: 'schedule-run-at-too-far',
        field: 'lifecycle.schedule.runAt',
        message: `Delayed quarantine lifecycle commands must run within ${lifecycle.controlPolicy.maxDelayedScheduleDays} days.`
      });
    }
  }

  if (lifecycle.schedule.mode === 'delayed' && !lifecycle.schedule.runAt) {
    errors.push({
      code: 'missing-schedule-run-at',
      field: 'lifecycle.schedule.runAt',
      message: 'Delayed quarantine lifecycle commands require a runAt timestamp.'
    });
  }

  if (lifecycle.schedule.mode === 'maintenance-window') {
    const startsAt = Date.parse(lifecycle.schedule.maintenanceWindowStart);
    const endsAt = Date.parse(lifecycle.schedule.maintenanceWindowEnd);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) {
      errors.push({
        code: 'invalid-maintenance-window',
        field: 'lifecycle.schedule',
        message: 'Maintenance-window scheduling requires valid start and end timestamps with start before end.'
      });
    } else if (endsAt - startsAt > lifecycle.controlPolicy.maxMaintenanceWindowHours * 3600000) {
      errors.push({
        code: 'maintenance-window-too-long',
        field: 'lifecycle.schedule',
        message: `Maintenance windows for quarantine lifecycle commands cannot exceed ${lifecycle.controlPolicy.maxMaintenanceWindowHours} hours.`
      });
    }
  }

  if (lifecycle.retentionDays < MIN_RETENTION_DAYS || lifecycle.retentionDays > MAX_RETENTION_DAYS) {
    errors.push({
      code: 'invalid-retention-days',
      field: 'lifecycle.retentionDays',
      message: `Quarantine retention must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`
    });
  }

  if (lifecycle.reviewIntervalMinutes < MIN_REVIEW_INTERVAL_MINUTES || lifecycle.reviewIntervalMinutes > MAX_REVIEW_INTERVAL_MINUTES) {
    errors.push({
      code: 'invalid-review-interval',
      field: 'lifecycle.reviewIntervalMinutes',
      message: `Review interval must be between ${MIN_REVIEW_INTERVAL_MINUTES} and ${MAX_REVIEW_INTERVAL_MINUTES} minutes.`
    });
  }

  if (lifecycle.requestedNextAction && !VALID_NEXT_ACTIONS.has(lifecycle.requestedNextAction)) {
    errors.push({
      code: 'invalid-next-action',
      field: 'lifecycle.nextAction',
      message: `Unsupported quarantine next action "${lifecycle.requestedNextAction}".`,
      expected: [...VALID_NEXT_ACTIONS].sort()
    });
  }

  if (lifecycle.autoRelease && !lifecycle.controlPolicy.allowAutoRelease && !lifecycle.autoReleaseApprovalRef) {
    errors.push({
      code: 'lifecycle-auto-release-not-approved',
      field: 'lifecycle.autoRelease',
      message: 'Auto-release requires either lifecycle policy approval or an explicit autoReleaseApprovalRef.'
    });
  }

  if (lifecycle.autoRelease && lifecycle.requiresOperatorReview && !lifecycle.autoReleaseApprovalRef) {
    errors.push({
      code: 'lifecycle-auto-release-review-conflict',
      field: 'lifecycle.requiresOperatorReview',
      message: 'Auto-release cannot bypass required operator review without an approval reference.'
    });
  }

  return errors;
}

function buildLifecycleControlPlane({ scope, lifecycle, lifecycleErrors, scheduleState, now }) {
  const command = lifecycle.command || scope.action;
  const isControlCommand = CONTROL_LIFECYCLE_COMMANDS.has(command);
  const policyErrors = lifecycleErrors.filter((error) => error.field?.startsWith('lifecycle.')
    && (error.code.includes('control') || error.code.includes('disable') || error.code.includes('auto-release')));
  const scopedPolicyKey = `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}`;
  const policyScopeMatches = (!lifecycle.controlPolicy.scopeLock.tenantId || lifecycle.controlPolicy.scopeLock.tenantId === scope.tenantId)
    && (!lifecycle.controlPolicy.scopeLock.workspaceId || lifecycle.controlPolicy.scopeLock.workspaceId === scope.workspaceId)
    && (!lifecycle.controlPolicy.scopeLock.scopedKey || lifecycle.controlPolicy.scopeLock.scopedKey === scopedPolicyKey);
  const mutatesEnabledState = command === 'pause' || command === 'resume' || command === 'disable' || command === 'enable';
  const expiresAt = command === 'disable' || command === 'pause'
    ? lifecycle.controlPolicy.disableUntil || lifecycle.schedule.runAt || null
    : null;
  const auditKey = [
    lifecycle.controlPolicy.policyId,
    scopedPolicyKey,
    command,
    lifecycle.controlPolicy.changeTicket || 'no-ticket',
    expiresAt || 'no-expiry'
  ].map((part) => encodeURIComponent(part)).join(':');

  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle-control-plane.v1',
    status: policyErrors.length || !policyScopeMatches
      ? 'policy-blocked'
      : scheduleState.accepting
        ? 'ready'
        : 'scheduled',
    policyId: lifecycle.controlPolicy.policyId,
    mode: lifecycle.controlPolicy.mode,
    scopedPolicyKey,
    policyScopeMatches,
    command,
    isControlCommand,
    mutatesEnabledState,
    changeTicket: lifecycle.controlPolicy.changeTicket,
    expiresAt,
    auditKey,
    scheduleStatus: scheduleState.status,
    allowedControlCommands: lifecycle.controlPolicy.allowedControlCommands,
    requiredTicketCommands: lifecycle.controlPolicy.requireChangeTicketFor,
    blockedBy: [
      ...policyErrors.map((error) => error.code),
      ...(!policyScopeMatches ? ['lifecycle-policy-scope-mismatch'] : [])
    ],
    safeguards: {
      autoReleaseAllowed: lifecycle.controlPolicy.allowAutoRelease || Boolean(lifecycle.autoReleaseApprovalRef),
      autoReleaseApprovalRef: lifecycle.autoReleaseApprovalRef,
      operatorReviewRequired: lifecycle.requiresOperatorReview,
      disableUntilRequired: lifecycle.controlPolicy.requireDisableUntil,
      generatedAt: now
    }
  };
}

function buildLifecycleScheduleState(lifecycle, now, lifecycleErrors = []) {
  const scheduleErrors = lifecycleErrors.filter((error) => error.field?.startsWith('lifecycle.schedule'));
  const nowMs = Date.parse(now);
  const runAtMs = Date.parse(lifecycle.schedule.runAt);
  const startsAtMs = Date.parse(lifecycle.schedule.maintenanceWindowStart);
  const endsAtMs = Date.parse(lifecycle.schedule.maintenanceWindowEnd);

  if (scheduleErrors.length) {
    return {
      status: 'blocked',
      accepting: false,
      reason: 'schedule-settings-invalid',
      availableAt: now,
      blockedBy: scheduleErrors.map((error) => error.code)
    };
  }

  if (lifecycle.schedule.mode === 'manual') {
    return {
      status: 'manual-hold',
      accepting: lifecycle.command === 'resume' || lifecycle.command === 'enable',
      reason: lifecycle.command === 'resume' || lifecycle.command === 'enable'
        ? 'manual-control-command'
        : 'manual-operator-release-required',
      availableAt: lifecycle.schedule.runAt || now,
      blockedBy: lifecycle.command === 'resume' || lifecycle.command === 'enable' ? [] : ['manual-schedule-hold']
    };
  }

  if (lifecycle.schedule.mode === 'delayed') {
    const due = Number.isFinite(runAtMs) && runAtMs <= nowMs;
    return {
      status: due ? 'due' : 'scheduled',
      accepting: due,
      reason: due ? 'delayed-schedule-due' : 'delayed-schedule-pending',
      availableAt: lifecycle.schedule.runAt || now,
      blockedBy: due ? [] : ['schedule-not-due']
    };
  }

  if (lifecycle.schedule.mode === 'maintenance-window') {
    const inWindow = Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) && startsAtMs <= nowMs && nowMs <= endsAtMs;
    const beforeWindow = Number.isFinite(startsAtMs) && nowMs < startsAtMs;
    return {
      status: inWindow ? 'window-open' : beforeWindow ? 'window-pending' : 'window-expired',
      accepting: inWindow,
      reason: inWindow ? 'maintenance-window-open' : beforeWindow ? 'maintenance-window-pending' : 'maintenance-window-expired',
      availableAt: beforeWindow ? lifecycle.schedule.maintenanceWindowStart : now,
      blockedBy: inWindow ? [] : [beforeWindow ? 'schedule-not-due' : 'maintenance-window-expired']
    };
  }

  return {
    status: 'due',
    accepting: true,
    reason: 'immediate-schedule',
    availableAt: now,
    blockedBy: []
  };
}

function buildLifecycleCommandExecution({ scope, lifecycle, lifecycleErrors, scheduleState, allowed, health, retryPlan, now }) {
  const requestedCommand = lifecycle.command || scope.action;
  const controlEffect = LIFECYCLE_COMMAND_EFFECTS[requestedCommand] || null;
  const commandKind = controlEffect ? 'control' : ACTION_LIFECYCLE_COMMANDS.has(requestedCommand) ? 'action' : 'implicit-action';
  const settingsAccepted = lifecycleErrors.length === 0;
  const scheduleReady = scheduleState.accepting;
  const dependenciesReady = !health.criticalUnavailable.length && !health.circuitOpen.length;
  const canExecute = settingsAccepted && scheduleReady && (controlEffect || allowed || retryPlan.retryable);
  const executionState = !settingsAccepted
    ? 'settings-blocked'
    : !scheduleReady
      ? scheduleState.status
      : controlEffect
        ? controlEffect.state
        : allowed
          ? 'ready'
          : retryPlan.retryable
            ? 'retry-ready'
            : 'blocked';

  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle-command-execution.v1',
    requestedCommand,
    commandKind,
    effectiveAction: controlEffect ? scope.action : requestedCommand,
    canExecute,
    executionState,
    scheduleReady,
    dependenciesReady,
    settingsAccepted,
    availableAt: retryPlan.nextAttemptNotBefore || scheduleState.availableAt || now,
    blockedBy: [
      ...scheduleState.blockedBy,
      ...lifecycleErrors.map((error) => error.code),
      ...(!dependenciesReady ? ['critical-dependency-not-ready'] : []),
      ...(!allowed && !retryPlan.retryable && !controlEffect ? ['request-not-accepted'] : [])
    ],
    controlEffect,
    routeIntent: `artifact-filesystem/quarantine-record/lifecycle/${requestedCommand}`,
    auditVerb: controlEffect
      ? `lifecycle.${requestedCommand}`
      : `quarantine.${requestedCommand}`
  };
}

function validateRequest({ scope, actorId, action, evidence }) {
  const validationErrors = [];

  if (!VALID_ACTIONS.has(action)) {
    validationErrors.push({
      code: 'invalid-action',
      field: 'action',
      message: `Unsupported quarantine action "${action}".`,
      expected: [...VALID_ACTIONS].sort()
    });
  }

  for (const [field, value] of Object.entries({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    artifactId: scope.artifactId,
    actorId
  })) {
    if (value && value.length > 160) {
      validationErrors.push({
        code: 'identifier-too-long',
        field,
        message: `${field} must be 160 characters or fewer.`
      });
    }
  }

  if (action === 'release' && evidence.length === 0) {
    validationErrors.push({
      code: 'missing-evidence-for-release',
      field: 'evidence',
      message: 'Release actions require at least one evidence item proving the quarantine can be cleared.'
    });
  }

  return validationErrors;
}

function buildLifecycleControl({ scope, allowed, lifecycle, lifecycleErrors, scheduleState, health, retryPlan, now }) {
  const disabled = lifecycle.command === 'disable'
    || lifecycle.command === 'pause'
    || (lifecycle.enabled === false && lifecycle.command !== 'enable' && lifecycle.command !== 'resume');
  const command = lifecycle.command || (disabled ? 'pause' : scope.action);
  const scheduleBlocked = lifecycleErrors.some((error) => error.field.startsWith('lifecycle.schedule'));
  const scheduleHeld = !scheduleBlocked && scheduleState.accepting === false;
  const settingsBlocked = lifecycleErrors.length > 0;
  const commandExecution = buildLifecycleCommandExecution({
    scope,
    lifecycle,
    lifecycleErrors,
    scheduleState,
    allowed,
    health,
    retryPlan,
    now
  });
  const controlPlane = buildLifecycleControlPlane({
    scope,
    lifecycle,
    lifecycleErrors,
    scheduleState,
    now
  });
  const state = disabled
    ? 'disabled'
    : settingsBlocked
      ? 'settings-blocked'
      : scheduleHeld
        ? 'scheduled'
      : health.degradedMode
        ? 'degraded'
        : allowed
          ? 'active'
          : 'blocked';
  const nextAction = lifecycle.requestedNextAction && !settingsBlocked
    ? lifecycle.requestedNextAction
    : disabled
      ? 'wait'
      : scheduleHeld
        ? 'wait'
      : settingsBlocked
        ? 'blocked'
        : retryPlan.retryable
          ? 'retry'
          : health.degradedMode
            ? 'reconcile'
            : allowed && scope.action === 'handoff'
              ? 'handoff'
              : allowed && scope.action === 'release'
                ? 'release'
                : allowed
                  ? 'record'
                  : 'blocked';
  const scheduledFor = lifecycle.schedule.mode === 'delayed'
    ? lifecycle.schedule.runAt
    : lifecycle.schedule.mode === 'maintenance-window'
      ? lifecycle.schedule.maintenanceWindowStart
      : lifecycle.schedule.mode === 'manual'
        ? lifecycle.schedule.runAt || scheduleState.availableAt
      : null;

  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle.v1',
    enabled: !disabled,
    command,
    state,
    schedule: {
      mode: lifecycle.schedule.mode,
      scheduledFor,
      runAt: lifecycle.schedule.runAt,
      maintenanceWindowStart: lifecycle.schedule.maintenanceWindowStart,
      maintenanceWindowEnd: lifecycle.schedule.maintenanceWindowEnd,
      blocked: scheduleBlocked || scheduleHeld,
      status: scheduleState.status,
      accepting: scheduleState.accepting,
      reason: scheduleState.reason,
      blockedBy: scheduleState.blockedBy
    },
    settings: {
      retentionDays: lifecycle.retentionDays,
      reviewIntervalMinutes: lifecycle.reviewIntervalMinutes,
      autoRelease: lifecycle.autoRelease,
      requiresOperatorReview: lifecycle.requiresOperatorReview,
      autoReleaseApprovalRef: lifecycle.autoReleaseApprovalRef,
      validationErrorCount: lifecycleErrors.length
    },
    controlPlane,
    commandExecution,
    nextAction: {
      state: nextAction,
      availableAt: commandExecution.availableAt,
      reason: disabled
        ? 'quarantine-recording-disabled'
        : scheduleHeld
          ? scheduleState.reason
        : settingsBlocked
          ? 'lifecycle-settings-invalid'
          : retryPlan.retryable
            ? 'retryable-denial'
            : health.degradedMode
              ? 'dependency-reconciliation-required'
              : allowed
                ? 'command-ready'
                : 'request-blocked'
    }
  };
}

function buildLifecycleProof({ lifecycleControl, lifecycleErrors }) {
  return {
    schema: 'artifact-filesystem.quarantine-record.lifecycle-proof.v1',
    controlsEnabled: lifecycleControl.enabled,
    command: lifecycleControl.command,
    state: lifecycleControl.state,
    nextAction: lifecycleControl.nextAction.state,
    scheduleMode: lifecycleControl.schedule.mode,
    scheduleStatus: lifecycleControl.schedule.status,
    scheduleAccepting: lifecycleControl.schedule.accepting,
    scheduledFor: lifecycleControl.schedule.scheduledFor,
    settingsAccepted: lifecycleErrors.length === 0,
    settingErrorCodes: lifecycleErrors.map((error) => error.code),
    commandExecution: {
      requestedCommand: lifecycleControl.commandExecution.requestedCommand,
      commandKind: lifecycleControl.commandExecution.commandKind,
      effectiveAction: lifecycleControl.commandExecution.effectiveAction,
      canExecute: lifecycleControl.commandExecution.canExecute,
      executionState: lifecycleControl.commandExecution.executionState,
      blockedBy: lifecycleControl.commandExecution.blockedBy,
      auditVerb: lifecycleControl.commandExecution.auditVerb
    },
    controlPlane: {
      status: lifecycleControl.controlPlane.status,
      policyId: lifecycleControl.controlPlane.policyId,
      policyScopeMatches: lifecycleControl.controlPlane.policyScopeMatches,
      changeTicket: lifecycleControl.controlPlane.changeTicket,
      expiresAt: lifecycleControl.controlPlane.expiresAt,
      auditKey: lifecycleControl.controlPlane.auditKey,
      blockedBy: lifecycleControl.controlPlane.blockedBy,
      safeguards: lifecycleControl.controlPlane.safeguards
    }
  };
}

function classifyReasons(input = {}) {
  const explicitReasons = uniqueStrings(input.reasons);
  const reason = textOrNull(input.reason);
  const reasons = reason ? [reason, ...explicitReasons] : explicitReasons;
  const normalized = reasons.map((item) => item.toLowerCase()).filter((item) => BOUNDARY_REASONS.has(item));

  return normalized.length ? [...new Set(normalized)] : ['manual-review'];
}

function buildRetryPlan({ deniedReasons, health, validationErrors, now }) {
  const retryable = deniedReasons.some((reason) => RETRYABLE_DENIALS.has(reason))
    || validationErrors.some((error) => RETRYABLE_DENIALS.has(error.code));
  const dependencyPenalty = health.unavailable.length * 3000 + health.degraded.length * 1500;
  const dependencyRetryAfterMs = Number.isFinite(health.retryAfterMs) ? health.retryAfterMs : 0;
  const retryAfterMs = retryable ? Math.min(60000, Math.max(dependencyRetryAfterMs, 2000 + dependencyPenalty)) : null;

  return {
    retryable,
    strategy: retryable
      ? health.circuitOpen.length
        ? 'circuit-breaker-cooldown-with-jitter'
        : 'exponential-backoff-with-jitter'
      : 'do-not-retry-until-input-or-permission-changes',
    retryAfterMs,
    nextAttemptNotBefore: retryAfterMs ? addMillisecondsToIso(now, retryAfterMs) : null,
    dependencyBackoff: {
      requestedByDependencyMs: dependencyRetryAfterMs || null,
      unavailableDependencyNames: health.unavailable.map((dependency) => dependency.name),
      degradedDependencyNames: health.degraded.map((dependency) => dependency.name),
      staleDependencyNames: health.stale.map((dependency) => dependency.name),
      circuitOpenDependencyNames: health.circuitOpen.map((dependency) => dependency.name)
    }
  };
}

function buildActionableErrors({ deniedReasons, validationErrors, health, requiredPermission }) {
  const errors = validationErrors.map((error) => ({
    code: error.code,
    field: error.field,
    message: error.message,
    expected: error.expected,
    remediation: error.code === 'missing-evidence-for-release'
      ? 'Attach release authorization, scanner clearance, or operator review evidence.'
      : error.code === 'stale-client-artifact-revision'
        ? 'Refresh the artifact details, re-read the current quarantine state, and resubmit with the latest revision.'
        : error.code === 'client-route-scope-mismatch'
          ? 'Navigate to the matching tenant, workspace, and artifact route before submitting the quarantine workflow.'
          : error.code === 'invalid-client-ack-state'
            ? 'Use a supported client acknowledgement state before handing off the workflow.'
            : error.code === 'invalid-quarantine-state-transition'
              ? 'Refresh the artifact quarantine state and choose a lifecycle action valid for the current state.'
              : error.code === 'missing-release-authorization'
                ? 'Attach release-authorization or operator-approval evidence before releasing the artifact.'
                : error.code === 'idempotency-conflict'
                  ? 'Generate a new idempotency key for the new command, or replay the original quarantine command unchanged.'
                  : error.code === 'stale-persisted-artifact-revision'
                    ? 'Recover or roll forward the persisted quarantine record before committing another transition.'
                    : 'Correct the request field and resubmit the quarantine record operation.'
  }));

  for (const reason of deniedReasons) {
    if (reason.startsWith('missing-permission:')) {
      errors.push({
        code: 'missing-permission',
        message: `Actor lacks ${requiredPermission}.`,
        remediation: 'Grant the required hosted-kernel quarantine permission or route through an authorized operator.'
      });
    } else if (reason === 'quarantine-store-unavailable' || reason === 'audit-sink-unavailable') {
      errors.push({
        code: reason,
        message: `${reason === 'quarantine-store-unavailable' ? 'Quarantine store' : 'Audit sink'} is unavailable.`,
        remediation: 'Retry after dependency health recovers; do not release the artifact while recording is incomplete.'
      });
    } else if (reason === 'quarantine-store-circuit-open' || reason === 'audit-sink-circuit-open') {
      errors.push({
        code: reason,
        message: `${reason === 'quarantine-store-circuit-open' ? 'Quarantine store' : 'Audit sink'} circuit breaker is open.`,
        remediation: 'Wait for the dependency cooldown window, then retry the same idempotency key so recovery can resume safely.'
      });
    } else if (reason === 'quarantine-store-health-stale' || reason === 'audit-sink-health-stale') {
      errors.push({
        code: reason,
        message: `${reason === 'quarantine-store-health-stale' ? 'Quarantine store' : 'Audit sink'} health signal is stale.`,
        remediation: 'Refresh dependency health before accepting quarantine state changes that depend on this service.'
      });
    } else if (reason === 'quarantine-lifecycle-disabled') {
      errors.push({
        code: reason,
        message: 'Quarantine lifecycle controls currently disable recording for this artifact scope.',
        remediation: 'Submit an enable or resume lifecycle command before recording, releasing, or handing off quarantine state.'
      });
    } else if (reason === 'quarantine-lifecycle-scheduled') {
      errors.push({
        code: reason,
        message: 'Quarantine lifecycle controls are holding this command until its schedule is ready.',
        remediation: 'Wait until the scheduled lifecycle window opens, or resubmit with an immediate schedule if policy allows.'
      });
    } else if (reason === 'lifecycle-control-command-disallowed') {
      errors.push({
        code: reason,
        message: 'The requested lifecycle control command is not allowed by policy.',
        remediation: 'Choose an allowed enable, disable, pause, or resume command for this quarantine scope.'
      });
    } else if (reason === 'lifecycle-control-change-ticket-missing') {
      errors.push({
        code: reason,
        message: 'The lifecycle control command requires a change ticket.',
        remediation: 'Attach lifecycle.changeTicket so the hosted-kernel audit proof can identify the approved control change.'
      });
    } else if (reason === 'lifecycle-disable-until-missing' || reason === 'invalid-lifecycle-disable-until') {
      errors.push({
        code: reason,
        message: 'The lifecycle disable command is missing a valid future disableUntil timestamp.',
        remediation: 'Set lifecycle.disableUntil to a future ISO timestamp within the approved control window.'
      });
    } else if (reason === 'lifecycle-policy-tenant-mismatch' || reason === 'lifecycle-policy-workspace-mismatch' || reason === 'lifecycle-policy-scope-mismatch') {
      errors.push({
        code: reason,
        message: 'The lifecycle control policy is locked to a different quarantine scope.',
        remediation: 'Use the lifecycle policy for the current tenant/workspace scope or resubmit from the matching scope.'
      });
    } else if (reason === 'schedule-run-at-too-far' || reason === 'maintenance-window-too-long') {
      errors.push({
        code: reason,
        message: 'The lifecycle schedule exceeds hosted-kernel policy limits.',
        remediation: 'Shorten the delayed schedule or maintenance window before submitting the lifecycle command.'
      });
    } else if (reason === 'lifecycle-auto-release-not-approved' || reason === 'lifecycle-auto-release-review-conflict') {
      errors.push({
        code: reason,
        message: 'Auto-release is not approved for this quarantine lifecycle policy.',
        remediation: 'Disable autoRelease or attach lifecycle.autoReleaseApprovalRef from an approved operator review.'
      });
    } else if (reason === 'provider-capability-missing') {
      errors.push({
        code: reason,
        message: 'The selected quarantine provider lacks one or more required capabilities for this action.',
        remediation: 'Select a provider contract that advertises the required quarantine and audit capabilities, or use the hosted-kernel provider.'
      });
    } else if (reason === 'external-handoff-blocked') {
      errors.push({
        code: reason,
        message: 'The external quarantine handoff is failed or blocked.',
        remediation: 'Reconcile the external handoff state before retrying the quarantine action.'
      });
    } else if (reason === 'external-handoff-target-missing') {
      errors.push({
        code: reason,
        message: 'The external quarantine handoff has no negotiated destination endpoint.',
        remediation: 'Attach a provider handoff endpoint or set provider.externalHandoff.endpoint before submitting the handoff.'
      });
    } else if (reason === 'external-handoff-receipt-missing') {
      errors.push({
        code: reason,
        message: 'The accepted external handoff has no audit receipt.',
        remediation: 'Record the provider receipt id before treating the handoff as accepted.'
      });
    } else if (reason === 'external-handoff-lease-expired') {
      errors.push({
        code: reason,
        message: 'The external handoff lease is expired or invalid.',
        remediation: 'Renew the provider handoff lease and resubmit with a future leaseExpiresAt timestamp.'
      });
    } else if (reason === 'invalid-provider-endpoint-contract') {
      errors.push({
        code: reason,
        message: 'The provider endpoint contract is invalid.',
        remediation: 'Use a supported endpoint purpose and protocol, and include endpoint URLs for required external providers.'
      });
    } else if (reason === 'provider-sync-conflict') {
      errors.push({
        code: reason,
        message: 'Provider sync metadata is in conflict.',
        remediation: 'Reconcile the provider checkpoint before committing another quarantine transition.'
      });
    } else if (reason === 'provider-sync-failed') {
      errors.push({
        code: reason,
        message: 'Provider sync metadata reports a failed checkpoint.',
        remediation: 'Retry or recover the provider sync checkpoint before continuing the quarantine workflow.'
      });
    } else if (reason === 'actor-tenant-boundary-mismatch' || reason === 'actor-workspace-boundary-mismatch' || reason === 'actor-scoped-key-boundary-mismatch') {
      errors.push({
        code: reason,
        message: 'Actor boundary grants do not include this quarantine scope.',
        remediation: 'Switch to an authorized tenant/workspace context or grant the actor an explicit scoped quarantine boundary.'
      });
    } else if (reason.startsWith('custody-') || reason.startsWith('provider-handoff-') || reason === 'persisted-custody-scope-mismatch' || reason === 'client-custody-route-mismatch') {
      errors.push({
        code: reason,
        message: 'Quarantine custody proof crosses the requested tenant/workspace/artifact boundary.',
        remediation: 'Refresh the scoped quarantine command, provider handoff, and persisted record from the same tenant/workspace before submitting.'
      });
    }
  }

  if (health.degraded.length) {
    errors.push({
      code: 'degraded-mode-active',
      message: `Operating with degraded dependencies: ${health.degraded.map((item) => item.name).join(', ')}.`,
      remediation: 'Persist the quarantine intent and reconcile the audit handoff when dependencies return to healthy.'
    });
  }

  return errors;
}

function highestSeverity(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => (FAILURE_SEVERITY_RANK[right] ?? 0) - (FAILURE_SEVERITY_RANK[left] ?? 0))[0] || 'info';
}

function buildDependencyDiagnostics({ health, retryPlan }) {
  return health.dependencies.map((dependency) => {
    const critical = health.criticalDependencyNames.includes(dependency.name);
    const status = dependency.unavailable
      ? 'unavailable'
      : dependency.circuitOpen
        ? 'circuit-open'
        : dependency.stale
          ? 'health-stale'
          : dependency.degraded
            ? 'degraded'
            : 'healthy';
    const severity = dependency.unavailable && critical
      ? 'critical'
      : dependency.unavailable || dependency.circuitOpen
        ? 'error'
        : dependency.stale || dependency.degraded
          ? 'warning'
          : 'info';
    const operatorAction = dependency.unavailable
      ? `restore-${dependency.name}`
      : dependency.circuitOpen
        ? `wait-${dependency.name}-circuit-cooldown`
        : dependency.stale
          ? `refresh-${dependency.name}-health`
          : dependency.degraded
            ? `reconcile-${dependency.name}`
            : 'none';

    return {
      name: dependency.name,
      critical,
      status,
      severity,
      retryAfterMs: dependency.retryAfterMs || retryPlan.retryAfterMs,
      operatorAction,
      observedAt: dependency.observedAt || null,
      observedAgeMs: dependency.observedAgeMs ?? null,
      failureCount: dependency.failureCount,
      consecutiveFailureCount: dependency.consecutiveFailureCount,
      latencyMs: dependency.latencyMs,
      message: dependency.message || null,
      canServeRead: !dependency.unavailable || !critical,
      canServeWrite: !dependency.unavailable && !dependency.circuitOpen && !dependency.stale
    };
  });
}

function buildOperationalErrorSummary({ deniedReasons, validationErrors, health, providerSyncState, persistedState }) {
  const validationCodes = validationErrors.map((error) => error.code);
  const permissionCodes = deniedReasons.filter((reason) => reason.startsWith('missing-permission:'));
  const dependencyCodes = deniedReasons.filter((reason) => reason.startsWith('quarantine-store-') || reason.startsWith('audit-sink-'));
  const providerCodes = deniedReasons.filter((reason) => reason.startsWith('provider-') || reason.startsWith('external-handoff-'));
  const custodyCodes = deniedReasons.filter((reason) => reason.startsWith('custody-') || reason.startsWith('provider-handoff-') || reason.includes('custody-scope'));
  const persistenceCodes = validationCodes.filter((code) => code.includes('persisted') || code.includes('idempotency') || code.includes('recovery'));
  const primaryCode = dependencyCodes[0]
    || providerCodes[0]
    || custodyCodes[0]
    || permissionCodes[0]
    || persistenceCodes[0]
    || validationCodes[0]
    || deniedReasons[0]
    || null;

  return {
    schema: 'artifact-filesystem.quarantine-record.operational-error-summary.v1',
    primaryCode,
    totalDeniedCodeCount: deniedReasons.length,
    totalValidationErrorCount: validationErrors.length,
    categories: {
      dependency: dependencyCodes,
      provider: providerCodes,
      custody: custodyCodes,
      permission: permissionCodes,
      persistence: persistenceCodes,
      validation: validationCodes
    },
    dependencyFailureCount: health.unavailable.length + health.degraded.length + health.stale.length + health.circuitOpen.length,
    providerSyncStatus: providerSyncState.syncStatus,
    persistedReplayStatus: persistedState.replayStatus,
    actionable: Boolean(primaryCode)
  };
}

function buildDegradedCapabilityEnvelope({ scope, health, providerSyncState, persistedState }) {
  const criticalUnavailable = health.critical.some((dependency) => dependency.unavailable || dependency.circuitOpen);
  const auditUnavailable = health.critical.some((dependency) => dependency.name === 'auditSink' && (dependency.unavailable || dependency.circuitOpen || dependency.stale));
  const storeUnavailable = health.critical.some((dependency) => dependency.name === 'quarantineStore' && (dependency.unavailable || dependency.circuitOpen || dependency.stale));
  const providerDeferred = providerSyncState.syncStatus === 'deferred' || providerSyncState.syncStatus === 'retry-pending';
  const releaseLocked = scope.action === 'release' && (criticalUnavailable || providerSyncState.syncStatus === 'blocked');
  const writeIntentAllowed = scope.action !== 'read'
    && !storeUnavailable
    && persistedState.restartSafe
    && providerSyncState.syncStatus !== 'blocked';

  return {
    schema: 'artifact-filesystem.quarantine-record.degraded-capabilities.v1',
    mode: criticalUnavailable
      ? 'fail-closed'
      : health.degradedMode
        ? 'degraded-with-intent'
        : 'normal',
    readAllowed: !storeUnavailable,
    writeIntentAllowed,
    auditEmissionDeferred: auditUnavailable || providerDeferred,
    providerSyncDeferred: providerDeferred,
    releaseLocked,
    handoffDeferred: scope.action === 'handoff' && (auditUnavailable || providerDeferred),
    safeClientActions: [
      ...(!storeUnavailable ? ['refresh-preview'] : []),
      ...(writeIntentAllowed ? ['persist-intent'] : []),
      ...(providerDeferred ? ['retry-provider-sync'] : []),
      ...(persistedState.replayStatus === 'restart-recovery-pending' ? ['resume-recovery'] : [])
    ],
    lockReasons: [
      ...(storeUnavailable ? ['quarantine-store-not-ready'] : []),
      ...(auditUnavailable ? ['audit-sink-not-ready'] : []),
      ...(providerSyncState.syncStatus === 'blocked' ? ['provider-sync-blocked'] : []),
      ...(releaseLocked ? ['release-held-until-health-restored'] : [])
    ]
  };
}

function buildRetryBudget({ retryPlan, health, persistedState }) {
  const worstConsecutiveFailures = health.dependencies
    .map((dependency) => dependency.consecutiveFailureCount)
    .reduce((max, count) => Math.max(max, count), 0);
  const attemptsRemaining = retryPlan.retryable
    ? Math.max(0, MAX_RETRY_ATTEMPTS_BEFORE_OPERATOR - worstConsecutiveFailures)
    : 0;

  return {
    maxAttemptsBeforeOperator: MAX_RETRY_ATTEMPTS_BEFORE_OPERATOR,
    observedConsecutiveFailureCount: worstConsecutiveFailures,
    attemptsRemaining,
    operatorEscalationRequired: retryPlan.retryable && attemptsRemaining === 0,
    preserveIdempotencyKey: retryPlan.retryable || persistedState.replayStatus === 'restart-recovery-pending',
    retrySameCommand: retryPlan.retryable && persistedState.restartSafe
  };
}

function buildOperationalIncidentContract({ scope, allowed, deniedReasons, validationErrors, health, retryPlan, lifecycleControl, providerSyncState, clientRequestState, persistedState, now }) {
  const dependencyDiagnostics = buildDependencyDiagnostics({ health, retryPlan });
  const errorSummary = buildOperationalErrorSummary({ deniedReasons, validationErrors, health, providerSyncState, persistedState });
  const degradedCapabilities = buildDegradedCapabilityEnvelope({ scope, health, providerSyncState, persistedState });
  const retryBudget = buildRetryBudget({ retryPlan, health, persistedState });
  const criticalBlockers = health.critical
    .filter((dependency) => dependency.unavailable || dependency.stale)
    .map((dependency) => ({
      dependency: dependency.name,
      state: dependency.state,
      stale: dependency.stale,
      circuitOpen: dependency.circuitOpen,
      observedAt: dependency.observedAt,
      observedAgeMs: dependency.observedAgeMs,
      failureCount: dependency.failureCount,
      consecutiveFailureCount: dependency.consecutiveFailureCount,
      message: dependency.message || null
    }));
  const degradedNonBlocking = health.dependencies
    .filter((dependency) => dependency.degraded && !health.criticalDependencyNames.includes(dependency.name))
    .map((dependency) => dependency.name);
  const failureState = criticalBlockers.length
    ? 'critical-dependency-blocked'
    : health.circuitOpen.length
      ? 'circuit-open-degraded'
      : health.stale.length
        ? 'health-stale-degraded'
        : health.degraded.length
          ? 'degraded-mode'
          : allowed
            ? 'nominal'
            : 'request-blocked';
  const mode = criticalBlockers.length
    ? 'fail-closed'
    : health.degradedMode
      ? 'degraded-write-intent'
      : 'normal';
  const runbook = OPERATIONAL_RUNBOOKS[failureState] || OPERATIONAL_RUNBOOKS['request-blocked'];
  const dependencySeverity = highestSeverity(...dependencyDiagnostics.map((dependency) => dependency.severity));
  const incidentSeverity = retryBudget.operatorEscalationRequired
    ? 'critical'
    : highestSeverity(
      dependencySeverity,
      errorSummary.actionable && !allowed ? 'error' : null,
      degradedCapabilities.mode === 'degraded-with-intent' ? 'warning' : null
    );

  return {
    schema: 'artifact-filesystem.quarantine-record.operational-incident.v1',
    generatedAt: now,
    failureState,
    mode,
    severity: incidentSeverity,
    criticalDependencyNames: health.criticalDependencyNames,
    criticalBlockers,
    degradedNonBlocking,
    dependencyDiagnostics,
    errorSummary,
    degradedCapabilities,
    retry: {
      retryable: retryPlan.retryable,
      strategy: retryPlan.strategy,
      retryAfterMs: retryPlan.retryAfterMs,
      nextAttemptNotBefore: retryPlan.nextAttemptNotBefore,
      dependencyBackoff: retryPlan.dependencyBackoff,
      budget: retryBudget
    },
    recoveryAction: criticalBlockers.length
      ? 'wait-for-critical-dependency'
      : persistedState.replayStatus === 'restart-recovery-pending'
        ? 'resume-persisted-command'
        : providerSyncState.syncStatus === 'deferred'
          ? 'reconcile-provider-sync'
        : lifecycleControl.nextAction.state,
    safeToReleaseArtifact: allowed && scope.action === 'release' && criticalBlockers.length === 0,
    writeIntentRequired: health.degradedMode && scope.action !== 'read',
    operatorRunbook: {
      id: failureState,
      owner: runbook.owner,
      action: runbook.action,
      escalation: retryBudget.operatorEscalationRequired ? 'page-oncall' : runbook.escalation,
      message: runbook.message,
      dependencyActions: dependencyDiagnostics
        .filter((dependency) => dependency.operatorAction !== 'none')
        .map((dependency) => ({
          dependency: dependency.name,
          action: dependency.operatorAction,
          severity: dependency.severity
        }))
    },
    clientNotice: {
      requestId: clientRequestState.requestId,
      severity: incidentSeverity === 'critical' ? 'error' : incidentSeverity,
      message: criticalBlockers.length
        ? 'A critical quarantine dependency is not ready; the artifact must remain in its current quarantine state.'
        : health.degradedMode
          ? 'Quarantine workflow is operating in degraded mode and may require reconciliation.'
          : 'Quarantine dependencies are healthy.'
    }
  };
}

function buildValidationSummary({ scope, evidence, validationErrors, deniedReasons, requiredPermission, permissions, lifecycleControl, providerSyncState, clientRequestState, persistedState, health, actorBoundary, custodyBoundary, artifactState, operationalIncident }) {
  const scopeMissing = [
    ['tenantId', scope.tenantId],
    ['workspaceId', scope.workspaceId],
    ['artifactId', scope.artifactId]
  ].filter(([, value]) => !value).map(([field]) => field);
  const validationFields = [...new Set(validationErrors.map((error) => error.field).filter(Boolean))];
  const dependencyBlockers = health.criticalUnavailable.map((dependency) => `${dependency.name}:unavailable`);
  const dependencyWarnings = health.degraded.map((dependency) => `${dependency.name}:degraded`);
  const providerBlocked = providerSyncState.syncStatus === 'blocked';
  const lifecycleBlocked = lifecycleControl.state === 'settings-blocked'
    || lifecycleControl.state === 'disabled'
    || lifecycleControl.state === 'scheduled';
  const clientBlockers = validationErrors
    .filter((error) => error.field?.startsWith('client.'))
    .map((error) => error.code);
  const artifactBlockers = validationErrors
    .filter((error) => error.field?.startsWith('artifact.') || error.code === 'missing-release-authorization')
    .map((error) => error.code);
  const persistenceBlockers = validationErrors
    .filter((error) => error.field?.startsWith('persistedState.') || error.code === 'idempotency-conflict')
    .map((error) => error.code);

  return {
    schema: 'artifact-filesystem.quarantine-record.validation-summary.v1',
    status: deniedReasons.length ? 'invalid' : 'valid',
    blockingCodes: deniedReasons,
    validationErrorCodes: validationErrors.map((error) => error.code),
    validationFields,
    scope: {
      complete: scopeMissing.length === 0,
      missingFields: scopeMissing
    },
    permission: {
      required: requiredPermission,
      present: permissions.has(requiredPermission)
    },
    actorBoundary: {
      ready: actorBoundary.deniedReasons.length === 0,
      mode: actorBoundary.mode,
      status: actorBoundary.status,
      scopedKey: actorBoundary.scopedKey,
      handoffIsolationKey: actorBoundary.handoffIsolationKey,
      blockers: actorBoundary.deniedReasons
    },
    custodyBoundary: {
      ready: custodyBoundary.violations.length === 0,
      status: custodyBoundary.status,
      partitionKey: custodyBoundary.expected.partitionKey,
      scopedKey: custodyBoundary.expected.scopedKey,
      handoffIsolationKey: custodyBoundary.expected.handoffIsolationKey,
      auditDedupeKey: custodyBoundary.auditPartition.dedupeKey,
      blockers: custodyBoundary.violations,
      checks: custodyBoundary.checks
    },
    evidence: {
      count: evidence.length,
      releaseReady: scope.action !== 'release' || (evidence.length > 0 && artifactState.releaseAuthorizationIds.length > 0),
      releaseAuthorizationIds: artifactState.releaseAuthorizationIds
    },
    artifactState: {
      ready: artifactBlockers.length === 0,
      currentState: artifactState.currentState,
      nextState: artifactState.nextState,
      transition: artifactState.transition,
      revision: artifactState.revision,
      contentDigest: artifactState.contentDigest,
      quarantineRecordId: artifactState.quarantineRecordId,
      transitionAllowed: artifactState.transitionAllowed,
      blockers: artifactBlockers
    },
    dependencies: {
      ready: dependencyBlockers.length === 0,
      blockers: dependencyBlockers,
      warnings: dependencyWarnings,
      criticalDependencyNames: health.criticalDependencyNames,
      stale: health.stale.map((dependency) => dependency.name),
      circuitOpen: health.circuitOpen.map((dependency) => dependency.name),
      failureState: operationalIncident.failureState,
      recoveryAction: operationalIncident.recoveryAction
    },
    lifecycle: {
      ready: !lifecycleBlocked,
      state: lifecycleControl.state,
      nextAction: lifecycleControl.nextAction.state,
      scheduleStatus: lifecycleControl.schedule.status,
      scheduleAccepting: lifecycleControl.schedule.accepting,
      controlPlaneStatus: lifecycleControl.controlPlane.status,
      controlPolicyId: lifecycleControl.controlPlane.policyId,
      controlAuditKey: lifecycleControl.controlPlane.auditKey,
      controlChangeTicket: lifecycleControl.controlPlane.changeTicket,
      controlBlockedBy: lifecycleControl.controlPlane.blockedBy,
      commandExecutionState: lifecycleControl.commandExecution.executionState,
      commandCanExecute: lifecycleControl.commandExecution.canExecute,
      commandBlockedBy: lifecycleControl.commandExecution.blockedBy
    },
    provider: {
      ready: !providerBlocked,
      syncStatus: providerSyncState.syncStatus,
      handoffRequired: providerSyncState.handoffRequired,
      externalHandoffState: providerSyncState.externalHandoff.state,
      selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
      syncState: providerSyncState.syncMetadata.state,
      syncDirty: providerSyncState.syncMetadata.dirty,
      syncCheckpointId: providerSyncState.syncMetadata.checkpointId,
      validEndpointCount: providerSyncState.metadata.validEndpointCount
    },
    client: {
      ready: clientBlockers.length === 0,
      requestId: clientRequestState.requestId,
      ackState: clientRequestState.ackState,
      routeIntent: clientRequestState.surfaceRoute,
      idempotencyKey: clientRequestState.idempotencyKey,
      staleRevision: clientRequestState.staleRevision,
      blockers: clientBlockers
    },
    persistence: {
      ready: persistenceBlockers.length === 0 && persistedState.restartSafe,
      state: persistedState.state,
      replayStatus: persistedState.replayStatus,
      restartSafe: persistedState.restartSafe,
      restartRecoveryStatus: persistedState.restartRecovery.status,
      restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint,
      nextRecoveryCommand: persistedState.restartRecovery.nextCommand,
      durableIntentPresent: persistedState.restartRecovery.durableIntentPresent,
      idempotencyKey: persistedState.idempotency.requestedKey,
      storedIdempotencyKey: persistedState.idempotency.storedKey,
      storedRecordId: persistedState.record.recordId,
      storedRecordDigest: persistedState.record.digest,
      lastCommittedAt: persistedState.record.lastCommittedAt,
      recoveredAt: persistedState.record.recoveredAt,
      blockers: persistenceBlockers
    }
  };
}

function readinessGate(name, ready, detail = {}) {
  return {
    name,
    ready: Boolean(ready),
    severity: ready ? 'none' : detail.severity || 'blocking',
    code: ready ? null : detail.code,
    message: ready ? null : detail.message
  };
}

function buildReadinessContract({ allowed, validationSummary, health, lifecycleControl, providerSyncState, auditHandoff }) {
  const gates = [
    readinessGate('scope', validationSummary.scope.complete, {
      code: 'scope-incomplete',
      message: `Missing scoped identifiers: ${validationSummary.scope.missingFields.join(', ')}.`
    }),
    readinessGate('permission', validationSummary.permission.present, {
      code: 'permission-missing',
      message: `Actor must hold ${validationSummary.permission.required}.`
    }),
    readinessGate('actor-boundary', validationSummary.actorBoundary.ready, {
      code: 'actor-boundary-blocked',
      message: `Actor boundary is ${validationSummary.actorBoundary.status} for ${validationSummary.actorBoundary.scopedKey}.`
    }),
    readinessGate('custody-boundary', validationSummary.custodyBoundary.ready, {
      code: 'custody-boundary-blocked',
      message: `Custody boundary is ${validationSummary.custodyBoundary.status} for ${validationSummary.custodyBoundary.scopedKey}.`
    }),
    readinessGate('request-validation', validationSummary.validationErrorCodes.length === 0, {
      code: 'request-invalid',
      message: `Request validation failed: ${validationSummary.validationErrorCodes.join(', ')}.`
    }),
    readinessGate('artifact-transition', validationSummary.artifactState.ready, {
      code: 'artifact-transition-blocked',
      message: `Artifact transition ${validationSummary.artifactState.transition} is not valid for this quarantine action.`
    }),
    readinessGate('dependencies', validationSummary.dependencies.ready, {
      code: 'dependency-unavailable',
      message: `Unavailable dependencies: ${validationSummary.dependencies.blockers.join(', ')}.`
    }),
    readinessGate('lifecycle', validationSummary.lifecycle.ready, {
      code: `lifecycle-${lifecycleControl.state}`,
      message: `Lifecycle controls are ${lifecycleControl.state}.`
    }),
    readinessGate('provider-sync', validationSummary.provider.ready, {
      code: 'provider-sync-blocked',
      message: `Provider sync is ${providerSyncState.syncStatus}.`
    }),
    readinessGate('client-state', validationSummary.client.ready, {
      code: 'client-state-blocked',
      message: `Client workflow state is blocked: ${validationSummary.client.blockers.join(', ')}.`
    }),
    readinessGate('persisted-state', validationSummary.persistence.ready, {
      code: 'persisted-state-blocked',
      message: `Persisted quarantine state is ${validationSummary.persistence.replayStatus}.`
    }),
    readinessGate('audit-handoff', !auditHandoff.proof.requiresAuditHandoff || providerSyncState.syncStatus !== 'blocked', {
      code: 'audit-handoff-not-ready',
      message: 'Audit handoff is required before the quarantine record can be accepted.'
    })
  ];
  const blocking = gates.filter((gate) => !gate.ready && gate.severity === 'blocking');

  return {
    schema: 'artifact-filesystem.quarantine-record.readiness.v1',
    ready: allowed && blocking.length === 0,
    status: blocking.length
      ? 'blocked'
      : health.degradedMode
        ? 'ready-with-reconciliation'
        : 'ready',
    gates,
    degradedMode: health.degradedMode,
    blockingGateCount: blocking.length,
    warningGateCount: gates.filter((gate) => gate.severity === 'warning').length
  };
}

function buildPreviewAcceptanceContract({ scope, actorId, allowed, reasons, evidence, deniedReasons, retryPlan, lifecycleControl, providerSyncState, validationSummary, readiness, actionableErrors, artifactTransitionProof, persistedState, now }) {
  const canAccept = readiness.ready && allowed;
  const alreadyCommitted = persistedState.replayStatus === 'idempotent-committed-replay';
  const nextAction = canAccept
    ? lifecycleControl.nextAction.state
    : retryPlan.retryable
      ? 'retry'
      : readiness.status === 'ready-with-reconciliation'
        ? 'reconcile'
        : 'blocked';
  const previewStatus = canAccept
    ? 'acceptance-ready'
    : retryPlan.retryable
      ? 'retryable-preview'
      : 'blocked-preview';
  const primaryError = actionableErrors[0];

  return {
    schema: 'artifact-filesystem.quarantine-record.preview-acceptance.v1',
    preview: {
      status: previewStatus,
      generatedAt: now,
      heading: alreadyCommitted ? 'Quarantine record already committed' : canAccept ? 'Quarantine record ready' : 'Quarantine record needs attention',
      summary: alreadyCommitted
        ? `Artifact ${scope.artifactId} already has a committed quarantine command for this idempotency key.`
        : canAccept
        ? `Artifact ${scope.artifactId} can be ${scope.action === 'release' ? 'released from quarantine' : 'recorded into quarantine'}.`
        : primaryError?.message || 'The quarantine request is blocked by validation, permission, provider, or dependency state.',
      reasonChips: reasons,
      evidenceCount: evidence.length,
      blockingCodes: deniedReasons
    },
    acceptance: {
      accepted: canAccept,
      command: scope.action,
      actorId,
      disabledReason: canAccept ? null : primaryError?.code || deniedReasons[0] || 'not-ready',
      requiredBeforeAccept: canAccept
        ? []
        : actionableErrors.map((error) => ({
          code: error.code,
          field: error.field,
          message: error.message,
          remediation: error.remediation
        }))
    },
    readiness,
    validationSummary,
    nextStep: {
      action: nextAction,
      label: nextAction === 'retry'
        ? 'Retry when dependencies recover'
        : nextAction === 'reconcile'
          ? 'Reconcile degraded quarantine state'
          : canAccept
            ? `Accept ${scope.action}`
            : 'Resolve blockers',
      reason: lifecycleControl.nextAction.reason,
      availableAt: retryPlan.nextAttemptNotBefore || lifecycleControl.nextAction.availableAt,
      routeIntent: `artifact-filesystem/quarantine-record/${nextAction}`,
      payload: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        artifactId: scope.artifactId,
        action: scope.action,
        providerSyncStatus: providerSyncState.syncStatus,
        externalHandoffState: providerSyncState.externalHandoff.state,
        providerSyncState: providerSyncState.syncMetadata.state,
        providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
        selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
        artifactTransition: artifactTransitionProof.transition,
        artifactFromState: artifactTransitionProof.fromState,
        artifactToState: artifactTransitionProof.toState,
        persistedReplayStatus: persistedState.replayStatus,
        restartSafe: persistedState.restartSafe,
        restartRecoveryStatus: persistedState.restartRecovery.status,
        restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
        commandFingerprint: persistedState.restartRecovery.commandFingerprint,
        persistedRecordId: persistedState.record.recordId
      }
    }
  };
}

function buildClientRouteCommandContract({ scope, actorId, clientRequestState, previewAcceptance, readiness, validationSummary, providerSyncState, lifecycleControl, actionableErrors, artifactTransitionProof, persistedState, now }) {
  const scopePath = [
    encodeURIComponent(scope.tenantId || 'missing-tenant'),
    encodeURIComponent(scope.workspaceId || 'missing-workspace'),
    encodeURIComponent(scope.artifactId || 'missing-artifact')
  ].join('/');
  const routeBase = `/kernel/artifacts/${scopePath}/quarantine-record`;
  const acceptBlockedBy = readiness.gates
    .filter((gate) => !gate.ready)
    .map((gate) => gate.code)
    .filter(Boolean);
  const submitToken = [
    clientRequestState.requestId,
    clientRequestState.idempotencyKey,
    artifactTransitionProof.transition,
    persistedState.replayStatus
  ].join('|');
  const requiredFields = ['tenantId', 'workspaceId', 'artifactId', 'action', 'idempotencyKey'];
  const missingPayloadFields = requiredFields.filter((field) => {
    if (field === 'idempotencyKey') return !clientRequestState.idempotencyKey;
    return !scope[field];
  });
  const commandState = previewAcceptance.acceptance.accepted
    ? 'accept-enabled'
    : previewAcceptance.nextStep.action === 'retry'
      ? 'retry-enabled'
      : previewAcceptance.nextStep.action === 'reconcile'
        ? 'reconcile-required'
        : 'blocked';
  const primaryCommand = previewAcceptance.acceptance.accepted
    ? 'accept'
    : previewAcceptance.nextStep.action;
  const validationBadges = [
    ['scope', validationSummary.scope.complete],
    ['permission', validationSummary.permission.present],
    ['actor-boundary', validationSummary.actorBoundary.ready],
    ['custody-boundary', validationSummary.custodyBoundary.ready],
    ['artifact-transition', validationSummary.artifactState.ready],
    ['dependencies', validationSummary.dependencies.ready],
    ['provider', validationSummary.provider.ready],
    ['client', validationSummary.client.ready],
    ['persistence', validationSummary.persistence.ready]
  ].map(([name, ready]) => ({
    name,
    state: ready ? 'ready' : 'blocked'
  }));

  return {
    schema: 'artifact-filesystem.quarantine-record.client-route-command.v1',
    generatedAt: now,
    routeBase,
    commandState,
    primaryCommand,
    submitEnabled: previewAcceptance.acceptance.accepted && missingPayloadFields.length === 0,
    submitToken,
    requestHeaders: {
      'x-aios-request-id': clientRequestState.requestId,
      'x-aios-idempotency-key': clientRequestState.idempotencyKey,
      'x-aios-surface-id': surfaceId
    },
    routes: {
      preview: {
        method: 'GET',
        href: `${routeBase}/preview`,
        intent: 'artifact-filesystem/quarantine-record/preview'
      },
      accept: {
        method: 'POST',
        href: `${routeBase}/accept`,
        intent: 'artifact-filesystem/quarantine-record/accept',
        enabled: previewAcceptance.acceptance.accepted,
        blockedBy: acceptBlockedBy
      },
      nextStep: {
        method: previewAcceptance.nextStep.action === 'retry' ? 'POST' : 'GET',
        href: `${routeBase}/${previewAcceptance.nextStep.action}`,
        intent: previewAcceptance.nextStep.routeIntent,
        enabled: previewAcceptance.nextStep.action !== 'blocked'
      },
      auditProof: {
        method: 'GET',
        href: `${routeBase}/proof/${encodeURIComponent(clientRequestState.requestId)}`,
        intent: 'artifact-filesystem/quarantine-record/audit-proof'
      }
    },
    payload: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      artifactId: scope.artifactId,
      action: scope.action,
      actorId,
      requestId: clientRequestState.requestId,
      idempotencyKey: clientRequestState.idempotencyKey,
      artifactRevision: validationSummary.artifactState.revision,
      expectedTransition: artifactTransitionProof.transition,
      providerSyncStatus: providerSyncState.syncStatus,
      providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
      lifecycleCommand: lifecycleControl.command,
      lifecycleCommandKind: lifecycleControl.commandExecution.commandKind,
      lifecycleExecutionState: lifecycleControl.commandExecution.executionState,
      lifecycleCanExecute: lifecycleControl.commandExecution.canExecute,
      lifecycleScheduleStatus: lifecycleControl.schedule.status,
      lifecycleScheduleAccepting: lifecycleControl.schedule.accepting,
      lifecycleControlPlaneStatus: lifecycleControl.controlPlane.status,
      lifecycleControlPolicyId: lifecycleControl.controlPlane.policyId,
      lifecycleControlAuditKey: lifecycleControl.controlPlane.auditKey,
      lifecycleControlChangeTicket: lifecycleControl.controlPlane.changeTicket,
      persistedReplayStatus: persistedState.replayStatus,
      restartRecoveryStatus: persistedState.restartRecovery.status,
      restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint,
      nextRecoveryCommand: persistedState.restartRecovery.nextCommand,
      custodyPartitionKey: validationSummary.custodyBoundary.partitionKey,
      custodyDedupeKey: validationSummary.custodyBoundary.auditDedupeKey
    },
    validation: {
      status: validationSummary.status,
      readinessStatus: readiness.status,
      missingPayloadFields,
      badges: validationBadges,
      topErrors: actionableErrors.slice(0, 3).map((error) => ({
        code: error.code,
        field: error.field || null,
        message: error.message,
        remediation: error.remediation
      }))
    },
    proofRefs: {
      transitionProofSchema: artifactTransitionProof.schema,
      fromState: artifactTransitionProof.fromState,
      toState: artifactTransitionProof.toState,
      persistedRecordId: persistedState.record.recordId,
      persistedRecordDigest: persistedState.record.digest,
      restartSafe: persistedState.restartSafe,
      restartRecoveryStatus: persistedState.restartRecovery.status,
      restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint
    }
  };
}

function buildWorkflowHandoffContract({ scope, actorId, clientRequestState, previewAcceptance, readiness, lifecycleControl, providerSyncState, actionableErrors, actorBoundary, custodyBoundary, artifactTransitionProof, persistedState, clientRouteCommand, now }) {
  const blocked = !readiness.ready || previewAcceptance.acceptance.accepted === false;
  const requiresClientRefresh = actionableErrors.some((error) => error.code === 'stale-client-artifact-revision' || error.code === 'client-route-scope-mismatch');
  const routeCommandReady = clientRouteCommand.submitEnabled && clientRouteCommand.validation.missingPayloadFields.length === 0;
  const pendingClientWrites = clientRequestState.optimisticClientState.pending
    || clientRequestState.optimisticClientState.dirty
    || clientRequestState.optimisticClientState.offlineQueued;
  const status = requiresClientRefresh
    ? 'client-refresh-required'
    : persistedState.replayStatus === 'idempotent-committed-replay'
      ? 'already-committed'
      : persistedState.replayStatus === 'restart-recovery-pending'
        ? 'recovery-pending'
        : blocked
          ? 'blocked'
          : providerSyncState.syncStatus === 'handoff-pending'
            ? 'external-handoff-pending'
            : lifecycleControl.nextAction.state === 'handoff'
              ? 'handoff-ready'
              : 'ready';
  const resumeToken = [
    clientRequestState.requestId,
    scope.tenantId || 'missing-tenant',
    scope.workspaceId || 'missing-workspace',
    scope.artifactId || 'missing-artifact',
    scope.action,
    providerSyncState.syncStatus,
    persistedState.replayStatus
  ].join(':');
  const nextRoute = clientRouteCommand.routes.nextStep;
  const acceptRoute = clientRouteCommand.routes.accept;
  const workflowStage = status === 'already-committed'
    ? 'receipt'
    : status === 'recovery-pending'
      ? 'recovery'
      : requiresClientRefresh
        ? 'refresh'
        : blocked
          ? 'remediation'
          : providerSyncState.handoffRequired
            ? 'external-handoff'
            : 'commit';
  const submitMode = routeCommandReady
    ? 'submit-now'
    : previewAcceptance.nextStep.action === 'retry'
      ? 'retry-later'
      : pendingClientWrites
        ? 'hold-local-state'
        : 'blocked';

  return {
    schema: 'artifact-filesystem.quarantine-record.workflow-handoff.v1',
    status,
    generatedAt: now,
    resumeToken,
    request: {
      requestId: clientRequestState.requestId,
      sessionId: clientRequestState.sessionId,
      idempotencyKey: clientRequestState.idempotencyKey,
      ackState: clientRequestState.ackState,
      staleRevision: clientRequestState.staleRevision
    },
    destination: {
      routeIntent: previewAcceptance.nextStep.routeIntent,
      surfaceRoute: clientRequestState.surfaceRoute,
      action: previewAcceptance.nextStep.action,
      label: previewAcceptance.nextStep.label,
      availableAt: previewAcceptance.nextStep.availableAt,
      method: nextRoute.method,
      href: nextRoute.href,
      enabled: nextRoute.enabled
    },
    routeHandoff: {
      schema: 'artifact-filesystem.quarantine-record.client-workflow-handoff.v1',
      stage: workflowStage,
      submitMode,
      commandState: clientRouteCommand.commandState,
      primaryCommand: clientRouteCommand.primaryCommand,
      submitEnabled: routeCommandReady,
      submitToken: clientRouteCommand.submitToken,
      headers: clientRouteCommand.requestHeaders,
      missingPayloadFields: clientRouteCommand.validation.missingPayloadFields,
      routeIntents: {
        preview: clientRouteCommand.routes.preview.intent,
        accept: acceptRoute.intent,
        nextStep: nextRoute.intent,
        auditProof: clientRouteCommand.routes.auditProof.intent
      },
      routes: {
        preview: {
          method: clientRouteCommand.routes.preview.method,
          href: clientRouteCommand.routes.preview.href
        },
        accept: {
          method: acceptRoute.method,
          href: acceptRoute.href,
          enabled: acceptRoute.enabled,
          blockedBy: acceptRoute.blockedBy
        },
        nextStep: {
          method: nextRoute.method,
          href: nextRoute.href,
          enabled: nextRoute.enabled
        },
        auditProof: {
          method: clientRouteCommand.routes.auditProof.method,
          href: clientRouteCommand.routes.auditProof.href
        }
      },
      submitEnvelope: {
        method: routeCommandReady ? acceptRoute.method : nextRoute.method,
        href: routeCommandReady ? acceptRoute.href : nextRoute.href,
        payload: clientRouteCommand.payload,
        expectedTransition: clientRouteCommand.payload.expectedTransition,
        idempotencyKey: clientRouteCommand.payload.idempotencyKey,
        proofRef: clientRouteCommand.routes.auditProof.href
      },
      clientState: {
        ackState: clientRequestState.ackState,
        acknowledgedRiskCodes: clientRequestState.acknowledgedRiskCodes,
        staleRevision: clientRequestState.staleRevision,
        pendingLocalWrites: pendingClientWrites,
        offlineQueued: clientRequestState.optimisticClientState.offlineQueued
      }
    },
    handoffPayload: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      artifactId: scope.artifactId,
      action: scope.action,
      actorId,
      providerId: providerSyncState.providerId,
      providerSyncStatus: providerSyncState.syncStatus,
      externalHandoffState: providerSyncState.externalHandoff.state,
      providerSyncState: providerSyncState.syncMetadata.state,
      providerSyncCheckpointId: providerSyncState.syncMetadata.checkpointId,
      selectedHandoffEndpointId: providerSyncState.selectedHandoffEndpoint?.id || null,
      actorBoundaryStatus: actorBoundary.status,
      handoffIsolationKey: actorBoundary.handoffIsolationKey,
      custodyStatus: custodyBoundary.status,
      custodyPartitionKey: custodyBoundary.expected.partitionKey,
      custodyDedupeKey: custodyBoundary.auditPartition.dedupeKey,
      custodyViolations: custodyBoundary.violations,
      acknowledgedRiskCodes: clientRequestState.acknowledgedRiskCodes,
      artifactTransition: artifactTransitionProof.transition,
      artifactFromState: artifactTransitionProof.fromState,
      artifactToState: artifactTransitionProof.toState,
      persistedReplayStatus: persistedState.replayStatus,
      restartSafe: persistedState.restartSafe,
      restartRecoveryStatus: persistedState.restartRecovery.status,
      restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
      commandFingerprint: persistedState.restartRecovery.commandFingerprint,
      nextRecoveryCommand: persistedState.restartRecovery.nextCommand,
      persistedRecordId: persistedState.record.recordId,
      routeCommandState: clientRouteCommand.commandState,
      routeSubmitEnabled: routeCommandReady,
      routeSubmitToken: clientRouteCommand.submitToken,
      primaryRouteHref: routeCommandReady ? acceptRoute.href : nextRoute.href,
      auditProofHref: clientRouteCommand.routes.auditProof.href
    },
    userVisibleState: {
      title: status === 'already-committed'
        ? 'Quarantine command already committed'
        : status === 'recovery-pending'
          ? 'Recovering quarantine command'
          : status === 'ready' || status === 'handoff-ready'
            ? 'Quarantine workflow ready'
            : status === 'external-handoff-pending'
              ? 'Waiting for external handoff'
              : requiresClientRefresh
                ? 'Refresh artifact state'
                : 'Resolve quarantine blockers',
      primaryAction: requiresClientRefresh
        ? 'refresh'
        : blocked
          ? 'resolve-blockers'
          : previewAcceptance.nextStep.action,
      primaryRouteHref: routeCommandReady ? acceptRoute.href : nextRoute.href,
      primaryRouteMethod: routeCommandReady ? acceptRoute.method : nextRoute.method,
      disabledReason: blocked ? previewAcceptance.acceptance.disabledReason : null,
      blockingCodes: actionableErrors.map((error) => error.code)
    }
  };
}

function buildAuditHandoff({ scope, actorId, allowed, deniedReasons, reasons, evidence, now, health, retryPlan, lifecycleProof, providerSyncState, clientRequestState, persistedState, actorBoundary, custodyBoundary, artifactTransitionProof, operationalIncident }) {
  return {
    stream: 'artifact-filesystem.quarantine-record',
    eventType: allowed ? 'quarantine.record.accepted' : 'quarantine.record.denied',
    generatedAt: now,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    artifactId: scope.artifactId,
    actorId,
    decision: allowed ? 'allow' : 'deny',
    deniedReasons,
    quarantineReasons: reasons,
    evidenceCount: evidence.length,
    healthState: health.degradedMode ? 'degraded' : 'healthy',
    retryable: retryPlan.retryable,
    providerSyncStatus: providerSyncState.syncStatus,
    externalHandoffState: providerSyncState.externalHandoff.state,
    clientRequestId: clientRequestState.requestId,
    clientAckState: clientRequestState.ackState,
    proof: {
      surfaceId,
      boundary: 'tenant-workspace-artifact',
      scopedKey: `${scope.tenantId || 'missing-tenant'}:${scope.workspaceId || 'missing-workspace'}:${scope.artifactId || 'missing-artifact'}`,
      requiresAuditHandoff: allowed && (reasons.includes('tenant-boundary') || reasons.includes('workspace-boundary')),
      degradedMode: health.degradedMode,
      dependencyStates: health.dependencies.map((dependency) => ({
        name: dependency.name,
        state: dependency.state,
        unavailable: dependency.unavailable,
        degraded: dependency.degraded,
        stale: dependency.stale,
        circuitOpen: dependency.circuitOpen,
        failureCount: dependency.failureCount,
        consecutiveFailureCount: dependency.consecutiveFailureCount,
        observedAt: dependency.observedAt,
        retryAfterMs: dependency.retryAfterMs
      })),
      operationalIncident,
      lifecycle: lifecycleProof,
      providerContract: {
        providerId: providerSyncState.providerId,
        serviceName: providerSyncState.serviceName,
        contractVersion: providerSyncState.contractVersion,
        syncStatus: providerSyncState.syncStatus,
        externalHandoff: providerSyncState.externalHandoff,
        syncMetadata: providerSyncState.syncMetadata,
        selectedHandoffEndpoint: providerSyncState.selectedHandoffEndpoint,
        serviceEndpoints: providerSyncState.serviceEndpoints,
        metadata: providerSyncState.metadata
      },
      clientRequest: {
        requestId: clientRequestState.requestId,
        idempotencyKey: clientRequestState.idempotencyKey,
        routeIntent: clientRequestState.surfaceRoute,
        staleRevision: clientRequestState.staleRevision,
        acknowledgedRiskCodes: clientRequestState.acknowledgedRiskCodes
      },
      persistedState: {
        state: persistedState.state,
        replayStatus: persistedState.replayStatus,
        restartSafe: persistedState.restartSafe,
        restartRecoveryStatus: persistedState.restartRecovery.status,
        restartRecoveryStep: persistedState.restartRecovery.resumeFromStep,
        commandFingerprint: persistedState.restartRecovery.commandFingerprint,
        nextRecoveryCommand: persistedState.restartRecovery.nextCommand,
        storedRequestId: persistedState.storedCommand.requestId,
        storedAction: persistedState.storedCommand.action,
        storedRecordId: persistedState.record.recordId,
        storedRecordDigest: persistedState.record.digest,
        lastCommittedAt: persistedState.record.lastCommittedAt,
        recoveredAt: persistedState.record.recoveredAt
      },
      actorBoundary: {
        mode: actorBoundary.mode,
        status: actorBoundary.status,
        scopedKey: actorBoundary.scopedKey,
        handoffIsolationKey: actorBoundary.handoffIsolationKey,
        checks: actorBoundary.checks,
        deniedReasons: actorBoundary.deniedReasons
      },
      custodyBoundary,
      artifactTransition: artifactTransitionProof
    }
  };
}

export function describeQuarantineRecordSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const scope = normalizeScope(input);
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const actorId = textOrNull(actor.id) || textOrNull(input.actorId) || 'anonymous';
  const permissions = permissionSet(actor);
  const requiredPermission = ACTION_PERMISSIONS[scope.action] || ACTION_PERMISSIONS[DEFAULT_ACTION];
  const actorBoundary = normalizeActorBoundary(actor, input, scope);
  const reasons = classifyReasons(input);
  const evidence = normalizeEvidence(input.evidence);
  const health = normalizeDependencyHealth(input, scope.action, now);
  const lifecycle = normalizeLifecycleSettings(input, now);
  const lifecycleErrors = validateLifecycleSettings(lifecycle, now, scope.action, scope);
  const lifecycleScheduleState = buildLifecycleScheduleState(lifecycle, now, lifecycleErrors);
  const providerContract = normalizeProviderContract(input, scope.action, now);
  const providerErrors = validateProviderContract(providerContract, now);
  const clientRequestState = normalizeClientRequestState(input, scope, scope.action, now);
  const clientErrors = validateClientRequestState(clientRequestState, scope);
  const artifactState = normalizeArtifactState(input, scope, scope.action, evidence, now);
  const artifactStateErrors = validateArtifactStateContract(artifactState, scope.action);
  const persistedState = normalizePersistedState(input, scope, scope.action, clientRequestState, artifactState, now);
  const persistedStateErrors = validatePersistedState(persistedState);
  const custodyBoundary = buildCustodyBoundaryContract({
    input,
    scope,
    actorId,
    actorBoundary,
    providerContract,
    clientRequestState,
    persistedState,
    now
  });
  const custodyErrors = validateCustodyBoundary(custodyBoundary);
  const validationErrors = [
    ...validateRequest({ scope, actorId, action: scope.action, evidence }),
    ...lifecycleErrors,
    ...providerErrors,
    ...clientErrors,
    ...artifactStateErrors,
    ...persistedStateErrors,
    ...custodyErrors
  ];
  const historySnapshots = normalizeHistorySnapshots(input.history || input.snapshots, now);
  const lifecycleDisabled = lifecycle.command === 'disable'
    || lifecycle.command === 'pause'
    || (lifecycle.enabled === false && lifecycle.command !== 'enable' && lifecycle.command !== 'resume');
  const lifecycleScheduledHold = lifecycleScheduleState.accepting === false
    && lifecycleScheduleState.status !== 'blocked'
    && lifecycle.command !== 'disable'
    && lifecycle.command !== 'pause';

  const deniedReasons = [];
  if (!scope.tenantId) deniedReasons.push('missing-tenant');
  if (!scope.workspaceId) deniedReasons.push('missing-workspace');
  if (!scope.artifactId) deniedReasons.push('missing-artifact');
  if (!permissions.has(requiredPermission)) deniedReasons.push(`missing-permission:${requiredPermission}`);
  for (const reason of actorBoundary.deniedReasons) deniedReasons.push(reason);
  if (lifecycleDisabled) deniedReasons.push('quarantine-lifecycle-disabled');
  if (lifecycleScheduledHold) deniedReasons.push('quarantine-lifecycle-scheduled');
  for (const error of validationErrors) deniedReasons.push(error.code);
  if (health.criticalUnavailable.some((dependency) => dependency.name === 'quarantineStore')) {
    deniedReasons.push('quarantine-store-unavailable');
  }
  if (health.criticalUnavailable.some((dependency) => dependency.name === 'auditSink')) {
    deniedReasons.push('audit-sink-unavailable');
  }
  if (health.criticalDegraded.some((dependency) => dependency.name === 'quarantineStore')) {
    deniedReasons.push('quarantine-store-degraded');
  }
  if (health.criticalDegraded.some((dependency) => dependency.name === 'auditSink')) {
    deniedReasons.push('audit-sink-degraded');
  }
  if (health.stale.some((dependency) => dependency.name === 'quarantineStore' && health.criticalDependencyNames.includes(dependency.name))) {
    deniedReasons.push('quarantine-store-health-stale');
  }
  if (health.stale.some((dependency) => dependency.name === 'auditSink' && health.criticalDependencyNames.includes(dependency.name))) {
    deniedReasons.push('audit-sink-health-stale');
  }
  if (health.circuitOpen.some((dependency) => dependency.name === 'quarantineStore' && health.criticalDependencyNames.includes(dependency.name))) {
    deniedReasons.push('quarantine-store-circuit-open');
  }
  if (health.circuitOpen.some((dependency) => dependency.name === 'auditSink' && health.criticalDependencyNames.includes(dependency.name))) {
    deniedReasons.push('audit-sink-circuit-open');
  }

  const requestedTenant = textOrNull(input.requestTenantId);
  const requestedWorkspace = textOrNull(input.requestWorkspaceId);
  if (requestedTenant && scope.tenantId && requestedTenant !== scope.tenantId) {
    deniedReasons.push('cross-tenant-request');
  }
  if (requestedWorkspace && scope.workspaceId && requestedWorkspace !== scope.workspaceId) {
    deniedReasons.push('cross-workspace-request');
  }

  const uniqueDeniedReasons = [...new Set(deniedReasons)];
  const allowed = uniqueDeniedReasons.length === 0;
  const retryPlan = buildRetryPlan({ deniedReasons: uniqueDeniedReasons, health, validationErrors, now });
  const providerSyncState = buildProviderSyncState({ providerContract, allowed, health, retryPlan, now });
  const artifactTransitionProof = buildArtifactTransitionProof({
    scope,
    actorId,
    action: scope.action,
    allowed,
    artifactState,
    evidence,
    providerSyncState,
    clientRequestState,
    persistedState,
    now
  });
  const actionableErrors = buildActionableErrors({ deniedReasons: uniqueDeniedReasons, validationErrors, health, requiredPermission });
  const lifecycleControl = buildLifecycleControl({
    scope,
    allowed,
    lifecycle,
    lifecycleErrors,
    scheduleState: lifecycleScheduleState,
    health,
    retryPlan,
    now
  });
  const lifecycleProof = buildLifecycleProof({ lifecycleControl, lifecycleErrors });
  const operationalIncident = buildOperationalIncidentContract({
    scope,
    allowed,
    deniedReasons: uniqueDeniedReasons,
    validationErrors,
    health,
    retryPlan,
    lifecycleControl,
    providerSyncState,
    clientRequestState,
    persistedState,
    now
  });
  const analyticsCounters = buildAnalyticsCounters({
    allowed,
    action: scope.action,
    reasons,
    evidence,
    health,
    deniedReasons: uniqueDeniedReasons,
    validationErrors,
    historySnapshots,
    persistedState
  });
  const timeline = buildTimeline({
    now,
    scope,
    actorId,
    allowed,
    reasons,
    evidence,
    health,
    deniedReasons: uniqueDeniedReasons,
    retryPlan,
    historySnapshots,
    lifecycleControl,
    providerSyncState,
    clientRequestState,
    persistedState,
    actorBoundary,
    custodyBoundary,
    artifactTransitionProof,
    operationalIncident
  });
  const auditHandoff = buildAuditHandoff({
    scope,
    actorId,
    allowed,
    deniedReasons: uniqueDeniedReasons,
    reasons,
    evidence,
    now,
    health,
    retryPlan,
    lifecycleProof,
    providerSyncState,
    clientRequestState,
    persistedState,
    actorBoundary,
    custodyBoundary,
    artifactTransitionProof,
    operationalIncident
  });
  const validationSummary = buildValidationSummary({
    scope,
    evidence,
    validationErrors,
    deniedReasons: uniqueDeniedReasons,
    requiredPermission,
    permissions,
    lifecycleControl,
    providerSyncState,
    clientRequestState,
    persistedState,
    health,
    actorBoundary,
    custodyBoundary,
    artifactState,
    operationalIncident
  });
  const readiness = buildReadinessContract({
    allowed,
    validationSummary,
    health,
    lifecycleControl,
    providerSyncState,
    auditHandoff
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    scope,
    actorId,
    allowed,
    reasons,
    evidence,
    deniedReasons: uniqueDeniedReasons,
    retryPlan,
    lifecycleControl,
    providerSyncState,
    validationSummary,
    readiness,
    actionableErrors,
    artifactTransitionProof,
    persistedState,
    now
  });
  const clientRouteCommand = buildClientRouteCommandContract({
    scope,
    actorId,
    clientRequestState,
    previewAcceptance,
    readiness,
    validationSummary,
    providerSyncState,
    lifecycleControl,
    actionableErrors,
    artifactTransitionProof,
    persistedState,
    now
  });
  const workflowHandoff = buildWorkflowHandoffContract({
    scope,
    actorId,
    clientRequestState,
    previewAcceptance,
    readiness,
    lifecycleControl,
    providerSyncState,
    actionableErrors,
    actorBoundary,
    custodyBoundary,
    artifactTransitionProof,
    persistedState,
    clientRouteCommand,
    now
  });
  const analyticsExportManifest = buildAnalyticsExportManifest({
    now,
    scope,
    actorId,
    allowed,
    reasons,
    evidence,
    deniedReasons: uniqueDeniedReasons,
    timeline,
    historySnapshots,
    analyticsCounters,
    clientRequestState,
    providerSyncState,
    persistedState,
    custodyBoundary,
    artifactTransitionProof,
    operationalIncident
  });
  const exportSummary = buildExportSummary({
    scope,
    actorId,
    allowed,
    reasons,
    evidence,
    health,
    deniedReasons: uniqueDeniedReasons,
    retryPlan,
    analyticsCounters,
    analyticsExportManifest,
    timeline,
    lifecycleControl,
    providerSyncState,
    clientRequestState,
    persistedState,
    workflowHandoff,
    actorBoundary,
    custodyBoundary,
    artifactTransitionProof,
    clientRouteCommand,
    operationalIncident
  });
  const reportingState = buildReportingState({
    now,
    scope,
    actorId,
    allowed,
    reasons,
    evidence,
    health,
    deniedReasons: uniqueDeniedReasons,
    analyticsCounters,
    analyticsExportManifest,
    timeline,
    historySnapshots,
    lifecycleControl,
    providerSyncState,
    clientRequestState,
    persistedState,
    custodyBoundary,
    artifactTransitionProof,
    clientRouteCommand,
    operationalIncident
  });
  const quarantineStatus = persistedState.replayStatus === 'idempotent-committed-replay'
    ? 'already-recorded'
    : persistedState.replayStatus === 'restart-recovery-pending'
      ? 'recovering'
      : allowed
        ? 'recorded'
        : health.degradedMode
          ? 'pending-reconciliation'
          : 'rejected';
  const operationalState = persistedState.replayStatus === 'restart-recovery-pending'
    ? 'recovering'
    : health.degradedMode
      ? 'degraded'
      : allowed
        ? 'healthy'
        : 'blocked';

  return {
    ok: allowed,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel quarantine record with tenant/workspace boundary enforcement',
    action: scope.action,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    artifactId: scope.artifactId,
    actor: {
      id: actorId,
      roles: uniqueStrings(actor.roles),
      permissions: [...permissions].sort()
    },
    actorBoundary,
    decision: {
      allowed,
      requiredPermission,
      deniedReasons: uniqueDeniedReasons,
      safeBoundaryBehavior: allowed
        ? 'record-quarantine-audit'
        : health.degradedMode
          ? 'retain-quarantine-intent-without-release'
          : 'deny-without-cross-scope-disclosure'
    },
    quarantine: {
      status: quarantineStatus,
      reasons,
      evidence,
      history: historySnapshots,
      lifecycle: lifecycleControl,
      persistedState
    },
    operationalHealth: {
      state: operationalState,
      dependencies: health.dependencies,
      degradedMode: health.degradedMode,
      retryPlan,
      lifecycleControls: lifecycleControl,
      providerContract,
      providerSyncState,
      clientRequestState,
      persistedState,
      artifactState,
      artifactTransitionProof,
      custodyBoundary,
      operationalIncident,
      readiness,
      validationSummary,
      errors: actionableErrors
    },
    clientContracts: {
      requestState: clientRequestState,
      previewAcceptance,
      workflowHandoff,
      routeCommand: clientRouteCommand,
      readiness,
      validationSummary,
      nextStep: previewAcceptance.nextStep
    },
    auditHandoff,
    reporting: {
      analyticsCounters,
      reportingState,
      exportSummary,
      timeline,
      lifecycleProof,
      persistedState,
      artifactTransitionProof,
      clientRouteCommand,
      custodyBoundary,
      validationSummary
    }
  };
}

export default describeQuarantineRecordSurface;
