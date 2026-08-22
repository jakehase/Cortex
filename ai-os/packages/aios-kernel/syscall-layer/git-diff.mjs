export const surfaceId = "aios_syscall-layer_git-diff_025";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "git-diff";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_WORKSPACE_ROOT = '/workspace';
const DIFF_STATUSES = new Set([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted'
]);
const ROLE_CAPABILITIES = {
  owner: ['read-diff', 'read-patch', 'review-binary', 'view-deleted'],
  maintainer: ['read-diff', 'read-patch', 'review-binary', 'view-deleted'],
  developer: ['read-diff', 'read-patch', 'view-deleted'],
  reviewer: ['read-diff', 'view-deleted'],
  viewer: ['read-diff']
};
const SENSITIVE_PATH_PARTS = new Set([
  '.env',
  '.ssh',
  '.aws',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519'
]);
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 4000;
const PROVIDER_CAPABILITIES = new Set([
  'metadata',
  'patch',
  'rename-detection',
  'binary-metadata',
  'sync-cursor',
  'external-review'
]);
const DEFAULT_PROVIDER_CAPABILITIES = ['metadata', 'binary-metadata', 'sync-cursor'];
const LIFECYCLE_COMMANDS = new Set([
  'enable',
  'disable',
  'pause',
  'resume',
  'refresh',
  'open-review',
  'open-boundary-audit',
  'request-patch-permission',
  'schedule',
  'clear-schedule'
]);
const LIFECYCLE_MODES = new Set(['active', 'disabled', 'paused', 'scheduled']);
const ACCEPTANCE_ACTIONS = new Set(['accept-preview', 'request-changes', 'defer-review', 'reject-preview']);
const CLIENT_HANDOFF_INTENTS = new Set([
  'open-review',
  'continue-review',
  'refresh-diff',
  'boundary-audit',
  'capture-acceptance',
  'return-to-workspace'
]);
const MIN_SCHEDULE_INTERVAL_MS = 5000;
const MAX_SCHEDULE_INTERVAL_MS = 3600000;
const MAX_ANALYTICS_HISTORY = 12;
const PERSISTED_STATE_VERSION = 'git-diff-state.v1';
const PERSISTED_STATUSES = new Set([
  'idle',
  'refreshing',
  'review-ready',
  'blocked',
  'paused',
  'disabled',
  'recovering',
  'scheduled'
]);
const RESTART_RECOVERY_STATUSES = new Set(['refreshing', 'recovering']);
const IDEMPOTENT_COMMANDS = new Set([
  'enable',
  'disable',
  'pause',
  'resume',
  'refresh',
  'open-review',
  'open-boundary-audit',
  'request-patch-permission',
  'schedule',
  'clear-schedule'
]);
const HEALTH_SEVERITY_RANK = {
  info: 0,
  warning: 1,
  error: 2,
  fatal: 3
};
const PROVIDER_HEALTH_STATES = new Set([
  'healthy',
  'degraded',
  'unavailable',
  'rate-limited',
  'auth-required',
  'unknown'
]);
const TRANSIENT_PROVIDER_FAILURE_CODES = new Set([
  'provider-timeout',
  'provider-unavailable',
  'provider-rate-limited',
  'provider-sync-in-progress',
  'provider-circuit-open'
]);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeIsoTimestamp(value) {
  const text = asString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : '';
}

function uniqueStrings(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => asString(item))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort();
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeProviderHealthState(value) {
  const state = asString(value, 'unknown').toLowerCase();
  return PROVIDER_HEALTH_STATES.has(state) ? state : 'unknown';
}

function normalizeRetryAfterMs(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) {
      return Math.max(0, parsedDate - Date.now());
    }
  }

  return Math.min(asFiniteNumber(value), RETRY_MAX_DELAY_MS * 4);
}

function normalizePath(value, fallback = '') {
  const raw = asString(value, fallback).replace(/\\/g, '/');
  const parts = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  return `${raw.startsWith('/') ? '/' : ''}${parts.join('/')}` || fallback;
}

function normalizeWorkspaceRoot(value) {
  const root = normalizePath(value, DEFAULT_WORKSPACE_ROOT);
  return root.startsWith('/') ? root : `/${root}`;
}

function normalizeRole(value) {
  const role = asString(value, 'viewer').toLowerCase();
  return ROLE_CAPABILITIES[role] ? role : 'viewer';
}

function normalizeCapabilityList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = [];
  for (const capability of source) {
    const name = asString(capability).toLowerCase();
    if (PROVIDER_CAPABILITIES.has(name) && !normalized.includes(name)) {
      normalized.push(name);
    }
  }

  return normalized.sort();
}

function normalizeProviderFailureSignals(provider, sync, request, state) {
  const health = asRecord(provider.health || provider.status || request.providerHealth || state.gitDiffProviderHealth);
  const lastError = asRecord(provider.lastError || sync.lastError || health.lastError || request.providerError);
  const circuitBreaker = asRecord(
    provider.circuitBreaker
    || health.circuitBreaker
    || request.providerCircuitBreaker
    || state.gitDiffProviderCircuitBreaker
  );
  const healthState = normalizeProviderHealthState(
    health.state
    || health.status
    || provider.healthState
    || provider.status
    || sync.healthState
  );
  const explicitCodes = uniqueStrings([
    ...uniqueStrings(health.failureCodes || health.codes),
    ...uniqueStrings(provider.failureCodes),
    ...uniqueStrings(sync.failureCodes),
    asString(lastError.code),
    asString(request.providerFailureCode)
  ]);
  const derivedCodes = [
    healthState === 'unavailable' ? 'provider-unavailable' : '',
    healthState === 'rate-limited' ? 'provider-rate-limited' : '',
    healthState === 'auth-required' ? 'provider-auth-required' : '',
    asBoolean(circuitBreaker.open, false) ? 'provider-circuit-open' : ''
  ].filter(Boolean);
  const failureCodes = uniqueStrings([...explicitCodes, ...derivedCodes]);
  const retryAfterMs = normalizeRetryAfterMs(
    health.retryAfterMs
    ?? health.retryAfter
    ?? lastError.retryAfterMs
    ?? lastError.retryAfter
    ?? provider.retryAfterMs
    ?? sync.retryAfterMs
  );
  const retryable = failureCodes.some((code) => TRANSIENT_PROVIDER_FAILURE_CODES.has(code))
    || healthState === 'rate-limited'
    || healthState === 'unavailable';

  return {
    healthState,
    healthy: healthState === 'healthy' && failureCodes.length === 0 && !asBoolean(circuitBreaker.open, false),
    degraded: healthState === 'degraded' || retryable,
    retryable,
    retryAfterMs,
    incidentId: asString(health.incidentId || lastError.incidentId || provider.incidentId),
    failureCodes,
    lastError: {
      code: asString(lastError.code),
      message: asString(lastError.message || health.message),
      occurredAt: normalizeIsoTimestamp(lastError.occurredAt || lastError.at || health.checkedAt)
    },
    circuitBreaker: {
      open: asBoolean(circuitBreaker.open, false),
      reason: asString(circuitBreaker.reason),
      openedAt: normalizeIsoTimestamp(circuitBreaker.openedAt),
      resetAt: normalizeIsoTimestamp(circuitBreaker.resetAt || circuitBreaker.nextAttemptAt)
    }
  };
}

function buildProviderFailurePlan({
  operational,
  providerCapabilities,
  requestedCapabilities,
  cursor,
  externalReviewUrl,
  rawFileCount
}) {
  const transientCodes = operational.failureCodes
    .filter((code) => TRANSIENT_PROVIDER_FAILURE_CODES.has(code));
  const blockingCodes = [
    operational.healthState === 'auth-required' ? 'provider-auth-required' : '',
    operational.healthState === 'unavailable' && !cursor && rawFileCount > 0 ? 'provider-unavailable-no-checkpoint' : '',
    requestedCapabilities.some((capability) => !providerCapabilities.includes(capability))
      ? 'provider-capability-contract-gap'
      : ''
  ].filter(Boolean);
  const checkpointBacked = Boolean(cursor);
  const metadataAvailable = operational.healthy || checkpointBacked || rawFileCount > 0;
  const liveProviderAvailable = operational.healthState === 'healthy' || operational.healthState === 'degraded';
  const patchAvailable = providerCapabilities.includes('patch')
    && requestedCapabilities.includes('patch')
    && liveProviderAvailable
    && !operational.circuitBreaker.open;
  const state = blockingCodes.length > 0
    ? 'blocked'
    : transientCodes.length > 0 || operational.retryable || operational.degraded || operational.circuitBreaker.open
      ? 'degraded'
      : 'ready';
  const mode = state === 'blocked'
    ? blockingCodes[0]
    : operational.circuitBreaker.open
      ? 'provider-circuit-breaker-open'
      : operational.healthState === 'rate-limited'
        ? 'provider-rate-limit-backoff'
        : operational.healthState === 'unavailable'
          ? 'checkpoint-backed-provider-outage'
          : operational.healthState === 'degraded'
            ? 'provider-degraded-metadata-review'
            : 'normal-provider-service';
  const route = state === 'blocked' && operational.healthState === 'auth-required'
    ? 'syscall-layer/provider-contracts/auth'
    : operational.circuitBreaker.open || transientCodes.length > 0 || operational.retryable
      ? 'syscall-layer/git-diff/provider-health'
      : externalReviewUrl ? 'external/provider-review' : 'client-runtime/review-panel';
  const command = state === 'blocked'
    ? operational.healthState === 'auth-required' ? 'reconnect-provider' : 'open-provider-health'
    : state === 'degraded'
      ? operational.retryable || transientCodes.length > 0 ? 'refresh' : 'continue-metadata-review'
      : 'open-review';

  return {
    schema: 'git-diff-provider-failure-plan.v1',
    state,
    mode,
    retryable: state !== 'blocked' && (operational.retryable || transientCodes.length > 0),
    retryAfterMs: operational.retryAfterMs,
    retryableCodes: transientCodes,
    blockingCodes,
    capabilities: {
      metadataAvailable,
      patchAvailable,
      checkpointBacked,
      liveProviderAvailable,
      externalReviewAvailable: Boolean(externalReviewUrl)
    },
    degradedRead: {
      allowed: state === 'ready' || (state === 'degraded' && metadataAvailable),
      source: checkpointBacked
        ? 'sync-cursor-checkpoint'
        : rawFileCount > 0 ? 'request-snapshot' : 'provider-live',
      patchMode: patchAvailable ? 'patch-visible' : 'metadata-only',
      reason: state === 'ready' ? 'provider-contract-ready' : mode
    },
    nextAction: {
      command,
      route,
      reason: blockingCodes[0] || transientCodes[0] || operational.failureCodes[0] || mode
    },
    proofInputs: {
      healthState: operational.healthState,
      failureCodes: operational.failureCodes,
      incidentId: operational.incidentId,
      circuitOpen: operational.circuitBreaker.open,
      cursorPresent: checkpointBacked,
      requestedCapabilities,
      providerCapabilities
    }
  };
}

function buildProviderServiceContract({
  serviceId,
  contractVersion,
  providerCapabilities,
  requestedCapabilities,
  grantedCapabilities,
  missingCapabilities,
  providerMaxFiles,
  cursor,
  sequence,
  lastSyncedAt,
  lastSyncedTime,
  externalReviewUrl,
  operational,
  rawFileCount,
  provider,
  sync,
  request
}) {
  const syncStaleAfterMs = Math.min(
    asFiniteNumber(provider.syncStaleAfterMs ?? sync.staleAfterMs ?? request.syncStaleAfterMs, 900000),
    86400000
  );
  const lastSyncAgeMs = Number.isNaN(lastSyncedTime) ? 0 : Math.max(0, Date.now() - lastSyncedTime);
  const syncCursorRequired = requestedCapabilities.includes('sync-cursor')
    || Boolean(externalReviewUrl)
    || rawFileCount > 0;
  const missingSyncFields = [
    syncCursorRequired && !cursor ? 'cursor' : '',
    syncCursorRequired && sequence === 0 ? 'sequence' : '',
    rawFileCount > 0 && !lastSyncedAt ? 'lastSyncedAt' : ''
  ].filter(Boolean);
  const freshnessState = !lastSyncedAt && rawFileCount > 0
    ? 'missing-sync-timestamp'
    : lastSyncedAt && lastSyncAgeMs > syncStaleAfterMs
      ? 'stale'
      : cursor ? 'fresh' : 'not-established';
  const obligations = {
    metadata: providerCapabilities.includes('metadata'),
    patch: requestedCapabilities.includes('patch')
      ? grantedCapabilities.includes('patch')
      : providerCapabilities.includes('patch'),
    binaryMetadata: providerCapabilities.includes('binary-metadata'),
    resumableCursor: providerCapabilities.includes('sync-cursor') && Boolean(cursor),
    externalReview: providerCapabilities.includes('external-review') || Boolean(externalReviewUrl)
  };
  const violations = [
    !obligations.metadata ? 'metadata-capability-required' : '',
    missingCapabilities.length > 0 ? 'requested-capability-missing' : '',
    missingSyncFields.length > 0 ? 'sync-metadata-incomplete' : '',
    freshnessState === 'stale' ? 'sync-metadata-stale' : '',
    operational.healthState === 'auth-required' ? 'provider-auth-required' : '',
    operational.circuitBreaker.open ? 'provider-circuit-open' : ''
  ].filter(Boolean);
  const readinessState = violations.length === 0
    ? 'fulfilled'
    : violations.every((violation) => violation === 'sync-metadata-stale')
      ? 'degraded'
      : 'blocked';

  return {
    schema: 'git-diff-provider-service-contract.v1',
    contractId: `${serviceId}:${contractVersion}`,
    readinessState,
    ready: readinessState === 'fulfilled',
    capabilityDecision: {
      requested: requestedCapabilities,
      granted: grantedCapabilities,
      missing: missingCapabilities,
      providerAdvertised: providerCapabilities
    },
    obligations,
    syncSla: {
      cursorRequired: syncCursorRequired,
      missingFields: missingSyncFields,
      freshnessState,
      lastSyncedAt,
      lastSyncAgeMs,
      staleAfterMs: syncStaleAfterMs,
      sequence
    },
    handoffRequirement: {
      required: readinessState !== 'fulfilled' || Boolean(externalReviewUrl),
      reason: violations[0] || (externalReviewUrl ? 'external-review-url-present' : ''),
      target: externalReviewUrl ? 'external-review-url' : 'hosted-kernel-provider',
      url: externalReviewUrl
    },
    violations,
    proofInputs: {
      serviceId,
      contractVersion,
      maxFiles: providerMaxFiles,
      rawFileCount,
      healthState: operational.healthState,
      circuitOpen: operational.circuitBreaker.open
    }
  };
}

function normalizeProviderContract(input, request, client, state, rawFileCount) {
  const provider = asRecord(input.provider || request.provider || client.gitProvider || state.gitProvider);
  const sync = asRecord(provider.sync || request.sync || state.gitDiffSync);
  const providerCapabilities = normalizeCapabilityList(
    provider.capabilities || request.providerCapabilities,
    DEFAULT_PROVIDER_CAPABILITIES
  );
  const requestedCapabilities = normalizeCapabilityList(
    request.requiredProviderCapabilities || input.requiredProviderCapabilities,
    request.includePatch || input.includePatch ? ['metadata', 'patch'] : ['metadata']
  );
  const grantedCapabilities = requestedCapabilities.filter((capability) => providerCapabilities.includes(capability));
  const missingCapabilities = requestedCapabilities.filter((capability) => !providerCapabilities.includes(capability));
  const providerMaxFiles = Math.min(
    asFiniteNumber(provider.maxFiles ?? sync.maxFiles, DEFAULT_MAX_FILES),
    DEFAULT_MAX_FILES
  );
  const cursor = asString(sync.cursor || sync.token || request.syncCursor || state.syncCursor);
  const lastSyncedAt = asString(sync.lastSyncedAt || sync.syncedAt || state.lastGitDiffSyncAt);
  const lastSyncedTime = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  const sequence = Math.floor(asFiniteNumber(sync.sequence ?? sync.revision ?? state.gitDiffSequence));
  const externalReviewUrl = asString(provider.externalReviewUrl || request.externalReviewUrl || sync.externalReviewUrl);
  const serviceId = asString(provider.serviceId || provider.id || client.providerId, 'hosted-kernel-git-provider');
  const contractVersion = asString(provider.contractVersion || provider.version, 'git-diff-provider.v1');
  const operational = normalizeProviderFailureSignals(provider, sync, request, state);
  const serviceContract = buildProviderServiceContract({
    serviceId,
    contractVersion,
    providerCapabilities,
    requestedCapabilities,
    grantedCapabilities,
    missingCapabilities,
    providerMaxFiles,
    cursor,
    sequence,
    lastSyncedAt: Number.isNaN(lastSyncedTime) ? '' : lastSyncedAt,
    lastSyncedTime,
    externalReviewUrl,
    operational,
    rawFileCount,
    provider,
    sync,
    request
  });
  const failurePlan = buildProviderFailurePlan({
    operational,
    providerCapabilities,
    requestedCapabilities,
    cursor,
    externalReviewUrl,
    rawFileCount
  });
  const handoffState = missingCapabilities.length > 0
    ? 'capability-upgrade-required'
    : operational.circuitBreaker.open
      ? 'provider-circuit-open'
      : operational.healthState === 'auth-required'
        ? 'provider-auth-required'
        : cursor
          ? 'sync-cursor-ready'
          : rawFileCount > 0 ? 'snapshot-only' : 'awaiting-provider-sync';

  return {
    serviceId,
    contractVersion,
    providerName: asString(provider.name, serviceId),
    providerCapabilities,
    requestedCapabilities,
    grantedCapabilities,
    missingCapabilities,
    maxFiles: providerMaxFiles,
    sync: {
      cursor,
      sequence,
      lastSyncedAt: Number.isNaN(lastSyncedTime) ? '' : lastSyncedAt,
      stale: !lastSyncedAt && rawFileCount > 0,
      source: cursor ? 'cursor' : rawFileCount > 0 ? 'snapshot' : 'empty-provider-state'
    },
    operational,
    failurePlan,
    serviceContract,
    externalHandoff: {
      state: serviceContract.handoffRequirement.required ? handoffState : 'contract-fulfilled',
      target: serviceContract.handoffRequirement.target,
      url: serviceContract.handoffRequirement.url,
      reason: serviceContract.handoffRequirement.reason || failurePlan.nextAction.reason,
      requiredCapabilities: missingCapabilities,
      providerServiceId: serviceId,
      failurePlanState: failurePlan.state,
      nextAction: failurePlan.nextAction
    }
  };
}

