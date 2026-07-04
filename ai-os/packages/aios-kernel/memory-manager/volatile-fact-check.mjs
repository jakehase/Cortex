export const surfaceId = "aios_memory-manager_volatile-fact-check_043";
export const surfaceGroup = "memory-manager";
export const surfaceName = "volatile-fact-check";

const READ_ROLES = new Set(['owner', 'admin', 'editor', 'auditor', 'memory.factCheck.read']);
const WRITE_ROLES = new Set(['owner', 'admin', 'editor', 'memory.factCheck.write']);
const AUDIT_ROLES = new Set(['owner', 'admin', 'auditor', 'memory.audit.handoff']);
const HEALTH_DEPENDENCIES = ['volatileStore', 'evidenceIndex', 'auditSink'];
const PERSISTED_STATE_SCHEMA = 'volatile-fact-check.state.v1';
const MUTATION_ACTIONS = new Set(['assert', 'correct', 'invalidate']);
const LIFECYCLE_COMMAND_ACTIONS = new Set(['enable', 'disable', 'pause', 'resume', 'configure_schedule']);
const LIFECYCLE_STATUSES = new Set(['enabled', 'disabled', 'paused']);
const TERMINAL_COMMAND_STATUSES = new Set(['committed', 'replayed', 'denied', 'superseded']);
const ACTIVE_LIFECYCLE_COMMAND_STATUSES = new Set(['pending', 'accepted', 'dispatching', 'applying']);
const RECOVERABLE_FACT_STATUSES = new Set(['pending', 'recovering', 'commit_started']);
const DEPENDENCY_STALE_AFTER_MS = 120000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const MIN_SCHEDULE_INTERVAL_MS = 60000;
const MAX_SCHEDULE_INTERVAL_MS = 86400000;
const PROVIDER_CONTRACT_SCHEMA = 'volatile-fact-check.provider-service-contract.v1';
const SUPPORTED_PROVIDER_CAPABILITIES = [
  'volatile_fact.read',
  'volatile_fact.mutate',
  'volatile_fact.lifecycle_control',
  'volatile_fact.audit_handoff',
  'volatile_fact.export_summary',
  'volatile_fact.sync_cursor'
];
const CLIENT_WORKFLOW_ROUTES = {
  review: 'memory/volatile-facts/review',
  repair: 'memory/volatile-facts/repair',
  dependencyWait: 'memory/volatile-facts/dependency-wait',
  accept: 'memory/volatile-facts/accept',
  lifecycle: 'memory/volatile-facts/lifecycle',
  scheduledRun: 'memory/volatile-facts/scheduled-run'
};
const CLIENT_CONTINUATION_STATES = new Set(['draft', 'previewed', 'submitted', 'acknowledged', 'abandoned']);
const PRODUCT_WORKFLOW_PROVIDERS = new Set(['mailchimp', 'hosted-kernel', 'external']);
const PRODUCT_WORKFLOW_STAGES = new Set(['draft', 'preview', 'approval', 'sync', 'sent', 'archived']);
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2000
};
const MAX_EXTERNAL_HANDOFF_ATTEMPTS = 5;
const CURRENT_PROVIDER_CONTRACT_VERSION = '1.0';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueTextList(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(asText).filter(Boolean))];
}

function normalizeProductWorkflowRuntimeContext(input = {}, runtime = {}, request = {}) {
  const source = input.productWorkflow && typeof input.productWorkflow === 'object'
    ? input.productWorkflow
    : input.mailchimp && typeof input.mailchimp === 'object'
      ? input.mailchimp
      : runtime.productWorkflow && typeof runtime.productWorkflow === 'object'
        ? runtime.productWorkflow
        : request.productWorkflow && typeof request.productWorkflow === 'object'
          ? request.productWorkflow
          : {};
  const provider = PRODUCT_WORKFLOW_PROVIDERS.has(asText(source.provider))
    ? asText(source.provider)
    : asText(source.campaignId || source.audienceId || source.segmentId)
      ? 'mailchimp'
      : 'hosted-kernel';
  const stage = PRODUCT_WORKFLOW_STAGES.has(asText(source.stage))
    ? asText(source.stage)
    : asText(source.sentAt)
      ? 'sent'
      : source.approvalRequired === true
        ? 'approval'
        : 'preview';
  const campaignId = asText(source.campaignId || source.campaign?.id) || null;
  const audienceId = asText(source.audienceId || source.listId || source.audience?.id) || null;
  const segmentId = asText(source.segmentId || source.segment?.id) || null;
  const workflowId = asText(source.workflowId || source.journeyId || source.automationId)
    || (campaignId ? `mailchimp:${campaignId}` : null);
  const sentAt = asText(source.sentAt) || null;
  const updatedAt = asText(source.updatedAt) || null;
  const validation = [
    provider === 'mailchimp' && !campaignId ? 'mailchimp.campaignId.required_for_fact_check_handoff' : null,
    provider === 'mailchimp' && !audienceId ? 'mailchimp.audienceId.required_for_volatile_fact_scope' : null,
    sentAt && parseTimestampMs(sentAt) === null ? 'mailchimp.sentAt.invalid_timestamp' : null,
    updatedAt && parseTimestampMs(updatedAt) === null ? 'mailchimp.updatedAt.invalid_timestamp' : null
  ].filter(Boolean);
  const stateKey = [
    provider,
    workflowId || 'no-workflow',
    campaignId || 'no-campaign',
    audienceId || 'no-audience',
    segmentId || 'no-segment'
  ].join(':');

  return {
    schemaVersion: 'volatile-fact-check.product-workflow-context.v1',
    provider,
    stage,
    workflowId,
    campaignId,
    audienceId,
    segmentId,
    externalReference: asText(source.externalReference || source.externalId || source.url || source.webId) || null,
    requestedTags: uniqueTextList(source.tags || source.mergeTags || source.interests),
    approvalRequired: source.approvalRequired === true || stage === 'approval',
    sentAt,
    updatedAt,
    stateKey,
    validation,
    valid: validation.length === 0,
    proofDigest: buildProofDigest([surfaceId, provider, workflowId || '', campaignId || '', audienceId || '', segmentId || '', stage, ...validation])
  };
}

function buildMailchimpFactHandoffBoundary({ now, scope, principal, boundary, health, command, evidenceProof, clientRuntime }) {
  const productWorkflow = clientRuntime.productWorkflow;
  const applies = productWorkflow.provider === 'mailchimp';
  const missingIdentifiers = applies
    ? [
      ...(!productWorkflow.campaignId ? ['campaignId'] : []),
      ...(!productWorkflow.audienceId ? ['audienceId'] : [])
    ]
    : [];
  const scopeAligned = applies
    ? Boolean(scope.tenantId && scope.workspaceId && boundary.allowed)
    : true;
  const auditWritable = boundary.permissions.canAudit && !health.dependencySummary.requiredDown.includes('auditSink');
  const mutationSafe = health.allowMutation && command.mutation !== null;
  const blockedReasons = [
    ...missingIdentifiers.map((field) => `mailchimp.${field}.required`),
    ...(!scopeAligned ? ['tenant_workspace_boundary_not_clear'] : []),
    ...(applies && !boundary.permissions.canRead ? ['principal_lacks_fact_read_permission'] : []),
    ...(applies && command.mutation && !boundary.permissions.canWrite ? ['principal_lacks_fact_write_permission'] : []),
    ...(applies && inputRequiresAudit(command.action) && !auditWritable ? ['audit_handoff_not_writable'] : []),
    ...(applies && command.mutation && !health.allowMutation ? ['volatile_fact_mutation_blocked_by_health'] : [])
  ];
  const handoffStatus = !applies
    ? 'not_applicable'
    : blockedReasons.length > 0
      ? 'blocked'
      : mutationSafe
        ? 'ready_to_commit'
        : 'read_only_review';

  return {
    format: 'volatile-fact-check.mailchimp-fact-handoff-boundary.v1',
    generatedAt: now,
    applies,
    handoffStatus,
    provider: productWorkflow.provider,
    stage: productWorkflow.stage,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    memoryNamespace: scope.memoryNamespace,
    factId: scope.factId || null,
    campaignId: productWorkflow.campaignId,
    audienceId: productWorkflow.audienceId,
    segmentId: productWorkflow.segmentId,
    workflowId: productWorkflow.workflowId,
    stateKey: productWorkflow.stateKey,
    scopeAligned,
    auditWritable,
    mutationSafe,
    blockedReasons,
    permissionSnapshot: {
      principalId: principal.id,
      roles: boundary.permissionProof.effectiveRoles,
      matchingGrantIds: boundary.permissionProof.matchingGrantIds,
      workspaceAccess: boundary.permissionProof.workspaceAccess,
      workspaceBindingId: boundary.workspaceScopeProof.activeBindingId
    },
    auditHandoff: {
      required: applies && inputRequiresAudit(command.action),
      destination: 'memory-manager/volatile-fact-check/mailchimp-audit',
      idempotencyKey: applies
        ? `${scope.tenantId}:${scope.workspaceId}:${productWorkflow.stateKey}:${command.commandId}`
        : null,
      evidenceProofDigest: evidenceProof.proofDigest,
      safeToAppend: applies && auditWritable && blockedReasons.length === 0
    },
    restartKey: applies
      ? buildProofDigest([
        scope.tenantId || '',
        scope.workspaceId || '',
        scope.memoryNamespace,
        productWorkflow.stateKey,
        command.idempotencyKey
      ])
      : null,
    proofDigest: buildProofDigest([
      surfaceId,
      applies ? 'mailchimp' : 'not-mailchimp',
      handoffStatus,
      scope.tenantId || '',
      scope.workspaceId || '',
      productWorkflow.stateKey,
      ...blockedReasons
    ])
  };
}

function finiteNonNegativeNumber(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finitePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseTimestampMs(value) {
  const timestamp = Date.parse(asText(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeDependencyHealth(input) {
  const rawHealth = input.health && typeof input.health === 'object' ? input.health : {};
  const rawDependencies = rawHealth.dependencies && typeof rawHealth.dependencies === 'object'
    ? rawHealth.dependencies
    : input.dependencies && typeof input.dependencies === 'object'
      ? input.dependencies
      : {};

  return HEALTH_DEPENDENCIES.map((name) => {
    const source = rawDependencies[name] && typeof rawDependencies[name] === 'object' ? rawDependencies[name] : {};
    const status = ['ok', 'degraded', 'down', 'unknown'].includes(source.status) ? source.status : 'unknown';
    const latencyMs = finiteNonNegativeNumber(source.latencyMs, null);
    const consecutiveFailures = finiteNonNegativeNumber(source.consecutiveFailures, 0);
    const lastError = asText(source.lastError);
    const checkedAt = asText(source.checkedAt) || asText(source.observedAt) || null;
    const lastAttemptAt = asText(source.lastAttemptAt) || asText(source.lastProbeAt) || null;
    const nextRetryAt = asText(source.nextRetryAt) || asText(source.retryAfterAt) || null;
    const retryAfterMs = finiteNonNegativeNumber(source.retryAfterMs, 0);
    return {
      name,
      status,
      latencyMs,
      consecutiveFailures,
      lastError: lastError || null,
      checkedAt,
      lastAttemptAt,
      nextRetryAt,
      retryAfterMs,
      retryable: source.retryable === false ? false : status !== 'ok',
      required: name !== 'auditSink' || inputRequiresAudit(asText(input.action) || 'read')
    };
  });
}

function buildDependencyRuntimeHealth({ dependencies, now }) {
  const nowMs = parseTimestampMs(now);

  return dependencies.map((dependency) => {
    const checkedAtMs = parseTimestampMs(dependency.checkedAt);
    const lastAttemptAtMs = parseTimestampMs(dependency.lastAttemptAt) ?? checkedAtMs;
    const nextRetryAtMs = parseTimestampMs(dependency.nextRetryAt);
    const observedAgeMs = nowMs !== null && checkedAtMs !== null && nowMs >= checkedAtMs
      ? nowMs - checkedAtMs
      : null;
    const computedBackoffUntilMs = nextRetryAtMs !== null
      ? nextRetryAtMs
      : lastAttemptAtMs !== null && dependency.retryAfterMs > 0
        ? lastAttemptAtMs + dependency.retryAfterMs
        : null;
    const backoffRemainingMs = nowMs !== null && computedBackoffUntilMs !== null && computedBackoffUntilMs > nowMs
      ? computedBackoffUntilMs - nowMs
      : 0;
    const retryWindowState = !dependency.required || !dependency.retryable
      ? 'not_retryable'
      : backoffRemainingMs > 0
        ? 'backoff_active'
        : 'retry_due';
    const observationStale = dependency.required
      && dependency.status === 'ok'
      && (checkedAtMs === null || observedAgeMs > DEPENDENCY_STALE_AFTER_MS);
    const circuitOpen = dependency.required
      && dependency.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD
      && dependency.status !== 'ok';
    const effectiveStatus = circuitOpen
      ? 'down'
      : observationStale
        ? 'degraded'
        : dependency.status;
    const failureState = circuitOpen
      ? 'circuit_open'
      : observationStale
        ? 'stale_observation'
        : dependency.status === 'ok'
          ? 'ready'
          : 'reported_unhealthy';

    return {
      ...dependency,
      observedAgeMs,
      observationStale,
      staleAfterMs: DEPENDENCY_STALE_AFTER_MS,
      lastAttemptAtMs,
      nextRetryAtMs,
      backoffUntilMs: computedBackoffUntilMs,
      backoffRemainingMs,
      retryWindowState,
      circuitOpen,
      effectiveStatus,
      failureState,
      retryable: dependency.retryable || observationStale || circuitOpen
    };
  });
}

function normalizePrincipal(input) {
  const principal = input.principal && typeof input.principal === 'object' ? input.principal : {};
  return {
    id: asText(principal.id) || asText(input.principalId) || 'anonymous',
    tenantId: asText(principal.tenantId) || asText(input.tenantId),
    workspaceIds: uniqueTextList(principal.workspaceIds || input.workspaceIds),
    roles: uniqueTextList(principal.roles || input.roles),
    delegatedBy: asText(principal.delegatedBy)
  };
}

function normalizeFactScope(input) {
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : {};
  return {
    tenantId: asText(scope.tenantId) || asText(input.tenantId),
    workspaceId: asText(scope.workspaceId) || asText(input.workspaceId),
    memoryNamespace: asText(scope.memoryNamespace) || asText(input.memoryNamespace) || 'volatile',
    factId: asText(scope.factId) || asText(input.factId),
    sourceSurface: asText(scope.sourceSurface) || asText(input.sourceSurface) || surfaceId
  };
}

function buildScopeKey(scope) {
  return [scope.tenantId, scope.workspaceId, scope.memoryNamespace, scope.factId || 'unbound'].filter(Boolean).join(':');
}

function normalizeWorkspaceBindings(input) {
  const source = Array.isArray(input.workspaceBindings)
    ? input.workspaceBindings
    : Array.isArray(input.tenantWorkspaces)
      ? input.tenantWorkspaces
      : input.workspaceRegistry && Array.isArray(input.workspaceRegistry.bindings)
        ? input.workspaceRegistry.bindings
        : [];

  return source.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const status = ['active', 'suspended', 'archived', 'deleted'].includes(asText(item.status))
      ? asText(item.status)
      : item.disabled === true
        ? 'suspended'
        : 'active';
    return {
      bindingId: asText(item.bindingId) || asText(item.id) || `workspace-binding-${index + 1}`,
      tenantId: asText(item.tenantId),
      workspaceId: asText(item.workspaceId),
      memoryNamespaces: uniqueTextList(item.memoryNamespaces || item.namespaces || ['volatile']),
      status,
      isolated: item.isolated === false ? false : true,
      ownerSurface: asText(item.ownerSurface) || asText(item.sourceSurface) || 'workspace-registry',
      expiresAt: asText(item.expiresAt) || null,
      suspendedReason: asText(item.suspendedReason || item.reason) || null
    };
  }).filter((binding) => binding.tenantId && binding.workspaceId);
}

function roleSetIncludesAny(roles, allowed) {
  return roles.some((role) => allowed.has(role));
}

function normalizeScopedPermissionGrants(input) {
  const grantSource = Array.isArray(input.permissionGrants)
    ? input.permissionGrants
    : input.principal && Array.isArray(input.principal.permissionGrants)
      ? input.principal.permissionGrants
      : [];

  return grantSource.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
      grantId: asText(item.grantId) || asText(item.id) || `grant-${index + 1}`,
      tenantId: asText(item.tenantId),
      workspaceId: asText(item.workspaceId),
      memoryNamespace: asText(item.memoryNamespace) || 'volatile',
      roles: uniqueTextList(item.roles),
      actions: uniqueTextList(item.actions),
      expiresAt: asText(item.expiresAt) || null,
      delegatedBy: asText(item.delegatedBy)
    };
  }).filter((grant) => grant.tenantId && grant.workspaceId && grant.roles.length > 0);
}

function grantIsExpired(grant, now) {
  if (!grant.expiresAt) return false;
  const expiryMs = Date.parse(grant.expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiryMs) && Number.isFinite(nowMs) ? expiryMs <= nowMs : true;
}

function buildWorkspaceScopeProof({ input, principal, scope, now }) {
  const bindings = normalizeWorkspaceBindings(input);
  const ignoredBindings = [];
  const matchingBindings = [];

  for (const binding of bindings) {
    if (binding.tenantId !== scope.tenantId) {
      ignoredBindings.push({ bindingId: binding.bindingId, reason: 'tenant_mismatch' });
      continue;
    }
    if (binding.workspaceId !== scope.workspaceId) {
      ignoredBindings.push({ bindingId: binding.bindingId, reason: 'workspace_mismatch' });
      continue;
    }
    if (!binding.memoryNamespaces.includes(scope.memoryNamespace) && !binding.memoryNamespaces.includes('*')) {
      ignoredBindings.push({ bindingId: binding.bindingId, reason: 'namespace_mismatch' });
      continue;
    }
    if (binding.expiresAt && grantIsExpired(binding, now)) {
      ignoredBindings.push({ bindingId: binding.bindingId, reason: 'expired' });
      continue;
    }
    matchingBindings.push(binding);
  }

  const activeBindings = matchingBindings.filter((binding) => binding.status === 'active' && binding.isolated);
  const blockedBindings = matchingBindings.filter((binding) => binding.status !== 'active' || !binding.isolated);
  const registryRequired = input.requireWorkspaceBinding === true || bindings.length > 0;
  const principalWorkspaceMember = principal.workspaceIds.includes(scope.workspaceId);
  const activeBinding = activeBindings[0] || null;
  const bindingMode = activeBinding
    ? 'active_registry_binding'
    : registryRequired
      ? 'registry_binding_missing_or_inactive'
      : principalWorkspaceMember
        ? 'principal_membership_only'
        : 'unbound';

  return {
    schemaVersion: 'volatile-fact-check.workspace-scope-proof.v1',
    generatedAt: now,
    registryRequired,
    bindingMode,
    active: Boolean(activeBinding),
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    memoryNamespace: scope.memoryNamespace,
    principalWorkspaceMember,
    activeBindingId: activeBinding ? activeBinding.bindingId : null,
    activeOwnerSurface: activeBinding ? activeBinding.ownerSurface : null,
    matchingBindingIds: matchingBindings.map((binding) => binding.bindingId),
    blockedBindings: blockedBindings.map((binding) => ({
      bindingId: binding.bindingId,
      status: binding.status,
      isolated: binding.isolated,
      reason: binding.status !== 'active'
        ? `workspace binding is ${binding.status}`
        : 'workspace binding is not tenant isolated',
      suspendedReason: binding.suspendedReason
    })),
    ignoredBindings,
    proofDigest: buildProofDigest([
      scope.tenantId || 'no-tenant',
      scope.workspaceId || 'no-workspace',
      scope.memoryNamespace,
      principal.id,
      activeBinding ? activeBinding.bindingId : bindingMode,
      ...blockedBindings.map((binding) => `${binding.bindingId}:${binding.status}:${binding.isolated}`)
    ])
  };
}

function buildPermissionProof({ principal, scope, action, permissionGrants, now }) {
  const ignoredGrants = [];
  const matchingGrants = [];

  for (const grant of permissionGrants) {
    if (grant.tenantId !== scope.tenantId) {
      ignoredGrants.push({ grantId: grant.grantId, reason: 'tenant_mismatch' });
      continue;
    }
    if (grant.workspaceId !== scope.workspaceId) {
      ignoredGrants.push({ grantId: grant.grantId, reason: 'workspace_mismatch' });
      continue;
    }
    if (grant.memoryNamespace !== scope.memoryNamespace) {
      ignoredGrants.push({ grantId: grant.grantId, reason: 'namespace_mismatch' });
      continue;
    }
    if (grantIsExpired(grant, now)) {
      ignoredGrants.push({ grantId: grant.grantId, reason: 'expired' });
      continue;
    }
    if (grant.actions.length > 0 && !grant.actions.includes(action) && !grant.actions.includes('*')) {
      ignoredGrants.push({ grantId: grant.grantId, reason: 'action_mismatch' });
      continue;
    }
    matchingGrants.push(grant);
  }

  const scopedRoles = uniqueTextList(matchingGrants.flatMap((grant) => grant.roles));
  const effectiveRoles = uniqueTextList([...principal.roles, ...scopedRoles]);
  const workspaceAccess = principal.workspaceIds.includes(scope.workspaceId)
    ? 'principal_workspace_membership'
    : matchingGrants.length > 0
      ? 'scoped_permission_grant'
      : 'none';

  return {
    action,
    workspaceAccess,
    directRoles: principal.roles,
    scopedRoles,
    effectiveRoles,
    matchingGrantIds: matchingGrants.map((grant) => grant.grantId),
    ignoredGrants,
    delegatedGrantActors: uniqueTextList(matchingGrants.map((grant) => grant.delegatedBy)),
    tenantIsolated: Boolean(principal.tenantId && scope.tenantId && principal.tenantId === scope.tenantId)
  };
}

function evaluateBoundary(principal, scope, requestedAction, options = {}) {
  const action = asText(requestedAction) || 'read';
  const permissionProof = buildPermissionProof({
    principal,
    scope,
    action,
    permissionGrants: normalizeScopedPermissionGrants(options.input || {}),
    now: options.now
  });
  const workspaceScopeProof = buildWorkspaceScopeProof({
    input: options.input || {},
    principal,
    scope,
    now: options.now
  });
  const failures = [];
  const warnings = [];

  if (!scope.tenantId) failures.push('scope.tenantId is required for volatile fact checks');
  if (!scope.workspaceId) failures.push('scope.workspaceId is required for volatile fact checks');
  if (!principal.tenantId) failures.push('principal.tenantId is required');
  if (principal.tenantId && scope.tenantId && principal.tenantId !== scope.tenantId) {
    failures.push('principal tenant does not match requested fact scope tenant');
  }
  if (scope.workspaceId && permissionProof.workspaceAccess === 'none') {
    failures.push('principal is not assigned to requested workspace');
  }
  if (workspaceScopeProof.registryRequired && !workspaceScopeProof.active) {
    failures.push('requested workspace does not have an active tenant workspace binding');
  }
  for (const binding of workspaceScopeProof.blockedBindings) {
    failures.push(`workspace binding ${binding.bindingId} is not usable: ${binding.reason}`);
  }
  if (scope.memoryNamespace !== 'volatile') {
    failures.push('volatile fact check cannot inspect non-volatile memory namespace');
  }

  const canRead = roleSetIncludesAny(permissionProof.effectiveRoles, READ_ROLES);
  const canWrite = roleSetIncludesAny(permissionProof.effectiveRoles, WRITE_ROLES);
  const canAudit = roleSetIncludesAny(permissionProof.effectiveRoles, AUDIT_ROLES);

  if (!canRead) failures.push('principal lacks volatile fact read permission');
  if ((MUTATION_ACTIONS.has(action) || LIFECYCLE_COMMAND_ACTIONS.has(action)) && !canWrite) {
    failures.push(`principal lacks volatile fact ${action} permission`);
  }
  if (inputRequiresAudit(action) && !canAudit) {
    warnings.push('audit handoff will be read-only because principal lacks audit handoff role');
  }

  return {
    action,
    allowed: failures.length === 0,
    failures,
    warnings,
    permissions: {
      canRead,
      canWrite,
      canAudit
    },
    permissionProof,
    workspaceScopeProof
  };
}

