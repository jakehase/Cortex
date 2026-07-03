export const surfaceId = "aios_package-sdk_driver-package_094";
export const surfaceGroup = "package-sdk";
export const surfaceName = "driver-package";

const lifecycleCommands = new Set(['install', 'start', 'stop', 'restart', 'enable', 'disable', 'schedule']);
const lifecycleStates = new Set(['missing', 'installed', 'starting', 'running', 'stopping', 'stopped', 'disabled', 'failed']);
const schedulingModes = new Set(['manual', 'interval', 'cron']);
const providerStates = new Set(['ready', 'degraded', 'offline', 'unauthorized']);
const providerHealthStatuses = new Set(['pass', 'warn', 'fail', 'unknown']);
const providerAuthModes = new Set(['none', 'kernel-service-token', 'oauth-client', 'handoff']);
const providerAcknowledgementModes = new Set(['none', 'sync', 'async']);
const providerAcknowledgementStatuses = new Set(['pending', 'acknowledged', 'rejected', 'timed-out', 'unknown']);
const clientChannels = new Set(['cli', 'web', 'api', 'agent']);
const workflowIntents = new Set(['inspect', 'configure', 'activate', 'deactivate', 'recover', 'schedule']);
const clientWorkflowStates = new Set([
  'ready-to-submit',
  'needs-client-repair',
  'needs-access-boundary',
  'needs-command-admission',
  'needs-provider-binding',
  'awaiting-user-choice'
]);
const clientCommandStatuses = new Set(['record-new', 'resume-existing', 'already-committed', 'noop-already-satisfied', 'not-recorded']);
const persistedCommandStatuses = new Set(['pending', 'applying', 'committed', 'failed', 'cancelled']);
const defaultProviderCapabilities = ['driver.lifecycle.read', 'driver.lifecycle.write'];
const supportedServiceContractVersions = new Set([1, 2]);
const serviceOperations = new Set([
  'driver.package.install',
  'driver.lifecycle.start',
  'driver.lifecycle.stop',
  'driver.lifecycle.restart',
  'driver.lifecycle.enable',
  'driver.lifecycle.disable',
  'driver.schedule.apply'
]);
const syncScopes = new Set(['lifecycle-state', 'package-settings', 'schedule', 'audit-proof', 'handoff-state']);
const rolePermissionGrants = {
  owner: ['driver.lifecycle.read', 'driver.lifecycle.write', 'driver.package.install', 'driver.schedule.write', 'driver.audit.read'],
  admin: ['driver.lifecycle.read', 'driver.lifecycle.write', 'driver.package.install', 'driver.schedule.write', 'driver.audit.read'],
  operator: ['driver.lifecycle.read', 'driver.lifecycle.write', 'driver.schedule.write'],
  scheduler: ['driver.lifecycle.read', 'driver.schedule.write'],
  viewer: ['driver.lifecycle.read'],
  auditor: ['driver.lifecycle.read', 'driver.audit.read']
};

function coerceBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePackageId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'driver-package';
}

function normalizeLifecycleState(value) {
  return lifecycleStates.has(value) ? value : 'missing';
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeCommand(value, currentState, requestedEnabled) {
  if (lifecycleCommands.has(value)) return value;
  if (requestedEnabled === false) return 'disable';
  if (requestedEnabled === true && currentState === 'disabled') return 'enable';
  if (currentState === 'missing') return 'install';
  if (currentState === 'installed' || currentState === 'stopped') return 'start';
  if (currentState === 'failed') return 'restart';
  return 'schedule';
}

function normalizeSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  const maxConcurrency = Number.isInteger(raw.maxConcurrency) ? raw.maxConcurrency : 1;
  const restartRetries = Number.isInteger(raw.restartRetries) ? raw.restartRetries : 2;
  const retryBackoffBaseMs = Number.isInteger(raw.retryBackoffBaseMs) ? raw.retryBackoffBaseMs : 1000;
  const healthcheckTimeoutMs = Number.isInteger(raw.healthcheckTimeoutMs) ? raw.healthcheckTimeoutMs : 5000;
  const telemetry = raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : {};

  const normalized = {
    maxConcurrency,
    restartRetries,
    retryBackoffBaseMs,
    healthcheckTimeoutMs,
    proofMode: raw.proofMode === 'strict' ? 'strict' : 'standard',
    telemetry: {
      lifecycleEvents: coerceBoolean(telemetry.lifecycleEvents, true),
      settingChanges: coerceBoolean(telemetry.settingChanges, true)
    }
  };

  const issues = [];
  if (maxConcurrency < 1 || maxConcurrency > 16) {
    issues.push({
      code: 'settings.maxConcurrency.out_of_range',
      message: 'maxConcurrency must be an integer from 1 through 16.'
    });
  }
  if (restartRetries < 0 || restartRetries > 8) {
    issues.push({
      code: 'settings.restartRetries.out_of_range',
      message: 'restartRetries must be an integer from 0 through 8.'
    });
  }
  if (retryBackoffBaseMs < 250 || retryBackoffBaseMs > 30000) {
    issues.push({
      code: 'settings.retryBackoffBaseMs.out_of_range',
      message: 'retryBackoffBaseMs must be an integer from 250 through 30000.'
    });
  }
  if (healthcheckTimeoutMs < 1000 || healthcheckTimeoutMs > 120000) {
    issues.push({
      code: 'settings.healthcheckTimeoutMs.out_of_range',
      message: 'healthcheckTimeoutMs must be an integer from 1000 through 120000.'
    });
  }

  return { normalized, issues };
}

function normalizeSchedule(schedule = {}) {
  const raw = schedule && typeof schedule === 'object' ? schedule : {};
  const mode = schedulingModes.has(raw.mode) ? raw.mode : 'manual';
  const intervalSeconds = Number.isInteger(raw.intervalSeconds) ? raw.intervalSeconds : null;
  const cron = typeof raw.cron === 'string' ? raw.cron.trim() : '';
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim() : 'UTC';

  const normalized = { mode, intervalSeconds, cron, timezone };
  const issues = [];
  if (mode === 'interval' && (intervalSeconds === null || intervalSeconds < 60 || intervalSeconds > 86400)) {
    issues.push({
      code: 'schedule.intervalSeconds.invalid',
      message: 'interval schedules require intervalSeconds from 60 through 86400.'
    });
  }
  if (mode === 'cron' && !cron) {
    issues.push({
      code: 'schedule.cron.required',
      message: 'cron schedules require a non-empty cron expression.'
    });
  }

  return { normalized, issues };
}

function normalizeCapabilityList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw.filter((capability) => typeof capability === 'string' && capability.trim()).map((capability) => capability.trim()))];
}

function normalizeStringList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))];
}

function normalizeWorkspacePackageScope(boundary, packageId, command) {
  const rawScope = boundary.packageScope && typeof boundary.packageScope === 'object' ? boundary.packageScope : {};
  const allowedPackageIds = normalizeStringList(rawScope.allowedPackageIds ?? boundary.allowedPackageIds);
  const allowedPackagePrefixes = normalizeStringList(rawScope.allowedPackagePrefixes ?? boundary.allowedPackagePrefixes);
  const deniedPackageIds = normalizeStringList(rawScope.deniedPackageIds ?? boundary.deniedPackageIds);
  const enforceForReads = coerceBoolean(rawScope.enforceForReads ?? boundary.enforcePackageScopeForReads, false);
  const mutatingCommand = commandRequiresKernelMutation(command);
  const scoped = allowedPackageIds.length > 0 || allowedPackagePrefixes.length > 0 || deniedPackageIds.length > 0;
  const packageExplicitlyDenied = deniedPackageIds.includes(packageId);
  const packageIdAllowed = allowedPackageIds.includes(packageId);
  const packagePrefixAllowed = allowedPackagePrefixes.some((prefix) => packageId.startsWith(prefix));
  const allowListConfigured = allowedPackageIds.length > 0 || allowedPackagePrefixes.length > 0;
  const scopeApplies = mutatingCommand || enforceForReads;
  const packageAllowed = !scopeApplies
    ? true
    : packageExplicitlyDenied
      ? false
      : allowListConfigured
        ? packageIdAllowed || packagePrefixAllowed
        : true;
  const issues = [];

  if (scopeApplies && packageExplicitlyDenied) {
    issues.push({
      code: 'boundary.package_scope.denied',
      message: 'Driver package is explicitly denied by the workspace package scope.',
      packageId
    });
  } else if (scopeApplies && allowListConfigured && !packageAllowed) {
    issues.push({
      code: 'boundary.package_scope.not_allowed',
      message: 'Driver package is outside the workspace package scope allowed for this actor.',
      packageId
    });
  }

  return {
    contractVersion: 1,
    scoped,
    scopeApplies,
    enforceForReads,
    packageId,
    allowedPackageIds,
    allowedPackagePrefixes,
    deniedPackageIds,
    packageExplicitlyDenied,
    matchedBy: packageExplicitlyDenied
      ? 'deny-list'
      : packageIdAllowed
        ? 'package-id'
        : packagePrefixAllowed
          ? 'package-prefix'
          : allowListConfigured
            ? 'unmatched'
            : 'unrestricted',
    packageAllowed,
    issues
  };
}

function normalizeClientRequest(request = {}) {
  const raw = request && typeof request === 'object' ? request : {};
  const channel = clientChannels.has(raw.channel) ? raw.channel : 'api';
  const intent = workflowIntents.has(raw.intent) ? raw.intent : 'activate';
  const requestId = typeof raw.requestId === 'string' && raw.requestId.trim() ? raw.requestId.trim() : null;
  const actorId = typeof raw.actorId === 'string' && raw.actorId.trim() ? raw.actorId.trim() : 'anonymous';
  const workspaceId = typeof raw.workspaceId === 'string' && raw.workspaceId.trim() ? raw.workspaceId.trim() : null;
  const returnTo = typeof raw.returnTo === 'string' && raw.returnTo.trim() ? raw.returnTo.trim() : null;
  const clientState = raw.clientState && typeof raw.clientState === 'object' ? raw.clientState : {};
  const lastHandoffRef = typeof clientState.lastHandoffRef === 'string' && clientState.lastHandoffRef.trim()
    ? clientState.lastHandoffRef.trim()
    : null;
  const lastAcceptedRef = typeof clientState.lastAcceptedRef === 'string' && clientState.lastAcceptedRef.trim()
    ? clientState.lastAcceptedRef.trim()
    : null;
  const lastResumeToken = typeof clientState.lastResumeToken === 'string' && clientState.lastResumeToken.trim()
    ? clientState.lastResumeToken.trim()
    : null;
  const lastWorkflowId = typeof clientState.lastWorkflowId === 'string' && clientState.lastWorkflowId.trim()
    ? clientState.lastWorkflowId.trim()
    : null;
  const lastWorkflowState = clientWorkflowStates.has(clientState.lastWorkflowState)
    ? clientState.lastWorkflowState
    : null;
  const lastCommandId = typeof clientState.lastCommandId === 'string' && clientState.lastCommandId.trim()
    ? clientState.lastCommandId.trim()
    : null;
  const lastCommandStatus = clientCommandStatuses.has(clientState.lastCommandStatus)
    ? clientState.lastCommandStatus
    : null;

  return {
    channel,
    intent,
    requestId,
    actorId,
    workspaceId,
    returnTo,
    clientState: {
      lastHandoffRef,
      lastAcceptedRef,
      lastResumeToken,
      lastWorkflowId,
      lastWorkflowState,
      lastCommandId,
      lastCommandStatus,
      optimistic: coerceBoolean(clientState.optimistic, false),
      pendingWorkflow: typeof clientState.pendingWorkflow === 'string' && clientState.pendingWorkflow.trim()
        ? clientState.pendingWorkflow.trim()
        : null
    }
  };
}

function capabilitiesForCommand(command, schedule) {
  const required = ['driver.lifecycle.read'];
  if (command === 'install') required.push('driver.package.install');
  if (['start', 'stop', 'restart', 'enable', 'disable'].includes(command)) required.push('driver.lifecycle.write');
  if (command === 'schedule' || schedule.mode !== 'manual') required.push('driver.schedule.write');
  return [...new Set(required)];
}

function normalizeAccessBoundary(input, clientRequest, command, schedule, packageId) {
  const boundary = input.boundary && typeof input.boundary === 'object' ? input.boundary : {};
  const access = input.access && typeof input.access === 'object' ? input.access : {};
  const rawRequest = input.request && typeof input.request === 'object' ? input.request : {};
  const tenantId = typeof boundary.tenantId === 'string' && boundary.tenantId.trim()
    ? boundary.tenantId.trim()
    : typeof input.tenantId === 'string' && input.tenantId.trim()
      ? input.tenantId.trim()
      : null;
  const workspaceId = typeof boundary.workspaceId === 'string' && boundary.workspaceId.trim()
    ? boundary.workspaceId.trim()
    : clientRequest.workspaceId;
  const roles = normalizeStringList(access.roles ?? rawRequest.roles);
  const explicitPermissions = normalizeCapabilityList(access.permissions ?? rawRequest.permissions);
  const rolePermissions = roles.flatMap((role) => rolePermissionGrants[role] ?? []);
  const effectivePermissions = normalizeCapabilityList([...explicitPermissions, ...rolePermissions]);
  const requiredPermissions = capabilitiesForCommand(command, schedule);
  const missingPermissions = requiredPermissions.filter((permission) => !effectivePermissions.includes(permission));
  const mutatingCommand = commandRequiresKernelMutation(command);
  const packageScope = normalizeWorkspacePackageScope(boundary, packageId, command);
  const issues = [];

  if (mutatingCommand && !tenantId) {
    issues.push({
      code: 'boundary.tenant.required',
      message: 'Mutating hosted-kernel driver commands require an explicit tenant boundary.'
    });
  }
  if (mutatingCommand && !workspaceId) {
    issues.push({
      code: 'boundary.workspace.required',
      message: 'Mutating hosted-kernel driver commands require an explicit workspace boundary.'
    });
  }
  if (missingPermissions.length > 0) {
    issues.push({
      code: 'access.permissions.missing',
      message: 'Actor is missing permissions required for this driver package lifecycle command.',
      missingPermissions
    });
  }
  issues.push(...packageScope.issues);

  return {
    contractVersion: 1,
    tenantId,
    workspaceId,
    actorId: clientRequest.actorId,
    roles,
    explicitPermissions,
    effectivePermissions,
    requiredPermissions,
    missingPermissions,
    isolated: Boolean(tenantId && workspaceId),
    packageScope,
    permissionGranted: missingPermissions.length === 0,
    accessGranted: missingPermissions.length === 0 && packageScope.packageAllowed,
    issues
  };
}

function serviceOperationForCommand(command) {
  if (command === 'install') return 'driver.package.install';
  if (command === 'start') return 'driver.lifecycle.start';
  if (command === 'stop') return 'driver.lifecycle.stop';
  if (command === 'restart') return 'driver.lifecycle.restart';
  if (command === 'enable') return 'driver.lifecycle.enable';
  if (command === 'disable') return 'driver.lifecycle.disable';
  return 'driver.schedule.apply';
}

function normalizeServiceOperations(value, fallback) {
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw.filter((operation) => serviceOperations.has(operation)))];
}

function normalizeSyncScopes(value, schedule) {
  const fallback = ['lifecycle-state', 'package-settings', 'audit-proof'];
  if (schedule.mode !== 'manual') fallback.push('schedule');
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw.filter((scope) => syncScopes.has(scope)))];
}

function normalizeProviderServiceContract(rawProvider, command, schedule, now) {
  const raw = rawProvider.serviceContract && typeof rawProvider.serviceContract === 'object'
    ? rawProvider.serviceContract
    : {};
  const version = Number.isInteger(raw.version)
    ? raw.version
    : Number.isInteger(rawProvider.contractVersion)
      ? rawProvider.contractVersion
      : 1;
  const minVersion = Number.isInteger(raw.minVersion) ? raw.minVersion : 1;
  const operation = serviceOperationForCommand(command);
  const operations = normalizeServiceOperations(raw.operations, [operation]);
  const scopes = normalizeSyncScopes(raw.syncScopes, schedule);
  const handoff = raw.handoff && typeof raw.handoff === 'object' ? raw.handoff : {};
  const leaseExpiresAt = normalizeTimestamp(handoff.leaseExpiresAt);
  const nowMs = Date.parse(now);
  const leaseMs = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null;
  const leaseExpired = leaseMs !== null && !Number.isNaN(nowMs) && leaseMs <= nowMs;
  const negotiatedVersion = supportedServiceContractVersions.has(version) && minVersion <= 2
    ? Math.min(version, 2)
    : null;
  const issues = [];
  const warnings = [];

  if (!negotiatedVersion) {
    issues.push({
      code: 'provider.service_contract.version_unsupported',
      message: 'Provider service contract version is not supported by the hosted-kernel driver package.'
    });
  }
  if (!operations.includes(operation)) {
    issues.push({
      code: 'provider.service_contract.operation_missing',
      message: 'Provider service contract does not expose the lifecycle operation required by this command.'
    });
  }
  if (schedule.mode !== 'manual' && !scopes.includes('schedule')) {
    issues.push({
      code: 'provider.service_contract.schedule_scope_missing',
      message: 'Scheduled commands require the provider service contract to sync schedule scope.'
    });
  }
  if (handoff.required === true && !leaseExpiresAt) {
    warnings.push({
      code: 'provider.service_contract.handoff_lease_missing',
      message: 'Provider requires external handoff but did not include a lease expiration.'
    });
  }
  if (leaseExpired) {
    issues.push({
      code: 'provider.service_contract.handoff_lease_expired',
      message: 'Provider handoff lease has expired and must be refreshed before dispatch.'
    });
  }

  return {
    contractName: 'hosted-kernel-driver-service',
    requestedOperation: operation,
    version,
    minVersion,
    negotiatedVersion,
    operations,
    syncScopes: scopes,
    handoff: {
      required: coerceBoolean(handoff.required, false),
      state: typeof handoff.state === 'string' && handoff.state.trim() ? handoff.state.trim() : 'not-required',
      leaseId: typeof handoff.leaseId === 'string' && handoff.leaseId.trim() ? handoff.leaseId.trim() : null,
      leaseExpiresAt,
      leaseExpired
    },
    issues,
    warnings,
    ok: issues.length === 0
  };
}

function normalizeSyncState(sync = {}) {
  const raw = sync && typeof sync === 'object' ? sync : {};
  const lastSyncedAt = typeof raw.lastSyncedAt === 'string' && raw.lastSyncedAt.trim() ? raw.lastSyncedAt.trim() : null;
  const cursor = typeof raw.cursor === 'string' && raw.cursor.trim() ? raw.cursor.trim() : null;
  const generation = Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : 0;
  const dirty = coerceBoolean(raw.dirty, false);
  return {
    generation,
    lastSyncedAt,
    cursor,
    dirty,
    status: dirty ? 'pending-push' : lastSyncedAt ? 'synced' : 'not-synced'
  };
}

function matchesOptionalScopeList(values, requestedValue) {
  return values.length === 0 || (requestedValue !== null && values.includes(requestedValue));
}