function normalizeActor(input, request, client, state) {
  const actor = asRecord(input.actor || request.actor || client.actor || state.actor);
  const role = normalizeRole(actor.role || request.role || client.role || state.role);
  const capabilities = new Set(ROLE_CAPABILITIES[role]);
  const explicitPermissions = Array.isArray(actor.permissions)
    ? actor.permissions
    : Array.isArray(request.permissions)
      ? request.permissions
      : [];
  for (const permission of explicitPermissions) {
    if (typeof permission === 'string' && permission.startsWith('git-diff:')) {
      capabilities.add(permission.slice('git-diff:'.length));
    }
  }

  return {
    actorId: asString(actor.actorId || actor.id || client.userId, 'anonymous-actor'),
    tenantId: asString(actor.tenantId || request.tenantId || client.tenantId || state.tenantId, 'default-tenant'),
    role,
    capabilities: [...capabilities].sort()
  };
}

function collectScopedIds(...values) {
  const ids = [];
  for (const value of values) {
    const source = Array.isArray(value) ? value : [value];
    for (const item of source) {
      const record = asRecord(item);
      const id = asString(
        item,
        asString(record.id || record.workspaceId || record.tenantId || record.scopeId || record.name)
      );
      if (id && !ids.includes(id)) ids.push(id);
    }
  }

  return ids.sort();
}

function normalizeWorkspaceAccess(input, request, client, state, actor, includePatch) {
  const workspace = asRecord(input.workspace || request.workspace || client.workspace || state.workspace);
  const access = asRecord(
    input.workspaceAccess
    || request.workspaceAccess
    || workspace.access
    || client.workspaceAccess
    || state.workspaceAccess
    || state.tenantPermissions
  );
  const memberships = Array.isArray(access.memberships)
    ? access.memberships
    : Array.isArray(access.workspaceMemberships)
      ? access.workspaceMemberships
      : [];
  const grant = asRecord(access.grant || access.currentGrant || workspace.grant);
  const allowedTenantIds = collectScopedIds(
    access.allowedTenantIds,
    access.tenantIds,
    grant.tenantId,
    memberships.map((membership) => asRecord(membership).tenantId)
  );
  const allowedWorkspaceIds = collectScopedIds(
    access.allowedWorkspaceIds,
    access.workspaceIds,
    grant.workspaceId,
    memberships.map((membership) => asRecord(membership).workspaceId)
  );
  const deniedWorkspaceIds = collectScopedIds(access.deniedWorkspaceIds, access.blockedWorkspaceIds);
  const tenantClaimRequired = allowedTenantIds.length > 0;
  const workspaceClaimRequired = allowedWorkspaceIds.length > 0;
  const tenantAllowed = !tenantClaimRequired || allowedTenantIds.includes(actor.tenantId);
  const workspaceAllowed = !workspaceClaimRequired || allowedWorkspaceIds.includes(request.workspaceId);
  const workspaceDenied = deniedWorkspaceIds.includes(request.workspaceId);
  const requiredCapabilities = [
    'read-diff',
    includePatch ? 'read-patch' : ''
  ].filter(Boolean);
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !actor.capabilities.includes(capability));
  const boundaryReasons = [
    tenantAllowed ? '' : 'tenant-scope-claim-missing',
    workspaceAllowed ? '' : 'workspace-scope-claim-missing',
    workspaceDenied ? 'workspace-explicitly-denied' : '',
    ...missingCapabilities.map((capability) => `${capability}-capability-missing`)
  ].filter(Boolean);
  const explicitContract = Boolean(
    access.schema
    || access.contractId
    || allowedTenantIds.length
    || allowedWorkspaceIds.length
    || deniedWorkspaceIds.length
    || memberships.length
  );
  const membershipState = boundaryReasons.length === 0
    ? explicitContract ? 'granted' : 'implicit-request-scope'
    : 'denied';

  return {
    schema: 'git-diff-workspace-access.v1',
    contractId: asString(access.contractId || access.id, `${actor.tenantId}:${request.workspaceId}:workspace-access`),
    membershipState,
    allowed: boundaryReasons.length === 0,
    actorId: actor.actorId,
    actorRole: actor.role,
    tenantId: actor.tenantId,
    workspaceId: request.workspaceId,
    scopeKey: `${actor.tenantId}:${request.workspaceId}`,
    explicitContract,
    allowedTenantIds,
    allowedWorkspaceIds,
    deniedWorkspaceIds,
    requiredCapabilities,
    missingCapabilities,
    boundaryReasons,
    auditHandoff: {
      required: boundaryReasons.length > 0,
      route: 'security/audit-boundary-review',
      reason: boundaryReasons[0] || '',
      evidenceKind: 'workspace-access-contract'
    }
  };
}

function pathContainsSensitivePart(path) {
  return normalizePath(path)
    .split('/')
    .some((part) => SENSITIVE_PATH_PARTS.has(part) || part.startsWith('.env.'));
}

function pathContainsParentTraversal(path) {
  return asString(path)
    .replace(/\\/g, '/')
    .split('/')
    .some((part) => part === '..');
}

function normalizeDiffFile(file, index) {
  const source = asRecord(file);
  const path = asString(source.path || source.file || source.name, `unknown-file-${index + 1}`);
  const status = DIFF_STATUSES.has(source.status) ? source.status : 'modified';
  const additions = asFiniteNumber(source.additions ?? source.addedLines);
  const deletions = asFiniteNumber(source.deletions ?? source.deletedLines);
  const hunks = Array.isArray(source.hunks) ? source.hunks.length : asFiniteNumber(source.hunks);
  const binary = Boolean(source.binary);

  return {
    path,
    status,
    additions,
    deletions,
    hunks,
    binary,
    tenantId: asString(source.tenantId),
    workspaceId: asString(source.workspaceId),
    reviewWeight: binary ? 5 : additions + deletions + (hunks * 3)
  };
}

