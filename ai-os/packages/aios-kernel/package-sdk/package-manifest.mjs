export const surfaceId = "aios_package-sdk_package-manifest_091";
export const surfaceGroup = "package-sdk";
export const surfaceName = "package-manifest";

const rolePermissionCeilings = {
  owner: ['*'],
  admin: [
    'audit.append',
    'kernel.package.install',
    'kernel.package.read',
    'secrets.read',
    'tenant.boundary.verify',
    'workspace.read',
    'workspace.write'
  ],
  developer: [
    'audit.append',
    'kernel.package.install',
    'kernel.package.read',
    'tenant.boundary.verify',
    'workspace.read',
    'workspace.write'
  ],
  viewer: ['kernel.package.read', 'workspace.read']
};

const hostedKernelPermissionCatalog = {
  'audit.append': { scope: 'tenant', audit: 'required' },
  'kernel.package.install': { scope: 'workspace', audit: 'required' },
  'kernel.package.read': { scope: 'workspace', audit: 'optional' },
  'network.egress': { scope: 'workspace', audit: 'required', gatedBy: 'hostedKernel.allowNetworkEgress' },
  'secrets.read': { scope: 'workspace', audit: 'required', minRole: 'admin' },
  'tenant.boundary.verify': { scope: 'tenant', audit: 'required' },
  'workspace.read': { scope: 'workspace', audit: 'optional' },
  'workspace.write': { scope: 'workspace', audit: 'required' }
};

const roleRank = { viewer: 1, developer: 2, admin: 3, owner: 4 };
const supportedWorkspaceScopes = ['workspace', 'tenant'];
const supportedBoundaryModes = ['deny-by-default', 'tenant-boundary', 'workspace-boundary'];
const supportedHealthStates = ['healthy', 'degraded', 'failed'];
const supportedHealthProbeStates = ['healthy', 'degraded', 'unavailable', 'failed', 'timeout'];
const supportedLifecycleCommands = ['install', 'enable', 'disable', 'pause', 'resume', 'schedule', 'rollback'];
const supportedSchedulePolicies = ['manual', 'immediate', 'maintenance-window'];
const supportedPackageLifecycleStates = ['uninstalled', 'installed', 'enabled', 'disabled', 'paused', 'scheduled', 'failed'];
const supportedProviderTransports = ['kernel-rpc', 'event-stream', 'webhook'];
const supportedSyncModes = ['none', 'snapshot', 'incremental'];
const supportedProviderHandoffStates = ['pending', 'requested', 'acknowledged', 'accepted', 'blocked', 'failed', 'cancelled'];
const terminalProviderHandoffStates = ['accepted', 'blocked', 'failed', 'cancelled'];
const supportedClientWorkflowPanels = [
  'manifest-permissions',
  'manifest-denials',
  'provider-contracts',
  'manifest-operational-health',
  'manifest-lifecycle-controls',
  'install-review'
];
const clientPanelByRouteIntent = {
  'manifest.validation.edit': 'manifest-denials',
  'workspace.boundary.select': 'manifest-denials',
  'permissions.review': 'manifest-permissions',
  'providers.resolve': 'provider-contracts',
  'runtime.retry': 'manifest-operational-health',
  'kernel.package.retry': 'manifest-operational-health',
  'resolve_runtime_failure_state': 'manifest-operational-health',
  'kernel.package.install': 'install-review'
};
const supportedPersistedCommandStates = ['ready', 'blocked', 'scheduled', 'deferred', 'optional', 'applied', 'replayed', 'superseded', 'failed'];
const replayablePersistedCommandStates = ['ready', 'scheduled', 'deferred'];
const terminalPersistedCommandStates = ['applied', 'replayed', 'superseded'];
const persistedCommandLeaseMs = 5 * 60 * 1000;
const retryableFailureReasons = [
  'audit_sink_unavailable',
  'workspace_resolver_timeout',
  'permission_catalog_stale',
  'manifest_registry_timeout'
];
const healthProbeActionCatalog = {
  audit_sink_unavailable: 'Retry audit receipt preparation, then route the package to manual audit review if the sink remains unavailable.',
  workspace_resolver_timeout: 'Refresh workspace boundary context before reattempting the package action.',
  permission_catalog_stale: 'Reload the hosted-kernel permission catalog before evaluating grants again.',
  manifest_registry_timeout: 'Retry manifest registry lookup after backoff and keep install controls disabled until the registry responds.'
};
const manifestIdPattern = /^[a-z0-9][a-z0-9._/-]{1,127}$/i;
const manifestVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const providerServicePattern = /^[a-z][a-z0-9.-]{2,96}$/i;

