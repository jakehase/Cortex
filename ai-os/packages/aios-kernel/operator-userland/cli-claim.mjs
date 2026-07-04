export const surfaceId = "aios_operator-userland_cli-claim_083";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-claim";

const CLAIM_PERMISSIONS = Object.freeze({
  workspaceRead: 'workspace:read',
  workspaceWrite: 'workspace:write',
  tenantAdmin: 'tenant:admin',
  auditRead: 'audit:read',
  kernelAttach: 'kernel:attach'
});

const ROLE_PERMISSIONS = Object.freeze({
  viewer: [CLAIM_PERMISSIONS.workspaceRead],
  operator: [
    CLAIM_PERMISSIONS.workspaceRead,
    CLAIM_PERMISSIONS.workspaceWrite,
    CLAIM_PERMISSIONS.kernelAttach
  ],
  auditor: [
    CLAIM_PERMISSIONS.workspaceRead,
    CLAIM_PERMISSIONS.auditRead
  ],
  admin: Object.values(CLAIM_PERMISSIONS)
});

const DEFAULT_CLAIMS = Object.freeze([
  'workspaceRead',
  'auditRead'
]);

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2000
});

const DEFAULT_HANDOFF_ACK_STALE_AFTER_MS = 300000;

const LIFECYCLE_SETTING_LIMITS = Object.freeze({
  maxConcurrentClaims: { min: 1, max: 32, fallback: 1 },
  scheduleIntervalMs: { min: 1000, max: 86400000, fallback: 0 },
  scheduleMaxRuns: { min: 1, max: 1000, fallback: 1 }
});

const LIFECYCLE_COMMANDS = Object.freeze([
  'claim',
  'attach',
  'status',
  'enable',
  'disable',
  'schedule',
  'dry_run'
]);

const SCHEDULE_MODES = Object.freeze([
  'immediate',
  'deferred',
  'manual',
  'disabled'
]);

const DEFAULT_PROVIDER_CAPABILITIES = Object.freeze([
  'audit.proof',
  'claim.evaluate',
  'handoff.external-state',
  'kernel.attach',
  'sync.metadata'
]);

const COMMAND_PROVIDER_CAPABILITIES = Object.freeze({
  claim: ['claim.evaluate', 'audit.proof', 'sync.metadata'],
  attach: ['claim.evaluate', 'audit.proof', 'kernel.attach', 'handoff.external-state', 'sync.metadata'],
  status: ['sync.metadata'],
  enable: ['sync.metadata'],
  disable: ['sync.metadata'],
  schedule: ['claim.evaluate', 'handoff.external-state', 'sync.metadata'],
  dry_run: ['claim.evaluate', 'audit.proof']
});

const PROVIDER_SERVICE_PROFILES = Object.freeze({
  mailchimp: Object.freeze({
    service: 'mailchimp-marketing',
    protocol: 'https-json',
    capabilities: Object.freeze([
      'audit.proof',
      'claim.evaluate',
      'handoff.external-state',
      'sync.metadata',
      'mailchimp.campaign.read',
      'mailchimp.campaign.write',
      'mailchimp.audience.read'
    ]),
    handoffTarget: 'mailchimp.marketing.claims',
    syncStaleAfterMs: 120000,
    pendingOutboundWarnAt: 5
  })
});

const MAILCHIMP_CAMPAIGN_STATUSES = Object.freeze([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'archived',
  'unknown'
]);

const FAILURE_REMEDIATION = Object.freeze({
  tenant_boundary_failed: {
    category: 'boundary',
    capability: 'claim.evaluate',
    command: 'claim --scope <tenant/workspace>',
    action: 'Select a tenant scope owned by the principal before reissuing the claim.'
  },
  workspace_boundary_failed: {
    category: 'boundary',
    capability: 'claim.evaluate',
    command: 'claim --workspace <allowed-workspace>',
    action: 'Re-run against one of the allowed workspaces in the claim scope.'
  },
  tenant_permission_boundary_failed: {
    category: 'permission_boundary',
    capability: 'claim.evaluate',
    command: 'claim --tenant <allowed-tenant>',
    action: 'Use a tenant included in the permission boundary before evaluating hosted-kernel claims.'
  },
  workspace_permission_boundary_failed: {
    category: 'permission_boundary',
    capability: 'claim.evaluate',
    command: 'claim --workspace <boundary-workspace>',
    action: 'Select a workspace included in the tenant permission boundary.'
  },
  permission_boundary_denied: {
    category: 'permission_boundary',
    capability: 'claim.evaluate',
    command: 'claim --permission-boundary <policy>',
    action: 'Attach a boundary grant that includes every requested claim permission for this workspace.'
  },
  kernel_heartbeat_stale: {
    category: 'hosted_kernel',
    capability: 'kernel.attach',
    command: 'status --refresh-kernel-health',
    action: 'Refresh hosted-kernel health and retry only after a fresh heartbeat is observed.'
  },
  kernel_queue_degraded: {
    category: 'hosted_kernel',
    capability: 'claim.evaluate',
    command: 'claim --retry',
    action: 'Use the retry plan while the hosted-kernel queue drains.'
  },
  kernel_lease_missing: {
    category: 'hosted_kernel',
    capability: 'kernel.attach',
    command: 'attach --renew-lease',
    action: 'Renew or acquire the hosted-kernel lease before attaching.'
  },
  kernel_attach_unavailable: {
    category: 'hosted_kernel',
    capability: 'kernel.attach',
    command: 'attach --retry',
    action: 'Retry attach after the hosted-kernel advertises attach availability.'
  },
  provider_capability_missing: {
    category: 'provider_contract',
    capability: 'handoff.external-state',
    command: 'status --provider-capabilities',
    action: 'Upgrade or reconfigure the provider so every required capability is present.'
  },
  provider_sync_missing: {
    category: 'provider_contract',
    capability: 'sync.metadata',
    command: 'status --sync',
    action: 'Perform an initial metadata sync before accepting claim state.'
  },
  provider_sync_stale: {
    category: 'provider_contract',
    capability: 'sync.metadata',
    command: 'status --sync --retry',
    action: 'Refresh provider metadata, then retry with the supplied backoff plan.'
  },
  provider_sync_pending: {
    category: 'provider_contract',
    capability: 'sync.metadata',
    command: 'status --drain-outbound',
    action: 'Drain pending provider mutations before relying on the claim preview.'
  },
  provider_sync_backpressure: {
    category: 'provider_contract',
    capability: 'sync.metadata',
    command: 'status --drain-outbound --provider <provider-id>',
    action: 'Drain provider outbound mutations below the advertised warning threshold before committing claim state.'
  },
  provider_handoff_not_ready: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --await-handoff',
    action: 'Wait for the external handoff target to report ready or accepted.'
  },
  provider_handoff_ack_missing: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --handoff-ack <ack-id>',
    action: 'Attach the provider acknowledgement before committing hosted-kernel handoff state.'
  },
  provider_handoff_state_mismatch: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --external-state <state-id>',
    action: 'Use a handoff acknowledgement that references the same external state id as the provider contract.'
  },
  provider_handoff_idempotency_mismatch: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --idempotency-key <current-key>',
    action: 'Refresh the handoff acknowledgement so it is bound to the current persisted idempotency key.'
  },
  provider_handoff_ack_stale: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --await-handoff --refresh-ack',
    action: 'Refresh the provider handoff acknowledgement before committing hosted-kernel handoff state.'
  },
  provider_handoff_ack_timestamp_invalid: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --refresh-ack',
    action: 'Attach a provider handoff acknowledgement with a valid receivedAt timestamp.'
  },
  provider_handoff_checkpoint_pending: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --await-handoff',
    action: 'Wait for the provider checkpoint to reach accepted, committed, attached, or scheduled.'
  },
  provider_handoff_checkpoint_not_accepted: {
    category: 'handoff',
    capability: 'handoff.external-state',
    command: 'attach --await-handoff',
    action: 'Accept or commit the provider checkpoint before hosted-kernel dispatch.'
  },
  persisted_state_recovery_unavailable: {
    category: 'persisted_state',
    capability: 'sync.metadata',
    command: 'status --repair-state',
    action: 'Repair persisted claim state with a restart token, sync cursor, or external handoff id.'
  },
  persisted_state_boundary_failed: {
    category: 'persisted_state',
    capability: 'sync.metadata',
    command: 'status --scope <tenant/workspace> --repair-state',
    action: 'Reject the persisted state handoff and reload state from the active tenant/workspace partition.'
  },
  persisted_state_boundary_unverified: {
    category: 'persisted_state',
    capability: 'sync.metadata',
    command: 'status --include-boundary-metadata',
    action: 'Include tenant and workspace ownership metadata with persisted state before attaching.'
  },
  lifecycle_disabled: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'enable',
    action: 'Enable the lifecycle gate before issuing claim or attach commands.'
  },
  lifecycle_attach_disabled: {
    category: 'lifecycle',
    capability: 'kernel.attach',
    command: 'enable --attach',
    action: 'Enable attach in lifecycle controls before hosted-kernel attachment.'
  },
  lifecycle_schedule_time_missing: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'schedule --not-before <iso8601>',
    action: 'Provide a notBefore timestamp for deferred schedule mode.'
  },
  lifecycle_concurrency_invalid: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'settings --max-concurrent-claims <1-32>',
    action: 'Set lifecycle maxConcurrentClaims to a whole number between 1 and 32.'
  },
  lifecycle_schedule_interval_invalid: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'schedule --interval-ms <1000-86400000>',
    action: 'Set schedule intervalMs to 0 for one-shot schedules or a whole number between 1000 and 86400000.'
  },
  lifecycle_schedule_runs_invalid: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'schedule --max-runs <1-1000>',
    action: 'Set schedule maxRuns to a whole number between 1 and 1000.'
  },
  lifecycle_schedule_cursor_invalid: {
    category: 'lifecycle',
    capability: 'claim.evaluate',
    command: 'schedule --reset-cursor',
    action: 'Repair the lifecycle schedule cursor so completed runs and lastRunAt are valid for this schedule.'
  },
  lifecycle_enable_attach_conflict: {
    category: 'lifecycle',
    capability: 'kernel.attach',
    command: 'enable --attach',
    action: 'Enable attach controls before requesting an attach lifecycle transition.'
  },
  verifier_claim_gate_route_invalid: {
    category: 'verifier_claim_gate',
    capability: 'claim.evaluate',
    command: 'claim --through-verifier-gate --route /verifier/claim-gate',
    action: 'Submit completion only to the verifier claim gate route for the active tenant/workspace scope.'
  },
  verifier_claim_gate_required: {
    category: 'verifier_claim_gate',
    capability: 'claim.evaluate',
    command: 'claim --through-verifier-gate',
    action: 'Submit mutating claim completion through the verifier claim gate and attach the accepted gate receipt.'
  },
  verifier_claim_gate_pending: {
    category: 'verifier_claim_gate',
    capability: 'claim.evaluate',
    command: 'status --verifier-claim-gate --retry',
    action: 'Poll the verifier claim gate with the supplied backoff plan until the gate returns an accepted receipt.'
  },
  verifier_claim_gate_receipt_invalid: {
    category: 'verifier_claim_gate',
    capability: 'claim.evaluate',
    command: 'claim --through-verifier-gate --refresh-receipt',
    action: 'Refresh the verifier gate receipt so its scope, idempotency key, claims, and provider sync receipt match this request.'
  },
  mailchimp_lifecycle_not_ready: {
    category: 'mailchimp_marketing',
    capability: 'mailchimp.campaign.write',
    command: 'claim --mailchimp --validate-lifecycle',
    action: 'Resolve the Mailchimp lifecycle gate before accepting or attaching this claim.'
  },
  mailchimp_publish_guard_not_ready: {
    category: 'mailchimp_marketing',
    capability: 'mailchimp.campaign.write',
    command: 'status --provider mailchimp --sync --handoff',
    action: 'Resolve the Mailchimp publish guard by refreshing sync, draining outbound mutations, or selecting a mutable campaign and audience.'
  },
  mailchimp_campaign_missing: {
    category: 'mailchimp_marketing',
    capability: 'mailchimp.campaign.read',
    command: 'claim --mailchimp-campaign <campaign-id>',
    action: 'Select the Mailchimp campaign that owns this claim before acceptance.'
  },
  mailchimp_audience_missing: {
    category: 'mailchimp_marketing',
    capability: 'mailchimp.audience.read',
    command: 'claim --mailchimp-audience <audience-id>',
    action: 'Select the Mailchimp audience or list before acceptance.'
  },
  mailchimp_campaign_already_terminal: {
    category: 'mailchimp_marketing',
    capability: 'mailchimp.campaign.write',
    command: 'claim --duplicate-mailchimp-campaign',
    action: 'Use a mutable Mailchimp campaign draft before committing the claim handoff.'
  }
});

function stableList(value) {
  return Array.from(new Set(Array.isArray(value) ? value.filter(Boolean) : [])).sort();
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeLifecycleBoundedInteger(value, limits, { allowZero = false } = {}) {
  const supplied = value !== undefined && value !== null && value !== '';
  const parsed = Number(value);
  const integer = Number.isInteger(parsed) ? parsed : null;
  const zeroAllowed = allowZero && integer === 0;
  const inRange = zeroAllowed || (integer !== null && integer >= limits.min && integer <= limits.max);
  const valid = !supplied || inRange;

  return {
    value: valid && integer !== null ? integer : limits.fallback,
    supplied,
    valid,
    reasonCodes: stableList([
      ...(supplied && integer === null ? ['not_integer'] : []),
      ...(supplied && integer !== null && integer < 0 ? ['negative_value'] : []),
      ...(supplied && integer !== null && integer === 0 && !allowZero ? ['zero_not_allowed'] : []),
      ...(supplied && integer !== null && integer > 0 && integer < limits.min ? ['below_minimum'] : []),
      ...(supplied && integer !== null && integer > limits.max ? ['above_maximum'] : [])
    ])
  };
}

function normalizePrincipal(input = {}) {
  const user = input.user && typeof input.user === 'object' ? input.user : {};
  const tenantId = String(input.tenantId || user.tenantId || 'tenant-local').trim();
  const workspaceId = String(input.workspaceId || user.workspaceId || 'workspace-default').trim();
  const principalId = String(input.principalId || user.id || user.sub || 'operator-cli').trim();
  const roles = stableList(input.roles || user.roles || ['viewer']);
  const explicitPermissions = stableList(input.permissions || user.permissions);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);

  return {
    tenantId,
    workspaceId,
    principalId,
    roles,
    permissions: stableList([...rolePermissions, ...explicitPermissions])
  };
}

function normalizeWorkspaceScope(input = {}, principal) {
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : {};
  const requestedTenantId = String(scope.tenantId || input.requestedTenantId || principal.tenantId).trim();
  const requestedWorkspaceId = String(scope.workspaceId || input.requestedWorkspaceId || principal.workspaceId).trim();
  const allowedWorkspaceIds = stableList([
    principal.workspaceId,
    ...stableList(input.allowedWorkspaceIds || scope.allowedWorkspaceIds)
  ]);

  return {
    requestedTenantId,
    requestedWorkspaceId,
    allowedWorkspaceIds,
    tenantMatches: requestedTenantId === principal.tenantId,
    workspaceAllowed: allowedWorkspaceIds.includes(requestedWorkspaceId)
  };
}

function normalizeTenantPermissionBoundary(input = {}, { principal, scope, requestedClaims }) {
  const boundaryInput = input.permissionBoundary && typeof input.permissionBoundary === 'object'
    ? input.permissionBoundary
    : input.tenantBoundary && typeof input.tenantBoundary === 'object'
      ? input.tenantBoundary
      : input.boundary && typeof input.boundary === 'object'
        ? input.boundary
        : {};
  const requestedMode = String(boundaryInput.mode || boundaryInput.enforcement || 'strict').trim();
  const enforcement = ['strict', 'audit', 'disabled'].includes(requestedMode) ? requestedMode : 'strict';
  const tenantAllowList = stableList([
    principal.tenantId,
    ...stableList(boundaryInput.allowedTenantIds || boundaryInput.tenants)
  ]);
  const workspaceAllowList = stableList([
    ...scope.allowedWorkspaceIds,
    ...stableList(boundaryInput.allowedWorkspaceIds || boundaryInput.workspaces)
  ]);
  const grantSource = boundaryInput.workspaceGrants && typeof boundaryInput.workspaceGrants === 'object'
    ? boundaryInput.workspaceGrants
    : {};
  const grantEntries = Array.isArray(grantSource)
    ? grantSource
    : Object.entries(grantSource).map(([workspaceId, permissions]) => ({ workspaceId, permissions }));
  const grantMap = new Map(grantEntries
    .map((grant) => {
      const workspaceId = String(grant.workspaceId || grant.workspace || grant.id || '').trim();
      const permissions = stableList(
        grant.permissions
          || grant.claimPermissions
          || grant.claims?.map((claim) => CLAIM_PERMISSIONS[claim] || claim)
          || []
      );
      return workspaceId ? [workspaceId, permissions] : null;
    })
    .filter(Boolean));
  const workspaceGrant = grantMap.get(scope.requestedWorkspaceId) || null;
  const fallbackPermissions = stableList(boundaryInput.defaultPermissions || boundaryInput.permissions || principal.permissions);
  const boundaryPermissions = workspaceGrant || fallbackPermissions;
  const effectivePermissions = enforcement === 'disabled'
    ? principal.permissions
    : principal.permissions.filter((permission) => boundaryPermissions.includes(permission));
  const missingBoundaryPermissions = requestedClaims
    .filter((claim) => !effectivePermissions.includes(claim.permission))
    .map((claim) => claim.permission);
  const tenantAllowed = tenantAllowList.includes(scope.requestedTenantId);
  const workspaceAllowed = workspaceAllowList.includes(scope.requestedWorkspaceId);
  const strict = enforcement === 'strict';

  return {
    contract: 'operator-userland.cli-claim.tenant-permission-boundary.v1',
    enforcement,
    strict,
    tenant: {
      expectedTenantId: principal.tenantId,
      requestedTenantId: scope.requestedTenantId,
      allowedTenantIds: tenantAllowList,
      allowed: enforcement === 'disabled' || tenantAllowed
    },
    workspace: {
      requestedWorkspaceId: scope.requestedWorkspaceId,
      allowedWorkspaceIds: workspaceAllowList,
      hasExplicitGrant: Boolean(workspaceGrant),
      allowed: enforcement === 'disabled' || workspaceAllowed
    },
    permissions: {
      principalPermissions: principal.permissions,
      boundaryPermissions,
      effectivePermissions: stableList(effectivePermissions),
      missingBoundaryPermissions: stableList(missingBoundaryPermissions),
      restricted: enforcement !== 'disabled' && effectivePermissions.length < principal.permissions.length
    },
    safeToEvaluate: enforcement === 'disabled'
      || (!strict || (tenantAllowed && workspaceAllowed && missingBoundaryPermissions.length === 0)),
    reasonCodes: stableList([
      ...(enforcement === 'disabled' ? ['boundary_disabled'] : []),
      ...(tenantAllowed || enforcement === 'disabled' ? [] : ['tenant_not_in_boundary']),
      ...(workspaceAllowed || enforcement === 'disabled' ? [] : ['workspace_not_in_boundary']),
      ...(missingBoundaryPermissions.length === 0 ? [] : ['permission_boundary_denied']),
      ...(workspaceGrant ? ['workspace_grant_matched'] : ['workspace_grant_defaulted']),
      ...(enforcement === 'audit' ? ['audit_only'] : [])
    ]),
    auditHandoff: {
      stream: `${principal.tenantId}/${scope.requestedWorkspaceId}/cli-claim.boundary`,
      recordType: enforcement === 'audit' ? 'boundary_audit' : 'boundary_enforced',
      evidenceKeys: stableList([
        `${principal.tenantId}/${principal.principalId}`,
        `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`,
        ...stableList(missingBoundaryPermissions)
      ])
    }
  };
}

function normalizeClaimRequests(input = {}) {
  const requested = Array.isArray(input.requestedClaims) && input.requestedClaims.length > 0
    ? input.requestedClaims
    : DEFAULT_CLAIMS;

  return requested.map((claim) => {
    if (typeof claim === 'string') {
      return { name: claim, permission: CLAIM_PERMISSIONS[claim] || claim };
    }

    const name = String(claim?.name || claim?.claim || '').trim();
    const permission = String(claim?.permission || CLAIM_PERMISSIONS[name] || name).trim();
    return { name, permission };
  }).filter((claim) => claim.name && claim.permission);
}

function evaluateClaims({ principal, scope, requestedClaims, tenantBoundary = null }) {
  const boundaryReasons = [];
  if (!scope.tenantMatches) {
    boundaryReasons.push('tenant_mismatch');
  }
  if (!scope.workspaceAllowed) {
    boundaryReasons.push('workspace_not_allowed');
  }
  if (tenantBoundary && tenantBoundary.enforcement === 'strict' && !tenantBoundary.tenant.allowed) {
    boundaryReasons.push('tenant_boundary_denied');
  }
  if (tenantBoundary && tenantBoundary.enforcement === 'strict' && !tenantBoundary.workspace.allowed) {
    boundaryReasons.push('workspace_boundary_denied');
  }
  const effectivePermissions = tenantBoundary?.permissions?.effectivePermissions || principal.permissions;

  return requestedClaims.map((claim) => {
    const hasPermission = effectivePermissions.includes(claim.permission);
    const boundaryDenied = tenantBoundary?.enforcement === 'strict'
      && tenantBoundary.permissions.missingBoundaryPermissions.includes(claim.permission);
    const allowed = boundaryReasons.length === 0 && hasPermission;
    const reasons = allowed
      ? ['granted']
      : [
          ...boundaryReasons,
          ...(hasPermission ? [] : [`missing_permission:${claim.permission}`]),
          ...(boundaryDenied ? [`permission_boundary_denied:${claim.permission}`] : [])
        ];

    return {
      name: claim.name,
      permission: claim.permission,
      allowed,
      reasons,
      tenantId: principal.tenantId,
      workspaceId: scope.requestedWorkspaceId,
      permissionSource: tenantBoundary?.enforcement === 'disabled' ? 'principal' : 'tenant_permission_boundary'
    };
  });
}

function normalizeHostedKernelHealth(input = {}) {
  const kernel = input.kernel && typeof input.kernel === 'object' ? input.kernel : {};
  const health = input.health && typeof input.health === 'object' ? input.health : {};
  const heartbeatAgeMs = normalizePositiveInteger(
    kernel.heartbeatAgeMs ?? health.heartbeatAgeMs,
    0
  );
  const heartbeatStaleAfterMs = normalizePositiveInteger(
    kernel.heartbeatStaleAfterMs ?? health.heartbeatStaleAfterMs,
    30000
  );
  const queueDepth = normalizePositiveInteger(
    kernel.queueDepth ?? health.queueDepth,
    0
  );
  const queueDepthWarnAt = normalizePositiveInteger(
    kernel.queueDepthWarnAt ?? health.queueDepthWarnAt,
    50
  );
  const degradedMode = normalizeBoolean(kernel.degradedMode ?? health.degradedMode);
  const canAttach = normalizeBoolean(kernel.canAttach ?? health.canAttach, true);
  const hasLease = normalizeBoolean(kernel.hasLease ?? health.hasLease, true);

  return {
    contract: 'operator-userland.cli-claim.hosted-kernel-health.v1',
    kernelId: String(kernel.kernelId || health.kernelId || 'hosted-kernel-local').trim(),
    status: String(kernel.status || health.status || 'ready').trim(),
    heartbeatAgeMs,
    heartbeatStaleAfterMs,
    queueDepth,
    queueDepthWarnAt,
    degradedMode,
    canAttach,
    hasLease,
    leaseId: String(kernel.leaseId || health.leaseId || '').trim() || null
  };
}

function validateCliClaimRequest({ principal, scope, requestedClaims, hostedKernel, tenantBoundary }) {
  const findings = [];
  if (!principal.principalId) {
    findings.push({ code: 'principal_missing', severity: 'error', field: 'principalId' });
  }
  if (principal.roles.length === 0) {
    findings.push({ code: 'roles_missing', severity: 'warning', field: 'roles' });
  }
  if (requestedClaims.length === 0) {
    findings.push({ code: 'claims_missing', severity: 'error', field: 'requestedClaims' });
  }
  if (!scope.tenantMatches) {
    findings.push({ code: 'tenant_boundary_failed', severity: 'error', field: 'scope.tenantId' });
  }
  if (!scope.workspaceAllowed) {
    findings.push({ code: 'workspace_boundary_failed', severity: 'error', field: 'scope.workspaceId' });
  }
  if (tenantBoundary?.enforcement === 'strict' && !tenantBoundary.tenant.allowed) {
    findings.push({ code: 'tenant_permission_boundary_failed', severity: 'error', field: 'permissionBoundary.allowedTenantIds' });
  }
  if (tenantBoundary?.enforcement === 'strict' && !tenantBoundary.workspace.allowed) {
    findings.push({ code: 'workspace_permission_boundary_failed', severity: 'error', field: 'permissionBoundary.allowedWorkspaceIds' });
  }
  if (tenantBoundary?.enforcement === 'strict' && tenantBoundary.permissions.missingBoundaryPermissions.length > 0) {
    findings.push({
      code: 'permission_boundary_denied',
      severity: 'error',
      field: 'permissionBoundary.workspaceGrants',
      reasonCodes: tenantBoundary.permissions.missingBoundaryPermissions
    });
  }
  if (!hostedKernel.kernelId) {
    findings.push({ code: 'kernel_identity_missing', severity: 'error', field: 'kernel.kernelId' });
  }
  if (hostedKernel.heartbeatAgeMs > hostedKernel.heartbeatStaleAfterMs) {
    findings.push({ code: 'kernel_heartbeat_stale', severity: 'error', field: 'kernel.heartbeatAgeMs' });
  }
  if (hostedKernel.queueDepth >= hostedKernel.queueDepthWarnAt) {
    findings.push({ code: 'kernel_queue_degraded', severity: 'warning', field: 'kernel.queueDepth' });
  }
  if (!hostedKernel.hasLease) {
    findings.push({ code: 'kernel_lease_missing', severity: 'error', field: 'kernel.hasLease' });
  }
  if (!hostedKernel.canAttach) {
    findings.push({ code: 'kernel_attach_unavailable', severity: 'error', field: 'kernel.canAttach' });
  }

  return findings;
}

function normalizeRetryPolicy(input = {}) {
  const retry = input.retry && typeof input.retry === 'object' ? input.retry : {};
  const maxAttempts = normalizePositiveInteger(retry.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts);
  const baseDelayMs = normalizePositiveInteger(retry.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs);
  const maxDelayMs = normalizePositiveInteger(retry.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs);

  return { maxAttempts, baseDelayMs, maxDelayMs };
}

function normalizeVerifierClaimGateRoutePolicy({ route, principal, scope, persistedState }) {
  const submittedRoute = String(route || '').trim() || '/verifier/claim-gate';
  const routePath = submittedRoute.split('?')[0].replace(/\/+/g, '/');
  const routeSegments = routePath.split('/').filter(Boolean);
  const scopedTenantRoute = `/tenants/${scope.requestedTenantId}/workspaces/${scope.requestedWorkspaceId}/verifier/claim-gate`;
  const scopedWorkspaceRoute = `/tenant/${scope.requestedTenantId}/workspace/${scope.requestedWorkspaceId}/verifier/claim-gate`;
  const allowedRoutes = stableList([
    '/verifier/claim-gate',
    scopedTenantRoute,
    scopedWorkspaceRoute
  ]);
  const hasAbsoluteScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(submittedRoute);
  const hasTraversal = routeSegments.includes('..') || submittedRoute.includes('\\');
  const tenantIndex = routeSegments.findIndex((segment) => segment === 'tenants' || segment === 'tenant');
  const workspaceIndex = routeSegments.findIndex((segment) => segment === 'workspaces' || segment === 'workspace');
  const routeTenantId = tenantIndex >= 0 ? routeSegments[tenantIndex + 1] || null : null;
  const routeWorkspaceId = workspaceIndex >= 0 ? routeSegments[workspaceIndex + 1] || null : null;
  const routeNamesVerifierGate = routePath === '/verifier/claim-gate'
    || routePath.endsWith('/verifier/claim-gate')
    || routePath.endsWith('/verifier/claim_gate');
  const routeTenantMatches = !routeTenantId || routeTenantId === scope.requestedTenantId;
  const routeWorkspaceMatches = !routeWorkspaceId || routeWorkspaceId === scope.requestedWorkspaceId;
  const routeAllowed = !hasAbsoluteScheme
    && !hasTraversal
    && routeNamesVerifierGate
    && allowedRoutes.includes(routePath)
    && routeTenantMatches
    && routeWorkspaceMatches;
  const routeScopeKey = routeTenantId && routeWorkspaceId
    ? `${routeTenantId}/${routeWorkspaceId}`
    : `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`;

  return {
    contract: 'operator-userland.cli-claim.verifier-gate-route-policy.v1',
    submittedRoute,
    normalizedRoute: routePath,
    allowedRoutes,
    allowed: routeAllowed,
    routeScopeKey,
    tenantId: routeTenantId,
    workspaceId: routeWorkspaceId,
    reasonCodes: stableList([
      ...(hasAbsoluteScheme ? ['absolute_route_rejected'] : []),
      ...(hasTraversal ? ['route_traversal_rejected'] : []),
      ...(routeNamesVerifierGate ? [] : ['route_not_verifier_claim_gate']),
      ...(allowedRoutes.includes(routePath) ? [] : ['route_not_in_scope_allowlist']),
      ...(routeTenantMatches ? [] : ['route_tenant_mismatch']),
      ...(routeWorkspaceMatches ? [] : ['route_workspace_mismatch'])
    ]),
    auditHandoff: {
      stream: `${principal.tenantId}/${scope.requestedWorkspaceId}/cli-claim.verifier-gate-route`,
      recordType: routeAllowed ? 'verifier_gate_route_allowed' : 'verifier_gate_route_blocked',
      evidenceKeys: stableList([
        submittedRoute,
        routePath,
        persistedState.storageKey,
        `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`
      ])
    }
  };
}

function normalizeLifecycleCommand(value) {
  const command = String(value || 'claim').trim().replace(/-/g, '_');
  return command || 'claim';
}

function normalizeLifecycleScheduleCursor({ schedule, lifecycle, now, scheduleMode, notBefore, notBeforeMs, scheduleInterval, scheduleMaxRuns }) {
  const cursor = schedule.cursor && typeof schedule.cursor === 'object'
    ? schedule.cursor
    : lifecycle.scheduleCursor && typeof lifecycle.scheduleCursor === 'object'
      ? lifecycle.scheduleCursor
      : {};
  const cursorSupplied = Object.keys(cursor).length > 0
    || schedule.completedRuns !== undefined
    || lifecycle.completedRuns !== undefined
    || schedule.lastRunAt !== undefined
    || lifecycle.lastRunAt !== undefined;
  const completedRunsRaw = cursor.completedRuns ?? schedule.completedRuns ?? lifecycle.completedRuns ?? 0;
  const completedRunsNumber = Number(completedRunsRaw);
  const completedRunsValid = Number.isInteger(completedRunsNumber) && completedRunsNumber >= 0;
  const completedRuns = completedRunsValid
    ? Math.min(completedRunsNumber, scheduleMaxRuns.value)
    : 0;
  const lastRunAt = String(cursor.lastRunAt || schedule.lastRunAt || lifecycle.lastRunAt || '').trim() || null;
  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : null;
  const lastRunValid = lastRunAt === null || !Number.isNaN(lastRunMs);
  const nowMs = Date.parse(now);
  const intervalMs = scheduleInterval.value;
  const runLimitReached = completedRuns >= scheduleMaxRuns.value;
  const repeatEnabled = intervalMs > 0;
  const anchorMs = lastRunValid && lastRunMs !== null
    ? lastRunMs
    : notBeforeMs !== null && !Number.isNaN(notBeforeMs)
      ? notBeforeMs
      : nowMs;
  const nextDueMs = runLimitReached || scheduleMode === 'disabled' || scheduleMode === 'manual'
    ? null
    : scheduleMode === 'deferred'
      ? repeatEnabled && completedRuns > 0
        ? anchorMs + intervalMs
        : notBeforeMs
      : repeatEnabled && completedRuns > 0
        ? anchorMs + intervalMs
        : nowMs;
  const nextRunAt = nextDueMs === null || Number.isNaN(nextDueMs)
    ? null
    : new Date(nextDueMs).toISOString();
  const ready = scheduleMode === 'immediate'
    ? !runLimitReached && (nextDueMs === null || nextDueMs <= nowMs)
    : scheduleMode === 'deferred'
      ? !runLimitReached && nextDueMs !== null && !Number.isNaN(nextDueMs) && nextDueMs <= nowMs
      : false;
  const state = scheduleMode === 'disabled'
    ? 'disabled'
    : runLimitReached
      ? 'exhausted'
      : scheduleMode === 'manual'
        ? 'manual_hold'
        : ready
          ? completedRuns > 0 && repeatEnabled ? 'catch_up_due' : 'due'
          : 'waiting';

  return {
    contract: 'operator-userland.cli-claim.lifecycle-schedule-cursor.v1',
    supplied: cursorSupplied,
    completedRuns,
    maxRuns: scheduleMaxRuns.value,
    remainingRuns: Math.max(0, scheduleMaxRuns.value - completedRuns),
    runLimitReached,
    lastRunAt,
    lastRunValid,
    nextRunAt,
    ready,
    repeatEnabled,
    intervalMs,
    state,
    reasonCodes: stableList([
      ...(completedRunsValid ? [] : ['completed_runs_invalid']),
      ...(lastRunValid ? [] : ['last_run_at_invalid']),
      ...(runLimitReached ? ['schedule_run_limit_reached'] : []),
      ...(ready && completedRuns > 0 && repeatEnabled ? ['interval_catch_up_due'] : [])
    ])
  };
}

