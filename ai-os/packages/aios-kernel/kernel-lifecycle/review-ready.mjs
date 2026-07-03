export const surfaceId = "aios_kernel-lifecycle_review-ready_010";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "review-ready";

const CURRENT_SCHEMA_VERSION = 1;
const READY_STATUSES = new Set(['review-ready', 'ready']);
const BLOCKED_STATUSES = new Set(['blocked', 'failed', 'error', 'degraded']);
const DEFAULT_CHECKS = ['boot-proof', 'state-persistence', 'recovery-proof'];
const READINESS_GATE_LABELS = {
  lifecycle: 'Lifecycle enabled',
  health: 'Operational health clear',
  proofs: 'Required proofs recorded',
  recovery: 'Recovery clear',
  providers: 'Provider contracts ready',
  audit: 'Audit handoff ready'
};
const DEFAULT_TENANT_ID = 'hosted-kernel';
const DEFAULT_WORKSPACE_ID = 'kernel-lifecycle';
const DEFAULT_SETTINGS = {
  enabled: true,
  autoSeal: false,
  requireRecoveryProof: true,
  minProofRefs: 1,
  reviewCadenceMinutes: 60
};
const SETTINGS_LIMITS = {
  minProofRefs: { min: 1, max: 10 },
  reviewCadenceMinutes: { min: 5, max: 10080 }
};
const ROLE_PERMISSIONS = {
  'kernel-auditor': ['audit:read'],
  'kernel-reviewer': ['audit:read', 'check:record', 'review:seal'],
  'kernel-operator': ['audit:read', 'check:record', 'recovery:write', 'review:seal', 'settings:write']
};
const COMMAND_PERMISSIONS = {
  'record-check': 'check:record',
  'record-health-error': 'check:record',
  'retry-health-error': 'recovery:write',
  'clear-health-error': 'recovery:write',
  'mark-recovery-required': 'recovery:write',
  'mark-recovered': 'recovery:write',
  'seal-review-ready': 'review:seal',
  'set-lifecycle-enabled': 'settings:write',
  'update-lifecycle-settings': 'settings:write',
  'schedule-review-window': 'settings:write',
  'sync-provider-contracts': 'settings:write'
};
const READ_ONLY_COMMANDS = new Set(['describe-review-ready', 'recover-review-ready']);
const PROVIDER_REQUIREMENTS = {
  proof: ['proof.read', 'proof.write'],
  state: ['state.persist', 'state.restore'],
  recovery: ['recovery.write'],
  audit: ['audit.handoff']
};
const CLIENT_RUNTIME_REQUIREMENTS = ['state.preview', 'workflow.handoff', 'command.submit'];
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterRatio: 0
};

function timestamp(input) {
  return input || new Date().toISOString();
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, '')).filter(Boolean))]
    : [];
}

function integerSetting(value, fallback, limits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.trunc(number);
  if (rounded < limits.min) return limits.min;
  if (rounded > limits.max) return limits.max;
  return rounded;
}

function booleanSetting(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function permissionsForRoles(roles) {
  return [
    ...new Set(
      roles.flatMap((role) => ROLE_PERMISSIONS[role] || [])
    )
  ].sort();
}

function normalizeActor(value, fallbackRoles = ['kernel-operator']) {
  const actor = asRecord(value);
  const roles = stringList(actor.roles || actor.role ? actor.roles || [actor.role] : fallbackRoles);
  const explicitPermissions = stringList(actor.permissions);
  return {
    id: text(actor.id || actor.actorId || actor.subject, 'kernel-service'),
    roles,
    permissions: [...new Set([...permissionsForRoles(roles), ...explicitPermissions])].sort()
  };
}

function normalizeTenantContext(input = {}) {
  const source = asRecord(input.tenant || input.tenantContext || input.context);
  const workspace = asRecord(input.workspace || source.workspace);
  return {
    tenantId: text(input.tenantId || source.tenantId || source.id, DEFAULT_TENANT_ID),
    workspaceId: text(input.workspaceId || workspace.workspaceId || workspace.id, DEFAULT_WORKSPACE_ID),
    region: text(input.region || source.region, 'local'),
    isolationKey: text(
      input.isolationKey || source.isolationKey,
      `${text(input.tenantId || source.tenantId || source.id, DEFAULT_TENANT_ID)}:${text(
        input.workspaceId || workspace.workspaceId || workspace.id,
        DEFAULT_WORKSPACE_ID
      )}`
    )
  };
}

function tenantMatches(stateTenant, commandTenant) {
  return stateTenant.tenantId === commandTenant.tenantId
    && stateTenant.workspaceId === commandTenant.workspaceId
    && stateTenant.isolationKey === commandTenant.isolationKey;
}

function boundaryDecision(actor, commandName, stateTenant, commandTenant) {
  const requiredPermission = COMMAND_PERMISSIONS[commandName] || null;
  const violations = [];
  if (!tenantMatches(stateTenant, commandTenant)) violations.push('tenant-boundary-mismatch');
  if (requiredPermission && !actor.permissions.includes(requiredPermission)) {
    violations.push(`missing-permission:${requiredPermission}`);
  }
  return {
    allowed: violations.length === 0,
    requiredPermission,
    violations
  };
}

function normalizeWorkspacePolicy(value, tenant) {
  const source = asRecord(value);
  const allowedTenantIds = stringList(source.allowedTenantIds || source.tenants);
  const allowedWorkspaceIds = stringList(source.allowedWorkspaceIds || source.workspaces);
  const allowedIsolationKeys = stringList(source.allowedIsolationKeys || source.isolationKeys);
  const deniedCommands = stringList(source.deniedCommands || source.blockedCommands);
  const permittedCommands = stringList(source.permittedCommands || source.allowedCommands);
  return {
    schema: 'aios.review-ready.workspace-policy.v1',
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    mode: text(source.mode, booleanSetting(source.readOnly, false) ? 'read-only' : 'active'),
    allowedTenantIds: allowedTenantIds.length > 0 ? allowedTenantIds : [tenant.tenantId],
    allowedWorkspaceIds: allowedWorkspaceIds.length > 0 ? allowedWorkspaceIds : [tenant.workspaceId],
    allowedIsolationKeys: allowedIsolationKeys.length > 0 ? allowedIsolationKeys : [tenant.isolationKey],
    permittedCommands,
    deniedCommands,
    readOnly: booleanSetting(source.readOnly, false),
    auditRequired: booleanSetting(source.auditRequired, true),
    crossWorkspaceCommands: booleanSetting(source.crossWorkspaceCommands, false),
    reason: text(source.reason, 'workspace-boundary-policy')
  };
}

function workspacePolicyViolations(policy, tenant) {
  const violations = [];
  if (!policy.allowedTenantIds.includes(tenant.tenantId)) violations.push('workspace-policy-tenant-denied');
  if (!policy.allowedWorkspaceIds.includes(tenant.workspaceId)) violations.push('workspace-policy-workspace-denied');
  if (!policy.allowedIsolationKeys.includes(tenant.isolationKey)) violations.push('workspace-policy-isolation-denied');
  return violations;
}

function workspaceScopeFrom({ tenant, actor, policy }) {
  const policyViolations = workspacePolicyViolations(policy, tenant);
  const auditReadable = actor.permissions.includes('audit:read');
  const writable = actor.permissions.some((permission) => permission === 'check:record' || permission === 'recovery:write');
  const configurable = actor.permissions.includes('settings:write');
  const sealable = actor.permissions.includes('review:seal');
  return {
    schema: 'aios.review-ready.workspace-scope.v1',
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    policyMode: policy.mode,
    allowed: policyViolations.length === 0,
    readOnly: policy.readOnly || policy.mode === 'read-only',
    auditReadable,
    writable: policy.readOnly ? false : writable,
    configurable: policy.readOnly ? false : configurable,
    sealable: policy.readOnly ? false : sealable,
    permittedCommands: policy.permittedCommands,
    deniedCommands: policy.deniedCommands,
    violations: policyViolations,
    boundaryRef: digest({
      tenantId: tenant.tenantId,
      workspaceId: tenant.workspaceId,
      isolationKey: tenant.isolationKey,
      policyMode: policy.mode,
      readOnly: policy.readOnly,
      allowedTenantIds: policy.allowedTenantIds,
      allowedWorkspaceIds: policy.allowedWorkspaceIds,
      allowedIsolationKeys: policy.allowedIsolationKeys,
      permittedCommands: policy.permittedCommands,
      deniedCommands: policy.deniedCommands
    })
  };
}

function commandWorkspaceViolations(commandName, workspaceScope) {
  const violations = stringList(workspaceScope.violations);
  if (!workspaceScope.allowed) violations.push('workspace-scope-denied');
  if (workspaceScope.readOnly && !READ_ONLY_COMMANDS.has(commandName)) violations.push('workspace-scope-read-only');
  if (workspaceScope.deniedCommands.includes(commandName)) violations.push(`workspace-command-denied:${commandName}`);
  if (workspaceScope.permittedCommands.length > 0 && !workspaceScope.permittedCommands.includes(commandName)) {
    violations.push(`workspace-command-not-permitted:${commandName}`);
  }
  return [...new Set(violations)].sort();
}

function asEvidenceList(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          type: String(entry.type || entry.kind || 'evidence'),
          ref: String(entry.ref || entry.path || entry.id || 'unreferenced'),
          capturedAt: timestamp(entry.capturedAt)
        }))
    : [];
}

function proofRef(value, fallback = null) {
  const ref = text(value, fallback);
  if (!ref) return null;
  return ref.includes(':') ? ref : `proof://${surfaceGroup}/${surfaceName}/${ref}`;
}

function normalizeProofRefs(value) {
  return stringList(Array.isArray(value) ? value : [value])
    .map((ref) => proofRef(ref))
    .filter(Boolean);
}

function proofRefsFromEvidence(evidence, proofType) {
  return evidence
    .filter((entry) => entry.type === proofType || entry.type === 'proof')
    .map((entry) => proofRef(entry.ref))
    .filter(Boolean);
}

function normalizeCommandLedger(value) {
  const ledger = asRecord(value);
  return Object.fromEntries(
    Object.entries(ledger)
      .filter(([key, entry]) => key && entry && typeof entry === 'object')
      .map(([key, entry]) => [
        key,
        {
          command: String(entry.command || 'unknown'),
          status: String(entry.status || 'accepted'),
          appliedAt: timestamp(entry.appliedAt),
          actorId: entry.actorId ? String(entry.actorId) : null,
          tenantId: entry.tenantId ? String(entry.tenantId) : null,
          workspaceId: entry.workspaceId ? String(entry.workspaceId) : null,
          violations: stringList(entry.violations)
        }
      ])
  );
}

function normalizeProviderContracts(value, now) {
  const providers = Array.isArray(value) ? value : Object.values(asRecord(value));
  return providers
    .filter((provider) => provider && typeof provider === 'object')
    .map((provider) => {
      const capabilities = stringList(provider.capabilities || provider.supportedCapabilities);
      const requirementEntries = Object.entries(PROVIDER_REQUIREMENTS);
      const missingCapabilities = requirementEntries.flatMap(([domain, required]) => (
        required.filter((capability) => !capabilities.includes(capability)).map((capability) => `${domain}:${capability}`)
      ));
      const sync = asRecord(provider.sync || provider.syncMetadata);
      const lastSyncedAt = sync.lastSyncedAt ? timestamp(sync.lastSyncedAt) : null;
      const status = text(sync.status, lastSyncedAt ? 'synced' : 'unsynced');
      return {
        providerId: text(provider.providerId || provider.id || provider.name, 'hosted-kernel-provider'),
        service: text(provider.service || provider.kind, 'kernel-lifecycle'),
        contractVersion: text(provider.contractVersion || provider.version, 'aios.provider.review-ready.v1'),
        endpoint: text(provider.endpoint || provider.url, 'local://kernel-lifecycle/review-ready'),
        capabilities,
        requiredCapabilities: Object.values(PROVIDER_REQUIREMENTS).flat(),
        missingCapabilities,
        negotiation: {
          accepted: missingCapabilities.length === 0,
          status: missingCapabilities.length === 0 ? 'accepted' : 'capability-gap',
          negotiatedAt: timestamp(provider.negotiatedAt || now),
          canSyncProofs: capabilities.includes('proof.read') && capabilities.includes('proof.write'),
          canRestoreState: capabilities.includes('state.restore'),
          canHandoffAudit: capabilities.includes('audit.handoff')
        },
        sync: {
          status,
          cursor: text(sync.cursor || provider.cursor, null),
          lastSyncedAt,
          requestedAt: timestamp(sync.requestedAt || now),
          stale: !lastSyncedAt || status === 'stale' || status === 'failed'
        },
        handoff: {
          externalRef: text(provider.externalRef || provider.handoffRef, null),
          state: text(provider.handoffState || provider.state, missingCapabilities.length === 0 ? 'ready' : 'blocked')
        }
      };
    })
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function normalizeClientRuntime({ input = {}, persisted = {}, tenant, actor, now }) {
  const source = asRecord(input.clientRuntime || input.client || input.request || persisted);
  const session = asRecord(source.session || input.session);
  const request = asRecord(source.request || input.request);
  const routes = asRecord(source.routes || request.routes || input.routes);
  const capabilities = stringList(source.capabilities || source.supportedCapabilities || input.clientCapabilities);
  const requiredCapabilities = stringList(source.requiredCapabilities).length > 0
    ? stringList(source.requiredCapabilities)
    : CLIENT_RUNTIME_REQUIREMENTS;
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const route = text(source.route || request.route || input.route, `/kernel-lifecycle/${surfaceName}`);
  const previewRoute = text(
    source.previewRoute || routes.preview || input.previewRoute,
    `${route}/preview`
  );
  const handoffRoute = text(
    source.handoffRoute || routes.handoff || input.handoffRoute,
    `${route}/handoff`
  );
  const commandRoute = text(
    source.commandRoute || routes.command || input.commandRoute,
    `${route}/commands`
  );
  const returnRoute = text(
    source.returnRoute || routes.return || request.returnTo || input.returnRoute,
    handoffRoute
  );
  const requestId = text(
    source.requestId || request.requestId || request.id || input.requestId,
    `${tenant.isolationKey}:${surfaceName}:request:${digest({
      route,
      actorId: actor.id,
      tenantId: tenant.tenantId,
      workspaceId: tenant.workspaceId
    })}`
  );
  return {
    schema: 'aios.review-ready.client-runtime.v1',
    clientId: text(source.clientId || source.id || input.clientId, 'hosted-kernel-client'),
    sessionId: text(source.sessionId || session.sessionId || session.id || input.sessionId, 'local-session'),
    requestId,
    correlationId: text(source.correlationId || request.correlationId || input.correlationId, requestId),
    route,
    routes: {
      preview: previewRoute,
      handoff: handoffRoute,
      command: commandRoute,
      return: returnRoute
    },
    origin: text(source.origin || request.origin || input.origin, 'local://aios'),
    interactionMode: text(source.interactionMode || source.mode || input.interactionMode, 'operator-workbench'),
    capabilities,
    requiredCapabilities,
    missingCapabilities,
    canSubmitCommands: capabilities.includes('command.submit') && missingCapabilities.length === 0,
    canRenderPreview: capabilities.includes('state.preview'),
    canRenderAuditHandoff: capabilities.includes('audit.handoff.view') || capabilities.includes('workflow.handoff'),
    handoffPreference: text(source.handoffPreference || source.handoffMode, 'guided'),
    requestedView: text(source.requestedView || request.view || input.requestedView, 'review-ready'),
    stateVersion: text(source.stateVersion || request.stateVersion || input.stateVersion, null),
    lastSeenAt: timestamp(source.lastSeenAt || request.receivedAt || now)
  };
}

function normalizeRetryPolicy(value = {}) {
  const source = asRecord(value);
  const maxAttempts = boundedNumber(source.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts, 1, 12);
  const baseDelayMs = boundedNumber(source.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs, 100, 300000);
  const maxDelayMs = boundedNumber(source.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs, baseDelayMs, 900000);
  const jitterRatio = Math.min(0.5, Math.max(0, Number(source.jitterRatio ?? DEFAULT_RETRY_POLICY.jitterRatio) || 0));
  return { maxAttempts, baseDelayMs, maxDelayMs, jitterRatio };
}

function retryDueAt(occurredAt, attemptCount, policy) {
  const attempt = Math.max(1, attemptCount + 1);
  const delayMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)));
  const due = new Date(Date.parse(timestamp(occurredAt)) + delayMs);
  return Number.isNaN(due.getTime()) ? null : due.toISOString();
}

