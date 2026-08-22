export const surfaceId = "aios_capability-security_audit-redaction_019";
export const surfaceGroup = "capability-security";
export const surfaceName = "audit-redaction";

const DEFAULT_REDACTION_FIELDS = [
  'accessToken',
  'apiKey',
  'authorization',
  'cookie',
  'password',
  'secret',
  'sessionToken'
];

const ROLE_PERMISSIONS = {
  owner: ['audit:read', 'audit:write', 'audit:export', 'redaction:manage', 'workspace:cross-scope'],
  admin: ['audit:read', 'audit:write', 'audit:export', 'redaction:manage'],
  auditor: ['audit:read', 'audit:export'],
  operator: ['audit:write'],
  viewer: ['audit:read']
};

const AUDIT_SINK_STATUSES = new Set(['healthy', 'degraded', 'unavailable', 'rate_limited', 'timeout']);

const OPERATIONAL_HEALTH_STATUSES = new Set(['healthy', 'degraded', 'unavailable', 'unknown']);

const REQUIRED_OPERATIONAL_COMPONENTS = [
  'audit-sink',
  'redaction-engine',
  'proof-store'
];

const LIFECYCLE_COMMANDS = new Set([
  'enable',
  'disable',
  'pause',
  'resume',
  'run-now',
  'schedule',
  'cancel-schedule',
  'rotate-redaction-fields'
]);

const RECOVERY_COMMANDS = new Set([
  'recover',
  'ack-dispatch',
  'mark-complete',
  'dead-letter',
  'clear-recovery'
]);

const SCHEDULE_FREQUENCIES = new Set(['manual', 'hourly', 'daily', 'weekly']);

const SCHEDULE_INTERVAL_MS = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

const EXPORT_FORMATS = new Set(['jsonl', 'csv', 'parquet']);

const EXPORT_REDACTION_LEVELS = new Set(['redacted', 'proof-only']);

const RETRYABLE_FAILURE_REASONS = new Set([
  'audit_sink_degraded',
  'audit_sink_unavailable',
  'audit_sink_rate_limited',
  'audit_sink_timeout',
  'audit_sink_backpressure',
  'operational_dependency_degraded',
  'operational_dependency_unavailable',
  'operational_dependency_stale',
  'operational_component_missing',
  'provider_sync_stale'
]);

const PROVIDER_CAPABILITY_CATALOG = {
  'audit.write': 'Accept redacted audit events for hosted-kernel persistence.',
  'audit.export': 'Prepare tenant/workspace scoped audit exports.',
  'redaction.apply': 'Apply field-level redaction before external handoff.',
  'redaction.proof': 'Return redaction paths and policy evidence with each handoff.',
  'sync.checkpoint': 'Expose a durable sync cursor for replay and recovery.',
  'lifecycle.manage': 'Apply redaction lifecycle commands from authorized actors.'
};

const PROVIDER_HANDOFF_STATES = new Set(['local-only', 'queued', 'ready', 'blocked', 'degraded']);

const CLIENT_HANDOFF_STATES = new Set(['draft', 'submitting', 'queued', 'blocked', 'degraded', 'complete']);

const CLIENT_HANDOFF_TRANSITIONS = {
  draft: ['submitting', 'blocked'],
  submitting: ['queued', 'blocked', 'degraded', 'complete'],
  queued: ['blocked', 'degraded', 'complete'],
  blocked: ['draft', 'submitting'],
  degraded: ['queued', 'blocked', 'complete'],
  complete: []
};

const PROVIDER_SERVICE_TYPES = new Set([
  'hosted-kernel-audit-bridge',
  'webhook',
  'event-bus',
  'object-store',
  'local-kernel'
]);

const PROVIDER_AUTH_MODES = new Set(['none', 'signed-request', 'mutual-tls', 'oauth-client']);

const PROVIDER_DELIVERY_CHANNELS = new Set(['in-process', 'https', 'queue', 'stream', 'object-manifest']);

const PERSISTED_AUDIT_STATUSES = new Set([
  'initialized',
  'captured',
  'blocked',
  'buffered',
  'dispatching',
  'complete',
  'recovery-pending',
  'recovering',
  'dead-lettered'
]);

const ACTIONABLE_ERROR_CATALOG = {
  missing_tenant: {
    code: 'AUDIT_SCOPE_TENANT_REQUIRED',
    message: 'Audit redaction requires a tenantId before the hosted-kernel audit event can be accepted.',
    remediation: 'Attach the tenantId from the capability invocation envelope and retry the audit handoff.',
    retryable: false
  },
  missing_workspace: {
    code: 'AUDIT_SCOPE_WORKSPACE_REQUIRED',
    message: 'Audit redaction requires a workspaceId before the hosted-kernel audit event can be accepted.',
    remediation: 'Attach the workspaceId from the capability invocation envelope and retry the audit handoff.',
    retryable: false
  },
  tenant_mismatch: {
    code: 'AUDIT_SCOPE_TENANT_MISMATCH',
    message: 'The actor tenant does not match the requested audit tenant.',
    remediation: 'Re-issue the request with an actor scoped to the tenant or route through a cross-tenant governance workflow.',
    retryable: false
  },
  workspace_out_of_scope: {
    code: 'AUDIT_SCOPE_WORKSPACE_DENIED',
    message: 'The requested workspace is outside the actor workspace grants.',
    remediation: 'Grant workspace:cross-scope or limit requestedWorkspaceIds to the actor workspace set.',
    retryable: false
  },
  workspace_grant_missing: {
    code: 'AUDIT_WORKSPACE_GRANT_MISSING',
    message: 'The requested workspace does not have an actor workspace grant for this tenant.',
    remediation: 'Attach an actor workspace grant for each requested workspace or route through a cross-scope owner workflow.',
    retryable: false
  },
  workspace_grant_tenant_mismatch: {
    code: 'AUDIT_WORKSPACE_GRANT_TENANT_MISMATCH',
    message: 'A workspace grant was issued for a different tenant than the requested audit scope.',
    remediation: 'Refresh actor workspace grants from the tenant-scoped authorization service before retrying.',
    retryable: false
  },
  workspace_grant_expired: {
    code: 'AUDIT_WORKSPACE_GRANT_EXPIRED',
    message: 'A workspace grant for the requested audit handoff has expired.',
    remediation: 'Refresh the actor workspace grant and retry the audit handoff with a current grant.',
    retryable: false
  },
  workspace_grant_action_denied: {
    code: 'AUDIT_WORKSPACE_GRANT_ACTION_DENIED',
    message: 'A workspace grant does not allow the requested audit action.',
    remediation: 'Issue a grant that includes the requested audit permission or reduce the requested action.',
    retryable: false
  },
  permission_denied: {
    code: 'AUDIT_PERMISSION_DENIED',
    message: 'The actor is missing the permission required for the requested audit action.',
    remediation: 'Assign a role or explicit permission that includes the requested audit action.',
    retryable: false
  },
  invalid_event_payload: {
    code: 'AUDIT_EVENT_INVALID',
    message: 'Audit redaction received an event payload that is not an object envelope.',
    remediation: 'Send audit event data as an object so field-level redaction and proof paths can be computed.',
    retryable: false
  },
  invalid_export_request: {
    code: 'AUDIT_EXPORT_REQUEST_INVALID',
    message: 'Audit redaction received an export request that cannot be represented as a typed hosted-kernel manifest.',
    remediation: 'Send a supported format, a valid since/until window, and at least one scoped workspace for audit export.',
    retryable: false
  },
  export_window_out_of_retention: {
    code: 'AUDIT_EXPORT_WINDOW_OUT_OF_RETENTION',
    message: 'The requested audit export window starts before the configured retention boundary.',
    remediation: 'Reduce the export window or increase retentionDays through an authorized lifecycle command before retrying.',
    retryable: false
  },
  audit_sink_degraded: {
    code: 'AUDIT_SINK_DEGRADED',
    message: 'The configured audit sink is in degraded mode; the event may be buffered before delivery.',
    remediation: 'Monitor hosted-kernel audit sink recovery and drain the audit replay buffer.',
    retryable: true
  },
  audit_sink_unavailable: {
    code: 'AUDIT_SINK_UNAVAILABLE',
    message: 'The configured audit sink is unavailable.',
    remediation: 'Fail over to degraded buffering or restore the hosted-kernel audit sink before retrying.',
    retryable: true
  },
  audit_sink_rate_limited: {
    code: 'AUDIT_SINK_RATE_LIMITED',
    message: 'The configured audit sink is rate limited.',
    remediation: 'Retry with backoff or reduce audit export volume for this tenant/workspace.',
    retryable: true
  },
  audit_sink_timeout: {
    code: 'AUDIT_SINK_TIMEOUT',
    message: 'The configured audit sink did not respond before the hosted-kernel timeout.',
    remediation: 'Retry with backoff and inspect sink latency for the audit destination.',
    retryable: true
  },
  audit_sink_backpressure: {
    code: 'AUDIT_SINK_BACKPRESSURE',
    message: 'The audit sink backlog is above its configured queue threshold.',
    remediation: 'Hold low-priority audit exports and retry when the queue depth falls below threshold.',
    retryable: true
  },
  operational_dependency_degraded: {
    code: 'AUDIT_OPERATIONAL_DEPENDENCY_DEGRADED',
    message: 'A hosted-kernel audit redaction dependency is degraded.',
    remediation: 'Keep the handoff buffered, inspect the degraded component, and retry once dependency health recovers.',
    retryable: true
  },
  operational_dependency_unavailable: {
    code: 'AUDIT_OPERATIONAL_DEPENDENCY_UNAVAILABLE',
    message: 'A hosted-kernel audit redaction dependency is unavailable.',
    remediation: 'Fail over to degraded buffering when allowed or restore the unavailable dependency before accepting live handoff.',
    retryable: true
  },
  operational_dependency_stale: {
    code: 'AUDIT_OPERATIONAL_DEPENDENCY_STALE',
    message: 'A hosted-kernel audit redaction dependency has a stale health heartbeat.',
    remediation: 'Refresh operational health probes and retry with current dependency status.',
    retryable: true
  },
  operational_component_missing: {
    code: 'AUDIT_OPERATIONAL_COMPONENT_MISSING',
    message: 'A required hosted-kernel audit redaction component did not report health.',
    remediation: 'Attach health for audit-sink, redaction-engine, and proof-store before committing the handoff.',
    retryable: true
  },
  invalid_settings: {
    code: 'AUDIT_REDACTION_SETTINGS_INVALID',
    message: 'Audit redaction received lifecycle settings that cannot be applied safely.',
    remediation: 'Correct the settings payload to use typed booleans, supported schedule frequencies, and a positive retention window.',
    retryable: false
  },
  invalid_lifecycle_command: {
    code: 'AUDIT_REDACTION_LIFECYCLE_COMMAND_INVALID',
    message: 'Audit redaction received an unsupported lifecycle command.',
    remediation: 'Use enable, disable, pause, resume, run-now, schedule, cancel-schedule, or rotate-redaction-fields.',
    retryable: false
  },
  lifecycle_control_denied: {
    code: 'AUDIT_REDACTION_LIFECYCLE_DENIED',
    message: 'The actor is missing redaction:manage for the requested lifecycle control.',
    remediation: 'Assign a role or explicit permission that includes redaction:manage before changing audit redaction lifecycle state.',
    retryable: false
  },
  audit_capture_disabled: {
    code: 'AUDIT_CAPTURE_DISABLED',
    message: 'Audit capture is disabled for this tenant/workspace lifecycle state.',
    remediation: 'Enable audit capture or use a read/export action that does not write a new audit event.',
    retryable: false
  },
  redaction_disabled: {
    code: 'AUDIT_REDACTION_DISABLED',
    message: 'Audit redaction is disabled and cannot accept write handoffs without an explicit lifecycle enable.',
    remediation: 'Issue an enable lifecycle command from an actor with redaction:manage or keep the event out of hosted-kernel audit capture.',
    retryable: false
  },
  export_disabled: {
    code: 'AUDIT_EXPORT_DISABLED',
    message: 'Audit export is disabled by lifecycle settings.',
    remediation: 'Enable export in the audit redaction settings before requesting audit:export.',
    retryable: false
  },
  provider_contract_missing: {
    code: 'AUDIT_PROVIDER_CONTRACT_MISSING',
    message: 'Audit redaction requires a provider contract before external hosted-kernel handoff.',
    remediation: 'Attach provider.id and provider.capabilities or keep the event in local-only audit capture.',
    retryable: false
  },
  provider_capability_unsupported: {
    code: 'AUDIT_PROVIDER_CAPABILITY_UNSUPPORTED',
    message: 'The configured audit provider does not advertise every capability required for this handoff.',
    remediation: 'Negotiate the missing provider capabilities or select a provider that supports this audit action.',
    retryable: false
  },
  provider_service_contract_invalid: {
    code: 'AUDIT_PROVIDER_SERVICE_CONTRACT_INVALID',
    message: 'The configured audit provider service contract is incomplete for external hosted-kernel handoff.',
    remediation: 'Attach a supported provider.service type, delivery channel, endpoint when required, and tenant/workspace binding metadata.',
    retryable: false
  },
  provider_sync_stale: {
    code: 'AUDIT_PROVIDER_SYNC_STALE',
    message: 'The provider sync cursor is stale for the requested external audit handoff.',
    remediation: 'Refresh the provider checkpoint before accepting additional external audit handoffs.',
    retryable: true
  },
  retry_budget_exhausted: {
    code: 'AUDIT_RETRY_BUDGET_EXHAUSTED',
    message: 'Audit redaction exhausted its retry budget for this hosted-kernel handoff.',
    remediation: 'Stop automatic retries, preserve the correlationId, and route the handoff to operator recovery or dead-letter replay.',
    retryable: false
  },
  recovery_deadline_exceeded: {
    code: 'AUDIT_RECOVERY_DEADLINE_EXCEEDED',
    message: 'Audit redaction passed the configured recovery deadline for this handoff.',
    remediation: 'Escalate the handoff with its persisted cursor and replay only after the audit sink is healthy.',
    retryable: false
  }
};

function asList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeRedactionFieldToken(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

function normalizeRedactionFields(value) {
  return [...new Set(DEFAULT_REDACTION_FIELDS.concat(asList(value)))]
    .map((field) => String(field || '').trim())
    .filter(Boolean);
}

function shouldRedactFieldName(key, redactionFields) {
  const normalizedKey = normalizeRedactionFieldToken(key);
  if (!normalizedKey) return false;

  return redactionFields.some((field) => {
    const normalizedField = normalizeRedactionFieldToken(field);
    return normalizedField && (
      normalizedKey === normalizedField
        || normalizedKey.endsWith(normalizedField)
        || normalizedKey.includes(normalizedField)
    );
  });
}

function normalizeEvidenceArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry !== undefined);
}

function buildRedactedEvidenceBundle(evidence, redactionFields) {
  const entries = normalizeEvidenceArray(evidence);
  const redactedEntries = redactValue(entries, redactionFields);
  const redactionPaths = collectRedactionPaths(entries, redactionFields)
    .map((path) => `evidence.${path}`);

  return {
    schema: 'aios.audit-redaction.evidence-redaction.v1',
    supplied: entries.length > 0,
    entryCount: entries.length,
    redactionPaths,
    redactionPathCount: redactionPaths.length,
    redacted: redactedEntries
  };
}

function normalizeScope(input = {}) {
  const actorInput = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : '';
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : '';
  const actorTenantId = typeof input.actorTenantId === 'string'
    ? input.actorTenantId.trim()
    : typeof actorInput.tenantId === 'string' && actorInput.tenantId.trim() ? actorInput.tenantId.trim() : tenantId;
  const actorWorkspaceIds = new Set(asList(input.actorWorkspaceIds || actorInput.workspaceIds || input.workspaceIds || workspaceId));
  const requestedWorkspaceIds = new Set(asList(input.requestedWorkspaceIds || workspaceId));
  return {
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds: [...actorWorkspaceIds],
    requestedWorkspaceIds: [...requestedWorkspaceIds]
  };
}

function buildPermissionSet(input = {}) {
  const actorInput = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const permissions = new Set(asList(input.permissions).concat(asList(actorInput.permissions)));
  for (const role of asList(input.roles).concat(asList(actorInput.roles))) {
    for (const permission of ROLE_PERMISSIONS[role] || []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}

function normalizeActorIdentity(input = {}) {
  const actorInput = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const actorId = typeof actorInput.id === 'string' && actorInput.id.trim()
    ? actorInput.id.trim()
    : typeof input.actorId === 'string' && input.actorId.trim() ? input.actorId.trim() : null;
  const tenantId = typeof actorInput.tenantId === 'string' && actorInput.tenantId.trim()
    ? actorInput.tenantId.trim()
    : typeof input.actorTenantId === 'string' && input.actorTenantId.trim() ? input.actorTenantId.trim() : null;

  return {
    actorId,
    tenantId,
    roles: [...new Set(asList(input.roles).concat(asList(actorInput.roles)))].sort(),
    explicitPermissions: [...new Set(asList(input.permissions).concat(asList(actorInput.permissions)))].sort(),
    workspaceIds: [...new Set(asList(actorInput.workspaceIds || input.actorWorkspaceIds || input.workspaceIds))].sort()
  };
}

function normalizeWorkspaceGrant(entry = {}, index = 0) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const roles = asList(source.roles);
  const permissions = new Set(asList(source.permissions || source.actions || source.capabilities));
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) {
      permissions.add(permission);
    }
  }

  return {
    grantId: typeof source.grantId === 'string' && source.grantId.trim()
      ? source.grantId.trim()
      : typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `workspace-grant-${index + 1}`,
    tenantId: typeof source.tenantId === 'string' && source.tenantId.trim() ? source.tenantId.trim() : null,
    workspaceId: typeof source.workspaceId === 'string' && source.workspaceId.trim()
      ? source.workspaceId.trim()
      : typeof source.id === 'string' && source.id.trim() ? source.id.trim() : '',
    roles,
    permissions: [...permissions].sort(),
    expiresAt: typeof source.expiresAt === 'string' && source.expiresAt.trim() ? source.expiresAt.trim() : null,
    issuedBy: typeof source.issuedBy === 'string' && source.issuedBy.trim() ? source.issuedBy.trim() : null
  };
}

function normalizeWorkspaceGrants(input = {}) {
  const actorInput = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const grantInput = input.actorWorkspaceGrants || input.workspaceGrants || actorInput.workspaceGrants;
  return asList(input.actorWorkspaceIds || input.workspaceIds || input.workspaceId)
    .map((workspaceId, index) => normalizeWorkspaceGrant({
      grantId: `actor-workspace-${index + 1}`,
      workspaceId,
      permissions: ['audit:read', 'audit:write', 'audit:export', 'redaction:manage']
    }, index))
    .concat(Array.isArray(grantInput) ? grantInput.map((entry, index) => normalizeWorkspaceGrant(entry, index)) : []);
}

function evaluateWorkspaceGrant(grant, scope, requestedAction, generatedAt) {
  const reasons = [];
  const grantTenantMismatch = Boolean(grant.tenantId && scope.tenantId && grant.tenantId !== scope.tenantId);
  const expiresAtMs = normalizeTimestampMs(grant.expiresAt);
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const expired = expiresAtMs !== null && generatedAtMs !== null && expiresAtMs <= generatedAtMs;
  const actionAllowed = !requestedAction
    || grant.permissions.includes(requestedAction)
    || grant.permissions.includes('workspace:cross-scope');

  if (grantTenantMismatch) reasons.push('workspace_grant_tenant_mismatch');
  if (expired) reasons.push('workspace_grant_expired');
  if (!actionAllowed) reasons.push('workspace_grant_action_denied');

  return {
    grantId: grant.grantId,
    workspaceId: grant.workspaceId,
    tenantId: grant.tenantId,
    permissions: grant.permissions,
    expiresAt: grant.expiresAt,
    issuedBy: grant.issuedBy,
    valid: reasons.length === 0,
    reasons
  };
}

function evaluateWorkspaceBoundary(scope, permissions, requestedAction, generatedAt, workspaceGrants) {
  const crossScope = permissions.includes('workspace:cross-scope');
  const requestedWorkspaceIds = scope.requestedWorkspaceIds;
  const grantEvaluations = workspaceGrants
    .filter((grant) => grant.workspaceId && requestedWorkspaceIds.includes(grant.workspaceId))
    .map((grant) => evaluateWorkspaceGrant(grant, scope, requestedAction, generatedAt));
  const grantByWorkspace = new Map();
  for (const evaluation of grantEvaluations) {
    const existing = grantByWorkspace.get(evaluation.workspaceId);
    if (!existing || (!existing.valid && evaluation.valid)) {
      grantByWorkspace.set(evaluation.workspaceId, evaluation);
    }
  }

  const reasons = [];
  const outOfScopeWorkspaceIds = [];
  const effectiveWorkspaceIds = [];
  const workspaceProof = requestedWorkspaceIds.map((workspaceId) => {
    const grant = grantByWorkspace.get(workspaceId) || null;
    const granted = Boolean(crossScope || grant?.valid);
    if (granted) effectiveWorkspaceIds.push(workspaceId);
    if (!granted) {
      outOfScopeWorkspaceIds.push(workspaceId);
      reasons.push(...(grant ? grant.reasons : ['workspace_grant_missing']));
    }
    return {
      workspaceId,
      granted,
      grantId: grant?.grantId || null,
      grantTenantId: grant?.tenantId || null,
      grantExpiresAt: grant?.expiresAt || null,
      grantReasons: grant?.reasons || (crossScope ? [] : ['workspace_grant_missing']),
      source: crossScope ? 'workspace:cross-scope' : grant ? 'workspace-grant' : 'missing'
    };
  });

  return {
    crossScope,
    effectiveWorkspaceIds: [...new Set(effectiveWorkspaceIds)],
    outOfScopeWorkspaceIds: [...new Set(outOfScopeWorkspaceIds)],
    reasons: [...new Set(reasons)],
    workspaceProof
  };
}