function lifecycleCommandDecision(command, lifecycleState) {
  const { mode, scheduleEnabled, nextRunAt, intervalMs } = lifecycleState;
  const disabled = mode === 'disabled';
  const paused = mode === 'paused';
  const scheduled = mode === 'scheduled' || scheduleEnabled;
  const scheduleProof = {
    enabled: scheduleEnabled,
    intervalMs,
    nextRunAt
  };

  if (disabled && command !== 'enable') {
    return {
      command,
      state: 'blocked',
      allowed: false,
      journalable: false,
      reason: 'lifecycle-disabled',
      nextState: 'disabled',
      route: 'settings/lifecycle-controls',
      proof: scheduleProof
    };
  }
  if (paused && (command === 'refresh' || command === 'open-review')) {
    return {
      command,
      state: 'deferred',
      allowed: false,
      journalable: false,
      reason: 'lifecycle-paused',
      nextState: 'paused',
      route: 'settings/lifecycle-controls',
      proof: scheduleProof
    };
  }

  switch (command) {
    case 'enable':
      return {
        command,
        state: disabled ? 'allowed' : 'noop',
        allowed: true,
        journalable: disabled,
        reason: disabled ? 'enable-disabled-lifecycle' : 'already-enabled',
        nextState: 'active',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'disable':
      return {
        command,
        state: disabled ? 'noop' : 'allowed',
        allowed: !disabled,
        journalable: !disabled,
        reason: disabled ? 'already-disabled' : 'disable-lifecycle',
        nextState: 'disabled',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'pause':
      return {
        command,
        state: paused ? 'noop' : 'allowed',
        allowed: !paused,
        journalable: !paused,
        reason: paused ? 'already-paused' : 'pause-lifecycle',
        nextState: 'paused',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'resume':
      return {
        command,
        state: paused ? 'allowed' : 'noop',
        allowed: true,
        journalable: paused,
        reason: paused ? 'resume-paused-lifecycle' : 'lifecycle-not-paused',
        nextState: scheduled ? 'scheduled' : 'active',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'schedule':
      return {
        command,
        state: paused ? 'deferred' : 'allowed',
        allowed: !paused,
        journalable: !paused,
        reason: paused ? 'schedule-deferred-while-paused' : 'schedule-refresh',
        nextState: 'scheduled',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'clear-schedule':
      return {
        command,
        state: scheduled ? 'allowed' : 'noop',
        allowed: true,
        journalable: scheduled,
        reason: scheduled ? 'clear-scheduled-refresh' : 'no-schedule-to-clear',
        nextState: 'active',
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
    case 'refresh':
      return {
        command,
        state: 'allowed',
        allowed: true,
        journalable: true,
        reason: scheduled ? 'manual-refresh-while-scheduled' : 'manual-refresh',
        nextState: 'refreshing',
        route: 'syscall-layer/git-diff',
        proof: scheduleProof
      };
    case 'open-review':
      return {
        command,
        state: 'allowed',
        allowed: true,
        journalable: true,
        reason: 'open-review-panel',
        nextState: 'review-ready',
        route: 'client-runtime/review-panel',
        proof: scheduleProof
      };
    case 'open-boundary-audit':
      return {
        command,
        state: 'allowed',
        allowed: true,
        journalable: true,
        reason: 'open-boundary-audit',
        nextState: 'blocked',
        route: 'security/audit-boundary-review',
        proof: scheduleProof
      };
    case 'request-patch-permission':
      return {
        command,
        state: 'allowed',
        allowed: true,
        journalable: true,
        reason: 'request-patch-permission',
        nextState: 'blocked',
        route: 'settings/permissions',
        proof: scheduleProof
      };
    default:
      return {
        command,
        state: 'blocked',
        allowed: false,
        journalable: false,
        reason: 'unsupported-lifecycle-command',
        nextState: mode,
        route: 'settings/lifecycle-controls',
        proof: scheduleProof
      };
  }
}

function buildLifecycleCommandPolicy({ mode, commands, schedule }) {
  const decisions = commands.map((command) => lifecycleCommandDecision(command, {
    mode,
    scheduleEnabled: schedule.enabled,
    intervalMs: schedule.intervalMs,
    nextRunAt: schedule.nextRunAt
  }));
  const journalableCommands = decisions
    .filter((decision) => decision.journalable)
    .map((decision) => decision.command);
  const blockedCommands = decisions.filter((decision) => decision.state === 'blocked');
  const deferredCommands = decisions.filter((decision) => decision.state === 'deferred');
  const noopCommands = decisions.filter((decision) => decision.state === 'noop');
  const primaryDecision = blockedCommands[0] || deferredCommands[0] || decisions.find((decision) => decision.journalable) || decisions[0] || null;

  return {
    schema: 'git-diff-lifecycle-command-policy.v1',
    state: blockedCommands.length > 0
      ? 'blocked'
      : deferredCommands.length > 0
        ? 'deferred'
        : journalableCommands.length > 0 ? 'actionable' : 'observed',
    executableCommands: journalableCommands,
    blockedCommands: blockedCommands.map((decision) => decision.command),
    deferredCommands: deferredCommands.map((decision) => decision.command),
    noopCommands: noopCommands.map((decision) => decision.command),
    decisions,
    nextAction: primaryDecision ? {
      command: primaryDecision.command,
      state: primaryDecision.state,
      route: primaryDecision.route,
      reason: primaryDecision.reason,
      nextState: primaryDecision.nextState
    } : {
      command: '',
      state: 'observed',
      route: 'syscall-layer/git-diff',
      reason: 'no-lifecycle-command',
      nextState: mode
    }
  };
}

function normalizeLifecycleControls(input, request, client, state) {
  const settings = asRecord(input.settings || request.settings || client.settings || state.settings);
  const lifecycle = asRecord(input.lifecycle || request.lifecycle || settings.lifecycle || state.gitDiffLifecycle);
  const schedule = asRecord(lifecycle.schedule || settings.schedule);
  const rawMode = asString(lifecycle.mode || settings.mode, '').toLowerCase();
  const enabled = asBoolean(lifecycle.enabled ?? settings.enabled ?? request.enabled, true);
  const mode = enabled
    ? LIFECYCLE_MODES.has(rawMode) && rawMode !== 'disabled' ? rawMode : 'active'
    : 'disabled';
  const rawCommands = Array.isArray(lifecycle.commands)
    ? lifecycle.commands
    : Array.isArray(request.commands)
      ? request.commands
      : [lifecycle.command || request.command || input.command].filter(Boolean);
  const commands = [];
  const rejectedCommands = [];
  for (const command of rawCommands) {
    const normalized = asString(command).toLowerCase();
    if (!normalized) continue;
    if (LIFECYCLE_COMMANDS.has(normalized)) {
      if (!commands.includes(normalized)) commands.push(normalized);
    } else {
      rejectedCommands.push(normalized);
    }
  }

  const requestedIntervalMs = asFiniteNumber(schedule.intervalMs ?? lifecycle.scheduleIntervalMs ?? settings.scheduleIntervalMs, 60000);
  const intervalMs = Math.min(Math.max(requestedIntervalMs, MIN_SCHEDULE_INTERVAL_MS), MAX_SCHEDULE_INTERVAL_MS);
  const rawNextRunAt = asString(schedule.nextRunAt || lifecycle.nextRunAt || settings.nextRunAt);
  const nextRunTime = rawNextRunAt ? Date.parse(rawNextRunAt) : NaN;
  const scheduleEnabled = asBoolean(schedule.enabled ?? lifecycle.scheduleEnabled, mode === 'scheduled');
  const validationErrors = [];

  if (rawMode && !LIFECYCLE_MODES.has(rawMode)) validationErrors.push('unsupported-lifecycle-mode');
  if (rejectedCommands.length > 0) validationErrors.push('unsupported-lifecycle-command');
  if (requestedIntervalMs !== intervalMs) validationErrors.push('schedule-interval-out-of-range');
  if (scheduleEnabled && rawNextRunAt && Number.isNaN(nextRunTime)) validationErrors.push('invalid-next-run-at');
  if (mode === 'disabled' && commands.some((command) => command !== 'enable')) validationErrors.push('disabled-surface-command-denied');
  if (mode === 'paused' && commands.some((command) => command === 'refresh' || command === 'open-review')) {
    validationErrors.push('paused-surface-command-deferred');
  }
  const normalizedSchedule = {
    enabled: scheduleEnabled,
    intervalMs,
    nextRunAt: Number.isNaN(nextRunTime) ? '' : rawNextRunAt,
    timezone: asString(schedule.timezone || lifecycle.timezone || settings.timezone, 'UTC')
  };
  const commandPolicy = buildLifecycleCommandPolicy({
    mode,
    commands,
    schedule: normalizedSchedule
  });

  return {
    enabled: mode !== 'disabled',
    mode,
    commands,
    rejectedCommands,
    validationErrors,
    schedule: normalizedSchedule,
    commandPolicy
  };
}

function normalizePreviewAcceptance(input, request, client, state) {
  const preview = asRecord(input.preview || request.preview || client.preview || state.gitDiffPreview);
  const acceptance = asRecord(input.acceptance || request.acceptance || preview.acceptance || state.gitDiffAcceptance);
  const rawAction = asString(acceptance.action || request.acceptanceAction || preview.action).toLowerCase();
  const action = ACCEPTANCE_ACTIONS.has(rawAction) ? rawAction : '';
  const checklist = Array.isArray(acceptance.checklist)
    ? acceptance.checklist
    : Array.isArray(preview.checklist)
      ? preview.checklist
      : [];
  const acknowledgedItems = checklist
    .map((item) => asString(item))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort();
  const requiredItems = Array.isArray(preview.requiredAcknowledgements)
    ? preview.requiredAcknowledgements
    : Array.isArray(acceptance.requiredAcknowledgements)
      ? acceptance.requiredAcknowledgements
      : [];
  const requiredAcknowledgements = requiredItems
    .map((item) => asString(item))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort();
  const missingAcknowledgements = requiredAcknowledgements.filter((item) => !acknowledgedItems.includes(item));

  return {
    previewId: asString(preview.previewId || acceptance.previewId || request.previewId, `${request.requestId}:preview`),
    action,
    actorAccepted: action === 'accept-preview',
    decisionAt: asString(acceptance.decisionAt || preview.decisionAt),
    requiredAcknowledgements,
    acknowledgedItems,
    missingAcknowledgements,
    notes: asString(acceptance.notes || preview.notes),
    requireExplicitAcceptance: asBoolean(preview.requireExplicitAcceptance ?? acceptance.requireExplicitAcceptance, true)
  };
}

function normalizeClientRuntime(input, request, client, state) {
  const runtime = asRecord(input.clientRuntime || request.clientRuntime || client.runtime || state.clientRuntime);
  const route = asRecord(runtime.route || request.route || client.route);
  const review = asRecord(runtime.review || runtime.reviewPanel || state.reviewPanel);
  const rawIntent = asString(runtime.handoffIntent || request.handoffIntent || review.handoffIntent).toLowerCase();
  const handoffIntent = CLIENT_HANDOFF_INTENTS.has(rawIntent) ? rawIntent : '';
  const selectedPaths = Array.isArray(review.selectedPaths)
    ? review.selectedPaths
    : Array.isArray(runtime.selectedPaths)
      ? runtime.selectedPaths
      : [];
  const pinnedPaths = Array.isArray(review.pinnedPaths)
    ? review.pinnedPaths
    : Array.isArray(runtime.pinnedPaths)
      ? runtime.pinnedPaths
      : [];
  const selection = [...new Set([...selectedPaths, ...pinnedPaths]
    .map((path) => normalizePath(path))
    .filter(Boolean))]
    .sort();
  const activeRoute = asString(route.name || route.id || runtime.activeRoute || state.activeRoute, 'workspace');
  const routeSurface = asString(route.surface || runtime.surface, surfaceName);
  const focusMode = asString(review.focusMode || runtime.focusMode, 'summary').toLowerCase();
  const draftDirty = asBoolean(review.draftDirty ?? runtime.draftDirty ?? state.gitDiffDraftDirty, false);
  const lastPreviewId = asString(review.previewId || runtime.previewId || state.gitDiffPreviewId);
  const lastAuditRef = asString(review.auditRef || runtime.auditRef || state.gitDiffAuditRef);
  const clientCursor = asString(runtime.cursor || runtime.syncCursor || state.clientSyncCursor);
  const validationErrors = [];

  if (selection.some(pathContainsParentTraversal)) validationErrors.push('client-selection-parent-traversal');
  if (routeSurface && routeSurface !== surfaceName && activeRoute.includes('git-diff')) {
    validationErrors.push('client-route-surface-mismatch');
  }
  if (draftDirty && handoffIntent === 'refresh-diff') validationErrors.push('dirty-review-draft-before-refresh');
  if (lastPreviewId && request.previewAcceptance.previewId && lastPreviewId !== request.previewAcceptance.previewId) {
    validationErrors.push('stale-client-preview');
  }

  return {
    activeRoute,
    routeSurface,
    handoffIntent,
    focusMode,
    draftDirty,
    selectedPaths: selection,
    lastPreviewId,
    lastAuditRef,
    clientCursor,
    validationErrors,
    resumeToken: [
      request.clientId,
      request.workspaceId,
      request.baseRef,
      request.headRef,
      clientCursor || 'no-client-cursor'
    ].join(':')
  };
}

function normalizeCommandJournal(value) {
  const rawJournal = Array.isArray(value) ? value : [];
  return rawJournal
    .map((entry, index) => {
      const record = asRecord(entry);
      const command = asString(record.command || record.name).toLowerCase();
      const commandId = asString(record.commandId || record.id || record.idempotencyKey, `${command || 'command'}:${index}`);
      const status = asString(record.status, 'applied').toLowerCase();
      const result = asRecord(record.result || record.receipt || record.output);
      return {
        commandId,
        command,
        status,
        appliedAt: normalizeIsoTimestamp(record.appliedAt || record.completedAt || record.createdAt),
        requestId: asString(record.requestId),
        actorId: asString(record.actorId),
        resultRef: asString(record.resultRef || record.auditRef || result.resultRef),
        resultingStatus: PERSISTED_STATUSES.has(asString(record.resultingStatus || result.status).toLowerCase())
          ? asString(record.resultingStatus || result.status).toLowerCase()
          : '',
        cursor: asString(record.cursor || result.cursor),
        duplicateSafe: status === 'applied' || status === 'completed'
      };
    })
    .filter((entry) => entry.commandId && IDEMPOTENT_COMMANDS.has(entry.command));
}

function indexAppliedCommands(journal, appliedCommandIds = []) {
  const index = {};
  for (const entry of journal) {
    if (entry.duplicateSafe) {
      index[entry.commandId] = entry;
    }
  }
  for (const commandId of appliedCommandIds) {
    if (!index[commandId]) {
      index[commandId] = {
        commandId,
        command: 'unknown',
        status: 'applied',
        appliedAt: '',
        requestId: '',
        actorId: '',
        resultRef: '',
        resultingStatus: '',
        cursor: '',
        duplicateSafe: true
      };
    }
  }

  return index;
}

function commandStatusEffect(command) {
  switch (command) {
    case 'disable':
      return { effect: 'set-disabled', resultingStatus: 'disabled', userVisibleState: 'disabled' };
    case 'pause':
      return { effect: 'set-paused', resultingStatus: 'paused', userVisibleState: 'paused' };
    case 'schedule':
      return { effect: 'set-scheduled-refresh', resultingStatus: 'scheduled', userVisibleState: 'scheduled' };
    case 'refresh':
      return { effect: 'start-provider-refresh', resultingStatus: 'refreshing', userVisibleState: 'refreshing' };
    case 'open-review':
      return { effect: 'open-review-panel', resultingStatus: 'review-ready', userVisibleState: 'review-ready' };
    case 'open-boundary-audit':
      return { effect: 'open-boundary-audit', resultingStatus: 'blocked', userVisibleState: 'blocked' };
    case 'request-patch-permission':
      return { effect: 'request-patch-permission', resultingStatus: 'blocked', userVisibleState: 'blocked' };
    case 'enable':
    case 'resume':
    case 'clear-schedule':
      return { effect: 'set-active', resultingStatus: 'idle', userVisibleState: 'idle' };
    default:
      return { effect: 'noop', resultingStatus: 'idle', userVisibleState: 'idle' };
  }
}

function buildCommandReplayReceipt(command, duplicateEntry) {
  if (!duplicateEntry) return null;
  return {
    commandId: duplicateEntry.commandId,
    command: duplicateEntry.command,
    status: 'already-applied',
    originalRequestId: duplicateEntry.requestId,
    originalActorId: duplicateEntry.actorId,
    appliedAt: duplicateEntry.appliedAt,
    resultRef: duplicateEntry.resultRef,
    resultingStatus: duplicateEntry.resultingStatus,
    cursor: duplicateEntry.cursor
  };
}

function buildPendingCommandEnvelopes(request, persisted) {
  const requestCommandId = asString(request.commandId || request.idempotencyKey);
  const commands = request.lifecycle.commandPolicy.executableCommands.length > 0
    ? request.lifecycle.commandPolicy.executableCommands
    : [];
  return commands.map((command, index) => {
    const commandId = requestCommandId || [
      request.tenantId,
      request.workspaceId,
      request.baseRef,
      request.headRef,
      command,
      request.providerContract.sync.sequence || 'no-sequence'
    ].join(':');
    const scopedCommandId = commands.length === 1 ? commandId : `${commandId}:${index}`;
    const duplicateEntry = persisted.appliedCommandIndex[scopedCommandId] || persisted.appliedCommandIndex[commandId] || null;
    const duplicate = Boolean(duplicateEntry);
    const statusEffect = commandStatusEffect(command);
    return {
      commandId: scopedCommandId,
      command,
      duplicate,
      effect: duplicate ? 'already-applied' : statusEffect.effect,
      resultingStatus: duplicateEntry?.resultingStatus || statusEffect.resultingStatus,
      userVisibleState: duplicate ? 'command-replayed' : statusEffect.userVisibleState,
      replayReceipt: buildCommandReplayReceipt(command, duplicateEntry),
      idempotencyScope: `${request.tenantId}:${request.workspaceId}:${request.baseRef}:${request.headRef}`,
      requestedBy: request.actor.actorId
    };
  });
}

function resolveNextWriteStatus(request, recoveredStatus, pendingCommands) {
  if (recoveredStatus === 'recovering') return 'recovering';
  const nextCommand = pendingCommands.find((command) => !command.duplicate);
  if (nextCommand?.resultingStatus) return nextCommand.resultingStatus;
  if (request.lifecycle.mode === 'disabled') return 'disabled';
  if (request.lifecycle.mode === 'paused') return 'paused';
  if (request.lifecycle.schedule.enabled) return 'scheduled';
  return 'idle';
}

function buildCommandJournalAppend(request, pendingCommands, now) {
  return pendingCommands
    .filter((command) => !command.duplicate)
    .map((command) => ({
      commandId: command.commandId,
      command: command.command,
      status: 'applied',
      appliedAt: now,
      requestId: request.requestId,
      actorId: request.actor.actorId,
      resultRef: `${request.requestId}:${command.commandId}`,
      resultingStatus: command.resultingStatus,
      cursor: request.providerContract.sync.cursor
    }));
}

function normalizePersistedGitDiffState(input, request, client, state, now) {
  const persisted = asRecord(
    input.persistedState
    || input.gitDiffState
    || request.persistedState
    || state.gitDiffPersistedState
    || state.gitDiffState
  );
  const journal = normalizeCommandJournal(persisted.commandJournal || persisted.commands);
  const appliedCommandIds = uniqueStrings([
    ...uniqueStrings(persisted.appliedCommandIds),
    ...journal
      .filter((entry) => entry.status === 'applied' || entry.status === 'completed')
      .map((entry) => entry.commandId)
  ]);
  const appliedCommandIndex = indexAppliedCommands(journal, appliedCommandIds);
  const status = asString(persisted.status || persisted.state, 'idle').toLowerCase();
  const normalizedStatus = PERSISTED_STATUSES.has(status) ? status : 'recovering';
  const checkpointCursor = asString(persisted.cursor || persisted.syncCursor || persisted.providerCursor);
  const providerCursor = request.providerContract.sync.cursor;
  const leaseExpiresAt = normalizeIsoTimestamp(persisted.leaseExpiresAt || persisted.lockExpiresAt);
  const leaseExpired = leaseExpiresAt ? Date.parse(leaseExpiresAt) <= Date.parse(now) : false;
  const cursorMismatch = Boolean(checkpointCursor && providerCursor && checkpointCursor !== providerCursor);
  const restartDetected = RESTART_RECOVERY_STATUSES.has(normalizedStatus) || leaseExpired || cursorMismatch;
  const recoveredStatus = request.lifecycle.mode === 'disabled'
    ? 'disabled'
    : request.lifecycle.mode === 'paused'
      ? 'paused'
      : request.lifecycle.schedule.enabled
        ? 'scheduled'
        : restartDetected ? 'recovering' : normalizedStatus;
  const recoveryReasons = [
    RESTART_RECOVERY_STATUSES.has(normalizedStatus) ? 'previous-operation-incomplete' : '',
    leaseExpired ? 'checkpoint-lease-expired' : '',
    cursorMismatch ? 'provider-cursor-mismatch' : '',
    status && !PERSISTED_STATUSES.has(status) ? 'unknown-persisted-status' : ''
  ].filter(Boolean);
  const basePersisted = {
    version: asString(persisted.version, PERSISTED_STATE_VERSION),
    checkpointId: asString(
      persisted.checkpointId || persisted.id,
      `${request.tenantId}:${request.workspaceId}:${request.baseRef}:${request.headRef}`
    ),
    status: recoveredStatus,
    previousStatus: normalizedStatus,
    cursor: checkpointCursor || providerCursor,
    providerCursor,
    lastRequestId: asString(persisted.lastRequestId || persisted.requestId),
    lastPreviewId: asString(persisted.lastPreviewId || persisted.previewId || request.previewAcceptance.previewId),
    lastAuditRef: asString(persisted.lastAuditRef || persisted.auditRef),
    updatedAt: normalizeIsoTimestamp(persisted.updatedAt) || now,
    leaseOwner: asString(persisted.leaseOwner || persisted.lockOwner),
    leaseExpiresAt,
    leaseExpired,
    recoveryAttempt: Math.floor(asFiniteNumber(persisted.recoveryAttempt)),
    appliedCommandIds,
    appliedCommandIndex,
    commandJournal: journal.slice(-20),
    recoveryReasons
  };
  const pendingCommands = buildPendingCommandEnvelopes(request, basePersisted);
  const commandJournalAppend = buildCommandJournalAppend(request, pendingCommands, now);
  const nextStatus = resolveNextWriteStatus(request, recoveredStatus, pendingCommands);

  return {
    ...basePersisted,
    restartSafe: recoveryReasons.length === 0 && recoveredStatus !== 'recovering',
    pendingCommands,
    replayedCommands: pendingCommands
      .filter((command) => command.duplicate)
      .map((command) => command.replayReceipt)
      .filter(Boolean),
    nextWrite: {
      checkpointId: basePersisted.checkpointId,
      version: PERSISTED_STATE_VERSION,
      status: nextStatus,
      previousStatus: basePersisted.status,
      cursor: providerCursor || basePersisted.cursor,
      lastRequestId: request.requestId,
      lastPreviewId: request.previewAcceptance.previewId,
      updatedAt: now,
      recoveryAttempt: recoveredStatus === 'recovering' ? basePersisted.recoveryAttempt + 1 : basePersisted.recoveryAttempt,
      leaseOwner: request.clientId,
      leaseExpiresAt: '',
      commandJournalAppend,
      appliedCommandIds: uniqueStrings([
        ...basePersisted.appliedCommandIds,
        ...commandJournalAppend.map((entry) => entry.commandId)
      ]),
      restartSafeAfterWrite: nextStatus !== 'recovering',
      writeReason: recoveredStatus === 'recovering'
        ? 'restart-recovery-checkpoint'
        : commandJournalAppend.length > 0
          ? 'idempotent-command-commit'
          : pendingCommands.some((command) => command.duplicate)
            ? 'idempotent-command-replay'
            : 'state-observation-checkpoint'
    }
  };
}

function buildBoundaryDecision(request, file) {
  const normalizedPath = normalizePath(file.path);
  const rootedPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : normalizePath(`${request.workspaceRoot}/${normalizedPath}`);
  const reasons = [];

  if (pathContainsParentTraversal(file.path)) {
    reasons.push('parent-traversal-denied');
  }
  if (!request.workspaceAccess.allowed) {
    reasons.push(...request.workspaceAccess.boundaryReasons);
  }
  if (!rootedPath.startsWith(`${request.workspaceRoot}/`) && rootedPath !== request.workspaceRoot) {
    reasons.push('outside-workspace-root');
  }
  if (file.tenantId && file.tenantId !== request.tenantId) {
    reasons.push('tenant-mismatch-denied');
  }
  if (file.workspaceId && file.workspaceId !== request.workspaceId) {
    reasons.push('workspace-mismatch-denied');
  }
  if (file.binary && !request.actor.capabilities.includes('review-binary')) {
    reasons.push('binary-review-permission-required');
  }
  if (file.status === 'deleted' && !request.actor.capabilities.includes('view-deleted')) {
    reasons.push('deleted-file-permission-required');
  }
  if (pathContainsSensitivePart(normalizedPath) && !request.actor.capabilities.includes('read-sensitive-path')) {
    reasons.push('sensitive-path-redacted');
  }

  return {
    path: file.path,
    rootedPath,
    allowed: reasons.length === 0,
    reasons
  };
}

function applyWorkspaceBoundaries(request) {
  const boundaryDecisions = request.files.map((file) => buildBoundaryDecision(request, file));
  const decisionsByPath = new Map(boundaryDecisions.map((decision) => [decision.path, decision]));
  const visibleFiles = request.files.filter((file) => decisionsByPath.get(file.path)?.allowed);
  const deniedFiles = boundaryDecisions.filter((decision) => !decision.allowed);
  const canReadPatch = request.includePatch
    && request.workspaceAccess.allowed
    && request.actor.capabilities.includes('read-patch');

  return {
    visibleFiles,
    deniedFiles,
    includePatch: canReadPatch,
    patchRedacted: request.includePatch && !canReadPatch,
    boundaryDecisions,
    access: request.workspaceAccess
  };
}

function normalizeRequest(input) {
  const request = asRecord(input.request || input.syscall || input);
  const client = asRecord(input.client || request.client);
  const state = asRecord(input.state || request.state || client.state);
  const rawFiles = Array.isArray(input.files)
    ? input.files
    : Array.isArray(request.files)
      ? request.files
      : Array.isArray(state.changedFiles)
        ? state.changedFiles
        : [];
  const providerContract = normalizeProviderContract(input, request, client, state, rawFiles.length);
  const maxFiles = Math.min(asFiniteNumber(request.maxFiles, providerContract.maxFiles), providerContract.maxFiles);
  const actor = normalizeActor(input, request, client, state);
  const retryAttempt = Math.floor(asFiniteNumber(request.retryAttempt ?? input.retryAttempt));
  const includePatch = Boolean(request.includePatch || input.includePatch)
    && providerContract.grantedCapabilities.includes('patch');
  const providerPatchRedacted = Boolean(request.includePatch || input.includePatch)
    && providerContract.missingCapabilities.includes('patch');
  const requestScope = {
    ...request,
    workspaceId: asString(request.workspaceId || state.workspaceId || client.workspaceId, 'workspace')
  };
  const workspaceAccess = normalizeWorkspaceAccess(input, requestScope, client, state, actor, includePatch);

  return {
    requestId: asString(request.requestId || request.id || input.requestId, 'git-diff-request'),
    commandId: asString(request.commandId || request.idempotencyKey || input.commandId || input.idempotencyKey),
    clientId: asString(client.clientId || client.id || state.clientId, 'anonymous-client'),
    tenantId: actor.tenantId,
    actor,
    workspaceId: requestScope.workspaceId,
    workspaceAccess,
    workspaceRoot: normalizeWorkspaceRoot(request.workspaceRoot || state.workspaceRoot || client.workspaceRoot),
    branch: asString(request.branch || state.branch || client.branch, 'unknown'),
    baseRef: asString(request.baseRef || request.base || state.baseRef, 'HEAD'),
    headRef: asString(request.headRef || request.head || state.headRef, 'working-tree'),
    intent: asString(request.intent || input.intent, 'review-working-tree-diff'),
    includePatch,
    providerPatchRedacted,
    files: rawFiles.slice(0, maxFiles).map(normalizeDiffFile),
    truncated: rawFiles.length > maxFiles,
    rawFileCount: rawFiles.length,
    maxFiles,
    retryAttempt,
    providerContract,
    lifecycle: normalizeLifecycleControls(input, request, client, state),
    previewAcceptance: normalizePreviewAcceptance(input, request, client, state),
    clientRuntime: null,
    persistedState: null,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

function attachClientRuntime(request, input, now) {
  const rawRequest = asRecord(input.request || input.syscall || input);
  const client = asRecord(input.client || rawRequest.client);
  const state = asRecord(input.state || rawRequest.state || client.state);
  const requestWithRuntime = {
    ...request,
    clientRuntime: normalizeClientRuntime(input, request, client, state)
  };
  return {
    ...requestWithRuntime,
    persistedState: normalizePersistedGitDiffState(input, requestWithRuntime, client, state, now),
    analyticsHistory: normalizeAnalyticsHistory(input, rawRequest, client, state)
  };
}

function summarizeFiles(files) {
  const totals = {
    filesChanged: files.length,
    additions: 0,
    deletions: 0,
    binaryFiles: 0,
    statuses: {}
  };

  for (const file of files) {
    totals.additions += file.additions;
    totals.deletions += file.deletions;
    totals.binaryFiles += file.binary ? 1 : 0;
    totals.statuses[file.status] = (totals.statuses[file.status] || 0) + 1;
  }

  return totals;
}

function buildReviewLanes(files) {
  const ranked = [...files].sort((left, right) => right.reviewWeight - left.reviewWeight);
  return {
    highAttention: ranked.filter((file) => file.reviewWeight >= 80).slice(0, 12),
    binaryOrDeleted: ranked.filter((file) => file.binary || file.status === 'deleted').slice(0, 12),
    quickScan: ranked.filter((file) => file.reviewWeight < 20 && !file.binary).slice(0, 12)
  };
}

function normalizeAnalyticsSnapshot(entry, index) {
  const record = asRecord(entry);
  const totals = asRecord(record.totals || record.summary || record.diff);
  const boundary = asRecord(record.boundary);
  const provider = asRecord(record.provider);
  const lifecycle = asRecord(record.lifecycle);
  const health = asRecord(record.health || record.operationalHealth);
  const capturedAt = normalizeIsoTimestamp(record.capturedAt || record.generatedAt || record.timestamp || record.createdAt);
  const filesChanged = asFiniteNumber(record.filesChanged ?? totals.filesChanged ?? totals.visibleFiles);
  const deniedFiles = asFiniteNumber(record.deniedFiles ?? boundary.deniedCount ?? boundary.deniedFiles);
  const riskFlags = uniqueStrings(record.riskFlags || health.riskFlags);
  const statusCounters = normalizeStatusCounters(record.statusCounters || totals.statuses || record.byStatus);
  const churnBuckets = asRecord(record.churnBuckets || record.churn);

  return {
    snapshotId: asString(record.snapshotId || record.id, `history-${index + 1}`),
    capturedAt,
    requestId: asString(record.requestId),
    workspaceId: asString(record.workspaceId),
    baseRef: asString(record.baseRef || asRecord(record.refs).base),
    headRef: asString(record.headRef || asRecord(record.refs).head),
    filesChanged,
    additions: asFiniteNumber(record.additions ?? totals.additions),
    deletions: asFiniteNumber(record.deletions ?? totals.deletions),
    binaryFiles: asFiniteNumber(record.binaryFiles ?? totals.binaryFiles),
    deniedFiles,
    riskFlags,
    lifecycleMode: asString(record.lifecycleMode || lifecycle.mode),
    providerServiceId: asString(record.providerServiceId || provider.serviceId),
    healthStatus: asString(record.healthStatus || health.status),
    exportRef: asString(record.exportRef || record.auditRef || record.fingerprint),
    statusCounters,
    churnBuckets: {
      tiny: Math.floor(asFiniteNumber(churnBuckets.tiny)),
      small: Math.floor(asFiniteNumber(churnBuckets.small)),
      medium: Math.floor(asFiniteNumber(churnBuckets.medium)),
      large: Math.floor(asFiniteNumber(churnBuckets.large)),
      binary: Math.floor(asFiniteNumber(churnBuckets.binary)),
      deleted: Math.floor(asFiniteNumber(churnBuckets.deleted))
    },
    visiblePathSample: uniqueStrings(record.visiblePathSample || record.paths).slice(0, 20)
  };
}

function normalizeAnalyticsHistory(input, request, client, state) {
  const analytics = asRecord(input.analytics || request.analytics || client.analytics || state.gitDiffAnalytics);
  const source = Array.isArray(analytics.history)
    ? analytics.history
    : Array.isArray(analytics.snapshots)
      ? analytics.snapshots
      : Array.isArray(state.gitDiffAnalyticsHistory)
        ? state.gitDiffAnalyticsHistory
        : [];

  return source
    .map(normalizeAnalyticsSnapshot)
    .filter((snapshot) => snapshot.snapshotId || snapshot.capturedAt || snapshot.requestId)
    .sort((left, right) => {
      const leftTime = left.capturedAt ? Date.parse(left.capturedAt) : 0;
      const rightTime = right.capturedAt ? Date.parse(right.capturedAt) : 0;
      return leftTime - rightTime;
    })
    .slice(-MAX_ANALYTICS_HISTORY);
}

function buildStatusCounters(files) {
  const counters = {};
  for (const status of DIFF_STATUSES) counters[status] = 0;
  for (const file of files) counters[file.status] = (counters[file.status] || 0) + 1;
  return counters;
}

function normalizeStatusCounters(value) {
  const record = asRecord(value);
  const counters = {};
  for (const status of DIFF_STATUSES) {
    counters[status] = Math.floor(asFiniteNumber(record[status]));
  }
  return counters;
}

function subtractStatusCounters(current, previous) {
  const delta = {};
  for (const status of DIFF_STATUSES) {
    delta[status] = Math.floor(asFiniteNumber(current[status]) - asFiniteNumber(previous?.[status]));
  }
  return delta;
}

function buildChurnBuckets(files) {
  const buckets = {
    tiny: 0,
    small: 0,
    medium: 0,
    large: 0,
    binary: 0,
    deleted: 0
  };
  const highestChurnPaths = [...files]
    .sort((left, right) => right.reviewWeight - left.reviewWeight)
    .slice(0, 8)
    .map((file) => ({
      path: file.path,
      status: file.status,
      changedLines: file.additions + file.deletions,
      reviewWeight: file.reviewWeight
    }));

  for (const file of files) {
    const changedLines = file.additions + file.deletions;
    if (file.binary) buckets.binary += 1;
    if (file.status === 'deleted') buckets.deleted += 1;
    if (changedLines === 0) buckets.tiny += 1;
    else if (changedLines < 20) buckets.small += 1;
    else if (changedLines < 100) buckets.medium += 1;
    else buckets.large += 1;
  }

  return {
    buckets,
    highestChurnPaths
  };
}

function buildAnalyticsTimeline(history, currentSnapshot, validationSummary, operationalHealth) {
  return history.map((snapshot, index) => {
    const current = snapshot.snapshotId === currentSnapshot.snapshotId;
    return {
      sequence: index + 1,
      occurredAt: snapshot.capturedAt,
      event: current ? 'current-diff-evaluated' : 'historical-diff-snapshot',
      requestId: snapshot.requestId,
      filesChanged: snapshot.filesChanged,
      deniedFiles: snapshot.deniedFiles,
      healthStatus: snapshot.healthStatus || 'unknown',
      lifecycleMode: snapshot.lifecycleMode || 'unknown',
      providerServiceId: snapshot.providerServiceId,
      exportRef: snapshot.exportRef,
      routeState: current
        ? validationSummary.valid && !operationalHealth.failureState.blocked ? 'reportable' : 'blocked'
        : 'retained'
    };
  });
}

function buildAnalyticsExportManifest(request, exportRow, priorHistory, currentSnapshot, validationSummary, now) {
  const partitionKey = [
    request.tenantId,
    request.workspaceId,
    request.baseRef,
    request.headRef
  ].join('/');

  return {
    manifestId: `${request.requestId}:analytics-export`,
    generatedAt: now,
    schema: 'git-diff-analytics-export.v1',
    partitionKey,
    destinationHint: `analytics/git-diff/${partitionKey}`,
    formats: ['jsonl-row', 'csv-row'],
    primaryKey: ['tenantId', 'workspaceId', 'requestId'],
    snapshotWrite: {
      key: `${request.persistedState.checkpointId}:analytics`,
      mode: priorHistory.some((snapshot) => snapshot.snapshotId === currentSnapshot.snapshotId) ? 'upsert' : 'append',
      retentionLimit: MAX_ANALYTICS_HISTORY,
      append: currentSnapshot
    },
    rowCount: 1,
    headers: Object.keys(exportRow),
    ready: validationSummary.providerReady && validationSummary.persistenceReady,
    blockedReasons: validationSummary.providerReady && validationSummary.persistenceReady
      ? []
      : [
        validationSummary.providerReady ? '' : 'provider-not-ready',
        validationSummary.persistenceReady ? '' : 'persistence-not-ready'
      ].filter(Boolean)
  };
}

function buildAnalyticsReport(request, summary, boundary, auditProof, operationalHealth, validationSummary, now) {
  const previous = request.analyticsHistory[request.analyticsHistory.length - 1] || null;
  const deniedReasons = [...new Set(boundary.deniedFiles.flatMap((file) => file.reasons))].sort();
  const statusCounters = buildStatusCounters(boundary.visibleFiles);
  const churn = buildChurnBuckets(boundary.visibleFiles);
  const currentSnapshot = {
    snapshotId: `${request.requestId}:analytics`,
    capturedAt: now,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    baseRef: request.baseRef,
    headRef: request.headRef,
    filesChanged: summary.filesChanged,
    additions: summary.additions,
    deletions: summary.deletions,
    binaryFiles: summary.binaryFiles,
    deniedFiles: boundary.deniedFiles.length,
    riskFlags: auditProof.riskFlags,
    lifecycleMode: request.lifecycle.mode,
    providerServiceId: request.providerContract.serviceId,
    healthStatus: operationalHealth.status,
    exportRef: auditProof.diffFingerprint,
    statusCounters,
    churnBuckets: churn.buckets,
    visiblePathSample: boundary.visibleFiles.slice(0, 20).map((file) => file.path)
  };
  const history = [...request.analyticsHistory, currentSnapshot].slice(-MAX_ANALYTICS_HISTORY);
  const lineDelta = summary.additions + summary.deletions;
  const previousLineDelta = previous ? previous.additions + previous.deletions : 0;
  const previousStatusCounters = previous ? normalizeStatusCounters(previous.statusCounters) : {};
  const statusDelta = subtractStatusCounters(statusCounters, previousStatusCounters);
  const timeline = buildAnalyticsTimeline(history, currentSnapshot, validationSummary, operationalHealth);
  const exportRow = {
    generatedAt: now,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    requestId: request.requestId,
    actorRole: request.actor.role,
    baseRef: request.baseRef,
    headRef: request.headRef,
    providerServiceId: request.providerContract.serviceId,
    providerSequence: request.providerContract.sync.sequence,
    providerHealthState: request.providerContract.operational.healthState,
    providerFailureCodes: request.providerContract.operational.failureCodes.join('|'),
    providerIncidentId: request.providerContract.operational.incidentId,
    providerFailurePlanState: request.providerContract.failurePlan.state,
    providerFailurePlanMode: request.providerContract.failurePlan.mode,
    providerFailurePlanAction: request.providerContract.failurePlan.nextAction.command,
    providerDegradedReadSource: request.providerContract.failurePlan.degradedRead.source,
    providerContractState: request.providerContract.serviceContract.readinessState,
    providerContractViolations: request.providerContract.serviceContract.violations.join('|'),
    providerSyncFreshness: request.providerContract.serviceContract.syncSla.freshnessState,
    providerSyncMissingFields: request.providerContract.serviceContract.syncSla.missingFields.join('|'),
    workspaceAccessState: request.workspaceAccess.membershipState,
    workspaceAccessContract: request.workspaceAccess.contractId,
    workspaceAccessReasons: request.workspaceAccess.boundaryReasons.join('|'),
    lifecycleMode: request.lifecycle.mode,
    lifecyclePolicyState: request.lifecycle.commandPolicy.state,
    lifecycleExecutableCommands: request.lifecycle.commandPolicy.executableCommands.join('|'),
    lifecycleBlockedCommands: request.lifecycle.commandPolicy.blockedCommands.join('|'),
    lifecycleDeferredCommands: request.lifecycle.commandPolicy.deferredCommands.join('|'),
    lifecycleNextAction: request.lifecycle.commandPolicy.nextAction.command,
    healthStatus: operationalHealth.status,
    validationState: validationSummary.valid ? 'valid' : 'blocked',
    filesReceived: request.rawFileCount,
    filesEvaluated: request.files.length,
    filesVisible: summary.filesChanged,
    filesDenied: boundary.deniedFiles.length,
    additions: summary.additions,
    deletions: summary.deletions,
    binaryFiles: summary.binaryFiles,
    truncated: request.truncated,
    patchMode: boundary.includePatch ? 'patch-visible' : boundary.patchRedacted || request.providerPatchRedacted ? 'metadata-only-redacted' : 'metadata-only',
    deniedReasons: deniedReasons.join('|'),
    riskFlags: auditProof.riskFlags.join('|'),
    statusAdded: statusCounters.added,
    statusModified: statusCounters.modified,
    statusDeleted: statusCounters.deleted,
    statusRenamed: statusCounters.renamed,
    churnTiny: churn.buckets.tiny,
    churnSmall: churn.buckets.small,
    churnMedium: churn.buckets.medium,
    churnLarge: churn.buckets.large,
    auditRef: auditProof.diffFingerprint
  };
  const exportManifest = buildAnalyticsExportManifest(
    request,
    exportRow,
    request.analyticsHistory,
    currentSnapshot,
    validationSummary,
    now
  );

  return {
    counters: {
      files: {
        received: request.rawFileCount,
        evaluated: request.files.length,
        visible: summary.filesChanged,
        denied: boundary.deniedFiles.length,
        truncated: request.truncated ? request.rawFileCount - request.files.length : 0,
        binary: summary.binaryFiles,
        byStatus: statusCounters,
        statusDelta
      },
      lines: {
        additions: summary.additions,
        deletions: summary.deletions,
        totalChanged: lineDelta
      },
      churn,
      workflow: {
        pendingCommands: request.persistedState.pendingCommands.length,
        duplicateCommands: request.persistedState.pendingCommands.filter((command) => command.duplicate).length,
        validationErrors: validationSummary.errors.length,
        warnings: validationSummary.warnings.length,
        riskFlags: auditProof.riskFlags.length,
        healthFindings: operationalHealth.findings.length
      }
    },
    trend: {
      hasPrevious: Boolean(previous),
      previousSnapshotId: previous?.snapshotId || '',
      filesChangedDelta: previous ? summary.filesChanged - previous.filesChanged : 0,
      lineDeltaChange: previous ? lineDelta - previousLineDelta : 0,
      deniedFilesDelta: previous ? boundary.deniedFiles.length - previous.deniedFiles : 0,
      statusDelta,
      newRiskFlags: previous ? auditProof.riskFlags.filter((flag) => !previous.riskFlags.includes(flag)) : auditProof.riskFlags
    },
    history,
    currentSnapshot,
    timeline,
    reportingState: {
      exportReady: exportManifest.ready && request.persistedState.status !== 'recovering',
      exportSchema: 'git-diff-analytics-export.v1',
      retentionWindow: MAX_ANALYTICS_HISTORY,
      routeState: validationSummary.valid && !operationalHealth.failureState.blocked ? 'analytics-report-ready' : 'analytics-report-blocked',
      nextSnapshotWrite: {
        key: `${request.persistedState.checkpointId}:analytics`,
        append: currentSnapshot,
        replaceOldest: history.length >= MAX_ANALYTICS_HISTORY
      },
      exportManifest
    },
    exportSummary: {
      format: 'jsonl-row',
      schema: Object.keys(exportRow),
      row: exportRow,
      manifest: exportManifest
    }
  };
}

function buildAuditProof(request, summary, boundary, now) {
  const riskFlags = [];
  if (summary.filesChanged === 0) riskFlags.push('empty-diff');
  if (summary.filesChanged > 50) riskFlags.push('large-file-count');
  if (summary.additions + summary.deletions > 1000) riskFlags.push('large-line-count');
  if (summary.binaryFiles > 0) riskFlags.push('binary-review-required');
  if (request.truncated) riskFlags.push('file-list-truncated');
  if (boundary.deniedFiles.length > 0) riskFlags.push('workspace-boundary-denials');
  if (boundary.patchRedacted) riskFlags.push('patch-redacted-by-role');
  if (request.providerPatchRedacted) riskFlags.push('patch-redacted-by-provider');
  if (request.providerContract.missingCapabilities.length > 0) riskFlags.push('provider-capability-gap');
  if (request.providerContract.sync.stale) riskFlags.push('provider-sync-stale');
  if (request.providerContract.serviceContract.readinessState === 'blocked') riskFlags.push('provider-service-contract-blocked');
  if (request.providerContract.serviceContract.syncSla.missingFields.length > 0) riskFlags.push('provider-sync-metadata-incomplete');
  if (!request.workspaceAccess.allowed) riskFlags.push('workspace-access-denied');
  if (!request.workspaceAccess.explicitContract) riskFlags.push('workspace-access-implicit-scope');
  if (!request.lifecycle.enabled) riskFlags.push('lifecycle-disabled');
  if (request.lifecycle.mode === 'paused') riskFlags.push('lifecycle-paused');
  if (request.lifecycle.validationErrors.length > 0) riskFlags.push('lifecycle-settings-invalid');
  if (request.lifecycle.commandPolicy.blockedCommands.length > 0) riskFlags.push('lifecycle-command-blocked');
  if (request.lifecycle.commandPolicy.deferredCommands.length > 0) riskFlags.push('lifecycle-command-deferred');
  if (request.clientRuntime.validationErrors.length > 0) riskFlags.push('client-runtime-state-invalid');
  if (request.clientRuntime.draftDirty) riskFlags.push('client-review-draft-dirty');
  if (request.persistedState.status === 'recovering') riskFlags.push('restart-recovery-required');
  if (!request.persistedState.restartSafe) riskFlags.push('persisted-state-not-restart-safe');
  if (request.persistedState.pendingCommands.some((command) => command.duplicate)) riskFlags.push('idempotent-command-replay');

  return {
    proofType: 'hosted-kernel-git-diff-contract',
    generatedAt: now,
    requestId: request.requestId,
    clientId: request.clientId,
    actorId: request.actor.actorId,
    actorRole: request.actor.role,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    workspaceRoot: request.workspaceRoot,
    refs: {
      base: request.baseRef,
      head: request.headRef,
      branch: request.branch
    },
    provider: {
      serviceId: request.providerContract.serviceId,
      contractVersion: request.providerContract.contractVersion,
      grantedCapabilities: request.providerContract.grantedCapabilities,
      missingCapabilities: request.providerContract.missingCapabilities,
      sync: request.providerContract.sync,
      operational: request.providerContract.operational,
      failurePlan: request.providerContract.failurePlan,
      serviceContract: request.providerContract.serviceContract
    },
    diffFingerprint: [
      request.workspaceId,
      request.tenantId,
      request.actor.role,
      request.baseRef,
      request.headRef,
      summary.filesChanged,
      summary.additions,
      summary.deletions,
      summary.binaryFiles,
      boundary.deniedFiles.length
    ].join(':'),
    riskFlags,
    boundary: {
      deniedCount: boundary.deniedFiles.length,
      patchRedacted: boundary.patchRedacted,
      access: request.workspaceAccess,
      deniedPaths: boundary.deniedFiles.map((file) => ({
        path: file.path,
        reasons: file.reasons
      }))
    },
    lifecycle: {
      enabled: request.lifecycle.enabled,
      mode: request.lifecycle.mode,
      commands: request.lifecycle.commands,
      commandPolicy: request.lifecycle.commandPolicy,
      scheduleEnabled: request.lifecycle.schedule.enabled,
      validationErrors: request.lifecycle.validationErrors
    },
    persistedState: {
      checkpointId: request.persistedState.checkpointId,
      version: request.persistedState.version,
      status: request.persistedState.status,
      restartSafe: request.persistedState.restartSafe,
      recoveryReasons: request.persistedState.recoveryReasons,
      replayedCommands: request.persistedState.replayedCommands,
      pendingCommandEffects: request.persistedState.pendingCommands.map((command) => ({
        commandId: command.commandId,
        command: command.command,
        effect: command.effect,
        resultingStatus: command.resultingStatus,
        userVisibleState: command.userVisibleState
      }))
    },
    clientRuntime: {
      activeRoute: request.clientRuntime.activeRoute,
      handoffIntent: request.clientRuntime.handoffIntent,
      selectedPathCount: request.clientRuntime.selectedPaths.length,
      draftDirty: request.clientRuntime.draftDirty,
      resumeToken: request.clientRuntime.resumeToken,
      validationErrors: request.clientRuntime.validationErrors
    }
  };
}

function resolveLifecycleNextAction(request, summary, boundary, operationalHealth) {
  const lifecycle = request.lifecycle;
  const replayedCommand = request.persistedState.pendingCommands.find((command) => command.duplicate);
  if (replayedCommand) {
    return {
      state: 'command-already-applied',
      command: 'return-to-workspace',
      label: 'Return to workspace',
      route: 'client-runtime/workspace',
      reason: `idempotent-${replayedCommand.command}`
    };
  }
  if (request.persistedState.status === 'recovering') {
    return {
      state: 'restart-recovery-required',
      command: 'recover-persisted-git-diff-state',
      label: 'Recover diff state',
      route: 'syscall-layer/git-diff/recovery',
      reason: request.persistedState.recoveryReasons[0] || 'persisted-state-recovery'
    };
  }
  if (request.clientRuntime.validationErrors.length > 0) {
    return {
      state: 'client-runtime-reconciliation-required',
      command: 'reconcile-client-runtime',
      label: 'Reconcile client review state',
      route: 'client-runtime/review-panel/state',
      reason: request.clientRuntime.validationErrors[0]
    };
  }
  if (request.clientRuntime.draftDirty && request.clientRuntime.handoffIntent === 'open-review') {
    return {
      state: 'client-review-draft-save-required',
      command: 'save-review-draft',
      label: 'Save review draft',
      route: 'client-runtime/review-panel/draft',
      reason: 'dirty-review-draft'
    };
  }
  if (request.providerContract.missingCapabilities.length > 0) {
    return {
      state: 'provider-capability-upgrade-required',
      command: 'negotiate-provider-capabilities',
      label: 'Negotiate provider capabilities',
      route: request.providerContract.externalHandoff.url ? 'external/provider-review' : 'syscall-layer/provider-contracts',
      reason: request.providerContract.missingCapabilities[0]
    };
  }
  if (request.providerContract.operational.healthState === 'auth-required') {
    return {
      state: 'provider-auth-required',
      command: 'reconnect-provider',
      label: 'Reconnect git provider',
      route: 'syscall-layer/provider-contracts/auth',
      reason: 'provider-auth-required'
    };
  }
  if (request.providerContract.operational.circuitBreaker.open) {
    return {
      state: 'provider-circuit-open',
      command: operationalHealth.retryPolicy.retryable ? 'refresh' : 'open-provider-health',
      label: operationalHealth.retryPolicy.retryable ? 'Retry after provider reset' : 'Open provider health',
      route: 'syscall-layer/git-diff/provider-health',
      reason: 'provider-circuit-open'
    };
  }
  if (
    request.providerContract.operational.healthState === 'unavailable'
    && !request.providerContract.sync.cursor
  ) {
    return {
      state: 'provider-unavailable',
      command: 'refresh',
      label: 'Retry provider refresh',
      route: 'syscall-layer/git-diff/provider-health',
      reason: 'provider-unavailable-no-checkpoint'
    };
  }
  if (request.providerContract.sync.stale) {
    return {
      state: 'provider-sync-required',
      command: 'refresh-provider-sync',
      label: 'Refresh provider sync',
      route: 'syscall-layer/git-diff',
      reason: 'provider-sync-stale'
    };
  }
  if (!lifecycle.enabled) {
    return {
      state: 'disabled',
      command: 'enable',
      label: 'Enable diff lifecycle',
      route: 'settings/lifecycle-controls',
      reason: 'lifecycle-disabled'
    };
  }
  if (lifecycle.validationErrors.length > 0) {
    return {
      state: 'settings-invalid',
      command: 'open-settings',
      label: 'Fix lifecycle settings',
      route: 'settings/lifecycle-controls',
      reason: lifecycle.validationErrors[0]
    };
  }
  if (lifecycle.commandPolicy.state === 'blocked') {
    return {
      state: 'lifecycle-command-blocked',
      command: lifecycle.commandPolicy.nextAction.command || 'open-settings',
      label: 'Resolve lifecycle command',
      route: lifecycle.commandPolicy.nextAction.route || 'settings/lifecycle-controls',
      reason: lifecycle.commandPolicy.nextAction.reason || 'lifecycle-command-blocked'
    };
  }
  if (lifecycle.commandPolicy.state === 'deferred') {
    return {
      state: 'lifecycle-command-deferred',
      command: lifecycle.commandPolicy.nextAction.command || 'resume',
      label: 'Resume lifecycle command',
      route: lifecycle.commandPolicy.nextAction.route || 'settings/lifecycle-controls',
      reason: lifecycle.commandPolicy.nextAction.reason || 'lifecycle-command-deferred'
    };
  }
  if (lifecycle.mode === 'paused') {
    return {
      state: 'paused',
      command: 'resume',
      label: 'Resume diff lifecycle',
      route: 'settings/lifecycle-controls',
      reason: 'lifecycle-paused'
    };
  }
  if (boundary.deniedFiles.length > 0 && summary.filesChanged === 0) {
    return {
      state: 'boundary-review-required',
      command: 'open-boundary-audit',
      label: 'Open boundary audit',
      route: 'security/audit-boundary-review',
      reason: 'workspace-boundary-denials'
    };
  }
  if (operationalHealth.retryPolicy.retryable) {
    return {
      state: 'retry-scheduled',
      command: 'refresh',
      label: 'Refresh diff after backoff',
      route: 'syscall-layer/git-diff',
      reason: operationalHealth.retryPolicy.retryableCodes[0] || 'retryable-health-finding'
    };
  }
  if (lifecycle.schedule.enabled) {
    return {
      state: 'scheduled',
      command: 'clear-schedule',
      label: 'Manage scheduled refresh',
      route: 'settings/lifecycle-controls',
      reason: lifecycle.schedule.nextRunAt ? 'next-refresh-scheduled' : 'interval-refresh-enabled'
    };
  }

  return {
    state: summary.filesChanged === 0 ? 'idle' : 'review-ready',
    command: summary.filesChanged === 0 ? 'refresh' : 'open-review',
    label: summary.filesChanged === 0 ? 'Refresh diff' : 'Open diff review',
    route: summary.filesChanged === 0 ? 'syscall-layer/git-diff' : 'client-runtime/review-panel',
    reason: summary.filesChanged === 0 ? 'empty-visible-diff' : 'visible-diff-ready'
  };
}

function buildWorkflowHandoff(request, summary, lanes, auditProof, boundary, operationalHealth) {
  const blocked = boundary.deniedFiles.length > 0 && summary.filesChanged === 0;
  const nextAction = resolveLifecycleNextAction(request, summary, boundary, operationalHealth);
  const selectedVisiblePaths = request.clientRuntime.selectedPaths
    .filter((path) => boundary.visibleFiles.some((file) => normalizePath(file.path) === path));
  const unavailableSelectedPaths = request.clientRuntime.selectedPaths
    .filter((path) => !selectedVisiblePaths.includes(path));
  return {
    handoffType: 'git-diff-review',
    nextSurface: nextAction.route || (blocked
      ? 'security/audit-boundary-review'
      : summary.filesChanged === 0 ? 'syscall-layer/noop' : 'client-runtime/review-panel'),
    userVisibleTitle: blocked
      ? 'Changes require workspace boundary review'
      : summary.filesChanged === 0
      ? 'No working tree changes detected'
      : `Review ${summary.filesChanged} changed file${summary.filesChanged === 1 ? '' : 's'}`,
    primaryAction: blocked
      ? 'open-boundary-audit'
      : summary.filesChanged === 0 ? 'return-to-workspace' : 'open-diff-review',
    secondaryAction: boundary.patchRedacted
      ? 'request-patch-permission'
      : request.providerPatchRedacted
        ? 'negotiate-provider-patch-capability'
      : boundary.includePatch ? 'show-patch-context' : 'request-patch-context',
    priorityPaths: lanes.highAttention.map((file) => file.path),
    auditRef: auditProof.diffFingerprint,
    deniedPathCount: boundary.deniedFiles.length,
    lifecycleMode: request.lifecycle.mode,
    lifecycleCommandPolicy: request.lifecycle.commandPolicy,
    providerServiceId: request.providerContract.serviceId,
    providerHandoff: request.providerContract.externalHandoff,
    workspaceAccess: {
      schema: request.workspaceAccess.schema,
      contractId: request.workspaceAccess.contractId,
      membershipState: request.workspaceAccess.membershipState,
      allowed: request.workspaceAccess.allowed,
      scopeKey: request.workspaceAccess.scopeKey,
      boundaryReasons: request.workspaceAccess.boundaryReasons,
      auditHandoff: request.workspaceAccess.auditHandoff
    },
    providerServiceContract: {
      schema: request.providerContract.serviceContract.schema,
      contractId: request.providerContract.serviceContract.contractId,
      readinessState: request.providerContract.serviceContract.readinessState,
      violations: request.providerContract.serviceContract.violations,
      syncSla: request.providerContract.serviceContract.syncSla,
      handoffRequirement: request.providerContract.serviceContract.handoffRequirement
    },
    syncCursor: request.providerContract.sync.cursor,
    persistedState: {
      checkpointId: request.persistedState.checkpointId,
      status: request.persistedState.status,
      restartSafe: request.persistedState.restartSafe,
      recoveryReasons: request.persistedState.recoveryReasons,
      pendingCommandCount: request.persistedState.pendingCommands.length,
      duplicateCommandCount: request.persistedState.pendingCommands.filter((command) => command.duplicate).length,
      replayedCommands: request.persistedState.replayedCommands,
      nextWrite: request.persistedState.nextWrite
    },
    clientRuntime: {
      activeRoute: request.clientRuntime.activeRoute,
      handoffIntent: request.clientRuntime.handoffIntent,
      focusMode: request.clientRuntime.focusMode,
      draftDirty: request.clientRuntime.draftDirty,
      resumeToken: request.clientRuntime.resumeToken,
      selectedVisiblePaths,
      unavailableSelectedPaths,
      stateReconciliationRequired: request.clientRuntime.validationErrors.length > 0
    },
    nextAction
  };
}

function healthFinding(code, severity, message, action, details = {}) {
  return {
    code,
    severity,
    message,
    action,
    details
  };
}

function collectHealthFindings(request, summary, boundary) {
  const findings = [];

  if (!request.lifecycle.enabled) {
    findings.push(healthFinding(
      'GIT_DIFF_LIFECYCLE_DISABLED',
      'fatal',
      'The git diff lifecycle is disabled for this workspace surface.',
      'Enable the git diff lifecycle before requesting diff refresh or review actions.',
      { mode: request.lifecycle.mode, commands: request.lifecycle.commands }
    ));
  }
  if (request.lifecycle.validationErrors.length > 0) {
    findings.push(healthFinding(
      'GIT_DIFF_LIFECYCLE_SETTINGS_INVALID',
      request.lifecycle.enabled ? 'error' : 'fatal',
      'Lifecycle settings failed hosted-kernel validation.',
      'Open lifecycle controls and correct invalid commands, schedule values, or mode settings.',
      {
        validationErrors: request.lifecycle.validationErrors,
        rejectedCommands: request.lifecycle.rejectedCommands,
        schedule: request.lifecycle.schedule
      }
    ));
  }
  if (request.lifecycle.mode === 'paused') {
    findings.push(healthFinding(
      'GIT_DIFF_LIFECYCLE_PAUSED',
      'warning',
      'The git diff lifecycle is paused; refresh and review commands are deferred.',
      'Resume the lifecycle to continue automated diff review handoff.',
      { commands: request.lifecycle.commands, schedule: request.lifecycle.schedule }
    ));
  }
  if (request.lifecycle.commandPolicy.blockedCommands.length > 0) {
    findings.push(healthFinding(
      'GIT_DIFF_LIFECYCLE_COMMAND_BLOCKED',
      request.lifecycle.enabled ? 'error' : 'fatal',
      'One or more git diff lifecycle commands are blocked by the hosted-kernel lifecycle policy.',
      'Apply the policy next action before retrying blocked lifecycle commands.',
      {
        policyState: request.lifecycle.commandPolicy.state,
        blockedCommands: request.lifecycle.commandPolicy.blockedCommands,
        nextAction: request.lifecycle.commandPolicy.nextAction,
        decisions: request.lifecycle.commandPolicy.decisions
      }
    ));
  }
  if (request.lifecycle.commandPolicy.deferredCommands.length > 0) {
    findings.push(healthFinding(
      'GIT_DIFF_LIFECYCLE_COMMAND_DEFERRED',
      'warning',
      'One or more git diff lifecycle commands were deferred until lifecycle controls are resumed.',
      'Resume or update lifecycle controls before replaying deferred commands.',
      {
        policyState: request.lifecycle.commandPolicy.state,
        deferredCommands: request.lifecycle.commandPolicy.deferredCommands,
        nextAction: request.lifecycle.commandPolicy.nextAction,
        decisions: request.lifecycle.commandPolicy.decisions
      }
    ));
  }
  if (request.clientRuntime.validationErrors.length > 0) {
    findings.push(healthFinding(
      'GIT_DIFF_CLIENT_RUNTIME_STATE_INVALID',
      'error',
      'Client review state cannot be safely resumed for this git diff request.',
      'Reconcile the client runtime route, preview id, selection, or draft state before continuing the handoff.',
      {
        validationErrors: request.clientRuntime.validationErrors,
        activeRoute: request.clientRuntime.activeRoute,
        handoffIntent: request.clientRuntime.handoffIntent,
        selectedPaths: request.clientRuntime.selectedPaths
      }
    ));
  }
  if (request.clientRuntime.draftDirty && request.clientRuntime.handoffIntent === 'refresh-diff') {
    findings.push(healthFinding(
      'GIT_DIFF_CLIENT_DRAFT_REFRESH_CONFLICT',
      'warning',
      'A dirty client review draft would be overwritten by the requested diff refresh.',
      'Save or discard the current review draft before refreshing provider diff state.',
      { activeRoute: request.clientRuntime.activeRoute, resumeToken: request.clientRuntime.resumeToken }
    ));
  }
  if (request.persistedState.status === 'recovering') {
    findings.push(healthFinding(
      'GIT_DIFF_PERSISTED_STATE_RECOVERY_REQUIRED',
      'warning',
      'The previous git diff checkpoint was not restart-safe and must be recovered before continuing.',
      'Replay persisted checkpoint recovery and write a fresh git diff state checkpoint before opening review.',
      {
        checkpointId: request.persistedState.checkpointId,
        previousStatus: request.persistedState.previousStatus,
        recoveryReasons: request.persistedState.recoveryReasons,
        recoveryAttempt: request.persistedState.recoveryAttempt
      }
    ));
  }
  if (request.persistedState.pendingCommands.some((command) => command.duplicate)) {
    findings.push(healthFinding(
      'GIT_DIFF_IDEMPOTENT_COMMAND_REPLAY',
      'info',
      'A git diff lifecycle command was already applied for this idempotency scope.',
      'Return the existing command result instead of applying the command a second time.',
      {
        checkpointId: request.persistedState.checkpointId,
        duplicateCommands: request.persistedState.pendingCommands
          .filter((command) => command.duplicate)
          .map((command) => ({
            commandId: command.commandId,
            command: command.command,
            effect: command.effect
          }))
      }
    ));
  }
  if (!request.actor.capabilities.includes('read-diff')) {
    findings.push(healthFinding(
      'GIT_DIFF_READ_PERMISSION_MISSING',
      'fatal',
      'The actor cannot read git diff metadata for this workspace.',
      'Switch to an actor role with git-diff:read-diff permission or request access from the workspace owner.',
      { actorRole: request.actor.role, actorId: request.actor.actorId }
    ));
  }
  if (!request.workspaceAccess.allowed) {
    findings.push(healthFinding(
      'GIT_DIFF_WORKSPACE_ACCESS_DENIED',
      'fatal',
      'The actor workspace access contract does not allow this tenant/workspace diff scope.',
      'Open a boundary audit review or request a workspace grant before reading diff metadata.',
      {
        contractId: request.workspaceAccess.contractId,
        membershipState: request.workspaceAccess.membershipState,
        scopeKey: request.workspaceAccess.scopeKey,
        reasons: request.workspaceAccess.boundaryReasons,
        requiredCapabilities: request.workspaceAccess.requiredCapabilities,
        missingCapabilities: request.workspaceAccess.missingCapabilities
      }
    ));
  }
  if (request.rawFileCount === 0) {
    findings.push(healthFinding(
      'GIT_DIFF_EMPTY_SOURCE',
      'info',
      'No changed files were supplied by the hosted-kernel diff provider.',
      'Refresh the workspace status before opening the diff review surface.',
      { baseRef: request.baseRef, headRef: request.headRef }
    ));
  }
  if (request.truncated) {
    findings.push(healthFinding(
      'GIT_DIFF_FILE_LIMIT_TRUNCATED',
      'warning',
      'The changed-file list was truncated before boundary evaluation.',
      'Narrow the diff by path or request a paginated follow-up for the remaining files.',
      { receivedFiles: request.rawFileCount, evaluatedFiles: request.files.length, maxFiles: request.maxFiles }
    ));
  }
  if (boundary.patchRedacted) {
    findings.push(healthFinding(
      'GIT_DIFF_PATCH_REDACTED',
      'warning',
      'Patch hunks were requested but redacted for the current actor role.',
      'Request git-diff:read-patch permission or continue with metadata-only review.',
      { actorRole: request.actor.role, includePatch: request.includePatch }
    ));
  }
  if (request.providerPatchRedacted) {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_PATCH_UNAVAILABLE',
      'warning',
      'Patch hunks were requested but the hosted git provider did not grant patch capability.',
      'Negotiate git provider patch support or continue with metadata-only review.',
      {
        serviceId: request.providerContract.serviceId,
        requestedCapabilities: request.providerContract.requestedCapabilities,
        missingCapabilities: request.providerContract.missingCapabilities
      }
    ));
  }
  if (request.providerContract.sync.stale) {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_SYNC_STALE',
      'warning',
      'Changed files were supplied without provider sync metadata.',
      'Refresh the provider sync cursor before external review handoff or audit export.',
      {
        serviceId: request.providerContract.serviceId,
        sync: request.providerContract.sync
      }
    ));
  }
  if (request.providerContract.operational.healthState === 'auth-required') {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_AUTH_REQUIRED',
      'fatal',
      'The hosted git provider requires authentication before diff metadata can be trusted.',
      'Reconnect the provider credential and retry the git diff request after authentication succeeds.',
      {
        serviceId: request.providerContract.serviceId,
        incidentId: request.providerContract.operational.incidentId,
        lastError: request.providerContract.operational.lastError,
        failurePlan: request.providerContract.failurePlan
      }
    ));
  }
  if (request.providerContract.operational.circuitBreaker.open) {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_CIRCUIT_OPEN',
      'error',
      'The hosted git provider circuit breaker is open for this workspace diff route.',
      'Wait for the provider circuit reset or route to external review while the kernel keeps metadata-only state.',
      {
        serviceId: request.providerContract.serviceId,
        circuitBreaker: request.providerContract.operational.circuitBreaker,
        retryAfterMs: request.providerContract.operational.retryAfterMs,
        failurePlan: request.providerContract.failurePlan
      }
    ));
  }
  if (request.providerContract.operational.healthState === 'rate-limited') {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_RATE_LIMITED',
      'warning',
      'The hosted git provider rate limited this diff request.',
      'Retry the refresh after the provider retry-after window or continue with the last checkpointed metadata.',
      {
        serviceId: request.providerContract.serviceId,
        retryAfterMs: request.providerContract.operational.retryAfterMs,
        failureCodes: request.providerContract.operational.failureCodes,
        failurePlan: request.providerContract.failurePlan
      }
    ));
  }
  if (request.providerContract.operational.healthState === 'unavailable') {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_UNAVAILABLE',
      request.providerContract.sync.cursor ? 'warning' : 'error',
      'The hosted git provider is unavailable for live diff refresh.',
      request.providerContract.sync.cursor
        ? 'Continue in checkpoint-backed degraded mode or retry provider refresh with backoff.'
        : 'Retry provider refresh with backoff before opening review because no sync cursor is available.',
      {
        serviceId: request.providerContract.serviceId,
        retryAfterMs: request.providerContract.operational.retryAfterMs,
        incidentId: request.providerContract.operational.incidentId,
        lastError: request.providerContract.operational.lastError,
        failurePlan: request.providerContract.failurePlan
      }
    ));
  }
  if (request.providerContract.serviceContract.readinessState !== 'fulfilled') {
    const contractSeverity = request.providerContract.serviceContract.readinessState === 'blocked'
      ? 'error'
      : 'warning';
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_SERVICE_CONTRACT_UNFULFILLED',
      contractSeverity,
      'The hosted git provider service contract is not fully satisfied for this diff request.',
      'Complete provider capability negotiation or refresh sync metadata before external handoff.',
      {
        serviceId: request.providerContract.serviceId,
        contractId: request.providerContract.serviceContract.contractId,
        readinessState: request.providerContract.serviceContract.readinessState,
        violations: request.providerContract.serviceContract.violations,
        syncSla: request.providerContract.serviceContract.syncSla,
        handoffRequirement: request.providerContract.serviceContract.handoffRequirement
      }
    ));
  }
  if (
    request.providerContract.operational.healthState === 'degraded'
    && request.providerContract.operational.failureCodes.length > 0
  ) {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_DEGRADED',
      'warning',
      'The hosted git provider reported degraded diff service health.',
      'Use checkpointed metadata for review and monitor provider recovery before requesting patch expansion.',
      {
        serviceId: request.providerContract.serviceId,
        failureCodes: request.providerContract.operational.failureCodes,
        lastError: request.providerContract.operational.lastError,
        failurePlan: request.providerContract.failurePlan
      }
    ));
  }
  if (request.providerContract.missingCapabilities.some((capability) => capability !== 'patch')) {
    findings.push(healthFinding(
      'GIT_DIFF_PROVIDER_CAPABILITY_GAP',
      'error',
      'The hosted git provider is missing required contract capabilities for this request.',
      'Route the request through provider capability negotiation before review handoff.',
      {
        serviceId: request.providerContract.serviceId,
        grantedCapabilities: request.providerContract.grantedCapabilities,
        missingCapabilities: request.providerContract.missingCapabilities
      }
    ));
  }
  if (boundary.deniedFiles.length > 0) {
    const deniedReasons = [...new Set(boundary.deniedFiles.flatMap((file) => file.reasons))].sort();
    findings.push(healthFinding(
      summary.filesChanged === 0 ? 'GIT_DIFF_ALL_FILES_DENIED' : 'GIT_DIFF_PARTIAL_BOUNDARY_DENIAL',
      summary.filesChanged === 0 ? 'fatal' : 'error',
      summary.filesChanged === 0
        ? 'Every changed file was blocked by workspace boundary policy.'
        : 'Some changed files were removed from the visible diff by workspace boundary policy.',
      summary.filesChanged === 0
        ? 'Open a boundary audit review before continuing with code review.'
        : 'Review the visible files and resolve denied paths through the boundary audit workflow.',
      { deniedCount: boundary.deniedFiles.length, deniedReasons }
    ));
  }
  if (summary.binaryFiles > 0 && !request.actor.capabilities.includes('review-binary')) {
    findings.push(healthFinding(
      'GIT_DIFF_BINARY_METADATA_ONLY',
      'warning',
      'Binary changes are visible only as metadata for this actor.',
      'Ask a maintainer or owner to review binary content when it affects the release.',
      { binaryFiles: summary.binaryFiles, actorRole: request.actor.role }
    ));
  }

  return findings.sort((left, right) => HEALTH_SEVERITY_RANK[right.severity] - HEALTH_SEVERITY_RANK[left.severity]);
}