function normalizeLifecycleControls(input = {}, now) {
  const lifecycle = input.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const controls = lifecycle.controls && typeof lifecycle.controls === 'object' ? lifecycle.controls : {};
  const schedule = input.schedule && typeof input.schedule === 'object'
    ? input.schedule
    : lifecycle.schedule && typeof lifecycle.schedule === 'object'
      ? lifecycle.schedule
      : {};
  const requestedCommand = normalizeLifecycleCommand(
    input.command || input.lifecycleCommand || lifecycle.command || controls.command
  );
  const command = LIFECYCLE_COMMANDS.includes(requestedCommand) ? requestedCommand : 'claim';
  const enabledBySetting = normalizeBoolean(
    controls.enabled ?? lifecycle.enabled ?? settings.enabled,
    true
  );
  const enabled = command === 'disable' ? false : command === 'enable' ? true : enabledBySetting;
  const attachEnabledBySetting = normalizeBoolean(controls.attachEnabled ?? settings.attachEnabled, true);
  const attachEnabled = command === 'enable'
    ? normalizeBoolean(controls.attach ?? controls.attachEnabled ?? settings.attachEnabled, attachEnabledBySetting)
    : command === 'disable' && normalizeBoolean(controls.attach ?? lifecycle.attachOnly ?? settings.attachOnly)
      ? false
      : attachEnabledBySetting;
  const maxConcurrentClaims = normalizeLifecycleBoundedInteger(
    controls.maxConcurrentClaims ?? settings.maxConcurrentClaims,
    LIFECYCLE_SETTING_LIMITS.maxConcurrentClaims
  );
  const scheduleInterval = normalizeLifecycleBoundedInteger(
    schedule.intervalMs ?? lifecycle.intervalMs,
    LIFECYCLE_SETTING_LIMITS.scheduleIntervalMs,
    { allowZero: true }
  );
  const scheduleMaxRuns = normalizeLifecycleBoundedInteger(
    schedule.maxRuns ?? lifecycle.maxRuns,
    LIFECYCLE_SETTING_LIMITS.scheduleMaxRuns
  );
  const requestedMode = String(schedule.mode || lifecycle.scheduleMode || '').trim();
  const inferredMode = command === 'schedule' ? 'deferred' : enabled ? 'immediate' : 'disabled';
  const scheduleMode = SCHEDULE_MODES.includes(requestedMode) ? requestedMode : inferredMode;
  const notBeforeRaw = schedule.notBefore || lifecycle.notBefore || null;
  const notBefore = notBeforeRaw ? String(notBeforeRaw).trim() : null;
  const notBeforeMs = notBefore ? Date.parse(notBefore) : null;
  const invalidScheduleTime = notBefore !== null && Number.isNaN(notBeforeMs);
  const scheduleCursor = normalizeLifecycleScheduleCursor({
    schedule,
    lifecycle,
    now,
    scheduleMode,
    notBefore,
    notBeforeMs,
    scheduleInterval,
    scheduleMaxRuns
  });
  const scheduleReady = scheduleCursor.ready;
  const previousState = enabledBySetting
    ? attachEnabledBySetting ? 'enabled' : 'claim_only'
    : 'disabled';
  const desiredState = enabled
    ? attachEnabled ? 'enabled' : 'claim_only'
    : 'disabled';
  const transitionOperation = command === 'enable' || command === 'disable'
    ? 'persist_lifecycle_settings'
    : command === 'schedule'
      ? 'persist_schedule'
      : 'read_lifecycle_settings';
  const settingsValidationCodes = stableList([
    ...(maxConcurrentClaims.valid ? [] : ['lifecycle_concurrency_invalid']),
    ...(scheduleInterval.valid ? [] : ['lifecycle_schedule_interval_invalid']),
    ...(scheduleMaxRuns.valid ? [] : ['lifecycle_schedule_runs_invalid']),
    ...(scheduleCursor.lastRunValid && scheduleCursor.reasonCodes.every((code) => code !== 'completed_runs_invalid') ? [] : ['lifecycle_schedule_cursor_invalid']),
    ...(command === 'attach' && !attachEnabled ? ['lifecycle_enable_attach_conflict'] : [])
  ]);
  const nextRunAt = invalidScheduleTime ? null : scheduleCursor.nextRunAt;
  const lifecyclePatch = {
    enabled,
    attachEnabled,
    maxConcurrentClaims: maxConcurrentClaims.value,
    scheduleMode,
    scheduleIntervalMs: scheduleInterval.value,
    scheduleMaxRuns: scheduleMaxRuns.value,
    notBefore: scheduleMode === 'deferred' ? notBefore : null,
    scheduleCursor: {
      completedRuns: scheduleCursor.completedRuns,
      lastRunAt: scheduleCursor.lastRunAt,
      nextRunAt: scheduleCursor.nextRunAt,
      state: scheduleCursor.state
    }
  };
  const settingDeltas = stableList([
    ...(enabledBySetting === enabled ? [] : ['enabled']),
    ...(attachEnabledBySetting === attachEnabled ? [] : ['attachEnabled']),
    ...(maxConcurrentClaims.supplied ? ['maxConcurrentClaims'] : []),
    ...(command === 'schedule' || requestedMode ? ['scheduleMode'] : []),
    ...(scheduleInterval.supplied ? ['scheduleIntervalMs'] : []),
    ...(scheduleMaxRuns.supplied ? ['scheduleMaxRuns'] : []),
    ...(notBefore ? ['notBefore'] : []),
    ...(command === 'schedule' && scheduleCursor.supplied ? ['scheduleCursor'] : [])
  ]);
  const schedulePersistenceRequired = command === 'schedule'
    || scheduleInterval.supplied
    || scheduleMaxRuns.supplied
    || Boolean(notBefore)
    || Boolean(requestedMode);
  const lifecycleMutationRequired = ['persist_lifecycle_settings', 'persist_schedule'].includes(transitionOperation)
    || settingDeltas.length > 0;
  const scheduleWindowState = scheduleCursor.state;
  const operatorCommands = stableList([
    command === 'disable' ? 'enable' : null,
    !enabled ? 'enable' : null,
    command === 'attach' && !attachEnabled ? 'enable --attach' : null,
    scheduleMode === 'deferred' && !notBefore ? 'schedule --not-before <iso8601>' : null,
    scheduleMode === 'deferred' && notBefore && !scheduleReady ? `status --until=${notBefore}` : null,
    scheduleMode === 'manual' ? 'schedule --mode immediate' : null,
    scheduleCursor.runLimitReached ? 'schedule --max-runs <new-limit>' : null,
    scheduleCursor.reasonCodes.includes('last_run_at_invalid') ? 'schedule --reset-cursor' : null,
    settingsValidationCodes.length > 0 ? 'settings --validate' : null
  ]);

  return {
    contract: 'operator-userland.cli-claim.lifecycle-controls.v1',
    command,
    requestedCommand,
    settings: {
      enabled,
      attachEnabled,
      requireAuditProof: normalizeBoolean(controls.requireAuditProof ?? settings.requireAuditProof, true),
      allowDegradedAttach: normalizeBoolean(controls.allowDegradedAttach ?? settings.allowDegradedAttach),
      dryRun: command === 'dry_run' || normalizeBoolean(controls.dryRun ?? settings.dryRun),
      maxConcurrentClaims: maxConcurrentClaims.value
    },
    schedule: {
      mode: scheduleMode,
      notBefore,
      ready: scheduleReady,
      intervalMs: scheduleInterval.value,
      maxRuns: scheduleMaxRuns.value,
      cursor: scheduleCursor
    },
    commandPlan: {
      contract: 'operator-userland.cli-claim.lifecycle-command-plan.v1',
      command,
      desiredState,
      patch: lifecyclePatch,
      settingDeltas,
      applyAllowed: settingsValidationCodes.length === 0
        && !invalidScheduleTime
        && LIFECYCLE_COMMANDS.includes(requestedCommand)
        && !(requestedMode && !SCHEDULE_MODES.includes(requestedMode))
        && !(scheduleMode === 'deferred' && !notBefore),
      mutationRequired: lifecycleMutationRequired,
      persistenceTarget: command === 'schedule' || schedulePersistenceRequired
        ? 'schedule_store'
        : command === 'enable' || command === 'disable' || settingDeltas.length > 0
          ? 'settings_store'
          : 'none',
      scheduleWindow: {
        mode: scheduleMode,
        state: scheduleWindowState,
        nextRunAt,
        readyAt: scheduleMode === 'deferred' ? notBefore : now,
        repeat: scheduleInterval.value > 0,
        intervalMs: scheduleInterval.value,
        completedRuns: scheduleCursor.completedRuns,
        remainingRuns: scheduleCursor.remainingRuns,
        cursor: scheduleCursor
      },
      controls: {
        claimEvaluationAllowed: enabled && settingsValidationCodes.length === 0,
        attachAllowed: enabled && attachEnabled && settingsValidationCodes.length === 0,
        disabledByCommand: command === 'disable',
        attachToggledByCommand: command === 'enable' || command === 'disable'
      },
      nextOperatorCommands: operatorCommands
    },
    settingsPolicy: {
      contract: 'operator-userland.cli-claim.lifecycle-settings-policy.v1',
      limits: LIFECYCLE_SETTING_LIMITS,
      normalized: {
        maxConcurrentClaims,
        scheduleIntervalMs: scheduleInterval,
        scheduleMaxRuns
      },
      validation: {
        ok: settingsValidationCodes.length === 0,
        reasonCodes: settingsValidationCodes
      }
    },
    transition: {
      contract: 'operator-userland.cli-claim.lifecycle-transition.v1',
      previousState,
      desiredState,
      operation: transitionOperation,
      mutationRequired: lifecycleMutationRequired,
      stateChanged: previousState !== desiredState || command === 'schedule' || settingDeltas.length > 0,
      settingDeltas,
      patch: lifecyclePatch,
      enableAttachConflict: command === 'attach' && !attachEnabled,
      auditRecordType: command === 'enable'
        ? 'lifecycle_enabled'
        : command === 'disable'
          ? 'lifecycle_disabled'
          : command === 'schedule'
            ? 'lifecycle_scheduled'
            : 'lifecycle_observed'
    },
    validation: {
      unsupportedCommand: !LIFECYCLE_COMMANDS.includes(requestedCommand),
      invalidScheduleMode: Boolean(requestedMode && !SCHEDULE_MODES.includes(requestedMode)),
      invalidScheduleTime,
      invalidSettings: settingsValidationCodes.length > 0,
      invalidScheduleCursor: settingsValidationCodes.includes('lifecycle_schedule_cursor_invalid')
    }
  };
}

function validateLifecycleControls(lifecycleControls) {
  const findings = [];
  if (lifecycleControls.validation.unsupportedCommand) {
    findings.push({ code: 'lifecycle_command_unsupported', severity: 'error', field: 'lifecycle.command' });
  }
  if (lifecycleControls.validation.invalidScheduleMode) {
    findings.push({ code: 'lifecycle_schedule_mode_invalid', severity: 'error', field: 'lifecycle.schedule.mode' });
  }
  if (lifecycleControls.validation.invalidScheduleTime) {
    findings.push({ code: 'lifecycle_schedule_time_invalid', severity: 'error', field: 'lifecycle.schedule.notBefore' });
  }
  if (!lifecycleControls.settingsPolicy.normalized.maxConcurrentClaims.valid) {
    findings.push({
      code: 'lifecycle_concurrency_invalid',
      severity: 'error',
      field: 'settings.maxConcurrentClaims',
      reasonCodes: lifecycleControls.settingsPolicy.normalized.maxConcurrentClaims.reasonCodes
    });
  }
  if (!lifecycleControls.settingsPolicy.normalized.scheduleIntervalMs.valid) {
    findings.push({
      code: 'lifecycle_schedule_interval_invalid',
      severity: 'error',
      field: 'lifecycle.schedule.intervalMs',
      reasonCodes: lifecycleControls.settingsPolicy.normalized.scheduleIntervalMs.reasonCodes
    });
  }
  if (!lifecycleControls.settingsPolicy.normalized.scheduleMaxRuns.valid) {
    findings.push({
      code: 'lifecycle_schedule_runs_invalid',
      severity: 'error',
      field: 'lifecycle.schedule.maxRuns',
      reasonCodes: lifecycleControls.settingsPolicy.normalized.scheduleMaxRuns.reasonCodes
    });
  }
  if (lifecycleControls.validation.invalidScheduleCursor) {
    findings.push({
      code: 'lifecycle_schedule_cursor_invalid',
      severity: 'error',
      field: 'lifecycle.schedule.cursor',
      reasonCodes: lifecycleControls.schedule.cursor.reasonCodes
    });
  }
  if (!lifecycleControls.settings.enabled && !['enable', 'status', 'disable'].includes(lifecycleControls.command)) {
    findings.push({ code: 'lifecycle_disabled', severity: 'error', field: 'settings.enabled' });
  }
  if (!lifecycleControls.settings.attachEnabled && lifecycleControls.command === 'attach') {
    findings.push({
      code: 'lifecycle_attach_disabled',
      severity: 'error',
      field: 'settings.attachEnabled',
      reasonCodes: stableList([
        'attach_control_disabled',
        ...(lifecycleControls.transition.enableAttachConflict ? ['enable_attach_conflict'] : [])
      ])
    });
  }
  if (lifecycleControls.schedule.mode === 'deferred' && !lifecycleControls.schedule.notBefore) {
    findings.push({ code: 'lifecycle_schedule_time_missing', severity: 'error', field: 'lifecycle.schedule.notBefore' });
  }

  return findings;
}

