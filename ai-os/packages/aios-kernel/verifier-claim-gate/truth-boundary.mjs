export const surfaceId = "aios_verifier-claim-gate_truth-boundary_070";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "truth-boundary";

const lifecycleCommands = new Set(['inspect', 'enable', 'disable', 'pause', 'resume', 'schedule']);
const scheduleModes = new Set(['manual', 'interval', 'onEvidenceChange']);
const boundaryModes = new Set(['advisory', 'blocking']);
const providerSyncStatuses = new Set(['unknown', 'pending', 'current', 'stale', 'failed']);
const persistedBoundaryStatuses = new Set(['unknown', 'active', 'inactive', 'paused', 'disabled', 'blocked', 'ready', 'pending_handoff']);
const clientActions = new Set(['preview', 'inspect', 'accept', 'attachEvidence', 'updateProviderContracts', 'createHandoff']);
const clientRouteNames = new Set(['preview', 'acceptance', 'evidence', 'providerContracts', 'handoffs']);
const actorRoles = new Set(['viewer', 'operator', 'approver', 'auditor', 'tenantAdmin']);
const claimCriticalities = new Set(['low', 'medium', 'high', 'critical']);
const providerAuthSchemes = new Set(['none', 'mTLS', 'oauth2', 'signedWebhook']);
const handoffReceiptStatuses = new Set(['draft', 'queued', 'sent', 'acknowledged', 'failed', 'expired']);
const analyticsExportFormats = new Set(['json-lines', 'csv']);
const analyticsExportSections = new Set([
  'decision',
  'readiness',
  'access',
  'provider-health',
  'claim-coverage',
  'provider-plan',
  'handoff',
  'workspace-boundary',
  'timeline',
  'analytics',
  'workflow',
  'persistence'
]);
const providerFreshnessBudgetsSeconds = Object.freeze({
  current: 900,
  pending: 300,
  unknown: 600
});
const actionPermissionRequirements = Object.freeze({
  preview: 'truthBoundary.preview',
  inspect: 'truthBoundary.preview',
  accept: 'truthBoundary.accept',
  attachEvidence: 'truthBoundary.evidence.write',
  updateProviderContracts: 'truthBoundary.providerContracts.write',
  createHandoff: 'truthBoundary.handoff.create'
});
const mutatingClientActions = new Set(['accept', 'attachEvidence', 'updateProviderContracts', 'createHandoff']);
const rolePermissionDefaults = Object.freeze({
  viewer: ['truthBoundary.preview'],
  operator: ['truthBoundary.preview', 'truthBoundary.evidence.write'],
  approver: ['truthBoundary.preview', 'truthBoundary.evidence.write', 'truthBoundary.accept'],
  auditor: ['truthBoundary.preview', 'truthBoundary.audit.read', 'truthBoundary.handoff.create'],
  tenantAdmin: [
    'truthBoundary.preview',
    'truthBoundary.evidence.write',
    'truthBoundary.accept',
    'truthBoundary.providerContracts.write',
    'truthBoundary.handoff.create',
    'truthBoundary.audit.read'
  ]
});
const supportedProviderCapabilities = new Set([
  'claim.read',
  'evidence.read',
  'evidence.verify',
  'decision.write',
  'audit.write',
  'handoff.create'
]);
const providerCapabilityOperations = Object.freeze({
  'claim.read': Object.freeze({ operationId: 'readClaims', direction: 'inbound', method: 'GET', route: '/claims' }),
  'evidence.read': Object.freeze({ operationId: 'readEvidence', direction: 'inbound', method: 'GET', route: '/evidence' }),
  'evidence.verify': Object.freeze({ operationId: 'verifyEvidence', direction: 'outbound', method: 'POST', route: '/evidence/verify' }),
  'decision.write': Object.freeze({ operationId: 'writeDecision', direction: 'outbound', method: 'POST', route: '/decisions' }),
  'audit.write': Object.freeze({ operationId: 'writeAuditProof', direction: 'outbound', method: 'POST', route: '/audit/proofs' }),
  'handoff.create': Object.freeze({ operationId: 'createExternalHandoff', direction: 'outbound', method: 'POST', route: '/handoffs' })
});
const lifecycleCommandPermissionRequirements = Object.freeze({
  inspect: 'truthBoundary.preview',
  enable: 'truthBoundary.providerContracts.write',
  disable: 'truthBoundary.providerContracts.write',
  pause: 'truthBoundary.providerContracts.write',
  resume: 'truthBoundary.providerContracts.write',
  schedule: 'truthBoundary.providerContracts.write'
});

const defaultSettings = Object.freeze({
  enabled: true,
  boundaryMode: 'blocking',
  requireEvidence: true,
  minimumEvidenceItems: 1,
  allowUnverifiedClaims: false,
  schedule: Object.freeze({
    mode: 'manual',
    intervalMinutes: null,
    nextRunAt: null
  })
});

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMinimumEvidenceItems(value, issues) {
  if (value === undefined) return defaultSettings.minimumEvidenceItems;
  if (!Number.isInteger(value) || value < 0 || value > 50) {
    issues.push({
      code: 'invalid_minimum_evidence_items',
      path: 'settings.minimumEvidenceItems',
      message: 'minimumEvidenceItems must be an integer from 0 to 50'
    });
    return defaultSettings.minimumEvidenceItems;
  }
  return value;
}

function normalizeSchedule(inputSchedule, issues) {
  const schedule = asRecord(inputSchedule);
  const mode = scheduleModes.has(schedule.mode) ? schedule.mode : defaultSettings.schedule.mode;

  if (schedule.mode !== undefined && !scheduleModes.has(schedule.mode)) {
    issues.push({
      code: 'invalid_schedule_mode',
      path: 'settings.schedule.mode',
      message: `schedule.mode must be one of ${Array.from(scheduleModes).join(', ')}`
    });
  }

  const intervalMinutes = schedule.intervalMinutes === null || schedule.intervalMinutes === undefined
    ? defaultSettings.schedule.intervalMinutes
    : schedule.intervalMinutes;

  if (intervalMinutes !== null && (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080)) {
    issues.push({
      code: 'invalid_schedule_interval',
      path: 'settings.schedule.intervalMinutes',
      message: 'intervalMinutes must be null or an integer from 5 to 10080'
    });
  }

  const nextRunAt = asNonEmptyString(schedule.nextRunAt);
  if (nextRunAt && Number.isNaN(Date.parse(nextRunAt))) {
    issues.push({
      code: 'invalid_schedule_next_run_at',
      path: 'settings.schedule.nextRunAt',
      message: 'nextRunAt must be an ISO-8601 timestamp when provided'
    });
  }

  return {
    mode,
    intervalMinutes: intervalMinutes === null || (Number.isInteger(intervalMinutes) && intervalMinutes >= 5 && intervalMinutes <= 10080)
      ? intervalMinutes
      : defaultSettings.schedule.intervalMinutes,
    nextRunAt: nextRunAt && !Number.isNaN(Date.parse(nextRunAt)) ? new Date(nextRunAt).toISOString() : null
  };
}

function normalizeSettings(input, issues) {
  const settings = asRecord(input.settings);
  const boundaryMode = boundaryModes.has(settings.boundaryMode)
    ? settings.boundaryMode
    : defaultSettings.boundaryMode;

  if (settings.boundaryMode !== undefined && !boundaryModes.has(settings.boundaryMode)) {
    issues.push({
      code: 'invalid_boundary_mode',
      path: 'settings.boundaryMode',
      message: `boundaryMode must be one of ${Array.from(boundaryModes).join(', ')}`
    });
  }

  return {
    enabled: normalizeBoolean(input.enabled, normalizeBoolean(settings.enabled, defaultSettings.enabled)),
    boundaryMode,
    requireEvidence: normalizeBoolean(settings.requireEvidence, defaultSettings.requireEvidence),
    minimumEvidenceItems: normalizeMinimumEvidenceItems(settings.minimumEvidenceItems, issues),
    allowUnverifiedClaims: normalizeBoolean(settings.allowUnverifiedClaims, defaultSettings.allowUnverifiedClaims),
    schedule: normalizeSchedule(settings.schedule, issues)
  };
}

function normalizeLifecycleCommand(input, issues) {
  const command = asNonEmptyString(input.lifecycleCommand) || 'inspect';
  if (!lifecycleCommands.has(command)) {
    issues.push({
      code: 'invalid_lifecycle_command',
      path: 'lifecycleCommand',
      message: `lifecycleCommand must be one of ${Array.from(lifecycleCommands).join(', ')}`
    });
    return 'inspect';
  }
  return command;
}

function normalizeEvidence(input, workspaceScope, issues) {
  return Array.isArray(input.evidence)
    ? input.evidence.map((item, index) => {
        const evidenceTenantId = asNonEmptyString(item?.tenantId) || workspaceScope.tenantId;
        const evidenceWorkspaceId = asNonEmptyString(item?.workspaceId) || workspaceScope.workspaceId;
        const tenantMatches = evidenceTenantId === workspaceScope.tenantId;
        const workspaceMatches = evidenceWorkspaceId === workspaceScope.workspaceId;

        if (workspaceScope.strictTenantIsolation && !tenantMatches) {
          issues.push({
            code: 'cross_tenant_evidence_rejected',
            path: `evidence[${index}].tenantId`,
            message: `evidence tenant ${evidenceTenantId} does not match active tenant ${workspaceScope.tenantId}`
          });
        }

        if (!workspaceMatches) {
          issues.push({
            code: 'cross_workspace_evidence_rejected',
            path: `evidence[${index}].workspaceId`,
            message: `evidence workspace ${evidenceWorkspaceId} does not match active workspace ${workspaceScope.workspaceId}`
          });
        }

        return {
          index,
          claimId: asNonEmptyString(item?.claimId) || `claim-${index + 1}`,
          source: asNonEmptyString(item?.source) || 'unspecified',
          verified: item?.verified === true,
          collectedAt: asNonEmptyString(item?.collectedAt) || null,
          tenantId: evidenceTenantId,
          workspaceId: evidenceWorkspaceId,
          inScope: tenantMatches && workspaceMatches,
          scopeStatus: tenantMatches && workspaceMatches ? 'accepted' : 'rejected'
        };
      })
    : [];
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map(asNonEmptyString).filter(Boolean)
    : [];
}

function normalizePermissionGrantEntries(values, source, workspaceScope, now, issues) {
  const grants = [];
  if (!Array.isArray(values)) return grants;

  values.forEach((value, index) => {
    const path = `${source}[${index}]`;
    const record = asRecord(value);
    const permission = typeof value === 'string'
      ? asNonEmptyString(value)
      : asNonEmptyString(record.permission) || asNonEmptyString(record.id);
    const tenantId = asNonEmptyString(record.tenantId) || workspaceScope.tenantId;
    const workspaceId = asNonEmptyString(record.workspaceId) || workspaceScope.workspaceId;
    const tenantMatches = tenantId === workspaceScope.tenantId;
    const workspaceMatches = workspaceId === workspaceScope.workspaceId;
    const expiresAt = normalizeIsoTimestamp(
      record.expiresAt,
      issues,
      `${path}.expiresAt`,
      'invalid_permission_grant_expires_at'
    );
    const expired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.parse(now));
    const revoked = record.revoked === true;
    const scoped = tenantMatches && workspaceMatches;

    if (!permission) {
      issues.push({
        code: 'missing_permission_grant',
        path,
        message: 'permission grant entries require a permission string'
      });
    }

    if (workspaceScope.strictTenantIsolation && !tenantMatches) {
      issues.push({
        code: 'cross_tenant_permission_grant_rejected',
        path: `${path}.tenantId`,
        message: `permission grant tenant ${tenantId} does not match active tenant ${workspaceScope.tenantId}`
      });
    }

    if (!workspaceMatches) {
      issues.push({
        code: 'cross_workspace_permission_grant_rejected',
        path: `${path}.workspaceId`,
        message: `permission grant workspace ${workspaceId} does not match active workspace ${workspaceScope.workspaceId}`
      });
    }

    if (expired) {
      issues.push({
        code: 'expired_permission_grant',
        path: `${path}.expiresAt`,
        message: `permission grant ${permission || 'unknown'} expired at ${expiresAt}`
      });
    }

    if (revoked) {
      issues.push({
        code: 'revoked_permission_grant',
        path: `${path}.revoked`,
        message: `permission grant ${permission || 'unknown'} is revoked`
      });
    }

    grants.push({
      contractVersion: 'truth-boundary.permission-grant.v1',
      permission: permission || 'unspecified',
      source,
      tenantId,
      workspaceId,
      delegatedBy: asNonEmptyString(record.delegatedBy),
      expiresAt,
      inScope: scoped,
      active: Boolean(permission && scoped && !expired && !revoked),
      status: !permission
        ? 'invalid'
        : !scoped
          ? 'out_of_scope'
          : expired
            ? 'expired'
            : revoked
              ? 'revoked'
              : 'active'
    });
  });

  return grants;
}

function buildRolePermissionGrants(role, workspaceScope) {
  return (rolePermissionDefaults[role] || []).map((permission) => ({
    contractVersion: 'truth-boundary.permission-grant.v1',
    permission,
    source: 'roleDefault',
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    delegatedBy: null,
    expiresAt: null,
    inScope: true,
    active: true,
    status: 'active'
  }));
}

function normalizeClaims(input, workspaceScope, issues) {
  const claims = Array.isArray(input.claims)
    ? input.claims
    : Array.isArray(input.claimRegister)
      ? input.claimRegister
      : [];
  const seenClaimIds = new Set();

  return claims.map((claim, index) => {
    const record = asRecord(claim);
    const path = `claims[${index}]`;
    const claimId = asNonEmptyString(record.claimId) || asNonEmptyString(record.id);
    const statement = asNonEmptyString(record.statement) || asNonEmptyString(record.text);
    const source = asNonEmptyString(record.source) || asNonEmptyString(record.origin);
    const tenantId = asNonEmptyString(record.tenantId) || workspaceScope.tenantId;
    const workspaceId = asNonEmptyString(record.workspaceId) || workspaceScope.workspaceId;
    const tenantMatches = tenantId === workspaceScope.tenantId;
    const workspaceMatches = workspaceId === workspaceScope.workspaceId;
    const criticality = claimCriticalities.has(record.criticality) ? record.criticality : 'medium';

    if (!claimId) {
      issues.push({
        code: 'missing_claim_id',
        path: `${path}.claimId`,
        message: 'claim register entries require a claimId'
      });
    } else if (seenClaimIds.has(claimId)) {
      issues.push({
        code: 'duplicate_claim_id',
        path: `${path}.claimId`,
        message: `claimId ${claimId} is duplicated in the claim register`
      });
    }

    if (!statement) {
      issues.push({
        code: 'missing_claim_statement',
        path: `${path}.statement`,
        message: 'claim register entries require a source-backed statement'
      });
    }

    if (!source) {
      issues.push({
        code: 'missing_claim_source',
        path: `${path}.source`,
        message: 'claim register entries require a source or origin'
      });
    }

    if (record.criticality !== undefined && !claimCriticalities.has(record.criticality)) {
      issues.push({
        code: 'invalid_claim_criticality',
        path: `${path}.criticality`,
        message: `claim criticality must be one of ${Array.from(claimCriticalities).join(', ')}`
      });
    }

    if (workspaceScope.strictTenantIsolation && !tenantMatches) {
      issues.push({
        code: 'cross_tenant_claim_rejected',
        path: `${path}.tenantId`,
        message: `claim tenant ${tenantId} does not match active tenant ${workspaceScope.tenantId}`
      });
    }

    if (!workspaceMatches) {
      issues.push({
        code: 'cross_workspace_claim_rejected',
        path: `${path}.workspaceId`,
        message: `claim workspace ${workspaceId} does not match active workspace ${workspaceScope.workspaceId}`
      });
    }

    if (claimId) seenClaimIds.add(claimId);

    return {
      contractVersion: 'truth-boundary.claim.v1',
      index,
      claimId: claimId || `claim-${index + 1}`,
      statement: statement || 'unspecified claim',
      source: source || 'unspecified',
      required: record.required !== false,
      criticality,
      tenantId,
      workspaceId,
      inScope: tenantMatches && workspaceMatches,
      scopeStatus: tenantMatches && workspaceMatches ? 'accepted' : 'rejected',
      tags: normalizeStringList(record.tags)
    };
  });
}

function deriveClaimCoverage(claims, evidence, settings, issues) {
  const evidenceByClaimId = new Map();
  const declaredClaimIds = new Set(claims.map((claim) => claim.claimId));
  const orphanEvidenceIds = [];

  evidence.forEach((item) => {
    if (!evidenceByClaimId.has(item.claimId)) evidenceByClaimId.set(item.claimId, []);
    evidenceByClaimId.get(item.claimId).push(item);

    if (declaredClaimIds.size > 0 && !declaredClaimIds.has(item.claimId)) {
      orphanEvidenceIds.push(item.claimId);
    }
  });

  if (orphanEvidenceIds.length > 0) {
    issues.push({
      code: 'evidence_references_unknown_claim',
      path: 'evidence.claimId',
      message: `evidence references undeclared claim(s): ${Array.from(new Set(orphanEvidenceIds)).join(', ')}`
    });
  }

  const claimProofs = claims.map((claim) => {
    const claimEvidence = evidenceByClaimId.get(claim.claimId) || [];
    const verifiedEvidence = claimEvidence.filter((item) => item.verified && item.inScope !== false);
    const hasVerifiedEvidence = verifiedEvidence.length > 0;
    const blocked = settings.requireEvidence
      && settings.boundaryMode === 'blocking'
      && claim.required
      && claim.inScope
      && !settings.allowUnverifiedClaims
      && !hasVerifiedEvidence;

    return {
      claimId: claim.claimId,
      required: claim.required,
      criticality: claim.criticality,
      source: claim.source,
      scopeStatus: claim.scopeStatus,
      evidenceCount: claimEvidence.length,
      verifiedEvidenceCount: verifiedEvidence.length,
      verifiedEvidenceSources: verifiedEvidence.map((item) => item.source),
      proofStatus: !claim.inScope
        ? 'out_of_scope'
        : hasVerifiedEvidence
          ? 'source_backed'
          : claim.required
            ? 'missing_verified_evidence'
            : 'unverified_optional',
      blocking: blocked
    };
  });
  const blockingClaimIds = claimProofs.filter((claim) => claim.blocking).map((claim) => claim.claimId);

  return {
    contractVersion: 'truth-boundary.claim-coverage.v1',
    claimCount: claims.length,
    declaredClaimIds: claims.map((claim) => claim.claimId),
    requiredClaimCount: claims.filter((claim) => claim.required && claim.inScope).length,
    sourceBackedClaimCount: claimProofs.filter((claim) => claim.proofStatus === 'source_backed').length,
    blockingClaimIds,
    orphanEvidenceClaimIds: Array.from(new Set(orphanEvidenceIds)),
    decision: blockingClaimIds.length === 0 ? 'accepted' : 'missing_verified_claim_evidence',
    claims: claimProofs
  };
}

function normalizeWorkspaceScope(input, clientRuntime, issues) {
  const workspace = asRecord(input.workspace ?? input.scope ?? input.tenant);
  const request = asRecord(input.request);
  const runtime = asRecord(input.runtime);
  const client = asRecord(input.client);
  const tenantId = asNonEmptyString(workspace.tenantId)
    || asNonEmptyString(request.tenantId)
    || asNonEmptyString(runtime.tenantId)
    || asNonEmptyString(client.tenantId)
    || 'hosted-kernel-tenant';
  const workspaceId = asNonEmptyString(workspace.workspaceId)
    || asNonEmptyString(request.workspaceId)
    || asNonEmptyString(runtime.workspaceId)
    || asNonEmptyString(client.workspaceId)
    || 'default-workspace';
  const region = asNonEmptyString(workspace.region) || asNonEmptyString(runtime.region) || null;
  const strictTenantIsolation = normalizeBoolean(workspace.strictTenantIsolation, true);

  if (workspace.tenantId !== undefined && !asNonEmptyString(workspace.tenantId)) {
    issues.push({
      code: 'invalid_workspace_tenant_id',
      path: 'workspace.tenantId',
      message: 'workspace.tenantId must be a non-empty string when provided'
    });
  }

  if (workspace.workspaceId !== undefined && !asNonEmptyString(workspace.workspaceId)) {
    issues.push({
      code: 'invalid_workspace_id',
      path: 'workspace.workspaceId',
      message: 'workspace.workspaceId must be a non-empty string when provided'
    });
  }

  return {
    contractVersion: 'truth-boundary.workspace-scope.v1',
    tenantId,
    workspaceId,
    region,
    strictTenantIsolation,
    actorId: clientRuntime.actor.actorId,
    correlationId: clientRuntime.correlationId
  };
}