function normalizeHealthIncident(value, index, now, policy, source = 'operator') {
  const incident = asRecord(value);
  const severity = text(incident.severity || incident.level, 'warning');
  const attemptCount = boundedNumber(incident.attemptCount ?? incident.attempts, 0, 0, 99);
  const retryable = booleanSetting(incident.retryable, severity !== 'fatal');
  const resolvedAt = incident.resolvedAt ? timestamp(incident.resolvedAt) : null;
  const occurredAt = timestamp(incident.occurredAt || incident.detectedAt || now);
  const exhausted = retryable && attemptCount >= policy.maxAttempts && !resolvedAt;
  const code = text(incident.code || incident.errorCode || incident.kind, `health-error-${index + 1}`);
  return {
    incidentId: text(incident.incidentId || incident.id, `${source}:${code}:${occurredAt}`),
    source: text(incident.source, source),
    code,
    message: text(incident.message || incident.detail, 'Operational health error requires review.'),
    severity: ['fatal', 'blocking', 'warning', 'info'].includes(severity) ? severity : 'warning',
    retryable,
    attemptCount,
    occurredAt,
    resolvedAt,
    nextRetryAt: retryable && !resolvedAt && !exhausted
      ? text(incident.nextRetryAt, retryDueAt(occurredAt, attemptCount, policy))
      : null,
    exhausted,
    action: text(incident.action || incident.recoveryAction, retryable ? 'retry-operation' : 'operator-investigation'),
    proofRef: proofRef(incident.proofRef || incident.proof, null)
  };
}

function providerHealthIncidents(providers, now) {
  return providers.flatMap((provider) => {
    const incidents = [];
    if (provider.missingCapabilities.length > 0) {
      incidents.push({
        id: `provider-capability:${provider.providerId}`,
        source: 'provider-contract',
        code: 'provider-capability-gap',
        message: `${provider.providerId} is missing required lifecycle capabilities.`,
        severity: 'blocking',
        retryable: false,
        occurredAt: provider.negotiation.negotiatedAt || now,
        action: 'sync-provider-contracts',
        proofRef: provider.handoff.externalRef
      });
    }
    if (provider.sync.stale) {
      incidents.push({
        id: `provider-sync:${provider.providerId}`,
        source: 'provider-sync',
        code: 'provider-sync-stale',
        message: `${provider.providerId} contract sync is stale or failed.`,
        severity: 'warning',
        retryable: true,
        attemptCount: 0,
        occurredAt: provider.sync.lastSyncedAt || provider.sync.requestedAt || now,
        action: 'sync-provider-contracts',
        proofRef: provider.handoff.externalRef
      });
    }
    return incidents;
  });
}

function normalizeOperationalHealth({ input = {}, persisted = {}, providers = [], now }) {
  const source = asRecord(persisted);
  const policy = normalizeRetryPolicy(input.retryPolicy || input.operationalHealth?.retryPolicy || source.retryPolicy);
  const rawIncidents = [
    ...(Array.isArray(source.incidents) ? source.incidents : Object.values(asRecord(source.incidents))),
    ...asEvidenceList(source.errors).map((entry) => ({ ...entry, code: entry.type, message: entry.ref })),
    ...stringList(source.actionableErrors).map((code) => ({ code, source: 'persisted-action' })),
    ...(Array.isArray(input.operationalHealth?.incidents)
      ? input.operationalHealth.incidents
      : Object.values(asRecord(input.operationalHealth?.incidents))),
    ...asEvidenceList(input.healthErrors || input.operationalErrors).map((entry) => ({
      code: entry.type,
      message: entry.ref,
      occurredAt: entry.capturedAt
    })),
    ...providerHealthIncidents(providers, now)
  ];
  const incidents = [
    ...new Map(
      rawIncidents
        .map((incident, index) => normalizeHealthIncident(incident, index, now, policy, incident.source))
        .map((incident) => [incident.incidentId, incident])
    ).values()
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const active = incidents.filter((incident) => !incident.resolvedAt);
  const blocking = active.filter((incident) => incident.severity === 'blocking' || incident.severity === 'fatal' || incident.exhausted);
  const retryQueue = active
    .filter((incident) => incident.retryable && incident.nextRetryAt)
    .map((incident) => ({
      incidentId: incident.incidentId,
      command: incident.action === 'sync-provider-contracts' ? 'sync-provider-contracts' : 'retry-health-error',
      dueAt: incident.nextRetryAt,
      attempt: incident.attemptCount + 1,
      maxAttempts: policy.maxAttempts,
      code: incident.code
    }))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  return {
    schema: 'aios.review-ready.operational-health.v1',
    status: blocking.length > 0 ? 'failed' : active.length > 0 ? 'degraded' : 'healthy',
    degradedMode: active.length > 0,
    failed: blocking.length > 0,
    checkedAt: timestamp(now),
    retryPolicy: policy,
    activeIncidentCount: active.length,
    exhaustedRetryCount: active.filter((incident) => incident.exhausted).length,
    incidents,
    retryQueue,
    actionableErrors: active.map((incident) => ({
      code: incident.code,
      incidentId: incident.incidentId,
      message: incident.message,
      severity: incident.severity,
      command: incident.action,
      retryable: incident.retryable,
      attemptCount: incident.attemptCount,
      attemptsRemaining: incident.retryable ? Math.max(0, policy.maxAttempts - incident.attemptCount) : 0,
      nextRetryAt: incident.nextRetryAt,
      blockedBy: incident.exhausted ? ['retry-attempts-exhausted'] : [incident.code]
    }))
  };
}

function retryHealthIncident({ incident, command, appliedAt, policy }) {
  const retrySucceeded = booleanSetting(command.ok ?? command.resolved ?? command.success, false);
  const nextAttemptCount = incident.attemptCount + 1;
  const proof = proofRef(command.proofRef || command.proof || incident.proofRef, incident.proofRef);
  const nextRetryAt = retrySucceeded ? null : text(command.nextRetryAt, retryDueAt(appliedAt, nextAttemptCount, policy));
  const message = retrySucceeded
    ? text(command.message || command.detail, `Retry resolved ${incident.code}.`)
    : text(command.message || command.detail, incident.message);
  return normalizeHealthIncident({
    ...incident,
    message,
    severity: command.severity || incident.severity,
    retryable: command.retryable ?? incident.retryable,
    attemptCount: nextAttemptCount,
    occurredAt: incident.occurredAt,
    resolvedAt: retrySucceeded ? appliedAt : incident.resolvedAt,
    nextRetryAt,
    action: command.action || command.recoveryAction || incident.action,
    proofRef: proof
  }, 0, appliedAt, policy, incident.source);
}

function providerContractSummary(providers = []) {
  const accepted = providers.filter((provider) => provider.negotiation.accepted);
  const stale = providers.filter((provider) => provider.sync.stale);
  const missingCapabilities = [
    ...new Set(providers.flatMap((provider) => provider.missingCapabilities))
  ].sort();
  return {
    providerCount: providers.length,
    acceptedProviderCount: accepted.length,
    staleProviderCount: stale.length,
    missingCapabilities,
    readyForExternalHandoff: providers.length > 0
      && accepted.length === providers.length
      && stale.length === 0
      && providers.some((provider) => provider.negotiation.canHandoffAudit)
  };
}

function buildOperationalHealthRunbook(health, generatedAt) {
  const active = health.incidents.filter((incident) => !incident.resolvedAt);
  const severityCounts = active.reduce((counts, incident) => ({
    ...counts,
    [incident.severity]: (counts[incident.severity] || 0) + 1
  }), {});
  const retryCommands = health.retryQueue.map((retry) => ({
    command: retry.command,
    incidentId: retry.incidentId,
    code: retry.code,
    dueAt: retry.dueAt,
    payload: {
      command: retry.command,
      incidentId: retry.incidentId,
      attemptCount: retry.attempt,
      expectedMaxAttempts: retry.maxAttempts
    }
  }));
  const blockedBy = [
    ...(health.failed ? ['operational-health-failed'] : []),
    ...(health.degradedMode ? ['operational-health-degraded'] : []),
    ...health.actionableErrors.flatMap((error) => error.blockedBy)
  ];
  return {
    schema: 'aios.review-ready.operational-health-runbook.v1',
    generatedAt,
    status: health.status,
    degradedMode: health.degradedMode,
    failureState: health.failed ? 'blocking' : health.degradedMode ? 'degraded' : 'clear',
    severityCounts,
    retryPolicy: health.retryPolicy,
    retryCommands,
    blockedBy: [...new Set(blockedBy)].sort(),
    degradedModeControls: {
      allowPreview: true,
      allowAuditHandoff: !health.failed && !health.degradedMode,
      allowSealReviewReady: !health.failed && !health.degradedMode,
      requiredClearCommand: health.failed || health.degradedMode ? 'clear-health-error' : null
    }
  };
}

function buildProviderServiceContract({ providers = [], tenant, clientRuntime, updatedAt }) {
  const providerSummary = providerContractSummary(providers);
  const requiredCapabilities = Object.values(PROVIDER_REQUIREMENTS).flat();
  const advertisedCapabilities = [...new Set(providers.flatMap((provider) => provider.capabilities))].sort();
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !advertisedCapabilities.includes(capability))
    .map((capability) => {
      const domain = Object.entries(PROVIDER_REQUIREMENTS)
        .find(([, capabilities]) => capabilities.includes(capability))?.[0] || 'provider';
      return `${domain}:${capability}`;
    });
  const capabilityMatrix = Object.fromEntries(
    Object.entries(PROVIDER_REQUIREMENTS).map(([domain, required]) => {
      const providersWithDomain = providers.filter((provider) => (
        required.every((capability) => provider.capabilities.includes(capability))
      ));
      return [
        domain,
        {
          required,
          providerIds: providersWithDomain.map((provider) => provider.providerId),
          satisfied: providersWithDomain.length > 0,
          missing: required.filter((capability) => !advertisedCapabilities.includes(capability))
        }
      ];
    })
  );
  const providerSyncStates = providers.map((provider) => ({
    providerId: provider.providerId,
    service: provider.service,
    endpoint: provider.endpoint,
    contractVersion: provider.contractVersion,
    status: provider.sync.status,
    cursor: provider.sync.cursor,
    lastSyncedAt: provider.sync.lastSyncedAt,
    stale: provider.sync.stale,
    negotiationStatus: provider.negotiation.status,
    handoffState: provider.handoff.state,
    externalRef: provider.handoff.externalRef
  }));
  const readyProviderIds = providers
    .filter((provider) => provider.negotiation.accepted && !provider.sync.stale)
    .map((provider) => provider.providerId);
  const handoffTargets = providers
    .filter((provider) => provider.negotiation.canHandoffAudit)
    .map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      endpoint: provider.endpoint,
      externalRef: provider.handoff.externalRef,
      state: provider.negotiation.accepted && !provider.sync.stale ? provider.handoff.state : 'blocked'
    }));
  const blockedBy = [
    ...(providers.length === 0 ? ['provider-contract-missing'] : []),
    ...providerSummary.missingCapabilities,
    ...missingCapabilities,
    ...(providerSummary.staleProviderCount > 0 ? ['provider-sync-stale'] : []),
    ...(handoffTargets.length === 0 ? ['audit-handoff-provider-missing'] : [])
  ];
  const state = blockedBy.length === 0 ? 'ready' : providerSummary.missingCapabilities.length > 0 || missingCapabilities.length > 0 ? 'negotiation-required' : 'sync-required';
  return {
    schema: 'aios.review-ready.provider-service-contract.v1',
    contractId: `${tenant.isolationKey}:${surfaceName}:providers:${digest({
      providerIds: providers.map((provider) => provider.providerId),
      requiredCapabilities,
      advertisedCapabilities,
      sync: providerSyncStates.map((provider) => [provider.providerId, provider.status, provider.cursor])
    })}`,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    generatedAt: updatedAt,
    providerCount: providers.length,
    acceptedProviderCount: providerSummary.acceptedProviderCount,
    staleProviderCount: providerSummary.staleProviderCount,
    readyProviderIds,
    requiredCapabilities,
    advertisedCapabilities,
    missingCapabilities: [...new Set([...providerSummary.missingCapabilities, ...missingCapabilities])].sort(),
    capabilityMatrix,
    negotiation: {
      status: state === 'ready' ? 'accepted' : 'attention-required',
      state,
      clientRequestId: clientRuntime.requestId,
      canSyncProofs: Boolean(capabilityMatrix.proof?.satisfied),
      canRestoreState: Boolean(capabilityMatrix.state?.satisfied),
      canWriteRecovery: Boolean(capabilityMatrix.recovery?.satisfied),
      canHandoffAudit: Boolean(capabilityMatrix.audit?.satisfied)
    },
    syncMetadata: {
      requestedAt: updatedAt,
      cursors: providerSyncStates.map((provider) => ({
        providerId: provider.providerId,
        cursor: provider.cursor,
        status: provider.status,
        lastSyncedAt: provider.lastSyncedAt,
        stale: provider.stale
      })),
      globalCursor: digest(providerSyncStates.map((provider) => ({
        providerId: provider.providerId,
        cursor: provider.cursor,
        status: provider.status,
        lastSyncedAt: provider.lastSyncedAt
      }))),
      staleProviderIds: providerSyncStates.filter((provider) => provider.stale).map((provider) => provider.providerId)
    },
    externalHandoff: {
      state,
      handoffRef: `${tenant.isolationKey}:${surfaceName}:external-handoff:${updatedAt}`,
      targetCount: handoffTargets.length,
      targets: handoffTargets,
      blockedBy: [...new Set(blockedBy)].sort()
    },
    providerSyncStates
  };
}

function normalizeChecks(value) {
  const source = asRecord(value);
  return Object.fromEntries(
    DEFAULT_CHECKS.map((name) => {
      const check = asRecord(source[name]);
      return [
        name,
        {
          ok: Boolean(check.ok),
          proof: typeof check.proof === 'string' && check.proof.length > 0 ? check.proof : null,
          observedAt: check.observedAt ? timestamp(check.observedAt) : null
        }
      ];
    })
  );
}

function normalizeLifecycleSettings(value = {}) {
  const source = asRecord(value);
  const merged = { ...DEFAULT_SETTINGS, ...source };
  const settings = {
    enabled: booleanSetting(merged.enabled, DEFAULT_SETTINGS.enabled),
    autoSeal: booleanSetting(merged.autoSeal, DEFAULT_SETTINGS.autoSeal),
    requireRecoveryProof: booleanSetting(merged.requireRecoveryProof, DEFAULT_SETTINGS.requireRecoveryProof),
    minProofRefs: integerSetting(merged.minProofRefs, DEFAULT_SETTINGS.minProofRefs, SETTINGS_LIMITS.minProofRefs),
    reviewCadenceMinutes: integerSetting(
      merged.reviewCadenceMinutes,
      DEFAULT_SETTINGS.reviewCadenceMinutes,
      SETTINGS_LIMITS.reviewCadenceMinutes
    )
  };
  const violations = [];
  if (Number(source.minProofRefs) !== settings.minProofRefs && source.minProofRefs !== undefined) {
    violations.push(`minProofRefs-clamped:${settings.minProofRefs}`);
  }
  if (Number(source.reviewCadenceMinutes) !== settings.reviewCadenceMinutes && source.reviewCadenceMinutes !== undefined) {
    violations.push(`reviewCadenceMinutes-clamped:${settings.reviewCadenceMinutes}`);
  }
  if (
    source.enabled !== undefined
    && booleanSetting(source.enabled, DEFAULT_SETTINGS.enabled) !== Boolean(source.enabled)
    && typeof source.enabled !== 'boolean'
  ) {
    violations.push(`enabled-coerced:${settings.enabled}`);
  }
  return {
    ...settings,
    validation: {
      ok: violations.length === 0,
      violations
    }
  };
}

function normalizeRecoveryState({ input = {}, persisted = {}, evidence = [], now }) {
  const source = asRecord(persisted);
  const proofRefs = [
    ...normalizeProofRefs(source.proofRefs || source.proofRef || source.proof),
    ...normalizeProofRefs(input.recoveryProofRefs || input.recoveryProofRef || input.recoveryProof),
    ...proofRefsFromEvidence(evidence, 'recovery-proof')
  ];
  const required = Boolean(input.recoveryRequired ?? source.required ?? false);
  const recoveredAt = input.recoveredAt || source.recoveredAt || null;
  return {
    required,
    reason: text(input.recoveryReason || source.reason, required ? 'unspecified' : null),
    recoveredAt: recoveredAt ? timestamp(recoveredAt) : null,
    proofRefs: [...new Set(proofRefs)].sort(),
    proofRequired: Boolean(input.requireRecoveryProof ?? source.proofRequired ?? false),
    proofStatus: required
      ? 'blocked'
      : recoveredAt && proofRefs.length === 0
        ? 'missing'
        : recoveredAt
          ? 'recorded'
          : 'not-applicable',
    lastEvaluatedAt: timestamp(now)
  };
}

function normalizedScheduleDate(value) {
  const raw = text(value, null);
  if (!raw) return { raw: null, value: null, valid: true };
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed)
    ? { raw, value: new Date(parsed).toISOString(), valid: true }
    : { raw, value: null, valid: false };
}

