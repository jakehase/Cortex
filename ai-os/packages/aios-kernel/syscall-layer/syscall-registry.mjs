export const surfaceId = "aios_syscall-layer_syscall-registry_021";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "syscall-registry";

const DEFAULT_ROUTE = 'hosted-kernel/syscall-registry';
const KNOWN_STATUSES = new Set(['registered', 'active', 'deprecated', 'blocked', 'failed']);
const KNOWN_LIFECYCLE_COMMANDS = new Set([
  'activate',
  'block',
  'enable',
  'disable',
  'schedule',
  'unschedule',
  'pause-schedule',
  'resume-schedule'
]);
const KNOWN_SCHEDULE_CADENCES = new Set(['manual', 'once', 'hourly', 'daily', 'weekly']);
const KNOWN_REQUEST_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const KNOWN_REQUEST_INTENTS = new Set(['invoke', 'schedule', 'inspect', 'cancel']);
const RECOVERABLE_STATUSES = new Set(['blocked', 'failed', 'deprecated']);
const RESTART_HOLD_STATUSES = new Set(['blocked', 'failed']);
const PERSISTED_STATUS_PRECEDENCE = {
  failed: 5,
  blocked: 4,
  deprecated: 3,
  active: 2,
  registered: 1
};
const KNOWN_PROVIDER_STATUSES = new Set(['active', 'degraded', 'offline', 'blocked']);
const KNOWN_SYNC_MODES = new Set(['manual', 'pull', 'push', 'bidirectional']);
const KNOWN_HANDOFF_MODES = new Set(['hosted-kernel', 'external-provider', 'external-optional', 'external-required']);
const KNOWN_BOUNDARY_MODES = new Set(['tenant-workspace', 'tenant', 'tenant-only', 'workspace', 'workspace-only', 'kernel-internal']);
const KNOWN_OPERATIONAL_DECLARED_STATES = new Set(['healthy', 'degraded', 'recovering', 'failure-state', 'disabled']);
const KNOWN_RETRY_STRATEGIES = new Set(['none', 'immediate', 'linear-backoff', 'exponential-backoff', 'operator-gated']);
const HEALTH_SEVERITY_RANK = { info: 1, warning: 2, error: 3, critical: 4 };
const DEFAULT_TENANT_ID = 'kernel-tenant';
const DEFAULT_WORKSPACE_ID = 'kernel-workspace';
const INTENT_REQUIRED_ROLES = {
  invoke: 'syscall.invoke',
  schedule: 'syscall.schedule',
  inspect: 'syscall.inspect',
  cancel: 'syscall.cancel'
};
const REQUIRED_BUILTIN_DOMAINS = ['filesystem', 'process', 'source-control', 'memory', 'verification', 'claims', 'audit'];
const BUILTIN_DOMAIN_LABELS = {
  filesystem: 'fs',
  process: 'shell',
  'source-control': 'git',
  memory: 'memory',
  verification: 'verifier',
  claims: 'claim',
  audit: 'audit'
};
const BUILTIN_SYSCALL_SCOPE = {
  tenantId: DEFAULT_TENANT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
  boundary: 'kernel-internal',
  owner: 'hosted-kernel'
};
const BUILTIN_DOMAIN_POLICY = {
  filesystem: {
    isolation: 'workspace-path-boundary',
    mutation: 'read-write',
    durability: 'workspace-storage',
    auditCategory: 'workspace-file-access',
    dispatchClass: 'local-io'
  },
  process: {
    isolation: 'workspace-process-boundary',
    mutation: 'side-effecting',
    durability: 'ephemeral-process',
    auditCategory: 'command-execution',
    dispatchClass: 'local-process'
  },
  'source-control': {
    isolation: 'workspace-repository-boundary',
    mutation: 'read-only',
    durability: 'repository-state',
    auditCategory: 'source-control-read',
    dispatchClass: 'local-vcs'
  },
  memory: {
    isolation: 'tenant-workspace-semantic-boundary',
    mutation: 'read-write',
    durability: 'semantic-index',
    auditCategory: 'memory-index-access',
    dispatchClass: 'hosted-kernel-state'
  },
  verification: {
    isolation: 'proof-ledger-boundary',
    mutation: 'append-only-proof',
    durability: 'proof-ledger',
    auditCategory: 'verification-run',
    dispatchClass: 'hosted-kernel-workflow'
  },
  claims: {
    isolation: 'claim-ledger-boundary',
    mutation: 'append-only-claim',
    durability: 'claim-ledger',
    auditCategory: 'claim-submission',
    dispatchClass: 'hosted-kernel-workflow'
  },
  audit: {
    isolation: 'audit-ledger-boundary',
    mutation: 'append-only-audit',
    durability: 'audit-ledger',
    auditCategory: 'audit-write',
    dispatchClass: 'hosted-kernel-ledger'
  },
  kernel: {
    isolation: 'kernel-internal-boundary',
    mutation: 'kernel-managed',
    durability: 'kernel-state',
    auditCategory: 'kernel-syscall',
    dispatchClass: 'hosted-kernel'
  }
};
const BUILTIN_SYSCALL_DEFINITIONS = [
  {
    name: 'fs.read',
    domain: 'filesystem',
    capability: 'fs.read',
    route: `${DEFAULT_ROUTE}/builtins/fs/read`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.fs.read'],
    provided: ['fs.read'],
    scope: ['workspace', 'path-read'],
    dataClasses: ['workspace-file', 'text'],
    metadata: {
      operation: 'read',
      pathAccess: 'read',
      payloadShape: 'path-selector',
      resultShape: 'file-content'
    }
  },
  {
    name: 'fs.write',
    domain: 'filesystem',
    capability: 'fs.write',
    route: `${DEFAULT_ROUTE}/builtins/fs/write`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.fs.write'],
    provided: ['fs.write'],
    scope: ['workspace', 'path-write'],
    dataClasses: ['workspace-file', 'text'],
    metadata: {
      operation: 'write',
      pathAccess: 'write',
      payloadShape: 'path-and-content',
      resultShape: 'write-receipt'
    }
  },
  {
    name: 'fs.list',
    domain: 'filesystem',
    capability: 'fs.list',
    route: `${DEFAULT_ROUTE}/builtins/fs/list`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.fs.read'],
    provided: ['fs.list'],
    scope: ['workspace', 'path-read', 'directory-read'],
    dataClasses: ['workspace-file', 'directory-entry'],
    metadata: {
      operation: 'list',
      pathAccess: 'read',
      payloadShape: 'directory-selector',
      resultShape: 'directory-entry-list'
    }
  },
  {
    name: 'shell.exec',
    domain: 'process',
    capability: 'shell.exec',
    route: `${DEFAULT_ROUTE}/builtins/shell/exec`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.shell.exec'],
    provided: ['shell.exec'],
    scope: ['workspace', 'process'],
    dataClasses: ['command', 'stdout', 'stderr'],
    metadata: {
      operation: 'execute',
      pathAccess: 'workspace-current-directory',
      payloadShape: 'command-argv-env',
      resultShape: 'exit-code-stdout-stderr'
    }
  },
  {
    name: 'shell.env',
    domain: 'process',
    capability: 'shell.env',
    route: `${DEFAULT_ROUTE}/builtins/shell/env`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.shell.inspect'],
    provided: ['shell.env'],
    scope: ['workspace', 'process-environment'],
    dataClasses: ['environment-variable', 'workspace-metadata'],
    metadata: {
      operation: 'inspect-env',
      pathAccess: 'workspace-current-directory',
      payloadShape: 'env-selector',
      resultShape: 'environment-snapshot'
    }
  },
  {
    name: 'git.diff',
    domain: 'source-control',
    capability: 'git.diff',
    route: `${DEFAULT_ROUTE}/builtins/git/diff`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.git.read'],
    provided: ['git.diff'],
    scope: ['workspace', 'repository-read'],
    dataClasses: ['diff', 'repository-metadata'],
    metadata: {
      operation: 'diff',
      pathAccess: 'repository-read',
      payloadShape: 'revision-or-worktree-selector',
      resultShape: 'unified-diff'
    }
  },
  {
    name: 'git.status',
    domain: 'source-control',
    capability: 'git.status',
    route: `${DEFAULT_ROUTE}/builtins/git/status`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['workspace.git.read'],
    provided: ['git.status'],
    scope: ['workspace', 'repository-read'],
    dataClasses: ['repository-status', 'repository-metadata'],
    metadata: {
      operation: 'status',
      pathAccess: 'repository-read',
      payloadShape: 'worktree-selector',
      resultShape: 'repository-status'
    }
  },
  {
    name: 'memory.search',
    domain: 'memory',
    capability: 'memory.search',
    route: `${DEFAULT_ROUTE}/builtins/memory/search`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['memory.read'],
    provided: ['memory.search'],
    scope: ['tenant', 'workspace', 'semantic-index'],
    dataClasses: ['memory-record', 'embedding-metadata'],
    metadata: {
      operation: 'search',
      pathAccess: 'none',
      payloadShape: 'query-and-filters',
      resultShape: 'ranked-memory-records'
    }
  },
  {
    name: 'memory.write',
    domain: 'memory',
    capability: 'memory.write',
    route: `${DEFAULT_ROUTE}/builtins/memory/write`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['memory.write'],
    provided: ['memory.write'],
    scope: ['tenant', 'workspace', 'semantic-index'],
    dataClasses: ['memory-record'],
    metadata: {
      operation: 'write',
      pathAccess: 'none',
      payloadShape: 'memory-record',
      resultShape: 'memory-write-receipt'
    }
  },
  {
    name: 'memory.read',
    domain: 'memory',
    capability: 'memory.read',
    route: `${DEFAULT_ROUTE}/builtins/memory/read`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['memory.read'],
    provided: ['memory.read'],
    scope: ['tenant', 'workspace', 'semantic-index'],
    dataClasses: ['memory-record', 'memory-reference'],
    metadata: {
      operation: 'read',
      pathAccess: 'none',
      payloadShape: 'memory-record-selector',
      resultShape: 'memory-record'
    }
  },
  {
    name: 'verifier.run',
    domain: 'verification',
    capability: 'verifier.run',
    route: 'hosted-kernel/verifier-run',
    allowedRoles: ['syscall.invoke', 'syscall.inspect', 'syscall.schedule'],
    required: ['proof.emit', 'evidence.ingest', 'audit.export'],
    provided: ['verifier.run'],
    scope: ['tenant', 'workspace', 'proof-ledger'],
    dataClasses: ['proof', 'evidence'],
    metadata: {
      operation: 'verify',
      pathAccess: 'workspace-read',
      payloadShape: 'verifier-command',
      resultShape: 'proof-envelope'
    }
  },
  {
    name: 'verifier.status',
    domain: 'verification',
    capability: 'verifier.status',
    route: `${DEFAULT_ROUTE}/builtins/verifier/status`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['proof.read', 'evidence.read'],
    provided: ['verifier.status'],
    scope: ['tenant', 'workspace', 'proof-ledger'],
    dataClasses: ['proof', 'evidence', 'verifier-run-state'],
    metadata: {
      operation: 'status',
      pathAccess: 'workspace-read',
      payloadShape: 'verifier-run-selector',
      resultShape: 'verifier-run-status'
    }
  },
  {
    name: 'claim.submit',
    domain: 'claims',
    capability: 'claim.submit',
    route: 'hosted-kernel/claim-submit',
    allowedRoles: ['syscall.invoke', 'syscall.inspect', 'syscall.schedule'],
    required: ['claim.submit', 'audit.write'],
    provided: ['claim.submit'],
    scope: ['tenant', 'workspace', 'claim-ledger'],
    dataClasses: ['claim', 'receipt'],
    metadata: {
      operation: 'submit',
      pathAccess: 'none',
      payloadShape: 'claim-envelope',
      resultShape: 'claim-receipt'
    }
  },
  {
    name: 'claim.lookup',
    domain: 'claims',
    capability: 'claim.lookup',
    route: `${DEFAULT_ROUTE}/builtins/claim/lookup`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['claim.read'],
    provided: ['claim.lookup'],
    scope: ['tenant', 'workspace', 'claim-ledger'],
    dataClasses: ['claim', 'receipt'],
    metadata: {
      operation: 'lookup',
      pathAccess: 'none',
      payloadShape: 'claim-selector',
      resultShape: 'claim-envelope'
    }
  },
  {
    name: 'audit.write',
    domain: 'audit',
    capability: 'audit.write',
    route: `${DEFAULT_ROUTE}/builtins/audit/write`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect'],
    required: ['audit.write'],
    provided: ['audit.write'],
    scope: ['tenant', 'workspace', 'audit-ledger'],
    dataClasses: ['audit-record', 'proof-ref'],
    metadata: {
      operation: 'append',
      pathAccess: 'none',
      payloadShape: 'audit-record',
      resultShape: 'audit-write-receipt'
    }
  },
  {
    name: 'audit.export',
    domain: 'audit',
    capability: 'audit.export',
    route: `${DEFAULT_ROUTE}/builtins/audit/export`,
    allowedRoles: ['syscall.invoke', 'syscall.inspect', 'syscall.schedule'],
    required: ['audit.read', 'audit.export'],
    provided: ['audit.export'],
    scope: ['tenant', 'workspace', 'audit-ledger'],
    dataClasses: ['audit-record', 'proof-ref', 'export-manifest'],
    metadata: {
      operation: 'export',
      pathAccess: 'none',
      payloadShape: 'audit-export-selector',
      resultShape: 'audit-export-manifest'
    }
  }
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_STATUSES.has(status) ? status : 'registered';
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringList(value) {
  return asArray(value)
    .map(cleanString)
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function toBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function toPositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function toNonNegativeInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function toRatio(value, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizeCadence(value) {
  const cadence = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_SCHEDULE_CADENCES.has(cadence) ? cadence : 'manual';
}

function normalizeProviderStatus(value) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_PROVIDER_STATUSES.has(status) ? status : 'active';
}

function normalizeSyncMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_SYNC_MODES.has(mode) ? mode : 'manual';
}

function normalizeHandoffMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (mode === 'external' || mode === 'external-handoff') return 'external-provider';
  if (mode === 'required-external') return 'external-required';
  if (mode === 'optional-external') return 'external-optional';
  return KNOWN_HANDOFF_MODES.has(mode) ? mode : 'hosted-kernel';
}

function normalizeBoundaryMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (mode === 'tenant_workspace' || mode === 'tenant+workspace') return 'tenant-workspace';
  if (mode === 'tenant-scoped') return 'tenant';
  if (mode === 'workspace-scoped') return 'workspace';
  return KNOWN_BOUNDARY_MODES.has(mode) ? mode : 'tenant-workspace';
}

function normalizeBoundaryPath(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  return cleaned.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function collectBoundaryPaths(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const candidates = [
    source.path,
    source.filePath,
    source.directory,
    source.cwd,
    source.workingDirectory,
    source.worktreePath,
    source.repositoryPath,
    source.root,
    ...asArray(source.paths),
    ...asArray(source.files),
    ...asArray(source.directories)
  ];

  return uniqueStrings(candidates.map(normalizeBoundaryPath).filter(Boolean));
}

function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const nextRunAt = cleanString(source.nextRunAt);
  const pausedUntil = cleanString(source.pausedUntil);

  return {
    enabled: toBoolean(source.enabled, Boolean(nextRunAt)),
    cadence: normalizeCadence(source.cadence),
    nextRunAt,
    pausedUntil
  };
}

function normalizeOperationalDeclaredState(value, status, enabled) {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (KNOWN_OPERATIONAL_DECLARED_STATES.has(state)) return state;
  if (status === 'failed' || status === 'blocked') return 'failure-state';
  if (enabled === false) return 'disabled';
  return 'healthy';
}

function normalizeRetryStrategy(value, fallback = 'exponential-backoff') {
  const strategy = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_RETRY_STRATEGIES.has(strategy) ? strategy : fallback;
}

function normalizeSyscallOperationalProfile(source, status, enabled) {
  const operationalSource = source.operational && typeof source.operational === 'object'
    ? source.operational
    : source.operationalHealth && typeof source.operationalHealth === 'object'
      ? source.operationalHealth
      : source.health && typeof source.health === 'object'
        ? source.health
        : {};
  const retrySource = operationalSource.retry && typeof operationalSource.retry === 'object'
    ? operationalSource.retry
    : source.retry && typeof source.retry === 'object'
      ? source.retry
      : {};
  const failureSource = operationalSource.lastFailure && typeof operationalSource.lastFailure === 'object'
    ? operationalSource.lastFailure
    : source.lastFailure && typeof source.lastFailure === 'object'
      ? source.lastFailure
      : {};
  const declaredState = normalizeOperationalDeclaredState(
    operationalSource.declaredState || operationalSource.state || source.healthState,
    status,
    enabled
  );
  const lastFailureAt = cleanString(failureSource.at)
    || cleanString(failureSource.occurredAt)
    || cleanString(source.lastFailureAt);
  const retryAfter = cleanString(retrySource.nextRetryNotBefore)
    || cleanString(retrySource.retryAfter)
    || cleanString(failureSource.retryAfter);
  const backoffSeconds = toNonNegativeInteger(retrySource.backoffSeconds, 0);
  const maxAttempts = toPositiveInteger(retrySource.maxAttempts || retrySource.maxRetryAttempts, null);
  const attemptsUsed = toNonNegativeInteger(retrySource.attemptsUsed || retrySource.attempts || source.retryAttempts, 0);
  const explicitRetryable = typeof retrySource.retryable === 'boolean'
    ? retrySource.retryable
    : typeof operationalSource.retryable === 'boolean'
      ? operationalSource.retryable
      : null;
  const degradedModeRoute = cleanString(operationalSource.degradedModeRoute)
    || cleanString(operationalSource.degradedRoute);
  const operatorAction = cleanString(operationalSource.operatorAction)
    || (declaredState === 'failure-state' ? 'open-operator-escalation'
      : declaredState === 'disabled' ? 'enable-route-before-dispatch'
        : declaredState === 'degraded' || declaredState === 'recovering' ? 'monitor-retry-backoff'
          : 'none');
  const clientAction = cleanString(operationalSource.clientAction)
    || (declaredState === 'failure-state' ? 'show-operator-review-hold'
      : declaredState === 'disabled' ? 'show-route-disabled-hold'
        : declaredState === 'degraded' || declaredState === 'recovering' ? 'show-retry-backoff-status'
          : 'none');
  const validationIssues = uniqueStrings([
    lastFailureAt && !parseInstant(lastFailureAt).valid ? 'operational.lastFailureAt.invalid' : null,
    retryAfter && !parseInstant(retryAfter).valid ? 'operational.retryAfter.invalid' : null,
    retrySource.maxAttempts !== undefined && !maxAttempts ? 'operational.retry.maxAttempts.invalid' : null,
    retrySource.backoffSeconds !== undefined && backoffSeconds !== retrySource.backoffSeconds ? 'operational.retry.backoffSeconds.invalid' : null,
    declaredState === 'failure-state' && operatorAction === 'none' ? 'operational.operatorAction.missing' : null
  ]);

  return {
    schema: 'aios.syscall.route-operational-profile.v1',
    declaredState,
    stateSource: Object.keys(operationalSource).length > 0 ? 'route-declared' : 'derived-from-route-state',
    retry: {
      strategy: normalizeRetryStrategy(retrySource.strategy || retrySource.policy, declaredState === 'healthy' ? 'none' : 'exponential-backoff'),
      retryableOverride: explicitRetryable,
      maxAttempts,
      attemptsUsed,
      backoffSeconds,
      nextRetryNotBefore: retryAfter,
      exhaustedOverride: typeof retrySource.exhausted === 'boolean' ? retrySource.exhausted : null
    },
    lastFailure: {
      code: cleanString(failureSource.code) || cleanString(source.lastFailureCode),
      message: cleanString(failureSource.message) || cleanString(source.lastFailureMessage),
      at: lastFailureAt,
      transient: typeof failureSource.transient === 'boolean' ? failureSource.transient : null,
      retryAfter
    },
    degradedMode: {
      allowed: toBoolean(operationalSource.degradedModeAllowed ?? operationalSource.allowDegradedMode, declaredState === 'degraded' || declaredState === 'recovering'),
      route: degradedModeRoute,
      reason: cleanString(operationalSource.degradedReason) || cleanString(operationalSource.reason)
    },
    actions: {
      operatorAction,
      clientAction,
      escalationHint: cleanString(operationalSource.escalationHint)
    },
    validationIssues
  };
}

function normalizeSyscallMetadata(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const domain = cleanString(source.family) || cleanString(source.domain) || cleanString(fallbackSource.domain) || 'kernel';
  const domainPolicy = BUILTIN_DOMAIN_POLICY[domain] || BUILTIN_DOMAIN_POLICY.kernel;
  const capability = cleanString(fallbackSource.capability) || cleanString(fallbackSource.primary) || domain;
  const operation = cleanString(source.operation) || cleanString(source.action) || capability;
  const dispatchIntents = uniqueStrings([
    ...normalizeStringList(source.dispatchIntents || source.intents),
    ...(Array.isArray(fallbackSource.dispatchIntents) ? fallbackSource.dispatchIntents : [])
  ]);

  return {
    schema: cleanString(source.schema) || 'aios.syscall.metadata.v1',
    builtinClass: cleanString(source.builtinClass) || `${domain}:${operation}`,
    family: domain,
    operation,
    pathAccess: cleanString(source.pathAccess) || cleanString(source.pathMode) || 'none',
    payloadShape: cleanString(source.payloadShape) || cleanString(source.requestShape) || 'opaque',
    resultShape: cleanString(source.resultShape) || cleanString(source.responseShape) || 'receipt',
    isolation: cleanString(source.isolation) || domainPolicy.isolation,
    mutation: cleanString(source.mutation) || domainPolicy.mutation,
    durability: cleanString(source.durability) || domainPolicy.durability,
    auditCategory: cleanString(source.auditCategory) || domainPolicy.auditCategory,
    dispatchClass: cleanString(source.dispatchClass) || domainPolicy.dispatchClass,
    dispatchIntents: dispatchIntents.length > 0 ? dispatchIntents : ['invoke', 'inspect'],
    registryRoute: cleanString(source.registryRoute) || DEFAULT_ROUTE,
    builtinRoute: cleanString(source.builtinRoute) || cleanString(fallbackSource.route)
  };
}

function validateBuiltinMetadata(syscall, definition) {
  const metadata = syscall?.metadata || {};
  const domainPolicy = BUILTIN_DOMAIN_POLICY[definition?.domain] || BUILTIN_DOMAIN_POLICY.kernel;
  const allowedRoles = asArray(syscall?.permissions?.allowedRoles).map((role) => role.toLowerCase());
  const expectedIntents = allowedRoles.includes(INTENT_REQUIRED_ROLES.schedule)
    ? ['invoke', 'schedule', 'inspect']
    : ['invoke', 'inspect'];
  const issues = [];

  if (!metadata.operation) issues.push('metadata.operation.missing');
  if (!metadata.payloadShape) issues.push('metadata.payloadShape.missing');
  if (!metadata.resultShape) issues.push('metadata.resultShape.missing');
  if (!metadata.dispatchIntents?.includes('invoke')) issues.push('metadata.dispatchIntents.invoke-missing');
  for (const intent of expectedIntents) {
    if (!metadata.dispatchIntents?.includes(intent)) issues.push(`metadata.dispatchIntents.${intent}-missing`);
  }
  if (definition?.domain && metadata.family !== definition.domain) issues.push('metadata.family.domain-mismatch');
  if (definition?.domain && !BUILTIN_DOMAIN_POLICY[definition.domain]) issues.push('metadata.domain-policy.missing');
  if (metadata.isolation !== domainPolicy.isolation) issues.push('metadata.isolation.policy-mismatch');
  if (metadata.mutation !== domainPolicy.mutation) issues.push('metadata.mutation.policy-mismatch');
  if (metadata.durability !== domainPolicy.durability) issues.push('metadata.durability.policy-mismatch');
  if (metadata.auditCategory !== domainPolicy.auditCategory) issues.push('metadata.auditCategory.policy-mismatch');
  if (metadata.dispatchClass !== domainPolicy.dispatchClass) issues.push('metadata.dispatchClass.policy-mismatch');
  if (definition?.route && metadata.builtinRoute !== definition.route && !syscall?.bootOverride) {
    issues.push('metadata.builtinRoute.definition-mismatch');
  }
  if (syscall?.serviceContract?.providerId !== 'hosted-kernel' && !syscall?.bootOverride) {
    issues.push('serviceContract.providerId.builtin-mismatch');
  }
  if (syscall?.serviceContract?.handoffMode !== 'hosted-kernel' && !syscall?.bootOverride) {
    issues.push('serviceContract.handoffMode.builtin-mismatch');
  }
  if (syscall?.serviceContract?.validationIssues?.length > 0) {
    issues.push('serviceContract.validation.failed');
  }

  return issues;
}

function validateBuiltinDefinition(definition) {
  const issues = [];
  const domain = cleanString(definition.domain);
  const capability = cleanString(definition.capability);
  const metadata = definition.metadata && typeof definition.metadata === 'object' ? definition.metadata : {};
  const roles = uniqueStrings(normalizeStringList(definition.allowedRoles));
  const required = uniqueStrings(normalizeStringList(definition.required));
  const provided = uniqueStrings(normalizeStringList(definition.provided));

  if (!cleanString(definition.name)) issues.push('definition.name.missing');
  if (!domain) issues.push('definition.domain.missing');
  if (domain && !BUILTIN_DOMAIN_POLICY[domain]) issues.push('definition.domain.unknown');
  if (!capability) issues.push('definition.capability.missing');
  if (!cleanString(definition.route)) issues.push('definition.route.missing');
  if (!roles.includes(INTENT_REQUIRED_ROLES.invoke)) issues.push('definition.roles.invoke-missing');
  if (!roles.includes(INTENT_REQUIRED_ROLES.inspect)) issues.push('definition.roles.inspect-missing');
  if (required.length === 0) issues.push('definition.requiredCapabilities.empty');
  if (provided.length === 0) issues.push('definition.providedCapabilities.empty');
  if (capability && provided.length > 0 && !provided.includes(capability.toLowerCase())) {
    issues.push('definition.providedCapabilities.primary-missing');
  }
  if (!cleanString(metadata.operation)) issues.push('definition.metadata.operation.missing');
  if (!cleanString(metadata.payloadShape)) issues.push('definition.metadata.payloadShape.missing');
  if (!cleanString(metadata.resultShape)) issues.push('definition.metadata.resultShape.missing');

  return issues;
}

function buildBuiltinSyscall(rawDefinition, scope = {}) {
  const definition = rawDefinition && typeof rawDefinition === 'object' ? rawDefinition : {};
  const tenantId = cleanString(scope.tenantId) || cleanString(scope.tenant) || BUILTIN_SYSCALL_SCOPE.tenantId;
  const workspaceId = cleanString(scope.workspaceId) || cleanString(scope.workspace) || BUILTIN_SYSCALL_SCOPE.workspaceId;
  const owner = cleanString(scope.owner) || BUILTIN_SYSCALL_SCOPE.owner;
  const boundary = normalizeBoundaryMode(scope.boundary || BUILTIN_SYSCALL_SCOPE.boundary);
  const capability = cleanString(definition.capability) || cleanString(definition.name);
  const domain = cleanString(definition.domain) || 'kernel';
  const domainPolicy = BUILTIN_DOMAIN_POLICY[domain] || BUILTIN_DOMAIN_POLICY.kernel;
  const metadataSource = definition.metadata && typeof definition.metadata === 'object' ? definition.metadata : {};
  const dispatchIntents = definition.allowedRoles?.includes(INTENT_REQUIRED_ROLES.schedule)
    ? ['invoke', 'schedule', 'inspect']
    : ['invoke', 'inspect'];
  const metadata = {
    schema: 'aios.syscall.builtin-metadata.v1',
    builtinClass: `${domain}:${cleanString(metadataSource.operation) || capability}`,
    family: domain,
    operation: cleanString(metadataSource.operation) || capability,
    pathAccess: cleanString(metadataSource.pathAccess) || 'none',
    payloadShape: cleanString(metadataSource.payloadShape) || 'opaque',
    resultShape: cleanString(metadataSource.resultShape) || 'receipt',
    isolation: domainPolicy.isolation,
    mutation: domainPolicy.mutation,
    durability: domainPolicy.durability,
    auditCategory: domainPolicy.auditCategory,
    dispatchClass: domainPolicy.dispatchClass,
    dispatchIntents,
    registryRoute: DEFAULT_ROUTE,
    builtinRoute: definition.route
  };

  return {
    name: definition.name,
    owner,
    route: definition.route,
    status: 'active',
    enabled: true,
    tenantId,
    workspaceId,
    permissions: {
      allowedRoles: uniqueStrings(definition.allowedRoles || []),
      allowedTenants: [tenantId],
      allowedWorkspaces: [workspaceId],
      boundary,
      invokeRole: INTENT_REQUIRED_ROLES.invoke,
      scheduleRole: definition.allowedRoles?.includes(INTENT_REQUIRED_ROLES.schedule)
        ? INTENT_REQUIRED_ROLES.schedule
        : INTENT_REQUIRED_ROLES.invoke,
      inspectRole: INTENT_REQUIRED_ROLES.inspect,
      cancelRole: INTENT_REQUIRED_ROLES.cancel
    },
    capabilities: {
      required: uniqueStrings(definition.required || []),
      provided: uniqueStrings(definition.provided || []),
      scope: uniqueStrings(definition.scope || []),
      dataClasses: uniqueStrings(definition.dataClasses || []),
      capability,
      domain
    },
    metadata,
    provider: {
      providerId: 'hosted-kernel',
      serviceId: definition.name,
      contractVersion: 'v1',
      handoffMode: 'hosted-kernel'
    },
    builtin: true
  };
}

function buildBuiltinSyscallCatalog(input = {}) {
  const scope = input.builtinSyscallScope || input.bootScope || input.kernelScope || {};
  return BUILTIN_SYSCALL_DEFINITIONS
    .map((definition) => buildBuiltinSyscall(definition, scope));
}

function normalizeSyscallContractSync(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: normalizeSyncMode(source.mode || source.syncMode),
    revision: toPositiveInteger(source.revision || source.syncRevision, 1),
    cursor: cleanString(source.cursor) || cleanString(source.syncCursor),
    lastSyncedAt: cleanString(source.lastSyncedAt) || cleanString(source.syncedAt),
    nextSyncAt: cleanString(source.nextSyncAt),
    staleAfterSeconds: toPositiveInteger(source.staleAfterSeconds || source.syncStaleAfterSeconds, 300),
    source: cleanString(source.source) || 'registry'
  };
}

function buildServiceContractIssues(contract, capabilityNegotiation) {
  const issues = [];

  if (!contract.providerId) issues.push('serviceContract.providerId.missing');
  if (!contract.serviceId) issues.push('serviceContract.serviceId.missing');
  if (contract.handoffMode !== 'hosted-kernel' && !contract.externalRoute) {
    issues.push('serviceContract.externalRoute.required');
  }
  if (contract.handoffMode === 'external-required' && !contract.endpointRoute) {
    issues.push('serviceContract.endpointRoute.required');
  }
  if (contract.sync.mode !== 'manual' && !contract.sync.lastSyncedAt) {
    issues.push('serviceContract.sync.lastSyncedAt.missing');
  }
  if (capabilityNegotiation.requiredFromProvider.length > 0 && capabilityNegotiation.providerAdvertised.length > 0 && capabilityNegotiation.missingFromProvider.length > 0) {
    issues.push('serviceContract.capabilityNegotiation.gap');
  }

  return issues;
}

function normalizeSyscallServiceContract(source, providerSource, context) {
  const contractSource = source.serviceContract && typeof source.serviceContract === 'object'
    ? source.serviceContract
    : {};
  const syncSource = contractSource.sync && typeof contractSource.sync === 'object'
    ? contractSource.sync
    : providerSource.sync && typeof providerSource.sync === 'object'
      ? providerSource.sync
      : {};
  const providerId = cleanString(contractSource.providerId)
    || cleanString(providerSource.providerId)
    || cleanString(source.providerId)
    || (source.builtin === true ? 'hosted-kernel' : null);
  const serviceId = cleanString(contractSource.serviceId)
    || cleanString(providerSource.serviceId)
    || cleanString(source.serviceId)
    || (source.builtin === true ? context.name : null);
  const handoffMode = normalizeHandoffMode(
    contractSource.handoffMode
    || providerSource.handoffMode
    || source.handoffMode
    || (source.builtin === true ? 'hosted-kernel' : null)
  );
  const providerAdvertised = uniqueStrings(normalizeStringList(
    contractSource.providerCapabilities
    || providerSource.capabilities
    || providerSource.providedCapabilities
    || source.providerCapabilities
  ));
  const requiredFromProvider = uniqueStrings([
    ...context.requiredCapabilities,
    ...normalizeStringList(contractSource.requiredProviderCapabilities || source.requiredProviderCapabilities)
  ]);
  const missingFromProvider = providerAdvertised.length === 0
    ? []
    : requiredFromProvider.filter((capability) => !providerAdvertised.includes(capability));
  const capabilityNegotiation = {
    schema: 'aios.syscall.service-capability-negotiation.v1',
    requiredFromProvider,
    providerAdvertised,
    missingFromProvider,
    providedByRoute: context.providedCapabilities,
    negotiationState: missingFromProvider.length > 0 ? 'provider-capability-gap'
      : providerAdvertised.length > 0 ? 'provider-advertised'
        : 'deferred-to-provider-registry'
  };
  const contract = {
    schema: 'aios.syscall.service-contract.v1',
    providerId,
    serviceId,
    serviceKey: providerId && serviceId ? `${providerId}:${serviceId}` : null,
    contractVersion: cleanString(contractSource.contractVersion)
      || cleanString(providerSource.contractVersion)
      || cleanString(source.contractVersion)
      || 'v1',
    handoffMode,
    externalRoute: cleanString(contractSource.externalRoute)
      || cleanString(providerSource.externalRoute)
      || cleanString(source.externalRoute),
    endpointRoute: cleanString(contractSource.endpointRoute)
      || cleanString(providerSource.endpointRoute)
      || cleanString(source.endpointRoute),
    sync: normalizeSyscallContractSync({
      ...syncSource,
      syncMode: contractSource.syncMode || providerSource.syncMode || source.syncMode,
      syncRevision: contractSource.syncRevision || providerSource.syncRevision || source.syncRevision,
      syncCursor: contractSource.syncCursor || providerSource.syncCursor || source.syncCursor,
      syncStaleAfterSeconds: contractSource.syncStaleAfterSeconds || providerSource.syncStaleAfterSeconds || source.syncStaleAfterSeconds
    }),
    capabilityNegotiation,
    externalHandoff: {
      required: handoffMode === 'external-provider' || handoffMode === 'external-required',
      optional: handoffMode === 'external-optional',
      state: handoffMode === 'hosted-kernel' ? 'not-required'
        : cleanString(contractSource.externalRoute) || cleanString(providerSource.externalRoute) || cleanString(source.externalRoute)
          ? 'route-declared'
          : 'route-missing',
      resumeRoute: cleanString(contractSource.resumeRoute) || cleanString(source.resumeRoute),
      handoffStateKey: `${context.name}:${providerId || 'unbound'}:${serviceId || 'unbound'}:${handoffMode}`
    }
  };
  const validationIssues = buildServiceContractIssues(contract, capabilityNegotiation);

  return {
    ...contract,
    validationIssues,
    ready: validationIssues.length === 0
  };
}