function normalizeProviderCapabilityPolicy(rawProvider, baseCapabilities, requiredCapabilities, accessBoundary, packageId, now) {
  const rawBoundary = rawProvider.boundary && typeof rawProvider.boundary === 'object' ? rawProvider.boundary : {};
  const rawGrants = Array.isArray(rawBoundary.capabilityGrants)
    ? rawBoundary.capabilityGrants
    : Array.isArray(rawProvider.capabilityGrants)
      ? rawProvider.capabilityGrants
      : [];
  const mode = rawBoundary.capabilityMode === 'scoped-only' || rawProvider.capabilityMode === 'scoped-only'
    ? 'scoped-only'
    : 'global-with-scoped-grants';
  const deniedCapabilities = normalizeCapabilityList(rawBoundary.deniedCapabilities ?? rawProvider.deniedCapabilities);
  const nowMs = Date.parse(now);
  const grants = rawGrants
    .map((grant, index) => {
      const rawGrant = grant && typeof grant === 'object' ? grant : {};
      const expiresAt = normalizeTimestamp(rawGrant.expiresAt);
      const expiresMs = expiresAt ? Date.parse(expiresAt) : null;
      const tenantIds = normalizeStringList(rawGrant.tenantIds);
      const workspaceIds = normalizeStringList(rawGrant.workspaceIds);
      const packageIds = normalizeStringList(rawGrant.packageIds);
      const packagePrefixes = normalizeStringList(rawGrant.packagePrefixes);
      const packageDeniedIds = normalizeStringList(rawGrant.deniedPackageIds);
      const capabilityList = normalizeCapabilityList(rawGrant.capabilities);
      const tenantMatch = matchesOptionalScopeList(tenantIds, accessBoundary.tenantId);
      const workspaceMatch = matchesOptionalScopeList(workspaceIds, accessBoundary.workspaceId);
      const packageIdMatch = matchesOptionalScopeList(packageIds, packageId);
      const packagePrefixMatch = packagePrefixes.length === 0 || packagePrefixes.some((prefix) => packageId.startsWith(prefix));
      const packageDenied = packageDeniedIds.includes(packageId);
      const expired = expiresMs !== null && !Number.isNaN(nowMs) && expiresMs <= nowMs;
      const matched = tenantMatch && workspaceMatch && packageIdMatch && packagePrefixMatch && !packageDenied && !expired;

      return {
        grantId: typeof rawGrant.grantId === 'string' && rawGrant.grantId.trim() ? rawGrant.grantId.trim() : `grant-${index + 1}`,
        capabilities: capabilityList,
        tenantIds,
        workspaceIds,
        packageIds,
        packagePrefixes,
        deniedPackageIds: packageDeniedIds,
        expiresAt,
        matched,
        expired,
        mismatchReasons: [
          tenantMatch ? null : 'tenant',
          workspaceMatch ? null : 'workspace',
          packageIdMatch ? null : 'package-id',
          packagePrefixMatch ? null : 'package-prefix',
          packageDenied ? 'package-denied' : null,
          expired ? 'expired' : null
        ].filter(Boolean)
      };
    })
    .filter((grant) => grant.capabilities.length > 0);
  const matchedGrantCapabilities = grants
    .filter((grant) => grant.matched)
    .flatMap((grant) => grant.capabilities);
  const globalCapabilities = mode === 'scoped-only' ? [] : baseCapabilities;
  const effectiveCapabilities = normalizeCapabilityList([...globalCapabilities, ...matchedGrantCapabilities])
    .filter((capability) => !deniedCapabilities.includes(capability));
  const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !effectiveCapabilities.includes(capability));
  const scopedRequiredCapabilities = requiredCapabilities.filter((capability) => grants.some((grant) => grant.capabilities.includes(capability)));
  const issues = [];
  const warnings = [];

  if (mode === 'scoped-only' && grants.length === 0) {
    issues.push({
      code: 'provider.capability_scope.grants_required',
      message: 'Provider capability mode is scoped-only but no tenant/workspace capability grants were supplied.'
    });
  }
  if (missingRequiredCapabilities.length > 0 && scopedRequiredCapabilities.length > 0) {
    issues.push({
      code: 'provider.capability_scope.required_capability_not_granted',
      message: 'Provider has scoped capability grants, but none match the requested tenant, workspace, and package boundary.',
      missingCapabilities: missingRequiredCapabilities,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      packageId
    });
  }
  if (deniedCapabilities.some((capability) => requiredCapabilities.includes(capability))) {
    issues.push({
      code: 'provider.capability_scope.required_capability_denied',
      message: 'Provider boundary denies a capability required for this hosted-kernel lifecycle command.',
      deniedCapabilities: deniedCapabilities.filter((capability) => requiredCapabilities.includes(capability))
    });
  }
  if (grants.some((grant) => grant.expired && grant.capabilities.some((capability) => requiredCapabilities.includes(capability)))) {
    warnings.push({
      code: 'provider.capability_scope.expired_required_grant',
      message: 'At least one scoped provider capability grant for the requested command has expired.'
    });
  }

  return {
    contractVersion: 1,
    mode,
    effectiveCapabilities,
    globalCapabilities,
    deniedCapabilities,
    matchedGrantIds: grants.filter((grant) => grant.matched).map((grant) => grant.grantId),
    unmatchedRequiredGrantIds: grants
      .filter((grant) => !grant.matched && grant.capabilities.some((capability) => requiredCapabilities.includes(capability)))
      .map((grant) => grant.grantId),
    grantCount: grants.length,
    grants,
    missingRequiredCapabilities,
    scopedRequiredCapabilities,
    issues,
    warnings,
    ok: issues.length === 0
  };
}

function normalizeProviderHealth(rawProvider, command, now) {
  const rawHealth = rawProvider.health && typeof rawProvider.health === 'object' ? rawProvider.health : {};
  const status = providerHealthStatuses.has(rawHealth.status) ? rawHealth.status : 'unknown';
  const checkedAt = normalizeTimestamp(rawHealth.checkedAt ?? rawHealth.lastCheckedAt);
  const maxAgeMs = Number.isInteger(rawHealth.maxAgeMs) && rawHealth.maxAgeMs >= 1000 ? rawHealth.maxAgeMs : 180000;
  const nowMs = Date.parse(now);
  const checkedMs = checkedAt ? Date.parse(checkedAt) : null;
  const ageMs = checkedMs !== null && !Number.isNaN(nowMs) ? Math.max(0, nowMs - checkedMs) : null;
  const stale = ageMs === null || ageMs > maxAgeMs;
  const consecutiveFailures = Number.isInteger(rawHealth.consecutiveFailures) && rawHealth.consecutiveFailures >= 0
    ? rawHealth.consecutiveFailures
    : status === 'fail'
      ? 1
      : 0;
  const degradedCommands = normalizeStringList(rawHealth.degradedModeCommands, ['stop', 'disable', 'schedule'])
    .filter((entry) => lifecycleCommands.has(entry));
  const errorCode = typeof rawHealth.errorCode === 'string' && rawHealth.errorCode.trim()
    ? rawHealth.errorCode.trim()
    : status === 'fail'
      ? 'provider.health.failed'
      : stale
        ? 'provider.health.stale'
        : null;
  const issues = [];
  const warnings = [];

  if (status === 'fail') {
    issues.push({
      code: 'provider.health.failed',
      message: 'Provider health check is failing and cannot accept hosted-kernel lifecycle dispatch.',
      errorCode,
      consecutiveFailures
    });
  }
  if (stale) {
    warnings.push({
      code: 'provider.health.stale',
      message: 'Provider health check is stale; hosted-kernel dispatch should refresh health before command submission.',
      checkedAt,
      maxAgeMs
    });
  }
  if (status === 'warn' && !degradedCommands.includes(command)) {
    issues.push({
      code: 'provider.health.degraded_command_blocked',
      message: 'Provider is degraded and does not allow this lifecycle command in degraded mode.',
      allowedCommands: degradedCommands
    });
  }

  return {
    contractVersion: 1,
    status,
    checkedAt,
    ageMs,
    maxAgeMs,
    stale,
    consecutiveFailures,
    errorCode,
    degradedMode: status === 'warn',
    degradedModeAllowsCommand: status !== 'warn' || degradedCommands.includes(command),
    degradedModeCommands: degradedCommands,
    issues,
    warnings,
    ok: issues.length === 0
  };
}

function normalizeProviderAcknowledgement(rawProvider, command, now, settings) {
  const rawContract = rawProvider.serviceContract && typeof rawProvider.serviceContract === 'object'
    ? rawProvider.serviceContract
    : {};
  const rawAck = rawProvider.acknowledgement && typeof rawProvider.acknowledgement === 'object'
    ? rawProvider.acknowledgement
    : rawContract.acknowledgement && typeof rawContract.acknowledgement === 'object'
      ? rawContract.acknowledgement
      : {};
  const mutatingCommand = commandRequiresKernelMutation(command);
  const mode = providerAcknowledgementModes.has(rawAck.mode)
    ? rawAck.mode
    : mutatingCommand
      ? 'async'
      : 'none';
  const status = providerAcknowledgementStatuses.has(rawAck.status) ? rawAck.status : 'unknown';
  const timeoutMs = Number.isInteger(rawAck.timeoutMs) ? rawAck.timeoutMs : settings.healthcheckTimeoutMs;
  const callbackUrl = typeof rawAck.callbackUrl === 'string' && rawAck.callbackUrl.trim() ? rawAck.callbackUrl.trim() : null;
  const ackRef = typeof rawAck.ackRef === 'string' && rawAck.ackRef.trim() ? rawAck.ackRef.trim() : null;
  const lastAckAt = normalizeTimestamp(rawAck.lastAckAt ?? rawAck.acknowledgedAt);
  const nowMs = Date.parse(now);
  const ackMs = lastAckAt ? Date.parse(lastAckAt) : null;
  const ackAgeMs = ackMs !== null && !Number.isNaN(nowMs) ? Math.max(0, nowMs - ackMs) : null;
  const ackWindowExpired = status === 'pending' && ackAgeMs !== null && ackAgeMs > timeoutMs;
  const issues = [];
  const warnings = [];

  if (mutatingCommand && mode === 'none') {
    issues.push({
      code: 'provider.acknowledgement.required',
      message: 'Mutating hosted-kernel lifecycle commands require a provider acknowledgement contract.'
    });
  }
  if (timeoutMs < 1000 || timeoutMs > 120000) {
    issues.push({
      code: 'provider.acknowledgement.timeout_invalid',
      message: 'Provider acknowledgement timeout must be from 1000 through 120000 milliseconds.',
      timeoutMs
    });
  }
  if (mode === 'async' && callbackUrl && !/^https:\/\//i.test(callbackUrl)) {
    issues.push({
      code: 'provider.acknowledgement.callback_https_required',
      message: 'Asynchronous provider acknowledgement callbacks must use https.'
    });
  }
  if (status === 'rejected' || status === 'timed-out' || ackWindowExpired) {
    issues.push({
      code: status === 'rejected' ? 'provider.acknowledgement.rejected' : 'provider.acknowledgement.timed_out',
      message: 'Provider acknowledgement state blocks hosted-kernel lifecycle dispatch until reconciled.',
      ackRef,
      lastAckAt,
      timeoutMs
    });
  }
  if (mutatingCommand && mode === 'async' && !callbackUrl) {
    warnings.push({
      code: 'provider.acknowledgement.callback_missing',
      message: 'Provider uses asynchronous acknowledgement without a callback URL; polling will be required.'
    });
  }

  return {
    contractVersion: 1,
    required: mutatingCommand,
    mode,
    status,
    ackRef,
    callbackUrl,
    timeoutMs,
    lastAckAt,
    ackAgeMs,
    ackWindowExpired,
    pollRequired: mode === 'async' && !callbackUrl,
    issues,
    warnings,
    ok: issues.length === 0
  };
}

function commandRequiresKernelMutation(command) {
  return ['install', 'start', 'stop', 'restart', 'enable', 'disable', 'schedule'].includes(command);
}

function buildDispatchRoute({ providerId, serviceId, endpoint }) {
  if (endpoint) {
    return {
      mode: 'https',
      target: endpoint,
      serviceId,
      providerId
    };
  }
  return {
    mode: 'service-bus',
    target: serviceId,
    serviceId,
    providerId
  };
}

function buildProviderDispatchProfile({ providerId, serviceId, state, authMode, endpoint, sync, serviceContract, providerBoundary, capabilityPolicy, health, acknowledgement }, requiredCapabilities, command, schedule, accessBoundary) {
  const issues = [];
  const warnings = [];
  const mutatesKernel = commandRequiresKernelMutation(command);
  const route = buildDispatchRoute({ providerId, serviceId, endpoint });
  const delivery = schedule.mode === 'manual' ? 'immediate' : 'scheduled';

  if (state !== 'ready' && !(state === 'degraded' && health.degradedMode && health.degradedModeAllowsCommand)) {
    issues.push({
      code: 'provider.state.not_ready',
      message: 'Provider must be ready, or explicitly allow this command in degraded mode, before lifecycle dispatch.'
    });
  }
  if (mutatesKernel && authMode === 'none') {
    issues.push({
      code: 'provider.auth.mutation_requires_auth',
      message: 'Mutating driver lifecycle commands require a provider auth mode.'
    });
  }
  if (route.mode === 'https' && !/^https:\/\//i.test(endpoint)) {
    issues.push({
      code: 'provider.endpoint.https_required',
      message: 'Hosted-kernel provider endpoints must use https.'
    });
  }
  if (sync.status === 'pending-push') {
    warnings.push({
      code: 'provider.sync.pending_push',
      message: 'Provider has unsynced state; command dispatch should include the current generation.'
    });
  }
  if (accessBoundary.tenantId && providerBoundary.tenantIds.length > 0 && !providerBoundary.tenantIds.includes(accessBoundary.tenantId)) {
    issues.push({
      code: 'provider.boundary.tenant_mismatch',
      message: 'Provider is not bound to the requested tenant boundary.'
    });
  }
  if (accessBoundary.workspaceId && providerBoundary.workspaceIds.length > 0 && !providerBoundary.workspaceIds.includes(accessBoundary.workspaceId)) {
    issues.push({
      code: 'provider.boundary.workspace_mismatch',
      message: 'Provider is not bound to the requested workspace boundary.'
    });
  }
  if (mutatesKernel && providerBoundary.tenantIds.length === 0) {
    warnings.push({
      code: 'provider.boundary.tenant_unscoped',
      message: 'Provider did not advertise tenant allow-list data for a mutating command.'
    });
  }
  if (capabilityPolicy.missingRequiredCapabilities.length > 0) {
    issues.push({
      code: 'provider.capability_scope.missing_required',
      message: 'Provider effective capabilities do not satisfy the requested hosted-kernel lifecycle operation.',
      missingCapabilities: capabilityPolicy.missingRequiredCapabilities,
      mode: capabilityPolicy.mode,
      matchedGrantIds: capabilityPolicy.matchedGrantIds
    });
  }
  issues.push(...capabilityPolicy.issues);
  warnings.push(...capabilityPolicy.warnings);
  issues.push(...health.issues);
  warnings.push(...health.warnings);
  issues.push(...serviceContract.issues);
  warnings.push(...serviceContract.warnings);
  issues.push(...acknowledgement.issues);
  warnings.push(...acknowledgement.warnings);

  return {
    contractVersion: 1,
    providerId,
    serviceId,
    route,
    auth: {
      mode: authMode,
      required: mutatesKernel
    },
    delivery,
    scheduleMode: schedule.mode,
    serviceContract: {
      name: serviceContract.contractName,
      operation: serviceContract.requestedOperation,
      version: serviceContract.negotiatedVersion,
      syncScopes: serviceContract.syncScopes,
      handoffLeaseId: serviceContract.handoff.leaseId
    },
    acknowledgement: {
      required: acknowledgement.required,
      mode: acknowledgement.mode,
      status: acknowledgement.status,
      ackRef: acknowledgement.ackRef,
      callbackUrl: acknowledgement.callbackUrl,
      timeoutMs: acknowledgement.timeoutMs,
      pollRequired: acknowledgement.pollRequired
    },
    health: {
      status: health.status,
      checkedAt: health.checkedAt,
      ageMs: health.ageMs,
      stale: health.stale,
      degradedMode: health.degradedMode,
      degradedModeAllowsCommand: health.degradedModeAllowsCommand,
      consecutiveFailures: health.consecutiveFailures,
      errorCode: health.errorCode
    },
    boundary: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      providerTenantScoped: providerBoundary.tenantIds.length > 0,
      providerWorkspaceScoped: providerBoundary.workspaceIds.length > 0
    },
    capabilityPolicy: {
      mode: capabilityPolicy.mode,
      effectiveCapabilities: capabilityPolicy.effectiveCapabilities,
      deniedCapabilities: capabilityPolicy.deniedCapabilities,
      matchedGrantIds: capabilityPolicy.matchedGrantIds,
      unmatchedRequiredGrantIds: capabilityPolicy.unmatchedRequiredGrantIds,
      scopedRequiredCapabilities: capabilityPolicy.scopedRequiredCapabilities,
      missingRequiredCapabilities: capabilityPolicy.missingRequiredCapabilities,
      grantCount: capabilityPolicy.grantCount
    },
    requiredCapabilities,
    syncGeneration: sync.generation,
    syncStatus: sync.status,
    dispatchReady: issues.length === 0,
    issues,
    warnings
  };
}

function buildRetryBackoffPlan({ lastCommand, command, settings, now }) {
  const failedSameCommand = Boolean(lastCommand && lastCommand.command === command && lastCommand.status === 'failed');
  const nextAttempt = failedSameCommand ? lastCommand.attempt + 1 : 0;
  const restartRetries = settings.restartRetries;
  const budgetAvailable = !failedSameCommand || nextAttempt <= restartRetries;
  const baseDelayMs = Number.isInteger(settings.retryBackoffBaseMs) ? settings.retryBackoffBaseMs : 1000;
  const cappedBaseDelayMs = Math.min(Math.max(baseDelayMs, 250), 30000);
  const delayMs = failedSameCommand ? Math.min(300000, cappedBaseDelayMs * (2 ** Math.max(0, nextAttempt - 1))) : 0;
  const anchorAt = lastCommand?.completedAt ?? lastCommand?.lastHeartbeatAt ?? lastCommand?.submittedAt ?? null;
  const anchorMs = anchorAt ? Date.parse(anchorAt) : null;
  const nowMs = Date.parse(now);
  const retryAfterAt = failedSameCommand && anchorMs !== null && !Number.isNaN(anchorMs)
    ? new Date(anchorMs + delayMs).toISOString()
    : null;
  const retryAfterMs = retryAfterAt ? Date.parse(retryAfterAt) : null;
  const cooldownActive = Boolean(retryAfterMs !== null && !Number.isNaN(nowMs) && retryAfterMs > nowMs);

  return {
    failedSameCommand,
    nextAttempt,
    restartRetries,
    budgetAvailable,
    delayMs,
    retryAfterAt,
    cooldownActive,
    lastErrorCode: lastCommand?.errorCode ?? null,
    action: !budgetAvailable
      ? 'inspect-last-failure'
      : cooldownActive
        ? 'wait-for-retry-backoff'
        : failedSameCommand
          ? 'retry-with-backoff-proof'
          : 'submit-first-attempt'
  };
}

function normalizePersistedCommandBoundary(raw = {}) {
  const boundary = raw.boundary && typeof raw.boundary === 'object' ? raw.boundary : {};
  const tenantId = typeof boundary.tenantId === 'string' && boundary.tenantId.trim()
    ? boundary.tenantId.trim()
    : typeof raw.tenantId === 'string' && raw.tenantId.trim()
      ? raw.tenantId.trim()
      : null;
  const workspaceId = typeof boundary.workspaceId === 'string' && boundary.workspaceId.trim()
    ? boundary.workspaceId.trim()
    : typeof raw.workspaceId === 'string' && raw.workspaceId.trim()
      ? raw.workspaceId.trim()
      : null;
  const actorId = typeof boundary.actorId === 'string' && boundary.actorId.trim()
    ? boundary.actorId.trim()
    : typeof raw.actorId === 'string' && raw.actorId.trim()
      ? raw.actorId.trim()
      : null;
  const packageId = typeof boundary.packageId === 'string' && boundary.packageId.trim()
    ? boundary.packageId.trim()
    : typeof raw.packageId === 'string' && raw.packageId.trim()
      ? raw.packageId.trim()
      : null;
  const packageScopeMatchedBy = typeof boundary.packageScopeMatchedBy === 'string' && boundary.packageScopeMatchedBy.trim()
    ? boundary.packageScopeMatchedBy.trim()
    : raw.packageScope && typeof raw.packageScope === 'object' && typeof raw.packageScope.matchedBy === 'string'
      ? raw.packageScope.matchedBy
      : null;

  return {
    tenantId,
    workspaceId,
    actorId,
    packageId,
    packageScopeMatchedBy,
    isolated: Boolean(tenantId && workspaceId),
    supplied: Boolean(tenantId || workspaceId || actorId || packageId || packageScopeMatchedBy)
  };
}

function normalizePersistedCommand(value = {}, fallbackCommand = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const command = lifecycleCommands.has(raw.command) ? raw.command : fallbackCommand;
  const status = persistedCommandStatuses.has(raw.status) ? raw.status : 'pending';
  const commandId = typeof raw.commandId === 'string' && raw.commandId.trim() ? raw.commandId.trim() : null;
  const requestId = typeof raw.requestId === 'string' && raw.requestId.trim() ? raw.requestId.trim() : null;
  const desiredState = lifecycleStates.has(raw.desiredState) ? raw.desiredState : null;
  const providerId = typeof raw.providerId === 'string' && raw.providerId.trim() ? raw.providerId.trim() : null;
  const errorCode = typeof raw.errorCode === 'string' && raw.errorCode.trim() ? raw.errorCode.trim() : null;
  const attempt = Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0;

  return {
    commandId,
    requestId,
    command,
    status,
    desiredState,
    providerId,
    attempt,
    submittedAt: normalizeTimestamp(raw.submittedAt),
    lastHeartbeatAt: normalizeTimestamp(raw.lastHeartbeatAt),
    completedAt: normalizeTimestamp(raw.completedAt),
    errorCode,
    boundary: normalizePersistedCommandBoundary(raw)
  };
}