function buildWorkspaceBoundaryContract({ scope, boundary, workspaceGrants }) {
  const grantCatalog = workspaceGrants.map((grant) => ({
    grantId: grant.grantId,
    tenantId: grant.tenantId,
    workspaceId: grant.workspaceId || null,
    permissions: grant.permissions,
    expiresAt: grant.expiresAt,
    issuedBy: grant.issuedBy
  }));

  return {
    schema: 'aios.audit-redaction.workspace-boundary.v1',
    tenantId: scope.tenantId || null,
    actorTenantId: scope.actorTenantId || null,
    workspaceId: scope.workspaceId || null,
    requestedWorkspaceIds: scope.requestedWorkspaceIds,
    actorWorkspaceIds: scope.actorWorkspaceIds,
    effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
    outOfScopeWorkspaceIds: boundary.outOfScopeWorkspaceIds,
    isolation: {
      tenant: Boolean(scope.tenantId && scope.actorTenantId === scope.tenantId),
      workspace: boundary.outOfScopeWorkspaceIds.length === 0,
      crossScope: boundary.workspaceProof.some((entry) => entry.source === 'workspace:cross-scope')
    },
    grants: grantCatalog,
    proof: boundary.workspaceProof,
    reasons: boundary.reasons.filter((reason) => reason.startsWith('workspace_'))
  };
}

function buildPermissionBoundaryContract({ input, scope, permissions, action, boundary, workspaceGrants, generatedAt }) {
  const actor = normalizeActorIdentity(input);
  const crossScope = permissions.includes('workspace:cross-scope');
  const globalActionAllowed = !action || permissions.includes(action);
  const workspaceDecisions = scope.requestedWorkspaceIds.map((workspaceId) => {
    const grantEvaluations = workspaceGrants
      .filter((grant) => grant.workspaceId === workspaceId)
      .map((grant) => evaluateWorkspaceGrant(grant, scope, action, generatedAt));
    const validGrants = grantEvaluations.filter((grant) => grant.valid);
    const effectivePermissions = crossScope
      ? permissions
      : [...new Set(validGrants.flatMap((grant) => grant.permissions))].sort();
    const grantActionAllowed = !action
      || effectivePermissions.includes(action)
      || effectivePermissions.includes('workspace:cross-scope');
    const boundaryProof = boundary.workspaceProof.find((entry) => entry.workspaceId === workspaceId) || null;
    const reasons = [];

    if (!boundaryProof?.granted) {
      reasons.push(...(boundaryProof?.grantReasons || ['workspace_grant_missing']));
    }
    if (!globalActionAllowed) reasons.push('permission_denied');
    if (!grantActionAllowed && !crossScope) reasons.push('workspace_grant_action_denied');

    return {
      workspaceId,
      granted: Boolean(boundaryProof?.granted && globalActionAllowed && (crossScope || grantActionAllowed)),
      source: crossScope ? 'actor-cross-scope-permission' : validGrants.length ? 'workspace-grant' : 'missing-grant',
      effectivePermissions,
      grantIds: validGrants.map((grant) => grant.grantId),
      deniedGrantIds: grantEvaluations.filter((grant) => !grant.valid).map((grant) => grant.grantId),
      reasons: [...new Set(reasons)]
    };
  });
  const deniedWorkspaceIds = workspaceDecisions
    .filter((decision) => !decision.granted)
    .map((decision) => decision.workspaceId);
  const actionPath = action === 'audit:export'
    ? 'tenant-workspace-export'
    : action === 'redaction:manage' ? 'redaction-lifecycle-control' : 'audit-event-write';

  return {
    schema: 'aios.audit-redaction.permission-boundary.v1',
    generatedAt,
    action,
    actionPath,
    actor,
    tenant: {
      requestedTenantId: scope.tenantId || null,
      actorTenantId: scope.actorTenantId || actor.tenantId,
      isolated: Boolean(scope.tenantId && scope.actorTenantId === scope.tenantId)
    },
    global: {
      permissions,
      requiredPermission: action,
      actionAllowed: globalActionAllowed,
      crossScope
    },
    workspaces: workspaceDecisions,
    deniedWorkspaceIds,
    allowed: globalActionAllowed && deniedWorkspaceIds.length === 0 && boundary.allowed,
    handoffRequirements: {
      mustMatchTenant: true,
      mustHoldGlobalActionPermission: Boolean(action),
      mustHoldWorkspaceGrant: !crossScope,
      mustEmitProof: true
    },
    reasons: [...new Set(
      boundary.reasons
        .concat(globalActionAllowed ? [] : ['permission_denied'])
        .concat(workspaceDecisions.flatMap((decision) => decision.reasons))
    )]
  };
}

function evaluateBoundary(scope, permissions, requestedAction, generatedAt, workspaceGrants = []) {
  const reasons = [];
  if (!scope.tenantId) reasons.push('missing_tenant');
  if (!scope.workspaceId) reasons.push('missing_workspace');
  if (scope.actorTenantId && scope.tenantId && scope.actorTenantId !== scope.tenantId) {
    reasons.push('tenant_mismatch');
  }

  const workspaceBoundary = evaluateWorkspaceBoundary(scope, permissions, requestedAction, generatedAt, workspaceGrants);
  if (workspaceBoundary.outOfScopeWorkspaceIds.length && !workspaceBoundary.crossScope) {
    reasons.push('workspace_out_of_scope');
  }
  reasons.push(...workspaceBoundary.reasons);

  if (requestedAction && !permissions.includes(requestedAction)) {
    reasons.push('permission_denied');
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    outOfScopeWorkspaceIds: workspaceBoundary.outOfScopeWorkspaceIds,
    effectiveWorkspaceIds: workspaceBoundary.effectiveWorkspaceIds,
    workspaceProof: workspaceBoundary.workspaceProof
  };
}

function redactValue(value, redactionFields, path = []) {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, redactionFields, path.concat(String(index))));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const redacted = {};
  for (const [key, nested] of Object.entries(value)) {
    const shouldRedact = shouldRedactFieldName(key, redactionFields);
    redacted[key] = shouldRedact ? '[REDACTED]' : redactValue(nested, redactionFields, path.concat(key));
  }
  return redacted;
}

function collectRedactionPaths(value, redactionFields, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectRedactionPaths(item, redactionFields, path.concat(String(index))));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = path.concat(key);
    if (shouldRedactFieldName(key, redactionFields)) {
      return [nextPath.join('.')];
    }
    return collectRedactionPaths(nested, redactionFields, nextPath);
  });
}

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeIntegerRange(value, fallback, min, max, issue, issues) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    issues.push(issue);
    return fallback;
  }
  return Math.floor(number);
}

function normalizeTimestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBooleanSetting(source, key, fallback, issues) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  if (typeof source[key] === 'boolean') return source[key];
  issues.push(`${key}_must_be_boolean`);
  return fallback;
}

function normalizeRetentionDays(value, issues) {
  if (value === undefined || value === null || value === '') return 90;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    issues.push('retentionDays_out_of_range');
    return 90;
  }
  return Math.floor(days);
}

function normalizeSchedule(input = {}, settingsInput = {}, issues = []) {
  const scheduleInput = input.schedule && typeof input.schedule === 'object'
    ? input.schedule
    : settingsInput.schedule && typeof settingsInput.schedule === 'object' ? settingsInput.schedule : {};
  const frequency = typeof scheduleInput.frequency === 'string' && SCHEDULE_FREQUENCIES.has(scheduleInput.frequency)
    ? scheduleInput.frequency
    : 'manual';

  if (typeof scheduleInput.frequency === 'string' && scheduleInput.frequency && !SCHEDULE_FREQUENCIES.has(scheduleInput.frequency)) {
    issues.push('schedule_frequency_unsupported');
  }

  const nextRunAt = typeof scheduleInput.nextRunAt === 'string' && scheduleInput.nextRunAt.trim()
    ? scheduleInput.nextRunAt.trim()
    : null;
  if (nextRunAt && normalizeTimestampMs(nextRunAt) === null) {
    issues.push('schedule_nextRunAt_invalid');
  }

  const lastRunAt = typeof scheduleInput.lastRunAt === 'string' && scheduleInput.lastRunAt.trim()
    ? scheduleInput.lastRunAt.trim()
    : null;
  if (lastRunAt && normalizeTimestampMs(lastRunAt) === null) {
    issues.push('schedule_lastRunAt_invalid');
  }

  return {
    enabled: normalizeBooleanSetting(scheduleInput, 'enabled', frequency !== 'manual', issues),
    frequency,
    nextRunAt,
    lastRunAt,
    timezone: typeof scheduleInput.timezone === 'string' && scheduleInput.timezone.trim()
      ? scheduleInput.timezone.trim()
      : 'UTC',
    maxCatchUpRuns: normalizeIntegerRange(
      scheduleInput.maxCatchUpRuns,
      1,
      1,
      24,
      'schedule_maxCatchUpRuns_out_of_range',
      issues
    ),
    jitterMs: normalizeIntegerRange(
      scheduleInput.jitterMs,
      0,
      0,
      60 * 60 * 1000,
      'schedule_jitterMs_out_of_range',
      issues
    )
  };
}

function normalizeLifecycleSettingsOverlay(source = {}, issues = [], fallback = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const overlay = {};

  for (const key of ['redactionEnabled', 'auditCaptureEnabled', 'exportEnabled', 'proofRequired', 'dryRun']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      overlay[key] = normalizeBooleanSetting(input, key, fallback[key] ?? false, issues);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'retentionDays')) {
    overlay.retentionDays = normalizeRetentionDays(input.retentionDays, issues);
  }

  if (input.schedule && typeof input.schedule === 'object') {
    overlay.schedule = {
      ...fallback.schedule,
      ...normalizeSchedule({ schedule: { ...fallback.schedule, ...input.schedule } }, {}, issues)
    };
  }

  return overlay;
}

function normalizeLifecycleSettings(input = {}) {
  const settingsInput = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const issues = [];
  const schedule = normalizeSchedule(input, settingsInput, issues);
  const settings = {
    redactionEnabled: normalizeBooleanSetting(settingsInput, 'redactionEnabled', true, issues),
    auditCaptureEnabled: normalizeBooleanSetting(settingsInput, 'auditCaptureEnabled', true, issues),
    exportEnabled: normalizeBooleanSetting(settingsInput, 'exportEnabled', true, issues),
    proofRequired: normalizeBooleanSetting(settingsInput, 'proofRequired', true, issues),
    dryRun: normalizeBooleanSetting(settingsInput, 'dryRun', false, issues),
    retentionDays: normalizeRetentionDays(settingsInput.retentionDays, issues),
    schedule
  };

  return {
    valid: issues.length === 0,
    settings,
    issues,
    reasons: issues.length ? ['invalid_settings'] : []
  };
}

function normalizeLifecycleCommand(input = {}) {
  const commandInput = input.lifecycleCommand || input.command || null;
  const source = commandInput && typeof commandInput === 'object' ? commandInput : {};
  const commandName = typeof commandInput === 'string'
    ? commandInput.trim()
    : typeof source.name === 'string' ? source.name.trim() : '';
  const normalizedName = commandName.toLowerCase();
  const present = Boolean(normalizedName);
  const supported = !present || LIFECYCLE_COMMANDS.has(normalizedName);

  return {
    present,
    name: supported ? normalizedName : commandName,
    supported,
    requestedBy: typeof source.requestedBy === 'string' && source.requestedBy.trim()
      ? source.requestedBy.trim()
      : input.actorId || null,
    reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : null,
    effectiveAt: typeof source.effectiveAt === 'string' && source.effectiveAt.trim()
      ? source.effectiveAt.trim()
      : null,
    schedule: source.schedule && typeof source.schedule === 'object' ? source.schedule : null,
    settings: source.settings && typeof source.settings === 'object' ? source.settings : null,
    commandId: typeof source.commandId === 'string' && source.commandId.trim()
      ? source.commandId.trim()
      : typeof source.id === 'string' && source.id.trim() ? source.id.trim() : null
  };
}

function buildLifecycleDesiredState({ settings, command, input, generatedAt, issues }) {
  const desired = {
    redactionEnabled: settings.redactionEnabled,
    auditCaptureEnabled: settings.auditCaptureEnabled,
    exportEnabled: settings.exportEnabled,
    proofRequired: settings.proofRequired,
    dryRun: settings.dryRun,
    retentionDays: settings.retentionDays,
    schedule: { ...settings.schedule }
  };
  const controlChanges = [];
  const transitionSteps = [];
  const commandProof = {
    schema: 'aios.audit-redaction.lifecycle-command-proof.v1',
    commandId: command.commandId,
    requestedCommand: command.present ? command.name : null,
    requestedBy: command.requestedBy,
    reason: command.reason,
    effectiveAt: command.effectiveAt,
    settingsOverlayApplied: false,
    scheduleOperation: 'none',
    redactionFieldRotation: null
  };
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const effectiveAtMs = normalizeTimestampMs(command.effectiveAt);

  if (command.effectiveAt && effectiveAtMs === null) {
    issues.push('lifecycle_effectiveAt_invalid');
  }

  if (!command.present || !command.supported) {
    return { desired, controlChanges, transitionSteps, commandProof, effectiveAtMs };
  }

  if (command.settings) {
    const overlayIssues = [];
    const overlay = normalizeLifecycleSettingsOverlay(command.settings, overlayIssues, desired);
    issues.push(...overlayIssues.map((issue) => `command_settings_${issue}`));
    for (const [key, value] of Object.entries(overlay)) {
      if (key === 'schedule') {
        desired.schedule = { ...desired.schedule, ...value };
      } else {
        desired[key] = value;
      }
    }
    if (Object.keys(overlay).length) {
      commandProof.settingsOverlayApplied = true;
      transitionSteps.push('apply-command-settings-overlay');
      controlChanges.push('apply-settings-overlay');
    }
  }

  if (command.name === 'enable' || command.name === 'resume') {
    desired.redactionEnabled = true;
    desired.auditCaptureEnabled = true;
    if (settings.schedule.frequency !== 'manual') {
      desired.schedule = { ...desired.schedule, enabled: true };
    }
    controlChanges.push('enable-capture', 'enable-redaction');
    transitionSteps.push(command.name === 'resume' ? 'resume-capture' : 'enable-capture');
  }

  if (command.name === 'disable') {
    desired.redactionEnabled = false;
    desired.auditCaptureEnabled = false;
    desired.exportEnabled = false;
    desired.schedule = { ...desired.schedule, enabled: false, frequency: 'manual', nextRunAt: null };
    controlChanges.push('disable-capture', 'disable-redaction', 'disable-export', 'clear-schedule');
    transitionSteps.push('disable-all-handoff-controls');
    commandProof.scheduleOperation = 'cleared';
  }

  if (command.name === 'pause') {
    desired.auditCaptureEnabled = false;
    desired.schedule = { ...desired.schedule, enabled: false };
    controlChanges.push('pause-capture', 'pause-schedule');
    transitionSteps.push('pause-capture', 'hold-schedule');
    commandProof.scheduleOperation = 'paused';
  }

  if (command.name === 'cancel-schedule') {
    desired.schedule = { ...desired.schedule, enabled: false, frequency: 'manual', nextRunAt: null };
    controlChanges.push('clear-schedule');
    transitionSteps.push('clear-schedule');
    commandProof.scheduleOperation = 'cleared';
  }

  if (command.name === 'schedule') {
    const commandScheduleIssues = [];
    const scheduled = normalizeSchedule({ schedule: command.schedule || input.schedule }, {}, commandScheduleIssues);
    issues.push(...commandScheduleIssues.map((issue) => `command_${issue}`));
    desired.schedule = { ...scheduled, enabled: true };
    if (desired.schedule.frequency === 'manual') {
      issues.push('command_schedule_frequency_required');
    }
    const nextRunAtMs = normalizeTimestampMs(desired.schedule.nextRunAt);
    if (desired.schedule.nextRunAt && nextRunAtMs !== null && generatedAtMs !== null && nextRunAtMs <= generatedAtMs) {
      issues.push('command_schedule_nextRunAt_not_future');
    }
    controlChanges.push('set-schedule');
    transitionSteps.push('set-schedule');
    commandProof.scheduleOperation = 'scheduled';
  }

  if (command.name === 'run-now') {
    desired.schedule = { ...desired.schedule, nextRunAt: generatedAt };
    controlChanges.push('request-immediate-run');
    transitionSteps.push('request-immediate-run');
    commandProof.scheduleOperation = 'run-now';
  }

  if (command.name === 'rotate-redaction-fields') {
    const requestedFields = asList(command.settings?.redactionFields || input.redactionFields);
    if (!requestedFields.length) {
      issues.push('command_redactionFields_required');
    }
    commandProof.redactionFieldRotation = {
      requestedFields,
      fieldCount: requestedFields.length,
      accepted: requestedFields.length > 0,
      source: command.settings?.redactionFields ? 'command-settings' : 'input-redactionFields'
    };
    controlChanges.push('rotate-redaction-fields');
    transitionSteps.push('rotate-redaction-field-policy');
  }

  if (desired.schedule.enabled && desired.schedule.frequency === 'manual' && command.name !== 'run-now') {
    issues.push('schedule_enabled_requires_frequency');
  }

  return {
    desired,
    controlChanges: [...new Set(controlChanges)],
    transitionSteps: [...new Set(transitionSteps)],
    commandProof,
    effectiveAtMs
  };
}

function buildLifecycleControlPlan({ settings, desiredState, desiredStateResult, command, commandApplied, reasons, generatedAt }) {
  const changedSettings = Object.entries({
    redactionEnabled: [settings.redactionEnabled, desiredState.redactionEnabled],
    auditCaptureEnabled: [settings.auditCaptureEnabled, desiredState.auditCaptureEnabled],
    exportEnabled: [settings.exportEnabled, desiredState.exportEnabled],
    proofRequired: [settings.proofRequired, desiredState.proofRequired],
    dryRun: [settings.dryRun, desiredState.dryRun],
    retentionDays: [settings.retentionDays, desiredState.retentionDays],
    scheduleEnabled: [settings.schedule.enabled, desiredState.schedule.enabled],
    scheduleFrequency: [settings.schedule.frequency, desiredState.schedule.frequency],
    scheduleNextRunAt: [settings.schedule.nextRunAt, desiredState.schedule.nextRunAt],
    scheduleLastRunAt: [settings.schedule.lastRunAt, desiredState.schedule.lastRunAt],
    scheduleMaxCatchUpRuns: [settings.schedule.maxCatchUpRuns, desiredState.schedule.maxCatchUpRuns],
    scheduleJitterMs: [settings.schedule.jitterMs, desiredState.schedule.jitterMs]
  })
    .filter(([, values]) => values[0] !== values[1])
    .map(([key]) => key);
  const scheduleChanged = changedSettings.some((key) => key.startsWith('schedule'));
  const scheduled = desiredState.schedule.enabled && desiredState.schedule.frequency !== 'manual';
  const nextScheduledRunAt = scheduled
    ? desiredState.schedule.nextRunAt || generatedAt
    : null;
  const stateAfterCommand = reasons.length
    ? 'blocked'
    : commandApplied ? 'pending-commit'
      : command.present ? 'denied-or-ignored'
        : scheduled ? 'scheduled' : 'active';
  const settingsBefore = {
    redactionEnabled: settings.redactionEnabled,
    auditCaptureEnabled: settings.auditCaptureEnabled,
    exportEnabled: settings.exportEnabled,
    proofRequired: settings.proofRequired,
    dryRun: settings.dryRun,
    retentionDays: settings.retentionDays,
    schedule: settings.schedule
  };

  return {
    schema: 'aios.audit-redaction.lifecycle-control.v1',
    stateAfterCommand,
    changedSettings,
    scheduled,
    nextScheduledRunAt,
    commandId: command.commandId,
    transition: {
      from: settingsBefore,
      to: desiredState,
      steps: desiredStateResult.transitionSteps,
      applied: commandApplied,
      blockedReasons: [...new Set(reasons)]
    },
    scheduleControl: {
      operation: desiredStateResult.commandProof.scheduleOperation,
      changed: scheduleChanged,
      frequency: desiredState.schedule.frequency,
      enabled: desiredState.schedule.enabled,
      timezone: desiredState.schedule.timezone,
      nextRunAt: desiredState.schedule.nextRunAt,
      nextRunAtMs: normalizeTimestampMs(desiredState.schedule.nextRunAt),
      lastRunAt: desiredState.schedule.lastRunAt,
      maxCatchUpRuns: desiredState.schedule.maxCatchUpRuns,
      jitterMs: desiredState.schedule.jitterMs
    },
    commandProof: desiredStateResult.commandProof,
    commitRequired: commandApplied && changedSettings.length > 0,
    runImmediately: commandApplied && command.name === 'run-now',
    operatorVisible: command.present || changedSettings.length > 0 || reasons.length > 0
  };
}