function normalizeAccessPolicy(input, clientRuntime, workspaceScope, issues, now) {
  const actor = asRecord(input.actor);
  const client = asRecord(input.client);
  const requestedRole = clientRuntime.actor.role;
  const role = actorRoles.has(requestedRole) ? requestedRole : 'operator';
  const actorTenantId = asNonEmptyString(actor.tenantId) || asNonEmptyString(client.tenantId) || workspaceScope.tenantId;
  const actorWorkspaceId = asNonEmptyString(actor.workspaceId) || asNonEmptyString(client.workspaceId) || workspaceScope.workspaceId;
  const actorTenantMatches = actorTenantId === workspaceScope.tenantId;
  const actorWorkspaceMatches = actorWorkspaceId === workspaceScope.workspaceId;
  const roleGrants = buildRolePermissionGrants(role, workspaceScope);
  const legacyActorPermissions = normalizeStringList(actor.permissions);
  const legacyClientPermissions = normalizeStringList(client.permissions);
  const explicitGrants = normalizePermissionGrantEntries(
    legacyActorPermissions.concat(asRecord(actor).permissionGrants || []),
    'actor.permissionGrants',
    workspaceScope,
    now,
    issues
  ).concat(normalizePermissionGrantEntries(
    legacyClientPermissions.concat(asRecord(client).permissionGrants || []),
    'client.permissionGrants',
    workspaceScope,
    now,
    issues
  ));
  const permissionGrants = roleGrants.concat(explicitGrants);
  const activePermissionGrants = permissionGrants.filter((grant) => grant.active);
  const permissions = Array.from(new Set(activePermissionGrants.map((grant) => grant.permission)));
  const requiredPermission = actionPermissionRequirements[clientRuntime.requestedAction];
  const hasRequiredPermission = requiredPermission ? permissions.includes(requiredPermission) : false;
  const scopedActor = actorTenantMatches && actorWorkspaceMatches;
  const boundaryMutation = mutatingClientActions.has(clientRuntime.requestedAction);
  const hasMutationAuditAnchor = !boundaryMutation || Boolean(clientRuntime.sessionId);
  const allowed = Boolean(hasRequiredPermission && scopedActor && hasMutationAuditAnchor);

  if (!actorRoles.has(requestedRole)) {
    issues.push({
      code: 'invalid_actor_role',
      path: 'actor.role',
      message: `actor.role must be one of ${Array.from(actorRoles).join(', ')}`
    });
  }

  if (workspaceScope.strictTenantIsolation && !actorTenantMatches) {
    issues.push({
      code: 'cross_tenant_actor_scope_denied',
      path: 'actor.tenantId',
      message: `actor tenant ${actorTenantId} does not match active tenant ${workspaceScope.tenantId}`
    });
  }

  if (!actorWorkspaceMatches) {
    issues.push({
      code: 'cross_workspace_actor_scope_denied',
      path: 'actor.workspaceId',
      message: `actor workspace ${actorWorkspaceId} does not match active workspace ${workspaceScope.workspaceId}`
    });
  }

  if (!hasRequiredPermission) {
    issues.push({
      code: 'missing_action_permission',
      path: 'actor.permissions',
      message: `${clientRuntime.requestedAction} requires ${requiredPermission}`
    });
  }

  if (boundaryMutation && !clientRuntime.sessionId) {
    issues.push({
      code: 'missing_mutation_session',
      path: 'client.sessionId',
      message: `${clientRuntime.requestedAction} requires a client.sessionId for tenant-scoped audit handoff`
    });
  }

  return {
    contractVersion: 'truth-boundary.access-policy.v1',
    actorId: clientRuntime.actor.actorId,
    role,
    actorScope: {
      tenantId: actorTenantId,
      workspaceId: actorWorkspaceId,
      tenantMatches: actorTenantMatches,
      workspaceMatches: actorWorkspaceMatches
    },
    requestedAction: clientRuntime.requestedAction,
    requiredPermission,
    permissions,
    permissionGrants,
    activePermissionGrants,
    deniedGrantReasons: permissionGrants
      .filter((grant) => grant.status !== 'active')
      .map((grant) => ({
        permission: grant.permission,
        source: grant.source,
        tenantId: grant.tenantId,
        workspaceId: grant.workspaceId,
        status: grant.status
      })),
    decision: allowed ? 'allowed' : 'denied',
    decisionReason: !scopedActor
      ? 'actor_scope_outside_workspace'
      : !hasRequiredPermission
        ? 'missing_required_permission'
      : !hasMutationAuditAnchor
          ? 'mutation_missing_session_audit_anchor'
          : 'permission_grant_active_in_workspace',
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId
  };
}

function normalizeIsoTimestamp(value, issues, path, code) {
  const timestamp = asNonEmptyString(value);
  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    issues.push({
      code,
      path,
      message: `${path} must be an ISO-8601 timestamp when provided`
    });
    return null;
  }
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function normalizePersistedBoundaryState(input, issues) {
  const state = asRecord(input.persistedState ?? input.boundaryState ?? input.stateSnapshot);
  const status = persistedBoundaryStatuses.has(state.status) ? state.status : 'unknown';
  const lastCommand = asRecord(state.lastCommand);
  const snapshotSequence = state.snapshotSequence === undefined ? 0 : state.snapshotSequence;
  const storageEpoch = state.storageEpoch === undefined ? 1 : state.storageEpoch;

  if (state.status !== undefined && !persistedBoundaryStatuses.has(state.status)) {
    issues.push({
      code: 'invalid_persisted_status',
      path: 'persistedState.status',
      message: `persistedState.status must be one of ${Array.from(persistedBoundaryStatuses).join(', ')}`
    });
  }

  if (!Number.isInteger(snapshotSequence) || snapshotSequence < 0) {
    issues.push({
      code: 'invalid_persisted_snapshot_sequence',
      path: 'persistedState.snapshotSequence',
      message: 'persistedState.snapshotSequence must be a non-negative integer'
    });
  }

  if (!Number.isInteger(storageEpoch) || storageEpoch < 1) {
    issues.push({
      code: 'invalid_persisted_storage_epoch',
      path: 'persistedState.storageEpoch',
      message: 'persistedState.storageEpoch must be a positive integer when provided'
    });
  }

  return {
    contractVersion: asNonEmptyString(state.contractVersion) || 'truth-boundary.persisted-state.v1',
    status,
    tenantId: asNonEmptyString(state.tenantId),
    workspaceId: asNonEmptyString(state.workspaceId),
    enabled: typeof state.enabled === 'boolean' ? state.enabled : null,
    snapshotSequence: Number.isInteger(snapshotSequence) && snapshotSequence >= 0 ? snapshotSequence : 0,
    storageEpoch: Number.isInteger(storageEpoch) && storageEpoch >= 1 ? storageEpoch : 1,
    recoveredFromStorage: Object.keys(state).length > 0,
    lastEvaluatedAt: normalizeIsoTimestamp(
      state.lastEvaluatedAt,
      issues,
      'persistedState.lastEvaluatedAt',
      'invalid_persisted_last_evaluated_at'
    ),
    lastAcceptedAt: normalizeIsoTimestamp(
      state.lastAcceptedAt,
      issues,
      'persistedState.lastAcceptedAt',
      'invalid_persisted_last_accepted_at'
    ),
    lastCommand: {
      command: lifecycleCommands.has(lastCommand.command) ? lastCommand.command : null,
      idempotencyKey: asNonEmptyString(lastCommand.idempotencyKey),
      requestId: asNonEmptyString(lastCommand.requestId),
      appliedAt: normalizeIsoTimestamp(
        lastCommand.appliedAt,
        issues,
        'persistedState.lastCommand.appliedAt',
        'invalid_persisted_last_command_applied_at'
      )
    }
  };
}

function derivePersistedRecoveryPlan(persistedState, workspaceScope, clientRuntime, lifecycleCommand, now, issues) {
  const hasSnapshot = persistedState.recoveredFromStorage;
  const contractSupported = persistedState.contractVersion === 'truth-boundary.persisted-state.v1';
  const tenantMatches = !persistedState.tenantId || persistedState.tenantId === workspaceScope.tenantId;
  const workspaceMatches = !persistedState.workspaceId || persistedState.workspaceId === workspaceScope.workspaceId;
  const scopeMatches = tenantMatches && workspaceMatches;
  const evaluatedAgeMs = persistedState.lastEvaluatedAt
    ? Date.parse(now) - Date.parse(persistedState.lastEvaluatedAt)
    : null;
  const snapshotAgeSeconds = Number.isFinite(evaluatedAgeMs) && evaluatedAgeMs >= 0
    ? Math.floor(evaluatedAgeMs / 1000)
    : null;
  const staleAfterSeconds = 30 * 24 * 60 * 60;
  const stale = Boolean(snapshotAgeSeconds !== null && snapshotAgeSeconds > staleAfterSeconds);
  const commandIdempotencyKey = deriveCommandIdempotency(clientRuntime, lifecycleCommand);
  const sameCommandReplay = Boolean(
    hasSnapshot
    && persistedState.lastCommand.command === lifecycleCommand
    && (
      persistedState.lastCommand.idempotencyKey === commandIdempotencyKey
      || persistedState.lastCommand.requestId === clientRuntime.requestId
    )
  );
  const usableForRecovery = Boolean(hasSnapshot && contractSupported && scopeMatches);

  if (hasSnapshot && !contractSupported) {
    issues.push({
      code: 'unsupported_persisted_state_contract',
      path: 'persistedState.contractVersion',
      message: `persistedState contract ${persistedState.contractVersion} cannot be recovered by this truth-boundary surface`
    });
  }

  if (hasSnapshot && !tenantMatches) {
    issues.push({
      code: 'persisted_state_tenant_mismatch',
      path: 'persistedState.tenantId',
      message: `persisted snapshot tenant ${persistedState.tenantId} does not match active tenant ${workspaceScope.tenantId}; snapshot will not be reused`
    });
  }

  if (hasSnapshot && !workspaceMatches) {
    issues.push({
      code: 'persisted_state_workspace_mismatch',
      path: 'persistedState.workspaceId',
      message: `persisted snapshot workspace ${persistedState.workspaceId} does not match active workspace ${workspaceScope.workspaceId}; snapshot will not be reused`
    });
  }

  return {
    contractVersion: 'truth-boundary.persisted-recovery-plan.v1',
    generatedAt: now,
    requestId: clientRuntime.requestId,
    idempotencyKey: commandIdempotencyKey,
    lifecycleCommand,
    recoveredSnapshotPresent: hasSnapshot,
    usableForRecovery,
    restartSafe: usableForRecovery && !stale,
    recoveryState: !hasSnapshot
      ? 'cold_start'
      : !contractSupported
        ? 'ignored_unsupported_contract'
        : !scopeMatches
          ? 'ignored_scope_mismatch'
          : sameCommandReplay
            ? 'idempotent_replay'
            : stale
              ? 'recovered_stale_snapshot'
              : 'recovered_current_snapshot',
    stale,
    staleAfterSeconds,
    snapshotAgeSeconds,
    scope: {
      tenantMatches,
      workspaceMatches,
      persistedTenantId: persistedState.tenantId,
      persistedWorkspaceId: persistedState.workspaceId,
      activeTenantId: workspaceScope.tenantId,
      activeWorkspaceId: workspaceScope.workspaceId
    },
    snapshotSequence: usableForRecovery ? persistedState.snapshotSequence : 0,
    storageEpoch: persistedState.storageEpoch,
    previousStatus: usableForRecovery ? persistedState.status : 'unknown',
    previousCommand: usableForRecovery ? persistedState.lastCommand : null,
    replayDetected: usableForRecovery && sameCommandReplay
  };
}

function persistedStateForRecovery(persistedState, recoveryPlan) {
  if (recoveryPlan.usableForRecovery) return persistedState;

  return {
    ...persistedState,
    status: 'unknown',
    enabled: null,
    snapshotSequence: 0,
    recoveredFromStorage: false,
    lastEvaluatedAt: null,
    lastAcceptedAt: null,
    lastCommand: {
      command: null,
      idempotencyKey: null,
      requestId: null,
      appliedAt: null
    }
  };
}

function recoverSettingsFromPersistedState(settings, lifecycleCommand, persistedState) {
  const restartOnlyCommand = lifecycleCommand === 'inspect' || lifecycleCommand === 'schedule';
  const persistedInactive = persistedState.status === 'paused'
    || persistedState.status === 'disabled'
    || persistedState.enabled === false;

  if (!restartOnlyCommand || !persistedInactive) return settings;

  return {
    ...settings,
    enabled: false,
    recovery: {
      source: 'persistedState',
      reason: persistedState.status === 'paused'
        ? 'preserve_paused_status_after_restart'
        : 'preserve_disabled_status_after_restart',
      snapshotSequence: persistedState.snapshotSequence
    }
  };
}

function deriveCommandIdempotency(clientRuntime, lifecycleCommand) {
  return clientRuntime.idempotencyKey
    || `${surfaceId}:${clientRuntime.requestId}:${lifecycleCommand}`;
}

function deriveCommandPersistence(clientRuntime, lifecycleCommand, persistedState, now) {
  const idempotencyKey = deriveCommandIdempotency(clientRuntime, lifecycleCommand);
  const previous = persistedState.lastCommand;
  const replayed = Boolean(
    persistedState.recoveredFromStorage
    && previous.command === lifecycleCommand
    && (previous.idempotencyKey === idempotencyKey || previous.requestId === clientRuntime.requestId)
  );

  return {
    contractVersion: 'truth-boundary.command-persistence.v1',
    idempotencyKey,
    replayed,
    status: replayed ? 'replayed' : 'applied',
    restartSafe: persistedState.recoveredFromStorage,
    recoveredSnapshotSequence: persistedState.snapshotSequence,
    previousAppliedAt: replayed ? previous.appliedAt : null,
    appliedAt: replayed && previous.appliedAt ? previous.appliedAt : now
  };
}

function normalizeClientRuntime(input, issues) {
  const request = asRecord(input.request);
  const client = asRecord(input.client);
  const runtime = asRecord(input.runtime);
  const actor = asRecord(input.actor);
  const requestedAction = asNonEmptyString(request.action) || asNonEmptyString(input.action) || 'preview';
  const activeRoute = asNonEmptyString(request.routeName) || asNonEmptyString(runtime.routeName) || 'preview';
  const requestId = asNonEmptyString(request.requestId) || asNonEmptyString(runtime.requestId);
  const sessionId = asNonEmptyString(client.sessionId) || asNonEmptyString(request.sessionId);
  const clientId = asNonEmptyString(client.clientId) || asNonEmptyString(client.id) || 'hosted-kernel-client';
  const actorId = asNonEmptyString(actor.actorId) || asNonEmptyString(client.actorId) || 'anonymous';
  const returnUrl = asNonEmptyString(request.returnUrl) || asNonEmptyString(client.returnUrl);
  const originSurface = asNonEmptyString(request.originSurface) || asNonEmptyString(runtime.originSurface);

  if (!clientActions.has(requestedAction)) {
    issues.push({
      code: 'invalid_client_action',
      path: 'request.action',
      message: `request.action must be one of ${Array.from(clientActions).join(', ')}`
    });
  }

  if (!clientRouteNames.has(activeRoute)) {
    issues.push({
      code: 'invalid_client_route',
      path: 'request.routeName',
      message: `request.routeName must be one of ${Array.from(clientRouteNames).join(', ')}`
    });
  }

  if (returnUrl && !returnUrl.startsWith('/') && !returnUrl.startsWith('https://')) {
    issues.push({
      code: 'invalid_client_return_url',
      path: 'request.returnUrl',
      message: 'returnUrl must be an absolute https URL or an application-relative path'
    });
  }

  return {
    contractVersion: 'truth-boundary.client-runtime.v1',
    requestId: requestId || `${surfaceId}:request:local`,
    correlationId: asNonEmptyString(request.correlationId) || requestId || `${surfaceId}:correlation:local`,
    clientId,
    sessionId,
    actor: {
      actorId,
      role: asNonEmptyString(actor.role) || asNonEmptyString(client.role) || 'operator'
    },
    requestedAction: clientActions.has(requestedAction) ? requestedAction : 'preview',
    activeRoute: clientRouteNames.has(activeRoute) ? activeRoute : 'preview',
    originSurface,
    returnUrl,
    idempotencyKey: asNonEmptyString(request.idempotencyKey) || null
  };
}

function normalizeSyncMetadata(provider, issues, path) {
  const sync = asRecord(provider.sync);
  const failure = asRecord(sync.failure ?? sync.lastError);
  const status = providerSyncStatuses.has(sync.status) ? sync.status : 'unknown';
  const lastSyncedAt = asNonEmptyString(sync.lastSyncedAt);
  const retryAttempt = sync.retryAttempt === undefined ? 0 : sync.retryAttempt;
  const retryAfterSeconds = sync.retryAfterSeconds === undefined || sync.retryAfterSeconds === null
    ? null
    : sync.retryAfterSeconds;

  if (sync.status !== undefined && !providerSyncStatuses.has(sync.status)) {
    issues.push({
      code: 'invalid_provider_sync_status',
      path: `${path}.sync.status`,
      message: `provider sync status must be one of ${Array.from(providerSyncStatuses).join(', ')}`
    });
  }

  if (lastSyncedAt && Number.isNaN(Date.parse(lastSyncedAt))) {
    issues.push({
      code: 'invalid_provider_sync_timestamp',
      path: `${path}.sync.lastSyncedAt`,
      message: 'provider sync lastSyncedAt must be an ISO-8601 timestamp when provided'
    });
  }

  if (!Number.isInteger(retryAttempt) || retryAttempt < 0 || retryAttempt > 12) {
    issues.push({
      code: 'invalid_provider_sync_retry_attempt',
      path: `${path}.sync.retryAttempt`,
      message: 'provider sync retryAttempt must be an integer from 0 to 12'
    });
  }

  if (retryAfterSeconds !== null && (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400)) {
    issues.push({
      code: 'invalid_provider_sync_retry_after',
      path: `${path}.sync.retryAfterSeconds`,
      message: 'provider sync retryAfterSeconds must be null or an integer from 0 to 86400'
    });
  }

  return {
    status,
    cursor: asNonEmptyString(sync.cursor),
    lastSyncedAt: lastSyncedAt && !Number.isNaN(Date.parse(lastSyncedAt))
      ? new Date(lastSyncedAt).toISOString()
      : null,
    retryAfterSeconds: Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0 && retryAfterSeconds <= 86400
      ? retryAfterSeconds
      : null,
    retryAttempt: Number.isInteger(retryAttempt) && retryAttempt >= 0 && retryAttempt <= 12 ? retryAttempt : 0,
    failure: {
      code: asNonEmptyString(failure.code) || (status === 'failed' ? 'provider_sync_failed' : null),
      message: asNonEmptyString(failure.message) || (status === 'failed' ? 'provider sync failed before truth-boundary evaluation' : null),
      action: asNonEmptyString(failure.action) || null
    }
  };
}

function normalizeProviderServiceContract(record, issues, path) {
  const serviceContract = asRecord(record.serviceContract ?? record.contract);
  const endpoint = asRecord(serviceContract.endpoint ?? record.endpoint);
  const auth = asRecord(serviceContract.auth ?? record.auth);
  const baseUrl = asNonEmptyString(serviceContract.baseUrl)
    || asNonEmptyString(endpoint.baseUrl)
    || asNonEmptyString(record.endpointUrl);
  const callbackUrl = asNonEmptyString(serviceContract.callbackUrl)
    || asNonEmptyString(endpoint.callbackUrl)
    || asNonEmptyString(record.callbackUrl);
  const authScheme = providerAuthSchemes.has(auth.scheme) ? auth.scheme : 'none';

  if (baseUrl && !baseUrl.startsWith('https://')) {
    issues.push({
      code: 'invalid_provider_service_base_url',
      path: `${path}.serviceContract.baseUrl`,
      message: 'provider service baseUrl must be an https URL when provided'
    });
  }

  if (callbackUrl && !callbackUrl.startsWith('https://') && !callbackUrl.startsWith('/')) {
    issues.push({
      code: 'invalid_provider_service_callback_url',
      path: `${path}.serviceContract.callbackUrl`,
      message: 'provider service callbackUrl must be an https URL or application-relative path when provided'
    });
  }

  if (auth.scheme !== undefined && !providerAuthSchemes.has(auth.scheme)) {
    issues.push({
      code: 'invalid_provider_auth_scheme',
      path: `${path}.serviceContract.auth.scheme`,
      message: `provider auth scheme must be one of ${Array.from(providerAuthSchemes).join(', ')}`
    });
  }

  return {
    contractVersion: 'truth-boundary.provider-service-contract.v1',
    protocol: asNonEmptyString(serviceContract.protocol) || 'https',
    baseUrl: baseUrl && baseUrl.startsWith('https://') ? baseUrl : null,
    callbackUrl: callbackUrl && (callbackUrl.startsWith('https://') || callbackUrl.startsWith('/')) ? callbackUrl : null,
    auth: {
      scheme: authScheme,
      audience: asNonEmptyString(auth.audience),
      serviceAccountId: asNonEmptyString(auth.serviceAccountId)
    }
  };
}

function normalizeProviderContracts(input, issues, workspaceScope) {
  const contracts = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.providers)
      ? input.providers
      : [];

  return contracts.map((provider, index) => {
    const record = asRecord(provider);
    const path = `providerContracts[${index}]`;
    const providerId = asNonEmptyString(record.providerId) || asNonEmptyString(record.id);
    const service = asNonEmptyString(record.service) || asNonEmptyString(record.providerService);
    const offeredCapabilities = normalizeStringList(record.capabilities);
    const requiredCapabilities = normalizeStringList(record.requiredCapabilities);
    const unsupportedRequired = requiredCapabilities.filter((capability) => !supportedProviderCapabilities.has(capability));
    const acceptedCapabilities = offeredCapabilities.filter((capability) => supportedProviderCapabilities.has(capability));
    const tenantId = asNonEmptyString(record.tenantId) || workspaceScope.tenantId;
    const workspaceId = asNonEmptyString(record.workspaceId) || workspaceScope.workspaceId;
    const tenantMatches = tenantId === workspaceScope.tenantId;
    const workspaceMatches = workspaceId === workspaceScope.workspaceId;

    if (!providerId) {
      issues.push({
        code: 'missing_provider_id',
        path: `${path}.providerId`,
        message: 'provider contract requires a providerId'
      });
    }

    if (!service) {
      issues.push({
        code: 'missing_provider_service',
        path: `${path}.service`,
        message: 'provider contract requires a service name'
      });
    }

    if (unsupportedRequired.length > 0) {
      issues.push({
        code: 'unsupported_required_provider_capability',
        path: `${path}.requiredCapabilities`,
        message: `unsupported required capabilities: ${unsupportedRequired.join(', ')}`
      });
    }

    if (workspaceScope.strictTenantIsolation && !tenantMatches) {
      issues.push({
        code: 'cross_tenant_provider_contract_rejected',
        path: `${path}.tenantId`,
        message: `provider tenant ${tenantId} does not match active tenant ${workspaceScope.tenantId}`
      });
    }

    if (!workspaceMatches) {
      issues.push({
        code: 'cross_workspace_provider_contract_rejected',
        path: `${path}.workspaceId`,
        message: `provider workspace ${workspaceId} does not match active workspace ${workspaceScope.workspaceId}`
      });
    }

    return {
      providerId: providerId || `provider-${index + 1}`,
      tenantId,
      workspaceId,
      scopeStatus: tenantMatches && workspaceMatches ? 'accepted' : 'rejected',
      service: service || 'unspecified',
      contractVersion: asNonEmptyString(record.contractVersion) || 'provider.truth-boundary.v1',
      required: record.required === true,
      mode: record.mode === 'externalHandoff' ? 'externalHandoff' : 'inline',
      capabilities: {
        offered: offeredCapabilities,
        accepted: acceptedCapabilities,
        required: requiredCapabilities,
        unsupportedRequired
      },
      sync: normalizeSyncMetadata(record, issues, path),
      serviceContract: normalizeProviderServiceContract(record, issues, path),
      externalHandoffRef: asNonEmptyString(record.externalHandoffRef)
    };
  });
}