function normalizeProviderServiceContract(input = {}, lifecycleControls, now) {
  const integration = input.integration && typeof input.integration === 'object' ? input.integration : {};
  const provider = input.provider && typeof input.provider === 'object'
    ? input.provider
    : integration.provider && typeof integration.provider === 'object'
      ? integration.provider
      : {};
  const sync = provider.sync && typeof provider.sync === 'object'
    ? provider.sync
    : integration.sync && typeof integration.sync === 'object'
      ? integration.sync
      : {};
  const handoff = provider.handoff && typeof provider.handoff === 'object'
    ? provider.handoff
    : integration.handoffState && typeof integration.handoffState === 'object'
      ? integration.handoffState
      : {};
  const profileName = String(
    provider.profile
      || provider.providerProfile
      || integration.profile
      || integration.providerProfile
      || ''
  ).trim().toLowerCase();
  const serviceProfile = PROVIDER_SERVICE_PROFILES[profileName] || null;
  const capabilities = stableList(
    provider.capabilities
      || integration.capabilities
      || serviceProfile?.capabilities
      || DEFAULT_PROVIDER_CAPABILITIES
  );
  const requiredCapabilities = stableList(
    provider.requiredCapabilities || COMMAND_PROVIDER_CAPABILITIES[lifecycleControls.command] || ['sync.metadata']
  );
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const lastSyncedAt = String(sync.lastSyncedAt || sync.at || now).trim() || null;
  const lastSyncMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;
  const nowMs = Date.parse(now);
  const syncStaleAfterMs = normalizePositiveInteger(
    sync.staleAfterMs ?? provider.syncStaleAfterMs,
    serviceProfile?.syncStaleAfterMs || 60000
  );
  const syncAgeMs = lastSyncMs !== null && !Number.isNaN(lastSyncMs) && !Number.isNaN(nowMs)
    ? Math.max(0, nowMs - lastSyncMs)
    : null;
  const pendingOutbound = normalizePositiveInteger(sync.pendingOutbound ?? sync.pendingMutations, 0);
  const pendingOutboundWarnAt = normalizePositiveInteger(
    sync.pendingOutboundWarnAt ?? provider.pendingOutboundWarnAt,
    serviceProfile?.pendingOutboundWarnAt || 10
  );
  const handoffRequired = lifecycleControls.command === 'attach'
    || lifecycleControls.command === 'schedule'
    || normalizeBoolean(handoff.required ?? provider.handoffRequired);
  const handoffTarget = String(
    handoff.target
      || provider.target
      || integration.target
      || serviceProfile?.handoffTarget
      || 'hosted-kernel.operator-userland.claims'
  ).trim();
  const handoffState = String(handoff.state || handoff.status || (handoffRequired ? 'pending' : 'optional')).trim();
  const providerId = String(provider.providerId || provider.id || integration.providerId || 'hosted-kernel-provider').trim();
  const service = String(provider.service || integration.service || serviceProfile?.service || 'operator-userland-cli-claim').trim();
  const protocol = String(provider.protocol || integration.protocol || serviceProfile?.protocol || 'stdio-json').trim();
  const syncFresh = syncAgeMs !== null && syncAgeMs <= syncStaleAfterMs;
  const handoffReady = !handoffRequired || ['ready', 'accepted', 'attached'].includes(handoffState);
  const serviceContractId = [
    providerId,
    service,
    protocol,
    lifecycleControls.command,
    requiredCapabilities.join('+')
  ].join(':');
  const readinessReasons = stableList([
    ...(missingCapabilities.length > 0 ? ['missing_capabilities'] : []),
    ...(lastSyncedAt ? [] : ['sync_missing']),
    ...(syncFresh ? [] : ['sync_stale']),
    ...(pendingOutbound > pendingOutboundWarnAt ? ['sync_backpressure'] : []),
    ...(handoffReady ? [] : ['handoff_not_ready'])
  ]);
  const serviceReadiness = readinessReasons.length === 0
    ? 'ready'
    : missingCapabilities.length > 0 || !lastSyncedAt || (handoffRequired && !handoffReady)
      ? 'blocked'
      : 'degraded';
  const mailchimpContext = normalizeMailchimpMarketingContext({
    input,
    provider,
    integration,
    lifecycleControls,
    serviceProfile,
    providerId,
    service,
    syncFresh,
    pendingOutbound
  });

  return {
    contract: 'operator-userland.cli-claim.provider-service.v1',
    providerId,
    service,
    protocol,
    profile: serviceProfile ? profileName : null,
    serviceContractId,
    capabilities,
    negotiation: {
      command: lifecycleControls.command,
      requiredCapabilities,
      missingCapabilities,
      compatible: missingCapabilities.length === 0,
      optionalProfileCapabilities: serviceProfile
        ? serviceProfile.capabilities.filter((capability) => !requiredCapabilities.includes(capability))
        : []
    },
    sync: {
      cursor: String(sync.cursor || sync.token || '').trim() || null,
      revision: normalizePositiveInteger(sync.revision ?? sync.version, 1),
      lastSyncedAt,
      syncAgeMs,
      staleAfterMs: syncStaleAfterMs,
      fresh: syncFresh,
      pendingOutbound,
      pendingOutboundWarnAt,
      backpressure: pendingOutbound > pendingOutboundWarnAt
    },
    handoff: {
      required: handoffRequired,
      target: handoffTarget,
      externalStateId: String(handoff.externalStateId || handoff.stateId || '').trim() || null,
      correlationId: String(handoff.correlationId || input.correlationId || '').trim() || null,
      state: handoffState,
      ready: handoffReady
    },
    mailchimp: mailchimpContext,
    readiness: {
      contract: 'operator-userland.cli-claim.provider-service-readiness.v1',
      state: serviceReadiness,
      ready: serviceReadiness === 'ready',
      degraded: serviceReadiness === 'degraded',
      blocked: serviceReadiness === 'blocked',
      reasonCodes: readinessReasons,
      nextProviderAction: serviceReadiness === 'ready'
        ? 'accept-claim-command'
        : missingCapabilities.length > 0
          ? 'negotiate-required-capabilities'
          : !lastSyncedAt || !syncFresh
            ? 'refresh-provider-sync'
            : pendingOutbound > pendingOutboundWarnAt
              ? 'drain-provider-outbound-queue'
              : 'await-provider-handoff-ready'
    }
  };
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function normalizeMailchimpMarketingContext({
  input,
  provider,
  integration,
  lifecycleControls,
  serviceProfile,
  providerId,
  service,
  syncFresh,
  pendingOutbound
}) {
  const root = firstObject(input.mailchimp, provider.mailchimp, integration.mailchimp);
  const campaign = firstObject(root.campaign, provider.campaign, integration.campaign);
  const audience = firstObject(root.audience, provider.audience, integration.audience);
  const profileEnabled = serviceProfile?.service === 'mailchimp-marketing'
    || String(provider.profile || provider.providerProfile || integration.profile || integration.providerProfile || '').trim().toLowerCase() === 'mailchimp'
    || service === 'mailchimp-marketing'
    || Object.keys(root).length > 0;
  const campaignId = String(
    root.campaignId
      || campaign.campaignId
      || campaign.id
      || provider.campaignId
      || integration.campaignId
      || ''
  ).trim() || null;
  const audienceId = String(
    root.audienceId
      || root.listId
      || audience.audienceId
      || audience.listId
      || audience.id
      || provider.audienceId
      || provider.listId
      || integration.audienceId
      || ''
  ).trim() || null;
  const rawCampaignStatus = String(
    root.campaignStatus
      || campaign.status
      || provider.campaignStatus
      || 'unknown'
  ).trim().toLowerCase();
  const campaignStatus = MAILCHIMP_CAMPAIGN_STATUSES.includes(rawCampaignStatus) ? rawCampaignStatus : 'unknown';
  const segmentIds = stableList([
    ...stableList(root.segmentIds || root.segments),
    ...stableList(campaign.segmentIds || campaign.segments),
    ...stableList(audience.segmentIds || audience.segments)
  ]);
  const mergeTags = stableList(root.mergeTags || campaign.mergeTags || audience.mergeTags);
  const templateId = String(root.templateId || campaign.templateId || campaign.template_id || '').trim() || null;
  const previewUrl = String(root.previewUrl || campaign.previewUrl || campaign.archiveUrl || '').trim() || null;
  const requiresCampaign = ['claim', 'attach', 'schedule', 'dry_run'].includes(lifecycleControls.command);
  const requiresAudience = ['claim', 'attach', 'schedule', 'dry_run'].includes(lifecycleControls.command);
  const sentCampaignMutation = ['claim', 'attach', 'schedule'].includes(lifecycleControls.command)
    && ['sent', 'archived'].includes(campaignStatus);
  const lifecycleGate = buildMailchimpLifecycleGate({
    lifecycleControls,
    profileEnabled,
    campaignId,
    audienceId,
    campaignStatus,
    syncFresh,
    pendingOutbound
  });
  const publishGuard = buildMailchimpPublishGuard({
    lifecycleControls,
    profileEnabled,
    campaignId,
    audienceId,
    campaignStatus,
    lifecycleGate,
    syncFresh,
    pendingOutbound,
    providerId,
    service
  });
  const reasonCodes = stableList([
    ...(profileEnabled ? [] : ['mailchimp_profile_not_selected']),
    ...(requiresCampaign && !campaignId ? ['mailchimp_campaign_missing'] : []),
    ...(requiresAudience && !audienceId ? ['mailchimp_audience_missing'] : []),
    ...(sentCampaignMutation ? ['mailchimp_campaign_already_terminal'] : []),
    ...(syncFresh ? [] : ['mailchimp_sync_stale']),
    ...(pendingOutbound > 0 ? ['mailchimp_pending_outbound'] : []),
    ...lifecycleGate.reasonCodes.filter((code) => code !== 'mailchimp_lifecycle_ready'),
    ...publishGuard.reasonCodes.filter((code) => code !== 'mailchimp_publish_ready')
  ]);
  const ready = profileEnabled
    && (!requiresCampaign || Boolean(campaignId))
    && (!requiresAudience || Boolean(audienceId))
    && !sentCampaignMutation
    && syncFresh
    && lifecycleGate.ready
    && publishGuard.ready;

  return {
    contract: 'operator-userland.cli-claim.mailchimp-marketing-context.v1',
    enabled: profileEnabled,
    providerId,
    command: lifecycleControls.command,
    ready,
    state: ready
      ? 'ready'
      : reasonCodes.includes('mailchimp_campaign_already_terminal') || lifecycleGate.state === 'blocked'
        ? 'blocked'
        : 'attention',
    reasonCodes,
    campaign: {
      campaignId,
      status: campaignStatus,
      templateId,
      previewUrl,
      requiresCampaign
    },
    audience: {
      audienceId,
      segmentIds,
      mergeTags,
      requiresAudience
    },
    lifecycleGate,
    publishGuard,
    exportLabels: stableList([
      campaignId ? `campaign:${campaignId}` : null,
      audienceId ? `audience:${audienceId}` : null,
      ...segmentIds.map((segmentId) => `segment:${segmentId}`)
    ]),
    nextProviderAction: ready
      ? 'accept-mailchimp-claim'
      : !campaignId && requiresCampaign
        ? 'select-mailchimp-campaign'
        : !audienceId && requiresAudience
          ? 'select-mailchimp-audience'
          : sentCampaignMutation
            ? 'duplicate-or-reopen-mailchimp-campaign'
            : !lifecycleGate.ready
              ? lifecycleGate.nextProviderAction
            : !syncFresh
              ? 'refresh-mailchimp-sync'
              : 'drain-mailchimp-outbound'
  };
}

function buildMailchimpPublishGuard({
  lifecycleControls,
  profileEnabled,
  campaignId,
  audienceId,
  campaignStatus,
  lifecycleGate,
  syncFresh,
  pendingOutbound,
  providerId,
  service
}) {
  const mutationCommand = ['claim', 'attach', 'schedule'].includes(lifecycleControls.command);
  const terminalCampaign = ['sent', 'archived'].includes(campaignStatus);
  const contextComplete = Boolean(campaignId && audienceId);
  const dryRun = lifecycleControls.settings.dryRun;
  const publishIntent = mutationCommand && !dryRun;
  const lifecycleClear = lifecycleGate.ready && lifecycleGate.state === 'ready';
  const syncClear = syncFresh && pendingOutbound === 0;
  const ready = !profileEnabled || !publishIntent || (
    contextComplete &&
    !terminalCampaign &&
    lifecycleClear &&
    syncClear
  );
  const blocked = profileEnabled && publishIntent && (
    !contextComplete ||
    terminalCampaign ||
    lifecycleGate.state === 'blocked'
  );
  const waiting = profileEnabled && publishIntent && !ready && !blocked;
  const reasonCodes = stableList([
    ...(profileEnabled ? [] : ['mailchimp_profile_not_selected']),
    ...(publishIntent ? ['mailchimp_publish_intent'] : ['mailchimp_publish_not_required']),
    ...(contextComplete ? [] : [
      ...(campaignId ? [] : ['mailchimp_campaign_missing']),
      ...(audienceId ? [] : ['mailchimp_audience_missing'])
    ]),
    ...(terminalCampaign ? ['mailchimp_campaign_already_terminal'] : []),
    ...(lifecycleClear ? [] : lifecycleGate.reasonCodes.filter((code) => code !== 'mailchimp_lifecycle_ready')),
    ...(syncFresh ? [] : ['mailchimp_sync_stale']),
    ...(pendingOutbound === 0 ? [] : ['mailchimp_pending_outbound']),
    ...(ready ? ['mailchimp_publish_ready'] : [])
  ]);
  const nextProviderAction = ready
    ? 'publish-mailchimp-claim'
    : !campaignId
      ? 'select-mailchimp-campaign'
      : !audienceId
        ? 'select-mailchimp-audience'
        : terminalCampaign
          ? 'duplicate-or-reopen-mailchimp-campaign'
          : !lifecycleClear
            ? lifecycleGate.nextProviderAction
            : !syncFresh
              ? 'refresh-mailchimp-sync'
              : pendingOutbound > 0
                ? 'drain-mailchimp-outbound'
                : 'observe-mailchimp-publish-guard';

  return {
    contract: 'operator-userland.cli-claim.mailchimp-publish-guard.v1',
    enabled: Boolean(profileEnabled),
    command: lifecycleControls.command,
    publishIntent,
    ready,
    state: !profileEnabled
      ? 'not_configured'
      : !publishIntent
        ? 'not_required'
        : ready
          ? 'ready'
          : blocked
            ? 'blocked'
            : waiting
              ? 'waiting'
              : 'attention',
    providerId,
    service,
    campaign: {
      campaignId,
      status: campaignStatus,
      mutable: !terminalCampaign
    },
    audience: {
      audienceId,
      selected: Boolean(audienceId)
    },
    lifecycle: {
      state: lifecycleGate.state,
      ready: lifecycleGate.ready,
      nextProviderAction: lifecycleGate.nextProviderAction
    },
    providerSync: {
      fresh: syncFresh,
      pendingOutbound,
      clearForPublish: syncClear
    },
    reasonCodes,
    blockingCodes: reasonCodes.filter((code) => ![
      'mailchimp_publish_intent',
      'mailchimp_publish_not_required',
      'mailchimp_publish_ready',
      'mailchimp_lifecycle_ready'
    ].includes(code)),
    nextProviderAction,
    nextOperatorCommand: ready
      ? `claim --mailchimp-campaign=${campaignId} --mailchimp-audience=${audienceId}`
      : nextProviderAction === 'select-mailchimp-campaign'
        ? 'claim --mailchimp-campaign <campaign-id>'
        : nextProviderAction === 'select-mailchimp-audience'
          ? 'claim --mailchimp-audience <audience-id>'
          : nextProviderAction === 'duplicate-or-reopen-mailchimp-campaign'
            ? 'claim --duplicate-mailchimp-campaign'
            : nextProviderAction === 'refresh-mailchimp-sync'
              ? 'status --sync --retry --provider mailchimp'
              : nextProviderAction === 'drain-mailchimp-outbound'
                ? 'status --drain-outbound --provider mailchimp'
                : lifecycleGate.nextOperatorCommand
  };
}

function buildMailchimpClaimAcceptanceHandoff({
  providerContract,
  lifecycleControls,
  scope,
  clientRuntime,
  boundaryExecution,
  persistedState,
  previewVerdict,
  accepted = false,
  now
}) {
  const mailchimp = providerContract.mailchimp;
  if (!mailchimp.enabled) {
    return {
      contract: 'operator-userland.cli-claim.mailchimp-acceptance-handoff.v1',
      enabled: false,
      ready: true,
      state: 'not_configured',
      reasonCodes: [],
      validationSummary: {
        ok: true,
        blockingCodes: [],
        warningCodes: []
      },
      nextStep: {
        action: 'continue_claim_acceptance',
        clientCommand: clientRuntime.workflowHandoff.commandHints.primary,
        providerAction: null,
        requiresProviderHandoff: false
      },
      generatedAt: now
    };
  }

  const mutationCommand = ['claim', 'attach', 'schedule'].includes(lifecycleControls.command);
  const blockingCodes = stableList([
    ...mailchimp.reasonCodes,
    ...(boundaryExecution.acceptance.allowed ? [] : boundaryExecution.acceptance.reasonCodes),
    ...(persistedState.boundary.safeForReplay ? [] : persistedState.boundary.reasonCodes),
    ...(mutationCommand && !providerContract.handoff.ready ? ['provider_handoff_not_ready'] : []),
    ...(mutationCommand && providerContract.sync.pendingOutbound > 0 ? ['provider_sync_pending'] : [])
  ]);
  const ready = mailchimp.ready
    && boundaryExecution.acceptance.allowed
    && persistedState.boundary.safeForReplay
    && (!mutationCommand || providerContract.handoff.ready)
    && blockingCodes.length === 0;
  const state = accepted
    ? 'accepted'
    : ready
      ? 'ready'
      : mailchimp.state === 'blocked'
        ? 'blocked'
        : 'attention';
  const route = `mailchimp://campaigns/${mailchimp.campaign.campaignId || 'unselected'}/claims/${clientRuntime.request.requestId}`;

  return {
    contract: 'operator-userland.cli-claim.mailchimp-acceptance-handoff.v1',
    enabled: true,
    ready,
    state,
    requestId: clientRuntime.request.requestId,
    command: lifecycleControls.command,
    tenantId: scope.requestedTenantId,
    workspaceId: scope.requestedWorkspaceId,
    providerId: providerContract.providerId,
    serviceContractId: providerContract.serviceContractId,
    campaign: mailchimp.campaign,
    audience: mailchimp.audience,
    lifecycleGate: mailchimp.lifecycleGate,
    route,
    previewVerdict,
    reasonCodes: blockingCodes,
    validationSummary: {
      ok: ready,
      blockingCodes,
      warningCodes: stableList([
        ...(providerContract.sync.backpressure ? ['provider_sync_backpressure'] : []),
        ...(mailchimp.campaign.previewUrl ? [] : ['mailchimp_preview_url_missing'])
      ]),
      campaignMutable: !['sent', 'archived'].includes(mailchimp.campaign.status),
      providerSyncFresh: providerContract.sync.fresh,
      pendingOutbound: providerContract.sync.pendingOutbound,
      boundaryAccepted: boundaryExecution.acceptance.allowed,
      persistedBoundarySafe: persistedState.boundary.safeForReplay
    },
    nextStep: {
      action: accepted ? 'record_mailchimp_acceptance' : ready ? 'accept_mailchimp_claim' : mailchimp.nextProviderAction,
      clientCommand: ready
        ? clientRuntime.workflowHandoff.commandHints.accept
        : clientRuntime.workflowHandoff.commandHints.primary,
      providerAction: mailchimp.nextProviderAction,
      requiresProviderHandoff: mutationCommand,
      payloadRef: ready ? 'previewRoute.acceptance.payload.mailchimpAcceptance' : 'previewRoute.mailchimpAcceptance.validationSummary'
    },
    auditHandoff: {
      stream: `${scope.requestedTenantId}/${scope.requestedWorkspaceId}/cli-claim.mailchimp-acceptance`,
      recordType: accepted ? 'mailchimp_acceptance_recorded' : ready ? 'mailchimp_acceptance_ready' : 'mailchimp_acceptance_blocked',
      exportLabels: mailchimp.exportLabels,
      correlationId: providerContract.handoff.correlationId || clientRuntime.request.requestId
    },
    generatedAt: now
  };
}

function buildMailchimpLifecycleGate({
  lifecycleControls,
  profileEnabled,
  campaignId,
  audienceId,
  campaignStatus,
  syncFresh,
  pendingOutbound
}) {
  const commandRequiresMutation = ['claim', 'attach', 'schedule'].includes(lifecycleControls.command);
  const scheduleReady = lifecycleControls.schedule.ready;
  const settingsValid = lifecycleControls.settingsPolicy.validation.ok
    && !lifecycleControls.validation.unsupportedCommand
    && !lifecycleControls.validation.invalidScheduleMode
    && !lifecycleControls.validation.invalidScheduleTime;
  const enabled = Boolean(profileEnabled);
  const campaignMutable = !['sent', 'archived'].includes(campaignStatus);
  const contextComplete = Boolean(campaignId && audienceId);
  const lifecycleEnabled = lifecycleControls.settings.enabled;
  const attachAllowed = lifecycleControls.command !== 'attach' || lifecycleControls.settings.attachEnabled;
  const providerReady = syncFresh && pendingOutbound === 0;
  const ready = enabled
    && contextComplete
    && campaignMutable
    && lifecycleEnabled
    && scheduleReady
    && settingsValid
    && attachAllowed
    && providerReady;
  const reasonCodes = stableList([
    ...(enabled ? [] : ['mailchimp_profile_not_selected']),
    ...(campaignId ? [] : ['mailchimp_campaign_missing']),
    ...(audienceId ? [] : ['mailchimp_audience_missing']),
    ...(campaignMutable ? [] : ['mailchimp_campaign_already_terminal']),
    ...(lifecycleEnabled ? [] : ['lifecycle_disabled']),
    ...(scheduleReady ? [] : ['deferred_schedule']),
    ...(settingsValid ? [] : ['lifecycle_settings_invalid']),
    ...(attachAllowed ? [] : ['lifecycle_attach_disabled']),
    ...(syncFresh ? [] : ['mailchimp_sync_stale']),
    ...(pendingOutbound === 0 ? [] : ['mailchimp_pending_outbound']),
    ...(ready ? ['mailchimp_lifecycle_ready'] : ['mailchimp_lifecycle_not_ready'])
  ]);
  const nextProviderAction = ready
    ? 'accept-mailchimp-claim'
    : !campaignId
      ? 'select-mailchimp-campaign'
      : !audienceId
        ? 'select-mailchimp-audience'
        : !campaignMutable
          ? 'duplicate-or-reopen-mailchimp-campaign'
          : !lifecycleEnabled
            ? 'enable-claim-lifecycle'
            : !scheduleReady
              ? 'wait-for-lifecycle-schedule'
              : !settingsValid
                ? 'repair-lifecycle-settings'
                : !attachAllowed
                  ? 'enable-mailchimp-attach'
                  : !syncFresh
                    ? 'refresh-mailchimp-sync'
                    : 'drain-mailchimp-outbound';

  return {
    contract: 'operator-userland.cli-claim.mailchimp-lifecycle-gate.v1',
    enabled,
    ready,
    state: !enabled
      ? 'not_configured'
      : ready
        ? 'ready'
        : !campaignMutable || !lifecycleEnabled || !settingsValid || !attachAllowed
          ? 'blocked'
          : 'attention',
    command: lifecycleControls.command,
    commandRequiresMutation,
    campaign: {
      campaignId,
      status: campaignStatus,
      mutable: campaignMutable
    },
    audience: {
      audienceId,
      selected: Boolean(audienceId)
    },
    lifecycle: {
      enabled: lifecycleEnabled,
      attachEnabled: lifecycleControls.settings.attachEnabled,
      scheduleMode: lifecycleControls.schedule.mode,
      scheduleReady,
      notBefore: lifecycleControls.schedule.notBefore,
      nextRunAt: lifecycleControls.schedule.cursor.nextRunAt,
      settingsValid,
      dryRun: lifecycleControls.settings.dryRun
    },
    providerSync: {
      fresh: syncFresh,
      pendingOutbound,
      clearForMutation: providerReady
    },
    reasonCodes,
    nextProviderAction,
    nextOperatorCommand: ready
      ? `claim --mailchimp-campaign=${campaignId} --mailchimp-audience=${audienceId}`
      : nextProviderAction === 'select-mailchimp-campaign'
        ? 'claim --mailchimp-campaign <campaign-id>'
        : nextProviderAction === 'select-mailchimp-audience'
          ? 'claim --mailchimp-audience <audience-id>'
          : nextProviderAction === 'enable-claim-lifecycle'
            ? 'enable'
            : nextProviderAction === 'wait-for-lifecycle-schedule'
              ? `status --until=${lifecycleControls.schedule.notBefore || lifecycleControls.schedule.cursor.nextRunAt}`
              : nextProviderAction === 'repair-lifecycle-settings'
                ? 'settings --validate'
                : nextProviderAction === 'enable-mailchimp-attach'
                  ? 'enable --attach'
                  : nextProviderAction === 'refresh-mailchimp-sync'
                    ? 'status --sync --retry'
                    : 'status --drain-outbound'
  };
}

function validateProviderServiceContract(providerContract) {
  const findings = [];
  if (!providerContract.providerId) {
    findings.push({ code: 'provider_identity_missing', severity: 'error', field: 'provider.providerId' });
  }
  if (!providerContract.negotiation.compatible) {
    findings.push({
      code: 'provider_capability_missing',
      severity: 'error',
      field: 'provider.capabilities',
      missingCapabilities: providerContract.negotiation.missingCapabilities
    });
  }
  if (!providerContract.sync.lastSyncedAt) {
    findings.push({ code: 'provider_sync_missing', severity: 'error', field: 'provider.sync.lastSyncedAt' });
  } else if (!providerContract.sync.fresh) {
    findings.push({ code: 'provider_sync_stale', severity: 'warning', field: 'provider.sync.lastSyncedAt' });
  }
  if (providerContract.sync.pendingOutbound > 0 && providerContract.negotiation.requiredCapabilities.includes('sync.metadata')) {
    findings.push({ code: 'provider_sync_pending', severity: 'warning', field: 'provider.sync.pendingOutbound' });
  }
  if (providerContract.sync.backpressure) {
    findings.push({
      code: 'provider_sync_backpressure',
      severity: 'warning',
      field: 'provider.sync.pendingOutbound',
      pendingOutbound: providerContract.sync.pendingOutbound,
      pendingOutboundWarnAt: providerContract.sync.pendingOutboundWarnAt
    });
  }
  if (providerContract.handoff.required && !providerContract.handoff.ready) {
    findings.push({ code: 'provider_handoff_not_ready', severity: 'error', field: 'provider.handoff.state' });
  }
  if (providerContract.mailchimp.enabled && providerContract.mailchimp.reasonCodes.includes('mailchimp_campaign_missing')) {
    findings.push({ code: 'mailchimp_campaign_missing', severity: 'warning', field: 'provider.mailchimp.campaignId' });
  }
  if (providerContract.mailchimp.enabled && providerContract.mailchimp.reasonCodes.includes('mailchimp_audience_missing')) {
    findings.push({ code: 'mailchimp_audience_missing', severity: 'warning', field: 'provider.mailchimp.audienceId' });
  }
  if (providerContract.mailchimp.enabled && providerContract.mailchimp.reasonCodes.includes('mailchimp_campaign_already_terminal')) {
    findings.push({ code: 'mailchimp_campaign_already_terminal', severity: 'error', field: 'provider.mailchimp.campaign.status' });
  }
  if (providerContract.mailchimp.enabled && !providerContract.mailchimp.lifecycleGate.ready) {
    findings.push({
      code: 'mailchimp_lifecycle_not_ready',
      severity: providerContract.mailchimp.lifecycleGate.state === 'blocked' ? 'error' : 'warning',
      field: 'provider.mailchimp.lifecycleGate',
      reasonCodes: providerContract.mailchimp.lifecycleGate.reasonCodes,
      nextProviderAction: providerContract.mailchimp.lifecycleGate.nextProviderAction
    });
  }
  if (
    providerContract.mailchimp.enabled &&
    providerContract.mailchimp.publishGuard.publishIntent &&
    !providerContract.mailchimp.publishGuard.ready
  ) {
    findings.push({
      code: 'mailchimp_publish_guard_not_ready',
      severity: providerContract.mailchimp.publishGuard.state === 'blocked' ? 'error' : 'warning',
      field: 'provider.mailchimp.publishGuard',
      reasonCodes: providerContract.mailchimp.publishGuard.reasonCodes,
      nextProviderAction: providerContract.mailchimp.publishGuard.nextProviderAction
    });
  }

  return findings;
}

function normalizeProviderHandoffCheckpoint(input = {}, {
  now,
  principal,
  scope,
  providerContract,
  persistedState,
  lifecycleControls
}) {
  const integration = input.integration && typeof input.integration === 'object' ? input.integration : {};
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const handoff = provider.handoff && typeof provider.handoff === 'object'
    ? provider.handoff
    : integration.handoffState && typeof integration.handoffState === 'object'
      ? integration.handoffState
      : {};
  const checkpoint = handoff.checkpoint && typeof handoff.checkpoint === 'object'
    ? handoff.checkpoint
    : provider.handoffCheckpoint && typeof provider.handoffCheckpoint === 'object'
      ? provider.handoffCheckpoint
      : integration.handoffCheckpoint && typeof integration.handoffCheckpoint === 'object'
        ? integration.handoffCheckpoint
        : {};
  const acknowledgement = handoff.acknowledgement && typeof handoff.acknowledgement === 'object'
    ? handoff.acknowledgement
    : handoff.ack && typeof handoff.ack === 'object'
      ? handoff.ack
      : provider.handoffAcknowledgement && typeof provider.handoffAcknowledgement === 'object'
        ? provider.handoffAcknowledgement
        : integration.handoffAcknowledgement && typeof integration.handoffAcknowledgement === 'object'
          ? integration.handoffAcknowledgement
          : {};
  const expectedExternalStateId = providerContract.handoff.externalStateId || persistedState.lastKnown.restartToken || null;
  const acknowledgedExternalStateId = String(
    acknowledgement.externalStateId
      || checkpoint.externalStateId
      || acknowledgement.stateId
      || checkpoint.stateId
      || ''
  ).trim() || null;
  const acknowledgementId = String(
    acknowledgement.ackId
      || acknowledgement.id
      || checkpoint.ackId
      || checkpoint.id
      || ''
  ).trim() || null;
  const ackReceivedAtRaw = String(
    acknowledgement.receivedAt
      || checkpoint.receivedAt
      || acknowledgement.acknowledgedAt
      || checkpoint.acknowledgedAt
      || acknowledgement.updatedAt
      || checkpoint.updatedAt
      || ''
  ).trim() || null;
  const ackReceivedAtMs = ackReceivedAtRaw ? Date.parse(ackReceivedAtRaw) : null;
  const ackReceivedAtValid = ackReceivedAtRaw === null || !Number.isNaN(ackReceivedAtMs);
  const ackReceivedAt = ackReceivedAtValid && ackReceivedAtMs !== null
    ? new Date(ackReceivedAtMs).toISOString()
    : null;
  const ackAgeMs = ackReceivedAtMs !== null && ackReceivedAtValid
    ? Math.max(0, Date.parse(now) - ackReceivedAtMs)
    : null;
  const ackStaleAfterMs = normalizePositiveInteger(
    acknowledgement.staleAfterMs
      ?? checkpoint.staleAfterMs
      ?? provider.handoffAckStaleAfterMs
      ?? integration.handoffAckStaleAfterMs,
    DEFAULT_HANDOFF_ACK_STALE_AFTER_MS
  );
  const ackStale = ackAgeMs !== null && ackAgeMs > ackStaleAfterMs;
  const expectedIdempotencyKey = persistedState.idempotency.key;
  const acknowledgedIdempotencyKey = String(
    acknowledgement.idempotencyKey
      || checkpoint.idempotencyKey
      || acknowledgement.commandIdempotencyKey
      || checkpoint.commandIdempotencyKey
      || ''
  ).trim() || null;
  const idempotencySupplied = Boolean(acknowledgedIdempotencyKey);
  const idempotencyMatches = acknowledgedIdempotencyKey === expectedIdempotencyKey;
  const checkpointState = String(
    checkpoint.state
      || checkpoint.status
      || acknowledgement.state
      || acknowledgement.status
      || providerContract.handoff.state
  ).trim();
  const acceptedStates = ['accepted', 'committed', 'attached', 'scheduled'];
  const pendingStates = ['pending', 'optional', 'ready', 'waiting'];
  const handoffMutationRequired = providerContract.handoff.required
    && ['attach', 'schedule'].includes(lifecycleControls.command);
  const acknowledgementRequired = handoffMutationRequired && providerContract.handoff.ready;
  const externalStateMatches = !expectedExternalStateId
    || !acknowledgedExternalStateId
    || expectedExternalStateId === acknowledgedExternalStateId;
  const receiptFresh = !acknowledgementRequired || (ackReceivedAtValid && !ackStale);
  const receiptBoundToCommand = !acknowledgementRequired || (idempotencySupplied && idempotencyMatches);
  const accepted = !acknowledgementRequired
    || (
      Boolean(acknowledgementId)
      && acceptedStates.includes(checkpointState)
      && externalStateMatches
      && receiptFresh
      && receiptBoundToCommand
    );
  const pending = acknowledgementRequired && pendingStates.includes(checkpointState);
  const trustReasonCodes = stableList([
    ...(acknowledgementRequired ? ['handoff_ack_required'] : ['handoff_ack_optional']),
    ...(acknowledgementId ? [] : ['handoff_ack_id_missing']),
    ...(externalStateMatches ? [] : ['handoff_external_state_mismatch']),
    ...(!acknowledgementRequired || idempotencySupplied ? [] : ['handoff_idempotency_missing']),
    ...(idempotencyMatches ? [] : ['handoff_idempotency_mismatch']),
    ...(ackReceivedAtValid ? [] : ['handoff_ack_timestamp_invalid']),
    ...(ackStale ? ['handoff_ack_stale'] : []),
    ...(acceptedStates.includes(checkpointState) ? [] : [`handoff_checkpoint_${pending ? 'pending' : 'not_accepted'}`])
  ]);

  return {
    contract: 'operator-userland.cli-claim.provider-handoff-checkpoint.v1',
    generatedAt: now,
    providerId: providerContract.providerId,
    target: providerContract.handoff.target,
    command: lifecycleControls.command,
    scopeKey: `${principal.tenantId}/${scope.requestedWorkspaceId}`,
    expectedExternalStateId,
    acknowledgement: {
      required: acknowledgementRequired,
      id: acknowledgementId,
      externalStateId: acknowledgedExternalStateId,
      expectedIdempotencyKey,
      idempotencyKey: acknowledgedIdempotencyKey,
      idempotencySupplied,
      idempotencyMatches,
      state: checkpointState || (acknowledgementRequired ? 'pending' : 'optional'),
      accepted,
      pending,
      externalStateMatches,
      receivedAt: ackReceivedAt,
      receivedAtValid: ackReceivedAtValid,
      ageMs: ackAgeMs,
      staleAfterMs: ackStaleAfterMs,
      stale: ackStale,
      fresh: receiptFresh,
      boundToCommand: receiptBoundToCommand,
      trust: {
        compatible: accepted || (!acknowledgementRequired && trustReasonCodes.length <= 1),
        reasonCodes: trustReasonCodes,
        operatorCommand: acknowledgementRequired && (!receiptFresh || !receiptBoundToCommand)
          ? `attach --await-handoff --refresh-ack --idempotency-key=${expectedIdempotencyKey}`
          : null
      }
    },
    checkpoint: {
      sequence: normalizePositiveInteger(checkpoint.sequence ?? acknowledgement.sequence, 1),
      cursor: String(checkpoint.cursor || acknowledgement.cursor || providerContract.sync.cursor || '').trim() || null,
      revision: normalizePositiveInteger(checkpoint.revision ?? acknowledgement.revision, providerContract.sync.revision),
      leaseId: String(checkpoint.leaseId || acknowledgement.leaseId || '').trim() || null,
      stateMutation: acknowledgementRequired && accepted
        ? {
            operation: 'commit_external_handoff',
            storageKey: persistedState.storageKey,
            externalStateId: expectedExternalStateId || acknowledgedExternalStateId,
            acknowledgementId,
            providerId: providerContract.providerId,
            updatedAt: now
          }
        : null
    }
  };
}

function validateProviderHandoffCheckpoint(handoffCheckpoint) {
  const findings = [];
  if (!handoffCheckpoint.acknowledgement.required) {
    return findings;
  }
  if (!handoffCheckpoint.acknowledgement.id) {
    findings.push({ code: 'provider_handoff_ack_missing', severity: 'error', field: 'provider.handoff.acknowledgement.id' });
  }
  if (!handoffCheckpoint.acknowledgement.externalStateMatches) {
    findings.push({ code: 'provider_handoff_state_mismatch', severity: 'error', field: 'provider.handoff.acknowledgement.externalStateId' });
  }
  if (!handoffCheckpoint.acknowledgement.idempotencyMatches) {
    findings.push({
      code: 'provider_handoff_idempotency_mismatch',
      severity: 'error',
      field: 'provider.handoff.acknowledgement.idempotencyKey',
      reasonCodes: handoffCheckpoint.acknowledgement.trust.reasonCodes
    });
  }
  if (!handoffCheckpoint.acknowledgement.receivedAtValid) {
    findings.push({
      code: 'provider_handoff_ack_timestamp_invalid',
      severity: 'error',
      field: 'provider.handoff.acknowledgement.receivedAt',
      reasonCodes: handoffCheckpoint.acknowledgement.trust.reasonCodes
    });
  }
  if (handoffCheckpoint.acknowledgement.stale) {
    findings.push({
      code: 'provider_handoff_ack_stale',
      severity: 'error',
      field: 'provider.handoff.acknowledgement.receivedAt',
      reasonCodes: handoffCheckpoint.acknowledgement.trust.reasonCodes
    });
  }
  if (handoffCheckpoint.acknowledgement.pending) {
    findings.push({ code: 'provider_handoff_checkpoint_pending', severity: 'warning', field: 'provider.handoff.checkpoint.state' });
  }
  if (!handoffCheckpoint.acknowledgement.accepted) {
    findings.push({ code: 'provider_handoff_checkpoint_not_accepted', severity: 'error', field: 'provider.handoff.checkpoint.state' });
  }

  return findings;
}

function normalizeVerifierClaimGate(input = {}, {
  now,
  principal,
  scope,
  requestedClaims,
  lifecycleControls,
  persistedState,
  providerContract,
  retryPolicy
}) {
  const verifier = input.verifier && typeof input.verifier === 'object' ? input.verifier : {};
  const gateInput = verifier.claimGate && typeof verifier.claimGate === 'object'
    ? verifier.claimGate
    : input.claimGate && typeof input.claimGate === 'object'
      ? input.claimGate
      : input.verifierGate && typeof input.verifierGate === 'object'
        ? input.verifierGate
        : {};
  const persistedGateInput = persistedState.completionGate && typeof persistedState.completionGate === 'object'
    ? persistedState.completionGate
    : persistedState.lastKnown.completionGate && typeof persistedState.lastKnown.completionGate === 'object'
      ? persistedState.lastKnown.completionGate
      : persistedState.statusProjection.writeIntent?.verifierClaimGate
        && typeof persistedState.statusProjection.writeIntent.verifierClaimGate === 'object'
        ? persistedState.statusProjection.writeIntent.verifierClaimGate
        : {};
  const completionCommand = ['claim', 'attach'].includes(lifecycleControls.command);
  const mutatingCompletion = completionCommand && !lifecycleControls.settings.dryRun;
  const gateSupplied = Object.keys(gateInput).length > 0;
  const submittedAt = String(gateInput.submittedAt || gateInput.acceptedAt || gateInput.verifiedAt || '').trim() || null;
  const decision = String(gateInput.decision || gateInput.status || gateInput.verdict || '').trim();
  const gateId = String(gateInput.gateId || gateInput.id || gateInput.claimGateId || '').trim() || null;
  const verifierRunId = String(gateInput.verifierRunId || gateInput.runId || verifier.runId || '').trim() || null;
  const route = String(gateInput.route || gateInput.path || '/verifier/claim-gate').trim();
  const routePolicy = normalizeVerifierClaimGateRoutePolicy({
    route,
    principal,
    scope,
    persistedState
  });
  const persistedGateId = String(persistedGateInput.gateId || persistedGateInput.id || '').trim() || null;
  const persistedVerifierRunId = String(
    persistedGateInput.verifierRunId
      || persistedGateInput.runId
      || persistedGateInput.submission?.verifierRunId
      || ''
  ).trim() || null;
  const persistedSubmittedAt = String(
    persistedGateInput.submittedAt
      || persistedGateInput.updatedAt
      || persistedGateInput.submission?.submittedAt
      || ''
  ).trim() || null;
  const persistedDecision = String(
    persistedGateInput.decision
      || persistedGateInput.status
      || persistedGateInput.submission?.decision
      || ''
  ).trim();
  const persistedGateIdempotencyKey = String(
    persistedGateInput.idempotencyKey
      || persistedGateInput.completion?.idempotencyKey
      || persistedGateInput.submission?.payload?.idempotencyKey
      || ''
  ).trim() || null;
  const persistedPayload = persistedGateInput.submission?.payload && typeof persistedGateInput.submission.payload === 'object'
    ? persistedGateInput.submission.payload
    : {};
  const persistedScopeKey = String(
    persistedGateInput.scope?.expectedScopeKey
      || persistedGateInput.scope?.gateScopeKey
      || persistedGateInput.scopeKey
      || (persistedPayload.tenantId && persistedPayload.workspaceId
        ? `${persistedPayload.tenantId}/${persistedPayload.workspaceId}`
        : '')
  ).trim() || null;
  const persistedClaims = stableList(
    persistedGateInput.claims?.requested
      || persistedGateInput.claims?.gateClaims
      || persistedPayload.claims
      || []
  );
  const acceptedDecisions = ['accepted', 'passed', 'verified', 'complete'];
  const rejectedDecisions = ['rejected', 'failed', 'blocked', 'denied'];
  const pendingDecisions = ['pending', 'queued', 'running', 'submitted', 'processing'];
  const required = mutatingCompletion;
  const claimNames = requestedClaims.map((claim) => claim.name);
  const gateScopeKey = String(gateInput.scopeKey || `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`).trim();
  const expectedScopeKey = `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`;
  const persistedScopeMatches = !persistedScopeKey || persistedScopeKey === expectedScopeKey;
  const persistedIdempotencyMatches = !persistedGateIdempotencyKey || persistedGateIdempotencyKey === persistedState.idempotency.key;
  const persistedClaimsMatch = persistedClaims.length === 0 || claimNames.every((claim) => persistedClaims.includes(claim));
  const persistedGateReusable = !gateSupplied
    && Boolean(persistedGateId && persistedVerifierRunId && persistedSubmittedAt)
    && persistedScopeMatches
    && persistedIdempotencyMatches
    && persistedClaimsMatch
    && !acceptedDecisions.includes(persistedDecision)
    && !rejectedDecisions.includes(persistedDecision);
  const resumedGatePending = persistedGateReusable && (
    !persistedDecision || pendingDecisions.includes(persistedDecision)
  );
  const effectiveGateId = gateId || (persistedGateReusable ? persistedGateId : null);
  const effectiveVerifierRunId = verifierRunId || (persistedGateReusable ? persistedVerifierRunId : null);
  const effectiveSubmittedAt = submittedAt || (persistedGateReusable ? persistedSubmittedAt : null);
  const effectiveDecision = decision || (persistedGateReusable ? persistedDecision : '');
  const submittedThroughGate = Boolean(effectiveGateId && effectiveVerifierRunId && effectiveSubmittedAt);
  const accepted = submittedThroughGate && acceptedDecisions.includes(effectiveDecision);
  const rejected = rejectedDecisions.includes(effectiveDecision);
  const pending = submittedThroughGate && (pendingDecisions.includes(effectiveDecision) || resumedGatePending);
  const scopeMatches = gateScopeKey === expectedScopeKey;
  const gateIdempotencyKey = String(gateInput.idempotencyKey || '').trim() || null;
  const idempotencyMatches = !gateIdempotencyKey || gateIdempotencyKey === persistedState.idempotency.key;
  const requestedGateClaims = stableList(gateInput.claims || gateInput.requestedClaims || claimNames);
  const claimsMatch = claimNames.every((claim) => requestedGateClaims.includes(claim));
  const receiptInput = gateInput.providerReceipt && typeof gateInput.providerReceipt === 'object'
    ? gateInput.providerReceipt
    : gateInput.receipt && typeof gateInput.receipt === 'object'
      ? gateInput.receipt
      : {};
  const receiptProviderId = String(
    receiptInput.providerId
      || receiptInput.provider
      || gateInput.providerId
      || ''
  ).trim() || null;
  const receiptSyncCursor = String(
    receiptInput.syncCursor
      || receiptInput.cursor
      || gateInput.syncCursor
      || ''
  ).trim() || null;
  const receiptExternalStateId = String(
    receiptInput.externalStateId
      || receiptInput.handoffExternalStateId
      || receiptInput.stateId
      || gateInput.externalStateId
      || gateInput.handoffExternalStateId
      || ''
  ).trim() || null;
  const receiptHandoffTarget = String(
    receiptInput.handoffTarget
      || receiptInput.target
      || gateInput.handoffTarget
      || ''
  ).trim() || null;
  const receiptHandoffState = String(
    receiptInput.handoffState
      || receiptInput.externalStateStatus
      || gateInput.handoffState
      || ''
  ).trim() || null;
  const suppliedRevision = receiptInput.revision
    ?? receiptInput.syncRevision
    ?? gateInput.providerRevision
    ?? gateInput.revision
    ?? null;
  const receiptRevision = suppliedRevision === null || suppliedRevision === ''
    ? null
    : normalizePositiveInteger(suppliedRevision, null);
  const providerReceiptSupplied = Boolean(
    receiptProviderId
      || receiptSyncCursor
      || receiptExternalStateId
      || receiptHandoffTarget
      || receiptHandoffState
      || receiptRevision !== null
  );
  const providerIdMatches = receiptProviderId === providerContract.providerId;
  const cursorRequired = Boolean(providerContract.sync.cursor);
  const syncCursorMatches = cursorRequired
    ? receiptSyncCursor === providerContract.sync.cursor
    : receiptSyncCursor === null || receiptSyncCursor === providerContract.sync.cursor;
  const revisionMatches = receiptRevision === providerContract.sync.revision;
  const externalStateRequired = Boolean(providerContract.handoff.required && providerContract.handoff.externalStateId);
  const externalStateMatches = externalStateRequired
    ? receiptExternalStateId === providerContract.handoff.externalStateId
    : !receiptExternalStateId || receiptExternalStateId === providerContract.handoff.externalStateId;
  const handoffTargetMatches = !receiptHandoffTarget || receiptHandoffTarget === providerContract.handoff.target;
  const handoffStateMatches = !providerContract.handoff.required
    || !receiptHandoffState
    || ['ready', 'accepted', 'attached', 'committed', 'scheduled'].includes(receiptHandoffState);
  const providerReceiptMatches = !required || (
    providerReceiptSupplied
    && providerIdMatches
    && syncCursorMatches
    && revisionMatches
    && externalStateMatches
    && handoffTargetMatches
    && handoffStateMatches
  );
  const receiptInvalid = providerReceiptSupplied && !providerReceiptMatches;
  const allowed = !required || (
    accepted
    && routePolicy.allowed
    && scopeMatches
    && idempotencyMatches
    && claimsMatch
    && providerReceiptMatches
  );
  const reasonCodes = stableList([
    ...(required ? ['completion_gate_required'] : ['completion_gate_not_required']),
    ...(routePolicy.allowed ? [] : ['claim_gate_route_invalid', ...routePolicy.reasonCodes]),
    ...(submittedThroughGate || (!required && !gateSupplied) ? [] : ['claim_gate_submission_missing']),
    ...(effectiveDecision || (!required && !gateSupplied) ? [] : ['claim_gate_decision_missing']),
    ...(accepted || !effectiveDecision ? [] : [`claim_gate_${rejected ? 'rejected' : 'not_accepted'}`]),
    ...(scopeMatches ? [] : ['claim_gate_scope_mismatch']),
    ...(idempotencyMatches ? [] : ['claim_gate_idempotency_mismatch']),
    ...(claimsMatch ? [] : ['claim_gate_claims_mismatch']),
    ...(!required || providerReceiptSupplied ? [] : ['claim_gate_provider_receipt_missing']),
    ...(!required || !providerReceiptSupplied || providerIdMatches ? [] : ['claim_gate_provider_mismatch']),
    ...(!required || !providerReceiptSupplied || syncCursorMatches ? [] : ['claim_gate_provider_cursor_mismatch']),
    ...(!required || !providerReceiptSupplied || revisionMatches ? [] : ['claim_gate_provider_revision_mismatch']),
    ...(!required || !providerReceiptSupplied || externalStateMatches ? [] : ['claim_gate_external_state_mismatch']),
    ...(!required || !providerReceiptSupplied || handoffTargetMatches ? [] : ['claim_gate_handoff_target_mismatch']),
    ...(!required || !providerReceiptSupplied || handoffStateMatches ? [] : ['claim_gate_handoff_state_not_ready'])
  ]);
  const refreshReceiptRequired = required && accepted && (
    !routePolicy.allowed
    || !scopeMatches
    || !idempotencyMatches
    || !claimsMatch
    || !providerReceiptMatches
  );
  const retryable = required && !allowed && pending && !rejected;
  const retryAttempts = retryable
    ? Array.from({ length: retryPolicy.maxAttempts }, (_, index) => {
        const delayMs = Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * (2 ** index));
        return {
          attempt: index + 1,
          delayMs,
          command: `status --verifier-claim-gate --gate-id=${effectiveGateId} --run-id=${effectiveVerifierRunId}`
        };
      })
    : [];
  const submissionPayload = {
    contract: 'operator-userland.cli-claim.verifier-gate-submission.v1',
    route: routePolicy.normalizedRoute,
    method: 'POST',
    tenantId: scope.requestedTenantId,
    workspaceId: scope.requestedWorkspaceId,
    principalId: principal.principalId,
    idempotencyKey: persistedState.idempotency.key,
    claims: claimNames,
    routePolicy: {
      contract: routePolicy.contract,
      allowedRoutes: routePolicy.allowedRoutes,
      routeScopeKey: routePolicy.routeScopeKey
    },
    providerReceipt: {
      providerId: providerContract.providerId,
      syncCursor: providerContract.sync.cursor,
      revision: providerContract.sync.revision,
      handoffTarget: providerContract.handoff.required ? providerContract.handoff.target : null,
      externalStateId: providerContract.handoff.externalStateId,
      handoffState: providerContract.handoff.state
    }
  };
  const operatorCommand = !required
    ? null
    : !submittedThroughGate
      ? `claim --through-verifier-gate --idempotency-key=${persistedState.idempotency.key}`
      : pending
        ? `status --verifier-claim-gate --gate-id=${effectiveGateId} --run-id=${effectiveVerifierRunId}`
        : refreshReceiptRequired || receiptInvalid
          ? `claim --through-verifier-gate --refresh-receipt --gate-id=${effectiveGateId}`
          : rejected
            ? `claim --through-verifier-gate --resubmit --idempotency-key=${persistedState.idempotency.key}`
            : `claim --through-verifier-gate --gate-id=${effectiveGateId}`;

  return {
    contract: 'operator-userland.cli-claim.verifier-claim-gate.v1',
    generatedAt: now,
    required,
    allowed,
    route: routePolicy.normalizedRoute,
    routePolicy,
    gateId: effectiveGateId,
    verifierRunId: effectiveVerifierRunId,
    decision: effectiveDecision || null,
    submittedAt: effectiveSubmittedAt,
    submittedThroughGate,
    pending,
    rejected,
    completion: {
      command: lifecycleControls.command,
      mutating: mutatingCompletion,
      dryRun: lifecycleControls.settings.dryRun,
      idempotencyKey: persistedState.idempotency.key,
      gateIdempotencyKey,
      idempotencyMatches
    },
    scope: {
      expectedScopeKey,
      gateScopeKey,
      matches: scopeMatches,
      tenantId: principal.tenantId,
      workspaceId: scope.requestedWorkspaceId
    },
    claims: {
      requested: claimNames,
      gateClaims: requestedGateClaims,
      matches: claimsMatch
    },
    providerReceipt: {
      providerId: providerContract.providerId,
      syncCursor: providerContract.sync.cursor,
      revision: providerContract.sync.revision,
      handoffTarget: providerContract.handoff.required ? providerContract.handoff.target : null,
      externalStateId: providerContract.handoff.externalStateId,
      handoffState: providerContract.handoff.state,
      supplied: providerReceiptSupplied,
      expected: {
        providerId: providerContract.providerId,
        syncCursor: providerContract.sync.cursor,
        revision: providerContract.sync.revision,
        handoffTarget: providerContract.handoff.required ? providerContract.handoff.target : null,
        externalStateId: providerContract.handoff.externalStateId,
        handoffState: providerContract.handoff.state
      },
      actual: {
        providerId: receiptProviderId,
        syncCursor: receiptSyncCursor,
        revision: receiptRevision,
        handoffTarget: receiptHandoffTarget,
        externalStateId: receiptExternalStateId,
        handoffState: receiptHandoffState
      },
      cursorRequired,
      externalStateRequired,
      providerIdMatches,
      syncCursorMatches,
      revisionMatches,
      externalStateMatches,
      handoffTargetMatches,
      handoffStateMatches,
      matches: providerReceiptMatches
    },
    submission: {
      required,
      submitted: submittedThroughGate,
      accepted,
      pending,
      rejected,
      refreshReceiptRequired,
      retryable,
      operatorCommand,
      payload: required && !allowed ? submissionPayload : null,
      retry: {
        available: retryable,
        policy: retryable ? retryPolicy : null,
        attempts: retryAttempts
      }
    },
    persistedGateResume: {
      contract: 'operator-userland.cli-claim.verifier-gate-resume.v1',
      supplied: Object.keys(persistedGateInput).length > 0,
      reused: persistedGateReusable,
      pending: resumedGatePending,
      gateId: persistedGateId,
      verifierRunId: persistedVerifierRunId,
      submittedAt: persistedSubmittedAt,
      decision: persistedDecision || null,
      scopeKey: persistedScopeKey,
      idempotencyKey: persistedGateIdempotencyKey,
      claims: persistedClaims,
      scopeMatches: persistedScopeMatches,
      idempotencyMatches: persistedIdempotencyMatches,
      claimsMatch: persistedClaimsMatch,
      statusCommand: persistedGateReusable
        ? `status --verifier-claim-gate --gate-id=${persistedGateId} --run-id=${persistedVerifierRunId}`
        : null,
      reasonCodes: stableList([
        ...(Object.keys(persistedGateInput).length > 0 ? ['persisted_gate_seen'] : []),
        ...(persistedGateReusable ? ['persisted_gate_reused'] : []),
        ...(persistedScopeMatches ? [] : ['persisted_gate_scope_mismatch']),
        ...(persistedIdempotencyMatches ? [] : ['persisted_gate_idempotency_mismatch']),
        ...(persistedClaimsMatch ? [] : ['persisted_gate_claims_mismatch']),
        ...(persistedDecision && acceptedDecisions.includes(persistedDecision) ? ['persisted_gate_already_accepted'] : []),
        ...(persistedDecision && rejectedDecisions.includes(persistedDecision) ? ['persisted_gate_rejected'] : []),
        ...(resumedGatePending ? ['poll_persisted_gate'] : [])
      ])
    },
    reasonCodes
  };
}