function normalizeReviewSchedule(value = {}, now) {
  const source = asRecord(value);
  const scheduled = normalizedScheduleDate(source.scheduledFor || source.nextReviewAt);
  const lastReviewed = normalizedScheduleDate(source.lastReviewedAt);
  const enabled = normalizedScheduleDate(source.enabledUntil);
  const paused = normalizedScheduleDate(source.pausedUntil);
  const scheduledFor = scheduled.value;
  const lastReviewedAt = lastReviewed.value;
  const enabledUntil = enabled.value;
  const pausedUntil = paused.value;
  const nowText = timestamp(now);
  const due = scheduledFor ? scheduledFor <= nowText : false;
  const validationViolations = [
    ...(!scheduled.valid ? [`scheduledFor-invalid:${scheduled.raw}`] : []),
    ...(!lastReviewed.valid ? [`lastReviewedAt-invalid:${lastReviewed.raw}`] : []),
    ...(!enabled.valid ? [`enabledUntil-invalid:${enabled.raw}`] : []),
    ...(!paused.valid ? [`pausedUntil-invalid:${paused.raw}`] : []),
    ...(pausedUntil && enabledUntil && pausedUntil > enabledUntil ? ['pausedUntil-after-enabledUntil'] : []),
    ...(enabledUntil && enabledUntil <= nowText ? ['enabledUntil-expired'] : [])
  ];
  return {
    schema: 'aios.review-ready.schedule.v1',
    scheduledFor,
    lastReviewedAt,
    enabledUntil,
    pausedUntil,
    due,
    activeWindow: Boolean(!pausedUntil || pausedUntil <= nowText) && Boolean(!enabledUntil || enabledUntil > nowText),
    reason: text(source.reason, scheduledFor ? 'operator-scheduled' : 'unscheduled'),
    validation: {
      ok: validationViolations.length === 0,
      violations: validationViolations
    }
  };
}

function addMinutesIso(value, minutes) {
  const startMs = Date.parse(timestamp(value));
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + (minutes * 60000)).toISOString();
}

function commandControl({ state, command, label, enabled, payload = {}, blockedBy = [] }) {
  const permission = COMMAND_PERMISSIONS[command] || null;
  const permissionBlockedBy = permission && !state.actor.permissions.includes(permission)
    ? [`missing-permission:${permission}`]
    : [];
  const workspaceBlockedBy = commandWorkspaceViolations(command, state.workspaceScope);
  const allBlockedBy = [...new Set([...stringList(blockedBy), ...permissionBlockedBy, ...workspaceBlockedBy])].sort();
  return {
    command,
    label,
    enabled: Boolean(enabled) && allBlockedBy.length === 0,
    permission,
    idempotencyKey: `${state.tenant.isolationKey}:${surfaceName}:control:${command}:${digest(payload)}`,
    route: state.clientRuntime.routes.command,
    payload: {
      command,
      tenantId: state.tenant.tenantId,
      workspaceId: state.tenant.workspaceId,
      isolationKey: state.tenant.isolationKey,
      ...payload
    },
    blockedBy: allBlockedBy
  };
}

function buildLifecycleControlPanel({ state, nextAction, readinessGates }) {
  const settingsViolations = stringList(state.settings.validation?.violations);
  const scheduleViolations = stringList(state.schedule.validation?.violations);
  const unresolvedGates = readinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate);
  const suggestedReviewAt = state.schedule.scheduledFor
    || addMinutesIso(state.schedule.lastReviewedAt || state.updatedAt, state.settings.reviewCadenceMinutes);
  const controlsBlockedBy = [
    ...(state.workspaceScope.configurable ? [] : ['workspace-not-configurable']),
    ...(state.clientRuntime.canSubmitCommands ? [] : ['client-missing:command.submit'])
  ];
  const enableCommand = commandControl({
    state,
    command: 'set-lifecycle-enabled',
    label: state.settings.enabled ? 'Disable lifecycle review' : 'Enable lifecycle review',
    enabled: state.workspaceScope.configurable && state.clientRuntime.canSubmitCommands,
    payload: {
      enabled: !state.settings.enabled,
      reason: state.settings.enabled ? 'operator-disabled' : 'operator-enabled'
    },
    blockedBy: controlsBlockedBy
  });
  const settingsCommand = commandControl({
    state,
    command: 'update-lifecycle-settings',
    label: settingsViolations.length > 0 ? 'Repair lifecycle settings' : 'Update lifecycle settings',
    enabled: state.workspaceScope.configurable && state.clientRuntime.canSubmitCommands,
    payload: {
      settings: {
        autoSeal: state.settings.autoSeal,
        requireRecoveryProof: state.settings.requireRecoveryProof,
        minProofRefs: state.settings.minProofRefs,
        reviewCadenceMinutes: state.settings.reviewCadenceMinutes
      },
      reason: settingsViolations.length > 0 ? 'settings-validation' : 'operator-adjustment'
    },
    blockedBy: controlsBlockedBy
  });
  const scheduleCommand = commandControl({
    state,
    command: 'schedule-review-window',
    label: state.schedule.due ? 'Reschedule review window' : 'Schedule review window',
    enabled: state.workspaceScope.configurable && state.clientRuntime.canSubmitCommands && Boolean(suggestedReviewAt),
    payload: {
      scheduledFor: suggestedReviewAt,
      reviewCadenceMinutes: state.settings.reviewCadenceMinutes,
      reason: state.schedule.due ? 'cadence-reschedule' : 'cadence-schedule'
    },
    blockedBy: [...controlsBlockedBy, ...scheduleViolations]
  });
  return {
    schema: 'aios.review-ready.lifecycle-controls.v1',
    generatedAt: state.updatedAt,
    state: !state.settings.enabled
      ? 'disabled'
      : settingsViolations.length > 0 || scheduleViolations.length > 0
        ? 'configuration-attention'
        : state.schedule.pausedUntil && state.schedule.pausedUntil > state.updatedAt
          ? 'paused'
          : state.schedule.due
            ? 'review-due'
            : 'active',
    nextActionState: {
      action: nextAction.action,
      command: nextAction.command,
      dueAt: nextAction.dueAt,
      reason: nextAction.reason,
      blockedBy: stringList(nextAction.blockedBy)
    },
    settings: {
      enabled: state.settings.enabled,
      autoSeal: state.settings.autoSeal,
      requireRecoveryProof: state.settings.requireRecoveryProof,
      minProofRefs: state.settings.minProofRefs,
      reviewCadenceMinutes: state.settings.reviewCadenceMinutes,
      validation: state.settings.validation
    },
    schedule: {
      scheduledFor: state.schedule.scheduledFor,
      suggestedReviewAt,
      lastReviewedAt: state.schedule.lastReviewedAt,
      pausedUntil: state.schedule.pausedUntil,
      enabledUntil: state.schedule.enabledUntil,
      due: state.schedule.due,
      activeWindow: state.schedule.activeWindow,
      validation: state.schedule.validation
    },
    unresolvedGates,
    controls: {
      enablement: enableCommand,
      settings: settingsCommand,
      schedule: scheduleCommand
    },
    proof: {
      controlDigest: digest({
        tenant: state.tenant,
        settings: state.settings,
        schedule: state.schedule,
        unresolvedGates,
        nextAction
      })
    }
  };
}

function countReadyProofRefs(checks) {
  return Object.values(checks).filter((check) => check.ok && check.proof).length;
}

function recoveryProofSatisfied(recovery, settings) {
  return !settings.requireRecoveryProof || !recovery.recoveredAt || recovery.proofRefs.length > 0;
}

function deriveStatus(checks, recovery, settings = DEFAULT_SETTINGS, health = null) {
  if (health?.failed) return 'failed';
  if (health?.degradedMode) return 'degraded';
  if (recovery.required) return 'recovery-required';
  if (!recoveryProofSatisfied(recovery, settings)) return 'review-pending';
  if (Object.values(checks).every((check) => check.ok && check.proof)) return 'review-ready';
  if (Object.values(checks).some((check) => check.ok || check.proof)) return 'review-pending';
  return 'initialized';
}

function normalizeHistorySnapshots(value) {
  if (!Array.isArray(value)) return [];
  const snapshots = value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      snapshotId: text(entry.snapshotId || entry.id, `snapshot:${timestamp(entry.capturedAt)}`),
      capturedAt: timestamp(entry.capturedAt),
      reason: text(entry.reason, 'state-shaped'),
      status: text(entry.status, 'unknown'),
      readyCheckCount: Number.isFinite(entry.readyCheckCount) ? entry.readyCheckCount : 0,
      missingProofCount: Number.isFinite(entry.missingProofCount) ? entry.missingProofCount : 0,
      commandCount: Number.isFinite(entry.commandCount) ? entry.commandCount : 0,
      evidenceCount: Number.isFinite(entry.evidenceCount) ? entry.evidenceCount : 0,
      rejectedCommandCount: Number.isFinite(entry.rejectedCommandCount) ? entry.rejectedCommandCount : 0,
      activeHealthIncidentCount: Number.isFinite(entry.activeHealthIncidentCount) ? entry.activeHealthIncidentCount : 0,
      retryQueueDepth: Number.isFinite(entry.retryQueueDepth) ? entry.retryQueueDepth : 0,
      providerCount: Number.isFinite(entry.providerCount) ? entry.providerCount : 0,
      staleProviderCount: Number.isFinite(entry.staleProviderCount) ? entry.staleProviderCount : 0,
      readyForAudit: Boolean(entry.readyForAudit),
      readyForExternalHandoff: Boolean(entry.readyForExternalHandoff),
      exportRef: text(entry.exportRef, null),
      digest: text(entry.digest, null)
    }))
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));

  return [...new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshot])).values()].slice(-20);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  const source = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function commandReplayCursor(commandLedger) {
  const entries = Object.entries(commandLedger)
    .map(([id, entry]) => ({
      id,
      command: entry.command,
      status: entry.status,
      appliedAt: entry.appliedAt
    }))
    .sort((left, right) => left.appliedAt.localeCompare(right.appliedAt) || left.id.localeCompare(right.id));
  const last = entries.at(-1) || null;
  return {
    commandCount: entries.length,
    lastCommandId: last?.id || null,
    lastCommand: last?.command || null,
    lastAppliedAt: last?.appliedAt || null,
    acceptedCount: entries.filter((entry) => entry.status === 'accepted').length,
    rejectedCount: entries.filter((entry) => entry.status === 'rejected').length
  };
}

function commandIdempotencyMaterial(commandName, command, tenant) {
  const payload = asRecord(command);
  const excluded = new Set(['id', 'commandId', 'idempotencyKey', 'now', 'actor', 'subject', 'tenant']);
  const commandPayload = Object.fromEntries(
    Object.entries(payload)
      .filter(([key, value]) => !excluded.has(key) && value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    command: commandName || 'unknown',
    payload: commandPayload
  };
}

function commandIdempotencyKey(commandName, command, tenant) {
  return text(
    command.id || command.commandId || command.idempotencyKey,
    `${tenant.isolationKey}:${surfaceName}:command:${commandName || 'unknown'}:${digest(
      commandIdempotencyMaterial(commandName, command, tenant)
    )}`
  );
}

function persistedStatusDecision({ requestedStatus, derivedStatus, checks, recovery, settings, health }) {
  const requested = text(requestedStatus, null);
  const missingProofs = Object.entries(checks)
    .filter(([, check]) => !check.ok || !check.proof)
    .map(([name]) => name);
  const blockers = [
    ...(health?.failed ? ['operational-health-failed'] : []),
    ...(health?.degradedMode ? ['operational-health-degraded'] : []),
    ...(recovery.required ? ['recovery-required'] : []),
    ...(!recoveryProofSatisfied(recovery, settings) ? ['recovery-proof-missing'] : []),
    ...missingProofs.map((name) => `proof-missing:${name}`)
  ];
  const readyOverrideUnsafe = READY_STATUSES.has(requested) && blockers.length > 0;
  const blockedOverrideUnsafe = BLOCKED_STATUSES.has(requested) && blockers.length === 0 && derivedStatus !== requested;
  const accepted = Boolean(requested)
    && health?.status === 'healthy'
    && !readyOverrideUnsafe
    && !blockedOverrideUnsafe;
  return {
    requested,
    accepted,
    status: accepted ? requested : derivedStatus,
    derivedStatus,
    blockedBy: accepted ? [] : [...new Set(blockers)].sort(),
    reason: accepted
      ? 'persisted-status-compatible'
      : requested
        ? 'persisted-status-reshaped'
        : 'derived-status'
  };
}

function persistencePayload(state) {
  return {
    schemaVersion: state.schemaVersion,
    surfaceId: state.surfaceId,
    tenant: state.tenant,
    status: state.status,
    checks: state.checks,
    settings: state.settings,
    workspacePolicy: state.workspacePolicy,
    workspaceScope: state.workspaceScope,
    schedule: state.schedule,
    recovery: state.recovery,
    clientRuntime: state.clientRuntime,
    workflowHandoff: state.workflowHandoff,
    reviewDecision: state.reviewDecision || null,
    providerServiceContract: state.providerServiceContract,
    lifecycleControls: state.lifecycleControls,
    operationalHealth: {
      status: state.operationalHealth.status,
      incidents: state.operationalHealth.incidents,
      retryPolicy: state.operationalHealth.retryPolicy
    },
    statusDecision: state.statusDecision || null,
    providers: state.providers,
    evidence: state.evidence,
    commandLedger: state.commandLedger,
    historySnapshots: state.historySnapshots || [],
    analyticsHistory: state.analyticsHistory || null,
    timelineReport: state.timelineReport || null,
    analyticsExport: state.analyticsExport ? {
      exportId: state.analyticsExport.exportId,
      generatedAt: state.analyticsExport.generatedAt,
      manifest: state.analyticsExport.manifest
    } : null
  };
}

function restoreCommandContract({ state, command, index }) {
  const commandName = text(command.command, 'operator-review');
  const payload = {
    command: commandName,
    tenantId: state.tenant.tenantId,
    workspaceId: state.tenant.workspaceId,
    isolationKey: state.tenant.isolationKey,
    ...(command.check ? { check: command.check } : {}),
    ...(command.incidentId ? { incidentId: command.incidentId } : {}),
    ...(command.providerId ? { providerId: command.providerId } : {}),
    ...(command.requiredProof ? { requiredProof: command.requiredProof } : {}),
    reason: text(command.reason, 'restart-restore')
  };
  const idempotencyKey = `${state.tenant.isolationKey}:${surfaceName}:restore:${commandName}:${digest({
    index,
    payload,
    persistenceKey: `${state.tenant.isolationKey}:${surfaceName}`
  })}`;
  const blockedBy = commandWorkspaceViolations(commandName, state.workspaceScope);
  return {
    ...command,
    sequence: index + 1,
    idempotencyKey,
    payload,
    replaySafe: blockedBy.length === 0,
    blockedBy,
    replayMode: commandName === 'record-check' || commandName === 'mark-recovered'
      ? 'requires-fresh-proof'
      : 'idempotent-command'
  };
}

function buildRestorePlan({ state, readinessGates, validationSummary, proofManifest }) {
  const missingChecks = Object.entries(state.checks)
    .filter(([, check]) => !check.ok || !check.proof)
    .map(([check]) => ({
      command: 'record-check',
      check,
      requiredProof: `${surfaceName}:${check}`,
      reason: 'missing-required-proof'
    }));
  const healthCommands = state.operationalHealth.actionableErrors.map((error) => ({
    command: error.retryable && !error.blockedBy.includes('retry-attempts-exhausted')
      ? 'retry-health-error'
      : error.command,
    incidentId: error.incidentId,
    code: error.code,
    reason: error.message,
    retryable: error.retryable,
    attemptCount: error.attemptCount,
    attemptsRemaining: error.attemptsRemaining,
    dueAt: error.nextRetryAt
  }));
  const providerCommands = state.providers
    .filter((provider) => provider.missingCapabilities.length > 0 || provider.sync.stale)
    .map((provider) => ({
      command: 'sync-provider-contracts',
      providerId: provider.providerId,
      reason: provider.missingCapabilities.length > 0 ? 'provider-capability-gap' : 'provider-sync-stale'
    }));
  const recoveryCommands = state.recovery.required || !recoveryProofSatisfied(state.recovery, state.settings)
    ? [{
        command: 'mark-recovered',
        requiredProof: state.settings.requireRecoveryProof ? 'recovery-proof' : null,
        reason: state.recovery.required ? text(state.recovery.reason, 'recovery-required') : 'recovery-proof-missing'
      }]
    : [];
  const commands = [...healthCommands, ...providerCommands, ...recoveryCommands, ...missingChecks]
    .map((command, index) => restoreCommandContract({ state, command, index }));
  const blockedGates = readinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate);
  const replayBlockedBy = commands.flatMap((command) => command.blockedBy);
  return {
    schema: 'aios.review-ready.restore-plan.v1',
    status: validationSummary.ok && proofManifest.complete
      ? 'restorable'
      : replayBlockedBy.length > 0
        ? 'blocked'
        : commands.length > 0
          ? 'replay-required'
          : 'blocked',
    commandCount: commands.length,
    blockedGates,
    replaySafe: replayBlockedBy.length === 0,
    replayBlockedBy: [...new Set(replayBlockedBy)].sort(),
    commands
  };
}