function negotiateProviderCapabilities(providerContracts) {
  const requiredProviders = providerContracts.filter((provider) => provider.required);
  const outOfScopeProviders = providerContracts.filter((provider) => provider.scopeStatus !== 'accepted');
  const unsatisfiedProviders = providerContracts.filter((provider) => (
    provider.scopeStatus !== 'accepted'
    || provider.capabilities.unsupportedRequired.length > 0
    || provider.capabilities.required.some((capability) => !provider.capabilities.accepted.includes(capability))
  ));
  const staleProviders = providerContracts.filter((provider) => provider.sync.status === 'stale' || provider.sync.status === 'failed');

  return {
    supportedCapabilities: Array.from(supportedProviderCapabilities),
    providerCount: providerContracts.length,
    requiredProviderCount: requiredProviders.length,
    acceptedProviderCount: providerContracts.length - unsatisfiedProviders.length,
    unsatisfiedProviderIds: unsatisfiedProviders.map((provider) => provider.providerId),
    outOfScopeProviderIds: outOfScopeProviders.map((provider) => provider.providerId),
    staleProviderIds: staleProviders.map((provider) => provider.providerId),
    decision: unsatisfiedProviders.length === 0 ? 'accepted' : 'requires_provider_update'
  };
}

function deriveExternalHandoffState(lifecycle, providerContracts, capabilityNegotiation, now) {
  const handoffProviders = providerContracts.filter((provider) => (
    provider.mode === 'externalHandoff'
    || provider.capabilities.accepted.includes('handoff.create')
    || provider.externalHandoffRef
  ));
  const blockedByProvider = capabilityNegotiation.decision !== 'accepted';
  const needsHandoff = lifecycle.blocked || blockedByProvider || handoffProviders.length > 0;

  return {
    required: needsHandoff,
    state: !needsHandoff
      ? 'not_required'
      : blockedByProvider
        ? 'provider_contract_blocked'
        : lifecycle.blocked
          ? 'awaiting_verified_evidence'
          : 'ready',
    providerIds: handoffProviders.map((provider) => provider.providerId),
    handoffRefs: handoffProviders.map((provider) => provider.externalHandoffRef).filter(Boolean),
    generatedAt: now
  };
}

function normalizeExternalHandoffReceipts(input, providerContracts, workspaceScope, issues) {
  const receipts = Array.isArray(input.externalHandoffs)
    ? input.externalHandoffs
    : Array.isArray(input.handoffReceipts)
      ? input.handoffReceipts
      : [];
  const providerIds = new Set(providerContracts.map((provider) => provider.providerId));

  return receipts.map((receipt, index) => {
    const record = asRecord(receipt);
    const path = `externalHandoffs[${index}]`;
    const providerId = asNonEmptyString(record.providerId);
    const handoffId = asNonEmptyString(record.handoffId) || asNonEmptyString(record.id);
    const status = handoffReceiptStatuses.has(record.status) ? record.status : 'draft';
    const tenantId = asNonEmptyString(record.tenantId) || workspaceScope.tenantId;
    const workspaceId = asNonEmptyString(record.workspaceId) || workspaceScope.workspaceId;
    const tenantMatches = tenantId === workspaceScope.tenantId;
    const workspaceMatches = workspaceId === workspaceScope.workspaceId;
    const dispatchedAt = normalizeIsoTimestamp(
      record.dispatchedAt ?? record.sentAt,
      issues,
      `${path}.dispatchedAt`,
      'invalid_handoff_dispatched_at'
    );
    const acknowledgedAt = normalizeIsoTimestamp(
      record.acknowledgedAt,
      issues,
      `${path}.acknowledgedAt`,
      'invalid_handoff_acknowledged_at'
    );
    const expiresAt = normalizeIsoTimestamp(
      record.expiresAt,
      issues,
      `${path}.expiresAt`,
      'invalid_handoff_expires_at'
    );

    if (!handoffId) {
      issues.push({
        code: 'missing_handoff_id',
        path: `${path}.handoffId`,
        message: 'external handoff receipts require a handoffId'
      });
    }

    if (!providerId) {
      issues.push({
        code: 'missing_handoff_provider_id',
        path: `${path}.providerId`,
        message: 'external handoff receipts require a providerId'
      });
    } else if (!providerIds.has(providerId)) {
      issues.push({
        code: 'unknown_handoff_provider',
        path: `${path}.providerId`,
        message: `handoff provider ${providerId} is not present in providerContracts`
      });
    }

    if (record.status !== undefined && !handoffReceiptStatuses.has(record.status)) {
      issues.push({
        code: 'invalid_handoff_receipt_status',
        path: `${path}.status`,
        message: `external handoff status must be one of ${Array.from(handoffReceiptStatuses).join(', ')}`
      });
    }

    if (workspaceScope.strictTenantIsolation && !tenantMatches) {
      issues.push({
        code: 'cross_tenant_handoff_receipt_rejected',
        path: `${path}.tenantId`,
        message: `handoff tenant ${tenantId} does not match active tenant ${workspaceScope.tenantId}`
      });
    }

    if (!workspaceMatches) {
      issues.push({
        code: 'cross_workspace_handoff_receipt_rejected',
        path: `${path}.workspaceId`,
        message: `handoff workspace ${workspaceId} does not match active workspace ${workspaceScope.workspaceId}`
      });
    }

    return {
      contractVersion: 'truth-boundary.external-handoff-receipt.v1',
      index,
      handoffId: handoffId || `handoff-${index + 1}`,
      providerId: providerId || 'unspecified',
      tenantId,
      workspaceId,
      scopeStatus: tenantMatches && workspaceMatches ? 'accepted' : 'rejected',
      status,
      dispatchedAt,
      acknowledgedAt,
      expiresAt,
      continuationToken: asNonEmptyString(record.continuationToken),
      remoteDecisionId: asNonEmptyString(record.remoteDecisionId),
      failureCode: asNonEmptyString(record.failureCode) || asNonEmptyString(asRecord(record.failure).code),
      failureMessage: asNonEmptyString(record.failureMessage) || asNonEmptyString(asRecord(record.failure).message)
    };
  });
}

function providerOperationState(provider, capability) {
  if (provider.scopeStatus !== 'accepted') return 'blocked_scope';
  if (provider.capabilities.unsupportedRequired.includes(capability)) return 'blocked_unsupported';
  if (!provider.capabilities.accepted.includes(capability)) return 'blocked_missing_capability';
  if (provider.sync.status === 'failed') return provider.required ? 'blocked_sync_failed' : 'degraded_sync_failed';
  if (provider.sync.status === 'stale') return 'waiting_for_fresh_sync';
  if (provider.sync.status === 'pending') return 'waiting_for_sync';
  if (provider.sync.status === 'current') return 'ready';
  return 'ready_unconfirmed';
}

function deriveProviderServicePlan(providerContracts, capabilityNegotiation, externalHandoff, now) {
  const operations = providerContracts.flatMap((provider) => {
    const plannedCapabilities = Array.from(new Set(provider.capabilities.required.concat(provider.capabilities.accepted)));
    return plannedCapabilities.map((capability) => {
      const operation = providerCapabilityOperations[capability] || {
        operationId: capability.replaceAll('.', '_'),
        direction: 'unknown',
        method: 'POST',
        route: '/provider-capability'
      };
      const state = providerOperationState(provider, capability);

      return {
        contractVersion: 'truth-boundary.provider-operation.v1',
        providerId: provider.providerId,
        service: provider.service,
        capability,
        operationId: operation.operationId,
        direction: operation.direction,
        method: operation.method,
        route: operation.route,
        required: provider.required || provider.capabilities.required.includes(capability),
        state,
        callable: state === 'ready' || state === 'ready_unconfirmed',
        syncStatus: provider.sync.status,
        endpointBaseUrl: provider.serviceContract.baseUrl,
        callbackUrl: provider.serviceContract.callbackUrl,
        authScheme: provider.serviceContract.auth.scheme
      };
    });
  });
  const blockedRequiredOperations = operations.filter((operation) => operation.required && operation.state.startsWith('blocked_'));
  const waitingOperations = operations.filter((operation) => operation.state.startsWith('waiting_'));
  const handoffOperations = operations.filter((operation) => operation.capability === 'handoff.create');

  return {
    contractVersion: 'truth-boundary.provider-service-plan.v1',
    generatedAt: now,
    decision: capabilityNegotiation.decision !== 'accepted' || blockedRequiredOperations.length > 0
      ? 'blocked'
      : waitingOperations.length > 0
        ? 'waiting_for_sync'
        : 'ready',
    operationCount: operations.length,
    readyOperationCount: operations.filter((operation) => operation.callable).length,
    blockedRequiredOperationIds: blockedRequiredOperations.map((operation) => `${operation.providerId}:${operation.operationId}`),
    waitingOperationIds: waitingOperations.map((operation) => `${operation.providerId}:${operation.operationId}`),
    handoffDispatch: {
      state: externalHandoff.required
        ? handoffOperations.some((operation) => operation.callable)
          ? 'dispatchable'
          : 'awaiting_provider_operation'
        : 'not_required',
      providerIds: handoffOperations.map((operation) => operation.providerId),
      operationIds: handoffOperations.map((operation) => operation.operationId)
    },
    operations
  };
}

function deriveExternalHandoffExchange(externalHandoff, handoffReceipts, providerServicePlan, workflowSeed, now) {
  const handoffOperations = providerServicePlan.operations.filter((operation) => operation.capability === 'handoff.create');
  const dispatchableOperations = handoffOperations.filter((operation) => operation.callable);
  const scopedReceipts = handoffReceipts.filter((receipt) => receipt.scopeStatus === 'accepted');
  const acknowledgedReceipts = scopedReceipts.filter((receipt) => receipt.status === 'acknowledged');
  const pendingReceipts = scopedReceipts.filter((receipt) => receipt.status === 'queued' || receipt.status === 'sent');
  const failedReceipts = scopedReceipts.filter((receipt) => receipt.status === 'failed' || receipt.status === 'expired');
  const providerIdsWithReceipts = new Set(scopedReceipts.map((receipt) => receipt.providerId));
  const missingProviderIds = externalHandoff.providerIds.filter((providerId) => !providerIdsWithReceipts.has(providerId));
  const dispatchRequests = dispatchableOperations
    .filter((operation) => externalHandoff.providerIds.length === 0 || externalHandoff.providerIds.includes(operation.providerId))
    .map((operation) => ({
      contractVersion: 'truth-boundary.external-handoff-dispatch.v1',
      providerId: operation.providerId,
      operationId: operation.operationId,
      method: operation.method,
      route: operation.route,
      endpointBaseUrl: operation.endpointBaseUrl,
      callbackUrl: operation.callbackUrl,
      authScheme: operation.authScheme,
      idempotencyKey: `${surfaceId}:${workflowSeed}:${operation.providerId}:${operation.operationId}`,
      payloadContractVersion: 'truth-boundary.external-handoff-payload.v1',
      payload: {
        surfaceId,
        generatedAt: now,
        continuationToken: `${surfaceId}:${workflowSeed}:handoff:${operation.providerId}`,
        providerId: operation.providerId,
        requiredAckStatus: 'acknowledged'
      }
    }));
  const state = !externalHandoff.required
    ? 'not_required'
    : acknowledgedReceipts.length > 0
      ? 'acknowledged'
      : failedReceipts.length > 0 && dispatchableOperations.length === 0
        ? 'failed_requires_operator'
        : pendingReceipts.length > 0
          ? 'awaiting_ack'
          : dispatchRequests.length > 0
            ? 'ready_to_dispatch'
            : 'blocked_no_dispatch_provider';

  return {
    contractVersion: 'truth-boundary.external-handoff-exchange.v1',
    generatedAt: now,
    required: externalHandoff.required,
    state,
    receiptCount: handoffReceipts.length,
    acknowledgedReceiptIds: acknowledgedReceipts.map((receipt) => receipt.handoffId),
    pendingReceiptIds: pendingReceipts.map((receipt) => receipt.handoffId),
    failedReceiptIds: failedReceipts.map((receipt) => receipt.handoffId),
    missingProviderIds,
    dispatchRequestCount: dispatchRequests.length,
    dispatchableProviderIds: dispatchRequests.map((request) => request.providerId),
    dispatchRequests,
    receipts: handoffReceipts
  };
}

function normalizeClientHandoffSubmission(input, clientRuntime, workspaceScope, externalHandoffExchange, persistedStateUpdate, issues, now) {
  const request = asRecord(input.request);
  const handoff = asRecord(input.handoffRequest ?? input.clientHandoff ?? request.handoff);
  const explicitDispatchIds = normalizeStringList(handoff.dispatchRequestIds ?? handoff.dispatchRequests);
  const explicitProviderIds = normalizeStringList(handoff.providerIds);
  const requestedProviderIds = explicitProviderIds.length > 0
    ? explicitProviderIds
    : externalHandoffExchange.dispatchableProviderIds;
  const knownDispatchIds = new Set(externalHandoffExchange.dispatchRequests.map((dispatch) => dispatch.idempotencyKey));
  const dispatchIds = explicitDispatchIds.length > 0
    ? explicitDispatchIds
    : externalHandoffExchange.dispatchRequests
        .filter((dispatch) => requestedProviderIds.includes(dispatch.providerId))
        .map((dispatch) => dispatch.idempotencyKey);
  const snapshotSequence = handoff.snapshotSequence ?? request.snapshotSequence ?? persistedStateUpdate.snapshotSequence;
  const continuationToken = asNonEmptyString(handoff.continuationToken) || asNonEmptyString(request.continuationToken);
  const returnRoute = asNonEmptyString(handoff.returnRoute) || asNonEmptyString(request.returnRoute) || clientRuntime.activeRoute;
  const unknownDispatchIds = dispatchIds.filter((id) => !knownDispatchIds.has(id));
  const unknownProviderIds = requestedProviderIds.filter((providerId) => (
    !externalHandoffExchange.dispatchableProviderIds.includes(providerId)
  ));
  const hasSubmittedPayload = Object.keys(handoff).length > 0 || clientRuntime.requestedAction === 'createHandoff';
  const readyForSubmit = externalHandoffExchange.state === 'ready_to_dispatch'
    || externalHandoffExchange.state === 'failed_requires_operator';
  const snapshotMatches = snapshotSequence === persistedStateUpdate.snapshotSequence;
  const continuationMatches = !continuationToken
    || continuationToken === `${surfaceId}:${clientRuntime.correlationId}:handoffs`;
  const sessionBound = Boolean(clientRuntime.sessionId);
  const accepted = Boolean(
    hasSubmittedPayload
    && readyForSubmit
    && snapshotMatches
    && continuationMatches
    && sessionBound
    && dispatchIds.length > 0
    && unknownDispatchIds.length === 0
    && unknownProviderIds.length === 0
  );

  if (hasSubmittedPayload && !readyForSubmit) {
    issues.push({
      code: 'handoff_submission_not_ready',
      path: 'handoffRequest',
      message: `handoff submission cannot be accepted while exchange state is ${externalHandoffExchange.state}`
    });
  }

  if (hasSubmittedPayload && !snapshotMatches) {
    issues.push({
      code: 'stale_handoff_snapshot_sequence',
      path: 'handoffRequest.snapshotSequence',
      message: `handoff snapshotSequence must match current snapshot ${persistedStateUpdate.snapshotSequence}`
    });
  }

  if (hasSubmittedPayload && !continuationMatches) {
    issues.push({
      code: 'invalid_handoff_continuation_token',
      path: 'handoffRequest.continuationToken',
      message: 'handoff continuationToken must match the current handoff workflow continuation'
    });
  }

  if (hasSubmittedPayload && !sessionBound) {
    issues.push({
      code: 'missing_handoff_session',
      path: 'client.sessionId',
      message: 'handoff submission requires a client.sessionId so receipts can be bound to the hosted-kernel session'
    });
  }

  if (hasSubmittedPayload && dispatchIds.length === 0) {
    issues.push({
      code: 'missing_handoff_dispatch_request',
      path: 'handoffRequest.dispatchRequestIds',
      message: 'handoff submission requires at least one current dispatch request id'
    });
  }

  if (unknownDispatchIds.length > 0) {
    issues.push({
      code: 'unknown_handoff_dispatch_request',
      path: 'handoffRequest.dispatchRequestIds',
      message: `handoff dispatch request(s) are not current: ${unknownDispatchIds.join(', ')}`
    });
  }

  if (unknownProviderIds.length > 0) {
    issues.push({
      code: 'handoff_provider_not_dispatchable',
      path: 'handoffRequest.providerIds',
      message: `handoff provider(s) are not dispatchable in the current exchange: ${unknownProviderIds.join(', ')}`
    });
  }

  return {
    contractVersion: 'truth-boundary.client-handoff-submission.v1',
    generatedAt: now,
    present: hasSubmittedPayload,
    accepted,
    state: !hasSubmittedPayload
      ? 'not_submitted'
      : accepted
        ? 'accepted_for_dispatch'
        : readyForSubmit
          ? 'needs_client_correction'
          : 'blocked_by_exchange_state',
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    actorId: clientRuntime.actor.actorId,
    clientId: clientRuntime.clientId,
    sessionId: clientRuntime.sessionId,
    routeName: 'handoffs',
    method: 'POST',
    href: hrefForRoute('handoffs'),
    snapshotSequence,
    expectedSnapshotSequence: persistedStateUpdate.snapshotSequence,
    continuationToken,
    expectedContinuationToken: `${surfaceId}:${clientRuntime.correlationId}:handoffs`,
    returnRoute: clientRouteNames.has(returnRoute) ? returnRoute : 'preview',
    requestedProviderIds,
    dispatchRequestIds: dispatchIds,
    unknownDispatchIds,
    unknownProviderIds,
    receiptSeed: accepted
      ? `${surfaceId}:${workspaceScope.tenantId}:${workspaceScope.workspaceId}:${persistedStateUpdate.snapshotSequence}:receipt`
      : null,
    receiptContract: {
      contractVersion: 'truth-boundary.external-handoff-receipt.v1',
      requiredFields: ['handoffId', 'providerId', 'status', 'tenantId', 'workspaceId', 'continuationToken'],
      allowedStatuses: Array.from(handoffReceiptStatuses),
      expectedTenantId: workspaceScope.tenantId,
      expectedWorkspaceId: workspaceScope.workspaceId,
      expectedContinuationToken: `${surfaceId}:${clientRuntime.correlationId}:handoffs`
    }
  };
}

function calculateProviderBackoff(sync) {
  if (Number.isInteger(sync.retryAfterSeconds)) return sync.retryAfterSeconds;
  if (sync.status === 'stale') return 300;
  if (sync.status === 'pending') return 60;
  if (sync.status !== 'failed') return null;
  return Math.min(3600, 30 * (2 ** sync.retryAttempt));
}

function providerSyncAgeSeconds(sync, now) {
  if (!sync.lastSyncedAt) return null;
  const ageMs = Date.parse(now) - Date.parse(sync.lastSyncedAt);
  return Number.isFinite(ageMs) && ageMs >= 0 ? Math.floor(ageMs / 1000) : null;
}

function providerRequiresOutboundEndpoint(provider) {
  return provider.required && provider.capabilities.required.some((capability) => (
    providerCapabilityOperations[capability]?.direction === 'outbound'
  ));
}