function normalizePersistedState(persistedState = {}, packageId, now) {
  const raw = persistedState && typeof persistedState === 'object' ? persistedState : {};
  const revision = Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
  const lifecycleState = normalizeLifecycleState(raw.lifecycleState ?? raw.currentState);
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : lifecycleState !== 'disabled';
  const lastUpdatedAt = normalizeTimestamp(raw.lastUpdatedAt);
  const pendingCommand = raw.pendingCommand && typeof raw.pendingCommand === 'object'
    ? normalizePersistedCommand(raw.pendingCommand)
    : null;
  const lastCommand = raw.lastCommand && typeof raw.lastCommand === 'object'
    ? normalizePersistedCommand(raw.lastCommand)
    : null;
  const history = Array.isArray(raw.commandHistory)
    ? raw.commandHistory
        .slice(-5)
        .map((entry) => normalizePersistedCommand(entry))
        .filter((entry) => entry.command)
    : [];

  return {
    stateVersion: 1,
    packageId: normalizePackageId(raw.packageId ?? packageId),
    revision,
    lifecycleState,
    enabled,
    lastUpdatedAt,
    loaded: Object.keys(raw).length > 0,
    pendingCommand: pendingCommand?.command ? pendingCommand : null,
    lastCommand: lastCommand?.command ? lastCommand : null,
    commandHistory: history,
    normalizedAt: now
  };
}

function desiredStateForCommand(command, currentState) {
  if (command === 'disable') return 'disabled';
  if (command === 'stop') return 'stopped';
  if (command === 'install') return 'installed';
  if (command === 'enable') return currentState === 'disabled' ? 'stopped' : currentState;
  if (command === 'restart' || command === 'start') return 'running';
  return currentState;
}

function buildLifecycleTransitionPolicy({ command, currentState, requestedEnabled, schedule }) {
  const desiredState = desiredStateForCommand(command, currentState);
  const issues = [];
  const warnings = [];
  const enabledBefore = currentState !== 'disabled';
  const enabledAfter = command === 'disable'
    ? false
    : command === 'enable'
      ? true
      : requestedEnabled ?? enabledBefore;
  const mutatesLifecycle = ['install', 'start', 'stop', 'restart', 'enable', 'disable'].includes(command);
  const writesSchedule = command === 'schedule' || schedule.mode !== 'manual';
  const terminalState = ['missing', 'disabled'].includes(currentState);
  const transitionalState = ['starting', 'stopping'].includes(currentState);
  const commandRoutes = {
    install: ['missing'],
    start: ['installed', 'stopped', 'failed'],
    stop: ['running', 'starting'],
    restart: ['running', 'failed'],
    enable: ['disabled'],
    disable: ['installed', 'starting', 'running', 'stopping', 'stopped', 'failed'],
    schedule: ['installed', 'running', 'stopped', 'failed', 'disabled']
  };
  const allowedStates = commandRoutes[command] ?? commandRoutes.schedule;
  const stateAllowed = allowedStates.includes(currentState);

  if (!stateAllowed) {
    issues.push({
      code: 'lifecycle.transition.state_not_allowed',
      message: 'Requested driver lifecycle command is not valid for the current hosted-kernel package state.',
      command,
      currentState,
      allowedStates
    });
  }
  if ((command === 'start' || command === 'restart') && requestedEnabled === false) {
    issues.push({
      code: 'lifecycle.transition.start_requires_enabled',
      message: 'Starting or restarting the hosted-kernel driver requires the package to be enabled.',
      command,
      requestedEnabled
    });
  }
  if (command === 'schedule' && schedule.mode === 'manual') {
    issues.push({
      code: 'lifecycle.schedule.mode_required',
      message: 'Schedule lifecycle commands require an interval or cron schedule mode.'
    });
  }
  if (writesSchedule && currentState === 'missing') {
    issues.push({
      code: 'lifecycle.schedule.package_missing',
      message: 'A schedule cannot be attached until the driver package is installed.'
    });
  }
  if (writesSchedule && !enabledAfter) {
    warnings.push({
      code: 'lifecycle.schedule.saved_disabled',
      message: 'Schedule settings will be saved but will not dispatch while the driver package is disabled.',
      mode: schedule.mode
    });
  }
  if (transitionalState && command !== 'stop' && command !== 'disable') {
    warnings.push({
      code: 'lifecycle.transition.in_flight_state',
      message: 'The driver package is already in a transitional state; admission should preserve idempotency proof.',
      currentState
    });
  }

  return {
    contractVersion: 1,
    command,
    currentState,
    desiredState,
    enabledBefore,
    enabledAfter,
    mutatesLifecycle,
    writesSchedule,
    terminalState,
    transitionalState,
    stateAllowed,
    transitionAllowed: issues.length === 0,
    dispatchRequired: mutatesLifecycle || writesSchedule,
    persistenceEffect: {
      lifecycleState: desiredState,
      enabled: enabledAfter,
      scheduleMode: schedule.mode,
      writeSettings: writesSchedule,
      writeLifecycleState: mutatesLifecycle && desiredState !== currentState
    },
    nextActionState: issues.length
      ? 'blocked-invalid-transition'
      : writesSchedule && !enabledAfter
        ? 'save-schedule-disabled'
        : mutatesLifecycle
          ? 'dispatch-lifecycle-transition'
          : 'save-settings',
    issues,
    warnings
  };
}

function buildIdempotencyKey({ packageId, command, clientRequest, input }) {
  const explicit = typeof input.commandId === 'string' && input.commandId.trim() ? input.commandId.trim() : null;
  const requestId = clientRequest.requestId;
  return explicit || requestId || `${packageId}:${command}`;
}

function buildPersistencePlan({ persistedState, packageId, currentState, command, clientRequest, accessBoundary, providerContracts, commandAdmission, nextAction, lifecycleTransition, acceptance, now, input }) {
  const idempotencyKey = buildIdempotencyKey({ packageId, command, clientRequest, input });
  const desiredState = lifecycleTransition.desiredState;
  const matchingPending = persistedState.pendingCommand
    && commandAdmission.boundary.pendingCommand.ok
    && (persistedState.pendingCommand.commandId === idempotencyKey || (clientRequest.requestId && persistedState.pendingCommand.requestId === clientRequest.requestId))
    && persistedState.pendingCommand.command === command;
  const matchingCommitted = persistedState.lastCommand
    && commandAdmission.boundary.lastCommand.ok
    && persistedState.lastCommand.status === 'committed'
    && (persistedState.lastCommand.commandId === idempotencyKey || (clientRequest.requestId && persistedState.lastCommand.requestId === clientRequest.requestId))
    && persistedState.lastCommand.command === command;
  const matchingPendingRecord = matchingPending ? persistedState.pendingCommand : null;
  const alreadyAtDesiredState = desiredState === currentState && ['start', 'stop', 'disable', 'install'].includes(command);
  const duplicate = Boolean(matchingPending || matchingCommitted);
  const commandStatus = matchingCommitted
    ? 'already-committed'
    : matchingPending
      ? 'resume-existing'
      : alreadyAtDesiredState
        ? 'noop-already-satisfied'
        : acceptance.accepted
          ? 'record-new'
          : 'not-recorded';

  return {
    stateVersion: 1,
    idempotencyKey,
    duplicate,
    commandStatus,
    loadedRevision: persistedState.revision,
    nextRevision: acceptance.accepted && commandStatus === 'record-new' ? persistedState.revision + 1 : persistedState.revision,
    desiredState,
    writeRequired: acceptance.accepted && commandStatus === 'record-new',
    writeBlockedReason: acceptance.accepted ? null : nextAction.reason,
    commandRecord: {
      commandId: idempotencyKey,
      requestId: clientRequest.requestId,
      command,
      status: acceptance.accepted ? 'pending' : 'cancelled',
      desiredState,
      providerId: providerContracts.selectedProviderId,
      attempt: matchingPendingRecord ? matchingPendingRecord.attempt : 0,
      submittedAt: now,
      lastHeartbeatAt: acceptance.accepted ? now : null,
      completedAt: null,
      errorCode: acceptance.accepted ? null : nextAction.reason,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      actorId: accessBoundary.actorId,
      boundary: {
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId,
        actorId: accessBoundary.actorId,
        packageId,
        packageScopeMatchedBy: accessBoundary.packageScope.matchedBy,
        requiredPermissions: accessBoundary.requiredPermissions,
        permissionGranted: accessBoundary.permissionGranted,
        packageAllowed: accessBoundary.packageScope.packageAllowed
      },
      statePatch: {
        lifecycleState: lifecycleTransition.persistenceEffect.lifecycleState,
        enabled: lifecycleTransition.persistenceEffect.enabled,
        scheduleMode: lifecycleTransition.persistenceEffect.scheduleMode,
        writeSettings: lifecycleTransition.persistenceEffect.writeSettings,
        writeLifecycleState: lifecycleTransition.persistenceEffect.writeLifecycleState
      }
    }
  };
}

function commandRecordKey(record) {
  return [
    record?.commandId ?? 'command-unbound',
    record?.requestId ?? 'request-unbound',
    record?.command ?? 'command-unknown',
    record?.boundary?.tenantId ?? record?.tenantId ?? 'tenant-unbound',
    record?.boundary?.workspaceId ?? record?.workspaceId ?? 'workspace-unbound',
    record?.boundary?.packageId ?? record?.packageId ?? 'package-unbound'
  ].join(':');
}

function buildDurableStateCommit({
  packageId,
  persistedState,
  currentState,
  command,
  persistence,
  lifecycleTransition,
  commandAdmission,
  recovery,
  acceptance,
  now
}) {
  const existingPending = persistedState.pendingCommand;
  const expectedRevision = persistedState.revision;
  const shouldCreateRecord = acceptance.accepted && persistence.commandStatus === 'record-new';
  const shouldRefreshResumeLease = acceptance.accepted
    && persistence.commandStatus === 'resume-existing'
    && Boolean(existingPending)
    && commandAdmission.boundary.pendingCommand.ok;
  const shouldClearSatisfiedPending = acceptance.accepted
    && persistence.commandStatus === 'noop-already-satisfied'
    && existingPending?.command === command
    && existingPending.desiredState === currentState;
  const writeRequired = shouldCreateRecord || shouldRefreshResumeLease || shouldClearSatisfiedPending;
  const nextRevision = writeRequired ? expectedRevision + 1 : expectedRevision;
  const pendingCommand = shouldCreateRecord
    ? persistence.commandRecord
    : shouldRefreshResumeLease
      ? {
          ...existingPending,
          status: existingPending.status === 'applying' ? 'applying' : 'pending',
          lastHeartbeatAt: now,
          attempt: commandAdmission.retryPlan.nextAttempt,
          resumeOfCommandId: existingPending.commandId,
          recoveryStatusAtResume: recovery.status
        }
      : shouldClearSatisfiedPending
        ? null
        : existingPending;
  const lifecycleState = shouldCreateRecord && lifecycleTransition.persistenceEffect.writeLifecycleState
    ? lifecycleTransition.persistenceEffect.lifecycleState
    : persistedState.lifecycleState;
  const enabled = shouldCreateRecord
    ? lifecycleTransition.persistenceEffect.enabled
    : persistedState.enabled;
  const statePatch = writeRequired
    ? {
        stateVersion: 1,
        packageId,
        revision: nextRevision,
        lifecycleState,
        enabled,
        lastUpdatedAt: now,
        pendingCommand,
        lastCommand: persistedState.lastCommand,
        commandHistory: persistedState.commandHistory
      }
    : null;
  const compareAndSwap = {
    key: `${surfaceId}:${packageId}:state`,
    expectedRevision,
    nextRevision,
    expectedPendingCommandKey: existingPending ? commandRecordKey(existingPending) : null,
    nextPendingCommandKey: pendingCommand ? commandRecordKey(pendingCommand) : null,
    requiresPendingMatch: shouldRefreshResumeLease || shouldClearSatisfiedPending,
    conflictAction: shouldRefreshResumeLease
      ? 'reload-before-resume'
      : shouldCreateRecord
        ? 'reload-before-create'
        : 'none'
  };
  const restartSemantics = {
    durableStatus: writeRequired
      ? shouldRefreshResumeLease
        ? 'resume-lease-refreshed'
        : shouldClearSatisfiedPending
          ? 'satisfied-pending-cleared'
          : 'new-command-record-shaped'
      : acceptance.accepted
        ? persistence.commandStatus
        : 'blocked-no-write',
    restartSafeStatus: recovery.status,
    recoveryAction: recovery.recoveryAction,
    pendingCommandId: pendingCommand?.commandId ?? null,
    pendingCommandStatus: pendingCommand?.status ?? null,
    heartbeatWrittenAt: shouldCreateRecord || shouldRefreshResumeLease ? now : pendingCommand?.lastHeartbeatAt ?? null,
    replayPolicy: persistence.duplicate ? 'idempotent-replay' : 'new-command',
    idempotencyKey: persistence.idempotencyKey
  };

  return {
    contractVersion: 1,
    storageModel: 'hosted-kernel-driver-package-state/v1',
    packageId,
    evaluatedAt: now,
    writeRequired,
    writeMode: shouldCreateRecord
      ? 'create-pending-command'
      : shouldRefreshResumeLease
        ? 'refresh-resume-lease'
        : shouldClearSatisfiedPending
          ? 'clear-satisfied-pending-command'
          : acceptance.accepted
            ? 'idempotent-noop'
            : 'blocked-noop',
    compareAndSwap,
    statePatch,
    restartSemantics,
    auditEvent: {
      eventType: 'driver-package.persistence.state_commit_prepared',
      occurredAt: now,
      packageId,
      command,
      commandId: persistence.idempotencyKey,
      writeMode: shouldCreateRecord
        ? 'create-pending-command'
        : shouldRefreshResumeLease
          ? 'refresh-resume-lease'
          : shouldClearSatisfiedPending
            ? 'clear-satisfied-pending-command'
            : acceptance.accepted
              ? 'idempotent-noop'
              : 'blocked-noop',
      expectedRevision,
      nextRevision,
      restartSafeStatus: recovery.status,
      recoveryAction: recovery.recoveryAction
    },
    proofClaims: {
      revisionMonotonic: nextRevision >= expectedRevision,
      writeRequiresAcceptedCommand: !writeRequired || acceptance.accepted,
      compareAndSwapBound: Boolean(compareAndSwap.key) && Number.isInteger(compareAndSwap.expectedRevision),
      resumeLeaseRefreshesHeartbeat: !shouldRefreshResumeLease || pendingCommand?.lastHeartbeatAt === now,
      pendingBoundaryCheckedBeforeResume: !shouldRefreshResumeLease || commandAdmission.boundary.pendingCommand.ok,
      blockedCommandsDoNotMutateState: acceptance.accepted || !writeRequired,
      idempotentDuplicatesAvoidNewCommandRecord: persistence.duplicate ? !shouldCreateRecord : true,
      restartStatusExplained: Boolean(restartSemantics.restartSafeStatus && restartSemantics.recoveryAction)
    }
  };
}

function buildKernelExecutionContract({
  packageId,
  currentState,
  command,
  schedule,
  settings,
  clientRequest,
  accessBoundary,
  providerContracts,
  persistence,
  commandAdmission,
  lifecycleTransition,
  scheduleActivation,
  acceptance,
  now
}) {
  const dispatch = providerContracts.selectedDispatch;
  const dispatchRequired = command !== 'schedule' || scheduleActivation.canArmDispatch;
  const blockedReason = acceptance.accepted
    ? null
    : providerContracts.ok
      ? 'command_not_accepted'
      : 'provider_dispatch_unavailable';
  const commandEnvelope = dispatchRequired && dispatch && acceptance.accepted
    ? {
        envelopeVersion: 1,
        commandId: persistence.idempotencyKey,
        packageId,
        command,
        desiredState: persistence.desiredState,
        currentState,
        submittedAt: now,
        actorId: clientRequest.actorId,
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId,
        requestId: clientRequest.requestId,
        route: dispatch.route,
        authMode: dispatch.auth.mode,
        delivery: dispatch.delivery,
        boundary: {
          tenantId: accessBoundary.tenantId,
          workspaceId: accessBoundary.workspaceId,
          actorId: accessBoundary.actorId,
          requiredPermissions: accessBoundary.requiredPermissions,
          packageScope: {
            packageId: accessBoundary.packageScope.packageId,
            scoped: accessBoundary.packageScope.scoped,
            matchedBy: accessBoundary.packageScope.matchedBy,
            allowed: accessBoundary.packageScope.packageAllowed
          }
        },
        schedule,
        settings: {
          maxConcurrency: settings.maxConcurrency,
          restartRetries: settings.restartRetries,
          retryBackoffBaseMs: settings.retryBackoffBaseMs,
          healthcheckTimeoutMs: settings.healthcheckTimeoutMs,
          proofMode: settings.proofMode
        },
        sync: {
          generation: dispatch.syncGeneration,
          status: dispatch.syncStatus,
          scopes: dispatch.serviceContract.syncScopes
        },
        acknowledgement: {
          required: dispatch.acknowledgement.required,
          mode: dispatch.acknowledgement.mode,
          status: dispatch.acknowledgement.status,
          ackRef: dispatch.acknowledgement.ackRef,
          callbackUrl: dispatch.acknowledgement.callbackUrl,
          timeoutMs: dispatch.acknowledgement.timeoutMs,
          pollRequired: dispatch.acknowledgement.pollRequired
        },
        serviceContract: {
          name: dispatch.serviceContract.name,
          version: dispatch.serviceContract.version,
          operation: dispatch.serviceContract.operation,
        handoffLeaseId: dispatch.serviceContract.handoffLeaseId
        },
        capabilityPolicy: {
          mode: dispatch.capabilityPolicy.mode,
          effectiveCapabilities: dispatch.capabilityPolicy.effectiveCapabilities,
          matchedGrantIds: dispatch.capabilityPolicy.matchedGrantIds,
          scopedRequiredCapabilities: dispatch.capabilityPolicy.scopedRequiredCapabilities,
          missingRequiredCapabilities: dispatch.capabilityPolicy.missingRequiredCapabilities
        },
        lifecycleTransition: {
          from: lifecycleTransition.currentState,
          to: lifecycleTransition.desiredState,
          enabledBefore: lifecycleTransition.enabledBefore,
          enabledAfter: lifecycleTransition.enabledAfter,
          scheduleMode: lifecycleTransition.persistenceEffect.scheduleMode,
          persistenceEffect: lifecycleTransition.persistenceEffect
        },
        admissionBoundary: {
          replayProtected: commandAdmission.boundary.replayProtected,
          persistedBoundaryOk: commandAdmission.boundary.ok,
          pendingCommandBoundary: commandAdmission.boundary.pendingCommand.persisted,
          pendingCommandBoundaryMismatches: commandAdmission.boundary.pendingCommand.mismatches
        }
      }
    : null;

  return {
    contractVersion: 1,
    state: acceptance.accepted
      ? dispatchRequired
        ? 'dispatch-ready'
        : 'persistence-ready'
      : 'blocked',
    blockedReason,
    dispatchRequired,
    providerId: providerContracts.selectedProviderId,
    serviceId: providerContracts.selectedServiceId,
    dispatchRoute: dispatch?.route ?? null,
    acknowledgement: dispatch?.acknowledgement ?? null,
    dispatchWarnings: dispatch?.warnings ?? [],
    commandEnvelope,
    requiredAuditEvents: [
      'driver-package.lifecycle.evaluated',
      acceptance.accepted
        ? dispatchRequired
          ? 'driver-package.command.dispatch.requested'
          : 'driver-package.schedule.inactive_saved'
        : 'driver-package.command.dispatch.blocked'
    ],
    proofClaims: {
      dispatchReady: dispatchRequired ? Boolean(dispatch && acceptance.accepted) : false,
      persistenceOnlyAccepted: acceptance.accepted && !dispatchRequired,
      idempotentCommand: persistence.commandStatus !== 'not-recorded',
      providerAuthorized: Boolean(dispatch?.auth.required ? dispatch.auth.mode !== 'none' : true),
      routeBound: Boolean(dispatch?.route.target),
      providerAcknowledgementReady: Boolean(dispatch?.acknowledgement.mode && dispatch.acknowledgement.status !== 'rejected' && dispatch.acknowledgement.status !== 'timed-out'),
      serviceContractNegotiated: Boolean(dispatch?.serviceContract.version),
      serviceOperationBound: Boolean(dispatch?.serviceContract.operation),
      providerCapabilityScopeSatisfied: Boolean(dispatch?.capabilityPolicy.missingRequiredCapabilities.length === 0),
      providerCapabilityGrantMatched: Boolean(dispatch?.capabilityPolicy.matchedGrantIds.length || dispatch?.capabilityPolicy.mode !== 'scoped-only'),
      tenantBoundaryBound: Boolean(accessBoundary.tenantId),
      workspaceBoundaryBound: Boolean(accessBoundary.workspaceId),
      actorPermissionGranted: accessBoundary.permissionGranted,
      workspacePackageScopeAllowed: accessBoundary.packageScope.packageAllowed,
      workspacePackageScopeMatchedBy: accessBoundary.packageScope.matchedBy,
      persistedCommandBoundarySafe: commandAdmission.boundary.ok,
      persistedCommandBoundaryReplayProtected: commandAdmission.boundary.replayProtected,
      commandAdmitted: commandAdmission.admitted,
      commandAdmissionState: commandAdmission.state,
      lifecycleTransitionAllowed: lifecycleTransition.transitionAllowed,
      lifecycleTransitionState: lifecycleTransition.nextActionState
    }
  };
}