function buildLifecycleScheduleRuntime({ settings, desiredState, command, commandApplied, reasons, generatedAt }) {
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const nextRunAtMs = normalizeTimestampMs(desiredState.schedule.nextRunAt);
  const lastRunAtMs = normalizeTimestampMs(desiredState.schedule.lastRunAt);
  const cadenceMs = SCHEDULE_INTERVAL_MS[desiredState.schedule.frequency] || null;
  const enabled = desiredState.schedule.enabled && desiredState.schedule.frequency !== 'manual';
  const due = enabled && nextRunAtMs !== null && generatedAtMs !== null && nextRunAtMs <= generatedAtMs;
  const overdueByMs = due ? generatedAtMs - nextRunAtMs : 0;
  const missedRunCount = due && cadenceMs
    ? Math.min(desiredState.schedule.maxCatchUpRuns, Math.floor(overdueByMs / cadenceMs) + 1)
    : 0;
  const catchUpLimited = due && cadenceMs && Math.floor(overdueByMs / cadenceMs) + 1 > desiredState.schedule.maxCatchUpRuns;
  const lastRunDriftMs = lastRunAtMs !== null && nextRunAtMs !== null ? nextRunAtMs - lastRunAtMs : null;
  const operatorAction = reasons.length
    ? 'resolve-lifecycle-blockers'
    : commandApplied && command.name === 'run-now' ? 'dispatch-immediate-run'
      : due ? 'dispatch-due-scheduled-run'
        : enabled ? 'wait-for-next-scheduled-run'
          : command.present && command.supported ? 'commit-lifecycle-state' : 'accept-live-handoff';

  return {
    schema: 'aios.audit-redaction.schedule-runtime.v1',
    generatedAt,
    enabled,
    frequency: desiredState.schedule.frequency,
    timezone: desiredState.schedule.timezone,
    cadenceMs,
    nextRunAt: desiredState.schedule.nextRunAt,
    nextRunAtMs,
    lastRunAt: desiredState.schedule.lastRunAt,
    lastRunAtMs,
    due,
    overdueByMs,
    missedRunCount,
    catchUpLimited,
    maxCatchUpRuns: desiredState.schedule.maxCatchUpRuns,
    jitterMs: desiredState.schedule.jitterMs,
    lastRunDriftMs,
    commandTriggered: commandApplied && command.name === 'run-now',
    dispatch: {
      action: operatorAction,
      allowed: reasons.length === 0 && (due || (commandApplied && command.name === 'run-now')),
      reason: due ? 'scheduled-run-due' : commandApplied && command.name === 'run-now' ? 'manual-run-now' : null,
      window: {
        from: desiredState.schedule.lastRunAt,
        until: generatedAt
      }
    },
    disabledReason: enabled
      ? null
      : !desiredState.redactionEnabled ? 'redaction-disabled'
        : !desiredState.auditCaptureEnabled ? 'audit-capture-disabled'
          : desiredState.schedule.frequency === 'manual' ? 'manual-schedule' : 'schedule-disabled'
  };
}

function buildLifecycleControls({ input, permissions, action, generatedAt }) {
  const settingsState = normalizeLifecycleSettings(input);
  const command = normalizeLifecycleCommand(input);
  const commandIssues = [];
  const desiredStateResult = buildLifecycleDesiredState({
    settings: settingsState.settings,
    command,
    input,
    generatedAt,
    issues: commandIssues
  });
  const reasons = settingsState.reasons.slice();
  if (commandIssues.length) reasons.push('invalid_settings');
  if (command.present && !command.supported) reasons.push('invalid_lifecycle_command');
  if (command.present && command.supported && !permissions.includes('redaction:manage')) {
    reasons.push('lifecycle_control_denied');
  }
  if (!desiredStateResult.desired.auditCaptureEnabled && action === 'audit:write') {
    reasons.push('audit_capture_disabled');
  }
  if (!desiredStateResult.desired.redactionEnabled && (action === 'audit:write' || action === 'redaction:manage') && command.name !== 'disable') {
    reasons.push('redaction_disabled');
  }
  if (!desiredStateResult.desired.exportEnabled && action === 'audit:export') {
    reasons.push('export_disabled');
  }

  const commandApplied = command.present && command.supported && permissions.includes('redaction:manage') && reasons.length === 0;
  const controlPlan = buildLifecycleControlPlan({
    settings: settingsState.settings,
    desiredState: desiredStateResult.desired,
    desiredStateResult,
    command,
    commandApplied,
    reasons,
    generatedAt
  });
  const scheduleRuntime = buildLifecycleScheduleRuntime({
    settings: settingsState.settings,
    desiredState: desiredStateResult.desired,
    command,
    commandApplied,
    reasons,
    generatedAt
  });
  controlPlan.scheduleRuntime = scheduleRuntime;
  const nextAction = reasons.length
    ? 'resolve-lifecycle-blockers'
    : commandApplied && command.name === 'run-now' ? 'dispatch-immediate-redaction-run'
      : scheduleRuntime.due ? 'dispatch-due-scheduled-redaction-run'
      : commandApplied && controlPlan.commitRequired ? 'commit-lifecycle-command'
        : controlPlan.scheduled ? 'await-scheduled-run' : 'accept-live-handoff';

  return {
    settings: settingsState.settings,
    desiredSettings: desiredStateResult.desired,
    settingsValid: settingsState.valid && commandIssues.length === 0,
    settingsIssues: settingsState.issues.concat(commandIssues),
    command,
    commandApplied,
    controlChanges: desiredStateResult.controlChanges,
    transitionSteps: desiredStateResult.transitionSteps,
    controlPlan,
    scheduleRuntime,
    commandProof: desiredStateResult.commandProof,
    reasons: [...new Set(reasons)],
    nextAction,
    generatedAt
  };
}

function normalizeAuditSinkHealth(input = {}) {
  const healthInput = input.auditSinkHealth && typeof input.auditSinkHealth === 'object' ? input.auditSinkHealth : {};
  const statusCandidate = typeof input.auditSinkStatus === 'string' ? input.auditSinkStatus : healthInput.status;
  const status = AUDIT_SINK_STATUSES.has(statusCandidate) ? statusCandidate : 'healthy';
  const queueDepth = normalizePositiveInteger(healthInput.queueDepth ?? input.auditQueueDepth, 0);
  const maxQueueDepth = normalizePositiveInteger(healthInput.maxQueueDepth ?? input.auditMaxQueueDepth, 1000);
  const failureCount = normalizePositiveInteger(healthInput.failureCount ?? input.auditSinkFailureCount, 0);
  const degradedMode = input.degradedMode === true || healthInput.degradedMode === true;
  const reasons = [];

  if (status === 'degraded') reasons.push('audit_sink_degraded');
  if (status === 'unavailable') reasons.push('audit_sink_unavailable');
  if (status === 'rate_limited') reasons.push('audit_sink_rate_limited');
  if (status === 'timeout') reasons.push('audit_sink_timeout');
  if (queueDepth > maxQueueDepth) reasons.push('audit_sink_backpressure');

  return {
    status,
    ok: reasons.length === 0,
    degradedMode,
    queueDepth,
    maxQueueDepth,
    failureCount,
    lastSuccessAt: typeof healthInput.lastSuccessAt === 'string' ? healthInput.lastSuccessAt : null,
    reasons
  };
}

function normalizeOperationalHealthComponent(entry = {}, index = 0, generatedAt) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const component = typeof source.component === 'string' && source.component.trim()
    ? source.component.trim()
    : typeof source.name === 'string' && source.name.trim() ? source.name.trim() : `component-${index + 1}`;
  const statusCandidate = typeof source.status === 'string' ? source.status.trim().toLowerCase() : 'unknown';
  const status = OPERATIONAL_HEALTH_STATUSES.has(statusCandidate) ? statusCandidate : 'unknown';
  const observedAt = typeof source.observedAt === 'string' && source.observedAt.trim()
    ? source.observedAt.trim()
    : typeof source.checkedAt === 'string' && source.checkedAt.trim() ? source.checkedAt.trim() : null;
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const observedAtMs = normalizeTimestampMs(observedAt);
  const maxAgeMs = normalizePositiveInteger(source.maxAgeMs ?? source.maxHealthAgeMs, 120000);
  const ageMs = generatedAtMs !== null && observedAtMs !== null ? Math.max(0, generatedAtMs - observedAtMs) : null;
  const stale = observedAtMs === null || (ageMs !== null && ageMs > maxAgeMs);
  const detail = typeof source.detail === 'string' && source.detail.trim()
    ? source.detail.trim()
    : typeof source.message === 'string' && source.message.trim() ? source.message.trim() : null;
  const reasons = [];

  if (status === 'degraded') reasons.push('operational_dependency_degraded');
  if (status === 'unavailable' || status === 'unknown') reasons.push('operational_dependency_unavailable');
  if (stale) reasons.push('operational_dependency_stale');

  return {
    component,
    status,
    ok: reasons.length === 0,
    observedAt,
    ageMs,
    maxAgeMs,
    stale,
    detail,
    reasons
  };
}

function normalizeOperationalHealth(input = {}, generatedAt) {
  const source = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.health && typeof input.health === 'object' ? input.health : {};
  const sourcePresent = Object.keys(source).length > 0 || Array.isArray(input.healthChecks);
  const componentInputs = Array.isArray(source.components)
    ? source.components
    : Array.isArray(input.healthChecks) ? input.healthChecks : [];
  const componentMap = new Map(componentInputs
    .map((entry, index) => normalizeOperationalHealthComponent(entry, index, generatedAt))
    .map((component) => [component.component, component]));
  const missingComponents = sourcePresent
    ? REQUIRED_OPERATIONAL_COMPONENTS.filter((component) => !componentMap.has(component))
    : [];
  const reasons = [...componentMap.values()].flatMap((component) => component.reasons);
  const requireAllComponents = source.requireAllComponents === true || (sourcePresent && source.requireAllComponents !== false);
  if (missingComponents.length && requireAllComponents) {
    reasons.push('operational_component_missing');
  }
  const degradedComponents = [...componentMap.values()]
    .filter((component) => !component.ok)
    .map((component) => component.component);

  return {
    schema: 'aios.audit-redaction.operational-health.v1',
    generatedAt,
    requiredComponents: REQUIRED_OPERATIONAL_COMPONENTS,
    requireAllComponents,
    ok: reasons.length === 0,
    degraded: degradedComponents.length > 0,
    components: [...componentMap.values()],
    degradedComponents,
    missingComponents,
    reasons: [...new Set(reasons)]
  };
}

function validateEventEnvelope(event) {
  if (event === undefined || event === null) {
    return { valid: true, normalizedEvent: {} };
  }
  if (typeof event !== 'object' || Array.isArray(event)) {
    return {
      valid: false,
      normalizedEvent: {},
      reason: 'invalid_event_payload'
    };
  }
  return { valid: true, normalizedEvent: event };
}

function normalizeRetryBudget(input = {}, health, generatedAt, reasons = []) {
  const source = input.retryBudget && typeof input.retryBudget === 'object'
    ? input.retryBudget
    : input.auditRetryPolicy && typeof input.auditRetryPolicy === 'object' ? input.auditRetryPolicy : {};
  const retryableReasons = reasons.filter((reason) => RETRYABLE_FAILURE_REASONS.has(reason));
  const attempt = normalizePositiveInteger(source.attempt ?? input.retryAttempt, health.failureCount + 1);
  const maxAttempts = Math.max(1, normalizePositiveInteger(source.maxAttempts ?? input.maxRetryAttempts, 5));
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const recoveryDeadlineAt = typeof source.recoveryDeadlineAt === 'string' && source.recoveryDeadlineAt.trim()
    ? source.recoveryDeadlineAt.trim()
    : typeof input.recoveryDeadlineAt === 'string' && input.recoveryDeadlineAt.trim() ? input.recoveryDeadlineAt.trim() : null;
  const recoveryDeadlineMs = normalizeTimestampMs(recoveryDeadlineAt);
  const firstFailureAt = typeof source.firstFailureAt === 'string' && source.firstFailureAt.trim()
    ? source.firstFailureAt.trim()
    : typeof input.firstAuditFailureAt === 'string' && input.firstAuditFailureAt.trim() ? input.firstAuditFailureAt.trim() : null;
  const firstFailureMs = normalizeTimestampMs(firstFailureAt);
  const failureAgeMs = generatedAtMs !== null && firstFailureMs !== null ? Math.max(0, generatedAtMs - firstFailureMs) : null;
  const exhausted = retryableReasons.length > 0 && attempt >= maxAttempts;
  const deadlineExceeded = retryableReasons.length > 0
    && generatedAtMs !== null
    && recoveryDeadlineMs !== null
    && generatedAtMs > recoveryDeadlineMs;

  return {
    schema: 'aios.audit-redaction.retry-budget.v1',
    attempt,
    maxAttempts,
    remainingAttempts: Math.max(0, maxAttempts - attempt),
    firstFailureAt,
    failureAgeMs,
    recoveryDeadlineAt,
    recoveryDeadlineMs,
    exhausted,
    deadlineExceeded,
    terminal: exhausted || deadlineExceeded,
    retryableReasons: [...new Set(retryableReasons)]
  };
}

function buildRetryPolicy(reasons, health, retryBudget, generatedAt) {
  const retryableReasons = reasons.filter((reason) => RETRYABLE_FAILURE_REASONS.has(reason));
  if (!retryableReasons.length || retryBudget?.terminal) {
    return {
      retryable: false,
      retryAfterMs: 0,
      retryableReasons,
      budget: retryBudget || null,
      backoff: null,
      nextRetryAt: null
    };
  }

  const attempt = Math.max(1, retryBudget?.attempt || health.failureCount + 1);
  const retryAfterMs = Math.min(30000, 500 * (2 ** Math.min(attempt - 1, 5)));
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  return {
    retryable: true,
    retryAfterMs,
    retryableReasons,
    budget: retryBudget || null,
    backoff: {
      strategy: 'exponential',
      attempt,
      maxDelayMs: 30000,
      jitter: 'hosted-kernel-correlation'
    },
    nextRetryAt: generatedAtMs === null ? null : new Date(generatedAtMs + retryAfterMs).toISOString()
  };
}

function buildActionableErrors(reasons) {
  return [...new Set(reasons)].map((reason) => ({
    reason,
    ...(ACTIONABLE_ERROR_CATALOG[reason] || {
      code: 'AUDIT_REDACTION_FAILURE',
      message: 'Audit redaction could not accept the event.',
      remediation: 'Inspect the proof boundary reasons and retry after correcting the request envelope.',
      retryable: false
    })
  }));
}

function normalizeProviderServiceContract(input = {}, providerInput = {}) {
  const source = providerInput.service && typeof providerInput.service === 'object'
    ? providerInput.service
    : input.providerService && typeof input.providerService === 'object' ? input.providerService : {};
  const requestedType = typeof source.type === 'string' && source.type.trim()
    ? source.type.trim()
    : typeof input.providerServiceType === 'string' && input.providerServiceType.trim() ? input.providerServiceType.trim() : 'hosted-kernel-audit-bridge';
  const type = PROVIDER_SERVICE_TYPES.has(requestedType) ? requestedType : 'hosted-kernel-audit-bridge';
  const requestedAuthMode = typeof source.authMode === 'string' && source.authMode.trim()
    ? source.authMode.trim()
    : typeof input.providerAuthMode === 'string' && input.providerAuthMode.trim() ? input.providerAuthMode.trim() : 'signed-request';
  const authMode = PROVIDER_AUTH_MODES.has(requestedAuthMode) ? requestedAuthMode : 'signed-request';
  const requestedChannel = typeof source.deliveryChannel === 'string' && source.deliveryChannel.trim()
    ? source.deliveryChannel.trim()
    : typeof input.providerDeliveryChannel === 'string' && input.providerDeliveryChannel.trim() ? input.providerDeliveryChannel.trim() : null;
  const deliveryChannel = PROVIDER_DELIVERY_CHANNELS.has(requestedChannel)
    ? requestedChannel
    : type === 'webhook' ? 'https'
      : type === 'event-bus' ? 'queue'
        : type === 'object-store' ? 'object-manifest'
          : type === 'local-kernel' ? 'in-process' : 'stream';
  const endpoint = typeof source.endpoint === 'string' && source.endpoint.trim()
    ? source.endpoint.trim()
    : typeof input.providerEndpoint === 'string' && input.providerEndpoint.trim() ? input.providerEndpoint.trim() : null;
  const tenantBinding = typeof source.tenantBinding === 'string' && source.tenantBinding.trim()
    ? source.tenantBinding.trim()
    : typeof input.providerTenantBinding === 'string' && input.providerTenantBinding.trim() ? input.providerTenantBinding.trim() : null;
  const workspaceBinding = typeof source.workspaceBinding === 'string' && source.workspaceBinding.trim()
    ? source.workspaceBinding.trim()
    : typeof input.providerWorkspaceBinding === 'string' && input.providerWorkspaceBinding.trim() ? input.providerWorkspaceBinding.trim() : null;
  const contractId = typeof source.contractId === 'string' && source.contractId.trim()
    ? source.contractId.trim()
    : typeof input.providerServiceContractId === 'string' && input.providerServiceContractId.trim()
      ? input.providerServiceContractId.trim()
      : null;
  const endpointRequired = deliveryChannel !== 'in-process';
  const issues = [];

  if (requestedType && !PROVIDER_SERVICE_TYPES.has(requestedType)) issues.push('service_type_unsupported');
  if (requestedAuthMode && !PROVIDER_AUTH_MODES.has(requestedAuthMode)) issues.push('auth_mode_unsupported');
  if (requestedChannel && !PROVIDER_DELIVERY_CHANNELS.has(requestedChannel)) issues.push('delivery_channel_unsupported');
  if (endpointRequired && !endpoint) issues.push('endpoint_required');
  if (!tenantBinding) issues.push('tenant_binding_required');
  if (!workspaceBinding) issues.push('workspace_binding_required');

  return {
    schema: 'aios.audit-redaction.provider-service.v1',
    contractId,
    type,
    deliveryChannel,
    endpoint,
    authMode,
    tenantBinding,
    workspaceBinding,
    endpointRequired,
    requiresAcknowledgement: source.requiresAcknowledgement !== false,
    supportsReplay: source.supportsReplay !== false,
    supportsTenantPartitioning: tenantBinding !== null,
    supportsWorkspacePartitioning: workspaceBinding !== null,
    issues,
    valid: issues.length === 0
  };
}

function normalizeProviderContract(input = {}, generatedAt) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const syncInput = providerInput.sync && typeof providerInput.sync === 'object'
    ? providerInput.sync
    : input.providerSync && typeof input.providerSync === 'object' ? input.providerSync : {};
  const providerId = typeof providerInput.id === 'string' && providerInput.id.trim()
    ? providerInput.id.trim()
    : typeof input.providerId === 'string' && input.providerId.trim() ? input.providerId.trim() : '';
  const version = typeof providerInput.version === 'string' && providerInput.version.trim()
    ? providerInput.version.trim()
    : 'unversioned';
  const mode = providerInput.external === true || input.externalHandoff === true ? 'external' : 'local';
  const capabilities = [...new Set(asList(providerInput.capabilities || input.providerCapabilities))].sort();
  const cursor = typeof syncInput.cursor === 'string' && syncInput.cursor.trim() ? syncInput.cursor.trim() : null;
  const checkpointAt = typeof syncInput.checkpointAt === 'string' && syncInput.checkpointAt.trim()
    ? syncInput.checkpointAt.trim()
    : null;
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const checkpointAtMs = normalizeTimestampMs(checkpointAt);
  const checkpointAgeMs = generatedAtMs !== null && checkpointAtMs !== null ? Math.max(0, generatedAtMs - checkpointAtMs) : null;
  const maxCheckpointAgeMs = normalizePositiveInteger(syncInput.maxCheckpointAgeMs ?? input.maxProviderCheckpointAgeMs, 900000);
  const highWatermark = typeof syncInput.highWatermark === 'string' && syncInput.highWatermark.trim()
    ? syncInput.highWatermark.trim()
    : typeof input.providerHighWatermark === 'string' && input.providerHighWatermark.trim() ? input.providerHighWatermark.trim() : null;
  const lowWatermark = typeof syncInput.lowWatermark === 'string' && syncInput.lowWatermark.trim()
    ? syncInput.lowWatermark.trim()
    : typeof input.providerLowWatermark === 'string' && input.providerLowWatermark.trim() ? input.providerLowWatermark.trim() : null;
  const replayCursor = typeof syncInput.replayCursor === 'string' && syncInput.replayCursor.trim()
    ? syncInput.replayCursor.trim()
    : typeof input.providerReplayCursor === 'string' && input.providerReplayCursor.trim() ? input.providerReplayCursor.trim() : cursor;
  const requestedState = typeof providerInput.handoffState === 'string' ? providerInput.handoffState : input.externalHandoffState;
  const handoffState = PROVIDER_HANDOFF_STATES.has(requestedState)
    ? requestedState
    : mode === 'external' ? 'queued' : 'local-only';
  const service = normalizeProviderServiceContract(input, providerInput);

  return {
    id: providerId || null,
    version,
    mode,
    external: mode === 'external',
    capabilities,
    handoffState,
    service,
    sync: {
      cursor,
      checkpointAt,
      checkpointAgeMs,
      maxCheckpointAgeMs,
      highWatermark,
      lowWatermark,
      replayCursor,
      stale: checkpointAgeMs !== null && checkpointAgeMs > maxCheckpointAgeMs,
      checkpointRequired: mode === 'external' && service.supportsReplay
    }
  };
}

