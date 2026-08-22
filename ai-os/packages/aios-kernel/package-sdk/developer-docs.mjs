export const surfaceId = "aios_package-sdk_developer-docs_099";
export const surfaceGroup = "package-sdk";
export const surfaceName = "developer-docs";

const rolePermissionCatalog = Object.freeze({
  owner: ['docs:read', 'docs:write', 'packages:inspect', 'packages:publish', 'audit:handoff'],
  maintainer: ['docs:read', 'docs:write', 'packages:inspect', 'audit:handoff'],
  developer: ['docs:read', 'packages:inspect'],
  auditor: ['docs:read', 'audit:handoff'],
  viewer: ['docs:read']
});

const permissionDescriptions = Object.freeze({
  'docs:read': 'Read hosted kernel SDK contracts and generated package integration notes.',
  'docs:write': 'Draft developer documentation updates scoped to the active workspace.',
  'packages:inspect': 'Resolve package SDK surfaces and typed integration contracts.',
  'packages:publish': 'Publish package SDK documentation manifests for the tenant.',
  'audit:handoff': 'Emit proof bundles for tenant audit and release review.'
});

const defaultWorkspace = Object.freeze({
  tenantId: 'tenant:unscoped',
  workspaceId: 'workspace:developer-docs',
  packageName: '@aios/kernel-package-sdk'
});

const hostedKernelIntegrations = Object.freeze({
  packageManifest: {
    route: 'kernel.packageSdk.resolveDeveloperDocsManifest',
    requiredPermission: 'packages:inspect',
    retryable: true
  },
  permissionResolver: {
    route: 'kernel.permissions.resolveWorkspaceRole',
    requiredPermission: 'docs:read',
    retryable: true
  },
  auditSink: {
    route: 'kernel.audit.acceptDeveloperDocsProof',
    requiredPermission: 'audit:handoff',
    retryable: false
  }
});

const providerServiceCatalog = Object.freeze({
  hostedDocsIndex: {
    provider: 'hosted-kernel.docs-index',
    route: 'kernel.packageSdk.syncDeveloperDocsIndex',
    requiredPermission: 'docs:read',
    requiresOperationalIntegration: 'packageManifest',
    capability: 'contracts:index',
    syncMode: 'pull'
  },
  packageContractRegistry: {
    provider: 'hosted-kernel.package-contract-registry',
    route: 'kernel.packageSdk.upsertDeveloperDocsContract',
    requiredPermission: 'packages:inspect',
    requiresOperationalIntegration: 'packageManifest',
    capability: 'contracts:resolve',
    syncMode: 'pull'
  },
  docsPublishingGateway: {
    provider: 'hosted-kernel.docs-publishing-gateway',
    route: 'kernel.packageSdk.publishDeveloperDocsManifest',
    requiredPermission: 'packages:publish',
    requiresOperationalIntegration: 'packageManifest',
    capability: 'contracts:publish',
    syncMode: 'push'
  },
  auditProofExchange: {
    provider: 'hosted-kernel.audit-proof-exchange',
    route: 'kernel.audit.acceptDeveloperDocsProof',
    requiredPermission: 'audit:handoff',
    requiresOperationalIntegration: 'auditSink',
    capability: 'proof:handoff',
    syncMode: 'push'
  }
});

const providerDataContractCatalog = Object.freeze({
  hostedDocsIndex: {
    version: 'developer-docs.provider.hosted-docs-index.v1',
    input: 'developer-docs.sync-request.v1',
    output: 'developer-docs.index-snapshot.v1',
    cursorField: 'docsIndexRevision',
    handoffPayload: null,
    requiredClaims: ['tenantId', 'workspaceId', 'packageName', 'highWatermark']
  },
  packageContractRegistry: {
    version: 'developer-docs.provider.package-contract-registry.v1',
    input: 'developer-docs.contract-resolution-request.v1',
    output: 'developer-docs.package-contract-bundle.v1',
    cursorField: 'contractRegistryRevision',
    handoffPayload: null,
    requiredClaims: ['tenantId', 'workspaceId', 'packageName', 'contractVersion']
  },
  docsPublishingGateway: {
    version: 'developer-docs.provider.docs-publishing-gateway.v1',
    input: 'developer-docs.publish-intent.v1',
    output: 'developer-docs.publish-receipt.v1',
    cursorField: 'publishedManifestRevision',
    handoffPayload: 'developer-docs.export-summary.v1',
    requiredClaims: ['tenantId', 'workspaceId', 'packageName', 'idempotencyKey', 'auditProofId']
  },
  auditProofExchange: {
    version: 'developer-docs.provider.audit-proof-exchange.v1',
    input: 'developer-docs.audit-proof-submit.v1',
    output: 'developer-docs.audit-proof-receipt.v1',
    cursorField: 'auditProofRevision',
    handoffPayload: 'developer-docs.audit-handoff.v1',
    requiredClaims: ['tenantId', 'workspaceId', 'packageName', 'evidenceCount', 'boundaryKey']
  }
});

const retryBackoffPolicy = Object.freeze({
  type: 'exponential-jitter',
  initialDelayMs: 250,
  maxDelayMs: 4000,
  maxAttempts: 4
});

const lifecycleCommandCatalog = Object.freeze({
  inspect: {
    route: 'kernel.packageSdk.inspectDeveloperDocsLifecycle',
    requiredPermission: 'docs:read',
    mutatesState: false
  },
  enable: {
    route: 'kernel.packageSdk.enableDeveloperDocsHosting',
    requiredPermission: 'docs:write',
    mutatesState: true
  },
  disable: {
    route: 'kernel.packageSdk.disableDeveloperDocsHosting',
    requiredPermission: 'docs:write',
    mutatesState: true
  },
  validate: {
    route: 'kernel.packageSdk.validateDeveloperDocsSettings',
    requiredPermission: 'docs:write',
    mutatesState: false
  },
  schedule: {
    route: 'kernel.scheduler.upsertDeveloperDocsPublishWindow',
    requiredPermission: 'docs:write',
    mutatesState: true
  },
  publish: {
    route: 'kernel.packageSdk.publishDeveloperDocsManifest',
    requiredPermission: 'packages:publish',
    mutatesState: true
  },
  audit: {
    route: 'kernel.audit.acceptDeveloperDocsProof',
    requiredPermission: 'audit:handoff',
    mutatesState: false
  }
});

const settingsDefaults = Object.freeze({
  hostingEnabled: true,
  autoSyncEnabled: true,
  requireAuditProof: true,
  scheduledPublishEnabled: false,
  publishWindowMinutes: 60,
  maxEvidenceItems: 100
});

const lifecycleCommandStateCatalog = Object.freeze({
  inspect: {
    targetState: 'observed',
    proofContract: 'developer-docs.lifecycle-inspection.v1',
    writes: []
  },
  enable: {
    targetState: 'hosting_enabled',
    proofContract: 'developer-docs.lifecycle-settings-patch.v1',
    writes: ['settings', 'state']
  },
  disable: {
    targetState: 'hosting_disabled',
    proofContract: 'developer-docs.lifecycle-settings-patch.v1',
    writes: ['settings', 'scheduler', 'state']
  },
  validate: {
    targetState: 'settings_validated',
    proofContract: 'developer-docs.settings-validation-proof.v1',
    writes: []
  },
  schedule: {
    targetState: 'publish_scheduled',
    proofContract: 'developer-docs.schedule-window-proof.v1',
    writes: ['scheduler', 'state']
  },
  publish: {
    targetState: 'manifest_publish_requested',
    proofContract: 'developer-docs.publish-intent.v1',
    writes: ['provider', 'state']
  },
  audit: {
    targetState: 'audit_proof_submitted',
    proofContract: 'developer-docs.audit-proof-submit.v1',
    writes: ['audit']
  }
});

function asNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeRole(role) {
  const normalized = asNonEmptyString(role, 'viewer').toLowerCase();
  return rolePermissionCatalog[normalized] ? normalized : 'viewer';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function asNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function asPositiveInteger(value, fallback = 1) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asBoundedInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

function isIsoDateString(value) {
  return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
}

function addMinutes(isoDate, minutes) {
  return new Date(Date.parse(isoDate) + (minutes * 60000)).toISOString();
}

function intersectPermissions(allowed, requested) {
  if (requested.length === 0) {
    return allowed;
  }

  return requested.filter((permission) => allowed.includes(permission));
}

function buildPermissionContract(role, requestedPermissions) {
  const allowedByRole = rolePermissionCatalog[role];
  const granted = intersectPermissions(allowedByRole, requestedPermissions);
  const denied = requestedPermissions.filter((permission) => !granted.includes(permission));

  return {
    role,
    requested: requestedPermissions,
    granted,
    denied,
    readOnly: !granted.includes('docs:write') && !granted.includes('packages:publish'),
    capabilities: granted.map((permission) => ({
      permission,
      description: permissionDescriptions[permission] || 'Tenant-scoped package SDK capability.'
    }))
  };
}

function normalizeWorkspaceGrant(rawGrant, index, workspace, permissionContract) {
  const grant = rawGrant && typeof rawGrant === 'object' ? rawGrant : {};
  const tenantId = asNonEmptyString(grant.tenantId, index === 0 ? workspace.tenantId : null);
  const workspaceId = asNonEmptyString(grant.workspaceId, index === 0 ? workspace.workspaceId : null);
  const packageName = asNonEmptyString(grant.packageName, '*');
  const grantedPermissions = normalizeStringList(grant.permissions || grant.grantedPermissions);
  const grantRole = normalizeRole(grant.role || permissionContract.role);
  const roleScopedPermissions = intersectPermissions(permissionContract.granted, rolePermissionCatalog[grantRole]);

  return {
    id: asNonEmptyString(grant.id, `workspace-grant:${index + 1}`),
    tenantId,
    workspaceId,
    packageName,
    role: grantRole,
    permissions: grantedPermissions.length
      ? intersectPermissions(roleScopedPermissions, grantedPermissions)
      : roleScopedPermissions,
    expiresAt: isIsoDateString(grant.expiresAt) ? grant.expiresAt.trim() : null,
    source: asNonEmptyString(grant.source, 'hosted-kernel.permission-resolver')
  };
}

function grantMatchesWorkspace(grant, workspace, now) {
  const packageMatches = grant.packageName === '*' || grant.packageName === workspace.packageName;
  const notExpired = !grant.expiresAt || Date.parse(grant.expiresAt) >= Date.parse(now);

  return grant.tenantId === workspace.tenantId
    && grant.workspaceId === workspace.workspaceId
    && packageMatches
    && notExpired;
}

function normalizeScopedEvidence(rawEvidence, index, workspace) {
  const evidence = rawEvidence && typeof rawEvidence === 'object' ? rawEvidence : {};
  const scope = evidence.scope && typeof evidence.scope === 'object' ? evidence.scope : evidence;

  return {
    id: asNonEmptyString(evidence.id, `evidence:${index + 1}`),
    tenantId: asNonEmptyString(scope.tenantId, workspace.tenantId),
    workspaceId: asNonEmptyString(scope.workspaceId, workspace.workspaceId),
    packageName: asNonEmptyString(scope.packageName, workspace.packageName),
    capturedAt: asNonEmptyString(evidence.capturedAt, null)
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildStableProofDigest(value) {
  const serialized = stableStringify(value);
  let hash = 2166136261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeEvidenceRecord(rawEvidence, index, workspace, now) {
  const evidence = rawEvidence && typeof rawEvidence === 'object' ? rawEvidence : {};
  const scope = evidence.scope && typeof evidence.scope === 'object' ? evidence.scope : evidence;
  const payload = evidence.payload && typeof evidence.payload === 'object'
    ? evidence.payload
    : evidence.claims && typeof evidence.claims === 'object'
      ? evidence.claims
      : {};
  const capturedAt = isIsoDateString(evidence.capturedAt || evidence.generatedAt)
    ? (evidence.capturedAt || evidence.generatedAt).trim()
    : now;
  const record = {
    id: asNonEmptyString(evidence.id, `evidence:${index + 1}`),
    type: asNonEmptyString(evidence.type || evidence.contract, 'developer-docs.evidence.v1'),
    tenantId: asNonEmptyString(scope.tenantId, workspace.tenantId),
    workspaceId: asNonEmptyString(scope.workspaceId, workspace.workspaceId),
    packageName: asNonEmptyString(scope.packageName, workspace.packageName),
    capturedAt,
    sourceRoute: asNonEmptyString(evidence.sourceRoute || evidence.route, hostedKernelIntegrations.packageManifest.route),
    subject: asNonEmptyString(evidence.subject || evidence.name, 'hosted-kernel-developer-docs'),
    payload
  };
  const scopeMatches = record.tenantId === workspace.tenantId
    && record.workspaceId === workspace.workspaceId
    && record.packageName === workspace.packageName;
  const requiredPayloadClaims = ['contractVersion', 'sourceRevision'];
  const missingPayloadClaims = requiredPayloadClaims.filter((claim) => !asNonEmptyString(payload[claim], null));
  const suppliedDigest = asNonEmptyString(evidence.digest || evidence.proofDigest, null);
  const computedDigest = buildStableProofDigest({
    id: record.id,
    type: record.type,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    packageName: record.packageName,
    capturedAt: record.capturedAt,
    sourceRoute: record.sourceRoute,
    subject: record.subject,
    payload
  });
  const digestMatches = !suppliedDigest || suppliedDigest === computedDigest;
  const errors = [
    scopeMatches ? null : 'evidence_scope_mismatch',
    missingPayloadClaims.length ? `missing_payload_claims:${missingPayloadClaims.join('|')}` : null,
    digestMatches ? null : 'proof_digest_mismatch'
  ].filter(Boolean);

  return {
    ...record,
    digest: suppliedDigest || computedDigest,
    computedDigest,
    digestVerified: digestMatches,
    valid: errors.length === 0,
    errors
  };
}

function buildEvidenceLedger({ input, now, workspace, settings }) {
  const suppliedEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  const normalized = suppliedEvidence.map((entry, index) => (
    normalizeEvidenceRecord(entry, index, workspace, now)
  ));
  const acceptedWithinLimit = normalized
    .filter((entry) => entry.valid)
    .slice(0, settings.values.maxEvidenceItems);
  const acceptedIds = new Set(acceptedWithinLimit.map((entry) => entry.id));
  const rejected = normalized.filter((entry) => !entry.valid || !acceptedIds.has(entry.id));
  const limitExceeded = normalized.filter((entry) => entry.valid).length > settings.values.maxEvidenceItems;
  const ledgerDigest = buildStableProofDigest(acceptedWithinLimit.map((entry) => ({
    id: entry.id,
    type: entry.type,
    digest: entry.digest,
    capturedAt: entry.capturedAt,
    sourceRoute: entry.sourceRoute
  })));

  return {
    type: 'developer-docs.evidence-ledger.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    valid: rejected.length === 0 && !limitExceeded && acceptedWithinLimit.length > 0,
    requiredPayloadClaims: ['contractVersion', 'sourceRevision'],
    limits: {
      maxEvidenceItems: settings.values.maxEvidenceItems,
      supplied: suppliedEvidence.length,
      accepted: acceptedWithinLimit.length,
      rejected: rejected.length,
      limitExceeded
    },
    ledgerDigest,
    acceptedEvidence: acceptedWithinLimit,
    rejectedEvidence: rejected.map((entry) => ({
      id: entry.id,
      type: entry.type,
      errors: entry.errors.length ? entry.errors : ['evidence_limit_exceeded'],
      digestVerified: entry.digestVerified
    })),
    auditProof: {
      contract: 'developer-docs.audit-proof-ledger.v1',
      digest: ledgerDigest,
      evidenceIds: acceptedWithinLimit.map((entry) => entry.id),
      sourceRoutes: [...new Set(acceptedWithinLimit.map((entry) => entry.sourceRoute))]
    }
  };
}

function buildWorkspaceBoundaryPolicy({ input, now, workspace, permissionContract, evidence }) {
  const suppliedGrants = Array.isArray(input.workspaceGrants)
    ? input.workspaceGrants
    : Array.isArray(input.accessGrants)
      ? input.accessGrants
      : [];
  const grants = suppliedGrants.map((grant, index) => (
    normalizeWorkspaceGrant(grant, index, workspace, permissionContract)
  ));
  const activeGrant = grants.find((grant) => grantMatchesWorkspace(grant, workspace, now));
  const effectivePermissions = activeGrant
    ? intersectPermissions(permissionContract.granted, activeGrant.permissions)
    : permissionContract.granted;
  const requestedCrossTenant = Boolean(input.allowCrossTenant || input.crossTenantAccess);
  const scopedEvidence = evidence.map((entry, index) => normalizeScopedEvidence(entry, index, workspace));
  const outOfScopeEvidence = scopedEvidence.filter((entry) => (
    entry.tenantId !== workspace.tenantId
    || entry.workspaceId !== workspace.workspaceId
    || entry.packageName !== workspace.packageName
  ));
  const grantRequired = suppliedGrants.length > 0;
  const missingGrant = grantRequired && !activeGrant;
  const permissionNarrowing = permissionContract.granted
    .filter((permission) => !effectivePermissions.includes(permission));
  const violations = [
    requestedCrossTenant ? 'cross_tenant_access_denied' : null,
    permissionContract.denied.length ? 'requested_permissions_exceed_role' : null,
    missingGrant ? 'workspace_grant_missing_or_expired' : null,
    outOfScopeEvidence.length ? 'evidence_scope_mismatch' : null
  ].filter(Boolean);

  return {
    type: 'developer-docs.workspace-boundary-policy.v1',
    generatedAt: now,
    safe: violations.length === 0,
    mode: grantRequired ? 'explicit-grant' : 'role-derived',
    boundaryKey: workspace.boundaryKey,
    violations,
    effectivePermissions,
    permissionNarrowing,
    activeGrant: activeGrant
      ? {
          id: activeGrant.id,
          role: activeGrant.role,
          source: activeGrant.source,
          expiresAt: activeGrant.expiresAt,
          permissions: activeGrant.permissions
        }
      : null,
    grantAudit: {
      suppliedGrants: suppliedGrants.length,
      matched: Boolean(activeGrant),
      expiredOrOutOfScope: grants
        .filter((grant) => !grantMatchesWorkspace(grant, workspace, now))
        .map((grant) => grant.id)
    },
    evidenceAudit: {
      checked: scopedEvidence.length,
      outOfScope: outOfScopeEvidence.map((entry) => ({
        id: entry.id,
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        packageName: entry.packageName
      }))
    },
    policy: {
      tenantIsolation: 'deny_cross_tenant',
      workspaceGrant: grantRequired ? 'require_matching_unexpired_grant' : 'derive_from_role_contract',
      auditEvidence: 'reject_handoff_when_evidence_scope_differs_from_active_workspace'
    }
  };
}

function applyBoundaryPolicyToPermissions(permissionContract, boundaryPolicy) {
  const scopedGranted = permissionContract.granted.filter((permission) => (
    boundaryPolicy.safe && boundaryPolicy.effectivePermissions.includes(permission)
  ));
  const scopedDenied = [
    ...permissionContract.denied,
    ...permissionContract.granted
      .filter((permission) => !scopedGranted.includes(permission))
      .map((permission) => `${permission}:workspace_boundary_denied`)
  ];

  return {
    ...permissionContract,
    granted: scopedGranted,
    denied: [...new Set(scopedDenied)],
    readOnly: !scopedGranted.includes('docs:write') && !scopedGranted.includes('packages:publish'),
    boundaryScoped: true,
    boundarySafe: boundaryPolicy.safe,
    capabilities: scopedGranted.map((permission) => ({
      permission,
      description: permissionDescriptions[permission] || 'Tenant-scoped package SDK capability.'
    }))
  };
}

function buildBoundaryRouteDecision({ name, route, requiredPermission, mutatesState, workspace, permissionContract, boundaryPolicy, settings }) {
  const permissionGranted = permissionContract.granted.includes(requiredPermission);
  const auditRequired = route === hostedKernelIntegrations.auditSink.route
    || route === providerServiceCatalog.auditProofExchange.route
    || requiredPermission === 'audit:handoff';
  const publishingRoute = route === lifecycleCommandCatalog.publish.route
    || route === providerServiceCatalog.docsPublishingGateway.route;
  const mutationAllowedBySettings = !mutatesState
    || settings.values.hostingEnabled
    || route === lifecycleCommandCatalog.enable.route
    || route === lifecycleCommandCatalog.validate.route;
  const blockers = [
    boundaryPolicy.safe ? null : 'workspace_boundary_not_safe',
    permissionGranted ? null : `missing_permission:${requiredPermission}`,
    mutationAllowedBySettings ? null : 'developer_docs_hosting_disabled',
    publishingRoute && settings.values.requireAuditProof && !permissionContract.granted.includes('audit:handoff')
      ? 'audit_handoff_permission_required_for_publish'
      : null
  ].filter(Boolean);

  return {
    name,
    route,
    requiredPermission,
    mutatesState,
    allowed: blockers.length === 0,
    mode: mutatesState ? 'mutating' : 'read',
    blockers,
    boundaryClaims: {
      tenantId: workspace.tenantId,
      workspaceId: workspace.workspaceId,
      packageName: workspace.packageName,
      boundaryKey: workspace.boundaryKey
    },
    proof: {
      required: auditRequired || mutatesState || publishingRoute,
      contract: auditRequired
        ? 'developer-docs.audit-handoff.v1'
        : mutatesState
          ? 'developer-docs.lifecycle-settings-patch.v1'
          : 'developer-docs.route-access-proof.v1'
    }
  };
}

function buildBoundaryRouteMatrix({ workspace, permissionContract, boundaryPolicy, settings }) {
  const lifecycleRoutes = Object.entries(lifecycleCommandCatalog).map(([name, definition]) => (
    buildBoundaryRouteDecision({
      name: `lifecycle:${name}`,
      route: definition.route,
      requiredPermission: definition.requiredPermission,
      mutatesState: definition.mutatesState,
      workspace,
      permissionContract,
      boundaryPolicy,
      settings
    })
  ));
  const providerRoutes = Object.entries(providerServiceCatalog).map(([name, definition]) => (
    buildBoundaryRouteDecision({
      name: `provider:${name}`,
      route: definition.route,
      requiredPermission: definition.requiredPermission,
      mutatesState: definition.syncMode === 'push',
      workspace,
      permissionContract,
      boundaryPolicy,
      settings
    })
  ));
  const integrationRoutes = Object.entries(hostedKernelIntegrations).map(([name, definition]) => (
    buildBoundaryRouteDecision({
      name: `integration:${name}`,
      route: definition.route,
      requiredPermission: definition.requiredPermission,
      mutatesState: false,
      workspace,
      permissionContract,
      boundaryPolicy,
      settings
    })
  ));
  const routes = [...lifecycleRoutes, ...providerRoutes, ...integrationRoutes];
  const deniedRoutes = routes.filter((decision) => !decision.allowed);
  const mutatingRoutes = routes.filter((decision) => decision.mutatesState);

  return {
    type: 'developer-docs.boundary-route-matrix.v1',
    boundaryKey: workspace.boundaryKey,
    safe: boundaryPolicy.safe,
    defaultMode: permissionContract.readOnly ? 'read-only' : 'scoped-read-write',
    routeCount: routes.length,
    allowedRouteCount: routes.length - deniedRoutes.length,
    deniedRouteCount: deniedRoutes.length,
    mutatingRouteCount: mutatingRoutes.length,
    deniedRoutes: deniedRoutes.map((decision) => ({
      name: decision.name,
      route: decision.route,
      blockers: decision.blockers
    })),
    handoffClaims: {
      immutable: ['tenantId', 'workspaceId', 'packageName', 'boundaryKey'],
      auditProofRequired: settings.values.requireAuditProof,
      boundaryDigest: buildStableProofDigest({
        tenantId: workspace.tenantId,
        workspaceId: workspace.workspaceId,
        packageName: workspace.packageName,
        granted: permissionContract.granted,
        denied: permissionContract.denied
      })
    },
    routes
  };
}

function normalizeDeveloperDocsSettings(input) {
  const rawSettings = input.settings && typeof input.settings === 'object'
    ? input.settings
    : input.developerDocsSettings && typeof input.developerDocsSettings === 'object'
      ? input.developerDocsSettings
      : {};
  const publishWindowMinutes = asBoundedInteger(
    rawSettings.publishWindowMinutes,
    settingsDefaults.publishWindowMinutes,
    15,
    1440
  );
  const maxEvidenceItems = asBoundedInteger(
    rawSettings.maxEvidenceItems,
    settingsDefaults.maxEvidenceItems,
    1,
    500
  );
  const requestedPublishAt = rawSettings.nextPublishAt || input.nextPublishAt || input.scheduledPublishAt;
  const validationErrors = [
    Number.isInteger(rawSettings.publishWindowMinutes) && rawSettings.publishWindowMinutes === publishWindowMinutes
      ? null
      : rawSettings.publishWindowMinutes === undefined
        ? null
        : 'publish_window_minutes_out_of_range',
    Number.isInteger(rawSettings.maxEvidenceItems) && rawSettings.maxEvidenceItems === maxEvidenceItems
      ? null
      : rawSettings.maxEvidenceItems === undefined
        ? null
        : 'max_evidence_items_out_of_range',
    requestedPublishAt === undefined || isIsoDateString(requestedPublishAt)
      ? null
      : 'next_publish_at_must_be_iso_datetime',
    asBoolean(rawSettings.scheduledPublishEnabled, settingsDefaults.scheduledPublishEnabled)
      && !asBoolean(rawSettings.hostingEnabled, settingsDefaults.hostingEnabled)
      ? 'scheduled_publish_requires_hosting_enabled'
      : null,
    asBoolean(rawSettings.scheduledPublishEnabled, settingsDefaults.scheduledPublishEnabled)
      && !isIsoDateString(requestedPublishAt)
      ? 'scheduled_publish_requires_next_publish_at'
      : null
  ].filter(Boolean);

  return {
    type: 'developer-docs.settings.v1',
    values: {
      hostingEnabled: asBoolean(rawSettings.hostingEnabled, settingsDefaults.hostingEnabled),
      autoSyncEnabled: asBoolean(rawSettings.autoSyncEnabled, settingsDefaults.autoSyncEnabled),
      requireAuditProof: asBoolean(rawSettings.requireAuditProof, settingsDefaults.requireAuditProof),
      scheduledPublishEnabled: asBoolean(
        rawSettings.scheduledPublishEnabled,
        settingsDefaults.scheduledPublishEnabled
      ),
      publishWindowMinutes,
      maxEvidenceItems,
      nextPublishAt: isIsoDateString(requestedPublishAt) ? requestedPublishAt.trim() : null
    },
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors,
      schema: {
        hostingEnabled: 'boolean',
        autoSyncEnabled: 'boolean',
        requireAuditProof: 'boolean',
        scheduledPublishEnabled: 'boolean',
        publishWindowMinutes: 'integer:min=15,max=1440',
        maxEvidenceItems: 'integer:min=1,max=500',
        nextPublishAt: 'iso-datetime|null'
      }
    }
  };
}

function normalizeLifecycleCommand(input) {
  const requested = asNonEmptyString(input.lifecycleCommand || input.command, 'inspect').toLowerCase();
  return lifecycleCommandCatalog[requested] ? requested : 'inspect';
}

function normalizePersistedCommand(rawCommand, commandName, workspace, now) {
  const command = rawCommand && typeof rawCommand === 'object' ? rawCommand : {};
  const persistedName = normalizeLifecycleCommand({ command: command.name || command.command || commandName });
  const requestedAt = asNonEmptyString(command.requestedAt || command.startedAt, now);
  const completedAt = asNonEmptyString(command.completedAt, null);
  const status = asNonEmptyString(command.status, completedAt ? 'applied' : 'pending').toLowerCase();
  const normalizedStatus = ['pending', 'applying', 'applied', 'failed', 'cancelled'].includes(status)
    ? status
    : 'pending';
  const idempotencyKey = asNonEmptyString(
    command.idempotencyKey,
    `${workspace.boundaryKey}:${persistedName}:${requestedAt}`
  );

  return {
    name: persistedName,
    route: lifecycleCommandCatalog[persistedName].route,
    status: normalizedStatus,
    idempotencyKey,
    requestedAt,
    completedAt,
    lastError: asNonEmptyString(command.lastError || command.errorCode, null),
    replaySafe: lifecycleCommandCatalog[persistedName].mutatesState === false
      || normalizedStatus === 'pending'
      || normalizedStatus === 'failed'
  };
}

function buildLifecycleSettingsPatch(commandName, settings) {
  if (commandName === 'enable') {
    return {
      hostingEnabled: true,
      autoSyncEnabled: settings.values.autoSyncEnabled,
      scheduledPublishEnabled: settings.values.scheduledPublishEnabled
    };
  }

  if (commandName === 'disable') {
    return {
      hostingEnabled: false,
      autoSyncEnabled: false,
      scheduledPublishEnabled: false,
      nextPublishAt: null
    };
  }

  if (commandName === 'schedule') {
    return {
      hostingEnabled: true,
      scheduledPublishEnabled: true,
      nextPublishAt: settings.values.nextPublishAt,
      publishWindowMinutes: settings.values.publishWindowMinutes
    };
  }

  if (commandName === 'validate') {
    return {
      publishWindowMinutes: settings.values.publishWindowMinutes,
      maxEvidenceItems: settings.values.maxEvidenceItems,
      requireAuditProof: settings.values.requireAuditProof
    };
  }

  return {};
}

function validateLifecycleSettingsIntent({ commandName, values, now }) {
  const publishWindowClosesAt = values.nextPublishAt
    ? addMinutes(values.nextPublishAt, values.publishWindowMinutes)
    : null;
  const nextPublishInPast = Boolean(values.nextPublishAt) && Date.parse(values.nextPublishAt) <= Date.parse(now);
  const windowElapsed = Boolean(publishWindowClosesAt) && Date.parse(publishWindowClosesAt) <= Date.parse(now);
  const errors = [
    values.scheduledPublishEnabled && !values.hostingEnabled ? 'scheduled_publish_requires_hosting_enabled' : null,
    values.scheduledPublishEnabled && !values.nextPublishAt ? 'next_publish_at_required' : null,
    commandName === 'schedule' && nextPublishInPast ? 'next_publish_at_must_be_future' : null,
    commandName === 'publish' && values.scheduledPublishEnabled && !values.nextPublishAt
      ? 'scheduled_publish_window_required'
      : null,
    commandName === 'publish' && values.scheduledPublishEnabled && windowElapsed
      ? 'scheduled_publish_window_elapsed'
      : null,
    commandName === 'publish' && !values.hostingEnabled ? 'developer_docs_hosting_disabled' : null
  ].filter(Boolean);

  return {
    valid: errors.length === 0,
    errors,
    publishWindow: values.nextPublishAt
      ? {
          startsAt: values.nextPublishAt,
          closesAt: publishWindowClosesAt,
          publishWindowMinutes: values.publishWindowMinutes,
          alreadyElapsed: windowElapsed,
          startsInFuture: Date.parse(values.nextPublishAt) > Date.parse(now)
        }
      : null
  };
}

function buildLifecycleSettingsIntent(commandName, settings, now) {
  const patch = buildLifecycleSettingsPatch(commandName, settings);
  const proposedValues = mergeSettingsPatch(settings, patch);
  const changedFields = Object.keys(patch).filter((field) => settings.values[field] !== proposedValues[field]);
  const validation = validateLifecycleSettingsIntent({ commandName, values: proposedValues, now });

  return {
    type: 'developer-docs.lifecycle-settings-intent.v1',
    command: commandName,
    currentValues: settings.values,
    patch,
    proposedValues,
    changedFields,
    noOp: changedFields.length === 0,
    validation,
    controls: {
      hostingAfterCommand: proposedValues.hostingEnabled,
      autoSyncAfterCommand: proposedValues.autoSyncEnabled,
      schedulingAfterCommand: proposedValues.scheduledPublishEnabled,
      nextPublishAt: proposedValues.nextPublishAt,
      publishWindowMinutes: proposedValues.publishWindowMinutes
    },
    proof: {
      contract: 'developer-docs.lifecycle-settings-intent.v1',
      digest: buildStableProofDigest({
        command: commandName,
        patch,
        proposedValues,
        validationErrors: validation.errors
      })
    }
  };
}

function buildLifecycleCommandPlan({ commandName, now, workspace, settings, persistedState }) {
  const command = lifecycleCommandCatalog[commandName];
  const stateDefinition = lifecycleCommandStateCatalog[commandName];
  const settingsIntent = buildLifecycleSettingsIntent(commandName, settings, now);
  const scheduleWindow = settingsIntent.validation.publishWindow;
  const validationErrors = [
    ...settingsIntent.validation.errors
  ].filter(Boolean);

  return {
    type: 'developer-docs.lifecycle-command-plan.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    command: commandName,
    route: command.route,
    targetState: stateDefinition.targetState,
    stateTransition: {
      fromSnapshotRevision: persistedState.snapshot.revision,
      toSnapshotRevision: command.mutatesState
        ? persistedState.snapshot.nextRevision
        : persistedState.snapshot.revision,
      fromActiveStatus: persistedState.commands.active.status,
      targetStatus: command.mutatesState ? 'applied' : 'observed'
    },
    settingsPatch: settingsIntent.patch,
    settingsIntent,
    scheduleWindow,
    writes: stateDefinition.writes.map((target) => ({
      target,
      route: target === 'scheduler'
        ? lifecycleCommandCatalog.schedule.route
        : target === 'audit'
          ? hostedKernelIntegrations.auditSink.route
          : target === 'provider'
            ? providerServiceCatalog.docsPublishingGateway.route
            : 'kernel.packageSdk.persistDeveloperDocsState'
    })),
    proofOutput: {
      contract: stateDefinition.proofContract,
      idempotencyKey: persistedState.commands.active.idempotencyKey,
      boundaryKey: workspace.boundaryKey,
      includesSettingsPatch: Object.keys(buildLifecycleSettingsPatch(commandName, settings)).length > 0,
      includesScheduleWindow: Boolean(scheduleWindow)
    },
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors
    }
  };
}

function mergeSettingsPatch(settings, settingsPatch) {
  return {
    ...settings.values,
    ...settingsPatch
  };
}

function buildLifecycleCommitEnvelope({
  commandName,
  now,
  workspace,
  settings,
  persistedState,
  commandPlan,
  accepted,
  blockers
}) {
  const command = lifecycleCommandCatalog[commandName];
  const settingsPatch = commandPlan.settingsPatch;
  const duplicateReplay = command.mutatesState && persistedState.commands.duplicateOfLastApplied;
  const settingsAfter = mergeSettingsPatch(settings, settingsPatch);
  const revisionAfter = accepted && command.mutatesState && !duplicateReplay
    ? persistedState.snapshot.nextRevision
    : persistedState.snapshot.revision;
  const completionStatus = duplicateReplay
    ? 'already_applied'
    : accepted
      ? command.mutatesState
        ? 'applied'
        : 'observed'
      : 'blocked';
  const journalEntry = {
    type: 'developer-docs.lifecycle-command-journal-entry.v1',
    command: commandName,
    route: command.route,
    idempotencyKey: persistedState.commands.active.idempotencyKey,
    requestedAt: persistedState.commands.active.requestedAt,
    completedAt: accepted ? now : null,
    status: completionStatus,
    replayedFrom: duplicateReplay && persistedState.commands.lastApplied
      ? persistedState.commands.lastApplied.completedAt
      : null,
    blockers
  };
  const snapshotAfter = {
    type: 'developer-docs.persisted-snapshot.v1',
    boundaryKey: workspace.boundaryKey,
    status: accepted ? 'checkpointed' : persistedState.snapshot.status,
    revision: revisionAfter,
    checkpointAt: accepted ? now : persistedState.snapshot.checkpointAt,
    restartSafe: accepted || persistedState.snapshot.restartSafe,
    activeCommand: accepted
      ? null
      : {
          name: persistedState.commands.active.name,
          status: persistedState.commands.active.status,
          idempotencyKey: persistedState.commands.active.idempotencyKey
        },
    lastAppliedCommand: accepted
      ? journalEntry
      : persistedState.commands.lastApplied,
    settings: settingsAfter,
    scheduler: {
      enabled: settingsAfter.scheduledPublishEnabled,
      nextPublishAt: settingsAfter.nextPublishAt,
      publishWindowMinutes: settingsAfter.publishWindowMinutes,
      windowClosesAt: settingsAfter.nextPublishAt
        ? addMinutes(settingsAfter.nextPublishAt, settingsAfter.publishWindowMinutes)
        : null
    }
  };
  const proofDigest = buildStableProofDigest({
    boundaryKey: workspace.boundaryKey,
    command: commandName,
    idempotencyKey: journalEntry.idempotencyKey,
    revisionBefore: persistedState.snapshot.revision,
    revisionAfter,
    status: completionStatus,
    settingsPatch,
    blockers
  });

  return {
    type: 'developer-docs.lifecycle-commit-envelope.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    state: accepted
      ? duplicateReplay
        ? 'idempotent_replay'
        : command.mutatesState
          ? 'ready_to_commit'
          : 'read_only_observation'
      : 'blocked',
    durableWriteRequired: accepted && command.mutatesState && !duplicateReplay,
    duplicateReplay,
    commitRoute: 'kernel.packageSdk.persistDeveloperDocsState',
    recoveryRoute: 'kernel.packageSdk.recoverDeveloperDocsState',
    expectedReceipt: {
      type: 'developer-docs.persisted-state-receipt.v1',
      idempotencyKey: journalEntry.idempotencyKey,
      revision: revisionAfter,
      status: snapshotAfter.status,
      proofDigest
    },
    snapshotBefore: {
      status: persistedState.snapshot.status,
      revision: persistedState.snapshot.revision,
      checkpointAt: persistedState.snapshot.checkpointAt,
      restartSafe: persistedState.snapshot.restartSafe
    },
    snapshotAfter,
    journalEntry,
    restartSemantics: {
      safeToReplay: accepted && (duplicateReplay || persistedState.commands.active.replaySafe),
      resumeStatus: accepted ? snapshotAfter.status : 'recovery_required',
      commandStatusAfterRestart: duplicateReplay ? 'already_applied' : completionStatus,
      recoveryRequired: !accepted || (!snapshotAfter.restartSafe && command.mutatesState)
    },
    proof: {
      contract: commandPlan.proofOutput.contract,
      digest: proofDigest,
      includesSnapshot: true,
      includesCommandJournal: true
    }
  };
}

function buildBlockedCommandInputRequirements(blocker) {
  const requirementCatalog = {
    required_permission_missing: ['role', 'requestedPermissions'],
    developer_docs_hosting_disabled: ['settings.hostingEnabled'],
    settings_validation_failed: ['settings'],
    scheduled_publish_disabled: ['settings.scheduledPublishEnabled'],
    next_publish_at_required: ['settings.nextPublishAt'],
    next_publish_at_must_be_future: ['settings.nextPublishAt'],
    scheduled_publish_window_required: ['settings.nextPublishAt'],
    scheduled_publish_window_elapsed: ['settings.nextPublishAt'],
    hosted_kernel_not_ready: ['integrationHealth'],
    audit_proof_required: ['evidence'],
    persisted_state_recovery_required: ['persistedState'],
    persisted_state_quarantined: ['persistedState'],
    inflight_command_reconciliation_required: ['persistedState.activeCommand']
  };

  return requirementCatalog[blocker] || ['settings'];
}

function buildLifecycleClientPatch({ accepted, blockers, command, commandPlan }) {
  const firstBlocker = blockers[0] || null;
  const dispatchingMutation = accepted && command.mutatesState;

  return {
    disablePrimaryAction: !accepted,
    primaryActionState: accepted
      ? dispatchingMutation
        ? 'ready_to_apply'
        : 'ready_to_observe'
      : 'blocked',
    optimisticStatus: accepted
      ? commandPlan.targetState
      : firstBlocker,
    settingsPreview: commandPlan.settingsIntent.proposedValues,
    changedSettings: commandPlan.settingsIntent.changedFields,
    requiredInput: firstBlocker ? buildBlockedCommandInputRequirements(firstBlocker) : [],
    refreshAfterAction: lifecycleCommandCatalog.inspect.route
  };
}

function selectLifecycleNextAction({ accepted, permissionGranted, blockers, command, commandPlan }) {
  const clientStatePatch = buildLifecycleClientPatch({ accepted, blockers, command, commandPlan });

  if (accepted) {
    return {
      state: 'dispatch',
      route: command.route,
      label: commandPlan.targetState,
      proofContract: commandPlan.proofOutput.contract,
      requiresUserInput: false,
      blockedBy: [],
      clientStatePatch,
      dispatch: {
        method: command.mutatesState ? 'mutate' : 'read',
        idempotencyKey: commandPlan.proofOutput.idempotencyKey,
        expectedState: commandPlan.targetState,
        settingsPatch: commandPlan.settingsPatch
      }
    };
  }

  const firstBlocker = blockers[0] || 'inspect';
  const blockerRoutes = {
    required_permission_missing: hostedKernelIntegrations.permissionResolver.route,
    developer_docs_hosting_disabled: lifecycleCommandCatalog.enable.route,
    settings_validation_failed: lifecycleCommandCatalog.validate.route,
    scheduled_publish_disabled: lifecycleCommandCatalog.schedule.route,
    next_publish_at_required: lifecycleCommandCatalog.schedule.route,
    next_publish_at_must_be_future: lifecycleCommandCatalog.schedule.route,
    scheduled_publish_window_elapsed: lifecycleCommandCatalog.schedule.route,
    hosted_kernel_not_ready: 'kernel.health.collectHostedKernelIntegrationState',
    audit_proof_required: providerServiceCatalog.auditProofExchange.route,
    persisted_state_recovery_required: 'kernel.packageSdk.recoverDeveloperDocsState',
    persisted_state_quarantined: 'kernel.packageSdk.recoverDeveloperDocsState',
    duplicate_command_already_applied: lifecycleCommandCatalog.inspect.route,
    inflight_command_reconciliation_required: 'kernel.packageSdk.recoverDeveloperDocsState'
  };

  return {
    state: permissionGranted ? 'blocked' : 'request_permission',
    route: blockerRoutes[firstBlocker] || lifecycleCommandCatalog.validate.route,
    label: firstBlocker,
    proofContract: commandPlan.proofOutput.contract,
    requiresUserInput: true,
    blockedBy: blockers,
    clientStatePatch,
    dispatch: {
      method: 'read',
      idempotencyKey: commandPlan.proofOutput.idempotencyKey,
      expectedState: 'blocked',
      settingsPatch: commandPlan.settingsPatch
    }
  };
}

function buildPersistedState({ input, now, workspace, settings, operationalHealth }) {
  const rawState = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const activeCommand = normalizePersistedCommand(rawState.activeCommand, normalizeLifecycleCommand(input), workspace, now);
  const lastAppliedCommand = rawState.lastAppliedCommand && typeof rawState.lastAppliedCommand === 'object'
    ? normalizePersistedCommand(rawState.lastAppliedCommand, 'inspect', workspace, now)
    : null;
  const snapshotRevision = asNonNegativeInteger(rawState.snapshotRevision, 0);
  const checkpointAt = asNonEmptyString(rawState.checkpointAt || rawState.persistedAt, null);
  const durableStatus = asNonEmptyString(rawState.status, checkpointAt ? 'checkpointed' : 'missing').toLowerCase();
  const normalizedStatus = ['missing', 'checkpointed', 'restoring', 'corrupt', 'stale'].includes(durableStatus)
    ? durableStatus
    : 'stale';
  const restartSafe = normalizedStatus === 'checkpointed'
    && Boolean(checkpointAt)
    && activeCommand.status !== 'applying';
  const recoveryActions = [
    checkpointAt ? null : {
      name: 'create_initial_checkpoint',
      route: 'kernel.packageSdk.persistDeveloperDocsState',
      reason: 'no_persisted_checkpoint',
      idempotencyKey: `${workspace.boundaryKey}:checkpoint:${snapshotRevision + 1}`
    },
    activeCommand.status === 'applying' ? {
      name: 'reconcile_inflight_command',
      route: activeCommand.route,
      reason: 'command_was_applying_during_restart',
      idempotencyKey: activeCommand.idempotencyKey
    } : null,
    operationalHealth.ready ? null : {
      name: 'refresh_integration_health',
      route: 'kernel.health.collectHostedKernelIntegrationState',
      reason: 'hosted_kernel_health_not_ready',
      idempotencyKey: `${workspace.boundaryKey}:health:${now}`
    },
    settings.validation.valid ? null : {
      name: 'repair_settings_snapshot',
      route: lifecycleCommandCatalog.validate.route,
      reason: 'persisted_settings_failed_validation',
      idempotencyKey: `${workspace.boundaryKey}:settings:${snapshotRevision}`
    }
  ].filter(Boolean);

  return {
    type: 'developer-docs.persisted-state.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    snapshot: {
      status: normalizedStatus,
      revision: snapshotRevision,
      checkpointAt,
      restartSafe,
      nextRevision: snapshotRevision + 1
    },
    commands: {
      active: activeCommand,
      lastApplied: lastAppliedCommand,
      duplicateOfLastApplied: Boolean(
        lastAppliedCommand && lastAppliedCommand.idempotencyKey === activeCommand.idempotencyKey
      )
    },
    recovery: {
      required: recoveryActions.length > 0,
      mode: restartSafe && recoveryActions.length === 0
        ? 'resume'
        : normalizedStatus === 'corrupt'
          ? 'quarantine'
          : 'reconcile',
      actions: recoveryActions
    },
    statusSemantics: {
      missing: 'No durable developer-docs checkpoint was supplied; create one before publish.',
      checkpointed: 'Durable checkpoint can be resumed after hosted-kernel restart.',
      restoring: 'Checkpoint is being restored; mutating commands should wait for reconciliation.',
      corrupt: 'Checkpoint must be quarantined and rebuilt from hosted kernel sources.',
      stale: 'Checkpoint shape was recognized but status is not trusted for publish.'
    }
  };
}

function buildLifecycleControls({ input, now, workspace, permissionContract, operationalHealth, settings, evidence, persistedState }) {
  const commandName = normalizeLifecycleCommand(input);
  const command = lifecycleCommandCatalog[commandName];
  const commandPlan = buildLifecycleCommandPlan({ commandName, now, workspace, settings, persistedState });
  const schedulePlan = commandName === 'schedule'
    ? commandPlan
    : buildLifecycleCommandPlan({ commandName: 'schedule', now, workspace, settings, persistedState });
  const permissionGranted = permissionContract.granted.includes(command.requiredPermission);
  const hostingEnabled = settings.values.hostingEnabled && input.enabled !== false;
  const commandRequiresHosting = ['schedule', 'publish', 'audit'].includes(commandName);
  const auditProofSatisfied = !settings.values.requireAuditProof || evidence.length > 0;
  const canWriteSettings = permissionContract.granted.includes('docs:write');
  const publishReady = permissionContract.granted.includes('packages:publish')
    && operationalHealth.ready
    && hostingEnabled
    && settings.validation.valid
    && auditProofSatisfied;
  const scheduleReady = canWriteSettings
    && hostingEnabled
    && settings.validation.valid
    && settings.values.scheduledPublishEnabled
    && Boolean(settings.values.nextPublishAt);
  const duplicateReplay = command.mutatesState && persistedState.commands.duplicateOfLastApplied;
  const blockers = [
    permissionGranted ? null : 'required_permission_missing',
    commandRequiresHosting && !hostingEnabled ? 'developer_docs_hosting_disabled' : null,
    settings.validation.valid ? null : 'settings_validation_failed',
    commandName === 'publish' && !operationalHealth.ready ? 'hosted_kernel_not_ready' : null,
    commandName === 'publish' && !auditProofSatisfied ? 'audit_proof_required' : null,
    ...commandPlan.validation.errors,
    command.mutatesState && persistedState.recovery.required && !persistedState.snapshot.restartSafe
      ? 'persisted_state_recovery_required'
      : null,
    command.mutatesState && persistedState.recovery.mode === 'quarantine' ? 'persisted_state_quarantined' : null,
    command.mutatesState && persistedState.commands.active.status === 'applying' ? 'inflight_command_reconciliation_required' : null
  ].filter(Boolean);
  const accepted = blockers.length === 0;
  const commitEnvelope = buildLifecycleCommitEnvelope({
    commandName,
    now,
    workspace,
    settings,
    persistedState,
    commandPlan,
    accepted,
    blockers
  });

  return {
    type: 'developer-docs.lifecycle-controls.v1',
    generatedAt: now,
    requestedCommand: commandName,
    command: {
      route: command.route,
      requiredPermission: command.requiredPermission,
      permissionGranted,
      mutatesState: command.mutatesState,
      accepted,
      blockers,
      idempotencyKey: persistedState.commands.active.idempotencyKey,
      replaySafe: duplicateReplay || persistedState.commands.active.replaySafe,
      duplicateReplay,
      terminalStatus: commitEnvelope.journalEntry.status
    },
    commandPlan,
    commitEnvelope,
    enableDisable: {
      enabled: hostingEnabled,
      canEnable: canWriteSettings && !hostingEnabled && settings.validation.valid,
      canDisable: canWriteSettings && hostingEnabled,
      routeOnEnable: lifecycleCommandCatalog.enable.route,
      routeOnDisable: lifecycleCommandCatalog.disable.route,
      enablePatch: buildLifecycleSettingsPatch('enable', settings),
      disablePatch: buildLifecycleSettingsPatch('disable', settings),
      proofContract: lifecycleCommandStateCatalog.enable.proofContract
    },
    scheduling: {
      enabled: settings.values.scheduledPublishEnabled,
      ready: scheduleReady && schedulePlan.validation.valid,
      nextPublishAt: settings.values.nextPublishAt,
      publishWindowMinutes: settings.values.publishWindowMinutes,
      window: schedulePlan.scheduleWindow,
      upsertPatch: buildLifecycleSettingsPatch('schedule', settings),
      route: lifecycleCommandCatalog.schedule.route,
      blockedReasons: scheduleReady && schedulePlan.validation.valid
        ? []
        : [
            canWriteSettings ? null : 'docs_write_permission_required',
            hostingEnabled ? null : 'developer_docs_hosting_disabled',
            settings.validation.valid ? null : 'settings_validation_failed',
            ...schedulePlan.validation.errors
          ].filter(Boolean)
    },
    nextAction: selectLifecycleNextAction({ accepted, permissionGranted, blockers, command, commandPlan }),
    readiness: {
      settingsValid: settings.validation.valid,
      publishReady,
      auditProofSatisfied,
      maxEvidenceItems: settings.values.maxEvidenceItems,
      restartSafe: persistedState.snapshot.restartSafe,
      recoveryRequired: persistedState.recovery.required
    }
  };
}

function buildWorkspaceScope(input) {
  const tenantId = asNonEmptyString(input.tenantId, defaultWorkspace.tenantId);
  const workspaceId = asNonEmptyString(input.workspaceId, defaultWorkspace.workspaceId);
  const packageName = asNonEmptyString(input.packageName, defaultWorkspace.packageName);

  return {
    tenantId,
    workspaceId,
    packageName,
    boundaryKey: `${tenantId}::${workspaceId}::${packageName}`,
    isolation: {
      tenantScoped: tenantId !== defaultWorkspace.tenantId,
      workspaceScoped: workspaceId !== defaultWorkspace.workspaceId,
      crossTenantAccess: false,
      externalNetwork: false
    }
  };
}

function normalizeIntegrationState(name, rawState, permissionContract, now) {
  const definition = hostedKernelIntegrations[name];
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  const status = asNonEmptyString(state.status, 'unknown').toLowerCase();
  const latencyMs = asNonNegativeInteger(state.latencyMs);
  const lastOkAt = typeof state.lastOkAt === 'string' && state.lastOkAt.trim() ? state.lastOkAt.trim() : null;
  const errorCode = typeof state.errorCode === 'string' && state.errorCode.trim() ? state.errorCode.trim() : null;
  const hasPermission = permissionContract.granted.includes(definition.requiredPermission);
  const normalizedStatus = ['ok', 'degraded', 'failed', 'unknown'].includes(status) ? status : 'unknown';
  const operational = normalizedStatus === 'ok' && hasPermission;
  const retryable = definition.retryable && ['degraded', 'failed', 'unknown'].includes(normalizedStatus);

  return {
    name,
    route: definition.route,
    status: hasPermission ? normalizedStatus : 'failed',
    requiredPermission: definition.requiredPermission,
    permissionGranted: hasPermission,
    lastOkAt,
    latencyMs,
    checkedAt: asNonEmptyString(state.checkedAt, now),
    errorCode: hasPermission ? errorCode : 'permission_not_granted',
    operational,
    retryable
  };
}

function buildActionableError(integration) {
  if (integration.operational) {
    return null;
  }

  if (!integration.permissionGranted) {
    return {
      code: `${integration.name}.permission_not_granted`,
      severity: 'blocked',
      message: `Grant ${integration.requiredPermission} before calling ${integration.route}.`,
      action: 'request_role_or_permission_upgrade',
      retryable: false
    };
  }

  if (integration.status === 'unknown') {
    return {
      code: `${integration.name}.health_unknown`,
      severity: 'degraded',
      message: `No current health proof was provided for ${integration.route}.`,
      action: 'refresh_hosted_kernel_health_probe',
      retryable: integration.retryable
    };
  }

  return {
    code: `${integration.name}.${integration.errorCode || integration.status}`,
    severity: integration.status === 'failed' ? 'blocked' : 'degraded',
    message: `${integration.route} reported ${integration.status}.`,
    action: integration.retryable ? 'retry_with_backoff' : 'manual_audit_handoff_review',
    retryable: integration.retryable
  };
}

function buildRetryPlan(integrations) {
  return integrations
    .filter((integration) => integration.retryable)
    .map((integration) => ({
      integration: integration.name,
      route: integration.route,
      attemptsRemaining: retryBackoffPolicy.maxAttempts,
      scheduleMs: Array.from(
        { length: retryBackoffPolicy.maxAttempts },
        (_, index) => Math.min(
          retryBackoffPolicy.initialDelayMs * (2 ** index),
          retryBackoffPolicy.maxDelayMs
        )
      ),
      backoff: retryBackoffPolicy.type
    }));
}

function selectFailureService(rawFailure) {
  const requestedService = asNonEmptyString(rawFailure.serviceName || rawFailure.service, null);
  if (requestedService && providerServiceCatalog[requestedService]) {
    return requestedService;
  }

  return null;
}

function selectFailureIntegration(rawFailure, serviceName) {
  const requestedIntegration = asNonEmptyString(rawFailure.integration || rawFailure.integrationName, null);
  if (requestedIntegration && hostedKernelIntegrations[requestedIntegration]) {
    return requestedIntegration;
  }

  return serviceName
    ? providerServiceCatalog[serviceName].requiresOperationalIntegration
    : 'packageManifest';
}

function buildRetryWindow(failure, integration, now) {
  const suppliedAttempt = asPositiveInteger(failure.retryAttempt || failure.attempt, 1);
  const nextAttempt = Math.min(suppliedAttempt, retryBackoffPolicy.maxAttempts);
  const scheduledDelayMs = Math.min(
    retryBackoffPolicy.initialDelayMs * (2 ** (nextAttempt - 1)),
    retryBackoffPolicy.maxDelayMs
  );
  const retryAfterMs = asBoundedInteger(
    failure.retryAfterMs,
    scheduledDelayMs,
    retryBackoffPolicy.initialDelayMs,
    retryBackoffPolicy.maxDelayMs
  );
  const baseTime = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);
  const retryAtSource = isIsoDateString(failure.nextRetryAt)
    ? failure.nextRetryAt.trim()
    : new Date(baseTime + retryAfterMs).toISOString();

  return {
    retryable: Boolean(integration && integration.retryable),
    attempt: nextAttempt,
    attemptsRemaining: Math.max(retryBackoffPolicy.maxAttempts - nextAttempt, 0),
    retryAfterMs,
    nextRetryAt: retryAtSource,
    backoff: retryBackoffPolicy.type
  };
}