function buildRecoveryStatus({ persistedState, currentState, command, now }) {
  const pending = persistedState.pendingCommand;
  const inFlight = pending && ['pending', 'applying'].includes(pending.status);
  const heartbeatMs = pending?.lastHeartbeatAt ? Date.parse(pending.lastHeartbeatAt) : null;
  const nowMs = Date.parse(now);
  const heartbeatAgeMs = heartbeatMs && !Number.isNaN(nowMs) ? Math.max(0, nowMs - heartbeatMs) : null;
  const heartbeatExpired = heartbeatAgeMs !== null && heartbeatAgeMs > 120000;
  const transitionalState = ['starting', 'stopping'].includes(currentState);
  const restartDetected = inFlight || transitionalState;
  const shouldResume = Boolean(inFlight && (heartbeatExpired || persistedState.lifecycleState !== currentState || command === 'restart'));

  return {
    restartSafe: true,
    status: shouldResume ? 'resume-pending-command' : restartDetected ? 'observe-in-flight' : 'stable',
    persistedLifecycleState: persistedState.lifecycleState,
    observedLifecycleState: currentState,
    pendingCommandId: pending?.commandId ?? null,
    pendingCommand: pending?.command ?? null,
    pendingStatus: pending?.status ?? null,
    heartbeatAgeMs,
    heartbeatExpired,
    shouldResume,
    recoveryAction: shouldResume
      ? 'rehydrate-pending-command'
      : restartDetected
        ? 'wait-for-provider-heartbeat'
      : 'none'
  };
}

function evaluatePersistedCommandBoundary(commandRecord, accessBoundary, packageId) {
  if (!commandRecord) {
    return {
      checked: false,
      ok: true,
      reason: 'no-command-record',
      mismatches: [],
      persisted: null
    };
  }

  const boundary = commandRecord.boundary ?? normalizePersistedCommandBoundary(commandRecord);
  const expected = {
    tenantId: accessBoundary.tenantId,
    workspaceId: accessBoundary.workspaceId,
    packageId
  };
  const comparisons = [
    ['tenantId', boundary.tenantId, expected.tenantId],
    ['workspaceId', boundary.workspaceId, expected.workspaceId],
    ['packageId', boundary.packageId, expected.packageId]
  ];
  const mismatches = comparisons
    .filter(([, persisted, requested]) => persisted && requested && persisted !== requested)
    .map(([field, persisted, requested]) => ({ field, persisted, requested }));
  const missingIsolation = commandRequiresKernelMutation(commandRecord.command)
    && boundary.supplied
    && (!boundary.tenantId || !boundary.workspaceId);

  if (missingIsolation) {
    mismatches.push({
      field: boundary.tenantId ? 'workspaceId' : 'tenantId',
      persisted: boundary.tenantId ? null : boundary.tenantId,
      requested: boundary.tenantId ? expected.workspaceId : expected.tenantId
    });
  }

  return {
    checked: true,
    ok: mismatches.length === 0,
    reason: mismatches.length === 0 ? 'boundary-compatible' : 'persisted-boundary-mismatch',
    mismatches,
    persisted: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId,
      packageId: boundary.packageId,
      packageScopeMatchedBy: boundary.packageScopeMatchedBy,
      isolated: boundary.isolated,
      supplied: boundary.supplied
    },
    expected
  };
}

function buildCommandAdmission({ persistedState, idempotencyKey, clientRequest, command, settings, now, accessBoundary, packageId }) {
  const pending = persistedState.pendingCommand;
  const lastCommand = persistedState.lastCommand;
  const mutatingCommand = commandRequiresKernelMutation(command);
  const pendingInFlight = Boolean(pending && ['pending', 'applying'].includes(pending.status));
  const pendingBoundary = evaluatePersistedCommandBoundary(pending, accessBoundary, packageId);
  const lastCommandBoundary = evaluatePersistedCommandBoundary(lastCommand, accessBoundary, packageId);
  const pendingBoundaryMismatch = Boolean(pendingInFlight && !pendingBoundary.ok);
  const samePendingCommand = Boolean(pendingInFlight && pending.command === command && pendingBoundary.ok);
  const samePendingRequest = Boolean(pendingInFlight && (
    pending.commandId === idempotencyKey
    || (clientRequest.requestId && pending.requestId === clientRequest.requestId)
  ) && pendingBoundary.ok);
  const conflictingPending = Boolean(pendingInFlight && !samePendingRequest && pending.command !== command);
  const concurrencySlots = mutatingCommand ? settings.maxConcurrency : 0;
  const slotAvailable = !mutatingCommand || !pendingInFlight || samePendingRequest || concurrencySlots > 1;
  const pendingAdmissionCollision = Boolean(pendingInFlight && !samePendingRequest && !slotAvailable);
  const retryPlan = buildRetryBackoffPlan({ lastCommand: lastCommandBoundary.ok ? lastCommand : null, command, settings, now });
  const issues = [];
  const warnings = [];

  if (pendingBoundaryMismatch) {
    issues.push({
      code: 'command_admission.persisted_boundary_mismatch',
      message: 'An in-flight hosted-kernel command belongs to a different tenant, workspace, or package boundary.',
      pendingCommandId: pending.commandId,
      pendingCommand: pending.command,
      mismatches: pendingBoundary.mismatches
    });
  }
  if (pendingAdmissionCollision) {
    issues.push({
      code: conflictingPending ? 'command_admission.pending_conflict' : 'command_admission.pending_duplicate',
      message: conflictingPending
        ? 'A different hosted-kernel lifecycle command is already in flight for this driver package.'
        : 'A hosted-kernel lifecycle command is already in flight and no additional concurrency slot is available.',
      pendingCommandId: pending.commandId,
      pendingCommand: pending.command
    });
  }
  if (!retryPlan.budgetAvailable) {
    issues.push({
      code: 'command_admission.retry_budget_exceeded',
      message: 'The hosted-kernel driver command has exhausted its configured retry budget.',
      lastCommandId: lastCommand.commandId,
      nextAttempt: retryPlan.nextAttempt,
      restartRetries: settings.restartRetries
    });
  }
  if (retryPlan.cooldownActive) {
    issues.push({
      code: 'command_admission.retry_backoff_active',
      message: 'The hosted-kernel driver command is waiting for retry backoff before another attempt can be admitted.',
      lastCommandId: lastCommand.commandId,
      retryAfterAt: retryPlan.retryAfterAt,
      delayMs: retryPlan.delayMs,
      lastErrorCode: retryPlan.lastErrorCode
    });
  }
  if (pendingInFlight && samePendingRequest) {
    warnings.push({
      code: 'command_admission.idempotent_resume',
      message: 'The requested command matches an in-flight command and will reuse the existing admission slot.',
      pendingCommandId: pending.commandId
    });
  }
  if (pendingInFlight && samePendingCommand && !samePendingRequest && slotAvailable) {
    warnings.push({
      code: 'command_admission.parallel_same_command',
      message: 'A matching command is already in flight; hosted-kernel admission allows another slot because maxConcurrency permits it.',
      pendingCommandId: pending.commandId,
      maxConcurrency: settings.maxConcurrency
    });
  }
  if (lastCommand && !lastCommandBoundary.ok) {
    warnings.push({
      code: 'command_admission.last_command_boundary_ignored',
      message: 'Last command retry state was ignored because it belongs to a different boundary.',
      lastCommandId: lastCommand.commandId,
      mismatches: lastCommandBoundary.mismatches
    });
  }

  return {
    contractVersion: 1,
    admitted: issues.length === 0,
    state: issues.length === 0
      ? pendingInFlight && samePendingRequest
        ? 'resume-existing'
        : pendingInFlight
          ? 'admitted-with-inflight-command'
          : 'admitted'
      : 'blocked',
    idempotencyKey,
    evaluatedAt: now,
    maxConcurrency: settings.maxConcurrency,
    availableConcurrencySlots: slotAvailable ? Math.max(0, concurrencySlots - (pendingInFlight && !samePendingRequest ? 1 : 0)) : 0,
    boundary: {
      ok: !pendingBoundaryMismatch,
      pendingCommand: pendingBoundary,
      lastCommand: lastCommandBoundary,
      replayProtected: mutatingCommand
    },
    pendingCommand: pendingInFlight
      ? {
          commandId: pending.commandId,
          requestId: pending.requestId,
          command: pending.command,
          status: pending.status,
          desiredState: pending.desiredState,
          providerId: pending.providerId,
          attempt: pending.attempt,
          lastHeartbeatAt: pending.lastHeartbeatAt,
          boundary: pendingBoundary.persisted
        }
      : null,
    retryPlan,
    issues,
    warnings
  };
}

function normalizeProviderContracts(providers = [], command, schedule, now, accessBoundary, settings) {
  const rawProviders = Array.isArray(providers) ? providers : [];
  const requiredCapabilities = capabilitiesForCommand(command, schedule);
  const normalized = rawProviders.map((provider, index) => {
    const raw = provider && typeof provider === 'object' ? provider : {};
    const rawBoundary = raw.boundary && typeof raw.boundary === 'object' ? raw.boundary : {};
    const providerId = typeof raw.providerId === 'string' && raw.providerId.trim() ? raw.providerId.trim() : `provider-${index + 1}`;
    const serviceId = typeof raw.serviceId === 'string' && raw.serviceId.trim() ? raw.serviceId.trim() : 'hosted-kernel-driver-service';
    const state = providerStates.has(raw.state) ? raw.state : 'offline';
    const authMode = providerAuthModes.has(raw.authMode) ? raw.authMode : 'handoff';
    const capabilities = normalizeCapabilityList(raw.capabilities, defaultProviderCapabilities);
    const endpoint = typeof raw.endpoint === 'string' && raw.endpoint.trim() ? raw.endpoint.trim() : null;
    const sync = normalizeSyncState(raw.sync);
    const health = normalizeProviderHealth(raw, command, now);
    const serviceContract = normalizeProviderServiceContract(raw, command, schedule, now);
    const acknowledgement = normalizeProviderAcknowledgement(raw, command, now, settings);
    const providerBoundary = {
      tenantIds: normalizeStringList(rawBoundary.tenantIds ?? raw.allowedTenantIds),
      workspaceIds: normalizeStringList(rawBoundary.workspaceIds ?? raw.allowedWorkspaceIds)
    };
    const capabilityPolicy = normalizeProviderCapabilityPolicy(raw, capabilities, requiredCapabilities, accessBoundary, accessBoundary.packageScope.packageId, now);
    const missingCapabilities = capabilityPolicy.missingRequiredCapabilities;
    const dispatch = buildProviderDispatchProfile({
      providerId,
      serviceId,
      state,
      authMode,
      endpoint,
      sync,
      serviceContract,
      providerBoundary,
      capabilityPolicy,
      health,
      acknowledgement
    }, requiredCapabilities, command, schedule, accessBoundary);
    const stateAllowsDispatch = state === 'ready' || (state === 'degraded' && health.degradedMode && health.degradedModeAllowsCommand);
    return {
      providerId,
      serviceId,
      state,
      authMode,
      endpoint,
      capabilities,
      effectiveCapabilities: capabilityPolicy.effectiveCapabilities,
      missingCapabilities,
      capabilityPolicy,
      boundary: providerBoundary,
      sync,
      health,
      serviceContract,
      acknowledgement,
      dispatch,
      canServe: stateAllowsDispatch && missingCapabilities.length === 0 && capabilityPolicy.ok && health.ok && serviceContract.ok && acknowledgement.ok && dispatch.dispatchReady
    };
  });

  const selected = normalized.find((provider) => provider.canServe) || null;
  const dispatchIssueCount = normalized.reduce((count, provider) => count + provider.dispatch.issues.length, 0);
  const dispatchWarningCount = normalized.reduce((count, provider) => count + provider.dispatch.warnings.length, 0);
  const serviceContractIssueCount = normalized.reduce((count, provider) => count + provider.serviceContract.issues.length, 0);
  const acknowledgementIssueCount = normalized.reduce((count, provider) => count + provider.acknowledgement.issues.length, 0);
  const acknowledgementWarningCount = normalized.reduce((count, provider) => count + provider.acknowledgement.warnings.length, 0);
  const healthIssueCount = normalized.reduce((count, provider) => count + provider.health.issues.length, 0);
  const healthWarningCount = normalized.reduce((count, provider) => count + provider.health.warnings.length, 0);
  const capabilityScopeIssueCount = normalized.reduce((count, provider) => count + provider.capabilityPolicy.issues.length, 0);
  const capabilityScopeWarningCount = normalized.reduce((count, provider) => count + provider.capabilityPolicy.warnings.length, 0);
  return {
    requiredCapabilities,
    requiredServiceOperation: serviceOperationForCommand(command),
    selectedProviderId: selected?.providerId ?? null,
    selectedServiceId: selected?.serviceId ?? null,
    selectedDispatch: selected?.dispatch ?? null,
    providers: normalized,
    ok: Boolean(selected),
    missingCapabilities: selected ? [] : requiredCapabilities.filter((capability) => !normalized.some((provider) => provider.capabilities.includes(capability))),
    dispatchIssueCount,
    dispatchWarningCount,
    serviceContractIssueCount,
    acknowledgementIssueCount,
    acknowledgementWarningCount,
    healthIssueCount,
    healthWarningCount,
    capabilityScopeIssueCount,
    capabilityScopeWarningCount,
    dispatchBlockedProviderIds: normalized
      .filter((provider) => provider.missingCapabilities.length === 0 && !provider.dispatch.dispatchReady)
      .map((provider) => provider.providerId),
    capabilityScopeBlockedProviderIds: normalized
      .filter((provider) => provider.capabilityPolicy.issues.length > 0 || provider.capabilityPolicy.missingRequiredCapabilities.length > 0)
      .map((provider) => provider.providerId),
    serviceContractBlockedProviderIds: normalized
      .filter((provider) => provider.missingCapabilities.length === 0 && !provider.serviceContract.ok)
      .map((provider) => provider.providerId),
    acknowledgementBlockedProviderIds: normalized
      .filter((provider) => provider.missingCapabilities.length === 0 && !provider.acknowledgement.ok)
      .map((provider) => provider.providerId),
    degradedProviderCount: normalized.filter((provider) => provider.state === 'degraded').length,
    healthDegradedProviderCount: normalized.filter((provider) => provider.health.degradedMode).length,
    healthFailedProviderCount: normalized.filter((provider) => provider.health.status === 'fail').length,
    staleHealthProviderCount: normalized.filter((provider) => provider.health.stale).length,
    offlineProviderCount: normalized.filter((provider) => provider.state === 'offline').length
  };
}

function buildExternalHandoff({ command, providerContracts, packageId, now }) {
  if (providerContracts.ok) {
    return {
      required: false,
      state: 'bound',
      providerId: providerContracts.selectedProviderId,
      serviceId: providerContracts.selectedServiceId,
      reason: 'provider_capabilities_satisfied',
      capabilityScopeBlockedProviderIds: []
    };
  }
  const dispatchBlocked = providerContracts.dispatchBlockedProviderIds.length > 0;
  const capabilityScopeBlocked = providerContracts.capabilityScopeBlockedProviderIds.length > 0;
  const healthBlocked = providerContracts.healthIssueCount > 0;
  const acknowledgementBlocked = providerContracts.acknowledgementIssueCount > 0;
  return {
    required: true,
    state: providerContracts.providers.length
      ? healthBlocked
        ? 'provider-health-not-ready'
        : acknowledgementBlocked
          ? 'provider-acknowledgement-not-ready'
          : capabilityScopeBlocked
            ? 'provider-capability-scope-not-ready'
        : dispatchBlocked
        ? providerContracts.serviceContractBlockedProviderIds.length
          ? 'provider-service-contract-not-ready'
          : 'provider-dispatch-not-ready'
        : 'provider-capability-gap'
      : 'provider-unbound',
    providerId: null,
    serviceId: 'hosted-kernel-driver-service',
    reason: providerContracts.providers.length
      ? healthBlocked
        ? 'provider_health_not_ready'
        : acknowledgementBlocked
          ? 'provider_acknowledgement_not_ready'
          : capabilityScopeBlocked
            ? 'provider_capability_scope_not_satisfied'
        : dispatchBlocked
        ? providerContracts.serviceContractBlockedProviderIds.length
          ? 'provider_service_contract_not_negotiated'
          : 'provider_dispatch_contract_not_ready'
        : 'no_provider_satisfies_required_capabilities'
      : 'no_provider_contract_supplied',
    handoffRef: `${surfaceId}:${packageId}:${command}:${now}`,
    missingCapabilities: providerContracts.missingCapabilities,
    capabilityScopeBlockedProviderIds: providerContracts.capabilityScopeBlockedProviderIds,
    dispatchBlockedProviderIds: providerContracts.dispatchBlockedProviderIds,
    serviceContractBlockedProviderIds: providerContracts.serviceContractBlockedProviderIds,
    acknowledgementBlockedProviderIds: providerContracts.acknowledgementBlockedProviderIds,
    healthBlockedProviderIds: providerContracts.providers
      .filter((provider) => provider.health.issues.length > 0)
      .map((provider) => provider.providerId),
    requiredServiceOperation: providerContracts.requiredServiceOperation
  };
}

function workflowMutationTarget({ clientRequest, externalHandoff, nextAction }) {
  if (externalHandoff.required && nextAction.type === 'handoff-provider-contract') {
    return {
      surface: 'provider-binding',
      action: 'open-provider-handoff',
      ref: externalHandoff.handoffRef,
      returnTo: clientRequest.returnTo
    };
  }
  if (nextAction.blocked) {
    return {
      surface: 'driver-package-workflow',
      action: nextAction.type,
      ref: null,
      returnTo: clientRequest.returnTo
    };
  }
  return {
    surface: 'driver-package-submit',
    action: 'submit-driver-package-command',
    ref: null,
    returnTo: clientRequest.returnTo
  };
}

