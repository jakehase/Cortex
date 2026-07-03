export const surfaceId = "aios_operator-userland_cli-ps_084";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-ps";

const TERMINAL_STATES = new Set(['exited', 'failed', 'killed']);
const DEGRADED_STATES = new Set(['starting', 'retrying', 'degraded']);
const LIVE_STATES = new Set(['running', 'sleeping', 'idle']);
const HISTORY_LIMIT = 12;
const DEFAULT_RETRY_POLICY = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 5,
};
const REQUIRED_PROVIDER_CAPABILITIES = [
  'process-table.v1',
  'lifecycle-state.v1',
  'retry-policy.v1',
  'audit-evidence.v1',
];
const OPTIONAL_PROVIDER_CAPABILITIES = [
  'streaming-sync.v1',
  'external-handoff.v1',
  'operator-actions.v1',
];
const REQUIRED_PROVIDER_OPERATIONS = [
  {
    operation: 'listProcesses',
    capability: 'process-table.v1',
    direction: 'read',
    syncMode: 'snapshot',
    minConsistency: 'fresh',
  },
  {
    operation: 'getLifecycleState',
    capability: 'lifecycle-state.v1',
    direction: 'read',
    syncMode: 'snapshot',
    minConsistency: 'eventual',
  },
  {
    operation: 'readRetryPolicy',
    capability: 'retry-policy.v1',
    direction: 'read',
    syncMode: 'snapshot',
    minConsistency: 'eventual',
  },
  {
    operation: 'appendAuditEvidence',
    capability: 'audit-evidence.v1',
    direction: 'write',
    syncMode: 'append',
    minConsistency: 'eventual',
  },
];
const OPTIONAL_PROVIDER_OPERATIONS = [
  {
    operation: 'streamProcessDeltas',
    capability: 'streaming-sync.v1',
    direction: 'read',
    syncMode: 'stream',
    minConsistency: 'fresh',
  },
  {
    operation: 'dispatchOperatorAction',
    capability: 'operator-actions.v1',
    direction: 'write',
    syncMode: 'command',
    minConsistency: 'fresh',
  },
  {
    operation: 'openSupervisorHandoff',
    capability: 'external-handoff.v1',
    direction: 'write',
    syncMode: 'handoff',
    minConsistency: 'eventual',
  },
];
const SUPPORTED_CLIENT_COMMANDS = new Set(['ps', 'status', 'watch', 'inspect', 'handoff']);
const SUPPORTED_OPERATOR_ACTIONS = new Set(['inspect', 'restart', 'kill']);
const SUPPORTED_LIFECYCLE_CONTROL_ACTIONS = new Set(['enable', 'disable', 'schedule']);
const SUPPORTED_ANALYTICS_EXPORT_ARTIFACTS = new Set(['summary', 'processes', 'history', 'incidents']);
const SUPPORTED_ANALYTICS_EXPORT_CHANNELS = new Set([
  'console',
  'file',
  'audit-log',
  'supervisor-handoff',
]);
const LIFECYCLE_CONTROL_ALIASES = {
  autoretry: 'auto-retry',
  'auto-retry': 'auto-retry',
  autorestart: 'auto-restart',
  'auto-restart': 'auto-restart',
  handoff: 'external-handoff',
  'external-handoff': 'external-handoff',
  operatoractions: 'operator-actions',
  'operator-actions': 'operator-actions',
  streaming: 'streaming-sync',
  streamingsync: 'streaming-sync',
  'streaming-sync': 'streaming-sync',
};
const LIFECYCLE_CONTROL_CAPABILITIES = {
  'external-handoff': 'external-handoff.v1',
  'operator-actions': 'operator-actions.v1',
  'streaming-sync': 'streaming-sync.v1',
};
const DEFAULT_SCOPE_ROLE = 'process.viewer';
const DEFAULT_SCOPE_PERMISSION = 'process.read';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isoNow(input) {
  if (typeof input.now === 'string' && !Number.isNaN(Date.parse(input.now))) {
    return input.now;
  }
  return new Date().toISOString();
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function percent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function clampInteger(value, fallback, min, max) {
  const number = Math.floor(normalizeNumber(value, fallback));
  return Math.min(max, Math.max(min, number));
}

function stableJson(value) {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function lightweightChecksum(value) {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeDependencyCheck(check, index, generatedAt) {
  const object = check && typeof check === 'object' ? check : {};
  const name = cleanString(object.name ?? object.id ?? object.service ?? check, `dependency-${index + 1}`);
  const rawStatus = cleanString(object.status ?? object.state ?? object.health, 'unknown').toLowerCase();
  const status = rawStatus === 'ok' || rawStatus === 'ready'
    ? 'available'
    : rawStatus === 'missing' || rawStatus === 'failed' || rawStatus === 'timeout'
      ? rawStatus
      : rawStatus === 'unhealthy'
        ? 'failed'
        : 'unknown';
  const required = object.required !== false && object.optional !== true;
  const retryAfterMs = object.retryAfterMs === null || object.retryAfterMs === undefined
    ? null
    : normalizeNumber(object.retryAfterMs, 0);
  const failed = status === 'missing'
    || status === 'failed'
    || status === 'timeout'
    || status === 'unavailable';

  return {
    name,
    status,
    required,
    failed,
    retryAfterMs,
    lastCheckedAt: cleanString(object.lastCheckedAt ?? object.checkedAt, generatedAt),
    message: cleanString(
      object.message ?? object.error,
      failed
        ? `${required ? 'Required' : 'Optional'} dependency ${name} is ${status}.`
        : '',
    ) || null,
    action: cleanString(
      object.action ?? object.remediation,
      failed
        ? required
          ? 'Restore the dependency or route this process to supervisor handoff before dispatch.'
          : 'Continue in degraded mode or restore the optional dependency.'
        : '',
    ) || null,
  };
}

function normalizeProcessDependencyHealth(process, generatedAt) {
  const source = process.preflight && typeof process.preflight === 'object'
    ? process.preflight
    : process.healthChecks && typeof process.healthChecks === 'object'
      ? process.healthChecks
      : process;
  const reportedChecks = asArray(
    source.dependencies
      ?? source.dependencyChecks
      ?? source.requiredDependencies,
  );
  const missingRequired = asArray(source.missingDependencies ?? source.unavailableDependencies)
    .map((dependency) => ({
      ...(dependency && typeof dependency === 'object' ? dependency : { name: dependency }),
      status: 'missing',
      required: true,
    }));
  const missingOptional = asArray(source.optionalMissingDependencies ?? source.degradedDependencies)
    .map((dependency) => ({
      ...(dependency && typeof dependency === 'object' ? dependency : { name: dependency }),
      status: 'missing',
      required: false,
    }));
  const checks = [
    ...reportedChecks,
    ...missingRequired,
    ...missingOptional,
  ]
    .map((check, index) => normalizeDependencyCheck(check, index, generatedAt))
    .filter((check) => check.name)
    .slice(0, 20);
  const requiredFailures = checks.filter((check) => check.required && check.failed);
  const optionalFailures = checks.filter((check) => !check.required && check.failed);
  const retryableFailures = [...requiredFailures, ...optionalFailures]
    .filter((check) => check.retryAfterMs !== null);
  const status = requiredFailures.length
    ? 'blocked'
    : optionalFailures.length
      ? 'degraded'
      : checks.length
        ? 'clear'
        : 'not-reported';

  return {
    schema: 'hosted-kernel.cli-ps.process-dependency-health/v1',
    status,
    checkedCount: checks.length,
    requiredFailureCount: requiredFailures.length,
    optionalFailureCount: optionalFailures.length,
    restartEligible: requiredFailures.length === 0,
    retryEligible: retryableFailures.length > 0,
    nextRetryDelayMs: retryableFailures
      .map((check) => check.retryAfterMs)
      .filter((value) => value !== null)
      .sort((left, right) => left - right)[0] ?? null,
    failedNames: [...requiredFailures, ...optionalFailures].map((check) => check.name),
    checks,
  };
}

function normalizeRetryPolicy(input = {}) {
  const retryPolicy = input.retryPolicy || {};
  return {
    baseDelayMs: normalizeNumber(retryPolicy.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs),
    maxDelayMs: normalizeNumber(retryPolicy.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs),
    maxAttempts: normalizeNumber(retryPolicy.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts),
  };
}

function normalizeCapabilityList(value) {
  return [...new Set(asArray(value)
    .map((capability) => cleanString(capability).toLowerCase())
    .filter(Boolean))].sort();
}

function normalizeAccessList(value, fallback = []) {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const normalized = normalizeCapabilityList(values);
  return normalized.length ? normalized : fallback;
}

function collectAccessValues(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value;
    }
    return value === undefined || value === null ? [] : [value];
  });
}

function hasAny(available, required) {
  if (!required.length) {
    return true;
  }
  const availableSet = new Set(available);
  return required.some((item) => availableSet.has(item));
}

function normalizeScopePolicy(input = {}) {
  const operator = input.operator && typeof input.operator === 'object' ? input.operator : {};
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : {};
  const tenantId = cleanString(
    scope.tenantId ?? operator.tenantId ?? input.tenantId,
    'tenant-default',
  ).toLowerCase();
  const workspaceId = cleanString(
    scope.workspaceId ?? operator.workspaceId ?? input.workspaceId,
    'workspace-default',
  ).toLowerCase();
  const roles = normalizeAccessList(
    collectAccessValues(operator.roles, scope.roles, input.roles),
    [DEFAULT_SCOPE_ROLE],
  );
  const permissions = normalizeAccessList(
    collectAccessValues(operator.permissions, scope.permissions, input.permissions),
    [DEFAULT_SCOPE_PERMISSION],
  );
  const allowedTenantIds = normalizeAccessList(scope.allowedTenantIds ?? scope.tenants, [tenantId]);
  const allowedWorkspaceIds = normalizeAccessList(
    scope.allowedWorkspaceIds ?? scope.workspaces,
    [workspaceId],
  );

  return {
    schema: 'hosted-kernel.cli-ps.scope-policy/v1',
    tenantId,
    workspaceId,
    operatorId: cleanString(operator.id ?? input.operatorId, 'operator-unknown'),
    roles,
    permissions,
    allowedTenantIds,
    allowedWorkspaceIds,
    enforceTenantBoundary: scope.enforceTenantBoundary !== false,
    enforceWorkspaceBoundary: scope.enforceWorkspaceBoundary !== false,
    defaultRequiredRole: cleanString(scope.defaultRequiredRole, DEFAULT_SCOPE_ROLE).toLowerCase(),
    defaultRequiredPermission: cleanString(
      scope.defaultRequiredPermission,
      DEFAULT_SCOPE_PERMISSION,
    ).toLowerCase(),
  };
}

function normalizeProcessBoundary(process, scopePolicy) {
  const tenantId = cleanString(
    process.tenantId ?? process.tenant ?? process.boundary?.tenantId,
    scopePolicy.tenantId,
  ).toLowerCase();
  const workspaceId = cleanString(
    process.workspaceId ?? process.workspace ?? process.boundary?.workspaceId,
    scopePolicy.workspaceId,
  ).toLowerCase();
  const requiredRoles = normalizeAccessList(
    process.requiredRoles ?? process.requiredRole ?? process.boundary?.requiredRoles,
    [scopePolicy.defaultRequiredRole],
  );
  const requiredPermissions = normalizeAccessList(
    process.requiredPermissions ?? process.requiredPermission ?? process.boundary?.requiredPermissions,
    [scopePolicy.defaultRequiredPermission],
  );

  return {
    tenantId,
    workspaceId,
    requiredRoles,
    requiredPermissions,
  };
}

function normalizeProcessJob(process, index) {
  const source = process.job && typeof process.job === 'object' ? process.job : {};
  const jobId = cleanString(
    source.id ?? source.jobId ?? process.jobId ?? process.taskId,
    `job-${index + 1}`,
  );

  return {
    schema: 'hosted-kernel.cli-ps.process-job/v1',
    id: jobId,
    name: cleanString(source.name ?? source.commandName ?? process.jobName, process.command ?? 'unknown'),
    queue: cleanString(source.queue ?? process.queue, 'default'),
    shard: cleanString(source.shard ?? source.partition ?? process.shard, 'primary'),
    attempt: normalizeNumber(source.attempt ?? process.attempt, 1),
    priority: cleanString(source.priority ?? process.priority, 'normal').toLowerCase(),
  };
}

function normalizeProcessThread(process, index) {
  const source = process.thread && typeof process.thread === 'object' ? process.thread : {};
  const threadId = cleanString(
    source.id ?? source.threadId ?? process.threadId,
    `thread-${index + 1}`,
  );

  return {
    schema: 'hosted-kernel.cli-ps.process-thread/v1',
    id: threadId,
    groupId: cleanString(source.groupId ?? source.threadGroupId ?? process.threadGroupId, 'main'),
    parentPid: cleanString(source.parentPid ?? source.parentProcessId ?? process.parentPid, ''),
    lane: cleanString(source.lane ?? source.pool ?? process.threadLane, 'worker'),
    ordinal: normalizeNumber(source.ordinal ?? source.index ?? process.threadIndex, index),
    blockedOn: cleanString(source.blockedOn ?? source.waitingFor ?? process.blockedOn, '') || null,
  };
}

function normalizeProcessLease(process, generatedAt) {
  const source = process.lease && typeof process.lease === 'object'
    ? process.lease
    : process.kernelLease && typeof process.kernelLease === 'object'
      ? process.kernelLease
      : {};
  const acquiredAt = cleanString(source.acquiredAt ?? source.startedAt ?? process.leaseAcquiredAt, '');
  const expiresAt = cleanString(source.expiresAt ?? source.deadlineAt ?? process.leaseExpiresAt, '');
  const expiresMs = Date.parse(expiresAt);
  const generatedMs = Date.parse(generatedAt);
  const expired = Boolean(expiresAt && !Number.isNaN(expiresMs) && !Number.isNaN(generatedMs) && expiresMs <= generatedMs);
  const ttlMs = expiresAt && !Number.isNaN(expiresMs) && !Number.isNaN(generatedMs)
    ? Math.max(0, expiresMs - generatedMs)
    : normalizeNumber(source.ttlMs ?? source.remainingMs ?? process.leaseTtlMs, 0);

  return {
    schema: 'hosted-kernel.cli-ps.process-lease/v1',
    id: cleanString(source.id ?? source.leaseId ?? process.leaseId, ''),
    holder: cleanString(source.holder ?? source.owner ?? process.leaseHolder, ''),
    acquiredAt: acquiredAt || null,
    expiresAt: expiresAt || null,
    ttlMs,
    expired,
    renewable: source.renewable !== false && process.leaseRenewable !== false,
    state: expired
      ? 'expired'
      : expiresAt || source.id || process.leaseId
        ? 'held'
        : 'not-reported',
  };
}

function normalizeExitContract(process) {
  const source = process.exitContract && typeof process.exitContract === 'object'
    ? process.exitContract
    : process.exit && typeof process.exit === 'object'
      ? process.exit
      : {};
  const expectedCodes = asArray(
    source.expectedCodes ?? source.successCodes ?? process.expectedExitCodes,
  )
    .map((code) => normalizeNumber(code, 0))
    .slice(0, 12);
  const exitCode = process.exitCode === null || process.exitCode === undefined
    ? null
    : normalizeNumber(process.exitCode, 0);
  const expected = exitCode === null
    || expectedCodes.length === 0
    || expectedCodes.includes(exitCode);

  return {
    schema: 'hosted-kernel.cli-ps.process-exit-contract/v1',
    expectedCodes,
    observedCode: exitCode,
    expected,
    signal: cleanString(source.signal ?? process.exitSignal, '') || null,
    cleanup: cleanString(source.cleanup ?? source.cleanupPolicy ?? process.cleanupPolicy, 'best-effort'),
    onExit: cleanString(source.onExit ?? source.action ?? process.onExit, 'record-and-report'),
    reason: expected
      ? 'exit-code-within-contract-or-not-observed'
      : 'observed-exit-code-outside-contract',
  };
}

function normalizeProviderContract(input = {}) {
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const contract = input.providerContract && typeof input.providerContract === 'object'
    ? input.providerContract
    : {};
  const advertisedCapabilities = normalizeCapabilityList([
    ...asArray(provider.capabilities),
    ...asArray(contract.capabilities),
    ...asArray(input.capabilities),
  ]);
  const providerId = cleanString(provider.id ?? contract.providerId, 'hosted-kernel.provider');
  const serviceName = cleanString(provider.service ?? contract.service, 'hosted-kernel.process-table');
  const contractVersion = cleanString(contract.version ?? provider.contractVersion, 'v1');

  return {
    providerId,
    serviceName,
    contractVersion,
    endpoint: cleanString(provider.endpoint ?? contract.endpoint, ''),
    advertisedCapabilities,
    requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    optionalCapabilities: OPTIONAL_PROVIDER_CAPABILITIES,
    rawProvider: provider,
    rawContract: contract,
  };
}

function normalizeProviderOperation(operation, index, fallback = {}) {
  const object = operation && typeof operation === 'object' ? operation : {};
  const name = cleanString(
    object.operation ?? object.name ?? object.action ?? operation,
    fallback.operation || `operation-${index + 1}`,
  );
  const capability = cleanString(object.capability ?? fallback.capability, '').toLowerCase();
  const endpoint = cleanString(object.endpoint ?? object.url ?? object.route ?? fallback.endpoint, '');
  const method = cleanString(object.method ?? fallback.method, fallback.direction === 'write' ? 'POST' : 'GET')
    .toUpperCase();
  const direction = cleanString(object.direction ?? object.mode ?? fallback.direction, 'read').toLowerCase();
  const syncMode = cleanString(object.syncMode ?? object.sync ?? fallback.syncMode, 'snapshot').toLowerCase();
  const minConsistency = cleanString(
    object.minConsistency ?? object.consistency ?? fallback.minConsistency,
    'eventual',
  ).toLowerCase();

  return {
    schema: 'hosted-kernel.cli-ps.provider-operation/v1',
    operation: name,
    capability,
    endpoint,
    method,
    direction: direction === 'write' ? 'write' : 'read',
    syncMode,
    minConsistency,
    timeoutMs: normalizeNumber(object.timeoutMs ?? fallback.timeoutMs, direction === 'write' ? 5_000 : 2_000),
    idempotent: object.idempotent !== false && direction !== 'write'
      ? true
      : object.idempotent === true || syncMode === 'append',
    proofRef: cleanString(
      object.proofRef ?? object.proof ?? fallback.proofRef,
      `${capability || 'capability-unknown'}:${name}`,
    ),
  };
}

function buildProviderServiceContracts(providerContract, validation) {
  const provider = providerContract.rawProvider || {};
  const contract = providerContract.rawContract || {};
  const advertisedOperations = asArray(
    provider.operations
      ?? provider.serviceOperations
      ?? contract.operations
      ?? contract.serviceOperations,
  );
  const capabilitySet = new Set(providerContract.advertisedCapabilities);
  const defaultOperations = [
    ...REQUIRED_PROVIDER_OPERATIONS,
    ...OPTIONAL_PROVIDER_OPERATIONS,
  ]
    .filter((operation) => capabilitySet.has(operation.capability))
    .map((operation) => ({
      ...operation,
      endpoint: providerContract.endpoint,
      proofRef: `capability-derived:${operation.capability}`,
    }));
  const normalizedAdvertised = (advertisedOperations.length ? advertisedOperations : defaultOperations)
    .map((operation, index) => normalizeProviderOperation(operation, index))
    .filter((operation) => operation.operation)
    .slice(0, 24);
  const operationByName = new Map(normalizedAdvertised.map((operation) => [operation.operation, operation]));
  const shapeRequirement = (requirement, required) => {
    const advertised = operationByName.get(requirement.operation);
    const capabilityAccepted = capabilitySet.has(requirement.capability);
    const endpointPresent = Boolean(advertised?.endpoint || providerContract.endpoint);
    const accepted = Boolean(validation.ok && advertised && capabilityAccepted && endpointPresent);
    return {
      schema: 'hosted-kernel.cli-ps.provider-service-operation-contract/v1',
      operation: requirement.operation,
      required,
      accepted,
      status: accepted ? 'accepted' : required ? 'blocked' : 'unavailable',
      capability: requirement.capability,
      capabilityAccepted,
      endpoint: advertised?.endpoint || providerContract.endpoint || null,
      method: advertised?.method || (requirement.direction === 'write' ? 'POST' : 'GET'),
      direction: requirement.direction,
      syncMode: advertised?.syncMode || requirement.syncMode,
      minConsistency: requirement.minConsistency,
      idempotent: advertised?.idempotent ?? requirement.direction !== 'write',
      reason: accepted
        ? 'provider-operation-contract-accepted'
        : !validation.ok
          ? 'input-validation-failed'
          : !advertised
            ? 'provider-operation-not-advertised'
            : !capabilityAccepted
              ? 'provider-capability-missing'
              : 'provider-endpoint-missing',
      proofRef: advertised?.proofRef || `required:${requirement.capability}:${requirement.operation}`,
    };
  };
  const requiredContracts = REQUIRED_PROVIDER_OPERATIONS
    .map((requirement) => shapeRequirement(requirement, true));
  const optionalContracts = OPTIONAL_PROVIDER_OPERATIONS
    .map((requirement) => shapeRequirement(requirement, false));
  const blockedRequired = requiredContracts.filter((contract) => !contract.accepted);
  const acceptedWriteOperations = [...requiredContracts, ...optionalContracts]
    .filter((contract) => contract.accepted && contract.direction === 'write');
  const errors = blockedRequired.map((contract) => ({
    code: 'CLI_PS_PROVIDER_OPERATION_CONTRACT_BLOCKED',
    path: `providerContract.operations.${contract.operation}`,
    message: `Provider service contract cannot satisfy cli-ps operation ${contract.operation}.`,
    action: contract.reason === 'provider-operation-not-advertised'
      ? `Advertise operation ${contract.operation} for capability ${contract.capability}.`
      : contract.reason === 'provider-endpoint-missing'
        ? 'Provide provider.endpoint or an operation endpoint for hosted-kernel dispatch.'
        : 'Reconcile provider capabilities before trusting cli-ps service operations.',
  }));

  return {
    schema: 'hosted-kernel.cli-ps.provider-service-contracts/v1',
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    advertisedOperationCount: normalizedAdvertised.length,
    acceptedRequiredCount: requiredContracts.length - blockedRequired.length,
    blockedRequiredCount: blockedRequired.length,
    acceptedOptionalCount: optionalContracts.filter((contract) => contract.accepted).length,
    state: blockedRequired.length ? 'blocked' : 'accepted',
    requiredContracts,
    optionalContracts,
    advertisedOperations: normalizedAdvertised,
    writableAuditSink: acceptedWriteOperations.some((operation) => operation.operation === 'appendAuditEvidence'),
    supervisorHandoffSink: optionalContracts
      .find((operation) => operation.operation === 'openSupervisorHandoff' && operation.accepted) || null,
    blockedReasons: blockedRequired.map((contract) => ({
      operation: contract.operation,
      reason: contract.reason,
      capability: contract.capability,
    })),
    validation: {
      ok: errors.length === 0,
      errors,
    },
    proof: {
      source: advertisedOperations.length ? 'provider-advertised-operations' : 'capability-derived-operations',
      requiredOperationNames: REQUIRED_PROVIDER_OPERATIONS.map((operation) => operation.operation),
      optionalOperationNames: OPTIONAL_PROVIDER_OPERATIONS.map((operation) => operation.operation),
      capabilityChecksum: lightweightChecksum(providerContract.advertisedCapabilities),
      operationChecksum: lightweightChecksum(normalizedAdvertised),
    },
  };
}

function normalizeClientRequest(input = {}, generatedAt) {
  const request = input.request && typeof input.request === 'object'
    ? input.request
    : input.clientRequest && typeof input.clientRequest === 'object'
      ? input.clientRequest
      : input.cliRequest && typeof input.cliRequest === 'object'
        ? input.cliRequest
        : {};
  const command = cleanString(request.command ?? request.intent ?? input.command, 'ps')
    .toLowerCase();
  const requestedHandoff = request.handoff === true
    || request.workflow === 'handoff'
    || command === 'handoff';
  const validCommand = SUPPORTED_CLIENT_COMMANDS.has(command);
  const requestId = cleanString(
    request.id ?? request.requestId ?? input.requestId,
    `cli-ps:${generatedAt}`,
  );
  const clientId = cleanString(request.clientId ?? input.clientId, 'operator-cli');
  const correlationId = cleanString(
    request.correlationId ?? input.correlationId,
    `${clientId}:${requestId}`,
  );
  const args = asArray(request.args ?? input.args)
    .map((arg) => cleanString(arg))
    .filter(Boolean);
  const targetPid = cleanString(
    request.pid
      ?? request.processId
      ?? request.targetPid
      ?? request.target
      ?? input.pid
      ?? input.processId
      ?? args[0],
    '',
  );
  const errors = validCommand
    ? []
    : [{
        code: 'CLI_PS_CLIENT_COMMAND_UNSUPPORTED',
        path: 'request.command',
        message: 'cli-ps received a client command outside the hosted-kernel workflow contract.',
        action: `Use one of: ${[...SUPPORTED_CLIENT_COMMANDS].join(', ')}.`,
      }];

  return {
    schema: 'hosted-kernel.cli-ps.client-request/v1',
    requestId,
    clientId,
    correlationId,
    command,
    args,
    validCommand,
    interactive: request.interactive !== false,
    dryRun: request.dryRun !== false,
    submittedAt: cleanString(request.submittedAt ?? request.createdAt, generatedAt),
    sourceCursor: cleanString(request.sourceCursor ?? request.cursor, ''),
    requestedView: cleanString(
      request.view ?? request.panel,
      command === 'watch'
        ? 'timeline'
        : command === 'inspect'
          ? 'process-inspect'
          : 'process-table',
    ),
    targetPid: targetPid || null,
    targetSelector: {
      kind: targetPid ? 'pid' : 'none',
      value: targetPid || null,
      source: targetPid && args[0] === targetPid
        ? 'argv'
        : targetPid
          ? 'request'
          : 'not-provided',
    },
    requestedHandoff,
    preferredHandoffTarget: cleanString(request.handoffTarget ?? request.target, ''),
    validation: {
      ok: errors.length === 0,
      errors,
    },
    proof: {
      source: request === input ? 'input-root' : 'client-request-input',
      commandSet: [...SUPPORTED_CLIENT_COMMANDS],
      defaultedCommand: !request.command && !request.intent && !input.command,
    },
  };
}

function buildInspectPanelContract({
  generatedAt,
  clientRequest,
  processes,
  scopedProcessView,
  processTablePresentation,
  operationalHealthTriage,
  syncMetadata,
  restartStatus,
}) {
  const requestedPid = cleanString(clientRequest.targetPid, '');
  const visibleByPid = new Map(processes.map((process) => [process.pid, process]));
  const rowByPid = new Map(processTablePresentation.rows.map((row) => [row.pid, row]));
  const deniedByPid = new Map(scopedProcessView.denied.map((process) => [process.pid, process]));
  const targetProcess = requestedPid ? visibleByPid.get(requestedPid) : null;
  const targetRow = requestedPid ? rowByPid.get(requestedPid) : null;
  const deniedRecord = requestedPid ? deniedByPid.get(requestedPid) : null;
  const targetIncidents = requestedPid
    ? operationalHealthTriage.incidents
      .filter((incident) => incident.target === requestedPid || String(incident.target).startsWith(`${requestedPid}:`))
      .slice(0, 12)
    : [];
  const state = clientRequest.command !== 'inspect'
    ? 'inactive'
    : !requestedPid
      ? 'target-required'
      : deniedRecord
        ? 'redacted'
        : targetProcess
          ? 'ready'
          : 'not-found';
  const redaction = deniedRecord
    ? {
        pid: deniedRecord.pid,
        tenantId: deniedRecord.tenantId,
        workspaceId: deniedRecord.workspaceId,
        deniedReasons: deniedRecord.deniedReasons,
        commandHash: deniedRecord.commandHash,
      }
    : null;
  const target = targetProcess
    ? {
        pid: targetProcess.pid,
        command: targetProcess.command,
        state: targetProcess.state,
        health: targetProcess.health,
        owner: targetProcess.owner,
        tenantId: targetProcess.tenantId,
        workspaceId: targetProcess.workspaceId,
        uptimeMs: targetProcess.uptimeMs,
        restartCount: targetProcess.restartCount,
        exitCode: targetProcess.exitCode,
        lastError: targetProcess.lastError,
        job: targetProcess.job,
        thread: targetProcess.thread,
        lease: targetProcess.lease,
        exitContract: targetProcess.exitContract,
        dependencyHealth: targetProcess.dependencyHealth,
        retry: targetProcess.retry,
        authority: targetRow?.authority || null,
        attention: targetRow?.attention || [],
        recoveryPosture: targetRow?.recoveryPosture || null,
        operatorHint: targetRow?.operatorHint || null,
      }
    : null;
  const nextAction = state === 'ready'
    ? targetIncidents[0]
      ? {
          action: targetIncidents[0].retryEligible ? 'retry-or-refresh' : 'operator-review',
          target: targetIncidents[0].target,
          label: targetIncidents[0].operatorAction,
        }
      : targetProcess.retry.retryable && targetProcess.retry.attemptsRemaining > 0
        ? {
            action: 'schedule-retry',
            target: targetProcess.pid,
            label: `Retry is available after ${targetProcess.retry.nextRetryDelayMs}ms.`,
          }
        : {
            action: 'continue-monitoring',
            target: targetProcess.pid,
            label: 'No immediate inspect action is required for this process.',
          }
    : state === 'redacted'
      ? {
          action: 'review-scope-boundary',
          target: requestedPid,
          label: 'Review scope boundary proof before inspecting this process.',
        }
      : state === 'not-found'
        ? {
            action: 'refresh-process-table',
            target: syncMetadata.cursor,
            label: 'Refresh the hosted-kernel process table or verify the requested PID.',
          }
        : {
            action: 'provide-pid',
            target: clientRequest.requestId,
            label: 'Provide a process PID to inspect.',
          };

  return {
    schema: 'hosted-kernel.cli-ps.inspect-panel/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state,
    requestedPid: requestedPid || null,
    routePath: requestedPid
      ? `/operator-userland/cli-ps/processes/${encodeURIComponent(requestedPid)}`
      : '/operator-userland/cli-ps/processes/:pid',
    target,
    redaction,
    incidents: targetIncidents.map((incident) => ({
      id: incident.id,
      severity: incident.severity,
      category: incident.category,
      code: incident.code,
      message: incident.message,
      operatorAction: incident.operatorAction,
      retryEligible: incident.retryEligible,
      notBefore: incident.notBefore || null,
      proof: incident.proof,
    })),
    controls: {
      canRestart: Boolean(targetProcess && targetProcess.retry.retryable && targetProcess.retry.attemptsRemaining > 0),
      canKill: Boolean(targetProcess && targetProcess.health !== 'healthy'),
      canHandoff: state === 'redacted' || operationalHealthTriage.degradedMode.active,
      readOnly: syncMetadata.stale || state !== 'ready',
      replayPolicy: restartStatus.commandReplaySafe ? 'at-most-once' : 'blocked-until-fresh-sync',
    },
    nextAction,
    proof: {
      processTableChecksum: processTablePresentation.proof.rowChecksum,
      syncCursor: syncMetadata.cursor,
      syncConsistency: syncMetadata.consistency,
      scopeBoundary: scopedProcessView.proof.boundary,
      targetChecksum: lightweightChecksum({
        requestedPid,
        state,
        health: targetProcess?.health || null,
        attention: targetRow?.attention || [],
        recoveryPostureState: targetRow?.recoveryPosture?.state || null,
        deniedReasons: deniedRecord?.deniedReasons || [],
      }),
    },
  };
}

function mergeValidation(...validations) {
  const errors = validations.flatMap((validation) => asArray(validation?.errors));
  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildCapabilityNegotiation(providerContract, validation) {
  const advertised = new Set(providerContract.advertisedCapabilities);
  const missingRequired = providerContract.requiredCapabilities
    .filter((capability) => !advertised.has(capability));
  const acceptedRequired = providerContract.requiredCapabilities
    .filter((capability) => advertised.has(capability));
  const acceptedOptional = providerContract.optionalCapabilities
    .filter((capability) => advertised.has(capability));

  return {
    schema: 'hosted-kernel.cli-ps.capability-negotiation/v1',
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    status: validation.ok && missingRequired.length === 0 ? 'accepted' : 'degraded',
    acceptedRequired,
    acceptedOptional,
    missingRequired,
    nextAction: missingRequired.length
      ? 'Request a provider upgrade before trusting lifecycle or retry state.'
      : 'Provider can supply process state, retry metadata, and audit evidence.',
  };
}

function retryDelayMs(attempt, retryPolicy) {
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  return Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * (2 ** exponent));
}

function normalizeProcess(process, index, retryPolicy, generatedAt, scopePolicy) {
  const pid = cleanString(process.pid ?? process.id, `unknown-${index + 1}`);
  const command = cleanString(process.command ?? process.name, 'unknown');
  const rawState = cleanString(process.state ?? process.status, 'unknown').toLowerCase();
  const state = rawState === 'ready' ? 'running' : rawState;
  const restartCount = normalizeNumber(process.restartCount ?? process.restarts, 0);
  const exitCode = process.exitCode === null || process.exitCode === undefined
    ? null
    : normalizeNumber(process.exitCode, 0);
  const lastError = cleanString(process.lastError ?? process.error, '');
  const owner = cleanString(process.owner ?? process.scope, 'hosted-kernel');
  const uptimeMs = normalizeNumber(process.uptimeMs, 0);
  const dependencyHealth = normalizeProcessDependencyHealth(process, generatedAt);
  const retryable = dependencyHealth.restartEligible && (!TERMINAL_STATES.has(state) || state === 'failed');
  const attemptsRemaining = Math.max(0, retryPolicy.maxAttempts - restartCount);
  const nextRetryDelayMs = retryable && attemptsRemaining > 0
    ? dependencyHealth.nextRetryDelayMs ?? retryDelayMs(restartCount + 1, retryPolicy)
    : null;
  const health = TERMINAL_STATES.has(state)
    ? 'failed'
    : DEGRADED_STATES.has(state) || lastError || dependencyHealth.status === 'blocked' || dependencyHealth.status === 'degraded'
      ? 'degraded'
      : LIVE_STATES.has(state)
        ? 'healthy'
        : 'unknown';
  const boundary = normalizeProcessBoundary(process, scopePolicy);
  const exitContract = normalizeExitContract(process);
  const contractHealth = exitContract.expected ? health : 'failed';

  return {
    pid,
    command,
    state,
    owner,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    requiredRoles: boundary.requiredRoles,
    requiredPermissions: boundary.requiredPermissions,
    health: contractHealth,
    uptimeMs,
    restartCount,
    exitCode,
    lastError: lastError || null,
    job: normalizeProcessJob(process, index),
    thread: normalizeProcessThread(process, index),
    lease: normalizeProcessLease(process, generatedAt),
    exitContract,
    dependencyHealth,
    retry: {
      retryable,
      attemptsRemaining,
      nextRetryDelayMs,
      evaluatedAt: generatedAt,
    },
  };
}

function applyScopeToProcess(process, scopePolicy) {
  const tenantAllowed = !scopePolicy.enforceTenantBoundary
    || scopePolicy.allowedTenantIds.includes(process.tenantId);
  const workspaceAllowed = !scopePolicy.enforceWorkspaceBoundary
    || scopePolicy.allowedWorkspaceIds.includes(process.workspaceId);
  const roleAllowed = hasAny(scopePolicy.roles, process.requiredRoles);
  const permissionAllowed = hasAny(scopePolicy.permissions, process.requiredPermissions);
  const deniedReasons = [
    tenantAllowed ? null : 'tenant-boundary',
    workspaceAllowed ? null : 'workspace-boundary',
    roleAllowed ? null : 'role-missing',
    permissionAllowed ? null : 'permission-missing',
  ].filter(Boolean);

  return {
    ...process,
    visible: deniedReasons.length === 0,
    deniedReasons,
  };
}