function mergeBootSyscalls(input = {}) {
  const builtins = buildBuiltinSyscallCatalog(input);
  const requested = asArray(input.syscalls);
  const mergedByName = new Map();

  for (const builtin of builtins) {
    mergedByName.set(builtin.name, builtin);
  }

  for (const syscall of requested) {
    const name = cleanString(syscall?.name);
    if (!name) {
      mergedByName.set(`__anonymous_${mergedByName.size + 1}`, syscall);
      continue;
    }

    const existing = mergedByName.get(name);
    mergedByName.set(name, existing ? {
      ...existing,
      ...syscall,
      permissions: {
        ...existing.permissions,
        ...(syscall.permissions && typeof syscall.permissions === 'object' ? syscall.permissions : {})
      },
      capabilities: {
        ...existing.capabilities,
        ...(syscall.capabilities && typeof syscall.capabilities === 'object' ? syscall.capabilities : {})
      },
      bootOverride: true
    } : syscall);
  }

  return [...mergedByName.values()];
}

function normalizeSyscall(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : `anonymous.syscall.${index + 1}`;
  const owner = typeof source.owner === 'string' && source.owner.trim()
    ? source.owner.trim()
    : 'kernel';
  const route = typeof source.route === 'string' && source.route.trim()
    ? source.route.trim()
    : `${DEFAULT_ROUTE}/${name}`;
  const status = normalizeStatus(source.status);
  const version = Number.isFinite(source.version) && source.version > 0
    ? source.version
    : 1;
  const invoked = Number.isFinite(source.invoked)
    ? Math.max(0, Math.trunc(source.invoked))
    : 0;
  const failures = Number.isFinite(source.failures)
    ? Math.max(0, Math.trunc(source.failures))
    : 0;
  const lastInvokedAt = cleanString(source.lastInvokedAt);
  const enabled = toBoolean(source.enabled, status !== 'blocked');
  const operational = normalizeSyscallOperationalProfile(source, status, enabled);
  const schedule = normalizeSchedule(source.schedule);
  const tenantId = cleanString(source.tenantId) || cleanString(source.tenant) || DEFAULT_TENANT_ID;
  const workspaceId = cleanString(source.workspaceId) || cleanString(source.workspace) || DEFAULT_WORKSPACE_ID;
  const permissionSource = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
  const allowedRoles = uniqueStrings(normalizeStringList(permissionSource.allowedRoles || source.allowedRoles));
  const allowedTenants = uniqueStrings([
    tenantId.toLowerCase(),
    ...normalizeStringList(permissionSource.allowedTenants || source.allowedTenants)
  ]);
  const allowedWorkspaces = uniqueStrings([
    workspaceId.toLowerCase(),
    ...normalizeStringList(permissionSource.allowedWorkspaces || source.allowedWorkspaces)
  ]);
  const capabilitySource = source.capabilities && typeof source.capabilities === 'object' ? source.capabilities : {};
  const requiredCapabilities = uniqueStrings(normalizeStringList(
    capabilitySource.required || source.requiredCapabilities || source.capabilityRequirements
  ));
  const providedCapabilities = uniqueStrings(normalizeStringList(
    capabilitySource.provided || capabilitySource.advertised || source.providedCapabilities
  ));
  const capabilityScopes = uniqueStrings(normalizeStringList(
    capabilitySource.scope || capabilitySource.scopes || source.capabilityScopes
  ));
  const dataClasses = uniqueStrings(normalizeStringList(
    capabilitySource.dataClasses || capabilitySource.dataClassifications || source.dataClasses
  ));
  const providerSource = source.provider && typeof source.provider === 'object' ? source.provider : {};
  const metadata = normalizeSyscallMetadata(source.metadata || source.syscallMetadata, {
    domain: cleanString(capabilitySource.domain) || cleanString(source.domain),
    capability: cleanString(capabilitySource.capability) || cleanString(source.capability) || providedCapabilities[0],
    dispatchIntents: allowedRoles.includes(INTENT_REQUIRED_ROLES.schedule)
      ? ['invoke', 'schedule', 'inspect']
      : ['invoke', 'inspect'],
    route
  });
  const serviceContract = normalizeSyscallServiceContract(source, providerSource, {
    name,
    requiredCapabilities,
    providedCapabilities
  });

  return {
    name,
    owner,
    route,
    tenantId,
    workspaceId,
    status,
    version,
    invoked,
    failures,
    lastInvokedAt,
    enabled,
    schedule,
    permissions: {
      allowedRoles,
      requiredRolesByIntent: {
        invoke: cleanString(permissionSource.invokeRole) || INTENT_REQUIRED_ROLES.invoke,
        schedule: cleanString(permissionSource.scheduleRole) || INTENT_REQUIRED_ROLES.schedule,
        inspect: cleanString(permissionSource.inspectRole) || INTENT_REQUIRED_ROLES.inspect,
        cancel: cleanString(permissionSource.cancelRole) || INTENT_REQUIRED_ROLES.cancel
      },
      allowedTenants,
      allowedWorkspaces,
      boundary: normalizeBoundaryMode(permissionSource.boundary || source.boundary)
    },
    capabilities: {
      required: requiredCapabilities,
      provided: providedCapabilities,
      scope: capabilityScopes,
      dataClasses,
      domain: cleanString(capabilitySource.domain) || cleanString(source.domain) || null,
      primary: cleanString(capabilitySource.capability) || cleanString(source.capability) || providedCapabilities[0] || null,
      builtin: source.builtin === true
    },
    metadata,
    serviceContract,
    operational,
    builtin: source.builtin === true,
    bootOverride: source.bootOverride === true,
    exportKey: `${owner}:${name}:v${version}`
  };
}

function normalizeLifecycleSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const maxScheduledRoutes = toPositiveInteger(source.maxScheduledRoutes, 25);
  const failureRateBlockThreshold = Number.isFinite(source.failureRateBlockThreshold)
    ? Math.min(1, Math.max(0, source.failureRateBlockThreshold))
    : 0.2;
  const maintenanceStart = cleanString(source.maintenanceWindow?.start);
  const maintenanceEnd = cleanString(source.maintenanceWindow?.end);
  const maintenanceStartInstant = parseInstant(maintenanceStart);
  const maintenanceEndInstant = parseInstant(maintenanceEnd);
  const hasMaintenanceWindow = Boolean(maintenanceStart && maintenanceEnd);
  const maintenanceWindowValid = hasMaintenanceWindow
    && maintenanceStartInstant.valid
    && maintenanceEndInstant.valid
    && maintenanceEndInstant.epochMs > maintenanceStartInstant.epochMs;
  const settings = {
    allowRuntimeEnable: toBoolean(source.allowRuntimeEnable, true),
    allowRuntimeDisable: toBoolean(source.allowRuntimeDisable, true),
    allowScheduling: toBoolean(source.allowScheduling, true),
    requireReasonForDisable: toBoolean(source.requireReasonForDisable, true),
    requireMaintenanceWindowForSchedule: toBoolean(source.requireMaintenanceWindowForSchedule, false),
    allowScheduleOutsideMaintenanceWindow: toBoolean(source.allowScheduleOutsideMaintenanceWindow, true),
    maxScheduledRoutes,
    failureRateBlockThreshold,
    maintenanceWindow: {
      start: maintenanceStart,
      end: maintenanceEnd,
      valid: maintenanceWindowValid,
      active: false
    }
  };
  const issues = [];

  if (source.maxScheduledRoutes !== undefined && maxScheduledRoutes !== source.maxScheduledRoutes) {
    issues.push({
      code: 'settings.maxScheduledRoutes.invalid',
      severity: 'warning',
      message: 'maxScheduledRoutes must be a positive integer; default applied'
    });
  }

  if (source.failureRateBlockThreshold !== undefined && settings.failureRateBlockThreshold !== source.failureRateBlockThreshold) {
    issues.push({
      code: 'settings.failureRateBlockThreshold.clamped',
      severity: 'warning',
      message: 'failureRateBlockThreshold must be between 0 and 1; value was clamped'
    });
  }

  if (Boolean(maintenanceStart) !== Boolean(maintenanceEnd)) {
    issues.push({
      code: 'settings.maintenanceWindow.incomplete',
      severity: 'warning',
      message: 'maintenanceWindow requires both start and end to be actionable'
    });
  }

  if (hasMaintenanceWindow && (!maintenanceStartInstant.valid || !maintenanceEndInstant.valid)) {
    issues.push({
      code: 'settings.maintenanceWindow.invalid',
      severity: 'warning',
      message: 'maintenanceWindow start and end must parse as instants'
    });
  }

  if (hasMaintenanceWindow && maintenanceStartInstant.valid && maintenanceEndInstant.valid && maintenanceEndInstant.epochMs <= maintenanceStartInstant.epochMs) {
    issues.push({
      code: 'settings.maintenanceWindow.order.invalid',
      severity: 'warning',
      message: 'maintenanceWindow end must be after start'
    });
  }

  if (settings.requireMaintenanceWindowForSchedule && !maintenanceWindowValid) {
    issues.push({
      code: 'settings.requireMaintenanceWindowForSchedule.window-missing',
      severity: 'warning',
      message: 'requireMaintenanceWindowForSchedule needs a valid maintenanceWindow'
    });
  }

  if (!settings.allowScheduleOutsideMaintenanceWindow && !maintenanceWindowValid) {
    issues.push({
      code: 'settings.allowScheduleOutsideMaintenanceWindow.window-missing',
      severity: 'warning',
      message: 'restricted scheduling needs a valid maintenanceWindow'
    });
  }

  return { settings, issues };
}

function buildMaintenanceWindowState(settings, now) {
  const window = settings.maintenanceWindow || {};
  const start = parseInstant(window.start);
  const end = parseInstant(window.end);
  const reference = parseInstant(now);
  const valid = Boolean(window.valid && start.valid && end.valid && end.epochMs > start.epochMs);
  const active = valid && reference.valid && reference.epochMs >= start.epochMs && reference.epochMs <= end.epochMs;
  const upcoming = valid && reference.valid && reference.epochMs < start.epochMs;
  const elapsed = valid && reference.valid && reference.epochMs > end.epochMs;

  return {
    start: window.start || null,
    end: window.end || null,
    valid,
    active,
    upcoming,
    elapsed,
    schedulePolicy: settings.requireMaintenanceWindowForSchedule ? 'required'
      : settings.allowScheduleOutsideMaintenanceWindow ? 'advisory'
        : 'restricted',
    scheduleAllowedNow: !settings.allowScheduling ? false
      : settings.requireMaintenanceWindowForSchedule ? active
        : settings.allowScheduleOutsideMaintenanceWindow || active,
    nextWindowAction: !settings.allowScheduling ? 'scheduling-disabled'
      : !valid && settings.requireMaintenanceWindowForSchedule ? 'configure-maintenance-window'
        : !valid && !settings.allowScheduleOutsideMaintenanceWindow ? 'configure-maintenance-window'
        : active ? 'allow-schedule-window'
          : upcoming ? 'wait-for-maintenance-window'
            : elapsed ? 'refresh-maintenance-window'
              : 'schedule-without-window'
  };
}

function normalizeLifecycleCommand(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const action = cleanString(source.action)?.toLowerCase() || 'unknown';
  const target = cleanString(source.target) || cleanString(source.name);
  const requestedBy = cleanString(source.requestedBy) || 'kernel';
  const reason = cleanString(source.reason);
  const runAt = cleanString(source.runAt);
  const pausedUntil = cleanString(source.pausedUntil) || cleanString(source.pauseUntil);

  return {
    commandId: cleanString(source.commandId) || `syscall-lifecycle-command-${index + 1}`,
    action,
    target,
    requestedBy,
    reason,
    runAt,
    pausedUntil,
    cadence: normalizeCadence(source.cadence),
    idempotencyKey: cleanString(source.idempotencyKey) || `${requestedBy}:${action}:${target || 'missing-target'}:${runAt || pausedUntil || 'immediate'}`,
    accepted: KNOWN_LIFECYCLE_COMMANDS.has(action) && Boolean(target),
    rejectionReason: KNOWN_LIFECYCLE_COMMANDS.has(action)
      ? (target ? null : 'missing-target')
      : 'unknown-action'
  };
}

function parseInstant(value) {
  const parsed = cleanString(value);
  if (!parsed) return { value: null, epochMs: null, valid: false };
  const epochMs = Date.parse(parsed);
  return {
    value: parsed,
    epochMs: Number.isFinite(epochMs) ? epochMs : null,
    valid: Number.isFinite(epochMs)
  };
}

function isFutureInstant(value, now) {
  const candidate = parseInstant(value);
  const reference = parseInstant(now);
  return candidate.valid && reference.valid && candidate.epochMs > reference.epochMs;
}

function buildLifecycleTransition(route, command, settings, scheduledRoutes, now, maintenanceWindowState) {
  const reasons = [];
  const routeExists = Boolean(route);
  const currentStatus = route?.status || 'missing';
  const currentEnabled = route?.enabled ?? false;
  const currentScheduled = Boolean(route?.schedule?.enabled);
  const currentPaused = Boolean(route?.schedule?.pausedUntil && isFutureInstant(route.schedule.pausedUntil, now));
  const runAt = parseInstant(command.runAt);
  const pauseUntil = parseInstant(command.pausedUntil || command.runAt);

  if (command.accepted && !routeExists) reasons.push('target-not-registered');
  if ((command.action === 'enable' || command.action === 'activate') && !settings.allowRuntimeEnable) reasons.push('runtime-enable-disabled');
  if ((command.action === 'disable' || command.action === 'block') && !settings.allowRuntimeDisable) reasons.push('runtime-disable-disabled');
  if (command.action === 'disable' && settings.requireReasonForDisable && !command.reason) reasons.push('disable-reason-required');
  if (['schedule', 'unschedule', 'pause-schedule', 'resume-schedule'].includes(command.action) && !settings.allowScheduling) reasons.push('scheduling-disabled');
  if (command.action === 'schedule' && scheduledRoutes >= settings.maxScheduledRoutes && !currentScheduled) reasons.push('schedule-capacity-reached');
  if (command.action === 'schedule' && !command.runAt) reasons.push('schedule-runAt-required');
  if (command.action === 'schedule' && command.runAt && !runAt.valid) reasons.push('schedule-runAt-invalid');
  if (command.action === 'schedule' && runAt.valid && !isFutureInstant(command.runAt, now)) reasons.push('schedule-runAt-not-future');
  if (command.action === 'schedule' && command.cadence === 'manual') reasons.push('schedule-cadence-required');
  if (command.action === 'schedule' && settings.requireMaintenanceWindowForSchedule && !maintenanceWindowState.valid) {
    reasons.push('maintenance-window-required');
  }
  if (command.action === 'schedule' && maintenanceWindowState.valid && !maintenanceWindowState.scheduleAllowedNow) {
    reasons.push(maintenanceWindowState.upcoming ? 'maintenance-window-not-started' : 'maintenance-window-not-active');
  }
  if (command.action === 'schedule' && runAt.valid && maintenanceWindowState.valid) {
    const scheduledInsideWindow = runAt.epochMs >= parseInstant(maintenanceWindowState.start).epochMs
      && runAt.epochMs <= parseInstant(maintenanceWindowState.end).epochMs;
    if (!settings.allowScheduleOutsideMaintenanceWindow && !scheduledInsideWindow) {
      reasons.push('schedule-runAt-outside-maintenance-window');
    }
  }
  if (command.action === 'unschedule' && routeExists && !currentScheduled) reasons.push('route-not-scheduled');
  if (command.action === 'pause-schedule' && routeExists && !currentScheduled) reasons.push('route-not-scheduled');
  if (command.action === 'pause-schedule' && !command.pausedUntil && !command.runAt) reasons.push('pause-until-required');
  if (command.action === 'pause-schedule' && (command.pausedUntil || command.runAt) && !pauseUntil.valid) reasons.push('pause-until-invalid');
  if (command.action === 'pause-schedule' && pauseUntil.valid && !isFutureInstant(pauseUntil.value, now)) reasons.push('pause-until-not-future');
  if (command.action === 'resume-schedule' && routeExists && !currentScheduled) reasons.push('route-not-scheduled');
  if (command.action === 'resume-schedule' && routeExists && currentScheduled && !currentPaused) reasons.push('route-schedule-not-paused');
  if (command.action === 'enable' && routeExists && currentEnabled) reasons.push('route-already-enabled');
  if (command.action === 'disable' && routeExists && !currentEnabled) reasons.push('route-already-disabled');
  if (command.action === 'activate' && routeExists && currentStatus === 'blocked') reasons.push('blocked-route-requires-enable-before-activate');
  if (command.action === 'block' && routeExists && currentStatus === 'blocked') reasons.push('route-already-blocked');

  const nextStatus = command.action === 'activate'
    ? 'active'
    : command.action === 'block' ? 'blocked' : undefined;
  const nextEnabled = ['activate', 'enable', 'schedule'].includes(command.action)
    ? true
    : ['disable', 'block'].includes(command.action) ? false : undefined;
  const nextSchedule = command.action === 'schedule'
    ? {
        enabled: true,
        cadence: command.cadence,
        nextRunAt: command.runAt,
        pausedUntil: null
      }
    : command.action === 'unschedule'
      ? {
          enabled: false,
          cadence: 'manual',
          nextRunAt: null,
          pausedUntil: null
        }
      : command.action === 'pause-schedule'
        ? {
            enabled: true,
            cadence: route?.schedule?.cadence || 'manual',
            nextRunAt: route?.schedule?.nextRunAt || null,
            pausedUntil: pauseUntil.value
          }
        : command.action === 'resume-schedule'
          ? {
              enabled: true,
              cadence: route?.schedule?.cadence || 'manual',
              nextRunAt: route?.schedule?.nextRunAt || null,
              pausedUntil: null
            }
      : undefined;

  return {
    reasons,
    effect: reasons.length === 0
      ? {
          enabled: nextEnabled,
          status: nextStatus,
          schedule: nextSchedule
        }
      : null,
    transition: {
      from: {
        status: currentStatus,
        enabled: currentEnabled,
        scheduled: currentScheduled,
        nextRunAt: route?.schedule?.nextRunAt || null,
        pausedUntil: route?.schedule?.pausedUntil || null
      },
      to: reasons.length === 0
        ? {
            status: nextStatus || currentStatus,
            enabled: nextEnabled ?? currentEnabled,
            scheduled: nextSchedule ? nextSchedule.enabled : currentScheduled,
            nextRunAt: nextSchedule ? nextSchedule.nextRunAt : route?.schedule?.nextRunAt || null,
            pausedUntil: nextSchedule ? nextSchedule.pausedUntil : route?.schedule?.pausedUntil || null
          }
        : null
    }
  };
}

function buildRouteNextAction(state) {
  if (state.effectiveStatus === 'blocked') {
    return {
      nextAction: 'operator-review',
      reason: state.autoBlockRecommended ? 'failure-rate-threshold-exceeded' : 'route-blocked',
      control: 'enable-or-activate-after-review'
    };
  }

  if (state.schedulePaused) {
    return {
      nextAction: 'wait-for-maintenance-window',
      reason: 'schedule-paused-until-maintenance-window',
      control: 'wait-or-unschedule'
    };
  }

  if (state.nextScheduledAt) {
    return {
      nextAction: 'dispatch-scheduled-syscall',
      reason: 'scheduled-run-ready',
      control: 'dispatch-or-unschedule'
    };
  }

  if (state.effectiveEnabled) {
    return {
      nextAction: 'await-invocation',
      reason: 'route-enabled-without-pending-schedule',
      control: 'invoke-or-schedule'
    };
  }

  return {
    nextAction: 'await-enable-command',
    reason: 'route-disabled',
    control: 'enable'
  };
}

function buildRouteClientWorkflowContract(syscall, routeState, controls) {
  const dispatchIntents = uniqueStrings(asArray(syscall.metadata?.dispatchIntents)
    .map(normalizeRequestIntent)
    .filter((intent) => KNOWN_REQUEST_INTENTS.has(intent)));
  const supportedIntents = uniqueStrings([
    ...dispatchIntents,
    controls.canSchedule || routeState.nextScheduledAt ? 'schedule' : null,
    routeState.nextScheduledAt ? 'cancel' : null
  ]);
  const routeHeld = routeState.effectiveStatus === 'blocked'
    || routeState.effectiveStatus === 'failed'
    || routeState.effectiveEnabled === false
    || controls.lifecycleLocked;
  const scheduleState = routeState.schedulePaused ? 'paused'
    : routeState.nextScheduledAt ? 'scheduled'
      : controls.canSchedule ? 'schedulable'
        : 'not-schedulable';
  const handoffDestination = syscall.serviceContract?.externalHandoff?.required ? 'external-provider'
    : syscall.serviceContract?.externalHandoff?.optional ? 'external-provider-optional'
      : 'hosted-kernel';
  const primaryIntent = routeHeld ? 'inspect'
    : routeState.nextScheduledAt ? 'cancel'
      : supportedIntents.includes('invoke') ? 'invoke'
        : supportedIntents[0] || 'inspect';
  const intentCards = supportedIntents.map((intent) => {
    const requiredRole = syscall.permissions.requiredRolesByIntent?.[intent] || INTENT_REQUIRED_ROLES[intent];
    const blockedReasons = uniqueStrings([
      routeHeld && intent !== 'inspect' ? 'route-held' : null,
      intent === 'schedule' && !controls.canSchedule && !routeState.nextScheduledAt ? 'schedule-control-unavailable' : null,
      intent === 'cancel' && !routeState.nextScheduledAt ? 'no-scheduled-run-to-cancel' : null,
      !requiredRole ? 'intent-role-unmapped' : null
    ]);

    return {
      intent,
      enabled: blockedReasons.length === 0,
      requiredRole,
      blockedReasons,
      requestShape: syscall.metadata.payloadShape,
      responseShape: syscall.metadata.resultShape,
      nextVisibleStep: blockedReasons.length === 0
        ? intent === 'inspect' ? 'render-registry-state'
          : intent === 'schedule' ? 'show-schedule-form'
            : intent === 'cancel' ? 'show-cancel-confirmation'
              : handoffDestination === 'hosted-kernel' ? 'show-dispatch-accepted'
                : 'open-provider-handoff'
        : blockedReasons.includes('route-held') ? 'show-route-hold'
          : 'show-control-unavailable'
    };
  });

  return {
    schema: 'aios.syscall.route-client-workflow.v1',
    routeKey: syscall.exportKey,
    syscall: syscall.name,
    route: syscall.route,
    domain: syscall.capabilities.domain || syscall.metadata.family,
    operation: syscall.metadata.operation,
    builtin: syscall.builtin,
    clientVisible: {
      label: syscall.name,
      status: routeHeld ? 'held' : 'available',
      primaryIntent,
      nextVisibleStep: routeHeld ? 'show-route-hold'
        : primaryIntent === 'schedule' ? 'show-schedule-form'
          : primaryIntent === 'cancel' ? 'show-cancel-confirmation'
            : primaryIntent === 'inspect' ? 'render-registry-state'
              : handoffDestination === 'hosted-kernel' ? 'show-dispatch-accepted'
                : 'open-provider-handoff',
      scheduleState,
      handoffDestination
    },
    supportedIntents,
    unsupportedIntents: [...KNOWN_REQUEST_INTENTS].filter((intent) => !supportedIntents.includes(intent)),
    intentCards,
    dataContract: {
      payloadShape: syscall.metadata.payloadShape,
      resultShape: syscall.metadata.resultShape,
      dataClasses: syscall.capabilities.dataClasses,
      auditCategory: syscall.metadata.auditCategory,
      dispatchClass: syscall.metadata.dispatchClass
    },
    handoff: {
      mode: syscall.serviceContract.handoffMode,
      providerId: syscall.serviceContract.providerId,
      serviceId: syscall.serviceContract.serviceId,
      ready: syscall.serviceContract.ready,
      externalRequired: syscall.serviceContract.externalHandoff?.required || false,
      externalOptional: syscall.serviceContract.externalHandoff?.optional || false,
      resumeRoute: syscall.serviceContract.externalHandoff?.resumeRoute || null
    },
    controls: {
      canInvoke: !routeHeld && supportedIntents.includes('invoke'),
      canInspect: supportedIntents.includes('inspect'),
      canSchedule: controls.canSchedule && supportedIntents.includes('schedule'),
      canCancel: Boolean(routeState.nextScheduledAt) && supportedIntents.includes('cancel'),
      lifecycleLocked: controls.lifecycleLocked,
      nextScheduledAt: routeState.nextScheduledAt,
      pauseUntil: routeState.pauseUntil
    }
  };
}

function buildRouteLifecycleAction(action, enabled, reasons, commandShape) {
  return {
    action,
    enabled,
    blockedReasons: uniqueStrings(reasons),
    nextVisibleStep: enabled ? `show-${action}-confirmation` : 'show-lifecycle-control-hold',
    commandShape,
    idempotencyScope: 'requestedBy:action:target:time'
  };
}

function buildRouteLifecycleControls(syscall, routeState, controls, maintenanceWindowState, settings) {
  const baseCommand = {
    target: syscall.name,
    targetRoute: syscall.route,
    requestedBy: 'operator',
    reasonRequired: false
  };
  const lockedReason = controls.lifecycleLocked ? 'route-lifecycle-locked' : null;
  const scheduleWindowReason = settings.allowScheduling && !maintenanceWindowState.scheduleAllowedNow
    ? maintenanceWindowState.nextWindowAction
    : null;

  return {
    schema: 'aios.syscall.route-lifecycle-controls.v1',
    routeKey: syscall.exportKey,
    syscall: syscall.name,
    route: syscall.route,
    state: {
      status: routeState.effectiveStatus,
      enabled: routeState.effectiveEnabled,
      scheduled: Boolean(routeState.nextScheduledAt || controls.canUnschedule),
      schedulePaused: routeState.schedulePaused,
      nextScheduledAt: routeState.nextScheduledAt,
      pauseUntil: routeState.pauseUntil,
      nextAction: routeState.nextAction,
      recommendedControl: routeState.recommendedControl
    },
    maintenanceWindow: maintenanceWindowState,
    actions: {
      enable: buildRouteLifecycleAction('enable', controls.canEnable, [
        controls.canEnable ? null : routeState.effectiveEnabled ? 'route-already-enabled' : null,
        lockedReason,
        settings.allowRuntimeEnable ? null : 'runtime-enable-disabled'
      ], {
        ...baseCommand,
        action: 'enable'
      }),
      disable: buildRouteLifecycleAction('disable', controls.canDisable, [
        controls.canDisable ? null : !routeState.effectiveEnabled ? 'route-already-disabled' : null,
        settings.allowRuntimeDisable ? null : 'runtime-disable-disabled'
      ], {
        ...baseCommand,
        action: 'disable',
        reasonRequired: settings.requireReasonForDisable
      }),
      schedule: buildRouteLifecycleAction('schedule', controls.canSchedule, [
        controls.canSchedule ? null : 'route-not-schedulable',
        lockedReason,
        routeState.effectiveEnabled ? null : 'route-disabled',
        routeState.effectiveStatus === 'blocked' ? 'route-blocked' : null,
        controls.scheduleCapacityRemaining > 0 || controls.canUnschedule ? null : 'schedule-capacity-reached',
        settings.allowScheduling ? null : 'scheduling-disabled',
        scheduleWindowReason
      ], {
        ...baseCommand,
        action: 'schedule',
        runAtRequired: true,
        cadenceRequired: true,
        allowedCadences: [...KNOWN_SCHEDULE_CADENCES].filter((cadence) => cadence !== 'manual')
      }),
      unschedule: buildRouteLifecycleAction('unschedule', controls.canUnschedule, [
        controls.canUnschedule ? null : 'route-not-scheduled',
        settings.allowScheduling ? null : 'scheduling-disabled'
      ], {
        ...baseCommand,
        action: 'unschedule'
      }),
      pauseSchedule: buildRouteLifecycleAction('pause-schedule', controls.canPauseSchedule, [
        controls.canPauseSchedule ? null : routeState.schedulePaused ? 'route-schedule-already-paused' : 'route-not-scheduled',
        settings.allowScheduling ? null : 'scheduling-disabled'
      ], {
        ...baseCommand,
        action: 'pause-schedule',
        pausedUntilRequired: true
      }),
      resumeSchedule: buildRouteLifecycleAction('resume-schedule', controls.canResumeSchedule, [
        controls.canResumeSchedule ? null : routeState.schedulePaused ? null : 'route-schedule-not-paused',
        controls.canUnschedule ? null : 'route-not-scheduled',
        settings.allowScheduling ? null : 'scheduling-disabled'
      ], {
        ...baseCommand,
        action: 'resume-schedule'
      })
    },
    nextActionCommand: routeState.recommendedControl === 'enable'
      ? 'enable'
      : routeState.recommendedControl?.includes('unschedule') ? 'unschedule'
        : routeState.recommendedControl?.includes('schedule') ? 'schedule'
          : routeState.recommendedControl?.includes('enable-or-activate') ? 'enable'
            : null
  };
}

function normalizePersistedSchedule(raw) {
  const schedule = normalizeSchedule(raw);
  return schedule.enabled || schedule.nextRunAt || schedule.pausedUntil ? schedule : null;
}

function normalizePersistedRoute(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = cleanString(source.name);
  const route = cleanString(source.route);
  const owner = cleanString(source.owner);
  const version = Number.isFinite(source.version) && source.version > 0 ? source.version : null;
  const key = cleanString(source.key) || cleanString(source.exportKey) || (owner && name && version ? `${owner}:${name}:v${version}` : null);

  return {
    key,
    name,
    route,
    owner,
    version,
    status: normalizeStatus(source.status),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : null,
    invoked: Number.isFinite(source.invoked) ? Math.max(0, Math.trunc(source.invoked)) : null,
    failures: Number.isFinite(source.failures) ? Math.max(0, Math.trunc(source.failures)) : null,
    lastInvokedAt: cleanString(source.lastInvokedAt),
    schedule: normalizePersistedSchedule(source.schedule),
    checkpointRevision: toPositiveInteger(source.checkpointRevision, index + 1)
  };
}

function normalizeCommandLedgerEntry(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const commandId = cleanString(source.commandId) || `persisted-command-${index + 1}`;
  return {
    commandId,
    idempotencyKey: cleanString(source.idempotencyKey) || commandId,
    action: cleanString(source.action)?.toLowerCase() || 'unknown',
    target: cleanString(source.target) || cleanString(source.name),
    result: cleanString(source.result) || cleanString(source.status) || 'applied',
    appliedAt: cleanString(source.appliedAt) || cleanString(source.completedAt),
    auditKey: cleanString(source.auditKey)
  };
}

function normalizePersistedState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const routes = asArray(source.routes || source.syscalls).map(normalizePersistedRoute);
  const commandLedger = asArray(source.commandLedger || source.commands).map(normalizeCommandLedgerEntry);
  const routeByName = new Map(routes.filter((route) => route.name).map((route) => [route.name, route]));
  const routeByRoute = new Map(routes.filter((route) => route.route).map((route) => [route.route, route]));
  const routeByKey = new Map(routes.filter((route) => route.key).map((route) => [route.key, route]));
  const ledgerByIdempotencyKey = new Map(commandLedger.map((entry) => [entry.idempotencyKey, entry]));

  return {
    version: toPositiveInteger(source.version || source.stateVersion, 1),
    checkpointId: cleanString(source.checkpointId) || cleanString(source.snapshotId) || 'volatile-startup',
    savedAt: cleanString(source.savedAt) || cleanString(source.capturedAt),
    bootId: cleanString(source.bootId) || cleanString(source.kernelBootId),
    routes,
    routeByName,
    routeByRoute,
    routeByKey,
    commandLedger,
    ledgerByIdempotencyKey
  };
}