function deriveProviderHealthFinding(provider, capabilityNegotiation, now) {
  const ageSeconds = providerSyncAgeSeconds(provider.sync, now);
  const freshnessBudgetSeconds = providerFreshnessBudgetsSeconds[provider.sync.status] ?? null;
  const freshnessExpired = Boolean(
    freshnessBudgetSeconds !== null
    && ageSeconds !== null
    && ageSeconds > freshnessBudgetSeconds
  );
  const missingOutboundEndpoint = providerRequiresOutboundEndpoint(provider)
    && !provider.serviceContract.baseUrl;
  const hasUnsupportedRequired = provider.capabilities.unsupportedRequired.length > 0
    || capabilityNegotiation.unsatisfiedProviderIds.includes(provider.providerId);
  const retryAfterSeconds = calculateProviderBackoff(provider.sync);
  const base = {
    contractVersion: 'truth-boundary.provider-health-finding.v1',
    providerId: provider.providerId,
    service: provider.service,
    required: provider.required,
    syncStatus: provider.sync.status,
    retryAttempt: provider.sync.retryAttempt,
    retryAfterSeconds,
    syncAgeSeconds: ageSeconds,
    freshnessBudgetSeconds,
    staleByAge: freshnessExpired,
    failureCode: provider.sync.failure.code,
    failureMessage: provider.sync.failure.message,
    endpointBaseUrl: provider.serviceContract.baseUrl,
    mode: provider.mode
  };

  if (provider.scopeStatus !== 'accepted') {
    return {
      ...base,
      state: 'configuration_blocked',
      severity: 'error',
      retryable: false,
      decisionImpact: 'blocks_acceptance',
      action: 'move the provider contract into the active tenant workspace or remove it from this evaluation'
    };
  }

  if (hasUnsupportedRequired) {
    return {
      ...base,
      state: 'configuration_blocked',
      severity: 'error',
      retryable: false,
      decisionImpact: 'blocks_acceptance',
      action: 'update requiredCapabilities to a supported truth-boundary provider capability set'
    };
  }

  if (missingOutboundEndpoint) {
    return {
      ...base,
      state: 'configuration_blocked',
      severity: 'error',
      retryable: false,
      decisionImpact: 'blocks_acceptance',
      action: 'configure serviceContract.baseUrl for required outbound provider operations'
    };
  }

  if (provider.sync.status === 'failed') {
    return {
      ...base,
      state: provider.required ? 'hard_failed' : 'degraded_failed',
      severity: provider.required ? 'error' : 'warning',
      retryable: true,
      decisionImpact: provider.required ? 'blocks_acceptance' : 'degraded_preview',
      action: provider.sync.failure.action || (
        provider.required
          ? 'restore provider sync before accepting the truth boundary'
          : 'retry provider sync; preview can continue in degraded mode'
      )
    };
  }

  if (provider.sync.status === 'pending') {
    return {
      ...base,
      state: 'retry_pending',
      severity: provider.required ? 'warning' : 'info',
      retryable: true,
      decisionImpact: provider.required ? 'awaits_provider_freshness' : 'degraded_preview',
      action: 'wait for the current provider sync attempt or retry after the backoff window'
    };
  }

  if (provider.sync.status === 'stale' || freshnessExpired) {
    return {
      ...base,
      state: freshnessExpired ? 'freshness_budget_exceeded' : 'stale',
      severity: provider.required ? 'warning' : 'info',
      retryable: true,
      decisionImpact: provider.required ? 'requires_operator_review' : 'degraded_preview',
      action: 'refresh provider sync before relying on this provider for acceptance'
    };
  }

  if (provider.sync.status === 'unknown') {
    return {
      ...base,
      state: 'unconfirmed',
      severity: provider.required ? 'warning' : 'info',
      retryable: false,
      decisionImpact: provider.required ? 'requires_operator_review' : 'none',
      action: 'record a provider sync status so the hosted kernel can prove freshness'
    };
  }

  return {
    ...base,
    state: 'healthy',
    severity: 'info',
    retryable: false,
    decisionImpact: 'none',
    action: null
  };
}

function addMinutesIso(timestamp, minutes) {
  return new Date(Date.parse(timestamp) + (minutes * 60 * 1000)).toISOString();
}

function deriveScheduleControl(command, settings, issues, now) {
  const schedule = settings.schedule;
  const nowMs = Date.parse(now);
  const configuredNextRunMs = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : null;
  const intervalReadyAt = schedule.mode === 'interval' && Number.isInteger(schedule.intervalMinutes)
    ? addMinutesIso(now, schedule.intervalMinutes)
    : null;
  const nextRunAt = schedule.mode === 'interval'
    ? configuredNextRunMs && configuredNextRunMs > nowMs
      ? schedule.nextRunAt
      : intervalReadyAt
    : null;
  const armed = Boolean(settings.enabled && schedule.mode !== 'manual' && (schedule.mode === 'onEvidenceChange' || nextRunAt));

  if (command === 'schedule' && !settings.enabled) {
    issues.push({
      code: 'schedule_saved_while_boundary_disabled',
      path: 'settings.enabled',
      message: 'schedule command saved schedule settings but will not run until the boundary is enabled'
    });
  }

  if (command === 'schedule' && schedule.mode === 'manual') {
    issues.push({
      code: 'manual_schedule_requires_operator_run',
      path: 'settings.schedule.mode',
      message: 'manual schedule mode cannot arm an automatic lifecycle run'
    });
  }

  if (command === 'schedule' && schedule.mode === 'onEvidenceChange' && !settings.requireEvidence) {
    issues.push({
      code: 'evidence_change_schedule_without_evidence_requirement',
      path: 'settings.requireEvidence',
      message: 'onEvidenceChange scheduling is advisory when requireEvidence is false'
    });
  }

  return {
    contractVersion: 'truth-boundary.schedule-control.v1',
    mode: schedule.mode,
    armed,
    trigger: schedule.mode === 'onEvidenceChange' ? 'evidence_change' : schedule.mode,
    intervalMinutes: schedule.intervalMinutes,
    nextRunAt,
    overdue: Boolean(schedule.mode === 'interval' && configuredNextRunMs && configuredNextRunMs <= nowMs),
    commandEffect: command === 'schedule'
      ? schedule.mode === 'manual'
        ? 'saved_manual_schedule'
        : armed
          ? 'armed'
          : settings.enabled
            ? 'rejected_invalid_schedule'
          : 'saved_disabled'
      : 'observed'
  };
}

function deriveLifecycleTransition(command, settings, persistedState, scheduleControl) {
  const previousStatus = persistedState.recoveredFromStorage ? persistedState.status : 'unknown';
  const requestedEnabled = command === 'enable' || command === 'resume'
    ? true
    : command === 'disable' || command === 'pause'
      ? false
      : settings.enabled;
  const controlState = command === 'disable'
    ? 'disabled'
    : command === 'pause'
      ? 'paused'
      : !requestedEnabled
        ? 'inactive'
        : command === 'schedule' && scheduleControl.armed
          ? 'scheduled'
          : 'monitoring';
  const transition = `${previousStatus}->${controlState}`;

  return {
    contractVersion: 'truth-boundary.lifecycle-transition.v1',
    previousStatus,
    command,
    transition,
    controlState,
    requestedEnabled,
    enablementChanged: persistedState.enabled === null ? null : persistedState.enabled !== requestedEnabled,
    scheduleArmed: scheduleControl.armed,
    operatorControllable: true
  };
}

function deriveOperationalHealth(providerContracts, capabilityNegotiation, accessPolicy, now) {
  const providerFindings = providerContracts.map((provider) => deriveProviderHealthFinding(
    provider,
    capabilityNegotiation,
    now
  ));
  const unhealthyFindings = providerFindings.filter((finding) => finding.state !== 'healthy');
  const blockingFindings = unhealthyFindings.filter((finding) => (
    finding.severity === 'error'
    && finding.decisionImpact === 'blocks_acceptance'
  ));
  const degradedFindings = unhealthyFindings.filter((finding) => finding.severity !== 'error');
  const retryableProviders = unhealthyFindings
    .filter((finding) => finding.retryable)
    .map((finding) => ({
      providerId: finding.providerId,
      service: finding.service,
      required: finding.required,
      syncStatus: finding.syncStatus,
      healthState: finding.state,
      retryAttempt: finding.retryAttempt,
      retryAfterSeconds: finding.retryAfterSeconds,
      failureCode: finding.failureCode,
      action: finding.action
    }));
  const nextRetryAfterSeconds = retryableProviders
    .map((provider) => provider.retryAfterSeconds)
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right)[0] ?? null;
  const failureState = blockingFindings.length > 0
    ? 'blocked'
    : unhealthyFindings.length > 0
      ? 'degraded'
      : capabilityNegotiation.decision !== 'accepted'
        ? 'configuration_blocked'
        : 'healthy';
  const degradedModeAllowed = failureState === 'degraded' && accessPolicy.requestedAction !== 'accept';

  return {
    contractVersion: 'truth-boundary.operational-health.v1',
    evaluatedAt: now,
    status: failureState === 'healthy' ? 'healthy' : failureState,
    degradedMode: degradedModeAllowed,
    decisionImpact: failureState === 'blocked'
      ? 'blocks_acceptance'
      : failureState === 'degraded'
        ? degradedModeAllowed
          ? 'allows_preview_requires_operator_attention'
          : 'acceptance_requires_fresh_provider_health'
        : failureState === 'configuration_blocked'
          ? 'blocked_by_provider_contract'
          : 'none',
    failureState: {
      state: failureState,
      blockingProviderIds: blockingFindings.map((finding) => finding.providerId),
      degradedProviderIds: degradedFindings.map((finding) => finding.providerId),
      degradedModeAllowed,
      requestedAction: accessPolicy.requestedAction
    },
    retry: {
      recommended: retryableProviders.length > 0,
      nextRetryAfterSeconds,
      providers: retryableProviders
    },
    providerFindings,
    actionableErrors: blockingFindings.map((finding) => ({
      code: finding.failureCode || (
        finding.state === 'configuration_blocked'
          ? 'provider_health_configuration_blocked'
          : 'required_provider_unavailable'
      ),
      path: `providerContracts.${finding.providerId}.sync`,
      severity: 'error',
      message: finding.failureMessage || `${finding.providerId} health state ${finding.state} blocks truth-boundary acceptance`,
      action: finding.action
    })),
    accessState: accessPolicy.decision,
    unhealthyProviderIds: unhealthyFindings.map((finding) => finding.providerId),
    requiredFailureProviderIds: blockingFindings.map((finding) => finding.providerId)
  };
}

function deriveLifecycleState(command, settings, evidence, issues, now, commandPersistence, persistedState) {
  const verifiedEvidenceCount = evidence.filter((item) => item.verified && item.inScope !== false).length;
  const hasEnoughEvidence = verifiedEvidenceCount >= settings.minimumEvidenceItems;
  const disabledByCommand = command === 'disable';
  const pausedByCommand = command === 'pause';
  const enabledByCommand = command === 'enable' || command === 'resume' ? true : settings.enabled;
  const active = enabledByCommand && !disabledByCommand && !pausedByCommand;
  const scheduleControl = deriveScheduleControl(command, { ...settings, enabled: active }, issues, now);
  const transition = deriveLifecycleTransition(command, { ...settings, enabled: active }, persistedState, scheduleControl);
  const blocked = active
    && settings.boundaryMode === 'blocking'
    && settings.requireEvidence
    && !settings.allowUnverifiedClaims
    && !hasEnoughEvidence;

  if (settings.schedule.mode === 'interval' && settings.schedule.intervalMinutes === null) {
    issues.push({
      code: 'missing_interval_for_schedule',
      path: 'settings.schedule.intervalMinutes',
      message: 'interval schedule mode requires intervalMinutes'
    });
  }

  const nextAction = !active
    ? command === 'pause'
      ? 'await_resume'
      : 'await_enable'
    : blocked
      ? 'collect_verified_evidence'
      : command === 'schedule'
        ? scheduleControl.armed
          ? scheduleControl.mode === 'onEvidenceChange'
            ? 'wait_for_evidence_change'
            : 'wait_until_scheduled_run'
          : 'persist_schedule'
        : active
          ? 'monitor_claim_boundary'
          : 'await_enable';

  return {
    command,
    status: active ? 'active' : 'inactive',
    controlState: transition.controlState,
    enabled: active,
    blocked,
    verifiedEvidenceCount,
    requiredEvidenceCount: settings.minimumEvidenceItems,
    evaluatedAt: now,
    nextAction,
    scheduleControl,
    transition,
    commandPersistence
  };
}

function buildProof(settings, lifecycle, issues, capabilityNegotiation, externalHandoff, accessPolicy, workspaceScope, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, clientHandoffSubmission) {
  return {
    proofType: 'truth-boundary-lifecycle-decision',
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    boundaryMode: settings.boundaryMode,
    settingsAccepted: issues.length === 0,
    accessDecision: accessPolicy.decision,
    claimCoverageDecision: claimCoverage.decision,
    providerContractDecision: capabilityNegotiation.decision,
    providerServicePlanDecision: providerServicePlan.decision,
    operationalHealthStatus: operationalHealth.status,
    externalHandoffState: externalHandoff.state,
    externalHandoffExchangeState: externalHandoffExchange.state,
    handoffDispatchState: providerServicePlan.handoffDispatch.state,
    clientHandoffSubmissionState: clientHandoffSubmission?.state || 'not_evaluated',
    decision: accessPolicy.decision !== 'allowed'
      ? 'denied'
      : clientHandoffSubmission?.present && !clientHandoffSubmission.accepted
        ? 'blocked'
      : operationalHealth.status === 'blocked'
        ? 'blocked'
        : externalHandoffExchange.state === 'blocked_no_dispatch_provider'
          || externalHandoffExchange.state === 'failed_requires_operator'
          ? 'blocked'
        : providerServicePlan.decision === 'blocked'
          ? 'blocked'
        : lifecycle.blocked || claimCoverage.decision !== 'accepted'
          ? 'blocked'
          : lifecycle.enabled
            ? 'allowed'
            : 'disabled',
    reason: accessPolicy.decision !== 'allowed'
      ? accessPolicy.decisionReason
      : clientHandoffSubmission?.present && !clientHandoffSubmission.accepted
        ? `client handoff submission is ${clientHandoffSubmission.state}`
      : operationalHealth.status === 'blocked'
        ? 'required provider sync failed and must recover before acceptance'
        : externalHandoffExchange.state === 'blocked_no_dispatch_provider'
          ? 'external handoff is required but no callable handoff provider operation is available'
        : externalHandoffExchange.state === 'failed_requires_operator'
          ? 'external handoff receipt failed and requires operator recovery'
        : providerServicePlan.decision === 'blocked'
          ? 'required provider service operations are not callable'
        : claimCoverage.decision !== 'accepted'
          ? 'one or more required claims lack verified in-scope evidence'
        : lifecycle.blocked
          ? 'verified evidence below configured threshold'
          : capabilityNegotiation.decision !== 'accepted'
            ? 'provider capability negotiation requires an integration update'
            : lifecycle.enabled
              ? 'lifecycle controls allow boundary monitoring'
              : 'boundary disabled by lifecycle controls'
  };
}

function issueSeverity(issue) {
  if (issue.code.startsWith('missing_')) return 'error';
  if (issue.code.startsWith('invalid_')) return 'error';
  if (issue.code.startsWith('duplicate_')) return 'error';
  if (issue.code.startsWith('cross_tenant_')) return 'error';
  if (issue.code.startsWith('cross_workspace_')) return 'error';
  if (issue.code === 'unsupported_required_provider_capability') return 'error';
  if (issue.code === 'unknown_handoff_provider') return 'error';
  return 'warning';
}

function summarizeValidation(issues, lifecycle, capabilityNegotiation, accessPolicy, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange) {
  const issueSummaries = issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    severity: issueSeverity(issue),
    message: issue.message
  }));
  const errors = issueSummaries.filter((issue) => issue.severity === 'error');
  const warnings = issueSummaries.filter((issue) => issue.severity === 'warning');
  const runtimeBlockers = [];

  if (lifecycle.blocked) {
    runtimeBlockers.push({
      code: 'verified_evidence_required',
      path: 'evidence',
      severity: 'error',
      message: `requires ${lifecycle.requiredEvidenceCount} verified evidence item(s), received ${lifecycle.verifiedEvidenceCount}`
    });
  }

  if (claimCoverage.decision !== 'accepted') {
    runtimeBlockers.push({
      code: 'claim_verified_evidence_required',
      path: 'claims',
      severity: 'error',
      message: `required claim(s) need verified evidence: ${claimCoverage.blockingClaimIds.join(', ')}`
    });
  }

  if (capabilityNegotiation.decision !== 'accepted') {
    runtimeBlockers.push({
      code: 'provider_contract_not_ready',
      path: 'providerContracts',
      severity: 'error',
      message: `provider contracts need updates: ${capabilityNegotiation.unsatisfiedProviderIds.join(', ')}`
    });
  }

  if (accessPolicy.decision !== 'allowed') {
    runtimeBlockers.push({
      code: 'action_permission_denied',
      path: 'actor.permissions',
      severity: 'error',
      message: `${accessPolicy.requestedAction} requires ${accessPolicy.requiredPermission}`
    });
  }

  if (operationalHealth.status === 'blocked') {
    runtimeBlockers.push(...operationalHealth.actionableErrors);
  }

  if (providerServicePlan.blockedRequiredOperationIds.length > 0) {
    runtimeBlockers.push({
      code: 'provider_service_operation_blocked',
      path: 'providerContracts.serviceContract',
      severity: 'error',
      message: `required provider service operation(s) blocked: ${providerServicePlan.blockedRequiredOperationIds.join(', ')}`
    });
  }

  if (externalHandoffExchange.state === 'blocked_no_dispatch_provider') {
    runtimeBlockers.push({
      code: 'external_handoff_dispatch_unavailable',
      path: 'providerContracts.handoff.create',
      severity: 'error',
      message: 'external handoff is required but no provider has a callable handoff.create operation'
    });
  }

  if (externalHandoffExchange.state === 'failed_requires_operator') {
    runtimeBlockers.push({
      code: 'external_handoff_receipt_failed',
      path: 'externalHandoffs',
      severity: 'error',
      message: `external handoff receipt(s) failed: ${externalHandoffExchange.failedReceiptIds.join(', ')}`
    });
  }

  return {
    valid: errors.length === 0,
    readyForDecision: errors.length === 0 && runtimeBlockers.length === 0,
    issueCount: issueSummaries.length,
    errorCount: errors.length + runtimeBlockers.length,
    warningCount: warnings.length,
    issues: issueSummaries,
    runtimeBlockers
  };
}

function deriveReadiness(lifecycle, capabilityNegotiation, validationSummary, externalHandoff, accessPolicy, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange) {
  const gates = [
    {
      id: 'tenant-access',
      label: 'Tenant access',
      state: accessPolicy.decision === 'allowed' ? 'pass' : 'fail',
      detail: accessPolicy.decision === 'allowed'
        ? `${accessPolicy.role} can ${accessPolicy.requestedAction}`
        : `${accessPolicy.requestedAction} denied: ${accessPolicy.decisionReason}`
    },
    {
      id: 'settings-valid',
      label: 'Settings accepted',
      state: validationSummary.valid ? 'pass' : 'fail',
      detail: validationSummary.valid ? 'Boundary settings are structurally valid' : 'Boundary settings require correction'
    },
    {
      id: 'evidence-threshold',
      label: 'Evidence threshold',
      state: lifecycle.blocked ? 'fail' : 'pass',
      detail: `${lifecycle.verifiedEvidenceCount}/${lifecycle.requiredEvidenceCount} verified evidence item(s)`
    },
    {
      id: 'claim-coverage',
      label: 'Claim coverage',
      state: claimCoverage.decision === 'accepted' ? 'pass' : 'fail',
      detail: claimCoverage.claimCount === 0
        ? 'No declared claims require per-claim coverage'
        : `${claimCoverage.sourceBackedClaimCount}/${claimCoverage.requiredClaimCount} required claim(s) source-backed`
    },
    {
      id: 'provider-contracts',
      label: 'Provider contracts',
      state: capabilityNegotiation.decision === 'accepted' ? 'pass' : 'fail',
      detail: capabilityNegotiation.decision === 'accepted'
        ? `${capabilityNegotiation.acceptedProviderCount}/${capabilityNegotiation.providerCount} provider contract(s) accepted`
        : `blocked by ${capabilityNegotiation.unsatisfiedProviderIds.join(', ')}`
    },
    {
      id: 'operational-health',
      label: 'Operational health',
      state: operationalHealth.status === 'blocked'
        ? 'fail'
        : operationalHealth.status === 'degraded'
          ? 'pending'
          : 'pass',
      detail: operationalHealth.status === 'healthy'
        ? 'Provider sync health is current'
        : operationalHealth.status === 'degraded'
          ? `degraded providers: ${operationalHealth.unhealthyProviderIds.join(', ')}`
          : `required provider failures: ${operationalHealth.requiredFailureProviderIds.join(', ')}`
    },
    {
      id: 'provider-service-plan',
      label: 'Provider service plan',
      state: providerServicePlan.decision === 'blocked'
        ? 'fail'
        : providerServicePlan.decision === 'waiting_for_sync'
          ? 'pending'
          : 'pass',
      detail: providerServicePlan.decision === 'ready'
        ? `${providerServicePlan.readyOperationCount}/${providerServicePlan.operationCount} provider operation(s) callable`
        : providerServicePlan.decision === 'waiting_for_sync'
          ? `waiting for ${providerServicePlan.waitingOperationIds.join(', ')}`
          : `blocked operations: ${providerServicePlan.blockedRequiredOperationIds.join(', ')}`
    },
    {
      id: 'handoff',
      label: 'External handoff',
      state: externalHandoffExchange.state === 'blocked_no_dispatch_provider'
        || externalHandoffExchange.state === 'failed_requires_operator'
        ? 'fail'
        : externalHandoffExchange.state === 'not_required'
          || externalHandoffExchange.state === 'acknowledged'
          || externalHandoffExchange.state === 'ready_to_dispatch'
          ? 'pass'
          : 'pending',
      detail: externalHandoff.required
        ? `${externalHandoff.state}:${externalHandoffExchange.state}:${providerServicePlan.handoffDispatch.state}`
        : 'No external handoff required'
    }
  ];
  const failedGateCount = gates.filter((gate) => gate.state === 'fail').length;
  const pendingGateCount = gates.filter((gate) => gate.state === 'pending').length;
  const state = !lifecycle.enabled
    ? 'inactive'
    : failedGateCount > 0
      ? 'blocked'
      : pendingGateCount > 0
        ? 'pending_handoff'
        : 'ready';

  return {
    state,
    canAccept: state === 'ready' && lifecycle.enabled,
    score: Math.round(((gates.length - failedGateCount - pendingGateCount) / gates.length) * 100),
    failedGateCount,
    pendingGateCount,
    gates
  };
}

function persistedStatusForReadiness(lifecycle, readiness) {
  if (!lifecycle.enabled) {
    if (lifecycle.command === 'pause') return 'paused';
    if (lifecycle.command === 'disable') return 'disabled';
    return 'inactive';
  }
  if (readiness.state === 'ready') return 'ready';
  if (readiness.state === 'pending_handoff') return 'pending_handoff';
  if (readiness.state === 'blocked') return 'blocked';
  return 'active';
}