function buildScopedProcessView(processes, scopePolicy, generatedAt) {
  const scoped = processes.map((process) => applyScopeToProcess(process, scopePolicy));
  const visible = scoped.filter((process) => process.visible);
  const denied = scoped
    .filter((process) => !process.visible)
    .map((process) => ({
      pid: process.pid,
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      deniedReasons: process.deniedReasons,
      commandHash: `${process.command.length}:${process.command.charCodeAt(0) || 0}`,
    }));
  const deniedByReason = denied.reduce((summary, process) => {
    process.deniedReasons.forEach((reason) => {
      summary[reason] = (summary[reason] || 0) + 1;
    });
    return summary;
  }, {});

  return {
    schema: 'hosted-kernel.cli-ps.scoped-process-view/v1',
    generatedAt,
    tenantId: scopePolicy.tenantId,
    workspaceId: scopePolicy.workspaceId,
    operatorId: scopePolicy.operatorId,
    totalReceived: scoped.length,
    visibleCount: visible.length,
    deniedCount: denied.length,
    deniedByReason,
    visiblePids: visible.map((process) => process.pid),
    denied,
    proof: {
      boundary: denied.length ? 'redacted-cross-boundary-processes' : 'all-records-visible',
      rolesEvaluated: scopePolicy.roles,
      permissionsEvaluated: scopePolicy.permissions,
      allowedTenantIds: scopePolicy.allowedTenantIds,
      allowedWorkspaceIds: scopePolicy.allowedWorkspaceIds,
    },
  };
}