function validateVerifierClaimGate(verifierClaimGate) {
  if (!verifierClaimGate.required || verifierClaimGate.allowed) {
    return [];
  }

  if (!verifierClaimGate.routePolicy.allowed) {
    return [{
      code: 'verifier_claim_gate_route_invalid',
      severity: 'error',
      field: 'verifier.claimGate.route',
      reasonCodes: verifierClaimGate.reasonCodes
    }];
  }

  if (verifierClaimGate.submission.pending) {
    return [{
      code: 'verifier_claim_gate_pending',
      severity: 'error',
      field: 'verifier.claimGate.decision',
      reasonCodes: verifierClaimGate.reasonCodes
    }];
  }

  if (verifierClaimGate.submission.refreshReceiptRequired) {
    return [{
      code: 'verifier_claim_gate_receipt_invalid',
      severity: 'error',
      field: 'verifier.claimGate.receipt',
      reasonCodes: verifierClaimGate.reasonCodes
    }];
  }

  return [{
    code: 'verifier_claim_gate_required',
    severity: 'error',
    field: 'verifier.claimGate',
    reasonCodes: verifierClaimGate.reasonCodes
  }];
}

function applyVerifierClaimGateToPersistedState(persistedState, verifierClaimGate, lifecycleControls, now) {
  const completionGate = {
    contract: 'operator-userland.cli-claim.completion-submission-gate.v1',
    required: verifierClaimGate.required,
    allowed: verifierClaimGate.allowed,
    route: verifierClaimGate.route,
    routePolicy: verifierClaimGate.routePolicy,
    gateId: verifierClaimGate.gateId,
    verifierRunId: verifierClaimGate.verifierRunId,
    decision: verifierClaimGate.decision,
    reasonCodes: verifierClaimGate.reasonCodes,
    command: lifecycleControls.command,
    dryRun: lifecycleControls.settings.dryRun,
    persistenceMode: verifierClaimGate.required
      ? verifierClaimGate.allowed ? 'gate_accepted' : 'await_verifier_claim_gate'
      : 'gate_not_required',
    providerReceipt: verifierClaimGate.providerReceipt,
    submission: verifierClaimGate.submission,
    persistedGateResume: verifierClaimGate.persistedGateResume,
    submittedThroughGate: verifierClaimGate.submittedThroughGate,
    idempotencyKey: persistedState.idempotency.key,
    updatedAt: now
  };

  if (!verifierClaimGate.required || verifierClaimGate.allowed) {
    return {
      ...persistedState,
      completionGate,
      statusProjection: {
        ...persistedState.statusProjection,
        writeIntent: {
          ...persistedState.statusProjection.writeIntent,
          verifierClaimGate: completionGate
        }
      },
      writePlan: {
        ...persistedState.writePlan,
        verifierClaimGate: completionGate
      }
    };
  }

  const blockedReasonCodes = stableList([
    'verifier_claim_gate_required',
    ...verifierClaimGate.reasonCodes
  ]);
  const recoveryPath = {
    ...persistedState.statusProjection.recoveryPath,
    gateSubmissionCommand: verifierClaimGate.submission.operatorCommand,
    gateRetry: verifierClaimGate.submission.retry,
    safeCommands: stableList([
      'status',
      verifierClaimGate.submission.pending ? 'poll_verifier_claim_gate' : 'submit_through_verifier_claim_gate',
      verifierClaimGate.submission.refreshReceiptRequired ? 'refresh_verifier_claim_gate_receipt' : null,
      ...(persistedState.statusProjection.recoveryPath.resumeCommand ? ['resume_after_gate_acceptance'] : [])
    ])
  };

  return {
    ...persistedState,
    completionGate,
    statusProjection: {
      ...persistedState.statusProjection,
      canonicalState: 'blocked',
      replayClassification: 'await_verifier_claim_gate',
      reasonCodes: stableList([
        ...persistedState.statusProjection.reasonCodes,
        ...blockedReasonCodes
      ]),
      recoveryPath,
      writeIntent: {
        ...persistedState.statusProjection.writeIntent,
        operation: 'await_verifier_claim_gate',
        nextState: 'blocked',
        shouldWrite: false,
        verifierClaimGate: completionGate
      }
    },
    writePlan: {
      ...persistedState.writePlan,
      shouldWrite: false,
      operation: 'await_verifier_claim_gate',
      nextState: 'blocked',
      updatedAt: now,
      blockedBy: blockedReasonCodes,
      verifierClaimGate: completionGate
    }
  };
}

function buildRetryPlan({ retryPolicy, findings, hostedKernel }) {
  const retryableCodes = new Set([
    'kernel_heartbeat_stale',
    'kernel_queue_degraded',
    'kernel_attach_unavailable',
    'provider_sync_stale',
    'provider_sync_pending',
    'verifier_claim_gate_pending'
  ]);
  const retryableFindings = findings.filter((finding) => retryableCodes.has(finding.code));
  const leaseIndependentRetry = retryableFindings.some((finding) => finding.code === 'verifier_claim_gate_pending');
  const attempts = Array.from({ length: retryPolicy.maxAttempts }, (_, index) => {
    const delayMs = Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * (2 ** index));
    return { attempt: index + 1, delayMs };
  });

  return {
    retryable: retryableFindings.length > 0 && (hostedKernel.hasLease || leaseIndependentRetry),
    reasonCodes: retryableFindings.map((finding) => finding.code),
    policy: retryPolicy,
    attempts
  };
}

function normalizePersistedClaimState(input = {}, {
  now,
  principal,
  scope,
  requestedClaims,
  hostedKernel,
  providerContract,
  lifecycleControls
}) {
  const stateInput = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const statusInput = stateInput.status && typeof stateInput.status === 'object' ? stateInput.status : {};
  const completionGateInput = stateInput.completionGate && typeof stateInput.completionGate === 'object'
    ? stateInput.completionGate
    : statusInput.completionGate && typeof statusInput.completionGate === 'object'
      ? statusInput.completionGate
      : {};
  const lastCommand = normalizeLifecycleCommand(stateInput.lastCommand || statusInput.command || lifecycleControls.command);
  const lastState = String(stateInput.state || statusInput.state || stateInput.lifecycleState || 'unknown').trim();
  const lastOutcome = String(stateInput.outcome || statusInput.outcome || '').trim() || null;
  const lastUpdatedAt = String(stateInput.updatedAt || stateInput.lastUpdatedAt || statusInput.updatedAt || '').trim() || null;
  const lastUpdatedMs = lastUpdatedAt ? Date.parse(lastUpdatedAt) : null;
  const nowMs = Date.parse(now);
  const ttlMs = normalizePositiveInteger(stateInput.ttlMs ?? stateInput.staleAfterMs, 300000);
  const ageMs = lastUpdatedMs !== null && !Number.isNaN(lastUpdatedMs) && !Number.isNaN(nowMs)
    ? Math.max(0, nowMs - lastUpdatedMs)
    : null;
  const claimsFingerprint = stableList(requestedClaims.map((claim) => `${claim.name}:${claim.permission}`)).join('|');
  const commandFingerprint = [
    principal.tenantId,
    scope.requestedWorkspaceId,
    principal.principalId,
    lifecycleControls.command,
    hostedKernel.kernelId,
    providerContract.providerId,
    claimsFingerprint
  ].join('::');
  const suppliedIdempotencyKey = String(
    input.idempotencyKey
      || lifecycleControls.idempotencyKey
      || stateInput.idempotencyKey
      || ''
  ).trim();
  const idempotencyKey = suppliedIdempotencyKey || commandFingerprint;
  const previousIdempotencyKey = String(stateInput.lastIdempotencyKey || statusInput.idempotencyKey || '').trim() || null;
  const completedStates = new Set(['ready', 'attached', 'granted', 'disabled', 'blocked']);
  const inFlightStates = new Set(['pending', 'retryable', 'handoff_pending', 'scheduled', 'waiting']);
  const stale = ageMs === null || ageMs > ttlMs;
  const sameCommand = previousIdempotencyKey === idempotencyKey;
  const commandIsStatus = lifecycleControls.command === 'status';
  const commandIsIdempotent = ['status', 'enable', 'disable', 'schedule'].includes(lifecycleControls.command);
  const duplicateCompletion = sameCommand && completedStates.has(lastState) && !stale;
  const recoverableInFlight = inFlightStates.has(lastState) || stale || normalizeBoolean(stateInput.recoveryRequired);
  const restartToken = String(stateInput.restartToken || stateInput.recoveryToken || providerContract.sync.cursor || '').trim() || null;
  const completionGatePayload = completionGateInput.submission?.payload && typeof completionGateInput.submission.payload === 'object'
    ? completionGateInput.submission.payload
    : {};
  const completionGateScopeKey = String(
    completionGateInput.scope?.expectedScopeKey
      || completionGateInput.scope?.gateScopeKey
      || completionGateInput.scopeKey
      || (completionGatePayload.tenantId && completionGatePayload.workspaceId
        ? `${completionGatePayload.tenantId}/${completionGatePayload.workspaceId}`
        : '')
  ).trim() || null;
  const completionGateIdempotencyKey = String(
    completionGateInput.idempotencyKey
      || completionGateInput.completion?.idempotencyKey
      || completionGatePayload.idempotencyKey
      || ''
  ).trim() || null;
  const completionGateSnapshot = {
    contract: 'operator-userland.cli-claim.persisted-completion-gate.v1',
    supplied: Object.keys(completionGateInput).length > 0,
    gateId: String(completionGateInput.gateId || completionGateInput.id || '').trim() || null,
    verifierRunId: String(completionGateInput.verifierRunId || completionGateInput.runId || '').trim() || null,
    decision: String(completionGateInput.decision || completionGateInput.status || '').trim() || null,
    submittedAt: String(
      completionGateInput.submittedAt
        || completionGateInput.updatedAt
        || completionGateInput.submission?.submittedAt
        || ''
    ).trim() || null,
    scopeKey: completionGateScopeKey,
    idempotencyKey: completionGateIdempotencyKey,
    claims: stableList(
      completionGateInput.claims?.requested
        || completionGateInput.claims?.gateClaims
        || completionGatePayload.claims
        || []
    ),
    reusableForCommand: Boolean(
      completionGateIdempotencyKey
        && completionGateIdempotencyKey === idempotencyKey
        && (!completionGateScopeKey || completionGateScopeKey === `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`)
    )
  };
  const suppliedStorageKey = String(stateInput.storageKey || '').trim();
  const storageKey = String(suppliedStorageKey || `${principal.tenantId}/${scope.requestedWorkspaceId}/${principal.principalId}`).trim();
  const storageKeySegments = storageKey.split('/').map((segment) => segment.trim()).filter(Boolean);
  const storageTenantId = String(
    stateInput.tenantId
      || statusInput.tenantId
      || stateInput.scope?.tenantId
      || storageKeySegments[0]
      || ''
  ).trim() || null;
  const storageWorkspaceId = String(
    stateInput.workspaceId
      || statusInput.workspaceId
      || stateInput.scope?.workspaceId
      || storageKeySegments[1]
      || ''
  ).trim() || null;
  const storagePrincipalId = String(
    stateInput.principalId
      || statusInput.principalId
      || stateInput.actor?.principalId
      || storageKeySegments[2]
      || ''
  ).trim() || null;
  const boundaryEvidence = stableList([
    ...(suppliedStorageKey ? ['storage_key_supplied'] : ['storage_key_generated']),
    ...(storageTenantId ? ['tenant_metadata'] : []),
    ...(storageWorkspaceId ? ['workspace_metadata'] : []),
    ...(storagePrincipalId ? ['principal_metadata'] : []),
    ...(providerContract.sync.cursor ? ['provider_sync_cursor'] : []),
    ...(providerContract.handoff.externalStateId ? ['external_handoff_state'] : [])
  ]);
  const tenantOwned = storageTenantId === null || storageTenantId === principal.tenantId;
  const workspaceOwned = storageWorkspaceId === null || storageWorkspaceId === scope.requestedWorkspaceId;
  const principalOwned = storagePrincipalId === null || storagePrincipalId === principal.principalId;
  const boundaryVerified = !suppliedStorageKey || Boolean(storageTenantId && storageWorkspaceId);
  const ownedByScope = tenantOwned && workspaceOwned && principalOwned;
  const boundaryReasonCodes = stableList([
    ...(tenantOwned ? [] : ['persisted_tenant_mismatch']),
    ...(workspaceOwned ? [] : ['persisted_workspace_mismatch']),
    ...(principalOwned ? [] : ['persisted_principal_mismatch']),
    ...(boundaryVerified ? [] : ['persisted_boundary_metadata_missing'])
  ]);
  const externallyRecoverable = Boolean(
    restartToken
      || providerContract.sync.cursor
      || providerContract.handoff.externalStateId
  );
  const restartSafe = ownedByScope && boundaryVerified && externallyRecoverable;
  const replayClassification = !ownedByScope
    ? 'cross_scope_rejected'
    : !boundaryVerified
      ? 'boundary_metadata_required'
      : duplicateCompletion
        ? 'cached_completion'
        : recoverableInFlight
          ? restartSafe
            ? 'recoverable'
            : 'recovery_blocked'
          : 'fresh_command';
  const canonicalState = commandIsStatus
    ? lastState === 'unknown'
      ? restartSafe
        ? 'recoverable'
        : 'not_found'
      : stale && restartSafe
        ? 'recoverable'
        : lastState
    : duplicateCompletion
      ? lastState
      : recoverableInFlight && restartSafe
        ? 'recovering'
        : recoverableInFlight
          ? 'blocked'
          : 'pending';
  const statusExitCode = !ownedByScope || (!restartSafe && recoverableInFlight)
    ? 2
    : stale && commandIsStatus
      ? 78
      : 0;
  const persistedStatusReasonCodes = stableList([
    replayClassification,
    ...(sameCommand ? ['same_idempotency_key'] : []),
    ...(duplicateCompletion ? ['idempotent_duplicate'] : []),
    ...(stale ? ['persisted_state_stale'] : []),
    ...(restartSafe ? ['restart_safe'] : ['restart_token_missing']),
    ...(completionGateSnapshot.reusableForCommand ? ['persisted_completion_gate_reusable'] : []),
    ...boundaryReasonCodes
  ]);
  const resumeCommand = restartSafe
    ? `${lifecycleControls.command.replace(/_/g, '-')} --resume --idempotency-key=${idempotencyKey}`
    : null;
  const statusCommand = `status --tenant=${scope.requestedTenantId} --workspace=${scope.requestedWorkspaceId} --idempotency-key=${idempotencyKey}`;

  return {
    contract: 'operator-userland.cli-claim.persisted-state.v1',
    storageKey,
    boundary: {
      contract: 'operator-userland.cli-claim.persisted-state-boundary.v1',
      expectedTenantId: principal.tenantId,
      expectedWorkspaceId: scope.requestedWorkspaceId,
      expectedPrincipalId: principal.principalId,
      storageTenantId,
      storageWorkspaceId,
      storagePrincipalId,
      suppliedStorageKey: Boolean(suppliedStorageKey),
      verified: boundaryVerified,
      ownedByScope,
      reasonCodes: boundaryReasonCodes,
      evidence: boundaryEvidence,
      safeForReplay: ownedByScope && boundaryVerified
    },
    idempotency: {
      key: idempotencyKey,
      supplied: Boolean(suppliedIdempotencyKey),
      previousKey: previousIdempotencyKey,
      sameCommand,
      commandIsIdempotent,
      duplicateCompletion
    },
    lastKnown: {
      state: lastState,
      command: lastCommand,
      outcome: lastOutcome,
      updatedAt: lastUpdatedAt,
      ageMs,
      stale,
      ttlMs,
      restartToken,
      completionGate: completionGateSnapshot
    },
    recovery: {
      required: recoverableInFlight && !commandIsStatus && ownedByScope,
      reasonCodes: stableList([
        ...(stale ? ['persisted_state_stale'] : []),
        ...(inFlightStates.has(lastState) ? [`recover_${lastState}`] : []),
        ...(stateInput.recoveryRequired ? ['operator_recovery_requested'] : []),
        ...boundaryReasonCodes
      ]),
      resumeFrom: recoverableInFlight && ownedByScope ? lastState : null,
      canResume: ownedByScope && boundaryVerified && Boolean(restartToken || providerContract.sync.cursor || providerContract.handoff.externalStateId),
      statusOnly: commandIsStatus
    },
    statusProjection: {
      contract: 'operator-userland.cli-claim.persisted-status.v1',
      generatedAt: now,
      canonicalState,
      replayClassification,
      restartSafe,
      statusExitCode,
      reasonCodes: persistedStatusReasonCodes,
      readModel: {
        storageKey,
        tenantId: storageTenantId || principal.tenantId,
        workspaceId: storageWorkspaceId || scope.requestedWorkspaceId,
        principalId: storagePrincipalId || principal.principalId,
        lastCommand,
        lastOutcome,
        lastUpdatedAt,
        ageMs,
        stale,
        idempotencyKey,
        previousIdempotencyKey,
        syncCursor: providerContract.sync.cursor,
        externalStateId: providerContract.handoff.externalStateId,
        restartToken,
        completionGate: completionGateSnapshot
      },
      recoveryPath: {
        resumeFrom: recoverableInFlight && ownedByScope ? lastState : null,
        resumeToken: restartToken || providerContract.sync.cursor || providerContract.handoff.externalStateId,
        resumeCommand,
        statusCommand,
        requiresRepair: recoverableInFlight && !restartSafe,
        repairCommand: 'status --repair-state',
        safeCommands: stableList([
          'status',
          ...(duplicateCompletion ? ['return_cached_completion'] : []),
          ...(resumeCommand ? ['resume'] : []),
          ...(ownedByScope && boundaryVerified ? ['retry'] : [])
        ])
      },
      writeIntent: {
        operation: commandIsStatus
          ? 'read_status'
          : !ownedByScope
            ? 'reject_cross_scope_state'
            : !boundaryVerified
              ? 'await_boundary_metadata'
              : duplicateCompletion
                ? 'return_cached_completion'
                : recoverableInFlight
                  ? restartSafe
                    ? 'recover_and_update'
                    : 'await_recovery_token'
                  : 'upsert_command_state',
        nextState: commandIsStatus ? canonicalState : canonicalState === 'recovering' ? 'pending_recovery' : canonicalState,
        idempotent: commandIsIdempotent || duplicateCompletion,
        shouldWrite: ownedByScope && !commandIsStatus && (!duplicateCompletion || lifecycleControls.command === 'schedule') && (!recoverableInFlight || restartSafe)
      }
    },
    writePlan: {
      shouldWrite: ownedByScope && !commandIsStatus && (!duplicateCompletion || lifecycleControls.command === 'schedule') && (!recoverableInFlight || restartSafe),
      operation: commandIsStatus
        ? 'read_status'
        : !ownedByScope
          ? 'reject_cross_scope_state'
          : !boundaryVerified
            ? 'await_boundary_metadata'
            : duplicateCompletion
              ? 'return_cached_completion'
              : recoverableInFlight
                ? restartSafe
                  ? 'recover_and_update'
                  : 'await_recovery_token'
                : 'upsert_command_state',
      nextState: commandIsStatus ? canonicalState : canonicalState === 'recovering' ? 'pending_recovery' : canonicalState,
      revision: providerContract.sync.revision + Number(!commandIsStatus),
      cursor: providerContract.sync.cursor,
      updatedAt: now
    }
  };
}

function validatePersistedClaimState(persistedState) {
  const findings = [];
  if (!persistedState.storageKey) {
    findings.push({ code: 'persisted_state_key_missing', severity: 'error', field: 'persistedState.storageKey' });
  }
  if (!persistedState.boundary.ownedByScope) {
    findings.push({
      code: 'persisted_state_boundary_failed',
      severity: 'error',
      field: 'persistedState.boundary',
      reasonCodes: persistedState.boundary.reasonCodes
    });
  } else if (!persistedState.boundary.verified) {
    findings.push({
      code: 'persisted_state_boundary_unverified',
      severity: 'warning',
      field: 'persistedState.boundary',
      reasonCodes: persistedState.boundary.reasonCodes
    });
  }
  if (persistedState.recovery.required && !persistedState.recovery.canResume) {
    findings.push({ code: 'persisted_state_recovery_unavailable', severity: 'error', field: 'persistedState.restartToken' });
  }
  if (persistedState.idempotency.duplicateCompletion) {
    findings.push({ code: 'persisted_state_duplicate_completion', severity: 'warning', field: 'idempotencyKey' });
  }
  if (persistedState.lastKnown.stale) {
    findings.push({ code: 'persisted_state_stale', severity: 'warning', field: 'persistedState.updatedAt' });
  }

  return findings;
}

function buildActionableErrors({ deniedClaims, findings, retryPlan }) {
  return [
    ...deniedClaims.map((claim) => ({
      code: 'claim_denied',
      severity: 'error',
      claim: claim.name,
      permission: claim.permission,
      reasons: claim.reasons,
      action: claim.reasons.some((reason) => reason.startsWith('missing_permission:'))
        ? 'Grant the missing permission through the operator role policy before retrying.'
        : 'Re-run the claim from an allowed tenant/workspace boundary.'
    })),
    ...findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        field: finding.field,
        action: FAILURE_REMEDIATION[finding.code]?.action
          || (retryPlan.reasonCodes.includes(finding.code)
            ? 'Retry using the provided backoff plan after hosted-kernel health recovers.'
            : 'Correct the request or hosted-kernel state before retrying.')
      }))
  ];
}

function classifyFindingRemediation(finding, fallbackCategory = 'validation') {
  const remediation = FAILURE_REMEDIATION[finding.code] || {};
  return {
    category: remediation.category || fallbackCategory,
    capability: remediation.capability || 'claim.evaluate',
    command: remediation.command || 'claim --validate',
    action: remediation.action || 'Correct the failed field before retrying.',
    retryable: [
      'kernel_heartbeat_stale',
      'kernel_queue_degraded',
      'kernel_attach_unavailable',
      'provider_sync_stale',
      'provider_sync_pending',
      'verifier_claim_gate_pending'
    ].includes(finding.code)
  };
}

function buildFailureStateContract({
  now,
  deniedClaims,
  validationFindings,
  hostedKernel,
  providerContract,
  handoffCheckpoint,
  lifecycleControls,
  retryPlan,
  persistedState
}) {
  const errorFindings = validationFindings.filter((finding) => finding.severity === 'error');
  const warningFindings = validationFindings.filter((finding) => finding.severity === 'warning');
  const claimIncidents = deniedClaims.map((claim) => ({
    code: 'claim_denied',
    severity: 'error',
    category: claim.reasons.some((reason) => reason.startsWith('missing_permission:')) ? 'permission' : 'boundary',
    capability: claim.permission,
    affectedOperation: 'claim',
    field: 'requestedClaims',
    reasonCodes: claim.reasons,
    retryable: false,
    degradedAllowed: false,
    command: claim.reasons.some((reason) => reason.startsWith('missing_permission:'))
      ? 'claim --role <role-with-permission>'
      : 'claim --scope <allowed-workspace>',
    action: claim.reasons.some((reason) => reason.startsWith('missing_permission:'))
      ? 'Grant the required permission through role policy before retrying.'
      : 'Retry from an allowed tenant/workspace boundary.'
  }));
  const findingIncidents = [...errorFindings, ...warningFindings].map((finding) => {
    const remediation = classifyFindingRemediation(finding);
    const affectedOperation = remediation.capability === 'kernel.attach'
      ? 'attach'
      : remediation.category === 'handoff'
        ? 'handoff'
        : remediation.category === 'persisted_state'
          ? 'recovery'
          : 'claim';

    return {
      code: finding.code,
      severity: finding.severity,
      category: remediation.category,
      capability: remediation.capability,
      affectedOperation,
      field: finding.field || null,
      reasonCodes: finding.missingCapabilities || finding.reasonCodes || [finding.code],
      retryable: retryPlan.reasonCodes.includes(finding.code) || remediation.retryable,
      degradedAllowed: finding.severity === 'warning'
        && lifecycleControls.settings.allowDegradedAttach
        && affectedOperation !== 'attach',
      command: remediation.command,
      action: remediation.action
    };
  });
  const incidents = [...claimIncidents, ...findingIncidents];
  const blocksAttach = incidents.some((incident) => (
    incident.severity === 'error'
    && ['attach', 'handoff'].includes(incident.affectedOperation)
  )) || deniedClaims.length > 0;
  const blocksClaim = incidents.some((incident) => (
    incident.severity === 'error'
    && incident.affectedOperation === 'claim'
  )) || deniedClaims.length > 0;
  const blocksRecovery = incidents.some((incident) => (
    incident.severity === 'error'
    && incident.affectedOperation === 'recovery'
  ));
  const retryableIncidents = incidents.filter((incident) => incident.retryable);
  const degradedAllowed = incidents.length > 0
    && incidents.every((incident) => incident.severity !== 'error' || incident.degradedAllowed)
    && lifecycleControls.settings.allowDegradedAttach;
  const failedCategories = stableList(incidents.map((incident) => incident.category));
  const primaryIncident = incidents.find((incident) => incident.severity === 'error')
    || incidents.find((incident) => incident.severity === 'warning')
    || null;
  const retryWindow = retryableIncidents.length > 0 && retryPlan.retryable
    ? {
        nextAttemptDelayMs: retryPlan.attempts[0]?.delayMs || 0,
        maxAttempts: retryPlan.policy.maxAttempts,
        reasonCodes: retryPlan.reasonCodes
      }
    : null;

  return {
    contract: 'operator-userland.cli-claim.failure-state.v1',
    generatedAt: now,
    state: incidents.length === 0
      ? 'healthy'
      : errorFindings.length > 0 || deniedClaims.length > 0
        ? retryableIncidents.length > 0
          ? 'retryable_failure'
          : 'blocked_failure'
        : 'degraded_warning',
    primaryCode: primaryIncident?.code || null,
    failedCategories,
    blockedOperations: stableList([
      ...(blocksClaim ? ['claim'] : []),
      ...(blocksAttach ? ['attach'] : []),
      ...(!providerContract.handoff.ready ? ['handoff'] : []),
      ...(blocksRecovery || (persistedState.recovery.required && !persistedState.recovery.canResume) ? ['recovery'] : [])
    ]),
    degradedAllowed,
    retry: {
      available: retryableIncidents.length > 0 && retryPlan.retryable,
      blockedByLease: retryableIncidents.length > 0 && !retryPlan.retryable,
      window: retryWindow
    },
    operatorActions: stableList(incidents.map((incident) => incident.command)),
    incidents
  };
}