function maxRetryAfterFromFindings(findings) {
  return findings.reduce((maxDelay, finding) => {
    const retryAfterMs = asFiniteNumber(asRecord(finding.details).retryAfterMs);
    return Math.max(maxDelay, retryAfterMs);
  }, 0);
}

function buildRetryPolicy(request, findings) {
  const blockingCodes = new Set(findings.filter((finding) => finding.severity === 'fatal').map((finding) => finding.code));
  const providerFailurePlan = request.providerContract.failurePlan;
  const providerRetryableCodes = findings
    .filter((finding) => [
      'GIT_DIFF_PROVIDER_RATE_LIMITED',
      'GIT_DIFF_PROVIDER_UNAVAILABLE',
      'GIT_DIFF_PROVIDER_CIRCUIT_OPEN'
    ].includes(finding.code))
    .map((finding) => finding.code);
  const retryableCodes = findings
    .filter((finding) => finding.code === 'GIT_DIFF_EMPTY_SOURCE' || finding.code === 'GIT_DIFF_FILE_LIMIT_TRUNCATED')
    .map((finding) => finding.code)
    .concat(providerRetryableCodes)
    .concat(providerFailurePlan.retryableCodes.map((code) => `PROVIDER:${code}`));
  const providerRetryRequested = providerRetryableCodes.length > 0 || providerFailurePlan.retryableCodes.length > 0;
  const retryable = retryableCodes.length > 0
    && (!providerRetryRequested || providerFailurePlan.retryable)
    && !blockingCodes.has('GIT_DIFF_READ_PERMISSION_MISSING')
    && !blockingCodes.has('GIT_DIFF_ALL_FILES_DENIED')
    && !blockingCodes.has('GIT_DIFF_WORKSPACE_ACCESS_DENIED')
    && !blockingCodes.has('GIT_DIFF_LIFECYCLE_DISABLED')
    && !blockingCodes.has('GIT_DIFF_LIFECYCLE_SETTINGS_INVALID')
    && !blockingCodes.has('GIT_DIFF_LIFECYCLE_COMMAND_BLOCKED')
    && !blockingCodes.has('GIT_DIFF_PROVIDER_AUTH_REQUIRED');
  const exponentialDelayMs = Math.min(RETRY_BASE_DELAY_MS * (2 ** request.retryAttempt), RETRY_MAX_DELAY_MS);
  const providerDelayMs = maxRetryAfterFromFindings(findings);
  const nextDelayMs = Math.min(Math.max(exponentialDelayMs, providerDelayMs), RETRY_MAX_DELAY_MS * 4);
  const providerCircuitOpen = providerRetryableCodes.includes('GIT_DIFF_PROVIDER_CIRCUIT_OPEN');

  return {
    retryable,
    retryAttempt: request.retryAttempt,
    nextDelayMs: retryable ? nextDelayMs : 0,
    maxDelayMs: providerDelayMs > RETRY_MAX_DELAY_MS ? RETRY_MAX_DELAY_MS * 4 : RETRY_MAX_DELAY_MS,
    strategy: retryable
      ? providerCircuitOpen
        ? 'provider-circuit-reset-then-exponential-backoff'
        : providerDelayMs > 0 ? 'provider-retry-after-then-jitter' : 'exponential-backoff-with-jitter'
      : 'manual-intervention-required',
    retryableCodes,
    stopConditions: retryable
      ? [
        'permission-denied',
        'workspace-boundary-blocked',
        'provider-auth-required',
        'provider-health-restored',
        'non-empty-diff-loaded'
      ]
      : ['operator-action-required'],
    providerBackoff: {
      healthState: request.providerContract.operational.healthState,
      retryAfterMs: providerDelayMs,
      circuitBreaker: request.providerContract.operational.circuitBreaker,
      incidentId: request.providerContract.operational.incidentId,
      failurePlanState: providerFailurePlan.state,
      failurePlanMode: providerFailurePlan.mode
    }
  };
}