function normalizeFailureState(rawFailure, index, integrationsByName, workspace, now) {
  const failure = rawFailure && typeof rawFailure === 'object' ? rawFailure : {};
  const serviceName = selectFailureService(failure);
  const integrationName = selectFailureIntegration(failure, serviceName);
  const integration = integrationsByName[integrationName] || null;
  const severity = asNonEmptyString(failure.severity, integration && integration.status === 'failed' ? 'blocked' : 'degraded').toLowerCase();
  const normalizedSeverity = ['blocked', 'degraded', 'warning'].includes(severity) ? severity : 'degraded';
  const code = asNonEmptyString(
    failure.code || failure.errorCode,
    `${integrationName}.${integration && integration.errorCode ? integration.errorCode : 'health_unavailable'}`
  );
  const firstSeenAt = isIsoDateString(failure.firstSeenAt) ? failure.firstSeenAt.trim() : now;
  const lastSeenAt = isIsoDateString(failure.lastSeenAt || failure.checkedAt)
    ? (failure.lastSeenAt || failure.checkedAt).trim()
    : now;
  const retryWindow = buildRetryWindow(failure, integration, now);
  const acknowledged = asBoolean(failure.acknowledged, false);

  return {
    id: asNonEmptyString(failure.id, `failure:${index + 1}`),
    code,
    severity: normalizedSeverity,
    integration: integrationName,
    serviceName,
    route: integration ? integration.route : hostedKernelIntegrations.packageManifest.route,
    boundaryKey: workspace.boundaryKey,
    firstSeenAt,
    lastSeenAt,
    acknowledged,
    retry: retryWindow,
    recoveryRoute: retryWindow.retryable
      ? 'kernel.health.collectHostedKernelIntegrationState'
      : lifecycleCommandCatalog.validate.route,
    userAction: retryWindow.retryable
      ? 'retry_after_backoff_or_refresh_health_probe'
      : acknowledged
        ? 'wait_for_manual_resolution'
        : 'acknowledge_and_repair_configuration',
    blocksPublish: normalizedSeverity === 'blocked',
    blocksAuditHandoff: normalizedSeverity === 'blocked' && integrationName === 'auditSink',
    degradedFallback: {
      serveCachedContracts: true,
      allowReadOnlyPreview: true,
      suppressPushSync: normalizedSeverity !== 'warning',
      reason: code
    }
  };
}