function uniqueStrings(values = []) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function stableHash(value) {
  const text = JSON.stringify(value, Object.keys(value).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeManifest(input) {
  const manifest = input.manifest || input.packageManifest || {};
  const hasExplicitManifest = Boolean(input.manifest || input.packageManifest || input.packageId || input.packageName);
  const permissions = manifest.permissions || manifest.requestedPermissions || input.requestedPermissions || [];
  const hostedKernel = manifest.hostedKernel || input.hostedKernel || {};
  const workspaceIds = manifest.workspaceIds || manifest.allowedWorkspaceIds || input.packageWorkspaceIds || input.allowedWorkspaceIds || [];
  return {
    id: manifest.id || input.packageId || 'unidentified-package',
    name: manifest.name || input.packageName || manifest.id || input.packageId || 'unidentified-package',
    version: manifest.version || input.version || '0.0.0',
    tenantId: manifest.tenantId || input.packageTenantId || null,
    workspaceId: manifest.workspaceId || input.packageWorkspaceId || null,
    allowedWorkspaceIds: uniqueStrings(Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds]),
    workspaceScope: manifest.workspaceScope || input.workspaceScope || 'workspace',
    explicitManifest: hasExplicitManifest,
    requestedPermissions: uniqueStrings(Array.isArray(permissions) ? permissions : Object.keys(permissions)),
    hostedKernel: {
      allowNetworkEgress: hostedKernel.allowNetworkEgress === true,
      auditChannel: hostedKernel.auditChannel || input.auditChannel || 'kernel.audit.package-manifest',
      boundaryMode: hostedKernel.boundaryMode || input.boundaryMode || 'deny-by-default'
    }
  };
}

function normalizePrincipal(input) {
  const actor = input.actor || {};
  const workspace = input.workspace || {};
  const tenant = input.tenant || {};
  const memberships = input.workspaceMemberships || actor.workspaceMemberships || actor.workspaces || [];
  const membershipWorkspaceIds = Array.isArray(memberships)
    ? memberships
      .map(membership => typeof membership === 'string' ? membership : membership && membership.workspaceId)
      .filter(Boolean)
    : [];
  return {
    actorId: actor.id || input.actorId || 'anonymous',
    tenantId: tenant.id || actor.tenantId || input.tenantId || null,
    workspaceId: workspace.id || actor.workspaceId || input.workspaceId || null,
    workspaceTenantId: workspace.tenantId || input.workspaceTenantId || tenant.id || actor.tenantId || input.tenantId || null,
    workspaceMemberships: uniqueStrings([
      ...(Array.isArray(input.allowedWorkspaceIds) ? input.allowedWorkspaceIds : []),
      ...(Array.isArray(actor.allowedWorkspaceIds) ? actor.allowedWorkspaceIds : []),
      ...membershipWorkspaceIds
    ]),
    roles: uniqueStrings([...(Array.isArray(input.roles) ? input.roles : []), ...(Array.isArray(actor.roles) ? actor.roles : [])])
  };
}

function roleAllowsPermission(roles, permission) {
  return roles.some(role => {
    const allowed = rolePermissionCeilings[role] || [];
    return allowed.includes('*') || allowed.includes(permission);
  });
}

function strongestRole(roles) {
  return roles.reduce((strongest, role) => (roleRank[role] || 0) > (roleRank[strongest] || 0) ? role : strongest, 'viewer');
}

function evaluatePermission(permission, manifest, principal) {
  const catalogEntry = hostedKernelPermissionCatalog[permission];
  if (!catalogEntry) {
    return { permission, granted: false, reason: 'permission_not_in_hosted_kernel_catalog' };
  }
  if (!roleAllowsPermission(principal.roles, permission)) {
    return { permission, granted: false, reason: 'role_ceiling_exceeded' };
  }
  if (catalogEntry.minRole && (roleRank[strongestRole(principal.roles)] || 0) < roleRank[catalogEntry.minRole]) {
    return { permission, granted: false, reason: `requires_${catalogEntry.minRole}_role` };
  }
  if (catalogEntry.gatedBy === 'hostedKernel.allowNetworkEgress' && manifest.hostedKernel.allowNetworkEgress !== true) {
    return { permission, granted: false, reason: 'network_egress_requires_manifest_gate' };
  }
  return {
    permission,
    granted: true,
    scope: catalogEntry.scope,
    audit: catalogEntry.audit
  };
}

function buildContractIssue(field, code, severity, detail = null) {
  return {
    field,
    code,
    severity,
    blocking: severity === 'error',
    detail
  };
}

function validateManifestContract(manifest) {
  const issues = [];
  if (!manifestIdPattern.test(manifest.id)) {
    issues.push(buildContractIssue('package.id', 'invalid_package_id', 'error', 'Use 2-128 chars: letters, numbers, dot, underscore, slash, or dash.'));
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim().length < 2) {
    issues.push(buildContractIssue('package.name', 'invalid_package_name', 'error', 'Package name must be a non-empty string.'));
  }
  if (!manifestVersionPattern.test(manifest.version)) {
    issues.push(buildContractIssue('package.version', 'invalid_semver_version', 'error', 'Expected semantic version major.minor.patch.'));
  }
  if (!supportedWorkspaceScopes.includes(manifest.workspaceScope)) {
    issues.push(buildContractIssue('workspaceScope', 'unsupported_workspace_scope_contract', 'error', supportedWorkspaceScopes));
  }
  if (!supportedBoundaryModes.includes(manifest.hostedKernel.boundaryMode)) {
    issues.push(buildContractIssue('hostedKernel.boundaryMode', 'unsupported_boundary_mode', 'error', supportedBoundaryModes));
  }
  if (manifest.workspaceScope === 'tenant' && !manifest.tenantId) {
    issues.push(buildContractIssue('tenantId', 'tenant_scope_requires_manifest_tenant', 'error', 'Tenant-scoped packages must declare tenantId.'));
  }
  if (manifest.explicitManifest && manifest.workspaceScope === 'workspace' && !manifest.workspaceId && manifest.allowedWorkspaceIds.length === 0) {
    issues.push(buildContractIssue('workspaceId', 'workspace_scope_requires_workspace_binding', 'error', 'Workspace-scoped packages must declare workspaceId or allowedWorkspaceIds.'));
  }
  if (manifest.requestedPermissions.length === 0) {
    issues.push(buildContractIssue('requestedPermissions', 'manifest_requests_no_permissions', 'warning', 'Package can load but cannot perform hosted-kernel actions.'));
  }
  const unknownPermissions = manifest.requestedPermissions.filter(permission => !hostedKernelPermissionCatalog[permission]);
  for (const permission of unknownPermissions) {
    issues.push(buildContractIssue('requestedPermissions', 'unknown_hosted_kernel_permission', 'error', permission));
  }
  if (manifest.requestedPermissions.includes('network.egress') && manifest.hostedKernel.allowNetworkEgress !== true) {
    issues.push(buildContractIssue('hostedKernel.allowNetworkEgress', 'network_permission_without_egress_gate', 'error', 'network.egress requires hostedKernel.allowNetworkEgress=true.'));
  }
  return {
    ok: issues.every(issue => !issue.blocking),
    schema: 'aios.packageManifest.contractValidation.v1',
    supportedWorkspaceScopes,
    supportedBoundaryModes,
    issues,
    blockingIssues: issues.filter(issue => issue.blocking),
    warnings: issues.filter(issue => !issue.blocking)
  };
}

function normalizeProviderContractRecord(record, index, direction, manifest, now) {
  const service = typeof record === 'string' ? { service: record } : (record || {});
  const sync = service.sync || {};
  const handoff = service.handoff || service.externalHandoff || {};
  const transport = supportedProviderTransports.includes(service.transport) ? service.transport : 'kernel-rpc';
  const syncMode = supportedSyncModes.includes(sync.mode) ? sync.mode : (direction === 'provides' ? 'incremental' : 'snapshot');
  const handoffState = supportedProviderHandoffStates.includes(handoff.state || service.state)
    ? handoff.state || service.state
    : 'pending';
  return {
    id: service.id || `${manifest.id}:${direction}:${service.service || service.name || index}`,
    direction,
    service: service.service || service.name || service.capability || null,
    contractVersion: service.contractVersion || service.version || '1.0.0',
    capability: service.capability || service.service || service.name || null,
    required: direction === 'consumes' ? service.required !== false : service.required === true,
    transport,
    sync: {
      mode: syncMode,
      cursor: sync.cursor || service.cursor || null,
      checkpoint: sync.checkpoint || service.checkpoint || null,
      lastSyncedAt: sync.lastSyncedAt || service.lastSyncedAt || null
    },
    handoff: {
      target: handoff.target || service.providerId || service.target || null,
      externalRef: handoff.externalRef || service.externalRef || null,
      state: handoffState,
      requestedAt: handoff.requestedAt || service.requestedAt || null,
      acknowledgedAt: handoff.acknowledgedAt || service.acknowledgedAt || null,
      expiresAt: handoff.expiresAt || service.expiresAt || null,
      retryAfter: handoff.retryAfter || service.retryAfter || null,
      failureReason: handoff.failureReason || service.failureReason || null
    }
  };
}

function normalizeProviderContracts(input, manifest, now) {
  const source = manifest.hostedKernel.providerContracts || manifest.providerContracts || input.providerContracts || {};
  const provides = source.provides || manifest.provides || manifest.services || input.provides || [];
  const consumes = source.consumes || manifest.consumes || manifest.requiredServices || input.consumes || [];
  const available = input.availableProviderCapabilities || input.providerRegistry || source.available || {};
  return {
    schema: 'aios.packageManifest.providerContracts.v1',
    capturedAt: source.capturedAt || now,
    provides: (Array.isArray(provides) ? provides : [provides])
      .filter(Boolean)
      .map((record, index) => normalizeProviderContractRecord(record, index, 'provides', manifest, now)),
    consumes: (Array.isArray(consumes) ? consumes : [consumes])
      .filter(Boolean)
      .map((record, index) => normalizeProviderContractRecord(record, index, 'consumes', manifest, now)),
    availableCapabilities: Object.fromEntries(Object.entries(available || {}).map(([capability, state]) => [
      capability,
      typeof state === 'string' ? { state, providerId: null } : (state || {})
    ]))
  };
}

function evaluateProviderContracts(providerContracts, manifest) {
  const issues = [];
  const offeredCapabilities = new Set(providerContracts.provides.map(contract => contract.capability).filter(Boolean));
  const negotiated = providerContracts.consumes.map(contract => {
    const registryMatch = providerContracts.availableCapabilities[contract.capability] || providerContracts.availableCapabilities[contract.service] || null;
    const localMatch = offeredCapabilities.has(contract.capability);
    const providerState = registryMatch && registryMatch.state ? registryMatch.state : (localMatch ? 'available' : 'missing');
    const capabilityAccepted = providerState === 'available' || providerState === 'healthy' || providerState === true;
    const handoffAccepted = contract.handoff.state === 'accepted';
    const accepted = capabilityAccepted || handoffAccepted;
    return {
      contractId: contract.id,
      service: contract.service,
      capability: contract.capability,
      required: contract.required,
      accepted,
      capabilityAccepted,
      providerState,
      providerId: registryMatch && registryMatch.providerId ? registryMatch.providerId : (localMatch ? manifest.id : null),
      transport: contract.transport,
      syncMode: contract.sync.mode,
      handoffState: contract.handoff.state,
      handoffTarget: contract.handoff.target,
      externalRef: contract.handoff.externalRef
    };
  });
  const allContracts = [...providerContracts.provides, ...providerContracts.consumes];
  for (const contract of allContracts) {
    if (!contract.service || !providerServicePattern.test(contract.service)) {
      issues.push(buildContractIssue(`providerContracts.${contract.direction}.${contract.id}.service`, 'invalid_provider_service_name', 'error', contract.service));
    }
    if (!manifestVersionPattern.test(contract.contractVersion)) {
      issues.push(buildContractIssue(`providerContracts.${contract.direction}.${contract.id}.contractVersion`, 'invalid_provider_contract_version', 'error', contract.contractVersion));
    }
    if (contract.sync.mode === 'incremental' && contract.direction === 'consumes' && !contract.sync.cursor && !contract.sync.checkpoint) {
      issues.push(buildContractIssue(`providerContracts.${contract.direction}.${contract.id}.sync`, 'incremental_consumer_requires_cursor_or_checkpoint', contract.required ? 'error' : 'warning', contract.service));
    }
    if (contract.direction === 'consumes' && contract.handoff.state === 'failed') {
      issues.push(buildContractIssue(`providerContracts.${contract.direction}.${contract.id}.handoff`, 'provider_handoff_failed', contract.required ? 'error' : 'warning', {
        service: contract.service,
        capability: contract.capability,
        failureReason: contract.handoff.failureReason
      }));
    }
    if (contract.direction === 'consumes' && contract.handoff.state === 'blocked') {
      issues.push(buildContractIssue(`providerContracts.${contract.direction}.${contract.id}.handoff`, 'provider_handoff_blocked', contract.required ? 'error' : 'warning', {
        service: contract.service,
        capability: contract.capability,
        target: contract.handoff.target
      }));
    }
  }
  for (const result of negotiated) {
    if (result.required && !result.accepted) {
      issues.push(buildContractIssue(`providerContracts.consumes.${result.contractId}`, 'required_provider_capability_unavailable', 'error', {
        service: result.service,
        capability: result.capability,
        providerState: result.providerState
      }));
    }
  }
  const externalHandoff = negotiated
    .filter(result => !result.accepted)
    .map(result => ({
      type: 'provider.capability.resolve',
      status: result.required ? 'blocked' : 'optional',
      contractId: result.contractId,
      service: result.service,
      capability: result.capability,
      required: result.required,
      providerState: result.providerState,
      target: result.handoffTarget,
      handoffState: result.handoffState,
      externalRef: result.externalRef,
      retryable: ['pending', 'requested', 'acknowledged'].includes(result.handoffState),
      nextAction: result.required ? 'kernel.provider.capability.resolve' : 'kernel.provider.capability.observe'
    }));
  const providerResolutionEnvelope = buildProviderResolutionEnvelope({
    providerContracts,
    negotiated,
    externalHandoff,
    manifest
  });
  return {
    schema: 'aios.packageManifest.providerNegotiation.v1',
    ok: issues.every(issue => !issue.blocking),
    supportedProviderTransports,
    supportedSyncModes,
    supportedProviderHandoffStates,
    negotiated,
    syncMetadata: allContracts.map(contract => ({
      contractId: contract.id,
      direction: contract.direction,
      service: contract.service,
      mode: contract.sync.mode,
      cursor: contract.sync.cursor,
      checkpoint: contract.sync.checkpoint,
      lastSyncedAt: contract.sync.lastSyncedAt,
      handoffState: contract.handoff.state
    })),
    externalHandoff,
    providerResolutionEnvelope,
    issues,
    blockingIssues: issues.filter(issue => issue.blocking),
    warnings: issues.filter(issue => !issue.blocking)
  };
}

function buildProviderResolutionEnvelope({ providerContracts, negotiated, externalHandoff, manifest }) {
  const handoffByContractId = new Map(externalHandoff.map(handoff => [handoff.contractId, handoff]));
  const resolutionItems = negotiated.map(result => {
    const contract = providerContracts.consumes.find(candidate => candidate.id === result.contractId) || {};
    const handoff = handoffByContractId.get(result.contractId) || null;
    const terminal = terminalProviderHandoffStates.includes(result.handoffState);
    const resolutionStatus = result.accepted
      ? 'resolved'
      : result.required
        ? 'blocked'
        : 'advisory';
    return {
      contractId: result.contractId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      service: result.service,
      capability: result.capability,
      required: result.required,
      resolutionStatus,
      providerId: result.providerId,
      providerState: result.providerState,
      transport: result.transport,
      syncMode: result.syncMode,
      syncCursor: contract.sync?.cursor || null,
      syncCheckpoint: contract.sync?.checkpoint || null,
      handoff: {
        state: result.handoffState,
        terminal,
        target: result.handoffTarget,
        externalRef: result.externalRef,
        requestedAt: contract.handoff?.requestedAt || null,
        acknowledgedAt: contract.handoff?.acknowledgedAt || null,
        expiresAt: contract.handoff?.expiresAt || null,
        retryAfter: contract.handoff?.retryAfter || null,
        failureReason: contract.handoff?.failureReason || null,
        commandType: handoff?.type || null,
        commandStatus: handoff?.status || 'ready',
        nextAction: handoff?.nextAction || (result.accepted ? 'continue_manifest_evaluation' : 'kernel.provider.capability.resolve')
      }
    };
  });
  const blocked = resolutionItems.filter(item => item.resolutionStatus === 'blocked');
  const advisory = resolutionItems.filter(item => item.resolutionStatus === 'advisory');
  return {
    schema: 'aios.packageManifest.providerResolutionEnvelope.v1',
    packageKey: `${manifest.id}@${manifest.version}`,
    capturedAt: providerContracts.capturedAt,
    state: blocked.length > 0 ? 'blocked' : advisory.length > 0 ? 'advisory' : 'resolved',
    requiredCount: resolutionItems.filter(item => item.required).length,
    resolvedCount: resolutionItems.filter(item => item.resolutionStatus === 'resolved').length,
    blockedCount: blocked.length,
    advisoryCount: advisory.length,
    items: resolutionItems,
    proofSubject: {
      contracts: resolutionItems.map(item => ({
        contractId: item.contractId,
        capability: item.capability,
        status: item.resolutionStatus,
        handoffState: item.handoff.state,
        providerId: item.providerId
      })),
      digest: stableHash(resolutionItems.map(item => ({
        contractId: item.contractId,
        resolutionStatus: item.resolutionStatus,
        handoffState: item.handoff.state,
        syncCursor: item.syncCursor,
        syncCheckpoint: item.syncCheckpoint
      })))
    }
  };
}

function evaluateTenantBoundary(manifest, principal) {
  const denials = [];
  if (!principal.tenantId) denials.push('principal_tenant_missing');
  if (!principal.workspaceId) denials.push('workspace_missing');
  if (principal.workspaceTenantId && principal.tenantId && principal.workspaceTenantId !== principal.tenantId) {
    denials.push('workspace_tenant_mismatch');
  }
  if (manifest.tenantId && principal.tenantId && manifest.tenantId !== principal.tenantId) {
    denials.push('manifest_tenant_mismatch');
  }
  if (manifest.workspaceScope === 'tenant' && !roleAllowsPermission(principal.roles, 'tenant.boundary.verify')) {
    denials.push('tenant_scope_requires_boundary_permission');
  }
  if (!['workspace', 'tenant'].includes(manifest.workspaceScope)) {
    denials.push('unsupported_workspace_scope');
  }
  return {
    ok: denials.length === 0,
    mode: manifest.hostedKernel.boundaryMode,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    workspaceScope: manifest.workspaceScope,
    denials
  };
}

function evaluateWorkspaceBoundary(manifest, principal, clientRequest) {
  const denials = [];
  const routeWorkspaceId = clientRequest.route.workspaceId || null;
  const activeWorkspaceId = clientRequest.state.activeWorkspaceId || null;
  const manifestWorkspaceIds = uniqueStrings([
    manifest.workspaceId,
    ...manifest.allowedWorkspaceIds
  ]);
  const principalWorkspaceIds = uniqueStrings([
    principal.workspaceId,
    ...principal.workspaceMemberships
  ]);
  const allowedWorkspaceIds = manifest.workspaceScope === 'tenant'
    ? principalWorkspaceIds
    : manifestWorkspaceIds.length > 0
      ? manifestWorkspaceIds.filter(workspaceId => principalWorkspaceIds.includes(workspaceId))
      : principalWorkspaceIds;

  if (!routeWorkspaceId) denials.push('route_workspace_missing');
  if (!activeWorkspaceId) denials.push('active_workspace_missing');
  if (routeWorkspaceId && principal.workspaceId && routeWorkspaceId !== principal.workspaceId && !principal.workspaceMemberships.includes(routeWorkspaceId)) {
    denials.push('route_workspace_not_in_principal_memberships');
  }
  if (activeWorkspaceId && routeWorkspaceId && activeWorkspaceId !== routeWorkspaceId) {
    denials.push('active_workspace_route_mismatch');
  }
  if (manifest.workspaceId && routeWorkspaceId && manifest.workspaceId !== routeWorkspaceId) {
    denials.push('manifest_workspace_route_mismatch');
  }
  if (manifest.allowedWorkspaceIds.length > 0 && routeWorkspaceId && !manifest.allowedWorkspaceIds.includes(routeWorkspaceId)) {
    denials.push('route_workspace_not_allowed_by_manifest');
  }
  if (manifest.workspaceScope === 'workspace' && routeWorkspaceId && !allowedWorkspaceIds.includes(routeWorkspaceId)) {
    denials.push('workspace_scope_not_authorized');
  }
  if (manifest.workspaceScope === 'tenant' && routeWorkspaceId && !principalWorkspaceIds.includes(routeWorkspaceId)) {
    denials.push('tenant_scope_workspace_not_in_principal_memberships');
  }

  return {
    ok: denials.length === 0,
    scope: manifest.workspaceScope,
    routeWorkspaceId,
    activeWorkspaceId,
    manifestWorkspaceId: manifest.workspaceId,
    allowedWorkspaceIds,
    principalWorkspaceIds,
    denials
  };
}

function buildBoundaryEnforcementContract({ manifest, principal, clientRequest, tenantBoundary, workspaceBoundary }) {
  const mode = supportedBoundaryModes.includes(manifest.hostedKernel.boundaryMode)
    ? manifest.hostedKernel.boundaryMode
    : 'deny-by-default';
  const requestedWorkspaceId = clientRequest.route.workspaceId || clientRequest.state.activeWorkspaceId || null;
  const explicitManifestWorkspaceIds = uniqueStrings([
    manifest.workspaceId,
    ...manifest.allowedWorkspaceIds
  ]);
  const principalWorkspaceIds = workspaceBoundary.principalWorkspaceIds || [];
  const denials = [];
  const warnings = [];
  const enforcedWorkspaceIds = mode === 'tenant-boundary'
    ? principalWorkspaceIds
    : workspaceBoundary.allowedWorkspaceIds;
  const requiresExplicitWorkspaceGrant = mode === 'deny-by-default' || manifest.workspaceScope === 'workspace';
  const tenantScoped = manifest.workspaceScope === 'tenant' || mode === 'tenant-boundary';

  if (!supportedBoundaryModes.includes(manifest.hostedKernel.boundaryMode)) {
    denials.push('boundary_mode_not_supported');
  }
  if (!tenantBoundary.ok) {
    denials.push('tenant_boundary_not_verified');
  }
  if (mode === 'workspace-boundary' && !workspaceBoundary.ok) {
    denials.push('workspace_boundary_not_verified');
  }
  if (mode === 'deny-by-default' && !tenantBoundary.ok) {
    denials.push('deny_by_default_requires_verified_tenant');
  }
  if (mode === 'deny-by-default' && !workspaceBoundary.ok) {
    denials.push('deny_by_default_requires_verified_workspace');
  }
  if (requiresExplicitWorkspaceGrant && explicitManifestWorkspaceIds.length === 0) {
    denials.push('explicit_workspace_grant_required');
  }
  if (requestedWorkspaceId && enforcedWorkspaceIds.length > 0 && !enforcedWorkspaceIds.includes(requestedWorkspaceId)) {
    denials.push('requested_workspace_outside_enforced_boundary');
  }
  if (tenantScoped && manifest.tenantId && principal.tenantId && manifest.tenantId !== principal.tenantId) {
    denials.push('tenant_scope_cross_tenant_route_blocked');
  }
  if (mode === 'tenant-boundary' && explicitManifestWorkspaceIds.length > 0) {
    const outsidePrincipalMembership = explicitManifestWorkspaceIds.filter(workspaceId => !principalWorkspaceIds.includes(workspaceId));
    if (outsidePrincipalMembership.length > 0) {
      denials.push('tenant_boundary_manifest_workspace_outside_membership');
    }
  }
  if (mode === 'tenant-boundary' && manifest.requestedPermissions.some(permission => hostedKernelPermissionCatalog[permission]?.scope === 'workspace') && enforcedWorkspaceIds.length === 0) {
    denials.push('tenant_boundary_workspace_permission_requires_membership');
  }
  if (mode === 'tenant-boundary' && !manifest.tenantId) {
    warnings.push('tenant_boundary_package_has_no_declared_tenant');
  }
  if (mode === 'workspace-boundary' && manifest.workspaceScope === 'tenant') {
    warnings.push('workspace_boundary_narrows_tenant_scoped_manifest');
  }

  const uniqueDenials = uniqueStrings(denials);
  return {
    schema: 'aios.packageManifest.boundaryEnforcement.v1',
    mode,
    policy: mode === 'deny-by-default'
      ? 'require-explicit-tenant-and-workspace-match'
      : mode === 'tenant-boundary'
        ? 'allow-member-workspaces-inside-tenant'
        : 'require-route-workspace-match',
    ok: uniqueDenials.length === 0,
    actorTenantId: principal.tenantId,
    routeTenantId: clientRequest.route.tenantId,
    routeWorkspaceId: requestedWorkspaceId,
    manifestTenantId: manifest.tenantId,
    manifestWorkspaceIds: explicitManifestWorkspaceIds,
    enforcedWorkspaceIds,
    requiresExplicitWorkspaceGrant,
    crossTenantBlocked: uniqueDenials.some(reason => reason.includes('tenant')),
    auditRequired: true,
    auditEventType: uniqueDenials.length === 0 ? 'package_boundary.enforced' : 'package_boundary.denied',
    handoff: {
      type: 'tenant.boundary.enforce',
      status: uniqueDenials.length === 0 ? 'ready' : 'blocked',
      routeKey: `${clientRequest.route.tenantId || 'tenantless'}:${requestedWorkspaceId || 'workspaceless'}`,
      reasonCodes: uniqueDenials,
      nextAction: uniqueDenials.length === 0 ? 'continue_manifest_evaluation' : 'workspace.boundary.select'
    },
    denials: uniqueDenials,
    warnings: uniqueStrings(warnings)
  };
}

function normalizeHistorySnapshots(input, now) {
  const snapshots = input.historySnapshots || input.manifestHistory || input.history || [];
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .map((snapshot, index) => {
      const decision = snapshot.ok === true || snapshot.decision === 'accepted' ? 'accepted' : 'rejected';
      const deniedPermissions = Array.isArray(snapshot.deniedPermissions)
        ? snapshot.deniedPermissions
        : Array.isArray(snapshot.denials)
          ? snapshot.denials.filter(denial => denial && denial.permission).map(denial => denial.permission)
          : [];
      const grantedPermissions = Array.isArray(snapshot.grantedPermissions) ? snapshot.grantedPermissions : [];
      return {
        sequence: Number.isInteger(snapshot.sequence) ? snapshot.sequence : index + 1,
        capturedAt: snapshot.capturedAt || snapshot.generatedAt || snapshot.issuedAt || now,
        packageId: snapshot.packageId || snapshot.id || null,
        packageVersion: snapshot.packageVersion || snapshot.version || null,
        decision,
        proofDigest: snapshot.proofDigest || snapshot.digest || null,
        requestedCount: Number.isInteger(snapshot.requestedCount)
          ? snapshot.requestedCount
          : grantedPermissions.length + deniedPermissions.length,
        grantedCount: Number.isInteger(snapshot.grantedCount) ? snapshot.grantedCount : grantedPermissions.length,
        deniedCount: Number.isInteger(snapshot.deniedCount) ? snapshot.deniedCount : deniedPermissions.length,
        auditRequired: snapshot.auditRequired === true,
        reasons: uniqueStrings(Array.isArray(snapshot.reasons) ? snapshot.reasons : [])
      };
    })
    .filter(snapshot => snapshot.packageId || snapshot.proofDigest || snapshot.requestedCount > 0)
    .slice(-12);
}

function countReasons(denials) {
  return denials.reduce((counts, denial) => {
    const reason = denial.reason || 'unspecified_denial';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function buildCurrentHistorySnapshot({ now, manifest, ok, permissionEvaluations, deniedPermissions, auditHandoff, boundaryProof, actionableErrors }) {
  return {
    sequence: 0,
    capturedAt: now,
    packageId: manifest.id,
    packageVersion: manifest.version,
    decision: ok ? 'accepted' : 'rejected',
    proofDigest: boundaryProof.digest,
    requestedCount: permissionEvaluations.length,
    grantedCount: permissionEvaluations.filter(result => result.granted).length,
    deniedCount: deniedPermissions.length,
    auditRequired: auditHandoff.required,
    reasons: uniqueStrings([
      ...deniedPermissions.map(denial => denial.reason),
      ...actionableErrors.blocking
    ])
  };
}

function summarizeSnapshotWindow(snapshots) {
  const accepted = snapshots.filter(snapshot => snapshot.decision === 'accepted').length;
  const rejected = snapshots.filter(snapshot => snapshot.decision === 'rejected').length;
  const requestedPermissions = snapshots.reduce((total, snapshot) => total + snapshot.requestedCount, 0);
  const deniedPermissions = snapshots.reduce((total, snapshot) => total + snapshot.deniedCount, 0);
  const auditRequired = snapshots.filter(snapshot => snapshot.auditRequired).length;
  const reasonCounts = countReasons(snapshots.flatMap(snapshot => snapshot.reasons.map(reason => ({ reason }))));
  return {
    snapshotCount: snapshots.length,
    accepted,
    rejected,
    acceptanceRate: ratio(accepted, snapshots.length),
    denialRate: ratio(deniedPermissions, requestedPermissions),
    auditRequiredRate: ratio(auditRequired, snapshots.length),
    requestedPermissions,
    deniedPermissions,
    topReasons: Object.entries(reasonCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }))
  };
}

function buildAnalyticsHistoryReport({ now, manifest, historySnapshots, currentSnapshot, analyticsCounters, timeline }) {
  const orderedSnapshots = [...historySnapshots, currentSnapshot]
    .sort((left, right) => {
      const leftTime = Date.parse(left.capturedAt);
      const rightTime = Date.parse(right.capturedAt);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
      return left.sequence - right.sequence;
    });
  const previousWindow = summarizeSnapshotWindow(historySnapshots);
  const currentWindow = summarizeSnapshotWindow(orderedSnapshots);
  const previousDecision = historySnapshots.length > 0 ? historySnapshots[historySnapshots.length - 1].decision : null;
  const decisionChanged = Boolean(previousDecision && previousDecision !== currentSnapshot.decision);
  const retentionCutoff = orderedSnapshots.length > 12 ? orderedSnapshots[orderedSnapshots.length - 12].capturedAt : orderedSnapshots[0]?.capturedAt || now;
  const exportRows = orderedSnapshots.slice(-12).map((snapshot, index) => ({
    rowId: stableHash({
      surfaceId,
      packageId: snapshot.packageId || manifest.id,
      packageVersion: snapshot.packageVersion || manifest.version,
      proofDigest: snapshot.proofDigest,
      capturedAt: snapshot.capturedAt,
      index
    }),
    capturedAt: snapshot.capturedAt,
    packageId: snapshot.packageId || manifest.id,
    packageVersion: snapshot.packageVersion || manifest.version,
    decision: snapshot.decision,
    proofDigest: snapshot.proofDigest,
    requestedCount: snapshot.requestedCount,
    grantedCount: snapshot.grantedCount,
    deniedCount: snapshot.deniedCount,
    auditRequired: snapshot.auditRequired,
    reasons: snapshot.reasons
  }));
  return {
    schema: 'aios.packageManifest.analyticsHistoryReport.v1',
    generatedAt: now,
    packageKey: `${manifest.id}@${manifest.version}`,
    currentSnapshot,
    windows: {
      previous: previousWindow,
      includingCurrent: currentWindow
    },
    trend: {
      previousDecision,
      currentDecision: currentSnapshot.decision,
      decisionChanged,
      acceptanceRateDelta: previousWindow.acceptanceRate === null || currentWindow.acceptanceRate === null
        ? null
        : Number((currentWindow.acceptanceRate - previousWindow.acceptanceRate).toFixed(4)),
      denialRateDelta: previousWindow.denialRate === null || currentWindow.denialRate === null
        ? null
        : Number((currentWindow.denialRate - previousWindow.denialRate).toFixed(4)),
      currentDeniedPermissions: currentSnapshot.deniedCount,
      currentBlockingReasons: currentSnapshot.reasons
    },
    exportBatch: {
      schema: 'aios.packageManifest.analyticsExportRows.v1',
      generatedAt: now,
      sink: 'kernel.analytics.package-manifest',
      rowCount: exportRows.length,
      batchDigest: stableHash(exportRows),
      rows: exportRows
    },
    timelineIndex: {
      stream: 'kernel.timeline.package-manifest',
      eventCount: timeline.length,
      firstEventAt: timeline[0]?.at || now,
      lastEventAt: timeline[timeline.length - 1]?.at || now,
      phases: uniqueStrings(timeline.map(event => event.phase))
    },
    retention: {
      retainedSnapshotCount: exportRows.length,
      maxSnapshots: 12,
      cutoffCapturedAt: retentionCutoff,
      droppedSnapshotCount: Math.max(0, orderedSnapshots.length - exportRows.length)
    },
    countersDigest: stableHash(analyticsCounters)
  };
}

function retryAfterTimestamp(now, backoffMs) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isInteger(backoffMs)) return null;
  return new Date(timestamp + backoffMs).toISOString();
}

function parseLifecycleTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeHealthProbeRecord(record, name, now) {
  const probe = typeof record === 'string'
    ? { state: record }
    : typeof record === 'boolean'
      ? { state: record ? 'healthy' : 'unavailable' }
      : (record || {});
  const state = supportedHealthProbeStates.includes(probe.state)
    ? probe.state
    : probe.ok === false
      ? 'unavailable'
      : 'healthy';
  const required = probe.required !== false;
  const latencyMs = Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0 ? probe.latencyMs : null;
  const staleAfterMs = Number.isInteger(probe.staleAfterMs) && probe.staleAfterMs > 0 ? probe.staleAfterMs : null;
  const lastOkAt = probe.lastOkAt || probe.checkedAt || null;
  const stale = staleAfterMs && lastOkAt
    ? Date.parse(now) - Date.parse(lastOkAt) > staleAfterMs
    : false;
  const reason = probe.reason || probe.failureReason || `${name}_${state}`;
  return {
    name,
    state: stale && state === 'healthy' ? 'degraded' : state,
    required,
    reason: stale && state === 'healthy' ? `${name}_stale` : reason,
    retryable: probe.retryable === true || retryableFailureReasons.includes(reason),
    latencyMs,
    stale,
    lastOkAt,
    checkedAt: probe.checkedAt || now,
    action: probe.action || healthProbeActionCatalog[reason] || null
  };
}

function buildRuntimeFailureState({ state, healthProbes, degradedReasons, retry }) {
  const requiredFailures = healthProbes.filter(probe => probe.required && ['unavailable', 'failed', 'timeout'].includes(probe.state));
  const optionalFailures = healthProbes.filter(probe => !probe.required && probe.state !== 'healthy');
  const staleRequired = healthProbes.filter(probe => probe.required && probe.stale);
  const incidentReasons = uniqueStrings([
    ...requiredFailures.map(probe => probe.reason),
    ...staleRequired.map(probe => probe.reason),
    ...degradedReasons
  ]);
  const circuitOpen = state === 'failed' || requiredFailures.length > 0 || (incidentReasons.length > 0 && retry.attempts >= retry.maxAttempts);
  return {
    schema: 'aios.packageManifest.runtimeFailureState.v1',
    phase: circuitOpen ? 'circuit-open' : incidentReasons.length > 0 ? 'degraded-mode' : 'normal',
    circuitOpen,
    installBlocked: circuitOpen,
    requiredProbeFailures: requiredFailures.map(probe => probe.name),
    optionalProbeFailures: optionalFailures.map(probe => probe.name),
    staleRequiredProbes: staleRequired.map(probe => probe.name),
    incidentReasons,
    retryExhausted: retry.attempts >= retry.maxAttempts,
    degradedCapabilities: {
      canPreviewManifest: true,
      canAppendAudit: !incidentReasons.includes('audit_sink_unavailable'),
      canResolveWorkspace: !incidentReasons.includes('workspace_resolver_timeout'),
      canEvaluatePermissions: !incidentReasons.includes('permission_catalog_stale'),
      canInstall: !circuitOpen && state === 'healthy'
    }
  };
}

