import { createHash } from 'node:crypto';

export const surfaceId = "aios_syscall-layer_audit-write_030";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "audit-write";

const LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'pause', 'resume', 'rotate', 'flush', 'status']);
const AUDIT_LEVELS = new Set(['minimal', 'standard', 'verbose']);
const SCHEDULE_MODES = new Set(['immediate', 'interval', 'manual']);
const REQUEST_SOURCES = new Set(['kernel', 'client', 'agent', 'scheduler', 'operator']);
const WORKFLOW_HANDOFF_TARGETS = new Set(['none', 'client-runtime', 'audit-console', 'operator-queue']);
const CLIENT_REQUEST_PHASES = new Set(['new', 'queued', 'awaiting-receipt', 'retrying', 'blocked', 'completed']);
const CLIENT_VISIBLE_SURFACES = new Set(['background', 'inline', 'modal', 'notification']);
const CLIENT_ACK_PREFERENCES = new Set(['none', 'optimistic', 'cursor', 'proof', 'provider-receipt']);
const PROVIDER_CAPABILITIES = new Set([
  'append',
  'flush',
  'rotate',
  'proof-chain',
  'external-handoff',
  'cursor-sync',
  'idempotent-append',
  'receipt-query'
]);
const HANDOFF_MODES = new Set(['none', 'mirror', 'escrow']);
const PROVIDER_SERVICE_TIERS = new Set(['hosted-kernel', 'tenant-dedicated', 'external-managed']);
const PROVIDER_AUTH_SCHEMES = new Set(['kernel-signed', 'mtls', 'bearer-token', 'none']);
const PROVIDER_DELIVERY_ACK_MODES = new Set(['append-ack', 'cursor-ack', 'proof-ack', 'external-receipt']);
const PROVIDER_DELIVERY_PRIORITIES = new Set(['bulk', 'standard', 'urgent']);
const PROVIDER_DELIVERY_CHECKPOINTS = new Set(['none', 'before-handoff', 'after-handoff']);
const PROVIDER_DELIVERY_CONSISTENCY_MODES = new Set(['at-least-once', 'exactly-once', 'proof-bound']);
const PROVIDER_COMMIT_STRATEGIES = new Set(['buffer-first', 'provider-first', 'two-phase']);
const PROVIDER_RECEIPT_STATES = new Set(['none', 'pending', 'acked', 'rejected', 'expired']);
const PROVIDER_RECEIPT_SIGNATURE_SCHEMES = new Set(['kernel-signed', 'provider-signed', 'mtls-bound', 'unsigned']);
const PROVIDER_RECEIPT_RESULT_CODES = new Set([
  'none',
  'accepted',
  'duplicate',
  'cursor-advanced',
  'proof-anchored',
  'rejected',
  'expired',
  'retry-after'
]);
const ANALYTICS_EXPORT_FORMATS = new Set(['json', 'csv', 'ndjson']);
const ANALYTICS_TIMELINE_EVENT_TYPES = new Set([
  'write-accepted',
  'write-blocked',
  'proof-deferred',
  'handoff-ready',
  'retry-scheduled',
  'validation-observed'
]);
const PERSISTED_STATUSES = new Set(['cold', 'ready', 'disabled', 'recovering', 'degraded', 'blocked']);
const RECOVERY_MODES = new Set(['clean', 'resume-buffer', 'reconcile-cursor', 'manual-review']);
const OPERATIONAL_FAILURE_TYPES = new Set([
  'none',
  'provider-timeout',
  'provider-5xx',
  'proof-chain-lag',
  'cursor-conflict',
  'storage-pressure',
  'network-partition',
  'unknown'
]);
const OPERATIONAL_HEALTH_STATES = new Set(['healthy', 'degraded', 'retrying', 'blocked', 'disabled']);
const OPERATIONAL_FAILURE_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const OPERATIONAL_FAILURE_PHASES = new Set(['admission', 'append', 'proof', 'cursor-sync', 'handoff', 'receipt', 'storage']);
const ACCESS_SCOPE_MODES = new Set(['exact', 'workspace-prefix', 'tenant-prefix', 'kernel-stream']);
const ACCESS_ROLES = new Set(['audit-writer', 'audit-reader', 'workspace-admin', 'tenant-admin', 'kernel-operator']);
const ACCESS_PERMISSIONS = new Set([
  'audit:read',
  'audit:write',
  'audit:flush',
  'audit:rotate',
  'audit:handoff',
  'audit:admin'
]);
const ROLE_PERMISSIONS = Object.freeze({
  'audit-writer': ['audit:read', 'audit:write'],
  'audit-reader': ['audit:read'],
  'workspace-admin': ['audit:read', 'audit:write', 'audit:flush', 'audit:rotate', 'audit:handoff'],
  'tenant-admin': ['audit:read', 'audit:write', 'audit:flush', 'audit:rotate', 'audit:handoff', 'audit:admin'],
  'kernel-operator': ['audit:read', 'audit:write', 'audit:flush', 'audit:rotate', 'audit:handoff', 'audit:admin']
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  auditLevel: 'standard',
  proofRequired: true,
  retentionDays: 30,
  maxBufferedWrites: 250,
  scheduleMode: 'interval',
  flushIntervalMs: 60000
});

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function coerceBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function coerceInteger(value, fallback, { min, max }) {
  if (!Number.isInteger(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

function normalizeLifecycleCommand(value) {
  const command = typeof value === 'string' ? value.trim().toLowerCase() : 'status';
  return LIFECYCLE_COMMANDS.has(command) ? command : 'status';
}

function validateLifecycleCommand(value, normalizedCommand) {
  const requested = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  if (requested === undefined || LIFECYCLE_COMMANDS.has(requested)) return [];
  return [{ field: 'command', code: 'unsupported_lifecycle_command', applied: normalizedCommand }];
}

function normalizeTimestamp(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

function normalizeOptionalTimestamp(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function normalizeIdentifier(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeBoundedString(value, fallback, { maxLength = 160 } = {}) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeNullableString(value, { maxLength = 160 } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeStringList(value, { maxItems = 25, maxLength = 180 } = {}) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => normalizeNullableString(item, { maxLength }))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, maxItems);
}

function normalizeIdentifierList(value, allowedValues, fallback, { maxItems = 25 } = {}) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => normalizeIdentifier(item, ''))
    .filter((item) => allowedValues.has(item));
  const unique = [...new Set(normalized)].slice(0, maxItems);
  return unique.length > 0 ? unique : fallback;
}

function normalizeClientRequestState(rawState = {}, { source, requestId, workflowId, traceId, route, now }) {
  const state = asPlainObject(rawState);
  const phase = CLIENT_REQUEST_PHASES.has(state.phase) ? state.phase : 'new';
  const visibleSurface = CLIENT_VISIBLE_SURFACES.has(state.visibleSurface) ? state.visibleSurface : 'inline';
  const ackPreference = CLIENT_ACK_PREFERENCES.has(state.ackPreference)
    ? state.ackPreference
    : source === 'scheduler'
      ? 'cursor'
      : 'proof';
  const resumeToken = normalizeBoundedString(
    state.resumeToken,
    `${workflowId}:${requestId}:${phase}`,
    { maxLength: 220 }
  );

  return {
    schemaVersion: 'audit.write.client-request-state.v1',
    phase,
    visibleSurface,
    ackPreference,
    resumeToken,
    previousResumeToken: normalizeNullableString(state.previousResumeToken, { maxLength: 220 }),
    clientSequence: coerceInteger(state.clientSequence, 1, { min: 1, max: 1000000000 }),
    lastVisibleAt: normalizeOptionalTimestamp(state.lastVisibleAt),
    acceptedAt: normalizeOptionalTimestamp(state.acceptedAt),
    completedAt: normalizeOptionalTimestamp(state.completedAt),
    lastKnownCursor: normalizeNullableString(state.lastKnownCursor, { maxLength: 220 }),
    lastKnownProofHead: normalizeNullableString(state.lastKnownProofHead, { maxLength: 220 }),
    expectsProviderReceipt: ackPreference === 'provider-receipt',
    optimisticAckAllowed: coerceBoolean(state.optimisticAckAllowed, ackPreference === 'optimistic'),
    handoffPreference: WORKFLOW_HANDOFF_TARGETS.has(state.handoffPreference)
      ? state.handoffPreference
      : 'client-runtime',
    continuityKey: proofDigest({
      requestId,
      traceId,
      workflowId,
      route,
      resumeToken,
      clientSequence: coerceInteger(state.clientSequence, 1, { min: 1, max: 1000000000 })
    }),
    observedAt: now
  };
}

function validateClientRequestState(rawState = {}, normalizedState) {
  const state = asPlainObject(rawState);
  const issues = [];

  if ('phase' in state && !CLIENT_REQUEST_PHASES.has(state.phase)) {
    issues.push({ field: 'client.state.phase', code: 'unsupported_client_request_phase', applied: normalizedState.phase });
  }
  if ('visibleSurface' in state && !CLIENT_VISIBLE_SURFACES.has(state.visibleSurface)) {
    issues.push({ field: 'client.state.visibleSurface', code: 'unsupported_client_visible_surface', applied: normalizedState.visibleSurface });
  }
  if ('ackPreference' in state && !CLIENT_ACK_PREFERENCES.has(state.ackPreference)) {
    issues.push({ field: 'client.state.ackPreference', code: 'unsupported_client_ack_preference', applied: normalizedState.ackPreference });
  }
  if ('clientSequence' in state && state.clientSequence !== normalizedState.clientSequence) {
    issues.push({ field: 'client.state.clientSequence', code: 'client_sequence_normalized', applied: normalizedState.clientSequence });
  }
  for (const field of ['lastVisibleAt', 'acceptedAt', 'completedAt']) {
    if (field in state && normalizeOptionalTimestamp(state[field]) !== normalizedState[field]) {
      issues.push({ field: `client.state.${field}`, code: 'client_state_timestamp_required', applied: normalizedState[field] });
    }
  }
  if ('resumeToken' in state && normalizeBoundedString(state.resumeToken, '', { maxLength: 220 }) !== normalizedState.resumeToken) {
    issues.push({ field: 'client.state.resumeToken', code: 'client_resume_token_normalized', applied: normalizedState.resumeToken });
  }
  if ('handoffPreference' in state && !WORKFLOW_HANDOFF_TARGETS.has(state.handoffPreference)) {
    issues.push({ field: 'client.state.handoffPreference', code: 'unsupported_client_handoff_preference', applied: normalizedState.handoffPreference });
  }
  if ('optimisticAckAllowed' in state && typeof state.optimisticAckAllowed !== 'boolean') {
    issues.push({ field: 'client.state.optimisticAckAllowed', code: 'boolean_required', applied: normalizedState.optimisticAckAllowed });
  }

  return issues;
}

function normalizeClientRuntime(rawClient = {}, now) {
  const client = asPlainObject(rawClient);
  const source = REQUEST_SOURCES.has(client.source) ? client.source : 'client';
  const sessionId = normalizeIdentifier(client.sessionId, 'anonymous-session');
  const principalId = normalizeIdentifier(client.principalId, 'anonymous-principal');
  const requestId = normalizeBoundedString(client.requestId, `${surfaceId}:${Date.parse(now)}`, { maxLength: 96 });
  const traceId = normalizeBoundedString(client.traceId, requestId, { maxLength: 128 });
  const workflowId = normalizeIdentifier(client.workflowId, `${source}-audit-workflow`);
  const route = normalizeBoundedString(client.route, 'syscall-layer/audit-write', { maxLength: 120 });
  const requestState = normalizeClientRequestState(client.state, {
    source,
    requestId,
    workflowId,
    traceId,
    route,
    now
  });

  return {
    source,
    requestId,
    traceId,
    sessionId,
    principalId,
    workflowId,
    route,
    state: requestState
  };
}

function validateClientRuntime(rawClient = {}, normalizedClient) {
  const client = asPlainObject(rawClient);
  const issues = [];

  if ('source' in client && !REQUEST_SOURCES.has(client.source)) {
    issues.push({ field: 'client.source', code: 'unsupported_request_source', applied: normalizedClient.source });
  }
  if ('sessionId' in client && normalizeIdentifier(client.sessionId, '') !== normalizedClient.sessionId) {
    issues.push({ field: 'client.sessionId', code: 'client_identifier_normalized', applied: normalizedClient.sessionId });
  }
  if ('principalId' in client && normalizeIdentifier(client.principalId, '') !== normalizedClient.principalId) {
    issues.push({ field: 'client.principalId', code: 'principal_identifier_normalized', applied: normalizedClient.principalId });
  }
  if ('workflowId' in client && normalizeIdentifier(client.workflowId, '') !== normalizedClient.workflowId) {
    issues.push({ field: 'client.workflowId', code: 'workflow_identifier_normalized', applied: normalizedClient.workflowId });
  }
  if ('requestId' in client && normalizeBoundedString(client.requestId, '', { maxLength: 96 }) !== normalizedClient.requestId) {
    issues.push({ field: 'client.requestId', code: 'request_id_normalized', applied: normalizedClient.requestId });
  }
  if ('traceId' in client && normalizeBoundedString(client.traceId, '', { maxLength: 128 }) !== normalizedClient.traceId) {
    issues.push({ field: 'client.traceId', code: 'trace_id_normalized', applied: normalizedClient.traceId });
  }
  if ('state' in client && Object.keys(asPlainObject(client.state)).length === 0) {
    issues.push({ field: 'client.state', code: 'client_request_state_object_required', applied: normalizedClient.state });
  }
  issues.push(...validateClientRequestState(client.state, normalizedClient.state));

  return issues;
}

function normalizeWriteEnvelope(rawWrite = {}, clientRuntime) {
  const write = asPlainObject(rawWrite);
  const targetStream = normalizeIdentifier(write.targetStream, 'kernel.audit');
  const operation = normalizeIdentifier(write.operation, 'append');
  const idempotencyKey = normalizeBoundedString(
    write.idempotencyKey,
    `${clientRuntime.requestId}:${targetStream}:${operation}`,
    { maxLength: 180 }
  );
  const payloadBytes = coerceInteger(write.payloadBytes, 0, { min: 0, max: 52428800 });
  const recordCount = coerceInteger(write.recordCount, payloadBytes > 0 ? 1 : 0, { min: 0, max: 100000 });

  return {
    targetStream,
    operation,
    idempotencyKey,
    payloadBytes,
    recordCount,
    hasPayload: payloadBytes > 0 || recordCount > 0,
    schemaVersion: normalizeBoundedString(write.schemaVersion, 'audit.write.v1', { maxLength: 48 })
  };
}

function validateWriteEnvelope(rawWrite = {}, normalizedWrite) {
  const write = asPlainObject(rawWrite);
  const issues = [];

  if ('targetStream' in write && normalizeIdentifier(write.targetStream, '') !== normalizedWrite.targetStream) {
    issues.push({ field: 'write.targetStream', code: 'target_stream_normalized', applied: normalizedWrite.targetStream });
  }
  if ('operation' in write && normalizeIdentifier(write.operation, '') !== normalizedWrite.operation) {
    issues.push({ field: 'write.operation', code: 'operation_normalized', applied: normalizedWrite.operation });
  }
  if ('payloadBytes' in write && write.payloadBytes !== normalizedWrite.payloadBytes) {
    issues.push({ field: 'write.payloadBytes', code: 'integer_range_0_52428800', applied: normalizedWrite.payloadBytes });
  }
  if ('recordCount' in write && write.recordCount !== normalizedWrite.recordCount) {
    issues.push({ field: 'write.recordCount', code: 'integer_range_0_100000', applied: normalizedWrite.recordCount });
  }
  if ('schemaVersion' in write && normalizeBoundedString(write.schemaVersion, '', { maxLength: 48 }) !== normalizedWrite.schemaVersion) {
    issues.push({ field: 'write.schemaVersion', code: 'schema_version_normalized', applied: normalizedWrite.schemaVersion });
  }

  return issues;
}

function normalizeAccessBoundary(rawAccess = {}, { clientRuntime, writeEnvelope }) {
  const access = asPlainObject(rawAccess);
  const tenantId = normalizeIdentifier(access.tenantId, 'tenant-default');
  const workspaceId = normalizeIdentifier(access.workspaceId, `${tenantId}:workspace-default`);
  const principalTenantId = normalizeIdentifier(access.principalTenantId, tenantId);
  const principalWorkspaceId = normalizeIdentifier(access.principalWorkspaceId, workspaceId);
  const roles = normalizeIdentifierList(access.roles, ACCESS_ROLES, ['kernel-operator'], { maxItems: 10 });
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] ?? []);
  const explicitPermissions = normalizeIdentifierList(access.permissions, ACCESS_PERMISSIONS, [], { maxItems: 20 });
  const permissions = [...new Set([...rolePermissions, ...explicitPermissions])];
  const allowedStreams = normalizeStringList(access.allowedStreams, { maxItems: 50, maxLength: 120 })
    .map((stream) => normalizeIdentifier(stream, ''))
    .filter(Boolean);
  const deniedStreams = normalizeStringList(access.deniedStreams, { maxItems: 50, maxLength: 120 })
    .map((stream) => normalizeIdentifier(stream, ''))
    .filter(Boolean);
  const requestedScope = normalizeIdentifier(access.requestedScope, writeEnvelope.targetStream);
  const enforceWorkspaceScope = coerceBoolean(access.enforceWorkspaceScope, true);
  const allowCrossTenantHandoff = coerceBoolean(access.allowCrossTenantHandoff, false);
  const hasAdminRole = roles.some((role) => role === 'tenant-admin' || role === 'kernel-operator');
  const scopeMode = ACCESS_SCOPE_MODES.has(access.scopeMode) ? access.scopeMode : 'exact';
  const workspaceStreamPrefix = normalizeIdentifier(
    access.workspaceStreamPrefix,
    `${tenantId}.${workspaceId}.`
  );
  const tenantStreamPrefix = normalizeIdentifier(access.tenantStreamPrefix, `${tenantId}.`);
  const requireWorkspaceTaggedStream = coerceBoolean(access.requireWorkspaceTaggedStream, false);
  const allowKernelStream = coerceBoolean(access.allowKernelStream, hasAdminRole);
  const subject = normalizeBoundedString(
    access.subject,
    `${clientRuntime.principalId}@${tenantId}/${workspaceId}`,
    { maxLength: 180 }
  );

  return {
    schemaVersion: 'audit.write.access.v1',
    tenantId,
    workspaceId,
    principalTenantId,
    principalWorkspaceId,
    subject,
    roles,
    permissions,
    allowedStreams,
    deniedStreams,
    requestedScope,
    enforceWorkspaceScope,
    allowCrossTenantHandoff,
    streamScopePolicy: {
      schemaVersion: 'audit.write.stream-scope-policy.v1',
      mode: scopeMode,
      workspaceStreamPrefix,
      tenantStreamPrefix,
      requireWorkspaceTaggedStream,
      allowKernelStream
    },
    scopeKey: `${tenantId}:${workspaceId}:${writeEnvelope.targetStream}`
  };
}

function validateAccessBoundary(rawAccess = {}, normalizedAccess) {
  const access = asPlainObject(rawAccess);
  const issues = [];

  for (const [field, value] of Object.entries({
    tenantId: access.tenantId,
    workspaceId: access.workspaceId,
    principalTenantId: access.principalTenantId,
    principalWorkspaceId: access.principalWorkspaceId,
    requestedScope: access.requestedScope
  })) {
    if (field in access && normalizeIdentifier(value, '') !== normalizedAccess[field]) {
      issues.push({ field: `access.${field}`, code: 'access_identifier_normalized', applied: normalizedAccess[field] });
    }
  }
  if ('roles' in access && !Array.isArray(access.roles)) {
    issues.push({ field: 'access.roles', code: 'role_array_required', applied: normalizedAccess.roles });
  }
  if (Array.isArray(access.roles)) {
    const unsupportedRoles = access.roles
      .map((role) => normalizeIdentifier(role, ''))
      .filter((role) => role && !ACCESS_ROLES.has(role));
    for (const role of [...new Set(unsupportedRoles)]) {
      issues.push({ field: 'access.roles', code: 'unsupported_access_role', value: role });
    }
  }
  if ('permissions' in access && !Array.isArray(access.permissions)) {
    issues.push({ field: 'access.permissions', code: 'permission_array_required', applied: normalizedAccess.permissions });
  }
  if (Array.isArray(access.permissions)) {
    const unsupportedPermissions = access.permissions
      .map((permission) => normalizeIdentifier(permission, ''))
      .filter((permission) => permission && !ACCESS_PERMISSIONS.has(permission));
    for (const permission of [...new Set(unsupportedPermissions)]) {
      issues.push({ field: 'access.permissions', code: 'unsupported_access_permission', value: permission });
    }
  }
  for (const field of ['allowedStreams', 'deniedStreams']) {
    if (field in access && !Array.isArray(access[field])) {
      issues.push({ field: `access.${field}`, code: 'stream_array_required', applied: normalizedAccess[field] });
    }
  }
  if ('enforceWorkspaceScope' in access && typeof access.enforceWorkspaceScope !== 'boolean') {
    issues.push({ field: 'access.enforceWorkspaceScope', code: 'boolean_required', applied: normalizedAccess.enforceWorkspaceScope });
  }
  if ('allowCrossTenantHandoff' in access && typeof access.allowCrossTenantHandoff !== 'boolean') {
    issues.push({ field: 'access.allowCrossTenantHandoff', code: 'boolean_required', applied: normalizedAccess.allowCrossTenantHandoff });
  }
  if ('scopeMode' in access && !ACCESS_SCOPE_MODES.has(access.scopeMode)) {
    issues.push({ field: 'access.scopeMode', code: 'unsupported_access_scope_mode', applied: normalizedAccess.streamScopePolicy.mode });
  }
  for (const field of ['workspaceStreamPrefix', 'tenantStreamPrefix']) {
    if (field in access && normalizeIdentifier(access[field], '') !== normalizedAccess.streamScopePolicy[field]) {
      issues.push({ field: `access.${field}`, code: 'stream_scope_prefix_normalized', applied: normalizedAccess.streamScopePolicy[field] });
    }
  }
  for (const field of ['requireWorkspaceTaggedStream', 'allowKernelStream']) {
    if (field in access && typeof access[field] !== 'boolean') {
      issues.push({ field: `access.${field}`, code: 'boolean_required', applied: normalizedAccess.streamScopePolicy[field] });
    }
  }

  return issues;
}