function inputRequiresAudit(action) {
  return ['assert', 'correct', 'invalidate', 'handoff', ...LIFECYCLE_COMMAND_ACTIONS].includes(action);
}

function normalizeRetryPolicy(input) {
  const source = input.retryPolicy && typeof input.retryPolicy === 'object' ? input.retryPolicy : {};
  const maxAttempts = Math.max(1, Math.min(8, Math.trunc(finiteNonNegativeNumber(source.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts))));
  const baseDelayMs = Math.max(50, Math.min(5000, Math.trunc(finiteNonNegativeNumber(source.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs))));
  const maxDelayMs = Math.max(baseDelayMs, Math.min(30000, Math.trunc(finiteNonNegativeNumber(source.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs))));
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitter: source.jitter === false ? false : true
  };
}

function buildRetryPlan({ dependencies, retryPolicy }) {
  const retryableFailures = dependencies.filter((dependency) => {
    const status = dependency.effectiveStatus || dependency.status;
    return dependency.required && dependency.retryable && status !== 'ok';
  });
  const activeBackoffDependencies = retryableFailures.filter((dependency) => dependency.backoffRemainingMs > 0);
  const minimumBackoffMs = activeBackoffDependencies.reduce(
    (minimum, dependency) => Math.min(minimum, dependency.backoffRemainingMs),
    Number.POSITIVE_INFINITY
  );
  const backoffFloorMs = Number.isFinite(minimumBackoffMs) ? minimumBackoffMs : 0;
  const attempts = Array.from({ length: retryPolicy.maxAttempts }, (_, index) => {
    const exponentialDelay = retryPolicy.baseDelayMs * (2 ** index);
    const policyDelayMs = Math.min(retryPolicy.maxDelayMs, exponentialDelay);
    const delayMs = Math.max(policyDelayMs, backoffFloorMs);
    return {
      attempt: index + 1,
      delayMs,
      retryAfterMs: retryableFailures.length > 0 ? delayMs : 0,
      retryableDependencies: retryableFailures.map((dependency) => dependency.name),
      delayedByDependencyBackoff: activeBackoffDependencies.map((dependency) => dependency.name)
    };
  });

  return {
    enabled: retryableFailures.length > 0,
    policy: retryPolicy,
    retryableDependencyCount: retryableFailures.length,
    blockedByCircuitBreaker: retryableFailures
      .filter((dependency) => dependency.circuitOpen)
      .map((dependency) => dependency.name),
    staleDependencyObservations: retryableFailures
      .filter((dependency) => dependency.observationStale)
      .map((dependency) => dependency.name),
    activeBackoffDependencies: activeBackoffDependencies.map((dependency) => ({
      name: dependency.name,
      retryWindowState: dependency.retryWindowState,
      retryAfterMs: dependency.backoffRemainingMs,
      backoffUntilMs: dependency.backoffUntilMs,
      lastAttemptAt: dependency.lastAttemptAt,
      nextRetryAt: dependency.nextRetryAt
    })),
    nextRetryAfterMs: retryableFailures.length > 0
      ? Math.max(retryPolicy.baseDelayMs, backoffFloorMs)
      : 0,
    attempts: retryableFailures.length > 0 ? attempts : []
  };
}

function buildOperationalHealth({ boundary, dependencies, retryPlan }) {
  const requiredDown = dependencies.filter((dependency) => dependency.required && (dependency.effectiveStatus || dependency.status) === 'down');
  const requiredUnknown = dependencies.filter((dependency) => dependency.required && (dependency.effectiveStatus || dependency.status) === 'unknown');
  const degraded = dependencies.filter((dependency) => dependency.required && (dependency.effectiveStatus || dependency.status) === 'degraded');
  const readOnlyReasons = [];

  if (requiredDown.some((dependency) => dependency.name === 'volatileStore')) {
    readOnlyReasons.push('volatile store is down; fact mutation must be blocked');
  }
  if (requiredDown.some((dependency) => dependency.name === 'evidenceIndex')) {
    readOnlyReasons.push('evidence index is down; confidence proof cannot be refreshed');
  }
  if (requiredDown.some((dependency) => dependency.name === 'auditSink') && inputRequiresAudit(boundary.action)) {
    readOnlyReasons.push('audit sink is down; audited write action cannot be committed');
  }
  for (const dependency of dependencies) {
    if (!dependency.required || !dependency.observationStale) continue;
    readOnlyReasons.push(`${dependency.name} health observation is stale; refresh dependency health before committing`);
  }
  for (const dependency of dependencies) {
    if (!dependency.required || !dependency.circuitOpen) continue;
    readOnlyReasons.push(`${dependency.name} circuit breaker is open after ${dependency.consecutiveFailures} consecutive failures`);
  }
  for (const dependency of dependencies) {
    const status = dependency.effectiveStatus || dependency.status;
    if (!dependency.required || status === 'ok' || dependency.backoffRemainingMs <= 0) continue;
    readOnlyReasons.push(`${dependency.name} retry backoff is active for ${dependency.backoffRemainingMs}ms`);
  }

  const status = requiredDown.length > 0
    ? 'down'
    : degraded.length > 0 || requiredUnknown.length > 0
      ? 'degraded'
      : 'healthy';
  const failureState = status === 'down'
    ? 'blocking'
    : status === 'degraded'
      ? 'non_blocking_degraded'
      : 'none';

  return {
    status,
    failureState,
    degradedMode: status !== 'healthy',
    allowMutation: boundary.allowed && readOnlyReasons.length === 0 && failureState !== 'blocking',
    readOnlyReasons,
    dependencySummary: {
      requiredDown: requiredDown.map((dependency) => dependency.name),
      requiredUnknown: requiredUnknown.map((dependency) => dependency.name),
      degraded: degraded.map((dependency) => dependency.name),
      stale: dependencies.filter((dependency) => dependency.required && dependency.observationStale).map((dependency) => dependency.name),
      circuitOpen: dependencies.filter((dependency) => dependency.required && dependency.circuitOpen).map((dependency) => dependency.name),
      backoffActive: dependencies
        .filter((dependency) => dependency.required && (dependency.effectiveStatus || dependency.status) !== 'ok' && dependency.backoffRemainingMs > 0)
        .map((dependency) => dependency.name)
    },
    dependencies,
    retryPlan
  };
}

function normalizeLifecycleSettings(input, { now }) {
  const source = input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
    ? input.lifecycleSettings
    : input.settings && typeof input.settings === 'object'
      ? input.settings
      : {};
  const scheduleSource = source.schedule && typeof source.schedule === 'object'
    ? source.schedule
    : input.schedule && typeof input.schedule === 'object'
      ? input.schedule
      : {};
  const rawStatus = asText(source.status || input.lifecycleStatus);
  const status = LIFECYCLE_STATUSES.has(rawStatus)
    ? rawStatus
    : source.enabled === false || input.enabled === false
      ? 'disabled'
      : source.paused === true || input.paused === true
        ? 'paused'
        : 'enabled';
  const intervalMs = Math.max(
    MIN_SCHEDULE_INTERVAL_MS,
    Math.min(MAX_SCHEDULE_INTERVAL_MS, Math.trunc(finitePositiveNumber(scheduleSource.intervalMs, 300000)))
  );
  const rawNextRunAt = asText(scheduleSource.nextRunAt || source.nextRunAt || input.nextRunAt);
  const nextRunAtMs = parseTimestampMs(rawNextRunAt);
  const nowMs = parseTimestampMs(now);
  const scheduleEnabled = scheduleSource.enabled === false || source.scheduleEnabled === false ? false : true;
  const runMode = ['manual', 'scheduled', 'event_driven'].includes(asText(source.runMode))
    ? asText(source.runMode)
    : scheduleEnabled
      ? 'scheduled'
      : 'manual';

  return {
    schemaVersion: 'volatile-fact-check.lifecycle-settings.v1',
    status,
    enabled: status === 'enabled',
    paused: status === 'paused',
    runMode,
    schedule: {
      enabled: scheduleEnabled,
      intervalMs,
      minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
      maxIntervalMs: MAX_SCHEDULE_INTERVAL_MS,
      jitterMs: Math.max(0, Math.min(intervalMs, Math.trunc(finiteNonNegativeNumber(scheduleSource.jitterMs, 0)))),
      nextRunAt: rawNextRunAt || null,
      nextRunInMs: nowMs !== null && nextRunAtMs !== null ? Math.max(0, nextRunAtMs - nowMs) : null,
      overdue: scheduleEnabled && nowMs !== null && nextRunAtMs !== null && nextRunAtMs <= nowMs,
      catchUp: scheduleSource.catchUp === true
    },
    auditRequired: source.auditRequired === false ? false : true,
    reason: asText(source.reason || input.lifecycleReason) || null,
    updatedAt: asText(source.updatedAt) || null
  };
}

function normalizeLifecycleScheduleOverride({ source, settings, now }) {
  const scheduleSource = source.schedule && typeof source.schedule === 'object'
    ? source.schedule
    : {};
  const hasEnabled = Object.prototype.hasOwnProperty.call(scheduleSource, 'enabled')
    || Object.prototype.hasOwnProperty.call(source, 'scheduleEnabled');
  const requestedEnabled = hasEnabled
    ? scheduleSource.enabled === false || source.scheduleEnabled === false ? false : true
    : settings.schedule.enabled;
  const requestedIntervalRaw = Object.prototype.hasOwnProperty.call(scheduleSource, 'intervalMs')
    ? scheduleSource.intervalMs
    : source.intervalMs;
  const requestedIntervalMs = Number.isFinite(requestedIntervalRaw) ? requestedIntervalRaw : null;
  const intervalMs = requestedIntervalMs === null
    ? settings.schedule.intervalMs
    : Math.max(MIN_SCHEDULE_INTERVAL_MS, Math.min(MAX_SCHEDULE_INTERVAL_MS, Math.trunc(requestedIntervalMs)));
  const requestedJitterRaw = Object.prototype.hasOwnProperty.call(scheduleSource, 'jitterMs')
    ? scheduleSource.jitterMs
    : source.jitterMs;
  const requestedJitterMs = Number.isFinite(requestedJitterRaw) ? requestedJitterRaw : null;
  const jitterMs = requestedJitterMs === null
    ? settings.schedule.jitterMs
    : Math.max(0, Math.min(intervalMs, Math.trunc(requestedJitterMs)));
  const requestedNextRunAt = asText(scheduleSource.nextRunAt || source.nextRunAt);
  const requestedNextRunAtMs = parseTimestampMs(requestedNextRunAt);
  const nowMs = parseTimestampMs(now);
  const nextRunAt = requestedNextRunAt
    || (requestedEnabled ? settings.schedule.nextRunAt : null);
  const nextRunAtMs = requestedNextRunAt ? requestedNextRunAtMs : parseTimestampMs(nextRunAt);
  const catchUp = Object.prototype.hasOwnProperty.call(scheduleSource, 'catchUp')
    ? scheduleSource.catchUp === true
    : Object.prototype.hasOwnProperty.call(source, 'catchUp')
      ? source.catchUp === true
      : settings.schedule.catchUp;

  return {
    enabled: requestedEnabled,
    intervalMs,
    minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
    maxIntervalMs: MAX_SCHEDULE_INTERVAL_MS,
    jitterMs,
    nextRunAt,
    nextRunInMs: nowMs !== null && nextRunAtMs !== null ? Math.max(0, nextRunAtMs - nowMs) : null,
    overdue: requestedEnabled && nowMs !== null && nextRunAtMs !== null && nextRunAtMs <= nowMs,
    catchUp,
    override: {
      requested: Boolean(
        hasEnabled
        || requestedIntervalMs !== null
        || requestedJitterMs !== null
        || requestedNextRunAt
        || Object.prototype.hasOwnProperty.call(scheduleSource, 'catchUp')
        || Object.prototype.hasOwnProperty.call(source, 'catchUp')
      ),
      requestedEnabled,
      requestedIntervalMs,
      requestedJitterMs,
      requestedNextRunAt: requestedNextRunAt || null,
      intervalClamped: requestedIntervalMs !== null && intervalMs !== Math.trunc(requestedIntervalMs),
      jitterClamped: requestedJitterMs !== null && jitterMs !== Math.trunc(requestedJitterMs),
      nextRunAtValid: requestedNextRunAt ? requestedNextRunAtMs !== null : true
    }
  };
}

function normalizeLifecycleCommand({ input, boundary, scope, principal, settings, now }) {
  const source = input.lifecycleCommand && typeof input.lifecycleCommand === 'object' ? input.lifecycleCommand : {};
  const requestedAction = LIFECYCLE_COMMAND_ACTIONS.has(boundary.action)
    ? boundary.action
    : asText(source.action);
  const commandAction = LIFECYCLE_COMMAND_ACTIONS.has(requestedAction) ? requestedAction : null;
  const schedule = normalizeLifecycleScheduleOverride({ source, settings, now });
  const requestedRunMode = asText(source.runMode || source.targetRunMode);
  const targetRunMode = commandAction === 'configure_schedule'
    ? ['manual', 'scheduled', 'event_driven'].includes(requestedRunMode)
      ? requestedRunMode
      : schedule.enabled
        ? 'scheduled'
        : 'manual'
    : null;
  const settingsHash = buildProofDigest([
    settings.status,
    settings.runMode,
    settings.schedule.enabled ? 'schedule-on' : 'schedule-off',
    settings.schedule.intervalMs,
    settings.schedule.nextRunAt || 'no-next-run'
  ]);

  return {
    schemaVersion: 'volatile-fact-check.lifecycle-command.v1',
    active: Boolean(commandAction),
    action: commandAction,
    commandId: asText(source.commandId) || (commandAction ? `vfc-lifecycle:${buildScopeKey(scope)}:${commandAction}:${settingsHash}` : null),
    actorId: principal.id,
    requestedAt: asText(source.requestedAt) || now,
    expectedSettingsHash: asText(source.expectedSettingsHash) || null,
    settingsHash,
    reason: asText(source.reason) || settings.reason,
    targetStatus: commandAction === 'enable' || commandAction === 'resume'
      ? 'enabled'
      : commandAction === 'disable'
        ? 'disabled'
        : commandAction === 'pause'
          ? 'paused'
          : settings.status,
    targetRunMode,
    targetSchedule: commandAction === 'configure_schedule' ? schedule : null
  };
}

function normalizeLifecycleControlState(input, { scope }) {
  const source = input.lifecycleControlState && typeof input.lifecycleControlState === 'object'
    ? input.lifecycleControlState
    : input.controlState && typeof input.controlState === 'object'
      ? input.controlState
      : {};
  const commandSource = Array.isArray(source.pendingCommands)
    ? source.pendingCommands
    : Array.isArray(source.commands)
      ? source.commands
      : [];
  const scopeKey = buildScopeKey(scope);
  const commands = commandSource.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const action = asText(item.action);
    const status = asText(item.status) || 'pending';
    return {
      commandId: asText(item.commandId) || asText(item.id) || `lifecycle-command-${index + 1}`,
      scopeKey: asText(item.scopeKey) || scopeKey,
      action: LIFECYCLE_COMMAND_ACTIONS.has(action) ? action : 'configure_schedule',
      status,
      actorId: asText(item.actorId) || null,
      requestedAt: asText(item.requestedAt) || asText(item.createdAt) || null,
      expectedSettingsHash: asText(item.expectedSettingsHash) || null,
      settingsHash: asText(item.settingsHash) || null,
      reason: asText(item.reason) || null,
      replayable: TERMINAL_COMMAND_STATUSES.has(status)
    };
  }).filter((entry) => entry.scopeKey === scopeKey);
  const activeCommands = commands.filter((entry) => ACTIVE_LIFECYCLE_COMMAND_STATUSES.has(entry.status));

  return {
    schemaVersion: 'volatile-fact-check.lifecycle-control-state.v1',
    scopeKey,
    version: asText(source.version) || null,
    lastAppliedCommandId: asText(source.lastAppliedCommandId) || null,
    activeCommandCount: activeCommands.length,
    pendingCommands: activeCommands,
    latestCommand: commands
      .slice()
      .sort((a, b) => (parseTimestampMs(b.requestedAt) ?? 0) - (parseTimestampMs(a.requestedAt) ?? 0))[0] || null
  };
}

function buildLifecycleEffect({ now, scope, lifecycleSettings, lifecycleCommand, lifecycleControlState, lifecycleBlocked }) {
  const targetStatus = lifecycleCommand.targetStatus || lifecycleSettings.status;
  const targetRunMode = lifecycleCommand.targetRunMode || lifecycleSettings.runMode;
  const targetSchedule = lifecycleCommand.targetSchedule
    ? {
        enabled: lifecycleCommand.targetSchedule.enabled,
        intervalMs: lifecycleCommand.targetSchedule.intervalMs,
        minIntervalMs: lifecycleCommand.targetSchedule.minIntervalMs,
        maxIntervalMs: lifecycleCommand.targetSchedule.maxIntervalMs,
        jitterMs: lifecycleCommand.targetSchedule.jitterMs,
        nextRunAt: lifecycleCommand.targetSchedule.nextRunAt,
        nextRunInMs: lifecycleCommand.targetSchedule.nextRunInMs,
        overdue: lifecycleCommand.targetSchedule.overdue,
        catchUp: lifecycleCommand.targetSchedule.catchUp
      }
    : lifecycleSettings.schedule;
  const redundant = lifecycleCommand.active
    && targetStatus === lifecycleSettings.status
    && (lifecycleCommand.action !== 'configure_schedule'
      || (
        targetRunMode === lifecycleSettings.runMode
        && targetSchedule.enabled === lifecycleSettings.schedule.enabled
        && targetSchedule.intervalMs === lifecycleSettings.schedule.intervalMs
        && targetSchedule.jitterMs === lifecycleSettings.schedule.jitterMs
        && targetSchedule.nextRunAt === lifecycleSettings.schedule.nextRunAt
        && targetSchedule.catchUp === lifecycleSettings.schedule.catchUp
      ));
  const conflictingCommands = lifecycleCommand.active
    ? lifecycleControlState.pendingCommands.filter((entry) => {
        if (entry.commandId === lifecycleCommand.commandId) return false;
        if (entry.action === lifecycleCommand.action) return false;
        return entry.status !== 'superseded';
      })
    : [];
  const decision = !lifecycleCommand.active
    ? 'not_requested'
    : conflictingCommands.length > 0
        ? 'conflict_pending_command'
        : lifecycleBlocked
          ? 'blocked'
          : redundant
            ? 'noop_already_in_target_state'
            : 'accepted';
  const accepted = decision === 'accepted' || decision === 'noop_already_in_target_state';
  const nextSettings = accepted
    ? {
        schemaVersion: lifecycleSettings.schemaVersion,
        status: targetStatus,
        enabled: targetStatus === 'enabled',
        paused: targetStatus === 'paused',
        runMode: targetRunMode,
        schedule: targetSchedule,
        auditRequired: lifecycleSettings.auditRequired,
        reason: lifecycleCommand.reason,
        updatedAt: now
      }
    : lifecycleSettings;
  const proofDigest = buildProofDigest([
    buildScopeKey(scope),
    lifecycleCommand.commandId || 'no-command',
    lifecycleCommand.action || 'no-action',
    lifecycleSettings.status,
    targetStatus,
    targetRunMode,
    lifecycleSettings.schedule.enabled ? 'schedule-on' : 'schedule-off',
    lifecycleSettings.schedule.intervalMs,
    lifecycleSettings.schedule.nextRunAt || 'no-next-run',
    targetSchedule.enabled ? 'target-schedule-on' : 'target-schedule-off',
    targetSchedule.intervalMs,
    targetSchedule.nextRunAt || 'target-no-next-run'
  ]);

  return {
    schemaVersion: 'volatile-fact-check.lifecycle-effect.v1',
    generatedAt: now,
    active: lifecycleCommand.active,
    decision,
    accepted,
    redundant,
    conflictCommandIds: conflictingCommands.map((entry) => entry.commandId),
    current: {
      status: lifecycleSettings.status,
      runMode: lifecycleSettings.runMode,
      scheduleEnabled: lifecycleSettings.schedule.enabled,
      nextRunAt: lifecycleSettings.schedule.nextRunAt
    },
    target: {
      status: targetStatus,
      runMode: targetRunMode,
      scheduleEnabled: targetSchedule.enabled,
      intervalMs: targetSchedule.intervalMs,
      jitterMs: targetSchedule.jitterMs,
      nextRunAt: targetSchedule.nextRunAt,
      catchUp: targetSchedule.catchUp,
      overrideRequested: lifecycleCommand.targetSchedule?.override.requested || false
    },
    nextSettings,
    proofDigest,
    commandLedgerEntry: lifecycleCommand.active
      ? {
          commandId: lifecycleCommand.commandId,
          action: lifecycleCommand.action,
          status: accepted ? 'accepted' : 'denied',
          scopeKey: buildScopeKey(scope),
          actorId: lifecycleCommand.actorId,
          requestedAt: lifecycleCommand.requestedAt,
          appliedAt: accepted ? now : null,
          expectedSettingsHash: lifecycleCommand.expectedSettingsHash,
          settingsHash: lifecycleCommand.settingsHash,
          resultSettingsHash: proofDigest,
          replayable: accepted
        }
      : null,
    auditProof: lifecycleCommand.active
      ? {
          eventType: `volatile_fact.lifecycle.${lifecycleCommand.action}`,
          commandId: lifecycleCommand.commandId,
          decision,
          proofDigest,
          conflictCommandIds: conflictingCommands.map((entry) => entry.commandId),
          settingsHash: lifecycleCommand.settingsHash,
          resultSettingsHash: proofDigest
        }
      : null
  };
}

function buildActionableErrors({ boundary, health, validation }) {
  const errors = boundary.failures.map((message) => ({
    code: 'VOLATILE_FACT_BOUNDARY_DENIED',
    severity: 'error',
    message,
    action: 'Correct the principal, tenant, workspace, namespace, or role before retrying.'
  }));

  for (const issue of validation.errors) {
    errors.push({
      code: issue.code,
      severity: 'error',
      message: issue.message,
      action: issue.action
    });
  }
  for (const issue of validation.warnings) {
    errors.push({
      code: issue.code,
      severity: 'warning',
      message: issue.message,
      action: issue.action
    });
  }

  for (const dependency of health.dependencies) {
    const status = dependency.effectiveStatus || dependency.status;
    if (!dependency.required || status === 'ok') continue;
    const severity = status === 'down' ? 'error' : 'warning';
    errors.push({
      code: `VOLATILE_FACT_${dependency.name.toUpperCase()}_${status.toUpperCase()}`,
      severity,
      message: dependency.lastError || `${dependency.name} health is ${status}`,
      action: dependency.circuitOpen
        ? `Hold mutation traffic until ${dependency.name} reports a healthy check after circuit reset.`
        : dependency.observationStale
          ? `Refresh ${dependency.name} health; last observation age is ${dependency.observedAgeMs === null ? 'unknown' : `${dependency.observedAgeMs}ms`}.`
          : dependency.backoffRemainingMs > 0
            ? `Wait ${dependency.backoffRemainingMs}ms before retrying ${dependency.name}, then re-run dependency health validation.`
          : dependency.retryable
            ? `Retry with backoff and inspect ${dependency.name} readiness if the condition persists.`
            : `Inspect ${dependency.name} configuration before retrying.`
    });
  }

  for (const reason of health.readOnlyReasons) {
    errors.push({
      code: 'VOLATILE_FACT_READ_ONLY_DEGRADED_MODE',
      severity: 'error',
      message: reason,
      action: 'Route the request as read-only or wait until required dependencies are healthy.'
    });
  }

  return errors;
}