function buildPersistedStateUpdate(persistedState, persistedRecoveryPlan, lifecycle, readiness, workflowHandoff, workspaceScope, operationalHealth, providerServicePlan, externalHandoffExchange, now) {
  const nextStatus = persistedStatusForReadiness(lifecycle, readiness);
  const replayed = lifecycle.commandPersistence.replayed;
  const snapshotSequence = replayed
    ? persistedState.snapshotSequence
    : persistedState.snapshotSequence + 1;

  return {
    contractVersion: 'truth-boundary.persisted-state.v1',
    writeDisposition: replayed ? 'skip_replayed_command' : 'upsert',
    snapshotSequence,
    status: nextStatus,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    enabled: lifecycle.enabled,
    blocked: lifecycle.blocked,
    controlState: lifecycle.controlState,
    lastEvaluatedAt: replayed && persistedState.lastEvaluatedAt ? persistedState.lastEvaluatedAt : now,
    lastAcceptedAt: readiness.canAccept ? now : persistedState.lastAcceptedAt,
    readinessState: readiness.state,
    commandStatus: lifecycle.commandPersistence.status,
    lastCommand: {
      command: lifecycle.command,
      idempotencyKey: lifecycle.commandPersistence.idempotencyKey,
      requestId: workflowHandoff.payload.requestId,
      appliedAt: lifecycle.commandPersistence.appliedAt
    },
    recovery: {
      recoveredFromStorage: persistedState.recoveredFromStorage,
      recoveryState: persistedRecoveryPlan.recoveryState,
      usableForRecovery: persistedRecoveryPlan.usableForRecovery,
      restartSafe: persistedRecoveryPlan.restartSafe,
      stale: persistedRecoveryPlan.stale,
      snapshotAgeSeconds: persistedRecoveryPlan.snapshotAgeSeconds,
      previousStatus: persistedState.status,
      previousSnapshotSequence: persistedState.snapshotSequence,
      restartSafeStatus: nextStatus,
      replayDetected: replayed,
      scope: persistedRecoveryPlan.scope
    },
    persistenceGuard: {
      contractVersion: 'truth-boundary.persistence-guard.v1',
      writeDisposition: replayed ? 'skip_replayed_command' : 'upsert',
      writeAllowed: !replayed,
      writeSuppressedReason: replayed ? 'idempotent_replay' : null,
      ignoreRecoveredSnapshot: persistedRecoveryPlan.recoveredSnapshotPresent && !persistedRecoveryPlan.usableForRecovery,
      ignoredReason: persistedRecoveryPlan.recoveredSnapshotPresent && !persistedRecoveryPlan.usableForRecovery
        ? persistedRecoveryPlan.recoveryState
        : null,
      expectedTenantId: workspaceScope.tenantId,
      expectedWorkspaceId: workspaceScope.workspaceId,
      storageEpoch: persistedRecoveryPlan.storageEpoch
    },
    scheduleControl: {
      mode: lifecycle.scheduleControl.mode,
      armed: lifecycle.scheduleControl.armed,
      trigger: lifecycle.scheduleControl.trigger,
      nextRunAt: lifecycle.scheduleControl.nextRunAt,
      overdue: lifecycle.scheduleControl.overdue,
      commandEffect: lifecycle.scheduleControl.commandEffect
    },
    lifecycleTransition: lifecycle.transition,
    operationalHealth: {
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      nextRetryAfterSeconds: operationalHealth.retry.nextRetryAfterSeconds,
      unhealthyProviderIds: operationalHealth.unhealthyProviderIds
    },
    providerServicePlan: {
      decision: providerServicePlan.decision,
      operationCount: providerServicePlan.operationCount,
      readyOperationCount: providerServicePlan.readyOperationCount,
      blockedRequiredOperationIds: providerServicePlan.blockedRequiredOperationIds,
      waitingOperationIds: providerServicePlan.waitingOperationIds,
      handoffDispatchState: providerServicePlan.handoffDispatch.state
    },
    externalHandoffExchange: {
      state: externalHandoffExchange.state,
      receiptCount: externalHandoffExchange.receiptCount,
      dispatchRequestCount: externalHandoffExchange.dispatchRequestCount,
      acknowledgedReceiptIds: externalHandoffExchange.acknowledgedReceiptIds,
      pendingReceiptIds: externalHandoffExchange.pendingReceiptIds,
      failedReceiptIds: externalHandoffExchange.failedReceiptIds
    },
    clientHandoffSubmission: {
      state: 'pending_route_evaluation',
      routeName: 'handoffs',
      expectedContinuationToken: `${surfaceId}:${workflowHandoff.payload.correlationId}:handoffs`
    },
    continuation: {
      token: workflowHandoff.continuationToken,
      targetRoute: workflowHandoff.targetRoute,
      recommendedAction: workflowHandoff.recommendedAction
    },
    effectiveSettings: {
      enabled: lifecycle.enabled,
      controlState: lifecycle.controlState,
      schedule: {
        mode: lifecycle.scheduleControl.mode,
        armed: lifecycle.scheduleControl.armed,
        trigger: lifecycle.scheduleControl.trigger,
        nextRunAt: lifecycle.scheduleControl.nextRunAt
      }
    }
  };
}

function buildNextSteps(lifecycle, capabilityNegotiation, validationSummary, externalHandoff, readiness, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange) {
  const steps = [];

  if (lifecycle.nextAction === 'await_enable' || lifecycle.nextAction === 'await_resume') {
    steps.push({
      id: lifecycle.nextAction === 'await_resume' ? 'resume-boundary' : 'enable-boundary',
      label: lifecycle.nextAction === 'await_resume' ? 'Resume truth boundary' : 'Enable truth boundary',
      action: 'POST /verifier-claim-gate/truth-boundary/lifecycle',
      blocking: false,
      reason: lifecycle.nextAction === 'await_resume'
        ? 'Boundary is paused by lifecycle controls'
        : 'Boundary is disabled by lifecycle controls'
    });
  }

  if (lifecycle.nextAction === 'wait_until_scheduled_run') {
    steps.push({
      id: 'wait-for-scheduled-run',
      label: 'Wait for scheduled run',
      action: 'GET /verifier-claim-gate/truth-boundary/preview',
      blocking: false,
      reason: lifecycle.scheduleControl.nextRunAt
        ? `Next lifecycle run is scheduled for ${lifecycle.scheduleControl.nextRunAt}`
        : 'Schedule is armed and waiting for the next lifecycle run'
    });
  }

  if (lifecycle.nextAction === 'wait_for_evidence_change') {
    steps.push({
      id: 'wait-for-evidence-change',
      label: 'Wait for evidence change',
      action: 'POST /verifier-claim-gate/truth-boundary/evidence',
      blocking: false,
      reason: 'Boundary will evaluate again when in-scope evidence changes'
    });
  }

  if (!validationSummary.valid) {
    steps.push({
      id: 'fix-validation-errors',
      label: 'Fix validation errors',
      action: 'PATCH /verifier-claim-gate/truth-boundary/settings',
      blocking: true,
      reason: `${validationSummary.errorCount} blocking validation issue(s) must be resolved before acceptance`
    });
  }

  if (lifecycle.blocked) {
    steps.push({
      id: 'attach-verified-evidence',
      label: 'Attach verified evidence',
      action: 'POST /verifier-claim-gate/truth-boundary/evidence',
      blocking: true,
      reason: `Need ${Math.max(0, lifecycle.requiredEvidenceCount - lifecycle.verifiedEvidenceCount)} more verified evidence item(s)`
    });
  }

  if (claimCoverage.decision !== 'accepted') {
    steps.push({
      id: 'attach-claim-evidence',
      label: 'Attach claim evidence',
      action: 'POST /verifier-claim-gate/truth-boundary/evidence',
      blocking: true,
      reason: `Required claims missing verified evidence: ${claimCoverage.blockingClaimIds.join(', ')}`
    });
  }

  if (capabilityNegotiation.decision !== 'accepted') {
    steps.push({
      id: 'update-provider-contracts',
      label: 'Update provider contracts',
      action: 'PUT /verifier-claim-gate/truth-boundary/provider-contracts',
      blocking: true,
      reason: `Unsatisfied providers: ${capabilityNegotiation.unsatisfiedProviderIds.join(', ')}`
    });
  }

  if (operationalHealth.retry.recommended) {
    steps.push({
      id: operationalHealth.status === 'blocked' ? 'recover-provider-sync' : 'retry-provider-sync',
      label: operationalHealth.status === 'blocked' ? 'Recover provider sync' : 'Retry provider sync',
      action: 'POST /verifier-claim-gate/truth-boundary/provider-contracts/sync',
      blocking: operationalHealth.status === 'blocked',
      reason: operationalHealth.retry.nextRetryAfterSeconds === null
        ? 'Provider sync is not healthy and should be retried'
        : `Retry provider sync after ${operationalHealth.retry.nextRetryAfterSeconds} second(s)`
    });
  }

  if (providerServicePlan.decision === 'waiting_for_sync') {
    steps.push({
      id: 'wait-provider-service-plan',
      label: 'Wait for provider operations',
      action: 'GET /verifier-claim-gate/truth-boundary/provider-contracts',
      blocking: false,
      reason: `Provider operation sync pending: ${providerServicePlan.waitingOperationIds.join(', ')}`
    });
  }

  if (providerServicePlan.blockedRequiredOperationIds.length > 0) {
    steps.push({
      id: 'repair-provider-service-contract',
      label: 'Repair provider service contract',
      action: 'PUT /verifier-claim-gate/truth-boundary/provider-contracts',
      blocking: true,
      reason: `Required provider operations blocked: ${providerServicePlan.blockedRequiredOperationIds.join(', ')}`
    });
  }

  if (externalHandoff.required && externalHandoff.state === 'ready') {
    steps.push({
      id: 'create-external-handoff',
      label: 'Create external handoff',
      action: 'POST /verifier-claim-gate/truth-boundary/handoffs',
      blocking: false,
      reason: 'A provider can receive a handoff for downstream audit or decision writeback'
    });
  }

  if (externalHandoffExchange.state === 'ready_to_dispatch') {
    steps.push({
      id: 'dispatch-external-handoff',
      label: 'Dispatch external handoff',
      action: 'POST /verifier-claim-gate/truth-boundary/handoffs',
      blocking: false,
      reason: `${externalHandoffExchange.dispatchRequestCount} provider handoff request(s) are ready to dispatch`
    });
  }

  if (externalHandoffExchange.state === 'awaiting_ack') {
    steps.push({
      id: 'await-external-handoff-ack',
      label: 'Await handoff acknowledgement',
      action: 'GET /verifier-claim-gate/truth-boundary/handoffs',
      blocking: false,
      reason: `Pending handoff receipt(s): ${externalHandoffExchange.pendingReceiptIds.join(', ')}`
    });
  }

  if (externalHandoffExchange.state === 'failed_requires_operator') {
    steps.push({
      id: 'recover-external-handoff',
      label: 'Recover external handoff',
      action: 'POST /verifier-claim-gate/truth-boundary/handoffs',
      blocking: true,
      reason: `Failed handoff receipt(s): ${externalHandoffExchange.failedReceiptIds.join(', ')}`
    });
  }

  if (steps.length === 0 && readiness.canAccept) {
    steps.push({
      id: 'accept-boundary-decision',
      label: 'Accept truth boundary',
      action: 'POST /verifier-claim-gate/truth-boundary/acceptance',
      blocking: false,
      reason: 'All readiness gates passed and the boundary decision can be accepted'
    });
  }

  return steps;
}

function routeForAction(action) {
  if (action === 'accept') return 'acceptance';
  if (action === 'attachEvidence') return 'evidence';
  if (action === 'updateProviderContracts') return 'providerContracts';
  if (action === 'createHandoff') return 'handoffs';
  return 'preview';
}

function hrefForRoute(routeName) {
  if (routeName === 'acceptance') return '/verifier-claim-gate/truth-boundary/acceptance';
  if (routeName === 'evidence') return '/verifier-claim-gate/truth-boundary/evidence';
  if (routeName === 'providerContracts') return '/verifier-claim-gate/truth-boundary/provider-contracts';
  if (routeName === 'handoffs') return '/verifier-claim-gate/truth-boundary/handoffs';
  return '/verifier-claim-gate/truth-boundary/preview';
}

function methodForRoute(routeName) {
  if (routeName === 'preview') return 'GET';
  if (routeName === 'providerContracts') return 'PUT';
  return 'POST';
}

function actionDisabledReason(action, accessPolicy, validationSummary, readiness, externalHandoffExchange) {
  const requiredPermission = actionPermissionRequirements[action];
  const hasPermission = requiredPermission ? accessPolicy.permissions.includes(requiredPermission) : false;

  if (!hasPermission) return `requires ${requiredPermission}`;
  if (action === 'accept' && !readiness.canAccept) return 'readiness gates must pass before acceptance';
  if (action === 'attachEvidence' && validationSummary.runtimeBlockers.every((issue) => (
    issue.code !== 'verified_evidence_required'
    && issue.code !== 'claim_verified_evidence_required'
  ))) return 'no evidence blocker is currently active';
  if (action === 'updateProviderContracts' && validationSummary.runtimeBlockers.every((issue) => (
    issue.code !== 'provider_contract_not_ready'
    && issue.code !== 'provider_service_operation_blocked'
  ))) return 'provider contracts are not the current blocking handoff';
  if (action === 'createHandoff' && externalHandoffExchange.state !== 'ready_to_dispatch'
    && externalHandoffExchange.state !== 'failed_requires_operator') {
    return `handoff exchange is ${externalHandoffExchange.state}`;
  }
  return null;
}

function buildRouteActionAffordance(action, clientRuntime, accessPolicy, validationSummary, readiness, workflowHandoff, externalHandoffExchange, persistedStateUpdate, now) {
  const routeName = routeForAction(action);
  const disabledReason = actionDisabledReason(action, accessPolicy, validationSummary, readiness, externalHandoffExchange);
  const enabled = disabledReason === null;
  const continuationToken = action === workflowHandoff.recommendedAction
    ? workflowHandoff.continuationToken
    : `${surfaceId}:${clientRuntime.correlationId}:${routeName}`;
  const basePayload = {
    requestId: clientRuntime.requestId,
    correlationId: clientRuntime.correlationId,
    continuationToken,
    snapshotSequence: persistedStateUpdate.snapshotSequence
  };

  return {
    contractVersion: 'truth-boundary.client-action-affordance.v1',
    action,
    routeName,
    method: methodForRoute(routeName),
    href: hrefForRoute(routeName),
    enabled,
    disabledReason,
    recommended: workflowHandoff.recommendedAction === action,
    requiredPermission: actionPermissionRequirements[action],
    continuationToken,
    idempotencyKey: `${surfaceId}:${clientRuntime.requestId}:${action}:${persistedStateUpdate.snapshotSequence}`,
    generatedAt: now,
    payloadContract: action === 'createHandoff'
      ? {
          contractVersion: 'truth-boundary.handoff-request.v1',
          requiredFields: ['requestId', 'correlationId', 'continuationToken', 'snapshotSequence', 'dispatchRequests'],
          ...basePayload,
          dispatchRequestIds: externalHandoffExchange.dispatchRequests.map((request) => request.idempotencyKey),
          providerIds: externalHandoffExchange.dispatchableProviderIds,
          requiredAckStatus: 'acknowledged'
        }
      : action === 'attachEvidence'
        ? {
            contractVersion: 'truth-boundary.evidence-attachment-request.v1',
            requiredFields: ['requestId', 'correlationId', 'continuationToken', 'snapshotSequence', 'evidence'],
            ...basePayload,
            minimumVerifiedEvidenceItems: validationSummary.runtimeBlockers.some((issue) => (
              issue.code === 'verified_evidence_required'
              || issue.code === 'claim_verified_evidence_required'
            )) ? 1 : 0
          }
        : action === 'updateProviderContracts'
          ? {
              contractVersion: 'truth-boundary.provider-contracts-update-request.v1',
              requiredFields: ['requestId', 'correlationId', 'continuationToken', 'snapshotSequence', 'providerContracts'],
              ...basePayload,
              expectedProviderContractVersion: 'provider.truth-boundary.v1'
            }
          : action === 'accept'
            ? {
                contractVersion: 'truth-boundary.acceptance-request.v1',
                requiredFields: ['requestId', 'correlationId', 'continuationToken', 'snapshotSequence', 'acceptanceToken'],
                ...basePayload,
                expectedReadinessState: 'ready'
              }
            : {
                contractVersion: 'truth-boundary.preview-request.v1',
                requiredFields: ['requestId', 'correlationId'],
                requestId: clientRuntime.requestId,
                correlationId: clientRuntime.correlationId
              }
  };
}

function lifecycleCommandDisabledReason(command, lifecycle, accessPolicy, validationSummary) {
  const requiredPermission = lifecycleCommandPermissionRequirements[command];
  const hasPermission = accessPolicy.permissions.includes(requiredPermission);

  if (!hasPermission) return `requires ${requiredPermission}`;
  if (command !== 'inspect' && validationSummary.issues.some((issue) => issue.severity === 'error')) {
    return 'settings validation errors must be corrected before changing lifecycle controls';
  }
  if (command === 'enable' && lifecycle.enabled) return 'boundary is already enabled';
  if (command === 'resume' && lifecycle.enabled) return 'boundary is already active';
  if ((command === 'pause' || command === 'disable') && !lifecycle.enabled) return 'boundary is already inactive';
  if (command === 'schedule' && lifecycle.scheduleControl.mode === 'manual') return 'manual schedule mode cannot arm automatic runs';
  return null;
}

function buildLifecycleCommandControls(settings, lifecycle, accessPolicy, validationSummary, readiness, persistedStateUpdate, nextSteps, now) {
  const controls = Array.from(lifecycleCommands).map((command) => {
    const requiredPermission = lifecycleCommandPermissionRequirements[command];
    const disabledReason = lifecycleCommandDisabledReason(command, lifecycle, accessPolicy, validationSummary);

    return {
      contractVersion: 'truth-boundary.lifecycle-command-control.v1',
      command,
      method: 'POST',
      href: '/verifier-claim-gate/truth-boundary/lifecycle',
      enabled: disabledReason === null,
      disabledReason,
      requiredPermission,
      idempotencyKeySeed: `${surfaceId}:${persistedStateUpdate.snapshotSequence}:${command}`,
      payloadContract: {
        contractVersion: 'truth-boundary.lifecycle-command-request.v1',
        requiredFields: ['lifecycleCommand', 'requestId', 'correlationId', 'snapshotSequence'],
        lifecycleCommand: command,
        snapshotSequence: persistedStateUpdate.snapshotSequence
      }
    };
  });
  const allowedCommands = controls.filter((control) => control.enabled).map((control) => control.command);
  const blockingStep = nextSteps.find((step) => step.blocking);
  const recommendedCommand = lifecycle.enabled
    ? lifecycle.scheduleControl.overdue
      ? 'inspect'
      : blockingStep
        ? 'inspect'
        : readiness.canAccept
          ? 'inspect'
          : lifecycle.scheduleControl.armed
            ? 'pause'
            : 'schedule'
    : lifecycle.controlState === 'paused'
      ? 'resume'
      : 'enable';
  const recommendedControl = controls.find((control) => control.command === recommendedCommand);

  return {
    contractVersion: 'truth-boundary.lifecycle-command-controls.v1',
    generatedAt: now,
    currentCommand: lifecycle.command,
    currentControlState: lifecycle.controlState,
    enabled: lifecycle.enabled,
    recommendedCommand,
    recommendedCommandEnabled: Boolean(recommendedControl?.enabled),
    recommendedCommandReason: recommendedControl?.disabledReason || (
      lifecycle.enabled
        ? lifecycle.scheduleControl.armed
          ? 'automatic lifecycle controls are armed'
          : 'operator can adjust lifecycle settings'
        : 'boundary is inactive and can be re-enabled by an authorized operator'
    ),
    allowedCommands,
    blockedCommands: controls
      .filter((control) => !control.enabled)
      .map((control) => ({
        command: control.command,
        requiredPermission: control.requiredPermission,
        reason: control.disabledReason
      })),
    settingsPatch: {
      contractVersion: 'truth-boundary.lifecycle-settings-patch.v1',
      method: 'PATCH',
      href: '/verifier-claim-gate/truth-boundary/settings',
      writeDisposition: persistedStateUpdate.writeDisposition,
      snapshotSequence: persistedStateUpdate.snapshotSequence,
      patch: {
        enabled: lifecycle.enabled,
        boundaryMode: settings.boundaryMode,
        requireEvidence: settings.requireEvidence,
        minimumEvidenceItems: settings.minimumEvidenceItems,
        allowUnverifiedClaims: settings.allowUnverifiedClaims,
        schedule: {
          mode: lifecycle.scheduleControl.mode,
          intervalMinutes: lifecycle.scheduleControl.intervalMinutes,
          nextRunAt: lifecycle.scheduleControl.nextRunAt
        }
      }
    },
    controls
  };
}