function evaluateStreamScopePolicy(accessBoundary, writeEnvelope) {
  const policy = accessBoundary.streamScopePolicy;
  const targetStream = writeEnvelope.targetStream;
  const workspaceTagged = targetStream.startsWith(policy.workspaceStreamPrefix);
  const tenantTagged = targetStream.startsWith(policy.tenantStreamPrefix);
  const kernelStream = targetStream.startsWith('kernel.');
  const exactScope = accessBoundary.requestedScope === targetStream;
  const denied = [];

  if (policy.requireWorkspaceTaggedStream && !workspaceTagged) {
    denied.push('workspace_stream_prefix_required');
  }
  if (policy.mode === 'exact' && !exactScope) {
    denied.push('requested_scope_mismatch');
  }
  if (policy.mode === 'workspace-prefix' && !workspaceTagged) {
    denied.push('workspace_stream_prefix_mismatch');
  }
  if (policy.mode === 'tenant-prefix' && !tenantTagged) {
    denied.push('tenant_stream_prefix_mismatch');
  }
  if (policy.mode === 'kernel-stream' && (!kernelStream || !policy.allowKernelStream)) {
    denied.push(kernelStream ? 'kernel_stream_not_permitted' : 'kernel_stream_required');
  }
  if (kernelStream && !policy.allowKernelStream) {
    denied.push('kernel_stream_not_permitted');
  }

  return {
    schemaVersion: 'audit.write.stream-scope-decision.v1',
    mode: policy.mode,
    targetStream,
    requestedScope: accessBoundary.requestedScope,
    workspaceStreamPrefix: policy.workspaceStreamPrefix,
    tenantStreamPrefix: policy.tenantStreamPrefix,
    workspaceTagged,
    tenantTagged,
    kernelStream,
    exactScope,
    allowed: denied.length === 0,
    denied: [...new Set(denied)]
  };
}

function buildAccessDecision({ accessBoundary, writeEnvelope, command, provider }) {
  const denied = [];
  const requiredPermission = command === 'rotate'
    ? 'audit:rotate'
    : command === 'flush'
      ? 'audit:flush'
      : 'audit:write';
  const hasAdmin = accessBoundary.permissions.includes('audit:admin');
  const hasRequiredPermission = hasAdmin || accessBoundary.permissions.includes(requiredPermission);
  const streamAllowed = accessBoundary.allowedStreams.length === 0
    || accessBoundary.allowedStreams.includes(writeEnvelope.targetStream);
  const streamDenied = accessBoundary.deniedStreams.includes(writeEnvelope.targetStream);
  const sameTenant = accessBoundary.principalTenantId === accessBoundary.tenantId;
  const sameWorkspace = accessBoundary.principalWorkspaceId === accessBoundary.workspaceId;
  const workspaceOk = !accessBoundary.enforceWorkspaceScope || sameWorkspace || hasAdmin;
  const tenantOk = sameTenant || hasAdmin;
  const handoffTenantOk = provider.handoffMode === 'none' || accessBoundary.allowCrossTenantHandoff || sameTenant || hasAdmin;
  const streamScope = evaluateStreamScopePolicy(accessBoundary, writeEnvelope);

  if (!hasRequiredPermission) denied.push(`missing_${requiredPermission.replace(':', '_')}`);
  if (!streamAllowed) denied.push('target_stream_not_allowed');
  if (streamDenied) denied.push('target_stream_denied');
  if (!tenantOk) denied.push('tenant_boundary_mismatch');
  if (!workspaceOk) denied.push('workspace_boundary_mismatch');
  if (!handoffTenantOk) denied.push('cross_tenant_handoff_blocked');
  for (const scopeDenial of streamScope.denied) {
    denied.push(scopeDenial);
  }

  return {
    allowed: denied.length === 0,
    requiredPermission,
    denied: [...new Set(denied)],
    tenantScoped: tenantOk,
    workspaceScoped: workspaceOk,
    streamScoped: streamAllowed && !streamDenied && streamScope.allowed,
    streamScope,
    handoffAllowed: handoffTenantOk,
    scopeKey: accessBoundary.scopeKey,
    subject: accessBoundary.subject
  };
}

function normalizeProvider(rawProvider = {}) {
  const provider = asPlainObject(rawProvider);
  const capabilities = Array.isArray(provider.capabilities)
    ? provider.capabilities
        .map((capability) => normalizeIdentifier(capability, ''))
        .filter((capability) => PROVIDER_CAPABILITIES.has(capability))
    : [];
  const handoffMode = HANDOFF_MODES.has(provider.handoffMode) ? provider.handoffMode : 'none';

  return {
    providerId: normalizeIdentifier(provider.providerId, 'hosted-kernel-audit-log'),
    service: normalizeIdentifier(provider.service, 'audit-write-service'),
    serviceTier: PROVIDER_SERVICE_TIERS.has(provider.serviceTier) ? provider.serviceTier : 'hosted-kernel',
    contractVersion: normalizeBoundedString(provider.contractVersion, 'audit-provider-contract.v1', { maxLength: 64 }),
    authScheme: PROVIDER_AUTH_SCHEMES.has(provider.authScheme) ? provider.authScheme : 'kernel-signed',
    endpoint: typeof provider.endpoint === 'string' && provider.endpoint.trim() ? provider.endpoint.trim() : null,
    capabilities: [...new Set(capabilities)],
    handoffMode,
    syncCursor: typeof provider.syncCursor === 'string' && provider.syncCursor.trim() ? provider.syncCursor.trim() : null,
    cursorLagMs: coerceInteger(provider.cursorLagMs, 0, { min: 0, max: 86400000 }),
    maxBatchRecords: coerceInteger(provider.maxBatchRecords, 1000, { min: 1, max: 100000 }),
    maxBatchBytes: coerceInteger(provider.maxBatchBytes, 1048576, { min: 1024, max: 52428800 }),
    ackTimeoutMs: coerceInteger(provider.ackTimeoutMs, 5000, { min: 100, max: 300000 }),
    externalReference: typeof provider.externalReference === 'string' && provider.externalReference.trim()
      ? provider.externalReference.trim()
      : null
  };
}

function validateProvider(rawProvider = {}, normalizedProvider) {
  const provider = asPlainObject(rawProvider);
  const issues = [];

  if ('providerId' in provider && normalizeIdentifier(provider.providerId, '') !== normalizedProvider.providerId) {
    issues.push({ field: 'provider.providerId', code: 'provider_identifier_normalized', applied: normalizedProvider.providerId });
  }
  if ('service' in provider && normalizeIdentifier(provider.service, '') !== normalizedProvider.service) {
    issues.push({ field: 'provider.service', code: 'service_identifier_normalized', applied: normalizedProvider.service });
  }
  if ('serviceTier' in provider && !PROVIDER_SERVICE_TIERS.has(provider.serviceTier)) {
    issues.push({ field: 'provider.serviceTier', code: 'unsupported_provider_service_tier', applied: normalizedProvider.serviceTier });
  }
  if ('authScheme' in provider && !PROVIDER_AUTH_SCHEMES.has(provider.authScheme)) {
    issues.push({ field: 'provider.authScheme', code: 'unsupported_provider_auth_scheme', applied: normalizedProvider.authScheme });
  }
  for (const field of ['cursorLagMs', 'maxBatchRecords', 'maxBatchBytes', 'ackTimeoutMs']) {
    if (field in provider && provider[field] !== normalizedProvider[field]) {
      issues.push({ field: `provider.${field}`, code: 'provider_contract_integer_normalized', applied: normalizedProvider[field] });
    }
  }
  if ('capabilities' in provider && !Array.isArray(provider.capabilities)) {
    issues.push({ field: 'provider.capabilities', code: 'capability_array_required', applied: normalizedProvider.capabilities });
  }
  if (Array.isArray(provider.capabilities)) {
    const unsupported = provider.capabilities
      .map((capability) => normalizeIdentifier(capability, ''))
      .filter((capability) => capability && !PROVIDER_CAPABILITIES.has(capability));
    for (const capability of [...new Set(unsupported)]) {
      issues.push({ field: 'provider.capabilities', code: 'unsupported_provider_capability', value: capability });
    }
  }
  if ('handoffMode' in provider && !HANDOFF_MODES.has(provider.handoffMode)) {
    issues.push({ field: 'provider.handoffMode', code: 'unsupported_handoff_mode', applied: normalizedProvider.handoffMode });
  }

  return issues;
}

function normalizeProviderDelivery(rawProvider = {}, { provider, writeEnvelope, accessBoundary, settings, now }) {
  const delivery = asPlainObject(asPlainObject(rawProvider).delivery);
  const proofAckDefault = settings.proofRequired ? 'proof-ack' : 'cursor-ack';
  const ackMode = PROVIDER_DELIVERY_ACK_MODES.has(delivery.ackMode) ? delivery.ackMode : proofAckDefault;
  const priority = PROVIDER_DELIVERY_PRIORITIES.has(delivery.priority) ? delivery.priority : 'standard';
  const syncCheckpoint = PROVIDER_DELIVERY_CHECKPOINTS.has(delivery.syncCheckpoint)
    ? delivery.syncCheckpoint
    : provider.handoffMode === 'none'
      ? 'none'
      : 'before-handoff';
  const handoffRequired = coerceBoolean(
    delivery.handoffRequired,
    provider.serviceTier === 'external-managed' || ackMode === 'external-receipt'
  );
  const leaseTtlMs = coerceInteger(delivery.leaseTtlMs, provider.ackTimeoutMs * 2, { min: 1000, max: 3600000 });
  const receiptTtlMs = coerceInteger(delivery.receiptTtlMs, Math.max(provider.ackTimeoutMs, leaseTtlMs), { min: 1000, max: 86400000 });
  const consistencyMode = PROVIDER_DELIVERY_CONSISTENCY_MODES.has(delivery.consistencyMode)
    ? delivery.consistencyMode
    : ackMode === 'proof-ack'
      ? 'proof-bound'
      : 'at-least-once';
  const commitStrategy = PROVIDER_COMMIT_STRATEGIES.has(delivery.commitStrategy)
    ? delivery.commitStrategy
    : handoffRequired && syncCheckpoint === 'before-handoff'
      ? 'two-phase'
      : 'buffer-first';
  const receiptState = PROVIDER_RECEIPT_STATES.has(delivery.receiptState) ? delivery.receiptState : 'none';
  const route = provider.handoffMode === 'none'
    ? 'hosted-kernel-buffer'
    : provider.serviceTier === 'external-managed'
      ? 'external-managed-provider'
      : `hosted-kernel-${provider.handoffMode}`;

  return {
    schemaVersion: 'audit.write.provider-delivery.v1',
    deliveryId: normalizeBoundedString(
      delivery.deliveryId,
      `${provider.providerId}:${writeEnvelope.idempotencyKey}`,
      { maxLength: 220 }
    ),
    route,
    ackMode,
    priority,
    partitionKey: normalizeIdentifier(
      delivery.partitionKey,
      `${accessBoundary.tenantId}:${accessBoundary.workspaceId}:${writeEnvelope.targetStream}`
    ),
    handoffId: normalizeBoundedString(
      delivery.handoffId,
      `${provider.providerId}:${accessBoundary.tenantId}:${writeEnvelope.idempotencyKey}`,
      { maxLength: 220 }
    ),
    leaseExpiresAt: new Date(Date.parse(now) + leaseTtlMs).toISOString(),
    leaseTtlMs,
    receiptDeadlineAt: new Date(Date.parse(now) + receiptTtlMs).toISOString(),
    receiptTtlMs,
    syncCheckpoint,
    handoffRequired,
    consistencyMode,
    commitStrategy,
    receiptTopic: normalizeNullableString(delivery.receiptTopic, { maxLength: 180 }),
    receiptState,
    externalReceiptRequired: ackMode === 'external-receipt',
    cursorAckRequired: ackMode === 'cursor-ack' || ackMode === 'proof-ack' || syncCheckpoint !== 'none',
    proofAckRequired: ackMode === 'proof-ack',
    exactlyOnceRequired: consistencyMode === 'exactly-once',
    durableSyncRequired: consistencyMode !== 'at-least-once' || commitStrategy === 'two-phase',
    batchOrdinal: coerceInteger(delivery.batchOrdinal, 1, { min: 1, max: 1000000 })
  };
}

function validateProviderDelivery(rawProvider = {}, normalizedDelivery) {
  const delivery = asPlainObject(asPlainObject(rawProvider).delivery);
  const issues = [];

  if ('delivery' in asPlainObject(rawProvider) && Object.keys(delivery).length === 0) {
    issues.push({ field: 'provider.delivery', code: 'provider_delivery_object_required', applied: normalizedDelivery });
  }
  if ('ackMode' in delivery && !PROVIDER_DELIVERY_ACK_MODES.has(delivery.ackMode)) {
    issues.push({ field: 'provider.delivery.ackMode', code: 'unsupported_provider_delivery_ack_mode', applied: normalizedDelivery.ackMode });
  }
  if ('priority' in delivery && !PROVIDER_DELIVERY_PRIORITIES.has(delivery.priority)) {
    issues.push({ field: 'provider.delivery.priority', code: 'unsupported_provider_delivery_priority', applied: normalizedDelivery.priority });
  }
  if ('syncCheckpoint' in delivery && !PROVIDER_DELIVERY_CHECKPOINTS.has(delivery.syncCheckpoint)) {
    issues.push({ field: 'provider.delivery.syncCheckpoint', code: 'unsupported_provider_delivery_checkpoint', applied: normalizedDelivery.syncCheckpoint });
  }
  if ('consistencyMode' in delivery && !PROVIDER_DELIVERY_CONSISTENCY_MODES.has(delivery.consistencyMode)) {
    issues.push({ field: 'provider.delivery.consistencyMode', code: 'unsupported_provider_delivery_consistency', applied: normalizedDelivery.consistencyMode });
  }
  if ('commitStrategy' in delivery && !PROVIDER_COMMIT_STRATEGIES.has(delivery.commitStrategy)) {
    issues.push({ field: 'provider.delivery.commitStrategy', code: 'unsupported_provider_commit_strategy', applied: normalizedDelivery.commitStrategy });
  }
  if ('receiptState' in delivery && !PROVIDER_RECEIPT_STATES.has(delivery.receiptState)) {
    issues.push({ field: 'provider.delivery.receiptState', code: 'unsupported_provider_receipt_state', applied: normalizedDelivery.receiptState });
  }
  if ('handoffRequired' in delivery && typeof delivery.handoffRequired !== 'boolean') {
    issues.push({ field: 'provider.delivery.handoffRequired', code: 'boolean_required', applied: normalizedDelivery.handoffRequired });
  }
  for (const field of ['leaseTtlMs', 'receiptTtlMs', 'batchOrdinal']) {
    if (field in delivery && delivery[field] !== normalizedDelivery[field]) {
      issues.push({ field: `provider.delivery.${field}`, code: 'provider_delivery_integer_normalized', applied: normalizedDelivery[field] });
    }
  }
  if ('partitionKey' in delivery && normalizeIdentifier(delivery.partitionKey, '') !== normalizedDelivery.partitionKey) {
    issues.push({ field: 'provider.delivery.partitionKey', code: 'provider_delivery_partition_normalized', applied: normalizedDelivery.partitionKey });
  }
  if ('deliveryId' in delivery && normalizeBoundedString(delivery.deliveryId, '', { maxLength: 220 }) !== normalizedDelivery.deliveryId) {
    issues.push({ field: 'provider.delivery.deliveryId', code: 'provider_delivery_id_normalized', applied: normalizedDelivery.deliveryId });
  }
  if ('handoffId' in delivery && normalizeBoundedString(delivery.handoffId, '', { maxLength: 220 }) !== normalizedDelivery.handoffId) {
    issues.push({ field: 'provider.delivery.handoffId', code: 'provider_handoff_id_normalized', applied: normalizedDelivery.handoffId });
  }

  return issues;
}

function normalizeProviderReceiptCallback(rawProvider = {}, { provider, providerDelivery, syncMetadata, now }) {
  const callback = asPlainObject(asPlainObject(rawProvider).receiptCallback);
  const state = PROVIDER_RECEIPT_STATES.has(callback.state)
    ? callback.state
    : providerDelivery.receiptState;
  const resultCode = PROVIDER_RECEIPT_RESULT_CODES.has(callback.resultCode)
    ? callback.resultCode
    : state === 'acked'
      ? 'accepted'
      : state === 'rejected'
        ? 'rejected'
        : state === 'expired'
          ? 'expired'
          : 'none';
  const signatureScheme = PROVIDER_RECEIPT_SIGNATURE_SCHEMES.has(callback.signatureScheme)
    ? callback.signatureScheme
    : provider.authScheme === 'none'
      ? 'unsigned'
      : provider.authScheme === 'mtls'
        ? 'mtls-bound'
        : 'provider-signed';
  const observedAt = normalizeOptionalTimestamp(callback.observedAt) ?? now;
  const signedAt = normalizeOptionalTimestamp(callback.signedAt);
  const retryAfter = normalizeOptionalTimestamp(callback.retryAfter);
  const ackedCursor = normalizeNullableString(callback.ackedCursor, { maxLength: 220 });
  const proofHead = normalizeNullableString(callback.proofHead, { maxLength: 220 });
  const receiptId = normalizeBoundedString(
    callback.receiptId,
    `${providerDelivery.deliveryId}:${state}`,
    { maxLength: 240 }
  );
  const deliveryId = normalizeBoundedString(callback.deliveryId, providerDelivery.deliveryId, { maxLength: 220 });
  const handoffId = normalizeBoundedString(callback.handoffId, providerDelivery.handoffId, { maxLength: 220 });
  const deliveryMatches = deliveryId === providerDelivery.deliveryId;
  const handoffMatches = handoffId === providerDelivery.handoffId;
  const cursorMatches = !ackedCursor || !syncMetadata.nextCursor || ackedCursor === syncMetadata.nextCursor;
  const signed = signatureScheme === 'unsigned' ? provider.authScheme === 'none' : Boolean(signedAt);
  const terminal = state === 'acked' || state === 'rejected' || state === 'expired';

  return {
    schemaVersion: 'audit.write.provider-receipt-callback.v1',
    callbackId: normalizeBoundedString(
      callback.callbackId,
      `${provider.providerId}:${receiptId}`,
      { maxLength: 240 }
    ),
    providerId: provider.providerId,
    deliveryId,
    handoffId,
    receiptId,
    state,
    resultCode,
    observedAt,
    signedAt,
    retryAfter,
    signatureScheme,
    signed,
    ackedCursor,
    proofHead,
    externalReference: normalizeNullableString(callback.externalReference, { maxLength: 240 }) ?? provider.externalReference,
    message: normalizeNullableString(callback.message, { maxLength: 240 }),
    terminal,
    verified: deliveryMatches && handoffMatches && cursorMatches && signed,
    matches: {
      delivery: deliveryMatches,
      handoff: handoffMatches,
      cursor: cursorMatches
    }
  };
}

function validateProviderReceiptCallback(rawProvider = {}, normalizedCallback) {
  const provider = asPlainObject(rawProvider);
  const callback = asPlainObject(provider.receiptCallback);
  const issues = [];

  if ('receiptCallback' in provider && Object.keys(callback).length === 0) {
    issues.push({ field: 'provider.receiptCallback', code: 'provider_receipt_callback_object_required', applied: normalizedCallback });
  }
  if ('state' in callback && !PROVIDER_RECEIPT_STATES.has(callback.state)) {
    issues.push({ field: 'provider.receiptCallback.state', code: 'unsupported_provider_receipt_state', applied: normalizedCallback.state });
  }
  if ('resultCode' in callback && !PROVIDER_RECEIPT_RESULT_CODES.has(callback.resultCode)) {
    issues.push({ field: 'provider.receiptCallback.resultCode', code: 'unsupported_provider_receipt_result', applied: normalizedCallback.resultCode });
  }
  if ('signatureScheme' in callback && !PROVIDER_RECEIPT_SIGNATURE_SCHEMES.has(callback.signatureScheme)) {
    issues.push({ field: 'provider.receiptCallback.signatureScheme', code: 'unsupported_provider_receipt_signature', applied: normalizedCallback.signatureScheme });
  }
  for (const field of ['observedAt', 'signedAt', 'retryAfter']) {
    if (field in callback && normalizeOptionalTimestamp(callback[field]) !== normalizedCallback[field]) {
      issues.push({ field: `provider.receiptCallback.${field}`, code: 'provider_receipt_timestamp_required', applied: normalizedCallback[field] });
    }
  }
  if ('deliveryId' in callback && normalizeBoundedString(callback.deliveryId, '', { maxLength: 220 }) !== normalizedCallback.deliveryId) {
    issues.push({ field: 'provider.receiptCallback.deliveryId', code: 'provider_receipt_delivery_id_normalized', applied: normalizedCallback.deliveryId });
  }
  if ('handoffId' in callback && normalizeBoundedString(callback.handoffId, '', { maxLength: 220 }) !== normalizedCallback.handoffId) {
    issues.push({ field: 'provider.receiptCallback.handoffId', code: 'provider_receipt_handoff_id_normalized', applied: normalizedCallback.handoffId });
  }
  if (normalizedCallback.state === 'acked' && !normalizedCallback.verified) {
    issues.push({ field: 'provider.receiptCallback', code: 'provider_receipt_ack_not_verifiable', applied: normalizedCallback.matches });
  }

  return issues;
}