function recoverSyscallsFromPersistedState(syscalls, persistedState, now) {
  const recovered = [];
  const recoveryEvents = [];

  for (const syscall of syscalls) {
    const persisted = persistedState.routeByKey.get(syscall.exportKey)
      || persistedState.routeByName.get(syscall.name)
      || persistedState.routeByRoute.get(syscall.route);

    if (!persisted) {
      recovered.push(syscall);
      continue;
    }

    const persistedStatusRank = PERSISTED_STATUS_PRECEDENCE[persisted.status] || 0;
    const bootStatusRank = PERSISTED_STATUS_PRECEDENCE[syscall.status] || 0;
    const persistedStatusHeld = RESTART_HOLD_STATUSES.has(persisted.status);
    const status = persistedStatusHeld || (RECOVERABLE_STATUSES.has(persisted.status) && persistedStatusRank > bootStatusRank)
      ? persisted.status
      : syscall.status;
    const enabled = persisted.enabled === false && syscall.enabled === true ? false : syscall.enabled;
    const invoked = persisted.invoked === null ? syscall.invoked : Math.max(syscall.invoked, persisted.invoked);
    const failures = persisted.failures === null ? syscall.failures : Math.max(syscall.failures, persisted.failures);
    const lastInvokedAt = [syscall.lastInvokedAt, persisted.lastInvokedAt].filter(Boolean).sort().at(-1) || null;
    const schedule = persisted.schedule
      ? {
          ...syscall.schedule,
          ...persisted.schedule,
          recoveredFromCheckpoint: true,
          checkpointId: persistedState.checkpointId,
          checkpointRevision: persisted.checkpointRevision
        }
      : syscall.schedule;
    const recoverySemantics = {
      schema: 'aios.syscall.route-recovery-semantics.v1',
      checkpointId: persistedState.checkpointId,
      checkpointRevision: persisted.checkpointRevision,
      recoveredAt: now,
      statusPolicy: persistedStatusHeld ? 'persisted-hold-wins'
        : status !== syscall.status ? 'persisted-higher-precedence-wins'
          : 'boot-status-retained',
      enabledPolicy: enabled !== syscall.enabled ? 'persisted-disable-wins' : 'boot-enabled-retained',
      counterPolicy: invoked !== syscall.invoked || failures !== syscall.failures ? 'max-counter-replay' : 'boot-counters-retained',
      schedulePolicy: persisted.schedule ? 'checkpoint-schedule-restored' : 'boot-schedule-retained',
      dispatchableUntilReviewed: !RESTART_HOLD_STATUSES.has(status)
    };
    const next = {
      ...syscall,
      status,
      enabled,
      invoked,
      failures,
      lastInvokedAt,
      schedule,
      recoverySemantics
    };

    recovered.push(next);
    recoveryEvents.push({
      type: 'syscall.registry.route-state-recovered',
      at: now,
      checkpointId: persistedState.checkpointId,
      checkpointRevision: persisted.checkpointRevision,
      name: syscall.name,
      route: syscall.route,
      previousStatus: syscall.status,
      persistedStatus: persisted.status,
      effectiveStatus: status,
      restoredStatus: status !== syscall.status,
      restoredEnabled: enabled !== syscall.enabled,
      restoredCounters: invoked !== syscall.invoked || failures !== syscall.failures,
      restoredSchedule: schedule !== syscall.schedule,
      recoverySemantics
    });
  }

  return { syscalls: recovered, events: recoveryEvents };
}

function normalizeRequestPriority(value) {
  const priority = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_REQUEST_PRIORITIES.has(priority) ? priority : 'normal';
}

function normalizeRequestIntent(value) {
  const intent = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KNOWN_REQUEST_INTENTS.has(intent) ? intent : 'invoke';
}

function normalizeTenantWorkspaceBinding(raw, index, fallbackTenantId, fallbackWorkspaceId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const tenantId = cleanString(source.tenantId) || cleanString(source.tenant) || (index === 0 ? fallbackTenantId : null);
  const workspaces = uniqueStrings([
    ...normalizeStringList(source.workspaces || source.workspaceIds),
    cleanString(source.workspaceId) || cleanString(source.workspace) || (index === 0 ? fallbackWorkspaceId : null)
  ].filter(Boolean).map((entry) => entry.toLowerCase()));

  return tenantId
    ? {
        tenantId: tenantId.toLowerCase(),
        workspaces
      }
    : null;
}

function normalizeTenantWorkspaceBindings(value, fallbackTenantId, fallbackWorkspaceId) {
  const fallback = normalizeTenantWorkspaceBinding({}, 0, fallbackTenantId, fallbackWorkspaceId);

  if (Array.isArray(value)) {
    return uniqueScopeBindings([
      fallback,
      ...value.map((entry, index) => normalizeTenantWorkspaceBinding(entry, index + 1, fallbackTenantId, fallbackWorkspaceId))
    ]);
  }

  if (value && typeof value === 'object') {
    return uniqueScopeBindings([
      fallback,
      ...Object.entries(value).map(([tenantId, workspaces], index) => normalizeTenantWorkspaceBinding({
        tenantId,
        workspaces: Array.isArray(workspaces) ? workspaces : [workspaces]
      }, index + 1, fallbackTenantId, fallbackWorkspaceId))
    ]);
  }

  return uniqueScopeBindings([fallback]);
}

function uniqueScopeBindings(bindings) {
  const byTenant = new Map();

  for (const binding of bindings.filter(Boolean)) {
    const current = byTenant.get(binding.tenantId) || new Set();
    for (const workspaceId of binding.workspaces) current.add(workspaceId);
    byTenant.set(binding.tenantId, current);
  }

  return [...byTenant.entries()].map(([tenantId, workspaces]) => ({
    tenantId,
    workspaces: [...workspaces].sort()
  }));
}

function workspaceBoundToTenant(bindings, tenantId, workspaceId) {
  const binding = bindings.find((entry) => entry.tenantId === tenantId);
  return Boolean(binding?.workspaces.includes(workspaceId));
}

function pathIsInsideWorkspace(path, workspaceRoot) {
  if (!path || !workspaceRoot) return false;
  const normalizedPath = normalizeBoundaryPath(path);
  const normalizedRoot = normalizeBoundaryPath(workspaceRoot);
  if (!normalizedPath || !normalizedRoot) return false;
  if (normalizedPath === normalizedRoot) return true;
  return normalizedPath.startsWith(`${normalizedRoot.replace(/\/$/, '')}/`);
}

function buildPayloadResourceBoundary(request, syscall, runtimeState) {
  const payload = request.payload || {};
  const domain = syscall?.metadata?.family || syscall?.capabilities?.domain || 'kernel';
  const pathAccess = syscall?.metadata?.pathAccess || 'none';
  const paths = collectBoundaryPaths(payload);
  const workspaceRoot = runtimeState.boundaryPolicy.workspaceRoot;
  const tenantInPayload = cleanString(payload.tenantId) || cleanString(payload.tenant);
  const workspaceInPayload = cleanString(payload.workspaceId) || cleanString(payload.workspace);
  const tenantMismatch = tenantInPayload && tenantInPayload.toLowerCase() !== request.tenantId.toLowerCase();
  const workspaceMismatch = workspaceInPayload && workspaceInPayload.toLowerCase() !== request.workspaceId.toLowerCase();
  const pathScopedDomain = ['filesystem', 'process', 'source-control', 'verification'].includes(domain)
    || pathAccess.includes('workspace')
    || pathAccess.includes('repository')
    || pathAccess.includes('path');
  const pathDiagnostics = paths.map((path) => {
    const absolute = path.startsWith('/');
    const homeRelative = path === '~' || path.startsWith('~/');
    const traversesParent = path.split('/').includes('..');
    const workspaceAnchored = workspaceRoot ? pathIsInsideWorkspace(path, workspaceRoot) : !absolute;
    const allowed = !homeRelative
      && !traversesParent
      && (!absolute || (runtimeState.boundaryPolicy.allowAbsoluteWorkspacePaths && workspaceAnchored));

    return {
      path,
      absolute,
      homeRelative,
      traversesParent,
      workspaceAnchored,
      allowed,
      issue: allowed ? null
        : homeRelative ? 'resource-path-home-boundary'
          : traversesParent ? 'resource-path-parent-traversal'
            : absolute ? 'resource-path-absolute-denied'
              : 'resource-path-outside-workspace'
    };
  });
  const deniedPaths = pathDiagnostics.filter((entry) => !entry.allowed);
  const issues = uniqueStrings([
    tenantMismatch ? 'payload-tenant-boundary-denied' : null,
    workspaceMismatch ? 'payload-workspace-boundary-denied' : null,
    pathScopedDomain && paths.length === 0 && runtimeState.boundaryPolicy.requireResourceScopeForPathAccess
      ? 'resource-scope-missing'
      : null,
    ...deniedPaths.map((entry) => entry.issue)
  ]);

  return {
    schema: 'aios.syscall.payload-resource-boundary.v1',
    domain,
    pathAccess,
    state: issues.length === 0 ? 'resource-scope-granted' : 'resource-scope-denied',
    ok: issues.length === 0,
    issues,
    requestedScope: {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      payloadTenantId: tenantInPayload,
      payloadWorkspaceId: workspaceInPayload
    },
    pathPolicy: {
      required: pathScopedDomain,
      requireResourceScopeForPathAccess: runtimeState.boundaryPolicy.requireResourceScopeForPathAccess,
      workspaceRoot,
      allowAbsoluteWorkspacePaths: runtimeState.boundaryPolicy.allowAbsoluteWorkspacePaths,
      checkedPaths: pathDiagnostics.length,
      deniedPaths: deniedPaths.length
    },
    paths: pathDiagnostics
  };
}

function normalizeClientRuntimeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const tenantId = cleanString(source.tenantId) || cleanString(source.tenant) || DEFAULT_TENANT_ID;
  const workspaceId = cleanString(source.workspaceId) || cleanString(source.workspace) || DEFAULT_WORKSPACE_ID;
  const policySource = source.boundaryPolicy && typeof source.boundaryPolicy === 'object'
    ? source.boundaryPolicy
    : source.permissionBoundary && typeof source.permissionBoundary === 'object'
      ? source.permissionBoundary
      : {};
  const roles = uniqueStrings([
    ...normalizeStringList(source.roles),
    INTENT_REQUIRED_ROLES.inspect
  ]);

  return {
    clientId: cleanString(source.clientId) || cleanString(source.id) || 'anonymous-client',
    sessionId: cleanString(source.sessionId) || cleanString(source.session) || 'anonymous-session',
    channel: cleanString(source.channel) || 'hosted-kernel',
    tenantId,
    workspaceId,
    roles,
    allowedTenants: uniqueStrings([tenantId.toLowerCase(), ...normalizeStringList(source.allowedTenants)]),
    allowedWorkspaces: uniqueStrings([workspaceId.toLowerCase(), ...normalizeStringList(source.allowedWorkspaces)]),
    tenantWorkspaceBindings: normalizeTenantWorkspaceBindings(
      source.tenantWorkspaceBindings || source.workspaceTenantBindings || policySource.tenantWorkspaceBindings,
      tenantId,
      workspaceId
    ),
    requestIdPrefix: cleanString(source.requestIdPrefix) || 'syscall-request',
    handoffRoute: cleanString(source.handoffRoute) || `${DEFAULT_ROUTE}/handoff`,
    requireRegisteredRoute: toBoolean(source.requireRegisteredRoute, true),
    boundaryPolicy: {
      mode: normalizeBoundaryMode(policySource.mode || source.boundaryMode),
      enforceTenantIsolation: toBoolean(policySource.enforceTenantIsolation, true),
      enforceWorkspaceIsolation: toBoolean(policySource.enforceWorkspaceIsolation, true),
      enforceTenantWorkspaceBinding: toBoolean(policySource.enforceTenantWorkspaceBinding, true),
      requireRoleForInspect: toBoolean(policySource.requireRoleForInspect, true),
      auditRoute: cleanString(policySource.auditRoute) || cleanString(source.auditRoute) || `${DEFAULT_ROUTE}/boundary-audit`,
      deniedHandoffRoute: cleanString(policySource.deniedHandoffRoute) || `${DEFAULT_ROUTE}/boundary-denied`,
      leaseRoute: cleanString(policySource.leaseRoute) || cleanString(source.boundaryLeaseRoute) || `${DEFAULT_ROUTE}/boundary-lease`,
      requireLeaseForDispatch: toBoolean(policySource.requireLeaseForDispatch ?? source.requireBoundaryLeaseForDispatch, true),
      leaseTtlSeconds: toPositiveInteger(policySource.leaseTtlSeconds || source.boundaryLeaseTtlSeconds, 300),
      workspaceRoot: normalizeBoundaryPath(policySource.workspaceRoot || source.workspaceRoot),
      allowAbsoluteWorkspacePaths: toBoolean(policySource.allowAbsoluteWorkspacePaths ?? source.allowAbsoluteWorkspacePaths, false),
      requireResourceScopeForPathAccess: toBoolean(policySource.requireResourceScopeForPathAccess ?? source.requireResourceScopeForPathAccess, false),
      proofMode: cleanString(policySource.proofMode) || 'decision-envelope'
    }
  };
}

function normalizeClientRequest(raw, index, runtimeState) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const target = cleanString(source.target) || cleanString(source.name) || cleanString(source.syscall);
  const route = cleanString(source.route);
  const requestedAt = cleanString(source.requestedAt);
  const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
    ? source.payload
    : {};

  return {
    requestId: cleanString(source.requestId) || cleanString(source.id) || `${runtimeState.requestIdPrefix}-${index + 1}`,
    clientId: cleanString(source.clientId) || runtimeState.clientId,
    sessionId: cleanString(source.sessionId) || runtimeState.sessionId,
    channel: cleanString(source.channel) || runtimeState.channel,
    tenantId: cleanString(source.tenantId) || cleanString(source.tenant) || runtimeState.tenantId,
    workspaceId: cleanString(source.workspaceId) || cleanString(source.workspace) || runtimeState.workspaceId,
    roles: uniqueStrings([...runtimeState.roles, ...normalizeStringList(source.roles)]),
    intent: normalizeRequestIntent(source.intent),
    target,
    route,
    requestedAt,
    priority: normalizeRequestPriority(source.priority),
    payload,
    idempotencyKey: cleanString(source.idempotencyKey) || `${runtimeState.sessionId}:${target || route || index + 1}`,
    traceparent: cleanString(source.traceparent)
  };
}

function buildRoleBoundaryGrant(request, syscall, requiredRole, roleRequired) {
  const allowedRoles = uniqueStrings([requiredRole, ...asArray(syscall?.permissions?.allowedRoles)]
    .filter(Boolean)
    .map((role) => role.toLowerCase()));
  const suppliedRoles = uniqueStrings(request.roles.map((role) => role.toLowerCase()));
  const matchedRoles = suppliedRoles.filter((role) => allowedRoles.includes(role));
  const requiredRoleMatched = !roleRequired || matchedRoles.includes(requiredRole.toLowerCase());

  return {
    requiredRole,
    roleRequired,
    allowedRoles,
    suppliedRoles,
    matchedRoles,
    requiredRoleMatched,
    grantState: !roleRequired ? 'not-required'
      : requiredRoleMatched ? 'granted'
        : matchedRoles.length > 0 ? 'partial-role-match'
          : 'missing-required-role'
  };
}

function buildScopeBoundaryGrant(request, syscall, runtimeState, boundaryMode) {
  const requestTenant = request.tenantId.toLowerCase();
  const requestWorkspace = request.workspaceId.toLowerCase();
  const runtimeTenantScoped = runtimeState.allowedTenants.includes(requestTenant);
  const runtimeWorkspaceScoped = runtimeState.allowedWorkspaces.includes(requestWorkspace);
  const routeTenantScoped = !syscall || syscall.permissions.allowedTenants.includes(requestTenant);
  const routeWorkspaceScoped = !syscall || syscall.permissions.allowedWorkspaces.includes(requestWorkspace);
  const enforceTenant = runtimeState.boundaryPolicy.enforceTenantIsolation
    && ['tenant-workspace', 'tenant', 'tenant-only'].includes(boundaryMode);
  const enforceWorkspace = runtimeState.boundaryPolicy.enforceWorkspaceIsolation
    && ['tenant-workspace', 'workspace', 'workspace-only'].includes(boundaryMode);
  const enforceBinding = runtimeState.boundaryPolicy.enforceTenantWorkspaceBinding
    && enforceTenant
    && enforceWorkspace;
  const tenantWorkspaceBound = !enforceBinding
    || workspaceBoundToTenant(runtimeState.tenantWorkspaceBindings, requestTenant, requestWorkspace);

  return {
    requestTenant,
    requestWorkspace,
    runtimeTenantScoped,
    runtimeWorkspaceScoped,
    routeTenantScoped,
    routeWorkspaceScoped,
    enforceTenant,
    enforceWorkspace,
    enforceBinding,
    tenantWorkspaceBound,
    tenantScoped: !enforceTenant || (runtimeTenantScoped && routeTenantScoped),
    workspaceScoped: !enforceWorkspace || (runtimeWorkspaceScoped && routeWorkspaceScoped),
    scopeState: !tenantWorkspaceBound ? 'workspace-not-bound-to-tenant'
      : (!enforceTenant && !enforceWorkspace) ? 'kernel-internal'
        : 'scoped'
  };
}

function buildBoundaryDecision(request, syscall, runtimeState) {
  const boundaryMode = normalizeBoundaryMode(syscall?.permissions?.boundary || runtimeState.boundaryPolicy.mode);
  const requiredRole = syscall?.permissions?.requiredRolesByIntent?.[request.intent] || INTENT_REQUIRED_ROLES[request.intent];
  const roleRequired = requiredRole && (request.intent !== 'inspect' || runtimeState.boundaryPolicy.requireRoleForInspect);
  const roleGrant = buildRoleBoundaryGrant(request, syscall, requiredRole, roleRequired);
  const scopeGrant = buildScopeBoundaryGrant(request, syscall, runtimeState, boundaryMode);
  const baseDecision = {
    requiredRole,
    matchedRoles: roleGrant.matchedRoles,
    roleGrant,
    tenantScoped: scopeGrant.tenantScoped,
    workspaceScoped: scopeGrant.workspaceScoped,
    tenantWorkspaceBound: scopeGrant.tenantWorkspaceBound,
    boundaryMode,
    enforcedScopes: [
      scopeGrant.enforceTenant ? 'tenant' : null,
      scopeGrant.enforceWorkspace ? 'workspace' : null,
      scopeGrant.enforceBinding ? 'tenant-workspace-binding' : null,
      roleRequired ? 'role' : null
    ].filter(Boolean),
    scopeGrant
  };

  if (!syscall) {
    if (!scopeGrant.tenantScoped) return { ...baseDecision, ok: false, issue: 'tenant-boundary-denied' };
    if (!scopeGrant.workspaceScoped) return { ...baseDecision, ok: false, issue: 'workspace-boundary-denied' };
    if (!scopeGrant.tenantWorkspaceBound) return { ...baseDecision, ok: false, issue: 'workspace-tenant-binding-denied' };
    return { ...baseDecision, ok: true, issue: null };
  }

  if (!scopeGrant.tenantScoped) return { ...baseDecision, ok: false, issue: 'tenant-boundary-denied' };
  if (!scopeGrant.workspaceScoped) return { ...baseDecision, ok: false, issue: 'workspace-boundary-denied' };
  if (!scopeGrant.tenantWorkspaceBound) return { ...baseDecision, ok: false, issue: 'workspace-tenant-binding-denied' };
  if (!roleGrant.requiredRoleMatched) return { ...baseDecision, ok: false, issue: 'role-permission-denied' };

  return { ...baseDecision, ok: true, issue: null };
}

function buildBoundaryProof(request, syscall, boundary, resourceBoundary, runtimeState, accepted, issues, now) {
  const decision = boundary.ok && accepted ? 'allow' : 'deny';
  const blockedBy = boundary.issue || issues[0] || null;

  return {
    proofId: `${request.requestId}:boundary-proof`,
    proofMode: runtimeState.boundaryPolicy.proofMode,
    generatedAt: now,
    decision,
    blockedBy,
    auditRoute: decision === 'allow'
      ? runtimeState.boundaryPolicy.auditRoute
      : runtimeState.boundaryPolicy.deniedHandoffRoute,
    subject: {
      requestId: request.requestId,
      clientId: request.clientId,
      sessionId: request.sessionId,
      intent: request.intent,
      syscall: syscall?.name || request.target || null,
      route: syscall?.route || request.route || null
    },
    scopes: {
      requestedTenantId: request.tenantId,
      requestedWorkspaceId: request.workspaceId,
      syscallTenantId: syscall?.tenantId || null,
      syscallWorkspaceId: syscall?.workspaceId || null,
      tenantScoped: boundary.tenantScoped,
      workspaceScoped: boundary.workspaceScoped,
      boundaryMode: boundary.boundaryMode,
      enforcedScopes: boundary.enforcedScopes,
      runtimeTenantScoped: boundary.scopeGrant.runtimeTenantScoped,
      runtimeWorkspaceScoped: boundary.scopeGrant.runtimeWorkspaceScoped,
      routeTenantScoped: boundary.scopeGrant.routeTenantScoped,
      routeWorkspaceScoped: boundary.scopeGrant.routeWorkspaceScoped,
      tenantWorkspaceBound: boundary.tenantWorkspaceBound,
      scopeState: boundary.scopeGrant.scopeState,
      resourceScopeState: resourceBoundary.state,
      resourceScopeIssues: resourceBoundary.issues
    },
    resources: {
      schema: resourceBoundary.schema,
      state: resourceBoundary.state,
      domain: resourceBoundary.domain,
      pathAccess: resourceBoundary.pathAccess,
      requestedScope: resourceBoundary.requestedScope,
      pathPolicy: resourceBoundary.pathPolicy,
      checkedPaths: resourceBoundary.paths.map((entry) => ({
        path: entry.path,
        allowed: entry.allowed,
        issue: entry.issue
      }))
    },
    roles: {
      requiredRole: boundary.requiredRole,
      roleRequired: boundary.roleGrant.roleRequired,
      grantState: boundary.roleGrant.grantState,
      allowedRoles: boundary.roleGrant.allowedRoles,
      matchedRoles: boundary.matchedRoles,
      suppliedRoleCount: request.roles.length
    },
    remediation: decision === 'allow'
      ? 'handoff-audit-record-ready'
      : blockedBy === 'role-permission-denied' ? 'grant-required-role-or-change-intent'
        : blockedBy === 'tenant-boundary-denied' ? 'use-authorized-tenant-scope'
          : blockedBy === 'workspace-boundary-denied' ? 'use-authorized-workspace-scope'
            : blockedBy === 'workspace-tenant-binding-denied' ? 'bind-workspace-to-authorized-tenant'
              : 'correct-request-and-replay'
  };
}

function buildBoundaryLease(request, syscall, boundary, runtimeState, accepted, now) {
  const tenantId = request.tenantId.toLowerCase();
  const workspaceId = request.workspaceId.toLowerCase();
  const syscallTenantId = syscall?.tenantId?.toLowerCase() || null;
  const syscallWorkspaceId = syscall?.workspaceId?.toLowerCase() || null;
  const crossTenantRoute = Boolean(syscallTenantId && syscallTenantId !== tenantId);
  const crossWorkspaceRoute = Boolean(syscallWorkspaceId && syscallWorkspaceId !== workspaceId);
  const leaseRequired = runtimeState.boundaryPolicy.requireLeaseForDispatch
    && request.intent !== 'inspect'
    && (boundary.enforcedScopes.length > 0 || crossTenantRoute || crossWorkspaceRoute);
  const leaseState = !leaseRequired
    ? 'not-required'
    : accepted && boundary.ok ? 'issued'
      : 'denied';
  const expiresAt = leaseState === 'issued'
    ? addSecondsToInstant(now, runtimeState.boundaryPolicy.leaseTtlSeconds)
    : null;

  return {
    schema: 'aios.syscall.boundary-lease.v1',
    leaseId: `${request.requestId}:boundary-lease`,
    issuedAt: leaseState === 'issued' ? now : null,
    expiresAt,
    ttlSeconds: leaseState === 'issued' ? runtimeState.boundaryPolicy.leaseTtlSeconds : null,
    state: leaseState,
    required: leaseRequired,
    route: runtimeState.boundaryPolicy.leaseRoute,
    token: leaseState === 'issued'
      ? `${request.requestId}:${tenantId}:${workspaceId}:${request.intent}:lease`
      : null,
    subject: {
      requestId: request.requestId,
      clientId: request.clientId,
      sessionId: request.sessionId,
      intent: request.intent,
      syscall: syscall?.name || request.target || null,
      route: syscall?.route || request.route || null
    },
    scope: {
      tenantId,
      workspaceId,
      syscallTenantId,
      syscallWorkspaceId,
      boundaryMode: boundary.boundaryMode,
      crossTenantRoute,
      crossWorkspaceRoute,
      enforcedScopes: boundary.enforcedScopes,
      tenantWorkspaceBound: boundary.tenantWorkspaceBound
    },
    role: {
      requiredRole: boundary.requiredRole,
      matchedRoles: boundary.matchedRoles,
      grantState: boundary.roleGrant.grantState
    },
    verification: {
      proofId: `${request.requestId}:boundary-proof`,
      auditRoute: runtimeState.boundaryPolicy.auditRoute,
      replayScope: 'request-idempotency-key',
      dispatchClaimRequired: leaseRequired,
      denialReason: leaseState === 'denied' ? boundary.issue || 'handoff-not-accepted' : null
    }
  };
}

function normalizeRouteLookupKey(value) {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function indexRouteIdentity(index, kind, key, syscall) {
  if (!key) return;
  const bucket = kind === 'name' ? index.byName : index.byRoute;
  const current = bucket.get(key) || [];
  current.push(syscall);
  bucket.set(key, current);
}

function buildRouteIdentityIndex(syscalls) {
  const index = {
    byName: new Map(),
    byRoute: new Map()
  };

  for (const syscall of syscalls) {
    indexRouteIdentity(index, 'name', normalizeRouteLookupKey(syscall.name), syscall);
    indexRouteIdentity(index, 'route', normalizeRouteLookupKey(syscall.route), syscall);
  }

  const duplicateNames = [...index.byName.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([lookupKey, matches]) => ({
      lookupKey,
      names: matches.map((match) => match.name),
      routes: matches.map((match) => match.route),
      owners: matches.map((match) => match.owner)
    }));
  const duplicateRoutes = [...index.byRoute.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([lookupKey, matches]) => ({
      lookupKey,
      names: matches.map((match) => match.name),
      route: matches[0]?.route || lookupKey,
      owners: matches.map((match) => match.owner)
    }));

  return {
    ...index,
    contract: {
      schema: 'aios.syscall.route-identity-index.v1',
      lookupModes: ['target-name', 'route'],
      normalizedKey: 'trimmed-lowercase',
      names: index.byName.size,
      routes: index.byRoute.size,
      duplicateNames,
      duplicateRoutes,
      issues: [
        ...duplicateNames.map((entry) => ({
          code: 'route-identity.name.duplicate',
          severity: 'error',
          lookupKey: entry.lookupKey,
          routes: entry.routes
        })),
        ...duplicateRoutes.map((entry) => ({
          code: 'route-identity.route.duplicate',
          severity: 'error',
          lookupKey: entry.lookupKey,
          names: entry.names
        }))
      ]
    }
  };
}

function summarizeRouteLookupCandidate(syscall, matchType) {
  return {
    name: syscall.name,
    route: syscall.route,
    owner: syscall.owner,
    version: syscall.version,
    status: syscall.status,
    enabled: syscall.enabled,
    tenantId: syscall.tenantId,
    workspaceId: syscall.workspaceId,
    matchType
  };
}

function resolveSyscallForRequest(request, routeIdentity) {
  const targetKey = normalizeRouteLookupKey(request.target);
  const routeKey = normalizeRouteLookupKey(request.route);
  const targetMatches = targetKey ? routeIdentity.byName.get(targetKey) || [] : [];
  const routeMatches = routeKey ? routeIdentity.byRoute.get(routeKey) || [] : [];
  const candidatesByExportKey = new Map();

  for (const syscall of targetMatches) {
    candidatesByExportKey.set(syscall.exportKey, summarizeRouteLookupCandidate(syscall, 'target-name'));
  }

  for (const syscall of routeMatches) {
    candidatesByExportKey.set(syscall.exportKey, summarizeRouteLookupCandidate(syscall, 'route'));
  }

  const candidates = [...candidatesByExportKey.values()];
  const issues = [];
  const uniqueTarget = targetMatches.length === 1 ? targetMatches[0] : null;
  const uniqueRoute = routeMatches.length === 1 ? routeMatches[0] : null;

  if (targetMatches.length > 1) issues.push('route-identity-target-ambiguous');
  if (routeMatches.length > 1) issues.push('route-identity-route-ambiguous');
  if (uniqueTarget && uniqueRoute && uniqueTarget.exportKey !== uniqueRoute.exportKey) {
    issues.push('route-identity-target-route-conflict');
  }

  const syscall = issues.length === 0
    ? uniqueTarget || uniqueRoute || null
    : null;

  return {
    schema: 'aios.syscall.route-lookup.v1',
    requestedTarget: request.target || null,
    requestedRoute: request.route || null,
    targetLookupKey: targetKey,
    routeLookupKey: routeKey,
    matchState: syscall ? 'resolved'
      : issues.length > 0 ? 'ambiguous-or-conflicting'
        : 'not-found',
    matchType: syscall
      ? uniqueTarget ? 'target-name'
        : 'route'
      : null,
    syscall,
    candidates,
    issues,
    candidateCount: candidates.length
  };
}

function buildClientRuntimeContract(syscalls, lifecycle, rawRuntimeState, rawRequests, now) {
  const runtimeState = normalizeClientRuntimeState(rawRuntimeState);
  const requests = asArray(rawRequests).map((request, index) => normalizeClientRequest(request, index, runtimeState));
  const routeIdentity = buildRouteIdentityIndex(syscalls);
  const routeStatesByName = new Map(lifecycle.routeStates.map((state) => [state.name, state]));
  const handoffs = requests.map((request) => {
    const routeLookup = resolveSyscallForRequest(request, routeIdentity);
    const syscall = routeLookup.syscall;
    const routeState = syscall ? routeStatesByName.get(syscall.name) : null;
    const boundary = buildBoundaryDecision(request, syscall, runtimeState);
    const resourceBoundary = buildPayloadResourceBoundary(request, syscall, runtimeState);
    const issues = [];

    if (routeLookup.issues.length > 0) issues.push(...routeLookup.issues);
    if (!syscall && routeLookup.issues.length === 0 && runtimeState.requireRegisteredRoute) issues.push('route-not-registered');
    if (!boundary.ok) issues.push(boundary.issue);
    if (!resourceBoundary.ok) issues.push(...resourceBoundary.issues);
    if (request.intent === 'cancel' && !request.idempotencyKey) issues.push('cancel-idempotency-required');
    if (routeState?.effectiveStatus === 'blocked') issues.push('route-blocked');
    if (routeState && routeState.effectiveEnabled === false && request.intent === 'invoke') issues.push('route-disabled');
    if (routeState?.routeClientWorkflow && !routeState.routeClientWorkflow.supportedIntents.includes(request.intent)) {
      issues.push('intent-not-supported-by-route-workflow');
    }
    if (request.intent === 'schedule' && !request.payload?.runAt && !syscall?.schedule.nextRunAt) issues.push('schedule-runAt-required');

    const accepted = issues.length === 0;
    const boundaryProof = buildBoundaryProof(request, syscall, boundary, resourceBoundary, runtimeState, accepted, issues, now);
    const boundaryLease = buildBoundaryLease(request, syscall, boundary, runtimeState, accepted, now);
    const workflow = !accepted
      ? (issues.includes('route-blocked') ? 'operator-review' : 'client-correction')
      : request.intent === 'inspect' ? 'return-registry-snapshot'
        : request.intent === 'schedule' ? 'schedule-syscall'
          : request.intent === 'cancel' ? 'cancel-pending-syscall'
            : routeState?.nextAction === 'dispatch-scheduled-syscall' ? 'dispatch-syscall'
              : 'invoke-syscall';

    return {
      handoffId: `${request.requestId}:handoff`,
      accepted,
      workflow,
      rejectionReason: issues[0] || null,
      issues,
      requestId: request.requestId,
      clientId: request.clientId,
      sessionId: request.sessionId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      syscall: syscall ? syscall.name : request.target,
      route: syscall?.route || request.route || null,
      routeLookup: {
        schema: routeLookup.schema,
        requestedTarget: routeLookup.requestedTarget,
        requestedRoute: routeLookup.requestedRoute,
        targetLookupKey: routeLookup.targetLookupKey,
        routeLookupKey: routeLookup.routeLookupKey,
        matchState: routeLookup.matchState,
        matchType: routeLookup.matchType,
        candidateCount: routeLookup.candidateCount,
        candidates: routeLookup.candidates,
        issues: routeLookup.issues
      },
      syscallMetadata: syscall?.metadata || null,
      routeClientWorkflow: routeState?.routeClientWorkflow || null,
      priority: request.priority,
      dispatchAfter: request.intent === 'schedule'
        ? (request.payload?.runAt || syscall?.schedule.nextRunAt || null)
        : null,
      auditKey: `${request.clientId}:${request.idempotencyKey}`,
      traceparent: request.traceparent,
      boundary: {
        tenantScoped: boundary.tenantScoped,
        workspaceScoped: boundary.workspaceScoped,
        tenantWorkspaceBound: boundary.tenantWorkspaceBound,
        boundaryMode: boundary.boundaryMode,
        enforcedScopes: boundary.enforcedScopes,
        requiredRole: boundary.requiredRole,
        matchedRoles: boundary.matchedRoles,
        roleGrantState: boundary.roleGrant.grantState,
        scopeState: boundary.scopeGrant.scopeState,
        runtimeTenantScoped: boundary.scopeGrant.runtimeTenantScoped,
        runtimeWorkspaceScoped: boundary.scopeGrant.runtimeWorkspaceScoped,
        routeTenantScoped: boundary.scopeGrant.routeTenantScoped,
        routeWorkspaceScoped: boundary.scopeGrant.routeWorkspaceScoped,
        syscallTenantId: syscall?.tenantId || null,
        syscallWorkspaceId: syscall?.workspaceId || null,
        resourceScopeState: resourceBoundary.state,
        resourceScopeIssues: resourceBoundary.issues,
        resourcePathCount: resourceBoundary.paths.length,
        deniedResourcePathCount: resourceBoundary.pathPolicy.deniedPaths
      },
      resourceBoundary,
      boundaryProof,
      boundaryLease,
      auditHandoff: {
        route: boundaryProof.auditRoute,
        proofId: boundaryProof.proofId,
        decision: boundaryProof.decision,
        blockedBy: boundaryProof.blockedBy,
        handoffRequired: !accepted || boundaryProof.decision === 'allow',
        packet: {
          auditKey: `${request.clientId}:${request.idempotencyKey}`,
          requestId: request.requestId,
          boundaryMode: boundary.boundaryMode,
          enforcedScopes: boundary.enforcedScopes,
          scopeState: boundary.scopeGrant.scopeState,
          roleGrantState: boundary.roleGrant.grantState,
          tenantWorkspaceBound: boundary.tenantWorkspaceBound,
          resourceScopeState: resourceBoundary.state,
          resourceScopeIssues: resourceBoundary.issues,
          resourcePathCount: resourceBoundary.paths.length,
          deniedResourcePathCount: resourceBoundary.pathPolicy.deniedPaths,
          boundaryLeaseId: boundaryLease.leaseId,
          boundaryLeaseState: boundaryLease.state
        }
      }
    };
  });
  const boundaryProofs = handoffs.map((handoff) => handoff.boundaryProof);
  const boundaryLeases = handoffs.map((handoff) => handoff.boundaryLease);

  return {
    version: 1,
    generatedAt: now,
    state: runtimeState,
    requests,
    handoffs,
    boundaryProofs,
    boundaryLeases,
    summary: {
      requestCount: requests.length,
      acceptedHandoffs: handoffs.filter((handoff) => handoff.accepted).length,
      rejectedHandoffs: handoffs.filter((handoff) => !handoff.accepted).length,
      urgentHandoffs: handoffs.filter((handoff) => handoff.priority === 'urgent').length,
      boundaryRejections: handoffs.filter((handoff) => (
        handoff.issues.includes('tenant-boundary-denied')
        || handoff.issues.includes('workspace-boundary-denied')
        || handoff.issues.includes('workspace-tenant-binding-denied')
        || handoff.issues.includes('role-permission-denied')
        || handoff.issues.includes('payload-tenant-boundary-denied')
        || handoff.issues.includes('payload-workspace-boundary-denied')
        || handoff.issues.includes('resource-scope-missing')
        || handoff.issues.some((issue) => issue.startsWith('resource-path-'))
      )).length,
      resourceBoundaryRejections: handoffs.filter((handoff) => !handoff.resourceBoundary.ok).length,
      deniedResourcePaths: handoffs.reduce((total, handoff) => total + handoff.resourceBoundary.pathPolicy.deniedPaths, 0),
      payloadTenantScopeRejections: handoffs.filter((handoff) => handoff.issues.includes('payload-tenant-boundary-denied')).length,
      payloadWorkspaceScopeRejections: handoffs.filter((handoff) => handoff.issues.includes('payload-workspace-boundary-denied')).length,
      boundaryProofs: boundaryProofs.length,
      allowedBoundaryProofs: boundaryProofs.filter((proof) => proof.decision === 'allow').length,
      deniedBoundaryProofs: boundaryProofs.filter((proof) => proof.decision === 'deny').length,
      boundaryLeases: boundaryLeases.length,
      issuedBoundaryLeases: boundaryLeases.filter((lease) => lease.state === 'issued').length,
      deniedBoundaryLeases: boundaryLeases.filter((lease) => lease.state === 'denied').length,
      requiredBoundaryLeases: boundaryLeases.filter((lease) => lease.required).length,
      auditHandoffs: handoffs.filter((handoff) => handoff.auditHandoff.handoffRequired).length,
      tenantWorkspaceBindingRejections: handoffs.filter((handoff) => handoff.issues.includes('workspace-tenant-binding-denied')).length,
      scopedRoleRejections: handoffs.filter((handoff) => handoff.issues.includes('role-permission-denied')).length,
      routeLookupRejections: handoffs.filter((handoff) => handoff.routeLookup.issues.length > 0).length,
      unresolvedRouteLookups: handoffs.filter((handoff) => handoff.routeLookup.matchState === 'not-found').length,
      ambiguousRouteLookups: handoffs.filter((handoff) => handoff.routeLookup.matchState === 'ambiguous-or-conflicting').length,
      unsupportedWorkflowIntents: handoffs.filter((handoff) => handoff.issues.includes('intent-not-supported-by-route-workflow')).length,
      routeWorkflowContracts: handoffs.filter((handoff) => handoff.routeClientWorkflow).length,
      duplicateRouteIdentityIssues: routeIdentity.contract.issues.length,
      tenantWorkspaceBindings: runtimeState.tenantWorkspaceBindings.length,
      workflows: handoffs.reduce((totals, handoff) => {
        totals[handoff.workflow] = (totals[handoff.workflow] || 0) + 1;
        return totals;
      }, {})
    },
    routeIdentity: routeIdentity.contract
  };
}

function normalizeProviderContract(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const syncSource = source.sync && typeof source.sync === 'object' ? source.sync : {};
  const providerId = cleanString(source.providerId) || cleanString(source.id) || `syscall-provider-${index + 1}`;
  const serviceId = cleanString(source.serviceId) || cleanString(source.service) || providerId;
  const routePrefix = cleanString(source.routePrefix) || cleanString(source.route);
  const acceptedIntents = uniqueStrings(asArray(source.acceptedIntents || source.intents)
    .map(normalizeRequestIntent)
    .filter((intent) => KNOWN_REQUEST_INTENTS.has(intent)));

  return {
    providerId,
    serviceId,
    serviceKey: `${providerId}:${serviceId}`,
    owner: cleanString(source.owner) || providerId,
    status: normalizeProviderStatus(source.status),
    contractVersion: cleanString(source.contractVersion) || 'v1',
    routePrefix,
    endpointRoute: cleanString(source.endpointRoute) || (routePrefix ? `${routePrefix}/invoke` : `${DEFAULT_ROUTE}/providers/${providerId}/invoke`),
    externalHandoffRoute: cleanString(source.externalHandoffRoute) || cleanString(source.handoffRoute) || `${DEFAULT_ROUTE}/providers/${providerId}/handoff`,
    capabilities: {
      provided: uniqueStrings(normalizeStringList(source.capabilities || source.providedCapabilities)),
      requiredFromKernel: uniqueStrings(normalizeStringList(source.requiredKernelCapabilities))
    },
    acceptedIntents: acceptedIntents.length > 0 ? acceptedIntents : [...KNOWN_REQUEST_INTENTS],
    requiredRoles: uniqueStrings(normalizeStringList(source.requiredRoles)),
    sync: {
      mode: normalizeSyncMode(syncSource.mode || source.syncMode),
      revision: toPositiveInteger(syncSource.revision || source.revision, 1),
      cursor: cleanString(syncSource.cursor) || cleanString(source.cursor),
      lastSyncedAt: cleanString(syncSource.lastSyncedAt) || cleanString(source.lastSyncedAt),
      nextSyncAt: cleanString(syncSource.nextSyncAt) || cleanString(source.nextSyncAt),
      staleAfterSeconds: toPositiveInteger(syncSource.staleAfterSeconds || source.staleAfterSeconds, 300)
    }
  };
}

function buildImplicitBuiltinProviderContracts(syscalls, now) {
  return syscalls
    .filter((syscall) => syscall.builtin && syscall.serviceContract.handoffMode === 'hosted-kernel')
    .map((syscall) => ({
      providerId: syscall.serviceContract.providerId || 'hosted-kernel',
      serviceId: syscall.serviceContract.serviceId || syscall.name,
      owner: syscall.owner,
      status: 'active',
      contractVersion: syscall.serviceContract.contractVersion || 'v1',
      routePrefix: syscall.route,
      endpointRoute: syscall.route,
      externalHandoffRoute: null,
      capabilities: uniqueStrings([
        ...syscall.capabilities.required,
        ...syscall.capabilities.provided,
        syscall.metadata.dispatchClass,
        syscall.metadata.auditCategory,
        'hosted-kernel'
      ]),
      requiredKernelCapabilities: [],
      acceptedIntents: syscall.metadata.dispatchIntents,
      requiredRoles: syscall.permissions.allowedRoles,
      sync: {
        mode: 'manual',
        revision: 1,
        lastSyncedAt: now,
        staleAfterSeconds: 300
      },
      implicitBuiltinProvider: true
    }));
}

function normalizeKernelProviderRuntime(raw, syscalls) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const handoffSource = source.externalHandoff && typeof source.externalHandoff === 'object'
    ? source.externalHandoff
    : {};
  const routeCapabilities = syscalls.flatMap((syscall) => syscall.capabilities.provided);
  const advertisedCapabilities = uniqueStrings([
    'hosted-kernel',
    'syscall-registry',
    'boundary-proof',
    'audit-handoff',
    ...routeCapabilities,
    ...normalizeStringList(source.capabilities || source.providedCapabilities || source.advertisedCapabilities)
  ]);

  return {
    kernelId: cleanString(source.kernelId) || cleanString(source.id) || 'hosted-kernel',
    contractVersion: cleanString(source.contractVersion) || 'v1',
    capabilities: {
      provided: advertisedCapabilities,
      denied: uniqueStrings(normalizeStringList(source.deniedCapabilities || source.blockedCapabilities))
    },
    externalHandoffPolicy: {
      route: cleanString(handoffSource.route) || cleanString(source.externalHandoffRoute) || `${DEFAULT_ROUTE}/external-provider-handoff`,
      maxInflight: toPositiveInteger(handoffSource.maxInflight || source.maxExternalInflight, 50),
      requireFreshSync: toBoolean(handoffSource.requireFreshSync ?? source.requireFreshProviderSync, true),
      blockStaleSync: toBoolean(handoffSource.blockStaleSync ?? source.blockStaleProviderSync, true),
      defaultTtlSeconds: toPositiveInteger(handoffSource.defaultTtlSeconds || source.externalHandoffTtlSeconds, 120)
    }
  };
}