function compactDurationMs(value) {
  const ms = Math.floor(normalizeNumber(value, 0));
  if (ms <= 0) {
    return '0ms';
  }
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function truncateCell(value, maxLength = 36) {
  const text = cleanString(value, '-');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function rowSeverity(row) {
  if (row.attention.includes('process-failed') || row.attention.includes('exit-contract-violated')) {
    return 'critical';
  }
  if (
    row.attention.includes('dependency-blocked')
    || row.attention.includes('lease-expired')
    || row.attention.includes('retry-budget-exhausted')
    || row.attention.includes('retry-paused-quiet')
    || row.attention.includes('retry-paused-window')
    || row.attention.includes('retry-disabled')
    || row.attention.includes('retry-held')
    || row.attention.includes('restart-replay-blocked')
  ) {
    return 'warning';
  }
  if (row.attention.length || row.health === 'degraded' || row.health === 'unknown') {
    return 'notice';
  }
  return 'normal';
}

function buildProcessRecoveryPosture({
  process,
  attention,
  lifecycleSchedule,
  handoffContract,
  restartReconciliation,
  syncMetadata,
}) {
  const blockerPriority = [
    'exit-contract-violated',
    'dependency-blocked',
    'lease-expired',
    'restart-replay-blocked',
    'retry-budget-exhausted',
    'process-failed',
  ];
  const warningPriority = [
    'dependency-degraded',
    'process-degraded',
    'retry-paused-quiet',
    'retry-paused-window',
    'retry-disabled',
    'retry-held',
    'lease-missing',
    'delegated-scope-access',
  ];
  const primaryBlocker = blockerPriority.find((reason) => attention.includes(reason)) || null;
  const primaryWarning = warningPriority.find((reason) => attention.includes(reason)) || null;
  const retryWindowOpen = Boolean(
    process.retry.retryable
      && process.retry.attemptsRemaining > 0
      && lifecycleSchedule.state !== 'quiet-paused'
      && lifecycleSchedule.state !== 'window-paused'
      && lifecycleSchedule.state !== 'disabled',
  );
  const retryState = lifecycleSchedule.scheduled
    ? 'scheduled'
    : primaryBlocker === 'retry-budget-exhausted'
      ? 'exhausted'
      : lifecycleSchedule.state === 'quiet-paused' || lifecycleSchedule.state === 'window-paused'
        ? 'paused'
        : lifecycleSchedule.state === 'disabled'
          ? 'disabled'
          : retryWindowOpen
            ? 'available'
            : process.retry.retryable
              ? 'waiting'
              : 'not-retryable';
  const writeBarrierReasons = [
    syncMetadata.stale ? 'provider-sync-stale' : null,
    restartReconciliation?.replayBlocked ? 'restart-replay-blocked' : null,
    handoffContract.blocksAutomaticHandoff ? 'handoff-contract-blocked' : null,
  ].filter(Boolean);
  const state = primaryBlocker
    ? 'blocked'
    : writeBarrierReasons.length
      ? 'read-only'
      : primaryWarning || process.health === 'degraded' || process.health === 'unknown'
        ? 'degraded'
        : lifecycleSchedule.scheduled
          ? 'recovering'
          : 'clear';
  const nextAction = primaryBlocker === 'exit-contract-violated'
    ? 'inspect-exit-contract-before-replay'
    : primaryBlocker === 'dependency-blocked'
      ? 'restore-required-dependency'
      : primaryBlocker === 'lease-expired'
        ? 'renew-or-reacquire-lease'
        : primaryBlocker === 'restart-replay-blocked'
          ? 'repair-persistence-or-refresh-before-replay'
          : primaryBlocker === 'retry-budget-exhausted'
            ? 'escalate-retry-budget-or-handoff'
            : primaryBlocker === 'process-failed'
              ? retryWindowOpen ? 'schedule-retry-or-handoff' : 'inspect-failed-process'
              : writeBarrierReasons.includes('provider-sync-stale')
                ? 'refresh-process-table'
                : writeBarrierReasons.length
                  ? 'operate-read-only-until-write-barrier-clears'
                  : lifecycleSchedule.scheduled
                    ? 'wait-for-retry-dispatch'
                    : primaryWarning
                      ? lifecycleSchedule.nextOperatorAction
                      : 'continue-monitoring';

  return {
    schema: 'hosted-kernel.cli-ps.process-recovery-posture/v1',
    state,
    primaryReason: primaryBlocker || primaryWarning || 'none',
    blocksDispatch: state === 'blocked',
    readOnly: state === 'read-only' || writeBarrierReasons.length > 0,
    degraded: state === 'degraded',
    retryState,
    retryable: process.retry.retryable,
    attemptsRemaining: process.retry.attemptsRemaining,
    nextRetryDelayMs: process.retry.nextRetryDelayMs,
    notBefore: lifecycleSchedule.notBefore,
    writeBarrierReasons,
    handoffState: handoffContract.state,
    restartReplayBlocked: Boolean(restartReconciliation?.replayBlocked),
    nextAction,
    message: state === 'blocked'
      ? `Process ${process.pid} is blocked by ${primaryBlocker}.`
      : state === 'read-only'
        ? `Process ${process.pid} is view-only until ${writeBarrierReasons[0]} clears.`
        : state === 'recovering'
          ? `Process ${process.pid} has retry dispatch scheduled.`
          : state === 'degraded'
            ? `Process ${process.pid} is degraded by ${primaryWarning || process.health}.`
            : `Process ${process.pid} has no recovery blocker.`,
  };
}

function buildProcessLifecycleScheduleOverlay(process, recoveryAction, lifecycleSettings, generatedAt) {
  const generatedMs = Date.parse(generatedAt);
  const quietUntilMs = lifecycleSettings.schedule.quietUntil
    ? Date.parse(lifecycleSettings.schedule.quietUntil)
    : NaN;
  const quietActive = !Number.isNaN(quietUntilMs)
    && !Number.isNaN(generatedMs)
    && quietUntilMs > generatedMs;
  const pausedByWindow = lifecycleSettings.schedule.pausedControls.includes('*')
    || lifecycleSettings.schedule.pausedControls.includes('auto-retry');
  const retryable = Boolean(
    process.health !== 'healthy'
      && process.retry.retryable
      && process.retry.attemptsRemaining > 0,
  );
  const scheduled = recoveryAction?.action === 'schedule-retry';
  const held = recoveryAction?.action === 'hold-for-operator';
  const notBefore = scheduled
    ? recoveryAction.notBefore
    : retryable && process.retry.nextRetryDelayMs !== null && !Number.isNaN(generatedMs)
      ? new Date(generatedMs + process.retry.nextRetryDelayMs).toISOString()
      : null;
  const state = scheduled
    ? 'scheduled'
    : held && quietActive
      ? 'quiet-paused'
      : held && pausedByWindow
        ? 'window-paused'
        : held && !lifecycleSettings.controls['auto-retry']
          ? 'disabled'
          : held && retryable
            ? 'held'
            : retryable
              ? 'eligible'
              : 'not-eligible';
  const blockingReason = scheduled
    ? null
    : held
      ? recoveryAction.reason
      : quietActive
        ? 'auto-retry-paused-by-lifecycle-schedule'
        : pausedByWindow
          ? 'auto-retry-paused-by-maintenance-window'
          : !lifecycleSettings.controls['auto-retry']
            ? 'auto-retry-disabled-by-lifecycle-settings'
            : retryable
              ? 'awaiting-recovery-planner'
              : 'retry-budget-exhausted-or-process-not-retryable';
  const nextOperatorAction = scheduled
    ? 'wait-for-retry-dispatch'
    : state === 'quiet-paused' || state === 'window-paused'
      ? 'review-lifecycle-schedule'
      : state === 'disabled'
        ? 'enable-auto-retry-or-inspect'
        : state === 'held'
          ? 'inspect-held-recovery'
          : retryable
            ? 'schedule-retry'
            : 'inspect-process';

  return {
    schema: 'hosted-kernel.cli-ps.process-lifecycle-schedule/v1',
    generatedAt,
    state,
    retryable,
    scheduled,
    held,
    notBefore,
    blockingReason,
    nextOperatorAction,
    attemptsRemaining: process.retry.attemptsRemaining,
    quietUntil: lifecycleSettings.schedule.quietUntil,
    pausedControls: lifecycleSettings.schedule.pausedControls,
    activeMaintenanceWindowCount: lifecycleSettings.schedule.activeWindowCount,
    maxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
    recoveryCommandKey: recoveryAction?.idempotencyKey || null,
  };
}

function buildProcessHandoffPresentationContract({
  process,
  attention,
  externalHandoff,
  providerServiceContracts,
  syncMetadata,
}) {
  const supervisorSink = providerServiceContracts.supervisorHandoffSink;
  const processNeedsHandoff = attention.some((reason) => (
    reason === 'process-failed'
    || reason === 'exit-contract-violated'
    || reason === 'dependency-blocked'
    || reason === 'lease-expired'
    || reason === 'retry-budget-exhausted'
  ));
  const requested = Boolean(externalHandoff.required || processNeedsHandoff);
  const providerOperationReady = Boolean(supervisorSink && !syncMetadata.stale);
  const state = !requested
    ? 'not-required'
    : providerOperationReady
      ? 'provider-ready'
      : supervisorSink
        ? 'sync-refresh-required'
        : providerServiceContracts.state === 'accepted'
          ? 'manual-supervisor-route'
          : 'provider-contract-blocked';
  const reason = processNeedsHandoff
    ? attention.find((item) => (
        item === 'process-failed'
        || item === 'exit-contract-violated'
        || item === 'dependency-blocked'
        || item === 'lease-expired'
        || item === 'retry-budget-exhausted'
      ))
    : externalHandoff.reason;
  const providerOperation = supervisorSink
    ? {
        operation: supervisorSink.operation,
        endpoint: supervisorSink.endpoint,
        method: supervisorSink.method,
        capability: supervisorSink.capability,
        proofRef: supervisorSink.proofRef,
      }
    : null;

  return {
    schema: 'hosted-kernel.cli-ps.process-handoff-contract/v1',
    pid: process.pid,
    requested,
    state,
    reason: requested ? reason : 'none',
    target: requested && providerOperationReady
      ? externalHandoff.target
      : requested
        ? 'hosted-kernel-supervisor'
        : 'operator-console',
    mode: !requested
      ? 'none'
      : providerOperationReady
        ? 'provider-operation'
        : 'manual',
    blocksAutomaticHandoff: requested && state !== 'provider-ready',
    requiresFreshSync: requested,
    syncCursor: syncMetadata.cursor,
    syncConsistency: syncMetadata.consistency,
    payloadRef: requested
      ? `cli-ps:handoff:${syncMetadata.cursor}:${process.pid}:${lightweightChecksum(attention)}`
      : null,
    idempotencyKey: requested
      ? `cli-ps:handoff:${syncMetadata.cursor}:${process.pid}`
      : null,
    providerOperation,
    proof: {
      providerServiceState: providerServiceContracts.state,
      supervisorSinkAccepted: Boolean(supervisorSink),
      syncStale: syncMetadata.stale,
      attentionChecksum: lightweightChecksum(attention),
    },
  };
}

function buildProcessAuthorityPresentation(process, scopePolicy) {
  const matchedRoles = process.requiredRoles
    .filter((role) => scopePolicy.roles.includes(role));
  const matchedPermissions = process.requiredPermissions
    .filter((permission) => scopePolicy.permissions.includes(permission));
  const sameTenant = process.tenantId === scopePolicy.tenantId;
  const sameWorkspace = process.workspaceId === scopePolicy.workspaceId;
  const delegatedReasons = [
    sameTenant ? null : 'allowed-tenant-delegation',
    sameWorkspace ? null : 'allowed-workspace-delegation',
  ].filter(Boolean);
  const roleCoverage = matchedRoles.length >= process.requiredRoles.length
    ? 'complete'
    : matchedRoles.length
      ? 'partial'
      : 'none';
  const permissionCoverage = matchedPermissions.length >= process.requiredPermissions.length
    ? 'complete'
    : matchedPermissions.length
      ? 'partial'
      : 'none';
  const elevatedRoleRequired = process.requiredRoles
    .some((role) => role !== scopePolicy.defaultRequiredRole);
  const elevatedPermissionRequired = process.requiredPermissions
    .some((permission) => permission !== scopePolicy.defaultRequiredPermission);
  const authorityState = delegatedReasons.length
    ? 'delegated-visible'
    : elevatedRoleRequired || elevatedPermissionRequired
      ? 'elevated-visible'
      : 'local-visible';
  const boundaryMode = sameTenant && sameWorkspace
    ? 'same-workspace'
    : sameTenant
      ? 'cross-workspace'
      : sameWorkspace
        ? 'cross-tenant-same-workspace'
        : 'cross-tenant-workspace';
  const operatorActionGuard = authorityState === 'local-visible'
    ? 'standard-scope'
    : authorityState === 'elevated-visible'
      ? 'permission-proof-required'
      : 'delegation-proof-required';

  return {
    schema: 'hosted-kernel.cli-ps.process-authority/v1',
    state: authorityState,
    boundaryMode,
    operatorActionGuard,
    tenantId: process.tenantId,
    workspaceId: process.workspaceId,
    sameTenant,
    sameWorkspace,
    delegated: delegatedReasons.length > 0,
    delegatedReasons,
    roleCoverage,
    permissionCoverage,
    matchedRoles,
    matchedPermissions,
    requiredRoles: process.requiredRoles,
    requiredPermissions: process.requiredPermissions,
    elevatedRoleRequired,
    elevatedPermissionRequired,
    proofRef: lightweightChecksum({
      pid: process.pid,
      operatorTenant: scopePolicy.tenantId,
      operatorWorkspace: scopePolicy.workspaceId,
      targetTenant: process.tenantId,
      targetWorkspace: process.workspaceId,
      matchedRoles,
      matchedPermissions,
      requiredRoles: process.requiredRoles,
      requiredPermissions: process.requiredPermissions,
    }),
  };
}

function buildProcessTableDisplayCells(row) {
  const jobAttempt = row.job.attempt > 1 ? `#${row.job.attempt}` : '#1';
  const parent = row.thread.parentPid ? `<${row.thread.parentPid}` : '';
  const blocked = row.thread.blockedOn ? ` wait:${row.thread.blockedOn}` : '';
  const lease = row.lease.state === 'held'
    ? `${row.lease.holder || row.lease.id || 'held'} ${compactDurationMs(row.lease.ttlMs)}`
    : row.lease.state;
  const exit = row.exitContract.observedCode === null
    ? `pending ${row.exitContract.expectedCodes.length ? row.exitContract.expectedCodes.join('|') : 'any'}`
    : row.exitContract.expected
      ? `ok ${row.exitContract.observedCode}`
      : `bad ${row.exitContract.observedCode}`;
  const retry = row.retry.nextRetryDelayMs === null
    ? `${row.retry.attemptsRemaining} left`
    : `${row.retry.attemptsRemaining} left ${compactDurationMs(row.retry.nextRetryDelayMs)}`;
  const schedule = row.lifecycleSchedule.notBefore
    ? `${row.lifecycleSchedule.state} ${compactDurationMs(Date.parse(row.lifecycleSchedule.notBefore) - Date.parse(row.lifecycleSchedule.generatedAt))}`
    : row.lifecycleSchedule.state;
  const handoff = row.handoffContract.state === 'provider-ready'
    ? 'provider'
    : row.handoffContract.state === 'sync-refresh-required'
      ? 'refresh'
      : row.handoffContract.state === 'manual-supervisor-route'
        ? 'manual'
        : row.handoffContract.state === 'provider-contract-blocked'
          ? 'blocked'
          : 'none';
  const restart = row.restartReconciliation
    ? row.restartReconciliation.status.replace(/^(restart-|orphaned-)/, '')
    : 'unknown';
  const posture = row.recoveryPosture.state === 'blocked'
    ? `block:${row.recoveryPosture.primaryReason}`
    : row.recoveryPosture.state === 'read-only'
      ? `ro:${row.recoveryPosture.writeBarrierReasons[0] || 'barrier'}`
      : row.recoveryPosture.state === 'recovering'
        ? `retry:${row.recoveryPosture.retryState}`
        : row.recoveryPosture.state === 'degraded'
          ? `deg:${row.recoveryPosture.primaryReason}`
          : row.recoveryPosture.retryState === 'available'
            ? 'ready:retry'
            : 'clear';
  const authority = row.authority.state === 'local-visible'
    ? 'local'
    : row.authority.state === 'elevated-visible'
      ? 'elevated'
      : row.authority.boundaryMode === 'cross-workspace'
        ? 'delegated/ws'
        : row.authority.boundaryMode === 'cross-tenant-same-workspace'
          ? 'delegated/tenant'
          : 'delegated/all';

  return {
    pid: row.pid,
    job: truncateCell(`${row.job.queue}/${row.job.name}${jobAttempt}`, 32),
    thread: truncateCell(`${row.thread.lane}:${row.thread.id}${parent}${blocked}`, 36),
    state: `${row.state}/${row.health}`,
    authority: truncateCell(authority, 18),
    lease: truncateCell(lease, 28),
    exit: truncateCell(exit, 20),
    retry,
    schedule: truncateCell(schedule, 24),
    handoff,
    restart: truncateCell(restart, 24),
    posture: truncateCell(posture, 28),
    hint: truncateCell(row.operatorHint.action, 36),
  };
}

function buildProcessTableTerminalView(rows) {
  const displayRows = rows.map((row, index) => ({
    index: index + 1,
    key: row.key,
    severity: row.severity,
    pid: row.pid,
    cells: row.displayCells,
    attention: row.attention,
    operatorAction: row.operatorHint.action,
  }));
  const widths = displayRows.reduce((summary, row) => {
    Object.entries(row.cells).forEach(([key, value]) => {
      summary[key] = Math.max(summary[key] || key.length, String(value).length);
    });
    return summary;
  }, {});

  return {
    schema: 'hosted-kernel.cli-ps.terminal-process-table/v1',
    rowCount: displayRows.length,
    severityLegend: {
      critical: 'blocks hosted-kernel recovery or exit contract',
      warning: 'requires operator attention',
      notice: 'degraded but dispatch may remain read-only',
      normal: 'no immediate action',
    },
    columns: [
      { key: 'pid', label: 'PID', width: widths.pid || 3 },
      { key: 'job', label: 'JOB', width: widths.job || 3 },
      { key: 'thread', label: 'THREAD', width: widths.thread || 6 },
      { key: 'state', label: 'STATE', width: widths.state || 5 },
      { key: 'authority', label: 'AUTH', width: widths.authority || 4 },
      { key: 'lease', label: 'LEASE', width: widths.lease || 5 },
      { key: 'exit', label: 'EXIT', width: widths.exit || 4 },
      { key: 'retry', label: 'RETRY', width: widths.retry || 5 },
      { key: 'schedule', label: 'SCHED', width: widths.schedule || 5 },
      { key: 'handoff', label: 'HANDOFF', width: widths.handoff || 7 },
      { key: 'restart', label: 'RESTART', width: widths.restart || 7 },
      { key: 'posture', label: 'POSTURE', width: widths.posture || 7 },
      { key: 'hint', label: 'NEXT', width: widths.hint || 4 },
    ],
    rows: displayRows,
    topAttention: displayRows
      .filter((row) => row.attention.length)
      .slice(0, 5)
      .map((row) => ({
        pid: row.pid,
        severity: row.severity,
        reason: row.attention[0],
        action: row.operatorAction,
      })),
  };
}

function buildProcessTablePresentation({
  generatedAt,
  processes,
  scopedProcessView,
  syncMetadata,
  operationalHealthTriage,
  restartStatus,
  recoveryPlan,
  lifecycleSettings,
  scopePolicy,
  externalHandoff,
  providerServiceContracts,
  restartReconciliation,
}) {
  const healthWeight = { failed: 4, degraded: 3, unknown: 2, healthy: 1 };
  const recoveryByPid = new Map(recoveryPlan.actions.map((action) => [action.pid, action]));
  const restartReconciliationByPid = new Map(
    restartReconciliation.rows.map((row) => [row.pid, row]),
  );
  const rows = processes
    .map((process) => {
      const lifecycleSchedule = buildProcessLifecycleScheduleOverlay(
        process,
        recoveryByPid.get(process.pid),
        lifecycleSettings,
        generatedAt,
      );
      const leaseAttention = process.lease.expired
        ? 'lease-expired'
        : process.lease.state === 'not-reported'
          ? 'lease-missing'
          : null;
      const exitAttention = process.exitContract.expected ? null : 'exit-contract-violated';
      const dependencyAttention = process.dependencyHealth.status === 'blocked'
        ? 'dependency-blocked'
        : process.dependencyHealth.status === 'degraded'
          ? 'dependency-degraded'
          : null;
      const stateAttention = process.health === 'failed'
        ? 'process-failed'
        : process.health === 'degraded'
          ? 'process-degraded'
          : null;
      const attention = [
        stateAttention,
        dependencyAttention,
        leaseAttention,
        exitAttention,
        lifecycleSchedule.state === 'quiet-paused' ? 'retry-paused-quiet' : null,
        lifecycleSchedule.state === 'window-paused' ? 'retry-paused-window' : null,
        lifecycleSchedule.state === 'disabled' && process.health !== 'healthy' ? 'retry-disabled' : null,
        lifecycleSchedule.state === 'held' ? 'retry-held' : null,
        process.retry.attemptsRemaining === 0 && process.health !== 'healthy' ? 'retry-budget-exhausted' : null,
        restartReconciliationByPid.get(process.pid)?.replayBlocked ? 'restart-replay-blocked' : null,
      ].filter(Boolean);
      const authority = buildProcessAuthorityPresentation(process, scopePolicy);
      if (authority.delegated) {
        attention.push('delegated-scope-access');
      }
      const handoffContract = buildProcessHandoffPresentationContract({
        process,
        attention,
        externalHandoff,
        providerServiceContracts,
        syncMetadata,
      });
      const restartReconciliationRow = restartReconciliationByPid.get(process.pid);
      const recoveryPosture = buildProcessRecoveryPosture({
        process,
        attention,
        lifecycleSchedule,
        handoffContract,
        restartReconciliation: restartReconciliationRow,
        syncMetadata,
      });

      const row = {
        schema: 'hosted-kernel.cli-ps.process-table-row/v1',
        key: `${process.job.id}:${process.thread.id}:${process.pid}`,
        pid: process.pid,
        command: process.command,
        state: process.state,
        health: process.health,
        owner: process.owner,
        authority,
        job: {
          id: process.job.id,
          name: process.job.name,
          queue: process.job.queue,
          shard: process.job.shard,
          attempt: process.job.attempt,
          priority: process.job.priority,
        },
        thread: {
          id: process.thread.id,
          groupId: process.thread.groupId,
          lane: process.thread.lane,
          parentPid: process.thread.parentPid || null,
          blockedOn: process.thread.blockedOn,
        },
        lease: {
          id: process.lease.id || null,
          holder: process.lease.holder || null,
          state: process.lease.state,
          expiresAt: process.lease.expiresAt,
          ttlMs: process.lease.ttlMs,
          renewable: process.lease.renewable,
        },
        exitContract: {
          expectedCodes: process.exitContract.expectedCodes,
          observedCode: process.exitContract.observedCode,
          expected: process.exitContract.expected,
          signal: process.exitContract.signal,
          cleanup: process.exitContract.cleanup,
          onExit: process.exitContract.onExit,
        },
        retry: {
          attemptsRemaining: process.retry.attemptsRemaining,
          nextRetryDelayMs: process.retry.nextRetryDelayMs,
          retryable: process.retry.retryable,
        },
        lifecycleSchedule,
        handoffContract,
        recoveryPosture,
        restartReconciliation: restartReconciliationRow
          ? {
              status: restartReconciliationRow.status,
              replayBlocked: restartReconciliationRow.replayBlocked,
              operatorAction: restartReconciliationRow.operatorAction,
              proofRef: restartReconciliationRow.proofRef,
            }
          : {
              status: 'not-reconciled',
              replayBlocked: true,
              operatorAction: 'refresh-process-table-before-replay',
              proofRef: null,
            },
        attention,
        operatorHint: attention[0]
          ? {
              code: attention[0],
              action: attention[0] === 'lease-expired'
                ? 'renew-or-reacquire-lease'
                : attention[0] === 'exit-contract-violated'
                  ? 'inspect-exit-contract'
                  : attention[0] === 'dependency-blocked'
                    ? 'restore-required-dependency'
                    : attention[0] === 'retry-budget-exhausted'
                      ? 'escalate-retry-budget'
                      : attention[0] === 'retry-paused-quiet'
                        ? 'wait-for-quiet-window'
                        : attention[0] === 'retry-paused-window'
                          ? 'review-maintenance-window'
                          : attention[0] === 'retry-disabled'
                            ? 'enable-auto-retry-or-inspect'
                            : attention[0] === 'retry-held'
                              ? 'inspect-held-recovery'
                              : attention[0] === 'restart-replay-blocked'
                                ? 'repair-persistence-or-refresh-before-replay'
                                : attention[0] === 'delegated-scope-access'
                                  ? 'review-delegation-proof'
                                : 'inspect-process',
            }
          : {
              code: 'clear',
              action: lifecycleSchedule.scheduled
                ? 'wait-for-retry-dispatch'
                : recoveryPosture.nextAction,
            },
      };
      const severity = rowSeverity(row);
      return {
        ...row,
        severity,
        rank: {
          severity,
          healthWeight: healthWeight[row.health] || 0,
          attentionCount: attention.length,
        },
        displayCells: buildProcessTableDisplayCells({ ...row, severity }),
      };
    })
    .sort((left, right) => (
      (healthWeight[right.health] || 0) - (healthWeight[left.health] || 0)
      || right.attention.length - left.attention.length
      || String(left.job.queue).localeCompare(String(right.job.queue))
      || String(left.pid).localeCompare(String(right.pid))
    ));
  const leaseSummary = rows.reduce((summary, row) => {
    summary.byState[row.lease.state] = (summary.byState[row.lease.state] || 0) + 1;
    if (row.lease.state === 'expired') {
      summary.expiredCount += 1;
    }
    if (row.lease.state === 'held' && row.lease.ttlMs <= 30_000) {
      summary.expiringSoonCount += 1;
    }
    return summary;
  }, { expiredCount: 0, expiringSoonCount: 0, byState: {} });
  const exitSummary = rows.reduce((summary, row) => {
    if (row.exitContract.expected) {
      summary.expectedCount += 1;
    } else {
      summary.violatedCount += 1;
    }
    if (row.exitContract.observedCode !== null) {
      summary.observedCount += 1;
    }
    return summary;
  }, { expectedCount: 0, violatedCount: 0, observedCount: 0 });
  const handoffSummary = rows.reduce((summary, row) => {
    summary.byState[row.handoffContract.state] = (summary.byState[row.handoffContract.state] || 0) + 1;
    summary.byMode[row.handoffContract.mode] = (summary.byMode[row.handoffContract.mode] || 0) + 1;
    if (row.handoffContract.requested) {
      summary.requestedCount += 1;
    }
    if (row.handoffContract.state === 'provider-ready') {
      summary.providerReadyCount += 1;
    }
    if (row.handoffContract.blocksAutomaticHandoff) {
      summary.blockedAutomaticCount += 1;
    }
    return summary;
  }, {
    requestedCount: 0,
    providerReadyCount: 0,
    blockedAutomaticCount: 0,
    byState: {},
    byMode: {},
  });
  const recoveryPostureSummary = rows.reduce((summary, row) => {
    const posture = row.recoveryPosture;
    summary.byState[posture.state] = (summary.byState[posture.state] || 0) + 1;
    summary.byRetryState[posture.retryState] = (summary.byRetryState[posture.retryState] || 0) + 1;
    if (posture.blocksDispatch) {
      summary.blockedCount += 1;
    }
    if (posture.readOnly) {
      summary.readOnlyCount += 1;
    }
    if (posture.degraded) {
      summary.degradedCount += 1;
    }
    if (posture.retryState === 'available' || posture.retryState === 'scheduled') {
      summary.recoverableCount += 1;
    }
    if (posture.writeBarrierReasons.length) {
      posture.writeBarrierReasons.forEach((reason) => {
        summary.writeBarrierReasons[reason] = (summary.writeBarrierReasons[reason] || 0) + 1;
      });
    }
    if (posture.primaryReason !== 'none') {
      summary.byPrimaryReason[posture.primaryReason] = (
        summary.byPrimaryReason[posture.primaryReason] || 0
      ) + 1;
    }
    return summary;
  }, {
    blockedCount: 0,
    readOnlyCount: 0,
    degradedCount: 0,
    recoverableCount: 0,
    byState: {},
    byRetryState: {},
    byPrimaryReason: {},
    writeBarrierReasons: {},
  });
  const attentionRows = rows.filter((row) => row.attention.length > 0);
  const terminalView = buildProcessTableTerminalView(rows);

  return {
    schema: 'hosted-kernel.cli-ps.process-table-presentation/v1',
    generatedAt,
    title: 'Hosted AI OS process table',
    state: operationalHealthTriage.status,
    cursor: syncMetadata.cursor,
    sequence: syncMetadata.sequence,
    restartStatus: restartStatus.status,
    columns: [
      { key: 'pid', label: 'PID', role: 'identity' },
      { key: 'job', label: 'Job', role: 'hosted-job' },
      { key: 'thread', label: 'Thread', role: 'execution-thread' },
      { key: 'state', label: 'State', role: 'lifecycle-state' },
      { key: 'authority', label: 'Authority', role: 'tenant-workspace-boundary' },
      { key: 'lease', label: 'Lease', role: 'lease-contract' },
      { key: 'exitContract', label: 'Exit', role: 'exit-contract' },
      { key: 'retry', label: 'Retry', role: 'recovery-window' },
      { key: 'lifecycleSchedule', label: 'Schedule', role: 'lifecycle-scheduling' },
      { key: 'handoffContract', label: 'Handoff', role: 'external-handoff-contract' },
      { key: 'restartReconciliation', label: 'Restart', role: 'persisted-state-recovery' },
      { key: 'recoveryPosture', label: 'Posture', role: 'recovery-readiness' },
    ],
    rowCount: rows.length,
    attentionRowCount: attentionRows.length,
    rows,
    attentionRows: attentionRows.slice(0, 10),
    terminalView,
    groups: {
      byJobQueue: rows.reduce((summary, row) => {
        summary[row.job.queue] = (summary[row.job.queue] || 0) + 1;
        return summary;
      }, {}),
      byThreadLane: rows.reduce((summary, row) => {
        summary[row.thread.lane] = (summary[row.thread.lane] || 0) + 1;
        return summary;
      }, {}),
      byHealth: rows.reduce((summary, row) => {
        summary[row.health] = (summary[row.health] || 0) + 1;
        return summary;
      }, {}),
      byAuthorityState: rows.reduce((summary, row) => {
        summary[row.authority.state] = (summary[row.authority.state] || 0) + 1;
        return summary;
      }, {}),
      byBoundaryMode: rows.reduce((summary, row) => {
        summary[row.authority.boundaryMode] = (summary[row.authority.boundaryMode] || 0) + 1;
        return summary;
      }, {}),
      byLifecycleSchedule: rows.reduce((summary, row) => {
        summary[row.lifecycleSchedule.state] = (summary[row.lifecycleSchedule.state] || 0) + 1;
        return summary;
      }, {}),
      byHandoffState: rows.reduce((summary, row) => {
        summary[row.handoffContract.state] = (summary[row.handoffContract.state] || 0) + 1;
        return summary;
      }, {}),
      byRecoveryPosture: rows.reduce((summary, row) => {
        summary[row.recoveryPosture.state] = (summary[row.recoveryPosture.state] || 0) + 1;
        return summary;
      }, {}),
    },
    contracts: {
      leaseSummary,
      exitSummary,
      handoffSummary,
      recoveryPostureSummary,
      restartReconciliationSummary: {
        state: restartReconciliation.state,
        total: restartReconciliation.counts.total,
        orphaned: restartReconciliation.counts.orphaned,
        replayBlocked: restartReconciliation.counts.replayBlocked,
        withRecoveryAction: restartReconciliation.counts.withRecoveryAction,
        byStatus: restartReconciliation.counts.byStatus,
        nextOperatorAction: restartReconciliation.nextOperatorAction,
      },
      authoritySummary: {
        localVisibleCount: rows.filter((row) => row.authority.state === 'local-visible').length,
        elevatedVisibleCount: rows.filter((row) => row.authority.state === 'elevated-visible').length,
        delegatedVisibleCount: rows.filter((row) => row.authority.delegated).length,
        byState: rows.reduce((summary, row) => {
          summary[row.authority.state] = (summary[row.authority.state] || 0) + 1;
          return summary;
        }, {}),
        byBoundaryMode: rows.reduce((summary, row) => {
          summary[row.authority.boundaryMode] = (summary[row.authority.boundaryMode] || 0) + 1;
          return summary;
        }, {}),
        actionGuards: [...new Set(rows.map((row) => row.authority.operatorActionGuard))].sort(),
      },
      retryBudgetRemaining: rows.reduce((total, row) => total + row.retry.attemptsRemaining, 0),
      lifecycleScheduleSummary: {
        scheduledCount: rows.filter((row) => row.lifecycleSchedule.scheduled).length,
        heldCount: rows.filter((row) => row.lifecycleSchedule.held).length,
        pausedCount: rows.filter((row) => (
          row.lifecycleSchedule.state === 'quiet-paused'
          || row.lifecycleSchedule.state === 'window-paused'
        )).length,
        nextNotBefore: rows
          .map((row) => row.lifecycleSchedule.notBefore)
          .filter(Boolean)
          .sort()[0] || null,
      },
    },
    redaction: {
      visibleCount: scopedProcessView.visibleCount,
      deniedCount: scopedProcessView.deniedCount,
      deniedByReason: scopedProcessView.deniedByReason,
      boundary: scopedProcessView.proof.boundary,
    },
    freshness: {
      stale: syncMetadata.stale,
      consistency: syncMetadata.consistency,
      ageMs: syncMetadata.ageMs,
    },
    proof: {
      rowChecksum: lightweightChecksum(rows.map((row) => ({
        key: row.key,
        health: row.health,
        severity: row.severity,
        leaseState: row.lease.state,
        exitExpected: row.exitContract.expected,
        lifecycleScheduleState: row.lifecycleSchedule.state,
        lifecycleScheduleNotBefore: row.lifecycleSchedule.notBefore,
        handoffState: row.handoffContract.state,
        handoffMode: row.handoffContract.mode,
        recoveryPostureState: row.recoveryPosture.state,
        recoveryPostureReason: row.recoveryPosture.primaryReason,
        recoveryRetryState: row.recoveryPosture.retryState,
        recoveryWriteBarriers: row.recoveryPosture.writeBarrierReasons,
        restartReconciliationStatus: row.restartReconciliation.status,
        restartReplayBlocked: row.restartReconciliation.replayBlocked,
        authorityState: row.authority.state,
        boundaryMode: row.authority.boundaryMode,
        operatorActionGuard: row.authority.operatorActionGuard,
        attention: row.attention,
        displayCells: row.displayCells,
      }))),
      operationalHealthSchema: operationalHealthTriage.schema,
      syncSchema: syncMetadata.schema,
      scopeBoundary: scopedProcessView.proof.boundary,
      restartReconciliationSchema: restartReconciliation.schema,
      restartReconciliationChecksum: restartReconciliation.proof.rowChecksum,
    },
  };
}

function buildTargetBoundaryDecision(intent, targetProcess, deniedRecord, scopedProcessView, options = {}) {
  const requiresTarget = options.requiresTarget !== false;
  const targetPid = cleanString(intent.pid ?? intent.processId, '');
  const targetVisible = Boolean(targetProcess);
  const deniedReasons = deniedRecord?.deniedReasons || [];
  const missingTarget = Boolean(requiresTarget && targetPid && !targetProcess && !deniedRecord);
  const crossTenant = deniedReasons.includes('tenant-boundary');
  const crossWorkspace = deniedReasons.includes('workspace-boundary');
  const roleMissing = deniedReasons.includes('role-missing');
  const permissionMissing = deniedReasons.includes('permission-missing');
  const allowed = Boolean(
    !deniedReasons.length
      && !missingTarget
      && (!requiresTarget || targetVisible),
  );
  const reason = allowed
    ? 'scope-authorized'
    : crossTenant
      ? 'tenant-boundary-denied'
      : crossWorkspace
        ? 'workspace-boundary-denied'
        : roleMissing
          ? 'required-role-missing'
          : permissionMissing
            ? 'required-permission-missing'
            : missingTarget
              ? 'process-not-visible'
              : 'scope-boundary-denied';
  const targetScope = targetProcess
    ? {
        tenantId: targetProcess.tenantId,
        workspaceId: targetProcess.workspaceId,
        requiredRoles: targetProcess.requiredRoles,
        requiredPermissions: targetProcess.requiredPermissions,
      }
    : deniedRecord
      ? {
          tenantId: deniedRecord.tenantId,
          workspaceId: deniedRecord.workspaceId,
          requiredRoles: [],
          requiredPermissions: [],
        }
      : null;
  const preconditions = allowed
    ? [
        `tenant:${scopedProcessView.tenantId}`,
        `workspace:${scopedProcessView.workspaceId}`,
        'operator-scope-authorized',
      ]
    : [
        crossTenant ? 'tenant-boundary-blocked' : null,
        crossWorkspace ? 'workspace-boundary-blocked' : null,
        roleMissing ? 'operator-role-required' : null,
        permissionMissing ? 'operator-permission-required' : null,
        missingTarget ? 'target-not-in-visible-snapshot' : null,
      ].filter(Boolean);
  const redaction = deniedRecord
    ? {
        pid: deniedRecord.pid,
        commandHash: deniedRecord.commandHash,
        deniedReasons,
      }
    : null;

  return {
    schema: 'hosted-kernel.cli-ps.target-boundary-decision/v1',
    pid: targetPid || null,
    allowed,
    reason,
    blocksDispatch: !allowed,
    operatorScope: {
      tenantId: scopedProcessView.tenantId,
      workspaceId: scopedProcessView.workspaceId,
      operatorId: scopedProcessView.operatorId,
    },
    targetScope,
    deniedReasons,
    preconditions,
    redaction,
    proofRef: lightweightChecksum({
      pid: targetPid,
      operatorTenant: scopedProcessView.tenantId,
      operatorWorkspace: scopedProcessView.workspaceId,
      targetTenant: targetScope?.tenantId || null,
      targetWorkspace: targetScope?.workspaceId || null,
      deniedReasons,
      allowed,
    }),
  };
}

function buildValidation(input, processes) {
  const errors = [];
  if (input.processes !== undefined && !Array.isArray(input.processes)) {
    errors.push({
      code: 'CLI_PS_PROCESSES_NOT_ARRAY',
      path: 'processes',
      message: 'cli-ps expected processes to be an array of hosted-kernel process records.',
      action: 'Pass the process table as input.processes or omit it to report an empty kernel snapshot.',
    });
  }

  processes.forEach((process, index) => {
    if (!process || typeof process !== 'object') {
      errors.push({
        code: 'CLI_PS_PROCESS_INVALID',
        path: `processes[${index}]`,
        message: 'cli-ps received a process entry that is not an object.',
        action: 'Drop the invalid entry or replace it with pid, command, and state fields.',
      });
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildActionableErrors(processes, validation) {
  const dependencyFailures = processes.flatMap((process) => (
    process.dependencyHealth.checks
      .filter((check) => check.failed)
      .map((check) => ({
        code: check.required
          ? 'CLI_PS_REQUIRED_DEPENDENCY_UNAVAILABLE'
          : 'CLI_PS_OPTIONAL_DEPENDENCY_DEGRADED',
        pid: process.pid,
        command: process.command,
        dependency: check.name,
        message: check.message,
        action: check.action,
        retryAfterMs: check.retryAfterMs,
      }))
  ));
  const exitContractFailures = processes
    .filter((process) => process.exitContract && !process.exitContract.expected)
    .map((process) => ({
      code: 'CLI_PS_EXIT_CONTRACT_VIOLATED',
      pid: process.pid,
      command: process.command,
      observedCode: process.exitContract.observedCode,
      expectedCodes: process.exitContract.expectedCodes,
      message: `Process ${process.pid} observed exit code ${process.exitContract.observedCode}, outside its exit contract.`,
      action: 'Inspect exit contract cleanup policy before replaying or restarting the hosted job.',
    }));
  const failures = processes
    .filter((process) => process.health === 'failed')
    .map((process) => ({
      code: 'CLI_PS_PROCESS_FAILED',
      pid: process.pid,
      command: process.command,
      message: process.lastError || `Process ${process.pid} is in terminal state ${process.state}.`,
      action: process.retry.attemptsRemaining > 0
        ? `Retry with backoff in ${process.retry.nextRetryDelayMs}ms or inspect logs before restart.`
        : 'Escalate: retry budget exhausted for this process.',
    }));

  return [...validation.errors, ...dependencyFailures, ...exitContractFailures, ...failures];
}

function chooseOperationalExitCode(incidents, validation, syncMetadata) {
  if (!validation.ok) {
    return 78;
  }
  if (incidents.some((incident) => incident.severity === 'critical')) {
    return 2;
  }
  if (incidents.some((incident) => incident.severity === 'warning') || syncMetadata.stale) {
    return 1;
  }
  return 0;
}

function buildOperationalHealthTriage({
  generatedAt,
  processes,
  validation,
  lifecycleSettings,
  capabilityNegotiation,
  providerServiceContracts,
  syncMetadata,
  persistenceProjection,
  recoveryPlan,
  restartStatus,
  externalHandoff,
  scopedProcessView,
  previewAcceptance,
}) {
  const validationIncidents = [
    ...validation.errors,
    ...lifecycleSettings.validation.errors,
  ].map((error, index) => ({
    id: `validation:${index}:${error.code}`,
    severity: 'critical',
    category: 'validation',
    code: error.code,
    target: error.path || 'input',
    message: error.message,
    operatorAction: error.action,
    blocksDispatch: true,
    retryEligible: false,
    proof: 'schema-and-lifecycle-validation',
  }));
  const providerIncidents = capabilityNegotiation.missingRequired.map((capability) => ({
    id: `provider:${capability}`,
    severity: 'critical',
    category: 'provider-contract',
    code: 'CLI_PS_PROVIDER_CAPABILITY_MISSING',
    target: capability,
    message: `Provider contract is missing required capability ${capability}.`,
    operatorAction: 'Upgrade or reconnect the hosted-kernel provider before trusting process state.',
    blocksDispatch: true,
    retryEligible: false,
    proof: capabilityNegotiation.schema,
  }));
  const providerOperationIncidents = providerServiceContracts.blockedReasons.map((blocked) => ({
    id: `provider-operation:${blocked.operation}`,
    severity: 'critical',
    category: 'provider-service-contract',
    code: 'CLI_PS_PROVIDER_OPERATION_CONTRACT_BLOCKED',
    target: blocked.operation,
    message: `Provider service operation ${blocked.operation} is blocked by ${blocked.reason}.`,
    operatorAction: blocked.reason === 'provider-operation-not-advertised'
      ? `Advertise ${blocked.operation} on ${providerServiceContracts.serviceName}.`
      : 'Reconcile the hosted-kernel provider service contract before dispatch.',
    blocksDispatch: true,
    retryEligible: false,
    proof: providerServiceContracts.proof.operationChecksum,
  }));
  const syncIncidents = syncMetadata.stale
    ? [{
        id: `sync:${syncMetadata.cursor}`,
        severity: 'warning',
        category: 'sync-freshness',
        code: 'CLI_PS_PROVIDER_SYNC_STALE',
        target: syncMetadata.cursor,
        message: `Provider snapshot is ${syncMetadata.ageMs}ms old.`,
        operatorAction: 'Refresh the hosted-kernel process table before command dispatch.',
        blocksDispatch: true,
        retryEligible: true,
        notBefore: generatedAt,
        proof: syncMetadata.schema,
      }]
    : [];
  const scopeIncidents = scopedProcessView.denied.map((process) => ({
    id: `scope:${process.pid}`,
    severity: 'warning',
    category: 'scope-boundary',
    code: 'CLI_PS_PROCESS_REDACTED_BY_SCOPE',
    target: process.pid,
    message: `Process ${process.pid} was redacted by scope policy.`,
    operatorAction: 'Review tenant, workspace, role, and permission boundary proof before escalating.',
    blocksDispatch: false,
    retryEligible: false,
    proof: scopedProcessView.proof.boundary,
  }));
  const dependencyIncidents = processes.flatMap((process) => (
    process.dependencyHealth.checks
      .filter((check) => check.failed)
      .map((check) => ({
        id: `dependency:${process.pid}:${check.name}`,
        severity: check.required ? 'critical' : 'warning',
        category: 'dependency-preflight',
        code: check.required
          ? 'CLI_PS_REQUIRED_DEPENDENCY_UNAVAILABLE'
          : 'CLI_PS_OPTIONAL_DEPENDENCY_DEGRADED',
        target: `${process.pid}:${check.name}`,
        command: process.command,
        state: process.state,
        message: check.message,
        operatorAction: check.action,
        blocksDispatch: check.required,
        retryEligible: check.retryAfterMs !== null,
        notBefore: check.retryAfterMs === null
          ? null
          : new Date(Date.parse(generatedAt) + check.retryAfterMs).toISOString(),
        attemptsRemaining: process.retry.attemptsRemaining,
        proof: process.dependencyHealth.schema,
      }))
  ));
  const recoveryByPid = new Map(recoveryPlan.actions.map((action) => [action.pid, action]));
  const processIncidents = processes
    .filter((process) => process.health === 'failed' || process.health === 'degraded')
    .map((process) => {
      const recovery = recoveryByPid.get(process.pid);
      const critical = process.health === 'failed' || process.retry.attemptsRemaining === 0;
      return {
        id: `process:${process.pid}:${process.restartCount}`,
        severity: critical ? 'critical' : 'warning',
        category: 'process-health',
        code: process.health === 'failed'
          ? 'CLI_PS_PROCESS_FAILED'
          : 'CLI_PS_PROCESS_DEGRADED',
        target: process.pid,
        command: process.command,
        state: process.state,
        message: process.lastError || `Process ${process.pid} is ${process.health}.`,
        operatorAction: recovery?.action === 'schedule-retry'
          ? `Retry scheduled no earlier than ${recovery.notBefore}.`
          : recovery?.reason || 'Inspect process logs and choose restart, kill, or handoff.',
        blocksDispatch: critical,
        retryEligible: Boolean(process.retry.retryable && process.retry.attemptsRemaining > 0),
        notBefore: recovery?.notBefore || null,
        attemptsRemaining: process.retry.attemptsRemaining,
        proof: recovery?.idempotencyKey || 'process-health-snapshot',
      };
    });
  const orphanIncidents = recoveryPlan.actions
    .filter((action) => action.action === 'mark-orphaned-after-restart')
    .map((action) => ({
      id: `orphan:${action.pid}`,
      severity: 'warning',
      category: 'restart-reconciliation',
      code: 'CLI_PS_PERSISTED_PROCESS_ORPHANED',
      target: action.pid,
      command: action.command,
      message: action.reason,
      operatorAction: 'Mark the persisted process orphaned after confirming it is absent from the provider table.',
      blocksDispatch: false,
      retryEligible: false,
      proof: action.idempotencyKey,
    }));
  const persistenceIncidents = persistenceProjection.stateIntegrity.blockingReasons.map((reason, index) => ({
    id: `persistence:${index}:${reason.key || reason.pid || reason.code}`,
    severity: 'critical',
    category: 'persisted-state-recovery',
    code: reason.code,
    target: reason.key || reason.pid || persistenceProjection.snapshotId,
    message: reason.message,
    operatorAction: reason.action,
    blocksDispatch: true,
    retryEligible: false,
    proof: persistenceProjection.stateIntegrity.proof.journalChecksum,
  }));
  const incidents = [
    ...validationIncidents,
    ...providerIncidents,
    ...providerOperationIncidents,
    ...syncIncidents,
    ...scopeIncidents,
    ...dependencyIncidents,
    ...processIncidents,
    ...orphanIncidents,
    ...persistenceIncidents,
  ];
  const blockingIncidents = incidents.filter((incident) => incident.blocksDispatch);
  const retryableIncidents = incidents.filter((incident) => incident.retryEligible);
  const exitCode = chooseOperationalExitCode(incidents, validation, syncMetadata);
  const dispatchBlocked = blockingIncidents.length > 0
    || !restartStatus.commandReplaySafe
    || previewAcceptance.acceptanceState === 'blocked';

  return {
    schema: 'hosted-kernel.cli-ps.operational-health-triage/v1',
    generatedAt,
    status: blockingIncidents.length
      ? 'blocked'
      : incidents.length
        ? 'degraded'
        : 'clear',
    exit: {
      code: exitCode,
      ok: exitCode === 0,
      reason: exitCode === 78
        ? 'validation-error'
        : exitCode === 2
          ? 'critical-operational-incident'
          : exitCode === 1
            ? 'degraded-operational-state'
            : 'clear',
    },
    dispatch: {
      blocked: dispatchBlocked,
      replayPolicy: restartStatus.commandReplaySafe ? 'at-most-once' : 'blocked-until-fresh-sync',
      reason: dispatchBlocked
        ? blockingIncidents[0]?.code || restartStatus.status
        : 'operational-health-clear',
    },
    degradedMode: {
      active: incidents.length > 0 && !blockingIncidents.length,
      readOnly: syncMetadata.stale || scopedProcessView.deniedCount > 0,
      handoffTarget: externalHandoff.target,
      handoffReason: externalHandoff.reason,
    },
    retryWindow: {
      retryableCount: retryableIncidents.length,
      nextNotBefore: retryableIncidents
        .map((incident) => incident.notBefore)
        .filter(Boolean)
        .sort()[0] || null,
      pendingRecoveryCount: recoveryPlan.pendingCount,
      effectivePendingRecoveryCount: recoveryPlan.dispatchablePendingCount,
      suppressedReplayCount: recoveryPlan.suppressedReplayCount,
    },
    incidents,
    incidentCounts: incidents.reduce((summary, incident) => {
      summary.total += 1;
      summary.bySeverity[incident.severity] = (summary.bySeverity[incident.severity] || 0) + 1;
      summary.byCategory[incident.category] = (summary.byCategory[incident.category] || 0) + 1;
      return summary;
    }, { total: 0, bySeverity: {}, byCategory: {} }),
    nextActions: incidents.slice(0, 5).map((incident) => ({
      action: incident.retryEligible ? 'retry-or-refresh' : 'operator-review',
      code: incident.code,
      target: incident.target,
      label: incident.operatorAction,
    })),
    proof: {
      validationOk: validation.ok && lifecycleSettings.validation.ok,
      providerNegotiation: capabilityNegotiation.status,
      syncConsistency: syncMetadata.consistency,
      restartStatus: restartStatus.status,
      previewAcceptanceState: previewAcceptance.acceptanceState,
      scopeBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildDispatchReadinessGate({
  generatedAt,
  clientRequest,
  operationalHealthTriage,
  previewAcceptance,
  clientWorkflow,
  operatorActionContracts,
  lifecycleControlContracts,
  recoveryPlan,
  syncMetadata,
  lifecycleSettings,
}) {
  const acceptedCommands = [
    ...operatorActionContracts.contracts
      .filter((contract) => contract.accepted)
      .map((contract) => ({
        key: contract.commandKey,
        source: 'operator-action',
        action: contract.action,
        pid: contract.pid,
        dispatchMode: contract.dispatchMode,
        replayPolicy: contract.replayPolicy,
      })),
    ...lifecycleControlContracts.contracts
      .filter((contract) => contract.accepted)
      .map((contract) => ({
        key: contract.commandKey,
        source: 'lifecycle-control',
        action: contract.action,
        control: contract.control,
        pid: contract.pid || null,
        dispatchMode: 'hosted-kernel-control',
        replayPolicy: contract.replayPolicy,
      })),
  ];
  const blockedContracts = [
    ...operatorActionContracts.contracts
      .filter((contract) => !contract.accepted)
      .map((contract) => ({
        source: 'operator-action',
        action: contract.action || 'unknown',
        target: contract.pid || `intent-${contract.index + 1}`,
        reason: contract.reason || contract.code,
      })),
    ...lifecycleControlContracts.contracts
      .filter((contract) => !contract.accepted)
      .map((contract) => ({
        source: 'lifecycle-control',
        action: contract.action || 'unknown',
        target: contract.pid || contract.control || `intent-${contract.index + 1}`,
        reason: contract.reasonBlocked,
      })),
  ];
  const blockingIncidents = operationalHealthTriage.incidents
    .filter((incident) => incident.blocksDispatch);
  const scheduledRetries = recoveryPlan.actions
    .filter((action) => action.action === 'schedule-retry' && !action.dispatchSuppressed)
    .sort((left, right) => String(left.notBefore).localeCompare(String(right.notBefore)))
    .map((action) => ({
      pid: action.pid,
      command: action.command,
      attempt: action.attempt,
      maxAttempts: action.maxAttempts,
      notBefore: action.notBefore,
      idempotencyKey: action.idempotencyKey,
    }));
  const manualRecoveries = recoveryPlan.actions
    .filter((action) => action.action !== 'schedule-retry')
    .map((action) => ({
      pid: action.pid,
      action: action.action,
      reason: action.reason,
      idempotencyKey: action.idempotencyKey,
      replayState: action.replayState,
      dispatchSuppressed: action.dispatchSuppressed,
    }));
  const dispatchBlocked = operationalHealthTriage.dispatch.blocked
    || previewAcceptance.acceptanceState === 'blocked'
    || syncMetadata.stale;
  const commandIntentPresent = operatorActionContracts.requestedCount > 0
    || lifecycleControlContracts.requestedCount > 0;
  const dryRunOnly = acceptedCommands.length > 0
    && acceptedCommands.every((command) => command.dispatchMode === 'audit-only');
  const readinessState = dispatchBlocked
    ? 'blocked'
    : acceptedCommands.length
      ? dryRunOnly
        ? 'audit-only-ready'
        : 'ready-to-dispatch'
      : scheduledRetries.length
        ? 'retry-scheduled'
        : operationalHealthTriage.degradedMode.active
          ? 'degraded-read-only'
          : commandIntentPresent
            ? 'no-accepted-commands'
            : 'view-only-ready';
  const actionableErrors = [
    ...blockingIncidents.map((incident) => ({
      code: incident.code,
      target: incident.target,
      severity: incident.severity,
      message: incident.message,
      action: incident.operatorAction,
      retryAfter: incident.notBefore || null,
    })),
    ...blockedContracts.map((contract) => ({
      code: 'CLI_PS_COMMAND_CONTRACT_BLOCKED',
      target: contract.target,
      severity: 'warning',
      message: `${contract.source} ${contract.action} is blocked by ${contract.reason}.`,
      action: contract.reason === 'provider-sync-stale'
        ? 'Refresh the hosted-kernel process table and resubmit the command intent.'
        : 'Review the command contract reason before dispatch.',
      retryAfter: syncMetadata.stale ? generatedAt : null,
    })),
  ];

  return {
    schema: 'hosted-kernel.cli-ps.dispatch-readiness-gate/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state: readinessState,
    dispatchAllowed: readinessState === 'ready-to-dispatch',
    auditOnly: dryRunOnly || readinessState === 'audit-only-ready',
    readOnly: operationalHealthTriage.degradedMode.readOnly || readinessState === 'degraded-read-only',
    blocked: dispatchBlocked,
    blockedBy: dispatchBlocked
      ? [
          operationalHealthTriage.dispatch.blocked ? operationalHealthTriage.dispatch.reason : null,
          previewAcceptance.acceptanceState === 'blocked' ? 'preview-acceptance-blocked' : null,
          syncMetadata.stale ? 'provider-sync-stale' : null,
        ].filter(Boolean)
      : [],
    commandQueue: {
      acceptedCount: acceptedCommands.length,
      blockedCount: blockedContracts.length,
      replayPolicy: syncMetadata.stale ? 'blocked-until-fresh-sync' : 'at-most-once',
      acceptedCommands,
      blockedContracts,
    },
    retryBackoff: {
      enabled: lifecycleSettings.controls['auto-retry'],
      quietUntil: lifecycleSettings.schedule.quietUntil,
      pausedControls: lifecycleSettings.schedule.pausedControls,
      autoRetryPaused: lifecycleSettings.schedule.autoRetryPaused,
      activeMaintenanceWindowCount: lifecycleSettings.schedule.activeWindowCount,
      maxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
      scheduledCount: scheduledRetries.length,
      nextNotBefore: scheduledRetries[0]?.notBefore || operationalHealthTriage.retryWindow.nextNotBefore,
      scheduledRetries,
      manualRecoveries,
    },
    degradedMode: {
      active: operationalHealthTriage.degradedMode.active,
      readOnly: operationalHealthTriage.degradedMode.readOnly,
      handoffTarget: operationalHealthTriage.degradedMode.handoffTarget,
      reason: operationalHealthTriage.degradedMode.handoffReason,
    },
    actionableErrors,
    nextOperatorCommand: dispatchBlocked
      ? 'refresh-or-fix-blockers'
      : acceptedCommands.length
        ? dryRunOnly ? 'review-audit-only-command-envelope' : 'dispatch-idempotent-command-envelope'
        : scheduledRetries.length
          ? 'wait-for-retry-window-or-open-inspect'
          : operationalHealthTriage.degradedMode.active
            ? 'operate-read-only-and-handoff'
            : 'continue-process-review',
    proof: {
      operationalHealthSchema: operationalHealthTriage.schema,
      previewProofRef: previewAcceptance.clientContract.proofRef,
      workflowPayloadRef: clientWorkflow.handoff.payloadRef,
      syncCursor: syncMetadata.cursor,
      syncConsistency: syncMetadata.consistency,
      recoveryPlanSchema: recoveryPlan.schema,
    },
  };
}

function buildHostedKernelDispatchEnvelope({
  generatedAt,
  clientRequest,
  syncMetadata,
  dispatchReadinessGate,
  operatorActionContracts,
  lifecycleControlContracts,
  providerServiceContracts,
}) {
  const commandAccepted = dispatchReadinessGate.dispatchAllowed
    || dispatchReadinessGate.auditOnly;
  const operatorCommands = operatorActionContracts.contracts
    .filter((contract) => contract.accepted)
    .map((contract) => ({
      key: contract.commandKey,
      kind: 'operator-action',
      action: contract.action,
      dispatchMode: contract.dispatchMode,
      replayPolicy: contract.replayPolicy,
      dryRun: contract.dryRun,
      target: {
        pid: contract.pid,
        command: contract.target?.command || null,
        state: contract.target?.state || null,
        health: contract.target?.health || null,
        tenantId: contract.boundaryDecision?.targetScope?.tenantId || null,
        workspaceId: contract.boundaryDecision?.targetScope?.workspaceId || null,
      },
      payload: {
        action: contract.action,
        pid: contract.pid,
        reason: contract.reason,
        requestedBy: contract.requestedBy,
        requiresFreshSync: contract.requiresFreshSync,
        clientRequestId: contract.clientRequestId,
        boundaryProofRef: contract.boundaryDecision?.proofRef || null,
      },
      preconditions: [
        providerServiceContracts.optionalContracts
          .some((operation) => operation.operation === 'dispatchOperatorAction' && operation.accepted)
          ? 'provider-operation-dispatchOperatorAction'
          : 'provider-operation-auditOnly',
        ...(contract.boundaryDecision?.preconditions || ['process-visible-to-scope']),
        contract.requiresFreshSync ? 'provider-sync-fresh' : 'provider-sync-may-be-eventual',
      ],
      boundaryDecision: contract.boundaryDecision || null,
      acceptedForDispatch: commandAccepted && contract.dispatchMode !== 'audit-only',
      proof: contract.proof,
    }));
  const lifecycleCommands = lifecycleControlContracts.contracts
    .filter((contract) => contract.accepted)
    .map((contract) => ({
      key: contract.commandKey,
      kind: 'lifecycle-control',
      action: contract.action,
      control: contract.control,
      dispatchMode: 'hosted-kernel-control',
      replayPolicy: contract.replayPolicy,
      target: contract.target
        ? {
          pid: contract.target.pid,
          command: contract.target.command,
          state: contract.target.state,
          health: contract.target.health,
          tenantId: contract.boundaryDecision?.targetScope?.tenantId || null,
          workspaceId: contract.boundaryDecision?.targetScope?.workspaceId || null,
        }
        : null,
      payload: {
        action: contract.action,
        control: contract.control,
        pid: contract.pid || null,
        requestedBy: contract.requestedBy,
        reason: contract.reason,
        notBefore: contract.notBefore,
        resultingEnabled: contract.resultingEnabled,
        requiredCapability: contract.requiredCapability,
        clientRequestId: contract.clientRequestId,
        boundaryProofRef: contract.boundaryDecision?.proofRef || null,
      },
      preconditions: [
        providerServiceContracts.requiredContracts
          .some((operation) => operation.operation === 'getLifecycleState' && operation.accepted)
          ? 'provider-operation-getLifecycleState'
          : 'provider-operation-blocked',
        contract.requiredCapability || 'lifecycle-control-core',
        ...(contract.boundaryDecision?.preconditions || ['operator-scope-authorized']),
        contract.requiresFreshSync ? 'provider-sync-fresh' : 'provider-sync-may-be-eventual',
      ],
      boundaryDecision: contract.boundaryDecision || null,
      acceptedForDispatch: commandAccepted,
      proof: lifecycleControlContracts.proof.providerNegotiation,
    }));
  const commands = [...operatorCommands, ...lifecycleCommands];
  const blocked = [
    ...operatorActionContracts.contracts
      .filter((contract) => !contract.accepted)
      .map((contract) => ({
        kind: 'operator-action',
        action: contract.action || 'unknown',
        target: contract.pid || `intent-${contract.index + 1}`,
        reason: contract.reason || contract.code,
        clientRequestId: contract.clientRequestId || null,
      })),
    ...lifecycleControlContracts.contracts
      .filter((contract) => !contract.accepted)
      .map((contract) => ({
        kind: 'lifecycle-control',
        action: contract.action || 'unknown',
        target: contract.pid || contract.control || `intent-${contract.index + 1}`,
        reason: contract.reasonBlocked,
        clientRequestId: contract.clientRequestId || null,
      })),
  ];
  const dispatchableCommands = commands.filter((command) => command.acceptedForDispatch);
  const auditOnlyCommands = commands.filter((command) => !command.acceptedForDispatch);

  return {
    schema: 'hosted-kernel.cli-ps.hosted-kernel-dispatch-envelope/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    batchKey: `cli-ps:dispatch:${syncMetadata.cursor}:${clientRequest.requestId}`,
    state: dispatchReadinessGate.blocked
      ? 'blocked'
      : dispatchableCommands.length
        ? 'ready'
        : auditOnlyCommands.length
          ? 'audit-only'
          : blocked.length
            ? 'no-accepted-commands'
            : 'empty',
    cursor: syncMetadata.cursor,
    sequence: syncMetadata.sequence,
    replayPolicy: dispatchReadinessGate.commandQueue.replayPolicy,
    dispatchableCount: dispatchableCommands.length,
    auditOnlyCount: auditOnlyCommands.length,
    blockedCount: blocked.length,
    commands,
    blocked,
    proof: {
      readinessSchema: dispatchReadinessGate.schema,
      readinessState: dispatchReadinessGate.state,
      readinessBlockedBy: dispatchReadinessGate.blockedBy,
      operatorActionSchema: operatorActionContracts.schema,
      lifecycleControlSchema: lifecycleControlContracts.schema,
      providerServiceContractSchema: providerServiceContracts.schema,
      providerOperationState: providerServiceContracts.state,
      providerOperationChecksum: providerServiceContracts.proof.operationChecksum,
      operatorBoundaryDecisionChecksum: operatorActionContracts.proof.boundaryDecisionChecksum,
      lifecycleBoundaryDecisionChecksum: lifecycleControlContracts.proof.boundaryDecisionChecksum,
      acceptedCommandKeys: commands.map((command) => command.key),
      blockedTargets: blocked.map((command) => command.target),
      syncConsistency: syncMetadata.consistency,
    },
  };
}

function summarizeHealth(processes, validation) {
  const counts = processes.reduce((summary, process) => {
    summary.total += 1;
    summary[process.health] = (summary[process.health] || 0) + 1;
    return summary;
  }, { total: 0, healthy: 0, degraded: 0, failed: 0, unknown: 0 });

  const mode = !validation.ok || counts.failed > 0
    ? 'failed'
    : counts.degraded > 0 || counts.unknown > 0
      ? 'degraded'
      : 'normal';

  return {
    mode,
    counts,
    degradedMode: mode === 'degraded',
    failureState: mode === 'failed',
  };
}

function buildAnalytics(processes, health) {
  const counters = processes.reduce((summary, process) => {
    summary.byState[process.state] = (summary.byState[process.state] || 0) + 1;
    summary.byOwner[process.owner] = (summary.byOwner[process.owner] || 0) + 1;
    summary.totalRestarts += process.restartCount;
    summary.retryable += process.retry.retryable ? 1 : 0;
    summary.retryBudgetRemaining += process.retry.attemptsRemaining;
    summary.uptimeMs.total += process.uptimeMs;
    summary.uptimeMs.max = Math.max(summary.uptimeMs.max, process.uptimeMs);
    if (process.lastError) {
      summary.erroring += 1;
    }
    if (process.dependencyHealth.status === 'blocked') {
      summary.dependencyBlocked += 1;
    }
    if (process.dependencyHealth.status === 'degraded') {
      summary.dependencyDegraded += 1;
    }
    return summary;
  }, {
    byState: {},
    byOwner: {},
    totalRestarts: 0,
    retryable: 0,
    retryBudgetRemaining: 0,
    erroring: 0,
    dependencyBlocked: 0,
    dependencyDegraded: 0,
    uptimeMs: { total: 0, average: 0, max: 0 },
  });

  counters.uptimeMs.average = processes.length
    ? Math.round(counters.uptimeMs.total / processes.length)
    : 0;

  return {
    counters,
    rates: {
      healthyPercent: percent(health.counts.healthy, health.counts.total),
      degradedPercent: percent(health.counts.degraded, health.counts.total),
      failedPercent: percent(health.counts.failed, health.counts.total),
      restartPressure: percent(counters.totalRestarts, Math.max(1, health.counts.total)),
    },
  };
}

function normalizeHistoryEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const counts = entry.counts && typeof entry.counts === 'object' ? entry.counts : {};
  return {
    capturedAt: cleanString(entry.capturedAt ?? entry.generatedAt ?? entry.at, `history-${index + 1}`),
    mode: cleanString(entry.mode ?? entry.health?.mode, 'unknown'),
    total: normalizeNumber(entry.total ?? counts.total, 0),
    healthy: normalizeNumber(entry.healthy ?? counts.healthy, 0),
    degraded: normalizeNumber(entry.degraded ?? counts.degraded, 0),
    failed: normalizeNumber(entry.failed ?? counts.failed, 0),
    restarts: normalizeNumber(entry.restarts ?? entry.totalRestarts, 0),
  };
}

function normalizePersistedProcess(process, generatedAt) {
  if (!process || typeof process !== 'object') {
    return null;
  }

  const pid = cleanString(process.pid ?? process.id);
  if (!pid) {
    return null;
  }

  const lastSeenAt = cleanString(process.lastSeenAt ?? process.updatedAt ?? process.generatedAt, generatedAt);
  return {
    pid,
    command: cleanString(process.command ?? process.name, 'unknown'),
    state: cleanString(process.state ?? process.status, 'unknown').toLowerCase(),
    health: cleanString(process.health, 'unknown').toLowerCase(),
    restartCount: normalizeNumber(process.restartCount ?? process.restarts, 0),
    lastSeenAt,
    lastStableAt: cleanString(process.lastStableAt ?? process.startedAt, ''),
    recoveryGeneration: normalizeNumber(process.recoveryGeneration, 0),
    lastCommandKey: cleanString(process.lastCommandKey, ''),
  };
}

function normalizePersistedCommandJournalEntry(entry, index, generatedAt) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const key = cleanString(entry.key ?? entry.idempotencyKey ?? entry.commandKey);
  if (!key) {
    return null;
  }

  const state = cleanString(entry.state ?? entry.status, 'recorded').toLowerCase();
  const recordedAt = cleanString(
    entry.recordedAt ?? entry.updatedAt ?? entry.createdAt,
    generatedAt,
  );

  return {
    schema: 'hosted-kernel.cli-ps.persisted-command-journal-entry/v1',
    index,
    key,
    state,
    pid: cleanString(entry.pid ?? entry.processId, ''),
    type: cleanString(entry.type ?? entry.action, 'unknown'),
    cursor: cleanString(entry.cursor ?? entry.replayWindowCursor, ''),
    recordedAt,
    completedAt: cleanString(entry.completedAt ?? entry.appliedAt, ''),
    attempt: normalizeNumber(entry.attempt, 0),
    replaySafe: state === 'completed' || state === 'recorded' || state === 'dispatched',
    commandFingerprint: lightweightChecksum({
      key,
      pid: cleanString(entry.pid ?? entry.processId, ''),
      type: cleanString(entry.type ?? entry.action, 'unknown'),
      cursor: cleanString(entry.cursor ?? entry.replayWindowCursor, ''),
      attempt: normalizeNumber(entry.attempt, 0),
    }),
  };
}

function buildPersistedJournalIntegrity(commandJournal) {
  const entriesByKey = commandJournal.reduce((summary, entry) => {
    if (!summary.has(entry.key)) {
      summary.set(entry.key, []);
    }
    summary.get(entry.key).push(entry);
    return summary;
  }, new Map());
  const duplicateKeys = [...entriesByKey.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => {
      const fingerprints = [...new Set(entries.map((entry) => entry.commandFingerprint))];
      const states = [...new Set(entries.map((entry) => entry.state))].sort();
      const cursors = [...new Set(entries.map((entry) => entry.cursor).filter(Boolean))].sort();
      const conflict = fingerprints.length > 1;
      return {
        key,
        count: entries.length,
        states,
        cursors,
        conflict,
        firstRecordedAt: entries
          .map((entry) => entry.recordedAt)
          .filter(Boolean)
          .sort()[0] || null,
        latestRecordedAt: entries
          .map((entry) => entry.recordedAt)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
        fingerprints,
      };
    });
  const unsafeEntries = commandJournal.filter((entry) => !entry.replaySafe);
  const conflictingKeys = duplicateKeys.filter((entry) => entry.conflict);
  const recoveryBlockingReasons = [
    ...conflictingKeys.map((entry) => ({
      code: 'CLI_PS_COMMAND_JOURNAL_CONFLICT',
      key: entry.key,
      message: 'Persisted command journal has duplicate idempotency keys with different command fingerprints.',
      action: 'Reconcile or compact the command journal before replaying hosted-kernel commands.',
    })),
    ...unsafeEntries.map((entry) => ({
      code: 'CLI_PS_COMMAND_JOURNAL_UNSAFE_STATE',
      key: entry.key,
      message: `Persisted command ${entry.key} is in non replay-safe state ${entry.state}.`,
      action: 'Confirm command outcome or mark it completed before enabling automatic replay.',
    })),
  ];

  return {
    schema: 'hosted-kernel.cli-ps.persisted-command-journal-integrity/v1',
    ok: recoveryBlockingReasons.length === 0,
    duplicateKeyCount: duplicateKeys.length,
    conflictingKeyCount: conflictingKeys.length,
    unsafeEntryCount: unsafeEntries.length,
    replaySafe: recoveryBlockingReasons.length === 0,
    duplicateKeys,
    unsafeKeys: unsafeEntries.map((entry) => entry.key),
    recoveryBlockingReasons,
    journalChecksum: lightweightChecksum(commandJournal.map((entry) => ({
      key: entry.key,
      state: entry.state,
      cursor: entry.cursor,
      fingerprint: entry.commandFingerprint,
    }))),
  };
}

function normalizePersistedState(input, generatedAt) {
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : {};
  const rawProcesses = asArray(persisted.processes ?? persisted.processTable);
  const processRecords = rawProcesses
    .map((process) => normalizePersistedProcess(process, generatedAt))
    .filter(Boolean);
  const commandJournal = asArray(
    persisted.commandJournal
      ?? persisted.idempotentCommands
      ?? persisted.commands
      ?? persisted.appliedCommands,
  )
    .map((entry, index) => normalizePersistedCommandJournalEntry(entry, index, generatedAt))
    .filter(Boolean)
    .slice(-HISTORY_LIMIT * 4);
  const commandJournalIntegrity = buildPersistedJournalIntegrity(commandJournal);

  return {
    schema: 'hosted-kernel.cli-ps.persisted-state/v1',
    storeId: cleanString(persisted.storeId ?? input.stateStoreId, 'hosted-kernel.cli-ps.state'),
    loaded: Boolean(persisted.loaded || processRecords.length || commandJournal.length || persisted.snapshotId),
    snapshotId: cleanString(persisted.snapshotId ?? input.snapshotId, 'none'),
    generation: normalizeNumber(persisted.generation ?? persisted.revision, 0),
    writtenAt: cleanString(persisted.writtenAt ?? persisted.savedAt, ''),
    bootId: cleanString(persisted.bootId ?? input.bootId, 'boot-unknown'),
    processRecords,
    commandJournal,
    commandJournalSummary: {
      recordedCount: commandJournal.length,
      replaySafeCount: commandJournal.filter((entry) => entry.replaySafe).length,
      duplicateKeyCount: commandJournalIntegrity.duplicateKeyCount,
      conflictingKeyCount: commandJournalIntegrity.conflictingKeyCount,
      unsafeEntryCount: commandJournalIntegrity.unsafeEntryCount,
      latestRecordedAt: commandJournal
        .map((entry) => entry.recordedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      keys: commandJournal.map((entry) => entry.key),
    },
    commandJournalIntegrity,
  };
}

function buildPersistenceProjection(processes, persistedState, generatedAt, syncMetadata) {
  const persistedByPid = new Map(persistedState.processRecords.map((process) => [process.pid, process]));
  const records = processes.map((process) => {
    const previous = persistedByPid.get(process.pid);
    const stable = process.health === 'healthy';
    return {
      pid: process.pid,
      command: process.command,
      state: process.state,
      health: process.health,
      restartCount: process.restartCount,
      lastSeenAt: generatedAt,
      lastStableAt: stable
        ? generatedAt
        : previous?.lastStableAt || null,
      recoveryGeneration: previous?.recoveryGeneration ?? 0,
      lastCommandKey: previous?.lastCommandKey || null,
    };
  });
  const activePids = new Set(records.map((process) => process.pid));
  const orphaned = persistedState.processRecords
    .filter((process) => !activePids.has(process.pid))
    .map((process) => ({
      pid: process.pid,
      command: process.command,
      previousState: process.state,
      previousHealth: process.health,
      lastSeenAt: process.lastSeenAt,
      recoveryGeneration: process.recoveryGeneration,
    }));
  const activePidSet = new Set(processes.map((process) => process.pid));
  const staleJournalTargets = persistedState.commandJournal
    .filter((entry) => entry.pid && !activePidSet.has(entry.pid))
    .map((entry) => ({
      key: entry.key,
      pid: entry.pid,
      type: entry.type,
      cursor: entry.cursor,
      recordedAt: entry.recordedAt,
    }));
  const integrityReasons = [
    ...persistedState.commandJournalIntegrity.recoveryBlockingReasons,
    ...staleJournalTargets.map((entry) => ({
      code: 'CLI_PS_COMMAND_JOURNAL_STALE_TARGET',
      key: entry.key,
      pid: entry.pid,
      message: `Persisted command ${entry.key} targets process ${entry.pid}, which is absent from the current snapshot.`,
      action: 'Reconcile the target as orphaned before replaying or dispatching related commands.',
    })),
  ];
  const writeBarrier = syncMetadata.stale
    ? 'defer-write-until-fresh-sync'
    : integrityReasons.length
      ? 'repair-persisted-state-before-write'
      : orphaned.length
        ? 'append-orphan-reconciliation-before-replace'
        : 'atomic-replace';

  return {
    schema: persistedState.schema,
    storeId: persistedState.storeId,
    snapshotId: `${syncMetadata.cursor}:g${persistedState.generation + 1}`,
    generation: persistedState.generation + 1,
    bootId: persistedState.bootId,
    writtenAt: generatedAt,
    writeMode: writeBarrier,
    records,
    orphaned,
    commandJournal: persistedState.commandJournal,
    replaySafeCommandKeys: persistedState.commandJournal
      .filter((entry) => entry.replaySafe)
      .map((entry) => entry.key),
    journalWatermark: {
      previousGeneration: persistedState.generation,
      previousSnapshotId: persistedState.snapshotId,
      retainedCommandCount: persistedState.commandJournal.length,
      latestRecordedAt: persistedState.commandJournalSummary.latestRecordedAt,
    },
    stateIntegrity: {
      schema: 'hosted-kernel.cli-ps.persistence-integrity/v1',
      ok: integrityReasons.length === 0,
      restartSafe: !syncMetadata.stale && integrityReasons.length === 0,
      replaySafe: persistedState.commandJournalIntegrity.replaySafe && staleJournalTargets.length === 0,
      writeBarrier,
      blockingReasonCount: integrityReasons.length,
      staleJournalTargetCount: staleJournalTargets.length,
      staleJournalTargets,
      commandJournal: persistedState.commandJournalIntegrity,
      blockingReasons: integrityReasons,
      proof: {
        persistedSnapshotId: persistedState.snapshotId,
        nextSnapshotId: `${syncMetadata.cursor}:g${persistedState.generation + 1}`,
        activeProcessChecksum: lightweightChecksum(records.map((process) => ({
          pid: process.pid,
          state: process.state,
          health: process.health,
          restartCount: process.restartCount,
        }))),
        journalChecksum: persistedState.commandJournalIntegrity.journalChecksum,
      },
    },
    restartSafe: !syncMetadata.stale && integrityReasons.length === 0,
  };
}

function buildRestartReconciliationState({
  processes,
  persistedState,
  persistenceProjection,
  recoveryPlan,
  syncMetadata,
  generatedAt,
}) {
  const persistedByPid = new Map(persistedState.processRecords.map((process) => [process.pid, process]));
  const recoveryByPid = new Map(recoveryPlan.actions.map((action) => [action.pid, action]));
  const activeRows = processes.map((process) => {
    const previous = persistedByPid.get(process.pid);
    const recoveryAction = recoveryByPid.get(process.pid);
    const restartAdvanced = previous
      ? process.restartCount > previous.restartCount
      : false;
    const stateChanged = previous
      ? process.state !== previous.state || process.health !== previous.health
      : false;
    const status = !previous
      ? 'new-after-restart'
      : recoveryAction?.dispatchSuppressed
        ? 'replay-suppressed'
        : restartAdvanced
          ? 'restart-count-advanced'
          : stateChanged
            ? 'changed-since-persisted'
            : 'resumed';
    const replayBlocked = !persistenceProjection.stateIntegrity.replaySafe
      || syncMetadata.stale
      || recoveryAction?.restartSafeCommand === false;

    return {
      schema: 'hosted-kernel.cli-ps.restart-reconciliation-row/v1',
      pid: process.pid,
      command: process.command,
      status,
      persisted: Boolean(previous),
      orphaned: false,
      replayBlocked,
      current: {
        state: process.state,
        health: process.health,
        restartCount: process.restartCount,
        lastSeenAt: generatedAt,
      },
      previous: previous
        ? {
            state: previous.state,
            health: previous.health,
            restartCount: previous.restartCount,
            lastSeenAt: previous.lastSeenAt,
            lastStableAt: previous.lastStableAt || null,
            recoveryGeneration: previous.recoveryGeneration,
            lastCommandKey: previous.lastCommandKey || null,
          }
        : null,
      recovery: recoveryAction
        ? {
            action: recoveryAction.action,
            idempotencyKey: recoveryAction.idempotencyKey,
            replayState: recoveryAction.replayState,
            dispatchSuppressed: recoveryAction.dispatchSuppressed,
            journalEffect: recoveryAction.journalEffect,
            notBefore: recoveryAction.notBefore || null,
          }
        : null,
      operatorAction: replayBlocked
        ? 'repair-persistence-or-refresh-before-replay'
        : recoveryAction?.dispatchSuppressed
          ? 'continue-from-recorded-command'
          : recoveryAction
            ? 'review-recovery-action'
            : status === 'new-after-restart'
              ? 'persist-new-process-row'
              : 'continue-monitoring',
      proofRef: lightweightChecksum({
        pid: process.pid,
        status,
        currentState: process.state,
        previousState: previous?.state || null,
        currentRestartCount: process.restartCount,
        previousRestartCount: previous?.restartCount ?? null,
        recoveryKey: recoveryAction?.idempotencyKey || null,
      }),
    };
  });
  const orphanRows = persistenceProjection.orphaned.map((process) => {
    const recoveryAction = recoveryByPid.get(process.pid);
    const replayBlocked = !persistenceProjection.stateIntegrity.replaySafe || syncMetadata.stale;
    return {
      schema: 'hosted-kernel.cli-ps.restart-reconciliation-row/v1',
      pid: process.pid,
      command: process.command,
      status: replayBlocked ? 'orphaned-replay-blocked' : 'orphaned-reconcile',
      persisted: true,
      orphaned: true,
      replayBlocked,
      current: null,
      previous: {
        state: process.previousState,
        health: process.previousHealth,
        restartCount: null,
        lastSeenAt: process.lastSeenAt,
        lastStableAt: null,
        recoveryGeneration: process.recoveryGeneration,
        lastCommandKey: null,
      },
      recovery: recoveryAction
        ? {
            action: recoveryAction.action,
            idempotencyKey: recoveryAction.idempotencyKey,
            replayState: recoveryAction.replayState,
            dispatchSuppressed: recoveryAction.dispatchSuppressed,
            journalEffect: recoveryAction.journalEffect,
            notBefore: recoveryAction.notBefore || null,
          }
        : null,
      operatorAction: replayBlocked
        ? 'repair-persistence-or-refresh-before-orphan-reconcile'
        : 'mark-orphaned-after-provider-confirmation',
      proofRef: lightweightChecksum({
        pid: process.pid,
        status: replayBlocked ? 'orphaned-replay-blocked' : 'orphaned-reconcile',
        previousState: process.previousState,
        previousHealth: process.previousHealth,
        recoveryKey: recoveryAction?.idempotencyKey || null,
      }),
    };
  });
  const rows = [...activeRows, ...orphanRows];
  const blockingRows = rows.filter((row) => row.replayBlocked);

  return {
    schema: 'hosted-kernel.cli-ps.restart-reconciliation/v1',
    generatedAt,
    state: blockingRows.length
      ? 'replay-blocked'
      : orphanRows.length
        ? 'orphan-reconciliation-required'
        : activeRows.some((row) => row.status !== 'resumed')
          ? 'state-changes-detected'
          : persistedState.loaded
            ? 'resumed-from-persisted-state'
            : 'no-persisted-state',
    loadedPersistedState: persistedState.loaded,
    syncCursor: syncMetadata.cursor,
    rows,
    counts: rows.reduce((summary, row) => {
      summary.total += 1;
      summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + 1;
      if (row.orphaned) {
        summary.orphaned += 1;
      }
      if (row.replayBlocked) {
        summary.replayBlocked += 1;
      }
      if (row.recovery) {
        summary.withRecoveryAction += 1;
      }
      return summary;
    }, { total: 0, orphaned: 0, replayBlocked: 0, withRecoveryAction: 0, byStatus: {} }),
    nextOperatorAction: blockingRows[0]
      ? blockingRows[0].operatorAction
      : orphanRows.length
        ? 'reconcile-orphaned-persisted-processes'
        : recoveryPlan.dispatchablePendingCount
          ? 'review-dispatchable-recovery-actions'
          : 'continue-process-review',
    proof: {
      persistenceProjectionSchema: persistenceProjection.schema,
      recoveryPlanSchema: recoveryPlan.schema,
      persistedSnapshotId: persistedState.snapshotId,
      projectedSnapshotId: persistenceProjection.snapshotId,
      rowChecksum: lightweightChecksum(rows.map((row) => ({
        pid: row.pid,
        status: row.status,
        replayBlocked: row.replayBlocked,
        recoveryKey: row.recovery?.idempotencyKey || null,
      }))),
      journalChecksum: persistenceProjection.stateIntegrity.proof.journalChecksum,
    },
  };
}

function buildHistory(input, generatedAt, health, analytics) {
  const prior = asArray(input.history)
    .map((entry, index) => normalizeHistoryEntry(entry, index))
    .filter(Boolean)
    .slice(-HISTORY_LIMIT + 1);

  const current = {
    capturedAt: generatedAt,
    mode: health.mode,
    total: health.counts.total,
    healthy: health.counts.healthy,
    degraded: health.counts.degraded,
    failed: health.counts.failed,
    restarts: analytics.counters.totalRestarts,
  };
  const timeline = [...prior, current];
  const previous = timeline.length > 1 ? timeline[timeline.length - 2] : null;

  return {
    limit: HISTORY_LIMIT,
    snapshots: timeline,
    current,
    previous,
    delta: previous
      ? {
          total: current.total - previous.total,
          healthy: current.healthy - previous.healthy,
          degraded: current.degraded - previous.degraded,
          failed: current.failed - previous.failed,
          restarts: current.restarts - previous.restarts,
        }
      : null,
  };
}

function buildAnalyticsTrend(history, analytics) {
  const first = history.snapshots[0] || history.current;
  const current = history.current;
  const previous = history.previous;
  const peak = history.snapshots.reduce((summary, snapshot) => ({
    total: Math.max(summary.total, snapshot.total),
    degraded: Math.max(summary.degraded, snapshot.degraded),
    failed: Math.max(summary.failed, snapshot.failed),
    restarts: Math.max(summary.restarts, snapshot.restarts),
    attention: Math.max(summary.attention, snapshot.degraded + snapshot.failed),
  }), { total: 0, degraded: 0, failed: 0, restarts: 0, attention: 0 });
  const net = {
    total: current.total - first.total,
    healthy: current.healthy - first.healthy,
    degraded: current.degraded - first.degraded,
    failed: current.failed - first.failed,
    restarts: current.restarts - first.restarts,
  };
  const delta = history.delta || {
    total: 0,
    healthy: 0,
    degraded: 0,
    failed: 0,
    restarts: 0,
  };
  const currentAttention = current.degraded + current.failed;
  const previousAttention = previous ? previous.degraded + previous.failed : currentAttention;
  const movement = delta.failed > 0 || delta.degraded > 0
    ? 'regression'
    : delta.failed < 0 || delta.degraded < 0
      ? 'recovery'
      : delta.restarts > 0
        ? 'churn'
        : 'steady';

  return {
    schema: 'hosted-kernel.cli-ps.analytics-trend/v1',
    sampleCount: history.snapshots.length,
    windowStart: first.capturedAt,
    windowEnd: current.capturedAt,
    movement,
    currentAttention,
    previousAttention,
    attentionDelta: currentAttention - previousAttention,
    net,
    delta,
    peak,
    counters: {
      restartedSincePrevious: Math.max(0, delta.restarts),
      failedSincePrevious: Math.max(0, delta.failed),
      recoveredSincePrevious: Math.max(0, -delta.failed),
      degradedSincePrevious: Math.max(0, delta.degraded),
      stabilizedSincePrevious: Math.max(0, -delta.degraded),
      retryBudgetRemaining: analytics.counters.retryBudgetRemaining,
      erroringProcessCount: analytics.counters.erroring,
    },
    rates: {
      attentionPercent: percent(currentAttention, Math.max(1, current.total)),
      restartPressure: percent(analytics.counters.totalRestarts, Math.max(1, current.total)),
      failureRateChange: percent(delta.failed, Math.max(1, previous?.total ?? current.total)),
      degradedRateChange: percent(delta.degraded, Math.max(1, previous?.total ?? current.total)),
    },
  };
}

function buildTimelineReport(history, analyticsTrend, generatedAt, syncMetadata, scopedProcessView) {
  const events = history.snapshots.map((snapshot, index) => {
    const previous = index > 0 ? history.snapshots[index - 1] : null;
    const attentionCount = snapshot.failed + snapshot.degraded;
    const previousAttention = previous ? previous.failed + previous.degraded : attentionCount;
    const attentionDelta = attentionCount - previousAttention;
    const restartDelta = previous ? snapshot.restarts - previous.restarts : 0;
    const eventType = !previous
      ? 'baseline'
      : attentionDelta > 0
        ? 'attention-increase'
        : attentionDelta < 0
          ? 'attention-decrease'
          : restartDelta > 0
            ? 'restart-churn'
            : 'no-change';

    return {
      index,
      capturedAt: snapshot.capturedAt,
      mode: snapshot.mode,
      eventType,
      total: snapshot.total,
      attentionCount,
      attentionDelta,
      restartDelta,
      failed: snapshot.failed,
      degraded: snapshot.degraded,
      healthy: snapshot.healthy,
    };
  });
  const lastEvent = events[events.length - 1] || null;
  const timelineState = analyticsTrend.movement === 'regression'
    ? 'regressed'
    : analyticsTrend.movement === 'recovery'
      ? 'recovered'
      : analyticsTrend.movement === 'churn'
        ? 'restart-churn'
        : 'steady';

  return {
    schema: 'hosted-kernel.cli-ps.timeline-report/v1',
    generatedAt,
    state: timelineState,
    eventCount: events.length,
    events,
    latestEventType: lastEvent?.eventType || 'none',
    exportWindow: {
      cursor: syncMetadata.cursor,
      sequence: syncMetadata.sequence,
      from: analyticsTrend.windowStart,
      to: analyticsTrend.windowEnd,
      sampleCount: analyticsTrend.sampleCount,
    },
    scope: {
      tenantId: scopedProcessView.tenantId,
      workspaceId: scopedProcessView.workspaceId,
      visibleCount: scopedProcessView.visibleCount,
      deniedCount: scopedProcessView.deniedCount,
    },
    proof: {
      source: 'history-snapshots',
      currentIncluded: Boolean(history.current),
      previousIncluded: Boolean(history.previous),
      trendSchema: analyticsTrend.schema,
      redactionBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildAnalyticsExportState({
  generatedAt,
  processes,
  analytics,
  analyticsTrend,
  timelineReport,
  syncMetadata,
  scopedProcessView,
  operationalHealthTriage,
  processTablePresentation,
}) {
  const increment = (summary, key) => {
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  };
  const shapeSummaryRow = (metric, value, category, detail = {}) => ({
    capturedAt: generatedAt,
    cursor: syncMetadata.cursor,
    sequence: syncMetadata.sequence,
    metric,
    value,
    category,
    tenantId: scopedProcessView.tenantId,
    workspaceId: scopedProcessView.workspaceId,
    timelineState: timelineReport.state,
    trendMovement: analyticsTrend.movement,
    exportMode: syncMetadata.stale || scopedProcessView.deniedCount ? 'audit-only' : 'complete',
    detail,
  });
  const authorityByPid = new Map(
    processTablePresentation.rows.map((row) => [row.pid, row.authority]),
  );
  const processRows = processes.map((process) => {
    const attention = process.health === 'failed' || process.health === 'degraded';
    const authority = authorityByPid.get(process.pid) || null;
    return {
      capturedAt: generatedAt,
      cursor: syncMetadata.cursor,
      pid: process.pid,
      command: process.command,
      commandHash: `${process.command.length}:${process.command.charCodeAt(0) || 0}`,
      owner: process.owner,
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      authorityState: authority?.state || 'unknown',
      authorityBoundaryMode: authority?.boundaryMode || 'unknown',
      authorityGuard: authority?.operatorActionGuard || 'unknown',
      authorityDelegated: Boolean(authority?.delegated),
      authorityProofRef: authority?.proofRef || null,
      state: process.state,
      health: process.health,
      attention,
      uptimeMs: process.uptimeMs,
      restartCount: process.restartCount,
      retryable: process.retry.retryable,
      attemptsRemaining: process.retry.attemptsRemaining,
      nextRetryDelayMs: process.retry.nextRetryDelayMs,
      lastErrorPresent: Boolean(process.lastError),
      dependencyStatus: process.dependencyHealth.status,
      dependencyFailureCount: process.dependencyHealth.requiredFailureCount
        + process.dependencyHealth.optionalFailureCount,
      dependencyFailures: process.dependencyHealth.failedNames,
    };
  });
  const counters = processRows.reduce((summary, row) => {
    increment(summary.byHealth, row.health);
    increment(summary.byState, row.state);
    increment(summary.byOwner, row.owner);
    increment(summary.byTenantWorkspace, `${row.tenantId}/${row.workspaceId}`);
    increment(summary.byAuthorityState, row.authorityState);
    increment(summary.byAuthorityBoundaryMode, row.authorityBoundaryMode);
    if (row.authorityDelegated) {
      summary.delegatedAuthorityProcessCount += 1;
    }
    if (row.attention) {
      summary.attentionProcessCount += 1;
    }
    if (row.lastErrorPresent) {
      summary.errorProcessCount += 1;
    }
    if (row.retryable) {
      summary.retryableProcessCount += 1;
    }
    if (row.dependencyStatus === 'blocked') {
      summary.dependencyBlockedProcessCount += 1;
    }
    if (row.dependencyStatus === 'degraded') {
      summary.dependencyDegradedProcessCount += 1;
    }
    summary.dependencyFailureCount += row.dependencyFailureCount;
    summary.retryAttemptsRemaining += row.attemptsRemaining;
    summary.restartCount += row.restartCount;
    return summary;
  }, {
    processCount: processRows.length,
    attentionProcessCount: 0,
    errorProcessCount: 0,
    retryableProcessCount: 0,
    dependencyBlockedProcessCount: 0,
    dependencyDegradedProcessCount: 0,
    dependencyFailureCount: 0,
    retryAttemptsRemaining: 0,
    restartCount: 0,
    byHealth: {},
    byState: {},
    byOwner: {},
    byTenantWorkspace: {},
    byAuthorityState: {},
    byAuthorityBoundaryMode: {},
    delegatedAuthorityProcessCount: 0,
  });
  const attentionRows = processRows
    .filter((row) => row.attention || row.lastErrorPresent)
    .sort((left, right) => {
      const healthWeight = { failed: 3, degraded: 2, unknown: 1, healthy: 0 };
      return (healthWeight[right.health] || 0) - (healthWeight[left.health] || 0)
        || right.restartCount - left.restartCount
        || right.attemptsRemaining - left.attemptsRemaining;
    })
    .slice(0, 10);
  const historyRows = timelineReport.events.map((event) => ({
    capturedAt: event.capturedAt,
    cursor: syncMetadata.cursor,
    sequence: syncMetadata.sequence,
    mode: event.mode,
    eventType: event.eventType,
    total: event.total,
    healthy: event.healthy,
    degraded: event.degraded,
    failed: event.failed,
    attentionCount: event.attentionCount,
    attentionDelta: event.attentionDelta,
    restartDelta: event.restartDelta,
    tenantId: scopedProcessView.tenantId,
    workspaceId: scopedProcessView.workspaceId,
  }));
  const incidentRows = operationalHealthTriage.incidents.map((incident) => ({
    capturedAt: generatedAt,
    cursor: syncMetadata.cursor,
    id: incident.id,
    severity: incident.severity,
    category: incident.category,
    code: incident.code,
    target: incident.target,
    blocksDispatch: incident.blocksDispatch,
    retryEligible: incident.retryEligible,
    notBefore: incident.notBefore || null,
    proof: incident.proof,
  }));
  const exportReady = !syncMetadata.stale
    && operationalHealthTriage.exit.code !== 78
    && scopedProcessView.deniedCount === 0;
  const summaryRows = [
    shapeSummaryRow('process.count', counters.processCount, 'processes', {
      byHealth: counters.byHealth,
      byState: counters.byState,
    }),
    shapeSummaryRow('process.attention_count', counters.attentionProcessCount, 'processes', {
      attentionPercent: analyticsTrend.rates.attentionPercent,
      attentionDelta: analyticsTrend.attentionDelta,
      peakAttentionCount: analyticsTrend.peak.attention,
    }),
    shapeSummaryRow('process.restart_count', counters.restartCount, 'recovery', {
      restartPressure: analyticsTrend.rates.restartPressure,
      restartedSincePrevious: analyticsTrend.counters.restartedSincePrevious,
    }),
    shapeSummaryRow('retry.budget_remaining', counters.retryAttemptsRemaining, 'recovery', {
      retryableProcessCount: counters.retryableProcessCount,
      nextRetryNotBefore: operationalHealthTriage.retryWindow.nextNotBefore,
    }),
    shapeSummaryRow('dependency.failure_count', counters.dependencyFailureCount, 'dependencies', {
      blockedProcessCount: counters.dependencyBlockedProcessCount,
      degradedProcessCount: counters.dependencyDegradedProcessCount,
    }),
    shapeSummaryRow('incident.count', operationalHealthTriage.incidentCounts.total, 'incidents', {
      bySeverity: operationalHealthTriage.incidentCounts.bySeverity,
      byCategory: operationalHealthTriage.incidentCounts.byCategory,
      blockingIncidentCount: operationalHealthTriage.incidents
        .filter((incident) => incident.blocksDispatch).length,
    }),
    shapeSummaryRow('scope.visible_count', scopedProcessView.visibleCount, 'scope', {
      deniedCount: scopedProcessView.deniedCount,
      boundary: scopedProcessView.proof.boundary,
      authorityState: processTablePresentation.contracts.authoritySummary.byState,
      delegatedVisibleCount: processTablePresentation.contracts.authoritySummary.delegatedVisibleCount,
      actionGuards: processTablePresentation.contracts.authoritySummary.actionGuards,
    }),
    shapeSummaryRow('timeline.event_count', timelineReport.eventCount, 'timeline', {
      state: timelineReport.state,
      latestEventType: timelineReport.latestEventType,
      sampleCount: timelineReport.exportWindow.sampleCount,
    }),
    shapeSummaryRow('export.ready', exportReady ? 1 : 0, 'export', {
      reason: exportReady
        ? 'fresh-complete-visible-snapshot'
        : syncMetadata.stale
          ? 'provider-sync-stale'
          : scopedProcessView.deniedCount
            ? 'scope-redaction-present'
            : 'validation-or-operational-blocker',
      requestedRowSets: ['summary', 'processes', 'history', 'incidents'],
    }),
  ];

  return {
    schema: 'hosted-kernel.cli-ps.analytics-export-state/v1',
    generatedAt,
    exportReady,
    exportMode: exportReady ? 'complete' : 'audit-only',
    reason: exportReady
      ? 'fresh-complete-visible-snapshot'
      : syncMetadata.stale
        ? 'provider-sync-stale'
        : scopedProcessView.deniedCount
          ? 'scope-redaction-present'
          : 'validation-or-operational-blocker',
    counters: {
      ...counters,
      analyticsRetryBudgetRemaining: analytics.counters.retryBudgetRemaining,
      trendAttentionDelta: analyticsTrend.attentionDelta,
      incidentCount: operationalHealthTriage.incidentCounts.total,
      blockingIncidentCount: operationalHealthTriage.incidents
        .filter((incident) => incident.blocksDispatch).length,
      dependencyBlockedProcessCount: counters.dependencyBlockedProcessCount,
      dependencyDegradedProcessCount: counters.dependencyDegradedProcessCount,
      dependencyFailureCount: counters.dependencyFailureCount,
      delegatedAuthorityProcessCount: counters.delegatedAuthorityProcessCount,
      byAuthorityState: counters.byAuthorityState,
      byAuthorityBoundaryMode: counters.byAuthorityBoundaryMode,
    },
    rows: {
      summaryRows,
      processRows,
      attentionRows,
      historyRows,
      incidentRows,
    },
    manifest: [
      {
        name: 'summary',
        schema: 'hosted-kernel.cli-ps.analytics-export.summary-row/v1',
        format: 'jsonl',
        rowCount: summaryRows.length,
        source: 'analytics-export-state',
      },
      {
        name: 'processes',
        schema: 'hosted-kernel.cli-ps.analytics-export.process-row/v1',
        format: 'jsonl',
        rowCount: processRows.length,
        redaction: scopedProcessView.deniedCount ? 'scope-redacted' : 'none',
      },
      {
        name: 'history',
        schema: 'hosted-kernel.cli-ps.analytics-export.history-row/v1',
        format: 'jsonl',
        rowCount: historyRows.length,
        window: timelineReport.exportWindow,
      },
      {
        name: 'incidents',
        schema: 'hosted-kernel.cli-ps.analytics-export.incident-row/v1',
        format: 'jsonl',
        rowCount: incidentRows.length,
        source: operationalHealthTriage.schema,
      },
    ],
    proof: {
      cursor: syncMetadata.cursor,
      sequence: syncMetadata.sequence,
      timelineSchema: timelineReport.schema,
      operationalHealthSchema: operationalHealthTriage.schema,
      scopeBoundary: scopedProcessView.proof.boundary,
      authoritySummaryChecksum: lightweightChecksum(processTablePresentation.contracts.authoritySummary),
      sampleCount: analyticsTrend.sampleCount,
    },
  };
}

function normalizeAnalyticsExportRequest(input = {}) {
  const source = input.analyticsExport && typeof input.analyticsExport === 'object'
    ? input.analyticsExport
    : input.export && typeof input.export === 'object'
      ? input.export
      : {};
  const requestedArtifacts = normalizeCapabilityList(
    source.artifacts ?? source.datasets ?? source.tables,
  );
  const requestedChannels = normalizeCapabilityList(
    source.channels ?? source.destinations ?? source.sinks,
  );
  const artifactNames = requestedArtifacts.length
    ? requestedArtifacts
    : ['summary', 'processes', 'history', 'incidents'];
  const channelNames = requestedChannels.length ? requestedChannels : ['console'];
  const unsupportedArtifacts = artifactNames
    .filter((artifact) => !SUPPORTED_ANALYTICS_EXPORT_ARTIFACTS.has(artifact));
  const unsupportedChannels = channelNames
    .filter((channel) => !SUPPORTED_ANALYTICS_EXPORT_CHANNELS.has(channel));
  const format = cleanString(source.format ?? source.defaultFormat, 'jsonl').toLowerCase();
  const supportedFormat = format === 'jsonl' || format === 'csv';
  const errors = [
    ...unsupportedArtifacts.map((artifact) => ({
      code: 'CLI_PS_ANALYTICS_EXPORT_ARTIFACT_UNSUPPORTED',
      path: 'analyticsExport.artifacts',
      message: `Analytics export artifact ${artifact} is not supported by cli-ps.`,
      action: `Use one of: ${[...SUPPORTED_ANALYTICS_EXPORT_ARTIFACTS].join(', ')}.`,
    })),
    ...unsupportedChannels.map((channel) => ({
      code: 'CLI_PS_ANALYTICS_EXPORT_CHANNEL_UNSUPPORTED',
      path: 'analyticsExport.channels',
      message: `Analytics export channel ${channel} is not supported by cli-ps.`,
      action: `Use one of: ${[...SUPPORTED_ANALYTICS_EXPORT_CHANNELS].join(', ')}.`,
    })),
    ...(supportedFormat
      ? []
      : [{
          code: 'CLI_PS_ANALYTICS_EXPORT_FORMAT_UNSUPPORTED',
          path: 'analyticsExport.format',
          message: 'Analytics export format must be jsonl or csv.',
          action: 'Set analyticsExport.format to jsonl for row artifacts or csv for summary rows.',
        }]),
  ];

  return {
    schema: 'hosted-kernel.cli-ps.analytics-export-request/v1',
    requestedArtifacts: artifactNames,
    requestedChannels: channelNames,
    format: supportedFormat ? format : 'jsonl',
    includeRows: source.includeRows === true,
    retentionSnapshots: clampInteger(
      source.retentionSnapshots ?? source.historyLimit,
      HISTORY_LIMIT,
      1,
      HISTORY_LIMIT,
    ),
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}

function buildAnalyticsExportReport({
  generatedAt,
  analyticsExportRequest,
  analyticsExportState,
  history,
  timelineReport,
  operationalHealthTriage,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
}) {
  const rowSets = {
    summary: analyticsExportState.rows.summaryRows,
    processes: analyticsExportState.rows.processRows,
    history: analyticsExportState.rows.historyRows,
    incidents: analyticsExportState.rows.incidentRows,
  };
  const requestedArtifactSet = new Set(analyticsExportRequest.requestedArtifacts);
  const channelSet = new Set(analyticsExportRequest.requestedChannels);
  const artifactReports = analyticsExportState.manifest.map((artifact) => {
    const rows = rowSets[artifact.name] || [];
    const selected = requestedArtifactSet.has(artifact.name);
    const redacted = artifact.redaction === 'scope-redacted';
    return {
      name: artifact.name,
      schema: artifact.schema,
      format: artifact.format,
      rowCount: artifact.rowCount,
      selected,
      checksum: lightweightChecksum(rows),
      blockedReason: !analyticsExportRequest.validation.ok
        ? 'export-request-invalid'
        : redacted && artifact.name === 'processes'
          ? 'scope-redaction-present'
          : null,
    };
  });
  const selectedArtifacts = artifactReports.filter((artifact) => artifact.selected);
  const blockedArtifacts = selectedArtifacts.filter((artifact) => artifact.blockedReason);
  const retentionSnapshots = history.snapshots
    .slice(-analyticsExportRequest.retentionSnapshots)
    .map((snapshot, index) => ({
      index,
      capturedAt: snapshot.capturedAt,
      mode: snapshot.mode,
      total: snapshot.total,
      attentionCount: snapshot.degraded + snapshot.failed,
      restarts: snapshot.restarts,
      checksum: lightweightChecksum(snapshot),
    }));
  const deliveryChannels = analyticsExportRequest.requestedChannels.map((channel) => ({
    channel,
    enabled: analyticsExportRequest.validation.ok
      && (channel !== 'supervisor-handoff'
        || operationalHealthTriage.degradedMode.active
        || operationalHealthTriage.status === 'blocked'),
    mode: channelSet.has('file') && channel === 'file'
      ? analyticsExportRequest.format
      : channel === 'audit-log'
        ? 'append-proof'
        : channel === 'supervisor-handoff'
          ? 'handoff-payload'
          : 'operator-visible',
    reason: channel === 'supervisor-handoff'
      && !operationalHealthTriage.degradedMode.active
      && operationalHealthTriage.status !== 'blocked'
      ? 'handoff-channel-only-used-for-degraded-or-blocked-state'
      : analyticsExportRequest.validation.ok
        ? 'channel-accepted'
        : 'export-request-invalid',
  }));
  const reportReady = analyticsExportState.exportReady
    && analyticsExportRequest.validation.ok
    && blockedArtifacts.length === 0;

  return {
    schema: 'hosted-kernel.cli-ps.analytics-export-report/v1',
    generatedAt,
    request: analyticsExportRequest,
    ready: reportReady,
    mode: reportReady ? 'delivery-ready' : analyticsExportState.exportMode,
    blockedReasons: [
      analyticsExportState.exportReady ? null : analyticsExportState.reason,
      analyticsExportRequest.validation.ok ? null : 'export-request-invalid',
      ...blockedArtifacts.map((artifact) => `${artifact.name}:${artifact.blockedReason}`),
    ].filter(Boolean),
    selectedArtifactCount: selectedArtifacts.length,
    artifactReports,
    deliveryChannels,
    retention: {
      limit: analyticsExportRequest.retentionSnapshots,
      retainedCount: retentionSnapshots.length,
      snapshots: retentionSnapshots,
      timelineWindow: timelineReport.exportWindow,
    },
    proof: {
      rowSetChecksums: artifactReports.reduce((summary, artifact) => {
        summary[artifact.name] = artifact.checksum;
        return summary;
      }, {}),
      exportStateSchema: analyticsExportState.schema,
      timelineSchema: timelineReport.schema,
      operationalHealthSchema: operationalHealthTriage.schema,
      dispatchReadinessSchema: dispatchReadinessGate.schema,
      hostedDispatchSchema: hostedKernelDispatchEnvelope.schema,
    },
  };
}

function buildRecoveryPlan(processes, persistenceProjection, retryPolicy, generatedAt, lifecycleSettings) {
  const autoRetryEnabled = lifecycleSettings.controls['auto-retry'];
  const autoRetryPaused = lifecycleSettings.schedule.autoRetryPaused;
  const replaySafeKeys = new Set(persistenceProjection.replaySafeCommandKeys);
  const quietUntilMs = lifecycleSettings.schedule.quietUntil
    ? Date.parse(lifecycleSettings.schedule.quietUntil)
    : NaN;
  const generatedMs = Date.parse(generatedAt);
  const quietMode = !Number.isNaN(quietUntilMs)
    && !Number.isNaN(generatedMs)
    && quietUntilMs > generatedMs;
  let scheduledRetryCount = 0;
  const shapeRecoveryAction = (action) => {
    const replayAlreadyRecorded = replaySafeKeys.has(action.idempotencyKey);
    return {
      ...action,
      replayState: replayAlreadyRecorded ? 'already-recorded' : 'new-intent',
      dispatchSuppressed: replayAlreadyRecorded,
      restartSafeCommand: !replayAlreadyRecorded && persistenceProjection.restartSafe,
      journalEffect: replayAlreadyRecorded
        ? 'reuse-persisted-command-record'
        : 'append-before-dispatch',
    };
  };
  const orphanedRecoveries = persistenceProjection.orphaned.map((process) => shapeRecoveryAction({
    action: 'mark-orphaned-after-restart',
    pid: process.pid,
    command: process.command,
    reason: 'Persisted process was not present in the current hosted-kernel table.',
    idempotencyKey: `cli-ps:orphan:${persistenceProjection.generation}:${process.pid}`,
  }));
  const processRecoveries = processes
    .filter((process) => process.health === 'failed' || process.health === 'degraded')
    .map((process) => {
      const retryAllowed = process.retry.retryable && process.retry.attemptsRemaining > 0;
      const concurrencyAvailable = scheduledRetryCount < lifecycleSettings.schedule.maxConcurrentActions;
      const dispatchRetry = retryAllowed
        && autoRetryEnabled
        && !quietMode
        && !autoRetryPaused
        && concurrencyAvailable;
      if (dispatchRetry) {
        scheduledRetryCount += 1;
      }
      return shapeRecoveryAction({
        action: dispatchRetry ? 'schedule-retry' : 'hold-for-operator',
        pid: process.pid,
        command: process.command,
        health: process.health,
        state: process.state,
        attempt: process.restartCount + 1,
        maxAttempts: retryPolicy.maxAttempts,
        notBefore: dispatchRetry
          ? new Date(generatedMs + process.retry.nextRetryDelayMs).toISOString()
          : null,
        reason: retryAllowed
          ? autoRetryEnabled
            ? quietMode
              ? 'auto-retry-paused-by-lifecycle-schedule'
              : autoRetryPaused
                ? 'auto-retry-paused-by-maintenance-window'
                : concurrencyAvailable
                  ? 'retry-budget-available'
                  : 'max-concurrent-lifecycle-actions-reached'
            : 'auto-retry-disabled-by-lifecycle-settings'
          : 'retry-budget-exhausted-or-process-not-retryable',
        idempotencyKey: `cli-ps:recover:${persistenceProjection.generation}:${process.pid}:${process.restartCount}`,
      });
    });
  const suppressedCount = [...orphanedRecoveries, ...processRecoveries]
    .filter((action) => action.dispatchSuppressed).length;

  return {
    schema: 'hosted-kernel.cli-ps.recovery-plan/v1',
    generatedAt,
    restartSafe: persistenceProjection.restartSafe,
    actions: [...orphanedRecoveries, ...processRecoveries],
    pendingCount: orphanedRecoveries.length + processRecoveries.length,
    dispatchablePendingCount: orphanedRecoveries.length + processRecoveries.length - suppressedCount,
    suppressedReplayCount: suppressedCount,
    commandJournal: {
      retainedCommandCount: persistenceProjection.journalWatermark.retainedCommandCount,
      replaySafeCommandCount: persistenceProjection.replaySafeCommandKeys.length,
      latestRecordedAt: persistenceProjection.journalWatermark.latestRecordedAt,
      appendRequiredCount: orphanedRecoveries.length + processRecoveries.length - suppressedCount,
    },
    policy: {
      maxAttempts: retryPolicy.maxAttempts,
      baseDelayMs: retryPolicy.baseDelayMs,
      maxDelayMs: retryPolicy.maxDelayMs,
      autoRetryEnabled,
      quietUntil: lifecycleSettings.schedule.quietUntil,
      autoRetryPaused,
      pausedControls: lifecycleSettings.schedule.pausedControls,
      activeMaintenanceWindowCount: lifecycleSettings.schedule.activeWindowCount,
      maxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
      scheduledRetryCount,
    },
  };
}

function buildRestartStatus(health, syncMetadata, persistenceProjection, recoveryPlan, restartReconciliation) {
  const effectivePendingCount = recoveryPlan.dispatchablePendingCount ?? recoveryPlan.pendingCount;
  const requiresRecovery = effectivePendingCount > 0 || persistenceProjection.orphaned.length > 0;
  const persistenceRepairRequired = !persistenceProjection.stateIntegrity.ok;
  const status = syncMetadata.stale
    ? 'sync-stale'
    : restartReconciliation.counts.replayBlocked
      ? 'replay-blocked'
    : persistenceRepairRequired
      ? 'persistence-repair-required'
      : requiresRecovery
      ? 'recovery-pending'
      : health.failureState
        ? 'failed'
        : health.degradedMode
          ? 'degraded'
          : 'ready';

  return {
    schema: 'hosted-kernel.cli-ps.restart-status/v1',
    status,
    restartSafe: persistenceProjection.restartSafe && !syncMetadata.stale,
    persistedGeneration: persistenceProjection.generation,
    snapshotId: persistenceProjection.snapshotId,
    processCount: persistenceProjection.records.length,
    orphanedCount: persistenceProjection.orphaned.length,
    reconciliationState: restartReconciliation.state,
    reconciliationCounts: restartReconciliation.counts,
    reconciliationNextOperatorAction: restartReconciliation.nextOperatorAction,
    persistenceIntegrity: {
      ok: persistenceProjection.stateIntegrity.ok,
      writeBarrier: persistenceProjection.stateIntegrity.writeBarrier,
      blockingReasonCount: persistenceProjection.stateIntegrity.blockingReasonCount,
      conflictingCommandKeyCount: persistenceProjection.stateIntegrity.commandJournal.conflictingKeyCount,
      unsafeCommandEntryCount: persistenceProjection.stateIntegrity.commandJournal.unsafeEntryCount,
      staleJournalTargetCount: persistenceProjection.stateIntegrity.staleJournalTargetCount,
      blockingCodes: persistenceProjection.stateIntegrity.blockingReasons.map((reason) => reason.code),
    },
    pendingRecoveryCount: recoveryPlan.pendingCount,
    effectivePendingRecoveryCount: effectivePendingCount,
    suppressedReplayCount: recoveryPlan.suppressedReplayCount,
    commandJournalRetainedCount: recoveryPlan.commandJournal.retainedCommandCount,
    restartDecision: persistenceRepairRequired
      ? 'repair-persisted-state-before-replay'
      : restartReconciliation.counts.replayBlocked
        ? 'repair-restart-reconciliation-before-replay'
      : recoveryPlan.suppressedReplayCount
      ? 'resume-from-command-journal'
      : requiresRecovery
        ? 'recover-from-current-snapshot'
        : 'ready-from-current-snapshot',
    replaySuppressionActive: recoveryPlan.suppressedReplayCount > 0,
    commandReplaySafe: !syncMetadata.stale
      && persistenceProjection.stateIntegrity.replaySafe
      && restartReconciliation.counts.replayBlocked === 0,
  };
}

function buildIdempotentCommandEnvelope(
  processes,
  recoveryPlan,
  restartStatus,
  syncMetadata,
  restartReconciliation,
) {
  const commands = recoveryPlan.actions.map((action) => ({
    key: action.idempotencyKey,
    type: action.action,
    pid: action.pid,
    command: action.command,
    replayPolicy: action.dispatchSuppressed
      ? 'suppress-duplicate'
      : restartStatus.commandReplaySafe
        ? 'at-most-once'
        : 'blocked-until-fresh-sync',
    precondition: action.dispatchSuppressed
      ? 'command-journal-already-recorded'
      : syncMetadata.stale ? 'provider-sync-fresh' : 'pid-current-or-orphaned',
    dispatchEligible: !action.dispatchSuppressed && restartStatus.commandReplaySafe,
    replayState: action.replayState,
    journalEffect: action.journalEffect,
  }));
  const dispatchEligible = commands.filter((command) => command.dispatchEligible);
  const suppressed = commands.filter((command) => command.replayPolicy === 'suppress-duplicate');

  return {
    schema: 'hosted-kernel.cli-ps.idempotent-commands/v1',
    replayWindowCursor: syncMetadata.cursor,
    commandCount: commands.length,
    dispatchEligibleCount: dispatchEligible.length,
    suppressedReplayCount: suppressed.length,
    commands,
    statusCommand: {
      key: `cli-ps:status:${syncMetadata.cursor}`,
      type: 'read-status',
      replayPolicy: 'safe-repeat',
      processPids: processes.map((process) => process.pid),
    },
    proof: {
      restartDecision: restartStatus.restartDecision,
      restartReconciliationState: restartReconciliation.state,
      restartReconciliationChecksum: restartReconciliation.proof.rowChecksum,
      replaySafe: restartStatus.commandReplaySafe,
      suppressedKeys: suppressed.map((command) => command.key),
      dispatchEligibleKeys: dispatchEligible.map((command) => command.key),
    },
  };
}

function normalizeLifecycleControlName(value) {
  const key = cleanString(value, '').toLowerCase().replace(/[\s_]+/g, '-');
  return LIFECYCLE_CONTROL_ALIASES[key] || key;
}

function normalizeLifecycleWindow(window, index, generatedAt) {
  if (!window || typeof window !== 'object') {
    return {
      index,
      valid: false,
      code: 'CLI_PS_LIFECYCLE_WINDOW_INVALID',
      message: 'Lifecycle maintenance windows must be objects.',
    };
  }

  const startsAt = cleanString(window.startsAt ?? window.startAt ?? window.from, '');
  const endsAt = cleanString(window.endsAt ?? window.endAt ?? window.until, '');
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  const generatedMs = Date.parse(generatedAt);
  const controls = normalizeCapabilityList(window.controls ?? window.pauseControls ?? ['auto-retry'])
    .map((control) => normalizeLifecycleControlName(control));
  const validControls = controls
    .filter((control) => control === '*' || Object.values(LIFECYCLE_CONTROL_ALIASES).includes(control));
  const validTimestamp = startsAt
    && endsAt
    && !Number.isNaN(startMs)
    && !Number.isNaN(endMs)
    && endMs > startMs;
  const active = validTimestamp
    && !Number.isNaN(generatedMs)
    && startMs <= generatedMs
    && generatedMs < endMs;

  return {
    schema: 'hosted-kernel.cli-ps.lifecycle-maintenance-window/v1',
    index,
    valid: Boolean(validTimestamp && validControls.length === controls.length),
    startsAt,
    endsAt,
    active,
    controls: validControls.length ? [...new Set(validControls)].sort() : ['auto-retry'],
    reason: cleanString(window.reason, 'operator-maintenance-window'),
    code: !validTimestamp
      ? 'CLI_PS_LIFECYCLE_WINDOW_INVALID_RANGE'
      : validControls.length !== controls.length
        ? 'CLI_PS_LIFECYCLE_WINDOW_UNSUPPORTED_CONTROL'
        : null,
  };
}

function normalizeLifecycleSettings(input = {}, retryPolicy, generatedAt) {
  const settings = input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
    ? input.lifecycleSettings
    : input.settings?.lifecycle && typeof input.settings.lifecycle === 'object'
      ? input.settings.lifecycle
      : {};
  const rawControls = settings.controls && typeof settings.controls === 'object' ? settings.controls : {};
  const schedule = settings.schedule && typeof settings.schedule === 'object' ? settings.schedule : {};
  const requestedMaxConcurrentActions = Math.max(
    1,
    Math.floor(normalizeNumber(settings.maxConcurrentActions ?? schedule.maxConcurrentActions, 1)),
  );
  const maxConcurrentActions = Math.min(25, requestedMaxConcurrentActions);
  const quietUntil = cleanString(settings.quietUntil ?? schedule.quietUntil, '');
  const maintenanceWindows = asArray(settings.maintenanceWindows ?? schedule.maintenanceWindows)
    .map((window, index) => normalizeLifecycleWindow(window, index, generatedAt));
  const activeWindows = maintenanceWindows.filter((window) => window.valid && window.active);
  const pausedControls = [...new Set(activeWindows.flatMap((window) => window.controls))]
    .sort();
  const windowErrors = maintenanceWindows
    .filter((window) => !window.valid)
    .map((window) => ({
      code: window.code,
      path: `lifecycleSettings.schedule.maintenanceWindows[${window.index}]`,
      message: window.message || 'Lifecycle maintenance window is invalid.',
      action: 'Provide startsAt and endsAt ISO timestamps with supported lifecycle controls.',
    }));
  const errors = [];

  if (quietUntil && Number.isNaN(Date.parse(quietUntil))) {
    errors.push({
      code: 'CLI_PS_LIFECYCLE_QUIET_UNTIL_INVALID',
      path: 'lifecycleSettings.quietUntil',
      message: 'Lifecycle quietUntil must be an ISO timestamp when provided.',
      action: 'Send a parseable ISO timestamp or omit quietUntil.',
    });
  }
  if (requestedMaxConcurrentActions > 25) {
    errors.push({
      code: 'CLI_PS_LIFECYCLE_MAX_CONCURRENT_ACTIONS_TOO_HIGH',
      path: 'lifecycleSettings.schedule.maxConcurrentActions',
      message: 'Lifecycle maxConcurrentActions cannot exceed the hosted-kernel dispatch guardrail.',
      action: 'Set maxConcurrentActions to 25 or lower for cli-ps lifecycle dispatch.',
    });
  }

  return {
    schema: 'hosted-kernel.cli-ps.lifecycle-settings/v1',
    controls: {
      'auto-retry': rawControls.autoRetry !== false && rawControls['auto-retry'] !== false,
      'auto-restart': rawControls.autoRestart !== false && rawControls['auto-restart'] !== false,
      'operator-actions': rawControls.operatorActions !== false && rawControls['operator-actions'] !== false,
      'external-handoff': rawControls.externalHandoff !== false && rawControls['external-handoff'] !== false,
      'streaming-sync': rawControls.streamingSync === true || rawControls['streaming-sync'] === true,
    },
    schedule: {
      maxConcurrentActions,
      requestedMaxConcurrentActions,
      quietUntil: quietUntil || null,
      maintenanceWindows,
      activeWindowCount: activeWindows.length,
      pausedControls,
      autoRetryPaused: pausedControls.includes('*') || pausedControls.includes('auto-retry'),
      retryBaseDelayMs: retryPolicy.baseDelayMs,
      retryMaxDelayMs: retryPolicy.maxDelayMs,
      retryMaxAttempts: retryPolicy.maxAttempts,
    },
    validation: {
      ok: errors.length + windowErrors.length === 0,
      errors: [...errors, ...windowErrors],
    },
  };
}

function normalizeLifecycleControlIntent(intent, index) {
  if (!intent || typeof intent !== 'object') {
    return {
      index,
      valid: false,
      code: 'CLI_PS_LIFECYCLE_CONTROL_INVALID',
      message: 'Lifecycle control intent must be an object.',
    };
  }

  const action = cleanString(intent.action ?? intent.type, '').toLowerCase();
  const control = normalizeLifecycleControlName(intent.control ?? intent.setting ?? intent.name);
  const pid = cleanString(intent.pid ?? intent.processId, '');
  const notBefore = cleanString(intent.notBefore ?? intent.scheduleAt ?? intent.at, '');
  const requestedBy = cleanString(intent.requestedBy ?? intent.operatorId, 'operator-unknown');
  const requiresFreshSync = intent.requiresFreshSync !== false;
  const validTimestamp = !notBefore || !Number.isNaN(Date.parse(notBefore));
  const scheduleHasTimestamp = action !== 'schedule' || Boolean(notBefore);
  const supportedControl = Object.values(LIFECYCLE_CONTROL_ALIASES).includes(control);

  return {
    schema: 'hosted-kernel.cli-ps.lifecycle-control-intent/v1',
    index,
    valid: Boolean(
      action
        && control
        && SUPPORTED_LIFECYCLE_CONTROL_ACTIONS.has(action)
        && supportedControl
        && validTimestamp
        && scheduleHasTimestamp,
    ),
    action,
    control,
    pid,
    notBefore: notBefore || null,
    reason: cleanString(intent.reason, 'operator-lifecycle-control'),
    requestedBy,
    requiresFreshSync,
    clientRequestId: cleanString(intent.clientRequestId ?? intent.requestId, `lifecycle-${index + 1}`),
    code: !action
      ? 'CLI_PS_LIFECYCLE_CONTROL_MISSING_ACTION'
      : !SUPPORTED_LIFECYCLE_CONTROL_ACTIONS.has(action)
        ? 'CLI_PS_LIFECYCLE_CONTROL_UNSUPPORTED_ACTION'
        : !control || !supportedControl
          ? 'CLI_PS_LIFECYCLE_CONTROL_UNSUPPORTED_CONTROL'
          : !validTimestamp
            ? 'CLI_PS_LIFECYCLE_CONTROL_INVALID_SCHEDULE'
            : !scheduleHasTimestamp
              ? 'CLI_PS_LIFECYCLE_CONTROL_SCHEDULE_REQUIRES_NOT_BEFORE'
              : null,
  };
}

function buildLifecycleControlContracts(
  input,
  lifecycleSettings,
  processes,
  scopedProcessView,
  syncMetadata,
  capabilityNegotiation,
  restartStatus,
) {
  const requested = asArray(input.lifecycleControls ?? input.settingsControls)
    .map((intent, index) => normalizeLifecycleControlIntent(intent, index));
  const visibleByPid = new Map(processes.map((process) => [process.pid, process]));
  const deniedByPid = new Map(scopedProcessView.denied.map((process) => [process.pid, process]));
  const acceptedCapabilities = new Set([
    ...capabilityNegotiation.acceptedRequired,
    ...capabilityNegotiation.acceptedOptional,
  ]);
  const contracts = requested.map((intent) => {
    const requiredCapability = LIFECYCLE_CONTROL_CAPABILITIES[intent.control] || null;
    const capabilityBlocked = requiredCapability && !acceptedCapabilities.has(requiredCapability);
    const syncBlocked = intent.requiresFreshSync && syncMetadata.stale;
    const targetProcess = intent.pid ? visibleByPid.get(intent.pid) : null;
    const denied = intent.pid ? deniedByPid.get(intent.pid) : null;
    const boundaryDecision = intent.pid
      ? buildTargetBoundaryDecision(intent, targetProcess, denied, scopedProcessView)
      : buildTargetBoundaryDecision(intent, null, null, scopedProcessView, { requiresTarget: false });
    const accepted = Boolean(
      intent.valid
        && !capabilityBlocked
        && !syncBlocked
        && !boundaryDecision.blocksDispatch,
    );

    return {
      ...intent,
      accepted,
      status: accepted ? 'queued' : 'blocked',
      currentEnabled: lifecycleSettings.controls[intent.control] ?? null,
      resultingEnabled: accepted && intent.action !== 'schedule'
        ? intent.action === 'enable'
        : lifecycleSettings.controls[intent.control] ?? null,
      requiredCapability,
      reasonBlocked: accepted
        ? null
        : intent.code || (capabilityBlocked
          ? 'provider-capability-missing'
          : syncBlocked
            ? 'provider-sync-stale'
            : boundaryDecision.blocksDispatch
              ? boundaryDecision.reason
              : 'lifecycle-control-precondition-failed'),
      boundaryDecision,
      commandKey: `cli-ps:lifecycle:${syncMetadata.cursor}:${intent.control}:${intent.action}:${intent.clientRequestId}`,
      replayPolicy: restartStatus.commandReplaySafe ? 'at-most-once' : 'blocked-until-fresh-sync',
      target: targetProcess
        ? {
            pid: targetProcess.pid,
            command: targetProcess.command,
            state: targetProcess.state,
            health: targetProcess.health,
          }
        : null,
    };
  });
  const accepted = contracts.filter((contract) => contract.accepted);

  return {
    schema: 'hosted-kernel.cli-ps.lifecycle-control-contracts/v1',
    settings: lifecycleSettings,
    requestedCount: requested.length,
    acceptedCount: accepted.length,
    blockedCount: contracts.length - accepted.length,
    contracts,
    dispatch: {
      ready: accepted.length > 0 && !syncMetadata.stale && lifecycleSettings.validation.ok,
      cursor: syncMetadata.cursor,
      acceptedCommandKeys: accepted.map((contract) => contract.commandKey),
      maxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
    },
    nextAction: !lifecycleSettings.validation.ok
      ? 'Fix lifecycle settings before dispatching lifecycle control commands.'
      : syncMetadata.stale
        ? 'Refresh the hosted-kernel process table before applying lifecycle controls.'
        : lifecycleSettings.schedule.pausedControls.length
          ? 'Lifecycle schedule has active paused controls; review maintenance windows before dispatch.'
          : accepted.length
            ? 'Dispatch accepted lifecycle control commands with idempotent command keys.'
            : 'No lifecycle control dispatch is pending.',
    proof: {
      source: 'lifecycle-settings-and-controls-input',
      scopeBoundary: scopedProcessView.proof.boundary,
      boundaryDecisionChecksum: lightweightChecksum(contracts.map((contract) => ({
        commandKey: contract.commandKey,
        pid: contract.pid || null,
        allowed: contract.boundaryDecision.allowed,
        reason: contract.boundaryDecision.reason,
        proofRef: contract.boundaryDecision.proofRef,
      }))),
      syncConsistency: syncMetadata.consistency,
      providerNegotiation: capabilityNegotiation.status,
    },
  };
}

function buildLifecycleNextActionState(
  generatedAt,
  lifecycleSettings,
  lifecycleControlContracts,
  recoveryPlan,
  restartStatus,
  syncMetadata,
) {
  const effectiveControls = { ...lifecycleSettings.controls };
  const immediateChanges = lifecycleControlContracts.contracts
    .filter((contract) => contract.accepted && contract.action !== 'schedule')
    .map((contract) => {
      const previousEnabled = effectiveControls[contract.control] ?? null;
      const nextEnabled = contract.action === 'enable';
      if (previousEnabled !== null) {
        effectiveControls[contract.control] = nextEnabled;
      }
      return {
        commandKey: contract.commandKey,
        control: contract.control,
        action: contract.action,
        pid: contract.pid || null,
        previousEnabled,
        nextEnabled,
        noOp: previousEnabled === nextEnabled,
        requestedBy: contract.requestedBy,
        reason: contract.reason,
      };
    });
  const scheduledChanges = lifecycleControlContracts.contracts
    .filter((contract) => contract.accepted && contract.action === 'schedule')
    .map((contract) => ({
      commandKey: contract.commandKey,
      control: contract.control,
      pid: contract.pid || null,
      notBefore: contract.notBefore,
      requestedBy: contract.requestedBy,
      reason: contract.reason,
      scheduleState: Date.parse(contract.notBefore) > Date.parse(generatedAt)
        ? 'future'
        : 'due',
    }))
    .sort((left, right) => String(left.notBefore).localeCompare(String(right.notBefore)));
  const blockedChanges = lifecycleControlContracts.contracts
    .filter((contract) => !contract.accepted)
    .map((contract) => ({
      control: contract.control || 'unknown',
      action: contract.action || 'unknown',
      pid: contract.pid || null,
      clientRequestId: contract.clientRequestId || null,
      reason: contract.reasonBlocked,
      code: contract.code || 'CLI_PS_LIFECYCLE_CONTROL_BLOCKED',
      retryable: contract.reasonBlocked === 'provider-sync-stale',
      retryAfter: contract.reasonBlocked === 'provider-sync-stale' ? generatedAt : null,
    }));
  const validationIssues = lifecycleSettings.validation.errors.map((error) => ({
    control: 'settings',
    action: 'validate',
    pid: null,
    clientRequestId: null,
    reason: error.code,
    code: error.code,
    retryable: false,
    retryAfter: null,
  }));
  const quietUntilMs = lifecycleSettings.schedule.quietUntil
    ? Date.parse(lifecycleSettings.schedule.quietUntil)
    : NaN;
  const generatedMs = Date.parse(generatedAt);
  const quietActive = !Number.isNaN(quietUntilMs)
    && !Number.isNaN(generatedMs)
    && quietUntilMs > generatedMs;
  const immediateDispatchable = immediateChanges
    .filter((change) => !change.noOp)
    .filter((change) => !lifecycleSettings.schedule.pausedControls.includes('*')
      && !lifecycleSettings.schedule.pausedControls.includes(change.control));
  const pausedImmediateControls = immediateChanges
    .filter((change) => lifecycleSettings.schedule.pausedControls.includes('*')
      || lifecycleSettings.schedule.pausedControls.includes(change.control))
    .map((change) => change.control);
  const scheduledDue = scheduledChanges.filter((change) => change.scheduleState === 'due');
  const state = validationIssues.length
    ? 'settings-invalid'
    : syncMetadata.stale
      ? 'sync-refresh-required'
      : blockedChanges.length
        ? 'operator-review-required'
        : immediateDispatchable.length
          ? 'settings-change-ready'
          : scheduledDue.length
            ? 'scheduled-control-due'
            : scheduledChanges.length
              ? 'scheduled-control-pending'
              : pausedImmediateControls.length || quietActive
                ? 'paused-by-lifecycle-schedule'
                : 'settings-stable';
  const nextOperatorAction = validationIssues[0]
    ? {
        action: 'fix-lifecycle-settings',
        target: validationIssues[0].reason,
        label: lifecycleSettings.validation.errors[0]?.action || 'Fix lifecycle settings validation errors.',
      }
    : syncMetadata.stale
      ? {
          action: 'refresh-process-table',
          target: syncMetadata.cursor,
          label: 'Refresh hosted-kernel process state before applying lifecycle setting changes.',
        }
      : blockedChanges[0]
        ? {
            action: blockedChanges[0].retryable ? 'refresh-and-resubmit-control' : 'review-blocked-control',
            target: blockedChanges[0].control,
            label: `Lifecycle ${blockedChanges[0].action} is blocked by ${blockedChanges[0].reason}.`,
          }
        : immediateDispatchable[0]
          ? {
              action: 'apply-lifecycle-setting',
              target: immediateDispatchable[0].control,
              label: `Apply ${immediateDispatchable[0].action} for ${immediateDispatchable[0].control}.`,
            }
          : scheduledDue[0]
            ? {
                action: 'dispatch-due-scheduled-control',
                target: scheduledDue[0].control,
                label: `Dispatch scheduled lifecycle control due at ${scheduledDue[0].notBefore}.`,
              }
            : scheduledChanges[0]
              ? {
                  action: 'wait-for-scheduled-control',
                  target: scheduledChanges[0].control,
                  label: `Wait until ${scheduledChanges[0].notBefore} before applying scheduled lifecycle control.`,
                }
              : {
                  action: 'continue-process-review',
                  target: restartStatus.status,
                  label: 'Lifecycle settings are stable for the current hosted-kernel process view.',
                };

  return {
    schema: 'hosted-kernel.cli-ps.lifecycle-next-action-state/v1',
    generatedAt,
    state,
    effectiveControls,
    requestedControlCount: lifecycleControlContracts.requestedCount,
    acceptedControlCount: lifecycleControlContracts.acceptedCount,
    blockedControlCount: lifecycleControlContracts.blockedCount,
    immediateChangeCount: immediateChanges.length,
    immediateDispatchableCount: immediateDispatchable.length,
    scheduledChangeCount: scheduledChanges.length,
    scheduledDueCount: scheduledDue.length,
    noOpCount: immediateChanges.filter((change) => change.noOp).length,
    quietMode: {
      active: quietActive,
      quietUntil: lifecycleSettings.schedule.quietUntil,
      pausedControls: lifecycleSettings.schedule.pausedControls,
      pausedImmediateControls: [...new Set(pausedImmediateControls)].sort(),
    },
    concurrency: {
      maxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
      scheduledRetryCount: recoveryPlan.policy.scheduledRetryCount,
      remainingSlots: Math.max(
        0,
        lifecycleSettings.schedule.maxConcurrentActions - recoveryPlan.policy.scheduledRetryCount,
      ),
    },
    immediateChanges,
    scheduledChanges,
    blockedChanges: [...validationIssues, ...blockedChanges],
    nextOperatorAction,
    proof: {
      lifecycleSettingsSchema: lifecycleSettings.schema,
      lifecycleControlSchema: lifecycleControlContracts.schema,
      syncCursor: syncMetadata.cursor,
      syncConsistency: syncMetadata.consistency,
      restartStatus: restartStatus.status,
      acceptedCommandKeys: lifecycleControlContracts.dispatch.acceptedCommandKeys,
      effectiveControlsChecksum: lightweightChecksum(effectiveControls),
      requestedContractsChecksum: lightweightChecksum(lifecycleControlContracts.contracts),
    },
  };
}

function normalizeOperatorActionIntent(intent, index) {
  if (!intent || typeof intent !== 'object') {
    return {
      index,
      valid: false,
      code: 'CLI_PS_OPERATOR_ACTION_INVALID',
      message: 'Operator action intent must be an object.',
    };
  }

  const action = cleanString(intent.action ?? intent.type, '').toLowerCase();
  const pid = cleanString(intent.pid ?? intent.processId, '');
  const reason = cleanString(intent.reason ?? intent.message, 'operator-request');
  const requestedBy = cleanString(intent.requestedBy ?? intent.operatorId, 'operator-unknown');
  const dryRun = intent.dryRun !== false;
  const requiresFreshSync = intent.requiresFreshSync !== false;

  return {
    schema: 'hosted-kernel.cli-ps.operator-action-intent/v1',
    index,
    valid: Boolean(action && pid && SUPPORTED_OPERATOR_ACTIONS.has(action)),
    action,
    pid,
    reason,
    requestedBy,
    dryRun,
    requiresFreshSync,
    clientRequestId: cleanString(intent.clientRequestId ?? intent.requestId, `intent-${index + 1}`),
    code: !action
      ? 'CLI_PS_OPERATOR_ACTION_MISSING_ACTION'
      : !SUPPORTED_OPERATOR_ACTIONS.has(action)
        ? 'CLI_PS_OPERATOR_ACTION_UNSUPPORTED'
        : !pid
          ? 'CLI_PS_OPERATOR_ACTION_MISSING_PID'
          : null,
  };
}

function buildOperatorActionContracts(input, processes, scopedProcessView, syncMetadata, restartStatus) {
  const requested = asArray(input.operatorActions ?? input.actions)
    .map((intent, index) => normalizeOperatorActionIntent(intent, index));
  const visibleByPid = new Map(processes.map((process) => [process.pid, process]));
  const deniedByPid = new Map(scopedProcessView.denied.map((process) => [process.pid, process]));
  const contracts = requested.map((intent) => {
    if (!intent.valid) {
      return {
        ...intent,
        accepted: false,
        status: 'rejected',
        reason: intent.code,
        proof: 'schema-validation-failed',
      };
    }

    const process = visibleByPid.get(intent.pid);
    const denied = deniedByPid.get(intent.pid);
    const boundaryDecision = buildTargetBoundaryDecision(intent, process, denied, scopedProcessView);
    const syncBlocked = intent.requiresFreshSync && syncMetadata.stale;
    const accepted = Boolean(process) && !boundaryDecision.blocksDispatch && !syncBlocked;
    const commandKey = `cli-ps:operator:${syncMetadata.cursor}:${intent.action}:${intent.pid}:${intent.clientRequestId}`;

    return {
      ...intent,
      accepted,
      status: accepted ? 'queued' : 'blocked',
      reason: accepted
        ? 'accepted-for-hosted-kernel-dispatch'
        : syncBlocked
          ? 'provider-sync-stale'
          : boundaryDecision.reason,
      commandKey,
      dispatchMode: intent.dryRun ? 'audit-only' : 'hosted-kernel-command',
      replayPolicy: restartStatus.commandReplaySafe ? 'at-most-once' : 'blocked-until-fresh-sync',
      boundaryDecision,
      target: process
        ? {
            pid: process.pid,
            command: process.command,
            state: process.state,
            health: process.health,
          }
        : null,
      proof: accepted
        ? 'visible-process-and-fresh-sync'
        : syncBlocked
          ? 'stale-sync-precondition'
          : boundaryDecision.proofRef,
    };
  });
  const accepted = contracts.filter((contract) => contract.accepted);
  const blocked = contracts.filter((contract) => !contract.accepted);

  return {
    schema: 'hosted-kernel.cli-ps.operator-action-contracts/v1',
    requestedCount: requested.length,
    acceptedCount: accepted.length,
    blockedCount: blocked.length,
    contracts,
    dispatch: {
      ready: accepted.length > 0 && !syncMetadata.stale,
      mode: accepted.some((contract) => !contract.dryRun) ? 'hosted-kernel-command' : 'audit-only',
      cursor: syncMetadata.cursor,
      restartSafe: restartStatus.restartSafe,
      acceptedCommandKeys: accepted.map((contract) => contract.commandKey),
    },
    proof: {
      source: 'operator-actions-input',
      visiblePids: scopedProcessView.visiblePids,
      deniedPids: scopedProcessView.denied.map((process) => process.pid),
      boundaryDecisionChecksum: lightweightChecksum(contracts.map((contract) => ({
        commandKey: contract.commandKey,
        pid: contract.pid || null,
        allowed: contract.boundaryDecision?.allowed || false,
        reason: contract.boundaryDecision?.reason || contract.reason,
        proofRef: contract.boundaryDecision?.proofRef || contract.proof,
      }))),
      syncConsistency: syncMetadata.consistency,
      scopeBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildReportingState(health, analytics, analyticsTrend) {
  const failedOrDegraded = health.counts.failed + health.counts.degraded;
  const severity = health.failureState
    ? 'page'
    : health.degradedMode
      ? 'watch'
      : 'clear';

  return {
    severity,
    headline: `${health.counts.total} processes, ${failedOrDegraded} require attention`,
    timelineState: analyticsTrend.movement === 'regression'
      ? 'regressed'
      : analyticsTrend.movement === 'recovery'
        ? 'recovered'
        : analyticsTrend.movement === 'churn'
          ? 'restart-churn'
          : 'steady',
    exportReady: true,
    attentionCount: failedOrDegraded,
    attentionDelta: analyticsTrend.attentionDelta,
    trendMovement: analyticsTrend.movement,
    peakAttentionCount: analyticsTrend.peak.attention,
    retryBudgetRemaining: analytics.counters.retryBudgetRemaining,
  };
}

function buildPreviewAcceptanceContract({
  generatedAt,
  validation,
  lifecycleSettings,
  processes,
  health,
  reporting,
  capabilityNegotiation,
  providerServiceContracts,
  syncMetadata,
  restartStatus,
  recoveryPlan,
  scopedProcessView,
  operatorActionContracts,
  lifecycleControlContracts,
}) {
  const validationErrors = [
    ...validation.errors,
    ...lifecycleSettings.validation.errors,
  ];
  const attentionProcesses = processes
    .filter((process) => process.health === 'failed' || process.health === 'degraded')
    .slice(0, 6)
    .map((process) => ({
      pid: process.pid,
      command: process.command,
      state: process.state,
      health: process.health,
      retryable: process.retry.retryable,
      attemptsRemaining: process.retry.attemptsRemaining,
      nextRetryDelayMs: process.retry.nextRetryDelayMs,
    }));
  const gates = [
    {
      id: 'input-validation',
      label: 'Input validation',
      passed: validation.ok && lifecycleSettings.validation.ok,
      severity: validationErrors.length ? 'blocker' : 'clear',
      detail: validationErrors.length
        ? `${validationErrors.length} validation issue(s) must be fixed before acceptance.`
        : 'Snapshot and lifecycle inputs are structurally valid.',
    },
    {
      id: 'provider-contract',
      label: 'Provider contract',
      passed: capabilityNegotiation.status === 'accepted',
      severity: capabilityNegotiation.missingRequired.length ? 'blocker' : 'clear',
      detail: capabilityNegotiation.missingRequired.length
        ? `Missing required capabilities: ${capabilityNegotiation.missingRequired.join(', ')}.`
        : 'Required hosted-kernel provider capabilities are available.',
    },
    {
      id: 'provider-service-operations',
      label: 'Provider service operations',
      passed: providerServiceContracts.state === 'accepted',
      severity: providerServiceContracts.blockedRequiredCount ? 'blocker' : 'clear',
      detail: providerServiceContracts.blockedRequiredCount
        ? `${providerServiceContracts.blockedRequiredCount} required provider operation(s) are blocked.`
        : 'Required hosted-kernel provider operations are callable.',
    },
    {
      id: 'sync-freshness',
      label: 'Sync freshness',
      passed: !syncMetadata.stale,
      severity: syncMetadata.stale ? 'warning' : 'clear',
      detail: syncMetadata.stale
        ? `Provider snapshot is ${syncMetadata.ageMs}ms old; refresh before dispatch.`
        : `Provider snapshot is fresh at cursor ${syncMetadata.cursor}.`,
    },
    {
      id: 'process-health',
      label: 'Process health',
      passed: !health.failureState,
      severity: health.failureState ? 'blocker' : health.degradedMode ? 'warning' : 'clear',
      detail: `${health.counts.failed} failed and ${health.counts.degraded} degraded process(es).`,
    },
    {
      id: 'scope-boundary',
      label: 'Scope boundary',
      passed: scopedProcessView.deniedCount === 0,
      severity: scopedProcessView.deniedCount ? 'warning' : 'clear',
      detail: scopedProcessView.deniedCount
        ? `${scopedProcessView.deniedCount} process record(s) were redacted by scope policy.`
        : 'All received process records are visible to this operator scope.',
    },
    {
      id: 'restart-readiness',
      label: 'Restart readiness',
      passed: restartStatus.restartSafe && recoveryPlan.pendingCount === 0,
      severity: restartStatus.restartSafe ? 'warning' : 'blocker',
      detail: recoveryPlan.pendingCount
        ? `${recoveryPlan.pendingCount} recovery action(s) are pending before a clean ready state.`
        : `Restart status is ${restartStatus.status}.`,
    },
  ];
  const blocked = gates.filter((gate) => !gate.passed && gate.severity === 'blocker');
  const warnings = gates.filter((gate) => !gate.passed && gate.severity === 'warning');
  const acceptanceState = blocked.length
    ? 'blocked'
    : warnings.length || health.degradedMode
      ? 'needs-review'
      : 'accepted';
  const dispatchReady = !blocked.length
    && !syncMetadata.stale
    && (operatorActionContracts.dispatch.ready || lifecycleControlContracts.dispatch.ready);
  const commandIntentCount = operatorActionContracts.requestedCount
    + lifecycleControlContracts.requestedCount;
  const acceptedCommandCount = operatorActionContracts.acceptedCount
    + lifecycleControlContracts.acceptedCount;
  const blockedCommandCount = Math.max(0, commandIntentCount - acceptedCommandCount);
  const failedGateIds = gates
    .filter((gate) => !gate.passed)
    .map((gate) => gate.id);
  const readinessLanes = [
    {
      id: 'preview',
      label: 'Preview',
      state: blocked.length ? 'blocked' : warnings.length ? 'review-required' : 'ready',
      ready: blocked.length === 0,
      blocksAcceptance: blocked.length > 0,
      reasonCodes: blocked.length
        ? blocked.map((gate) => gate.id)
        : warnings.map((gate) => gate.id),
      operatorMessage: blocked.length
        ? 'Resolve blocker gates before accepting this preview.'
        : warnings.length
          ? 'Review warning gates before accepting this preview.'
          : 'Preview is ready for acceptance.',
    },
    {
      id: 'dispatch',
      label: 'Dispatch',
      state: !commandIntentCount
        ? 'not-requested'
        : dispatchReady
          ? 'ready'
          : blockedCommandCount
            ? 'contract-blocked'
            : syncMetadata.stale
              ? 'refresh-required'
              : 'preview-blocked',
      ready: dispatchReady,
      blocksAcceptance: false,
      reasonCodes: [
        !commandIntentCount ? 'no-command-intent' : null,
        blockedCommandCount ? 'command-contract-blocked' : null,
        syncMetadata.stale ? 'provider-sync-stale' : null,
        blocked.length ? 'preview-gates-blocked' : null,
      ].filter(Boolean),
      operatorMessage: dispatchReady
        ? `${acceptedCommandCount} accepted command contract(s) can be dispatched after acceptance.`
        : commandIntentCount
          ? 'Command dispatch is not ready; inspect blocked command contracts or refresh the process table.'
          : 'No operator or lifecycle command intent was requested for this preview.',
    },
    {
      id: 'recovery',
      label: 'Recovery',
      state: recoveryPlan.pendingCount
        ? restartStatus.restartSafe
          ? 'pending-review'
          : 'blocked'
        : restartStatus.restartSafe
          ? 'ready'
          : 'restart-barrier',
      ready: restartStatus.restartSafe && recoveryPlan.pendingCount === 0,
      blocksAcceptance: !restartStatus.restartSafe,
      reasonCodes: [
        restartStatus.restartSafe ? null : restartStatus.status,
        recoveryPlan.pendingCount ? 'recovery-actions-pending' : null,
      ].filter(Boolean),
      operatorMessage: recoveryPlan.pendingCount
        ? `${recoveryPlan.pendingCount} recovery action(s) need operator review.`
        : `Restart safety is ${restartStatus.status}.`,
    },
  ];
  const acceptancePrerequisites = [
    {
      id: 'proof-ref',
      required: true,
      satisfied: true,
      value: `${syncMetadata.cursor}:${acceptanceState}:${restartStatus.status}`,
      clientField: 'clientAcceptance.proofRef',
    },
    {
      id: 'sync-cursor',
      required: true,
      satisfied: !syncMetadata.stale,
      value: syncMetadata.cursor,
      clientField: 'clientAcceptance.cursor',
    },
    {
      id: 'warning-acknowledgements',
      required: warnings.length > 0 || scopedProcessView.deniedCount > 0 || recoveryPlan.pendingCount > 0,
      satisfied: acceptanceState === 'accepted',
      value: warnings.map((gate) => gate.id),
      clientField: 'clientAcceptance.acknowledgements',
    },
  ];
  const nextSteps = [
    ...validationErrors.slice(0, 3).map((error) => ({
      action: 'fix-validation',
      reason: error.code,
      label: error.action,
    })),
    ...(capabilityNegotiation.missingRequired.length
      ? [{
          action: 'reconcile-provider',
          reason: 'provider-capability-gap',
          label: capabilityNegotiation.nextAction,
        }]
      : []),
    ...(providerServiceContracts.blockedRequiredCount
      ? [{
          action: 'reconcile-provider-service-contract',
          reason: 'provider-service-operation-gap',
          label: 'Advertise required provider operations with endpoints before accepting dispatch.',
        }]
      : []),
    ...(syncMetadata.stale
      ? [{
          action: 'refresh-process-table',
          reason: 'provider-sync-stale',
          label: 'Refresh the hosted-kernel process table before dispatching commands.',
        }]
      : []),
    ...(recoveryPlan.pendingCount
      ? [{
          action: 'review-recovery-plan',
          reason: 'recovery-pending',
          label: 'Review recovery actions and retry budgets before accepting the preview.',
        }]
      : []),
    ...(dispatchReady
      ? [{
          action: 'dispatch-accepted-commands',
          reason: 'contracts-accepted',
          label: 'Dispatch accepted operator or lifecycle commands using idempotent keys.',
        }]
      : []),
  ];

  return {
    schema: 'hosted-kernel.cli-ps.preview-acceptance/v1',
    generatedAt,
    acceptanceState,
    ready: acceptanceState === 'accepted' && restartStatus.restartSafe,
    dispatchReady,
    preview: {
      headline: reporting.headline,
      severity: reporting.severity,
      visibleProcessCount: scopedProcessView.visibleCount,
      deniedProcessCount: scopedProcessView.deniedCount,
      attentionCount: reporting.attentionCount,
      attentionProcesses,
      failedGateIds,
      commandIntentCount,
      acceptedCommandCount,
      blockedCommandCount,
    },
    validationSummary: {
      ok: validationErrors.length === 0,
      errorCount: validationErrors.length,
      codes: validationErrors.map((error) => error.code),
      firstError: validationErrors[0] || null,
      gateCount: gates.length,
      blockerGateCount: blocked.length,
      warningGateCount: warnings.length,
      failedGateIds,
      readinessLaneStates: readinessLanes.reduce((summary, lane) => {
        summary[lane.id] = lane.state;
        return summary;
      }, {}),
    },
    gates,
    readinessLanes,
    acceptancePrerequisites,
    nextSteps: nextSteps.length
      ? nextSteps
      : [{
          action: 'accept-preview',
          reason: 'all-gates-clear',
          label: 'Accept the preview as the current hosted-kernel process snapshot.',
        }],
    clientContract: {
      primaryPanel: 'process-preview',
      acceptanceControl: acceptanceState === 'blocked' ? 'disabled' : 'enabled',
      refreshCursor: syncMetadata.cursor,
      proofRef: `${syncMetadata.cursor}:${acceptanceState}:${restartStatus.status}`,
      routeDataContract: {
        readinessLaneSchema: 'hosted-kernel.cli-ps.preview-readiness-lane/v1',
        prerequisiteSchema: 'hosted-kernel.cli-ps.preview-acceptance-prerequisite/v1',
        requiredClientFields: acceptancePrerequisites
          .filter((prerequisite) => prerequisite.required)
          .map((prerequisite) => prerequisite.clientField),
        blockingLaneIds: readinessLanes
          .filter((lane) => lane.blocksAcceptance && !lane.ready)
          .map((lane) => lane.id),
        reviewLaneIds: readinessLanes
          .filter((lane) => !lane.ready && !lane.blocksAcceptance)
          .map((lane) => lane.id),
      },
      commandContracts: {
        operatorAccepted: operatorActionContracts.acceptedCount,
        lifecycleAccepted: lifecycleControlContracts.acceptedCount,
      },
    },
    proof: {
      validationSchema: 'hosted-kernel.cli-ps.validation/v1',
      providerNegotiation: capabilityNegotiation.status,
      providerServiceContractState: providerServiceContracts.state,
      syncConsistency: syncMetadata.consistency,
      restartStatus: restartStatus.status,
      scopeBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildClientWorkflowState(
  clientRequest,
  previewAcceptance,
  externalHandoff,
  operatorActionContracts,
  lifecycleControlContracts,
  syncMetadata,
  scopedProcessView,
) {
  const acceptedCommandKeys = [
    ...operatorActionContracts.dispatch.acceptedCommandKeys,
    ...lifecycleControlContracts.dispatch.acceptedCommandKeys,
  ];
  const dispatchReady = previewAcceptance.dispatchReady && acceptedCommandKeys.length > 0;
  const blockedByValidation = !clientRequest.validation.ok
    || !previewAcceptance.validationSummary.ok
    || previewAcceptance.acceptanceState === 'blocked';
  const handoffRequired = clientRequest.requestedHandoff
    || externalHandoff.required
    || dispatchReady
    || blockedByValidation;
  const target = clientRequest.preferredHandoffTarget
    || (dispatchReady
      ? 'hosted-kernel-command-dispatcher'
      : externalHandoff.target);
  const nextPanel = blockedByValidation
    ? 'validation-errors'
    : dispatchReady
      ? 'command-dispatch'
      : externalHandoff.required
        ? 'supervisor-handoff'
        : clientRequest.requestedView;
  const workflowState = blockedByValidation
    ? 'blocked'
    : dispatchReady
      ? 'ready-to-dispatch'
      : externalHandoff.required
        ? 'handoff-required'
        : previewAcceptance.acceptanceState;
  const handoffReason = blockedByValidation
    ? 'validation-or-acceptance-blocked'
    : dispatchReady
      ? 'accepted-command-contracts'
      : clientRequest.requestedHandoff
        ? 'client-requested-handoff'
        : externalHandoff.reason;

  return {
    schema: 'hosted-kernel.cli-ps.client-workflow/v1',
    generatedAt: previewAcceptance.generatedAt,
    request: {
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      correlationId: clientRequest.correlationId,
      command: clientRequest.command,
      interactive: clientRequest.interactive,
      dryRun: clientRequest.dryRun,
      requestedView: clientRequest.requestedView,
    },
    state: workflowState,
    nextPanel,
    userVisibleStatus: blockedByValidation
      ? 'Fix validation blockers before accepting or dispatching this process view.'
      : dispatchReady
        ? 'Accepted hosted-kernel commands are ready for idempotent dispatch.'
        : externalHandoff.required
          ? 'This process view needs hosted-kernel supervisor handoff.'
          : 'Process view is ready for operator review.',
    handoff: {
      required: handoffRequired,
      target,
      reason: handoffReason,
      payloadRef: `${clientRequest.requestId}:${syncMetadata.cursor}:${workflowState}`,
      acceptedCommandKeys,
      operatorActionCount: operatorActionContracts.acceptedCount,
      lifecycleControlCount: lifecycleControlContracts.acceptedCount,
    },
    statePatch: {
      lastRequestId: clientRequest.requestId,
      lastCorrelationId: clientRequest.correlationId,
      lastCursor: syncMetadata.cursor,
      activePanel: nextPanel,
      visiblePids: scopedProcessView.visiblePids,
      redactedProcessCount: scopedProcessView.deniedCount,
      acceptanceState: previewAcceptance.acceptanceState,
    },
    auditProof: {
      clientRequestSchema: clientRequest.schema,
      previewProofRef: previewAcceptance.clientContract.proofRef,
      scopeBoundary: scopedProcessView.proof.boundary,
      syncConsistency: syncMetadata.consistency,
      externalHandoffReason: externalHandoff.reason,
      commandReplayPolicy: syncMetadata.stale ? 'blocked-until-fresh-sync' : 'at-most-once',
    },
  };
}

function buildPreviewRouteContract({
  clientRequest,
  previewAcceptance,
  clientWorkflow,
  explainableNextStep,
  operationalHealthTriage,
  syncMetadata,
  scopedProcessView,
  analyticsTrend,
}) {
  const blockingIncidents = operationalHealthTriage.incidents
    .filter((incident) => incident.blocksDispatch)
    .slice(0, 5);
  const warningIncidents = operationalHealthTriage.incidents
    .filter((incident) => !incident.blocksDispatch)
    .slice(0, 5);
  const validationBlocked = previewAcceptance.validationSummary.errorCount > 0
    || previewAcceptance.acceptanceState === 'blocked';
  const canAccept = !validationBlocked && previewAcceptance.clientContract.acceptanceControl === 'enabled';
  const canDispatch = canAccept
    && previewAcceptance.dispatchReady
    && !operationalHealthTriage.dispatch.blocked;
  const routeState = validationBlocked
    ? 'validation-blocked'
    : canDispatch
      ? 'dispatch-ready'
      : previewAcceptance.acceptanceState === 'needs-review'
        ? 'review-required'
        : 'preview-ready';
  const disabledReasons = [
    validationBlocked ? 'validation-summary-blocked' : null,
    syncMetadata.stale ? 'provider-sync-stale' : null,
    operationalHealthTriage.dispatch.blocked ? operationalHealthTriage.dispatch.reason : null,
    scopedProcessView.deniedCount ? 'scope-redaction-present' : null,
  ].filter(Boolean);
  const primaryActions = [
    {
      id: 'refresh',
      label: 'Refresh process table',
      enabled: syncMetadata.stale || routeState === 'review-required',
      reason: syncMetadata.stale ? 'provider-sync-stale' : 'operator-requested-refresh',
    },
    {
      id: 'accept',
      label: 'Accept preview',
      enabled: canAccept,
      reason: canAccept ? previewAcceptance.acceptanceState : disabledReasons[0] || 'acceptance-disabled',
    },
    {
      id: 'dispatch',
      label: 'Dispatch commands',
      enabled: canDispatch,
      reason: canDispatch ? 'accepted-command-contracts' : disabledReasons[0] || 'no-dispatchable-commands',
      commandKeys: clientWorkflow.handoff.acceptedCommandKeys,
    },
  ];

  return {
    schema: 'hosted-kernel.cli-ps.preview-route-contract/v1',
    generatedAt: previewAcceptance.generatedAt,
    route: {
      surfaceId,
      path: '/operator-userland/cli-ps/preview',
      requestId: clientRequest.requestId,
      correlationId: clientRequest.correlationId,
      state: routeState,
      nextPanel: clientWorkflow.nextPanel,
    },
    readiness: {
      canAccept,
      canDispatch,
      canExport: operationalHealthTriage.exit.code !== 78 && !syncMetadata.stale,
      readOnly: operationalHealthTriage.degradedMode.readOnly,
      disabledReasons,
      syncCursor: syncMetadata.cursor,
      exitCode: operationalHealthTriage.exit.code,
      lanes: previewAcceptance.readinessLanes.map((lane) => ({
        id: lane.id,
        state: lane.state,
        ready: lane.ready,
        blocksAcceptance: lane.blocksAcceptance,
        reasonCodes: lane.reasonCodes,
        operatorMessage: lane.operatorMessage,
      })),
      prerequisites: previewAcceptance.acceptancePrerequisites.map((prerequisite) => ({
        id: prerequisite.id,
        required: prerequisite.required,
        satisfied: prerequisite.satisfied,
        clientField: prerequisite.clientField,
      })),
      dataContract: previewAcceptance.clientContract.routeDataContract,
    },
    validationBanner: {
      visible: validationBlocked || blockingIncidents.length > 0,
      status: validationBlocked ? 'error' : blockingIncidents.length ? 'blocked' : 'clear',
      title: validationBlocked
        ? 'Preview has validation blockers'
        : blockingIncidents.length
          ? 'Preview is blocked by operational incidents'
          : 'Preview is ready',
      codes: [
        ...previewAcceptance.validationSummary.codes,
        ...blockingIncidents.map((incident) => incident.code),
      ],
      firstMessage: previewAcceptance.validationSummary.firstError?.message
        || blockingIncidents[0]?.message
        || null,
    },
    explanation: {
      headline: previewAcceptance.preview.headline,
      trendMovement: analyticsTrend.movement,
      attentionDelta: analyticsTrend.attentionDelta,
      blockingIncidents: blockingIncidents.map((incident) => ({
        code: incident.code,
        target: incident.target,
        label: incident.operatorAction,
      })),
      warningIncidents: warningIncidents.map((incident) => ({
        code: incident.code,
        target: incident.target,
        label: incident.operatorAction,
      })),
    },
    nextStep: {
      schema: explainableNextStep.schema,
      state: explainableNextStep.state,
      recommendedAction: explainableNextStep.recommended.action,
      recommendedTarget: explainableNextStep.recommended.target,
      recommendedLabel: explainableNextStep.recommended.label,
      visibleStepCount: explainableNextStep.steps.length,
      blockedReasonCodes: explainableNextStep.readiness.blockedReasonCodes,
      readinessLaneStates: previewAcceptance.validationSummary.readinessLaneStates,
      clientHint: explainableNextStep.clientHint,
    },
    primaryActions,
    auditRefs: {
      proofRef: previewAcceptance.clientContract.proofRef,
      payloadRef: clientWorkflow.handoff.payloadRef,
      scopeBoundary: scopedProcessView.proof.boundary,
      syncConsistency: syncMetadata.consistency,
      operationalHealthSchema: operationalHealthTriage.schema,
    },
  };
}

function buildPreviewAcceptanceReceiptContract({
  input,
  generatedAt,
  clientRequest,
  previewAcceptance,
  previewRouteContract,
  explainableNextStep,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
  providerSyncCheckpoint,
}) {
  const source = input.clientAcceptance && typeof input.clientAcceptance === 'object'
    ? input.clientAcceptance
    : input.acceptance && typeof input.acceptance === 'object'
      ? input.acceptance
      : input.previewDecision && typeof input.previewDecision === 'object'
        ? input.previewDecision
        : {};
  const decision = cleanString(source.decision ?? source.state ?? source.action, '').toLowerCase();
  const accepted = source.accepted === true || decision === 'accept' || decision === 'accepted';
  const rejected = source.rejected === true || decision === 'reject' || decision === 'rejected';
  const submitted = accepted || rejected || Boolean(source.submittedAt || source.proofRef || source.cursor);
  const providedProofRef = cleanString(source.proofRef ?? source.previewProofRef, '');
  const providedCursor = cleanString(source.cursor ?? source.syncCursor, '');
  const requiredAcknowledgements = [
    previewAcceptance.acceptanceState === 'needs-review'
      ? {
          id: 'operator-review-required',
          reason: previewAcceptance.acceptanceState,
          label: 'Operator reviewed warning gates before accepting the hosted-kernel preview.',
        }
      : null,
    previewRouteContract.readiness.readOnly
      ? {
          id: 'read-only-mode',
          reason: 'degraded-or-redacted-view',
          label: 'Operator acknowledges this preview is read-only until blockers are resolved.',
        }
      : null,
    dispatchReadinessGate.auditOnly
      ? {
          id: 'audit-only-dispatch',
          reason: dispatchReadinessGate.state,
          label: 'Operator acknowledges accepted commands are audit-only and will not mutate process state.',
        }
      : null,
    providerSyncCheckpoint.writeBarrier !== 'read-only'
      ? {
          id: 'provider-write-barrier',
          reason: providerSyncCheckpoint.writeBarrier,
          label: 'Operator acknowledges provider checkpoint write-barrier ordering.',
        }
      : null,
  ].filter(Boolean);
  const acknowledgedIds = normalizeCapabilityList(source.acknowledgements ?? source.acks);
  const missingAcknowledgements = requiredAcknowledgements
    .filter((acknowledgement) => !acknowledgedIds.includes(acknowledgement.id));
  const validationErrors = [
    previewRouteContract.readiness.canAccept
      ? null
      : {
          code: 'CLI_PS_PREVIEW_ACCEPT_DISABLED',
          path: 'clientAcceptance.decision',
          message: 'Preview acceptance is disabled for the current route state.',
          action: previewRouteContract.readiness.disabledReasons[0]
            || 'Resolve preview readiness blockers before submitting acceptance.',
        },
    providedProofRef && providedProofRef !== previewAcceptance.clientContract.proofRef
      ? {
          code: 'CLI_PS_PREVIEW_ACCEPT_PROOF_MISMATCH',
          path: 'clientAcceptance.proofRef',
          message: 'Preview acceptance proofRef does not match the rendered preview contract.',
          action: `Resubmit acceptance with proofRef ${previewAcceptance.clientContract.proofRef}.`,
        }
      : null,
    providedCursor && providedCursor !== previewAcceptance.clientContract.refreshCursor
      ? {
          code: 'CLI_PS_PREVIEW_ACCEPT_CURSOR_MISMATCH',
          path: 'clientAcceptance.cursor',
          message: 'Preview acceptance cursor does not match the current hosted-kernel snapshot.',
          action: 'Refresh the process table before accepting this preview.',
        }
      : null,
    accepted && missingAcknowledgements.length
      ? {
          code: 'CLI_PS_PREVIEW_ACCEPT_ACK_REQUIRED',
          path: 'clientAcceptance.acknowledgements',
          message: 'Preview acceptance requires acknowledgement of warning or write-barrier conditions.',
          action: `Acknowledge: ${missingAcknowledgements.map((item) => item.id).join(', ')}.`,
        }
      : null,
  ].filter(Boolean);
  const receiptState = !submitted
    ? 'awaiting-operator-decision'
    : rejected
      ? 'operator-rejected'
      : validationErrors.length
        ? 'rejected-by-contract'
        : accepted
          ? previewRouteContract.readiness.canDispatch
            ? 'accepted-dispatch-ready'
            : 'accepted-preview-only'
          : 'operator-review-pending';
  const commandKeys = hostedKernelDispatchEnvelope.commands
    .filter((command) => command.acceptedForDispatch || dispatchReadinessGate.auditOnly)
    .map((command) => command.key);

  return {
    schema: 'hosted-kernel.cli-ps.preview-acceptance-receipt/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state: receiptState,
    accepted: receiptState === 'accepted-dispatch-ready' || receiptState === 'accepted-preview-only',
    submitted,
    decision: accepted ? 'accept' : rejected ? 'reject' : decision || 'none',
    routeState: previewRouteContract.route.state,
    validationSummary: {
      ok: validationErrors.length === 0,
      errorCount: validationErrors.length,
      errors: validationErrors,
      requiredAcknowledgementCount: requiredAcknowledgements.length,
      missingAcknowledgementIds: missingAcknowledgements.map((item) => item.id),
    },
    requiredAcknowledgements,
    commandEffect: {
      dispatchAllowed: receiptState === 'accepted-dispatch-ready'
        && dispatchReadinessGate.dispatchAllowed,
      auditOnly: dispatchReadinessGate.auditOnly,
      replayPolicy: hostedKernelDispatchEnvelope.replayPolicy,
      batchKey: hostedKernelDispatchEnvelope.batchKey,
      commandKeys,
      blockedCount: hostedKernelDispatchEnvelope.blockedCount,
    },
    statePatch: {
      acceptedAt: receiptState.startsWith('accepted-')
        ? cleanString(source.submittedAt ?? source.acceptedAt, generatedAt)
        : null,
      acceptedBy: cleanString(source.operatorId ?? source.acceptedBy, clientRequest.clientId),
      acceptanceState: receiptState,
      proofRef: previewAcceptance.clientContract.proofRef,
      cursor: previewAcceptance.clientContract.refreshCursor,
      nextPanel: receiptState === 'accepted-dispatch-ready'
        ? 'command-dispatch'
        : explainableNextStep.clientHint.primaryPanel,
    },
    proof: {
      previewProofRef: previewAcceptance.clientContract.proofRef,
      submittedProofRef: providedProofRef || null,
      submittedCursor: providedCursor || null,
      routeSchema: previewRouteContract.schema,
      nextStepSchema: explainableNextStep.schema,
      dispatchReadinessSchema: dispatchReadinessGate.schema,
      hostedDispatchSchema: hostedKernelDispatchEnvelope.schema,
      providerCheckpointSchema: providerSyncCheckpoint.schema,
      receiptChecksum: lightweightChecksum({
        requestId: clientRequest.requestId,
        state: receiptState,
        commandKeys,
        requiredAcknowledgements,
      }),
    },
  };
}

function buildExplainableNextStepContract({
  generatedAt,
  clientRequest,
  previewAcceptance,
  operationalHealthTriage,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
  syncMetadata,
  scopedProcessView,
}) {
  const dispatchableCommands = hostedKernelDispatchEnvelope.commands
    .filter((command) => command.acceptedForDispatch);
  const auditOnlyCommands = hostedKernelDispatchEnvelope.commands
    .filter((command) => !command.acceptedForDispatch);
  const blockingCodes = [
    ...previewAcceptance.validationSummary.codes,
    ...operationalHealthTriage.incidents
      .filter((incident) => incident.blocksDispatch)
      .map((incident) => incident.code),
    ...dispatchReadinessGate.blockedBy,
  ];
  const makeStep = (action, target, label, enabled, reason, evidence) => ({
    action,
    target,
    label,
    enabled,
    reason,
    evidence,
  });
  const steps = [
    ...previewAcceptance.validationSummary.errorCount
      ? [makeStep(
          'fix-validation',
          previewAcceptance.validationSummary.firstError?.path || 'input',
          previewAcceptance.validationSummary.firstError?.action || 'Fix validation blockers.',
          true,
          'validation-summary-error',
          previewAcceptance.validationSummary.firstError?.code || 'validation-error',
        )]
      : [],
    ...syncMetadata.stale
      ? [makeStep(
          'refresh-process-table',
          syncMetadata.cursor,
          'Refresh the hosted-kernel process table before accepting or dispatching commands.',
          true,
          'provider-sync-stale',
          `${syncMetadata.ageMs}ms-old`,
        )]
      : [],
    ...operationalHealthTriage.incidents
      .filter((incident) => incident.blocksDispatch)
      .slice(0, 3)
      .map((incident) => makeStep(
        incident.retryEligible ? 'retry-or-refresh' : 'operator-review',
        incident.target,
        incident.operatorAction,
        true,
        incident.code,
        incident.proof,
      )),
    ...dispatchableCommands.length
      ? [makeStep(
          'dispatch-commands',
          hostedKernelDispatchEnvelope.batchKey,
          'Dispatch accepted hosted-kernel commands with idempotent keys.',
          dispatchReadinessGate.dispatchAllowed,
          dispatchReadinessGate.state,
          `${dispatchableCommands.length}:dispatchable`,
        )]
      : [],
    ...auditOnlyCommands.length && !dispatchableCommands.length
      ? [makeStep(
          'review-audit-envelope',
          hostedKernelDispatchEnvelope.batchKey,
          'Review audit-only command contracts before changing process state.',
          dispatchReadinessGate.auditOnly,
          hostedKernelDispatchEnvelope.state,
          `${auditOnlyCommands.length}:audit-only`,
        )]
      : [],
    ...scopedProcessView.deniedCount
      ? [makeStep(
          'review-scope-boundary',
          `${scopedProcessView.tenantId}/${scopedProcessView.workspaceId}`,
          'Review scope boundary proof for redacted process records.',
          true,
          'scope-redaction-present',
          scopedProcessView.proof.boundary,
        )]
      : [],
    ...previewAcceptance.acceptanceState !== 'blocked'
      && !dispatchableCommands.length
      && !syncMetadata.stale
      ? [makeStep(
          'accept-preview',
          previewAcceptance.clientContract.proofRef,
          'Accept the preview as the current hosted-kernel process snapshot.',
          previewAcceptance.clientContract.acceptanceControl === 'enabled',
          previewAcceptance.acceptanceState,
          previewAcceptance.schema,
        )]
      : [],
  ];
  const visibleSteps = steps.filter((step) => step.enabled || step.action === 'fix-validation');
  const recommended = visibleSteps[0] || makeStep(
    'continue-process-review',
    clientRequest.requestedView,
    'Continue reviewing the hosted-kernel process view.',
    true,
    'no-blocking-next-step',
    previewAcceptance.clientContract.proofRef,
  );
  const state = previewAcceptance.acceptanceState === 'blocked' || dispatchReadinessGate.blocked
    ? 'blocked-action-required'
    : dispatchableCommands.length && dispatchReadinessGate.dispatchAllowed
      ? 'dispatch-ready'
      : dispatchReadinessGate.auditOnly
        ? 'audit-review-ready'
        : previewAcceptance.acceptanceState === 'needs-review'
          ? 'operator-review-required'
          : 'preview-acceptance-ready';

  return {
    schema: 'hosted-kernel.cli-ps.explainable-next-step/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state,
    recommended,
    steps: visibleSteps,
    readiness: {
      acceptanceState: previewAcceptance.acceptanceState,
      dispatchReadinessState: dispatchReadinessGate.state,
      hostedDispatchState: hostedKernelDispatchEnvelope.state,
      blockedReasonCodes: [...new Set(blockingCodes)].filter(Boolean),
      syncStale: syncMetadata.stale,
      redactedProcessCount: scopedProcessView.deniedCount,
      dispatchableCommandCount: dispatchableCommands.length,
      auditOnlyCommandCount: auditOnlyCommands.length,
    },
    clientHint: {
      primaryPanel: recommended.action === 'dispatch-commands'
        ? 'command-dispatch'
        : recommended.action === 'fix-validation'
          ? 'validation-errors'
          : recommended.action === 'review-scope-boundary'
            ? 'scope-boundary-proof'
            : previewAcceptance.clientContract.primaryPanel,
      controlState: recommended.enabled ? 'enabled' : 'disabled',
      proofRef: previewAcceptance.clientContract.proofRef,
      payloadRef: hostedKernelDispatchEnvelope.batchKey,
    },
    proof: {
      previewAcceptanceSchema: previewAcceptance.schema,
      operationalHealthSchema: operationalHealthTriage.schema,
      dispatchReadinessSchema: dispatchReadinessGate.schema,
      hostedDispatchSchema: hostedKernelDispatchEnvelope.schema,
      syncCursor: syncMetadata.cursor,
      scopeBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildSyncMetadata(input, generatedAt, providerContract, negotiation, providerServiceContracts, health) {
  const sync = input.sync && typeof input.sync === 'object' ? input.sync : {};
  const sequence = normalizeNumber(sync.sequence ?? sync.revision ?? input.sequence, 0);
  const receivedAt = cleanString(sync.receivedAt ?? input.receivedAt, generatedAt);
  const lastProviderSyncAt = cleanString(sync.lastProviderSyncAt ?? sync.syncedAt, receivedAt);
  const maxAgeMs = normalizeNumber(sync.maxAgeMs ?? sync.staleAfterMs, 15_000);
  const lastSyncMs = Date.parse(lastProviderSyncAt);
  const generatedMs = Date.parse(generatedAt);
  const ageMs = Number.isNaN(lastSyncMs) || Number.isNaN(generatedMs)
    ? 0
    : Math.max(0, generatedMs - lastSyncMs);
  const stale = maxAgeMs > 0 && ageMs > maxAgeMs;

  return {
    schema: 'hosted-kernel.cli-ps.sync-metadata/v1',
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    sequence,
    cursor: cleanString(sync.cursor ?? input.cursor, `cli-ps:${sequence}`),
    receivedAt,
    lastProviderSyncAt,
    maxAgeMs,
    ageMs,
    stale,
    consistency: stale || negotiation.status !== 'accepted' || providerServiceContracts.state !== 'accepted'
      ? 'eventual'
      : health.failureState
        ? 'failure-observed'
        : 'fresh',
    serviceContract: {
      schema: providerServiceContracts.schema,
      state: providerServiceContracts.state,
      operationChecksum: providerServiceContracts.proof.operationChecksum,
      acceptedRequiredCount: providerServiceContracts.acceptedRequiredCount,
      blockedRequiredCount: providerServiceContracts.blockedRequiredCount,
    },
  };
}

function buildExternalHandoffState(
  processes,
  health,
  reporting,
  negotiation,
  providerServiceContracts,
  syncMetadata,
  scopedProcessView,
) {
  const attentionProcesses = processes
    .filter((process) => process.health === 'failed' || process.health === 'degraded')
    .map((process) => ({
      pid: process.pid,
      command: process.command,
      state: process.state,
      health: process.health,
      retryable: process.retry.retryable,
      attemptsRemaining: process.retry.attemptsRemaining,
      nextRetryDelayMs: process.retry.nextRetryDelayMs,
    }));
  const handoffRequired = health.failureState
    || reporting.severity === 'watch'
    || negotiation.status !== 'accepted'
    || providerServiceContracts.state !== 'accepted'
    || syncMetadata.stale
    || scopedProcessView.deniedCount > 0;
  const supervisorSink = providerServiceContracts.supervisorHandoffSink;

  return {
    schema: 'hosted-kernel.cli-ps.external-handoff/v1',
    required: handoffRequired,
    target: scopedProcessView.deniedCount > 0
      ? 'hosted-kernel-security-audit'
      : handoffRequired && supervisorSink
        ? providerServiceContracts.serviceName
        : handoffRequired
        ? 'hosted-kernel-supervisor'
        : 'operator-console',
    reason: scopedProcessView.deniedCount > 0
      ? 'scope-boundary-redaction'
      : negotiation.status !== 'accepted'
      ? 'provider-capability-gap'
      : providerServiceContracts.state !== 'accepted'
        ? 'provider-service-contract-gap'
      : syncMetadata.stale
        ? 'stale-provider-sync'
        : health.failureState
          ? 'process-failure'
          : reporting.severity === 'watch'
            ? 'degraded-processes'
            : 'none',
    payloadRef: `${syncMetadata.cursor}:${reporting.severity}:${providerServiceContracts.proof.operationChecksum}`,
    providerOperation: supervisorSink
      ? {
          operation: supervisorSink.operation,
          endpoint: supervisorSink.endpoint,
          method: supervisorSink.method,
          capability: supervisorSink.capability,
          proofRef: supervisorSink.proofRef,
        }
      : null,
    attentionProcesses,
    operatorActions: handoffRequired
      ? [
          'inspect-process-logs',
          'reconcile-provider-contract',
          'refresh-process-table',
          ...(scopedProcessView.deniedCount > 0 ? ['review-scope-boundary-proof'] : []),
        ]
      : [],
    scope: {
      tenantId: scopedProcessView.tenantId,
      workspaceId: scopedProcessView.workspaceId,
      deniedCount: scopedProcessView.deniedCount,
      deniedByReason: scopedProcessView.deniedByReason,
      proofBoundary: scopedProcessView.proof.boundary,
    },
  };
}

function buildProviderSyncCheckpoint({
  generatedAt,
  clientRequest,
  providerContract,
  providerServiceContracts,
  capabilityNegotiation,
  syncMetadata,
  externalHandoff,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
}) {
  const acceptedOperations = [
    ...providerServiceContracts.requiredContracts,
    ...providerServiceContracts.optionalContracts,
  ].filter((operation) => operation.accepted);
  const operationByName = new Map(acceptedOperations.map((operation) => [operation.operation, operation]));
  const listOperation = operationByName.get('listProcesses');
  const auditOperation = operationByName.get('appendAuditEvidence');
  const handoffOperation = operationByName.get('openSupervisorHandoff');
  const commandCount = hostedKernelDispatchEnvelope.dispatchableCount;
  const auditOnlyCount = hostedKernelDispatchEnvelope.auditOnlyCount;
  const providerReady = capabilityNegotiation.status === 'accepted'
    && providerServiceContracts.state === 'accepted';
  const snapshotAccepted = providerReady && !syncMetadata.stale;
  const writeBarrier = syncMetadata.stale
    ? 'refresh-before-write'
    : dispatchReadinessGate.dispatchAllowed
      ? 'append-audit-before-command-dispatch'
      : dispatchReadinessGate.auditOnly
        ? 'append-audit-only'
        : 'read-only';
  const handoffReady = externalHandoff.required
    && Boolean(handoffOperation)
    && providerReady;
  const checkpointState = !providerReady
    ? 'provider-contract-blocked'
    : syncMetadata.stale
      ? 'refresh-required'
      : commandCount
        ? 'command-handoff-ready'
        : auditOnlyCount
          ? 'audit-checkpoint-ready'
          : externalHandoff.required
            ? handoffReady ? 'supervisor-handoff-ready' : 'manual-handoff-required'
            : 'snapshot-ack-ready';
  const outboundMessages = [
    snapshotAccepted && listOperation
      ? {
          type: 'snapshot-ack',
          operation: listOperation.operation,
          endpoint: listOperation.endpoint,
          method: listOperation.method,
          cursor: syncMetadata.cursor,
          sequence: syncMetadata.sequence,
          idempotencyKey: `cli-ps:ack:${syncMetadata.cursor}:${clientRequest.requestId}`,
        }
      : null,
    auditOperation && (commandCount || auditOnlyCount || externalHandoff.required)
      ? {
          type: 'audit-evidence',
          operation: auditOperation.operation,
          endpoint: auditOperation.endpoint,
          method: auditOperation.method,
          cursor: syncMetadata.cursor,
          payloadRef: hostedKernelDispatchEnvelope.batchKey,
          commandCount: hostedKernelDispatchEnvelope.commands.length,
          idempotencyKey: `cli-ps:audit:${hostedKernelDispatchEnvelope.batchKey}`,
        }
      : null,
    handoffReady
      ? {
          type: 'supervisor-handoff',
          operation: handoffOperation.operation,
          endpoint: handoffOperation.endpoint,
          method: handoffOperation.method,
          target: externalHandoff.target,
          reason: externalHandoff.reason,
          payloadRef: externalHandoff.payloadRef,
          idempotencyKey: `cli-ps:handoff:${syncMetadata.cursor}:${clientRequest.requestId}`,
        }
      : null,
  ].filter(Boolean);
  const inboundRequirements = [
    {
      name: 'process-table-snapshot',
      operation: 'listProcesses',
      satisfied: Boolean(listOperation),
      cursor: syncMetadata.cursor,
      freshness: syncMetadata.stale ? 'stale' : 'fresh',
    },
    {
      name: 'lifecycle-state',
      operation: 'getLifecycleState',
      satisfied: operationByName.has('getLifecycleState'),
      cursor: syncMetadata.cursor,
      freshness: capabilityNegotiation.status === 'accepted' ? syncMetadata.consistency : 'untrusted',
    },
    {
      name: 'retry-policy',
      operation: 'readRetryPolicy',
      satisfied: operationByName.has('readRetryPolicy'),
      cursor: syncMetadata.cursor,
      freshness: providerServiceContracts.state === 'accepted' ? syncMetadata.consistency : 'untrusted',
    },
  ];

  return {
    schema: 'hosted-kernel.cli-ps.provider-sync-checkpoint/v1',
    generatedAt,
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state: checkpointState,
    cursor: syncMetadata.cursor,
    sequence: syncMetadata.sequence,
    providerReady,
    snapshotAccepted,
    writeBarrier,
    requiresRefresh: syncMetadata.stale,
    handoffReady,
    inboundRequirements,
    outboundMessages,
    externalHandoff: {
      required: externalHandoff.required,
      target: externalHandoff.target,
      reason: externalHandoff.reason,
      providerOperationAvailable: Boolean(handoffOperation),
      mode: handoffReady
        ? 'provider-operation'
        : externalHandoff.required
          ? 'manual-supervisor-route'
          : 'not-required',
    },
    dispatchBridge: {
      readinessState: dispatchReadinessGate.state,
      hostedDispatchState: hostedKernelDispatchEnvelope.state,
      batchKey: hostedKernelDispatchEnvelope.batchKey,
      commandCount: hostedKernelDispatchEnvelope.commands.length,
      dispatchableCount: commandCount,
      auditOnlyCount,
      blockedCount: hostedKernelDispatchEnvelope.blockedCount,
      replayPolicy: hostedKernelDispatchEnvelope.replayPolicy,
    },
    proof: {
      negotiationStatus: capabilityNegotiation.status,
      providerServiceState: providerServiceContracts.state,
      operationChecksum: providerServiceContracts.proof.operationChecksum,
      capabilityChecksum: providerServiceContracts.proof.capabilityChecksum,
      syncConsistency: syncMetadata.consistency,
      dispatchReadinessSchema: dispatchReadinessGate.schema,
      hostedDispatchSchema: hostedKernelDispatchEnvelope.schema,
      outboundChecksum: lightweightChecksum(outboundMessages),
    },
  };
}

function buildWorkflowHandoffPackage({
  generatedAt,
  clientRequest,
  clientWorkflow,
  previewRouteContract,
  previewAcceptanceReceipt,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
  providerSyncCheckpoint,
  operationalHealthTriage,
  externalHandoff,
  analyticsExportReport,
  scopedProcessView,
}) {
  const dispatchableCommands = hostedKernelDispatchEnvelope.commands
    .filter((command) => command.acceptedForDispatch)
    .map((command) => ({
      key: command.key,
      kind: command.kind,
      action: command.action,
      target: command.target?.pid || command.control || 'snapshot',
      dispatchMode: command.dispatchMode,
      replayPolicy: command.replayPolicy,
    }));
  const auditOnlyCommands = hostedKernelDispatchEnvelope.commands
    .filter((command) => !command.acceptedForDispatch)
    .map((command) => ({
      key: command.key,
      kind: command.kind,
      action: command.action,
      target: command.target?.pid || command.control || 'snapshot',
      dispatchMode: command.dispatchMode,
      replayPolicy: command.replayPolicy,
    }));
  const blockingReasons = [
    ...dispatchReadinessGate.blockedBy,
    ...(providerSyncCheckpoint.requiresRefresh ? ['provider-sync-refresh-required'] : []),
    ...previewAcceptanceReceipt.validationSummary.errors.map((error) => error.code),
    ...operationalHealthTriage.incidents
      .filter((incident) => incident.blocksDispatch)
      .map((incident) => incident.code),
  ];
  const pendingAcks = previewAcceptanceReceipt.validationSummary.missingAcknowledgementIds;
  const supervisorMessage = providerSyncCheckpoint.outboundMessages
    .find((message) => message.type === 'supervisor-handoff') || null;
  const auditMessage = providerSyncCheckpoint.outboundMessages
    .find((message) => message.type === 'audit-evidence') || null;
  const handoffChannel = dispatchableCommands.length && dispatchReadinessGate.dispatchAllowed
    ? 'hosted-kernel-dispatcher'
    : supervisorMessage
      ? 'provider-supervisor-handoff'
      : externalHandoff.required
        ? 'manual-supervisor-handoff'
        : dispatchReadinessGate.auditOnly || auditOnlyCommands.length
          ? 'audit-review'
          : 'operator-preview';
  const state = blockingReasons.length
    ? 'blocked'
    : pendingAcks.length
      ? 'awaiting-acknowledgement'
      : previewAcceptanceReceipt.accepted && dispatchableCommands.length
        ? 'ready-for-dispatch'
        : previewAcceptanceReceipt.accepted
          ? 'accepted-preview'
          : externalHandoff.required
            ? 'handoff-required'
            : 'preview-review';
  const nextPanel = state === 'ready-for-dispatch'
    ? 'command-dispatch'
    : state === 'blocked'
      ? previewRouteContract.validationBanner.visible ? 'validation-errors' : 'operational-incidents'
      : state === 'awaiting-acknowledgement'
        ? 'preview-acknowledgements'
        : handoffChannel.includes('supervisor')
          ? 'supervisor-handoff'
          : clientWorkflow.nextPanel;
  const userVisibleSummary = state === 'ready-for-dispatch'
    ? `Dispatch ${dispatchableCommands.length} hosted-kernel command(s) after audit evidence is appended.`
    : state === 'blocked'
      ? `Resolve ${[...new Set(blockingReasons)].length} blocker(s) before workflow handoff.`
      : state === 'awaiting-acknowledgement'
        ? `Acknowledge ${pendingAcks.length} preview condition(s) before accepting this handoff.`
        : externalHandoff.required
          ? `Open ${handoffChannel} for ${externalHandoff.reason}.`
          : 'Continue hosted-kernel process review from the preview route.';

  return {
    schema: 'hosted-kernel.cli-ps.workflow-handoff-package/v1',
    generatedAt,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    state,
    handoffChannel,
    nextPanel,
    userVisibleSummary,
    routing: {
      surfaceId,
      routePath: previewRouteContract.route.path,
      routeState: previewRouteContract.route.state,
      clientWorkflowState: clientWorkflow.state,
      target: handoffChannel === 'hosted-kernel-dispatcher'
        ? 'hosted-kernel-command-dispatcher'
        : externalHandoff.target,
      reason: blockingReasons[0] || externalHandoff.reason || dispatchReadinessGate.state,
      payloadRef: `${hostedKernelDispatchEnvelope.batchKey}:${state}`,
    },
    commands: {
      dispatchableCount: dispatchableCommands.length,
      auditOnlyCount: auditOnlyCommands.length,
      blockedCount: hostedKernelDispatchEnvelope.blockedCount,
      replayPolicy: hostedKernelDispatchEnvelope.replayPolicy,
      dispatchableCommands,
      auditOnlyCommands,
      blockedTargets: hostedKernelDispatchEnvelope.blocked.map((command) => ({
        kind: command.kind,
        target: command.target,
        reason: command.reason,
      })),
    },
    clientStatePatch: {
      activePanel: nextPanel,
      workflowState: state,
      handoffChannel,
      lastRequestId: clientRequest.requestId,
      lastCorrelationId: clientRequest.correlationId,
      proofRef: previewRouteContract.auditRefs.proofRef,
      payloadRef: `${hostedKernelDispatchEnvelope.batchKey}:${state}`,
      redactedProcessCount: scopedProcessView.deniedCount,
      exportReportReady: analyticsExportReport.ready,
      readinessLaneStates: previewRouteContract.readiness.lanes.reduce((summary, lane) => {
        summary[lane.id] = lane.state;
        return summary;
      }, {}),
    },
    providerBridge: {
      checkpointState: providerSyncCheckpoint.state,
      writeBarrier: providerSyncCheckpoint.writeBarrier,
      snapshotAccepted: providerSyncCheckpoint.snapshotAccepted,
      requiresRefresh: providerSyncCheckpoint.requiresRefresh,
      auditMessageKey: auditMessage?.idempotencyKey || null,
      supervisorMessageKey: supervisorMessage?.idempotencyKey || null,
      outboundMessageCount: providerSyncCheckpoint.outboundMessages.length,
    },
    blockers: {
      count: [...new Set(blockingReasons)].length,
      reasons: [...new Set(blockingReasons)],
      pendingAcknowledgements: pendingAcks,
      blockedReadinessLanes: previewRouteContract.readiness.lanes
        .filter((lane) => lane.blocksAcceptance && !lane.ready)
        .map((lane) => lane.id),
      unsatisfiedPrerequisites: previewRouteContract.readiness.prerequisites
        .filter((prerequisite) => prerequisite.required && !prerequisite.satisfied)
        .map((prerequisite) => prerequisite.id),
      actionableErrors: dispatchReadinessGate.actionableErrors.slice(0, 5),
    },
    proof: {
      clientWorkflowSchema: clientWorkflow.schema,
      routeSchema: previewRouteContract.schema,
      receiptSchema: previewAcceptanceReceipt.schema,
      dispatchEnvelopeSchema: hostedKernelDispatchEnvelope.schema,
      providerCheckpointSchema: providerSyncCheckpoint.schema,
      operationalHealthSchema: operationalHealthTriage.schema,
      commandChecksum: lightweightChecksum({
        dispatchableCommands,
        auditOnlyCommands,
        blocked: hostedKernelDispatchEnvelope.blocked,
      }),
      statePatchChecksum: lightweightChecksum({
        requestId: clientRequest.requestId,
        state,
        nextPanel,
        handoffChannel,
        cursor: providerSyncCheckpoint.cursor,
      }),
    },
  };
}

function buildExportSummary(
  generatedAt,
  health,
  analytics,
  analyticsTrend,
  timelineReport,
  reporting,
  negotiation,
  providerServiceContracts,
  syncMetadata,
  handoff,
  restartStatus,
  restartReconciliation,
  scopedProcessView,
  operatorActionContracts,
  lifecycleControlContracts,
  lifecycleNextActionState,
  previewAcceptance,
  clientWorkflow,
  previewRouteContract,
  operationalHealthTriage,
  dispatchReadinessGate,
  hostedKernelDispatchEnvelope,
  explainableNextStep,
  providerSyncCheckpoint,
  previewAcceptanceReceipt,
  workflowHandoffPackage,
  analyticsExportState,
  analyticsExportReport,
) {
  return {
    schema: 'hosted-kernel.cli-ps.export-summary/v1',
    generatedAt,
    status: health.mode,
    processTotals: health.counts,
    counters: analytics.counters,
    rates: analytics.rates,
    trend: analyticsTrend,
    timeline: {
      schema: timelineReport.schema,
      state: timelineReport.state,
      eventCount: timelineReport.eventCount,
      latestEventType: timelineReport.latestEventType,
      exportWindow: timelineReport.exportWindow,
    },
    reporting,
    provider: {
      id: negotiation.providerId,
      service: negotiation.serviceName,
      contractVersion: negotiation.contractVersion,
      negotiationStatus: negotiation.status,
      missingRequiredCapabilities: negotiation.missingRequired,
      serviceContractState: providerServiceContracts.state,
      acceptedRequiredOperations: providerServiceContracts.acceptedRequiredCount,
      blockedRequiredOperations: providerServiceContracts.blockedRequiredCount,
      acceptedOptionalOperations: providerServiceContracts.acceptedOptionalCount,
      writableAuditSink: providerServiceContracts.writableAuditSink,
      supervisorHandoffSink: Boolean(providerServiceContracts.supervisorHandoffSink),
      blockedOperations: providerServiceContracts.blockedReasons,
      operationChecksum: providerServiceContracts.proof.operationChecksum,
    },
    sync: {
      sequence: syncMetadata.sequence,
      cursor: syncMetadata.cursor,
      stale: syncMetadata.stale,
      consistency: syncMetadata.consistency,
    },
    handoff: {
      required: handoff.required,
      target: handoff.target,
      reason: handoff.reason,
    },
    restartStatus: {
      status: restartStatus.status,
      restartSafe: restartStatus.restartSafe,
      pendingRecoveryCount: restartStatus.pendingRecoveryCount,
      effectivePendingRecoveryCount: restartStatus.effectivePendingRecoveryCount,
      suppressedReplayCount: restartStatus.suppressedReplayCount,
      restartDecision: restartStatus.restartDecision,
      persistedGeneration: restartStatus.persistedGeneration,
      reconciliationState: restartStatus.reconciliationState,
      reconciliationReplayBlocked: restartStatus.reconciliationCounts.replayBlocked,
      reconciliationOrphaned: restartStatus.reconciliationCounts.orphaned,
      reconciliationNextOperatorAction: restartStatus.reconciliationNextOperatorAction,
      persistenceIntegrityOk: restartStatus.persistenceIntegrity.ok,
      persistenceWriteBarrier: restartStatus.persistenceIntegrity.writeBarrier,
      persistenceBlockingReasonCount: restartStatus.persistenceIntegrity.blockingReasonCount,
      persistenceBlockingCodes: restartStatus.persistenceIntegrity.blockingCodes,
    },
    restartReconciliation: {
      schema: restartReconciliation.schema,
      state: restartReconciliation.state,
      counts: restartReconciliation.counts,
      nextOperatorAction: restartReconciliation.nextOperatorAction,
      replayBlockedPids: restartReconciliation.rows
        .filter((row) => row.replayBlocked)
        .map((row) => row.pid),
      orphanedPids: restartReconciliation.rows
        .filter((row) => row.orphaned)
        .map((row) => row.pid),
      proof: restartReconciliation.proof,
    },
    operatorActions: {
      requestedCount: operatorActionContracts.requestedCount,
      acceptedCount: operatorActionContracts.acceptedCount,
      blockedCount: operatorActionContracts.blockedCount,
      dispatchReady: operatorActionContracts.dispatch.ready,
      dispatchMode: operatorActionContracts.dispatch.mode,
    },
    lifecycleControls: {
      settingsSchema: lifecycleControlContracts.settings.schema,
      settingsValid: lifecycleControlContracts.settings.validation.ok,
      requestedCount: lifecycleControlContracts.requestedCount,
      acceptedCount: lifecycleControlContracts.acceptedCount,
      blockedCount: lifecycleControlContracts.blockedCount,
      dispatchReady: lifecycleControlContracts.dispatch.ready,
      maxConcurrentActions: lifecycleControlContracts.dispatch.maxConcurrentActions,
      nextAction: lifecycleControlContracts.nextAction,
      autoRetryEnabled: lifecycleControlContracts.settings.controls['auto-retry'],
      quietUntil: lifecycleControlContracts.settings.schedule.quietUntil,
      activeMaintenanceWindowCount: lifecycleControlContracts.settings.schedule.activeWindowCount,
      pausedControls: lifecycleControlContracts.settings.schedule.pausedControls,
      autoRetryPaused: lifecycleControlContracts.settings.schedule.autoRetryPaused,
      nextActionState: lifecycleNextActionState.state,
      nextOperatorAction: lifecycleNextActionState.nextOperatorAction.action,
      nextOperatorTarget: lifecycleNextActionState.nextOperatorAction.target,
      effectiveControls: lifecycleNextActionState.effectiveControls,
      immediateChangeCount: lifecycleNextActionState.immediateChangeCount,
      immediateDispatchableCount: lifecycleNextActionState.immediateDispatchableCount,
      scheduledChangeCount: lifecycleNextActionState.scheduledChangeCount,
      scheduledDueCount: lifecycleNextActionState.scheduledDueCount,
      blockedChangeCount: lifecycleNextActionState.blockedChanges.length,
      noOpCount: lifecycleNextActionState.noOpCount,
      quietModeActive: lifecycleNextActionState.quietMode.active,
      remainingLifecycleSlots: lifecycleNextActionState.concurrency.remainingSlots,
      proof: lifecycleNextActionState.proof,
    },
    previewAcceptance: {
      schema: previewAcceptance.schema,
      state: previewAcceptance.acceptanceState,
      ready: previewAcceptance.ready,
      dispatchReady: previewAcceptance.dispatchReady,
      validationOk: previewAcceptance.validationSummary.ok,
      validationErrorCount: previewAcceptance.validationSummary.errorCount,
      gateCount: previewAcceptance.gates.length,
      blockedGateIds: previewAcceptance.gates
        .filter((gate) => !gate.passed && gate.severity === 'blocker')
        .map((gate) => gate.id),
      warningGateIds: previewAcceptance.gates
        .filter((gate) => !gate.passed && gate.severity === 'warning')
        .map((gate) => gate.id),
      readinessLaneStates: previewAcceptance.validationSummary.readinessLaneStates,
      acceptancePrerequisiteIds: previewAcceptance.acceptancePrerequisites
        .filter((prerequisite) => prerequisite.required)
        .map((prerequisite) => prerequisite.id),
      unsatisfiedPrerequisiteIds: previewAcceptance.acceptancePrerequisites
        .filter((prerequisite) => prerequisite.required && !prerequisite.satisfied)
        .map((prerequisite) => prerequisite.id),
      routeRequiredClientFields: previewAcceptance.clientContract.routeDataContract.requiredClientFields,
      nextActions: previewAcceptance.nextSteps.map((step) => step.action),
      proofRef: previewAcceptance.clientContract.proofRef,
    },
    clientWorkflow: {
      schema: clientWorkflow.schema,
      requestId: clientWorkflow.request.requestId,
      clientId: clientWorkflow.request.clientId,
      command: clientWorkflow.request.command,
      state: clientWorkflow.state,
      nextPanel: clientWorkflow.nextPanel,
      handoffRequired: clientWorkflow.handoff.required,
      handoffTarget: clientWorkflow.handoff.target,
      handoffReason: clientWorkflow.handoff.reason,
      acceptedCommandCount: clientWorkflow.handoff.acceptedCommandKeys.length,
      redactedProcessCount: clientWorkflow.statePatch.redactedProcessCount,
    },
    previewRoute: {
      schema: previewRouteContract.schema,
      path: previewRouteContract.route.path,
      state: previewRouteContract.route.state,
      nextPanel: previewRouteContract.route.nextPanel,
      nextStepState: previewRouteContract.nextStep.state,
      nextStepRecommendedAction: previewRouteContract.nextStep.recommendedAction,
      nextStepRecommendedTarget: previewRouteContract.nextStep.recommendedTarget,
      nextStepBlockedReasons: previewRouteContract.nextStep.blockedReasonCodes,
      canAccept: previewRouteContract.readiness.canAccept,
      canDispatch: previewRouteContract.readiness.canDispatch,
      canExport: previewRouteContract.readiness.canExport,
      readOnly: previewRouteContract.readiness.readOnly,
      disabledReasons: previewRouteContract.readiness.disabledReasons,
      readinessLaneStates: previewRouteContract.readiness.lanes.reduce((summary, lane) => {
        summary[lane.id] = lane.state;
        return summary;
      }, {}),
      unsatisfiedPrerequisiteIds: previewRouteContract.readiness.prerequisites
        .filter((prerequisite) => prerequisite.required && !prerequisite.satisfied)
        .map((prerequisite) => prerequisite.id),
      validationBannerStatus: previewRouteContract.validationBanner.status,
      validationBannerCodes: previewRouteContract.validationBanner.codes,
      primaryActions: previewRouteContract.primaryActions.map((action) => ({
        id: action.id,
        enabled: action.enabled,
        reason: action.reason,
      })),
      proofRef: previewRouteContract.auditRefs.proofRef,
      payloadRef: previewRouteContract.auditRefs.payloadRef,
    },
    previewAcceptanceReceipt: {
      schema: previewAcceptanceReceipt.schema,
      state: previewAcceptanceReceipt.state,
      accepted: previewAcceptanceReceipt.accepted,
      submitted: previewAcceptanceReceipt.submitted,
      decision: previewAcceptanceReceipt.decision,
      routeState: previewAcceptanceReceipt.routeState,
      validationOk: previewAcceptanceReceipt.validationSummary.ok,
      validationErrorCount: previewAcceptanceReceipt.validationSummary.errorCount,
      requiredAcknowledgementCount: previewAcceptanceReceipt.validationSummary.requiredAcknowledgementCount,
      missingAcknowledgementIds: previewAcceptanceReceipt.validationSummary.missingAcknowledgementIds,
      dispatchAllowed: previewAcceptanceReceipt.commandEffect.dispatchAllowed,
      auditOnly: previewAcceptanceReceipt.commandEffect.auditOnly,
      commandCount: previewAcceptanceReceipt.commandEffect.commandKeys.length,
      nextPanel: previewAcceptanceReceipt.statePatch.nextPanel,
      receiptChecksum: previewAcceptanceReceipt.proof.receiptChecksum,
    },
    workflowHandoffPackage: {
      schema: workflowHandoffPackage.schema,
      state: workflowHandoffPackage.state,
      channel: workflowHandoffPackage.handoffChannel,
      nextPanel: workflowHandoffPackage.nextPanel,
      target: workflowHandoffPackage.routing.target,
      reason: workflowHandoffPackage.routing.reason,
      dispatchableCount: workflowHandoffPackage.commands.dispatchableCount,
      auditOnlyCount: workflowHandoffPackage.commands.auditOnlyCount,
      blockedCount: workflowHandoffPackage.commands.blockedCount,
      blockerCount: workflowHandoffPackage.blockers.count,
      pendingAcknowledgementCount: workflowHandoffPackage.blockers.pendingAcknowledgements.length,
      writeBarrier: workflowHandoffPackage.providerBridge.writeBarrier,
      outboundMessageCount: workflowHandoffPackage.providerBridge.outboundMessageCount,
      exportReportReady: workflowHandoffPackage.clientStatePatch.exportReportReady,
      proof: workflowHandoffPackage.proof,
    },
    explainableNextStep: {
      schema: explainableNextStep.schema,
      state: explainableNextStep.state,
      recommendedAction: explainableNextStep.recommended.action,
      recommendedTarget: explainableNextStep.recommended.target,
      recommendedReason: explainableNextStep.recommended.reason,
      recommendedLabel: explainableNextStep.recommended.label,
      stepCount: explainableNextStep.steps.length,
      blockedReasonCodes: explainableNextStep.readiness.blockedReasonCodes,
      dispatchableCommandCount: explainableNextStep.readiness.dispatchableCommandCount,
      auditOnlyCommandCount: explainableNextStep.readiness.auditOnlyCommandCount,
      clientPrimaryPanel: explainableNextStep.clientHint.primaryPanel,
      clientControlState: explainableNextStep.clientHint.controlState,
      proof: explainableNextStep.proof,
    },
    operationalHealth: {
      schema: operationalHealthTriage.schema,
      status: operationalHealthTriage.status,
      exitCode: operationalHealthTriage.exit.code,
      exitReason: operationalHealthTriage.exit.reason,
      dispatchBlocked: operationalHealthTriage.dispatch.blocked,
      degradedModeActive: operationalHealthTriage.degradedMode.active,
      degradedReadOnly: operationalHealthTriage.degradedMode.readOnly,
      incidentCount: operationalHealthTriage.incidentCounts.total,
      incidentCountsBySeverity: operationalHealthTriage.incidentCounts.bySeverity,
      incidentCountsByCategory: operationalHealthTriage.incidentCounts.byCategory,
      retryableIncidentCount: operationalHealthTriage.retryWindow.retryableCount,
      nextRetryNotBefore: operationalHealthTriage.retryWindow.nextNotBefore,
      nextActions: operationalHealthTriage.nextActions.map((action) => action.action),
    },
    dispatchReadiness: {
      schema: dispatchReadinessGate.schema,
      state: dispatchReadinessGate.state,
      dispatchAllowed: dispatchReadinessGate.dispatchAllowed,
      auditOnly: dispatchReadinessGate.auditOnly,
      readOnly: dispatchReadinessGate.readOnly,
      blocked: dispatchReadinessGate.blocked,
      blockedBy: dispatchReadinessGate.blockedBy,
      acceptedCommandCount: dispatchReadinessGate.commandQueue.acceptedCount,
      blockedCommandCount: dispatchReadinessGate.commandQueue.blockedCount,
      replayPolicy: dispatchReadinessGate.commandQueue.replayPolicy,
      retryBackoffEnabled: dispatchReadinessGate.retryBackoff.enabled,
      retryBackoffPaused: dispatchReadinessGate.retryBackoff.autoRetryPaused,
      retryBackoffPausedControls: dispatchReadinessGate.retryBackoff.pausedControls,
      activeMaintenanceWindowCount: dispatchReadinessGate.retryBackoff.activeMaintenanceWindowCount,
      maxConcurrentLifecycleActions: dispatchReadinessGate.retryBackoff.maxConcurrentActions,
      scheduledRetryCount: dispatchReadinessGate.retryBackoff.scheduledCount,
      nextRetryNotBefore: dispatchReadinessGate.retryBackoff.nextNotBefore,
      actionableErrorCount: dispatchReadinessGate.actionableErrors.length,
      nextOperatorCommand: dispatchReadinessGate.nextOperatorCommand,
      proof: dispatchReadinessGate.proof,
    },
    hostedKernelDispatch: {
      schema: hostedKernelDispatchEnvelope.schema,
      state: hostedKernelDispatchEnvelope.state,
      batchKey: hostedKernelDispatchEnvelope.batchKey,
      replayPolicy: hostedKernelDispatchEnvelope.replayPolicy,
      commandCount: hostedKernelDispatchEnvelope.commands.length,
      dispatchableCount: hostedKernelDispatchEnvelope.dispatchableCount,
      auditOnlyCount: hostedKernelDispatchEnvelope.auditOnlyCount,
      blockedCount: hostedKernelDispatchEnvelope.blockedCount,
      commandKinds: hostedKernelDispatchEnvelope.commands.reduce((summary, command) => {
        summary[command.kind] = (summary[command.kind] || 0) + 1;
        return summary;
      }, {}),
      blockedReasons: hostedKernelDispatchEnvelope.blocked.reduce((summary, command) => {
        summary[command.reason] = (summary[command.reason] || 0) + 1;
        return summary;
      }, {}),
      proof: hostedKernelDispatchEnvelope.proof,
    },
    providerSyncCheckpoint: {
      schema: providerSyncCheckpoint.schema,
      state: providerSyncCheckpoint.state,
      providerReady: providerSyncCheckpoint.providerReady,
      snapshotAccepted: providerSyncCheckpoint.snapshotAccepted,
      requiresRefresh: providerSyncCheckpoint.requiresRefresh,
      writeBarrier: providerSyncCheckpoint.writeBarrier,
      handoffReady: providerSyncCheckpoint.handoffReady,
      outboundMessageCount: providerSyncCheckpoint.outboundMessages.length,
      inboundRequirements: providerSyncCheckpoint.inboundRequirements.map((requirement) => ({
        name: requirement.name,
        operation: requirement.operation,
        satisfied: requirement.satisfied,
        freshness: requirement.freshness,
      })),
      externalHandoffMode: providerSyncCheckpoint.externalHandoff.mode,
      dispatchBridge: providerSyncCheckpoint.dispatchBridge,
      proof: providerSyncCheckpoint.proof,
    },
    analyticsExport: {
      schema: analyticsExportState.schema,
      ready: analyticsExportState.exportReady,
      mode: analyticsExportState.exportMode,
      reason: analyticsExportState.reason,
      summaryRows: analyticsExportState.rows.summaryRows.length,
      processRows: analyticsExportState.rows.processRows.length,
      attentionRows: analyticsExportState.rows.attentionRows.length,
      historyRows: analyticsExportState.rows.historyRows.length,
      incidentRows: analyticsExportState.rows.incidentRows.length,
      attentionProcessCount: analyticsExportState.counters.attentionProcessCount,
      blockingIncidentCount: analyticsExportState.counters.blockingIncidentCount,
      manifest: analyticsExportState.manifest.map((artifact) => ({
        name: artifact.name,
        schema: artifact.schema,
        format: artifact.format,
        rowCount: artifact.rowCount,
      })),
      proof: analyticsExportState.proof,
    },
    analyticsExportReport: {
      schema: analyticsExportReport.schema,
      ready: analyticsExportReport.ready,
      mode: analyticsExportReport.mode,
      selectedArtifactCount: analyticsExportReport.selectedArtifactCount,
      blockedReasons: analyticsExportReport.blockedReasons,
      requestedArtifacts: analyticsExportReport.request.requestedArtifacts,
      requestedChannels: analyticsExportReport.request.requestedChannels,
      retentionLimit: analyticsExportReport.retention.limit,
      retainedSnapshotCount: analyticsExportReport.retention.retainedCount,
      deliveryChannels: analyticsExportReport.deliveryChannels.map((channel) => ({
        channel: channel.channel,
        enabled: channel.enabled,
        mode: channel.mode,
        reason: channel.reason,
      })),
      artifacts: analyticsExportReport.artifactReports.map((artifact) => ({
        name: artifact.name,
        selected: artifact.selected,
        format: artifact.format,
        rowCount: artifact.rowCount,
        checksum: artifact.checksum,
        blockedReason: artifact.blockedReason,
      })),
      proof: analyticsExportReport.proof,
    },
    scope: {
      tenantId: scopedProcessView.tenantId,
      workspaceId: scopedProcessView.workspaceId,
      visibleCount: scopedProcessView.visibleCount,
      deniedCount: scopedProcessView.deniedCount,
      deniedByReason: scopedProcessView.deniedByReason,
      boundary: scopedProcessView.proof.boundary,
    },
    csvColumns: [
      'capturedAt',
      'status',
      'total',
      'healthy',
      'degraded',
      'failed',
      'totalRestarts',
      'retryBudgetRemaining',
      'attentionCount',
      'providerNegotiation',
      'providerServiceContractState',
      'providerBlockedRequiredOperations',
      'syncConsistency',
      'handoffRequired',
      'restartStatus',
      'restartReconciliationState',
      'restartReconciliationReplayBlocked',
      'restartReconciliationOrphaned',
      'pendingRecoveryCount',
      'operatorActionRequests',
      'operatorActionsAccepted',
      'operatorActionsBlocked',
      'lifecycleControlRequests',
      'lifecycleControlsAccepted',
      'lifecycleControlsBlocked',
      'lifecycleControlsDispatchReady',
      'autoRetryEnabled',
      'lifecycleNextActionState',
      'lifecycleNextOperatorAction',
      'lifecycleImmediateChanges',
      'lifecycleScheduledChanges',
      'lifecycleBlockedChanges',
      'lifecycleRemainingSlots',
      'previewAcceptanceState',
      'previewReady',
      'previewDispatchReady',
      'previewValidationErrors',
      'clientRequestId',
      'clientWorkflowState',
      'clientNextPanel',
      'clientHandoffRequired',
      'clientAcceptedCommandCount',
      'previewRouteState',
      'previewRouteCanAccept',
      'previewRouteCanDispatch',
      'previewRouteReadOnly',
      'previewRouteDisabledReasons',
      'previewRouteValidationBanner',
      'previewReceiptState',
      'previewReceiptAccepted',
      'previewReceiptValidationErrors',
      'previewReceiptMissingAcks',
      'previewReceiptCommandCount',
      'workflowHandoffState',
      'workflowHandoffChannel',
      'workflowHandoffNextPanel',
      'workflowHandoffBlockers',
      'workflowHandoffWriteBarrier',
      'nextStepState',
      'nextStepRecommendedAction',
      'nextStepRecommendedTarget',
      'nextStepBlockedReasons',
      'operationalHealthStatus',
      'operationalExitCode',
      'operationalDispatchBlocked',
      'operationalIncidentCount',
      'operationalRetryableIncidentCount',
      'operationalNextRetryNotBefore',
      'dispatchReadinessState',
      'dispatchReadinessAllowed',
      'dispatchReadinessReadOnly',
      'dispatchReadinessBlockedBy',
      'dispatchAcceptedCommandCount',
      'dispatchBlockedCommandCount',
      'dispatchScheduledRetryCount',
      'dispatchActionableErrorCount',
      'dispatchNextOperatorCommand',
      'hostedDispatchState',
      'hostedDispatchCommandCount',
      'hostedDispatchReadyCount',
      'hostedDispatchAuditOnlyCount',
      'hostedDispatchBlockedCount',
      'providerSyncCheckpointState',
      'providerSyncSnapshotAccepted',
      'providerSyncWriteBarrier',
      'providerSyncOutboundMessages',
      'providerSyncHandoffReady',
      'analyticsExportReady',
      'analyticsExportMode',
      'analyticsExportSummaryRows',
      'analyticsExportProcessRows',
      'analyticsExportAttentionRows',
      'analyticsExportIncidentRows',
      'analyticsExportReportReady',
      'analyticsExportReportMode',
      'analyticsExportReportBlockedReasons',
      'analyticsExportSelectedArtifacts',
      'analyticsExportDeliveryChannels',
      'scopeTenant',
      'scopeWorkspace',
      'scopeVisibleCount',
      'scopeDeniedCount',
      'trendMovement',
      'attentionDelta',
      'timelineEvents',
    ],
    csvRow: [
      generatedAt,
      health.mode,
      health.counts.total,
      health.counts.healthy,
      health.counts.degraded,
      health.counts.failed,
      analytics.counters.totalRestarts,
      analytics.counters.retryBudgetRemaining,
      reporting.attentionCount,
      negotiation.status,
      providerServiceContracts.state,
      providerServiceContracts.blockedRequiredCount,
      syncMetadata.consistency,
      handoff.required,
      restartStatus.status,
      restartReconciliation.state,
      restartReconciliation.counts.replayBlocked,
      restartReconciliation.counts.orphaned,
      restartStatus.pendingRecoveryCount,
      operatorActionContracts.requestedCount,
      operatorActionContracts.acceptedCount,
      operatorActionContracts.blockedCount,
      lifecycleControlContracts.requestedCount,
      lifecycleControlContracts.acceptedCount,
      lifecycleControlContracts.blockedCount,
      lifecycleControlContracts.dispatch.ready,
      lifecycleControlContracts.settings.controls['auto-retry'],
      lifecycleNextActionState.state,
      lifecycleNextActionState.nextOperatorAction.action,
      lifecycleNextActionState.immediateChangeCount,
      lifecycleNextActionState.scheduledChangeCount,
      lifecycleNextActionState.blockedChanges.length,
      lifecycleNextActionState.concurrency.remainingSlots,
      previewAcceptance.acceptanceState,
      previewAcceptance.ready,
      previewAcceptance.dispatchReady,
      previewAcceptance.validationSummary.errorCount,
      clientWorkflow.request.requestId,
      clientWorkflow.state,
      clientWorkflow.nextPanel,
      clientWorkflow.handoff.required,
      clientWorkflow.handoff.acceptedCommandKeys.length,
      previewRouteContract.route.state,
      previewRouteContract.readiness.canAccept,
      previewRouteContract.readiness.canDispatch,
      previewRouteContract.readiness.readOnly,
      previewRouteContract.readiness.disabledReasons.join('|'),
      previewRouteContract.validationBanner.status,
      previewAcceptanceReceipt.state,
      previewAcceptanceReceipt.accepted,
      previewAcceptanceReceipt.validationSummary.errorCount,
      previewAcceptanceReceipt.validationSummary.missingAcknowledgementIds.join('|'),
      previewAcceptanceReceipt.commandEffect.commandKeys.length,
      workflowHandoffPackage.state,
      workflowHandoffPackage.handoffChannel,
      workflowHandoffPackage.nextPanel,
      workflowHandoffPackage.blockers.reasons.join('|'),
      workflowHandoffPackage.providerBridge.writeBarrier,
      explainableNextStep.state,
      explainableNextStep.recommended.action,
      explainableNextStep.recommended.target,
      explainableNextStep.readiness.blockedReasonCodes.join('|'),
      operationalHealthTriage.status,
      operationalHealthTriage.exit.code,
      operationalHealthTriage.dispatch.blocked,
      operationalHealthTriage.incidentCounts.total,
      operationalHealthTriage.retryWindow.retryableCount,
      operationalHealthTriage.retryWindow.nextNotBefore,
      dispatchReadinessGate.state,
      dispatchReadinessGate.dispatchAllowed,
      dispatchReadinessGate.readOnly,
      dispatchReadinessGate.blockedBy.join('|'),
      dispatchReadinessGate.commandQueue.acceptedCount,
      dispatchReadinessGate.commandQueue.blockedCount,
      dispatchReadinessGate.retryBackoff.scheduledCount,
      dispatchReadinessGate.actionableErrors.length,
      dispatchReadinessGate.nextOperatorCommand,
      hostedKernelDispatchEnvelope.state,
      hostedKernelDispatchEnvelope.commands.length,
      hostedKernelDispatchEnvelope.dispatchableCount,
      hostedKernelDispatchEnvelope.auditOnlyCount,
      hostedKernelDispatchEnvelope.blockedCount,
      providerSyncCheckpoint.state,
      providerSyncCheckpoint.snapshotAccepted,
      providerSyncCheckpoint.writeBarrier,
      providerSyncCheckpoint.outboundMessages.length,
      providerSyncCheckpoint.handoffReady,
      analyticsExportState.exportReady,
      analyticsExportState.exportMode,
      analyticsExportState.rows.summaryRows.length,
      analyticsExportState.rows.processRows.length,
      analyticsExportState.rows.attentionRows.length,
      analyticsExportState.rows.incidentRows.length,
      analyticsExportReport.ready,
      analyticsExportReport.mode,
      analyticsExportReport.blockedReasons.join('|'),
      analyticsExportReport.artifactReports
        .filter((artifact) => artifact.selected)
        .map((artifact) => artifact.name)
        .join('|'),
      analyticsExportReport.deliveryChannels
        .filter((channel) => channel.enabled)
        .map((channel) => channel.channel)
        .join('|'),
      scopedProcessView.tenantId,
      scopedProcessView.workspaceId,
      scopedProcessView.visibleCount,
      scopedProcessView.deniedCount,
      analyticsTrend.movement,
      analyticsTrend.attentionDelta,
      timelineReport.eventCount,
    ],
    historyRows: timelineReport.events.map((event) => ({
      capturedAt: event.capturedAt,
      mode: event.mode,
      eventType: event.eventType,
      total: event.total,
      healthy: event.healthy,
      degraded: event.degraded,
      failed: event.failed,
      attentionCount: event.attentionCount,
      attentionDelta: event.attentionDelta,
      restartDelta: event.restartDelta,
      cursor: syncMetadata.cursor,
      tenantId: scopedProcessView.tenantId,
      workspaceId: scopedProcessView.workspaceId,
    })),
    artifacts: [
      {
        format: 'csv',
        contract: 'cli-ps-summary-row',
        rowCount: 1,
        columns: 'csvColumns',
      },
      {
        format: 'jsonl',
        contract: timelineReport.schema,
        rowCount: timelineReport.eventCount,
        source: 'historyRows',
      },
      ...analyticsExportState.manifest.map((artifact) => ({
        format: artifact.format,
        contract: artifact.schema,
        rowCount: artifact.rowCount,
        source: `analyticsExportState.rows.${
          artifact.name === 'summary'
            ? 'summaryRows'
            : artifact.name === 'processes'
            ? 'processRows'
            : artifact.name === 'incidents'
              ? 'incidentRows'
              : 'historyRows'
        }`,
      })),
    ],
  };
}

export function describeCliPsSurface(input = {}) {
  const generatedAt = isoNow(input);
  const retryPolicy = normalizeRetryPolicy(input);
  const scopePolicy = normalizeScopePolicy(input);
  const clientRequest = normalizeClientRequest(input, generatedAt);
  const analyticsExportRequest = normalizeAnalyticsExportRequest(input);
  const rawProcesses = asArray(input.processes).filter((process) => process && typeof process === 'object');
  const baseValidation = mergeValidation(
    buildValidation(input, asArray(input.processes)),
    clientRequest.validation,
    analyticsExportRequest.validation,
  );
  const providerContract = normalizeProviderContract(input);
  const providerServiceContracts = buildProviderServiceContracts(providerContract, baseValidation);
  const validation = mergeValidation(
    baseValidation,
    providerServiceContracts.validation,
  );
  const scopedRawProcesses = rawProcesses
    .map((process, index) => normalizeProcess(process, index, retryPolicy, generatedAt, scopePolicy));
  const scopedProcesses = scopedRawProcesses
    .map((process) => applyScopeToProcess(process, scopePolicy));
  const scopedProcessView = buildScopedProcessView(scopedProcesses, scopePolicy, generatedAt);
  const processes = scopedProcesses
    .filter((process) => process.visible)
    .map((process) => ({
      ...process,
      visible: true,
      deniedReasons: [],
    }));
  const health = summarizeHealth(processes, validation);
  const analytics = buildAnalytics(processes, health);
  const history = buildHistory(input, generatedAt, health, analytics);
  const analyticsTrend = buildAnalyticsTrend(history, analytics);
  const capabilityNegotiation = buildCapabilityNegotiation(providerContract, validation);
  const syncMetadata = buildSyncMetadata(
    input,
    generatedAt,
    providerContract,
    capabilityNegotiation,
    providerServiceContracts,
    health,
  );
  const timelineReport = buildTimelineReport(
    history,
    analyticsTrend,
    generatedAt,
    syncMetadata,
    scopedProcessView,
  );
  const reporting = buildReportingState(health, analytics, analyticsTrend);
  const externalHandoff = buildExternalHandoffState(
    processes,
    health,
    reporting,
    capabilityNegotiation,
    providerServiceContracts,
    syncMetadata,
    scopedProcessView,
  );
  const persistedState = normalizePersistedState(input, generatedAt);
  const persistenceProjection = buildPersistenceProjection(processes, persistedState, generatedAt, syncMetadata);
  const lifecycleSettings = normalizeLifecycleSettings(input, retryPolicy, generatedAt);
  const recoveryPlan = buildRecoveryPlan(
    processes,
    persistenceProjection,
    retryPolicy,
    generatedAt,
    lifecycleSettings,
  );
  const restartReconciliation = buildRestartReconciliationState({
    processes,
    persistedState,
    persistenceProjection,
    recoveryPlan,
    syncMetadata,
    generatedAt,
  });
  const restartStatus = buildRestartStatus(
    health,
    syncMetadata,
    persistenceProjection,
    recoveryPlan,
    restartReconciliation,
  );
  const idempotentCommands = buildIdempotentCommandEnvelope(
    processes,
    recoveryPlan,
    restartStatus,
    syncMetadata,
    restartReconciliation,
  );
  const operatorActionContracts = buildOperatorActionContracts(
    input,
    processes,
    scopedProcessView,
    syncMetadata,
    restartStatus,
  );
  const lifecycleControlContracts = buildLifecycleControlContracts(
    input,
    lifecycleSettings,
    processes,
    scopedProcessView,
    syncMetadata,
    capabilityNegotiation,
    restartStatus,
  );
  const lifecycleNextActionState = buildLifecycleNextActionState(
    generatedAt,
    lifecycleSettings,
    lifecycleControlContracts,
    recoveryPlan,
    restartStatus,
    syncMetadata,
  );
  const previewAcceptance = buildPreviewAcceptanceContract({
    generatedAt,
    validation,
    lifecycleSettings,
    processes,
    health,
    reporting,
    capabilityNegotiation,
    providerServiceContracts,
    syncMetadata,
    restartStatus,
    recoveryPlan,
    scopedProcessView,
    operatorActionContracts,
    lifecycleControlContracts,
  });
  const clientWorkflow = buildClientWorkflowState(
    clientRequest,
    previewAcceptance,
    externalHandoff,
    operatorActionContracts,
    lifecycleControlContracts,
    syncMetadata,
    scopedProcessView,
  );
  const operationalHealthTriage = buildOperationalHealthTriage({
    generatedAt,
    processes,
    validation,
    lifecycleSettings,
    capabilityNegotiation,
    providerServiceContracts,
    syncMetadata,
    persistenceProjection,
    recoveryPlan,
    restartStatus,
    externalHandoff,
    scopedProcessView,
    previewAcceptance,
  });
  const processTablePresentation = buildProcessTablePresentation({
    generatedAt,
    processes,
    scopedProcessView,
    syncMetadata,
    operationalHealthTriage,
    restartStatus,
    recoveryPlan,
    lifecycleSettings,
    scopePolicy,
    externalHandoff,
    providerServiceContracts,
    restartReconciliation,
  });
  const inspectPanel = buildInspectPanelContract({
    generatedAt,
    clientRequest,
    processes,
    scopedProcessView,
    processTablePresentation,
    operationalHealthTriage,
    syncMetadata,
    restartStatus,
  });
  const dispatchReadinessGate = buildDispatchReadinessGate({
    generatedAt,
    clientRequest,
    operationalHealthTriage,
    previewAcceptance,
    clientWorkflow,
    operatorActionContracts,
    lifecycleControlContracts,
    recoveryPlan,
    syncMetadata,
    lifecycleSettings,
  });
  const hostedKernelDispatchEnvelope = buildHostedKernelDispatchEnvelope({
    generatedAt,
    clientRequest,
    syncMetadata,
    dispatchReadinessGate,
    operatorActionContracts,
    lifecycleControlContracts,
    providerServiceContracts,
  });
  const providerSyncCheckpoint = buildProviderSyncCheckpoint({
    generatedAt,
    clientRequest,
    providerContract,
    providerServiceContracts,
    capabilityNegotiation,
    syncMetadata,
    externalHandoff,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
  });
  const explainableNextStep = buildExplainableNextStepContract({
    generatedAt,
    clientRequest,
    previewAcceptance,
    operationalHealthTriage,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
    syncMetadata,
    scopedProcessView,
  });
  const previewRouteContract = buildPreviewRouteContract({
    clientRequest,
    previewAcceptance,
    clientWorkflow,
    explainableNextStep,
    operationalHealthTriage,
    syncMetadata,
    scopedProcessView,
    analyticsTrend,
  });
  const previewAcceptanceReceipt = buildPreviewAcceptanceReceiptContract({
    input,
    generatedAt,
    clientRequest,
    previewAcceptance,
    previewRouteContract,
    explainableNextStep,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
    providerSyncCheckpoint,
  });
  const analyticsExportState = buildAnalyticsExportState({
    generatedAt,
    processes,
    analytics,
    analyticsTrend,
    timelineReport,
    syncMetadata,
    scopedProcessView,
    operationalHealthTriage,
    processTablePresentation,
  });
  const analyticsExportReport = buildAnalyticsExportReport({
    generatedAt,
    analyticsExportRequest,
    analyticsExportState,
    history,
    timelineReport,
    operationalHealthTriage,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
  });
  const workflowHandoffPackage = buildWorkflowHandoffPackage({
    generatedAt,
    clientRequest,
    clientWorkflow,
    previewRouteContract,
    previewAcceptanceReceipt,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
    providerSyncCheckpoint,
    operationalHealthTriage,
    externalHandoff,
    analyticsExportReport,
    scopedProcessView,
  });
  const exportSummary = buildExportSummary(
    generatedAt,
    health,
    analytics,
    analyticsTrend,
    timelineReport,
    reporting,
    capabilityNegotiation,
    providerServiceContracts,
    syncMetadata,
    externalHandoff,
    restartStatus,
    restartReconciliation,
    scopedProcessView,
    operatorActionContracts,
    lifecycleControlContracts,
    lifecycleNextActionState,
    previewAcceptance,
    clientWorkflow,
    previewRouteContract,
    operationalHealthTriage,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
    explainableNextStep,
    providerSyncCheckpoint,
    previewAcceptanceReceipt,
    workflowHandoffPackage,
    analyticsExportState,
    analyticsExportReport,
  );
  const actionableErrors = [
    ...buildActionableErrors(processes, validation),
    ...lifecycleSettings.validation.errors,
  ];
  const evidence = asArray(input.evidence);

  return {
    ok: validation.ok && lifecycleSettings.validation.ok && !health.failureState,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel cli-ps process health snapshot/v1',
    clientRequest,
    health,
    retryPolicy,
    validation,
    processes,
    processTablePresentation,
    inspectPanel,
    analytics,
    analyticsTrend,
    history,
    timelineReport,
    reporting,
    providerContract,
    providerServiceContracts,
    capabilityNegotiation,
    scopePolicy,
    scopedProcessView,
    syncMetadata,
    externalHandoff,
    persistedState,
    persistenceProjection,
    recoveryPlan,
    restartReconciliation,
    restartStatus,
    idempotentCommands,
    operatorActionContracts,
    lifecycleSettings,
    lifecycleControlContracts,
    lifecycleNextActionState,
    previewAcceptance,
    clientWorkflow,
    previewRouteContract,
    previewAcceptanceReceipt,
    operationalHealthTriage,
    dispatchReadinessGate,
    hostedKernelDispatchEnvelope,
    providerSyncCheckpoint,
    explainableNextStep,
    workflowHandoffPackage,
    analyticsExportState,
    analyticsExportReport,
    exportSummary,
    actionableErrors,
    audit: {
      proofType: 'cli-ps-health-snapshot',
      source: cleanString(input.source, 'operator-userland.cli-ps'),
      evidenceCount: evidence.length,
      processCount: processes.length,
      degradedMode: health.degradedMode,
      failureState: health.failureState,
      exportSchema: exportSummary.schema,
      historySnapshots: history.snapshots.length,
      timelineEvents: timelineReport.eventCount,
      timelineState: timelineReport.state,
      analyticsTrend: analyticsTrend.movement,
      attentionDelta: analyticsTrend.attentionDelta,
      attentionCount: reporting.attentionCount,
      providerId: providerContract.providerId,
      providerNegotiation: capabilityNegotiation.status,
      missingProviderCapabilities: capabilityNegotiation.missingRequired,
      providerServiceContractState: providerServiceContracts.state,
      providerServiceAcceptedRequiredOperations: providerServiceContracts.acceptedRequiredCount,
      providerServiceBlockedRequiredOperations: providerServiceContracts.blockedRequiredCount,
      providerServiceAcceptedOptionalOperations: providerServiceContracts.acceptedOptionalCount,
      providerServiceWritableAuditSink: providerServiceContracts.writableAuditSink,
      providerServiceSupervisorHandoffSink: Boolean(providerServiceContracts.supervisorHandoffSink),
      providerServiceBlockedReasons: providerServiceContracts.blockedReasons,
      providerServiceOperationChecksum: providerServiceContracts.proof.operationChecksum,
      syncCursor: syncMetadata.cursor,
      syncStale: syncMetadata.stale,
      handoffRequired: externalHandoff.required,
      handoffReason: externalHandoff.reason,
      persistedStateLoaded: persistedState.loaded,
      persistedGeneration: persistenceProjection.generation,
      persistedWriteMode: persistenceProjection.writeMode,
      persistedIntegrityOk: persistenceProjection.stateIntegrity.ok,
      persistedIntegrityBlockingReasons: persistenceProjection.stateIntegrity.blockingReasonCount,
      persistedIntegrityBlockingCodes: persistenceProjection.stateIntegrity.blockingReasons
        .map((reason) => reason.code),
      persistedJournalChecksum: persistenceProjection.stateIntegrity.proof.journalChecksum,
      persistedJournalDuplicateKeys: persistedState.commandJournalIntegrity.duplicateKeyCount,
      persistedJournalConflictingKeys: persistedState.commandJournalIntegrity.conflictingKeyCount,
      persistedJournalUnsafeEntries: persistedState.commandJournalIntegrity.unsafeEntryCount,
      persistedJournalStaleTargets: persistenceProjection.stateIntegrity.staleJournalTargetCount,
      restartStatus: restartStatus.status,
      restartSafe: restartStatus.restartSafe,
      restartDecision: restartStatus.restartDecision,
      restartReconciliationState: restartReconciliation.state,
      restartReconciliationReplayBlocked: restartReconciliation.counts.replayBlocked,
      restartReconciliationOrphaned: restartReconciliation.counts.orphaned,
      restartReconciliationWithRecoveryAction: restartReconciliation.counts.withRecoveryAction,
      restartReconciliationNextOperatorAction: restartReconciliation.nextOperatorAction,
      restartReconciliationChecksum: restartReconciliation.proof.rowChecksum,
      recoveryPendingCount: recoveryPlan.pendingCount,
      recoveryEffectivePendingCount: recoveryPlan.dispatchablePendingCount,
      recoverySuppressedReplayCount: recoveryPlan.suppressedReplayCount,
      persistedCommandJournalCount: persistedState.commandJournalSummary.recordedCount,
      persistedReplaySafeCommandCount: persistedState.commandJournalSummary.replaySafeCount,
      idempotentCommandCount: idempotentCommands.commandCount,
      idempotentDispatchEligibleCount: idempotentCommands.dispatchEligibleCount,
      idempotentSuppressedReplayCount: idempotentCommands.suppressedReplayCount,
      operatorActionRequests: operatorActionContracts.requestedCount,
      operatorActionsAccepted: operatorActionContracts.acceptedCount,
      operatorActionsBlocked: operatorActionContracts.blockedCount,
      operatorActionDispatchReady: operatorActionContracts.dispatch.ready,
      operatorActionBoundaryDecisionChecksum: operatorActionContracts.proof.boundaryDecisionChecksum,
      operatorActionBoundaryDeniedCount: operatorActionContracts.contracts
        .filter((contract) => contract.boundaryDecision?.blocksDispatch).length,
      operatorActionBoundaryDeniedReasons: operatorActionContracts.contracts
        .filter((contract) => contract.boundaryDecision?.blocksDispatch)
        .map((contract) => contract.boundaryDecision.reason),
      lifecycleSettingsValid: lifecycleSettings.validation.ok,
      lifecycleAutoRetryEnabled: lifecycleSettings.controls['auto-retry'],
      lifecycleQuietUntil: lifecycleSettings.schedule.quietUntil,
      lifecycleActiveMaintenanceWindowCount: lifecycleSettings.schedule.activeWindowCount,
      lifecyclePausedControls: lifecycleSettings.schedule.pausedControls,
      lifecycleAutoRetryPaused: lifecycleSettings.schedule.autoRetryPaused,
      lifecycleMaxConcurrentActions: lifecycleSettings.schedule.maxConcurrentActions,
      lifecycleControlRequests: lifecycleControlContracts.requestedCount,
      lifecycleControlsAccepted: lifecycleControlContracts.acceptedCount,
      lifecycleControlsBlocked: lifecycleControlContracts.blockedCount,
      lifecycleControlDispatchReady: lifecycleControlContracts.dispatch.ready,
      lifecycleControlBoundaryDecisionChecksum: lifecycleControlContracts.proof.boundaryDecisionChecksum,
      lifecycleControlBoundaryDeniedCount: lifecycleControlContracts.contracts
        .filter((contract) => contract.boundaryDecision?.blocksDispatch).length,
      lifecycleControlBoundaryDeniedReasons: lifecycleControlContracts.contracts
        .filter((contract) => contract.boundaryDecision?.blocksDispatch)
        .map((contract) => contract.boundaryDecision.reason),
      lifecycleNextAction: lifecycleControlContracts.nextAction,
      lifecycleNextActionState: lifecycleNextActionState.state,
      lifecycleNextOperatorAction: lifecycleNextActionState.nextOperatorAction.action,
      lifecycleNextOperatorTarget: lifecycleNextActionState.nextOperatorAction.target,
      lifecycleImmediateChanges: lifecycleNextActionState.immediateChangeCount,
      lifecycleImmediateDispatchableChanges: lifecycleNextActionState.immediateDispatchableCount,
      lifecycleScheduledChanges: lifecycleNextActionState.scheduledChangeCount,
      lifecycleScheduledDueChanges: lifecycleNextActionState.scheduledDueCount,
      lifecycleBlockedChanges: lifecycleNextActionState.blockedChanges.length,
      lifecycleNoOpChanges: lifecycleNextActionState.noOpCount,
      lifecycleQuietModeActive: lifecycleNextActionState.quietMode.active,
      lifecycleRemainingActionSlots: lifecycleNextActionState.concurrency.remainingSlots,
      lifecycleEffectiveControlsChecksum: lifecycleNextActionState.proof.effectiveControlsChecksum,
      previewAcceptanceState: previewAcceptance.acceptanceState,
      previewReady: previewAcceptance.ready,
      previewDispatchReady: previewAcceptance.dispatchReady,
      previewValidationErrors: previewAcceptance.validationSummary.errorCount,
      previewNextActions: previewAcceptance.nextSteps.map((step) => step.action),
      previewProofRef: previewAcceptance.clientContract.proofRef,
      clientRequestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      clientCommand: clientRequest.command,
      clientWorkflowState: clientWorkflow.state,
      clientNextPanel: clientWorkflow.nextPanel,
      clientHandoffRequired: clientWorkflow.handoff.required,
      clientHandoffTarget: clientWorkflow.handoff.target,
      clientHandoffReason: clientWorkflow.handoff.reason,
      clientAcceptedCommandCount: clientWorkflow.handoff.acceptedCommandKeys.length,
      clientWorkflowPayloadRef: clientWorkflow.handoff.payloadRef,
      previewRouteState: previewRouteContract.route.state,
      previewRouteNextPanel: previewRouteContract.route.nextPanel,
      previewRouteCanAccept: previewRouteContract.readiness.canAccept,
      previewRouteCanDispatch: previewRouteContract.readiness.canDispatch,
      previewRouteCanExport: previewRouteContract.readiness.canExport,
      previewRouteReadOnly: previewRouteContract.readiness.readOnly,
      previewRouteDisabledReasons: previewRouteContract.readiness.disabledReasons,
      previewRouteValidationBanner: previewRouteContract.validationBanner.status,
      previewReceiptState: previewAcceptanceReceipt.state,
      previewReceiptAccepted: previewAcceptanceReceipt.accepted,
      previewReceiptSubmitted: previewAcceptanceReceipt.submitted,
      previewReceiptValidationErrors: previewAcceptanceReceipt.validationSummary.errorCount,
      previewReceiptMissingAcknowledgements: previewAcceptanceReceipt.validationSummary.missingAcknowledgementIds,
      previewReceiptCommandCount: previewAcceptanceReceipt.commandEffect.commandKeys.length,
      previewReceiptChecksum: previewAcceptanceReceipt.proof.receiptChecksum,
      workflowHandoffState: workflowHandoffPackage.state,
      workflowHandoffChannel: workflowHandoffPackage.handoffChannel,
      workflowHandoffNextPanel: workflowHandoffPackage.nextPanel,
      workflowHandoffTarget: workflowHandoffPackage.routing.target,
      workflowHandoffReason: workflowHandoffPackage.routing.reason,
      workflowHandoffDispatchableCount: workflowHandoffPackage.commands.dispatchableCount,
      workflowHandoffAuditOnlyCount: workflowHandoffPackage.commands.auditOnlyCount,
      workflowHandoffBlockedCount: workflowHandoffPackage.commands.blockedCount,
      workflowHandoffBlockers: workflowHandoffPackage.blockers.reasons,
      workflowHandoffPendingAcknowledgements: workflowHandoffPackage.blockers.pendingAcknowledgements,
      workflowHandoffWriteBarrier: workflowHandoffPackage.providerBridge.writeBarrier,
      workflowHandoffStatePatchChecksum: workflowHandoffPackage.proof.statePatchChecksum,
      explainableNextStepState: explainableNextStep.state,
      explainableNextStepAction: explainableNextStep.recommended.action,
      explainableNextStepTarget: explainableNextStep.recommended.target,
      explainableNextStepReason: explainableNextStep.recommended.reason,
      explainableNextStepBlockedReasons: explainableNextStep.readiness.blockedReasonCodes,
      explainableNextStepPanel: explainableNextStep.clientHint.primaryPanel,
      previewRoutePrimaryActions: previewRouteContract.primaryActions.map((action) => ({
        id: action.id,
        enabled: action.enabled,
        reason: action.reason,
      })),
      operationalHealthStatus: operationalHealthTriage.status,
      operationalExitCode: operationalHealthTriage.exit.code,
      operationalExitReason: operationalHealthTriage.exit.reason,
      operationalDispatchBlocked: operationalHealthTriage.dispatch.blocked,
      operationalDispatchBlockReason: operationalHealthTriage.dispatch.reason,
      operationalDegradedModeActive: operationalHealthTriage.degradedMode.active,
      operationalReadOnlyMode: operationalHealthTriage.degradedMode.readOnly,
      operationalIncidentCount: operationalHealthTriage.incidentCounts.total,
      operationalCriticalIncidents: operationalHealthTriage.incidentCounts.bySeverity.critical || 0,
      operationalWarningIncidents: operationalHealthTriage.incidentCounts.bySeverity.warning || 0,
      operationalRetryableIncidentCount: operationalHealthTriage.retryWindow.retryableCount,
      operationalNextRetryNotBefore: operationalHealthTriage.retryWindow.nextNotBefore,
      processTableRowCount: processTablePresentation.rowCount,
      processTableAttentionRows: processTablePresentation.attentionRowCount,
      processTableLeaseExpiredCount: processTablePresentation.contracts.leaseSummary.expiredCount,
      processTableExitContractViolations: processTablePresentation.contracts.exitSummary.violatedCount,
      processTableHandoffRequestedCount: processTablePresentation.contracts.handoffSummary.requestedCount,
      processTableHandoffProviderReadyCount: processTablePresentation.contracts.handoffSummary.providerReadyCount,
      processTableHandoffBlockedAutomaticCount: processTablePresentation.contracts.handoffSummary.blockedAutomaticCount,
      processTableHandoffStates: processTablePresentation.contracts.handoffSummary.byState,
      processTableRestartReconciliationState: processTablePresentation.contracts.restartReconciliationSummary.state,
      processTableRestartReconciliationReplayBlocked: processTablePresentation.contracts.restartReconciliationSummary.replayBlocked,
      processTableRestartReconciliationOrphaned: processTablePresentation.contracts.restartReconciliationSummary.orphaned,
      processTableAuthorityStates: processTablePresentation.contracts.authoritySummary.byState,
      processTableAuthorityBoundaryModes: processTablePresentation.contracts.authoritySummary.byBoundaryMode,
      processTableDelegatedVisibleCount: processTablePresentation.contracts.authoritySummary.delegatedVisibleCount,
      processTableAuthorityActionGuards: processTablePresentation.contracts.authoritySummary.actionGuards,
      processTableChecksum: processTablePresentation.proof.rowChecksum,
      inspectPanelState: inspectPanel.state,
      inspectRequestedPid: inspectPanel.requestedPid,
      inspectIncidentCount: inspectPanel.incidents.length,
      inspectReadOnly: inspectPanel.controls.readOnly,
      inspectCanRestart: inspectPanel.controls.canRestart,
      inspectCanKill: inspectPanel.controls.canKill,
      inspectNextAction: inspectPanel.nextAction.action,
      inspectTargetChecksum: inspectPanel.proof.targetChecksum,
      dispatchReadinessState: dispatchReadinessGate.state,
      dispatchReadinessAllowed: dispatchReadinessGate.dispatchAllowed,
      dispatchReadinessAuditOnly: dispatchReadinessGate.auditOnly,
      dispatchReadinessReadOnly: dispatchReadinessGate.readOnly,
      dispatchReadinessBlockedBy: dispatchReadinessGate.blockedBy,
      dispatchAcceptedCommandCount: dispatchReadinessGate.commandQueue.acceptedCount,
      dispatchBlockedCommandCount: dispatchReadinessGate.commandQueue.blockedCount,
      dispatchScheduledRetryCount: dispatchReadinessGate.retryBackoff.scheduledCount,
      dispatchNextRetryNotBefore: dispatchReadinessGate.retryBackoff.nextNotBefore,
      dispatchActionableErrorCount: dispatchReadinessGate.actionableErrors.length,
      dispatchNextOperatorCommand: dispatchReadinessGate.nextOperatorCommand,
      hostedDispatchState: hostedKernelDispatchEnvelope.state,
      hostedDispatchBatchKey: hostedKernelDispatchEnvelope.batchKey,
      hostedDispatchReplayPolicy: hostedKernelDispatchEnvelope.replayPolicy,
      hostedDispatchCommandCount: hostedKernelDispatchEnvelope.commands.length,
      hostedDispatchReadyCount: hostedKernelDispatchEnvelope.dispatchableCount,
      hostedDispatchAuditOnlyCount: hostedKernelDispatchEnvelope.auditOnlyCount,
      hostedDispatchBlockedCount: hostedKernelDispatchEnvelope.blockedCount,
      hostedDispatchProofKeys: hostedKernelDispatchEnvelope.proof.acceptedCommandKeys,
      providerSyncCheckpointState: providerSyncCheckpoint.state,
      providerSyncProviderReady: providerSyncCheckpoint.providerReady,
      providerSyncSnapshotAccepted: providerSyncCheckpoint.snapshotAccepted,
      providerSyncRequiresRefresh: providerSyncCheckpoint.requiresRefresh,
      providerSyncWriteBarrier: providerSyncCheckpoint.writeBarrier,
      providerSyncOutboundMessages: providerSyncCheckpoint.outboundMessages.length,
      providerSyncHandoffReady: providerSyncCheckpoint.handoffReady,
      providerSyncExternalHandoffMode: providerSyncCheckpoint.externalHandoff.mode,
      providerSyncProofChecksum: providerSyncCheckpoint.proof.outboundChecksum,
      analyticsExportReady: analyticsExportState.exportReady,
      analyticsExportMode: analyticsExportState.exportMode,
      analyticsExportReason: analyticsExportState.reason,
      analyticsExportRequestValid: analyticsExportRequest.validation.ok,
      analyticsExportRequestedArtifacts: analyticsExportRequest.requestedArtifacts,
      analyticsExportRequestedChannels: analyticsExportRequest.requestedChannels,
      analyticsExportSummaryRows: analyticsExportState.rows.summaryRows.length,
      analyticsExportProcessRows: analyticsExportState.rows.processRows.length,
      analyticsExportAttentionRows: analyticsExportState.rows.attentionRows.length,
      analyticsExportHistoryRows: analyticsExportState.rows.historyRows.length,
      analyticsExportIncidentRows: analyticsExportState.rows.incidentRows.length,
      analyticsExportBlockingIncidentCount: analyticsExportState.counters.blockingIncidentCount,
      analyticsExportManifest: analyticsExportState.manifest.map((artifact) => artifact.name),
      analyticsExportReportReady: analyticsExportReport.ready,
      analyticsExportReportMode: analyticsExportReport.mode,
      analyticsExportReportBlockedReasons: analyticsExportReport.blockedReasons,
      analyticsExportReportChecksums: analyticsExportReport.proof.rowSetChecksums,
      analyticsExportRetainedSnapshots: analyticsExportReport.retention.retainedCount,
      analyticsExportEnabledChannels: analyticsExportReport.deliveryChannels
        .filter((channel) => channel.enabled)
        .map((channel) => channel.channel),
      scopeTenantId: scopePolicy.tenantId,
      scopeWorkspaceId: scopePolicy.workspaceId,
      scopedVisibleProcessCount: scopedProcessView.visibleCount,
      scopedDeniedProcessCount: scopedProcessView.deniedCount,
      scopedDeniedReasons: scopedProcessView.deniedByReason,
      scopeBoundaryProof: scopedProcessView.proof.boundary,
    },
    evidence,
  };
}

export default describeCliPsSurface;
