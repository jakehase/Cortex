import {
  compileMailchimpAdapterHandoff,
  buildMailchimpTenantBoundaryContinuityContract,
  createMailchimpAdapterExportSummary,
} from './adapter-handoff.mjs';
import { buildMailchimpStatusSnapshot } from './status-handoff.mjs';

const REVERSIBLE_ACTIONS = Object.freeze({
  'campaign.schedule': 'campaign.pause',
  'campaign.pause': 'campaign.resume',
  'campaign.resume': 'campaign.pause',
  'tag.apply': 'tag.remove',
  'tag.remove': 'tag.apply',
});

const RECOVERY_TERMINAL_STATES = Object.freeze([
  'blocked',
  'failed',
  'rolled_back',
  'succeeded',
]);

const RECOVERY_SUCCESS_STATES = Object.freeze([
  'rolled_back',
  'succeeded',
]);

const RECOVERY_RETRYABLE_STATES = Object.freeze([
  'lease_expired',
  'missing_token',
  'rate_limited',
  'retryable_error',
  'stale',
]);

const ROLLBACK_HEALTH_RETRY_BASE_MS = 1000;
const ROLLBACK_HEALTH_RETRY_MAX_MS = 30000;
const MAILCHIMP_ROLLBACK_PROVIDER_CAPABILITIES = Object.freeze({
  'campaign.pause': Object.freeze(['campaigns:read', 'campaigns:write', 'campaigns:pause']),
  'campaign.resume': Object.freeze(['campaigns:read', 'campaigns:write', 'campaigns:resume']),
  'tag.apply': Object.freeze(['lists:read', 'lists:write', 'members:write', 'tags:write']),
  'tag.remove': Object.freeze(['lists:read', 'lists:write', 'members:write', 'tags:write']),
});
const ROLLBACK_LIFECYCLE_COMMANDS = Object.freeze([
  'archive_rollback_audit',
  'observe_rollback_command',
  'present_rollback_preview',
  'queue_rollback_manifest',
  'refresh_provider_before_rollback',
  'release_lifecycle_hold',
  'request_operator_acceptance',
  'resolve_tenant_permission_boundary',
  'surface_existing_rollback_command',
]);

function compactString(value) {
  return String(value ?? '').trim();
}

function normalizeState(value, fallback = 'unknown') {
  const normalized = compactString(value || fallback).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return normalized || fallback;
}

function safePayload(payload = {}) {
  return {
    audienceId: compactString(payload.audienceId),
    campaignId: compactString(payload.campaignId),
    segmentId: compactString(payload.segmentId),
  };
}

function normalizeRecoveryEvents(runtime = {}) {
  const recovery = runtime.adapterRecovery && typeof runtime.adapterRecovery === 'object'
    ? runtime.adapterRecovery
    : runtime.recovery && typeof runtime.recovery === 'object'
      ? runtime.recovery
      : {};
  const sources = [
    ...(Array.isArray(runtime.recoveryEvents) ? runtime.recoveryEvents : []),
    ...(Array.isArray(runtime.handoffRecoveryEvents) ? runtime.handoffRecoveryEvents : []),
    ...(Array.isArray(recovery.events) ? recovery.events : []),
    ...(Array.isArray(recovery.commands) ? recovery.commands : []),
  ];

  return sources.map((event, index) => {
    const source = event && typeof event === 'object' ? event : {};
    const state = normalizeState(source.state || source.status || source.outcome || source.commandState, 'observed');
    const requestId = compactString(source.requestId || source.rollbackRequestId || source.manifestRequestId);
    const idempotencyKey = compactString(source.idempotencyKey || source.key || source.rollbackIdempotencyKey);
    return {
      index,
      eventId: compactString(source.eventId || source.commandId || source.id || `recovery-event:${index}`),
      requestId,
      idempotencyKey,
      externalRequestId: compactString(source.externalRequestId || source.providerRequestId || source.handoffRequestId),
      action: compactString(source.action || source.type || source.capability),
      state,
      terminal: source.terminal === true || RECOVERY_TERMINAL_STATES.includes(state),
      retryable: source.retryable === true || RECOVERY_RETRYABLE_STATES.includes(state),
      leaseState: normalizeState(source.leaseState || source.lease || source.providerLeaseState, ''),
      observedAt: compactString(source.observedAt || source.at || source.time || source.timestamp),
      message: compactString(source.message || source.reason),
    };
  }).filter((event) => event.eventId || event.requestId || event.idempotencyKey || event.externalRequestId);
}

function eventMatchesRollback(event, rollbackRequestId, rollbackIdempotencyKey, providerRequestId) {
  return Boolean(
    (rollbackRequestId && event.requestId === rollbackRequestId)
      || (rollbackIdempotencyKey && event.idempotencyKey === rollbackIdempotencyKey)
      || (providerRequestId && event.externalRequestId === providerRequestId),
  );
}

function rollbackCapabilityFor(action) {
  const inverse = REVERSIBLE_ACTIONS[action];
  return inverse ? `mailchimp.${inverse}` : null;
}

function normalizeAcceptance(input = {}) {
  const acceptedBy = compactString(input.acceptedBy || input.operator || input.user);
  const acceptedAt = compactString(input.acceptedAt || input.time || input.timestamp);
  const reason = compactString(input.reason || input.message);
  return {
    accepted: input.accepted === true || Boolean(acceptedBy && acceptedAt),
    acceptedBy,
    acceptedAt,
    reason,
  };
}

function normalizeStringList(value) {
  const values = Array.isArray(value)
    ? value
    : compactString(value)
      ? compactString(value).split(',')
      : [];
  return [...new Set(values.map((item) => compactString(item)).filter(Boolean))].sort();
}

function permissionAllows(granted, required) {
  if (!required) return true;
  if (granted.includes('*') || granted.includes(required)) return true;
  return granted.some((permission) => {
    if (!permission.endsWith('*')) return false;
    const prefix = permission.slice(0, -1);
    return required.startsWith(prefix);
  });
}

function normalizePermissionSource(runtime = {}) {
  const source = runtime.tenantBoundary && typeof runtime.tenantBoundary === 'object'
    ? runtime.tenantBoundary
    : runtime.permissionBoundary && typeof runtime.permissionBoundary === 'object'
      ? runtime.permissionBoundary
      : runtime.accessContext && typeof runtime.accessContext === 'object'
        ? runtime.accessContext
        : runtime.authz && typeof runtime.authz === 'object'
          ? runtime.authz
          : {};
  const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
  const grant = source.grant && typeof source.grant === 'object' ? source.grant : {};
  const scope = source.scope && typeof source.scope === 'object' ? source.scope : {};

  return {
    actorId: compactString(source.actorId || actor.id || actor.actorId || runtime.actorId || runtime.operatorId),
    actorType: normalizeState(source.actorType || actor.type || runtime.actorType || 'operator', 'operator'),
    roles: normalizeStringList(source.roles || actor.roles || grant.roles || runtime.roles),
    permissions: normalizeStringList(source.permissions || grant.permissions || runtime.permissions),
    tenant: compactString(source.tenant || source.tenantId || scope.tenant || scope.tenantId || runtime.tenant || runtime.tenantId),
    workspace: compactString(source.workspace || source.workspaceId || scope.workspace || scope.workspaceId || runtime.workspace || runtime.workspaceId),
    source: compactString(source.source || grant.source || runtime.permissionSource || 'runtime'),
    evaluatedAt: compactString(source.evaluatedAt || source.at || runtime.permissionEvaluatedAt),
    policyVersion: compactString(source.policyVersion || grant.policyVersion || runtime.permissionPolicyVersion || '1'),
  };
}

function descriptorWorkspace(descriptor) {
  return compactString(
    descriptor.workspace
      || descriptor.workspaceId
      || descriptor.payload?.workspace
      || descriptor.payload?.workspaceId
      || descriptor.payload?.audienceId,
  );
}

function buildRequiredRollbackPermissions(descriptor, inverseCapability) {
  return [
    'mailchimp.rollback',
    'external.write',
    inverseCapability,
    descriptor.tenant ? `tenant.${descriptor.tenant}.rollback` : '',
    descriptorWorkspace(descriptor) ? `workspace.${descriptorWorkspace(descriptor)}.rollback` : '',
  ].filter(Boolean).sort();
}

function buildTenantPermissionBoundary(descriptor, inverseAction, runtime = {}) {
  const source = normalizePermissionSource(runtime);
  const inverseCapability = rollbackCapabilityFor(descriptor.action);
  const tenant = compactString(descriptor.tenant);
  const workspace = descriptorWorkspace(descriptor);
  const requiredPermissions = buildRequiredRollbackPermissions(descriptor, inverseCapability);
  const missingPermissions = requiredPermissions.filter((permission) => !permissionAllows(source.permissions, permission));
  const tenantMatches = Boolean(!tenant || !source.tenant || source.tenant === tenant);
  const workspaceMatches = Boolean(!workspace || !source.workspace || source.workspace === workspace);
  const actorPresent = Boolean(source.actorId);
  const privilegedRole = source.roles.some((role) => ['admin', 'owner', 'mailchimp_admin', 'rollback_operator'].includes(role));
  const permissionSatisfied = missingPermissions.length === 0 || privilegedRole;
  const allowed = Boolean(
    actorPresent
      && tenantMatches
      && workspaceMatches
      && permissionSatisfied
      && inverseAction,
  );
  const auditScope = [
    tenant ? `tenant:${tenant}` : '',
    workspace ? `workspace:${workspace}` : '',
    source.actorId ? `actor:${source.actorId}` : '',
  ].filter(Boolean).join('|');
  const validation = [
    {
      code: 'mailchimp.rollback.boundary.actor',
      ok: actorPresent,
      severity: actorPresent ? 'info' : 'error',
      message: actorPresent
        ? 'Rollback request is bound to an authenticated operator actor.'
        : 'Rollback request requires an authenticated operator actor for tenant audit.',
    },
    {
      code: 'mailchimp.rollback.boundary.tenant',
      ok: tenantMatches,
      severity: tenantMatches ? 'info' : 'error',
      message: tenantMatches
        ? 'Rollback tenant scope matches the runtime permission context.'
        : 'Rollback tenant scope does not match the runtime permission context.',
    },
    {
      code: 'mailchimp.rollback.boundary.workspace',
      ok: workspaceMatches,
      severity: workspaceMatches ? 'info' : 'error',
      message: workspaceMatches
        ? 'Rollback workspace scope matches the runtime permission context.'
        : 'Rollback workspace scope does not match the runtime permission context.',
    },
    {
      code: 'mailchimp.rollback.boundary.permissions',
      ok: permissionSatisfied,
      severity: permissionSatisfied ? 'info' : 'error',
      message: permissionSatisfied
        ? 'Runtime permissions authorize the rollback capability inside the scoped tenant boundary.'
        : `Runtime permissions are missing: ${missingPermissions.join(', ') || 'mailchimp rollback permission'}.`,
    },
  ];

  return {
    protocol: 'aios.rollback-tenant-permission-boundary.mailchimp.v1',
    allowed,
    source: source.source,
    policyVersion: source.policyVersion,
    evaluatedAt: source.evaluatedAt,
    actor: {
      id: source.actorId,
      type: source.actorType,
      roles: source.roles,
    },
    scope: {
      tenant,
      runtimeTenant: source.tenant,
      tenantMatches,
      workspace,
      runtimeWorkspace: source.workspace,
      workspaceMatches,
    },
    permissions: {
      required: requiredPermissions,
      granted: source.permissions,
      missing: missingPermissions,
      privilegedRole,
    },
    audit: {
      auditRef: auditScope ? `rollback.permission.${auditScope}` : '',
      handoffRequired: allowed,
      reason: allowed ? 'permission_boundary_satisfied' : 'permission_boundary_blocked',
    },
    validation,
    blockers: validation.filter((item) => item.severity === 'error').map((item) => item.code),
    nextAction: allowed ? 'continue_rollback_readiness' : 'resolve_tenant_permission_boundary',
  };
}

export function buildMailchimpRollbackTenantPermissionBoundary(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  return buildTenantPermissionBoundary(descriptor, REVERSIBLE_ACTIONS[descriptor.action] || null, runtime);
}

function buildRollbackPreview(descriptor, assessment, exportSummary) {
  const inverseCapability = rollbackCapabilityFor(descriptor.action);
  const lifecycleControls = assessment.lifecycleControls || {};
  const componentReadiness = assessment.componentReadiness || {};
  const validation = [
    {
      code: 'mailchimp.rollback.inverse_action',
      ok: Boolean(assessment.inverseAction),
      severity: assessment.inverseAction ? 'info' : 'warning',
      message: assessment.inverseAction
        ? `Rollback will issue "${assessment.inverseAction}".`
        : 'No deterministic inverse Mailchimp action is available.',
    },
    {
      code: 'mailchimp.rollback.original_idempotency',
      ok: Boolean(descriptor.idempotencyKey),
      severity: descriptor.idempotencyKey ? 'info' : 'error',
      message: descriptor.idempotencyKey
        ? 'Original idempotency key is present for audit binding.'
        : 'Original idempotency key is required before rollback.',
    },
    {
      code: 'mailchimp.rollback.truth_boundary',
      ok: descriptor.truthBoundary?.externalWritesAllowed === true,
      severity: descriptor.truthBoundary?.externalWritesAllowed === true ? 'info' : 'error',
      message: descriptor.truthBoundary?.externalWritesAllowed === true
        ? 'Truth boundary permits the rollback handoff to request an external write.'
        : 'Truth boundary blocks rollback from requesting an external write.',
    },
    {
      code: 'mailchimp.rollback.tenant_permission_boundary',
      ok: assessment.permissionBoundary?.allowed === true,
      severity: assessment.permissionBoundary?.allowed === true ? 'info' : 'error',
      message: assessment.permissionBoundary?.allowed === true
        ? 'Tenant permission boundary authorizes this rollback handoff.'
        : 'Tenant permission boundary blocks this rollback handoff.',
    },
    {
      code: 'mailchimp.rollback.history_export',
      ok: exportSummary.exportReady === true,
      severity: exportSummary.exportReady === true ? 'info' : 'warning',
      message: exportSummary.exportReady === true
        ? 'Local history export is ready for rollback review.'
        : 'Local history export has blockers that should be reviewed before rollback.',
    },
    {
      code: 'mailchimp.rollback.lifecycle_controls',
      ok: lifecycleControls.canProceed === true,
      severity: lifecycleControls.canProceed === true ? 'info' : 'error',
      message: lifecycleControls.canProceed === true
        ? 'Lifecycle controls permit rollback queueing.'
        : `Lifecycle controls hold rollback queueing at "${lifecycleControls.holdState || 'unknown'}".`,
    },
    {
      code: 'mailchimp.rollback.provider_contract',
      ok: assessment.providerContract?.ready === true,
      severity: assessment.providerContract?.ready === true ? 'info' : 'error',
      message: assessment.providerContract?.ready === true
        ? 'Mailchimp provider service contract is ready for rollback queueing.'
        : `Mailchimp provider service contract requires "${assessment.providerContract?.nextAction || 'refresh_provider_before_rollback'}".`,
    },
    {
      code: 'mailchimp.rollback.component_readiness',
      ok: componentReadiness.ready !== false,
      severity: componentReadiness.ready !== false ? 'info' : componentReadiness.status === 'waiting' ? 'warning' : 'error',
      message: componentReadiness.ready !== false
        ? componentReadiness.supplied
          ? 'Runtime component readiness packets are ready for rollback aggregation.'
          : 'No runtime component readiness packets were supplied; rollback preview will rely on base runtime health.'
        : `Runtime component "${componentReadiness.primaryComponent || 'unknown'}" requires "${componentReadiness.nextAction || 'continue_rollback_readiness'}".`,
    },
  ];
  const previewValidation = validation.filter((item) => item.code !== 'mailchimp.rollback.lifecycle_controls');
  const previewReady = Boolean(
    (assessment.baseRollbackReady ?? assessment.canRollback)
      && previewValidation.every((item) => item.severity !== 'error'),
  );

  return {
    title: `Mailchimp rollback preview for ${descriptor.action || 'unknown action'}`,
    originalAction: descriptor.action,
    inverseAction: assessment.inverseAction,
    payload: safePayload(descriptor.payload),
    tenantBoundary: {
      allowed: assessment.permissionBoundary?.allowed === true,
      tenant: assessment.permissionBoundary?.scope?.tenant || descriptor.tenant || '',
      workspace: assessment.permissionBoundary?.scope?.workspace || '',
      actorId: assessment.permissionBoundary?.actor?.id || '',
      auditRef: assessment.permissionBoundary?.audit?.auditRef || '',
    },
    capabilityDelta: {
      remove: [`mailchimp.${descriptor.action || 'unknown'}`],
      add: inverseCapability ? [inverseCapability] : [],
      externalWrite: assessment.canRollback,
    },
    componentReadiness: {
      supplied: componentReadiness.supplied === true,
      status: componentReadiness.status || 'not_supplied',
      ready: componentReadiness.ready !== false,
      nextAction: componentReadiness.nextAction || 'continue_rollback_readiness',
      primaryComponent: componentReadiness.primaryComponent || '',
      counts: componentReadiness.counts || {},
      blockerCodes: componentReadiness.blockerCodes || [],
      warningCodes: componentReadiness.warningCodes || [],
      operatorHandoffs: componentReadiness.operatorHandoffs || [],
    },
    readiness: {
      ready: previewReady,
      validation,
      blockedReasons: validation.filter((item) => !item.ok).map((item) => item.code),
    },
    nextStep: assessment.canRollback
      ? 'collect_operator_acceptance'
      : 'resolve_rollback_readiness',
  };
}

function buildAcceptanceState(assessment, acceptance = {}) {
  const accepted = normalizeAcceptance(acceptance);
  const required = assessment.canRollback === true;
  const ready = !required || accepted.accepted;
  return {
    required,
    ready,
    accepted: accepted.accepted,
    acceptedBy: accepted.acceptedBy,
    acceptedAt: accepted.acceptedAt,
    reason: accepted.reason,
    nextAction: ready
      ? assessment.canRollback
        ? 'queue_rollback_manifest'
        : 'keep_rollback_blocked'
      : 'request_operator_acceptance',
  };
}

function normalizeProviderContractSource(status = {}, runtime = {}) {
  const runtimeSource = runtime.providerContract && typeof runtime.providerContract === 'object'
    ? runtime.providerContract
    : runtime.mailchimpProvider && typeof runtime.mailchimpProvider === 'object'
      ? runtime.mailchimpProvider
      : runtime.adapterProvider && typeof runtime.adapterProvider === 'object'
        ? runtime.adapterProvider
        : {};
  const statusSource = status.providerContract && typeof status.providerContract === 'object'
    ? status.providerContract
    : {};
  const runtimeSync = runtimeSource.sync && typeof runtimeSource.sync === 'object' ? runtimeSource.sync : {};
  const statusSync = statusSource.sync && typeof statusSource.sync === 'object' ? statusSource.sync : {};
  const runtimeLease = runtimeSource.lease && typeof runtimeSource.lease === 'object' ? runtimeSource.lease : {};
  const statusLease = statusSource.lease && typeof statusSource.lease === 'object' ? statusSource.lease : {};
  const runtimeHandoff = runtimeSource.externalHandoff && typeof runtimeSource.externalHandoff === 'object'
    ? runtimeSource.externalHandoff
    : runtime.externalHandoff && typeof runtime.externalHandoff === 'object'
      ? runtime.externalHandoff
      : {};
  const statusHandoff = status.externalHandoff && typeof status.externalHandoff === 'object'
    ? status.externalHandoff
    : statusSource.externalHandoff && typeof statusSource.externalHandoff === 'object'
      ? statusSource.externalHandoff
      : {};

  return {
    source: {
      provider: compactString(runtimeSource.provider || statusSource.provider || 'mailchimp'),
      service: compactString(runtimeSource.service || statusSource.service || 'marketing'),
      version: compactString(runtimeSource.version || statusSource.version || runtimeSource.apiVersion || statusSource.apiVersion || 'unknown'),
      serviceState: normalizeState(runtimeSource.serviceState || statusSource.serviceState || status.serviceState, 'unknown'),
      observedAt: compactString(runtimeSource.observedAt || statusSource.observedAt || status.observedAt),
    },
    sync: {
      ...statusSync,
      ...runtimeSync,
    },
    lease: {
      ...statusLease,
      ...runtimeLease,
    },
    handoff: {
      ...statusHandoff,
      ...runtimeHandoff,
    },
    capabilities: [
      ...normalizeStringList(statusSource.capabilities || statusSource.offeredCapabilities),
      ...normalizeStringList(runtimeSource.capabilities || runtimeSource.offeredCapabilities || runtime.mailchimpCapabilities),
    ],
  };
}