function buildProviderSyncState(provider, now) {
  const parsedNow = Date.parse(now);
  const parsedLastSyncedAt = Date.parse(provider.sync.lastSyncedAt || '');
  const parsedNextSyncAt = Date.parse(provider.sync.nextSyncAt || '');
  const canMeasureFreshness = Number.isFinite(parsedNow) && Number.isFinite(parsedLastSyncedAt);
  const ageSeconds = canMeasureFreshness
    ? Math.max(0, Math.trunc((parsedNow - parsedLastSyncedAt) / 1000))
    : null;
  const stale = provider.sync.mode !== 'manual'
    && (ageSeconds === null || ageSeconds > provider.sync.staleAfterSeconds);
  const nextSyncDue = Number.isFinite(parsedNow)
    && Number.isFinite(parsedNextSyncAt)
    && parsedNextSyncAt <= parsedNow;

  return {
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    mode: provider.sync.mode,
    revision: provider.sync.revision,
    cursor: provider.sync.cursor,
    lastSyncedAt: provider.sync.lastSyncedAt,
    nextSyncAt: provider.sync.nextSyncAt,
    staleAfterSeconds: provider.sync.staleAfterSeconds,
    ageSeconds,
    stale,
    nextSyncDue,
    state: provider.status === 'active' && !stale ? 'sync-ready'
      : provider.status === 'active' && stale ? 'sync-stale'
        : provider.status === 'degraded' ? 'sync-with-health-warning'
          : 'sync-suspended',
    nextAction: stale ? 'refresh-provider-contract'
      : nextSyncDue ? 'run-provider-sync'
        : provider.status === 'active' ? 'await-next-sync'
          : 'resume-provider-before-sync'
  };
}

function addSecondsToInstant(value, seconds) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed + seconds * 1000).toISOString()
    : null;
}

function providerMatchesSyscall(provider, syscall) {
  const boundProvider = syscall.serviceContract.providerId;
  const boundService = syscall.serviceContract.serviceId;

  if (boundProvider && provider.providerId !== boundProvider) return false;
  if (boundService && provider.serviceId !== boundService) return false;
  if (boundProvider || boundService) return true;
  if (provider.owner === syscall.owner) return true;
  if (provider.routePrefix && syscall.route.startsWith(provider.routePrefix)) return true;

  return syscall.capabilities.required.length > 0
    && syscall.capabilities.required.every((capability) => provider.capabilities.provided.includes(capability));
}

function buildProviderCapabilityGrant(syscall, provider, kernelRuntime, requestIntents, missingCapabilities, missingKernelCapabilities, unsupportedIntents, syncState) {
  const routeRequirementsMet = missingCapabilities.length === 0;
  const kernelRequirementsMet = missingKernelCapabilities.length === 0;
  const intentsSupported = unsupportedIntents.length === 0;
  const syncFresh = !syncState?.stale;
  const providerUsable = Boolean(provider)
    && provider.status === 'active'
    && routeRequirementsMet
    && kernelRequirementsMet
    && intentsSupported
    && (syncFresh || !kernelRuntime.externalHandoffPolicy.blockStaleSync);

  return {
    schema: 'aios.syscall.provider-capability-grant.v1',
    syscall: syscall.name,
    route: syscall.route,
    providerId: provider?.providerId || syscall.serviceContract.providerId || null,
    serviceId: provider?.serviceId || syscall.serviceContract.serviceId || null,
    state: providerUsable ? 'granted'
      : !provider ? 'provider-missing'
        : provider.status !== 'active' ? `provider-${provider.status}`
          : !routeRequirementsMet ? 'route-capability-gap'
            : !kernelRequirementsMet ? 'kernel-capability-gap'
              : !intentsSupported ? 'intent-gap'
                : 'sync-fence',
    routeRequirements: {
      requiredCapabilities: syscall.capabilities.required,
      grantedCapabilities: provider
        ? syscall.capabilities.required.filter((capability) => provider.capabilities.provided.includes(capability))
        : [],
      missingCapabilities
    },
    kernelRequirements: {
      requiredCapabilities: provider?.capabilities.requiredFromKernel || [],
      grantedCapabilities: provider
        ? provider.capabilities.requiredFromKernel.filter((capability) => (
            kernelRuntime.capabilities.provided.includes(capability)
            && !kernelRuntime.capabilities.denied.includes(capability)
          ))
        : [],
      missingCapabilities: missingKernelCapabilities,
      deniedCapabilities: kernelRuntime.capabilities.denied
    },
    intentGrant: {
      requestedIntents: requestIntents,
      acceptedIntents: provider?.acceptedIntents || [],
      unsupportedIntents
    },
    syncFence: {
      requiredFreshSync: kernelRuntime.externalHandoffPolicy.requireFreshSync,
      blocksOnStaleSync: kernelRuntime.externalHandoffPolicy.blockStaleSync,
      state: syncState?.state || 'sync-unbound',
      revision: syncState?.revision || null,
      stale: syncState?.stale || false,
      nextAction: syncState?.nextAction || null
    }
  };
}

function buildProviderNegotiation(syscall, provider, routeState, clientRuntime, kernelRuntime, syncState) {
  const requestIntents = uniqueStrings(clientRuntime.handoffs
    .filter((handoff) => handoff.syscall === syscall.name)
    .map((handoff) => {
      const request = clientRuntime.requests.find((candidate) => candidate.requestId === handoff.requestId);
      return request?.intent;
    })
    .filter(Boolean));
  const missingCapabilities = syscall.capabilities.required
    .filter((capability) => !provider?.capabilities.provided.includes(capability));
  const missingKernelCapabilities = provider
    ? provider.capabilities.requiredFromKernel.filter((capability) => (
        !kernelRuntime.capabilities.provided.includes(capability)
        || kernelRuntime.capabilities.denied.includes(capability)
      ))
    : [];
  const unsupportedIntents = requestIntents.filter((intent) => !provider?.acceptedIntents.includes(intent));
  const issues = [];
  const warnings = [];

  if (!provider && (syscall.serviceContract.providerId || syscall.serviceContract.serviceId || syscall.capabilities.required.length > 0)) {
    issues.push('provider-contract-not-found');
  }
  if (provider?.status === 'offline') issues.push('provider-offline');
  if (provider?.status === 'blocked') issues.push('provider-blocked');
  if (provider?.status === 'degraded') warnings.push('provider-degraded');
  if (missingCapabilities.length > 0) issues.push('capability-negotiation-failed');
  if (missingKernelCapabilities.length > 0) issues.push('kernel-capability-negotiation-failed');
  if (unsupportedIntents.length > 0) issues.push('intent-not-supported-by-provider');
  if (routeState?.effectiveStatus === 'blocked') issues.push('route-blocked');
  if (syscall.serviceContract.validationIssues.length > 0) issues.push('service-contract-invalid');
  if (syncState?.stale && kernelRuntime.externalHandoffPolicy.requireFreshSync) {
    (kernelRuntime.externalHandoffPolicy.blockStaleSync ? issues : warnings).push('provider-sync-stale');
  }

  const accepted = issues.length === 0;
  const serviceHandoff = syscall.serviceContract.externalHandoff || {};
  const externalHandoffRequired = Boolean(provider?.externalHandoffRoute)
    && serviceHandoff.required;
  const externalHandoffAvailable = Boolean(provider?.externalHandoffRoute)
    && (serviceHandoff.required || serviceHandoff.optional);
  const capabilityGrant = buildProviderCapabilityGrant(
    syscall,
    provider,
    kernelRuntime,
    requestIntents,
    missingCapabilities,
    missingKernelCapabilities,
    unsupportedIntents,
    syncState
  );

  return {
    syscall: syscall.name,
    route: syscall.route,
    providerId: provider?.providerId || syscall.serviceContract.providerId || null,
    serviceId: provider?.serviceId || syscall.serviceContract.serviceId || null,
    contractVersion: provider?.contractVersion || syscall.serviceContract.contractVersion,
    accepted,
    issues,
    warnings,
    missingCapabilities,
    missingKernelCapabilities,
    unsupportedIntents,
    providedCapabilities: provider?.capabilities.provided || [],
    requiredCapabilities: syscall.capabilities.required,
    syscallMetadata: syscall.metadata,
    serviceContract: syscall.serviceContract,
    capabilityGrant,
    kernelCapabilities: {
      requiredByProvider: provider?.capabilities.requiredFromKernel || [],
      providedByKernel: kernelRuntime.capabilities.provided,
      deniedByKernel: kernelRuntime.capabilities.denied
    },
    effectiveProviderStatus: provider?.status || 'unbound',
    routeStatus: routeState?.effectiveStatus || syscall.status,
    syncRevision: provider?.sync.revision || null,
    syncState: syncState || null,
    externalHandoff: {
      required: externalHandoffRequired,
      available: externalHandoffAvailable,
      mode: syscall.serviceContract.handoffMode,
      state: !externalHandoffAvailable
        ? 'hosted-kernel-local'
        : !externalHandoffRequired ? 'available-as-optional-provider'
        : accepted ? (syncState?.stale ? 'ready-after-provider-sync' : 'ready-for-external-provider')
          : 'blocked-before-provider-handoff',
      route: externalHandoffAvailable ? provider.externalHandoffRoute : null,
      endpointRoute: externalHandoffAvailable ? provider.endpointRoute : null,
      kernelHandoffRoute: externalHandoffAvailable ? kernelRuntime.externalHandoffPolicy.route : null,
      ttlSeconds: externalHandoffAvailable ? kernelRuntime.externalHandoffPolicy.defaultTtlSeconds : null,
      syncFence: capabilityGrant.syncFence,
      grantState: capabilityGrant.state
    }
  };
}

function buildExternalProviderHandoffContract(handoff, negotiation, shouldLeaveKernel, blockedByNegotiation, now) {
  const ttlSeconds = negotiation?.externalHandoff?.ttlSeconds || null;
  const expiresAt = ttlSeconds ? addSecondsToInstant(now, ttlSeconds) : null;
  const capabilityGrant = negotiation?.capabilityGrant || null;
  const providerAccepted = Boolean(negotiation?.accepted);
  const ready = shouldLeaveKernel && providerAccepted && !blockedByNegotiation;

  return {
    schema: 'aios.syscall.external-provider-handoff.v1',
    handoffToken: `${handoff.auditKey}:${negotiation?.providerId || 'provider'}:${handoff.requestId}`,
    issuedAt: now,
    expiresAt,
    ttlSeconds,
    state: !shouldLeaveKernel
      ? 'not-required'
      : ready ? 'ready'
        : 'blocked',
    provider: {
      providerId: negotiation?.providerId || null,
      serviceId: negotiation?.serviceId || null,
      contractVersion: negotiation?.contractVersion || null,
      status: negotiation?.effectiveProviderStatus || null
    },
    routes: {
      externalHandoffRoute: shouldLeaveKernel ? negotiation?.externalHandoff?.route || null : null,
      endpointRoute: shouldLeaveKernel ? negotiation?.externalHandoff?.endpointRoute || null : null,
      kernelResumeRoute: shouldLeaveKernel ? negotiation?.externalHandoff?.kernelHandoffRoute || null : null
    },
    sync: {
      revision: negotiation?.syncRevision || null,
      state: negotiation?.syncState?.state || null,
      stale: negotiation?.syncState?.stale || false,
      nextAction: negotiation?.syncState?.nextAction || null,
      cursor: negotiation?.syncState?.cursor || null
    },
    grants: {
      state: capabilityGrant?.state || 'provider-missing',
      routeCapabilities: capabilityGrant?.routeRequirements || null,
      kernelCapabilities: capabilityGrant?.kernelRequirements || null,
      intentGrant: capabilityGrant?.intentGrant || null
    },
    replay: {
      idempotencyKey: handoff.auditKey,
      resumeToken: `${handoff.requestId}:external-provider:${negotiation?.providerId || 'unbound'}`,
      blockedBy: blockedByNegotiation ? negotiation?.issues?.[0] || 'provider-negotiation-blocked' : null
    }
  };
}

function buildProviderServiceContracts(syscalls, lifecycle, clientRuntime, rawProviders, rawKernelRuntime, now) {
  const explicitProviderKeys = new Set(asArray(rawProviders).map((provider) => {
    const source = provider && typeof provider === 'object' ? provider : {};
    const providerId = cleanString(source.providerId) || cleanString(source.id);
    const serviceId = cleanString(source.serviceId) || cleanString(source.service) || providerId;
    return providerId && serviceId ? `${providerId}:${serviceId}` : null;
  }).filter(Boolean));
  const implicitProviders = buildImplicitBuiltinProviderContracts(syscalls, now)
    .filter((provider) => !explicitProviderKeys.has(`${provider.providerId}:${provider.serviceId}`));
  const providers = [...implicitProviders, ...asArray(rawProviders)].map(normalizeProviderContract);
  const kernelRuntime = normalizeKernelProviderRuntime(rawKernelRuntime, syscalls);
  const routeStatesByName = new Map(lifecycle.routeStates.map((state) => [state.name, state]));
  const syncByServiceKey = new Map(providers.map((provider) => [
    provider.serviceKey,
    buildProviderSyncState(provider, now)
  ]));
  const negotiations = syscalls.map((syscall) => {
    const provider = providers.find((candidate) => providerMatchesSyscall(candidate, syscall));
    const syncState = provider ? syncByServiceKey.get(provider.serviceKey) : null;
    return buildProviderNegotiation(syscall, provider, routeStatesByName.get(syscall.name), clientRuntime, kernelRuntime, syncState);
  });
  const externalHandoffs = clientRuntime.handoffs.map((handoff) => {
    const negotiation = negotiations.find((candidate) => candidate.syscall === handoff.syscall);
    const shouldLeaveKernel = handoff.accepted && negotiation?.externalHandoff.required;
    const blockedByNegotiation = shouldLeaveKernel && !negotiation.accepted;
    const handoffContract = buildExternalProviderHandoffContract(
      handoff,
      negotiation,
      shouldLeaveKernel,
      blockedByNegotiation,
      now
    );

    return {
      handoffId: handoff.handoffId,
      requestId: handoff.requestId,
      syscall: handoff.syscall,
      providerId: negotiation?.providerId || null,
      serviceId: negotiation?.serviceId || null,
      state: !shouldLeaveKernel
        ? (handoff.accepted ? 'hosted-kernel-dispatch' : 'handoff-rejected')
        : negotiation.accepted ? 'provider-dispatch-ready' : 'provider-dispatch-blocked',
      externalRoute: shouldLeaveKernel ? negotiation.externalHandoff.route : null,
      endpointRoute: shouldLeaveKernel ? negotiation.externalHandoff.endpointRoute : null,
      kernelHandoffRoute: shouldLeaveKernel ? negotiation.externalHandoff.kernelHandoffRoute : null,
      ttlSeconds: shouldLeaveKernel ? negotiation.externalHandoff.ttlSeconds : null,
      blockedBy: blockedByNegotiation ? negotiation.issues[0] : null,
      syncState: negotiation?.syncState?.state || null,
      auditKey: handoff.auditKey,
      handoffContract
    };
  });
  const sync = [...syncByServiceKey.values()];

  return {
    version: 1,
    generatedAt: now,
    kernelRuntime,
    providers,
    negotiations,
    externalHandoffs,
    sync,
    summary: {
      providerCount: providers.length,
      boundRoutes: negotiations.filter((negotiation) => negotiation.providerId).length,
      acceptedNegotiations: negotiations.filter((negotiation) => negotiation.accepted).length,
      rejectedNegotiations: negotiations.filter((negotiation) => !negotiation.accepted).length,
      externalHandoffsReady: externalHandoffs.filter((handoff) => handoff.state === 'provider-dispatch-ready').length,
      externalHandoffsBlockedByProvider: externalHandoffs.filter((handoff) => handoff.state === 'provider-dispatch-blocked').length,
      syncReadyProviders: sync.filter((entry) => entry.state === 'sync-ready').length,
      staleSyncProviders: sync.filter((entry) => entry.stale).length,
      missingKernelCapabilityRoutes: negotiations.filter((negotiation) => negotiation.missingKernelCapabilities.length > 0).length,
      grantedProviderRoutes: negotiations.filter((negotiation) => negotiation.capabilityGrant.state === 'granted').length,
      syncFencedProviderRoutes: negotiations.filter((negotiation) => negotiation.capabilityGrant.state === 'sync-fence').length,
      externalHandoffContracts: externalHandoffs.filter((handoff) => handoff.handoffContract.state !== 'not-required').length
    }
  };
}

function buildWorkflowContinuation(handoff, request, negotiation, externalHandoff, routeHealth, accepted, blockedBy, dispatchMode, now) {
  const intent = request?.intent || 'invoke';
  const providerReady = externalHandoff?.state === 'provider-dispatch-ready';
  const healthState = routeHealth?.healthState || 'unknown';
  const continuationState = accepted
    ? dispatchMode === 'external-provider' ? 'handoff-to-provider'
      : intent === 'inspect' ? 'return-snapshot'
        : intent === 'schedule' ? 'persist-schedule'
          : intent === 'cancel' ? 'cancel-or-confirm'
            : 'dispatch-in-kernel'
    : blockedBy === 'route-health-blocked' ? 'hold-for-route-health'
      : blockedBy === 'provider-negotiation-blocked' || negotiation?.accepted === false ? 'hold-for-provider-contract'
        : blockedBy === 'route-blocked' ? 'hold-for-operator-review'
          : 'return-client-correction';
  const nextVisibleStep = accepted
    ? dispatchMode === 'external-provider' ? 'open-provider-handoff'
      : intent === 'inspect' ? 'render-registry-state'
        : intent === 'schedule' ? 'show-schedule-confirmation'
          : intent === 'cancel' ? 'show-cancel-confirmation'
            : 'show-dispatch-accepted'
    : continuationState === 'hold-for-route-health' ? 'show-health-hold'
      : continuationState === 'hold-for-provider-contract' ? 'show-provider-hold'
        : continuationState === 'hold-for-operator-review' ? 'show-operator-review'
          : 'show-request-correction';
  const resumeRoute = accepted
    ? dispatchMode === 'external-provider'
      ? externalHandoff?.kernelHandoffRoute || negotiation?.externalHandoff?.kernelHandoffRoute || null
      : handoff.route
    : handoff.auditHandoff?.route || handoff.boundaryProof?.auditRoute || null;
  const continuationToken = `${handoff.auditKey}:${intent}:${continuationState}`;

  return {
    schema: 'aios.syscall.workflow-continuation.v1',
    generatedAt: now,
    continuationId: `${handoff.requestId}:continuation`,
    requestId: handoff.requestId,
    handoffId: handoff.handoffId,
    clientId: handoff.clientId,
    sessionId: handoff.sessionId,
    state: continuationState,
    accepted,
    intent,
    workflow: handoff.workflow,
    nextVisibleStep,
    resumeRoute,
    resumeToken: continuationToken,
    userVisible: {
      title: accepted ? 'Syscall handoff ready' : 'Syscall handoff held',
      status: accepted ? 'ready' : 'needs-action',
      blockedBy,
      recommendedAction: accepted ? nextVisibleStep
        : continuationState === 'hold-for-route-health' ? 'wait-for-route-recovery-or-change-route'
          : continuationState === 'hold-for-provider-contract' ? 'refresh-provider-contract-or-route-locally'
            : continuationState === 'hold-for-operator-review' ? 'request-operator-review'
              : 'correct-request-scope-role-or-target'
    },
    clientStatePatch: {
      lastSyscallRequestId: handoff.requestId,
      lastSyscallWorkflow: handoff.workflow,
      lastSyscallContinuation: continuationState,
      pendingProofIds: uniqueStrings([
        handoff.boundaryProof?.proofId,
        handoff.boundaryLease?.leaseId,
        `${handoff.requestId}:dispatch-proof`
      ]),
      routeHealthState: healthState,
      providerState: externalHandoff?.state || negotiation?.effectiveProviderStatus || null
    },
    proofRefs: {
      boundaryProofId: handoff.boundaryProof?.proofId || null,
      boundaryLeaseId: handoff.boundaryLease?.leaseId || null,
      dispatchProofId: `${handoff.requestId}:dispatch-proof`,
      auditKey: handoff.auditKey
    },
    providerHandoff: dispatchMode === 'external-provider'
      ? {
          providerId: externalHandoff?.providerId || negotiation?.providerId || null,
          serviceId: externalHandoff?.serviceId || negotiation?.serviceId || null,
          state: externalHandoff?.state || (providerReady ? 'provider-dispatch-ready' : 'provider-dispatch-pending'),
          externalRoute: externalHandoff?.externalRoute || negotiation?.externalHandoff?.route || null,
          endpointRoute: externalHandoff?.endpointRoute || negotiation?.externalHandoff?.endpointRoute || null,
          ttlSeconds: externalHandoff?.ttlSeconds || negotiation?.externalHandoff?.ttlSeconds || null,
          handoffToken: externalHandoff?.handoffContract?.handoffToken || null,
          expiresAt: externalHandoff?.handoffContract?.expiresAt || null,
          grantState: externalHandoff?.handoffContract?.grants?.state || negotiation?.capabilityGrant?.state || null,
          syncState: externalHandoff?.handoffContract?.sync?.state || negotiation?.syncState?.state || null,
          resumeToken: externalHandoff?.handoffContract?.replay?.resumeToken || null
        }
      : null
  };
}

function buildDispatchPacket(handoff, request, negotiation, externalHandoff, routeHealth, now) {
  const healthBlocksDispatch = routeHealth?.healthState === 'failure-state'
    || routeHealth?.retry?.exhausted
    || routeHealth?.effectiveStatus === 'blocked';
  const providerBlocksDispatch = externalHandoff?.state === 'provider-dispatch-blocked'
    || negotiation?.accepted === false;
  const boundaryLeaseExpired = handoff.boundaryLease?.expiresAt
    ? !isFutureInstant(handoff.boundaryLease.expiresAt, now)
    : false;
  const leaseBlocksDispatch = handoff.boundaryLease?.required
    && (handoff.boundaryLease.state !== 'issued' || boundaryLeaseExpired);
  const accepted = handoff.accepted && !healthBlocksDispatch && !providerBlocksDispatch && !leaseBlocksDispatch;
  const dispatchMode = externalHandoff?.state === 'provider-dispatch-ready'
    || Boolean(externalHandoff?.externalRoute)
    || negotiation?.externalHandoff?.required
    ? 'external-provider'
    : 'hosted-kernel';
  const blockedBy = !handoff.accepted
    ? handoff.rejectionReason
    : healthBlocksDispatch ? 'route-health-blocked'
      : providerBlocksDispatch ? (externalHandoff?.blockedBy || negotiation?.issues?.[0] || 'provider-negotiation-blocked')
        : leaseBlocksDispatch ? (boundaryLeaseExpired ? 'boundary-lease-expired' : 'boundary-lease-not-issued')
        : null;
  const continuation = buildWorkflowContinuation(
    handoff,
    request,
    negotiation,
    externalHandoff,
    routeHealth,
    accepted,
    blockedBy,
    dispatchMode,
    now
  );

  return {
    dispatchId: `${handoff.requestId}:dispatch`,
    requestId: handoff.requestId,
    handoffId: handoff.handoffId,
    syscall: handoff.syscall,
    route: handoff.route,
    tenantId: handoff.tenantId,
    workspaceId: handoff.workspaceId,
    priority: handoff.priority,
    mode: dispatchMode,
    accepted,
    blockedBy,
    dispatchAfter: handoff.dispatchAfter,
    targetRoute: dispatchMode === 'external-provider'
      ? externalHandoff.endpointRoute
      : handoff.route,
    kernelHandoffRoute: dispatchMode === 'external-provider'
      ? externalHandoff.kernelHandoffRoute
      : null,
    externalProvider: dispatchMode === 'external-provider'
      ? {
          providerId: externalHandoff.providerId,
          serviceId: externalHandoff.serviceId,
          handoffRoute: externalHandoff.externalRoute,
          ttlSeconds: externalHandoff.ttlSeconds,
          syncState: externalHandoff.syncState,
          handoffContract: externalHandoff.handoffContract
        }
      : null,
    routeClientWorkflow: handoff.routeClientWorkflow || null,
    payloadEnvelope: {
      schema: 'aios.syscall.dispatch.v1',
      generatedAt: now,
      idempotencyKey: request?.idempotencyKey || handoff.auditKey,
      traceparent: request?.traceparent || handoff.traceparent || null,
      intent: request?.intent || 'invoke',
      payload: request?.payload || {},
      syscallMetadata: negotiation?.syscallMetadata || null,
      routeWorkflow: handoff.routeClientWorkflow
        ? {
            schema: handoff.routeClientWorkflow.schema,
            routeKey: handoff.routeClientWorkflow.routeKey,
            supportedIntents: handoff.routeClientWorkflow.supportedIntents,
            primaryIntent: handoff.routeClientWorkflow.clientVisible.primaryIntent,
            nextVisibleStep: handoff.routeClientWorkflow.clientVisible.nextVisibleStep,
            dataContract: handoff.routeClientWorkflow.dataContract
          }
        : null,
      boundaryProofId: handoff.boundaryProof.proofId,
      boundaryLeaseId: handoff.boundaryLease?.leaseId || null,
      boundaryLeaseToken: handoff.boundaryLease?.token || null,
      resourceBoundary: handoff.resourceBoundary || null,
      auditKey: handoff.auditKey,
      providerHandoffToken: dispatchMode === 'external-provider'
        ? externalHandoff.handoffContract?.handoffToken || null
        : null,
      providerResumeToken: dispatchMode === 'external-provider'
        ? externalHandoff.handoffContract?.replay?.resumeToken || null
        : null
    },
    routeHealth: routeHealth
      ? {
          state: routeHealth.healthState,
          declaredState: routeHealth.declaredState,
          retryable: routeHealth.retry.retryable,
          retryPolicy: routeHealth.retry.policy,
          retrySource: routeHealth.retry.source,
          nextRetryNotBefore: routeHealth.retry.nextRetryNotBefore,
          nextAction: routeHealth.nextAction,
          operationalError: routeHealth.operationalError,
          degradedModeCommand: routeHealth.degradedModeCommand,
          operationalProfile: routeHealth.operationalProfile
        }
      : null,
      providerContract: negotiation
      ? {
          providerId: negotiation.providerId,
          serviceId: negotiation.serviceId,
          contractVersion: negotiation.contractVersion,
          accepted: negotiation.accepted,
          issues: negotiation.issues,
          warnings: negotiation.warnings,
          syncRevision: negotiation.syncRevision,
          capabilityGrant: negotiation.capabilityGrant
        }
      : null,
    continuation,
    auditProof: {
      proofId: `${handoff.requestId}:dispatch-proof`,
      generatedAt: now,
      decision: accepted ? 'dispatch' : 'hold',
      blockedBy,
      auditKey: handoff.auditKey,
      boundaryProofId: handoff.boundaryProof.proofId,
      boundaryLeaseId: handoff.boundaryLease?.leaseId || null,
      boundaryLeaseState: handoff.boundaryLease?.state || 'missing',
      boundaryLeaseExpiresAt: handoff.boundaryLease?.expiresAt || null,
      resourceBoundaryState: handoff.resourceBoundary?.state || null,
      resourceBoundaryIssues: handoff.resourceBoundary?.issues || [],
      deniedResourcePaths: handoff.resourceBoundary?.pathPolicy?.deniedPaths || 0,
      routeHealthState: routeHealth?.healthState || null,
      providerState: externalHandoff?.state || negotiation?.effectiveProviderStatus || null,
      replaySafe: Boolean(request?.idempotencyKey),
      providerHandoffToken: dispatchMode === 'external-provider'
        ? externalHandoff.handoffContract?.handoffToken || null
        : null,
      providerGrantState: negotiation?.capabilityGrant?.state || null
    }
  };
}