function buildWorkflowHandoff(clientRuntime, lifecycle, validationSummary, readiness, externalHandoff, nextSteps, accessPolicy, workspaceScope, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, now) {
  const blockingStep = nextSteps.find((step) => step.blocking);
  const selectedAction = blockingStep
    ? blockingStep.id === 'attach-verified-evidence' || blockingStep.id === 'attach-claim-evidence'
      ? 'attachEvidence'
      : blockingStep.id === 'update-provider-contracts'
        || blockingStep.id === 'recover-provider-sync'
        ? 'updateProviderContracts'
        : blockingStep.id === 'recover-external-handoff'
          ? 'createHandoff'
        : 'inspect'
    : readiness.canAccept
      ? 'accept'
      : externalHandoff.required && (
          externalHandoffExchange.state === 'ready_to_dispatch'
          || externalHandoffExchange.state === 'failed_requires_operator'
        )
        ? 'createHandoff'
        : clientRuntime.requestedAction;
  const targetRoute = routeForAction(selectedAction);

  return {
    contractVersion: 'truth-boundary.workflow-handoff.v1',
    generatedAt: now,
    state: readiness.canAccept
      ? 'ready_for_acceptance'
      : validationSummary.readyForDecision
        ? 'ready_for_handoff'
        : 'needs_operator_action',
    fromRoute: clientRuntime.activeRoute,
    targetRoute,
    requestedAction: clientRuntime.requestedAction,
    recommendedAction: selectedAction,
    continuationToken: `${surfaceId}:${clientRuntime.correlationId}:${targetRoute}`,
    idempotencyKey: clientRuntime.idempotencyKey || `${surfaceId}:${clientRuntime.requestId}:${selectedAction}`,
    returnUrl: clientRuntime.returnUrl,
    actor: clientRuntime.actor,
    access: {
      decision: accessPolicy.decision,
      requiredPermission: accessPolicy.requiredPermission,
      role: accessPolicy.role,
      decisionReason: accessPolicy.decisionReason,
      actorScope: accessPolicy.actorScope
    },
    payload: {
      requestId: clientRuntime.requestId,
      correlationId: clientRuntime.correlationId,
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      originSurface: clientRuntime.originSurface,
      lifecycleCommand: lifecycle.command,
      lifecycleControlState: lifecycle.controlState,
      lifecycleNextAction: lifecycle.nextAction,
      scheduleMode: lifecycle.scheduleControl.mode,
      scheduleArmed: lifecycle.scheduleControl.armed,
      scheduleNextRunAt: lifecycle.scheduleControl.nextRunAt,
      readinessState: readiness.state,
      nextStepIds: nextSteps.map((step) => step.id),
      requiredProviderIds: externalHandoff.providerIds,
      providerServicePlanDecision: providerServicePlan.decision,
      providerOperationCount: providerServicePlan.operationCount,
      readyProviderOperationCount: providerServicePlan.readyOperationCount,
      blockedProviderOperationIds: providerServicePlan.blockedRequiredOperationIds,
      waitingProviderOperationIds: providerServicePlan.waitingOperationIds,
      handoffDispatchState: providerServicePlan.handoffDispatch.state,
      externalHandoffExchangeState: externalHandoffExchange.state,
      handoffReceiptCount: externalHandoffExchange.receiptCount,
      handoffDispatchRequestCount: externalHandoffExchange.dispatchRequestCount,
      acknowledgedHandoffReceiptIds: externalHandoffExchange.acknowledgedReceiptIds,
      pendingHandoffReceiptIds: externalHandoffExchange.pendingReceiptIds,
      failedHandoffReceiptIds: externalHandoffExchange.failedReceiptIds,
      operationalHealthStatus: operationalHealth.status,
      retryAfterSeconds: operationalHealth.retry.nextRetryAfterSeconds,
      degradedMode: operationalHealth.degradedMode,
      claimCoverageDecision: claimCoverage.decision,
      blockingClaimIds: claimCoverage.blockingClaimIds,
      missingVerifiedEvidence: Math.max(0, lifecycle.requiredEvidenceCount - lifecycle.verifiedEvidenceCount)
    }
  };
}

function buildPreviewAcceptance(settings, lifecycle, validationSummary, readiness, proof, nextSteps, workflowHandoff, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, lifecycleCommandControls, now) {
  const primaryBlocker = validationSummary.runtimeBlockers[0] || validationSummary.issues[0] || null;

  return {
    previewVersion: 'truth-boundary.preview-acceptance.v1',
    generatedAt: now,
    headline: lifecycle.blocked ? 'Truth boundary blocked' : readiness.canAccept ? 'Truth boundary ready' : 'Truth boundary needs review',
    statusText: primaryBlocker ? primaryBlocker.message : proof.reason,
    decision: proof.decision,
    mode: settings.boundaryMode,
    canAccept: readiness.canAccept,
    acceptance: {
      enabled: readiness.canAccept,
      token: readiness.canAccept ? `${surfaceId}:${lifecycle.evaluatedAt}:accept` : null,
      requiredAcknowledgements: readiness.canAccept
        ? ['provider contracts accepted', 'evidence threshold satisfied', 'audit proof generated']
        : []
    },
    workflowHandoff: {
      state: workflowHandoff.state,
      targetRoute: workflowHandoff.targetRoute,
      recommendedAction: workflowHandoff.recommendedAction,
      continuationToken: workflowHandoff.continuationToken
    },
    lifecycleControls: {
      command: lifecycle.command,
      controlState: lifecycle.controlState,
      nextAction: lifecycle.nextAction,
      recommendedCommand: lifecycleCommandControls.recommendedCommand,
      recommendedCommandEnabled: lifecycleCommandControls.recommendedCommandEnabled,
      allowedCommands: lifecycleCommandControls.allowedCommands,
      transition: lifecycle.transition.transition,
      schedule: {
        mode: lifecycle.scheduleControl.mode,
        armed: lifecycle.scheduleControl.armed,
        trigger: lifecycle.scheduleControl.trigger,
        nextRunAt: lifecycle.scheduleControl.nextRunAt,
        overdue: lifecycle.scheduleControl.overdue,
        commandEffect: lifecycle.scheduleControl.commandEffect
      },
      settingsPatch: lifecycleCommandControls.settingsPatch
    },
    counters: {
      verifiedEvidence: lifecycle.verifiedEvidenceCount,
      requiredEvidence: lifecycle.requiredEvidenceCount,
      validationErrors: validationSummary.errorCount,
      validationWarnings: validationSummary.warningCount,
      declaredClaims: claimCoverage.claimCount,
      sourceBackedClaims: claimCoverage.sourceBackedClaimCount,
      blockingClaims: claimCoverage.blockingClaimIds.length,
      unhealthyProviders: operationalHealth.unhealthyProviderIds.length,
      providerOperations: providerServicePlan.operationCount,
      readyProviderOperations: providerServicePlan.readyOperationCount,
      blockedProviderOperations: providerServicePlan.blockedRequiredOperationIds.length,
      handoffReceipts: externalHandoffExchange.receiptCount,
      handoffDispatchRequests: externalHandoffExchange.dispatchRequestCount
    },
    operationalHealth: {
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      retryAfterSeconds: operationalHealth.retry.nextRetryAfterSeconds
    },
    providerServicePlan: {
      decision: providerServicePlan.decision,
      handoffDispatchState: providerServicePlan.handoffDispatch.state,
      waitingOperationIds: providerServicePlan.waitingOperationIds,
      blockedRequiredOperationIds: providerServicePlan.blockedRequiredOperationIds
    },
    externalHandoffExchange: {
      state: externalHandoffExchange.state,
      acknowledgedReceiptIds: externalHandoffExchange.acknowledgedReceiptIds,
      pendingReceiptIds: externalHandoffExchange.pendingReceiptIds,
      failedReceiptIds: externalHandoffExchange.failedReceiptIds,
      dispatchableProviderIds: externalHandoffExchange.dispatchableProviderIds
    },
    nextStepIds: nextSteps.map((step) => step.id)
  };
}

function previewSeverityForGate(gate) {
  if (gate.state === 'fail') return 'error';
  if (gate.state === 'pending') return 'warning';
  return 'info';
}

function nextStepRouteName(step) {
  if (step.action.includes('/evidence')) return 'evidence';
  if (step.action.includes('/provider-contracts')) return 'providerContracts';
  if (step.action.includes('/handoffs')) return 'handoffs';
  if (step.action.includes('/acceptance')) return 'acceptance';
  return 'preview';
}

function buildOperatorDecisionPacket(previewAcceptance, validationSummary, readiness, proof, nextSteps, workflowHandoff, persistedStateUpdate, accessPolicy, claimCoverage, providerServicePlan, externalHandoffExchange, now) {
  const blockingStepIds = nextSteps.filter((step) => step.blocking).map((step) => step.id);
  const failedGateIds = readiness.gates.filter((gate) => gate.state === 'fail').map((gate) => gate.id);
  const pendingGateIds = readiness.gates.filter((gate) => gate.state === 'pending').map((gate) => gate.id);
  const validationBySeverity = validationSummary.issues.concat(validationSummary.runtimeBlockers).reduce((accumulator, issue) => {
    const severity = issue.severity || 'warning';
    if (!accumulator[severity]) accumulator[severity] = [];
    accumulator[severity].push({
      code: issue.code,
      path: issue.path,
      message: issue.message
    });
    return accumulator;
  }, { error: [], warning: [], info: [] });

  return {
    contractVersion: 'truth-boundary.operator-decision-packet.v1',
    generatedAt: now,
    snapshotSequence: persistedStateUpdate.snapshotSequence,
    requestState: {
      requestedAction: workflowHandoff.requestedAction,
      recommendedAction: workflowHandoff.recommendedAction,
      activeRoute: workflowHandoff.fromRoute,
      targetRoute: workflowHandoff.targetRoute,
      continuationToken: workflowHandoff.continuationToken,
      idempotencyKey: workflowHandoff.idempotencyKey
    },
    preview: {
      headline: previewAcceptance.headline,
      statusText: previewAcceptance.statusText,
      decision: proof.decision,
      readinessState: readiness.state,
      score: readiness.score,
      counters: previewAcceptance.counters,
      cards: readiness.gates.map((gate) => ({
        contractVersion: 'truth-boundary.preview-card.v1',
        id: gate.id,
        title: gate.label,
        severity: previewSeverityForGate(gate),
        state: gate.state,
        detail: gate.detail,
        anchors: gate.id === 'claim-coverage'
          ? claimCoverage.blockingClaimIds.map((claimId) => `claim:${claimId}`)
          : gate.id === 'provider-service-plan'
            ? providerServicePlan.blockedRequiredOperationIds.map((operationId) => `providerOperation:${operationId}`)
            : gate.id === 'handoff'
              ? externalHandoffExchange.failedReceiptIds.map((handoffId) => `handoff:${handoffId}`)
              : []
      }))
    },
    acceptance: {
      contractVersion: 'truth-boundary.acceptance-readiness.v1',
      enabled: previewAcceptance.acceptance.enabled,
      token: previewAcceptance.acceptance.token,
      blocked: !previewAcceptance.acceptance.enabled,
      blockedBy: Array.from(new Set(blockingStepIds.concat(failedGateIds))),
      requiredAcknowledgements: previewAcceptance.acceptance.requiredAcknowledgements,
      proofDigest: {
        proofType: proof.proofType,
        decision: proof.decision,
        reason: proof.reason,
        accessDecision: proof.accessDecision,
        claimCoverageDecision: proof.claimCoverageDecision,
        providerServicePlanDecision: proof.providerServicePlanDecision,
        externalHandoffExchangeState: proof.externalHandoffExchangeState,
        clientHandoffSubmissionState: proof.clientHandoffSubmissionState
      },
      submitContract: {
        contractVersion: 'truth-boundary.acceptance-submit.v1',
        method: 'POST',
        href: '/verifier-claim-gate/truth-boundary/acceptance',
        requiredFields: ['acceptanceToken', 'snapshotSequence', 'continuationToken', 'acknowledgements'],
        snapshotSequence: persistedStateUpdate.snapshotSequence,
        continuationToken: workflowHandoff.continuationToken,
        expectedActorId: accessPolicy.actorId,
        expectedReadinessState: 'ready'
      }
    },
    validation: {
      contractVersion: 'truth-boundary.validation-digest.v1',
      valid: validationSummary.valid,
      readyForDecision: validationSummary.readyForDecision,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      failedGateIds,
      pendingGateIds,
      bySeverity: validationBySeverity
    },
    nextSteps: {
      contractVersion: 'truth-boundary.explainable-next-steps.v1',
      recommendedAction: workflowHandoff.recommendedAction,
      blockingStepIds,
      pendingGateIds,
      steps: nextSteps.map((step, index) => {
        const routeName = nextStepRouteName(step);
        return {
          contractVersion: 'truth-boundary.explainable-next-step.v1',
          id: step.id,
          order: index + 1,
          label: step.label,
          routeName,
          method: step.action.split(' ')[0] || methodForRoute(routeName),
          href: hrefForRoute(routeName),
          blocking: step.blocking,
          reason: step.reason,
          continuationToken: workflowHandoff.continuationToken,
          clearsGateIds: readiness.gates
            .filter((gate) => step.reason.includes(gate.id) || gate.state !== 'pass')
            .map((gate) => gate.id)
        };
      })
    }
  };
}

function buildClientRouteDataContracts(clientRuntime, previewAcceptance, validationSummary, readiness, proof, nextSteps, workflowHandoff, persistedStateUpdate, analyticsReporting, lifecycleCommandControls, accessPolicy, claimCoverage, externalHandoffExchange, operatorDecisionPacket, clientHandoffSubmission, now) {
  const blockingSteps = nextSteps.filter((step) => step.blocking);
  const nonBlockingSteps = nextSteps.filter((step) => !step.blocking);
  const acceptanceBlockedBy = []
    .concat(validationSummary.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code))
    .concat(validationSummary.runtimeBlockers.map((issue) => issue.code))
    .concat(blockingSteps.map((step) => step.id));
  const workflowActions = ['preview', 'attachEvidence', 'updateProviderContracts', 'createHandoff', 'accept']
    .map((action) => buildRouteActionAffordance(
      action,
      clientRuntime,
      accessPolicy,
      validationSummary,
      readiness,
      workflowHandoff,
      externalHandoffExchange,
      persistedStateUpdate,
      now
    ));
  const workflowActionsByName = workflowActions.reduce((accumulator, action) => {
    accumulator[action.action] = action;
    return accumulator;
  }, {});
  const routeEnvelope = {
    contractVersion: 'truth-boundary.client-route-contract.v1',
    generatedAt: now,
    requestId: clientRuntime.requestId,
    correlationId: clientRuntime.correlationId,
    continuationToken: workflowHandoff.continuationToken,
    workflowState: workflowHandoff.state,
    activeRoute: clientRuntime.activeRoute,
    targetRoute: workflowHandoff.targetRoute
  };

  return {
    contractVersion: 'truth-boundary.client-route-data-contracts.v1',
    generatedAt: now,
    activeRoute: clientRuntime.activeRoute,
    recommendedRoute: workflowHandoff.targetRoute,
    workflowActions,
    workflowActionsByName,
    preview: {
      ...routeEnvelope,
      routeName: 'preview',
      method: 'GET',
      href: '/verifier-claim-gate/truth-boundary/preview',
      title: previewAcceptance.headline,
      statusText: previewAcceptance.statusText,
      decision: proof.decision,
      readinessState: readiness.state,
      primaryAction: workflowActionsByName[workflowHandoff.recommendedAction] || workflowActionsByName.preview,
      counters: previewAcceptance.counters,
      visibleSections: ['readiness', 'validationSummary', 'nextSteps', 'proofSummary'],
      operatorDecisionPacket,
      proofRef: {
        proofType: proof.proofType,
        decision: proof.decision,
        reason: proof.reason,
        generatedAt: now
      }
    },
    acceptance: {
      ...routeEnvelope,
      routeName: 'acceptance',
      method: 'POST',
      href: '/verifier-claim-gate/truth-boundary/acceptance',
      enabled: previewAcceptance.canAccept,
      acceptanceToken: previewAcceptance.acceptance.token,
      requiredAcknowledgements: previewAcceptance.acceptance.requiredAcknowledgements,
      blockedBy: Array.from(new Set(acceptanceBlockedBy)),
      readinessContract: operatorDecisionPacket.acceptance,
      idempotencyKey: workflowActionsByName.accept.idempotencyKey,
      action: workflowActionsByName.accept
    },
    evidence: {
      ...routeEnvelope,
      routeName: 'evidence',
      method: 'POST',
      href: '/verifier-claim-gate/truth-boundary/evidence',
      action: workflowActionsByName.attachEvidence,
      requiredForClaimIds: validationSummary.runtimeBlockers
        .filter((issue) => issue.code === 'claim_verified_evidence_required')
        .flatMap(() => claimCoverage.blockingClaimIds),
      blockerCodes: validationSummary.runtimeBlockers
        .filter((issue) => issue.path === 'evidence' || issue.path === 'claims')
        .map((issue) => issue.code)
    },
    providerContracts: {
      ...routeEnvelope,
      routeName: 'providerContracts',
      method: 'PUT',
      href: '/verifier-claim-gate/truth-boundary/provider-contracts',
      action: workflowActionsByName.updateProviderContracts,
      blockedOperationIds: previewAcceptance.providerServicePlan.blockedRequiredOperationIds,
      waitingOperationIds: previewAcceptance.providerServicePlan.waitingOperationIds,
      handoffDispatchState: previewAcceptance.providerServicePlan.handoffDispatchState
    },
    handoffs: {
      ...routeEnvelope,
      routeName: 'handoffs',
      method: 'POST',
      href: '/verifier-claim-gate/truth-boundary/handoffs',
      action: workflowActionsByName.createHandoff,
      exchangeState: externalHandoffExchange.state,
      submissionState: clientHandoffSubmission.state,
      submissionAccepted: clientHandoffSubmission.accepted,
      submissionContract: {
        contractVersion: 'truth-boundary.client-handoff-submit-contract.v1',
        requiredFields: ['continuationToken', 'snapshotSequence', 'dispatchRequestIds', 'providerIds'],
        expectedSnapshotSequence: clientHandoffSubmission.expectedSnapshotSequence,
        expectedContinuationToken: clientHandoffSubmission.expectedContinuationToken,
        receiptContract: clientHandoffSubmission.receiptContract
      },
      submittedDispatchRequestIds: clientHandoffSubmission.dispatchRequestIds,
      rejectedDispatchRequestIds: clientHandoffSubmission.unknownDispatchIds,
      rejectedProviderIds: clientHandoffSubmission.unknownProviderIds,
      dispatchRequestCount: externalHandoffExchange.dispatchRequestCount,
      dispatchableProviderIds: externalHandoffExchange.dispatchableProviderIds,
      dispatchRequests: externalHandoffExchange.dispatchRequests.map((request) => ({
        providerId: request.providerId,
        operationId: request.operationId,
        method: request.method,
        route: request.route,
        endpointBaseUrl: request.endpointBaseUrl,
        callbackUrl: request.callbackUrl,
        idempotencyKey: request.idempotencyKey,
        payloadContractVersion: request.payloadContractVersion
      }))
    },
    validationSummary: {
      ...routeEnvelope,
      routeName: 'validation',
      method: 'GET',
      href: '/verifier-claim-gate/truth-boundary/preview#validation',
      valid: validationSummary.valid,
      readyForDecision: validationSummary.readyForDecision,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      issueCodes: validationSummary.issues.map((issue) => issue.code),
      runtimeBlockerCodes: validationSummary.runtimeBlockers.map((issue) => issue.code),
      digest: operatorDecisionPacket.validation
    },
    readiness: {
      ...routeEnvelope,
      routeName: 'readiness',
      method: 'GET',
      href: '/verifier-claim-gate/truth-boundary/preview#readiness',
      state: readiness.state,
      canAccept: readiness.canAccept,
      score: readiness.score,
      failedGateCount: readiness.failedGateCount,
      pendingGateCount: readiness.pendingGateCount,
      previewCards: operatorDecisionPacket.preview.cards,
      gateStates: readiness.gates.map((gate) => ({
        id: gate.id,
        state: gate.state,
        detail: gate.detail
      }))
    },
    nextSteps: {
      ...routeEnvelope,
      routeName: 'nextSteps',
      method: 'GET',
      href: '/verifier-claim-gate/truth-boundary/preview#next-steps',
      recommendedAction: workflowHandoff.recommendedAction,
      blockingStepIds: blockingSteps.map((step) => step.id),
      optionalStepIds: nonBlockingSteps.map((step) => step.id),
      explainableContract: operatorDecisionPacket.nextSteps,
      steps: nextSteps.map((step, index) => ({
        ...step,
        order: index + 1,
        routeName: routeForAction(workflowHandoff.recommendedAction),
        continuationToken: workflowHandoff.continuationToken,
        actionAffordance: workflowActionsByName[workflowHandoff.recommendedAction] || workflowActionsByName.preview
      }))
    },
    lifecycleControls: {
      ...routeEnvelope,
      routeName: 'lifecycleControls',
      method: 'POST',
      href: '/verifier-claim-gate/truth-boundary/lifecycle',
      currentControlState: lifecycleCommandControls.currentControlState,
      enabled: lifecycleCommandControls.enabled,
      recommendedCommand: lifecycleCommandControls.recommendedCommand,
      recommendedCommandEnabled: lifecycleCommandControls.recommendedCommandEnabled,
      allowedCommands: lifecycleCommandControls.allowedCommands,
      blockedCommands: lifecycleCommandControls.blockedCommands,
      settingsPatch: lifecycleCommandControls.settingsPatch,
      controls: lifecycleCommandControls.controls.map((control) => ({
        command: control.command,
        enabled: control.enabled,
        disabledReason: control.disabledReason,
        requiredPermission: control.requiredPermission,
        payloadContract: control.payloadContract
      }))
    },
    auditExport: {
      ...routeEnvelope,
      routeName: 'auditExport',
      method: 'GET',
      href: '/verifier-claim-gate/truth-boundary/preview#audit-export',
      exportKey: analyticsReporting.exportReadySummary.exportKey,
      schemaVersion: analyticsReporting.exportReadySummary.schemaVersion,
      requested: analyticsReporting.exportReadySummary.requested,
      disposition: analyticsReporting.exportReadySummary.disposition,
      safeExportAllowed: analyticsReporting.exportReadySummary.safeExportAllowed,
      auditHandoffAllowed: analyticsReporting.exportReadySummary.auditHandoffAllowed,
      exportAccepted: analyticsReporting.exportReadySummary.exportAccepted,
      contentType: analyticsReporting.exportReadySummary.contentType,
      fileName: analyticsReporting.exportReadySummary.fileName,
      format: analyticsReporting.exportReadySummary.format,
      selectedSections: analyticsReporting.exportReadySummary.selectedSections,
      omittedSections: analyticsReporting.exportReadySummary.omittedSections,
      workspaceBoundaryDecision: analyticsReporting.exportReadySummary.workspaceBoundaryDecision,
      workspaceBoundaryRejectedResources: analyticsReporting.exportReadySummary.workspaceBoundaryRejectedResources,
      rowCount: analyticsReporting.exportReadySummary.rowCount,
      availableRowCount: analyticsReporting.exportReadySummary.availableRowCount,
      snapshotSequence: persistedStateUpdate.snapshotSequence
    }
  };
}