function buildFailureStateRegistry(input, integrations, workspace, now) {
  const integrationsByName = integrations.reduce((index, integration) => {
    index[integration.name] = integration;
    return index;
  }, {});
  const suppliedFailures = Array.isArray(input.failureStates)
    ? input.failureStates
    : Array.isArray(input.integrationFailures)
      ? input.integrationFailures
      : Array.isArray(input.operationalFailures)
        ? input.operationalFailures
        : [];
  const syntheticFailures = integrations
    .filter((integration) => !integration.operational)
    .map((integration) => ({
      id: `integration:${integration.name}`,
      integration: integration.name,
      code: integration.errorCode || `${integration.name}.${integration.status}`,
      severity: integration.status === 'failed' ? 'blocked' : 'degraded',
      checkedAt: integration.checkedAt
    }));
  const suppliedKeys = new Set(suppliedFailures.map((failure) => {
    const normalized = failure && typeof failure === 'object' ? failure : {};
    return asNonEmptyString(normalized.integration || normalized.integrationName, '');
  }));
  const failures = [
    ...suppliedFailures,
    ...syntheticFailures.filter((failure) => !suppliedKeys.has(failure.integration))
  ].map((failure, index) => normalizeFailureState(failure, index, integrationsByName, workspace, now));
  const active = failures.filter((failure) => !failure.acknowledged || failure.severity === 'blocked');
  const blocked = active.filter((failure) => failure.severity === 'blocked');
  const retryable = active.filter((failure) => failure.retry.retryable && failure.retry.attemptsRemaining > 0);

  return {
    type: 'developer-docs.failure-state-registry.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    suppliedFailures: suppliedFailures.length,
    synthesizedFailures: syntheticFailures.length,
    activeCount: active.length,
    blockedCount: blocked.length,
    retryableCount: retryable.length,
    active,
    suppressedCapabilities: {
      publish: blocked.some((failure) => failure.blocksPublish),
      auditHandoff: blocked.some((failure) => failure.blocksAuditHandoff),
      pushSync: active.some((failure) => failure.degradedFallback.suppressPushSync)
    },
    nextRecovery: retryable[0]
      ? {
          route: retryable[0].recoveryRoute,
          at: retryable[0].retry.nextRetryAt,
          reason: retryable[0].code,
          idempotencyKey: `${workspace.boundaryKey}:failure-retry:${retryable[0].id}:${retryable[0].retry.attempt}`
        }
      : null
  };
}

function buildOperationalHealth(input, permissionContract, now, workspace) {
  const rawHealth = input.integrationHealth && typeof input.integrationHealth === 'object'
    ? input.integrationHealth
    : {};
  const integrations = Object.keys(hostedKernelIntegrations).map((name) => (
    normalizeIntegrationState(name, rawHealth[name], permissionContract, now)
  ));
  const actionableErrors = integrations.map(buildActionableError).filter(Boolean);
  const failureState = buildFailureStateRegistry(input, integrations, workspace, now);
  const hasBlockedError = actionableErrors.some((error) => error.severity === 'blocked');
  const hasBlockedFailure = failureState.blockedCount > 0;
  const degraded = integrations.some((integration) => integration.status === 'degraded' || integration.status === 'unknown');
  const mode = hasBlockedError || hasBlockedFailure ? 'failed' : degraded || failureState.activeCount ? 'degraded' : 'ready';

  return {
    type: 'developer-docs.operational-health.v1',
    mode,
    ready: mode === 'ready',
    degradedMode: mode === 'degraded'
      ? {
          enabled: true,
          behavior: 'serve cached SDK contracts, suppress publishing, and require fresh audit proof before handoff',
          suppressedCapabilities: failureState.suppressedCapabilities,
          nextRecovery: failureState.nextRecovery
        }
      : {
          enabled: false,
          behavior: null,
          suppressedCapabilities: failureState.suppressedCapabilities,
          nextRecovery: failureState.nextRecovery
        },
    integrations,
    retryPlan: buildRetryPlan(integrations),
    failureState,
    actionableErrors: [
      ...actionableErrors,
      ...failureState.active.map((failure) => ({
        code: failure.code,
        severity: failure.severity,
        message: `${failure.route} has active failure state ${failure.code}.`,
        action: failure.userAction,
        retryable: failure.retry.retryable,
        nextRetryAt: failure.retry.nextRetryAt
      }))
    ]
  };
}

function normalizeRequestedServices(input) {
  const requested = normalizeStringList(input.requestedServices || input.providerServices);
  return requested.length
    ? requested.filter((serviceName) => providerServiceCatalog[serviceName])
    : Object.keys(providerServiceCatalog);
}

function normalizeSyncCursor(rawCursor, serviceName, now) {
  const cursor = rawCursor && typeof rawCursor === 'object' ? rawCursor : {};
  const highWatermark = asNonEmptyString(cursor.highWatermark || cursor.revision, null);
  const lastSyncedAt = asNonEmptyString(cursor.lastSyncedAt || cursor.syncedAt, null);

  return {
    serviceName,
    highWatermark,
    lastSyncedAt,
    stale: !lastSyncedAt,
    observedAt: asNonEmptyString(cursor.observedAt, now)
  };
}

function normalizeCapabilityOffer(input, requestedServices) {
  const suppliedCapabilities = normalizeStringList(
    input.acceptedProviderCapabilities
      || input.advertisedProviderCapabilities
      || input.providerCapabilities
      || input.capabilities
  );
  const impliedCapabilities = requestedServices
    .map((serviceName) => providerServiceCatalog[serviceName].capability);
  const capabilities = suppliedCapabilities.length ? suppliedCapabilities : impliedCapabilities;

  return {
    type: 'developer-docs.provider-capability-offer.v1',
    explicit: suppliedCapabilities.length > 0,
    capabilities,
    unsupported: suppliedCapabilities.filter((capability) => (
      !Object.values(providerServiceCatalog).some((definition) => definition.capability === capability)
    ))
  };
}

function normalizeProviderLease(rawLease, serviceName, workspace, now) {
  const lease = rawLease && typeof rawLease === 'object' ? rawLease : {};
  const ttlMs = asBoundedInteger(lease.ttlMs, 300000, 30000, 3600000);
  const requestedAcquiredAt = asNonEmptyString(lease.acquiredAt, now);
  const acquiredAt = isIsoDateString(requestedAcquiredAt) ? requestedAcquiredAt : now;
  const holder = asNonEmptyString(lease.holder, 'developer-docs.surface');
  const token = asNonEmptyString(
    lease.token,
    `${workspace.boundaryKey}:${serviceName}:${acquiredAt}`
  );

  return {
    token,
    holder,
    acquiredAt,
    ttlMs,
    expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString(),
    renewable: holder === 'developer-docs.surface',
    conflict: Boolean(lease.conflict)
  };
}

function selectProviderReceipt(input, serviceName) {
  const receiptSources = [
    input.providerReceipts,
    input.syncReceipts,
    input.handoffReceipts
  ].filter((source) => source && typeof source === 'object');

  for (const source of receiptSources) {
    const receipt = source[serviceName];
    if (receipt && typeof receipt === 'object') {
      return receipt;
    }
  }

  return null;
}

function buildProviderReceiptState({
  rawReceipt,
  serviceName,
  dataContract,
  syncMetadata,
  expectedIdempotencyKey,
  workspace,
  now
}) {
  const receipt = rawReceipt && typeof rawReceipt === 'object' ? rawReceipt : {};
  const receivedAt = isIsoDateString(receipt.receivedAt || receipt.completedAt)
    ? (receipt.receivedAt || receipt.completedAt).trim()
    : null;
  const status = asNonEmptyString(receipt.status || receipt.state, rawReceipt ? 'received' : 'missing').toLowerCase();
  const normalizedStatus = ['missing', 'received', 'accepted', 'rejected', 'pending'].includes(status)
    ? status
    : 'received';
  const cursorValue = asNonEmptyString(
    receipt[dataContract.cursorField] || receipt.cursor || receipt.highWatermark,
    null
  );
  const outputSchema = asNonEmptyString(receipt.outputSchema || receipt.type || receipt.contract, null);
  const boundaryKey = asNonEmptyString(receipt.boundaryKey, workspace.boundaryKey);
  const idempotencyKey = asNonEmptyString(receipt.idempotencyKey || receipt.requestId, null);
  const idempotencyCorrelated = !idempotencyKey || idempotencyKey === expectedIdempotencyKey;
  const errors = [
    rawReceipt ? null : 'provider_receipt_missing',
    outputSchema && outputSchema !== dataContract.output ? 'provider_receipt_schema_mismatch' : null,
    boundaryKey === workspace.boundaryKey ? null : 'provider_receipt_boundary_mismatch',
    idempotencyCorrelated ? null : 'provider_receipt_idempotency_mismatch',
    normalizedStatus === 'rejected' ? 'provider_receipt_rejected' : null,
    syncMetadata && syncMetadata.receipt.required && !cursorValue ? 'provider_receipt_cursor_missing' : null,
    receivedAt || normalizedStatus === 'missing' || normalizedStatus === 'pending' ? null : 'provider_receipt_timestamp_missing'
  ].filter(Boolean);
  const accepted = errors.length === 0 && ['received', 'accepted'].includes(normalizedStatus);

  return {
    type: 'developer-docs.provider-receipt-state.v1',
    serviceName,
    status: normalizedStatus,
    accepted,
    receivedAt,
    boundaryKey,
    outputSchema: outputSchema || dataContract.output,
    cursor: {
      field: dataContract.cursorField,
      value: cursorValue,
      advancesWatermark: Boolean(cursorValue)
    },
    idempotency: {
      supplied: idempotencyKey,
      expected: expectedIdempotencyKey,
      correlated: idempotencyCorrelated
    },
    handoff: {
      payloadContract: dataContract.handoffPayload,
      completed: accepted && Boolean(dataContract.handoffPayload),
      completedAt: accepted ? receivedAt || now : null
    },
    errors,
    nextState: accepted
      ? 'checkpoint_cursor'
      : normalizedStatus === 'pending'
        ? 'await_provider_receipt'
        : 'retry_or_repair_provider_handoff'
  };
}