function buildDispatchManifest(clientRuntime, providerContracts, operationalHealth, now) {
  const requestsById = new Map(clientRuntime.requests.map((request) => [request.requestId, request]));
  const negotiationsBySyscall = new Map(providerContracts.negotiations.map((negotiation) => [negotiation.syscall, negotiation]));
  const externalHandoffsById = new Map(providerContracts.externalHandoffs.map((handoff) => [handoff.handoffId, handoff]));
  const routeHealthByName = new Map(operationalHealth.routes.map((route) => [route.name, route]));
  const packets = clientRuntime.handoffs.map((handoff) => buildDispatchPacket(
    handoff,
    requestsById.get(handoff.requestId),
    negotiationsBySyscall.get(handoff.syscall),
    externalHandoffsById.get(handoff.handoffId),
    routeHealthByName.get(handoff.syscall),
    now
  ));
  const readyPackets = packets.filter((packet) => packet.accepted);
  const heldPackets = packets.filter((packet) => !packet.accepted);
  const continuations = packets.map((packet) => packet.continuation);
  const continuationStates = continuations.reduce((totals, continuation) => {
    totals[continuation.state] = (totals[continuation.state] || 0) + 1;
    return totals;
  }, {});

  return {
    version: 1,
    generatedAt: now,
    route: `${DEFAULT_ROUTE}/dispatch`,
    packets,
    proofs: packets.map((packet) => packet.auditProof),
    continuations,
    summary: {
      packetCount: packets.length,
      readyPackets: readyPackets.length,
      heldPackets: heldPackets.length,
      hostedKernelDispatches: readyPackets.filter((packet) => packet.mode === 'hosted-kernel').length,
      externalProviderDispatches: readyPackets.filter((packet) => packet.mode === 'external-provider').length,
      healthHeldPackets: heldPackets.filter((packet) => packet.blockedBy === 'route-health-blocked').length,
      providerHeldPackets: heldPackets.filter((packet) => packet.blockedBy === 'provider-negotiation-blocked' || packet.providerContract?.issues.length > 0).length,
      replaySafePackets: packets.filter((packet) => packet.auditProof.replaySafe).length,
      continuationCount: continuations.length,
      clientCorrectionContinuations: continuations.filter((continuation) => continuation.state === 'return-client-correction').length,
      operatorReviewContinuations: continuations.filter((continuation) => continuation.state === 'hold-for-operator-review').length,
      providerContinuationHandoffs: continuations.filter((continuation) => continuation.state === 'handoff-to-provider').length,
      continuationStates
    },
    nextAction: readyPackets.length > 0
      ? 'drain-ready-dispatch-packets'
      : heldPackets.length > 0 ? 'resolve-held-dispatch-packets'
        : 'await-client-handoffs'
  };
}

function normalizeOperationalHealthSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const degradedFailureRateThreshold = toRatio(source.degradedFailureRateThreshold, 0.08);
  const failureBudget = toNonNegativeInteger(source.failureBudget, 3);
  const maxRetryAttempts = toPositiveInteger(source.maxRetryAttempts, 4);
  const baseBackoffSeconds = toPositiveInteger(source.baseBackoffSeconds, 30);
  const maxBackoffSeconds = toPositiveInteger(source.maxBackoffSeconds, 900);
  const issues = [];

  if (source.degradedFailureRateThreshold !== undefined && degradedFailureRateThreshold !== source.degradedFailureRateThreshold) {
    issues.push({
      code: 'health.degradedFailureRateThreshold.clamped',
      severity: 'warning',
      message: 'degradedFailureRateThreshold must be between 0 and 1; value was clamped'
    });
  }

  if (source.failureBudget !== undefined && failureBudget !== source.failureBudget) {
    issues.push({
      code: 'health.failureBudget.invalid',
      severity: 'warning',
      message: 'failureBudget must be a non-negative integer; default applied'
    });
  }

  if (source.maxRetryAttempts !== undefined && maxRetryAttempts !== source.maxRetryAttempts) {
    issues.push({
      code: 'health.maxRetryAttempts.invalid',
      severity: 'warning',
      message: 'maxRetryAttempts must be a positive integer; default applied'
    });
  }

  if (baseBackoffSeconds > maxBackoffSeconds) {
    issues.push({
      code: 'health.backoff.window.invalid',
      severity: 'warning',
      message: 'baseBackoffSeconds cannot exceed maxBackoffSeconds; retries will use maxBackoffSeconds'
    });
  }

  return {
    settings: {
      degradedFailureRateThreshold,
      failureBudget,
      maxRetryAttempts,
      baseBackoffSeconds,
      maxBackoffSeconds,
      degradedModeRoute: cleanString(source.degradedModeRoute) || `${DEFAULT_ROUTE}/degraded-mode`,
      operatorEscalationRoute: cleanString(source.operatorEscalationRoute) || `${DEFAULT_ROUTE}/operator-escalation`
    },
    issues
  };
}

function buildRetryPlan(syscall, routeState, settings, now) {
  const operationalRetry = syscall.operational?.retry || {};
  const declaredFailurePressure = ['degraded', 'recovering', 'failure-state'].includes(syscall.operational?.declaredState);
  const attemptsUsed = Math.max(syscall.failures, operationalRetry.attemptsUsed || 0);
  const maxAttempts = operationalRetry.maxAttempts || settings.maxRetryAttempts;
  const failurePressure = syscall.failures > settings.failureBudget
    || routeState.failureRate >= settings.degradedFailureRateThreshold
    || declaredFailurePressure;
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
  const cappedBase = Math.min(settings.baseBackoffSeconds, settings.maxBackoffSeconds);
  const calculatedBackoffSeconds = failurePressure
    ? Math.min(settings.maxBackoffSeconds, cappedBase * (2 ** Math.min(attemptsUsed, 8)))
    : 0;
  const backoffSeconds = Math.min(
    settings.maxBackoffSeconds,
    Math.max(calculatedBackoffSeconds, operationalRetry.backoffSeconds || 0)
  );
  const parsedNow = Date.parse(now);
  const canCalculateRetryAt = backoffSeconds > 0 && Number.isFinite(parsedNow);
  const declaredRetryAt = parseInstant(operationalRetry.nextRetryNotBefore);
  const calculatedRetryAt = canCalculateRetryAt
    ? new Date(parsedNow + backoffSeconds * 1000).toISOString()
    : null;
  const nextRetryNotBefore = declaredRetryAt.valid
    ? declaredRetryAt.value
    : calculatedRetryAt;
  const explicitlyBlocked = operationalRetry.retryableOverride === false
    || operationalRetry.exhaustedOverride === true
    || syscall.operational?.declaredState === 'failure-state';
  const exhausted = operationalRetry.exhaustedOverride === true || attemptsRemaining === 0;

  return {
    retryable: routeState.effectiveStatus !== 'blocked'
      && routeState.effectiveStatus !== 'failed'
      && routeState.effectiveEnabled !== false
      && !explicitlyBlocked
      && attemptsRemaining > 0,
    attemptsUsed,
    attemptsRemaining,
    maxAttempts,
    backoffSeconds,
    nextRetryNotBefore,
    exhausted,
    policy: operationalRetry.strategy !== 'none'
      ? operationalRetry.strategy
      : failurePressure ? 'exponential-backoff' : 'immediate-dispatch',
    source: syscall.operational?.stateSource || 'derived-from-route-state'
  };
}

function buildRouteOperationalError(syscall, routeState, healthState, retry, settings) {
  if (healthState === 'healthy') return null;

  const operational = syscall.operational || {};
  const failureState = healthState === 'failure-state';
  const disabled = healthState === 'disabled';
  const exhausted = retry.exhausted;
  const code = exhausted ? 'syscall.retry.exhausted'
    : failureState ? 'syscall.route.failure-state'
      : disabled ? 'syscall.route.disabled'
        : 'syscall.route.degraded';
  const severity = exhausted || failureState ? 'critical'
    : disabled ? 'error'
      : 'warning';
  const operatorAction = cleanString(operational.actions?.operatorAction) && operational.actions.operatorAction !== 'none'
    ? operational.actions.operatorAction
    : exhausted || failureState
    ? 'open-operator-escalation'
    : disabled ? 'enable-route-before-dispatch'
      : 'dispatch-through-degraded-mode';
  const clientAction = cleanString(operational.actions?.clientAction) && operational.actions.clientAction !== 'none'
    ? operational.actions.clientAction
    : exhausted || failureState
    ? 'show-operator-review-hold'
    : disabled ? 'show-route-disabled-hold'
      : 'show-retry-backoff-status';

  return {
    schema: 'aios.syscall.route-operational-error.v1',
    code,
    severity,
    subject: syscall.name,
    route: syscall.route,
    owner: syscall.owner,
    state: healthState,
    effectiveStatus: routeState.effectiveStatus,
    effectiveEnabled: routeState.effectiveEnabled,
    failureRate: routeState.failureRate,
    failures: syscall.failures,
    lastFailureCode: operational.lastFailure?.code || null,
    lastFailureAt: operational.lastFailure?.at || null,
    declaredState: operational.declaredState || null,
    validationIssues: operational.validationIssues || [],
    retryable: retry.retryable,
    exhausted,
    nextRetryNotBefore: retry.nextRetryNotBefore,
    backoffSeconds: retry.backoffSeconds,
    operatorAction,
    clientAction,
    escalationRoute: exhausted || failureState ? settings.operatorEscalationRoute : null,
    remediation: exhausted || failureState
      ? 'operator-must-review-route-before-replay'
      : disabled ? 'enable-route-or-change-target'
        : 'retry-after-backoff-or-use-degraded-mode-route'
  };
}

function buildDegradedModeCommand(syscall, routeHealth, settings, now) {
  if (!routeHealth.degradedModeEligible) return null;

  const declaredRoute = cleanString(syscall.operational?.degradedMode?.route);
  return {
    schema: 'aios.syscall.degraded-mode-command.v1',
    commandId: `${syscall.name}:degraded-mode:${now}`,
    route: declaredRoute || settings.degradedModeRoute,
    targetRoute: syscall.route,
    syscall: syscall.name,
    owner: syscall.owner,
    state: routeHealth.retry.nextRetryNotBefore ? 'wait-for-backoff' : 'ready',
    method: 'POST',
    idempotencyKey: `${syscall.exportKey}:degraded:${routeHealth.failures}:${routeHealth.retry.nextRetryNotBefore || 'immediate'}`,
    body: {
      syscall: syscall.name,
      route: syscall.route,
      retryPolicy: routeHealth.retry.policy,
      attemptsRemaining: routeHealth.retry.attemptsRemaining,
      nextRetryNotBefore: routeHealth.retry.nextRetryNotBefore,
      failureRate: routeHealth.failureRate,
      errorBudgetRemaining: routeHealth.errorBudgetRemaining,
      declaredState: syscall.operational?.declaredState || null,
      lastFailureCode: syscall.operational?.lastFailure?.code || null
    },
    audit: {
      auditKey: `${syscall.owner}:${syscall.name}:degraded-mode`,
      reason: routeHealth.healthState,
      proofRequired: true
    }
  };
}

function buildOperationalHealth(syscalls, counters, lifecycle, clientRuntime, rawSettings, now) {
  const { settings, issues } = normalizeOperationalHealthSettings(rawSettings);
  const routeStateByName = new Map(lifecycle.routeStates.map((state) => [state.name, state]));
  const routes = syscalls.map((syscall) => {
    const routeState = routeStateByName.get(syscall.name);
    const operational = syscall.operational || {};
    const effectiveStatus = routeState?.effectiveStatus || syscall.status;
    const effectiveEnabled = routeState?.effectiveEnabled ?? syscall.enabled;
    const failureRate = routeState?.failureRate ?? (syscall.invoked > 0 ? Number((syscall.failures / syscall.invoked).toFixed(6)) : 0);
    const errorBudgetRemaining = Math.max(0, settings.failureBudget - syscall.failures);
    let healthState = 'healthy';

    if (effectiveStatus === 'blocked' || effectiveStatus === 'failed' || operational.declaredState === 'failure-state') {
      healthState = 'failure-state';
    } else if (effectiveEnabled === false || operational.declaredState === 'disabled') {
      healthState = 'disabled';
    } else if (
      operational.declaredState === 'degraded'
      || operational.declaredState === 'recovering'
      || failureRate >= settings.degradedFailureRateThreshold
      || syscall.failures > settings.failureBudget
    ) {
      healthState = 'degraded';
    }
    const retry = buildRetryPlan(syscall, { ...routeState, effectiveStatus, effectiveEnabled, failureRate }, settings, now);
    const effectiveRouteState = { ...routeState, effectiveStatus, effectiveEnabled, failureRate };
    const routeHealth = {
      name: syscall.name,
      route: syscall.route,
      owner: syscall.owner,
      healthState,
      effectiveStatus,
      effectiveEnabled,
      failureRate,
      failures: syscall.failures,
      errorBudgetRemaining,
      declaredState: operational.declaredState || null,
      operationalProfile: operational,
      retry,
      degradedModeEligible: healthState === 'degraded'
        && retry.retryable
        && operational.degradedMode?.allowed !== false,
      nextAction: healthState === 'failure-state'
        ? 'escalate-to-operator'
        : healthState === 'degraded' ? (retry.nextRetryNotBefore ? 'retry-after-backoff' : 'route-through-degraded-mode')
          : retry.retryable && retry.backoffSeconds > 0 ? 'retry-after-backoff'
            : routeState?.nextAction || 'await-invocation'
    };
    const operationalError = buildRouteOperationalError(syscall, effectiveRouteState, healthState, retry, settings);
    const degradedModeCommand = buildDegradedModeCommand(syscall, routeHealth, settings, now);

    return {
      ...routeHealth,
      operationalError,
      degradedModeCommand
    };
  });
  const actionableErrors = [
    ...routes
      .filter((route) => route.operationalError)
      .map((route) => ({
        code: route.operationalError.code,
        severity: route.operationalError.severity,
        subject: route.name,
        route: route.route,
        action: route.operationalError.operatorAction,
        clientAction: route.operationalError.clientAction,
        retryAfter: route.operationalError.nextRetryNotBefore,
        escalationRoute: route.operationalError.escalationRoute,
        remediation: route.operationalError.remediation
      })),
    ...routes
      .flatMap((route) => asArray(route.operationalProfile?.validationIssues).map((issue) => ({
        code: issue,
        severity: issue.endsWith('.invalid') ? 'error' : 'warning',
        subject: route.name,
        route: route.route,
        action: 'correct-route-operational-profile',
        clientAction: 'show-route-health-configuration',
        retryAfter: null,
        escalationRoute: null,
        remediation: 'fix-operational-health-metadata-and-reload-registry'
      }))),
    ...lifecycle.commands
      .filter((command) => !command.accepted)
      .map((command) => ({
        code: `syscall.lifecycle.${command.rejectionReason || 'rejected'}`,
        severity: 'error',
        subject: command.target,
        route: null,
        action: 'correct-or-replay-lifecycle-command',
        commandId: command.commandId
      })),
    ...clientRuntime.handoffs
      .filter((handoff) => !handoff.accepted)
      .map((handoff) => ({
        code: `syscall.handoff.${handoff.rejectionReason || 'rejected'}`,
        severity: handoff.rejectionReason === 'route-blocked' ? 'critical' : 'error',
        subject: handoff.syscall,
        route: handoff.route,
        action: handoff.workflow,
        requestId: handoff.requestId
      }))
  ].sort((left, right) => (HEALTH_SEVERITY_RANK[right.severity] || 0) - (HEALTH_SEVERITY_RANK[left.severity] || 0));

  const degradedRoutes = routes.filter((route) => route.healthState === 'degraded');
  const failedRoutes = routes.filter((route) => route.healthState === 'failure-state' || route.retry.exhausted);
  const degradedModeCommands = degradedRoutes
    .map((route) => route.degradedModeCommand)
    .filter(Boolean);
  const mode = failedRoutes.length > 0
    ? 'manual-intervention'
    : degradedRoutes.length > 0 || clientRuntime.summary.rejectedHandoffs > 0 ? 'degraded'
      : issues.length > 0 ? 'validation-warning'
        : 'normal';

  return {
    version: 1,
    generatedAt: now,
    settings,
    validation: {
      ok: issues.length === 0,
      issues
    },
    mode,
    degradedMode: {
      enabled: mode === 'degraded',
      route: settings.degradedModeRoute,
      affectedRoutes: degradedRoutes.map((route) => route.name),
      dispatchPolicy: degradedRoutes.length > 0 ? 'retry-with-backoff' : 'standard-dispatch',
      commandCount: degradedModeCommands.length,
      commands: degradedModeCommands
    },
    failureState: {
      active: failedRoutes.length > 0,
      escalationRoute: settings.operatorEscalationRoute,
      affectedRoutes: failedRoutes.map((route) => route.name),
      blockedDispatches: failedRoutes.length + clientRuntime.handoffs.filter((handoff) => handoff.rejectionReason === 'route-blocked').length
    },
    routes,
    actionableErrors,
    summary: {
      totalRoutes: counters.total,
      healthyRoutes: routes.filter((route) => route.healthState === 'healthy').length,
      degradedRoutes: degradedRoutes.length,
      failedRoutes: failedRoutes.length,
      disabledRoutes: routes.filter((route) => route.healthState === 'disabled').length,
      retryableRoutes: routes.filter((route) => route.retry.retryable).length,
      declaredDegradedRoutes: routes.filter((route) => route.declaredState === 'degraded' || route.declaredState === 'recovering').length,
      declaredFailureRoutes: routes.filter((route) => route.declaredState === 'failure-state').length,
      operationalProfileIssueRoutes: routes.filter((route) => route.operationalProfile?.validationIssues?.length > 0).length,
      degradedModeCommands: degradedModeCommands.length,
      operationalErrorRoutes: routes.filter((route) => route.operationalError).length,
      actionableErrorCount: actionableErrors.length,
      highestSeverity: actionableErrors[0]?.severity || null
    }
  };
}

function buildLifecycleControls(syscalls, rawSettings, rawCommands, now, persistedState) {
  const { settings, issues } = normalizeLifecycleSettings(rawSettings);
  const maintenanceWindowState = buildMaintenanceWindowState(settings, now);
  settings.maintenanceWindow.active = maintenanceWindowState.active;
  const commands = asArray(rawCommands).map(normalizeLifecycleCommand);
  const syscallNames = new Set(syscalls.map((syscall) => syscall.name));
  const scheduledRoutes = syscalls.filter((syscall) => syscall.schedule.enabled).length;
  const seenCommandKeys = new Set();
  const commandResults = commands.map((command) => {
    const targetExists = command.target ? syscallNames.has(command.target) : false;
    const route = targetExists ? syscalls.find((syscall) => syscall.name === command.target) : null;
    const persistedLedgerEntry = persistedState.ledgerByIdempotencyKey.get(command.idempotencyKey);
    const duplicateInBatch = seenCommandKeys.has(command.idempotencyKey);
    const reasons = [];
    const transition = buildLifecycleTransition(route, command, settings, scheduledRoutes, now, maintenanceWindowState);

    seenCommandKeys.add(command.idempotencyKey);
    if (!command.accepted) reasons.push(command.rejectionReason);
    if (persistedLedgerEntry) reasons.push('command-already-applied');
    if (!persistedLedgerEntry && duplicateInBatch) reasons.push('duplicate-command-in-batch');
    reasons.push(...transition.reasons);

    const accepted = reasons.length === 0;
    const idempotentReplay = Boolean(persistedLedgerEntry);
    const duplicateReplay = !idempotentReplay && duplicateInBatch;
    const result = idempotentReplay
      ? 'replayed-noop'
      : duplicateReplay ? 'duplicate-noop'
        : accepted ? command.action === 'schedule' ? 'scheduled'
          : command.action === 'unschedule' ? 'unscheduled'
            : command.action === 'pause-schedule' ? 'schedule-paused'
              : command.action === 'resume-schedule' ? 'schedule-resumed'
                : command.action === 'block' ? 'blocked'
                  : command.action === 'disable' ? 'disabled'
                    : command.action === 'enable' ? 'enabled'
                      : 'activated'
          : 'rejected';

    return {
      ...command,
      accepted,
      rejectionReason: reasons[0] || null,
      restartSafe: Boolean(command.idempotencyKey),
      restartSemantics: {
        state: accepted ? 'apply-once'
          : idempotentReplay ? 'already-applied-noop'
            : duplicateReplay ? 'batch-duplicate-noop'
              : 'not-applied',
        idempotencyKey: command.idempotencyKey,
        ledgerMatched: idempotentReplay,
        replayableAfterRestart: Boolean(command.idempotencyKey) && !duplicateReplay,
        checkpointEffect: accepted ? 'append-ledger-entry'
          : idempotentReplay ? 'preserve-existing-ledger-entry'
            : 'no-checkpoint-change'
      },
      persistedResult: persistedLedgerEntry
        ? {
            result: persistedLedgerEntry.result,
            appliedAt: persistedLedgerEntry.appliedAt,
            auditKey: persistedLedgerEntry.auditKey
          }
        : null,
      wouldChange: transition.effect,
      transition: transition.transition,
      result,
      operatorAction: accepted
        ? `apply-${result}`
        : reasons.includes('command-already-applied') ? 'ignore-replayed-command'
          : reasons.includes('duplicate-command-in-batch') ? 'drop-duplicate-command'
            : 'correct-command-and-replay',
      auditRecord: {
        auditKey: `${command.requestedBy}:${command.idempotencyKey}`,
        decision: accepted ? 'accepted' : 'rejected',
        reason: reasons[0] || 'policy-accepted',
        targetExists,
        restartSafe: Boolean(command.idempotencyKey)
      }
    };
  });

  const routeStates = syscalls.map((syscall) => {
    const failureRate = syscall.invoked > 0 ? syscall.failures / syscall.invoked : 0;
    const shouldAutoBlock = failureRate >= settings.failureRateBlockThreshold && syscall.failures > 0;
    const matchingCommands = commandResults.filter((command) => command.target === syscall.name && command.accepted);
    const rejectedCommands = commandResults.filter((command) => command.target === syscall.name && !command.accepted);
    const lastCommand = matchingCommands.at(-1) || null;
    const effectiveEnabled = lastCommand?.wouldChange?.enabled ?? syscall.enabled;
    const effectiveStatus = lastCommand?.wouldChange?.status || (shouldAutoBlock ? 'blocked' : syscall.status);
    const effectiveSchedule = lastCommand?.wouldChange?.schedule || syscall.schedule;
    const effectiveSchedulePaused = Boolean(effectiveSchedule?.pausedUntil && isFutureInstant(effectiveSchedule.pausedUntil, now));
    const nextScheduledAt = effectiveSchedule?.nextRunAt ?? null;
    const nextActionState = buildRouteNextAction({
      effectiveStatus,
      effectiveEnabled,
      schedulePaused: effectiveSchedulePaused,
      nextScheduledAt,
      autoBlockRecommended: shouldAutoBlock
    });
    const lifecycleLocked = effectiveStatus === 'blocked' || shouldAutoBlock;
    const canEnable = settings.allowRuntimeEnable && !effectiveEnabled && !lifecycleLocked;
    const canDisable = settings.allowRuntimeDisable && effectiveEnabled;
    const canSchedule = settings.allowScheduling
      && effectiveEnabled
      && effectiveStatus !== 'blocked'
      && maintenanceWindowState.scheduleAllowedNow
      && (scheduledRoutes < settings.maxScheduledRoutes || Boolean(effectiveSchedule?.enabled));
    const canUnschedule = settings.allowScheduling && Boolean(effectiveSchedule?.enabled);
    const canPauseSchedule = canUnschedule && !effectiveSchedulePaused;
    const canResumeSchedule = settings.allowScheduling && Boolean(effectiveSchedule?.enabled) && effectiveSchedulePaused;
    const controls = {
      canEnable,
      canDisable,
      canSchedule,
      canUnschedule,
      canPauseSchedule,
      canResumeSchedule,
      lifecycleLocked,
      scheduleCapacityRemaining: Math.max(0, settings.maxScheduledRoutes - scheduledRoutes)
    };
    const routeStateForContracts = {
      effectiveStatus,
      effectiveEnabled,
      schedulePaused: effectiveSchedulePaused,
      pauseUntil: effectiveSchedule?.pausedUntil || null,
      nextScheduledAt,
      nextAction: nextActionState.nextAction,
      recommendedControl: nextActionState.control
    };
    const routeClientWorkflow = buildRouteClientWorkflowContract(syscall, {
      effectiveStatus,
      effectiveEnabled,
      schedulePaused: effectiveSchedulePaused,
      pauseUntil: effectiveSchedule?.pausedUntil || null,
      nextScheduledAt
    }, controls);
    const lifecycleControls = buildRouteLifecycleControls(
      syscall,
      routeStateForContracts,
      controls,
      maintenanceWindowState,
      settings
    );

    return {
      name: syscall.name,
      route: syscall.route,
      effectiveEnabled,
      effectiveStatus,
      failureRate: Number(failureRate.toFixed(6)),
      schedulePaused: effectiveSchedulePaused,
      pauseUntil: effectiveSchedule?.pausedUntil || null,
      nextScheduledAt,
      nextAction: nextActionState.nextAction,
      nextActionReason: nextActionState.reason,
      recommendedControl: nextActionState.control,
      commandCount: matchingCommands.length,
      rejectedCommandCount: rejectedCommands.length,
      autoBlockRecommended: shouldAutoBlock,
      controls,
      lifecycleControls,
      routeClientWorkflow,
      commandQueue: matchingCommands.map((command) => ({
        commandId: command.commandId,
        action: command.action,
        result: command.result,
        restartState: command.restartSemantics.state,
        auditKey: command.auditRecord.auditKey,
        runAt: command.runAt,
        pausedUntil: command.pausedUntil,
        cadence: command.cadence
      })),
      rejectedCommands: rejectedCommands.map((command) => ({
        commandId: command.commandId,
        action: command.action,
        rejectionReason: command.rejectionReason,
        operatorAction: command.operatorAction
      }))
    };
  });

  return {
    settings,
    validation: {
      ok: issues.length === 0,
      issues
    },
    maintenanceWindow: maintenanceWindowState,
    commands: commandResults,
    routeStates,
    nextActions: routeStates.reduce((totals, state) => {
      totals[state.nextAction] = (totals[state.nextAction] || 0) + 1;
      return totals;
    }, {}),
    controls: {
      enabledRoutes: routeStates.filter((state) => state.effectiveEnabled).length,
      disabledRoutes: routeStates.filter((state) => !state.effectiveEnabled).length,
      schedulableRoutes: routeStates.filter((state) => state.controls.canSchedule).length,
      pausableSchedules: routeStates.filter((state) => state.controls.canPauseSchedule).length,
      resumableSchedules: routeStates.filter((state) => state.controls.canResumeSchedule).length,
      pausedSchedules: routeStates.filter((state) => state.schedulePaused).length,
      lockedRoutes: routeStates.filter((state) => state.controls.lifecycleLocked).length,
      scheduleCapacityRemaining: Math.max(0, settings.maxScheduledRoutes - scheduledRoutes),
      rejectedCommandCount: commandResults.filter((command) => !command.accepted).length,
      pendingCommandCount: commandResults.filter((command) => command.accepted).length,
      idempotentReplayCount: commandResults.filter((command) => command.restartSemantics.state === 'already-applied-noop').length,
      duplicateNoopCount: commandResults.filter((command) => command.restartSemantics.state === 'batch-duplicate-noop').length
    }
  };
}

function buildRouteRestartStatus(routeState, now) {
  const nextRun = parseInstant(routeState.nextScheduledAt);
  const reference = parseInstant(now);
  const scheduleDue = nextRun.valid && reference.valid && nextRun.epochMs <= reference.epochMs;
  const scheduleFuture = nextRun.valid && reference.valid && nextRun.epochMs > reference.epochMs;

  if (routeState.effectiveStatus === 'failed') {
    return {
      status: 'failed-hold-after-restart',
      resumeAction: 'hold-route-until-operator-recovery-command',
      dispatchable: false,
      scheduleRecovery: 'blocked-by-failed-status'
    };
  }

  if (routeState.effectiveStatus === 'blocked') {
    return {
      status: 'operator-review-after-restart',
      resumeAction: 'hold-route-until-enable-or-activate-command',
      dispatchable: false,
      scheduleRecovery: 'blocked-by-operator-hold'
    };
  }

  if (!routeState.effectiveEnabled) {
    return {
      status: 'disabled-after-restart',
      resumeAction: 'await-enable-command',
      dispatchable: false,
      scheduleRecovery: 'blocked-by-disabled-route'
    };
  }

  if (routeState.schedulePaused) {
    return {
      status: 'paused-schedule-after-restart',
      resumeAction: 'wait-for-maintenance-window-or-resume-schedule',
      dispatchable: false,
      scheduleRecovery: 'paused'
    };
  }

  if (scheduleDue) {
    return {
      status: 'scheduled-due-after-restart',
      resumeAction: 'dispatch-recovered-schedule-now',
      dispatchable: true,
      scheduleRecovery: 'due'
    };
  }

  if (scheduleFuture) {
    return {
      status: 'scheduled-after-restart',
      resumeAction: 'restore-schedule-dispatch',
      dispatchable: true,
      scheduleRecovery: 'future'
    };
  }

  if (routeState.nextScheduledAt) {
    return {
      status: 'scheduled-invalid-after-restart',
      resumeAction: 'operator-review-invalid-schedule',
      dispatchable: false,
      scheduleRecovery: 'invalid'
    };
  }

  return {
    status: 'ready-after-restart',
    resumeAction: 'accept-client-handoffs',
    dispatchable: true,
    scheduleRecovery: 'none'
  };
}

