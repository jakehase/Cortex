import { createHash } from 'node:crypto';

export const surfaceId = "aios_capability-security_capability-token_011";
export const surfaceGroup = "capability-security";
export const surfaceName = "capability-token";

const ROLE_PERMISSION_MATRIX = Object.freeze({
  viewer: ['audit:read:self', 'capability:inspect', 'workspace:read'],
  operator: ['audit:append', 'capability:inspect', 'capability:invoke', 'workspace:read'],
  maintainer: ['audit:append', 'capability:inspect', 'capability:invoke', 'capability:rotate', 'workspace:read', 'workspace:write'],
  auditor: ['audit:append', 'audit:read:tenant', 'capability:inspect', 'workspace:read'],
  'tenant-owner': [
    'audit:append',
    'audit:read:tenant',
    'capability:delegate',
    'capability:inspect',
    'capability:invoke',
    'capability:rotate',
    'workspace:read',
    'workspace:write'
  ]
});

const DEFAULT_TOKEN_TTL_SECONDS = 900;
const MAX_TOKEN_TTL_SECONDS = 3600;
const MAX_DELEGATION_DEPTH = 3;
const ANALYTICS_HISTORY_LIMIT = 50;
const ANALYTICS_TIMELINE_BUCKET_LIMIT = 14;
const ANALYTICS_EXPORT_COLUMNS = Object.freeze([
  'occurredAt',
  'issueState',
  'tenantId',
  'subjectId',
  'workspaceIds',
  'action',
  'lifecycleCommand',
  'acceptanceState',
  'readinessState',
  'providerHandoffState',
  'proofDigest',
  'ttlSeconds',
  'expiresAt',
  'expiryState',
  'delegationState',
  'delegationDepth',
  'auditReferenceCount',
  'securityGuardState',
  'revocationMatchCount',
  'replayMatchCount'
]);
const HEALTHY_STATES = new Set(['ok', 'healthy', 'ready', 'available']);
const DEGRADED_STATES = new Set(['degraded', 'slow', 'backpressure', 'rate_limited']);
const FAILED_STATES = new Set(['failed', 'down', 'offline', 'unavailable', 'error']);
const DEPENDENCY_RECOVERY_ACTIONS = Object.freeze({
  'signing-keyring': 'restore_signing_keyring_or_rotate_active_key',
  'tenant-boundary-store': 'restore_tenant_boundary_store_before_issuing_tokens',
  'audit-sink': 'restore_audit_sink_or_enable_durable_audit_retry'
});
const BASE_RETRY_BACKOFF_SECONDS = 5;
const MAX_RETRY_BACKOFF_SECONDS = 300;
const MAX_RETRY_ATTEMPTS = 3;
const DEPENDENCY_STALE_AFTER_SECONDS = 120;
const DEPENDENCY_SLOW_AFTER_MS = 1500;
const DEPENDENCY_CIRCUIT_BREAKER_FAILURES = 5;
const REQUIRED_ISSUER_DEPENDENCIES = Object.freeze(['signing-keyring', 'tenant-boundary-store', 'audit-sink']);
const ISSUE_STATES = new Set(['issued', 'issued_degraded', 'denied', 'failed']);
const PROVIDER_CAPABILITY_REQUIREMENTS = Object.freeze({
  'audit:append': ['audit-ingest'],
  'audit:read:self': ['audit-query'],
  'audit:read:tenant': ['audit-query'],
  'capability:delegate': ['capability-exchange', 'capability-introspect'],
  'capability:inspect': ['capability-introspect'],
  'capability:invoke': ['capability-exchange'],
  'capability:rotate': ['capability-exchange', 'key-rotation'],
  'workspace:read': ['workspace-boundary-read'],
  'workspace:write': ['workspace-boundary-write']
});
const PROVIDER_HANDOFF_TERMINAL_STATES = new Set(['denied', 'failed']);
const PROVIDER_HANDOFF_RECEIPT_STATES = new Set(['accepted', 'processing', 'completed', 'rejected', 'failed']);
const ACCEPTANCE_TERMINAL_ISSUE_STATES = new Set(['issued', 'issued_degraded']);
const WORKSPACE_BOUND_PERMISSIONS = new Set(['workspace:read', 'workspace:write', 'capability:invoke', 'capability:rotate']);
const RESOURCE_ACTION_PERMISSION_REQUIREMENTS = Object.freeze({
  inspect: ['capability:inspect'],
  read: ['workspace:read'],
  list: ['workspace:read'],
  invoke: ['capability:invoke'],
  execute: ['capability:invoke'],
  write: ['workspace:write'],
  update: ['workspace:write'],
  delete: ['workspace:write'],
  rotate: ['capability:rotate'],
  delegate: ['capability:delegate'],
  'audit-append': ['audit:append'],
  'audit-read': ['audit:read:tenant']
});
const DEFAULT_PROVIDER_SYNC_LEASE_SECONDS = 900;
const MAX_PROVIDER_SYNC_LEASE_SECONDS = 7200;
const CLIENT_RUNTIME_DEFAULTS = Object.freeze({
  acceptanceRoute: '/kernel/capability-token/accept',
  reviewRoute: '/kernel/capability-token/review',
  providerSyncRoute: '/kernel/capability-token/provider-sync'
});
const CLIENT_REQUEST_MAX_AGE_SECONDS = 300;
const CLIENT_REQUEST_FUTURE_SKEW_SECONDS = 30;
const ACCEPTANCE_ACKNOWLEDGEMENT_PRIORITY = Object.freeze([
  'issuer_dependency_degraded',
  'provider_sync_required',
  'lifecycle_schedule_active',
  'none'
]);
const CLIENT_RUNTIME_ROUTE_KEYS = Object.freeze(['acceptanceRoute', 'reviewRoute', 'providerSyncRoute']);
const LIFECYCLE_COMMANDS = new Set(['issue', 'enable', 'disable', 'pause-renewal', 'resume-renewal', 'rotate', 'revoke']);
const LIFECYCLE_MODES = new Set(['enforced', 'audit', 'disabled']);
const MIN_RENEW_BEFORE_SECONDS = 60;
const MAX_ROTATION_INTERVAL_SECONDS = 86400;
const SCHEDULER_EXECUTION_COMMANDS = new Set(['issue', 'enable', 'resume-renewal', 'rotate']);
const PERSISTED_COMMAND_STATES = new Set(['committed', 'applied', 'pending', 'failed', 'rolled_back']);
const PERSISTED_CHECKPOINT_STATES = new Set(['clean', 'recovering', 'dirty', 'unknown']);
const REVOCATION_STATES = new Set(['active', 'revoked', 'expired']);
const REPLAY_STATES = new Set(['consumed', 'reserved', 'expired']);
const RETRYABLE_ISSUANCE_BLOCKER_CODES = new Set([
  'issuer_dependency_degraded',
  'lifecycle_dispatch_deferred',
  'capability_token_temporarily_disabled',
  'lifecycle_schedule_due',
  'lifecycle_temporarily_disabled',
  'lifecycle_window_not_open',
  'degraded_issue_disabled'
]);
const TERMINAL_ISSUANCE_BLOCKER_CODES = new Set([
  'tenant_required',
  'subject_required',
  'cross_tenant_denied',
  'unknown_role',
  'permission_not_granted_by_role',
  'workspace_scope_required_for_permission',
  'workspace_scope_required',
  'workspace_out_of_scope',
  'capability_token_revoked_reference',
  'capability_token_replay_detected',
  'capability_token_request_timestamp_invalid',
  'capability_token_request_stale',
  'capability_token_request_from_future',
  'delegation_depth_exceeded',
  'delegation_tenant_mismatch',
  'delegation_parent_expired',
  'delegation_child_ttl_exceeds_parent'
]);
const LIFECYCLE_COMMAND_EFFECTS = Object.freeze({
  issue: {
    tokenMutation: 'issue_new_token',
    settingsMutation: 'none',
    scheduleMutation: 'consume_due_schedule',
    checkpointIntent: 'write_issued_token_checkpoint'
  },
  enable: {
    tokenMutation: 'issue_new_token',
    settingsMutation: 'set_enabled_true',
    scheduleMutation: 'clear_disabled_until',
    checkpointIntent: 'write_enabled_checkpoint'
  },
  disable: {
    tokenMutation: 'none',
    settingsMutation: 'set_enabled_false',
    scheduleMutation: 'cancel_pending_dispatch',
    checkpointIntent: 'write_disabled_checkpoint'
  },
  'pause-renewal': {
    tokenMutation: 'none',
    settingsMutation: 'set_auto_renew_false',
    scheduleMutation: 'pause_renewal_schedule',
    checkpointIntent: 'write_renewal_paused_checkpoint'
  },
  'resume-renewal': {
    tokenMutation: 'issue_new_token',
    settingsMutation: 'set_auto_renew_true',
    scheduleMutation: 'resume_renewal_schedule',
    checkpointIntent: 'write_renewal_resumed_checkpoint'
  },
  rotate: {
    tokenMutation: 'rotate_token',
    settingsMutation: 'none',
    scheduleMutation: 'consume_rotation_schedule',
    checkpointIntent: 'write_rotated_token_checkpoint'
  },
  revoke: {
    tokenMutation: 'revoke_token',
    settingsMutation: 'set_enabled_false',
    scheduleMutation: 'cancel_pending_dispatch',
    checkpointIntent: 'write_revoked_token_checkpoint'
  }
});

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return uniqueSorted(value.map(asNonEmptyString));
  }

  const normalized = asNonEmptyString(value);
  return normalized ? [normalized] : [];
}

const DEFAULT_EVIDENCE_REDACTION_FIELDS = Object.freeze([
  'accessToken',
  'apiKey',
  'authorization',
  'cookie',
  'password',
  'secret',
  'sessionToken'
]);

function normalizeEvidenceRedactionToken(value) {
  return asNonEmptyString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function shouldRedactEvidenceField(key, redactionFields) {
  const normalizedKey = normalizeEvidenceRedactionToken(key);
  if (!normalizedKey) return false;

  return redactionFields.some((field) => {
    const normalizedField = normalizeEvidenceRedactionToken(field);
    return normalizedField && (
      normalizedKey === normalizedField
        || normalizedKey.endsWith(normalizedField)
        || normalizedKey.includes(normalizedField)
    );
  });
}

function redactEvidenceValue(value, redactionFields) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactEvidenceValue(entry, redactionFields));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    shouldRedactEvidenceField(key, redactionFields)
      ? '[REDACTED]'
      : redactEvidenceValue(nested, redactionFields)
  ]));
}

function collectEvidenceRedactionPaths(value, redactionFields, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectEvidenceRedactionPaths(entry, redactionFields, path.concat(String(index))));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = path.concat(key);
    if (shouldRedactEvidenceField(key, redactionFields)) {
      return [nextPath.join('.')];
    }
    return collectEvidenceRedactionPaths(nested, redactionFields, nextPath);
  });
}

function normalizeEvidenceBundle(input = {}) {
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((entry) => entry !== undefined)
    : [];
  const redactionFields = uniqueSorted([
    ...DEFAULT_EVIDENCE_REDACTION_FIELDS,
    ...normalizeStringList(input.evidenceRedactionFields || input.redactionFields)
  ]);
  const redactionPaths = collectEvidenceRedactionPaths(evidence, redactionFields)
    .map((path) => `evidence.${path}`);

  return {
    schema: 'aios.capabilitySecurity.capabilityToken.evidenceRedaction.v1',
    supplied: evidence.length > 0,
    entryCount: evidence.length,
    redactionFields,
    redactionPaths,
    redactionPathCount: redactionPaths.length,
    redacted: redactEvidenceValue(evidence, redactionFields)
  };
}

function normalizeRoles(input) {
  const roles = normalizeStringList(input.roles || input.role);
  const knownRoles = roles.filter((role) => ROLE_PERMISSION_MATRIX[role]);
  const unknownRoles = roles.filter((role) => !ROLE_PERMISSION_MATRIX[role]);
  return {
    roles: knownRoles.length ? knownRoles : ['viewer'],
    unknownRoles
  };
}

function permissionsForRoles(roles) {
  return uniqueSorted(roles.flatMap((role) => ROLE_PERMISSION_MATRIX[role] || []));
}

function normalizeWorkspaceIds(input) {
  return uniqueSorted([
    ...normalizeStringList(input.workspaceIds),
    ...normalizeStringList(input.workspaceId),
    ...normalizeStringList(input.workspace?.id)
  ]);
}

function normalizeWorkspaceGrant(record, index, tenantId, issuedAt) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const workspaceId = asNonEmptyString(record.workspaceId || record.id || record.workspace?.id);
  if (!workspaceId) {
    return null;
  }

  const recordTenantId = asNonEmptyString(record.tenantId || record.tenant?.id || tenantId);
  const roles = normalizeRoles(record).roles;
  const rolePermissions = permissionsForRoles(roles);
  const explicitPermissions = normalizeStringList(record.permissions || record.grantedPermissions);
  const permissions = explicitPermissions.length ? explicitPermissions : rolePermissions;
  const state = asNonEmptyString(record.state || record.status || 'active').toLowerCase();
  const expiresAt = asNonEmptyString(record.expiresAt || record.validUntil);
  const expired = expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.parse(issuedAt);

  return {
    workspaceId,
    tenantId: recordTenantId || null,
    roles,
    permissions: uniqueSorted(permissions),
    state: ['active', 'pending', 'disabled', 'revoked'].includes(state) ? state : 'active',
    expiresAt: expiresAt || null,
    expired,
    source: asNonEmptyString(record.source || record.provider || record.contract) || `workspace-grant-${index + 1}`,
    isolationKey: asNonEmptyString(record.isolationKey || record.boundaryKey) || hashProof({
      tenantId: recordTenantId || null,
      workspaceId,
      permissions: uniqueSorted(permissions)
    }).slice(0, 16)
  };
}

function normalizeWorkspaceGrants(input = {}, tenantId, issuedAt) {
  const source = Array.isArray(input.workspaceGrants)
    ? input.workspaceGrants
    : Array.isArray(input.workspacePolicies)
      ? input.workspacePolicies
      : Array.isArray(input.workspaces)
        ? input.workspaces
        : [];

  return source
    .map((record, index) => normalizeWorkspaceGrant(record, index, tenantId, issuedAt))
    .filter(Boolean)
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId) || left.source.localeCompare(right.source));
}

function workspaceGrantPolicyProvided(input = {}) {
  return Array.isArray(input.workspaceGrants)
    || Array.isArray(input.workspacePolicies)
    || Array.isArray(input.workspaces);
}

function buildWorkspaceAccessPlan({ input, tenantId, workspaceIds, requestedWorkspaceId, permissions, issuedAt }) {
  const grants = normalizeWorkspaceGrants(input, tenantId, issuedAt);
  const grantPolicyProvided = workspaceGrantPolicyProvided(input);
  const grantMap = new Map(grants.map((grant) => [grant.workspaceId, grant]));
  const scopedWorkspaceIds = workspaceIds.length
    ? workspaceIds
    : grants
        .filter((grant) => grant.tenantId === tenantId && grant.state === 'active' && !grant.expired)
        .map((grant) => grant.workspaceId);
  const normalizedScope = uniqueSorted(scopedWorkspaceIds);
  const workspaceBoundPermissions = permissions.filter((permission) => WORKSPACE_BOUND_PERMISSIONS.has(permission));
  const denials = [];
  const effectiveWorkspacePermissions = {};

  for (const workspaceId of normalizedScope) {
    const grant = grantMap.get(workspaceId);
    if (!grant) {
      effectiveWorkspacePermissions[workspaceId] = grantPolicyProvided ? [] : workspaceBoundPermissions;
      if (grantPolicyProvided && workspaceBoundPermissions.length) {
        denials.push({
          code: 'workspace_grant_missing',
          workspaceId,
          permissions: workspaceBoundPermissions,
          message: 'Workspace grant policy is authoritative and does not include this scoped workspace.'
        });
      }
      continue;
    }

    const grantValid = grant.tenantId === tenantId && grant.state === 'active' && !grant.expired;
    effectiveWorkspacePermissions[workspaceId] = grantValid
      ? workspaceBoundPermissions.filter((permission) => grant.permissions.includes(permission))
      : [];

    if (grant.tenantId !== tenantId) {
      denials.push({
        code: 'workspace_grant_tenant_mismatch',
        workspaceId,
        grantTenantId: grant.tenantId,
        owningTenantId: tenantId,
        message: 'Workspace grant belongs to a different tenant boundary.'
      });
    }

    if (grant.state !== 'active') {
      denials.push({
        code: 'workspace_grant_inactive',
        workspaceId,
        state: grant.state,
        message: 'Workspace grant must be active before permissions can be issued.'
      });
    }

    if (grant.expired) {
      denials.push({
        code: 'workspace_grant_expired',
        workspaceId,
        expiresAt: grant.expiresAt,
        message: 'Workspace grant expired before this capability token was issued.'
      });
    }

    for (const permission of workspaceBoundPermissions) {
      if (grantValid && !grant.permissions.includes(permission)) {
        denials.push({
          code: 'workspace_permission_not_granted',
          workspaceId,
          permission,
          message: 'Workspace grant does not include the requested workspace-bound permission.'
        });
      }
    }
  }

  if (workspaceBoundPermissions.length && !normalizedScope.length) {
    denials.push({
      code: 'workspace_scope_required_for_permission',
      permissions: workspaceBoundPermissions,
      message: 'Workspace-bound permissions require an explicit workspace scope or active workspace grant.'
    });
  }

  return {
    contractVersion: 'capability-token.workspace-access.v1',
    requestedWorkspaceId: requestedWorkspaceId || null,
    workspaceIds: normalizedScope,
    workspaceBoundPermissions,
    grantPolicy: grantPolicyProvided ? 'authoritative' : 'explicit-scope',
    grants,
    effectiveWorkspacePermissions,
    denials,
    isolationProof: hashProof({
      surfaceId,
      tenantId: tenantId || null,
      requestedWorkspaceId: requestedWorkspaceId || null,
      workspaceIds: normalizedScope,
      workspaceBoundPermissions,
      grantPolicy: grantPolicyProvided ? 'authoritative' : 'explicit-scope',
      grants: grants.map((grant) => ({
        workspaceId: grant.workspaceId,
        tenantId: grant.tenantId,
        state: grant.state,
        expired: grant.expired,
        isolationKey: grant.isolationKey
      }))
    })
  };
}

function buildPermissionBoundaryDecision({
  roles,
  rolePermissions,
  requestedPermissions,
  workspaceAccess,
  tenantId,
  subjectId,
  issuedAt
}) {
  const permissionScopes = requestedPermissions.map((permission) => {
    const workspaceBound = WORKSPACE_BOUND_PERMISSIONS.has(permission);
    const roleAllowed = rolePermissions.includes(permission);
    const allowedWorkspaceIds = workspaceBound
      ? workspaceAccess.workspaceIds.filter((workspaceId) => (
          workspaceAccess.effectiveWorkspacePermissions[workspaceId] || []
        ).includes(permission))
      : [];
    const deniedWorkspaceIds = workspaceBound
      ? workspaceAccess.workspaceIds.filter((workspaceId) => !allowedWorkspaceIds.includes(workspaceId))
      : [];
    const grantable = roleAllowed && (
      !workspaceBound
        || Boolean(workspaceAccess.workspaceIds.length && deniedWorkspaceIds.length === 0)
    );

    return {
      permission,
      workspaceBound,
      roleAllowed,
      grantable,
      allowedWorkspaceIds,
      deniedWorkspaceIds,
      scopeState: !roleAllowed
        ? 'role_denied'
        : !workspaceBound
          ? 'tenant_granted'
          : !workspaceAccess.workspaceIds.length
            ? 'workspace_scope_missing'
            : deniedWorkspaceIds.length
              ? 'workspace_partial_or_denied'
              : 'workspace_granted'
    };
  });
  const grantedPermissions = uniqueSorted(permissionScopes
    .filter((scope) => scope.grantable)
    .map((scope) => scope.permission));
  const denials = [];

  for (const scope of permissionScopes) {
    if (!scope.roleAllowed) {
      denials.push({
        code: 'permission_not_granted_by_role',
        permission: scope.permission,
        roles,
        message: 'Requested permission is not available to the token roles.'
      });
      continue;
    }

    if (scope.workspaceBound && scope.scopeState === 'workspace_scope_missing') {
      denials.push({
        code: 'workspace_scope_required_for_permission',
        permission: scope.permission,
        message: 'Workspace-bound permission cannot be issued without a workspace scope.'
      });
      continue;
    }

    if (scope.workspaceBound && scope.deniedWorkspaceIds.length) {
      denials.push({
        code: 'permission_workspace_boundary_denied',
        permission: scope.permission,
        deniedWorkspaceIds: scope.deniedWorkspaceIds,
        allowedWorkspaceIds: scope.allowedWorkspaceIds,
        message: 'Workspace-bound permission is not authorized across the full scoped workspace boundary.'
      });
    }
  }

  const proofPayload = {
    schema: 'capability-token.permission-boundary.v1',
    surfaceId,
    tenantId: tenantId || null,
    subjectId: subjectId || null,
    roles,
    requestedPermissions,
    grantedPermissions,
    workspaceIds: workspaceAccess.workspaceIds,
    grantPolicy: workspaceAccess.grantPolicy,
    scopeStates: permissionScopes.map((scope) => [scope.permission, scope.scopeState]),
    denialCodes: denials.map((denial) => denial.code),
    issuedAt
  };

  return {
    contractVersion: 'capability-token.permission-boundary.v1',
    grantPolicy: workspaceAccess.grantPolicy,
    requestedPermissions,
    grantedPermissions,
    deniedPermissions: permissionScopes
      .filter((scope) => !scope.grantable)
      .map((scope) => scope.permission),
    permissionScopes,
    denials,
    audit: {
      stream: 'aios.kernel.capability-token.permission-boundary',
      action: denials.length ? 'capability_permission_boundary_denied' : 'capability_permission_boundary_granted',
      state: denials.length ? 'blocked' : 'granted',
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeResourceAction(value) {
  return asNonEmptyString(value || 'inspect').toLowerCase().replaceAll('_', '-');
}

function requiredPermissionsForResource(record, action) {
  const explicitPermissions = normalizeStringList(
    record.requiredPermissions
      || record.permissionsRequired
      || record.permission
      || record.requiredPermission
  );

  return explicitPermissions.length
    ? explicitPermissions
    : RESOURCE_ACTION_PERMISSION_REQUIREMENTS[action] || ['capability:inspect'];
}

function normalizeResourceBinding(record, index, fallbackTenantId, fallbackWorkspaceId) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const resourceId = firstNonEmptyString(
    record.resourceId,
    record.id,
    record.name,
    `resource-${index + 1}`
  );
  const action = normalizeResourceAction(record.action || record.operation || record.intent);
  const tenantId = firstNonEmptyString(record.tenantId, record.tenant?.id, record.ownerTenantId, fallbackTenantId) || null;
  const workspaceId = firstNonEmptyString(
    record.workspaceId,
    record.workspace?.id,
    record.boundary?.workspaceId,
    fallbackWorkspaceId
  ) || null;
  const requiredPermissions = requiredPermissionsForResource(record, action);

  return {
    resourceId,
    resourceType: asNonEmptyString(record.resourceType || record.type || record.kind) || 'kernel-resource',
    action,
    tenantId,
    workspaceId,
    requiredPermissions,
    boundaryKey: asNonEmptyString(record.boundaryKey || record.isolationKey) || hashProof({
      tenantId,
      workspaceId,
      resourceId,
      action,
      requiredPermissions
    }).slice(0, 20),
    source: asNonEmptyString(record.source || record.contract || record.provider) || `resource-binding-${index + 1}`
  };
}

function normalizeResourceBindings(input = {}, tenantId, requestedWorkspaceId) {
  const source = Array.isArray(input.resourceBindings)
    ? input.resourceBindings
    : Array.isArray(input.resources)
      ? input.resources
      : Array.isArray(input.boundResources)
        ? input.boundResources
        : input.resource && typeof input.resource === 'object'
          ? [input.resource]
          : [];

  return source
    .map((record, index) => normalizeResourceBinding(record, index, tenantId, requestedWorkspaceId))
    .filter(Boolean)
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId) || left.source.localeCompare(right.source));
}

function permissionAllowedForResource(permission, resource, workspaceAccess, grantedPermissions) {
  if (!grantedPermissions.includes(permission)) {
    return false;
  }

  if (!WORKSPACE_BOUND_PERMISSIONS.has(permission)) {
    return true;
  }

  if (!resource.workspaceId) {
    return false;
  }

  return workspaceAccess.workspaceIds.includes(resource.workspaceId)
    && (workspaceAccess.effectiveWorkspacePermissions[resource.workspaceId] || []).includes(permission);
}

function workspaceGrantForResource(resource, workspaceAccess, tenantId) {
  if (!resource.workspaceId) {
    return {
      state: 'not_required',
      workspaceId: null,
      grantSource: null,
      grantTenantId: null,
      isolationKey: null,
      denial: null
    };
  }

  const grant = workspaceAccess.grants.find((candidate) => candidate.workspaceId === resource.workspaceId);
  const authoritative = workspaceAccess.grantPolicy === 'authoritative';

  if (!grant) {
    return {
      state: authoritative ? 'missing' : 'explicit_scope',
      workspaceId: resource.workspaceId,
      grantSource: authoritative ? null : 'explicit-token-scope',
      grantTenantId: authoritative ? null : tenantId || null,
      isolationKey: authoritative
        ? null
        : hashProof({
            surfaceId,
            tenantId: tenantId || null,
            workspaceId: resource.workspaceId,
            grantPolicy: workspaceAccess.grantPolicy
          }).slice(0, 16),
      denial: authoritative
        ? {
            code: 'resource_workspace_grant_missing',
            resourceId: resource.resourceId,
            workspaceId: resource.workspaceId,
            message: 'Resource workspace requires an authoritative active workspace grant.'
          }
        : null
    };
  }

  if (grant.tenantId !== tenantId) {
    return {
      state: 'tenant_mismatch',
      workspaceId: resource.workspaceId,
      grantSource: grant.source,
      grantTenantId: grant.tenantId,
      isolationKey: grant.isolationKey,
      denial: {
        code: 'resource_workspace_grant_tenant_mismatch',
        resourceId: resource.resourceId,
        workspaceId: resource.workspaceId,
        grantTenantId: grant.tenantId,
        owningTenantId: tenantId,
        message: 'Resource workspace grant belongs to a different tenant boundary.'
      }
    };
  }

  if (grant.state !== 'active') {
    return {
      state: 'inactive',
      workspaceId: resource.workspaceId,
      grantSource: grant.source,
      grantTenantId: grant.tenantId,
      isolationKey: grant.isolationKey,
      denial: {
        code: 'resource_workspace_grant_inactive',
        resourceId: resource.resourceId,
        workspaceId: resource.workspaceId,
        grantState: grant.state,
        message: 'Resource workspace grant must be active before resource access is allowed.'
      }
    };
  }

  if (grant.expired) {
    return {
      state: 'expired',
      workspaceId: resource.workspaceId,
      grantSource: grant.source,
      grantTenantId: grant.tenantId,
      isolationKey: grant.isolationKey,
      denial: {
        code: 'resource_workspace_grant_expired',
        resourceId: resource.resourceId,
        workspaceId: resource.workspaceId,
        expiresAt: grant.expiresAt,
        message: 'Resource workspace grant expired before this token was issued.'
      }
    };
  }

  return {
    state: 'active',
    workspaceId: resource.workspaceId,
    grantSource: grant.source,
    grantTenantId: grant.tenantId,
    isolationKey: grant.isolationKey,
    denial: null
  };
}