function buildRollbackProviderServiceContract(descriptor, status, inverseAction, runtime = {}) {
  const source = normalizeProviderContractSource(status, runtime);
  const requiredCapabilities = [
    'external.write',
    'adapter.mailchimp',
    ...(inverseAction ? [`mailchimp.${inverseAction}`] : []),
    ...(MAILCHIMP_ROLLBACK_PROVIDER_CAPABILITIES[inverseAction] || []),
  ].filter(Boolean).sort();
  const offeredCapabilities = [...new Set(source.capabilities)].sort();
  const missingCapabilities = requiredCapabilities.filter((capability) => !permissionAllows(offeredCapabilities, capability));
  const syncState = normalizeState(source.sync.state || source.sync.status || (source.sync.ready === true ? 'ready' : ''), 'unknown');
  const syncCursor = compactString(source.sync.cursor || source.sync.cursorId || source.sync.etag || source.sync.checkpoint);
  const syncObservedAt = compactString(source.sync.observedAt || source.sync.syncedAt || source.sync.updatedAt || source.source.observedAt);
  const syncMaxAgeMs = clampInteger(source.sync.maxAgeMs ?? source.sync.freshnessMs ?? runtime.providerSyncMaxAgeMs, 0, 86400000);
  const nowMs = timestampMs(runtime.now || runtime.observedAt || runtime.reportGeneratedAt);
  const observedMs = timestampMs(syncObservedAt);
  const syncAgeMs = Number.isFinite(nowMs) && Number.isFinite(observedMs)
    ? Math.max(0, nowMs - observedMs)
    : 0;
  const syncStale = source.sync.stale === true
    || syncState === 'stale'
    || (syncMaxAgeMs > 0 && Number.isFinite(nowMs) && Number.isFinite(observedMs) && syncAgeMs > syncMaxAgeMs);
  const syncReady = source.sync.ready !== false && Boolean(syncCursor || syncState === 'ready') && syncStale === false;
  const leaseState = normalizeState(source.lease.state || source.lease.status || source.handoff.leaseState, 'unknown');
  const leaseExpiresAt = compactString(source.lease.expiresAt || source.lease.expiry || source.handoff.leaseExpiresAt);
  const leaseExpiredByTime = Number.isFinite(timestampMs(leaseExpiresAt))
    && Number.isFinite(nowMs)
    && nowMs > timestampMs(leaseExpiresAt);
  const effectiveLeaseState = leaseExpiredByTime ? 'expired' : leaseState;
  const serviceState = normalizeState(source.source.serviceState, 'unknown');
  const serviceOnline = !['offline', 'disabled', 'blocked'].includes(serviceState);
  const handoffState = normalizeState(source.handoff.state || source.handoff.status || status.externalHandoff?.state, 'local_only');
  const externalRequestId = compactString(source.handoff.requestId || source.handoff.externalRequestId || status.externalHandoff?.requestId);
  const handoffReady = Boolean(externalRequestId)
    && !['blocked', 'failed'].includes(handoffState)
    && !['expired', 'missing_token'].includes(effectiveLeaseState);
  const negotiationSatisfied = missingCapabilities.length === 0 && Boolean(inverseAction);
  const validation = [
    createOperationalSignal(
      'mailchimp.rollback.provider.service_online',
      serviceOnline,
      serviceOnline ? 'info' : 'error',
      serviceOnline
        ? `Mailchimp provider service "${source.source.service}" is available for rollback handoff.`
        : `Mailchimp provider service "${source.source.service}" is "${serviceState}".`,
      {
        field: 'providerContract.serviceState',
        owner: 'adapter',
        action: serviceOnline ? 'continue_rollback_readiness' : 'restore_mailchimp_provider_service',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.provider.capability_negotiation',
      negotiationSatisfied,
      negotiationSatisfied ? 'info' : 'error',
      negotiationSatisfied
        ? 'Mailchimp provider offered every capability required by the rollback inverse action.'
        : `Mailchimp provider is missing rollback capabilities: ${missingCapabilities.join(', ') || 'inverse action'}.`,
      {
        field: 'providerContract.capabilities',
        owner: 'adapter',
        action: 'negotiate_mailchimp_provider_capabilities',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.provider.sync_freshness',
      syncReady,
      syncReady ? 'info' : syncStale ? 'warning' : 'error',
      syncReady
        ? 'Mailchimp provider sync metadata is fresh enough for rollback queueing.'
        : syncStale
          ? 'Mailchimp provider sync metadata is stale and must be refreshed before rollback queueing.'
          : 'Mailchimp provider sync metadata is missing a cursor or ready state.',
      {
        field: 'providerContract.sync',
        owner: 'adapter',
        action: 'refresh_provider_before_rollback',
        retryable: syncStale || syncState === 'unknown',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.provider.external_handoff',
      handoffReady,
      handoffReady ? 'info' : effectiveLeaseState === 'missing_token' ? 'error' : 'warning',
      handoffReady
        ? 'Mailchimp external handoff request and lease are bound for rollback recovery.'
        : effectiveLeaseState === 'missing_token'
          ? 'Mailchimp provider token is missing for the external rollback handoff.'
          : 'Mailchimp external handoff needs a request id or fresh lease before rollback recovery.',
      {
        field: 'providerContract.externalHandoff',
        owner: effectiveLeaseState === 'missing_token' ? 'operator' : 'adapter',
        action: effectiveLeaseState === 'missing_token' ? 'reauthorize_mailchimp_provider' : 'refresh_provider_before_rollback',
        retryable: effectiveLeaseState !== 'missing_token',
      },
    ),
  ];
  const blockers = validation.filter((item) => item.ok === false && item.severity === 'error').map((item) => item.code);
  const warnings = validation.filter((item) => item.ok === false && item.severity === 'warning').map((item) => item.code);
  const ready = blockers.length === 0 && warnings.length === 0;

  return {
    protocol: 'aios.rollback-provider-service-contract.mailchimp.v1',
    provider: source.source.provider,
    service: source.source.service,
    version: source.source.version,
    serviceState,
    ready,
    capabilityNegotiation: {
      required: requiredCapabilities,
      offered: offeredCapabilities,
      missing: missingCapabilities,
      satisfied: negotiationSatisfied,
    },
    sync: {
      state: syncState,
      ready: syncReady,
      stale: syncStale,
      cursor: syncCursor,
      observedAt: syncObservedAt,
      maxAgeMs: syncMaxAgeMs,
      ageMs: syncAgeMs,
      requestId: compactString(source.sync.requestId || source.sync.providerRequestId),
    },
    lease: {
      state: effectiveLeaseState,
      expiresAt: leaseExpiresAt,
      refreshAfter: compactString(source.lease.refreshAfter || source.handoff.refreshAfter),
    },
    externalHandoff: {
      state: handoffState,
      requestId: externalRequestId,
      leaseState: effectiveLeaseState,
      writeMode: descriptor.dryRun ? 'dry_run' : 'external_write',
      statusRef: compactString(source.handoff.statusRef || status.progress?.latestCode),
    },
    validation,
    blockers,
    warnings,
    nextAction: ready
      ? 'continue_rollback_readiness'
      : blockers.includes('mailchimp.rollback.provider.service_online')
        ? 'restore_mailchimp_provider_service'
        : blockers.includes('mailchimp.rollback.provider.capability_negotiation')
          ? 'negotiate_mailchimp_provider_capabilities'
          : effectiveLeaseState === 'missing_token'
            ? 'reauthorize_mailchimp_provider'
            : 'refresh_provider_before_rollback',
  };
}

function normalizeClientState(runtime = {}) {
  const source = runtime.clientState && typeof runtime.clientState === 'object'
    ? runtime.clientState
    : runtime.requestState && typeof runtime.requestState === 'object'
      ? runtime.requestState
      : {};
  return {
    clientRequestId: compactString(source.clientRequestId || source.requestId || runtime.clientRequestId),
    route: compactString(source.route || runtime.route),
    sessionId: compactString(source.sessionId || runtime.sessionId),
    adoptionMode: compactString(source.adoptionMode || runtime.adoptionMode || 'preview_first'),
    lastRenderedAt: compactString(source.lastRenderedAt || runtime.lastRenderedAt),
    acknowledgedPreview: source.acknowledgedPreview === true || runtime.acknowledgedPreview === true,
  };
}

function normalizeWorkflowIntent(runtime = {}) {
  const source = runtime.workflowIntent && typeof runtime.workflowIntent === 'object'
    ? runtime.workflowIntent
    : runtime.uiState && typeof runtime.uiState === 'object'
      ? runtime.uiState
      : {};
  const requestedAction = normalizeState(source.requestedAction || source.action || runtime.requestedRollbackAction, '');
  const activeStep = normalizeState(source.activeStep || source.step || runtime.activeRollbackStep, '');
  const dismissedBlockers = Array.isArray(source.dismissedBlockers)
    ? source.dismissedBlockers.map((item) => normalizeState(item, '')).filter(Boolean)
    : [];

  return {
    requestedAction,
    activeStep,
    operatorVisible: source.operatorVisible !== false && runtime.operatorVisible !== false,
    dismissedBlockers,
    lastClientMutationId: compactString(source.lastClientMutationId || runtime.lastClientMutationId),
  };
}

function createWorkflowStep(id, label, state, detail = {}) {
  return {
    id,
    label,
    state,
    current: state === 'current',
    terminal: state === 'done' || state === 'blocked',
    ...detail,
  };
}

function buildRollbackWorkflowHandoff(status, assessment, acceptance, runtime = {}) {
  const clientState = normalizeClientState(runtime);
  const workflowIntent = normalizeWorkflowIntent(runtime);
  const persistence = assessment.persistence || {};
  const recovery = assessment.recovery || {};
  const permissionBoundary = assessment.permissionBoundary || {};
  const lifecycleControls = assessment.lifecycleControls || {};
  const providerContract = assessment.providerContract || status.providerContract || {};
  const componentReadiness = assessment.componentReadiness || {};
  const providerLeaseState = normalizeState(
    providerContract.externalHandoff?.leaseState
      || providerContract.lease?.state
      || status.externalHandoff?.leaseState
      || status.providerContract?.lease?.state,
    'unknown',
  );
  const providerReady = providerContract.ready === true
    && providerContract.capabilityNegotiation?.satisfied !== false
    && providerContract.sync?.ready !== false
    && providerContract.sync?.stale !== true
    && providerContract.serviceState !== 'offline'
    && !['expired', 'missing_token'].includes(providerLeaseState);
  const previewReady = assessment.preview?.readiness?.ready === true;
  const previewAcknowledged = clientState.acknowledgedPreview === true;
  const lifecycleReady = lifecycleControls.canProceed === true;
  const boundaryReady = permissionBoundary.allowed === true;
  const acceptanceReady = acceptance.required !== true || acceptance.ready === true;
  const persistenceReady = persistence.command?.canEnqueue === true || Boolean(persistence.command?.replayOf);
  const recoveryReady = recovery.ready === true || recovery.resumeMode === 'refresh_then_resume';
  const componentsReady = componentReadiness.ready !== false;
  const commandQueued = ['pending_enqueue', 'queued', 'running'].includes(persistence.command?.state);
  const terminalSuccess = recovery.terminal === true && RECOVERY_SUCCESS_STATES.includes(recovery.latestState);

  const stageStates = {
    preview: previewReady && previewAcknowledged ? 'done' : 'pending',
    lifecycle: lifecycleReady ? 'done' : 'pending',
    boundary: boundaryReady ? 'done' : 'pending',
    acceptance: acceptanceReady ? 'done' : 'pending',
    provider: providerReady ? 'done' : 'pending',
    components: componentsReady ? 'done' : 'pending',
    recovery: recoveryReady ? 'done' : 'pending',
    queue: persistenceReady ? 'done' : 'pending',
    observe: terminalSuccess ? 'done' : commandQueued || persistence.command?.replayOf ? 'current' : 'pending',
  };

  if (assessment.baseRollbackReady === false) {
    stageStates.preview = 'blocked';
  } else if (!previewReady || !previewAcknowledged) {
    stageStates.preview = 'current';
  } else if (!lifecycleReady) {
    stageStates.lifecycle = 'current';
  } else if (!boundaryReady) {
    stageStates.boundary = 'current';
  } else if (!acceptanceReady) {
    stageStates.acceptance = 'current';
  } else if (!providerReady) {
    stageStates.provider = 'current';
  } else if (!componentsReady) {
    stageStates.components = 'current';
  } else if (!recoveryReady) {
    stageStates.recovery = 'current';
  } else if (!persistenceReady) {
    stageStates.queue = 'current';
  } else if (!terminalSuccess) {
    stageStates.observe = commandQueued || persistence.command?.replayOf ? 'current' : 'pending';
  }

  const steps = [
    createWorkflowStep('preview', 'Review rollback preview', stageStates.preview, {
      action: 'present_rollback_preview',
      visible: workflowIntent.operatorVisible,
      acknowledged: previewAcknowledged,
      validationCodes: assessment.preview?.readiness?.validation?.map((item) => item.code) || [],
    }),
    createWorkflowStep('lifecycle', 'Apply lifecycle controls', stageStates.lifecycle, {
      action: lifecycleControls.nextAction || 'continue_rollback_readiness',
      enabled: lifecycleControls.enabled === true,
      holdState: lifecycleControls.holdState || 'unknown',
      requestedCommand: lifecycleControls.controls?.requestedCommand || '',
      scheduleMode: lifecycleControls.schedule?.mode || 'immediate',
      scheduleWindowState: lifecycleControls.schedule?.windowState || 'inside_window',
      blockers: lifecycleControls.blockers || [],
      warnings: lifecycleControls.warnings || [],
    }),
    createWorkflowStep('boundary', 'Verify tenant permission boundary', stageStates.boundary, {
      action: 'resolve_tenant_permission_boundary',
      tenant: permissionBoundary.scope?.tenant || '',
      workspace: permissionBoundary.scope?.workspace || '',
      actorId: permissionBoundary.actor?.id || '',
      auditRef: permissionBoundary.audit?.auditRef || '',
      blockers: permissionBoundary.blockers || [],
    }),
    createWorkflowStep('acceptance', 'Capture operator acceptance', stageStates.acceptance, {
      action: 'request_operator_acceptance',
      acceptedBy: acceptance.acceptedBy || '',
      acceptedAt: acceptance.acceptedAt || '',
      required: acceptance.required === true,
    }),
    createWorkflowStep('provider', 'Refresh provider handoff', stageStates.provider, {
      action: providerContract.nextAction || 'refresh_provider_before_rollback',
      leaseState: providerLeaseState,
      providerState: providerContract.serviceState || status.providerContract?.serviceState || 'unknown',
      externalRequestId: providerContract.externalHandoff?.requestId || status.externalHandoff?.requestId || '',
      missingCapabilities: providerContract.capabilityNegotiation?.missing || [],
      syncCursor: providerContract.sync?.cursor || '',
      syncStale: providerContract.sync?.stale === true,
    }),
    createWorkflowStep('components', 'Review runtime component readiness', stageStates.components, {
      action: componentReadiness.nextAction || 'continue_rollback_readiness',
      supplied: componentReadiness.supplied === true,
      status: componentReadiness.status || 'not_supplied',
      primaryComponent: componentReadiness.primaryComponent || '',
      primaryComponentType: componentReadiness.primaryComponentType || '',
      counts: componentReadiness.counts || {},
      blockers: componentReadiness.blockerCodes || [],
      warnings: componentReadiness.warningCodes || [],
      operatorHandoffs: componentReadiness.operatorHandoffs || [],
    }),
    createWorkflowStep('recovery', 'Bind recovery checkpoint', stageStates.recovery, {
      action: recovery.nextAction || 'inspect_rollback_recovery',
      resumeMode: recovery.resumeMode || 'untracked',
      latestState: recovery.latestState || 'unknown',
      retryable: recovery.retryable === true,
    }),
    createWorkflowStep('queue', 'Queue rollback manifest', stageStates.queue, {
      action: persistence.command?.replayOf ? 'surface_existing_rollback_command' : 'queue_rollback_manifest',
      commandId: persistence.command?.commandId || '',
      commandState: persistence.command?.state || 'untracked',
      replayOf: persistence.command?.replayOf || '',
    }),
    createWorkflowStep('observe', 'Observe rollback outcome', stageStates.observe, {
      action: terminalSuccess ? 'archive_rollback_audit' : 'observe_rollback_command',
      terminal: recovery.terminal === true,
      latestState: recovery.latestState || 'unknown',
      checkpointEventId: recovery.checkpoint?.latestEventId || '',
    }),
  ];
  const currentStep = steps.find((step) => step.current)
    || [...steps].reverse().find((step) => step.state === 'done')
    || steps[0];
  const hardBlockers = [
    ...(assessment.baseRollbackReady === true ? [] : ['rollback_not_ready']),
    ...(previewReady ? [] : ['preview_validation_not_ready']),
    ...(previewAcknowledged ? [] : ['preview_acknowledgement_required']),
    ...(lifecycleReady ? [] : ['lifecycle_controls_not_ready']),
    ...(boundaryReady ? [] : ['tenant_permission_boundary_required']),
    ...(acceptanceReady ? [] : ['operator_acceptance_required']),
    ...(providerReady ? [] : ['provider_contract_not_ready']),
    ...(componentsReady ? [] : ['runtime_component_readiness_not_ready']),
    ...(recoveryReady ? [] : ['recovery_checkpoint_not_ready']),
    ...(persistenceReady ? [] : ['rollback_command_not_ready']),
  ].filter((blocker) => !workflowIntent.dismissedBlockers.includes(blocker));
  const clientMutation = {
    id: workflowIntent.lastClientMutationId || `${clientState.clientRequestId || assessment.requestId || 'rollback'}:${currentStep.id}`,
    requestedAction: workflowIntent.requestedAction || currentStep.action,
    activeStep: workflowIntent.activeStep || currentStep.id,
    accepted: hardBlockers.length === 0 && currentStep.state !== 'blocked',
  };

  return {
    protocol: 'aios.rollback-workflow-handoff.mailchimp.v1',
    clientRequestId: clientState.clientRequestId,
    route: clientState.route,
    sessionId: clientState.sessionId,
    adoptionMode: clientState.adoptionMode,
    currentStepId: currentStep.id,
    currentAction: currentStep.action,
    readyForQueue: assessment.canRollback === true
      && previewReady
      && previewAcknowledged
      && lifecycleReady
      && boundaryReady
      && acceptanceReady
      && providerReady
      && componentsReady
      && recoveryReady
      && persistenceReady,
    retryable: recovery.retryable === true || providerLeaseState === 'expired',
    operatorVisible: workflowIntent.operatorVisible,
    blockers: hardBlockers,
    clientMutation,
    steps,
  };
}

function normalizeRollbackLedger(runtime = {}) {
  const source = runtime.rollbackState && typeof runtime.rollbackState === 'object'
    ? runtime.rollbackState
    : runtime.persistedRollback && typeof runtime.persistedRollback === 'object'
      ? runtime.persistedRollback
      : {};
  const commands = Array.isArray(source.commands)
    ? source.commands
    : Array.isArray(runtime.rollbackCommands)
      ? runtime.rollbackCommands
      : [];
  const normalizedCommands = commands.map((command, index) => ({
    index,
    commandId: compactString(command?.commandId || command?.id || `rollback-command:${index}`),
    idempotencyKey: compactString(command?.idempotencyKey || command?.key),
    requestId: compactString(command?.requestId || command?.rollbackRequestId),
    action: compactString(command?.action || command?.type || 'rollback'),
    state: compactString(command?.state || command?.status || 'observed').toLowerCase().replaceAll('-', '_'),
    at: compactString(command?.at || command?.time || command?.timestamp),
  })).filter((command) => command.commandId || command.idempotencyKey || command.requestId);

  return {
    store: compactString(source.store || runtime.rollbackStore || 'local-runtime'),
    version: compactString(source.version || runtime.rollbackStateVersion || '1'),
    loadedAt: compactString(source.loadedAt || runtime.rollbackStateLoadedAt),
    commands: normalizedCommands,
  };
}

function normalizePersistedCheckpoint(runtime = {}) {
  const source = runtime.rollbackState && typeof runtime.rollbackState === 'object'
    ? runtime.rollbackState
    : runtime.persistedRollback && typeof runtime.persistedRollback === 'object'
      ? runtime.persistedRollback
      : {};
  const checkpoint = source.checkpoint && typeof source.checkpoint === 'object'
    ? source.checkpoint
    : runtime.rollbackCheckpoint && typeof runtime.rollbackCheckpoint === 'object'
      ? runtime.rollbackCheckpoint
      : {};
  const status = checkpoint.status && typeof checkpoint.status === 'object'
    ? checkpoint.status
    : source.status && typeof source.status === 'object'
      ? source.status
      : {};
  const handoff = checkpoint.handoff && typeof checkpoint.handoff === 'object'
    ? checkpoint.handoff
    : source.handoff && typeof source.handoff === 'object'
      ? source.handoff
      : {};

  return {
    checkpointId: compactString(checkpoint.checkpointId || checkpoint.id || source.checkpointId),
    epoch: compactString(checkpoint.epoch || source.epoch || runtime.rollbackEpoch),
    schemaVersion: compactString(checkpoint.schemaVersion || source.schemaVersion || '1'),
    savedAt: compactString(checkpoint.savedAt || checkpoint.at || source.savedAt || runtime.rollbackStateSavedAt),
    statusState: normalizeState(status.state || checkpoint.statusState || source.statusState, ''),
    statusTerminal: status.terminal === true || checkpoint.statusTerminal === true || source.statusTerminal === true,
    statusObservedAt: compactString(status.observedAt || checkpoint.statusObservedAt || source.statusObservedAt),
    handoffState: normalizeState(handoff.state || checkpoint.handoffState || source.handoffState, ''),
    handoffRequestId: compactString(handoff.requestId || checkpoint.handoffRequestId || source.handoffRequestId),
    handoffLeaseState: normalizeState(handoff.leaseState || checkpoint.handoffLeaseState || source.handoffLeaseState, ''),
    commandId: compactString(checkpoint.commandId || source.commandId),
    commandState: normalizeState(checkpoint.commandState || source.commandState, ''),
    rollbackRequestId: compactString(checkpoint.rollbackRequestId || source.rollbackRequestId),
    rollbackIdempotencyKey: compactString(checkpoint.rollbackIdempotencyKey || source.rollbackIdempotencyKey),
    clientMutationId: compactString(checkpoint.clientMutationId || source.clientMutationId),
  };
}

function commandSortKey(command) {
  return [
    command.at || '9999-12-31T23:59:59.999Z',
    command.index.toString().padStart(6, '0'),
    command.commandId,
  ].join('|');
}

function pickLatestCommand(commands = []) {
  return [...commands].sort((left, right) => commandSortKey(left).localeCompare(commandSortKey(right))).at(-1) || null;
}

function stateRank(state) {
  if (RECOVERY_SUCCESS_STATES.includes(state)) return 5;
  if (['failed', 'blocked'].includes(state)) return 4;
  if (['running', 'queued', 'pending_enqueue'].includes(state)) return 3;
  if (RECOVERY_RETRYABLE_STATES.includes(state)) return 2;
  if (state) return 1;
  return 0;
}

function chooseRestartState(...states) {
  return states
    .map((state) => normalizeState(state, ''))
    .filter(Boolean)
    .sort((left, right) => stateRank(right) - stateRank(left))[0] || 'unknown';
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, normalizeInteger(value, min)));
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeState(value, '');
  if (['true', '1', 'yes', 'enabled', 'enable', 'on', 'allowed'].includes(normalized)) return true;
  if (['false', '0', 'no', 'disabled', 'disable', 'off', 'blocked'].includes(normalized)) return false;
  return fallback;
}

function timestampMs(value) {
  const normalized = compactString(value);
  if (!normalized) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function scheduleWindowState(nowMs, notBeforeMs, notAfterMs) {
  if (Number.isFinite(notBeforeMs) && nowMs < notBeforeMs) return 'waiting_for_window';
  if (Number.isFinite(notAfterMs) && nowMs > notAfterMs) return 'window_expired';
  return 'inside_window';
}

function normalizeRollbackLifecycleCommandList(value, fallback = ROLLBACK_LIFECYCLE_COMMANDS) {
  const requested = normalizeStringList(value);
  const valid = requested.filter((command) => ROLLBACK_LIFECYCLE_COMMANDS.includes(command));
  return valid.length > 0 ? valid : [...fallback];
}

function normalizeRollbackLifecycleSettings(runtime = {}) {
  const source = runtime.rollbackLifecycleSettings && typeof runtime.rollbackLifecycleSettings === 'object'
    ? runtime.rollbackLifecycleSettings
    : runtime.lifecycleSettings && typeof runtime.lifecycleSettings === 'object'
      ? runtime.lifecycleSettings
      : runtime.rollbackControls && typeof runtime.rollbackControls === 'object'
        ? runtime.rollbackControls
        : {};
  const schedule = source.schedule && typeof source.schedule === 'object'
    ? source.schedule
    : runtime.rollbackSchedule && typeof runtime.rollbackSchedule === 'object'
      ? runtime.rollbackSchedule
      : {};
  const controls = source.controls && typeof source.controls === 'object'
    ? source.controls
    : source.commandControls && typeof source.commandControls === 'object'
      ? source.commandControls
      : {};
  const gate = source.manualGate && typeof source.manualGate === 'object'
    ? source.manualGate
    : runtime.rollbackManualGate && typeof runtime.rollbackManualGate === 'object'
      ? runtime.rollbackManualGate
      : {};
  const now = compactString(source.now || schedule.now || runtime.now || runtime.observedAt || runtime.reportGeneratedAt);
  const enabled = normalizeBoolean(source.enabled ?? source.rollbackEnabled ?? runtime.rollbackEnabled, true);
  const disabledReason = compactString(source.disabledReason || source.reason || runtime.rollbackDisabledReason);
  const requestedCommand = normalizeState(
    controls.requestedCommand
      || source.requestedCommand
      || runtime.requestedLifecycleCommand
      || runtime.workflowIntent?.requestedAction,
    '',
  );
  const disabledCommands = normalizeStringList(controls.disabledCommands || source.disabledCommands || runtime.disabledRollbackCommands);
  const allowedCommands = normalizeRollbackLifecycleCommandList(controls.allowedCommands || source.allowedCommands);
  const effectiveAllowedCommands = allowedCommands.filter((command) => !disabledCommands.includes(command));
  const scheduleMode = normalizeState(schedule.mode || source.scheduleMode || source.mode || 'immediate', 'immediate');
  const notBefore = compactString(schedule.notBefore || source.notBefore || runtime.rollbackNotBefore);
  const notAfter = compactString(schedule.notAfter || source.notAfter || runtime.rollbackNotAfter);
  const cooldownUntil = compactString(schedule.cooldownUntil || source.cooldownUntil || runtime.rollbackCooldownUntil);
  const holdReason = compactString(source.holdReason || schedule.holdReason || runtime.rollbackHoldReason);
  const manualGateRequired = normalizeBoolean(
    gate.required ?? source.manualGateRequired ?? runtime.rollbackManualGateRequired,
    false,
  );
  const manualGateReleased = normalizeBoolean(
    gate.released ?? gate.accepted ?? source.manualGateReleased ?? runtime.rollbackManualGateReleased,
    false,
  );

  return {
    source: compactString(source.source || runtime.rollbackLifecycleSource || 'runtime'),
    policyVersion: compactString(source.policyVersion || runtime.rollbackLifecyclePolicyVersion || '1'),
    evaluatedAt: now,
    enabled,
    disabledReason,
    requestedCommand,
    allowedCommands: effectiveAllowedCommands,
    disabledCommands,
    scheduleMode,
    notBefore,
    notAfter,
    cooldownUntil,
    holdReason,
    manualGate: {
      required: manualGateRequired,
      released: manualGateReleased,
      releasedBy: compactString(gate.releasedBy || gate.acceptedBy || source.manualGateReleasedBy),
      releasedAt: compactString(gate.releasedAt || gate.acceptedAt || source.manualGateReleasedAt),
    },
  };
}

function buildRollbackLifecycleControls(descriptor, readiness = {}, runtime = {}) {
  const settings = normalizeRollbackLifecycleSettings(runtime);
  const nowMs = timestampMs(settings.evaluatedAt);
  const notBeforeMs = timestampMs(settings.notBefore);
  const notAfterMs = timestampMs(settings.notAfter);
  const cooldownMs = timestampMs(settings.cooldownUntil);
  const windowState = scheduleWindowState(nowMs, notBeforeMs, notAfterMs);
  const commandAllowed = !settings.requestedCommand || settings.allowedCommands.includes(settings.requestedCommand);
  const scheduleHeld = settings.scheduleMode === 'hold'
    || windowState === 'waiting_for_window'
    || windowState === 'window_expired';
  const cooldownActive = Number.isFinite(nowMs) && Number.isFinite(cooldownMs) && nowMs < cooldownMs;
  const manualGateOpen = settings.manualGate.required !== true || settings.manualGate.released === true;
  const baseReady = readiness.baseRollbackReady !== false;
  const validation = [
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.enabled',
      settings.enabled,
      settings.enabled ? 'info' : 'error',
      settings.enabled
        ? 'Rollback lifecycle controls are enabled.'
        : `Rollback lifecycle controls are disabled${settings.disabledReason ? `: ${settings.disabledReason}` : '.'}`,
      {
        field: 'rollbackLifecycleSettings.enabled',
        owner: 'operator',
        action: 'enable_rollback_lifecycle',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.command_allowed',
      commandAllowed,
      commandAllowed ? 'info' : 'error',
      commandAllowed
        ? 'Requested lifecycle command is allowed by rollback controls.'
        : `Requested lifecycle command "${settings.requestedCommand}" is disabled by rollback controls.`,
      {
        field: 'rollbackLifecycleSettings.controls',
        owner: 'operator',
        action: 'update_rollback_lifecycle_command_controls',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.schedule_window',
      scheduleHeld === false,
      scheduleHeld ? settings.scheduleMode === 'hold' || windowState === 'window_expired' ? 'error' : 'warning' : 'info',
      scheduleHeld
        ? settings.scheduleMode === 'hold'
          ? `Rollback lifecycle is on hold${settings.holdReason ? `: ${settings.holdReason}` : '.'}`
          : windowState === 'window_expired'
            ? 'Rollback schedule window has expired.'
            : 'Rollback schedule window has not opened yet.'
        : 'Rollback schedule window permits lifecycle progress.',
      {
        field: 'rollbackLifecycleSettings.schedule',
        owner: 'operator',
        action: windowState === 'waiting_for_window' ? 'wait_for_rollback_schedule_window' : 'update_rollback_schedule_controls',
        retryable: windowState === 'waiting_for_window',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.cooldown',
      cooldownActive === false,
      cooldownActive ? 'warning' : 'info',
      cooldownActive
        ? `Rollback lifecycle cooldown is active until ${settings.cooldownUntil}.`
        : 'Rollback lifecycle cooldown does not block queueing.',
      {
        field: 'rollbackLifecycleSettings.cooldownUntil',
        owner: 'runtime',
        action: cooldownActive ? 'wait_for_rollback_cooldown' : 'continue_rollback_readiness',
        retryable: cooldownActive,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.manual_gate',
      manualGateOpen,
      manualGateOpen ? 'info' : 'error',
      manualGateOpen
        ? 'Rollback manual lifecycle gate is open.'
        : 'Rollback manual lifecycle gate must be released before queueing.',
      {
        field: 'rollbackLifecycleSettings.manualGate',
        owner: 'operator',
        action: 'release_lifecycle_hold',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.lifecycle.base_readiness',
      baseReady,
      baseReady ? 'info' : 'error',
      baseReady
        ? 'Rollback base readiness permits lifecycle controls to evaluate queueing.'
        : 'Rollback lifecycle controls are waiting for base rollback readiness.',
      {
        field: 'rollbackReadiness',
        owner: 'runtime',
        action: readiness.nextAction || 'continue_rollback_readiness',
      },
    ),
  ];
  const blockers = validation.filter((item) => item.severity === 'error' && item.ok === false).map((item) => item.code);
  const warnings = validation.filter((item) => item.severity === 'warning' && item.ok === false).map((item) => item.code);
  const canProceed = blockers.length === 0 && warnings.length === 0;
  const holdState = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'scheduled_hold'
      : 'released';
  const nextAction = settings.enabled === false
    ? 'enable_rollback_lifecycle'
    : commandAllowed === false
      ? 'update_rollback_lifecycle_command_controls'
      : settings.scheduleMode === 'hold' || windowState === 'window_expired'
        ? 'update_rollback_schedule_controls'
        : windowState === 'waiting_for_window'
          ? 'wait_for_rollback_schedule_window'
          : cooldownActive
            ? 'wait_for_rollback_cooldown'
            : manualGateOpen === false
              ? 'release_lifecycle_hold'
              : baseReady === false
                ? readiness.nextAction || 'continue_rollback_readiness'
                : 'continue_rollback_readiness';

  return {
    protocol: 'aios.rollback-lifecycle-controls.mailchimp.v1',
    source: settings.source,
    policyVersion: settings.policyVersion,
    evaluatedAt: settings.evaluatedAt,
    enabled: settings.enabled,
    canProceed,
    holdState,
    nextAction,
    originalAction: descriptor.action || '',
    inverseAction: readiness.inverseAction || '',
    controls: {
      requestedCommand: settings.requestedCommand,
      commandAllowed,
      allowedCommands: settings.allowedCommands,
      disabledCommands: settings.disabledCommands,
    },
    schedule: {
      mode: settings.scheduleMode,
      windowState,
      notBefore: settings.notBefore,
      notAfter: settings.notAfter,
      cooldownUntil: settings.cooldownUntil,
      holdReason: settings.holdReason,
    },
    manualGate: settings.manualGate,
    validation,
    blockers,
    warnings,
  };
}

function createOperationalSignal(code, ok, severity, message, detail = {}) {
  return {
    code,
    ok: ok === true,
    severity,
    message,
    ...detail,
  };
}

function healthStateFromSignals(signals, recovery, restartPlan) {
  const hasFailure = signals.some((signal) => signal.severity === 'error' && signal.terminal === true);
  const hasBlocked = signals.some((signal) => signal.severity === 'error');
  const hasWarning = signals.some((signal) => signal.severity === 'warning');

  if (RECOVERY_SUCCESS_STATES.includes(recovery.latestState)) return 'terminal_success';
  if (hasFailure || ['manual_recovery_required', 'prefer_persisted_terminal_checkpoint'].includes(restartPlan.mode)) return 'failed';
  if (hasBlocked) return 'blocked';
  if (hasWarning || recovery.retryable === true || restartPlan.guards?.requiresFreshStatus === true) return 'degraded';
  return 'healthy';
}

function buildRollbackActionableErrors(signals) {
  return signals
    .filter((signal) => signal.ok === false && ['error', 'warning'].includes(signal.severity))
    .map((signal) => ({
      code: signal.code,
      severity: signal.severity,
      field: signal.field || '',
      owner: signal.owner || 'operator',
      action: signal.action || 'inspect_rollback_health',
      message: signal.message,
      retryable: signal.retryable === true,
      terminal: signal.terminal === true,
    }));
}

function buildRollbackRetryPolicy(signals, recovery, restartPlan, runtime = {}) {
  const retrySource = runtime.retryPolicy && typeof runtime.retryPolicy === 'object'
    ? runtime.retryPolicy
    : runtime.rollbackRetry && typeof runtime.rollbackRetry === 'object'
      ? runtime.rollbackRetry
      : {};
  const attempt = clampInteger(
    retrySource.attempt ?? retrySource.retryAttempt ?? runtime.rollbackRetryAttempt,
    0,
    12,
  );
  const baseMs = clampInteger(retrySource.baseMs ?? retrySource.backoffBaseMs, 250, 60000);
  const maxMs = clampInteger(retrySource.maxMs ?? retrySource.backoffMaxMs, baseMs, 120000);
  const retryableSignals = signals.filter((signal) => signal.ok === false && signal.retryable === true);
  const blockedByTerminal = signals.some((signal) => signal.ok === false && signal.terminal === true);
  const eligible = retryableSignals.length > 0
    && blockedByTerminal === false
    && restartPlan.guards?.requiresConflictReview !== true;
  const backoffMs = eligible
    ? Math.min(maxMs, baseMs * (2 ** attempt))
    : 0;

  return {
    eligible,
    attempt,
    baseMs,
    maxMs,
    backoffMs,
    jitterMs: 0,
    reason: eligible
      ? retryableSignals.map((signal) => signal.code).sort().join(',')
      : blockedByTerminal
        ? 'terminal_failure'
        : restartPlan.guards?.requiresConflictReview === true
          ? 'restart_conflict_review_required'
          : 'no_retryable_health_signal',
    nextAction: eligible
      ? recovery.nextAction === 'refresh_provider_before_rollback'
        ? 'retry_after_provider_refresh'
        : 'retry_rollback_health_check'
      : 'do_not_retry_rollback_automatically',
  };
}

function normalizeRuntimeHealthReport(report, index) {
  const source = report && typeof report === 'object' ? report : {};
  const readiness = source.rollbackReadinessEvidence && typeof source.rollbackReadinessEvidence === 'object'
    ? source.rollbackReadinessEvidence
    : source.readinessEvidence && typeof source.readinessEvidence === 'object'
      ? source.readinessEvidence
      : source;
  const kind = compactString(source.kind || source.protocol || source.type || `runtime-health:${index}`);
  const component = compactString(
    readiness.component
      || source.component
      || readiness.process
      || source.process
      || readiness.scope
      || source.scope
      || readiness.stream
      || source.stream
      || readiness.subject
      || source.subject
      || readiness.adapter
      || source.adapter
      || kind,
  );
  const readinessStatus = normalizeState(readiness.status || readiness.state || '', '');
  const queueImpact = normalizeState(readiness.queueImpact || source.queueImpact, '');
  const state = normalizeState(
    source.state || source.status || source.healthState || source.restartSafeStatus || readinessStatus,
    'unknown',
  );
  const degraded = source.degraded === true
    || readiness.degraded === true
    || ['degraded', 'recovering', 'retryable_failure', 'retryable-failure', 'resume_in_progress', 'resume-in-progress', 'waiting'].includes(state)
    || ['degraded_runtime_warning', 'wait_for_process_boot_replay', 'wait_for_process_snapshot_retry', 'wait_for_audit_acceptance'].includes(queueImpact);
  const failed = ['failed', 'blocked', 'unavailable', 'terminal_failure', 'terminal-failure'].includes(state)
    || queueImpact === 'block_rollback_queue'
    || source.failureState === 'spawn-failed-terminal'
    || readiness.failureState === 'spawn-failed-terminal';
  const healthy = source.healthy === true
    || readiness.ready === true
    || (!degraded && !failed && ['healthy', 'ready', 'already_ready', 'already-ready', 'none'].includes(state));
  const retryable = source.retryable === true
    || readiness.retryable === true
    || source.backoff?.retryable === true
    || normalizeInteger(source.retryAfterMs ?? readiness.retryAfterMs ?? source.backoff?.backoffMs, 0) > 0;
  const retryAfterMs = clampInteger(
    source.retryAfterMs ?? readiness.retryAfterMs ?? source.backoff?.backoffMs ?? source.backoffMs,
    0,
    3600000,
  );
  const nextAction = compactString(
    readiness.nextAction
      || source.nextAction
      || source.action
      || (retryable ? 'retry_runtime_health_probe' : failed ? 'inspect_runtime_health_failure' : 'continue_rollback_readiness'),
  );
  const blockerCodes = normalizeStringList(readiness.blockerCodes || readiness.blockers || source.blockerCodes || source.blockers);
  const warningCodes = normalizeStringList(readiness.warningCodes || readiness.warnings || source.warningCodes || source.warnings);

  return {
    index,
    kind,
    component,
    state,
    readinessStatus,
    queueImpact,
    healthy,
    degraded,
    failed,
    retryable,
    retryAfterMs,
    failureState: compactString(source.failureState || readiness.failureState || (failed ? state : degraded ? 'runtime-degraded' : 'none')),
    actionableError: compactString(source.actionableError || readiness.actionableError || source.message || source.error),
    nextAction,
    terminal: source.terminal === true || (failed && retryable === false),
    auditRef: compactString(readiness.auditRef || source.auditRef || source.auditId || readiness.commandId || source.commandId || readiness.snapshotId || source.snapshotId),
    exportReady: readiness.exportReady === true || source.exportReady === true,
    blockerCodes,
    warningCodes,
  };
}

function collectRuntimeOperationalHealth(runtime = {}) {
  const candidates = [
    ...(Array.isArray(runtime.operationalHealthReports) ? runtime.operationalHealthReports : []),
    ...(Array.isArray(runtime.runtimeHealthReports) ? runtime.runtimeHealthReports : []),
    ...(Array.isArray(runtime.processHealthReports) ? runtime.processHealthReports : []),
    ...(Array.isArray(runtime.rollbackReadinessEvidence) ? runtime.rollbackReadinessEvidence : []),
    ...(Array.isArray(runtime.rollbackReadinessReports) ? runtime.rollbackReadinessReports : []),
    ...(runtime.processBootReadinessEvidence && typeof runtime.processBootReadinessEvidence === 'object' ? [runtime.processBootReadinessEvidence] : []),
    ...(runtime.processSnapshotReadinessEvidence && typeof runtime.processSnapshotReadinessEvidence === 'object' ? [runtime.processSnapshotReadinessEvidence] : []),
    ...(runtime.logReadinessEvidence && typeof runtime.logReadinessEvidence === 'object' ? [runtime.logReadinessEvidence] : []),
    ...(runtime.processBootHandoff?.rollbackReadinessEvidence && typeof runtime.processBootHandoff.rollbackReadinessEvidence === 'object' ? [runtime.processBootHandoff.rollbackReadinessEvidence] : []),
    ...(runtime.processSnapshotHandoff?.rollbackReadinessEvidence && typeof runtime.processSnapshotHandoff.rollbackReadinessEvidence === 'object' ? [runtime.processSnapshotHandoff.rollbackReadinessEvidence] : []),
    ...(runtime.logRuntimeHandoff?.rollbackReadinessEvidence && typeof runtime.logRuntimeHandoff.rollbackReadinessEvidence === 'object' ? [runtime.logRuntimeHandoff.rollbackReadinessEvidence] : []),
    ...(runtime.processBootHealth && typeof runtime.processBootHealth === 'object' ? [runtime.processBootHealth] : []),
    ...(runtime.processSnapshotHealth && typeof runtime.processSnapshotHealth === 'object' ? [runtime.processSnapshotHealth] : []),
    ...(runtime.logHealthSummary && typeof runtime.logHealthSummary === 'object' ? [runtime.logHealthSummary] : []),
  ];

  return candidates
    .map((report, index) => normalizeRuntimeHealthReport(report, index))
    .filter((report) => report.component || report.kind);
}

function runtimeHealthSignals(reports = []) {
  return reports.map((report) => {
    const ok = report.healthy && report.failed === false;
    const severity = ok
      ? 'info'
      : report.failed
        ? 'error'
        : 'warning';
    const message = ok
      ? `Runtime component "${report.component}" is healthy for rollback readiness.`
      : report.actionableError
        ? report.actionableError
        : report.queueImpact
          ? `Runtime component "${report.component}" reported rollback queue impact "${report.queueImpact}".`
          : `Runtime component "${report.component}" reported "${report.state}".`;

    return createOperationalSignal(
      `mailchimp.rollback.runtime_health.${report.component.replaceAll(':', '_').replaceAll('.', '_')}`,
      ok,
      severity,
      message,
      {
        field: `runtimeHealth.${report.component}`,
        owner: report.failed ? 'operator' : 'runtime',
        action: report.nextAction,
        retryable: report.retryable,
        terminal: report.terminal,
        retryAfterMs: report.retryAfterMs,
        auditRef: report.auditRef,
        queueImpact: report.queueImpact,
        readinessStatus: report.readinessStatus,
        exportReady: report.exportReady,
        blockerCodes: report.blockerCodes,
        warningCodes: report.warningCodes,
      },
    );
  });
}

function normalizeRollbackReadinessPacket(packet, index) {
  const source = packet && typeof packet === 'object' ? packet : {};
  const digest = source.runtimeHandoffDigest && typeof source.runtimeHandoffDigest === 'object'
    ? source.runtimeHandoffDigest
    : source.protocol === 'aios.runtime-handoff-digest.mailchimp.v1'
      ? source
      : {};
  const readiness = source.readinessEvidence && typeof source.readinessEvidence === 'object'
    ? source.readinessEvidence
    : source.rollbackReadinessEvidence && typeof source.rollbackReadinessEvidence === 'object'
      ? source.rollbackReadinessEvidence
      : digest.readiness && typeof digest.readiness === 'object'
        ? digest.readiness
        : source;
  const componentType = normalizeState(source.componentType || digest.componentType || source.kind || source.protocol, `component_${index}`);
  const component = compactString(readiness.component || source.component || digest.component || source.subject || source.stream || source.process || source.scope || componentType);
  const status = normalizeState(readiness.status || source.status || digest.status || source.state, 'unknown');
  const queueImpact = normalizeState(readiness.queueImpact || source.queueImpact || digest.readiness?.queueImpact, '');
  const blockerCodes = normalizeStringList(readiness.blockerCodes || source.blockerCodes || digest.readiness?.blockerCodes || source.blockers);
  const warningCodes = normalizeStringList(readiness.warningCodes || source.warningCodes || digest.readiness?.warningCodes || source.warnings);
  const nextAction = compactString(readiness.nextAction || source.nextAction || digest.nextAction || source.currentAction || 'continue_rollback_readiness');
  const exportReady = readiness.exportReady === true || source.exportReady === true || digest.readiness?.exportReady === true;
  const terminal = readiness.terminal === true || source.terminal === true || (status === 'blocked' && readiness.retryable !== true);
  const retryable = readiness.retryable === true || source.retryable === true || digest.health?.retryable === true;
  const ready = readiness.ready === true || source.ready === true || (status === 'ready' && blockerCodes.length === 0);

  return {
    index,
    protocol: compactString(source.protocol || 'aios.runtime-rollback-readiness-packet.mailchimp.v1'),
    packetId: compactString(source.packetId || source.id || `rollback-readiness:${componentType}:${component}:${index}`),
    componentType,
    component,
    status,
    ready,
    queueImpact,
    terminal,
    retryable,
    retryAfterMs: clampInteger(readiness.retryAfterMs ?? source.retryAfterMs, 0, 3600000),
    exportReady,
    nextAction,
    owner: compactString(source.owner || digest.owner || (terminal ? 'operator' : retryable ? 'runtime' : 'runtime')),
    failureState: compactString(readiness.failureState || source.failureState || digest.health?.failureState || (ready ? 'none' : status)),
    blockerCodes,
    warningCodes,
    evidenceRows: Array.isArray(readiness.evidenceRows) ? readiness.evidenceRows : Array.isArray(source.evidenceRows) ? source.evidenceRows : [],
    providerOperationId: compactString(source.providerOperationId || source.providerOperation?.operationId),
    exportReportId: compactString(readiness.exportReportId || source.exportReportId || source.reportId),
    runtimeHandoffDigestId: compactString(digest.digestId || source.runtimeHandoffDigestId),
    clientVisibleStatus: compactString(digest.clientVisibleStatus || source.clientVisibleStatus),
    restartToken: compactString(digest.restart?.token || source.restartToken),
  };
}

function normalizeRuntimeHandoffDigest(digest, index) {
  const source = digest && typeof digest === 'object' ? digest : {};
  const readiness = source.readiness && typeof source.readiness === 'object' ? source.readiness : {};
  const health = source.health && typeof source.health === 'object' ? source.health : {};
  const restart = source.restart && typeof source.restart === 'object' ? source.restart : {};
  const clientControls = source.clientControls && typeof source.clientControls === 'object' ? source.clientControls : {};
  const status = normalizeState(source.status || readiness.packetStatus || readiness.rollbackStatus, 'unknown');
  const blockerCodes = normalizeStringList(readiness.blockerCodes || source.blockerCodes);
  const warningCodes = normalizeStringList(readiness.warningCodes || source.warningCodes);
  const retryable = health.retryable === true || clientControls.canRetry === true || restart.resumeMode === 'retry-after';
  const terminal = health.terminal === true || (status === 'blocked' && retryable === false);
  const ready = source.ready === true || (['ready', 'degraded'].includes(status) && blockerCodes.length === 0);

  return {
    index,
    protocol: compactString(source.protocol || 'aios.runtime-handoff-digest.mailchimp.v1'),
    digestId: compactString(source.digestId || `runtime-handoff-digest:${index}`),
    componentType: normalizeState(source.componentType || readiness.componentType, `component_${index}`),
    component: compactString(source.component || readiness.component || `runtime-handoff:${index}`),
    status,
    ready,
    clientVisibleStatus: compactString(source.clientVisibleStatus || status),
    nextAction: compactString(source.nextAction || readiness.nextAction || (ready ? 'continue_rollback_readiness' : 'inspect_runtime_handoff_digest')),
    owner: compactString(source.owner || (terminal ? 'operator' : 'runtime')),
    queueImpact: normalizeState(readiness.queueImpact || source.queueImpact, ''),
    terminal,
    retryable,
    retryAfterMs: clampInteger(health.retryAfterMs ?? restart.retryAfterMs ?? source.retryAfterMs, 0, 3600000),
    failureState: compactString(health.failureState || source.failureState || (ready ? 'none' : status)),
    exportReady: readiness.exportReady === true || source.exportReady === true,
    packetId: compactString(readiness.packetId || source.packetId),
    packetStatus: normalizeState(readiness.packetStatus || source.packetStatus, ''),
    rollbackStatus: normalizeState(readiness.rollbackStatus || source.rollbackStatus, ''),
    providerOperationId: compactString(readiness.providerOperationId || source.providerOperationId),
    exportReportId: compactString(readiness.exportReportId || source.exportReportId),
    restartToken: compactString(restart.token || source.restartToken),
    resumeMode: normalizeState(restart.resumeMode || source.resumeMode, ''),
    externalWritesPerformed: restart.externalWritesPerformed === true || source.externalWritesPerformed === true,
    blockerCodes,
    warningCodes,
  };
}

function runtimeHandoffDigestToPacket(digest) {
  return {
    protocol: 'aios.runtime-rollback-readiness-packet.mailchimp.v1',
    packetId: digest.packetId || `rrp:${digest.componentType}:${digest.digestId}`,
    componentType: digest.componentType,
    component: digest.component,
    status: digest.status === 'degraded' ? 'waiting' : digest.status,
    ready: digest.ready,
    queueImpact: digest.queueImpact || (digest.status === 'blocked' ? 'block_rollback_queue' : digest.status === 'waiting' ? 'runtime_handoff_waiting' : 'none'),
    terminal: digest.terminal,
    retryable: digest.retryable,
    retryAfterMs: digest.retryAfterMs,
    exportReady: digest.exportReady,
    nextAction: digest.nextAction,
    owner: digest.owner,
    failureState: digest.failureState,
    blockerCodes: digest.blockerCodes,
    warningCodes: digest.warningCodes,
    providerOperationId: digest.providerOperationId,
    exportReportId: digest.exportReportId,
    runtimeHandoffDigest: {
      protocol: digest.protocol,
      digestId: digest.digestId,
      status: digest.status,
      ready: digest.ready,
      clientVisibleStatus: digest.clientVisibleStatus,
      restartToken: digest.restartToken,
      resumeMode: digest.resumeMode,
      externalWritesPerformed: digest.externalWritesPerformed,
    },
  };
}

function collectRuntimeHandoffDigests(runtime = {}) {
  const candidates = [
    ...(Array.isArray(runtime.runtimeHandoffDigests) ? runtime.runtimeHandoffDigests : []),
    ...(Array.isArray(runtime.clientRuntimeHandoffDigests) ? runtime.clientRuntimeHandoffDigests : []),
    ...(runtime.runtimeHandoffDigest && typeof runtime.runtimeHandoffDigest === 'object' ? [runtime.runtimeHandoffDigest] : []),
    ...(runtime.processBootRuntimeHandoffDigest && typeof runtime.processBootRuntimeHandoffDigest === 'object' ? [runtime.processBootRuntimeHandoffDigest] : []),
    ...(runtime.processSnapshotRuntimeHandoffDigest && typeof runtime.processSnapshotRuntimeHandoffDigest === 'object' ? [runtime.processSnapshotRuntimeHandoffDigest] : []),
    ...(runtime.logRuntimeHandoffDigest && typeof runtime.logRuntimeHandoffDigest === 'object' ? [runtime.logRuntimeHandoffDigest] : []),
    ...(runtime.processBootHandoff?.runtimeHandoffDigest && typeof runtime.processBootHandoff.runtimeHandoffDigest === 'object' ? [runtime.processBootHandoff.runtimeHandoffDigest] : []),
    ...(runtime.processSnapshotHandoff?.runtimeHandoffDigest && typeof runtime.processSnapshotHandoff.runtimeHandoffDigest === 'object' ? [runtime.processSnapshotHandoff.runtimeHandoffDigest] : []),
    ...(runtime.logRuntimeHandoff?.runtimeHandoffDigest && typeof runtime.logRuntimeHandoff.runtimeHandoffDigest === 'object' ? [runtime.logRuntimeHandoff.runtimeHandoffDigest] : []),
  ];
  const seen = new Set();

  return candidates
    .map((digest, index) => normalizeRuntimeHandoffDigest(digest, index))
    .filter((digest) => {
      const key = `${digest.componentType}:${digest.component}:${digest.digestId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(digest.digestId || digest.component);
    });
}

function normalizeOperatorReadinessHandoff(handoff, index) {
  const source = handoff && typeof handoff === 'object' ? handoff : {};
  const readiness = source.readiness && typeof source.readiness === 'object' ? source.readiness : {};
  const controls = source.controls && typeof source.controls === 'object' ? source.controls : {};
  const restart = source.restart && typeof source.restart === 'object' ? source.restart : {};
  const validationSummary = source.validationSummary && typeof source.validationSummary === 'object'
    ? source.validationSummary
    : {};
  const status = normalizeState(source.status || readiness.packetStatus, 'unknown');
  const blockerCodes = normalizeStringList(readiness.blockerCodes || source.blockerCodes);
  const warningCodes = normalizeStringList(readiness.warningCodes || source.warningCodes);
  const ready = source.ready === true || (['ready', 'degraded'].includes(status) && blockerCodes.length === 0);
  const retryable = controls.canRetry === true || restart.resumeMode === 'retry-after' || status === 'waiting';
  const terminal = status === 'blocked' && retryable === false;

  return {
    index,
    protocol: compactString(source.protocol || 'aios.operator-readiness-handoff.mailchimp.v1'),
    handoffId: compactString(source.handoffId || source.id || `operator-readiness:${index}`),
    componentType: normalizeState(source.componentType || readiness.componentType || source.kind, `component_${index}`),
    component: compactString(source.component || source.subject || source.stream || source.process || source.scope || `operator-readiness:${index}`),
    status,
    ready,
    owner: compactString(source.owner || (terminal ? 'operator' : 'runtime')),
    nextAction: compactString(source.nextAction || (ready ? 'continue_rollback_readiness' : 'inspect_operator_readiness_handoff')),
    visibleStatus: compactString(source.visibleStatus || source.clientVisibleStatus || status),
    title: compactString(source.title),
    summary: compactString(source.summary),
    packetId: compactString(readiness.packetId || source.packetId),
    packetStatus: normalizeState(readiness.packetStatus || source.packetStatus, ''),
    queueImpact: normalizeState(readiness.queueImpact || source.queueImpact, ''),
    exportReportId: compactString(readiness.exportReportId || readiness.analyticsReportId || source.exportReportId),
    exportReady: readiness.exportReady === true || source.exportReady === true,
    providerOperationId: compactString(readiness.providerOperationId || source.providerOperationId),
    restartToken: compactString(restart.token || source.restartToken),
    resumeMode: normalizeState(restart.resumeMode || source.resumeMode, ''),
    externalWritesPerformed: restart.externalWritesPerformed === true || source.externalWritesPerformed === true,
    accepted: controls.accepted === true || source.accepted === true,
    canRollback: controls.canRollback !== false,
    canExport: controls.canExport !== false,
    terminal,
    retryable,
    blockerCodes,
    warningCodes,
    validationSummary: {
      total: clampInteger(validationSummary.total, 0, 1000),
      passed: clampInteger(validationSummary.passed, 0, 1000),
      waiting: clampInteger(validationSummary.waiting, 0, 1000),
      blocked: clampInteger(validationSummary.blocked, 0, 1000),
      primaryCode: compactString(validationSummary.primaryCode),
    },
  };
}

function operatorReadinessHandoffToPacket(handoff) {
  return {
    protocol: 'aios.runtime-rollback-readiness-packet.mailchimp.v1',
    packetId: handoff.packetId || `rrp:${handoff.componentType}:${handoff.handoffId}`,
    componentType: handoff.componentType,
    component: handoff.component,
    status: handoff.status === 'degraded' ? 'waiting' : handoff.status,
    ready: handoff.ready,
    queueImpact: handoff.queueImpact || (handoff.status === 'blocked' ? 'block_rollback_queue' : handoff.status === 'waiting' ? 'operator_readiness_waiting' : 'none'),
    terminal: handoff.terminal,
    retryable: handoff.retryable,
    retryAfterMs: 0,
    exportReady: handoff.exportReady,
    nextAction: handoff.nextAction,
    owner: handoff.owner,
    failureState: handoff.status === 'blocked' ? 'operator-readiness-blocked' : handoff.status === 'waiting' ? 'operator-readiness-waiting' : 'none',
    blockerCodes: handoff.blockerCodes,
    warningCodes: handoff.warningCodes,
    providerOperationId: handoff.providerOperationId,
    exportReportId: handoff.exportReportId,
    operatorReadinessHandoff: {
      protocol: handoff.protocol,
      handoffId: handoff.handoffId,
      status: handoff.status,
      ready: handoff.ready,
      visibleStatus: handoff.visibleStatus,
      title: handoff.title,
      summary: handoff.summary,
      restartToken: handoff.restartToken,
      resumeMode: handoff.resumeMode,
      externalWritesPerformed: handoff.externalWritesPerformed,
    },
  };
}

function collectOperatorReadinessHandoffs(runtime = {}) {
  const candidates = [
    ...(Array.isArray(runtime.operatorReadinessHandoffs) ? runtime.operatorReadinessHandoffs : []),
    ...(Array.isArray(runtime.componentOperatorReadinessHandoffs) ? runtime.componentOperatorReadinessHandoffs : []),
    ...(runtime.operatorReadinessHandoff && typeof runtime.operatorReadinessHandoff === 'object' ? [runtime.operatorReadinessHandoff] : []),
    ...(runtime.processBootOperatorReadinessHandoff && typeof runtime.processBootOperatorReadinessHandoff === 'object' ? [runtime.processBootOperatorReadinessHandoff] : []),
    ...(runtime.processSnapshotOperatorReadinessHandoff && typeof runtime.processSnapshotOperatorReadinessHandoff === 'object' ? [runtime.processSnapshotOperatorReadinessHandoff] : []),
    ...(runtime.logOperatorReadinessHandoff && typeof runtime.logOperatorReadinessHandoff === 'object' ? [runtime.logOperatorReadinessHandoff] : []),
    ...(runtime.processBootHandoff?.operatorReadinessHandoff && typeof runtime.processBootHandoff.operatorReadinessHandoff === 'object' ? [runtime.processBootHandoff.operatorReadinessHandoff] : []),
    ...(runtime.processSnapshotHandoff?.operatorReadinessHandoff && typeof runtime.processSnapshotHandoff.operatorReadinessHandoff === 'object' ? [runtime.processSnapshotHandoff.operatorReadinessHandoff] : []),
    ...(runtime.logRuntimeHandoff?.operatorReadinessHandoff && typeof runtime.logRuntimeHandoff.operatorReadinessHandoff === 'object' ? [runtime.logRuntimeHandoff.operatorReadinessHandoff] : []),
  ];
  const seen = new Set();

  return candidates
    .map((handoff, index) => normalizeOperatorReadinessHandoff(handoff, index))
    .filter((handoff) => {
      const key = `${handoff.componentType}:${handoff.component}:${handoff.handoffId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(handoff.handoffId || handoff.component);
    });
}

function collectRollbackReadinessPackets(runtime = {}) {
  const digestPackets = collectRuntimeHandoffDigests(runtime).map((digest) => runtimeHandoffDigestToPacket(digest));
  const operatorPackets = collectOperatorReadinessHandoffs(runtime).map((handoff) => operatorReadinessHandoffToPacket(handoff));
  const candidates = [
    ...(Array.isArray(runtime.rollbackReadinessPackets) ? runtime.rollbackReadinessPackets : []),
    ...(Array.isArray(runtime.componentReadinessPackets) ? runtime.componentReadinessPackets : []),
    ...digestPackets,
    ...operatorPackets,
    ...(runtime.processBootReadinessPacket && typeof runtime.processBootReadinessPacket === 'object' ? [runtime.processBootReadinessPacket] : []),
    ...(runtime.processSnapshotReadinessPacket && typeof runtime.processSnapshotReadinessPacket === 'object' ? [runtime.processSnapshotReadinessPacket] : []),
    ...(runtime.logReadinessPacket && typeof runtime.logReadinessPacket === 'object' ? [runtime.logReadinessPacket] : []),
    ...(runtime.processBootHandoff?.rollbackReadinessPacket && typeof runtime.processBootHandoff.rollbackReadinessPacket === 'object' ? [runtime.processBootHandoff.rollbackReadinessPacket] : []),
    ...(runtime.processSnapshotHandoff?.rollbackReadinessPacket && typeof runtime.processSnapshotHandoff.rollbackReadinessPacket === 'object' ? [runtime.processSnapshotHandoff.rollbackReadinessPacket] : []),
    ...(runtime.logRuntimeHandoff?.rollbackReadinessPacket && typeof runtime.logRuntimeHandoff.rollbackReadinessPacket === 'object' ? [runtime.logRuntimeHandoff.rollbackReadinessPacket] : []),
  ];
  const seen = new Set();

  return candidates
    .map((packet, index) => normalizeRollbackReadinessPacket(packet, index))
    .filter((packet) => {
      const key = `${packet.componentType}:${packet.component}:${packet.packetId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(packet.component || packet.packetId);
    });
}

function buildComponentReadinessSummary(runtime = {}) {
  const packets = collectRollbackReadinessPackets(runtime);
  const runtimeDigests = collectRuntimeHandoffDigests(runtime);
  const operatorHandoffs = collectOperatorReadinessHandoffs(runtime);
  const blocked = packets.filter((packet) => packet.status === 'blocked' || packet.terminal || packet.blockerCodes.length > 0);
  const waiting = packets.filter((packet) => blocked.includes(packet) === false && (packet.status === 'waiting' || packet.retryable || packet.warningCodes.length > 0));
  const readyPackets = packets.filter((packet) => packet.ready && blocked.includes(packet) === false && waiting.includes(packet) === false);
  const primary = blocked[0] || waiting[0] || packets.find((packet) => packet.ready === false) || packets[0] || null;
  const status = blocked.length > 0
    ? 'blocked'
    : waiting.length > 0
      ? 'waiting'
      : packets.length === 0
        ? 'not_supplied'
        : 'ready';

  return {
    protocol: 'aios.rollback-component-readiness-summary.mailchimp.v1',
    supplied: packets.length > 0,
    status,
    ready: packets.length === 0 || status === 'ready',
    nextAction: primary?.nextAction || 'continue_rollback_readiness',
    primaryComponent: primary?.component || '',
    primaryComponentType: primary?.componentType || '',
    counts: {
      packets: packets.length,
      ready: readyPackets.length,
      waiting: waiting.length,
      blocked: blocked.length,
      terminal: packets.filter((packet) => packet.terminal).length,
      retryable: packets.filter((packet) => packet.retryable).length,
      exportReady: packets.filter((packet) => packet.exportReady).length,
      runtimeDigests: runtimeDigests.length,
      clientVisibleBlocked: runtimeDigests.filter((digest) => digest.status === 'blocked').length,
      clientVisibleWaiting: runtimeDigests.filter((digest) => ['waiting', 'degraded'].includes(digest.status)).length,
      operatorHandoffs: operatorHandoffs.length,
      operatorBlocked: operatorHandoffs.filter((handoff) => handoff.status === 'blocked').length,
      operatorWaiting: operatorHandoffs.filter((handoff) => ['waiting', 'degraded'].includes(handoff.status)).length,
    },
    blockerCodes: [...new Set(blocked.flatMap((packet) => packet.blockerCodes.length ? packet.blockerCodes : [`${packet.componentType}.blocked`]))].sort(),
    warningCodes: [...new Set(waiting.flatMap((packet) => packet.warningCodes.length ? packet.warningCodes : [`${packet.componentType}.waiting`]))].sort(),
    packets,
    runtimeHandoffDigests: runtimeDigests,
    operatorHandoffs,
  };
}

function normalizeProviderOperationReport(report, index) {
  const source = report && typeof report === 'object' ? report : {};
  const capabilityNegotiation = source.capabilityNegotiation && typeof source.capabilityNegotiation === 'object'
    ? source.capabilityNegotiation
    : {};
  const sync = source.sync && typeof source.sync === 'object' ? source.sync : {};
  const handoff = source.externalHandoff && typeof source.externalHandoff === 'object'
    ? source.externalHandoff
    : {};
  const health = source.health && typeof source.health === 'object' ? source.health : {};
  const validationRows = Array.isArray(source.validationRows) ? source.validationRows : [];
  const missingCapabilities = normalizeStringList(capabilityNegotiation.missing || source.missingCapabilities);
  const status = normalizeState(source.status || source.state || (source.ready === true ? 'ready' : ''), 'unknown');
  const syncState = normalizeState(sync.state || source.syncState || status, 'unknown');
  const handoffState = normalizeState(handoff.state || source.handoffState || status, 'unknown');
  const blockedRows = validationRows.filter((row) => normalizeState(row?.status, '') === 'blocked');
  const waitingRows = validationRows.filter((row) => ['waiting', 'pending'].includes(normalizeState(row?.status, '')));
  const failed = status === 'blocked'
    || blockedRows.length > 0
    || missingCapabilities.some((capability) => capability === 'adapter.mailchimp' || capability === 'external.write');
  const degraded = failed === false && (
    status === 'waiting'
      || status === 'degraded'
      || waitingRows.length > 0
      || missingCapabilities.length > 0
      || health.retryable === true
  );
  const ready = source.ready === true || (status === 'ready' && failed === false && degraded === false);
  const nextAction = compactString(
    source.nextAction
      || blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || (failed ? 'inspect_provider_operation_manifest' : degraded ? 'refresh_provider_before_rollback' : 'continue_rollback_readiness'),
  );

  return {
    index,
    protocol: compactString(source.protocol || `aios.provider-operation.mailchimp.${index}`),
    operationId: compactString(source.operationId || source.id || `provider-operation:${index}`),
    component: compactString(source.component || source.subject || source.stream || source.process || source.scope || `provider-operation:${index}`),
    provider: compactString(source.provider || 'mailchimp'),
    service: compactString(source.service || 'marketing'),
    status,
    ready,
    failed,
    degraded,
    retryable: health.retryable === true || degraded,
    retryAfterMs: clampInteger(health.retryAfterMs ?? source.retryAfterMs, 0, 3600000),
    nextAction,
    providerRequestId: compactString(source.providerRequestId || handoff.requestId || source.requestId),
    statusRef: compactString(source.statusRef || handoff.statusRef),
    handoffState,
    sync: {
      state: syncState,
      cursor: compactString(sync.cursor || source.syncCursor),
      exportReportId: compactString(sync.exportReportId || sync.analyticsReportId || source.exportReportId),
      stale: sync.stale === true || syncState === 'stale',
    },
    capabilityNegotiation: {
      required: normalizeStringList(capabilityNegotiation.required || source.requiredCapabilities),
      offered: normalizeStringList(capabilityNegotiation.offered || source.offeredCapabilities),
      missing: missingCapabilities,
      satisfied: capabilityNegotiation.satisfied === true || missingCapabilities.length === 0,
    },
    health: {
      state: normalizeState(health.state || source.healthState || status, status),
      failureState: compactString(health.failureState || source.failureState || (failed ? status : degraded ? 'provider-operation-waiting' : 'none')),
      rollbackReadinessStatus: normalizeState(health.rollbackReadinessStatus || source.rollbackReadinessStatus, ''),
      queueImpact: normalizeState(health.queueImpact || source.queueImpact, ''),
    },
    counters: source.counters && typeof source.counters === 'object' ? source.counters : {},
    validationRows,
    blockedRows,
    waitingRows,
  };
}

function collectProviderOperationReports(runtime = {}) {
  const candidates = [
    ...(Array.isArray(runtime.providerOperationReports) ? runtime.providerOperationReports : []),
    ...(Array.isArray(runtime.mailchimpProviderOperationReports) ? runtime.mailchimpProviderOperationReports : []),
    ...(Array.isArray(runtime.providerOperations) ? runtime.providerOperations : []),
    ...(runtime.providerOperationManifest && typeof runtime.providerOperationManifest === 'object' ? [runtime.providerOperationManifest] : []),
    ...(runtime.processBootProviderOperation && typeof runtime.processBootProviderOperation === 'object' ? [runtime.processBootProviderOperation] : []),
    ...(runtime.logProviderOperation && typeof runtime.logProviderOperation === 'object' ? [runtime.logProviderOperation] : []),
    ...(runtime.processSnapshotProviderOperation && typeof runtime.processSnapshotProviderOperation === 'object' ? [runtime.processSnapshotProviderOperation] : []),
    ...(runtime.processBootHandoff?.providerOperationManifest && typeof runtime.processBootHandoff.providerOperationManifest === 'object' ? [runtime.processBootHandoff.providerOperationManifest] : []),
    ...(runtime.logRuntimeHandoff?.providerOperationManifest && typeof runtime.logRuntimeHandoff.providerOperationManifest === 'object' ? [runtime.logRuntimeHandoff.providerOperationManifest] : []),
    ...(runtime.processSnapshotHandoff?.providerOperationManifest && typeof runtime.processSnapshotHandoff.providerOperationManifest === 'object' ? [runtime.processSnapshotHandoff.providerOperationManifest] : []),
  ];

  return candidates
    .map((report, index) => normalizeProviderOperationReport(report, index))
    .filter((report) => report.operationId || report.component);
}

function providerOperationSignals(reports = []) {
  return reports.map((report) => {
    const ok = report.ready === true && report.failed === false && report.capabilityNegotiation.satisfied === true;
    const severity = ok ? 'info' : report.failed ? 'error' : 'warning';
    const missing = report.capabilityNegotiation.missing.join(', ');
    const message = ok
      ? `Provider operation "${report.component}" is ready for Mailchimp rollback handoff.`
      : report.failed
        ? `Provider operation "${report.component}" is blocked${missing ? ` by missing capabilities: ${missing}` : ''}.`
        : `Provider operation "${report.component}" is waiting with status "${report.status}".`;

    return createOperationalSignal(
      `mailchimp.rollback.provider_operation.${report.component.replaceAll(':', '_').replaceAll('.', '_')}`,
      ok,
      severity,
      message,
      {
        field: `providerOperations.${report.component}`,
        owner: report.failed ? 'operator' : 'adapter',
        action: report.nextAction,
        retryable: report.retryable && report.failed === false,
        terminal: report.failed && report.retryable === false,
        retryAfterMs: report.retryAfterMs,
        operationId: report.operationId,
        providerRequestId: report.providerRequestId,
        statusRef: report.statusRef,
        syncCursor: report.sync.cursor,
        handoffState: report.handoffState,
        missingCapabilities: report.capabilityNegotiation.missing,
        rollbackReadinessStatus: report.health.rollbackReadinessStatus,
        queueImpact: report.health.queueImpact,
      },
    );
  });
}

function createRollbackOperationalHealth(descriptor, status, assessment, persistence, recovery, stateEnvelope, restartPlan, runtime = {}) {
  const lifecycleControls = assessment.lifecycleControls || {};
  const providerContract = assessment.providerContract || status.providerContract || {};
  const runtimeReports = collectRuntimeOperationalHealth(runtime);
  const runtimeSignals = runtimeHealthSignals(runtimeReports);
  const providerOperationReports = collectProviderOperationReports(runtime);
  const providerOperationHealthSignals = providerOperationSignals(providerOperationReports);
  const providerLeaseState = normalizeState(
    providerContract.externalHandoff?.leaseState
      || providerContract.lease?.state
      || status.externalHandoff?.leaseState
      || status.providerContract?.lease?.state,
    'unknown',
  );
  const providerOffline = ['offline', 'disabled', 'blocked'].includes(providerContract.serviceState);
  const providerStale = providerContract.sync?.stale === true
    || providerContract.sync?.ready === false;
  const providerNegotiationBlocked = providerContract.capabilityNegotiation?.satisfied === false
    || (providerContract.capabilityNegotiation?.missing || []).length > 0;
  const missingToken = providerLeaseState === 'missing_token';
  const expiredLease = providerLeaseState === 'expired' || recovery.leaseState === 'lease_expired';
  const terminalFailure = ['blocked', 'failed'].includes(recovery.latestState);
  const duplicateWriteBlocked = persistence.restartSafety?.duplicateDetected === true
    && !persistence.command?.replayOf
    && persistence.command?.canEnqueue !== true;
  const signals = [
    createOperationalSignal(
      'mailchimp.rollback.health.inverse_action',
      Boolean(assessment.inverseAction),
      assessment.inverseAction ? 'info' : 'error',
      assessment.inverseAction
        ? 'Rollback has a deterministic inverse Mailchimp action.'
        : `Action "${descriptor.action || 'unknown'}" cannot be rolled back deterministically.`,
      {
        field: 'action',
        owner: 'runtime',
        action: 'choose_reversible_mailchimp_action',
        terminal: !assessment.inverseAction,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.idempotency',
      Boolean(descriptor.idempotencyKey),
      descriptor.idempotencyKey ? 'info' : 'error',
      descriptor.idempotencyKey
        ? 'Rollback has an original idempotency key for deterministic retry and audit binding.'
        : 'Rollback health is blocked until the original idempotency key is supplied.',
      {
        field: 'idempotencyKey',
        owner: 'caller',
        action: 'supply_original_idempotency_key',
        terminal: false,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.provider_available',
      providerOffline === false,
      providerOffline ? 'error' : providerStale || providerNegotiationBlocked ? 'warning' : 'info',
      providerOffline
        ? 'Mailchimp provider contract is offline for rollback recovery.'
        : providerStale
          ? 'Mailchimp provider status is stale or not ready; refresh before queueing rollback.'
          : providerNegotiationBlocked
            ? 'Mailchimp provider capability negotiation is not satisfied.'
            : 'Mailchimp provider contract is available for rollback recovery.',
      {
        field: 'providerContract',
        owner: 'adapter',
        action: providerOffline || providerStale || providerNegotiationBlocked
          ? providerContract.nextAction || 'refresh_provider_before_rollback'
          : 'continue_rollback_readiness',
        retryable: providerOffline === false && (providerStale || providerNegotiationBlocked),
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.provider_contract_ready',
      providerContract.ready === true,
      providerContract.ready === true ? 'info' : providerOffline || providerNegotiationBlocked ? 'error' : 'warning',
      providerContract.ready === true
        ? 'Mailchimp provider service contract is ready for rollback queueing.'
        : `Mailchimp provider service contract requires "${providerContract.nextAction || 'refresh_provider_before_rollback'}".`,
      {
        field: 'providerContract.ready',
        owner: providerLeaseState === 'missing_token' ? 'operator' : 'adapter',
        action: providerContract.nextAction || 'refresh_provider_before_rollback',
        retryable: providerOffline === false && providerLeaseState !== 'missing_token',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.provider_lease',
      !missingToken && !expiredLease,
      missingToken ? 'error' : expiredLease ? 'warning' : 'info',
      missingToken
        ? 'Mailchimp provider token is missing; operator reauthorization is required before rollback can resume.'
        : expiredLease
          ? 'Mailchimp provider lease expired; refresh the handoff lease before retrying rollback.'
          : `Mailchimp provider lease is "${providerLeaseState}".`,
      {
        field: 'providerLease',
        owner: missingToken ? 'operator' : 'adapter',
        action: missingToken ? 'reauthorize_mailchimp_provider' : expiredLease ? 'refresh_provider_before_rollback' : 'continue_rollback_readiness',
        retryable: expiredLease,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.tenant_boundary',
      assessment.permissionBoundary?.allowed === true,
      assessment.permissionBoundary?.allowed === true ? 'info' : 'error',
      assessment.permissionBoundary?.allowed === true
        ? 'Tenant permission boundary permits rollback handoff.'
        : 'Tenant permission boundary blocks rollback handoff.',
      {
        field: 'tenantPermissionBoundary',
        owner: 'operator',
        action: assessment.permissionBoundary?.nextAction || 'resolve_tenant_permission_boundary',
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.lifecycle_controls',
      lifecycleControls.canProceed === true,
      lifecycleControls.canProceed === true ? 'info' : lifecycleControls.warnings?.length > 0 ? 'warning' : 'error',
      lifecycleControls.canProceed === true
        ? 'Rollback lifecycle controls permit queueing.'
        : `Rollback lifecycle controls require "${lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls'}".`,
      {
        field: 'rollbackLifecycleControls',
        owner: 'operator',
        action: lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls',
        retryable: lifecycleControls.warnings?.length > 0,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.persistence',
      persistence.command?.canEnqueue === true || Boolean(persistence.command?.replayOf),
      persistence.command?.canEnqueue === true || persistence.command?.replayOf ? 'info' : duplicateWriteBlocked ? 'warning' : 'error',
      persistence.command?.canEnqueue === true
        ? 'Rollback command can be enqueued with a deterministic checkpoint.'
        : persistence.command?.replayOf
          ? 'Rollback command reuses an existing deterministic checkpoint.'
          : duplicateWriteBlocked
            ? 'Rollback write is held because a duplicate command was detected without replay metadata.'
            : 'Rollback command persistence is not ready for queueing.',
      {
        field: 'persistence',
        owner: 'runtime',
        action: duplicateWriteBlocked ? 'surface_existing_rollback_command' : 'restore_rollback_command_state',
        retryable: duplicateWriteBlocked,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.recovery_state',
      terminalFailure === false,
      terminalFailure ? 'error' : recovery.retryable ? 'warning' : 'info',
      terminalFailure
        ? `Rollback recovery is in terminal failure state "${recovery.latestState}".`
        : recovery.retryable
          ? `Rollback recovery state "${recovery.latestState}" is retryable after provider refresh.`
          : `Rollback recovery state is "${recovery.latestState || 'unknown'}".`,
      {
        field: 'recovery',
        owner: terminalFailure ? 'operator' : 'adapter',
        action: terminalFailure ? 'escalate_rollback_recovery' : recovery.retryable ? 'refresh_provider_before_rollback' : 'continue_rollback_readiness',
        retryable: recovery.retryable === true && terminalFailure === false,
        terminal: terminalFailure,
      },
    ),
    createOperationalSignal(
      'mailchimp.rollback.health.restart_conflict',
      stateEnvelope.restartSafety?.statusConflict !== true,
      stateEnvelope.restartSafety?.statusConflict === true ? 'error' : 'info',
      stateEnvelope.restartSafety?.statusConflict === true
        ? 'Persisted rollback checkpoint conflicts with live recovery status and requires review.'
        : 'Persisted rollback checkpoint does not conflict with live recovery status.',
      {
        field: 'persistedState',
        owner: 'operator',
        action: 'surface_persisted_status_conflict',
      },
    ),
    ...runtimeSignals,
    ...providerOperationHealthSignals,
  ];
  const healthState = healthStateFromSignals(signals, recovery, restartPlan);
  const actionableErrors = buildRollbackActionableErrors(signals);
  const retryPolicy = buildRollbackRetryPolicy(signals, recovery, restartPlan, {
    retryPolicy: {
      baseMs: ROLLBACK_HEALTH_RETRY_BASE_MS,
      maxMs: ROLLBACK_HEALTH_RETRY_MAX_MS,
      ...(runtime.retryPolicy || runtime.rollbackRetry || {}),
    },
    rollbackRetryAttempt: runtime.rollbackRetryAttempt,
  });
  const degradedMode = {
    active: healthState === 'degraded',
    reason: healthState === 'degraded'
      ? actionableErrors.map((error) => error.code).sort().join(',') || 'provider_refresh_required'
      : '',
    readOnly: healthState !== 'healthy' && healthState !== 'terminal_success',
    externalWritesSuppressed: healthState !== 'healthy' || assessment.canRollback !== true,
    allowedActions: healthState === 'degraded'
      ? ['refresh_provider_before_rollback', 'observe_rollback_command', 'inspect_rollback_health']
      : healthState === 'healthy'
        ? ['queue_rollback_manifest', 'observe_rollback_command']
        : ['inspect_rollback_health'],
  };

  return {
    protocol: 'aios.rollback-operational-health.mailchimp.v1',
    healthState,
    healthy: healthState === 'healthy' || healthState === 'terminal_success',
    degraded: degradedMode.active,
    canQueue: healthState === 'healthy'
      && assessment.canRollback === true
      && lifecycleControls.canProceed === true
      && persistence.command?.canEnqueue === true
      && recovery.ready === true
      && restartPlan.guards?.requiresConflictReview !== true,
    failureState: {
      state: terminalFailure ? recovery.latestState : healthState,
      terminal: terminalFailure || healthState === 'terminal_success',
      code: actionableErrors[0]?.code || '',
      message: actionableErrors[0]?.message || '',
      nextAction: actionableErrors[0]?.action || restartPlan.nextAction || recovery.nextAction || 'inspect_rollback_health',
    },
    retryPolicy,
    degradedMode,
    runtimeHealth: {
      reports: runtimeReports,
      blocked: runtimeReports.filter((report) => report.failed),
      degraded: runtimeReports.filter((report) => report.degraded && !report.failed),
      retryable: runtimeReports.filter((report) => report.retryable),
      nextAction: runtimeSignals.find((signal) => signal.ok === false)?.action || 'continue_rollback_readiness',
    },
    providerOperations: {
      reports: providerOperationReports,
      blocked: providerOperationReports.filter((report) => report.failed),
      degraded: providerOperationReports.filter((report) => report.degraded && !report.failed),
      ready: providerOperationReports.filter((report) => report.ready),
      missingCapabilities: [...new Set(providerOperationReports.flatMap((report) => report.capabilityNegotiation.missing))].sort(),
      nextAction: providerOperationHealthSignals.find((signal) => signal.ok === false)?.action || 'continue_rollback_readiness',
    },
    signals,
    actionableErrors,
    blockers: actionableErrors.filter((error) => error.severity === 'error').map((error) => error.code),
    warnings: actionableErrors.filter((error) => error.severity === 'warning').map((error) => error.code),
    nextAction: actionableErrors[0]?.action
      || (retryPolicy.eligible ? retryPolicy.nextAction : restartPlan.nextAction)
      || 'queue_rollback_manifest',
  };
}

function buildRollbackStateEnvelope(descriptor, status, persistence, recovery, runtime = {}) {
  const checkpoint = normalizePersistedCheckpoint(runtime);
  const command = persistence.command || {};
  const rollbackRequestId = command.requestId || `${descriptor.requestId}:rollback`;
  const rollbackIdempotencyKey = command.idempotencyKey || (descriptor.idempotencyKey ? `${descriptor.idempotencyKey}:rollback` : '');
  const latestCommand = pickLatestCommand(persistence.ledger?.matchingCommands || []);
  const commandState = normalizeState(
    command.state === 'replay_existing_command'
      ? latestCommand?.state || checkpoint.commandState || command.state
      : command.state || checkpoint.commandState || latestCommand?.state,
    'untracked',
  );
  const persistedState = chooseRestartState(
    recovery.latestState,
    commandState,
    checkpoint.statusState,
    checkpoint.handoffState,
    status.state,
  );
  const checkpointMatches = Boolean(
    (checkpoint.rollbackRequestId && checkpoint.rollbackRequestId === rollbackRequestId)
      || (checkpoint.rollbackIdempotencyKey && checkpoint.rollbackIdempotencyKey === rollbackIdempotencyKey)
      || (checkpoint.commandId && checkpoint.commandId === command.commandId)
      || (checkpoint.handoffRequestId && checkpoint.handoffRequestId === recovery.providerRequestId),
  );
  const stateConflict = Boolean(
    checkpointMatches
      && checkpoint.statusState
      && recovery.latestState
      && checkpoint.statusState !== recovery.latestState
      && stateRank(checkpoint.statusState) > stateRank(recovery.latestState)
  );
  const restartTerminal = RECOVERY_TERMINAL_STATES.includes(persistedState)
    || recovery.terminal === true
    || checkpoint.statusTerminal === true;
  const writeIntent = command.canEnqueue === true
    ? 'append_command_and_checkpoint'
    : command.replayOf
      ? 'reuse_existing_checkpoint'
      : recovery.retryable === true
        ? 'refresh_checkpoint_before_write'
        : 'read_only_checkpoint';

  return {
    protocol: 'aios.rollback-state-envelope.mailchimp.v1',
    schemaVersion: checkpoint.schemaVersion,
    store: persistence.store || 'local-runtime',
    key: rollbackIdempotencyKey || rollbackRequestId,
    rollbackRequestId,
    rollbackIdempotencyKey,
    checkpointId: checkpoint.checkpointId || `mailchimp.rollback.checkpoint:${descriptor.tenant || 'tenant'}:${rollbackRequestId}`,
    epoch: checkpoint.epoch || `rollback:${descriptor.requestId || 'request'}`,
    savedAt: checkpoint.savedAt,
    checkpointMatches,
    stateConflict,
    persistedState,
    restartTerminal,
    writeIntent,
    command: {
      commandId: command.commandId || checkpoint.commandId || latestCommand?.commandId || '',
      state: commandState,
      replayOf: command.replayOf || '',
      latestLedgerCommandId: latestCommand?.commandId || '',
      latestLedgerState: latestCommand?.state || '',
    },
    status: {
      snapshotState: status.state || 'unknown',
      checkpointState: checkpoint.statusState || '',
      externalHandoffState: status.externalHandoff?.state || checkpoint.handoffState || 'local_only',
      providerRequestId: recovery.providerRequestId || checkpoint.handoffRequestId || '',
      leaseState: recovery.leaseState || checkpoint.handoffLeaseState || 'unknown',
    },
    clientMutationId: checkpoint.clientMutationId || '',
    restartSafety: {
      idempotent: Boolean(rollbackIdempotencyKey),
      replaySafe: persistence.restartSafety?.replaySafe === true || Boolean(checkpointMatches && rollbackIdempotencyKey),
      duplicateDetected: persistence.restartSafety?.duplicateDetected === true,
      staleCheckpoint: Boolean(checkpoint.savedAt && !checkpointMatches),
      statusConflict: stateConflict,
    },
  };
}

function buildRollbackRestartPlan(stateEnvelope, recovery, persistence) {
  const retryable = recovery.retryable === true || RECOVERY_RETRYABLE_STATES.includes(stateEnvelope.status.leaseState);
  const commandState = stateEnvelope.command.state;
  const terminal = stateEnvelope.restartTerminal === true;
  const replaySafe = stateEnvelope.restartSafety.replaySafe === true;
  const stale = stateEnvelope.restartSafety.staleCheckpoint === true;
  const conflict = stateEnvelope.restartSafety.statusConflict === true;
  const commandActive = ['pending_enqueue', 'queued', 'running'].includes(commandState);
  const commandReplay = Boolean(persistence.command?.replayOf || stateEnvelope.command.latestLedgerCommandId);
  const mode = terminal
    ? 'recover_terminal_status'
    : conflict
      ? 'prefer_persisted_terminal_checkpoint'
      : stale
        ? 'discard_stale_checkpoint'
        : commandReplay
          ? 'resume_existing_command'
          : commandActive && replaySafe
            ? 'resume_idempotent_command'
            : retryable
              ? 'refresh_status_then_resume'
              : persistence.command?.canEnqueue === true
                ? 'enqueue_with_checkpoint'
                : 'hold_local_state';
  const canResume = !['hold_local_state'].includes(mode) && replaySafe && conflict === false;
  const statusSemantics = terminal
    ? 'terminal_status_wins'
    : commandReplay || commandActive
      ? 'persisted_command_wins'
      : stale
        ? 'live_status_wins'
        : 'checkpoint_status_wins';

  return {
    protocol: 'aios.rollback-restart-plan.mailchimp.v1',
    mode,
    canResume,
    idempotentCommand: stateEnvelope.restartSafety.idempotent,
    statusSemantics,
    nextAction: terminal
      ? 'archive_rollback_audit'
      : conflict
        ? 'surface_persisted_status_conflict'
        : stale
          ? 'refresh_rollback_checkpoint'
          : commandReplay
            ? 'observe_existing_rollback_command'
            : commandActive && replaySafe
              ? 'resume_rollback_command'
              : retryable
                ? 'refresh_provider_before_rollback'
                : persistence.command?.canEnqueue === true
                  ? 'queue_rollback_manifest'
                  : 'restore_rollback_command_state',
    resumeToken: [
      stateEnvelope.key,
      stateEnvelope.command.commandId,
      stateEnvelope.epoch,
    ].filter(Boolean).join('#'),
    guards: {
      requiresFreshStatus: retryable || stale,
      requiresOperatorReplayNotice: commandReplay,
      requiresConflictReview: conflict,
      blocksDuplicateWrite: stateEnvelope.restartSafety.duplicateDetected,
    },
  };
}

function buildRollbackPersistence(descriptor, assessment, runtime = {}) {
  const ledger = normalizeRollbackLedger(runtime);
  const rollbackRequestId = `${descriptor.requestId}:rollback`;
  const rollbackIdempotencyKey = descriptor.idempotencyKey ? `${descriptor.idempotencyKey}:rollback` : '';
  const matchingCommands = ledger.commands.filter((command) => (
    (rollbackIdempotencyKey && command.idempotencyKey === rollbackIdempotencyKey)
      || command.requestId === rollbackRequestId
  ));
  const terminalReplay = matchingCommands.find((command) => ['queued', 'running', 'rolled_back', 'succeeded'].includes(command.state));
  const commandId = compactString(runtime.rollbackCommandId)
    || `mailchimp.rollback:${descriptor.tenant || 'tenant'}:${descriptor.requestId || 'request'}`;
  const canEnqueue = assessment.canRollback === true && !terminalReplay;
  const nextCommandState = canEnqueue
    ? 'pending_enqueue'
    : terminalReplay
      ? 'replay_existing_command'
      : 'blocked';

  return {
    protocol: 'aios.rollback-persistence.mailchimp.v1',
    store: ledger.store,
    version: ledger.version,
    loadedAt: ledger.loadedAt,
    command: {
      commandId,
      requestId: rollbackRequestId,
      idempotencyKey: rollbackIdempotencyKey,
      action: assessment.inverseAction || 'rollback_unavailable',
      state: nextCommandState,
      canEnqueue,
      replayOf: terminalReplay?.commandId || '',
    },
    restartSafety: {
      idempotent: Boolean(rollbackIdempotencyKey),
      duplicateDetected: matchingCommands.length > 0,
      replaySafe: Boolean(terminalReplay || rollbackIdempotencyKey),
      matchedCommandCount: matchingCommands.length,
    },
    ledger: {
      commandCount: ledger.commands.length,
      matchingCommands,
    },
  };
}

function buildRollbackRecoveryHandoff(descriptor, status, assessment, persistence, runtime = {}) {
  const rollbackRequestId = `${descriptor.requestId}:rollback`;
  const rollbackIdempotencyKey = descriptor.idempotencyKey ? `${descriptor.idempotencyKey}:rollback` : '';
  const providerContract = assessment.providerContract || status.providerContract || {};
  const providerRequestId = compactString(
    providerContract.externalHandoff?.requestId
      || status.externalHandoff?.requestId
      || providerContract.sync?.requestId
      || status.providerContract?.sync?.requestId,
  );
  const events = normalizeRecoveryEvents(runtime);
  const matchingEvents = events.filter((event) => (
    eventMatchesRollback(event, rollbackRequestId, rollbackIdempotencyKey, providerRequestId)
  ));
  const latestEvent = matchingEvents[matchingEvents.length - 1] || null;
  const latestState = latestEvent?.state || normalizeState(status.externalHandoff?.state || status.state, 'unknown');
  const leaseState = normalizeState(
    latestEvent?.leaseState
      || providerContract.externalHandoff?.leaseState
      || providerContract.lease?.state
      || status.externalHandoff?.leaseState
      || status.providerContract?.lease?.state,
    'unknown',
  );
  const terminalSuccess = RECOVERY_SUCCESS_STATES.includes(latestState) || latestEvent?.state === 'rolled_back';
  const terminalFailure = ['blocked', 'failed'].includes(latestState);
  const retryable = latestEvent?.retryable === true || RECOVERY_RETRYABLE_STATES.includes(latestState) || RECOVERY_RETRYABLE_STATES.includes(leaseState);
  const providerOffline = ['offline', 'disabled', 'blocked'].includes(providerContract.serviceState);
  const providerBlocked = providerContract.ready === false;
  const replayingCommand = Boolean(persistence.command?.replayOf);
  const canResume = assessment.canRollback === true
    && terminalFailure === false
    && providerOffline === false
    && providerBlocked === false
    && leaseState !== 'missing_token';
  const resumeMode = terminalSuccess
    ? 'observe_terminal_success'
    : replayingCommand
      ? 'observe_persisted_command'
      : terminalFailure
        ? 'manual_recovery_required'
        : retryable
          ? 'refresh_then_resume'
          : canResume
            ? 'enqueue_or_resume'
            : 'local_block';
  const ready = ['observe_terminal_success', 'observe_persisted_command', 'enqueue_or_resume'].includes(resumeMode);
  const validation = [
    {
      code: 'mailchimp.rollback.recovery.status_snapshot',
      ok: Boolean(status.state),
      severity: status.state ? 'info' : 'warning',
      message: status.state
        ? `Status snapshot is bound as "${status.state}".`
        : 'Status snapshot is missing a state for recovery binding.',
    },
    {
      code: 'mailchimp.rollback.recovery.idempotency_binding',
      ok: Boolean(rollbackIdempotencyKey),
      severity: rollbackIdempotencyKey ? 'info' : 'error',
      message: rollbackIdempotencyKey
        ? 'Rollback recovery can bind observations to a deterministic idempotency key.'
        : 'Rollback recovery cannot bind observations without an idempotency key.',
    },
    {
      code: 'mailchimp.rollback.recovery.provider_available',
      ok: providerOffline === false && providerBlocked === false,
      severity: providerOffline || providerBlocked ? 'error' : 'info',
      message: providerOffline
        ? 'Provider contract reports Mailchimp as offline for rollback recovery.'
        : providerBlocked
          ? `Provider contract is not ready for rollback recovery: ${providerContract.nextAction || 'refresh_provider_before_rollback'}.`
          : 'Provider contract is ready for rollback recovery.',
    },
    {
      code: 'mailchimp.rollback.recovery.lease',
      ok: !['expired', 'missing_token'].includes(leaseState),
      severity: ['expired', 'missing_token'].includes(leaseState) ? 'warning' : 'info',
      message: ['expired', 'missing_token'].includes(leaseState)
        ? `Provider lease is "${leaseState}" and must be refreshed before rollback resumes.`
        : `Provider lease state is "${leaseState}".`,
    },
    {
      code: 'mailchimp.rollback.recovery.no_failed_terminal',
      ok: terminalFailure === false,
      severity: terminalFailure ? 'error' : 'info',
      message: terminalFailure
        ? `Latest rollback recovery state is terminal "${latestState}".`
        : 'No terminal rollback recovery failure is bound to this request.',
    },
  ];

  return {
    protocol: 'aios.rollback-recovery-handoff.mailchimp.v1',
    rollbackRequestId,
    rollbackIdempotencyKey,
    providerRequestId,
    resumeMode,
    ready,
    terminal: terminalSuccess || terminalFailure,
    latestState,
    leaseState,
    retryable,
    replayingCommand,
    statusBinding: {
      state: status.state,
      terminal: status.terminal === true,
      externalHandoffState: status.externalHandoff?.state || 'local_only',
      providerContractReady: providerContract.ready === true,
      providerServiceState: providerContract.serviceState || status.providerContract?.serviceState || 'unknown',
      providerLeaseState: providerContract.externalHandoff?.leaseState
        || providerContract.lease?.state
        || status.externalHandoff?.leaseState
        || status.providerContract?.lease?.state
        || 'unknown',
      providerSyncCursor: providerContract.sync?.cursor || '',
    },
    checkpoint: {
      eventCount: events.length,
      matchingEventCount: matchingEvents.length,
      latestEventId: latestEvent?.eventId || '',
      latestObservedAt: latestEvent?.observedAt || '',
      latestMessage: latestEvent?.message || '',
    },
    validation,
    blockers: validation.filter((item) => item.severity === 'error' || (item.severity === 'warning' && item.ok === false)).map((item) => item.code),
    nextAction: terminalSuccess
      ? 'archive_rollback_audit'
      : replayingCommand
        ? 'observe_existing_rollback_command'
        : terminalFailure
          ? 'escalate_rollback_recovery'
          : retryable
            ? 'refresh_provider_before_rollback'
            : ready
              ? 'queue_rollback_manifest'
              : 'keep_rollback_local',
  };
}

function buildClientRuntimeAdoption(status, assessment, acceptance, runtime = {}) {
  const clientState = normalizeClientState(runtime);
  const workflowHandoff = buildRollbackWorkflowHandoff(status, assessment, acceptance, runtime);
  const readiness = status.readiness || {};
  const lifecycle = status.lifecycle || {};
  const persistence = assessment.persistence || {};
  const restartPlan = assessment.restartPlan || {};
  const stateEnvelope = assessment.stateEnvelope || {};
  const permissionBoundary = assessment.permissionBoundary || {};
  const lifecycleControls = assessment.lifecycleControls || {};
  const providerContract = assessment.providerContract || status.providerContract || {};
  const providerBlocked = providerContract.ready !== true
    || providerContract.capabilityNegotiation?.satisfied === false
    || providerContract.sync?.stale === true
    || providerContract.sync?.ready === false
    || ['offline', 'disabled', 'blocked'].includes(providerContract.serviceState)
    || ['expired', 'missing_token'].includes(providerContract.lease?.state);
  const acceptanceBlocked = acceptance.required === true && acceptance.ready !== true;
  const previewBlocked = assessment.preview?.readiness?.ready !== true || clientState.acknowledgedPreview !== true;
  const lifecycleBlocked = lifecycleControls.canProceed !== true;
  const boundaryBlocked = permissionBoundary.allowed !== true;
  const persistenceBlocked = persistence.command?.canEnqueue === false && !persistence.command?.replayOf;
  const recovery = assessment.recovery || {};
  const operationalHealth = assessment.operationalHealth || {};
  const recoveryBlocked = recovery.ready === false && recovery.resumeMode !== 'refresh_then_resume';
  const healthBlocked = ['blocked', 'failed'].includes(operationalHealth.healthState);
  const adoptionBlocked = providerBlocked
    || acceptanceBlocked
    || previewBlocked
    || lifecycleBlocked
    || boundaryBlocked
    || persistenceBlocked
    || recoveryBlocked
    || healthBlocked
    || assessment.canRollback !== true;
  const nextAction = adoptionBlocked
    ? providerBlocked
      ? 'refresh_provider_before_rollback'
      : acceptanceBlocked
        ? 'request_operator_acceptance'
        : previewBlocked
          ? 'present_rollback_preview'
          : lifecycleBlocked
            ? lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls'
            : boundaryBlocked
              ? permissionBoundary.nextAction || 'resolve_tenant_permission_boundary'
              : persistenceBlocked
                ? 'restore_rollback_command_state'
                : recoveryBlocked
                  ? recovery.nextAction || 'inspect_rollback_recovery'
                  : healthBlocked
                    ? operationalHealth.nextAction || 'inspect_rollback_health'
                    : 'keep_rollback_local'
    : restartPlan.nextAction && restartPlan.nextAction !== 'queue_rollback_manifest'
      ? restartPlan.nextAction
    : persistence.command?.replayOf
      ? 'surface_existing_rollback_command'
      : recovery.resumeMode === 'observe_terminal_success'
        ? 'archive_rollback_audit'
      : lifecycle.nextAction === 'operator_hold'
      ? 'release_lifecycle_hold'
      : 'queue_rollback_manifest';

  return {
    protocol: 'aios.rollback-client-adoption.mailchimp.v1',
    clientState,
    adopted: adoptionBlocked === false,
    nextAction,
    workflowHandoff,
    runtimeContract: {
      statusState: status.state,
      readinessReady: readiness.ready === true,
      readinessNextStep: readiness.nextStep || 'inspect_status',
      lifecycleNextAction: lifecycle.nextAction || 'unknown',
      providerContractReady: providerContract.ready === true,
      providerContractNextAction: providerContract.nextAction || 'refresh_provider_before_rollback',
      providerMissingCapabilities: providerContract.capabilityNegotiation?.missing || [],
      providerSyncCursor: providerContract.sync?.cursor || '',
      providerSyncStale: providerContract.sync?.stale === true,
      providerExternalRequestId: providerContract.externalHandoff?.requestId || status.externalHandoff?.requestId || '',
      providerHandoffState: providerContract.externalHandoff?.state || status.externalHandoff?.state || 'local_only',
      providerLeaseState: providerContract.lease?.state || status.externalHandoff?.leaseState || status.providerContract?.lease?.state || 'unknown',
      canWriteExternally: assessment.truthBoundary?.externalWritesAllowed === true,
      lifecycleControlsEnabled: lifecycleControls.enabled === true,
      lifecycleControlsReady: lifecycleControls.canProceed === true,
      lifecycleHoldState: lifecycleControls.holdState || 'unknown',
      lifecycleNextAction: lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls',
      lifecycleRequestedCommand: lifecycleControls.controls?.requestedCommand || '',
      lifecycleScheduleMode: lifecycleControls.schedule?.mode || 'immediate',
      lifecycleScheduleWindowState: lifecycleControls.schedule?.windowState || 'inside_window',
      tenantBoundaryAllowed: permissionBoundary.allowed === true,
      tenantBoundaryAuditRef: permissionBoundary.audit?.auditRef || '',
      tenantBoundaryActorId: permissionBoundary.actor?.id || '',
      tenantBoundaryWorkspace: permissionBoundary.scope?.workspace || '',
      rollbackCommandState: persistence.command?.state || 'untracked',
      rollbackCommandId: persistence.command?.commandId || '',
      recoveryResumeMode: recovery.resumeMode || 'untracked',
      recoveryLatestState: recovery.latestState || 'unknown',
      restartMode: restartPlan.mode || 'untracked',
      restartCanResume: restartPlan.canResume === true,
      restartStatusSemantics: restartPlan.statusSemantics || 'unknown',
      operationalHealthState: operationalHealth.healthState || 'unknown',
      operationalHealthCanQueue: operationalHealth.canQueue === true,
      operationalHealthNextAction: operationalHealth.nextAction || 'inspect_rollback_health',
      operationalHealthRetryEligible: operationalHealth.retryPolicy?.eligible === true,
      operationalHealthBackoffMs: operationalHealth.retryPolicy?.backoffMs || 0,
      operationalHealthDegraded: operationalHealth.degraded === true,
      persistedState: stateEnvelope.persistedState || 'unknown',
      persistedCheckpointId: stateEnvelope.checkpointId || '',
      persistedStateConflict: stateEnvelope.restartSafety?.statusConflict === true,
      workflowCurrentStepId: workflowHandoff.currentStepId,
      workflowCurrentAction: workflowHandoff.currentAction,
      workflowReadyForQueue: workflowHandoff.readyForQueue,
      workflowClientMutationId: workflowHandoff.clientMutation.id,
    },
    blockers: [
      ...(assessment.canRollback === true ? [] : ['rollback_not_ready']),
      ...(providerBlocked ? ['provider_contract_not_ready'] : []),
      ...(acceptanceBlocked ? ['operator_acceptance_required'] : []),
      ...(previewBlocked ? ['preview_acknowledgement_required'] : []),
      ...(lifecycleBlocked ? ['rollback_lifecycle_controls_not_ready'] : []),
      ...(boundaryBlocked ? ['tenant_permission_boundary_not_ready'] : []),
      ...(persistenceBlocked ? ['rollback_persistence_not_ready'] : []),
      ...(recoveryBlocked ? ['rollback_recovery_not_ready'] : []),
      ...(healthBlocked ? ['rollback_operational_health_not_ready'] : []),
      ...(restartPlan.guards?.requiresConflictReview === true ? ['rollback_restart_conflict_review_required'] : []),
    ],
  };
}

function validationSeverityRank(severity) {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  if (severity === 'info') return 2;
  return 3;
}

function normalizeReviewSignal(item = {}, source = 'runtime', index = 0) {
  const severity = normalizeState(item.severity || (item.ok === false ? 'error' : 'info'), 'info');
  const ok = item.ok === true || severity === 'info';
  return {
    index,
    source,
    code: compactString(item.code || `${source}.validation.${index}`),
    ok,
    severity,
    field: compactString(item.field || source),
    owner: compactString(item.owner || (source === 'provider' ? 'adapter' : 'operator')),
    action: compactString(item.action || item.nextAction || 'inspect_rollback_readiness'),
    message: compactString(item.message || item.reason || 'Rollback validation signal was observed.'),
    retryable: item.retryable === true,
    terminal: item.terminal === true,
  };
}

function collectClientReviewSignals(assessment = {}) {
  const sources = [
    ['preview', assessment.preview?.readiness?.validation || []],
    ['lifecycle', assessment.lifecycleControls?.validation || []],
    ['provider', assessment.providerContract?.validation || []],
    ['recovery', assessment.recovery?.validation || []],
    ['tenant_permission', assessment.permissionBoundary?.validation || []],
    ['operational_health', assessment.operationalHealth?.signals || []],
    ['diagnostics', (assessment.diagnostics || []).map((diagnostic) => ({
      ...diagnostic,
      ok: !['error', 'warning'].includes(normalizeState(diagnostic.severity, 'info')),
      action: diagnostic.action || 'resolve_blocking_validation',
      owner: diagnostic.owner || 'runtime',
    }))],
  ];

  return sources
    .flatMap(([source, items]) => items.map((item, index) => normalizeReviewSignal(item, source, index)))
    .sort((left, right) => [
      validationSeverityRank(left.severity).toString(),
      left.ok ? '1' : '0',
      left.source,
      left.code,
    ].join('|').localeCompare([
      validationSeverityRank(right.severity).toString(),
      right.ok ? '1' : '0',
      right.source,
      right.code,
    ].join('|')));
}

function summarizeClientReviewSection(id, label, signals, readyFallback = false, nextAction = 'inspect_rollback_readiness') {
  const sectionSignals = signals.filter((signal) => signal.source === id);
  const blockingSignals = sectionSignals.filter((signal) => signal.ok === false && signal.severity === 'error');
  const warningSignals = sectionSignals.filter((signal) => signal.ok === false && signal.severity === 'warning');
  const primarySignal = blockingSignals[0] || warningSignals[0] || sectionSignals.find((signal) => signal.ok === true) || null;

  return {
    id,
    label,
    ready: sectionSignals.length > 0
      ? blockingSignals.length === 0 && warningSignals.length === 0
      : readyFallback === true,
    state: blockingSignals.length > 0
      ? 'blocked'
      : warningSignals.length > 0
        ? 'needs_attention'
        : readyFallback || sectionSignals.some((signal) => signal.ok === true)
          ? 'ready'
          : 'unobserved',
    blocking: blockingSignals.length,
    warnings: warningSignals.length,
    primaryCode: primarySignal?.code || '',
    primaryMessage: primarySignal?.message || '',
    nextAction: blockingSignals[0]?.action || warningSignals[0]?.action || nextAction,
  };
}

function buildValidationSummaryContract(assessment = {}) {
  const signals = collectClientReviewSignals(assessment);
  const blockingSignals = signals.filter((signal) => signal.ok === false && signal.severity === 'error');
  const warningSignals = signals.filter((signal) => signal.ok === false && signal.severity === 'warning');
  const retryableSignals = signals.filter((signal) => signal.ok === false && signal.retryable === true);
  const terminalSignals = signals.filter((signal) => signal.ok === false && signal.terminal === true);
  const sections = [
    summarizeClientReviewSection('preview', 'Preview', signals, assessment.preview?.readiness?.ready === true, 'present_rollback_preview'),
    summarizeClientReviewSection('tenant_permission', 'Tenant permission', signals, assessment.permissionBoundary?.allowed === true, assessment.permissionBoundary?.nextAction || 'resolve_tenant_permission_boundary'),
    summarizeClientReviewSection('lifecycle', 'Lifecycle controls', signals, assessment.lifecycleControls?.canProceed === true, assessment.lifecycleControls?.nextAction || 'inspect_rollback_lifecycle_controls'),
    summarizeClientReviewSection('provider', 'Provider handoff', signals, assessment.providerContract?.ready === true, assessment.providerContract?.nextAction || 'refresh_provider_before_rollback'),
    summarizeClientReviewSection('recovery', 'Recovery binding', signals, assessment.recovery?.ready === true, assessment.recovery?.nextAction || 'inspect_rollback_recovery'),
    summarizeClientReviewSection('operational_health', 'Operational health', signals, assessment.operationalHealth?.healthy === true, assessment.operationalHealth?.nextAction || 'inspect_rollback_health'),
    summarizeClientReviewSection('diagnostics', 'Compiler diagnostics', signals, (assessment.diagnostics || []).length === 0, 'resolve_blocking_validation'),
  ];

  return {
    protocol: 'aios.rollback-validation-summary.mailchimp.v1',
    ready: blockingSignals.length === 0 && warningSignals.length === 0,
    total: signals.length,
    passing: signals.filter((signal) => signal.ok === true).length,
    blocking: blockingSignals.length,
    warnings: warningSignals.length,
    retryable: retryableSignals.length,
    terminal: terminalSignals.length,
    primaryBlocker: blockingSignals[0]?.code || warningSignals[0]?.code || '',
    primaryMessage: blockingSignals[0]?.message || warningSignals[0]?.message || '',
    bySeverity: countBy(signals, (signal) => signal.severity),
    byOwner: countBy(signals, (signal) => signal.owner || 'runtime'),
    sections,
    actionable: [...blockingSignals, ...warningSignals].slice(0, 8),
  };
}

function buildRollbackNextStepExplanation(assessment = {}, acceptance = {}, clientRuntime = {}, validationSummary = {}) {
  const workflow = clientRuntime.workflowHandoff || {};
  const persistence = assessment.persistence || {};
  const recovery = assessment.recovery || {};
  const analyticsReport = assessment.analyticsReport || {};
  const acceptanceBlocked = acceptance.required === true && acceptance.ready !== true;
  const previewBlocked = assessment.preview?.readiness?.ready !== true || workflow.steps?.[0]?.acknowledged !== true;
  const action = validationSummary.primaryBlocker
    ? validationSummary.actionable[0]?.action || 'resolve_blocking_validation'
    : previewBlocked
      ? 'present_rollback_preview'
      : acceptanceBlocked
        ? 'request_operator_acceptance'
        : workflow.readyForQueue === true
          ? persistence.command?.replayOf
            ? 'surface_existing_rollback_command'
            : 'queue_rollback_manifest'
          : clientRuntime.nextAction || workflow.currentAction || assessment.operationalHealth?.nextAction || 'inspect_rollback_readiness';
  const reason = validationSummary.primaryMessage
    || (previewBlocked
      ? 'Rollback preview must be visible and acknowledged before queueing.'
      : acceptanceBlocked
        ? 'Operator acceptance is required before queueing this rollback.'
        : workflow.readyForQueue === true
          ? 'Rollback readiness checks passed for the current workflow state.'
          : 'Rollback workflow is waiting for the current step to complete.');

  return {
    action,
    owner: validationSummary.actionable[0]?.owner
      || (action === 'refresh_provider_before_rollback' ? 'adapter' : 'operator'),
    reason,
    currentStepId: workflow.currentStepId || '',
    currentAction: workflow.currentAction || action,
    retryable: workflow.retryable === true || validationSummary.actionable.some((signal) => signal.retryable === true),
    terminal: validationSummary.actionable.some((signal) => signal.terminal === true),
    commandId: persistence.command?.commandId || '',
    replayOf: persistence.command?.replayOf || '',
    recoveryState: recovery.latestState || 'unknown',
    exportReady: analyticsReport.exportReady === true,
  };
}

function normalizeClientRequestCache(runtime = {}) {
  const source = runtime.clientRequestCache && typeof runtime.clientRequestCache === 'object'
    ? runtime.clientRequestCache
    : runtime.clientCache && typeof runtime.clientCache === 'object'
      ? runtime.clientCache
      : runtime.requestCache && typeof runtime.requestCache === 'object'
        ? runtime.requestCache
        : {};

  return {
    revision: compactString(source.revision || source.etag || source.version),
    currentStepId: normalizeState(source.currentStepId || source.activeStep || source.step, ''),
    statusState: normalizeState(source.statusState || source.state, ''),
    commandState: normalizeState(source.commandState || source.rollbackCommandState, ''),
    checkpointId: compactString(source.checkpointId || source.persistedCheckpointId),
    rollbackRequestId: compactString(source.rollbackRequestId || source.requestId),
    clientMutationId: compactString(source.clientMutationId || source.lastClientMutationId),
    updatedAt: compactString(source.updatedAt || source.observedAt || source.at),
  };
}

function controlContract(id, enabled, reason, action, detail = {}) {
  return {
    id,
    enabled: enabled === true,
    disabled: enabled !== true,
    reason: enabled === true ? '' : reason,
    action,
    ...detail,
  };
}

function buildClientRequestRevision(parts = []) {
  return parts
    .map((part) => compactString(part) || 'unknown')
    .join('|')
    .toLowerCase()
    .replaceAll(' ', '_');
}

function buildClientRequestStateContract(status, assessment, acceptance, clientRuntime, validationSummary, nextStep, runtime = {}) {
  const cache = normalizeClientRequestCache(runtime);
  const workflow = clientRuntime.workflowHandoff || {};
  const persistence = assessment.persistence || {};
  const recovery = assessment.recovery || {};
  const stateEnvelope = assessment.stateEnvelope || {};
  const providerContract = assessment.providerContract || {};
  const analyticsReport = assessment.analyticsReport || {};
  const previewReady = assessment.preview?.readiness?.ready === true;
  const previewAcknowledged = workflow.steps?.find((step) => step.id === 'preview')?.acknowledged === true;
  const validationReady = validationSummary.ready === true;
  const acceptanceReady = acceptance.required !== true || acceptance.ready === true;
  const providerRefreshAllowed = providerContract.ready !== true
    || providerContract.sync?.stale === true
    || ['expired', 'missing_token'].includes(providerContract.lease?.state);
  const queueAllowed = workflow.readyForQueue === true
    && validationReady
    && acceptanceReady
    && assessment.operationalHealth?.canQueue === true;
  const observeAllowed = Boolean(
    persistence.command?.commandId
      || persistence.command?.replayOf
      || recovery.checkpoint?.latestEventId
      || recovery.providerRequestId,
  );
  const exportAllowed = analyticsReport.exportReady === true;
  const revision = buildClientRequestRevision([
    assessment.requestId,
    persistence.command?.requestId,
    workflow.currentStepId,
    workflow.currentAction,
    status.state,
    persistence.command?.state,
    recovery.latestState,
    stateEnvelope.persistedState,
    assessment.operationalHealth?.healthState,
    validationSummary.primaryBlocker,
  ]);
  const cacheStale = Boolean(cache.revision && cache.revision !== revision);
  const needsClientPersistence = Boolean(
    cacheStale
      || cache.currentStepId !== normalizeState(workflow.currentStepId, '')
      || cache.statusState !== normalizeState(status.state, '')
      || cache.commandState !== normalizeState(persistence.command?.state, '')
      || (stateEnvelope.checkpointId && cache.checkpointId !== stateEnvelope.checkpointId),
  );
  const writeIntent = queueAllowed
    ? stateEnvelope.writeIntent || 'append_command_and_checkpoint'
    : persistence.command?.replayOf
      ? 'reuse_existing_checkpoint'
      : recovery.retryable === true
        ? 'refresh_then_persist'
        : 'read_only';
  const controls = [
    controlContract(
      'acknowledge_preview',
      previewReady && previewAcknowledged !== true,
      previewReady ? 'preview_already_acknowledged' : 'preview_not_ready',
      'present_rollback_preview',
      {
        visible: previewReady,
        acknowledged: previewAcknowledged,
      },
    ),
    controlContract(
      'submit_acceptance',
      previewReady && previewAcknowledged && acceptance.required === true && acceptance.ready !== true && validationSummary.blocking === 0,
      acceptance.required !== true
        ? 'acceptance_not_required'
        : previewAcknowledged !== true
          ? 'preview_acknowledgement_required'
          : validationSummary.blocking > 0
            ? 'blocking_validation_present'
            : 'acceptance_already_recorded',
      'request_operator_acceptance',
      {
        required: acceptance.required === true,
        accepted: acceptance.accepted === true,
      },
    ),
    controlContract(
      'refresh_provider',
      providerRefreshAllowed,
      'provider_contract_ready',
      providerContract.nextAction || 'refresh_provider_before_rollback',
      {
        leaseState: providerContract.lease?.state || 'unknown',
        syncStale: providerContract.sync?.stale === true,
      },
    ),
    controlContract(
      'queue_rollback',
      queueAllowed,
      validationReady === false
        ? 'validation_not_ready'
        : acceptanceReady === false
          ? 'operator_acceptance_required'
          : workflow.readyForQueue !== true
            ? 'workflow_not_ready'
            : assessment.operationalHealth?.canQueue !== true
              ? 'operational_health_not_ready'
              : '',
      persistence.command?.replayOf ? 'surface_existing_rollback_command' : 'queue_rollback_manifest',
      {
        commandId: persistence.command?.commandId || '',
        replayOf: persistence.command?.replayOf || '',
      },
    ),
    controlContract(
      'observe_status',
      observeAllowed,
      'rollback_command_untracked',
      recovery.terminal === true ? 'archive_rollback_audit' : 'observe_rollback_command',
      {
        latestState: recovery.latestState || 'unknown',
        terminal: recovery.terminal === true,
      },
    ),
    controlContract(
      'export_report',
      exportAllowed,
      analyticsReport.exports?.summary?.blockers?.[0] || 'report_not_ready',
      analyticsReport.exports?.summary?.nextAction || 'inspect_rollback_report',
      {
        exportReady: exportAllowed,
        blockerCount: analyticsReport.exports?.summary?.blockers?.length || 0,
      },
    ),
  ];
  const disabledControls = controls.filter((control) => control.disabled).map((control) => control.id);
  const enabledActions = controls.filter((control) => control.enabled).map((control) => control.action);
  const statusBanner = validationSummary.primaryBlocker
    ? 'blocked'
    : recovery.retryable === true || workflow.retryable === true
      ? 'retryable'
      : workflow.readyForQueue === true
        ? 'ready'
        : status.terminal === true
          ? 'terminal'
          : 'in_progress';

  return {
    protocol: 'aios.rollback-client-request-state.mailchimp.v1',
    revision,
    staleClientRevision: cacheStale,
    needsClientPersistence,
    requestKey: persistence.command?.requestId || recovery.rollbackRequestId || assessment.requestId || '',
    rollbackRequestId: persistence.command?.requestId || recovery.rollbackRequestId || '',
    clientMutationId: workflow.clientMutation?.id || cache.clientMutationId || '',
    viewState: {
      route: clientRuntime.clientState?.route || '',
      sessionId: clientRuntime.clientState?.sessionId || '',
      statusBanner,
      currentStepId: workflow.currentStepId || '',
      currentAction: workflow.currentAction || nextStep.action || '',
      nextAction: nextStep.action || clientRuntime.nextAction || '',
      nextOwner: nextStep.owner || 'operator',
      readOnly: queueAllowed !== true && assessment.operationalHealth?.degradedMode?.readOnly === true,
      externalWritesSuppressed: assessment.operationalHealth?.degradedMode?.externalWritesSuppressed === true,
    },
    persistencePatch: {
      writeIntent,
      checkpointId: stateEnvelope.checkpointId || '',
      checkpointKey: stateEnvelope.key || '',
      checkpointState: stateEnvelope.persistedState || 'unknown',
      commandId: persistence.command?.commandId || '',
      commandState: persistence.command?.state || 'untracked',
      idempotencyKey: persistence.command?.idempotencyKey || '',
      replayOf: persistence.command?.replayOf || '',
      cacheUpdatedAt: cache.updatedAt,
    },
    statusHandoff: {
      state: status.state || 'unknown',
      terminal: status.terminal === true,
      latestCode: status.progress?.latestCode || '',
      recoveryState: recovery.latestState || 'unknown',
      recoveryTerminal: recovery.terminal === true,
      providerRequestId: recovery.providerRequestId || providerContract.externalHandoff?.requestId || '',
      providerLeaseState: providerContract.lease?.state || recovery.leaseState || 'unknown',
      restartMode: assessment.restartPlan?.mode || 'unknown',
    },
    controls,
    enabledActions: [...new Set(enabledActions)].sort(),
    disabledControls,
    clientCache: cache,
  };
}

function normalizeClientWorkflowHistory(runtime = {}) {
  const source = Array.isArray(runtime.clientWorkflowHistory)
    ? runtime.clientWorkflowHistory
    : Array.isArray(runtime.clientEvents)
      ? runtime.clientEvents
      : Array.isArray(runtime.requestState?.events)
        ? runtime.requestState.events
        : [];

  return source.map((event, index) => {
    const item = event && typeof event === 'object' ? event : {};
    const action = normalizeState(item.action || item.type || item.intent, 'observed');
    const stepId = normalizeState(item.stepId || item.currentStepId || item.activeStep, '');
    const state = normalizeState(item.state || item.status || item.outcome, 'observed');

    return {
      index,
      eventId: compactString(item.eventId || item.id || item.clientMutationId || `client-workflow-event:${index}`),
      action,
      stepId,
      state,
      at: compactString(item.at || item.time || item.timestamp || item.observedAt),
      requestRevision: compactString(item.requestRevision || item.revision || item.etag),
      clientMutationId: compactString(item.clientMutationId || item.mutationId),
      acknowledged: item.acknowledged === true || state === 'acknowledged',
      persisted: item.persisted === true || state === 'persisted',
    };
  }).filter((event) => event.eventId || event.action || event.stepId);
}

function buildTransitionOperation(id, enabled, target, reason, detail = {}) {
  return {
    id,
    enabled: enabled === true,
    target,
    reason: enabled === true ? 'ready' : reason,
    ...detail,
  };
}

function buildClientWorkflowTransitionPlan(status, assessment, acceptance, clientRuntime, validationSummary, nextStep, requestState, runtime = {}) {
  const history = normalizeClientWorkflowHistory(runtime);
  const workflow = clientRuntime.workflowHandoff || {};
  const currentStep = (workflow.steps || []).find((step) => step.id === workflow.currentStepId) || {};
  const currentControl = (requestState.controls || []).find((control) => control.action === nextStep.action)
    || (requestState.controls || []).find((control) => control.enabled)
    || null;
  const previewStep = (workflow.steps || []).find((step) => step.id === 'preview') || {};
  const queueControl = (requestState.controls || []).find((control) => control.id === 'queue_rollback') || {};
  const latestHistory = [...history].sort((left, right) => [
    left.at || '9999-12-31T23:59:59.999Z',
    left.index.toString().padStart(6, '0'),
    left.eventId,
  ].join('|').localeCompare([
    right.at || '9999-12-31T23:59:59.999Z',
    right.index.toString().padStart(6, '0'),
    right.eventId,
  ].join('|'))).at(-1) || null;
  const lastMutationMatches = Boolean(
    latestHistory?.clientMutationId
      && latestHistory.clientMutationId === requestState.clientMutationId,
  );
  const revisionAcknowledged = Boolean(
    latestHistory?.requestRevision
      && latestHistory.requestRevision === requestState.revision
      && latestHistory.acknowledged,
  );
  const persistRequired = requestState.needsClientPersistence === true || !revisionAcknowledged;
  const canAdvanceStep = Boolean(
    workflow.currentStepId
      && currentStep.state !== 'blocked'
      && validationSummary.blocking === 0
      && (currentControl?.enabled === true || workflow.readyForQueue === true),
  );
  const canPersistView = Boolean(requestState.revision && requestState.clientMutationId);
  const canQueue = queueControl.enabled === true && assessment.canRollback === true;
  const transitionState = validationSummary.blocking > 0
    ? 'blocked'
    : requestState.staleClientRevision
      ? 'stale_client'
      : persistRequired
        ? 'persist_view_state'
        : canQueue
          ? 'ready_to_queue'
          : workflow.retryable === true
            ? 'retryable_handoff'
            : 'waiting_for_operator';
  const operations = [
    buildTransitionOperation(
      'persist_client_view_state',
      canPersistView && persistRequired,
      'client_request_cache',
      canPersistView ? 'client_cache_current' : 'missing_request_revision',
      {
        revision: requestState.revision,
        clientMutationId: requestState.clientMutationId,
        currentStepId: workflow.currentStepId || '',
        statusState: status.state || 'unknown',
        commandState: assessment.persistence?.command?.state || 'untracked',
      },
    ),
    buildTransitionOperation(
      'render_current_step',
      Boolean(workflow.currentStepId && workflow.operatorVisible !== false),
      'operator_workflow',
      'workflow_not_visible',
      {
        stepId: workflow.currentStepId || '',
        action: workflow.currentAction || nextStep.action || '',
        banner: requestState.viewState?.statusBanner || 'unknown',
      },
    ),
    buildTransitionOperation(
      'advance_after_preview',
      previewStep.acknowledged === true && validationSummary.blocking === 0,
      'workflow_step',
      previewStep.acknowledged === true ? 'blocking_validation_present' : 'preview_acknowledgement_required',
      {
        from: 'preview',
        to: workflow.currentStepId || '',
        validationReady: validationSummary.ready === true,
      },
    ),
    buildTransitionOperation(
      'submit_next_client_action',
      canAdvanceStep,
      'runtime_action',
      currentStep.state === 'blocked'
        ? 'current_step_blocked'
        : validationSummary.blocking > 0
          ? 'blocking_validation_present'
          : 'no_enabled_control_for_next_action',
      {
        action: nextStep.action || workflow.currentAction || '',
        owner: nextStep.owner || 'operator',
        controlId: currentControl?.id || '',
      },
    ),
    buildTransitionOperation(
      'handoff_adapter_recovery',
      assessment.adapterRecoveryDirective?.blocked !== true && requestState.viewState?.externalWritesSuppressed !== true,
      'adapter_recovery_directive',
      assessment.adapterRecoveryDirective?.blocked === true
        ? 'adapter_recovery_blocked'
        : 'external_writes_suppressed',
      {
        directiveAction: assessment.adapterRecoveryDirective?.action || '',
        writeMode: assessment.adapterRecoveryDirective?.writeMode || 'local_read_only',
        providerRequestId: assessment.adapterRecoveryDirective?.providerRequestId || '',
      },
    ),
    buildTransitionOperation(
      'queue_or_observe_rollback',
      canQueue || assessment.persistence?.command?.replayOf,
      'rollback_command',
      canQueue ? 'ready' : 'queue_control_disabled',
      {
        commandId: assessment.persistence?.command?.commandId || '',
        replayOf: assessment.persistence?.command?.replayOf || '',
        queueEnabled: canQueue,
      },
    ),
  ];
  const enabledOperations = operations.filter((operation) => operation.enabled).map((operation) => operation.id);
  const blockedOperations = operations.filter((operation) => operation.enabled !== true).map((operation) => ({
    id: operation.id,
    reason: operation.reason,
  }));
  const nextOperation = operations.find((operation) => operation.enabled && operation.id !== 'render_current_step')
    || operations.find((operation) => operation.enabled)
    || operations[0];

  return {
    protocol: 'aios.rollback-client-workflow-transition-plan.mailchimp.v1',
    transitionState,
    requestRevision: requestState.revision,
    clientMutationId: requestState.clientMutationId,
    lastMutationMatches,
    revisionAcknowledged,
    persistRequired,
    currentStepId: workflow.currentStepId || '',
    currentAction: workflow.currentAction || nextStep.action || '',
    nextAction: nextStep.action || clientRuntime.nextAction || '',
    nextOperationId: nextOperation?.id || '',
    routePatch: {
      route: clientRuntime.clientState?.route || '',
      sessionId: clientRuntime.clientState?.sessionId || '',
      statusBanner: requestState.viewState?.statusBanner || 'unknown',
      activeStep: workflow.currentStepId || '',
      action: nextStep.action || '',
      readOnly: requestState.viewState?.readOnly === true,
      externalWritesSuppressed: requestState.viewState?.externalWritesSuppressed === true,
    },
    telemetry: {
      historyEvents: history.length,
      latestEventId: latestHistory?.eventId || '',
      latestEventAction: latestHistory?.action || '',
      enabledOperations: enabledOperations.length,
      blockedOperations: blockedOperations.length,
      validationBlocking: validationSummary.blocking || 0,
      validationWarnings: validationSummary.warnings || 0,
      acceptanceReady: acceptance.ready === true,
      providerReady: assessment.providerContract?.ready === true,
      recoveryReady: assessment.recovery?.ready === true,
    },
    operations,
    enabledOperations,
    blockedOperations,
    history,
  };
}

function createRollbackClientReviewPacket(status, assessment, acceptance, clientRuntime, runtime = {}) {
  const validationSummary = buildValidationSummaryContract(assessment);
  const nextStep = buildRollbackNextStepExplanation(assessment, acceptance, clientRuntime, validationSummary);
  const requestState = buildClientRequestStateContract(
    status,
    assessment,
    acceptance,
    clientRuntime,
    validationSummary,
    nextStep,
    runtime,
  );
  const workflowTransitionPlan = buildClientWorkflowTransitionPlan(
    status,
    assessment,
    acceptance,
    clientRuntime,
    validationSummary,
    nextStep,
    requestState,
    runtime,
  );
  const workflow = clientRuntime.workflowHandoff || {};
  const preview = assessment.preview || {};

  return {
    protocol: 'aios.rollback-client-review-packet.mailchimp.v1',
    requestId: assessment.requestId || '',
    rollbackRequestId: assessment.persistence?.command?.requestId || assessment.recovery?.rollbackRequestId || '',
    route: clientRuntime.clientState?.route || '',
    sessionId: clientRuntime.clientState?.sessionId || '',
    status: {
      state: status.state || 'unknown',
      terminal: status.terminal === true,
      latestCode: status.progress?.latestCode || '',
    },
    preview: {
      title: preview.title || '',
      originalAction: preview.originalAction || assessment.originalAction || '',
      inverseAction: preview.inverseAction || assessment.inverseAction || '',
      ready: preview.readiness?.ready === true,
      acknowledged: workflow.steps?.find((step) => step.id === 'preview')?.acknowledged === true,
      blockedReasons: preview.readiness?.blockedReasons || [],
      payload: preview.payload || {},
      capabilityDelta: preview.capabilityDelta || {},
    },
    acceptance: {
      required: acceptance.required === true,
      ready: acceptance.ready === true,
      accepted: acceptance.accepted === true,
      acceptedBy: acceptance.acceptedBy || '',
      acceptedAt: acceptance.acceptedAt || '',
      reason: acceptance.reason || '',
      nextAction: acceptance.nextAction || 'request_operator_acceptance',
    },
    readiness: {
      baseReady: assessment.baseRollbackReady === true,
      canRollback: assessment.canRollback === true,
      readyForQueue: workflow.readyForQueue === true,
      clientAdopted: clientRuntime.adopted === true,
      healthState: assessment.operationalHealth?.healthState || 'unknown',
      lifecycleHoldState: assessment.lifecycleControls?.holdState || 'unknown',
      providerReady: assessment.providerContract?.ready === true,
      recoveryReady: assessment.recovery?.ready === true,
      persistenceState: assessment.persistence?.command?.state || 'untracked',
    },
    validationSummary,
    nextStep,
    requestState,
    workflowTransitionPlan,
    checklist: (workflow.steps || []).map((step) => ({
      id: step.id,
      label: step.label,
      state: step.state,
      current: step.current === true,
      action: step.action || '',
    })),
    routeHints: {
      canRenderPreview: Boolean(preview.title),
      canSubmitAcceptance: acceptance.required === true && acceptance.ready !== true && validationSummary.blocking === 0,
      canQueueRollback: workflow.readyForQueue === true && validationSummary.blocking === 0,
      canRefreshProvider: nextStep.action === 'refresh_provider_before_rollback' || assessment.providerContract?.ready !== true,
      canExportReport: assessment.analyticsReport?.exportReady === true,
      disabledControls: requestState.disabledControls,
      enabledActions: requestState.enabledActions,
      statusBanner: requestState.viewState.statusBanner,
      needsClientPersistence: requestState.needsClientPersistence,
      workflowTransitionState: workflowTransitionPlan.transitionState,
      nextOperationId: workflowTransitionPlan.nextOperationId,
    },
  };
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = normalizeState(selector(item), 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function pickSnapshotTime(...values) {
  return values.map((value) => compactString(value)).find(Boolean) || '';
}

function createTimelineEntry(source, eventId, at, state, title, detail = {}) {
  return {
    source,
    eventId: compactString(eventId),
    at: compactString(at),
    state: normalizeState(state, 'unknown'),
    title,
    ...detail,
  };
}

function normalizeRollbackHistorySnapshots(descriptor, status, persistence, recovery, stateEnvelope, operationalHealth, lifecycleControls, runtime = {}) {
  const rawSnapshots = Array.isArray(runtime.rollbackHistorySnapshots)
    ? runtime.rollbackHistorySnapshots
    : Array.isArray(runtime.historySnapshots)
      ? runtime.historySnapshots
      : [];
  const normalizedRawSnapshots = rawSnapshots.map((snapshot, index) => {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const state = normalizeState(source.state || source.status || source.outcome, 'observed');
    return {
      index,
      snapshotId: compactString(source.snapshotId || source.id || `runtime-snapshot:${index}`),
      source: compactString(source.source || 'runtime'),
      at: compactString(source.at || source.time || source.timestamp || source.observedAt),
      state,
      terminal: source.terminal === true || RECOVERY_TERMINAL_STATES.includes(state),
      exportReady: source.exportReady !== false,
      commandId: compactString(source.commandId || source.rollbackCommandId),
      requestId: compactString(source.requestId || source.rollbackRequestId),
      idempotencyKey: compactString(source.idempotencyKey || source.rollbackIdempotencyKey),
      message: compactString(source.message || source.reason || source.title),
    };
  }).filter((snapshot) => snapshot.snapshotId || snapshot.commandId || snapshot.requestId || snapshot.idempotencyKey);
  const derivedSnapshots = [
    {
      snapshotId: `rollback.request:${descriptor.requestId || 'request'}`,
      source: 'descriptor',
      at: pickSnapshotTime(status.progress?.latestAt, status.observedAt, runtime.observedAt),
      state: descriptor.dryRun ? 'dry_run' : descriptor.action ? 'compiled' : 'unknown',
      terminal: false,
      exportReady: Boolean(descriptor.requestId && descriptor.action),
      commandId: '',
      requestId: descriptor.requestId || '',
      idempotencyKey: descriptor.idempotencyKey || '',
      message: descriptor.action ? `Compiled rollback source action "${descriptor.action}".` : 'Rollback descriptor is missing an action.',
    },
    {
      snapshotId: `rollback.status:${status.progress?.latestCode || status.state || 'unknown'}`,
      source: 'status',
      at: pickSnapshotTime(status.progress?.latestAt, status.externalHandoff?.observedAt),
      state: status.state || 'unknown',
      terminal: status.terminal === true,
      exportReady: Boolean(status.state),
      commandId: '',
      requestId: status.externalHandoff?.requestId || descriptor.requestId || '',
      idempotencyKey: descriptor.idempotencyKey || '',
      message: status.progress?.latestCode
        ? `Status snapshot latest code is "${status.progress.latestCode}".`
        : 'Status snapshot has no latest progress code.',
    },
    {
      snapshotId: `rollback.command:${persistence.command?.commandId || 'untracked'}`,
      source: 'persistence',
      at: persistence.loadedAt || '',
      state: persistence.command?.state || 'untracked',
      terminal: Boolean(persistence.command?.replayOf),
      exportReady: Boolean(persistence.command?.commandId && persistence.command?.idempotencyKey),
      commandId: persistence.command?.commandId || '',
      requestId: persistence.command?.requestId || '',
      idempotencyKey: persistence.command?.idempotencyKey || '',
      message: persistence.command?.replayOf
        ? `Rollback command replays "${persistence.command.replayOf}".`
        : persistence.command?.canEnqueue
          ? 'Rollback command is ready to enqueue.'
          : 'Rollback command is not ready to enqueue.',
    },
    {
      snapshotId: `rollback.recovery:${recovery.checkpoint?.latestEventId || recovery.latestState || 'unknown'}`,
      source: 'recovery',
      at: recovery.checkpoint?.latestObservedAt || '',
      state: recovery.latestState || 'unknown',
      terminal: recovery.terminal === true,
      exportReady: recovery.ready === true || recovery.retryable === true || recovery.terminal === true,
      commandId: persistence.command?.commandId || '',
      requestId: recovery.rollbackRequestId || '',
      idempotencyKey: recovery.rollbackIdempotencyKey || '',
      message: recovery.checkpoint?.latestMessage || `Recovery resume mode is "${recovery.resumeMode || 'unknown'}".`,
    },
    {
      snapshotId: `rollback.health:${operationalHealth.healthState || 'unknown'}`,
      source: 'operational_health',
      at: '',
      state: operationalHealth.healthState || 'unknown',
      terminal: operationalHealth.failureState?.terminal === true,
      exportReady: operationalHealth.healthy === true || operationalHealth.degraded === true,
      commandId: persistence.command?.commandId || '',
      requestId: recovery.rollbackRequestId || '',
      idempotencyKey: recovery.rollbackIdempotencyKey || '',
      message: operationalHealth.failureState?.message || `Operational health is "${operationalHealth.healthState || 'unknown'}".`,
    },
    {
      snapshotId: `rollback.lifecycle:${lifecycleControls.holdState || 'unknown'}`,
      source: 'lifecycle_controls',
      at: lifecycleControls.evaluatedAt || '',
      state: lifecycleControls.holdState || 'unknown',
      terminal: lifecycleControls.enabled === false,
      exportReady: lifecycleControls.canProceed === true,
      commandId: persistence.command?.commandId || '',
      requestId: persistence.command?.requestId || '',
      idempotencyKey: persistence.command?.idempotencyKey || '',
      message: lifecycleControls.canProceed === true
        ? 'Lifecycle controls permit rollback queueing.'
        : `Lifecycle controls next action is "${lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls'}".`,
    },
    {
      snapshotId: `rollback.restart:${stateEnvelope.checkpointId || 'checkpoint'}`,
      source: 'restart',
      at: stateEnvelope.savedAt || '',
      state: stateEnvelope.persistedState || 'unknown',
      terminal: stateEnvelope.restartTerminal === true,
      exportReady: stateEnvelope.restartSafety?.statusConflict !== true,
      commandId: stateEnvelope.command?.commandId || '',
      requestId: stateEnvelope.rollbackRequestId || '',
      idempotencyKey: stateEnvelope.rollbackIdempotencyKey || '',
      message: stateEnvelope.restartSafety?.statusConflict === true
        ? 'Restart checkpoint conflicts with live recovery status.'
        : `Restart write intent is "${stateEnvelope.writeIntent || 'unknown'}".`,
    },
  ];
  const snapshotsById = new Map();

  [...normalizedRawSnapshots, ...derivedSnapshots].forEach((snapshot, index) => {
    const snapshotId = snapshot.snapshotId || `${snapshot.source || 'snapshot'}:${index}`;
    snapshotsById.set(snapshotId, {
      ...snapshot,
      index,
      snapshotId,
    });
  });

  return [...snapshotsById.values()].sort((left, right) => [
    left.at || '9999-12-31T23:59:59.999Z',
    left.index.toString().padStart(6, '0'),
    left.snapshotId,
  ].join('|').localeCompare([
    right.at || '9999-12-31T23:59:59.999Z',
    right.index.toString().padStart(6, '0'),
    right.snapshotId,
  ].join('|')));
}

function buildRollbackAnalyticsTimeline(descriptor, status, persistence, recovery, stateEnvelope, restartPlan, operationalHealth, lifecycleControls, snapshots) {
  const timeline = [
    createTimelineEntry('descriptor', `compile:${descriptor.requestId || 'request'}`, '', descriptor.action ? 'compiled' : 'unknown', 'Compile rollback source', {
      action: descriptor.action || '',
      tenant: descriptor.tenant || '',
    }),
    createTimelineEntry('status', `status:${status.progress?.latestCode || status.state || 'unknown'}`, status.progress?.latestAt || '', status.state || 'unknown', 'Bind status snapshot', {
      latestCode: status.progress?.latestCode || '',
      terminal: status.terminal === true,
    }),
    createTimelineEntry('persistence', persistence.command?.commandId || 'rollback-command:untracked', persistence.loadedAt || '', persistence.command?.state || 'untracked', 'Evaluate rollback command persistence', {
      canEnqueue: persistence.command?.canEnqueue === true,
      replayOf: persistence.command?.replayOf || '',
    }),
    createTimelineEntry('recovery', recovery.checkpoint?.latestEventId || recovery.rollbackRequestId || 'rollback-recovery:untracked', recovery.checkpoint?.latestObservedAt || '', recovery.latestState || 'unknown', 'Bind recovery handoff', {
      resumeMode: recovery.resumeMode || 'unknown',
      retryable: recovery.retryable === true,
      terminal: recovery.terminal === true,
    }),
    createTimelineEntry('restart', stateEnvelope.checkpointId || 'rollback-checkpoint:untracked', stateEnvelope.savedAt || '', stateEnvelope.persistedState || 'unknown', 'Plan restart semantics', {
      mode: restartPlan.mode || 'unknown',
      canResume: restartPlan.canResume === true,
      statusSemantics: restartPlan.statusSemantics || 'unknown',
    }),
    createTimelineEntry('operational_health', `health:${operationalHealth.healthState || 'unknown'}`, '', operationalHealth.healthState || 'unknown', 'Evaluate operational health', {
      canQueue: operationalHealth.canQueue === true,
      nextAction: operationalHealth.nextAction || 'inspect_rollback_health',
    }),
    createTimelineEntry('lifecycle_controls', `lifecycle:${lifecycleControls.holdState || 'unknown'}`, lifecycleControls.evaluatedAt || '', lifecycleControls.holdState || 'unknown', 'Evaluate lifecycle controls', {
      enabled: lifecycleControls.enabled === true,
      canProceed: lifecycleControls.canProceed === true,
      nextAction: lifecycleControls.nextAction || 'inspect_rollback_lifecycle_controls',
    }),
    ...snapshots.map((snapshot) => createTimelineEntry(
      `snapshot:${snapshot.source || 'runtime'}`,
      snapshot.snapshotId,
      snapshot.at,
      snapshot.state,
      snapshot.message || `Snapshot ${snapshot.snapshotId}`,
      {
        exportReady: snapshot.exportReady === true,
        commandId: snapshot.commandId || '',
        requestId: snapshot.requestId || '',
      },
    )),
  ];

  return timeline.sort((left, right) => [
    left.at || '9999-12-31T23:59:59.999Z',
    left.source,
    left.eventId,
  ].join('|').localeCompare([
    right.at || '9999-12-31T23:59:59.999Z',
    right.source,
    right.eventId,
  ].join('|')));
}

function buildRollbackAnalyticsReport(descriptor, status, assessment, persistence, recovery, stateEnvelope, restartPlan, operationalHealth, runtime = {}) {
  const lifecycleControls = assessment.lifecycleControls || {};
  const snapshots = normalizeRollbackHistorySnapshots(
    descriptor,
    status,
    persistence,
    recovery,
    stateEnvelope,
    operationalHealth,
    lifecycleControls,
    runtime,
  );
  const timeline = buildRollbackAnalyticsTimeline(
    descriptor,
    status,
    persistence,
    recovery,
    stateEnvelope,
    restartPlan,
    operationalHealth,
    lifecycleControls,
    snapshots,
  );
  const validationItems = [
    ...(assessment.preview?.readiness?.validation || []),
    ...(lifecycleControls.validation || []),
    ...(assessment.providerContract?.validation || []),
    ...(recovery.validation || []),
    ...(assessment.permissionBoundary?.validation || []),
    ...(operationalHealth.signals || []),
  ];
  const exportBlockers = [
    ...(assessment.exportSummary?.exportReady === true ? [] : ['adapter_history_export_not_ready']),
    ...(assessment.providerContract?.ready === true ? [] : ['provider_contract_not_ready']),
    ...(snapshots.some((snapshot) => snapshot.exportReady === false) ? ['history_snapshot_not_export_ready'] : []),
    ...(lifecycleControls.canProceed === true ? [] : ['lifecycle_controls_not_ready']),
    ...(stateEnvelope.restartSafety?.statusConflict === true ? ['restart_status_conflict'] : []),
    ...(operationalHealth.blockers || []),
  ].filter(Boolean);
  const counters = {
    snapshots: snapshots.length,
    timelineEvents: timeline.length,
    terminalSnapshots: snapshots.filter((snapshot) => snapshot.terminal === true).length,
    exportReadySnapshots: snapshots.filter((snapshot) => snapshot.exportReady === true).length,
    recoveryEvents: recovery.checkpoint?.eventCount || 0,
    matchingRecoveryEvents: recovery.checkpoint?.matchingEventCount || 0,
    ledgerCommands: persistence.ledger?.commandCount || 0,
    matchingLedgerCommands: persistence.restartSafety?.matchedCommandCount || 0,
    validation: validationItems.length,
    blocking: validationItems.filter((item) => item.severity === 'error').length,
    warnings: validationItems.filter((item) => item.severity === 'warning').length,
    operationalBlockers: operationalHealth.blockers?.length || 0,
    providerBlockers: assessment.providerContract?.blockers?.length || 0,
    providerWarnings: assessment.providerContract?.warnings?.length || 0,
    lifecycleBlockers: lifecycleControls.blockers?.length || 0,
    lifecycleWarnings: lifecycleControls.warnings?.length || 0,
  };
  const exportReady = exportBlockers.length === 0
    && counters.exportReadySnapshots === counters.snapshots
    && Boolean(assessment.exportSummary?.exportReady);

  return {
    protocol: 'aios.rollback-analytics-report.mailchimp.v1',
    requestId: descriptor.requestId,
    rollbackRequestId: persistence.command?.requestId || recovery.rollbackRequestId || '',
    generatedAt: pickSnapshotTime(runtime.reportGeneratedAt, runtime.analyticsGeneratedAt, runtime.observedAt),
    exportReady,
    counters,
    distributions: {
      snapshotStates: countBy(snapshots, (snapshot) => snapshot.state),
      timelineStates: countBy(timeline, (entry) => entry.state),
      validationSeverity: countBy(validationItems, (item) => item.severity),
      signalOwners: countBy(operationalHealth.signals || [], (signal) => signal.owner || 'runtime'),
    },
    history: {
      snapshotCount: snapshots.length,
      latestSnapshotId: snapshots.at(-1)?.snapshotId || '',
      latestState: snapshots.at(-1)?.state || 'unknown',
      terminal: snapshots.some((snapshot) => snapshot.terminal === true),
      snapshots,
    },
    timeline: {
      firstEventId: timeline[0]?.eventId || '',
      lastEventId: timeline.at(-1)?.eventId || '',
      events: timeline,
    },
    exports: {
      adapterHistory: assessment.exportSummary || {},
      summary: {
        protocol: 'aios.rollback-export-summary.mailchimp.v1',
        ready: exportReady,
        format: 'json',
        includes: [
          'rollback_manifest',
          'history_snapshots',
          'analytics_counters',
          'timeline_events',
          'operational_health',
        ],
        blockers: exportBlockers.sort(),
        nextAction: exportReady
          ? 'export_rollback_report'
          : exportBlockers.includes('restart_status_conflict')
            ? 'surface_persisted_status_conflict'
            : exportBlockers.includes('adapter_history_export_not_ready')
              ? 'refresh_adapter_history_export'
              : operationalHealth.nextAction || 'inspect_rollback_report',
      },
    },
    reportState: {
      state: exportReady
        ? 'ready'
        : operationalHealth.healthState === 'failed'
          ? 'blocked'
          : 'needs_attention',
      healthState: operationalHealth.healthState || 'unknown',
      restartMode: restartPlan.mode || 'unknown',
      recoveryState: recovery.latestState || 'unknown',
      commandState: persistence.command?.state || 'untracked',
      nextAction: exportReady
        ? 'export_rollback_report'
        : operationalHealth.nextAction || restartPlan.nextAction || recovery.nextAction || 'inspect_rollback_report',
    },
  };
}

function buildRollbackAdapterRecoveryDirective(descriptor, status, assessment, persistence, recovery, stateEnvelope, restartPlan, operationalHealth, runtime = {}) {
  const providerContract = assessment.providerContract || {};
  const lifecycleControls = assessment.lifecycleControls || {};
  const permissionBoundary = assessment.permissionBoundary || {};
  const rollbackRequestId = persistence.command?.requestId || recovery.rollbackRequestId || `${descriptor.requestId}:rollback`;
  const rollbackIdempotencyKey = persistence.command?.idempotencyKey || recovery.rollbackIdempotencyKey || (descriptor.idempotencyKey ? `${descriptor.idempotencyKey}:rollback` : '');
  const providerRequestId = recovery.providerRequestId
    || providerContract.externalHandoff?.requestId
    || status.externalHandoff?.requestId
    || '';
  const blocked = operationalHealth.canQueue !== true
    || lifecycleControls.canProceed !== true
    || permissionBoundary.allowed !== true
    || providerContract.ready !== true
    || recovery.ready !== true;
  const retryable = operationalHealth.retryPolicy?.eligible === true
    || recovery.retryable === true
    || restartPlan.guards?.requiresFreshStatus === true;
  const terminal = recovery.terminal === true
    || stateEnvelope.restartTerminal === true
    || operationalHealth.failureState?.terminal === true;
  const writeMode = operationalHealth.canQueue === true && assessment.canRollback === true
    ? 'external_write'
    : retryable
      ? 'refresh_only'
      : 'local_read_only';
  const statusPatchState = terminal
    ? recovery.latestState || stateEnvelope.persistedState || 'terminal'
    : blocked
      ? retryable
        ? 'needs_provider_refresh'
        : 'blocked'
      : persistence.command?.replayOf
        ? 'observing_existing_command'
        : 'ready_to_queue';
  const directiveAction = terminal
    ? 'archive_rollback_audit'
    : restartPlan.guards?.requiresConflictReview === true
      ? 'surface_persisted_status_conflict'
      : persistence.command?.replayOf
        ? 'observe_existing_rollback_command'
        : retryable
          ? 'refresh_provider_before_rollback'
          : blocked
            ? operationalHealth.nextAction || recovery.nextAction || 'inspect_rollback_health'
            : 'queue_rollback_manifest';
  const recoveryCommand = {
    commandId: persistence.command?.commandId || `mailchimp.rollback:${descriptor.tenant || 'tenant'}:${descriptor.requestId || 'request'}`,
    requestId: rollbackRequestId,
    idempotencyKey: rollbackIdempotencyKey,
    action: assessment.inverseAction || 'rollback_unavailable',
    state: persistence.command?.state || (blocked ? 'blocked' : 'pending_enqueue'),
    writeMode,
    replayOf: persistence.command?.replayOf || '',
    providerRequestId,
    nextAction: directiveAction,
  };
  const statusPatch = {
    state: statusPatchState,
    terminal,
    latestCode: terminal
      ? 'mailchimp.rollback.terminal'
      : blocked
        ? 'mailchimp.rollback.blocked'
        : 'mailchimp.rollback.ready',
    observedAt: pickSnapshotTime(runtime.observedAt, runtime.reportGeneratedAt, status.progress?.latestAt),
    externalHandoff: {
      state: providerContract.externalHandoff?.state || status.externalHandoff?.state || 'local_only',
      requestId: providerRequestId,
      leaseState: providerContract.lease?.state || recovery.leaseState || status.externalHandoff?.leaseState || 'unknown',
      writeMode,
    },
    recovery: {
      resumeMode: recovery.resumeMode || 'untracked',
      latestState: recovery.latestState || 'unknown',
      retryable,
      checkpointEventId: recovery.checkpoint?.latestEventId || '',
    },
  };
  const capabilityClaims = [
    { capability: 'adapter.mailchimp', granted: true, source: 'rollback_runtime' },
    { capability: 'external.write', granted: writeMode === 'external_write', source: 'truth_boundary' },
    { capability: rollbackCapabilityFor(descriptor.action) || 'mailchimp.rollback_unavailable', granted: Boolean(assessment.inverseAction), source: 'inverse_action' },
    { capability: 'provider.mailchimp.ready', granted: providerContract.ready === true, source: 'provider_contract' },
    { capability: 'tenant.permission.verified', granted: permissionBoundary.allowed === true, source: 'tenant_permission_boundary' },
    { capability: 'rollback.lifecycle.released', granted: lifecycleControls.canProceed === true, source: 'lifecycle_controls' },
    { capability: 'rollback.recovery.ready', granted: recovery.ready === true, source: 'recovery_handoff' },
  ].map((claim) => ({
    ...claim,
    reason: claim.granted ? 'satisfied' : 'not_satisfied',
  }));
  const memoryWrites = [
    {
      ref: `rollback.status.${rollbackRequestId || descriptor.requestId || 'request'}`,
      mode: 'upsert',
      boundary: 'local',
      state: statusPatch.state,
    },
    {
      ref: stateEnvelope.checkpointId || `mailchimp.rollback.checkpoint:${descriptor.tenant || 'tenant'}:${rollbackRequestId || 'request'}`,
      mode: stateEnvelope.writeIntent === 'append_command_and_checkpoint' ? 'append' : 'read',
      boundary: 'local',
      state: stateEnvelope.persistedState || statusPatch.state,
    },
    ...(permissionBoundary.audit?.auditRef
      ? [{
        ref: permissionBoundary.audit.auditRef,
        mode: permissionBoundary.allowed === true ? 'append' : 'read',
        boundary: 'tenant',
        state: permissionBoundary.allowed === true ? 'verified' : 'blocked',
      }]
      : []),
  ];
  const verifierClaims = [
    {
      name: 'mailchimp.rollback.status_patch',
      required: true,
      satisfied: Boolean(statusPatch.state && statusPatch.latestCode),
      evidenceRef: statusPatch.latestCode,
    },
    {
      name: 'mailchimp.rollback.recovery_command',
      required: assessment.canRollback === true,
      satisfied: Boolean(recoveryCommand.commandId && recoveryCommand.requestId && rollbackIdempotencyKey),
      evidenceRef: recoveryCommand.commandId,
    },
    {
      name: 'mailchimp.rollback.provider_handoff',
      required: assessment.canRollback === true,
      satisfied: Boolean(providerRequestId && providerContract.ready === true),
      evidenceRef: providerRequestId,
    },
    {
      name: 'mailchimp.rollback.restart_semantics',
      required: true,
      satisfied: Boolean(restartPlan.mode && restartPlan.statusSemantics),
      evidenceRef: restartPlan.resumeToken || stateEnvelope.checkpointId || '',
    },
  ];
  const blockers = [
    ...(capabilityClaims.filter((claim) => claim.granted !== true).map((claim) => `missing_capability:${claim.capability}`)),
    ...(verifierClaims.filter((claim) => claim.required === true && claim.satisfied !== true).map((claim) => `unsatisfied_verifier:${claim.name}`)),
    ...(restartPlan.guards?.requiresConflictReview === true ? ['restart_conflict_review_required'] : []),
  ];

  return {
    protocol: 'aios.rollback-adapter-recovery-directive.mailchimp.v1',
    requestId: descriptor.requestId || '',
    rollbackRequestId,
    rollbackIdempotencyKey,
    providerRequestId,
    action: directiveAction,
    writeMode,
    blocked,
    retryable,
    terminal,
    statusPatch,
    recoveryCommand,
    capabilityClaims,
    memoryWrites,
    verifierClaims,
    restart: {
      mode: restartPlan.mode || 'unknown',
      statusSemantics: restartPlan.statusSemantics || 'unknown',
      resumeToken: restartPlan.resumeToken || '',
      guards: restartPlan.guards || {},
    },
    handoff: {
      adapter: 'mailchimp',
      provider: providerContract.provider || 'mailchimp',
      service: providerContract.service || 'marketing',
      externalRequestId: providerRequestId,
      syncCursor: providerContract.sync?.cursor || '',
      leaseState: providerContract.lease?.state || recovery.leaseState || 'unknown',
    },
    blockers,
    nextAction: blockers.length > 0
      ? directiveAction
      : writeMode === 'external_write'
        ? 'queue_rollback_manifest'
        : directiveAction,
  };
}

export function assessMailchimpRollback(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const status = buildMailchimpStatusSnapshot(descriptor, runtime);
  const exportSummary = createMailchimpAdapterExportSummary(descriptor, runtime.history || runtime.events || []);
  const inverseAction = REVERSIBLE_ACTIONS[descriptor.action] || null;
  const permissionBoundary = buildTenantPermissionBoundary(descriptor, inverseAction, runtime);
  const boundaryContinuity = buildMailchimpTenantBoundaryContinuityContract(descriptor, runtime);
  const providerContract = buildRollbackProviderServiceContract(descriptor, status, inverseAction, runtime);
  const diagnostics = [...(descriptor.diagnostics || [])];

  if (!inverseAction) {
    diagnostics.push({
      code: 'mailchimp.rollback.no_inverse_action',
      severity: 'warning',
      field: 'action',
      message: `Action "${descriptor.action}" does not have a deterministic rollback action.`,
    });
  }

  if (!descriptor.idempotencyKey) {
    diagnostics.push({
      code: 'mailchimp.rollback.missing_original_idempotency',
      severity: 'error',
      field: 'idempotencyKey',
      message: 'Rollback requires the original idempotency key for audit binding.',
    });
  }

  permissionBoundary.validation
    .filter((item) => item.severity === 'error')
    .forEach((item) => {
      diagnostics.push({
        code: item.code,
        severity: item.severity,
        field: 'tenantPermissionBoundary',
        message: item.message,
      });
    });

  if (boundaryContinuity.ready === false) {
    diagnostics.push({
      code: 'mailchimp.rollback.tenant_boundary_continuity',
      severity: boundaryContinuity.state === 'waiting_for_audit' ? 'warning' : 'error',
      field: 'tenantBoundaryContinuity',
      message: `Rollback tenant boundary continuity is ${boundaryContinuity.state}; next action is "${boundaryContinuity.nextAction}".`,
    });
  }

  const baseRollbackReady = Boolean(
    inverseAction
      && descriptor.idempotencyKey
      && descriptor.truthBoundary?.externalWritesAllowed
      && permissionBoundary.allowed
      && boundaryContinuity.ready !== false
      && !descriptor.dryRun,
  );
  const lifecycleControls = buildRollbackLifecycleControls(descriptor, {
    baseRollbackReady,
    inverseAction,
    nextAction: permissionBoundary.allowed ? 'continue_rollback_readiness' : permissionBoundary.nextAction,
  }, runtime);

  lifecycleControls.validation
    .filter((item) => item.ok === false && ['error', 'warning'].includes(item.severity))
    .forEach((item) => {
      diagnostics.push({
        code: item.code,
        severity: item.severity,
        field: item.field || 'rollbackLifecycleControls',
        message: item.message,
      });
    });

  providerContract.validation
    .filter((item) => item.ok === false && ['error', 'warning'].includes(item.severity))
    .forEach((item) => {
      diagnostics.push({
        code: item.code,
        severity: item.severity,
        field: item.field || 'providerContract',
        message: item.message,
      });
    });

  const componentReadiness = buildComponentReadinessSummary(runtime);
  if (componentReadiness.ready === false) {
    diagnostics.push({
      code: 'mailchimp.rollback.component_readiness',
      severity: componentReadiness.status === 'waiting' ? 'warning' : 'error',
      field: 'componentReadiness',
      message: componentReadiness.primaryComponent
        ? `Runtime component "${componentReadiness.primaryComponent}" is ${componentReadiness.status}.`
        : `Runtime component readiness is ${componentReadiness.status}.`,
    });
  }

  const canRollback = Boolean(
    baseRollbackReady
      && lifecycleControls.canProceed
      && providerContract.ready
      && boundaryContinuity.ready !== false
      && componentReadiness.ready !== false,
  );
  const acceptance = buildAcceptanceState({ canRollback }, runtime.acceptance || runtime.rollbackAcceptance);
  const persistenceSeed = {
    canRollback,
    inverseAction,
  };

  const assessment = {
    protocol: 'aios.rollback-handoff.mailchimp.v1',
    requestId: descriptor.requestId,
    adapter: 'mailchimp',
    originalAction: descriptor.action,
    inverseAction,
    tenant: descriptor.tenant,
    baseRollbackReady,
    canRollback,
    status: {
      state: status.state,
      terminal: status.terminal,
      latestCode: status.progress.latestCode,
      providerContractReady: providerContract.ready,
    },
    diagnostics,
    truthBoundary: {
      level: descriptor.truthBoundary?.level || 'unknown',
      externalWritesAllowed: canRollback,
      rollbackRequiresFreshVerifier: canRollback,
    },
    permissionBoundary,
    boundaryContinuity,
    providerContract,
    lifecycleControls,
    componentReadiness,
    exportSummary,
    preview: buildRollbackPreview(descriptor, {
      inverseAction,
      canRollback,
      baseRollbackReady,
      permissionBoundary,
      boundaryContinuity,
      lifecycleControls,
      providerContract,
      componentReadiness,
    }, exportSummary),
    acceptance,
  };
  const persistence = buildRollbackPersistence(descriptor, {
    ...persistenceSeed,
    canRollback,
  }, runtime);
  const recovery = buildRollbackRecoveryHandoff(descriptor, status, assessment, persistence, runtime);
  const stateEnvelope = buildRollbackStateEnvelope(descriptor, status, persistence, recovery, runtime);
  const restartPlan = buildRollbackRestartPlan(stateEnvelope, recovery, persistence);
  const operationalHealth = createRollbackOperationalHealth(
    descriptor,
    status,
    assessment,
    persistence,
    recovery,
    stateEnvelope,
    restartPlan,
    runtime,
  );
  const analyticsReport = buildRollbackAnalyticsReport(
    descriptor,
    status,
    assessment,
    persistence,
    recovery,
    stateEnvelope,
    restartPlan,
    operationalHealth,
    runtime,
  );
  const adapterRecoveryDirective = buildRollbackAdapterRecoveryDirective(
    descriptor,
    status,
    assessment,
    persistence,
    recovery,
    stateEnvelope,
    restartPlan,
    operationalHealth,
    runtime,
  );
  const enrichedAssessment = {
    ...assessment,
    persistence,
    recovery,
    stateEnvelope,
    restartPlan,
    operationalHealth,
    analyticsReport,
    adapterRecoveryDirective,
  };
  const clientRuntime = buildClientRuntimeAdoption(status, enrichedAssessment, acceptance, runtime);
  const clientReviewPacket = createRollbackClientReviewPacket(status, enrichedAssessment, acceptance, clientRuntime, runtime);

  return {
    ...enrichedAssessment,
    clientRuntime,
    clientReviewPacket,
  };
}

export function buildMailchimpRollbackAnalyticsReport(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).analyticsReport;
}

export function buildMailchimpRollbackOperationalHealth(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).operationalHealth;
}

export function buildMailchimpRollbackAdapterRecoveryDirective(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).adapterRecoveryDirective;
}

export function buildMailchimpRollbackLifecycleControls(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).lifecycleControls;
}

export function buildMailchimpRollbackComponentReadinessSummary(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).componentReadiness;
}

export function buildMailchimpRollbackManifest(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const assessment = assessMailchimpRollback(descriptor, runtime);
  const rollbackRequestId = `${descriptor.requestId}:rollback`;
  const inverseCapability = rollbackCapabilityFor(descriptor.action);

  return {
    ...assessment,
    manifest: {
      type: 'KernelJobDescriptor',
      adapter: 'mailchimp',
      action: assessment.inverseAction,
      tenant: descriptor.tenant,
      requestId: rollbackRequestId,
      idempotencyKey: descriptor.idempotencyKey ? `${descriptor.idempotencyKey}:rollback` : '',
      dryRun: !assessment.canRollback,
      capabilities: [
        'adapter.mailchimp',
        ...(inverseCapability ? [inverseCapability] : []),
        ...(assessment.canRollback ? ['external.write'] : ['external.write.denied']),
        ...(assessment.providerContract?.ready === true ? ['provider.mailchimp.ready'] : ['provider.mailchimp.refresh_required']),
        ...(assessment.providerContract?.capabilityNegotiation?.missing || []).map((capability) => `provider.missing.${capability}`),
        ...(assessment.permissionBoundary?.allowed === true ? ['tenant.permission.verified'] : ['tenant.permission.denied']),
        ...(assessment.lifecycleControls?.canProceed === true ? ['rollback.lifecycle.released'] : ['rollback.lifecycle.held']),
      ].sort(),
      memory: [
        ...(descriptor.memory || []),
        { ref: `rollback.audit.${descriptor.requestId}`, mode: 'write', boundary: 'local' },
        ...(assessment.permissionBoundary?.audit?.auditRef
          ? [{ ref: assessment.permissionBoundary.audit.auditRef, mode: 'write', boundary: 'tenant' }]
          : []),
      ],
      verifierContracts: assessment.canRollback
        ? [
          { name: 'mailchimp.rollback.operator_approval', required: true, scope: 'mailchimp' },
          { name: 'mailchimp.rollback.recovery_handoff', required: true, scope: 'mailchimp' },
          {
            name: 'mailchimp.rollback.tenant_permission_boundary',
            required: true,
            scope: assessment.permissionBoundary?.scope?.tenant || 'mailchimp',
          },
          {
            name: 'mailchimp.rollback.lifecycle_controls',
            required: true,
            scope: assessment.lifecycleControls?.source || 'runtime',
          },
          {
            name: 'mailchimp.rollback.provider_service_contract',
            required: true,
            scope: assessment.providerContract?.provider || 'mailchimp',
          },
        ]
        : [],
      payload: safePayload(descriptor.payload),
      tenantPermissionBoundary: {
        protocol: assessment.permissionBoundary.protocol,
        allowed: assessment.permissionBoundary.allowed,
        source: assessment.permissionBoundary.source,
        policyVersion: assessment.permissionBoundary.policyVersion,
        evaluatedAt: assessment.permissionBoundary.evaluatedAt,
        actor: assessment.permissionBoundary.actor,
        scope: assessment.permissionBoundary.scope,
        permissions: assessment.permissionBoundary.permissions,
        audit: assessment.permissionBoundary.audit,
        blockers: assessment.permissionBoundary.blockers,
        nextAction: assessment.permissionBoundary.nextAction,
      },
      lifecycleControls: {
        protocol: assessment.lifecycleControls.protocol,
        source: assessment.lifecycleControls.source,
        policyVersion: assessment.lifecycleControls.policyVersion,
        evaluatedAt: assessment.lifecycleControls.evaluatedAt,
        enabled: assessment.lifecycleControls.enabled,
        canProceed: assessment.lifecycleControls.canProceed,
        holdState: assessment.lifecycleControls.holdState,
        nextAction: assessment.lifecycleControls.nextAction,
        controls: assessment.lifecycleControls.controls,
        schedule: assessment.lifecycleControls.schedule,
        manualGate: assessment.lifecycleControls.manualGate,
        blockers: assessment.lifecycleControls.blockers,
        warnings: assessment.lifecycleControls.warnings,
      },
      providerContract: {
        protocol: assessment.providerContract.protocol,
        provider: assessment.providerContract.provider,
        service: assessment.providerContract.service,
        version: assessment.providerContract.version,
        serviceState: assessment.providerContract.serviceState,
        ready: assessment.providerContract.ready,
        capabilityNegotiation: assessment.providerContract.capabilityNegotiation,
        sync: assessment.providerContract.sync,
        lease: assessment.providerContract.lease,
        externalHandoff: assessment.providerContract.externalHandoff,
        blockers: assessment.providerContract.blockers,
        warnings: assessment.providerContract.warnings,
        nextAction: assessment.providerContract.nextAction,
      },
      truthBoundary: {
        level: descriptor.truthBoundary?.level || 'unknown',
        externalWritesAllowed: assessment.canRollback,
        evidenceRequired: assessment.canRollback
          ? ['originalIdempotencyKey', 'operatorApproval', 'rollbackAuditRef', 'tenantPermissionAuditRef']
          : ['rollbackAuditRef', 'tenantPermissionAuditRef'],
      },
      diagnostics: assessment.diagnostics,
      recoveryHandoff: {
        protocol: assessment.recovery.protocol,
        resumeMode: assessment.recovery.resumeMode,
        latestState: assessment.recovery.latestState,
        leaseState: assessment.recovery.leaseState,
        statusBinding: assessment.recovery.statusBinding,
        checkpoint: assessment.recovery.checkpoint,
        nextAction: assessment.recovery.nextAction,
      },
      persistedState: {
        protocol: assessment.stateEnvelope.protocol,
        key: assessment.stateEnvelope.key,
        checkpointId: assessment.stateEnvelope.checkpointId,
        epoch: assessment.stateEnvelope.epoch,
        persistedState: assessment.stateEnvelope.persistedState,
        restartTerminal: assessment.stateEnvelope.restartTerminal,
        writeIntent: assessment.stateEnvelope.writeIntent,
        command: assessment.stateEnvelope.command,
        status: assessment.stateEnvelope.status,
        restartSafety: assessment.stateEnvelope.restartSafety,
      },
      restartPlan: {
        protocol: assessment.restartPlan.protocol,
        mode: assessment.restartPlan.mode,
        canResume: assessment.restartPlan.canResume,
        statusSemantics: assessment.restartPlan.statusSemantics,
        nextAction: assessment.restartPlan.nextAction,
        resumeToken: assessment.restartPlan.resumeToken,
        guards: assessment.restartPlan.guards,
      },
      operationalHealth: {
        protocol: assessment.operationalHealth.protocol,
        healthState: assessment.operationalHealth.healthState,
        healthy: assessment.operationalHealth.healthy,
        degraded: assessment.operationalHealth.degraded,
        canQueue: assessment.operationalHealth.canQueue,
        failureState: assessment.operationalHealth.failureState,
        retryPolicy: assessment.operationalHealth.retryPolicy,
        degradedMode: assessment.operationalHealth.degradedMode,
        runtimeHealth: assessment.operationalHealth.runtimeHealth,
        providerOperations: assessment.operationalHealth.providerOperations,
        actionableErrors: assessment.operationalHealth.actionableErrors,
        blockers: assessment.operationalHealth.blockers,
        warnings: assessment.operationalHealth.warnings,
        nextAction: assessment.operationalHealth.nextAction,
      },
      componentReadiness: {
        protocol: assessment.componentReadiness.protocol,
        supplied: assessment.componentReadiness.supplied,
        status: assessment.componentReadiness.status,
        ready: assessment.componentReadiness.ready,
        nextAction: assessment.componentReadiness.nextAction,
        primaryComponent: assessment.componentReadiness.primaryComponent,
        primaryComponentType: assessment.componentReadiness.primaryComponentType,
        counts: assessment.componentReadiness.counts,
        blockerCodes: assessment.componentReadiness.blockerCodes,
        warningCodes: assessment.componentReadiness.warningCodes,
        packets: assessment.componentReadiness.packets,
        operatorHandoffs: assessment.componentReadiness.operatorHandoffs,
      },
      adapterRecoveryDirective: {
        protocol: assessment.adapterRecoveryDirective.protocol,
        action: assessment.adapterRecoveryDirective.action,
        writeMode: assessment.adapterRecoveryDirective.writeMode,
        blocked: assessment.adapterRecoveryDirective.blocked,
        retryable: assessment.adapterRecoveryDirective.retryable,
        terminal: assessment.adapterRecoveryDirective.terminal,
        statusPatch: assessment.adapterRecoveryDirective.statusPatch,
        recoveryCommand: assessment.adapterRecoveryDirective.recoveryCommand,
        capabilityClaims: assessment.adapterRecoveryDirective.capabilityClaims,
        memoryWrites: assessment.adapterRecoveryDirective.memoryWrites,
        verifierClaims: assessment.adapterRecoveryDirective.verifierClaims,
        handoff: assessment.adapterRecoveryDirective.handoff,
        blockers: assessment.adapterRecoveryDirective.blockers,
        nextAction: assessment.adapterRecoveryDirective.nextAction,
      },
      analyticsReport: {
        protocol: assessment.analyticsReport.protocol,
        exportReady: assessment.analyticsReport.exportReady,
        counters: assessment.analyticsReport.counters,
        distributions: assessment.analyticsReport.distributions,
        history: {
          snapshotCount: assessment.analyticsReport.history.snapshotCount,
          latestSnapshotId: assessment.analyticsReport.history.latestSnapshotId,
          latestState: assessment.analyticsReport.history.latestState,
          terminal: assessment.analyticsReport.history.terminal,
          snapshots: assessment.analyticsReport.history.snapshots,
        },
        timeline: assessment.analyticsReport.timeline,
        exports: assessment.analyticsReport.exports,
        reportState: assessment.analyticsReport.reportState,
      },
      clientWorkflowHandoff: {
        protocol: assessment.clientRuntime.workflowHandoff.protocol,
        currentStepId: assessment.clientRuntime.workflowHandoff.currentStepId,
        currentAction: assessment.clientRuntime.workflowHandoff.currentAction,
        readyForQueue: assessment.clientRuntime.workflowHandoff.readyForQueue,
        retryable: assessment.clientRuntime.workflowHandoff.retryable,
        blockers: assessment.clientRuntime.workflowHandoff.blockers,
        clientMutation: assessment.clientRuntime.workflowHandoff.clientMutation,
      },
      clientRequestState: {
        protocol: assessment.clientReviewPacket.requestState.protocol,
        revision: assessment.clientReviewPacket.requestState.revision,
        staleClientRevision: assessment.clientReviewPacket.requestState.staleClientRevision,
        needsClientPersistence: assessment.clientReviewPacket.requestState.needsClientPersistence,
        requestKey: assessment.clientReviewPacket.requestState.requestKey,
        rollbackRequestId: assessment.clientReviewPacket.requestState.rollbackRequestId,
        clientMutationId: assessment.clientReviewPacket.requestState.clientMutationId,
        viewState: assessment.clientReviewPacket.requestState.viewState,
        persistencePatch: assessment.clientReviewPacket.requestState.persistencePatch,
        statusHandoff: assessment.clientReviewPacket.requestState.statusHandoff,
        enabledActions: assessment.clientReviewPacket.requestState.enabledActions,
        disabledControls: assessment.clientReviewPacket.requestState.disabledControls,
      },
      clientWorkflowTransitionPlan: {
        protocol: assessment.clientReviewPacket.workflowTransitionPlan.protocol,
        transitionState: assessment.clientReviewPacket.workflowTransitionPlan.transitionState,
        requestRevision: assessment.clientReviewPacket.workflowTransitionPlan.requestRevision,
        clientMutationId: assessment.clientReviewPacket.workflowTransitionPlan.clientMutationId,
        persistRequired: assessment.clientReviewPacket.workflowTransitionPlan.persistRequired,
        currentStepId: assessment.clientReviewPacket.workflowTransitionPlan.currentStepId,
        currentAction: assessment.clientReviewPacket.workflowTransitionPlan.currentAction,
        nextAction: assessment.clientReviewPacket.workflowTransitionPlan.nextAction,
        nextOperationId: assessment.clientReviewPacket.workflowTransitionPlan.nextOperationId,
        routePatch: assessment.clientReviewPacket.workflowTransitionPlan.routePatch,
        telemetry: assessment.clientReviewPacket.workflowTransitionPlan.telemetry,
        enabledOperations: assessment.clientReviewPacket.workflowTransitionPlan.enabledOperations,
        blockedOperations: assessment.clientReviewPacket.workflowTransitionPlan.blockedOperations,
      },
      clientReviewPacket: {
        protocol: assessment.clientReviewPacket.protocol,
        requestId: assessment.clientReviewPacket.requestId,
        rollbackRequestId: assessment.clientReviewPacket.rollbackRequestId,
        status: assessment.clientReviewPacket.status,
        preview: assessment.clientReviewPacket.preview,
        acceptance: assessment.clientReviewPacket.acceptance,
        readiness: assessment.clientReviewPacket.readiness,
        validationSummary: {
          protocol: assessment.clientReviewPacket.validationSummary.protocol,
          ready: assessment.clientReviewPacket.validationSummary.ready,
          total: assessment.clientReviewPacket.validationSummary.total,
          passing: assessment.clientReviewPacket.validationSummary.passing,
          blocking: assessment.clientReviewPacket.validationSummary.blocking,
          warnings: assessment.clientReviewPacket.validationSummary.warnings,
          primaryBlocker: assessment.clientReviewPacket.validationSummary.primaryBlocker,
          primaryMessage: assessment.clientReviewPacket.validationSummary.primaryMessage,
          sections: assessment.clientReviewPacket.validationSummary.sections,
          actionable: assessment.clientReviewPacket.validationSummary.actionable,
        },
        nextStep: assessment.clientReviewPacket.nextStep,
        requestState: assessment.clientReviewPacket.requestState,
        workflowTransitionPlan: assessment.clientReviewPacket.workflowTransitionPlan,
        checklist: assessment.clientReviewPacket.checklist,
        routeHints: assessment.clientReviewPacket.routeHints,
      },
    },
    persistence: {
      ...assessment.persistence,
      command: {
        ...assessment.persistence.command,
        manifestRequestId: rollbackRequestId,
      },
    },
    ui: {
      preview: assessment.preview,
      reviewPacket: assessment.clientReviewPacket,
      acceptance: assessment.acceptance,
      readiness: assessment.preview.readiness,
      nextStep: assessment.persistence.command.replayOf
        ? 'surface_existing_rollback_command'
        : assessment.acceptance.nextAction,
      clientRuntime: assessment.clientRuntime,
      persistence: {
        commandState: assessment.persistence.command.state,
        commandId: assessment.persistence.command.commandId,
        replayOf: assessment.persistence.command.replayOf,
        duplicateDetected: assessment.persistence.restartSafety.duplicateDetected,
      },
      recovery: {
        resumeMode: assessment.recovery.resumeMode,
        ready: assessment.recovery.ready,
        terminal: assessment.recovery.terminal,
        latestState: assessment.recovery.latestState,
        nextAction: assessment.recovery.nextAction,
        blockers: assessment.recovery.blockers,
      },
      tenantPermissionBoundary: {
        allowed: assessment.permissionBoundary.allowed,
        actorId: assessment.permissionBoundary.actor.id,
        tenant: assessment.permissionBoundary.scope.tenant,
        workspace: assessment.permissionBoundary.scope.workspace,
        missingPermissions: assessment.permissionBoundary.permissions.missing,
        auditRef: assessment.permissionBoundary.audit.auditRef,
        blockers: assessment.permissionBoundary.blockers,
        nextAction: assessment.permissionBoundary.nextAction,
      },
      lifecycleControls: {
        enabled: assessment.lifecycleControls.enabled,
        canProceed: assessment.lifecycleControls.canProceed,
        holdState: assessment.lifecycleControls.holdState,
        nextAction: assessment.lifecycleControls.nextAction,
        requestedCommand: assessment.lifecycleControls.controls.requestedCommand,
        allowedCommands: assessment.lifecycleControls.controls.allowedCommands,
        disabledCommands: assessment.lifecycleControls.controls.disabledCommands,
        schedule: assessment.lifecycleControls.schedule,
        manualGate: assessment.lifecycleControls.manualGate,
        blockers: assessment.lifecycleControls.blockers,
        warnings: assessment.lifecycleControls.warnings,
      },
      providerContract: {
        ready: assessment.providerContract.ready,
        provider: assessment.providerContract.provider,
        service: assessment.providerContract.service,
        serviceState: assessment.providerContract.serviceState,
        requiredCapabilities: assessment.providerContract.capabilityNegotiation.required,
        missingCapabilities: assessment.providerContract.capabilityNegotiation.missing,
        syncState: assessment.providerContract.sync.state,
        syncCursor: assessment.providerContract.sync.cursor,
        syncStale: assessment.providerContract.sync.stale,
        leaseState: assessment.providerContract.lease.state,
        externalRequestId: assessment.providerContract.externalHandoff.requestId,
        handoffState: assessment.providerContract.externalHandoff.state,
        blockers: assessment.providerContract.blockers,
        warnings: assessment.providerContract.warnings,
        nextAction: assessment.providerContract.nextAction,
      },
      persistedState: {
        checkpointId: assessment.stateEnvelope.checkpointId,
        persistedState: assessment.stateEnvelope.persistedState,
        writeIntent: assessment.stateEnvelope.writeIntent,
        restartTerminal: assessment.stateEnvelope.restartTerminal,
        replaySafe: assessment.stateEnvelope.restartSafety.replaySafe,
        staleCheckpoint: assessment.stateEnvelope.restartSafety.staleCheckpoint,
        statusConflict: assessment.stateEnvelope.restartSafety.statusConflict,
      },
      restart: {
        mode: assessment.restartPlan.mode,
        canResume: assessment.restartPlan.canResume,
        statusSemantics: assessment.restartPlan.statusSemantics,
        nextAction: assessment.restartPlan.nextAction,
        guards: assessment.restartPlan.guards,
      },
      operationalHealth: {
        healthState: assessment.operationalHealth.healthState,
        canQueue: assessment.operationalHealth.canQueue,
        degraded: assessment.operationalHealth.degraded,
        nextAction: assessment.operationalHealth.nextAction,
        retry: assessment.operationalHealth.retryPolicy,
        failureState: assessment.operationalHealth.failureState,
        runtimeHealth: assessment.operationalHealth.runtimeHealth,
        providerOperations: assessment.operationalHealth.providerOperations,
        actionableErrors: assessment.operationalHealth.actionableErrors,
        blockers: assessment.operationalHealth.blockers,
        warnings: assessment.operationalHealth.warnings,
      },
      componentReadiness: {
        supplied: assessment.componentReadiness.supplied,
        status: assessment.componentReadiness.status,
        ready: assessment.componentReadiness.ready,
        nextAction: assessment.componentReadiness.nextAction,
        primaryComponent: assessment.componentReadiness.primaryComponent,
        counts: assessment.componentReadiness.counts,
        blockerCodes: assessment.componentReadiness.blockerCodes,
        warningCodes: assessment.componentReadiness.warningCodes,
        packets: assessment.componentReadiness.packets,
        operatorHandoffs: assessment.componentReadiness.operatorHandoffs,
      },
      adapterRecoveryDirective: {
        action: assessment.adapterRecoveryDirective.action,
        writeMode: assessment.adapterRecoveryDirective.writeMode,
        statusState: assessment.adapterRecoveryDirective.statusPatch.state,
        commandState: assessment.adapterRecoveryDirective.recoveryCommand.state,
        providerRequestId: assessment.adapterRecoveryDirective.providerRequestId,
        blockers: assessment.adapterRecoveryDirective.blockers,
        nextAction: assessment.adapterRecoveryDirective.nextAction,
      },
      analyticsReport: {
        exportReady: assessment.analyticsReport.exportReady,
        counters: assessment.analyticsReport.counters,
        latestSnapshotId: assessment.analyticsReport.history.latestSnapshotId,
        latestHistoryState: assessment.analyticsReport.history.latestState,
        timelineEventCount: assessment.analyticsReport.timeline.events.length,
        exportBlockers: assessment.analyticsReport.exports.summary.blockers,
        nextAction: assessment.analyticsReport.reportState.nextAction,
        reportState: assessment.analyticsReport.reportState.state,
      },
      workflowHandoff: assessment.clientRuntime.workflowHandoff,
      requestState: assessment.clientReviewPacket.requestState,
      workflowTransitionPlan: assessment.clientReviewPacket.workflowTransitionPlan,
      validationSummary: assessment.clientReviewPacket.validationSummary,
    },
  };
}

export function buildMailchimpRollbackClientReviewPacket(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).clientReviewPacket;
}

export function buildMailchimpRollbackClientRequestState(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).clientReviewPacket.requestState;
}

export function buildMailchimpRollbackClientWorkflowTransitionPlan(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).clientReviewPacket.workflowTransitionPlan;
}

export function buildMailchimpRollbackValidationSummary(input = {}, runtime = {}) {
  return assessMailchimpRollback(input, runtime).clientReviewPacket.validationSummary;
}

export function verifyMailchimpRollbackHandoff(input = {}, runtime = {}) {
  const manifest = buildMailchimpRollbackManifest(input, runtime);
  const validation = [
    ...(manifest.preview?.readiness?.validation || []),
    ...(manifest.lifecycleControls?.validation || []),
    ...(manifest.providerContract?.validation || []),
    ...(manifest.recovery?.validation || []),
    ...(manifest.permissionBoundary?.validation || []),
    {
      code: 'mailchimp.rollback.self_check.provider_contract_exported',
      ok: Boolean(
        manifest.providerContract?.protocol === 'aios.rollback-provider-service-contract.mailchimp.v1'
          && manifest.manifest?.providerContract?.protocol === manifest.providerContract.protocol
          && manifest.manifest.providerContract.nextAction
          && Array.isArray(manifest.providerContract.capabilityNegotiation?.required),
      ),
      severity: manifest.providerContract?.protocol === 'aios.rollback-provider-service-contract.mailchimp.v1'
        && manifest.manifest?.providerContract?.protocol === manifest.providerContract.protocol
        && manifest.manifest.providerContract.nextAction
        && Array.isArray(manifest.providerContract.capabilityNegotiation?.required)
        ? 'info'
        : 'error',
      message: manifest.providerContract?.protocol === 'aios.rollback-provider-service-contract.mailchimp.v1'
        && manifest.manifest?.providerContract?.protocol === manifest.providerContract.protocol
        && manifest.manifest.providerContract.nextAction
        && Array.isArray(manifest.providerContract.capabilityNegotiation?.required)
        ? 'Rollback manifest exports deterministic Mailchimp provider service contract state.'
        : 'Rollback manifest is missing its Mailchimp provider service contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.provider_contract_gates_queue',
      ok: manifest.providerContract?.ready === true || manifest.canRollback === false,
      severity: manifest.providerContract?.ready === true || manifest.canRollback === false ? 'info' : 'error',
      message: manifest.providerContract?.ready === true || manifest.canRollback === false
        ? 'Mailchimp provider service contract gates rollback queueing.'
        : 'Rollback can queue despite an unready Mailchimp provider service contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.provider_sync_metadata',
      ok: manifest.providerContract?.ready !== true || Boolean(
        manifest.providerContract.sync?.cursor
          && manifest.providerContract.sync?.stale === false
          && manifest.manifest?.providerContract?.externalHandoff?.requestId,
      ),
      severity: manifest.providerContract?.ready !== true || (
        manifest.providerContract.sync?.cursor
          && manifest.providerContract.sync?.stale === false
          && manifest.manifest?.providerContract?.externalHandoff?.requestId
      ) ? 'info' : 'error',
      message: manifest.providerContract?.ready !== true || (
        manifest.providerContract.sync?.cursor
          && manifest.providerContract.sync?.stale === false
          && manifest.manifest?.providerContract?.externalHandoff?.requestId
      )
        ? 'Ready Mailchimp provider contract includes fresh sync metadata and an external handoff request.'
        : 'Ready Mailchimp provider contract is missing sync metadata or external handoff state.',
    },
    {
      code: 'mailchimp.rollback.self_check.lifecycle_controls_exported',
      ok: Boolean(
        manifest.lifecycleControls?.protocol === 'aios.rollback-lifecycle-controls.mailchimp.v1'
          && manifest.manifest?.lifecycleControls?.protocol === manifest.lifecycleControls.protocol
          && manifest.lifecycleControls.holdState
          && manifest.lifecycleControls.nextAction,
      ),
      severity: manifest.lifecycleControls?.protocol === 'aios.rollback-lifecycle-controls.mailchimp.v1'
        && manifest.manifest?.lifecycleControls?.protocol === manifest.lifecycleControls.protocol
        && manifest.lifecycleControls.holdState
        && manifest.lifecycleControls.nextAction
        ? 'info'
        : 'error',
      message: manifest.lifecycleControls?.protocol === 'aios.rollback-lifecycle-controls.mailchimp.v1'
        && manifest.manifest?.lifecycleControls?.protocol === manifest.lifecycleControls.protocol
        && manifest.lifecycleControls.holdState
        && manifest.lifecycleControls.nextAction
        ? 'Rollback manifest exports deterministic lifecycle controls and next action.'
        : 'Rollback manifest is missing lifecycle controls or next action state.',
    },
    {
      code: 'mailchimp.rollback.self_check.lifecycle_controls_gate_queue',
      ok: manifest.lifecycleControls?.canProceed === true || manifest.canRollback === false,
      severity: manifest.lifecycleControls?.canProceed === true || manifest.canRollback === false ? 'info' : 'error',
      message: manifest.lifecycleControls?.canProceed === true || manifest.canRollback === false
        ? 'Lifecycle controls are enforced before rollback queueing.'
        : 'Rollback can queue despite lifecycle controls holding the workflow.',
    },
    {
      code: 'mailchimp.rollback.self_check.manifest_action',
      ok: Boolean(manifest.manifest?.action && manifest.manifest.action === manifest.inverseAction),
      severity: manifest.manifest?.action && manifest.manifest.action === manifest.inverseAction ? 'info' : 'error',
      message: manifest.manifest?.action && manifest.manifest.action === manifest.inverseAction
        ? 'Rollback manifest action matches the assessed inverse action.'
        : 'Rollback manifest action does not match the assessed inverse action.',
    },
    {
      code: 'mailchimp.rollback.self_check.recovery_exported',
      ok: manifest.manifest?.recoveryHandoff?.protocol === 'aios.rollback-recovery-handoff.mailchimp.v1',
      severity: manifest.manifest?.recoveryHandoff?.protocol === 'aios.rollback-recovery-handoff.mailchimp.v1' ? 'info' : 'error',
      message: manifest.manifest?.recoveryHandoff?.protocol === 'aios.rollback-recovery-handoff.mailchimp.v1'
        ? 'Rollback manifest exports a deterministic recovery handoff contract.'
        : 'Rollback manifest is missing its recovery handoff contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_next_action',
      ok: Boolean(manifest.clientRuntime?.nextAction || manifest.ui?.nextStep),
      severity: manifest.clientRuntime?.nextAction || manifest.ui?.nextStep ? 'info' : 'warning',
      message: manifest.clientRuntime?.nextAction || manifest.ui?.nextStep
        ? 'Client runtime has a deterministic rollback next action.'
        : 'Client runtime does not expose a deterministic rollback next action.',
    },
    {
      code: 'mailchimp.rollback.self_check.workflow_handoff',
      ok: Boolean(
        manifest.clientRuntime?.workflowHandoff?.currentStepId
          && manifest.manifest?.clientWorkflowHandoff?.currentStepId === manifest.clientRuntime.workflowHandoff.currentStepId,
      ),
      severity: manifest.clientRuntime?.workflowHandoff?.currentStepId
        && manifest.manifest?.clientWorkflowHandoff?.currentStepId === manifest.clientRuntime.workflowHandoff.currentStepId
        ? 'info'
        : 'error',
      message: manifest.clientRuntime?.workflowHandoff?.currentStepId
        && manifest.manifest?.clientWorkflowHandoff?.currentStepId === manifest.clientRuntime.workflowHandoff.currentStepId
        ? 'Rollback manifest exports the same workflow handoff step as client runtime.'
        : 'Rollback workflow handoff is missing or inconsistent between manifest and client runtime.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_review_packet',
      ok: Boolean(
        manifest.clientReviewPacket?.protocol === 'aios.rollback-client-review-packet.mailchimp.v1'
          && manifest.manifest?.clientReviewPacket?.protocol === manifest.clientReviewPacket.protocol
          && manifest.ui?.reviewPacket?.protocol === manifest.clientReviewPacket.protocol
          && manifest.clientReviewPacket.validationSummary?.protocol === 'aios.rollback-validation-summary.mailchimp.v1'
          && manifest.clientReviewPacket.nextStep?.action,
      ),
      severity: manifest.clientReviewPacket?.protocol === 'aios.rollback-client-review-packet.mailchimp.v1'
        && manifest.manifest?.clientReviewPacket?.protocol === manifest.clientReviewPacket.protocol
        && manifest.ui?.reviewPacket?.protocol === manifest.clientReviewPacket.protocol
        && manifest.clientReviewPacket.validationSummary?.protocol === 'aios.rollback-validation-summary.mailchimp.v1'
        && manifest.clientReviewPacket.nextStep?.action
        ? 'info'
        : 'error',
      message: manifest.clientReviewPacket?.protocol === 'aios.rollback-client-review-packet.mailchimp.v1'
        && manifest.manifest?.clientReviewPacket?.protocol === manifest.clientReviewPacket.protocol
        && manifest.ui?.reviewPacket?.protocol === manifest.clientReviewPacket.protocol
        && manifest.clientReviewPacket.validationSummary?.protocol === 'aios.rollback-validation-summary.mailchimp.v1'
        && manifest.clientReviewPacket.nextStep?.action
        ? 'Rollback manifest exports the deterministic client review packet, validation summary, and next-step action.'
        : 'Rollback manifest is missing its deterministic client review packet or next-step action.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_review_routes',
      ok: Boolean(
        manifest.clientReviewPacket?.routeHints
          && typeof manifest.clientReviewPacket.routeHints.canRenderPreview === 'boolean'
          && typeof manifest.clientReviewPacket.routeHints.canQueueRollback === 'boolean'
          && Array.isArray(manifest.clientReviewPacket.checklist),
      ),
      severity: manifest.clientReviewPacket?.routeHints
        && typeof manifest.clientReviewPacket.routeHints.canRenderPreview === 'boolean'
        && typeof manifest.clientReviewPacket.routeHints.canQueueRollback === 'boolean'
        && Array.isArray(manifest.clientReviewPacket.checklist)
        ? 'info'
        : 'error',
      message: manifest.clientReviewPacket?.routeHints
        && typeof manifest.clientReviewPacket.routeHints.canRenderPreview === 'boolean'
        && typeof manifest.clientReviewPacket.routeHints.canQueueRollback === 'boolean'
        && Array.isArray(manifest.clientReviewPacket.checklist)
        ? 'Rollback client review packet exposes route hints and checklist state for UI clients.'
        : 'Rollback client review packet is missing route hints or checklist state.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_request_state',
      ok: Boolean(
        manifest.clientReviewPacket?.requestState?.protocol === 'aios.rollback-client-request-state.mailchimp.v1'
          && manifest.manifest?.clientRequestState?.protocol === manifest.clientReviewPacket.requestState.protocol
          && manifest.ui?.requestState?.protocol === manifest.clientReviewPacket.requestState.protocol
          && manifest.clientReviewPacket.requestState.revision
          && Array.isArray(manifest.clientReviewPacket.requestState.controls)
          && Array.isArray(manifest.clientReviewPacket.requestState.disabledControls),
      ),
      severity: manifest.clientReviewPacket?.requestState?.protocol === 'aios.rollback-client-request-state.mailchimp.v1'
        && manifest.manifest?.clientRequestState?.protocol === manifest.clientReviewPacket.requestState.protocol
        && manifest.ui?.requestState?.protocol === manifest.clientReviewPacket.requestState.protocol
        && manifest.clientReviewPacket.requestState.revision
        && Array.isArray(manifest.clientReviewPacket.requestState.controls)
        && Array.isArray(manifest.clientReviewPacket.requestState.disabledControls)
        ? 'info'
        : 'error',
      message: manifest.clientReviewPacket?.requestState?.protocol === 'aios.rollback-client-request-state.mailchimp.v1'
        && manifest.manifest?.clientRequestState?.protocol === manifest.clientReviewPacket.requestState.protocol
        && manifest.ui?.requestState?.protocol === manifest.clientReviewPacket.requestState.protocol
        && manifest.clientReviewPacket.requestState.revision
        && Array.isArray(manifest.clientReviewPacket.requestState.controls)
        && Array.isArray(manifest.clientReviewPacket.requestState.disabledControls)
        ? 'Rollback manifest exports deterministic client request state, control availability, and route persistence hints.'
        : 'Rollback manifest is missing deterministic client request state or control availability.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_request_state_queue_gate',
      ok: manifest.clientReviewPacket?.requestState?.controls?.some((control) => (
        control.id === 'queue_rollback'
          && control.enabled === (
            manifest.clientRuntime?.workflowHandoff?.readyForQueue === true
              && manifest.clientReviewPacket?.validationSummary?.ready === true
              && manifest.acceptance?.ready === true
              && manifest.operationalHealth?.canQueue === true
          )
      )) === true,
      severity: manifest.clientReviewPacket?.requestState?.controls?.some((control) => (
        control.id === 'queue_rollback'
          && control.enabled === (
            manifest.clientRuntime?.workflowHandoff?.readyForQueue === true
              && manifest.clientReviewPacket?.validationSummary?.ready === true
              && manifest.acceptance?.ready === true
              && manifest.operationalHealth?.canQueue === true
          )
      )) === true ? 'info' : 'error',
      message: manifest.clientReviewPacket?.requestState?.controls?.some((control) => (
        control.id === 'queue_rollback'
          && control.enabled === (
            manifest.clientRuntime?.workflowHandoff?.readyForQueue === true
              && manifest.clientReviewPacket?.validationSummary?.ready === true
              && manifest.acceptance?.ready === true
              && manifest.operationalHealth?.canQueue === true
          )
      )) === true
        ? 'Client request state gates queue controls on workflow, validation, acceptance, and operational health.'
        : 'Client request state queue control does not match rollback readiness gates.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_workflow_transition_plan',
      ok: Boolean(
        manifest.clientReviewPacket?.workflowTransitionPlan?.protocol === 'aios.rollback-client-workflow-transition-plan.mailchimp.v1'
          && manifest.manifest?.clientWorkflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
          && manifest.ui?.workflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
          && manifest.clientReviewPacket.workflowTransitionPlan.requestRevision === manifest.clientReviewPacket.requestState?.revision
          && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.operations)
          && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.enabledOperations)
          && manifest.clientReviewPacket.workflowTransitionPlan.nextOperationId,
      ),
      severity: manifest.clientReviewPacket?.workflowTransitionPlan?.protocol === 'aios.rollback-client-workflow-transition-plan.mailchimp.v1'
        && manifest.manifest?.clientWorkflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
        && manifest.ui?.workflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
        && manifest.clientReviewPacket.workflowTransitionPlan.requestRevision === manifest.clientReviewPacket.requestState?.revision
        && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.operations)
        && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.enabledOperations)
        && manifest.clientReviewPacket.workflowTransitionPlan.nextOperationId
        ? 'info'
        : 'error',
      message: manifest.clientReviewPacket?.workflowTransitionPlan?.protocol === 'aios.rollback-client-workflow-transition-plan.mailchimp.v1'
        && manifest.manifest?.clientWorkflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
        && manifest.ui?.workflowTransitionPlan?.protocol === manifest.clientReviewPacket.workflowTransitionPlan.protocol
        && manifest.clientReviewPacket.workflowTransitionPlan.requestRevision === manifest.clientReviewPacket.requestState?.revision
        && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.operations)
        && Array.isArray(manifest.clientReviewPacket.workflowTransitionPlan.enabledOperations)
        && manifest.clientReviewPacket.workflowTransitionPlan.nextOperationId
        ? 'Rollback manifest exports deterministic client workflow transition operations and route patch state.'
        : 'Rollback manifest is missing deterministic client workflow transition operations or route patch state.',
    },
    {
      code: 'mailchimp.rollback.self_check.client_workflow_transition_queue_gate',
      ok: manifest.clientReviewPacket?.workflowTransitionPlan?.operations?.some((operation) => (
        operation.id === 'queue_or_observe_rollback'
          && operation.enabled === (
            manifest.clientReviewPacket?.requestState?.controls?.some((control) => control.id === 'queue_rollback' && control.enabled === true)
              || Boolean(manifest.persistence?.command?.replayOf)
          )
      )) === true,
      severity: manifest.clientReviewPacket?.workflowTransitionPlan?.operations?.some((operation) => (
        operation.id === 'queue_or_observe_rollback'
          && operation.enabled === (
            manifest.clientReviewPacket?.requestState?.controls?.some((control) => control.id === 'queue_rollback' && control.enabled === true)
              || Boolean(manifest.persistence?.command?.replayOf)
          )
      )) === true ? 'info' : 'error',
      message: manifest.clientReviewPacket?.workflowTransitionPlan?.operations?.some((operation) => (
        operation.id === 'queue_or_observe_rollback'
          && operation.enabled === (
            manifest.clientReviewPacket?.requestState?.controls?.some((control) => control.id === 'queue_rollback' && control.enabled === true)
              || Boolean(manifest.persistence?.command?.replayOf)
          )
      )) === true
        ? 'Client workflow transition plan gates queue or observe operations on request-state controls and replay metadata.'
        : 'Client workflow transition plan queue operation does not match request-state queue controls.',
    },
    {
      code: 'mailchimp.rollback.self_check.persisted_state_exported',
      ok: Boolean(
        manifest.manifest?.persistedState?.protocol === 'aios.rollback-state-envelope.mailchimp.v1'
          && manifest.manifest.persistedState.key
          && manifest.manifest.persistedState.checkpointId,
      ),
      severity: manifest.manifest?.persistedState?.protocol === 'aios.rollback-state-envelope.mailchimp.v1'
        && manifest.manifest.persistedState.key
        && manifest.manifest.persistedState.checkpointId
        ? 'info'
        : 'error',
      message: manifest.manifest?.persistedState?.protocol === 'aios.rollback-state-envelope.mailchimp.v1'
        && manifest.manifest.persistedState.key
        && manifest.manifest.persistedState.checkpointId
        ? 'Rollback manifest exports a restart-safe persisted state envelope.'
        : 'Rollback manifest is missing its persisted state envelope.',
    },
    {
      code: 'mailchimp.rollback.self_check.restart_plan_exported',
      ok: Boolean(
        manifest.manifest?.restartPlan?.protocol === 'aios.rollback-restart-plan.mailchimp.v1'
          && manifest.manifest.restartPlan.mode
          && manifest.manifest.restartPlan.resumeToken,
      ),
      severity: manifest.manifest?.restartPlan?.protocol === 'aios.rollback-restart-plan.mailchimp.v1'
        && manifest.manifest.restartPlan.mode
        && manifest.manifest.restartPlan.resumeToken
        ? 'info'
        : 'error',
      message: manifest.manifest?.restartPlan?.protocol === 'aios.rollback-restart-plan.mailchimp.v1'
        && manifest.manifest.restartPlan.mode
        && manifest.manifest.restartPlan.resumeToken
        ? 'Rollback manifest exports a deterministic restart recovery plan.'
        : 'Rollback manifest is missing its restart recovery plan.',
    },
    {
      code: 'mailchimp.rollback.self_check.operational_health_exported',
      ok: Boolean(
        manifest.operationalHealth?.protocol === 'aios.rollback-operational-health.mailchimp.v1'
          && manifest.manifest?.operationalHealth?.protocol === manifest.operationalHealth.protocol
          && manifest.operationalHealth.healthState
          && manifest.operationalHealth.failureState?.nextAction,
      ),
      severity: manifest.operationalHealth?.protocol === 'aios.rollback-operational-health.mailchimp.v1'
        && manifest.manifest?.operationalHealth?.protocol === manifest.operationalHealth.protocol
        && manifest.operationalHealth.healthState
        && manifest.operationalHealth.failureState?.nextAction
        ? 'info'
        : 'error',
      message: manifest.operationalHealth?.protocol === 'aios.rollback-operational-health.mailchimp.v1'
        && manifest.manifest?.operationalHealth?.protocol === manifest.operationalHealth.protocol
        && manifest.operationalHealth.healthState
        && manifest.operationalHealth.failureState?.nextAction
        ? 'Rollback manifest exports deterministic operational health, failure state, and next action.'
        : 'Rollback manifest is missing its operational health contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.operational_health_retry_policy',
      ok: Boolean(
        manifest.operationalHealth?.retryPolicy
          && Number.isFinite(manifest.operationalHealth.retryPolicy.backoffMs)
          && manifest.operationalHealth.retryPolicy.jitterMs === 0,
      ),
      severity: manifest.operationalHealth?.retryPolicy
        && Number.isFinite(manifest.operationalHealth.retryPolicy.backoffMs)
        && manifest.operationalHealth.retryPolicy.jitterMs === 0
        ? 'info'
        : 'error',
      message: manifest.operationalHealth?.retryPolicy
        && Number.isFinite(manifest.operationalHealth.retryPolicy.backoffMs)
        && manifest.operationalHealth.retryPolicy.jitterMs === 0
        ? 'Rollback operational health exports deterministic retry and backoff policy.'
        : 'Rollback operational health is missing deterministic retry and backoff policy.',
    },
    {
      code: 'mailchimp.rollback.self_check.operational_health_blocks_queue',
      ok: manifest.operationalHealth?.canQueue === true || manifest.clientRuntime?.adopted !== true || manifest.canRollback !== true,
      severity: manifest.operationalHealth?.canQueue === true || manifest.clientRuntime?.adopted !== true || manifest.canRollback !== true ? 'info' : 'error',
      message: manifest.operationalHealth?.canQueue === true || manifest.clientRuntime?.adopted !== true || manifest.canRollback !== true
        ? 'Operational health gates rollback queueing before client adoption.'
        : 'Client runtime can adopt a rollback while operational health is not queue-ready.',
    },
    {
      code: 'mailchimp.rollback.self_check.adapter_recovery_directive_exported',
      ok: Boolean(
        manifest.adapterRecoveryDirective?.protocol === 'aios.rollback-adapter-recovery-directive.mailchimp.v1'
          && manifest.manifest?.adapterRecoveryDirective?.protocol === manifest.adapterRecoveryDirective.protocol
          && manifest.adapterRecoveryDirective.recoveryCommand?.commandId
          && manifest.adapterRecoveryDirective.statusPatch?.latestCode
          && Array.isArray(manifest.adapterRecoveryDirective.capabilityClaims)
          && Array.isArray(manifest.adapterRecoveryDirective.verifierClaims),
      ),
      severity: manifest.adapterRecoveryDirective?.protocol === 'aios.rollback-adapter-recovery-directive.mailchimp.v1'
        && manifest.manifest?.adapterRecoveryDirective?.protocol === manifest.adapterRecoveryDirective.protocol
        && manifest.adapterRecoveryDirective.recoveryCommand?.commandId
        && manifest.adapterRecoveryDirective.statusPatch?.latestCode
        && Array.isArray(manifest.adapterRecoveryDirective.capabilityClaims)
        && Array.isArray(manifest.adapterRecoveryDirective.verifierClaims)
        ? 'info'
        : 'error',
      message: manifest.adapterRecoveryDirective?.protocol === 'aios.rollback-adapter-recovery-directive.mailchimp.v1'
        && manifest.manifest?.adapterRecoveryDirective?.protocol === manifest.adapterRecoveryDirective.protocol
        && manifest.adapterRecoveryDirective.recoveryCommand?.commandId
        && manifest.adapterRecoveryDirective.statusPatch?.latestCode
        && Array.isArray(manifest.adapterRecoveryDirective.capabilityClaims)
        && Array.isArray(manifest.adapterRecoveryDirective.verifierClaims)
        ? 'Rollback manifest exports deterministic adapter recovery directive, status patch, and verifier claims.'
        : 'Rollback manifest is missing its deterministic adapter recovery directive contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.adapter_recovery_status_binding',
      ok: Boolean(
        manifest.adapterRecoveryDirective?.statusPatch?.externalHandoff?.requestId === (
          manifest.recovery?.providerRequestId
            || manifest.providerContract?.externalHandoff?.requestId
            || manifest.status?.externalHandoff?.requestId
            || ''
        )
          && manifest.adapterRecoveryDirective?.recoveryCommand?.requestId === manifest.persistence?.command?.requestId
          && manifest.adapterRecoveryDirective?.recoveryCommand?.idempotencyKey === manifest.persistence?.command?.idempotencyKey,
      ),
      severity: manifest.adapterRecoveryDirective?.statusPatch?.externalHandoff?.requestId === (
        manifest.recovery?.providerRequestId
          || manifest.providerContract?.externalHandoff?.requestId
          || manifest.status?.externalHandoff?.requestId
          || ''
      )
        && manifest.adapterRecoveryDirective?.recoveryCommand?.requestId === manifest.persistence?.command?.requestId
        && manifest.adapterRecoveryDirective?.recoveryCommand?.idempotencyKey === manifest.persistence?.command?.idempotencyKey
        ? 'info'
        : 'error',
      message: manifest.adapterRecoveryDirective?.statusPatch?.externalHandoff?.requestId === (
        manifest.recovery?.providerRequestId
          || manifest.providerContract?.externalHandoff?.requestId
          || manifest.status?.externalHandoff?.requestId
          || ''
      )
        && manifest.adapterRecoveryDirective?.recoveryCommand?.requestId === manifest.persistence?.command?.requestId
        && manifest.adapterRecoveryDirective?.recoveryCommand?.idempotencyKey === manifest.persistence?.command?.idempotencyKey
        ? 'Adapter recovery directive binds status handoff, rollback request, and idempotency key deterministically.'
        : 'Adapter recovery directive status or command binding is inconsistent with rollback persistence.',
    },
    {
      code: 'mailchimp.rollback.self_check.adapter_recovery_write_mode_gate',
      ok: manifest.adapterRecoveryDirective?.writeMode === (
        manifest.operationalHealth?.canQueue === true && manifest.canRollback === true
          ? 'external_write'
          : manifest.adapterRecoveryDirective?.retryable === true
            ? 'refresh_only'
            : 'local_read_only'
      ),
      severity: manifest.adapterRecoveryDirective?.writeMode === (
        manifest.operationalHealth?.canQueue === true && manifest.canRollback === true
          ? 'external_write'
          : manifest.adapterRecoveryDirective?.retryable === true
            ? 'refresh_only'
            : 'local_read_only'
      ) ? 'info' : 'error',
      message: manifest.adapterRecoveryDirective?.writeMode === (
        manifest.operationalHealth?.canQueue === true && manifest.canRollback === true
          ? 'external_write'
          : manifest.adapterRecoveryDirective?.retryable === true
            ? 'refresh_only'
            : 'local_read_only'
      )
        ? 'Adapter recovery directive write mode is gated by rollback and operational-health readiness.'
        : 'Adapter recovery directive write mode does not match rollback queue gates.',
    },
    {
      code: 'mailchimp.rollback.self_check.analytics_report_exported',
      ok: Boolean(
        manifest.analyticsReport?.protocol === 'aios.rollback-analytics-report.mailchimp.v1'
          && manifest.manifest?.analyticsReport?.protocol === manifest.analyticsReport.protocol
          && Number.isFinite(manifest.analyticsReport.counters?.snapshots)
          && Number.isFinite(manifest.analyticsReport.counters?.timelineEvents),
      ),
      severity: manifest.analyticsReport?.protocol === 'aios.rollback-analytics-report.mailchimp.v1'
        && manifest.manifest?.analyticsReport?.protocol === manifest.analyticsReport.protocol
        && Number.isFinite(manifest.analyticsReport.counters?.snapshots)
        && Number.isFinite(manifest.analyticsReport.counters?.timelineEvents)
        ? 'info'
        : 'error',
      message: manifest.analyticsReport?.protocol === 'aios.rollback-analytics-report.mailchimp.v1'
        && manifest.manifest?.analyticsReport?.protocol === manifest.analyticsReport.protocol
        && Number.isFinite(manifest.analyticsReport.counters?.snapshots)
        && Number.isFinite(manifest.analyticsReport.counters?.timelineEvents)
        ? 'Rollback manifest exports deterministic analytics counters and report state.'
        : 'Rollback manifest is missing its analytics report contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.analytics_history_snapshots',
      ok: Boolean(
        manifest.analyticsReport?.history?.snapshotCount > 0
          && manifest.analyticsReport.history.snapshots?.length === manifest.analyticsReport.history.snapshotCount
          && manifest.manifest?.analyticsReport?.history?.snapshotCount === manifest.analyticsReport.history.snapshotCount,
      ),
      severity: manifest.analyticsReport?.history?.snapshotCount > 0
        && manifest.analyticsReport.history.snapshots?.length === manifest.analyticsReport.history.snapshotCount
        && manifest.manifest?.analyticsReport?.history?.snapshotCount === manifest.analyticsReport.history.snapshotCount
        ? 'info'
        : 'error',
      message: manifest.analyticsReport?.history?.snapshotCount > 0
        && manifest.analyticsReport.history.snapshots?.length === manifest.analyticsReport.history.snapshotCount
        && manifest.manifest?.analyticsReport?.history?.snapshotCount === manifest.analyticsReport.history.snapshotCount
        ? 'Rollback analytics report exports deterministic history snapshots.'
        : 'Rollback analytics report is missing deterministic history snapshots.',
    },
    {
      code: 'mailchimp.rollback.self_check.analytics_timeline_export',
      ok: Boolean(
        manifest.analyticsReport?.timeline?.events?.length === manifest.analyticsReport?.counters?.timelineEvents
          && manifest.analyticsReport?.exports?.summary?.protocol === 'aios.rollback-export-summary.mailchimp.v1'
          && manifest.analyticsReport.exports.summary.nextAction,
      ),
      severity: manifest.analyticsReport?.timeline?.events?.length === manifest.analyticsReport?.counters?.timelineEvents
        && manifest.analyticsReport?.exports?.summary?.protocol === 'aios.rollback-export-summary.mailchimp.v1'
        && manifest.analyticsReport.exports.summary.nextAction
        ? 'info'
        : 'error',
      message: manifest.analyticsReport?.timeline?.events?.length === manifest.analyticsReport?.counters?.timelineEvents
        && manifest.analyticsReport?.exports?.summary?.protocol === 'aios.rollback-export-summary.mailchimp.v1'
        && manifest.analyticsReport.exports.summary.nextAction
        ? 'Rollback analytics report exports timeline and export-ready summary state.'
        : 'Rollback analytics report is missing timeline or export summary state.',
    },
    {
      code: 'mailchimp.rollback.self_check.tenant_boundary_exported',
      ok: Boolean(
        manifest.permissionBoundary?.protocol === 'aios.rollback-tenant-permission-boundary.mailchimp.v1'
          && manifest.manifest?.tenantPermissionBoundary?.protocol === manifest.permissionBoundary.protocol,
      ),
      severity: manifest.permissionBoundary?.protocol === 'aios.rollback-tenant-permission-boundary.mailchimp.v1'
        && manifest.manifest?.tenantPermissionBoundary?.protocol === manifest.permissionBoundary.protocol
        ? 'info'
        : 'error',
      message: manifest.permissionBoundary?.protocol === 'aios.rollback-tenant-permission-boundary.mailchimp.v1'
        && manifest.manifest?.tenantPermissionBoundary?.protocol === manifest.permissionBoundary.protocol
        ? 'Rollback manifest exports the deterministic tenant permission boundary.'
        : 'Rollback manifest is missing its tenant permission boundary contract.',
    },
    {
      code: 'mailchimp.rollback.self_check.tenant_boundary_audit',
      ok: manifest.permissionBoundary?.allowed !== true || Boolean(manifest.manifest?.tenantPermissionBoundary?.audit?.auditRef),
      severity: manifest.permissionBoundary?.allowed !== true || manifest.manifest?.tenantPermissionBoundary?.audit?.auditRef ? 'info' : 'error',
      message: manifest.permissionBoundary?.allowed !== true || manifest.manifest?.tenantPermissionBoundary?.audit?.auditRef
        ? 'Tenant permission boundary audit state is deterministic for this rollback.'
        : 'Allowed rollback is missing a tenant permission audit reference.',
    },
    {
      code: 'mailchimp.rollback.self_check.tenant_boundary_gates_queue',
      ok: manifest.permissionBoundary?.allowed === true || manifest.canRollback === false,
      severity: manifest.permissionBoundary?.allowed === true || manifest.canRollback === false ? 'info' : 'error',
      message: manifest.permissionBoundary?.allowed === true || manifest.canRollback === false
        ? 'Tenant permission boundary is enforced before rollback queueing.'
        : 'Rollback can queue despite a blocked tenant permission boundary.',
    },
  ];
  const blocking = validation.filter((item) => item.severity === 'error');
  const warnings = validation.filter((item) => item.severity === 'warning');

  return {
    protocol: 'aios.rollback-handoff.self-check.mailchimp.v1',
    requestId: manifest.requestId,
    rollbackRequestId: manifest.manifest?.requestId || '',
    ok: blocking.length === 0,
    canQueue: manifest.canRollback === true
      && manifest.acceptance?.ready === true
      && manifest.recovery?.ready === true
      && manifest.operationalHealth?.canQueue === true
      && manifest.permissionBoundary?.allowed === true
      && manifest.lifecycleControls?.canProceed === true
      && manifest.clientRuntime?.adopted === true,
    nextAction: blocking.length > 0
      ? 'resolve_blocking_validation'
      : warnings.length > 0
        ? 'review_rollback_warnings'
        : manifest.operationalHealth?.nextAction || manifest.clientRuntime?.nextAction || manifest.ui?.nextStep || 'queue_rollback_manifest',
    counts: {
      validation: validation.length,
      blocking: blocking.length,
      warnings: warnings.length,
      providerContractBlockers: manifest.providerContract?.blockers?.length || 0,
      providerContractWarnings: manifest.providerContract?.warnings?.length || 0,
      recoveryBlockers: manifest.recovery?.blockers?.length || 0,
      tenantPermissionBlockers: manifest.permissionBoundary?.blockers?.length || 0,
      operationalHealthBlockers: manifest.operationalHealth?.blockers?.length || 0,
      componentReadinessPackets: manifest.componentReadiness?.counts?.packets || 0,
      componentReadinessBlocked: manifest.componentReadiness?.counts?.blocked || 0,
      componentReadinessWaiting: manifest.componentReadiness?.counts?.waiting || 0,
      adapterRecoveryBlockers: manifest.adapterRecoveryDirective?.blockers?.length || 0,
      adapterRecoveryCapabilityClaims: manifest.adapterRecoveryDirective?.capabilityClaims?.length || 0,
      adapterRecoveryVerifierClaims: manifest.adapterRecoveryDirective?.verifierClaims?.length || 0,
      lifecycleBlockers: manifest.lifecycleControls?.blockers?.length || 0,
      lifecycleWarnings: manifest.lifecycleControls?.warnings?.length || 0,
      actionableErrors: manifest.operationalHealth?.actionableErrors?.length || 0,
      analyticsSnapshots: manifest.analyticsReport?.counters?.snapshots || 0,
      analyticsTimelineEvents: manifest.analyticsReport?.counters?.timelineEvents || 0,
      analyticsExportBlockers: manifest.analyticsReport?.exports?.summary?.blockers?.length || 0,
      clientReviewValidation: manifest.clientReviewPacket?.validationSummary?.total || 0,
      clientReviewActionable: manifest.clientReviewPacket?.validationSummary?.actionable?.length || 0,
      clientReviewChecklist: manifest.clientReviewPacket?.checklist?.length || 0,
      clientRequestControls: manifest.clientReviewPacket?.requestState?.controls?.length || 0,
      clientRequestDisabledControls: manifest.clientReviewPacket?.requestState?.disabledControls?.length || 0,
      clientWorkflowOperations: manifest.clientReviewPacket?.workflowTransitionPlan?.operations?.length || 0,
      clientWorkflowEnabledOperations: manifest.clientReviewPacket?.workflowTransitionPlan?.enabledOperations?.length || 0,
    },
    validation,
  };
}

export function describeMailchimpRollbackOutcome(manifest, result = {}) {
  const rollback = manifest?.protocol === 'aios.rollback-handoff.mailchimp.v1'
    ? manifest
    : buildMailchimpRollbackManifest(manifest);
  const state = compactString(result.state || (rollback.canRollback ? 'queued' : 'blocked'));
  const persistence = rollback.persistence || {};
  const replayed = Boolean(persistence.command?.replayOf);
  return {
    protocol: 'aios.rollback-outcome.mailchimp.v1',
    requestId: rollback.requestId,
    rollbackRequestId: rollback.manifest?.requestId,
    state,
    completed: state === 'rolled_back',
    blocked: state === 'blocked' || (rollback.canRollback === false && !replayed),
    replayed,
    persistence: {
      commandId: persistence.command?.commandId || '',
      commandState: compactString(result.commandState || persistence.command?.state || state),
      idempotencyKey: persistence.command?.idempotencyKey || '',
      duplicateDetected: persistence.restartSafety?.duplicateDetected === true,
      replaySafe: persistence.restartSafety?.replaySafe === true,
    },
    recovery: rollback.recovery || rollback.manifest?.recoveryHandoff || {},
    tenantPermissionBoundary: rollback.permissionBoundary
      || rollback.manifest?.tenantPermissionBoundary
      || rollback.ui?.tenantPermissionBoundary
      || {},
    lifecycleControls: rollback.lifecycleControls
      || rollback.manifest?.lifecycleControls
      || rollback.ui?.lifecycleControls
      || {},
    persistedState: rollback.stateEnvelope || rollback.manifest?.persistedState || rollback.ui?.persistedState || {},
    restartPlan: rollback.restartPlan || rollback.manifest?.restartPlan || rollback.ui?.restart || {},
    operationalHealth: rollback.operationalHealth || rollback.manifest?.operationalHealth || rollback.ui?.operationalHealth || {},
    componentReadiness: rollback.componentReadiness || rollback.manifest?.componentReadiness || rollback.ui?.componentReadiness || {},
    adapterRecoveryDirective: rollback.adapterRecoveryDirective
      || rollback.manifest?.adapterRecoveryDirective
      || rollback.ui?.adapterRecoveryDirective
      || {},
    analyticsReport: rollback.analyticsReport || rollback.manifest?.analyticsReport || rollback.ui?.analyticsReport || {},
    workflowHandoff: rollback.clientRuntime?.workflowHandoff || rollback.ui?.workflowHandoff || rollback.manifest?.clientWorkflowHandoff || {},
    clientReviewPacket: rollback.clientReviewPacket || rollback.ui?.reviewPacket || rollback.manifest?.clientReviewPacket || {},
    clientRequestState: rollback.clientReviewPacket?.requestState
      || rollback.ui?.requestState
      || rollback.manifest?.clientRequestState
      || {},
    clientWorkflowTransitionPlan: rollback.clientReviewPacket?.workflowTransitionPlan
      || rollback.ui?.workflowTransitionPlan
      || rollback.manifest?.clientWorkflowTransitionPlan
      || {},
    diagnostics: [
      ...(rollback.diagnostics || []),
      ...(Array.isArray(result.diagnostics) ? result.diagnostics : []),
    ],
    truthBoundary: rollback.truthBoundary,
    acceptance: rollback.acceptance || rollback.ui?.acceptance,
    nextStep: state === 'rolled_back'
      ? 'archive_rollback_audit'
      : replayed
        ? 'observe_existing_rollback_command'
        : rollback.analyticsReport?.exportReady === false && rollback.analyticsReport?.reportState?.nextAction
        ? rollback.analyticsReport.reportState.nextAction
        : rollback.lifecycleControls?.nextAction && rollback.lifecycleControls?.canProceed !== true
          ? rollback.lifecycleControls.nextAction
        : rollback.operationalHealth?.nextAction && rollback.operationalHealth?.healthy !== true
          ? rollback.operationalHealth.nextAction
        : rollback.restartPlan?.nextAction && rollback.restartPlan?.canResume === true
          ? rollback.restartPlan.nextAction
        : rollback.recovery?.nextAction && rollback.recovery?.ready === false
          ? rollback.recovery.nextAction
      : rollback.ui?.nextStep || 'inspect_rollback_outcome',
  };
}

export { REVERSIBLE_ACTIONS };