function buildProviderClaimValue({ claim, serviceName, dataContract, cursor, lease, workspace, now, evidenceLedger }) {
  const idempotencyKey = `${workspace.boundaryKey}:${serviceName}:${cursor.highWatermark || 'initial'}`;
  const claimValues = {
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    packageName: workspace.packageName,
    highWatermark: cursor.highWatermark || 'initial',
    contractVersion: dataContract.version,
    idempotencyKey,
    auditProofId: evidenceLedger.auditProof.digest,
    evidenceCount: evidenceLedger.limits.accepted,
    boundaryKey: workspace.boundaryKey,
    leaseToken: lease.token,
    generatedAt: now
  };

  return Object.prototype.hasOwnProperty.call(claimValues, claim) ? claimValues[claim] : null;
}

function buildProviderClaimContract({ serviceName, dataContract, cursor, lease, workspace, now, evidenceLedger }) {
  const claimEntries = dataContract.requiredClaims.map((claim) => {
    const value = buildProviderClaimValue({
      claim,
      serviceName,
      dataContract,
      cursor,
      lease,
      workspace,
      now,
      evidenceLedger
    });

    return {
      name: claim,
      value,
      supplied: value !== null && value !== undefined && value !== ''
    };
  });
  const missing = claimEntries.filter((entry) => !entry.supplied).map((entry) => entry.name);

  return {
    type: 'developer-docs.provider-claim-contract.v1',
    serviceName,
    contractVersion: dataContract.version,
    valid: missing.length === 0,
    missing,
    claims: claimEntries.reduce((claims, entry) => {
      claims[entry.name] = entry.value;
      return claims;
    }, {}),
    claimSources: {
      tenantId: 'workspace',
      workspaceId: 'workspace',
      packageName: 'workspace',
      highWatermark: cursor.highWatermark ? 'sync_cursor' : 'initial_cursor',
      contractVersion: 'provider_data_contract',
      idempotencyKey: 'workspace_boundary_and_cursor',
      auditProofId: 'evidence_ledger_digest',
      evidenceCount: 'accepted_evidence_count',
      boundaryKey: 'workspace_boundary'
    }
  };
}

function buildProviderSyncMetadata({ serviceName, definition, dataContract, cursor, lease, claimContract, workspace, now }) {
  const watermarkState = cursor.highWatermark ? 'incremental' : 'bootstrap';
  const pushRequiresReceipt = definition.syncMode === 'push';

  return {
    type: 'developer-docs.provider-sync-metadata.v1',
    serviceName,
    provider: definition.provider,
    route: definition.route,
    boundaryKey: workspace.boundaryKey,
    mode: definition.syncMode,
    watermarkState,
    cursor: {
      field: dataContract.cursorField,
      value: cursor.highWatermark,
      lastSyncedAt: cursor.lastSyncedAt,
      stale: cursor.stale
    },
    lease: {
      token: lease.token,
      holder: lease.holder,
      expiresAt: lease.expiresAt,
      renewable: lease.renewable
    },
    receipt: {
      required: pushRequiresReceipt,
      outputSchema: dataContract.output,
      completionCursorField: dataContract.cursorField
    },
    proof: {
      required: Boolean(dataContract.handoffPayload),
      payloadContract: dataContract.handoffPayload,
      claimDigest: buildStableProofDigest(claimContract.claims),
      generatedAt: now
    }
  };
}

function buildServiceSyncPlan({ serviceName, definition, cursor, lease, receipt, workspace, now, evidenceLedger }) {
  const dataContract = providerDataContractCatalog[serviceName];
  const cursorField = dataContract.cursorField;
  const idempotencyKey = `${workspace.boundaryKey}:${serviceName}:${cursor.highWatermark || 'initial'}`;
  const claimContract = buildProviderClaimContract({
    serviceName,
    dataContract,
    cursor,
    lease,
    workspace,
    now,
    evidenceLedger
  });
  const syncMetadata = buildProviderSyncMetadata({
    serviceName,
    definition,
    dataContract,
    cursor,
    lease,
    claimContract,
    workspace,
    now
  });
  const receiptState = buildProviderReceiptState({
    rawReceipt: receipt,
    serviceName,
    dataContract,
    syncMetadata,
    expectedIdempotencyKey: idempotencyKey,
    workspace,
    now
  });

  return {
    contractVersion: dataContract.version,
    inputSchema: dataContract.input,
    outputSchema: dataContract.output,
    cursorField,
    highWatermark: cursor.highWatermark,
    lastSyncedAt: cursor.lastSyncedAt,
    stale: cursor.stale,
    lease,
    requestEnvelope: {
      type: dataContract.input,
      generatedAt: now,
      route: definition.route,
      syncMode: definition.syncMode,
      idempotencyKey,
      boundaryKey: workspace.boundaryKey,
      requiredClaims: dataContract.requiredClaims,
      claims: claimContract.claims,
      proofDigest: syncMetadata.proof.claimDigest
    },
    receiptState,
    claimContract,
    syncMetadata
  };
}

function buildProviderContracts({ input, now, workspace, permissionContract, operationalHealth, settings, evidenceLedger }) {
  const requestedServices = normalizeRequestedServices(input);
  const capabilityOffer = normalizeCapabilityOffer(input, requestedServices);
  const rawCursors = input.syncCursors && typeof input.syncCursors === 'object' ? input.syncCursors : {};
  const rawLeases = input.syncLeases && typeof input.syncLeases === 'object' ? input.syncLeases : {};
  const integrationByName = operationalHealth.integrations.reduce((index, integration) => {
    index[integration.name] = integration;
    return index;
  }, {});
  const services = requestedServices.map((serviceName) => {
    const definition = providerServiceCatalog[serviceName];
    const integration = integrationByName[definition.requiresOperationalIntegration];
    const cursor = normalizeSyncCursor(rawCursors[serviceName], serviceName, now);
    const lease = normalizeProviderLease(rawLeases[serviceName], serviceName, workspace, now);
    const receipt = selectProviderReceipt(input, serviceName);
    const permissionGranted = permissionContract.granted.includes(definition.requiredPermission);
    const integrationReady = Boolean(integration && integration.operational);
    const capabilityAccepted = capabilityOffer.capabilities.includes(definition.capability);
    const settingsAllowPush = definition.syncMode !== 'push'
      || (settings.values.hostingEnabled && settings.values.autoSyncEnabled);
    const syncPlan = buildServiceSyncPlan({
      serviceName,
      definition,
      cursor,
      lease,
      receipt,
      workspace,
      now,
      evidenceLedger
    });
    const blockers = [
      permissionGranted ? null : 'required_permission_missing',
      integrationReady ? null : 'required_integration_not_operational',
      capabilityAccepted ? null : 'provider_capability_not_accepted',
      lease.conflict ? 'sync_lease_conflict' : null,
      settingsAllowPush ? null : 'provider_push_sync_disabled',
      definition.syncMode === 'push' && receipt && !syncPlan.receiptState.accepted
        ? `provider_receipt_invalid:${syncPlan.receiptState.errors.join('|')}`
        : null,
      syncPlan.claimContract.valid ? null : `missing_provider_claims:${syncPlan.claimContract.missing.join('|')}`
    ].filter(Boolean);

    return {
      name: serviceName,
      provider: definition.provider,
      route: definition.route,
      requiredPermission: definition.requiredPermission,
      requiredIntegration: definition.requiresOperationalIntegration,
      capability: definition.capability,
      syncMode: definition.syncMode,
      state: blockers.length === 0 ? 'available' : integrationReady ? 'blocked' : 'degraded',
      permissionGranted,
      integrationReady,
      capabilityAccepted,
      blockers,
      syncCursor: cursor,
      dataContract: providerDataContractCatalog[serviceName],
      syncPlan,
      syncMetadata: syncPlan.syncMetadata,
      receiptState: syncPlan.receiptState
    };
  });
  const grantedCapabilities = services
    .filter((service) => service.state === 'available')
    .map((service) => service.capability);
  const blockedCapabilities = services
    .filter((service) => service.state !== 'available')
    .map((service) => ({
      capability: service.capability,
      serviceName: service.name,
      blockers: service.blockers
    }));

  return {
    type: 'developer-docs.provider-contracts.v1',
    generatedAt: now,
    workspaceBoundary: workspace.boundaryKey,
    requestedServices,
    capabilityOffer,
    services,
    negotiation: {
      grantedCapabilities,
      blockedCapabilities,
      unsupportedCapabilities: capabilityOffer.unsupported,
      handshake: capabilityOffer.explicit ? 'explicit-capability-offer' : 'implicit-service-capabilities',
      degraded: services.some((service) => service.state === 'degraded'),
      publishCapable: grantedCapabilities.includes('contracts:publish'),
      auditHandoffCapable: grantedCapabilities.includes('proof:handoff')
    },
    sync: {
      autoSyncEnabled: settings.values.autoSyncEnabled,
      staleServices: services
        .filter((service) => service.syncCursor.stale)
        .map((service) => service.name),
      routes: services.map((service) => ({
        serviceName: service.name,
        route: service.route,
        mode: service.syncMode,
        cursorField: service.syncPlan.cursorField,
        leaseToken: service.syncPlan.lease.token,
        contractVersion: service.syncPlan.contractVersion,
        watermarkState: service.syncPlan.syncMetadata.watermarkState,
        proofDigest: service.syncPlan.syncMetadata.proof.claimDigest
      })),
      leases: services.map((service) => ({
        serviceName: service.name,
        token: service.syncPlan.lease.token,
        expiresAt: service.syncPlan.lease.expiresAt,
        renewable: service.syncPlan.lease.renewable,
        conflict: service.syncPlan.lease.conflict
      })),
      claimValidation: services.map((service) => ({
        serviceName: service.name,
        valid: service.syncPlan.claimContract.valid,
        missing: service.syncPlan.claimContract.missing,
        requiredClaims: service.dataContract.requiredClaims,
        proofDigest: service.syncPlan.syncMetadata.proof.claimDigest
      })),
      receipts: services.map((service) => ({
        serviceName: service.name,
        status: service.receiptState.status,
        accepted: service.receiptState.accepted,
        outputSchema: service.receiptState.outputSchema,
        cursorField: service.receiptState.cursor.field,
        cursorValue: service.receiptState.cursor.value,
        nextState: service.receiptState.nextState,
        errors: service.receiptState.errors
      }))
    }
  };
}

function buildAuditHandoff({ now, workspace, permissionContract, evidence, evidenceLedger }) {
  return {
    type: 'developer-docs.audit-handoff.v1',
    generatedAt: now,
    subject: {
      surfaceId,
      surfaceGroup,
      surfaceName,
      tenantId: workspace.tenantId,
      workspaceId: workspace.workspaceId,
      packageName: workspace.packageName
    },
    proof: {
      boundaryKey: workspace.boundaryKey,
      grantedPermissions: permissionContract.granted,
      deniedPermissions: permissionContract.denied,
      evidenceCount: evidence.length,
      evidenceLedgerDigest: evidenceLedger.ledgerDigest,
      evidenceLedgerValid: evidenceLedger.valid,
      immutableInputs: ['tenantId', 'workspaceId', 'packageName', 'role', 'requestedPermissions']
    },
    ledger: evidenceLedger.auditProof,
    nextHandoff: permissionContract.granted.includes('audit:handoff')
      ? 'kernel.audit.acceptDeveloperDocsProof'
      : null
  };
}

function selectProviderService(providerContracts, serviceName) {
  return providerContracts.services.find((service) => service.name === serviceName) || null;
}

function buildHandoffWorkflow({
  name,
  service,
  now,
  workspace,
  lifecycleControls,
  auditHandoff,
  analytics,
  payloadContract,
  route,
  capability,
  ready,
  blockers
}) {
  const dataContract = providerDataContractCatalog[name === 'publish_manifest'
    ? 'docsPublishingGateway'
    : 'auditProofExchange'];
  const serviceBlockers = service ? service.blockers : ['provider_service_not_requested'];
  const workflowBlockers = [
    ...blockers,
    ...serviceBlockers,
    analytics.qualitySignals.exportReady ? null : 'export_summary_not_ready',
    lifecycleControls.command.replaySafe ? null : 'lifecycle_command_not_replay_safe'
  ].filter(Boolean);
  const requestId = `${workspace.boundaryKey}:${name}:${lifecycleControls.command.idempotencyKey}`;

  return {
    type: 'developer-docs.client-handoff-workflow.v1',
    name,
    state: ready && workflowBlockers.length === 0 ? 'ready' : 'blocked',
    route,
    provider: service ? service.provider : null,
    capability,
    payloadContract,
    request: {
      idempotencyKey: requestId,
      generatedAt: now,
      boundaryKey: workspace.boundaryKey,
      inputSchema: dataContract.input,
      outputSchema: dataContract.output,
      requiredClaims: dataContract.requiredClaims,
      claims: {
        tenantId: workspace.tenantId,
        workspaceId: workspace.workspaceId,
        packageName: workspace.packageName,
        highWatermark: service ? service.syncCursor.highWatermark : null,
        contractVersion: service ? service.syncPlan.contractVersion : dataContract.version,
        idempotencyKey: requestId,
        auditProofId: auditHandoff.proof.boundaryKey,
        evidenceCount: analytics.counters.evidenceTotal,
        boundaryKey: workspace.boundaryKey
      }
    },
    clientStatePatch: {
      disablePrimaryAction: workflowBlockers.length > 0,
      optimisticStatus: workflowBlockers.length ? 'blocked' : 'handoff_submitted',
      completionCursorField: dataContract.cursorField,
      expectedReceipt: dataContract.output,
      refreshRoute: lifecycleCommandCatalog.inspect.route
    },
    proof: {
      required: name === 'audit_proof_exchange' || payloadContract === 'developer-docs.export-summary.v1',
      proofContract: name === 'audit_proof_exchange'
        ? 'developer-docs.audit-handoff.v1'
        : 'developer-docs.export-summary.v1',
      auditBoundary: auditHandoff.proof.boundaryKey,
      evidenceCount: analytics.counters.evidenceTotal
    },
    blockers: [...new Set(workflowBlockers)]
  };
}

function buildExternalHandoffState({ now, workspace, providerContracts, auditHandoff, lifecycleControls, analytics }) {
  const publishService = selectProviderService(providerContracts, 'docsPublishingGateway');
  const auditService = selectProviderService(providerContracts, 'auditProofExchange');
  const auditCapable = providerContracts.negotiation.auditHandoffCapable && Boolean(auditHandoff.nextHandoff);
  const publishCapable = providerContracts.negotiation.publishCapable
    && lifecycleControls.readiness.publishReady
    && analytics.qualitySignals.exportReady;
  const publishWorkflow = buildHandoffWorkflow({
    name: 'publish_manifest',
    service: publishService,
    now,
    workspace,
    lifecycleControls,
    auditHandoff,
    analytics,
    payloadContract: 'developer-docs.export-summary.v1',
    route: providerServiceCatalog.docsPublishingGateway.route,
    capability: 'contracts:publish',
    ready: publishCapable,
    blockers: [
      providerContracts.negotiation.publishCapable ? null : 'publish_provider_capability_missing',
      lifecycleControls.readiness.publishReady ? null : 'lifecycle_publish_not_ready',
      analytics.qualitySignals.exportReady ? null : 'export_summary_not_ready'
    ].filter(Boolean)
  });
  const auditWorkflow = buildHandoffWorkflow({
    name: 'audit_proof_exchange',
    service: auditService,
    now,
    workspace,
    lifecycleControls,
    auditHandoff,
    analytics,
    payloadContract: 'developer-docs.audit-handoff.v1',
    route: providerServiceCatalog.auditProofExchange.route,
    capability: 'proof:handoff',
    ready: auditCapable && analytics.qualitySignals.auditReady,
    blockers: [
      auditCapable ? null : 'audit_provider_capability_missing',
      analytics.qualitySignals.auditReady ? null : 'audit_quality_signal_not_ready',
      auditHandoff.nextHandoff ? null : 'audit_handoff_permission_missing'
    ].filter(Boolean)
  });
  const workflows = [publishWorkflow, auditWorkflow];
  const handoffQueue = workflows
    .filter((workflow) => workflow.state === 'ready')
    .map((workflow) => ({
      name: workflow.name,
      route: workflow.route,
      state: workflow.state,
      payloadContract: workflow.payloadContract,
      request: workflow.request,
      clientStatePatch: workflow.clientStatePatch,
      proof: workflow.proof
    }));
  const receiptExpectations = [publishService, auditService]
    .filter(Boolean)
    .map((service) => ({
      serviceName: service.name,
      route: service.route,
      payloadContract: service.dataContract.handoffPayload,
      expectedReceipt: service.dataContract.output,
      receiptStatus: service.receiptState.status,
      receiptAccepted: service.receiptState.accepted,
      completionCursorField: service.receiptState.cursor.field,
      completionCursorValue: service.receiptState.cursor.value,
      nextState: service.receiptState.nextState
    }));

  return {
    type: 'developer-docs.external-handoff-state.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    state: handoffQueue.length > 0
      ? 'ready'
      : providerContracts.negotiation.degraded
        ? 'degraded'
        : 'blocked',
    handoffQueue,
    suppressedReasons: handoffQueue.length
      ? []
      : [...new Set(workflows.flatMap((workflow) => workflow.blockers))],
    providerCapabilities: providerContracts.negotiation.grantedCapabilities,
    blockedCapabilities: providerContracts.negotiation.blockedCapabilities,
    receiptExpectations,
    workflows
  };
}