function evaluateProviderDeliveryReadiness({ providerDelivery, capabilityNegotiation, syncMetadata, externalHandoff, operationalPolicy, settings }) {
  const blockers = [];
  const deliveryActive = settings.enabled;

  if (deliveryActive && providerDelivery.cursorAckRequired && !syncMetadata.enabled) blockers.push('delivery_cursor_ack_unavailable');
  if (deliveryActive && providerDelivery.durableSyncRequired && !syncMetadata.enabled) blockers.push('delivery_durable_sync_unavailable');
  if (deliveryActive && providerDelivery.proofAckRequired && !capabilityNegotiation.granted.includes('proof-chain') && !operationalPolicy.proofDeferred) {
    blockers.push('delivery_proof_ack_unavailable');
  }
  if (deliveryActive && providerDelivery.exactlyOnceRequired && !capabilityNegotiation.granted.includes('idempotent-append')) {
    blockers.push('delivery_exactly_once_unavailable');
  }
  if (deliveryActive && providerDelivery.externalReceiptRequired && !externalHandoff.enabled) blockers.push('delivery_external_receipt_unavailable');
  if (deliveryActive && providerDelivery.externalReceiptRequired && !capabilityNegotiation.granted.includes('receipt-query')) {
    blockers.push('delivery_receipt_query_unavailable');
  }
  if (deliveryActive && providerDelivery.handoffRequired && externalHandoff.mode === 'none') blockers.push('delivery_handoff_mode_required');
  if (deliveryActive && providerDelivery.handoffRequired && externalHandoff.blockedBy.length > 0) blockers.push('delivery_handoff_blocked');

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    requiresProviderReceipt: providerDelivery.externalReceiptRequired,
    requiresCursorCheckpoint: providerDelivery.cursorAckRequired,
    requiresProofHead: providerDelivery.proofAckRequired,
    requiresExactlyOnce: providerDelivery.exactlyOnceRequired,
    requiresDurableSync: providerDelivery.durableSyncRequired,
    deliveryState: !deliveryActive
      ? 'delivery_idle'
      : blockers.length === 0
      ? providerDelivery.handoffRequired
        ? 'handoff_lease_ready'
        : 'local_lease_ready'
      : 'delivery_blocked'
  };
}

function buildProviderServiceContract({
  provider,
  providerDelivery,
  capabilityNegotiation,
  settings,
  accessBoundary,
  accessDecision,
  writeEnvelope,
  syncMetadata,
  externalHandoff,
  receiptCallback,
  operationalPolicy,
  now
}) {
  const mandatoryCapabilities = settings.proofRequired ? ['append', 'proof-chain'] : ['append'];
  const providerHosted = provider.serviceTier === 'hosted-kernel';
  const endpointRequired = provider.handoffMode !== 'none' || provider.serviceTier === 'external-managed';
  const endpointReady = !endpointRequired || Boolean(provider.endpoint);
  const cursorReady = !settings.enabled
    || !capabilityNegotiation.granted.includes('cursor-sync')
    || Boolean(syncMetadata.nextCursor || provider.syncCursor);
  const handoffReady = provider.handoffMode === 'none'
    || (externalHandoff.enabled && endpointReady && accessDecision.allowed);
  const batchFitsProvider = writeEnvelope.recordCount <= provider.maxBatchRecords
    && writeEnvelope.payloadBytes <= provider.maxBatchBytes;
  const requiredMissing = mandatoryCapabilities
    .filter((capability) => !capabilityNegotiation.granted.includes(capability))
    .filter((capability) => !(capability === 'proof-chain' && operationalPolicy.proofDeferred));
  const consistencyMissing = [
    ...(providerDelivery.exactlyOnceRequired && !capabilityNegotiation.granted.includes('idempotent-append') ? ['idempotent-append'] : []),
    ...(providerDelivery.externalReceiptRequired && !capabilityNegotiation.granted.includes('receipt-query') ? ['receipt-query'] : []),
    ...(providerDelivery.durableSyncRequired && !capabilityNegotiation.granted.includes('cursor-sync') ? ['cursor-sync'] : [])
  ];
  const deliveryReadiness = evaluateProviderDeliveryReadiness({
    providerDelivery,
    capabilityNegotiation,
    syncMetadata,
    externalHandoff,
    operationalPolicy,
    settings
  });
  const obligations = [];

  if (settings.enabled) obligations.push('accept_append_writes');
  if (settings.proofRequired) obligations.push('publish_proof_chain_head');
  if (syncMetadata.enabled) obligations.push('advance_durable_cursor');
  if (externalHandoff.mode !== 'none') obligations.push(`handoff_${externalHandoff.mode}`);
  if (providerDelivery.cursorAckRequired) obligations.push('return_cursor_ack');
  if (providerDelivery.proofAckRequired) obligations.push('return_proof_ack');
  if (providerDelivery.externalReceiptRequired) obligations.push('return_external_receipt');
  if (providerDelivery.exactlyOnceRequired) obligations.push('deduplicate_by_idempotency_key');
  if (providerDelivery.commitStrategy === 'two-phase') obligations.push('hold_handoff_until_checkpoint');

  const blockers = [
    ...requiredMissing.map((capability) => `missing_${capability}`),
    ...consistencyMissing.map((capability) => `missing_${capability}`),
    ...deliveryReadiness.blockers,
    ...(!endpointReady ? ['provider_endpoint_required'] : []),
    ...(!cursorReady ? ['cursor_checkpoint_unavailable'] : []),
    ...(!handoffReady ? ['handoff_not_ready'] : []),
    ...(!batchFitsProvider ? ['write_batch_exceeds_provider_contract'] : []),
    ...(providerDelivery.externalReceiptRequired && receiptCallback.state === 'acked' && !receiptCallback.verified
      ? ['provider_receipt_ack_unverifiable']
      : []),
    ...(receiptCallback.state === 'rejected' ? ['provider_receipt_callback_rejected'] : []),
    ...(receiptCallback.state === 'expired' ? ['provider_receipt_callback_expired'] : []),
    ...(providerDelivery.receiptState === 'rejected' ? ['provider_receipt_rejected'] : []),
    ...(providerDelivery.receiptState === 'expired' ? ['provider_receipt_expired'] : []),
    ...(operationalPolicy.hardFailure ? [`provider_${operationalPolicy.failureType}`] : [])
  ];

  return {
    schemaVersion: 'audit.write.provider-service-contract.v1',
    contractVersion: provider.contractVersion,
    provider: {
      providerId: provider.providerId,
      service: provider.service,
      serviceTier: provider.serviceTier,
      hostedKernelManaged: providerHosted,
      endpoint: provider.endpoint,
      authScheme: provider.authScheme,
      externalReference: provider.externalReference
    },
    scope: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      scopeKey: accessDecision.scopeKey,
      stream: writeEnvelope.targetStream
    },
    negotiation: {
      requested: capabilityNegotiation.requested,
      offered: capabilityNegotiation.offered,
      granted: capabilityNegotiation.granted,
      mandatory: mandatoryCapabilities,
      missing: capabilityNegotiation.missing,
      blockingMissing: requiredMissing
    },
    batchContract: {
      maxRecords: provider.maxBatchRecords,
      maxBytes: provider.maxBatchBytes,
      ackTimeoutMs: provider.ackTimeoutMs,
      requestedRecords: writeEnvelope.recordCount,
      requestedBytes: writeEnvelope.payloadBytes,
      acceptedByContract: batchFitsProvider
    },
    syncContract: {
      enabled: syncMetadata.enabled,
      cursorScope: syncMetadata.cursorScope,
      cursorLagMs: provider.cursorLagMs,
      previousCursor: syncMetadata.previousCursor,
      nextCursor: syncMetadata.nextCursor,
      checkpointReason: syncMetadata.checkpointReason
    },
    deliveryContract: {
      deliveryId: providerDelivery.deliveryId,
      route: providerDelivery.route,
      partitionKey: providerDelivery.partitionKey,
      batchOrdinal: providerDelivery.batchOrdinal,
      priority: providerDelivery.priority,
      ackMode: providerDelivery.ackMode,
      consistencyMode: providerDelivery.consistencyMode,
      commitStrategy: providerDelivery.commitStrategy,
      handoffId: providerDelivery.handoffId,
      leaseExpiresAt: providerDelivery.leaseExpiresAt,
      receiptDeadlineAt: providerDelivery.receiptDeadlineAt,
      syncCheckpoint: providerDelivery.syncCheckpoint,
      handoffRequired: providerDelivery.handoffRequired,
      receiptTopic: providerDelivery.receiptTopic,
      receiptState: providerDelivery.receiptState,
      callbackState: receiptCallback.state,
      callbackVerified: receiptCallback.verified,
      callbackResultCode: receiptCallback.resultCode,
      state: deliveryReadiness.deliveryState,
      ready: deliveryReadiness.ready,
      blockedBy: deliveryReadiness.blockers
    },
    handoffContract: {
      mode: externalHandoff.mode,
      enabled: externalHandoff.enabled,
      state: externalHandoff.state,
      targetEndpoint: externalHandoff.endpoint,
      blockedBy: externalHandoff.blockedBy
    },
    obligations,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    evaluatedAt: now
  };
}

function validateProviderServiceContract(serviceContract) {
  return serviceContract.blockers.map((blocker) => ({
    field: 'provider.contract',
    code: blocker === 'write_batch_exceeds_provider_contract'
      ? 'provider_contract_batch_limit_exceeded'
      : 'provider_service_contract_unready',
    value: blocker
  }));
}

function normalizeRequestedCapabilities(value) {
  const defaultCapabilities = ['append', 'proof-chain', 'cursor-sync', 'idempotent-append', 'receipt-query'];
  if (!Array.isArray(value)) return defaultCapabilities;
  const requested = value
    .map((capability) => normalizeIdentifier(capability, ''))
    .filter((capability) => PROVIDER_CAPABILITIES.has(capability));
  return [...new Set(requested.length > 0 ? requested : defaultCapabilities)];
}

function expandCapabilitiesForDelivery(requestedCapabilities, providerDelivery) {
  return [...new Set([
    ...requestedCapabilities,
    ...(providerDelivery.cursorAckRequired || providerDelivery.durableSyncRequired ? ['cursor-sync'] : []),
    ...(providerDelivery.proofAckRequired ? ['proof-chain'] : []),
    ...(providerDelivery.exactlyOnceRequired ? ['idempotent-append'] : []),
    ...(providerDelivery.externalReceiptRequired ? ['external-handoff', 'receipt-query'] : [])
  ])];
}

function negotiateCapabilities(provider, requestedCapabilities, settings) {
  const providerCapabilities = provider.capabilities.length > 0
    ? provider.capabilities
    : ['append', 'flush', 'proof-chain', 'cursor-sync', 'idempotent-append', 'receipt-query'];
  const granted = requestedCapabilities.filter((capability) => providerCapabilities.includes(capability));
  const missing = requestedCapabilities.filter((capability) => !providerCapabilities.includes(capability));
  const required = settings.proofRequired ? ['append', 'proof-chain'] : ['append'];
  const blockingMissing = required.filter((capability) => !granted.includes(capability));

  return {
    requested: requestedCapabilities,
    offered: providerCapabilities,
    granted,
    missing,
    ok: blockingMissing.length === 0,
    blockingMissing
  };
}

function normalizeSettings(rawSettings = {}) {
  const settings = asPlainObject(rawSettings);
  const auditLevel = AUDIT_LEVELS.has(settings.auditLevel) ? settings.auditLevel : DEFAULT_SETTINGS.auditLevel;
  const scheduleMode = SCHEDULE_MODES.has(settings.scheduleMode) ? settings.scheduleMode : DEFAULT_SETTINGS.scheduleMode;

  return {
    enabled: coerceBoolean(settings.enabled, DEFAULT_SETTINGS.enabled),
    auditLevel,
    proofRequired: coerceBoolean(settings.proofRequired, DEFAULT_SETTINGS.proofRequired),
    retentionDays: coerceInteger(settings.retentionDays, DEFAULT_SETTINGS.retentionDays, { min: 1, max: 3650 }),
    maxBufferedWrites: coerceInteger(settings.maxBufferedWrites, DEFAULT_SETTINGS.maxBufferedWrites, { min: 1, max: 10000 }),
    scheduleMode,
    flushIntervalMs: coerceInteger(settings.flushIntervalMs, DEFAULT_SETTINGS.flushIntervalMs, { min: 1000, max: 86400000 })
  };
}

function validateSettings(rawSettings = {}, normalizedSettings) {
  const settings = asPlainObject(rawSettings);
  const issues = [];

  if ('enabled' in settings && typeof settings.enabled !== 'boolean') {
    issues.push({ field: 'enabled', code: 'boolean_required', applied: normalizedSettings.enabled });
  }
  if ('auditLevel' in settings && !AUDIT_LEVELS.has(settings.auditLevel)) {
    issues.push({ field: 'auditLevel', code: 'unsupported_audit_level', applied: normalizedSettings.auditLevel });
  }
  if ('proofRequired' in settings && typeof settings.proofRequired !== 'boolean') {
    issues.push({ field: 'proofRequired', code: 'boolean_required', applied: normalizedSettings.proofRequired });
  }
  if ('retentionDays' in settings && settings.retentionDays !== normalizedSettings.retentionDays) {
    issues.push({ field: 'retentionDays', code: 'integer_range_1_3650', applied: normalizedSettings.retentionDays });
  }
  if ('maxBufferedWrites' in settings && settings.maxBufferedWrites !== normalizedSettings.maxBufferedWrites) {
    issues.push({ field: 'maxBufferedWrites', code: 'integer_range_1_10000', applied: normalizedSettings.maxBufferedWrites });
  }
  if ('scheduleMode' in settings && !SCHEDULE_MODES.has(settings.scheduleMode)) {
    issues.push({ field: 'scheduleMode', code: 'unsupported_schedule_mode', applied: normalizedSettings.scheduleMode });
  }
  if ('flushIntervalMs' in settings && settings.flushIntervalMs !== normalizedSettings.flushIntervalMs) {
    issues.push({ field: 'flushIntervalMs', code: 'integer_range_1000_86400000', applied: normalizedSettings.flushIntervalMs });
  }

  return issues;
}

function normalizeLifecycleControls(rawControls = {}, settings, now) {
  const controls = asPlainObject(rawControls);
  const minFlushIntervalMs = coerceInteger(controls.minFlushIntervalMs, 1000, { min: 1000, max: 86400000 });
  const maxFlushIntervalMs = coerceInteger(controls.maxFlushIntervalMs, 86400000, { min: minFlushIntervalMs, max: 86400000 });
  const disabledUntil = normalizeOptionalTimestamp(controls.disabledUntil);
  const pausedUntil = normalizeOptionalTimestamp(controls.pausedUntil);
  const holdUntil = [disabledUntil, pausedUntil]
    .filter((timestamp) => timestamp && Date.parse(timestamp) > Date.parse(now))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;

  return {
    schemaVersion: 'audit.write.lifecycle-controls.v1',
    allowEnable: coerceBoolean(controls.allowEnable, true),
    allowDisable: coerceBoolean(controls.allowDisable, true),
    allowPause: coerceBoolean(controls.allowPause, true),
    allowResume: coerceBoolean(controls.allowResume, true),
    allowFlush: coerceBoolean(controls.allowFlush, true),
    allowRotate: coerceBoolean(controls.allowRotate, true),
    requireReasonForDisable: coerceBoolean(controls.requireReasonForDisable, false),
    requireReasonForManualFlush: coerceBoolean(controls.requireReasonForManualFlush, false),
    operatorReason: normalizeNullableString(controls.operatorReason, { maxLength: 240 }),
    disabledUntil,
    pausedUntil,
    holdUntil,
    scheduleGuard: {
      minFlushIntervalMs,
      maxFlushIntervalMs,
      intervalAccepted: settings.flushIntervalMs >= minFlushIntervalMs && settings.flushIntervalMs <= maxFlushIntervalMs,
      manualModeAllowed: coerceBoolean(controls.manualModeAllowed, true),
      immediateModeAllowed: coerceBoolean(controls.immediateModeAllowed, true),
      intervalModeAllowed: coerceBoolean(controls.intervalModeAllowed, true)
    }
  };
}

function validateLifecycleControls(rawControls = {}, normalizedControls) {
  const controls = asPlainObject(rawControls);
  const issues = [];

  for (const field of [
    'allowEnable',
    'allowDisable',
    'allowPause',
    'allowResume',
    'allowFlush',
    'allowRotate',
    'requireReasonForDisable',
    'requireReasonForManualFlush',
    'manualModeAllowed',
    'immediateModeAllowed',
    'intervalModeAllowed'
  ]) {
    if (field in controls && typeof controls[field] !== 'boolean') {
      issues.push({ field: `lifecycleControls.${field}`, code: 'boolean_required', applied: normalizedControls[field] ?? normalizedControls.scheduleGuard[field] });
    }
  }
  for (const field of ['minFlushIntervalMs', 'maxFlushIntervalMs']) {
    if (field in controls && controls[field] !== normalizedControls.scheduleGuard[field]) {
      issues.push({ field: `lifecycleControls.${field}`, code: 'lifecycle_schedule_interval_normalized', applied: normalizedControls.scheduleGuard[field] });
    }
  }
  for (const field of ['disabledUntil', 'pausedUntil']) {
    if (field in controls && normalizeOptionalTimestamp(controls[field]) !== normalizedControls[field]) {
      issues.push({ field: `lifecycleControls.${field}`, code: 'timestamp_required', applied: normalizedControls[field] });
    }
  }
  if ('operatorReason' in controls && normalizeNullableString(controls.operatorReason, { maxLength: 240 }) !== normalizedControls.operatorReason) {
    issues.push({ field: 'lifecycleControls.operatorReason', code: 'operator_reason_normalized', applied: normalizedControls.operatorReason });
  }

  return issues;
}

function buildLifecycleControlDecision(command, settings, lifecycleControls, now) {
  const blockedBy = [];
  const commandAllowed = {
    enable: lifecycleControls.allowEnable,
    disable: lifecycleControls.allowDisable,
    pause: lifecycleControls.allowPause,
    resume: lifecycleControls.allowResume,
    flush: lifecycleControls.allowFlush,
    rotate: lifecycleControls.allowRotate,
    status: true
  };
  const manualFlushCommand = command === 'flush';
  const disableCommand = command === 'disable' || command === 'pause';
  const mutatesLifecycle = command !== 'status';

  if (mutatesLifecycle && !commandAllowed[command]) blockedBy.push(`${command}_control_disabled`);
  if (disableCommand && lifecycleControls.requireReasonForDisable && !lifecycleControls.operatorReason) {
    blockedBy.push('disable_reason_required');
  }
  if (manualFlushCommand && lifecycleControls.requireReasonForManualFlush && !lifecycleControls.operatorReason) {
    blockedBy.push('manual_flush_reason_required');
  }
  if ((command === 'enable' || command === 'resume') && lifecycleControls.holdUntil && Date.parse(lifecycleControls.holdUntil) > Date.parse(now)) {
    blockedBy.push('lifecycle_hold_active');
  }
  if (mutatesLifecycle && settings.scheduleMode === 'manual' && !lifecycleControls.scheduleGuard.manualModeAllowed) {
    blockedBy.push('manual_schedule_disabled');
  }
  if (mutatesLifecycle && settings.scheduleMode === 'immediate' && !lifecycleControls.scheduleGuard.immediateModeAllowed) {
    blockedBy.push('immediate_schedule_disabled');
  }
  if (mutatesLifecycle && settings.scheduleMode === 'interval' && !lifecycleControls.scheduleGuard.intervalModeAllowed) {
    blockedBy.push('interval_schedule_disabled');
  }
  if (mutatesLifecycle && !lifecycleControls.scheduleGuard.intervalAccepted) {
    blockedBy.push('flush_interval_outside_lifecycle_guard');
  }

  return {
    schemaVersion: 'audit.write.lifecycle-control-decision.v1',
    command,
    allowed: blockedBy.length === 0,
    blockedBy: [...new Set(blockedBy)],
    holdUntil: lifecycleControls.holdUntil,
    operatorReason: lifecycleControls.operatorReason,
    effectiveScheduleMode: blockedBy.includes('manual_schedule_disabled') ? 'interval' : settings.scheduleMode
  };
}