function restartStatusFromPersistence({ state, digestStatus, restorePlan, canRestore }) {
  const statusBlockedBy = stringList(state.statusDecision?.blockedBy);
  const blockedBy = [
    ...(digestStatus === 'reshaped' ? ['payload-digest-mismatch'] : []),
    ...(!state.settings.enabled ? ['lifecycle-disabled'] : []),
    ...(state.operationalHealth.failed ? ['operational-health-failed'] : []),
    ...(state.recovery.required ? ['recovery-required'] : []),
    ...statusBlockedBy,
    ...stringList(restorePlan.replayBlockedBy)
  ];
  const stateName = blockedBy.length > 0
    ? 'blocked'
    : restorePlan.status === 'restorable' && READY_STATUSES.has(state.status)
      ? 'restart-safe'
      : restorePlan.status === 'replay-required'
        ? 'replay-required'
        : canRestore
          ? 'restorable'
          : 'blocked';
  return {
    schema: 'aios.review-ready.restart-status.v1',
    state: stateName,
    restartSafe: stateName === 'restart-safe',
    canRestore: Boolean(canRestore && blockedBy.length === 0),
    persistedStatus: state.statusDecision?.requested || null,
    effectiveStatus: state.status,
    statusDecision: state.statusDecision || null,
    replayRequired: restorePlan.status === 'replay-required',
    replaySafe: restorePlan.replaySafe,
    replayCommandCount: restorePlan.commandCount,
    blockedBy: [...new Set(blockedBy)].sort()
  };
}

function buildPersistenceEnvelope({ state, readinessGates, validationSummary, proofManifest }) {
  const payload = persistencePayload(state);
  const replayCursor = commandReplayCursor(state.commandLedger);
  const restorePlan = buildRestorePlan({ state, readinessGates, validationSummary, proofManifest });
  const prior = asRecord(state.persistedEnvelope);
  const payloadDigest = digest(payload);
  const expectedDigest = text(prior.payloadDigest || prior.checksum, null);
  const digestStatus = expectedDigest ? expectedDigest === payloadDigest ? 'verified' : 'reshaped' : 'new';
  const canRestore = digestStatus !== 'reshaped'
    && restorePlan.status !== 'blocked'
    && !state.operationalHealth.failed
    && state.settings.enabled;
  const restartStatus = restartStatusFromPersistence({ state, digestStatus, restorePlan, canRestore });
  return {
    schema: 'aios.review-ready.persistence.v1',
    persistenceKey: `${state.tenant.isolationKey}:${surfaceName}`,
    revision: `${state.updatedAt}:${replayCursor.commandCount}`,
    persistedAt: state.updatedAt,
    payloadDigest,
    digestStatus,
    canRestore,
    restartSafe: restartStatus.restartSafe,
    status: restartStatus.state === 'blocked' ? 'blocked' : restorePlan.status,
    restartStatus,
    workspaceBoundary: {
      boundaryRef: state.workspaceScope.boundaryRef,
      allowed: state.workspaceScope.allowed,
      readOnly: state.workspaceScope.readOnly,
      violations: state.workspaceScope.violations
    },
    replayCursor,
    restorePlan,
    writeContract: {
      idempotencyScope: 'tenant-workspace-command',
      workspaceBoundaryRequired: true,
      commandLedgerRequired: true,
      proofManifestRequired: true,
      auditHandoffRequired: true
    }
  };
}

function reviewReadyAnalytics({ checks, recovery, evidence, commandLedger, status, providers, settings, health }) {
  const checkEntries = Object.entries(checks);
  const ledgerEntries = Object.values(commandLedger);
  const readyChecks = checkEntries.filter(([, check]) => check.ok && check.proof).map(([name]) => name);
  const missingProofs = checkEntries.filter(([, check]) => !check.ok || !check.proof).map(([name]) => name);
  const commandStatusCounts = ledgerEntries.reduce((counts, entry) => {
    const key = text(entry.status, 'unknown');
    return { ...counts, [key]: (counts[key] || 0) + 1 };
  }, {});
  const rejectedCommands = ledgerEntries.filter((entry) => entry.status === 'rejected');
  const boundaryViolationCounts = rejectedCommands
    .flatMap((entry) => entry.violations)
    .reduce((counts, violation) => ({ ...counts, [violation]: (counts[violation] || 0) + 1 }), {});
  const providerSummary = providerContractSummary(providers);
  const proofEvidence = evidence.filter((entry) => entry.type === 'proof' || entry.type.endsWith('-proof'));
  const commandCountsByName = ledgerEntries.reduce((counts, entry) => {
    const key = text(entry.command, 'unknown');
    return { ...counts, [key]: (counts[key] || 0) + 1 };
  }, {});
  const proofCoverageByCheck = Object.fromEntries(
    checkEntries.map(([name, check]) => [
      name,
      {
        ok: Boolean(check.ok),
        hasProof: Boolean(check.proof),
        proofRef: proofRef(check.proof, null),
        state: check.ok && check.proof ? 'satisfied' : check.ok ? 'proof-missing' : 'not-ready'
      }
    ])
  );

  return {
    schema: 'aios.review-ready.analytics-counters.v1',
    status,
    readyCheckCount: readyChecks.length,
    requiredCheckCount: DEFAULT_CHECKS.length,
    missingProofCount: missingProofs.length,
    evidenceCount: evidence.length,
    proofEvidenceCount: proofEvidence.length,
    commandCount: ledgerEntries.length,
    acceptedCommandCount: commandStatusCounts.accepted || 0,
    rejectedCommandCount: commandStatusCounts.rejected || 0,
    deferredCommandCount: commandStatusCounts.deferred || 0,
    ignoredCommandCount: commandStatusCounts.ignored || 0,
    recoveryRequiredCount: recovery.required ? 1 : 0,
    recoveryCompleteCount: recovery.recoveredAt ? 1 : 0,
    recoveryProofCount: recovery.proofRefs.length,
    recoveryProofMissing: !recoveryProofSatisfied(recovery, settings),
    healthStatus: health.status,
    activeHealthIncidentCount: health.activeIncidentCount,
    exhaustedRetryCount: health.exhaustedRetryCount,
    retryQueueDepth: health.retryQueue.length,
    actionableErrorCount: health.actionableErrors.length,
    readyRatio: DEFAULT_CHECKS.length === 0 ? 1 : readyChecks.length / DEFAULT_CHECKS.length,
    readyChecks,
    missingProofs,
    commandStatusCounts,
    commandCountsByName,
    boundaryViolationCounts,
    proofCoverageByCheck,
    providerCount: providerSummary.providerCount,
    acceptedProviderCount: providerSummary.acceptedProviderCount,
    staleProviderCount: providerSummary.staleProviderCount,
    providerMissingCapabilities: providerSummary.missingCapabilities,
    readyForExternalHandoff: providerSummary.readyForExternalHandoff,
    actionableErrors: health.actionableErrors
  };
}

function deriveNextAction({ status, checks, recovery, settings, schedule, updatedAt, providers, health }) {
  const missingProofs = Object.entries(checks)
    .filter(([, check]) => !check.ok || !check.proof)
    .map(([name]) => name);
  const readyProofRefs = countReadyProofRefs(checks);
  const settingsViolations = stringList(settings.validation?.violations);
  const scheduleViolations = stringList(schedule.validation?.violations);
  const providerSummary = providerContractSummary(providers);
  if (health.failed) {
    const failed = health.actionableErrors.find((error) => error.severity === 'blocking' || error.severity === 'fatal')
      || health.actionableErrors[0];
    return {
      action: failed?.command || 'operator-investigation',
      command: failed?.retryable && !failed?.blockedBy?.includes('retry-attempts-exhausted')
        ? 'retry-health-error'
        : failed?.command === 'sync-provider-contracts'
          ? 'sync-provider-contracts'
          : 'record-health-error',
      reason: failed?.code || 'operational-health-failed',
      dueAt: failed?.nextRetryAt || updatedAt,
      incidentId: failed?.incidentId || null,
      attemptCount: failed?.attemptCount || 0,
      attemptsRemaining: failed?.attemptsRemaining || 0,
      blockedBy: failed?.blockedBy || ['operational-health-failed']
    };
  }
  if (health.degradedMode) {
    const retry = health.retryQueue[0];
    const degraded = health.actionableErrors[0];
    return {
      action: retry ? 'retry-health-operation' : 'clear-health-error',
      command: retry?.command || 'clear-health-error',
      reason: degraded?.code || 'operational-health-degraded',
      dueAt: retry?.dueAt || updatedAt,
      incidentId: retry?.incidentId || degraded?.incidentId || null,
      attemptCount: retry ? retry.attempt - 1 : degraded?.attemptCount || 0,
      attemptsRemaining: degraded?.attemptsRemaining || 0,
      blockedBy: degraded?.blockedBy || ['operational-health-degraded']
    };
  }
  if (!settings.enabled) {
    return {
      action: 'enable-lifecycle',
      command: 'set-lifecycle-enabled',
      reason: 'lifecycle-disabled',
      dueAt: null,
      blockedBy: ['settings.enabled=false']
    };
  }
  if (settingsViolations.length > 0) {
    return {
      action: 'repair-lifecycle-settings',
      command: 'update-lifecycle-settings',
      reason: 'settings-validation',
      dueAt: updatedAt,
      blockedBy: settingsViolations
    };
  }
  if (scheduleViolations.length > 0) {
    return {
      action: 'repair-review-schedule',
      command: 'schedule-review-window',
      reason: 'schedule-validation',
      dueAt: updatedAt,
      blockedBy: scheduleViolations
    };
  }
  if (providerSummary.providerCount > 0 && providerSummary.missingCapabilities.length > 0) {
    return {
      action: 'negotiate-provider-capabilities',
      command: 'sync-provider-contracts',
      reason: 'provider-capability-gap',
      dueAt: updatedAt,
      blockedBy: providerSummary.missingCapabilities
    };
  }
  if (providerSummary.staleProviderCount > 0) {
    return {
      action: 'sync-provider-contracts',
      command: 'sync-provider-contracts',
      reason: 'provider-sync-stale',
      dueAt: updatedAt,
      blockedBy: ['provider-sync-stale']
    };
  }
  if (schedule.pausedUntil && schedule.pausedUntil > updatedAt) {
    return {
      action: 'wait-for-scheduled-window',
      command: 'schedule-review-window',
      reason: schedule.reason,
      dueAt: schedule.pausedUntil,
      blockedBy: ['schedule-paused']
    };
  }
  if (schedule.enabledUntil && schedule.enabledUntil <= updatedAt) {
    return {
      action: 'enable-lifecycle',
      command: 'set-lifecycle-enabled',
      reason: 'enablement-window-expired',
      dueAt: updatedAt,
      blockedBy: ['schedule-enabled-until-expired']
    };
  }
  if (recovery.required) {
    return {
      action: 'complete-recovery',
      command: 'mark-recovered',
      reason: text(recovery.reason, 'recovery-required'),
      dueAt: schedule.scheduledFor || updatedAt,
      blockedBy: settings.requireRecoveryProof ? ['recovery-proof-required'] : []
    };
  }
  if (!recoveryProofSatisfied(recovery, settings)) {
    return {
      action: 'record-recovery-proof',
      command: 'mark-recovered',
      reason: 'recovery-proof-missing',
      dueAt: schedule.scheduledFor || updatedAt,
      blockedBy: ['recovery-proof-missing']
    };
  }
  if (readyProofRefs < settings.minProofRefs || missingProofs.length > 0) {
    return {
      action: 'record-missing-proof',
      command: 'record-check',
      reason: 'required-checks-incomplete',
      dueAt: schedule.scheduledFor || updatedAt,
      blockedBy: missingProofs
    };
  }
  if (!READY_STATUSES.has(status)) {
    return {
      action: 'seal-review-ready',
      command: 'seal-review-ready',
      reason: settings.autoSeal ? 'auto-seal-eligible' : 'operator-seal-required',
      dueAt: schedule.scheduledFor || updatedAt,
      blockedBy: []
    };
  }
  return {
    action: 'audit-handoff',
    command: null,
    reason: 'review-ready',
    dueAt: schedule.scheduledFor || updatedAt,
    blockedBy: []
  };
}

function reviewReadyTimeline({ checks, recovery, evidence, commandLedger, updatedAt, health }) {
  const checkEvents = Object.entries(checks)
    .filter(([, check]) => check.observedAt)
    .map(([name, check]) => ({
      at: timestamp(check.observedAt),
      type: 'check-observed',
      label: name,
      status: check.ok && check.proof ? 'ready' : 'incomplete',
      ref: check.proof
    }));
  const commandEvents = Object.entries(commandLedger).map(([id, entry]) => ({
    at: timestamp(entry.appliedAt),
    type: 'command',
    label: entry.command,
    status: entry.status,
    ref: id
  }));
  const evidenceEvents = evidence.map((entry) => ({
    at: timestamp(entry.capturedAt),
    type: 'evidence',
    label: entry.type,
    status: 'captured',
    ref: entry.ref
  }));
  const recoveryEvents = recovery.required || recovery.recoveredAt
    ? [{
        at: timestamp(recovery.recoveredAt || updatedAt),
        type: 'recovery',
        label: recovery.required ? text(recovery.reason, 'required') : 'recovered',
        status: recovery.required ? 'required' : 'complete',
        ref: recovery.reason || recovery.recoveredAt || null
      }]
    : [];
  const healthEvents = health.incidents.map((incident) => ({
    at: timestamp(incident.resolvedAt || incident.occurredAt || updatedAt),
    type: 'operational-health',
    label: incident.code,
    status: incident.resolvedAt ? 'resolved' : incident.severity,
    ref: incident.incidentId
  }));

  return [...checkEvents, ...commandEvents, ...evidenceEvents, ...recoveryEvents, ...healthEvents]
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-50);
}