function buildClientResumeContract({
  clientRequest,
  packageId,
  command,
  workflowId,
  workflowState,
  resumeToken,
  handoffRef,
  acceptedRef,
  target,
  requiresUserAction,
  acceptance,
  persistence,
  now
}) {
  const state = clientRequest.clientState;
  const previousWorkflowId = state.pendingWorkflow ?? state.lastWorkflowId;
  const continuesPreviousWorkflow = Boolean(previousWorkflowId && previousWorkflowId === workflowId);
  const staleResumeToken = Boolean(state.lastResumeToken && state.lastResumeToken !== resumeToken && continuesPreviousWorkflow);
  const commandChanged = Boolean(state.lastCommandId && state.lastCommandId !== persistence.idempotencyKey && continuesPreviousWorkflow);
  const handoffChanged = Boolean(state.lastHandoffRef && handoffRef && state.lastHandoffRef !== handoffRef);
  const resumeMode = acceptance.accepted
    ? persistence.commandStatus === 'resume-existing'
      ? 'resume-dispatch'
      : 'submit-dispatch'
    : continuesPreviousWorkflow
      ? 'resume-attention'
      : 'start-attention';
  const routeIntent = target.action === 'open-provider-handoff'
    ? 'open-provider-handoff'
    : target.action === 'submit-driver-package-command'
      ? 'submit-command'
      : 'repair-workflow';
  const issues = [];
  const warnings = [];

  if (staleResumeToken) {
    warnings.push({
      code: 'client_workflow.resume_token_rotated',
      message: 'Client resume token changed for the existing workflow; the stored token should be replaced.',
      previousResumeToken: state.lastResumeToken,
      nextResumeToken: resumeToken
    });
  }
  if (commandChanged && requiresUserAction) {
    issues.push({
      code: 'client_workflow.command_changed',
      message: 'Client is resuming a workflow with a different command id and must reconcile before handoff.',
      previousCommandId: state.lastCommandId,
      nextCommandId: persistence.idempotencyKey
    });
  }
  if (handoffChanged) {
    warnings.push({
      code: 'client_workflow.handoff_ref_rotated',
      message: 'Provider handoff reference changed and the client should replace the cached handoff link.',
      previousHandoffRef: state.lastHandoffRef,
      nextHandoffRef: handoffRef
    });
  }

  return {
    contractVersion: 1,
    evaluatedAt: now,
    packageId,
    command,
    workflowId,
    workflowState,
    resumeMode,
    routeIntent,
    targetSurface: target.surface,
    targetAction: target.action,
    requiresUserAction,
    continuesPreviousWorkflow,
    previousWorkflowId: previousWorkflowId ?? null,
    previousWorkflowState: state.lastWorkflowState,
    previousCommandStatus: state.lastCommandStatus,
    resumeToken,
    handoffRef,
    acceptedRef,
    routePayload: {
      packageId,
      command,
      requestId: clientRequest.requestId,
      actorId: clientRequest.actorId,
      workspaceId: clientRequest.workspaceId,
      resumeToken,
      returnTo: clientRequest.returnTo,
      commandId: persistence.idempotencyKey,
      commandStatus: persistence.commandStatus
    },
    issues,
    warnings,
    ok: issues.length === 0,
    proofClaims: {
      workflowContinuityChecked: Boolean(previousWorkflowId),
      routeIntentBound: Boolean(routeIntent),
      resumeTokenCurrent: !staleResumeToken,
      commandIdStableForResume: !commandChanged,
      handoffRefCurrent: !handoffChanged,
      acceptedRefBoundWhenAccepted: acceptance.accepted ? Boolean(acceptedRef) : true,
      userActionMatchesAcceptance: requiresUserAction !== acceptance.accepted
    }
  };
}

function buildClientWorkflowMutation({
  clientRequest,
  packageId,
  command,
  workflowId,
  workflowState,
  resumeToken,
  externalHandoff,
  nextAction,
  acceptance,
  persistence,
  now
}) {
  const target = workflowMutationTarget({ clientRequest, externalHandoff, nextAction });
  const requiresUserAction = !acceptance.accepted;
  const pendingWorkflow = requiresUserAction ? workflowId : null;
  const providerHandoffRequired = externalHandoff.required && nextAction.type === 'handoff-provider-contract';
  const handoffRef = providerHandoffRequired ? externalHandoff.handoffRef : clientRequest.clientState.lastHandoffRef;
  const acceptedRef = acceptance.accepted ? acceptance.acceptRef : clientRequest.clientState.lastAcceptedRef;
  const optimisticDispatch = acceptance.accepted && clientRequest.clientState.optimistic;
  const resumeContract = buildClientResumeContract({
    clientRequest,
    packageId,
    command,
    workflowId,
    workflowState,
    resumeToken,
    handoffRef,
    acceptedRef,
    target,
    requiresUserAction,
    acceptance,
    persistence,
    now
  });

  return {
    contractVersion: 1,
    operation: 'merge-client-driver-workflow-state',
    storageKey: [
      surfaceId,
      clientRequest.workspaceId ?? 'workspace-unbound',
      clientRequest.actorId,
      packageId
    ].join(':'),
    channel: clientRequest.channel,
    intent: clientRequest.intent,
    optimisticDispatch,
    statePatch: {
      pendingWorkflow,
      lastWorkflowId: workflowId,
      lastWorkflowState: workflowState,
      lastResumeToken: resumeToken,
      lastHandoffRef: handoffRef,
      lastAcceptedRef: acceptedRef,
      lastCommandId: persistence.idempotencyKey,
      lastCommandStatus: persistence.commandStatus,
      lastDecision: acceptance.decision,
      lastUpdatedAt: now
    },
    route: {
      ...target,
      packageId,
      command,
      requestId: clientRequest.requestId,
      resumeToken,
      blocked: nextAction.blocked,
      reason: nextAction.reason
    },
    resumeContract,
    userVisibleState: {
      status: workflowState,
      action: requiresUserAction
        ? nextAction.type
        : nextAction.type === 'save-schedule-disabled'
          ? 'schedule-save-ready'
          : 'dispatch-ready',
      canResume: requiresUserAction,
      canSubmit: acceptance.accepted,
      providerHandoffRequired,
      commandStatus: persistence.commandStatus
    },
    auditEvent: {
      eventType: 'driver-package.workflow.client_state_prepared',
      occurredAt: now,
      packageId,
      command,
      workflowId,
      decision: acceptance.decision,
      commandId: persistence.idempotencyKey,
      handoffRef,
      acceptedRef,
      resumeMode: resumeContract.resumeMode,
      routeIntent: resumeContract.routeIntent,
      resumeIssues: resumeContract.issues.map((issue) => issue.code),
      resumeWarnings: resumeContract.warnings.map((warning) => warning.code)
    },
    proofClaims: {
      workflowIdBound: Boolean(workflowId),
      resumeTokenBound: Boolean(resumeToken),
      commandIdBound: Boolean(persistence.idempotencyKey),
      handoffRefCarriedForward: Boolean(handoffRef),
      acceptedRefCarriedForward: Boolean(acceptedRef),
      pendingWorkflowReflectsUserAction: requiresUserAction ? pendingWorkflow === workflowId : pendingWorkflow === null,
      optimisticDispatchAllowed: optimisticDispatch,
      clientResumeContractOk: resumeContract.ok,
      clientRouteIntentBound: resumeContract.proofClaims.routeIntentBound,
      clientCommandIdStableForResume: resumeContract.proofClaims.commandIdStableForResume
    }
  };
}

function buildWorkflowHandoff({ clientRequest, packageId, command, externalHandoff, nextAction, validationSummary, commandAdmission, acceptance, persistence, now }) {
  const workflowId = clientRequest.clientState.pendingWorkflow
    || clientRequest.requestId
    || `${surfaceId}:${packageId}:${clientRequest.channel}:${now}`;
  const blockedByProvider = externalHandoff.required && nextAction.type === 'handoff-provider-contract';
  const blockedByInput = validationSummary.configurationIssueCount > 0;
  const blockedByBoundary = validationSummary.boundaryIssueCount > 0;
  const blockedByAdmission = validationSummary.commandAdmissionIssueCount > 0;
  const state = acceptance.accepted
    ? 'ready-to-submit'
    : blockedByInput
      ? 'needs-client-repair'
      : blockedByBoundary
        ? 'needs-access-boundary'
        : blockedByAdmission
          ? 'needs-command-admission'
          : blockedByProvider
            ? 'needs-provider-binding'
            : 'awaiting-user-choice';
  const resumeToken = `${workflowId}:${command}:${acceptance.decision}`;
  const clientMutation = buildClientWorkflowMutation({
    clientRequest,
    packageId,
    command,
    workflowId,
    workflowState: state,
    resumeToken,
    externalHandoff,
    nextAction,
    acceptance,
    persistence,
    now
  });

  return {
    workflowId,
    channel: clientRequest.channel,
    intent: clientRequest.intent,
    actorId: clientRequest.actorId,
    workspaceId: clientRequest.workspaceId,
    state,
    resumeToken,
    returnTo: clientRequest.returnTo,
    handoffRef: blockedByProvider ? externalHandoff.handoffRef : clientRequest.clientState.lastHandoffRef,
    acceptedRef: acceptance.accepted ? acceptance.acceptRef : clientRequest.clientState.lastAcceptedRef,
    requiresUserAction: !acceptance.accepted,
    userAction: blockedByInput
      ? 'repair-driver-package-inputs'
      : blockedByBoundary
        ? 'resolve-driver-package-boundary'
        : blockedByAdmission
          ? 'resolve-hosted-kernel-command-admission'
          : blockedByProvider
            ? 'bind-hosted-kernel-provider'
            : nextAction.blocked
              ? 'choose-supported-lifecycle-action'
              : 'confirm-lifecycle-submit',
    clientMutation,
    resumeContext: {
      packageId,
      command,
      validationStatus: validationSummary.status,
      validationDefaultSection: validationSummary.routeHints.defaultSection,
      validationPrimaryAction: validationSummary.routeHints.primaryAction,
      validationBlockingReason: validationSummary.blockingReason,
      validationRepair: validationSummary.clientRepair,
      nextAction: nextAction.type,
      blocked: nextAction.blocked,
      providerHandoffState: externalHandoff.state,
      commandAdmissionState: commandAdmission.state,
      resumeMode: clientMutation.resumeContract.resumeMode,
      routeIntent: clientMutation.resumeContract.routeIntent,
      targetSurface: clientMutation.resumeContract.targetSurface,
      targetAction: clientMutation.resumeContract.targetAction,
      resumeContractOk: clientMutation.resumeContract.ok,
      resumeIssueCodes: clientMutation.resumeContract.issues.map((issue) => issue.code),
      resumeWarningCodes: clientMutation.resumeContract.warnings.map((warning) => warning.code)
    }
  };
}

function scheduleRequiresProviderBinding(command, scheduleActivation) {
  if (command === 'disable') return false;
  if (command !== 'schedule') return true;
  return scheduleActivation.providerBindingRequired;
}

function buildScheduleActivationContract({ packageId, command, currentState, schedule, lifecycleTransition, providerContracts, commandAdmission, now }) {
  const scheduleConfigured = schedule.mode !== 'manual';
  const activeLifecycleState = ['installed', 'running', 'stopped', 'failed'].includes(currentState);
  const activationRequested = scheduleConfigured && lifecycleTransition.enabledAfter;
  const dispatchableState = activationRequested && activeLifecycleState;
  const providerReady = providerContracts.ok;
  const admitted = commandAdmission.admitted;
  const issues = [];
  const warnings = [];

  if (scheduleConfigured && currentState === 'missing') {
    issues.push({
      code: 'schedule.activation.package_missing',
      message: 'The hosted-kernel scheduler cannot persist an activation plan until the driver package is installed.',
      packageId
    });
  }
  if (activationRequested && !providerReady) {
    issues.push({
      code: 'schedule.activation.provider_required',
      message: 'Active hosted-kernel schedules require a provider that can dispatch the scheduled lifecycle operation.',
      requiredServiceOperation: providerContracts.requiredServiceOperation,
      dispatchBlockedProviderIds: providerContracts.dispatchBlockedProviderIds
    });
  }
  if (activationRequested && !admitted) {
    issues.push({
      code: 'schedule.activation.command_admission_blocked',
      message: 'Active hosted-kernel schedules require command admission before the schedule can be armed.',
      admissionState: commandAdmission.state,
      admissionIssueCodes: commandAdmission.issues.map((issue) => issue.code)
    });
  }
  if (scheduleConfigured && !lifecycleTransition.enabledAfter) {
    warnings.push({
      code: 'schedule.activation.saved_inactive',
      message: 'The schedule will be persisted but left inactive because the driver package is disabled.',
      mode: schedule.mode
    });
  }
  if (activationRequested && currentState === 'failed') {
    warnings.push({
      code: 'schedule.activation.failed_state_recovery',
      message: 'The schedule can be armed from failed state, but the next scheduled dispatch should run recovery-aware lifecycle handling.'
    });
  }

  const state = !scheduleConfigured
    ? 'manual'
    : issues.length > 0
      ? 'blocked'
      : activationRequested
        ? 'armed'
        : 'saved-inactive';
  const nextAction = state === 'manual'
    ? 'none'
    : state === 'blocked'
      ? issues[0]?.code === 'schedule.activation.provider_required'
        ? 'bind-provider-before-arming-schedule'
        : 'repair-schedule-activation'
      : state === 'saved-inactive'
        ? 'enable-driver-to-arm-schedule'
        : 'dispatch-schedule-activation';

  return {
    contractVersion: 1,
    packageId,
    command,
    evaluatedAt: now,
    configured: scheduleConfigured,
    mode: schedule.mode,
    intervalSeconds: schedule.mode === 'interval' ? schedule.intervalSeconds : null,
    cron: schedule.mode === 'cron' ? schedule.cron : null,
    timezone: schedule.timezone,
    activeLifecycleState,
    enabledAfter: lifecycleTransition.enabledAfter,
    activationRequested,
    dispatchableState,
    providerBindingRequired: activationRequested && !providerReady,
    admissionRequired: activationRequested,
    admitted,
    providerReady,
    selectedProviderId: providerContracts.selectedProviderId,
    requiredServiceOperation: providerContracts.requiredServiceOperation,
    state,
    nextAction,
    canPersist: scheduleConfigured && currentState !== 'missing',
    canArmDispatch: state === 'armed',
    issues,
    warnings,
    auditEvent: {
      eventType: 'driver-package.schedule.activation_evaluated',
      occurredAt: now,
      packageId,
      mode: schedule.mode,
      state,
      activationRequested,
      providerId: providerContracts.selectedProviderId,
      nextAction
    },
    proofClaims: {
      manualSchedulesDoNotDispatch: scheduleConfigured || state === 'manual',
      activeScheduleRequiresEnabledPackage: !activationRequested || lifecycleTransition.enabledAfter,
      activeScheduleRequiresProvider: !activationRequested || providerReady,
      activeScheduleRequiresAdmission: !activationRequested || admitted,
      inactiveDisabledScheduleCanPersistWithoutProvider: !(scheduleConfigured && !lifecycleTransition.enabledAfter) || !activationRequested,
      armedScheduleHasDispatchContract: state !== 'armed' || Boolean(providerContracts.selectedDispatch)
    }
  };
}

function buildControls({ command, currentState, requestedEnabled, validationOk, schedule, scheduleActivation }) {
  const canEnable = validationOk && currentState !== 'running' && currentState !== 'starting';
  const canDisable = currentState !== 'missing' && currentState !== 'disabled' && currentState !== 'stopping';
  const controls = {
    enable: { allowed: canEnable, reason: canEnable ? 'ready' : 'state_or_validation_blocked' },
    disable: { allowed: canDisable, reason: canDisable ? 'ready' : 'state_blocked' },
    restart: { allowed: validationOk && currentState === 'running', reason: validationOk && currentState === 'running' ? 'ready' : 'requires_running_valid_driver' },
    schedule: {
      allowed: validationOk && scheduleActivation.canPersist,
      reason: validationOk && scheduleActivation.canPersist ? scheduleActivation.state : scheduleActivation.issues[0]?.code ?? 'manual_or_validation_blocked',
      activationState: scheduleActivation.state,
      canPersist: scheduleActivation.canPersist,
      canArmDispatch: scheduleActivation.canArmDispatch,
      providerBindingRequired: scheduleActivation.providerBindingRequired,
      nextAction: scheduleActivation.nextAction
    }
  };

  if (requestedEnabled === false && command !== 'disable') {
    controls.start = { allowed: false, reason: 'driver_requested_disabled' };
  } else {
    controls.start = { allowed: validationOk && ['installed', 'stopped', 'failed'].includes(currentState), reason: validationOk ? 'state_checked' : 'validation_blocked' };
  }

  return controls;
}

function buildNextAction({ command, currentState, controls, validationOk, validationIssueReason, requestedEnabled, externalHandoff, commandAdmission, scheduleActivation }) {
  if (!validationOk) {
    if (commandAdmission.issues.length > 0 && validationIssueReason?.startsWith('command_admission.')) {
      return { type: 'resolve-command-admission', blocked: true, reason: validationIssueReason };
    }
    if (validationIssueReason?.startsWith('boundary.') || validationIssueReason?.startsWith('access.')) {
      return { type: 'resolve-access-boundary', blocked: true, reason: validationIssueReason };
    }
    if (validationIssueReason?.startsWith('lifecycle.')) {
      return { type: 'choose-lifecycle-control', blocked: true, reason: validationIssueReason };
    }
    return { type: 'repair-settings', blocked: true, reason: validationIssueReason ?? 'settings_or_schedule_invalid' };
  }
  if (externalHandoff.required && scheduleRequiresProviderBinding(command, scheduleActivation)) {
    return {
      type: 'handoff-provider-contract',
      blocked: true,
      reason: externalHandoff.reason,
      handoffRef: externalHandoff.handoffRef
    };
  }
  if (command === 'disable' || (requestedEnabled === false && command !== 'schedule')) {
    return controls.disable.allowed
      ? { type: 'disable-driver', blocked: false, reason: 'requested_disabled' }
      : { type: 'noop', blocked: true, reason: 'disable_not_allowed_in_state' };
  }
  if (command === 'enable') return { type: 'enable-driver', blocked: !controls.enable.allowed, reason: controls.enable.reason };
  if (command === 'install') return { type: 'install-driver', blocked: currentState !== 'missing', reason: currentState === 'missing' ? 'missing_driver' : 'already_present' };
  if (command === 'restart') return { type: 'restart-driver', blocked: !controls.restart.allowed, reason: controls.restart.reason };
  if (command === 'start') return { type: 'start-driver', blocked: !controls.start.allowed, reason: controls.start.reason };
  if (command === 'stop') return { type: 'stop-driver', blocked: currentState !== 'running', reason: currentState === 'running' ? 'ready' : 'requires_running_driver' };
  if (command === 'schedule' && controls.schedule.activationState === 'saved-inactive') {
    return { type: 'save-schedule-disabled', blocked: !controls.schedule.allowed, reason: controls.schedule.reason };
  }
  return { type: 'apply-schedule', blocked: !controls.schedule.allowed, reason: controls.schedule.reason };
}

function validationIssueSeverity(issue) {
  if (!issue?.code) return 'error';
  if (issue.code.includes('.stale') || issue.code.includes('.ignored') || issue.code.includes('.in_flight')) return 'warning';
  return 'error';
}

function validationSectionForIssue(issue) {
  const code = issue?.code ?? 'driver.unknown';
  if (code.startsWith('settings.') || code.startsWith('schedule.')) return 'configuration';
  if (code.startsWith('boundary.') || code.startsWith('access.')) return 'access-boundary';
  if (code.startsWith('command_admission.')) return 'command-admission';
  if (code.startsWith('provider.')) return 'provider-contract';
  if (code.startsWith('lifecycle.')) return 'lifecycle-control';
  return 'driver-package';
}

function validationActionForSection(section) {
  if (section === 'configuration') return 'edit-driver-package';
  if (section === 'access-boundary') return 'update-driver-package-access';
  if (section === 'command-admission') return 'inspect-driver-command-admission';
  if (section === 'provider-contract') return 'open-provider-handoff';
  if (section === 'lifecycle-control') return 'select-driver-control';
  return 'inspect-driver-package';
}