function buildHealthRecoveryPlan(request, findings, retryPolicy) {
  const primary = findings.find((finding) => finding.severity === 'fatal' || finding.severity === 'error') || findings[0] || null;
  const providerFinding = findings.find((finding) => finding.code.startsWith('GIT_DIFF_PROVIDER_')) || null;
  return {
    planId: `${request.requestId}:health-recovery`,
    providerState: request.providerContract.operational.healthState,
    primaryCode: primary?.code || 'GIT_DIFF_HEALTHY',
    operatorAction: primary?.action || 'No operator action is required.',
    retryWindowMs: retryPolicy.nextDelayMs,
    retryCommand: retryPolicy.retryable ? 'refresh' : '',
    degradedFallback: providerFinding && request.providerContract.sync.cursor
      ? 'checkpoint-backed-metadata-review'
      : providerFinding ? 'wait-for-provider-health' : 'normal-review',
    providerFailurePlan: request.providerContract.failurePlan,
    proofInputs: {
      serviceId: request.providerContract.serviceId,
      contractId: request.providerContract.serviceContract.contractId,
      contractReadiness: request.providerContract.serviceContract.readinessState,
      incidentId: request.providerContract.operational.incidentId,
      failureCodes: request.providerContract.operational.failureCodes,
      checkpointId: request.persistedState.checkpointId
    }
  };
}

