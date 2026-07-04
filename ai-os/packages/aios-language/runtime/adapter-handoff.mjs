const DEFAULT_ALLOWED_MAILCHIMP_ACTIONS = Object.freeze([
  'audience.sync',
  'campaign.draft',
  'campaign.schedule',
  'campaign.pause',
  'campaign.resume',
  'journey.trigger',
  'segment.refresh',
  'tag.apply',
  'tag.remove',
]);

const MAILCHIMP_MUTATING_ACTIONS = new Set([
  'audience.sync',
  'campaign.schedule',
  'campaign.pause',
  'campaign.resume',
  'journey.trigger',
  'tag.apply',
  'tag.remove',
]);

const REQUIRED_FIELDS = Object.freeze(['adapter', 'action', 'tenant', 'truth']);
const HISTORY_TERMINAL_STATES = new Set(['succeeded', 'failed', 'rolled_back', 'cancelled']);
const LIFECYCLE_COMMANDS = new Set(['queue', 'hold', 'dispatch', 'pause', 'resume', 'cancel']);
const LIFECYCLE_MODES = new Set(['manual', 'automatic', 'scheduled']);
const LIFECYCLE_DISABLED_COMMANDS = new Set(['dispatch', 'resume']);
const PROVIDER_HANDOFF_MODES = new Set(['local_only', 'linked', 'claim', 'release']);
const PROVIDER_SERVICE_STATES = new Set(['unknown', 'online', 'degraded', 'offline']);
const PROVIDER_RECEIPT_STATES = new Set(['missing', 'pending', 'acknowledged', 'failed', 'rejected']);
const TENANT_PERMISSION_ACTIONS = new Map([
  ['audience.sync', ['mailchimp.audience.read', 'mailchimp.audience.write']],
  ['campaign.draft', ['mailchimp.campaign.write']],
  ['campaign.schedule', ['mailchimp.campaign.write', 'mailchimp.campaign.schedule']],
  ['campaign.pause', ['mailchimp.campaign.write', 'mailchimp.campaign.pause']],
  ['campaign.resume', ['mailchimp.campaign.write', 'mailchimp.campaign.resume']],
  ['journey.trigger', ['mailchimp.journey.trigger']],
  ['segment.refresh', ['mailchimp.segment.read', 'mailchimp.segment.write']],
  ['tag.apply', ['mailchimp.tag.write']],
  ['tag.remove', ['mailchimp.tag.write']],
]);

function asObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).sort().reduce((next, key) => {
    const normalizedKey = compactString(key);
    if (!normalizedKey) return next;
    const raw = value[key];
    if (raw == null) return next;
    next[normalizedKey] = typeof raw === 'object' && !Array.isArray(raw) ? stableObject(raw) : raw;
    return next;
  }, {});
}