function requiredProviderCapabilities(action, lifecycle) {
  const required = new Set(['redaction.apply', 'redaction.proof']);
  if (action === 'audit:write') required.add('audit.write');
  if (action === 'audit:export') required.add('audit.export');
  if (lifecycle?.command?.present) required.add('lifecycle.manage');
  if (lifecycle?.settings?.schedule?.enabled || lifecycle?.settings?.proofRequired) {
    required.add('sync.checkpoint');
  }
  return [...required].sort();
}

function negotiateProviderCapabilities({ provider, action, lifecycle }) {
  const required = requiredProviderCapabilities(action, lifecycle);
  const advertised = new Set(provider.capabilities);
  const missing = required.filter((capability) => !advertised.has(capability));
  const reasons = [];
  if (provider.external && !provider.id) reasons.push('provider_contract_missing');
  if (provider.external && missing.length) reasons.push('provider_capability_unsupported');
  if (provider.external && !provider.service.valid) reasons.push('provider_service_contract_invalid');
  if (provider.external && provider.sync.stale) reasons.push('provider_sync_stale');

  return {
    schema: 'aios.audit-redaction.provider-contract.v1',
    providerId: provider.id,
    providerVersion: provider.version,
    mode: provider.mode,
    requiredCapabilities: required,
    advertisedCapabilities: provider.capabilities,
    missingCapabilities: missing,
    capabilityCatalog: PROVIDER_CAPABILITY_CATALOG,
    serviceContract: provider.service,
    syncMetadata: {
      cursor: provider.sync.cursor,
      checkpointAt: provider.sync.checkpointAt,
      checkpointAgeMs: provider.sync.checkpointAgeMs,
      maxCheckpointAgeMs: provider.sync.maxCheckpointAgeMs,
      highWatermark: provider.sync.highWatermark,
      lowWatermark: provider.sync.lowWatermark,
      replayCursor: provider.sync.replayCursor,
      stale: provider.sync.stale,
      checkpointRequired: provider.sync.checkpointRequired
    },
    dispatchRequirements: {
      requiresEndpoint: provider.service.endpointRequired,
      requiresAcknowledgement: provider.service.requiresAcknowledgement,
      requiresReplayCursor: provider.external && provider.service.supportsReplay,
      requiresTenantBinding: true,
      requiresWorkspaceBinding: true
    },
    accepted: reasons.length === 0,
    reasons
  };
}

function buildExternalHandoffState({ provider, negotiation, failureState, deliveryMode, auditHandoff }) {
  const blocked = failureState.blocked || negotiation.reasons.length > 0;
  const state = blocked
    ? 'blocked'
    : deliveryMode === 'degraded-buffered' ? 'degraded' : provider.handoffState;
  const providerEnvelope = {
    schema: 'aios.audit-redaction.provider-dispatch-envelope.v1',
    providerId: provider.id,
    serviceContractId: provider.service.contractId,
    serviceType: provider.service.type,
    deliveryChannel: provider.service.deliveryChannel,
    endpoint: provider.service.endpoint,
    authMode: provider.service.authMode,
    tenantBinding: provider.service.tenantBinding,
    workspaceBinding: provider.service.workspaceBinding,
    acknowledgementRequired: provider.service.requiresAcknowledgement,
    replayCursor: provider.sync.replayCursor,
    highWatermark: provider.sync.highWatermark,
    lowWatermark: provider.sync.lowWatermark,
    workspaceRoutes: auditHandoff.workspaceHandoffRouting.handoffPartitions,
    proofOnlyRoutes: auditHandoff.workspaceHandoffRouting.proofOnlyPartitions,
    routeIsolationMode: auditHandoff.workspaceHandoffRouting.isolationMode
  };

  return {
    schema: 'aios.audit-redaction.external-handoff.v1',
    state,
    providerId: provider.id,
    destination: auditHandoff.destination,
    correlationId: auditHandoff.correlationId,
    external: provider.external,
    syncCursor: provider.sync.cursor,
    checkpointAt: provider.sync.checkpointAt,
    service: provider.service,
    dispatchEnvelope: providerEnvelope,
    dispatchReady: !blocked && auditHandoff.workspaceHandoffRouting.commitReady && (!provider.external || negotiation.accepted),
    acknowledgementExpected: provider.external && provider.service.requiresAcknowledgement,
    nextStep: blocked
      ? 'resolve-provider-contract'
      : !auditHandoff.workspaceHandoffRouting.commitReady ? 'resolve-workspace-routing'
        : provider.external ? 'dispatch-to-provider' : 'retain-in-hosted-kernel',
    reasons: [...new Set(failureState.reasons.concat(negotiation.reasons))]
  };
}

function normalizeClientRuntime(input = {}, generatedAt) {
  const requestInput = input.request && typeof input.request === 'object' ? input.request : {};
  const clientInput = input.client && typeof input.client === 'object' ? input.client : {};
  const workflowInput = input.workflow && typeof input.workflow === 'object' ? input.workflow : {};
  const requestId = typeof requestInput.id === 'string' && requestInput.id.trim()
    ? requestInput.id.trim()
    : typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : null;
  const clientSessionId = typeof clientInput.sessionId === 'string' && clientInput.sessionId.trim()
    ? clientInput.sessionId.trim()
    : typeof input.clientSessionId === 'string' && input.clientSessionId.trim() ? input.clientSessionId.trim() : null;
  const surfaceRoute = typeof workflowInput.route === 'string' && workflowInput.route.trim()
    ? workflowInput.route.trim()
    : typeof input.route === 'string' && input.route.trim() ? input.route.trim() : 'capability-security/audit-redaction';
  const requestedState = typeof workflowInput.state === 'string' && workflowInput.state.trim()
    ? workflowInput.state.trim()
    : typeof input.clientHandoffState === 'string' ? input.clientHandoffState.trim() : '';

  return {
    schema: 'aios.audit-redaction.client-runtime.v1',
    requestId,
    clientSessionId,
    surfaceRoute,
    rawRequestedState: requestedState || null,
    requestedState: CLIENT_HANDOFF_STATES.has(requestedState) ? requestedState : null,
    source: typeof requestInput.source === 'string' && requestInput.source.trim()
      ? requestInput.source.trim()
      : typeof clientInput.source === 'string' && clientInput.source.trim() ? clientInput.source.trim() : 'hosted-kernel-client',
    viewport: typeof clientInput.viewport === 'string' && clientInput.viewport.trim() ? clientInput.viewport.trim() : null,
    traceparent: typeof requestInput.traceparent === 'string' && requestInput.traceparent.trim()
      ? requestInput.traceparent.trim()
      : typeof input.traceparent === 'string' && input.traceparent.trim() ? input.traceparent.trim() : null,
    startedAt: typeof requestInput.startedAt === 'string' && requestInput.startedAt.trim() ? requestInput.startedAt.trim() : generatedAt
  };
}

function deriveClientAuthoritativeState({ workflowHandoff, previewAcceptance, externalHandoff }) {
  if (previewAcceptance.readiness.state === 'blocked' || workflowHandoff.state === 'blocked') return 'blocked';
  if (workflowHandoff.state === 'degraded' || externalHandoff.state === 'degraded') return 'degraded';
  if (workflowHandoff.state === 'queued' || externalHandoff.state === 'queued') return 'queued';
  if (previewAcceptance.acceptance.status === 'awaiting-acceptance' || previewAcceptance.acceptance.status === 'preview-only') {
    return 'draft';
  }
  if (previewAcceptance.readiness.canCommit && previewAcceptance.acceptance.commitToken) return 'submitting';
  return 'complete';
}

function buildClientHandoffStateContract({
  clientRuntime,
  workflowHandoff,
  previewAcceptance,
  externalHandoff,
  persistedState,
  auditProofBundle,
  generatedAt
}) {
  const authoritativeState = deriveClientAuthoritativeState({
    workflowHandoff,
    previewAcceptance,
    externalHandoff
  });
  const requestedState = clientRuntime.requestedState;
  const requestedStateKnown = clientRuntime.rawRequestedState === null || requestedState !== null;
  const allowedNextStates = CLIENT_HANDOFF_TRANSITIONS[authoritativeState] || [];
  const requestedTransitionAccepted = requestedState === null
    || requestedState === authoritativeState
    || allowedNextStates.includes(requestedState);
  const stateMismatch = requestedState !== null && requestedState !== authoritativeState;
  const invalidRequestedState = !requestedStateKnown;
  const blockedGateIds = previewAcceptance.readiness.blockedGateIds;
  const patchOperations = [];

  if (requestedState !== authoritativeState) {
    patchOperations.push({
      op: 'replace',
      path: '/workflow/state',
      value: authoritativeState
    });
  }
  if (workflowHandoff.resume.persistedCursor) {
    patchOperations.push({
      op: 'replace',
      path: '/workflow/persistedCursor',
      value: workflowHandoff.resume.persistedCursor
    });
  }
  if (auditProofBundle.evidenceId) {
    patchOperations.push({
      op: 'replace',
      path: '/workflow/proofBundleId',
      value: auditProofBundle.evidenceId
    });
  }

  return {
    schema: 'aios.audit-redaction.client-handoff-state.v1',
    generatedAt,
    route: clientRuntime.surfaceRoute,
    request: {
      id: clientRuntime.requestId,
      clientSessionId: clientRuntime.clientSessionId,
      traceparent: clientRuntime.traceparent,
      source: clientRuntime.source,
      startedAt: clientRuntime.startedAt
    },
    requested: {
      rawState: clientRuntime.rawRequestedState,
      state: requestedState,
      valid: requestedStateKnown,
      accepted: requestedTransitionAccepted && !invalidRequestedState
    },
    authoritative: {
      state: authoritativeState,
      workflowState: workflowHandoff.state,
      externalState: externalHandoff.state,
      previewStatus: previewAcceptance.acceptance.status,
      persistedStatus: persistedState.next.status,
      persistedCursor: persistedState.next.cursor
    },
    transition: {
      mismatch: stateMismatch || invalidRequestedState,
      allowedNextStates,
      requestedTransitionAccepted: requestedTransitionAccepted && !invalidRequestedState,
      requiresClientPatch: patchOperations.length > 0 || invalidRequestedState,
      reason: invalidRequestedState
        ? 'client-state-unsupported'
        : stateMismatch ? 'server-authoritative-state-differs' : null
    },
    userVisible: {
      title: workflowHandoff.userVisible.title,
      primaryAction: workflowHandoff.primaryAction,
      nextStep: workflowHandoff.userVisible.nextStep,
      blockedGateIds,
      retryable: workflowHandoff.userVisible.retryable
    },
    resume: {
      token: workflowHandoff.resume.token,
      action: workflowHandoff.resume.action,
      retryAfterMs: workflowHandoff.resume.retryAfterMs,
      allowedCommands: workflowHandoff.resume.allowedCommands,
      exportManifestId: workflowHandoff.resume.exportManifestId,
      restartStatus: workflowHandoff.resume.restartStatus
    },
    patch: {
      schema: 'aios.audit-redaction.client-state-patch.v1',
      operations: patchOperations,
      proofBundleId: auditProofBundle.evidenceId,
      persistedCursor: persistedState.next.cursor
    }
  };
}

function buildWorkflowHandoff({ clientRuntime, scope, action, deliveryMode, failureState, lifecycle, provider, externalHandoff, auditHandoff, persistedState, exportManifest, generatedAt }) {
  const blockerCodes = failureState.actionableErrors.map((error) => error.code);
  const retryable = failureState.retryPolicy.retryable;
  const duplicateCommand = persistedState?.command?.duplicate === true;
  const state = failureState.blocked
    ? 'blocked'
    : duplicateCommand ? 'complete'
      : failureState.degradedBuffered ? 'degraded' : provider.external ? 'queued' : 'complete';
  const lane = failureState.blocked
    ? 'operator-review'
    : duplicateCommand ? 'restart-safe-ack'
      : lifecycle.commandApplied ? 'lifecycle-control'
      : provider.external ? 'provider-dispatch' : 'hosted-kernel-capture';
  const primaryAction = failureState.blocked
    ? 'show-remediation'
    : retryable ? 'schedule-retry'
      : duplicateCommand ? 'show-idempotent-confirmation'
        : lifecycle.commandApplied ? 'show-lifecycle-confirmation'
        : provider.external ? 'show-provider-handoff' : 'show-capture-confirmation';
  const resumeTokenParts = [
    surfaceId,
    scope.tenantId || 'unscoped',
    scope.workspaceId || 'unscoped',
    auditHandoff.correlationId
  ];

  return {
    schema: 'aios.audit-redaction.workflow-handoff.v1',
    state,
    lane,
    primaryAction,
    route: clientRuntime.surfaceRoute,
    generatedAt,
    request: {
      id: clientRuntime.requestId,
      clientSessionId: clientRuntime.clientSessionId,
      traceparent: clientRuntime.traceparent,
      source: clientRuntime.source,
      startedAt: clientRuntime.startedAt
    },
    scope: {
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null
    },
    handoff: {
      correlationId: auditHandoff.correlationId,
      deliveryMode,
      destination: auditHandoff.destination,
      externalState: externalHandoff.state,
      providerId: provider.id,
      syncCursor: provider.sync.cursor
    },
    userVisible: {
      title: failureState.blocked
        ? 'Audit handoff needs attention'
        : action === 'audit:export' ? 'Audit export manifest ready'
        : state === 'degraded' ? 'Audit event buffered'
          : provider.external ? 'Audit event queued for provider handoff' : 'Audit event captured',
      nextStep: failureState.blocked
        ? 'Resolve the listed audit redaction blockers before retrying.'
        : action === 'audit:export' && exportManifest?.ready ? 'Download or dispatch the hosted-kernel redacted export manifest.'
        : duplicateCommand ? 'This lifecycle command was already applied from persisted state.'
        : retryable ? 'The hosted kernel can retry when the audit sink is ready.'
          : externalHandoff.nextStep,
      blockerCodes,
      retryable
    },
    resume: {
      token: resumeTokenParts.join(':'),
      action,
      retryAfterMs: failureState.retryPolicy.retryAfterMs,
      allowedCommands: lifecycle.commandApplied || duplicateCommand ? [] : ['run-now', 'schedule', 'resume'],
      requiresProviderRefresh: failureState.reasons.includes('provider_sync_stale'),
      persistedCursor: persistedState?.next?.cursor || null,
      exportManifestId: exportManifest?.manifestId || null,
      restartStatus: persistedState?.restart?.status || 'fresh'
    }
  };
}

function normalizeAcceptanceInput(input = {}, generatedAt) {
  const source = input.acceptance && typeof input.acceptance === 'object'
    ? input.acceptance
    : input.previewAcceptance && typeof input.previewAcceptance === 'object' ? input.previewAcceptance : {};
  const decision = typeof source.decision === 'string' && source.decision.trim()
    ? source.decision.trim().toLowerCase()
    : input.acceptPreview === true ? 'accepted' : input.rejectPreview === true ? 'rejected' : null;

  return {
    schema: 'aios.audit-redaction.preview-acceptance.input.v1',
    previewOnly: input.previewOnly === true || source.previewOnly === true,
    decision: decision === 'accepted' || decision === 'rejected' ? decision : null,
    accepted: decision === 'accepted',
    rejected: decision === 'rejected',
    actorId: typeof source.actorId === 'string' && source.actorId.trim()
      ? source.actorId.trim()
      : typeof input.actorId === 'string' && input.actorId.trim() ? input.actorId.trim() : null,
    decidedAt: typeof source.decidedAt === 'string' && source.decidedAt.trim()
      ? source.decidedAt.trim()
      : decision ? generatedAt : null,
    reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : null
  };
}

function buildReadinessGate(id, label, passed, reasons = [], nextStep = 'continue') {
  return {
    id,
    label,
    state: passed ? 'passed' : 'blocked',
    passed,
    reasons: [...new Set(reasons)],
    nextStep
  };
}

function summarizeReasonCatalog(reasons) {
  return [...new Set(reasons)].map((reason) => {
    const catalog = ACTIONABLE_ERROR_CATALOG[reason];
    return {
      reason,
      code: catalog?.code || 'AUDIT_REDACTION_FAILURE',
      retryable: catalog?.retryable === true,
      remediation: catalog?.remediation || 'Inspect the audit redaction proof and retry with a corrected request envelope.'
    };
  });
}

function buildPreviewAcceptanceContract({
  input,
  scope,
  action,
  redactionFields,
  redactionPaths,
  boundary,
  eventValidation,
  auditSinkHealth,
  lifecycle,
  provider,
  providerNegotiation,
  exportRequest,
  exportManifest,
  failureState,
  workflowHandoff,
  operationalHealth,
  operationalRecovery,
  persistedState,
  auditHandoff,
  deliveryMode,
  generatedAt
}) {
  const acceptanceInput = normalizeAcceptanceInput(input, generatedAt);
  const requiresAcceptance = action === 'audit:export'
    || lifecycle.command.present
    || provider.external
    || acceptanceInput.previewOnly
    || input.requirePreviewAcceptance === true;
  const readinessGates = [
    buildReadinessGate('scope', 'Tenant and workspace boundary', boundary.allowed, boundary.reasons, 'fix-scope-or-grants'),
    buildReadinessGate('event', 'Audit event envelope', eventValidation.valid, eventValidation.valid ? [] : [eventValidation.reason], 'send-object-event-envelope'),
    buildReadinessGate('lifecycle', 'Lifecycle controls', lifecycle.reasons.length === 0, lifecycle.reasons, lifecycle.nextAction),
    buildReadinessGate('provider', 'Provider contract', providerNegotiation.accepted, providerNegotiation.reasons, 'refresh-provider-contract'),
    buildReadinessGate(
      'export',
      'Export request',
      !exportRequest.requested || exportRequest.valid,
      exportRequest.requested ? exportRequest.reasons.concat(exportRequest.issues) : [],
      'correct-export-window-or-scope'
    ),
    buildReadinessGate(
      'sink',
      'Audit sink delivery',
      auditSinkHealth.ok || failureState.degradedBuffered,
      auditSinkHealth.reasons,
      failureState.degradedBuffered ? 'buffer-and-drain' : operationalRecovery.mode
    ),
    buildReadinessGate(
      'operational-health',
      'Hosted-kernel dependency health',
      operationalHealth.ok || failureState.degradedBuffered,
      operationalHealth.reasons,
      failureState.degradedBuffered ? 'buffer-and-drain' : operationalRecovery.mode
    ),
    buildReadinessGate('persistence', 'Restart-safe persistence', persistedState.restart.safe, [], persistedState.restart.status)
  ];
  const blockingGates = readinessGates.filter((gate) => !gate.passed);
  const accepted = acceptanceInput.accepted && !failureState.blocked;
  const rejected = acceptanceInput.rejected;
  const canCommit = !failureState.blocked
    && !rejected
    && !acceptanceInput.previewOnly
    && (!requiresAcceptance || accepted);
  const acceptanceStatus = failureState.blocked
    ? 'blocked'
    : rejected ? 'rejected'
      : acceptanceInput.previewOnly ? 'preview-only'
        : requiresAcceptance && !accepted ? 'awaiting-acceptance'
          : requiresAcceptance ? 'accepted' : 'not-required';
  const redactionPreviewPaths = redactionPaths.slice(0, 12);
  const validationReasons = failureState.reasons.concat(exportRequest.issues);

  return {
    schema: 'aios.audit-redaction.preview-acceptance.v1',
    generatedAt,
    route: workflowHandoff.route,
    preview: {
      title: workflowHandoff.userVisible.title,
      state: workflowHandoff.state,
      lane: workflowHandoff.lane,
      deliveryMode,
      action,
      destination: auditHandoff.destination,
      correlationId: auditHandoff.correlationId,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
      redaction: {
        fields: redactionFields,
        count: redactionPaths.length,
        previewPaths: redactionPreviewPaths,
        truncated: redactionPaths.length > redactionPreviewPaths.length
      },
      lifecycle: {
        command: lifecycle.command.present ? lifecycle.command.name : null,
        changes: lifecycle.controlChanges,
        nextAction: lifecycle.nextAction,
        commitRequired: lifecycle.controlPlan.commitRequired,
        scheduleRuntime: {
          due: lifecycle.scheduleRuntime.due,
          missedRunCount: lifecycle.scheduleRuntime.missedRunCount,
          dispatchAction: lifecycle.scheduleRuntime.dispatch.action
        }
      },
      export: {
        requested: exportRequest.requested,
        status: exportManifest.status,
        ready: exportManifest.ready,
        manifestId: exportManifest.manifestId,
        format: exportManifest.format,
        workspaceIds: exportManifest.workspaceIds
      },
      provider: {
        external: provider.external,
        providerId: provider.id,
        handoffState: provider.handoffState,
        serviceType: provider.service.type,
        deliveryChannel: provider.service.deliveryChannel,
        serviceIssues: provider.service.issues,
        missingCapabilities: providerNegotiation.missingCapabilities
      }
    },
    readiness: {
      state: failureState.state,
      ready: blockingGates.length === 0,
      canCommit,
      gates: readinessGates,
      blockedGateIds: blockingGates.map((gate) => gate.id),
      degradedBuffered: failureState.degradedBuffered,
      recoveryMode: operationalRecovery.mode
    },
    validationSummary: {
      valid: blockingGates.length === 0,
      issueCount: validationReasons.length,
      blockingReasonCount: failureState.reasons.length,
      retryable: failureState.retryPolicy.retryable,
      retryAfterMs: failureState.retryPolicy.retryAfterMs,
      reasons: summarizeReasonCatalog(validationReasons),
      eventEnvelope: eventValidation.valid ? 'valid' : 'invalid',
      lifecycleSettings: lifecycle.settingsValid ? 'valid' : 'invalid',
      exportRequest: !exportRequest.requested ? 'not-requested' : exportRequest.valid ? 'valid' : 'invalid',
      providerContract: providerNegotiation.accepted ? 'accepted' : 'blocked',
      operationalHealth: operationalHealth.ok ? 'healthy' : failureState.degradedBuffered ? 'degraded-buffered' : 'blocked'
    },
    acceptance: {
      required: requiresAcceptance,
      status: acceptanceStatus,
      accepted,
      rejected,
      previewOnly: acceptanceInput.previewOnly,
      actorId: acceptanceInput.actorId,
      decidedAt: acceptanceInput.decidedAt,
      reason: acceptanceInput.reason,
      commitToken: canCommit ? workflowHandoff.resume.token : null,
      commitAction: canCommit
        ? workflowHandoff.primaryAction
        : failureState.blocked ? 'resolve-blockers'
          : rejected ? 'restart-preview'
            : acceptanceInput.previewOnly ? 'request-acceptance'
              : requiresAcceptance ? 'collect-acceptance' : 'continue'
    },
    nextSteps: canCommit
      ? [{
          id: 'commit',
          label: workflowHandoff.userVisible.nextStep,
          action: workflowHandoff.primaryAction,
          token: workflowHandoff.resume.token
        }]
      : blockingGates.map((gate) => ({
          id: gate.id,
          label: gate.label,
          action: gate.nextStep,
          reasons: gate.reasons,
          retryable: gate.reasons.some((reason) => ACTIONABLE_ERROR_CATALOG[reason]?.retryable === true)
      }))
  };
}