function normalizeOperationalHealth(rawHealth = {}, now) {
  const health = asPlainObject(rawHealth);
  const failureType = OPERATIONAL_FAILURE_TYPES.has(health.failureType)
    ? health.failureType
    : health.failureType
      ? 'unknown'
      : 'none';
  const retryAttempt = coerceInteger(health.retryAttempt, 0, { min: 0, max: 20 });
  const baseBackoffMs = coerceInteger(health.baseBackoffMs, 1000, { min: 250, max: 300000 });
  const maxBackoffMs = coerceInteger(health.maxBackoffMs, Math.max(baseBackoffMs, 60000), { min: baseBackoffMs, max: 3600000 });
  const circuitOpenUntil = normalizeOptionalTimestamp(health.circuitOpenUntil);
  const operatorSilencedUntil = normalizeOptionalTimestamp(health.operatorSilencedUntil);

  return {
    schemaVersion: 'audit.write.operational-health.v1',
    state: OPERATIONAL_HEALTH_STATES.has(health.state) ? health.state : 'healthy',
    failureType,
    failurePhase: OPERATIONAL_FAILURE_PHASES.has(health.failurePhase) ? health.failurePhase : null,
    failureSeverity: OPERATIONAL_FAILURE_SEVERITIES.has(health.failureSeverity) ? health.failureSeverity : null,
    lastErrorCode: normalizeIdentifier(health.lastErrorCode, failureType === 'none' ? 'none' : failureType),
    lastErrorMessage: normalizeNullableString(health.lastErrorMessage, { maxLength: 240 }),
    lastFailureAt: normalizeOptionalTimestamp(health.lastFailureAt),
    observedAt: normalizeOptionalTimestamp(health.observedAt) ?? now,
    providerLatencyMs: coerceInteger(health.providerLatencyMs, 0, { min: 0, max: 600000 }),
    consecutiveFailures: coerceInteger(health.consecutiveFailures, failureType === 'none' ? 0 : 1, { min: 0, max: 1000000 }),
    retryAttempt,
    maxRetryAttempts: coerceInteger(health.maxRetryAttempts, 6, { min: 0, max: 20 }),
    baseBackoffMs,
    maxBackoffMs,
    circuitOpenUntil,
    operatorSilencedUntil,
    degradedModeAllowed: coerceBoolean(health.degradedModeAllowed, false),
    acceptBufferedWithoutProof: coerceBoolean(health.acceptBufferedWithoutProof, false),
    suppressOperatorPage: operatorSilencedUntil ? Date.parse(operatorSilencedUntil) > Date.parse(now) : false
  };
}

function validateOperationalHealth(rawHealth = {}, normalizedHealth) {
  const health = asPlainObject(rawHealth);
  const issues = [];

  if ('state' in health && !OPERATIONAL_HEALTH_STATES.has(health.state)) {
    issues.push({ field: 'health.state', code: 'unsupported_operational_health_state', applied: normalizedHealth.state });
  }
  if ('failureType' in health && !OPERATIONAL_FAILURE_TYPES.has(health.failureType)) {
    issues.push({ field: 'health.failureType', code: 'unsupported_operational_failure_type', applied: normalizedHealth.failureType });
  }
  if ('failurePhase' in health && !OPERATIONAL_FAILURE_PHASES.has(health.failurePhase)) {
    issues.push({ field: 'health.failurePhase', code: 'unsupported_operational_failure_phase', applied: normalizedHealth.failurePhase });
  }
  if ('failureSeverity' in health && !OPERATIONAL_FAILURE_SEVERITIES.has(health.failureSeverity)) {
    issues.push({ field: 'health.failureSeverity', code: 'unsupported_operational_failure_severity', applied: normalizedHealth.failureSeverity });
  }
  for (const field of ['providerLatencyMs', 'consecutiveFailures', 'retryAttempt', 'maxRetryAttempts', 'baseBackoffMs', 'maxBackoffMs']) {
    if (field in health && health[field] !== normalizedHealth[field]) {
      issues.push({ field: `health.${field}`, code: 'operational_health_integer_normalized', applied: normalizedHealth[field] });
    }
  }
  for (const field of ['degradedModeAllowed', 'acceptBufferedWithoutProof']) {
    if (field in health && typeof health[field] !== 'boolean') {
      issues.push({ field: `health.${field}`, code: 'boolean_required', applied: normalizedHealth[field] });
    }
  }
  for (const field of ['lastFailureAt', 'observedAt', 'circuitOpenUntil', 'operatorSilencedUntil']) {
    if (field in health && normalizeOptionalTimestamp(health[field]) !== normalizedHealth[field]) {
      issues.push({ field: `health.${field}`, code: 'operational_health_timestamp_required', applied: normalizedHealth[field] });
    }
  }

  return issues;
}

function normalizePersistedCommand(rawCommand = {}) {
  const command = asPlainObject(rawCommand);
  const commandName = normalizeLifecycleCommand(command.command);

  return {
    command: commandName,
    commandKey: normalizeNullableString(command.commandKey, { maxLength: 180 }),
    appliedAt: normalizeOptionalTimestamp(command.appliedAt),
    result: normalizeIdentifier(command.result, 'applied'),
    cursor: normalizeNullableString(command.cursor, { maxLength: 220 }),
    proofHead: normalizeNullableString(command.proofHead, { maxLength: 220 })
  };
}

function normalizePersistedAuditState(rawState = {}, now) {
  const state = asPlainObject(rawState);
  const recentCommands = Array.isArray(state.recentCommands)
    ? state.recentCommands.map(normalizePersistedCommand).filter((entry) => entry.commandKey).slice(0, 20)
    : [];
  const status = PERSISTED_STATUSES.has(state.status) ? state.status : 'cold';
  const recoveryMode = RECOVERY_MODES.has(state.recoveryMode) ? state.recoveryMode : 'clean';

  return {
    schemaVersion: normalizeBoundedString(state.schemaVersion, 'audit.write.state.v1', { maxLength: 48 }),
    status,
    recoveryMode,
    bootEpoch: normalizeIdentifier(state.bootEpoch, 'boot-unknown'),
    recoveredAt: normalizeOptionalTimestamp(state.recoveredAt),
    lastAppliedCommand: normalizeLifecycleCommand(state.lastAppliedCommand),
    lastAppliedCommandKey: normalizeNullableString(state.lastAppliedCommandKey, { maxLength: 180 }),
    lastAppliedAt: normalizeOptionalTimestamp(state.lastAppliedAt),
    lastFlushAt: normalizeOptionalTimestamp(state.lastFlushAt),
    lastRotationAt: normalizeOptionalTimestamp(state.lastRotationAt),
    durableCursor: normalizeNullableString(state.durableCursor, { maxLength: 220 }),
    proofHead: normalizeNullableString(state.proofHead, { maxLength: 220 }),
    pendingSegmentId: normalizeIdentifier(state.pendingSegmentId, `${surfaceId}:segment:${Date.parse(now)}`),
    bufferedWrites: coerceInteger(state.bufferedWrites, 0, { min: 0, max: 1000000 }),
    committedWrites: coerceInteger(state.committedWrites, 0, { min: 0, max: 1000000000 }),
    failedWrites: coerceInteger(state.failedWrites, 0, { min: 0, max: 1000000 }),
    inFlightWriteKeys: normalizeStringList(state.inFlightWriteKeys, { maxItems: 100, maxLength: 180 }),
    recentCommands
  };
}

function validatePersistedAuditState(rawState = {}, normalizedState) {
  const state = asPlainObject(rawState);
  const issues = [];

  if ('status' in state && !PERSISTED_STATUSES.has(state.status)) {
    issues.push({ field: 'state.status', code: 'unsupported_persisted_status', applied: normalizedState.status });
  }
  if ('recoveryMode' in state && !RECOVERY_MODES.has(state.recoveryMode)) {
    issues.push({ field: 'state.recoveryMode', code: 'unsupported_recovery_mode', applied: normalizedState.recoveryMode });
  }
  for (const field of ['bufferedWrites', 'committedWrites', 'failedWrites']) {
    if (field in state && state[field] !== normalizedState[field]) {
      issues.push({ field: `state.${field}`, code: 'persisted_counter_normalized', applied: normalizedState[field] });
    }
  }
  if ('inFlightWriteKeys' in state && !Array.isArray(state.inFlightWriteKeys)) {
    issues.push({ field: 'state.inFlightWriteKeys', code: 'string_array_required', applied: normalizedState.inFlightWriteKeys });
  }
  if ('recentCommands' in state && !Array.isArray(state.recentCommands)) {
    issues.push({ field: 'state.recentCommands', code: 'command_history_array_required', applied: normalizedState.recentCommands });
  }

  return issues;
}

function buildLifecycleCommandKey({ request, command, clientRuntime }) {
  return normalizeBoundedString(
    request.commandKey,
    `${clientRuntime.workflowId}:${clientRuntime.requestId}:${command}`,
    { maxLength: 180 }
  );
}

function resolveLifecycleIdempotency({ command, commandKey, persistedState }) {
  const lastMatch = persistedState.lastAppliedCommandKey === commandKey
    && persistedState.lastAppliedCommand === command;
  const historyMatch = persistedState.recentCommands.some((entry) => (
    entry.commandKey === commandKey && entry.command === command
  ));
  const replayed = lastMatch || historyMatch;
  const matchedEntry = replayed
    ? persistedState.recentCommands.find((entry) => entry.commandKey === commandKey && entry.command === command) ?? null
    : null;

  return {
    commandKey,
    replayed,
    effect: replayed ? 'deduplicated' : 'apply',
    matchedAppliedAt: matchedEntry?.appliedAt ?? (lastMatch ? persistedState.lastAppliedAt : null),
    matchedCursor: matchedEntry?.cursor ?? (lastMatch ? persistedState.durableCursor : null),
    matchedProofHead: matchedEntry?.proofHead ?? (lastMatch ? persistedState.proofHead : null)
  };
}

function applyLifecycleCommand(command, settings, lifecycleControlDecision) {
  const nextSettings = { ...settings };
  const events = [];

  if (!lifecycleControlDecision.allowed) {
    return {
      settings: nextSettings,
      events: ['audit_write_lifecycle_command_blocked'],
      blocked: true,
      blockedBy: lifecycleControlDecision.blockedBy
    };
  }

  if (command === 'enable' || command === 'resume') {
    nextSettings.enabled = true;
    events.push('audit_write_enabled');
  }
  if (command === 'disable' || command === 'pause') {
    nextSettings.enabled = false;
    events.push('audit_write_disabled');
  }
  if (command === 'rotate') {
    events.push('audit_write_rotation_requested');
  }
  if (command === 'flush') {
    events.push('audit_write_flush_requested');
  }
  if (command === 'status') {
    events.push('audit_write_status_requested');
  }

  return { settings: nextSettings, events, blocked: false, blockedBy: [] };
}

function buildRecoveryPlan({ persistedState, provider, capabilityNegotiation, writeEnvelope, settings, operationalPolicy, now }) {
  const actions = [];
  const hasBufferedWork = persistedState.bufferedWrites > 0 || persistedState.inFlightWriteKeys.length > 0;
  const cursorMismatch = Boolean(provider.syncCursor && persistedState.durableCursor && provider.syncCursor !== persistedState.durableCursor);
  const duplicateWrite = persistedState.inFlightWriteKeys.includes(writeEnvelope.idempotencyKey);
  const unresolvedBlockingMissing = capabilityNegotiation.blockingMissing
    .filter((capability) => !(capability === 'proof-chain' && operationalPolicy?.proofDeferred));

  if (persistedState.status === 'cold') actions.push('hydrate_persisted_audit_state');
  if (hasBufferedWork) actions.push('replay_buffered_audit_writes');
  if (cursorMismatch) actions.push('reconcile_provider_cursor');
  if (settings.proofRequired && !persistedState.proofHead) actions.push('rebuild_proof_head');
  if (unresolvedBlockingMissing.length > 0) actions.push('await_required_provider_capabilities');

  const recoveryMode = unresolvedBlockingMissing.length > 0
    ? 'manual-review'
    : cursorMismatch
      ? 'reconcile-cursor'
      : hasBufferedWork
        ? 'resume-buffer'
        : 'clean';

  return {
    required: actions.length > 0,
    mode: recoveryMode,
    statusAtBoot: persistedState.status,
    recoveredAt: actions.length > 0 ? null : (persistedState.recoveredAt ?? now),
    duplicateWrite,
    cursorMismatch,
    pendingActions: actions,
    durableCursor: persistedState.durableCursor,
    providerCursor: provider.syncCursor,
    proofHead: persistedState.proofHead,
    bufferedWrites: persistedState.bufferedWrites,
    inFlightWriteCount: persistedState.inFlightWriteKeys.length
  };
}

function buildScheduleState(settings, command, now, lifecycleControlDecision = null) {
  const scheduleMode = lifecycleControlDecision?.effectiveScheduleMode ?? settings.scheduleMode;

  if (lifecycleControlDecision?.blockedBy?.some((blocker) => blocker.endsWith('_schedule_disabled'))) {
    return {
      mode: scheduleMode,
      requestedMode: settings.scheduleMode,
      active: false,
      reason: 'schedule_mode_blocked_by_lifecycle_controls',
      nextRunAt: null,
      guard: lifecycleControlDecision
    };
  }

  if (!settings.enabled) {
    return {
      mode: 'manual',
      requestedMode: settings.scheduleMode,
      active: false,
      reason: 'audit_write_disabled',
      nextRunAt: null,
      guard: lifecycleControlDecision
    };
  }

  if (command === 'flush' || scheduleMode === 'immediate') {
    return {
      mode: 'immediate',
      requestedMode: settings.scheduleMode,
      active: true,
      reason: command === 'flush' ? 'operator_flush' : 'immediate_schedule',
      nextRunAt: now,
      guard: lifecycleControlDecision
    };
  }

  if (scheduleMode === 'manual') {
    return {
      mode: 'manual',
      requestedMode: settings.scheduleMode,
      active: false,
      reason: 'manual_flush_required',
      nextRunAt: null,
      guard: lifecycleControlDecision
    };
  }

  return {
    mode: 'interval',
    requestedMode: settings.scheduleMode,
    active: true,
    reason: 'interval_flush',
    nextRunAt: new Date(Date.parse(now) + settings.flushIntervalMs).toISOString(),
    guard: lifecycleControlDecision
  };
}

function buildNextAction(command, settings, validationIssues, scheduleState, operationalStatus = null, lifecycleControlDecision = null) {
  if (lifecycleControlDecision && !lifecycleControlDecision.allowed) {
    return {
      type: 'resolve_lifecycle_control',
      blocking: true,
      label: 'Resolve audit-write lifecycle control before applying command',
      blockedBy: lifecycleControlDecision.blockedBy,
      at: lifecycleControlDecision.holdUntil
    };
  }
  if (operationalStatus?.retry?.retryable) {
    return {
      type: 'retry_audit_write',
      blocking: false,
      label: 'Retry audit write after provider backoff',
      at: operationalStatus.retry.nextRetryAt
    };
  }
  if (operationalStatus?.status === 'blocked' && operationalStatus.actionableErrors.length > 0) {
    return {
      type: operationalStatus.actionableErrors[0].action,
      blocking: true,
      label: 'Resolve audit-write operational blocker'
    };
  }
  if (validationIssues.length > 0) {
    return {
      type: 'review_settings',
      blocking: false,
      label: 'Review normalized audit-write settings'
    };
  }
  if (!settings.enabled) {
    return {
      type: 'await_enable',
      blocking: false,
      label: 'Audit writes are disabled until enable or resume'
    };
  }
  if (command === 'rotate') {
    return {
      type: 'complete_rotation',
      blocking: false,
      label: 'Complete audit segment rotation and publish proof'
    };
  }
  if (scheduleState.nextRunAt) {
    return {
      type: 'scheduled_flush',
      blocking: false,
      label: 'Flush buffered audit writes on schedule',
      at: scheduleState.nextRunAt
    };
  }
  return {
    type: 'operator_flush',
    blocking: false,
    label: 'Wait for explicit flush command'
  };
}

function buildSyncMetadata({ provider, capabilityNegotiation, command, settings, now }) {
  const syncEnabled = settings.enabled && capabilityNegotiation.granted.includes('cursor-sync');
  const cursorScope = `${surfaceId}:${provider.providerId}:${provider.service}`;

  return {
    enabled: syncEnabled,
    providerId: provider.providerId,
    service: provider.service,
    cursorScope,
    previousCursor: provider.syncCursor,
    nextCursor: syncEnabled ? `${cursorScope}:${Date.parse(now)}` : null,
    checkpointReason: command === 'rotate' ? 'segment_rotation' : command === 'flush' ? 'operator_flush' : 'lifecycle_status',
    externalReference: provider.externalReference
  };
}

function buildExternalHandoffState({ provider, capabilityNegotiation, scheduleState, settings, command, accessDecision }) {
  const handoffCapable = capabilityNegotiation.granted.includes('external-handoff');
  const boundaryAllowsHandoff = accessDecision.handoffAllowed && accessDecision.allowed;
  const enabled = settings.enabled && provider.handoffMode !== 'none' && handoffCapable && boundaryAllowsHandoff;
  const blockedBy = [];

  if (provider.handoffMode !== 'none' && !handoffCapable) blockedBy.push('external-handoff');
  if (provider.handoffMode !== 'none' && !accessDecision.handoffAllowed) blockedBy.push('tenant-boundary');
  if (provider.handoffMode !== 'none' && !accessDecision.streamScoped) blockedBy.push('stream-boundary');
  if (provider.handoffMode !== 'none' && accessDecision.handoffAllowed && accessDecision.denied.length > 0) blockedBy.push('access-boundary');

  return {
    mode: provider.handoffMode,
    enabled,
    state: enabled ? 'ready' : 'local_only',
    providerId: provider.providerId,
    endpoint: enabled ? provider.endpoint : null,
    scopeKey: accessDecision.scopeKey,
    pendingReason: enabled && scheduleState.active
      ? scheduleState.reason
      : command === 'rotate'
        ? 'awaiting_rotation_proof'
        : null,
    blockedBy
  };
}

function buildProviderHandoffReceiptContract({
  provider,
  providerDelivery,
  providerServiceContract,
  receiptCallback,
  externalHandoff,
  syncMetadata,
  writeAdmission,
  operationalStatus,
  now
}) {
  const receiptRequired = providerDelivery.externalReceiptRequired || providerDelivery.handoffRequired;
  const receiptExpired = providerDelivery.receiptState === 'expired'
    || (providerDelivery.receiptState === 'pending' && Date.parse(providerDelivery.receiptDeadlineAt) <= Date.parse(now));
  const callbackAcked = receiptCallback.state === 'acked' && receiptCallback.verified;
  const receiptAccepted = providerDelivery.receiptState === 'acked' || callbackAcked;
  const providerQueryable = providerServiceContract.negotiation.granted.includes('receipt-query');
  const handoffOwner = externalHandoff.enabled
    ? provider.serviceTier === 'external-managed'
      ? 'external-provider'
      : 'hosted-kernel-provider'
    : 'kernel-buffer';
  const healthHoldExternalHandoff = Boolean(operationalStatus.healthRemediation?.providerSafeMode?.holdExternalHandoff);
  const nextAction = !receiptRequired
    ? 'no_external_receipt_required'
    : healthHoldExternalHandoff
      ? 'hold_handoff_until_health_recovers'
    : !externalHandoff.enabled
      ? 'retain_in_kernel_buffer'
      : receiptAccepted
        ? 'commit_provider_receipt'
        : receiptExpired
          ? 'reissue_handoff_or_reconcile_receipt'
          : providerQueryable
            ? 'poll_provider_receipt'
            : 'await_provider_receipt_push';
  const blockers = [
    ...providerServiceContract.blockers.filter((blocker) => blocker.includes('receipt') || blocker.includes('handoff')),
    ...(!writeAdmission.accepted ? ['write_admission_not_accepted'] : []),
    ...(receiptExpired ? ['receipt_deadline_expired'] : []),
    ...(providerDelivery.receiptState === 'rejected' || receiptCallback.state === 'rejected' ? ['receipt_rejected_by_provider'] : []),
    ...(receiptCallback.state === 'acked' && !receiptCallback.verified ? ['receipt_callback_unverifiable'] : []),
    ...(healthHoldExternalHandoff ? ['health_remediation_holds_external_handoff'] : [])
  ];

  return {
    schemaVersion: 'audit.write.provider-handoff-receipt.v1',
    handoffId: providerDelivery.handoffId,
    deliveryId: providerDelivery.deliveryId,
    providerId: provider.providerId,
    owner: handoffOwner,
    mode: externalHandoff.mode,
    state: receiptAccepted
      ? 'receipt_acked'
      : blockers.length > 0
        ? 'receipt_blocked'
        : receiptRequired && externalHandoff.enabled
          ? 'receipt_pending'
          : 'local_buffered',
    receipt: {
      required: receiptRequired,
      state: providerDelivery.receiptState,
      topic: providerDelivery.receiptTopic,
      deadlineAt: providerDelivery.receiptDeadlineAt,
      queryable: providerQueryable,
      externalReference: provider.externalReference,
      callback: {
        callbackId: receiptCallback.callbackId,
        receiptId: receiptCallback.receiptId,
        state: receiptCallback.state,
        resultCode: receiptCallback.resultCode,
        observedAt: receiptCallback.observedAt,
        signedAt: receiptCallback.signedAt,
        signatureScheme: receiptCallback.signatureScheme,
        signed: receiptCallback.signed,
        verified: receiptCallback.verified,
        retryAfter: receiptCallback.retryAfter,
        ackedCursor: receiptCallback.ackedCursor,
        proofHead: receiptCallback.proofHead,
        matches: receiptCallback.matches
      }
    },
    sync: {
      checkpoint: providerDelivery.syncCheckpoint,
      cursorScope: syncMetadata.cursorScope,
      nextCursor: syncMetadata.nextCursor,
      durableBeforeHandoff: providerDelivery.commitStrategy === 'two-phase'
    },
    admission: {
      accepted: writeAdmission.accepted,
      idempotencyKey: writeAdmission.idempotencyKey,
      exactlyOnce: providerDelivery.exactlyOnceRequired,
      proofDeferred: writeAdmission.proofDeferred
    },
    operational: {
      status: operationalStatus.status,
      retryable: operationalStatus.retry.retryable,
      nextRetryAt: operationalStatus.retry.nextRetryAt,
      remediationId: operationalStatus.healthRemediation?.remediationId ?? null,
      providerSafeMode: operationalStatus.healthRemediation?.providerSafeMode ?? null
    },
    nextAction,
    blockedBy: [...new Set(blockers)]
  };
}