function normalizeRuntimeHealth(input, now) {
  const runtime = input.runtimeHealth || input.health || input.operationalHealth || {};
  const retry = runtime.retry || input.retry || {};
  const dependencies = runtime.dependencies || input.dependencies || {};
  const dependencyProbes = Object.entries(dependencies).map(([name, state]) => normalizeHealthProbeRecord(state, name, now));
  const declaredProbes = Array.isArray(runtime.probes)
    ? runtime.probes.map((probe, index) => normalizeHealthProbeRecord(probe, probe.name || probe.dependency || `probe-${index + 1}`, now))
    : [];
  const healthProbes = [...dependencyProbes, ...declaredProbes];
  const degradedReasons = uniqueStrings([
    ...(Array.isArray(runtime.degradedReasons) ? runtime.degradedReasons : []),
    ...healthProbes
      .filter(probe => probe.state !== 'healthy')
      .map(probe => probe.reason)
  ]);
  const reportedState = supportedHealthStates.includes(runtime.state) ? runtime.state : null;
  const attempts = Number.isInteger(retry.attempts) && retry.attempts >= 0 ? retry.attempts : 0;
  const maxAttempts = Number.isInteger(retry.maxAttempts) && retry.maxAttempts > 0 ? retry.maxAttempts : 3;
  const requiredProbeFailed = healthProbes.some(probe => probe.required && ['unavailable', 'failed', 'timeout'].includes(probe.state));
  const state = reportedState || (requiredProbeFailed ? 'failed' : degradedReasons.length > 0 ? 'degraded' : 'healthy');
  const jitterMs = Number.isInteger(retry.jitterMs) && retry.jitterMs >= 0 ? Math.min(1000, retry.jitterMs) : 0;
  const backoffMs = Math.min(30000, Math.max(250, 500 * (2 ** Math.min(attempts, 5))) + jitterMs);
  const retryContract = {
    attempts,
    maxAttempts,
    retryableReasons: uniqueStrings([...retryableFailureReasons, ...healthProbes.filter(probe => probe.retryable).map(probe => probe.reason)]),
    nextBackoffMs: attempts < maxAttempts ? backoffMs : null,
    retryAllowed: attempts < maxAttempts,
    retryAfter: attempts < maxAttempts ? retryAfterTimestamp(now, backoffMs) : null
  };
  const failureState = buildRuntimeFailureState({ state, healthProbes, degradedReasons, retry: retryContract });
  return {
    schema: 'aios.packageManifest.operationalHealth.v1',
    checkedAt: runtime.checkedAt || now,
    state,
    degraded: state !== 'healthy',
    degradedReasons,
    healthProbes,
    failureState,
    degradedMode: {
      active: failureState.phase === 'degraded-mode',
      capabilities: failureState.degradedCapabilities,
      requiredManualReview: failureState.circuitOpen && !retryContract.retryAllowed,
      userVisibleBanner: failureState.circuitOpen ? 'Package install is blocked by hosted-kernel health.' : state === 'degraded' ? 'Package can be reviewed while runtime recovery is pending.' : null
    },
    dependencies,
    retry: retryContract
  };
}

function normalizeLifecycleCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'install';
  const normalized = command.trim().replace(/^kernel\.package\./, '').replace(/_package$/, '');
  return normalized === 'lifecycle.schedule' ? 'schedule' : normalized;
}

function normalizeLifecycleCommandPolicies({ lifecycle, controls, settings, requestedCommand }) {
  const rawPolicies = lifecycle.commandPolicies || lifecycle.commands || controls.commandPolicies || controls.commands || settings.commandPolicies || {};
  const globalEnabled = controls.enabled !== false && settings.enabled !== false;
  const globalLocked = controls.locked === true || settings.locked === true;
  const defaultDisabledReason = controls.disabledReason || settings.disabledReason || null;
  const entries = Object.fromEntries(supportedLifecycleCommands.map(command => {
    const rawPolicy = rawPolicies[command] || rawPolicies[`kernel.package.${command}`] || {};
    const canBypassGlobalDisable = command === 'enable' || command === 'disable';
    const enabled = rawPolicy.enabled !== false && (globalEnabled || canBypassGlobalDisable);
    const locked = rawPolicy.locked === true || (globalLocked && rawPolicy.locked !== false);
    return [command, {
      command,
      enabled,
      locked,
      requested: command === requestedCommand,
      disabledReason: enabled
        ? null
        : rawPolicy.disabledReason || defaultDisabledReason || `${command}_disabled_by_lifecycle_control`,
      lockReason: locked ? rawPolicy.lockReason || controls.lockReason || settings.lockReason || 'lifecycle_command_locked' : null,
      requireAuditReceipt: rawPolicy.requireAuditReceipt ?? controls.requireAuditReceipt ?? settings.requireAuditReceipt ?? true,
      requireHealthyRuntime: rawPolicy.requireHealthyRuntime ?? controls.requireHealthyRuntime ?? settings.requireHealthyRuntime ?? true,
      requiresSchedule: rawPolicy.requiresSchedule === true,
      schedulePolicy: supportedSchedulePolicies.includes(rawPolicy.schedulePolicy) ? rawPolicy.schedulePolicy : null,
      nextActionWhenBlocked: rawPolicy.nextActionWhenBlocked || `resolve_${command}_lifecycle_control`
    }];
  }));
  return {
    schema: 'aios.packageManifest.lifecycleCommandPolicies.v1',
    requestedCommand,
    globalEnabled,
    globalLocked,
    entries,
    requested: entries[requestedCommand] || {
      command: requestedCommand,
      enabled: false,
      locked: false,
      requested: true,
      disabledReason: 'unsupported_lifecycle_command',
      lockReason: null,
      requireAuditReceipt: true,
      requireHealthyRuntime: true,
      requiresSchedule: false,
      schedulePolicy: null,
      nextActionWhenBlocked: 'resolve_lifecycle_settings'
    }
  };
}

function normalizeLifecycleSettings(input, manifest, clientRequest, now) {
  const lifecycle = input.lifecycle || input.lifecycleSettings || input.packageLifecycle || {};
  const settings = lifecycle.settings || input.settings || {};
  const controls = lifecycle.controls || input.controls || {};
  const schedule = lifecycle.schedule || settings.schedule || input.schedule || {};
  const requestedCommand = normalizeLifecycleCommand(lifecycle.command || controls.command || clientRequest.action);
  const commandPolicies = normalizeLifecycleCommandPolicies({ lifecycle, controls, settings, requestedCommand });
  const requestedPolicy = commandPolicies.requested;
  const rawCurrentState = lifecycle.currentState || settings.currentState || controls.currentState || input.packageState || 'uninstalled';
  const currentState = supportedPackageLifecycleStates.includes(rawCurrentState) ? rawCurrentState : 'uninstalled';
  const policy = supportedSchedulePolicies.includes(schedule.policy)
    ? schedule.policy
    : requestedPolicy.schedulePolicy || (schedule.windowStart || schedule.windowEnd ? 'maintenance-window' : 'manual');
  return {
    schema: 'aios.packageManifest.lifecycleSettings.v1',
    capturedAt: lifecycle.capturedAt || now,
    requestedCommand,
    enabled: controls.enabled !== false && settings.enabled !== false,
    disabledReason: controls.disabledReason || settings.disabledReason || null,
    rawCurrentState,
    currentState,
    desiredState: lifecycle.desiredState || settings.desiredState || null,
    requireAuditReceipt: controls.requireAuditReceipt !== false,
    requireHealthyRuntime: controls.requireHealthyRuntime !== false,
    allowRollback: controls.allowRollback === true || settings.allowRollback === true,
    rollbackVersion: lifecycle.rollbackVersion || settings.rollbackVersion || null,
    commandPolicies,
    requestedCommandPolicy: requestedPolicy,
    schedule: {
      policy,
      windowStart: schedule.windowStart || null,
      windowEnd: schedule.windowEnd || null,
      notBefore: schedule.notBefore || null,
      timezone: schedule.timezone || input.timezone || 'UTC',
      deadlineAt: schedule.deadlineAt || null
    },
    target: {
      packageId: lifecycle.packageId || manifest.id,
      packageVersion: lifecycle.packageVersion || manifest.version,
      workspaceId: lifecycle.workspaceId || clientRequest.route.workspaceId
    }
  };
}

function expectedLifecycleTargetState(command, lifecycleSettings) {
  if (lifecycleSettings.desiredState && supportedPackageLifecycleStates.includes(lifecycleSettings.desiredState)) {
    return lifecycleSettings.desiredState;
  }
  if (command === 'install' || command === 'enable' || command === 'resume') return 'enabled';
  if (command === 'disable') return 'disabled';
  if (command === 'pause') return 'paused';
  if (command === 'schedule') return 'scheduled';
  if (command === 'rollback') return lifecycleSettings.currentState === 'enabled' ? 'enabled' : 'installed';
  return lifecycleSettings.currentState;
}

function lifecycleTransitionAllowed(command, currentState) {
  const allowedFrom = {
    install: ['uninstalled', 'failed'],
    enable: ['installed', 'disabled', 'paused'],
    disable: ['installed', 'enabled', 'paused', 'scheduled', 'failed'],
    pause: ['enabled', 'scheduled'],
    resume: ['paused', 'disabled'],
    schedule: ['installed', 'enabled', 'disabled', 'paused'],
    rollback: ['installed', 'enabled', 'disabled', 'paused', 'failed']
  };
  return (allowedFrom[command] || []).includes(currentState);
}

function buildLifecycleCommandPlan({ manifest, lifecycleSettings, lifecycleValidation, auditHandoff, boundaryProof, operationalHealth, commandStatus }) {
  const command = lifecycleSettings.requestedCommand;
  const currentState = lifecycleSettings.currentState;
  const targetState = expectedLifecycleTargetState(command, lifecycleSettings);
  const scheduleActive = lifecycleSettings.schedule.policy !== 'manual';
  const schedulerIntent = scheduleActive
    ? {
      type: 'kernel.package.lifecycle.schedule',
      status: commandStatus === 'ready' ? 'ready' : commandStatus,
      policy: lifecycleSettings.schedule.policy,
      windowStart: lifecycleSettings.schedule.windowStart,
      windowEnd: lifecycleSettings.schedule.windowEnd,
      notBefore: lifecycleSettings.schedule.notBefore,
      deadlineAt: lifecycleSettings.schedule.deadlineAt,
      timezone: lifecycleSettings.schedule.timezone
    }
    : null;
  const stateMutation = {
    type: 'kernel.package.lifecycle.state.set',
    packageId: manifest.id,
    packageVersion: manifest.version,
    from: currentState,
    to: targetState,
    noop: currentState === targetState && command !== 'rollback',
    requiresScheduler: scheduleActive,
    requiresAuditReceipt: lifecycleSettings.requestedCommandPolicy.requireAuditReceipt,
    requiresHealthyRuntime: lifecycleSettings.requestedCommandPolicy.requireHealthyRuntime
  };
  const enablement = {
    enabledAfterCommand: ['install', 'enable', 'resume'].includes(command)
      ? true
      : ['disable', 'pause'].includes(command)
        ? false
        : currentState === 'enabled',
    controlsWritable: lifecycleSettings.enabled && !lifecycleSettings.requestedCommandPolicy.locked,
    disableReasonAfterCommand: command === 'disable'
      ? lifecycleSettings.disabledReason || 'disabled_by_package_lifecycle_command'
      : command === 'pause'
        ? 'paused_by_package_lifecycle_command'
        : null
  };
  const nextActionState = lifecycleValidation.ok && commandStatus === 'ready'
    ? scheduleActive
      ? 'awaiting_scheduler_ack'
      : 'awaiting_kernel_ack'
    : operationalHealth.failureState.circuitOpen
      ? 'awaiting_runtime_recovery'
      : 'awaiting_user_resolution';
  return {
    schema: 'aios.packageManifest.lifecycleCommandPlan.v1',
    command,
    currentState,
    targetState,
    transitionAllowed: lifecycleTransitionAllowed(command, currentState),
    commandStatus,
    stateMutation,
    enablement,
    schedulerIntent,
    auditReceipt: {
      required: auditHandoff.required,
      correlationId: auditHandoff.correlationId,
      proofDigest: boundaryProof.digest
    },
    nextActionState,
    applyPayload: {
      type: `kernel.package.${command}`,
      packageId: manifest.id,
      packageVersion: manifest.version,
      workspaceId: lifecycleSettings.target.workspaceId,
      proofDigest: boundaryProof.digest,
      auditCorrelationId: auditHandoff.correlationId,
      targetState,
      schedule: lifecycleSettings.schedule
    }
  };
}

function validateLifecycleSettings(lifecycleSettings, { ok, manifest, operationalHealth, auditHandoff, now }) {
  const issues = [];
  const { requestedCommand, schedule } = lifecycleSettings;
  const requestedPolicy = lifecycleSettings.requestedCommandPolicy;
  const nowTimestamp = parseLifecycleTimestamp(now);
  const notBeforeTimestamp = parseLifecycleTimestamp(schedule.notBefore);
  const deadlineTimestamp = parseLifecycleTimestamp(schedule.deadlineAt);
  const windowStartTimestamp = parseLifecycleTimestamp(schedule.windowStart);
  const windowEndTimestamp = parseLifecycleTimestamp(schedule.windowEnd);
  if (!supportedLifecycleCommands.includes(requestedCommand)) {
    issues.push(buildContractIssue('lifecycle.requestedCommand', 'unsupported_lifecycle_command', 'error', supportedLifecycleCommands));
  }
  if (!supportedPackageLifecycleStates.includes(lifecycleSettings.rawCurrentState)) {
    issues.push(buildContractIssue('lifecycle.currentState', 'unsupported_package_lifecycle_state', 'error', {
      received: lifecycleSettings.rawCurrentState,
      supported: supportedPackageLifecycleStates
    }));
  }
  if (lifecycleSettings.desiredState && !supportedPackageLifecycleStates.includes(lifecycleSettings.desiredState)) {
    issues.push(buildContractIssue('lifecycle.desiredState', 'unsupported_desired_lifecycle_state', 'error', supportedPackageLifecycleStates));
  }
  if (supportedLifecycleCommands.includes(requestedCommand) && !lifecycleTransitionAllowed(requestedCommand, lifecycleSettings.currentState)) {
    issues.push(buildContractIssue('lifecycle.currentState', 'lifecycle_command_not_allowed_from_current_state', 'error', {
      command: requestedCommand,
      currentState: lifecycleSettings.currentState
    }));
  }
  if (!supportedSchedulePolicies.includes(schedule.policy)) {
    issues.push(buildContractIssue('lifecycle.schedule.policy', 'unsupported_schedule_policy', 'error', supportedSchedulePolicies));
  }
  if (schedule.policy === 'maintenance-window' && (!schedule.windowStart || !schedule.windowEnd)) {
    issues.push(buildContractIssue('lifecycle.schedule', 'maintenance_window_requires_start_and_end', 'error', 'Provide both windowStart and windowEnd.'));
  }
  if (schedule.windowStart && !windowStartTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.windowStart', 'invalid_schedule_window_start', 'error', 'Use an ISO-8601 timestamp.'));
  }
  if (schedule.windowEnd && !windowEndTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.windowEnd', 'invalid_schedule_window_end', 'error', 'Use an ISO-8601 timestamp.'));
  }
  if (windowStartTimestamp && windowEndTimestamp && windowEndTimestamp <= windowStartTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.windowEnd', 'maintenance_window_end_must_follow_start', 'error', 'windowEnd must be after windowStart.'));
  }
  if (schedule.notBefore && !notBeforeTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.notBefore', 'invalid_schedule_not_before', 'error', 'Use an ISO-8601 timestamp.'));
  }
  if (schedule.deadlineAt && !deadlineTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.deadlineAt', 'invalid_schedule_deadline', 'error', 'Use an ISO-8601 timestamp.'));
  }
  if (notBeforeTimestamp && deadlineTimestamp && deadlineTimestamp <= notBeforeTimestamp) {
    issues.push(buildContractIssue('lifecycle.schedule.deadlineAt', 'schedule_deadline_must_follow_not_before', 'error', 'deadlineAt must be after notBefore.'));
  }
  if (notBeforeTimestamp && nowTimestamp && notBeforeTimestamp < nowTimestamp && schedule.policy !== 'immediate') {
    issues.push(buildContractIssue('lifecycle.schedule.notBefore', 'schedule_not_before_is_in_past', 'warning', schedule.notBefore));
  }
  if (schedule.policy === 'immediate' && (schedule.windowStart || schedule.windowEnd)) {
    issues.push(buildContractIssue('lifecycle.schedule.policy', 'immediate_schedule_ignores_maintenance_window', 'warning', 'Use maintenance-window when windowStart/windowEnd should gate execution.'));
  }
  if (requestedPolicy.locked) {
    issues.push(buildContractIssue(`lifecycle.commandPolicies.${requestedCommand}.locked`, 'requested_lifecycle_command_locked', 'error', requestedPolicy.lockReason));
  }
  if (!requestedPolicy.enabled) {
    issues.push(buildContractIssue(`lifecycle.commandPolicies.${requestedCommand}.enabled`, 'requested_lifecycle_command_disabled', 'error', requestedPolicy.disabledReason));
  }
  if (requestedPolicy.requiresSchedule && schedule.policy === 'manual') {
    issues.push(buildContractIssue(`lifecycle.commandPolicies.${requestedCommand}.requiresSchedule`, 'requested_command_requires_schedule_policy', 'error', supportedSchedulePolicies.filter(policy => policy !== 'manual')));
  }
  if (requestedCommand === 'rollback' && !lifecycleSettings.allowRollback) {
    issues.push(buildContractIssue('lifecycle.allowRollback', 'rollback_requires_explicit_control', 'error', 'Set allowRollback=true for rollback commands.'));
  }
  if (requestedCommand === 'rollback' && !lifecycleSettings.rollbackVersion) {
    issues.push(buildContractIssue('lifecycle.rollbackVersion', 'rollback_requires_target_version', 'error', 'Provide rollbackVersion.'));
  }
  if (lifecycleSettings.target.packageId !== manifest.id || lifecycleSettings.target.packageVersion !== manifest.version) {
    issues.push(buildContractIssue('lifecycle.target', 'lifecycle_target_must_match_manifest', 'error', 'Lifecycle target must match the evaluated manifest.'));
  }
  if (requestedPolicy.requireHealthyRuntime && operationalHealth.state !== 'healthy') {
    issues.push(buildContractIssue('lifecycle.requireHealthyRuntime', 'lifecycle_requires_healthy_runtime', operationalHealth.state === 'failed' ? 'error' : 'warning', operationalHealth.state));
  }
  if (requestedPolicy.requireAuditReceipt && auditHandoff.required && !auditHandoff.proofDigest) {
    issues.push(buildContractIssue('lifecycle.requireAuditReceipt', 'audit_receipt_required_before_lifecycle_command', 'error', auditHandoff.channel));
  }
  if (!ok && ['install', 'enable', 'resume', 'schedule'].includes(requestedCommand)) {
    issues.push(buildContractIssue('lifecycle.requestedCommand', 'lifecycle_command_waits_for_manifest_acceptance', 'error', 'Resolve manifest denials before applying this lifecycle command.'));
  }
  return {
    schema: 'aios.packageManifest.lifecycleValidation.v1',
    ok: issues.every(issue => !issue.blocking),
    supportedLifecycleCommands,
    supportedSchedulePolicies,
    issues,
    blockingIssues: issues.filter(issue => issue.blocking),
    warnings: issues.filter(issue => !issue.blocking)
  };
}