function buildValidationItems(validationIssues, externalHandoff, providerContracts, command, scheduleActivation) {
  const issueItems = validationIssues.map((issue, index) => {
    const section = validationSectionForIssue(issue);
    return {
      id: `${section}:${issue.code}:${index}`,
      code: issue.code,
      section,
      severity: validationIssueSeverity(issue),
      message: issue.message ?? issue.code,
      action: validationActionForSection(section),
      blocksAcceptance: validationIssueSeverity(issue) === 'error',
      detail: {
        command: issue.command ?? command,
        currentState: issue.currentState ?? null,
        allowedStates: issue.allowedStates ?? null,
        missingPermissions: issue.missingPermissions ?? null,
        retryAfterAt: issue.retryAfterAt ?? null,
        pendingCommandId: issue.pendingCommandId ?? null,
        providerId: issue.providerId ?? null
      }
    };
  });

  if (externalHandoff.required && scheduleRequiresProviderBinding(command, scheduleActivation)) {
    issueItems.push({
      id: `provider-contract:${externalHandoff.reason}:handoff`,
      code: externalHandoff.reason,
      section: 'provider-contract',
      severity: 'error',
      message: providerContracts.providers.length
        ? 'No hosted-kernel provider is ready to accept this driver package command.'
        : 'A hosted-kernel provider contract must be supplied before dispatch.',
      action: 'open-provider-handoff',
      blocksAcceptance: true,
      detail: {
        handoffRef: externalHandoff.handoffRef,
        missingCapabilities: externalHandoff.missingCapabilities,
        capabilityScopeBlockedProviderIds: externalHandoff.capabilityScopeBlockedProviderIds,
        dispatchBlockedProviderIds: externalHandoff.dispatchBlockedProviderIds,
        serviceContractBlockedProviderIds: externalHandoff.serviceContractBlockedProviderIds,
        acknowledgementBlockedProviderIds: externalHandoff.acknowledgementBlockedProviderIds,
        healthBlockedProviderIds: externalHandoff.healthBlockedProviderIds,
        requiredServiceOperation: externalHandoff.requiredServiceOperation
      }
    });
  }

  return issueItems;
}

function buildValidationSections(issueItems) {
  const sectionOrder = [
    'configuration',
    'access-boundary',
    'command-admission',
    'provider-contract',
    'lifecycle-control',
    'driver-package'
  ];
  return sectionOrder
    .map((section) => {
      const sectionItems = issueItems.filter((item) => item.section === section);
      return {
        id: section,
        status: sectionItems.some((item) => item.blocksAcceptance)
          ? 'blocked'
          : sectionItems.length
            ? 'warning'
            : 'pass',
        issueCount: sectionItems.length,
        blockingIssueCount: sectionItems.filter((item) => item.blocksAcceptance).length,
        primaryIssueCode: sectionItems[0]?.code ?? null,
        action: validationActionForSection(section),
        items: sectionItems
      };
    })
    .filter((section) => section.issueCount > 0 || section.id !== 'driver-package');
}

function buildValidationSummary(validationIssues, providerContracts, externalHandoff, command, accessBoundary, commandAdmission, scheduleActivation) {
  const issueGroups = validationIssues.reduce((groups, issue) => {
    const [domain = 'driver'] = issue.code.split('.');
    groups[domain] = (groups[domain] || 0) + 1;
    return groups;
  }, {});

  const boundaryIssueCount = accessBoundary.issues.length;
  const commandAdmissionIssueCount = commandAdmission.issues.length;
  const configurationIssueCount = validationIssues.length - boundaryIssueCount - commandAdmissionIssueCount;
  const providerIssueCount = providerContracts.ok || !scheduleRequiresProviderBinding(command, scheduleActivation) ? 0 : 1;
  const totalIssueCount = validationIssues.length + providerIssueCount;
  const issueItems = buildValidationItems(validationIssues, externalHandoff, providerContracts, command, scheduleActivation);
  const sections = buildValidationSections(issueItems);
  const blockingItems = issueItems.filter((item) => item.blocksAcceptance);
  const firstBlockingItem = blockingItems[0] ?? null;
  const firstActionableItem = issueItems.find((item) => item.action) ?? null;

  return {
    ok: totalIssueCount === 0,
    status: totalIssueCount === 0
      ? 'valid'
      : configurationIssueCount > 0
        ? 'invalid-input'
        : boundaryIssueCount > 0
          ? 'boundary-attention-required'
          : commandAdmissionIssueCount > 0
            ? 'command-admission-blocked'
            : 'provider-attention-required',
    totalIssueCount,
    inputIssueCount: validationIssues.length,
    configurationIssueCount,
    boundaryIssueCount,
    commandAdmissionIssueCount,
    providerIssueCount,
    issueGroups,
    primaryIssue: validationIssues[0]?.code ?? (externalHandoff.required ? externalHandoff.reason : null),
    blockingReason: firstBlockingItem?.code ?? null,
    firstAction: firstActionableItem?.action ?? 'submit-driver-package-command',
    issueItems,
    sections,
    clientRepair: {
      required: blockingItems.length > 0,
      action: firstActionableItem?.action ?? 'none',
      section: firstActionableItem?.section ?? null,
      reason: firstActionableItem?.code ?? null,
      focusIssueId: firstActionableItem?.id ?? null,
      canContinueAfterRepair: blockingItems.length > 0 || externalHandoff.required,
      handoffRef: externalHandoff.required ? externalHandoff.handoffRef : null,
      missingPermissions: accessBoundary.missingPermissions,
      pendingCommandId: commandAdmission.pendingCommand?.commandId ?? null
    },
    routeHints: {
      validationPanel: sections.some((section) => section.status !== 'pass') ? 'open' : 'collapsed',
      defaultSection: firstActionableItem?.section ?? 'configuration',
      primaryAction: firstActionableItem?.action ?? 'submit-driver-package-command',
      providerHandoffRequired: externalHandoff.required,
      commandAdmissionBlocked: commandAdmission.issues.length > 0,
      accessBoundaryBlocked: accessBoundary.issues.length > 0
    },
    requiredProviderCapabilities: providerContracts.requiredCapabilities,
    missingProviderCapabilities: externalHandoff.missingCapabilities ?? [],
    proofClaims: {
      issuesClassified: issueItems.length === totalIssueCount,
      sectionsOrderedForClient: sections.length > 0,
      blockingReasonExplained: totalIssueCount === 0 || Boolean(firstBlockingItem),
      repairActionBound: totalIssueCount === 0 || Boolean(firstActionableItem),
      providerIssueRepresented: providerIssueCount === 0 || issueItems.some((item) => item.section === 'provider-contract'),
      boundaryIssueRepresented: boundaryIssueCount === 0 || issueItems.some((item) => item.section === 'access-boundary'),
      commandAdmissionIssueRepresented: commandAdmissionIssueCount === 0 || issueItems.some((item) => item.section === 'command-admission')
    }
  };
}

function buildReadiness({ command, currentState, validationSummary, providerContracts, controls, nextAction, accessBoundary, commandAdmission, scheduleActivation }) {
  const tenantWorkspaceIssues = accessBoundary.issues.filter((issue) => !issue.code.startsWith('boundary.package_scope.'));
  const gates = [
    {
      id: 'input-validation',
      label: 'Settings and schedule',
      ready: validationSummary.configurationIssueCount === 0,
      reason: validationSummary.configurationIssueCount === 0 ? 'valid' : 'repair_invalid_inputs'
    },
    {
      id: 'tenant-workspace-boundary',
      label: 'Tenant and workspace boundary',
      ready: tenantWorkspaceIssues.length === 0,
      reason: tenantWorkspaceIssues.length === 0 ? 'boundary_and_permissions_bound' : tenantWorkspaceIssues[0].code
    },
    {
      id: 'workspace-package-scope',
      label: 'Workspace package scope',
      ready: accessBoundary.packageScope.packageAllowed,
      reason: accessBoundary.packageScope.packageAllowed
        ? accessBoundary.packageScope.matchedBy
        : accessBoundary.packageScope.issues[0]?.code ?? 'package_scope_blocked'
    },
    {
      id: 'command-admission',
      label: 'Hosted-kernel command admission',
      ready: commandAdmission.admitted,
      reason: commandAdmission.admitted ? commandAdmission.state : commandAdmission.issues[0]?.code ?? 'command_admission_blocked'
    },
    {
      id: 'provider-contract',
      label: 'Hosted-kernel provider',
      ready: providerContracts.ok || !scheduleRequiresProviderBinding(command, scheduleActivation),
      reason: providerContracts.ok
        ? 'provider_bound'
        : !scheduleRequiresProviderBinding(command, scheduleActivation)
          ? 'not_required_for_inactive_schedule_or_disable'
          : 'provider_contract_missing'
    },
    {
      id: 'lifecycle-control',
      label: 'Lifecycle command',
      ready: !nextAction.blocked,
      reason: nextAction.reason
    }
  ];

  const readyGateCount = gates.filter((gate) => gate.ready).length;
  return {
    state: gates.every((gate) => gate.ready)
      ? 'ready'
      : validationSummary.configurationIssueCount
        ? 'needs-input-repair'
        : validationSummary.boundaryIssueCount
          ? 'needs-access-boundary'
          : validationSummary.commandAdmissionIssueCount
            ? 'needs-command-admission'
            : 'needs-provider-or-state',
    readyGateCount,
    totalGateCount: gates.length,
    blockedGateIds: gates.filter((gate) => !gate.ready).map((gate) => gate.id),
    currentState,
    requestedCommand: command,
    primaryControl: controls[command] ?? null,
    gates
  };
}

function buildAcceptanceContract({ packageId, command, validationSummary, readiness, nextAction, externalHandoff, accessBoundary, commandAdmission, scheduleActivation, now }) {
  const accepted = validationSummary.ok && readiness.state === 'ready' && !nextAction.blocked;
  return {
    accepted,
    decision: accepted ? 'accepted' : 'requires-attention',
    acceptRef: `${surfaceId}:${packageId}:${command}:acceptance:${now}`,
    criteria: [
      { id: 'inputs-valid', passed: validationSummary.inputIssueCount === 0 },
      { id: 'actor-authorized', passed: accessBoundary.permissionGranted },
      { id: 'tenant-workspace-bound', passed: accessBoundary.isolated },
      { id: 'workspace-package-scope', passed: accessBoundary.packageScope.packageAllowed },
      { id: 'persisted-command-boundary-safe', passed: commandAdmission.boundary.ok },
      { id: 'command-admitted', passed: commandAdmission.admitted },
      { id: 'provider-ready', passed: !externalHandoff.required || !scheduleRequiresProviderBinding(command, scheduleActivation) },
      { id: 'action-unblocked', passed: !nextAction.blocked }
    ],
    rejectionReason: accepted ? null : nextAction.reason,
    handoffRef: externalHandoff.required ? externalHandoff.handoffRef : null
  };
}

function buildPreview({ packageId, currentState, command, schedule, settings, providerContracts, nextAction, readiness, workflowHandoff, validationSummary, scheduleActivation }) {
  const scheduleText = schedule.mode === 'manual'
    ? 'Manual lifecycle control'
    : schedule.mode === 'interval'
      ? `Every ${schedule.intervalSeconds} seconds`
      : `Cron ${schedule.cron} (${schedule.timezone})`;
  return {
    title: `${packageId} ${command}`,
    stateTransition: {
      from: currentState,
      command,
      expected: nextAction.blocked ? currentState : command === 'disable' ? 'disabled' : command === 'stop' ? 'stopped' : command === 'install' ? 'installed' : 'running'
    },
    summary: {
      schedule: scheduleText,
      maxConcurrency: settings.maxConcurrency,
      proofMode: settings.proofMode,
      provider: providerContracts.selectedProviderId ?? 'unbound',
      readiness: readiness.state,
      workflow: workflowHandoff.state,
      channel: workflowHandoff.channel,
      validation: validationSummary.status,
      validationAction: validationSummary.routeHints.primaryAction,
      validationSection: validationSummary.routeHints.defaultSection,
      scheduleActivation: scheduleActivation.state
    },
    validationPanel: {
      state: validationSummary.routeHints.validationPanel,
      defaultSection: validationSummary.routeHints.defaultSection,
      primaryAction: validationSummary.routeHints.primaryAction,
      blockingReason: validationSummary.blockingReason,
      repairRequired: validationSummary.clientRepair.required,
      focusIssueId: validationSummary.clientRepair.focusIssueId,
      sections: validationSummary.sections.map((section) => ({
        id: section.id,
        status: section.status,
        issueCount: section.issueCount,
        blockingIssueCount: section.blockingIssueCount,
        primaryIssueCode: section.primaryIssueCode,
        action: section.action
      }))
    },
    userVisibleBadges: [
      readiness.state,
      providerContracts.ok ? 'provider-bound' : 'provider-needed',
      validationSummary.ok ? 'validation-pass' : validationSummary.status,
      scheduleActivation.configured ? `schedule-${scheduleActivation.state}` : 'schedule-manual',
      nextAction.blocked ? 'blocked' : 'actionable',
      workflowHandoff.requiresUserAction ? 'handoff-visible' : 'submit-ready'
    ]
  };
}

function buildExplainableNextSteps({ command, validationSummary, readiness, nextAction, externalHandoff, controls, accessBoundary, commandAdmission, scheduleActivation }) {
  if (validationSummary.configurationIssueCount > 0) {
    return [{ id: 'repair-inputs', label: 'Repair settings or schedule', reason: validationSummary.primaryIssue, action: 'edit-driver-package' }];
  }
  if (validationSummary.boundaryIssueCount > 0) {
    return [{
      id: 'resolve-access-boundary',
      label: 'Resolve tenant, workspace, or permission boundary',
      reason: accessBoundary.issues[0]?.code ?? validationSummary.primaryIssue,
      action: 'update-driver-package-access',
      missingPermissions: accessBoundary.missingPermissions,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      packageScope: {
        packageId: accessBoundary.packageScope.packageId,
        matchedBy: accessBoundary.packageScope.matchedBy,
        allowedPackageIds: accessBoundary.packageScope.allowedPackageIds,
        allowedPackagePrefixes: accessBoundary.packageScope.allowedPackagePrefixes,
        deniedPackageIds: accessBoundary.packageScope.deniedPackageIds
      }
    }];
  }
  if (validationSummary.commandAdmissionIssueCount > 0) {
    return [{
      id: 'resolve-command-admission',
      label: 'Resolve hosted-kernel command admission',
      reason: commandAdmission.issues[0]?.code ?? validationSummary.primaryIssue,
      action: 'inspect-driver-command-admission',
      pendingCommand: commandAdmission.pendingCommand,
      retryPlan: commandAdmission.retryPlan,
      boundary: commandAdmission.boundary
    }];
  }
  if (externalHandoff.required && scheduleRequiresProviderBinding(command, scheduleActivation)) {
    return [{
      id: 'bind-provider',
      label: 'Bind hosted-kernel provider',
      reason: externalHandoff.reason,
      action: 'open-provider-handoff',
      handoffRef: externalHandoff.handoffRef,
      missingCapabilities: externalHandoff.missingCapabilities,
      capabilityScopeBlockedProviderIds: externalHandoff.capabilityScopeBlockedProviderIds
    }];
  }
  if (nextAction.blocked) {
    return [{
      id: 'choose-available-control',
      label: 'Choose an available lifecycle control',
      reason: nextAction.reason,
      action: 'select-driver-control',
      availableControls: Object.entries(controls)
        .filter(([, control]) => control.allowed)
        .map(([id]) => id)
    }];
  }
  if (command === 'schedule' && scheduleActivation.state === 'saved-inactive') {
    return [{
      id: 'schedule-saved-inactive',
      label: 'Save schedule without arming dispatch',
      reason: scheduleActivation.warnings[0]?.code ?? 'schedule.activation.saved_inactive',
      action: 'save-driver-schedule',
      followUpAction: scheduleActivation.nextAction
    }];
  }
  return [{
    id: 'confirm-lifecycle-action',
    label: `Confirm ${nextAction.type}`,
    reason: readiness.state,
    action: 'submit-driver-package-command'
  }];
}