function buildOperationalPolicy({ health, capabilityNegotiation, settings, persistedState, now }) {
  const circuitOpen = Boolean(health.circuitOpenUntil && Date.parse(health.circuitOpenUntil) > Date.parse(now));
  const proofUnavailable = settings.proofRequired && !capabilityNegotiation.granted.includes('proof-chain');
  const appendAvailable = capabilityNegotiation.granted.includes('append');
  const retryableFailure = ['provider-timeout', 'provider-5xx', 'proof-chain-lag', 'cursor-conflict', 'storage-pressure', 'network-partition']
    .includes(health.failureType);
  const retryBudgetRemaining = health.retryAttempt < health.maxRetryAttempts;
  const degradedBuffering = settings.enabled
    && appendAvailable
    && proofUnavailable
    && health.degradedModeAllowed
    && health.acceptBufferedWithoutProof
    && persistedState.bufferedWrites < settings.maxBufferedWrites;

  return {
    schemaVersion: 'audit.write.operational-policy.v1',
    circuitOpen,
    retryableFailure,
    retryBudgetRemaining,
    degradedBuffering,
    proofDeferred: degradedBuffering,
    hardFailure: circuitOpen || (retryableFailure && !retryBudgetRemaining),
    failureType: health.failureType,
    failureCode: health.lastErrorCode,
    providerLatencyMs: health.providerLatencyMs
  };
}

function buildWriteAdmission({
  settings,
  capabilityNegotiation,
  writeEnvelope,
  scheduleState,
  validationIssues,
  recoveryPlan,
  accessDecision,
  operationalPolicy,
  lifecycleControlDecision,
  providerServiceContract
}) {
  const blockers = [];

  if (lifecycleControlDecision && !lifecycleControlDecision.allowed) blockers.push('lifecycle_command_blocked');
  if (!settings.enabled) blockers.push('audit_write_disabled');
  if (!capabilityNegotiation.granted.includes('append')) blockers.push('append_capability_unavailable');
  if (settings.proofRequired && !capabilityNegotiation.granted.includes('proof-chain') && !operationalPolicy.degradedBuffering) {
    blockers.push('proof_chain_unavailable');
  }
  if (operationalPolicy.hardFailure) blockers.push(`operational_${operationalPolicy.failureType}`);
  if (!writeEnvelope.hasPayload) blockers.push('empty_write_envelope');
  if (validationIssues.some((issue) => issue.code === 'required_capability_unavailable')) {
    blockers.push('required_capability_unavailable');
  }
  for (const blocker of providerServiceContract?.blockers ?? []) {
    blockers.push(`provider_contract_${blocker}`);
  }
  if (recoveryPlan?.mode === 'manual-review') blockers.push('state_recovery_requires_manual_review');
  for (const denial of accessDecision.denied) {
    blockers.push(`access_${denial}`);
  }

  const accepted = blockers.length === 0;
  const replayed = Boolean(recoveryPlan?.duplicateWrite);

  return {
    accepted,
    replayed,
    state: replayed ? 'already_in_flight' : accepted ? 'accepted_for_buffer' : 'blocked',
    blockers: [...new Set(blockers)],
    targetStream: writeEnvelope.targetStream,
    operation: writeEnvelope.operation,
    idempotencyKey: writeEnvelope.idempotencyKey,
    recordCount: writeEnvelope.recordCount,
    payloadBytes: writeEnvelope.payloadBytes,
    bufferSlotReserved: accepted && !replayed,
    flushPolicy: accepted && scheduleState.active ? scheduleState.reason : 'manual_or_blocked',
    lifecycleControl: lifecycleControlDecision ? {
      allowed: lifecycleControlDecision.allowed,
      blockedBy: lifecycleControlDecision.blockedBy,
      operatorReason: lifecycleControlDecision.operatorReason
    } : null,
    degraded: operationalPolicy.degradedBuffering,
    proofDeferred: accepted && operationalPolicy.proofDeferred,
    boundary: {
      allowed: accessDecision.allowed,
      requiredPermission: accessDecision.requiredPermission,
      scopeKey: accessDecision.scopeKey,
      subject: accessDecision.subject
    }
  };
}

function classifyOperationalFailurePhase(blockers, health) {
  const joined = blockers.join(' ');
  const fromHealth = normalizeIdentifier(health.failurePhase, '');
  if (OPERATIONAL_FAILURE_PHASES.has(fromHealth)) return fromHealth;
  if (joined.includes('receipt')) return 'receipt';
  if (joined.includes('handoff')) return 'handoff';
  if (joined.includes('cursor') || health.failureType === 'cursor-conflict') return 'cursor-sync';
  if (joined.includes('proof') || health.failureType === 'proof-chain-lag') return 'proof';
  if (joined.includes('storage') || health.failureType === 'storage-pressure') return 'storage';
  if (joined.includes('append') || health.failureType === 'provider-timeout' || health.failureType === 'provider-5xx') return 'append';
  return 'admission';
}

function buildOperationalFailureState({
  health,
  operationalPolicy,
  writeAdmission,
  providerDelivery,
  providerServiceContract,
  recoveryPlan,
  retryable,
  retryDelayMs,
  nextRetryAt,
  status,
  now
}) {
  const blockers = [...new Set([
    ...writeAdmission.blockers,
    ...providerServiceContract.blockers,
    ...recoveryPlan.pendingActions.map((action) => `recovery_${action}`)
  ])];
  const phase = classifyOperationalFailurePhase(blockers, health);
  const retryExhausted = operationalPolicy.retryableFailure && !operationalPolicy.retryBudgetRemaining;
  const receiptPastDeadline = Date.parse(providerDelivery.receiptDeadlineAt) <= Date.parse(now)
    && providerDelivery.receiptState === 'pending';
  const circuitOpen = operationalPolicy.circuitOpen;
  const degradedActive = writeAdmission.degraded || operationalPolicy.proofDeferred;
  const requestedSeverity = normalizeIdentifier(health.failureSeverity, '');
  const severity = OPERATIONAL_FAILURE_SEVERITIES.has(requestedSeverity)
    ? requestedSeverity
    : circuitOpen || retryExhausted || status === 'blocked'
      ? 'error'
      : degradedActive || retryable || receiptPastDeadline
        ? 'warning'
        : 'info';
  const failureCode = health.failureType === 'none'
    ? blockers[0] ?? 'none'
    : `${phase}_${health.failureType}`;
  const escalationRequired = severity === 'critical'
    || retryExhausted
    || circuitOpen
    || blockers.some((blocker) => blocker.includes('manual_review') || blocker.includes('provider_endpoint_required'));
  const retryWindow = retryable
    ? 'scheduled'
    : retryExhausted
      ? 'exhausted'
      : circuitOpen
        ? 'circuit_open'
        : 'not_retryable';

  return {
    schemaVersion: 'audit.write.operational-failure-state.v1',
    state: status,
    phase,
    severity,
    code: failureCode,
    observedAt: health.observedAt,
    providerLatencyMs: health.providerLatencyMs,
    consecutiveFailures: health.consecutiveFailures,
    circuit: {
      open: circuitOpen,
      openUntil: health.circuitOpenUntil,
      suppressOperatorPage: health.suppressOperatorPage
    },
    retryPlan: {
      window: retryWindow,
      retryable,
      attempt: health.retryAttempt,
      maxAttempts: health.maxRetryAttempts,
      remainingAttempts: Math.max(0, health.maxRetryAttempts - health.retryAttempt),
      delayMs: retryDelayMs,
      nextRetryAt,
      backoff: retryable ? 'exponential' : 'none',
      exhausted: retryExhausted
    },
    degradedMode: {
      active: degradedActive,
      mode: degradedActive ? 'buffer_without_current_proof_ack' : 'none',
      admissionAccepted: writeAdmission.accepted,
      proofDeferred: writeAdmission.proofDeferred,
      guardrails: degradedActive
        ? ['append_capability_required', 'buffer_limit_enforced', 'proof_rebuild_required_before_durable_commit']
        : [],
      exitCriteria: degradedActive
        ? ['proof-chain capability granted', 'buffered writes reconciled', 'next proof head published']
        : []
    },
    receiptWatch: {
      receiptState: providerDelivery.receiptState,
      deadlineAt: providerDelivery.receiptDeadlineAt,
      pastDeadline: receiptPastDeadline,
      handoffId: providerDelivery.handoffId
    },
    escalation: {
      required: escalationRequired,
      owner: escalationRequired
        ? phase === 'proof'
          ? 'proof-chain-ops'
          : phase === 'handoff' || phase === 'receipt'
            ? 'provider-ops'
            : 'kernel-operator'
        : 'audit-runtime',
      reason: retryExhausted
        ? 'retry_budget_exhausted'
        : circuitOpen
          ? 'provider_circuit_open'
          : receiptPastDeadline
            ? 'receipt_deadline_expired'
            : blockers[0] ?? 'none'
    },
    blockedBy: blockers
  };
}

function buildHealthRemediationContract({
  health,
  operationalPolicy,
  writeAdmission,
  providerDelivery,
  providerServiceContract,
  recoveryPlan,
  failureState,
  actionableErrors,
  now
}) {
  const primaryError = actionableErrors.find((error) => error.severity === 'error') ?? actionableErrors[0] ?? null;
  const receiptDeadlinePassed = failureState.receiptWatch.pastDeadline;
  const retryScheduled = failureState.retryPlan.retryable && Boolean(failureState.retryPlan.nextRetryAt);
  const degradedActive = failureState.degradedMode.active;
  const handoffUnsafe = providerDelivery.handoffRequired
    && (degradedActive || receiptDeadlinePassed || providerServiceContract.blockers.some((blocker) => blocker.includes('handoff')));
  const canContinueLocally = writeAdmission.accepted
    && (degradedActive || providerDelivery.commitStrategy === 'buffer-first')
    && !failureState.circuit.open;
  const interventionRequired = failureState.escalation.required
    || receiptDeadlinePassed
    || primaryError?.severity === 'error';
  const remediationId = proofDigest({
    requestKey: writeAdmission.idempotencyKey,
    status: failureState.state,
    phase: failureState.phase,
    retryAt: failureState.retryPlan.nextRetryAt,
    primaryError: primaryError?.code ?? 'none'
  });
  const playbook = [
    ...(retryScheduled ? [{
      step: 'wait_for_retry_backoff',
      owner: 'audit-runtime',
      dueAt: failureState.retryPlan.nextRetryAt,
      detail: `${failureState.retryPlan.backoff}_attempt_${failureState.retryPlan.attempt + 1}`
    }] : []),
    ...(degradedActive ? [{
      step: 'rebuild_deferred_proof',
      owner: 'proof-chain-ops',
      dueAt: null,
      detail: failureState.degradedMode.exitCriteria[0] ?? 'proof_rebuild_required'
    }] : []),
    ...(receiptDeadlinePassed ? [{
      step: 'reconcile_provider_receipt',
      owner: 'provider-ops',
      dueAt: now,
      detail: providerDelivery.handoffId
    }] : []),
    ...(recoveryPlan.required ? [{
      step: 'resume_recovery_plan',
      owner: recoveryPlan.mode === 'manual-review' ? 'kernel-operator' : 'audit-runtime',
      dueAt: null,
      detail: recoveryPlan.pendingActions[0] ?? recoveryPlan.mode
    }] : []),
    ...(primaryError ? [{
      step: primaryError.action,
      owner: classifyActionableErrorOwner(primaryError),
      dueAt: primaryError.retryable ? failureState.retryPlan.nextRetryAt : null,
      detail: primaryError.code
    }] : [])
  ];
  const uniquePlaybook = [...new Map(playbook.map((step) => [step.step, step])).values()];

  return {
    schemaVersion: 'audit.write.health-remediation.v1',
    remediationId,
    state: failureState.state,
    phase: failureState.phase,
    severity: failureState.severity,
    operatorPage: interventionRequired && !health.suppressOperatorPage,
    primaryAction: uniquePlaybook[0]?.step ?? 'observe_audit_write_health',
    canContinueLocally,
    retryGate: {
      scheduled: retryScheduled,
      retryable: failureState.retryPlan.retryable,
      nextRetryAt: failureState.retryPlan.nextRetryAt,
      remainingAttempts: failureState.retryPlan.remainingAttempts,
      exhausted: failureState.retryPlan.exhausted
    },
    degradedGate: {
      active: degradedActive,
      proofDeferred: failureState.degradedMode.proofDeferred,
      localBufferAllowed: canContinueLocally,
      exitCriteria: failureState.degradedMode.exitCriteria
    },
    providerSafeMode: {
      holdExternalHandoff: handoffUnsafe,
      deliveryRoute: handoffUnsafe ? 'kernel-buffer-until-health-recovers' : providerDelivery.route,
      commitStrategy: handoffUnsafe ? 'buffer-first' : providerDelivery.commitStrategy,
      reason: handoffUnsafe
        ? receiptDeadlinePassed
          ? 'receipt_deadline_passed'
          : degradedActive
            ? 'degraded_proof_or_receipt_path'
            : providerServiceContract.blockers.find((blocker) => blocker.includes('handoff')) ?? 'handoff_health_guard'
        : 'provider_delivery_permitted'
    },
    playbook: uniquePlaybook.slice(0, 6)
  };
}

function buildOperationalStatus({
  health,
  operationalPolicy,
  writeAdmission,
  validationIssues,
  recoveryPlan,
  externalHandoff,
  providerDelivery,
  providerServiceContract,
  now
}) {
  const retryable = !writeAdmission.accepted
    && operationalPolicy.retryableFailure
    && operationalPolicy.retryBudgetRemaining
    && !operationalPolicy.circuitOpen;
  const retryDelayMs = retryable
    ? Math.min(health.maxBackoffMs, health.baseBackoffMs * (2 ** health.retryAttempt))
    : null;
  const nextRetryAt = retryDelayMs === null ? null : new Date(Date.parse(now) + retryDelayMs).toISOString();
  const validationBlocking = validationIssues.some((issue) => (
    issue.code === 'required_capability_unavailable'
    || issue.code === 'unsupported_lifecycle_command'
    || issue.code === 'lifecycle_command_blocked'
  ));
  const status = !writeAdmission.accepted
    ? retryable
      ? 'retrying'
      : 'blocked'
    : writeAdmission.degraded || recoveryPlan.required || externalHandoff.blockedBy.length > 0
      ? 'degraded'
      : 'healthy';
  const actionableErrors = [
    ...writeAdmission.blockers.map((blocker) => ({
      code: blocker,
      severity: blocker.startsWith('access_') || blocker === 'required_capability_unavailable' ? 'error' : 'warning',
      retryable: retryable && blocker.startsWith('operational_'),
      action: blocker.startsWith('access_')
        ? 'review_access_boundary'
        : blocker === 'proof_chain_unavailable'
          ? 'restore_proof_chain_or_enable_degraded_buffering'
          : blocker === 'append_capability_unavailable'
            ? 'restore_append_provider_capability'
        : blocker === 'audit_write_disabled'
              ? 'enable_audit_write'
              : blocker === 'lifecycle_command_blocked'
                ? 'resolve_lifecycle_controls'
              : blocker === 'empty_write_envelope'
                ? 'send_non_empty_audit_payload'
                : 'inspect_audit_write_health'
    })),
    ...externalHandoff.blockedBy.map((blocker) => ({
      code: `handoff_${blocker}_blocked`,
      severity: 'warning',
      retryable: blocker !== 'tenant-boundary',
      action: blocker === 'tenant-boundary' ? 'review_handoff_scope' : 'restore_external_handoff_capability'
    }))
  ];
  const failureState = buildOperationalFailureState({
    health,
    operationalPolicy,
    writeAdmission,
    providerDelivery,
    providerServiceContract,
    recoveryPlan,
    retryable,
    retryDelayMs,
    nextRetryAt,
    status,
    now
  });
  const healthRemediation = buildHealthRemediationContract({
    health,
    operationalPolicy,
    writeAdmission,
    providerDelivery,
    providerServiceContract,
    recoveryPlan,
    failureState,
    actionableErrors,
    now
  });

  return {
    schemaVersion: 'audit.write.operational-status.v1',
    status,
    failureState,
    healthRemediation,
    degradedMode: writeAdmission.degraded
      ? 'local-buffer-proof-deferred'
      : recoveryPlan.required
        ? recoveryPlan.mode
        : 'none',
    providerFailure: health.failureType === 'none' ? null : {
      type: health.failureType,
      code: health.lastErrorCode,
      message: health.lastErrorMessage,
      lastFailureAt: health.lastFailureAt,
      consecutiveFailures: health.consecutiveFailures
    },
    retry: {
      retryable,
      attempt: health.retryAttempt,
      maxAttempts: health.maxRetryAttempts,
      nextRetryAt,
      delayMs: retryDelayMs,
      circuitOpenUntil: health.circuitOpenUntil
    },
    validationBlocking,
    suppressOperatorPage: health.suppressOperatorPage,
    actionableErrors
  };
}

function classifyActionableErrorOwner(error) {
  if (error.action?.includes('access') || error.code?.startsWith('access_')) return 'security-boundary';
  if (error.action?.includes('provider') || error.code?.includes('provider_contract')) return 'provider-ops';
  if (error.action?.includes('proof') || error.code?.includes('proof')) return 'proof-chain-ops';
  if (error.action?.includes('lifecycle') || error.code?.includes('lifecycle')) return 'kernel-operator';
  if (error.action?.includes('enable') || error.code === 'audit_write_disabled') return 'kernel-operator';
  if (error.action?.includes('payload') || error.code === 'empty_write_envelope') return 'caller';
  return 'audit-runtime';
}

function buildActionableErrorReport({
  clientRuntime,
  command,
  writeEnvelope,
  accessDecision,
  providerServiceContract,
  operationalStatus,
  validationIssues,
  now
}) {
  const validationErrors = validationIssues
    .filter((issue) => [
      'unsupported_lifecycle_command',
      'lifecycle_command_blocked',
      'required_capability_unavailable',
      'provider_service_contract_unready',
      'provider_contract_batch_limit_exceeded'
    ].includes(issue.code))
    .map((issue) => ({
      code: issue.code,
      severity: issue.code === 'provider_contract_batch_limit_exceeded' ? 'error' : 'warning',
      retryable: false,
      action: issue.code === 'provider_contract_batch_limit_exceeded'
        ? 'reduce_audit_write_batch'
        : issue.code === 'required_capability_unavailable'
          ? 'restore_required_provider_capability'
          : issue.code === 'lifecycle_command_blocked'
            ? 'resolve_lifecycle_controls'
            : 'review_audit_write_request',
      source: issue.field,
      detail: issue.value ?? issue.applied ?? null
    }));
  const contractErrors = providerServiceContract.blockers.map((blocker) => ({
    code: `provider_contract_${blocker}`,
    severity: blocker === 'write_batch_exceeds_provider_contract' ? 'error' : 'warning',
    retryable: !['missing_append', 'provider_endpoint_required', 'write_batch_exceeds_provider_contract'].includes(blocker),
    action: blocker === 'write_batch_exceeds_provider_contract'
      ? 'reduce_audit_write_batch'
      : blocker === 'provider_endpoint_required'
        ? 'configure_provider_endpoint'
        : blocker.startsWith('missing_')
          ? 'restore_required_provider_capability'
          : 'inspect_provider_contract',
    source: 'provider.contract',
    detail: blocker
  }));
  const operationalErrors = operationalStatus.actionableErrors.map((error) => ({
    ...error,
    source: 'operational.status',
    detail: null
  }));
  const uniqueErrors = new Map();

  for (const error of [...operationalErrors, ...validationErrors, ...contractErrors]) {
    const key = `${error.source}:${error.code}:${error.action}`;
    if (!uniqueErrors.has(key)) uniqueErrors.set(key, error);
  }

  const errors = [...uniqueErrors.values()].map((error, index) => {
    const owner = classifyActionableErrorOwner(error);
    return {
      id: `${surfaceId}:error:${Date.parse(now)}:${index + 1}`,
      code: error.code,
      severity: error.severity,
      retryable: Boolean(error.retryable),
      action: error.action,
      owner,
      source: error.source,
      detail: error.detail,
      messageKey: `audit_write.${error.action}`,
      blocksAdmission: error.severity === 'error' || operationalStatus.status === 'blocked',
      nextAttemptAt: error.retryable ? operationalStatus.retry.nextRetryAt : null
    };
  });
  const blocking = errors.filter((error) => error.blocksAdmission);
  const primary = blocking[0] ?? errors[0] ?? null;

  return {
    schemaVersion: 'audit.write.actionable-error-report.v1',
    generatedAt: now,
    request: {
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      command,
      targetStream: writeEnvelope.targetStream,
      idempotencyKey: writeEnvelope.idempotencyKey
    },
    boundary: {
      allowed: accessDecision.allowed,
      denied: accessDecision.denied,
      scopeKey: accessDecision.scopeKey
    },
    summary: {
      status: operationalStatus.status,
      errorCount: errors.length,
      blockingCount: blocking.length,
      retryableCount: errors.filter((error) => error.retryable).length,
      primaryAction: primary?.action ?? 'none',
      remediationId: operationalStatus.healthRemediation.remediationId,
      remediationAction: operationalStatus.healthRemediation.primaryAction,
      pageOperator: blocking.length > 0 && !operationalStatus.suppressOperatorPage
    },
    retry: operationalStatus.retry,
    errors
  };
}