function resolveDegradedMode(request, boundary, recoveryPlan) {
  if (request.providerContract.failurePlan.state === 'degraded') {
    return request.providerContract.failurePlan.mode;
  }
  if (request.providerContract.operational.healthState === 'unavailable' && request.providerContract.sync.cursor) {
    return 'checkpoint-backed-provider-outage';
  }
  if (request.providerContract.operational.circuitBreaker.open) {
    return 'provider-circuit-open-metadata-only';
  }
  if (request.providerContract.operational.healthState === 'rate-limited') {
    return 'rate-limited-provider-backoff';
  }
  if (request.providerContract.operational.healthState === 'degraded' && recoveryPlan.degradedFallback !== 'normal-review') {
    return recoveryPlan.degradedFallback;
  }
  if (boundary.patchRedacted) {
    return 'metadata-only-diff';
  }
  if (boundary.deniedFiles.length > 0) {
    return 'partial-diff-visible';
  }
  if (request.truncated) {
    return 'truncated-diff-window';
  }

  return 'full-fidelity';
}

function buildOperationalHealth(request, summary, boundary) {
  const findings = collectHealthFindings(request, summary, boundary);
  const highestSeverity = findings[0]?.severity || 'info';
  const blocked = highestSeverity === 'fatal';
  const degraded = !blocked && findings.some((finding) => finding.severity === 'warning' || finding.severity === 'error');
  const retryPolicy = buildRetryPolicy(request, findings);
  const recoveryPlan = buildHealthRecoveryPlan(request, findings, retryPolicy);
  const degradedReasons = findings
    .filter((finding) => finding.severity === 'warning' || finding.severity === 'error')
    .map((finding) => finding.code);

  return {
    status: blocked ? 'blocked' : degraded ? 'degraded' : 'healthy',
    highestSeverity,
    failureState: {
      blocked,
      code: blocked ? findings[0].code : null,
      message: blocked ? findings[0].message : null
    },
    degradedMode: {
      active: degraded,
      mode: resolveDegradedMode(request, boundary, recoveryPlan),
      reasons: degradedReasons,
      providerState: request.providerContract.operational.healthState,
      fallback: recoveryPlan.degradedFallback
    },
    retryPolicy,
    recoveryPlan,
    actionableErrors: findings.filter((finding) => finding.severity === 'error' || finding.severity === 'fatal'),
    findings
  };
}

function buildValidationSummary(request, summary, boundary, operationalHealth, now) {
  const providerOperationallyReady = !request.providerContract.operational.circuitBreaker.open
    && request.providerContract.operational.healthState !== 'auth-required'
    && request.providerContract.serviceContract.readinessState !== 'blocked'
    && request.providerContract.failurePlan.state !== 'blocked'
    && (
      request.providerContract.operational.healthState !== 'unavailable'
      || Boolean(request.providerContract.sync.cursor)
    );
  const errors = operationalHealth.findings
    .filter((finding) => finding.severity === 'fatal' || finding.severity === 'error')
    .map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      action: finding.action
    }));
  const warnings = operationalHealth.findings
    .filter((finding) => finding.severity === 'warning')
    .map((finding) => ({
      code: finding.code,
      message: finding.message,
      action: finding.action
    }));
  const acceptanceErrors = request.previewAcceptance.missingAcknowledgements.map((item) => ({
    code: 'GIT_DIFF_ACCEPTANCE_ACK_MISSING',
    severity: 'error',
    message: `Required preview acknowledgement is missing: ${item}`,
    action: 'Acknowledge the preview requirement before accepting this diff handoff.'
  }));

  return {
    valid: errors.length === 0 && acceptanceErrors.length === 0,
    checkedAt: now,
    fileWindow: {
      received: request.rawFileCount,
      evaluated: request.files.length,
      visible: summary.filesChanged,
      denied: boundary.deniedFiles.length,
      truncated: request.truncated
    },
    providerReady: request.providerContract.missingCapabilities.length === 0
      && !request.providerContract.sync.stale
      && request.providerContract.serviceContract.ready
      && providerOperationallyReady,
    clientRuntimeReady: request.clientRuntime.validationErrors.length === 0,
    lifecycleReady: request.lifecycle.enabled
      && request.lifecycle.validationErrors.length === 0
      && request.lifecycle.mode !== 'paused'
      && request.lifecycle.commandPolicy.state !== 'blocked'
      && request.lifecycle.commandPolicy.state !== 'deferred',
    persistenceReady: request.persistedState.restartSafe || request.persistedState.status !== 'recovering',
    permissionReady: request.actor.capabilities.includes('read-diff')
      && request.workspaceAccess.allowed
      && boundary.deniedFiles.length === 0,
    acceptanceReady: !request.previewAcceptance.requireExplicitAcceptance
      || (request.previewAcceptance.actorAccepted && request.previewAcceptance.missingAcknowledgements.length === 0),
    errors: [...errors, ...acceptanceErrors],
    warnings,
    ignoredWarningsAllowed: warnings.every((warning) => warning.code === 'GIT_DIFF_PATCH_REDACTED' || warning.code === 'GIT_DIFF_BINARY_METADATA_ONLY')
  };
}