function buildAcceptancePreviewContract({
  now,
  principal,
  scope,
  tenantBoundary,
  claimDecisions,
  validationFindings,
  hostedKernel,
  providerContract,
  handoffCheckpoint,
  lifecycleControls,
  retryPlan,
  auditProof,
  nextActionState,
  operationalMode,
  persistedState,
  failureState,
  verifierClaimGate
}) {
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const errorFindings = validationFindings.filter((finding) => finding.severity === 'error');
  const warningFindings = validationFindings.filter((finding) => finding.severity === 'warning');
  const attachAccepted = auditProof.outcome.safeToAttachKernel
    && deniedClaims.length === 0
    && errorFindings.length === 0
    && providerContract.negotiation.compatible
    && providerContract.sync.fresh
    && providerContract.handoff.ready
    && handoffCheckpoint.acknowledgement.accepted
    && lifecycleControls.settings.enabled
    && lifecycleControls.settings.attachEnabled
    && lifecycleControls.schedule.ready
    && persistedState.boundary.safeForReplay
    && verifierClaimGate.allowed
    && !lifecycleControls.settings.dryRun;
  const readinessGates = [
    {
      gate: 'workspace_boundary',
      ready: scope.tenantMatches && scope.workspaceAllowed,
      detail: `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`
    },
    {
      gate: 'claim_permissions',
      ready: deniedClaims.length === 0,
      detail: deniedClaims.length === 0 ? 'all requested claims allowed' : `${deniedClaims.length} claim(s) denied`
    },
    {
      gate: 'tenant_permission_boundary',
      ready: tenantBoundary.safeToEvaluate || tenantBoundary.enforcement === 'audit',
      detail: `${tenantBoundary.enforcement}:${tenantBoundary.reasonCodes.join(',') || 'scoped'}`
    },
    {
      gate: 'hosted_kernel',
      ready: hostedKernel.hasLease && hostedKernel.canAttach && hostedKernel.heartbeatAgeMs <= hostedKernel.heartbeatStaleAfterMs,
      detail: `${hostedKernel.kernelId}:${hostedKernel.status}`
    },
    {
      gate: 'provider_contract',
      ready: providerContract.negotiation.compatible && providerContract.sync.fresh && providerContract.handoff.ready,
      detail: `${providerContract.providerId}:${providerContract.protocol}`
    },
    ...(providerContract.mailchimp.enabled
      ? [{
          gate: 'mailchimp_marketing_context',
          ready: providerContract.mailchimp.ready,
          detail: [
            providerContract.mailchimp.campaign.campaignId || 'campaign-missing',
            providerContract.mailchimp.audience.audienceId || 'audience-missing',
            providerContract.mailchimp.campaign.status,
            providerContract.mailchimp.lifecycleGate.state
          ].join(':'),
          reasonCodes: providerContract.mailchimp.lifecycleGate.reasonCodes,
          nextProviderAction: providerContract.mailchimp.lifecycleGate.nextProviderAction
        },
        {
          gate: 'mailchimp_publish_guard',
          ready: providerContract.mailchimp.publishGuard.ready,
          detail: [
            providerContract.mailchimp.publishGuard.state,
            providerContract.mailchimp.publishGuard.campaign.campaignId || 'campaign-missing',
            providerContract.mailchimp.publishGuard.audience.audienceId || 'audience-missing'
          ].join(':'),
          reasonCodes: providerContract.mailchimp.publishGuard.reasonCodes,
          nextProviderAction: providerContract.mailchimp.publishGuard.nextProviderAction
        }]
      : []),
    {
      gate: 'external_handoff_checkpoint',
      ready: handoffCheckpoint.acknowledgement.accepted,
      detail: handoffCheckpoint.acknowledgement.required
        ? `${handoffCheckpoint.target}:${handoffCheckpoint.acknowledgement.state}`
        : 'handoff checkpoint optional'
    },
    {
      gate: 'audit_proof',
      ready: auditProof.outcome.safeToAttachKernel || !lifecycleControls.settings.requireAuditProof,
      detail: lifecycleControls.settings.requireAuditProof ? auditProof.type : 'audit proof optional'
    },
    {
      gate: 'lifecycle_schedule',
      ready: lifecycleControls.settings.enabled && lifecycleControls.schedule.ready,
      detail: `${lifecycleControls.command}:${lifecycleControls.schedule.mode}`
    },
    {
      gate: 'persisted_state_boundary',
      ready: persistedState.boundary.safeForReplay,
      detail: persistedState.boundary.safeForReplay
        ? persistedState.storageKey
        : persistedState.boundary.reasonCodes.join(',')
    },
    {
      gate: 'verifier_claim_gate',
      ready: verifierClaimGate.allowed,
      detail: verifierClaimGate.required
        ? `${verifierClaimGate.route}:${verifierClaimGate.decision || 'missing'}`
        : 'completion gate not required'
    }
  ];
  const blockedGateNames = readinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate);

  return {
    contract: 'operator-userland.cli-claim.acceptance-preview.v1',
    generatedAt: now,
    actor: {
      principalId: principal.principalId,
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId
    },
    preview: {
      command: lifecycleControls.command,
      mode: operationalMode,
      verdict: attachAccepted ? 'accepted' : retryPlan.retryable ? 'retryable' : errorFindings.length > 0 || deniedClaims.length > 0 ? 'blocked' : 'preview_only',
      dryRun: lifecycleControls.settings.dryRun,
      attachAccepted,
      blockedGates: blockedGateNames
    },
    validationSummary: {
      ok: errorFindings.length === 0,
      errorCount: errorFindings.length,
      warningCount: warningFindings.length,
      deniedClaimCount: deniedClaims.length,
      codes: stableList(validationFindings.map((finding) => finding.code)),
      deniedClaims: deniedClaims.map((claim) => ({
        name: claim.name,
        permission: claim.permission,
        reasons: claim.reasons
      }))
    },
    readiness: {
      ready: attachAccepted,
      gates: readinessGates,
      providerReady: providerContract.negotiation.compatible && providerContract.sync.fresh && providerContract.handoff.ready,
      mailchimpReady: providerContract.mailchimp.enabled ? providerContract.mailchimp.ready : null,
      mailchimpLifecycleGateReady: providerContract.mailchimp.enabled ? providerContract.mailchimp.lifecycleGate.ready : null,
      mailchimpLifecycleGate: providerContract.mailchimp.enabled ? providerContract.mailchimp.lifecycleGate : null,
      mailchimpPublishGuardReady: providerContract.mailchimp.enabled ? providerContract.mailchimp.publishGuard.ready : null,
      mailchimpPublishGuard: providerContract.mailchimp.enabled ? providerContract.mailchimp.publishGuard : null,
      kernelReady: hostedKernel.hasLease && hostedKernel.canAttach && hostedKernel.heartbeatAgeMs <= hostedKernel.heartbeatStaleAfterMs,
      scheduleReady: lifecycleControls.schedule.ready,
      persistedStateReady: persistedState.boundary.safeForReplay,
      tenantPermissionBoundaryReady: tenantBoundary.safeToEvaluate || tenantBoundary.enforcement === 'audit',
      auditReady: auditProof.outcome.safeToAttachKernel || !lifecycleControls.settings.requireAuditProof,
      verifierClaimGateReady: verifierClaimGate.allowed
    },
    nextStep: {
      state: nextActionState.state,
      action: nextActionState.action,
      reasonCodes: nextActionState.reasonCodes,
      lifecycleTransition: lifecycleControls.transition,
      lifecycleSettingsPolicy: lifecycleControls.settingsPolicy,
      retryable: retryPlan.retryable,
      retryPolicy: retryPlan.retryable ? retryPlan.policy : null,
      providerTarget: providerContract.handoff.required ? providerContract.handoff.target : null,
      correlationId: providerContract.handoff.correlationId || null,
      mailchimpProviderAction: providerContract.mailchimp.enabled ? providerContract.mailchimp.nextProviderAction : null,
      mailchimpLifecycleGate: providerContract.mailchimp.enabled ? providerContract.mailchimp.lifecycleGate : null,
      mailchimpPublishGuard: providerContract.mailchimp.enabled ? providerContract.mailchimp.publishGuard : null,
      handoffAcknowledgementId: handoffCheckpoint.acknowledgement.id,
      idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation,
      restartSafe: !persistedState.recovery.required || persistedState.recovery.canResume
    },
    failureState: {
      contract: failureState.contract,
      state: failureState.state,
      primaryCode: failureState.primaryCode,
      blockedOperations: failureState.blockedOperations,
      degradedAllowed: failureState.degradedAllowed,
      operatorActions: failureState.operatorActions
    },
    persistedStatus: {
      contract: persistedState.contract,
      storageKey: persistedState.storageKey,
      boundary: persistedState.boundary,
      lastKnown: persistedState.lastKnown,
      recovery: persistedState.recovery,
      statusProjection: persistedState.statusProjection,
      writePlan: persistedState.writePlan
    },
    tenantPermissionBoundary: tenantBoundary,
    handoffCheckpoint: {
      contract: handoffCheckpoint.contract,
      providerId: handoffCheckpoint.providerId,
      target: handoffCheckpoint.target,
      acknowledgement: handoffCheckpoint.acknowledgement,
      checkpoint: handoffCheckpoint.checkpoint
    },
    mailchimpMarketing: providerContract.mailchimp,
    verifierClaimGate: {
      contract: verifierClaimGate.contract,
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      route: verifierClaimGate.route,
      routePolicy: verifierClaimGate.routePolicy,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      decision: verifierClaimGate.decision,
      providerReceipt: verifierClaimGate.providerReceipt,
      submission: verifierClaimGate.submission,
      reasonCodes: verifierClaimGate.reasonCodes
    }
  };
}

function buildVerifierGateClientDispatch({
  now,
  requestId,
  invocationId,
  source,
  outputFormat,
  lifecycleControls,
  providerContract,
  persistedState,
  verifierClaimGate
}) {
  const completionWriteIntent = Boolean(
    verifierClaimGate.required
      && !lifecycleControls.settings.dryRun
      && ['claim', 'attach'].includes(lifecycleControls.command)
  );
  const gateSubmissionRequired = completionWriteIntent && !verifierClaimGate.allowed;
  const acceptedGateReceipt = completionWriteIntent && verifierClaimGate.allowed;
  const directCompletionAllowed = !completionWriteIntent || acceptedGateReceipt;
  const refreshReceiptRequired = gateSubmissionRequired && verifierClaimGate.submission.refreshReceiptRequired;
  const pollRequired = gateSubmissionRequired && verifierClaimGate.pending;
  const submitRequired = gateSubmissionRequired && !verifierClaimGate.submittedThroughGate;
  const resubmitRequired = gateSubmissionRequired && verifierClaimGate.rejected;
  const clientWritableRoute = gateSubmissionRequired
    ? verifierClaimGate.route
    : acceptedGateReceipt
      ? '/operator-userland/cli-claim/accept'
      : lifecycleControls.settings.dryRun
        ? '/operator-userland/cli-claim/preview'
        : null;
  const nextClientOperation = submitRequired
    ? 'submit_verifier_claim_gate'
    : pollRequired
      ? 'poll_verifier_claim_gate'
      : refreshReceiptRequired
        ? 'refresh_verifier_gate_receipt'
        : resubmitRequired
          ? 'resubmit_verifier_claim_gate'
          : acceptedGateReceipt
            ? 'continue_completion_acceptance'
            : 'preview_only';
  const acceptedReceipt = acceptedGateReceipt
    ? {
        gateId: verifierClaimGate.gateId,
        verifierRunId: verifierClaimGate.verifierRunId,
        decision: verifierClaimGate.decision,
        providerReceipt: verifierClaimGate.providerReceipt,
        acceptedAt: verifierClaimGate.submittedAt
      }
    : null;

  return {
    contract: 'operator-userland.cli-claim.verifier-gate-client-dispatch.v1',
    generatedAt: now,
    requestId,
    invocationId,
    source,
    outputFormat,
    completionWriteIntent,
    directCompletionAllowed,
    clientWritableRoute,
    nextClientOperation,
    gate: {
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      submitted: verifierClaimGate.submittedThroughGate,
      pending: verifierClaimGate.pending,
      rejected: verifierClaimGate.rejected,
      route: verifierClaimGate.route,
      routePolicy: verifierClaimGate.routePolicy,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      decision: verifierClaimGate.decision,
      reasonCodes: verifierClaimGate.reasonCodes
    },
    stateGuard: {
      storageKey: persistedState.storageKey,
      idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation,
      canWriteCompletionState: directCompletionAllowed && persistedState.writePlan.shouldWrite,
      writeSuppressedUntilGateReceipt: gateSubmissionRequired,
      acceptedReceipt
    },
    providerReceipt: {
      required: verifierClaimGate.required,
      expectedProviderId: providerContract.providerId,
      expectedSyncCursor: providerContract.sync.cursor,
      expectedRevision: providerContract.sync.revision,
      expectedExternalStateId: providerContract.handoff.externalStateId,
      matches: verifierClaimGate.providerReceipt.matches,
      refreshRequired: refreshReceiptRequired
    },
    commands: {
      submit: gateSubmissionRequired ? verifierClaimGate.submission.operatorCommand : null,
      poll: pollRequired
        ? `status --verifier-claim-gate --gate-id=${verifierClaimGate.gateId} --run-id=${verifierClaimGate.verifierRunId}`
        : null,
      continue: acceptedGateReceipt
        ? `${lifecycleControls.command.replace(/_/g, '-')} --accept --request-id=${requestId}`
        : null
    },
    submissionPayload: gateSubmissionRequired ? verifierClaimGate.submission.payload : null,
    reasonCodes: stableList([
      ...(completionWriteIntent ? ['completion_write_requires_verifier_gate'] : ['completion_write_not_requested']),
      ...(directCompletionAllowed ? ['direct_completion_gate_satisfied'] : ['direct_completion_suppressed']),
      ...(submitRequired ? ['submit_gate_payload'] : []),
      ...(pollRequired ? ['poll_gate_until_accepted'] : []),
      ...(refreshReceiptRequired ? ['refresh_gate_provider_receipt'] : []),
      ...(resubmitRequired ? ['resubmit_rejected_gate'] : []),
      ...verifierClaimGate.reasonCodes
    ])
  };
}

function normalizeCliClientRequestEnvelope(input = {}, {
  now,
  principal,
  scope,
  tenantBoundary,
  providerContract,
  persistedState,
  lifecycleControls,
  verifierClaimGate,
  requestId,
  outputFormat
}) {
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const session = client.session && typeof client.session === 'object'
    ? client.session
    : request.session && typeof request.session === 'object'
      ? request.session
      : {};
  const terminal = client.terminal && typeof client.terminal === 'object'
    ? client.terminal
    : request.terminal && typeof request.terminal === 'object'
      ? request.terminal
      : {};
  const invocationId = String(
    request.invocationId
      || client.invocationId
      || session.invocationId
      || `${requestId}:invoke`
  ).trim();
  const sessionId = String(session.sessionId || session.id || client.sessionId || request.sessionId || requestId).trim();
  const source = String(request.source || client.source || 'operator-cli').trim();
  const interactive = normalizeBoolean(
    terminal.interactive ?? session.interactive ?? client.interactive,
    source === 'operator-cli'
  );
  const receipts = providerContract.negotiation.requiredCapabilities.map((capability) => ({
    capability,
    present: providerContract.capabilities.includes(capability),
    providerId: providerContract.providerId
  }));
  const verifierGateDispatch = buildVerifierGateClientDispatch({
    now,
    requestId,
    invocationId,
    source,
    outputFormat,
    lifecycleControls,
    providerContract,
    persistedState,
    verifierClaimGate
  });

  return {
    contract: 'operator-userland.cli-claim.client-request-envelope.v1',
    receivedAt: now,
    requestId,
    invocationId,
    session: {
      sessionId,
      channel: String(client.channel || request.channel || 'cli').trim(),
      source,
      clientVersion: String(client.version || client.clientVersion || request.clientVersion || 'unknown').trim(),
      interactive,
      outputFormat,
      terminal: {
        tty: normalizeBoolean(terminal.tty, interactive),
        columns: normalizePositiveInteger(terminal.columns ?? terminal.width, 80),
        rows: normalizePositiveInteger(terminal.rows ?? terminal.height, 24)
      }
    },
    boundary: {
      tenantId: scope.requestedTenantId,
      workspaceId: scope.requestedWorkspaceId,
      principalId: principal.principalId,
      storageKey: persistedState.storageKey,
      idempotencyKey: persistedState.idempotency.key,
      replaySafe: persistedState.boundary.safeForReplay,
      permissionBoundaryContract: tenantBoundary.contract,
      permissionBoundaryEnforcement: tenantBoundary.enforcement,
      permissionBoundarySafe: tenantBoundary.safeToEvaluate,
      effectivePermissions: tenantBoundary.permissions.effectivePermissions
    },
    providerReceipts: {
      providerId: providerContract.providerId,
      protocol: providerContract.protocol,
      requiredCapabilities: providerContract.negotiation.requiredCapabilities,
      missingCapabilities: providerContract.negotiation.missingCapabilities,
      receipts
    },
    lifecycleIntent: {
      command: lifecycleControls.command,
      dryRun: lifecycleControls.settings.dryRun,
      scheduleMode: lifecycleControls.schedule.mode,
      notBefore: lifecycleControls.schedule.notBefore,
      settingsPolicy: lifecycleControls.settingsPolicy,
      transition: lifecycleControls.transition
    },
    verifierGateDispatch,
    clientWritePolicy: {
      contract: 'operator-userland.cli-claim.client-write-policy.v1',
      route: verifierGateDispatch.clientWritableRoute,
      nextOperation: verifierGateDispatch.nextClientOperation,
      directCompletionAllowed: verifierGateDispatch.directCompletionAllowed,
      stateWriteSuppressed: verifierGateDispatch.stateGuard.writeSuppressedUntilGateReceipt,
      canWriteCompletionState: verifierGateDispatch.stateGuard.canWriteCompletionState,
      reasonCodes: verifierGateDispatch.reasonCodes
    }
  };
}

function buildClientWorkflowHandoff({
  principal,
  scope,
  lifecycleControls,
  providerContract,
  handoffCheckpoint,
  persistedState,
  nextActionState,
  failureState,
  commandArgs,
  stateMutation,
  requestEnvelope,
  verifierClaimGate,
  blocked
}) {
  const baseCommand = commandArgs.join(' ');
  const handoffArgs = stableList([
    providerContract.handoff.externalStateId ? `--external-state=${providerContract.handoff.externalStateId}` : null,
    providerContract.handoff.correlationId ? `--correlation-id=${providerContract.handoff.correlationId}` : null,
    handoffCheckpoint.acknowledgement.id ? `--handoff-ack=${handoffCheckpoint.acknowledgement.id}` : null,
    persistedState.lastKnown.restartToken ? `--resume-token=${persistedState.lastKnown.restartToken}` : null
  ]);
  const resumeAllowed = persistedState.recovery.canResume
    && persistedState.boundary.safeForReplay
    && !failureState.blockedOperations.includes('recovery');
  const requiresOperatorHandoff = providerContract.handoff.required
    || ['await_external_handoff', 'resume_persisted_state', 'attach_hosted_kernel'].includes(nextActionState.action);
  const statusCommand = `status --tenant=${scope.requestedTenantId} --workspace=${scope.requestedWorkspaceId} --idempotency-key=${persistedState.idempotency.key}`;
  const acceptCommand = `${lifecycleControls.command.replace(/_/g, '-')} --accept --request-id=${requestEnvelope.requestId}`;
  const verifierGateCommand = verifierClaimGate.submission.operatorCommand;
  const verifierGateDispatch = requestEnvelope.verifierGateDispatch;
  const resumeCommand = resumeAllowed
    ? `${lifecycleControls.command.replace(/_/g, '-')} --resume --idempotency-key=${persistedState.idempotency.key}`
    : null;
  const primaryGateCommand = verifierGateDispatch.stateGuard.writeSuppressedUntilGateReceipt
    ? verifierGateDispatch.commands.submit || verifierGateDispatch.commands.poll || verifierGateCommand
    : null;

  return {
    contract: 'operator-userland.cli-claim.client-workflow-handoff.v1',
    principalId: principal.principalId,
    scopeKey: `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`,
    state: blocked ? 'blocked' : nextActionState.state,
    action: nextActionState.action,
    requiresOperatorHandoff,
    commandHints: {
      primary: primaryGateCommand
        || (requiresOperatorHandoff && handoffArgs.length > 0
        ? `${baseCommand} ${handoffArgs.join(' ')}`
        : baseCommand),
      accept: stateMutation && verifierGateDispatch.directCompletionAllowed ? acceptCommand : null,
      verifierGate: verifierGateCommand,
      verifierGateSubmit: verifierGateDispatch.commands.submit,
      verifierGatePoll: verifierGateDispatch.commands.poll,
      verifierGateContinue: verifierGateDispatch.commands.continue,
      resume: resumeCommand,
      status: statusCommand
    },
    handoffState: {
      target: providerContract.handoff.target,
      externalStateId: providerContract.handoff.externalStateId,
      correlationId: providerContract.handoff.correlationId || requestEnvelope.invocationId,
      acknowledgementId: handoffCheckpoint.acknowledgement.id,
      acknowledgementState: handoffCheckpoint.acknowledgement.state,
      checkpointCursor: handoffCheckpoint.checkpoint.cursor,
      checkpointMutationRequired: Boolean(handoffCheckpoint.checkpoint.stateMutation),
      readyForClientCommit: Boolean(stateMutation)
        && verifierGateDispatch.directCompletionAllowed
        && (!handoffCheckpoint.acknowledgement.required || handoffCheckpoint.acknowledgement.accepted)
    },
    verifierClaimGate: {
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      pending: verifierClaimGate.pending,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      command: verifierGateCommand,
      retry: verifierClaimGate.submission.retry,
      clientDispatch: verifierGateDispatch
    },
    persistence: {
      storageKey: persistedState.storageKey,
      operation: persistedState.writePlan.operation,
      mutationPlanned: Boolean(stateMutation),
      revision: persistedState.writePlan.revision,
      resumeAllowed,
      restartToken: persistedState.lastKnown.restartToken,
      statusProjection: persistedState.statusProjection
    },
    operatorPrompts: stableList([
      ...(blocked ? ['resolve_blockers_before_accept'] : []),
      ...(providerContract.handoff.required && !providerContract.handoff.ready ? ['await_provider_handoff_ready'] : []),
      ...(handoffCheckpoint.acknowledgement.required && !handoffCheckpoint.acknowledgement.accepted ? ['attach_handoff_acknowledgement'] : []),
      ...(!verifierClaimGate.allowed && verifierClaimGate.required ? ['complete_verifier_claim_gate'] : []),
      ...(verifierGateDispatch.stateGuard.writeSuppressedUntilGateReceipt ? ['send_completion_to_verifier_gate_only'] : []),
      ...(resumeAllowed ? ['resume_previous_workflow_available'] : []),
      ...(stateMutation ? ['persist_client_state_mutation'] : [])
    ])
  };
}

function buildOperatorHandoffManifest({
  now,
  principal,
  scope,
  lifecycleControls,
  providerContract,
  handoffCheckpoint,
  persistedState,
  nextActionState,
  failureState,
  requestEnvelope,
  workflowHandoff,
  stateMutation,
  auditProof,
  boundaryExecution,
  verifierClaimGate,
  outputFormat,
  blocked
}) {
  const requiredArtifactRows = [
    {
      id: 'request_envelope',
      contract: requestEnvelope.contract,
      required: true,
      present: Boolean(requestEnvelope.requestId),
      source: requestEnvelope.session.source,
      storageKey: persistedState.storageKey
    },
    {
      id: 'audit_proof',
      contract: auditProof.type,
      required: lifecycleControls.settings.requireAuditProof,
      present: !lifecycleControls.settings.requireAuditProof || auditProof.outcome.safeToAttachKernel,
      source: 'audit.proof',
      storageKey: `${principal.tenantId}/${scope.requestedWorkspaceId}/audit-proof`
    },
    {
      id: 'state_mutation',
      contract: 'operator-userland.cli-claim.state-mutation.v1',
      required: persistedState.writePlan.shouldWrite,
      present: Boolean(stateMutation),
      source: persistedState.writePlan.operation,
      storageKey: persistedState.storageKey
    },
    {
      id: 'handoff_acknowledgement',
      contract: handoffCheckpoint.contract,
      required: handoffCheckpoint.acknowledgement.required,
      present: !handoffCheckpoint.acknowledgement.required || handoffCheckpoint.acknowledgement.accepted,
      source: providerContract.handoff.target,
      storageKey: handoffCheckpoint.acknowledgement.id || providerContract.handoff.externalStateId || null
    },
    {
      id: 'provider_sync_cursor',
      contract: providerContract.contract,
      required: providerContract.negotiation.requiredCapabilities.includes('sync.metadata'),
      present: providerContract.sync.fresh && Boolean(providerContract.sync.cursor || providerContract.sync.revision),
      source: providerContract.providerId,
      storageKey: providerContract.sync.cursor || `revision:${providerContract.sync.revision}`
    },
    {
      id: 'boundary_execution_guard',
      contract: boundaryExecution.contract,
      required: true,
      present: boundaryExecution.commit.allowed,
      source: boundaryExecution.audit.recordType,
      storageKey: boundaryExecution.audit.stream
    },
    {
      id: 'verifier_claim_gate_receipt',
      contract: verifierClaimGate.contract,
      required: verifierClaimGate.required,
      present: !verifierClaimGate.required || verifierClaimGate.allowed,
      source: verifierClaimGate.route,
      storageKey: verifierClaimGate.gateId || verifierClaimGate.submission.payload?.route || null
    }
  ];
  const missingArtifacts = requiredArtifactRows
    .filter((artifact) => artifact.required && !artifact.present)
    .map((artifact) => artifact.id);
  const commitReady = !blocked
    && missingArtifacts.length === 0
    && boundaryExecution.commit.allowed
    && persistedState.boundary.safeForReplay
    && (!providerContract.handoff.required || providerContract.handoff.ready);
  const routeIntent = nextActionState.action === 'attach_hosted_kernel'
    ? 'commit_and_attach'
    : nextActionState.action === 'grant_claims'
      ? 'commit_claims'
      : nextActionState.action === 'resume_persisted_state'
        ? 'resume_and_commit'
        : nextActionState.action === 'await_external_handoff'
          ? 'await_handoff'
          : nextActionState.action === 'report_persisted_status'
            ? 'read_status'
            : 'preview';

  return {
    contract: 'operator-userland.cli-claim.operator-handoff-manifest.v1',
    generatedAt: now,
    requestId: requestEnvelope.requestId,
    invocationId: requestEnvelope.invocationId,
    routeIntent,
    commitReady,
    outputFormat,
    scope: {
      tenantId: scope.requestedTenantId,
      workspaceId: scope.requestedWorkspaceId,
      principalId: principal.principalId,
      scopeKey: `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`
    },
    artifacts: requiredArtifactRows,
    missingArtifacts,
    clientCommit: {
      required: Boolean(stateMutation) || providerContract.handoff.required,
      allowed: commitReady,
      command: commitReady ? workflowHandoff.commandHints.accept : null,
      blockedReasons: stableList([
        ...missingArtifacts.map((artifact) => `missing_${artifact}`),
        ...boundaryExecution.commit.reasonCodes,
        ...(verifierClaimGate.allowed ? [] : verifierClaimGate.reasonCodes),
        ...(persistedState.boundary.safeForReplay ? [] : persistedState.boundary.reasonCodes),
        ...(providerContract.handoff.required && !providerContract.handoff.ready ? ['provider_handoff_not_ready'] : []),
        ...failureState.blockedOperations.map((operation) => `blocked_${operation}`)
      ]),
      mutation: stateMutation,
      checkpointMutation: handoffCheckpoint.checkpoint.stateMutation
    },
    operatorHandoff: {
      target: providerContract.handoff.target,
      externalStateId: providerContract.handoff.externalStateId,
      correlationId: providerContract.handoff.correlationId || requestEnvelope.invocationId,
      acknowledgementId: handoffCheckpoint.acknowledgement.id,
      checkpointCursor: handoffCheckpoint.checkpoint.cursor,
      resumeCommand: workflowHandoff.commandHints.resume,
      statusCommand: workflowHandoff.commandHints.status,
      verifierGateCommand: workflowHandoff.commandHints.verifierGate,
      prompts: stableList([
        ...workflowHandoff.operatorPrompts,
        ...boundaryExecution.operatorPrompts,
        ...(missingArtifacts.length > 0 ? ['collect_required_handoff_artifacts'] : []),
        ...(commitReady ? ['commit_handoff_manifest'] : [])
      ])
    }
  };
}

function normalizeCliClientRuntime(input = {}, {
  now,
  principal,
  scope,
  tenantBoundary,
  requestedClaims,
  lifecycleControls,
  providerContract,
  handoffCheckpoint,
  persistedState,
  nextActionState,
  failureState,
  auditProof,
  boundaryExecution,
  verifierClaimGate
}) {
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const output = client.output && typeof client.output === 'object' ? client.output : {};
  const requestedOutputFormat = String(output.format || client.outputFormat || request.outputFormat || 'json').trim();
  const outputFormat = ['json', 'ndjson', 'summary'].includes(requestedOutputFormat) ? requestedOutputFormat : 'json';
  const requestId = String(request.requestId || client.requestId || providerContract.handoff.correlationId || persistedState.idempotency.key).trim();
  const claimArgs = requestedClaims.map((claim) => `--claim=${claim.name}`);
  const commandArgs = [
    lifecycleControls.command.replace(/_/g, '-'),
    `--tenant=${scope.requestedTenantId}`,
    `--workspace=${scope.requestedWorkspaceId}`,
    ...claimArgs,
    ...(lifecycleControls.settings.dryRun ? ['--dry-run'] : []),
    ...(providerContract.handoff.externalStateId ? [`--external-state=${providerContract.handoff.externalStateId}`] : []),
    ...(providerContract.handoff.correlationId ? [`--correlation-id=${providerContract.handoff.correlationId}`] : []),
    ...(persistedState.idempotency.supplied ? [`--idempotency-key=${persistedState.idempotency.key}`] : [])
  ];
  const blocked = failureState.blockedOperations.length > 0
    || nextActionState.state === 'blocked'
    || boundaryExecution.execution.blocked;
  const exitCode = nextActionState.action === 'report_persisted_status' && !blocked
    ? persistedState.statusProjection.statusExitCode
    : blocked
      ? 2
      : nextActionState.state === 'retryable'
        ? 75
        : ['scheduled', 'handoff_pending', 'waiting', 'exhausted'].includes(nextActionState.state)
          ? 78
          : 0;
  const handoffRequired = providerContract.handoff.required
    || ['attach_hosted_kernel', 'await_external_handoff', 'resume_persisted_state'].includes(nextActionState.action);
  const stateMutation = persistedState.writePlan.shouldWrite
    ? {
        operation: persistedState.writePlan.operation,
        storageKey: persistedState.storageKey,
        revision: persistedState.writePlan.revision,
        nextState: persistedState.writePlan.nextState,
        cursor: persistedState.writePlan.cursor,
        idempotencyKey: persistedState.idempotency.key,
        updatedAt: persistedState.writePlan.updatedAt
      }
    : null;
  const requestEnvelope = normalizeCliClientRequestEnvelope(input, {
    now,
    principal,
    scope,
    tenantBoundary,
    providerContract,
    persistedState,
    lifecycleControls,
    verifierClaimGate,
    requestId,
    outputFormat
  });
  const workflowHandoff = buildClientWorkflowHandoff({
    principal,
    scope,
    lifecycleControls,
    providerContract,
    handoffCheckpoint,
    persistedState,
    nextActionState,
    failureState,
    commandArgs,
    stateMutation,
    requestEnvelope,
    verifierClaimGate,
    blocked
  });
  const handoffManifest = buildOperatorHandoffManifest({
    now,
    principal,
    scope,
    lifecycleControls,
    providerContract,
    handoffCheckpoint,
    persistedState,
    nextActionState,
    failureState,
    requestEnvelope,
    workflowHandoff,
    stateMutation,
    auditProof,
    boundaryExecution,
    verifierClaimGate,
    outputFormat,
    blocked
  });

  return {
    contract: 'operator-userland.cli-claim.client-runtime.v1',
    generatedAt: now,
    request: {
      requestId,
      clientId: String(client.clientId || request.clientId || principal.principalId).trim(),
      channel: String(client.channel || request.channel || 'cli').trim(),
      command: lifecycleControls.command,
      argv: commandArgs,
      outputFormat,
      envelope: requestEnvelope
    },
    state: {
      lifecycleState: nextActionState.state,
      persistedCanonicalState: persistedState.statusProjection.canonicalState,
      persistedReplayClassification: persistedState.statusProjection.replayClassification,
      nextAction: nextActionState.action,
      exitCode,
      reasonCodes: nextActionState.reasonCodes,
      retryable: nextActionState.state === 'retryable',
      blockedOperations: failureState.blockedOperations,
      boundaryExecution,
      persistedBoundary: {
        ownedByScope: persistedState.boundary.ownedByScope,
        verified: persistedState.boundary.verified,
        safeForReplay: persistedState.boundary.safeForReplay,
        reasonCodes: persistedState.boundary.reasonCodes
      },
      tenantPermissionBoundary: {
        enforcement: tenantBoundary.enforcement,
        safeToEvaluate: tenantBoundary.safeToEvaluate,
        reasonCodes: tenantBoundary.reasonCodes,
        effectivePermissions: tenantBoundary.permissions.effectivePermissions,
        missingBoundaryPermissions: tenantBoundary.permissions.missingBoundaryPermissions
      },
      stateMutation,
      verifierGateDispatch: requestEnvelope.verifierGateDispatch,
      lifecycleTransition: lifecycleControls.transition,
      lifecycleSettingsPolicy: lifecycleControls.settingsPolicy
    },
    handoff: {
      required: handoffRequired,
      target: providerContract.handoff.target,
      externalStateId: providerContract.handoff.externalStateId,
      correlationId: providerContract.handoff.correlationId,
      ready: providerContract.handoff.ready,
      command: handoffRequired
        ? `${lifecycleControls.command.replace(/_/g, '-')} --handoff ${providerContract.handoff.target}`
        : null,
      resumeToken: persistedState.lastKnown.restartToken,
      resumeSafe: persistedState.statusProjection.restartSafe || !persistedState.recovery.required,
      acknowledgement: handoffCheckpoint.acknowledgement,
      checkpointMutation: handoffCheckpoint.checkpoint.stateMutation
    },
    workflowHandoff,
    handoffManifest,
    proof: {
      required: lifecycleControls.settings.requireAuditProof,
      attachments: stableList([
        auditProof.type,
        boundaryExecution.contract,
        requestEnvelope.contract,
        workflowHandoff.contract,
        handoffManifest.contract,
        'operator-userland.cli-claim.export-summary.v1',
        lifecycleControls.settingsPolicy.contract,
        lifecycleControls.transition.contract,
        handoffCheckpoint.contract,
        verifierClaimGate.contract,
        persistedState.boundary.contract,
        persistedState.contract,
        ...(failureState.state === 'healthy' ? [] : [failureState.contract])
      ]),
      auditProofType: auditProof.type,
      exportContract: 'operator-userland.cli-claim.export-summary.v1'
    },
    userVisible: {
      headline: blocked
        ? 'Claim blocked'
        : nextActionState.state === 'retryable'
          ? 'Claim retry scheduled'
        : nextActionState.state === 'scheduled'
          ? 'Claim scheduled'
          : nextActionState.state === 'exhausted'
            ? 'Claim schedule exhausted'
            : nextActionState.action === 'attach_hosted_kernel'
              ? 'Hosted kernel attach ready'
              : 'Claim workflow ready',
      primaryAction: nextActionState.action,
      secondaryActions: failureState.operatorActions,
      statusLine: `${principal.principalId} ${nextActionState.action} ${scope.requestedWorkspaceId}`,
      persistedStatusLine: `${persistedState.statusProjection.canonicalState}:${persistedState.statusProjection.replayClassification}`,
      handoffTarget: handoffRequired ? providerContract.handoff.target : null,
      handoffCommand: workflowHandoff.commandHints.primary,
      handoffManifestCommand: handoffManifest.clientCommit.command,
      verifierGateCommand: workflowHandoff.commandHints.verifierGate,
      verifierGateSubmitCommand: workflowHandoff.commandHints.verifierGateSubmit,
      resumeCommand: workflowHandoff.commandHints.resume || persistedState.statusProjection.recoveryPath.resumeCommand,
      prompts: handoffManifest.operatorHandoff.prompts,
      boundaryMode: boundaryExecution.execution.mode,
      boundaryDecision: boundaryExecution.execution.allowed ? 'allowed' : 'blocked',
      boundaryStatus: persistedState.boundary.safeForReplay
        ? 'persisted state scoped'
        : persistedState.boundary.ownedByScope
          ? 'persisted state needs boundary metadata'
          : 'persisted state rejected across scope'
    }
  };
}