function summarizeValidationForClient(validationIssues) {
  const bySeverity = validationIssues.reduce((summary, issue) => {
    const severity = [
      'required_capability_unavailable',
      'lifecycle_command_blocked',
      'provider_contract_batch_limit_exceeded',
      'provider_receipt_ack_not_verifiable'
    ].includes(issue.code)
      ? 'error'
      : 'warning';
    summary[severity] += 1;
    return summary;
  }, { error: 0, warning: 0 });
  const fields = [...new Set(validationIssues.map((issue) => issue.field))].slice(0, 12);
  const primary = validationIssues.find((issue) => [
    'lifecycle_command_blocked',
    'required_capability_unavailable',
    'provider_contract_batch_limit_exceeded'
  ].includes(issue.code)) ?? validationIssues[0] ?? null;

  return {
    schemaVersion: 'audit.write.validation-summary.v1',
    ok: validationIssues.length === 0,
    issueCount: validationIssues.length,
    errorCount: bySeverity.error,
    warningCount: bySeverity.warning,
    affectedFields: fields,
    primaryIssue: primary
      ? {
          field: primary.field,
          code: primary.code,
          value: primary.value ?? primary.applied ?? null
        }
      : null
  };
}

function buildRoutePreviewContract({
  command,
  clientRuntime,
  writeEnvelope,
  accessBoundary,
  accessDecision,
  provider,
  providerDelivery,
  providerServiceContract,
  providerHandoffReceipt,
  workflowHandoff,
  clientRuntimeHandoff,
  workflowHandoffPacket,
  scheduleState,
  writeAdmission,
  operationalStatus,
  actionableErrorReport,
  validationSummary,
  nextAction,
  proofCommit,
  now
}) {
  const proofState = proofCommit.appendable
    ? proofCommit.durable
      ? 'durable_proof_committed'
      : proofCommit.commitPhase === 'prepared'
        ? 'prepared_pending_handoff_receipt'
        : 'proof_leaf_pending_durability'
    : writeAdmission.accepted
      ? 'deduplicated_or_replayed'
      : 'not_appendable';
  const readinessBlockers = [...new Set([
    ...writeAdmission.blockers,
    ...providerServiceContract.blockers.map((blocker) => `provider_${blocker}`),
    ...providerHandoffReceipt.blockedBy.map((blocker) => `receipt_${blocker}`),
    ...accessDecision.denied.map((denial) => `access_${denial}`)
  ])];
  const clientVisibleStatus = writeAdmission.accepted
    ? providerHandoffReceipt.state === 'receipt_pending'
      ? 'accepted_pending_provider_receipt'
      : proofCommit.durable
        ? 'accepted_durable'
        : 'accepted_pending_durability'
    : operationalStatus.retry.retryable
      ? 'retryable_blocked'
      : 'blocked';
  const explanation = writeAdmission.accepted
    ? [
        'Audit write passed access and provider admission checks.',
        providerDelivery.handoffRequired
          ? 'Provider handoff contract must settle before durable completion.'
          : 'Hosted kernel buffer can advance without external handoff.',
        proofCommit.durable
          ? 'Proof commit is durable for the current cursor.'
          : 'Proof or receipt durability is still pending.'
      ]
    : [
        actionableErrorReport.summary.primaryAction === 'none'
          ? 'Audit write did not meet admission requirements.'
          : `Next action is ${actionableErrorReport.summary.primaryAction}.`,
        readinessBlockers[0] ?? validationSummary.primaryIssue?.code ?? 'blocked'
      ];

  return {
    schemaVersion: 'audit.write.client-preview.v1',
    generatedAt: now,
    request: {
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      command,
      route: clientRuntime.route,
      clientPhase: clientRuntime.state.phase,
      resumeToken: clientRuntime.state.resumeToken,
      continuityKey: clientRuntime.state.continuityKey
    },
    subject: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      principalId: clientRuntime.principalId,
      scopeKey: accessDecision.scopeKey
    },
    writePreview: {
      targetStream: writeEnvelope.targetStream,
      operation: writeEnvelope.operation,
      idempotencyKey: writeEnvelope.idempotencyKey,
      recordCount: writeEnvelope.recordCount,
      payloadBytes: writeEnvelope.payloadBytes,
      schemaVersion: writeEnvelope.schemaVersion
    },
    acceptance: {
      accepted: writeAdmission.accepted,
      replayed: writeAdmission.replayed,
      state: clientVisibleStatus,
      bufferSlotReserved: writeAdmission.bufferSlotReserved,
      proofDeferred: writeAdmission.proofDeferred,
      durable: proofCommit.durable,
      blockedBy: readinessBlockers
    },
    readiness: {
      ready: readinessBlockers.length === 0 && providerServiceContract.ready && providerHandoffReceipt.blockedBy.length === 0,
      providerReady: providerServiceContract.ready,
      handoffReady: providerHandoffReceipt.blockedBy.length === 0,
      validationReady: validationSummary.errorCount === 0,
      accessReady: accessDecision.allowed,
      scheduleReady: scheduleState.active || scheduleState.mode === 'manual',
      nextRunAt: scheduleState.nextRunAt,
      receiptDeadlineAt: providerDelivery.receiptDeadlineAt,
      retryAt: operationalStatus.retry.nextRetryAt
    },
    providerRoute: {
      providerId: provider.providerId,
      serviceTier: provider.serviceTier,
      deliveryId: providerDelivery.deliveryId,
      handoffId: providerDelivery.handoffId,
      route: providerDelivery.route,
      ackMode: providerDelivery.ackMode,
      commitStrategy: providerDelivery.commitStrategy,
      receiptState: providerHandoffReceipt.state
    },
    validationSummary,
    proof: {
      state: proofState,
      commitPhase: proofCommit.commitPhase,
      receiptId: proofCommit.receiptId,
      proofHead: proofCommit.nextProofHead,
      leafDigest: proofCommit.leafDigest
    },
    workflow: {
      target: workflowHandoff.target,
      visibleState: workflowHandoff.visibleState,
      ticket: workflowHandoff.ticket,
      userMessageKey: workflowHandoff.userMessageKey,
      resumeToken: workflowHandoff.resumeToken,
      ackPreference: workflowHandoff.ackPreference,
      clientSurface: workflowHandoff.clientSurface,
      continuityKey: workflowHandoff.continuityKey,
      currentPhase: clientRuntimeHandoff.current.phase,
      nextPhase: clientRuntimeHandoff.next.phase,
      responseMode: clientRuntimeHandoff.responseMode,
      persistState: clientRuntimeHandoff.persistState,
      handoffPacketDigest: workflowHandoffPacket.packetDigest,
      dispatchAction: workflowHandoffPacket.dispatch.action,
      handoffDeadlineAt: workflowHandoffPacket.dispatch.deadlineAt,
      userVisibleState: workflowHandoffPacket.userVisible.state
    },
    nextStep: {
      type: nextAction.type,
      blocking: nextAction.blocking,
      label: nextAction.label,
      at: nextAction.at ?? scheduleState.nextRunAt ?? operationalStatus.retry.nextRetryAt ?? null,
      owner: actionableErrorReport.errors[0]?.owner ?? (writeAdmission.accepted ? 'audit-runtime' : 'caller'),
      messageKey: actionableErrorReport.errors[0]?.messageKey ?? workflowHandoff.userMessageKey,
      explanation
    }
  };
}

function buildClientAcceptanceReadinessContract({
  command,
  clientRuntime,
  writeEnvelope,
  accessDecision,
  providerServiceContract,
  providerHandoffReceipt,
  writeAdmission,
  operationalStatus,
  actionableErrorReport,
  validationIssues,
  validationSummary,
  preview,
  proofCommit,
  clientRuntimeHandoff,
  workflowHandoffPacket,
  nextAction,
  now
}) {
  const validationGroups = validationIssues.reduce((groups, issue) => {
    const key = issue.field.split('.')[0] || 'request';
    groups[key] ??= { fieldGroup: key, issueCount: 0, blockingCount: 0, sampleCodes: [] };
    groups[key].issueCount += 1;
    if ([
      'required_capability_unavailable',
      'lifecycle_command_blocked',
      'provider_service_contract_unready',
      'provider_contract_batch_limit_exceeded',
      'provider_receipt_ack_not_verifiable'
    ].includes(issue.code)) {
      groups[key].blockingCount += 1;
    }
    if (!groups[key].sampleCodes.includes(issue.code)) groups[key].sampleCodes.push(issue.code);
    return groups;
  }, {});
  const readinessChecklist = [
    {
      id: 'access-boundary',
      label: 'Access boundary permits audit write',
      ready: accessDecision.allowed,
      blocking: !accessDecision.allowed,
      detail: accessDecision.denied[0] ?? accessDecision.requiredPermission
    },
    {
      id: 'provider-contract',
      label: 'Provider contract can accept this batch',
      ready: providerServiceContract.ready,
      blocking: !providerServiceContract.ready,
      detail: providerServiceContract.blockers[0] ?? providerServiceContract.deliveryContract.state
    },
    {
      id: 'receipt-watch',
      label: 'Receipt and handoff state can progress',
      ready: providerHandoffReceipt.blockedBy.length === 0,
      blocking: providerHandoffReceipt.blockedBy.length > 0,
      detail: providerHandoffReceipt.blockedBy[0] ?? providerHandoffReceipt.nextAction
    },
    {
      id: 'validation',
      label: 'Request validation has no blocking errors',
      ready: validationSummary.errorCount === 0,
      blocking: validationSummary.errorCount > 0,
      detail: validationSummary.primaryIssue?.code ?? 'clean'
    },
    {
      id: 'proof-output',
      label: 'Proof output is available for the route response',
      ready: proofCommit.appendable || Boolean(proofCommit.nextProofHead),
      blocking: writeAdmission.accepted && !proofCommit.appendable && !writeAdmission.replayed,
      detail: proofCommit.commitPhase
    }
  ];
  const blockingChecklist = readinessChecklist.filter((item) => item.blocking);
  const primaryError = actionableErrorReport.errors.find((error) => error.blocksAdmission)
    ?? actionableErrorReport.errors[0]
    ?? null;
  const routeStatus = writeAdmission.accepted
    ? providerHandoffReceipt.state === 'receipt_pending'
      ? 202
      : 200
    : operationalStatus.retry.retryable
      ? 503
      : 409;
  const acceptedMode = writeAdmission.accepted
    ? proofCommit.durable
      ? 'accepted_durable'
      : providerHandoffReceipt.state === 'receipt_pending'
        ? 'accepted_receipt_pending'
        : 'accepted_buffered'
    : operationalStatus.retry.retryable
      ? 'blocked_retryable'
      : 'blocked_terminal';
  const previewDigest = proofDigest({
    requestId: clientRuntime.requestId,
    traceId: clientRuntime.traceId,
    accepted: writeAdmission.accepted,
    state: acceptedMode,
    proofHead: proofCommit.nextProofHead,
    nextPhase: clientRuntimeHandoff.next.phase,
    blockers: blockingChecklist.map((item) => item.id)
  });

  return {
    schemaVersion: 'audit.write.route-acceptance-readiness.v1',
    generatedAt: now,
    route: {
      name: clientRuntime.route,
      command,
      status: routeStatus,
      responseKind: routeStatus < 300 ? 'accepted' : operationalStatus.retry.retryable ? 'retryable_error' : 'blocked_error',
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      handoffPacketDigest: workflowHandoffPacket.packetDigest
    },
    previewDigest,
    acceptance: {
      accepted: writeAdmission.accepted,
      mode: acceptedMode,
      replayed: writeAdmission.replayed,
      targetStream: writeEnvelope.targetStream,
      idempotencyKey: writeEnvelope.idempotencyKey,
      bufferSlotReserved: writeAdmission.bufferSlotReserved,
      blockers: writeAdmission.blockers,
      primaryBlocker: writeAdmission.blockers[0] ?? null
    },
    readiness: {
      ready: blockingChecklist.length === 0,
      blockingCount: blockingChecklist.length,
      checklist: readinessChecklist,
      firstBlockingItem: blockingChecklist[0]?.id ?? null
    },
    validation: {
      ...validationSummary,
      groups: Object.values(validationGroups).map((group) => ({
        ...group,
        sampleCodes: group.sampleCodes.slice(0, 5)
      })),
      firstIssues: validationIssues.slice(0, 5).map((issue) => ({
        field: issue.field,
        code: issue.code,
        value: issue.value ?? issue.applied ?? null
      }))
    },
    nextStep: {
      type: nextAction.type,
      blocking: nextAction.blocking || blockingChecklist.length > 0,
      owner: primaryError?.owner ?? preview.nextStep.owner,
      messageKey: primaryError?.messageKey ?? preview.nextStep.messageKey,
      label: primaryError ? primaryError.action : nextAction.label,
      at: nextAction.at ?? operationalStatus.retry.nextRetryAt ?? null,
      explain: preview.nextStep.explanation
    },
    clientStatePatch: {
      persist: clientRuntimeHandoff.persistState,
      responseMode: clientRuntimeHandoff.responseMode,
      currentPhase: clientRuntimeHandoff.current.phase,
      nextPhase: clientRuntimeHandoff.next.phase,
      resumeToken: clientRuntimeHandoff.next.resumeToken,
      previousResumeToken: clientRuntimeHandoff.next.previousResumeToken,
      lastKnownCursor: clientRuntimeHandoff.next.lastKnownCursor,
      lastKnownProofHead: clientRuntimeHandoff.next.lastKnownProofHead,
      acceptedAt: clientRuntimeHandoff.next.acceptedAt,
      completedAt: clientRuntimeHandoff.next.completedAt,
      nextVisibleAt: clientRuntimeHandoff.next.nextVisibleAt,
      patchDigest: workflowHandoffPacket.clientState.patchDigest
    },
    workflowDispatch: workflowHandoffPacket.dispatch,
    proofOutput: {
      appendable: proofCommit.appendable,
      durable: proofCommit.durable,
      commitPhase: proofCommit.commitPhase,
      receiptId: proofCommit.receiptId,
      proofHead: proofCommit.nextProofHead,
      leafDigest: proofCommit.leafDigest,
      journalState: proofCommit.journalRecord.state
    }
  };
}

function normalizeWorkflowHandoff(rawWorkflow = {}, { clientRuntime, externalHandoff, writeAdmission, scheduleState }) {
  const workflow = asPlainObject(rawWorkflow);
  const clientState = clientRuntime.state;
  const requestedTarget = WORKFLOW_HANDOFF_TARGETS.has(workflow.target)
    ? workflow.target
    : clientState.handoffPreference;
  const target = externalHandoff.enabled && requestedTarget === 'none' ? 'client-runtime' : requestedTarget;
  const requestedBy = normalizeIdentifier(workflow.requestedBy, clientRuntime.principalId);
  const ticket = normalizeBoundedString(
    workflow.ticket,
    `${clientRuntime.workflowId}:${clientRuntime.requestId}`,
    { maxLength: 160 }
  );
  const visibleState = writeAdmission.accepted
    ? clientState.expectsProviderReceipt && externalHandoff.enabled
      ? 'awaiting_provider_receipt'
      : externalHandoff.enabled
        ? 'handoff_ready'
        : clientState.optimisticAckAllowed
          ? 'optimistic_local_commit'
          : 'local_commit_ready'
    : clientState.phase === 'retrying'
      ? 'retrying_after_blocker'
      : 'needs_attention';
  const nextVisibleAt = visibleState === 'awaiting_provider_receipt'
    ? scheduleState.nextRunAt ?? clientState.lastVisibleAt
    : scheduleState.nextRunAt;
  const userMessageKey = writeAdmission.accepted
    ? visibleState === 'awaiting_provider_receipt'
      ? 'audit_write_receipt_pending'
      : visibleState === 'optimistic_local_commit'
        ? 'audit_write_optimistic_ack'
        : 'audit_write_queued'
    : clientState.phase === 'retrying'
      ? 'audit_write_retrying'
      : 'audit_write_blocked';
  const handoffState = target === 'none'
    ? 'no_client_handoff'
    : writeAdmission.accepted
      ? 'client_handoff_ready'
      : 'client_handoff_requires_attention';

  return {
    schemaVersion: 'audit.write.workflow-handoff.v1',
    target,
    visibleState,
    handoffState,
    requestedBy,
    ticket,
    route: clientRuntime.route,
    workflowId: clientRuntime.workflowId,
    clientTraceId: clientRuntime.traceId,
    clientPhase: clientState.phase,
    clientSurface: clientState.visibleSurface,
    ackPreference: clientState.ackPreference,
    resumeToken: clientState.resumeToken,
    previousResumeToken: clientState.previousResumeToken,
    continuityKey: clientState.continuityKey,
    clientSequence: clientState.clientSequence,
    nextVisibleAt,
    userMessageKey,
    expectsProviderReceipt: clientState.expectsProviderReceipt,
    optimisticAckAllowed: clientState.optimisticAckAllowed,
    lastKnownCursor: clientState.lastKnownCursor,
    lastKnownProofHead: clientState.lastKnownProofHead,
    externalProvider: externalHandoff.enabled ? externalHandoff.providerId : null
  };
}

function validateWorkflowHandoff(rawWorkflow = {}, normalizedWorkflow) {
  const workflow = asPlainObject(rawWorkflow);
  const issues = [];

  if ('target' in workflow && !WORKFLOW_HANDOFF_TARGETS.has(workflow.target)) {
    issues.push({ field: 'workflow.target', code: 'unsupported_workflow_handoff_target', applied: normalizedWorkflow.target });
  }
  if ('requestedBy' in workflow && normalizeIdentifier(workflow.requestedBy, '') !== normalizedWorkflow.requestedBy) {
    issues.push({ field: 'workflow.requestedBy', code: 'workflow_requester_normalized', applied: normalizedWorkflow.requestedBy });
  }
  if ('ticket' in workflow && normalizeBoundedString(workflow.ticket, '', { maxLength: 160 }) !== normalizedWorkflow.ticket) {
    issues.push({ field: 'workflow.ticket', code: 'workflow_ticket_normalized', applied: normalizedWorkflow.ticket });
  }

  return issues;
}

function buildClientRuntimeHandoff({
  clientRuntime,
  workflowHandoff,
  writeAdmission,
  providerHandoffReceipt,
  proofCommit,
  operationalStatus,
  nextAction,
  now
}) {
  const receiptPending = providerHandoffReceipt.state === 'receipt_pending';
  const receiptAcked = providerHandoffReceipt.state === 'receipt_acked';
  const retrying = operationalStatus.retry.retryable;
  const blocked = !writeAdmission.accepted && !retrying;
  const nextPhase = receiptAcked || proofCommit.durable
    ? 'completed'
    : receiptPending || workflowHandoff.visibleState === 'awaiting_provider_receipt'
      ? 'awaiting-receipt'
      : retrying
        ? 'retrying'
        : blocked
          ? 'blocked'
          : writeAdmission.accepted
            ? 'queued'
            : clientRuntime.state.phase;
  const resumeToken = nextPhase === clientRuntime.state.phase
    ? clientRuntime.state.resumeToken
    : `${clientRuntime.workflowId}:${clientRuntime.requestId}:${nextPhase}:${Date.parse(now)}`;
  const responseMode = workflowHandoff.clientSurface === 'background'
    ? 'silent_state_update'
    : nextAction.blocking
      ? 'blocking_user_action'
      : receiptPending
        ? 'nonblocking_receipt_watch'
        : writeAdmission.accepted
          ? 'accepted_status_update'
          : 'attention_status_update';
  const persistState = nextPhase !== clientRuntime.state.phase
    || resumeToken !== clientRuntime.state.resumeToken
    || Boolean(proofCommit.nextProofHead && proofCommit.nextProofHead !== clientRuntime.state.lastKnownProofHead)
    || Boolean(proofCommit.journalRecord.cursor && proofCommit.journalRecord.cursor !== clientRuntime.state.lastKnownCursor);

  return {
    schemaVersion: 'audit.write.client-runtime-handoff.v1',
    generatedAt: now,
    requestId: clientRuntime.requestId,
    traceId: clientRuntime.traceId,
    workflowId: clientRuntime.workflowId,
    current: {
      phase: clientRuntime.state.phase,
      resumeToken: clientRuntime.state.resumeToken,
      continuityKey: clientRuntime.state.continuityKey,
      clientSequence: clientRuntime.state.clientSequence,
      lastKnownCursor: clientRuntime.state.lastKnownCursor,
      lastKnownProofHead: clientRuntime.state.lastKnownProofHead
    },
    next: {
      phase: nextPhase,
      resumeToken,
      previousResumeToken: clientRuntime.state.resumeToken,
      clientSequence: clientRuntime.state.clientSequence + (persistState ? 1 : 0),
      lastKnownCursor: proofCommit.journalRecord.cursor ?? clientRuntime.state.lastKnownCursor,
      lastKnownProofHead: proofCommit.nextProofHead ?? clientRuntime.state.lastKnownProofHead,
      acceptedAt: writeAdmission.accepted ? clientRuntime.state.acceptedAt ?? now : clientRuntime.state.acceptedAt,
      completedAt: nextPhase === 'completed' ? clientRuntime.state.completedAt ?? now : null,
      nextVisibleAt: workflowHandoff.nextVisibleAt ?? nextAction.at ?? null
    },
    responseMode,
    persistState,
    target: workflowHandoff.target,
    visibleState: workflowHandoff.visibleState,
    userMessageKey: workflowHandoff.userMessageKey,
    ack: {
      preference: workflowHandoff.ackPreference,
      optimistic: workflowHandoff.optimisticAckAllowed && writeAdmission.accepted,
      receiptRequired: providerHandoffReceipt.receipt.required,
      receiptState: providerHandoffReceipt.receipt.state,
      proofDurable: proofCommit.durable,
      proofHead: proofCommit.nextProofHead
    }
  };
}