function buildClientPreviewRouteContract({
  previewAcceptance,
  workflowHandoff,
  clientHandoffState,
  auditProofBundle,
  externalHandoff,
  persistedState,
  exportManifest,
  generatedAt
}) {
  const acceptance = previewAcceptance.acceptance;
  const readiness = previewAcceptance.readiness;
  const blockedSteps = previewAcceptance.nextSteps.filter((step) => Array.isArray(step.reasons) && step.reasons.length > 0);
  const commitEnabled = readiness.canCommit && acceptance.commitToken !== null;
  const acceptEnabled = acceptance.required
    && acceptance.status === 'awaiting-acceptance'
    && readiness.ready
    && !acceptance.previewOnly;
  const previewMode = acceptance.previewOnly || acceptance.status === 'preview-only';
  const routeState = readiness.ready
    ? commitEnabled ? 'commit-ready'
      : acceptEnabled ? 'acceptance-required'
        : previewMode ? 'preview'
          : acceptance.status
    : 'blocked';
  const disabledReasons = [];

  if (!readiness.ready) disabledReasons.push('readiness-blocked');
  if (acceptance.rejected) disabledReasons.push('preview-rejected');
  if (acceptance.previewOnly) disabledReasons.push('preview-only');
  if (acceptance.required && acceptance.status !== 'accepted') disabledReasons.push('acceptance-not-recorded');

  return {
    schema: 'aios.audit-redaction.client-preview-route.v1',
    generatedAt,
    route: workflowHandoff.route,
    state: routeState,
    surface: {
      id: surfaceId,
      group: surfaceGroup,
      name: surfaceName
    },
    render: {
      title: previewAcceptance.preview.title,
      lane: previewAcceptance.preview.lane,
      primaryAction: commitEnabled
        ? acceptance.commitAction
        : acceptEnabled ? 'accept-preview'
          : previewMode ? 'show-preview' : workflowHandoff.primaryAction,
      severity: readiness.ready
        ? previewAcceptance.validationSummary.retryable ? 'warning' : 'info'
        : blockedSteps.some((step) => step.retryable) ? 'retryable-blocker' : 'blocking',
      badges: [
        readiness.state,
        clientHandoffState.authoritative.state,
        previewAcceptance.preview.deliveryMode,
        acceptance.status,
        previewAcceptance.validationSummary.providerContract,
        previewAcceptance.validationSummary.operationalHealth
      ].filter(Boolean),
      redactionSummary: {
        count: previewAcceptance.preview.redaction.count,
        previewPaths: previewAcceptance.preview.redaction.previewPaths,
        truncated: previewAcceptance.preview.redaction.truncated
      }
    },
    clientState: {
      schema: clientHandoffState.schema,
      requested: clientHandoffState.requested,
      authoritative: clientHandoffState.authoritative,
      transition: clientHandoffState.transition,
      patch: clientHandoffState.patch,
      resume: clientHandoffState.resume
    },
    controls: {
      accept: {
        enabled: acceptEnabled,
        action: 'accept-preview',
        disabledReasons: acceptEnabled ? [] : disabledReasons,
        payloadSchema: 'aios.audit-redaction.preview-acceptance.input.v1'
      },
      reject: {
        enabled: acceptance.status !== 'accepted' && !readiness.canCommit,
        action: 'reject-preview',
        payloadSchema: 'aios.audit-redaction.preview-acceptance.input.v1'
      },
      commit: {
        enabled: commitEnabled,
        action: acceptance.commitAction,
        token: acceptance.commitToken,
        disabledReasons: commitEnabled ? [] : disabledReasons,
        payloadSchema: 'aios.audit-redaction.commit-request.v1'
      }
    },
    payloadContracts: {
      acceptPreview: {
        schema: 'aios.audit-redaction.preview-acceptance.input.v1',
        requiredFields: ['acceptance.decision'],
        example: {
          acceptance: {
            decision: 'accepted',
            decidedAt: generatedAt,
            actorId: acceptance.actorId || 'current-actor'
          }
        }
      },
      rejectPreview: {
        schema: 'aios.audit-redaction.preview-acceptance.input.v1',
        requiredFields: ['acceptance.decision', 'acceptance.reason'],
        example: {
          acceptance: {
            decision: 'rejected',
            decidedAt: generatedAt,
            reason: 'operator-requested-changes'
          }
        }
      },
      commitRequest: {
        schema: 'aios.audit-redaction.commit-request.v1',
        requiredFields: ['commitToken', 'proofBundleId', 'persistedCursor'],
        example: {
          commitToken: acceptance.commitToken,
          proofBundleId: auditProofBundle.evidenceId,
          persistedCursor: persistedState.next.cursor
        }
      }
    },
    validation: {
      summary: previewAcceptance.validationSummary,
      blockedGateIds: readiness.blockedGateIds,
      gates: readiness.gates.map((gate) => ({
        id: gate.id,
        state: gate.state,
        passed: gate.passed,
        reasonCount: gate.reasons.length,
        nextStep: gate.nextStep
      }))
    },
    nextSteps: previewAcceptance.nextSteps.map((step, index) => ({
      order: index + 1,
      id: step.id,
      label: step.label,
      action: step.action,
      token: step.token || null,
      retryable: step.retryable === true,
      reasonCodes: asList(step.reasons).map((reason) => ACTIONABLE_ERROR_CATALOG[reason]?.code || reason)
    })),
    evidence: {
      proofBundleId: auditProofBundle.evidenceId,
      proofSchema: auditProofBundle.schema,
      coveredSchemas: auditProofBundle.coveredSchemas,
      commitEligible: auditProofBundle.commitEligible,
      externalHandoffState: externalHandoff.state,
      clientHandoffState: clientHandoffState.authoritative.state,
      clientStatePatchRequired: clientHandoffState.transition.requiresClientPatch,
      persistedCursor: persistedState.next.cursor,
      persistedStatus: persistedState.next.status,
      persistedRestartStatus: persistedState.restart.status,
      persistedRecoveryCommand: persistedState.recoveryCommand.present ? persistedState.recoveryCommand.name : null,
      persistedRecoveryDisposition: persistedState.recoveryCommand.disposition,
      persistedRestartOperatorAction: persistedState.restartSafeStatus.operatorAction,
      exportManifestId: exportManifest.manifestId,
      exportManifestReady: exportManifest.ready
    }
  };
}

function normalizePersistedStatus(value, fallback = 'initialized') {
  return typeof value === 'string' && PERSISTED_AUDIT_STATUSES.has(value) ? value : fallback;
}

function normalizePersistedCommandReceipt(entry = {}, index = 0) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const key = typeof source.key === 'string' && source.key.trim()
    ? source.key.trim()
    : typeof source.commandKey === 'string' && source.commandKey.trim() ? source.commandKey.trim() : null;
  return {
    key,
    commandId: typeof source.commandId === 'string' && source.commandId.trim() ? source.commandId.trim() : null,
    appliedAt: typeof source.appliedAt === 'string' && source.appliedAt.trim() ? source.appliedAt.trim() : null,
    disposition: typeof source.disposition === 'string' && source.disposition.trim()
      ? source.disposition.trim()
      : index === 0 ? 'applied' : 'replayed',
    cursor: typeof source.cursor === 'string' && source.cursor.trim() ? source.cursor.trim() : null,
    sequence: normalizePositiveInteger(source.sequence, 0)
  };
}

function normalizeRecoveryCommand(input = {}) {
  const commandInput = input.recoveryCommand || input.restartCommand || input.persistenceCommand || null;
  const source = commandInput && typeof commandInput === 'object' ? commandInput : {};
  const commandName = typeof commandInput === 'string'
    ? commandInput.trim()
    : typeof source.name === 'string' ? source.name.trim() : '';
  const normalizedName = commandName.toLowerCase();
  const present = Boolean(normalizedName);
  const supported = !present || RECOVERY_COMMANDS.has(normalizedName);

  return {
    schema: 'aios.audit-redaction.recovery-command.v1',
    present,
    name: supported ? normalizedName : commandName,
    supported,
    commandId: typeof source.commandId === 'string' && source.commandId.trim()
      ? source.commandId.trim()
      : typeof source.id === 'string' && source.id.trim() ? source.id.trim() : null,
    requestedBy: typeof source.requestedBy === 'string' && source.requestedBy.trim()
      ? source.requestedBy.trim()
      : input.actorId || null,
    reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : null,
    expectedCursor: typeof source.expectedCursor === 'string' && source.expectedCursor.trim()
      ? source.expectedCursor.trim()
      : typeof input.expectedRecoveryCursor === 'string' && input.expectedRecoveryCursor.trim() ? input.expectedRecoveryCursor.trim() : null,
    force: source.force === true || input.forceRecovery === true
  };
}

function normalizePersistedStateInput(input = {}) {
  const source = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.stateSnapshot && typeof input.stateSnapshot === 'object' ? input.stateSnapshot : {};
  const sequence = normalizePositiveInteger(source.sequence ?? source.version, 0);
  const appliedCommandKeys = asList(source.appliedCommandKeys || source.commandKeys);
  const commandReceipts = Array.isArray(source.commandReceipts)
    ? source.commandReceipts.map((entry, index) => normalizePersistedCommandReceipt(entry, index)).filter((entry) => entry.key)
    : [];
  const lastCorrelationId = typeof source.lastCorrelationId === 'string' && source.lastCorrelationId.trim()
    ? source.lastCorrelationId.trim()
    : typeof source.correlationId === 'string' && source.correlationId.trim() ? source.correlationId.trim() : null;
  const cursor = typeof source.cursor === 'string' && source.cursor.trim()
    ? source.cursor.trim()
    : typeof source.recoveryCursor === 'string' && source.recoveryCursor.trim() ? source.recoveryCursor.trim() : null;
  const pendingDispatch = source.pendingDispatch && typeof source.pendingDispatch === 'object' ? source.pendingDispatch : {};
  const lock = source.lock && typeof source.lock === 'object' ? source.lock : {};

  return {
    schema: 'aios.audit-redaction.persisted-state.input.v1',
    present: Object.keys(source).length > 0,
    status: normalizePersistedStatus(source.status),
    sequence,
    cursor,
    lastCorrelationId,
    appliedCommandKeys: [...new Set(appliedCommandKeys.concat(commandReceipts.map((receipt) => receipt.key)))],
    commandReceipts,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt.trim() ? source.updatedAt.trim() : null,
    recoveryReason: typeof source.recoveryReason === 'string' && source.recoveryReason.trim() ? source.recoveryReason.trim() : null,
    recoveryAttempts: normalizePositiveInteger(source.recoveryAttempts ?? source.restartAttempts, 0),
    proofBundleId: typeof source.proofBundleId === 'string' && source.proofBundleId.trim() ? source.proofBundleId.trim() : null,
    pendingDispatch: {
      correlationId: typeof pendingDispatch.correlationId === 'string' && pendingDispatch.correlationId.trim()
        ? pendingDispatch.correlationId.trim()
        : lastCorrelationId,
      providerId: typeof pendingDispatch.providerId === 'string' && pendingDispatch.providerId.trim() ? pendingDispatch.providerId.trim() : null,
      destination: typeof pendingDispatch.destination === 'string' && pendingDispatch.destination.trim() ? pendingDispatch.destination.trim() : null,
      cursor: typeof pendingDispatch.cursor === 'string' && pendingDispatch.cursor.trim() ? pendingDispatch.cursor.trim() : cursor,
      acknowledgedAt: typeof pendingDispatch.acknowledgedAt === 'string' && pendingDispatch.acknowledgedAt.trim()
        ? pendingDispatch.acknowledgedAt.trim()
        : null
    },
    lock: {
      owner: typeof lock.owner === 'string' && lock.owner.trim() ? lock.owner.trim() : null,
      acquiredAt: typeof lock.acquiredAt === 'string' && lock.acquiredAt.trim() ? lock.acquiredAt.trim() : null,
      expiresAt: typeof lock.expiresAt === 'string' && lock.expiresAt.trim() ? lock.expiresAt.trim() : null
    }
  };
}

function buildLifecycleCommandKey({ scope, lifecycle, action }) {
  if (!lifecycle.command.present) return null;
  const command = lifecycle.command;
  if (command.commandId) {
    return [
      surfaceId,
      scope.tenantId || 'unscoped',
      scope.workspaceId || 'unscoped',
      action,
      'command-id',
      command.commandId
    ].join('|');
  }
  return [
    surfaceId,
    scope.tenantId || 'unscoped',
    scope.workspaceId || 'unscoped',
    action,
    command.name,
    command.effectiveAt || 'immediate',
    command.requestedBy || 'unknown',
    command.reason || 'no-reason'
  ].join('|');
}

function buildRecoveryCommandKey({ scope, action, command }) {
  if (!command.present) return null;
  return [
    surfaceId,
    scope.tenantId || 'unscoped',
    scope.workspaceId || 'unscoped',
    action,
    'recovery',
    command.name,
    command.commandId || command.expectedCursor || 'no-command-id'
  ].join('|');
}

function deriveNextPersistedStatus({ failureState, deliveryMode, provider, lifecycle, duplicateCommand, recoveryCommand, recoveryDisposition }) {
  if (recoveryCommand.present && recoveryCommand.supported && recoveryDisposition === 'apply-once') {
    if (recoveryCommand.name === 'dead-letter') return 'dead-lettered';
    if (recoveryCommand.name === 'mark-complete' || recoveryCommand.name === 'ack-dispatch') return 'complete';
    if (recoveryCommand.name === 'recover') return 'recovering';
    if (recoveryCommand.name === 'clear-recovery') return failureState.blocked ? 'blocked' : 'captured';
  }
  if (failureState.blocked) return 'blocked';
  if (duplicateCommand) return 'complete';
  if (deliveryMode === 'degraded-buffered') return 'buffered';
  if (provider.external) return 'dispatching';
  if (lifecycle.commandApplied) return 'complete';
  return 'captured';
}

function buildRecoveryDisposition({ previous, scope, action, recoveryCommand }) {
  const recoveryKey = buildRecoveryCommandKey({
    scope,
    action,
    command: recoveryCommand
  });
  const duplicate = Boolean(recoveryKey && previous.appliedCommandKeys.includes(recoveryKey));
  const expectedCursorMismatch = Boolean(
    recoveryCommand.expectedCursor
    && previous.cursor
    && recoveryCommand.expectedCursor !== previous.cursor
  );
  const activeRecoveryStatus = previous.status === 'recovery-pending' || previous.status === 'recovering';
  const canApply = recoveryCommand.present
    && recoveryCommand.supported
    && !duplicate
    && (!expectedCursorMismatch || recoveryCommand.force)
    && (activeRecoveryStatus || recoveryCommand.name === 'dead-letter' || recoveryCommand.name === 'clear-recovery');
  const reasons = [];

  if (recoveryCommand.present && !recoveryCommand.supported) reasons.push('recovery_command_unsupported');
  if (duplicate) reasons.push('recovery_command_duplicate');
  if (expectedCursorMismatch && !recoveryCommand.force) reasons.push('recovery_cursor_mismatch');
  if (recoveryCommand.present && recoveryCommand.supported && !activeRecoveryStatus && !['dead-letter', 'clear-recovery'].includes(recoveryCommand.name)) {
    reasons.push('recovery_not_active');
  }

  return {
    key: recoveryKey,
    duplicate,
    expectedCursorMismatch,
    activeRecoveryStatus,
    disposition: !recoveryCommand.present
      ? 'not-requested'
      : canApply ? 'apply-once'
        : duplicate ? 'already-applied' : 'blocked',
    applied: canApply,
    reasons
  };
}