function buildOperationalHealthErrors({ packageId, command, providerContracts, commandAdmission, recovery, validationSummary, externalHandoff, now }) {
  const nowMs = Date.parse(now);
  const providerHealthErrors = providerContracts.providers
    .filter((provider) => provider.health.issues.length > 0 || provider.health.warnings.length > 0)
    .map((provider) => ({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      status: provider.health.status,
      stale: provider.health.stale,
      degradedMode: provider.health.degradedMode,
      degradedModeAllowsCommand: provider.health.degradedModeAllowsCommand,
      errorCode: provider.health.errorCode,
      issueCodes: provider.health.issues.map((issue) => issue.code),
      warningCodes: provider.health.warnings.map((warning) => warning.code),
      action: provider.health.status === 'fail'
        ? 'repair-or-replace-provider'
        : provider.health.stale
          ? 'refresh-provider-health'
        : provider.health.degradedModeAllowsCommand
          ? 'continue-with-degraded-mode-proof'
          : 'choose-degraded-safe-command'
    }));
  const acknowledgementErrors = providerContracts.providers
    .filter((provider) => provider.acknowledgement.issues.length > 0 || provider.acknowledgement.warnings.length > 0)
    .map((provider) => ({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      mode: provider.acknowledgement.mode,
      status: provider.acknowledgement.status,
      ackRef: provider.acknowledgement.ackRef,
      timeoutMs: provider.acknowledgement.timeoutMs,
      pollRequired: provider.acknowledgement.pollRequired,
      issueCodes: provider.acknowledgement.issues.map((issue) => issue.code),
      warningCodes: provider.acknowledgement.warnings.map((warning) => warning.code),
      action: provider.acknowledgement.status === 'rejected'
        ? 'inspect-provider-acknowledgement-rejection'
        : provider.acknowledgement.ackWindowExpired || provider.acknowledgement.status === 'timed-out'
          ? 'refresh-provider-acknowledgement-window'
          : provider.acknowledgement.pollRequired
            ? 'poll-provider-acknowledgement'
        : 'repair-provider-acknowledgement-contract'
    }));
  const serviceContractErrors = providerContracts.providers
    .filter((provider) => provider.serviceContract.issues.length > 0 || provider.serviceContract.warnings.length > 0)
    .map((provider) => ({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      requestedOperation: provider.serviceContract.requestedOperation,
      negotiatedVersion: provider.serviceContract.negotiatedVersion,
      handoffLeaseExpired: provider.serviceContract.handoff.leaseExpired,
      issueCodes: provider.serviceContract.issues.map((issue) => issue.code),
      warningCodes: provider.serviceContract.warnings.map((warning) => warning.code),
      action: provider.serviceContract.handoff.leaseExpired
        ? 'refresh-provider-handoff-lease'
        : provider.serviceContract.negotiatedVersion
          ? 'enable-required-provider-sync-scope'
          : 'upgrade-provider-service-contract'
    }));
  const capabilityScopeErrors = providerContracts.providers
    .filter((provider) => provider.capabilityPolicy.issues.length > 0 || provider.capabilityPolicy.missingRequiredCapabilities.length > 0)
    .map((provider) => ({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      mode: provider.capabilityPolicy.mode,
      matchedGrantIds: provider.capabilityPolicy.matchedGrantIds,
      unmatchedRequiredGrantIds: provider.capabilityPolicy.unmatchedRequiredGrantIds,
      missingRequiredCapabilities: provider.capabilityPolicy.missingRequiredCapabilities,
      issueCodes: [
        ...provider.capabilityPolicy.issues.map((issue) => issue.code),
        ...(provider.capabilityPolicy.missingRequiredCapabilities.length > 0 ? ['provider.capability_scope.missing_required'] : [])
      ],
      warningCodes: provider.capabilityPolicy.warnings.map((warning) => warning.code),
      action: provider.capabilityPolicy.mode === 'scoped-only'
        ? 'bind-provider-capability-grant'
        : 'inspect-provider-capability-deny-list'
    }));
  const degradedProviders = providerContracts.providers
    .filter((provider) => provider.health.degradedMode || provider.state === 'degraded')
    .map((provider) => ({
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      state: provider.state,
      healthStatus: provider.health.status,
      commandAllowed: provider.health.degradedModeAllowsCommand,
      allowedCommands: provider.health.degradedModeCommands,
      safeAlternativeCommands: provider.health.degradedModeCommands.filter((candidate) => candidate !== command),
      dispatchReady: provider.dispatch.dispatchReady,
      canServeRequestedCommand: provider.canServe
    }));
  const retryBlocked = commandAdmission.issues.some((issue) => issue.code === 'command_admission.retry_backoff_active');
  const retryExhausted = commandAdmission.issues.some((issue) => issue.code === 'command_admission.retry_budget_exceeded');
  const retryAfterMs = commandAdmission.retryPlan.retryAfterAt ? Date.parse(commandAdmission.retryPlan.retryAfterAt) : null;
  const retryAvailableInMs = retryAfterMs !== null && !Number.isNaN(retryAfterMs) && !Number.isNaN(nowMs)
    ? Math.max(0, retryAfterMs - nowMs)
    : null;
  const providerFailureCount = providerHealthErrors.filter((entry) => entry.issueCodes.length > 0).length;
  const acknowledgementFailureCount = acknowledgementErrors.filter((entry) => entry.issueCodes.length > 0).length;
  const serviceContractFailureCount = serviceContractErrors.filter((entry) => entry.issueCodes.length > 0).length;
  const capabilityScopeFailureCount = capabilityScopeErrors.filter((entry) => entry.issueCodes.length > 0).length;
  const failureState = retryExhausted
    ? 'retry-exhausted'
    : retryBlocked
      ? 'retry-backoff-active'
      : providerFailureCount > 0
        ? 'provider-health-blocked'
        : acknowledgementFailureCount > 0
          ? 'provider-acknowledgement-blocked'
          : capabilityScopeFailureCount > 0
            ? 'provider-capability-scope-blocked'
          : serviceContractFailureCount > 0
            ? 'provider-service-contract-blocked'
        : recovery.heartbeatExpired
          ? 'pending-command-heartbeat-expired'
          : externalHandoff.required
            ? 'provider-handoff-required'
            : validationSummary.ok
              ? 'healthy'
              : 'validation-blocked';
  const degradedModePlan = {
    active: degradedProviders.length > 0,
    requestedCommandAllowed: degradedProviders.some((provider) => provider.commandAllowed),
    servingProviderIds: degradedProviders.filter((provider) => provider.canServeRequestedCommand).map((provider) => provider.providerId),
    blockedProviderIds: degradedProviders.filter((provider) => !provider.commandAllowed).map((provider) => provider.providerId),
    safeAlternativeCommands: [...new Set(degradedProviders.flatMap((provider) => provider.safeAlternativeCommands))],
    action: degradedProviders.length === 0
      ? 'none'
      : degradedProviders.some((provider) => provider.commandAllowed)
        ? 'continue-with-degraded-mode-proof'
        : 'choose-degraded-safe-command'
  };
  const retryWindow = {
    active: retryBlocked,
    exhausted: retryExhausted,
    nextAttempt: commandAdmission.retryPlan.nextAttempt,
    restartRetries: commandAdmission.retryPlan.restartRetries,
    delayMs: commandAdmission.retryPlan.delayMs,
    retryAfterAt: commandAdmission.retryPlan.retryAfterAt,
    retryAvailableInMs,
    lastErrorCode: commandAdmission.retryPlan.lastErrorCode,
    action: commandAdmission.retryPlan.action
  };
  const actionableErrors = [];

  if (retryExhausted || retryBlocked) {
    actionableErrors.push({
      code: retryExhausted ? 'driver_package.retry_exhausted' : 'driver_package.retry_backoff_active',
      severity: retryExhausted ? 'error' : 'warning',
      message: retryExhausted
        ? 'The command cannot be retried until the last failure is inspected or the retry budget is changed.'
        : 'The command is temporarily blocked by retry backoff.',
      action: commandAdmission.retryPlan.action,
      retryAfterAt: commandAdmission.retryPlan.retryAfterAt,
      lastErrorCode: commandAdmission.retryPlan.lastErrorCode
    });
  }
  for (const healthError of providerHealthErrors.filter((entry) => entry.issueCodes.length > 0)) {
    actionableErrors.push({
      code: healthError.issueCodes[0],
      severity: 'error',
      message: 'Provider health is blocking hosted-kernel driver dispatch.',
      action: healthError.action,
      providerId: healthError.providerId,
      errorCode: healthError.errorCode
    });
  }
  for (const acknowledgementError of acknowledgementErrors.filter((entry) => entry.issueCodes.length > 0)) {
    actionableErrors.push({
      code: acknowledgementError.issueCodes[0],
      severity: 'error',
      message: 'Provider acknowledgement state is blocking hosted-kernel driver dispatch.',
      action: acknowledgementError.action,
      providerId: acknowledgementError.providerId,
      ackRef: acknowledgementError.ackRef
    });
  }
  for (const serviceContractError of serviceContractErrors.filter((entry) => entry.issueCodes.length > 0)) {
    actionableErrors.push({
      code: serviceContractError.issueCodes[0],
      severity: 'error',
      message: 'Provider service contract is blocking hosted-kernel driver dispatch.',
      action: serviceContractError.action,
      providerId: serviceContractError.providerId,
      requestedOperation: serviceContractError.requestedOperation
    });
  }
  for (const capabilityScopeError of capabilityScopeErrors.filter((entry) => entry.issueCodes.length > 0)) {
    actionableErrors.push({
      code: capabilityScopeError.issueCodes[0],
      severity: 'error',
      message: 'Provider capability scope is blocking hosted-kernel driver dispatch for this tenant, workspace, or package.',
      action: capabilityScopeError.action,
      providerId: capabilityScopeError.providerId,
      missingRequiredCapabilities: capabilityScopeError.missingRequiredCapabilities,
      matchedGrantIds: capabilityScopeError.matchedGrantIds
    });
  }
  if (recovery.heartbeatExpired) {
    actionableErrors.push({
      code: 'driver_package.pending_command_heartbeat_expired',
      severity: 'warning',
      message: 'A pending hosted-kernel command has exceeded the heartbeat window and should be resumed or reconciled.',
      action: recovery.recoveryAction,
      pendingCommandId: recovery.pendingCommandId
    });
  }
  if (degradedModePlan.active && !degradedModePlan.requestedCommandAllowed) {
    actionableErrors.push({
      code: 'driver_package.degraded_mode_command_blocked',
      severity: 'warning',
      message: 'The requested command is not allowed by any degraded-mode provider.',
      action: degradedModePlan.action,
      safeAlternativeCommands: degradedModePlan.safeAlternativeCommands
    });
  }

  const runbook = actionableErrors.map((error, index) => ({
    step: index + 1,
    action: error.action,
    reason: error.code,
    providerId: error.providerId ?? null,
    retryAfterAt: error.retryAfterAt ?? null,
    expectedOutcome: error.severity === 'error' ? 'unblock-dispatch-gate' : 'reduce-operational-risk'
  }));
  const failureProof = {
    evaluatedAt: now,
    selectedProviderId: providerContracts.selectedProviderId,
    providerCount: providerContracts.providers.length,
    providerFailureCount,
    acknowledgementFailureCount,
    serviceContractFailureCount,
    capabilityScopeFailureCount,
    retryBackoffActive: retryWindow.active,
    retryBudgetAvailable: commandAdmission.retryPlan.budgetAvailable,
    heartbeatExpired: recovery.heartbeatExpired,
    handoffRequired: externalHandoff.required,
    validationStatus: validationSummary.status,
    actionableErrorCount: actionableErrors.length
  };

  return {
    contractVersion: 1,
    packageId,
    command,
    evaluatedAt: now,
    state: failureState,
    degradedModeActive: providerContracts.providers.some((provider) => provider.canServe && provider.health.degradedMode),
    providerHealthErrors,
    acknowledgementErrors,
    serviceContractErrors,
    capabilityScopeErrors,
    degradedModePlan,
    retryBackoff: commandAdmission.retryPlan,
    retryWindow,
    recoveryAction: recovery.recoveryAction,
    runbook,
    failureProof,
    actionableErrors,
    healthy: failureState === 'healthy',
    operatorActionRequired: actionableErrors.some((error) => error.severity === 'error')
  };
}

function incrementCounter(target, key, amount = 1) {
  if (!key) return;
  target[key] = (target[key] || 0) + amount;
}

function commandEventAt(commandRecord) {
  return commandRecord.completedAt ?? commandRecord.lastHeartbeatAt ?? commandRecord.submittedAt ?? null;
}

function commandDurationMs(commandRecord) {
  const submittedMs = commandRecord.submittedAt ? Date.parse(commandRecord.submittedAt) : null;
  const completedMs = commandRecord.completedAt ? Date.parse(commandRecord.completedAt) : null;
  if (submittedMs === null || completedMs === null || Number.isNaN(submittedMs) || Number.isNaN(completedMs)) return null;
  return Math.max(0, completedMs - submittedMs);
}

function buildAnalyticsTrendWindow({ id, label, sinceMs, sortedRecords, nowMs }) {
  const records = sortedRecords
    .filter(({ at }) => {
      const eventMs = at ? Date.parse(at) : null;
      return sinceMs === null || (eventMs !== null && !Number.isNaN(eventMs) && eventMs >= sinceMs && eventMs <= nowMs);
    })
    .map(({ record }) => record);
  const completedRecords = records.filter((record) => record.completedAt);
  const failedRecords = records.filter((record) => record.status === 'failed');
  const committedRecords = records.filter((record) => record.status === 'committed');
  const durations = completedRecords.map((record) => commandDurationMs(record)).filter((duration) => duration !== null);
  const averageDurationMs = durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : null;

  return {
    id,
    label,
    recordCount: records.length,
    committedCount: committedRecords.length,
    failedCount: failedRecords.length,
    pendingCount: records.filter((record) => record.status === 'pending' || record.status === 'applying').length,
    cancelledCount: records.filter((record) => record.status === 'cancelled').length,
    failureRate: records.length ? Number((failedRecords.length / records.length).toFixed(4)) : 0,
    averageDurationMs,
    lastCommandAt: records.length ? commandEventAt(records[records.length - 1]) : null
  };
}

function buildAnalyticsTrendWindows(sortedRecords, now) {
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isNaN(nowMs) ? Date.now() : nowMs;
  return [
    buildAnalyticsTrendWindow({
      id: 'last-hour',
      label: 'Last hour',
      sinceMs: safeNowMs - 60 * 60 * 1000,
      sortedRecords,
      nowMs: safeNowMs
    }),
    buildAnalyticsTrendWindow({
      id: 'last-day',
      label: 'Last 24 hours',
      sinceMs: safeNowMs - 24 * 60 * 60 * 1000,
      sortedRecords,
      nowMs: safeNowMs
    }),
    buildAnalyticsTrendWindow({
      id: 'retained-history',
      label: 'Retained history',
      sinceMs: null,
      sortedRecords,
      nowMs: safeNowMs
    })
  ];
}

function buildStatusTransitions(sortedRecords, currentEvaluation) {
  const states = [
    ...sortedRecords.map(({ record, at }) => ({
      at,
      state: record.status,
      command: record.command,
      commandId: record.commandId,
      providerId: record.providerId ?? 'unbound'
    })),
    {
      at: currentEvaluation.occurredAt,
      state: currentEvaluation.decision,
      command: currentEvaluation.command,
      commandId: currentEvaluation.idempotencyKey,
      providerId: currentEvaluation.providerId ?? 'unbound'
    }
  ];

  return states.slice(1).map((state, index) => {
    const previous = states[index];
    return {
      from: previous.state,
      to: state.state,
      changed: previous.state !== state.state,
      occurredAt: state.at,
      command: state.command,
      commandId: state.commandId,
      providerId: state.providerId
    };
  });
}

function buildProviderReliability(sortedRecords, providerContracts) {
  const profiles = new Map(providerContracts.providers.map((provider) => [provider.providerId, {
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    currentState: provider.state,
    currentHealth: provider.health.status,
    canServeCurrentCommand: provider.canServe,
    observedCommandCount: 0,
    committedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    pendingCount: 0,
    averageDurationMs: null,
    lastObservedAt: null,
    lastErrorCode: null,
    reliabilityScore: provider.canServe ? 1 : 0,
    statusCounts: {}
  }]));
  const durationTotals = new Map();
  const durationCounts = new Map();

  for (const { record, at } of sortedRecords) {
    const providerId = record.providerId ?? 'unbound';
    if (!profiles.has(providerId)) {
      profiles.set(providerId, {
        providerId,
        serviceId: null,
        currentState: 'unknown',
        currentHealth: 'unknown',
        canServeCurrentCommand: false,
        observedCommandCount: 0,
        committedCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        pendingCount: 0,
        averageDurationMs: null,
        lastObservedAt: null,
        lastErrorCode: null,
        reliabilityScore: 0,
        statusCounts: {}
      });
    }
    const profile = profiles.get(providerId);
    profile.observedCommandCount += 1;
    profile.lastObservedAt = at ?? profile.lastObservedAt;
    incrementCounter(profile.statusCounts, record.status);
    if (record.status === 'committed') profile.committedCount += 1;
    if (record.status === 'failed') {
      profile.failedCount += 1;
      profile.lastErrorCode = record.errorCode;
    }
    if (record.status === 'cancelled') profile.cancelledCount += 1;
    if (record.status === 'pending' || record.status === 'applying') profile.pendingCount += 1;

    const durationMs = commandDurationMs(record);
    if (durationMs !== null) {
      durationTotals.set(providerId, (durationTotals.get(providerId) ?? 0) + durationMs);
      durationCounts.set(providerId, (durationCounts.get(providerId) ?? 0) + 1);
    }
  }

  return [...profiles.values()].map((profile) => {
    const measuredCount = durationCounts.get(profile.providerId) ?? 0;
    const resolvedCount = profile.committedCount + profile.failedCount + profile.cancelledCount;
    return {
      ...profile,
      averageDurationMs: measuredCount ? Math.round(durationTotals.get(profile.providerId) / measuredCount) : null,
      reliabilityScore: resolvedCount
        ? Number((profile.committedCount / resolvedCount).toFixed(4))
        : profile.canServeCurrentCommand ? 1 : 0
    };
  });
}

function buildAnalyticsExports({
  packageId,
  persistedState,
  currentState,
  command,
  validationSummary,
  providerContracts,
  commandAdmission,
  acceptance,
  readiness,
  workflowHandoff,
  operationalHealth,
  persistence,
  now
}) {
  const historicalRecords = [
    ...persistedState.commandHistory,
    persistedState.lastCommand,
    persistedState.pendingCommand
  ].filter(Boolean);
  const uniqueRecords = [...new Map(historicalRecords
    .filter((record) => record.command)
    .map((record, index) => [record.commandId ?? `${record.command}:${index}`, record])).values()];
  const sortedRecords = uniqueRecords
    .map((record) => ({ record, at: commandEventAt(record) }))
    .sort((left, right) => Date.parse(left.at ?? '1970-01-01T00:00:00.000Z') - Date.parse(right.at ?? '1970-01-01T00:00:00.000Z'));
  const counters = {
    totalRecordedCommands: uniqueRecords.length,
    acceptedEvaluations: acceptance.accepted ? 1 : 0,
    blockedEvaluations: acceptance.accepted ? 0 : 1,
    providerCount: providerContracts.providers.length,
    providerReadyCount: providerContracts.providers.filter((provider) => provider.canServe).length,
    dispatchBlockedProviderCount: providerContracts.dispatchBlockedProviderIds.length,
    actionRequiredCount: operationalHealth.actionableErrors.length,
    byCommand: {},
    byStatus: {},
    byProvider: {}
  };
  let totalDurationMs = 0;
  let measuredDurationCount = 0;
  let lastFailure = null;
  let lastCommitted = null;

  for (const { record } of sortedRecords) {
    incrementCounter(counters.byCommand, record.command);
    incrementCounter(counters.byStatus, record.status);
    incrementCounter(counters.byProvider, record.providerId ?? 'unbound');
    const durationMs = commandDurationMs(record);
    if (durationMs !== null) {
      totalDurationMs += durationMs;
      measuredDurationCount += 1;
    }
    if (record.status === 'failed') lastFailure = record;
    if (record.status === 'committed') lastCommitted = record;
  }

    const currentEvaluation = {
      eventType: 'driver-package.lifecycle.evaluation',
      occurredAt: now,
    packageId,
    command,
    currentState,
    decision: acceptance.decision,
    readinessState: readiness.state,
    workflowState: workflowHandoff.state,
    validationStatus: validationSummary.status,
    providerId: providerContracts.selectedProviderId,
    commandAdmissionState: commandAdmission.state,
      operationalHealthState: operationalHealth.state,
      idempotencyKey: persistence.idempotencyKey
    };
    const statusTransitions = buildStatusTransitions(sortedRecords, currentEvaluation);
    const trendWindows = buildAnalyticsTrendWindows(sortedRecords, now);
    const providerReliability = buildProviderReliability(sortedRecords, providerContracts);
    const timeline = [
    ...sortedRecords.map(({ record, at }) => ({
      eventType: `driver-package.command.${record.status}`,
      occurredAt: at,
      packageId,
      command: record.command,
      commandId: record.commandId,
      requestId: record.requestId,
      status: record.status,
      desiredState: record.desiredState,
      providerId: record.providerId,
      attempt: record.attempt,
      durationMs: commandDurationMs(record),
      errorCode: record.errorCode
    })),
    currentEvaluation
  ];
    const latestSnapshot = {
    snapshotType: 'driver-package.analytics.latest',
    capturedAt: now,
    packageId,
    lifecycleState: currentState,
    requestedCommand: command,
    lastCommittedCommandId: lastCommitted?.commandId ?? null,
    lastFailureCode: lastFailure?.errorCode ?? null,
    pendingCommandId: persistedState.pendingCommand?.commandId ?? null,
    averageCommandDurationMs: measuredDurationCount > 0 ? Math.round(totalDurationMs / measuredDurationCount) : null,
    readinessState: readiness.state,
      operationalHealthState: operationalHealth.state,
      exportRowCount: timeline.length
    };
    const exportRows = timeline.map((event, index) => ({
      rowIndex: index,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      packageId: event.packageId,
      command: event.command,
      status: event.status ?? null,
      providerId: event.providerId ?? null,
      decision: event.decision ?? null,
      readinessState: event.readinessState ?? null,
      operationalHealthState: event.operationalHealthState ?? null,
      durationMs: event.durationMs ?? null,
      errorCode: event.errorCode ?? null
    }));
    const exportManifest = {
      manifestVersion: 1,
      subject: `${surfaceId}:${packageId}`,
      generatedAt: now,
      datasets: [
        { name: 'summary', format: 'application/json', rowCount: exportRows.length },
        { name: 'timeline', format: 'application/json', rowCount: timeline.length },
        { name: 'trendWindows', format: 'application/json', rowCount: trendWindows.length },
        { name: 'providerReliability', format: 'application/json', rowCount: providerReliability.length },
        { name: 'statusTransitions', format: 'application/json', rowCount: statusTransitions.length }
      ],
      cursors: {
        next: `${packageId}:${persistedState.revision}:${timeline.length}:${now}`,
        retainedHistoryStartAt: sortedRecords[0]?.at ?? null,
        retainedHistoryEndAt: sortedRecords[sortedRecords.length - 1]?.at ?? now
      }
    };

    return {
      contractVersion: 1,
      generatedAt: now,
      counters,
      latestSnapshot,
      timeline,
      trendWindows,
      providerReliability,
      statusTransitions,
      exports: {
        manifest: exportManifest,
        summary: {
          format: 'application/json',
          schemaVersion: 1,
          subject: `${surfaceId}:${packageId}`,
          generatedAt: now,
          columns: ['rowIndex', 'occurredAt', 'eventType', 'packageId', 'command', 'status', 'providerId', 'decision', 'readinessState', 'operationalHealthState', 'durationMs', 'errorCode'],
          rows: exportRows
        },
        report: {
          format: 'application/json',
          schemaVersion: 1,
          generatedAt: now,
          packageId,
          sections: {
            latestSnapshot,
            trendWindows,
            providerReliability,
            statusTransitions
          }
        },
        proofSummary: {
        packageId,
        generatedAt: now,
        decision: acceptance.decision,
        validationStatus: validationSummary.status,
        selectedProviderId: providerContracts.selectedProviderId,
        commandAdmissionState: commandAdmission.state,
        commandStatus: persistence.commandStatus,
        counters: {
            totalRecordedCommands: counters.totalRecordedCommands,
            acceptedEvaluations: counters.acceptedEvaluations,
            blockedEvaluations: counters.blockedEvaluations,
            actionRequiredCount: counters.actionRequiredCount,
            providerReliabilityProfiles: providerReliability.length,
            statusTransitionCount: statusTransitions.length
          }
        }
      },
    reportingState: {
      status: operationalHealth.operatorActionRequired
        ? 'attention-required'
        : acceptance.accepted
            ? 'ready-for-dispatch-export'
            : 'blocked-export-ready',
        retentionWindow: 'last-five-recorded-commands-plus-current-evaluation',
        nextCursor: exportManifest.cursors.next,
        historyComplete: persistedState.loaded,
        manifestDatasetCount: exportManifest.datasets.length,
        trendWindowCount: trendWindows.length,
        providerReliabilityProfileCount: providerReliability.length,
        canExport: true
      }
    };
}