function buildPreviewContract(request, summary, lanes, boundary, auditProof, operationalHealth) {
  const deniedReasons = [...new Set(boundary.deniedFiles.flatMap((file) => file.reasons))].sort();
  const blocked = operationalHealth.failureState.blocked || !request.actor.capabilities.includes('read-diff');
  const selectedFocusPaths = request.clientRuntime.selectedPaths
    .filter((path) => boundary.visibleFiles.some((file) => normalizePath(file.path) === path));

  return {
    previewId: request.previewAcceptance.previewId,
    title: summary.filesChanged === 0
      ? 'No visible diff changes'
      : `${summary.filesChanged} file${summary.filesChanged === 1 ? '' : 's'} ready for preview`,
    state: blocked
      ? 'blocked'
      : boundary.deniedFiles.length > 0
        ? 'partial'
        : request.truncated ? 'truncated' : 'complete',
    visibility: {
      visibleFileCount: summary.filesChanged,
      deniedFileCount: boundary.deniedFiles.length,
      deniedReasons,
      patchMode: boundary.includePatch ? 'patch-visible' : boundary.patchRedacted || request.providerPatchRedacted ? 'metadata-only-redacted' : 'metadata-only',
      workspaceAccessState: request.workspaceAccess.membershipState,
      workspaceAccessReasons: request.workspaceAccess.boundaryReasons
    },
    totals: summary,
    focusPaths: lanes.highAttention.map((file) => ({
      path: file.path,
      status: file.status,
      reviewWeight: file.reviewWeight,
      reason: file.binary ? 'binary-change' : file.reviewWeight >= 80 ? 'large-change' : 'review-priority'
    })),
    quickScanPaths: lanes.quickScan.map((file) => file.path),
    clientFocus: {
      mode: request.clientRuntime.focusMode,
      selectedPaths: selectedFocusPaths,
      staleSelectionCount: request.clientRuntime.selectedPaths.length - selectedFocusPaths.length,
      resumeToken: request.clientRuntime.resumeToken
    },
    persistence: {
      checkpointId: request.persistedState.checkpointId,
      status: request.persistedState.status,
      restartSafe: request.persistedState.restartSafe,
      recoveryReasons: request.persistedState.recoveryReasons,
      replayedCommands: request.persistedState.replayedCommands,
      duplicateCommandCount: request.persistedState.pendingCommands.filter((command) => command.duplicate).length
    },
    auditRef: auditProof.diffFingerprint,
    proofType: auditProof.proofType,
    generatedAt: auditProof.generatedAt
  };
}

function buildAcceptanceContract(request, validationSummary, operationalHealth) {
  const acceptance = request.previewAcceptance;
  const canAccept = validationSummary.valid
    && validationSummary.persistenceReady
    && !operationalHealth.failureState.blocked
    && (!acceptance.requireExplicitAcceptance || acceptance.missingAcknowledgements.length === 0);
  const requiredNextAcknowledgements = acceptance.requireExplicitAcceptance
    ? acceptance.missingAcknowledgements
    : [];

  return {
    required: acceptance.requireExplicitAcceptance,
    accepted: acceptance.actorAccepted && canAccept,
    action: acceptance.action || 'pending',
    decisionAt: acceptance.decisionAt,
    actorId: request.actor.actorId,
    acceptedByRole: request.actor.role,
    canAccept,
    blockers: [
      ...validationSummary.errors.map((error) => error.code),
      ...requiredNextAcknowledgements.map((item) => `ACK:${item}`)
    ],
    acknowledgements: {
      required: acceptance.requiredAcknowledgements,
      acknowledged: acceptance.acknowledgedItems,
      missing: acceptance.missingAcknowledgements
    },
    notes: acceptance.notes,
    receipt: canAccept && acceptance.actorAccepted
      ? `${request.requestId}:${acceptance.previewId}:${request.actor.actorId}`
      : ''
  };
}

function buildExplainableNextSteps(workflowHandoff, previewContract, acceptanceContract, validationSummary) {
  const steps = [];
  if (validationSummary.errors.length > 0) {
    steps.push({
      id: 'resolve-validation-errors',
      label: 'Resolve validation blockers',
      route: 'syscall-layer/git-diff/validation',
      reason: validationSummary.errors[0].code,
      required: true
    });
  }
  if (previewContract.visibility.deniedFileCount > 0) {
    steps.push({
      id: 'review-boundary-denials',
      label: 'Review boundary denials',
      route: 'security/audit-boundary-review',
      reason: previewContract.visibility.deniedReasons[0] || 'workspace-boundary-denials',
      required: validationSummary.permissionReady === false
    });
  }
  if (!acceptanceContract.accepted && acceptanceContract.required) {
    steps.push({
      id: 'capture-preview-acceptance',
      label: 'Capture preview acceptance',
      route: 'client-runtime/review-panel/acceptance',
      reason: acceptanceContract.blockers[0] || 'acceptance-required',
      required: true
    });
  }
  steps.push({
    id: workflowHandoff.nextAction.command,
    label: workflowHandoff.nextAction.label,
    route: workflowHandoff.nextAction.route,
    reason: workflowHandoff.nextAction.reason,
    required: workflowHandoff.nextAction.state !== 'review-ready' && workflowHandoff.nextAction.state !== 'idle'
  });

  return {
    recommended: steps[0],
    steps,
    terminalState: acceptanceContract.accepted
      ? 'accepted-for-review'
      : validationSummary.valid && validationSummary.persistenceReady ? workflowHandoff.nextAction.state : 'validation-blocked'
  };
}

function readinessGate(id, label, ready, route, blockingCodes, nextCommand, explanation) {
  return {
    id,
    label,
    ready,
    severity: ready ? 'ready' : 'blocked',
    route,
    blockingCodes,
    nextCommand,
    explanation
  };
}

function buildUserVisibleReadinessContract(
  request,
  workflowHandoff,
  previewContract,
  acceptanceContract,
  validationSummary,
  operationalHealth
) {
  const providerBlockers = validationSummary.errors
    .filter((error) => error.code.startsWith('GIT_DIFF_PROVIDER_'))
    .map((error) => error.code);
  const lifecycleBlockers = validationSummary.errors
    .filter((error) => error.code.startsWith('GIT_DIFF_LIFECYCLE_'))
    .map((error) => error.code);
  const clientBlockers = validationSummary.errors
    .filter((error) => error.code.startsWith('GIT_DIFF_CLIENT_'))
    .map((error) => error.code);
  const permissionBlockers = validationSummary.errors
    .filter((error) => error.code.includes('PERMISSION') || error.code.includes('DENIED'))
    .map((error) => error.code);
  const acceptanceBlockers = acceptanceContract.blockers.filter((code) => code.startsWith('ACK:'));
  const persistenceBlockers = request.persistedState.status === 'recovering'
    ? ['GIT_DIFF_PERSISTED_STATE_RECOVERY_REQUIRED']
    : [];
  const gates = [
    readinessGate(
      'provider',
      'Provider',
      validationSummary.providerReady,
      request.providerContract.externalHandoff.url ? 'external/provider-review' : 'syscall-layer/git-diff/provider-health',
      providerBlockers.length > 0 ? providerBlockers : request.providerContract.serviceContract.violations,
      request.providerContract.failurePlan.nextAction.command,
      validationSummary.providerReady
        ? 'Hosted git provider contract and sync metadata are ready.'
        : 'Hosted git provider requires capability, sync, auth, or health resolution.'
    ),
    readinessGate(
      'lifecycle',
      'Lifecycle',
      validationSummary.lifecycleReady,
      'settings/lifecycle-controls',
      lifecycleBlockers.length > 0 ? lifecycleBlockers : request.lifecycle.validationErrors,
      request.lifecycle.enabled ? 'resume' : 'enable',
      validationSummary.lifecycleReady
        ? 'Diff lifecycle controls allow review handoff.'
        : 'Lifecycle controls are disabled, paused, or invalid for this request.'
    ),
    readinessGate(
      'persistence',
      'Persistence',
      validationSummary.persistenceReady,
      'syscall-layer/git-diff/recovery',
      persistenceBlockers,
      'recover-persisted-git-diff-state',
      validationSummary.persistenceReady
        ? 'Checkpoint state is safe for route resume and acceptance receipt writes.'
        : 'Checkpoint recovery must complete before the preview can be accepted.'
    ),
    readinessGate(
      'client-runtime',
      'Client State',
      validationSummary.clientRuntimeReady,
      'client-runtime/review-panel/state',
      clientBlockers.length > 0 ? clientBlockers : request.clientRuntime.validationErrors,
      'reconcile-client-runtime',
      validationSummary.clientRuntimeReady
        ? 'Client route, selection, and preview identity are consistent.'
        : 'Client route state must be reconciled before continuing review.'
    ),
    readinessGate(
      'permissions',
      'Permissions',
      validationSummary.permissionReady,
      'security/audit-boundary-review',
      permissionBlockers.length > 0 ? permissionBlockers : previewContract.visibility.deniedReasons,
      'open-boundary-audit',
      validationSummary.permissionReady
        ? 'Actor permissions and workspace boundaries allow the visible diff.'
        : 'Permissions or workspace boundary policy block at least part of this diff.'
    ),
    readinessGate(
      'acceptance',
      'Acceptance',
      validationSummary.acceptanceReady,
      'client-runtime/review-panel/acceptance',
      acceptanceBlockers,
      'accept-preview',
      validationSummary.acceptanceReady
        ? 'Preview acceptance requirements are satisfied.'
        : 'Required acknowledgements must be captured before accepting the preview.'
    )
  ];
  const blockingGates = gates.filter((gate) => !gate.ready);
  const firstError = validationSummary.errors[0] || null;
  const acceptancePayload = {
    action: 'accept-preview',
    previewId: previewContract.previewId,
    requestId: request.requestId,
    auditRef: previewContract.auditRef,
    actorId: request.actor.actorId,
    requiredAcknowledgements: acceptanceContract.acknowledgements.required,
    missingAcknowledgements: acceptanceContract.acknowledgements.missing
  };
  const state = acceptanceContract.accepted
    ? 'accepted'
    : blockingGates.length === 0
      ? 'ready-for-acceptance'
      : operationalHealth.failureState.blocked ? 'blocked' : 'needs-attention';

  return {
    schema: 'git-diff-user-readiness.v1',
    state,
    ready: blockingGates.length === 0,
    acceptEnabled: acceptanceContract.canAccept,
    headline: acceptanceContract.accepted
      ? 'Preview accepted'
      : blockingGates.length === 0
        ? 'Preview is ready to accept'
        : `${blockingGates.length} readiness gate${blockingGates.length === 1 ? '' : 's'} need attention`,
    primaryBlocker: blockingGates[0] || null,
    gates,
    validationDigest: {
      errorCount: validationSummary.errors.length,
      warningCount: validationSummary.warnings.length,
      firstErrorCode: firstError?.code || '',
      firstErrorAction: firstError?.action || '',
      ignoredWarningsAllowed: validationSummary.ignoredWarningsAllowed
    },
    routeHints: {
      current: workflowHandoff.nextSurface,
      recommended: blockingGates[0]?.route || workflowHandoff.nextAction.route,
      afterAcceptance: acceptanceContract.canAccept ? 'client-runtime/review-panel' : ''
    },
    acceptanceControl: {
      command: 'accept-preview',
      enabled: acceptanceContract.canAccept,
      disabledReason: acceptanceContract.canAccept
        ? ''
        : blockingGates[0]?.blockingCodes[0] || acceptanceContract.blockers[0] || 'acceptance-not-ready',
      payload: acceptancePayload
    }
  };
}

function buildClientHandoffEnvelope(
  request,
  workflowHandoff,
  previewContract,
  acceptanceContract,
  validationSummary,
  readinessContract,
  boundary,
  now
) {
  const routeParams = {
    surface: surfaceName,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    baseRef: request.baseRef,
    headRef: request.headRef,
    previewId: previewContract.previewId,
    auditRef: workflowHandoff.auditRef
  };
  const selectedVisiblePaths = workflowHandoff.clientRuntime.selectedVisiblePaths;
  const unavailableSelectedPaths = workflowHandoff.clientRuntime.unavailableSelectedPaths;
  const visiblePathSet = new Set(boundary.visibleFiles.map((file) => normalizePath(file.path)));
  const focusPathSet = new Set([
    ...selectedVisiblePaths,
    ...workflowHandoff.priorityPaths.map((path) => normalizePath(path))
  ]);
  const focusQueue = boundary.visibleFiles
    .filter((file) => focusPathSet.has(normalizePath(file.path)) || file.reviewWeight >= 80 || file.binary)
    .map((file) => ({
      path: file.path,
      status: file.status,
      binary: file.binary,
      reviewWeight: file.reviewWeight,
      selected: selectedVisiblePaths.includes(normalizePath(file.path)),
      reason: selectedVisiblePaths.includes(normalizePath(file.path))
        ? 'client-selected'
        : file.binary ? 'binary-review' : file.reviewWeight >= 80 ? 'high-attention' : 'priority-lane'
    }));
  const routeState = validationSummary.clientRuntimeReady
    ? workflowHandoff.nextSurface
    : 'client-runtime/review-panel/state';
  const handoffState = acceptanceContract.accepted
    ? 'accepted'
    : validationSummary.valid && validationSummary.persistenceReady
      ? workflowHandoff.nextAction.state
      : 'blocked';
  const statePatch = {
    schema: 'git-diff-client-runtime-state-patch.v1',
    applyMode: validationSummary.clientRuntimeReady ? 'merge' : 'reconcile-before-merge',
    route: {
      name: routeState,
      surface: surfaceName,
      params: routeParams
    },
    reviewPanel: {
      previewId: previewContract.previewId,
      auditRef: workflowHandoff.auditRef,
      focusMode: request.clientRuntime.focusMode,
      selectedPaths: selectedVisiblePaths,
      unavailableSelectedPaths,
      focusQueue,
      patchMode: previewContract.visibility.patchMode,
      draftDirty: request.clientRuntime.draftDirty,
      resumeToken: request.clientRuntime.resumeToken,
      readinessBanner: {
        schema: readinessContract.schema,
        state: readinessContract.state,
        headline: readinessContract.headline,
        primaryBlocker: readinessContract.primaryBlocker,
        validationDigest: readinessContract.validationDigest
      },
      acceptanceControl: readinessContract.acceptanceControl
    },
    lifecycleControls: {
      mode: request.lifecycle.mode,
      enabled: request.lifecycle.enabled,
      schedule: request.lifecycle.schedule,
      commandPolicy: request.lifecycle.commandPolicy,
      pendingCommands: request.persistedState.pendingCommands.map((command) => ({
        commandId: command.commandId,
        command: command.command,
        effect: command.effect,
        resultingStatus: command.resultingStatus,
        duplicate: command.duplicate
      }))
    },
    providerSync: {
      serviceId: request.providerContract.serviceId,
      cursor: request.providerContract.sync.cursor,
      sequence: request.providerContract.sync.sequence,
      source: request.providerContract.sync.source,
      serviceContract: {
        contractId: request.providerContract.serviceContract.contractId,
        readinessState: request.providerContract.serviceContract.readinessState,
        syncSla: request.providerContract.serviceContract.syncSla,
        handoffRequirement: request.providerContract.serviceContract.handoffRequirement
      },
      failurePlan: request.providerContract.failurePlan
    },
    persistence: {
      checkpointId: request.persistedState.checkpointId,
      status: request.persistedState.nextWrite.status,
      nextWrite: request.persistedState.nextWrite
    }
  };

  return {
    envelopeType: 'hosted-kernel-client-handoff',
    schema: 'git-diff-client-handoff.v1',
    generatedAt: now,
    handoffId: `${request.requestId}:${previewContract.previewId}:${request.clientId}`,
    handoffState,
    route: routeState,
    routeParams,
    intent: request.clientRuntime.handoffIntent || workflowHandoff.nextAction.command,
    command: workflowHandoff.nextAction.command,
    label: workflowHandoff.nextAction.label,
    reason: workflowHandoff.nextAction.reason,
    resumeToken: request.clientRuntime.resumeToken,
    selectedPathReconciliation: {
      visible: selectedVisiblePaths,
      unavailable: unavailableSelectedPaths,
      droppedByBoundary: unavailableSelectedPaths.filter((path) => !visiblePathSet.has(path)),
      requiresUserAttention: unavailableSelectedPaths.length > 0
    },
    statePatch,
    acceptanceReceipt: acceptanceContract.receipt,
    validation: {
      ready: validationSummary.valid,
      errors: validationSummary.errors.map((error) => error.code),
      warnings: validationSummary.warnings.map((warning) => warning.code),
      readinessGates: readinessContract.gates.map((gate) => ({
        id: gate.id,
        ready: gate.ready,
        blockingCodes: gate.blockingCodes
      }))
    },
    readiness: readinessContract,
    audit: {
      proofType: previewContract.proofType,
      auditRef: workflowHandoff.auditRef,
      deniedPathCount: workflowHandoff.deniedPathCount
    }
  };
}