function minutesBetween(start, end) {
  const startMs = Date.parse(timestamp(start));
  const endMs = Date.parse(timestamp(end));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function buildTimelineReportingState({ state, analytics, readinessGates, timeline, nextAction }) {
  const latestByType = [...timeline]
    .reverse()
    .reduce((latest, event) => (
      latest[event.type] ? latest : { ...latest, [event.type]: event }
    ), {});
  const unresolvedGates = readinessGates
    .filter((gate) => !gate.ready)
    .map((gate) => ({
      gate: gate.gate,
      severity: gate.severity,
      blockedBy: gate.blockedBy,
      reportLabel: `${gate.label}: ${gate.detail}`
    }));
  const commandEvents = timeline.filter((event) => event.type === 'command');
  const commandOutcomeCounts = commandEvents.reduce((counts, event) => ({
    ...counts,
    [event.status]: (counts[event.status] || 0) + 1
  }), {});
  const laneCounts = timeline.reduce((counts, event) => ({
    ...counts,
    [event.type]: (counts[event.type] || 0) + 1
  }), {});
  const lastEvent = timeline.at(-1) || null;
  const freshnessAgeMinutes = lastEvent ? minutesBetween(lastEvent.at, state.updatedAt) : null;
  const dueState = state.schedule.scheduledFor
    ? state.schedule.scheduledFor <= state.updatedAt
      ? READY_STATUSES.has(state.status) ? 'reviewed' : 'overdue'
      : 'scheduled'
    : 'unscheduled';
  const blockingGateCount = unresolvedGates.filter((gate) => gate.severity === 'blocking').length;
  const reportRows = [
    {
      section: 'readiness',
      metric: 'readyCheckCount',
      value: analytics.readyCheckCount,
      status: analytics.missingProofCount === 0 ? 'clear' : 'action-required'
    },
    {
      section: 'proofs',
      metric: 'missingProofCount',
      value: analytics.missingProofCount,
      status: analytics.missingProofCount === 0 ? 'clear' : 'blocked'
    },
    {
      section: 'commands',
      metric: 'rejectedCommandCount',
      value: analytics.rejectedCommandCount,
      status: analytics.rejectedCommandCount === 0 ? 'clear' : 'attention'
    },
    {
      section: 'health',
      metric: 'activeHealthIncidentCount',
      value: analytics.activeHealthIncidentCount,
      status: state.operationalHealth.status
    },
    {
      section: 'providers',
      metric: 'staleProviderCount',
      value: analytics.staleProviderCount,
      status: analytics.staleProviderCount === 0 ? 'clear' : 'sync-required'
    },
    {
      section: 'cadence',
      metric: 'dueState',
      value: dueState,
      status: dueState === 'overdue' ? 'attention' : 'clear'
    }
  ];

  return {
    schema: 'aios.review-ready.timeline-report.v1',
    reportId: `${state.tenant.isolationKey}:${surfaceName}:timeline-report:${state.updatedAt}`,
    generatedAt: state.updatedAt,
    status: state.status,
    dueState,
    scheduledFor: state.schedule.scheduledFor,
    nextAction: {
      action: nextAction.action,
      command: nextAction.command,
      dueAt: nextAction.dueAt,
      reason: nextAction.reason
    },
    freshness: {
      lastEventAt: lastEvent?.at || null,
      lastEventType: lastEvent?.type || null,
      ageMinutes: freshnessAgeMinutes,
      stale: freshnessAgeMinutes === null ? true : freshnessAgeMinutes > state.settings.reviewCadenceMinutes
    },
    lanes: Object.entries(laneCounts)
      .map(([lane, count]) => ({ lane, count, latest: latestByType[lane] || null }))
      .sort((left, right) => left.lane.localeCompare(right.lane)),
    commandOutcomes: commandOutcomeCounts,
    unresolvedGates,
    blockingGateCount,
    reportRows,
    exportHints: {
      rowSet: 'timelineReportRows',
      includeTimelineEvents: true,
      includeHistorySnapshots: true,
      proofOfFreshness: digest({
        reportRows,
        latestByType,
        unresolvedGates,
        updatedAt: state.updatedAt
      })
    }
  };
}

function exportReadySummary({
  tenant,
  status,
  updatedAt,
  analytics,
  auditHandoff,
  settings,
  schedule,
  nextAction,
    health,
    workflowHandoff,
    reviewDecision,
    providerServiceContract,
    timelineReport,
    lifecycleControls
}) {
  return {
    exportId: `${tenant.isolationKey}:${surfaceName}:${updatedAt}`,
    generatedAt: updatedAt,
    format: 'aios.review-ready.analytics.v1',
    surfaceId,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    workspaceBoundaryRef: auditHandoff.workspaceBoundary?.boundaryRef || null,
    workspaceBoundaryStatus: auditHandoff.workspaceBoundary?.allowed ? 'allowed' : 'blocked',
    status,
    readyForAudit: auditHandoff.readyForAudit,
    lifecycleEnabled: settings.enabled,
    reviewCadenceMinutes: settings.reviewCadenceMinutes,
    nextAction: nextAction.action,
    nextActionDueAt: nextAction.dueAt,
    workflowHandoffRef: workflowHandoff?.workflowRef || null,
    workflowHandoffState: workflowHandoff?.state || null,
    reviewDecisionId: reviewDecision?.decisionId || null,
    reviewDecisionState: reviewDecision?.state || null,
    reviewDecisionRoute: reviewDecision?.routes?.preview || null,
    reviewDecisionPrimaryAction: reviewDecision?.primaryAction?.action || null,
    reviewDecisionPrimaryCommand: reviewDecision?.primaryAction?.command || null,
    providerServiceContractId: providerServiceContract?.contractId || null,
    providerHandoffState: providerServiceContract?.externalHandoff?.state || null,
    timelineReportId: timelineReport?.reportId || null,
    timelineDueState: timelineReport?.dueState || null,
    timelineFreshness: timelineReport?.freshness || null,
    lifecycleControlState: lifecycleControls?.state || null,
    lifecycleControlDigest: lifecycleControls?.proof?.controlDigest || null,
    lifecycleSuggestedReviewAt: lifecycleControls?.schedule?.suggestedReviewAt || null,
    unresolvedGateCount: timelineReport?.unresolvedGates?.length || 0,
    blockingGateCount: timelineReport?.blockingGateCount || 0,
    clientRequestId: workflowHandoff?.client?.requestId || null,
    clientCorrelationId: workflowHandoff?.client?.correlationId || null,
    userVisibleAction: workflowHandoff?.userVisibleAction || null,
    continuationState: workflowHandoff?.continuation?.state || null,
    continuationType: workflowHandoff?.continuation?.type || null,
    continuationToken: workflowHandoff?.continuation?.continuationToken || null,
    continuationRoute: workflowHandoff?.continuation?.preferredTarget?.route || null,
    returnRoute: workflowHandoff?.continuation?.returnRoute || null,
    scheduledFor: schedule.scheduledFor,
    counters: {
      readyCheckCount: analytics.readyCheckCount,
      missingProofCount: analytics.missingProofCount,
      evidenceCount: analytics.evidenceCount,
      commandCount: analytics.commandCount,
      rejectedCommandCount: analytics.rejectedCommandCount,
      recoveryRequiredCount: analytics.recoveryRequiredCount,
      recoveryProofCount: analytics.recoveryProofCount,
      recoveryProofMissing: analytics.recoveryProofMissing,
      providerCount: analytics.providerCount,
      acceptedProviderCount: analytics.acceptedProviderCount,
      staleProviderCount: analytics.staleProviderCount,
      activeHealthIncidentCount: analytics.activeHealthIncidentCount,
      retryQueueDepth: analytics.retryQueueDepth,
      exhaustedRetryCount: analytics.exhaustedRetryCount
    },
    healthStatus: health.status,
    degradedMode: health.degradedMode,
    healthRunbook: buildOperationalHealthRunbook(health, updatedAt),
    actionableErrors: health.actionableErrors,
    missingProofs: analytics.missingProofs,
    recoveryProofStatus: analytics.recoveryProofMissing ? 'missing' : 'satisfied',
    boundaryViolationCounts: analytics.boundaryViolationCounts,
    providerMissingCapabilities: analytics.providerMissingCapabilities,
    readyForExternalHandoff: analytics.readyForExternalHandoff,
    providerServiceBlockedBy: providerServiceContract?.externalHandoff?.blockedBy || [],
    timelineReportRows: timelineReport?.reportRows || [],
    validationStatus: analytics.missingProofCount === 0 && settings.validation.ok ? 'pass' : 'action-required',
    previewStatus: status,
    acceptanceAction: nextAction.command || 'audit-handoff'
  };
}

function readinessGate(gate, ready, severity, detail, blockedBy = []) {
  return {
    gate,
    label: READINESS_GATE_LABELS[gate] || gate,
    ready: Boolean(ready),
    severity: ready ? 'ready' : severity,
    detail,
    blockedBy: stringList(blockedBy)
  };
}

function buildReadinessGates({ state, analytics, auditHandoff }) {
  const providerSummary = providerContractSummary(state.providers);
  const settingsViolations = stringList(state.settings.validation?.violations);
  return [
    readinessGate(
      'lifecycle',
      state.settings.enabled && settingsViolations.length === 0,
      state.settings.enabled ? 'warning' : 'blocking',
      state.settings.enabled ? 'Lifecycle settings are active.' : 'Lifecycle review is disabled.',
      state.settings.enabled ? settingsViolations : ['settings.enabled=false', ...settingsViolations]
    ),
    readinessGate(
      'health',
      !state.operationalHealth.failed && !state.operationalHealth.degradedMode,
      state.operationalHealth.failed ? 'blocking' : 'warning',
      state.operationalHealth.failed
        ? 'Operational health has blocking failures.'
        : state.operationalHealth.degradedMode
          ? 'Kernel is running in degraded mode while health errors are retried.'
          : 'No active operational health errors.',
      state.operationalHealth.actionableErrors.map((error) => error.code)
    ),
    readinessGate(
      'proofs',
      analytics.missingProofCount === 0 && analytics.readyCheckCount >= state.settings.minProofRefs,
      'blocking',
      `${analytics.readyCheckCount}/${analytics.requiredCheckCount} required checks have proof references.`,
      analytics.missingProofs
    ),
    readinessGate(
      'recovery',
      !state.recovery.required && !analytics.recoveryProofMissing,
      state.settings.requireRecoveryProof ? 'blocking' : 'warning',
      state.recovery.required
        ? text(state.recovery.reason, 'Recovery is required before review.')
        : analytics.recoveryProofMissing
          ? 'Recovery completion requires a proof reference.'
          : 'No recovery work is pending.',
      state.recovery.required
        ? ['recovery-required']
        : analytics.recoveryProofMissing
          ? ['recovery-proof-missing']
          : []
    ),
    readinessGate(
      'providers',
      providerSummary.providerCount === 0 || (
        providerSummary.missingCapabilities.length === 0 && providerSummary.staleProviderCount === 0
      ),
      providerSummary.missingCapabilities.length > 0 ? 'blocking' : 'warning',
      providerSummary.providerCount === 0
        ? 'No external provider contract is attached.'
        : `${providerSummary.acceptedProviderCount}/${providerSummary.providerCount} provider contracts accepted.`,
      [
        ...providerSummary.missingCapabilities,
        ...(providerSummary.staleProviderCount > 0 ? ['provider-sync-stale'] : [])
      ]
    ),
    readinessGate(
      'audit',
      auditHandoff.readyForAudit,
      'blocking',
      auditHandoff.readyForAudit ? 'Audit handoff can be generated.' : 'Audit handoff is waiting on readiness gates.',
      auditHandoff.readyForAudit ? [] : stringList(auditHandoff.blockedBy)
    )
  ];
}

function buildProofManifest({ state, auditHandoff, readinessGates }) {
  const checkProofs = Object.entries(state.checks).map(([name, check]) => ({
    domain: 'check',
    name,
    required: true,
    status: check.ok && check.proof ? 'satisfied' : 'missing',
    ref: proofRef(check.proof),
    observedAt: check.observedAt
  }));
  const recoveryProofs = state.recovery.recoveredAt || state.recovery.required
    ? [{
        domain: 'recovery',
        name: 'recovery-proof',
        required: state.settings.requireRecoveryProof,
        status: recoveryProofSatisfied(state.recovery, state.settings) ? 'satisfied' : 'missing',
        refs: state.recovery.proofRefs,
        observedAt: state.recovery.recoveredAt
      }]
    : [];
  const providerProofs = state.providers.map((provider) => ({
    domain: 'provider',
    name: provider.providerId,
    required: false,
    status: provider.negotiation.accepted && !provider.sync.stale ? 'satisfied' : 'attention-required',
    ref: provider.handoff.externalRef,
    observedAt: provider.sync.lastSyncedAt,
    missingCapabilities: provider.missingCapabilities
  }));
  const healthProofs = state.operationalHealth.incidents.map((incident) => ({
    domain: 'operational-health',
    name: incident.code,
    required: incident.severity === 'blocking' || incident.severity === 'fatal' || incident.exhausted,
    status: incident.resolvedAt ? 'satisfied' : 'attention-required',
    ref: incident.proofRef,
    observedAt: incident.resolvedAt || incident.occurredAt,
    retryable: incident.retryable,
    nextRetryAt: incident.nextRetryAt
  }));
  const workspaceProof = {
    domain: 'workspace-boundary',
    name: state.workspaceScope.workspaceId,
    required: true,
    status: state.workspaceScope.allowed && state.workspaceScope.auditReadable ? 'satisfied' : 'blocked',
    ref: state.workspaceScope.boundaryRef,
    observedAt: state.updatedAt,
    policyMode: state.workspaceScope.policyMode,
    readOnly: state.workspaceScope.readOnly,
    violations: state.workspaceScope.violations
  };
  const entries = [...checkProofs, ...recoveryProofs, ...providerProofs, ...healthProofs, workspaceProof];
  const missing = entries
    .filter((entry) => entry.required && entry.status !== 'satisfied')
    .map((entry) => `${entry.domain}:${entry.name}`);
  return {
    schema: 'aios.review-ready.proof-manifest.v1',
    manifestId: `${state.tenant.isolationKey}:${surfaceName}:proofs:${state.updatedAt}`,
    generatedAt: state.updatedAt,
    tenantId: state.tenant.tenantId,
    workspaceId: state.tenant.workspaceId,
    isolationKey: state.tenant.isolationKey,
    complete: missing.length === 0 && auditHandoff.readyForAudit,
    readyForAudit: auditHandoff.readyForAudit,
    blockedGates: readinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate),
    missing,
    entries
  };
}

function buildValidationSummary({ state, analytics, auditHandoff, readinessGates }) {
  const blocking = readinessGates.filter((gate) => !gate.ready && gate.severity === 'blocking');
  const warnings = readinessGates.filter((gate) => !gate.ready && gate.severity !== 'blocking');
  const acceptedCommands = analytics.acceptedCommandCount;
  const rejectedCommands = analytics.rejectedCommandCount;
  return {
    schema: 'aios.review-ready.validation-summary.v1',
    ok: blocking.length === 0,
    status: blocking.length === 0 ? 'pass' : 'blocked',
    blockingCount: blocking.length,
    warningCount: warnings.length,
    acceptedCommandCount: acceptedCommands,
    rejectedCommandCount: rejectedCommands,
    settingsValid: Boolean(state.settings.validation?.ok),
    auditReady: auditHandoff.readyForAudit,
    externalHandoffReady: auditHandoff.readyForExternalHandoff,
    failedGates: blocking.map((gate) => gate.gate),
    warnings: warnings.map((gate) => gate.gate),
    evidence: {
      readyProofRefs: analytics.readyChecks,
      missingProofs: analytics.missingProofs,
      recoveryProofRefs: state.recovery.proofRefs,
      recoveryProofMissing: analytics.recoveryProofMissing,
      providerMissingCapabilities: analytics.providerMissingCapabilities,
      boundaryViolationCounts: analytics.boundaryViolationCounts,
      workspaceBoundary: state.workspaceScope,
      healthStatus: analytics.healthStatus,
      actionableErrors: analytics.actionableErrors
    }
  };
}

function buildClientContinuationContract({
  state,
  nextAction,
  blockedGates,
  clientBlockedBy,
  canContinue,
  commandEnvelope,
  commandAllowed,
  auditHandoff
}) {
  const commandTarget = commandEnvelope && commandAllowed && state.clientRuntime.canSubmitCommands
    ? {
        method: 'POST',
        route: state.clientRuntime.routes.command,
        command: commandEnvelope.command,
        idempotencyKey: commandEnvelope.idempotencyKey,
        payload: commandEnvelope.payload
      }
    : null;
  const auditTarget = canContinue
    ? {
        method: 'GET',
        route: state.clientRuntime.routes.handoff,
        destination: auditHandoff.destination,
        handoffId: auditHandoff.handoffId,
        externalReady: auditHandoff.readyForExternalHandoff
      }
    : null;
  const previewTarget = state.clientRuntime.canRenderPreview
    ? {
        method: 'GET',
        route: state.clientRuntime.routes.preview,
        requestId: state.clientRuntime.requestId,
        stateVersion: state.clientRuntime.stateVersion
      }
    : null;
  const blockedBy = [...new Set([...stringList(nextAction.blockedBy), ...blockedGates, ...clientBlockedBy])].sort();
  const preferredTarget = auditTarget || commandTarget || previewTarget || {
    method: 'GET',
    route: state.clientRuntime.routes.return,
    reason: nextAction.reason
  };
  const userVisibleSteps = [
    ...(previewTarget ? [{
      step: 'preview-state',
      label: 'Review kernel readiness',
      route: previewTarget.route,
      enabled: state.clientRuntime.canRenderPreview,
      blockedBy: state.clientRuntime.canRenderPreview ? [] : ['client-missing:state.preview']
    }] : []),
    {
      step: commandEnvelope ? 'submit-command' : 'operator-review',
      label: canContinue ? 'No command required' : `Resolve ${nextAction.action}`,
      route: commandTarget?.route || state.clientRuntime.routes.return,
      command: commandEnvelope?.command || null,
      enabled: Boolean(commandTarget),
      blockedBy: commandTarget ? [] : blockedBy
    },
    {
      step: 'audit-handoff',
      label: 'Open audit handoff',
      route: state.clientRuntime.routes.handoff,
      enabled: Boolean(auditTarget),
      blockedBy: auditTarget ? [] : blockedBy
    }
  ];
  return {
    schema: 'aios.review-ready.client-continuation.v1',
    type: canContinue ? 'audit-handoff' : commandEnvelope ? 'command' : 'operator-review',
    state: canContinue ? 'ready' : commandTarget ? 'action-required' : 'blocked',
    requestId: state.clientRuntime.requestId,
    correlationId: state.clientRuntime.correlationId,
    clientId: state.clientRuntime.clientId,
    sessionId: state.clientRuntime.sessionId,
    interactionMode: state.clientRuntime.interactionMode,
    handoffPreference: state.clientRuntime.handoffPreference,
    requestedView: state.clientRuntime.requestedView,
    dueAt: nextAction.dueAt,
    returnRoute: state.clientRuntime.routes.return,
    preferredTarget,
    previewTarget,
    commandTarget,
    auditTarget,
    blockedBy,
    userVisibleSteps,
    continuationToken: digest({
      tenant: state.tenant,
      requestId: state.clientRuntime.requestId,
      correlationId: state.clientRuntime.correlationId,
      status: state.status,
      nextAction: nextAction.action,
      blockedBy,
      routes: state.clientRuntime.routes
    })
  };
}