function buildHostedKernelDispatchContract({
  now,
  principal,
  scope,
  tenantBoundary,
  claimDecisions,
  lifecycleControls,
  providerContract,
  handoffCheckpoint,
  persistedState,
  clientRuntime,
  acceptancePreview,
  failureState,
  retryPlan,
  auditProof,
  verifierClaimGate,
  boundaryExecution
}) {
  const nextAction = clientRuntime.state.nextAction;
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const grantedClaims = claimDecisions.filter((claim) => claim.allowed);
  const actionRoute = {
    attach_hosted_kernel: 'kernel.attach',
    grant_claims: 'claim.grant',
    report_dry_run: 'claim.preview',
    retry_with_backoff: 'claim.retry',
    resume_persisted_state: 'state.resume',
    await_external_handoff: 'handoff.await',
    report_persisted_status: 'state.status',
    return_cached_completion: 'state.cached',
    wait_until_not_before: 'schedule.wait',
    await_manual_start: 'schedule.manual',
    schedule_exhausted: 'schedule.exhausted',
    persist_settings: 'lifecycle.persist',
    refresh_claim: 'lifecycle.refresh',
    enable_first: 'lifecycle.blocked',
    resolve_findings: 'validation.blocked'
  };
  const routeName = actionRoute[nextAction] || 'claim.preview';
  const blocked = failureState.blockedOperations.length > 0 || clientRuntime.state.exitCode !== 0;
  const mutationRequired = ['kernel.attach', 'claim.grant', 'state.resume', 'lifecycle.persist', 'lifecycle.refresh'].includes(routeName)
    || lifecycleControls.transition.mutationRequired;
  const handoffCheckpointRequired = handoffCheckpoint.acknowledgement.required
    && ['kernel.attach', 'handoff.await', 'state.resume'].includes(routeName);
  const dispatchable = !blocked
    && boundaryExecution.dispatch.allowed
    && providerContract.negotiation.compatible
    && providerContract.sync.fresh
    && (!providerContract.handoff.required || providerContract.handoff.ready)
    && (!handoffCheckpointRequired || handoffCheckpoint.acknowledgement.accepted)
    && verifierClaimGate.allowed
    && (!mutationRequired || Boolean(clientRuntime.state.stateMutation))
    && (routeName !== 'kernel.attach' || acceptancePreview.preview.attachAccepted);
  const commandEnvelope = {
    contract: 'operator-userland.cli-claim.hosted-kernel-command.v1',
    commandId: `${clientRuntime.request.requestId}:${routeName}`,
    idempotencyKey: persistedState.idempotency.key,
    route: routeName,
    command: lifecycleControls.command,
    tenantId: principal.tenantId,
    workspaceId: scope.requestedWorkspaceId,
    principalId: principal.principalId,
    claims: grantedClaims.map((claim) => ({
      name: claim.name,
      permission: claim.permission,
      decision: 'grant'
    })),
    deniedClaims: deniedClaims.map((claim) => ({
      name: claim.name,
      permission: claim.permission,
      reasons: claim.reasons
    })),
    stateMutation: clientRuntime.state.stateMutation,
    handoffCheckpoint: {
      contract: handoffCheckpoint.contract,
      acknowledgement: handoffCheckpoint.acknowledgement,
      checkpointMutation: handoffCheckpoint.checkpoint.stateMutation
    },
    proof: {
      type: auditProof.type,
      required: clientRuntime.proof.required,
      attachments: clientRuntime.proof.attachments,
      evidenceCount: auditProof.evidence.length
    },
    permissionBoundary: {
      contract: tenantBoundary.contract,
      enforcement: tenantBoundary.enforcement,
      safeToEvaluate: tenantBoundary.safeToEvaluate,
      effectivePermissions: tenantBoundary.permissions.effectivePermissions,
      reasonCodes: tenantBoundary.reasonCodes,
      auditHandoff: tenantBoundary.auditHandoff
    },
    boundaryExecution: {
      contract: boundaryExecution.contract,
      executionId: boundaryExecution.execution.executionId,
      mode: boundaryExecution.execution.mode,
      allowed: boundaryExecution.execution.allowed,
      dispatchAllowed: boundaryExecution.dispatch.allowed,
      reasonCodes: boundaryExecution.execution.reasonCodes,
      audit: boundaryExecution.audit
    },
    verifierClaimGate: {
      contract: verifierClaimGate.contract,
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      route: verifierClaimGate.route,
      routePolicy: verifierClaimGate.routePolicy,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      decision: verifierClaimGate.decision,
      providerReceipt: verifierClaimGate.providerReceipt,
      reasonCodes: verifierClaimGate.reasonCodes
    },
    lifecycle: {
      contract: lifecycleControls.contract,
      command: lifecycleControls.command,
      settings: lifecycleControls.settings,
      schedule: lifecycleControls.schedule,
      settingsPolicy: lifecycleControls.settingsPolicy,
      transition: lifecycleControls.transition
    }
  };

  return {
    contract: 'operator-userland.cli-claim.hosted-kernel-dispatch.v1',
    generatedAt: now,
    dispatch: {
      route: routeName,
      dispatchable,
      dryRun: lifecycleControls.settings.dryRun,
      blocked,
      blockedReasons: stableList([
        ...(blocked ? failureState.blockedOperations : []),
        ...boundaryExecution.dispatch.reasonCodes,
        ...(providerContract.negotiation.compatible ? [] : ['provider_capability_missing']),
        ...(providerContract.sync.fresh ? [] : ['provider_sync_stale']),
        ...(!providerContract.handoff.required || providerContract.handoff.ready ? [] : ['provider_handoff_not_ready']),
        ...(!handoffCheckpointRequired || handoffCheckpoint.acknowledgement.accepted ? [] : ['provider_handoff_checkpoint_not_accepted']),
        ...(verifierClaimGate.allowed ? [] : ['verifier_claim_gate_required']),
        ...(!mutationRequired || clientRuntime.state.stateMutation ? [] : ['state_mutation_missing']),
        ...(routeName !== 'kernel.attach' || acceptancePreview.preview.attachAccepted ? [] : ['attach_not_accepted'])
      ]),
      exitCode: clientRuntime.state.exitCode,
      retryable: retryPlan.retryable
    },
    transport: {
      providerId: providerContract.providerId,
      protocol: providerContract.protocol,
      service: providerContract.service,
      requiredCapabilities: providerContract.negotiation.requiredCapabilities,
      handoffTarget: providerContract.handoff.required ? providerContract.handoff.target : null,
      externalStateId: providerContract.handoff.externalStateId,
      handoffAcknowledgementId: handoffCheckpoint.acknowledgement.id,
      handoffCheckpointCursor: handoffCheckpoint.checkpoint.cursor,
      correlationId: providerContract.handoff.correlationId || clientRuntime.request.requestId
    },
    queue: {
      enqueue: dispatchable && !lifecycleControls.settings.dryRun,
      priority: routeName === 'kernel.attach' ? 'interactive' : retryPlan.retryable ? 'retry' : 'normal',
      retryPolicy: retryPlan.retryable ? retryPlan.policy : null,
      scheduledFor: lifecycleControls.schedule.cursor.nextRunAt
        || (lifecycleControls.schedule.mode === 'deferred' ? lifecycleControls.schedule.notBefore : now),
      maxConcurrentClaims: lifecycleControls.settings.maxConcurrentClaims,
      scheduleMode: lifecycleControls.schedule.mode,
      scheduleIntervalMs: lifecycleControls.schedule.intervalMs,
      scheduleMaxRuns: lifecycleControls.schedule.maxRuns,
      scheduleCompletedRuns: lifecycleControls.schedule.cursor.completedRuns,
      scheduleRemainingRuns: lifecycleControls.schedule.cursor.remainingRuns,
      scheduleCursorState: lifecycleControls.schedule.cursor.state
    },
    commandEnvelope,
    auditTrail: {
      append: dispatchable || deniedClaims.length > 0 || failureState.incidents.length > 0,
      stream: `${principal.tenantId}/${scope.requestedWorkspaceId}/cli-claim`,
      recordType: dispatchable ? 'dispatch_ready' : blocked ? 'dispatch_blocked' : 'dispatch_preview',
      proofType: auditProof.type,
      incidentCodes: stableList(failureState.incidents.map((incident) => incident.code)),
      boundaryDecision: boundaryExecution.audit.decision,
      boundaryRecordType: boundaryExecution.audit.recordType,
      verifierGateRouteRecordType: verifierClaimGate.routePolicy.auditHandoff.recordType,
      verifierGateRouteStream: verifierClaimGate.routePolicy.auditHandoff.stream,
      permissionBoundaryStream: tenantBoundary.auditHandoff.stream,
      permissionBoundaryRecordType: tenantBoundary.auditHandoff.recordType,
      lifecycleRecordType: lifecycleControls.transition.auditRecordType,
      lifecycleMutationRequired: lifecycleControls.transition.mutationRequired
    }
  };
}

function buildCliPreviewRouteContract({
  now,
  principal,
  scope,
  claimDecisions,
  validationFindings,
  lifecycleControls,
  providerContract,
  persistedState,
  acceptancePreview,
  clientRuntime,
  failureState,
  auditProof,
  boundaryExecution
}) {
  const grantedClaims = claimDecisions.filter((claim) => claim.allowed);
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const errorFindings = validationFindings.filter((finding) => finding.severity === 'error');
  const warningFindings = validationFindings.filter((finding) => finding.severity === 'warning');
  const blockedGateSet = new Set(acceptancePreview.preview.blockedGates);
  const verifierGateDispatch = clientRuntime.request.envelope.verifierGateDispatch;
  const readyGateNames = acceptancePreview.readiness.gates
    .filter((gate) => gate.ready)
    .map((gate) => gate.gate);
  const acceptEnabled = acceptancePreview.preview.attachAccepted
    && clientRuntime.state.exitCode === 0
    && boundaryExecution.commit.allowed
    && persistedState.writePlan.shouldWrite;
  const mailchimpAcceptance = buildMailchimpClaimAcceptanceHandoff({
    providerContract,
    lifecycleControls,
    scope,
    clientRuntime,
    boundaryExecution,
    persistedState,
    previewVerdict: acceptancePreview.preview.verdict,
    accepted: acceptEnabled,
    now
  });
  const routeStatus = acceptEnabled
    ? 'accept_ready'
    : clientRuntime.state.retryable
      ? 'retry_preview'
      : failureState.blockedOperations.length > 0
        ? 'blocked_preview'
        : 'read_only_preview';

  return {
    contract: 'operator-userland.cli-claim.preview-route.v1',
    generatedAt: now,
    route: {
      surfaceId,
      method: acceptEnabled ? 'POST' : 'GET',
      path: '/operator-userland/cli-claim/preview',
      acceptPath: '/operator-userland/cli-claim/accept',
      requestId: clientRuntime.request.requestId,
      outputFormat: clientRuntime.request.outputFormat
    },
    status: {
      routeStatus,
      verdict: acceptancePreview.preview.verdict,
      headline: clientRuntime.userVisible.headline,
      primaryAction: clientRuntime.userVisible.primaryAction,
      exitCode: clientRuntime.state.exitCode,
      retryable: clientRuntime.state.retryable,
      dryRun: acceptancePreview.preview.dryRun
    },
    validationSummary: {
      ok: errorFindings.length === 0 && deniedClaims.length === 0,
      errorCount: errorFindings.length,
      warningCount: warningFindings.length,
      deniedClaimCount: deniedClaims.length,
      blockedOperations: failureState.blockedOperations,
      findingCodes: stableList(validationFindings.map((finding) => finding.code)),
      blockedGates: acceptancePreview.preview.blockedGates,
      readyGates: readyGateNames
    },
    mailchimpAcceptance,
    previewSections: [
      {
        id: 'claims',
        label: 'Claims',
        state: deniedClaims.length === 0 ? 'ready' : 'blocked',
        summary: `${grantedClaims.length} granted / ${deniedClaims.length} denied`,
        items: claimDecisions.map((claim) => ({
          id: claim.name,
          state: claim.allowed ? 'granted' : 'denied',
          permission: claim.permission,
          reasons: claim.reasons
        }))
      },
      {
        id: 'readiness',
        label: 'Readiness',
        state: blockedGateSet.size === 0 ? 'ready' : 'attention',
        summary: blockedGateSet.size === 0 ? 'all gates ready' : `${blockedGateSet.size} gate(s) blocked`,
        items: acceptancePreview.readiness.gates.map((gate) => ({
          id: gate.gate,
          state: gate.ready ? 'ready' : 'blocked',
          detail: gate.detail
        }))
      },
      {
        id: 'next_step',
        label: 'Next step',
        state: clientRuntime.state.lifecycleState,
        summary: acceptancePreview.nextStep.action,
        items: acceptancePreview.nextStep.reasonCodes.map((code) => ({
          id: code,
          state: clientRuntime.state.retryable ? 'retryable' : 'explain',
          detail: code
        }))
      },
      {
        id: 'mailchimp_acceptance',
        label: 'Mailchimp acceptance',
        state: mailchimpAcceptance.ready ? 'ready' : mailchimpAcceptance.state,
        summary: mailchimpAcceptance.enabled
          ? mailchimpAcceptance.nextStep.action
          : 'not configured',
        items: mailchimpAcceptance.enabled
          ? [
              {
                id: 'campaign',
                state: mailchimpAcceptance.campaign.campaignId ? mailchimpAcceptance.campaign.status : 'missing',
                detail: mailchimpAcceptance.campaign.campaignId || 'campaign required'
              },
              {
                id: 'audience',
                state: mailchimpAcceptance.audience.audienceId ? 'selected' : 'missing',
                detail: mailchimpAcceptance.audience.audienceId || 'audience required'
              },
              {
                id: 'handoff',
                state: providerContract.handoff.ready ? 'ready' : providerContract.handoff.state,
                detail: providerContract.handoff.externalStateId || providerContract.handoff.target
              },
              ...mailchimpAcceptance.validationSummary.blockingCodes.map((code) => ({
                id: code,
                state: 'blocked',
                detail: code
              }))
            ]
          : []
      },
      {
        id: 'lifecycle_settings',
        label: 'Lifecycle settings',
        state: lifecycleControls.settingsPolicy.validation.ok ? lifecycleControls.transition.desiredState : 'blocked',
        summary: `${lifecycleControls.transition.operation}:${lifecycleControls.schedule.mode}`,
        items: [
          {
            id: 'enabled',
            state: lifecycleControls.settings.enabled ? 'enabled' : 'disabled',
            detail: lifecycleControls.transition.desiredState
          },
          {
            id: 'attach',
            state: lifecycleControls.settings.attachEnabled ? 'enabled' : 'disabled',
            detail: lifecycleControls.transition.enableAttachConflict ? 'attach blocked by settings' : 'attach control resolved'
          },
          {
            id: 'concurrency',
            state: lifecycleControls.settingsPolicy.normalized.maxConcurrentClaims.valid ? 'ready' : 'blocked',
            detail: String(lifecycleControls.settings.maxConcurrentClaims)
          },
          {
            id: 'schedule_cursor',
            state: lifecycleControls.schedule.cursor.state,
            detail: `${lifecycleControls.schedule.cursor.completedRuns}/${lifecycleControls.schedule.cursor.maxRuns} runs`
          }
        ]
      }
    ],
    acceptance: {
      enabled: acceptEnabled,
      disabledReasons: stableList([
        ...(acceptancePreview.preview.attachAccepted ? [] : ['preview_not_accepted']),
        ...(clientRuntime.state.exitCode === 0 ? [] : [`exit_code_${clientRuntime.state.exitCode}`]),
        ...boundaryExecution.commit.reasonCodes,
        ...(persistedState.writePlan.shouldWrite ? [] : ['no_state_write_planned']),
        ...(clientRuntime.handoff.resumeSafe ? [] : ['resume_not_safe'])
      ]),
      payload: acceptEnabled
        ? {
            contract: 'operator-userland.cli-claim.accept-command.v1',
            requestId: clientRuntime.request.requestId,
            idempotencyKey: persistedState.idempotency.key,
            command: lifecycleControls.command,
            tenantId: scope.requestedTenantId,
            workspaceId: scope.requestedWorkspaceId,
            principalId: principal.principalId,
            providerId: providerContract.providerId,
            handoffTarget: clientRuntime.handoff.required ? clientRuntime.handoff.target : null,
            externalStateId: providerContract.handoff.externalStateId,
            auditProofType: auditProof.type,
            boundaryExecutionId: boundaryExecution.execution.executionId,
            verifierClaimGateId: acceptancePreview.verifierClaimGate.gateId,
            verifierRunId: acceptancePreview.verifierClaimGate.verifierRunId,
            mailchimpAcceptance,
            stateMutation: clientRuntime.state.stateMutation
          }
        : null
    },
    nextStep: {
      contract: 'operator-userland.cli-claim.route-next-step.v1',
      action: verifierGateDispatch.stateGuard.writeSuppressedUntilGateReceipt
        ? verifierGateDispatch.nextClientOperation
        : acceptancePreview.nextStep.action,
      state: verifierGateDispatch.stateGuard.writeSuppressedUntilGateReceipt
        ? 'awaiting_verifier_claim_gate'
        : acceptancePreview.nextStep.state,
      reasonCodes: acceptancePreview.nextStep.reasonCodes,
      command: verifierGateDispatch.commands.submit
        || verifierGateDispatch.commands.poll
        || clientRuntime.handoff.command
        || clientRuntime.request.argv.join(' '),
      clientCommand: clientRuntime.workflowHandoff.commandHints.primary,
      acceptCommand: clientRuntime.workflowHandoff.commandHints.accept,
      verifierGateCommand: verifierGateDispatch.commands.submit || verifierGateDispatch.commands.poll,
      clientWritableRoute: verifierGateDispatch.clientWritableRoute,
      directCompletionAllowed: verifierGateDispatch.directCompletionAllowed,
      resumeCommand: clientRuntime.workflowHandoff.commandHints.resume,
      providerTarget: acceptancePreview.nextStep.providerTarget,
      correlationId: acceptancePreview.nextStep.correlationId,
      operatorPrompts: clientRuntime.workflowHandoff.operatorPrompts,
      restartSafe: acceptancePreview.nextStep.restartSafe
    }
  };
}

function buildCliAcceptanceDecisionContract({
  now,
  principal,
  scope,
  previewRoute,
  acceptancePreview,
  clientRuntime,
  hostedKernelDispatch,
  failureState,
  persistedState,
  providerContract,
  handoffCheckpoint,
  lifecycleControls,
  auditProof,
  verifierClaimGate,
  boundaryExecution
}) {
  const routeAcceptEnabled = previewRoute.acceptance.enabled;
  const dispatchAccepted = hostedKernelDispatch.dispatch.dispatchable && hostedKernelDispatch.queue.enqueue;
  const stateMutationReady = Boolean(clientRuntime.state.stateMutation);
  const proofReady = !lifecycleControls.settings.requireAuditProof || auditProof.outcome.safeToAttachKernel;
  const handoffReady = !clientRuntime.handoff.required
    || (clientRuntime.handoff.ready && (!handoffCheckpoint.acknowledgement.required || handoffCheckpoint.acknowledgement.accepted));
  const verifierGateReady = verifierClaimGate.allowed;
  const mailchimpAcceptance = buildMailchimpClaimAcceptanceHandoff({
    providerContract,
    lifecycleControls,
    scope,
    clientRuntime,
    boundaryExecution,
    persistedState,
    previewVerdict: acceptancePreview.preview.verdict,
    accepted: false,
    now
  });
  const readinessFailures = stableList([
    ...(routeAcceptEnabled ? [] : previewRoute.acceptance.disabledReasons),
    ...(dispatchAccepted ? [] : hostedKernelDispatch.dispatch.blockedReasons),
    ...boundaryExecution.acceptance.reasonCodes,
    ...(stateMutationReady ? [] : ['state_mutation_missing']),
    ...(proofReady ? [] : ['audit_proof_not_ready']),
    ...(handoffReady ? [] : ['handoff_not_ready']),
    ...(mailchimpAcceptance.ready ? [] : mailchimpAcceptance.validationSummary.blockingCodes),
    ...(verifierGateReady ? [] : ['verifier_claim_gate_required']),
    ...(persistedState.boundary.safeForReplay ? [] : persistedState.boundary.reasonCodes),
    ...failureState.blockedOperations.map((operation) => `blocked_${operation}`)
  ]);
  const accepted = readinessFailures.length === 0 && routeAcceptEnabled && dispatchAccepted;
  const acceptedMailchimpAcceptance = {
    ...mailchimpAcceptance,
    ready: accepted ? mailchimpAcceptance.ready : mailchimpAcceptance.ready,
    state: accepted && mailchimpAcceptance.enabled ? 'accepted' : mailchimpAcceptance.state,
    nextStep: {
      ...mailchimpAcceptance.nextStep,
      action: accepted && mailchimpAcceptance.enabled
        ? 'record_mailchimp_acceptance'
        : mailchimpAcceptance.nextStep.action
    },
    auditHandoff: {
      ...mailchimpAcceptance.auditHandoff,
      recordType: accepted && mailchimpAcceptance.enabled
        ? 'mailchimp_acceptance_recorded'
        : mailchimpAcceptance.auditHandoff?.recordType
    }
  };
  const acceptPayload = accepted
    ? {
        ...previewRoute.acceptance.payload,
        contract: 'operator-userland.cli-claim.acceptance-commit.v1',
        commitId: `${clientRuntime.request.requestId}:accept`,
        dispatchRoute: hostedKernelDispatch.dispatch.route,
        queuePriority: hostedKernelDispatch.queue.priority,
        stateMutation: clientRuntime.state.stateMutation,
        handoffCheckpointMutation: clientRuntime.handoff.checkpointMutation,
        mailchimpAcceptance: acceptedMailchimpAcceptance,
        auditTrail: hostedKernelDispatch.auditTrail
      }
    : null;

  return {
    contract: 'operator-userland.cli-claim.acceptance-decision.v1',
    generatedAt: now,
    route: {
      surfaceId,
      method: 'POST',
      path: previewRoute.route.acceptPath,
      requestId: clientRuntime.request.requestId,
      idempotencyKey: persistedState.idempotency.key
    },
    decision: {
      accepted,
      state: accepted ? 'accepted' : routeAcceptEnabled ? 'not_dispatchable' : 'blocked',
      verdict: acceptancePreview.preview.verdict,
      exitCode: accepted ? 0 : clientRuntime.state.exitCode || 2,
      dryRun: lifecycleControls.settings.dryRun,
      dispatchable: hostedKernelDispatch.dispatch.dispatchable,
      enqueue: hostedKernelDispatch.queue.enqueue,
      stateMutationReady,
      proofReady,
      handoffReady,
      verifierGateReady,
      boundaryAllowed: boundaryExecution.acceptance.allowed,
      reasonCodes: readinessFailures
    },
    readinessSummary: {
      ready: accepted,
      readyGateCount: acceptancePreview.readiness.gates.filter((gate) => gate.ready).length,
      blockedGateCount: acceptancePreview.preview.blockedGates.length,
      blockedGates: acceptancePreview.preview.blockedGates,
      blockedOperations: failureState.blockedOperations,
      providerReady: acceptancePreview.readiness.providerReady,
      kernelReady: acceptancePreview.readiness.kernelReady,
      persistedStateReady: acceptancePreview.readiness.persistedStateReady,
      auditReady: acceptancePreview.readiness.auditReady,
      boundaryReady: boundaryExecution.acceptance.allowed,
      mailchimpReady: mailchimpAcceptance.ready,
      mailchimpState: mailchimpAcceptance.state,
      mailchimpBlockingCodes: mailchimpAcceptance.validationSummary.blockingCodes,
      verifierClaimGateReady: verifierGateReady
    },
    validationSummary: {
      ...previewRoute.validationSummary,
      ok: previewRoute.validationSummary.ok && accepted,
      acceptanceDisabledReasons: previewRoute.acceptance.disabledReasons,
      dispatchBlockedReasons: hostedKernelDispatch.dispatch.blockedReasons,
      failurePrimaryCode: failureState.primaryCode
    },
    nextStep: {
      contract: 'operator-userland.cli-claim.acceptance-next-step.v1',
      action: accepted ? 'commit_acceptance' : acceptancePreview.nextStep.action,
      state: accepted ? 'accepted' : acceptancePreview.nextStep.state,
      command: accepted
        ? clientRuntime.workflowHandoff.commandHints.accept
        : previewRoute.nextStep.clientCommand,
      retryable: clientRuntime.state.retryable,
      operatorPrompts: stableList([
        ...(accepted ? ['commit_acceptance_payload'] : clientRuntime.workflowHandoff.operatorPrompts),
        ...(!accepted && hostedKernelDispatch.dispatch.retryable ? ['retry_dispatch_when_ready'] : [])
      ]),
      explain: accepted
        ? 'Preview, proof, persisted state, handoff, and hosted-kernel dispatch are ready for acceptance.'
        : 'Acceptance is held until the listed readiness and validation reasons are resolved.'
    },
    commit: {
      payload: acceptPayload,
      proofManifest: {
        required: lifecycleControls.settings.requireAuditProof,
        proofType: auditProof.type,
        attachments: clientRuntime.proof.attachments,
        auditStream: hostedKernelDispatch.auditTrail.stream,
        recordType: accepted ? 'acceptance_committed' : 'acceptance_blocked',
        boundaryExecution: boundaryExecution.audit
      },
      providerReceipt: {
        providerId: providerContract.providerId,
        protocol: providerContract.protocol,
        requiredCapabilities: providerContract.negotiation.requiredCapabilities,
        missingCapabilities: providerContract.negotiation.missingCapabilities,
        handoffAcknowledgementId: handoffCheckpoint.acknowledgement.id,
        mailchimpAcceptance: acceptedMailchimpAcceptance,
        verifierClaimGateId: verifierClaimGate.gateId,
        verifierRunId: verifierClaimGate.verifierRunId
      }
    },
    userVisible: {
      headline: accepted ? 'Claim accepted' : 'Claim acceptance blocked',
      primaryAction: accepted ? 'commit_acceptance' : previewRoute.status.primaryAction,
      statusLine: accepted
        ? `${principal.principalId} accepted ${scope.requestedWorkspaceId}`
        : `${principal.principalId} cannot accept ${scope.requestedWorkspaceId}`,
      acceptCommand: clientRuntime.workflowHandoff.commandHints.accept,
      statusCommand: clientRuntime.workflowHandoff.commandHints.status,
      resumeCommand: clientRuntime.workflowHandoff.commandHints.resume,
      reasons: readinessFailures
    }
  };
}

function buildNextActionState({
  lifecycleControls,
  operationalMode,
  deniedClaims,
  validationFindings,
  retryPlan,
  auditProof,
  providerContract,
  persistedState
}) {
  const errorCodes = validationFindings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
  const attachBlocked = deniedClaims.length > 0
    || errorCodes.length > 0
    || (lifecycleControls.settings.requireAuditProof && !auditProof.outcome.safeToAttachKernel);

  if (lifecycleControls.command === 'status') {
    return {
      state: persistedState.statusProjection.canonicalState === 'not_found'
        ? operationalMode
        : persistedState.statusProjection.canonicalState,
      action: 'report_persisted_status',
      reasonCodes: persistedState.statusProjection.reasonCodes,
      idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation,
      statusExitCode: persistedState.statusProjection.statusExitCode
    };
  }
  if (persistedState.idempotency.duplicateCompletion) {
    return {
      state: persistedState.lastKnown.state,
      action: 'return_cached_completion',
      reasonCodes: ['idempotent_duplicate'],
      idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation
    };
  }
  if (persistedState.recovery.required && persistedState.recovery.canResume) {
    return {
      state: 'recovering',
      action: 'resume_persisted_state',
      reasonCodes: persistedState.recovery.reasonCodes,
      idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation,
      resumeFrom: persistedState.recovery.resumeFrom
    };
  }
  if (lifecycleControls.command === 'disable') {
    return { state: 'disabled', action: 'persist_settings', reasonCodes: ['operator_disabled'] };
  }
  if (lifecycleControls.command === 'enable') {
    return { state: 'enabled', action: 'refresh_claim', reasonCodes: [] };
  }
  if (!lifecycleControls.settings.enabled) {
    return { state: 'blocked', action: 'enable_first', reasonCodes: ['lifecycle_disabled'] };
  }
  if (lifecycleControls.schedule.cursor.runLimitReached) {
    return {
      state: 'exhausted',
      action: 'schedule_exhausted',
      reasonCodes: ['schedule_run_limit_reached'],
      completedRuns: lifecycleControls.schedule.cursor.completedRuns,
      maxRuns: lifecycleControls.schedule.cursor.maxRuns
    };
  }
  if (lifecycleControls.schedule.mode === 'manual') {
    return { state: 'waiting', action: 'await_manual_start', reasonCodes: ['manual_schedule'] };
  }
  if (lifecycleControls.schedule.mode === 'deferred' && !lifecycleControls.schedule.ready) {
    return {
      state: 'scheduled',
      action: 'wait_until_not_before',
      reasonCodes: ['deferred_schedule'],
      notBefore: lifecycleControls.schedule.notBefore
    };
  }
  if (retryPlan.retryable && operationalMode !== 'ready') {
    return { state: 'retryable', action: 'retry_with_backoff', reasonCodes: retryPlan.reasonCodes };
  }
  if (providerContract?.handoff.required && !providerContract.handoff.ready) {
    return {
      state: 'handoff_pending',
      action: 'await_external_handoff',
      reasonCodes: ['provider_handoff_not_ready'],
      target: providerContract.handoff.target,
      correlationId: providerContract.handoff.correlationId
    };
  }
  if (attachBlocked) {
    return { state: 'blocked', action: 'resolve_findings', reasonCodes: stableList([...errorCodes, 'claim_or_audit_blocked']) };
  }
  if (lifecycleControls.settings.dryRun) {
    return { state: 'ready', action: 'report_dry_run', reasonCodes: [] };
  }
  if (lifecycleControls.command === 'attach') {
    return { state: 'ready', action: 'attach_hosted_kernel', reasonCodes: [] };
  }

  return { state: 'ready', action: 'grant_claims', reasonCodes: [] };
}