function buildPersistedStateContract({ input, scope, action, lifecycle, provider, failureState, auditHandoff, deliveryMode, generatedAt }) {
  const previous = normalizePersistedStateInput(input);
  const recoveryCommand = normalizeRecoveryCommand(input);
  const commandKey = buildLifecycleCommandKey({ scope, lifecycle, action });
  const recoveryDisposition = buildRecoveryDisposition({ previous, scope, action, recoveryCommand });
  const duplicateCommand = Boolean(commandKey && previous.appliedCommandKeys.includes(commandKey));
  const nextStatus = deriveNextPersistedStatus({
    failureState,
    deliveryMode,
    provider,
    lifecycle,
    duplicateCommand,
    recoveryCommand,
    recoveryDisposition: recoveryDisposition.disposition
  });
  const restartNeeded = previous.status === 'recovery-pending'
    || previous.status === 'recovering'
    || (previous.present && previous.status === 'dispatching' && nextStatus !== 'dispatching');
  const statusChanged = previous.status !== nextStatus;
  const commandMutated = lifecycle.commandApplied && !duplicateCommand;
  const recoveryMutated = recoveryDisposition.applied;
  const nextSequence = previous.sequence + (duplicateCommand && !recoveryMutated && !statusChanged ? 0 : 1);
  const nextCommandKeys = [...new Set(previous.appliedCommandKeys
    .concat(commandKey && !duplicateCommand ? [commandKey] : [])
    .concat(recoveryDisposition.key && recoveryMutated ? [recoveryDisposition.key] : []))];
  const nextCommandReceipts = previous.commandReceipts.concat([
    commandKey && !duplicateCommand && lifecycle.commandApplied
      ? {
          key: commandKey,
          commandId: lifecycle.command.commandId,
          appliedAt: generatedAt,
          disposition: 'applied',
          cursor: null,
          sequence: nextSequence
        }
      : null,
    recoveryDisposition.key && recoveryMutated
      ? {
          key: recoveryDisposition.key,
          commandId: recoveryCommand.commandId,
          appliedAt: generatedAt,
          disposition: recoveryCommand.name,
          cursor: previous.cursor,
          sequence: nextSequence
        }
      : null
  ].filter(Boolean));
  const cursor = [
    surfaceId,
    scope.tenantId || 'unscoped',
    scope.workspaceId || 'unscoped',
    String(nextSequence)
  ].join(':');
  const acknowledgedAt = recoveryCommand.name === 'ack-dispatch' && recoveryDisposition.applied
    ? generatedAt
    : previous.pendingDispatch.acknowledgedAt;
  const pendingDispatchActive = nextStatus === 'dispatching' || nextStatus === 'buffered' || nextStatus === 'recovering';
  const nextPendingDispatch = pendingDispatchActive
    ? {
        correlationId: auditHandoff.correlationId,
        providerId: provider.id,
        destination: auditHandoff.destination,
        cursor,
        acknowledgedAt
      }
    : {
        correlationId: previous.pendingDispatch.correlationId,
        providerId: previous.pendingDispatch.providerId,
        destination: previous.pendingDispatch.destination,
        cursor: previous.pendingDispatch.cursor,
        acknowledgedAt
      };
  const recoveryAttempts = recoveryCommand.name === 'recover' && recoveryDisposition.applied
    ? previous.recoveryAttempts + 1
    : previous.recoveryAttempts;
  const restartStatus = recoveryDisposition.applied
    ? `recovery-command-${recoveryCommand.name}`
    : restartNeeded ? 'recover-from-persisted-state'
      : previous.present ? 'continue-from-persisted-state' : 'fresh';

  return {
    schema: 'aios.audit-redaction.persisted-state.v1',
    previous,
    next: {
      status: nextStatus,
      sequence: nextSequence,
      cursor,
      updatedAt: generatedAt,
      lastCorrelationId: auditHandoff.correlationId,
      appliedCommandKeys: nextCommandKeys,
      commandReceipts: nextCommandReceipts.slice(-20),
      recoveryAttempts,
      proofBundleId: previous.proofBundleId,
      pendingDispatch: nextPendingDispatch
    },
    command: {
      key: commandKey,
      duplicate: duplicateCommand,
      idempotent: lifecycle.command.present,
      disposition: !lifecycle.command.present
        ? 'not-a-command'
        : duplicateCommand ? 'already-applied' : lifecycle.commandApplied ? 'apply-once' : 'not-applied'
    },
    recoveryCommand: {
      ...recoveryCommand,
      key: recoveryDisposition.key,
      duplicate: recoveryDisposition.duplicate,
      expectedCursorMismatch: recoveryDisposition.expectedCursorMismatch,
      activeRecoveryStatus: recoveryDisposition.activeRecoveryStatus,
      disposition: recoveryDisposition.disposition,
      applied: recoveryDisposition.applied,
      reasons: recoveryDisposition.reasons
    },
    restart: {
      safe: true,
      needed: restartNeeded || recoveryDisposition.applied,
      status: restartStatus,
      recoveryCursor: previous.cursor || cursor,
      resumeCorrelationId: previous.lastCorrelationId || auditHandoff.correlationId,
      previousStatus: previous.status,
      nextStatus,
      lock: previous.lock,
      pendingDispatch: nextPendingDispatch
    },
    recoveryPaths: restartNeeded
      ? ['load-persisted-state', 'replay-uncommitted-handoff', 'write-next-sequence']
      : recoveryDisposition.applied ? ['apply-recovery-command', 'write-recovery-receipt', 'publish-restart-safe-status']
        : failureState.retryPolicy.retryable ? ['honor-retry-policy', 'preserve-correlation-id'] : [],
    restartSafeStatus: {
      schema: 'aios.audit-redaction.restart-safe-status.v1',
      stable: !restartNeeded || recoveryDisposition.applied,
      status: restartStatus,
      sequenceAdvanced: nextSequence > previous.sequence,
      commandMutated,
      recoveryMutated,
      statusChanged,
      canReplay: nextStatus === 'buffered' || nextStatus === 'dispatching' || nextStatus === 'recovering',
      canAcknowledge: nextStatus === 'dispatching' || previous.status === 'dispatching',
      terminal: nextStatus === 'complete' || nextStatus === 'dead-lettered',
      operatorAction: nextStatus === 'dead-lettered'
        ? 'inspect-dead-letter'
        : restartNeeded && !recoveryDisposition.applied ? 'issue-recovery-command'
          : failureState.retryPolicy.retryable ? 'schedule-retry' : 'none'
    }
  };
}

function incrementCounter(counters, key, amount = 1) {
  if (!key) return counters;
  counters[key] = (counters[key] || 0) + amount;
  return counters;
}

function normalizeHistoryEntry(entry = {}, index = 0) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const reasons = asList(source.reasons || source.boundaryReasons || source.denialReasons);
  const redactedFieldCount = normalizePositiveInteger(source.redactedFieldCount ?? source.redactions, 0);
  const accepted = source.accepted === true || source.ok === true;
  const deliveryMode = typeof source.deliveryMode === 'string' && source.deliveryMode.trim()
    ? source.deliveryMode.trim()
    : accepted ? 'live' : 'blocked';
  const sinkStatus = typeof source.sinkStatus === 'string' ? source.sinkStatus : source.auditSinkStatus;

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `history-${index + 1}`,
    at: typeof source.at === 'string' && source.at.trim()
      ? source.at.trim()
      : typeof source.generatedAt === 'string' ? source.generatedAt : null,
    action: typeof source.action === 'string' && source.action.trim() ? source.action.trim() : 'audit:write',
    sinkStatus: AUDIT_SINK_STATUSES.has(sinkStatus) ? sinkStatus : 'healthy',
    deliveryMode,
    accepted,
    blocked: source.blocked === true || deliveryMode === 'blocked' || (!accepted && reasons.length > 0),
    degradedBuffered: source.degradedBuffered === true || deliveryMode === 'degraded-buffered',
    redactedFieldCount,
    reasons
  };
}

function summarizeAnalytics(entries) {
  const counters = {
    totalEvents: entries.length,
    acceptedEvents: 0,
    blockedEvents: 0,
    degradedBufferedEvents: 0,
    liveEvents: 0,
    redactedFieldTotal: 0,
    byAction: {},
    byReason: {},
    bySinkStatus: {},
    byDeliveryMode: {}
  };

  for (const entry of entries) {
    if (entry.accepted && !entry.blocked) counters.acceptedEvents += 1;
    if (entry.blocked) counters.blockedEvents += 1;
    if (entry.degradedBuffered) counters.degradedBufferedEvents += 1;
    if (entry.deliveryMode === 'live') counters.liveEvents += 1;
    counters.redactedFieldTotal += entry.redactedFieldCount;
    incrementCounter(counters.byAction, entry.action);
    incrementCounter(counters.bySinkStatus, entry.sinkStatus);
    incrementCounter(counters.byDeliveryMode, entry.deliveryMode);
    for (const reason of entry.reasons) {
      incrementCounter(counters.byReason, reason);
    }
  }

  return counters;
}

function normalizeAnalyticsSnapshot(entry = {}, index = 0) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const totals = source.totals && typeof source.totals === 'object' ? source.totals : source;
  const events = normalizePositiveInteger(totals.events ?? totals.totalEvents, 0);
  const blocked = normalizePositiveInteger(totals.blocked ?? totals.blockedEvents, 0);
  const accepted = normalizePositiveInteger(totals.accepted ?? totals.acceptedEvents, Math.max(0, events - blocked));
  const degradedBuffered = normalizePositiveInteger(totals.degradedBuffered ?? totals.degradedBufferedEvents, 0);
  const redactedFields = normalizePositiveInteger(totals.redactedFields ?? totals.redactedFieldTotal, 0);

  return {
    schema: 'aios.audit-redaction.analytics-snapshot.v1',
    reportId: typeof source.reportId === 'string' && source.reportId.trim()
      ? source.reportId.trim()
      : `analytics-snapshot-${index + 1}`,
    generatedAt: typeof source.generatedAt === 'string' && source.generatedAt.trim()
      ? source.generatedAt.trim()
      : typeof source.at === 'string' && source.at.trim() ? source.at.trim() : null,
    tenantId: typeof source.tenantId === 'string' && source.tenantId.trim() ? source.tenantId.trim() : null,
    workspaceId: typeof source.workspaceId === 'string' && source.workspaceId.trim() ? source.workspaceId.trim() : null,
    window: source.window && typeof source.window === 'object'
      ? {
          since: typeof source.window.since === 'string' ? source.window.since : null,
          until: typeof source.window.until === 'string' ? source.window.until : null
        }
      : null,
    totals: {
      events,
      accepted,
      blocked,
      degradedBuffered,
      redactedFields
    },
    blockedRate: events > 0 ? blocked / events : 0,
    redactionAveragePerEvent: events > 0 ? redactedFields / events : 0
  };
}

function normalizeAnalyticsSnapshots(input = {}) {
  const source = Array.isArray(input.analyticsSnapshots)
    ? input.analyticsSnapshots
    : Array.isArray(input.historySnapshots) ? input.historySnapshots
      : Array.isArray(input.reportingSnapshots) ? input.reportingSnapshots : [];
  return source
    .map((entry, index) => normalizeAnalyticsSnapshot(entry, index))
    .filter((entry) => entry.totals.events > 0 || entry.generatedAt);
}

function buildReportingTrend({ counters, blockedRate, redactionAverage, previousSnapshots }) {
  const latest = previousSnapshots[previousSnapshots.length - 1] || null;
  const previousTotals = latest?.totals || {
    events: 0,
    accepted: 0,
    blocked: 0,
    degradedBuffered: 0,
    redactedFields: 0
  };
  const blockedRateDelta = latest ? blockedRate - latest.blockedRate : blockedRate;
  const redactionAverageDelta = latest ? redactionAverage - latest.redactionAveragePerEvent : redactionAverage;

  return {
    schema: 'aios.audit-redaction.analytics-trend.v1',
    baselineReportId: latest?.reportId || null,
    comparedSnapshotCount: previousSnapshots.length,
    deltas: {
      events: counters.totalEvents - previousTotals.events,
      accepted: counters.acceptedEvents - previousTotals.accepted,
      blocked: counters.blockedEvents - previousTotals.blocked,
      degradedBuffered: counters.degradedBufferedEvents - previousTotals.degradedBuffered,
      redactedFields: counters.redactedFieldTotal - previousTotals.redactedFields,
      blockedRate: blockedRateDelta,
      redactionAveragePerEvent: redactionAverageDelta
    },
    direction: {
      blockedRate: blockedRateDelta > 0 ? 'increased' : blockedRateDelta < 0 ? 'decreased' : 'flat',
      redactionVolume: redactionAverageDelta > 0 ? 'increased' : redactionAverageDelta < 0 ? 'decreased' : 'flat'
    }
  };
}

function buildTimelineReport(timeline) {
  const buckets = new Map();
  for (const entry of timeline) {
    const day = typeof entry.at === 'string' && entry.at.length >= 10 ? entry.at.slice(0, 10) : 'undated';
    const key = `${day}|${entry.action}|${entry.deliveryMode}`;
    const bucket = buckets.get(key) || {
      day,
      action: entry.action,
      deliveryMode: entry.deliveryMode,
      events: 0,
      blocked: 0,
      degradedBuffered: 0,
      redactedFields: 0,
      reasons: {}
    };
    bucket.events += 1;
    if (entry.blocked) bucket.blocked += 1;
    if (entry.degradedBuffered) bucket.degradedBuffered += 1;
    bucket.redactedFields += entry.redactedFieldCount;
    for (const reason of entry.reasons) {
      incrementCounter(bucket.reasons, reason);
    }
    buckets.set(key, bucket);
  }

  return {
    schema: 'aios.audit-redaction.timeline-report.v1',
    bucketCount: buckets.size,
    buckets: [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day) || a.action.localeCompare(b.action)),
    latest: timeline.length ? timeline[timeline.length - 1] : null
  };
}

function buildAnalyticsExportTable({ reportId, generatedAt, scope, counters, blockedRate, redactionAverage, trend, timelineReport }) {
  const workspaceId = scope.workspaceId || 'unscoped';
  const tenantId = scope.tenantId || 'unscoped';
  const generatedDate = typeof generatedAt === 'string' && generatedAt.length >= 10
    ? generatedAt.slice(0, 10)
    : 'undated';
  return {
    schema: 'aios.audit-redaction.analytics-export-table.v1',
    reportId,
    generatedAt,
    columns: [
      'tenantId',
      'workspaceId',
      'events',
      'accepted',
      'blocked',
      'degradedBuffered',
      'redactedFields',
      'blockedRate',
      'redactionAveragePerEvent',
      'blockedRateDelta'
    ],
    rows: [{
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      events: counters.totalEvents,
      accepted: counters.acceptedEvents,
      blocked: counters.blockedEvents,
      degradedBuffered: counters.degradedBufferedEvents,
      redactedFields: counters.redactedFieldTotal,
      blockedRate,
      redactionAveragePerEvent: redactionAverage,
      blockedRateDelta: trend.deltas.blockedRate
    }],
    partitions: {
      tenantId,
      workspaceId,
      generatedDate,
      route: 'capability-security/audit-redaction'
    },
    attachments: {
      timelineBucketCount: timelineReport.bucketCount,
      timelineRowsReady: timelineReport.buckets.length,
      reasonBreakdownReady: Object.keys(counters.byReason).length
    }
  };
}

function buildReportingState({ input, generatedAt, scope, action, auditSinkHealth, failureState, redactionPaths, deliveryMode }) {
  const historyEntries = Array.isArray(input.history)
    ? input.history.map((entry, index) => normalizeHistoryEntry(entry, index))
    : [];
  const currentEntry = normalizeHistoryEntry({
    id: input.correlationId,
    at: generatedAt,
    action,
    sinkStatus: auditSinkHealth.status,
    deliveryMode,
    accepted: !failureState.blocked,
    blocked: failureState.blocked,
    degradedBuffered: failureState.degradedBuffered,
    redactedFieldCount: redactionPaths.length,
    reasons: failureState.reasons
  }, historyEntries.length);
  const timeline = historyEntries.concat(currentEntry);
  const counters = summarizeAnalytics(timeline);
  const blockedRate = counters.totalEvents > 0 ? counters.blockedEvents / counters.totalEvents : 0;
  const redactionAverage = counters.totalEvents > 0 ? counters.redactedFieldTotal / counters.totalEvents : 0;
  const reportId = `${surfaceId}:${scope.tenantId || 'unscoped'}:${scope.workspaceId || 'unscoped'}:${generatedAt}`;
  const previousSnapshots = normalizeAnalyticsSnapshots(input);
  const trend = buildReportingTrend({ counters, blockedRate, redactionAverage, previousSnapshots });
  const timelineReport = buildTimelineReport(timeline);
  const exportTable = buildAnalyticsExportTable({
    reportId,
    generatedAt,
    scope,
    counters,
    blockedRate,
    redactionAverage,
    trend,
    timelineReport
  });

  return {
    counters: {
      ...counters,
      blockedRate,
      redactionAveragePerEvent: redactionAverage,
      trend
    },
    historySnapshot: {
      schema: 'aios.audit-redaction.history-snapshot.v1',
      reportId,
      generatedAt,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      retainedEvents: timeline.length,
      latestEvent: currentEntry,
      previousEventCount: historyEntries.length,
      previousSnapshotCount: previousSnapshots.length,
      previousSnapshots: previousSnapshots.slice(-5),
      trend
    },
    timeline: timeline.map((entry) => ({
      id: entry.id,
      at: entry.at,
      action: entry.action,
      deliveryMode: entry.deliveryMode,
      sinkStatus: entry.sinkStatus,
      redactedFieldCount: entry.redactedFieldCount,
      reasons: entry.reasons
    })),
    timelineReport,
    exportSummary: {
      schema: 'aios.audit-redaction.analytics.v1',
      reportId,
      generatedAt,
      surfaceId,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      totals: {
        events: counters.totalEvents,
        accepted: counters.acceptedEvents,
        blocked: counters.blockedEvents,
        degradedBuffered: counters.degradedBufferedEvents,
        redactedFields: counters.redactedFieldTotal
      },
      breakdowns: {
        actions: counters.byAction,
        reasons: counters.byReason,
        sinkStatuses: counters.bySinkStatus,
        deliveryModes: counters.byDeliveryMode
      },
      currentState: {
        deliveryMode,
        blocked: failureState.blocked,
        retryable: failureState.retryPolicy.retryable,
        actionableErrorCount: failureState.actionableErrors.length
      },
      history: {
        previousSnapshotCount: previousSnapshots.length,
        retainedEvents: timeline.length,
        latestEventId: currentEntry.id,
        trend
      },
      timelineReport,
      exportTable
    }
  };
}

function buildExportWindowContract({ sinceInput, untilInput, sinceMs, untilMs, generatedAtMs, retentionStartMs, retentionDays }) {
  const sinceProvided = Boolean(sinceInput);
  const untilProvided = Boolean(untilInput);
  const sinceValid = sinceProvided && sinceMs !== null;
  const untilValid = untilProvided && untilMs !== null;
  const generatedAtValid = generatedAtMs !== null;
  const ordered = sinceValid && untilValid ? sinceMs <= untilMs : false;
  const durationMs = ordered ? untilMs - sinceMs : null;
  const retentionStartAt = retentionStartMs === null ? null : new Date(retentionStartMs).toISOString();
  const withinRetention = sinceValid && retentionStartMs !== null ? sinceMs >= retentionStartMs : false;
  const issueHints = [];

  if (!sinceProvided) issueHints.push('since_required');
  if (sinceProvided && !sinceValid) issueHints.push('since_invalid');
  if (!untilValid) issueHints.push('until_invalid');
  if (sinceValid && untilValid && !ordered) issueHints.push('window_reversed');
  if (!generatedAtValid) issueHints.push('generatedAt_invalid');
  if (sinceValid && retentionStartMs !== null && !withinRetention) {
    issueHints.push('export_window_out_of_retention');
  }

  return {
    schema: 'aios.audit-redaction.export-window.v1',
    since: sinceInput,
    until: untilInput,
    sinceMs,
    untilMs,
    durationMs,
    generatedAtMs,
    generatedAtValid,
    ordered,
    valid: sinceValid && untilValid && ordered && generatedAtValid,
    retention: {
      retentionDays,
      retentionStartAt,
      retentionStartMs,
      withinRetention
    },
    issueHints
  };
}

function buildExportDeliveryContract({ format, redactionLevel, includeProof, workspaceIds, boundary, outOfBoundaryWorkspaceIds }) {
  const requiresProofAttachment = redactionLevel === 'proof-only' || includeProof;
  const workspaceRouteCount = workspaceIds.length;
  const commitWorkspaceIds = workspaceIds.filter((workspaceId) => boundary.effectiveWorkspaceIds.includes(workspaceId));
  const proofOnlyWorkspaceIds = outOfBoundaryWorkspaceIds;

  return {
    schema: 'aios.audit-redaction.export-delivery.v1',
    format,
    redactionLevel,
    includeProof,
    requiresProofAttachment,
    workspaceRouteCount,
    commitWorkspaceIds,
    proofOnlyWorkspaceIds,
    isolated: proofOnlyWorkspaceIds.length === 0,
    deliveryPolicy: proofOnlyWorkspaceIds.length
      ? 'block-out-of-scope-workspace-export'
      : redactionLevel === 'proof-only' ? 'proof-manifest-only' : 'redacted-audit-events-with-optional-proof',
    manifestReadyPreconditions: {
      hasWorkspaceRoutes: workspaceRouteCount > 0,
      allWorkspacesInBoundary: proofOnlyWorkspaceIds.length === 0,
      proofConsistent: redactionLevel !== 'proof-only' || includeProof === true
    }
  };
}