function buildNextCheckpoint(syscalls, persistedState, lifecycle, generatedAt) {
  const routeStateByName = new Map(lifecycle.routeStates.map((state) => [state.name, state]));
  const persistedByKey = persistedState.routeByKey;
  const routes = syscalls.map((syscall, index) => {
    const routeState = routeStateByName.get(syscall.name);
    const persisted = persistedByKey.get(syscall.exportKey)
      || persistedState.routeByName.get(syscall.name)
      || persistedState.routeByRoute.get(syscall.route);
    const restart = buildRouteRestartStatus(routeState || {
      effectiveStatus: syscall.status,
      effectiveEnabled: syscall.enabled,
      schedulePaused: Boolean(syscall.schedule.pausedUntil && isFutureInstant(syscall.schedule.pausedUntil, generatedAt)),
      nextScheduledAt: syscall.schedule.nextRunAt
    }, generatedAt);
    const effectiveSchedule = routeState?.nextScheduledAt || routeState?.controls?.canUnschedule || routeState?.pauseUntil
      ? {
          enabled: Boolean(routeState.nextScheduledAt || routeState.controls.canUnschedule),
          cadence: syscall.schedule.cadence,
          nextRunAt: routeState.nextScheduledAt,
          pausedUntil: routeState.pauseUntil
        }
      : syscall.schedule;

    return {
      key: syscall.exportKey,
      name: syscall.name,
      route: syscall.route,
      owner: syscall.owner,
      version: syscall.version,
      status: routeState?.effectiveStatus || syscall.status,
      enabled: routeState?.effectiveEnabled ?? syscall.enabled,
      invoked: syscall.invoked,
      failures: syscall.failures,
      lastInvokedAt: syscall.lastInvokedAt,
      schedule: effectiveSchedule,
      checkpointRevision: toPositiveInteger(persisted?.checkpointRevision, index + 1) + 1,
      restartStatus: restart.status,
      resumeAction: restart.resumeAction,
      dispatchableAfterRestart: restart.dispatchable,
      scheduleRecovery: restart.scheduleRecovery
    };
  });
  const ledgerByKey = new Map();

  for (const entry of persistedState.commandLedger) {
    ledgerByKey.set(entry.idempotencyKey, {
      commandId: entry.commandId,
      idempotencyKey: entry.idempotencyKey,
      action: entry.action,
      target: entry.target,
      result: entry.result,
      appliedAt: entry.appliedAt,
      auditKey: entry.auditKey,
      checkpointEffect: 'preserved'
    });
  }

  for (const command of lifecycle.commands.filter((entry) => entry.accepted)) {
    ledgerByKey.set(command.idempotencyKey, {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      action: command.action,
      target: command.target,
      result: command.result,
      appliedAt: generatedAt,
      auditKey: command.auditRecord.auditKey,
      checkpointEffect: 'appended'
    });
  }

  const commandLedger = [...ledgerByKey.values()];
  const blockedRoutes = routes.filter((route) => route.restartStatus === 'operator-review-after-restart');
  const failedHoldRoutes = routes.filter((route) => route.restartStatus === 'failed-hold-after-restart');
  const pausedScheduleRoutes = routes.filter((route) => route.restartStatus === 'paused-schedule-after-restart');
  const scheduledRoutes = routes.filter((route) => route.restartStatus === 'scheduled-after-restart');
  const dueScheduleRoutes = routes.filter((route) => route.restartStatus === 'scheduled-due-after-restart');
  const invalidScheduleRoutes = routes.filter((route) => route.restartStatus === 'scheduled-invalid-after-restart');

  return {
    schema: 'aios.syscall.registry-checkpoint.v1',
    checkpointId: `${surfaceId}:${generatedAt}:next-checkpoint`,
    parentCheckpointId: persistedState.checkpointId,
    generatedAt,
    stateVersion: Math.max(2, persistedState.version + 1),
    routes,
    commandLedger,
    restartReadiness: {
      state: failedHoldRoutes.length > 0 ? 'restart-with-failed-route-holds'
        : blockedRoutes.length > 0 ? 'restart-with-operator-holds'
        : invalidScheduleRoutes.length > 0 ? 'restart-with-invalid-schedules'
        : dueScheduleRoutes.length > 0 ? 'restart-with-due-scheduled-work'
        : pausedScheduleRoutes.length > 0 ? 'restart-with-paused-schedules'
        : scheduledRoutes.length > 0 ? 'restart-with-scheduled-work'
          : 'restart-ready',
      routeCount: routes.length,
      dispatchableRoutes: routes.filter((route) => route.dispatchableAfterRestart).length,
      blockedRoutes: blockedRoutes.length,
      failedHoldRoutes: failedHoldRoutes.length,
      pausedScheduleRoutes: pausedScheduleRoutes.length,
      scheduledRoutes: scheduledRoutes.length,
      dueScheduleRoutes: dueScheduleRoutes.length,
      invalidScheduleRoutes: invalidScheduleRoutes.length,
      appendedLedgerEntries: commandLedger.filter((entry) => entry.checkpointEffect === 'appended').length,
      preservedLedgerEntries: commandLedger.filter((entry) => entry.checkpointEffect === 'preserved').length
    },
    recoveryPlan: routes.map((route) => ({
      key: route.key,
      name: route.name,
      restartStatus: route.restartStatus,
      resumeAction: route.resumeAction,
      dispatchableAfterRestart: route.dispatchableAfterRestart,
      scheduleRecovery: route.scheduleRecovery
    }))
  };
}

function buildPersistenceContract(syscalls, persistedState, recoveryEvents, lifecycle, generatedAt) {
  const recoveredRoutes = recoveryEvents.filter((event) => (
    event.restoredStatus || event.restoredEnabled || event.restoredCounters || event.restoredSchedule
  ));
  const replayedCommands = lifecycle.commands.filter((command) => command.rejectionReason === 'command-already-applied');
  const duplicateCommands = lifecycle.commands.filter((command) => command.rejectionReason === 'duplicate-command-in-batch');
  const nextCheckpoint = buildNextCheckpoint(syscalls, persistedState, lifecycle, generatedAt);

  return {
    version: 1,
    generatedAt,
    checkpoint: {
      checkpointId: persistedState.checkpointId,
      savedAt: persistedState.savedAt,
      bootId: persistedState.bootId,
      stateVersion: persistedState.version
    },
    recovery: {
      mode: persistedState.routes.length > 0 ? 'checkpoint-recovery' : 'cold-start',
      routeSnapshots: persistedState.routes.length,
      recoveredRoutes: recoveredRoutes.length,
      preservedBlockedOrFailedRoutes: recoveredRoutes.filter((event) => event.restoredStatus).length,
      preservedDisabledRoutes: recoveredRoutes.filter((event) => event.restoredEnabled).length,
      preservedTelemetryRoutes: recoveredRoutes.filter((event) => event.restoredCounters).length,
      preservedSchedules: recoveredRoutes.filter((event) => event.restoredSchedule).length,
      events: recoveryEvents
    },
    idempotency: {
      ledgerEntries: persistedState.commandLedger.length,
      replayedCommands: replayedCommands.length,
      duplicateCommands: duplicateCommands.length,
      restartSafeCommands: lifecycle.commands.filter((command) => command.restartSafe).length,
      rejectedCommandIds: [...replayedCommands, ...duplicateCommands].map((command) => command.commandId),
      noopCommands: lifecycle.commands.filter((command) => command.result === 'replayed-noop' || command.result === 'duplicate-noop').length
    },
    nextCheckpoint,
    nextCheckpointShape: {
      routes: ['key', 'name', 'route', 'owner', 'version', 'status', 'enabled', 'invoked', 'failures', 'lastInvokedAt', 'schedule', 'checkpointRevision'],
      commandLedger: ['commandId', 'idempotencyKey', 'action', 'target', 'result', 'appliedAt', 'auditKey']
    }
  };
}

function buildPreviewReadiness(packet) {
  const validationIssues = uniqueStrings([
    packet.blockedBy,
    ...asArray(packet.providerContract?.issues),
    packet.routeHealth?.state === 'failure-state' ? 'route-health-failure-state' : null,
    packet.routeHealth?.retryable === false && packet.routeHealth?.state !== 'healthy' ? 'route-not-retryable' : null,
    packet.routeHealth?.operationalError?.code,
    packet.auditProof?.boundaryLeaseState === 'denied' ? 'boundary-lease-denied' : null,
    packet.blockedBy === 'boundary-lease-expired' ? 'boundary-lease-expired' : null
  ]);
  const warnings = uniqueStrings([
    ...asArray(packet.providerContract?.warnings),
    packet.routeHealth?.nextRetryNotBefore ? 'route-backoff-active' : null,
    packet.routeHealth?.degradedModeCommand ? 'degraded-mode-command-ready' : null,
    packet.externalProvider?.syncState === 'sync-stale' ? 'provider-sync-stale' : null
  ]);
  const gates = [
    {
      gate: 'boundary',
      state: packet.payloadEnvelope?.boundaryProofId ? 'proof-ready' : 'proof-missing',
      proofId: packet.payloadEnvelope?.boundaryProofId || null
    },
    {
      gate: 'boundary-lease',
      state: !packet.auditProof?.boundaryLeaseId ? 'not-required'
        : packet.auditProof.boundaryLeaseState === 'issued' ? 'ready'
          : 'held',
      proofId: packet.auditProof?.boundaryLeaseId || null,
      expiresAt: packet.auditProof?.boundaryLeaseExpiresAt || null
    },
    {
      gate: 'route-health',
      state: packet.routeHealth?.state || 'unknown',
      retryable: packet.routeHealth?.retryable ?? null,
      nextRetryNotBefore: packet.routeHealth?.nextRetryNotBefore || null
    },
    {
      gate: 'provider-contract',
      state: packet.providerContract
        ? packet.providerContract.accepted ? 'accepted' : 'blocked'
        : packet.mode === 'external-provider' ? 'missing' : 'not-required',
      providerId: packet.providerContract?.providerId || packet.externalProvider?.providerId || null,
      syncRevision: packet.providerContract?.syncRevision || null
    },
    {
      gate: 'provider-capability-grant',
      state: packet.mode !== 'external-provider' ? 'not-required'
        : packet.providerContract?.capabilityGrant?.state === 'granted' ? 'accepted'
          : 'blocked',
      providerId: packet.providerContract?.providerId || packet.externalProvider?.providerId || null,
      syncRevision: packet.providerContract?.syncRevision || null,
      grantState: packet.providerContract?.capabilityGrant?.state || null
    },
    {
      gate: 'external-provider-handoff',
      state: packet.mode !== 'external-provider' ? 'not-required'
        : packet.externalProvider?.handoffContract?.state === 'ready' ? 'ready'
          : 'held',
      providerId: packet.externalProvider?.providerId || null,
      targetRoute: packet.externalProvider?.handoffContract?.routes?.endpointRoute || packet.targetRoute || null,
      expiresAt: packet.externalProvider?.handoffContract?.expiresAt || null
    },
    {
      gate: 'dispatch-envelope',
      state: packet.accepted ? 'ready' : 'held',
      targetRoute: packet.targetRoute || null,
      mode: packet.mode
    }
  ];

  return {
    state: packet.accepted ? 'ready'
      : validationIssues.includes('route-health-blocked') || validationIssues.includes('route-health-failure-state') ? 'health-held'
        : validationIssues.some((issue) => issue?.startsWith('provider-') || issue === 'service-contract-invalid' || issue === 'capability-negotiation-failed' || issue === 'kernel-capability-negotiation-failed') ? 'provider-held'
          : 'needs-client-action',
    validationIssues,
    warnings,
    gates,
    readyGateCount: gates.filter((gate) => ['proof-ready', 'accepted', 'not-required', 'ready', 'healthy'].includes(gate.state)).length,
    blockedGateCount: gates.filter((gate) => ['blocked', 'missing', 'held', 'failure-state'].includes(gate.state)).length
  };
}

function buildPreviewCard(packet) {
  const readiness = buildPreviewReadiness(packet);
  const continuation = packet.continuation || {};
  const displayStatus = packet.accepted ? 'accepted'
    : readiness.state === 'provider-held' ? 'provider-review'
      : readiness.state === 'health-held' ? 'health-review'
        : 'correction-needed';

  return {
    previewId: `${packet.requestId}:preview`,
    requestId: packet.requestId,
    dispatchId: packet.dispatchId,
    handoffId: packet.handoffId,
    title: continuation.userVisible?.title || (packet.accepted ? 'Syscall accepted' : 'Syscall held'),
    displayStatus,
    accepted: packet.accepted,
    readinessState: readiness.state,
    syscall: packet.syscall,
    route: packet.route,
    tenantId: packet.tenantId,
    workspaceId: packet.workspaceId,
    priority: packet.priority,
    dispatchMode: packet.mode,
    dispatchAfter: packet.dispatchAfter,
    targetRoute: packet.targetRoute,
    nextVisibleStep: continuation.nextVisibleStep || 'show-request-correction',
    recommendedAction: continuation.userVisible?.recommendedAction || 'correct-request-and-replay',
    blockedBy: packet.blockedBy,
    validation: {
      ok: packet.accepted,
      issues: readiness.validationIssues,
      warnings: readiness.warnings,
      gateCount: readiness.gates.length,
      readyGateCount: readiness.readyGateCount,
      blockedGateCount: readiness.blockedGateCount
    },
    readinessGates: readiness.gates,
    proofRefs: {
      boundaryProofId: packet.payloadEnvelope?.boundaryProofId || packet.continuation?.proofRefs?.boundaryProofId || null,
      boundaryLeaseId: packet.payloadEnvelope?.boundaryLeaseId || packet.continuation?.proofRefs?.boundaryLeaseId || null,
      dispatchProofId: packet.auditProof?.proofId || packet.continuation?.proofRefs?.dispatchProofId || null,
      auditKey: packet.auditProof?.auditKey || packet.payloadEnvelope?.auditKey || null,
      replaySafe: packet.auditProof?.replaySafe || false
    },
    clientStatePatch: continuation.clientStatePatch || null,
    providerHandoff: continuation.providerHandoff,
    externalHandoffContract: packet.externalProvider?.handoffContract || null,
    operationalError: packet.routeHealth?.operationalError || null,
    degradedModeCommand: packet.routeHealth?.degradedModeCommand || null,
    resume: {
      route: packet.externalProvider?.handoffContract?.routes?.kernelResumeRoute || continuation.resumeRoute || packet.kernelHandoffRoute || packet.targetRoute || null,
      token: packet.externalProvider?.handoffContract?.replay?.resumeToken || continuation.resumeToken || null,
      state: continuation.state || 'unknown'
    }
  };
}

function normalizePreviewAcceptancePolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const maxQueueSize = toPositiveInteger(source.maxQueueSize, 50);
  const issues = [];

  if (source.maxQueueSize !== undefined && maxQueueSize !== source.maxQueueSize) {
    issues.push({
      code: 'previewAcceptance.maxQueueSize.invalid',
      severity: 'warning',
      message: 'maxQueueSize must be a positive integer; default applied'
    });
  }

  return {
    policy: {
      allowClientAccept: toBoolean(source.allowClientAccept, true),
      allowClientDismissHeld: toBoolean(source.allowClientDismissHeld, true),
      requireProofsForAccept: toBoolean(source.requireProofsForAccept, true),
      requireReplaySafeAccept: toBoolean(source.requireReplaySafeAccept, true),
      autoAcceptReadyPreviews: toBoolean(source.autoAcceptReadyPreviews, false),
      maxQueueSize,
      acceptanceRoute: cleanString(source.acceptanceRoute) || `${DEFAULT_ROUTE}/ui-preview-acceptance/accept`,
      dismissalRoute: cleanString(source.dismissalRoute) || `${DEFAULT_ROUTE}/ui-preview-acceptance/dismiss`,
      replayRoute: cleanString(source.replayRoute) || `${DEFAULT_ROUTE}/dispatch/replay`
    },
    issues
  };
}

function buildPreviewAcceptanceAction(preview, policy) {
  const proofIds = uniqueStrings([
    preview.proofRefs.boundaryProofId,
    preview.proofRefs.boundaryLeaseId,
    preview.proofRefs.dispatchProofId
  ].filter(Boolean));
  const proofReady = Boolean(preview.proofRefs.boundaryProofId && preview.proofRefs.dispatchProofId);
  const replaySafe = Boolean(preview.proofRefs.replaySafe);
  const validationOk = preview.validation.ok && preview.validation.blockedGateCount === 0;
  const acceptBlocks = uniqueStrings([
    !policy.allowClientAccept ? 'client-accept-disabled' : null,
    !preview.accepted ? 'preview-not-accepted-by-dispatch' : null,
    !validationOk ? 'preview-validation-not-ready' : null,
    policy.requireProofsForAccept && !proofReady ? 'acceptance-proofs-missing' : null,
    policy.requireReplaySafeAccept && !replaySafe ? 'acceptance-replay-safety-required' : null
  ]);
  const dismissBlocks = uniqueStrings([
    !policy.allowClientDismissHeld ? 'client-dismiss-disabled' : null,
    preview.accepted ? 'accepted-preview-cannot-be-dismissed' : null
  ]);
  const canAccept = acceptBlocks.length === 0;
  const canDismiss = dismissBlocks.length === 0;
  const primaryCommand = canAccept
    ? {
        command: policy.autoAcceptReadyPreviews ? 'auto-accept-preview' : 'accept-preview',
        method: 'POST',
        route: policy.acceptanceRoute,
        idempotencyKey: `${preview.proofRefs.auditKey || preview.requestId}:preview-accept`,
        body: {
          previewId: preview.previewId,
          requestId: preview.requestId,
          dispatchId: preview.dispatchId,
          resumeToken: preview.resume.token,
          proofIds
        }
      }
    : canDismiss
      ? {
          command: 'dismiss-held-preview',
          method: 'POST',
          route: policy.dismissalRoute,
          idempotencyKey: `${preview.proofRefs.auditKey || preview.requestId}:preview-dismiss`,
          body: {
            previewId: preview.previewId,
            requestId: preview.requestId,
            blockedBy: preview.blockedBy,
            validationIssues: preview.validation.issues
          }
        }
      : null;

  return {
    schema: 'aios.syscall.preview-acceptance-action.v1',
    actionState: canAccept ? 'ready-for-user-accept'
      : canDismiss ? 'held-preview-dismissable'
        : preview.accepted ? 'acceptance-blocked'
          : 'held-preview-requires-resolution',
    canAccept,
    canDismiss,
    proofReady,
    replaySafe,
    validationOk,
    blockedBy: canAccept ? null : acceptBlocks[0] || dismissBlocks[0] || preview.blockedBy,
    acceptBlocks,
    dismissBlocks,
    primaryCommand,
    nextStepData: {
      nextVisibleStep: preview.nextVisibleStep,
      recommendedAction: preview.recommendedAction,
      resumeRoute: preview.resume.route,
      resumeToken: preview.resume.token,
      replayRoute: policy.replayRoute,
      proofIds,
      readinessGates: preview.readinessGates.map((gate) => ({
        gate: gate.gate,
        state: gate.state,
        targetRoute: gate.targetRoute || null,
        providerId: gate.providerId || null
      }))
    }
  };
}

function buildPreviewAcceptanceContract(lifecycle, clientRuntime, providerContracts, operationalHealth, dispatchManifest, persistence, rawPolicy, generatedAt) {
  const { policy, issues: policyIssues } = normalizePreviewAcceptancePolicy(rawPolicy);
  const previews = dispatchManifest.packets.slice(0, policy.maxQueueSize).map((packet) => {
    const preview = buildPreviewCard(packet);
    return {
      ...preview,
      acceptanceAction: buildPreviewAcceptanceAction(preview, policy)
    };
  });
  const acceptedPreviews = previews.filter((preview) => preview.accepted);
  const heldPreviews = previews.filter((preview) => !preview.accepted);
  const validationIssues = [
    ...lifecycle.validation.issues.map((issue) => issue.code),
    ...operationalHealth.validation.issues.map((issue) => issue.code),
    ...policyIssues.map((issue) => issue.code),
    ...previews.flatMap((preview) => preview.validation.issues)
  ].filter(Boolean);
  const readinessState = operationalHealth.failureState.active ? 'operator-intervention-required'
    : heldPreviews.length > 0 ? 'preview-holds-present'
      : acceptedPreviews.length > 0 ? 'ready-for-user-acceptance'
        : 'awaiting-user-request';
  const nextSteps = uniqueStrings([
    ...previews.map((preview) => preview.nextVisibleStep),
    dispatchManifest.nextAction,
    persistence.nextCheckpoint.restartReadiness.state === 'restart-ready' ? 'checkpoint-ready' : 'review-restart-readiness'
  ]);

  return {
    version: 1,
    schema: 'aios.syscall.preview-acceptance.v1',
    generatedAt,
    route: `${DEFAULT_ROUTE}/ui-preview-acceptance`,
    policy,
    readinessState,
    previews,
    acceptanceQueue: previews.map((preview, index) => ({
      queuePosition: index + 1,
      previewId: preview.previewId,
      requestId: preview.requestId,
      accepted: preview.accepted,
      displayStatus: preview.displayStatus,
      readinessState: preview.readinessState,
      nextVisibleStep: preview.nextVisibleStep,
      recommendedAction: preview.recommendedAction,
      resumeRoute: preview.resume.route,
      actionState: preview.acceptanceAction.actionState,
      canAccept: preview.acceptanceAction.canAccept,
      canDismiss: preview.acceptanceAction.canDismiss,
      blockedBy: preview.acceptanceAction.blockedBy,
      command: preview.acceptanceAction.primaryCommand,
      nextStepData: preview.acceptanceAction.nextStepData,
      proofIds: [preview.proofRefs.boundaryProofId, preview.proofRefs.dispatchProofId].filter(Boolean)
    })),
    validationSummary: {
      ok: heldPreviews.length === 0 && lifecycle.validation.ok && operationalHealth.validation.ok && policyIssues.length === 0,
      issueCount: validationIssues.length,
      uniqueIssues: uniqueStrings(validationIssues),
      lifecycleSettingsOk: lifecycle.validation.ok,
      healthSettingsOk: operationalHealth.validation.ok,
      policySettingsOk: policyIssues.length === 0,
      rejectedHandoffs: clientRuntime.summary.rejectedHandoffs,
      rejectedNegotiations: providerContracts.summary.rejectedNegotiations,
      heldDispatchPackets: dispatchManifest.summary.heldPackets,
      actionableErrors: operationalHealth.summary.actionableErrorCount,
      restartReadiness: persistence.nextCheckpoint.restartReadiness.state
    },
    readinessSummary: {
      totalPreviews: previews.length,
      acceptedPreviews: acceptedPreviews.length,
      heldPreviews: heldPreviews.length,
      acceptReadyPreviews: previews.filter((preview) => preview.acceptanceAction.canAccept).length,
      dismissableHeldPreviews: previews.filter((preview) => preview.acceptanceAction.canDismiss).length,
      acceptanceBlockedPreviews: previews.filter((preview) => preview.acceptanceAction.actionState === 'acceptance-blocked').length,
      queueTruncated: dispatchManifest.packets.length > previews.length,
      sourcePacketCount: dispatchManifest.packets.length,
      externalProviderPreviews: previews.filter((preview) => preview.dispatchMode === 'external-provider').length,
      hostedKernelPreviews: previews.filter((preview) => preview.dispatchMode === 'hosted-kernel').length,
      proofReadyPreviews: previews.filter((preview) => preview.proofRefs.boundaryProofId && preview.proofRefs.dispatchProofId).length,
      replaySafePreviews: previews.filter((preview) => preview.proofRefs.replaySafe).length,
      nextSteps
    },
    clientContract: {
      previewColumns: ['previewId', 'requestId', 'displayStatus', 'accepted', 'readinessState', 'syscall', 'route', 'dispatchMode', 'nextVisibleStep', 'recommendedAction', 'validation', 'readinessGates', 'proofRefs', 'clientStatePatch', 'providerHandoff', 'externalHandoffContract', 'operationalError', 'degradedModeCommand', 'resume', 'acceptanceAction'],
      queueColumns: ['queuePosition', 'previewId', 'requestId', 'accepted', 'displayStatus', 'readinessState', 'nextVisibleStep', 'recommendedAction', 'resumeRoute', 'actionState', 'canAccept', 'canDismiss', 'blockedBy', 'command', 'nextStepData', 'proofIds'],
      gateColumns: ['gate', 'state', 'proofId', 'retryable', 'nextRetryNotBefore', 'providerId', 'syncRevision', 'targetRoute', 'mode', 'grantState', 'expiresAt'],
      actionColumns: ['schema', 'actionState', 'canAccept', 'canDismiss', 'proofReady', 'replaySafe', 'validationOk', 'blockedBy', 'acceptBlocks', 'dismissBlocks', 'primaryCommand', 'nextStepData']
    }
  };
}

function buildRouteReadinessCard(syscall, routeState, negotiation, routeHealth, checkpointRoute) {
  const restartBlocked = checkpointRoute && checkpointRoute.dispatchableAfterRestart === false;
  const validationIssues = uniqueStrings([
    !syscall.enabled ? 'route-disabled' : null,
    syscall.status === 'blocked' ? 'route-blocked' : null,
    syscall.serviceContract.ready ? null : 'service-contract-not-ready',
    ...asArray(syscall.serviceContract.validationIssues),
    routeState?.controls?.lifecycleLocked ? 'lifecycle-locked' : null,
    routeHealth?.operationalError?.code,
    routeHealth?.healthState === 'failure-state' ? 'route-health-failure-state' : null,
    negotiation?.accepted === false ? 'provider-negotiation-blocked' : null,
    ...asArray(negotiation?.issues),
    restartBlocked ? 'restart-dispatch-hold' : null
  ]);
  const warnings = uniqueStrings([
    routeHealth?.healthState === 'degraded' ? 'route-degraded' : null,
    routeHealth?.retry?.nextRetryNotBefore ? 'retry-backoff-active' : null,
    negotiation?.effectiveProviderStatus === 'degraded' ? 'provider-degraded' : null,
    ...asArray(negotiation?.warnings),
    checkpointRoute?.restartStatus && checkpointRoute.restartStatus !== 'ready-after-restart'
      ? checkpointRoute.restartStatus
      : null
  ]);
  const dispatchReady = validationIssues.length === 0
    && (routeState?.effectiveEnabled ?? syscall.enabled)
    && (routeHealth?.healthState === 'healthy' || routeHealth?.healthState === 'degraded')
    && (negotiation?.accepted ?? true)
    && !restartBlocked;
  const readinessState = dispatchReady ? 'ready'
    : validationIssues.includes('route-blocked') || validationIssues.includes('lifecycle-locked') ? 'operator-hold'
      : validationIssues.some((issue) => issue?.startsWith('provider-') || issue === 'service-contract-not-ready') ? 'provider-hold'
        : validationIssues.some((issue) => issue?.startsWith('route-health') || issue?.startsWith('syscall.route') || issue === 'syscall.retry.exhausted') ? 'health-hold'
          : 'configuration-hold';
  const nextStep = dispatchReady ? 'accept-client-invocation'
    : readinessState === 'operator-hold' ? 'request-operator-review'
      : readinessState === 'provider-hold' ? 'refresh-provider-contract'
        : readinessState === 'health-hold' ? routeHealth?.nextAction || 'review-route-health'
          : routeState?.recommendedControl || 'correct-route-configuration';

  return {
    name: syscall.name,
    route: syscall.route,
    owner: syscall.owner,
    domain: syscall.capabilities.domain || syscall.metadata.family,
    builtin: syscall.builtin,
    status: routeState?.effectiveStatus || syscall.status,
    enabled: routeState?.effectiveEnabled ?? syscall.enabled,
    readinessState,
    dispatchReady,
    nextStep,
    clientVisibleStatus: dispatchReady ? 'available'
      : readinessState === 'operator-hold' ? 'needs-operator'
        : readinessState === 'provider-hold' ? 'provider-unavailable'
          : readinessState === 'health-hold' ? 'temporarily-held'
            : 'configuration-needed',
    validation: {
      ok: validationIssues.length === 0,
      issues: validationIssues,
      warnings
    },
    routeHealth: routeHealth
      ? {
          state: routeHealth.healthState,
          retryable: routeHealth.retry.retryable,
          nextRetryNotBefore: routeHealth.retry.nextRetryNotBefore,
          degradedModeEligible: routeHealth.degradedModeEligible,
          operationalErrorCode: routeHealth.operationalError?.code || null
        }
      : null,
    provider: negotiation
      ? {
          providerId: negotiation.providerId,
          serviceId: negotiation.serviceId,
          accepted: negotiation.accepted,
          status: negotiation.effectiveProviderStatus,
          grantState: negotiation.capabilityGrant?.state || null,
          syncState: negotiation.syncState?.state || null,
          externalHandoffState: negotiation.externalHandoff?.state || null
        }
      : null,
    lifecycle: routeState
      ? {
          nextAction: routeState.nextAction,
          nextActionReason: routeState.nextActionReason,
          recommendedControl: routeState.recommendedControl,
          scheduledAt: routeState.nextScheduledAt,
          schedulePaused: routeState.schedulePaused,
          controls: routeState.controls
        }
      : null,
    routeClientWorkflow: routeState?.routeClientWorkflow || null,
    restart: checkpointRoute
      ? {
          restartStatus: checkpointRoute.restartStatus,
          resumeAction: checkpointRoute.resumeAction,
          dispatchableAfterRestart: checkpointRoute.dispatchableAfterRestart
        }
      : null,
    explain: {
      primaryBlocker: validationIssues[0] || null,
      visibleRoute: syscall.route,
      auditCategory: syscall.metadata.auditCategory,
      dispatchClass: syscall.metadata.dispatchClass,
      requiredCapabilities: syscall.capabilities.required,
      providedCapabilities: syscall.capabilities.provided
    }
  };
}