function buildResourceBoundaryPlan({ input, tenantId, requestedWorkspaceId, workspaceAccess, permissionBoundary }) {
  const resources = normalizeResourceBindings(input, tenantId, requestedWorkspaceId);
  const grantedPermissions = permissionBoundary.grantedPermissions;
  const decisions = [];
  const denials = [];

  for (const resource of resources) {
    const deniedPermissions = resource.requiredPermissions.filter((permission) => (
      !permissionAllowedForResource(permission, resource, workspaceAccess, grantedPermissions)
    ));
    const crossTenant = Boolean(resource.tenantId && tenantId && resource.tenantId !== tenantId);
    const workspaceBoundRequired = resource.requiredPermissions.some((permission) => (
      WORKSPACE_BOUND_PERMISSIONS.has(permission)
    ));
    const workspaceMissing = workspaceBoundRequired && !resource.workspaceId;
    const workspaceOutOfScope = Boolean(
      resource.workspaceId
        && workspaceAccess.workspaceIds.length
        && !workspaceAccess.workspaceIds.includes(resource.workspaceId)
    );
    const grantResolution = workspaceGrantForResource(resource, workspaceAccess, tenantId);
    const grantDenied = Boolean(grantResolution.denial);
    const state = crossTenant || workspaceMissing || workspaceOutOfScope || grantDenied || deniedPermissions.length
      ? 'denied'
      : 'allowed';

    if (crossTenant) {
      denials.push({
        code: 'resource_cross_tenant_denied',
        resourceId: resource.resourceId,
        resourceTenantId: resource.tenantId,
        owningTenantId: tenantId,
        message: 'Resource binding crosses the owning tenant boundary.'
      });
    }

    if (workspaceMissing) {
      denials.push({
        code: 'resource_workspace_scope_required',
        resourceId: resource.resourceId,
        requiredPermissions: resource.requiredPermissions,
        message: 'Resource action requires a workspace-bound scope.'
      });
    }

    if (workspaceOutOfScope) {
      denials.push({
        code: 'resource_workspace_out_of_scope',
        resourceId: resource.resourceId,
        workspaceId: resource.workspaceId,
        allowedWorkspaceIds: workspaceAccess.workspaceIds,
        message: 'Resource workspace is outside the capability token workspace allowlist.'
      });
    }

    if (grantResolution.denial) {
      denials.push(grantResolution.denial);
    }

    for (const permission of deniedPermissions) {
      denials.push({
        code: 'resource_permission_not_granted',
        resourceId: resource.resourceId,
        permission,
        workspaceId: resource.workspaceId,
        message: 'Resource action requires a permission that was not granted for this boundary.'
      });
    }

    decisions.push({
      ...resource,
      state,
      grantedPermissions: resource.requiredPermissions.filter((permission) => !deniedPermissions.includes(permission)),
      deniedPermissions,
      workspaceGrant: {
        state: grantResolution.state,
        source: grantResolution.grantSource,
        grantTenantId: grantResolution.grantTenantId,
        isolationKey: grantResolution.isolationKey,
        proof: hashProof({
          schema: 'capability-token.resource-workspace-grant.v1',
          tenantId: tenantId || null,
          resourceId: resource.resourceId,
          workspaceId: resource.workspaceId || null,
          grantState: grantResolution.state,
          grantSource: grantResolution.grantSource,
          grantTenantId: grantResolution.grantTenantId,
          isolationKey: grantResolution.isolationKey
        })
      },
      workspaceScopeState: !workspaceBoundRequired
        ? 'tenant_permission'
        : workspaceMissing
          ? 'workspace_missing'
          : workspaceOutOfScope
            ? 'workspace_out_of_scope'
            : grantDenied
              ? `workspace_grant_${grantResolution.state}`
            : 'workspace_scoped'
    });
  }

  const proofPayload = {
    schema: 'capability-token.resource-boundary.v1',
    surfaceId,
    tenantId: tenantId || null,
    resourceCount: resources.length,
    states: decisions.map((decision) => [decision.resourceId, decision.state, decision.workspaceScopeState]),
    workspaceGrantStates: decisions.map((decision) => [
      decision.resourceId,
      decision.workspaceId || null,
      decision.workspaceGrant.state,
      decision.workspaceGrant.source,
      decision.workspaceGrant.proof
    ]),
    denialCodes: denials.map((denial) => denial.code),
    workspaceAccessProof: workspaceAccess.isolationProof,
    permissionBoundaryProof: permissionBoundary.proof.digest
  };
  const state = denials.length ? 'blocked' : resources.length ? 'scoped' : 'not_requested';

  return {
    contractVersion: 'capability-token.resource-boundary.v1',
    state,
    resourceCount: resources.length,
    allowedResourceIds: decisions.filter((decision) => decision.state === 'allowed').map((decision) => decision.resourceId),
    deniedResourceIds: decisions.filter((decision) => decision.state === 'denied').map((decision) => decision.resourceId),
    workspaceGrantLineage: {
      policy: workspaceAccess.grantPolicy,
      grantProofs: decisions
        .filter((decision) => decision.workspaceId)
        .map((decision) => ({
          resourceId: decision.resourceId,
          workspaceId: decision.workspaceId,
          state: decision.workspaceGrant.state,
          source: decision.workspaceGrant.source,
          grantTenantId: decision.workspaceGrant.grantTenantId,
          proof: decision.workspaceGrant.proof
        })),
      digest: hashProof({
        schema: 'capability-token.resource-workspace-grant-lineage.v1',
        tenantId: tenantId || null,
        grantPolicy: workspaceAccess.grantPolicy,
        grants: decisions
          .filter((decision) => decision.workspaceId)
          .map((decision) => [
            decision.resourceId,
            decision.workspaceId,
            decision.workspaceGrant.state,
            decision.workspaceGrant.source,
            decision.workspaceGrant.grantTenantId,
            decision.workspaceGrant.proof
          ])
      })
    },
    decisions,
    denials,
    audit: {
      stream: 'aios.kernel.capability-token.resource-boundary',
      action: state === 'blocked'
        ? 'resource_boundary_denied'
        : state === 'scoped'
          ? 'resource_boundary_scoped'
          : 'resource_boundary_not_requested',
      state,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeTtlSeconds(input) {
  const ttl = Number(input.ttlSeconds ?? input.ttl ?? DEFAULT_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return DEFAULT_TOKEN_TTL_SECONDS;
  }

  return Math.min(Math.floor(ttl), MAX_TOKEN_TTL_SECONDS);
}

function delegationInputFrom(input = {}) {
  return input.delegation
    || input.delegationRequest
    || input.delegatedCapability
    || input.delegate
    || {};
}

function delegationRequested(input = {}, delegation = delegationInputFrom(input)) {
  return delegation.enabled === true
    || delegation.requested === true
    || delegation.mode === 'delegated'
    || Boolean(input.parentToken || input.parentTokenId || delegation.parentToken || delegation.parentTokenId);
}

function normalizeDelegationDepth(value) {
  const depth = Number(value);
  return Number.isFinite(depth) && depth >= 0 ? Math.floor(depth) : 0;
}

function normalizeParentCapabilityToken(input = {}, delegation = delegationInputFrom(input)) {
  const parent = delegation.parentToken || input.parentToken || input.delegatedFrom || {};
  const parentTokenId = firstNonEmptyString(
    delegation.parentTokenId,
    input.parentTokenId,
    parent.tokenId,
    parent.id,
    parent.token?.id
  );
  const proofDigest = firstNonEmptyString(
    delegation.parentProofDigest,
    delegation.proofDigest,
    input.parentProofDigest,
    parent.proofDigest,
    parent.proof?.digest,
    parent.auditHandoff?.proof
  );
  const auditProof = firstNonEmptyString(
    delegation.parentAuditProof,
    input.parentAuditProof,
    parent.auditProof,
    parent.auditHandoff?.proof,
    parent.auditHandoff?.boundaryProof?.grantedPermissionDigest
  );
  const tenantId = firstNonEmptyString(parent.tenantId, parent.boundary?.tenantId, parent.token?.boundary?.tenantId);
  const subjectId = firstNonEmptyString(parent.subjectId, parent.token?.subjectId, parent.principalId);
  const expiresAt = normalizeOperationalTimestamp(parent.expiresAt || parent.token?.expiresAt || delegation.parentExpiresAt);

  return {
    tokenId: parentTokenId || null,
    subjectId: subjectId || null,
    tenantId: tenantId || null,
    workspaceIds: uniqueSorted([
      ...normalizeStringList(parent.workspaceIds),
      ...normalizeStringList(parent.boundary?.workspaceIds),
      ...normalizeStringList(parent.token?.boundary?.workspaceIds)
    ]),
    permissions: normalizeStringList(parent.permissions || parent.token?.permissions || parent.grantedPermissions),
    expiresAt,
    proofDigest: proofDigest || null,
    auditProof: auditProof || null,
    delegationDepth: normalizeDelegationDepth(parent.delegation?.depth ?? parent.delegationDepth ?? delegation.parentDepth),
    chain: normalizeStringList(parent.delegation?.chain || parent.delegationChain || delegation.parentChain)
  };
}

function normalizeDelegationAttenuation(input = {}, delegation = delegationInputFrom(input), boundary = {}, grantedPermissions = [], expiresAt = null) {
  const requestedPermissions = uniqueSorted([
    ...normalizeStringList(delegation.permissions),
    ...normalizeStringList(delegation.requestedPermissions),
    ...normalizeStringList(delegation.scope?.permissions),
    ...normalizeStringList(input.delegatedPermissions)
  ]);
  const requestedWorkspaceIds = uniqueSorted([
    ...normalizeStringList(delegation.workspaceIds),
    ...normalizeStringList(delegation.workspaceId),
    ...normalizeStringList(delegation.scope?.workspaceIds),
    ...normalizeStringList(delegation.scope?.workspaceId),
    ...normalizeStringList(input.delegatedWorkspaceIds)
  ]);
  const requestedExpiresAt = normalizeOperationalTimestamp(
    delegation.expiresAt
      || delegation.validUntil
      || delegation.scope?.expiresAt
      || delegation.scope?.validUntil
      || input.delegatedExpiresAt
  );
  const permissionMode = requestedPermissions.length ? 'requested-subset' : 'inherit-issued-grant';
  const workspaceMode = requestedWorkspaceIds.length ? 'requested-subset' : 'inherit-issued-boundary';
  const effectivePermissions = requestedPermissions.length
    ? requestedPermissions.filter((permission) => grantedPermissions.includes(permission))
    : grantedPermissions;
  const effectiveWorkspaceIds = requestedWorkspaceIds.length
    ? requestedWorkspaceIds.filter((workspaceId) => (boundary.workspaceIds || []).includes(workspaceId))
    : boundary.workspaceIds || [];
  const effectiveExpiresAt = requestedExpiresAt
    && expiresAt
    && Date.parse(requestedExpiresAt) < Date.parse(expiresAt)
      ? requestedExpiresAt
      : expiresAt;

  return {
    contractVersion: 'capability-token.delegation-attenuation.v1',
    requested: {
      permissions: requestedPermissions,
      workspaceIds: requestedWorkspaceIds,
      expiresAt: requestedExpiresAt
    },
    effective: {
      permissions: effectivePermissions,
      workspaceIds: effectiveWorkspaceIds,
      expiresAt: effectiveExpiresAt
    },
    mode: {
      permissions: permissionMode,
      workspaces: workspaceMode,
      expiry: requestedExpiresAt ? 'requested-cap' : 'inherit-child-expiry'
    },
    attenuated: Boolean(
      requestedPermissions.length
        || requestedWorkspaceIds.length
        || (requestedExpiresAt && requestedExpiresAt !== expiresAt)
    )
  };
}

function buildDelegationPlan({
  input,
  tenantId,
  subjectId,
  boundary,
  grantedPermissions,
  issuedAt,
  expiresAt
}) {
  const delegation = delegationInputFrom(input);
  const requested = delegationRequested(input, delegation);
  const parent = normalizeParentCapabilityToken(input, delegation);
  const denials = [];
  const warnings = [];
  const attenuation = normalizeDelegationAttenuation(input, delegation, boundary, grantedPermissions, expiresAt);
  const depth = requested ? parent.delegationDepth + 1 : 0;
  const maxDepth = Math.min(
    MAX_DELEGATION_DEPTH,
    normalizePositiveIntegerSetting(delegation.maxDepth || input.maxDelegationDepth, MAX_DELEGATION_DEPTH)
  );

  if (!requested) {
    return {
      contractVersion: 'capability-token.delegation.v1',
      requested: false,
      state: 'not_requested',
      mode: 'direct',
      depth: 0,
      maxDepth,
      parent,
      attenuation,
      chain: [],
      auditReferences: [],
      denials,
      warnings,
      proof: {
        algorithm: 'sha256',
        digest: hashProof({
          schema: 'capability-token.delegation.v1',
          state: 'not_requested',
          tenantId: tenantId || null,
          subjectId: subjectId || null
        }),
        signedFields: ['schema', 'state', 'tenantId', 'subjectId']
      }
    };
  }

  if (!parent.tokenId) {
    denials.push({
      code: 'delegation_parent_token_required',
      message: 'Delegated capability tokens require a parent token id.'
    });
  }

  if (!parent.proofDigest) {
    denials.push({
      code: 'delegation_parent_proof_required',
      parentTokenId: parent.tokenId,
      message: 'Delegated capability tokens require a parent token proof digest.'
    });
  }

  if (attenuation.requested.expiresAt && Date.parse(attenuation.requested.expiresAt) <= Date.parse(issuedAt)) {
    denials.push({
      code: 'delegation_requested_expiry_elapsed',
      requestedExpiresAt: attenuation.requested.expiresAt,
      issuedAt,
      message: 'Delegation requested expiry must be later than the token issue time.'
    });
  }

  for (const permission of attenuation.requested.permissions) {
    if (!grantedPermissions.includes(permission)) {
      denials.push({
        code: 'delegation_requested_permission_not_granted',
        parentTokenId: parent.tokenId,
        permission,
        grantedPermissions,
        message: 'Delegation requested permissions must be a subset of the issued child grant.'
      });
    }
  }

  for (const workspaceId of attenuation.requested.workspaceIds) {
    if (!boundary.workspaceIds.includes(workspaceId)) {
      denials.push({
        code: 'delegation_requested_workspace_out_of_scope',
        parentTokenId: parent.tokenId,
        workspaceId,
        workspaceIds: boundary.workspaceIds,
        message: 'Delegation requested workspaces must be a subset of the issued child boundary.'
      });
    }
  }

  for (const permission of grantedPermissions) {
    if (attenuation.requested.permissions.length && !attenuation.requested.permissions.includes(permission)) {
      denials.push({
        code: 'delegation_child_permission_exceeds_requested_scope',
        parentTokenId: parent.tokenId,
        permission,
        requestedPermissions: attenuation.requested.permissions,
        message: 'Delegated capability token grant exceeds the requested delegated permission scope.'
      });
    }
  }

  for (const workspaceId of boundary.workspaceIds) {
    if (attenuation.requested.workspaceIds.length && !attenuation.requested.workspaceIds.includes(workspaceId)) {
      denials.push({
        code: 'delegation_child_workspace_exceeds_requested_scope',
        parentTokenId: parent.tokenId,
        workspaceId,
        requestedWorkspaceIds: attenuation.requested.workspaceIds,
        message: 'Delegated capability token boundary exceeds the requested delegated workspace scope.'
      });
    }
  }

  if (!grantedPermissions.includes('capability:delegate')) {
    denials.push({
      code: 'delegation_permission_required',
      parentTokenId: parent.tokenId,
      message: 'Delegated capability tokens require the capability:delegate permission in the issued grant.'
    });
  }

  if (parent.tenantId && tenantId && parent.tenantId !== tenantId) {
    denials.push({
      code: 'delegation_tenant_mismatch',
      parentTokenId: parent.tokenId,
      parentTenantId: parent.tenantId,
      tenantId,
      message: 'Delegated capability token tenant must match the parent token tenant boundary.'
    });
  }

  if (parent.expiresAt && Date.parse(parent.expiresAt) <= Date.parse(issuedAt)) {
    denials.push({
      code: 'delegation_parent_expired',
      parentTokenId: parent.tokenId,
      parentExpiresAt: parent.expiresAt,
      message: 'Delegated capability token parent expired before this token was issued.'
    });
  }

  if (parent.expiresAt && Date.parse(parent.expiresAt) < Date.parse(expiresAt)) {
    denials.push({
      code: 'delegation_child_ttl_exceeds_parent',
      parentTokenId: parent.tokenId,
      parentExpiresAt: parent.expiresAt,
      childExpiresAt: expiresAt,
      message: 'Delegated capability tokens cannot expire after the parent token.'
    });
  }

  if (depth > maxDepth) {
    denials.push({
      code: 'delegation_depth_exceeded',
      parentTokenId: parent.tokenId,
      depth,
      maxDepth,
      message: 'Delegation chain depth exceeds the configured capability token maximum.'
    });
  }

  for (const permission of grantedPermissions) {
    if (parent.permissions.length && !parent.permissions.includes(permission)) {
      denials.push({
        code: 'delegation_permission_expanded',
        parentTokenId: parent.tokenId,
        permission,
        message: 'Delegated capability tokens cannot grant permissions absent from the parent token.'
      });
    }
  }

  for (const workspaceId of boundary.workspaceIds) {
    if (parent.workspaceIds.length && !parent.workspaceIds.includes(workspaceId)) {
      denials.push({
        code: 'delegation_workspace_scope_expanded',
        parentTokenId: parent.tokenId,
        workspaceId,
        parentWorkspaceIds: parent.workspaceIds,
        message: 'Delegated capability tokens cannot expand the parent workspace allowlist.'
      });
    }
  }

  if (parent.subjectId && parent.subjectId === subjectId) {
    warnings.push({
      code: 'delegation_same_subject',
      parentTokenId: parent.tokenId,
      subjectId,
      message: 'Delegation parent and child subjects are identical; direct renewal may be more appropriate.'
    });
  }

  const chain = uniqueSorted([parent.tokenId, ...parent.chain].filter(Boolean));
  const auditReferences = [
    parent.proofDigest && {
      type: 'parent-token-proof',
      tokenId: parent.tokenId,
      digest: parent.proofDigest
    },
    parent.auditProof && {
      type: 'parent-audit-proof',
      tokenId: parent.tokenId,
      digest: parent.auditProof
    },
    attenuation.attenuated && {
      type: 'delegation-attenuation-proof',
      tokenId: parent.tokenId,
      digest: hashProof({
        schema: attenuation.contractVersion,
        parentTokenId: parent.tokenId,
        requested: attenuation.requested,
        effective: attenuation.effective,
        mode: attenuation.mode
      })
    }
  ].filter(Boolean);
  const state = denials.length ? 'blocked' : 'delegated';
  const proofPayload = {
    schema: 'capability-token.delegation.v1',
    surfaceId,
    requested,
    state,
    tenantId: tenantId || null,
    subjectId: subjectId || null,
    parentTokenId: parent.tokenId,
    parentSubjectId: parent.subjectId,
    parentTenantId: parent.tenantId,
    workspaceIds: boundary.workspaceIds,
    permissions: grantedPermissions,
    attenuation,
    depth,
    maxDepth,
    chain,
    auditReferences,
    denialCodes: denials.map((denial) => denial.code),
    warningCodes: warnings.map((warning) => warning.code)
  };

  return {
    contractVersion: 'capability-token.delegation.v1',
    requested,
    state,
    mode: 'attenuated',
    depth,
    maxDepth,
    parent,
    attenuation,
    chain,
    auditReferences,
    denials,
    warnings,
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeRevocationRecord(record, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const tokenId = firstNonEmptyString(record.tokenId, record.id, record.token?.id);
  const proofDigest = firstNonEmptyString(record.proofDigest, record.proof?.digest, record.auditProof);
  if (!tokenId && !proofDigest) {
    return null;
  }

  const state = asNonEmptyString(record.state || record.status || 'revoked').toLowerCase();
  return {
    sequence: Number.isInteger(record.sequence) ? record.sequence : index + 1,
    tokenId: tokenId || null,
    proofDigest: proofDigest || null,
    tenantId: firstNonEmptyString(record.tenantId, record.boundary?.tenantId, record.token?.boundary?.tenantId) || null,
    subjectId: firstNonEmptyString(record.subjectId, record.token?.subjectId, record.principalId) || null,
    state: REVOCATION_STATES.has(state) ? state : 'revoked',
    reason: asNonEmptyString(record.reason || record.code || record.revocationReason) || 'operator_revoked',
    revokedAt: normalizeOperationalTimestamp(record.revokedAt || record.updatedAt || record.createdAt),
    expiresAt: normalizeOperationalTimestamp(record.expiresAt || record.token?.expiresAt),
    source: asNonEmptyString(record.source || record.registry || record.provider) || `revocation-${index + 1}`
  };
}

function normalizeReplayRecord(record, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const nonce = firstNonEmptyString(record.nonce, record.requestNonce, record.replayNonce, record.idempotencyKey);
  const requestId = firstNonEmptyString(record.requestId, record.clientRequestId, record.clientRuntime?.requestId);
  const key = firstNonEmptyString(nonce, requestId, record.proofDigest, record.proof?.digest);
  if (!key) {
    return null;
  }

  const state = asNonEmptyString(record.state || record.status || 'consumed').toLowerCase();
  return {
    sequence: Number.isInteger(record.sequence) ? record.sequence : index + 1,
    nonce: nonce || null,
    requestId: requestId || null,
    proofDigest: firstNonEmptyString(record.proofDigest, record.proof?.digest, record.auditProof) || null,
    tenantId: firstNonEmptyString(record.tenantId, record.boundary?.tenantId) || null,
    subjectId: firstNonEmptyString(record.subjectId, record.principalId) || null,
    state: REPLAY_STATES.has(state) ? state : 'consumed',
    observedAt: normalizeOperationalTimestamp(record.observedAt || record.consumedAt || record.createdAt),
    expiresAt: normalizeOperationalTimestamp(record.expiresAt || record.validUntil),
    source: asNonEmptyString(record.source || record.registry) || `replay-${index + 1}`
  };
}

function normalizeSecurityRegistry(input = {}) {
  const registry = input.securityRegistry || input.capabilitySecurity || input.security?.capabilityToken || {};
  const rawRevocations = Array.isArray(registry.revocations)
    ? registry.revocations
    : Array.isArray(input.revocations)
      ? input.revocations
      : Array.isArray(input.revokedTokens)
        ? input.revokedTokens
        : Array.isArray(input.tokenRevocations)
          ? input.tokenRevocations
          : [];
  const rawReplay = Array.isArray(registry.replayNonces)
    ? registry.replayNonces
    : Array.isArray(registry.consumedNonces)
      ? registry.consumedNonces
      : Array.isArray(input.replayNonces)
        ? input.replayNonces
        : Array.isArray(input.consumedNonces)
          ? input.consumedNonces
          : [];

  return {
    revocations: rawRevocations
      .map((record, index) => normalizeRevocationRecord(record, index))
      .filter(Boolean),
    replayNonces: rawReplay
      .map((record, index) => normalizeReplayRecord(record, index))
      .filter(Boolean)
  };
}

function activeRevocationMatch(record, references, tenantId, subjectId, now) {
  if (record.state !== 'revoked' && record.state !== 'active') {
    return false;
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now)) {
    return false;
  }
  if (record.tenantId && tenantId && record.tenantId !== tenantId) {
    return false;
  }
  if (record.subjectId && subjectId && record.subjectId !== subjectId) {
    return false;
  }
  return Boolean(
    (record.tokenId && references.tokenIds.includes(record.tokenId))
      || (record.proofDigest && references.proofDigests.includes(record.proofDigest))
  );
}

function consumedReplayMatch(record, requestNonce, requestId, tenantId, subjectId, now) {
  if (record.state !== 'consumed' && record.state !== 'reserved') {
    return false;
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now)) {
    return false;
  }
  if (record.tenantId && tenantId && record.tenantId !== tenantId) {
    return false;
  }
  if (record.subjectId && subjectId && record.subjectId !== subjectId) {
    return false;
  }
  return Boolean(
    (requestNonce && record.nonce === requestNonce)
      || (requestId && record.requestId === requestId)
  );
}

function buildCapabilityTokenSecurityGuard({ input, tenantId, subjectId, clientRuntime, delegationPlan, now }) {
  const registry = normalizeSecurityRegistry(input);
  const requestNonce = firstNonEmptyString(
    input.requestNonce,
    input.replayNonce,
    input.nonce,
    input.request?.nonce,
    input.clientRuntime?.nonce
  );
  const references = {
    tokenIds: uniqueSorted([
      input.tokenId,
      input.currentTokenId,
      input.reissueTokenId,
      delegationPlan.parent.tokenId
    ].map(asNonEmptyString)),
    proofDigests: uniqueSorted([
      input.proofDigest,
      input.currentProofDigest,
      delegationPlan.parent.proofDigest
    ].map(asNonEmptyString))
  };
  const revocationMatches = registry.revocations.filter((record) => (
    activeRevocationMatch(record, references, tenantId, subjectId, now)
  ));
  const replayMatches = registry.replayNonces.filter((record) => (
    consumedReplayMatch(record, requestNonce, clientRuntime.requestId, tenantId, subjectId, now)
  ));
  const denials = [
    ...revocationMatches.map((record) => ({
      code: 'capability_token_revoked_reference',
      tokenId: record.tokenId,
      proofDigest: record.proofDigest,
      reason: record.reason,
      source: record.source,
      message: 'Capability token request references a revoked token or proof digest.'
    })),
    ...replayMatches.map((record) => ({
      code: 'capability_token_replay_detected',
      nonce: record.nonce,
      requestId: record.requestId,
      source: record.source,
      message: 'Capability token request nonce or request id was already consumed.'
    })),
    clientRuntime.freshness?.denial && {
      ...clientRuntime.freshness.denial,
      source: 'client-runtime-freshness'
    }
  ];
  const activeDenials = denials.filter(Boolean);
  const state = activeDenials.length
    ? 'blocked'
    : !clientRuntime.freshness?.supplied
      ? requestNonce ? 'freshness_unobserved' : 'unsealed_request'
      : requestNonce ? 'guarded' : 'unsealed_request';
  const proofPayload = {
    schema: 'capability-token.security-guard.v1',
    surfaceId,
    tenantId: tenantId || null,
    subjectId: subjectId || null,
    requestId: clientRuntime.requestId,
    requestNonce: requestNonce || null,
    referenceTokenIds: references.tokenIds,
    referenceProofDigests: references.proofDigests,
    revocationMatchCount: revocationMatches.length,
    replayMatchCount: replayMatches.length,
    requestFreshnessState: clientRuntime.freshness?.state || 'unobserved',
    requestFreshnessProof: clientRuntime.freshness?.proof?.digest || null,
    denialCodes: activeDenials.map((denial) => denial.code),
    state,
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.security-guard.v1',
    state,
    requestNonce: requestNonce || null,
    requestSealed: Boolean(requestNonce),
    requestFreshness: clientRuntime.freshness || null,
    requestFresh: clientRuntime.freshness?.state === 'fresh',
    referenceTokenIds: references.tokenIds,
    referenceProofDigests: references.proofDigests,
    registry: {
      revocationCount: registry.revocations.length,
      replayNonceCount: registry.replayNonces.length,
      revocationMatchCount: revocationMatches.length,
      replayMatchCount: replayMatches.length
    },
    revocationMatches,
    replayMatches,
    denials: activeDenials,
    audit: {
      stream: 'aios.kernel.capability-token.security-guard',
      action: activeDenials.length ? 'capability_token_security_guard_blocked' : 'capability_token_security_guard_clear',
      state,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function hashProof(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeClientRoute(value, fallback, key) {
  const route = asNonEmptyString(value);
  if (!route) {
    return { route: fallback, source: 'default', warning: null };
  }

  if (!route.startsWith('/') || route.startsWith('//') || route.includes('://')) {
    return {
      route: fallback,
      source: 'default',
      warning: {
        code: 'unsafe_client_route_rejected',
        routeKey: key,
        suppliedRoute: route,
        fallbackRoute: fallback,
        message: 'Client workflow routes must be local hosted-kernel paths.'
      }
    };
  }

  return { route, source: 'client', warning: null };
}

function normalizeClientRuntimeRouteCatalog(runtime = {}, handoff = {}, request = {}) {
  const suppliedRoutes = {
    ...(request.routes || {}),
    ...(runtime.routes || {}),
    ...(handoff.routes || {})
  };
  const normalized = {};
  const sources = {};
  const warnings = [];

  for (const key of CLIENT_RUNTIME_ROUTE_KEYS) {
    const result = normalizeClientRoute(
      firstNonEmptyString(suppliedRoutes[key], runtime[key], handoff[key], request[key]),
      CLIENT_RUNTIME_DEFAULTS[key],
      key
    );
    normalized[key] = result.route;
    sources[key] = result.source;
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return {
    contractVersion: 'capability-token.client-routes.v1',
    ...normalized,
    sources,
    warningCount: warnings.length,
    warnings,
    digest: hashProof({
      schema: 'capability-token.client-routes.v1',
      routes: normalized,
      sources,
      warningCodes: warnings.map((warning) => warning.code)
    })
  };
}

function normalizeClientRequestFreshness(input = {}, runtime = {}, request = {}, now = normalizeIssuedAt(input.now)) {
  const suppliedAt = firstNonEmptyString(
    runtime.requestedAt,
    runtime.createdAt,
    runtime.issuedAt,
    request.requestedAt,
    request.createdAt,
    request.issuedAt,
    input.requestedAt,
    input.requestCreatedAt
  );
  const observedAt = suppliedAt && Number.isFinite(Date.parse(suppliedAt))
    ? new Date(suppliedAt).toISOString()
    : null;
  const ageSeconds = observedAt
    ? Math.floor((Date.parse(now) - Date.parse(observedAt)) / 1000)
    : null;
  const invalid = Boolean(suppliedAt && !observedAt);
  const fromFuture = ageSeconds !== null && ageSeconds < -CLIENT_REQUEST_FUTURE_SKEW_SECONDS;
  const stale = ageSeconds !== null && ageSeconds > CLIENT_REQUEST_MAX_AGE_SECONDS;
  const state = invalid
    ? 'invalid'
    : !observedAt
      ? 'unobserved'
      : fromFuture
        ? 'future_skew'
        : stale
          ? 'stale'
          : 'fresh';
  const denial = state === 'invalid'
    ? {
        code: 'capability_token_request_timestamp_invalid',
        suppliedAt,
        message: 'Client capability token request timestamp must be parseable before replay sealing can be trusted.'
      }
    : state === 'future_skew'
      ? {
          code: 'capability_token_request_from_future',
          requestedAt: observedAt,
          ageSeconds,
          maxFutureSkewSeconds: CLIENT_REQUEST_FUTURE_SKEW_SECONDS,
          message: 'Client capability token request timestamp is beyond the hosted-kernel future skew allowance.'
        }
      : state === 'stale'
        ? {
            code: 'capability_token_request_stale',
            requestedAt: observedAt,
            ageSeconds,
            maxAgeSeconds: CLIENT_REQUEST_MAX_AGE_SECONDS,
            message: 'Client capability token request timestamp is outside the hosted-kernel freshness window.'
          }
        : null;

  return {
    contractVersion: 'capability-token.client-request-freshness.v1',
    state,
    supplied: Boolean(suppliedAt),
    requestedAt: observedAt,
    assessedAt: now,
    ageSeconds,
    maxAgeSeconds: CLIENT_REQUEST_MAX_AGE_SECONDS,
    maxFutureSkewSeconds: CLIENT_REQUEST_FUTURE_SKEW_SECONDS,
    blocking: Boolean(denial),
    denial,
    proof: {
      algorithm: 'sha256',
      digest: hashProof({
        schema: 'capability-token.client-request-freshness.v1',
        state,
        supplied: Boolean(suppliedAt),
        requestedAt: observedAt,
        assessedAt: now,
        ageSeconds,
        maxAgeSeconds: CLIENT_REQUEST_MAX_AGE_SECONDS,
        maxFutureSkewSeconds: CLIENT_REQUEST_FUTURE_SKEW_SECONDS,
        denialCode: denial?.code || null
      }),
      signedFields: [
        'schema',
        'state',
        'supplied',
        'requestedAt',
        'assessedAt',
        'ageSeconds',
        'maxAgeSeconds',
        'maxFutureSkewSeconds',
        'denialCode'
      ]
    }
  };
}

function normalizeClientRuntimeState(input = {}, boundary = {}, subjectId = '') {
  const runtime = input.clientRuntime || input.clientState || input.requestState || {};
  const request = input.request || runtime.request || {};
  const workflow = input.workflow || runtime.workflow || {};
  const handoff = input.handoff || runtime.handoff || {};
  const routeCatalog = normalizeClientRuntimeRouteCatalog(runtime, handoff, request);
  const freshness = normalizeClientRequestFreshness(input, runtime, request, normalizeIssuedAt(input.now));
  const requestSeed = {
    tenantId: boundary.tenantId || null,
    subjectId: subjectId || null,
    workspaceIds: boundary.workspaceIds || [],
    requestedPermissions: normalizeStringList(input.requestedPermissions || input.permissions),
    now: input.now || null
  };
  const requestId = firstNonEmptyString(
    runtime.requestId,
    request.requestId,
    input.requestId,
    `capreq_${hashProof(requestSeed).slice(0, 18)}`
  );
  const sessionId = firstNonEmptyString(runtime.sessionId, request.sessionId, input.sessionId);
  const clientId = firstNonEmptyString(runtime.clientId, request.clientId, input.clientId);
  const activeRoute = firstNonEmptyString(runtime.activeRoute, runtime.route, request.route);
  const returnRoute = firstNonEmptyString(
    handoff.returnRoute,
    runtime.returnRoute,
    request.returnTo,
    request.returnRoute,
    routeCatalog.reviewRoute
  );
  const continuationId = firstNonEmptyString(
    handoff.continuationId,
    runtime.continuationId,
    request.continuationId,
    workflow.continuationId
  );

  return {
    contractVersion: 'capability-token.client-runtime.v1',
    requestId,
    sessionId: sessionId || null,
    clientId: clientId || null,
    workflowId: firstNonEmptyString(workflow.workflowId, runtime.workflowId, input.workflowId) || null,
    continuationId: continuationId || null,
    activeRoute: activeRoute || null,
    returnRoute,
    originSurface: firstNonEmptyString(runtime.originSurface, request.originSurface, input.originSurface) || null,
    requestedAction: firstNonEmptyString(handoff.action, runtime.requestedAction, request.action, 'capability_token_accept'),
    interactive: runtime.interactive === false || request.interactive === false ? false : true,
    evidenceRefs: normalizeStringList(runtime.evidenceRefs || request.evidenceRefs),
    routeCatalog,
    routeWarnings: routeCatalog.warnings,
    freshness,
    stateDigest: hashProof({
      schema: 'capability-token.client-runtime.v1',
      requestId,
      sessionId: sessionId || null,
      clientId: clientId || null,
      workflowId: firstNonEmptyString(workflow.workflowId, runtime.workflowId, input.workflowId) || null,
      continuationId: continuationId || null,
      tenantId: boundary.tenantId || null,
      subjectId: subjectId || null,
      workspaceIds: boundary.workspaceIds || [],
      requestedAction: firstNonEmptyString(handoff.action, runtime.requestedAction, request.action, 'capability_token_accept'),
      routeCatalogDigest: routeCatalog.digest,
      freshnessProof: freshness.proof.digest
    })
  };
}

function normalizeBooleanSetting(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizePositiveIntegerSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeNonNegativeIntegerSetting(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeTimestampSetting(value) {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return { raw: null, iso: null, valid: true };
  }

  return Number.isFinite(Date.parse(raw))
    ? { raw, iso: new Date(raw).toISOString(), valid: true }
    : { raw, iso: null, valid: false };
}

function normalizeLifecycleCommand(input = {}) {
  const lifecycle = input.lifecycle || input.lifecycleControls || {};
  const raw = asNonEmptyString(input.lifecycleCommand || lifecycle.command || input.command || 'issue')
    .toLowerCase()
    .replaceAll('_', '-');
  return LIFECYCLE_COMMANDS.has(raw) ? raw : 'issue';
}

function compareTimestampToNow(timestamp, now) {
  if (!timestamp) {
    return 0;
  }

  return Date.parse(timestamp) - Date.parse(now);
}

function buildLifecycleSchedulerDecision({ command, settings, issuerHealth, now }) {
  const schedule = settings.schedule;
  const schedulerCommand = SCHEDULER_EXECUTION_COMMANDS.has(command);
  const deferredUntilCandidates = [
    schedule.disabledUntil,
    schedule.notBefore,
    schedule.nextRunAt
  ].filter((timestamp) => compareTimestampToNow(timestamp, now) > 0);
  const deferredUntil = deferredUntilCandidates
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null;
  const windowExpired = Boolean(schedule.notAfter && compareTimestampToNow(schedule.notAfter, now) <= 0);
  const temporarilyDisabled = Boolean(schedule.disabledUntil && compareTimestampToNow(schedule.disabledUntil, now) > 0);
  const dueNow = schedule.runImmediately
    || !schedule.nextRunAt
    || compareTimestampToNow(schedule.nextRunAt, now) <= 0;
  const blocked = Boolean(settings.errors.length || temporarilyDisabled || windowExpired || issuerHealth.mode === 'blocked');
  const state = blocked
    ? temporarilyDisabled
      ? 'temporarily_disabled'
      : windowExpired
        ? 'window_expired'
        : 'blocked'
    : !schedulerCommand
      ? 'manual_command'
      : deferredUntil
        ? 'deferred'
        : dueNow
          ? 'due'
          : 'scheduled';
  const requiredAction = state === 'temporarily_disabled'
    ? 'wait_for_lifecycle_enable_window'
    : state === 'window_expired'
      ? 'reschedule_lifecycle_window'
      : state === 'blocked'
        ? 'resolve_lifecycle_blockers'
        : state === 'manual_command'
          ? `apply_${command.replaceAll('-', '_')}_command`
          : state === 'deferred'
            ? 'defer_lifecycle_dispatch'
            : command === 'rotate' || settings.autoRotate
              ? 'dispatch_token_rotation'
              : settings.autoRenew
                ? 'dispatch_token_renewal'
                : 'dispatch_token_issue';

  return {
    state,
    dueNow: state === 'due',
    dispatchable: state === 'due' && schedulerCommand,
    temporarilyDisabled,
    deferredUntil,
    window: {
      notBefore: schedule.notBefore,
      notAfter: schedule.notAfter,
      expired: windowExpired
    },
    requiredAction
  };
}

function commandEffectFor(command) {
  return LIFECYCLE_COMMAND_EFFECTS[command] || LIFECYCLE_COMMAND_EFFECTS.issue;
}

function normalizeLifecycleCommandList(value) {
  const rawCommands = normalizeStringList(value).map((command) => command.toLowerCase().replaceAll('_', '-'));
  return {
    commands: rawCommands.filter((command) => LIFECYCLE_COMMANDS.has(command)),
    unknownCommands: rawCommands.filter((command) => !LIFECYCLE_COMMANDS.has(command))
  };
}

function normalizeActiveTokenReference(record, index) {
  if (!record || typeof record !== 'object') {
    const tokenId = asNonEmptyString(record);
    return tokenId ? { tokenId, proofDigest: null, state: 'active', source: `active-token-${index + 1}` } : null;
  }

  const tokenId = firstNonEmptyString(record.tokenId, record.id, record.token?.id);
  const proofDigest = firstNonEmptyString(record.proofDigest, record.proof?.digest, record.auditProof);
  if (!tokenId && !proofDigest) {
    return null;
  }

  const state = asNonEmptyString(record.state || record.status || 'active').toLowerCase();
  return {
    tokenId: tokenId || null,
    proofDigest: proofDigest || null,
    state: ['active', 'issued', 'pending-rotation'].includes(state) ? 'active' : state,
    expiresAt: normalizeOperationalTimestamp(record.expiresAt || record.token?.expiresAt),
    source: asNonEmptyString(record.source || record.registry || record.provider) || `active-token-${index + 1}`
  };
}

function normalizeActiveTokenInventory(settings = {}, input = {}, now) {
  const rawTokens = Array.isArray(settings.activeTokens)
    ? settings.activeTokens
    : Array.isArray(input.activeTokens)
      ? input.activeTokens
      : Array.isArray(input.capabilityTokens)
        ? input.capabilityTokens
        : [];
  const references = rawTokens
    .map((record, index) => normalizeActiveTokenReference(record, index))
    .filter(Boolean)
    .filter((record) => record.state === 'active' && (!record.expiresAt || Date.parse(record.expiresAt) > Date.parse(now)));
  const explicitCount = normalizeNonNegativeIntegerSetting(
    settings.activeTokenCount ?? settings.currentActiveTokens ?? input.activeTokenCount,
    references.length
  );

  return {
    count: Math.max(explicitCount, references.length),
    references,
    source: references.length ? 'registry' : explicitCount ? 'reported-count' : 'none'
  };
}

function buildLifecycleCapacityDecision({ command, settings, now }) {
  const capacityIssuanceCommand = ['issue', 'enable', 'resume-renewal'].includes(command);
  const rotationCommand = command === 'rotate';
  const activeTokenCount = settings.activeTokens.count;
  const remainingSlots = Math.max(0, settings.maxActiveTokens - activeTokenCount);
  const atCapacity = activeTokenCount >= settings.maxActiveTokens;
  const pressure = settings.maxActiveTokens > 1 && remainingSlots <= 1;
  const denials = [];
  const warnings = [];

  if (capacityIssuanceCommand && atCapacity) {
    denials.push({
      code: 'lifecycle_active_token_capacity_exceeded',
      command,
      activeTokenCount,
      maxActiveTokens: settings.maxActiveTokens,
      message: 'Lifecycle issuance would exceed the configured active capability token limit.'
    });
  }

  if (rotationCommand && atCapacity && !settings.rotationConsumesCurrentToken) {
    warnings.push({
      code: 'rotation_requires_revocation_checkpoint',
      command,
      activeTokenCount,
      maxActiveTokens: settings.maxActiveTokens,
      message: 'Token rotation is at active-token capacity and should checkpoint revocation of the current token before dispatch.'
    });
  } else if ((capacityIssuanceCommand || rotationCommand) && pressure) {
    warnings.push({
      code: 'lifecycle_active_token_capacity_pressure',
      command,
      activeTokenCount,
      maxActiveTokens: settings.maxActiveTokens,
      remainingSlots,
      message: 'Lifecycle issuance is close to the active capability token limit.'
    });
  }

  return {
    contractVersion: 'capability-token.lifecycle-capacity.v1',
    state: denials.length ? 'blocked' : warnings.length ? 'pressure' : 'available',
    activeTokenCount,
    maxActiveTokens: settings.maxActiveTokens,
    remainingSlots,
    atCapacity,
    source: settings.activeTokens.source,
    activeTokenRefs: settings.activeTokens.references.map((record) => ({
      tokenId: record.tokenId,
      proofDigest: record.proofDigest,
      expiresAt: record.expiresAt,
      source: record.source
    })),
    generatedAt: now,
    denials,
    warnings
  };
}

function buildLifecycleCommandPlan({ command, settings, schedulerDecision, issuerHealth, now }) {
  const effect = commandEffectFor(command);
  const denials = [];
  const warnings = [];
  const commandWritesSettings = effect.settingsMutation !== 'none';
  const commandWritesToken = effect.tokenMutation !== 'none';
  const effectiveSettings = {
    enabled: command === 'enable'
      ? true
      : command === 'disable' || command === 'revoke'
        ? false
        : settings.enabled,
    autoRenew: command === 'resume-renewal'
      ? true
      : command === 'pause-renewal'
        ? false
        : settings.autoRenew,
    autoRotate: settings.autoRotate,
    disabledUntil: command === 'enable' ? null : settings.schedule.disabledUntil,
    nextRunAt: command === 'disable' || command === 'revoke' ? null : settings.schedule.nextRunAt
  };

  if (settings.mode === 'disabled' && ['issue', 'enable', 'resume-renewal', 'rotate'].includes(command)) {
    denials.push({
      code: 'lifecycle_mode_disabled',
      command,
      message: 'Lifecycle mode is disabled and cannot execute token-issuing commands.'
    });
  }

  if (command === 'resume-renewal' && !settings.enabled) {
    denials.push({
      code: 'renewal_resume_requires_enabled_lifecycle',
      command,
      message: 'Auto-renewal can resume only after the capability token lifecycle is enabled.'
    });
  }

  if (command === 'pause-renewal' && !settings.autoRenew) {
    warnings.push({
      code: 'renewal_already_paused',
      command,
      message: 'Auto-renewal is already disabled; pause command is idempotent.'
    });
  }

  if (command === 'enable' && settings.enabled && !settings.schedule.disabledUntil) {
    warnings.push({
      code: 'lifecycle_already_enabled',
      command,
      message: 'Lifecycle is already enabled and has no active disabledUntil window.'
    });
  }

  if (command === 'rotate' && issuerHealth.mode === 'degraded' && !settings.allowDegradedIssue) {
    denials.push({
      code: 'rotation_requires_healthy_issuer',
      command,
      message: 'Token rotation requires healthy issuer dependencies when degraded issue is disabled.'
    });
  }

  if (settings.schedule.allowedCommands.length && !settings.schedule.allowedCommands.includes(command)) {
    denials.push({
      code: 'lifecycle_command_not_allowed_by_schedule',
      command,
      allowedCommands: settings.schedule.allowedCommands,
      message: 'Lifecycle command is not present in the configured lifecycle schedule allowlist.'
    });
  }

  if (settings.schedule.disabledCommands.includes(command)) {
    denials.push({
      code: 'lifecycle_command_disabled_by_schedule',
      command,
      disabledCommands: settings.schedule.disabledCommands,
      message: 'Lifecycle command is disabled by lifecycle schedule controls.'
    });
  }

  const nextActionState = denials.length
    ? 'blocked'
    : command === 'disable' || command === 'revoke'
      ? 'commit_terminal_lifecycle_change'
      : commandWritesSettings && !commandWritesToken
        ? 'commit_settings_change'
        : schedulerDecision.dispatchable
          ? 'dispatch_scheduled_command'
          : schedulerDecision.state === 'deferred'
            ? 'wait_for_schedule_window'
            : commandWritesToken
              ? 'prepare_token_mutation'
              : 'record_idempotent_lifecycle_command';
  const proofPayload = {
    schema: 'capability-token.lifecycle-command-plan.v1',
    surfaceId,
    command,
    effect,
    effectiveSettings,
    schedulerState: schedulerDecision.state,
    issuerHealthMode: issuerHealth.mode,
    denialCodes: denials.map((denial) => denial.code),
    warningCodes: warnings.map((warning) => warning.code),
    nextActionState,
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.lifecycle-command-plan.v1',
    command,
    effect,
    commandWritesSettings,
    commandWritesToken,
    effectiveSettings,
    nextActionState,
    denials,
    warnings,
    checkpoint: {
      intent: effect.checkpointIntent,
      required: commandWritesSettings || commandWritesToken || command === 'revoke',
      terminal: command === 'disable' || command === 'revoke'
    },
    audit: {
      stream: 'aios.kernel.capability-token.lifecycle-command',
      action: effect.tokenMutation,
      state: nextActionState,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeLifecycleSettings(input = {}, ttlSeconds, now) {
  const settings = input.lifecycleSettings || input.capabilityTokenSettings || input.settings?.capabilityToken || {};
  const mode = asNonEmptyString(settings.mode || input.lifecycleMode || 'enforced').toLowerCase();
  const schedule = settings.schedule || input.schedule || {};
  const allowedCommandPolicy = normalizeLifecycleCommandList(schedule.allowedCommands || settings.allowedCommands);
  const disabledCommandPolicy = normalizeLifecycleCommandList(schedule.disabledCommands || settings.disabledCommands);
  const enabled = normalizeBooleanSetting(settings.enabled ?? input.enabled, mode === 'disabled' ? false : true);
  const autoRenew = normalizeBooleanSetting(settings.autoRenew ?? settings.renewal?.enabled, false);
  const autoRotate = normalizeBooleanSetting(settings.autoRotate ?? settings.rotation?.enabled, false);
  const renewBeforeSeconds = normalizePositiveIntegerSetting(
    settings.renewBeforeSeconds ?? settings.renewal?.beforeSeconds,
    Math.min(300, Math.max(MIN_RENEW_BEFORE_SECONDS, Math.floor(ttlSeconds / 3)))
  );
  const rotationIntervalSeconds = normalizePositiveIntegerSetting(
    settings.rotationIntervalSeconds ?? settings.rotation?.intervalSeconds,
    Math.min(MAX_ROTATION_INTERVAL_SECONDS, Math.max(ttlSeconds, 3600))
  );
  const maxActiveTokens = normalizePositiveIntegerSetting(settings.maxActiveTokens, 5);
  const activeTokens = normalizeActiveTokenInventory(settings, input, now);
  const nextRunAt = normalizeTimestampSetting(schedule.nextRunAt || settings.nextRunAt);
  const disabledUntil = normalizeTimestampSetting(
    schedule.disabledUntil || settings.disabledUntil || settings.disable?.until
  );
  const notBefore = normalizeTimestampSetting(
    schedule.notBefore || schedule.startAt || settings.notBefore || settings.startAt
  );
  const notAfter = normalizeTimestampSetting(
    schedule.notAfter || schedule.endAt || settings.notAfter || settings.endAt
  );
  const errors = [];
  const warnings = [];

  if (!LIFECYCLE_MODES.has(mode)) {
    errors.push({
      code: 'invalid_lifecycle_mode',
      mode,
      message: 'Lifecycle mode must be enforced, audit, or disabled.'
    });
  }

  for (const command of allowedCommandPolicy.unknownCommands) {
    errors.push({
      code: 'invalid_lifecycle_allowed_command',
      command,
      message: 'Lifecycle schedule allowedCommands contains an unknown command.'
    });
  }

  for (const command of disabledCommandPolicy.unknownCommands) {
    errors.push({
      code: 'invalid_lifecycle_disabled_command',
      command,
      message: 'Lifecycle schedule disabledCommands contains an unknown command.'
    });
  }

  for (const command of allowedCommandPolicy.commands) {
    if (disabledCommandPolicy.commands.includes(command)) {
      errors.push({
        code: 'conflicting_lifecycle_command_policy',
        command,
        message: 'Lifecycle command cannot be both allowed and disabled by schedule controls.'
      });
    }
  }

  if (autoRenew && renewBeforeSeconds < MIN_RENEW_BEFORE_SECONDS) {
    errors.push({
      code: 'renew_before_too_short',
      renewBeforeSeconds,
      minRenewBeforeSeconds: MIN_RENEW_BEFORE_SECONDS,
      message: 'Auto-renewal lead time is shorter than the hosted-kernel minimum.'
    });
  }

  if (autoRenew && renewBeforeSeconds >= ttlSeconds) {
    errors.push({
      code: 'renew_before_exceeds_ttl',
      renewBeforeSeconds,
      ttlSeconds,
      message: 'Auto-renewal lead time must be lower than the capability token TTL.'
    });
  }

  if (autoRotate && rotationIntervalSeconds > MAX_ROTATION_INTERVAL_SECONDS) {
    errors.push({
      code: 'rotation_interval_too_long',
      rotationIntervalSeconds,
      maxRotationIntervalSeconds: MAX_ROTATION_INTERVAL_SECONDS,
      message: 'Rotation interval exceeds the hosted-kernel maximum.'
    });
  }

  if (activeTokens.count > maxActiveTokens) {
    errors.push({
      code: 'active_token_count_exceeds_limit',
      activeTokenCount: activeTokens.count,
      maxActiveTokens,
      message: 'Current active capability token count exceeds the configured lifecycle limit.'
    });
  }

  if (autoRenew && autoRotate && rotationIntervalSeconds <= renewBeforeSeconds) {
    warnings.push({
      code: 'rotation_interval_overlaps_renewal_window',
      rotationIntervalSeconds,
      renewBeforeSeconds,
      message: 'Auto-rotation interval overlaps the renewal lead time and may dispatch before renewal can settle.'
    });
  }

  if (!nextRunAt.valid) {
    errors.push({
      code: 'invalid_lifecycle_schedule',
      nextRunAt: nextRunAt.raw,
      message: 'Lifecycle schedule nextRunAt must be a valid timestamp.'
    });
  } else if (nextRunAt.iso && Date.parse(nextRunAt.iso) <= Date.parse(now)) {
    warnings.push({
      code: 'lifecycle_schedule_due',
      nextRunAt: nextRunAt.iso,
      message: 'Lifecycle schedule is due now and should be dispatched by the hosted kernel.'
    });
  }

  for (const [code, timestamp] of [
    ['invalid_lifecycle_disabled_until', disabledUntil],
    ['invalid_lifecycle_not_before', notBefore],
    ['invalid_lifecycle_not_after', notAfter]
  ]) {
    if (!timestamp.valid) {
      errors.push({
        code,
        value: timestamp.raw,
        message: 'Lifecycle schedule window timestamps must be valid timestamps.'
      });
    }
  }

  if (notBefore.iso && notAfter.iso && Date.parse(notAfter.iso) <= Date.parse(notBefore.iso)) {
    errors.push({
      code: 'invalid_lifecycle_schedule_window',
      notBefore: notBefore.iso,
      notAfter: notAfter.iso,
      message: 'Lifecycle schedule notAfter must be later than notBefore.'
    });
  }

  if (disabledUntil.iso && Date.parse(disabledUntil.iso) > Date.parse(now)) {
    warnings.push({
      code: 'lifecycle_temporarily_disabled',
      disabledUntil: disabledUntil.iso,
      message: 'Capability token lifecycle commands are temporarily disabled until the configured timestamp.'
    });
  }

  if (notBefore.iso && Date.parse(notBefore.iso) > Date.parse(now)) {
    warnings.push({
      code: 'lifecycle_window_not_open',
      notBefore: notBefore.iso,
      message: 'Lifecycle dispatch is waiting for the configured execution window to open.'
    });
  }

  if (notAfter.iso && Date.parse(notAfter.iso) <= Date.parse(now)) {
    errors.push({
      code: 'lifecycle_window_closed',
      notAfter: notAfter.iso,
      message: 'Lifecycle dispatch window is closed and must be rescheduled.'
    });
  }

  return {
    mode: LIFECYCLE_MODES.has(mode) ? mode : 'enforced',
    enabled,
    autoRenew,
    autoRotate,
    allowDegradedIssue: normalizeBooleanSetting(settings.allowDegradedIssue, true),
    rotationConsumesCurrentToken: normalizeBooleanSetting(settings.rotationConsumesCurrentToken, true),
    renewBeforeSeconds,
    rotationIntervalSeconds,
    maxActiveTokens,
    activeTokens,
    schedule: {
      nextRunAt: nextRunAt.iso,
      cadence: asNonEmptyString(schedule.cadence || settings.cadence) || null,
      disabledUntil: disabledUntil.iso,
      notBefore: notBefore.iso,
      notAfter: notAfter.iso,
      runImmediately: normalizeBooleanSetting(schedule.runImmediately ?? settings.runImmediately, false),
      allowedCommands: allowedCommandPolicy.commands,
      disabledCommands: disabledCommandPolicy.commands
    },
    errors,
    warnings
  };
}

function buildLifecycleControls({ input, ttlSeconds, now, issuerHealth }) {
  const command = normalizeLifecycleCommand(input);
  const settings = normalizeLifecycleSettings(input, ttlSeconds, now);
  const denials = [];
  const warnings = [...settings.warnings];
  const issuanceCommand = command === 'issue' || command === 'enable' || command === 'resume-renewal' || command === 'rotate';
  const schedulerDecision = buildLifecycleSchedulerDecision({ command, settings, issuerHealth, now });
  const commandPlan = buildLifecycleCommandPlan({ command, settings, schedulerDecision, issuerHealth, now });
  const capacityDecision = buildLifecycleCapacityDecision({ command, settings, now });

  warnings.push(...commandPlan.warnings);
  warnings.push(...capacityDecision.warnings);
  denials.push(...commandPlan.denials);
  denials.push(...capacityDecision.denials);

  if (!settings.enabled && issuanceCommand) {
    denials.push({
      code: 'capability_token_lifecycle_disabled',
      command,
      message: 'Capability token issuance is disabled by lifecycle settings.'
    });
  }

  if (!settings.allowDegradedIssue && issuerHealth.mode === 'degraded' && issuanceCommand) {
    denials.push({
      code: 'degraded_issue_disabled',
      command,
      message: 'Lifecycle settings require healthy issuer dependencies before issuing a token.'
    });
  }

  if (command === 'disable' || command === 'revoke') {
    denials.push({
      code: `lifecycle_${command}_requested`,
      command,
      message: `Lifecycle command ${command} prevents issuing a new capability token.`
    });
  }

  if (schedulerDecision.temporarilyDisabled && issuanceCommand) {
    denials.push({
      code: 'capability_token_temporarily_disabled',
      command,
      disabledUntil: settings.schedule.disabledUntil,
      message: 'Capability token issuance is temporarily disabled by the lifecycle schedule.'
    });
  }

  if (schedulerDecision.state === 'deferred' && issuanceCommand) {
    denials.push({
      code: 'lifecycle_dispatch_deferred',
      command,
      deferredUntil: schedulerDecision.deferredUntil,
      message: 'Capability token issuance is deferred until the configured lifecycle schedule is due.'
    });
  }

  const state = settings.errors.length || denials.length
    ? 'blocked'
    : warnings.length
      ? 'scheduled_attention'
      : command === 'rotate'
        ? 'rotation_requested'
        : 'ready';
  const nextAction = state === 'blocked'
    ? 'review_lifecycle_settings'
    : command === 'disable'
      ? 'disable_capability_token'
      : command === 'revoke'
        ? 'revoke_capability_token'
        : command === 'rotate' || settings.autoRotate
          ? 'schedule_token_rotation'
          : settings.autoRenew
            ? 'schedule_token_renewal'
            : 'issue_capability_token';
  const proofPayload = {
    schema: 'capability-token.lifecycle-controls.v1',
    surfaceId,
    command,
    state,
    settings: {
      mode: settings.mode,
      enabled: settings.enabled,
      autoRenew: settings.autoRenew,
      autoRotate: settings.autoRotate,
      allowDegradedIssue: settings.allowDegradedIssue,
      renewBeforeSeconds: settings.renewBeforeSeconds,
      rotationIntervalSeconds: settings.rotationIntervalSeconds,
      maxActiveTokens: settings.maxActiveTokens,
      activeTokenCount: settings.activeTokens.count,
      activeTokenSource: settings.activeTokens.source,
      schedule: settings.schedule,
      schedulerDecision,
      commandPlanDigest: commandPlan.proof.digest,
      capacityState: capacityDecision.state,
      capacityRemainingSlots: capacityDecision.remainingSlots
    },
    commandEffect: commandPlan.effect,
    nextActionState: commandPlan.nextActionState,
    denialCodes: denials.map((denial) => denial.code),
    warningCodes: warnings.map((warning) => warning.code),
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.lifecycle-controls.v1',
    command,
    state,
    settings,
    commandPlan,
    capacity: capacityDecision,
    canIssue: !settings.errors.length && !denials.length && issuanceCommand,
    scheduling: {
      enabled: settings.autoRenew
        || settings.autoRotate
        || settings.schedule.runImmediately
        || Boolean(settings.schedule.nextRunAt)
        || Boolean(settings.schedule.disabledUntil)
        || Boolean(settings.schedule.notBefore)
        || Boolean(settings.schedule.notAfter),
      nextRunAt: settings.schedule.nextRunAt,
      cadence: settings.schedule.cadence,
      disabledUntil: settings.schedule.disabledUntil,
      notBefore: settings.schedule.notBefore,
      notAfter: settings.schedule.notAfter,
      runImmediately: settings.schedule.runImmediately,
      schedulerState: schedulerDecision.state,
      dispatchable: schedulerDecision.dispatchable && !denials.length,
      deferredUntil: schedulerDecision.deferredUntil,
      window: schedulerDecision.window,
      nextAction,
      requiredAction: schedulerDecision.requiredAction,
      commandEffect: commandPlan.effect.scheduleMutation,
      commandNextActionState: commandPlan.nextActionState,
      capacityState: capacityDecision.state,
      blockedByCapacity: capacityDecision.state === 'blocked'
    },
    nextAction: {
      state,
      action: nextAction,
      commandState: commandPlan.nextActionState,
      schedulerState: schedulerDecision.state,
      capacityState: capacityDecision.state,
      route: state === 'blocked'
        ? 'review-lifecycle-controls'
        : schedulerDecision.dispatchable && !denials.length
          ? 'dispatch-lifecycle-command'
          : schedulerDecision.deferredUntil
            ? 'wait-lifecycle-schedule'
            : 'apply-lifecycle-command',
      blockingCodes: denials.map((denial) => denial.code),
      warningCodes: warnings.map((warning) => warning.code)
    },
    denials,
    warnings,
    audit: {
      stream: 'aios.kernel.capability-token.lifecycle',
      action: nextAction,
      state,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeIssueState(value) {
  const state = asNonEmptyString(value).toLowerCase();
  return ISSUE_STATES.has(state) ? state : 'failed';
}

function incrementCounter(counters, key, amount = 1) {
  counters[key] = (counters[key] || 0) + amount;
}

function normalizeAnalyticsTimestamp(value, fallback) {
  const timestamp = asNonEmptyString(value);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) {
    return new Date(timestamp).toISOString();
  }
  return fallback;
}

function normalizeHistoryRecord(record, fallbackTimestamp, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const tenantId = asNonEmptyString(record.tenantId || record.token?.boundary?.tenantId || record.auditHandoff?.tenantId);
  const subjectId = asNonEmptyString(record.subjectId || record.token?.subjectId || record.auditHandoff?.subjectId);
  const issueState = normalizeIssueState(record.issueState || record.state || record.outcome);
  const occurredAt = normalizeAnalyticsTimestamp(record.occurredAt || record.issuedAt || record.generatedAt, fallbackTimestamp);
  const proofDigest = asNonEmptyString(record.proof?.digest || record.proofDigest || record.auditHandoff?.proof);
  const lifecycleCommand = asNonEmptyString(
    record.lifecycleCommand
      || record.lifecycle?.command
      || record.lifecycleControls?.command
      || record.auditHandoff?.lifecycle?.command
  );
  const acceptanceState = asNonEmptyString(record.acceptanceState || record.acceptance?.acceptanceState);
  const readinessState = asNonEmptyString(record.readinessState || record.readiness?.state);
  const providerHandoffState = asNonEmptyString(
    record.providerHandoffState
      || record.providerContracts?.externalHandoff?.state
      || record.providerHandoff?.state
  );
  const expiresAt = normalizeOperationalTimestamp(record.expiresAt || record.token?.expiresAt || record.expiry?.expiresAt);
  const ttlSeconds = normalizeTtlSeconds({ ttlSeconds: record.ttlSeconds });
  const expiryState = normalizeAnalyticsExpiryState(record.expiryState || record.expiry?.state, occurredAt, expiresAt);
  const delegationState = asNonEmptyString(record.delegationState || record.delegation?.state);
  const delegationDepth = normalizeAnalyticsCount(record.delegationDepth ?? record.delegation?.depth);
  const auditReferenceCount = normalizeAnalyticsCount(
    record.auditReferenceCount
      ?? record.delegation?.auditReferenceCount
      ?? record.delegation?.auditReferences?.length
  );
  const securityGuardState = asNonEmptyString(record.securityGuardState || record.securityGuard?.state);
  const revocationMatchCount = normalizeAnalyticsCount(
    record.revocationMatchCount
      ?? record.securityGuard?.revocationMatchCount
      ?? record.securityGuard?.registry?.revocationMatchCount
  );
  const replayMatchCount = normalizeAnalyticsCount(
    record.replayMatchCount
      ?? record.securityGuard?.replayMatchCount
      ?? record.securityGuard?.registry?.replayMatchCount
  );
  const workspaceIds = uniqueSorted([
    ...normalizeStringList(record.workspaceIds),
    ...normalizeStringList(record.token?.boundary?.workspaceIds),
    ...normalizeStringList(record.auditHandoff?.workspaceIds)
  ]);

  return {
    sequence: Number.isInteger(record.sequence) ? record.sequence : index,
    occurredAt,
    issueState,
    tenantId: tenantId || null,
    subjectId: subjectId || null,
    workspaceIds,
    action: asNonEmptyString(record.action || record.auditHandoff?.action) || `capability_token_${issueState}`,
    lifecycleCommand: lifecycleCommand || null,
    acceptanceState: acceptanceState || null,
    readinessState: readinessState || null,
    providerHandoffState: providerHandoffState || null,
    proofDigest: proofDigest || null,
    ttlSeconds,
    expiresAt,
    expiryState,
    delegationState: delegationState || null,
    delegationDepth,
    auditReferenceCount,
    securityGuardState: securityGuardState || null,
    revocationMatchCount,
    replayMatchCount,
    degraded: issueState === 'issued_degraded'
  };
}

function currentContractHistoryRecord(contract) {
  return {
    sequence: 0,
    occurredAt: contract.issuedAt,
    issuedAt: contract.issuedAt,
    issueState: contract.issueState,
    tenantId: contract.token.boundary.tenantId,
    subjectId: contract.token.subjectId,
    workspaceIds: contract.token.boundary.workspaceIds,
    action: contract.auditHandoff.action,
    lifecycleCommand: contract.lifecycleControls.command,
    acceptanceState: contract.acceptance.acceptanceState,
    readinessState: contract.readiness.state,
    providerHandoffState: contract.providerContracts.externalHandoff.state,
    proofDigest: contract.proof.digest,
    ttlSeconds: contract.ttlSeconds,
    expiresAt: contract.token.expiresAt,
    delegationState: contract.delegation.state,
    delegationDepth: contract.delegation.depth,
    auditReferenceCount: contract.delegation.auditReferences.length,
    securityGuardState: contract.securityGuard.state,
    revocationMatchCount: contract.securityGuard.registry.revocationMatchCount,
    replayMatchCount: contract.securityGuard.registry.replayMatchCount
  };
}

function normalizeAnalyticsCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeAnalyticsExpiryState(value, occurredAt, expiresAt) {
  const explicit = asNonEmptyString(value).toLowerCase().replaceAll('-', '_');
  if (['active', 'expires_soon', 'expired', 'unknown'].includes(explicit)) {
    return explicit;
  }

  if (!expiresAt) {
    return 'unknown';
  }

  const secondsUntilExpiry = Math.floor((Date.parse(expiresAt) - Date.parse(occurredAt)) / 1000);
  if (!Number.isFinite(secondsUntilExpiry) || secondsUntilExpiry <= 0) {
    return 'expired';
  }

  return secondsUntilExpiry <= MIN_RENEW_BEFORE_SECONDS ? 'expires_soon' : 'active';
}

function normalizeCapabilityTokenHistory(input, contract) {
  const supplied = [
    ...(
      Array.isArray(input.analyticsHistory)
        ? input.analyticsHistory
        : Array.isArray(input.history)
          ? input.history
          : Array.isArray(input.snapshots)
            ? input.snapshots
            : []
    ),
    ...(input.includeCurrentSnapshot === false ? [] : [currentContractHistoryRecord(contract)])
  ];

  const normalized = supplied
    .map((record, index) => normalizeHistoryRecord(record, contract.issuedAt, index + 1))
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.sequence - right.sequence);

  return {
    history: normalized
      .slice(-ANALYTICS_HISTORY_LIMIT)
      .map((record, index) => ({ ...record, sequence: index + 1 })),
    sourceCount: normalized.length,
    truncated: normalized.length > ANALYTICS_HISTORY_LIMIT
  };
}

function buildTimelineBuckets(history) {
  const bucketMap = new Map();
  for (const record of history) {
    const bucket = record.occurredAt.slice(0, 10);
    const counters = bucketMap.get(bucket) || {
      issued: 0,
      issued_degraded: 0,
      denied: 0,
      failed: 0,
      total: 0,
      blocked: 0,
      providerSyncRequired: 0,
      degraded: 0,
      delegated: 0,
      expiring: 0,
      securityBlocked: 0
    };
    incrementCounter(counters, record.issueState);
    incrementCounter(counters, 'total');
    if (record.issueState === 'failed' || record.issueState === 'denied' || record.acceptanceState === 'accept_blocked') {
      incrementCounter(counters, 'blocked');
    }
    if (record.providerHandoffState === 'sync_required') {
      incrementCounter(counters, 'providerSyncRequired');
    }
    if (record.degraded) {
      incrementCounter(counters, 'degraded');
    }
    if (record.delegationState === 'delegated') {
      incrementCounter(counters, 'delegated');
    }
    if (record.expiryState === 'expires_soon' || record.expiryState === 'expired') {
      incrementCounter(counters, 'expiring');
    }
    if (record.securityGuardState === 'blocked' || record.revocationMatchCount || record.replayMatchCount) {
      incrementCounter(counters, 'securityBlocked');
    }
    bucketMap.set(bucket, counters);
  }

  return [...bucketMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-ANALYTICS_TIMELINE_BUCKET_LIMIT)
    .map(([date, counters]) => ({ date, counters }));
}

function incrementDimensionCounter(counters, value, fallback = 'unreported') {
  incrementCounter(counters, asNonEmptyString(value) || fallback);
}

function analyticsReportState({
  counters,
  acceptanceStates,
  providerHandoffStates,
  lifecycleCommands,
  expiryStates,
  delegationStates,
  securityGuardStates,
  revocationMatchTotal,
  replayMatchTotal
}) {
  if (securityGuardStates.blocked || revocationMatchTotal || replayMatchTotal) {
    return {
      state: 'security_guard_events_present',
      severity: 'critical',
      reason: 'revocation_or_replay_matches_present',
      requiredAction: 'review_capability_token_security_guard_matches'
    };
  }

  if (counters.failed) {
    return {
      state: 'attention_required',
      severity: 'critical',
      reason: 'failed_capability_token_events_present',
      requiredAction: 'review_failed_capability_token_issues'
    };
  }

  if (counters.denied || acceptanceStates.accept_blocked) {
    return {
      state: 'blocked_events_present',
      severity: 'warning',
      reason: 'denied_or_accept_blocked_events_present',
      requiredAction: 'review_boundary_permission_or_lifecycle_denials'
    };
  }

  if (providerHandoffStates.sync_required) {
    return {
      state: 'provider_sync_backlog',
      severity: 'warning',
      reason: 'provider_handoff_sync_required_events_present',
      requiredAction: 'refresh_provider_sync_before_external_dispatch'
    };
  }

  if (expiryStates.expired || expiryStates.expires_soon) {
    return {
      state: expiryStates.expired ? 'expired_token_events_present' : 'token_expiry_pressure',
      severity: expiryStates.expired ? 'warning' : 'notice',
      reason: expiryStates.expired ? 'expired_token_snapshots_present' : 'soon_expiring_token_snapshots_present',
      requiredAction: expiryStates.expired ? 'review_lifecycle_renewal_or_revocation' : 'schedule_token_renewal'
    };
  }

  if (counters.issued_degraded) {
    return {
      state: 'degraded_issuance_observed',
      severity: 'notice',
      reason: 'degraded_issuance_events_present',
      requiredAction: 'monitor_issuer_dependency_recovery'
    };
  }

  return {
    state: lifecycleCommands.revoke || lifecycleCommands.disable
      ? 'lifecycle_terminal_events_present'
      : delegationStates.delegated
        ? 'delegation_activity_observed'
        : 'clear',
    severity: lifecycleCommands.revoke || lifecycleCommands.disable || delegationStates.delegated ? 'notice' : 'normal',
    reason: lifecycleCommands.revoke || lifecycleCommands.disable
      ? 'terminal_lifecycle_commands_observed'
      : delegationStates.delegated
        ? 'delegated_capability_token_snapshots_present'
        : 'no_blocking_analytics_signals',
    requiredAction: 'none'
  };
}

function buildAnalyticsExportManifest({ exportRows, counters, timeline, report }) {
  const firstRowAt = exportRows[0]?.occurredAt || null;
  const lastRowAt = exportRows.at(-1)?.occurredAt || null;
  const rowDigest = hashProof({
    schema: 'capability-token.analytics-export-rows.v1',
    columns: ANALYTICS_EXPORT_COLUMNS,
    rows: exportRows.map((row) => ANALYTICS_EXPORT_COLUMNS.map((column) => row[column] ?? null))
  });

  return {
    schema: 'capability-token.analytics-export-manifest.v1',
    format: 'json-lines',
    columns: ANALYTICS_EXPORT_COLUMNS,
    rowCount: exportRows.length,
    firstRowAt,
    lastRowAt,
    issueStateCounters: counters,
    timelineBucketCount: timeline.length,
    reportState: report.state,
    reportSeverity: report.severity,
    rowDigest
  };
}

function buildCapabilityTokenAnalytics(contract, input = {}) {
  const historyState = normalizeCapabilityTokenHistory(input, contract);
  const { history } = historyState;
  const counters = { issued: 0, issued_degraded: 0, denied: 0, failed: 0, total: 0 };
  const tenants = {};
  const workspaces = {};
  const lifecycleCommands = {};
  const acceptanceStates = {};
  const readinessStates = {};
  const providerHandoffStates = {};
  const expiryStates = {};
  const delegationStates = {};
  const securityGuardStates = {};
  const securityGuardCounters = {
    revocationMatchTotal: 0,
    replayMatchTotal: 0,
    auditReferenceTotal: 0,
    maxDelegationDepth: 0,
    expiringOrExpired: 0
  };

  for (const record of history) {
    incrementCounter(counters, record.issueState);
    incrementCounter(counters, 'total');
    incrementDimensionCounter(lifecycleCommands, record.lifecycleCommand);
    incrementDimensionCounter(acceptanceStates, record.acceptanceState);
    incrementDimensionCounter(readinessStates, record.readinessState);
    incrementDimensionCounter(providerHandoffStates, record.providerHandoffState);
    incrementDimensionCounter(expiryStates, record.expiryState);
    incrementDimensionCounter(delegationStates, record.delegationState);
    incrementDimensionCounter(securityGuardStates, record.securityGuardState);
    securityGuardCounters.revocationMatchTotal += record.revocationMatchCount;
    securityGuardCounters.replayMatchTotal += record.replayMatchCount;
    securityGuardCounters.auditReferenceTotal += record.auditReferenceCount;
    securityGuardCounters.maxDelegationDepth = Math.max(
      securityGuardCounters.maxDelegationDepth,
      record.delegationDepth
    );
    if (record.expiryState === 'expires_soon' || record.expiryState === 'expired') {
      securityGuardCounters.expiringOrExpired += 1;
    }

    if (record.tenantId) {
      incrementCounter(tenants, record.tenantId);
    }

    for (const workspaceId of record.workspaceIds) {
      incrementCounter(workspaces, workspaceId);
    }
  }

  const snapshots = history.map((record) => ({
    sequence: record.sequence,
    occurredAt: record.occurredAt,
    issueState: record.issueState,
    tenantId: record.tenantId,
    workspaceCount: record.workspaceIds.length,
    lifecycleCommand: record.lifecycleCommand,
    acceptanceState: record.acceptanceState,
    providerHandoffState: record.providerHandoffState,
    proofDigest: record.proofDigest,
    expiryState: record.expiryState,
    expiresAt: record.expiresAt,
    delegationState: record.delegationState,
    delegationDepth: record.delegationDepth,
    auditReferenceCount: record.auditReferenceCount,
    securityGuardState: record.securityGuardState,
    revocationMatchCount: record.revocationMatchCount,
    replayMatchCount: record.replayMatchCount
  }));
  const latestSnapshot = snapshots.at(-1) || null;
  const exportRows = history.map((record) => ({
    occurredAt: record.occurredAt,
    issueState: record.issueState,
    tenantId: record.tenantId,
    subjectId: record.subjectId,
    workspaceIds: record.workspaceIds,
    action: record.action,
    lifecycleCommand: record.lifecycleCommand,
    acceptanceState: record.acceptanceState,
    readinessState: record.readinessState,
    providerHandoffState: record.providerHandoffState,
    proofDigest: record.proofDigest,
    ttlSeconds: record.ttlSeconds,
    expiresAt: record.expiresAt,
    expiryState: record.expiryState,
    delegationState: record.delegationState,
    delegationDepth: record.delegationDepth,
    auditReferenceCount: record.auditReferenceCount,
    securityGuardState: record.securityGuardState,
    revocationMatchCount: record.revocationMatchCount,
    replayMatchCount: record.replayMatchCount
  }));
  const timeline = buildTimelineBuckets(history);
  const report = analyticsReportState({
    counters,
    acceptanceStates,
    providerHandoffStates,
    lifecycleCommands,
    expiryStates,
    delegationStates,
    securityGuardStates,
    revocationMatchTotal: securityGuardCounters.revocationMatchTotal,
    replayMatchTotal: securityGuardCounters.replayMatchTotal
  });
  const exportManifest = buildAnalyticsExportManifest({ exportRows, counters, timeline, report });
  const exportSummary = {
    schema: 'capability-token.analytics-export.v1',
    surfaceId,
    generatedAt: contract.issuedAt,
    rowCount: exportRows.length,
    columns: ANALYTICS_EXPORT_COLUMNS,
    counters,
    dimensionCounters: {
      lifecycleCommands,
      acceptanceStates,
      readinessStates,
      providerHandoffStates,
      expiryStates,
      delegationStates,
      securityGuardStates
    },
    securityGuardCounters,
    tenantCounts: tenants,
    workspaceCounts: workspaces,
    manifest: exportManifest,
    rows: exportRows
  };
  const proofPayload = {
    schema: exportSummary.schema,
    surfaceId,
    generatedAt: exportSummary.generatedAt,
    counters,
    dimensionCounters: exportSummary.dimensionCounters,
    securityGuardCounters,
    latestSnapshot,
    timeline,
    report
  };

  return {
    contractVersion: 'capability-token.analytics.v1',
    retention: {
      maxSnapshots: ANALYTICS_HISTORY_LIMIT,
      timelineBuckets: ANALYTICS_TIMELINE_BUCKET_LIMIT,
      sourceSnapshots: historyState.sourceCount,
      truncated: historyState.truncated
    },
    counters,
    dimensionCounters: exportSummary.dimensionCounters,
    snapshots,
    latestSnapshot,
    timeline,
    report,
    reportState: report.state,
    exportSummary,
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeHealthState(value) {
  const state = asNonEmptyString(value).toLowerCase();
  if (HEALTHY_STATES.has(state)) {
    return 'healthy';
  }
  if (DEGRADED_STATES.has(state)) {
    return 'degraded';
  }
  if (FAILED_STATES.has(state)) {
    return 'failed';
  }
  return state ? 'unknown' : 'missing';
}

function normalizeOperationalTimestamp(value) {
  const timestamp = asNonEmptyString(value);
  return timestamp && Number.isFinite(Date.parse(timestamp))
    ? new Date(timestamp).toISOString()
    : null;
}

function normalizeFailureCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 20) : 0;
}

function normalizeLatencyMs(value) {
  const latency = Number(value);
  return Number.isFinite(latency) && latency >= 0 ? Math.min(Math.floor(latency), 60000) : 0;
}

function secondsSince(timestamp, assessedAt) {
  if (!timestamp) {
    return null;
  }

  return Math.max(0, Math.floor((Date.parse(assessedAt) - Date.parse(timestamp)) / 1000));
}

function dependencyOperationalState({ state, observedAt, latencyMs, consecutiveFailures, assessedAt }) {
  const observedAgeSeconds = secondsSince(observedAt, assessedAt);
  const stale = observedAgeSeconds !== null && observedAgeSeconds > DEPENDENCY_STALE_AFTER_SECONDS;
  const slow = latencyMs > DEPENDENCY_SLOW_AFTER_MS;
  const circuitOpen = consecutiveFailures >= DEPENDENCY_CIRCUIT_BREAKER_FAILURES;

  if (state !== 'missing' && circuitOpen) {
    return {
      state: 'failed',
      reason: 'circuit_breaker_open',
      stale,
      slow,
      circuitOpen,
      observedAgeSeconds
    };
  }

  if (state === 'healthy' && (stale || slow)) {
    return {
      state: 'degraded',
      reason: stale ? 'telemetry_stale' : 'latency_threshold_exceeded',
      stale,
      slow,
      circuitOpen,
      observedAgeSeconds
    };
  }

  return {
    state,
    reason: circuitOpen ? 'failure_threshold_reached' : state,
    stale,
    slow,
    circuitOpen,
    observedAgeSeconds
  };
}

function dependencySeverity(state) {
  if (state === 'failed' || state === 'missing') {
    return 'critical';
  }
  if (state === 'degraded' || state === 'unknown') {
    return 'warning';
  }
  if (state === 'unreported') {
    return 'observability_gap';
  }
  return 'normal';
}

function normalizeDependencyHealth(input = {}, assessedAt = normalizeIssuedAt(input.now)) {
  const dependencies = input.health?.dependencies || input.dependencies || {};
  const healthTelemetryPresent = Boolean(input.health?.dependencies || input.dependencies);
  return REQUIRED_ISSUER_DEPENDENCIES.map((name) => {
    const raw = dependencies[name] || dependencies[name.replaceAll('-', '')] || {};
    const state = normalizeHealthState(raw.state || raw.status || raw.health);
    const consecutiveFailures = normalizeFailureCount(
      raw.consecutiveFailures ?? raw.failureCount ?? raw.failures
    );
    const lastFailureAt = normalizeOperationalTimestamp(raw.lastFailureAt || raw.failedAt || raw.errorAt);
    const observedAt = normalizeOperationalTimestamp(raw.observedAt || raw.checkedAt);
    const retryAfterSeconds = normalizeRetryAfterSeconds(raw.retryAfterSeconds || raw.retryAfter);
    const latencyMs = normalizeLatencyMs(raw.latencyMs || raw.responseTimeMs || raw.durationMs);
    const operational = dependencyOperationalState({
      state,
      observedAt,
      latencyMs,
      consecutiveFailures,
      assessedAt
    });
    const normalizedState = state === 'missing' && !healthTelemetryPresent
      ? 'unreported'
      : operational.state;

    return {
      name,
      state: normalizedState,
      severity: dependencySeverity(normalizedState),
      observedAt,
      observedAgeSeconds: operational.observedAgeSeconds,
      lastFailureAt,
      consecutiveFailures,
      retryAfterSeconds,
      latencyMs,
      stale: operational.stale,
      slow: operational.slow,
      circuitOpen: operational.circuitOpen,
      operationalReason: normalizedState === 'unreported' ? 'telemetry_not_reported' : operational.reason,
      recoveryAction: DEPENDENCY_RECOVERY_ACTIONS[name],
      message: asNonEmptyString(raw.message || raw.reason) || null
    };
  });
}

function normalizeRetryAfterSeconds(value) {
  const retryAfter = Number(value);
  if (!Number.isFinite(retryAfter) || retryAfter < 0) {
    return 0;
  }
  return Math.min(Math.ceil(retryAfter), 300);
}

function dependencyRetryDelay(dependency) {
  const exponentialDelay = BASE_RETRY_BACKOFF_SECONDS * (2 ** Math.min(dependency.consecutiveFailures, 5));
  return Math.min(
    MAX_RETRY_BACKOFF_SECONDS,
    Math.max(BASE_RETRY_BACKOFF_SECONDS, dependency.retryAfterSeconds, exponentialDelay)
  );
}

function buildDependencyIncident(dependency, assessedAt) {
  const retryable = dependency.severity === 'warning' && !dependency.circuitOpen;
  const retryAfterSeconds = retryable ? dependencyRetryDelay(dependency) : 0;
  const nextRetryAt = retryAfterSeconds
    ? new Date(Date.parse(assessedAt) + retryAfterSeconds * 1000).toISOString()
    : null;

  return {
    dependency: dependency.name,
    state: dependency.state,
    severity: dependency.severity,
    observedAt: dependency.observedAt,
    observedAgeSeconds: dependency.observedAgeSeconds,
    lastFailureAt: dependency.lastFailureAt,
    consecutiveFailures: dependency.consecutiveFailures,
    latencyMs: dependency.latencyMs,
    stale: dependency.stale,
    slow: dependency.slow,
    circuitOpen: dependency.circuitOpen,
    operationalReason: dependency.operationalReason,
    retryable,
    retryAfterSeconds,
    nextRetryAt,
    action: dependency.recoveryAction,
    message: dependency.message || (
      dependency.severity === 'critical'
        ? 'Required capability token issuer dependency is unavailable.'
        : 'Capability token issuer dependency requires operator attention.'
    ),
    incidentKey: hashProof({
      surfaceId,
      dependency: dependency.name,
      state: dependency.state,
      observedAt: dependency.observedAt,
      observedAgeSeconds: dependency.observedAgeSeconds,
      lastFailureAt: dependency.lastFailureAt,
      consecutiveFailures: dependency.consecutiveFailures,
      latencyMs: dependency.latencyMs,
      stale: dependency.stale,
      slow: dependency.slow,
      circuitOpen: dependency.circuitOpen,
      operationalReason: dependency.operationalReason
    }).slice(0, 20)
  };
}

function retryPolicyForFailures(failures, degraded, assessedAt) {
  if (!failures.length && !degraded.length) {
    return {
      retryable: false,
      strategy: 'none',
      retryAfterSeconds: 0,
      nextRetryAt: null,
      maxAttempts: 0,
      backoffJitter: 'none',
      attemptWindow: []
    };
  }

  const retryableDependencies = failures.length ? [] : degraded;
  const retryAfterSeconds = retryableDependencies.length
    ? Math.max(...retryableDependencies.map(dependencyRetryDelay))
    : 0;
  const attemptWindow = retryableDependencies.map((dependency) => {
    const delay = dependencyRetryDelay(dependency);
    return {
      dependency: dependency.name,
      retryAfterSeconds: delay,
      nextRetryAt: new Date(Date.parse(assessedAt) + delay * 1000).toISOString(),
      maxAttempts: MAX_RETRY_ATTEMPTS
    };
  });

  return {
    retryable: failures.length === 0,
    strategy: failures.length ? 'operator-intervention-required' : 'bounded-exponential-backoff',
    retryAfterSeconds,
    nextRetryAt: retryAfterSeconds
      ? new Date(Date.parse(assessedAt) + retryAfterSeconds * 1000).toISOString()
      : null,
    maxAttempts: failures.length ? 0 : MAX_RETRY_ATTEMPTS,
    backoffJitter: failures.length ? 'none' : 'full-jitter',
    attemptWindow
  };
}

function assessIssuerHealth(input = {}) {
  const assessedAt = normalizeIssuedAt(input.now);
  const dependencies = normalizeDependencyHealth(input, assessedAt);
  const failed = dependencies.filter((dependency) => dependency.state === 'failed' || dependency.state === 'missing');
  const degraded = dependencies.filter((dependency) => dependency.state === 'degraded' || dependency.state === 'unknown');
  const unreported = dependencies.filter((dependency) => dependency.state === 'unreported');
  const mode = failed.length ? 'blocked' : degraded.length ? 'degraded' : 'normal';
  const incidents = [...failed, ...degraded].map((dependency) => buildDependencyIncident(dependency, assessedAt));
  const staleDependencies = dependencies.filter((dependency) => dependency.stale).map((dependency) => dependency.name);
  const slowDependencies = dependencies.filter((dependency) => dependency.slow).map((dependency) => dependency.name);
  const openCircuits = dependencies.filter((dependency) => dependency.circuitOpen).map((dependency) => dependency.name);
  const retry = retryPolicyForFailures(failed, degraded, assessedAt);
  const proofPayload = {
    schema: 'capability-token.issuer-health.v1',
    surfaceId,
    assessedAt,
    mode,
    telemetry: unreported.length ? 'not-reported' : 'reported',
    dependencies: dependencies.map((dependency) => ({
      name: dependency.name,
      state: dependency.state,
      severity: dependency.severity,
      observedAt: dependency.observedAt,
      observedAgeSeconds: dependency.observedAgeSeconds,
      lastFailureAt: dependency.lastFailureAt,
      consecutiveFailures: dependency.consecutiveFailures,
      retryAfterSeconds: dependency.retryAfterSeconds,
      latencyMs: dependency.latencyMs,
      stale: dependency.stale,
      slow: dependency.slow,
      circuitOpen: dependency.circuitOpen,
      operationalReason: dependency.operationalReason
    })),
    incidentKeys: incidents.map((incident) => incident.incidentKey),
    retryStrategy: retry.strategy
  };

  return {
    contractVersion: 'capability-token.issuer-health.v1',
    ok: failed.length === 0,
    mode,
    assessedAt,
    telemetry: unreported.length ? 'not-reported' : 'reported',
    canIssueToken: failed.length === 0,
    operationalThresholds: {
      staleAfterSeconds: DEPENDENCY_STALE_AFTER_SECONDS,
      slowAfterMs: DEPENDENCY_SLOW_AFTER_MS,
      circuitBreakerFailures: DEPENDENCY_CIRCUIT_BREAKER_FAILURES
    },
    dependencies,
    failures: failed.map((dependency) => ({
      code: 'issuer_dependency_unavailable',
      dependency: dependency.name,
      state: dependency.state,
      operationalReason: dependency.operationalReason,
      message: dependency.message || 'Required capability token issuer dependency is unavailable.',
      action: dependency.circuitOpen
        ? `reset ${dependency.name} circuit breaker after dependency recovery is confirmed`
        : `restore ${dependency.name} before issuing hosted-kernel capability tokens`
    })),
    degraded: degraded.map((dependency) => ({
      code: 'issuer_dependency_degraded',
      dependency: dependency.name,
      state: dependency.state,
      operationalReason: dependency.operationalReason,
      observedAgeSeconds: dependency.observedAgeSeconds,
      latencyMs: dependency.latencyMs,
      message: dependency.message || 'Capability token issuer dependency is degraded.',
      action: dependency.stale
        ? `refresh ${dependency.name} health telemetry before relying on degraded-mode issuance`
        : dependency.slow
          ? `reduce ${dependency.name} latency or keep issuance in degraded mode with retry`
          : `issue may proceed in degraded mode; monitor ${dependency.name} and retry audit handoff if needed`
    })),
    incidents,
    operationalSignals: {
      staleDependencies,
      slowDependencies,
      openCircuits,
      attentionCount: staleDependencies.length + slowDependencies.length + openCircuits.length
    },
    recovery: {
      state: failed.length
        ? 'operator_required'
        : degraded.length
          ? 'retry_scheduled'
          : unreported.length
            ? 'telemetry_unreported'
            : 'clear',
      actionable: incidents.length > 0,
      actions: uniqueSorted([
        ...incidents.map((incident) => incident.action),
        ...staleDependencies.map((dependency) => `refresh_${dependency.replaceAll('-', '_')}_telemetry`),
        ...slowDependencies.map((dependency) => `investigate_${dependency.replaceAll('-', '_')}_latency`),
        ...openCircuits.map((dependency) => `reset_${dependency.replaceAll('-', '_')}_circuit_after_recovery`)
      ]),
      incidentCount: incidents.length
    },
    retry,
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizeProviderRecord(record, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const providerId = asNonEmptyString(record.providerId || record.id || record.name);
  if (!providerId) {
    return null;
  }

  const acceptedTenantIds = uniqueSorted([
    ...normalizeStringList(record.acceptedTenantIds),
    ...normalizeStringList(record.tenantIds),
    ...normalizeStringList(record.tenantId)
  ]);
  const acceptedWorkspaceIds = uniqueSorted([
    ...normalizeStringList(record.acceptedWorkspaceIds),
    ...normalizeStringList(record.workspaceIds),
    ...normalizeStringList(record.workspaceId)
  ]);
  const syncState = asNonEmptyString(record.syncState || record.status || record.state).toLowerCase();
  const contract = record.contract || record.serviceContract || {};
  const syncLeaseSeconds = normalizePositiveIntegerSetting(
    record.syncLeaseSeconds || contract.syncLeaseSeconds || record.leaseSeconds,
    DEFAULT_PROVIDER_SYNC_LEASE_SECONDS
  );

  return {
    providerId,
    displayName: asNonEmptyString(record.displayName || record.label) || providerId,
    service: asNonEmptyString(record.service || record.kind || record.type) || 'external-provider',
    capabilities: normalizeStringList(record.capabilities || record.contract?.capabilities),
    acceptedTenantIds,
    acceptedWorkspaceIds,
    acceptsAllWorkspaces: record.acceptsAllWorkspaces === true || acceptedWorkspaceIds.includes('*'),
    syncState: ['synced', 'pending', 'stale', 'blocked'].includes(syncState) ? syncState : 'pending',
    cursor: asNonEmptyString(record.cursor || record.syncCursor || record.contract?.cursor) || null,
    endpoint: asNonEmptyString(record.endpoint || record.url) || null,
    callbackRoute: firstNonEmptyString(record.callbackRoute, contract.callbackRoute, record.callbackUrl) || null,
    handoffRoute: firstNonEmptyString(record.handoffRoute, contract.handoffRoute, record.endpoint, record.url) || null,
    topic: firstNonEmptyString(record.topic, record.handoffTopic, contract.topic) || `capability-token.${providerId}`,
    requiresAcknowledgement: normalizeBooleanSetting(
      record.requiresAcknowledgement ?? contract.requiresAcknowledgement ?? record.ackRequired,
      false
    ),
    acknowledgementProof: firstNonEmptyString(
      record.acknowledgementProof,
      record.ackProof,
      contract.acknowledgementProof,
      record.lastAcknowledgedProof
    ) || null,
    receipt: record.handoffReceipt || record.receipt || record.providerReceipt || contract.receipt || null,
    lastSyncedAt: normalizeOperationalTimestamp(
      record.lastSyncedAt || record.syncedAt || contract.lastSyncedAt || contract.syncedAt
    ),
    syncLeaseSeconds: Math.min(syncLeaseSeconds, MAX_PROVIDER_SYNC_LEASE_SECONDS),
    priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : index + 1
  };
}

function normalizeIntegrationProviders(input = {}) {
  const source = Array.isArray(input.integrationProviders)
    ? input.integrationProviders
    : Array.isArray(input.providerContracts)
      ? input.providerContracts
      : Array.isArray(input.providers)
        ? input.providers
        : [];

  return source
    .map((record, index) => normalizeProviderRecord(record, index))
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority || left.providerId.localeCompare(right.providerId));
}

function requiredProviderCapabilities(permissions) {
  return uniqueSorted(permissions.flatMap((permission) => PROVIDER_CAPABILITY_REQUIREMENTS[permission] || []));
}

function providerCoversBoundary(provider, boundary) {
  const tenantAccepted = !provider.acceptedTenantIds.length
    || provider.acceptedTenantIds.includes(boundary.tenantId)
    || provider.acceptedTenantIds.includes('*');
  const workspaceAccepted = !boundary.workspaceIds.length
    || provider.acceptsAllWorkspaces
    || boundary.workspaceIds.every((workspaceId) => provider.acceptedWorkspaceIds.includes(workspaceId));

  return tenantAccepted && workspaceAccepted;
}

function providerSyncLease(provider, issuedAt) {
  const leaseStartedAt = provider.lastSyncedAt;
  const leaseExpiresAt = leaseStartedAt
    ? new Date(Date.parse(leaseStartedAt) + provider.syncLeaseSeconds * 1000).toISOString()
    : null;
  const expired = Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) <= Date.parse(issuedAt));

  return {
    state: !leaseStartedAt
      ? 'unobserved'
      : expired
        ? 'expired'
        : 'fresh',
    leaseStartedAt,
    leaseExpiresAt,
    leaseSeconds: provider.syncLeaseSeconds,
    expired
  };
}

function providerAcknowledgementState(provider, proof, terminal) {
  if (terminal) {
    return 'not_started';
  }
  if (!provider.requiresAcknowledgement) {
    return 'not_required';
  }
  if (!provider.acknowledgementProof) {
    return 'pending';
  }
  return provider.acknowledgementProof === proof ? 'acknowledged' : 'stale';
}

function normalizeProviderHandoffReceipt(provider, proof, issuedAt) {
  const receipt = provider.receipt && typeof provider.receipt === 'object' ? provider.receipt : {};
  const receiptId = firstNonEmptyString(receipt.receiptId, receipt.id, receipt.handoffId, receipt.requestId);
  const receiptProof = firstNonEmptyString(
    receipt.proofDigest,
    receipt.proof?.digest,
    receipt.capabilityProof,
    receipt.tokenProof
  );
  const providerId = firstNonEmptyString(receipt.providerId, receipt.provider?.id, provider.providerId);
  const state = asNonEmptyString(receipt.state || receipt.status || receipt.result).toLowerCase();
  const acceptedState = PROVIDER_HANDOFF_RECEIPT_STATES.has(state) ? state : null;
  const receivedAt = normalizeOperationalTimestamp(receipt.receivedAt || receipt.observedAt || receipt.createdAt);
  const expiresAt = normalizeOperationalTimestamp(receipt.expiresAt || receipt.validUntil);
  const providerMismatch = Boolean(providerId && providerId !== provider.providerId);
  const proofMismatch = Boolean(receiptProof && receiptProof !== proof);
  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.parse(issuedAt));
  const present = Boolean(receiptId || receiptProof || acceptedState || receivedAt);
  const errors = [
    providerMismatch && {
      code: 'provider_receipt_provider_mismatch',
      providerId: provider.providerId,
      receiptProviderId: providerId,
      message: 'Provider handoff receipt belongs to a different provider contract.'
    },
    proofMismatch && {
      code: 'provider_receipt_proof_mismatch',
      providerId: provider.providerId,
      receiptProof,
      expectedProof: proof,
      message: 'Provider handoff receipt is not bound to the current capability token proof.'
    },
    present && !receiptProof && {
      code: 'provider_receipt_proof_required',
      providerId: provider.providerId,
      message: 'Provider handoff receipt must include a capability token proof digest.'
    },
    expired && {
      code: 'provider_receipt_expired',
      providerId: provider.providerId,
      expiresAt,
      message: 'Provider handoff receipt expired before this capability token issue time.'
    },
    present && !acceptedState && {
      code: 'provider_receipt_state_unknown',
      providerId: provider.providerId,
      state: state || null,
      message: 'Provider handoff receipt state is not recognized by the hosted-kernel contract.'
    }
  ].filter(Boolean);
  const lifecycleState = !present
    ? 'missing'
    : errors.length
      ? 'invalid'
      : acceptedState === 'rejected' || acceptedState === 'failed'
        ? 'provider_rejected'
        : acceptedState === 'completed'
          ? 'completed'
          : 'accepted';
  const digestPayload = {
    schema: 'capability-token.provider-handoff-receipt.v1',
    providerId: provider.providerId,
    receiptId: receiptId || null,
    receiptProviderId: providerId || null,
    state: acceptedState,
    proofDigest: receiptProof || null,
    expectedProof: proof,
    receivedAt,
    expiresAt,
    lifecycleState,
    errorCodes: errors.map((error) => error.code)
  };

  return {
    contractVersion: 'capability-token.provider-handoff-receipt.v1',
    present,
    receiptId: receiptId || null,
    providerId: providerId || provider.providerId,
    state: acceptedState,
    lifecycleState,
    proofDigest: receiptProof || null,
    receivedAt,
    expiresAt,
    expired,
    errors,
    auditReference: present
      ? {
          type: 'provider-handoff-receipt',
          providerId: provider.providerId,
          receiptId: receiptId || null,
          digest: hashProof(digestPayload),
          state: lifecycleState
        }
      : null,
    proof: {
      algorithm: 'sha256',
      digest: hashProof(digestPayload),
      signedFields: Object.keys(digestPayload)
    }
  };
}

function providerServiceContract(provider, matchedCapabilities, boundary, proof, issuedAt, expiresAt, terminal) {
  const syncLease = providerSyncLease(provider, issuedAt);
  const acknowledgementState = providerAcknowledgementState(provider, proof, terminal);
  const handoffReceipt = normalizeProviderHandoffReceipt(provider, proof, issuedAt);
  const externalState = terminal
    ? 'not_started'
    : provider.syncState === 'blocked'
      ? 'blocked'
      : handoffReceipt.lifecycleState === 'invalid' || handoffReceipt.lifecycleState === 'provider_rejected'
        ? 'receipt_blocked'
        : handoffReceipt.lifecycleState === 'completed'
          ? 'completed'
          : syncLease.expired || provider.syncState !== 'synced'
            ? 'sync_required'
            : acknowledgementState === 'pending' || acknowledgementState === 'stale'
              ? 'awaiting_acknowledgement'
              : 'dispatchable';
  const contractPayload = {
    schema: 'capability-token.provider-service-contract.v1',
    providerId: provider.providerId,
    tenantId: boundary.tenantId,
    workspaceIds: boundary.workspaceIds,
    capabilities: matchedCapabilities,
    proofDigest: proof,
    issuedAt,
    expiresAt,
    syncLease,
    acknowledgementState,
    handoffReceiptState: handoffReceipt.lifecycleState,
    handoffReceiptProof: handoffReceipt.proof.digest,
    externalState
  };

  return {
    contractVersion: 'capability-token.provider-service-contract.v1',
    providerId: provider.providerId,
    service: provider.service,
    topic: provider.topic,
    endpoint: provider.endpoint,
    handoffRoute: provider.handoffRoute,
    callbackRoute: provider.callbackRoute,
    requiredCapabilities: matchedCapabilities,
    syncLease,
    acknowledgement: {
      required: provider.requiresAcknowledgement,
      state: acknowledgementState,
      proofDigest: provider.acknowledgementProof,
      requiredAction: acknowledgementState === 'pending'
        ? 'wait_for_provider_acknowledgement'
        : acknowledgementState === 'stale'
          ? 'refresh_provider_acknowledgement_for_current_proof'
        : 'none'
    },
    handoffReceipt,
    externalState,
    handoffEnvelope: {
      schema: 'capability-token.provider-handoff.v1',
      providerId: provider.providerId,
      tenantId: boundary.tenantId,
      workspaceIds: boundary.workspaceIds,
      capabilities: matchedCapabilities,
      proofDigest: proof,
      issuedAt,
      expiresAt,
      route: provider.handoffRoute,
      callbackRoute: provider.callbackRoute,
      topic: provider.topic,
      receiptExpected: provider.requiresAcknowledgement || Boolean(provider.callbackRoute),
      receiptState: handoffReceipt.lifecycleState
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(contractPayload),
      signedFields: Object.keys(contractPayload)
    }
  };
}

function negotiateProviderContracts({ input, boundary, permissions, issueState, proof, issuedAt, expiresAt }) {
  const providers = normalizeIntegrationProviders(input);
  const requiredCapabilities = requiredProviderCapabilities(permissions);
  const selectedProviders = [];
  const missingCapabilities = new Set(requiredCapabilities);
  const rejectedProviders = [];

  for (const provider of providers) {
    const matchedCapabilities = provider.capabilities.filter((capability) => missingCapabilities.has(capability));
    const boundaryAccepted = providerCoversBoundary(provider, boundary);

    if (!matchedCapabilities.length || !boundaryAccepted) {
      rejectedProviders.push({
        providerId: provider.providerId,
        reason: matchedCapabilities.length ? 'boundary_not_accepted' : 'no_required_capability_match',
        matchedCapabilities,
        syncState: provider.syncState
      });
      continue;
    }

    for (const capability of matchedCapabilities) {
      missingCapabilities.delete(capability);
    }

    selectedProviders.push({
      providerId: provider.providerId,
      displayName: provider.displayName,
      service: provider.service,
      endpoint: provider.endpoint,
      callbackRoute: provider.callbackRoute,
      handoffRoute: provider.handoffRoute,
      topic: provider.topic,
      capabilities: matchedCapabilities,
      syncState: provider.syncState,
      cursor: provider.cursor,
      requiresAcknowledgement: provider.requiresAcknowledgement,
      acknowledgementProof: provider.acknowledgementProof,
      receipt: provider.receipt,
      lastSyncedAt: provider.lastSyncedAt,
      syncLeaseSeconds: provider.syncLeaseSeconds,
      handoffState: provider.syncState === 'blocked'
        ? 'blocked'
        : provider.syncState === 'synced'
          ? 'ready'
          : 'sync_required'
    });
  }

  const terminal = PROVIDER_HANDOFF_TERMINAL_STATES.has(issueState);
  const serviceContracts = selectedProviders.map((provider) => providerServiceContract(
    provider,
    provider.capabilities,
    boundary,
    proof,
    issuedAt,
    expiresAt,
    terminal
  ));
  const blockedProvider = selectedProviders.find((provider) => provider.handoffState === 'blocked');
  const staleProviders = selectedProviders.filter((provider) => {
    const serviceContract = serviceContracts.find((contract) => contract.providerId === provider.providerId);
    return provider.handoffState === 'sync_required' || serviceContract?.syncLease.expired;
  });
  const acknowledgementProviders = serviceContracts.filter((contract) => (
    contract.externalState === 'awaiting_acknowledgement'
  ));
  const receiptBlockedProviders = serviceContracts.filter((contract) => (
    contract.externalState === 'receipt_blocked'
  ));
  const completedProviders = serviceContracts.filter((contract) => contract.externalState === 'completed');
  const receiptAuditReferences = serviceContracts
    .map((contract) => contract.handoffReceipt.auditReference)
    .filter(Boolean);
  const state = terminal
    ? 'not_started'
    : missingCapabilities.size || blockedProvider || receiptBlockedProviders.length
      ? 'blocked'
      : staleProviders.length
        ? 'sync_required'
        : 'ready';

  const syncMetadata = {
    schema: 'capability-token.provider-sync.v1',
    generatedAt: issuedAt,
    expiresAt,
    tenantId: boundary.tenantId,
    workspaceIds: boundary.workspaceIds,
    providerCount: selectedProviders.length,
    readyProviderCount: selectedProviders.filter((provider) => provider.handoffState === 'ready').length,
    staleProviderCount: staleProviders.length,
    acknowledgementPendingCount: acknowledgementProviders.length,
    receiptBlockedCount: receiptBlockedProviders.length,
    receiptCompletedCount: completedProviders.length,
    receiptAuditReferences,
    receiptErrorCodes: uniqueSorted(receiptBlockedProviders.flatMap((contract) => (
      contract.handoffReceipt.errors.map((error) => error.code)
    ))),
    cursorDigest: hashProof({
      surfaceId,
      proof,
      cursors: selectedProviders.map((provider) => [provider.providerId, provider.cursor, provider.syncState]),
      serviceProofs: serviceContracts.map((contract) => [contract.providerId, contract.proof.digest]),
      receiptProofs: serviceContracts.map((contract) => [
        contract.providerId,
        contract.handoffReceipt.lifecycleState,
        contract.handoffReceipt.proof.digest
      ])
    })
  };
  const externalHandoffState = terminal
    ? 'not_started'
    : state === 'blocked'
      ? 'blocked'
      : state === 'sync_required'
        ? 'sync_required'
        : completedProviders.length && completedProviders.length === selectedProviders.length
          ? 'completed'
        : acknowledgementProviders.length
          ? 'awaiting_acknowledgement'
          : 'ready';

  return {
    contractVersion: 'capability-token.provider-contracts.v1',
    requiredCapabilities,
    providers: selectedProviders,
    serviceContracts,
    rejectedProviders,
    missingCapabilities: [...missingCapabilities].sort(),
    negotiationState: state,
    syncMetadata,
    externalHandoff: {
      stream: 'aios.kernel.capability-token.provider-handoff',
      state: externalHandoffState,
      tenantId: boundary.tenantId,
      workspaceIds: boundary.workspaceIds,
      proof,
      providerIds: selectedProviders.map((provider) => provider.providerId),
      serviceProofs: serviceContracts.map((contract) => ({
        providerId: contract.providerId,
        proof: contract.proof.digest,
        externalState: contract.externalState,
        receiptState: contract.handoffReceipt.lifecycleState,
        receiptProof: contract.handoffReceipt.proof.digest
      })),
      receiptAuditReferences,
      requiredAction: terminal
        ? 'resolve_token_issue_before_provider_handoff'
        : receiptBlockedProviders.length
          ? 'review_provider_handoff_receipts'
          : state === 'blocked'
            ? 'connect_provider_capabilities_or_unblock_provider_sync'
            : state === 'sync_required'
              ? 'refresh_provider_sync_before_external_use'
              : acknowledgementProviders.length
                ? 'wait_for_provider_acknowledgement'
                : 'dispatch_provider_handoff'
    }
  };
}

function validationCheck(id, label, state, details = {}) {
  return {
    id,
    label,
    state,
    blocking: state === 'fail',
    ...details
  };
}

function summarizeCapabilityTokenValidation({
  boundary,
  subjectId,
  requestedPermissions,
  grantedPermissions,
  errors,
  denials,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  clientRuntime,
  resourceBoundary,
  delegationPlan,
  securityGuard
}) {
  const checks = [
    validationCheck(
      'subject-boundary',
      'Subject and tenant boundary',
      subjectId && boundary.tenantId ? 'pass' : 'fail',
      {
        subjectId: subjectId || null,
        tenantId: boundary.tenantId,
        missing: [
          ...(subjectId ? [] : ['subjectId']),
          ...(boundary.tenantId ? [] : ['tenantId'])
        ]
      }
    ),
    validationCheck(
      'workspace-scope',
      'Workspace scope',
      denials.some((denial) => denial.code.startsWith('workspace_')) ? 'fail' : 'pass',
      {
        scopeKind: boundary.scopeKind,
        workspaceIds: boundary.workspaceIds,
        requestedWorkspaceId: boundary.requestedWorkspaceId,
        isolationProof: boundary.workspaceAccess?.isolationProof || null
      }
    ),
    validationCheck(
      'permission-grant',
      'Permission grant',
      denials.some((denial) => denial.code === 'permission_not_granted_by_role' || denial.code === 'unknown_role') ? 'fail' : 'pass',
      {
        requestedPermissions,
        grantedPermissions,
        deniedPermissions: denials
          .filter((denial) => denial.permission)
          .map((denial) => denial.permission)
      }
    ),
    validationCheck(
      'issuer-dependencies',
      'Issuer dependencies',
      issuerHealth.failures.length ? 'fail' : issuerHealth.degraded.length ? 'warn' : 'pass',
      {
        mode: issuerHealth.mode,
        telemetry: issuerHealth.telemetry,
        recoveryState: issuerHealth.recovery.state,
        retryStrategy: issuerHealth.retry.strategy,
        nextRetryAt: issuerHealth.retry.nextRetryAt,
        incidentKeys: issuerHealth.incidents.map((incident) => incident.incidentKey),
        degraded: issuerHealth.degraded.map((dependency) => dependency.dependency),
        failures: issuerHealth.failures.map((failure) => failure.dependency)
      }
    ),
    validationCheck(
      'lifecycle-controls',
      'Lifecycle controls',
      lifecycleControls.state === 'blocked' ? 'fail' : lifecycleControls.warnings.length ? 'warn' : 'pass',
      {
        command: lifecycleControls.command,
        state: lifecycleControls.state,
        canIssue: lifecycleControls.canIssue,
        nextAction: lifecycleControls.scheduling.nextAction,
        nextActionRoute: lifecycleControls.nextAction.route,
        commandNextActionState: lifecycleControls.commandPlan.nextActionState,
        commandEffect: lifecycleControls.commandPlan.effect,
        checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
        capacityState: lifecycleControls.capacity.state,
        activeTokenCount: lifecycleControls.capacity.activeTokenCount,
        maxActiveTokens: lifecycleControls.capacity.maxActiveTokens,
        remainingActiveTokenSlots: lifecycleControls.capacity.remainingSlots,
        denialCodes: lifecycleControls.denials.map((denial) => denial.code),
        warningCodes: lifecycleControls.warnings.map((warning) => warning.code),
        settingsErrorCodes: lifecycleControls.settings.errors.map((error) => error.code)
      }
    ),
    validationCheck(
      'provider-handoff',
      'Provider handoff',
      providerContracts.negotiationState === 'blocked'
        ? 'fail'
        : providerContracts.negotiationState === 'sync_required'
          ? 'warn'
          : 'pass',
      {
        state: providerContracts.negotiationState,
        externalHandoffState: providerContracts.externalHandoff.state,
        requiredCapabilities: providerContracts.requiredCapabilities,
        missingCapabilities: providerContracts.missingCapabilities,
        receiptBlockedCount: providerContracts.syncMetadata.receiptBlockedCount,
        receiptErrorCodes: providerContracts.syncMetadata.receiptErrorCodes,
        receiptAuditReferences: providerContracts.syncMetadata.receiptAuditReferences,
        providerIds: providerContracts.providers.map((provider) => provider.providerId),
        serviceProofs: providerContracts.externalHandoff.serviceProofs
      }
    ),
    validationCheck(
      'client-routes',
      'Client workflow routes',
      clientRuntime.routeWarnings.length ? 'warn' : 'pass',
      {
        digest: clientRuntime.routeCatalog.digest,
        routes: {
          acceptanceRoute: clientRuntime.routeCatalog.acceptanceRoute,
          reviewRoute: clientRuntime.routeCatalog.reviewRoute,
          providerSyncRoute: clientRuntime.routeCatalog.providerSyncRoute
        },
        warningCodes: clientRuntime.routeWarnings.map((warning) => warning.code),
        warnings: clientRuntime.routeWarnings
      }
    ),
    validationCheck(
      'resource-boundary',
      'Resource boundary',
      resourceBoundary.state === 'blocked' ? 'fail' : 'pass',
      {
        state: resourceBoundary.state,
        resourceCount: resourceBoundary.resourceCount,
        allowedResourceIds: resourceBoundary.allowedResourceIds,
        deniedResourceIds: resourceBoundary.deniedResourceIds,
        denialCodes: resourceBoundary.denials.map((denial) => denial.code),
        proof: resourceBoundary.proof.digest
      }
    ),
    validationCheck(
      'delegation-boundary',
      'Delegation boundary',
      delegationPlan.state === 'blocked' ? 'fail' : delegationPlan.warnings.length ? 'warn' : 'pass',
      {
        requested: delegationPlan.requested,
        state: delegationPlan.state,
        mode: delegationPlan.mode,
        parentTokenId: delegationPlan.parent.tokenId,
        depth: delegationPlan.depth,
        maxDepth: delegationPlan.maxDepth,
        auditReferenceCount: delegationPlan.auditReferences.length,
        denialCodes: delegationPlan.denials.map((denial) => denial.code),
        warningCodes: delegationPlan.warnings.map((warning) => warning.code),
        proof: delegationPlan.proof.digest
      }
    ),
    validationCheck(
      'security-guard',
      'Revocation and replay guard',
      securityGuard.state === 'blocked' ? 'fail' : securityGuard.requestSealed ? 'pass' : 'warn',
      {
        state: securityGuard.state,
        requestSealed: securityGuard.requestSealed,
        requestNonce: securityGuard.requestNonce,
        requestFreshnessState: securityGuard.requestFreshness?.state || 'unobserved',
        requestFreshnessAgeSeconds: securityGuard.requestFreshness?.ageSeconds ?? null,
        requestFreshnessProof: securityGuard.requestFreshness?.proof?.digest || null,
        revocationMatchCount: securityGuard.registry.revocationMatchCount,
        replayMatchCount: securityGuard.registry.replayMatchCount,
        registryRevocationCount: securityGuard.registry.revocationCount,
        registryReplayNonceCount: securityGuard.registry.replayNonceCount,
        denialCodes: securityGuard.denials.map((denial) => denial.code),
        proof: securityGuard.proof.digest
      }
    )
  ];
  const failed = checks.filter((check) => check.state === 'fail');
  const warnings = checks.filter((check) => check.state === 'warn');

  return {
    contractVersion: 'capability-token.validation-summary.v1',
    state: errors.length || failed.length ? 'blocked' : warnings.length || denials.length ? 'review' : 'ready',
    passCount: checks.filter((check) => check.state === 'pass').length,
    warningCount: warnings.length,
    failureCount: failed.length,
    blockingCodes: uniqueSorted([
      ...errors.map((error) => error.code),
      ...denials.map((denial) => denial.code),
      ...failed.map((check) => check.id)
    ]),
    checks
  };
}

function buildCapabilityTokenNextSteps({
  issueState,
  validationSummary,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  retry,
  workflowHandoff,
  securityGuard
}) {
  const steps = [];
  let priority = 1;

  for (const check of validationSummary.checks.filter((item) => item.state === 'fail')) {
    steps.push({
      id: `resolve-${check.id}`,
      priority: priority++,
      state: 'required',
      blocking: true,
      label: `Resolve ${check.label.toLowerCase()}`,
      explanation: `The ${check.id} validation check failed and must pass before the token can be accepted.`
    });
  }

  for (const incident of issuerHealth.incidents.filter((item) => item.severity === 'critical')) {
    steps.push({
      id: `restore-${incident.dependency}`,
      priority: priority++,
      state: 'required',
      blocking: true,
      label: `Restore ${incident.dependency}`,
      explanation: incident.message,
      action: incident.action,
      incidentKey: incident.incidentKey,
      lastFailureAt: incident.lastFailureAt,
      consecutiveFailures: incident.consecutiveFailures
    });
  }

  for (const dependency of issuerHealth.degraded) {
    const incident = issuerHealth.incidents.find((item) => item.dependency === dependency.dependency);
    steps.push({
      id: `monitor-${dependency.dependency}`,
      priority: priority++,
      state: 'recommended',
      blocking: false,
      label: `Monitor ${dependency.dependency}`,
      explanation: dependency.action,
      action: incident?.action || dependency.action,
      incidentKey: incident?.incidentKey || null,
      retryAfterSeconds: incident?.retryAfterSeconds || retry.retryAfterSeconds,
      nextRetryAt: incident?.nextRetryAt || retry.nextRetryAt
    });
  }

  if (lifecycleControls.state === 'blocked') {
    steps.push({
      id: 'review-lifecycle-controls',
      priority: priority++,
      state: 'required',
      blocking: true,
      label: 'Review lifecycle controls',
      explanation: 'Lifecycle command or settings prevent this capability token from being issued.',
      command: lifecycleControls.command,
      commandNextActionState: lifecycleControls.commandPlan.nextActionState,
      checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
      nextActionRoute: lifecycleControls.nextAction.route,
      capacityState: lifecycleControls.capacity.state,
      activeTokenCount: lifecycleControls.capacity.activeTokenCount,
      maxActiveTokens: lifecycleControls.capacity.maxActiveTokens,
      denialCodes: lifecycleControls.denials.map((denial) => denial.code),
      settingsErrorCodes: lifecycleControls.settings.errors.map((error) => error.code)
    });
  } else if (lifecycleControls.scheduling.enabled) {
    steps.push({
      id: lifecycleControls.scheduling.nextAction,
      priority: priority++,
      state: lifecycleControls.warnings.length ? 'recommended' : 'available',
      blocking: false,
      label: lifecycleControls.scheduling.nextAction.replaceAll('_', ' '),
      explanation: 'Lifecycle scheduling is enabled for this capability token workflow.',
      nextRunAt: lifecycleControls.scheduling.nextRunAt,
      cadence: lifecycleControls.scheduling.cadence,
      nextActionRoute: lifecycleControls.nextAction.route,
      capacityState: lifecycleControls.capacity.state,
      remainingActiveTokenSlots: lifecycleControls.capacity.remainingSlots,
      commandNextActionState: lifecycleControls.commandPlan.nextActionState,
      commandEffect: lifecycleControls.commandPlan.effect
    });
  }

  if (securityGuard.state === 'blocked') {
    steps.push({
      id: 'review-security-guard',
      priority: priority++,
      state: 'required',
      blocking: true,
      label: 'Review revocation and replay guard',
      explanation: 'Revocation or replay registry state prevents this capability token request from being accepted.',
      requestNonce: securityGuard.requestNonce,
      revocationMatchCount: securityGuard.registry.revocationMatchCount,
      replayMatchCount: securityGuard.registry.replayMatchCount,
      denialCodes: securityGuard.denials.map((denial) => denial.code),
      proof: securityGuard.proof.digest
    });
  } else if (!securityGuard.requestSealed) {
    steps.push({
      id: 'seal-capability-token-request',
      priority: priority++,
      state: 'recommended',
      blocking: false,
      label: 'Seal capability token request',
      explanation: 'Add a request nonce so the hosted kernel can bind this capability token request to replay protection.',
      proof: securityGuard.proof.digest
    });
  }

  if (securityGuard.requestFreshness?.blocking) {
    steps.push({
      id: 'refresh-client-request',
      priority: priority++,
      state: 'required',
      blocking: true,
      label: 'Refresh client request',
      explanation: securityGuard.requestFreshness.denial.message,
      requestFreshnessState: securityGuard.requestFreshness.state,
      requestedAt: securityGuard.requestFreshness.requestedAt,
      ageSeconds: securityGuard.requestFreshness.ageSeconds,
      maxAgeSeconds: securityGuard.requestFreshness.maxAgeSeconds,
      proof: securityGuard.requestFreshness.proof.digest
    });
  } else if (!securityGuard.requestFreshness?.supplied) {
    steps.push({
      id: 'stamp-client-request-time',
      priority: priority++,
      state: 'recommended',
      blocking: false,
      label: 'Stamp client request time',
      explanation: 'Add a client request timestamp so the hosted kernel can enforce request freshness alongside replay protection.',
      maxAgeSeconds: CLIENT_REQUEST_MAX_AGE_SECONDS,
      proof: securityGuard.requestFreshness?.proof?.digest || securityGuard.proof.digest
    });
  }

  if (providerContracts.negotiationState === 'sync_required') {
    steps.push({
      id: 'refresh-provider-sync',
      priority: priority++,
      state: 'recommended',
      blocking: false,
      label: 'Refresh provider sync',
      explanation: 'One or more selected providers need fresh sync before external handoff.',
      providerIds: providerContracts.providers
        .filter((provider) => provider.handoffState === 'sync_required')
        .map((provider) => provider.providerId)
    });
  }

  if (providerContracts.externalHandoff?.state === 'awaiting_acknowledgement') {
    steps.push({
      id: 'wait-provider-acknowledgement',
      priority: priority++,
      state: 'recommended',
      blocking: false,
      label: 'Wait for provider acknowledgement',
      explanation: 'External provider service contracts require proof-bound acknowledgement before dispatch.',
      providerIds: providerContracts.serviceContracts
        .filter((contract) => contract.externalState === 'awaiting_acknowledgement')
        .map((contract) => contract.providerId)
    });
  }

  if (workflowHandoff?.handoffState === 'acceptance_ready') {
    steps.push({
      id: 'continue-client-workflow',
      priority: priority++,
      state: 'available',
      blocking: false,
      label: 'Continue client workflow',
      explanation: 'The hosted-kernel client can resume at the acceptance route with the signed token proof.',
      route: workflowHandoff.targetRoute,
      requestId: workflowHandoff.requestId
    });
  }

  if (!steps.length && ACCEPTANCE_TERMINAL_ISSUE_STATES.has(issueState)) {
    steps.push({
      id: 'accept-capability-token',
      priority,
      state: 'available',
      blocking: false,
      label: 'Accept capability token',
      explanation: 'All blocking validation checks passed and the token is ready for client acceptance.'
    });
  }

  return steps;
}

function issuanceBlockerSource(code) {
  if (code.startsWith('issuer_')) {
    return 'issuer-health';
  }
  if (code.startsWith('lifecycle_') || code.includes('lifecycle')) {
    return 'lifecycle-controls';
  }
  if (code.startsWith('delegation_')) {
    return 'delegation-boundary';
  }
  if (code.startsWith('resource_')) {
    return 'resource-boundary';
  }
  if (code.startsWith('workspace_') || code.startsWith('permission_') || code === 'cross_tenant_denied') {
    return 'authorization-boundary';
  }
  if (code.startsWith('capability_token_replay') || code.startsWith('capability_token_revoked')) {
    return 'security-guard';
  }
  if (code.startsWith('capability_token_request_')) {
    return 'security-guard';
  }
  if (code.includes('provider')) {
    return 'provider-handoff';
  }
  return 'capability-token';
}

function issuanceBlockerRetryable(code, source) {
  if (RETRYABLE_ISSUANCE_BLOCKER_CODES.has(code)) {
    return true;
  }
  if (TERMINAL_ISSUANCE_BLOCKER_CODES.has(code)) {
    return false;
  }
  return source === 'provider-handoff' || source === 'lifecycle-controls';
}

function normalizeIssuanceBlockers({
  errors,
  denials,
  issuerHealth,
  lifecycleControls,
  providerContracts,
  delegationPlan,
  securityGuard,
  resourceBoundary
}) {
  const rawBlockers = [
    ...errors.map((error) => ({ ...error, source: 'capability-token', severity: 'error' })),
    ...denials.map((denial) => ({ ...denial, source: issuanceBlockerSource(denial.code), severity: 'denial' })),
    ...issuerHealth.failures.map((failure) => ({ ...failure, source: 'issuer-health', severity: 'critical' })),
    ...issuerHealth.degraded.map((warning) => ({ ...warning, source: 'issuer-health', severity: 'warning' })),
    ...lifecycleControls.settings.errors.map((error) => ({ ...error, source: 'lifecycle-controls', severity: 'error' })),
    ...lifecycleControls.warnings.map((warning) => ({ ...warning, source: 'lifecycle-controls', severity: 'warning' })),
    ...delegationPlan.denials.map((denial) => ({ ...denial, source: 'delegation-boundary', severity: 'denial' })),
    ...securityGuard.denials.map((denial) => ({ ...denial, source: 'security-guard', severity: 'denial' })),
    ...resourceBoundary.denials.map((denial) => ({ ...denial, source: 'resource-boundary', severity: 'denial' }))
  ];

  if (providerContracts.negotiationState === 'blocked') {
    rawBlockers.push({
      code: 'provider_handoff_blocked',
      source: 'provider-handoff',
      severity: 'denial',
      missingCapabilities: providerContracts.missingCapabilities,
      message: 'Provider capability negotiation is blocked for this capability token.'
    });
  } else if (providerContracts.negotiationState === 'sync_required') {
    rawBlockers.push({
      code: 'provider_sync_required',
      source: 'provider-handoff',
      severity: 'warning',
      providerIds: providerContracts.providers
        .filter((provider) => provider.handoffState === 'sync_required')
        .map((provider) => provider.providerId),
      message: 'Provider sync must be refreshed before external capability token handoff.'
    });
  }

  if (providerContracts.syncMetadata.receiptBlockedCount > 0) {
    rawBlockers.push({
      code: 'provider_handoff_receipt_blocked',
      source: 'provider-handoff',
      severity: 'denial',
      providerIds: providerContracts.serviceContracts
        .filter((contract) => contract.externalState === 'receipt_blocked')
        .map((contract) => contract.providerId),
      receiptErrorCodes: providerContracts.syncMetadata.receiptErrorCodes,
      message: 'Provider handoff receipt state does not match the current capability token contract.'
    });
  }

  const deduped = new Map();
  for (const blocker of rawBlockers.filter((item) => item.code)) {
    const source = blocker.source || issuanceBlockerSource(blocker.code);
    const key = `${source}:${blocker.code}:${blocker.dependency || blocker.permission || blocker.workspaceId || blocker.providerId || ''}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        code: blocker.code,
        source,
        severity: blocker.severity || 'warning',
        retryable: issuanceBlockerRetryable(blocker.code, source),
        dependency: blocker.dependency || null,
        permission: blocker.permission || null,
        workspaceId: blocker.workspaceId || null,
        providerIds: blocker.providerIds || [],
        message: blocker.message || 'Capability token issuance requires operator review.',
        action: blocker.action || null
      });
    }
  }

  return [...deduped.values()].sort((left, right) => (
    left.retryable === right.retryable
      ? left.source.localeCompare(right.source) || left.code.localeCompare(right.code)
      : left.retryable
        ? 1
        : -1
  ));
}

function buildIssuanceRecoveryPlan({
  issueState,
  errors,
  denials,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  delegationPlan,
  securityGuard,
  resourceBoundary,
  statePersistence,
  now,
  tokenId,
  proof
}) {
  const blockers = normalizeIssuanceBlockers({
    errors,
    denials,
    issuerHealth,
    lifecycleControls,
    providerContracts,
    delegationPlan,
    securityGuard,
    resourceBoundary
  });
  const terminalBlockers = blockers.filter((blocker) => !blocker.retryable);
  const retryableBlockers = blockers.filter((blocker) => blocker.retryable);
  const blocked = issueState === 'failed' || issueState === 'denied' || terminalBlockers.length > 0;
  const degraded = issueState === 'issued_degraded' || issuerHealth.mode === 'degraded';
  const providerSyncRequired = providerContracts.negotiationState === 'sync_required';
  const retryAfterSeconds = retryableBlockers.length
    ? Math.max(issuerHealth.retry.retryAfterSeconds, lifecycleControls.scheduling.deferredUntil
      ? Math.max(0, Math.ceil((Date.parse(lifecycleControls.scheduling.deferredUntil) - Date.parse(now)) / 1000))
      : 0)
    : 0;
  const nextRetryAt = retryAfterSeconds
    ? new Date(Date.parse(now) + retryAfterSeconds * 1000).toISOString()
    : issuerHealth.retry.nextRetryAt;
  const recoveryState = blocked
    ? terminalBlockers.length
      ? 'operator_action_required'
      : retryableBlockers.length
        ? 'retry_after_backoff'
        : 'failed_without_retry_path'
    : degraded
      ? 'degraded_mode_active'
      : providerSyncRequired
        ? 'provider_sync_pending'
        : 'clear';
  const retryQueue = retryableBlockers.map((blocker, index) => ({
    sequence: index + 1,
    code: blocker.code,
    source: blocker.source,
    dependency: blocker.dependency,
    providerIds: blocker.providerIds,
    retryAfterSeconds: retryAfterSeconds || issuerHealth.retry.retryAfterSeconds,
    nextRetryAt,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    action: blocker.action || (
      blocker.source === 'provider-handoff'
        ? 'refresh_provider_sync_before_retry'
        : blocker.source === 'lifecycle-controls'
          ? 'wait_for_lifecycle_window_before_retry'
          : 'retry_capability_token_issue_after_dependency_recovery'
    )
  }));
  const operatorQueue = terminalBlockers.map((blocker, index) => ({
    sequence: index + 1,
    code: blocker.code,
    source: blocker.source,
    severity: blocker.severity,
    dependency: blocker.dependency,
    permission: blocker.permission,
    workspaceId: blocker.workspaceId,
    message: blocker.message,
    action: blocker.action || (
      blocker.source === 'security-guard'
        ? 'review_revocation_or_replay_registry_before_reissue'
        : blocker.source === 'authorization-boundary'
          ? 'adjust_roles_permissions_or_workspace_scope_before_reissue'
          : blocker.source === 'delegation-boundary'
            ? 'repair_parent_delegation_chain_before_reissue'
            : 'resolve_capability_token_blocker_before_reissue'
    )
  }));
  const proofPayload = {
    schema: 'capability-token.issuance-recovery.v1',
    surfaceId,
    issueState,
    recoveryState,
    tokenId,
    proofDigest: proof,
    blockerCodes: blockers.map((blocker) => blocker.code),
    retryableCodes: retryQueue.map((entry) => entry.code),
    operatorCodes: operatorQueue.map((entry) => entry.code),
    retryAfterSeconds,
    nextRetryAt,
    persistenceState: statePersistence.recovery.state,
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.issuance-recovery.v1',
    state: recoveryState,
    retryable: retryQueue.length > 0 && operatorQueue.length === 0,
    degradedModeActive: degraded,
    blocked,
    blockerCount: blockers.length,
    retryQueue,
    operatorQueue,
    nextAction: operatorQueue.length
      ? operatorQueue[0].action
      : retryQueue.length
        ? retryQueue[0].action
        : degraded
          ? 'continue_degraded_mode_with_audit_retry_visibility'
          : providerSyncRequired
            ? 'refresh_provider_sync_before_external_handoff'
            : 'none',
    backoff: {
      strategy: retryQueue.length ? 'bounded-exponential-backoff' : 'none',
      retryAfterSeconds,
      nextRetryAt,
      maxAttempts: retryQueue.length ? MAX_RETRY_ATTEMPTS : 0
    },
    auditReferences: [
      {
        type: 'current-issue-proof',
        tokenId,
        digest: proof
      },
      {
        type: 'issuer-health-proof',
        digest: issuerHealth.proof.digest
      },
      {
        type: 'state-persistence-proof',
        digest: statePersistence.proof.digest
      }
    ],
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function routeForWorkflowReviewSource(source, routeCatalog) {
  if (source === 'provider-handoff') {
    return routeCatalog.providerSyncRoute;
  }
  return routeCatalog.reviewRoute;
}

function proofRefsForWorkflowReviewItem(source, context) {
  const {
    providerContracts,
    lifecycleControls,
    resourceBoundary,
    delegationPlan,
    securityGuard
  } = context;

  if (source === 'provider-handoff') {
    return providerContracts.externalHandoff.serviceProofs.map((service) => service.proof);
  }
  if (source === 'lifecycle-controls') {
    return [lifecycleControls.commandPlan.proof.digest, lifecycleControls.proof.digest];
  }
  if (source === 'resource-boundary') {
    return [resourceBoundary.proof.digest];
  }
  if (source === 'delegation-boundary') {
    return [delegationPlan.proof.digest];
  }
  if (source === 'security-guard') {
    return [securityGuard.proof.digest];
  }
  return [];
}

function buildWorkflowHandoffReviewQueue({
  validationSummary,
  providerContracts,
  lifecycleControls,
  resourceBoundary,
  delegationPlan,
  securityGuard,
  routeCatalog
}) {
  const context = {
    providerContracts,
    lifecycleControls,
    resourceBoundary,
    delegationPlan,
    securityGuard
  };
  const queue = [];
  const pushQueueItem = (item) => {
    queue.push({
      sequence: queue.length + 1,
      ...item,
      proofRefs: item.proofRefs || proofRefsForWorkflowReviewItem(item.source, context)
    });
  };

  for (const check of validationSummary.checks.filter((item) => item.state !== 'pass')) {
    pushQueueItem({
      id: `review-${check.id}`,
      source: check.id,
      state: check.state === 'fail' ? 'blocked' : 'attention',
      blocking: check.state === 'fail',
      label: check.state === 'fail'
        ? `Resolve ${check.label.toLowerCase()}`
        : `Review ${check.label.toLowerCase()}`,
      route: routeForWorkflowReviewSource(check.id, routeCatalog),
      reasonCodes: check.denialCodes || check.warningCodes || [],
      detailsDigest: hashProof({
        schema: 'capability-token.workflow-review-item.v1',
        id: check.id,
        state: check.state,
        details: check
      })
    });
  }

  if (resourceBoundary.deniedResourceIds.length) {
    pushQueueItem({
      id: 'review-denied-resources',
      source: 'resource-boundary',
      state: 'blocked',
      blocking: true,
      label: 'Review denied resources',
      route: routeCatalog.reviewRoute,
      resourceIds: resourceBoundary.deniedResourceIds,
      reasonCodes: uniqueSorted(resourceBoundary.denials.map((denial) => denial.code)),
      detailsDigest: resourceBoundary.audit.proof
    });
  }

  if (delegationPlan.state === 'blocked' || delegationPlan.warnings.length) {
    pushQueueItem({
      id: delegationPlan.state === 'blocked' ? 'repair-delegation-chain' : 'review-delegation-chain',
      source: 'delegation-boundary',
      state: delegationPlan.state === 'blocked' ? 'blocked' : 'attention',
      blocking: delegationPlan.state === 'blocked',
      label: delegationPlan.state === 'blocked' ? 'Repair delegation chain' : 'Review delegation chain',
      route: routeCatalog.reviewRoute,
      parentTokenId: delegationPlan.parent.tokenId,
      depth: delegationPlan.depth,
      auditReferences: delegationPlan.auditReferences,
      reasonCodes: uniqueSorted([
        ...delegationPlan.denials.map((denial) => denial.code),
        ...delegationPlan.warnings.map((warning) => warning.code)
      ])
    });
  }

  if (securityGuard.state === 'blocked' || !securityGuard.requestSealed) {
    pushQueueItem({
      id: securityGuard.state === 'blocked' ? 'review-security-guard' : 'seal-request-nonce',
      source: 'security-guard',
      state: securityGuard.state === 'blocked' ? 'blocked' : 'attention',
      blocking: securityGuard.state === 'blocked',
      label: securityGuard.state === 'blocked' ? 'Review revocation and replay guard' : 'Seal request nonce',
      route: routeCatalog.reviewRoute,
      requestNonce: securityGuard.requestNonce,
      requestFreshnessState: securityGuard.requestFreshness?.state || 'unobserved',
      requestFreshnessProof: securityGuard.requestFreshness?.proof?.digest || null,
      reasonCodes: securityGuard.denials.map((denial) => denial.code),
      revocationMatchCount: securityGuard.registry.revocationMatchCount,
      replayMatchCount: securityGuard.registry.replayMatchCount
    });
  }

  if (providerContracts.syncMetadata.receiptBlockedCount > 0) {
    pushQueueItem({
      id: 'review-provider-receipts',
      source: 'provider-handoff',
      state: 'blocked',
      blocking: true,
      label: 'Review provider receipts',
      route: routeCatalog.providerSyncRoute,
      providerIds: providerContracts.serviceContracts
        .filter((contract) => contract.externalState === 'receipt_blocked')
        .map((contract) => contract.providerId),
      reasonCodes: providerContracts.syncMetadata.receiptErrorCodes,
      auditReferences: providerContracts.syncMetadata.receiptAuditReferences
    });
  }

  return queue.sort((left, right) => (
    left.blocking === right.blocking
      ? left.sequence - right.sequence
      : left.blocking
        ? -1
        : 1
  )).map((item, index) => ({ ...item, sequence: index + 1 }));
}

function buildClientContinuationPacket({
  clientRuntime,
  routeCatalog,
  handoffState,
  targetRoute,
  acceptable,
  providerSyncRequired,
  validationSummary,
  reviewQueue,
  lifecycleControls,
  securityGuard,
  providerContracts,
  tokenId,
  expiresAt,
  proof
}) {
  const primaryBlockingItem = reviewQueue.find((item) => item.blocking) || null;
  const retryableBlockers = validationSummary.blockingCodes.filter((code) => (
    RETRYABLE_ISSUANCE_BLOCKER_CODES.has(code)
  ));
  const terminalBlockers = validationSummary.blockingCodes.filter((code) => (
    TERMINAL_ISSUANCE_BLOCKER_CODES.has(code) || !retryableBlockers.includes(code)
  ));
  const providerSyncQueued = providerSyncRequired || providerContracts.negotiationState === 'sync_required';
  const clientCanResume = acceptable
    && securityGuard.state !== 'blocked'
    && lifecycleControls.state !== 'blocked'
    && Boolean(clientRuntime.continuationId || clientRuntime.workflowId || clientRuntime.requestId);
  const resumeMode = !clientCanResume
    ? 'not_resumable'
    : providerSyncQueued
      ? 'resume_after_provider_sync'
      : clientRuntime.continuationId
        ? 'resume_named_continuation'
        : 'resume_request';
  const nextClientRoute = primaryBlockingItem?.route
    || (providerSyncQueued ? routeCatalog.providerSyncRoute : targetRoute);
  const checkpointKey = [
    surfaceId,
    clientRuntime.requestId,
    clientRuntime.continuationId || clientRuntime.workflowId || 'request',
    tokenId || 'pending'
  ].join(':');
  const providerReceiptRefs = providerContracts.syncMetadata.receiptAuditReferences.map((reference) => ({
    type: reference.type,
    providerId: reference.providerId,
    receiptId: reference.receiptId,
    digest: reference.digest,
    state: reference.state
  }));
  const requiredClientClaims = uniqueSorted([
    acceptable ? 'capability-token.accept' : 'capability-token.review',
    providerSyncQueued ? 'provider-sync.review' : null,
    lifecycleControls.scheduling.enabled ? 'lifecycle-schedule.review' : null,
    securityGuard.requestSealed ? 'replay-sealed-request' : 'replay-seal-required'
  ]);
  const dispatch = {
    state: acceptable
      ? providerSyncQueued
        ? 'hold_for_provider_sync'
        : 'ready'
      : retryableBlockers.length && !terminalBlockers.length
        ? 'retryable_hold'
        : 'blocked',
    route: nextClientRoute,
    routeGuard: acceptable ? 'acceptance_allowed' : 'review_required',
    retryable: retryableBlockers.length > 0 && terminalBlockers.length === 0,
    retryAfterSeconds: lifecycleControls.scheduling.deferredUntil
      ? Math.max(0, Math.ceil((Date.parse(lifecycleControls.scheduling.deferredUntil) - Date.parse(clientRuntime.freshness.assessedAt)) / 1000))
      : 0
  };
  const proofPayload = {
    schema: 'capability-token.client-continuation.v1',
    surfaceId,
    requestId: clientRuntime.requestId,
    continuationId: clientRuntime.continuationId,
    workflowId: clientRuntime.workflowId,
    handoffState,
    resumeMode,
    targetRoute,
    nextClientRoute,
    acceptable,
    providerSyncQueued,
    dispatchState: dispatch.state,
    retryableBlockers,
    terminalBlockers,
    lifecycleCommand: lifecycleControls.command,
    lifecycleState: lifecycleControls.state,
    securityGuardState: securityGuard.state,
    providerNegotiationState: providerContracts.negotiationState,
    tokenId,
    proofDigest: proof,
    expiresAt
  };

  return {
    contractVersion: 'capability-token.client-continuation.v1',
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    clientId: clientRuntime.clientId,
    workflowId: clientRuntime.workflowId,
    continuationId: clientRuntime.continuationId,
    state: dispatch.state,
    resumeMode,
    resumable: clientCanResume,
    checkpointKey,
    targetRoute,
    nextClientRoute,
    returnRoute: clientRuntime.returnRoute,
    dispatch,
    requiredClientClaims,
    routeStatePatch: {
      schema: 'capability-token.client-continuation-route-patch.v1',
      requestId: clientRuntime.requestId,
      continuationId: clientRuntime.continuationId,
      handoffState,
      route: nextClientRoute,
      returnRoute: clientRuntime.returnRoute,
      tokenId,
      proofDigest: proof,
      expiresAt,
      replayProtection: {
        requestSealed: securityGuard.requestSealed,
        requestNonce: securityGuard.requestNonce,
        freshnessState: securityGuard.requestFreshness?.state || 'unobserved',
        proof: securityGuard.requestFreshness?.proof?.digest || null
      },
      lifecycle: {
        command: lifecycleControls.command,
        state: lifecycleControls.state,
        nextAction: lifecycleControls.nextAction.action,
        commandState: lifecycleControls.commandPlan.nextActionState,
        checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent
      },
      providerSync: {
        required: providerSyncQueued,
        state: providerContracts.negotiationState,
        providerIds: providerContracts.providers.map((provider) => provider.providerId),
        receiptRefs: providerReceiptRefs
      }
    },
    retry: {
      retryable: dispatch.retryable,
      retryAfterSeconds: dispatch.retryAfterSeconds,
      retryableBlockers,
      terminalBlockers
    },
    primaryBlockingItem: primaryBlockingItem
      ? {
          id: primaryBlockingItem.id,
          source: primaryBlockingItem.source,
          route: primaryBlockingItem.route,
          reasonCodes: primaryBlockingItem.reasonCodes || []
        }
      : null,
    auditReferences: uniqueSorted([
      securityGuard.proof.digest,
      lifecycleControls.commandPlan.proof.digest,
      ...providerReceiptRefs.map((reference) => reference.digest)
    ]),
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function buildClientWorkflowHandoff({
  clientRuntime,
  boundary,
  subjectId,
  roles,
  grantedPermissions,
  tokenId,
  expiresAt,
  issueState,
  acceptable,
  validationSummary,
  providerContracts,
  lifecycleControls,
  resourceBoundary,
  delegationPlan,
  securityGuard,
  proof
}) {
  const providerSyncRequired = acceptable && providerContracts.negotiationState === 'sync_required';
  const lifecycleBlocked = lifecycleControls.state === 'blocked';
  const routeCatalog = clientRuntime.routeCatalog || CLIENT_RUNTIME_DEFAULTS;
  const reviewQueue = buildWorkflowHandoffReviewQueue({
    validationSummary,
    providerContracts,
    lifecycleControls,
    resourceBoundary,
    delegationPlan,
    securityGuard,
    routeCatalog
  });
  const primaryReviewItem = reviewQueue.find((item) => item.blocking) || reviewQueue[0] || null;
  const targetRoute = !acceptable
    ? primaryReviewItem?.route || routeCatalog.reviewRoute
    : providerSyncRequired
      ? routeCatalog.providerSyncRoute
      : routeCatalog.acceptanceRoute;
  const handoffState = !acceptable
    ? 'blocked_for_review'
    : providerSyncRequired
      ? 'provider_sync_required'
      : 'acceptance_ready';
  const blockingCodes = validationSummary.blockingCodes;
  const continuationRequired = acceptable && clientRuntime.interactive && Boolean(clientRuntime.continuationId);
  const routePlan = {
    contractVersion: 'capability-token.workflow-route-plan.v1',
    activeRoute: clientRuntime.activeRoute,
    targetRoute,
    returnRoute: clientRuntime.returnRoute,
    acceptanceRoute: routeCatalog.acceptanceRoute,
    reviewRoute: routeCatalog.reviewRoute,
    providerSyncRoute: routeCatalog.providerSyncRoute,
    routeWarnings: clientRuntime.routeWarnings,
    transition: !acceptable
      ? 'review_blockers'
      : providerSyncRequired
        ? 'sync_then_accept'
        : continuationRequired
          ? 'resume_continuation'
          : 'direct_acceptance',
    continuationRequired
  };
  const resumeEnvelope = acceptable
    ? {
        schema: 'capability-token.workflow-resume.v1',
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        clientId: clientRuntime.clientId,
        workflowId: clientRuntime.workflowId,
        continuationId: clientRuntime.continuationId,
        tokenId,
        tenantId: boundary.tenantId,
        subjectId: subjectId || null,
        workspaceIds: boundary.workspaceIds,
        roles,
        permissions: grantedPermissions,
        proofDigest: proof,
        expiresAt,
        targetRoute,
        returnRoute: clientRuntime.returnRoute,
        providerHandoffState: providerContracts.negotiationState,
        routePlan
      }
    : null;
  const continuationPacket = buildClientContinuationPacket({
    clientRuntime,
    routeCatalog,
    handoffState,
    targetRoute,
    acceptable,
    providerSyncRequired,
    validationSummary,
    reviewQueue,
    lifecycleControls,
    securityGuard,
    providerContracts,
    tokenId,
    expiresAt,
    proof
  });
  const handoffProofPayload = {
    schema: 'capability-token.client-handoff.v1',
    requestId: clientRuntime.requestId,
    stateDigest: clientRuntime.stateDigest,
    tokenId,
    issueState,
    handoffState,
    targetRoute,
    proofDigest: proof,
    blockingCodes,
    lifecycleCommand: lifecycleControls.command,
    lifecycleState: lifecycleControls.state,
    reviewQueueDigest: hashProof({
      schema: 'capability-token.workflow-review-queue.v1',
      items: reviewQueue.map((item) => [
        item.id,
        item.source,
        item.state,
        item.blocking,
        item.route,
        item.reasonCodes || [],
        item.proofRefs || []
      ])
    }),
    routePlanDigest: hashProof(routePlan),
    continuationDigest: continuationPacket.proof.digest
  };

  return {
    contractVersion: 'capability-token.client-handoff.v1',
    requestId: clientRuntime.requestId,
    handoffState,
    targetRoute,
    returnRoute: clientRuntime.returnRoute,
    routeGuard: acceptable && !lifecycleBlocked ? 'allow_client_resume' : 'require_review_resolution',
    routePlan,
    reviewQueue,
    primaryReviewItem,
    continuationPacket,
    visibleAction: acceptable
      ? {
          id: providerSyncRequired ? 'sync-providers' : 'accept-capability-token',
          label: providerSyncRequired ? 'Sync providers' : 'Accept capability token',
          enabled: true,
          route: targetRoute,
          continuationRequired,
          continuationState: continuationPacket.state,
          requiredClientClaims: continuationPacket.requiredClientClaims
        }
      : {
          id: primaryReviewItem?.id || 'review-capability-token',
          label: primaryReviewItem?.label || 'Review capability token',
          enabled: true,
          route: targetRoute,
          continuationRequired: false,
          source: primaryReviewItem?.source || 'capability-token',
          reasonCodes: primaryReviewItem?.reasonCodes || blockingCodes,
          continuationState: continuationPacket.state,
          requiredClientClaims: continuationPacket.requiredClientClaims
        },
    resumeEnvelope,
    blockedBy: acceptable ? [] : blockingCodes,
    auditReferences: uniqueSorted([
      ...delegationPlan.auditReferences.map((reference) => reference.digest),
      ...providerContracts.syncMetadata.receiptAuditReferences.map((reference) => reference.digest),
      securityGuard.proof.digest,
      resourceBoundary.proof.digest
    ]),
    lifecycle: {
      command: lifecycleControls.command,
      state: lifecycleControls.state,
      nextAction: lifecycleControls.scheduling.nextAction,
      schedulingEnabled: lifecycleControls.scheduling.enabled,
      commandNextActionState: lifecycleControls.commandPlan.nextActionState,
      commandEffect: lifecycleControls.commandPlan.effect,
      checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
      proof: lifecycleControls.commandPlan.proof.digest
    },
    providerIds: providerContracts.providers.map((provider) => provider.providerId),
    proof: {
      algorithm: 'sha256',
      digest: hashProof(handoffProofPayload),
      signedFields: Object.keys(handoffProofPayload)
    }
  };
}

function buildAcceptanceAcknowledgementRequirements({
  acknowledgement,
  acceptable,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  validationSummary,
  routeCatalog
}) {
  const requirements = [];
  const pushRequirement = (requirement) => {
    requirements.push({
      sequence: requirements.length + 1,
      ...requirement
    });
  };

  if (acknowledgement === 'issuer_dependency_degraded') {
    pushRequirement({
      id: 'ack-issuer-degraded-mode',
      label: 'Acknowledge degraded issuer dependencies',
      state: issuerHealth.mode === 'degraded' ? 'required' : 'satisfied',
      required: issuerHealth.mode === 'degraded',
      blocking: false,
      route: routeCatalog.reviewRoute,
      explanation: 'The token can be accepted only after the client shows degraded issuer dependency context.',
      evidenceRefs: issuerHealth.incidents.map((incident) => incident.incidentKey),
      proofRefs: [issuerHealth.proof.digest]
    });
  }

  if (acceptable && providerContracts.negotiationState === 'sync_required') {
    pushRequirement({
      id: 'ack-provider-sync-before-acceptance',
      label: 'Review provider sync status',
      state: 'required',
      required: true,
      blocking: false,
      route: routeCatalog.providerSyncRoute,
      explanation: 'Provider sync must be refreshed or acknowledged before external handoff.',
      providerIds: providerContracts.providers
        .filter((provider) => provider.handoffState === 'sync_required')
        .map((provider) => provider.providerId),
      proofRefs: providerContracts.externalHandoff.serviceProofs.map((service) => service.proof)
    });
  }

  if (lifecycleControls.scheduling.enabled) {
    pushRequirement({
      id: 'ack-lifecycle-schedule',
      label: 'Confirm lifecycle schedule',
      state: lifecycleControls.state === 'blocked' ? 'blocked' : 'required',
      required: lifecycleControls.state !== 'blocked',
      blocking: lifecycleControls.state === 'blocked',
      route: lifecycleControls.state === 'blocked' ? routeCatalog.reviewRoute : routeCatalog.acceptanceRoute,
      explanation: 'Lifecycle scheduling is active and should be visible before accepting the token.',
      nextAction: lifecycleControls.scheduling.nextAction,
      nextRunAt: lifecycleControls.scheduling.nextRunAt,
      commandState: lifecycleControls.commandPlan.nextActionState,
      checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
      proofRefs: [lifecycleControls.commandPlan.proof.digest, lifecycleControls.proof.digest]
    });
  }

  for (const check of validationSummary.checks.filter((item) => item.state === 'warn')) {
    pushRequirement({
      id: `ack-validation-${check.id}`,
      label: `Review ${check.label.toLowerCase()}`,
      state: 'optional',
      required: false,
      blocking: false,
      route: check.id === 'provider-handoff' ? routeCatalog.providerSyncRoute : routeCatalog.reviewRoute,
      explanation: `The ${check.id} validation check has warnings that clients can display before acceptance.`,
      warningId: check.id
    });
  }

  const required = requirements.filter((requirement) => requirement.required);
  const blocked = requirements.filter((requirement) => requirement.blocking);

  return {
    contractVersion: 'capability-token.acceptance-acknowledgements.v1',
    state: blocked.length
      ? 'blocked'
      : required.length
        ? 'required'
        : requirements.length
          ? 'optional'
          : 'none',
    requiredCount: required.length,
    optionalCount: requirements.length - required.length,
    blockedCount: blocked.length,
    requirements,
    requiredIds: required.map((requirement) => requirement.id),
    digest: hashProof({
      schema: 'capability-token.acceptance-acknowledgements.v1',
      acknowledgement,
      acceptable,
      requirementStates: requirements.map((requirement) => [
        requirement.id,
        requirement.state,
        requirement.required,
        requirement.route
      ])
    })
  };
}

function buildAcceptanceDecision({
  issueState,
  errors,
  denials,
  validationSummary,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  clientRuntime,
  tokenId,
  expiresAt,
  proof
}) {
  const rejectReasons = uniqueSorted([
    ...errors.map((error) => error.code),
    ...denials.map((denial) => denial.code),
    ...validationSummary.blockingCodes
  ]);
  const issueTerminal = ACCEPTANCE_TERMINAL_ISSUE_STATES.has(issueState);
  const validationClear = validationSummary.failureCount === 0 && rejectReasons.length === 0;
  const lifecycleReady = lifecycleControls.state !== 'blocked' && lifecycleControls.canIssue;
  const acceptable = issueTerminal && validationClear && lifecycleReady;
  const routeCatalog = clientRuntime.routeCatalog || CLIENT_RUNTIME_DEFAULTS;
  const acknowledgement = ACCEPTANCE_ACKNOWLEDGEMENT_PRIORITY.find((candidate) => (
    candidate === 'issuer_dependency_degraded'
      ? issuerHealth.mode === 'degraded'
      : candidate === 'provider_sync_required'
        ? acceptable && providerContracts.negotiationState === 'sync_required'
        : candidate === 'lifecycle_schedule_active'
          ? lifecycleControls.scheduling.enabled
          : true
  )) || 'none';
  const targetRoute = !acceptable
    ? routeCatalog.reviewRoute
    : providerContracts.negotiationState === 'sync_required'
      ? routeCatalog.providerSyncRoute
      : routeCatalog.acceptanceRoute;
  const acceptanceState = acceptable
    ? providerContracts.negotiationState === 'sync_required'
      ? 'accept_after_provider_sync'
      : 'accept_enabled'
    : issueTerminal
      ? 'accept_blocked'
      : 'accept_disabled';
  const acknowledgementRequirements = buildAcceptanceAcknowledgementRequirements({
    acknowledgement,
    acceptable,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    validationSummary,
    routeCatalog
  });
  const proofPayload = {
    schema: 'capability-token.acceptance.v1',
    tokenId,
    issueState,
    acceptanceState,
    acceptable,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    targetRoute,
    acknowledgement,
    rejectReasons,
    providerNegotiationState: providerContracts.negotiationState,
    lifecycleCommand: lifecycleControls.command,
    lifecycleState: lifecycleControls.state,
    validationState: validationSummary.state,
    acknowledgementRequirementDigest: acknowledgementRequirements.digest,
    routeCatalogDigest: routeCatalog.digest || hashProof(routeCatalog),
    proofDigest: proof,
    expiresAt
  };

  return {
    contractVersion: 'capability-token.acceptance.v1',
    acceptable,
    acceptanceState,
    acceptAction: acceptable ? 'capability_token_accept' : null,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    handoffState: acceptable
      ? providerContracts.negotiationState === 'sync_required'
        ? 'provider_sync_required'
        : 'acceptance_ready'
      : 'blocked_for_review',
    targetRoute,
    rejectReasons,
    acknowledgement,
    acknowledgementRequirements,
    acknowledgementSummary: {
      state: acknowledgementRequirements.state,
      requiredCount: acknowledgementRequirements.requiredCount,
      optionalCount: acknowledgementRequirements.optionalCount,
      blockedCount: acknowledgementRequirements.blockedCount,
      requiredIds: acknowledgementRequirements.requiredIds,
      digest: acknowledgementRequirements.digest
    },
    routePolicy: {
      guard: acceptable ? 'allow_acceptance_route' : 'block_acceptance_route',
      targetRoute,
      fallbackRoute: routeCatalog.reviewRoute,
      requiredClientAction: acceptable
        ? providerContracts.negotiationState === 'sync_required'
          ? 'sync_providers_before_acceptance'
          : 'accept_capability_token'
        : 'review_blocking_reasons'
    },
    audit: {
      stream: 'aios.kernel.capability-token.acceptance',
      action: acceptable ? 'capability_token_acceptance_enabled' : 'capability_token_acceptance_blocked',
      state: acceptanceState,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function buildCapabilityTokenPreviewPacket({
  boundary,
  subjectId,
  roles,
  requestedPermissions,
  grantedPermissions,
  ttlSeconds,
  expiresAt,
  issueState,
  errors,
  denials,
  validationSummary,
  acceptanceDecision,
  readiness,
  workflowHandoff,
  nextSteps,
  clientRuntime,
  providerContracts,
  lifecycleControls,
  delegationPlan,
  securityGuard,
  proof
}) {
  const blockingChecks = validationSummary.checks.filter((check) => check.state === 'fail');
  const warningChecks = validationSummary.checks.filter((check) => check.state === 'warn');
  const primaryStep = nextSteps.find((step) => step.blocking)
    || nextSteps.find((step) => step.state === 'recommended')
    || nextSteps[0]
    || null;
  const routeCatalog = clientRuntime.routeCatalog || CLIENT_RUNTIME_DEFAULTS;
  const validationCards = validationSummary.checks.map((check) => ({
    id: check.id,
    label: check.label,
    state: check.state,
    blocking: check.blocking,
    routeHint: check.state === 'fail'
      ? routeCatalog.reviewRoute
      : check.id === 'provider-handoff' && providerContracts.externalHandoff.state !== 'ready'
        ? routeCatalog.providerSyncRoute
        : routeCatalog.acceptanceRoute
  }));
  const previewState = acceptanceDecision.acceptable
    ? providerContracts.externalHandoff.state === 'ready'
      ? 'ready_to_accept'
      : 'ready_after_provider_sync'
    : blockingChecks.length
      ? 'blocked'
      : warningChecks.length
        ? 'review_recommended'
        : 'not_ready';
  const cta = {
    id: acceptanceDecision.acceptable
      ? providerContracts.externalHandoff.state === 'ready'
        ? 'accept-capability-token'
        : 'sync-providers'
      : 'review-capability-token',
    label: acceptanceDecision.acceptable
      ? providerContracts.externalHandoff.state === 'ready'
        ? 'Accept capability token'
        : 'Sync providers'
      : 'Review capability token',
    enabled: true,
    route: workflowHandoff.targetRoute,
    guard: acceptanceDecision.routePolicy.guard,
    continuationRequired: Boolean(workflowHandoff.resumeEnvelope?.continuationId)
  };
  const proofPayload = {
    schema: 'capability-token.preview.v2',
    surfaceId,
    issueState,
    previewState,
    requestId: clientRuntime.requestId,
    targetRoute: workflowHandoff.targetRoute,
    readinessState: readiness.state,
    acceptanceState: acceptanceDecision.acceptanceState,
    validationState: validationSummary.state,
    blockingCodes: validationSummary.blockingCodes,
    primaryStepId: primaryStep?.id || null,
    delegationState: delegationPlan.state,
    delegationProof: delegationPlan.proof.digest,
    securityGuardState: securityGuard.state,
    securityGuardProof: securityGuard.proof.digest,
    proofDigest: proof
  };

  return {
    contractVersion: 'capability-token.preview.v2',
    issueState,
    previewState,
    statusLabel: acceptanceDecision.acceptable ? 'Ready to accept' : 'Action required',
    requestId: clientRuntime.requestId,
    subjectId: subjectId || null,
    roles,
    scope: {
      tenantId: boundary.tenantId,
      workspaceIds: boundary.workspaceIds,
      scopeKind: boundary.scopeKind,
      workspaceAccessState: boundary.workspaceAccess?.state || 'scoped',
      resourceBoundaryState: boundary.resourceBoundary?.state || 'not_requested',
      resourceCount: boundary.resourceBoundary?.resourceCount || 0,
      deniedResourceIds: boundary.resourceBoundary?.deniedResourceIds || [],
      delegationState: delegationPlan.state,
      delegationDepth: delegationPlan.depth,
      parentTokenId: delegationPlan.parent.tokenId,
      securityGuardState: securityGuard.state
    },
    permissionPreview: {
      requestedCount: requestedPermissions.length,
      grantedCount: grantedPermissions.length,
      deniedCount: Math.max(0, requestedPermissions.length - grantedPermissions.length),
      grantedPermissions
    },
    timing: {
      issuedState: issueState,
      expiresAt,
      ttlSeconds,
      lifecycleCommand: lifecycleControls.command,
      lifecycleNextAction: lifecycleControls.scheduling.nextAction
    },
    validationSnapshot: {
      state: validationSummary.state,
      passCount: validationSummary.passCount,
      warningCount: validationSummary.warningCount,
      failureCount: validationSummary.failureCount,
      blockingCodes: validationSummary.blockingCodes,
      cards: validationCards
    },
    acceptanceChecklist: {
      state: acceptanceDecision.acknowledgementSummary.state,
      requiredCount: acceptanceDecision.acknowledgementSummary.requiredCount,
      optionalCount: acceptanceDecision.acknowledgementSummary.optionalCount,
      blockedCount: acceptanceDecision.acknowledgementSummary.blockedCount,
      requiredIds: acceptanceDecision.acknowledgementSummary.requiredIds,
      requirements: acceptanceDecision.acknowledgementRequirements.requirements.map((requirement) => ({
        id: requirement.id,
        sequence: requirement.sequence,
        label: requirement.label,
        state: requirement.state,
        required: requirement.required,
        blocking: requirement.blocking,
        route: requirement.route,
        explanation: requirement.explanation,
        providerIds: requirement.providerIds || [],
        evidenceRefs: requirement.evidenceRefs || [],
        proofRefs: requirement.proofRefs || []
      })),
      digest: acceptanceDecision.acknowledgementSummary.digest
    },
    acceptanceCta: cta,
    routeDestinations: {
      activeRoute: clientRuntime.activeRoute,
      targetRoute: workflowHandoff.targetRoute,
      returnRoute: workflowHandoff.returnRoute,
      acceptanceRoute: routeCatalog.acceptanceRoute,
      reviewRoute: routeCatalog.reviewRoute,
      providerSyncRoute: routeCatalog.providerSyncRoute
    },
    readinessBadges: {
      readinessState: readiness.state,
      providerHandoffState: readiness.providerHandoffState,
      routeGuard: readiness.routeGuard,
      canAccept: readiness.canAccept,
      canResumeClientWorkflow: readiness.canResumeClientWorkflow,
      delegationState: delegationPlan.state,
      securityGuardState: securityGuard.state
    },
    delegation: {
      requested: delegationPlan.requested,
      state: delegationPlan.state,
      mode: delegationPlan.mode,
      parentTokenId: delegationPlan.parent.tokenId,
      depth: delegationPlan.depth,
      maxDepth: delegationPlan.maxDepth,
      auditReferenceCount: delegationPlan.auditReferences.length,
      denialCodes: delegationPlan.denials.map((denial) => denial.code),
      warningCodes: delegationPlan.warnings.map((warning) => warning.code),
      proof: delegationPlan.proof.digest
    },
    securityGuard: {
      state: securityGuard.state,
      requestSealed: securityGuard.requestSealed,
      requestNonce: securityGuard.requestNonce,
      requestFreshnessState: securityGuard.requestFreshness?.state || 'unobserved',
      requestFresh: securityGuard.requestFresh,
      requestFreshnessProof: securityGuard.requestFreshness?.proof?.digest || null,
      revocationMatchCount: securityGuard.registry.revocationMatchCount,
      replayMatchCount: securityGuard.registry.replayMatchCount,
      denialCodes: securityGuard.denials.map((denial) => denial.code),
      proof: securityGuard.proof.digest
    },
    primaryNextStep: primaryStep,
    warningCount: validationSummary.warningCount,
    errorCount: errors.length + denials.length + validationSummary.failureCount,
    proofDigest: proof,
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function buildOperatorHandoffPackage({
  preview,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  workflowHandoff,
  clientRuntime,
  providerContracts,
  lifecycleControls,
  delegationPlan,
  securityGuard,
  tokenId,
  proof,
  expiresAt
}) {
  const blockingSteps = nextSteps.filter((step) => step.blocking);
  const recommendedSteps = nextSteps.filter((step) => step.state === 'recommended');
  const requiredAcknowledgements = acceptance.acknowledgementRequirements.requirements
    .filter((requirement) => requirement.required || requirement.blocking);
  const visibleSteps = [
    ...blockingSteps,
    ...recommendedSteps,
    ...nextSteps.filter((step) => step.state === 'available')
  ].slice(0, 8);
  const primaryStep = blockingSteps[0]
    || requiredAcknowledgements[0]
    || recommendedSteps[0]
    || nextSteps[0]
    || null;
  const state = validationSummary.failureCount
    ? 'blocked'
    : acceptance.handoffState === 'provider_sync_required'
      ? 'provider_sync_required'
      : acceptance.acceptable && readiness.canResumeClientWorkflow
        ? 'resume_ready'
        : acceptance.acceptable
          ? 'acceptance_ready'
          : 'review_required';
  const actionId = primaryStep?.id
    || acceptance.acceptAction
    || workflowHandoff.visibleAction?.id
    || 'review-capability-token';
  const route = primaryStep?.route
    || primaryStep?.nextActionRoute
    || workflowHandoff.targetRoute
    || acceptance.targetRoute;
  const routeStatePatch = {
    schema: 'capability-token.client-route-state-patch.v1',
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workflowId: clientRuntime.workflowId,
    continuationId: clientRuntime.continuationId,
    handoffState: workflowHandoff.handoffState,
    acceptanceState: acceptance.acceptanceState,
    readinessState: readiness.state,
    routeGuard: readiness.routeGuard,
    targetRoute: route,
    returnRoute: workflowHandoff.returnRoute,
    tokenId,
    proofDigest: proof,
    expiresAt,
    replayProtection: {
      requestSealed: securityGuard.requestSealed,
      requestFreshnessState: securityGuard.requestFreshness?.state || 'unobserved',
      requestFresh: securityGuard.requestFresh
    },
    lifecycle: {
      command: lifecycleControls.command,
      state: lifecycleControls.state,
      checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
      nextAction: lifecycleControls.scheduling.nextAction
    }
  };
  const proofPayload = {
    schema: 'capability-token.operator-handoff.v1',
    requestId: clientRuntime.requestId,
    tokenId,
    state,
    actionId,
    route,
    proofDigest: proof,
    previewProof: preview.proof.digest,
    acceptanceProof: acceptance.proof.digest,
    workflowProof: workflowHandoff.proof.digest,
    validationState: validationSummary.state,
    validationBlockingCodes: validationSummary.blockingCodes,
    acknowledgementIds: requiredAcknowledgements.map((requirement) => requirement.id),
    visibleStepIds: visibleSteps.map((step) => step.id),
    providerNegotiationState: providerContracts.negotiationState,
    lifecycleState: lifecycleControls.state,
    delegationState: delegationPlan.state,
    securityGuardState: securityGuard.state
  };

  return {
    contractVersion: 'capability-token.operator-handoff.v1',
    state,
    requestId: clientRuntime.requestId,
    tokenId,
    action: {
      id: actionId,
      label: primaryStep?.label || workflowHandoff.visibleAction?.label || 'Review capability token',
      route,
      enabled: workflowHandoff.visibleAction?.enabled !== false,
      blocking: Boolean(primaryStep?.blocking),
      retryable: !validationSummary.failureCount || providerContracts.negotiationState === 'sync_required',
      continuationRequired: workflowHandoff.visibleAction?.continuationRequired === true
    },
    display: {
      statusLabel: preview.statusLabel,
      previewState: preview.previewState,
      readinessState: readiness.state,
      acceptanceState: acceptance.acceptanceState,
      providerHandoffState: readiness.providerHandoffState,
      routeGuard: readiness.routeGuard,
      warningCount: validationSummary.warningCount,
      failureCount: validationSummary.failureCount
    },
    blockers: blockingSteps.map((step) => ({
      id: step.id,
      label: step.label,
      source: step.source || null,
      explanation: step.explanation,
      route: step.route || step.nextActionRoute || workflowHandoff.targetRoute,
      reasonCodes: step.reasonCodes || step.denialCodes || []
    })),
    acknowledgements: requiredAcknowledgements.map((requirement) => ({
      id: requirement.id,
      label: requirement.label,
      state: requirement.state,
      route: requirement.route,
      required: requirement.required,
      blocking: requirement.blocking,
      proofRefs: requirement.proofRefs || [],
      evidenceRefs: requirement.evidenceRefs || []
    })),
    visibleSteps,
    routeStatePatch,
    auditRefs: uniqueSorted([
      preview.proof.digest,
      acceptance.proof.digest,
      workflowHandoff.proof.digest,
      readiness.health.proofDigest,
      delegationPlan.proof.digest,
      securityGuard.proof.digest
    ]),
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function normalizePersistedCommand(record, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const command = normalizeLifecycleCommand(record);
  const requestId = firstNonEmptyString(record.requestId, record.clientRequestId, record.clientRuntime?.requestId);
  const idempotencyKey = firstNonEmptyString(
    record.idempotencyKey,
    record.commandId,
    record.operationId,
    requestId && command ? `capcmd_${hashProof({ requestId, command }).slice(0, 20)}` : ''
  );

  if (!idempotencyKey) {
    return null;
  }

  const state = asNonEmptyString(record.state || record.status || record.outcome).toLowerCase();
  const observedAt = normalizeOperationalTimestamp(record.observedAt || record.updatedAt || record.committedAt || record.createdAt);

  return {
    sequence: Number.isInteger(record.sequence) ? record.sequence : index + 1,
    idempotencyKey,
    command,
    state: PERSISTED_COMMAND_STATES.has(state) ? state : 'pending',
    requestId: requestId || null,
    tokenId: asNonEmptyString(record.tokenId || record.token?.id) || null,
    proofDigest: asNonEmptyString(record.proofDigest || record.proof?.digest || record.auditProof) || null,
    observedAt,
    replayCount: normalizeFailureCount(record.replayCount || record.replays),
    errorCode: asNonEmptyString(record.errorCode || record.code) || null
  };
}

function normalizePersistedCapabilityTokenState(input = {}) {
  const source = input.persistedState
    || input.capabilityTokenState
    || input.recoveredState
    || input.state?.capabilityToken
    || {};
  const checkpointState = asNonEmptyString(source.checkpointState || source.state || source.status).toLowerCase();
  const rawCommands = Array.isArray(source.commands)
    ? source.commands
    : Array.isArray(source.commandLog)
      ? source.commandLog
      : Array.isArray(input.commandLog)
        ? input.commandLog
        : [];
  const commands = rawCommands
    .map((record, index) => normalizePersistedCommand(record, index))
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence || left.idempotencyKey.localeCompare(right.idempotencyKey));
  const lastCheckpointAt = normalizeOperationalTimestamp(
    source.lastCheckpointAt || source.checkpointedAt || source.updatedAt || source.persistedAt
  );

  return {
    checkpointState: PERSISTED_CHECKPOINT_STATES.has(checkpointState) ? checkpointState : 'unknown',
    generation: normalizeFailureCount(source.generation || source.revision || source.version),
    lastCheckpointAt,
    recoveredTokenId: asNonEmptyString(source.tokenId || source.token?.id) || null,
    recoveredProofDigest: asNonEmptyString(source.proofDigest || source.proof?.digest) || null,
    commands
  };
}

function commandTerminal(record) {
  return record && ['committed', 'applied'].includes(record.state);
}

function commandMatchesCurrentIssue(record, tokenId, proof) {
  return Boolean(record && (record.tokenId === tokenId || record.proofDigest === proof));
}

function latestTerminalCommand(commands, command, requestId) {
  return commands
    .filter((record) => (
      commandTerminal(record)
        && record.command === command
        && (!requestId || !record.requestId || record.requestId === requestId)
    ))
    .sort((left, right) => (
      Date.parse(right.observedAt || 0) - Date.parse(left.observedAt || 0)
        || right.sequence - left.sequence
    ))[0] || null;
}

function buildCheckpointRecoveryPlan({
  persisted,
  commandLedger,
  command,
  requestId,
  tokenId,
  proof,
  issueState,
  acceptanceDecision,
  readiness,
  lifecycleControls,
  now
}) {
  const terminalCommand = commandLedger.replayMatch
    || latestTerminalCommand(persisted.commands, command, requestId);
  const recoveredAnchorMatchesCurrent = Boolean(
    (persisted.recoveredTokenId && persisted.recoveredTokenId === tokenId)
      || (persisted.recoveredProofDigest && persisted.recoveredProofDigest === proof)
  );
  const checkpointRequiresAnchorMatch = ['dirty', 'recovering'].includes(persisted.checkpointState)
    || Boolean(commandLedger.selectedCommand);
  const recoveredAnchorConflicts = Boolean(
    checkpointRequiresAnchorMatch
      && (
        (persisted.recoveredTokenId && persisted.recoveredTokenId !== tokenId)
          || (persisted.recoveredProofDigest && persisted.recoveredProofDigest !== proof)
      )
  );
  const terminalCommandConflicts = Boolean(
    terminalCommand
      && terminalCommand.tokenId
      && terminalCommand.proofDigest
      && terminalCommand.tokenId !== tokenId
      && terminalCommand.proofDigest !== proof
  );
  const blockingCodes = [
    ...commandLedger.conflicts.map((conflict) => conflict.code),
    ...(recoveredAnchorConflicts ? ['checkpoint_anchor_mismatch'] : []),
    ...(terminalCommandConflicts ? ['terminal_command_anchor_mismatch'] : [])
  ];
  const restartCommand = blockingCodes.length
    ? 'hold_for_operator_review'
    : commandLedger.replayMatch
      ? 'return_committed_result'
      : persisted.checkpointState === 'dirty'
        ? recoveredAnchorMatchesCurrent || terminalCommand
          ? 'rebuild_checkpoint_from_committed_anchor'
          : 'rebuild_checkpoint_from_audit_handoff'
        : persisted.checkpointState === 'recovering'
          ? 'continue_checkpoint_recovery'
          : persisted.checkpointState === 'clean' && recoveredAnchorMatchesCurrent
            ? 'resume_from_clean_checkpoint'
            : issueState === 'failed'
              ? 'record_failed_attempt'
              : 'write_new_checkpoint';
  const status = blockingCodes.length
    ? 'blocked'
    : restartCommand === 'return_committed_result' || restartCommand === 'resume_from_clean_checkpoint'
      ? 'stable'
      : restartCommand === 'write_new_checkpoint'
        ? 'checkpoint_pending'
        : restartCommand === 'record_failed_attempt'
          ? 'retryable_after_audit'
          : 'recovery_required';
  const canResumeAcceptance = acceptanceDecision.acceptable
    && !blockingCodes.length
    && ['stable', 'checkpoint_pending'].includes(status);
  const resumeMode = commandLedger.replayMatch
    ? 'idempotent_result'
    : recoveredAnchorMatchesCurrent
      ? 'checkpoint_anchor'
      : terminalCommand
        ? 'terminal_command_anchor'
        : 'new_issue';
  const recoveryEdges = [
    {
      from: persisted.checkpointState,
      to: restartCommand === 'write_new_checkpoint'
        ? 'clean_after_checkpoint_write'
        : restartCommand === 'return_committed_result' || restartCommand === 'resume_from_clean_checkpoint'
          ? 'clean'
          : restartCommand === 'hold_for_operator_review'
            ? 'quarantined'
            : 'recovering',
      command: restartCommand,
      blocking: blockingCodes.length > 0
    },
    {
      from: lifecycleControls.commandPlan.nextActionState,
      to: readiness.state,
      command: canResumeAcceptance ? 'resume_acceptance' : 'defer_acceptance_until_recovery',
      blocking: !canResumeAcceptance
    }
  ];
  const anchor = {
    recoveredTokenId: persisted.recoveredTokenId,
    recoveredProofDigest: persisted.recoveredProofDigest,
    currentTokenId: tokenId,
    currentProofDigest: proof,
    terminalCommandKey: terminalCommand?.idempotencyKey || null,
    terminalCommandState: terminalCommand?.state || null,
    terminalCommandObservedAt: terminalCommand?.observedAt || null
  };
  const proofPayload = {
    schema: 'capability-token.checkpoint-recovery-plan.v1',
    surfaceId,
    command,
    requestId,
    checkpointState: persisted.checkpointState,
    generation: persisted.generation,
    anchor,
    restartCommand,
    status,
    resumeMode,
    recoveryEdges,
    blockingCodes,
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.checkpoint-recovery-plan.v1',
    status,
    restartCommand,
    resumeMode,
    canResumeAcceptance,
    anchor,
    blockingCodes,
    recoveryEdges,
    auditReferences: [
      persisted.recoveredProofDigest && {
        type: 'recovered-checkpoint-proof',
        digest: persisted.recoveredProofDigest,
        tokenId: persisted.recoveredTokenId
      },
      terminalCommand?.proofDigest && {
        type: 'terminal-command-proof',
        digest: terminalCommand.proofDigest,
        tokenId: terminalCommand.tokenId,
        idempotencyKey: terminalCommand.idempotencyKey
      },
      {
        type: 'current-issue-proof',
        digest: proof,
        tokenId
      }
    ].filter(Boolean),
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function buildPersistedCommandLedger({ persisted, idempotencyKey, command, requestId, tokenId, proof, now }) {
  const matchingKeyCommands = persisted.commands.filter((record) => record.idempotencyKey === idempotencyKey);
  const sameRequestCommands = persisted.commands.filter((record) => (
    record.requestId
      && requestId
      && record.requestId === requestId
      && record.command === command
      && record.idempotencyKey !== idempotencyKey
  ));
  const duplicateKeys = [...new Set(
    persisted.commands
      .map((record) => record.idempotencyKey)
      .filter((key, index, keys) => key && keys.indexOf(key) !== index)
  )].sort();
  const terminalMatches = [...matchingKeyCommands, ...sameRequestCommands]
    .filter(commandTerminal)
    .filter((record, index, records) => (
      records.findIndex((candidate) => candidate.idempotencyKey === record.idempotencyKey) === index
    ));
  const replayMatch = terminalMatches.find((record) => commandMatchesCurrentIssue(record, tokenId, proof)) || null;
  const conflicts = terminalMatches
    .filter((record) => !commandMatchesCurrentIssue(record, tokenId, proof))
    .map((record) => ({
      code: record.idempotencyKey === idempotencyKey
        ? 'idempotency_key_reused_for_different_token'
        : 'request_command_already_committed_with_different_key',
      idempotencyKey: record.idempotencyKey,
      command: record.command,
      requestId: record.requestId,
      tokenId: record.tokenId,
      proofDigest: record.proofDigest,
      observedAt: record.observedAt,
      state: record.state
    }));
  const selectedCommand = replayMatch || matchingKeyCommands.at(-1) || sameRequestCommands.at(-1) || null;
  const journal = [
    {
      step: 'load_checkpoint',
      state: persisted.checkpointState,
      checkpointGeneration: persisted.generation,
      observedAt: persisted.lastCheckpointAt,
      action: persisted.checkpointState === 'dirty'
        ? 'rebuild_checkpoint_from_audit_handoff'
        : persisted.checkpointState === 'recovering'
          ? 'continue_checkpoint_recovery'
          : 'validate_checkpoint_digest'
    },
    {
      step: 'dedupe_command',
      state: conflicts.length
        ? 'conflict'
        : replayMatch
          ? 'replay_match'
          : matchingKeyCommands.length
            ? 'known_command'
            : 'new_command',
      idempotencyKey,
      requestId,
      command,
      observedCommandCount: matchingKeyCommands.length,
      sameRequestCommandCount: sameRequestCommands.length,
      duplicateKeyCount: duplicateKeys.length,
      action: conflicts.length
        ? 'quarantine_conflicting_command_records'
        : replayMatch
          ? 'return_persisted_terminal_result'
          : 'append_pending_command_record'
    },
    {
      step: 'shape_restart_snapshot',
      state: conflicts.length
        ? 'blocked'
        : replayMatch
          ? 'stable'
          : 'pending_checkpoint',
      tokenId,
      proofDigest: proof,
      generatedAt: now,
      action: conflicts.length
        ? 'require_operator_review_before_resume'
        : replayMatch
          ? 'resume_without_mutation'
          : 'persist_snapshot_before_acceptance'
    }
  ];

  return {
    contractVersion: 'capability-token.persisted-command-ledger.v1',
    commandCount: persisted.commands.length,
    duplicateKeys,
    matchingKeyCommands,
    sameRequestCommands,
    selectedCommand,
    replayMatch,
    conflicts,
    journal,
    digest: hashProof({
      schema: 'capability-token.persisted-command-ledger.v1',
      idempotencyKey,
      command,
      requestId,
      duplicateKeys,
      selectedCommand: selectedCommand
        ? {
            idempotencyKey: selectedCommand.idempotencyKey,
            state: selectedCommand.state,
            tokenId: selectedCommand.tokenId,
            proofDigest: selectedCommand.proofDigest
          }
        : null,
      conflictCodes: conflicts.map((conflict) => conflict.code),
      journalStates: journal.map((entry) => [entry.step, entry.state])
    })
  };
}

function buildStatePersistenceRecovery({
  input,
  now,
  tokenId,
  issueState,
  expiresAt,
  proof,
  clientRuntime,
  boundary,
  subjectId,
  lifecycleControls,
  acceptanceDecision,
  readiness
}) {
  const persisted = normalizePersistedCapabilityTokenState(input);
  const command = lifecycleControls.command;
  const idempotencyKey = firstNonEmptyString(
    input.idempotencyKey,
    input.commandId,
    input.operationId,
    `capcmd_${hashProof({
      surfaceId,
      requestId: clientRuntime.requestId,
      command,
      tenantId: boundary.tenantId,
      subjectId: subjectId || null,
      workspaceIds: boundary.workspaceIds
    }).slice(0, 24)}`
  );
  const commandLedger = buildPersistedCommandLedger({
    persisted,
    idempotencyKey,
    command,
    requestId: clientRuntime.requestId,
    tokenId,
    proof,
    now
  });
  const matchingCommand = commandLedger.selectedCommand;
  const replayedTerminalCommand = commandLedger.replayMatch;
  const staleReplay = commandLedger.conflicts.length > 0;
  const recoveryPlan = buildCheckpointRecoveryPlan({
    persisted,
    commandLedger,
    command,
    requestId: clientRuntime.requestId,
    tokenId,
    proof,
    issueState,
    acceptanceDecision,
    readiness,
    lifecycleControls,
    now
  });
  const needsCheckpoint = !replayedTerminalCommand && issueState !== 'failed';
  const recoveryState = staleReplay
    ? 'conflict_requires_review'
    : replayedTerminalCommand
      ? 'idempotent_replay'
      : recoveryPlan.status === 'blocked'
        ? 'checkpoint_recovery_blocked'
        : recoveryPlan.restartCommand === 'rebuild_checkpoint_from_committed_anchor'
          ? 'recover_checkpoint_from_committed_anchor'
          : recoveryPlan.restartCommand === 'continue_checkpoint_recovery'
            ? 'continue_checkpoint_recovery'
      : persisted.checkpointState === 'dirty'
        ? 'recover_checkpoint_before_acceptance'
        : needsCheckpoint
          ? 'checkpoint_required'
          : 'audit_only';
  const restartSafeStatus = replayedTerminalCommand
    ? 'stable_replay'
    : acceptanceDecision.acceptable && !staleReplay && persisted.checkpointState !== 'dirty'
      ? 'safe_after_checkpoint'
      : issueState === 'failed'
        ? 'safe_to_retry_after_recovery'
        : 'review_before_resume';
  const proofPayload = {
    schema: 'capability-token.state-persistence.v1',
    surfaceId,
    tokenId,
    issueState,
    idempotencyKey,
    command,
    requestId: clientRuntime.requestId,
    persistedGeneration: persisted.generation,
    checkpointState: persisted.checkpointState,
    recoveryState,
    restartSafeStatus,
    recoveryPlanStatus: recoveryPlan.status,
    recoveryPlanCommand: recoveryPlan.restartCommand,
    recoveryPlanProof: recoveryPlan.proof.digest,
    matchingCommandState: matchingCommand?.state || null,
    lifecycleCommandState: lifecycleControls.commandPlan.nextActionState,
    lifecycleCheckpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
    ledgerDigest: commandLedger.digest,
    conflictCodes: commandLedger.conflicts.map((conflict) => conflict.code),
    proofDigest: proof,
    generatedAt: now
  };

  return {
    contractVersion: 'capability-token.state-persistence.v1',
    idempotency: {
      key: idempotencyKey,
      command,
      replayed: Boolean(replayedTerminalCommand),
      conflict: Boolean(staleReplay),
      matchedCommand: matchingCommand
        ? {
            idempotencyKey: matchingCommand.idempotencyKey,
            state: matchingCommand.state,
            tokenId: matchingCommand.tokenId,
            proofDigest: matchingCommand.proofDigest,
            observedAt: matchingCommand.observedAt,
            replayCount: matchingCommand.replayCount
        }
        : null
    },
    commandLedger: {
      contractVersion: commandLedger.contractVersion,
      commandCount: commandLedger.commandCount,
      duplicateKeys: commandLedger.duplicateKeys,
      matchingKeyCount: commandLedger.matchingKeyCommands.length,
      sameRequestCommandCount: commandLedger.sameRequestCommands.length,
      selectedCommandKey: commandLedger.selectedCommand?.idempotencyKey || null,
      conflictCount: commandLedger.conflicts.length,
      conflicts: commandLedger.conflicts,
      recoveryJournal: commandLedger.journal,
      digest: commandLedger.digest
    },
    checkpoint: {
      state: persisted.checkpointState,
      generation: persisted.generation,
      lastCheckpointAt: persisted.lastCheckpointAt,
      nextState: recoveryPlan.restartCommand === 'write_new_checkpoint'
        ? 'write_checkpoint'
        : recoveryPlan.restartCommand === 'resume_from_clean_checkpoint'
          ? 'reuse_clean_checkpoint'
          : recoveryPlan.restartCommand === 'return_committed_result'
            ? 'reuse_committed_command'
            : recoveryPlan.status === 'blocked'
              ? 'quarantine_checkpoint'
              : needsCheckpoint
                ? 'recover_then_write_checkpoint'
                : 'no_checkpoint_write',
      lifecycleIntent: lifecycleControls.commandPlan.checkpoint.intent,
      lifecycleCommandState: lifecycleControls.commandPlan.nextActionState,
      tokenId,
      expiresAt,
      proofDigest: proof
    },
    recoveryPlan,
    recovery: {
      state: recoveryState,
      restartSafeStatus,
      canResumeAcceptance: recoveryPlan.canResumeAcceptance && !staleReplay,
      canReplayWithoutMutation: Boolean(replayedTerminalCommand),
      requiredAction: staleReplay
        ? 'review_idempotency_conflict'
        : recoveryPlan.status === 'blocked'
          ? 'review_checkpoint_recovery_conflict'
          : recoveryPlan.restartCommand
            ? recoveryPlan.restartCommand
        : persisted.checkpointState === 'dirty'
          ? 'rebuild_checkpoint_from_audit_handoff'
          : needsCheckpoint
            ? 'persist_capability_token_checkpoint'
            : 'record_failed_issue_for_audit'
    },
    persistedSnapshot: {
      schema: 'capability-token.persisted-snapshot.v2',
      tokenId,
      tenantId: boundary.tenantId,
      subjectId: subjectId || null,
      workspaceIds: boundary.workspaceIds,
      issueState,
      readinessState: readiness.state,
      acceptanceState: acceptanceDecision.acceptanceState,
      command,
      idempotencyKey,
      proofDigest: proof,
      expiresAt,
      checkpointGeneration: persisted.generation + (recoveryPlan.restartCommand === 'write_new_checkpoint' ? 1 : 0),
      restartSafeStatus,
      recoveryPlanDigest: recoveryPlan.proof.digest,
      auditReferences: recoveryPlan.auditReferences
    },
    audit: {
      stream: 'aios.kernel.capability-token.state-persistence',
      action: recoveryState,
      state: restartSafeStatus,
      proof: hashProof(proofPayload)
    },
    proof: {
      algorithm: 'sha256',
      digest: hashProof(proofPayload),
      signedFields: Object.keys(proofPayload)
    }
  };
}

function buildCapabilityTokenClientContract({
  boundary,
  subjectId,
  roles,
  requestedPermissions,
  grantedPermissions,
  ttlSeconds,
  expiresAt,
  issueState,
  errors,
  denials,
  issuerHealth,
  providerContracts,
  lifecycleControls,
  proof,
  retry,
  clientRuntime,
  tokenId,
  resourceBoundary,
  delegationPlan,
  securityGuard
}) {
  const validationSummary = summarizeCapabilityTokenValidation({
    boundary,
    subjectId,
    requestedPermissions,
    grantedPermissions,
    errors,
    denials,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    clientRuntime,
    resourceBoundary,
    delegationPlan,
    securityGuard
  });
  const acceptanceDecision = buildAcceptanceDecision({
    issueState,
    errors,
    denials,
    validationSummary,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    clientRuntime,
    tokenId,
    expiresAt,
    proof
  });
  const workflowHandoff = buildClientWorkflowHandoff({
    clientRuntime,
    boundary,
    subjectId,
    roles,
    grantedPermissions,
    tokenId,
    expiresAt,
    issueState,
    acceptable: acceptanceDecision.acceptable,
    validationSummary,
    providerContracts,
    lifecycleControls,
    resourceBoundary,
    delegationPlan,
    securityGuard,
    proof
  });
  const nextSteps = buildCapabilityTokenNextSteps({
    issueState,
    validationSummary,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    retry,
    workflowHandoff,
    securityGuard
  });
  const readinessState = !acceptanceDecision.acceptable
    ? 'blocked'
    : providerContracts.negotiationState === 'sync_required'
      ? 'ready_after_provider_sync'
      : issuerHealth.mode === 'degraded'
        ? 'ready_with_warnings'
        : 'ready';
  const readiness = {
    contractVersion: 'capability-token.readiness.v1',
    state: readinessState,
    canIssue: issuerHealth.canIssueToken && lifecycleControls.canIssue,
    canAccept: acceptanceDecision.acceptable,
    canDispatchProviderHandoff: acceptanceDecision.acceptable && providerContracts.externalHandoff.state === 'ready',
    canResumeClientWorkflow: workflowHandoff.resumeEnvelope !== null,
    canScheduleLifecycleAction: lifecycleControls.scheduling.enabled && lifecycleControls.state !== 'blocked',
    lifecycleCommandState: lifecycleControls.commandPlan.nextActionState,
    lifecycleCheckpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
    providerHandoffState: providerContracts.externalHandoff.state,
    routeGuard: acceptanceDecision.routePolicy.guard,
    health: {
      mode: issuerHealth.mode,
      telemetry: issuerHealth.telemetry,
      recoveryState: issuerHealth.recovery.state,
      incidentCount: issuerHealth.recovery.incidentCount,
      proofDigest: issuerHealth.proof.digest
    },
    retry
  };
  const preview = buildCapabilityTokenPreviewPacket({
    boundary,
    subjectId,
    roles,
    requestedPermissions,
    grantedPermissions,
    ttlSeconds,
    expiresAt,
    issueState,
    errors,
    denials,
    validationSummary,
    acceptanceDecision,
    readiness,
    workflowHandoff,
    nextSteps,
    clientRuntime,
    providerContracts,
    lifecycleControls,
    delegationPlan,
    securityGuard,
    proof
  });
  const operatorHandoff = buildOperatorHandoffPackage({
    preview,
    acceptance: acceptanceDecision,
    readiness,
    validationSummary,
    nextSteps,
    workflowHandoff,
    clientRuntime,
    providerContracts,
    lifecycleControls,
    delegationPlan,
    securityGuard,
    tokenId,
    proof,
    expiresAt
  });

  return {
    preview,
    operatorHandoff,
    clientRuntime,
    acceptance: {
      ...acceptanceDecision,
      handoffState: workflowHandoff.handoffState,
      targetRoute: workflowHandoff.targetRoute
    },
    readiness,
    lifecycleControls,
    delegationPlan,
    securityGuard,
    workflowHandoff,
    validationSummary,
    nextSteps
  };
}

function normalizeIssuedAt(value) {
  const issuedAt = asNonEmptyString(value);
  if (issuedAt && Number.isFinite(Date.parse(issuedAt))) {
    return issuedAt;
  }

  return new Date().toISOString();
}

export function buildCapabilityTokenContract(input = {}) {
  const now = normalizeIssuedAt(input.now);
  const evidenceBundle = normalizeEvidenceBundle(input);
  const tenantId = asNonEmptyString(input.tenantId || input.tenant?.id);
  const subjectId = asNonEmptyString(input.subjectId || input.subject?.id || input.principalId);
  const targetTenantId = asNonEmptyString(input.targetTenantId || input.resource?.tenantId || tenantId);
  const requestedTargetWorkspaceIds = normalizeWorkspaceIds(input);
  const { roles, unknownRoles } = normalizeRoles(input);
  const rolePermissions = permissionsForRoles(roles);
  const requestedPermissions = normalizeStringList(input.requestedPermissions || input.permissions);
  const effectiveRequest = requestedPermissions.length ? requestedPermissions : rolePermissions;
  const requestedWorkspaceId = asNonEmptyString(input.requestedWorkspaceId || input.resource?.workspaceId);
  const ttlSeconds = normalizeTtlSeconds(input);
  const issuerHealth = assessIssuerHealth({ ...input, now });
  const lifecycleControls = buildLifecycleControls({ input, ttlSeconds, now, issuerHealth });
  const errors = [];
  const denials = [];

  if (!tenantId) {
    errors.push({ code: 'tenant_required', message: 'Capability tokens require an owning tenant boundary.' });
  }

  if (!subjectId) {
    errors.push({ code: 'subject_required', message: 'Capability tokens require a subject or principal id.' });
  }

  for (const failure of issuerHealth.failures) {
    errors.push(failure);
  }

  for (const lifecycleError of lifecycleControls.settings.errors) {
    errors.push(lifecycleError);
  }

  for (const lifecycleDenial of lifecycleControls.denials) {
    denials.push(lifecycleDenial);
  }

  for (const role of unknownRoles) {
    denials.push({
      code: 'unknown_role',
      role,
      message: 'Unknown roles are not eligible for capability token grants.'
    });
  }

  if (targetTenantId && tenantId && targetTenantId !== tenantId) {
    denials.push({
      code: 'cross_tenant_denied',
      requestedTenantId: targetTenantId,
      owningTenantId: tenantId,
      message: 'Capability token requests cannot cross tenant boundaries.'
    });
  }

  const workspaceAccess = buildWorkspaceAccessPlan({
    input,
    tenantId,
    workspaceIds: requestedTargetWorkspaceIds,
    requestedWorkspaceId,
    permissions: effectiveRequest,
    issuedAt: now
  });
  const targetWorkspaceIds = workspaceAccess.workspaceIds;

  if (requestedWorkspaceId && !targetWorkspaceIds.length) {
    denials.push({
      code: 'workspace_scope_required',
      requestedWorkspaceId,
      message: 'Workspace-bound requests require an explicit workspace allowlist.'
    });
  }

  if (requestedWorkspaceId && targetWorkspaceIds.length && !targetWorkspaceIds.includes(requestedWorkspaceId)) {
    denials.push({
      code: 'workspace_out_of_scope',
      requestedWorkspaceId,
      allowedWorkspaceIds: targetWorkspaceIds,
      message: 'Requested workspace is outside this token scope.'
    });
  }

  for (const denial of workspaceAccess.denials) {
    denials.push(denial);
  }

  const permissionBoundary = buildPermissionBoundaryDecision({
    roles,
    rolePermissions,
    requestedPermissions: uniqueSorted(effectiveRequest),
    workspaceAccess,
    tenantId,
    subjectId,
    issuedAt: now
  });

  for (const denial of permissionBoundary.denials) {
    denials.push(denial);
  }

  const resourceBoundary = buildResourceBoundaryPlan({
    input,
    tenantId,
    requestedWorkspaceId,
    workspaceAccess,
    permissionBoundary
  });

  for (const denial of resourceBoundary.denials) {
    denials.push(denial);
  }

  const boundary = {
    tenantId: tenantId || null,
    workspaceIds: targetWorkspaceIds,
    requestedWorkspaceId: requestedWorkspaceId || null,
    scopeKind: targetWorkspaceIds.length ? 'workspace-allowlist' : 'tenant-only',
    isolationMode: 'strict-tenant',
    crossTenantAllowed: false,
    permissionMode: requestedPermissions.length ? 'requested-subset' : 'role-defaults',
    workspaceAccess: {
      contractVersion: workspaceAccess.contractVersion,
      workspaceBoundPermissions: workspaceAccess.workspaceBoundPermissions,
      effectiveWorkspacePermissions: workspaceAccess.effectiveWorkspacePermissions,
      grantPolicy: workspaceAccess.grantPolicy,
      grantCount: workspaceAccess.grants.length,
      deniedGrantCount: workspaceAccess.denials.length,
      state: workspaceAccess.denials.length ? 'blocked' : 'scoped',
      denialCodes: uniqueSorted(workspaceAccess.denials.map((denial) => denial.code)),
      isolationProof: workspaceAccess.isolationProof
    },
    permissionBoundary: {
      contractVersion: permissionBoundary.contractVersion,
      grantPolicy: permissionBoundary.grantPolicy,
      requestedPermissions: permissionBoundary.requestedPermissions,
      grantedPermissions: permissionBoundary.grantedPermissions,
      deniedPermissions: permissionBoundary.deniedPermissions,
      permissionScopes: permissionBoundary.permissionScopes,
      state: permissionBoundary.denials.length ? 'blocked' : 'granted',
      auditProof: permissionBoundary.audit.proof,
      proof: permissionBoundary.proof.digest
    },
    resourceBoundary: {
      contractVersion: resourceBoundary.contractVersion,
      state: resourceBoundary.state,
      resourceCount: resourceBoundary.resourceCount,
      allowedResourceIds: resourceBoundary.allowedResourceIds,
      deniedResourceIds: resourceBoundary.deniedResourceIds,
      decisions: resourceBoundary.decisions,
      denialCodes: uniqueSorted(resourceBoundary.denials.map((denial) => denial.code)),
      auditProof: resourceBoundary.audit.proof,
      proof: resourceBoundary.proof.digest
    }
  };
  const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  const delegationPlan = buildDelegationPlan({
    input,
    tenantId,
    subjectId,
    boundary,
    grantedPermissions: permissionBoundary.grantedPermissions,
    issuedAt: now,
    expiresAt
  });

  for (const denial of delegationPlan.denials) {
    denials.push(denial);
  }

  const clientRuntime = normalizeClientRuntimeState({ ...input, now }, boundary, subjectId);
  const securityGuard = buildCapabilityTokenSecurityGuard({
    input,
    tenantId,
    subjectId,
    clientRuntime,
    delegationPlan,
    now
  });

  for (const denial of securityGuard.denials) {
    denials.push(denial);
  }

  const issueState = errors.length
    ? 'failed'
    : denials.length
      ? 'denied'
      : issuerHealth.mode === 'degraded'
        ? 'issued_degraded'
        : 'issued';
  const proofPayload = {
    surfaceId,
    tenantId: boundary.tenantId,
    subjectId: subjectId || null,
    roles,
    grantedPermissions: permissionBoundary.grantedPermissions,
    boundary,
    delegation: {
      requested: delegationPlan.requested,
      state: delegationPlan.state,
      mode: delegationPlan.mode,
      parentTokenId: delegationPlan.parent.tokenId,
      depth: delegationPlan.depth,
      maxDepth: delegationPlan.maxDepth,
      auditReferences: delegationPlan.auditReferences,
      proof: delegationPlan.proof.digest
    },
    securityGuard: {
      state: securityGuard.state,
      requestSealed: securityGuard.requestSealed,
      requestNonce: securityGuard.requestNonce,
      requestFreshnessState: securityGuard.requestFreshness?.state || 'unobserved',
      requestFreshnessProof: securityGuard.requestFreshness?.proof?.digest || null,
      referenceTokenIds: securityGuard.referenceTokenIds,
      referenceProofDigests: securityGuard.referenceProofDigests,
      registry: securityGuard.registry,
      proof: securityGuard.proof.digest
    },
    issueState,
    issuerHealthMode: issuerHealth.mode,
    clientRequestId: clientRuntime.requestId,
    clientStateDigest: clientRuntime.stateDigest,
    lifecycleCommand: lifecycleControls.command,
    lifecycleState: lifecycleControls.state,
    issuedAt: now,
    expiresAt
  };
  const proof = hashProof(proofPayload);
  const tokenId = `cap_${proof.slice(0, 24)}`;
  const providerContracts = negotiateProviderContracts({
    input,
    boundary,
    permissions: permissionBoundary.grantedPermissions,
    issueState,
    proof,
    issuedAt: now,
    expiresAt
  });
  const grantedPermissionSet = permissionBoundary.grantedPermissions;
  const clientContract = buildCapabilityTokenClientContract({
    boundary,
    subjectId,
    roles,
    requestedPermissions: uniqueSorted(effectiveRequest),
    grantedPermissions: grantedPermissionSet,
    ttlSeconds,
    expiresAt,
    issueState,
    errors,
    denials,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    proof,
    retry: issuerHealth.retry,
    clientRuntime,
    tokenId,
    resourceBoundary,
    delegationPlan,
    securityGuard
  });
  const statePersistence = buildStatePersistenceRecovery({
    input,
    now,
    tokenId,
    issueState,
    expiresAt,
    proof,
    clientRuntime,
    boundary,
    subjectId,
    lifecycleControls,
    acceptanceDecision: clientContract.acceptance,
    readiness: clientContract.readiness
  });
  const issuanceRecovery = buildIssuanceRecoveryPlan({
    issueState,
    errors,
    denials,
    issuerHealth,
    providerContracts,
    lifecycleControls,
    delegationPlan,
    securityGuard,
    resourceBoundary,
    statePersistence,
    now,
    tokenId,
    proof
  });

  const contract = {
    ok: errors.length === 0 && denials.length === 0,
    contractVersion: 'capability-token.v1',
    issueState,
    issuedAt: now,
    expiresAt,
    ttlSeconds,
    token: {
      id: tokenId,
      subjectId: subjectId || null,
      roles,
      permissions: grantedPermissionSet,
      boundary,
      delegation: {
        contractVersion: delegationPlan.contractVersion,
        requested: delegationPlan.requested,
        state: delegationPlan.state,
        mode: delegationPlan.mode,
        depth: delegationPlan.depth,
        maxDepth: delegationPlan.maxDepth,
        parent: delegationPlan.parent,
        chain: delegationPlan.chain,
        auditReferences: delegationPlan.auditReferences,
        proof: delegationPlan.proof.digest
      },
      securityGuard: {
        contractVersion: securityGuard.contractVersion,
        state: securityGuard.state,
        requestSealed: securityGuard.requestSealed,
        requestNonce: securityGuard.requestNonce,
        requestFreshness: securityGuard.requestFreshness,
        requestFresh: securityGuard.requestFresh,
        referenceTokenIds: securityGuard.referenceTokenIds,
        referenceProofDigests: securityGuard.referenceProofDigests,
        registry: securityGuard.registry,
        denialCodes: securityGuard.denials.map((denial) => denial.code),
        proof: securityGuard.proof.digest
      }
    },
    issuerHealth,
    issuanceRecovery,
    degradedMode: issuerHealth.mode === 'degraded'
      ? {
          active: true,
          reason: 'issuer_dependency_degraded',
          auditDurability: issuerHealth.degraded.some((dependency) => dependency.dependency === 'audit-sink')
            ? 'retry-required'
            : 'normal',
          retryAfterSeconds: issuerHealth.retry.retryAfterSeconds,
          nextRetryAt: issuerHealth.retry.nextRetryAt,
          incidentKeys: issuerHealth.incidents.map((incident) => incident.incidentKey),
          operatorActions: issuerHealth.recovery.actions
        }
      : { active: false },
    denied: denials,
    errors,
    retry: issuerHealth.retry,
    auditHandoff: {
      stream: 'aios.kernel.capability-token.audit',
      action: errors.length
        ? 'capability_token_failed'
        : denials.length
          ? 'capability_token_rejected'
          : issuerHealth.mode === 'degraded'
            ? 'capability_token_issued_degraded'
            : 'capability_token_issued',
      tenantId: boundary.tenantId,
      subjectId: subjectId || null,
      workspaceIds: boundary.workspaceIds,
      proof,
      issueState,
      lifecycle: {
        command: lifecycleControls.command,
        state: lifecycleControls.state,
        nextAction: lifecycleControls.scheduling.nextAction,
        commandNextActionState: lifecycleControls.commandPlan.nextActionState,
        checkpointIntent: lifecycleControls.commandPlan.checkpoint.intent,
        commandProof: lifecycleControls.commandPlan.proof.digest,
        proof: lifecycleControls.proof.digest
      },
      boundaryProof: {
        schema: 'capability-token.boundary-proof.v1',
        isolationMode: boundary.isolationMode,
        crossTenantAllowed: boundary.crossTenantAllowed,
        workspaceAccessProof: boundary.workspaceAccess.isolationProof,
        permissionBoundaryProof: boundary.permissionBoundary.proof,
        resourceBoundaryProof: boundary.resourceBoundary.proof,
        grantedPermissionDigest: hashProof({
          tenantId: boundary.tenantId,
          workspaceIds: boundary.workspaceIds,
          permissions: grantedPermissionSet,
          effectiveWorkspacePermissions: boundary.workspaceAccess.effectiveWorkspacePermissions,
          permissionScopes: boundary.permissionBoundary.permissionScopes.map((scope) => ({
            permission: scope.permission,
            scopeState: scope.scopeState,
            allowedWorkspaceIds: scope.allowedWorkspaceIds,
            deniedWorkspaceIds: scope.deniedWorkspaceIds
          }))
        })
      },
      resourceBoundary: {
        state: boundary.resourceBoundary.state,
        resourceCount: boundary.resourceBoundary.resourceCount,
        allowedResourceIds: boundary.resourceBoundary.allowedResourceIds,
        deniedResourceIds: boundary.resourceBoundary.deniedResourceIds,
        denialCodes: boundary.resourceBoundary.denialCodes,
        auditProof: boundary.resourceBoundary.auditProof,
        proof: boundary.resourceBoundary.proof
      },
      permissionBoundary: {
        state: boundary.permissionBoundary.state,
        grantPolicy: boundary.permissionBoundary.grantPolicy,
        deniedPermissions: boundary.permissionBoundary.deniedPermissions,
        auditProof: boundary.permissionBoundary.auditProof,
        proof: boundary.permissionBoundary.proof
      },
      delegation: {
        requested: delegationPlan.requested,
        state: delegationPlan.state,
        mode: delegationPlan.mode,
        parentTokenId: delegationPlan.parent.tokenId,
        parentSubjectId: delegationPlan.parent.subjectId,
        depth: delegationPlan.depth,
        maxDepth: delegationPlan.maxDepth,
        chain: delegationPlan.chain,
        auditReferences: delegationPlan.auditReferences,
        denialCodes: delegationPlan.denials.map((denial) => denial.code),
        warningCodes: delegationPlan.warnings.map((warning) => warning.code),
        proof: delegationPlan.proof.digest
      },
      securityGuard: {
        state: securityGuard.state,
        requestSealed: securityGuard.requestSealed,
        requestNonce: securityGuard.requestNonce,
        requestFreshness: {
          state: securityGuard.requestFreshness?.state || 'unobserved',
          requestedAt: securityGuard.requestFreshness?.requestedAt || null,
          ageSeconds: securityGuard.requestFreshness?.ageSeconds ?? null,
          maxAgeSeconds: securityGuard.requestFreshness?.maxAgeSeconds || CLIENT_REQUEST_MAX_AGE_SECONDS,
          proof: securityGuard.requestFreshness?.proof?.digest || null
        },
        registry: securityGuard.registry,
        denialCodes: securityGuard.denials.map((denial) => denial.code),
        auditProof: securityGuard.audit.proof,
        proof: securityGuard.proof.digest
      },
      issuerHealthProof: {
        schema: 'capability-token.issuer-health-proof.v1',
        mode: issuerHealth.mode,
        recoveryState: issuerHealth.recovery.state,
        incidentKeys: issuerHealth.incidents.map((incident) => incident.incidentKey),
        proof: issuerHealth.proof.digest
      },
      issuanceRecovery: {
        state: issuanceRecovery.state,
        nextAction: issuanceRecovery.nextAction,
        retryable: issuanceRecovery.retryable,
        degradedModeActive: issuanceRecovery.degradedModeActive,
        blockerCount: issuanceRecovery.blockerCount,
        retryQueueLength: issuanceRecovery.retryQueue.length,
        operatorQueueLength: issuanceRecovery.operatorQueue.length,
        backoff: issuanceRecovery.backoff,
        auditReferences: issuanceRecovery.auditReferences,
        proof: issuanceRecovery.proof.digest
      },
      retry: issuerHealth.retry,
      clientRequest: {
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        workflowId: clientRuntime.workflowId,
        continuationId: clientRuntime.continuationId,
        stateDigest: clientRuntime.stateDigest
      },
      statePersistence: {
        idempotencyKey: statePersistence.idempotency.key,
        recoveryState: statePersistence.recovery.state,
        restartSafeStatus: statePersistence.recovery.restartSafeStatus,
        proof: statePersistence.proof.digest
      },
      evidence: evidenceBundle.redacted,
      evidenceRedaction: {
        schema: evidenceBundle.schema,
        redactionPathCount: evidenceBundle.redactionPathCount,
        redactionPaths: evidenceBundle.redactionPaths
      }
    },
    providerContracts,
    lifecycleControls,
    delegation: {
      contractVersion: delegationPlan.contractVersion,
      requested: delegationPlan.requested,
      state: delegationPlan.state,
      mode: delegationPlan.mode,
      parentTokenId: delegationPlan.parent.tokenId,
      parentSubjectId: delegationPlan.parent.subjectId,
      depth: delegationPlan.depth,
      maxDepth: delegationPlan.maxDepth,
      chain: delegationPlan.chain,
      auditReferences: delegationPlan.auditReferences,
      denials: delegationPlan.denials,
      warnings: delegationPlan.warnings,
      proof: delegationPlan.proof
    },
    securityGuard: {
      contractVersion: securityGuard.contractVersion,
      state: securityGuard.state,
      requestSealed: securityGuard.requestSealed,
      requestNonce: securityGuard.requestNonce,
      requestFreshness: securityGuard.requestFreshness,
      requestFresh: securityGuard.requestFresh,
      referenceTokenIds: securityGuard.referenceTokenIds,
      referenceProofDigests: securityGuard.referenceProofDigests,
      registry: securityGuard.registry,
      revocationMatches: securityGuard.revocationMatches,
      replayMatches: securityGuard.replayMatches,
      denials: securityGuard.denials,
      audit: securityGuard.audit,
      proof: securityGuard.proof
    },
    clientRuntime,
    operatorHandoff: clientContract.operatorHandoff,
    preview: clientContract.preview,
    acceptance: clientContract.acceptance,
    readiness: clientContract.readiness,
    statePersistence,
    workflowHandoff: clientContract.workflowHandoff,
    validationSummary: clientContract.validationSummary,
    nextSteps: clientContract.nextSteps,
    proof: {
      algorithm: 'sha256',
      digest: proof,
      signedFields: Object.keys(proofPayload)
    },
    evidenceRedaction: evidenceBundle
  };
  contract.analytics = buildCapabilityTokenAnalytics(contract, input);
  return contract;
}

export function describeCapabilityTokenSurface(input = {}) {
  const now = normalizeIssuedAt(input.now);
  const capabilityToken = buildCapabilityTokenContract({ ...input, now });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel capability token contract with strict tenant and workspace boundaries',
    capabilityToken,
    evidence: capabilityToken.evidenceRedaction.redacted,
    evidenceRedaction: capabilityToken.evidenceRedaction
  };
}

export default describeCapabilityTokenSurface;