function buildLifecycleControls({ ok, manifest, lifecycleSettings, lifecycleValidation, auditHandoff, boundaryProof, operationalHealth }) {
  const requestedPolicy = lifecycleSettings.requestedCommandPolicy;
  const canMutate = ok
    && lifecycleValidation.ok
    && requestedPolicy.enabled
    && !requestedPolicy.locked
    && (!requestedPolicy.requireHealthyRuntime || operationalHealth.state === 'healthy');
  const commandStatus = canMutate
    ? 'ready'
    : operationalHealth.failureState.installBlocked
      ? 'blocked'
      : operationalHealth.degraded
        ? 'deferred'
        : 'blocked';
  const nextAction = canMutate
    ? `kernel.package.${lifecycleSettings.requestedCommand}`
    : operationalHealth.failureState.circuitOpen && operationalHealth.retry.retryAllowed
      ? 'kernel.package.retry'
      : operationalHealth.failureState.circuitOpen
        ? 'resolve_runtime_failure_state'
    : lifecycleValidation.blockingIssues.length > 0
      ? requestedPolicy.nextActionWhenBlocked
      : 'resolve_manifest_denials';
  const commandAvailability = Object.fromEntries(Object.entries(lifecycleSettings.commandPolicies.entries).map(([command, policy]) => [
    command,
    {
      enabled: policy.enabled,
      locked: policy.locked,
      available: ok && policy.enabled && !policy.locked && (!policy.requireHealthyRuntime || operationalHealth.state === 'healthy'),
      disabledReason: policy.disabledReason || policy.lockReason || null,
      requiresSchedule: policy.requiresSchedule
    }
  ]));
  const commandPlan = buildLifecycleCommandPlan({
    manifest,
    lifecycleSettings,
    lifecycleValidation,
    auditHandoff,
    boundaryProof,
    operationalHealth,
    commandStatus
  });
  return {
    schema: 'aios.packageManifest.lifecycleControls.v1',
    packageId: manifest.id,
    packageVersion: manifest.version,
    requestedCommand: lifecycleSettings.requestedCommand,
    requestedCommandPolicy: requestedPolicy,
    commandStatus,
    controls: {
      enabled: lifecycleSettings.enabled,
      disabledReason: lifecycleSettings.enabled ? null : lifecycleSettings.disabledReason || 'disabled_by_lifecycle_control',
      commandAvailability,
      installEnabled: canMutate && lifecycleSettings.requestedCommand === 'install',
      enableAvailable: commandAvailability.enable.available,
      disableAvailable: commandAvailability.disable.available,
      pauseAvailable: commandAvailability.pause.available,
      resumeAvailable: commandAvailability.resume.available,
      rollbackAvailable: commandAvailability.rollback.available && lifecycleSettings.allowRollback,
      scheduleAvailable: commandAvailability.schedule.available && lifecycleValidation.ok && lifecycleSettings.schedule.policy !== 'manual'
    },
    commandPlan,
    schedule: {
      ...lifecycleSettings.schedule,
      scheduled: lifecycleSettings.schedule.policy !== 'manual' && commandStatus === 'ready',
      schedulerCommand: lifecycleSettings.schedule.policy === 'manual' ? null : 'kernel.package.lifecycle.schedule'
    },
    nextAction: {
      type: nextAction,
      status: commandStatus,
      proofDigest: boundaryProof.digest,
      auditCorrelationId: auditHandoff.correlationId,
      retryAfterMs: operationalHealth.retry.retryAllowed ? operationalHealth.retry.nextBackoffMs : null
    },
    validation: lifecycleValidation
  };
}

function buildActionableErrors({ ok, contractValidation, tenantBoundary, workspaceBoundary, deniedPermissions, operationalHealth, lifecycleValidation = null, providerNegotiation = null }) {
  const operationalReasons = operationalHealth.degradedReasons.length > 0
    ? operationalHealth.degradedReasons
    : operationalHealth.degraded
      ? [`operational_health_${operationalHealth.state}`]
      : [];
  const errors = [
    ...contractValidation.blockingIssues.map(issue => ({
      code: issue.code,
      field: issue.field,
      severity: 'error',
      retryable: false,
      action: issue.detail || 'Update the package manifest and submit it again.'
    })),
    ...tenantBoundary.denials.map(reason => ({
      code: reason,
      field: 'tenantBoundary',
      severity: 'error',
      retryable: false,
      action: 'Select a tenant/workspace that matches the manifest boundary.'
    })),
    ...workspaceBoundary.denials.map(reason => ({
      code: reason,
      field: 'workspaceBoundary',
      severity: 'error',
      retryable: reason.includes('missing'),
      action: reason.includes('missing') ? 'Reload workspace context before retrying.' : 'Choose an authorized workspace route.'
    })),
    ...deniedPermissions.map(({ permission, reason }) => ({
      code: reason,
      field: `permissions.${permission}`,
      severity: 'error',
      retryable: reason === 'permission_catalog_stale',
      action: reason === 'role_ceiling_exceeded' ? 'Request a role with the required permission ceiling.' : `Resolve permission ${permission}.`
    })),
    ...((lifecycleValidation && lifecycleValidation.issues) || []).map(issue => ({
      code: issue.code,
      field: issue.field,
      severity: issue.severity,
      retryable: issue.code === 'lifecycle_requires_healthy_runtime' && operationalHealth.retry.retryAllowed,
      action: issue.detail || 'Update lifecycle settings before applying package controls.'
    })),
    ...((providerNegotiation && providerNegotiation.issues) || []).map(issue => ({
      code: issue.code,
      field: issue.field,
      severity: issue.severity,
      retryable: issue.code === 'required_provider_capability_unavailable',
      action: issue.code === 'required_provider_capability_unavailable'
        ? 'Resolve the provider capability handoff before installing this package.'
        : issue.detail || 'Update provider contract metadata.'
    }))
  ];
  if (operationalHealth.degraded) {
    const incidentByReason = new Map(operationalHealth.healthProbes.map(probe => [probe.reason, probe]));
    for (const reason of operationalReasons) {
      const probe = incidentByReason.get(reason) || null;
      const retryable = Boolean(probe?.retryable) || operationalHealth.retry.retryableReasons.includes(reason);
      errors.push({
        code: reason,
        field: probe ? `operationalHealth.probes.${probe.name}` : 'operationalHealth',
        severity: operationalHealth.failureState.incidentReasons.includes(reason) || operationalHealth.state === 'failed' ? 'error' : 'warning',
        retryable,
        action: probe?.action || (retryable ? 'Retry after the provided backoff interval.' : 'Continue in degraded mode with install blocked if proof/audit cannot be completed.'),
        retryAfter: retryable ? operationalHealth.retry.retryAfter : null
      });
    }
  }
  if (operationalHealth.failureState.retryExhausted) {
    errors.push({
      code: 'runtime_retry_budget_exhausted',
      field: 'operationalHealth.retry',
      severity: 'error',
      retryable: false,
      action: 'Escalate the package to manual hosted-kernel review before another lifecycle command is accepted.'
    });
  }
  return {
    schema: 'aios.packageManifest.actionableErrors.v1',
    ok: ok && !operationalHealth.degraded && errors.every(error => error.severity !== 'error'),
    errors,
    retryable: errors.filter(error => error.retryable).map(error => error.code),
    blocking: errors.filter(error => error.severity === 'error').map(error => error.code)
  };
}

function buildAnalyticsCounters({ ok, manifest, contractValidation, tenantBoundary, workspaceBoundary, permissionEvaluations, deniedPermissions, auditHandoff, historySnapshots, operationalHealth, actionableErrors, lifecycleControls, providerContracts, providerNegotiation }) {
  const requiredAuditPermissions = permissionEvaluations
    .filter(result => result.audit === 'required')
    .map(result => result.permission);
  const optionalAuditPermissions = permissionEvaluations
    .filter(result => result.audit === 'optional')
    .map(result => result.permission);
  const acceptedHistory = historySnapshots.filter(snapshot => snapshot.decision === 'accepted').length;
  const rejectedHistory = historySnapshots.filter(snapshot => snapshot.decision === 'rejected').length;
  const totalHistoricalDenials = historySnapshots.reduce((total, snapshot) => total + snapshot.deniedCount, 0);
  return {
    decisions: {
      accepted: ok ? 1 : 0,
      rejected: ok ? 0 : 1,
      historicalAccepted: acceptedHistory,
      historicalRejected: rejectedHistory
    },
    permissions: {
      requested: manifest.requestedPermissions.length,
      granted: permissionEvaluations.filter(result => result.granted).length,
      denied: deniedPermissions.length,
      auditRequired: requiredAuditPermissions.length,
      auditOptional: optionalAuditPermissions.length,
      unknown: deniedPermissions.filter(result => result.reason === 'permission_not_in_hosted_kernel_catalog').length
    },
    contractValidation: {
      checked: 1,
      passed: contractValidation.ok ? 1 : 0,
      failed: contractValidation.ok ? 0 : 1,
      blockingIssues: contractValidation.blockingIssues.length,
      warnings: contractValidation.warnings.length
    },
    tenantBoundary: {
      checked: 1,
      passed: tenantBoundary.ok ? 1 : 0,
      failed: tenantBoundary.ok ? 0 : 1,
      denials: tenantBoundary.denials.length
    },
    workspaceBoundary: {
      checked: 1,
      passed: workspaceBoundary.ok ? 1 : 0,
      failed: workspaceBoundary.ok ? 0 : 1,
      candidateWorkspaces: workspaceBoundary.principalWorkspaceIds.length,
      allowedWorkspaces: workspaceBoundary.allowedWorkspaceIds.length,
      denials: workspaceBoundary.denials.length
    },
    audit: {
      handoffs: auditHandoff.required ? 1 : 0,
      requiredByPermission: requiredAuditPermissions.length,
      requiredByRejection: ok ? 0 : 1
    },
    operationalHealth: {
      checked: 1,
      healthy: operationalHealth.state === 'healthy' ? 1 : 0,
      degraded: operationalHealth.state === 'degraded' ? 1 : 0,
      failed: operationalHealth.state === 'failed' ? 1 : 0,
      degradedReasons: operationalHealth.degradedReasons.length,
      circuitOpen: operationalHealth.failureState.circuitOpen ? 1 : 0,
      requiredProbeFailures: operationalHealth.failureState.requiredProbeFailures.length,
      optionalProbeFailures: operationalHealth.failureState.optionalProbeFailures.length,
      retryableErrors: actionableErrors.retryable.length,
      blockingErrors: actionableErrors.blocking.length
    },
    lifecycle: {
      checked: 1,
      commandReady: lifecycleControls.commandStatus === 'ready' ? 1 : 0,
      commandBlocked: lifecycleControls.commandStatus === 'blocked' ? 1 : 0,
      commandDeferred: lifecycleControls.commandStatus === 'deferred' ? 1 : 0,
      scheduleRequested: lifecycleControls.schedule.scheduled ? 1 : 0,
      rollbackAvailable: lifecycleControls.controls.rollbackAvailable ? 1 : 0
    },
    providerContracts: {
      checked: 1,
      provides: providerContracts.provides.length,
      consumes: providerContracts.consumes.length,
      negotiated: providerNegotiation.negotiated.length,
      accepted: providerNegotiation.negotiated.filter(result => result.accepted).length,
      blocked: providerNegotiation.externalHandoff.filter(handoff => handoff.status === 'blocked').length,
      syncCursors: providerNegotiation.syncMetadata.filter(sync => sync.cursor || sync.checkpoint).length,
      resolutionState: providerNegotiation.providerResolutionEnvelope.state,
      resolved: providerNegotiation.providerResolutionEnvelope.resolvedCount,
      advisory: providerNegotiation.providerResolutionEnvelope.advisoryCount,
      blockedResolutions: providerNegotiation.providerResolutionEnvelope.blockedCount
    },
    history: {
      snapshots: historySnapshots.length,
      deniedPermissions: totalHistoricalDenials,
      acceptanceRate: historySnapshots.length === 0 ? null : acceptedHistory / historySnapshots.length
    }
  };
}

function buildTimeline({ now, manifest, ok, contractValidation, tenantBoundary, workspaceBoundary, permissionEvaluations, auditHandoff, boundaryProof, historySnapshots, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const historyEvents = historySnapshots.map(snapshot => ({
    at: snapshot.capturedAt,
    phase: 'history.snapshot',
    decision: snapshot.decision,
    packageId: snapshot.packageId || manifest.id,
    packageVersion: snapshot.packageVersion || manifest.version,
    proofDigest: snapshot.proofDigest,
    metrics: {
      requested: snapshot.requestedCount,
      granted: snapshot.grantedCount,
      denied: snapshot.deniedCount,
      auditRequired: snapshot.auditRequired
    },
    reasons: snapshot.reasons
  }));
  const currentEvents = [
    {
      at: now,
      phase: 'manifest.normalized',
      packageId: manifest.id,
      packageVersion: manifest.version,
      requestedPermissions: manifest.requestedPermissions
    },
    {
      at: now,
      phase: 'manifest.contract.validated',
      ok: contractValidation.ok,
      blockingIssues: contractValidation.blockingIssues.map(issue => issue.code),
      warnings: contractValidation.warnings.map(issue => issue.code)
    },
    {
      at: now,
      phase: 'tenant.boundary.evaluated',
      ok: tenantBoundary.ok,
      denials: tenantBoundary.denials
    },
    {
      at: now,
      phase: 'workspace.boundary.evaluated',
      ok: workspaceBoundary.ok,
      routeWorkspaceId: workspaceBoundary.routeWorkspaceId,
      allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
      denials: workspaceBoundary.denials
    },
    {
      at: now,
      phase: 'permissions.evaluated',
      granted: permissionEvaluations.filter(result => result.granted).map(result => result.permission),
      denied: permissionEvaluations.filter(result => !result.granted).map(({ permission, reason }) => ({ permission, reason }))
    },
    {
      at: now,
      phase: 'audit.handoff.prepared',
      required: auditHandoff.required,
      eventType: auditHandoff.eventType,
      channel: auditHandoff.channel
    },
    {
      at: now,
      phase: 'operational.health.evaluated',
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      retry: operationalHealth.retry,
      blockingErrors: actionableErrors.blocking
    },
    {
      at: now,
      phase: 'lifecycle.controls.evaluated',
      requestedCommand: lifecycleControls.requestedCommand,
      commandStatus: lifecycleControls.commandStatus,
      nextAction: lifecycleControls.nextAction.type,
      schedule: lifecycleControls.schedule,
      blockingIssues: lifecycleControls.validation.blockingIssues.map(issue => issue.code)
    },
    {
      at: now,
      phase: 'provider.contracts.negotiated',
      ok: providerNegotiation.ok,
      accepted: providerNegotiation.negotiated.filter(result => result.accepted).map(result => result.capability),
      handoffs: providerNegotiation.externalHandoff.map(handoff => ({
        service: handoff.service,
        status: handoff.status,
        handoffState: handoff.handoffState
      })),
      resolutionState: providerNegotiation.providerResolutionEnvelope.state,
      resolutionDigest: providerNegotiation.providerResolutionEnvelope.proofSubject.digest,
      blockingIssues: providerNegotiation.blockingIssues.map(issue => issue.code)
    },
    {
      at: now,
      phase: 'proof.issued',
      decision: ok ? 'accepted' : 'rejected',
      proofDigest: boundaryProof.digest
    }
  ];
  return [...historyEvents, ...currentEvents];
}

function buildExportReadySummary({ now, manifest, principal, ok, contractValidation, permissionEvaluations, deniedPermissions, tenantBoundary, workspaceBoundary, auditHandoff, boundaryProof, analyticsCounters, analyticsHistoryReport, operationalHealth, actionableErrors, lifecycleControls, providerContracts, providerNegotiation }) {
  return {
    schema: 'aios.packageManifest.analyticsExport.v1',
    generatedAt: now,
    surfaceId,
    package: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version
    },
    actor: {
      actorId: principal.actorId,
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      strongestRole: strongestRole(principal.roles)
    },
    decision: ok ? (operationalHealth.degraded ? 'degraded' : 'accepted') : 'rejected',
    counters: analyticsCounters,
    contractValidation: {
      ok: contractValidation.ok,
      blockingIssues: contractValidation.blockingIssues,
      warnings: contractValidation.warnings
    },
    permissionRows: permissionEvaluations.map(result => ({
      permission: result.permission,
      granted: result.granted,
      reason: result.reason || null,
      scope: result.scope || null,
      audit: result.audit || null
    })),
    denialSummary: countReasons([
      ...contractValidation.blockingIssues.map(issue => ({ reason: issue.code })),
      ...tenantBoundary.denials.map(reason => ({ reason })),
      ...workspaceBoundary.denials.map(reason => ({ reason })),
      ...deniedPermissions.map(({ reason }) => ({ reason }))
    ]),
    workspaceBoundary: {
      ok: workspaceBoundary.ok,
      scope: workspaceBoundary.scope,
      routeWorkspaceId: workspaceBoundary.routeWorkspaceId,
      activeWorkspaceId: workspaceBoundary.activeWorkspaceId,
      allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
      denials: workspaceBoundary.denials
    },
    audit: {
      eventType: auditHandoff.eventType,
      required: auditHandoff.required,
      channel: auditHandoff.channel,
      correlationId: auditHandoff.correlationId
    },
    operationalHealth: {
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      failureState: operationalHealth.failureState,
      degradedMode: operationalHealth.degradedMode,
      healthProbes: operationalHealth.healthProbes.map(probe => ({
        name: probe.name,
        state: probe.state,
        required: probe.required,
        reason: probe.reason,
        retryable: probe.retryable
      })),
      retry: operationalHealth.retry,
      actionableErrorCodes: actionableErrors.errors.map(error => error.code)
    },
    lifecycle: {
      requestedCommand: lifecycleControls.requestedCommand,
      commandStatus: lifecycleControls.commandStatus,
      controls: lifecycleControls.controls,
      commandPlan: lifecycleControls.commandPlan,
      schedule: lifecycleControls.schedule,
      nextAction: lifecycleControls.nextAction
    },
    providerContracts: {
      provides: providerContracts.provides.map(contract => ({
        service: contract.service,
        capability: contract.capability,
        transport: contract.transport,
        syncMode: contract.sync.mode
      })),
      consumes: providerNegotiation.negotiated,
      externalHandoff: providerNegotiation.externalHandoff,
      syncMetadata: providerNegotiation.syncMetadata,
      providerResolutionEnvelope: providerNegotiation.providerResolutionEnvelope
    },
    proof: {
      type: boundaryProof.type,
      digest: boundaryProof.digest,
      issuedAt: boundaryProof.issuedAt
    },
    historyReport: analyticsHistoryReport
  };
}

function normalizeClientRequest(input, manifest, principal) {
  const request = input.clientRequest || input.request || {};
  const state = input.clientState || request.clientState || {};
  const route = request.route || input.route || {};
  const requestedAction = request.action || input.action || 'install_package';
  return {
    schema: 'aios.packageManifest.clientRequest.v1',
    requestId: request.id || input.requestId || `${manifest.id}:${manifest.version}:${principal.actorId}`,
    action: requestedAction,
    source: request.source || input.source || 'hosted-kernel-client',
    route: {
      tenantId: route.tenantId || request.tenantId || principal.tenantId,
      workspaceId: route.workspaceId || request.workspaceId || principal.workspaceId,
      packageId: route.packageId || request.packageId || manifest.id,
      packageVersion: route.packageVersion || request.packageVersion || manifest.version
    },
    state: {
      selectedPackageId: state.selectedPackageId || manifest.id,
      selectedVersion: state.selectedVersion || manifest.version,
      activeWorkspaceId: state.activeWorkspaceId || principal.workspaceId,
      visibleDecisionPanel: state.visibleDecisionPanel || 'manifest-permissions',
      pendingAction: state.pendingAction || requestedAction
    }
  };
}