function stableContractValue(value) {
  if (Array.isArray(value)) return value.map(stableContractValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((next, key) => {
    const normalizedKey = compactString(key);
    if (!normalizedKey || value[key] === undefined) return next;
    next[normalizedKey] = stableContractValue(value[key]);
    return next;
  }, {});
}

function stableContractString(value) {
  return JSON.stringify(stableContractValue(value));
}

function stableHash(value) {
  const source = stableContractString(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizeLifecycleCommand(value, fallback = 'queue') {
  const command = compactString(value || fallback).toLowerCase().replaceAll('-', '_');
  return LIFECYCLE_COMMANDS.has(command) ? command : command.replaceAll('_', '-');
}

function normalizeLifecycleSettings(raw = {}) {
  const source = raw.lifecycleSettings && typeof raw.lifecycleSettings === 'object'
    ? raw.lifecycleSettings
    : raw.lifecycle && typeof raw.lifecycle === 'object'
      ? raw.lifecycle
      : raw.settings && typeof raw.settings === 'object'
        ? raw.settings
        : {};
  const controls = source.controls && typeof source.controls === 'object' ? source.controls : {};
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const enabled = source.enabled !== false && controls.enabled !== false;
  const requestedCommand = normalizeLifecycleCommand(
    source.command || source.nextCommand || controls.command || controls.nextCommand,
    enabled ? 'queue' : 'hold',
  );
  const rawMode = compactString(schedule.mode || source.scheduleMode || controls.scheduleMode || 'manual')
    .toLowerCase()
    .replaceAll('-', '_');
  const scheduleMode = LIFECYCLE_MODES.has(rawMode) ? rawMode : 'manual';
  const runAt = compactString(schedule.runAt || schedule.nextRunAt || source.runAt || source.nextRunAt);
  const timezone = compactString(schedule.timezone || source.timezone || 'UTC') || 'UTC';
  const maxDispatches = positiveInteger(
    controls.maxDispatches ?? source.maxDispatches ?? source.dispatchLimit,
    1,
  );
  const retryLimit = positiveInteger(
    controls.retryLimit ?? source.retryLimit ?? source.maxRetries,
    0,
  );
  const cooldownSeconds = positiveInteger(
    controls.cooldownSeconds ?? source.cooldownSeconds ?? source.cooldown,
    0,
  );

  return {
    enabled,
    requestedCommand,
    schedule: {
      mode: scheduleMode,
      runAt,
      timezone,
      cooldownSeconds,
    },
    controls: {
      allowExternalWrite: controls.allowExternalWrite !== false,
      requireVerifierBeforeDispatch: controls.requireVerifierBeforeDispatch !== false,
      maxDispatches,
      retryLimit,
      operatorHold: controls.operatorHold === true || source.operatorHold === true,
    },
  };
}

function normalizeProviderHandoff(raw = {}) {
  const source = raw.providerContract && typeof raw.providerContract === 'object'
    ? raw.providerContract
    : raw.provider && typeof raw.provider === 'object'
      ? raw.provider
      : raw.integration && typeof raw.integration === 'object'
        ? raw.integration
        : {};
  const sync = source.sync && typeof source.sync === 'object' ? source.sync : {};
  const lease = source.lease && typeof source.lease === 'object' ? source.lease : {};
  const rawMode = compactString(source.mode || source.handoffMode || source.externalHandoffState || source.state)
    .toLowerCase()
    .replaceAll('-', '_');
  const rawServiceState = compactString(source.serviceState || source.status || 'unknown')
    .toLowerCase()
    .replaceAll('-', '_');
  const requestedCapabilities = stableList(
    source.requestedCapabilities || source.capabilities || raw.providerCapabilities,
  );
  const advertisedCapabilities = stableList(
    source.advertisedCapabilities || source.availableCapabilities || raw.advertisedCapabilities,
  );

  return {
    provider: compactString(source.provider || raw.providerName || 'mailchimp') || 'mailchimp',
    service: compactString(source.service || raw.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    accountId: compactString(source.accountId || source.account || raw.accountId),
    dataCenter: compactString(source.dataCenter || source.dc || raw.dataCenter),
    serviceState: PROVIDER_SERVICE_STATES.has(rawServiceState) ? rawServiceState : 'unknown',
    mode: PROVIDER_HANDOFF_MODES.has(rawMode) ? rawMode : 'local_only',
    externalRequestId: compactString(
      source.externalRequestId || source.providerRequestId || raw.externalRequestId || raw.providerRequestId,
    ),
    sync: {
      cursor: compactString(sync.cursor || source.syncCursor || raw.syncCursor || raw.cursor),
      lastSyncedAt: compactString(sync.lastSyncedAt || sync.syncedAt || source.lastSyncedAt || raw.lastSyncedAt),
      resource: compactString(sync.resource || source.resource || raw.syncResource || 'mailchimp'),
      batchId: compactString(sync.batchId || source.batchId || raw.syncBatchId),
    },
    lease: {
      owner: compactString(lease.owner || source.leaseOwner || raw.leaseOwner),
      token: compactString(lease.token || source.leaseToken || raw.leaseToken),
      expiresAt: compactString(lease.expiresAt || source.leaseExpiresAt || raw.leaseExpiresAt),
      renewable: lease.renewable !== false && source.leaseRenewable !== false,
    },
    capabilities: {
      requested: requestedCapabilities,
      advertised: advertisedCapabilities,
    },
  };
}

function normalizeProviderReceipt(raw = {}, handoff = {}) {
  const providerContract = raw.providerContract && typeof raw.providerContract === 'object'
    ? raw.providerContract
    : {};
  const source = raw.providerReceipt && typeof raw.providerReceipt === 'object'
    ? raw.providerReceipt
    : raw.receipt && typeof raw.receipt === 'object'
      ? raw.receipt
      : providerContract.receipt && typeof providerContract.receipt === 'object'
        ? providerContract.receipt
        : {};
  const audit = source.audit && typeof source.audit === 'object' ? source.audit : {};
  const rawState = compactString(source.state || source.status || (source.receiptId || source.acknowledgedAt ? 'acknowledged' : 'missing'))
    .toLowerCase()
    .replaceAll('-', '_');
  const state = PROVIDER_RECEIPT_STATES.has(rawState) ? rawState : 'pending';
  const externalRequestId = compactString(
    source.externalRequestId
      || source.providerRequestId
      || raw.externalRequestId
      || raw.providerRequestId
      || providerContract.externalHandoff?.requestId,
  );
  const idempotencyKey = compactString(source.idempotencyKey || source.idempotency || raw.idempotencyKey || handoff.idempotencyKey);
  const tenant = compactString(source.tenant || raw.tenant || handoff.tenant);
  const workspace = compactString(source.workspace || source.workspaceId || raw.workspace || raw.workspaceId);
  const receiptId = compactString(source.receiptId || source.id || source.ackId || source.acknowledgementId);
  const acknowledged = state === 'acknowledged' && Boolean(receiptId || source.acknowledgedAt || source.ackAt);
  const failed = state === 'failed' || state === 'rejected';
  const blockedReasons = stableList([
    ...(failed ? [`provider_receipt_${state}`] : []),
    ...(source.required === true && !acknowledged ? ['provider_receipt_ack_missing'] : []),
    ...(externalRequestId && source.externalRequestId && source.externalRequestId !== externalRequestId
      ? ['provider_receipt_external_request_mismatch']
      : []),
  ]);

  return {
    protocol: 'aios.adapter-provider-receipt.mailchimp.v1',
    provider: compactString(source.provider || providerContract.provider || raw.provider || 'mailchimp') || 'mailchimp',
    service: compactString(source.service || providerContract.service || raw.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    tenant,
    workspace,
    state,
    receiptId,
    externalRequestId,
    idempotencyKey,
    acknowledged,
    acknowledgedAt: compactString(source.acknowledgedAt || source.ackAt || source.receivedAt),
    syncCursor: compactString(source.syncCursor || source.cursor || raw.syncCursor || raw.cursor),
    artifactIds: stableList(source.artifactIds || source.artifacts),
    required: source.required === true,
    restartSafe: acknowledged || state === 'missing' || state === 'pending',
    blockedReasons,
    audit: {
      channel: compactString(audit.channel || source.auditChannel || 'adapter-provider-receipt'),
      decision: blockedReasons.length === 0 ? 'allow' : 'block',
      handoffKey: compactString(audit.handoffKey || `${tenant || 'unknown'}:${workspace || 'all'}:${idempotencyKey || 'no-idempotency'}`),
      externalWriteSuppressed: blockedReasons.length > 0,
    },
  };
}

function normalizeTenantBoundary(raw = {}) {
  const source = raw.boundary && typeof raw.boundary === 'object'
    ? raw.boundary
    : raw.tenantBoundary && typeof raw.tenantBoundary === 'object'
      ? raw.tenantBoundary
      : raw.permissions && typeof raw.permissions === 'object'
        ? raw.permissions
        : {};
  const roles = stableList(source.roles || raw.roles || raw.role);
  const grants = stableList(source.grants || source.permissions || raw.permissionGrants || raw.grants);
  const denied = stableList(source.denied || source.denies || raw.deniedPermissions || raw.denies);
  const workspaces = stableList(source.workspaces || source.workspaceIds || raw.workspaces || raw.workspace);
  const requestedWorkspace = compactString(
    source.workspace
      || source.workspaceId
      || raw.workspace
      || raw.workspaceId
      || raw.metadata?.workspace
      || raw.metadata?.workspaceId,
  );
  const tenant = compactString(source.tenant || source.tenantId || raw.tenant);
  const actor = compactString(source.actor || source.actorId || raw.actor || raw.operator);
  const scope = compactString(source.scope || raw.scope || 'tenant').toLowerCase().replaceAll('-', '_');
  const auditChannel = compactString(source.auditChannel || raw.auditChannel || 'adapter-handoff');
  const requireWorkspaceMatch = source.requireWorkspaceMatch !== false;
  const requireExplicitGrant = source.requireExplicitGrant === true || raw.requireExplicitGrant === true;

  return {
    tenant,
    actor,
    scope: ['tenant', 'workspace', 'global'].includes(scope) ? scope : 'tenant',
    requestedWorkspace,
    allowedWorkspaces: workspaces,
    roles,
    grants,
    denied,
    requireWorkspaceMatch,
    requireExplicitGrant,
    auditChannel,
  };
}

function buildTenantBoundaryContract(boundary, handoff) {
  const requiredGrants = stableList([
    ...TENANT_PERMISSION_ACTIONS.get(handoff.action) || [],
    ...(MAILCHIMP_MUTATING_ACTIONS.has(handoff.action) && !handoff.dryRun ? ['external.write'] : []),
  ]);
  const hasAdminRole = boundary.roles.includes('admin') || boundary.roles.includes('owner');
  const missingGrants = boundary.requireExplicitGrant || boundary.grants.length > 0
    ? requiredGrants.filter((grant) => !boundary.grants.includes(grant) && !hasAdminRole)
    : [];
  const deniedGrants = requiredGrants.filter((grant) => boundary.denied.includes(grant));
  const workspaceAllowed = !boundary.requestedWorkspace
    || boundary.allowedWorkspaces.length === 0
    || boundary.allowedWorkspaces.includes(boundary.requestedWorkspace);
  const tenantMatches = !boundary.tenant || !handoff.tenant || boundary.tenant === handoff.tenant;
  const allowed = tenantMatches
    && deniedGrants.length === 0
    && missingGrants.length === 0
    && (workspaceAllowed || boundary.requireWorkspaceMatch !== true);
  const blockedReasons = stableList([
    ...(tenantMatches ? [] : ['tenant_mismatch']),
    ...(workspaceAllowed ? [] : ['workspace_out_of_scope']),
    ...missingGrants.map((grant) => `missing_grant:${grant}`),
    ...deniedGrants.map((grant) => `denied_grant:${grant}`),
  ]);

  return {
    protocol: 'aios.adapter-tenant-boundary.mailchimp.v1',
    tenant: handoff.tenant,
    actor: boundary.actor,
    scope: boundary.scope,
    workspace: boundary.requestedWorkspace,
    allowedWorkspaces: boundary.allowedWorkspaces,
    roles: boundary.roles,
    requiredGrants,
    grants: boundary.grants,
    denied: boundary.denied,
    allowed,
    requireExplicitGrant: boundary.requireExplicitGrant,
    requireWorkspaceMatch: boundary.requireWorkspaceMatch,
    blockedReasons,
    audit: {
      channel: boundary.auditChannel,
      handoffKey: `${handoff.tenant || 'unknown'}:${boundary.requestedWorkspace || 'all'}:${handoff.action || 'unknown'}`,
      decision: allowed ? 'allow' : 'block',
      externalWriteSuppressed: !allowed && MAILCHIMP_MUTATING_ACTIONS.has(handoff.action),
    },
  };
}

function validateTenantBoundary(boundaryContract) {
  return [
    ...(!boundaryContract.tenant ? [{
      code: 'mailchimp.boundary.missing_tenant',
      severity: 'error',
      field: 'tenant',
      message: 'Tenant boundary requires a tenant before Mailchimp handoff compilation.',
    }] : []),
    ...boundaryContract.blockedReasons.map((reason) => ({
      code: `mailchimp.boundary.${reason.split(':')[0]}`,
      severity: 'error',
      field: reason.startsWith('missing_grant') || reason.startsWith('denied_grant')
        ? 'permissions'
        : 'tenantBoundary',
      message: `Mailchimp tenant boundary blocked handoff: ${reason}.`,
    })),
  ];
}

function buildTenantBoundaryHandoffToken(boundaryContract = {}, handoff = {}, context = {}) {
  const tenant = compactString(boundaryContract.tenant || handoff.tenant);
  const workspace = compactString(boundaryContract.workspace || handoff.workspace || handoff.workspaceId);
  const action = compactString(handoff.action || context.action);
  const requiredGrants = stableList(boundaryContract.requiredGrants);
  const granted = stableList(boundaryContract.grants);
  const denied = stableList(boundaryContract.denied);
  const blockedReasons = stableList(boundaryContract.blockedReasons);
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(action);
  const externalWriteSuppressed = boundaryContract.audit?.externalWriteSuppressed === true
    || (mutating && boundaryContract.allowed !== true);
  const boundaryKey = stableHash({
    tenant,
    workspace,
    action,
    scope: boundaryContract.scope,
    requiredGrants,
    granted,
    denied,
    blockedReasons,
  });

  return {
    protocol: 'aios.adapter-tenant-boundary-handoff.mailchimp.v1',
    boundaryKey: `mailchimp-boundary:${boundaryKey}`,
    tenant,
    workspace,
    action,
    scope: compactString(boundaryContract.scope || 'tenant'),
    actor: compactString(boundaryContract.actor || context.actor),
    allowed: boundaryContract.allowed === true,
    readyForRuntime: boundaryContract.allowed === true && blockedReasons.length === 0,
    externalWriteSuppressed,
    requiresAuditAppend: mutating || denied.length > 0 || blockedReasons.length > 0,
    auditAppendReady: boundaryContract.audit?.decision === 'allow'
      && compactString(boundaryContract.audit?.handoffKey).length > 0,
    requiredGrants,
    granted,
    denied,
    roles: stableList(boundaryContract.roles),
    allowedWorkspaces: stableList(boundaryContract.allowedWorkspaces),
    blockedReasons,
    driftChecks: {
      requireTenantMatch: Boolean(tenant),
      requireWorkspaceMatch: boundaryContract.requireWorkspaceMatch === true,
      requireExplicitGrant: boundaryContract.requireExplicitGrant === true,
    },
    audit: {
      channel: compactString(boundaryContract.audit?.channel || 'adapter-handoff'),
      handoffKey: compactString(
        boundaryContract.audit?.handoffKey
          || `${tenant || 'unknown'}:${workspace || 'all'}:${action || 'unknown'}`,
      ),
      decision: compactString(boundaryContract.audit?.decision || (boundaryContract.allowed ? 'allow' : 'block')),
      externalWriteSuppressed,
    },
    route: {
      target: 'runtime-boundary-gate',
      idempotencyKey: `mailchimp-boundary:${boundaryKey}`,
      nextAction: boundaryContract.allowed === true ? 'append_tenant_boundary_audit' : 'repair_tenant_permissions',
    },
  };
}

function buildTenantPermissionDecisionBundle(boundaryContract = {}, boundaryHandoff = {}, handoff = {}, providerContract = {}, lifecycle = {}) {
  const action = compactString(handoff.action || boundaryHandoff.action);
  const tenant = compactString(boundaryContract.tenant || boundaryHandoff.tenant || handoff.tenant);
  const workspace = compactString(boundaryContract.workspace || boundaryHandoff.workspace || handoff.workspace || handoff.workspaceId);
  const requiredGrants = stableList(boundaryContract.requiredGrants || boundaryHandoff.requiredGrants);
  const granted = stableList(boundaryContract.grants || boundaryHandoff.granted);
  const denied = stableList(boundaryContract.denied || boundaryHandoff.denied);
  const roles = stableList(boundaryContract.roles || boundaryHandoff.roles);
  const allowedWorkspaces = stableList(boundaryContract.allowedWorkspaces || boundaryHandoff.allowedWorkspaces);
  const grantDecisions = requiredGrants.map((grant) => {
    const deniedByBoundary = denied.includes(grant);
    const grantedByBoundary = granted.includes(grant)
      || roles.includes('admin')
      || roles.includes('owner')
      || boundaryContract.requireExplicitGrant !== true && granted.length === 0;
    const allowed = grantedByBoundary && !deniedByBoundary;
    return {
      grant,
      allowed,
      source: deniedByBoundary
        ? 'explicit-deny'
        : granted.includes(grant)
          ? 'explicit-grant'
          : roles.includes('admin') || roles.includes('owner')
            ? 'role-override'
            : boundaryContract.requireExplicitGrant === true
              ? 'missing-explicit-grant'
              : 'implicit-tenant-boundary',
      decision: allowed ? 'allow' : 'block',
      nextAction: allowed ? 'observe' : 'repair_tenant_permissions',
    };
  });
  const missingGrants = grantDecisions
    .filter((decision) => decision.allowed !== true && decision.source !== 'explicit-deny')
    .map((decision) => decision.grant);
  const deniedGrants = grantDecisions
    .filter((decision) => decision.source === 'explicit-deny')
    .map((decision) => decision.grant);
  const expectedWorkspace = compactString(boundaryContract.workspace);
  const workspaceMatches = !expectedWorkspace || !workspace || expectedWorkspace === workspace;
  const workspaceAllowed = !workspace
    || allowedWorkspaces.length === 0
    || allowedWorkspaces.includes(workspace);
  const tenantAllowed = !boundaryContract.tenant || !handoff.tenant || boundaryContract.tenant === handoff.tenant;
  const boundaryBlockedReasons = stableList([
    ...stableList(boundaryContract.blockedReasons),
    ...stableList(boundaryHandoff.blockedReasons),
    ...(tenantAllowed ? [] : ['tenant_mismatch']),
    ...(workspaceMatches ? [] : ['workspace_mismatch']),
    ...(workspaceAllowed ? [] : ['workspace_out_of_scope']),
    ...missingGrants.map((grant) => `missing_grant:${grant}`),
    ...deniedGrants.map((grant) => `denied_grant:${grant}`),
  ]);
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(action);
  const providerLinked = providerContract.externalHandoff?.localOnly === false
    || providerContract.externalHandoff?.state === 'linked'
    || Boolean(providerContract.externalHandoff?.requestId);
  const auditRequired = boundaryHandoff.requiresAuditAppend === true
    || mutating
    || providerLinked
    || boundaryBlockedReasons.length > 0;
  const auditReady = boundaryHandoff.auditAppendReady === true
    || (boundaryHandoff.audit?.decision === 'allow' && compactString(boundaryHandoff.audit?.handoffKey).length > 0);
  const externalWriteSuppressed = boundaryHandoff.audit?.externalWriteSuppressed === true
    || boundaryContract.audit?.externalWriteSuppressed === true
    || (mutating && (boundaryBlockedReasons.length > 0 || lifecycle.controls?.allowExternalWrite === false));
  const ready = boundaryContract.allowed === true
    && boundaryHandoff.readyForRuntime !== false
    && boundaryBlockedReasons.length === 0
    && (!auditRequired || auditReady);
  const status = ready
    ? 'ready'
    : boundaryBlockedReasons.length > 0 || boundaryContract.allowed === false
      ? 'blocked'
      : auditRequired && !auditReady
        ? 'audit_append_required'
        : 'needs_review';
  const nextAction = ready
    ? lifecycle.nextAction || 'dispatch-mailchimp-handoff'
    : status === 'audit_append_required'
      ? 'append_tenant_boundary_audit'
      : boundaryHandoff.nextAction || boundaryHandoff.route?.nextAction || 'repair_tenant_permissions';
  const decisionKey = `mailchimp-permission-boundary:${stableHash({
    tenant,
    workspace,
    action,
    requiredGrants,
    granted,
    denied,
    roles,
    status,
    auditRequired,
    auditReady,
  })}`;

  return {
    protocol: 'aios.adapter-tenant-permission-decision-bundle.mailchimp.v1',
    decisionKey,
    tenant,
    workspace,
    action,
    status,
    ready,
    allowedForRuntime: ready && externalWriteSuppressed !== true,
    externalWriteSuppressed,
    nextAction,
    requiredGrants,
    granted,
    denied,
    roles,
    workspaceDecision: {
      workspace,
      expectedWorkspace,
      allowed: workspaceAllowed,
      matchesCompiledBoundary: workspaceMatches,
      allowedWorkspaces,
      requireWorkspaceMatch: boundaryContract.requireWorkspaceMatch === true,
      nextAction: workspaceAllowed ? 'observe' : 'switch_workspace_or_recompile',
    },
    tenantDecision: {
      expectedTenant: compactString(boundaryContract.tenant),
      actualTenant: compactString(handoff.tenant),
      allowed: tenantAllowed,
      nextAction: tenantAllowed ? 'observe' : 'repair_tenant_permissions',
    },
    grantDecisions,
    blockedReasons: boundaryBlockedReasons,
    audit: {
      channel: compactString(boundaryHandoff.audit?.channel || boundaryContract.audit?.channel || 'adapter-permission-decision'),
      required: auditRequired,
      ready: auditReady,
      decision: ready ? 'allow' : 'block',
      handoffKey: compactString(
        boundaryHandoff.audit?.handoffKey
          || boundaryContract.audit?.handoffKey
          || `${tenant || 'unknown'}:${workspace || 'all'}:${action || 'unknown'}`,
      ),
      command: auditRequired && !auditReady ? 'append_tenant_boundary_audit' : 'observe',
    },
    route: {
      target: 'runtime-permission-boundary',
      idempotencyKey: decisionKey,
      primaryAction: nextAction,
      requiredBodyKeys: auditRequired && !auditReady ? ['auditDecision', 'handoffKey'] : ['requestId'],
    },
    clientPatch: {
      tenantPermissionDecisionStatus: status,
      tenantPermissionDecisionReady: ready,
      tenantPermissionDecisionKey: decisionKey,
      tenantPermissionDecisionNextAction: nextAction,
      tenantPermissionBlockedReasons: boundaryBlockedReasons,
      tenantPermissionAuditRequired: auditRequired,
      tenantPermissionAuditReady: auditReady,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: 'dedupe-by-tenant-permission-decision-key',
      resumeFromPermissionDecisionKey: decisionKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpTenantBoundaryContinuityContract(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const decision = descriptor.tenantPermissionDecisionBundle || {};
  const boundaryHandoff = descriptor.boundaryHandoff || {};
  const auditEnvelope = descriptor.tenantBoundaryAuditEnvelope || {};
  const permissionHealth = descriptor.permissionHealth || runtime.permissionHealth || {};
  const runtimeBoundary = runtime.tenantBoundary && typeof runtime.tenantBoundary === 'object'
    ? runtime.tenantBoundary
    : runtime.boundary && typeof runtime.boundary === 'object'
      ? runtime.boundary
      : runtime.permissionBoundary && typeof runtime.permissionBoundary === 'object'
        ? runtime.permissionBoundary
        : {};
  const runtimeTenant = compactString(runtime.tenant || runtime.tenantId || runtimeBoundary.tenant || runtimeBoundary.tenantId);
  const runtimeWorkspace = compactString(runtime.workspace || runtime.workspaceId || runtimeBoundary.workspace || runtimeBoundary.workspaceId);
  const tenant = compactString(decision.tenant || boundaryHandoff.tenant || descriptor.tenant);
  const workspace = compactString(
    decision.workspace
      || boundaryHandoff.workspace
      || descriptor.boundaryContract?.workspace
      || descriptor.workspace
      || descriptor.workspaceId,
  );
  const action = compactString(decision.action || boundaryHandoff.action || descriptor.action);
  const auditRequired = decision.audit?.required === true
    || boundaryHandoff.requiresAuditAppend === true
    || auditEnvelope.auditRequired === true
    || boundaryHandoff.externalWriteSuppressed === true
    || decision.externalWriteSuppressed === true
    || MAILCHIMP_MUTATING_ACTIONS.has(action);
  const auditReady = auditRequired !== true
    || decision.audit?.ready === true
    || boundaryHandoff.auditAppendReady === true
    || auditEnvelope.auditReady === true
    || auditEnvelope.appended === true;
  const tenantMatches = !runtimeTenant || !tenant || runtimeTenant === tenant;
  const workspaceMatches = !runtimeWorkspace || !workspace || runtimeWorkspace === workspace;
  const blockedReasons = stableList([
    ...stableList(decision.blockedReasons).map((reason) => `decision:${reason}`),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `handoff:${reason}`),
    ...stableList(auditEnvelope.blockedReasons).map((reason) => `audit:${reason}`),
    ...(permissionHealth.allowed === false ? ['permission_health_blocked'] : []),
    ...(decision.ready === false ? ['tenant_permission_decision_not_ready'] : []),
    ...(boundaryHandoff.readyForRuntime === false ? ['tenant_boundary_handoff_not_ready'] : []),
    ...(auditRequired && !auditReady ? ['tenant_boundary_audit_not_ready'] : []),
    ...(tenantMatches ? [] : ['runtime_tenant_mismatch']),
    ...(workspaceMatches ? [] : ['runtime_workspace_mismatch']),
  ]);
  const ready = blockedReasons.length === 0;
  const state = ready
    ? 'ready'
    : blockedReasons.includes('tenant_boundary_audit_not_ready')
      ? 'waiting_for_audit'
      : blockedReasons.includes('runtime_workspace_mismatch')
        ? 'workspace_drift'
        : blockedReasons.includes('runtime_tenant_mismatch')
          ? 'tenant_drift'
          : 'blocked';
  const nextAction = ready
    ? descriptor.lifecycle?.nextAction || 'observe'
    : state === 'waiting_for_audit'
      ? auditEnvelope.nextAction || boundaryHandoff.route?.nextAction || 'append_tenant_boundary_audit'
      : state === 'workspace_drift'
        ? 'switch_workspace_or_recompile'
        : decision.nextAction || boundaryHandoff.route?.nextAction || permissionHealth.nextAction || 'repair_tenant_permissions';
  const continuityKey = `mailchimp-boundary-continuity:${stableHash({
    tenant,
    workspace,
    action,
    runtimeTenant,
    runtimeWorkspace,
    decisionKey: decision.decisionKey,
    boundaryKey: boundaryHandoff.boundaryKey,
    auditKey: auditEnvelope.envelopeKey || auditEnvelope.audit?.handoffKey,
    state,
    blockedReasons,
  })}`;

  return {
    protocol: 'aios.adapter-tenant-boundary-continuity.mailchimp.v1',
    continuityKey,
    requestId: compactString(descriptor.requestId),
    tenant,
    workspace,
    action,
    state,
    ready,
    restartSafe: ready || state === 'waiting_for_audit',
    replaySafe: ready,
    nextAction,
    blockedReasons,
    scope: {
      tenant,
      runtimeTenant,
      tenantMatches,
      workspace,
      runtimeWorkspace,
      workspaceMatches,
      requireWorkspaceMatch: descriptor.boundaryContract?.requireWorkspaceMatch === true
        || boundaryHandoff.driftChecks?.requireWorkspaceMatch === true,
    },
    decision: {
      decisionKey: compactString(decision.decisionKey),
      status: compactString(decision.status || 'unknown'),
      ready: decision.ready === true,
      allowedForRuntime: decision.allowedForRuntime === true,
      externalWriteSuppressed: decision.externalWriteSuppressed === true,
      blockedReasons: stableList(decision.blockedReasons),
    },
    handoff: {
      boundaryKey: compactString(boundaryHandoff.boundaryKey),
      readyForRuntime: boundaryHandoff.readyForRuntime === true,
      allowed: boundaryHandoff.allowed === true,
      blockedReasons: stableList(boundaryHandoff.blockedReasons),
      route: boundaryHandoff.route || null,
    },
    audit: {
      required: auditRequired,
      ready: auditReady,
      envelopeKey: compactString(auditEnvelope.envelopeKey),
      handoffKey: compactString(
        auditEnvelope.audit?.handoffKey
          || decision.audit?.handoffKey
          || boundaryHandoff.audit?.handoffKey,
      ),
      decision: ready ? 'allow' : 'block',
      externalWriteSuppressed: decision.externalWriteSuppressed === true
        || boundaryHandoff.externalWriteSuppressed === true
        || auditEnvelope.audit?.externalWriteSuppressed === true,
    },
    counters: {
      blockedReasons: blockedReasons.length,
      decisionBlockedReasons: stableList(decision.blockedReasons).length,
      handoffBlockedReasons: stableList(boundaryHandoff.blockedReasons).length,
      auditBlockedReasons: stableList(auditEnvelope.blockedReasons).length,
      runtimeDrift: tenantMatches && workspaceMatches ? 0 : 1,
      auditRequired: auditRequired ? 1 : 0,
      auditReady: auditReady ? 1 : 0,
    },
    route: {
      target: 'adapter-tenant-boundary-continuity',
      idempotencyKey: continuityKey,
      primaryAction: nextAction,
      requiredBodyKeys: ready ? ['continuityKey', 'requestId'] : ['continuityKey', 'blockedReasons'],
    },
    clientPatch: {
      tenantBoundaryContinuityKey: continuityKey,
      tenantBoundaryContinuityState: state,
      tenantBoundaryContinuityReady: ready,
      tenantBoundaryContinuityNextAction: nextAction,
      tenantBoundaryContinuityBlockedReasons: blockedReasons,
    },
    actionableErrors: blockedReasons.map((reason) => ({
      code: `mailchimp.boundary_continuity.${reason.split(':')[0]}`,
      severity: reason.includes('mismatch') || reason.includes('not_ready') ? 'error' : 'warning',
      reason,
      action: reason.includes('audit') ? 'append_tenant_boundary_audit' : nextAction,
      retryable: reason.includes('audit') || reason.includes('workspace'),
    })),
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-tenant-boundary-continuity-key',
      resumeFromBoundaryContinuityKey: continuityKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpTenantBoundaryAuditEnvelope(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const decision = descriptor.tenantPermissionDecisionBundle || {};
  const boundaryHandoff = descriptor.boundaryHandoff || {};
  const boundaryContract = descriptor.boundaryContract || {};
  const runtimeAudit = runtime.tenantBoundaryAudit && typeof runtime.tenantBoundaryAudit === 'object'
    ? runtime.tenantBoundaryAudit
    : runtime.boundaryAudit && typeof runtime.boundaryAudit === 'object'
      ? runtime.boundaryAudit
      : {};
  const runtimeWorkspace = compactString(runtime.workspace || runtime.workspaceId || runtimeAudit.workspace);
  const runtimeTenant = compactString(runtime.tenant || runtime.tenantId || runtimeAudit.tenant);
  const tenant = compactString(decision.tenant || boundaryHandoff.tenant || descriptor.tenant);
  const workspace = compactString(decision.workspace || boundaryHandoff.workspace || boundaryContract.workspace);
  const action = compactString(decision.action || boundaryHandoff.action || descriptor.action);
  const auditKey = compactString(
    runtimeAudit.auditKey
      || runtimeAudit.envelopeKey
      || decision.audit?.handoffKey
      || boundaryHandoff.audit?.handoffKey,
  );
  const persistedAuditKey = compactString(runtimeAudit.persistedAuditKey || runtimeAudit.persistedKey);
  const appendRequested = runtimeAudit.appendRequested === true
    || runtimeAudit.command === 'append_tenant_boundary_audit'
    || decision.audit?.command === 'append_tenant_boundary_audit'
    || boundaryHandoff.route?.nextAction === 'append_tenant_boundary_audit';
  const appended = runtimeAudit.appended === true
    || runtimeAudit.persisted === true
    || Boolean(persistedAuditKey);
  const auditRequired = decision.audit?.required === true
    || boundaryHandoff.requiresAuditAppend === true
    || decision.externalWriteSuppressed === true
    || boundaryHandoff.externalWriteSuppressed === true
    || MAILCHIMP_MUTATING_ACTIONS.has(action);
  const auditReady = appended
    || runtimeAudit.ready === true
    || decision.audit?.ready === true
    || boundaryHandoff.auditAppendReady === true;
  const tenantMatches = !runtimeTenant || !tenant || runtimeTenant === tenant;
  const workspaceMatches = !runtimeWorkspace || !workspace || runtimeWorkspace === workspace;
  const blockedReasons = stableList([
    ...stableList(decision.blockedReasons).map((reason) => `decision:${reason}`),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `handoff:${reason}`),
    ...(tenantMatches ? [] : ['runtime_tenant_mismatch']),
    ...(workspaceMatches ? [] : ['runtime_workspace_mismatch']),
    ...(auditRequired && !auditKey ? ['audit_handoff_key_missing'] : []),
    ...(auditRequired && !auditReady ? ['audit_append_not_persisted'] : []),
    ...(decision.ready === false ? ['tenant_permission_decision_not_ready'] : []),
    ...(boundaryHandoff.readyForRuntime === false ? ['tenant_boundary_handoff_not_ready'] : []),
  ]);
  const envelopeKey = `mailchimp-boundary-audit:${stableHash({
    tenant,
    workspace,
    action,
    auditKey,
    persistedAuditKey,
    blockedReasons,
  })}`;
  const ready = blockedReasons.length === 0
    && (!auditRequired || auditReady)
    && decision.ready !== false
    && boundaryHandoff.readyForRuntime !== false;
  const nextAction = ready
    ? 'resume_after_tenant_boundary_audit'
    : blockedReasons.includes('audit_handoff_key_missing')
      ? 'repair_tenant_permissions'
      : blockedReasons.includes('audit_append_not_persisted')
        ? 'append_tenant_boundary_audit'
        : blockedReasons.includes('runtime_workspace_mismatch')
          ? 'switch_workspace_or_recompile'
          : decision.nextAction || boundaryHandoff.route?.nextAction || boundaryHandoff.nextAction || 'repair_tenant_permissions';

  return {
    protocol: 'aios.adapter-tenant-boundary-audit-envelope.mailchimp.v1',
    envelopeKey,
    requestId: compactString(descriptor.requestId),
    tenant,
    workspace,
    action,
    state: ready
      ? 'ready'
      : auditRequired && !auditReady
        ? 'waiting_for_audit_append'
        : 'blocked',
    ready,
    auditRequired,
    auditReady,
    appendRequested,
    appended,
    nextAction,
    blockedReasons,
    decision: {
      decisionKey: compactString(decision.decisionKey),
      status: compactString(decision.status || 'unknown'),
      ready: decision.ready === true,
      allowedForRuntime: decision.allowedForRuntime === true,
      externalWriteSuppressed: decision.externalWriteSuppressed === true,
      blockedReasons: stableList(decision.blockedReasons),
    },
    handoff: {
      boundaryKey: compactString(boundaryHandoff.boundaryKey),
      readyForRuntime: boundaryHandoff.readyForRuntime === true,
      allowed: boundaryHandoff.allowed !== false,
      requiresAuditAppend: boundaryHandoff.requiresAuditAppend === true,
      auditAppendReady: boundaryHandoff.auditAppendReady === true,
      blockedReasons: stableList(boundaryHandoff.blockedReasons),
    },
    audit: {
      channel: compactString(decision.audit?.channel || boundaryHandoff.audit?.channel || 'adapter-boundary-audit'),
      handoffKey: auditKey,
      persistedAuditKey,
      decision: ready ? 'allow' : 'block',
      externalWriteSuppressed: decision.externalWriteSuppressed === true
        || boundaryHandoff.externalWriteSuppressed === true
        || boundaryHandoff.audit?.externalWriteSuppressed === true,
    },
    runtimeBoundary: {
      tenant: runtimeTenant,
      workspace: runtimeWorkspace,
      tenantMatches,
      workspaceMatches,
    },
    route: {
      target: 'adapter-tenant-boundary-audit',
      method: 'POST',
      idempotencyKey: envelopeKey,
      primaryAction: nextAction,
      requiredBodyKeys: auditRequired && !auditReady
        ? ['envelopeKey', 'handoffKey', 'auditDecision']
        : ['envelopeKey', 'requestId'],
    },
    clientPatch: {
      tenantBoundaryAuditEnvelopeKey: envelopeKey,
      tenantBoundaryAuditState: ready ? 'ready' : 'blocked',
      tenantBoundaryAuditReady: ready,
      tenantBoundaryAuditRequired: auditRequired,
      tenantBoundaryAuditNextAction: nextAction,
      tenantBoundaryAuditBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-tenant-boundary-audit-envelope-key',
      resumeFromBoundaryAuditEnvelopeKey: envelopeKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpAdapterPersistedResumeTicket(descriptor = {}, runtime = {}) {
  const providerContract = descriptor.providerContract || {};
  const dispatchReadiness = descriptor.adapterDispatchReadiness || {};
  const tenantPermissionDecisionBundle = descriptor.tenantPermissionDecisionBundle || {};
  const boundaryHandoff = descriptor.boundaryHandoff || {};
  const providerReceiptEvidence = descriptor.providerReceiptEvidence || dispatchReadiness.providerReceiptEvidence || {};
  const providerContinuity = descriptor.providerContinuity || dispatchReadiness.providerContinuity || {};
  const compileIdentity = descriptor.compileIdentity || {};
  const externalHandoff = providerContract.externalHandoff || descriptor.externalHandoff || {};
  const sync = providerContract.sync || {};
  const lease = providerContract.lease || {};
  const receipt = providerContract.providerReceipt || descriptor.providerReceipt || providerReceiptEvidence.receipt || {};
  const tenant = compactString(descriptor.tenant || runtime.tenant);
  const workspace = compactString(
    boundaryHandoff.workspace
      || boundaryHandoff.tenant?.workspace
      || descriptor.boundaryContract?.workspace
      || runtime.workspace
      || runtime.workspaceId,
  );
  const action = compactString(descriptor.action || runtime.action);
  const requestId = compactString(descriptor.requestId || runtime.requestId);
  const idempotencyKey = compactString(descriptor.idempotencyKey || runtime.idempotencyKey || descriptor.clientCommand?.idempotencyKey);
  const command = compactString(
    runtime.statusCommand
      || runtime.lifecycleCommand
      || descriptor.lifecycle?.requestedCommand
      || descriptor.clientCommand?.submitAction
      || 'queue',
  ).toLowerCase().replaceAll('-', '_');
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(action) && descriptor.dryRun !== true;
  const externalRequestId = compactString(
    externalHandoff.requestId
      || externalHandoff.externalRequestId
      || providerContract.externalRequestId
      || runtime.externalRequestId,
  );
  const syncCursor = compactString(sync.cursor || providerContract.syncCursor || runtime.syncCursor);
  const receiptRequired = receipt.required === true
    || externalHandoff.receiptRequired === true
    || providerReceiptEvidence.receipt?.required === true
    || (mutating && externalHandoff.localOnly === false);
  const receiptAcknowledged = receipt.acknowledged === true
    || externalHandoff.receiptAcknowledged === true
    || providerReceiptEvidence.receipt?.acknowledged === true;
  const permissionReady = tenantPermissionDecisionBundle.ready !== false
    && tenantPermissionDecisionBundle.allowedForRuntime !== false
    && boundaryHandoff.readyForRuntime !== false;
  const providerReady = providerContract.serviceState !== 'offline'
    && providerContract.capabilityNegotiation?.satisfied !== false
    && providerContinuity.holdExternalWrite !== true
    && sync.ready !== false
    && lease.restartSafe !== false;
  const dispatchReady = dispatchReadiness.ready !== false
    && dispatchReadiness.dispatchReady !== false
    && descriptor.lifecycle?.blocked !== true;
  const missingEvidence = stableList([
    ...(!requestId ? ['request_id'] : []),
    ...(!tenant ? ['tenant'] : []),
    ...(!idempotencyKey && mutating ? ['idempotency_key'] : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_acknowledgement'] : []),
    ...(externalHandoff.localOnly === false && !externalRequestId ? ['external_request_id'] : []),
    ...(providerContract.capabilityNegotiation?.satisfied === false ? ['provider_capability_negotiation'] : []),
    ...(permissionReady ? [] : ['tenant_permission_decision'] ),
  ]);
  const blockedReasons = stableList([
    ...missingEvidence.map((item) => `missing:${item}`),
    ...(permissionReady ? [] : ['tenant_permission_not_ready']),
    ...(providerReady ? [] : ['provider_contract_not_ready']),
    ...(dispatchReady ? [] : ['adapter_dispatch_not_ready']),
    ...(providerContinuity.queueOnly === true ? ['provider_queue_only'] : []),
    ...(providerContinuity.holdExternalWrite === true ? ['provider_continuity_hold'] : []),
    ...(descriptor.truthBoundary?.externalWritesAllowed === true && mutating && descriptor.dryRun === true ? ['dry_run_blocks_external_write'] : []),
  ]);
  const ticketKey = `mailchimp-resume:${stableHash({
    requestId,
    tenant,
    workspace,
    action,
    idempotencyKey,
    command,
    externalRequestId,
    syncCursor,
    cacheKey: compileIdentity.cacheKey,
  })}`;
  const ready = blockedReasons.length === 0;
  const nextAction = ready
    ? 'persist_runtime_resume_ticket'
    : blockedReasons.includes('tenant_permission_not_ready')
      ? tenantPermissionDecisionBundle.nextAction || 'repair_tenant_permissions'
      : blockedReasons.includes('provider_contract_not_ready') || blockedReasons.includes('provider_queue_only')
        ? providerContinuity.nextAction || providerContract.nextAction || 'refresh_provider_contract'
        : blockedReasons.includes('adapter_dispatch_not_ready')
          ? dispatchReadiness.nextAction || 'inspect_adapter_dispatch_readiness'
          : missingEvidence.includes('provider_receipt_acknowledgement')
            ? 'refresh_provider_receipt'
            : 'repair_runtime_resume_ticket';

  return {
    protocol: 'aios.adapter-persisted-resume-ticket.mailchimp.v1',
    ticketKey,
    requestId,
    tenant,
    workspace,
    action,
    command,
    ready,
    state: ready ? 'ready_to_persist' : 'blocked',
    nextAction,
    idempotencyKey,
    missingEvidence,
    blockedReasons,
    continuity: {
      externalRequestId,
      syncCursor,
      cacheKey: compactString(compileIdentity.cacheKey),
      sourceHash: compactString(compileIdentity.sourceHash),
      contractHash: compactString(compileIdentity.contractHash),
      providerServiceState: compactString(providerContract.serviceState || 'unknown'),
      providerContinuityMode: compactString(providerContinuity.mode || 'unknown'),
      leaseRestartSafe: lease.restartSafe !== false,
      receiptRequired,
      receiptAcknowledged,
    },
    route: {
      target: 'status-persistence',
      idempotencyKey: ticketKey,
      primaryAction: nextAction,
      requiredBodyKeys: ready
        ? ['ticketKey', 'requestId', 'idempotencyKey', 'continuity']
        : ['ticketKey', 'blockedReasons'],
    },
    clientPatch: {
      adapterPersistedResumeTicketKey: ticketKey,
      adapterPersistedResumeTicketReady: ready,
      adapterPersistedResumeTicketNextAction: nextAction,
      adapterPersistedResumeTicketBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-adapter-persisted-resume-ticket-key',
      resumeFromTicketKey: ticketKey,
      externalWritesPerformed: false,
    },
  };
}

function validateLifecycleSettings(settings, handoff) {
  const diagnostics = [];
  if (!LIFECYCLE_COMMANDS.has(settings.requestedCommand)) {
    diagnostics.push({
      code: 'mailchimp.lifecycle.unsupported_command',
      severity: 'error',
      field: 'lifecycle.command',
      message: `Unsupported Mailchimp lifecycle command "${settings.requestedCommand}".`,
    });
  }
  if (settings.enabled === false && LIFECYCLE_DISABLED_COMMANDS.has(settings.requestedCommand)) {
    diagnostics.push({
      code: 'mailchimp.lifecycle.disabled_command_blocked',
      severity: 'error',
      field: 'lifecycle.enabled',
      message: `Lifecycle command "${settings.requestedCommand}" cannot run while controls are disabled.`,
    });
  }
  if (settings.schedule.mode === 'scheduled' && !settings.schedule.runAt) {
    diagnostics.push({
      code: 'mailchimp.lifecycle.missing_schedule_time',
      severity: 'error',
      field: 'lifecycle.schedule.runAt',
      message: 'Scheduled Mailchimp lifecycle commands require a runAt value.',
    });
  }
  if (settings.controls.maxDispatches < 1 && settings.requestedCommand === 'dispatch') {
    diagnostics.push({
      code: 'mailchimp.lifecycle.dispatch_limit_exhausted',
      severity: 'error',
      field: 'lifecycle.controls.maxDispatches',
      message: 'Dispatch requires at least one available dispatch attempt.',
    });
  }
  if (
    settings.controls.allowExternalWrite === false
    && MAILCHIMP_MUTATING_ACTIONS.has(handoff.action)
    && handoff.dryRun !== true
  ) {
    diagnostics.push({
      code: 'mailchimp.lifecycle.external_write_disabled',
      severity: 'error',
      field: 'lifecycle.controls.allowExternalWrite',
      message: 'Lifecycle controls disable external writes for this mutating Mailchimp action.',
    });
  }
  return diagnostics;
}

function validateProviderHandoff(provider, handoff) {
  const diagnostics = [];
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(handoff.action);
  const externallyLinked = provider.mode !== 'local_only' || Boolean(provider.externalRequestId);

  if (provider.provider !== 'mailchimp') {
    diagnostics.push({
      code: 'mailchimp.provider.adapter_mismatch',
      severity: 'error',
      field: 'provider.provider',
      message: 'Mailchimp handoffs require a Mailchimp provider contract.',
    });
  }
  if (externallyLinked && !provider.accountId) {
    diagnostics.push({
      code: 'mailchimp.provider.missing_account',
      severity: 'warning',
      field: 'provider.accountId',
      message: 'Linked Mailchimp handoffs should include the provider account id.',
    });
  }
  if (externallyLinked && !provider.dataCenter) {
    diagnostics.push({
      code: 'mailchimp.provider.missing_data_center',
      severity: 'warning',
      field: 'provider.dataCenter',
      message: 'Linked Mailchimp handoffs should include the Mailchimp data center.',
    });
  }
  if (provider.serviceState === 'offline' && mutating && handoff.dryRun !== true) {
    diagnostics.push({
      code: 'mailchimp.provider.offline_write_blocked',
      severity: 'error',
      field: 'provider.serviceState',
      message: 'Mailchimp provider is offline for a mutating handoff.',
    });
  }
  if (provider.mode === 'claim' && !provider.lease.token) {
    diagnostics.push({
      code: 'mailchimp.provider.missing_lease_token',
      severity: 'warning',
      field: 'provider.lease.token',
      message: 'Provider handoff claim mode should include a lease token for restart-safe ownership.',
    });
  }
  if (mutating && !provider.sync.cursor && provider.mode !== 'local_only') {
    diagnostics.push({
      code: 'mailchimp.provider.missing_sync_cursor',
      severity: 'warning',
      field: 'provider.sync.cursor',
      message: 'Linked mutating Mailchimp handoffs should carry a sync cursor.',
    });
  }

  return diagnostics;
}

function buildProviderHandoffContract(provider, handoff, capabilities, receipt = normalizeProviderReceipt({}, handoff)) {
  const requested = stableList([
    `mailchimp.${handoff.action || 'unknown'}`,
    ...handoff.capabilities,
    ...provider.capabilities.requested,
    ...(capabilities.has('external.write') ? ['external.write'] : []),
  ]);
  const advertised = provider.capabilities.advertised;
  const missing = requested
    .filter((capability) => capability.startsWith('mailchimp.') || capability === 'external.write')
    .filter((capability) => advertised.length > 0 && !advertised.includes(capability));
  const externalState = provider.externalRequestId
    ? 'linked'
    : provider.mode === 'claim'
      ? 'claim_pending'
      : provider.mode === 'release'
        ? 'release_pending'
      : 'local_only';
  const receiptRequired = capabilities.has('external.write') && externalState !== 'local_only';
  const receiptBlockedReasons = stableList([
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
    ...(receiptRequired && receipt.acknowledged !== true ? ['provider_receipt_ack_missing'] : []),
  ]);

  return {
    protocol: 'aios.adapter-provider-contract.mailchimp.v1',
    provider: provider.provider,
    service: provider.service,
    serviceState: provider.serviceState,
    account: {
      id: provider.accountId,
      dataCenter: provider.dataCenter,
    },
    sync: {
      ...provider.sync,
      requiredForExternalWrite: capabilities.has('external.write'),
      ready: !capabilities.has('external.write') || Boolean(provider.sync.cursor || handoff.dryRun),
    },
    capabilityNegotiation: {
      requested,
      advertised,
      missing,
      satisfied: missing.length === 0,
      writeCapabilityRequested: requested.includes('external.write'),
    },
    lease: {
      ...provider.lease,
      state: provider.lease.token
        ? 'held'
        : provider.mode === 'claim'
          ? 'missing_token'
          : 'not_required',
      restartSafe: provider.mode === 'local_only' || Boolean(provider.lease.token || provider.externalRequestId),
    },
    externalHandoff: {
      state: externalState,
      mode: provider.mode,
      requestId: provider.externalRequestId,
      localOnly: externalState === 'local_only',
      receiptRequired,
      receiptAcknowledged: receipt.acknowledged === true,
      receiptId: receipt.receiptId,
      receiptState: receipt.state,
      blockedReasons: receiptBlockedReasons,
    },
    providerReceipt: {
      ...receipt,
      required: receiptRequired || receipt.required === true,
      restartSafe: receipt.restartSafe !== false && receiptBlockedReasons.length === 0,
      blockedReasons: receiptBlockedReasons,
    },
  };
}

function buildProviderReceiptEvidenceHandoff(providerContract, receipt, handoff, lifecycle) {
  const external = providerContract.externalHandoff || {};
  const sync = providerContract.sync || {};
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(handoff.action);
  const receiptRequired = external.receiptRequired === true || receipt.required === true;
  const acknowledged = receipt.acknowledged === true || external.receiptAcknowledged === true;
  const providerLinked = external.state !== 'local_only' || Boolean(external.requestId);
  const missingEvidence = stableList([
    ...(receiptRequired && !acknowledged ? ['provider_receipt_acknowledgement'] : []),
    ...(providerLinked && !external.requestId ? ['external_request_id'] : []),
    ...(mutating && providerLinked && sync.ready !== true ? ['provider_sync_cursor'] : []),
    ...(providerContract.lease?.restartSafe === false ? ['provider_lease_restart_safety'] : []),
    ...(providerContract.capabilityNegotiation?.satisfied === false ? ['provider_capability_negotiation'] : []),
    ...(receipt.restartSafe === false ? ['provider_receipt_restart_safety'] : []),
    ...stableList(receipt.blockedReasons).map((reason) => `receipt:${reason}`),
    ...stableList(external.blockedReasons).map((reason) => `external_handoff:${reason}`),
  ]);
  const state = missingEvidence.length === 0
    ? receiptRequired || providerLinked
      ? 'evidence_ready'
      : 'not_required'
    : missingEvidence.includes('provider_receipt_acknowledgement')
      ? 'waiting_for_provider_receipt'
      : missingEvidence.includes('provider_sync_cursor')
        ? 'waiting_for_provider_sync'
        : missingEvidence.includes('external_request_id')
          ? 'waiting_for_external_handoff_link'
          : 'blocked';
  const evidenceKey = stableHash({
    tenant: handoff.tenant,
    action: handoff.action,
    idempotencyKey: handoff.idempotencyKey,
    provider: providerContract.provider,
    service: providerContract.service,
    requestId: external.requestId,
    receiptId: receipt.receiptId,
    state,
  });
  const nextAction = state === 'evidence_ready' || state === 'not_required'
    ? lifecycle?.nextAction || 'dispatch-mailchimp-handoff'
    : state === 'waiting_for_provider_receipt'
      ? 'refresh_provider_receipt'
      : state === 'waiting_for_provider_sync'
        ? 'refresh_provider_contract'
        : state === 'waiting_for_external_handoff_link'
          ? 'relink_external_handoff'
          : 'refresh_provider_contract';

  return {
    protocol: 'aios.adapter-provider-receipt-evidence.mailchimp.v1',
    evidenceKey: `mailchimp-provider-evidence:${evidenceKey}`,
    state,
    ready: missingEvidence.length === 0,
    restartSafe: missingEvidence.length === 0 || state === 'not_required',
    replaySafe: missingEvidence.length === 0 && receipt.restartSafe !== false,
    tenant: compactString(handoff.tenant),
    action: compactString(handoff.action),
    provider: compactString(providerContract.provider || 'mailchimp'),
    service: compactString(providerContract.service || 'mailchimp-marketing'),
    externalHandoff: {
      state: compactString(external.state || 'local_only'),
      requestId: compactString(external.requestId),
      linked: external.localOnly !== true && Boolean(external.requestId),
      receiptRequired,
      receiptAcknowledged: acknowledged,
    },
    receipt: {
      state: compactString(receipt.state || 'missing'),
      receiptId: compactString(receipt.receiptId),
      acknowledged,
      acknowledgedAt: compactString(receipt.acknowledgedAt),
      syncCursor: compactString(receipt.syncCursor || sync.cursor),
      artifactIds: stableList(receipt.artifactIds),
      restartSafe: receipt.restartSafe !== false,
      blockedReasons: stableList(receipt.blockedReasons),
      audit: receipt.audit || null,
    },
    sync: {
      resource: compactString(sync.resource || 'mailchimp'),
      cursor: compactString(sync.cursor || receipt.syncCursor),
      ready: sync.ready === true,
      requiredForExternalWrite: sync.requiredForExternalWrite === true,
    },
    missingEvidence,
    nextAction,
    route: {
      target: 'provider-receipt-evidence',
      idempotencyKey: `mailchimp-provider-evidence:${evidenceKey}`,
      primaryAction: nextAction,
      requiredBodyKeys: receiptRequired ? ['receiptId', 'externalRequestId'] : ['requestId'],
    },
    clientPatch: {
      adapterProviderEvidenceState: state,
      adapterProviderEvidenceReady: missingEvidence.length === 0,
      adapterProviderEvidenceKey: `mailchimp-provider-evidence:${evidenceKey}`,
      adapterProviderEvidenceNextAction: nextAction,
      adapterProviderEvidenceMissing: missingEvidence,
    },
    restartSemantics: {
      replaySafe: missingEvidence.length === 0 && receipt.restartSafe !== false,
      duplicateCommandPolicy: 'dedupe-by-provider-receipt-evidence-key',
      resumeFromEvidenceKey: `mailchimp-provider-evidence:${evidenceKey}`,
      externalWritesPerformed: false,
    },
  };
}

function buildProviderContinuityContract(providerContract, receiptEvidence, handoff, lifecycle) {
  const serviceState = compactString(providerContract.serviceState || 'unknown');
  const external = providerContract.externalHandoff || {};
  const lease = providerContract.lease || {};
  const sync = providerContract.sync || {};
  const negotiation = providerContract.capabilityNegotiation || {};
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(handoff.action);
  const requestedCommand = compactString(lifecycle?.requestedCommand || handoff.lifecycleSettings?.requestedCommand || 'queue');
  const externalWriteRequested = mutating && handoff.dryRun !== true;
  const receiptMissing = external.receiptRequired === true && external.receiptAcknowledged !== true;
  const degradedReasons = stableList([
    ...(serviceState === 'offline' ? ['provider_service_offline'] : []),
    ...(serviceState === 'degraded' ? ['provider_service_degraded'] : []),
    ...(negotiation.satisfied === false ? ['provider_capability_negotiation_incomplete'] : []),
    ...(sync.ready === false ? ['provider_sync_not_ready'] : []),
    ...(lease.restartSafe === false ? ['provider_lease_not_restart_safe'] : []),
    ...(receiptEvidence.ready === false ? ['provider_receipt_evidence_not_ready'] : []),
    ...stableList(receiptEvidence.missingEvidence).map((item) => `provider_evidence:${item}`),
    ...(receiptMissing ? ['provider_receipt_not_acknowledged'] : []),
  ]);
  const holdRequired = serviceState === 'offline' && externalWriteRequested;
  const queueOnly = serviceState === 'degraded' && externalWriteRequested;
  const retryable = degradedReasons.length > 0
    && !holdRequired
    && !degradedReasons.includes('provider_capability_negotiation_incomplete');
  const mode = degradedReasons.length === 0
    ? 'healthy'
    : holdRequired
      ? 'hold_external_write'
      : queueOnly
        ? 'queue_without_dispatch'
        : retryable
          ? 'retry_after_provider_refresh'
          : 'blocked';
  const nextAction = mode === 'healthy'
    ? requestedCommand === 'dispatch'
      ? 'dispatch-mailchimp-handoff'
      : 'queue-mailchimp-handoff'
    : holdRequired
      ? 'hold_for_provider_recovery'
      : degradedReasons.includes('provider_receipt_not_acknowledged')
        || degradedReasons.includes('provider_receipt_evidence_not_ready')
        ? 'refresh_provider_receipt'
        : degradedReasons.includes('provider_lease_not_restart_safe')
          ? 'refresh_provider_lease'
          : degradedReasons.includes('provider_capability_negotiation_incomplete')
            ? 'renegotiate_mailchimp_provider_capabilities'
            : 'refresh_provider_contract';
  const continuityKey = `mailchimp-provider-continuity:${stableHash({
    tenant: handoff.tenant,
    action: handoff.action,
    idempotencyKey: handoff.idempotencyKey,
    service: providerContract.service,
    serviceState,
    externalState: external.state,
    degradedReasons,
  })}`;

  return {
    protocol: 'aios.adapter-provider-continuity.mailchimp.v1',
    continuityKey,
    provider: compactString(providerContract.provider || 'mailchimp'),
    service: compactString(providerContract.service || 'mailchimp-marketing'),
    serviceState,
    mode,
    healthy: mode === 'healthy',
    degraded: mode !== 'healthy',
    holdExternalWrite: holdRequired,
    queueOnly,
    retryable,
    nextAction,
    retry: {
      retryable,
      retryAfterMs: retryable ? serviceState === 'degraded' ? 45000 : 30000 : 0,
      maxAttempts: retryable ? 4 : 0,
      backoffPolicy: retryable ? 'provider-continuity-exponential' : 'none',
    },
    externalHandoff: {
      state: compactString(external.state || 'local_only'),
      requestId: compactString(external.requestId),
      receiptRequired: external.receiptRequired === true,
      receiptAcknowledged: external.receiptAcknowledged === true,
    },
    degradedReasons,
    clientPatch: {
      adapterProviderContinuityMode: mode,
      adapterProviderContinuityKey: continuityKey,
      adapterProviderContinuityNextAction: nextAction,
      adapterProviderContinuityRetryAfterMs: retryable ? serviceState === 'degraded' ? 45000 : 30000 : 0,
    },
    restartSemantics: {
      replaySafe: !holdRequired && lease.restartSafe !== false,
      duplicateCommandPolicy: 'dedupe-by-provider-continuity-key',
      resumeFromContinuityKey: continuityKey,
      externalWritesPerformed: false,
    },
  };
}

function buildLifecycleContract(settings, handoff, validationOk) {
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(handoff.action);
  const verifierRequired = handoff.verifier.length > 0 && settings.controls.requireVerifierBeforeDispatch;
  const dispatchBlocked = !settings.enabled
    || settings.controls.operatorHold
    || !validationOk
    || (mutating && settings.controls.allowExternalWrite === false)
    || (settings.requestedCommand === 'dispatch' && verifierRequired && handoff.truthBoundary !== 'verified');
  const nextAction = dispatchBlocked
    ? settings.controls.operatorHold
      ? 'operator_hold'
      : !settings.enabled
        ? 'enable_lifecycle_controls'
        : verifierRequired && handoff.truthBoundary !== 'verified'
          ? 'collect_verifier_before_dispatch'
          : 'repair_lifecycle_settings'
    : settings.requestedCommand;

  return {
    protocol: 'aios.adapter-lifecycle.mailchimp.v1',
    enabled: settings.enabled,
    requestedCommand: settings.requestedCommand,
    nextAction,
    dispatchReady: !dispatchBlocked && ['queue', 'dispatch', 'resume'].includes(settings.requestedCommand),
    schedule: settings.schedule,
    controls: {
      ...settings.controls,
      canEnable: true,
      canDisable: true,
      canDispatch: !dispatchBlocked,
      canSchedule: settings.enabled && validationOk,
      canCancel: ['queue', 'dispatch', 'pause', 'resume'].includes(settings.requestedCommand),
    },
    gates: {
      mutating,
      verifierRequired,
      truthBoundaryVerified: handoff.truthBoundary === 'verified',
      externalWriteAllowedByControls: settings.controls.allowExternalWrite,
      operatorHold: settings.controls.operatorHold,
    },
  };
}

function buildLifecycleControlSummary(lifecycle, handoff, validationDiagnostics = []) {
  const schedule = lifecycle.schedule || {};
  const controls = lifecycle.controls || {};
  const diagnosticErrors = validationDiagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(handoff.action);
  const scheduleDeferred = schedule.mode === 'scheduled' && Boolean(schedule.runAt);
  const blockedReasons = stableList([
    ...(diagnosticErrors.map((diagnostic) => diagnostic.code)),
    ...(lifecycle.enabled === false ? ['lifecycle_controls_disabled'] : []),
    ...(controls.operatorHold === true ? ['lifecycle_operator_hold'] : []),
    ...(lifecycle.dispatchReady === false && ['dispatch', 'resume'].includes(lifecycle.requestedCommand)
      ? ['lifecycle_dispatch_not_ready']
      : []),
    ...(mutating && controls.allowExternalWrite === false ? ['external_write_disabled'] : []),
  ]);
  const state = blockedReasons.length > 0
    ? controls.operatorHold === true
      ? 'held'
      : lifecycle.enabled === false
        ? 'disabled'
        : 'blocked'
    : scheduleDeferred
      ? 'scheduled'
      : lifecycle.dispatchReady === true
        ? 'ready'
        : 'accepted';
  const primaryAction = state === 'ready'
    ? lifecycle.requestedCommand === 'dispatch'
      ? 'dispatch-mailchimp-handoff'
      : lifecycle.requestedCommand === 'resume'
        ? 'resume-mailchimp-handoff'
        : 'queue-mailchimp-handoff'
    : state === 'scheduled'
      ? 'wait_for_lifecycle_schedule'
      : state === 'held'
        ? 'await_lifecycle_release'
        : state === 'disabled'
          ? 'enable_lifecycle_controls'
          : lifecycle.nextAction || 'repair_lifecycle_settings';
  const controlKey = stableHash({
    tenant: handoff.tenant,
    action: handoff.action,
    requestId: handoff.requestId,
    idempotencyKey: handoff.idempotencyKey,
    command: lifecycle.requestedCommand,
    state,
    schedule,
    blockedReasons,
  });

  return {
    protocol: 'aios.adapter-lifecycle-control-summary.mailchimp.v1',
    controlKey: `mailchimp-lifecycle-control:${controlKey}`,
    state,
    ready: state === 'ready' || state === 'accepted',
    commandAccepted: blockedReasons.length === 0,
    requestedCommand: lifecycle.requestedCommand,
    primaryAction,
    nextAction: primaryAction,
    blockedReasons,
    schedule: {
      mode: compactString(schedule.mode || 'manual'),
      runAt: compactString(schedule.runAt),
      timezone: compactString(schedule.timezone || 'UTC'),
      deferred: state === 'scheduled',
      cooldownSeconds: positiveInteger(schedule.cooldownSeconds, 0),
    },
    controls: {
      enabled: lifecycle.enabled !== false,
      operatorHold: controls.operatorHold === true,
      allowExternalWrite: controls.allowExternalWrite !== false,
      canEnable: lifecycle.controls?.canEnable !== false,
      canDisable: lifecycle.controls?.canDisable !== false,
      canDispatch: lifecycle.controls?.canDispatch === true && state === 'ready',
      canSchedule: lifecycle.controls?.canSchedule === true,
      canCancel: lifecycle.controls?.canCancel === true,
    },
    clientPatch: {
      adapterLifecycleControlState: state,
      adapterLifecycleControlKey: `mailchimp-lifecycle-control:${controlKey}`,
      adapterLifecycleControlNextAction: primaryAction,
      adapterLifecycleControlBlockedReasons: blockedReasons,
      adapterLifecycleScheduleDeferred: state === 'scheduled',
    },
    restartSemantics: {
      replaySafe: blockedReasons.length === 0 && controls.operatorHold !== true,
      duplicateCommandPolicy: 'dedupe-by-adapter-lifecycle-control-key',
      resumeFromLifecycleControlKey: `mailchimp-lifecycle-control:${controlKey}`,
      externalWritesPerformed: false,
    },
  };
}

function buildDispatchReadinessContract(descriptor, context = {}) {
  const diagnostics = Array.isArray(descriptor.diagnostics) ? descriptor.diagnostics : [];
  const boundary = descriptor.boundaryContract || {};
  const lifecycle = descriptor.lifecycle || {};
  const provider = descriptor.providerContract || {};
  const receipt = descriptor.providerReceipt || provider.providerReceipt || {};
  const externalHandoff = descriptor.externalHandoff || provider.externalHandoff || {};
  const providerReceiptEvidence = descriptor.providerReceiptEvidence || {};
  const providerContinuity = descriptor.providerContinuity || {};
  const acceptance = context.acceptance && typeof context.acceptance === 'object'
    ? context.acceptance
    : descriptor.clientCommand?.acceptance || {};
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(descriptor.action);
  const externalWrite = descriptor.truthBoundary?.externalWritesAllowed === true
    || (Array.isArray(descriptor.capabilities) && descriptor.capabilities.includes('external.write'));
  const diagnosticErrors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const providerMissing = stableList(provider.capabilityNegotiation?.missing);
  const boundaryHandoff = descriptor.boundaryHandoff || {};
  const tenantPermissionDecisionBundle = descriptor.tenantPermissionDecisionBundle
    || buildTenantPermissionDecisionBundle(boundary, boundaryHandoff, descriptor, provider, lifecycle);
  const boundaryTokenBlocked = boundaryHandoff.readyForRuntime === false
    || boundaryHandoff.allowed === false
    || stableList(boundaryHandoff.blockedReasons).length > 0;
  const auditAppendRequired = boundaryHandoff.requiresAuditAppend === true;
  const auditAppendReady = auditAppendRequired !== true || boundaryHandoff.auditAppendReady === true;
  const receiptRequired = receipt.required === true || provider.externalHandoff?.receiptRequired === true;
  const receiptAcknowledged = receipt.acknowledged === true || provider.externalHandoff?.receiptAcknowledged === true;
  const providerEvidenceReady = providerReceiptEvidence.ready !== false
    && stableList(providerReceiptEvidence.missingEvidence).length === 0;
  const acceptanceRequired = acceptance.required === true
    || (externalWrite && lifecycle.requestedCommand === 'dispatch');
  const acceptanceAccepted = acceptance.accepted === true;
  const verifierRequired = lifecycle.gates?.verifierRequired === true;
  const truthVerified = lifecycle.gates?.truthBoundaryVerified === true
    || descriptor.truthBoundary?.level === 'verified';
  const blockedReasons = stableList([
    ...diagnosticErrors.map((diagnostic) => `diagnostic:${diagnostic.code}`),
    ...(boundary.allowed === false ? ['tenant_boundary_denied'] : []),
    ...(Array.isArray(boundary.blockedReasons) ? boundary.blockedReasons.map((reason) => `boundary:${reason}`) : []),
    ...(boundaryTokenBlocked ? ['boundary_handoff_not_ready'] : []),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `boundary_handoff:${reason}`),
    ...(tenantPermissionDecisionBundle.ready === false ? ['tenant_permission_decision_not_ready'] : []),
    ...stableList(tenantPermissionDecisionBundle.blockedReasons).map((reason) => `tenant_permission:${reason}`),
    ...(auditAppendReady ? [] : ['boundary_audit_append_not_ready']),
    ...(lifecycle.enabled === false ? ['lifecycle_disabled'] : []),
    ...(lifecycle.controls?.operatorHold === true ? ['operator_hold'] : []),
    ...(lifecycle.dispatchReady === false ? ['lifecycle_dispatch_not_ready'] : []),
    ...(mutating && !descriptor.idempotencyKey ? ['missing_idempotency_key'] : []),
    ...(externalWrite && verifierRequired && !truthVerified ? ['verifier_evidence_required'] : []),
    ...(provider.serviceState === 'offline' ? ['provider_offline'] : []),
    ...(providerContinuity.holdExternalWrite === true ? ['provider_continuity_hold_external_write'] : []),
    ...(providerContinuity.queueOnly === true && lifecycle.requestedCommand === 'dispatch' ? ['provider_continuity_queue_only'] : []),
    ...(provider.capabilityNegotiation?.satisfied === false ? ['provider_capability_missing'] : []),
    ...providerMissing.map((capability) => `provider_missing:${capability}`),
    ...(provider.sync?.ready === false ? ['provider_sync_not_ready'] : []),
    ...(provider.lease?.restartSafe === false ? ['provider_lease_not_restart_safe'] : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_not_acknowledged'] : []),
    ...(providerEvidenceReady ? [] : ['provider_receipt_evidence_not_ready']),
    ...stableList(providerReceiptEvidence.missingEvidence).map((item) => `provider_evidence:${item}`),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance_required'] : []),
  ]);
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const state = blockedReasons.length > 0
    ? acceptanceRequired && !acceptanceAccepted && blockedReasons.every((reason) => reason === 'operator_acceptance_required')
      ? 'waiting_for_acceptance'
      : 'blocked'
    : warnings.length > 0
      ? 'ready_with_warnings'
      : externalWrite
        ? 'ready_to_dispatch'
        : 'ready_to_queue';
  const nextAction = state === 'ready_to_dispatch'
    ? 'dispatch-mailchimp-handoff'
    : state === 'ready_to_queue'
      ? 'queue-mailchimp-handoff'
      : state === 'ready_with_warnings'
        ? lifecycle.nextAction || 'review-mailchimp-handoff-warnings'
        : blockedReasons.includes('operator_acceptance_required')
          ? 'request_operator_acceptance'
          : blockedReasons.includes('provider_continuity_hold_external_write')
            ? providerContinuity.nextAction || 'hold_for_provider_recovery'
            : blockedReasons.includes('provider_continuity_queue_only')
              ? providerContinuity.nextAction || 'refresh_provider_contract'
          : blockedReasons.includes('provider_receipt_not_acknowledged')
            ? 'refresh_provider_receipt'
            : blockedReasons.includes('provider_receipt_evidence_not_ready')
              ? providerReceiptEvidence.nextAction || 'refresh_provider_receipt'
              : blockedReasons.includes('provider_lease_not_restart_safe')
                ? 'refresh_provider_lease'
                : blockedReasons.includes('provider_sync_not_ready')
                  ? 'refresh_provider_contract'
                  : blockedReasons.some((reason) => reason.startsWith('tenant_permission:') || reason === 'tenant_permission_decision_not_ready')
                    ? tenantPermissionDecisionBundle.nextAction || 'repair_tenant_permissions'
                  : blockedReasons.some((reason) => reason.startsWith('boundary:') || reason.startsWith('boundary_handoff:') || reason === 'tenant_boundary_denied' || reason === 'boundary_handoff_not_ready')
                    ? 'repair_tenant_permissions'
                    : blockedReasons.includes('boundary_audit_append_not_ready')
                      ? 'append_tenant_boundary_audit'
                    : lifecycle.nextAction || 'repair_mailchimp_dispatch_readiness';
  const readinessKey = `${descriptor.requestId || 'mailchimp:handoff'}:${state}:${stableHash(blockedReasons)}`
    .replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.adapter-dispatch-readiness.mailchimp.v1',
    readinessKey,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state,
    ready: state === 'ready_to_dispatch' || state === 'ready_to_queue' || state === 'ready_with_warnings',
    dispatchReady: state === 'ready_to_dispatch',
    queueReady: state === 'ready_to_queue' || state === 'ready_with_warnings',
    externalWrite,
    dryRun: descriptor.dryRun === true,
    nextAction,
    blockedReasons,
    warningCodes: warnings.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean).sort(),
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      token: compactString(acceptance.token || context.acceptanceToken),
    },
    gates: {
      diagnosticsClear: diagnosticErrors.length === 0,
      tenantBoundaryAllowed: boundary.allowed !== false,
      boundaryHandoffReady: boundaryTokenBlocked !== true,
      tenantPermissionDecisionReady: tenantPermissionDecisionBundle.ready === true,
      boundaryAuditAppendReady: auditAppendReady,
      lifecycleDispatchReady: lifecycle.dispatchReady === true,
      idempotencyPresent: !mutating || Boolean(descriptor.idempotencyKey),
      truthBoundaryVerified: !externalWrite || truthVerified,
      providerOnline: provider.serviceState !== 'offline',
      providerContinuityHealthy: providerContinuity.healthy !== false,
      providerCapabilitiesSatisfied: provider.capabilityNegotiation?.satisfied !== false,
      providerSyncReady: provider.sync?.ready !== false,
      providerLeaseRestartSafe: provider.lease?.restartSafe !== false,
      providerReceiptAcknowledged: !receiptRequired || receiptAcknowledged,
      providerReceiptEvidenceReady: providerEvidenceReady,
    },
    tenantPermissionDecisionBundle: {
      decisionKey: compactString(tenantPermissionDecisionBundle.decisionKey),
      status: compactString(tenantPermissionDecisionBundle.status || 'unknown'),
      ready: tenantPermissionDecisionBundle.ready === true,
      allowedForRuntime: tenantPermissionDecisionBundle.allowedForRuntime === true,
      externalWriteSuppressed: tenantPermissionDecisionBundle.externalWriteSuppressed === true,
      nextAction: compactString(tenantPermissionDecisionBundle.nextAction),
      requiredGrants: stableList(tenantPermissionDecisionBundle.requiredGrants),
      blockedReasons: stableList(tenantPermissionDecisionBundle.blockedReasons),
      audit: tenantPermissionDecisionBundle.audit || null,
      route: tenantPermissionDecisionBundle.route || null,
      clientPatch: tenantPermissionDecisionBundle.clientPatch || null,
    },
    providerReceiptEvidence: {
      evidenceKey: compactString(providerReceiptEvidence.evidenceKey),
      state: compactString(providerReceiptEvidence.state || 'unknown'),
      ready: providerEvidenceReady,
      restartSafe: providerReceiptEvidence.restartSafe !== false,
      nextAction: compactString(providerReceiptEvidence.nextAction),
      missingEvidence: stableList(providerReceiptEvidence.missingEvidence),
      route: providerReceiptEvidence.route || null,
      clientPatch: providerReceiptEvidence.clientPatch || null,
    },
    providerContinuity: {
      continuityKey: compactString(providerContinuity.continuityKey),
      mode: compactString(providerContinuity.mode || 'unknown'),
      healthy: providerContinuity.healthy === true,
      degraded: providerContinuity.degraded === true,
      retryable: providerContinuity.retry?.retryable === true,
      nextAction: compactString(providerContinuity.nextAction),
      retry: providerContinuity.retry || null,
      degradedReasons: stableList(providerContinuity.degradedReasons),
      clientPatch: providerContinuity.clientPatch || null,
    },
    boundaryHandoff: {
      boundaryKey: compactString(boundaryHandoff.boundaryKey),
      readyForRuntime: boundaryTokenBlocked !== true,
      requiresAuditAppend: auditAppendRequired,
      auditAppendReady,
      nextAction: compactString(boundaryHandoff.route?.nextAction || (auditAppendReady ? 'dispatch-mailchimp-handoff' : 'append_tenant_boundary_audit')),
      blockedReasons: stableList(boundaryHandoff.blockedReasons),
      audit: boundaryHandoff.audit || null,
    },
    route: {
      method: 'POST',
      path: `/mailchimp/handoffs/${encodeURIComponent(descriptor.requestId || 'preview')}/dispatch-readiness`,
      idempotencyKey: readinessKey,
      primaryAction: nextAction,
      requiredBodyKeys: acceptanceRequired ? ['acceptanceToken', 'accepted'] : ['requestId'],
    },
    validationSummary: {
      errors: diagnosticErrors.length,
      warnings: warnings.length,
      blocked: blockedReasons.length,
      providerMissingCapabilities: providerMissing.length,
      providerMissingEvidence: stableList(providerReceiptEvidence.missingEvidence).length,
      readyGates: Object.values({
        diagnosticsClear: diagnosticErrors.length === 0,
        tenantBoundaryAllowed: boundary.allowed !== false,
        lifecycleDispatchReady: lifecycle.dispatchReady === true,
        tenantPermissionDecisionReady: tenantPermissionDecisionBundle.ready === true,
        providerContinuityHealthy: providerContinuity.healthy !== false,
        providerCapabilitiesSatisfied: provider.capabilityNegotiation?.satisfied !== false,
        providerReceiptEvidenceReady: providerEvidenceReady,
      }).filter(Boolean).length,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: 'dedupe-by-dispatch-readiness-key',
      resumeFromReadinessKey: readinessKey,
      externalWritesPerformed: false,
    },
  };
}

function buildAdapterClientWorkflowHandoff(descriptor, readiness, command = {}, context = {}) {
  const blockedReasons = stableList([
    ...(Array.isArray(readiness.blockedReasons) ? readiness.blockedReasons : []),
    ...(Array.isArray(command.validationSummary?.blockedReasons) ? command.validationSummary.blockedReasons : []),
  ]);
  const acceptance = readiness.acceptance || command.acceptance || context.acceptance || {};
  const acceptanceRequired = acceptance.required === true;
  const acceptanceAccepted = acceptance.accepted === true;
  const provider = command.provider || descriptor.providerContract || {};
  const route = readiness.route || {};
  const repairState = readiness.ready === true
    ? readiness.dispatchReady === true
      ? 'dispatch_ready'
      : 'queue_ready'
    : acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_operator_acceptance'
      : blockedReasons.some((reason) => reason.includes('receipt'))
        ? 'waiting_for_provider_receipt'
        : blockedReasons.some((reason) => reason.includes('sync') || reason.includes('provider'))
          ? 'waiting_for_provider_refresh'
          : blockedReasons.some((reason) => reason.includes('boundary') || reason.includes('tenant') || reason.includes('workspace'))
            ? 'waiting_for_boundary_repair'
            : 'blocked';
  const nextAction = readiness.nextAction
    || command.submitAction
    || (repairState === 'waiting_for_operator_acceptance'
      ? 'request_operator_acceptance'
      : 'repair_mailchimp_dispatch_readiness');
  const resumeToken = stableList([
    descriptor.requestId || 'mailchimp:handoff',
    command.commandId || readiness.readinessKey,
    repairState,
    nextAction,
  ]).join(':');
  const operatorVisible = acceptanceRequired
    || blockedReasons.some((reason) => reason.includes('boundary') || reason.includes('denied'));
  const retryable = readiness.ready !== true
    && !operatorVisible
    && !blockedReasons.some((reason) => reason.includes('diagnostic:mailchimp.handoff.missing_idempotency'));
  const retryAfterMs = retryable
    ? repairState === 'waiting_for_provider_refresh' || repairState === 'waiting_for_provider_receipt'
      ? 30000
      : 10000
    : 0;

  return {
    protocol: 'aios.adapter-client-workflow-handoff.mailchimp.v1',
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state: repairState,
    ready: readiness.ready === true,
    dispatchReady: readiness.dispatchReady === true,
    queueReady: readiness.queueReady === true,
    routeState: readiness.ready === true ? 'ready' : acceptanceRequired && !acceptanceAccepted ? 'acceptance_required' : 'needs_attention',
    nextAction,
    resumeToken,
    statusRevision: stableHash({
      requestId: descriptor.requestId,
      commandId: command.commandId,
      readinessKey: readiness.readinessKey,
      repairState,
      blockedReasons,
    }),
    command: {
      commandId: compactString(command.commandId),
      requestedAction: compactString(command.requestedAction || readiness.nextAction),
      submitAction: compactString(command.submitAction || nextAction),
      idempotencyKey: compactString(command.idempotencyKey || route.idempotencyKey || readiness.readinessKey),
      restartSafe: command.restartSafe === true && readiness.restartSemantics?.replaySafe !== false,
      externalWrite: command.externalWrite === true || readiness.externalWrite === true,
    },
    provider: {
      service: compactString(provider.service || 'mailchimp-marketing'),
      state: compactString(provider.state || provider.serviceState || 'unknown'),
      nextAction: compactString(provider.nextAction || nextAction),
      externalHandoffState: compactString(provider.externalHandoffState || provider.externalHandoff?.state || 'local_only'),
      externalRequestId: compactString(provider.externalRequestId || provider.externalHandoff?.requestId),
      restartSafe: provider.restartSafe !== false && descriptor.providerContract?.lease?.restartSafe !== false,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: compactString(acceptance.token || context.acceptanceToken),
      reason: compactString(acceptance.reason || (acceptanceRequired ? 'operator_acceptance_required' : '')),
    },
    retry: {
      retryable,
      retryAfterMs,
      maxAttempts: retryable ? 3 : 0,
      nextAction,
    },
    blockedReasons,
    clientPatch: {
      adapterClientWorkflowState: repairState,
      adapterClientWorkflowNextAction: nextAction,
      adapterClientWorkflowResumeToken: resumeToken,
      adapterClientWorkflowRetryAfterMs: retryAfterMs,
      adapterClientWorkflowOperatorVisible: operatorVisible,
    },
    exportRow: {
      artifactName: 'adapter-client-workflow-handoff.json',
      rowId: `${resumeToken}:adapter-workflow`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      status: repairState,
      nextAction,
      readyForExport: true,
      blockedReasons,
    },
    restartSemantics: {
      replaySafe: readiness.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: 'dedupe-by-adapter-client-workflow-resume-token',
      resumeFromWorkflowToken: resumeToken,
      externalWritesPerformed: false,
    },
  };
}

function summarizeCommandDiagnostics(diagnostics = []) {
  const normalized = Array.isArray(diagnostics) ? diagnostics : [];
  const errors = normalized.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = normalized.filter((diagnostic) => diagnostic.severity === 'warning');
  return {
    total: normalized.length,
    errors: errors.length,
    warnings: warnings.length,
    blockingCodes: errors.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean).sort(),
    warningCodes: warnings.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean).sort(),
  };
}

function buildLifecycleCommandCheckpoint(descriptor, command = {}, readiness = {}, context = {}) {
  const lifecycle = descriptor.lifecycle || {};
  const schedule = lifecycle.schedule || {};
  const controls = lifecycle.controls || {};
  const provider = command.provider || descriptor.providerContract || {};
  const boundary = descriptor.boundaryHandoff || descriptor.boundaryContract || {};
  const requestedCommand = compactString(command.requestedAction || lifecycle.requestedCommand || readiness.nextAction || 'queue');
  const submitAction = compactString(command.submitAction || readiness.nextAction || requestedCommand);
  const idempotencyKey = compactString(
    command.idempotencyKey
      || context.idempotencyKey
      || descriptor.idempotencyKey
      || readiness.readinessKey
      || `${descriptor.requestId || 'mailchimp:handoff'}:${requestedCommand}`,
  );
  const externalWrite = command.externalWrite === true
    || readiness.externalWrite === true
    || descriptor.truthBoundary?.externalWritesAllowed === true;
  const disabled = lifecycle.enabled === false || controls.operatorHold === true;
  const blockedReasons = stableList([
    ...(Array.isArray(command.validationSummary?.blockedReasons) ? command.validationSummary.blockedReasons : []),
    ...(Array.isArray(readiness.blockedReasons) ? readiness.blockedReasons : []),
    ...(lifecycle.dispatchReady === false && ['dispatch', 'resume'].includes(requestedCommand)
      ? ['lifecycle_dispatch_not_ready']
      : []),
    ...(disabled ? [lifecycle.enabled === false ? 'lifecycle_disabled' : 'operator_hold'] : []),
    ...(externalWrite && !idempotencyKey ? ['missing_idempotency_key'] : []),
    ...(externalWrite && provider.lease?.restartSafe === false ? ['provider_lease_not_restart_safe'] : []),
    ...(externalWrite && provider.externalHandoff?.receiptRequired === true && provider.externalHandoff?.receiptAcknowledged !== true
      ? ['provider_receipt_not_acknowledged']
      : []),
    ...(boundary.readyForRuntime === false ? ['boundary_handoff_not_ready'] : []),
    ...(boundary.requiresAuditAppend === true && boundary.auditAppendReady !== true ? ['boundary_audit_append_not_ready'] : []),
  ]);
  const acknowledgedCommands = stableList(
    context.acknowledgedCommands
      || context.acknowledgedCommandIds
      || context.client?.acknowledgedCommands
      || context.clientState?.acknowledgedCommands,
  );
  const acknowledged = acknowledgedCommands.includes(idempotencyKey)
    || acknowledgedCommands.includes(command.commandId)
    || context.commandAcknowledged === true;
  const restartSafe = Boolean(idempotencyKey)
    && command.restartSafe !== false
    && blockedReasons.length === 0
    && (externalWrite ? provider.lease?.restartSafe !== false : true);
  const state = blockedReasons.length > 0
    ? disabled
      ? 'held'
      : 'blocked'
    : acknowledged
      ? 'acknowledged'
      : ['dispatch', 'resume'].includes(submitAction)
        ? 'ready_to_submit'
        : 'ready_to_queue';
  const checkpointKey = stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    requestedCommand,
    submitAction,
    idempotencyKey,
    blockedReasons,
  });

  return {
    protocol: 'aios.adapter-lifecycle-command-checkpoint.mailchimp.v1',
    checkpointKey: `mailchimp-lifecycle-command:${checkpointKey}`,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state,
    requestedCommand,
    submitAction,
    idempotencyKey,
    commandId: compactString(command.commandId),
    acknowledged,
    restartSafe,
    replaySafe: restartSafe && acknowledged !== false,
    externalWrite,
    dryRun: descriptor.dryRun === true,
    blockedReasons,
    schedule: {
      mode: compactString(schedule.mode || 'manual'),
      runAt: compactString(schedule.runAt),
      timezone: compactString(schedule.timezone || 'UTC') || 'UTC',
      cooldownSeconds: positiveInteger(schedule.cooldownSeconds, 0),
    },
    controls: {
      enabled: lifecycle.enabled !== false,
      operatorHold: controls.operatorHold === true,
      canEnable: lifecycle.controls?.canEnable !== false,
      canDisable: lifecycle.controls?.canDisable !== false,
      canSubmit: blockedReasons.length === 0 && state !== 'held',
      canAcknowledge: Boolean(idempotencyKey) && state !== 'acknowledged',
      canReplay: restartSafe,
    },
    provider: {
      service: compactString(provider.service || 'mailchimp-marketing'),
      state: compactString(provider.state || provider.serviceState || 'unknown'),
      externalHandoffState: compactString(provider.externalHandoffState || provider.externalHandoff?.state || 'local_only'),
      externalRequestId: compactString(provider.externalRequestId || provider.externalHandoff?.requestId),
      restartSafe: provider.restartSafe !== false && provider.lease?.restartSafe !== false,
    },
    nextAction: state === 'acknowledged'
      ? 'observe'
      : blockedReasons.includes('provider_receipt_not_acknowledged')
        ? 'refresh_provider_receipt'
        : blockedReasons.includes('provider_lease_not_restart_safe')
          ? 'refresh_provider_lease'
          : blockedReasons.some((reason) => reason.includes('boundary'))
            ? 'repair_tenant_permissions'
            : state === 'held'
              ? 'await_lifecycle_release'
              : submitAction,
    clientPatch: {
      lifecycleCommandCheckpointKey: `mailchimp-lifecycle-command:${checkpointKey}`,
      lifecycleCommandState: state,
      lifecycleCommandNextAction: state === 'acknowledged' ? 'observe' : submitAction,
      lifecycleCommandRestartSafe: restartSafe,
      lifecycleCommandBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: restartSafe,
      duplicateCommandPolicy: 'dedupe-by-lifecycle-command-checkpoint',
      resumeFromCommandCheckpoint: `mailchimp-lifecycle-command:${checkpointKey}`,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpAdapterDispatchReadiness(input = {}, context = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const readiness = buildDispatchReadinessContract(descriptor, context);
  const checkpoint = buildLifecycleCommandCheckpoint(descriptor, descriptor.clientCommand || {}, readiness, context);
  return {
    ...readiness,
    lifecycleCommandCheckpoint: checkpoint,
    clientWorkflowHandoff: buildAdapterClientWorkflowHandoff(descriptor, readiness, descriptor.clientCommand || {}, context),
  };
}

export function buildMailchimpTenantPermissionDecisionBundle(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const runtimeBoundary = runtime.boundary && typeof runtime.boundary === 'object' ? runtime.boundary : {};
  const observedWorkspace = compactString(runtime.workspace || runtime.workspaceId || runtimeBoundary.workspace);
  const handoffView = {
    tenant: compactString(runtime.tenant || descriptor.tenant),
    workspace: observedWorkspace || descriptor.boundaryContract?.workspace,
    workspaceId: observedWorkspace || descriptor.boundaryContract?.workspace,
    action: descriptor.action,
    dryRun: descriptor.dryRun === true,
  };
  const boundaryContract = {
    ...(descriptor.boundaryContract || {}),
    ...(observedWorkspace ? { workspace: descriptor.boundaryContract?.workspace || observedWorkspace } : {}),
  };
  return buildTenantPermissionDecisionBundle(
    boundaryContract,
    descriptor.boundaryHandoff || {},
    handoffView,
    descriptor.providerContract || {},
    descriptor.lifecycle || {},
  );
}

export function buildMailchimpAdapterClientWorkflowStatus(input = {}, context = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const dispatchReadiness = context.dispatchReadiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
    ? context.dispatchReadiness
    : buildMailchimpAdapterDispatchReadiness(descriptor, context);
  const workflow = context.clientWorkflowHandoff && typeof context.clientWorkflowHandoff === 'object'
    ? context.clientWorkflowHandoff
    : dispatchReadiness.clientWorkflowHandoff || {};
  const lifecycleCheckpoint = context.lifecycleCommandCheckpoint
    || dispatchReadiness.lifecycleCommandCheckpoint
    || {};
  const providerContinuity = descriptor.providerContinuity || dispatchReadiness.providerContinuity || {};
  const providerEvidence = descriptor.providerReceiptEvidence || dispatchReadiness.providerReceiptEvidence || {};
  const boundaryHandoff = descriptor.boundaryHandoff || dispatchReadiness.boundaryHandoff || {};
  const tenantPermissionDecisionBundle = descriptor.tenantPermissionDecisionBundle
    || dispatchReadiness.tenantPermissionDecisionBundle
    || buildMailchimpTenantPermissionDecisionBundle(descriptor, context);
  const acceptance = workflow.acceptance || dispatchReadiness.acceptance || context.acceptance || {};
  const blockedReasons = stableList([
    ...stableList(dispatchReadiness.blockedReasons).map((reason) => `dispatch:${reason}`),
    ...stableList(workflow.blockedReasons).map((reason) => `workflow:${reason}`),
    ...stableList(lifecycleCheckpoint.blockedReasons).map((reason) => `lifecycle:${reason}`),
    ...(providerContinuity.holdExternalWrite === true ? ['provider:continuity_hold'] : []),
    ...(providerEvidence.ready === false ? ['provider:receipt_evidence_not_ready'] : []),
    ...stableList(providerEvidence.missingEvidence).map((reason) => `provider_evidence:${reason}`),
    ...(boundaryHandoff.readyForRuntime === false ? ['boundary:handoff_not_ready'] : []),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `boundary:${reason}`),
    ...(tenantPermissionDecisionBundle.ready === false ? ['permission:decision_not_ready'] : []),
    ...stableList(tenantPermissionDecisionBundle.blockedReasons).map((reason) => `permission:${reason}`),
    ...(acceptance.required === true && acceptance.accepted !== true ? ['client:acceptance_required'] : []),
  ]);
  const retryableReasons = blockedReasons.filter((reason) => (
    reason.includes('provider')
      || reason.includes('receipt')
      || reason.includes('sync')
      || reason.includes('lifecycle')
      || reason.includes('acceptance')
  ));
  const readyForRuntime = dispatchReadiness.dispatchReady === true
    && blockedReasons.length === 0
    && workflow.ready !== false;
  const readyForClient = dispatchReadiness.ready === true
    && blockedReasons.every((reason) => reason === 'client:acceptance_required');
  const state = readyForRuntime
    ? 'ready_for_runtime'
    : readyForClient
      ? 'waiting_for_client_acceptance'
      : providerContinuity.holdExternalWrite === true
        ? 'held_for_provider_recovery'
        : blockedReasons.length > 0
          ? 'client_action_required'
          : 'queued';
  const nextAction = state === 'ready_for_runtime'
    ? dispatchReadiness.nextAction || 'dispatch-mailchimp-handoff'
    : state === 'waiting_for_client_acceptance'
      ? 'request_operator_acceptance'
      : providerContinuity.holdExternalWrite === true
        ? providerContinuity.nextAction || 'hold_for_provider_recovery'
        : providerEvidence.ready === false
          ? providerEvidence.nextAction || 'refresh_provider_receipt'
          : tenantPermissionDecisionBundle.ready === false
            ? tenantPermissionDecisionBundle.nextAction || 'repair_tenant_permissions'
          : boundaryHandoff.readyForRuntime === false
            ? boundaryHandoff.nextAction || 'repair_tenant_permissions'
            : workflow.nextAction || dispatchReadiness.nextAction || lifecycleCheckpoint.nextAction || 'repair_mailchimp_dispatch_readiness';
  const statusKey = `mailchimp-client-workflow:${stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    state,
    blockedReasons,
    readinessKey: dispatchReadiness.readinessKey,
  })}`;

  return {
    protocol: 'aios.adapter-client-workflow-status.mailchimp.v1',
    statusKey,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state,
    readyForClient,
    readyForRuntime,
    dispatchReady: dispatchReadiness.dispatchReady === true,
    queueReady: dispatchReadiness.queueReady === true,
    nextAction,
    blockedReasons,
    tenantPermissionDecisionBundle: {
      decisionKey: compactString(tenantPermissionDecisionBundle.decisionKey),
      status: compactString(tenantPermissionDecisionBundle.status || 'unknown'),
      ready: tenantPermissionDecisionBundle.ready === true,
      allowedForRuntime: tenantPermissionDecisionBundle.allowedForRuntime === true,
      nextAction: compactString(tenantPermissionDecisionBundle.nextAction),
      blockedReasons: stableList(tenantPermissionDecisionBundle.blockedReasons),
      audit: tenantPermissionDecisionBundle.audit || null,
    },
    retry: {
      retryable: retryableReasons.length > 0 && providerContinuity.holdExternalWrite !== true,
      retryAfterMs: Number(providerContinuity.retry?.retryAfterMs || workflow.retry?.retryAfterMs || 0),
      maxAttempts: Number(providerContinuity.retry?.maxAttempts || workflow.retry?.maxAttempts || 0),
      nextAction,
      exhausted: workflow.retry?.exhausted === true,
    },
    counters: {
      blockedReasons: blockedReasons.length,
      retryableReasons: retryableReasons.length,
      providerMissingEvidence: stableList(providerEvidence.missingEvidence).length,
      lifecycleBlockedReasons: stableList(lifecycleCheckpoint.blockedReasons).length,
      boundaryBlockedReasons: stableList(boundaryHandoff.blockedReasons).length,
    },
    gates: {
      dispatchReadiness: dispatchReadiness.ready === true,
      lifecycleCommandRestartSafe: lifecycleCheckpoint.restartSafe !== false,
      providerContinuityHealthy: providerContinuity.healthy === true,
      providerEvidenceReady: providerEvidence.ready !== false,
      boundaryReady: boundaryHandoff.readyForRuntime !== false,
      acceptanceSatisfied: acceptance.required !== true || acceptance.accepted === true,
    },
    route: {
      target: 'adapter-client-workflow-status',
      method: 'POST',
      path: `/mailchimp/handoffs/${encodeURIComponent(descriptor.requestId || 'preview')}/client-workflow-status`,
      idempotencyKey: statusKey,
      primaryAction: nextAction,
      requiredBodyKeys: acceptance.required === true && acceptance.accepted !== true
        ? ['statusKey', 'acceptanceToken', 'accepted']
        : ['statusKey', 'requestId'],
    },
    clientPatch: {
      adapterClientWorkflowStatusKey: statusKey,
      adapterClientWorkflowStatusState: state,
      adapterClientWorkflowReadyForClient: readyForClient,
      adapterClientWorkflowReadyForRuntime: readyForRuntime,
      adapterClientWorkflowNextAction: nextAction,
      adapterClientWorkflowBlockedReasons: blockedReasons,
      adapterClientWorkflowRetryable: retryableReasons.length > 0 && providerContinuity.holdExternalWrite !== true,
    },
    exportRow: {
      artifactName: 'adapter-client-workflow-status.json',
      rowId: `${statusKey}:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      status: state,
      nextAction,
      readyForExport: true,
      blockedReasons,
    },
    restartSemantics: {
      replaySafe: readyForRuntime || state === 'waiting_for_client_acceptance',
      duplicateCommandPolicy: 'dedupe-by-adapter-client-workflow-status-key',
      resumeFromClientWorkflowStatusKey: statusKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpAdapterNextStepHandoff(input = {}, context = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const dispatchReadiness = context.dispatchReadiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
    ? context.dispatchReadiness
    : descriptor.adapterDispatchReadiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
      ? descriptor.adapterDispatchReadiness
      : buildMailchimpAdapterDispatchReadiness(descriptor, context);
  const workflowStatus = context.workflowStatus?.protocol === 'aios.adapter-client-workflow-status.mailchimp.v1'
    ? context.workflowStatus
    : buildMailchimpAdapterClientWorkflowStatus(descriptor, {
      ...context,
      dispatchReadiness,
    });
  const clientCommand = context.clientCommand?.protocol === 'aios.adapter-client-command.mailchimp.v1'
    ? context.clientCommand
    : descriptor.clientCommand?.protocol === 'aios.adapter-client-command.mailchimp.v1'
      ? descriptor.clientCommand
      : buildMailchimpAdapterClientCommand(descriptor, {
        ...context,
        dispatchReadiness,
      });
  const lifecycleCheckpoint = dispatchReadiness.lifecycleCommandCheckpoint
    || clientCommand.lifecycleCommandCheckpoint
    || {};
  const providerEvidence = descriptor.providerReceiptEvidence
    || dispatchReadiness.providerReceiptEvidence
    || clientCommand.providerReceiptEvidence
    || {};
  const providerContinuity = descriptor.providerContinuity
    || dispatchReadiness.providerContinuity
    || {};
  const tenantDecision = descriptor.tenantPermissionDecisionBundle
    || dispatchReadiness.tenantPermissionDecisionBundle
    || workflowStatus.tenantPermissionDecisionBundle
    || {};
  const boundaryHandoff = descriptor.boundaryHandoff || workflowStatus.boundaryHandoff || {};
  const acceptance = workflowStatus.acceptance
    || dispatchReadiness.acceptance
    || clientCommand.acceptance
    || context.acceptance
    || {};
  const blockedReasons = stableList([
    ...stableList(dispatchReadiness.blockedReasons).map((reason) => `dispatch:${reason}`),
    ...stableList(workflowStatus.blockedReasons).map((reason) => `workflow:${reason}`),
    ...stableList(clientCommand.validationSummary?.blockedReasons).map((reason) => `command:${reason}`),
    ...stableList(lifecycleCheckpoint.blockedReasons).map((reason) => `lifecycle:${reason}`),
    ...(providerEvidence.ready === false ? ['provider:receipt_evidence_not_ready'] : []),
    ...stableList(providerEvidence.missingEvidence).map((reason) => `provider_evidence:${reason}`),
    ...(providerContinuity.holdExternalWrite === true ? ['provider:continuity_hold'] : []),
    ...(tenantDecision.ready === false ? ['tenant_permission:decision_not_ready'] : []),
    ...stableList(tenantDecision.blockedReasons).map((reason) => `tenant_permission:${reason}`),
    ...(boundaryHandoff.readyForRuntime === false ? ['boundary:handoff_not_ready'] : []),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `boundary:${reason}`),
    ...(acceptance.required === true && acceptance.accepted !== true ? ['acceptance:operator_required'] : []),
  ]);
  const recoveryCommands = stableList([
    ...(blockedReasons.some((reason) => reason.includes('provider') || reason.includes('receipt'))
      ? [providerEvidence.nextAction || providerContinuity.nextAction || 'refresh_provider_receipt']
      : []),
    ...(blockedReasons.some((reason) => reason.includes('tenant_permission') || reason.includes('boundary'))
      ? [tenantDecision.nextAction || boundaryHandoff.route?.nextAction || 'repair_tenant_permissions']
      : []),
    ...(blockedReasons.some((reason) => reason.includes('lifecycle'))
      ? [lifecycleCheckpoint.nextAction || descriptor.lifecycleControlSummary?.nextAction || 'repair_lifecycle_settings']
      : []),
    ...(acceptance.required === true && acceptance.accepted !== true ? ['request_operator_acceptance'] : []),
  ]);
  const readyForRuntime = dispatchReadiness.dispatchReady === true
    && workflowStatus.readyForRuntime === true
    && blockedReasons.length === 0;
  const readyForClient = workflowStatus.readyForClient === true
    || (dispatchReadiness.ready === true && blockedReasons.every((reason) => reason === 'acceptance:operator_required'));
  const routeState = readyForRuntime
    ? 'ready_for_runtime'
    : readyForClient
      ? 'client_acceptance_required'
      : providerContinuity.holdExternalWrite === true
        ? 'provider_hold'
        : blockedReasons.length
          ? 'needs_attention'
          : 'queued';
  const primaryAction = readyForRuntime
    ? dispatchReadiness.nextAction || clientCommand.submitAction || 'dispatch-mailchimp-handoff'
    : routeState === 'client_acceptance_required'
      ? 'request_operator_acceptance'
      : recoveryCommands[0] || workflowStatus.nextAction || clientCommand.submitAction || dispatchReadiness.nextAction || 'inspect_mailchimp_handoff';
  const handoffKey = `mailchimp-next-step:${stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    routeState,
    readinessKey: dispatchReadiness.readinessKey,
    blockedReasons,
  })}`;

  return {
    protocol: 'aios.adapter-next-step-handoff.mailchimp.v1',
    handoffKey,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state: routeState,
    readyForRuntime,
    readyForClient,
    primaryAction,
    recoveryCommands,
    blockedReasons,
    readiness: {
      key: compactString(dispatchReadiness.readinessKey),
      state: compactString(dispatchReadiness.state),
      ready: dispatchReadiness.ready === true,
      dispatchReady: dispatchReadiness.dispatchReady === true,
      queueReady: dispatchReadiness.queueReady === true,
      nextAction: compactString(dispatchReadiness.nextAction),
    },
    acceptance: {
      required: acceptance.required === true,
      accepted: acceptance.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      token: compactString(acceptance.token || context.acceptanceToken),
      nextAction: acceptance.required === true && acceptance.accepted !== true
        ? 'request_operator_acceptance'
        : 'observe',
    },
    provider: {
      continuityMode: compactString(providerContinuity.mode || 'unknown'),
      continuityHealthy: providerContinuity.healthy === true,
      receiptEvidenceState: compactString(providerEvidence.state || 'unknown'),
      receiptEvidenceReady: providerEvidence.ready !== false,
      nextAction: compactString(providerEvidence.nextAction || providerContinuity.nextAction || 'observe'),
      missingEvidence: stableList(providerEvidence.missingEvidence),
      externalHandoffState: compactString(descriptor.externalHandoff?.state || 'local_only'),
      externalRequestId: compactString(descriptor.externalHandoff?.requestId),
    },
    tenantPermission: {
      decisionKey: compactString(tenantDecision.decisionKey),
      status: compactString(tenantDecision.status || 'unknown'),
      ready: tenantDecision.ready === true,
      nextAction: compactString(tenantDecision.nextAction || boundaryHandoff.route?.nextAction || 'observe'),
      blockedReasons: stableList(tenantDecision.blockedReasons),
      auditRequired: tenantDecision.audit?.required === true || boundaryHandoff.requiresAuditAppend === true,
      auditReady: tenantDecision.audit?.ready === true || boundaryHandoff.auditAppendReady === true,
    },
    lifecycle: {
      requestedCommand: compactString(descriptor.lifecycle?.requestedCommand || lifecycleCheckpoint.requestedCommand),
      checkpointKey: compactString(lifecycleCheckpoint.checkpointKey),
      state: compactString(lifecycleCheckpoint.state || descriptor.lifecycleControlSummary?.state || 'unknown'),
      restartSafe: lifecycleCheckpoint.restartSafe !== false,
      nextAction: compactString(lifecycleCheckpoint.nextAction || descriptor.lifecycleControlSummary?.nextAction || 'observe'),
      blockedReasons: stableList(lifecycleCheckpoint.blockedReasons),
    },
    route: {
      target: 'adapter-next-step-handoff',
      method: 'POST',
      path: `/mailchimp/handoffs/${encodeURIComponent(descriptor.requestId || 'preview')}/next-step`,
      state: routeState,
      primaryAction,
      idempotencyKey: handoffKey,
      requiredBodyKeys: routeState === 'client_acceptance_required'
        ? ['handoffKey', 'acceptanceToken', 'accepted']
        : ['handoffKey', 'requestId'],
      explainable: true,
    },
    clientPatch: {
      adapterNextStepHandoffKey: handoffKey,
      adapterNextStepState: routeState,
      adapterNextStepReadyForRuntime: readyForRuntime,
      adapterNextStepReadyForClient: readyForClient,
      adapterNextStepPrimaryAction: primaryAction,
      adapterNextStepBlockedReasons: blockedReasons,
      adapterNextStepRecoveryCommands: recoveryCommands,
    },
    validationSummary: {
      ready: readyForRuntime,
      blocking: blockedReasons.length,
      blockedReasons,
      recoveryCommands: recoveryCommands.length,
      acceptanceRequired: acceptance.required === true && acceptance.accepted !== true,
    },
    restartSemantics: {
      replaySafe: readyForRuntime || routeState === 'client_acceptance_required',
      duplicateCommandPolicy: 'dedupe-by-adapter-next-step-handoff-key',
      resumeFromNextStepHandoffKey: handoffKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpAdapterClientCommand(input = {}, context = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' || (input?.lifecycle && input?.providerContract)
    ? input
    : compileMailchimpAdapterHandoff(input);
  const lifecycle = descriptor.lifecycle || {};
  const providerContract = context.providerContract || descriptor.providerContract || {};
  const providerServiceContract = context.providerServiceContract || {};
  const readiness = context.readiness || {};
  const acceptance = readiness.acceptance || context.acceptance || {};
  const externalHandoff = descriptor.externalHandoff || providerContract.externalHandoff || {};
  const boundaryHandoff = descriptor.boundaryHandoff || {};
  const providerReceiptEvidence = descriptor.providerReceiptEvidence || context.providerReceiptEvidence || {};
  const requestedAction = compactString(
    context.requestedAction
      || lifecycle.nextAction
      || lifecycle.requestedCommand
      || readiness.nextStep
      || 'queue',
  );
  const diagnosticsSummary = summarizeCommandDiagnostics(descriptor.diagnostics || []);
  const blockedReasons = stableList([
    ...((descriptor.diagnostics || [])
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code)),
    ...((readiness.validation || [])
      .filter((item) => item.ok === false)
      .map((item) => item.code)),
    ...(Array.isArray(providerServiceContract.blockedReasons) ? providerServiceContract.blockedReasons : []),
    ...(Array.isArray(descriptor.boundaryContract?.blockedReasons) ? descriptor.boundaryContract.blockedReasons : []),
    ...(boundaryHandoff.readyForRuntime === false ? ['boundary_handoff_not_ready'] : []),
    ...stableList(boundaryHandoff.blockedReasons).map((reason) => `boundary_handoff:${reason}`),
    ...(boundaryHandoff.requiresAuditAppend === true && boundaryHandoff.auditAppendReady !== true
      ? ['boundary_audit_append_not_ready']
      : []),
    ...(providerReceiptEvidence.ready === false ? ['provider_receipt_evidence_not_ready'] : []),
    ...stableList(providerReceiptEvidence.missingEvidence).map((item) => `provider_evidence:${item}`),
    ...(lifecycle.dispatchReady === false && requestedAction === 'dispatch' ? ['lifecycle_dispatch_not_ready'] : []),
    ...(acceptance.required === true && acceptance.accepted !== true ? ['operator_acceptance_required'] : []),
  ]);
  const externalWrite = descriptor.truthBoundary?.externalWritesAllowed === true;
  const providerRestartSafe = providerServiceContract.restartSafe !== false
    && providerContract.lease?.restartSafe !== false;
  const idempotencyKey = compactString(
    context.idempotencyKey
      || descriptor.idempotencyKey
      || `${descriptor.requestId || 'mailchimp:handoff'}:${requestedAction}`,
  );
  const commandId = `mailchimp-command:${stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    requestedAction,
    idempotencyKey,
    externalRequestId: externalHandoff.requestId || providerContract.externalRequestId,
  })}`;
  const state = blockedReasons.length > 0
    ? acceptance.required === true && acceptance.accepted !== true
      ? 'acceptance_required'
      : 'blocked'
    : readiness.ready === false
      ? 'preview'
      : externalWrite
        ? 'ready_to_dispatch'
        : 'ready_to_queue';
  const submitAction = state === 'blocked'
    ? compactString(providerServiceContract.nextAction || readiness.nextStep || 'inspect_handoff')
    : state === 'acceptance_required'
      ? 'request_operator_acceptance'
      : requestedAction;

  const command = {
    protocol: 'aios.adapter-client-command.mailchimp.v1',
    commandId,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state,
    requestedAction,
    submitAction,
    idempotencyKey,
    restartSafe: providerRestartSafe && Boolean(idempotencyKey) && state !== 'blocked',
    externalWrite,
    dryRun: descriptor.dryRun === true,
    routeState: state === 'ready_to_dispatch' || state === 'ready_to_queue' ? 'ready' : state,
    validationSummary: {
      ready: blockedReasons.length === 0,
      blockedReasons,
      diagnostics: diagnosticsSummary,
      providerState: compactString(providerServiceContract.state || providerContract.serviceState || 'unknown'),
      readinessStep: compactString(readiness.nextStep),
      providerEvidenceMissing: stableList(providerReceiptEvidence.missingEvidence),
    },
    acceptance: {
      required: acceptance.required === true,
      accepted: acceptance.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      reason: compactString(acceptance.reason),
    },
    provider: {
      service: compactString(providerServiceContract.service || providerContract.service || 'mailchimp-marketing'),
      state: compactString(providerServiceContract.state || providerContract.serviceState || 'unknown'),
      nextAction: compactString(providerServiceContract.nextAction || 'observe'),
      externalHandoffState: compactString(externalHandoff.state || providerContract.externalHandoffState || 'local_only'),
      externalRequestId: compactString(externalHandoff.requestId || providerContract.externalRequestId),
      restartSafe: providerRestartSafe,
    },
    providerReceiptEvidence: {
      evidenceKey: compactString(providerReceiptEvidence.evidenceKey),
      state: compactString(providerReceiptEvidence.state || 'unknown'),
      ready: providerReceiptEvidence.ready !== false,
      restartSafe: providerReceiptEvidence.restartSafe !== false,
      nextAction: compactString(providerReceiptEvidence.nextAction),
      missingEvidence: stableList(providerReceiptEvidence.missingEvidence),
      route: providerReceiptEvidence.route || null,
    },
    boundaryHandoff: {
      boundaryKey: compactString(boundaryHandoff.boundaryKey),
      readyForRuntime: boundaryHandoff.readyForRuntime !== false,
      requiresAuditAppend: boundaryHandoff.requiresAuditAppend === true,
      auditAppendReady: boundaryHandoff.auditAppendReady === true,
      nextAction: compactString(boundaryHandoff.route?.nextAction || 'observe'),
      blockedReasons: stableList(boundaryHandoff.blockedReasons),
    },
    preview: {
      title: `Mailchimp ${descriptor.action || 'handoff'} command`,
      primaryAction: submitAction,
      secondaryAction: externalWrite ? 'preview_external_write' : 'preview_local_handoff',
      explains: blockedReasons.length === 0
        ? 'Command can be resumed with the same idempotency key after status refresh.'
        : 'Command is held until blocked validation items are resolved.',
    },
  };
  const dispatchReadiness = buildDispatchReadinessContract(descriptor, {
    ...context,
    acceptance,
  });
  const lifecycleCommandCheckpoint = buildLifecycleCommandCheckpoint(
    descriptor,
    command,
    dispatchReadiness,
    context,
  );
  const persistedCommandEvidence = buildMailchimpAdapterPersistedCommandEvidence(
    descriptor,
    command,
    dispatchReadiness,
    context,
  );
  return {
    ...command,
    persistedCommandEvidence,
    lifecycleCommandCheckpoint,
    clientWorkflowHandoff: buildAdapterClientWorkflowHandoff(descriptor, dispatchReadiness, command, context),
  };
}

export function buildMailchimpAdapterPersistedCommandEvidence(
  input = {},
  command = {},
  readiness = {},
  context = {},
) {
  const descriptor = input?.type === 'KernelJobDescriptor' || (input?.lifecycle && input?.providerContract)
    ? input
    : compileMailchimpAdapterHandoff(input);
  const sourceCommand = command?.protocol === 'aios.adapter-client-command.mailchimp.v1'
    ? command
    : buildMailchimpAdapterClientCommand(descriptor, context);
  const sourceReadiness = readiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
    ? readiness
    : buildDispatchReadinessContract(descriptor, context);
  const history = normalizeHistoryEvents(context.history || context.events || []);
  const latest = latestHistoryEvent(history);
  const persistedReceipt = context.persistedReceipt && typeof context.persistedReceipt === 'object'
    ? context.persistedReceipt
    : context.receipt && typeof context.receipt === 'object'
      ? context.receipt
      : {};
  const externalRequestId = compactString(
    sourceCommand.provider?.externalRequestId
      || sourceReadiness.provider?.externalRequestId
      || descriptor.providerContract?.externalHandoff?.requestId
      || descriptor.externalHandoff?.requestId,
  );
  const receiptId = compactString(
    persistedReceipt.receiptId
      || persistedReceipt.id
      || sourceCommand.providerReceiptEvidence?.receiptId
      || sourceReadiness.providerReceiptEvidence?.receipt?.receiptId,
  );
  const commandKey = compactString(sourceCommand.idempotencyKey || descriptor.idempotencyKey)
    || `${descriptor.requestId || 'mailchimp:handoff'}:${sourceCommand.submitAction || sourceCommand.requestedAction || 'queue'}`;
  const evidenceKey = `mailchimp-persisted-command:${stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    commandId: sourceCommand.commandId,
    commandKey,
    externalRequestId,
    receiptId,
  })}`;
  const blockedReasons = stableList([
    ...(sourceCommand.restartSafe === false ? ['client_command_not_restart_safe'] : []),
    ...stableList(sourceCommand.validationSummary?.blockedReasons).map((reason) => `client_command:${reason}`),
    ...(sourceReadiness.ready === false ? ['dispatch_readiness_not_ready'] : []),
    ...stableList(sourceReadiness.blockedReasons).map((reason) => `dispatch:${reason}`),
    ...(sourceCommand.acceptance?.required === true && sourceCommand.acceptance?.accepted !== true
      ? ['operator_acceptance_required']
      : []),
    ...(sourceCommand.externalWrite === true && !externalRequestId && descriptor.dryRun !== true
      ? ['external_handoff_request_missing']
      : []),
    ...(sourceCommand.providerReceiptEvidence?.restartSafe === false ? ['provider_receipt_evidence_not_restart_safe'] : []),
    ...stableList(sourceCommand.providerReceiptEvidence?.missingEvidence).map((item) => `provider_evidence:${item}`),
  ]);
  const acknowledged = receiptId.length > 0
    || persistedReceipt.acknowledged === true
    || persistedReceipt.status === 'succeeded'
    || persistedReceipt.state === 'acknowledged';
  const state = blockedReasons.length > 0
    ? sourceCommand.acceptance?.required === true && sourceCommand.acceptance?.accepted !== true
      ? 'waiting_for_acceptance'
      : 'blocked'
    : acknowledged
      ? 'acknowledged'
      : sourceCommand.state === 'ready_to_dispatch'
        ? 'ready_to_dispatch'
        : 'ready_to_queue';
  const replaySafe = blockedReasons.length === 0
    && sourceCommand.restartSafe !== false
    && sourceReadiness.restartSemantics?.replaySafe !== false;
  const nextAction = state === 'acknowledged'
    ? 'observe_persisted_command'
    : state === 'blocked'
      ? blockedReasons.includes('external_handoff_request_missing')
        ? 'relink_external_handoff'
        : sourceCommand.submitAction || sourceReadiness.nextAction || 'repair_persisted_command'
      : state === 'waiting_for_acceptance'
        ? 'request_operator_acceptance'
        : sourceCommand.submitAction || sourceCommand.requestedAction || 'queue';

  return {
    protocol: 'aios.adapter-persisted-command-evidence.mailchimp.v1',
    evidenceKey,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    commandId: compactString(sourceCommand.commandId),
    commandKey,
    state,
    ready: blockedReasons.length === 0,
    replaySafe,
    restartSafe: replaySafe || state === 'acknowledged',
    nextAction,
    blockedReasons,
    externalWrite: sourceCommand.externalWrite === true,
    externalHandoff: {
      requestId: externalRequestId,
      state: compactString(sourceCommand.provider?.externalHandoffState || 'local_only'),
      receiptId,
      acknowledged,
    },
    history: {
      eventCount: history.length,
      latestState: compactString(latest?.state),
      latestCode: compactString(latest?.code),
      latestAt: compactString(latest?.at),
    },
    route: {
      target: 'adapter-persisted-command-evidence',
      idempotencyKey: evidenceKey,
      primaryAction: nextAction,
      requiredBodyKeys: acknowledged ? ['evidenceKey', 'receiptId'] : ['evidenceKey', 'commandKey'],
    },
    clientPatch: {
      adapterPersistedCommandEvidenceKey: evidenceKey,
      adapterPersistedCommandState: state,
      adapterPersistedCommandReplaySafe: replaySafe,
      adapterPersistedCommandNextAction: nextAction,
      adapterPersistedCommandBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe,
      duplicateCommandPolicy: 'dedupe-by-adapter-persisted-command-evidence-key',
      resumeFromPersistedCommandEvidenceKey: evidenceKey,
      externalWritesPerformed: false,
    },
  };
}

function normalizeHistoryEvent(event = {}, index = 0) {
  const state = compactString(event.state || event.status).toLowerCase().replaceAll('-', '_') || 'observed';
  const code = compactString(event.code || event.type || 'mailchimp.history.event');
  const at = compactString(event.at || event.time || event.timestamp || `event:${index}`);
  const writesExternalSystem = event.writesExternalSystem === true || event.externalWrite === true;
  const verifier = compactString(event.verifier || event.verifierName);
  const exportable = event.exportable !== false;

  return {
    index,
    at,
    state,
    code,
    message: compactString(event.message),
    truth: compactString(event.truth || event.truthBoundary),
    verifier,
    writesExternalSystem,
    exportable,
    metadata: stableObject(event.metadata),
  };
}

function normalizeHistoryEvents(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .map(normalizeHistoryEvent)
    .filter((event) => event.at || event.code || event.message || event.state !== 'observed');
}

function countBy(events, selector) {
  return events.reduce((counts, event) => {
    const key = compactString(selector(event) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeExportReceipt(receipt = {}) {
  const source = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  const artifacts = Array.isArray(source.artifacts) ? source.artifacts : [];
  return {
    receiptId: compactString(source.receiptId || source.id || source.exportReceiptId),
    exportedAt: compactString(source.exportedAt || source.at || source.timestamp),
    status: compactString(source.status || source.state || 'observed').toLowerCase().replaceAll('-', '_'),
    destination: compactString(source.destination || source.sink || source.target || 'local-runtime'),
    requestId: compactString(source.requestId || source.adapterRequestId),
    artifactIds: stableList([
      ...artifacts.map((artifact) => artifact?.id || artifact?.artifactId || artifact?.name),
      ...stableList(source.artifactIds),
    ]),
  };
}

function buildExportArtifactPlan(descriptor, snapshot, summary, providerContract) {
  const providerReady = providerContract.serviceState !== 'offline'
    && providerContract.capabilityNegotiation?.satisfied !== false;
  const syncReady = providerContract.sync?.ready !== false;
  const leaseReady = providerContract.lease?.restartSafe !== false;
  const timelineReady = snapshot.exportState.ready === true;
  const artifactCandidates = [
    {
      id: 'adapter-descriptor',
      name: 'adapter-descriptor.json',
      category: 'contract',
      required: true,
      ready: descriptor.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length === 0,
      reason: 'compiled Mailchimp adapter descriptor',
    },
    {
      id: 'provider-contract',
      name: 'provider-contract.json',
      category: 'provider',
      required: descriptor.truthBoundary?.externalWritesAllowed === true,
      ready: providerReady,
      reason: providerReady ? 'provider capabilities are negotiated' : 'provider capabilities require negotiation',
    },
    {
      id: 'sync-metadata',
      name: 'sync-metadata.json',
      category: 'provider',
      required: descriptor.capabilities.includes('external.write'),
      ready: syncReady,
      reason: syncReady ? 'provider sync cursor is available or not required' : 'provider sync cursor is required',
    },
    {
      id: 'lease-state',
      name: 'lease-state.json',
      category: 'recovery',
      required: providerContract.externalHandoff?.localOnly !== true,
      ready: leaseReady,
      reason: leaseReady ? 'provider lease is restart safe' : 'provider lease is not restart safe',
    },
    {
      id: 'history-timeline',
      name: 'history-timeline.json',
      category: 'history',
      required: true,
      ready: timelineReady,
      reason: timelineReady ? 'history timeline is exportable' : snapshot.exportState.reason,
    },
    {
      id: 'analytics-summary',
      name: 'analytics-summary.json',
      category: 'analytics',
      required: true,
      ready: summary.errorCount === 0,
      reason: summary.errorCount === 0 ? 'analytics counters are complete' : 'diagnostic errors block analytics export',
    },
  ];

  return artifactCandidates.map((artifact, index) => ({
    order: index + 1,
    ...artifact,
    state: artifact.ready
      ? 'ready'
      : artifact.required
        ? 'blocked'
        : 'optional_unready',
    idempotencyKey: `${descriptor.requestId}:${artifact.id}:${artifact.ready ? 'ready' : 'blocked'}`
      .replace(/[^a-zA-Z0-9_.:-]/g, '_'),
  }));
}

function buildExportCommandPlan(descriptor, snapshot, artifactPlan, receipt) {
  const requiredBlocked = artifactPlan.filter((artifact) => artifact.required && artifact.ready !== true);
  const exportReady = requiredBlocked.length === 0 && snapshot.exportState.ready === true;
  const receiptStatus = receipt.status || 'missing';
  const receiptMatches = !receipt.requestId || receipt.requestId === descriptor.requestId;
  const alreadyExported = receiptStatus === 'succeeded'
    && receiptMatches
    && artifactPlan.every((artifact) => !artifact.required || receipt.artifactIds.includes(artifact.id));
  const commandState = alreadyExported
    ? 'completed'
    : exportReady
      ? 'ready_to_queue'
      : 'blocked';
  const commandId = `${descriptor.requestId}:adapter-export:${snapshot.timeline.latestState}`
    .replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.adapter-export-command.mailchimp.v1',
    commandId,
    state: commandState,
    idempotencyKey: `${descriptor.requestId}:adapter-export:${stableHash(artifactPlan)}`,
    action: alreadyExported ? 'surface_existing_export' : exportReady ? 'queue_adapter_export' : 'repair_adapter_export',
    retryable: exportReady && alreadyExported === false,
    receipt: {
      ...receipt,
      matchesRequest: receiptMatches,
      complete: alreadyExported,
    },
    blockedReasons: [
      ...requiredBlocked.map((artifact) => `artifact_blocked:${artifact.id}`),
      ...(snapshot.exportState.ready ? [] : ['history_export_not_ready']),
      ...(receiptMatches ? [] : ['receipt_request_mismatch']),
    ],
    artifacts: artifactPlan.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      category: artifact.category,
      required: artifact.required,
      state: artifact.state,
      idempotencyKey: artifact.idempotencyKey,
    })),
    restartSemantics: {
      replaySafe: true,
      duplicatePolicy: 'dedupe-by-export-command-idempotency-key',
      externalWritesPerformed: false,
      resumeFromReceiptId: receipt.receiptId || null,
    },
  };
}

function latestHistoryEvent(events) {
  return events.length > 0 ? events[events.length - 1] : null;
}

function parseScalar(raw) {
  const value = compactString(raw);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return stableList(value.slice(1, -1));
  }
  return value;
}

export function buildMailchimpHandoffIdentity(input = {}, options = {}) {
  const sourceProgram = typeof input === 'string' ? parseMailchimpHandoffSource(input) : null;
  const normalized = normalizeMailchimpHandoff(input);
  const cacheRelevant = {
    adapter: normalized.adapter,
    action: normalized.action,
    tenant: normalized.tenant,
    audienceId: normalized.audienceId,
    campaignId: normalized.campaignId,
    segmentId: normalized.segmentId,
    requestId: normalized.requestId,
    idempotencyKey: normalized.idempotencyKey,
    truthBoundary: normalized.truthBoundary,
    dryRun: normalized.dryRun,
    capabilities: normalized.capabilities,
    memory: normalized.memory,
    verifier: normalized.verifier,
    lifecycleSettings: normalized.lifecycleSettings,
    providerHandoff: normalized.providerHandoff,
    providerReceipt: normalized.providerReceipt,
    metadata: stableObject(normalized.metadata),
    allowedActions: stableList(options.allowedActions || DEFAULT_ALLOWED_MAILCHIMP_ACTIONS),
  };
  const sourceHash = stableHash(sourceProgram ? sourceProgram.fields : cacheRelevant);
  const optionsHash = stableHash({ allowedActions: cacheRelevant.allowedActions });
  const contractHash = stableHash(cacheRelevant);

  return {
    protocol: 'aios.compile-identity.mailchimp.v1',
    adapter: 'mailchimp',
    language: 'mailchimp-handoff',
    sourceKind: sourceProgram ? 'source' : 'object',
    sourceHash,
    optionsHash,
    contractHash,
    cacheKey: `mailchimp:${contractHash}:${optionsHash}`,
    requestKey: normalized.requestId
      || `${normalized.tenant || 'unknown'}:${normalized.action || 'unknown'}:${normalized.idempotencyKey || 'preview'}`,
    normalized: cacheRelevant,
    diagnostics: sourceProgram?.diagnostics || [],
  };
}

export function parseMailchimpHandoffSource(source) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }

  const fields = {};
  const diagnostics = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      diagnostics.push({
        code: 'mailchimp.syntax.missing_colon',
        severity: 'error',
        line: index + 1,
        message: 'Expected "key: value" handoff line.',
      });
      return;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) {
      diagnostics.push({
        code: 'mailchimp.syntax.empty_key',
        severity: 'error',
        line: index + 1,
        message: 'Handoff key cannot be empty.',
      });
      return;
    }
    fields[key] = parseScalar(value);
  });

  return {
    type: 'MailchimpHandoffProgram',
    version: 1,
    fields,
    diagnostics,
  };
}

export function normalizeMailchimpHandoff(input = {}) {
  const raw = typeof input === 'string' ? parseMailchimpHandoffSource(input).fields : asObject(input, 'input');
  const action = compactString(raw.action);
  const truth = compactString(raw.truth || raw.truthBoundary);
  const capabilityIntent = stableList(raw.capabilities || raw.capability);
  const memory = stableList(raw.memory || raw.memoryRefs);
  const verifier = stableList(raw.verifier || raw.verifiers);
  const lifecycleSettings = normalizeLifecycleSettings(raw);
  const providerHandoff = normalizeProviderHandoff(raw);
  const providerReceipt = normalizeProviderReceipt(raw, {
    tenant: compactString(raw.tenant),
    idempotencyKey: compactString(raw.idempotencyKey || raw.idempotency),
  });
  const tenantBoundary = normalizeTenantBoundary(raw);

  return {
    adapter: compactString(raw.adapter || 'mailchimp'),
    action,
    tenant: compactString(raw.tenant),
    audienceId: compactString(raw.audienceId || raw.audience),
    campaignId: compactString(raw.campaignId || raw.campaign),
    segmentId: compactString(raw.segmentId || raw.segment),
    requestId: compactString(raw.requestId || raw.request),
    idempotencyKey: compactString(raw.idempotencyKey || raw.idempotency),
    truthBoundary: truth,
    dryRun: raw.dryRun === true || raw.mode === 'dry-run',
    capabilities: capabilityIntent,
    memory,
    verifier,
    lifecycleSettings,
    providerHandoff,
    providerReceipt,
    tenantBoundary,
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? { ...raw.metadata } : {},
  };
}

export function validateMailchimpHandoff(handoff, options = {}) {
  const normalized = normalizeMailchimpHandoff(handoff);
  const allowedActions = new Set(stableList(options.allowedActions || DEFAULT_ALLOWED_MAILCHIMP_ACTIONS));
  const diagnostics = [];
  const lifecycleDiagnostics = validateLifecycleSettings(normalized.lifecycleSettings, normalized);
  const providerDiagnostics = validateProviderHandoff(normalized.providerHandoff, normalized);
  const boundaryContract = buildTenantBoundaryContract(normalized.tenantBoundary, normalized);
  const boundaryDiagnostics = validateTenantBoundary(boundaryContract);

  for (const field of REQUIRED_FIELDS) {
    const value = field === 'truth' ? normalized.truthBoundary : normalized[field];
    if (!value) {
      diagnostics.push({
        code: `mailchimp.handoff.missing_${field}`,
        severity: 'error',
        field,
        message: `Mailchimp handoff requires ${field}.`,
      });
    }
  }

  if (normalized.adapter !== 'mailchimp') {
    diagnostics.push({
      code: 'mailchimp.handoff.adapter_mismatch',
      severity: 'error',
      field: 'adapter',
      message: 'Mailchimp handoff adapter must be "mailchimp".',
    });
  }

  if (normalized.action && !allowedActions.has(normalized.action)) {
    diagnostics.push({
      code: 'mailchimp.handoff.unsupported_action',
      severity: 'error',
      field: 'action',
      message: `Unsupported Mailchimp action "${normalized.action}".`,
    });
  }

  if (MAILCHIMP_MUTATING_ACTIONS.has(normalized.action) && !normalized.idempotencyKey) {
    diagnostics.push({
      code: 'mailchimp.handoff.missing_idempotency',
      severity: 'error',
      field: 'idempotencyKey',
      message: 'Mutating Mailchimp handoffs require an idempotency key.',
    });
  }

  if (!normalized.audienceId && ['audience.sync', 'segment.refresh', 'tag.apply', 'tag.remove'].includes(normalized.action)) {
    diagnostics.push({
      code: 'mailchimp.handoff.missing_audience',
      severity: 'error',
      field: 'audienceId',
      message: `Action "${normalized.action}" requires an audience id.`,
    });
  }

  const requestedExternalWrite = normalized.capabilities.includes('external.write');
  if (requestedExternalWrite && normalized.truthBoundary !== 'verified') {
    diagnostics.push({
      code: 'mailchimp.handoff.truth_boundary_blocks_write',
      severity: 'error',
      field: 'truthBoundary',
      message: 'External writes require a verified truth boundary.',
    });
  }

  return {
    ok: [...diagnostics, ...lifecycleDiagnostics, ...providerDiagnostics, ...boundaryDiagnostics]
      .every((item) => item.severity !== 'error'),
    handoff: normalized,
    diagnostics: [...diagnostics, ...lifecycleDiagnostics, ...providerDiagnostics, ...boundaryDiagnostics],
    boundaryContract,
  };
}

export function buildMailchimpAdapterDecisionEnvelope(input = {}, context = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const nextStep = context.nextStepHandoff?.protocol === 'aios.adapter-next-step-handoff.mailchimp.v1'
    ? context.nextStepHandoff
    : descriptor.nextStepHandoff?.protocol === 'aios.adapter-next-step-handoff.mailchimp.v1'
      ? descriptor.nextStepHandoff
      : buildMailchimpAdapterNextStepHandoff(descriptor, context);
  const dispatchReadiness = context.dispatchReadiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
    ? context.dispatchReadiness
    : descriptor.adapterDispatchReadiness?.protocol === 'aios.adapter-dispatch-readiness.mailchimp.v1'
      ? descriptor.adapterDispatchReadiness
      : buildMailchimpAdapterDispatchReadiness(descriptor, context);
  const clientCommand = context.clientCommand?.protocol === 'aios.adapter-client-command.mailchimp.v1'
    ? context.clientCommand
    : descriptor.clientCommand?.protocol === 'aios.adapter-client-command.mailchimp.v1'
      ? descriptor.clientCommand
      : buildMailchimpAdapterClientCommand(descriptor, {
        ...context,
        dispatchReadiness,
      });
  const acceptance = nextStep.acceptance
    || dispatchReadiness.acceptance
    || clientCommand.acceptance
    || context.acceptance
    || {};
  const provider = nextStep.provider || dispatchReadiness.providerContinuity || descriptor.providerContinuity || {};
  const tenantPermission = nextStep.tenantPermission
    || dispatchReadiness.tenantPermissionDecisionBundle
    || descriptor.tenantPermissionDecisionBundle
    || {};
  const lifecycle = nextStep.lifecycle
    || dispatchReadiness.lifecycleCommandCheckpoint
    || descriptor.lifecycleControlSummary
    || descriptor.lifecycle
    || {};
  const providerReceiptEvidence = dispatchReadiness.providerReceiptEvidence || descriptor.providerReceiptEvidence || {};
  const mutating = MAILCHIMP_MUTATING_ACTIONS.has(descriptor.action);
  const acceptanceRequired = acceptance.required === true
    || nextStep.state === 'client_acceptance_required'
    || (mutating && descriptor.dryRun !== true);
  const acceptanceAccepted = acceptance.accepted === true;
  const providerReady = provider.ready !== false
    && provider.holdExternalWrite !== true
    && providerReceiptEvidence.ready !== false;
  const tenantReady = tenantPermission.ready !== false
    && tenantPermission.allowedForRuntime !== false
    && tenantPermission.externalWriteSuppressed !== true;
  const lifecycleReady = lifecycle.ready !== false
    && lifecycle.commandAccepted !== false
    && lifecycle.restartSemantics?.replaySafe !== false;
  const blockedReasons = stableList([
    ...stableList(nextStep.blockedReasons),
    ...stableList(dispatchReadiness.blockedReasons).map((reason) => `dispatch:${reason}`),
    ...stableList(clientCommand.validationSummary?.blockedReasons).map((reason) => `command:${reason}`),
    ...(providerReady ? [] : ['provider_not_ready']),
    ...stableList(providerReceiptEvidence.missingEvidence).map((reason) => `provider_evidence:${reason}`),
    ...(tenantReady ? [] : ['tenant_permission_not_ready']),
    ...stableList(tenantPermission.blockedReasons).map((reason) => `tenant_permission:${reason}`),
    ...(lifecycleReady ? [] : ['lifecycle_not_ready']),
    ...stableList(lifecycle.blockedReasons).map((reason) => `lifecycle:${reason}`),
    ...(acceptanceRequired && !acceptanceAccepted ? ['acceptance_required'] : []),
  ]);
  const readyForPreview = nextStep.readyForClient === true
    || dispatchReadiness.ready === true
    || blockedReasons.every((reason) => reason === 'acceptance_required');
  const readyForRuntime = nextStep.readyForRuntime === true
    && dispatchReadiness.dispatchReady === true
    && providerReady
    && tenantReady
    && lifecycleReady
    && (!acceptanceRequired || acceptanceAccepted)
    && blockedReasons.length === 0;
  const decisionState = readyForRuntime
    ? 'accepted_for_runtime'
    : readyForPreview && acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_client_acceptance'
      : readyForPreview
        ? 'preview_ready'
        : provider.holdExternalWrite === true
          ? 'provider_hold'
          : 'blocked';
  const nextAction = readyForRuntime
    ? nextStep.primaryAction || clientCommand.submitAction || 'dispatch-mailchimp-handoff'
    : decisionState === 'waiting_for_client_acceptance'
      ? 'request_operator_acceptance'
      : nextStep.primaryAction || dispatchReadiness.nextAction || clientCommand.submitAction || 'inspect_mailchimp_handoff';
  const envelopeKey = `mailchimp-decision-envelope:${stableHash({
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    idempotencyKey: descriptor.idempotencyKey,
    nextStepKey: nextStep.handoffKey,
    readinessKey: dispatchReadiness.readinessKey,
    state: decisionState,
    blockedReasons,
  })}`;

  return {
    protocol: 'aios.adapter-decision-envelope.mailchimp.v1',
    envelopeKey,
    requestId: compactString(descriptor.requestId),
    tenant: compactString(descriptor.tenant),
    action: compactString(descriptor.action),
    state: decisionState,
    readyForPreview,
    readyForRuntime,
    nextAction,
    blockedReasons,
    preview: {
      title: `Mailchimp ${descriptor.action || 'handoff'} handoff`,
      state: decisionState,
      primaryAction: nextAction,
      visibleBlockedReasons: blockedReasons.slice(0, 5),
      providerState: compactString(provider.mode || provider.state || provider.serviceState || 'unknown'),
      lifecycleState: compactString(lifecycle.state || lifecycle.requestedCommand || 'unknown'),
      tenantDecisionState: compactString(tenantPermission.status || (tenantReady ? 'ready' : 'blocked')),
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      token: compactString(acceptance.token || nextStep.route?.acceptanceToken || `${envelopeKey}:accept`),
      reason: compactString(
        acceptance.reason
          || (acceptanceRequired ? 'Mailchimp handoff requires operator acceptance before runtime dispatch.' : ''),
      ),
      canAccept: readyForPreview && !readyForRuntime,
    },
    route: {
      target: 'adapter-decision-envelope',
      method: 'POST',
      path: `/mailchimp/handoffs/${encodeURIComponent(descriptor.requestId || 'preview')}/decision-envelope`,
      idempotencyKey: envelopeKey,
      primaryAction: nextAction,
      statusRouteState: readyForRuntime ? 'ready' : decisionState === 'blocked' ? 'blocked' : 'needs_attention',
      requiredBodyKeys: acceptanceRequired && !acceptanceAccepted
        ? ['envelopeKey', 'acceptanceToken', 'accepted']
        : ['envelopeKey', 'requestId'],
    },
    clientPatch: {
      adapterDecisionEnvelopeKey: envelopeKey,
      adapterDecisionEnvelopeState: decisionState,
      adapterDecisionReadyForPreview: readyForPreview,
      adapterDecisionReadyForRuntime: readyForRuntime,
      adapterDecisionNextAction: nextAction,
      adapterDecisionBlockedReasons: blockedReasons,
      adapterDecisionAcceptanceRequired: acceptanceRequired,
      adapterDecisionAcceptanceAccepted: acceptanceAccepted,
    },
    restartSemantics: {
      replaySafe: readyForRuntime || decisionState === 'waiting_for_client_acceptance',
      duplicateCommandPolicy: 'dedupe-by-adapter-decision-envelope-key',
      resumeFromDecisionEnvelopeKey: envelopeKey,
      externalWritesPerformed: false,
    },
  };
}

export function compileMailchimpAdapterHandoff(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseMailchimpHandoffSource(input) : null;
  const validation = validateMailchimpHandoff(input, options);
  const handoff = validation.handoff;
  const boundaryContract = validation.boundaryContract;
  const capabilities = new Set(['adapter.mailchimp', `mailchimp.${handoff.action || 'unknown'}`]);

  for (const capability of handoff.capabilities) capabilities.add(capability);
  if (handoff.dryRun) capabilities.add('external.write.denied');
  if (MAILCHIMP_MUTATING_ACTIONS.has(handoff.action) && !handoff.dryRun) capabilities.add('external.write');
  if (handoff.lifecycleSettings.enabled === false || handoff.lifecycleSettings.controls.allowExternalWrite === false) {
    capabilities.delete('external.write');
    capabilities.add('external.write.denied');
  }
  if (boundaryContract.allowed !== true) {
    capabilities.delete('external.write');
    capabilities.add('external.write.denied');
    capabilities.add('tenant.boundary.denied');
  }
  const lifecycle = buildLifecycleContract(handoff.lifecycleSettings, handoff, validation.ok);
  const lifecycleControlSummary = buildLifecycleControlSummary(lifecycle, handoff, validation.diagnostics);
  const providerContract = buildProviderHandoffContract(
    handoff.providerHandoff,
    handoff,
    capabilities,
    handoff.providerReceipt,
  );
  const identity = buildMailchimpHandoffIdentity(input, options);
  const requestId = handoff.requestId || `mailchimp:${handoff.tenant}:${handoff.action}:${handoff.idempotencyKey || 'preview'}`;
  const boundaryHandoff = buildTenantBoundaryHandoffToken(boundaryContract, handoff);
  const providerReceiptEvidence = buildProviderReceiptEvidenceHandoff(
    providerContract,
    providerContract.providerReceipt,
    handoff,
    lifecycle,
  );
  const providerContinuity = buildProviderContinuityContract(
    providerContract,
    providerReceiptEvidence,
    handoff,
    lifecycle,
  );
  const tenantPermissionDecisionBundle = buildTenantPermissionDecisionBundle(
    boundaryContract,
    boundaryHandoff,
    handoff,
    providerContract,
    lifecycle,
  );
  const tenantBoundaryAuditEnvelope = buildMailchimpTenantBoundaryAuditEnvelope({
    type: 'KernelJobDescriptor',
    adapter: 'mailchimp',
    action: handoff.action,
    tenant: handoff.tenant,
    requestId,
    boundaryContract,
    boundaryHandoff,
    tenantPermissionDecisionBundle,
  }, options.runtime || {});
  const tenantBoundaryContinuity = buildMailchimpTenantBoundaryContinuityContract({
    type: 'KernelJobDescriptor',
    adapter: 'mailchimp',
    action: handoff.action,
    tenant: handoff.tenant,
    requestId,
    boundaryContract,
    boundaryHandoff,
    tenantPermissionDecisionBundle,
    tenantBoundaryAuditEnvelope,
    lifecycle,
  }, options.runtime || {});
  const truthBoundary = {
    level: handoff.truthBoundary,
    externalWritesAllowed: capabilities.has('external.write')
      && validation.ok
      && lifecycle.dispatchReady
      && boundaryContract.allowed
      && tenantPermissionDecisionBundle.ready
      && tenantPermissionDecisionBundle.externalWriteSuppressed !== true
      && providerContract.serviceState !== 'offline'
      && providerContinuity.holdExternalWrite !== true
      && providerContinuity.queueOnly !== true
      && providerContract.capabilityNegotiation.satisfied,
    evidenceRequired: capabilities.has('external.write') ? ['idempotencyKey', 'verifierContracts'] : ['requestId'],
    tenantBoundary: {
      allowed: boundaryContract.allowed,
      scope: boundaryContract.scope,
      workspace: boundaryContract.workspace,
      blockedReasons: boundaryContract.blockedReasons,
    },
  };

  const descriptor = {
    type: 'KernelJobDescriptor',
    adapter: 'mailchimp',
    action: handoff.action,
    tenant: handoff.tenant,
    requestId,
    idempotencyKey: handoff.idempotencyKey,
    dryRun: handoff.dryRun,
    capabilities: [...capabilities].sort(),
    memory: handoff.memory.map((ref) => ({ ref, mode: 'read', boundary: 'local' })),
    verifierContracts: handoff.verifier.map((name) => ({ name, required: true, scope: 'mailchimp' })),
    payload: {
      audienceId: handoff.audienceId,
      campaignId: handoff.campaignId,
      segmentId: handoff.segmentId,
      metadata: handoff.metadata,
    },
    lifecycle,
    lifecycleControlSummary,
    boundaryContract,
    boundaryHandoff,
    tenantPermissionDecisionBundle,
    tenantBoundaryAuditEnvelope,
    tenantBoundaryContinuity,
    providerContract,
    providerReceipt: providerContract.providerReceipt,
    providerReceiptEvidence,
    providerContinuity,
    externalHandoff: providerContract.externalHandoff,
    clientCommand: buildMailchimpAdapterClientCommand({
      adapter: 'mailchimp',
      action: handoff.action,
      tenant: handoff.tenant,
      requestId,
      idempotencyKey: handoff.idempotencyKey,
      dryRun: handoff.dryRun,
      diagnostics: validation.diagnostics,
      lifecycle,
      lifecycleControlSummary,
      boundaryContract,
      boundaryHandoff,
      tenantPermissionDecisionBundle,
      tenantBoundaryAuditEnvelope,
      tenantBoundaryContinuity,
      providerContract,
      providerReceiptEvidence,
      providerContinuity,
      externalHandoff: providerContract.externalHandoff,
      truthBoundary,
    }, {
      acceptance: {
        required: lifecycle.requestedCommand === 'dispatch' || truthBoundary.externalWritesAllowed === true,
        accepted: false,
      },
    }),
    compileIdentity: {
      protocol: identity.protocol,
      cacheKey: identity.cacheKey,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      sourceKind: identity.sourceKind,
      requestKey: identity.requestKey,
    },
    truthBoundary,
    diagnostics: [...(parsed?.diagnostics || []), ...validation.diagnostics],
  };
  descriptor.adapterDispatchReadiness = buildDispatchReadinessContract(descriptor, {
    acceptance: descriptor.clientCommand?.acceptance,
  });
  descriptor.persistedResumeTicket = buildMailchimpAdapterPersistedResumeTicket(descriptor, options.runtime || {});
  descriptor.clientCommand = {
    ...descriptor.clientCommand,
    dispatchReadiness: {
      readinessKey: descriptor.adapterDispatchReadiness.readinessKey,
      state: descriptor.adapterDispatchReadiness.state,
      ready: descriptor.adapterDispatchReadiness.ready,
      nextAction: descriptor.adapterDispatchReadiness.nextAction,
      blockedReasons: descriptor.adapterDispatchReadiness.blockedReasons,
      providerReceiptEvidence: descriptor.adapterDispatchReadiness.providerReceiptEvidence,
      lifecycleControlSummary: descriptor.lifecycleControlSummary,
      providerContinuity: descriptor.adapterDispatchReadiness.providerContinuity,
      tenantPermissionDecisionBundle: descriptor.adapterDispatchReadiness.tenantPermissionDecisionBundle,
      tenantBoundaryAuditEnvelope: descriptor.tenantBoundaryAuditEnvelope,
      tenantBoundaryContinuity: descriptor.tenantBoundaryContinuity,
    },
    persistedResumeTicket: {
      ticketKey: descriptor.persistedResumeTicket.ticketKey,
      ready: descriptor.persistedResumeTicket.ready,
      state: descriptor.persistedResumeTicket.state,
      nextAction: descriptor.persistedResumeTicket.nextAction,
      blockedReasons: descriptor.persistedResumeTicket.blockedReasons,
      restartSemantics: descriptor.persistedResumeTicket.restartSemantics,
    },
    clientWorkflowHandoff: buildAdapterClientWorkflowHandoff(
      descriptor,
      descriptor.adapterDispatchReadiness,
      descriptor.clientCommand,
      { acceptance: descriptor.clientCommand?.acceptance },
    ),
  };
  descriptor.nextStepHandoff = buildMailchimpAdapterNextStepHandoff(descriptor, {
    dispatchReadiness: descriptor.adapterDispatchReadiness,
    clientCommand: descriptor.clientCommand,
    acceptance: descriptor.clientCommand?.acceptance,
  });
  descriptor.decisionEnvelope = buildMailchimpAdapterDecisionEnvelope(descriptor, {
    dispatchReadiness: descriptor.adapterDispatchReadiness,
    clientCommand: descriptor.clientCommand,
    nextStepHandoff: descriptor.nextStepHandoff,
    acceptance: descriptor.clientCommand?.acceptance,
  });
  return descriptor;
}

export function buildMailchimpAdapterPermissionHealth(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const boundary = descriptor.boundaryContract || {};
  const runtimeBoundary = runtime.boundary && typeof runtime.boundary === 'object' ? runtime.boundary : {};
  const observedWorkspace = compactString(runtime.workspace || runtime.workspaceId || runtimeBoundary.workspace);
  const workspaceDrift = Boolean(
    boundary.workspace
      && observedWorkspace
      && boundary.workspace !== observedWorkspace,
  );
  const blockedReasons = stableList([
    ...(Array.isArray(boundary.blockedReasons) ? boundary.blockedReasons : []),
    ...(workspaceDrift ? ['runtime_workspace_drift'] : []),
  ]);
  const state = boundary.allowed === false || workspaceDrift
    ? 'permission_blocked'
    : descriptor.truthBoundary?.externalWritesAllowed === true
      ? 'write_ready'
      : 'read_only';

  return {
    protocol: 'aios.adapter-permission-health.mailchimp.v1',
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    state,
    allowed: blockedReasons.length === 0 && boundary.allowed !== false,
    externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true && blockedReasons.length === 0,
    boundary: {
      scope: compactString(boundary.scope || 'tenant'),
      workspace: compactString(boundary.workspace),
      observedWorkspace,
      roles: stableList(boundary.roles),
      requiredGrants: stableList(boundary.requiredGrants),
      missingOrDenied: blockedReasons,
    },
    audit: {
      ...(boundary.audit || {}),
      decision: blockedReasons.length === 0 && boundary.allowed !== false ? 'allow' : 'block',
      handoffKey: boundary.audit?.handoffKey || `${descriptor.tenant || 'unknown'}:${descriptor.action || 'unknown'}`,
    },
    nextAction: blockedReasons.length === 0
      ? 'observe'
      : workspaceDrift
        ? 'switch_workspace_or_recompile'
        : 'repair_tenant_permissions',
    actionableErrors: blockedReasons.map((reason) => ({
      code: `mailchimp.permission.${reason.split(':')[0]}`,
      severity: 'error',
      reason,
      action: reason === 'runtime_workspace_drift' ? 'switch_workspace_or_recompile' : 'repair_tenant_permissions',
    })),
  };
}

export function createMailchimpAdapterHandoff(input = {}, options = {}) {
  const descriptor = compileMailchimpAdapterHandoff(input, options);
  return {
    ok: descriptor.diagnostics.every((item) => item.severity !== 'error'),
    descriptor,
    handoffEnvelope: {
      protocol: 'aios.adapter-handoff.mailchimp.v1',
      boundary: 'local-internal',
      rollbackEligible: MAILCHIMP_MUTATING_ACTIONS.has(descriptor.action),
      descriptor,
    },
  };
}

export function buildMailchimpAdapterHistorySnapshot(input = {}, history = []) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const events = normalizeHistoryEvents(history);
  const latest = latestHistoryEvent(events);
  const diagnostics = Array.isArray(descriptor.diagnostics) ? descriptor.diagnostics : [];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const verifierNames = (descriptor.verifierContracts || []).map((contract) => contract.name).filter(Boolean);
  const verifierEvidenceEvents = events.filter((event) => event.verifier);
  const completedVerifierNames = stableList(verifierEvidenceEvents.map((event) => event.verifier));
  const missingVerifierNames = verifierNames.filter((name) => !completedVerifierNames.includes(name));
  const externalWriteEvents = events.filter((event) => event.writesExternalSystem);
  const terminalEvents = events.filter((event) => HISTORY_TERMINAL_STATES.has(event.state));
  const exportableEvents = events.filter((event) => event.exportable);
  const blocked = errorCount > 0
    || (descriptor.truthBoundary?.externalWritesAllowed === true && missingVerifierNames.length > 0);

  return {
    protocol: 'aios.adapter-history.mailchimp.v1',
    adapter: 'mailchimp',
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    dryRun: descriptor.dryRun === true,
    timeline: {
      totalEvents: events.length,
      exportableEvents: exportableEvents.length,
      terminalEvents: terminalEvents.length,
      firstAt: events[0]?.at || null,
      latestAt: latest?.at || null,
      latestState: latest?.state || 'queued',
      latestCode: latest?.code || null,
      latestMessage: latest?.message || null,
      externalWriteEvents: externalWriteEvents.length,
    },
    analytics: {
      diagnostics: {
        errors: errorCount,
        warnings: warningCount,
        total: diagnostics.length,
      },
      eventsByState: countBy(events, (event) => event.state),
      eventsByCode: countBy(events, (event) => event.code),
      verifierEvidence: {
        required: verifierNames.length,
        completed: completedVerifierNames.length,
        missing: missingVerifierNames.length,
        completedNames: completedVerifierNames,
        missingNames: missingVerifierNames,
      },
      externalWrites: {
        allowedByTruthBoundary: descriptor.truthBoundary?.externalWritesAllowed === true,
        observed: externalWriteEvents.length,
        dryRunBlocked: descriptor.dryRun === true,
      },
    },
    exportState: {
      ready: !blocked && exportableEvents.length === events.length,
      blocked,
      format: 'json',
      redaction: 'metadata-only',
      includesPayload: false,
      includesTimeline: true,
      reason: blocked
        ? 'History export is blocked until diagnostics and verifier evidence are resolved.'
        : 'History export contains local timeline and analytics only.',
    },
    truthBoundary: {
      level: descriptor.truthBoundary?.level || 'unknown',
      externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true,
      lastObservedTruth: latest?.truth || descriptor.truthBoundary?.level || 'unknown',
    },
    events,
  };
}

export function summarizeMailchimpAdapterHistory(snapshot) {
  const history = snapshot?.protocol === 'aios.adapter-history.mailchimp.v1'
    ? snapshot
    : buildMailchimpAdapterHistorySnapshot(snapshot);
  const readiness = history.exportState.ready
    ? 'ready'
    : history.analytics.diagnostics.errors > 0
      ? 'blocked_by_errors'
      : history.analytics.verifierEvidence.missing > 0
        ? 'waiting_for_verifier'
        : 'blocked';

  return {
    protocol: 'aios.adapter-history-summary.mailchimp.v1',
    requestId: history.requestId,
    tenant: history.tenant,
    action: history.action,
    readiness,
    exportReady: history.exportState.ready,
    latestState: history.timeline.latestState,
    latestCode: history.timeline.latestCode,
    totalEvents: history.timeline.totalEvents,
    errorCount: history.analytics.diagnostics.errors,
    warningCount: history.analytics.diagnostics.warnings,
    missingVerifierEvidence: history.analytics.verifierEvidence.missingNames,
    externalWriteEvents: history.timeline.externalWriteEvents,
    truthBoundary: history.truthBoundary,
  };
}

export function createMailchimpAdapterExportSummary(input = {}, history = []) {
  const snapshot = buildMailchimpAdapterHistorySnapshot(input, history);
  const summary = summarizeMailchimpAdapterHistory(snapshot);
  return {
    protocol: 'aios.adapter-export.mailchimp.v1',
    requestId: snapshot.requestId,
    generatedFrom: 'local-history',
    exportReady: summary.exportReady,
    blockedReasons: [
      ...(summary.errorCount > 0 ? ['diagnostics_errors'] : []),
      ...(summary.missingVerifierEvidence.length > 0 ? ['missing_verifier_evidence'] : []),
      ...(snapshot.events.some((event) => event.exportable === false) ? ['non_exportable_events'] : []),
    ],
    counters: {
      totalEvents: summary.totalEvents,
      exportableEvents: snapshot.timeline.exportableEvents,
      diagnosticsErrors: summary.errorCount,
      diagnosticsWarnings: summary.warningCount,
      verifierEvidenceMissing: summary.missingVerifierEvidence.length,
      externalWriteEvents: summary.externalWriteEvents,
    },
    timeline: {
      firstAt: snapshot.timeline.firstAt,
      latestAt: snapshot.timeline.latestAt,
      latestState: summary.latestState,
      latestCode: summary.latestCode,
    },
    truthBoundary: snapshot.truthBoundary,
  };
}

export function buildMailchimpAdapterExportManifest(input = {}, history = [], receipt = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const snapshot = buildMailchimpAdapterHistorySnapshot(descriptor, history);
  const summary = summarizeMailchimpAdapterHistory(snapshot);
  const normalizedReceipt = normalizeExportReceipt(receipt);
  const artifactPlan = buildExportArtifactPlan(
    descriptor,
    snapshot,
    summary,
    descriptor.providerContract || {},
  );
  const commandPlan = buildExportCommandPlan(descriptor, snapshot, artifactPlan, normalizedReceipt);
  const requiredArtifacts = artifactPlan.filter((artifact) => artifact.required);
  const readyRequiredArtifacts = requiredArtifacts.filter((artifact) => artifact.ready);

  return {
    protocol: 'aios.adapter-export-manifest.mailchimp.v1',
    adapter: 'mailchimp',
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    action: descriptor.action,
    generatedFrom: 'adapter-history-and-provider-contract',
    exportReady: commandPlan.state === 'ready_to_queue' || commandPlan.state === 'completed',
    commandReady: commandPlan.state === 'ready_to_queue',
    alreadyExported: commandPlan.state === 'completed',
    readiness: {
      state: commandPlan.state,
      requiredArtifacts: requiredArtifacts.length,
      readyRequiredArtifacts: readyRequiredArtifacts.length,
      blockedRequiredArtifacts: requiredArtifacts.length - readyRequiredArtifacts.length,
      blockedReasons: commandPlan.blockedReasons,
      nextAction: commandPlan.action,
    },
    provider: {
      service: descriptor.providerContract?.service || 'mailchimp-marketing',
      serviceState: descriptor.providerContract?.serviceState || 'unknown',
      externalHandoffState: descriptor.providerContract?.externalHandoff?.state || 'local_only',
      externalRequestId: descriptor.providerContract?.externalHandoff?.requestId || '',
      syncReady: descriptor.providerContract?.sync?.ready === true,
      leaseRestartSafe: descriptor.providerContract?.lease?.restartSafe === true,
      missingCapabilities: descriptor.providerContract?.capabilityNegotiation?.missing || [],
    },
    counters: {
      totalArtifacts: artifactPlan.length,
      requiredArtifacts: requiredArtifacts.length,
      readyArtifacts: artifactPlan.filter((artifact) => artifact.ready).length,
      blockedArtifacts: artifactPlan.filter((artifact) => artifact.state === 'blocked').length,
      totalEvents: snapshot.timeline.totalEvents,
      exportableEvents: snapshot.timeline.exportableEvents,
      diagnosticErrors: summary.errorCount,
      diagnosticWarnings: summary.warningCount,
      externalWriteEvents: summary.externalWriteEvents,
    },
    timeline: {
      firstAt: snapshot.timeline.firstAt,
      latestAt: snapshot.timeline.latestAt,
      latestState: snapshot.timeline.latestState,
      latestCode: snapshot.timeline.latestCode,
      latestMessage: snapshot.timeline.latestMessage,
    },
    artifactPlan,
    commandPlan,
    statePatch: {
      adapterExportState: commandPlan.state,
      adapterExportCommandId: commandPlan.commandId,
      adapterExportIdempotencyKey: commandPlan.idempotencyKey,
      adapterExportNextAction: commandPlan.action,
      adapterExportReceiptId: normalizedReceipt.receiptId || null,
    },
  };
}

export {
  DEFAULT_ALLOWED_MAILCHIMP_ACTIONS,
  HISTORY_TERMINAL_STATES,
  buildLifecycleControlSummary as buildMailchimpAdapterLifecycleControlSummary,
  buildTenantBoundaryHandoffToken,
};