function buildWorkflowHandoffPacket({
  command,
  clientRuntime,
  workflowHandoff,
  clientRuntimeHandoff,
  providerHandoffReceipt,
  writeAdmission,
  operationalStatus,
  actionableErrorReport,
  validationSummary,
  proofCommit,
  nextAction,
  now
}) {
  const routeStatus = writeAdmission.accepted
    ? providerHandoffReceipt.state === 'receipt_pending'
      ? 202
      : 200
    : operationalStatus.retry.retryable
      ? 503
      : 409;
  const responseKind = routeStatus < 300 ? 'accepted' : operationalStatus.retry.retryable ? 'retryable_error' : 'blocked_error';
  const blocked = nextAction.blocking || validationSummary.errorCount > 0 || !writeAdmission.accepted;
  const target = blocked && workflowHandoff.target === 'none' ? 'operator-queue' : workflowHandoff.target;
  const dispatchAction = target === 'none'
    ? 'retain_kernel_state_only'
    : blocked
      ? 'dispatch_attention_workflow'
      : providerHandoffReceipt.state === 'receipt_pending'
        ? 'dispatch_receipt_watch'
        : proofCommit.durable
          ? 'dispatch_completion'
          : 'dispatch_buffered_status';
  const deadlineAt = providerHandoffReceipt.receipt.required
    ? providerHandoffReceipt.receipt.deadlineAt
    : clientRuntimeHandoff.next.nextVisibleAt ?? nextAction.at ?? null;
  const clientPatch = {
    phase: clientRuntimeHandoff.next.phase,
    resumeToken: clientRuntimeHandoff.next.resumeToken,
    previousResumeToken: clientRuntimeHandoff.next.previousResumeToken,
    clientSequence: clientRuntimeHandoff.next.clientSequence,
    lastKnownCursor: clientRuntimeHandoff.next.lastKnownCursor,
    lastKnownProofHead: clientRuntimeHandoff.next.lastKnownProofHead,
    acceptedAt: clientRuntimeHandoff.next.acceptedAt,
    completedAt: clientRuntimeHandoff.next.completedAt,
    nextVisibleAt: clientRuntimeHandoff.next.nextVisibleAt
  };
  const packetDigest = proofDigest({
    requestId: clientRuntime.requestId,
    traceId: clientRuntime.traceId,
    target,
    dispatchAction,
    responseMode: clientRuntimeHandoff.responseMode,
    phase: clientPatch.phase,
    resumeToken: clientPatch.resumeToken,
    proofHead: proofCommit.nextProofHead,
    receiptState: providerHandoffReceipt.state,
    routeStatus
  });
  const patchDigest = proofDigest(clientPatch);
  const primaryError = actionableErrorReport.errors.find((error) => error.blocksAdmission)
    ?? actionableErrorReport.errors[0]
    ?? null;

  return {
    schemaVersion: 'audit.write.workflow-handoff-packet.v1',
    generatedAt: now,
    packetDigest,
    route: {
      name: clientRuntime.route,
      command,
      status: routeStatus,
      responseKind
    },
    dispatch: {
      target,
      action: dispatchAction,
      ticket: workflowHandoff.ticket,
      deadlineAt,
      retryAt: operationalStatus.retry.nextRetryAt,
      blocking: blocked,
      owner: primaryError?.owner ?? (writeAdmission.accepted ? 'audit-runtime' : 'caller'),
      messageKey: primaryError?.messageKey ?? workflowHandoff.userMessageKey
    },
    userVisible: {
      surface: workflowHandoff.clientSurface,
      state: workflowHandoff.visibleState,
      responseMode: clientRuntimeHandoff.responseMode,
      messageKey: workflowHandoff.userMessageKey,
      primaryAction: actionableErrorReport.summary.primaryAction,
      validationOk: validationSummary.ok,
      nextVisibleAt: clientRuntimeHandoff.next.nextVisibleAt
    },
    clientState: {
      persist: clientRuntimeHandoff.persistState,
      patchDigest,
      currentPhase: clientRuntimeHandoff.current.phase,
      patch: clientPatch
    },
    receiptWatch: {
      required: providerHandoffReceipt.receipt.required,
      state: providerHandoffReceipt.state,
      nextAction: providerHandoffReceipt.nextAction,
      handoffId: providerHandoffReceipt.handoffId,
      deliveryId: providerHandoffReceipt.deliveryId,
      deadlineAt: providerHandoffReceipt.receipt.deadlineAt
    },
    proofReference: {
      durable: proofCommit.durable,
      commitPhase: proofCommit.commitPhase,
      receiptId: proofCommit.receiptId,
      proofHead: proofCommit.nextProofHead,
      leafDigest: proofCommit.leafDigest
    }
  };
}

function buildRecoveryCheckpoint({
  persistedState,
  recoveryPlan,
  commandIdempotency,
  writeAdmission,
  providerDelivery,
  providerHandoffReceipt,
  syncMetadata,
  proofCommit,
  now
}) {
  const durableWrite = writeAdmission.accepted && proofCommit.durable && !writeAdmission.replayed;
  const pendingWrite = writeAdmission.accepted && !proofCommit.durable && !writeAdmission.replayed;
  const replayWindow = [...new Set([
    writeAdmission.idempotencyKey,
    ...persistedState.inFlightWriteKeys
  ].filter(Boolean))].slice(0, 100);
  const barriers = [
    ...(recoveryPlan.cursorMismatch ? ['provider_cursor_reconcile_required'] : []),
    ...(recoveryPlan.mode === 'manual-review' ? ['manual_recovery_review_required'] : []),
    ...(providerHandoffReceipt.blockedBy.length > 0 ? ['provider_receipt_or_handoff_blocked'] : []),
    ...(writeAdmission.proofDeferred ? ['proof_rebuild_required'] : []),
    ...(pendingWrite && providerDelivery.commitStrategy === 'two-phase' ? ['two_phase_commit_pending_receipt'] : [])
  ];
  const commandAlreadyApplied = commandIdempotency.replayed;
  const canResumeAutomatically = barriers.length === 0 && recoveryPlan.mode !== 'manual-review';
  const checkpointCursor = durableWrite
    ? syncMetadata.nextCursor
    : commandIdempotency.matchedCursor ?? persistedState.durableCursor;
  const checkpointProofHead = durableWrite || proofCommit.commitPhase === 'prepared'
    ? proofCommit.nextProofHead
    : commandIdempotency.matchedProofHead ?? persistedState.proofHead;
  const checkpointId = proofDigest({
    bootEpoch: persistedState.bootEpoch,
    commandKey: commandIdempotency.commandKey,
    idempotencyKey: writeAdmission.idempotencyKey,
    cursor: checkpointCursor,
    proofHead: checkpointProofHead,
    recoveryMode: recoveryPlan.mode,
    receiptState: providerHandoffReceipt.state,
    durableWrite
  });

  return {
    schemaVersion: 'audit.write.recovery-checkpoint.v1',
    checkpointId,
    generatedAt: now,
    bootEpoch: persistedState.bootEpoch,
    intent: recoveryPlan.mode === 'manual-review'
      ? 'manual_review'
      : recoveryPlan.cursorMismatch
        ? 'reconcile_cursor'
        : recoveryPlan.required
          ? 'resume_recovery'
          : 'steady_state',
    canResumeAutomatically,
    barriers: [...new Set(barriers)],
    command: {
      key: commandIdempotency.commandKey,
      effect: commandIdempotency.effect,
      alreadyApplied: commandAlreadyApplied,
      matchedAppliedAt: commandIdempotency.matchedAppliedAt
    },
    write: {
      idempotencyKey: writeAdmission.idempotencyKey,
      accepted: writeAdmission.accepted,
      durable: durableWrite,
      pending: pendingWrite,
      replayed: writeAdmission.replayed,
      receiptState: providerHandoffReceipt.state,
      commitPhase: proofCommit.commitPhase
    },
    resumeFrom: {
      cursor: checkpointCursor,
      proofHead: checkpointProofHead,
      segmentId: persistedState.pendingSegmentId,
      replayWindow
    },
    recovery: {
      required: recoveryPlan.required,
      mode: recoveryPlan.mode,
      pendingActions: recoveryPlan.pendingActions,
      duplicateWrite: recoveryPlan.duplicateWrite,
      cursorMismatch: recoveryPlan.cursorMismatch
    }
  };
}

function buildProofRecord({
  command,
  settings,
  scheduleState,
  now,
  evidence,
  clientRuntime,
  writeAdmission,
  accessBoundary,
  accessDecision,
  operationalStatus
}) {
  const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;

  return {
    proofType: 'hosted-kernel-audit-write-lifecycle',
    surfaceId,
    command,
    generatedAt: now,
    settingsDigest: {
      enabled: settings.enabled,
      auditLevel: settings.auditLevel,
      proofRequired: settings.proofRequired,
      retentionDays: settings.retentionDays,
      maxBufferedWrites: settings.maxBufferedWrites,
      flushIntervalMs: settings.flushIntervalMs
    },
    schedule: {
      mode: scheduleState.mode,
      requestedMode: scheduleState.requestedMode,
      active: scheduleState.active,
      nextRunAt: scheduleState.nextRunAt,
      reason: scheduleState.reason,
      lifecycleBlockedBy: scheduleState.guard?.blockedBy ?? []
    },
    request: {
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      principalId: clientRuntime.principalId,
      workflowId: clientRuntime.workflowId,
      clientPhase: clientRuntime.state.phase,
      resumeToken: clientRuntime.state.resumeToken,
      continuityKey: clientRuntime.state.continuityKey
    },
    boundary: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      scopeKey: accessDecision.scopeKey,
      subject: accessDecision.subject,
      allowed: accessDecision.allowed,
      denied: accessDecision.denied
    },
    write: {
      accepted: writeAdmission.accepted,
      degraded: writeAdmission.degraded,
      proofDeferred: writeAdmission.proofDeferred,
      targetStream: writeAdmission.targetStream,
      operation: writeAdmission.operation,
      idempotencyKey: writeAdmission.idempotencyKey,
      recordCount: writeAdmission.recordCount
    },
    operational: {
      status: operationalStatus.status,
      retryable: operationalStatus.retry.retryable,
      nextRetryAt: operationalStatus.retry.nextRetryAt,
      actionableErrorCount: operationalStatus.actionableErrors.length,
      remediationId: operationalStatus.healthRemediation.remediationId,
      remediationAction: operationalStatus.healthRemediation.primaryAction,
      providerSafeMode: operationalStatus.healthRemediation.providerSafeMode.deliveryRoute
    },
    evidenceCount
  };
}

function stableProofPayload(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableProofPayload).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableProofPayload(value[key])}`).join(',')}}`;
}

function proofDigest(value) {
  return `sha256:${createHash('sha256').update(stableProofPayload(value)).digest('hex')}`;
}

function buildHostedKernelProofCommit({
  command,
  now,
  persistedState,
  writeAdmission,
  providerDelivery,
  providerServiceContract,
  providerHandoffReceipt,
  syncMetadata,
  accessDecision,
  operationalStatus,
  proof
}) {
  const shouldAppend = writeAdmission.accepted && !writeAdmission.replayed;
  const previousProofHead = persistedState.proofHead ?? 'genesis';
  const leafPayload = {
    surfaceId,
    command,
    generatedAt: now,
    previousProofHead,
    idempotencyKey: writeAdmission.idempotencyKey,
    targetStream: writeAdmission.targetStream,
    operation: writeAdmission.operation,
    recordCount: writeAdmission.recordCount,
    payloadBytes: writeAdmission.payloadBytes,
    deliveryId: providerDelivery.deliveryId,
    handoffId: providerDelivery.handoffId,
    cursor: syncMetadata.nextCursor,
    scopeKey: accessDecision.scopeKey,
    proofType: proof.proofType
  };
  const leafDigest = proofDigest(leafPayload);
  const nextProofHead = shouldAppend
    ? proofDigest({ previousProofHead, leafDigest, deliveryId: providerDelivery.deliveryId })
    : previousProofHead === 'genesis'
      ? null
      : previousProofHead;
  const commitPhase = !writeAdmission.accepted
    ? 'rejected'
    : writeAdmission.replayed
      ? 'deduplicated'
      : providerDelivery.commitStrategy === 'two-phase'
        ? 'prepared'
        : 'committed';
  const durable = shouldAppend
    && providerServiceContract.ready
    && !operationalStatus.retry.retryable
    && providerHandoffReceipt.blockedBy.length === 0;

  return {
    schemaVersion: 'audit.write.hosted-kernel-proof-commit.v1',
    generatedAt: now,
    appendable: shouldAppend,
    durable,
    commitPhase,
    previousProofHead: previousProofHead === 'genesis' ? null : previousProofHead,
    leafDigest: shouldAppend ? leafDigest : null,
    nextProofHead,
    receiptId: shouldAppend ? `${providerDelivery.deliveryId}:${leafDigest}` : null,
    journalRecord: {
      schemaVersion: 'audit.write.journal-record.v1',
      state: commitPhase,
      targetStream: writeAdmission.targetStream,
      operation: writeAdmission.operation,
      idempotencyKey: writeAdmission.idempotencyKey,
      recordCount: writeAdmission.recordCount,
      payloadBytes: writeAdmission.payloadBytes,
      partitionKey: providerDelivery.partitionKey,
      batchOrdinal: providerDelivery.batchOrdinal,
      deliveryId: providerDelivery.deliveryId,
      handoffId: providerDelivery.handoffId,
      cursor: syncMetadata.nextCursor,
      proofHead: nextProofHead,
      receiptDeadlineAt: providerDelivery.receiptDeadlineAt,
      blockedBy: [
        ...providerServiceContract.blockers,
        ...providerHandoffReceipt.blockedBy,
        ...writeAdmission.blockers
      ]
    }
  };
}

function shapeNextPersistedState({
  persistedState,
  lifecycle,
  command,
  commandIdempotency,
  writeAdmission,
  syncMetadata,
  recoveryPlan,
  proofCommit,
  recoveryCheckpoint,
  now
}) {
  const newlyBuffered = writeAdmission.bufferSlotReserved && !proofCommit.durable
    ? writeAdmission.recordCount
    : 0;
  const newlyCommitted = writeAdmission.accepted && proofCommit.durable && !writeAdmission.replayed
    ? writeAdmission.recordCount
    : 0;
  const durableKeySettled = newlyCommitted > 0;
  const retainedInFlightKeys = durableKeySettled
    ? persistedState.inFlightWriteKeys.filter((key) => key !== writeAdmission.idempotencyKey)
    : persistedState.inFlightWriteKeys;
  const nextInFlightWriteKeys = writeAdmission.bufferSlotReserved && !durableKeySettled
    ? [...new Set([writeAdmission.idempotencyKey, ...retainedInFlightKeys])].slice(0, 100)
    : retainedInFlightKeys;
  const nextBufferedWrites = Math.max(
    0,
    Math.min(
      persistedState.bufferedWrites + newlyBuffered - newlyCommitted,
      1000000
    )
  );
  const nextCommandEntry = {
    command,
    commandKey: commandIdempotency.commandKey,
    appliedAt: commandIdempotency.replayed ? commandIdempotency.matchedAppliedAt : now,
    result: commandIdempotency.replayed ? 'replayed' : 'applied',
    cursor: syncMetadata.nextCursor ?? persistedState.durableCursor,
    proofHead: proofCommit.nextProofHead ?? commandIdempotency.matchedProofHead ?? persistedState.proofHead
  };
  const recoveredAt = recoveryCheckpoint.canResumeAutomatically && !recoveryPlan.required
    ? recoveryPlan.recoveredAt ?? now
    : null;

  return {
    schemaVersion: 'audit.write.state.v1',
    status: lifecycle.settings.enabled
      ? recoveryPlan.mode === 'manual-review'
        ? 'blocked'
        : !recoveryCheckpoint.canResumeAutomatically
          ? 'recovering'
        : writeAdmission.degraded
          ? 'degraded'
          : recoveryPlan.required
          ? 'recovering'
          : 'ready'
      : 'disabled',
    recoveryMode: recoveryPlan.mode,
    bootEpoch: persistedState.bootEpoch,
    recoveredAt,
    lastAppliedCommand: command,
    lastAppliedCommandKey: commandIdempotency.commandKey,
    lastAppliedAt: commandIdempotency.replayed ? commandIdempotency.matchedAppliedAt : now,
    lastFlushAt: command === 'flush' && !commandIdempotency.replayed ? now : persistedState.lastFlushAt,
    lastRotationAt: command === 'rotate' && !commandIdempotency.replayed ? now : persistedState.lastRotationAt,
    durableCursor: syncMetadata.nextCursor ?? persistedState.durableCursor,
    proofHead: proofCommit.nextProofHead ?? commandIdempotency.matchedProofHead ?? persistedState.proofHead,
    pendingSegmentId: command === 'rotate' && !commandIdempotency.replayed
      ? `${surfaceId}:segment:${Date.parse(now)}`
      : persistedState.pendingSegmentId,
    bufferedWrites: nextBufferedWrites,
    committedWrites: Math.min(persistedState.committedWrites + newlyCommitted, 1000000000),
    failedWrites: writeAdmission.accepted ? persistedState.failedWrites : Math.min(persistedState.failedWrites + 1, 1000000),
    inFlightWriteKeys: nextInFlightWriteKeys,
    recentCommands: [nextCommandEntry, ...persistedState.recentCommands]
      .filter((entry) => entry.commandKey)
      .slice(0, 20)
  };
}

function buildRestartSafeStatus({
  lifecycle,
  commandIdempotency,
  recoveryPlan,
  writeAdmission,
  proofCommit,
  recoveryCheckpoint,
  nextPersistedState
}) {
  const replayProtected = writeAdmission.replayed
    || nextPersistedState.inFlightWriteKeys.includes(writeAdmission.idempotencyKey)
    || proofCommit.durable;
  const restartSafe = recoveryCheckpoint.canResumeAutomatically
    && (!writeAdmission.accepted || replayProtected);

  return {
    schemaVersion: 'audit.write.restart-safe-status.v1',
    status: nextPersistedState.status,
    acceptsNewWrites: lifecycle.settings.enabled && recoveryPlan.mode !== 'manual-review' && recoveryCheckpoint.canResumeAutomatically,
    restartSafe,
    commandEffect: commandIdempotency.effect,
    commandKey: commandIdempotency.commandKey,
    duplicateWrite: writeAdmission.replayed,
    replayProtected,
    checkpointId: recoveryCheckpoint.checkpointId,
    resumeIntent: recoveryCheckpoint.intent,
    restartBarriers: recoveryCheckpoint.barriers,
    persistedStatusReason: restartSafe
      ? proofCommit.durable
        ? 'durable_commit_recorded'
        : writeAdmission.accepted
          ? 'inflight_key_recorded'
          : 'no_accepted_write_to_resume'
      : recoveryCheckpoint.barriers[0] ?? 'idempotency_replay_window_missing',
    pendingRecoveryActions: recoveryPlan.pendingActions,
    persistedCursor: nextPersistedState.durableCursor,
    proofHead: nextPersistedState.proofHead,
    bufferedWrites: nextPersistedState.bufferedWrites,
    committedWrites: nextPersistedState.committedWrites,
    inFlightWriteCount: nextPersistedState.inFlightWriteKeys.length
  };
}

function normalizeAnalyticsSnapshot(value) {
  const snapshot = asPlainObject(value);
  const observedAt = normalizeOptionalTimestamp(snapshot.observedAt);
  const acceptedWrites = coerceInteger(snapshot.acceptedWrites, 0, { min: 0, max: 1000000000 });
  const blockedWrites = coerceInteger(snapshot.blockedWrites, 0, { min: 0, max: 1000000000 });
  const totalWrites = acceptedWrites + blockedWrites;

  return {
    observedAt,
    status: OPERATIONAL_HEALTH_STATES.has(snapshot.status) ? snapshot.status : 'healthy',
    acceptedWrites,
    blockedWrites,
    bufferedWrites: coerceInteger(snapshot.bufferedWrites, 0, { min: 0, max: 1000000 }),
    proofDeferredWrites: coerceInteger(snapshot.proofDeferredWrites, 0, { min: 0, max: 1000000000 }),
    retryableFailures: coerceInteger(snapshot.retryableFailures, 0, { min: 0, max: 1000000000 }),
    primaryAction: normalizeIdentifier(snapshot.primaryAction, 'none'),
    blockedRatio: totalWrites === 0
      ? 0
      : Number((blockedWrites / totalWrites).toFixed(4))
  };
}

function normalizeAnalyticsInput(rawAnalytics = {}) {
  const analytics = asPlainObject(rawAnalytics);
  const counters = asPlainObject(analytics.counters);
  const history = Array.isArray(analytics.history)
    ? analytics.history.map(normalizeAnalyticsSnapshot).filter((snapshot) => snapshot.observedAt).slice(0, 24)
    : [];
  const exportOptions = asPlainObject(analytics.export);

  return {
    schemaVersion: 'audit.write.analytics-input.v1',
    counters: {
      acceptedWrites: coerceInteger(counters.acceptedWrites, 0, { min: 0, max: 1000000000 }),
      blockedWrites: coerceInteger(counters.blockedWrites, 0, { min: 0, max: 1000000000 }),
      replayedWrites: coerceInteger(counters.replayedWrites, 0, { min: 0, max: 1000000000 }),
      proofDeferredWrites: coerceInteger(counters.proofDeferredWrites, 0, { min: 0, max: 1000000000 }),
      handoffReadyWrites: coerceInteger(counters.handoffReadyWrites, 0, { min: 0, max: 1000000000 }),
      retryableFailures: coerceInteger(counters.retryableFailures, 0, { min: 0, max: 1000000000 }),
      validationIssueTotal: coerceInteger(counters.validationIssueTotal, 0, { min: 0, max: 1000000000 })
    },
    history,
    export: {
      format: ANALYTICS_EXPORT_FORMATS.has(exportOptions.format) ? exportOptions.format : 'json',
      includeHistory: coerceBoolean(exportOptions.includeHistory, true),
      includeTimeline: coerceBoolean(exportOptions.includeTimeline, true),
      includeProofDigest: coerceBoolean(exportOptions.includeProofDigest, true),
      maxHistory: coerceInteger(exportOptions.maxHistory, 25, { min: 1, max: 100 }),
      reportId: normalizeIdentifier(exportOptions.reportId, `${surfaceId}:analytics-report`),
      windowStartedAt: normalizeOptionalTimestamp(exportOptions.windowStartedAt),
      windowEndedAt: normalizeOptionalTimestamp(exportOptions.windowEndedAt)
    }
  };
}