function normalizeExportRequest({ input, scope, boundary, lifecycle, action, generatedAt }) {
  const source = input.exportRequest && typeof input.exportRequest === 'object'
    ? input.exportRequest
    : input.export && typeof input.export === 'object' ? input.export : {};
  const generatedAtMs = normalizeTimestampMs(generatedAt);
  const untilInput = typeof source.until === 'string' && source.until.trim()
    ? source.until.trim()
    : typeof input.exportUntil === 'string' && input.exportUntil.trim() ? input.exportUntil.trim() : generatedAt;
  const sinceInput = typeof source.since === 'string' && source.since.trim()
    ? source.since.trim()
    : typeof input.exportSince === 'string' && input.exportSince.trim() ? input.exportSince.trim() : null;
  const sinceMs = normalizeTimestampMs(sinceInput);
  const untilMs = normalizeTimestampMs(untilInput);
  const retentionMs = lifecycle.settings.retentionDays * 24 * 60 * 60 * 1000;
  const retentionStartMs = generatedAtMs === null ? null : generatedAtMs - retentionMs;
  const requestedFormat = typeof source.format === 'string' && source.format.trim()
    ? source.format.trim().toLowerCase()
    : typeof input.exportFormat === 'string' && input.exportFormat.trim() ? input.exportFormat.trim().toLowerCase() : 'jsonl';
  const requestedRedactionLevel = typeof source.redactionLevel === 'string' && source.redactionLevel.trim()
    ? source.redactionLevel.trim().toLowerCase()
    : 'redacted';
  const includeProofProvided = Object.prototype.hasOwnProperty.call(source, 'includeProof');
  const includeProof = includeProofProvided ? source.includeProof === true : true;
  const workspaceIds = [...new Set(asList(source.workspaceIds || input.exportWorkspaceIds || scope.requestedWorkspaceIds))];
  const format = EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : 'jsonl';
  const redactionLevel = EXPORT_REDACTION_LEVELS.has(requestedRedactionLevel) ? requestedRedactionLevel : 'redacted';
  const windowContract = buildExportWindowContract({
    sinceInput,
    untilInput,
    sinceMs,
    untilMs,
    generatedAtMs,
    retentionStartMs,
    retentionDays: lifecycle.settings.retentionDays
  });
  const outOfBoundaryWorkspaceIds = workspaceIds.filter((workspaceId) => !boundary.effectiveWorkspaceIds.includes(workspaceId));
  const deliveryContract = buildExportDeliveryContract({
    format,
    redactionLevel,
    includeProof,
    workspaceIds,
    boundary,
    outOfBoundaryWorkspaceIds
  });
  const issues = [];

  if (!EXPORT_FORMATS.has(requestedFormat)) issues.push('format_unsupported');
  if (!EXPORT_REDACTION_LEVELS.has(requestedRedactionLevel)) issues.push('redactionLevel_unsupported');
  if (includeProofProvided && typeof source.includeProof !== 'boolean') issues.push('includeProof_must_be_boolean');
  if (requestedRedactionLevel === 'proof-only' && includeProof !== true) issues.push('proofOnly_requires_includeProof');
  issues.push(...windowContract.issueHints.filter((issue) => issue !== 'export_window_out_of_retention'));
  if (!workspaceIds.length) issues.push('workspaceIds_required');
  if (outOfBoundaryWorkspaceIds.length) issues.push('workspaceIds_out_of_scope');
  const outOfRetention = windowContract.issueHints.includes('export_window_out_of_retention');
  const reasons = [];
  if (issues.length) reasons.push('invalid_export_request');
  if (outOfRetention) reasons.push('export_window_out_of_retention');

  return {
    schema: 'aios.audit-redaction.export-request.v1',
    requested: action === 'audit:export' || Object.keys(source).length > 0,
    valid: issues.length === 0 && !outOfRetention,
    format,
    redactionLevel,
    includeProof,
    window: {
      since: sinceInput,
      until: untilInput,
      sinceMs,
      untilMs,
      durationMs: windowContract.durationMs,
      ordered: windowContract.ordered,
      valid: windowContract.valid,
      retentionStartAt: windowContract.retention.retentionStartAt,
      retentionStartMs: windowContract.retention.retentionStartMs,
      retentionDays: lifecycle.settings.retentionDays,
      withinRetention: windowContract.retention.withinRetention
    },
    windowContract,
    deliveryContract,
    workspaceIds,
    outOfBoundaryWorkspaceIds,
    issues,
    reasons
  };
}

function buildAuditExportManifest({ exportRequest, scope, action, generatedAt, redactionFields, boundary, reporting, providerNegotiation, failureState, proofBundle }) {
  const manifestId = [
    surfaceId,
    scope.tenantId || 'unscoped',
    'export',
    generatedAt
  ].join(':');
  const ready = action === 'audit:export'
    && exportRequest.valid
    && !failureState.blocked
    && providerNegotiation.accepted;

  return {
    schema: 'aios.audit-redaction.export-manifest.v1',
    manifestId,
    requested: exportRequest.requested,
    ready,
    status: !exportRequest.requested
      ? 'not-requested'
      : ready ? 'ready' : failureState.blocked ? 'blocked' : 'pending',
    generatedAt,
    tenantId: scope.tenantId || null,
    workspaceIds: exportRequest.workspaceIds,
    format: exportRequest.format,
    redactionLevel: exportRequest.redactionLevel,
    includeProof: exportRequest.includeProof,
    window: exportRequest.window,
    policy: {
      action,
      redactionFields,
      effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
      requiredProviderCapabilities: providerNegotiation.requiredCapabilities,
      missingProviderCapabilities: providerNegotiation.missingCapabilities
    },
    files: ready
      ? [{
          kind: 'audit-events',
          mediaType: exportRequest.format === 'csv'
            ? 'text/csv'
            : exportRequest.format === 'parquet' ? 'application/vnd.apache.parquet' : 'application/x-ndjson',
          redacted: exportRequest.redactionLevel === 'redacted',
          proofIncluded: exportRequest.includeProof,
          destination: 'hosted-kernel.audit-export'
        }]
      : [],
    proof: {
      bundleId: proofBundle?.evidenceId || null,
      bundleSchema: proofBundle?.schema || null,
      commitEligible: proofBundle?.commitEligible === true,
      omissions: proofBundle?.omissions || [],
      analyticsReportId: reporting.historySnapshot.reportId,
      timelineEventCount: reporting.timeline.length,
      exportIssues: exportRequest.issues,
      exportReasons: exportRequest.reasons,
      workspaceGrantProof: boundary.workspaceProof,
      workspaceRoutingSchema: proofBundle?.workspaceRouting?.schema || null,
      workspaceCommitRoutes: proofBundle?.workspaceRouting?.handoffPartitions || [],
      workspaceProofOnlyRoutes: proofBundle?.workspaceRouting?.proofOnlyPartitions || []
    }
  };
}

function buildLifecycleClientControls({ lifecycle, action, permissions, exportRequest, exportManifest, failureState, reporting, generatedAt }) {
  const canManageLifecycle = permissions.includes('redaction:manage');
  const blockers = [...new Set([
    ...lifecycle.reasons,
    ...exportRequest.reasons,
    ...(failureState.blocked ? failureState.reasons : [])
  ])].sort();
  const exportBlocked = action === 'audit:export' && (!exportRequest.valid || !exportManifest.ready);
  const scheduleDue = lifecycle.scheduleRuntime.due || lifecycle.scheduleRuntime.commandTriggered;
  const lifecycleBlocked = lifecycle.reasons.length > 0;
  const controls = [
    {
      id: 'enable-redaction',
      label: 'Enable redaction',
      command: 'enable',
      enabled: canManageLifecycle && !lifecycle.desiredSettings.redactionEnabled,
      visible: !lifecycle.desiredSettings.redactionEnabled,
      reason: canManageLifecycle ? 'redaction-currently-disabled' : 'redaction-manage-permission-required'
    },
    {
      id: 'pause-capture',
      label: 'Pause capture',
      command: 'pause',
      enabled: canManageLifecycle && lifecycle.desiredSettings.auditCaptureEnabled,
      visible: lifecycle.desiredSettings.auditCaptureEnabled,
      reason: canManageLifecycle ? 'audit-capture-enabled' : 'redaction-manage-permission-required'
    },
    {
      id: 'run-now',
      label: 'Run now',
      command: 'run-now',
      enabled: canManageLifecycle && lifecycle.settingsValid && !lifecycleBlocked,
      visible: lifecycle.desiredSettings.redactionEnabled,
      reason: lifecycleBlocked ? 'resolve-lifecycle-blockers' : 'manual-dispatch-available'
    },
    {
      id: 'commit-lifecycle',
      label: 'Commit lifecycle',
      command: lifecycle.command.present ? lifecycle.command.name : 'none',
      enabled: canManageLifecycle && lifecycle.controlPlan.commitRequired && !lifecycleBlocked,
      visible: lifecycle.command.present || lifecycle.controlPlan.commitRequired,
      reason: lifecycle.controlPlan.commitRequired ? 'persist-lifecycle-command' : 'no-lifecycle-commit-pending'
    },
    {
      id: 'schedule-next-run',
      label: 'Schedule next run',
      command: 'schedule',
      enabled: canManageLifecycle && lifecycle.settingsValid && !lifecycleBlocked,
      visible: lifecycle.desiredSettings.schedule.frequency === 'manual' || !lifecycle.desiredSettings.schedule.enabled,
      reason: lifecycle.desiredSettings.schedule.enabled ? 'schedule-already-enabled' : 'schedule-not-configured'
    },
    {
      id: 'export-audit',
      label: 'Export audit',
      command: 'audit:export',
      enabled: action === 'audit:export' && exportManifest.ready,
      visible: action === 'audit:export' || exportRequest.requested,
      reason: exportManifest.ready
        ? 'export-manifest-ready'
        : exportBlocked ? 'export-preconditions-blocked' : 'export-not-requested'
    }
  ];
  const visibleControls = controls.filter((control) => control.visible);
  const enabledControls = visibleControls.filter((control) => control.enabled);
  const disabledControls = visibleControls.filter((control) => !control.enabled);
  const nextClientAction = enabledControls[0]?.id
    || (blockers.length ? 'resolve-blockers' : scheduleDue ? 'dispatch-scheduled-run' : 'monitor');
  const exportPreflight = {
    requested: exportRequest.requested,
    ready: exportManifest.ready,
    manifestId: exportManifest.manifestId,
    status: exportManifest.status,
    issues: exportRequest.issues,
    reasons: exportRequest.reasons,
    workspaceIds: exportRequest.workspaceIds,
    outOfBoundaryWorkspaceIds: exportRequest.outOfBoundaryWorkspaceIds,
    deliveryPolicy: exportRequest.deliveryContract.deliveryPolicy,
    proofRequired: exportRequest.deliveryContract.requiresProofAttachment,
    files: exportManifest.files,
    analyticsReportId: reporting.historySnapshot.reportId,
    timelineEventCount: reporting.timeline.length
  };

  return {
    schema: 'aios.audit-redaction.lifecycle-client-controls.v1',
    generatedAt,
    lifecycleState: lifecycle.controlPlan.stateAfterCommand,
    settingsValid: lifecycle.settingsValid,
    canManageLifecycle,
    nextClientAction,
    schedule: {
      enabled: lifecycle.scheduleRuntime.enabled,
      due: lifecycle.scheduleRuntime.due,
      commandTriggered: lifecycle.scheduleRuntime.commandTriggered,
      dispatchAllowed: lifecycle.scheduleRuntime.dispatch.allowed,
      dispatchAction: lifecycle.scheduleRuntime.dispatch.action,
      nextRunAt: lifecycle.scheduleRuntime.nextRunAt,
      missedRunCount: lifecycle.scheduleRuntime.missedRunCount,
      catchUpLimited: lifecycle.scheduleRuntime.catchUpLimited,
      disabledReason: lifecycle.scheduleRuntime.disabledReason
    },
    controls: visibleControls,
    enabledControlIds: enabledControls.map((control) => control.id),
    disabledControlIds: disabledControls.map((control) => control.id),
    blockers,
    exportPreflight,
    routeState: blockers.length
      ? 'blocked'
      : exportManifest.ready ? 'export-ready'
        : scheduleDue ? 'schedule-ready' : 'ready'
  };
}

function buildAuditProofBundle({
  scope,
  action,
  generatedAt,
  redactionFields,
  redactionPaths,
  evidenceBundle,
  workspaceBoundary,
  permissionBoundary,
  lifecycle,
  providerNegotiation,
  exportRequest,
  auditHandoff,
  persistedState,
  reporting,
  failureState
}) {
  const evidenceId = [
    surfaceId,
    scope.tenantId || 'unscoped',
    scope.workspaceId || 'unscoped',
    auditHandoff.correlationId,
    'proof'
  ].join(':');
  const coveredSchemas = [
    workspaceBoundary.schema,
    permissionBoundary.schema,
    auditHandoff.workspaceHandoffRouting.schema,
    lifecycle.controlPlan.schema,
    lifecycle.scheduleRuntime.schema,
    providerNegotiation.schema,
    exportRequest.schema,
    persistedState.schema,
    reporting.exportSummary.schema
  ];
  const omittedSections = [];

  if (!redactionPaths.length) omittedSections.push('redaction-paths-empty');
  if (!workspaceBoundary.grants.length && !workspaceBoundary.isolation.crossScope) {
    omittedSections.push('workspace-grants-empty');
  }
  if (!providerNegotiation.accepted) omittedSections.push('provider-contract-blocked');
  if (exportRequest.requested && !exportRequest.valid) omittedSections.push('export-request-invalid');
  if (failureState.blocked) omittedSections.push('handoff-blocked');
  if (evidenceBundle.supplied && evidenceBundle.redactionPathCount > 0) {
    omittedSections.push('sensitive-evidence-redacted');
  }

  return {
    schema: 'aios.audit-redaction.proof-bundle.v1',
    evidenceId,
    generatedAt,
    action,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    correlationId: auditHandoff.correlationId,
    coveredSchemas,
    commitEligible: !failureState.blocked && providerNegotiation.accepted && persistedState.restart.safe,
    integrity: {
      strategy: 'deterministic-hosted-kernel-envelope',
      evidenceId,
      sourceCursor: persistedState.next.cursor,
      analyticsReportId: reporting.historySnapshot.reportId,
      redactionPathCount: redactionPaths.length
    },
    redaction: {
      fields: redactionFields,
      paths: redactionPaths,
      pathCount: redactionPaths.length,
      proofRequired: lifecycle.settings.proofRequired,
      complete: lifecycle.settings.proofRequired ? redactionPaths.length > 0 : true,
      evidencePathCount: evidenceBundle.redactionPathCount
    },
    evidenceRedaction: {
      schema: evidenceBundle.schema,
      supplied: evidenceBundle.supplied,
      entryCount: evidenceBundle.entryCount,
      redactionPathCount: evidenceBundle.redactionPathCount,
      redactionPaths: evidenceBundle.redactionPaths
    },
    scopeProof: {
      tenantIsolated: workspaceBoundary.isolation.tenant,
      workspaceIsolated: workspaceBoundary.isolation.workspace,
      effectiveWorkspaceIds: workspaceBoundary.effectiveWorkspaceIds,
      outOfScopeWorkspaceIds: workspaceBoundary.outOfScopeWorkspaceIds,
      grantIds: workspaceBoundary.proof.map((entry) => entry.grantId).filter(Boolean),
      routeIsolationMode: auditHandoff.workspaceHandoffRouting.isolationMode,
      commitRouteCount: auditHandoff.workspaceHandoffRouting.commitRouteCount,
      proofOnlyRouteCount: auditHandoff.workspaceHandoffRouting.proofOnlyRouteCount
    },
    workspaceRouting: auditHandoff.workspaceHandoffRouting,
    permissionProof: {
      allowed: permissionBoundary.allowed,
      actionPath: permissionBoundary.actionPath,
      actorId: permissionBoundary.actor.actorId,
      deniedWorkspaceIds: permissionBoundary.deniedWorkspaceIds,
      reasons: permissionBoundary.reasons
    },
    lifecycleProof: {
      stateAfterCommand: lifecycle.controlPlan.stateAfterCommand,
      commandApplied: lifecycle.commandApplied,
      commandName: lifecycle.command.present ? lifecycle.command.name : null,
      commitRequired: lifecycle.controlPlan.commitRequired,
      changedSettings: lifecycle.controlPlan.changedSettings,
      nextAction: lifecycle.nextAction,
      scheduleRuntime: {
        schema: lifecycle.scheduleRuntime.schema,
        enabled: lifecycle.scheduleRuntime.enabled,
        due: lifecycle.scheduleRuntime.due,
        nextRunAt: lifecycle.scheduleRuntime.nextRunAt,
        missedRunCount: lifecycle.scheduleRuntime.missedRunCount,
        catchUpLimited: lifecycle.scheduleRuntime.catchUpLimited,
        dispatchAllowed: lifecycle.scheduleRuntime.dispatch.allowed,
        dispatchAction: lifecycle.scheduleRuntime.dispatch.action
      }
    },
    providerProof: {
      accepted: providerNegotiation.accepted,
      providerId: providerNegotiation.providerId,
      mode: providerNegotiation.mode,
      serviceType: providerNegotiation.serviceContract.type,
      deliveryChannel: providerNegotiation.serviceContract.deliveryChannel,
      serviceContractValid: providerNegotiation.serviceContract.valid,
      serviceIssues: providerNegotiation.serviceContract.issues,
      syncCursor: providerNegotiation.syncMetadata.cursor,
      replayCursor: providerNegotiation.syncMetadata.replayCursor,
      highWatermark: providerNegotiation.syncMetadata.highWatermark,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      missingCapabilities: providerNegotiation.missingCapabilities,
      reasons: providerNegotiation.reasons
    },
    exportProof: {
      requested: exportRequest.requested,
      valid: exportRequest.valid,
      format: exportRequest.format,
      redactionLevel: exportRequest.redactionLevel,
      window: exportRequest.window,
      workspaceIds: exportRequest.workspaceIds,
      issues: exportRequest.issues,
      reasons: exportRequest.reasons
    },
    persistenceProof: {
      status: persistedState.next.status,
      sequence: persistedState.next.sequence,
      cursor: persistedState.next.cursor,
      restartSafe: persistedState.restart.safe,
      restartStatus: persistedState.restart.status,
      commandDisposition: persistedState.command.disposition,
      recoveryCommand: persistedState.recoveryCommand.present ? persistedState.recoveryCommand.name : null,
      recoveryDisposition: persistedState.recoveryCommand.disposition,
      recoveryReasons: persistedState.recoveryCommand.reasons,
      recoveryAttempts: persistedState.next.recoveryAttempts,
      pendingDispatch: persistedState.next.pendingDispatch,
      restartSafeStatus: persistedState.restartSafeStatus
    },
    omissions: omittedSections,
    reasons: [...new Set(failureState.reasons.concat(exportRequest.reasons, providerNegotiation.reasons))]
  };
}

function buildFailureState({ input, boundary, validation, health, operationalHealth, lifecycle, providerNegotiation, exportRequest, generatedAt }) {
  const validationReasons = validation.valid ? [] : [validation.reason];
  const healthReasons = health.reasons;
  const operationalHealthReasons = operationalHealth?.reasons || [];
  const lifecycleReasons = lifecycle ? lifecycle.reasons : [];
  const providerReasons = providerNegotiation ? providerNegotiation.reasons : [];
  const exportReasons = exportRequest?.requested ? exportRequest.reasons : [];
  const baseReasons = boundary.reasons.concat(
    validationReasons,
    healthReasons,
    operationalHealthReasons,
    lifecycleReasons,
    providerReasons,
    exportReasons
  );
  const retryBudget = normalizeRetryBudget(input, health, generatedAt, baseReasons);
  const operationalReasons = [];
  if (retryBudget.exhausted) operationalReasons.push('retry_budget_exhausted');
  if (retryBudget.deadlineExceeded) operationalReasons.push('recovery_deadline_exceeded');
  const reasons = baseReasons.concat(operationalReasons);
  const retryPolicy = buildRetryPolicy(reasons, health, retryBudget, generatedAt);
  const degradedBuffered = boundary.allowed
    && validation.valid
    && lifecycleReasons.length === 0
    && providerReasons.length === 0
    && exportReasons.length === 0
    && (healthReasons.length > 0 || operationalHealthReasons.length > 0)
    && operationalReasons.length === 0
    && health.degradedMode
    && healthReasons.concat(operationalHealthReasons).every((reason) => RETRYABLE_FAILURE_REASONS.has(reason));
  const blocked = !boundary.allowed
    || !validation.valid
    || lifecycleReasons.length > 0
    || providerReasons.length > 0
    || exportReasons.length > 0
    || operationalReasons.length > 0
    || ((healthReasons.length > 0 || operationalHealthReasons.length > 0) && !degradedBuffered);

  return {
    state: blocked ? 'blocked' : degradedBuffered ? 'degraded' : 'ready',
    blocked,
    degradedBuffered,
    reasons: [...new Set(reasons)],
    retryBudget,
    retryPolicy,
    actionableErrors: buildActionableErrors(reasons)
  };
}

function buildOperationalRecoveryPlan({ auditSinkHealth, operationalHealth, failureState, auditHandoff, persistedState }) {
  const retryPolicy = failureState.retryPolicy;
  const retryBudget = failureState.retryBudget;
  const terminal = retryBudget.terminal
    || failureState.reasons.includes('retry_budget_exhausted')
    || failureState.reasons.includes('recovery_deadline_exceeded');
  const queueSaturated = auditSinkHealth.queueDepth > auditSinkHealth.maxQueueDepth;
  const dependencyBlocked = operationalHealth.reasons.length > 0 && !failureState.degradedBuffered;
  const mode = terminal
    ? 'dead-letter'
    : failureState.degradedBuffered ? 'buffer-and-drain'
      : retryPolicy.retryable ? 'retry-with-backoff'
        : dependencyBlocked ? 'dependency-remediation'
          : failureState.blocked ? 'operator-remediation' : 'live-delivery';

  return {
    schema: 'aios.audit-redaction.operational-recovery.v1',
    mode,
    terminal,
    sinkStatus: auditSinkHealth.status,
    queue: {
      depth: auditSinkHealth.queueDepth,
      maxDepth: auditSinkHealth.maxQueueDepth,
      saturated: queueSaturated
    },
    dependencies: {
      ok: operationalHealth.ok,
      requiredComponents: operationalHealth.requiredComponents,
      degradedComponents: operationalHealth.degradedComponents,
      missingComponents: operationalHealth.missingComponents,
      reasons: operationalHealth.reasons,
      components: operationalHealth.components.map((component) => ({
        component: component.component,
        status: component.status,
        stale: component.stale,
        observedAt: component.observedAt,
        ageMs: component.ageMs,
        reasons: component.reasons
      }))
    },
    retry: {
      retryable: retryPolicy.retryable,
      retryAfterMs: retryPolicy.retryAfterMs,
      nextRetryAt: retryPolicy.nextRetryAt,
      attempt: retryBudget.attempt,
      maxAttempts: retryBudget.maxAttempts,
      remainingAttempts: retryBudget.remainingAttempts,
      reasons: retryBudget.retryableReasons
    },
    escalation: terminal
      ? {
          reason: retryBudget.exhausted ? 'retry-budget-exhausted' : 'recovery-deadline-exceeded',
          destination: 'hosted-kernel.audit-dead-letter',
          correlationId: auditHandoff.correlationId,
          persistedCursor: persistedState.next.cursor
        }
      : null,
    operatorActions: terminal
      ? ['inspect-dead-letter', 'verify-sink-health', 'replay-from-persisted-cursor']
      : dependencyBlocked ? ['inspect-operational-dependencies', 'refresh-health-probes', 'schedule-retry']
        : retryPolicy.retryable ? ['preserve-correlation-id', 'schedule-retry', 'monitor-audit-sink']
        : failureState.blocked ? ['resolve-actionable-errors'] : []
  };
}