function normalizeHistoryEvent(rawEvent, index, now) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
  const kind = asNonEmptyString(event.kind || event.type, 'snapshot').toLowerCase();
  const status = asNonEmptyString(event.status, 'recorded').toLowerCase();
  const allowedKinds = ['snapshot', 'export', 'publish', 'audit', 'integration', 'permission'];
  const allowedStatuses = ['recorded', 'ready', 'blocked', 'degraded', 'failed'];

  return {
    id: asNonEmptyString(event.id, `history:${index + 1}`),
    kind: allowedKinds.includes(kind) ? kind : 'snapshot',
    status: allowedStatuses.includes(status) ? status : 'recorded',
    occurredAt: asNonEmptyString(event.occurredAt || event.generatedAt || event.checkedAt, now),
    actor: asNonEmptyString(event.actor, 'hosted-kernel'),
    summary: asNonEmptyString(event.summary, 'Developer docs package SDK state recorded.'),
    source: asNonEmptyString(event.source, 'developer-docs.surface')
  };
}

function buildHistorySnapshots(input, now, workspace, permissionContract, operationalHealth, evidence) {
  const suppliedHistory = Array.isArray(input.historySnapshots)
    ? input.historySnapshots
    : Array.isArray(input.history)
      ? input.history
      : [];
  const normalizedHistory = suppliedHistory
    .map((event, index) => normalizeHistoryEvent(event, index, now))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const currentSnapshot = {
    id: `snapshot:${workspace.boundaryKey}:${now}`,
    kind: 'snapshot',
    status: operationalHealth.mode === 'ready' ? 'ready' : operationalHealth.mode,
    occurredAt: now,
    actor: 'developer-docs.surface',
    summary: `${workspace.packageName} developer docs ${operationalHealth.mode} for ${permissionContract.role}.`,
    source: 'developer-docs.current-state'
  };
  const events = [...normalizedHistory, currentSnapshot];

  return {
    type: 'developer-docs.history.v1',
    retention: {
      maxEventsReturned: 25,
      suppliedEvents: suppliedHistory.length,
      returnedEvents: Math.min(events.length, 25)
    },
    latestSnapshot: currentSnapshot,
    events: events.slice(-25),
    proofLinks: evidence.map((entry, index) => ({
      id: asNonEmptyString(entry && entry.id, `evidence:${index + 1}`),
      type: asNonEmptyString(entry && entry.type, 'developer-docs.evidence'),
      capturedAt: asNonEmptyString(entry && entry.capturedAt, now)
    }))
  };
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildAnalyticsCounters({
  evidence,
  evidenceLedger,
  permissionContract,
  boundaryRouteMatrix,
  operationalHealth,
  history,
  providerContracts,
  lifecycleControls
}) {
  const integrationCounts = countBy(operationalHealth.integrations, (integration) => integration.status);
  const historyKindCounts = countBy(history.events, (event) => event.kind);
  const historyStatusCounts = countBy(history.events, (event) => event.status);
  const routeModeCounts = countBy(boundaryRouteMatrix.routes, (route) => route.mode);
  const routeProofCounts = countBy(boundaryRouteMatrix.routes, (route) => (
    route.proof.required ? route.proof.contract : 'proof_not_required'
  ));
  const blockedActions = operationalHealth.actionableErrors
    .filter((error) => error.severity === 'blocked')
    .length;
  const providerStateCounts = countBy(providerContracts.services, (service) => service.state);
  const providerReceiptCounts = countBy(providerContracts.services, (service) => service.receiptState.status);

  return {
    type: 'developer-docs.analytics.v1',
    counters: {
      evidenceTotal: evidence.length,
      evidenceAccepted: evidenceLedger.limits.accepted,
      evidenceRejected: evidenceLedger.limits.rejected,
      historyEventsTotal: history.events.length,
      integrationsTotal: operationalHealth.integrations.length,
      integrationsOperational: operationalHealth.integrations.filter((integration) => integration.operational).length,
      integrationsRetryable: operationalHealth.retryPlan.length,
      activeFailureStates: operationalHealth.failureState.activeCount,
      blockedFailureStates: operationalHealth.failureState.blockedCount,
      retryableFailureStates: operationalHealth.failureState.retryableCount,
      permissionsRequested: permissionContract.requested.length,
      permissionsGranted: permissionContract.granted.length,
      permissionsDenied: permissionContract.denied.length,
      boundaryRoutesTotal: boundaryRouteMatrix.routeCount,
      boundaryRoutesAllowed: boundaryRouteMatrix.allowedRouteCount,
      boundaryRoutesDenied: boundaryRouteMatrix.deniedRouteCount,
      boundaryRoutesMutating: boundaryRouteMatrix.mutatingRouteCount,
      actionableErrors: operationalHealth.actionableErrors.length,
      blockedActions,
      providerServicesTotal: providerContracts.services.length,
      providerServicesAvailable: providerContracts.services.filter((service) => service.state === 'available').length,
      providerServicesBlocked: providerContracts.services.filter((service) => service.state === 'blocked').length,
      providerServicesDegraded: providerContracts.services.filter((service) => service.state === 'degraded').length,
      providerReceiptsAccepted: providerContracts.services.filter((service) => service.receiptState.accepted).length,
      providerReceiptsPending: providerContracts.services.filter((service) => service.receiptState.status === 'pending').length,
      providerReceiptsRejected: providerContracts.services.filter((service) => (
        service.receiptState.status === 'rejected'
        || (service.receiptState.status !== 'missing' && service.receiptState.errors.length > 0)
      )).length,
      staleSyncCursors: providerContracts.sync.staleServices.length,
      lifecycleCommandAccepted: lifecycleControls.command.accepted ? 1 : 0,
      lifecycleCommandBlocked: lifecycleControls.command.accepted ? 0 : 1,
      lifecycleCommandBlockers: lifecycleControls.command.blockers.length,
      lifecycleDurableWrites: lifecycleControls.commitEnvelope.durableWriteRequired ? 1 : 0,
      lifecycleReplaySafe: lifecycleControls.command.replaySafe ? 1 : 0
    },
    byIntegrationStatus: integrationCounts,
    byHistoryKind: historyKindCounts,
    byHistoryStatus: historyStatusCounts,
    byRouteMode: routeModeCounts,
    byRouteProofContract: routeProofCounts,
    byProviderState: providerStateCounts,
    byProviderReceiptStatus: providerReceiptCounts,
    qualitySignals: {
      exportReady: blockedActions === 0 && evidenceLedger.valid,
      auditReady: permissionContract.granted.includes('audit:handoff') && blockedActions === 0 && evidenceLedger.valid,
      publishAllowed: permissionContract.granted.includes('packages:publish') && operationalHealth.ready,
      degradedReadOnlyAvailable: operationalHealth.failureState.active.some((failure) => (
        failure.degradedFallback.allowReadOnlyPreview
      )),
      pushSyncSuppressed: operationalHealth.failureState.suppressedCapabilities.pushSync,
      readOnly: permissionContract.readOnly,
      providerNegotiated: providerContracts.services.length > 0
        && providerContracts.negotiation.blockedCapabilities.length === 0,
      syncFresh: providerContracts.sync.staleServices.length === 0,
      handoffReceiptsClean: providerContracts.services.every((service) => (
        service.syncMode !== 'push'
        || service.receiptState.status === 'missing'
        || service.receiptState.accepted
      ))
    }
  };
}

function normalizeAnalyticsSnapshot(rawSnapshot, index, workspace, now) {
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  const counters = snapshot.counters && typeof snapshot.counters === 'object' ? snapshot.counters : {};
  const generatedAt = isIsoDateString(snapshot.generatedAt || snapshot.occurredAt)
    ? (snapshot.generatedAt || snapshot.occurredAt).trim()
    : now;
  const normalizedCounters = Object.keys(counters).reduce((normalized, key) => {
    normalized[key] = asNonNegativeInteger(counters[key], 0);
    return normalized;
  }, {});

  return {
    id: asNonEmptyString(snapshot.id, `analytics-snapshot:${index + 1}`),
    type: 'developer-docs.analytics-snapshot.v1',
    generatedAt,
    boundaryKey: asNonEmptyString(snapshot.boundaryKey, workspace.boundaryKey),
    counters: normalizedCounters,
    qualitySignals: snapshot.qualitySignals && typeof snapshot.qualitySignals === 'object'
      ? snapshot.qualitySignals
      : {},
    digest: asNonEmptyString(snapshot.digest, buildStableProofDigest({
      generatedAt,
      boundaryKey: asNonEmptyString(snapshot.boundaryKey, workspace.boundaryKey),
      counters: normalizedCounters
    }))
  };
}

function buildCounterDeltas(currentCounters, previousCounters) {
  return Object.keys(currentCounters).sort().map((name) => {
    const current = asNonNegativeInteger(currentCounters[name], 0);
    const previous = asNonNegativeInteger(previousCounters[name], 0);

    return {
      name,
      current,
      previous,
      delta: current - previous,
      changed: current !== previous
    };
  });
}

function buildAnalyticsExportRecords({ workspace, history, boundaryRouteMatrix, providerContracts, operationalHealth }) {
  const historyRecords = history.events.map((event) => ({
    recordType: 'history_event',
    boundaryKey: workspace.boundaryKey,
    occurredAt: event.occurredAt,
    id: event.id,
    kind: event.kind,
    status: event.status,
    source: event.source
  }));
  const routeRecords = boundaryRouteMatrix.routes.map((route) => ({
    recordType: 'route_decision',
    boundaryKey: workspace.boundaryKey,
    route: route.route,
    name: route.name,
    allowed: route.allowed,
    mode: route.mode,
    requiredPermission: route.requiredPermission,
    blockers: route.blockers
  }));
  const providerRecords = providerContracts.services.map((service) => ({
    recordType: 'provider_service',
    boundaryKey: workspace.boundaryKey,
    serviceName: service.name,
    provider: service.provider,
    state: service.state,
    syncMode: service.syncMode,
    capability: service.capability,
    blockers: service.blockers
  }));
  const receiptRecords = providerContracts.services.map((service) => ({
    recordType: 'provider_receipt',
    boundaryKey: workspace.boundaryKey,
    serviceName: service.name,
    status: service.receiptState.status,
    accepted: service.receiptState.accepted,
    cursorField: service.receiptState.cursor.field,
    cursorValue: service.receiptState.cursor.value,
    nextState: service.receiptState.nextState,
    errors: service.receiptState.errors
  }));
  const failureRecords = operationalHealth.failureState.active.map((failure) => ({
    recordType: 'failure_state',
    boundaryKey: workspace.boundaryKey,
    id: failure.id,
    code: failure.code,
    severity: failure.severity,
    integration: failure.integration,
    route: failure.route,
    nextRetryAt: failure.retry.nextRetryAt
  }));

  return [...historyRecords, ...routeRecords, ...providerRecords, ...receiptRecords, ...failureRecords];
}

function buildAnalyticsReportingState({
  input,
  now,
  workspace,
  boundaryRouteMatrix,
  operationalHealth,
  providerContracts,
  lifecycleControls,
  history,
  analytics
}) {
  const suppliedSnapshots = Array.isArray(input.analyticsSnapshots)
    ? input.analyticsSnapshots
    : Array.isArray(input.reportingSnapshots)
      ? input.reportingSnapshots
      : [];
  const priorSnapshots = suppliedSnapshots
    .map((snapshot, index) => normalizeAnalyticsSnapshot(snapshot, index, workspace, now))
    .filter((snapshot) => snapshot.boundaryKey === workspace.boundaryKey)
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const previousSnapshot = priorSnapshots[priorSnapshots.length - 1] || null;
  const currentSnapshot = {
    id: `analytics:${workspace.boundaryKey}:${now}`,
    type: 'developer-docs.analytics-snapshot.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    counters: analytics.counters,
    qualitySignals: analytics.qualitySignals,
    digest: buildStableProofDigest({
      boundaryKey: workspace.boundaryKey,
      generatedAt: now,
      counters: analytics.counters,
      qualitySignals: analytics.qualitySignals
    })
  };
  const exportRecords = buildAnalyticsExportRecords({
    workspace,
    history,
    boundaryRouteMatrix,
    providerContracts,
    operationalHealth
  });
  const exportDigest = buildStableProofDigest(exportRecords);
  const blockedRoutes = boundaryRouteMatrix.deniedRoutes.map((route) => route.name);

  return {
    type: 'developer-docs.analytics-reporting-state.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    snapshots: {
      previous: previousSnapshot,
      current: currentSnapshot,
      retainedPriorSnapshots: priorSnapshots.slice(-5),
      counterDeltas: buildCounterDeltas(
        currentSnapshot.counters,
        previousSnapshot ? previousSnapshot.counters : {}
      ).filter((delta) => delta.changed)
    },
    exportBatch: {
      contract: 'developer-docs.analytics-export-batch.v1',
      ready: analytics.qualitySignals.exportReady && blockedRoutes.length === 0,
      digest: exportDigest,
      contentType: 'application/x-ndjson',
      recordCount: exportRecords.length,
      partitionKeys: ['tenantId', 'workspaceId', 'packageName', 'boundaryKey'],
      blockedReasons: [
        analytics.qualitySignals.exportReady ? null : 'analytics_quality_not_export_ready',
        blockedRoutes.length ? 'boundary_route_denials_present' : null,
        lifecycleControls.command.replaySafe ? null : 'lifecycle_command_not_replay_safe'
      ].filter(Boolean),
      records: exportRecords
    },
    reportingQueue: {
      route: 'kernel.reporting.acceptDeveloperDocsTimeline',
      state: operationalHealth.ready && analytics.qualitySignals.exportReady ? 'ready' : 'deferred',
      idempotencyKey: `${workspace.boundaryKey}:analytics-report:${currentSnapshot.digest}`,
      payloadContract: 'developer-docs.timeline-report.v1',
      dependsOn: [
        hostedKernelIntegrations.packageManifest.route,
        providerServiceCatalog.packageContractRegistry.route,
        lifecycleCommandCatalog.inspect.route
      ]
    }
  };
}

function buildExportSummary({
  now,
  workspace,
  permissionContract,
  operationalHealth,
  auditHandoff,
  history,
  analytics,
  evidenceLedger,
  analyticsReportingState
}) {
  const manifestRows = [
    ['surfaceId', surfaceId],
    ['tenantId', workspace.tenantId],
    ['workspaceId', workspace.workspaceId],
    ['packageName', workspace.packageName],
    ['mode', operationalHealth.mode],
    ['role', permissionContract.role],
    ['evidenceTotal', String(analytics.counters.evidenceTotal)],
    ['historyEventsTotal', String(analytics.counters.historyEventsTotal)],
    ['activeFailureStates', String(analytics.counters.activeFailureStates)],
    ['blockedFailureStates', String(analytics.counters.blockedFailureStates)],
    ['boundaryRoutesDenied', String(analytics.counters.boundaryRoutesDenied)],
    ['providerServicesAvailable', String(analytics.counters.providerServicesAvailable)],
    ['providerReceiptsAccepted', String(analytics.counters.providerReceiptsAccepted)],
    ['providerReceiptsRejected', String(analytics.counters.providerReceiptsRejected)],
    ['lifecycleCommandAccepted', String(analytics.counters.lifecycleCommandAccepted)],
    ['analyticsSnapshotDigest', analyticsReportingState.snapshots.current.digest],
    ['analyticsExportDigest', analyticsReportingState.exportBatch.digest]
  ];

  return {
    type: 'developer-docs.export-summary.v1',
    generatedAt: now,
    ready: analytics.qualitySignals.exportReady,
    recommendedFormat: analytics.qualitySignals.auditReady ? 'audit-manifest+jsonl' : 'json',
    destinations: {
      auditSink: auditHandoff.nextHandoff,
      packageManifest: hostedKernelIntegrations.packageManifest.route
    },
    failureState: {
      contract: operationalHealth.failureState.type,
      activeCount: operationalHealth.failureState.activeCount,
      suppressedCapabilities: operationalHealth.failureState.suppressedCapabilities,
      nextRecovery: operationalHealth.failureState.nextRecovery
    },
    proofLedger: {
      contract: evidenceLedger.type,
      digest: evidenceLedger.ledgerDigest,
      valid: evidenceLedger.valid,
      acceptedEvidence: evidenceLedger.limits.accepted,
      rejectedEvidence: evidenceLedger.limits.rejected,
      requiredPayloadClaims: evidenceLedger.requiredPayloadClaims
    },
    analyticsExport: {
      contract: analyticsReportingState.exportBatch.contract,
      ready: analyticsReportingState.exportBatch.ready,
      digest: analyticsReportingState.exportBatch.digest,
      recordCount: analyticsReportingState.exportBatch.recordCount,
      contentType: analyticsReportingState.exportBatch.contentType,
      blockedReasons: analyticsReportingState.exportBatch.blockedReasons
    },
    manifests: {
      json: {
        contentType: 'application/json',
        recordCount: 1,
        schema: 'developer-docs.hosted-kernel.v1'
      },
      jsonl: {
        contentType: 'application/x-ndjson',
        recordCount: analyticsReportingState.exportBatch.recordCount,
        schema: analyticsReportingState.exportBatch.contract
      },
      csv: {
        contentType: 'text/csv',
        recordCount: manifestRows.length,
        columns: ['field', 'value'],
        rows: manifestRows
      }
    }
  };
}

