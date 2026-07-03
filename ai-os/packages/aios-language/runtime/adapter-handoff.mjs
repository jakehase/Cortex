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

function buildProviderHandoffContract(provider, handoff, capabilities) {
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
  const providerContract = buildProviderHandoffContract(handoff.providerHandoff, handoff, capabilities);
  const identity = buildMailchimpHandoffIdentity(input, options);

  return {
    type: 'KernelJobDescriptor',
    adapter: 'mailchimp',
    action: handoff.action,
    tenant: handoff.tenant,
    requestId: handoff.requestId || `mailchimp:${handoff.tenant}:${handoff.action}:${handoff.idempotencyKey || 'preview'}`,
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
    boundaryContract,
    providerContract,
    externalHandoff: providerContract.externalHandoff,
    compileIdentity: {
      protocol: identity.protocol,
      cacheKey: identity.cacheKey,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      sourceKind: identity.sourceKind,
      requestKey: identity.requestKey,
    },
    truthBoundary: {
      level: handoff.truthBoundary,
      externalWritesAllowed: capabilities.has('external.write')
        && validation.ok
        && lifecycle.dispatchReady
        && boundaryContract.allowed
        && providerContract.serviceState !== 'offline'
        && providerContract.capabilityNegotiation.satisfied,
      evidenceRequired: capabilities.has('external.write') ? ['idempotencyKey', 'verifierContracts'] : ['requestId'],
      tenantBoundary: {
        allowed: boundaryContract.allowed,
        scope: boundaryContract.scope,
        workspace: boundaryContract.workspace,
        blockedReasons: boundaryContract.blockedReasons,
      },
    },
    diagnostics: [...(parsed?.diagnostics || []), ...validation.diagnostics],
  };
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
};