function buildWorkflowHandoff({ state, nextAction, readinessGates, validationSummary, auditHandoff }) {
  const blockedGates = readinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate);
  const clientBlockedBy = state.clientRuntime.missingCapabilities.map((capability) => `client-missing:${capability}`);
  const command = nextAction.command;
  const commandPermission = command ? COMMAND_PERMISSIONS[command] || null : null;
  const actorCanExecute = commandPermission ? state.actor.permissions.includes(commandPermission) : true;
  const commandAllowed = command
    ? commandWorkspaceViolations(command, state.workspaceScope).length === 0 && actorCanExecute
    : true;
  const canContinue = validationSummary.ok
    && auditHandoff.readyForAudit
    && state.clientRuntime.missingCapabilities.length === 0;
  const commandEnvelope = command && !canContinue
    ? {
        schema: 'aios.review-ready.command-envelope.v1',
        command,
        permission: commandPermission,
        actorCanExecute,
        commandAllowed,
        idempotencyKey: `${state.tenant.isolationKey}:${surfaceName}:client:${state.clientRuntime.requestId}:${command}`,
        tenant: state.tenant,
        payload: {
          command,
          tenantId: state.tenant.tenantId,
          workspaceId: state.tenant.workspaceId,
          isolationKey: state.tenant.isolationKey,
          reason: nextAction.reason,
          incidentId: nextAction.incidentId || null,
          attemptCount: nextAction.attemptCount || 0,
          attemptsRemaining: nextAction.attemptsRemaining || 0,
          blockedBy: stringList(nextAction.blockedBy)
        }
      }
    : null;
  const continuation = buildClientContinuationContract({
    state,
    nextAction,
    blockedGates,
    clientBlockedBy,
    canContinue,
    commandEnvelope,
    commandAllowed,
    auditHandoff
  });
  const stateName = canContinue
    ? 'ready-for-audit-handoff'
    : commandEnvelope && commandAllowed && state.clientRuntime.canSubmitCommands
      ? 'awaiting-client-command'
      : 'blocked';
  return {
    schema: 'aios.review-ready.workflow-handoff.v1',
    workflowRef: `${state.tenant.isolationKey}:${surfaceName}:workflow:${digest({
      requestId: state.clientRuntime.requestId,
      status: state.status,
      nextAction: nextAction.action,
      blockedGates,
      clientBlockedBy
    })}`,
    generatedAt: state.updatedAt,
    state: stateName,
    surfaceRoute: state.clientRuntime.route,
    userVisibleAction: canContinue ? 'Open audit handoff' : nextAction.action,
    userVisibleReason: canContinue ? 'review-ready' : nextAction.reason,
    userVisibleSteps: continuation.userVisibleSteps,
    blockedBy: [...new Set([...stringList(nextAction.blockedBy), ...blockedGates, ...clientBlockedBy])],
    client: {
      clientId: state.clientRuntime.clientId,
      sessionId: state.clientRuntime.sessionId,
      requestId: state.clientRuntime.requestId,
      correlationId: state.clientRuntime.correlationId,
      interactionMode: state.clientRuntime.interactionMode,
      canRenderPreview: state.clientRuntime.canRenderPreview,
      canRenderAuditHandoff: state.clientRuntime.canRenderAuditHandoff,
      canSubmitCommands: state.clientRuntime.canSubmitCommands,
      missingCapabilities: state.clientRuntime.missingCapabilities,
      routes: state.clientRuntime.routes
    },
    auditTarget: {
      destination: auditHandoff.destination,
      handoffId: auditHandoff.handoffId,
      readyForAudit: auditHandoff.readyForAudit,
      readyForExternalHandoff: auditHandoff.readyForExternalHandoff
    },
    commandEnvelope,
    continuation
  };
}

function buildPreviewContract({ state, analytics, auditHandoff, readinessGates, validationSummary, workflowHandoff, timelineReport }) {
  return {
    schema: 'aios.review-ready.preview.v1',
    title: `Review-ready preview for ${state.tenant.workspaceId}`,
    generatedAt: state.updatedAt,
    status: state.status,
    readiness: {
      accepted: validationSummary.ok && auditHandoff.readyForAudit,
      readyRatio: analytics.readyRatio,
      restartSafe: state.restartSafe,
      blocked: state.blocked,
      healthStatus: state.operationalHealth.status,
      degradedMode: state.operationalHealth.degradedMode,
      gates: readinessGates
    },
    workspaceBoundary: {
      tenantId: state.workspaceScope.tenantId,
      workspaceId: state.workspaceScope.workspaceId,
      isolationKey: state.workspaceScope.isolationKey,
      boundaryRef: state.workspaceScope.boundaryRef,
      policyMode: state.workspaceScope.policyMode,
      allowed: state.workspaceScope.allowed,
      readOnly: state.workspaceScope.readOnly,
      auditReadable: state.workspaceScope.auditReadable,
      writable: state.workspaceScope.writable,
      configurable: state.workspaceScope.configurable,
      sealable: state.workspaceScope.sealable,
      violations: state.workspaceScope.violations
    },
    visibleChecks: Object.entries(state.checks).map(([name, check]) => ({
      name,
      ok: check.ok,
      proofRef: check.proof,
      observedAt: check.observedAt,
      state: check.ok && check.proof ? 'ready' : 'needs-proof'
    })),
    providerBadges: state.providers.map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      state: provider.negotiation.accepted && !provider.sync.stale ? 'ready' : 'needs-sync',
      endpoint: provider.endpoint,
      missingCapabilities: provider.missingCapabilities
    })),
    providerServiceContract: state.providerServiceContract,
    lifecycleControls: state.lifecycleControls,
    auditHandoff: {
      destination: auditHandoff.destination,
      handoffId: auditHandoff.handoffId,
      readyForAudit: auditHandoff.readyForAudit,
      readyForExternalHandoff: auditHandoff.readyForExternalHandoff
    },
    workflowHandoff: {
      workflowRef: workflowHandoff.workflowRef,
      state: workflowHandoff.state,
      userVisibleAction: workflowHandoff.userVisibleAction,
      userVisibleReason: workflowHandoff.userVisibleReason,
      userVisibleSteps: workflowHandoff.userVisibleSteps,
      blockedBy: workflowHandoff.blockedBy,
      continuation: workflowHandoff.continuation,
      commandEnvelope: workflowHandoff.commandEnvelope
    },
    clientRuntime: {
      clientId: state.clientRuntime.clientId,
      sessionId: state.clientRuntime.sessionId,
      requestId: state.clientRuntime.requestId,
      correlationId: state.clientRuntime.correlationId,
      route: state.clientRuntime.route,
      routes: state.clientRuntime.routes,
      interactionMode: state.clientRuntime.interactionMode,
      requestedView: state.clientRuntime.requestedView,
      handoffPreference: state.clientRuntime.handoffPreference,
      missingCapabilities: state.clientRuntime.missingCapabilities
    },
    health: {
      status: state.operationalHealth.status,
      retryQueueDepth: state.operationalHealth.retryQueue.length,
      actionableErrors: state.operationalHealth.actionableErrors,
      runbook: buildOperationalHealthRunbook(state.operationalHealth, state.updatedAt)
    },
    reporting: {
      timelineReportId: timelineReport?.reportId || null,
      dueState: timelineReport?.dueState || null,
      freshness: timelineReport?.freshness || null,
      lanes: timelineReport?.lanes || [],
      unresolvedGates: timelineReport?.unresolvedGates || [],
      reportRows: timelineReport?.reportRows || []
    },
    proofManifest: {
      manifestId: state.proofManifest?.manifestId || null,
      complete: Boolean(state.proofManifest?.complete),
      missing: stringList(state.proofManifest?.missing)
    },
    persistence: {
      persistenceKey: state.persistence?.persistenceKey || null,
      revision: state.persistence?.revision || null,
      status: state.persistence?.status || 'unknown',
      digestStatus: state.persistence?.digestStatus || 'unknown',
      restartSafe: Boolean(state.persistence?.restartSafe),
      restartStatus: state.persistence?.restartStatus || null,
      replayCursor: state.persistence?.replayCursor || null,
      restorePlanStatus: state.persistence?.restorePlan?.status || null,
      restoreCommandCount: state.persistence?.restorePlan?.commandCount || 0,
      replaySafe: Boolean(state.persistence?.restorePlan?.replaySafe)
    }
  };
}

function buildAcceptanceContract({ state, nextAction, validationSummary, auditHandoff }) {
  const scopeViolations = commandWorkspaceViolations('seal-review-ready', state.workspaceScope);
  const canAccept = validationSummary.ok && auditHandoff.readyForAudit && scopeViolations.length === 0;
  const command = canAccept ? 'seal-review-ready' : nextAction.command;
  return {
    schema: 'aios.review-ready.acceptance.v1',
    accepted: canAccept && READY_STATUSES.has(state.status),
    acceptEnabled: canAccept && state.workspaceScope.sealable,
    command,
    commandLabel: canAccept ? 'Accept review-ready state' : `Resolve ${nextAction.action}`,
    requiresPermission: command ? COMMAND_PERMISSIONS[command] || null : null,
    actorCanExecute: command ? state.actor.permissions.includes(COMMAND_PERMISSIONS[command]) : true,
    idempotencyKey: `${state.tenant.isolationKey}:${surfaceName}:${command || 'handoff'}:${state.updatedAt}`,
    blockedBy: canAccept ? [] : [...new Set([...stringList(nextAction.blockedBy), ...scopeViolations])],
    workspaceBoundary: {
      boundaryRef: state.workspaceScope.boundaryRef,
      policyMode: state.workspaceScope.policyMode,
      allowed: state.workspaceScope.allowed,
      readOnly: state.workspaceScope.readOnly,
      violations: scopeViolations
    },
    confirmation: {
      auditDestination: auditHandoff.destination,
      handoffId: auditHandoff.handoffId,
      tenantId: state.tenant.tenantId,
      workspaceId: state.tenant.workspaceId,
      clientRequestId: state.clientRuntime?.requestId || null,
      workflowRef: state.workflowHandoff?.workflowRef || null,
      continuationToken: state.workflowHandoff?.continuation?.continuationToken || null,
      returnRoute: state.workflowHandoff?.continuation?.returnRoute || null
    }
  };
}

function buildNextStepContracts({ state, nextAction, readinessGates }) {
  const blockedGate = readinessGates.find((gate) => !gate.ready);
  const primary = {
    schema: 'aios.review-ready.next-step.v1',
    action: nextAction.action,
    command: nextAction.command,
    reason: nextAction.reason,
    dueAt: nextAction.dueAt,
    blockedBy: stringList(nextAction.blockedBy),
    gate: blockedGate?.gate || null,
    explanation: blockedGate
      ? `${blockedGate.label}: ${blockedGate.detail}`
      : 'Review-ready state can proceed to audit handoff.'
  };
  const alternatives = readinessGates
    .filter((gate) => !gate.ready && gate.gate !== primary.gate)
    .map((gate) => ({
      action: gate.gate === 'providers' ? 'sync-provider-contracts' : nextAction.action,
      command: gate.gate === 'providers' ? 'sync-provider-contracts' : nextAction.command,
      gate: gate.gate,
      reason: gate.detail,
      blockedBy: gate.blockedBy
    }));
  return {
    primary,
    alternatives,
    generatedAt: state.updatedAt
  };
}

function buildReviewDecisionContract({
  state,
  preview,
  acceptance,
  validationSummary,
  nextSteps,
  readinessGates,
  workflowHandoff
}) {
  const blockedGates = readinessGates.filter((gate) => !gate.ready);
  const validationRows = [
    {
      key: 'readiness',
      label: 'Readiness gates',
      status: blockedGates.length === 0 ? 'pass' : 'blocked',
      detail: blockedGates.length === 0
        ? 'All readiness gates are clear.'
        : `${blockedGates.length} readiness gate${blockedGates.length === 1 ? '' : 's'} need attention.`,
      blockedBy: blockedGates.map((gate) => gate.gate)
    },
    {
      key: 'validation',
      label: 'Validation summary',
      status: validationSummary.status,
      detail: validationSummary.ok
        ? 'Validation passed for the current hosted-kernel state.'
        : `${validationSummary.blockingCount} blocking validation issue${validationSummary.blockingCount === 1 ? '' : 's'} remain.`,
      blockedBy: validationSummary.failedGates
    },
    {
      key: 'acceptance',
      label: 'Acceptance',
      status: acceptance.acceptEnabled ? 'enabled' : 'blocked',
      detail: acceptance.acceptEnabled
        ? 'The reviewer can accept and seal this review-ready state.'
        : acceptance.commandLabel,
      blockedBy: acceptance.blockedBy
    },
    {
      key: 'client-runtime',
      label: 'Client runtime',
      status: state.clientRuntime.missingCapabilities.length === 0 ? 'pass' : 'blocked',
      detail: state.clientRuntime.missingCapabilities.length === 0
        ? 'The client can render preview, handoff, and command submission.'
        : 'The client is missing required runtime capabilities.',
      blockedBy: state.clientRuntime.missingCapabilities.map((capability) => `client-missing:${capability}`)
    }
  ];
  const readinessChecklist = readinessGates.map((gate, index) => ({
    sequence: index + 1,
    gate: gate.gate,
    label: gate.label,
    state: gate.ready ? 'ready' : gate.severity === 'blocking' ? 'blocked' : 'attention',
    detail: gate.detail,
    blockedBy: gate.blockedBy,
    previewAnchor: `${state.clientRuntime.routes.preview}#gate-${gate.gate}`
  }));
  const commandTarget = workflowHandoff.continuation?.commandTarget || null;
  const auditTarget = workflowHandoff.continuation?.auditTarget || null;
  const previewTarget = workflowHandoff.continuation?.previewTarget || null;
  const primaryTarget = acceptance.acceptEnabled
    ? {
        method: 'POST',
        route: state.clientRuntime.routes.command,
        command: acceptance.command,
        idempotencyKey: acceptance.idempotencyKey,
        payload: {
          command: acceptance.command,
          tenantId: state.tenant.tenantId,
          workspaceId: state.tenant.workspaceId,
          isolationKey: state.tenant.isolationKey,
          handoffId: acceptance.confirmation.handoffId,
          workflowRef: acceptance.confirmation.workflowRef,
          continuationToken: acceptance.confirmation.continuationToken
        }
      }
    : commandTarget || auditTarget || previewTarget;
  const nextStepRows = [
    nextSteps.primary,
    ...nextSteps.alternatives
  ].map((step, index) => ({
    sequence: index + 1,
    action: step.action,
    command: step.command || null,
    gate: step.gate || null,
    reason: step.reason,
    explanation: step.explanation || step.reason,
    blockedBy: stringList(step.blockedBy),
    targetRoute: step.command ? state.clientRuntime.routes.command : state.clientRuntime.routes.handoff
  }));
  return {
    schema: 'aios.review-ready.review-decision.v1',
    decisionId: `${state.tenant.isolationKey}:${surfaceName}:review-decision:${digest({
      status: state.status,
      validationStatus: validationSummary.status,
      acceptanceEnabled: acceptance.acceptEnabled,
      nextAction: nextSteps.primary.action,
      requestId: state.clientRuntime.requestId
    })}`,
    generatedAt: state.updatedAt,
    state: acceptance.accepted
      ? 'accepted'
      : acceptance.acceptEnabled
        ? 'acceptance-ready'
        : validationSummary.ok
          ? 'handoff-ready'
          : 'action-required',
    title: preview.title,
    status: state.status,
    routes: {
      preview: state.clientRuntime.routes.preview,
      command: state.clientRuntime.routes.command,
      handoff: state.clientRuntime.routes.handoff,
      return: state.clientRuntime.routes.return
    },
    primaryAction: {
      action: acceptance.acceptEnabled ? 'accept-review-ready' : nextSteps.primary.action,
      command: acceptance.acceptEnabled ? acceptance.command : nextSteps.primary.command,
      label: acceptance.acceptEnabled ? acceptance.commandLabel : workflowHandoff.userVisibleAction,
      enabled: acceptance.acceptEnabled || Boolean(commandTarget || auditTarget),
      reason: acceptance.acceptEnabled ? 'acceptance-ready' : nextSteps.primary.reason,
      blockedBy: acceptance.acceptEnabled ? [] : [...new Set([
        ...stringList(acceptance.blockedBy),
        ...stringList(nextSteps.primary.blockedBy)
      ])],
      target: primaryTarget
    },
    readinessChecklist,
    validationRows,
    nextStepRows,
    acceptance: {
      accepted: acceptance.accepted,
      acceptEnabled: acceptance.acceptEnabled,
      requiresPermission: acceptance.requiresPermission,
      actorCanExecute: acceptance.actorCanExecute,
      confirmation: acceptance.confirmation
    },
    proof: {
      previewDigest: digest(preview),
      validationDigest: digest(validationRows),
      decisionDigest: digest({
        readinessChecklist,
        validationRows,
        nextStepRows,
        acceptance: acceptance.confirmation,
        primaryAction: primaryTarget
      })
    }
  };
}