function isoAfterMs(now, delayMs) {
  const baseTime = Date.parse(now);
  const safeBaseTime = Number.isNaN(baseTime) ? Date.now() : baseTime;
  return new Date(safeBaseTime + Math.floor(asFiniteNumber(delayMs))).toISOString();
}

function buildKernelErrorTicket(error, index, request, retryPolicy, workflowHandoff) {
  const retryable = retryPolicy.retryableCodes.includes(error.code);
  const providerScoped = error.code.startsWith('GIT_DIFF_PROVIDER_');
  const lifecycleScoped = error.code.startsWith('GIT_DIFF_LIFECYCLE_');
  const clientScoped = error.code.startsWith('GIT_DIFF_CLIENT_');
  const owner = providerScoped
    ? 'provider-connector'
    : lifecycleScoped
      ? 'workspace-settings'
      : clientScoped ? 'client-runtime' : 'hosted-kernel';
  const route = providerScoped
    ? 'syscall-layer/git-diff/provider-health'
    : lifecycleScoped
      ? 'settings/lifecycle-controls'
      : clientScoped ? 'client-runtime/review-panel/state' : workflowHandoff.nextAction.route;

  return {
    ticketId: `${request.requestId}:health-error:${index + 1}`,
    code: error.code,
    severity: error.severity || 'warning',
    owner,
    route,
    message: error.message,
    action: error.action,
    retryable,
    command: retryable ? 'refresh' : workflowHandoff.nextAction.command,
    commandPayload: {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      checkpointId: request.persistedState.checkpointId,
      providerServiceId: request.providerContract.serviceId,
      retryAttempt: retryable ? request.retryAttempt + 1 : request.retryAttempt,
      idempotencyScope: `${request.tenantId}:${request.workspaceId}:${request.baseRef}:${request.headRef}`
    }
  };
}

function buildDegradedCheckpointWrite(request, validationSummary, operationalHealth, now) {
  const retryableProviderFailure = operationalHealth.retryPolicy.retryableCodes
    .some((code) => code.startsWith('GIT_DIFF_PROVIDER_'));
  const checkpointBacked = Boolean(request.providerContract.sync.cursor);
  const canWriteDegraded = operationalHealth.degradedMode.active
    && !operationalHealth.failureState.blocked
    && validationSummary.persistenceReady
    && (
      checkpointBacked
      || !retryableProviderFailure
      || request.providerContract.operational.healthState === 'rate-limited'
    );
  const writeMode = operationalHealth.failureState.blocked
    ? 'reject-before-checkpoint'
    : canWriteDegraded
      ? 'commit-degraded-checkpoint'
      : validationSummary.valid && validationSummary.persistenceReady
        ? 'commit-ready-checkpoint'
        : 'hold-checkpoint-for-validation';

  return {
    schema: 'git-diff-degraded-checkpoint-write.v1',
    mode: writeMode,
    allowed: writeMode === 'commit-degraded-checkpoint' || writeMode === 'commit-ready-checkpoint',
    reason: operationalHealth.failureState.blocked
      ? operationalHealth.failureState.code
      : canWriteDegraded
        ? operationalHealth.degradedMode.mode
        : validationSummary.errors[0]?.code || 'ready',
    checkpointId: request.persistedState.checkpointId,
    sourceCursor: request.providerContract.sync.cursor,
    generatedAt: now,
    writePatch: {
      status: canWriteDegraded ? 'recovering' : request.persistedState.nextWrite.status,
      cursor: request.providerContract.sync.cursor || request.persistedState.cursor,
      degradedMode: operationalHealth.degradedMode.mode,
      providerHealthState: request.providerContract.operational.healthState,
      providerIncidentId: request.providerContract.operational.incidentId,
      retryAfterMs: operationalHealth.retryPolicy.nextDelayMs,
      validationErrorCodes: validationSummary.errors.map((error) => error.code)
    },
    guards: {
      persistenceReady: validationSummary.persistenceReady,
      checkpointBacked,
      retryableProviderFailure,
      providerCircuitOpen: request.providerContract.operational.circuitBreaker.open,
      authRequired: request.providerContract.operational.healthState === 'auth-required'
    }
  };
}

function buildHostedKernelOperationEnvelope(
  request,
  workflowHandoff,
  validationSummary,
  operationalHealth,
  now
) {
  const retryPolicy = operationalHealth.retryPolicy;
  const retryLease = {
    leaseId: `${request.requestId}:retry:${request.retryAttempt + 1}`,
    eligible: retryPolicy.retryable,
    notBeforeAt: retryPolicy.retryable ? isoAfterMs(now, retryPolicy.nextDelayMs) : '',
    delayMs: retryPolicy.nextDelayMs,
    strategy: retryPolicy.strategy,
    command: retryPolicy.retryable ? 'refresh' : '',
    idempotencyKey: [
      request.tenantId,
      request.workspaceId,
      request.baseRef,
      request.headRef,
      'refresh',
      request.retryAttempt + 1
    ].join(':'),
    stopConditions: retryPolicy.stopConditions
  };
  const errorTickets = validationSummary.errors
    .map((error, index) => buildKernelErrorTicket(error, index, request, retryPolicy, workflowHandoff));
  const warningTickets = validationSummary.warnings
    .map((warning, index) => buildKernelErrorTicket(warning, index, request, retryPolicy, workflowHandoff));
  const degradedCheckpointWrite = buildDegradedCheckpointWrite(request, validationSummary, operationalHealth, now);
  const operationState = operationalHealth.failureState.blocked
    ? 'blocked'
    : retryPolicy.retryable
      ? 'retryable'
      : operationalHealth.degradedMode.active
        ? 'degraded'
        : validationSummary.valid ? 'ready' : 'validation-required';

  return {
    schema: 'hosted-kernel-git-diff-operation.v1',
    operationId: `${request.requestId}:kernel-operation`,
    generatedAt: now,
    state: operationState,
    actionable: operationState !== 'ready',
    nextCommand: retryPolicy.retryable ? 'refresh' : workflowHandoff.nextAction.command,
    retryLease,
    degradedCheckpointWrite,
    errorExport: {
      schema: 'git-diff-actionable-errors.v1',
      count: errorTickets.length,
      tickets: errorTickets,
      warningTickets,
      primaryTicket: errorTickets[0] || warningTickets[0] || null
    },
    routeDecision: {
      currentRoute: workflowHandoff.nextSurface,
      recommendedRoute: errorTickets[0]?.route || workflowHandoff.nextAction.route,
      degradedRoute: operationalHealth.degradedMode.active ? 'syscall-layer/git-diff/degraded-mode' : '',
      externalHandoffRequired: request.providerContract.serviceContract.handoffRequirement.required,
      externalHandoffTarget: request.providerContract.serviceContract.handoffRequirement.target
    },
    proof: {
      providerServiceId: request.providerContract.serviceId,
      contractId: request.providerContract.serviceContract.contractId,
      workspaceAccessContractId: request.workspaceAccess.contractId,
      workspaceAccessState: request.workspaceAccess.membershipState,
      checkpointId: request.persistedState.checkpointId,
      healthStatus: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode.mode,
      validationErrorCodes: validationSummary.errors.map((error) => error.code),
      retryableCodes: retryPolicy.retryableCodes,
      lifecycleCommandPolicy: request.lifecycle.commandPolicy,
      providerFailurePlan: request.providerContract.failurePlan
    }
  };
}

export function describeGitDiffSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const request = attachClientRuntime(normalizeRequest(input), input, now);
  const boundary = applyWorkspaceBoundaries(request);
  const summary = summarizeFiles(boundary.visibleFiles);
  const lanes = buildReviewLanes(boundary.visibleFiles);
  const auditProof = buildAuditProof(request, summary, boundary, now);
  const operationalHealth = buildOperationalHealth(request, summary, boundary);
  const workflowHandoff = buildWorkflowHandoff(request, summary, lanes, auditProof, boundary, operationalHealth);
  const validationSummary = buildValidationSummary(request, summary, boundary, operationalHealth, now);
  const analytics = buildAnalyticsReport(request, summary, boundary, auditProof, operationalHealth, validationSummary, now);
  const preview = buildPreviewContract(request, summary, lanes, boundary, auditProof, operationalHealth);
  const acceptance = buildAcceptanceContract(request, validationSummary, operationalHealth);
  const explainableNextSteps = buildExplainableNextSteps(workflowHandoff, preview, acceptance, validationSummary);
  const userReadiness = buildUserVisibleReadinessContract(
    request,
    workflowHandoff,
    preview,
    acceptance,
    validationSummary,
    operationalHealth
  );
  const clientHandoff = buildClientHandoffEnvelope(
    request,
    workflowHandoff,
    preview,
    acceptance,
    validationSummary,
    userReadiness,
    boundary,
    now
  );
  const hostedKernelOperation = buildHostedKernelOperationEnvelope(
    request,
    workflowHandoff,
    validationSummary,
    operationalHealth,
    now
  );

  return {
    ok: boundary.deniedFiles.length === 0
      && !operationalHealth.failureState.blocked
      && validationSummary.valid
      && validationSummary.persistenceReady,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel git diff syscall runtime contract',
    request: {
      requestId: request.requestId,
      clientId: request.clientId,
      tenantId: request.tenantId,
      actorId: request.actor.actorId,
      actorRole: request.actor.role,
      workspaceId: request.workspaceId,
      workspaceRoot: request.workspaceRoot,
      workspaceAccess: request.workspaceAccess,
      intent: request.intent,
      branch: request.branch,
      baseRef: request.baseRef,
      headRef: request.headRef,
      includePatch: boundary.includePatch,
      patchRedacted: boundary.patchRedacted,
      retryAttempt: request.retryAttempt,
      providerContract: request.providerContract,
      lifecycle: request.lifecycle,
      persistedState: request.persistedState,
      clientRuntime: request.clientRuntime
    },
    diff: {
      summary,
      files: boundary.visibleFiles,
      truncated: request.truncated,
      reviewLanes: lanes
    },
    analytics,
    preview,
    acceptance,
    readiness: {
      state: acceptance.accepted
        ? 'accepted'
        : request.persistedState.status === 'recovering'
          ? 'recovering'
          : validationSummary.valid && validationSummary.persistenceReady && !operationalHealth.failureState.blocked
          ? 'ready-for-acceptance'
          : 'blocked',
      validationReady: validationSummary.valid,
      providerReady: validationSummary.providerReady,
      lifecycleReady: validationSummary.lifecycleReady,
      persistenceReady: validationSummary.persistenceReady,
      clientRuntimeReady: validationSummary.clientRuntimeReady,
      permissionReady: validationSummary.permissionReady,
      acceptanceReady: validationSummary.acceptanceReady,
      nextStep: explainableNextSteps.recommended,
      userVisible: userReadiness
    },
    validationSummary,
    explainableNextSteps,
    boundary: {
      allowed: boundary.deniedFiles.length === 0,
      accessAllowed: boundary.access.allowed,
      accessContractId: boundary.access.contractId,
      accessState: boundary.access.membershipState,
      accessReasons: boundary.access.boundaryReasons,
      deniedFiles: boundary.deniedFiles.map((file) => ({
        path: file.path,
        reasons: file.reasons
      })),
      evaluatedFiles: boundary.boundaryDecisions.length
    },
    audit: auditProof,
    operationalHealth,
    hostedKernelOperation,
    workflowHandoff,
    clientHandoff,
    evidence: [
      ...request.evidence,
      {
        source: surfaceId,
        kind: 'runtime-contract',
        fingerprint: auditProof.diffFingerprint,
        riskFlags: auditProof.riskFlags,
        workspaceAccess: {
          contractId: request.workspaceAccess.contractId,
          membershipState: request.workspaceAccess.membershipState,
          allowed: request.workspaceAccess.allowed,
          scopeKey: request.workspaceAccess.scopeKey,
          auditHandoffRequired: request.workspaceAccess.auditHandoff.required
        }
      },
      {
        source: surfaceId,
        kind: 'operational-health',
        status: operationalHealth.status,
        highestSeverity: operationalHealth.highestSeverity,
        retryable: operationalHealth.retryPolicy.retryable,
        retryStrategy: operationalHealth.retryPolicy.strategy,
        recoveryPlan: operationalHealth.recoveryPlan,
        degradedMode: operationalHealth.degradedMode.mode,
        findingCodes: operationalHealth.findings.map((finding) => finding.code)
      },
      {
        source: surfaceId,
        kind: 'workspace-access-contract',
        schema: request.workspaceAccess.schema,
        contractId: request.workspaceAccess.contractId,
        membershipState: request.workspaceAccess.membershipState,
        actorId: request.workspaceAccess.actorId,
        actorRole: request.workspaceAccess.actorRole,
        tenantId: request.workspaceAccess.tenantId,
        workspaceId: request.workspaceAccess.workspaceId,
        scopeKey: request.workspaceAccess.scopeKey,
        explicitContract: request.workspaceAccess.explicitContract,
        allowed: request.workspaceAccess.allowed,
        allowedTenantIds: request.workspaceAccess.allowedTenantIds,
        allowedWorkspaceIds: request.workspaceAccess.allowedWorkspaceIds,
        deniedWorkspaceIds: request.workspaceAccess.deniedWorkspaceIds,
        requiredCapabilities: request.workspaceAccess.requiredCapabilities,
        missingCapabilities: request.workspaceAccess.missingCapabilities,
        boundaryReasons: request.workspaceAccess.boundaryReasons,
        auditHandoff: request.workspaceAccess.auditHandoff
      },
      {
        source: surfaceId,
        kind: 'hosted-kernel-operation',
        schema: hostedKernelOperation.schema,
        operationId: hostedKernelOperation.operationId,
        state: hostedKernelOperation.state,
        nextCommand: hostedKernelOperation.nextCommand,
        retryLease: hostedKernelOperation.retryLease,
        degradedCheckpointWrite: hostedKernelOperation.degradedCheckpointWrite,
        primaryErrorTicket: hostedKernelOperation.errorExport.primaryTicket,
        routeDecision: hostedKernelOperation.routeDecision,
        proof: hostedKernelOperation.proof
      },
      {
        source: surfaceId,
        kind: 'provider-contract',
        serviceId: request.providerContract.serviceId,
        contractVersion: request.providerContract.contractVersion,
        grantedCapabilities: request.providerContract.grantedCapabilities,
        missingCapabilities: request.providerContract.missingCapabilities,
        serviceContract: request.providerContract.serviceContract,
        sync: request.providerContract.sync,
        operational: request.providerContract.operational,
        externalHandoff: request.providerContract.externalHandoff
      },
      {
        source: surfaceId,
        kind: 'lifecycle-controls',
        mode: request.lifecycle.mode,
        enabled: request.lifecycle.enabled,
        commands: request.lifecycle.commands,
        commandPolicy: request.lifecycle.commandPolicy,
        nextAction: workflowHandoff.nextAction,
        validationErrors: request.lifecycle.validationErrors
      },
      {
        source: surfaceId,
        kind: 'persisted-state',
        checkpointId: request.persistedState.checkpointId,
        version: request.persistedState.version,
        status: request.persistedState.status,
        restartSafe: request.persistedState.restartSafe,
        recoveryReasons: request.persistedState.recoveryReasons,
        recoveryAttempt: request.persistedState.recoveryAttempt,
        replayedCommands: request.persistedState.replayedCommands,
        pendingCommands: request.persistedState.pendingCommands,
        nextWrite: request.persistedState.nextWrite
      },
      {
        source: surfaceId,
        kind: 'client-runtime-state',
        activeRoute: request.clientRuntime.activeRoute,
        handoffIntent: request.clientRuntime.handoffIntent,
        focusMode: request.clientRuntime.focusMode,
        draftDirty: request.clientRuntime.draftDirty,
        selectedPathCount: request.clientRuntime.selectedPaths.length,
        resumeToken: request.clientRuntime.resumeToken,
        validationErrors: request.clientRuntime.validationErrors,
        nextAction: workflowHandoff.nextAction
      },
      {
        source: surfaceId,
        kind: 'client-handoff-envelope',
        schema: clientHandoff.schema,
        handoffId: clientHandoff.handoffId,
        handoffState: clientHandoff.handoffState,
        route: clientHandoff.route,
        command: clientHandoff.command,
        resumeToken: clientHandoff.resumeToken,
        statePatchSchema: clientHandoff.statePatch.schema,
        selectedPathReconciliation: clientHandoff.selectedPathReconciliation,
        validation: clientHandoff.validation,
        auditRef: clientHandoff.audit.auditRef
      },
      {
        source: surfaceId,
        kind: 'preview-acceptance',
        previewId: preview.previewId,
        previewState: preview.state,
        readinessState: userReadiness.state,
        accepted: acceptance.accepted,
        canAccept: acceptance.canAccept,
        validationErrorCodes: validationSummary.errors.map((error) => error.code),
        nextStepId: explainableNextSteps.recommended?.id || '',
        readinessSchema: userReadiness.schema,
        readinessGates: userReadiness.gates.map((gate) => ({
          id: gate.id,
          ready: gate.ready,
          severity: gate.severity,
          route: gate.route,
          blockingCodes: gate.blockingCodes
        })),
        acceptanceControl: userReadiness.acceptanceControl
      },
      {
        source: surfaceId,
        kind: 'analytics-report',
        snapshotId: analytics.currentSnapshot.snapshotId,
        exportSchema: analytics.reportingState.exportSchema,
        exportReady: analytics.reportingState.exportReady,
        historyDepth: analytics.history.length,
        timelineEvents: analytics.timeline.length,
        counters: analytics.counters,
        trend: analytics.trend,
        auditRef: analytics.exportSummary.row.auditRef
      }
    ]
  };
}

export default describeGitDiffSurface;