function buildClientWorkflowContext({ ok, manifest, principal, clientRequest, workspaceBoundary, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const activePanel = supportedClientWorkflowPanels.includes(clientRequest.state.visibleDecisionPanel)
    ? clientRequest.state.visibleDecisionPanel
    : 'manifest-permissions';
  const selectedPackageMatches = clientRequest.state.selectedPackageId === manifest.id
    && clientRequest.state.selectedVersion === manifest.version;
  const activeWorkspaceMatchesRoute = clientRequest.state.activeWorkspaceId === clientRequest.route.workspaceId;
  const routePackageMatches = clientRequest.route.packageId === manifest.id
    && clientRequest.route.packageVersion === manifest.version;
  const blockedProviderHandoffs = providerNegotiation.externalHandoff.filter(handoff => handoff.status === 'blocked');
  const optionalProviderHandoffs = providerNegotiation.externalHandoff.filter(handoff => handoff.status === 'optional');
  const preferredPanel = blockedProviderHandoffs.length > 0
    ? 'provider-contracts'
    : operationalHealth.failureState.circuitOpen || operationalHealth.degraded
      ? 'manifest-operational-health'
      : lifecycleControls.commandStatus !== 'ready'
        ? 'manifest-lifecycle-controls'
        : ok
          ? 'install-review'
          : selectedPackageMatches && routePackageMatches
            ? activePanel
            : 'manifest-denials';
  const routeIntent = lifecycleControls.nextAction.type;
  const intentPanel = clientPanelByRouteIntent[routeIntent] || preferredPanel;
  const targetPanel = supportedClientWorkflowPanels.includes(intentPanel) ? intentPanel : preferredPanel;
  const handoffQueue = [
    ...blockedProviderHandoffs.map(handoff => ({
      type: handoff.type,
      status: 'blocked',
      panel: 'provider-contracts',
      service: handoff.service,
      capability: handoff.capability,
      required: handoff.required,
      providerState: handoff.providerState,
      target: handoff.target,
      handoffState: handoff.handoffState,
      externalRef: handoff.externalRef,
      retryable: handoff.retryable,
      nextAction: handoff.nextAction
    })),
    ...optionalProviderHandoffs.map(handoff => ({
      type: handoff.type,
      status: 'optional',
      panel: 'provider-contracts',
      service: handoff.service,
      capability: handoff.capability,
      required: handoff.required,
      providerState: handoff.providerState,
      target: handoff.target,
      handoffState: handoff.handoffState,
      externalRef: handoff.externalRef,
      retryable: handoff.retryable,
      nextAction: handoff.nextAction
    }))
  ];
  if (operationalHealth.degraded && operationalHealth.retry.retryAllowed) {
    handoffQueue.push({
      type: 'kernel.package.retry',
      status: operationalHealth.failureState.circuitOpen ? 'blocked' : 'scheduled',
      panel: 'manifest-operational-health',
      retryAfter: operationalHealth.retry.retryAfter,
      retryAfterMs: operationalHealth.retry.nextBackoffMs,
      reasons: actionableErrors.retryable
    });
  }
  if (lifecycleControls.commandStatus !== 'ready') {
    handoffQueue.push({
      type: routeIntent,
      status: lifecycleControls.commandStatus,
      panel: 'manifest-lifecycle-controls',
      issueCodes: lifecycleControls.validation.issues.map(issue => issue.code),
      proofDigest: boundaryProof.digest
    });
  }
  const stateIssues = [];
  if (!selectedPackageMatches) stateIssues.push('selected_package_state_mismatch');
  if (!activeWorkspaceMatchesRoute) stateIssues.push('active_workspace_route_mismatch');
  if (!routePackageMatches) stateIssues.push('route_package_manifest_mismatch');
  if (!supportedClientWorkflowPanels.includes(clientRequest.state.visibleDecisionPanel)) stateIssues.push('unsupported_visible_decision_panel');
  const resumeSubject = {
    requestId: clientRequest.requestId,
    actorId: principal.actorId,
    packageId: manifest.id,
    packageVersion: manifest.version,
    workspaceId: workspaceBoundary.routeWorkspaceId,
    targetPanel,
    proofDigest: boundaryProof.digest
  };
  return {
    schema: 'aios.packageManifest.clientWorkflowContext.v1',
    requestId: clientRequest.requestId,
    actorId: principal.actorId,
    routeKey: `${clientRequest.route.tenantId || 'tenantless'}:${clientRequest.route.workspaceId || 'workspaceless'}:${manifest.id}@${manifest.version}`,
    stateStatus: stateIssues.length === 0 ? 'in-sync' : 'needs-client-reconciliation',
    stateIssues,
    navigation: {
      activePanel,
      targetPanel,
      panelChanged: activePanel !== targetPanel,
      routeIntent,
      pendingAction: clientRequest.state.pendingAction,
      lifecycleCommand: lifecycleControls.requestedCommand,
      userVisibleStatus: lifecycleControls.commandStatus === 'ready' ? 'ready_for_acceptance' : lifecycleControls.commandStatus
    },
    routeParams: {
      tenantId: clientRequest.route.tenantId,
      workspaceId: clientRequest.route.workspaceId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      proofDigest: boundaryProof.digest
    },
    handoffQueue,
    hasBlockingHandoff: handoffQueue.some(handoff => handoff.status === 'blocked'),
    resumeToken: stableHash(resumeSubject),
    clientPatchHints: {
      selectedPackageId: manifest.id,
      selectedVersion: manifest.version,
      activeWorkspaceId: clientRequest.route.workspaceId,
      visibleDecisionPanel: targetPanel,
      pendingAction: routeIntent
    }
  };
}

function buildClientStatePatch({ ok, manifest, clientRequest, contractValidation, tenantBoundary, workspaceBoundary, deniedPermissions, auditHandoff, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation, clientWorkflowContext }) {
  const blockingReasons = uniqueStrings([
    ...contractValidation.blockingIssues.map(issue => issue.code),
    ...tenantBoundary.denials,
    ...workspaceBoundary.denials,
    ...deniedPermissions.map(denial => denial.reason),
    ...providerNegotiation.blockingIssues.map(issue => issue.code),
    ...actionableErrors.blocking
  ]);
  const nextPanel = ok && operationalHealth.state === 'healthy'
    ? 'install-review'
    : operationalHealth.degraded
      ? 'manifest-operational-health'
      : 'manifest-denials';
  return {
    schema: 'aios.packageManifest.clientStatePatch.v1',
    requestId: clientRequest.requestId,
    route: clientRequest.route,
    patch: {
      packageManifest: {
        id: manifest.id,
        version: manifest.version,
        decision: ok ? 'accepted' : 'rejected',
        proofDigest: boundaryProof.digest,
        requestedPermissions: manifest.requestedPermissions,
        allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
        contractWarnings: contractValidation.warnings.map(issue => issue.code)
      },
      workflow: {
        pendingAction: lifecycleControls.nextAction.type,
        nextPanel: clientWorkflowContext?.navigation.targetPanel || (lifecycleControls.commandStatus === 'blocked' ? 'manifest-lifecycle-controls' : nextPanel),
        installEnabled: lifecycleControls.controls.installEnabled,
        enableAvailable: lifecycleControls.controls.enableAvailable,
        disableAvailable: lifecycleControls.controls.disableAvailable,
        rollbackAvailable: lifecycleControls.controls.rollbackAvailable,
        scheduleAvailable: lifecycleControls.controls.scheduleAvailable,
        pauseAvailable: lifecycleControls.controls.pauseAvailable,
        resumeAvailable: lifecycleControls.controls.resumeAvailable,
        auditRequired: auditHandoff.required,
        blockingReasons,
        degradedMode: operationalHealth.degraded,
        retryAllowed: operationalHealth.retry.retryAllowed && actionableErrors.retryable.length > 0,
        nextRetryBackoffMs: operationalHealth.retry.nextBackoffMs
      },
      clientWorkflow: clientWorkflowContext || null,
      audit: {
        correlationId: auditHandoff.correlationId,
        channel: auditHandoff.channel,
        eventType: auditHandoff.eventType
      },
      errors: actionableErrors.errors.map(({ code, field, severity, retryable, action }) => ({
        code,
        field,
        severity,
        retryable,
        action
      })),
      operationalHealth: {
        state: operationalHealth.state,
        degradedReasons: operationalHealth.degradedReasons,
        failureState: operationalHealth.failureState,
        degradedMode: operationalHealth.degradedMode,
        retry: operationalHealth.retry,
        probes: operationalHealth.healthProbes.map(probe => ({
          name: probe.name,
          state: probe.state,
          required: probe.required,
          reason: probe.reason,
          retryable: probe.retryable,
          action: probe.action
        }))
      },
      lifecycle: {
        commandStatus: lifecycleControls.commandStatus,
        requestedCommand: lifecycleControls.requestedCommand,
        controls: lifecycleControls.controls,
      schedule: lifecycleControls.schedule,
      commandPlan: lifecycleControls.commandPlan,
      nextAction: lifecycleControls.nextAction,
      validationIssues: lifecycleControls.validation.issues.map(issue => ({
          code: issue.code,
          field: issue.field,
          severity: issue.severity,
          detail: issue.detail
        }))
      },
      providerContracts: {
        negotiated: providerNegotiation.negotiated,
        externalHandoff: providerNegotiation.externalHandoff,
        blockingIssues: providerNegotiation.blockingIssues.map(issue => ({
          code: issue.code,
          field: issue.field,
          detail: issue.detail
        })),
        syncMetadata: providerNegotiation.syncMetadata,
        providerResolutionEnvelope: providerNegotiation.providerResolutionEnvelope
      }
    }
  };
}

function buildAcceptancePreview({ now, ok, manifest, principal, clientRequest, contractValidation, tenantBoundary, workspaceBoundary, permissionEvaluations, deniedPermissions, auditHandoff, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const permissionRows = permissionEvaluations.map(result => ({
    label: result.permission,
    status: result.granted ? 'accepted' : 'blocked',
    scope: result.scope || hostedKernelPermissionCatalog[result.permission]?.scope || null,
    audit: result.audit || hostedKernelPermissionCatalog[result.permission]?.audit || null,
    reason: result.reason || null
  }));
  const sections = [
    {
      id: 'manifest-contract',
      title: 'Manifest contract',
      status: contractValidation.ok ? 'accepted' : 'blocked',
      summary: contractValidation.ok
        ? `${manifest.name} ${manifest.version} matches hosted-kernel manifest requirements.`
        : `${contractValidation.blockingIssues.length} manifest contract issue(s) must be resolved.`,
      blockers: contractValidation.blockingIssues.map(issue => issue.code),
      warnings: contractValidation.warnings.map(issue => issue.code)
    },
    {
      id: 'workspace-boundary',
      title: 'Workspace boundary',
      status: tenantBoundary.ok && workspaceBoundary.ok ? 'accepted' : 'blocked',
      summary: tenantBoundary.ok && workspaceBoundary.ok
        ? `Route workspace ${workspaceBoundary.routeWorkspaceId || 'unscoped'} is authorized for this package.`
        : 'Tenant or workspace routing does not match the package boundary.',
      blockers: [...tenantBoundary.denials, ...workspaceBoundary.denials],
      warnings: []
    },
    {
      id: 'permissions',
      title: 'Permission grants',
      status: deniedPermissions.length === 0 ? 'accepted' : 'blocked',
      summary: `${permissionEvaluations.length - deniedPermissions.length}/${permissionEvaluations.length} requested permission(s) can be granted.`,
      blockers: deniedPermissions.map(({ permission, reason }) => `${permission}:${reason}`),
      warnings: permissionRows.filter(row => row.audit === 'required').map(row => `${row.label}:audit_required`)
    },
    {
      id: 'providers',
      title: 'Provider contracts',
      status: providerNegotiation.ok ? 'accepted' : 'blocked',
      summary: providerNegotiation.ok
        ? `${providerNegotiation.negotiated.filter(result => result.accepted).length}/${providerNegotiation.negotiated.length} provider capability handoff(s) accepted.`
        : `${providerNegotiation.externalHandoff.filter(handoff => handoff.status === 'blocked').length} required provider handoff(s) blocked.`,
      blockers: providerNegotiation.blockingIssues.map(issue => issue.code),
      warnings: providerNegotiation.warnings.map(issue => issue.code)
    },
    {
      id: 'runtime-readiness',
      title: 'Runtime readiness',
      status: operationalHealth.state === 'healthy' ? 'accepted' : operationalHealth.state === 'degraded' ? 'warning' : 'blocked',
      summary: operationalHealth.state === 'healthy'
        ? 'Hosted-kernel runtime is healthy.'
        : `Runtime is ${operationalHealth.state}; package action may be deferred.`,
      blockers: operationalHealth.state === 'failed' ? operationalHealth.degradedReasons : [],
      warnings: operationalHealth.state === 'degraded' ? operationalHealth.degradedReasons : []
    },
    {
      id: 'lifecycle-command',
      title: 'Lifecycle command',
      status: lifecycleControls.commandStatus === 'ready' ? 'accepted' : lifecycleControls.commandStatus === 'deferred' ? 'warning' : 'blocked',
      summary: `Command ${lifecycleControls.requestedCommand} is ${lifecycleControls.commandStatus}.`,
      blockers: lifecycleControls.validation.blockingIssues.map(issue => issue.code),
      warnings: lifecycleControls.validation.warnings.map(issue => issue.code)
    }
  ];
  const blockingSectionIds = sections.filter(section => section.status === 'blocked').map(section => section.id);
  const warningSectionIds = sections.filter(section => section.status === 'warning' || section.warnings.length > 0).map(section => section.id);
  const readinessScore = Math.round((sections.filter(section => section.status === 'accepted').length / sections.length) * 100);
  const validationSummary = {
    schema: 'aios.packageManifest.validationSummary.v1',
    ok,
    readinessScore,
    blockingSectionIds,
    warningSectionIds,
    blockingCount: blockingSectionIds.length,
    warningCount: warningSectionIds.length,
    actionableErrorCount: actionableErrors.errors.length,
    retryableErrorCount: actionableErrors.retryable.length,
    proofDigest: boundaryProof.digest
  };
  const nextSteps = [];
  if (!contractValidation.ok) {
    nextSteps.push({
      id: 'fix-manifest-contract',
      label: 'Fix manifest contract',
      status: 'required',
      routeIntent: 'manifest.validation.edit',
      panel: 'manifest-denials',
      issueCodes: contractValidation.blockingIssues.map(issue => issue.code)
    });
  }
  if (!tenantBoundary.ok || !workspaceBoundary.ok) {
    nextSteps.push({
      id: 'select-authorized-workspace',
      label: 'Select authorized workspace',
      status: 'required',
      routeIntent: 'workspace.boundary.select',
      panel: 'manifest-denials',
      workspaceIds: workspaceBoundary.allowedWorkspaceIds,
      issueCodes: [...tenantBoundary.denials, ...workspaceBoundary.denials]
    });
  }
  if (deniedPermissions.length > 0) {
    nextSteps.push({
      id: 'request-permission-review',
      label: 'Review permission grants',
      status: 'required',
      routeIntent: 'permissions.review',
      panel: 'manifest-permissions',
      permissions: deniedPermissions.map(({ permission, reason }) => ({ permission, reason }))
    });
  }
  if (providerNegotiation.externalHandoff.length > 0) {
    nextSteps.push({
      id: 'resolve-provider-handoff',
      label: 'Resolve provider handoff',
      status: providerNegotiation.externalHandoff.some(handoff => handoff.status === 'blocked') ? 'required' : 'optional',
      routeIntent: 'providers.resolve',
      panel: 'provider-contracts',
      handoffs: providerNegotiation.externalHandoff
    });
  }
  if (operationalHealth.degraded && operationalHealth.retry.retryAllowed) {
    nextSteps.push({
      id: 'retry-runtime-readiness',
      label: 'Retry runtime readiness',
      status: operationalHealth.state === 'failed' ? 'required' : 'optional',
      routeIntent: 'runtime.retry',
      panel: 'manifest-operational-health',
      retryAfterMs: operationalHealth.retry.nextBackoffMs,
      reasons: operationalHealth.degradedReasons
    });
  }
  if (lifecycleControls.commandStatus !== 'ready') {
    nextSteps.push({
      id: 'resolve-lifecycle-command',
      label: 'Resolve lifecycle command',
      status: lifecycleControls.commandStatus === 'blocked' ? 'required' : 'optional',
      routeIntent: lifecycleControls.nextAction.type,
      panel: 'manifest-lifecycle-controls',
      issueCodes: lifecycleControls.validation.issues.map(issue => issue.code)
    });
  }
  if (nextSteps.length === 0) {
    nextSteps.push({
      id: 'accept-install',
      label: 'Accept and install',
      status: 'ready',
      routeIntent: 'kernel.package.install',
      panel: 'install-review',
      proofDigest: boundaryProof.digest,
      auditCorrelationId: auditHandoff.correlationId
    });
  }
  return {
    schema: 'aios.packageManifest.acceptancePreview.v1',
    generatedAt: now,
    requestId: clientRequest.requestId,
    package: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version
    },
    actor: {
      actorId: principal.actorId,
      strongestRole: strongestRole(principal.roles)
    },
    decision: ok ? 'accepted' : 'rejected',
    userVisibleStatus: lifecycleControls.commandStatus === 'ready' ? 'ready_for_acceptance' : lifecycleControls.commandStatus,
    validationSummary,
    sections,
    permissionRows,
    nextSteps,
    primaryNextStep: nextSteps[0],
    acceptanceReceipt: {
      required: auditHandoff.required,
      eventType: auditHandoff.eventType,
      channel: auditHandoff.channel,
      correlationId: auditHandoff.correlationId,
      proofDigest: boundaryProof.digest
    }
  };
}

function buildRouteAcceptanceContract({ now, ok, manifest, principal, clientRequest, acceptancePreview, auditHandoff, boundaryProof, workspaceBoundary, operationalHealth, lifecycleControls, providerNegotiation, actionableErrors }) {
  const runtimeGatePassed = !lifecycleControls.requestedCommandPolicy.requireHealthyRuntime || operationalHealth.state === 'healthy';
  const requiredGates = [
    {
      id: 'manifest-decision',
      label: 'Manifest accepted',
      passed: ok,
      reason: ok ? null : 'manifest_or_boundary_denied'
    },
    {
      id: 'runtime-health',
      label: lifecycleControls.requestedCommandPolicy.requireHealthyRuntime ? 'Runtime healthy' : 'Runtime health advisory',
      passed: runtimeGatePassed,
      reason: runtimeGatePassed ? null : `runtime_${operationalHealth.state}`
    },
    {
      id: 'lifecycle-ready',
      label: 'Lifecycle command ready',
      passed: lifecycleControls.commandStatus === 'ready',
      reason: lifecycleControls.commandStatus === 'ready' ? null : lifecycleControls.nextAction.type
    },
    {
      id: 'provider-handoffs',
      label: 'Provider handoffs accepted',
      passed: providerNegotiation.externalHandoff.every(handoff => handoff.status !== 'blocked'),
      reason: providerNegotiation.externalHandoff.some(handoff => handoff.status === 'blocked') ? 'provider_handoff_blocked' : null
    },
    {
      id: 'audit-receipt',
      label: 'Audit receipt prepared',
      passed: !auditHandoff.required || Boolean(auditHandoff.proofDigest),
      reason: auditHandoff.required && !auditHandoff.proofDigest ? 'audit_receipt_missing' : null
    }
  ];
  const blockedGates = requiredGates.filter(gate => !gate.passed);
  const routeAction = blockedGates.length === 0
    ? lifecycleControls.nextAction.type
    : acceptancePreview.primaryNextStep.routeIntent;
  const previewFields = [
    { key: 'package', value: `${manifest.name}@${manifest.version}` },
    { key: 'workspace', value: workspaceBoundary.routeWorkspaceId || 'unscoped' },
    { key: 'decision', value: acceptancePreview.decision },
    { key: 'readinessScore', value: acceptancePreview.validationSummary.readinessScore },
    { key: 'proofDigest', value: boundaryProof.digest }
  ];
  return {
    schema: 'aios.packageManifest.routeAcceptanceContract.v1',
    generatedAt: now,
    requestId: clientRequest.requestId,
    route: {
      tenantId: clientRequest.route.tenantId,
      workspaceId: clientRequest.route.workspaceId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      action: routeAction,
      panel: acceptancePreview.primaryNextStep.panel
    },
    preview: {
      title: `${manifest.name} ${manifest.version}`,
      status: acceptancePreview.userVisibleStatus,
      decision: acceptancePreview.decision,
      readinessScore: acceptancePreview.validationSummary.readinessScore,
      fields: previewFields,
      sections: acceptancePreview.sections.map(section => ({
        id: section.id,
        title: section.title,
        status: section.status,
        summary: section.summary,
        issueCount: section.blockers.length + section.warnings.length
      }))
    },
    acceptance: {
      canAccept: blockedGates.length === 0,
      disabledReason: blockedGates.length === 0 ? null : blockedGates.map(gate => gate.reason).join(','),
      primaryLabel: blockedGates.length === 0 ? 'Accept package' : acceptancePreview.primaryNextStep.label,
      requiredGates,
      acceptPayload: {
        type: lifecycleControls.nextAction.type,
        requestId: clientRequest.requestId,
        packageId: manifest.id,
        packageVersion: manifest.version,
        workspaceId: workspaceBoundary.routeWorkspaceId,
        actorId: principal.actorId,
        proofDigest: boundaryProof.digest,
        auditCorrelationId: auditHandoff.correlationId,
        schedule: lifecycleControls.schedule
      },
      declinePayload: {
        type: 'kernel.package.acceptance.decline',
        requestId: clientRequest.requestId,
        packageId: manifest.id,
        packageVersion: manifest.version,
        proofDigest: boundaryProof.digest,
        retainedPanel: acceptancePreview.primaryNextStep.panel
      }
    },
    validationSummary: acceptancePreview.validationSummary,
    explainableNextSteps: acceptancePreview.nextSteps,
    retry: {
      allowed: operationalHealth.retry.retryAllowed && actionableErrors.retryable.length > 0,
      retryAfterMs: operationalHealth.retry.nextBackoffMs,
      retryAfter: operationalHealth.retry.retryAfter,
      reasons: actionableErrors.retryable,
      circuitOpen: operationalHealth.failureState.circuitOpen
    },
    auditReceipt: acceptancePreview.acceptanceReceipt
  };
}

function buildPreviewReadinessDeck({ now, manifest, clientRequest, acceptancePreview, routeAcceptanceContract, clientWorkflowContext, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const blockedGates = routeAcceptanceContract.acceptance.requiredGates.filter(gate => !gate.passed);
  const sectionStepByPanel = new Map(acceptancePreview.nextSteps.map(step => [step.panel, step]));
  const readinessState = routeAcceptanceContract.acceptance.canAccept
    ? 'ready'
    : operationalHealth.failureState.circuitOpen
      ? 'blocked_by_runtime'
      : providerNegotiation.externalHandoff.some(handoff => handoff.status === 'blocked')
        ? 'blocked_by_provider'
        : acceptancePreview.validationSummary.blockingCount > 0
          ? 'blocked_by_validation'
          : 'needs_review';
  const validationCards = acceptancePreview.sections.map(section => {
    const step = sectionStepByPanel.get(section.id === 'runtime-readiness' ? 'manifest-operational-health' : section.id === 'providers' ? 'provider-contracts' : section.id === 'lifecycle-command' ? 'manifest-lifecycle-controls' : 'manifest-denials') || null;
    return {
      id: section.id,
      title: section.title,
      status: section.status,
      summary: section.summary,
      issueCount: section.blockers.length + section.warnings.length,
      blockers: section.blockers,
      warnings: section.warnings,
      routeIntent: step?.routeIntent || routeAcceptanceContract.route.action,
      panel: step?.panel || routeAcceptanceContract.route.panel,
      ctaLabel: step?.label || routeAcceptanceContract.acceptance.primaryLabel
    };
  });
  const nextStepIndex = acceptancePreview.nextSteps.map((step, index) => ({
    rank: index + 1,
    id: step.id,
    label: step.label,
    status: step.status,
    routeIntent: step.routeIntent,
    panel: step.panel,
    blocking: step.status === 'required',
    retryAfterMs: step.retryAfterMs || null,
    issueCodes: step.issueCodes || [],
    permissionCount: Array.isArray(step.permissions) ? step.permissions.length : 0,
    handoffCount: Array.isArray(step.handoffs) ? step.handoffs.length : 0
  }));
  const routeActionPayload = routeAcceptanceContract.acceptance.canAccept
    ? routeAcceptanceContract.acceptance.acceptPayload
    : {
      type: routeAcceptanceContract.route.action,
      requestId: clientRequest.requestId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      proofDigest: boundaryProof.digest,
      panel: routeAcceptanceContract.route.panel,
      nextStepId: acceptancePreview.primaryNextStep.id
    };
  const proofSubject = {
    requestId: clientRequest.requestId,
    packageId: manifest.id,
    packageVersion: manifest.version,
    readinessState,
    readinessScore: acceptancePreview.validationSummary.readinessScore,
    routeAction: routeAcceptanceContract.route.action,
    canAccept: routeAcceptanceContract.acceptance.canAccept,
    blockedGateIds: blockedGates.map(gate => gate.id),
    nextStepIds: nextStepIndex.map(step => step.id),
    proofDigest: boundaryProof.digest
  };
  return {
    schema: 'aios.packageManifest.previewReadinessDeck.v1',
    generatedAt: now,
    requestId: clientRequest.requestId,
    packageKey: `${manifest.id}@${manifest.version}`,
    readiness: {
      state: readinessState,
      score: acceptancePreview.validationSummary.readinessScore,
      canAccept: routeAcceptanceContract.acceptance.canAccept,
      installEnabled: lifecycleControls.controls.installEnabled,
      userVisibleStatus: acceptancePreview.userVisibleStatus,
      disabledReason: routeAcceptanceContract.acceptance.disabledReason,
      retryAllowed: routeAcceptanceContract.retry.allowed,
      retryAfterMs: routeAcceptanceContract.retry.retryAfterMs
    },
    routeBinding: {
      tenantId: routeAcceptanceContract.route.tenantId,
      workspaceId: routeAcceptanceContract.route.workspaceId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      action: routeAcceptanceContract.route.action,
      panel: routeAcceptanceContract.route.panel,
      resumeToken: clientWorkflowContext.resumeToken,
      clientStateStatus: clientWorkflowContext.stateStatus,
      routeActionPayload
    },
    validationSummary: {
      ...acceptancePreview.validationSummary,
      blockedGates: blockedGates.map(gate => ({ id: gate.id, label: gate.label, reason: gate.reason })),
      providerResolutionState: providerNegotiation.providerResolutionEnvelope.state,
      runtimeFailurePhase: operationalHealth.failureState.phase,
      lifecycleCommandStatus: lifecycleControls.commandStatus
    },
    validationCards,
    nextStepIndex,
    clientPatch: {
      schema: 'aios.packageManifest.previewReadinessClientPatch.v1',
      applyTo: clientRequest.requestId,
      visibleDecisionPanel: routeAcceptanceContract.route.panel,
      pendingAction: routeAcceptanceContract.route.action,
      readinessState,
      readinessScore: acceptancePreview.validationSummary.readinessScore,
      primaryNextStepId: acceptancePreview.primaryNextStep.id,
      blockingErrorCodes: actionableErrors.blocking,
      retryableErrorCodes: actionableErrors.retryable
    },
    auditProof: {
      proofDigest: boundaryProof.digest,
      previewDigest: stableHash(proofSubject),
      acceptanceReceipt: acceptancePreview.acceptanceReceipt,
      requiredGateCount: routeAcceptanceContract.acceptance.requiredGates.length,
      blockedGateCount: blockedGates.length
    }
  };
}

function buildClientRuntimeHandoffContract({ now, manifest, principal, clientRequest, clientWorkflowContext, routeAcceptanceContract, previewReadinessDeck, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const routeBinding = previewReadinessDeck.routeBinding;
  const targetPanel = clientWorkflowContext.navigation.targetPanel;
  const routeAction = routeAcceptanceContract.route.action;
  const stateOperations = [
    {
      op: 'replace',
      path: '/selectedPackageId',
      value: manifest.id,
      currentValue: clientRequest.state.selectedPackageId,
      reason: clientRequest.state.selectedPackageId === manifest.id ? 'already_selected' : 'selected_package_state_mismatch'
    },
    {
      op: 'replace',
      path: '/selectedVersion',
      value: manifest.version,
      currentValue: clientRequest.state.selectedVersion,
      reason: clientRequest.state.selectedVersion === manifest.version ? 'already_selected' : 'selected_version_state_mismatch'
    },
    {
      op: 'replace',
      path: '/activeWorkspaceId',
      value: clientRequest.route.workspaceId,
      currentValue: clientRequest.state.activeWorkspaceId,
      reason: clientWorkflowContext.stateIssues.includes('active_workspace_route_mismatch') ? 'active_workspace_route_mismatch' : 'route_workspace_authoritative'
    },
    {
      op: 'replace',
      path: '/visibleDecisionPanel',
      value: targetPanel,
      currentValue: clientRequest.state.visibleDecisionPanel,
      reason: clientWorkflowContext.navigation.panelChanged ? 'workflow_target_panel_changed' : 'panel_already_active'
    },
    {
      op: 'replace',
      path: '/pendingAction',
      value: routeAction,
      currentValue: clientRequest.state.pendingAction,
      reason: clientRequest.state.pendingAction === routeAction ? 'pending_action_current' : 'route_intent_changed'
    }
  ];
  const requiredOperations = stateOperations.filter(operation => operation.currentValue !== operation.value);
  const queuedActions = [
    {
      type: routeAction,
      status: routeAcceptanceContract.acceptance.canAccept ? 'ready' : lifecycleControls.commandStatus,
      panel: routeAcceptanceContract.route.panel,
      payload: routeAcceptanceContract.acceptance.canAccept
        ? routeAcceptanceContract.acceptance.acceptPayload
        : previewReadinessDeck.routeBinding.routeActionPayload,
      proofDigest: boundaryProof.digest
    },
    ...clientWorkflowContext.handoffQueue.map((handoff, index) => ({
      type: handoff.type,
      status: handoff.status,
      panel: handoff.panel,
      rank: index + 2,
      retryable: handoff.retryable === true,
      nextAction: handoff.nextAction || handoff.type,
      proofDigest: boundaryProof.digest
    }))
  ];
  const proofSubject = {
    requestId: clientRequest.requestId,
    actorId: principal.actorId,
    packageId: manifest.id,
    packageVersion: manifest.version,
    routeKey: clientWorkflowContext.routeKey,
    stateStatus: clientWorkflowContext.stateStatus,
    targetPanel,
    routeAction,
    resumeToken: clientWorkflowContext.resumeToken,
    operationCount: requiredOperations.length,
    queuedActionTypes: queuedActions.map(action => action.type),
    readinessState: previewReadinessDeck.readiness.state,
    providerResolutionState: providerNegotiation.providerResolutionEnvelope.state,
    runtimeFailurePhase: operationalHealth.failureState.phase,
    proofDigest: boundaryProof.digest
  };
  return {
    schema: 'aios.packageManifest.clientRuntimeHandoffContract.v1',
    generatedAt: now,
    requestId: clientRequest.requestId,
    packageKey: `${manifest.id}@${manifest.version}`,
    routeMutation: {
      tenantId: clientRequest.route.tenantId,
      workspaceId: clientRequest.route.workspaceId,
      packageId: manifest.id,
      packageVersion: manifest.version,
      action: routeAction,
      panel: targetPanel,
      resumeToken: clientWorkflowContext.resumeToken,
      routeBinding
    },
    stateContract: {
      status: requiredOperations.length === 0 ? 'current' : 'patch-required',
      sourceSchema: clientRequest.schema,
      targetSchema: 'aios.packageManifest.clientStatePatch.v1',
      operations: stateOperations,
      requiredOperations,
      stateIssues: clientWorkflowContext.stateIssues,
      patchHints: clientWorkflowContext.clientPatchHints
    },
    workflowQueue: {
      status: clientWorkflowContext.hasBlockingHandoff ? 'blocked' : routeAcceptanceContract.acceptance.canAccept ? 'ready' : 'requires-user-action',
      activePanel: clientWorkflowContext.navigation.activePanel,
      targetPanel,
      userVisibleStatus: previewReadinessDeck.readiness.userVisibleStatus,
      hasBlockingHandoff: clientWorkflowContext.hasBlockingHandoff,
      queuedActions,
      primaryAction: queuedActions[0],
      retry: {
        allowed: operationalHealth.retry.retryAllowed && actionableErrors.retryable.length > 0,
        retryAfter: operationalHealth.retry.retryAfter,
        retryAfterMs: operationalHealth.retry.nextBackoffMs,
        reasons: actionableErrors.retryable
      }
    },
    auditProof: {
      proofDigest: boundaryProof.digest,
      resumeToken: clientWorkflowContext.resumeToken,
      handoffDigest: stableHash(proofSubject),
      proofSubject
    }
  };
}

function buildWorkflowHandoff({ ok, manifest, principal, clientRequest, contractValidation, tenantBoundary, workspaceBoundary, permissionEvaluations, deniedPermissions, auditHandoff, boundaryProof, operationalHealth, actionableErrors, lifecycleControls, providerNegotiation }) {
  const clientWorkflowContext = buildClientWorkflowContext({
    ok,
    manifest,
    principal,
    clientRequest,
    workspaceBoundary,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const clientStatePatch = buildClientStatePatch({
    ok,
    manifest,
    clientRequest,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    deniedPermissions,
    auditHandoff,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation,
    clientWorkflowContext
  });
  const acceptancePreview = buildAcceptancePreview({
    now: boundaryProof.issuedAt,
    ok,
    manifest,
    principal,
    clientRequest,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    permissionEvaluations,
    deniedPermissions,
    auditHandoff,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const deniedPermissionRows = deniedPermissions.map(({ permission, reason }) => ({ permission, reason }));
  const grantedPermissionRows = permissionEvaluations
    .filter(result => result.granted)
    .map(({ permission, scope, audit }) => ({ permission, scope, audit }));
  const routeAcceptanceContract = buildRouteAcceptanceContract({
    now: boundaryProof.issuedAt,
    ok,
    manifest,
    principal,
    clientRequest,
    acceptancePreview,
    auditHandoff,
    boundaryProof,
    workspaceBoundary,
    operationalHealth,
    lifecycleControls,
    providerNegotiation,
    actionableErrors
  });
  const previewReadinessDeck = buildPreviewReadinessDeck({
    now: boundaryProof.issuedAt,
    manifest,
    clientRequest,
    acceptancePreview,
    routeAcceptanceContract,
    clientWorkflowContext,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const clientRuntimeHandoffContract = buildClientRuntimeHandoffContract({
    now: boundaryProof.issuedAt,
    manifest,
    principal,
    clientRequest,
    clientWorkflowContext,
    routeAcceptanceContract,
    previewReadinessDeck,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const commands = [
    {
      type: 'client.state.patch',
      status: 'ready',
      requestId: clientRequest.requestId,
      payload: clientStatePatch
    }
  ];
  if (auditHandoff.required) {
    commands.push({
      type: 'audit.append',
      status: 'ready',
      channel: auditHandoff.channel,
      correlationId: auditHandoff.correlationId,
      eventType: auditHandoff.eventType,
      proofDigest: boundaryProof.digest
    });
  }
  commands.push({
    type: 'kernel.package.install',
    status: lifecycleControls.controls.installEnabled ? 'ready' : 'blocked',
    packageId: manifest.id,
    packageVersion: manifest.version,
    reason: lifecycleControls.controls.installEnabled ? null : lifecycleControls.nextAction.type,
    proofDigest: boundaryProof.digest,
    schedule: lifecycleControls.schedule,
    controls: lifecycleControls.controls
  });
  commands.push({
    type: 'kernel.package.lifecycle.state.set',
    status: lifecycleControls.commandPlan.commandStatus,
    packageId: manifest.id,
    packageVersion: manifest.version,
    proofDigest: boundaryProof.digest,
    stateMutation: lifecycleControls.commandPlan.stateMutation,
    enablement: lifecycleControls.commandPlan.enablement,
    applyPayload: lifecycleControls.commandPlan.applyPayload
  });
  if (lifecycleControls.commandPlan.schedulerIntent) {
    commands.push({
      type: lifecycleControls.commandPlan.schedulerIntent.type,
      status: lifecycleControls.commandPlan.schedulerIntent.status,
      packageId: manifest.id,
      packageVersion: manifest.version,
      proofDigest: boundaryProof.digest,
      schedulerIntent: lifecycleControls.commandPlan.schedulerIntent,
      applyPayload: lifecycleControls.commandPlan.applyPayload
    });
  }
  if (lifecycleControls.nextAction.type !== 'kernel.package.install') {
    commands.push({
      type: lifecycleControls.nextAction.type,
      status: lifecycleControls.commandStatus,
      packageId: manifest.id,
      packageVersion: manifest.version,
      proofDigest: boundaryProof.digest,
      schedule: lifecycleControls.schedule,
      controls: lifecycleControls.controls
    });
  }
  commands.push({
    type: 'client.route.acceptance.preview',
    status: routeAcceptanceContract.acceptance.canAccept ? 'ready' : 'blocked',
    requestId: clientRequest.requestId,
    route: routeAcceptanceContract.route,
    proofDigest: boundaryProof.digest,
    payload: routeAcceptanceContract
  });
  commands.push({
    type: 'client.package.preview.readiness',
    status: previewReadinessDeck.readiness.canAccept ? 'ready' : previewReadinessDeck.readiness.state.startsWith('blocked') ? 'blocked' : 'deferred',
    requestId: clientRequest.requestId,
    route: previewReadinessDeck.routeBinding,
    proofDigest: boundaryProof.digest,
    payload: previewReadinessDeck
  });
  commands.push({
    type: 'client.runtime.handoff',
    status: clientRuntimeHandoffContract.workflowQueue.status === 'blocked' ? 'blocked' : 'ready',
    requestId: clientRequest.requestId,
    route: clientRuntimeHandoffContract.routeMutation,
    resumeToken: clientRuntimeHandoffContract.routeMutation.resumeToken,
    proofDigest: boundaryProof.digest,
    handoffDigest: clientRuntimeHandoffContract.auditProof.handoffDigest,
    payload: clientRuntimeHandoffContract
  });
  commands.push({
    type: 'client.workflow.handoff',
    status: clientWorkflowContext.hasBlockingHandoff ? 'blocked' : 'ready',
    requestId: clientRequest.requestId,
    route: clientWorkflowContext.routeParams,
    targetPanel: clientWorkflowContext.navigation.targetPanel,
    resumeToken: clientWorkflowContext.resumeToken,
    stateStatus: clientWorkflowContext.stateStatus,
    proofDigest: boundaryProof.digest,
    payload: clientWorkflowContext
  });
  if (operationalHealth.retry.retryAllowed && actionableErrors.retryable.length > 0) {
    commands.push({
      type: 'kernel.package.retry',
      status: 'scheduled',
      packageId: manifest.id,
      packageVersion: manifest.version,
      backoffMs: operationalHealth.retry.nextBackoffMs,
      retryAfter: operationalHealth.retry.retryAfter,
      failureState: operationalHealth.failureState.phase,
      retryableReasons: actionableErrors.retryable,
      proofDigest: boundaryProof.digest
    });
  }
  if (operationalHealth.failureState.circuitOpen) {
    commands.push({
      type: 'kernel.package.health.incident',
      status: operationalHealth.retry.retryAllowed ? 'scheduled' : 'blocked',
      packageId: manifest.id,
      packageVersion: manifest.version,
      phase: operationalHealth.failureState.phase,
      requiredProbeFailures: operationalHealth.failureState.requiredProbeFailures,
      retryAfter: operationalHealth.retry.retryAfter,
      manualReviewRequired: operationalHealth.degradedMode.requiredManualReview,
      proofDigest: boundaryProof.digest
    });
  }
  for (const handoff of providerNegotiation.externalHandoff) {
    commands.push({
      type: handoff.type,
      status: handoff.status,
      packageId: manifest.id,
      packageVersion: manifest.version,
      service: handoff.service,
      capability: handoff.capability,
      required: handoff.required,
      providerState: handoff.providerState,
      target: handoff.target,
      handoffState: handoff.handoffState,
      externalRef: handoff.externalRef,
      retryable: handoff.retryable,
      nextAction: handoff.nextAction,
      proofDigest: boundaryProof.digest
    });
  }
  return {
    schema: 'aios.packageManifest.workflowHandoff.v1',
    requestId: clientRequest.requestId,
    action: clientRequest.action,
    decision: ok ? 'accepted' : 'rejected',
    userVisibleStatus: ok && operationalHealth.state === 'healthy' ? 'ready_for_install' : operationalHealth.degraded ? 'degraded_retry_available' : 'needs_manifest_resolution',
    route: clientRequest.route,
    nextStep: ok && operationalHealth.state === 'healthy' ? 'review_install_with_audit_receipt' : operationalHealth.degraded ? 'show_operational_health_and_retry_backoff' : 'show_denied_permissions_and_boundary_reasons',
    acceptancePreview,
    validationSummary: acceptancePreview.validationSummary,
    explainableNextSteps: acceptancePreview.nextSteps,
    routeAcceptanceContract,
    previewReadinessDeck,
    clientRuntimeHandoffContract,
    clientWorkflowContext,
    clientStatePatch,
    permissionSummary: {
      granted: grantedPermissionRows,
      denied: deniedPermissionRows,
      contractIssues: contractValidation.issues,
      boundaryDenials: [...tenantBoundary.denials, ...workspaceBoundary.denials],
      workspace: {
        routeWorkspaceId: workspaceBoundary.routeWorkspaceId,
        allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds
      }
    },
    operationalHealth,
    lifecycleControls,
    providerContracts: {
      negotiated: providerNegotiation.negotiated,
      syncMetadata: providerNegotiation.syncMetadata,
      externalHandoff: providerNegotiation.externalHandoff,
      providerResolutionEnvelope: providerNegotiation.providerResolutionEnvelope
    },
    actionableErrors,
    commands
  };
}

function normalizePersistedCommandState(state) {
  return supportedPersistedCommandStates.includes(state) ? state : 'ready';
}

function commandIdempotencySubject(command, manifest, clientRequest) {
  return {
    surfaceId,
    type: command.type,
    requestId: command.requestId || clientRequest.requestId,
    packageId: command.packageId || manifest.id,
    packageVersion: command.packageVersion || manifest.version,
    workspaceId: command.workspaceId || command.route?.workspaceId || clientRequest.route.workspaceId || null,
    service: command.service || null,
    capability: command.capability || null,
    lifecycleCommand: command.applyPayload?.type || null,
    targetState: command.applyPayload?.targetState || command.stateMutation?.to || null,
    schedulePolicy: command.schedule?.policy || null,
    scheduleNotBefore: command.schedule?.notBefore || command.schedulerIntent?.notBefore || null
  };
}

function normalizePersistedCommandRecord(record, index, manifest, clientRequest, now) {
  const command = record || {};
  const idempotencyKey = command.idempotencyKey || stableHash(commandIdempotencySubject(command, manifest, clientRequest));
  const leaseExpiresAt = command.leaseExpiresAt || command.lockExpiresAt || null;
  const leaseTimestamp = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null;
  const nowTimestamp = Date.parse(now);
  const leaseExpired = Number.isFinite(leaseTimestamp) && Number.isFinite(nowTimestamp) && leaseTimestamp <= nowTimestamp;
  return {
    sequence: Number.isInteger(command.sequence) ? command.sequence : index + 1,
    idempotencyKey,
    type: command.type || 'unknown.command',
    status: normalizePersistedCommandState(command.status),
    requestId: command.requestId || clientRequest.requestId,
    packageId: command.packageId || manifest.id,
    packageVersion: command.packageVersion || manifest.version,
    workspaceId: command.workspaceId || command.route?.workspaceId || clientRequest.route.workspaceId || null,
    proofDigest: command.proofDigest || null,
    auditCorrelationId: command.auditCorrelationId || command.correlationId || null,
    appliedAt: command.appliedAt || command.completedAt || null,
    failedAt: command.failedAt || null,
    failureReason: command.failureReason || command.reason || null,
    retryableFailure: command.retryable === true || retryableFailureReasons.includes(command.failureReason || command.reason),
    replayCount: Number.isInteger(command.replayCount) && command.replayCount >= 0 ? command.replayCount : 0,
    leaseOwner: command.leaseOwner || command.bootId || null,
    leaseExpiresAt,
    leaseExpired,
    commandDigest: command.commandDigest || null,
    lastSeenAt: command.lastSeenAt || command.updatedAt || command.createdAt || now
  };
}

function normalizePersistedKernelState(input, manifest, clientRequest, now) {
  const source = input.persistedState || input.packageKernelState || input.recoveredState || {};
  const journal = source.commandJournal || source.commands || input.commandJournal || [];
  const records = (Array.isArray(journal) ? journal : [journal])
    .filter(Boolean)
    .map((record, index) => normalizePersistedCommandRecord(record, index, manifest, clientRequest, now));
  const latestByKey = new Map();
  for (const record of records) {
    const previous = latestByKey.get(record.idempotencyKey);
    if (!previous || record.sequence >= previous.sequence) {
      latestByKey.set(record.idempotencyKey, record);
    }
  }
  return {
    schema: 'aios.packageManifest.persistedKernelState.v1',
    recoveredAt: source.recoveredAt || input.recoveredAt || now,
    bootId: source.bootId || input.bootId || 'ephemeral-boot',
    packageKey: `${manifest.id}@${manifest.version}`,
    routeKey: `${clientRequest.route.tenantId || 'tenantless'}:${clientRequest.route.workspaceId || 'workspaceless'}`,
    lastProofDigest: source.lastProofDigest || source.proofDigest || null,
    lastDecision: source.lastDecision || source.decision || null,
    commandJournal: records.slice(-20),
    latestCommandByKey: Object.fromEntries([...latestByKey.entries()].map(([key, record]) => [key, {
      type: record.type,
      status: record.status,
      proofDigest: record.proofDigest,
      replayCount: record.replayCount,
      leaseOwner: record.leaseOwner,
      leaseExpiresAt: record.leaseExpiresAt,
      leaseExpired: record.leaseExpired,
      lastSeenAt: record.lastSeenAt,
      failureReason: record.failureReason
    }]))
  };
}

function buildCommandPersistenceEnvelope(command, index, manifest, clientRequest, boundaryProof, now, bootId) {
  const idempotencyKey = stableHash(commandIdempotencySubject(command, manifest, clientRequest));
  const commandStatus = normalizePersistedCommandState(command.status);
  const leaseRequired = ['ready', 'scheduled'].includes(commandStatus);
  const nowTimestamp = Date.parse(now);
  const leaseExpiresAt = leaseRequired && Number.isFinite(nowTimestamp)
    ? new Date(nowTimestamp + persistedCommandLeaseMs).toISOString()
    : null;
  const commandDigest = stableHash({
    idempotencyKey,
    type: command.type,
    status: commandStatus,
    proofDigest: command.proofDigest || boundaryProof.digest,
    payloadDigest: stableHash(command.payload || command.applyPayload || command.stateMutation || command.route || {}),
    schedule: command.schedule || command.schedulerIntent || null
  });
  return {
    sequence: index + 1,
    idempotencyKey,
    commandStatus,
    commandDigest,
    leaseRequired,
    leaseOwner: leaseRequired ? bootId : null,
    leaseExpiresAt
  };
}

function classifyPersistedCommandRecovery({ command, previous, envelope, boundaryProof }) {
  const previousTerminal = previous && terminalPersistedCommandStates.includes(previous.status);
  const previousReplayable = previous && replayablePersistedCommandStates.includes(previous.status);
  const proofChanged = Boolean(previous?.proofDigest && previous.proofDigest !== boundaryProof.digest);
  const digestChanged = Boolean(previous?.commandDigest && previous.commandDigest !== envelope.commandDigest);
  if (previousTerminal) {
    return {
      persistedStatus: 'replayed',
      recoveryAction: 'skip_already_applied',
      restartSafe: true,
      conflict: null
    };
  }
  if (proofChanged || digestChanged) {
    return {
      persistedStatus: 'superseded',
      recoveryAction: 'supersede_stale_command',
      restartSafe: true,
      conflict: proofChanged ? 'proof_digest_changed' : 'command_digest_changed'
    };
  }
  if (previous?.status === 'failed' && previous.retryableFailure) {
    return {
      persistedStatus: envelope.commandStatus === 'blocked' ? 'blocked' : 'scheduled',
      recoveryAction: 'retry_previous_failure',
      restartSafe: Boolean(command.proofDigest || boundaryProof.digest),
      conflict: null
    };
  }
  if (previousReplayable && previous.leaseExpired) {
    return {
      persistedStatus: envelope.commandStatus,
      recoveryAction: 'reacquire_expired_lease',
      restartSafe: Boolean(command.proofDigest || boundaryProof.digest),
      conflict: null
    };
  }
  if (previousReplayable) {
    return {
      persistedStatus: previous.status,
      recoveryAction: 'resume_pending_command',
      restartSafe: Boolean(command.proofDigest || boundaryProof.digest),
      conflict: null
    };
  }
  return {
    persistedStatus: envelope.commandStatus,
    recoveryAction: envelope.commandStatus === 'blocked' ? 'persist_blocked_status' : 'append_new_command',
    restartSafe: envelope.commandStatus !== 'ready' || Boolean(command.proofDigest || boundaryProof.digest),
    conflict: null
  };
}

function buildPersistedStateRecovery({ input, now, manifest, clientRequest, ok, workflowHandoff, boundaryProof, operationalHealth, lifecycleControls }) {
  const persistedKernelState = normalizePersistedKernelState(input, manifest, clientRequest, now);
  const latestByKey = new Map();
  for (const record of persistedKernelState.commandJournal) {
    const previous = latestByKey.get(record.idempotencyKey);
    if (!previous || record.sequence >= previous.sequence) {
      latestByKey.set(record.idempotencyKey, record);
    }
  }
  const shapedCommands = workflowHandoff.commands.map((command, index) => {
    const envelope = buildCommandPersistenceEnvelope(command, index, manifest, clientRequest, boundaryProof, now, persistedKernelState.bootId);
    const previous = latestByKey.get(envelope.idempotencyKey) || null;
    const recovery = classifyPersistedCommandRecovery({ command, previous, envelope, boundaryProof });
    return {
      ...command,
      sequence: envelope.sequence,
      idempotencyKey: envelope.idempotencyKey,
      commandDigest: envelope.commandDigest,
      persistedStatus: recovery.persistedStatus,
      restartSafe: recovery.restartSafe,
      recoveryAction: recovery.recoveryAction,
      previousStatus: previous ? previous.status : null,
      recoveryConflict: recovery.conflict,
      replayCount: previous ? previous.replayCount + (recovery.persistedStatus === 'replayed' ? 1 : 0) : 0,
      lease: {
        required: envelope.leaseRequired,
        owner: envelope.leaseOwner,
        expiresAt: envelope.leaseExpiresAt,
        previousOwner: previous?.leaseOwner || null,
        previousExpired: previous?.leaseExpired === true
      }
    };
  });
  const blockedCommands = shapedCommands.filter(command => command.persistedStatus === 'blocked');
  const replayedCommands = shapedCommands.filter(command => command.persistedStatus === 'replayed');
  const supersededCommands = shapedCommands.filter(command => command.persistedStatus === 'superseded');
  const pendingCommands = shapedCommands.filter(command => replayablePersistedCommandStates.includes(command.persistedStatus));
  const unsafeCommands = shapedCommands.filter(command => !command.restartSafe);
  const commandConflicts = shapedCommands.filter(command => command.recoveryConflict);
  return {
    schema: 'aios.packageManifest.persistedStateRecovery.v1',
    generatedAt: now,
    bootId: persistedKernelState.bootId,
    packageKey: persistedKernelState.packageKey,
    routeKey: persistedKernelState.routeKey,
    decision: ok ? 'accepted' : 'rejected',
    proofDigest: boundaryProof.digest,
    previousProofDigest: persistedKernelState.lastProofDigest,
    proofChanged: Boolean(persistedKernelState.lastProofDigest && persistedKernelState.lastProofDigest !== boundaryProof.digest),
    restartSafeStatus: blockedCommands.length > 0
      ? 'blocked'
      : unsafeCommands.length > 0
        ? 'failed'
        : commandConflicts.length > 0
          ? 'superseded'
      : operationalHealth.degraded
        ? 'deferred'
        : replayedCommands.length === shapedCommands.length
          ? 'replayed'
          : lifecycleControls.commandStatus,
    statusSemantics: {
      ready: 'Command can be dispatched after acquiring the emitted lease.',
      scheduled: 'Command is pending retry or scheduler acknowledgement and is safe to resume.',
      blocked: 'Command must remain visible but must not be replayed until blockers clear.',
      replayed: 'A terminal persisted command with the same idempotency key was observed and skipped.',
      superseded: 'A persisted command was replaced because proof or command digest changed after restart.',
      failed: 'Command recovery is not restart-safe and requires manual reconciliation.'
    },
    commandJournalPatch: shapedCommands,
    recoveryPaths: {
      replayed: replayedCommands.map(command => command.idempotencyKey),
      pending: pendingCommands.map(command => command.idempotencyKey),
      superseded: supersededCommands.map(command => ({
        idempotencyKey: command.idempotencyKey,
        type: command.type,
        conflict: command.recoveryConflict
      })),
      blocked: blockedCommands.map(command => ({ idempotencyKey: command.idempotencyKey, type: command.type, reason: command.reason || command.recoveryAction })),
      appendOnly: shapedCommands.filter(command => command.recoveryAction === 'append_new_command').map(command => command.idempotencyKey),
      reacquiredLeases: shapedCommands.filter(command => command.recoveryAction === 'reacquire_expired_lease').map(command => command.idempotencyKey),
      retryFailures: shapedCommands.filter(command => command.recoveryAction === 'retry_previous_failure').map(command => command.idempotencyKey),
      unsafe: unsafeCommands.map(command => ({ idempotencyKey: command.idempotencyKey, type: command.type }))
    },
    restartSafety: {
      safe: unsafeCommands.length === 0,
      totalCommands: shapedCommands.length,
      replayedCount: replayedCommands.length,
      pendingCount: pendingCommands.length,
      blockedCount: blockedCommands.length,
      supersededCount: supersededCommands.length,
      unsafeCount: unsafeCommands.length,
      leasedCommandCount: shapedCommands.filter(command => command.lease.required).length,
      expiredLeaseRecoveryCount: shapedCommands.filter(command => command.recoveryAction === 'reacquire_expired_lease').length
    },
    persistedKernelState
  };
}

export function describePackageManifestSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const manifest = normalizeManifest(input);
  const principal = normalizePrincipal(input);
  const clientRequest = normalizeClientRequest(input, manifest, principal);
  const contractValidation = validateManifestContract(manifest);
  const providerContracts = normalizeProviderContracts(input, manifest, now);
  const providerNegotiation = evaluateProviderContracts(providerContracts, manifest);
  const tenantBoundary = evaluateTenantBoundary(manifest, principal);
  const workspaceBoundary = evaluateWorkspaceBoundary(manifest, principal, clientRequest);
  const boundaryEnforcement = buildBoundaryEnforcementContract({
    manifest,
    principal,
    clientRequest,
    tenantBoundary,
    workspaceBoundary
  });
  const permissionEvaluations = manifest.requestedPermissions.map(permission => evaluatePermission(permission, manifest, principal));
  const grantedPermissions = permissionEvaluations.filter(result => result.granted).map(result => result.permission);
  const deniedPermissions = permissionEvaluations.filter(result => !result.granted);
  const boundaryDenials = tenantBoundary.denials.map(reason => ({ reason, surface: surfaceName }));
  const workspaceDenials = workspaceBoundary.denials.map(reason => ({ reason, surface: surfaceName, boundary: 'workspace' }));
  const enforcementDenials = boundaryEnforcement.denials.map(reason => ({
    reason,
    surface: surfaceName,
    boundary: 'hosted-kernel-enforcement',
    mode: boundaryEnforcement.mode
  }));
  const contractDenials = contractValidation.blockingIssues.map(issue => ({
    reason: issue.code,
    field: issue.field,
    surface: surfaceName,
    boundary: 'manifest-contract'
  }));
  const providerDenials = providerNegotiation.blockingIssues.map(issue => ({
    reason: issue.code,
    field: issue.field,
    surface: surfaceName,
    boundary: 'provider-contracts'
  }));
  const ok = contractValidation.ok && providerNegotiation.ok && tenantBoundary.ok && workspaceBoundary.ok && boundaryEnforcement.ok && deniedPermissions.length === 0;
  const operationalHealth = normalizeRuntimeHealth(input, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, manifest, clientRequest, now);
  const persistedKernelState = normalizePersistedKernelState(input, manifest, clientRequest, now);
  const installReady = ok && operationalHealth.state === 'healthy';
  const proofSubject = {
    surfaceId,
    packageId: manifest.id,
    packageVersion: manifest.version,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    routeWorkspaceId: workspaceBoundary.routeWorkspaceId,
    allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
    contractIssueCodes: contractValidation.issues.map(issue => issue.code),
    grantedPermissions,
    deniedPermissions: deniedPermissions.map(({ permission, reason }) => ({ permission, reason })),
    boundaryDenials: [...tenantBoundary.denials, ...workspaceBoundary.denials],
    boundaryEnforcement: {
      mode: boundaryEnforcement.mode,
      policy: boundaryEnforcement.policy,
      ok: boundaryEnforcement.ok,
      routeTenantId: boundaryEnforcement.routeTenantId,
      routeWorkspaceId: boundaryEnforcement.routeWorkspaceId,
      manifestTenantId: boundaryEnforcement.manifestTenantId,
      manifestWorkspaceIds: boundaryEnforcement.manifestWorkspaceIds,
      enforcedWorkspaceIds: boundaryEnforcement.enforcedWorkspaceIds,
      requiresExplicitWorkspaceGrant: boundaryEnforcement.requiresExplicitWorkspaceGrant,
      crossTenantBlocked: boundaryEnforcement.crossTenantBlocked,
      denials: boundaryEnforcement.denials,
      warnings: boundaryEnforcement.warnings
    },
    operationalHealth: {
      state: operationalHealth.state,
      degradedReasons: operationalHealth.degradedReasons,
      retryAllowed: operationalHealth.retry.retryAllowed,
      failureState: operationalHealth.failureState,
      degradedCapabilities: operationalHealth.degradedMode.capabilities,
      healthProbes: operationalHealth.healthProbes.map(({ name, state, required, reason }) => ({ name, state, required, reason }))
    },
      lifecycleSettings: {
      requestedCommand: lifecycleSettings.requestedCommand,
      enabled: lifecycleSettings.enabled,
      currentState: lifecycleSettings.currentState,
      desiredState: lifecycleSettings.desiredState,
      commandPolicies: lifecycleSettings.commandPolicies,
      requestedCommandPolicy: lifecycleSettings.requestedCommandPolicy,
      schedule: lifecycleSettings.schedule,
      target: lifecycleSettings.target
    },
    providerContracts: {
      provides: providerContracts.provides.map(({ service, capability, transport }) => ({ service, capability, transport })),
      consumes: providerNegotiation.negotiated,
      externalHandoff: providerNegotiation.externalHandoff,
      syncMetadata: providerNegotiation.syncMetadata,
      providerResolutionEnvelope: providerNegotiation.providerResolutionEnvelope.proofSubject
    },
    persistedKernelState: {
      bootId: persistedKernelState.bootId,
      packageKey: persistedKernelState.packageKey,
      routeKey: persistedKernelState.routeKey,
      lastProofDigest: persistedKernelState.lastProofDigest,
      commandCount: persistedKernelState.commandJournal.length
    }
  };
  const boundaryProof = {
    type: 'hosted-kernel-package-manifest-boundary-proof',
    issuedAt: now,
    digest: stableHash(proofSubject),
    subject: proofSubject
  };
  const auditHandoff = {
    channel: manifest.hostedKernel.auditChannel,
    required: !installReady || permissionEvaluations.some(result => result.audit === 'required'),
    eventType: installReady ? 'package_manifest.accepted' : operationalHealth.degraded ? 'package_manifest.degraded' : 'package_manifest.rejected',
    correlationId: input.correlationId || `${manifest.id}:${manifest.version}:${boundaryProof.digest}`,
    actorId: principal.actorId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: workspaceBoundary.routeWorkspaceId || tenantBoundary.workspaceId,
    workspaceBoundary: {
      ok: workspaceBoundary.ok,
      allowedWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
      denials: workspaceBoundary.denials
    },
    boundaryEnforcement: {
      schema: boundaryEnforcement.schema,
      mode: boundaryEnforcement.mode,
      policy: boundaryEnforcement.policy,
      ok: boundaryEnforcement.ok,
      auditEventType: boundaryEnforcement.auditEventType,
      handoff: boundaryEnforcement.handoff,
      denials: boundaryEnforcement.denials,
      warnings: boundaryEnforcement.warnings
    },
    providerContracts: {
      ok: providerNegotiation.ok,
      externalHandoff: providerNegotiation.externalHandoff,
      syncMetadata: providerNegotiation.syncMetadata,
      providerResolutionEnvelope: {
        schema: providerNegotiation.providerResolutionEnvelope.schema,
        state: providerNegotiation.providerResolutionEnvelope.state,
        blockedCount: providerNegotiation.providerResolutionEnvelope.blockedCount,
        digest: providerNegotiation.providerResolutionEnvelope.proofSubject.digest
      }
    },
    proofDigest: boundaryProof.digest
  };
  const lifecycleValidation = validateLifecycleSettings(lifecycleSettings, {
    ok,
    manifest,
    operationalHealth,
    auditHandoff
  });
  const lifecycleControls = buildLifecycleControls({
    ok,
    manifest,
    lifecycleSettings,
    lifecycleValidation,
    auditHandoff,
    boundaryProof,
    now,
    operationalHealth
  });
  const lifecycleDenials = lifecycleValidation.blockingIssues.map(issue => ({
    reason: issue.code,
    field: issue.field,
    surface: surfaceName,
    boundary: 'lifecycle-settings'
  }));
  const actionableErrors = buildActionableErrors({
    ok,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    deniedPermissions,
    operationalHealth,
    lifecycleValidation,
    providerNegotiation
  });
  const historySnapshots = normalizeHistorySnapshots(input, now);
  const currentHistorySnapshot = buildCurrentHistorySnapshot({
    now,
    manifest,
    ok,
    permissionEvaluations,
    deniedPermissions,
    auditHandoff,
    boundaryProof,
    actionableErrors
  });
  const analyticsCounters = buildAnalyticsCounters({
    ok,
    manifest,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    permissionEvaluations,
    deniedPermissions,
    auditHandoff,
    historySnapshots,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerContracts,
    providerNegotiation
  });
  const timeline = buildTimeline({
    now,
    manifest,
    ok,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    permissionEvaluations,
    auditHandoff,
    boundaryProof,
    historySnapshots,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const analyticsHistoryReport = buildAnalyticsHistoryReport({
    now,
    manifest,
    historySnapshots,
    currentSnapshot: currentHistorySnapshot,
    analyticsCounters,
    timeline
  });
  const exportReadySummary = buildExportReadySummary({
    now,
    manifest,
    principal,
    ok,
    contractValidation,
    permissionEvaluations,
    deniedPermissions,
    tenantBoundary,
    workspaceBoundary,
    auditHandoff,
    boundaryProof,
    analyticsCounters,
    analyticsHistoryReport,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerContracts,
    providerNegotiation
  });
  const workflowHandoff = buildWorkflowHandoff({
    ok,
    manifest,
    principal,
    clientRequest,
    contractValidation,
    tenantBoundary,
    workspaceBoundary,
    permissionEvaluations,
    deniedPermissions,
    auditHandoff,
    boundaryProof,
    operationalHealth,
    actionableErrors,
    lifecycleControls,
    providerNegotiation
  });
  const persistedStateRecovery = buildPersistedStateRecovery({
    input,
    now,
    manifest,
    clientRequest,
    ok,
    workflowHandoff,
    boundaryProof,
    operationalHealth,
    lifecycleControls
  });
  auditHandoff.persistedStateRecovery = {
    schema: persistedStateRecovery.schema,
    bootId: persistedStateRecovery.bootId,
    restartSafeStatus: persistedStateRecovery.restartSafeStatus,
    commandCount: persistedStateRecovery.commandJournalPatch.length,
    replayedCommandCount: persistedStateRecovery.recoveryPaths.replayed.length,
    pendingCommandCount: persistedStateRecovery.recoveryPaths.pending.length,
    blockedCommandCount: persistedStateRecovery.recoveryPaths.blocked.length,
    supersededCommandCount: persistedStateRecovery.recoveryPaths.superseded.length,
    reacquiredLeaseCount: persistedStateRecovery.recoveryPaths.reacquiredLeases.length,
    retryFailureCount: persistedStateRecovery.recoveryPaths.retryFailures.length,
    restartSafe: persistedStateRecovery.restartSafety.safe
  };
  workflowHandoff.commands = persistedStateRecovery.commandJournalPatch;
  workflowHandoff.persistedStateRecovery = persistedStateRecovery;
  const acceptancePreview = workflowHandoff.acceptancePreview;
  return {
    ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel package manifest boundary evaluation',
    dataContracts: {
      manifest: ['id', 'name', 'version', 'tenantId?', 'workspaceId?', 'allowedWorkspaceIds', 'workspaceScope', 'requestedPermissions', 'hostedKernel'],
      principal: ['actorId', 'tenantId', 'workspaceId', 'workspaceTenantId', 'workspaceMemberships', 'roles'],
      clientRequest: ['schema', 'requestId', 'action', 'source', 'route', 'state'],
      contractValidation: ['schema', 'ok', 'supportedWorkspaceScopes', 'supportedBoundaryModes', 'issues', 'blockingIssues', 'warnings'],
      providerContracts: ['schema', 'capturedAt', 'provides', 'consumes', 'availableCapabilities'],
      providerNegotiation: ['schema', 'ok', 'supportedProviderTransports', 'supportedSyncModes', 'supportedProviderHandoffStates', 'negotiated', 'syncMetadata', 'externalHandoff', 'providerResolutionEnvelope', 'issues', 'blockingIssues', 'warnings'],
      providerResolutionEnvelope: ['schema', 'packageKey', 'capturedAt', 'state', 'requiredCount', 'resolvedCount', 'blockedCount', 'advisoryCount', 'items', 'proofSubject'],
      boundaryEnforcement: ['schema', 'mode', 'policy', 'ok', 'actorTenantId', 'routeTenantId', 'routeWorkspaceId', 'manifestTenantId', 'manifestWorkspaceIds', 'enforcedWorkspaceIds', 'requiresExplicitWorkspaceGrant', 'crossTenantBlocked', 'auditRequired', 'auditEventType', 'handoff', 'denials', 'warnings'],
      operationalHealth: ['schema', 'checkedAt', 'state', 'degraded', 'degradedReasons', 'healthProbes', 'failureState', 'degradedMode', 'dependencies', 'retry'],
      lifecycleSettings: ['schema', 'capturedAt', 'requestedCommand', 'enabled', 'currentState', 'desiredState', 'requireAuditReceipt', 'requireHealthyRuntime', 'allowRollback', 'commandPolicies', 'requestedCommandPolicy', 'schedule', 'target'],
      lifecycleValidation: ['schema', 'ok', 'supportedLifecycleCommands', 'supportedSchedulePolicies', 'issues', 'blockingIssues', 'warnings'],
      lifecycleCommandPlan: ['schema', 'command', 'currentState', 'targetState', 'transitionAllowed', 'commandStatus', 'stateMutation', 'enablement', 'schedulerIntent', 'auditReceipt', 'nextActionState', 'applyPayload'],
      lifecycleControls: ['schema', 'packageId', 'packageVersion', 'requestedCommand', 'commandStatus', 'controls', 'commandPlan', 'schedule', 'nextAction', 'validation'],
      persistedKernelState: ['schema', 'recoveredAt', 'bootId', 'packageKey', 'routeKey', 'lastProofDigest', 'lastDecision', 'commandJournal', 'latestCommandByKey'],
      persistedStateRecovery: ['schema', 'generatedAt', 'bootId', 'packageKey', 'routeKey', 'decision', 'proofDigest', 'previousProofDigest', 'proofChanged', 'restartSafeStatus', 'statusSemantics', 'commandJournalPatch', 'recoveryPaths', 'restartSafety', 'persistedKernelState'],
      clientWorkflowContext: ['schema', 'requestId', 'actorId', 'routeKey', 'stateStatus', 'stateIssues', 'navigation', 'routeParams', 'handoffQueue', 'hasBlockingHandoff', 'resumeToken', 'clientPatchHints'],
      actionableErrors: ['schema', 'ok', 'errors', 'retryable', 'blocking'],
      validationSummary: ['schema', 'ok', 'readinessScore', 'blockingSectionIds', 'warningSectionIds', 'blockingCount', 'warningCount', 'actionableErrorCount', 'retryableErrorCount', 'proofDigest'],
      acceptancePreview: ['schema', 'generatedAt', 'requestId', 'package', 'actor', 'decision', 'userVisibleStatus', 'validationSummary', 'sections', 'permissionRows', 'nextSteps', 'primaryNextStep', 'acceptanceReceipt'],
      routeAcceptanceContract: ['schema', 'generatedAt', 'requestId', 'route', 'preview', 'acceptance', 'validationSummary', 'explainableNextSteps', 'retry', 'auditReceipt'],
      previewReadinessDeck: ['schema', 'generatedAt', 'requestId', 'packageKey', 'readiness', 'routeBinding', 'validationSummary', 'validationCards', 'nextStepIndex', 'clientPatch', 'auditProof'],
      clientRuntimeHandoffContract: ['schema', 'generatedAt', 'requestId', 'packageKey', 'routeMutation', 'stateContract', 'workflowQueue', 'auditProof'],
      workspaceBoundary: ['ok', 'scope', 'routeWorkspaceId', 'activeWorkspaceId', 'manifestWorkspaceId', 'allowedWorkspaceIds', 'principalWorkspaceIds', 'denials'],
      historySnapshot: ['sequence', 'capturedAt', 'packageId', 'packageVersion', 'decision', 'proofDigest', 'requestedCount', 'grantedCount', 'deniedCount', 'auditRequired', 'reasons'],
      currentHistorySnapshot: ['sequence', 'capturedAt', 'packageId', 'packageVersion', 'decision', 'proofDigest', 'requestedCount', 'grantedCount', 'deniedCount', 'auditRequired', 'reasons'],
      analyticsHistoryReport: ['schema', 'generatedAt', 'packageKey', 'currentSnapshot', 'windows', 'trend', 'exportBatch', 'timelineIndex', 'retention', 'countersDigest'],
      analyticsExport: ['schema', 'generatedAt', 'surfaceId', 'package', 'actor', 'decision', 'counters', 'permissionRows', 'denialSummary', 'audit', 'lifecycle', 'providerContracts', 'proof', 'historyReport'],
      workflowHandoff: ['schema', 'requestId', 'action', 'decision', 'userVisibleStatus', 'route', 'nextStep', 'acceptancePreview', 'validationSummary', 'explainableNextSteps', 'routeAcceptanceContract', 'previewReadinessDeck', 'clientRuntimeHandoffContract', 'clientWorkflowContext', 'clientStatePatch', 'permissionSummary', 'commands', 'persistedStateRecovery'],
      output: ['contractValidation', 'providerContracts', 'providerNegotiation', 'tenantBoundary', 'workspaceBoundary', 'boundaryEnforcement', 'operationalHealth', 'lifecycleSettings', 'lifecycleValidation', 'lifecycleControls', 'persistedKernelState', 'persistedStateRecovery', 'clientWorkflowContext', 'actionableErrors', 'permissionGrant', 'auditHandoff', 'boundaryProof', 'acceptancePreview', 'routeAcceptanceContract', 'previewReadinessDeck', 'clientRuntimeHandoffContract', 'workflowHandoff', 'analyticsCounters', 'historySnapshots', 'currentHistorySnapshot', 'analyticsHistoryReport', 'timeline', 'exportReadySummary']
    },
    package: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version
    },
    principal,
    contractValidation,
    providerContracts,
    providerNegotiation,
    tenantBoundary,
    workspaceBoundary,
    boundaryEnforcement,
    permissionGrant: {
      requested: manifest.requestedPermissions,
      granted: grantedPermissions,
      denied: deniedPermissions,
      effectiveScope: tenantBoundary.workspaceScope,
      effectiveWorkspaceIds: workspaceBoundary.allowedWorkspaceIds,
      defaultPolicy: 'deny-by-default'
    },
    denials: [...contractDenials, ...providerDenials, ...boundaryDenials, ...workspaceDenials, ...enforcementDenials, ...lifecycleDenials, ...deniedPermissions],
    clientRequest,
    operationalHealth,
    lifecycleSettings,
    lifecycleValidation,
    lifecycleControls,
    persistedKernelState,
    persistedStateRecovery,
    clientWorkflowContext: workflowHandoff.clientWorkflowContext,
    actionableErrors,
    auditHandoff,
    boundaryProof,
    acceptancePreview,
    routeAcceptanceContract: workflowHandoff.routeAcceptanceContract,
    previewReadinessDeck: workflowHandoff.previewReadinessDeck,
    clientRuntimeHandoffContract: workflowHandoff.clientRuntimeHandoffContract,
    workflowHandoff,
    integrationPoints: {
      installGate: installReady ? 'allow_package_install' : 'block_package_install',
      clientStatePatch: workflowHandoff.clientStatePatch.schema,
      workflowCommandTypes: workflowHandoff.commands.map(command => command.type),
      auditSink: auditHandoff.channel,
      analyticsSink: input.analyticsSink || 'kernel.analytics.package-manifest',
      exportSchema: exportReadySummary.schema,
      timelineStream: 'kernel.timeline.package-manifest',
      analyticsHistoryReport: analyticsHistoryReport.schema,
      analyticsExportBatchDigest: analyticsHistoryReport.exportBatch.batchDigest,
      analyticsExportRowCount: analyticsHistoryReport.exportBatch.rowCount,
      analyticsDecisionChanged: analyticsHistoryReport.trend.decisionChanged,
      workspaceResolver: 'tenant_workspace_boundary',
      boundaryEnforcement: boundaryEnforcement.schema,
      boundaryMode: boundaryEnforcement.mode,
      boundaryPolicy: boundaryEnforcement.policy,
      boundaryEnforcementHandoff: boundaryEnforcement.handoff.type,
      boundaryEnforcementStatus: boundaryEnforcement.handoff.status,
      retryScheduler: actionableErrors.retryable.length > 0 ? 'kernel.package.retry' : null,
      runtimeHealthIncident: operationalHealth.failureState.circuitOpen ? 'kernel.package.health.incident' : null,
      runtimeFailureState: operationalHealth.failureState.schema,
      runtimeCircuitOpen: operationalHealth.failureState.circuitOpen,
      lifecycleCommand: lifecycleControls.nextAction.type,
      lifecycleCommandStatus: lifecycleControls.commandStatus,
      lifecycleCurrentState: lifecycleControls.commandPlan.currentState,
      lifecycleTargetState: lifecycleControls.commandPlan.targetState,
      lifecycleNextActionState: lifecycleControls.commandPlan.nextActionState,
      lifecycleScheduler: lifecycleControls.schedule.schedulerCommand,
      lifecycleStateMutation: lifecycleControls.commandPlan.stateMutation.type,
      lifecycleCommandAvailability: lifecycleControls.controls.commandAvailability,
      persistedCommandJournal: persistedStateRecovery.schema,
      persistedCommandCount: persistedStateRecovery.commandJournalPatch.length,
      restartSafeStatus: persistedStateRecovery.restartSafeStatus,
      restartSafe: persistedStateRecovery.restartSafety.safe,
      idempotencyKeys: persistedStateRecovery.commandJournalPatch.map(command => command.idempotencyKey),
      recoveredLeaseCount: persistedStateRecovery.restartSafety.expiredLeaseRecoveryCount,
      supersededPersistedCommandCount: persistedStateRecovery.restartSafety.supersededCount,
      retryFailureCommandCount: persistedStateRecovery.recoveryPaths.retryFailures.length,
      clientWorkflowContext: workflowHandoff.clientWorkflowContext.schema,
      clientWorkflowStateStatus: workflowHandoff.clientWorkflowContext.stateStatus,
      clientWorkflowTargetPanel: workflowHandoff.clientWorkflowContext.navigation.targetPanel,
      clientWorkflowResumeToken: workflowHandoff.clientWorkflowContext.resumeToken,
      clientWorkflowHandoffCount: workflowHandoff.clientWorkflowContext.handoffQueue.length,
      acceptancePreview: workflowHandoff.acceptancePreview.schema,
      routeAcceptanceContract: workflowHandoff.routeAcceptanceContract.schema,
      routeAcceptanceAction: workflowHandoff.routeAcceptanceContract.route.action,
      routeAcceptancePanel: workflowHandoff.routeAcceptanceContract.route.panel,
      previewReadinessDeck: workflowHandoff.previewReadinessDeck.schema,
      previewReadinessState: workflowHandoff.previewReadinessDeck.readiness.state,
      previewReadinessScore: workflowHandoff.previewReadinessDeck.readiness.score,
      previewReadinessRouteAction: workflowHandoff.previewReadinessDeck.routeBinding.action,
      previewReadinessDigest: workflowHandoff.previewReadinessDeck.auditProof.previewDigest,
      clientRuntimeHandoffContract: workflowHandoff.clientRuntimeHandoffContract.schema,
      clientRuntimeHandoffStatus: workflowHandoff.clientRuntimeHandoffContract.workflowQueue.status,
      clientRuntimeHandoffDigest: workflowHandoff.clientRuntimeHandoffContract.auditProof.handoffDigest,
      clientRuntimePatchRequired: workflowHandoff.clientRuntimeHandoffContract.stateContract.requiredOperations.length,
      clientRuntimeQueuedActions: workflowHandoff.clientRuntimeHandoffContract.workflowQueue.queuedActions.map(action => action.type),
      validationSummary: workflowHandoff.validationSummary.schema,
      nextStepContract: workflowHandoff.explainableNextSteps.length > 0 ? 'aios.packageManifest.explainableNextSteps.v1' : null,
      providerContractResolver: providerNegotiation.externalHandoff.length > 0 ? 'kernel.provider.capability.resolve' : null,
      providerSyncModes: providerNegotiation.syncMetadata.map(sync => sync.mode),
      providerHandoffCount: providerNegotiation.externalHandoff.length,
      providerResolutionEnvelope: providerNegotiation.providerResolutionEnvelope.schema,
      providerResolutionState: providerNegotiation.providerResolutionEnvelope.state,
      providerResolutionDigest: providerNegotiation.providerResolutionEnvelope.proofSubject.digest,
      providerResolutionBlockedCount: providerNegotiation.providerResolutionEnvelope.blockedCount,
      enableDisableControl: lifecycleControls.controls.enabled ? 'package_controls_enabled' : 'package_controls_disabled',
      degradedMode: operationalHealth.degraded ? 'manifest_operational_health_panel' : null,
      contractValidator: 'hosted_kernel_manifest_contract_v1',
      workspaceDecision: workspaceBoundary.ok ? 'workspace_route_authorized' : 'workspace_route_blocked',
      boundaryDecision: boundaryEnforcement.ok ? 'hosted_kernel_boundary_enforced' : 'hosted_kernel_boundary_blocked',
      permissionCatalog: Object.keys(hostedKernelPermissionCatalog)
    },
    analyticsCounters,
    historySnapshots,
    currentHistorySnapshot,
    analyticsHistoryReport,
    timeline,
    reportingState: {
      timelineStream: 'kernel.timeline.package-manifest',
      latestDecision: exportReadySummary.decision,
      currentProofDigest: boundaryProof.digest,
      historyWindowSize: historySnapshots.length,
      currentHistorySnapshot,
      analyticsTrend: analyticsHistoryReport.trend,
      analyticsWindows: analyticsHistoryReport.windows,
      analyticsExportBatch: {
        schema: analyticsHistoryReport.exportBatch.schema,
        sink: analyticsHistoryReport.exportBatch.sink,
        rowCount: analyticsHistoryReport.exportBatch.rowCount,
        batchDigest: analyticsHistoryReport.exportBatch.batchDigest
      },
      timelineIndex: analyticsHistoryReport.timelineIndex,
      retention: analyticsHistoryReport.retention,
      denialSummary: exportReadySummary.denialSummary,
      nextStep: workflowHandoff.nextStep,
      primaryNextStep: workflowHandoff.acceptancePreview.primaryNextStep,
      clientWorkflow: {
        stateStatus: workflowHandoff.clientWorkflowContext.stateStatus,
        stateIssues: workflowHandoff.clientWorkflowContext.stateIssues,
        targetPanel: workflowHandoff.clientWorkflowContext.navigation.targetPanel,
        routeIntent: workflowHandoff.clientWorkflowContext.navigation.routeIntent,
        resumeToken: workflowHandoff.clientWorkflowContext.resumeToken,
        hasBlockingHandoff: workflowHandoff.clientWorkflowContext.hasBlockingHandoff
      },
      readinessScore: workflowHandoff.validationSummary.readinessScore,
      nextAction: lifecycleControls.nextAction,
      boundaryEnforcement: {
        mode: boundaryEnforcement.mode,
        policy: boundaryEnforcement.policy,
        status: boundaryEnforcement.handoff.status,
        denials: boundaryEnforcement.denials,
        warnings: boundaryEnforcement.warnings,
        enforcedWorkspaceIds: boundaryEnforcement.enforcedWorkspaceIds
      },
      routeAcceptance: workflowHandoff.routeAcceptanceContract.acceptance,
      previewReadiness: {
        state: workflowHandoff.previewReadinessDeck.readiness.state,
        score: workflowHandoff.previewReadinessDeck.readiness.score,
        canAccept: workflowHandoff.previewReadinessDeck.readiness.canAccept,
        primaryNextStepId: workflowHandoff.previewReadinessDeck.clientPatch.primaryNextStepId,
        routeAction: workflowHandoff.previewReadinessDeck.routeBinding.action,
        previewDigest: workflowHandoff.previewReadinessDeck.auditProof.previewDigest
      },
      clientRuntimeHandoff: {
        status: workflowHandoff.clientRuntimeHandoffContract.workflowQueue.status,
        targetPanel: workflowHandoff.clientRuntimeHandoffContract.workflowQueue.targetPanel,
        routeAction: workflowHandoff.clientRuntimeHandoffContract.routeMutation.action,
        requiredPatchOperations: workflowHandoff.clientRuntimeHandoffContract.stateContract.requiredOperations.length,
        queuedActionTypes: workflowHandoff.clientRuntimeHandoffContract.workflowQueue.queuedActions.map(action => action.type),
        handoffDigest: workflowHandoff.clientRuntimeHandoffContract.auditProof.handoffDigest
      },
      userVisibleStatus: workflowHandoff.userVisibleStatus,
      healthState: operationalHealth.state,
      runtimeFailurePhase: operationalHealth.failureState.phase,
      runtimeCircuitOpen: operationalHealth.failureState.circuitOpen,
      degradedCapabilities: operationalHealth.degradedMode.capabilities,
      lifecycleCommandStatus: lifecycleControls.commandStatus,
      lifecycleCommandPlan: lifecycleControls.commandPlan,
      restartSafeStatus: persistedStateRecovery.restartSafeStatus,
      recoveryPaths: persistedStateRecovery.recoveryPaths,
      restartSafety: persistedStateRecovery.restartSafety,
      persistedStatusSemantics: persistedStateRecovery.statusSemantics,
      persistedCommandCount: persistedStateRecovery.commandJournalPatch.length,
      providerContractsOk: providerNegotiation.ok,
      providerHandoffs: providerNegotiation.externalHandoff.length,
      providerResolution: {
        state: providerNegotiation.providerResolutionEnvelope.state,
        blockedCount: providerNegotiation.providerResolutionEnvelope.blockedCount,
        advisoryCount: providerNegotiation.providerResolutionEnvelope.advisoryCount,
        digest: providerNegotiation.providerResolutionEnvelope.proofSubject.digest
      },
      schedulePolicy: lifecycleControls.schedule.policy,
      retryAllowed: operationalHealth.retry.retryAllowed && actionableErrors.retryable.length > 0,
      exportReady: true
    },
    exportReadySummary,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describePackageManifestSurface;