function historySnapshot({ state, reason, capturedAt }) {
  const exportRef = `${state.tenant.isolationKey}:${surfaceName}:analytics-export:${capturedAt}`;
  const material = {
    tenantId: state.tenant.tenantId,
    workspaceId: state.tenant.workspaceId,
    status: state.status,
    analytics: state.analytics,
    reason,
    capturedAt
  };
  return {
    snapshotId: `${state.tenant.isolationKey}:${surfaceName}:${capturedAt}:${reason}`,
    capturedAt,
    reason,
    status: state.status,
    readyCheckCount: state.analytics.readyCheckCount,
    missingProofCount: state.analytics.missingProofCount,
    commandCount: state.analytics.commandCount,
    evidenceCount: state.analytics.evidenceCount,
    rejectedCommandCount: state.analytics.rejectedCommandCount,
    activeHealthIncidentCount: state.analytics.activeHealthIncidentCount,
    retryQueueDepth: state.analytics.retryQueueDepth,
    providerCount: state.analytics.providerCount,
    staleProviderCount: state.analytics.staleProviderCount,
    readyForAudit: Boolean(state.auditHandoff?.readyForAudit),
    readyForExternalHandoff: Boolean(state.auditHandoff?.readyForExternalHandoff),
    exportRef,
    digest: digest(material)
  };
}

function numericDelta(current, previous, key) {
  return Number(current?.[key] || 0) - Number(previous?.[key] || 0);
}

function buildAnalyticsHistoryReport({ state, analytics, historySnapshots, readinessGates, timeline }) {
  const previous = historySnapshots.length > 1 ? historySnapshots[historySnapshots.length - 2] : null;
  const statusCounts = historySnapshots.reduce((counts, snapshot) => ({
    ...counts,
    [snapshot.status]: (counts[snapshot.status] || 0) + 1
  }), {});
  const first = historySnapshots[0] || null;
  const last = historySnapshots.at(-1) || null;
  const gateRows = readinessGates.map((gate) => ({
    gate: gate.gate,
    label: gate.label,
    ready: gate.ready,
    severity: gate.severity,
    blockedBy: gate.blockedBy
  }));
  const eventCounts = timeline.reduce((counts, event) => ({
    ...counts,
    [event.type]: (counts[event.type] || 0) + 1
  }), {});
  const unresolvedGateCount = readinessGates.filter((gate) => !gate.ready).length;
  return {
    schema: 'aios.review-ready.analytics-history.v1',
    generatedAt: state.updatedAt,
    snapshotCount: historySnapshots.length,
    retainedSnapshotLimit: 20,
    firstCapturedAt: first?.capturedAt || null,
    lastCapturedAt: last?.capturedAt || null,
    statusCounts,
    latest: last,
    previousSnapshotId: previous?.snapshotId || null,
    deltas: {
      readyCheckCount: numericDelta(analytics, previous, 'readyCheckCount'),
      missingProofCount: numericDelta(analytics, previous, 'missingProofCount'),
      commandCount: numericDelta(analytics, previous, 'commandCount'),
      rejectedCommandCount: numericDelta(analytics, previous, 'rejectedCommandCount'),
      evidenceCount: numericDelta(analytics, previous, 'evidenceCount'),
      activeHealthIncidentCount: numericDelta(analytics, previous, 'activeHealthIncidentCount'),
      staleProviderCount: numericDelta(analytics, previous, 'staleProviderCount')
    },
    cadence: {
      reviewCadenceMinutes: state.settings.reviewCadenceMinutes,
      scheduledFor: state.schedule.scheduledFor,
      due: state.schedule.due,
      overdue: Boolean(state.schedule.scheduledFor && state.schedule.scheduledFor <= state.updatedAt && !READY_STATUSES.has(state.status))
    },
    readiness: {
      unresolvedGateCount,
      readyGateCount: readinessGates.length - unresolvedGateCount,
      gateRows
    },
    timeline: {
      eventCount: timeline.length,
      eventCounts,
      latestEvent: timeline.at(-1) || null
    }
  };
}

function buildAnalyticsExportBundle({
  state,
  analytics,
  historySnapshots,
  readinessGates,
  timeline,
  validationSummary,
  auditHandoff,
  nextAction,
  timelineReport
}) {
  const exportId = `${state.tenant.isolationKey}:${surfaceName}:analytics-export:${state.updatedAt}`;
  const counterRows = Object.entries({
    readyCheckCount: analytics.readyCheckCount,
    missingProofCount: analytics.missingProofCount,
    evidenceCount: analytics.evidenceCount,
    proofEvidenceCount: analytics.proofEvidenceCount,
    commandCount: analytics.commandCount,
    acceptedCommandCount: analytics.acceptedCommandCount,
    rejectedCommandCount: analytics.rejectedCommandCount,
    deferredCommandCount: analytics.deferredCommandCount,
    activeHealthIncidentCount: analytics.activeHealthIncidentCount,
    retryQueueDepth: analytics.retryQueueDepth,
    providerCount: analytics.providerCount,
    acceptedProviderCount: analytics.acceptedProviderCount,
    staleProviderCount: analytics.staleProviderCount
  }).map(([metric, value]) => ({
    metric,
    value,
    tenantId: state.tenant.tenantId,
    workspaceId: state.tenant.workspaceId,
    capturedAt: state.updatedAt
  }));
  return {
    schema: 'aios.review-ready.analytics-export.v1',
    exportId,
    generatedAt: state.updatedAt,
    surfaceId,
    tenant: state.tenant,
    status: state.status,
    auditReady: auditHandoff.readyForAudit,
    externalHandoffReady: auditHandoff.readyForExternalHandoff,
    validationStatus: validationSummary.status,
    nextAction: {
      action: nextAction.action,
      command: nextAction.command,
      reason: nextAction.reason,
      dueAt: nextAction.dueAt,
      blockedBy: stringList(nextAction.blockedBy)
    },
    manifest: {
      rowSets: ['counters', 'readinessGates', 'historySnapshots', 'timelineEvents', 'timelineReportRows'],
      counterRows: counterRows.length,
      readinessGateRows: readinessGates.length,
      historyRows: historySnapshots.length,
      timelineRows: timeline.length,
      timelineReportRows: timelineReport?.reportRows?.length || 0,
      digest: digest({
        counterRows,
        readinessGates,
        historySnapshots,
        timeline,
        timelineReport
      })
    },
    timelineReport: timelineReport || null,
    timelineReportRows: (timelineReport?.reportRows || []).map((row, index) => ({
      sequence: index + 1,
      section: row.section,
      metric: row.metric,
      value: row.value,
      status: row.status,
      capturedAt: state.updatedAt,
      reportId: timelineReport.reportId
    })),
    counters: counterRows,
    readinessGates: readinessGates.map((gate) => ({
      gate: gate.gate,
      label: gate.label,
      ready: gate.ready,
      severity: gate.severity,
      detail: gate.detail,
      blockedBy: gate.blockedBy
    })),
    historySnapshots,
    timelineEvents: timeline.map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      type: event.type,
      label: event.label,
      status: event.status,
      ref: event.ref
    }))
  };
}

function refreshReportingState(state, reason = 'state-shaped') {
  const providerServiceContract = buildProviderServiceContract({
    providers: state.providers,
    tenant: state.tenant,
    clientRuntime: state.clientRuntime,
    updatedAt: state.updatedAt
  });
  const nextAction = deriveNextAction({
    status: state.status,
    checks: state.checks,
    recovery: state.recovery,
    settings: state.settings,
    schedule: state.schedule,
    updatedAt: state.updatedAt,
    providers: state.providers,
    health: state.operationalHealth
  });
  const auditHandoff = normalizeAuditHandoff({
    state: state.auditHandoff,
    tenant: state.tenant,
    workspaceScope: state.workspaceScope,
    status: state.status,
    updatedAt: state.updatedAt,
    checks: state.checks,
    recovery: state.recovery,
    settings: state.settings,
    nextAction,
    providers: state.providers,
    health: state.operationalHealth,
    providerServiceContract
  });
  const analytics = reviewReadyAnalytics({
    checks: state.checks,
    recovery: state.recovery,
    evidence: state.evidence,
    commandLedger: state.commandLedger,
    status: state.status,
    providers: state.providers,
    settings: state.settings,
    health: state.operationalHealth
  });
  const reporting = {
    readinessGates: buildReadinessGates({ state, analytics, auditHandoff }),
    timeline: reviewReadyTimeline({
      checks: state.checks,
      recovery: state.recovery,
      evidence: state.evidence,
      commandLedger: state.commandLedger,
      updatedAt: state.updatedAt,
      health: state.operationalHealth
    })
  };
  const timelineReport = buildTimelineReportingState({
    state,
    analytics,
    readinessGates: reporting.readinessGates,
    timeline: reporting.timeline,
    nextAction
  });
  const validationSummary = buildValidationSummary({
    state,
    analytics,
    auditHandoff,
    readinessGates: reporting.readinessGates
  });
  const workflowHandoff = buildWorkflowHandoff({
    state,
    nextAction,
    readinessGates: reporting.readinessGates,
    validationSummary,
    auditHandoff
  });
  const proofManifest = buildProofManifest({
    state,
    auditHandoff,
    readinessGates: reporting.readinessGates
  });
  const stateWithWorkflow = {
    ...state,
    providerServiceContract,
    analytics,
    auditHandoff,
    workflowHandoff
  };
  const persistence = buildPersistenceEnvelope({
    state: stateWithWorkflow,
    readinessGates: reporting.readinessGates,
    validationSummary,
    proofManifest
  });
  const restartSafe = state.restartSafe && persistence.restartSafe;
  const blocked = state.blocked || persistence.status === 'blocked';
  const stateWithProofManifest = {
    ...state,
    restartSafe,
    blocked,
    analytics,
    auditHandoff,
    workflowHandoff,
    providerServiceContract,
    proofManifest,
    persistence
  };
  const lifecycleControls = buildLifecycleControlPanel({
    state: stateWithProofManifest,
    nextAction,
    readinessGates: reporting.readinessGates
  });
  const stateWithControls = {
    ...stateWithProofManifest,
    lifecycleControls
  };
  const preview = buildPreviewContract({
    state: stateWithControls,
    analytics,
    auditHandoff,
    readinessGates: reporting.readinessGates,
    validationSummary,
    workflowHandoff,
    timelineReport
  });
  const acceptance = buildAcceptanceContract({
    state: stateWithControls,
    nextAction,
    validationSummary,
    auditHandoff
  });
  const nextSteps = buildNextStepContracts({
    state: stateWithControls,
    nextAction,
    readinessGates: reporting.readinessGates
  });
  const reviewDecision = buildReviewDecisionContract({
    state: stateWithControls,
    preview,
    acceptance,
    validationSummary,
    nextSteps,
    readinessGates: reporting.readinessGates,
    workflowHandoff
  });
  const historySnapshots = normalizeHistorySnapshots([
    ...normalizeHistorySnapshots(state.historySnapshots),
    historySnapshot({
      state: { ...state, analytics, auditHandoff },
      reason,
      capturedAt: state.updatedAt
    })
  ]);
  const analyticsHistory = buildAnalyticsHistoryReport({
    state,
    analytics,
    historySnapshots,
    readinessGates: reporting.readinessGates,
    timeline: reporting.timeline
  });
  const analyticsExport = buildAnalyticsExportBundle({
    state,
    analytics,
    historySnapshots,
    readinessGates: reporting.readinessGates,
    timeline: reporting.timeline,
    validationSummary,
    auditHandoff,
    nextAction,
    timelineReport
  });

  return {
    ...state,
    restartSafe,
    blocked,
    providerServiceContract,
    auditHandoff,
    workflowHandoff,
    proofManifest,
    persistence,
    lifecycleControls,
    nextAction,
    analytics,
    readinessGates: reporting.readinessGates,
    validationSummary,
    preview,
    acceptance,
    reviewDecision,
    nextSteps,
    timeline: reporting.timeline,
    timelineReport,
    analyticsHistory,
    analyticsExport,
    exportSummary: exportReadySummary({
      tenant: state.tenant,
      status: state.status,
      updatedAt: state.updatedAt,
      analytics,
      auditHandoff,
      settings: state.settings,
      schedule: state.schedule,
      nextAction,
      health: state.operationalHealth,
      workflowHandoff,
      reviewDecision,
      providerServiceContract,
      timelineReport,
      lifecycleControls
    }),
    historySnapshots
  };
}

export function shapeReviewReadyState(input = {}) {
  const persisted = asRecord(input.persistedState || input.state);
  const now = timestamp(input.now || persisted.updatedAt);
  const tenant = normalizeTenantContext({ ...asRecord(persisted.tenant), ...input });
  const actor = normalizeActor(input.actor || persisted.actor);
  const workspacePolicy = normalizeWorkspacePolicy(input.workspacePolicy || persisted.workspacePolicy || persisted.workspaceScope, tenant);
  const workspaceScope = workspaceScopeFrom({ tenant, actor, policy: workspacePolicy });
  const clientRuntime = normalizeClientRuntime({
    input,
    persisted: persisted.clientRuntime,
    tenant,
    actor,
    now
  });
  const checks = normalizeChecks({ ...persisted.checks, ...asRecord(input.checks) });
  const settings = normalizeLifecycleSettings({ ...persisted.settings, ...asRecord(input.settings) });
  const schedule = normalizeReviewSchedule({ ...persisted.schedule, ...asRecord(input.schedule) }, now);
  const providers = normalizeProviderContracts(input.providers || input.providerContracts || persisted.providers, now);
  const operationalHealth = normalizeOperationalHealth({
    input,
    persisted: persisted.operationalHealth || persisted.health,
    providers,
    now
  });
  const evidence = [...asEvidenceList(persisted.evidence), ...asEvidenceList(input.evidence)];
  const recovery = normalizeRecoveryState({
    input: { ...input, requireRecoveryProof: settings.requireRecoveryProof },
    persisted: persisted.recovery,
    evidence,
    now
  });
  const derivedStatus = deriveStatus(checks, recovery, settings, operationalHealth);
  const statusDecision = persistedStatusDecision({
    requestedStatus: input.status || persisted.status,
    derivedStatus,
    checks,
    recovery,
    settings,
    health: operationalHealth
  });
  const finalStatus = statusDecision.status;

  return refreshReportingState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    surfaceId,
    surfaceGroup,
    surfaceName,
    status: finalStatus,
    restartSafe: READY_STATUSES.has(finalStatus)
      && statusDecision.reason !== 'persisted-status-reshaped'
      && !recovery.required
      && operationalHealth.status === 'healthy',
    blocked: BLOCKED_STATUSES.has(finalStatus),
    updatedAt: now,
    tenant,
    actor,
    workspacePolicy,
    workspaceScope,
    clientRuntime,
    permissionBoundary: {
      roles: actor.roles,
      permissions: actor.permissions,
      knownCommands: Object.keys(COMMAND_PERMISSIONS)
    },
    checks,
    settings,
    schedule,
    recovery,
    providers,
    operationalHealth,
    statusDecision,
    evidence,
    commandLedger: normalizeCommandLedger(persisted.commandLedger),
    auditHandoff: persisted.auditHandoff,
    persistedEnvelope: persisted.persistence || persisted.persistenceEnvelope,
    historySnapshots: persisted.historySnapshots || persisted.history || []
  }, 'state-shaped');
}