function buildWorkspaceHandoffRouting({ scope, action, permissionBoundary, boundary, generatedAt, redactionPaths }) {
  const requestedWorkspaceIds = scope.requestedWorkspaceIds.length
    ? scope.requestedWorkspaceIds
    : scope.workspaceId ? [scope.workspaceId] : [];
  const workspaceDecisions = new Map(permissionBoundary.workspaces.map((decision) => [decision.workspaceId, decision]));
  const workspaceProof = new Map(boundary.workspaceProof.map((proof) => [proof.workspaceId, proof]));
  const tenantPartition = scope.tenantId || 'unscoped-tenant';
  const routingRows = requestedWorkspaceIds.map((workspaceId, index) => {
    const decision = workspaceDecisions.get(workspaceId) || null;
    const proof = workspaceProof.get(workspaceId) || null;
    const granted = Boolean(decision?.granted && proof?.granted);
    const workspacePartition = workspaceId || `unscoped-workspace-${index + 1}`;
    const routeKey = [
      surfaceId,
      tenantPartition,
      workspacePartition,
      action,
      granted ? 'commit' : 'proof-only'
    ].join('|');

    return {
      workspaceId: workspaceId || null,
      routeKey,
      partition: {
        tenantId: scope.tenantId || null,
        workspaceId: workspaceId || null,
        tenantPartition,
        workspacePartition
      },
      lane: granted ? 'workspace-audit-commit' : 'workspace-boundary-proof',
      deliveryPolicy: granted ? 'redacted-event-and-proof' : 'proof-only-denial',
      dispatchAllowed: granted,
      proofRequired: true,
      idempotencyKey: [
        surfaceId,
        tenantPartition,
        workspacePartition,
        action,
        generatedAt
      ].join(':'),
      redactionPathCount: redactionPaths.length,
      permissionSource: decision?.source || proof?.source || 'missing',
      grantIds: decision?.grantIds || (proof?.grantId ? [proof.grantId] : []),
      deniedGrantIds: decision?.deniedGrantIds || [],
      reasons: [...new Set((decision?.reasons || []).concat(proof?.grantReasons || []))]
    };
  });
  const commitRoutes = routingRows.filter((row) => row.dispatchAllowed);
  const proofOnlyRoutes = routingRows.filter((row) => !row.dispatchAllowed);

  return {
    schema: 'aios.audit-redaction.workspace-handoff-routing.v1',
    generatedAt,
    action,
    tenantPartition,
    requestedWorkspaceIds,
    effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
    outOfScopeWorkspaceIds: boundary.outOfScopeWorkspaceIds,
    routeCount: routingRows.length,
    commitRouteCount: commitRoutes.length,
    proofOnlyRouteCount: proofOnlyRoutes.length,
    commitReady: commitRoutes.length > 0 && proofOnlyRoutes.length === 0 && permissionBoundary.allowed,
    isolationMode: permissionBoundary.global.crossScope
      ? 'cross-scope-governed'
      : proofOnlyRoutes.length ? 'workspace-grant-limited' : 'workspace-grant-isolated',
    routes: routingRows,
    handoffPartitions: commitRoutes.map((row) => ({
      routeKey: row.routeKey,
      tenantPartition: row.partition.tenantPartition,
      workspacePartition: row.partition.workspacePartition,
      idempotencyKey: row.idempotencyKey,
      deliveryPolicy: row.deliveryPolicy
    })),
    proofOnlyPartitions: proofOnlyRoutes.map((row) => ({
      routeKey: row.routeKey,
      workspaceId: row.workspaceId,
      reasons: row.reasons,
      deliveryPolicy: row.deliveryPolicy
    }))
  };
}

function buildAuditHandoff({ input, scope, permissions, permissionBoundary, boundary, generatedAt, redactedEvent, redactionPaths }) {
  const correlationId = typeof input.correlationId === 'string' && input.correlationId.trim()
    ? input.correlationId.trim()
    : `${surfaceId}:${generatedAt}`;
  const workspaceHandoffRouting = buildWorkspaceHandoffRouting({
    scope,
    action: input.action || 'audit:write',
    permissionBoundary,
    boundary,
    generatedAt,
    redactionPaths
  });
  return {
    destination: input.auditSink || 'hosted-kernel.audit-log',
    correlationId,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    actorId: input.actorId || null,
    action: input.action || 'audit:write',
    accepted: boundary.allowed,
    denialReasons: boundary.reasons,
    permissionSnapshot: permissions,
    permissionBoundary,
    effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
    workspaceGrantProof: boundary.workspaceProof,
    workspaceHandoffRouting,
    routePartitions: workspaceHandoffRouting.handoffPartitions,
    proofOnlyPartitions: workspaceHandoffRouting.proofOnlyPartitions,
    redactionPaths,
    event: redactedEvent
  };
}

export function describeAuditRedactionSurface(input = {}) {
  const generatedAt = input.now || new Date().toISOString();
  const scope = normalizeScope(input);
  const permissions = buildPermissionSet(input);
  const workspaceGrants = normalizeWorkspaceGrants(input);
  const requestedLifecycleCommand = normalizeLifecycleCommand(input);
  const action = typeof input.action === 'string' && input.action.trim()
    ? input.action.trim()
    : requestedLifecycleCommand.present ? 'redaction:manage' : 'audit:write';
  const boundary = evaluateBoundary(scope, permissions, action, generatedAt, workspaceGrants);
  const workspaceBoundary = buildWorkspaceBoundaryContract({ scope, boundary, workspaceGrants });
  const permissionBoundary = buildPermissionBoundaryContract({
    input,
    scope,
    permissions,
    action,
    boundary,
    workspaceGrants,
    generatedAt
  });
  const auditSinkHealth = normalizeAuditSinkHealth(input);
  const operationalHealth = normalizeOperationalHealth(input, generatedAt);
  const eventValidation = validateEventEnvelope(input.event);
  const lifecycle = buildLifecycleControls({ input, permissions, action, generatedAt });
  const provider = normalizeProviderContract(input, generatedAt);
  const providerNegotiation = negotiateProviderCapabilities({ provider, action, lifecycle });
  const exportRequest = normalizeExportRequest({
    input,
    scope,
    boundary,
    lifecycle,
    action,
    generatedAt
  });
  const failureState = buildFailureState({
    input,
    boundary,
    validation: eventValidation,
    health: auditSinkHealth,
    operationalHealth,
    lifecycle,
    providerNegotiation,
    exportRequest,
    generatedAt
  });
  const redactionFields = normalizeRedactionFields(input.redactionFields);
  const rawEvent = eventValidation.normalizedEvent;
  const redactedEvent = redactValue(rawEvent, redactionFields);
  const redactionPaths = collectRedactionPaths(rawEvent, redactionFields);
  const evidenceBundle = buildRedactedEvidenceBundle(input.evidence, redactionFields);
  const auditHandoff = buildAuditHandoff({
    input: { ...input, action },
    scope,
    permissions,
    permissionBoundary,
    boundary,
    generatedAt,
    redactedEvent,
    redactionPaths
  });
  const deliveryMode = failureState.blocked
    ? 'blocked'
    : failureState.degradedBuffered ? 'degraded-buffered' : 'live';
  const persistedState = buildPersistedStateContract({
    input,
    scope,
    action,
    lifecycle,
    provider,
    failureState,
    auditHandoff,
    deliveryMode,
    generatedAt
  });
  const reporting = buildReportingState({
    input,
    generatedAt,
    scope,
    action,
    auditSinkHealth,
    failureState,
    redactionPaths,
    deliveryMode
  });
  const auditProofBundle = buildAuditProofBundle({
    scope,
    action,
    generatedAt,
    redactionFields,
    redactionPaths,
    workspaceBoundary,
    permissionBoundary,
    lifecycle,
    providerNegotiation,
    exportRequest,
    auditHandoff,
    persistedState,
    reporting,
    failureState,
    evidenceBundle
  });
  const exportManifest = buildAuditExportManifest({
    exportRequest,
    scope,
    action,
    generatedAt,
    redactionFields,
    boundary,
    reporting,
    providerNegotiation,
    failureState,
    proofBundle: auditProofBundle
  });
  const lifecycleClientControls = buildLifecycleClientControls({
    lifecycle,
    action,
    permissions,
    exportRequest,
    exportManifest,
    failureState,
    reporting,
    generatedAt
  });
  const externalHandoff = buildExternalHandoffState({
    provider,
    negotiation: providerNegotiation,
    failureState,
    deliveryMode,
    auditHandoff
  });
  const clientRuntime = normalizeClientRuntime(input, generatedAt);
  const workflowHandoff = buildWorkflowHandoff({
    clientRuntime,
    scope,
    action,
    deliveryMode,
    failureState,
    lifecycle,
    provider,
    externalHandoff,
    auditHandoff,
    persistedState,
    exportManifest,
    generatedAt
  });
  const operationalRecovery = buildOperationalRecoveryPlan({
    auditSinkHealth,
    operationalHealth,
    failureState,
    auditHandoff,
    persistedState
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    input,
    scope,
    action,
    redactionFields,
    redactionPaths,
    boundary,
    eventValidation,
    auditSinkHealth,
    lifecycle,
    provider,
    providerNegotiation,
    exportRequest,
    exportManifest,
    failureState,
    workflowHandoff,
    operationalHealth,
    operationalRecovery,
    persistedState,
    auditHandoff,
    deliveryMode,
    generatedAt
  });
  const clientHandoffState = buildClientHandoffStateContract({
    clientRuntime,
    workflowHandoff,
    previewAcceptance,
    externalHandoff,
    persistedState,
    auditProofBundle,
    generatedAt
  });
  const clientPreviewRoute = buildClientPreviewRouteContract({
    previewAcceptance,
    workflowHandoff,
    clientHandoffState,
    auditProofBundle,
    externalHandoff,
    persistedState,
    exportManifest,
    generatedAt
  });

  return {
    ok: !failureState.blocked,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel audit redaction boundary contract',
    scope,
    policy: {
      action,
      permissions,
      requiredPermission: action,
      redactionFields,
      tenantIsolation: scope.actorTenantId === scope.tenantId,
      workspaceIsolation: boundary.outOfScopeWorkspaceIds.length === 0,
      workspaceBoundary,
      permissionBoundary,
      lifecycleSettings: lifecycle.settings,
      lifecycleDesiredSettings: lifecycle.desiredSettings,
      lifecycleControlPlan: lifecycle.controlPlan,
      lifecycleScheduleRuntime: lifecycle.scheduleRuntime,
      lifecycleClientControls,
      providerContract: providerNegotiation,
      exportRequest,
      exportManifest,
      previewAcceptance,
      clientHandoffState,
      clientPreviewRoute
    },
    health: {
      auditSink: auditSinkHealth,
      operational: operationalHealth,
      validation: {
        eventEnvelope: eventValidation.valid ? 'valid' : 'invalid',
        lifecycleSettings: lifecycle.settingsValid ? 'valid' : 'invalid',
        lifecycleIssues: lifecycle.settingsIssues,
        summary: previewAcceptance.validationSummary
      },
      deliveryMode,
      failureState,
      operationalRecovery,
      persistedState,
      readiness: previewAcceptance.readiness,
      routeReadiness: clientPreviewRoute.validation,
      nextAction: lifecycle.nextAction,
      lifecycleClientControls,
      lifecycleControlPlan: lifecycle.controlPlan,
      lifecycleScheduleRuntime: lifecycle.scheduleRuntime
    },
    auditHandoff: {
      ...auditHandoff,
      accepted: !failureState.blocked,
      deliveryMode,
      retryPolicy: failureState.retryPolicy,
      operationalRecovery,
      actionableErrors: failureState.actionableErrors,
      degradedBuffered: failureState.degradedBuffered,
      lifecycle: {
        command: lifecycle.command.present ? lifecycle.command : null,
        commandApplied: lifecycle.commandApplied,
        controlChanges: lifecycle.controlChanges,
        controlPlan: lifecycle.controlPlan,
        clientControls: lifecycleClientControls,
        nextAction: lifecycle.nextAction,
        schedule: lifecycle.settings.schedule,
        desiredSchedule: lifecycle.desiredSettings.schedule,
        scheduleRuntime: lifecycle.scheduleRuntime,
        desiredSettings: lifecycle.desiredSettings,
        dryRun: lifecycle.settings.dryRun,
        proofRequired: lifecycle.settings.proofRequired,
        retentionDays: lifecycle.settings.retentionDays
      },
      provider,
      externalHandoff,
      clientRuntime,
      workflowHandoff,
      clientHandoffState,
      previewAcceptance,
      clientPreviewRoute,
      persistedState,
      exportRequest,
      exportManifest,
      auditProofBundle
    },
    analytics: reporting.counters,
    history: reporting.historySnapshot,
    timeline: reporting.timeline,
    exports: {
      analyticsSummary: reporting.exportSummary,
      providerContract: providerNegotiation,
      workspaceBoundary,
      permissionBoundary,
      externalHandoff,
      workflowHandoff,
      persistedState,
      operationalRecovery,
      previewAcceptance,
      clientHandoffState,
      clientPreviewRoute,
      lifecycleClientControls,
      auditExport: exportManifest,
      exportRequest,
      auditProofBundle
    },
    proof: {
      auditProofBundle,
      auditProofBundleId: auditProofBundle.evidenceId,
      auditProofCoveredSchemas: auditProofBundle.coveredSchemas,
      auditProofCommitEligible: auditProofBundle.commitEligible,
      auditProofOmissions: auditProofBundle.omissions,
      boundaryAllowed: boundary.allowed,
      boundaryReasons: boundary.reasons,
      healthReasons: auditSinkHealth.reasons,
      operationalHealthReasons: operationalHealth.reasons,
      operationalHealthComponents: operationalHealth.components.map((component) => ({
        component: component.component,
        status: component.status,
        stale: component.stale,
        reasons: component.reasons
      })),
      missingOperationalComponents: operationalHealth.missingComponents,
      lifecycleReasons: lifecycle.reasons,
      providerReasons: providerNegotiation.reasons,
      exportReasons: exportRequest.reasons,
      exportIssues: exportRequest.issues,
      exportManifestId: exportManifest.manifestId,
      exportManifestStatus: exportManifest.status,
      exportManifestReady: exportManifest.ready,
      missingProviderCapabilities: providerNegotiation.missingCapabilities,
      providerSyncStale: provider.sync.stale,
      lifecycleCommand: lifecycle.command.present ? lifecycle.command.name : null,
      lifecycleNextAction: lifecycle.nextAction,
      lifecycleControlState: lifecycle.controlPlan.stateAfterCommand,
      lifecycleControlChanges: lifecycle.controlChanges,
      lifecycleCommitRequired: lifecycle.controlPlan.commitRequired,
      lifecycleRunImmediately: lifecycle.controlPlan.runImmediately,
      lifecycleNextScheduledRunAt: lifecycle.controlPlan.nextScheduledRunAt,
      lifecycleScheduleDue: lifecycle.scheduleRuntime.due,
      lifecycleScheduleMissedRunCount: lifecycle.scheduleRuntime.missedRunCount,
      lifecycleScheduleDispatchAction: lifecycle.scheduleRuntime.dispatch.action,
      lifecycleScheduleCatchUpLimited: lifecycle.scheduleRuntime.catchUpLimited,
      lifecycleSettingsValid: lifecycle.settingsValid,
      lifecycleClientNextAction: lifecycleClientControls.nextClientAction,
      lifecycleEnabledControlIds: lifecycleClientControls.enabledControlIds,
      lifecycleRouteState: lifecycleClientControls.routeState,
      exportPreflightStatus: lifecycleClientControls.exportPreflight.status,
      exportPreflightReady: lifecycleClientControls.exportPreflight.ready,
      validationReasons: eventValidation.valid ? [] : [eventValidation.reason],
      failureState: failureState.state,
      retryBudget: failureState.retryBudget,
      operationalRecoveryMode: operationalRecovery.mode,
      operationalRecoveryTerminal: operationalRecovery.terminal,
      operationalRecoveryActions: operationalRecovery.operatorActions,
      redactedFieldCount: redactionPaths.length,
      redactedEvidenceFieldCount: evidenceBundle.redactionPathCount,
      outOfScopeWorkspaceIds: boundary.outOfScopeWorkspaceIds,
      effectiveWorkspaceIds: boundary.effectiveWorkspaceIds,
      workspaceGrantProof: boundary.workspaceProof,
      permissionBoundaryAllowed: permissionBoundary.allowed,
      permissionBoundaryReasons: permissionBoundary.reasons,
      permissionBoundarySchema: permissionBoundary.schema,
      permissionActionPath: permissionBoundary.actionPath,
      deniedPermissionWorkspaceIds: permissionBoundary.deniedWorkspaceIds,
      actorPermissionRoles: permissionBoundary.actor.roles,
      actorExplicitPermissions: permissionBoundary.actor.explicitPermissions,
      workspaceBoundarySchema: workspaceBoundary.schema,
      evidence: evidenceBundle.redacted,
      evidenceRedaction: {
        schema: evidenceBundle.schema,
        redactionPathCount: evidenceBundle.redactionPathCount,
        redactionPaths: evidenceBundle.redactionPaths
      },
      analyticsReportId: reporting.historySnapshot.reportId,
      timelineEventCount: reporting.timeline.length,
      clientRequestId: clientRuntime.requestId,
      clientSessionId: clientRuntime.clientSessionId,
      workflowState: workflowHandoff.state,
      workflowPrimaryAction: workflowHandoff.primaryAction,
      workflowResumeToken: workflowHandoff.resume.token,
      clientHandoffState: clientHandoffState.authoritative.state,
      clientRequestedHandoffState: clientHandoffState.requested.state,
      clientHandoffStateAccepted: clientHandoffState.requested.accepted,
      clientHandoffPatchRequired: clientHandoffState.transition.requiresClientPatch,
      clientHandoffAllowedNextStates: clientHandoffState.transition.allowedNextStates,
      previewAcceptanceStatus: previewAcceptance.acceptance.status,
      previewAcceptanceRequired: previewAcceptance.acceptance.required,
      previewCanCommit: previewAcceptance.readiness.canCommit,
      previewBlockedGateIds: previewAcceptance.readiness.blockedGateIds,
      previewNextSteps: previewAcceptance.nextSteps.map((step) => step.action),
      clientPreviewRouteState: clientPreviewRoute.state,
      clientPreviewPrimaryAction: clientPreviewRoute.render.primaryAction,
      clientPreviewControlActions: Object.values(clientPreviewRoute.controls).map((control) => control.action),
      clientPreviewCommitEnabled: clientPreviewRoute.controls.commit.enabled,
      clientPreviewAcceptEnabled: clientPreviewRoute.controls.accept.enabled,
      clientPreviewPayloadSchemas: Object.values(clientPreviewRoute.payloadContracts).map((contract) => contract.schema),
      persistedStatus: persistedState.next.status,
      persistedSequence: persistedState.next.sequence,
      persistedCursor: persistedState.next.cursor,
      restartSafe: persistedState.restart.safe,
      restartStatus: persistedState.restart.status,
      restartSafeStatus: persistedState.restartSafeStatus,
      recoveryCommand: persistedState.recoveryCommand.present ? persistedState.recoveryCommand.name : null,
      recoveryCommandDisposition: persistedState.recoveryCommand.disposition,
      recoveryCommandReasons: persistedState.recoveryCommand.reasons,
      recoveryAttempts: persistedState.next.recoveryAttempts,
      pendingDispatchCursor: persistedState.next.pendingDispatch.cursor,
      pendingDispatchAcknowledgedAt: persistedState.next.pendingDispatch.acknowledgedAt,
      lifecycleCommandKey: persistedState.command.key,
      lifecycleCommandDuplicate: persistedState.command.duplicate,
      recoveryPaths: persistedState.recoveryPaths
    }
  };
}

export default describeAuditRedactionSurface;