function buildLifecycleValidation({ boundary, lifecycleSettings, lifecycleCommand, lifecycleControlState, health }) {
  const errors = [];
  const warnings = [];
  const scheduleOverride = lifecycleCommand.targetSchedule?.override || null;
  const targetSchedule = lifecycleCommand.targetSchedule || lifecycleSettings.schedule;

  if (lifecycleSettings.runMode === 'scheduled' && !lifecycleSettings.schedule.enabled) {
    errors.push({
      code: 'VOLATILE_FACT_SCHEDULE_MODE_DISABLED',
      message: 'scheduled run mode requires schedule.enabled to be true',
      action: 'Enable scheduling or switch lifecycleSettings.runMode to manual before saving lifecycle settings.'
    });
  }
  if (lifecycleSettings.schedule.enabled && !lifecycleSettings.schedule.nextRunAt) {
    warnings.push({
      code: 'VOLATILE_FACT_NEXT_RUN_MISSING',
      message: 'scheduling is enabled without a nextRunAt timestamp',
      action: 'Provide schedule.nextRunAt so hosted kernel workers can expose deterministic next action state.'
    });
  }
  if (lifecycleSettings.status === 'disabled' && MUTATION_ACTIONS.has(boundary.action)) {
    errors.push({
      code: 'VOLATILE_FACT_DISABLED',
      message: 'volatile fact checking is disabled for this scope',
      action: 'Run a lifecycle enable command before submitting fact mutations.'
    });
  }
  if (lifecycleSettings.status === 'paused' && MUTATION_ACTIONS.has(boundary.action)) {
    errors.push({
      code: 'VOLATILE_FACT_PAUSED',
      message: 'volatile fact checking is paused for this scope',
      action: 'Run a lifecycle resume command before submitting fact mutations.'
    });
  }
  if (lifecycleCommand.active && lifecycleSettings.auditRequired && !boundary.permissions.canAudit) {
    errors.push({
      code: 'VOLATILE_FACT_LIFECYCLE_AUDIT_ROLE_REQUIRED',
      message: `${lifecycleCommand.action} lifecycle command requires audit handoff permission`,
      action: 'Grant memory.audit.handoff or set lifecycleSettings.auditRequired to false for non-audited local controls.'
    });
  }
  if (lifecycleCommand.active && lifecycleCommand.expectedSettingsHash && lifecycleCommand.expectedSettingsHash !== lifecycleCommand.settingsHash) {
    errors.push({
      code: 'VOLATILE_FACT_LIFECYCLE_SETTINGS_HASH_MISMATCH',
      message: 'lifecycle command expectedSettingsHash does not match the current normalized lifecycle settings hash',
      action: 'Refresh lifecycle settings before applying the command, then retry with the latest settings hash.'
    });
  }
  if (
    lifecycleCommand.action === 'configure_schedule'
    && lifecycleSettings.runMode === 'manual'
    && lifecycleSettings.schedule.enabled
    && !lifecycleCommand.targetRunMode
  ) {
    errors.push({
      code: 'VOLATILE_FACT_CONFIGURE_SCHEDULE_RUN_MODE_MANUAL',
      message: 'configure_schedule cannot enable a schedule while runMode remains manual',
      action: 'Set lifecycleSettings.runMode to scheduled or disable lifecycleSettings.schedule.enabled.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && lifecycleCommand.targetRunMode === 'manual' && targetSchedule.enabled) {
    errors.push({
      code: 'VOLATILE_FACT_TARGET_SCHEDULE_RUN_MODE_MANUAL',
      message: 'configure_schedule cannot target an enabled schedule while targetRunMode is manual',
      action: 'Set lifecycleCommand.runMode to scheduled or set lifecycleCommand.schedule.enabled to false.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && lifecycleCommand.targetRunMode === 'event_driven' && targetSchedule.enabled) {
    warnings.push({
      code: 'VOLATILE_FACT_EVENT_DRIVEN_WITH_SCHEDULE',
      message: 'event_driven lifecycle run mode was requested with schedule.enabled true',
      action: 'Hosted kernel will preserve the schedule for fallback polling, but event triggers should remain the primary source.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && scheduleOverride?.requestedNextRunAt && !scheduleOverride.nextRunAtValid) {
    errors.push({
      code: 'VOLATILE_FACT_TARGET_NEXT_RUN_INVALID',
      message: 'lifecycleCommand.schedule.nextRunAt is not a parseable timestamp',
      action: 'Provide nextRunAt as an ISO timestamp or omit it to retain the existing schedule cursor.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && targetSchedule.enabled && !targetSchedule.nextRunAt) {
    warnings.push({
      code: 'VOLATILE_FACT_TARGET_NEXT_RUN_MISSING',
      message: 'configure_schedule targets an enabled schedule without a nextRunAt timestamp',
      action: 'Provide lifecycleCommand.schedule.nextRunAt so workers can compute deterministic due state.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && scheduleOverride?.intervalClamped) {
    warnings.push({
      code: 'VOLATILE_FACT_TARGET_INTERVAL_CLAMPED',
      message: `requested schedule interval ${scheduleOverride.requestedIntervalMs}ms was clamped to ${targetSchedule.intervalMs}ms`,
      action: `Use an interval between ${targetSchedule.minIntervalMs}ms and ${targetSchedule.maxIntervalMs}ms to avoid kernel-side clamping.`
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && scheduleOverride?.jitterClamped) {
    warnings.push({
      code: 'VOLATILE_FACT_TARGET_JITTER_CLAMPED',
      message: `requested schedule jitter ${scheduleOverride.requestedJitterMs}ms was clamped to ${targetSchedule.jitterMs}ms`,
      action: 'Use a non-negative jitter that does not exceed the target schedule interval.'
    });
  }
  if (lifecycleCommand.action === 'configure_schedule' && lifecycleSettings.schedule.intervalMs < lifecycleSettings.schedule.minIntervalMs) {
    errors.push({
      code: 'VOLATILE_FACT_SCHEDULE_INTERVAL_TOO_LOW',
      message: 'schedule.intervalMs is below the minimum supported volatile fact check interval',
      action: `Use an interval of at least ${lifecycleSettings.schedule.minIntervalMs}ms.`
    });
  }
  if (lifecycleCommand.action === 'pause' && lifecycleSettings.status === 'disabled') {
    errors.push({
      code: 'VOLATILE_FACT_PAUSE_DISABLED_SCOPE',
      message: 'disabled volatile fact checking cannot be paused',
      action: 'Enable volatile fact checking before pausing, or keep the scope disabled.'
    });
  }
  if (lifecycleCommand.action === 'resume' && lifecycleSettings.status === 'disabled') {
    errors.push({
      code: 'VOLATILE_FACT_RESUME_DISABLED_SCOPE',
      message: 'disabled volatile fact checking cannot be resumed directly',
      action: 'Run enable instead of resume for a disabled volatile fact check scope.'
    });
  }
  const conflictingCommand = lifecycleCommand.active
    ? lifecycleControlState.pendingCommands.find((entry) => entry.commandId !== lifecycleCommand.commandId && entry.action !== lifecycleCommand.action)
    : null;
  if (conflictingCommand) {
    errors.push({
      code: 'VOLATILE_FACT_LIFECYCLE_PENDING_COMMAND_CONFLICT',
      message: `pending lifecycle command ${conflictingCommand.commandId} conflicts with ${lifecycleCommand.action}`,
      action: 'Supersede, replay, or complete the pending lifecycle command before applying another lifecycle control.'
    });
  }
  if (lifecycleCommand.action === 'disable' && health.status === 'down') {
    warnings.push({
      code: 'VOLATILE_FACT_DISABLE_WHILE_DEPENDENCY_DOWN',
      message: 'disable command was requested while required dependencies are down',
      action: 'Persist the disable command through the lifecycle control plane and verify it after dependencies recover.'
    });
  }

  return { errors, warnings };
}

function buildMutationValidation({ boundary, scope, evidence, evidenceProof, command, persistedState, lifecycleValidation }) {
  const errors = [];
  const warnings = [];
  const activeCommand = persistedState.commandLedger.find((entry) => entry.idempotencyKey === command.idempotencyKey);

  if (command.mutation && !scope.factId) {
    errors.push({
      code: 'VOLATILE_FACT_ID_REQUIRED',
      message: 'mutation actions require a factId in volatile scope',
      action: 'Provide scope.factId or factId before asserting, correcting, or invalidating a volatile fact.'
    });
  }
  if (command.mutation && evidence.length === 0 && boundary.action !== 'invalidate') {
    errors.push({
      code: 'VOLATILE_FACT_EVIDENCE_REQUIRED',
      message: `${boundary.action} requires at least one evidence claim`,
      action: 'Attach evidence with an id, source, claim, and confidence before retrying.'
    });
  }
  if (command.mutation && activeCommand && activeCommand.status && !activeCommand.replayable) {
    errors.push({
      code: 'VOLATILE_FACT_IDEMPOTENCY_IN_PROGRESS',
      message: `idempotency key ${command.idempotencyKey} already has non-terminal status ${activeCommand.status}`,
      action: 'Poll the existing command or use a new idempotency key for a distinct fact mutation.'
    });
  }
  if (command.mutation && evidence.some((entry) => entry.confidence === null)) {
    warnings.push({
      code: 'VOLATILE_FACT_EVIDENCE_CONFIDENCE_MISSING',
      message: 'one or more evidence claims do not include confidence',
      action: 'Include confidence values from 0 to 1 to strengthen audit proof quality.'
    });
  }
  if (command.mutation && evidenceProof.duplicateEvidenceIds.length > 0) {
    errors.push({
      code: 'VOLATILE_FACT_EVIDENCE_ID_DUPLICATE',
      message: `duplicate evidence ids: ${evidenceProof.duplicateEvidenceIds.join(', ')}`,
      action: 'Use stable unique evidence ids so audit proof references cannot collapse multiple claims.'
    });
  }
  if (command.mutation && evidenceProof.decision === 'conflict' && boundary.action !== 'invalidate') {
    errors.push({
      code: 'VOLATILE_FACT_EVIDENCE_CONFLICT',
      message: 'contradicting evidence outweighs or matches supporting evidence',
      action: 'Resolve the conflict with a correction or invalidate the volatile fact until stronger evidence is available.'
    });
  }
  if (command.mutation && !evidenceProof.sourceBacked && boundary.action !== 'invalidate') {
    warnings.push({
      code: 'VOLATILE_FACT_EVIDENCE_SOURCE_UNVERIFIED',
      message: 'one or more evidence claims lack a named source or artifact URI',
      action: 'Attach source metadata or artifactUri so the audit handoff can verify the proof trail.'
    });
  }
  if (command.mutation && evidenceProof.missingObservedAt.length > 0) {
    warnings.push({
      code: 'VOLATILE_FACT_EVIDENCE_OBSERVED_AT_MISSING',
      message: 'one or more evidence claims do not include observedAt timestamps',
      action: 'Include observedAt timestamps to make restart recovery and audit ordering deterministic.'
    });
  }

  const combinedErrors = [...lifecycleValidation.errors, ...errors];
  const combinedWarnings = [...lifecycleValidation.warnings, ...warnings];

  return {
    valid: combinedErrors.length === 0,
    errors: combinedErrors,
    warnings: combinedWarnings
  };
}

function normalizeEvidence(input) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  return evidence.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : { value: entry };
    const stance = ['supports', 'contradicts', 'neutral'].includes(asText(item.stance))
      ? asText(item.stance)
      : item.contradicts === true
        ? 'contradicts'
        : 'supports';
    return {
      id: asText(item.id) || `evidence-${index + 1}`,
      source: asText(item.source) || 'unspecified',
      sourceType: asText(item.sourceType) || asText(item.kind) || 'unknown',
      claim: asText(item.claim) || asText(item.value),
      observedAt: asText(item.observedAt) || asText(item.timestamp),
      confidence: Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : null,
      stance,
      artifactUri: asText(item.artifactUri) || asText(item.uri) || null
    };
  }).filter((entry) => entry.claim);
}

function proofToken(value) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function buildProofDigest(parts) {
  const payload = parts.map(proofToken).join('|');
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `vfc-proof-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildEvidenceProof({ evidence, scope, input, now }) {
  const expectedValueHash = asText(input.factValueHash) || asText(input.valueHash) || null;
  const duplicateEvidenceIds = [];
  const seenIds = new Set();
  const sourceNames = new Set();
  const sourceTypes = new Set();
  let supportWeight = 0;
  let contradictWeight = 0;
  let neutralWeight = 0;

  for (const entry of evidence) {
    if (seenIds.has(entry.id)) duplicateEvidenceIds.push(entry.id);
    seenIds.add(entry.id);
    sourceNames.add(entry.source);
    sourceTypes.add(entry.sourceType);
    const confidence = entry.confidence === null ? 0.5 : entry.confidence;
    if (entry.stance === 'contradicts') contradictWeight += confidence;
    else if (entry.stance === 'neutral') neutralWeight += confidence;
    else supportWeight += confidence;
  }

  const missingObservedAt = evidence.filter((entry) => !entry.observedAt).map((entry) => entry.id);
  const unverifiableEvidenceIds = evidence
    .filter((entry) => entry.source === 'unspecified' && !entry.artifactUri)
    .map((entry) => entry.id);
  const contradictionIds = evidence.filter((entry) => entry.stance === 'contradicts').map((entry) => entry.id);
  const confidenceTotal = supportWeight + contradictWeight + neutralWeight;
  const confidenceBalance = confidenceTotal > 0 ? (supportWeight - contradictWeight) / confidenceTotal : 0;
  const decision = evidence.length === 0
    ? 'no_evidence'
    : contradictionIds.length > 0 && contradictWeight >= supportWeight
      ? 'conflict'
      : supportWeight >= 1 && sourceNames.size >= 2
        ? 'corroborated'
        : supportWeight > 0
          ? 'single_source'
          : 'unsubstantiated';
  const proofDigest = buildProofDigest([
    buildScopeKey(scope),
    expectedValueHash || 'no-value-hash',
    now,
    ...evidence.map((entry) => [entry.id, entry.source, entry.stance, entry.claim, entry.confidence ?? 'missing'].join(':'))
  ]);

  return {
    schemaVersion: 'volatile-fact-check.evidence-proof.v1',
    generatedAt: now,
    scopeKey: buildScopeKey(scope),
    factId: scope.factId || null,
    expectedValueHash,
    decision,
    proofDigest,
    sourceBacked: evidence.length > 0 && unverifiableEvidenceIds.length === 0,
    sourceCount: sourceNames.size,
    sourceTypes: [...sourceTypes].sort(),
    evidenceCount: evidence.length,
    duplicateEvidenceIds: [...new Set(duplicateEvidenceIds)],
    missingObservedAt,
    unverifiableEvidenceIds,
    contradictionIds,
    confidence: {
      supportWeight: Number(supportWeight.toFixed(4)),
      contradictWeight: Number(contradictWeight.toFixed(4)),
      neutralWeight: Number(neutralWeight.toFixed(4)),
      balance: Number(confidenceBalance.toFixed(4))
    },
    evidenceIds: evidence.map((entry) => entry.id)
  };
}

function buildAuditHandoff({ now, principal, scope, boundary, evidence, command, evidenceProof, clientRuntime }) {
  return {
    auditSurface: 'memory-manager.audit-handoff',
    eventType: boundary.allowed ? 'volatile_fact_check.boundary.accepted' : 'volatile_fact_check.boundary.denied',
    generatedAt: now,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    actorId: principal.id,
    delegatedBy: principal.delegatedBy || null,
    factId: scope.factId || null,
    sourceSurface: scope.sourceSurface,
    action: boundary.action,
    decision: boundary.allowed ? 'allow' : 'deny',
    denialReasons: boundary.failures,
    warningReasons: boundary.warnings,
    evidenceIds: evidence.map((entry) => entry.id),
    evidenceProofDigest: evidenceProof ? evidenceProof.proofDigest : null,
    evidenceDecision: evidenceProof ? evidenceProof.decision : 'not_evaluated',
    commandId: command ? command.commandId : null,
    idempotencyKey: command ? command.idempotencyKey : null,
    clientCorrelation: clientRuntime
      ? {
          requestId: clientRuntime.requestId,
          sessionId: clientRuntime.sessionId,
          traceId: clientRuntime.traceId,
          routeKey: clientRuntime.routeKey,
          continuationState: clientRuntime.continuationState,
          pendingAcceptanceToken: clientRuntime.pendingAcceptanceToken ? 'present' : 'missing'
        }
      : null,
    isolation: {
      tenantIsolated: boundary.permissionProof.tenantIsolated,
      workspaceAccess: boundary.permissionProof.workspaceAccess,
      scopeKey: buildScopeKey(scope),
      matchingGrantIds: boundary.permissionProof.matchingGrantIds,
      ignoredGrantCount: boundary.permissionProof.ignoredGrants.length,
      workspaceBindingMode: boundary.workspaceScopeProof.bindingMode,
      activeWorkspaceBindingId: boundary.workspaceScopeProof.activeBindingId,
      workspaceBindingProofDigest: boundary.workspaceScopeProof.proofDigest,
      blockedWorkspaceBindings: boundary.workspaceScopeProof.blockedBindings
    },
    permissions: {
      effectiveRoles: boundary.permissionProof.effectiveRoles,
      scopedRoles: boundary.permissionProof.scopedRoles,
      directRoles: boundary.permissionProof.directRoles,
      delegatedGrantActors: boundary.permissionProof.delegatedGrantActors
    }
  };
}

function normalizeFactStatus(value, fallback = 'pending') {
  const status = asText(value);
  return ['pending', 'accepted', 'corrected', 'invalidated', 'rejected', 'recovering', 'commit_started'].includes(status)
    ? status
    : fallback;
}

function normalizePersistedFactRecord(entry, index, scope) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const factId = asText(item.factId) || asText(item.id) || scope.factId || `fact-${index + 1}`;
  return {
    factId,
    scopeKey: asText(item.scopeKey) || buildScopeKey({ ...scope, factId }),
    status: normalizeFactStatus(item.status),
    revision: Math.max(0, Math.trunc(finiteNonNegativeNumber(item.revision, 0))),
    valueHash: asText(item.valueHash) || asText(item.hash) || null,
    evidenceIds: uniqueTextList(item.evidenceIds),
    lastCommandId: asText(item.lastCommandId) || null,
    updatedAt: asText(item.updatedAt) || asText(item.committedAt) || null
  };
}

function normalizePersistedCommand(entry, index) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const commandId = asText(item.commandId) || asText(item.id) || `persisted-command-${index + 1}`;
  const status = asText(item.status) || 'pending';
  return {
    commandId,
    idempotencyKey: asText(item.idempotencyKey) || commandId,
    action: asText(item.action) || 'read',
    status,
    scopeKey: asText(item.scopeKey),
    factId: asText(item.factId) || null,
    resultFactStatus: normalizeFactStatus(item.resultFactStatus || item.factStatus, 'pending'),
    evidenceIds: uniqueTextList(item.evidenceIds),
    committedAt: asText(item.committedAt) || null,
    lastSeenAt: asText(item.lastSeenAt) || asText(item.updatedAt) || null,
    replayable: item.replayable === false ? false : TERMINAL_COMMAND_STATUSES.has(status)
  };
}

function normalizePersistedState(input, { now, scope }) {
  const source = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const factSource = Array.isArray(source.facts)
    ? source.facts
    : source.facts && typeof source.facts === 'object'
      ? Object.values(source.facts)
      : [];
  const commandSource = Array.isArray(source.commandLedger)
    ? source.commandLedger
    : Array.isArray(source.commands)
      ? source.commands
      : [];
  const facts = factSource.map((entry, index) => normalizePersistedFactRecord(entry, index, scope));
  const commandLedger = commandSource.map(normalizePersistedCommand);
  const schemaVersion = asText(source.schemaVersion) || PERSISTED_STATE_SCHEMA;
  const warnings = [];

  if (schemaVersion !== PERSISTED_STATE_SCHEMA) {
    warnings.push(`persisted state schema ${schemaVersion} will be recovered as ${PERSISTED_STATE_SCHEMA}`);
  }

  return {
    schemaVersion: PERSISTED_STATE_SCHEMA,
    sourceSchemaVersion: schemaVersion,
    bootId: asText(source.bootId) || asText(input.bootId) || null,
    recoveredAt: now,
    journalCursor: Math.max(0, Math.trunc(finiteNonNegativeNumber(source.journalCursor, 0))),
    facts,
    commandLedger,
    warnings
  };
}

function buildCommandEnvelope({ input, principal, scope, boundary, evidence }) {
  const action = boundary.action;
  const scopeKey = buildScopeKey(scope);
  const factHash = asText(input.factValueHash) || asText(input.valueHash) || uniqueTextList(evidence.map((entry) => entry.id)).join('+') || 'no-evidence';
  const idempotencyKey = asText(input.idempotencyKey) || `vfc:${scopeKey}:${action}:${factHash}`;
  const commandId = asText(input.commandId) || idempotencyKey;
  return {
    commandId,
    idempotencyKey,
    action,
    mutation: MUTATION_ACTIONS.has(action),
    scopeKey,
    factId: scope.factId || null,
    actorId: principal.id,
    intentHash: [scopeKey, action, factHash, principal.id].join('|'),
    evidenceIds: evidence.map((entry) => entry.id)
  };
}

function buildStateRecovery({ persistedState, command, scope, health, boundary }) {
  const matchingFacts = persistedState.facts.filter((fact) => fact.scopeKey === command.scopeKey || (scope.factId && fact.factId === scope.factId));
  const activeFact = matchingFacts.sort((a, b) => b.revision - a.revision)[0] || null;
  const previousCommand = persistedState.commandLedger.find((entry) => entry.idempotencyKey === command.idempotencyKey);
  const needsRecovery = Boolean(activeFact && RECOVERABLE_FACT_STATUSES.has(activeFact.status));
  const replay = Boolean(previousCommand && previousCommand.replayable);
  const canRecover = boundary.allowed && health.allowMutation && health.status !== 'down';
  const recoveryMode = replay
    ? 'idempotent_replay'
    : needsRecovery && canRecover
      ? 'resume_pending_commit'
      : needsRecovery
        ? 'recovery_blocked'
        : 'clean_start';

  return {
    recoveryMode,
    restartSafe: replay || !needsRecovery || canRecover,
    replay,
    previousCommand: previousCommand
      ? {
          commandId: previousCommand.commandId,
          status: previousCommand.status,
          committedAt: previousCommand.committedAt,
          resultFactStatus: previousCommand.resultFactStatus
        }
      : null,
    activeFact: activeFact
      ? {
          factId: activeFact.factId,
          status: activeFact.status,
          revision: activeFact.revision,
          valueHash: activeFact.valueHash,
          lastCommandId: activeFact.lastCommandId,
          updatedAt: activeFact.updatedAt
        }
      : null,
    pendingRecoveryReasons: needsRecovery && !canRecover
      ? [...boundary.failures, ...health.readOnlyReasons, health.status === 'down' ? 'required dependency is down during restart recovery' : null].filter(Boolean)
      : []
  };
}

function buildRestartSafeStatus({ boundary, health, command, recovery }) {
  if (!boundary.allowed) return 'denied_by_boundary';
  if (recovery.replay) return 'replayed_from_command_ledger';
  if (recovery.recoveryMode === 'recovery_blocked') return 'restart_recovery_blocked';
  if (command.mutation && !health.allowMutation) return 'read_only_degraded';
  if (recovery.recoveryMode === 'resume_pending_commit') return 'resuming_pending_commit';
  return command.mutation ? 'mutation_ready' : 'read_ready';
}

function buildHostedKernelProjection({ now, scope, boundary, health, validation, command, evidenceProof, recovery, lifecycleSettings, lifecycleCommand, lifecycleControlState }) {
  const mutationBlocked = command.mutation && (!boundary.allowed || !validation.valid || !health.allowMutation || !recovery.restartSafe);
  const lifecycleBlocked = lifecycleCommand.active && (!boundary.allowed || !validation.valid);
  const lifecycleEffect = buildLifecycleEffect({
    now,
    scope,
    lifecycleSettings,
    lifecycleCommand,
    lifecycleControlState,
    lifecycleBlocked
  });
  const projectedStatus = boundary.action === 'invalidate'
    ? 'invalidated'
    : boundary.action === 'correct'
      ? 'corrected'
      : 'accepted';
  const commitDecision = !command.mutation
    ? 'read_only'
    : mutationBlocked
      ? 'blocked'
      : recovery.replay
        ? 'replay_previous_result'
        : recovery.recoveryMode === 'resume_pending_commit'
          ? 'resume_commit'
          : 'commit_new_revision';
  const blockReasons = [
    ...boundary.failures,
    ...validation.errors.map((issue) => issue.message),
    ...health.readOnlyReasons,
    recovery.restartSafe ? null : 'restart recovery is not safe for this command'
  ].filter(Boolean);
  const nextRevision = recovery.activeFact ? recovery.activeFact.revision + (commitDecision === 'commit_new_revision' ? 1 : 0) : 1;
  const lifecycleWriteSet = lifecycleEffect.accepted
    ? {
        commandId: lifecycleCommand.commandId,
        action: lifecycleCommand.action,
        decision: lifecycleEffect.decision,
        status: lifecycleEffect.target.status,
        runMode: lifecycleEffect.target.runMode,
        schedule: lifecycleEffect.nextSettings.schedule,
        settingsHash: lifecycleEffect.proofDigest,
        commandLedgerEntry: lifecycleEffect.commandLedgerEntry,
        auditProof: lifecycleEffect.auditProof,
        reason: lifecycleCommand.reason,
        actorId: lifecycleCommand.actorId,
        updatedAt: now
      }
    : null;

  return {
    schemaVersion: 'volatile-fact-check.hosted-kernel-projection.v1',
    generatedAt: now,
    commitDecision,
    mutationBlocked,
    lifecycleDecision: lifecycleCommand.active
      ? lifecycleEffect.decision === 'noop_already_in_target_state'
          ? 'noop_lifecycle_command'
          : lifecycleEffect.decision === 'conflict_pending_command'
            ? 'blocked'
            : lifecycleBlocked
              ? 'blocked'
              : `apply_${lifecycleCommand.action}`
      : 'no_lifecycle_command',
    lifecycleBlocked: lifecycleBlocked || lifecycleEffect.decision === 'conflict_pending_command',
    lifecycleEffect,
    blockReasons,
    commandStatus: command.mutation
      ? commitDecision === 'blocked'
        ? 'denied'
        : commitDecision === 'replay_previous_result'
          ? 'replayed'
          : 'commit_started'
      : lifecycleCommand.active
        ? lifecycleBlocked
          ? 'lifecycle_denied'
          : 'lifecycle_applied'
        : 'read_observed',
    lifecycleWriteSet,
    writeSet: command.mutation && commitDecision !== 'blocked'
      ? {
          fact: {
            factId: scope.factId,
            scopeKey: command.scopeKey,
            status: projectedStatus,
            revision: nextRevision,
            valueHash: evidenceProof.expectedValueHash || evidenceProof.proofDigest,
            evidenceIds: evidenceProof.evidenceIds,
            lastCommandId: command.commandId,
            updatedAt: now
          },
          commandLedgerEntry: {
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            action: command.action,
            status: commitDecision === 'replay_previous_result' ? 'replayed' : 'commit_started',
            scopeKey: command.scopeKey,
            factId: scope.factId,
            resultFactStatus: projectedStatus,
            evidenceIds: evidenceProof.evidenceIds,
            lastSeenAt: now,
            replayable: false
          }
        }
      : null,
    journalAppend: command.mutation && commitDecision !== 'blocked'
      ? {
          stream: 'volatile-facts',
          key: command.scopeKey,
          eventType: `volatile_fact.${boundary.action}`,
          commandId: command.commandId,
          proofDigest: evidenceProof.proofDigest,
          auditRequired: inputRequiresAudit(boundary.action)
        }
      : lifecycleWriteSet
        ? {
            stream: 'volatile-fact-lifecycle',
            key: command.scopeKey,
            eventType: `volatile_fact.lifecycle.${lifecycleCommand.action}`,
            commandId: lifecycleCommand.commandId,
            proofDigest: lifecycleCommand.settingsHash,
            resultSettingsHash: lifecycleWriteSet.settingsHash,
            scheduleNextRunAt: lifecycleWriteSet.schedule.nextRunAt,
            scheduleEnabled: lifecycleWriteSet.schedule.enabled,
            auditRequired: lifecycleSettings.auditRequired
          }
      : null
  };
}

function commandTerminalStatusForProjection(hostedKernelProjection) {
  if (hostedKernelProjection.commandStatus === 'replayed') return 'replayed';
  if (hostedKernelProjection.commandStatus === 'denied') return 'denied';
  if (hostedKernelProjection.lifecycleEffect?.decision === 'noop_already_in_target_state') return 'committed';
  if (hostedKernelProjection.lifecycleBlocked) return 'denied';
  return hostedKernelProjection.writeSet || hostedKernelProjection.lifecycleWriteSet ? 'committed' : hostedKernelProjection.commandStatus;
}

function compactPersistedStateSummary(state) {
  return {
    schemaVersion: state.schemaVersion,
    bootId: state.bootId,
    journalCursor: state.journalCursor,
    factCount: state.facts.length,
    commandCount: state.commandLedger.length,
    latestFactRevision: state.facts.reduce((highest, fact) => Math.max(highest, fact.revision), 0),
    replayableCommandCount: state.commandLedger.filter((entry) => entry.replayable).length
  };
}

function buildPersistedStatePatch({ now, persistedState, command, evidenceProof, recovery, lifecycleSettings, lifecycleControlState, hostedKernelProjection, providerServiceContract }) {
  const writeFact = hostedKernelProjection.writeSet?.fact || null;
  const writeCommand = hostedKernelProjection.writeSet?.commandLedgerEntry || null;
  const lifecycleLedger = hostedKernelProjection.lifecycleWriteSet?.commandLedgerEntry || null;
  const terminalStatus = commandTerminalStatusForProjection(hostedKernelProjection);
  const durableCursor = hostedKernelProjection.journalAppend
    ? providerServiceContract.sync.nextCursor
    : providerServiceContract.sync.previousCursor || providerServiceContract.sync.nextCursor;
  const productWorkflow = providerServiceContract.clientRuntime.productWorkflow;
  const factPatch = writeFact
    ? {
        op: recovery.recoveryMode === 'resume_pending_commit' ? 'recover_and_upsert_fact' : 'upsert_fact',
        key: writeFact.scopeKey,
        match: {
          factId: writeFact.factId,
          previousRevision: recovery.activeFact?.revision ?? null,
          previousStatus: recovery.activeFact?.status ?? null,
          lastCommandId: recovery.activeFact?.lastCommandId ?? null
        },
        value: {
          ...writeFact,
          recoveryMode: recovery.recoveryMode,
          evidenceProofDigest: evidenceProof.proofDigest,
          durableCursor
        }
      }
    : null;
  const commandPatchSource = writeCommand || (lifecycleLedger
    ? {
        commandId: lifecycleLedger.commandId,
        idempotencyKey: lifecycleLedger.commandId,
        action: lifecycleLedger.action,
        status: lifecycleLedger.status,
        scopeKey: lifecycleLedger.scopeKey,
        factId: command.factId,
        resultFactStatus: lifecycleLedger.status,
        evidenceIds: [],
        lastSeenAt: now,
        replayable: lifecycleLedger.replayable
      }
    : null);
  const commandPatch = commandPatchSource
    ? {
        op: recovery.replay ? 'touch_replayed_command' : 'upsert_command_ledger_entry',
        key: commandPatchSource.idempotencyKey,
        idempotency: {
          commandId: commandPatchSource.commandId,
          idempotencyKey: commandPatchSource.idempotencyKey,
          previousCommandStatus: recovery.previousCommand?.status || null,
          replay: recovery.replay,
          replayedCommandId: recovery.previousCommand?.commandId || null
        },
        value: {
          ...commandPatchSource,
          status: terminalStatus,
          committedAt: terminalStatus === 'committed' || terminalStatus === 'replayed' ? now : null,
          lastSeenAt: now,
          durableCursor,
          productWorkflowStateKey: productWorkflow.stateKey,
          proofDigest: evidenceProof.proofDigest,
          replayable: ['committed', 'replayed', 'denied'].includes(terminalStatus)
        }
      }
    : null;
  const lifecyclePatch = hostedKernelProjection.lifecycleWriteSet
    ? {
        op: hostedKernelProjection.lifecycleEffect.redundant ? 'record_idempotent_lifecycle_noop' : 'upsert_lifecycle_settings',
        key: lifecycleControlState.scopeKey,
        value: {
          settings: hostedKernelProjection.lifecycleEffect.nextSettings,
          lastAppliedCommandId: hostedKernelProjection.lifecycleWriteSet.commandId,
          lastAppliedAt: now,
          settingsHash: hostedKernelProjection.lifecycleWriteSet.settingsHash,
          scheduleControl: {
            action: hostedKernelProjection.lifecycleWriteSet.action,
            enabled: hostedKernelProjection.lifecycleWriteSet.schedule.enabled,
            runMode: hostedKernelProjection.lifecycleWriteSet.runMode,
            intervalMs: hostedKernelProjection.lifecycleWriteSet.schedule.intervalMs,
            jitterMs: hostedKernelProjection.lifecycleWriteSet.schedule.jitterMs,
            nextRunAt: hostedKernelProjection.lifecycleWriteSet.schedule.nextRunAt,
            catchUp: hostedKernelProjection.lifecycleWriteSet.schedule.catchUp,
            nextRunInMs: hostedKernelProjection.lifecycleWriteSet.schedule.nextRunInMs,
            overdue: hostedKernelProjection.lifecycleWriteSet.schedule.overdue
          },
          previousStatus: lifecycleSettings.status,
          previousRunMode: lifecycleSettings.runMode,
          previousSchedule: lifecycleSettings.schedule,
          commandStatus: terminalStatus
        }
      }
    : null;
  const patchOperations = [
    factPatch,
    commandPatch,
    lifecyclePatch,
    hostedKernelProjection.journalAppend
      ? {
          op: 'advance_journal_cursor',
          key: hostedKernelProjection.journalAppend.key,
          value: {
            previousCursor: providerServiceContract.sync.previousCursor,
            nextCursor: providerServiceContract.sync.nextCursor,
            stream: hostedKernelProjection.journalAppend.stream,
            eventType: hostedKernelProjection.journalAppend.eventType,
            proofDigest: hostedKernelProjection.journalAppend.proofDigest
          }
        }
      : null
  ].filter(Boolean);
  const persistenceStatus = !recovery.restartSafe
    ? 'blocked_restart_unsafe'
    : hostedKernelProjection.mutationBlocked || hostedKernelProjection.lifecycleBlocked
      ? 'blocked_not_persisted'
      : recovery.replay
        ? 'idempotent_replay_recorded'
        : patchOperations.length > 0
          ? 'ready_to_persist'
          : 'noop_observation';

  return {
    schemaVersion: 'volatile-fact-check.persisted-state-patch.v1',
    generatedAt: now,
    scopeKey: command.scopeKey,
    persistenceStatus,
    restartSafe: recovery.restartSafe,
    recoveryMode: recovery.recoveryMode,
    durableCursor,
    baseState: compactPersistedStateSummary(persistedState),
    expectedState: {
      schemaVersion: PERSISTED_STATE_SCHEMA,
      bootId: persistedState.bootId,
      journalCursor: hostedKernelProjection.journalAppend ? durableCursor : persistedState.journalCursor,
      factCount: persistedState.facts.length + (factPatch && !recovery.activeFact ? 1 : 0),
      commandCount: persistedState.commandLedger.length + (commandPatch && !recovery.previousCommand ? 1 : 0),
      lastMutationCommandStatus: commandPatch?.value.status || null,
      lifecycleStatus: lifecyclePatch?.value.settings.status || lifecycleSettings.status,
      lifecycleRunMode: lifecyclePatch?.value.settings.runMode || lifecycleSettings.runMode,
      lifecycleScheduleEnabled: lifecyclePatch?.value.settings.schedule.enabled ?? lifecycleSettings.schedule.enabled,
      lifecycleNextRunAt: lifecyclePatch?.value.settings.schedule.nextRunAt ?? lifecycleSettings.schedule.nextRunAt
    },
    productWorkflow: {
      provider: productWorkflow.provider,
      stage: productWorkflow.stage,
      workflowId: productWorkflow.workflowId,
      campaignId: productWorkflow.campaignId,
      audienceId: productWorkflow.audienceId,
      segmentId: productWorkflow.segmentId,
      stateKey: productWorkflow.stateKey,
      validation: productWorkflow.validation,
      valid: productWorkflow.valid,
      proofDigest: productWorkflow.proofDigest
    },
    operations: patchOperations,
    recoveryProof: {
      proofDigest: buildProofDigest([
        command.scopeKey,
        command.commandId,
        evidenceProof.proofDigest,
        recovery.recoveryMode,
        persistenceStatus,
        durableCursor || 'no-cursor'
      ]),
      activeFact: recovery.activeFact,
      previousCommand: recovery.previousCommand,
      commandStatus: hostedKernelProjection.commandStatus,
      terminalStatus,
      replaySafe: recovery.replay || terminalStatus === 'committed',
      blockedReasons: persistenceStatus.startsWith('blocked') ? hostedKernelProjection.blockReasons : []
    }
  };
}

function buildNextActionState({ now, boundary, health, validation, command, recovery, lifecycleSettings, lifecycleCommand, hostedKernelProjection }) {
  const blockingValidation = validation.errors[0] || null;
  const downDependency = health.dependencies.find((dependency) => dependency.required && (dependency.effectiveStatus || dependency.status) === 'down');
  const projectedSchedule = hostedKernelProjection.lifecycleEffect?.accepted
    ? hostedKernelProjection.lifecycleEffect.nextSettings.schedule
    : lifecycleSettings.schedule;
  const projectedLifecycleEnabled = hostedKernelProjection.lifecycleEffect?.accepted
    ? hostedKernelProjection.lifecycleEffect.nextSettings.enabled
    : lifecycleSettings.enabled;
  const dueScheduledRun = projectedLifecycleEnabled && projectedSchedule.enabled && projectedSchedule.overdue;
  const scheduleControlPending = lifecycleCommand.action === 'configure_schedule'
    && hostedKernelProjection.lifecycleEffect?.accepted
    && projectedSchedule.enabled
    && !projectedSchedule.overdue;
  const status = !boundary.allowed
    ? 'needs_permission_fix'
    : blockingValidation
      ? 'needs_settings_or_payload_fix'
      : downDependency
        ? 'wait_for_dependency_recovery'
        : lifecycleCommand.active && hostedKernelProjection.lifecycleEffect.decision === 'conflict_pending_command'
          ? 'resolve_lifecycle_command_conflict'
          : lifecycleCommand.active && !hostedKernelProjection.lifecycleBlocked
          ? 'apply_lifecycle_command'
          : command.mutation && hostedKernelProjection.commitDecision !== 'blocked'
            ? 'commit_fact_revision'
            : recovery.recoveryMode === 'resume_pending_commit'
              ? 'resume_pending_commit'
              : scheduleControlPending
                ? 'await_scheduled_fact_check'
              : dueScheduledRun
                ? 'run_scheduled_fact_check'
                : 'await_next_trigger';

  return {
    schemaVersion: 'volatile-fact-check.next-action-state.v1',
    generatedAt: now,
    status,
    actor: status === 'wait_for_dependency_recovery' ? 'dependency-monitor' : 'hosted-kernel',
    commandId: lifecycleCommand.active ? lifecycleCommand.commandId : command.commandId,
    dueAt: dueScheduledRun || scheduleControlPending ? projectedSchedule.nextRunAt : null,
    retryAfterMs: health.retryPlan.enabled ? health.retryPlan.attempts[0]?.retryAfterMs ?? 0 : 0,
    schedule: {
      enabled: projectedSchedule.enabled,
      intervalMs: projectedSchedule.intervalMs,
      jitterMs: projectedSchedule.jitterMs,
      nextRunAt: projectedSchedule.nextRunAt,
      nextRunInMs: projectedSchedule.nextRunInMs,
      overdue: projectedSchedule.overdue,
      catchUp: projectedSchedule.catchUp,
      source: hostedKernelProjection.lifecycleEffect?.accepted ? 'projected_lifecycle_effect' : 'current_lifecycle_settings'
    },
    primaryReason: boundary.failures[0]
      || (blockingValidation ? blockingValidation.message : null)
      || (downDependency ? `${downDependency.name} is ${downDependency.effectiveStatus || downDependency.status}` : null)
      || hostedKernelProjection.blockReasons[0]
      || null,
    allowedTransitions: [
      lifecycleSettings.status === 'disabled' ? 'enable' : null,
      lifecycleSettings.status === 'paused' ? 'resume' : null,
      lifecycleSettings.status === 'enabled' ? 'pause' : null,
      lifecycleSettings.status === 'enabled' ? 'disable' : null,
      lifecycleSettings.runMode === 'scheduled' ? 'configure_schedule' : null,
      hostedKernelProjection.lifecycleEffect.conflictCommandIds.length > 0 ? 'supersede_pending_lifecycle_command' : null,
      command.mutation && !hostedKernelProjection.mutationBlocked ? 'commit' : null,
      health.retryPlan.enabled ? 'retry_dependency_check' : null
    ].filter(Boolean)
  };
}

function normalizeClientRuntimeState(input) {
  const runtime = input.clientRuntime && typeof input.clientRuntime === 'object'
    ? input.clientRuntime
    : input.client && typeof input.client === 'object'
      ? input.client
      : {};
  const request = runtime.request && typeof runtime.request === 'object'
    ? runtime.request
    : input.request && typeof input.request === 'object'
      ? input.request
      : {};
  const navigation = runtime.navigation && typeof runtime.navigation === 'object' ? runtime.navigation : {};
  const draft = runtime.draft && typeof runtime.draft === 'object' ? runtime.draft : {};
  const routeKey = asText(runtime.routeKey) || asText(request.routeKey) || `${surfaceGroup}/${surfaceName}`;
  const productWorkflow = normalizeProductWorkflowRuntimeContext(input, runtime, request);

  return {
    schemaVersion: 'volatile-fact-check.client-runtime-state.v1',
    requestId: asText(runtime.requestId) || asText(request.id) || asText(input.requestId) || null,
    sessionId: asText(runtime.sessionId) || asText(request.sessionId) || asText(input.sessionId) || null,
    traceId: asText(runtime.traceId) || asText(request.traceId) || asText(input.traceId) || null,
    routeKey,
    returnTo: asText(navigation.returnTo) || asText(runtime.returnTo) || null,
    viewMode: ['review', 'compact', 'audit', 'operator'].includes(asText(runtime.viewMode))
      ? asText(runtime.viewMode)
      : 'review',
    activePanel: asText(runtime.activePanel) || (draft.pending === true ? 'draft' : 'summary'),
    locale: asText(runtime.locale) || null,
    timezone: asText(runtime.timezone) || null,
    hydratedFrom: asText(runtime.hydratedFrom) || asText(request.hydratedFrom) || null,
    lastSeenCursor: asText(runtime.lastSeenCursor) || asText(input.syncCursor) || null,
    pendingAcceptanceToken: asText(runtime.pendingAcceptanceToken) || null,
    continuationState: CLIENT_CONTINUATION_STATES.has(asText(runtime.continuationState))
      ? asText(runtime.continuationState)
      : null,
    selectedFactIds: uniqueTextList(runtime.selectedFactIds || request.selectedFactIds),
    dirtyFields: uniqueTextList(draft.dirtyFields || runtime.dirtyFields),
    clientCapabilities: uniqueTextList(runtime.capabilities || input.consumerCapabilities),
    productWorkflow
  };
}

function buildClientContinuationState({ now, clientRuntime, command, nextCursor, nextActionState, hostedKernelProjection }) {
  const expectedHandoffToken = buildProofDigest([
    clientRuntime.sessionId || 'no-session',
    clientRuntime.requestId || 'no-request',
    command.commandId,
    nextCursor,
    nextActionState.status,
    hostedKernelProjection.commandStatus,
    clientRuntime.productWorkflow.stateKey
  ]);
  const acceptanceRequired = hostedKernelProjection.commitDecision !== 'read_only'
    && !hostedKernelProjection.mutationBlocked
    && !hostedKernelProjection.lifecycleBlocked;
  const expectedAcceptanceToken = acceptanceRequired
    ? buildProofDigest([expectedHandoffToken, command.idempotencyKey, hostedKernelProjection.commandStatus])
    : null;
  const submittedToken = clientRuntime.pendingAcceptanceToken;
  const cursorKnown = Boolean(clientRuntime.lastSeenCursor);
  const cursorMatches = cursorKnown && clientRuntime.lastSeenCursor === nextCursor;
  const staleCursor = cursorKnown && !cursorMatches;
  const tokenState = !acceptanceRequired
    ? 'not_required'
    : !submittedToken
      ? 'missing'
      : submittedToken === expectedAcceptanceToken
        ? 'accepted'
        : 'stale_or_mismatched';
  const resumeState = staleCursor
    ? 'refresh_required'
    : tokenState === 'accepted'
      ? 'acceptance_confirmed'
      : acceptanceRequired
        ? 'awaiting_acceptance'
        : 'resume_ready';
  const continuationState = clientRuntime.continuationState
    || (submittedToken
      ? 'submitted'
      : clientRuntime.dirtyFields.length > 0
        ? 'draft'
        : 'previewed');

  return {
    schemaVersion: 'volatile-fact-check.client-continuation-state.v1',
    generatedAt: now,
    continuationState,
    resumeState,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    traceId: clientRuntime.traceId,
    sourceRouteKey: clientRuntime.routeKey,
    productWorkflow: clientRuntime.productWorkflow,
    cursor: {
      lastSeen: clientRuntime.lastSeenCursor,
      expected: nextCursor,
      known: cursorKnown,
      matches: cursorMatches,
      stale: staleCursor
    },
    acceptance: {
      required: acceptanceRequired,
      submitted: Boolean(submittedToken),
      tokenState,
      expectedToken: expectedAcceptanceToken,
      submittedToken: submittedToken || null
    },
    guards: {
      refreshBeforeAccept: staleCursor,
      preserveDirtyDraft: clientRuntime.dirtyFields.length > 0 && tokenState !== 'accepted',
      canSubmitAcceptance: acceptanceRequired
        && !staleCursor
        && tokenState !== 'stale_or_mismatched'
        && clientRuntime.productWorkflow.valid,
      canHydrateFromCursor: Boolean(nextCursor)
    },
    handoffToken: expectedHandoffToken
  };
}

function buildClientWorkflowHandoff({ now, clientRuntime, scope, boundary, health, validation, command, recovery, hostedKernelProjection, lifecycleSettings, nextActionState, providerServiceContract }) {
  const hasBlockingValidation = validation.errors.length > 0 || boundary.failures.length > 0;
  const productWorkflowBlocked = clientRuntime.productWorkflow.validation.length > 0;
  const dependencyBlocked = nextActionState.status === 'wait_for_dependency_recovery';
  const routeName = hasBlockingValidation || productWorkflowBlocked
    ? 'repair'
    : dependencyBlocked
      ? 'dependencyWait'
      : nextActionState.status === 'apply_lifecycle_command'
        ? 'lifecycle'
        : nextActionState.status === 'run_scheduled_fact_check'
          ? 'scheduledRun'
          : hostedKernelProjection.commitDecision === 'read_only'
            ? 'review'
            : 'accept';
  const destinationRoute = CLIENT_WORKFLOW_ROUTES[routeName];
  const canResume = Boolean(clientRuntime.sessionId || clientRuntime.requestId || clientRuntime.lastSeenCursor);
  const continuation = providerServiceContract.clientRuntime.continuation;
  const handoffToken = continuation.handoffToken;
  const primaryAction = hasBlockingValidation
    ? 'edit_request'
    : productWorkflowBlocked
      ? 'repair_product_workflow_context'
    : dependencyBlocked
      ? 'wait_for_dependency_recovery'
      : routeName === 'lifecycle'
        ? 'apply_lifecycle_command'
        : routeName === 'scheduledRun'
          ? 'start_scheduled_fact_check'
          : hostedKernelProjection.commitDecision === 'read_only'
            ? 'review_fact_state'
            : 'accept_kernel_projection';

  return {
    schemaVersion: 'volatile-fact-check.client-workflow-handoff.v1',
    generatedAt: now,
    sourceRouteKey: clientRuntime.routeKey,
    destinationRoute,
    routeName,
    resume: {
      canResume,
      sessionId: clientRuntime.sessionId,
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      returnTo: clientRuntime.returnTo,
      lastSeenCursor: clientRuntime.lastSeenCursor,
      nextCursor: providerServiceContract.sync.nextCursor,
      handoffToken,
      continuationState: continuation.continuationState,
      resumeState: continuation.resumeState
    },
    uiStatePatch: {
      activePanel: hasBlockingValidation
        ? 'issues'
        : routeName === 'dependencyWait'
          ? 'dependencies'
          : routeName === 'lifecycle'
            ? 'lifecycle'
            : 'summary',
      viewMode: clientRuntime.viewMode,
      selectedFactIds: scope.factId ? uniqueTextList([scope.factId, ...clientRuntime.selectedFactIds]) : clientRuntime.selectedFactIds,
      dirtyFields: hasBlockingValidation ? clientRuntime.dirtyFields : [],
      banner: nextActionState.primaryReason || null,
      retryAfterMs: nextActionState.retryAfterMs,
      productWorkflow: {
        provider: clientRuntime.productWorkflow.provider,
        stage: clientRuntime.productWorkflow.stage,
        workflowId: clientRuntime.productWorkflow.workflowId,
        campaignId: clientRuntime.productWorkflow.campaignId,
        audienceId: clientRuntime.productWorkflow.audienceId,
        segmentId: clientRuntime.productWorkflow.segmentId,
        stateKey: clientRuntime.productWorkflow.stateKey,
        validation: clientRuntime.productWorkflow.validation
      }
    },
    primaryAction: {
      type: primaryAction,
      enabled: !hasBlockingValidation
        && !productWorkflowBlocked
        && !dependencyBlocked
        && !continuation.guards.refreshBeforeAccept,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      providerCursor: providerServiceContract.sync.nextCursor,
      requiresAcceptanceToken: routeName === 'accept',
      acknowledgementToken: routeName === 'accept' ? continuation.acceptance.expectedToken : null
    },
    workflowGuards: {
      permissionDenied: !boundary.allowed,
      validationBlocked: validation.errors.length > 0,
      productWorkflowBlocked,
      productWorkflowValidation: clientRuntime.productWorkflow.validation,
      dependencyBlocked,
      restartUnsafe: !recovery.restartSafe,
      lifecycleStatus: lifecycleSettings.status,
      externalHandoffState: providerServiceContract.externalHandoff.state,
      staleClientCursor: continuation.cursor.stale,
      acceptanceTokenState: continuation.acceptance.tokenState,
      preserveDirtyDraft: continuation.guards.preserveDirtyDraft
    },
    productWorkflow: clientRuntime.productWorkflow
  };
}

function normalizeProviderRequest(input) {
  const provider = input.provider && typeof input.provider === 'object'
    ? input.provider
    : input.serviceProvider && typeof input.serviceProvider === 'object'
      ? input.serviceProvider
      : {};
  const requestedCapabilities = uniqueTextList(
    provider.requestedCapabilities
      || provider.capabilities
      || input.requestedCapabilities
      || input.consumerCapabilities
  );
  const externalHandoff = provider.externalHandoff && typeof provider.externalHandoff === 'object'
    ? provider.externalHandoff
    : input.externalHandoff && typeof input.externalHandoff === 'object'
      ? input.externalHandoff
      : {};
  const handoffState = externalHandoff.state && typeof externalHandoff.state === 'object'
    ? externalHandoff.state
    : externalHandoff.handoffState && typeof externalHandoff.handoffState === 'object'
      ? externalHandoff.handoffState
      : provider.handoffState && typeof provider.handoffState === 'object'
        ? provider.handoffState
        : {};
  const rawDeliveryState = asText(handoffState.deliveryState || handoffState.status);
  const deliveryState = ['idle', 'pending', 'dispatched', 'acknowledged', 'failed', 'dead_letter'].includes(rawDeliveryState)
    ? rawDeliveryState
    : 'idle';
  const rawAttemptCount = finiteNonNegativeNumber(handoffState.attemptCount || handoffState.attempts, 0);
  const requiredCapabilities = uniqueTextList(provider.requiredCapabilities || input.requiredCapabilities);

  return {
    providerId: asText(provider.providerId) || asText(provider.id) || 'hosted-kernel',
    consumerId: asText(provider.consumerId) || asText(input.consumerId) || null,
    protocol: ['in_process', 'kernel_bus', 'http_callback', 'event_stream'].includes(asText(provider.protocol))
      ? asText(provider.protocol)
      : 'kernel_bus',
    requestedCapabilities: requestedCapabilities.length > 0 ? requestedCapabilities : SUPPORTED_PROVIDER_CAPABILITIES,
    requiredCapabilities,
    contractVersion: CURRENT_PROVIDER_CONTRACT_VERSION,
    minContractVersion: asText(provider.minContractVersion) || null,
    maxContractVersion: asText(provider.maxContractVersion) || null,
    consumerContractVersion: asText(provider.contractVersion || provider.consumerContractVersion) || null,
    providerInstanceId: asText(provider.instanceId) || asText(provider.providerInstanceId) || null,
    serviceRegion: asText(provider.region || provider.serviceRegion) || null,
    syncCursor: asText(provider.syncCursor) || asText(input.syncCursor) || null,
    ackCursor: asText(provider.ackCursor) || asText(input.ackCursor) || null,
    externalHandoff: {
      enabled: externalHandoff.enabled === true || Boolean(asText(externalHandoff.endpoint || provider.callbackUrl)),
      target: asText(externalHandoff.target) || asText(externalHandoff.endpoint) || asText(provider.callbackUrl) || null,
      deliveryMode: ['sync', 'async', 'outbox'].includes(asText(externalHandoff.deliveryMode))
        ? asText(externalHandoff.deliveryMode)
        : 'outbox',
      requiresAck: externalHandoff.requiresAck === false ? false : true,
      ackDeadlineAt: asText(externalHandoff.ackDeadlineAt || handoffState.ackDeadlineAt) || null,
      lastAttemptAt: asText(handoffState.lastAttemptAt || externalHandoff.lastAttemptAt) || null,
      lastAckAt: asText(handoffState.lastAckAt || externalHandoff.lastAckAt) || null,
      lastError: asText(handoffState.lastError || externalHandoff.lastError) || null,
      deliveryState,
      attemptCount: Math.max(0, Math.min(MAX_EXTERNAL_HANDOFF_ATTEMPTS, Math.trunc(rawAttemptCount))),
      maxAttempts: Math.max(1, Math.min(MAX_EXTERNAL_HANDOFF_ATTEMPTS, Math.trunc(finitePositiveNumber(externalHandoff.maxAttempts, MAX_EXTERNAL_HANDOFF_ATTEMPTS)))),
      deadLetterReason: asText(handoffState.deadLetterReason || externalHandoff.deadLetterReason) || null,
      providerMessageId: asText(handoffState.providerMessageId || externalHandoff.providerMessageId) || null
    }
  };
}

function parseContractVersion(value) {
  const [majorText, minorText = '0'] = asText(value).split('.');
  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt(minorText, 10);
  if (!Number.isInteger(major) || major < 0 || !Number.isInteger(minor) || minor < 0) return null;
  return { major, minor, normalized: `${major}.${minor}` };
}

function compareContractVersions(left, right) {
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  return 0;
}

function buildProviderCompatibility({ providerRequest, decisions }) {
  const current = parseContractVersion(providerRequest.contractVersion);
  const min = parseContractVersion(providerRequest.minContractVersion);
  const max = parseContractVersion(providerRequest.maxContractVersion);
  const consumer = parseContractVersion(providerRequest.consumerContractVersion);
  const unsupportedRequired = providerRequest.requiredCapabilities
    .filter((capability) => !SUPPORTED_PROVIDER_CAPABILITIES.includes(capability));
  const deferredRequired = decisions
    .filter((decision) => !decision.granted && providerRequest.requiredCapabilities.includes(decision.capability));
  const versionFailures = [
    min && compareContractVersions(current, min) < 0
      ? `provider requires contract >= ${min.normalized}`
      : null,
    max && compareContractVersions(current, max) > 0
      ? `provider supports contract <= ${max.normalized}`
      : null,
    consumer && consumer.major !== current.major
      ? `consumer contract major ${consumer.major} is incompatible with hosted contract major ${current.major}`
      : null,
    providerRequest.minContractVersion && !min
      ? `minContractVersion ${providerRequest.minContractVersion} is not parseable`
      : null,
    providerRequest.maxContractVersion && !max
      ? `maxContractVersion ${providerRequest.maxContractVersion} is not parseable`
      : null,
    providerRequest.consumerContractVersion && !consumer
      ? `consumer contractVersion ${providerRequest.consumerContractVersion} is not parseable`
      : null
  ].filter(Boolean);
  const capabilityFailures = [
    ...unsupportedRequired.map((capability) => `${capability}: unsupported_required_capability`),
    ...deferredRequired.map((decision) => `${decision.capability}: required capability deferred because ${decision.reason}`)
  ];
  const compatible = versionFailures.length === 0 && capabilityFailures.length === 0;

  return {
    schemaVersion: 'volatile-fact-check.provider-compatibility.v1',
    hostedContractVersion: providerRequest.contractVersion,
    minContractVersion: providerRequest.minContractVersion,
    maxContractVersion: providerRequest.maxContractVersion,
    consumerContractVersion: providerRequest.consumerContractVersion,
    compatible,
    mode: compatible ? 'compatible' : 'incompatible',
    requiredCapabilities: providerRequest.requiredCapabilities,
    unsupportedRequiredCapabilities: unsupportedRequired,
    deferredRequiredCapabilities: deferredRequired,
    failures: [...versionFailures, ...capabilityFailures],
    providerIdentity: {
      providerId: providerRequest.providerId,
      consumerId: providerRequest.consumerId,
      providerInstanceId: providerRequest.providerInstanceId,
      serviceRegion: providerRequest.serviceRegion,
      protocol: providerRequest.protocol
    }
  };
}

function buildProviderSyncReceipt({ now, providerRequest, compatibility, nextCursor, command, evidenceProof, recovery, hostedKernelProjection, externalDispatch }) {
  const cursorAdvanced = Boolean(nextCursor && nextCursor !== providerRequest.syncCursor);
  const ackConflict = Boolean(
    providerRequest.ackCursor
    && providerRequest.syncCursor
    && providerRequest.ackCursor !== providerRequest.syncCursor
    && providerRequest.ackCursor !== nextCursor
  );
  const receiptStatus = !compatibility.compatible
    ? 'contract_rejected'
    : ackConflict
      ? 'ack_cursor_conflict'
      : recovery.replay
        ? 'idempotent_replay'
        : cursorAdvanced
          ? 'cursor_advanced'
          : 'cursor_unchanged';

  return {
    schemaVersion: 'volatile-fact-check.provider-sync-receipt.v1',
    generatedAt: now,
    receiptId: buildProofDigest([
      'provider-sync-receipt',
      providerRequest.providerId,
      providerRequest.consumerId || 'unbound-consumer',
      command.commandId,
      nextCursor,
      receiptStatus
    ]),
    status: receiptStatus,
    accepted: compatibility.compatible && !ackConflict,
    providerId: providerRequest.providerId,
    consumerId: providerRequest.consumerId,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    previousCursor: providerRequest.syncCursor,
    acknowledgedCursor: providerRequest.ackCursor,
    nextCursor,
    cursorAdvanced,
    ackConflict,
    stateVersion: evidenceProof.proofDigest,
    commandStatus: hostedKernelProjection.commandStatus,
    commitDecision: hostedKernelProjection.commitDecision,
    recoveryMode: recovery.recoveryMode,
    replay: recovery.replay,
    externalDispatchId: externalDispatch.dispatchId,
    externalDeliveryAction: externalDispatch.nextDeliveryAction,
    warnings: [
      ackConflict ? 'ackCursor does not match the previous or next provider cursor' : null,
      externalDispatch.acknowledgement.overdue ? 'external acknowledgement deadline is overdue' : null,
      externalDispatch.deadLetter.active ? 'external handoff is in dead-letter state' : null
    ].filter(Boolean)
  };
}

function capabilityDecision({ capability, boundary, health, validation, command, lifecycleCommand, hostedKernelProjection }) {
  const dependencyStatus = (name) => health.dependencies.find((dependency) => dependency.name === name)?.effectiveStatus || 'unknown';
  if (!SUPPORTED_PROVIDER_CAPABILITIES.includes(capability)) {
    return { capability, granted: false, reason: 'unsupported_capability', requiredDependencies: [] };
  }
  if (!boundary.allowed) {
    return { capability, granted: false, reason: 'boundary_denied', requiredDependencies: [] };
  }
  if (capability === 'volatile_fact.read') {
    return { capability, granted: true, reason: 'read_contract_ready', requiredDependencies: ['volatileStore'] };
  }
  if (capability === 'volatile_fact.mutate') {
    const granted = boundary.permissions.canWrite && command.mutation && validation.valid && health.allowMutation && !hostedKernelProjection.mutationBlocked;
    return {
      capability,
      granted,
      reason: granted ? hostedKernelProjection.commitDecision : 'mutation_not_commit_ready',
      requiredDependencies: ['volatileStore', 'evidenceIndex', inputRequiresAudit(command.action) ? 'auditSink' : null].filter(Boolean)
    };
  }
  if (capability === 'volatile_fact.lifecycle_control') {
    const granted = boundary.permissions.canWrite && lifecycleCommand.active && !hostedKernelProjection.lifecycleBlocked;
    return {
      capability,
      granted,
      reason: granted ? hostedKernelProjection.lifecycleDecision : 'lifecycle_command_not_ready',
      requiredDependencies: lifecycleCommand.active && dependencyStatus('auditSink') === 'down' ? ['auditSink'] : []
    };
  }
  if (capability === 'volatile_fact.audit_handoff') {
    const granted = boundary.permissions.canAudit && dependencyStatus('auditSink') !== 'down';
    return {
      capability,
      granted,
      reason: granted ? 'audit_handoff_ready' : 'audit_handoff_unavailable',
      requiredDependencies: ['auditSink']
    };
  }
  if (capability === 'volatile_fact.export_summary') {
    return { capability, granted: validation.errors.length === 0, reason: validation.errors.length === 0 ? 'export_ready' : 'export_blocked_by_validation', requiredDependencies: [] };
  }
  return { capability, granted: true, reason: 'sync_cursor_ready', requiredDependencies: ['volatileStore'] };
}

function buildExternalHandoffDispatchPlan({ now, providerRequest, handoffBlockedReasons, acceptedCapabilities, command, evidenceProof, hostedKernelProjection, auditHandoff, nextCursor }) {
  const handoff = providerRequest.externalHandoff;
  const hasPayload = Boolean(hostedKernelProjection.writeSet || hostedKernelProjection.lifecycleWriteSet || hostedKernelProjection.journalAppend);
  const ackDeadlineMs = parseTimestampMs(handoff.ackDeadlineAt);
  const nowMs = parseTimestampMs(now);
  const ackOutstanding = handoff.enabled
    && handoff.requiresAck
    && !handoff.lastAckAt
    && ['pending', 'dispatched', 'failed'].includes(handoff.deliveryState);
  const ackOverdue = ackOutstanding && ackDeadlineMs !== null && nowMs !== null && ackDeadlineMs <= nowMs;
  const attemptsRemaining = Math.max(0, handoff.maxAttempts - handoff.attemptCount);
  const deadLetter = handoff.deliveryState === 'dead_letter'
    || (handoff.enabled && handoff.attemptCount >= handoff.maxAttempts && handoff.deliveryState !== 'acknowledged');
  const ready = handoff.enabled && handoffBlockedReasons.length === 0 && hasPayload && !deadLetter;
  const dispatchId = handoff.enabled
    ? buildProofDigest([providerRequest.providerId, providerRequest.consumerId || 'unbound-consumer', command.commandId, evidenceProof.proofDigest, nextCursor])
    : null;
  const payloadKinds = [
    hostedKernelProjection.writeSet ? 'fact_write_set' : null,
    hostedKernelProjection.lifecycleWriteSet ? 'lifecycle_write_set' : null,
    hostedKernelProjection.journalAppend ? 'journal_append' : null,
    acceptedCapabilities.includes('volatile_fact.audit_handoff') ? 'audit_handoff' : null
  ].filter(Boolean);
  const nextDeliveryAction = !handoff.enabled
    ? 'none'
    : handoffBlockedReasons.length > 0
      ? 'fix_contract'
      : !hasPayload
        ? 'record_noop_cursor'
        : deadLetter
          ? 'move_to_dead_letter'
          : handoff.deliveryState === 'acknowledged'
            ? 'none'
            : ackOverdue || handoff.deliveryState === 'failed'
              ? 'retry_dispatch'
              : handoff.deliveryState === 'dispatched' && handoff.requiresAck
                ? 'await_ack'
                : 'dispatch';

  return {
    schemaVersion: 'volatile-fact-check.external-handoff-dispatch.v1',
    enabled: handoff.enabled,
    ready,
    dispatchId,
    outboxKey: dispatchId ? `volatile-fact-check:${command.scopeKey}:${dispatchId}` : null,
    deliveryMode: handoff.deliveryMode,
    protocol: providerRequest.protocol,
    target: handoff.target,
    nextDeliveryAction,
    payloadKinds,
    attempts: {
      count: handoff.attemptCount,
      max: handoff.maxAttempts,
      remaining: attemptsRemaining,
      lastAttemptAt: handoff.lastAttemptAt,
      lastError: handoff.lastError
    },
    acknowledgement: {
      required: handoff.requiresAck,
      providerMessageId: handoff.providerMessageId,
      lastAckAt: handoff.lastAckAt,
      ackDeadlineAt: handoff.ackDeadlineAt,
      outstanding: ackOutstanding,
      overdue: ackOverdue,
      ackCursorMatched: Boolean(providerRequest.ackCursor && providerRequest.ackCursor === nextCursor)
    },
    deadLetter: {
      active: deadLetter,
      reason: handoff.deadLetterReason || (deadLetter ? 'external handoff exhausted retry budget before acknowledgement' : null)
    },
    payloadPreview: {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandStatus: hostedKernelProjection.commandStatus,
      proofDigest: evidenceProof.proofDigest,
      auditEventType: auditHandoff.eventType,
      productWorkflowStateKey: providerRequest.productWorkflow.stateKey,
      productWorkflowProvider: providerRequest.productWorkflow.provider,
      productWorkflowStage: providerRequest.productWorkflow.stage
    }
  };
}

function buildProviderServiceContract({ input, now, scope, boundary, health, validation, command, evidenceProof, recovery, hostedKernelProjection, lifecycleCommand, nextActionState, auditHandoff, clientRuntime }) {
  const providerRequest = normalizeProviderRequest(input);
  providerRequest.productWorkflow = clientRuntime.productWorkflow;
  const negotiatedCapabilities = uniqueTextList([
    ...providerRequest.requestedCapabilities,
    ...providerRequest.requiredCapabilities
  ]);
  const decisions = negotiatedCapabilities.map((capability) => capabilityDecision({
    capability,
    boundary,
    health,
    validation,
    command,
    lifecycleCommand,
    hostedKernelProjection
  }));
  const acceptedCapabilities = decisions.filter((decision) => decision.granted).map((decision) => decision.capability);
  const deferredCapabilities = decisions.filter((decision) => !decision.granted);
  const compatibility = buildProviderCompatibility({ providerRequest, decisions });
  const nextCursorParts = [
    providerRequest.providerId,
    command.scopeKey,
    command.commandId,
    evidenceProof.proofDigest,
    hostedKernelProjection.commandStatus,
    nextActionState.status
  ];
  const nextCursor = buildProofDigest(nextCursorParts);
  const ackCursorConflict = Boolean(
    providerRequest.ackCursor
    && providerRequest.syncCursor
    && providerRequest.ackCursor !== providerRequest.syncCursor
    && providerRequest.ackCursor !== nextCursor
  );
  const clientContinuation = buildClientContinuationState({
    now,
    clientRuntime,
    command,
    nextCursor,
    nextActionState,
    hostedKernelProjection
  });
  const handoffBlockedReasons = [
    ...deferredCapabilities.map((decision) => `${decision.capability}: ${decision.reason}`),
    ...compatibility.failures.map((failure) => `provider contract: ${failure}`),
    ackCursorConflict
      ? 'provider ackCursor does not match previous or next sync cursor'
      : null,
    providerRequest.externalHandoff.enabled && !providerRequest.externalHandoff.target
      ? 'external handoff requires a target endpoint or callbackUrl'
      : null,
    providerRequest.externalHandoff.enabled && providerRequest.externalHandoff.deliveryMode === 'sync' && providerRequest.protocol === 'event_stream'
      ? 'sync external handoff is not compatible with event_stream protocol'
      : null,
    providerRequest.externalHandoff.enabled && providerRequest.externalHandoff.deliveryState === 'dead_letter'
      ? 'external handoff is already in dead-letter state'
      : null,
    ...providerRequest.productWorkflow.validation.map((issue) => `product workflow handoff blocked: ${issue}`)
  ].filter(Boolean);
  const externalDispatch = buildExternalHandoffDispatchPlan({
    now,
    providerRequest,
    handoffBlockedReasons,
    acceptedCapabilities,
    command,
    evidenceProof,
    hostedKernelProjection,
    auditHandoff,
    nextCursor
  });
  const syncReceipt = buildProviderSyncReceipt({
    now,
    providerRequest,
    compatibility,
    nextCursor,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection,
    externalDispatch
  });

  return {
    schemaVersion: PROVIDER_CONTRACT_SCHEMA,
    generatedAt: now,
    providerId: providerRequest.providerId,
    consumerId: providerRequest.consumerId,
    protocol: providerRequest.protocol,
    scopeKey: buildScopeKey(scope),
    contractVersion: providerRequest.contractVersion,
    minContractVersion: providerRequest.minContractVersion,
    maxContractVersion: providerRequest.maxContractVersion,
    consumerContractVersion: providerRequest.consumerContractVersion,
    providerInstanceId: providerRequest.providerInstanceId,
    serviceRegion: providerRequest.serviceRegion,
    clientRuntime: {
      schemaVersion: clientRuntime.schemaVersion,
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      traceId: clientRuntime.traceId,
      routeKey: clientRuntime.routeKey,
      viewMode: clientRuntime.viewMode,
      activePanel: clientRuntime.activePanel,
      lastSeenCursor: clientRuntime.lastSeenCursor,
      continuationState: clientRuntime.continuationState,
      selectedFactIds: clientRuntime.selectedFactIds,
      clientCapabilities: clientRuntime.clientCapabilities,
      productWorkflow: clientRuntime.productWorkflow,
      continuation: clientContinuation
    },
    capabilityNegotiation: {
      requested: providerRequest.requestedCapabilities,
      required: providerRequest.requiredCapabilities,
      evaluated: negotiatedCapabilities,
      supported: SUPPORTED_PROVIDER_CAPABILITIES,
      accepted: acceptedCapabilities,
      deferred: deferredCapabilities,
      compatibility,
      mode: !compatibility.compatible
        ? 'incompatible_provider_contract'
        : deferredCapabilities.length === 0
          ? 'all_requested_capabilities_granted'
          : 'partial_capability_contract'
    },
    sync: {
      cursorSchema: 'volatile-fact-check.sync-cursor.v1',
      previousCursor: providerRequest.syncCursor,
      ackCursor: providerRequest.ackCursor,
      nextCursor,
      journalCursor: hostedKernelProjection.journalAppend ? nextCursor : providerRequest.syncCursor,
      stateVersion: evidenceProof.proofDigest,
      receipt: syncReceipt,
      receiptStatus: syncReceipt.status,
      ackCursorConflict: syncReceipt.ackConflict,
      restartSafe: recovery.restartSafe,
      replay: recovery.replay,
      commandStatus: hostedKernelProjection.commandStatus,
      nextActionStatus: nextActionState.status,
      externalAckRequired: externalDispatch.acknowledgement.required,
      externalAckOutstanding: externalDispatch.acknowledgement.outstanding,
      externalAckOverdue: externalDispatch.acknowledgement.overdue
    },
    externalHandoff: {
      enabled: providerRequest.externalHandoff.enabled,
      state: !providerRequest.externalHandoff.enabled
        ? 'not_requested'
        : handoffBlockedReasons.length > 0
          ? 'blocked'
          : hostedKernelProjection.journalAppend || hostedKernelProjection.lifecycleWriteSet
            ? 'ready_to_dispatch'
            : 'ready_noop',
      deliveryMode: providerRequest.externalHandoff.deliveryMode,
      target: providerRequest.externalHandoff.target,
      requiresAck: providerRequest.externalHandoff.requiresAck,
      handoffId: externalDispatch.dispatchId,
      payloadKinds: externalDispatch.payloadKinds,
      blockedReasons: handoffBlockedReasons,
      auditEventType: auditHandoff.eventType,
      deliveryState: providerRequest.externalHandoff.deliveryState,
      syncReceiptId: syncReceipt.receiptId,
      productWorkflow: {
        provider: providerRequest.productWorkflow.provider,
        stage: providerRequest.productWorkflow.stage,
        workflowId: providerRequest.productWorkflow.workflowId,
        campaignId: providerRequest.productWorkflow.campaignId,
        audienceId: providerRequest.productWorkflow.audienceId,
        segmentId: providerRequest.productWorkflow.segmentId,
        stateKey: providerRequest.productWorkflow.stateKey,
        validation: providerRequest.productWorkflow.validation,
        proofDigest: providerRequest.productWorkflow.proofDigest
      },
      dispatch: externalDispatch
    }
  };
}

function highestIncidentSeverity(incidents) {
  if (incidents.some((incident) => incident.severity === 'error')) return 'error';
  if (incidents.some((incident) => incident.severity === 'warning')) return 'warning';
  return 'info';
}

function buildOperationalIncidentReport({ now, boundary, health, validation, recovery, hostedKernelProjection, nextActionState, providerServiceContract }) {
  const incidents = [];
  const retryAttempt = health.retryPlan.attempts[0] || null;

  for (const dependency of health.dependencies) {
    const status = dependency.effectiveStatus || dependency.status;
    if (!dependency.required || status === 'ok') continue;
    incidents.push({
      incidentId: buildProofDigest(['dependency', dependency.name, status, dependency.failureState, dependency.checkedAt || now]),
      source: 'dependency_health',
      severity: status === 'down' || dependency.circuitOpen ? 'error' : 'warning',
      status,
      dependency: dependency.name,
      failureState: dependency.failureState,
      retryable: dependency.retryable && !dependency.circuitOpen,
      nextRetryAfterMs: dependency.backoffRemainingMs > 0
        ? dependency.backoffRemainingMs
        : dependency.retryable && retryAttempt
          ? retryAttempt.retryAfterMs
          : 0,
      operatorAction: dependency.circuitOpen
        ? `Reset ${dependency.name} circuit after a successful dependency health probe.`
        : dependency.observationStale
          ? `Refresh ${dependency.name} health observation before accepting writes.`
          : dependency.backoffRemainingMs > 0
            ? `Wait for the ${dependency.name} retry window, then re-probe before admitting writes.`
          : dependency.retryable
            ? `Retry ${dependency.name} check with configured backoff.`
            : `Inspect ${dependency.name} configuration and credentials before retrying.`,
      evidence: {
        checkedAt: dependency.checkedAt,
        lastAttemptAt: dependency.lastAttemptAt,
        nextRetryAt: dependency.nextRetryAt,
        observedAgeMs: dependency.observedAgeMs,
        retryWindowState: dependency.retryWindowState,
        backoffRemainingMs: dependency.backoffRemainingMs,
        backoffUntilMs: dependency.backoffUntilMs,
        consecutiveFailures: dependency.consecutiveFailures,
        lastError: dependency.lastError
      }
    });
  }

  if (!boundary.allowed) {
    incidents.push({
      incidentId: buildProofDigest(['boundary', boundary.action, boundary.workspaceScopeProof.proofDigest, ...boundary.failures]),
      source: 'permission_boundary',
      severity: 'error',
      status: 'denied',
      dependency: null,
      failureState: 'access_denied',
      retryable: false,
      nextRetryAfterMs: 0,
      operatorAction: 'Correct tenant, workspace, namespace, principal role, or scoped permission grant before retrying.',
      evidence: {
        failures: boundary.failures,
        workspaceAccess: boundary.permissionProof.workspaceAccess,
        matchingGrantIds: boundary.permissionProof.matchingGrantIds,
        workspaceScopeProof: {
          bindingMode: boundary.workspaceScopeProof.bindingMode,
          activeBindingId: boundary.workspaceScopeProof.activeBindingId,
          blockedBindings: boundary.workspaceScopeProof.blockedBindings,
          proofDigest: boundary.workspaceScopeProof.proofDigest
        }
      }
    });
  }

  if (validation.errors.length > 0) {
    incidents.push({
      incidentId: buildProofDigest(['validation', ...validation.errors.map((issue) => issue.code)]),
      source: 'payload_validation',
      severity: 'error',
      status: 'invalid',
      dependency: null,
      failureState: 'request_contract_failed',
      retryable: false,
      nextRetryAfterMs: 0,
      operatorAction: validation.errors[0].action,
      evidence: {
        errorCodes: validation.errors.map((issue) => issue.code),
        warningCodes: validation.warnings.map((issue) => issue.code)
      }
    });
  }

  if (!recovery.restartSafe) {
    incidents.push({
      incidentId: buildProofDigest(['recovery', recovery.recoveryMode, hostedKernelProjection.commandStatus]),
      source: 'restart_recovery',
      severity: 'error',
      status: recovery.recoveryMode,
      dependency: null,
      failureState: 'restart_unsafe',
      retryable: health.retryPlan.enabled,
      nextRetryAfterMs: retryAttempt ? retryAttempt.retryAfterMs : 0,
      operatorAction: recovery.pendingRecoveryReasons[0] || 'Resolve pending recovery blockers before committing this volatile fact command.',
      evidence: {
        activeFact: recovery.activeFact,
        previousCommand: recovery.previousCommand,
        pendingRecoveryReasons: recovery.pendingRecoveryReasons
      }
    });
  }

  const externalState = providerServiceContract.externalHandoff.state;
  const dispatch = providerServiceContract.externalHandoff.dispatch;
  if (externalState === 'blocked' || dispatch.acknowledgement.overdue || dispatch.deadLetter.active) {
    incidents.push({
      incidentId: buildProofDigest(['external-handoff', externalState, dispatch.nextDeliveryAction, dispatch.dispatchId || 'no-dispatch']),
      source: 'external_handoff',
      severity: dispatch.deadLetter.active || externalState === 'blocked' ? 'error' : 'warning',
      status: dispatch.deadLetter.active ? 'dead_letter' : externalState,
      dependency: 'auditSink',
      failureState: dispatch.deadLetter.active
        ? 'handoff_dead_letter'
        : dispatch.acknowledgement.overdue
          ? 'ack_overdue'
          : 'contract_blocked',
      retryable: dispatch.nextDeliveryAction === 'retry_dispatch',
      nextRetryAfterMs: dispatch.nextDeliveryAction === 'retry_dispatch' ? health.retryPlan.policy.baseDelayMs : 0,
      operatorAction: dispatch.deadLetter.active
        ? 'Inspect the dead-letter reason and replay the external handoff from the outbox after repair.'
        : dispatch.acknowledgement.overdue
          ? 'Retry or reconcile the external handoff acknowledgement cursor.'
          : 'Fix provider capability negotiation or external handoff target before dispatch.',
      evidence: {
        blockedReasons: providerServiceContract.externalHandoff.blockedReasons,
        nextDeliveryAction: dispatch.nextDeliveryAction,
        attempts: dispatch.attempts,
        acknowledgement: dispatch.acknowledgement,
        deadLetter: dispatch.deadLetter
      }
    });
  }

  const severity = highestIncidentSeverity(incidents);
  const mutationSafeMode = hostedKernelProjection.mutationBlocked
    ? 'blocked'
    : health.degradedMode
      ? 'read_only_or_degraded'
      : 'normal';

  return {
    schemaVersion: 'volatile-fact-check.operational-incident-report.v1',
    generatedAt: now,
    state: incidents.length === 0 ? 'clear' : 'active',
    severity,
    safeMode: mutationSafeMode,
    nextActionStatus: nextActionState.status,
    incidentCount: incidents.length,
    retryGate: {
      enabled: health.retryPlan.enabled,
      nextRetryAfterMs: retryAttempt ? retryAttempt.retryAfterMs : 0,
      retryableDependencies: retryAttempt ? retryAttempt.retryableDependencies : [],
      blockedByCircuitBreaker: health.retryPlan.blockedByCircuitBreaker,
      staleDependencyObservations: health.retryPlan.staleDependencyObservations,
      activeBackoffDependencies: health.retryPlan.activeBackoffDependencies,
      nextRetryWindowMs: health.retryPlan.nextRetryAfterMs
    },
    escalation: {
      required: severity === 'error' || dispatch.deadLetter.active,
      route: severity === 'error' ? CLIENT_WORKFLOW_ROUTES.dependencyWait : CLIENT_WORKFLOW_ROUTES.review,
      owner: severity === 'error' ? 'kernel-operator' : 'workflow-client',
      reason: incidents[0]?.operatorAction || null
    },
    incidents
  };
}

function countBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = asText(selector(item)) || 'unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function buildAnalyticsCounters({ boundary, health, validation, evidence, evidenceProof, persistedState, command, recovery, hostedKernelProjection, lifecycleSettings, lifecycleCommand, nextActionState }) {
  const persistedFactStatusCounts = countBy(persistedState.facts, (fact) => fact.status);
  const commandStatusCounts = countBy(persistedState.commandLedger, (entry) => entry.status);
  const evidenceStanceCounts = countBy(evidence, (entry) => entry.stance);
  const dependencyStatusCounts = countBy(health.dependencies, (dependency) => dependency.effectiveStatus || dependency.status);
  const mutationAccepted = command.mutation && hostedKernelProjection.commitDecision !== 'blocked';

  return {
    schemaVersion: 'volatile-fact-check.analytics-counters.v1',
    requests: {
      current: 1,
      allowed: boundary.allowed ? 1 : 0,
      denied: boundary.allowed ? 0 : 1,
      mutationRequested: command.mutation ? 1 : 0,
      mutationAccepted: mutationAccepted ? 1 : 0,
      mutationBlocked: command.mutation && !mutationAccepted ? 1 : 0,
      readOnly: command.mutation ? 0 : 1
    },
    persistedFacts: {
      total: persistedState.facts.length,
      byStatus: persistedFactStatusCounts,
      recoverable: persistedState.facts.filter((fact) => RECOVERABLE_FACT_STATUSES.has(fact.status)).length,
      terminal: persistedState.facts.filter((fact) => ['accepted', 'corrected', 'invalidated', 'rejected'].includes(fact.status)).length
    },
    commandLedger: {
      total: persistedState.commandLedger.length,
      byStatus: commandStatusCounts,
      replayable: persistedState.commandLedger.filter((entry) => entry.replayable).length,
      active: persistedState.commandLedger.filter((entry) => !entry.replayable).length
    },
    evidence: {
      total: evidence.length,
      byStance: evidenceStanceCounts,
      sourceCount: evidenceProof.sourceCount,
      contradictionCount: evidenceProof.contradictionIds.length,
      missingObservedAt: evidenceProof.missingObservedAt.length,
      unverifiable: evidenceProof.unverifiableEvidenceIds.length,
      duplicateIds: evidenceProof.duplicateEvidenceIds.length
    },
    proofQuality: {
      decision: evidenceProof.decision,
      sourceBacked: evidenceProof.sourceBacked,
      confidenceBalance: evidenceProof.confidence.balance,
      validationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
      boundaryFailures: boundary.failures.length
    },
    operations: {
      healthStatus: health.status,
      dependencyStatusCounts,
      retryableDependencyCount: health.retryPlan.retryableDependencyCount,
      readOnlyReasonCount: health.readOnlyReasons.length,
      recoveryMode: recovery.recoveryMode,
      restartSafe: recovery.restartSafe,
      commitDecision: hostedKernelProjection.commitDecision,
      lifecycleStatus: lifecycleSettings.status,
      lifecycleCommand: lifecycleCommand.action,
      lifecycleDecision: hostedKernelProjection.lifecycleDecision,
      scheduleEnabled: lifecycleSettings.schedule.enabled,
      scheduleOverdue: lifecycleSettings.schedule.overdue,
      nextActionStatus: nextActionState.status
    }
  };
}

function buildMailchimpFactAnalyticsContract({ now, scope, command, boundary, health, validation, evidenceProof, recovery, clientRuntime, mailchimpFactHandoffBoundary, providerServiceContract }) {
  const productWorkflow = clientRuntime.productWorkflow;
  const applies = productWorkflow.provider === 'mailchimp';
  const externalHandoff = providerServiceContract.externalHandoff;
  const providerSync = providerServiceContract.sync;
  const blockedReasons = !applies
    ? []
    : [
      ...productWorkflow.validation,
      ...mailchimpFactHandoffBoundary.blockedReasons,
      ...(validation.valid ? [] : validation.errors.map((issue) => issue.code)),
      ...(health.failureState === 'blocking' ? ['volatile_fact.health_blocking'] : []),
      ...(!recovery.restartSafe ? ['volatile_fact.recovery_not_restart_safe'] : []),
      ...(externalHandoff.state === 'blocked' ? externalHandoff.blockedReasons.map((reason) => `provider.handoff:${reason}`) : []),
      ...(providerSync.externalAckOverdue ? ['provider.external_ack_overdue'] : []),
      ...(!boundary.permissions.canAudit && mailchimpFactHandoffBoundary.auditHandoff.required ? ['mailchimp.audit_permission_required'] : [])
    ];
  const readyForAnalyticsExport = applies
    && blockedReasons.length === 0
    && mailchimpFactHandoffBoundary.auditHandoff.safeToAppend
    && evidenceProof.decision !== 'conflict';
  const nextAction = !applies
    ? 'observe-volatile-fact-check'
    : productWorkflow.validation.length > 0
      ? 'repair-mailchimp-fact-scope'
      : validation.errors.length > 0
        ? 'repair-volatile-fact-validation'
        : health.failureState === 'blocking'
          ? 'wait-for-volatile-fact-health'
          : !recovery.restartSafe
            ? 'recover-volatile-fact-state'
            : externalHandoff.state === 'blocked'
              ? 'repair-provider-fact-handoff'
              : providerSync.externalAckOverdue
                ? 'collect-provider-fact-acknowledgement'
                : evidenceProof.decision === 'conflict'
                  ? 'resolve-mailchimp-evidence-conflict'
                  : 'export-mailchimp-fact-analytics';
  const exportRow = {
    rowType: 'mailchimp_fact_analytics',
    generatedAt: now,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    memoryNamespace: scope.memoryNamespace,
    factId: scope.factId || null,
    commandId: command.commandId,
    campaignId: productWorkflow.campaignId,
    audienceId: productWorkflow.audienceId,
    segmentId: productWorkflow.segmentId,
    workflowId: productWorkflow.workflowId,
    stateKey: productWorkflow.stateKey,
    handoffStatus: mailchimpFactHandoffBoundary.handoffStatus,
    providerExternalState: externalHandoff.state,
    evidenceDecision: evidenceProof.decision,
    readyForAnalyticsExport,
    nextAction,
    blockedReasons: [...new Set(blockedReasons)]
  };

  return {
    schemaVersion: 'volatile-fact-check.mailchimp-fact-analytics.v1',
    generatedAt: now,
    applies,
    provider: productWorkflow.provider,
    stage: productWorkflow.stage,
    stateKey: productWorkflow.stateKey,
    campaignId: productWorkflow.campaignId,
    audienceId: productWorkflow.audienceId,
    segmentId: productWorkflow.segmentId,
    workflowId: productWorkflow.workflowId,
    readyForAnalyticsExport,
    nextAction,
    blockedReasons: exportRow.blockedReasons,
    counters: {
      scopeValid: productWorkflow.valid ? 1 : 0,
      evidenceConflict: evidenceProof.decision === 'conflict' ? 1 : 0,
      auditWritable: mailchimpFactHandoffBoundary.auditWritable ? 1 : 0,
      mutationSafe: mailchimpFactHandoffBoundary.mutationSafe ? 1 : 0,
      providerBlocked: externalHandoff.state === 'blocked' ? 1 : 0,
      ackOutstanding: providerSync.externalAckOutstanding ? 1 : 0,
      blockedReasonCount: exportRow.blockedReasons.length
    },
    exportColumns: [
      'campaignId',
      'audienceId',
      'segmentId',
      'workflowId',
      'stateKey',
      'handoffStatus',
      'readyForAnalyticsExport',
      'nextAction'
    ],
    exportRow,
    timelineEvent: {
      at: now,
      eventType: 'volatile_fact.mailchimp_analytics_readiness',
      severity: readyForAnalyticsExport ? 'info' : 'warning',
      status: readyForAnalyticsExport ? 'ready' : 'blocked',
      summary: readyForAnalyticsExport
        ? `Mailchimp fact analytics ready for ${productWorkflow.stateKey}`
        : `${exportRow.blockedReasons.length} Mailchimp fact analytics blocker(s) for ${productWorkflow.stateKey}`
    },
    proofDigest: buildProofDigest([
      surfaceId,
      productWorkflow.stateKey,
      readyForAnalyticsExport ? 'ready' : 'blocked',
      nextAction,
      ...exportRow.blockedReasons
    ])
  };
}

function historyTimestamp(value, fallback) {
  return asText(value) || fallback;
}

function buildHistorySnapshots({ now, persistedState, command, evidenceProof, recovery, hostedKernelProjection }) {
  const factSnapshots = persistedState.facts
    .map((fact) => ({
      type: 'persisted_fact',
      observedAt: historyTimestamp(fact.updatedAt, persistedState.recoveredAt || now),
      factId: fact.factId,
      scopeKey: fact.scopeKey,
      status: fact.status,
      revision: fact.revision,
      evidenceCount: fact.evidenceIds.length,
      commandId: fact.lastCommandId
    }))
    .sort((a, b) => parseTimestampMs(b.observedAt) - parseTimestampMs(a.observedAt));
  const commandSnapshots = persistedState.commandLedger
    .map((entry) => ({
      type: 'command_ledger_entry',
      observedAt: historyTimestamp(entry.lastSeenAt || entry.committedAt, persistedState.recoveredAt || now),
      commandId: entry.commandId,
      idempotencyKey: entry.idempotencyKey,
      action: entry.action,
      status: entry.status,
      factId: entry.factId,
      replayable: entry.replayable
    }))
    .sort((a, b) => parseTimestampMs(b.observedAt) - parseTimestampMs(a.observedAt));
  const projectedFact = hostedKernelProjection.writeSet ? hostedKernelProjection.writeSet.fact : null;

  return {
    schemaVersion: 'volatile-fact-check.history-snapshots.v1',
    generatedAt: now,
    recoveredAt: persistedState.recoveredAt,
    journalCursor: persistedState.journalCursor,
    activeFact: recovery.activeFact,
    projectedMutation: projectedFact
      ? {
          type: 'projected_fact_revision',
          observedAt: now,
          factId: projectedFact.factId,
          scopeKey: projectedFact.scopeKey,
          status: projectedFact.status,
          revision: projectedFact.revision,
          evidenceCount: evidenceProof.evidenceCount,
          commandId: command.commandId,
          proofDigest: evidenceProof.proofDigest,
          commitDecision: hostedKernelProjection.commitDecision
        }
      : null,
    latestFacts: factSnapshots.slice(0, 8),
    latestCommands: commandSnapshots.slice(0, 8)
  };
}

function buildTimelineReport({ now, boundary, health, validation, command, evidenceProof, recovery, hostedKernelProjection, lifecycleSettings, lifecycleCommand, nextActionState, mailchimpFactAnalytics }) {
  const events = [
    {
      at: now,
      eventType: 'volatile_fact.request_received',
      severity: 'info',
      status: boundary.allowed ? 'allowed' : 'denied',
      summary: `${boundary.action} request evaluated for ${command.scopeKey}`
    },
    {
      at: now,
      eventType: 'volatile_fact.evidence_proof_built',
      severity: evidenceProof.decision === 'conflict' ? 'warning' : 'info',
      status: evidenceProof.decision,
      summary: `${evidenceProof.evidenceCount} evidence item(s), proof ${evidenceProof.proofDigest}`
    },
    {
      at: now,
      eventType: 'volatile_fact.health_evaluated',
      severity: health.failureState === 'blocking' ? 'error' : health.degradedMode ? 'warning' : 'info',
      status: health.status,
      summary: `${health.dependencySummary.requiredDown.length} down, ${health.dependencySummary.degraded.length} degraded dependency observation(s)`
    },
    {
      at: now,
      eventType: 'volatile_fact.validation_completed',
      severity: validation.valid ? 'info' : 'error',
      status: validation.valid ? 'valid' : 'invalid',
      summary: `${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`
    },
    {
      at: now,
      eventType: 'volatile_fact.recovery_evaluated',
      severity: recovery.restartSafe ? 'info' : 'error',
      status: recovery.recoveryMode,
      summary: recovery.replay ? 'idempotency ledger can replay prior result' : 'restart recovery evaluated for active fact state'
    },
    {
      at: now,
      eventType: 'volatile_fact.lifecycle_evaluated',
      severity: hostedKernelProjection.lifecycleBlocked ? 'error' : lifecycleSettings.status === 'paused' ? 'warning' : 'info',
      status: lifecycleCommand.active ? hostedKernelProjection.lifecycleDecision : lifecycleSettings.status,
      summary: lifecycleCommand.active
        ? `${lifecycleCommand.action} lifecycle command evaluated for ${command.scopeKey}`
        : `lifecycle is ${lifecycleSettings.status} with ${lifecycleSettings.runMode} run mode`
    },
    {
      at: now,
      eventType: 'volatile_fact.projection_ready',
      severity: hostedKernelProjection.mutationBlocked ? 'error' : 'info',
      status: hostedKernelProjection.commitDecision,
      summary: hostedKernelProjection.mutationBlocked
        ? `${hostedKernelProjection.blockReasons.length} block reason(s) prevent mutation`
        : `command status projected as ${hostedKernelProjection.commandStatus}`
    },
    {
      at: now,
      eventType: 'volatile_fact.next_action_ready',
      severity: nextActionState.status.startsWith('needs_') ? 'warning' : 'info',
      status: nextActionState.status,
      summary: nextActionState.primaryReason || `next action actor is ${nextActionState.actor}`
    },
    ...(mailchimpFactAnalytics?.applies ? [mailchimpFactAnalytics.timelineEvent] : [])
  ];

  return {
    schemaVersion: 'volatile-fact-check.timeline-report.v1',
    generatedAt: now,
    scopeKey: command.scopeKey,
    commandId: command.commandId,
    events,
    openItems: [
      ...validation.errors.map((issue) => ({ source: 'validation', code: issue.code, message: issue.message })),
      ...health.readOnlyReasons.map((message) => ({ source: 'health', code: 'VOLATILE_FACT_READ_ONLY_DEGRADED_MODE', message })),
      ...boundary.failures.map((message) => ({ source: 'boundary', code: 'VOLATILE_FACT_BOUNDARY_DENIED', message }))
    ]
  };
}

function buildExportReadySummary({ now, scope, principal, boundary, command, analyticsCounters, historySnapshots, timelineReport, evidenceProof, hostedKernelProjection, lifecycleSettings, nextActionState, mailchimpFactAnalytics }) {
  return {
    schemaVersion: 'volatile-fact-check.export-summary.v1',
    generatedAt: now,
    exportKey: buildProofDigest([surfaceId, command.scopeKey, command.commandId, evidenceProof.proofDigest, now]),
    subject: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      memoryNamespace: scope.memoryNamespace,
      factId: scope.factId || null,
      actorId: principal.id,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      workspaceBindingId: boundary.workspaceScopeProof.activeBindingId,
      workspaceBindingMode: boundary.workspaceScopeProof.bindingMode
    },
    reportState: {
      commitDecision: hostedKernelProjection.commitDecision,
      commandStatus: hostedKernelProjection.commandStatus,
      mutationBlocked: hostedKernelProjection.mutationBlocked,
      healthStatus: analyticsCounters.operations.healthStatus,
      recoveryMode: analyticsCounters.operations.recoveryMode,
      evidenceDecision: evidenceProof.decision,
      proofDigest: evidenceProof.proofDigest,
      lifecycleStatus: lifecycleSettings.status,
      lifecycleDecision: hostedKernelProjection.lifecycleDecision,
      nextActionStatus: nextActionState.status
    },
    counters: analyticsCounters,
    snapshotCounts: {
      factsIncluded: historySnapshots.latestFacts.length,
      commandsIncluded: historySnapshots.latestCommands.length,
      timelineEvents: timelineReport.events.length,
      openItems: timelineReport.openItems.length
    },
    tableRows: [
      {
        rowType: 'fact_check_summary',
        generatedAt: now,
        scopeKey: command.scopeKey,
        action: command.action,
        commitDecision: hostedKernelProjection.commitDecision,
        evidenceDecision: evidenceProof.decision,
        lifecycleStatus: lifecycleSettings.status,
        nextActionStatus: nextActionState.status,
        proofDigest: evidenceProof.proofDigest,
        validationErrors: analyticsCounters.proofQuality.validationErrors,
        validationWarnings: analyticsCounters.proofQuality.validationWarnings
      },
      ...(mailchimpFactAnalytics?.applies ? [mailchimpFactAnalytics.exportRow] : [])
    ]
  };
}

function normalizeAnalyticsHistory(input, { now, scope }) {
  const source = input.analyticsHistory && typeof input.analyticsHistory === 'object'
    ? input.analyticsHistory
    : input.reportingState && typeof input.reportingState === 'object'
      ? input.reportingState
      : {};
  const rawSnapshots = Array.isArray(source.snapshots)
    ? source.snapshots
    : Array.isArray(source.history)
      ? source.history
      : [];

  return rawSnapshots.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const counters = item.counters && typeof item.counters === 'object' ? item.counters : {};
    const operations = counters.operations && typeof counters.operations === 'object' ? counters.operations : {};
    const requests = counters.requests && typeof counters.requests === 'object' ? counters.requests : {};
    const proofQuality = counters.proofQuality && typeof counters.proofQuality === 'object' ? counters.proofQuality : {};
    const evidence = counters.evidence && typeof counters.evidence === 'object' ? counters.evidence : {};

    return {
      snapshotId: asText(item.snapshotId) || asText(item.id) || `analytics-snapshot-${index + 1}`,
      capturedAt: asText(item.capturedAt) || asText(item.generatedAt) || now,
      scopeKey: asText(item.scopeKey) || buildScopeKey(scope),
      commandStatus: asText(item.commandStatus) || asText(operations.commitDecision) || 'unknown',
      nextActionStatus: asText(item.nextActionStatus) || asText(operations.nextActionStatus) || 'unknown',
      healthStatus: asText(item.healthStatus) || asText(operations.healthStatus) || 'unknown',
      mutationAccepted: Math.trunc(finiteNonNegativeNumber(item.mutationAccepted ?? requests.mutationAccepted, 0)),
      mutationBlocked: Math.trunc(finiteNonNegativeNumber(item.mutationBlocked ?? requests.mutationBlocked, 0)),
      validationErrors: Math.trunc(finiteNonNegativeNumber(item.validationErrors ?? proofQuality.validationErrors, 0)),
      validationWarnings: Math.trunc(finiteNonNegativeNumber(item.validationWarnings ?? proofQuality.validationWarnings, 0)),
      evidenceCount: Math.trunc(finiteNonNegativeNumber(item.evidenceCount ?? evidence.total, 0)),
      proofDigest: asText(item.proofDigest) || null
    };
  }).filter((snapshot) => snapshot.scopeKey === buildScopeKey(scope));
}

function numericDelta(current, previous, key) {
  return Math.trunc(finiteNonNegativeNumber(current[key], 0)) - Math.trunc(finiteNonNegativeNumber(previous?.[key], 0));
}

function buildAnalyticsExportReport({ input, now, scope, command, analyticsCounters, historySnapshots, timelineReport, exportReadySummary, evidenceProof, hostedKernelProjection, providerServiceContract, mailchimpFactAnalytics }) {
  const previousSnapshots = normalizeAnalyticsHistory(input, { now, scope })
    .sort((a, b) => (parseTimestampMs(b.capturedAt) ?? 0) - (parseTimestampMs(a.capturedAt) ?? 0));
  const currentSnapshot = {
    snapshotId: buildProofDigest(['analytics-snapshot', command.scopeKey, command.commandId, evidenceProof.proofDigest, now]),
    capturedAt: now,
    scopeKey: command.scopeKey,
    commandStatus: hostedKernelProjection.commandStatus,
    nextActionStatus: analyticsCounters.operations.nextActionStatus,
    healthStatus: analyticsCounters.operations.healthStatus,
    mutationAccepted: analyticsCounters.requests.mutationAccepted,
    mutationBlocked: analyticsCounters.requests.mutationBlocked,
    validationErrors: analyticsCounters.proofQuality.validationErrors,
    validationWarnings: analyticsCounters.proofQuality.validationWarnings,
    evidenceCount: analyticsCounters.evidence.total,
    proofDigest: evidenceProof.proofDigest
  };
  const previous = previousSnapshots[0] || null;
  const timelineEventCounts = countBy(timelineReport.events, (event) => event.severity);
  const exportPartitions = [
    {
      name: 'summary',
      schemaVersion: exportReadySummary.schemaVersion,
      rowCount: exportReadySummary.tableRows.length,
      exportKey: exportReadySummary.exportKey
    },
    {
      name: 'timeline',
      schemaVersion: timelineReport.schemaVersion,
      rowCount: timelineReport.events.length,
      exportKey: buildProofDigest([exportReadySummary.exportKey, 'timeline', timelineReport.events.length])
    },
    {
      name: 'history',
      schemaVersion: historySnapshots.schemaVersion,
      rowCount: historySnapshots.latestFacts.length + historySnapshots.latestCommands.length + (historySnapshots.projectedMutation ? 1 : 0),
      exportKey: buildProofDigest([exportReadySummary.exportKey, 'history', historySnapshots.journalCursor])
    },
    {
      name: 'analytics',
      schemaVersion: analyticsCounters.schemaVersion,
      rowCount: 1 + previousSnapshots.length,
      exportKey: buildProofDigest([exportReadySummary.exportKey, 'analytics', currentSnapshot.snapshotId])
    },
    {
      name: 'mailchimpFactAnalytics',
      schemaVersion: mailchimpFactAnalytics?.schemaVersion || 'volatile-fact-check.mailchimp-fact-analytics.v1',
      rowCount: mailchimpFactAnalytics?.applies ? 1 : 0,
      exportKey: buildProofDigest([
        exportReadySummary.exportKey,
        'mailchimpFactAnalytics',
        mailchimpFactAnalytics?.proofDigest || 'not-applicable'
      ])
    }
  ];

  return {
    schemaVersion: 'volatile-fact-check.analytics-export-report.v1',
    generatedAt: now,
    reportId: buildProofDigest(['analytics-export-report', command.scopeKey, command.commandId, currentSnapshot.snapshotId]),
    scopeKey: command.scopeKey,
    exportCursor: providerServiceContract.sync.nextCursor,
    currentSnapshot,
    previousSnapshot: previous,
    deltas: {
      mutationAccepted: numericDelta(currentSnapshot, previous, 'mutationAccepted'),
      mutationBlocked: numericDelta(currentSnapshot, previous, 'mutationBlocked'),
      validationErrors: numericDelta(currentSnapshot, previous, 'validationErrors'),
      validationWarnings: numericDelta(currentSnapshot, previous, 'validationWarnings'),
      evidenceCount: numericDelta(currentSnapshot, previous, 'evidenceCount')
    },
    trend: {
      historyDepth: previousSnapshots.length,
      newestPriorCapturedAt: previous?.capturedAt || null,
      healthChanged: previous ? previous.healthStatus !== currentSnapshot.healthStatus : false,
      nextActionChanged: previous ? previous.nextActionStatus !== currentSnapshot.nextActionStatus : false,
      commandStatusChanged: previous ? previous.commandStatus !== currentSnapshot.commandStatus : false,
      proofDigestChanged: previous ? previous.proofDigest !== currentSnapshot.proofDigest : false
    },
    timelineSeverityCounts: timelineEventCounts,
    exportPartitions,
    handoff: {
      providerId: providerServiceContract.providerId,
      externalState: providerServiceContract.externalHandoff.state,
      externalPayloadKinds: providerServiceContract.externalHandoff.payloadKinds,
      ackOutstanding: providerServiceContract.sync.externalAckOutstanding,
      ackOverdue: providerServiceContract.sync.externalAckOverdue
    },
    mailchimpFactAnalytics: mailchimpFactAnalytics
      ? {
          applies: mailchimpFactAnalytics.applies,
          stateKey: mailchimpFactAnalytics.stateKey,
          readyForAnalyticsExport: mailchimpFactAnalytics.readyForAnalyticsExport,
          nextAction: mailchimpFactAnalytics.nextAction,
          blockedReasons: mailchimpFactAnalytics.blockedReasons,
          proofDigest: mailchimpFactAnalytics.proofDigest
        }
      : null
  };
}

function normalizeReportingWindow(input) {
  const source = input.reportingState && typeof input.reportingState === 'object'
    ? input.reportingState
    : input.analyticsHistory && typeof input.analyticsHistory === 'object'
      ? input.analyticsHistory
      : {};
  const exportSource = source.export && typeof source.export === 'object' ? source.export : {};
  const timelineSource = source.timeline && typeof source.timeline === 'object' ? source.timeline : {};
  const retentionLimit = Math.max(1, Math.min(100, Math.trunc(finitePositiveNumber(source.retentionLimit, 24))));
  const exportFormat = ['jsonl', 'csv', 'parquet_manifest'].includes(asText(exportSource.format))
    ? asText(exportSource.format)
    : 'jsonl';

  return {
    schemaVersion: 'volatile-fact-check.reporting-window.v1',
    retentionLimit,
    export: {
      format: exportFormat,
      destination: asText(exportSource.destination || source.exportDestination) || null,
      includeTimeline: exportSource.includeTimeline === false ? false : true,
      includeHistory: exportSource.includeHistory === false ? false : true,
      includeProofs: exportSource.includeProofs === false ? false : true,
      lastExportedAt: asText(exportSource.lastExportedAt || source.lastExportedAt) || null,
      lastExportCursor: asText(exportSource.lastExportCursor || source.lastExportCursor) || null
    },
    timeline: {
      lastEventCursor: asText(timelineSource.lastEventCursor || source.lastTimelineCursor) || null,
      acknowledgedEventIds: uniqueTextList(timelineSource.acknowledgedEventIds || source.acknowledgedEventIds)
    }
  };
}

function timelineEventId({ scopeKey, commandId, event, index }) {
  return buildProofDigest([
    'timeline-event',
    scopeKey,
    commandId,
    event.eventType,
    event.status,
    event.severity,
    event.at,
    index
  ]);
}

function buildReportingState({ input, now, scope, command, analyticsCounters, historySnapshots, timelineReport, analyticsExportReport, exportReadySummary, providerServiceContract, operationalIncidentReport }) {
  const reportingWindow = normalizeReportingWindow(input);
  const previousSnapshots = normalizeAnalyticsHistory(input, { now, scope })
    .filter((snapshot) => snapshot.scopeKey === command.scopeKey);
  const retainedSnapshots = [
    analyticsExportReport.currentSnapshot,
    ...previousSnapshots.filter((snapshot) => snapshot.snapshotId !== analyticsExportReport.currentSnapshot.snapshotId)
  ]
    .sort((a, b) => (parseTimestampMs(b.capturedAt) ?? 0) - (parseTimestampMs(a.capturedAt) ?? 0))
    .slice(0, reportingWindow.retentionLimit);
  const eventRows = timelineReport.events.map((event, index) => ({
    eventId: timelineEventId({ scopeKey: command.scopeKey, commandId: command.commandId, event, index }),
    cursor: buildProofDigest(['timeline-cursor', command.scopeKey, command.commandId, event.eventType, event.status, index]),
    acknowledged: reportingWindow.timeline.acknowledgedEventIds.includes(
      timelineEventId({ scopeKey: command.scopeKey, commandId: command.commandId, event, index })
    ),
    ...event
  }));
  const unacknowledgedEvents = eventRows.filter((event) => event.severity !== 'info' && !event.acknowledged);
  const exportRows = [
    ...exportReadySummary.tableRows.map((row, index) => ({
      rowId: buildProofDigest(['export-row', exportReadySummary.exportKey, row.rowType, index]),
      partition: 'summary',
      format: reportingWindow.export.format,
      payload: row
    })),
    ...(reportingWindow.export.includeTimeline
      ? eventRows.map((row) => ({
          rowId: row.eventId,
          partition: 'timeline',
          format: reportingWindow.export.format,
          payload: row
        }))
      : []),
    ...(reportingWindow.export.includeHistory
      ? [
          ...historySnapshots.latestFacts.map((snapshot, index) => ({
            rowId: buildProofDigest(['export-row', exportReadySummary.exportKey, 'history-fact', snapshot.factId, index]),
            partition: 'history',
            format: reportingWindow.export.format,
            payload: snapshot
          })),
          ...historySnapshots.latestCommands.map((snapshot, index) => ({
            rowId: buildProofDigest(['export-row', exportReadySummary.exportKey, 'history-command', snapshot.commandId, index]),
            partition: 'history',
            format: reportingWindow.export.format,
            payload: snapshot
          })),
          historySnapshots.projectedMutation
            ? {
                rowId: buildProofDigest(['export-row', exportReadySummary.exportKey, 'history-projected-mutation', command.commandId]),
                partition: 'history',
                format: reportingWindow.export.format,
                payload: historySnapshots.projectedMutation
              }
            : null
        ].filter(Boolean)
      : []),
    ...(reportingWindow.export.includeProofs
      ? [{
          rowId: buildProofDigest(['export-row', exportReadySummary.exportKey, 'proof-state']),
          partition: 'proofs',
          format: reportingWindow.export.format,
          payload: {
            proofDigest: analyticsExportReport.currentSnapshot.proofDigest,
            reportId: analyticsExportReport.reportId,
            providerCursor: providerServiceContract.sync.nextCursor,
            externalHandoffState: providerServiceContract.externalHandoff.state
          }
        }]
      : [])
  ];
  const exportBatchId = buildProofDigest([
    'reporting-export-batch',
    command.scopeKey,
    analyticsExportReport.reportId,
    reportingWindow.export.format,
    exportRows.length,
    providerServiceContract.sync.nextCursor
  ]);
  const blockedExportReason = providerServiceContract.externalHandoff.state === 'blocked'
    ? providerServiceContract.externalHandoff.blockedReasons[0] || 'external handoff contract is blocked'
    : null;

  return {
    schemaVersion: 'volatile-fact-check.reporting-state.v1',
    generatedAt: now,
    scopeKey: command.scopeKey,
    reportingWindow,
    retainedSnapshots,
    timelineCursor: {
      previous: reportingWindow.timeline.lastEventCursor,
      current: eventRows.at(-1)?.cursor || reportingWindow.timeline.lastEventCursor,
      eventCount: eventRows.length,
      unacknowledgedCount: unacknowledgedEvents.length,
      unacknowledgedEventIds: unacknowledgedEvents.map((event) => event.eventId)
    },
    serviceLevel: {
      state: operationalIncidentReport.severity === 'error'
        ? 'breached'
        : operationalIncidentReport.severity === 'warning'
          ? 'at_risk'
          : 'within_policy',
      mutationSuccessRate: analyticsCounters.requests.mutationRequested > 0
        ? Number((analyticsCounters.requests.mutationAccepted / analyticsCounters.requests.mutationRequested).toFixed(4))
        : null,
      validationErrorRate: analyticsCounters.requests.current > 0
        ? Number((analyticsCounters.proofQuality.validationErrors / analyticsCounters.requests.current).toFixed(4))
        : 0,
      dependencyDegraded: analyticsCounters.operations.healthStatus !== 'healthy',
      ackOverdue: providerServiceContract.sync.externalAckOverdue
    },
    exportBatch: {
      batchId: exportBatchId,
      state: blockedExportReason ? 'blocked' : exportRows.length > 0 ? 'ready' : 'empty',
      destination: reportingWindow.export.destination,
      format: reportingWindow.export.format,
      rowCount: exportRows.length,
      blockedReason: blockedExportReason,
      cursor: providerServiceContract.sync.nextCursor,
      partitions: countBy(exportRows, (row) => row.partition),
      rows: exportRows
    }
  };
}

function firstBlockingReason({ boundary, validation, health, recovery, hostedKernelProjection }) {
  return boundary.failures[0]
    || validation.errors[0]?.message
    || health.readOnlyReasons[0]
    || (recovery.restartSafe ? null : 'restart recovery is not safe for this command')
    || hostedKernelProjection.blockReasons[0]
    || null;
}

function buildPreviewDiffRows({ scope, command, evidenceProof, recovery, hostedKernelProjection, lifecycleSettings, lifecycleCommand }) {
  const factWrite = hostedKernelProjection.writeSet?.fact || null;
  const lifecycleNext = hostedKernelProjection.lifecycleEffect?.nextSettings || lifecycleSettings;
  const rows = [];

  if (command.mutation) {
    rows.push({
      field: 'fact.status',
      label: 'Fact status',
      before: recovery.activeFact?.status || 'none',
      after: factWrite?.status || recovery.activeFact?.status || 'unchanged',
      changed: Boolean(factWrite && recovery.activeFact?.status !== factWrite.status),
      proof: evidenceProof.proofDigest
    });
    rows.push({
      field: 'fact.revision',
      label: 'Revision',
      before: recovery.activeFact?.revision ?? null,
      after: factWrite?.revision ?? recovery.activeFact?.revision ?? null,
      changed: Boolean(factWrite && recovery.activeFact?.revision !== factWrite.revision),
      proof: evidenceProof.proofDigest
    });
    rows.push({
      field: 'fact.evidence',
      label: 'Evidence attached',
      before: recovery.activeFact?.evidenceIds?.length ?? 0,
      after: factWrite?.evidenceIds?.length ?? evidenceProof.evidenceCount,
      changed: Boolean(factWrite),
      proof: evidenceProof.proofDigest
    });
  }

  if (lifecycleCommand.active) {
    rows.push({
      field: 'lifecycle.status',
      label: 'Lifecycle status',
      before: lifecycleSettings.status,
      after: lifecycleNext.status,
      changed: lifecycleSettings.status !== lifecycleNext.status,
      proof: hostedKernelProjection.lifecycleEffect?.proofDigest || null
    });
    rows.push({
      field: 'lifecycle.schedule.nextRunAt',
      label: 'Next scheduled run',
      before: lifecycleSettings.schedule.nextRunAt,
      after: lifecycleNext.schedule.nextRunAt,
      changed: lifecycleSettings.schedule.nextRunAt !== lifecycleNext.schedule.nextRunAt,
      proof: hostedKernelProjection.lifecycleEffect?.proofDigest || null
    });
  }

  if (rows.length === 0) {
    rows.push({
      field: 'fact.scope',
      label: 'Reviewed scope',
      before: null,
      after: scope.factId || command.scopeKey,
      changed: false,
      proof: evidenceProof.proofDigest
    });
  }

  return rows;
}

function buildAcceptanceFormContract({ accepted, continuation, command, hostedKernelProjection, providerServiceContract, clientWorkflowHandoff }) {
  const disabledReasons = [
    accepted ? null : 'preview is not ready for acceptance',
    continuation.cursor.stale ? 'client cursor is stale' : null,
    continuation.acceptance.tokenState === 'stale_or_mismatched' ? 'acceptance token is stale or mismatched' : null,
    providerServiceContract.externalHandoff.state === 'blocked' ? 'provider handoff is blocked' : null
  ].filter(Boolean);

  return {
    schemaVersion: 'volatile-fact-check.acceptance-form.v1',
    submitRoute: clientWorkflowHandoff.destinationRoute,
    method: 'POST',
    enabled: accepted && disabledReasons.length === 0,
    disabledReasons,
    fields: [
      { name: 'commandId', required: true, value: command.commandId },
      { name: 'idempotencyKey', required: true, value: command.idempotencyKey },
      { name: 'providerCursor', required: true, value: providerServiceContract.sync.nextCursor },
      { name: 'acceptanceToken', required: continuation.acceptance.required, value: continuation.acceptance.expectedToken },
      { name: 'projectedCommandStatus', required: true, value: hostedKernelProjection.commandStatus }
    ],
    replayGuard: {
      idempotent: true,
      expectedTokenState: continuation.acceptance.required ? 'accepted' : 'not_required',
      currentTokenState: continuation.acceptance.tokenState,
      staleClientCursor: continuation.cursor.stale
    }
  };
}

function summarizeReadinessGates(readinessChecks) {
  const blocked = readinessChecks.filter((entry) => entry.status === 'blocked');
  const warnings = readinessChecks.filter((entry) => entry.status === 'warning');
  return {
    schemaVersion: 'volatile-fact-check.readiness-gate-summary.v1',
    state: blocked.length > 0 ? 'blocked' : warnings.length > 0 ? 'ready_with_warnings' : 'ready',
    passedCount: readinessChecks.filter((entry) => entry.status === 'passed').length,
    warningCount: warnings.length,
    blockedCount: blocked.length,
    blockingChecks: blocked.map((entry) => entry.check),
    warningChecks: warnings.map((entry) => entry.check),
    firstBlockingSummary: blocked[0]?.summary || null
  };
}

function buildExplainableNextStepItems({ nextActionState, clientWorkflowHandoff, providerServiceContract, operationalIncidentReport }) {
  return [
    {
      stepId: 'primary_workflow_action',
      actor: nextActionState.actor,
      route: clientWorkflowHandoff.destinationRoute,
      action: clientWorkflowHandoff.primaryAction.type,
      enabled: clientWorkflowHandoff.primaryAction.enabled,
      reason: nextActionState.primaryReason || `next action status is ${nextActionState.status}`
    },
    {
      stepId: 'provider_sync_cursor',
      actor: 'workflow-client',
      route: clientWorkflowHandoff.destinationRoute,
      action: providerServiceContract.sync.ackCursorConflict ? 'refresh_provider_cursor' : 'persist_provider_cursor',
      enabled: !providerServiceContract.sync.ackCursorConflict,
      reason: providerServiceContract.sync.ackCursorConflict
        ? 'provider acknowledgement cursor conflicts with the next cursor'
        : `next cursor ${providerServiceContract.sync.nextCursor} is ready`
    },
    {
      stepId: 'operator_escalation',
      actor: operationalIncidentReport.escalation.owner,
      route: operationalIncidentReport.escalation.route,
      action: operationalIncidentReport.escalation.required ? 'open_operational_incident' : 'no_operator_action',
      enabled: operationalIncidentReport.escalation.required,
      reason: operationalIncidentReport.escalation.reason || 'operational state is clear'
    }
  ];
}

function buildOperatorWorkflowHandoffSummary({
  now,
  scope,
  principal,
  boundary,
  health,
  validation,
  command,
  recovery,
  hostedKernelProjection,
  providerServiceContract,
  clientWorkflowHandoff,
  operationalIncidentReport,
  readinessGateSummary,
  acceptanceForm,
  explainableNextSteps
}) {
  const blockingReasons = [
    ...boundary.failures.map((reason) => `boundary:${reason}`),
    ...validation.errors.map((issue) => `validation:${issue.code}`),
    ...health.readOnlyReasons.map((reason) => `health:${reason}`),
    ...(recovery.restartSafe ? [] : recovery.pendingRecoveryReasons.map((reason) => `recovery:${reason}`)),
    ...(providerServiceContract.externalHandoff.state === 'blocked'
      ? providerServiceContract.externalHandoff.blockedReasons.map((reason) => `provider:${reason}`)
      : []),
    ...(operationalIncidentReport.severity === 'error' ? [`incident:${operationalIncidentReport.state}`] : [])
  ];
  const warningReasons = [
    ...validation.warnings.map((issue) => `validation:${issue.code}`),
    ...(health.degradedMode ? [`health:${health.status}`] : []),
    ...(operationalIncidentReport.severity === 'warning' ? [`incident:${operationalIncidentReport.state}`] : []),
    ...(providerServiceContract.sync.ackCursorConflict ? ['provider:ack-cursor-conflict'] : [])
  ];
  const workflowState = blockingReasons.length
    ? 'blocked'
    : acceptanceForm.enabled
      ? 'acceptance-ready'
      : readinessGateSummary.state === 'ready_with_warnings'
        ? 'review-warnings'
        : 'review-ready';
  const primaryStep = explainableNextSteps.find((step) => step.enabled)
    || explainableNextSteps.find((step) => step.action !== 'no_operator_action')
    || explainableNextSteps[0]
    || null;
  const handoffId = buildProofDigest([
    'volatile-fact-check-operator-handoff',
    scope.tenantId || 'no-tenant',
    scope.workspaceId || 'no-workspace',
    command.commandId,
    providerServiceContract.sync.nextCursor,
    workflowState
  ]);

  return {
    schemaVersion: 'volatile-fact-check.operator-workflow-handoff.v1',
    generatedAt: now,
    handoffId,
    workflowState,
    route: clientWorkflowHandoff.destinationRoute,
    routeName: clientWorkflowHandoff.routeName,
    principal: {
      actorId: principal.id,
      tenantId: principal.tenantId || null,
      roles: principal.roles
    },
    subject: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      memoryNamespace: scope.memoryNamespace,
      factId: scope.factId || null,
      scopeKey: command.scopeKey
    },
    decisionState: {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      action: command.action,
      commitDecision: hostedKernelProjection.commitDecision,
      commandStatus: hostedKernelProjection.commandStatus,
      lifecycleDecision: hostedKernelProjection.lifecycleDecision,
      acceptanceEnabled: acceptanceForm.enabled,
      acceptanceTokenRequired: providerServiceContract.clientRuntime.continuation.acceptance.required,
      acceptanceTokenState: providerServiceContract.clientRuntime.continuation.acceptance.tokenState,
      restartSafe: recovery.restartSafe,
      recoveryMode: recovery.recoveryMode
    },
    readiness: {
      state: readinessGateSummary.state,
      passedCount: readinessGateSummary.passedCount,
      warningCount: readinessGateSummary.warningCount,
      blockedCount: readinessGateSummary.blockedCount,
      firstBlockingSummary: readinessGateSummary.firstBlockingSummary,
      dependencySummary: health.dependencySummary,
      externalHandoffState: providerServiceContract.externalHandoff.state
    },
    blockingReasons: [...new Set(blockingReasons)],
    warningReasons: [...new Set(warningReasons)],
    runtimePatch: {
      routeKey: clientWorkflowHandoff.sourceRouteKey,
      destinationRoute: clientWorkflowHandoff.destinationRoute,
      resumeState: clientWorkflowHandoff.resume.resumeState,
      handoffToken: clientWorkflowHandoff.resume.handoffToken,
      providerCursor: providerServiceContract.sync.nextCursor,
      activePanel: clientWorkflowHandoff.uiStatePatch.activePanel,
      banner: blockingReasons[0] || warningReasons[0] || null,
      selectedFactIds: clientWorkflowHandoff.uiStatePatch.selectedFactIds,
      dirtyFields: clientWorkflowHandoff.uiStatePatch.dirtyFields
    },
    nextAction: primaryStep
      ? {
          stepId: primaryStep.stepId,
          actor: primaryStep.actor,
          route: primaryStep.route,
          action: primaryStep.action,
          enabled: primaryStep.enabled,
          reason: primaryStep.reason
        }
      : null,
    auditHandoff: {
      eventType: workflowState === 'blocked'
        ? 'volatile_fact_check.operator_handoff.blocked'
        : 'volatile_fact_check.operator_handoff.ready',
      auditSubject: `${scope.tenantId || 'unscoped'}:${scope.workspaceId || 'unscoped'}:${command.commandId}`,
      providerId: providerServiceContract.providerId,
      consumerId: providerServiceContract.consumerId,
      syncReceiptId: providerServiceContract.sync.receipt.receiptId,
      externalDispatchId: providerServiceContract.externalHandoff.dispatchId,
      incidentId: operationalIncidentReport.incidentId
    },
    proof: buildProofDigest([
      handoffId,
      workflowState,
      command.idempotencyKey,
      hostedKernelProjection.commandStatus,
      providerServiceContract.sync.nextCursor,
      blockingReasons.join('|'),
      warningReasons.join('|')
    ])
  };
}

function buildClientPreviewAcceptanceContract({ now, scope, principal, boundary, health, validation, command, evidenceProof, recovery, hostedKernelProjection, lifecycleSettings, lifecycleCommand, nextActionState, providerServiceContract, clientRuntime, clientWorkflowHandoff, operationalIncidentReport }) {
  const mutationPreview = hostedKernelProjection.writeSet?.fact || null;
  const lifecyclePreview = hostedKernelProjection.lifecycleWriteSet || null;
  const accepted = boundary.allowed
    && validation.valid
    && recovery.restartSafe
    && (command.mutation ? !hostedKernelProjection.mutationBlocked : !hostedKernelProjection.lifecycleBlocked);
  const readinessChecks = [
    {
      check: 'permission_boundary',
      status: boundary.allowed ? 'passed' : 'blocked',
      summary: boundary.allowed ? 'principal can access volatile fact scope' : boundary.failures.join('; ')
    },
    {
      check: 'payload_validation',
      status: validation.valid ? 'passed' : 'blocked',
      summary: validation.valid ? 'request payload satisfies volatile fact validation' : validation.errors.map((issue) => issue.message).join('; ')
    },
    {
      check: 'dependency_readiness',
      status: health.failureState === 'blocking' ? 'blocked' : health.degradedMode ? 'warning' : 'passed',
      summary: health.readOnlyReasons[0] || `${health.status} dependency state`
    },
    {
      check: 'restart_safety',
      status: recovery.restartSafe ? 'passed' : 'blocked',
      summary: recovery.restartSafe ? recovery.recoveryMode : recovery.pendingRecoveryReasons.join('; ')
    },
    {
      check: 'provider_handoff',
      status: providerServiceContract.externalHandoff.state === 'blocked' ? 'blocked' : 'passed',
      summary: providerServiceContract.externalHandoff.state
    },
    {
      check: 'operational_incident',
      status: operationalIncidentReport.severity === 'error'
        ? 'blocked'
        : operationalIncidentReport.severity === 'warning'
          ? 'warning'
          : 'passed',
      summary: operationalIncidentReport.state === 'clear'
        ? 'no active operational incidents'
        : `${operationalIncidentReport.incidentCount} active incident(s), safe mode ${operationalIncidentReport.safeMode}`
    }
  ];
  const readinessGateSummary = summarizeReadinessGates(readinessChecks);
  const validationSummary = {
    schemaVersion: 'volatile-fact-check.validation-summary.v1',
    valid: validation.valid,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    statusBySeverity: {
      error: validation.errors.length,
      warning: validation.warnings.length,
      boundary: boundary.failures.length,
      health: health.readOnlyReasons.length
    },
    proofQuality: {
      evidenceDecision: evidenceProof.decision,
      sourceBacked: evidenceProof.sourceBacked,
      sourceCount: evidenceProof.sourceCount,
      confidenceBalance: evidenceProof.confidence.balance,
      duplicateEvidenceIds: evidenceProof.duplicateEvidenceIds
    },
    topErrors: validation.errors.slice(0, 5).map((issue) => ({
      code: issue.code,
      message: issue.message,
      nextStep: issue.action
    })),
    topWarnings: validation.warnings.slice(0, 5).map((issue) => ({
      code: issue.code,
      message: issue.message,
      nextStep: issue.action
    }))
  };
  const continuation = providerServiceContract.clientRuntime.continuation;
  const previewDiffRows = buildPreviewDiffRows({
    scope,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection,
    lifecycleSettings,
    lifecycleCommand
  });
  const acceptanceForm = buildAcceptanceFormContract({
    accepted,
    continuation,
    command,
    hostedKernelProjection,
    providerServiceContract,
    clientWorkflowHandoff
  });
  const explainableNextSteps = buildExplainableNextStepItems({
    nextActionState,
    clientWorkflowHandoff,
    providerServiceContract,
    operationalIncidentReport
  });
  const operatorWorkflowHandoff = buildOperatorWorkflowHandoffSummary({
    now,
    scope,
    principal,
    boundary,
    health,
    validation,
    command,
    recovery,
    hostedKernelProjection,
    providerServiceContract,
    clientWorkflowHandoff,
    operationalIncidentReport,
    readinessGateSummary,
    acceptanceForm,
    explainableNextSteps
  });

  return {
    schemaVersion: 'volatile-fact-check.client-preview-acceptance.v1',
    generatedAt: now,
    routeKey: `${surfaceGroup}/${surfaceName}`,
    clientRuntime: {
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      traceId: clientRuntime.traceId,
      sourceRouteKey: clientRuntime.routeKey,
      viewMode: clientRuntime.viewMode,
      activePanel: clientRuntime.activePanel,
      returnTo: clientRuntime.returnTo
    },
    subject: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      memoryNamespace: scope.memoryNamespace,
      factId: scope.factId || null,
      actorId: principal.id,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      workspaceBindingId: boundary.workspaceScopeProof.activeBindingId,
      workspaceBindingMode: boundary.workspaceScopeProof.bindingMode
    },
    preview: {
      mode: command.mutation
        ? 'fact_mutation'
        : lifecycleCommand.active
          ? 'lifecycle_control'
          : 'read_observation',
      headline: command.mutation
        ? `${command.action} volatile fact ${scope.factId || '(unbound)'}`
        : lifecycleCommand.active
          ? `${lifecycleCommand.action} volatile fact checking`
          : 'inspect volatile fact state',
      decision: hostedKernelProjection.commitDecision,
      projectedFact: mutationPreview
        ? {
            factId: mutationPreview.factId,
            status: mutationPreview.status,
            revision: mutationPreview.revision,
            valueHash: mutationPreview.valueHash,
            evidenceCount: mutationPreview.evidenceIds.length,
            proofDigest: evidenceProof.proofDigest
          }
        : null,
      projectedLifecycle: lifecyclePreview
        ? {
            action: lifecyclePreview.action,
            status: lifecyclePreview.status,
            runMode: lifecyclePreview.runMode,
            nextRunAt: lifecyclePreview.schedule.nextRunAt,
            settingsHash: lifecyclePreview.settingsHash
          }
        : null,
      diffRows: previewDiffRows,
      proofBadges: [
        { label: 'Evidence proof', value: evidenceProof.proofDigest, state: evidenceProof.decision },
        { label: 'Provider cursor', value: providerServiceContract.sync.nextCursor, state: providerServiceContract.sync.receiptStatus },
        { label: 'Restart safety', value: recovery.recoveryMode, state: recovery.restartSafe ? 'safe' : 'blocked' }
      ],
      visibleWarnings: [
        ...validation.warnings.slice(0, 3).map((issue) => issue.message),
        health.degradedMode ? `dependency health is ${health.status}` : null,
        operationalIncidentReport.severity === 'warning' ? operationalIncidentReport.escalation.reason : null
      ].filter(Boolean)
    },
    acceptance: {
      accepted,
      state: accepted ? 'ready_to_accept' : 'requires_attention',
      token: accepted ? continuation.acceptance.expectedToken : null,
      tokenState: continuation.acceptance.tokenState,
      submittedToken: continuation.acceptance.submitted ? 'present' : 'missing',
      resumeState: continuation.resumeState,
      requiredAcknowledgements: [
        validation.warnings.length > 0 ? 'validation_warnings_present' : null,
        health.degradedMode ? 'dependency_degraded_mode' : null,
        recovery.replay ? 'idempotent_replay' : null
      ].filter(Boolean),
      blockingReason: accepted ? null : firstBlockingReason({ boundary, validation, health, recovery, hostedKernelProjection }),
      form: acceptanceForm
    },
    readiness: {
      state: readinessGateSummary.state,
      summary: readinessGateSummary,
      checks: readinessChecks,
      nextAction: nextActionState.status,
      retryAfterMs: nextActionState.retryAfterMs
    },
    validationSummary,
    nextStep: {
      actor: nextActionState.actor,
      status: nextActionState.status,
      reason: nextActionState.primaryReason,
      allowedTransitions: nextActionState.allowedTransitions,
      providerCursor: providerServiceContract.sync.nextCursor,
      operationalState: operationalIncidentReport.state,
      operationalSeverity: operationalIncidentReport.severity,
      escalationOwner: operationalIncidentReport.escalation.owner,
      retryGate: operationalIncidentReport.retryGate,
      workflowRoute: clientWorkflowHandoff.destinationRoute,
      workflowAction: clientWorkflowHandoff.primaryAction.type,
      workflowHandoffToken: clientWorkflowHandoff.resume.handoffToken,
      clientContinuationState: continuation.continuationState,
      clientResumeState: continuation.resumeState,
      staleClientCursor: continuation.cursor.stale,
      routeHint: accepted
        ? 'submit_acceptance'
        : nextActionState.retryAfterMs > 0
          ? 'retry_after_dependency_check'
          : 'edit_request',
      steps: explainableNextSteps
    },
    operatorWorkflowHandoff,
    workflowHandoff: clientWorkflowHandoff
  };
}

export function describeVolatileFactCheckSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const principal = normalizePrincipal(input);
  const scope = normalizeFactScope(input);
  const boundary = evaluateBoundary(principal, scope, input.action, { input, now });
  const evidence = normalizeEvidence(input);
  const dependencies = normalizeDependencyHealth(input);
  const runtimeDependencies = buildDependencyRuntimeHealth({ dependencies, now });
  const retryPlan = buildRetryPlan({ dependencies: runtimeDependencies, retryPolicy: normalizeRetryPolicy(input) });
  const health = buildOperationalHealth({ boundary, dependencies: runtimeDependencies, retryPlan });
  const persistedState = normalizePersistedState(input, { now, scope });
  const command = buildCommandEnvelope({ input, principal, scope, boundary, evidence });
  const evidenceProof = buildEvidenceProof({ evidence, scope, input, now });
  const lifecycleSettings = normalizeLifecycleSettings(input, { now });
  const lifecycleCommand = normalizeLifecycleCommand({ input, boundary, scope, principal, settings: lifecycleSettings, now });
  const lifecycleControlState = normalizeLifecycleControlState(input, { scope });
  const lifecycleValidation = buildLifecycleValidation({ boundary, lifecycleSettings, lifecycleCommand, lifecycleControlState, health });
  const validation = buildMutationValidation({
    boundary,
    scope,
    evidence,
    evidenceProof,
    command,
    persistedState,
    lifecycleValidation
  });
  const actionableErrors = buildActionableErrors({ boundary, health, validation });
  const clientRuntime = normalizeClientRuntimeState(input);
  const auditHandoff = buildAuditHandoff({ now, principal, scope, boundary, evidence, command, evidenceProof, clientRuntime });
  const mailchimpFactHandoffBoundary = buildMailchimpFactHandoffBoundary({
    now,
    scope,
    principal,
    boundary,
    health,
    command,
    evidenceProof,
    clientRuntime
  });
  const recovery = buildStateRecovery({ persistedState, command, scope, health, boundary });
  const restartSafeStatus = buildRestartSafeStatus({ boundary, health, command, recovery });
  const hostedKernelProjection = buildHostedKernelProjection({
    now,
    scope,
    boundary,
    health,
    validation,
    command,
    evidenceProof,
    recovery,
    lifecycleSettings,
    lifecycleCommand,
    lifecycleControlState
  });
  const nextActionState = buildNextActionState({
    now,
    boundary,
    health,
    validation,
    command,
    recovery,
    lifecycleSettings,
    lifecycleCommand,
    hostedKernelProjection
  });
  const providerServiceContract = buildProviderServiceContract({
    input,
    now,
    scope,
    boundary,
    health,
    validation,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection,
    lifecycleCommand,
    nextActionState,
    auditHandoff,
    clientRuntime
  });
  const mailchimpFactAnalytics = buildMailchimpFactAnalyticsContract({
    now,
    scope,
    command,
    boundary,
    health,
    validation,
    evidenceProof,
    recovery,
    clientRuntime,
    mailchimpFactHandoffBoundary,
    providerServiceContract
  });
  const persistedStatePatch = buildPersistedStatePatch({
    now,
    persistedState,
    command,
    evidenceProof,
    recovery,
    lifecycleSettings,
    lifecycleControlState,
    hostedKernelProjection,
    providerServiceContract
  });
  const operationalIncidentReport = buildOperationalIncidentReport({
    now,
    boundary,
    health,
    validation,
    recovery,
    hostedKernelProjection,
    nextActionState,
    providerServiceContract
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    now,
    clientRuntime,
    scope,
    boundary,
    health,
    validation,
    command,
    recovery,
    hostedKernelProjection,
    lifecycleSettings,
    nextActionState,
    providerServiceContract
  });
  const analyticsCounters = buildAnalyticsCounters({
    boundary,
    health,
    validation,
    evidence,
    evidenceProof,
    persistedState,
    command,
    recovery,
    hostedKernelProjection,
    lifecycleSettings,
    lifecycleCommand,
    nextActionState
  });
  const historySnapshots = buildHistorySnapshots({
    now,
    persistedState,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection
  });
  const timelineReport = buildTimelineReport({
    now,
    boundary,
    health,
    validation,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection,
    lifecycleSettings,
    lifecycleCommand,
    nextActionState,
    mailchimpFactAnalytics
  });
  const exportReadySummary = buildExportReadySummary({
    now,
    scope,
    principal,
    boundary,
    command,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    evidenceProof,
    hostedKernelProjection,
    lifecycleSettings,
    nextActionState,
    mailchimpFactAnalytics
  });
  const analyticsExportReport = buildAnalyticsExportReport({
    input,
    now,
    scope,
    command,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    exportReadySummary,
    evidenceProof,
    hostedKernelProjection,
    providerServiceContract,
    mailchimpFactAnalytics
  });
  const reportingState = buildReportingState({
    input,
    now,
    scope,
    command,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    analyticsExportReport,
    exportReadySummary,
    providerServiceContract,
    operationalIncidentReport
  });
  const clientPreviewAcceptance = buildClientPreviewAcceptanceContract({
    now,
    scope,
    principal,
    boundary,
    health,
    validation,
    command,
    evidenceProof,
    recovery,
    hostedKernelProjection,
    lifecycleSettings,
    lifecycleCommand,
    nextActionState,
    providerServiceContract,
    clientRuntime,
    mailchimpFactHandoffBoundary,
    clientWorkflowHandoff,
    operationalIncidentReport
  });

  return {
    ok: boundary.allowed && validation.valid && health.failureState !== 'blocking' && recovery.restartSafe,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'volatile fact checks are scoped by tenant, workspace, memory namespace, and principal permissions',
    request: {
      action: boundary.action,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      memoryNamespace: scope.memoryNamespace,
      factId: scope.factId || null
    },
    principal: {
      id: principal.id,
      tenantId: principal.tenantId || null,
      workspaceIds: principal.workspaceIds,
      roles: principal.roles
    },
    boundary,
    health,
    validation,
    actionableErrors,
    evidence,
    evidenceProof,
    lifecycleSettings,
    lifecycleControlState,
    lifecycleCommand,
    command,
    persistedState: {
      schemaVersion: persistedState.schemaVersion,
      sourceSchemaVersion: persistedState.sourceSchemaVersion,
      bootId: persistedState.bootId,
      recoveredAt: persistedState.recoveredAt,
      journalCursor: persistedState.journalCursor,
      factCount: persistedState.facts.length,
      commandCount: persistedState.commandLedger.length,
      warnings: persistedState.warnings
    },
    recovery,
    restartSafeStatus,
    hostedKernelProjection,
    persistedStatePatch,
    nextActionState,
    clientRuntime,
    mailchimpFactHandoffBoundary,
    clientWorkflowHandoff,
    operatorWorkflowHandoff: clientPreviewAcceptance.operatorWorkflowHandoff,
    providerServiceContract,
    mailchimpFactAnalytics,
    operationalIncidentReport,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    exportReadySummary,
    analyticsExportReport,
    reportingState,
    clientPreviewAcceptance,
    proof: {
      surfaceId,
      generatedAt: now,
      scopeKey: buildScopeKey(scope),
      checkedEvidenceCount: evidence.length,
      auditHandoffRequired: inputRequiresAudit(boundary.action),
      degradedMode: health.degradedMode,
      failureState: health.failureState,
      retryable: health.retryPlan.enabled,
      retryPlan: health.retryPlan,
      dependencySummary: health.dependencySummary,
      validation,
      evidenceProof,
      lifecycleSettings,
      lifecycleControlState,
      lifecycleCommand,
      idempotencyKey: command.idempotencyKey,
      permissionProof: boundary.permissionProof,
      workspaceScopeProof: boundary.workspaceScopeProof,
      recoveryMode: recovery.recoveryMode,
      restartSafeStatus,
      hostedKernelProjection,
      persistedStatePatch,
      nextActionState,
      clientRuntime,
      clientWorkflowHandoff,
      operatorWorkflowHandoff: clientPreviewAcceptance.operatorWorkflowHandoff,
      providerServiceContract,
      mailchimpFactAnalytics,
      mailchimpFactHandoffBoundary,
      operationalIncidentReport,
      analyticsCounters,
      historySnapshots,
      timelineReport,
      exportReadySummary,
      analyticsExportReport,
      reportingState,
      clientPreviewAcceptance,
      mailchimpFactHandoffBoundary,
      auditHandoff
    }
  };
}

export default describeVolatileFactCheckSurface;