function normalizeAuditHandoff({
  state,
  tenant,
  workspaceScope,
  status,
  updatedAt,
  checks,
  recovery,
  settings,
  nextAction,
  providers,
  health,
  providerServiceContract
}) {
  const existing = asRecord(state);
  const missingProofs = Object.entries(checks)
    .filter(([, check]) => !check.ok || !check.proof)
    .map(([name]) => name);
  const providerSummary = providerContractSummary(providers);
  const providerHandoffReady = providerServiceContract?.externalHandoff?.state === 'ready';
  const recoveryProofReady = recoveryProofSatisfied(recovery, settings);
  const healthReady = health.status === 'healthy';
  const workspaceReady = workspaceScope.allowed && workspaceScope.auditReadable;
  const blockedBy = [
    ...stringList(nextAction?.blockedBy),
    ...health.actionableErrors.map((error) => error.code),
    ...stringList(workspaceScope.violations),
    ...(workspaceScope.auditReadable ? [] : ['missing-permission:audit:read'])
  ];
  return {
    destination: text(existing.destination, 'kernel-audit-log'),
    handoffId: text(existing.handoffId, `${tenant.isolationKey}:${surfaceName}:${updatedAt}`),
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    isolationKey: tenant.isolationKey,
    status,
    readyForAudit: status === 'review-ready'
      && missingProofs.length === 0
      && !recovery.required
      && recoveryProofReady
      && healthReady
      && workspaceReady,
    readyForExternalHandoff: status === 'review-ready'
      && missingProofs.length === 0
      && !recovery.required
      && recoveryProofReady
      && healthReady
      && workspaceReady
      && providerSummary.readyForExternalHandoff
      && providerHandoffReady,
    workspaceBoundary: {
      boundaryRef: workspaceScope.boundaryRef,
      policyMode: workspaceScope.policyMode,
      allowed: workspaceScope.allowed,
      readOnly: workspaceScope.readOnly,
      auditReadable: workspaceScope.auditReadable,
      writable: workspaceScope.writable,
      configurable: workspaceScope.configurable,
      sealable: workspaceScope.sealable,
      violations: workspaceScope.violations
    },
    missingProofs,
    recoveryProofRefs: recovery.proofRefs,
    recoveryProofStatus: recovery.proofStatus,
    healthStatus: health.status,
    degradedMode: health.degradedMode,
    healthRunbook: buildOperationalHealthRunbook(health, updatedAt),
    actionableErrors: health.actionableErrors,
    providerContracts: providers.map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      contractVersion: provider.contractVersion,
      endpoint: provider.endpoint,
      negotiationStatus: provider.negotiation.status,
      syncStatus: provider.sync.status,
      lastSyncedAt: provider.sync.lastSyncedAt,
      externalRef: provider.handoff.externalRef,
      handoffState: provider.handoff.state,
      missingCapabilities: provider.missingCapabilities
    })),
    providerServiceContract: providerServiceContract ? {
      contractId: providerServiceContract.contractId,
      negotiationState: providerServiceContract.negotiation.state,
      externalHandoffState: providerServiceContract.externalHandoff.state,
      globalCursor: providerServiceContract.syncMetadata.globalCursor,
      readyProviderIds: providerServiceContract.readyProviderIds,
      blockedBy: providerServiceContract.externalHandoff.blockedBy
    } : null,
    nextAction: nextAction?.action || null,
    blockedBy: [...new Set([...blockedBy, ...stringList(providerServiceContract?.externalHandoff?.blockedBy)])],
    nextActionDueAt: nextAction?.dueAt || null,
    generatedAt: timestamp(existing.generatedAt || updatedAt)
  };
}

export function applyReviewReadyCommand(state = {}, command = {}) {
  const shaped = shapeReviewReadyState({ state, now: command.now });
  const commandName = String(command.command || command.type || '');
  const actor = normalizeActor(command.actor || command.subject);
  const commandTenant = normalizeTenantContext({ ...shaped.tenant, ...asRecord(command.tenant), ...command });
  const commandWorkspacePolicy = normalizeWorkspacePolicy(shaped.workspacePolicy, commandTenant);
  const commandWorkspaceScope = workspaceScopeFrom({ tenant: commandTenant, actor, policy: commandWorkspacePolicy });
  const commandId = commandIdempotencyKey(commandName, command, commandTenant);
  const decision = boundaryDecision(actor, commandName, shaped.tenant, commandTenant);
  const scopeViolations = commandWorkspaceViolations(commandName, commandWorkspaceScope);
  const violations = [...new Set([...decision.violations, ...scopeViolations])].sort();

  if (shaped.commandLedger[commandId]) {
    return {
      ...shaped,
      idempotent: true,
      lastCommand: shaped.commandLedger[commandId]
    };
  }

  const appliedAt = timestamp(command.now);
  const next = {
    ...shaped,
    updatedAt: appliedAt,
    idempotent: false,
    actor,
    workspacePolicy: commandWorkspacePolicy,
    workspaceScope: commandWorkspaceScope,
    commandLedger: {
      ...shaped.commandLedger,
      [commandId]: {
        command: commandName || 'unknown',
        status: 'accepted',
        appliedAt,
        actorId: actor.id,
        tenantId: commandTenant.tenantId,
        workspaceId: commandTenant.workspaceId,
        violations: []
      }
    }
  };

  if (violations.length > 0) {
    next.commandLedger[commandId].status = 'rejected';
    next.commandLedger[commandId].violations = violations;
    next.boundary = {
      allowed: false,
      requiredPermission: decision.requiredPermission,
      violations,
      tenant: commandTenant,
      workspace: {
        boundaryRef: commandWorkspaceScope.boundaryRef,
        policyMode: commandWorkspaceScope.policyMode,
        readOnly: commandWorkspaceScope.readOnly,
        allowed: commandWorkspaceScope.allowed
      }
    };
    next.lastCommand = next.commandLedger[commandId];
    return refreshReportingState(next, `command:${commandName || 'unknown'}`);
  }

  if (commandName === 'record-check') {
    if (!next.settings.enabled) {
      next.commandLedger[commandId].status = 'deferred';
      next.commandLedger[commandId].violations = ['lifecycle-disabled'];
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    const checkName = String(command.check || '');
    if (!DEFAULT_CHECKS.includes(checkName)) {
      next.commandLedger[commandId].status = 'rejected';
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    next.checks = {
      ...next.checks,
      [checkName]: {
        ok: Boolean(command.ok),
        proof: typeof command.proof === 'string' && command.proof.length > 0 ? command.proof : null,
        observedAt: appliedAt
      }
    };
    if (next.checks[checkName].proof) {
      next.evidence = [
        ...next.evidence,
        { type: 'check-proof', ref: proofRef(next.checks[checkName].proof), capturedAt: appliedAt }
      ];
    }
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'record-health-error') {
    const incident = normalizeHealthIncident({
      id: command.incidentId || command.id,
      source: command.source || 'operator',
      code: command.code || command.errorCode || 'operator-recorded-health-error',
      message: command.message || command.detail,
      severity: command.severity || 'warning',
      retryable: command.retryable,
      attemptCount: command.attemptCount ?? command.attempts ?? 0,
      occurredAt: command.occurredAt || appliedAt,
      nextRetryAt: command.nextRetryAt,
      action: command.action || command.recoveryAction,
      proofRef: command.proofRef || command.proof
    }, 0, appliedAt, next.operationalHealth.retryPolicy, command.source || 'operator');
    next.operationalHealth = normalizeOperationalHealth({
      input: {
        operationalHealth: {
          incidents: [...next.operationalHealth.incidents, incident],
          retryPolicy: next.operationalHealth.retryPolicy
        }
      },
      persisted: { retryPolicy: next.operationalHealth.retryPolicy },
      providers: next.providers,
      now: appliedAt
    });
    if (incident.proofRef) {
      next.evidence = [
        ...next.evidence,
        { type: 'operational-health-proof', ref: incident.proofRef, capturedAt: appliedAt }
      ];
    }
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'retry-health-error') {
    const target = text(command.incidentId || command.id || command.code || command.errorCode, null);
    const targetIncident = next.operationalHealth.incidents.find((incident) => (
      !incident.resolvedAt && (!target || incident.incidentId === target || incident.code === target)
    ));
    if (!targetIncident) {
      next.commandLedger[commandId].status = 'deferred';
      next.commandLedger[commandId].violations = ['health-incident-not-found'];
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    const retryDue = targetIncident.nextRetryAt ? Date.parse(targetIncident.nextRetryAt) : null;
    const appliedMs = Date.parse(appliedAt);
    const retryNotDue = retryDue && Number.isFinite(retryDue) && Number.isFinite(appliedMs) && retryDue > appliedMs;
    if (!targetIncident.retryable) {
      next.commandLedger[commandId].status = 'rejected';
      next.commandLedger[commandId].violations = ['health-incident-not-retryable'];
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    if (targetIncident.exhausted) {
      next.commandLedger[commandId].status = 'rejected';
      next.commandLedger[commandId].violations = ['retry-attempts-exhausted'];
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    if (retryNotDue && !booleanSetting(command.force, false)) {
      next.commandLedger[commandId].status = 'deferred';
      next.commandLedger[commandId].violations = [`retry-not-due:${targetIncident.nextRetryAt}`];
      next.lastCommand = next.commandLedger[commandId];
      return refreshReportingState(next, `command:${commandName}`);
    }
    const retriedIncident = retryHealthIncident({
      incident: targetIncident,
      command,
      appliedAt,
      policy: next.operationalHealth.retryPolicy
    });
    next.operationalHealth = normalizeOperationalHealth({
      input: {
        operationalHealth: {
          incidents: next.operationalHealth.incidents.map((incident) => (
            incident.incidentId === targetIncident.incidentId ? retriedIncident : incident
          )),
          retryPolicy: next.operationalHealth.retryPolicy
        }
      },
      persisted: { retryPolicy: next.operationalHealth.retryPolicy },
      providers: next.providers,
      now: appliedAt
    });
    next.evidence = [
      ...next.evidence,
      {
        type: retriedIncident.resolvedAt ? 'operational-health-proof' : 'operational-health-retry',
        ref: retriedIncident.proofRef || `${retriedIncident.incidentId}:attempt:${retriedIncident.attemptCount}`,
        capturedAt: appliedAt
      }
    ];
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'clear-health-error') {
    const target = text(command.incidentId || command.id || command.code || command.errorCode, null);
    const incidents = next.operationalHealth.incidents.map((incident) => (
      !incident.resolvedAt && (!target || incident.incidentId === target || incident.code === target)
        ? {
            ...incident,
            resolvedAt: appliedAt,
            proofRef: proofRef(command.proofRef || command.proof || incident.proofRef, incident.proofRef)
          }
        : incident
    ));
    if (target && incidents.every((incident) => incident.resolvedAt !== appliedAt)) {
      next.commandLedger[commandId].status = 'deferred';
      next.commandLedger[commandId].violations = ['health-incident-not-found'];
    }
    next.operationalHealth = normalizeOperationalHealth({
      input: {
        operationalHealth: {
          incidents,
          retryPolicy: next.operationalHealth.retryPolicy
        }
      },
      persisted: { retryPolicy: next.operationalHealth.retryPolicy },
      providers: next.providers,
      now: appliedAt
    });
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'mark-recovery-required') {
    next.recovery = normalizeRecoveryState({
      input: {
        recoveryRequired: true,
        recoveryReason: command.reason || 'unspecified',
        requireRecoveryProof: next.settings.requireRecoveryProof
      },
      persisted: next.recovery,
      evidence: next.evidence,
      now: appliedAt
    });
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'mark-recovered') {
    const recoveryEvidence = asEvidenceList(command.evidence);
    const submittedProofRefs = [
      ...normalizeProofRefs(command.proofRefs || command.proofRef || command.proof),
      ...proofRefsFromEvidence(recoveryEvidence, 'recovery-proof')
    ];
    if (next.settings.requireRecoveryProof && submittedProofRefs.length === 0) {
      next.commandLedger[commandId].status = 'deferred';
      next.commandLedger[commandId].violations = ['recovery-proof-missing'];
      next.recovery = normalizeRecoveryState({
        input: {
          recoveredAt: appliedAt,
          requireRecoveryProof: next.settings.requireRecoveryProof
        },
        persisted: next.recovery,
        evidence: next.evidence,
        now: appliedAt
      });
    } else {
      const capturedRecoveryEvidence = submittedProofRefs.map((ref) => ({
        type: 'recovery-proof',
        ref,
        capturedAt: appliedAt
      }));
      next.evidence = [...next.evidence, ...recoveryEvidence, ...capturedRecoveryEvidence];
      next.recovery = normalizeRecoveryState({
        input: {
          recoveryRequired: false,
          recoveryReason: null,
          recoveredAt: appliedAt,
          recoveryProofRefs: submittedProofRefs,
          requireRecoveryProof: next.settings.requireRecoveryProof
        },
        persisted: next.recovery,
        evidence: next.evidence,
        now: appliedAt
      });
    }
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'seal-review-ready') {
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
    if (!READY_STATUSES.has(next.status)) next.commandLedger[commandId].status = 'deferred';
  } else if (commandName === 'set-lifecycle-enabled') {
    next.settings = normalizeLifecycleSettings({
      ...next.settings,
      enabled: command.enabled ?? command.value
    });
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'update-lifecycle-settings') {
    next.settings = normalizeLifecycleSettings({
      ...next.settings,
      ...asRecord(command.settings),
      ...(command.minProofRefs !== undefined ? { minProofRefs: command.minProofRefs } : {}),
      ...(command.reviewCadenceMinutes !== undefined ? { reviewCadenceMinutes: command.reviewCadenceMinutes } : {}),
      ...(command.autoSeal !== undefined ? { autoSeal: command.autoSeal } : {}),
      ...(command.requireRecoveryProof !== undefined ? { requireRecoveryProof: command.requireRecoveryProof } : {})
    });
    if (!next.settings.validation.ok) next.commandLedger[commandId].violations = next.settings.validation.violations;
    next.recovery = normalizeRecoveryState({
      input: { requireRecoveryProof: next.settings.requireRecoveryProof },
      persisted: next.recovery,
      evidence: next.evidence,
      now: appliedAt
    });
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else if (commandName === 'schedule-review-window') {
    next.schedule = normalizeReviewSchedule({
      ...next.schedule,
      scheduledFor: command.scheduledFor || command.nextReviewAt,
      pausedUntil: command.pausedUntil,
      enabledUntil: command.enabledUntil,
      lastReviewedAt: command.lastReviewedAt || next.schedule.lastReviewedAt,
      reason: command.reason || 'operator-scheduled'
    }, appliedAt);
  } else if (commandName === 'sync-provider-contracts') {
    next.providers = normalizeProviderContracts(command.providers || command.providerContracts || next.providers, appliedAt);
    next.operationalHealth = normalizeOperationalHealth({
      input: { operationalHealth: next.operationalHealth },
      persisted: { retryPolicy: next.operationalHealth.retryPolicy },
      providers: next.providers,
      now: appliedAt
    });
    next.status = deriveStatus(next.checks, next.recovery, next.settings, next.operationalHealth);
  } else {
    next.commandLedger[commandId].status = 'ignored';
  }

  next.restartSafe = READY_STATUSES.has(next.status) && !next.recovery.required && next.operationalHealth.status === 'healthy';
  next.blocked = BLOCKED_STATUSES.has(next.status);
  next.lastCommand = next.commandLedger[commandId];
  return refreshReportingState(next, `command:${commandName || 'unknown'}`);
}

export function recoverReviewReadyState(input = {}) {
  const state = shapeReviewReadyState(input);
  const missingProofs = Object.entries(state.checks)
    .filter(([, check]) => !check.ok || !check.proof)
    .map(([name]) => name);
  const restoreCommands = Array.isArray(state.persistence?.restorePlan?.commands)
    ? state.persistence.restorePlan.commands
    : missingProofs.map((name) => ({
        command: 'record-check',
        check: name,
        requiredProof: `${surfaceName}:${name}`,
        reason: 'missing-required-proof'
      }));
  const restoreStatus = state.recovery.required
    ? 'recovery-required'
    : state.persistence?.status || state.status;
  const restartStatus = state.persistence?.restartStatus || {
    state: restoreStatus,
    restartSafe: state.restartSafe,
    canRestore: Boolean(state.persistence?.canRestore),
    blockedBy: []
  };

  return {
    ...state,
    status: state.recovery.required ? 'recovery-required' : state.status,
    restartSafe: state.restartSafe && missingProofs.length === 0 && restartStatus.restartSafe === true,
    recoveryPlan: restoreCommands,
    restoreStatus,
    restartStatus,
    restartSafeStatus: restartStatus.state,
    replaySafe: Boolean(state.persistence?.restorePlan?.replaySafe),
    restoreCursor: state.persistence?.replayCursor || commandReplayCursor(state.commandLedger),
    restoreBlockedBy: state.persistence?.restorePlan?.blockedGates || []
  };
}

export function describeReviewReadySurface(input = {}) {
  const state = recoverReviewReadyState(input);
  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: state.updatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted kernel review-ready state persistence and recovery contract',
    state,
    evidence: state.evidence,
    audit: {
      schemaVersion: state.schemaVersion,
      restartSafe: state.restartSafe,
      status: state.status,
      tenantId: state.tenant.tenantId,
      workspaceId: state.tenant.workspaceId,
      isolationKey: state.tenant.isolationKey,
      lifecycleEnabled: state.settings.enabled,
      reviewCadenceMinutes: state.settings.reviewCadenceMinutes,
      nextAction: state.nextAction,
      requiredChecks: DEFAULT_CHECKS,
      missingProofs: state.recoveryPlan.map((item) => item.check),
      commandCount: Object.keys(state.commandLedger).length,
      workspaceBoundary: state.auditHandoff.workspaceBoundary,
      handoff: state.auditHandoff,
      persistence: {
        persistenceKey: state.persistence.persistenceKey,
        revision: state.persistence.revision,
        status: state.persistence.status,
        digestStatus: state.persistence.digestStatus,
        restartSafe: state.persistence.restartSafe,
        restartStatus: state.restartStatus,
        replayCursor: state.persistence.replayCursor,
        restoreCommandCount: state.recoveryPlan.length,
        replaySafe: state.replaySafe
      }
    },
    preview: state.preview,
    acceptance: state.acceptance,
    reviewDecision: state.reviewDecision,
    validation: state.validationSummary,
    nextSteps: state.nextSteps
  };
}

export default describeReviewReadySurface;