function buildRouteReadinessContract(syscalls, lifecycle, providerContracts, operationalHealth, persistence, generatedAt) {
  const lifecycleByName = new Map(lifecycle.routeStates.map((route) => [route.name, route]));
  const negotiationByName = new Map(providerContracts.negotiations.map((route) => [route.syscall, route]));
  const healthByName = new Map(operationalHealth.routes.map((route) => [route.name, route]));
  const checkpointByName = new Map(persistence.nextCheckpoint.routes.map((route) => [route.name, route]));
  const routes = syscalls.map((syscall) => buildRouteReadinessCard(
    syscall,
    lifecycleByName.get(syscall.name),
    negotiationByName.get(syscall.name),
    healthByName.get(syscall.name),
    checkpointByName.get(syscall.name)
  ));
  const heldRoutes = routes.filter((route) => !route.dispatchReady);
  const issueCounts = routes.reduce((totals, route) => {
    for (const issue of route.validation.issues) totals[issue] = (totals[issue] || 0) + 1;
    return totals;
  }, {});

  return {
    version: 1,
    schema: 'aios.syscall.route-readiness.v1',
    generatedAt,
    route: `${DEFAULT_ROUTE}/route-readiness`,
    routes,
    readinessSummary: {
      totalRoutes: routes.length,
      readyRoutes: routes.filter((route) => route.dispatchReady).length,
      heldRoutes: heldRoutes.length,
      operatorHeldRoutes: routes.filter((route) => route.readinessState === 'operator-hold').length,
      providerHeldRoutes: routes.filter((route) => route.readinessState === 'provider-hold').length,
      healthHeldRoutes: routes.filter((route) => route.readinessState === 'health-hold').length,
      configurationHeldRoutes: routes.filter((route) => route.readinessState === 'configuration-hold').length,
      builtinReadyRoutes: routes.filter((route) => route.builtin && route.dispatchReady).length,
      externalProviderRoutes: routes.filter((route) => route.provider?.externalHandoffState && route.provider.externalHandoffState !== 'hosted-kernel-local').length,
      restartDispatchableRoutes: routes.filter((route) => route.restart?.dispatchableAfterRestart).length,
      nextSteps: uniqueStrings(routes.map((route) => route.nextStep))
    },
    validationSummary: {
      ok: heldRoutes.length === 0,
      issueCount: Object.values(issueCounts).reduce((total, count) => total + count, 0),
      issueCounts,
      topIssue: Object.entries(issueCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || null,
      heldRouteNames: heldRoutes.map((route) => route.name)
    },
    clientContract: {
      routeColumns: ['name', 'route', 'owner', 'domain', 'builtin', 'status', 'enabled', 'readinessState', 'dispatchReady', 'nextStep', 'clientVisibleStatus', 'validation', 'routeHealth', 'provider', 'lifecycle', 'routeClientWorkflow', 'restart', 'explain'],
      validationColumns: ['ok', 'issues', 'warnings'],
      routeWorkflowColumns: ['schema', 'routeKey', 'syscall', 'route', 'domain', 'operation', 'builtin', 'clientVisible', 'supportedIntents', 'unsupportedIntents', 'intentCards', 'dataContract', 'handoff', 'controls'],
      intentCardColumns: ['intent', 'enabled', 'requiredRole', 'blockedReasons', 'requestShape', 'responseShape', 'nextVisibleStep'],
      nextStepValues: ['accept-client-invocation', 'request-operator-review', 'refresh-provider-contract', 'review-route-health', 'correct-route-configuration']
    }
  };
}

function buildCounters(syscalls) {
  return syscalls.reduce((counters, syscall) => {
    counters.total += 1;
    counters.byStatus[syscall.status] = (counters.byStatus[syscall.status] || 0) + 1;
    counters.byOwner[syscall.owner] = (counters.byOwner[syscall.owner] || 0) + 1;
    counters.invocations += syscall.invoked;
    counters.failures += syscall.failures;
    if (syscall.status === 'active') counters.activeRoutes += 1;
    if (syscall.status === 'blocked') counters.blockedRoutes += 1;
    if (syscall.failures > 0) counters.routesWithFailures += 1;
    return counters;
  }, {
    total: 0,
    byStatus: {},
    byOwner: {},
    invocations: 0,
    failures: 0,
    activeRoutes: 0,
    blockedRoutes: 0,
    routesWithFailures: 0
  });
}

function buildBuiltinDomainCatalogRows(syscalls) {
  const routesByName = new Map(syscalls.map((syscall) => [syscall.name, syscall]));

  return REQUIRED_BUILTIN_DOMAINS.map((domain) => {
    const definitions = BUILTIN_SYSCALL_DEFINITIONS.filter((definition) => definition.domain === domain);
    const routes = definitions.map((definition) => routesByName.get(definition.name)).filter(Boolean);
    const definitionIssues = definitions.flatMap((definition) => (
      validateBuiltinDefinition(definition).map((issue) => ({
        code: issue,
        syscall: definition.name
      }))
    ));
    const routeIssues = definitions.flatMap((definition) => {
      const syscall = routesByName.get(definition.name);
      return syscall
        ? validateBuiltinMetadata(syscall, definition).map((issue) => ({
            code: issue,
            syscall: definition.name
          }))
        : [{ code: 'syscall.missing', syscall: definition.name }];
    });
    const policies = BUILTIN_DOMAIN_POLICY[domain] || BUILTIN_DOMAIN_POLICY.kernel;

    return {
      domain,
      label: BUILTIN_DOMAIN_LABELS[domain] || domain,
      routeCount: routes.length,
      requiredRouteCount: definitions.length,
      registered: routes.length === definitions.length,
      routes: definitions.map((definition) => {
        const syscall = routesByName.get(definition.name);
        return {
          name: definition.name,
          route: syscall?.route || definition.route,
          status: syscall?.status || 'missing',
          capability: syscall?.capabilities.primary || definition.capability,
          operation: syscall?.metadata?.operation || definition.metadata?.operation || null,
          dispatchIntents: syscall?.metadata?.dispatchIntents || [],
          auditCategory: syscall?.metadata?.auditCategory || policies.auditCategory,
          dispatchClass: syscall?.metadata?.dispatchClass || policies.dispatchClass,
          providerId: syscall?.serviceContract?.providerId || null,
          serviceId: syscall?.serviceContract?.serviceId || null,
          serviceContractReady: syscall?.serviceContract?.ready ?? false,
          handoffMode: syscall?.serviceContract?.handoffMode || null
        };
      }),
      policy: {
        isolation: policies.isolation,
        mutation: policies.mutation,
        durability: policies.durability,
        auditCategory: policies.auditCategory,
        dispatchClass: policies.dispatchClass
      },
      issueCount: definitionIssues.length + routeIssues.length,
      issues: [...definitionIssues, ...routeIssues]
    };
  });
}

function buildBuiltinCatalogContract(syscalls) {
  const rows = buildBuiltinDomainCatalogRows(syscalls);
  const registeredRoutes = rows.reduce((total, row) => total + row.routeCount, 0);
  const requiredRoutes = rows.reduce((total, row) => total + row.requiredRouteCount, 0);
  const issueRows = rows.flatMap((row) => row.issues.map((issue) => ({
    domain: row.domain,
    label: row.label,
    ...issue
  })));

  return {
    schema: 'aios.syscall.builtin-catalog.v1',
    requiredDomains: REQUIRED_BUILTIN_DOMAINS,
    routePrefix: `${DEFAULT_ROUTE}/builtins`,
    rows,
    issues: issueRows,
    summary: {
      domainCount: rows.length,
      registeredDomainCount: rows.filter((row) => row.registered).length,
      requiredRouteCount: requiredRoutes,
      registeredRouteCount: registeredRoutes,
      missingRouteCount: Math.max(0, requiredRoutes - registeredRoutes),
      issueCount: issueRows.length,
      ok: registeredRoutes === requiredRoutes && issueRows.length === 0
    },
    columns: ['domain', 'label', 'routeCount', 'requiredRouteCount', 'registered', 'routes', 'policy', 'issueCount', 'issues'],
    routeColumns: ['name', 'route', 'status', 'capability', 'operation', 'dispatchIntents', 'auditCategory', 'dispatchClass', 'providerId', 'serviceId', 'serviceContractReady', 'handoffMode'],
    policyColumns: ['isolation', 'mutation', 'durability', 'auditCategory', 'dispatchClass']
  };
}

function buildBuiltinRegistrationReport(syscalls, input = {}) {
  const requiredNames = BUILTIN_SYSCALL_DEFINITIONS.map((definition) => definition.name);
  const routeByName = new Map(syscalls.map((syscall) => [syscall.name, syscall]));
  const rows = requiredNames.map((name) => {
    const syscall = routeByName.get(name);
    const definition = BUILTIN_SYSCALL_DEFINITIONS.find((candidate) => candidate.name === name);
    const definitionIssues = definition ? validateBuiltinDefinition(definition) : ['definition.missing'];
    const missingCapabilities = definition
      ? definition.required.filter((capability) => !syscall?.capabilities.required.includes(capability))
      : [];
    const metadataIssues = syscall ? validateBuiltinMetadata(syscall, definition) : ['syscall.missing'];

    return {
      name,
      route: syscall?.route || null,
      registered: Boolean(syscall),
      status: syscall?.status || 'missing',
      enabled: syscall?.enabled ?? false,
      owner: syscall?.owner || null,
      tenantId: syscall?.tenantId || null,
      workspaceId: syscall?.workspaceId || null,
      boundary: syscall?.permissions.boundary || null,
      capability: syscall?.capabilities.primary || definition?.capability || null,
      domain: syscall?.capabilities.domain || definition?.domain || null,
      domainLabel: BUILTIN_DOMAIN_LABELS[definition?.domain] || definition?.domain || null,
      requiredCapabilities: syscall?.capabilities.required || [],
      providedCapabilities: syscall?.capabilities.provided || [],
      capabilityScopes: syscall?.capabilities.scope || [],
      dataClasses: syscall?.capabilities.dataClasses || [],
      metadata: syscall?.metadata || null,
      serviceContract: syscall?.serviceContract || null,
      providerId: syscall?.serviceContract?.providerId || null,
      serviceId: syscall?.serviceContract?.serviceId || null,
      serviceContractReady: syscall?.serviceContract?.ready ?? false,
      serviceContractIssues: syscall?.serviceContract?.validationIssues || [],
      dispatchIntents: syscall?.metadata?.dispatchIntents || [],
      auditCategory: syscall?.metadata?.auditCategory || null,
      dispatchClass: syscall?.metadata?.dispatchClass || null,
      definitionIssues,
      metadataIssues,
      missingCapabilities,
      scoped: Boolean(
        syscall?.tenantId
        && syscall?.workspaceId
        && syscall?.permissions.allowedTenants.includes(syscall.tenantId.toLowerCase())
        && syscall?.permissions.allowedWorkspaces.includes(syscall.workspaceId.toLowerCase())
      ),
      overrideApplied: syscall?.bootOverride === true
    };
  });
  const missing = rows.filter((row) => !row.registered).map((row) => row.name);
  const unscoped = rows.filter((row) => row.registered && !row.scoped).map((row) => row.name);
  const capabilityGaps = rows.filter((row) => row.missingCapabilities.length > 0).map((row) => row.name);
  const metadataGaps = rows.filter((row) => row.metadataIssues.length > 0).map((row) => row.name);
  const definitionGaps = rows.filter((row) => row.definitionIssues.length > 0).map((row) => row.name);
  const serviceContractGaps = rows.filter((row) => row.registered && !row.serviceContractReady).map((row) => row.name);

  return {
    schema: 'aios.syscall.registry-builtin-boot.v1',
    requiredNames,
    rows,
    summary: {
      requiredCount: requiredNames.length,
      registeredCount: rows.filter((row) => row.registered).length,
      missingCount: missing.length,
      unscopedCount: unscoped.length,
      capabilityGapCount: capabilityGaps.length,
      definitionGapCount: definitionGaps.length,
      metadataGapCount: metadataGaps.length,
      serviceContractGapCount: serviceContractGaps.length,
      overrideCount: rows.filter((row) => row.overrideApplied).length,
      ok: missing.length === 0 && unscoped.length === 0 && capabilityGaps.length === 0 && definitionGaps.length === 0 && metadataGaps.length === 0 && serviceContractGaps.length === 0
    },
    issues: [
      ...missing.map((name) => ({ code: 'builtin.missing', severity: 'error', name })),
      ...unscoped.map((name) => ({ code: 'builtin.scope.missing', severity: 'error', name })),
      ...capabilityGaps.map((name) => ({ code: 'builtin.capability.gap', severity: 'error', name })),
      ...definitionGaps.map((name) => ({
        code: 'builtin.definition.gap',
        severity: 'error',
        name,
        definitionIssues: rows.find((row) => row.name === name)?.definitionIssues || []
      })),
      ...metadataGaps.map((name) => ({
        code: 'builtin.metadata.gap',
        severity: 'error',
        name,
        metadataIssues: rows.find((row) => row.name === name)?.metadataIssues || []
      })),
      ...serviceContractGaps.map((name) => ({
        code: 'builtin.serviceContract.gap',
        severity: 'error',
        name,
        serviceContractIssues: rows.find((row) => row.name === name)?.serviceContractIssues || []
      }))
    ]
  };
}

function buildHistorySnapshots(history, now) {
  return asArray(history).slice(-12).map((entry, index) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const counters = source.counters && typeof source.counters === 'object'
      ? source.counters
      : {};
    const dimensions = source.dimensions && typeof source.dimensions === 'object'
      ? source.dimensions
      : {};
    const registered = toNonNegativeInteger(counters.total ?? counters.registered ?? source.registered ?? source.total, 0);
    const activeRoutes = toNonNegativeInteger(counters.activeRoutes ?? source.activeRoutes, 0);
    const blockedRoutes = toNonNegativeInteger(counters.blockedRoutes ?? source.blockedRoutes, 0);
    const routesWithFailures = toNonNegativeInteger(counters.routesWithFailures ?? source.routesWithFailures, 0);
    const invocations = toNonNegativeInteger(counters.invocations ?? source.invocations, 0);
    const failures = toNonNegativeInteger(counters.failures ?? source.failures, 0);

    return {
      snapshotId: typeof source.snapshotId === 'string' && source.snapshotId.trim()
        ? source.snapshotId.trim()
        : `syscall-history-${index + 1}`,
      capturedAt: typeof source.capturedAt === 'string' && source.capturedAt.trim()
        ? source.capturedAt.trim()
        : now,
      registered,
      activeRoutes,
      blockedRoutes,
      routesWithFailures,
      invocations,
      failures,
      failureRate: invocations > 0 ? Number((failures / invocations).toFixed(6)) : 0,
      dimensions: {
        byDomain: normalizeSnapshotDimensionCounters(dimensions.byDomain || source.byDomain),
        byStatus: normalizeSnapshotDimensionCounters(dimensions.byStatus || source.byStatus),
        byProvider: normalizeSnapshotDimensionCounters(dimensions.byProvider || source.byProvider)
      }
    };
  });
}

function normalizeSnapshotDimensionCounters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return Object.fromEntries(Object.entries(source)
    .map(([key, value]) => {
      const dimensionKey = cleanString(key);
      if (!dimensionKey) return null;
      if (Number.isFinite(value)) {
        return [dimensionKey, {
          routes: Math.max(0, Math.trunc(value)),
          invocations: 0,
          failures: 0,
          failureRate: 0,
          blockedRoutes: 0,
          readyRoutes: 0
        }];
      }
      if (!value || typeof value !== 'object') return null;
      const routes = toNonNegativeInteger(value.routes ?? value.routeCount ?? value.total, 0);
      const invocations = toNonNegativeInteger(value.invocations, 0);
      const failures = toNonNegativeInteger(value.failures, 0);
      return [dimensionKey, {
        routes,
        invocations,
        failures,
        failureRate: invocations > 0 ? Number((failures / invocations).toFixed(6)) : toRatio(value.failureRate, 0),
        blockedRoutes: toNonNegativeInteger(value.blockedRoutes, 0),
        readyRoutes: toNonNegativeInteger(value.readyRoutes ?? value.activeRoutes, 0)
      }];
    })
    .filter(Boolean));
}

function incrementAnalyticsDimension(bucket, key, syscall, ready) {
  const dimensionKey = cleanString(key) || 'unknown';
  const current = bucket[dimensionKey] || {
    routes: 0,
    invocations: 0,
    failures: 0,
    blockedRoutes: 0,
    readyRoutes: 0
  };

  current.routes += 1;
  current.invocations += syscall.invoked;
  current.failures += syscall.failures;
  if (syscall.status === 'blocked') current.blockedRoutes += 1;
  if (ready) current.readyRoutes += 1;
  bucket[dimensionKey] = current;
}

function finalizeAnalyticsDimension(bucket) {
  return Object.fromEntries(Object.entries(bucket)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [
      key,
      {
        ...values,
        failureRate: values.invocations > 0 ? Number((values.failures / values.invocations).toFixed(6)) : 0
      }
    ]));
}

function buildAnalyticsSnapshot(syscalls, counters, generatedAt) {
  const byTenant = {};
  const byWorkspace = {};
  const byOwner = {};
  const byDomain = {};
  const byStatus = {};
  const byProvider = {};

  for (const syscall of syscalls) {
    const owner = syscall.owner || 'kernel';
    const tenantId = syscall.tenantId || DEFAULT_TENANT_ID;
    const workspaceId = syscall.workspaceId || DEFAULT_WORKSPACE_ID;
    const domain = syscall.capabilities.domain || syscall.metadata.family || 'kernel';
    const providerId = syscall.serviceContract?.providerId || 'unbound-provider';
    const ready = syscall.enabled && syscall.status === 'active' && syscall.serviceContract?.ready !== false;
    byTenant[tenantId] = (byTenant[tenantId] || 0) + 1;
    byWorkspace[workspaceId] = (byWorkspace[workspaceId] || 0) + 1;
    byOwner[owner] = byOwner[owner] || { routes: 0, invocations: 0, failures: 0, blockedRoutes: 0 };
    byOwner[owner].routes += 1;
    byOwner[owner].invocations += syscall.invoked;
    byOwner[owner].failures += syscall.failures;
    if (syscall.status === 'blocked') byOwner[owner].blockedRoutes += 1;
    incrementAnalyticsDimension(byDomain, domain, syscall, ready);
    incrementAnalyticsDimension(byStatus, syscall.status, syscall, ready);
    incrementAnalyticsDimension(byProvider, providerId, syscall, ready);
  }

  return {
    snapshotId: `${surfaceId}:${generatedAt}`,
    capturedAt: generatedAt,
    counters: {
      ...counters,
      failureRate: counters.invocations > 0 ? Number((counters.failures / counters.invocations).toFixed(6)) : 0,
      enabledRoutes: syscalls.filter((syscall) => syscall.enabled).length,
      scheduledRoutes: syscalls.filter((syscall) => syscall.schedule.enabled).length,
      tenantCount: Object.keys(byTenant).length,
      workspaceCount: Object.keys(byWorkspace).length
    },
    dimensions: {
      byTenant,
      byWorkspace,
      byDomain: finalizeAnalyticsDimension(byDomain),
      byStatus: finalizeAnalyticsDimension(byStatus),
      byProvider: finalizeAnalyticsDimension(byProvider),
      byOwner: Object.fromEntries(Object.entries(byOwner).map(([owner, values]) => [
        owner,
        {
          ...values,
          failureRate: values.invocations > 0 ? Number((values.failures / values.invocations).toFixed(6)) : 0
        }
      ]))
    }
  };
}

function buildAnalyticsExportDimensionRows(currentSnapshot) {
  const rows = [];

  for (const [dimension, values] of Object.entries({
    domain: currentSnapshot.dimensions.byDomain,
    status: currentSnapshot.dimensions.byStatus,
    provider: currentSnapshot.dimensions.byProvider
  })) {
    for (const [key, counters] of Object.entries(values)) {
      rows.push({
        dimension,
        key,
        routes: counters.routes,
        readyRoutes: counters.readyRoutes,
        blockedRoutes: counters.blockedRoutes,
        invocations: counters.invocations,
        failures: counters.failures,
        failureRate: counters.failureRate,
        exportPath: `${DEFAULT_ROUTE}/analytics-export/dimensions/${dimension}/${key}`
      });
    }
  }

  return rows.sort((left, right) => (
    left.dimension.localeCompare(right.dimension)
    || right.failures - left.failures
    || right.invocations - left.invocations
    || left.key.localeCompare(right.key)
  ));
}

function buildAnalyticsDeltas(history, currentSnapshot) {
  const previous = history.at(-1) || null;
  const current = currentSnapshot.counters;

  if (!previous) {
    return {
      baseline: 'current-only',
      previousSnapshotId: null,
      registeredDelta: current.total,
      activeRouteDelta: current.activeRoutes,
      invocationDelta: current.invocations,
      failureDelta: current.failures,
      blockedRouteDelta: current.blockedRoutes,
      failureRateDelta: current.failureRate,
      trend: current.failures > 0 || current.blockedRoutes > 0 ? 'needs-attention' : 'stable'
    };
  }

  const invocationDelta = current.invocations - previous.invocations;
  const failureDelta = current.failures - previous.failures;
  const failureRateDelta = Number((current.failureRate - previous.failureRate).toFixed(6));

  return {
    baseline: 'history-comparison',
    previousSnapshotId: previous.snapshotId,
    previousCapturedAt: previous.capturedAt,
    registeredDelta: current.total - previous.registered,
    activeRouteDelta: current.activeRoutes - previous.activeRoutes,
    invocationDelta,
    failureDelta,
    blockedRouteDelta: current.blockedRoutes - previous.blockedRoutes,
    failureRateDelta,
    trend: failureDelta > 0 || failureRateDelta > 0.01 || current.blockedRoutes > previous.blockedRoutes
      ? 'regressing'
      : invocationDelta > 0 && failureDelta === 0 ? 'improving-throughput'
        : 'stable'
  };
}

function buildAnalyticsCounterLedger(syscalls, counters, lifecycle, clientRuntime, providerContracts, operationalHealth, dispatchManifest) {
  const lifecycleControls = lifecycle.controls || {};
  const providerSummary = providerContracts.summary || {};
  const healthSummary = operationalHealth.summary || {};
  const dispatchSummary = dispatchManifest.summary || {};
  const baseCounters = [
    ['registry.routes.total', counters.total, 'route', 'inventory', counters.total === 0 ? 'warning' : 'info'],
    ['registry.routes.active', counters.activeRoutes, 'route', 'inventory', 'info'],
    ['registry.routes.blocked', counters.blockedRoutes, 'route', 'risk', counters.blockedRoutes > 0 ? 'critical' : 'info'],
    ['registry.routes.with_failures', counters.routesWithFailures, 'route', 'risk', counters.routesWithFailures > 0 ? 'warning' : 'info'],
    ['registry.invocations.total', counters.invocations, 'call', 'traffic', 'info'],
    ['registry.failures.total', counters.failures, 'call', 'risk', counters.failures > 0 ? 'warning' : 'info'],
    ['lifecycle.commands.pending', lifecycleControls.pendingCommandCount || 0, 'command', 'control', 'info'],
    ['lifecycle.commands.rejected', lifecycleControls.rejectedCommandCount || 0, 'command', 'control', (lifecycleControls.rejectedCommandCount || 0) > 0 ? 'error' : 'info'],
    ['lifecycle.schedules.paused', lifecycleControls.pausedSchedules || 0, 'schedule', 'control', (lifecycleControls.pausedSchedules || 0) > 0 ? 'warning' : 'info'],
    ['lifecycle.schedules.resumable', lifecycleControls.resumableSchedules || 0, 'schedule', 'control', 'info'],
    ['handoffs.accepted', clientRuntime.summary.acceptedHandoffs, 'handoff', 'client-runtime', 'info'],
    ['handoffs.rejected', clientRuntime.summary.rejectedHandoffs, 'handoff', 'client-runtime', clientRuntime.summary.rejectedHandoffs > 0 ? 'error' : 'info'],
    ['handoffs.boundary_rejections', clientRuntime.summary.boundaryRejections, 'handoff', 'boundary', clientRuntime.summary.boundaryRejections > 0 ? 'error' : 'info'],
    ['providers.bound_routes', providerSummary.boundRoutes || 0, 'route', 'provider', 'info'],
    ['providers.rejected_negotiations', providerSummary.rejectedNegotiations || 0, 'route', 'provider', (providerSummary.rejectedNegotiations || 0) > 0 ? 'error' : 'info'],
    ['providers.stale_sync', providerSummary.staleSyncProviders || 0, 'provider', 'provider', (providerSummary.staleSyncProviders || 0) > 0 ? 'warning' : 'info'],
    ['health.actionable_errors', healthSummary.actionableErrorCount || 0, 'error', 'health', (healthSummary.actionableErrorCount || 0) > 0 ? healthSummary.highestSeverity || 'warning' : 'info'],
    ['dispatch.ready_packets', dispatchSummary.readyPackets || 0, 'packet', 'dispatch', 'info'],
    ['dispatch.held_packets', dispatchSummary.heldPackets || 0, 'packet', 'dispatch', (dispatchSummary.heldPackets || 0) > 0 ? 'warning' : 'info'],
    ['dispatch.external_provider_packets', dispatchSummary.externalProviderDispatches || 0, 'packet', 'dispatch', 'info']
  ];

  const routeCounters = syscalls.map((syscall) => ({
    counter: `route.${syscall.name}.failure_rate`,
    value: syscall.invoked > 0 ? Number((syscall.failures / syscall.invoked).toFixed(6)) : 0,
    unit: 'ratio',
    domain: 'route',
    severity: syscall.status === 'blocked' ? 'critical' : syscall.failures > 0 ? 'warning' : 'info',
    subject: syscall.name,
    tags: {
      owner: syscall.owner,
      tenantId: syscall.tenantId,
      workspaceId: syscall.workspaceId,
      status: syscall.status
    },
    exportPath: `${DEFAULT_ROUTE}/analytics/counters/route/${syscall.owner}/${syscall.name}`
  }));

  const countersBySeverity = {};
  const ledger = [
    ...baseCounters.map(([counter, value, unit, domain, severity]) => ({
      counter,
      value,
      unit,
      domain,
      severity,
      subject: surfaceName,
      tags: { surfaceId, surfaceGroup },
      exportPath: `${DEFAULT_ROUTE}/analytics/counters/${domain}/${counter}`
    })),
    ...routeCounters
  ];

  for (const entry of ledger) {
    countersBySeverity[entry.severity] = (countersBySeverity[entry.severity] || 0) + 1;
  }

  return {
    schema: 'aios.syscall.analytics-counter-ledger.v1',
    counters: ledger,
    summary: {
      counterCount: ledger.length,
      criticalCounters: countersBySeverity.critical || 0,
      errorCounters: countersBySeverity.error || 0,
      warningCounters: countersBySeverity.warning || 0,
      infoCounters: countersBySeverity.info || 0,
      routeCounterCount: routeCounters.length,
      exportableCounters: ledger.filter((entry) => entry.exportPath).length
    }
  };
}

function buildAnalyticsHistoryEnvelope(history, currentSnapshot, deltas, generatedAt) {
  const currentHistorySnapshot = {
    snapshotId: currentSnapshot.snapshotId,
    capturedAt: currentSnapshot.capturedAt,
    registered: currentSnapshot.counters.total,
    activeRoutes: currentSnapshot.counters.activeRoutes,
    blockedRoutes: currentSnapshot.counters.blockedRoutes,
    routesWithFailures: currentSnapshot.counters.routesWithFailures,
    invocations: currentSnapshot.counters.invocations,
    failures: currentSnapshot.counters.failures,
    failureRate: currentSnapshot.counters.failureRate,
    dimensions: {
      byDomain: currentSnapshot.dimensions.byDomain,
      byStatus: currentSnapshot.dimensions.byStatus,
      byProvider: currentSnapshot.dimensions.byProvider
    }
  };
  const snapshots = [...history, currentHistorySnapshot].slice(-13);
  const invocationValues = snapshots.map((snapshot) => snapshot.invocations);
  const failureRateValues = snapshots.map((snapshot) => snapshot.failureRate);
  const lastThree = snapshots.slice(-3);
  const previousDomainKeys = new Set(Object.keys(history.at(-1)?.dimensions?.byDomain || {}));
  const currentDomainKeys = Object.keys(currentSnapshot.dimensions.byDomain);
  const newDomainKeys = currentDomainKeys.filter((key) => !previousDomainKeys.has(key));

  return {
    schema: 'aios.syscall.analytics-history.v1',
    generatedAt,
    snapshots,
    currentSnapshotId: currentSnapshot.snapshotId,
    previousSnapshotId: deltas.previousSnapshotId || null,
    rollingWindow: {
      snapshotCount: snapshots.length,
      firstCapturedAt: snapshots[0]?.capturedAt || generatedAt,
      lastCapturedAt: snapshots.at(-1)?.capturedAt || generatedAt,
      minInvocations: invocationValues.length > 0 ? Math.min(...invocationValues) : 0,
      maxInvocations: invocationValues.length > 0 ? Math.max(...invocationValues) : 0,
      maxFailureRate: failureRateValues.length > 0 ? Math.max(...failureRateValues) : 0,
      lastThreeFailureRateAverage: lastThree.length > 0
        ? Number((lastThree.reduce((total, snapshot) => total + snapshot.failureRate, 0) / lastThree.length).toFixed(6))
        : 0,
      currentDomainCount: currentDomainKeys.length,
      newDomainKeys
    },
    trendEvents: [
      deltas.invocationDelta !== 0 ? {
        at: generatedAt,
        type: 'analytics.invocation-delta',
        value: deltas.invocationDelta,
        state: deltas.invocationDelta > 0 ? 'traffic-increased' : 'traffic-decreased'
      } : null,
      deltas.failureDelta !== 0 ? {
        at: generatedAt,
        type: 'analytics.failure-delta',
        value: deltas.failureDelta,
        state: deltas.failureDelta > 0 ? 'failures-increased' : 'failures-decreased'
      } : null,
      deltas.blockedRouteDelta !== 0 ? {
        at: generatedAt,
        type: 'analytics.blocked-route-delta',
        value: deltas.blockedRouteDelta,
        state: deltas.blockedRouteDelta > 0 ? 'blocked-routes-increased' : 'blocked-routes-decreased'
      } : null
    ].filter(Boolean)
  };
}

function buildAnalyticsReport(syscalls, counters, history, lifecycle, clientRuntime, providerContracts, operationalHealth, dispatchManifest, generatedAt) {
  const currentSnapshot = buildAnalyticsSnapshot(syscalls, counters, generatedAt);
  const deltas = buildAnalyticsDeltas(history, currentSnapshot);
  const dimensionRows = buildAnalyticsExportDimensionRows(currentSnapshot);
  const counterLedger = buildAnalyticsCounterLedger(
    syscalls,
    counters,
    lifecycle,
    clientRuntime,
    providerContracts,
    operationalHealth,
    dispatchManifest
  );
  const historyEnvelope = buildAnalyticsHistoryEnvelope(history, currentSnapshot, deltas, generatedAt);
  const exportPartitions = Object.entries(currentSnapshot.dimensions.byOwner).map(([owner, values]) => ({
    partitionKey: `owner=${owner}`,
    owner,
    routeCount: values.routes,
    invocations: values.invocations,
    failures: values.failures,
    failureRate: values.failureRate,
    blockedRoutes: values.blockedRoutes
  })).sort((left, right) => right.failures - left.failures || right.invocations - left.invocations);

  const reportingState = operationalHealth.mode === 'manual-intervention'
    ? 'operator-report-required'
    : counterLedger.summary.criticalCounters > 0 || counterLedger.summary.errorCounters > 0 ? 'publish-risk-counter-report'
    : deltas.trend === 'regressing' || clientRuntime.summary.rejectedHandoffs > 0 ? 'publish-attention-report'
      : lifecycle.commands.some((command) => command.accepted) ? 'publish-change-report'
        : 'publish-routine-report';

  return {
    version: 1,
    generatedAt,
    currentSnapshot,
    deltas,
    counterLedger,
    historyEnvelope,
    reportingState,
    timelineState: {
      state: historyEnvelope.trendEvents.length > 0 ? 'timeline-updated' : 'timeline-steady',
      eventCount: historyEnvelope.trendEvents.length,
      latestSnapshotId: historyEnvelope.currentSnapshotId,
      previousSnapshotId: historyEnvelope.previousSnapshotId,
      rollingWindowState: historyEnvelope.rollingWindow.maxFailureRate > currentSnapshot.counters.failureRate
        ? 'recovering-from-prior-failure-rate'
        : currentSnapshot.counters.failureRate > 0 ? 'active-failure-rate'
          : 'clean-window'
    },
    retention: {
      historyWindow: history.length,
      maxHistoryWindow: 12,
      retainedWithCurrentSnapshot: historyEnvelope.snapshots.length,
      nextSnapshotShape: ['snapshotId', 'capturedAt', 'counters.total', 'counters.activeRoutes', 'counters.invocations', 'counters.failures', 'counters.blockedRoutes', 'counters.routesWithFailures']
    },
    exportReady: {
      format: 'jsonl',
      route: `${DEFAULT_ROUTE}/analytics-export`,
      partitionColumns: ['owner', 'tenantId', 'workspaceId', 'status'],
      summaryColumns: ['snapshotId', 'capturedAt', 'total', 'activeRoutes', 'invocations', 'failures', 'failureRate', 'blockedRoutes', 'routesWithFailures'],
      counterColumns: ['counter', 'value', 'unit', 'domain', 'severity', 'subject', 'tags', 'exportPath'],
      historyColumns: ['snapshotId', 'capturedAt', 'registered', 'activeRoutes', 'blockedRoutes', 'routesWithFailures', 'invocations', 'failures', 'failureRate'],
      dimensionColumns: ['dimension', 'key', 'routes', 'readyRoutes', 'blockedRoutes', 'invocations', 'failures', 'failureRate', 'exportPath'],
      partitionCount: exportPartitions.length,
      dimensionRowCount: dimensionRows.length,
      partitions: exportPartitions,
      dimensionRows,
      counterRows: counterLedger.counters,
      historyRows: historyEnvelope.snapshots
    },
    reportCards: [
      {
        card: 'routing-pressure',
        state: counters.blockedRoutes > 0 || counters.routesWithFailures > 0 ? 'attention' : 'ready',
        value: counters.blockedRoutes + counters.routesWithFailures,
        detail: 'blocked routes plus routes with recorded failures'
      },
      {
        card: 'handoff-quality',
        state: clientRuntime.summary.rejectedHandoffs > 0 ? 'attention' : 'ready',
        value: clientRuntime.summary.acceptedHandoffs,
        detail: `${clientRuntime.summary.rejectedHandoffs} rejected handoffs`
      },
      {
        card: 'health-mode',
        state: operationalHealth.mode,
        value: operationalHealth.summary.actionableErrorCount,
        detail: operationalHealth.summary.highestSeverity || 'no actionable errors'
      }
    ]
  };
}

function buildTimeline(syscalls, historySnapshots, now, recoveryEvents = [], reportingEvents = []) {
  const recentInvocations = syscalls
    .filter((syscall) => syscall.lastInvokedAt)
    .sort((left, right) => right.lastInvokedAt.localeCompare(left.lastInvokedAt))
    .slice(0, 8)
    .map((syscall) => ({
      at: syscall.lastInvokedAt,
      type: 'syscall.invoked',
      subject: syscall.name,
      route: syscall.route,
      status: syscall.status
    }));

  const snapshots = historySnapshots.map((snapshot) => ({
    at: snapshot.capturedAt,
    type: 'syscall.registry.snapshot',
    subject: snapshot.snapshotId,
    registered: snapshot.registered,
    activeRoutes: snapshot.activeRoutes,
    failures: snapshot.failures
  }));

  const analyticsEvents = asArray(reportingEvents).map((event) => ({
    at: event.at || now,
    type: event.type || 'analytics.report-event',
    subject: event.state || event.type || surfaceId,
    value: event.value ?? null
  }));

  return [...snapshots, ...recentInvocations, ...recoveryEvents, ...analyticsEvents]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 16)
    .concat({
      at: now,
      type: 'syscall.registry.report.generated',
      subject: surfaceId
    });
}

function buildExportSummary(syscalls, counters, generatedAt) {
  const failureRate = counters.invocations > 0
    ? Number((counters.failures / counters.invocations).toFixed(6))
    : 0;

  return {
    exportVersion: 1,
    generatedAt,
    route: DEFAULT_ROUTE,
    totals: {
      syscalls: counters.total,
      invocations: counters.invocations,
      failures: counters.failures,
      failureRate
    },
    routeHealth: counters.blockedRoutes > 0 || counters.routesWithFailures > 0 ? 'attention' : 'ready',
    rows: syscalls.map((syscall) => ({
      key: syscall.exportKey,
      name: syscall.name,
      owner: syscall.owner,
      tenantId: syscall.tenantId,
      workspaceId: syscall.workspaceId,
      route: syscall.route,
      status: syscall.status,
      version: syscall.version,
      invoked: syscall.invoked,
      failures: syscall.failures,
      lastInvokedAt: syscall.lastInvokedAt,
      enabled: syscall.enabled,
      schedule: syscall.schedule,
      permissions: syscall.permissions,
      capabilities: syscall.capabilities,
      metadata: syscall.metadata,
      serviceContract: syscall.serviceContract,
      operational: syscall.operational,
      builtin: syscall.builtin,
      bootOverride: syscall.bootOverride
    }))
  };
}