function buildTimelineReport({ now, workspace, operationalHealth, history, analytics, analyticsReportingState }) {
  const checkpoints = [
    {
      name: 'workspace_scope',
      status: workspace.isolation.crossTenantAccess ? 'blocked' : 'ready',
      at: now
    },
    {
      name: 'hosted_kernel_integrations',
      status: operationalHealth.mode,
      at: now
    },
    {
      name: 'export_package',
      status: analytics.qualitySignals.exportReady ? 'ready' : 'blocked',
      at: now
    },
    {
      name: 'analytics_reporting',
      status: analyticsReportingState.reportingQueue.state === 'ready' ? 'ready' : 'degraded',
      at: now
    }
  ];

  return {
    type: 'developer-docs.timeline-report.v1',
    generatedAt: now,
    window: {
      firstEventAt: history.events[0] ? history.events[0].occurredAt : now,
      lastEventAt: history.events[history.events.length - 1]
        ? history.events[history.events.length - 1].occurredAt
        : now
    },
    checkpoints,
    reporting: {
      route: analyticsReportingState.reportingQueue.route,
      state: analyticsReportingState.reportingQueue.state,
      idempotencyKey: analyticsReportingState.reportingQueue.idempotencyKey,
      snapshotDigest: analyticsReportingState.snapshots.current.digest,
      exportDigest: analyticsReportingState.exportBatch.digest,
      changedCounters: analyticsReportingState.snapshots.counterDeltas.map((delta) => delta.name)
    },
    nextReportState: checkpoints.some((checkpoint) => checkpoint.status === 'blocked' || checkpoint.status === 'failed')
      ? 'needs_attention'
      : operationalHealth.degradedMode.enabled
        ? 'watch'
        : 'ready'
  };
}

function buildPreviewAcceptanceContract({
  now,
  workspace,
  boundaryPolicy,
  boundaryRouteMatrix,
  permissionContract,
  operationalHealth,
  providerContracts,
  settings,
  persistedState,
  lifecycleControls,
  externalHandoffState,
  exportSummary,
  timelineReport
}) {
  const readinessChecks = [
    {
      name: 'workspace_boundary',
      label: 'Workspace boundary',
      state: boundaryPolicy.safe ? 'ready' : 'blocked',
      detail: boundaryPolicy.safe
        ? `Scoped to ${workspace.workspaceId}.`
        : boundaryPolicy.violations.join(', '),
      route: hostedKernelIntegrations.permissionResolver.route
    },
    {
      name: 'boundary_route_matrix',
      label: 'Route permissions',
      state: boundaryRouteMatrix.deniedRouteCount === 0 ? 'ready' : 'blocked',
      detail: boundaryRouteMatrix.deniedRouteCount === 0
        ? 'All hosted-kernel routes are available inside the active workspace boundary.'
        : boundaryRouteMatrix.deniedRoutes
            .map((decision) => `${decision.name}:${decision.blockers.join('|')}`)
            .join(', '),
      route: hostedKernelIntegrations.permissionResolver.route
    },
    {
      name: 'hosted_kernel_integrations',
      label: 'Hosted kernel integrations',
      state: operationalHealth.mode,
      detail: operationalHealth.ready
        ? 'All required hosted-kernel integration probes are operational.'
        : operationalHealth.actionableErrors.map((error) => error.code).join(', '),
      route: 'kernel.health.collectHostedKernelIntegrationState'
    },
    {
      name: 'settings_validation',
      label: 'Settings validation',
      state: settings.validation.valid ? 'ready' : 'blocked',
      detail: settings.validation.valid
        ? 'Developer docs settings satisfy the hosted-kernel schema.'
        : settings.validation.errors.join(', '),
      route: lifecycleCommandCatalog.validate.route
    },
    {
      name: 'state_recovery',
      label: 'Restart readiness',
      state: persistedState.recovery.required ? 'blocked' : 'ready',
      detail: persistedState.recovery.required
        ? persistedState.recovery.actions.map((action) => action.reason).join(', ')
        : 'Persisted state can resume without recovery.',
      route: persistedState.recovery.actions[0]
        ? persistedState.recovery.actions[0].route
        : 'kernel.packageSdk.persistDeveloperDocsState'
    },
    {
      name: 'provider_contracts',
      label: 'Provider contracts',
      state: providerContracts.negotiation.blockedCapabilities.length ? 'blocked' : 'ready',
      detail: providerContracts.negotiation.blockedCapabilities.length
        ? providerContracts.negotiation.blockedCapabilities
            .map((capability) => `${capability.serviceName}:${capability.blockers.join('|')}`)
            .join(', ')
        : 'Requested provider capabilities are negotiated.',
      route: providerServiceCatalog.packageContractRegistry.route
    },
    {
      name: 'publish_acceptance',
      label: 'Publish acceptance',
      state: lifecycleControls.command.accepted && lifecycleControls.readiness.publishReady ? 'ready' : 'blocked',
      detail: lifecycleControls.command.accepted
        ? 'Requested lifecycle command can be dispatched.'
        : lifecycleControls.command.blockers.join(', '),
      route: lifecycleControls.command.accepted
        ? lifecycleControls.command.route
        : lifecycleControls.nextAction.route
    },
    {
      name: 'external_handoff',
      label: 'External handoff',
      state: externalHandoffState.state,
      detail: externalHandoffState.handoffQueue.length
        ? externalHandoffState.handoffQueue.map((handoff) => handoff.name).join(', ')
        : externalHandoffState.suppressedReasons.join(', '),
      route: externalHandoffState.handoffQueue[0]
        ? externalHandoffState.handoffQueue[0].route
        : providerServiceCatalog.auditProofExchange.route
    }
  ];
  const blockedChecks = readinessChecks.filter((check) => check.state === 'blocked' || check.state === 'failed');
  const degradedChecks = readinessChecks.filter((check) => check.state === 'degraded' || check.state === 'unknown');
  const acceptanceState = blockedChecks.length
    ? 'blocked'
    : degradedChecks.length
      ? 'needs_review'
      : 'accepted';
  const firstRepair = blockedChecks[0] || degradedChecks[0] || null;

  return {
    type: 'developer-docs.preview-acceptance.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    preview: {
      title: `${workspace.packageName} developer docs`,
      subtitle: `${permissionContract.role} access in ${workspace.workspaceId}`,
      mode: operationalHealth.mode,
      statusText: acceptanceState === 'accepted'
        ? 'Ready to publish and hand off audit proof.'
        : acceptanceState === 'needs_review'
          ? 'Preview is available with degraded hosted-kernel signals.'
          : 'Preview is blocked until required checks are repaired.',
      visibleSections: [
        'workspace_boundary',
        'hosted_kernel_integrations',
        'provider_contracts',
        'lifecycle_controls',
        'audit_handoff',
        'export_summary'
      ]
    },
    acceptance: {
      state: acceptanceState,
      accepted: acceptanceState === 'accepted',
      acceptRoute: lifecycleControls.command.accepted
        ? lifecycleControls.command.route
        : null,
      idempotencyKey: lifecycleControls.command.idempotencyKey,
      proofContract: exportSummary.recommendedFormat,
      handoffContracts: externalHandoffState.handoffQueue.map((handoff) => ({
        name: handoff.name,
        route: handoff.route,
        payloadContract: handoff.payloadContract,
        inputSchema: handoff.request.inputSchema,
        outputSchema: handoff.request.outputSchema,
        idempotencyKey: handoff.request.idempotencyKey
      })),
      handoffWorkflows: externalHandoffState.workflows.map((workflow) => ({
        name: workflow.name,
        state: workflow.state,
        route: workflow.route,
        payloadContract: workflow.payloadContract,
        receiptSchema: workflow.clientStatePatch.expectedReceipt,
        blockedReasons: workflow.blockers
      })),
      blockers: blockedChecks.map((check) => ({
        name: check.name,
        route: check.route,
        detail: check.detail
      }))
    },
    validationSummary: {
      valid: blockedChecks.length === 0,
      errors: [
        ...boundaryPolicy.violations,
        ...boundaryRouteMatrix.deniedRoutes.map((route) => `route_denied:${route.name}`),
        ...settings.validation.errors,
        ...lifecycleControls.command.blockers,
        ...externalHandoffState.suppressedReasons
      ],
      warnings: degradedChecks.map((check) => check.name),
      timelineState: timelineReport.nextReportState
    },
    readinessChecks,
    nextStep: firstRepair
      ? {
          state: 'repair',
          route: firstRepair.route,
          reason: firstRepair.detail,
          label: firstRepair.label
        }
      : {
          state: 'accept',
          route: lifecycleControls.command.route,
          reason: 'all_preview_acceptance_checks_ready',
          label: lifecycleControls.requestedCommand
        },
    clientHints: {
      primaryAction: firstRepair ? 'repair_check' : 'accept_preview',
      disablePublishButton: acceptanceState !== 'accepted',
      showAuditProofPanel: Boolean(exportSummary.destinations.auditSink),
      showRetryPanel: operationalHealth.retryPlan.length > 0,
      showFailureStatePanel: operationalHealth.failureState.activeCount > 0,
      nextFailureRecovery: operationalHealth.failureState.nextRecovery,
      blockedHandoffWorkflows: externalHandoffState.workflows
        .filter((workflow) => workflow.state !== 'ready')
        .map((workflow) => workflow.name),
      refreshRoute: 'kernel.packageSdk.inspectDeveloperDocsLifecycle'
    }
  };
}

function buildPreviewRouteEnvelope({ name, route, method, workspace, now, payloadContract, requestClaims, responseShape }) {
  const idempotencyKey = `${workspace.boundaryKey}:${name}:${requestClaims.command || 'inspect'}:${now}`;

  return {
    name,
    route,
    method,
    payloadContract,
    idempotencyKey,
    request: {
      type: `${payloadContract}.request`,
      generatedAt: now,
      boundaryKey: workspace.boundaryKey,
      claims: {
        tenantId: workspace.tenantId,
        workspaceId: workspace.workspaceId,
        packageName: workspace.packageName,
        ...requestClaims
      }
    },
    response: {
      type: `${payloadContract}.response`,
      shape: responseShape
    }
  };
}

function buildPreviewRouteContracts({
  now,
  workspace,
  boundaryRouteMatrix,
  settings,
  evidenceLedger,
  lifecycleControls,
  operationalHealth,
  providerContracts,
  externalHandoffState,
  previewAcceptance
}) {
  const readinessErrors = previewAcceptance.validationSummary.errors;
  const firstReadyHandoff = externalHandoffState.handoffQueue[0] || null;
  const validationDigest = buildStableProofDigest({
    boundaryKey: workspace.boundaryKey,
    settingsValid: settings.validation.valid,
    evidenceLedger: evidenceLedger.ledgerDigest,
    commandAccepted: lifecycleControls.command.accepted,
    errors: readinessErrors
  });
  const previewEnvelope = buildPreviewRouteEnvelope({
    name: 'preview',
    route: 'kernel.packageSdk.previewDeveloperDocsAcceptance',
    method: 'read',
    workspace,
    now,
    payloadContract: 'developer-docs.preview-acceptance.v1',
    requestClaims: {
      command: lifecycleControls.requestedCommand,
      includeSections: previewAcceptance.preview.visibleSections,
      validationDigest
    },
    responseShape: ['preview', 'acceptance', 'validationSummary', 'readinessChecks', 'nextStep', 'clientHints']
  });
  const validationEnvelope = buildPreviewRouteEnvelope({
    name: 'validate',
    route: lifecycleCommandCatalog.validate.route,
    method: 'read',
    workspace,
    now,
    payloadContract: 'developer-docs.validation-summary.v1',
    requestClaims: {
      command: lifecycleControls.requestedCommand,
      settingsSchema: settings.validation.schema,
      proofDigest: validationDigest
    },
    responseShape: ['valid', 'errors', 'warnings', 'timelineState', 'readinessChecks']
  });
  const acceptEnvelope = buildPreviewRouteEnvelope({
    name: 'accept',
    route: previewAcceptance.acceptance.acceptRoute || lifecycleControls.nextAction.route,
    method: lifecycleControls.command.mutatesState ? 'mutate' : 'read',
    workspace,
    now,
    payloadContract: lifecycleControls.commandPlan.proofOutput.contract,
    requestClaims: {
      command: lifecycleControls.requestedCommand,
      lifecycleIdempotencyKey: lifecycleControls.command.idempotencyKey,
      validationDigest,
      evidenceLedgerDigest: evidenceLedger.ledgerDigest,
      firstHandoffRoute: firstReadyHandoff ? firstReadyHandoff.route : null
    },
    responseShape: ['stateTransition', 'proofOutput', 'commitEnvelope', 'persistedSnapshot', 'clientStatePatch', 'handoffQueue']
  });
  const nextStepEnvelope = buildPreviewRouteEnvelope({
    name: 'next_step',
    route: previewAcceptance.nextStep.route,
    method: previewAcceptance.nextStep.state === 'accept' && lifecycleControls.command.mutatesState ? 'mutate' : 'read',
    workspace,
    now,
    payloadContract: 'developer-docs.explainable-next-step.v1',
    requestClaims: {
      command: lifecycleControls.requestedCommand,
      nextStepState: previewAcceptance.nextStep.state,
      reason: previewAcceptance.nextStep.reason,
      validationDigest
    },
    responseShape: ['state', 'route', 'reason', 'label', 'clientHints']
  });
  const routeList = [previewEnvelope, validationEnvelope, acceptEnvelope, nextStepEnvelope];
  const readinessGate = {
    accepted: previewAcceptance.acceptance.accepted,
    valid: previewAcceptance.validationSummary.valid,
    boundaryRoutesAllowed: boundaryRouteMatrix.deniedRouteCount === 0,
    integrationsReady: operationalHealth.ready,
    providerNegotiated: providerContracts.negotiation.blockedCapabilities.length === 0,
    evidenceLedgerValid: evidenceLedger.valid,
    commandReplaySafe: lifecycleControls.command.replaySafe
  };
  const blockedReasons = [
    readinessGate.accepted ? null : 'preview_acceptance_not_accepted',
    readinessGate.valid ? null : 'validation_summary_has_errors',
    readinessGate.integrationsReady ? null : 'hosted_kernel_integrations_not_ready',
    readinessGate.boundaryRoutesAllowed ? null : 'boundary_route_matrix_denied_routes',
    readinessGate.providerNegotiated ? null : 'provider_contract_negotiation_blocked',
    readinessGate.evidenceLedgerValid ? null : 'evidence_ledger_invalid',
    readinessGate.commandReplaySafe ? null : 'lifecycle_command_not_replay_safe'
  ].filter(Boolean);

  return {
    type: 'developer-docs.preview-route-contracts.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    validationDigest,
    readinessGate: {
      ...readinessGate,
      ready: blockedReasons.length === 0,
      blockedReasons
    },
    routes: routeList,
    routeIndex: routeList.reduce((index, route) => {
      index[route.name] = {
        route: route.route,
        method: route.method,
        payloadContract: route.payloadContract,
        idempotencyKey: route.idempotencyKey
      };
      return index;
    }, {}),
    clientStatePatch: {
      previewStatus: previewAcceptance.acceptance.state,
      disableAccept: blockedReasons.length > 0,
      primaryRoute: blockedReasons.length ? previewAcceptance.nextStep.route : acceptEnvelope.route,
      primaryRouteName: blockedReasons.length ? 'next_step' : 'accept',
      validationDigest,
      refreshAfterMutation: lifecycleCommandCatalog.inspect.route,
      subscribeTo: [
        hostedKernelIntegrations.packageManifest.route,
        lifecycleCommandCatalog.inspect.route,
        providerServiceCatalog.auditProofExchange.route
      ]
    }
  };
}