function normalizeNonNegativeCounter(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeAnalyticsHistory(input, workspaceScope, issues) {
  const history = Array.isArray(input.analyticsHistory)
    ? input.analyticsHistory
    : Array.isArray(input.historySnapshots)
      ? input.historySnapshots
      : [];

  return history.slice(-12).map((snapshot, index) => {
    const record = asRecord(snapshot);
    const path = `analyticsHistory[${index}]`;
    const counters = asRecord(record.counters);
    const capturedAt = normalizeIsoTimestamp(
      record.capturedAt ?? record.generatedAt,
      issues,
      `${path}.capturedAt`,
      'invalid_analytics_history_captured_at'
    );
    const tenantId = asNonEmptyString(record.tenantId) || workspaceScope.tenantId;
    const workspaceId = asNonEmptyString(record.workspaceId) || workspaceScope.workspaceId;
    const inScope = tenantId === workspaceScope.tenantId && workspaceId === workspaceScope.workspaceId;
    const snapshotSequence = record.snapshotSequence === undefined ? index : record.snapshotSequence;

    if (!Number.isInteger(snapshotSequence) || snapshotSequence < 0) {
      issues.push({
        code: 'invalid_analytics_history_snapshot_sequence',
        path: `${path}.snapshotSequence`,
        message: 'analytics history snapshotSequence must be a non-negative integer'
      });
    }

    if (!inScope) {
      issues.push({
        code: 'out_of_scope_analytics_history_snapshot',
        path,
        message: `analytics history snapshot ${index} is outside the active workspace scope`
      });
    }

    return {
      contractVersion: 'truth-boundary.analytics-history-snapshot.v1',
      index,
      snapshotSequence: Number.isInteger(snapshotSequence) && snapshotSequence >= 0 ? snapshotSequence : index,
      capturedAt,
      tenantId,
      workspaceId,
      inScope,
      readinessState: asNonEmptyString(record.readinessState) || 'unknown',
      decision: asNonEmptyString(record.decision) || 'unknown',
      counters: {
        evaluations: normalizeNonNegativeCounter(counters.evaluations),
        accepted: normalizeNonNegativeCounter(counters.accepted),
        blocked: normalizeNonNegativeCounter(counters.blocked),
        denied: normalizeNonNegativeCounter(counters.denied),
        exported: normalizeNonNegativeCounter(counters.exported)
      }
    };
  });
}

function normalizeAnalyticsExportRequest(input, workspaceScope, accessPolicy, issues) {
  const request = asRecord(input.request);
  const exportInput = asRecord(input.analyticsExport ?? input.exportRequest ?? request.analyticsExport);
  const requested = Boolean(
    exportInput.requested === true
    || request.exportAnalytics === true
    || accessPolicy.requestedAction === 'createHandoff' && exportInput.includeInHandoff === true
  );
  const format = analyticsExportFormats.has(exportInput.format) ? exportInput.format : 'json-lines';
  const requestedSections = normalizeStringList(exportInput.sections);
  const allowedSections = requestedSections.length > 0
    ? requestedSections.filter((section) => analyticsExportSections.has(section))
    : Array.from(analyticsExportSections);
  const unknownSections = requestedSections.filter((section) => !analyticsExportSections.has(section));
  const maxRows = exportInput.maxRows === undefined || exportInput.maxRows === null
    ? null
    : exportInput.maxRows;
  const includeRows = normalizeBoolean(exportInput.includeRows, true);
  const includeTimeline = normalizeBoolean(exportInput.includeTimeline, true);
  const includeHistory = normalizeBoolean(exportInput.includeHistory, false);
  const tenantId = asNonEmptyString(exportInput.tenantId) || workspaceScope.tenantId;
  const workspaceId = asNonEmptyString(exportInput.workspaceId) || workspaceScope.workspaceId;
  const tenantMatches = tenantId === workspaceScope.tenantId;
  const workspaceMatches = workspaceId === workspaceScope.workspaceId;
  const scopeMatches = tenantMatches && workspaceMatches;
  const hasAuditRead = accessPolicy.permissions.includes('truthBoundary.audit.read');

  if (exportInput.format !== undefined && !analyticsExportFormats.has(exportInput.format)) {
    issues.push({
      code: 'invalid_analytics_export_format',
      path: 'analyticsExport.format',
      message: `analytics export format must be one of ${Array.from(analyticsExportFormats).join(', ')}`
    });
  }

  if (unknownSections.length > 0) {
    issues.push({
      code: 'invalid_analytics_export_section',
      path: 'analyticsExport.sections',
      message: `analytics export sections are not supported: ${unknownSections.join(', ')}`
    });
  }

  if (maxRows !== null && (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 250)) {
    issues.push({
      code: 'invalid_analytics_export_max_rows',
      path: 'analyticsExport.maxRows',
      message: 'analytics export maxRows must be null or an integer from 1 to 250'
    });
  }

  if (workspaceScope.strictTenantIsolation && !tenantMatches) {
    issues.push({
      code: 'cross_tenant_analytics_export_rejected',
      path: 'analyticsExport.tenantId',
      message: `analytics export tenant ${tenantId} does not match active tenant ${workspaceScope.tenantId}`
    });
  }

  if (!workspaceMatches) {
    issues.push({
      code: 'cross_workspace_analytics_export_rejected',
      path: 'analyticsExport.workspaceId',
      message: `analytics export workspace ${workspaceId} does not match active workspace ${workspaceScope.workspaceId}`
    });
  }

  if (requested && !hasAuditRead) {
    issues.push({
      code: 'missing_analytics_export_permission',
      path: 'actor.permissions',
      message: 'analytics export requires truthBoundary.audit.read'
    });
  }

  return {
    contractVersion: 'truth-boundary.analytics-export-request.v1',
    requested,
    format,
    includeRows,
    includeTimeline,
    includeHistory,
    tenantId,
    workspaceId,
    scopeMatches,
    allowedSections,
    unknownSections,
    maxRows: Number.isInteger(maxRows) && maxRows >= 1 && maxRows <= 250 ? maxRows : null,
    requestedBy: accessPolicy.actorId,
    permission: {
      required: 'truthBoundary.audit.read',
      granted: hasAuditRead
    }
  };
}

function counterDelta(previousCounters, currentCounters, key) {
  const previousValue = normalizeNonNegativeCounter(previousCounters?.[key]);
  const currentValue = normalizeNonNegativeCounter(currentCounters?.[key]);
  return {
    key,
    previous: previousValue,
    current: currentValue,
    delta: currentValue - previousValue
  };
}

function buildAnalyticsTrend(previous, currentSnapshot, readiness, proof, operationalHealth, validationSummary) {
  const baseDeltas = ['evaluations', 'accepted', 'blocked', 'denied', 'exported']
    .map((key) => counterDelta(previous?.counters, currentSnapshot.counters, key));
  const acceptedDelta = baseDeltas.find((delta) => delta.key === 'accepted')?.delta || 0;
  const blockedDelta = baseDeltas.find((delta) => delta.key === 'blocked')?.delta || 0;
  const deniedDelta = baseDeltas.find((delta) => delta.key === 'denied')?.delta || 0;
  const direction = proof.decision === 'allowed' && readiness.canAccept
    ? 'improved'
    : blockedDelta > 0 || deniedDelta > 0 || validationSummary.errorCount > 0 || operationalHealth.status === 'blocked'
      ? 'regressed'
      : acceptedDelta > 0
        ? 'improved'
        : 'steady';

  return {
    contractVersion: 'truth-boundary.analytics-trend.v1',
    comparedSnapshotSequence: previous?.snapshotSequence ?? null,
    currentSnapshotSequence: currentSnapshot.snapshotSequence,
    direction,
    decisionChanged: Boolean(previous && previous.decision !== currentSnapshot.decision),
    readinessChanged: Boolean(previous && previous.readinessState !== currentSnapshot.readinessState),
    deltas: baseDeltas,
    reportableDeltaCount: baseDeltas.filter((delta) => delta.delta !== 0).length
  };
}

function summarizeTimelineEvents(timeline) {
  const eventCountsByKind = timeline.reduce((accumulator, event) => {
    accumulator[event.kind] = (accumulator[event.kind] || 0) + 1;
    return accumulator;
  }, {});

  return {
    contractVersion: 'truth-boundary.timeline-report.v1',
    eventCount: timeline.length,
    eventCountsByKind,
    firstEventAt: timeline[0]?.at || null,
    latestEventAt: timeline[timeline.length - 1]?.at || null,
    latestEvent: timeline[timeline.length - 1] || null,
    events: timeline.map((event, index) => ({
      ...event,
      sequence: index + 1
    }))
  };
}

function deriveWorkspaceBoundaryManifest(workspaceScope, accessPolicy, claims, evidence, providerContracts, handoffReceipts, analyticsHistorySnapshots, issues, now) {
  const resourceGroups = [
    {
      type: 'claim',
      path: 'claims',
      resources: claims,
      idFor: (claim) => claim.claimId,
      inScopeFor: (claim) => claim.inScope,
      scopeStatusFor: (claim) => claim.scopeStatus
    },
    {
      type: 'evidence',
      path: 'evidence',
      resources: evidence,
      idFor: (item) => `${item.claimId}:${item.index}`,
      inScopeFor: (item) => item.inScope,
      scopeStatusFor: (item) => item.scopeStatus
    },
    {
      type: 'providerContract',
      path: 'providerContracts',
      resources: providerContracts,
      idFor: (provider) => provider.providerId,
      inScopeFor: (provider) => provider.scopeStatus === 'accepted',
      scopeStatusFor: (provider) => provider.scopeStatus
    },
    {
      type: 'externalHandoffReceipt',
      path: 'externalHandoffs',
      resources: handoffReceipts,
      idFor: (receipt) => receipt.handoffId,
      inScopeFor: (receipt) => receipt.scopeStatus === 'accepted',
      scopeStatusFor: (receipt) => receipt.scopeStatus
    },
    {
      type: 'analyticsHistory',
      path: 'analyticsHistory',
      resources: analyticsHistorySnapshots,
      idFor: (snapshot) => `snapshot-${snapshot.snapshotSequence}`,
      inScopeFor: (snapshot) => snapshot.inScope,
      scopeStatusFor: (snapshot) => snapshot.inScope ? 'accepted' : 'rejected'
    }
  ];
  const groups = resourceGroups.map((group) => {
    const scopedResources = group.resources.filter((resource) => group.inScopeFor(resource));
    const rejectedResources = group.resources.filter((resource) => !group.inScopeFor(resource));

    return {
      contractVersion: 'truth-boundary.workspace-boundary-resource-group.v1',
      type: group.type,
      path: group.path,
      total: group.resources.length,
      accepted: scopedResources.length,
      rejected: rejectedResources.length,
      acceptedIds: scopedResources.map(group.idFor),
      rejectedRefs: rejectedResources.map((resource) => ({
        id: group.idFor(resource),
        tenantId: resource.tenantId,
        workspaceId: resource.workspaceId,
        scopeStatus: group.scopeStatusFor(resource)
      }))
    };
  });
  const rejectedGroups = groups.filter((group) => group.rejected > 0);
  const mutatingRequest = mutatingClientActions.has(accessPolicy.requestedAction);
  const boundaryViolation = rejectedGroups.length > 0;
  const strictRejectionApplies = workspaceScope.strictTenantIsolation || mutatingRequest;

  if (mutatingRequest && boundaryViolation) {
    issues.push({
      code: 'cross_workspace_mutating_payload_rejected',
      path: rejectedGroups.map((group) => group.path).join(','),
      message: `${accessPolicy.requestedAction} cannot process out-of-scope truth-boundary resource(s)`
    });
  }

  return {
    contractVersion: 'truth-boundary.workspace-boundary-manifest.v1',
    generatedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    strictTenantIsolation: workspaceScope.strictTenantIsolation,
    requestedAction: accessPolicy.requestedAction,
    mutatingRequest,
    decision: boundaryViolation && strictRejectionApplies ? 'rejected' : 'accepted',
    safeExportAllowed: !boundaryViolation && accessPolicy.decision === 'allowed',
    auditHandoffAllowed: accessPolicy.decision === 'allowed' && (!mutatingRequest || !boundaryViolation),
    rejectedResourceCount: rejectedGroups.reduce((sum, group) => sum + group.rejected, 0),
    acceptedResourceCount: groups.reduce((sum, group) => sum + group.accepted, 0),
    rejectedPaths: rejectedGroups.map((group) => group.path),
    groups
  };
}

function buildAnalyticsReporting(historySnapshots, analyticsExportRequest, lifecycle, validationSummary, readiness, proof, operationalHealth, claimCoverage, providerContracts, providerServicePlan, externalHandoffExchange, accessPolicy, persistedState, persistedStateUpdate, workflowHandoff, workspaceScope, workspaceBoundaryManifest, clientHandoffSubmission, now) {
  const scopedHistory = historySnapshots.filter((snapshot) => snapshot.inScope);
  const previous = scopedHistory[scopedHistory.length - 1] || null;
  const exportScopeAllowed = analyticsExportRequest.scopeMatches && analyticsExportRequest.permission.granted;
  const exportTransportAllowed = workspaceBoundaryManifest.safeExportAllowed || workspaceBoundaryManifest.auditHandoffAllowed;
  const exportAccepted = Boolean(analyticsExportRequest.requested && exportScopeAllowed && exportTransportAllowed);
  const exportDisposition = !analyticsExportRequest.requested
    ? 'staged_preview'
    : !analyticsExportRequest.permission.granted
      ? 'blocked_missing_audit_permission'
      : !analyticsExportRequest.scopeMatches
        ? 'blocked_scope_mismatch'
        : workspaceBoundaryManifest.safeExportAllowed
          ? 'ready_for_safe_export'
          : workspaceBoundaryManifest.auditHandoffAllowed
            ? 'ready_for_audit_handoff'
            : 'blocked_by_workspace_boundary';
  const currentCounters = {
    evaluations: (previous?.counters.evaluations || 0) + (lifecycle.commandPersistence.replayed ? 0 : 1),
    accepted: (previous?.counters.accepted || 0) + (readiness.canAccept ? 1 : 0),
    blocked: (previous?.counters.blocked || 0) + (proof.decision === 'blocked' ? 1 : 0),
    denied: (previous?.counters.denied || 0) + (accessPolicy.decision === 'denied' ? 1 : 0),
    exported: (previous?.counters.exported || 0) + (exportAccepted && !lifecycle.commandPersistence.replayed ? 1 : 0)
  };
  const gateStates = readiness.gates.reduce((accumulator, gate) => {
    accumulator[gate.id] = gate.state;
    return accumulator;
  }, {});
  const providerSyncCounts = providerContracts.reduce((accumulator, provider) => {
    accumulator[provider.sync.status] = (accumulator[provider.sync.status] || 0) + 1;
    return accumulator;
  }, {});
  const timeline = [
    persistedState.lastEvaluatedAt && {
      id: 'last-evaluated',
      at: persistedState.lastEvaluatedAt,
      kind: 'history',
      label: 'Previous evaluation',
      state: persistedState.status
    },
    persistedState.lastAcceptedAt && {
      id: 'last-accepted',
      at: persistedState.lastAcceptedAt,
      kind: 'history',
      label: 'Previous acceptance',
      state: 'accepted'
    },
    lifecycle.commandPersistence.appliedAt && {
      id: 'command-applied',
      at: lifecycle.commandPersistence.appliedAt,
      kind: 'command',
      label: lifecycle.command,
      state: lifecycle.commandPersistence.status
    },
    {
      id: 'current-evaluation',
      at: now,
      kind: 'evaluation',
      label: proof.decision,
      state: readiness.state
    },
    workflowHandoff.targetRoute && {
      id: 'workflow-handoff',
      at: now,
      kind: 'handoff',
      label: workflowHandoff.targetRoute,
      state: workflowHandoff.state
    },
    operationalHealth.retry.nextRetryAfterSeconds !== null && {
      id: 'provider-retry',
      at: now,
      kind: 'retry',
      label: 'provider sync retry',
      state: `${operationalHealth.retry.nextRetryAfterSeconds}s`
    }
  ]
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const currentSnapshot = {
    contractVersion: 'truth-boundary.analytics-history-snapshot.v1',
    snapshotSequence: persistedStateUpdate.snapshotSequence,
    capturedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    inScope: true,
    readinessState: readiness.state,
    decision: proof.decision,
    counters: currentCounters
  };
  const trend = buildAnalyticsTrend(previous, currentSnapshot, readiness, proof, operationalHealth, validationSummary);
  const timelineReport = summarizeTimelineEvents(timeline);
  const allExportRows = [
    { name: 'decision', value: proof.decision, valueType: 'string', section: 'decision' },
    { name: 'readinessState', value: readiness.state, valueType: 'string', section: 'readiness' },
    { name: 'accessDecision', value: accessPolicy.decision, valueType: 'string', section: 'access' },
    { name: 'operationalHealth', value: operationalHealth.status, valueType: 'string', section: 'provider-health' },
    { name: 'claimCoverageDecision', value: claimCoverage.decision, valueType: 'string', section: 'claim-coverage' },
    { name: 'providerServicePlanDecision', value: providerServicePlan.decision, valueType: 'string', section: 'provider-plan' },
    { name: 'handoffDispatchState', value: providerServicePlan.handoffDispatch.state, valueType: 'string', section: 'handoff' },
    { name: 'externalHandoffExchangeState', value: externalHandoffExchange.state, valueType: 'string', section: 'handoff' },
    { name: 'clientHandoffSubmissionState', value: clientHandoffSubmission.state, valueType: 'string', section: 'handoff' },
    { name: 'workspaceBoundaryDecision', value: workspaceBoundaryManifest.decision, valueType: 'string', section: 'workspace-boundary' },
    { name: 'workspaceBoundaryRejectedResources', value: workspaceBoundaryManifest.rejectedResourceCount, valueType: 'integer', section: 'workspace-boundary' },
    { name: 'handoffDispatchRequestCount', value: externalHandoffExchange.dispatchRequestCount, valueType: 'integer', section: 'handoff' },
    { name: 'timelineEventCount', value: timelineReport.eventCount, valueType: 'integer', section: 'timeline' },
    { name: 'analyticsTrendDirection', value: trend.direction, valueType: 'string', section: 'analytics' },
    { name: 'workflowTargetRoute', value: workflowHandoff.targetRoute, valueType: 'string', section: 'workflow' },
    { name: 'snapshotSequence', value: persistedStateUpdate.snapshotSequence, valueType: 'integer', section: 'persistence' }
  ];
  const selectedRows = allExportRows
    .filter((row) => analyticsExportRequest.allowedSections.includes(row.section))
    .slice(0, analyticsExportRequest.maxRows || allExportRows.length);
  const contentType = analyticsExportRequest.format === 'csv'
    ? 'text/csv'
    : 'application/x-ndjson';
  const fileExtension = analyticsExportRequest.format === 'csv' ? 'csv' : 'jsonl';
  const exportFileName = `truth-boundary-${workspaceScope.workspaceId}-${persistedStateUpdate.snapshotSequence}.${fileExtension}`;

  return {
    contractVersion: 'truth-boundary.analytics-reporting.v1',
    generatedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    counters: {
      ...currentCounters,
      validationErrors: validationSummary.errorCount,
      validationWarnings: validationSummary.warningCount,
      failedReadinessGates: readiness.failedGateCount,
      pendingReadinessGates: readiness.pendingGateCount,
      declaredClaims: claimCoverage.claimCount,
      requiredClaims: claimCoverage.requiredClaimCount,
      sourceBackedClaims: claimCoverage.sourceBackedClaimCount,
      blockingClaims: claimCoverage.blockingClaimIds.length,
      providers: providerContracts.length,
      unhealthyProviders: operationalHealth.unhealthyProviderIds.length,
      providerOperations: providerServicePlan.operationCount,
      readyProviderOperations: providerServicePlan.readyOperationCount,
      blockedProviderOperations: providerServicePlan.blockedRequiredOperationIds.length,
      waitingProviderOperations: providerServicePlan.waitingOperationIds.length,
      handoffReceipts: externalHandoffExchange.receiptCount,
      handoffDispatchRequests: externalHandoffExchange.dispatchRequestCount,
      handoffSubmissionsAccepted: clientHandoffSubmission.accepted ? 1 : 0,
      acknowledgedHandoffReceipts: externalHandoffExchange.acknowledgedReceiptIds.length,
      failedHandoffReceipts: externalHandoffExchange.failedReceiptIds.length,
      workspaceBoundaryAcceptedResources: workspaceBoundaryManifest.acceptedResourceCount,
      workspaceBoundaryRejectedResources: workspaceBoundaryManifest.rejectedResourceCount
    },
    providerSyncCounts,
    gateStates,
    historySnapshots,
    currentSnapshot,
    trend,
    timeline,
    timelineReport,
    reportingState: {
      contractVersion: 'truth-boundary.analytics-reporting-state.v1',
      snapshotAction: lifecycle.commandPersistence.replayed ? 'retain_existing_snapshot' : 'append_history_snapshot',
      historyDepth: scopedHistory.length,
      retainedHistoryDepth: Math.min(scopedHistory.length + (lifecycle.commandPersistence.replayed ? 0 : 1), 12),
      previousSnapshotSequence: previous?.snapshotSequence ?? null,
      currentSnapshotSequence: currentSnapshot.snapshotSequence,
      exportState: exportDisposition,
      exportRequested: analyticsExportRequest.requested,
      exportAccepted,
      trendDirection: trend.direction,
      decisionChanged: trend.decisionChanged,
      readinessChanged: trend.readinessChanged,
      timelineEventCount: timelineReport.eventCount
    },
    handoffSubmission: {
      contractVersion: clientHandoffSubmission.contractVersion,
      state: clientHandoffSubmission.state,
      accepted: clientHandoffSubmission.accepted,
      dispatchRequestCount: clientHandoffSubmission.dispatchRequestIds.length,
      rejectedDispatchRequestCount: clientHandoffSubmission.unknownDispatchIds.length,
      rejectedProviderCount: clientHandoffSubmission.unknownProviderIds.length,
      receiptSeed: clientHandoffSubmission.receiptSeed
    },
    exportReadySummary: {
      format: analyticsExportRequest.format,
      schemaVersion: 'truth-boundary.analytics-export.v1',
      exportKey: `${surfaceId}:${workspaceScope.tenantId}:${workspaceScope.workspaceId}:${persistedStateUpdate.snapshotSequence}`,
      requested: analyticsExportRequest.requested,
      disposition: exportDisposition,
      generatedBy: {
        surfaceId,
        requestId: workflowHandoff.payload.requestId,
        correlationId: workflowHandoff.payload.correlationId,
        snapshotSequence: persistedStateUpdate.snapshotSequence
      },
      request: analyticsExportRequest,
      safeExportAllowed: workspaceBoundaryManifest.safeExportAllowed,
      auditHandoffAllowed: workspaceBoundaryManifest.auditHandoffAllowed,
      workspaceBoundaryDecision: workspaceBoundaryManifest.decision,
      workspaceBoundaryRejectedResources: workspaceBoundaryManifest.rejectedResourceCount,
      exportAccepted,
      contentType,
      fileName: exportFileName,
      rowCount: selectedRows.length,
      availableRowCount: allExportRows.length,
      columns: ['name', 'value', 'valueType', 'section'],
      selectedSections: analyticsExportRequest.allowedSections,
      omittedSections: Array.from(analyticsExportSections).filter((section) => !analyticsExportRequest.allowedSections.includes(section)),
      redactions: workspaceBoundaryManifest.safeExportAllowed ? [] : ['out_of_scope_workspace_resources'],
      rows: analyticsExportRequest.includeRows ? selectedRows : [],
      rowPreview: selectedRows.slice(0, 5),
      timelineIncluded: analyticsExportRequest.includeTimeline,
      historyIncluded: analyticsExportRequest.includeHistory,
      timeline: analyticsExportRequest.includeTimeline ? timelineReport.events : [],
      history: analyticsExportRequest.includeHistory ? scopedHistory : []
    }
  };
}

export function describeTruthBoundarySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const issues = [];
  const clientRuntime = normalizeClientRuntime(input, issues);
  const workspaceScope = normalizeWorkspaceScope(input, clientRuntime, issues);
  const analyticsHistorySnapshots = normalizeAnalyticsHistory(input, workspaceScope, issues);
  const accessPolicy = normalizeAccessPolicy(input, clientRuntime, workspaceScope, issues, now);
  const analyticsExportRequest = normalizeAnalyticsExportRequest(input, workspaceScope, accessPolicy, issues);
  const baseSettings = normalizeSettings(input, issues);
  const lifecycleCommand = normalizeLifecycleCommand(input, issues);
  const rawPersistedState = normalizePersistedBoundaryState(input, issues);
  const persistedRecoveryPlan = derivePersistedRecoveryPlan(rawPersistedState, workspaceScope, clientRuntime, lifecycleCommand, now, issues);
  const persistedState = persistedStateForRecovery(rawPersistedState, persistedRecoveryPlan);
  const commandPersistence = deriveCommandPersistence(clientRuntime, lifecycleCommand, persistedState, now);
  const settings = recoverSettingsFromPersistedState(baseSettings, lifecycleCommand, persistedState);
  const claims = normalizeClaims(input, workspaceScope, issues);
  const evidence = normalizeEvidence(input, workspaceScope, issues);
  const claimCoverage = deriveClaimCoverage(claims, evidence, settings, issues);
  const lifecycle = deriveLifecycleState(lifecycleCommand, settings, evidence, issues, now, commandPersistence, persistedState);
  const providerContracts = normalizeProviderContracts(input, issues, workspaceScope);
  const capabilityNegotiation = negotiateProviderCapabilities(providerContracts);
  const externalHandoff = deriveExternalHandoffState(lifecycle, providerContracts, capabilityNegotiation, now);
  const providerServicePlan = deriveProviderServicePlan(providerContracts, capabilityNegotiation, externalHandoff, now);
  const externalHandoffReceipts = normalizeExternalHandoffReceipts(input, providerContracts, workspaceScope, issues);
  const externalHandoffExchange = deriveExternalHandoffExchange(externalHandoff, externalHandoffReceipts, providerServicePlan, clientRuntime.correlationId, now);
  const workspaceBoundaryManifest = deriveWorkspaceBoundaryManifest(
    workspaceScope,
    accessPolicy,
    claims,
    evidence,
    providerContracts,
    externalHandoffReceipts,
    analyticsHistorySnapshots,
    issues,
    now
  );
  const operationalHealth = deriveOperationalHealth(providerContracts, capabilityNegotiation, accessPolicy, now);
  let proof = buildProof(settings, lifecycle, issues, capabilityNegotiation, externalHandoff, accessPolicy, workspaceScope, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, null);
  const validationSummary = summarizeValidation(issues, lifecycle, capabilityNegotiation, accessPolicy, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange);
  const readiness = deriveReadiness(lifecycle, capabilityNegotiation, validationSummary, externalHandoff, accessPolicy, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange);
  const nextSteps = buildNextSteps(lifecycle, capabilityNegotiation, validationSummary, externalHandoff, readiness, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange);
  const workflowHandoff = buildWorkflowHandoff(clientRuntime, lifecycle, validationSummary, readiness, externalHandoff, nextSteps, accessPolicy, workspaceScope, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, now);
  const persistedStateUpdate = buildPersistedStateUpdate(persistedState, persistedRecoveryPlan, lifecycle, readiness, workflowHandoff, workspaceScope, operationalHealth, providerServicePlan, externalHandoffExchange, now);
  const clientHandoffSubmission = normalizeClientHandoffSubmission(
    input,
    clientRuntime,
    workspaceScope,
    externalHandoffExchange,
    persistedStateUpdate,
    issues,
    now
  );
  persistedStateUpdate.clientHandoffSubmission = {
    state: clientHandoffSubmission.state,
    accepted: clientHandoffSubmission.accepted,
    routeName: clientHandoffSubmission.routeName,
    expectedContinuationToken: clientHandoffSubmission.expectedContinuationToken,
    dispatchRequestIds: clientHandoffSubmission.dispatchRequestIds,
    receiptSeed: clientHandoffSubmission.receiptSeed
  };
  proof = buildProof(settings, lifecycle, issues, capabilityNegotiation, externalHandoff, accessPolicy, workspaceScope, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, clientHandoffSubmission);
  const lifecycleCommandControls = buildLifecycleCommandControls(settings, lifecycle, accessPolicy, validationSummary, readiness, persistedStateUpdate, nextSteps, now);
  const previewAcceptance = buildPreviewAcceptance(settings, lifecycle, validationSummary, readiness, proof, nextSteps, workflowHandoff, operationalHealth, claimCoverage, providerServicePlan, externalHandoffExchange, lifecycleCommandControls, now);
  const analyticsReporting = buildAnalyticsReporting(analyticsHistorySnapshots, analyticsExportRequest, lifecycle, validationSummary, readiness, proof, operationalHealth, claimCoverage, providerContracts, providerServicePlan, externalHandoffExchange, accessPolicy, persistedState, persistedStateUpdate, workflowHandoff, workspaceScope, workspaceBoundaryManifest, clientHandoffSubmission, now);
  persistedStateUpdate.analyticsReporting = {
    contractVersion: 'truth-boundary.persisted-analytics-reporting.v1',
    currentSnapshot: analyticsReporting.currentSnapshot,
    exportRequested: analyticsReporting.reportingState.exportRequested,
    exportAccepted: analyticsReporting.reportingState.exportAccepted,
    exportState: analyticsReporting.reportingState.exportState,
    exportKey: analyticsReporting.exportReadySummary.exportKey,
    selectedSections: analyticsReporting.exportReadySummary.selectedSections,
    rowCount: analyticsReporting.exportReadySummary.rowCount,
    timelineEventCount: analyticsReporting.timelineReport.eventCount
  };
  const operatorDecisionPacket = buildOperatorDecisionPacket(
    previewAcceptance,
    validationSummary,
    readiness,
    proof,
    nextSteps,
    workflowHandoff,
    persistedStateUpdate,
    accessPolicy,
    claimCoverage,
    providerServicePlan,
    externalHandoffExchange,
    now
  );
  const clientRouteDataContracts = buildClientRouteDataContracts(
    clientRuntime,
    previewAcceptance,
    validationSummary,
    readiness,
    proof,
    nextSteps,
    workflowHandoff,
    persistedStateUpdate,
    analyticsReporting,
    lifecycleCommandControls,
    accessPolicy,
    claimCoverage,
    externalHandoffExchange,
    operatorDecisionPacket,
    clientHandoffSubmission,
    now
  );
  previewAcceptance.counters.analyticsEvaluations = analyticsReporting.counters.evaluations;
  previewAcceptance.counters.analyticsAccepted = analyticsReporting.counters.accepted;
  previewAcceptance.counters.analyticsBlocked = analyticsReporting.counters.blocked;
  previewAcceptance.counters.analyticsDenied = analyticsReporting.counters.denied;
  previewAcceptance.counters.analyticsExports = analyticsReporting.counters.exported;

  return {
    ok: validationSummary.readyForDecision && (!clientHandoffSubmission.present || clientHandoffSubmission.accepted),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      version: 'truth-boundary.lifecycle.v1',
      commands: Array.from(lifecycleCommands),
      providerContractVersion: 'truth-boundary.provider-contract.v1',
      settings,
      workspaceScope,
      accessPolicy,
      rawPersistedState,
      persistedRecoveryPlan,
      persistedState,
      persistedStateUpdate,
      lifecycleCommandControls,
      clientRuntime,
      lifecycle,
      claims,
      claimCoverage,
      providers: providerContracts,
      capabilityNegotiation,
      providerServicePlan,
      operationalHealth,
      externalHandoff,
      externalHandoffReceipts,
      externalHandoffExchange,
      clientHandoffSubmission,
      workspaceBoundaryManifest,
      workflowHandoff,
      analyticsExportRequest,
      analyticsReporting,
      clientRouteDataContracts,
      operatorDecisionPacket,
      validationSummary,
      readiness,
      previewAcceptance,
      nextSteps,
      routes: {
        preview: 'GET /verifier-claim-gate/truth-boundary/preview',
        accept: 'POST /verifier-claim-gate/truth-boundary/acceptance',
        evidence: 'POST /verifier-claim-gate/truth-boundary/evidence',
        providerContracts: 'PUT /verifier-claim-gate/truth-boundary/provider-contracts',
        providerSync: 'POST /verifier-claim-gate/truth-boundary/provider-contracts/sync',
        handoffs: 'POST /verifier-claim-gate/truth-boundary/handoffs'
      },
      nextAction: lifecycle.nextAction
    },
    claims,
    evidence,
    audit: {
      accepted: validationSummary.valid && (!clientHandoffSubmission.present || clientHandoffSubmission.accepted),
      issueCount: validationSummary.issueCount,
      issues,
      validationSummary,
      readinessState: readiness.state,
      workspaceScope: {
        tenantId: workspaceScope.tenantId,
        workspaceId: workspaceScope.workspaceId,
        strictTenantIsolation: workspaceScope.strictTenantIsolation
      },
      workspaceBoundaryManifest: {
        decision: workspaceBoundaryManifest.decision,
        requestedAction: workspaceBoundaryManifest.requestedAction,
        mutatingRequest: workspaceBoundaryManifest.mutatingRequest,
        safeExportAllowed: workspaceBoundaryManifest.safeExportAllowed,
        auditHandoffAllowed: workspaceBoundaryManifest.auditHandoffAllowed,
        acceptedResourceCount: workspaceBoundaryManifest.acceptedResourceCount,
        rejectedResourceCount: workspaceBoundaryManifest.rejectedResourceCount,
        rejectedPaths: workspaceBoundaryManifest.rejectedPaths,
        groups: workspaceBoundaryManifest.groups
      },
      accessPolicy: {
        actorId: accessPolicy.actorId,
        role: accessPolicy.role,
        decision: accessPolicy.decision,
        decisionReason: accessPolicy.decisionReason,
        requestedAction: accessPolicy.requestedAction,
        requiredPermission: accessPolicy.requiredPermission,
        actorScope: accessPolicy.actorScope,
        activeGrantCount: accessPolicy.activePermissionGrants.length,
        deniedGrantReasons: accessPolicy.deniedGrantReasons
      },
      persistedState: {
        recoveredFromStorage: persistedState.recoveredFromStorage,
        rawRecoveredFromStorage: rawPersistedState.recoveredFromStorage,
        recoveryPlan: persistedRecoveryPlan,
        commandStatus: commandPersistence.status,
        writeDisposition: persistedStateUpdate.writeDisposition,
        nextSnapshotSequence: persistedStateUpdate.snapshotSequence,
        restartSafeStatus: persistedStateUpdate.status,
        recovery: persistedStateUpdate.recovery,
        persistenceGuard: persistedStateUpdate.persistenceGuard,
        controlState: persistedStateUpdate.controlState,
        scheduleControl: persistedStateUpdate.scheduleControl,
        lifecycleTransition: persistedStateUpdate.lifecycleTransition,
        operationalHealth: persistedStateUpdate.operationalHealth,
        providerServicePlan: persistedStateUpdate.providerServicePlan,
        externalHandoffExchange: persistedStateUpdate.externalHandoffExchange,
        clientHandoffSubmission: persistedStateUpdate.clientHandoffSubmission
      },
      lifecycleControls: {
        command: lifecycle.command,
        controlState: lifecycle.controlState,
        nextAction: lifecycle.nextAction,
        enabled: lifecycle.enabled,
        transition: lifecycle.transition,
        scheduleControl: lifecycle.scheduleControl,
        commandControls: lifecycleCommandControls
      },
      operationalHealth: {
        status: operationalHealth.status,
        degradedMode: operationalHealth.degradedMode,
        decisionImpact: operationalHealth.decisionImpact,
        retry: operationalHealth.retry,
        actionableErrors: operationalHealth.actionableErrors
      },
      claimCoverage: {
        decision: claimCoverage.decision,
        claimCount: claimCoverage.claimCount,
        requiredClaimCount: claimCoverage.requiredClaimCount,
        sourceBackedClaimCount: claimCoverage.sourceBackedClaimCount,
        blockingClaimIds: claimCoverage.blockingClaimIds,
        orphanEvidenceClaimIds: claimCoverage.orphanEvidenceClaimIds
      },
      workflowHandoff: {
        state: workflowHandoff.state,
        targetRoute: workflowHandoff.targetRoute,
        recommendedAction: workflowHandoff.recommendedAction,
        continuationToken: workflowHandoff.continuationToken,
        idempotencyKey: workflowHandoff.idempotencyKey
      },
      providerServicePlan: {
        decision: providerServicePlan.decision,
        operationCount: providerServicePlan.operationCount,
        readyOperationCount: providerServicePlan.readyOperationCount,
        blockedRequiredOperationIds: providerServicePlan.blockedRequiredOperationIds,
        waitingOperationIds: providerServicePlan.waitingOperationIds,
        handoffDispatch: providerServicePlan.handoffDispatch,
        operations: providerServicePlan.operations
      },
      externalHandoffExchange: {
        state: externalHandoffExchange.state,
        receiptCount: externalHandoffExchange.receiptCount,
        acknowledgedReceiptIds: externalHandoffExchange.acknowledgedReceiptIds,
        pendingReceiptIds: externalHandoffExchange.pendingReceiptIds,
        failedReceiptIds: externalHandoffExchange.failedReceiptIds,
        missingProviderIds: externalHandoffExchange.missingProviderIds,
        dispatchRequests: externalHandoffExchange.dispatchRequests,
        receipts: externalHandoffExchange.receipts
      },
      clientHandoffSubmission: {
        state: clientHandoffSubmission.state,
        accepted: clientHandoffSubmission.accepted,
        present: clientHandoffSubmission.present,
        expectedSnapshotSequence: clientHandoffSubmission.expectedSnapshotSequence,
        submittedSnapshotSequence: clientHandoffSubmission.snapshotSequence,
        expectedContinuationToken: clientHandoffSubmission.expectedContinuationToken,
        submittedContinuationToken: clientHandoffSubmission.continuationToken,
        dispatchRequestIds: clientHandoffSubmission.dispatchRequestIds,
        unknownDispatchIds: clientHandoffSubmission.unknownDispatchIds,
        unknownProviderIds: clientHandoffSubmission.unknownProviderIds,
        receiptContract: clientHandoffSubmission.receiptContract
      },
      analyticsReporting: {
        contractVersion: analyticsReporting.contractVersion,
        counters: analyticsReporting.counters,
        providerSyncCounts: analyticsReporting.providerSyncCounts,
        gateStates: analyticsReporting.gateStates,
        historySnapshotCount: analyticsReporting.historySnapshots.length,
        currentSnapshot: analyticsReporting.currentSnapshot,
        exportRequest: analyticsExportRequest,
        reportingState: analyticsReporting.reportingState,
        timeline: analyticsReporting.timeline,
        exportReadySummary: analyticsReporting.exportReadySummary
      },
      clientRouteDataContracts: {
        contractVersion: clientRouteDataContracts.contractVersion,
        activeRoute: clientRouteDataContracts.activeRoute,
        recommendedRoute: clientRouteDataContracts.recommendedRoute,
        preview: {
          routeName: clientRouteDataContracts.preview.routeName,
          href: clientRouteDataContracts.preview.href,
          decision: clientRouteDataContracts.preview.decision,
          readinessState: clientRouteDataContracts.preview.readinessState,
          visibleSections: clientRouteDataContracts.preview.visibleSections
        },
        acceptance: {
          routeName: clientRouteDataContracts.acceptance.routeName,
          href: clientRouteDataContracts.acceptance.href,
          enabled: clientRouteDataContracts.acceptance.enabled,
          blockedBy: clientRouteDataContracts.acceptance.blockedBy,
          payloadContract: clientRouteDataContracts.acceptance.payloadContract
        },
        validationSummary: {
          valid: clientRouteDataContracts.validationSummary.valid,
          readyForDecision: clientRouteDataContracts.validationSummary.readyForDecision,
          issueCodes: clientRouteDataContracts.validationSummary.issueCodes,
          runtimeBlockerCodes: clientRouteDataContracts.validationSummary.runtimeBlockerCodes
        },
        readiness: {
          state: clientRouteDataContracts.readiness.state,
          canAccept: clientRouteDataContracts.readiness.canAccept,
          score: clientRouteDataContracts.readiness.score,
          gateStates: clientRouteDataContracts.readiness.gateStates
        },
        nextSteps: {
          recommendedAction: clientRouteDataContracts.nextSteps.recommendedAction,
          blockingStepIds: clientRouteDataContracts.nextSteps.blockingStepIds,
          optionalStepIds: clientRouteDataContracts.nextSteps.optionalStepIds
        },
        handoffs: {
          exchangeState: clientRouteDataContracts.handoffs.exchangeState,
          submissionState: clientRouteDataContracts.handoffs.submissionState,
          submissionAccepted: clientRouteDataContracts.handoffs.submissionAccepted,
          submittedDispatchRequestIds: clientRouteDataContracts.handoffs.submittedDispatchRequestIds,
          rejectedDispatchRequestIds: clientRouteDataContracts.handoffs.rejectedDispatchRequestIds,
          rejectedProviderIds: clientRouteDataContracts.handoffs.rejectedProviderIds,
          submissionContract: clientRouteDataContracts.handoffs.submissionContract
        },
        lifecycleControls: {
          currentControlState: clientRouteDataContracts.lifecycleControls.currentControlState,
          enabled: clientRouteDataContracts.lifecycleControls.enabled,
          recommendedCommand: clientRouteDataContracts.lifecycleControls.recommendedCommand,
          recommendedCommandEnabled: clientRouteDataContracts.lifecycleControls.recommendedCommandEnabled,
          allowedCommands: clientRouteDataContracts.lifecycleControls.allowedCommands,
          blockedCommands: clientRouteDataContracts.lifecycleControls.blockedCommands,
          settingsPatch: clientRouteDataContracts.lifecycleControls.settingsPatch
        },
        auditExport: clientRouteDataContracts.auditExport
      },
      operatorDecisionPacket: {
        contractVersion: operatorDecisionPacket.contractVersion,
        snapshotSequence: operatorDecisionPacket.snapshotSequence,
        requestState: operatorDecisionPacket.requestState,
        preview: {
          headline: operatorDecisionPacket.preview.headline,
          decision: operatorDecisionPacket.preview.decision,
          readinessState: operatorDecisionPacket.preview.readinessState,
          score: operatorDecisionPacket.preview.score,
          cardCount: operatorDecisionPacket.preview.cards.length
        },
        acceptance: {
          enabled: operatorDecisionPacket.acceptance.enabled,
          blocked: operatorDecisionPacket.acceptance.blocked,
          blockedBy: operatorDecisionPacket.acceptance.blockedBy,
          submitContract: operatorDecisionPacket.acceptance.submitContract
        },
        validation: {
          valid: operatorDecisionPacket.validation.valid,
          readyForDecision: operatorDecisionPacket.validation.readyForDecision,
          errorCount: operatorDecisionPacket.validation.errorCount,
          warningCount: operatorDecisionPacket.validation.warningCount,
          failedGateIds: operatorDecisionPacket.validation.failedGateIds,
          pendingGateIds: operatorDecisionPacket.validation.pendingGateIds
        },
        nextSteps: {
          recommendedAction: operatorDecisionPacket.nextSteps.recommendedAction,
          blockingStepIds: operatorDecisionPacket.nextSteps.blockingStepIds,
          stepCount: operatorDecisionPacket.nextSteps.steps.length
        }
      },
      proof
    }
  };
}

export default describeTruthBoundarySurface;