export function describeDriverPackageSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const packageId = normalizePackageId(input.packageId);
  const persistedState = normalizePersistedState(input.persistedState, packageId, now);
  const currentState = normalizeLifecycleState(input.currentState ?? persistedState.lifecycleState);
  const requestedEnabled = typeof input.enabled === 'boolean' ? input.enabled : undefined;
  const command = normalizeCommand(input.command, currentState, requestedEnabled);
  const settings = normalizeSettings(input.settings);
  const schedule = normalizeSchedule(input.schedule);
  const clientRequest = normalizeClientRequest(input.request);
  const lifecycleTransition = buildLifecycleTransitionPolicy({
    command,
    currentState,
    requestedEnabled,
    schedule: schedule.normalized
  });
  const accessBoundary = normalizeAccessBoundary(input, clientRequest, command, schedule.normalized, packageId);
  const admissionIdempotencyKey = buildIdempotencyKey({ packageId, command, clientRequest, input });
  const commandAdmission = buildCommandAdmission({
    persistedState,
    idempotencyKey: admissionIdempotencyKey,
    clientRequest,
    command,
    settings: settings.normalized,
    now,
    accessBoundary,
    packageId
  });
  const validationIssues = [
    ...settings.issues,
    ...schedule.issues,
    ...lifecycleTransition.issues,
    ...accessBoundary.issues,
    ...commandAdmission.issues
  ];
  const validationOk = validationIssues.length === 0;
  const providerContracts = normalizeProviderContracts(input.providers, command, schedule.normalized, now, accessBoundary, settings.normalized);
  const externalHandoff = buildExternalHandoff({ command, providerContracts, packageId, now });
  const scheduleActivation = buildScheduleActivationContract({
    packageId,
    command,
    currentState,
    schedule: schedule.normalized,
    lifecycleTransition,
    providerContracts,
    commandAdmission,
    now
  });
  const controls = buildControls({
    command,
    currentState,
    requestedEnabled,
    validationOk,
    schedule: schedule.normalized,
    scheduleActivation
  });
  const nextAction = buildNextAction({
    command,
    currentState,
    controls,
    validationOk,
    validationIssueReason: validationIssues[0]?.code,
    requestedEnabled,
    externalHandoff,
    commandAdmission,
    scheduleActivation
  });
  const validationSummary = buildValidationSummary(validationIssues, providerContracts, externalHandoff, command, accessBoundary, commandAdmission, scheduleActivation);
  const readiness = buildReadiness({ command, currentState, validationSummary, providerContracts, controls, nextAction, accessBoundary, commandAdmission, scheduleActivation });
  const acceptance = buildAcceptanceContract({ packageId, command, validationSummary, readiness, nextAction, externalHandoff, accessBoundary, commandAdmission, scheduleActivation, now });
  const persistence = buildPersistencePlan({
    persistedState,
    packageId,
    currentState,
    command,
    clientRequest,
    accessBoundary,
    providerContracts,
    commandAdmission,
    nextAction,
    lifecycleTransition,
    acceptance,
    now,
    input
  });
  const recovery = buildRecoveryStatus({ persistedState, currentState, command, now });
  const durableState = buildDurableStateCommit({
    packageId,
    persistedState,
    currentState,
    command,
    persistence,
    lifecycleTransition,
    commandAdmission,
    recovery,
    acceptance,
    now
  });
  const operationalHealth = buildOperationalHealthErrors({
    packageId,
    command,
    providerContracts,
    commandAdmission,
    recovery,
    validationSummary,
    externalHandoff,
    now
  });
  const kernelExecution = buildKernelExecutionContract({
    packageId,
    currentState,
    command,
    schedule: schedule.normalized,
    settings: settings.normalized,
    clientRequest,
    accessBoundary,
    providerContracts,
    persistence,
    commandAdmission,
    lifecycleTransition,
    scheduleActivation,
    acceptance,
    now
  });
  const workflowHandoff = buildWorkflowHandoff({
    clientRequest,
    packageId,
    command,
    externalHandoff,
    nextAction,
    validationSummary,
    commandAdmission,
    acceptance,
    persistence,
    now
  });
  const preview = buildPreview({
    packageId,
    currentState,
    command,
    schedule: schedule.normalized,
    settings: settings.normalized,
    providerContracts,
    nextAction,
    readiness,
    workflowHandoff,
    validationSummary,
    scheduleActivation
  });
  const nextSteps = buildExplainableNextSteps({ command, validationSummary, readiness, nextAction, externalHandoff, controls, accessBoundary, commandAdmission, scheduleActivation });
  const analytics = buildAnalyticsExports({
    packageId,
    persistedState,
    currentState,
    command,
    validationSummary,
    providerContracts,
    commandAdmission,
    acceptance,
    readiness,
    workflowHandoff,
    operationalHealth,
    persistence,
    now
  });
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  return {
    ok: acceptance.accepted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel driver package lifecycle controls/v1',
    package: {
      packageId,
      currentState,
      persistedState: persistedState.lifecycleState,
      requestedEnabled: requestedEnabled ?? currentState !== 'disabled',
      command
    },
    settings: settings.normalized,
    schedule: schedule.normalized,
    lifecycleTransition,
    request: clientRequest,
    accessBoundary,
    providerContracts,
    externalHandoff,
    scheduleActivation,
    commandAdmission,
    workflowHandoff,
    validation: {
      ok: validationOk,
      issues: validationIssues,
      summary: validationSummary
    },
    controls,
    preview,
    readiness,
    acceptance,
    kernelExecution,
    persistence,
    durableState,
    recovery,
    operationalHealth,
    analytics,
    nextAction,
    nextSteps,
    proof: {
      surfaceId,
      packageId,
      generatedAt: now,
      lifecycleCommand: command,
      validationIssueCount: validationIssues.length,
      nextAction: nextAction.type,
      blocked: nextAction.blocked,
      providerContractOk: providerContracts.ok,
      selectedProviderId: providerContracts.selectedProviderId,
      dispatchReady: kernelExecution.proofClaims.dispatchReady,
      dispatchRouteMode: kernelExecution.dispatchRoute?.mode ?? null,
      dispatchBlockedProviderIds: providerContracts.dispatchBlockedProviderIds,
      capabilityScopeBlockedProviderIds: providerContracts.capabilityScopeBlockedProviderIds,
      providerCapabilityScopeIssueCount: providerContracts.capabilityScopeIssueCount,
      providerCapabilityScopeWarningCount: providerContracts.capabilityScopeWarningCount,
      serviceContractBlockedProviderIds: providerContracts.serviceContractBlockedProviderIds,
      acknowledgementBlockedProviderIds: providerContracts.acknowledgementBlockedProviderIds,
      healthBlockedProviderIds: externalHandoff.healthBlockedProviderIds ?? [],
      providerHealthIssueCount: providerContracts.healthIssueCount,
      providerHealthWarningCount: providerContracts.healthWarningCount,
      providerAcknowledgementIssueCount: providerContracts.acknowledgementIssueCount,
      providerAcknowledgementWarningCount: providerContracts.acknowledgementWarningCount,
      providerAcknowledgementReady: kernelExecution.proofClaims.providerAcknowledgementReady,
      providerAcknowledgementState: kernelExecution.acknowledgement,
      operationalHealthState: operationalHealth.state,
      degradedModeActive: operationalHealth.degradedModeActive,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      retryBackoffAction: operationalHealth.retryBackoff.action,
      retryAfterAt: operationalHealth.retryBackoff.retryAfterAt,
      requiredServiceOperation: providerContracts.requiredServiceOperation,
      serviceContractNegotiated: kernelExecution.proofClaims.serviceContractNegotiated,
      providerCapabilityScopeSatisfied: kernelExecution.proofClaims.providerCapabilityScopeSatisfied,
      providerCapabilityGrantMatched: kernelExecution.proofClaims.providerCapabilityGrantMatched,
      tenantBoundaryBound: kernelExecution.proofClaims.tenantBoundaryBound,
      workspaceBoundaryBound: kernelExecution.proofClaims.workspaceBoundaryBound,
      actorPermissionGranted: kernelExecution.proofClaims.actorPermissionGranted,
      workspacePackageScopeAllowed: kernelExecution.proofClaims.workspacePackageScopeAllowed,
      workspacePackageScopeMatchedBy: kernelExecution.proofClaims.workspacePackageScopeMatchedBy,
      commandAdmitted: commandAdmission.admitted,
      commandAdmissionState: commandAdmission.state,
      commandAdmissionIssueCount: commandAdmission.issues.length,
      commandAdmissionWarnings: commandAdmission.warnings.map((warning) => warning.code),
      persistedCommandBoundarySafe: commandAdmission.boundary.ok,
      persistedCommandBoundaryReplayProtected: commandAdmission.boundary.replayProtected,
      persistedPendingCommandBoundary: commandAdmission.boundary.pendingCommand.persisted,
      persistedPendingCommandBoundaryMismatches: commandAdmission.boundary.pendingCommand.mismatches,
      persistedLastCommandBoundaryIgnored: commandAdmission.warnings.some((warning) => warning.code === 'command_admission.last_command_boundary_ignored'),
      lifecycleTransitionAllowed: lifecycleTransition.transitionAllowed,
      lifecycleTransitionState: lifecycleTransition.nextActionState,
      lifecycleTransitionIssues: lifecycleTransition.issues.map((issue) => issue.code),
      lifecycleTransitionWarnings: lifecycleTransition.warnings.map((warning) => warning.code),
      lifecycleDesiredState: lifecycleTransition.desiredState,
      lifecycleEnabledAfter: lifecycleTransition.enabledAfter,
      scheduleActivationState: scheduleActivation.state,
      scheduleActivationNextAction: scheduleActivation.nextAction,
      scheduleActivationCanPersist: scheduleActivation.canPersist,
      scheduleActivationCanArmDispatch: scheduleActivation.canArmDispatch,
      scheduleActivationProviderBindingRequired: scheduleActivation.providerBindingRequired,
      scheduleActivationIssues: scheduleActivation.issues.map((issue) => issue.code),
      scheduleActivationWarnings: scheduleActivation.warnings.map((warning) => warning.code),
      scheduleActivationProofClaims: scheduleActivation.proofClaims,
      availableConcurrencySlots: commandAdmission.availableConcurrencySlots,
      retryBudgetAvailable: commandAdmission.retryPlan.budgetAvailable,
      commandEnvelopeId: kernelExecution.commandEnvelope?.commandId ?? null,
      handoffRequired: externalHandoff.required,
      workflowId: workflowHandoff.workflowId,
      workflowState: workflowHandoff.state,
      resumeToken: workflowHandoff.resumeToken,
      clientMutationOperation: workflowHandoff.clientMutation.operation,
      clientMutationStorageKey: workflowHandoff.clientMutation.storageKey,
      clientMutationRouteAction: workflowHandoff.clientMutation.route.action,
      clientMutationOptimisticDispatch: workflowHandoff.clientMutation.optimisticDispatch,
      clientMutationPendingWorkflow: workflowHandoff.clientMutation.statePatch.pendingWorkflow,
      clientMutationLastCommandStatus: workflowHandoff.clientMutation.statePatch.lastCommandStatus,
      clientResumeMode: workflowHandoff.clientMutation.resumeContract.resumeMode,
      clientResumeRouteIntent: workflowHandoff.clientMutation.resumeContract.routeIntent,
      clientResumeTargetAction: workflowHandoff.clientMutation.resumeContract.targetAction,
      clientResumeContractOk: workflowHandoff.clientMutation.resumeContract.ok,
      clientResumeIssueCodes: workflowHandoff.clientMutation.resumeContract.issues.map((issue) => issue.code),
      clientResumeWarningCodes: workflowHandoff.clientMutation.resumeContract.warnings.map((warning) => warning.code),
      clientResumeRoutePayload: workflowHandoff.clientMutation.resumeContract.routePayload,
      clientMutationProofClaims: workflowHandoff.clientMutation.proofClaims,
      idempotencyKey: persistence.idempotencyKey,
      commandStatus: persistence.commandStatus,
      persistedRevision: persistence.loadedRevision,
      nextPersistedRevision: persistence.nextRevision,
      durableStateWriteRequired: durableState.writeRequired,
      durableStateWriteMode: durableState.writeMode,
      durableStateStorageKey: durableState.compareAndSwap.key,
      durableStateExpectedRevision: durableState.compareAndSwap.expectedRevision,
      durableStateNextRevision: durableState.compareAndSwap.nextRevision,
      durableStateConflictAction: durableState.compareAndSwap.conflictAction,
      durableStateRestartSafeStatus: durableState.restartSemantics.restartSafeStatus,
      durableStateReplayPolicy: durableState.restartSemantics.replayPolicy,
      durableStatePendingCommandId: durableState.restartSemantics.pendingCommandId,
      durableStateProofClaims: durableState.proofClaims,
      recoveryStatus: recovery.status,
      recoveryAction: recovery.recoveryAction,
      analyticsRecordedCommandCount: analytics.counters.totalRecordedCommands,
      analyticsTimelineEventCount: analytics.timeline.length,
        analyticsExportRowCount: analytics.exports.summary.rows.length,
        analyticsReportingStatus: analytics.reportingState.status,
        analyticsNextCursor: analytics.reportingState.nextCursor,
        analyticsManifestDatasetCount: analytics.exports.manifest.datasets.length,
        analyticsTrendWindowCount: analytics.trendWindows.length,
        analyticsStatusTransitionCount: analytics.statusTransitions.length,
        analyticsProviderReliabilityProfileCount: analytics.providerReliability.length,
        analyticsProviderReliabilityScores: analytics.providerReliability.map((profile) => ({
          providerId: profile.providerId,
          reliabilityScore: profile.reliabilityScore,
          observedCommandCount: profile.observedCommandCount,
          canServeCurrentCommand: profile.canServeCurrentCommand
        })),
        readinessState: readiness.state,
        acceptanceDecision: acceptance.decision,
        validationStatus: validationSummary.status,
        validationBlockingReason: validationSummary.blockingReason,
        validationPrimaryAction: validationSummary.routeHints.primaryAction,
        validationDefaultSection: validationSummary.routeHints.defaultSection,
        validationIssueSections: validationSummary.sections.map((section) => ({
          id: section.id,
          status: section.status,
          issueCount: section.issueCount,
          blockingIssueCount: section.blockingIssueCount
        })),
        validationRepairRequired: validationSummary.clientRepair.required,
        validationProofClaims: validationSummary.proofClaims,
      kernelExecutionState: kernelExecution.state,
      proofClaims: kernelExecution.proofClaims
    },
    audit: {
      eventType: 'driver-package.lifecycle.evaluated',
      subject: packageId,
      stateBefore: currentState,
      command,
      decision: acceptance.decision,
      reason: acceptance.rejectionReason ?? nextAction.reason,
      providerId: providerContracts.selectedProviderId,
      providerAcknowledgement: kernelExecution.acknowledgement,
      acknowledgementBlockedProviderIds: providerContracts.acknowledgementBlockedProviderIds,
      dispatchState: kernelExecution.state,
      dispatchRouteMode: kernelExecution.dispatchRoute?.mode ?? null,
      dispatchBlockedProviderIds: providerContracts.dispatchBlockedProviderIds,
      capabilityScopeBlockedProviderIds: providerContracts.capabilityScopeBlockedProviderIds,
      capabilityScopeIssueCount: providerContracts.capabilityScopeIssueCount,
      capabilityScopeWarningCount: providerContracts.capabilityScopeWarningCount,
      selectedProviderCapabilityPolicy: providerContracts.selectedDispatch?.capabilityPolicy ?? null,
      requiredAuditEvents: kernelExecution.requiredAuditEvents,
      handoffState: externalHandoff.state,
      workflowId: workflowHandoff.workflowId,
      workflowState: workflowHandoff.state,
      workflowClientMutation: workflowHandoff.clientMutation.auditEvent,
      workflowResumeContract: {
        resumeMode: workflowHandoff.clientMutation.resumeContract.resumeMode,
        routeIntent: workflowHandoff.clientMutation.resumeContract.routeIntent,
        targetSurface: workflowHandoff.clientMutation.resumeContract.targetSurface,
        targetAction: workflowHandoff.clientMutation.resumeContract.targetAction,
        ok: workflowHandoff.clientMutation.resumeContract.ok,
        issues: workflowHandoff.clientMutation.resumeContract.issues.map((issue) => issue.code),
        warnings: workflowHandoff.clientMutation.resumeContract.warnings.map((warning) => warning.code),
        continuesPreviousWorkflow: workflowHandoff.clientMutation.resumeContract.continuesPreviousWorkflow,
        previousWorkflowId: workflowHandoff.clientMutation.resumeContract.previousWorkflowId
      },
      channel: workflowHandoff.channel,
      actorId: workflowHandoff.actorId,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      requiredPermissions: accessBoundary.requiredPermissions,
      missingPermissions: accessBoundary.missingPermissions,
      packageScope: {
        packageId: accessBoundary.packageScope.packageId,
        scoped: accessBoundary.packageScope.scoped,
        scopeApplies: accessBoundary.packageScope.scopeApplies,
        matchedBy: accessBoundary.packageScope.matchedBy,
        packageAllowed: accessBoundary.packageScope.packageAllowed,
        allowedPackageIds: accessBoundary.packageScope.allowedPackageIds,
        allowedPackagePrefixes: accessBoundary.packageScope.allowedPackagePrefixes,
        deniedPackageIds: accessBoundary.packageScope.deniedPackageIds
      },
      commandAdmissionState: commandAdmission.state,
      commandAdmissionIssues: commandAdmission.issues.map((issue) => issue.code),
      commandAdmissionWarnings: commandAdmission.warnings.map((warning) => warning.code),
      commandAdmissionBoundary: commandAdmission.boundary,
      lifecycleTransitionState: lifecycleTransition.nextActionState,
      lifecycleTransitionAllowed: lifecycleTransition.transitionAllowed,
      lifecycleTransitionIssues: lifecycleTransition.issues.map((issue) => issue.code),
      lifecycleTransitionWarnings: lifecycleTransition.warnings.map((warning) => warning.code),
      lifecycleDesiredState: lifecycleTransition.desiredState,
      lifecycleEnabledBefore: lifecycleTransition.enabledBefore,
      lifecycleEnabledAfter: lifecycleTransition.enabledAfter,
      scheduleActivation: {
        state: scheduleActivation.state,
        nextAction: scheduleActivation.nextAction,
        canPersist: scheduleActivation.canPersist,
        canArmDispatch: scheduleActivation.canArmDispatch,
        providerBindingRequired: scheduleActivation.providerBindingRequired,
        issues: scheduleActivation.issues.map((issue) => issue.code),
        warnings: scheduleActivation.warnings.map((warning) => warning.code),
        proofClaims: scheduleActivation.proofClaims
      },
      scheduleActivationAuditEvent: scheduleActivation.auditEvent,
      validationPanel: {
        status: validationSummary.status,
        blockingReason: validationSummary.blockingReason,
        primaryAction: validationSummary.routeHints.primaryAction,
        defaultSection: validationSummary.routeHints.defaultSection,
        repair: validationSummary.clientRepair,
        sections: validationSummary.sections.map((section) => ({
          id: section.id,
          status: section.status,
          issueCount: section.issueCount,
          blockingIssueCount: section.blockingIssueCount,
          primaryIssueCode: section.primaryIssueCode
        }))
      },
      pendingCommandId: commandAdmission.pendingCommand?.commandId ?? null,
      availableConcurrencySlots: commandAdmission.availableConcurrencySlots,
      readinessState: readiness.state,
      acceptRef: acceptance.acceptRef,
      persistedRevision: persistence.loadedRevision,
      nextPersistedRevision: persistence.nextRevision,
      durableStateWriteMode: durableState.writeMode,
      durableStateWriteRequired: durableState.writeRequired,
      durableStateCompareAndSwap: durableState.compareAndSwap,
      durableStateRestartSemantics: durableState.restartSemantics,
      durableStateAuditEvent: durableState.auditEvent,
      commandStatus: persistence.commandStatus,
      recoveryStatus: recovery.status,
      operationalHealthState: operationalHealth.state,
      operatorActionRequired: operationalHealth.operatorActionRequired,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
        analyticsExportRowCount: analytics.exports.summary.rows.length,
        analyticsReportingStatus: analytics.reportingState.status,
        analyticsManifest: analytics.exports.manifest,
        analyticsTrendWindows: analytics.trendWindows,
        analyticsProviderReliability: analytics.providerReliability,
        analyticsStatusTransitions: analytics.statusTransitions,
        analyticsCounters: analytics.counters
      },
    evidence
  };
}

export default describeDriverPackageSurface;