export function describeSyscallRegistrySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const coldStartSyscalls = mergeBootSyscalls(input).map(normalizeSyscall);
  const persistedState = normalizePersistedState(input.persistedState || input.registryState || input.checkpoint);
  const recovery = recoverSyscallsFromPersistedState(coldStartSyscalls, persistedState, now);
  const syscalls = recovery.syscalls;
  const builtinRegistration = buildBuiltinRegistrationReport(syscalls, input);
  const builtinCatalog = buildBuiltinCatalogContract(syscalls);
  const counters = buildCounters(syscalls);
  const history = buildHistorySnapshots(input.history || input.analyticsHistory || input.exportHistory, now);
  const lifecycle = buildLifecycleControls(syscalls, input.lifecycleSettings || input.settings, input.lifecycleCommands || input.commands, now, persistedState);
  const clientRuntime = buildClientRuntimeContract(
    syscalls,
    lifecycle,
    input.clientRuntime || input.clientState || input.requestState,
    input.clientRequests || input.requests,
    now
  );
  const providerContracts = buildProviderServiceContracts(
    syscalls,
    lifecycle,
    clientRuntime,
    input.providerContracts || input.providers || input.services,
    input.providerRuntime || input.kernelProviderRuntime || input.kernelCapabilities,
    now
  );
  const operationalHealth = buildOperationalHealth(
    syscalls,
    counters,
    lifecycle,
    clientRuntime,
    input.operationalHealth || input.healthSettings || input.health,
    now
  );
  const dispatchManifest = buildDispatchManifest(clientRuntime, providerContracts, operationalHealth, now);
  const analytics = buildAnalyticsReport(
    syscalls,
    counters,
    history,
    lifecycle,
    clientRuntime,
    providerContracts,
    operationalHealth,
    dispatchManifest,
    now
  );
  const exportSummary = buildExportSummary(syscalls, counters, now);
  const persistence = buildPersistenceContract(syscalls, persistedState, recovery.events, lifecycle, now);
  const routeReadiness = buildRouteReadinessContract(
    syscalls,
    lifecycle,
    providerContracts,
    operationalHealth,
    persistence,
    now
  );
  const previewAcceptance = buildPreviewAcceptanceContract(
    lifecycle,
    clientRuntime,
    providerContracts,
    operationalHealth,
    dispatchManifest,
    persistence,
    input.previewAcceptancePolicy || input.previewPolicy || input.uiPreviewAcceptance,
    now
  );
  const timeline = buildTimeline(syscalls, history, now, recovery.events, analytics.historyEnvelope.trendEvents);
  const evidence = asArray(input.evidence);

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel syscall registry analytics export v1',
    registry: {
      route: DEFAULT_ROUTE,
      syscalls,
      builtinRegistration,
      builtinCatalog,
      counters,
      history,
      timeline,
      lifecycle,
      clientRuntime,
      providerContracts,
      operationalHealth,
      dispatchManifest,
      routeReadiness,
      previewAcceptance,
      analytics,
      persistence
    },
    exports: {
      summary: exportSummary,
      columns: ['key', 'name', 'owner', 'tenantId', 'workspaceId', 'route', 'status', 'version', 'invoked', 'failures', 'lastInvokedAt', 'enabled', 'schedule', 'permissions', 'capabilities', 'metadata', 'serviceContract', 'operational', 'builtin', 'bootOverride'],
      builtinRegistrationContract: {
        schema: builtinRegistration.schema,
        requiredNames: builtinRegistration.requiredNames,
        rowColumns: ['name', 'route', 'registered', 'status', 'enabled', 'owner', 'tenantId', 'workspaceId', 'boundary', 'capability', 'domain', 'domainLabel', 'requiredCapabilities', 'providedCapabilities', 'capabilityScopes', 'dataClasses', 'metadata', 'serviceContract', 'providerId', 'serviceId', 'serviceContractReady', 'serviceContractIssues', 'dispatchIntents', 'auditCategory', 'dispatchClass', 'definitionIssues', 'metadataIssues', 'missingCapabilities', 'scoped', 'overrideApplied'],
        summaryColumns: ['requiredCount', 'registeredCount', 'missingCount', 'unscopedCount', 'capabilityGapCount', 'definitionGapCount', 'metadataGapCount', 'serviceContractGapCount', 'overrideCount', 'ok']
      },
      builtinCatalogContract: {
        schema: builtinCatalog.schema,
        routePrefix: builtinCatalog.routePrefix,
        requiredDomains: builtinCatalog.requiredDomains,
        columns: builtinCatalog.columns,
        routeColumns: builtinCatalog.routeColumns,
        policyColumns: builtinCatalog.policyColumns,
        summaryColumns: ['domainCount', 'registeredDomainCount', 'requiredRouteCount', 'registeredRouteCount', 'missingRouteCount', 'issueCount', 'ok']
      },
      handoffContract: {
        version: clientRuntime.version,
        route: clientRuntime.state.handoffRoute,
        columns: ['handoffId', 'accepted', 'workflow', 'requestId', 'clientId', 'sessionId', 'tenantId', 'workspaceId', 'syscall', 'route', 'routeLookup', 'syscallMetadata', 'routeClientWorkflow', 'priority', 'dispatchAfter', 'auditKey', 'boundary', 'resourceBoundary', 'boundaryProof', 'boundaryLease', 'auditHandoff'],
        routeWorkflowColumns: ['schema', 'routeKey', 'syscall', 'route', 'domain', 'operation', 'builtin', 'clientVisible', 'supportedIntents', 'unsupportedIntents', 'intentCards', 'dataContract', 'handoff', 'controls'],
        routeLookupContract: {
          schema: 'aios.syscall.route-lookup.v1',
          identitySchema: clientRuntime.routeIdentity.schema,
          normalizedKey: clientRuntime.routeIdentity.normalizedKey,
          columns: ['schema', 'requestedTarget', 'requestedRoute', 'targetLookupKey', 'routeLookupKey', 'matchState', 'matchType', 'candidateCount', 'candidates', 'issues'],
          candidateColumns: ['name', 'route', 'owner', 'version', 'status', 'enabled', 'tenantId', 'workspaceId', 'matchType'],
          identityIssueColumns: ['code', 'severity', 'lookupKey', 'routes', 'names']
        }
      },
      lifecycleControlContract: {
        version: 1,
        settingsColumns: ['allowRuntimeEnable', 'allowRuntimeDisable', 'allowScheduling', 'requireReasonForDisable', 'maxScheduledRoutes', 'failureRateBlockThreshold', 'maintenanceWindow'],
        commandColumns: ['commandId', 'action', 'target', 'requestedBy', 'reason', 'runAt', 'pausedUntil', 'cadence', 'idempotencyKey', 'accepted', 'rejectionReason', 'restartSafe', 'restartSemantics', 'wouldChange', 'transition', 'result', 'operatorAction', 'auditRecord'],
        routeStateColumns: ['name', 'route', 'effectiveEnabled', 'effectiveStatus', 'failureRate', 'schedulePaused', 'pauseUntil', 'nextScheduledAt', 'nextAction', 'nextActionReason', 'recommendedControl', 'commandCount', 'rejectedCommandCount', 'autoBlockRecommended', 'controls', 'routeClientWorkflow', 'commandQueue', 'rejectedCommands'],
        controlColumns: ['canEnable', 'canDisable', 'canSchedule', 'canUnschedule', 'canPauseSchedule', 'canResumeSchedule', 'lifecycleLocked', 'scheduleCapacityRemaining'],
        routeWorkflowColumns: ['schema', 'routeKey', 'syscall', 'route', 'domain', 'operation', 'builtin', 'clientVisible', 'supportedIntents', 'unsupportedIntents', 'intentCards', 'dataContract', 'handoff', 'controls'],
        supportedCommands: [...KNOWN_LIFECYCLE_COMMANDS],
        summaryColumns: ['enabledRoutes', 'disabledRoutes', 'schedulableRoutes', 'pausableSchedules', 'resumableSchedules', 'pausedSchedules', 'lockedRoutes', 'scheduleCapacityRemaining', 'rejectedCommandCount', 'pendingCommandCount', 'idempotentReplayCount', 'duplicateNoopCount']
      },
      boundaryProofContract: {
        version: clientRuntime.version,
        auditRoute: clientRuntime.state.boundaryPolicy.auditRoute,
        deniedHandoffRoute: clientRuntime.state.boundaryPolicy.deniedHandoffRoute,
        proofMode: clientRuntime.state.boundaryPolicy.proofMode,
        enforceTenantWorkspaceBinding: clientRuntime.state.boundaryPolicy.enforceTenantWorkspaceBinding,
        resourcePolicy: {
          workspaceRoot: clientRuntime.state.boundaryPolicy.workspaceRoot,
          allowAbsoluteWorkspacePaths: clientRuntime.state.boundaryPolicy.allowAbsoluteWorkspacePaths,
          requireResourceScopeForPathAccess: clientRuntime.state.boundaryPolicy.requireResourceScopeForPathAccess
        },
        columns: ['proofId', 'proofMode', 'generatedAt', 'decision', 'blockedBy', 'auditRoute', 'subject', 'scopes', 'resources', 'roles', 'remediation'],
        leaseRoute: clientRuntime.state.boundaryPolicy.leaseRoute,
        leaseColumns: ['schema', 'leaseId', 'issuedAt', 'expiresAt', 'ttlSeconds', 'state', 'required', 'route', 'token', 'subject', 'scope', 'role', 'verification'],
        scopeColumns: ['requestedTenantId', 'requestedWorkspaceId', 'syscallTenantId', 'syscallWorkspaceId', 'tenantScoped', 'workspaceScoped', 'tenantWorkspaceBound', 'scopeState', 'resourceScopeState', 'resourceScopeIssues', 'boundaryMode', 'enforcedScopes'],
        resourceColumns: ['schema', 'state', 'domain', 'pathAccess', 'requestedScope', 'pathPolicy', 'checkedPaths'],
        roleColumns: ['requiredRole', 'roleRequired', 'grantState', 'allowedRoles', 'matchedRoles', 'suppliedRoleCount'],
        auditPacketColumns: ['auditKey', 'requestId', 'boundaryMode', 'enforcedScopes', 'scopeState', 'roleGrantState', 'tenantWorkspaceBound', 'resourceScopeState', 'resourceScopeIssues', 'resourcePathCount', 'deniedResourcePathCount', 'boundaryLeaseId', 'boundaryLeaseState'],
        summaryColumns: ['boundaryProofs', 'allowedBoundaryProofs', 'deniedBoundaryProofs', 'boundaryLeases', 'issuedBoundaryLeases', 'deniedBoundaryLeases', 'requiredBoundaryLeases', 'auditHandoffs', 'tenantWorkspaceBindingRejections', 'scopedRoleRejections', 'resourceBoundaryRejections', 'deniedResourcePaths', 'payloadTenantScopeRejections', 'payloadWorkspaceScopeRejections', 'tenantWorkspaceBindings']
      },
      providerServiceContract: {
        version: providerContracts.version,
        providerCount: providerContracts.summary.providerCount,
        externalHandoffsReady: providerContracts.summary.externalHandoffsReady,
        kernelRuntimeColumns: ['kernelId', 'contractVersion', 'capabilities', 'externalHandoffPolicy'],
        columns: ['providerId', 'serviceId', 'serviceKey', 'owner', 'status', 'contractVersion', 'routePrefix', 'endpointRoute', 'externalHandoffRoute', 'capabilities', 'acceptedIntents', 'requiredRoles', 'sync'],
        serviceContractColumns: ['schema', 'providerId', 'serviceId', 'serviceKey', 'contractVersion', 'handoffMode', 'externalRoute', 'endpointRoute', 'sync', 'capabilityNegotiation', 'externalHandoff', 'validationIssues', 'ready'],
        negotiationColumns: ['syscall', 'route', 'providerId', 'serviceId', 'contractVersion', 'accepted', 'issues', 'warnings', 'missingCapabilities', 'missingKernelCapabilities', 'unsupportedIntents', 'syscallMetadata', 'serviceContract', 'capabilityGrant', 'kernelCapabilities', 'effectiveProviderStatus', 'syncRevision', 'syncState', 'externalHandoff'],
        capabilityGrantColumns: ['schema', 'syscall', 'route', 'providerId', 'serviceId', 'state', 'routeRequirements', 'kernelRequirements', 'intentGrant', 'syncFence'],
        externalHandoffColumns: ['handoffId', 'requestId', 'syscall', 'providerId', 'serviceId', 'state', 'externalRoute', 'endpointRoute', 'kernelHandoffRoute', 'ttlSeconds', 'blockedBy', 'syncState', 'auditKey', 'handoffContract'],
        externalHandoffContractColumns: ['schema', 'handoffToken', 'issuedAt', 'expiresAt', 'ttlSeconds', 'state', 'provider', 'routes', 'sync', 'grants', 'replay'],
        syncColumns: ['providerId', 'serviceId', 'mode', 'revision', 'cursor', 'lastSyncedAt', 'nextSyncAt', 'staleAfterSeconds', 'ageSeconds', 'stale', 'nextSyncDue', 'state', 'nextAction']
      },
      operationalHealthContract: {
        version: operationalHealth.version,
        mode: operationalHealth.mode,
        degradedModeRoute: operationalHealth.degradedMode.route,
        operatorEscalationRoute: operationalHealth.failureState.escalationRoute,
        columns: ['name', 'route', 'owner', 'healthState', 'effectiveStatus', 'effectiveEnabled', 'failureRate', 'failures', 'errorBudgetRemaining', 'declaredState', 'operationalProfile', 'retry', 'degradedModeEligible', 'nextAction', 'operationalError', 'degradedModeCommand'],
        operationalProfileColumns: ['schema', 'declaredState', 'stateSource', 'retry', 'lastFailure', 'degradedMode', 'actions', 'validationIssues'],
        operationalErrorColumns: ['schema', 'code', 'severity', 'subject', 'route', 'owner', 'state', 'effectiveStatus', 'effectiveEnabled', 'failureRate', 'failures', 'lastFailureCode', 'lastFailureAt', 'declaredState', 'validationIssues', 'retryable', 'exhausted', 'nextRetryNotBefore', 'backoffSeconds', 'operatorAction', 'clientAction', 'escalationRoute', 'remediation'],
        degradedModeCommandColumns: ['schema', 'commandId', 'route', 'targetRoute', 'syscall', 'owner', 'state', 'method', 'idempotencyKey', 'body', 'audit'],
        actionableErrorColumns: ['code', 'severity', 'subject', 'route', 'action', 'clientAction', 'retryAfter', 'escalationRoute', 'remediation', 'commandId', 'requestId']
      },
      dispatchContract: {
        version: dispatchManifest.version,
        route: dispatchManifest.route,
        nextAction: dispatchManifest.nextAction,
        columns: ['dispatchId', 'requestId', 'handoffId', 'syscall', 'route', 'tenantId', 'workspaceId', 'priority', 'mode', 'accepted', 'blockedBy', 'dispatchAfter', 'targetRoute', 'kernelHandoffRoute', 'externalProvider', 'routeClientWorkflow', 'payloadEnvelope', 'routeHealth', 'providerContract', 'continuation', 'auditProof'],
        envelopeColumns: ['schema', 'generatedAt', 'idempotencyKey', 'traceparent', 'intent', 'payload', 'syscallMetadata', 'routeWorkflow', 'boundaryProofId', 'boundaryLeaseId', 'boundaryLeaseToken', 'resourceBoundary', 'auditKey', 'providerHandoffToken', 'providerResumeToken'],
        proofColumns: ['proofId', 'generatedAt', 'decision', 'blockedBy', 'auditKey', 'boundaryProofId', 'boundaryLeaseId', 'boundaryLeaseState', 'boundaryLeaseExpiresAt', 'resourceBoundaryState', 'resourceBoundaryIssues', 'deniedResourcePaths', 'routeHealthState', 'providerState', 'replaySafe', 'providerHandoffToken', 'providerGrantState'],
        continuationColumns: ['schema', 'generatedAt', 'continuationId', 'requestId', 'handoffId', 'clientId', 'sessionId', 'state', 'accepted', 'intent', 'workflow', 'nextVisibleStep', 'resumeRoute', 'resumeToken', 'userVisible', 'clientStatePatch', 'proofRefs', 'providerHandoff'],
        externalProviderColumns: ['providerId', 'serviceId', 'handoffRoute', 'ttlSeconds', 'syncState', 'handoffContract'],
        routeWorkflowColumns: ['schema', 'routeKey', 'supportedIntents', 'primaryIntent', 'nextVisibleStep', 'dataContract'],
        clientStatePatchColumns: ['lastSyscallRequestId', 'lastSyscallWorkflow', 'lastSyscallContinuation', 'pendingProofIds', 'routeHealthState', 'providerState'],
        summaryColumns: ['packetCount', 'readyPackets', 'heldPackets', 'hostedKernelDispatches', 'externalProviderDispatches', 'healthHeldPackets', 'providerHeldPackets', 'replaySafePackets', 'continuationCount', 'clientCorrectionContinuations', 'operatorReviewContinuations', 'providerContinuationHandoffs', 'continuationStates']
      },
      routeReadinessContract: {
        version: routeReadiness.version,
        schema: routeReadiness.schema,
        route: routeReadiness.route,
        routeColumns: routeReadiness.clientContract.routeColumns,
        validationColumns: routeReadiness.clientContract.validationColumns,
        routeWorkflowColumns: routeReadiness.clientContract.routeWorkflowColumns,
        intentCardColumns: routeReadiness.clientContract.intentCardColumns,
        nextStepValues: routeReadiness.clientContract.nextStepValues,
        readinessSummaryColumns: ['totalRoutes', 'readyRoutes', 'heldRoutes', 'operatorHeldRoutes', 'providerHeldRoutes', 'healthHeldRoutes', 'configurationHeldRoutes', 'builtinReadyRoutes', 'externalProviderRoutes', 'restartDispatchableRoutes', 'nextSteps'],
        validationSummaryColumns: ['ok', 'issueCount', 'issueCounts', 'topIssue', 'heldRouteNames']
      },
      previewAcceptanceContract: {
        version: previewAcceptance.version,
        schema: previewAcceptance.schema,
        route: previewAcceptance.route,
        readinessState: previewAcceptance.readinessState,
        policyColumns: ['allowClientAccept', 'allowClientDismissHeld', 'requireProofsForAccept', 'requireReplaySafeAccept', 'autoAcceptReadyPreviews', 'maxQueueSize', 'acceptanceRoute', 'dismissalRoute', 'replayRoute'],
        previewColumns: previewAcceptance.clientContract.previewColumns,
        queueColumns: previewAcceptance.clientContract.queueColumns,
        gateColumns: previewAcceptance.clientContract.gateColumns,
        actionColumns: previewAcceptance.clientContract.actionColumns,
        validationSummaryColumns: ['ok', 'issueCount', 'uniqueIssues', 'lifecycleSettingsOk', 'healthSettingsOk', 'policySettingsOk', 'rejectedHandoffs', 'rejectedNegotiations', 'heldDispatchPackets', 'actionableErrors', 'restartReadiness'],
        readinessSummaryColumns: ['totalPreviews', 'acceptedPreviews', 'heldPreviews', 'acceptReadyPreviews', 'dismissableHeldPreviews', 'acceptanceBlockedPreviews', 'queueTruncated', 'sourcePacketCount', 'externalProviderPreviews', 'hostedKernelPreviews', 'proofReadyPreviews', 'replaySafePreviews', 'nextSteps']
      },
      analyticsContract: {
        version: analytics.version,
        route: analytics.exportReady.route,
        reportingState: analytics.reportingState,
        timelineState: analytics.timelineState.state,
        format: analytics.exportReady.format,
        partitionColumns: analytics.exportReady.partitionColumns,
        summaryColumns: analytics.exportReady.summaryColumns,
        counterColumns: analytics.exportReady.counterColumns,
        historyColumns: analytics.exportReady.historyColumns,
        dimensionColumns: analytics.exportReady.dimensionColumns,
        counterLedgerSchema: analytics.counterLedger.schema,
        historySchema: analytics.historyEnvelope.schema,
        retention: analytics.retention
      },
      persistenceCheckpointContract: {
        version: persistence.version,
        schema: persistence.nextCheckpoint.schema,
        checkpointId: persistence.nextCheckpoint.checkpointId,
        parentCheckpointId: persistence.nextCheckpoint.parentCheckpointId,
        restartReadiness: persistence.nextCheckpoint.restartReadiness.state,
        routeColumns: ['key', 'name', 'route', 'owner', 'version', 'status', 'enabled', 'invoked', 'failures', 'lastInvokedAt', 'schedule', 'checkpointRevision', 'restartStatus', 'resumeAction', 'dispatchableAfterRestart', 'scheduleRecovery'],
        commandLedgerColumns: ['commandId', 'idempotencyKey', 'action', 'target', 'result', 'appliedAt', 'auditKey', 'checkpointEffect'],
        recoveryPlanColumns: ['key', 'name', 'restartStatus', 'resumeAction', 'dispatchableAfterRestart', 'scheduleRecovery'],
        summaryColumns: ['routeCount', 'dispatchableRoutes', 'blockedRoutes', 'failedHoldRoutes', 'pausedScheduleRoutes', 'scheduledRoutes', 'dueScheduleRoutes', 'invalidScheduleRoutes', 'appendedLedgerEntries', 'preservedLedgerEntries']
      }
    },
    audit: {
      proofType: 'syscall-registry.analytics-history-export',
      generatedAt: now,
      evidenceCount: evidence.length,
      hasHistory: history.length > 0,
      hasFailures: counters.failures > 0,
      blockedRoutes: counters.blockedRoutes,
      exportRows: exportSummary.rows.length,
      builtinRegistrationProof: {
        schema: builtinRegistration.schema,
        requiredCount: builtinRegistration.summary.requiredCount,
        registeredCount: builtinRegistration.summary.registeredCount,
        missingCount: builtinRegistration.summary.missingCount,
        unscopedCount: builtinRegistration.summary.unscopedCount,
        capabilityGapCount: builtinRegistration.summary.capabilityGapCount,
        metadataGapCount: builtinRegistration.summary.metadataGapCount,
        overrideCount: builtinRegistration.summary.overrideCount,
        ok: builtinRegistration.summary.ok,
        requiredNames: builtinRegistration.requiredNames,
        issueCount: builtinRegistration.issues.length
      },
      lifecycleProof: {
        settingsValid: lifecycle.validation.ok,
        settingsIssueCount: lifecycle.validation.issues.length,
        commandCount: lifecycle.commands.length,
        acceptedCommands: lifecycle.commands.filter((command) => command.accepted).length,
        rejectedCommands: lifecycle.commands.filter((command) => !command.accepted).length,
        routesWithNextActions: lifecycle.routeStates.length,
        autoBlockRecommendations: lifecycle.routeStates.filter((state) => state.autoBlockRecommended).length,
        pausedSchedules: lifecycle.controls.pausedSchedules,
        pausableSchedules: lifecycle.controls.pausableSchedules,
        resumableSchedules: lifecycle.controls.resumableSchedules
      },
      persistenceProof: {
        checkpointId: persistence.checkpoint.checkpointId,
        recoveryMode: persistence.recovery.mode,
        routeSnapshots: persistence.recovery.routeSnapshots,
        recoveredRoutes: persistence.recovery.recoveredRoutes,
        preservedBlockedOrFailedRoutes: persistence.recovery.preservedBlockedOrFailedRoutes,
        preservedDisabledRoutes: persistence.recovery.preservedDisabledRoutes,
        preservedSchedules: persistence.recovery.preservedSchedules,
        commandLedgerEntries: persistence.idempotency.ledgerEntries,
        replayedCommands: persistence.idempotency.replayedCommands,
        duplicateCommands: persistence.idempotency.duplicateCommands,
        restartSafeCommands: persistence.idempotency.restartSafeCommands,
        noopCommands: persistence.idempotency.noopCommands,
        nextCheckpointId: persistence.nextCheckpoint.checkpointId,
        nextCheckpointState: persistence.nextCheckpoint.restartReadiness.state,
        nextCheckpointRoutes: persistence.nextCheckpoint.restartReadiness.routeCount,
        nextCheckpointDispatchableRoutes: persistence.nextCheckpoint.restartReadiness.dispatchableRoutes,
        nextCheckpointFailedHoldRoutes: persistence.nextCheckpoint.restartReadiness.failedHoldRoutes,
        nextCheckpointPausedScheduleRoutes: persistence.nextCheckpoint.restartReadiness.pausedScheduleRoutes,
        nextCheckpointDueScheduleRoutes: persistence.nextCheckpoint.restartReadiness.dueScheduleRoutes,
        nextCheckpointInvalidScheduleRoutes: persistence.nextCheckpoint.restartReadiness.invalidScheduleRoutes,
        nextCheckpointAppendedLedgerEntries: persistence.nextCheckpoint.restartReadiness.appendedLedgerEntries,
        nextCheckpointPreservedLedgerEntries: persistence.nextCheckpoint.restartReadiness.preservedLedgerEntries
      },
      clientRuntimeProof: {
        contractVersion: clientRuntime.version,
        clientId: clientRuntime.state.clientId,
        sessionId: clientRuntime.state.sessionId,
        requestCount: clientRuntime.summary.requestCount,
        acceptedHandoffs: clientRuntime.summary.acceptedHandoffs,
        rejectedHandoffs: clientRuntime.summary.rejectedHandoffs,
        urgentHandoffs: clientRuntime.summary.urgentHandoffs,
        boundaryRejections: clientRuntime.summary.boundaryRejections,
        boundaryProofs: clientRuntime.summary.boundaryProofs,
        allowedBoundaryProofs: clientRuntime.summary.allowedBoundaryProofs,
        deniedBoundaryProofs: clientRuntime.summary.deniedBoundaryProofs,
        boundaryLeases: clientRuntime.summary.boundaryLeases,
        issuedBoundaryLeases: clientRuntime.summary.issuedBoundaryLeases,
        deniedBoundaryLeases: clientRuntime.summary.deniedBoundaryLeases,
        requiredBoundaryLeases: clientRuntime.summary.requiredBoundaryLeases,
        auditHandoffs: clientRuntime.summary.auditHandoffs,
        tenantWorkspaceBindingRejections: clientRuntime.summary.tenantWorkspaceBindingRejections,
        scopedRoleRejections: clientRuntime.summary.scopedRoleRejections,
        resourceBoundaryRejections: clientRuntime.summary.resourceBoundaryRejections,
        deniedResourcePaths: clientRuntime.summary.deniedResourcePaths,
        payloadTenantScopeRejections: clientRuntime.summary.payloadTenantScopeRejections,
        payloadWorkspaceScopeRejections: clientRuntime.summary.payloadWorkspaceScopeRejections,
        routeLookupRejections: clientRuntime.summary.routeLookupRejections,
        unresolvedRouteLookups: clientRuntime.summary.unresolvedRouteLookups,
        ambiguousRouteLookups: clientRuntime.summary.ambiguousRouteLookups,
        unsupportedWorkflowIntents: clientRuntime.summary.unsupportedWorkflowIntents,
        routeWorkflowContracts: clientRuntime.summary.routeWorkflowContracts,
        duplicateRouteIdentityIssues: clientRuntime.summary.duplicateRouteIdentityIssues,
        tenantWorkspaceBindings: clientRuntime.summary.tenantWorkspaceBindings,
        workflowCount: Object.keys(clientRuntime.summary.workflows).length,
        handoffRoute: clientRuntime.state.handoffRoute,
        boundaryAuditRoute: clientRuntime.state.boundaryPolicy.auditRoute,
        deniedHandoffRoute: clientRuntime.state.boundaryPolicy.deniedHandoffRoute,
        boundaryMode: clientRuntime.state.boundaryPolicy.mode,
        tenantIsolationEnforced: clientRuntime.state.boundaryPolicy.enforceTenantIsolation,
        workspaceIsolationEnforced: clientRuntime.state.boundaryPolicy.enforceWorkspaceIsolation,
        tenantWorkspaceBindingEnforced: clientRuntime.state.boundaryPolicy.enforceTenantWorkspaceBinding,
        workspaceRoot: clientRuntime.state.boundaryPolicy.workspaceRoot,
        allowAbsoluteWorkspacePaths: clientRuntime.state.boundaryPolicy.allowAbsoluteWorkspacePaths,
        requireResourceScopeForPathAccess: clientRuntime.state.boundaryPolicy.requireResourceScopeForPathAccess,
        tenantId: clientRuntime.state.tenantId,
        workspaceId: clientRuntime.state.workspaceId,
        roleCount: clientRuntime.state.roles.length
      },
      providerContractProof: {
        contractVersion: providerContracts.version,
        providerCount: providerContracts.summary.providerCount,
        kernelId: providerContracts.kernelRuntime.kernelId,
        kernelCapabilityCount: providerContracts.kernelRuntime.capabilities.provided.length,
        kernelDeniedCapabilityCount: providerContracts.kernelRuntime.capabilities.denied.length,
        requireFreshSyncForExternalHandoff: providerContracts.kernelRuntime.externalHandoffPolicy.requireFreshSync,
        boundRoutes: providerContracts.summary.boundRoutes,
        acceptedNegotiations: providerContracts.summary.acceptedNegotiations,
        rejectedNegotiations: providerContracts.summary.rejectedNegotiations,
        externalHandoffsReady: providerContracts.summary.externalHandoffsReady,
        externalHandoffsBlockedByProvider: providerContracts.summary.externalHandoffsBlockedByProvider,
        externalHandoffContracts: providerContracts.summary.externalHandoffContracts,
        grantedProviderRoutes: providerContracts.summary.grantedProviderRoutes,
        syncFencedProviderRoutes: providerContracts.summary.syncFencedProviderRoutes,
        syncReadyProviders: providerContracts.summary.syncReadyProviders,
        staleSyncProviders: providerContracts.summary.staleSyncProviders,
        missingKernelCapabilityRoutes: providerContracts.summary.missingKernelCapabilityRoutes,
        blockedProviderRoutes: providerContracts.negotiations.filter((negotiation) => (
          negotiation.issues.includes('provider-offline')
          || negotiation.issues.includes('provider-blocked')
          || negotiation.issues.includes('capability-negotiation-failed')
          || negotiation.issues.includes('kernel-capability-negotiation-failed')
          || negotiation.issues.includes('provider-sync-stale')
        )).length
      },
      operationalHealthProof: {
        contractVersion: operationalHealth.version,
        mode: operationalHealth.mode,
        validationOk: operationalHealth.validation.ok,
        validationIssueCount: operationalHealth.validation.issues.length,
        healthyRoutes: operationalHealth.summary.healthyRoutes,
        degradedRoutes: operationalHealth.summary.degradedRoutes,
        failedRoutes: operationalHealth.summary.failedRoutes,
        disabledRoutes: operationalHealth.summary.disabledRoutes,
        retryableRoutes: operationalHealth.summary.retryableRoutes,
        declaredDegradedRoutes: operationalHealth.summary.declaredDegradedRoutes,
        declaredFailureRoutes: operationalHealth.summary.declaredFailureRoutes,
        operationalProfileIssueRoutes: operationalHealth.summary.operationalProfileIssueRoutes,
        actionableErrorCount: operationalHealth.summary.actionableErrorCount,
        highestSeverity: operationalHealth.summary.highestSeverity,
        degradedModeEnabled: operationalHealth.degradedMode.enabled,
        failureStateActive: operationalHealth.failureState.active,
        blockedDispatches: operationalHealth.failureState.blockedDispatches
      },
      dispatchProof: {
        contractVersion: dispatchManifest.version,
        route: dispatchManifest.route,
        nextAction: dispatchManifest.nextAction,
        packetCount: dispatchManifest.summary.packetCount,
        readyPackets: dispatchManifest.summary.readyPackets,
        heldPackets: dispatchManifest.summary.heldPackets,
        hostedKernelDispatches: dispatchManifest.summary.hostedKernelDispatches,
        externalProviderDispatches: dispatchManifest.summary.externalProviderDispatches,
        healthHeldPackets: dispatchManifest.summary.healthHeldPackets,
        providerHeldPackets: dispatchManifest.summary.providerHeldPackets,
        replaySafePackets: dispatchManifest.summary.replaySafePackets,
        proofCount: dispatchManifest.proofs.length,
        continuationCount: dispatchManifest.summary.continuationCount,
        clientCorrectionContinuations: dispatchManifest.summary.clientCorrectionContinuations,
        operatorReviewContinuations: dispatchManifest.summary.operatorReviewContinuations,
        providerContinuationHandoffs: dispatchManifest.summary.providerContinuationHandoffs,
        continuationStateCount: Object.keys(dispatchManifest.summary.continuationStates).length
      },
      routeReadinessProof: {
        contractVersion: routeReadiness.version,
        schema: routeReadiness.schema,
        route: routeReadiness.route,
        totalRoutes: routeReadiness.readinessSummary.totalRoutes,
        readyRoutes: routeReadiness.readinessSummary.readyRoutes,
        heldRoutes: routeReadiness.readinessSummary.heldRoutes,
        operatorHeldRoutes: routeReadiness.readinessSummary.operatorHeldRoutes,
        providerHeldRoutes: routeReadiness.readinessSummary.providerHeldRoutes,
        healthHeldRoutes: routeReadiness.readinessSummary.healthHeldRoutes,
        configurationHeldRoutes: routeReadiness.readinessSummary.configurationHeldRoutes,
        builtinReadyRoutes: routeReadiness.readinessSummary.builtinReadyRoutes,
        restartDispatchableRoutes: routeReadiness.readinessSummary.restartDispatchableRoutes,
        validationOk: routeReadiness.validationSummary.ok,
        validationIssueCount: routeReadiness.validationSummary.issueCount,
        topIssue: routeReadiness.validationSummary.topIssue,
        nextStepCount: routeReadiness.readinessSummary.nextSteps.length
      },
      previewAcceptanceProof: {
        contractVersion: previewAcceptance.version,
        schema: previewAcceptance.schema,
        route: previewAcceptance.route,
        readinessState: previewAcceptance.readinessState,
        policyAllowsClientAccept: previewAcceptance.policy.allowClientAccept,
        policyRequiresProofs: previewAcceptance.policy.requireProofsForAccept,
        policyRequiresReplaySafeAccept: previewAcceptance.policy.requireReplaySafeAccept,
        maxQueueSize: previewAcceptance.policy.maxQueueSize,
        totalPreviews: previewAcceptance.readinessSummary.totalPreviews,
        acceptedPreviews: previewAcceptance.readinessSummary.acceptedPreviews,
        heldPreviews: previewAcceptance.readinessSummary.heldPreviews,
        acceptReadyPreviews: previewAcceptance.readinessSummary.acceptReadyPreviews,
        dismissableHeldPreviews: previewAcceptance.readinessSummary.dismissableHeldPreviews,
        acceptanceBlockedPreviews: previewAcceptance.readinessSummary.acceptanceBlockedPreviews,
        queueTruncated: previewAcceptance.readinessSummary.queueTruncated,
        proofReadyPreviews: previewAcceptance.readinessSummary.proofReadyPreviews,
        replaySafePreviews: previewAcceptance.readinessSummary.replaySafePreviews,
        validationOk: previewAcceptance.validationSummary.ok,
        validationIssueCount: previewAcceptance.validationSummary.issueCount,
        uniqueValidationIssues: previewAcceptance.validationSummary.uniqueIssues.length,
        nextStepCount: previewAcceptance.readinessSummary.nextSteps.length,
        acceptanceQueueDepth: previewAcceptance.acceptanceQueue.length
      },
      analyticsProof: {
        contractVersion: analytics.version,
        reportingState: analytics.reportingState,
        snapshotId: analytics.currentSnapshot.snapshotId,
        historyWindow: analytics.retention.historyWindow,
        baseline: analytics.deltas.baseline,
        trend: analytics.deltas.trend,
        invocationDelta: analytics.deltas.invocationDelta,
        failureDelta: analytics.deltas.failureDelta,
        failureRateDelta: analytics.deltas.failureRateDelta,
        partitionCount: analytics.exportReady.partitionCount,
        dimensionRowCount: analytics.exportReady.dimensionRowCount,
        counterCount: analytics.counterLedger.summary.counterCount,
        criticalCounters: analytics.counterLedger.summary.criticalCounters,
        errorCounters: analytics.counterLedger.summary.errorCounters,
        warningCounters: analytics.counterLedger.summary.warningCounters,
        exportableCounters: analytics.counterLedger.summary.exportableCounters,
        timelineState: analytics.timelineState.state,
        timelineEventCount: analytics.timelineState.eventCount,
        retainedWithCurrentSnapshot: analytics.retention.retainedWithCurrentSnapshot,
        rollingWindowMaxFailureRate: analytics.historyEnvelope.rollingWindow.maxFailureRate,
        rollingWindowLastThreeFailureRateAverage: analytics.historyEnvelope.rollingWindow.lastThreeFailureRateAverage,
        domainDimensionCount: Object.keys(analytics.currentSnapshot.dimensions.byDomain).length,
        providerDimensionCount: Object.keys(analytics.currentSnapshot.dimensions.byProvider).length,
        statusDimensionCount: Object.keys(analytics.currentSnapshot.dimensions.byStatus).length,
        tenantCount: analytics.currentSnapshot.counters.tenantCount,
        workspaceCount: analytics.currentSnapshot.counters.workspaceCount,
        enabledRoutes: analytics.currentSnapshot.counters.enabledRoutes,
        scheduledRoutes: analytics.currentSnapshot.counters.scheduledRoutes
      }
    },
    evidence
  };
}

export default describeSyscallRegistrySurface;