function buildAnalyticsTimelineEvents({
  now,
  delta,
  clientRuntime,
  writeAdmission,
  operationalStatus,
  scheduleState,
  externalHandoff,
  validationIssues
}) {
  const eventCandidates = [
    {
      type: writeAdmission.accepted ? 'write-accepted' : 'write-blocked',
      count: writeAdmission.accepted ? delta.acceptedWrites : delta.blockedWrites,
      at: now,
      state: writeAdmission.state,
      detail: writeAdmission.accepted ? writeAdmission.flushPolicy : writeAdmission.blockers[0] ?? 'blocked'
    },
    {
      type: 'proof-deferred',
      count: delta.proofDeferredWrites,
      at: now,
      state: writeAdmission.proofDeferred ? 'active' : 'inactive',
      detail: writeAdmission.proofDeferred ? 'proof_rebuild_required_before_durable_commit' : null
    },
    {
      type: 'handoff-ready',
      count: delta.handoffReadyWrites,
      at: scheduleState.nextRunAt ?? now,
      state: externalHandoff.state,
      detail: externalHandoff.enabled ? externalHandoff.endpoint : externalHandoff.blockedBy[0] ?? null
    },
    {
      type: 'retry-scheduled',
      count: delta.retryableFailures,
      at: operationalStatus.retry.nextRetryAt ?? now,
      state: operationalStatus.retry.retryable ? 'scheduled' : 'inactive',
      detail: operationalStatus.retry.retryable ? `attempt_${operationalStatus.retry.attempt + 1}` : null
    },
    {
      type: 'validation-observed',
      count: validationIssues.length,
      at: now,
      state: validationIssues.length > 0 ? 'observed' : 'clean',
      detail: validationIssues[0]?.code ?? null
    }
  ];

  return eventCandidates
    .filter((event) => ANALYTICS_TIMELINE_EVENT_TYPES.has(event.type))
    .filter((event) => event.count > 0 || event.state !== 'inactive')
    .map((event, index) => ({
      schemaVersion: 'audit.write.analytics-timeline-event.v1',
      eventId: `${surfaceId}:analytics:${Date.parse(now)}:${index + 1}`,
      requestId: clientRuntime.requestId,
      traceId: clientRuntime.traceId,
      targetStream: writeAdmission.targetStream,
      type: event.type,
      at: event.at,
      state: event.state,
      count: event.count,
      detail: event.detail
    }));
}

function buildAnalyticsTrendSummary(history) {
  const newest = history[0] ?? null;
  const previous = history[1] ?? null;
  const oldest = history[history.length - 1] ?? null;

  return {
    schemaVersion: 'audit.write.analytics-trend.v1',
    sampleCount: history.length,
    windowStartedAt: oldest?.observedAt ?? newest?.observedAt ?? null,
    windowEndedAt: newest?.observedAt ?? null,
    acceptedDelta: newest && previous ? newest.acceptedWrites - previous.acceptedWrites : newest?.acceptedWrites ?? 0,
    blockedDelta: newest && previous ? newest.blockedWrites - previous.blockedWrites : newest?.blockedWrites ?? 0,
    bufferedDelta: newest && previous ? newest.bufferedWrites - previous.bufferedWrites : newest?.bufferedWrites ?? 0,
    proofDeferredDelta: newest && previous ? newest.proofDeferredWrites - previous.proofDeferredWrites : newest?.proofDeferredWrites ?? 0,
    retryableFailureDelta: newest && previous ? newest.retryableFailures - previous.retryableFailures : newest?.retryableFailures ?? 0,
    blockedRatioTrend: newest && previous
      ? Number((newest.blockedRatio - previous.blockedRatio).toFixed(4))
      : newest?.blockedRatio ?? 0,
    latestPrimaryAction: newest?.primaryAction ?? 'none',
    previousPrimaryAction: previous?.primaryAction ?? null
  };
}

function buildAnalyticsExportSummary({
  analytics,
  counters,
  delta,
  history,
  trend,
  timelineEvents,
  exportRecord,
  proofDigestValue
}) {
  const windowStartedAt = analytics.export.windowStartedAt ?? trend.windowStartedAt;
  const windowEndedAt = analytics.export.windowEndedAt ?? trend.windowEndedAt;
  const totalWrites = counters.acceptedWrites + counters.blockedWrites;
  const blockedRatio = totalWrites === 0
    ? 0
    : Number((counters.blockedWrites / totalWrites).toFixed(4));

  return {
    schemaVersion: 'audit.write.analytics-export-summary.v1',
    reportId: analytics.export.reportId,
    format: analytics.export.format,
    window: {
      startedAt: windowStartedAt,
      endedAt: windowEndedAt,
      sampleCount: history.length
    },
    totals: {
      ...counters,
      totalWrites,
      blockedRatio
    },
    latestDelta: delta,
    trend,
    proofDigest: analytics.export.includeProofDigest ? proofDigestValue : null,
    includes: {
      history: analytics.export.includeHistory,
      timeline: analytics.export.includeTimeline,
      proofDigest: analytics.export.includeProofDigest
    },
    timelineEventCount: timelineEvents.length,
    exportRecord
  };
}

function buildAuditWriteAnalytics({
  rawAnalytics,
  now,
  command,
  clientRuntime,
  accessDecision,
  provider,
  writeAdmission,
  operationalStatus,
  validationIssues,
  nextPersistedState,
  scheduleState,
  externalHandoff,
  proof
}) {
  const analytics = normalizeAnalyticsInput(rawAnalytics);
  const delta = {
    acceptedWrites: writeAdmission.accepted && !writeAdmission.replayed ? writeAdmission.recordCount : 0,
    blockedWrites: writeAdmission.accepted ? 0 : Math.max(1, writeAdmission.recordCount),
    replayedWrites: writeAdmission.replayed ? Math.max(1, writeAdmission.recordCount) : 0,
    proofDeferredWrites: writeAdmission.proofDeferred ? Math.max(1, writeAdmission.recordCount) : 0,
    handoffReadyWrites: externalHandoff.enabled && writeAdmission.accepted ? Math.max(1, writeAdmission.recordCount) : 0,
    retryableFailures: operationalStatus.retry.retryable ? 1 : 0,
    validationIssueTotal: validationIssues.length
  };
  const counters = Object.fromEntries(
    Object.entries(analytics.counters).map(([key, value]) => [key, value + (delta[key] ?? 0)])
  );
  const currentSnapshot = {
    observedAt: now,
    status: operationalStatus.status,
    acceptedWrites: counters.acceptedWrites,
    blockedWrites: counters.blockedWrites,
    bufferedWrites: nextPersistedState.bufferedWrites,
    proofDeferredWrites: counters.proofDeferredWrites,
    retryableFailures: counters.retryableFailures,
    primaryAction: operationalStatus.actionableErrors[0]?.action ?? 'none',
    blockedRatio: counters.acceptedWrites + counters.blockedWrites === 0
      ? 0
      : Number((counters.blockedWrites / (counters.acceptedWrites + counters.blockedWrites)).toFixed(4))
  };
  const history = [currentSnapshot, ...analytics.history]
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
    .slice(0, analytics.export.maxHistory);
  const blockedRatio = counters.acceptedWrites + counters.blockedWrites === 0
    ? 0
    : Number((counters.blockedWrites / (counters.acceptedWrites + counters.blockedWrites)).toFixed(4));
  const timelineEvents = buildAnalyticsTimelineEvents({
    now,
    delta,
    clientRuntime,
    writeAdmission,
    operationalStatus,
    scheduleState,
    externalHandoff,
    validationIssues
  });
  const trend = buildAnalyticsTrendSummary(history);
  const proofDigestValue = analytics.export.includeProofDigest ? proofDigest(proof) : null;
  const exportRecord = {
    reportId: analytics.export.reportId,
    surfaceId,
    generatedAt: now,
    requestId: clientRuntime.requestId,
    traceId: clientRuntime.traceId,
    command,
    tenantScope: accessDecision.scopeKey,
    providerId: provider.providerId,
    status: operationalStatus.status,
    accepted: writeAdmission.accepted,
    targetStream: writeAdmission.targetStream,
    recordCount: writeAdmission.recordCount,
    payloadBytes: writeAdmission.payloadBytes,
    blockedRatio,
    nextRunAt: scheduleState.nextRunAt,
    proofType: analytics.export.includeProofDigest ? proof.proofType : null,
    proofDigest: proofDigestValue,
    historySamples: history.length,
    timelineEvents: timelineEvents.length,
    latestPrimaryAction: trend.latestPrimaryAction
  };
  const exportSummary = buildAnalyticsExportSummary({
    analytics,
    counters,
    delta,
    history,
    trend,
    timelineEvents,
    exportRecord,
    proofDigestValue
  });

  return {
    schemaVersion: 'audit.write.analytics.v1',
    input: analytics,
    delta,
    counters,
    currentSnapshot,
    history: analytics.export.includeHistory ? history : [currentSnapshot],
    trend,
    timeline: {
      generatedAt: now,
      nextRunAt: scheduleState.nextRunAt,
      retryAt: operationalStatus.retry.nextRetryAt,
      handoffState: externalHandoff.state,
      lastObservedAt: history[1]?.observedAt ?? null,
      events: analytics.export.includeTimeline ? timelineEvents : []
    },
    export: {
      format: analytics.export.format,
      ready: true,
      summary: exportSummary,
      record: exportRecord,
      csvHeaders: Object.keys(exportRecord),
      csvRow: Object.values(exportRecord).map((value) => value === null ? '' : String(value)),
      ndjsonLine: JSON.stringify(exportRecord)
    }
  };
}

export function describeAuditWriteSurface(input = {}) {
  const request = asPlainObject(input);
  const now = normalizeTimestamp(request.now);
  const command = normalizeLifecycleCommand(request.command);
  const commandIssues = validateLifecycleCommand(request.command, command);
  const clientRuntime = normalizeClientRuntime(request.client, now);
  const writeEnvelope = normalizeWriteEnvelope(request.write, clientRuntime);
  const accessBoundary = normalizeAccessBoundary(request.access, { clientRuntime, writeEnvelope });
  const normalizedSettings = normalizeSettings(request.settings);
  const lifecycleControls = normalizeLifecycleControls(request.lifecycleControls, normalizedSettings, now);
  const lifecycleControlDecision = buildLifecycleControlDecision(command, normalizedSettings, lifecycleControls, now);
  const provider = normalizeProvider(request.provider);
  const persistedState = normalizePersistedAuditState(request.state, now);
  const commandKey = buildLifecycleCommandKey({ request, command, clientRuntime });
  const commandIdempotency = resolveLifecycleIdempotency({ command, commandKey, persistedState });
  const requestedCapabilities = normalizeRequestedCapabilities(request.requestedCapabilities);
  const lifecycle = applyLifecycleCommand(command, normalizedSettings, lifecycleControlDecision);
  const providerDelivery = normalizeProviderDelivery(request.provider, {
    provider,
    writeEnvelope,
    accessBoundary,
    settings: lifecycle.settings,
    now
  });
  const deliveryRequestedCapabilities = expandCapabilitiesForDelivery(requestedCapabilities, providerDelivery);
  const capabilityNegotiation = negotiateCapabilities(provider, deliveryRequestedCapabilities, lifecycle.settings);
  const accessDecision = buildAccessDecision({ accessBoundary, writeEnvelope, command, provider });
  const operationalHealth = normalizeOperationalHealth(request.health, now);
  const operationalPolicy = buildOperationalPolicy({
    health: operationalHealth,
    capabilityNegotiation,
    settings: lifecycle.settings,
    persistedState,
    now
  });
  const baseValidationIssues = [
    ...commandIssues,
    ...validateClientRuntime(request.client, clientRuntime),
    ...validateWriteEnvelope(request.write, writeEnvelope),
    ...validateAccessBoundary(request.access, accessBoundary),
    ...validateSettings(request.settings, lifecycle.settings),
    ...validateLifecycleControls(request.lifecycleControls, lifecycleControls),
    ...lifecycleControlDecision.blockedBy.map((blocker) => ({
      field: 'lifecycleControls',
      code: 'lifecycle_command_blocked',
      value: blocker
    })),
    ...validateProvider(request.provider, provider),
    ...validateProviderDelivery(request.provider, providerDelivery),
    ...validatePersistedAuditState(request.state, persistedState),
    ...validateOperationalHealth(request.health, operationalHealth),
    ...capabilityNegotiation.blockingMissing
      .filter((capability) => !(capability === 'proof-chain' && operationalPolicy.proofDeferred))
      .map((capability) => ({
      field: 'requestedCapabilities',
      code: 'required_capability_unavailable',
      value: capability
    }))
  ];
  const scheduleState = buildScheduleState(lifecycle.settings, command, now, lifecycleControlDecision);
  const recoveryPlan = buildRecoveryPlan({
    persistedState,
    provider,
    capabilityNegotiation,
    writeEnvelope,
    settings: lifecycle.settings,
    operationalPolicy,
    now
  });
  const syncMetadata = buildSyncMetadata({
    provider,
    capabilityNegotiation,
    command,
    settings: lifecycle.settings,
    now
  });
  const providerReceiptCallback = normalizeProviderReceiptCallback(request.provider, {
    provider,
    providerDelivery,
    syncMetadata,
    now
  });
  const externalHandoff = buildExternalHandoffState({
    provider,
    capabilityNegotiation,
    scheduleState,
    settings: lifecycle.settings,
    command,
    accessDecision
  });
  const providerServiceContract = buildProviderServiceContract({
    provider,
    providerDelivery,
    capabilityNegotiation,
    settings: lifecycle.settings,
    accessBoundary,
    accessDecision,
    writeEnvelope,
    syncMetadata,
    externalHandoff,
    receiptCallback: providerReceiptCallback,
    operationalPolicy,
    now
  });
  const contractValidationIssues = validateProviderServiceContract(providerServiceContract);
  const admissionValidationIssues = [
    ...baseValidationIssues,
    ...validateProviderReceiptCallback(request.provider, providerReceiptCallback),
    ...contractValidationIssues
  ];
  const writeAdmission = buildWriteAdmission({
    settings: lifecycle.settings,
    capabilityNegotiation,
    writeEnvelope,
    scheduleState,
    validationIssues: admissionValidationIssues,
    recoveryPlan,
    accessDecision,
    operationalPolicy,
    lifecycleControlDecision,
    providerServiceContract
  });
  const workflowHandoff = normalizeWorkflowHandoff(request.workflow, {
    clientRuntime,
    externalHandoff,
    writeAdmission,
    scheduleState
  });
  const validationIssues = [
    ...admissionValidationIssues,
    ...validateWorkflowHandoff(request.workflow, workflowHandoff)
  ];
  const operationalStatus = buildOperationalStatus({
    health: operationalHealth,
    operationalPolicy,
    writeAdmission,
    validationIssues,
    recoveryPlan,
    externalHandoff,
    providerDelivery,
    providerServiceContract,
    now
  });
  const providerHandoffReceipt = buildProviderHandoffReceiptContract({
    provider,
    providerDelivery,
    providerServiceContract,
    receiptCallback: providerReceiptCallback,
    externalHandoff,
    syncMetadata,
    writeAdmission,
    operationalStatus,
    now
  });
  const actionableErrorReport = buildActionableErrorReport({
    clientRuntime,
    command,
    writeEnvelope,
    accessDecision,
    providerServiceContract,
    operationalStatus,
    validationIssues,
    now
  });
  const evidence = Array.isArray(request.evidence) ? request.evidence : [];
  const nextAction = buildNextAction(command, lifecycle.settings, validationIssues, scheduleState, operationalStatus, lifecycleControlDecision);
  const proof = buildProofRecord({
    command,
    settings: lifecycle.settings,
    scheduleState,
    now,
    evidence,
    clientRuntime,
    writeAdmission,
    accessBoundary,
    accessDecision,
    operationalStatus
  });
  const proofCommit = buildHostedKernelProofCommit({
    command,
    now,
    persistedState,
    writeAdmission,
    providerDelivery,
    providerServiceContract,
    providerHandoffReceipt,
    syncMetadata,
    accessDecision,
    operationalStatus,
    proof
  });
  const recoveryCheckpoint = buildRecoveryCheckpoint({
    persistedState,
    recoveryPlan,
    commandIdempotency,
    writeAdmission,
    providerDelivery,
    providerHandoffReceipt,
    syncMetadata,
    proofCommit,
    now
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    clientRuntime,
    workflowHandoff,
    writeAdmission,
    providerHandoffReceipt,
    proofCommit,
    operationalStatus,
    nextAction,
    now
  });
  const validationSummary = summarizeValidationForClient(validationIssues);
  const workflowHandoffPacket = buildWorkflowHandoffPacket({
    command,
    clientRuntime,
    workflowHandoff,
    clientRuntimeHandoff,
    providerHandoffReceipt,
    writeAdmission,
    operationalStatus,
    actionableErrorReport,
    validationSummary,
    proofCommit,
    nextAction,
    now
  });
  const preview = buildRoutePreviewContract({
    command,
    clientRuntime,
    writeEnvelope,
    accessBoundary,
    accessDecision,
    provider,
    providerDelivery,
    providerServiceContract,
    providerHandoffReceipt,
    workflowHandoff,
    clientRuntimeHandoff,
    workflowHandoffPacket,
    scheduleState,
    writeAdmission,
    operationalStatus,
    actionableErrorReport,
    validationSummary,
    nextAction,
    proofCommit,
    now
  });
  const routeAcceptanceReadiness = buildClientAcceptanceReadinessContract({
    command,
    clientRuntime,
    writeEnvelope,
    accessDecision,
    providerServiceContract,
    providerHandoffReceipt,
    writeAdmission,
    operationalStatus,
    actionableErrorReport,
    validationIssues,
    validationSummary,
    preview,
    proofCommit,
    clientRuntimeHandoff,
    workflowHandoffPacket,
    nextAction,
    now
  });
  const nextPersistedState = shapeNextPersistedState({
    persistedState,
    lifecycle,
    command,
    commandIdempotency,
    writeAdmission,
    syncMetadata,
    recoveryPlan,
    proofCommit,
    recoveryCheckpoint,
    now
  });
  const restartStatus = buildRestartSafeStatus({
    lifecycle,
    commandIdempotency,
    recoveryPlan,
    writeAdmission,
    proofCommit,
    recoveryCheckpoint,
    nextPersistedState
  });
  const analytics = buildAuditWriteAnalytics({
    rawAnalytics: request.analytics,
    now,
    command,
    clientRuntime,
    accessDecision,
    provider,
    writeAdmission,
    operationalStatus,
    validationIssues,
    nextPersistedState,
    scheduleState,
    externalHandoff,
    proof
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel audit-write lifecycle control and proof contract',
    command,
    commandIdempotency,
    client: clientRuntime,
    access: {
      boundary: accessBoundary,
      decision: accessDecision
    },
    settings: lifecycle.settings,
    provider,
    providerContracts: {
      delivery: providerDelivery,
      service: providerServiceContract,
      receiptCallback: providerReceiptCallback,
      handoffReceipt: providerHandoffReceipt
    },
    health: {
      input: operationalHealth,
      policy: operationalPolicy,
      status: operationalStatus,
      actionableErrorReport
    },
    capabilities: capabilityNegotiation,
    validation: {
      ok: validationIssues.length === 0,
      summary: validationSummary,
      issues: validationIssues
    },
    lifecycle: {
      enabled: lifecycle.settings.enabled,
      events: lifecycle.events,
      acceptsWrites: lifecycle.settings.enabled,
      requiresProof: lifecycle.settings.proofRequired,
      blocked: lifecycle.blocked,
      blockedBy: lifecycle.blockedBy,
      controls: lifecycleControls,
      controlDecision: lifecycleControlDecision
    },
    scheduling: scheduleState,
    preview,
    routeContracts: {
      acceptanceReadiness: routeAcceptanceReadiness,
      workflowHandoffPacket
    },
    state: {
      input: persistedState,
      recovery: recoveryPlan,
      recoveryCheckpoint,
      next: nextPersistedState,
      restartStatus
    },
    nextAction,
    audit: {
      channel: 'syscall-layer.audit-write',
      writePolicy: lifecycle.settings.enabled ? 'append_with_proof' : 'reject_until_enabled',
      bufferLimit: lifecycle.settings.maxBufferedWrites,
      retentionDays: lifecycle.settings.retentionDays,
      admission: writeAdmission,
      hostedKernelWrite: {
        schemaVersion: 'audit.write.hosted-kernel-write.v1',
        accepted: writeAdmission.accepted,
        appendable: proofCommit.appendable,
        durable: proofCommit.durable,
        commitPhase: proofCommit.commitPhase,
        receiptId: proofCommit.receiptId,
        proofHead: proofCommit.nextProofHead,
        journalRecord: proofCommit.journalRecord
      },
      actionableErrors: actionableErrorReport
    },
    sync: syncMetadata,
    externalHandoff,
    workflowHandoff,
    clientRuntimeHandoff,
    workflowHandoffPacket,
    routeAcceptanceReadiness,
    analytics,
    proof: {
      ...proof,
      commit: proofCommit
    },
    evidence
  };
}

export default describeAuditWriteSurface;