function resolveOperationalMode({ deniedClaims, findings, hostedKernel }) {
  const hasError = findings.some((finding) => finding.severity === 'error') || deniedClaims.length > 0;
  if (hostedKernel.degradedMode || findings.some((finding) => finding.severity === 'warning')) {
    return hasError ? 'blocked_degraded' : 'degraded';
  }
  return hasError ? 'blocked' : 'ready';
}

function buildAuditProof({ now, principal, scope, tenantBoundary, claimDecisions, evidence }) {
  const granted = claimDecisions.filter((claim) => claim.allowed).map((claim) => claim.name);
  const denied = claimDecisions.filter((claim) => !claim.allowed).map((claim) => claim.name);

  return {
    type: 'operator-userland.cli-claim.audit-proof.v1',
    generatedAt: now,
    actor: {
      principalId: principal.principalId,
      tenantId: principal.tenantId,
      roles: principal.roles
    },
    scope: {
      requestedTenantId: scope.requestedTenantId,
      requestedWorkspaceId: scope.requestedWorkspaceId,
      allowedWorkspaceIds: scope.allowedWorkspaceIds,
      boundary: scope.tenantMatches && scope.workspaceAllowed ? 'within-tenant-workspace' : 'blocked'
    },
    permissionBoundary: {
      contract: tenantBoundary.contract,
      enforcement: tenantBoundary.enforcement,
      safeToEvaluate: tenantBoundary.safeToEvaluate,
      effectivePermissions: tenantBoundary.permissions.effectivePermissions,
      missingBoundaryPermissions: tenantBoundary.permissions.missingBoundaryPermissions,
      reasonCodes: tenantBoundary.reasonCodes,
      auditHandoff: tenantBoundary.auditHandoff
    },
    outcome: {
      granted,
      denied,
      safeToAttachKernel: granted.includes('kernelAttach') && denied.length === 0
    },
    evidence: Array.isArray(evidence) ? evidence : []
  };
}

function buildBoundaryExecutionContract({
  now,
  principal,
  scope,
  tenantBoundary,
  claimDecisions,
  lifecycleControls,
  persistedState,
  providerContract,
  handoffCheckpoint,
  auditProof,
  verifierClaimGate,
  validationFindings
}) {
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const errorCodes = stableList(validationFindings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code));
  const workspaceScoped = scope.tenantMatches && scope.workspaceAllowed;
  const persistedScoped = persistedState.boundary.safeForReplay;
  const permissionScoped = tenantBoundary.safeToEvaluate || tenantBoundary.enforcement === 'audit';
  const proofScoped = !lifecycleControls.settings.requireAuditProof || auditProof.outcome.safeToAttachKernel;
  const providerScoped = providerContract.negotiation.compatible
    && providerContract.sync.fresh
    && (!providerContract.handoff.required || providerContract.handoff.ready);
  const handoffScoped = !handoffCheckpoint.acknowledgement.required || handoffCheckpoint.acknowledgement.accepted;
  const verifierGateScoped = verifierClaimGate.allowed;
  const mutatingCommand = !['status', 'dry_run'].includes(lifecycleControls.command);
  const attachCommand = lifecycleControls.command === 'attach';
  const grantCommand = lifecycleControls.command === 'claim';
  const executionReasonCodes = stableList([
    ...(workspaceScoped ? [] : ['workspace_scope_denied']),
    ...(persistedScoped ? [] : persistedState.boundary.reasonCodes),
    ...(permissionScoped ? [] : tenantBoundary.reasonCodes),
    ...(deniedClaims.length === 0 ? [] : ['claim_decision_denied']),
    ...(proofScoped ? [] : ['audit_proof_not_ready']),
    ...(providerScoped ? [] : ['provider_boundary_not_ready']),
    ...(handoffScoped ? [] : ['handoff_checkpoint_not_accepted']),
    ...(verifierGateScoped ? [] : ['verifier_claim_gate_required']),
    ...errorCodes
  ]);
  const executionAllowed = executionReasonCodes.length === 0;
  const commitReasonCodes = stableList([
    ...executionReasonCodes,
    ...(mutatingCommand ? [] : ['read_only_command']),
    ...(lifecycleControls.settings.dryRun ? ['dry_run'] : []),
    ...(persistedState.writePlan.shouldWrite ? [] : ['state_mutation_not_planned'])
  ]);
  const dispatchReasonCodes = stableList([
    ...executionReasonCodes,
    ...(lifecycleControls.schedule.ready ? [] : ['schedule_not_ready']),
    ...(lifecycleControls.settings.enabled ? [] : ['lifecycle_disabled']),
    ...(attachCommand && !lifecycleControls.settings.attachEnabled ? ['attach_disabled'] : [])
  ]);
  const acceptanceReasonCodes = stableList([
    ...commitReasonCodes,
    ...(providerScoped ? [] : providerContract.negotiation.missingCapabilities),
    ...(handoffScoped ? [] : ['handoff_acknowledgement_required'])
  ]);
  const executionId = [
    principal.tenantId,
    scope.requestedWorkspaceId,
    principal.principalId,
    lifecycleControls.command,
    persistedState.idempotency.key
  ].join(':');

  return {
    contract: 'operator-userland.cli-claim.boundary-execution.v1',
    generatedAt: now,
    execution: {
      executionId,
      mode: tenantBoundary.enforcement === 'audit' ? 'audit_scoped' : 'enforced',
      allowed: executionAllowed,
      blocked: !executionAllowed,
      reasonCodes: executionReasonCodes,
      mutatingCommand,
      command: lifecycleControls.command
    },
    workspace: {
      tenantId: scope.requestedTenantId,
      workspaceId: scope.requestedWorkspaceId,
      allowedWorkspaceIds: scope.allowedWorkspaceIds,
      scoped: workspaceScoped
    },
    permissions: {
      effectivePermissions: tenantBoundary.permissions.effectivePermissions,
      deniedClaims: deniedClaims.map((claim) => ({
        name: claim.name,
        permission: claim.permission,
        reasons: claim.reasons
      })),
      permissionScoped
    },
    verifierClaimGate: {
      contract: verifierClaimGate.contract,
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      route: verifierClaimGate.route,
      routePolicy: verifierClaimGate.routePolicy,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      decision: verifierClaimGate.decision,
      providerReceipt: verifierClaimGate.providerReceipt,
      reasonCodes: verifierClaimGate.reasonCodes
    },
    commit: {
      allowed: commitReasonCodes.length === 0,
      reasonCodes: commitReasonCodes,
      storageKey: persistedState.storageKey,
      writeOperation: persistedState.writePlan.operation
    },
    dispatch: {
      allowed: dispatchReasonCodes.length === 0,
      reasonCodes: dispatchReasonCodes,
      route: attachCommand ? 'kernel.attach' : grantCommand ? 'claim.grant' : 'claim.preview'
    },
    acceptance: {
      allowed: acceptanceReasonCodes.length === 0,
      reasonCodes: acceptanceReasonCodes,
      requiresProof: lifecycleControls.settings.requireAuditProof,
      proofReady: proofScoped
    },
    audit: {
      stream: `${principal.tenantId}/${scope.requestedWorkspaceId}/cli-claim.boundary-execution`,
      recordType: executionAllowed ? 'boundary_execution_allowed' : 'boundary_execution_blocked',
      decision: executionAllowed ? 'allow' : 'deny',
      handoffRequired: !executionAllowed || tenantBoundary.enforcement === 'audit',
      evidenceKeys: stableList([
        executionId,
        tenantBoundary.auditHandoff.stream,
        verifierClaimGate.routePolicy.auditHandoff.stream,
        persistedState.storageKey,
        providerContract.providerId,
        ...(verifierClaimGate.gateId ? [verifierClaimGate.gateId] : []),
        ...(handoffCheckpoint.acknowledgement.id ? [handoffCheckpoint.acknowledgement.id] : [])
      ])
    },
    operatorPrompts: stableList([
      ...(workspaceScoped ? [] : ['select_allowed_workspace_scope']),
      ...(permissionScoped ? [] : ['resolve_tenant_permission_boundary']),
      ...(persistedScoped ? [] : ['repair_persisted_state_boundary']),
      ...(proofScoped ? [] : ['collect_audit_proof_before_commit']),
      ...(providerScoped ? [] : ['refresh_provider_contract']),
      ...(handoffScoped ? [] : ['attach_handoff_acknowledgement']),
      ...(verifierGateScoped ? [] : ['submit_completion_through_verifier_claim_gate'])
    ])
  };
}

function claimNames(value = []) {
  return stableList(value.map((claim) => typeof claim === 'string' ? claim : claim?.name).filter(Boolean));
}

function normalizeHistorySnapshots(input = {}) {
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics : {};
  const source = input.history || input.claimHistory || analytics.history || analytics.snapshots || [];
  if (!Array.isArray(source)) {
    return [];
  }

  return source.slice(-12).map((snapshot, index) => {
    const generatedAt = String(snapshot.generatedAt || snapshot.at || snapshot.timestamp || `history-${index}`).trim();
    const claims = snapshot.claims && typeof snapshot.claims === 'object' ? snapshot.claims : {};
    const validation = snapshot.validation && typeof snapshot.validation === 'object'
      ? snapshot.validation
      : snapshot.operationalHealth?.validation || {};
    const hostedKernel = snapshot.hostedKernel || snapshot.operationalHealth?.hostedKernel || {};
    const verifierClaimGate = snapshot.verifierClaimGate
      || snapshot.operationalHealth?.verifierClaimGate
      || snapshot.operationalHealth?.persistedState?.completionGate
      || {};
    const granted = claimNames(claims.granted || snapshot.grantedClaims || []);
    const denied = claimNames(claims.denied || snapshot.deniedClaims || []);
    const requested = claimNames(claims.requested || snapshot.requestedClaims || [...granted, ...denied]);
    const verifierGateRequired = normalizeBoolean(
      snapshot.verifierGateRequired ?? verifierClaimGate.required
    );
    const verifierGateAllowed = normalizeBoolean(
      snapshot.verifierGateAllowed ?? verifierClaimGate.allowed,
      !verifierGateRequired
    );
    const verifierGatePending = normalizeBoolean(
      snapshot.verifierGatePending ?? verifierClaimGate.pending ?? verifierClaimGate.submission?.pending
    );
    const verifierGateRejected = normalizeBoolean(
      snapshot.verifierGateRejected ?? verifierClaimGate.rejected ?? verifierClaimGate.submission?.rejected
    );

    return {
      generatedAt,
      ok: normalizeBoolean(snapshot.ok, denied.length === 0),
      mode: String(snapshot.mode || snapshot.operationalMode || snapshot.operationalHealth?.mode || 'unknown').trim(),
      requestedCount: normalizePositiveInteger(snapshot.requestedCount, requested.length),
      grantedCount: normalizePositiveInteger(snapshot.grantedCount, granted.length),
      deniedCount: normalizePositiveInteger(snapshot.deniedCount, denied.length),
      validationErrorCount: normalizePositiveInteger(snapshot.validationErrorCount, 0),
      validationWarningCount: normalizePositiveInteger(snapshot.validationWarningCount, 0),
      retryable: normalizeBoolean(snapshot.retryable || snapshot.retry?.retryable),
      kernelId: String(snapshot.kernelId || hostedKernel.kernelId || '').trim() || null,
      workspaceId: String(snapshot.workspaceId || snapshot.workspaceScope?.requestedWorkspaceId || '').trim() || null,
      verifierGateRequired,
      verifierGateAllowed,
      verifierGatePending,
      verifierGateRejected,
      verifierGateDecision: String(snapshot.verifierGateDecision || verifierClaimGate.decision || '').trim() || null,
      verifierGateId: String(snapshot.verifierGateId || verifierClaimGate.gateId || '').trim() || null
    };
  });
}

function buildTimelineState({
  now,
  scope,
  hostedKernel,
  providerContract,
  claimDecisions,
  validationFindings,
  operationalMode,
  retryPlan,
  lifecycleControls,
  nextActionState,
  verifierClaimGate
}) {
  const boundaryOk = scope.tenantMatches && scope.workspaceAllowed;
  const kernelErrors = validationFindings.filter((finding) => finding.code.startsWith('kernel_'));
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const verifierGateStatus = verifierClaimGate.allowed
    ? 'complete'
    : verifierClaimGate.pending
      ? 'retryable'
      : verifierClaimGate.required
        ? 'blocked'
        : 'skipped';

  return {
    contract: 'operator-userland.cli-claim.timeline.v1',
    currentStage: deniedClaims.length > 0
      || kernelErrors.some((finding) => finding.severity === 'error')
      || (verifierClaimGate.required && !verifierClaimGate.allowed)
      ? 'blocked'
      : 'claim_resolved',
    stages: [
      {
        at: now,
        stage: 'request_normalized',
        status: 'complete',
        detail: `${claimDecisions.length} claim decisions prepared`
      },
      {
        at: now,
        stage: 'boundary_checked',
        status: boundaryOk ? 'complete' : 'blocked',
        detail: boundaryOk ? 'tenant/workspace boundary accepted' : 'tenant/workspace boundary denied'
      },
      {
        at: now,
        stage: 'kernel_health_checked',
        status: kernelErrors.length === 0 ? 'complete' : 'attention',
        detail: `${hostedKernel.kernelId}:${hostedKernel.status}`
      },
      {
        at: now,
        stage: 'provider_contract_negotiated',
        status: providerContract.negotiation.compatible && providerContract.sync.fresh ? 'complete' : 'attention',
        detail: `${providerContract.providerId}:${providerContract.negotiation.requiredCapabilities.length} required capabilities`
      },
      {
        at: now,
        stage: 'claims_resolved',
        status: deniedClaims.length === 0 ? 'complete' : 'blocked',
        detail: deniedClaims.length === 0 ? 'all requested claims granted' : `${deniedClaims.length} claims denied`
      },
      {
        at: now,
        stage: 'lifecycle_controls_resolved',
        status: nextActionState.state,
        detail: `${lifecycleControls.command}:${nextActionState.action}`
      },
      {
        at: now,
        stage: 'verifier_claim_gate_checked',
        status: verifierGateStatus,
        detail: verifierClaimGate.required
          ? `${verifierClaimGate.route}:${verifierClaimGate.decision || 'missing'}`
          : 'completion gate not required'
      },
      {
        at: now,
        stage: 'report_ready',
        status: retryPlan.retryable ? 'retryable' : operationalMode,
        detail: retryPlan.retryable ? 'retry backoff attached to report' : 'export summary attached to report'
      }
    ]
  };
}

function buildAnalyticsExportState({
  now,
  principal,
  scope,
  tenantBoundary,
  snapshots,
  currentSnapshot,
  previousSnapshot,
  validationFindings,
  hostedKernel,
  providerContract,
  handoffCheckpoint,
  lifecycleControls,
  retryPlan,
  persistedState,
  failureState,
  clientRuntime,
  verifierClaimGate
}) {
  const errorCodes = stableList(
    validationFindings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.code)
  );
  const warningCodes = stableList(
    validationFindings
      .filter((finding) => finding.severity === 'warning')
      .map((finding) => finding.code)
  );
  const oldestSnapshot = snapshots[0] || currentSnapshot;
  const historyDeniedTotal = snapshots.reduce((total, snapshot) => total + snapshot.deniedCount, 0);
  const historyErrorTotal = snapshots.reduce((total, snapshot) => total + snapshot.validationErrorCount, 0);
  const healthyRunCount = snapshots.filter((snapshot) => snapshot.ok).length;
  const retryableRunCount = snapshots.filter((snapshot) => snapshot.retryable).length;
  const verifierGateRequiredTotal = snapshots.filter((snapshot) => snapshot.verifierGateRequired).length;
  const verifierGateAcceptedTotal = snapshots.filter((snapshot) => (
    snapshot.verifierGateRequired && snapshot.verifierGateAllowed
  )).length;
  const verifierGatePendingTotal = snapshots.filter((snapshot) => snapshot.verifierGatePending).length;
  const verifierGateRejectedTotal = snapshots.filter((snapshot) => snapshot.verifierGateRejected).length;
  const verifierGateBlockedTotal = snapshots.filter((snapshot) => (
    snapshot.verifierGateRequired && !snapshot.verifierGateAllowed
  )).length;
  const formatRows = [
    {
      format: 'json',
      mediaType: 'application/json',
      recordContract: 'operator-userland.cli-claim.export-summary.v1',
      rowCount: 1
    },
    {
      format: 'ndjson',
      mediaType: 'application/x-ndjson',
      recordContract: 'operator-userland.cli-claim.history-snapshot.v1',
      rowCount: snapshots.length
    },
    {
      format: 'csv',
      mediaType: 'text/csv',
      recordContract: 'operator-userland.cli-claim.flat-record.v1',
      rowCount: 1
    }
  ];
  const blocked = failureState.blockedOperations.length > 0 || clientRuntime?.state.exitCode > 0;
  const exportReady = providerContract.sync.fresh
    && persistedState.boundary.safeForReplay
    && verifierClaimGate.allowed
    && !blocked
    && !lifecycleControls.settings.dryRun;

  return {
    contract: 'operator-userland.cli-claim.analytics-export-state.v1',
    generatedAt: now,
    historyWindow: {
      contract: 'operator-userland.cli-claim.history-window.v1',
      snapshotCount: snapshots.length,
      firstGeneratedAt: oldestSnapshot.generatedAt,
      lastGeneratedAt: currentSnapshot.generatedAt,
      retainedLimit: 12,
      healthyRunCount,
      retryableRunCount,
      deniedClaimTotal: historyDeniedTotal,
      validationErrorTotal: historyErrorTotal,
      verifierGateRequiredTotal,
      verifierGateAcceptedTotal,
      verifierGatePendingTotal,
      verifierGateRejectedTotal,
      verifierGateBlockedTotal,
      verifierGateAcceptanceRate: verifierGateRequiredTotal === 0
        ? 1
        : verifierGateAcceptedTotal / verifierGateRequiredTotal,
      consecutiveHealthy: snapshots.slice().reverse().findIndex((snapshot) => !snapshot.ok) === -1
        ? snapshots.length
        : snapshots.slice().reverse().findIndex((snapshot) => !snapshot.ok)
    },
    deltaFromPrevious: {
      available: Boolean(previousSnapshot),
      previousGeneratedAt: previousSnapshot?.generatedAt || null,
      requestedClaimDelta: previousSnapshot ? currentSnapshot.requestedCount - previousSnapshot.requestedCount : 0,
      grantedClaimDelta: previousSnapshot ? currentSnapshot.grantedCount - previousSnapshot.grantedCount : 0,
      deniedClaimDelta: previousSnapshot ? currentSnapshot.deniedCount - previousSnapshot.deniedCount : 0,
      validationErrorDelta: previousSnapshot ? currentSnapshot.validationErrorCount - previousSnapshot.validationErrorCount : 0,
      validationWarningDelta: previousSnapshot ? currentSnapshot.validationWarningCount - previousSnapshot.validationWarningCount : 0,
      retryabilityChanged: Boolean(previousSnapshot && previousSnapshot.retryable !== currentSnapshot.retryable)
    },
    reportingState: {
      exportReady,
      state: exportReady
        ? 'ready'
        : blocked
          ? 'blocked'
        : lifecycleControls.settings.dryRun
          ? 'preview_only'
          : !verifierClaimGate.allowed
            ? 'awaiting_verifier_claim_gate'
          : !persistedState.boundary.safeForReplay
            ? 'awaiting_persisted_boundary'
            : 'awaiting_provider_sync',
      reasonCodes: stableList([
        ...(exportReady ? [] : ['export_not_ready']),
        ...(blocked ? failureState.blockedOperations : []),
        ...(verifierClaimGate.allowed ? [] : ['verifier_claim_gate_required']),
        ...(!verifierClaimGate.allowed ? verifierClaimGate.reasonCodes : []),
        ...(providerContract.sync.fresh ? [] : ['provider_sync_stale']),
        ...(persistedState.boundary.safeForReplay ? [] : persistedState.boundary.reasonCodes),
        ...(lifecycleControls.settings.dryRun ? ['dry_run'] : []),
        ...errorCodes
      ]),
      requestedOutputFormat: clientRuntime?.request.outputFormat || 'json',
      selectedFormat: clientRuntime?.request.outputFormat === 'summary' ? 'json' : clientRuntime?.request.outputFormat || 'json',
      formats: formatRows,
      destination: {
        stream: `${principal.tenantId}/${scope.requestedWorkspaceId}/cli-claim.analytics`,
        providerId: providerContract.providerId,
        cursor: providerContract.sync.cursor,
        correlationId: providerContract.handoff.correlationId || clientRuntime?.request.requestId || null
      }
    },
    auditAttachments: {
      required: lifecycleControls.settings.requireAuditProof,
      proofContracts: stableList([
        'operator-userland.cli-claim.analytics.v1',
        'operator-userland.cli-claim.analytics-export-state.v1',
        'operator-userland.cli-claim.history-window.v1',
        'operator-userland.cli-claim.export-summary.v1',
        ...(failureState.state === 'healthy' ? [] : [failureState.contract])
      ]),
      evidenceKeys: stableList([
        `${principal.tenantId}/${scope.requestedWorkspaceId}`,
        hostedKernel.kernelId,
        providerContract.providerId,
        persistedState.storageKey,
        tenantBoundary.auditHandoff.stream
      ])
    },
    verifierClaimGate: {
      required: verifierClaimGate.required,
      allowed: verifierClaimGate.allowed,
      pending: verifierClaimGate.pending,
      rejected: verifierClaimGate.rejected,
      decision: verifierClaimGate.decision,
      gateId: verifierClaimGate.gateId,
      verifierRunId: verifierClaimGate.verifierRunId,
      route: verifierClaimGate.route,
      routePolicy: verifierClaimGate.routePolicy,
      reasonCodes: verifierClaimGate.reasonCodes
    },
    currentRun: {
      mode: currentSnapshot.mode,
      retryable: retryPlan.retryable,
      errorCodes,
      warningCodes,
      exitCode: clientRuntime?.state.exitCode ?? 0,
      lifecycleState: clientRuntime?.state.lifecycleState || null,
      nextAction: clientRuntime?.state.nextAction || null,
      verifierGateRequired: verifierClaimGate.required,
      verifierGateAllowed: verifierClaimGate.allowed,
      verifierGatePending: verifierClaimGate.pending,
      verifierGateDecision: verifierClaimGate.decision,
      verifierGateCommand: clientRuntime?.workflowHandoff?.commandHints?.verifierGate || null
    }
  };
}