function normalizeClientRuntimeInput(input, previewRouteContracts, externalHandoffState) {
  const rawRuntime = input.clientRuntime && typeof input.clientRuntime === 'object'
    ? input.clientRuntime
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const requestedView = asNonEmptyString(rawRuntime.activeView || rawRuntime.view, 'preview').toLowerCase();
  const activeView = ['preview', 'validation', 'handoff', 'receipts', 'recovery'].includes(requestedView)
    ? requestedView
    : 'preview';
  const selectedWorkflow = asNonEmptyString(
    rawRuntime.selectedWorkflow || rawRuntime.workflow,
    externalHandoffState.handoffQueue[0] ? externalHandoffState.handoffQueue[0].name : 'preview'
  );
  const pendingRequestIds = normalizeStringList(rawRuntime.pendingRequestIds || rawRuntime.pendingRequests);
  const acknowledgedBlockers = normalizeStringList(rawRuntime.acknowledgedBlockers || rawRuntime.dismissedBlockers);
  const lastSeenValidationDigest = asNonEmptyString(rawRuntime.lastSeenValidationDigest, null);

  return {
    type: 'developer-docs.client-runtime-state.v1',
    activeView,
    selectedWorkflow,
    pendingRequestIds,
    acknowledgedBlockers,
    lastSeenValidationDigest,
    validationDigestChanged: Boolean(
      lastSeenValidationDigest && lastSeenValidationDigest !== previewRouteContracts.validationDigest
    )
  };
}

function buildClientRuntimeHandoff({
  input,
  now,
  workspace,
  lifecycleControls,
  previewAcceptance,
  previewRouteContracts,
  externalHandoffState,
  providerContracts,
  analyticsReportingState
}) {
  const runtime = normalizeClientRuntimeInput(input, previewRouteContracts, externalHandoffState);
  const routeIndex = previewRouteContracts.routeIndex;
  const selectedWorkflow = externalHandoffState.workflows.find((workflow) => (
    workflow.name === runtime.selectedWorkflow
  )) || externalHandoffState.workflows[0] || null;
  const pendingHandoffRequests = externalHandoffState.handoffQueue.map((handoff) => ({
    name: handoff.name,
    route: handoff.route,
    payloadContract: handoff.payloadContract,
    idempotencyKey: handoff.request.idempotencyKey,
    inputSchema: handoff.request.inputSchema,
    outputSchema: handoff.request.outputSchema,
    pending: runtime.pendingRequestIds.includes(handoff.request.idempotencyKey),
    proofDigest: handoff.proof.auditBoundary
  }));
  const unacknowledgedBlockers = [
    ...previewAcceptance.validationSummary.errors,
    ...externalHandoffState.suppressedReasons
  ].filter((reason, index, reasons) => (
    reason && reasons.indexOf(reason) === index && !runtime.acknowledgedBlockers.includes(reason)
  ));
  const expectedReceipts = providerContracts.services
    .filter((service) => service.syncMode === 'push' || service.dataContract.handoffPayload)
    .map((service) => ({
      serviceName: service.name,
      route: service.route,
      expectedReceipt: service.dataContract.output,
      cursorField: service.receiptState.cursor.field,
      cursorValue: service.receiptState.cursor.value,
      status: service.receiptState.status,
      accepted: service.receiptState.accepted,
      nextState: service.receiptState.nextState,
      repairRoute: service.receiptState.accepted
        ? lifecycleCommandCatalog.inspect.route
        : service.route
    }));
  const primaryRouteName = runtime.activeView === 'validation'
    ? 'validate'
    : runtime.activeView === 'handoff' && pendingHandoffRequests[0]
      ? 'accept'
      : previewRouteContracts.clientStatePatch.primaryRouteName;
  const primaryRoute = routeIndex[primaryRouteName] || routeIndex.next_step;
  const resumeAfterRefresh = runtime.validationDigestChanged
    ? 'refresh_preview_before_dispatch'
    : lifecycleControls.command.accepted
      ? 'resume_command_dispatch'
      : 'resume_repair_flow';

  return {
    type: 'developer-docs.client-runtime-handoff.v1',
    generatedAt: now,
    boundaryKey: workspace.boundaryKey,
    runtime,
    state: unacknowledgedBlockers.length
      ? 'attention_required'
      : pendingHandoffRequests.some((request) => request.pending)
        ? 'awaiting_receipt'
        : previewRouteContracts.readinessGate.ready
          ? 'ready'
          : 'blocked',
    activeWorkflow: selectedWorkflow
      ? {
          name: selectedWorkflow.name,
          state: selectedWorkflow.state,
          route: selectedWorkflow.route,
          payloadContract: selectedWorkflow.payloadContract,
          blockers: selectedWorkflow.blockers
        }
      : null,
    dispatchTarget: {
      routeName: primaryRouteName,
      route: primaryRoute.route,
      method: primaryRoute.method,
      payloadContract: primaryRoute.payloadContract,
      idempotencyKey: primaryRoute.idempotencyKey
    },
    pendingHandoffRequests,
    expectedReceipts,
    clientStatePatch: {
      ...previewRouteContracts.clientStatePatch,
      activeView: runtime.activeView,
      selectedWorkflow: selectedWorkflow ? selectedWorkflow.name : null,
      validationDigestChanged: runtime.validationDigestChanged,
      disablePrimaryAction: unacknowledgedBlockers.length > 0
        || previewRouteContracts.clientStatePatch.disableAccept,
      statusBadge: unacknowledgedBlockers.length
        ? 'needs_attention'
        : previewRouteContracts.readinessGate.ready
          ? 'ready'
          : 'blocked',
      pendingRequestIds: pendingHandoffRequests
        .filter((request) => request.pending)
        .map((request) => request.idempotencyKey)
    },
    subscriptions: [
      lifecycleCommandCatalog.inspect.route,
      analyticsReportingState.reportingQueue.route,
      ...expectedReceipts.map((receipt) => receipt.route)
    ].filter((route, index, routes) => route && routes.indexOf(route) === index),
    proof: {
      contract: 'developer-docs.client-runtime-handoff.v1',
      validationDigest: previewRouteContracts.validationDigest,
      analyticsSnapshotDigest: analyticsReportingState.snapshots.current.digest,
      digest: buildStableProofDigest({
        boundaryKey: workspace.boundaryKey,
        activeView: runtime.activeView,
        selectedWorkflow: runtime.selectedWorkflow,
        validationDigest: previewRouteContracts.validationDigest,
        pendingRequestIds: runtime.pendingRequestIds,
        blockers: unacknowledgedBlockers
      })
    },
    recovery: {
      resumeAfterRefresh,
      nextRepairRoute: previewAcceptance.nextStep.route,
      unacknowledgedBlockers
    }
  };
}

export function describeDeveloperDocsSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const role = normalizeRole(input.role);
  const requestedPermissions = normalizeStringList(input.requestedPermissions);
  const workspace = buildWorkspaceScope(input);
  const rolePermissionContract = buildPermissionContract(role, requestedPermissions);
  const settings = normalizeDeveloperDocsSettings(input);
  const evidenceLedger = buildEvidenceLedger({ input, now, workspace, settings });
  const evidence = evidenceLedger.acceptedEvidence;
  const boundaryPolicy = buildWorkspaceBoundaryPolicy({
    input,
    now,
    workspace,
    permissionContract: rolePermissionContract,
    evidence
  });
  const permissionContract = applyBoundaryPolicyToPermissions(rolePermissionContract, boundaryPolicy);
  const boundaryRouteMatrix = buildBoundaryRouteMatrix({
    workspace,
    permissionContract,
    boundaryPolicy,
    settings
  });
  const operationalHealth = buildOperationalHealth(input, permissionContract, now, workspace);
  const providerContracts = buildProviderContracts({
    input,
    now,
    workspace,
    permissionContract,
    operationalHealth,
    settings,
    evidenceLedger
  });
  const persistedState = buildPersistedState({
    input,
    now,
    workspace,
    settings,
    operationalHealth
  });
  const lifecycleControls = buildLifecycleControls({
    input,
    now,
    workspace,
    permissionContract,
    operationalHealth,
    settings,
    evidence,
    persistedState
  });
  const auditHandoff = buildAuditHandoff({ now, workspace, permissionContract, evidence, evidenceLedger });
  const history = buildHistorySnapshots(input, now, workspace, permissionContract, operationalHealth, evidence);
  const analytics = buildAnalyticsCounters({
    evidence,
    evidenceLedger,
    permissionContract,
    boundaryRouteMatrix,
    operationalHealth,
    history,
    providerContracts,
    lifecycleControls
  });
  const analyticsReportingState = buildAnalyticsReportingState({
    input,
    now,
    workspace,
    boundaryRouteMatrix,
    operationalHealth,
    providerContracts,
    lifecycleControls,
    history,
    analytics
  });
  const externalHandoffState = buildExternalHandoffState({
    now,
    workspace,
    providerContracts,
    auditHandoff,
    lifecycleControls,
    analytics
  });
  const exportSummary = buildExportSummary({
    now,
    workspace,
    permissionContract,
    operationalHealth,
    auditHandoff,
    history,
    analytics,
    evidenceLedger,
    analyticsReportingState
  });
  const timelineReport = buildTimelineReport({
    now,
    workspace,
    operationalHealth,
    history,
    analytics,
    analyticsReportingState
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    now,
    workspace,
    boundaryPolicy,
    boundaryRouteMatrix,
    permissionContract,
    operationalHealth,
    providerContracts,
    settings,
    persistedState,
    lifecycleControls,
    externalHandoffState,
    exportSummary,
    timelineReport
  });
  const previewRouteContracts = buildPreviewRouteContracts({
    now,
    workspace,
    boundaryRouteMatrix,
    settings,
    evidenceLedger,
    lifecycleControls,
    operationalHealth,
    providerContracts,
    externalHandoffState,
    previewAcceptance
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    input,
    now,
    workspace,
    lifecycleControls,
    previewAcceptance,
    previewRouteContracts,
    externalHandoffState,
    providerContracts,
    analyticsReportingState
  });

  return {
    ok: boundaryPolicy.safe && operationalHealth.mode !== 'failed',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      version: 'developer-docs.hosted-kernel.v1',
      dataTypes: {
        workspaceScope: ['tenantId', 'workspaceId', 'packageName', 'boundaryKey', 'isolation'],
        boundaryPolicy: ['type', 'generatedAt', 'safe', 'mode', 'boundaryKey', 'violations', 'effectivePermissions', 'permissionNarrowing', 'activeGrant', 'grantAudit', 'evidenceAudit', 'policy'],
        boundaryRouteMatrix: ['type', 'boundaryKey', 'safe', 'defaultMode', 'routeCount', 'allowedRouteCount', 'deniedRouteCount', 'mutatingRouteCount', 'deniedRoutes', 'handoffClaims', 'routes'],
        permissionContract: ['role', 'requested', 'granted', 'denied', 'readOnly', 'boundaryScoped', 'boundarySafe', 'capabilities'],
        auditHandoff: ['type', 'generatedAt', 'subject', 'proof', 'nextHandoff'],
        evidenceLedger: ['type', 'generatedAt', 'boundaryKey', 'valid', 'requiredPayloadClaims', 'limits', 'ledgerDigest', 'acceptedEvidence', 'rejectedEvidence', 'auditProof'],
        operationalHealth: ['type', 'mode', 'ready', 'degradedMode', 'integrations', 'retryPlan', 'failureState', 'actionableErrors'],
        providerContracts: ['type', 'generatedAt', 'workspaceBoundary', 'requestedServices', 'services', 'negotiation', 'sync'],
        providerService: ['name', 'provider', 'route', 'requiredPermission', 'requiredIntegration', 'capability', 'syncMode', 'state', 'permissionGranted', 'integrationReady', 'capabilityAccepted', 'blockers', 'syncCursor', 'dataContract', 'syncPlan', 'syncMetadata', 'receiptState'],
        providerSyncPlan: ['contractVersion', 'inputSchema', 'outputSchema', 'cursorField', 'highWatermark', 'lastSyncedAt', 'stale', 'lease', 'requestEnvelope', 'receiptState', 'claimContract', 'syncMetadata'],
        providerClaimContract: ['type', 'serviceName', 'contractVersion', 'valid', 'missing', 'claims', 'claimSources'],
        providerSyncMetadata: ['type', 'serviceName', 'provider', 'route', 'boundaryKey', 'mode', 'watermarkState', 'cursor', 'lease', 'receipt', 'proof'],
        providerReceiptState: ['type', 'serviceName', 'status', 'accepted', 'receivedAt', 'boundaryKey', 'outputSchema', 'cursor', 'idempotency', 'handoff', 'errors', 'nextState'],
        externalHandoffState: ['type', 'generatedAt', 'boundaryKey', 'state', 'handoffQueue', 'suppressedReasons', 'providerCapabilities', 'blockedCapabilities', 'receiptExpectations', 'workflows'],
        settings: ['type', 'values', 'validation'],
        persistedState: ['type', 'generatedAt', 'boundaryKey', 'snapshot', 'commands', 'recovery', 'statusSemantics'],
        lifecycleControls: ['type', 'generatedAt', 'requestedCommand', 'command', 'commandPlan', 'commitEnvelope', 'enableDisable', 'scheduling', 'nextAction', 'readiness'],
        lifecycleCommitEnvelope: ['type', 'generatedAt', 'boundaryKey', 'state', 'durableWriteRequired', 'duplicateReplay', 'commitRoute', 'recoveryRoute', 'expectedReceipt', 'snapshotBefore', 'snapshotAfter', 'journalEntry', 'restartSemantics', 'proof'],
        history: ['type', 'retention', 'latestSnapshot', 'events', 'proofLinks'],
        analytics: ['type', 'counters', 'byIntegrationStatus', 'byHistoryKind', 'byHistoryStatus', 'byRouteMode', 'byRouteProofContract', 'byProviderState', 'byProviderReceiptStatus', 'qualitySignals'],
        analyticsReportingState: ['type', 'generatedAt', 'boundaryKey', 'snapshots', 'exportBatch', 'reportingQueue'],
        analyticsSnapshot: ['id', 'type', 'generatedAt', 'boundaryKey', 'counters', 'qualitySignals', 'digest'],
        analyticsExportBatch: ['contract', 'ready', 'digest', 'contentType', 'recordCount', 'partitionKeys', 'blockedReasons', 'records'],
        exportSummary: ['type', 'generatedAt', 'ready', 'recommendedFormat', 'destinations', 'failureState', 'proofLedger', 'analyticsExport', 'manifests'],
        timelineReport: ['type', 'generatedAt', 'window', 'checkpoints', 'reporting', 'nextReportState'],
        previewAcceptance: ['type', 'generatedAt', 'boundaryKey', 'preview', 'acceptance', 'validationSummary', 'readinessChecks', 'nextStep', 'clientHints'],
        previewRouteContracts: ['type', 'generatedAt', 'boundaryKey', 'validationDigest', 'readinessGate', 'routes', 'routeIndex', 'clientStatePatch'],
        clientRuntimeHandoff: ['type', 'generatedAt', 'boundaryKey', 'runtime', 'state', 'activeWorkflow', 'dispatchTarget', 'pendingHandoffRequests', 'expectedReceipts', 'clientStatePatch', 'subscriptions', 'proof', 'recovery']
      },
      integrationPoints: {
        packageManifest: hostedKernelIntegrations.packageManifest.route,
        permissionResolver: hostedKernelIntegrations.permissionResolver.route,
        auditSink: hostedKernelIntegrations.auditSink.route,
        healthProbe: 'kernel.health.collectHostedKernelIntegrationState',
        lifecycleController: 'kernel.packageSdk.applyDeveloperDocsLifecycleCommand',
        settingsValidator: lifecycleCommandCatalog.validate.route,
        publishScheduler: lifecycleCommandCatalog.schedule.route,
        providerContractSync: providerServiceCatalog.packageContractRegistry.route,
        docsIndexSync: providerServiceCatalog.hostedDocsIndex.route,
        statePersistence: 'kernel.packageSdk.persistDeveloperDocsState',
        restartRecovery: 'kernel.packageSdk.recoverDeveloperDocsState',
        externalPublishGateway: providerServiceCatalog.docsPublishingGateway.route,
        auditProofExchange: providerServiceCatalog.auditProofExchange.route,
        analyticsExport: 'kernel.analytics.exportDeveloperDocsSurfaceReport',
        analyticsReportingQueue: 'kernel.reporting.acceptDeveloperDocsTimeline',
        timelineReporter: 'kernel.reporting.acceptDeveloperDocsTimeline',
        previewAcceptance: 'kernel.packageSdk.previewDeveloperDocsAcceptance',
        previewValidationContract: lifecycleCommandCatalog.validate.route,
        previewAcceptContract: 'kernel.packageSdk.applyDeveloperDocsLifecycleCommand',
        explainableNextStep: 'kernel.packageSdk.resolveDeveloperDocsNextStep',
        clientRuntimeHandoff: 'kernel.packageSdk.resolveDeveloperDocsClientRuntimeHandoff'
      }
    },
    workspace,
    permissions: permissionContract,
    boundary: {
      safe: boundaryPolicy.safe,
      violations: boundaryPolicy.violations,
      policy: 'deny cross-tenant access, require matching workspace grants when supplied, and scope audit evidence to the active boundary',
      contract: boundaryPolicy
    },
    boundaryPolicy,
    boundaryRouteMatrix,
    operationalHealth,
    providerContracts,
    settings,
    persistedState,
    lifecycleControls,
    auditHandoff,
    evidenceLedger,
    externalHandoffState,
    history,
    analytics,
    analyticsReportingState,
    exportSummary,
    timelineReport,
    previewAcceptance,
    previewRouteContracts,
    clientRuntimeHandoff,
    evidence,
    rawEvidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0
  };
}

export default describeDeveloperDocsSurface;