function normalizeMailchimpExportLedger(input = {}) {
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics : {};
  const persisted = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.mailchimpExportLedger
    || analytics.mailchimpExportLedger
    || analytics.mailchimpMarketingLedger
    || persisted.mailchimpExportLedger
    || persisted.mailchimpExportHistory
    || [];
  if (!Array.isArray(source)) {
    return [];
  }

  const seen = new Set();
  return source
    .map((record, index) => {
      if (!record || typeof record !== 'object') return null;
      const generatedAt = String(record.generatedAt || record.at || record.timestamp || '').trim();
      const campaignId = String(record.campaignId || record.campaign?.campaignId || '').trim() || null;
      const audienceId = String(record.audienceId || record.audience?.audienceId || '').trim() || null;
      const ledgerId = String(
        record.ledgerId
          || record.exportId
          || record.id
          || `${campaignId || 'campaign'}:${audienceId || 'audience'}:${generatedAt || index}`
      ).trim();

      return {
        contract: 'operator-userland.cli-claim.mailchimp-export-ledger-record.v1',
        ledgerId,
        exportId: String(record.exportId || ledgerId).trim(),
        generatedAt: generatedAt || `ledger-${index}`,
        tenantId: String(record.tenantId || record.scope?.tenantId || '').trim() || null,
        workspaceId: String(record.workspaceId || record.scope?.workspaceId || '').trim() || null,
        campaignId,
        audienceId,
        campaignStatus: String(record.campaignStatus || record.campaign?.status || 'unknown').trim().toLowerCase(),
        ready: normalizeBoolean(record.ready ?? record.exportReady),
        accepted: normalizeBoolean(record.accepted ?? record.acceptanceRecorded),
        blockingCodes: stableList(record.blockingCodes || record.reasonCodes || []),
        idempotencyKey: String(record.idempotencyKey || record.persistenceKey || '').trim() || null,
        providerCursor: String(record.providerCursor || record.syncCursor || record.cursor || '').trim() || null
      };
    })
    .filter(Boolean)
    .filter((record) => {
      const key = `${record.tenantId}:${record.workspaceId}:${record.ledgerId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-12);
}

function buildMailchimpExportLedger({
  now,
  principal,
  scope,
  providerContract,
  lifecycleControls,
  persistedState,
  clientRuntime,
  exportState,
  currentSnapshot,
  previousLedger
}) {
  const mailchimp = providerContract.mailchimp;
  const blockingCodes = stableList([
    ...(mailchimp.enabled ? [] : ['mailchimp_profile_not_selected']),
    ...(mailchimp.ready ? [] : mailchimp.reasonCodes),
    ...(exportState.reportingState.exportReady ? [] : exportState.reportingState.reasonCodes),
    ...(persistedState.boundary.safeForReplay ? [] : persistedState.boundary.reasonCodes)
  ]);
  const campaignId = mailchimp.campaign.campaignId || null;
  const audienceId = mailchimp.audience.audienceId || null;
  const scopeKey = `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`;
  const exportId = `mailchimp-export:${scopeKey}:${campaignId || 'campaign-missing'}:${audienceId || 'audience-missing'}:${persistedState.idempotency.key}`;
  const currentRecord = {
    contract: 'operator-userland.cli-claim.mailchimp-export-ledger-record.v1',
    ledgerId: exportId,
    exportId,
    generatedAt: now,
    tenantId: scope.requestedTenantId,
    workspaceId: scope.requestedWorkspaceId,
    principalId: principal.principalId,
    campaignId,
    audienceId,
    campaignStatus: mailchimp.campaign.status,
    ready: mailchimp.ready && exportState.reportingState.exportReady,
    accepted: clientRuntime?.state.lifecycleState === 'accepted' || clientRuntime?.state.nextAction === 'record_mailchimp_acceptance',
    blockingCodes,
    idempotencyKey: persistedState.idempotency.key,
    providerCursor: providerContract.sync.cursor,
    providerRevision: providerContract.sync.revision,
    nextProviderAction: mailchimp.nextProviderAction,
    exportLabels: mailchimp.exportLabels,
    previewUrl: mailchimp.campaign.previewUrl || null,
    requestedOutputFormat: exportState.reportingState.requestedOutputFormat,
    selectedOutputFormat: exportState.reportingState.selectedFormat,
    persistedStorageKey: persistedState.storageKey,
    restartSafe: persistedState.statusProjection.restartSafe || !persistedState.recovery.required
  };
  const ledger = [...previousLedger, currentRecord].slice(-12);
  const priorAccepted = previousLedger.filter((record) => record.accepted).length;
  const priorReady = previousLedger.filter((record) => record.ready).length;
  const lastRecord = previousLedger.at(-1) || null;
  const campaignChanged = Boolean(lastRecord && lastRecord.campaignId !== campaignId);
  const audienceChanged = Boolean(lastRecord && lastRecord.audienceId !== audienceId);

  return {
    contract: 'operator-userland.cli-claim.mailchimp-export-ledger.v1',
    generatedAt: now,
    source: 'cli-claim.analytics',
    scope: {
      tenantId: scope.requestedTenantId,
      workspaceId: scope.requestedWorkspaceId,
      scopeKey
    },
    currentRecord,
    records: ledger,
    counters: {
      retainedRecords: ledger.length,
      priorRecords: previousLedger.length,
      readyRecords: ledger.filter((record) => record.ready).length,
      acceptedRecords: ledger.filter((record) => record.accepted).length,
      blockingRecordCount: ledger.filter((record) => record.blockingCodes.length > 0).length,
      priorReadyRecords: priorReady,
      priorAcceptedRecords: priorAccepted,
      campaignChanged: campaignChanged ? 1 : 0,
      audienceChanged: audienceChanged ? 1 : 0
    },
    continuity: {
      previousLedgerId: lastRecord?.ledgerId || null,
      previousGeneratedAt: lastRecord?.generatedAt || null,
      campaignChanged,
      audienceChanged,
      readyStateChanged: Boolean(lastRecord && lastRecord.ready !== currentRecord.ready),
      acceptedStateChanged: Boolean(lastRecord && lastRecord.accepted !== currentRecord.accepted),
      currentSnapshotGeneratedAt: currentSnapshot.generatedAt
    },
    exportReady: currentRecord.ready,
    restartSafe: currentRecord.restartSafe,
    handoff: {
      stream: `${scopeKey}/cli-claim.mailchimp-export-ledger`,
      recordType: currentRecord.accepted
        ? 'mailchimp_export_acceptance_recorded'
        : currentRecord.ready
          ? 'mailchimp_export_ready'
          : 'mailchimp_export_blocked',
      idempotencyKey: persistedState.idempotency.key,
      providerCursor: providerContract.sync.cursor,
      auditPayloadRef: 'analytics.mailchimpExportLedger.currentRecord'
    }
  };
}

function buildAnalyticsReport({
  now,
  principal,
  scope,
  tenantBoundary,
  requestedClaims,
  claimDecisions,
  validationFindings,
  hostedKernel,
  providerContract,
  handoffCheckpoint,
  operationalMode,
  retryPlan,
  lifecycleControls,
  nextActionState,
  persistedState,
  failureState,
  clientRuntime,
  verifierClaimGate,
  input
}) {
  const granted = claimDecisions.filter((claim) => claim.allowed);
  const denied = claimDecisions.filter((claim) => !claim.allowed);
  const errorFindings = validationFindings.filter((finding) => finding.severity === 'error');
  const warningFindings = validationFindings.filter((finding) => finding.severity === 'warning');
  const history = normalizeHistorySnapshots(input);
  const currentSnapshot = {
    generatedAt: now,
    ok: denied.length === 0 && errorFindings.length === 0,
    mode: operationalMode,
    requestedCount: requestedClaims.length,
    grantedCount: granted.length,
    deniedCount: denied.length,
    validationErrorCount: errorFindings.length,
    validationWarningCount: warningFindings.length,
    retryable: retryPlan.retryable,
    kernelId: hostedKernel.kernelId,
    workspaceId: scope.requestedWorkspaceId,
    verifierGateRequired: verifierClaimGate.required,
    verifierGateAllowed: verifierClaimGate.allowed,
    verifierGatePending: verifierClaimGate.pending,
    verifierGateRejected: verifierClaimGate.rejected,
    verifierGateDecision: verifierClaimGate.decision,
    verifierGateId: verifierClaimGate.gateId,
    mailchimpEnabled: providerContract.mailchimp.enabled,
    mailchimpReady: providerContract.mailchimp.ready,
    mailchimpLifecycleGateState: providerContract.mailchimp.lifecycleGate.state,
    mailchimpLifecycleGateReady: providerContract.mailchimp.lifecycleGate.ready,
    mailchimpCampaignId: providerContract.mailchimp.campaign.campaignId,
    mailchimpAudienceId: providerContract.mailchimp.audience.audienceId,
    mailchimpCampaignStatus: providerContract.mailchimp.campaign.status
  };
  const snapshots = [...history, currentSnapshot].slice(-12);
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const deniedPermissions = denied.map((claim) => claim.permission);
  const exportState = buildAnalyticsExportState({
    now,
    principal,
    scope,
    tenantBoundary,
    snapshots,
    currentSnapshot,
    previousSnapshot: previous,
    validationFindings,
    hostedKernel,
    providerContract,
    handoffCheckpoint,
    lifecycleControls,
    retryPlan,
    persistedState,
    failureState,
    clientRuntime,
    verifierClaimGate
  });
  const mailchimpExportLedger = buildMailchimpExportLedger({
    now,
    principal,
    scope,
    providerContract,
    lifecycleControls,
    persistedState,
    clientRuntime,
    exportState,
    currentSnapshot,
    previousLedger: normalizeMailchimpExportLedger(input)
  });

  return {
    contract: 'operator-userland.cli-claim.analytics.v1',
    counters: {
      requestedClaims: requestedClaims.length,
      grantedClaims: granted.length,
      deniedClaims: denied.length,
      deniedPermissions: deniedPermissions.length,
      validationErrors: errorFindings.length,
      validationWarnings: warningFindings.length,
      boundaryFailures: Number(!scope.tenantMatches) + Number(!scope.workspaceAllowed),
      retryableReasons: retryPlan.reasonCodes.length,
      staleHeartbeat: hostedKernel.heartbeatAgeMs > hostedKernel.heartbeatStaleAfterMs ? 1 : 0,
      queueWarnings: hostedKernel.queueDepth >= hostedKernel.queueDepthWarnAt ? 1 : 0,
      lifecycleBlocks: validationFindings.some((finding) => finding.code.startsWith('lifecycle_')) ? 1 : 0,
      lifecycleSettingsInvalid: lifecycleControls.settingsPolicy.validation.ok ? 0 : lifecycleControls.settingsPolicy.validation.reasonCodes.length,
      lifecycleTransitionMutationRequired: lifecycleControls.transition.mutationRequired ? 1 : 0,
      lifecycleScheduleIntervalMs: lifecycleControls.schedule.intervalMs,
      lifecycleScheduleMaxRuns: lifecycleControls.schedule.maxRuns,
      lifecycleScheduleCompletedRuns: lifecycleControls.schedule.cursor.completedRuns,
      lifecycleScheduleRemainingRuns: lifecycleControls.schedule.cursor.remainingRuns,
      lifecycleScheduleRunLimitReached: lifecycleControls.schedule.cursor.runLimitReached ? 1 : 0,
      lifecycleScheduleCursorInvalid: lifecycleControls.validation.invalidScheduleCursor ? 1 : 0,
      providerMissingCapabilities: providerContract.negotiation.missingCapabilities.length,
      providerSyncFresh: providerContract.sync.fresh ? 1 : 0,
      providerPendingOutbound: providerContract.sync.pendingOutbound,
      providerHandoffReady: providerContract.handoff.ready ? 1 : 0,
      providerHandoffAckRequired: handoffCheckpoint.acknowledgement.required ? 1 : 0,
      providerHandoffAckAccepted: handoffCheckpoint.acknowledgement.accepted ? 1 : 0,
      persistedStateStale: persistedState.lastKnown.stale ? 1 : 0,
      persistedRestartSafe: persistedState.statusProjection.restartSafe ? 1 : 0,
      persistedBoundaryOwned: persistedState.boundary.ownedByScope ? 1 : 0,
      persistedBoundaryVerified: persistedState.boundary.verified ? 1 : 0,
      persistedBoundarySafeForReplay: persistedState.boundary.safeForReplay ? 1 : 0,
      persistedBoundaryFailures: persistedState.boundary.ownedByScope ? 0 : persistedState.boundary.reasonCodes.length,
      tenantPermissionBoundarySafe: tenantBoundary.safeToEvaluate ? 1 : 0,
      tenantPermissionBoundaryRestricted: tenantBoundary.permissions.restricted ? 1 : 0,
      tenantPermissionBoundaryMissingPermissions: tenantBoundary.permissions.missingBoundaryPermissions.length,
      idempotentDuplicate: persistedState.idempotency.duplicateCompletion ? 1 : 0,
      recoveryRequired: persistedState.recovery.required ? 1 : 0,
      recoveryCanResume: persistedState.recovery.canResume ? 1 : 0,
      failureIncidents: failureState.incidents.length,
      blockedOperations: failureState.blockedOperations.length,
      degradedAllowed: failureState.degradedAllowed ? 1 : 0,
      clientExitCode: clientRuntime?.state.exitCode ?? 0,
      clientStateMutation: clientRuntime?.state.stateMutation ? 1 : 0,
      clientHandoffRequired: clientRuntime?.handoff.required ? 1 : 0,
      clientHandoffManifestCommitReady: clientRuntime?.handoffManifest.commitReady ? 1 : 0,
      clientHandoffManifestMissingArtifacts: clientRuntime?.handoffManifest.missingArtifacts.length || 0,
      verifierGateRequired: verifierClaimGate.required ? 1 : 0,
      verifierGateAllowed: verifierClaimGate.allowed ? 1 : 0,
      verifierGatePending: verifierClaimGate.pending ? 1 : 0,
      verifierGateRejected: verifierClaimGate.rejected ? 1 : 0,
      verifierGateSubmittedThroughGate: verifierClaimGate.submittedThroughGate ? 1 : 0,
      verifierGateProviderReceiptMatches: verifierClaimGate.providerReceipt.matches ? 1 : 0,
      verifierGateReasonCount: verifierClaimGate.reasonCodes.length,
      verifierGateRetryAttempts: verifierClaimGate.submission.retry.attempts.length,
      mailchimpEnabled: providerContract.mailchimp.enabled ? 1 : 0,
      mailchimpReady: providerContract.mailchimp.ready ? 1 : 0,
      mailchimpLifecycleGateReady: providerContract.mailchimp.lifecycleGate.ready ? 1 : 0,
      mailchimpLifecycleGateBlocked: providerContract.mailchimp.lifecycleGate.state === 'blocked' ? 1 : 0,
      mailchimpMissingCampaign: providerContract.mailchimp.reasonCodes.includes('mailchimp_campaign_missing') ? 1 : 0,
      mailchimpMissingAudience: providerContract.mailchimp.reasonCodes.includes('mailchimp_audience_missing') ? 1 : 0,
      mailchimpSegmentCount: providerContract.mailchimp.audience.segmentIds.length,
      mailchimpPendingOutbound: providerContract.mailchimp.enabled ? providerContract.sync.pendingOutbound : 0,
      mailchimpExportLedgerRecords: mailchimpExportLedger.counters.retainedRecords,
      mailchimpExportLedgerReadyRecords: mailchimpExportLedger.counters.readyRecords,
      mailchimpExportLedgerAcceptedRecords: mailchimpExportLedger.counters.acceptedRecords,
      mailchimpExportLedgerBlockingRecords: mailchimpExportLedger.counters.blockingRecordCount,
      mailchimpExportContinuityChanged: mailchimpExportLedger.continuity.campaignChanged || mailchimpExportLedger.continuity.audienceChanged ? 1 : 0
    },
    snapshots,
    trend: {
      previousMode: previous?.mode || null,
      currentMode: operationalMode,
      modeChanged: Boolean(previous && previous.mode !== operationalMode),
      deniedClaimDelta: previous ? currentSnapshot.deniedCount - previous.deniedCount : 0,
      validationErrorDelta: previous ? currentSnapshot.validationErrorCount - previous.validationErrorCount : 0,
      verifierGateStateChanged: Boolean(previous && previous.verifierGateAllowed !== currentSnapshot.verifierGateAllowed),
      verifierGatePendingDelta: previous
        ? Number(currentSnapshot.verifierGatePending) - Number(previous.verifierGatePending)
        : 0,
      exportReady: exportState.reportingState.exportReady,
      reportingState: exportState.reportingState.state
    },
    reporting: exportState,
    mailchimpExportLedger,
    exportSummary: {
      contract: 'operator-userland.cli-claim.export-summary.v1',
      generatedAt: now,
      actorKey: `${principal.tenantId}/${principal.principalId}`,
      scopeKey: `${scope.requestedTenantId}/${scope.requestedWorkspaceId}`,
      kernelKey: `${hostedKernel.kernelId}/${hostedKernel.leaseId || 'no-lease'}`,
      providerKey: `${providerContract.providerId}/${providerContract.protocol}`,
      mailchimpMarketing: providerContract.mailchimp,
      mailchimpExportLedger,
      mode: operationalMode,
      ok: currentSnapshot.ok,
      grantedClaims: claimNames(granted),
      deniedClaims: claimNames(denied),
      deniedPermissions: stableList(deniedPermissions),
      findingCodes: stableList(validationFindings.map((finding) => finding.code)),
      lifecycleCommand: lifecycleControls.command,
      nextAction: nextActionState.action,
      lifecycleSettingsPolicy: lifecycleControls.settingsPolicy,
      lifecycleTransition: lifecycleControls.transition,
      clientRuntimeContract: clientRuntime?.contract || null,
      clientRequestEnvelopeContract: clientRuntime?.request.envelope.contract || null,
      clientWorkflowHandoffContract: clientRuntime?.workflowHandoff.contract || null,
      clientHandoffManifestContract: clientRuntime?.handoffManifest.contract || null,
      clientExitCode: clientRuntime?.state.exitCode ?? 0,
      clientRequestId: clientRuntime?.request.requestId || null,
      clientInvocationId: clientRuntime?.request.envelope.invocationId || null,
      clientOutputFormat: clientRuntime?.request.outputFormat || null,
      clientHandoffTarget: clientRuntime?.handoff.required ? clientRuntime.handoff.target : null,
      clientPrimaryCommand: clientRuntime?.workflowHandoff.commandHints.primary || null,
      clientAcceptCommand: clientRuntime?.workflowHandoff.commandHints.accept || null,
      clientResumeCommand: clientRuntime?.workflowHandoff.commandHints.resume || null,
      clientHandoffManifest: clientRuntime?.handoffManifest
        ? {
            contract: clientRuntime.handoffManifest.contract,
            routeIntent: clientRuntime.handoffManifest.routeIntent,
            commitReady: clientRuntime.handoffManifest.commitReady,
            missingArtifacts: clientRuntime.handoffManifest.missingArtifacts,
            clientCommit: clientRuntime.handoffManifest.clientCommit,
            operatorHandoff: clientRuntime.handoffManifest.operatorHandoff
          }
        : null,
      verifierClaimGate: clientRuntime?.workflowHandoff?.verifierClaimGate || null,
      verifierGateReporting: exportState.verifierClaimGate,
      handoffCheckpoint: {
        contract: handoffCheckpoint.contract,
        acknowledgement: handoffCheckpoint.acknowledgement,
        checkpoint: handoffCheckpoint.checkpoint
      },
      failureState: failureState.state,
      failurePrimaryCode: failureState.primaryCode,
      blockedOperations: failureState.blockedOperations,
      operatorActions: failureState.operatorActions,
      reportingState: exportState.reportingState.state,
      exportReady: exportState.reportingState.exportReady,
      historyWindow: exportState.historyWindow,
      auditAttachments: exportState.auditAttachments,
      persistedBoundary: {
        contract: persistedState.boundary.contract,
        ownedByScope: persistedState.boundary.ownedByScope,
        verified: persistedState.boundary.verified,
        safeForReplay: persistedState.boundary.safeForReplay,
        reasonCodes: persistedState.boundary.reasonCodes,
        evidence: persistedState.boundary.evidence
      },
      tenantPermissionBoundary: {
        contract: tenantBoundary.contract,
        enforcement: tenantBoundary.enforcement,
        safeToEvaluate: tenantBoundary.safeToEvaluate,
        reasonCodes: tenantBoundary.reasonCodes,
        effectivePermissions: tenantBoundary.permissions.effectivePermissions,
        missingBoundaryPermissions: tenantBoundary.permissions.missingBoundaryPermissions,
        auditHandoff: tenantBoundary.auditHandoff
      },
      flatRecord: {
        surfaceId,
        generatedAt: now,
        tenantId: principal.tenantId,
        workspaceId: scope.requestedWorkspaceId,
        principalId: principal.principalId,
        kernelId: hostedKernel.kernelId,
        mode: operationalMode,
        requestedClaims: requestedClaims.length,
        grantedClaims: granted.length,
        deniedClaims: denied.length,
        validationErrors: errorFindings.length,
        validationWarnings: warningFindings.length,
        retryable: retryPlan.retryable,
        lifecycleCommand: lifecycleControls.command,
        lifecycleDesiredState: lifecycleControls.transition.desiredState,
        lifecycleTransitionOperation: lifecycleControls.transition.operation,
        lifecycleMutationRequired: lifecycleControls.transition.mutationRequired,
        lifecycleSettingsValid: lifecycleControls.settingsPolicy.validation.ok,
        lifecycleSettingsReasons: lifecycleControls.settingsPolicy.validation.reasonCodes.join(','),
        lifecycleScheduleMode: lifecycleControls.schedule.mode,
        lifecycleScheduleIntervalMs: lifecycleControls.schedule.intervalMs,
        lifecycleScheduleMaxRuns: lifecycleControls.schedule.maxRuns,
        lifecycleScheduleCompletedRuns: lifecycleControls.schedule.cursor.completedRuns,
        lifecycleScheduleRemainingRuns: lifecycleControls.schedule.cursor.remainingRuns,
        lifecycleScheduleCursorState: lifecycleControls.schedule.cursor.state,
        lifecycleScheduleNextRunAt: lifecycleControls.schedule.cursor.nextRunAt || '',
        lifecycleScheduleRunLimitReached: lifecycleControls.schedule.cursor.runLimitReached,
        nextAction: nextActionState.action,
        clientExitCode: clientRuntime?.state.exitCode ?? 0,
        clientRequestId: clientRuntime?.request.requestId || '',
        clientRuntimeState: clientRuntime?.state.lifecycleState || nextActionState.state,
        providerId: providerContract.providerId,
        providerProtocol: providerContract.protocol,
        providerSyncFresh: providerContract.sync.fresh,
        providerHandoffState: providerContract.handoff.state,
        mailchimpEnabled: providerContract.mailchimp.enabled,
        mailchimpReady: providerContract.mailchimp.ready,
        mailchimpLifecycleGateState: providerContract.mailchimp.lifecycleGate.state,
        mailchimpLifecycleGateReady: providerContract.mailchimp.lifecycleGate.ready,
        mailchimpCampaignId: providerContract.mailchimp.campaign.campaignId || '',
        mailchimpAudienceId: providerContract.mailchimp.audience.audienceId || '',
        mailchimpCampaignStatus: providerContract.mailchimp.campaign.status,
        mailchimpSegmentCount: providerContract.mailchimp.audience.segmentIds.length,
        mailchimpNextProviderAction: providerContract.mailchimp.nextProviderAction,
        mailchimpExportLedgerRecords: mailchimpExportLedger.counters.retainedRecords,
        mailchimpExportReadyRecords: mailchimpExportLedger.counters.readyRecords,
        mailchimpExportAcceptedRecords: mailchimpExportLedger.counters.acceptedRecords,
        mailchimpExportCurrentReady: mailchimpExportLedger.currentRecord.ready,
        mailchimpExportCurrentAccepted: mailchimpExportLedger.currentRecord.accepted,
        mailchimpExportContinuityChanged: mailchimpExportLedger.continuity.campaignChanged || mailchimpExportLedger.continuity.audienceChanged,
        failureState: failureState.state,
        failurePrimaryCode: failureState.primaryCode,
        blockedOperations: failureState.blockedOperations.join(','),
        operatorActions: failureState.operatorActions.join(','),
        exportReady: exportState.reportingState.exportReady,
        reportingState: exportState.reportingState.state,
        historySnapshotCount: exportState.historyWindow.snapshotCount,
        historyDeniedClaimTotal: exportState.historyWindow.deniedClaimTotal,
        historyValidationErrorTotal: exportState.historyWindow.validationErrorTotal,
        persistedStorageKey: persistedState.storageKey,
        persistedBoundaryOwned: persistedState.boundary.ownedByScope,
        persistedBoundaryVerified: persistedState.boundary.verified,
        persistedBoundarySafeForReplay: persistedState.boundary.safeForReplay,
        persistedBoundaryReasons: persistedState.boundary.reasonCodes.join(','),
        tenantPermissionBoundaryEnforcement: tenantBoundary.enforcement,
        tenantPermissionBoundarySafe: tenantBoundary.safeToEvaluate,
        tenantPermissionBoundaryReasons: tenantBoundary.reasonCodes.join(','),
        tenantPermissionBoundaryMissingPermissions: tenantBoundary.permissions.missingBoundaryPermissions.join(','),
        persistedStorageTenantId: persistedState.boundary.storageTenantId || '',
        persistedStorageWorkspaceId: persistedState.boundary.storageWorkspaceId || '',
        persistedStoragePrincipalId: persistedState.boundary.storagePrincipalId || '',
        idempotencyKey: persistedState.idempotency.key,
      persistedOperation: persistedState.writePlan.operation,
      persistedCanonicalState: persistedState.statusProjection.canonicalState,
      persistedReplayClassification: persistedState.statusProjection.replayClassification,
      persistedRestartSafe: persistedState.statusProjection.restartSafe,
      persistedStatusExitCode: persistedState.statusProjection.statusExitCode,
      persistedNextRevision: persistedState.writePlan.revision,
      recoveryRequired: persistedState.recovery.required,
      recoveryCanResume: persistedState.recovery.canResume,
      persistedResumeCommand: persistedState.statusProjection.recoveryPath.resumeCommand || '',
      clientInvocationId: clientRuntime?.request.envelope.invocationId || '',
        clientSessionId: clientRuntime?.request.envelope.session.sessionId || '',
        clientHandoffCommand: clientRuntime?.workflowHandoff.commandHints.primary || '',
        clientHandoffManifestCommitReady: clientRuntime?.handoffManifest.commitReady || false,
        clientHandoffManifestMissingArtifacts: clientRuntime?.handoffManifest.missingArtifacts.join(',') || '',
        clientHandoffManifestRouteIntent: clientRuntime?.handoffManifest.routeIntent || '',
        clientVerifierGateCommand: clientRuntime?.workflowHandoff.commandHints.verifierGate || '',
        clientVerifierGatePending: clientRuntime?.workflowHandoff?.verifierClaimGate?.pending || false,
        verifierGateRequired: verifierClaimGate.required,
        verifierGateAllowed: verifierClaimGate.allowed,
        verifierGateDecision: verifierClaimGate.decision || '',
        verifierGateId: verifierClaimGate.gateId || '',
        verifierRunId: verifierClaimGate.verifierRunId || '',
        verifierGateReasonCodes: verifierClaimGate.reasonCodes.join(','),
        verifierGateReceiptMatches: verifierClaimGate.providerReceipt.matches,
        verifierGateRetryable: verifierClaimGate.submission.retryable,
        verifierGateRetryAttempts: verifierClaimGate.submission.retry.attempts.length,
        clientResumeCommand: clientRuntime?.workflowHandoff.commandHints.resume || '',
        clientOperatorPrompts: clientRuntime?.handoffManifest.operatorHandoff.prompts.join(',') || clientRuntime?.workflowHandoff.operatorPrompts.join(',') || ''
      }
    },
    timeline: buildTimelineState({
      now,
      scope,
      hostedKernel,
      providerContract,
      claimDecisions,
      validationFindings,
      operationalMode,
      retryPlan,
      lifecycleControls,
      nextActionState,
      verifierClaimGate
    })
  };
}

export function describeCliClaimSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const principal = normalizePrincipal(input);
  const scope = normalizeWorkspaceScope(input, principal);
  const requestedClaims = normalizeClaimRequests(input);
  const tenantBoundary = normalizeTenantPermissionBoundary(input, { principal, scope, requestedClaims });
  const claimDecisions = evaluateClaims({ principal, scope, requestedClaims, tenantBoundary });
  const hostedKernel = normalizeHostedKernelHealth(input);
  const lifecycleControls = normalizeLifecycleControls(input, now);
  const providerContract = normalizeProviderServiceContract(input, lifecycleControls, now);
  const retryPolicy = normalizeRetryPolicy(input);
  let persistedState = normalizePersistedClaimState(input, {
    now,
    principal,
    scope,
    requestedClaims,
    hostedKernel,
    providerContract,
    lifecycleControls
  });
  const handoffCheckpoint = normalizeProviderHandoffCheckpoint(input, {
    now,
    principal,
    scope,
    providerContract,
    persistedState,
    lifecycleControls
  });
  const verifierClaimGate = normalizeVerifierClaimGate(input, {
    now,
    principal,
    scope,
    requestedClaims,
    lifecycleControls,
    persistedState,
    providerContract,
    retryPolicy
  });
  persistedState = applyVerifierClaimGateToPersistedState(
    persistedState,
    verifierClaimGate,
    lifecycleControls,
    now
  );
  const validationFindings = [
    ...validateCliClaimRequest({
      principal,
      scope,
      requestedClaims,
      hostedKernel,
      tenantBoundary
    }),
    ...validateLifecycleControls(lifecycleControls),
    ...validateProviderServiceContract(providerContract),
    ...validatePersistedClaimState(persistedState),
    ...validateProviderHandoffCheckpoint(handoffCheckpoint),
    ...validateVerifierClaimGate(verifierClaimGate)
  ];
  const retryPlan = buildRetryPlan({
    retryPolicy,
    findings: validationFindings,
    hostedKernel
  });
  const auditProof = buildAuditProof({
    now,
    principal,
    scope,
    tenantBoundary,
    claimDecisions,
    evidence: input.evidence
  });
  const boundaryExecution = buildBoundaryExecutionContract({
    now,
    principal,
    scope,
    tenantBoundary,
    claimDecisions,
    lifecycleControls,
    persistedState,
    providerContract,
    handoffCheckpoint,
    auditProof,
    verifierClaimGate,
    validationFindings
  });
  const grantedClaims = claimDecisions.filter((claim) => claim.allowed);
  const deniedClaims = claimDecisions.filter((claim) => !claim.allowed);
  const operationalMode = resolveOperationalMode({
    deniedClaims,
    findings: validationFindings,
    hostedKernel
  });
  const failureState = buildFailureStateContract({
    now,
    deniedClaims,
    validationFindings,
    hostedKernel,
    providerContract,
    handoffCheckpoint,
    lifecycleControls,
    retryPlan,
    persistedState
  });
  const nextActionState = buildNextActionState({
    lifecycleControls,
    operationalMode,
    deniedClaims,
    validationFindings,
    retryPlan,
    auditProof,
    providerContract,
    persistedState
  });
  const actionableErrors = buildActionableErrors({
    deniedClaims,
    findings: validationFindings,
    retryPlan
  });
  const acceptancePreview = buildAcceptancePreviewContract({
    now,
    principal,
    scope,
    tenantBoundary,
    claimDecisions,
    validationFindings,
    hostedKernel,
    providerContract,
    handoffCheckpoint,
    lifecycleControls,
    retryPlan,
    auditProof,
    nextActionState,
    operationalMode,
    persistedState,
    failureState,
    verifierClaimGate
  });
  const clientRuntime = normalizeCliClientRuntime(input, {
    now,
    principal,
    scope,
    tenantBoundary,
    requestedClaims,
    lifecycleControls,
    providerContract,
    handoffCheckpoint,
    persistedState,
    nextActionState,
    failureState,
    auditProof,
    boundaryExecution,
    verifierClaimGate
  });
  const hostedKernelDispatch = buildHostedKernelDispatchContract({
    now,
    principal,
    scope,
    tenantBoundary,
    claimDecisions,
    lifecycleControls,
    providerContract,
    handoffCheckpoint,
    persistedState,
    clientRuntime,
    acceptancePreview,
    failureState,
    retryPlan,
    auditProof,
    verifierClaimGate,
    boundaryExecution
  });
  const previewRoute = buildCliPreviewRouteContract({
    now,
    principal,
    scope,
    claimDecisions,
    validationFindings,
    lifecycleControls,
    providerContract,
    persistedState,
    acceptancePreview,
    clientRuntime,
    failureState,
    auditProof,
    boundaryExecution
  });
  const acceptanceDecision = buildCliAcceptanceDecisionContract({
    now,
    principal,
    scope,
    previewRoute,
    acceptancePreview,
    clientRuntime,
    hostedKernelDispatch,
    failureState,
    persistedState,
    providerContract,
    handoffCheckpoint,
    lifecycleControls,
    auditProof,
    verifierClaimGate,
    boundaryExecution
  });
  const analytics = buildAnalyticsReport({
    now,
    principal,
    scope,
    tenantBoundary,
    requestedClaims,
    claimDecisions,
    validationFindings,
    hostedKernel,
    providerContract,
    handoffCheckpoint,
    operationalMode,
    retryPlan,
    lifecycleControls,
    nextActionState,
    persistedState,
    failureState,
    clientRuntime,
    verifierClaimGate,
    input
  });

  return {
    ok: deniedClaims.length === 0 && !validationFindings.some((finding) => finding.severity === 'error'),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'operator-userland.cli-claim.v1',
    principal,
    workspaceScope: scope,
    tenantPermissionBoundary: tenantBoundary,
    claims: {
      requested: requestedClaims,
      granted: grantedClaims,
      denied: deniedClaims
    },
    operationalHealth: {
      mode: operationalMode,
      hostedKernel,
      provider: providerContract,
      validation: {
        ok: validationFindings.every((finding) => finding.severity !== 'error'),
        findings: validationFindings
      },
      retry: retryPlan,
      tenantPermissionBoundary: tenantBoundary,
      lifecycle: lifecycleControls,
      persistedState,
      persistedStatus: persistedState.statusProjection,
      verifierClaimGate,
      boundaryExecution,
      acceptance: acceptancePreview,
      acceptanceDecision,
      clientRuntime,
      hostedKernelDispatch,
      previewRoute,
      nextAction: nextActionState,
      failureState,
      errors: actionableErrors
    },
    auditProof,
    integration: {
      handoff: 'hosted-kernel.operator-userland.claims',
      attachKernel: auditProof.outcome.safeToAttachKernel
        && operationalMode === 'ready'
        && boundaryExecution.dispatch.allowed
        && providerContract.negotiation.compatible
        && providerContract.sync.fresh
        && providerContract.handoff.ready
        && lifecycleControls.settings.enabled
        && lifecycleControls.settings.attachEnabled
        && lifecycleControls.schedule.ready
        && persistedState.boundary.safeForReplay
        && !lifecycleControls.settings.dryRun,
      provider: {
        contract: providerContract.contract,
        providerId: providerContract.providerId,
        protocol: providerContract.protocol,
        service: providerContract.service,
        profile: providerContract.profile,
        serviceContractId: providerContract.serviceContractId,
        compatible: providerContract.negotiation.compatible,
        missingCapabilities: providerContract.negotiation.missingCapabilities,
        readiness: providerContract.readiness,
        mailchimp: providerContract.mailchimp,
        sync: {
          cursor: providerContract.sync.cursor,
          revision: providerContract.sync.revision,
          fresh: providerContract.sync.fresh,
          pendingOutbound: providerContract.sync.pendingOutbound,
          pendingOutboundWarnAt: providerContract.sync.pendingOutboundWarnAt,
          backpressure: providerContract.sync.backpressure
        }
      },
      externalHandoff: {
        target: providerContract.handoff.target,
        state: providerContract.handoff.state,
        ready: providerContract.handoff.ready,
        required: providerContract.handoff.required,
        externalStateId: providerContract.handoff.externalStateId,
        correlationId: providerContract.handoff.correlationId,
        checkpoint: {
          contract: handoffCheckpoint.contract,
          acknowledgementRequired: handoffCheckpoint.acknowledgement.required,
          acknowledgementAccepted: handoffCheckpoint.acknowledgement.accepted,
          acknowledgementId: handoffCheckpoint.acknowledgement.id,
          state: handoffCheckpoint.acknowledgement.state,
          externalStateMatches: handoffCheckpoint.acknowledgement.externalStateMatches,
          checkpointCursor: handoffCheckpoint.checkpoint.cursor,
          stateMutation: handoffCheckpoint.checkpoint.stateMutation
        }
      },
      auditRequired: deniedClaims.length > 0 || grantedClaims.some((claim) => claim.name === 'auditRead'),
      boundaryMode: scope.tenantMatches && scope.workspaceAllowed ? 'scoped' : 'deny',
      permissionBoundaryMode: tenantBoundary.enforcement,
      permissionBoundarySafe: tenantBoundary.safeToEvaluate,
      permissionBoundaryAuditHandoff: tenantBoundary.auditHandoff,
      verifierClaimGate: {
        contract: verifierClaimGate.contract,
        required: verifierClaimGate.required,
        allowed: verifierClaimGate.allowed,
        route: verifierClaimGate.route,
        routePolicy: verifierClaimGate.routePolicy,
        gateId: verifierClaimGate.gateId,
        verifierRunId: verifierClaimGate.verifierRunId,
        decision: verifierClaimGate.decision,
        providerReceipt: verifierClaimGate.providerReceipt,
        reasonCodes: verifierClaimGate.reasonCodes
      },
      boundaryExecution: {
        contract: boundaryExecution.contract,
        execution: boundaryExecution.execution,
        commit: boundaryExecution.commit,
        dispatch: boundaryExecution.dispatch,
        acceptance: boundaryExecution.acceptance,
        audit: boundaryExecution.audit,
        operatorPrompts: boundaryExecution.operatorPrompts
      },
      degradedMode: operationalMode === 'degraded' || operationalMode === 'blocked_degraded',
      failureState: failureState.state,
      failurePrimaryCode: failureState.primaryCode,
      blockedOperations: failureState.blockedOperations,
      operatorActions: failureState.operatorActions,
      lifecycleState: nextActionState.state,
      nextAction: nextActionState.action,
      clientRuntime: {
        contract: clientRuntime.contract,
        request: clientRuntime.request,
        state: clientRuntime.state,
        handoff: clientRuntime.handoff,
        workflowHandoff: clientRuntime.workflowHandoff,
        handoffManifest: clientRuntime.handoffManifest,
        proof: clientRuntime.proof,
        userVisible: clientRuntime.userVisible,
        previewRoute: {
          contract: previewRoute.contract,
          route: previewRoute.route,
          status: previewRoute.status,
          validationSummary: previewRoute.validationSummary,
          mailchimpAcceptance: previewRoute.mailchimpAcceptance,
          acceptance: previewRoute.acceptance,
          nextStep: previewRoute.nextStep
        },
        acceptanceDecision: {
          contract: acceptanceDecision.contract,
          route: acceptanceDecision.route,
          decision: acceptanceDecision.decision,
          readinessSummary: acceptanceDecision.readinessSummary,
          validationSummary: acceptanceDecision.validationSummary,
          nextStep: acceptanceDecision.nextStep,
          commit: acceptanceDecision.commit,
          userVisible: acceptanceDecision.userVisible
        }
      },
      hostedKernelDispatch: {
        contract: hostedKernelDispatch.contract,
        dispatch: hostedKernelDispatch.dispatch,
        transport: hostedKernelDispatch.transport,
        queue: hostedKernelDispatch.queue,
        commandEnvelope: hostedKernelDispatch.commandEnvelope,
        auditTrail: hostedKernelDispatch.auditTrail
      },
      persistedState: {
        contract: persistedState.contract,
        storageKey: persistedState.storageKey,
        boundary: persistedState.boundary,
        idempotency: persistedState.idempotency,
        recovery: persistedState.recovery,
        statusProjection: persistedState.statusProjection,
        writePlan: persistedState.writePlan,
        restartSafe: persistedState.statusProjection.restartSafe || !persistedState.recovery.required
      },
      acceptance: {
        contract: acceptancePreview.contract,
        verdict: acceptancePreview.preview.verdict,
        attachAccepted: acceptancePreview.preview.attachAccepted,
        ready: acceptancePreview.readiness.ready,
        blockedGates: acceptancePreview.preview.blockedGates,
        mailchimpReady: acceptancePreview.readiness.mailchimpReady,
        mailchimpMarketing: acceptancePreview.mailchimpMarketing,
        mailchimpAcceptance: previewRoute.mailchimpAcceptance,
        validationSummary: acceptancePreview.validationSummary,
        nextStep: acceptancePreview.nextStep,
        failureState: acceptancePreview.failureState,
        decision: {
          contract: acceptanceDecision.contract,
          accepted: acceptanceDecision.decision.accepted,
          state: acceptanceDecision.decision.state,
          reasonCodes: acceptanceDecision.decision.reasonCodes,
          readinessSummary: acceptanceDecision.readinessSummary,
          validationSummary: acceptanceDecision.validationSummary,
          nextStep: acceptanceDecision.nextStep,
          userVisible: acceptanceDecision.userVisible
        }
      }
    },
    analytics,
    evidence: auditProof.evidence
  };
}

export default describeCliClaimSurface;
