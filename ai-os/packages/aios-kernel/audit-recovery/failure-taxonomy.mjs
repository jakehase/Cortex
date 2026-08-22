export const surfaceId = "aios_audit-recovery_failure-taxonomy_079";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "failure-taxonomy";

const DEFAULT_PROVIDER = 'hosted-kernel';
const FAILURE_SEVERITY = new Set(['info', 'warning', 'degraded', 'critical']);
const RECOVERY_MODES = new Set(['observe', 'retry', 'rollback', 'handoff', 'quarantine']);
const CLIENT_CHANNELS = new Set(['api', 'console', 'cli', 'automation']);
const HANDOFF_PREFERENCES = new Set(['inline', 'external', 'defer']);
const HANDOFF_TRANSPORTS = new Set(['webhook', 'ticket', 'queue', 'manual']);
const PERSISTED_WORKFLOW_STATES = new Set(['new', 'restored', 'current', 'catching_up', 'awaiting_handoff_ack', 'blocked', 'recovered']);
const IDEMPOTENT_COMMANDS = new Set(['ack_handoff', 'retry_sync', 'publish_preview', 'recover_state', 'enable_taxonomy', 'disable_taxonomy', 'set_sync_schedule']);
const TENANT_ROLES = new Set(['viewer', 'operator', 'auditor', 'admin']);
const LIFECYCLE_MODES = new Set(['enabled', 'disabled', 'maintenance']);
const SYNC_CADENCES = new Set(['manual', 'every_5m', 'every_15m', 'hourly', 'daily']);
const SUPPORTED_PROVIDER_CAPABILITIES = Object.freeze([
  'audit-proof',
  'failure-taxonomy',
  'sync-metadata',
  'external-handoff',
  'replay-hints'
]);
const REQUIRED_PROVIDER_CAPABILITIES = Object.freeze(['failure-taxonomy', 'sync-metadata', 'audit-proof']);
const PROVIDER_CAPABILITY_CONTRACTS = Object.freeze({
  'audit-proof': {
    contractType: 'hosted-kernel.audit-proof.v1',
    routeSuffix: 'proofs',
    obligations: ['emit_integrity_assertions', 'bind_request_id', 'include_tenant_policy']
  },
  'failure-taxonomy': {
    contractType: 'hosted-kernel.failure-taxonomy.v1',
    routeSuffix: 'taxonomy',
    obligations: ['classify_failure_code', 'declare_recovery_mode', 'preserve_evidence_refs']
  },
  'sync-metadata': {
    contractType: 'hosted-kernel.sync-metadata.v1',
    routeSuffix: 'sync',
    obligations: ['return_cursor', 'return_watermark_kind', 'return_pending_count']
  },
  'external-handoff': {
    contractType: 'hosted-kernel.external-handoff.v1',
    routeSuffix: 'handoff',
    obligations: ['return_handoff_id', 'declare_owner', 'support_acknowledgement']
  },
  'replay-hints': {
    contractType: 'hosted-kernel.replay-hints.v1',
    routeSuffix: 'replay',
    obligations: ['return_resume_token', 'declare_idempotency_scope']
  }
});
const PROVIDER_ENDPOINT_SCHEMAS = Object.freeze({
  'audit-proof': {
    method: 'GET',
    requestSchema: 'hosted-kernel.failure-taxonomy.audit-proof-request.v1',
    responseSchema: 'hosted-kernel.failure-taxonomy.audit-proof-response.v1',
    idempotencyScope: 'request'
  },
  'failure-taxonomy': {
    method: 'POST',
    requestSchema: 'hosted-kernel.failure-taxonomy.classification-request.v1',
    responseSchema: 'hosted-kernel.failure-taxonomy.classification-response.v1',
    idempotencyScope: 'incident'
  },
  'sync-metadata': {
    method: 'GET',
    requestSchema: 'hosted-kernel.failure-taxonomy.sync-metadata-request.v1',
    responseSchema: 'hosted-kernel.failure-taxonomy.sync-metadata-response.v1',
    idempotencyScope: 'cursor'
  },
  'external-handoff': {
    method: 'POST',
    requestSchema: 'hosted-kernel.failure-taxonomy.external-handoff-request.v1',
    responseSchema: 'hosted-kernel.failure-taxonomy.external-handoff-response.v1',
    idempotencyScope: 'handoff'
  },
  'replay-hints': {
    method: 'GET',
    requestSchema: 'hosted-kernel.failure-taxonomy.replay-hints-request.v1',
    responseSchema: 'hosted-kernel.failure-taxonomy.replay-hints-response.v1',
    idempotencyScope: 'resume-token'
  }
});
const ROLE_PERMISSIONS = Object.freeze({
  viewer: ['taxonomy:read'],
  auditor: ['taxonomy:read', 'audit:proof:read'],
  operator: ['taxonomy:read', 'audit:proof:read', 'sync:retry', 'handoff:ack'],
  admin: ['taxonomy:read', 'audit:proof:read', 'sync:retry', 'handoff:ack', 'preview:publish', 'settings:manage']
});
const COMMAND_PERMISSION_BY_TYPE = Object.freeze({
  ack_handoff: 'handoff:ack',
  retry_sync: 'sync:retry',
  publish_preview: 'preview:publish',
  recover_state: 'taxonomy:read',
  enable_taxonomy: 'settings:manage',
  disable_taxonomy: 'settings:manage',
  set_sync_schedule: 'settings:manage'
});
const WORKSPACE_MUTATING_COMMANDS = new Set(['ack_handoff', 'retry_sync', 'publish_preview', 'enable_taxonomy', 'disable_taxonomy', 'set_sync_schedule']);
const SEVERITY_RANK = Object.freeze({
  info: 0,
  warning: 1,
  degraded: 2,
  critical: 3
});
const HEALTH_RANK = Object.freeze({
  healthy: 0,
  warning: 1,
  degraded: 2,
  blocked: 3
});
const RETRY_BACKOFF_SECONDS = Object.freeze([30, 60, 120, 300, 900, 1800]);
const ACTIONABLE_ERROR_CATALOG = Object.freeze({
  lifecycle_settings_invalid: {
    owner: 'settings',
    commandType: 'set_sync_schedule',
    action: 'correct_lifecycle_settings',
    retryable: false,
    degradedMode: 'configuration_safe_mode'
  },
  lifecycle_transition_blocked: {
    owner: 'settings',
    commandType: 'set_sync_schedule',
    action: 'resolve_lifecycle_transition_blocker',
    retryable: false,
    degradedMode: 'configuration_safe_mode'
  },
  taxonomy_lifecycle_disabled: {
    owner: 'settings',
    commandType: 'enable_taxonomy',
    action: 'enable_failure_taxonomy',
    retryable: false,
    degradedMode: 'read_only_taxonomy'
  },
  taxonomy_sync_schedule_paused: {
    owner: 'operator',
    commandType: 'retry_sync',
    action: 'resume_or_retry_sync',
    retryable: true,
    degradedMode: 'stale_taxonomy_cache'
  },
  provider_required_contract_unavailable: {
    owner: 'provider',
    commandType: 'recover_state',
    action: 'repair_provider_contract',
    retryable: false,
    degradedMode: 'contract_negotiation_only'
  },
  provider_sync_metadata_unavailable: {
    owner: 'provider',
    commandType: 'recover_state',
    action: 'restore_sync_metadata_contract',
    retryable: false,
    degradedMode: 'manual_recovery_required'
  },
  provider_external_handoff_unavailable: {
    owner: 'provider',
    commandType: 'recover_state',
    action: 'restore_external_handoff_contract',
    retryable: false,
    degradedMode: 'inline_handoff_only'
  },
  taxonomy_decision_proof_incomplete: {
    owner: 'auditor',
    commandType: 'recover_state',
    action: 'attach_required_audit_proof',
    retryable: false,
    degradedMode: 'proof_gated_preview'
  },
  evidence_scope_mismatch: {
    owner: 'auditor',
    commandType: 'recover_state',
    action: 'attach_scoped_audit_evidence',
    retryable: false,
    degradedMode: 'proof_gated_preview'
  },
  sync_backlog_present: {
    owner: 'operator',
    commandType: 'retry_sync',
    action: 'drain_provider_backlog',
    retryable: true,
    degradedMode: 'catching_up'
  },
  tenant_command_denied: {
    owner: 'tenant-admin',
    commandType: 'recover_state',
    action: 'review_role_or_workspace_scope',
    retryable: false,
    degradedMode: 'permission_limited'
  },
  audit_proof_assertion_failed: {
    owner: 'auditor',
    commandType: 'recover_state',
    action: 'repair_audit_proof',
    retryable: false,
    degradedMode: 'proof_rejected'
  }
});

const DEFAULT_CAPABILITIES = Object.freeze({
  acceptsExternalIncidents: true,
  emitsAuditProof: true,
  supportsReplayHints: true,
  supportsExternalHandoff: true,
  syncWatermarkKind: 'iso8601'
});

const BASE_FAILURE_CLASSES = Object.freeze([
  {
    code: 'mailchimp_campaign_audit_missing',
    severity: 'critical',
    recoveryMode: 'quarantine',
    retryable: false,
    proofRequired: ['incidentId', 'campaignId', 'audienceId', 'auditTrailId']
  },
  {
    code: 'mailchimp_audience_sync_gap',
    severity: 'degraded',
    recoveryMode: 'retry',
    retryable: true,
    proofRequired: ['incidentId', 'audienceId', 'lastSyncedAt', 'watermark']
  },
  {
    code: 'mailchimp_campaign_handoff_pending',
    severity: 'warning',
    recoveryMode: 'handoff',
    retryable: true,
    proofRequired: ['incidentId', 'campaignId', 'handoffId', 'status']
  },
  {
    code: 'provider_contract_mismatch',
    severity: 'degraded',
    recoveryMode: 'handoff',
    retryable: false,
    proofRequired: ['providerId', 'contractVersion', 'capabilitySet']
  },
  {
    code: 'audit_sync_gap',
    severity: 'warning',
    recoveryMode: 'retry',
    retryable: true,
    proofRequired: ['lastSyncedAt', 'watermark']
  },
  {
    code: 'external_handoff_pending',
    severity: 'info',
    recoveryMode: 'observe',
    retryable: true,
    proofRequired: ['handoffId', 'owner', 'status']
  },
  {
    code: 'recovery_proof_missing',
    severity: 'critical',
    recoveryMode: 'quarantine',
    retryable: false,
    proofRequired: ['incidentId', 'auditTrailId']
  }
]);

function cleanString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
    : [];
}

function normalizePositiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(value)))
    : fallback;
}

function normalizeLifecycleSettings(input = {}, now) {
  const settingsRoot = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const lifecycleRoot = input.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const source = {
    ...(settingsRoot.failureTaxonomy && typeof settingsRoot.failureTaxonomy === 'object' ? settingsRoot.failureTaxonomy : {}),
    ...(input.lifecycleSettings && typeof input.lifecycleSettings === 'object' ? input.lifecycleSettings : {}),
    ...lifecycleRoot
  };
  const schedule = source.syncSchedule && typeof source.syncSchedule === 'object'
    ? source.syncSchedule
    : source.schedule && typeof source.schedule === 'object'
      ? source.schedule
      : {};
  const rawMode = cleanString(source.mode || source.lifecycleMode, source.enabled === false ? 'disabled' : 'enabled');
  const mode = LIFECYCLE_MODES.has(rawMode) ? rawMode : 'enabled';
  const rawCadence = cleanString(schedule.cadence || source.syncCadence, 'every_15m');
  const cadence = SYNC_CADENCES.has(rawCadence) ? rawCadence : 'every_15m';
  const pausedUntil = cleanString(schedule.pausedUntil || source.pausedUntil, null);
  const invalidFields = [];

  if (!LIFECYCLE_MODES.has(rawMode)) {
    invalidFields.push('mode');
  }
  if (!SYNC_CADENCES.has(rawCadence)) {
    invalidFields.push('syncSchedule.cadence');
  }

  return {
    settingsType: 'hosted-kernel.failure-taxonomy.lifecycle-settings.v1',
    mode,
    enabled: mode === 'enabled',
    acceptsMutatingCommands: mode !== 'disabled',
    schedule: {
      cadence,
      pausedUntil,
      nextRunAfter: cleanString(schedule.nextRunAfter, cadence === 'manual' ? null : now),
      retryWindowMinutes: normalizePositiveInteger(schedule.retryWindowMinutes, 15, 1, 240),
      maxBacklogBeforePause: normalizePositiveInteger(schedule.maxBacklogBeforePause, 250, 1, 10000)
    },
    controls: {
      allowPublish: source.allowPublish !== false,
      allowExternalHandoff: source.allowExternalHandoff !== false,
      allowRetrySync: source.allowRetrySync !== false && cadence !== 'manual',
      requireProofBeforePublish: source.requireProofBeforePublish !== false
    },
    validation: {
      valid: invalidFields.length === 0,
      invalidFields,
      normalizedAt: now
    }
  };
}

function normalizeTenantScope(input = {}) {
  const tenant = input.tenant && typeof input.tenant === 'object' ? input.tenant : {};
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const source = { ...tenant, ...workspace };
  const role = TENANT_ROLES.has(source.role) ? source.role : 'viewer';
  const permissions = new Set([
    ...ROLE_PERMISSIONS[role],
    ...normalizeStringList(source.permissions)
  ]);
  const allowedWorkspaceIds = normalizeStringList(
    source.allowedWorkspaceIds || source.workspaceIds || source.allowedWorkspaces
  );
  const activeWorkspaceId = cleanString(
    source.activeWorkspaceId || source.workspaceId,
    allowedWorkspaceIds[0] || 'default-workspace'
  );
  const boundary = source.crossTenantAccess === true ? 'cross_tenant_requested' : 'tenant_local';

  return {
    tenantId: cleanString(source.tenantId || source.organizationId, 'default-tenant'),
    activeWorkspaceId,
    allowedWorkspaceIds: allowedWorkspaceIds.length ? allowedWorkspaceIds : [activeWorkspaceId],
    role,
    permissions: [...permissions],
    boundary,
    policyVersion: cleanString(source.policyVersion, 'tenant-boundary.v1')
  };
}

function canTenant(scope, permission) {
  return scope.permissions.includes(permission);
}

function normalizeCommandList(input = {}) {
  const commands = Array.isArray(input.commands)
    ? input.commands
    : input.command && typeof input.command === 'object'
      ? [input.command]
      : [];

  return commands
    .filter((command) => command && typeof command === 'object')
    .map((command, index) => {
      const type = IDEMPOTENT_COMMANDS.has(command.type) ? command.type : 'recover_state';
      const target = cleanString(command.target || command.incidentId || command.handoffId, surfaceId);
      const idempotencyKey = cleanString(command.idempotencyKey || command.commandId, `${type}:${target}`);

      return {
        commandId: cleanString(command.commandId, `command-${index + 1}`),
        type,
        target,
        idempotencyKey,
        requestedAt: cleanString(command.requestedAt, null),
        tenantId: cleanString(command.tenantId || command.organizationId, null),
        workspaceId: cleanString(command.workspaceId || command.activeWorkspaceId, null),
        sourceRoute: cleanString(command.sourceRoute || command.route, null),
        cadence: cleanString(command.cadence || command.syncCadence || command.scheduleCadence, null),
        pausedUntil: cleanString(command.pausedUntil, null)
      };
    });
}

function resolveCommandRequiredPermission(commandType) {
  return COMMAND_PERMISSION_BY_TYPE[commandType] || 'taxonomy:read';
}

function requiresActiveWorkspace(command) {
  return WORKSPACE_MUTATING_COMMANDS.has(command.type);
}

function normalizeProvider(input = {}) {
  const provider = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const requested = normalizeStringList(
    provider.requestedCapabilities || provider.capabilitySet || SUPPORTED_PROVIDER_CAPABILITIES
  );
  const disabled = new Set(normalizeStringList(provider.disabledCapabilities));
  const supported = new Set(SUPPORTED_PROVIDER_CAPABILITIES.filter((capability) => !disabled.has(capability)));
  for (const capability of normalizeStringList(provider.supportedCapabilities)) {
    if (SUPPORTED_PROVIDER_CAPABILITIES.includes(capability) && !disabled.has(capability)) {
      supported.add(capability);
    }
  }
  const required = normalizeStringList(provider.requiredCapabilities || REQUIRED_PROVIDER_CAPABILITIES);
  const granted = requested.filter((capability) => supported.has(capability));
  const rejected = requested.filter((capability) => !supported.has(capability));
  const missingRequired = required.filter((capability) => !granted.includes(capability));
  const baseRoute = cleanString(provider.baseRoute || provider.route, '/audit-recovery/failure-taxonomy/provider');
  const handoffTransport = HANDOFF_TRANSPORTS.has(provider.handoffTransport) ? provider.handoffTransport : 'queue';

  return {
    providerId: cleanString(provider.providerId, DEFAULT_PROVIDER),
    service: cleanString(provider.service, 'audit-recovery'),
    contractVersion: cleanString(provider.contractVersion, '2026-07-01.failure-taxonomy.v1'),
    baseRoute,
    syncRoute: cleanString(provider.syncRoute, `${baseRoute}/sync`),
    proofRoute: cleanString(provider.proofRoute, `${baseRoute}/proofs`),
    handoffRoute: cleanString(provider.handoffRoute, `${baseRoute}/handoff`),
    handoffTransport,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      ...(provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {})
    },
    negotiation: {
      requested,
      granted,
      rejected,
      required,
      missingRequired,
      disabled: [...disabled],
      supported: [...supported],
      status: missingRequired.length ? 'rejected' : rejected.length ? 'partial' : 'accepted'
    }
  };
}

function buildProviderIntegrationManifest(provider, capabilityContracts, requestContext, lifecycleSettings, now) {
  const availableContracts = capabilityContracts.filter((contract) => contract.status === 'available');
  const blockedContracts = capabilityContracts.filter((contract) => contract.status !== 'available');
  const endpointBindings = capabilityContracts.map((contract) => {
    const schema = PROVIDER_ENDPOINT_SCHEMAS[contract.capability];
    const enabled = contract.status === 'available'
      && (contract.capability !== 'external-handoff' || lifecycleSettings.controls.allowExternalHandoff);
    const blockedReason = enabled
      ? null
      : contract.status === 'missing_required'
        ? 'required_capability_missing'
        : contract.capability === 'external-handoff' && !lifecycleSettings.controls.allowExternalHandoff
          ? 'external_handoff_disabled_by_lifecycle'
          : 'capability_not_negotiated';

    return {
      bindingType: 'hosted-kernel.failure-taxonomy.provider-endpoint-binding.v1',
      capability: contract.capability,
      contractType: contract.contractType,
      method: schema.method,
      route: contract.route,
      enabled,
      blockedReason,
      required: contract.required,
      requestSchema: schema.requestSchema,
      responseSchema: schema.responseSchema,
      idempotencyScope: schema.idempotencyScope,
      idempotencyHeader: 'x-aios-idempotency-key',
      requiredHeaders: [
        'x-aios-request-id',
        'x-aios-tenant-id',
        'x-aios-workspace-id',
        'x-aios-provider-contract-version'
      ],
      proofFields: contract.proofFields
    };
  });
  const syncBinding = endpointBindings.find((binding) => binding.capability === 'sync-metadata');
  const handoffBinding = endpointBindings.find((binding) => binding.capability === 'external-handoff');

  return {
    manifestType: 'hosted-kernel.failure-taxonomy.provider-integration-manifest.v1',
    generatedAt: now,
    providerId: provider.providerId,
    service: provider.service,
    contractVersion: provider.contractVersion,
    requestBinding: {
      requestId: requestContext.requestId,
      route: requestContext.route,
      clientId: requestContext.clientId,
      stateVersion: requestContext.stateVersion
    },
    endpointCount: endpointBindings.length,
    enabledEndpointCount: endpointBindings.filter((binding) => binding.enabled).length,
    requiredEndpointCount: endpointBindings.filter((binding) => binding.required).length,
    blockedRequiredEndpoints: endpointBindings
      .filter((binding) => binding.required && !binding.enabled)
      .map((binding) => binding.capability),
    endpoints: endpointBindings,
    syncLease: {
      leaseType: 'hosted-kernel.failure-taxonomy.provider-sync-lease.v1',
      enabled: syncBinding?.enabled === true && lifecycleSettings.mode !== 'disabled',
      route: syncBinding?.route || provider.syncRoute,
      cursorHeader: 'x-aios-sync-cursor',
      pendingCountField: 'pendingIncidents',
      watermarkKind: provider.capabilities.syncWatermarkKind || DEFAULT_CAPABILITIES.syncWatermarkKind,
      cadence: lifecycleSettings.schedule.cadence,
      pauseReason: lifecycleSettings.mode === 'disabled'
        ? 'taxonomy_lifecycle_disabled'
        : lifecycleSettings.schedule.cadence === 'manual'
          ? 'manual_sync_schedule'
          : lifecycleSettings.schedule.pausedUntil
            ? 'sync_schedule_paused'
            : null
    },
    handoffDispatch: {
      dispatchType: 'hosted-kernel.failure-taxonomy.provider-handoff-dispatch.v1',
      enabled: handoffBinding?.enabled === true,
      route: handoffBinding?.route || provider.handoffRoute,
      transport: provider.handoffTransport,
      acknowledgementRoute: `${requestContext.route}/handoff/ack`,
      acknowledgementSchema: 'hosted-kernel.failure-taxonomy.handoff-ack-command.v1',
      stateField: 'status',
      terminalStates: ['acknowledged', 'rejected', 'expired'],
      retryableStates: ['pending_ack', 'blocked_lifecycle']
    },
    negotiationProof: {
      proofType: 'hosted-kernel.failure-taxonomy.provider-negotiation-proof.v1',
      requestedCapabilities: provider.negotiation.requested,
      grantedCapabilities: provider.negotiation.granted,
      rejectedCapabilities: provider.negotiation.rejected,
      unavailableRequiredCapabilities: capabilityContracts
        .filter((contract) => contract.required && contract.status !== 'available')
        .map((contract) => contract.capability),
      failClosed: blockedContracts.some((contract) => contract.required),
      downgradeMode: blockedContracts.some((contract) => contract.required)
        ? 'provider_contract_blocked'
        : blockedContracts.length
          ? 'optional_capability_degraded'
          : 'full_contract'
    },
    sourceBacked: {
      capabilityCatalog: SUPPORTED_PROVIDER_CAPABILITIES,
      requiredCapabilityCatalog: REQUIRED_PROVIDER_CAPABILITIES,
      lifecycleMode: lifecycleSettings.mode,
      syncCadence: lifecycleSettings.schedule.cadence,
      availableContractTypes: availableContracts.map((contract) => contract.contractType)
    }
  };
}

function buildProviderServiceContract(provider, requestContext, lifecycleSettings, now) {
  const granted = new Set(provider.negotiation.granted);
  const required = new Set(provider.negotiation.required);
  const capabilityContracts = SUPPORTED_PROVIDER_CAPABILITIES.map((capability) => {
    const definition = PROVIDER_CAPABILITY_CONTRACTS[capability];
    const route = `${provider.baseRoute}/${definition.routeSuffix}`;
    const status = granted.has(capability)
      ? 'available'
      : required.has(capability)
        ? 'missing_required'
        : 'not_negotiated';

    return {
      capability,
      contractType: definition.contractType,
      status,
      required: required.has(capability),
      route,
      obligations: definition.obligations,
      proofFields: definition.obligations.map((obligation) => `${capability}:${obligation}`)
    };
  });
  const unavailableRequired = capabilityContracts
    .filter((contract) => contract.required && contract.status !== 'available')
    .map((contract) => contract.capability);
  const syncMetadata = {
    metadataType: 'hosted-kernel.provider-sync-metadata.v1',
    accepted: granted.has('sync-metadata'),
    enabled: granted.has('sync-metadata') && lifecycleSettings.mode !== 'disabled',
    cursorRequired: granted.has('sync-metadata'),
    watermarkKind: provider.capabilities.syncWatermarkKind || DEFAULT_CAPABILITIES.syncWatermarkKind,
    cadence: lifecycleSettings.schedule.cadence,
    providerRoute: provider.syncRoute,
    lastNegotiatedAt: now
  };
  const handoffAccepted = granted.has('external-handoff') && provider.capabilities.supportsExternalHandoff !== false;
  const externalHandoff = {
    handoffType: 'hosted-kernel.provider-external-handoff.v1',
    accepted: handoffAccepted,
    enabled: handoffAccepted && lifecycleSettings.controls.allowExternalHandoff,
    transport: provider.handoffTransport,
    providerRoute: provider.handoffRoute,
    acknowledgementRoute: `${requestContext.route}/handoff/ack`,
    clientPreference: requestContext.handoffPreference,
    acknowledgementContract: {
      commandType: 'ack_handoff',
      requestSchema: PROVIDER_ENDPOINT_SCHEMAS['external-handoff'].requestSchema,
      responseSchema: 'hosted-kernel.failure-taxonomy.handoff-ack-response.v1',
      idempotencyScope: PROVIDER_ENDPOINT_SCHEMAS['external-handoff'].idempotencyScope
    }
  };
  const integrationManifest = buildProviderIntegrationManifest(
    provider,
    capabilityContracts,
    requestContext,
    lifecycleSettings,
    now
  );

  return {
    contractType: 'hosted-kernel.provider-service-contract.v1',
    service: provider.service,
    providerId: provider.providerId,
    contractVersion: provider.contractVersion,
    status: unavailableRequired.length ? 'blocked' : provider.negotiation.status,
    baseRoute: provider.baseRoute,
    requiredCapabilities: provider.negotiation.required,
    unavailableRequiredCapabilities: unavailableRequired,
    capabilityContracts,
    integrationManifest,
    syncMetadata,
    externalHandoff,
    proof: {
      proofRoute: provider.proofRoute,
      emitsAuditProof: granted.has('audit-proof') && provider.capabilities.emitsAuditProof !== false,
      requiredProofFields: capabilityContracts
        .filter((contract) => contract.required || contract.status === 'available')
        .flatMap((contract) => contract.proofFields)
    }
  };
}

function normalizeRequestContext(input = {}, now) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const source = { ...client, ...request };
  const channel = CLIENT_CHANNELS.has(source.channel) ? source.channel : 'api';
  const handoffPreference = HANDOFF_PREFERENCES.has(source.handoffPreference)
    ? source.handoffPreference
    : 'inline';
  const route = cleanString(source.route, '/audit-recovery/failure-taxonomy');
  const clientCapabilities = normalizeStringList(source.capabilities || source.clientCapabilities);

  return {
    requestId: cleanString(source.requestId || source.id, `request:${surfaceId}:${now}`),
    clientId: cleanString(source.clientId, 'hosted-kernel-client'),
    sessionId: cleanString(source.sessionId, `session:${surfaceId}`),
    channel,
    view: cleanString(source.view, 'recovery-preview'),
    locale: cleanString(source.locale, 'en-US'),
    timeZone: cleanString(source.timeZone, 'UTC'),
    route,
    activeIncidentId: cleanString(source.activeIncidentId || source.selectedIncidentId, null),
    requestedIncidentIds: normalizeStringList(source.requestedIncidentIds || source.incidentIds),
    handoffPreference,
    callbackRoute: cleanString(source.callbackRoute || source.webhookRoute || source.webhookUrl, null),
    returnRoute: cleanString(source.returnRoute || source.redirectRoute, `${route}/preview`),
    clientCapabilities,
    delivery: {
      supportsStreaming: source.supportsStreaming === true || clientCapabilities.includes('streaming'),
      supportsCommandLinks: source.supportsCommandLinks !== false && !clientCapabilities.includes('no-command-links'),
      supportsExternalCallbacks: Boolean(source.callbackRoute || source.webhookRoute || source.webhookUrl)
        || clientCapabilities.includes('external-callbacks')
    },
    stateVersion: cleanString(source.stateVersion, 'failure-taxonomy.client-state.v1')
  };
}

function normalizeIncident(raw = {}, index = 0, now) {
  const product = raw.product && typeof raw.product === 'object' ? raw.product : {};
  const mailchimp = raw.mailchimp && typeof raw.mailchimp === 'object'
    ? raw.mailchimp
    : product.mailchimp && typeof product.mailchimp === 'object'
      ? product.mailchimp
      : {};
  const campaign = mailchimp.campaign && typeof mailchimp.campaign === 'object' ? mailchimp.campaign : {};
  const audience = mailchimp.audience && typeof mailchimp.audience === 'object' ? mailchimp.audience : {};
  const severity = FAILURE_SEVERITY.has(raw.severity) ? raw.severity : 'warning';
  const recoveryMode = RECOVERY_MODES.has(raw.recoveryMode) ? raw.recoveryMode : 'observe';
  const incidentId = cleanString(raw.incidentId, `incident-${index + 1}`);
  const failureCode = cleanString(raw.failureCode || raw.code, 'unclassified_failure');
  const campaignId = cleanString(raw.campaignId || campaign.campaignId || campaign.id || mailchimp.campaignId, null);
  const audienceId = cleanString(raw.audienceId || raw.listId || audience.audienceId || audience.listId || audience.id || mailchimp.audienceId || mailchimp.listId, null);
  const templateId = cleanString(raw.templateId || mailchimp.templateId, null);
  const observedAt = cleanString(raw.observedAt, now);
  const mailchimpEvidenceRefs = [
    campaignId ? `mailchimp:campaign:${campaignId}` : null,
    audienceId ? `mailchimp:audience:${audienceId}` : null,
    templateId ? `mailchimp:template:${templateId}` : null
  ].filter(Boolean);

  return {
    incidentId,
    failureCode,
    severity,
    recoveryMode,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : recoveryMode === 'retry',
    observedAt,
    tenantId: cleanString(raw.tenantId || raw.organizationId, 'default-tenant'),
    workspaceId: cleanString(raw.workspaceId, 'default-workspace'),
    domain: cleanString(raw.domain, campaignId || audienceId ? 'mailchimp' : surfaceGroup),
    route: cleanString(raw.route, campaignId || audienceId
      ? 'hosted-kernel.audit-recovery.failure-taxonomy.mailchimp'
      : 'hosted-kernel.audit-recovery.failure-taxonomy'),
    evidenceRefs: [
      ...(Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs.filter(Boolean) : []),
      ...mailchimpEvidenceRefs
    ],
    productContext: {
      type: campaignId || audienceId ? 'MailchimpCampaignAuditIncident.v1' : null,
      campaignId,
      audienceId,
      templateId,
      sendWindowStart: cleanString(mailchimp.sendWindowStart || campaign.sendWindowStart, null),
      sendWindowEnd: cleanString(mailchimp.sendWindowEnd || campaign.sendWindowEnd, null)
    }
  };
}

function collectEvidenceReferenceTokens(entry, index) {
  if (typeof entry === 'string' && entry.trim()) {
    return [entry.trim()];
  }
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  return [
    entry.evidenceId,
    entry.ref,
    entry.uri,
    entry.url,
    entry.auditTrailId,
    entry.incidentId ? `incident:${entry.incidentId}` : null,
    ...(Array.isArray(entry.refs) ? entry.refs : []),
    ...(Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : []),
    `evidence:${index + 1}`
  ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

function normalizeEvidenceRecords(evidence = [], tenantScope) {
  return evidence
    .map((entry, index) => {
      const tokens = collectEvidenceReferenceTokens(entry, index);
      if (!tokens.length) {
        return null;
      }
      const objectEntry = entry && typeof entry === 'object' ? entry : {};
      const tenantId = cleanString(objectEntry.tenantId || objectEntry.organizationId, tenantScope.tenantId);
      const workspaceId = cleanString(objectEntry.workspaceId, tenantScope.activeWorkspaceId);
      const incidentId = cleanString(objectEntry.incidentId, null);
      const tenantScoped = tenantId === tenantScope.tenantId;
      const workspaceScoped = tenantScope.allowedWorkspaceIds.includes(workspaceId);
      const activeWorkspaceScoped = workspaceId === tenantScope.activeWorkspaceId;
      const scopeStatus = !tenantScoped
        ? 'tenant_mismatch'
        : !workspaceScoped
          ? 'workspace_not_allowed'
          : !activeWorkspaceScoped
            ? 'workspace_not_active'
            : 'in_scope';

      return {
        evidenceType: 'hosted-kernel.failure-taxonomy.scoped-evidence-record.v1',
        evidenceId: cleanString(objectEntry.evidenceId || objectEntry.id, `evidence-${index + 1}`),
        refs: [...new Set(tokens)],
        tenantId,
        workspaceId,
        incidentId,
        scopeStatus,
        usableForProof: scopeStatus === 'in_scope',
        source: typeof entry === 'string' ? 'inline_ref' : cleanString(objectEntry.source, 'audit_evidence')
      };
    })
    .filter(Boolean);
}

function buildEvidenceReferenceIndex(evidenceRecords = []) {
  const byRef = new Map();
  for (const record of evidenceRecords) {
    for (const ref of record.refs) {
      const existing = byRef.get(ref) || [];
      existing.push(record);
      byRef.set(ref, existing);
    }
  }

  return {
    records: evidenceRecords,
    byRef,
    inScopeCount: evidenceRecords.filter((record) => record.usableForProof).length,
    outOfScopeCount: evidenceRecords.filter((record) => !record.usableForProof).length
  };
}

function resolveRegisteredFailureClass(incident) {
  return BASE_FAILURE_CLASSES.find((failureClass) => failureClass.code === incident.failureCode)
    || BASE_FAILURE_CLASSES.find((failureClass) => failureClass.recoveryMode === incident.recoveryMode && failureClass.severity === incident.severity)
    || null;
}

function resolveScopedEvidenceMatches(incident, evidenceIndex) {
  const candidateRefs = incident.evidenceRefs.map((ref) => String(ref));
  const matchedRecords = candidateRefs.flatMap((ref) =>
    (evidenceIndex.byRef.get(ref) || []).map((record) => ({ ref, record }))
  );
  const acceptedMatches = matchedRecords.filter(({ record }) =>
    record.usableForProof && (!record.incidentId || record.incidentId === incident.incidentId)
  );
  const rejectedMatches = matchedRecords.filter(({ record }) =>
    !record.usableForProof || record.incidentId && record.incidentId !== incident.incidentId
  );

  return {
    matchedRefs: [...new Set(acceptedMatches.map((match) => match.ref))],
    rejectedRefs: [...new Set(rejectedMatches.map((match) => match.ref))],
    rejectedReasons: [...new Set(rejectedMatches.map(({ record }) =>
      record.incidentId && record.incidentId !== incident.incidentId
        ? 'incident_mismatch'
        : record.scopeStatus
    ))],
    acceptedEvidenceIds: [...new Set(acceptedMatches.map(({ record }) => record.evidenceId))],
    evidenceMatched: acceptedMatches.length > 0
  };
}

function buildProofFieldCoverage(incident, failureClass, evidenceIndex, providerServiceContract) {
  const requiredFields = failureClass?.proofRequired || ['incidentId', 'failureCode', 'evidenceRefs'];
  const scopedEvidence = resolveScopedEvidenceMatches(incident, evidenceIndex);
  const fieldValues = {
    auditTrailId: incident.evidenceRefs.find((ref) => String(ref).includes('audit')) || null,
    capabilitySet: providerServiceContract.capabilityContracts
      .filter((contract) => contract.status === 'available')
      .map((contract) => contract.capability),
    contractVersion: providerServiceContract.contractVersion,
    failureCode: incident.failureCode,
    handoffId: `${providerServiceContract.providerId}:${incident.incidentId}`,
    incidentId: incident.incidentId,
    campaignId: incident.productContext?.campaignId || null,
    audienceId: incident.productContext?.audienceId || null,
    templateId: incident.productContext?.templateId || null,
    lastSyncedAt: providerServiceContract.syncMetadata.lastNegotiatedAt,
    owner: 'audit-recovery-provider',
    providerId: providerServiceContract.providerId,
    status: providerServiceContract.externalHandoff.enabled ? 'pending_ack' : providerServiceContract.externalHandoff.accepted ? 'blocked_lifecycle' : 'blocked_contract',
    watermark: providerServiceContract.syncMetadata.watermarkKind
  };
  const missingFields = requiredFields.filter((field) => {
    if (field === 'evidenceRefs') {
      return incident.evidenceRefs.length === 0 || !scopedEvidence.evidenceMatched;
    }
    const value = fieldValues[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });

  return {
    coverageType: 'hosted-kernel.failure-taxonomy.proof-field-coverage.v1',
    requiredFields,
    presentFields: requiredFields.filter((field) => !missingFields.includes(field)),
    missingFields,
    evidenceMatched: scopedEvidence.evidenceMatched,
    evidenceRefs: incident.evidenceRefs,
    scopedEvidenceRefs: scopedEvidence.matchedRefs,
    rejectedEvidenceRefs: scopedEvidence.rejectedRefs,
    rejectedEvidenceReasons: scopedEvidence.rejectedReasons,
    acceptedEvidenceIds: scopedEvidence.acceptedEvidenceIds,
    evidenceScope: {
      required: true,
      accepted: scopedEvidence.evidenceMatched,
      inScopeEvidenceCount: evidenceIndex.inScopeCount,
      outOfScopeEvidenceCount: evidenceIndex.outOfScopeCount
    }
  };
}

function buildTaxonomyDecisions(incidents, evidenceIndex, providerServiceContract, lifecycleSettings) {

  return incidents.map((incident) => {
    const failureClass = resolveRegisteredFailureClass(incident);
    const proofCoverage = buildProofFieldCoverage(incident, failureClass, evidenceIndex, providerServiceContract);
    const registered = Boolean(failureClass);
    const providerBlocked = providerServiceContract.status === 'blocked';
    const proofBlocked = lifecycleSettings.controls.requireProofBeforePublish && proofCoverage.missingFields.length > 0;
    const recoveryMode = failureClass?.recoveryMode || incident.recoveryMode;
    const recommendedAction = providerBlocked
      ? 'repair_provider_contract'
      : proofBlocked
        ? 'attach_required_audit_proof'
        : recoveryMode === 'retry'
          ? 'retry_provider_sync'
          : recoveryMode === 'handoff'
            ? 'prepare_external_handoff'
            : recoveryMode === 'quarantine'
              ? 'quarantine_until_proof_restored'
              : 'observe_taxonomy_state';

    return {
      decisionType: 'hosted-kernel.failure-taxonomy.classification-decision.v1',
      incidentId: incident.incidentId,
      failureCode: incident.failureCode,
      registered,
      classificationSource: registered ? 'registered_failure_class' : 'incident_runtime_signal',
      severity: failureClass?.severity || incident.severity,
      recoveryMode,
      retryable: typeof failureClass?.retryable === 'boolean' ? failureClass.retryable : incident.retryable,
      productContext: incident.productContext,
      productHandoff: incident.productContext?.type ? {
        contract: 'hosted-kernel.failure-taxonomy.mailchimp-handoff.v1',
        campaignId: incident.productContext.campaignId,
        audienceId: incident.productContext.audienceId,
        route: `${providerServiceContract.baseRoute}/mailchimp/campaigns/${encodeURIComponent(incident.productContext.campaignId || 'unbound')}/handoff`,
        requiredEvidenceRefs: proofCoverage.requiredFields
          .filter((field) => ['campaignId', 'audienceId', 'auditTrailId'].includes(field)),
        scheduleWindow: {
          start: incident.productContext.sendWindowStart,
          end: incident.productContext.sendWindowEnd
        }
      } : null,
      proofCoverage,
      providerContractStatus: providerServiceContract.status,
      publishable: registered && !providerBlocked && !proofBlocked,
      recommendedAction,
      acceptanceImpact: !registered
        ? 'review_required'
        : providerBlocked || proofBlocked
          ? 'blocking'
          : incident.severity === 'critical'
            ? 'handoff_required'
            : 'none'
    };
  });
}

function applyTenantBoundary(tenantScope, incidents, commands) {
  const allowedWorkspaceSet = new Set(tenantScope.allowedWorkspaceIds);
  const visibleIncidents = [];
  const deniedIncidents = [];
  const workspaceLedger = new Map(tenantScope.allowedWorkspaceIds.map((workspaceId) => [workspaceId, {
    workspaceId,
    allowed: true,
    visibleIncidentIds: [],
    deniedIncidentIds: [],
    commandIds: []
  }]));

  for (const incident of incidents) {
    const sameTenant = incident.tenantId === tenantScope.tenantId;
    const workspaceAllowed = allowedWorkspaceSet.has(incident.workspaceId);
    const workspaceEntry = workspaceLedger.get(incident.workspaceId) || {
      workspaceId: incident.workspaceId,
      allowed: workspaceAllowed,
      visibleIncidentIds: [],
      deniedIncidentIds: [],
      commandIds: []
    };

    if (sameTenant && workspaceAllowed) {
      visibleIncidents.push(incident);
      workspaceEntry.visibleIncidentIds.push(incident.incidentId);
    } else {
      deniedIncidents.push({
        incidentId: incident.incidentId,
        tenantId: incident.tenantId,
        workspaceId: incident.workspaceId,
        reason: sameTenant ? 'workspace_not_allowed' : 'tenant_mismatch'
      });
      workspaceEntry.deniedIncidentIds.push(incident.incidentId);
    }
    workspaceLedger.set(incident.workspaceId, workspaceEntry);
  }

  const visibleIncidentIds = new Set(visibleIncidents.map((incident) => incident.incidentId));
  const incidentById = new Map(incidents.map((incident) => [incident.incidentId, incident]));
  const visibleIncidentById = new Map(visibleIncidents.map((incident) => [incident.incidentId, incident]));
  const commandDecisions = commands.map((command) => {
    const explicitTenantOk = !command.tenantId || command.tenantId === tenantScope.tenantId;
    const explicitWorkspaceOk = !command.workspaceId || allowedWorkspaceSet.has(command.workspaceId);
    const directIncident = incidentById.get(command.target);
    const handoffIncidentId = [...visibleIncidentIds].find((incidentId) => command.target.endsWith(`:${incidentId}`));
    const targetIncident = directIncident || visibleIncidentById.get(handoffIncidentId);
    const targetVisible = command.target === surfaceId
      || visibleIncidentIds.has(command.target)
      || Boolean(handoffIncidentId);
    const targetWorkspaceId = command.workspaceId || targetIncident?.workspaceId || tenantScope.activeWorkspaceId;
    const requiredPermission = resolveCommandRequiredPermission(command.type);
    const mutatesWorkspace = requiresActiveWorkspace(command);
    const workspaceActivationRequired = mutatesWorkspace
      && targetWorkspaceId !== tenantScope.activeWorkspaceId
      && allowedWorkspaceSet.has(targetWorkspaceId);
    const workspaceEntry = workspaceLedger.get(targetWorkspaceId) || {
      workspaceId: targetWorkspaceId,
      allowed: allowedWorkspaceSet.has(targetWorkspaceId),
      visibleIncidentIds: [],
      deniedIncidentIds: [],
      commandIds: []
    };
    workspaceEntry.commandIds.push(command.commandId);
    workspaceLedger.set(targetWorkspaceId, workspaceEntry);
    const allowed = tenantScope.boundary === 'tenant_local'
      && explicitTenantOk
      && explicitWorkspaceOk
      && targetVisible
      && !workspaceActivationRequired
      && canTenant(tenantScope, requiredPermission);
    const reason = tenantScope.boundary !== 'tenant_local'
      ? 'cross_tenant_boundary_blocked'
      : !explicitTenantOk
        ? 'requested_tenant_mismatch'
        : !explicitWorkspaceOk
          ? 'requested_workspace_not_allowed'
          : !targetVisible
            ? 'target_outside_tenant_workspace_scope'
            : workspaceActivationRequired
              ? 'workspace_activation_required'
            : allowed
              ? 'tenant_permission_granted'
              : 'tenant_permission_missing';

    return {
      commandId: command.commandId,
      target: command.target,
      type: command.type,
      requestedTenantId: command.tenantId,
      requestedWorkspaceId: command.workspaceId,
      targetWorkspaceId,
      requiredPermission,
      mutatesWorkspace,
      workspaceActivationRequired,
      allowed,
      reason,
      workspaceSwitch: workspaceActivationRequired ? {
        switchType: 'hosted-kernel.failure-taxonomy.workspace-activation-required.v1',
        currentWorkspaceId: tenantScope.activeWorkspaceId,
        requiredWorkspaceId: targetWorkspaceId,
        activationRoute: `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${targetWorkspaceId}/activate`,
        resumeCommandId: command.commandId,
        safeToOffer: tenantScope.boundary === 'tenant_local' && allowedWorkspaceSet.has(targetWorkspaceId)
      } : null,
      auditHandoff: {
        proofRoute: command.sourceRoute || `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${targetWorkspaceId}/commands/${command.commandId}`,
        boundary: tenantScope.boundary,
        policyVersion: tenantScope.policyVersion,
        restartSafe: true,
        disclosure: reason === 'target_outside_tenant_workspace_scope' || reason === 'requested_tenant_mismatch'
          ? 'redacted_boundary_denial'
          : 'scoped_command_decision'
      }
    };
  });
  const workspaceAccess = [...workspaceLedger.values()].map((entry) => ({
    workspaceId: entry.workspaceId,
    allowed: entry.allowed && tenantScope.boundary === 'tenant_local',
    active: entry.workspaceId === tenantScope.activeWorkspaceId,
    visibleIncidentCount: entry.visibleIncidentIds.length,
    hiddenIncidentCount: entry.deniedIncidentIds.length,
    commandCount: entry.commandIds.length,
    visibleIncidentIds: entry.visibleIncidentIds,
    hiddenIncidentIds: entry.deniedIncidentIds,
    commandIds: entry.commandIds,
    handoffRoute: `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${entry.workspaceId}/handoff`
  }));
  const readable = tenantScope.boundary === 'tenant_local' && canTenant(tenantScope, 'taxonomy:read');
  const activationRequiredDecisions = commandDecisions.filter((decision) => decision.workspaceActivationRequired);
  const activationWorkspaceIds = [...new Set(activationRequiredDecisions.map((decision) => decision.targetWorkspaceId))];
  const boundaryHandoff = {
    handoffType: 'hosted-kernel.failure-taxonomy.workspace-boundary-handoff.v1',
    tenantId: tenantScope.tenantId,
    activeWorkspaceId: tenantScope.activeWorkspaceId,
    readable,
    failClosed: tenantScope.boundary !== 'tenant_local' || !readable,
    safeDisclosure: {
      hiddenIncidentDisclosure: 'counts_only',
      commandDisclosure: 'decision_reason_and_workspace_only',
      includeDeniedTenantIds: false,
      includeDeniedWorkspaceIds: readable && tenantScope.boundary === 'tenant_local'
    },
    activationRequiredCount: activationRequiredDecisions.length,
    activationWorkspaceIds,
    activationLinks: activationWorkspaceIds.map((workspaceId) => ({
      workspaceId,
      route: `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${workspaceId}/activate`,
      commandIds: activationRequiredDecisions
        .filter((decision) => decision.targetWorkspaceId === workspaceId)
        .map((decision) => decision.commandId),
      resumable: readable && allowedWorkspaceSet.has(workspaceId)
    })),
    hiddenIncidentSummary: workspaceAccess
      .filter((workspace) => workspace.hiddenIncidentCount > 0)
      .map((workspace) => ({
        workspaceId: readable && workspace.allowed ? workspace.workspaceId : 'redacted',
        hiddenIncidentCount: workspace.hiddenIncidentCount,
        reason: workspace.allowed ? 'not_visible_in_active_scope' : 'workspace_not_allowed'
      })),
    deniedCommandSummary: commandDecisions
      .filter((decision) => !decision.allowed)
      .map((decision) => ({
        commandId: decision.commandId,
        type: decision.type,
        reason: decision.reason,
        targetWorkspaceId: readable && allowedWorkspaceSet.has(decision.targetWorkspaceId)
          ? decision.targetWorkspaceId
          : 'redacted',
        requiredPermission: decision.requiredPermission,
        activationRoute: decision.workspaceSwitch?.activationRoute || null
      }))
  };

  return {
    visibleIncidents,
    deniedIncidents,
    commandDecisions,
    workspaceAccess,
    boundaryHandoff,
    readable,
    proofReadable: readable && canTenant(tenantScope, 'audit:proof:read'),
    boundaryProof: {
      proofType: 'hosted-kernel.failure-taxonomy.tenant-workspace-boundary.v1',
      tenantId: tenantScope.tenantId,
      activeWorkspaceId: tenantScope.activeWorkspaceId,
      boundary: tenantScope.boundary,
      policyVersion: tenantScope.policyVersion,
      allowedWorkspaceIds: tenantScope.allowedWorkspaceIds,
      visibleIncidentCount: visibleIncidents.length,
      hiddenIncidentCount: deniedIncidents.length,
      commandDecisionCount: commandDecisions.length,
      blockedCommandCount: commandDecisions.filter((decision) => !decision.allowed).length,
      activationRequiredCount: activationRequiredDecisions.length,
      failClosed: boundaryHandoff.failClosed,
      disclosureMode: boundaryHandoff.safeDisclosure.hiddenIncidentDisclosure,
      handoffRequired: deniedIncidents.length > 0 || commandDecisions.some((decision) => !decision.allowed)
    }
  };
}

function chooseVisibleIncidents(requestContext, incidents) {
  const incidentIds = new Set(incidents.map((incident) => incident.incidentId));
  const requestedIds = requestContext.requestedIncidentIds.length
    ? requestContext.requestedIncidentIds
    : requestContext.activeIncidentId
      ? [requestContext.activeIncidentId]
      : [];
  const missingRequestedIncidentIds = requestedIds.filter((incidentId) => !incidentIds.has(incidentId));
  const selectedIncidentIds = requestedIds.filter((incidentId) => incidentIds.has(incidentId));
  const visibleIncidents = selectedIncidentIds.length
    ? incidents.filter((incident) => selectedIncidentIds.includes(incident.incidentId))
    : incidents;

  return {
    selectedIncidentIds,
    missingRequestedIncidentIds,
    visibleIncidents
  };
}

function buildSyncState(input = {}, now, lifecycleSettings, providerServiceContract) {
  const sync = input.sync && typeof input.sync === 'object' ? input.sync : {};
  const lastSyncedAt = cleanString(sync.lastSyncedAt, null);
  const cursor = cleanString(sync.cursor || sync.watermark, `taxonomy:${surfaceId}:${now}`);
  const pendingIncidents = Number.isFinite(sync.pendingIncidents) ? Math.max(0, sync.pendingIncidents) : 0;
  const schedulePaused = lifecycleSettings.mode === 'disabled'
    || Boolean(lifecycleSettings.schedule.pausedUntil)
    || lifecycleSettings.schedule.cadence === 'manual';
  const contractAccepted = providerServiceContract.syncMetadata.accepted;

  return {
    status: !contractAccepted ? 'blocked' : pendingIncidents > 0 ? 'catching_up' : 'current',
    lastSyncedAt,
    cursor,
    pendingIncidents,
    nextSyncReason: lifecycleSettings.mode === 'disabled'
      ? 'taxonomy_lifecycle_disabled'
      : !contractAccepted
        ? 'provider_sync_contract_unavailable'
      : lifecycleSettings.schedule.cadence === 'manual'
        ? 'manual_schedule_requires_command'
        : lifecycleSettings.schedule.pausedUntil
          ? 'sync_schedule_paused'
          : pendingIncidents > 0
            ? 'provider_incident_backlog'
            : 'steady_state',
    schedule: {
      cadence: lifecycleSettings.schedule.cadence,
      paused: schedulePaused,
      pausedUntil: lifecycleSettings.schedule.pausedUntil,
      nextRunAfter: lifecycleSettings.schedule.nextRunAfter,
      retryWindowMinutes: lifecycleSettings.schedule.retryWindowMinutes
    },
    providerMetadata: {
      contractType: providerServiceContract.syncMetadata.metadataType,
      accepted: providerServiceContract.syncMetadata.accepted,
      providerRoute: providerServiceContract.syncMetadata.providerRoute,
      watermarkKind: providerServiceContract.syncMetadata.watermarkKind,
      cursorRequired: providerServiceContract.syncMetadata.cursorRequired,
      lastNegotiatedAt: providerServiceContract.syncMetadata.lastNegotiatedAt
    },
    clock: {
      generatedAt: now,
      source: 'hosted-kernel'
    }
  };
}

function buildLifecycleControls(lifecycleSettings, syncState, handoff, validationStatus = 'unknown') {
  const disabled = lifecycleSettings.mode === 'disabled';
  const maintenance = lifecycleSettings.mode === 'maintenance';
  const schedulePaused = syncState.schedule.paused;
  const proofBlocked = lifecycleSettings.controls.requireProofBeforePublish && validationStatus === 'blocked';

  return {
    state: disabled ? 'disabled' : maintenance ? 'maintenance' : schedulePaused ? 'sync_paused' : 'active',
    commands: {
      retry_sync: {
        enabled: !disabled && !maintenance && !schedulePaused && lifecycleSettings.controls.allowRetrySync && syncState.pendingIncidents > 0,
        reason: disabled
          ? 'taxonomy_disabled'
          : maintenance
            ? 'maintenance_mode_blocks_retry'
            : schedulePaused
              ? 'sync_schedule_paused'
              : !lifecycleSettings.controls.allowRetrySync
                ? 'retry_sync_disabled_by_settings'
                : syncState.pendingIncidents > 0
                  ? 'sync_backlog_available'
                  : 'no_sync_backlog'
      },
      ack_handoff: {
        enabled: !disabled && lifecycleSettings.controls.allowExternalHandoff && handoff.queue.some((item) => item.status === 'pending_ack'),
        reason: disabled
          ? 'taxonomy_disabled'
          : !lifecycleSettings.controls.allowExternalHandoff
            ? 'external_handoff_disabled_by_settings'
            : handoff.queue.some((item) => item.status === 'pending_ack')
              ? 'handoff_queue_available'
              : 'no_handoff_queue'
      },
      publish_preview: {
        enabled: !disabled && !maintenance && lifecycleSettings.controls.allowPublish && !proofBlocked,
        reason: disabled
          ? 'taxonomy_disabled'
          : maintenance
            ? 'maintenance_mode_blocks_publish'
            : !lifecycleSettings.controls.allowPublish
              ? 'publish_disabled_by_settings'
              : proofBlocked
                ? 'audit_proof_required_before_publish'
                : 'publish_allowed_by_settings'
      },
      settings_manage: {
        enabled: true,
        reason: 'settings_commands_are_ledgered_and_permission_checked'
      }
    }
  };
}

function resolveLifecycleCommandIntent(command, lifecycleSettings) {
  if (command.type === 'enable_taxonomy') {
    return {
      mode: 'enabled',
      cadence: lifecycleSettings.schedule.cadence === 'manual' ? 'every_15m' : lifecycleSettings.schedule.cadence,
      pausedUntil: null,
      action: 'enable_failure_taxonomy'
    };
  }
  if (command.type === 'disable_taxonomy') {
    return {
      mode: 'disabled',
      cadence: lifecycleSettings.schedule.cadence,
      pausedUntil: lifecycleSettings.schedule.pausedUntil,
      action: 'disable_failure_taxonomy'
    };
  }
  if (command.type === 'set_sync_schedule') {
    const rawCadence = cleanString(command.cadence || command.syncCadence || command.scheduleCadence, lifecycleSettings.schedule.cadence);
    const cadence = SYNC_CADENCES.has(rawCadence) ? rawCadence : lifecycleSettings.schedule.cadence;
    return {
      mode: lifecycleSettings.mode,
      cadence,
      requestedCadence: rawCadence,
      pausedUntil: cadence === 'manual' ? null : cleanString(command.pausedUntil, null),
      action: cadence === 'manual' ? 'pause_automatic_sync' : 'set_failure_taxonomy_sync_schedule'
    };
  }
  return null;
}

function buildLifecycleTransitionPlan(commands, lifecycleSettings, syncState, handoff, providerServiceContract, tenantBoundary, requestContext, persistedRecovery, now) {
  const commandBoundary = new Map(tenantBoundary.commandDecisions.map((decision) => [decision.commandId, decision]));
  const lifecycleCommands = commands
    .map((command) => ({ command, intent: resolveLifecycleCommandIntent(command, lifecycleSettings) }))
    .filter((entry) => entry.intent);
  let proposedMode = lifecycleSettings.mode;
  let proposedCadence = lifecycleSettings.schedule.cadence;
  let proposedPausedUntil = lifecycleSettings.schedule.pausedUntil;
  const transitions = lifecycleCommands.map(({ command, intent }, index) => {
    const boundaryDecision = commandBoundary.get(command.commandId);
    const blockers = [
      !boundaryDecision?.allowed ? boundaryDecision?.reason || 'tenant_command_denied' : null,
      !providerServiceContract.syncMetadata.accepted && command.type !== 'disable_taxonomy' ? 'provider_sync_metadata_unavailable' : null,
      command.type === 'disable_taxonomy' && handoff.queue.some((item) => item.status === 'pending_ack') ? 'handoff_ack_pending_before_disable' : null,
      command.type === 'set_sync_schedule' && !SYNC_CADENCES.has(intent.requestedCadence) ? 'unsupported_sync_cadence' : null
    ].filter(Boolean);
    const appliedToProjection = blockers.length === 0;

    if (appliedToProjection) {
      proposedMode = intent.mode;
      proposedCadence = intent.cadence;
      proposedPausedUntil = intent.pausedUntil;
    }

    return {
      transitionType: 'hosted-kernel.failure-taxonomy.lifecycle-transition.v1',
      transitionId: `lifecycle-transition-${index + 1}`,
      commandId: command.commandId,
      commandType: command.type,
      action: intent.action,
      target: command.target,
      requestedAt: command.requestedAt,
      allowed: Boolean(boundaryDecision?.allowed),
      appliedToProjection,
      blockers,
      from: {
        mode: lifecycleSettings.mode,
        cadence: lifecycleSettings.schedule.cadence,
        pausedUntil: lifecycleSettings.schedule.pausedUntil
      },
      to: {
        mode: intent.mode,
        cadence: intent.cadence,
        requestedCadence: intent.requestedCadence || intent.cadence,
        pausedUntil: intent.pausedUntil
      },
      command: {
        type: command.type,
        target: command.target,
        route: `${requestContext.route}/settings/lifecycle`,
        idempotencyKey: `${command.idempotencyKey}:lifecycle:${persistedRecovery.generation}`,
        enabled: blockers.length === 0
      },
      proofRefs: [
        boundaryDecision?.auditHandoff.proofRoute,
        providerServiceContract.syncMetadata.providerRoute,
        `${requestContext.route}/proofs/${encodeURIComponent(requestContext.requestId)}`
      ].filter(Boolean)
    };
  });
  const projectedSchedulePaused = proposedMode === 'disabled' || proposedCadence === 'manual' || Boolean(proposedPausedUntil);
  const nextAction = transitions.find((transition) => transition.blockers.length > 0)
    ? 'resolve_lifecycle_transition_blocker'
    : proposedMode === 'disabled'
      ? 'enable_failure_taxonomy'
      : syncState.pendingIncidents > 0 && !projectedSchedulePaused
        ? 'retry_provider_sync'
        : handoff.queue.some((item) => item.status === 'pending_ack')
          ? 'acknowledge_external_handoff'
          : 'monitor_lifecycle_state';

  return {
    planType: 'hosted-kernel.failure-taxonomy.lifecycle-transition-plan.v1',
    generatedAt: now,
    route: `${requestContext.route}/settings/lifecycle`,
    commandCount: lifecycleCommands.length,
    transitionCount: transitions.length,
    blockedTransitionCount: transitions.filter((transition) => transition.blockers.length > 0).length,
    state: transitions.some((transition) => transition.blockers.length > 0)
      ? 'blocked'
      : transitions.some((transition) => transition.appliedToProjection)
        ? 'projected'
        : 'idle',
    current: {
      mode: lifecycleSettings.mode,
      enabled: lifecycleSettings.enabled,
      cadence: lifecycleSettings.schedule.cadence,
      pausedUntil: lifecycleSettings.schedule.pausedUntil,
      acceptsMutatingCommands: lifecycleSettings.acceptsMutatingCommands
    },
    projected: {
      mode: proposedMode,
      enabled: proposedMode === 'enabled',
      cadence: proposedCadence,
      pausedUntil: proposedPausedUntil,
      schedulePaused: projectedSchedulePaused,
      nextRunAfter: projectedSchedulePaused ? null : lifecycleSettings.schedule.nextRunAfter
    },
    controlsAfterProjection: {
      allowRetrySync: proposedMode === 'enabled' && proposedCadence !== 'manual' && providerServiceContract.syncMetadata.accepted,
      allowPublish: proposedMode === 'enabled' && lifecycleSettings.controls.allowPublish,
      allowExternalHandoff: proposedMode !== 'disabled' && lifecycleSettings.controls.allowExternalHandoff,
      settingsManageRoute: `${requestContext.route}/settings/lifecycle`
    },
    nextAction,
    transitions,
    proof: {
      proofType: 'hosted-kernel.failure-taxonomy.lifecycle-transition-proof.v1',
      requestId: requestContext.requestId,
      generation: persistedRecovery.generation,
      providerSyncAccepted: providerServiceContract.syncMetadata.accepted,
      pendingHandoffCount: handoff.queue.filter((item) => item.status === 'pending_ack').length,
      allCommandsPermissionChecked: lifecycleCommands.every(({ command }) => commandBoundary.has(command.commandId)),
      projectionConsistent: transitions.every((transition) =>
        transition.blockers.length > 0 || LIFECYCLE_MODES.has(transition.to.mode) && SYNC_CADENCES.has(transition.to.cadence)
      )
    }
  };
}

function normalizePersistedFailureTaxonomyState(input = {}) {
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const previous = persisted.failureTaxonomy && typeof persisted.failureTaxonomy === 'object'
    ? persisted.failureTaxonomy
    : persisted;
  const previousCommandLedger = previous.commandLedger && typeof previous.commandLedger === 'object'
    ? previous.commandLedger
    : {};
  const previousSnapshot = previous.snapshot && typeof previous.snapshot === 'object' ? previous.snapshot : {};
  const storedRecoveryCursor = previous.recoveryCursor && typeof previous.recoveryCursor === 'object'
    ? previous.recoveryCursor
    : {};
  const generation = normalizePositiveInteger(previous.generation, 0, 0);
  const appliedKeys = normalizeStringList(previousCommandLedger.appliedKeys);
  const lastResults = Array.isArray(previousCommandLedger.results)
    ? previousCommandLedger.results
      .filter((result) => result && typeof result === 'object')
      .slice(-20)
      .map((result, index) => ({
        commandId: cleanString(result.commandId, `restored-command-${index + 1}`),
        type: IDEMPOTENT_COMMANDS.has(result.type) ? result.type : 'recover_state',
        target: cleanString(result.target, surfaceId),
        idempotencyKey: cleanString(result.idempotencyKey, `${cleanString(result.type, 'recover_state')}:${cleanString(result.target, surfaceId)}`),
        status: cleanString(result.status, 'restored'),
        reason: cleanString(result.reason, 'restored_from_persisted_ledger')
      }))
    : [];

  return {
    raw: previous,
    restored: Object.keys(previous).length > 0,
    status: PERSISTED_WORKFLOW_STATES.has(previous.status) ? previous.status : 'new',
    statusChangedAt: cleanString(previous.statusChangedAt, null),
    resumeToken: cleanString(previous.resumeToken, null),
    generation,
    commandLedger: {
      appliedKeys,
      lastCommandStatus: cleanString(previousCommandLedger.lastCommandStatus, lastResults[lastResults.length - 1]?.status || 'none'),
      restoredResultCount: lastResults.length,
      restoredResults: lastResults
    },
    snapshot: {
      tenantId: cleanString(previousSnapshot.tenantId, null),
      workspaceId: cleanString(previousSnapshot.workspaceId, null),
      providerId: cleanString(previousSnapshot.providerId, null),
      sessionId: cleanString(previousSnapshot.sessionId, null),
      syncCursor: cleanString(previousSnapshot.syncCursor || storedRecoveryCursor.cursor, null),
      incidentIds: normalizeStringList(previousSnapshot.incidentIds),
      handoffIds: normalizeStringList(previousSnapshot.handoffIds)
    },
    writeModelVersion: cleanString(previous.writeModel?.version || previous.writeModelVersion, null)
  };
}

function buildRestartConsistency(previousState, requestContext, provider, incidents, syncState, handoff, tenantScope) {
  const currentIncidentIds = incidents.map((incident) => incident.incidentId);
  const currentHandoffIds = handoff.queue.map((item) => item.handoffId);
  const incidentSet = new Set(currentIncidentIds);
  const handoffSet = new Set(currentHandoffIds);
  const checks = [
    {
      check: 'tenant_scope_matches',
      ok: !previousState.snapshot.tenantId || previousState.snapshot.tenantId === tenantScope.tenantId,
      previous: previousState.snapshot.tenantId,
      current: tenantScope.tenantId
    },
    {
      check: 'workspace_scope_matches',
      ok: !previousState.snapshot.workspaceId || previousState.snapshot.workspaceId === tenantScope.activeWorkspaceId,
      previous: previousState.snapshot.workspaceId,
      current: tenantScope.activeWorkspaceId
    },
    {
      check: 'provider_matches',
      ok: !previousState.snapshot.providerId || previousState.snapshot.providerId === provider.providerId,
      previous: previousState.snapshot.providerId,
      current: provider.providerId
    },
    {
      check: 'session_matches',
      ok: !previousState.snapshot.sessionId || previousState.snapshot.sessionId === requestContext.sessionId,
      previous: previousState.snapshot.sessionId,
      current: requestContext.sessionId
    },
    {
      check: 'cursor_monotonic',
      ok: !previousState.snapshot.syncCursor || previousState.snapshot.syncCursor === syncState.cursor || syncState.pendingIncidents > 0,
      previous: previousState.snapshot.syncCursor,
      current: syncState.cursor
    },
    {
      check: 'incident_snapshot_intersects',
      ok: previousState.snapshot.incidentIds.length === 0 || previousState.snapshot.incidentIds.some((incidentId) => incidentSet.has(incidentId)),
      previous: previousState.snapshot.incidentIds,
      current: currentIncidentIds
    },
    {
      check: 'handoff_snapshot_rejoinable',
      ok: previousState.snapshot.handoffIds.length === 0 || previousState.snapshot.handoffIds.some((handoffId) => handoffSet.has(handoffId)),
      previous: previousState.snapshot.handoffIds,
      current: currentHandoffIds
    }
  ];
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.check);

  return {
    proofType: 'hosted-kernel.failure-taxonomy.restart-consistency.v1',
    restored: previousState.restored,
    consistent: failedChecks.length === 0,
    failedChecks,
    checks,
    recoveredIncidentIds: previousState.snapshot.incidentIds.filter((incidentId) => incidentSet.has(incidentId)),
    recoveredHandoffIds: previousState.snapshot.handoffIds.filter((handoffId) => handoffSet.has(handoffId))
  };
}

function resolvePersistedStatusSemantics(status, runtimeStatus, restartConsistency, commandResults, lifecycleSettings) {
  const appliedCommands = commandResults.filter((result) => result.status === 'applied');
  const blockedCommands = commandResults.filter((result) => result.status === 'blocked');
  const duplicateCommands = commandResults.filter((result) => result.status === 'duplicate_noop');
  const terminal = status === 'recovered' || status === 'blocked';
  const durable = restartConsistency.consistent
    && PERSISTED_WORKFLOW_STATES.has(status)
    && lifecycleSettings.validation.valid;

  return {
    semanticsType: 'hosted-kernel.failure-taxonomy.persisted-status-semantics.v1',
    status,
    runtimeStatus,
    terminal,
    durable,
    restartVisible: true,
    clientRetryRecommended: !terminal && (status === 'catching_up' || status === 'awaiting_handoff_ack'),
    operatorInterventionRequired: status === 'blocked' || !restartConsistency.consistent || blockedCommands.length > 0,
    reason: !restartConsistency.consistent
      ? 'restart_snapshot_requires_reconcile'
      : status === 'recovered'
        ? 'handoff_acknowledged_or_no_pending_work'
        : status === 'blocked'
          ? 'recovery_blocked_by_lifecycle_or_critical_incident'
          : status === 'catching_up'
            ? 'provider_sync_backlog_pending'
            : status === 'awaiting_handoff_ack'
              ? 'external_handoff_waiting_for_acknowledgement'
              : status === 'current'
                ? 'taxonomy_state_current'
                : 'state_restored_for_reconciliation',
    commandOutcomeCounts: {
      applied: appliedCommands.length,
      blocked: blockedCommands.length,
      duplicateNoop: duplicateCommands.length
    },
    lastAppliedCommandId: appliedCommands[appliedCommands.length - 1]?.commandId || null,
    blockedCommandIds: blockedCommands.map((result) => result.commandId)
  };
}

function buildPersistenceWriteIntent(previousState, currentStatus, statusChangedAt, resumeToken, requestContext, provider, syncState, tenantScope, commandResults, restartConsistency, recoveryPaths, now) {
  const appliedResults = commandResults.filter((result) => result.status === 'applied');
  const blockedResults = commandResults.filter((result) => result.status === 'blocked');
  const duplicateResults = commandResults.filter((result) => result.status === 'duplicate_noop');
  const nextGeneration = previousState.generation + 1;
  const revisionParts = [
    tenantScope.tenantId,
    tenantScope.activeWorkspaceId,
    provider.providerId,
    requestContext.sessionId,
    syncState.cursor,
    currentStatus,
    nextGeneration
  ];
  const shouldPersist = !previousState.restored
    || previousState.status !== currentStatus
    || previousState.snapshot.syncCursor !== syncState.cursor
    || appliedResults.length > 0
    || blockedResults.length > 0
    || !restartConsistency.consistent;
  const replayableResults = commandResults
    .filter((result) => result.status === 'applied' || result.status === 'duplicate_noop')
    .slice(-10);

  return {
    intentType: 'hosted-kernel.failure-taxonomy.persistence-write-intent.v1',
    operation: shouldPersist ? 'upsert_snapshot' : 'read_through_noop',
    shouldPersist,
    generatedAt: now,
    storagePartition: `${tenantScope.tenantId}/${tenantScope.activeWorkspaceId}/${provider.providerId}`,
    revisionKey: revisionParts.map((part) => encodeURIComponent(String(part))).join(':'),
    expectedPreviousGeneration: previousState.generation,
    nextGeneration,
    statusChangedAt,
    resumeToken,
    idempotency: {
      scope: 'tenant-workspace-provider-session',
      replaySafe: true,
      duplicateCommandCount: duplicateResults.length,
      appliedCommandKeys: appliedResults.map((result) => result.idempotencyKey),
      blockedCommandKeys: blockedResults.map((result) => result.idempotencyKey)
    },
    replayWindow: {
      windowType: 'hosted-kernel.failure-taxonomy.command-replay-window.v1',
      bounded: true,
      maxRetainedResults: 10,
      replayableCommandCount: replayableResults.length,
      replayableCommands: replayableResults.map((result) => ({
        commandId: result.commandId,
        type: result.type,
        target: result.target,
        idempotencyKey: result.idempotencyKey,
        priorStatus: result.status,
        route: result.type === 'ack_handoff'
          ? `${requestContext.route}/handoff/ack`
          : result.type === 'publish_preview'
            ? `${requestContext.route}/preview/acceptance`
            : `${requestContext.route}/commands`
      })),
      recoveryPathModes: recoveryPaths.filter((path) => path.available).map((path) => path.mode)
    },
    conflictPolicy: {
      policyType: 'hosted-kernel.failure-taxonomy.persistence-conflict-policy.v1',
      generationMismatch: restartConsistency.consistent ? 'reject_stale_write' : 'reconcile_snapshot_scope',
      cursorMismatch: syncState.pendingIncidents > 0 ? 'allow_catching_up_cursor' : 'require_matching_cursor',
      duplicateCommand: 'return_duplicate_noop',
      blockedCommand: 'persist_blocked_result_for_audit'
    },
    proofRefs: [
      `${requestContext.route}/proofs/${encodeURIComponent(requestContext.requestId)}`,
      `${requestContext.route}/state/${encodeURIComponent(resumeToken)}`,
      ...recoveryPaths.filter((path) => path.available).slice(0, 3).map((path) => path.command.route)
    ]
  };
}

function buildCommandReplayClaims(commandResults, previousState, restartConsistency, requestContext, syncState, tenantScope, lifecycleSettings, recoveryPaths, now) {
  const availableRecoveryPath = recoveryPaths.find((path) => path.available) || null;
  const claims = commandResults.map((result) => {
    const duplicate = result.status === 'duplicate_noop';
    const applied = result.status === 'applied';
    const blocked = result.status === 'blocked';
    const boundaryBlocked = blocked && [
      'cross_tenant_boundary_blocked',
      'requested_tenant_mismatch',
      'requested_workspace_not_allowed',
      'target_outside_tenant_workspace_scope',
      'tenant_permission_missing',
      'workspace_activation_required'
    ].includes(result.reason);
    const lifecycleBlocked = blocked && [
      'taxonomy_disabled',
      'maintenance_mode_blocks_retry',
      'sync_schedule_paused',
      'retry_sync_disabled_by_settings',
      'external_handoff_disabled_by_settings',
      'publish_disabled_by_settings',
      'audit_proof_required_before_publish'
    ].includes(result.reason);
    const targetReadyBlocked = blocked && !boundaryBlocked && !lifecycleBlocked;
    const staleRestart = previousState.restored && !restartConsistency.consistent;
    const replayable = duplicate || applied;
    const retryable = blocked
      && !boundaryBlocked
      && lifecycleSettings.mode !== 'disabled'
      && restartConsistency.consistent
      && result.type !== 'publish_preview';
    const blockers = [
      boundaryBlocked
        ? {
          code: result.reason,
          owner: 'tenant-admin',
          retryable: result.reason === 'workspace_activation_required',
          route: result.tenantBoundary?.targetWorkspaceId
            ? `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${result.tenantBoundary.targetWorkspaceId}/activate`
            : requestContext.route
        }
        : null,
      lifecycleBlocked
        ? {
          code: result.reason,
          owner: 'settings',
          retryable: lifecycleSettings.mode !== 'disabled',
          route: `${requestContext.route}/settings/lifecycle`
        }
        : null,
      targetReadyBlocked
        ? {
          code: result.reason || 'command_target_not_ready',
          owner: 'operator',
          retryable,
          route: `${requestContext.route}/commands`
        }
        : null,
      staleRestart
        ? {
          code: 'restart_snapshot_requires_reconcile',
          owner: 'hosted-kernel',
          retryable: Boolean(availableRecoveryPath),
          route: availableRecoveryPath?.command.route || `${requestContext.route}/state/reconcile`
        }
        : null
    ].filter(Boolean);
    const state = duplicate
      ? 'duplicate-return'
      : applied
        ? 'applied'
        : retryable && blockers.every((blocker) => blocker.retryable !== false)
          ? 'retryable-blocked'
          : blocked
            ? 'blocked'
            : 'observed';
    const nextCommand = state === 'retryable-blocked' && availableRecoveryPath
      ? {
        type: availableRecoveryPath.command.type,
        route: availableRecoveryPath.command.route,
        idempotencyKey: `${availableRecoveryPath.command.idempotencyKey}:${result.commandId}`,
        target: availableRecoveryPath.target
      }
      : state === 'duplicate-return'
        ? {
          type: result.type,
          route: `${requestContext.route}/commands/${encodeURIComponent(result.commandId)}`,
          idempotencyKey: result.idempotencyKey,
          target: result.target
        }
        : null;

    return {
      claimType: 'hosted-kernel.failure-taxonomy.command-replay-claim.v1',
      commandId: result.commandId,
      type: result.type,
      target: result.target,
      idempotencyKey: result.idempotencyKey,
      generatedAt: now,
      state,
      replayable,
      retryable,
      duplicate,
      restartSafe: result.restartSafe && restartConsistency.consistent,
      status: result.status,
      reason: result.reason,
      requiredPermission: result.requiredPermission,
      tenantBoundary: result.tenantBoundary,
      syncCursor: syncState.cursor,
      blockers,
      blockerCodes: blockers.map((blocker) => blocker.code),
      nextCommand,
      audit: {
        proofType: 'hosted-kernel.failure-taxonomy.command-replay-claim-proof.v1',
        requestId: requestContext.requestId,
        previousGeneration: previousState.generation,
        commandKeyPreviouslyApplied: previousState.commandLedger.appliedKeys.includes(result.idempotencyKey),
        restartConsistent: restartConsistency.consistent,
        failedRestartChecks: restartConsistency.failedChecks,
        recoveryPathMode: availableRecoveryPath?.mode || null
      }
    };
  });
  const replayableClaims = claims.filter((claim) => claim.replayable);
  const blockedClaims = claims.filter((claim) => claim.state === 'blocked' || claim.state === 'retryable-blocked');

  return {
    claimSetType: 'hosted-kernel.failure-taxonomy.command-replay-claim-set.v1',
    generatedAt: now,
    requestId: requestContext.requestId,
    tenantId: tenantScope.tenantId,
    workspaceId: tenantScope.activeWorkspaceId,
    cursor: syncState.cursor,
    commandCount: claims.length,
    replayableCount: replayableClaims.length,
    blockedCount: blockedClaims.length,
    duplicateCount: claims.filter((claim) => claim.duplicate).length,
    retryableBlockedCount: claims.filter((claim) => claim.state === 'retryable-blocked').length,
    claims,
    claimSummary: {
      replaySafe: blockedClaims.every((claim) => claim.retryable || claim.blockers.every((blocker) => blocker.retryable !== false)),
      requiresOperatorReview: blockedClaims.some((claim) => claim.blockers.some((blocker) => blocker.retryable === false)),
      nextRecoveryMode: availableRecoveryPath?.mode || 'none',
      nextRecoveryRoute: availableRecoveryPath?.command.route || null
    }
  };
}

function buildPersistedRecoveryState(input, now, requestContext, provider, incidents, syncState, handoff, tenantScope, tenantBoundary, lifecycleSettings, lifecycleControls) {
  const previousState = normalizePersistedFailureTaxonomyState(input);
  const restartConsistency = buildRestartConsistency(previousState, requestContext, provider, incidents, syncState, handoff, tenantScope);
  const appliedKeySet = new Set(previousState.commandLedger.appliedKeys);
  const commands = normalizeCommandList(input);
  const commandBoundary = new Map(tenantBoundary.commandDecisions.map((decision) => [decision.commandId, decision]));
  const commandResults = commands.map((command) => {
    const boundaryDecision = commandBoundary.get(command.commandId);
    const isDuplicate = appliedKeySet.has(command.idempotencyKey);
    const targetHandoff = handoff.queue.find((item) =>
      item.handoffId === command.target || item.incidentId === command.target
    );
    const commandReady = command.type === 'retry_sync'
      ? lifecycleControls.commands.retry_sync.enabled
      : command.type === 'ack_handoff'
        ? lifecycleControls.commands.ack_handoff.enabled && Boolean(targetHandoff)
        : command.type === 'publish_preview'
          ? lifecycleControls.commands.publish_preview.enabled && syncState.status === 'current' && handoff.queue.length === 0
          : command.type === 'enable_taxonomy' || command.type === 'disable_taxonomy' || command.type === 'set_sync_schedule'
            ? lifecycleControls.commands.settings_manage.enabled
            : lifecycleSettings.acceptsMutatingCommands;
    const allowed = Boolean(boundaryDecision?.allowed) && commandReady;

    if (!isDuplicate && allowed) {
      appliedKeySet.add(command.idempotencyKey);
    }

    return {
      ...command,
      status: isDuplicate ? 'duplicate_noop' : allowed ? 'applied' : 'blocked',
      restartSafe: true,
      reason: isDuplicate
        ? 'idempotency_key_already_applied'
        : allowed
          ? 'command_recorded_in_recovery_ledger'
          : boundaryDecision && !boundaryDecision.allowed
            ? boundaryDecision.reason
            : command.type === 'retry_sync'
              ? lifecycleControls.commands.retry_sync.reason
              : command.type === 'ack_handoff'
                ? lifecycleControls.commands.ack_handoff.reason
                : command.type === 'publish_preview'
                  ? lifecycleControls.commands.publish_preview.reason
                  : 'command_target_not_ready',
      requiredPermission: boundaryDecision?.requiredPermission || 'taxonomy:read',
      tenantBoundary: {
        tenantId: tenantScope.tenantId,
        workspaceId: tenantScope.activeWorkspaceId,
        targetWorkspaceId: boundaryDecision?.targetWorkspaceId || tenantScope.activeWorkspaceId,
        boundary: tenantScope.boundary,
        policyVersion: tenantScope.policyVersion
      }
    };
  });
  const runtimeStatus = lifecycleSettings.mode === 'disabled'
    ? 'blocked'
    : handoff.queue.length
    ? 'awaiting_handoff_ack'
    : syncState.pendingIncidents > 0
      ? 'catching_up'
      : incidents.some((incident) => incident.severity === 'critical')
        ? 'blocked'
        : 'current';
  const currentStatus = previousState.restored && !restartConsistency.consistent
    ? 'restored'
    : commandResults.some((result) => result.status === 'applied' && result.type === 'ack_handoff') && handoff.queue.length === 0
      ? 'recovered'
      : runtimeStatus;
  const previousStatus = previousState.status;
  const statusChangedAt = previousStatus === currentStatus
    ? cleanString(previousState.statusChangedAt, now)
    : now;
  const resumeToken = cleanString(
    previousState.resumeToken,
    `${requestContext.sessionId}:${provider.providerId}:${syncState.cursor}`
  );
  const recoveryPaths = [
    {
      mode: 'resume_from_cursor',
      available: Boolean(syncState.cursor) && restartConsistency.failedChecks.every((check) => check !== 'tenant_scope_matches' && check !== 'provider_matches'),
      priority: syncState.pendingIncidents > 0 ? 20 : 40,
      reason: syncState.pendingIncidents > 0 ? 'cursor_has_pending_provider_backlog' : 'cursor_available',
      target: syncState.cursor,
      command: {
        type: 'recover_state',
        route: `${requestContext.route}/commands`,
        idempotencyKey: `recover_state:${syncState.cursor}:${previousState.generation + 1}`
      }
    },
    {
      mode: 'replay_idempotent_commands',
      available: appliedKeySet.size > 0 && lifecycleSettings.acceptsMutatingCommands,
      priority: commandResults.some((result) => result.status === 'duplicate_noop') ? 10 : 50,
      reason: appliedKeySet.size > 0 ? 'command_ledger_contains_applied_keys' : 'no_applied_command_keys',
      target: `${requestContext.route}/commands/replay`,
      command: {
        type: 'recover_state',
        route: `${requestContext.route}/commands/replay`,
        idempotencyKey: `recover_state:replay:${previousState.generation + 1}`
      }
    },
    {
      mode: 'external_handoff_rejoin',
      available: handoff.queue.length > 0 && restartConsistency.failedChecks.every((check) => check !== 'tenant_scope_matches'),
      priority: handoff.queue.some((item) => item.status === 'pending_ack') ? 5 : 60,
      reason: handoff.queue.length ? 'handoff_queue_rejoinable' : 'handoff_queue_empty',
      target: `${requestContext.route}/handoff`,
      command: {
        type: 'ack_handoff',
        route: `${requestContext.route}/handoff/ack`,
        idempotencyKey: `ack_handoff:${handoff.queue[0]?.handoffId || 'none'}:${previousState.generation + 1}`
      }
    },
    {
      mode: 'reconcile_snapshot_scope',
      available: previousState.restored && !restartConsistency.consistent,
      priority: 1,
      reason: restartConsistency.failedChecks.join(',') || 'snapshot_consistent',
      target: `${requestContext.route}/state/reconcile`,
      command: {
        type: 'recover_state',
        route: `${requestContext.route}/state/reconcile`,
        idempotencyKey: `recover_state:reconcile:${previousState.generation + 1}`
      }
    }
  ].sort((left, right) => left.priority - right.priority);
  const primaryRecoveryPath = recoveryPaths.find((path) => path.available) || recoveryPaths[0];
  const statusSemantics = resolvePersistedStatusSemantics(
    currentStatus,
    runtimeStatus,
    restartConsistency,
    commandResults,
    lifecycleSettings
  );
  const writeIntent = buildPersistenceWriteIntent(
    previousState,
    currentStatus,
    statusChangedAt,
    resumeToken,
    requestContext,
    provider,
    syncState,
    tenantScope,
    commandResults,
    restartConsistency,
    recoveryPaths,
    now
  );
  const commandReplay = buildCommandReplayClaims(
    commandResults,
    previousState,
    restartConsistency,
    requestContext,
    syncState,
    tenantScope,
    lifecycleSettings,
    recoveryPaths,
    now
  );

  return {
    stateType: 'hosted-kernel.failure-taxonomy.persisted-state.v1',
    storageKey: `audit-recovery/failure-taxonomy/${tenantScope.tenantId}/${tenantScope.activeWorkspaceId}/${provider.providerId}/${requestContext.sessionId}`,
    restored: previousState.restored,
    previousStatus,
    runtimeStatus,
    status: currentStatus,
    statusSemantics,
    statusChangedAt,
    resumeToken,
    restartSafe: true,
    generation: previousState.generation + 1,
    commandLedger: {
      appliedKeys: [...appliedKeySet],
      lastCommandStatus: commandResults[commandResults.length - 1]?.status || 'none',
      restoredResultCount: previousState.commandLedger.restoredResultCount,
      results: commandResults,
      replayClaims: commandReplay.claims,
      restoredResults: previousState.commandLedger.restoredResults
    },
    commandReplay,
    primaryRecoveryPath,
    recoveryPaths,
    restartConsistency,
    recoveryCursor: {
      cursorType: 'hosted-kernel.failure-taxonomy.recovery-cursor.v1',
      cursor: syncState.cursor,
      previousCursor: previousState.snapshot.syncCursor,
      pendingIncidents: syncState.pendingIncidents,
      providerRoute: syncState.providerMetadata.providerRoute,
      resumeToken,
      status: currentStatus,
      path: primaryRecoveryPath.mode
    },
    persistence: writeIntent,
    writeModel: {
      version: 'hosted-kernel.failure-taxonomy.persisted-write-model.v2',
      keyFields: ['tenantId', 'workspaceId', 'providerId', 'sessionId', 'resumeToken', 'generation', 'persistence.revisionKey'],
      idempotencyFields: ['commandLedger.appliedKeys', 'recoveryCursor.cursor', 'restartConsistency.failedChecks', 'persistence.idempotency.appliedCommandKeys'],
      nextPersistReason: commandResults.some((result) => result.status === 'applied')
        ? 'command_ledger_advanced'
        : previousState.restored
          ? 'restart_state_reshaped'
          : 'initial_state_snapshot'
    },
    snapshot: {
      tenantId: tenantScope.tenantId,
      workspaceId: tenantScope.activeWorkspaceId,
      providerId: provider.providerId,
      sessionId: requestContext.sessionId,
      boundary: tenantScope.boundary,
      workspaceAccess: tenantBoundary.workspaceAccess.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        allowed: workspace.allowed,
        visibleIncidentCount: workspace.visibleIncidentCount,
        hiddenIncidentCount: workspace.hiddenIncidentCount,
        commandCount: workspace.commandCount
      })),
      incidentIds: incidents.map((incident) => incident.incidentId),
      syncCursor: syncState.cursor,
      handoffIds: handoff.queue.map((item) => item.handoffId)
    }
  };
}

function buildHandoffState(incidents, provider, providerServiceContract) {
  const handoffIncidents = incidents.filter((incident) =>
    incident.recoveryMode === 'handoff' || incident.severity === 'critical'
  );
  const externalAccepted = providerServiceContract.externalHandoff.enabled;
  const blockedStatus = providerServiceContract.externalHandoff.accepted ? 'blocked_lifecycle' : 'blocked_contract';

  return {
    required: handoffIncidents.length > 0,
    state: handoffIncidents.length > 0
      ? externalAccepted
        ? 'external_action_required'
        : providerServiceContract.externalHandoff.accepted
          ? 'external_handoff_disabled'
          : 'external_contract_unavailable'
      : 'not_required',
    providerId: provider.providerId,
    externalContract: providerServiceContract.externalHandoff,
    queue: handoffIncidents.map((incident) => ({
      handoffId: `${provider.providerId}:${incident.incidentId}`,
      incidentId: incident.incidentId,
      failureCode: incident.failureCode,
      owner: 'audit-recovery-provider',
      status: externalAccepted ? 'pending_ack' : blockedStatus,
      transport: providerServiceContract.externalHandoff.transport,
      providerRoute: providerServiceContract.externalHandoff.providerRoute
    }))
  };
}

function buildAuditProof(now, provider, providerServiceContract, incidents, syncState, evidence, requestContext, persistedRecovery, tenantScope, tenantBoundary, lifecycleSettings, lifecycleTransitionPlan, taxonomyDecisions) {
  const blockingDecisions = taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'blocking');
  const evidenceScopeCounts = countBy(evidence, (record) => record.scopeStatus, [
    'in_scope',
    'workspace_not_active',
    'workspace_not_allowed',
    'tenant_mismatch'
  ]);

  return {
    proofType: 'failure-taxonomy-provider-contract',
    generatedAt: now,
    providerId: provider.providerId,
    contractVersion: provider.contractVersion,
    serviceContractType: providerServiceContract.contractType,
    providerContractStatus: providerServiceContract.status,
    requiredProofFields: providerServiceContract.proof.requiredProofFields,
    requestId: requestContext.requestId,
    clientStateVersion: requestContext.stateVersion,
    tenant: {
      tenantId: tenantScope.tenantId,
      workspaceId: tenantScope.activeWorkspaceId,
      role: tenantScope.role,
      policyVersion: tenantScope.policyVersion,
      boundary: tenantScope.boundary,
      workspaceAccess: tenantBoundary.workspaceAccess.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        allowed: workspace.allowed,
        active: workspace.active,
        visibleIncidentCount: workspace.visibleIncidentCount,
        hiddenIncidentCount: workspace.hiddenIncidentCount,
        commandCount: workspace.commandCount
      }))
    },
    tenantBoundaryProof: tenantBoundary.boundaryProof,
    workspaceBoundaryHandoff: tenantBoundary.boundaryHandoff,
    incidentCount: incidents.length,
    deniedIncidentCount: tenantBoundary.deniedIncidents.length,
    syncCursor: syncState.cursor,
    lifecycle: {
      mode: lifecycleSettings.mode,
      syncCadence: lifecycleSettings.schedule.cadence,
      settingsValid: lifecycleSettings.validation.valid,
      transitionPlanState: lifecycleTransitionPlan.state,
      projectedMode: lifecycleTransitionPlan.projected.mode,
      projectedCadence: lifecycleTransitionPlan.projected.cadence
    },
    lifecycleTransitionProof: lifecycleTransitionPlan.proof,
    providerIntegrationProof: providerServiceContract.integrationManifest.negotiationProof,
    evidenceCount: evidence.length,
    evidenceScope: {
      proofType: 'hosted-kernel.failure-taxonomy.evidence-scope-proof.v1',
      totalEvidenceRecords: evidence.length,
      inScopeEvidenceCount: evidence.filter((record) => record.usableForProof).length,
      outOfScopeEvidenceCount: evidence.filter((record) => !record.usableForProof).length,
      scopeCounts: evidenceScopeCounts,
      rejectedEvidenceRefs: taxonomyDecisions.flatMap((decision) =>
        decision.proofCoverage.rejectedEvidenceRefs.map((ref) => `${decision.incidentId}:${ref}`)
      )
    },
    taxonomyDecisionCount: taxonomyDecisions.length,
    taxonomyDecisionDigest: taxonomyDecisions.map((decision) => ({
      incidentId: decision.incidentId,
      registered: decision.registered,
      publishable: decision.publishable,
      recommendedAction: decision.recommendedAction,
      missingProofFields: decision.proofCoverage.missingFields
    })),
    assertions: [
      {
        name: 'taxonomy_classes_registered',
        ok: BASE_FAILURE_CLASSES.every((item) => item.code && item.recoveryMode)
      },
      {
        name: 'provider_capability_negotiated',
        ok: providerServiceContract.status === 'accepted' || providerServiceContract.status === 'partial',
        rejected: provider.negotiation.rejected,
        unavailableRequiredCapabilities: providerServiceContract.unavailableRequiredCapabilities
      },
      {
        name: 'provider_service_contract_obligations_declared',
        ok: providerServiceContract.capabilityContracts
          .filter((contract) => contract.required || contract.status === 'available')
          .every((contract) => contract.contractType && contract.route && contract.obligations.length > 0),
        availableCapabilities: providerServiceContract.capabilityContracts
          .filter((contract) => contract.status === 'available')
          .map((contract) => contract.capability)
      },
      {
        name: 'provider_integration_manifest_endpoint_contracts_valid',
        ok: providerServiceContract.integrationManifest.endpoints.every((endpoint) =>
          endpoint.route
          && endpoint.method
          && endpoint.requestSchema
          && endpoint.responseSchema
          && endpoint.requiredHeaders.includes('x-aios-request-id')
        ) && providerServiceContract.integrationManifest.negotiationProof.failClosed === (
          providerServiceContract.integrationManifest.negotiationProof.unavailableRequiredCapabilities.length > 0
        ),
        enabledEndpointCount: providerServiceContract.integrationManifest.enabledEndpointCount,
        blockedRequiredEndpoints: providerServiceContract.integrationManifest.blockedRequiredEndpoints,
        downgradeMode: providerServiceContract.integrationManifest.negotiationProof.downgradeMode
      },
      {
        name: 'sync_metadata_contract_available',
        ok: providerServiceContract.syncMetadata.accepted && syncState.providerMetadata.accepted,
        providerRoute: providerServiceContract.syncMetadata.providerRoute,
        watermarkKind: providerServiceContract.syncMetadata.watermarkKind
      },
      {
        name: 'external_handoff_contract_matches_queue',
        ok: providerServiceContract.externalHandoff.accepted
          || incidents.every((incident) => incident.recoveryMode !== 'handoff' && incident.severity !== 'critical'),
        transport: providerServiceContract.externalHandoff.transport,
        providerRoute: providerServiceContract.externalHandoff.providerRoute
      },
      {
        name: 'critical_incidents_have_handoff',
        ok: incidents.every((incident) => incident.severity !== 'critical' || incident.recoveryMode === 'quarantine' || incident.recoveryMode === 'handoff')
      },
      {
        name: 'client_request_bound_to_taxonomy_route',
        ok: requestContext.route.includes('/audit-recovery') && requestContext.route.includes('failure-taxonomy'),
        route: requestContext.route
      },
      {
        name: 'tenant_workspace_boundary_enforced',
        ok: tenantScope.boundary === 'tenant_local'
          && incidents.every((incident) =>
            incident.tenantId === tenantScope.tenantId
            && tenantScope.allowedWorkspaceIds.includes(incident.workspaceId)
          ),
        workspaceAccess: tenantBoundary.workspaceAccess.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          allowed: workspace.allowed,
          visibleIncidentCount: workspace.visibleIncidentCount,
          hiddenIncidentCount: workspace.hiddenIncidentCount
        })),
        deniedIncidentIds: tenantBoundary.deniedIncidents.map((incident) => incident.incidentId)
      },
      {
        name: 'mutating_commands_permission_checked',
        ok: tenantBoundary.commandDecisions.every((decision) =>
          decision.allowed
          || decision.reason === 'tenant_permission_missing'
          || decision.reason === 'target_outside_tenant_workspace_scope'
          || decision.reason === 'workspace_activation_required'
          || decision.reason === 'requested_workspace_not_allowed'
          || decision.reason === 'requested_tenant_mismatch'
          || decision.reason === 'cross_tenant_boundary_blocked'
        ),
        blockedCommandIds: tenantBoundary.commandDecisions
          .filter((decision) => !decision.allowed)
          .map((decision) => decision.commandId)
      },
      {
        name: 'tenant_boundary_handoff_declared',
        ok: tenantBoundary.boundaryProof.handoffRequired === (
          tenantBoundary.deniedIncidents.length > 0
          || tenantBoundary.commandDecisions.some((decision) => !decision.allowed)
        ),
        proofType: tenantBoundary.boundaryProof.proofType,
        blockedCommandCount: tenantBoundary.boundaryProof.blockedCommandCount,
        hiddenIncidentCount: tenantBoundary.boundaryProof.hiddenIncidentCount,
        activationRequiredCount: tenantBoundary.boundaryProof.activationRequiredCount,
        failClosed: tenantBoundary.boundaryProof.failClosed,
        disclosureMode: tenantBoundary.boundaryProof.disclosureMode
      },
      {
        name: 'workspace_activation_fail_closed_for_mutations',
        ok: tenantBoundary.commandDecisions.every((decision) =>
          !decision.mutatesWorkspace
          || decision.allowed
          || decision.reason !== 'workspace_activation_required'
          || decision.workspaceSwitch?.safeToOffer === true
        ) && tenantBoundary.boundaryHandoff.deniedCommandSummary.every((summary) =>
          summary.targetWorkspaceId === 'redacted'
          || tenantScope.allowedWorkspaceIds.includes(summary.targetWorkspaceId)
        ),
        activationRequiredCount: tenantBoundary.boundaryHandoff.activationRequiredCount,
        activationWorkspaceIds: tenantBoundary.boundaryHandoff.activationWorkspaceIds,
        hiddenIncidentDisclosure: tenantBoundary.boundaryHandoff.safeDisclosure.hiddenIncidentDisclosure,
        deniedCommandDisclosure: tenantBoundary.boundaryHandoff.safeDisclosure.commandDisclosure
      },
      {
        name: 'persisted_recovery_state_restart_safe',
        ok: persistedRecovery.restartSafe
          && Boolean(persistedRecovery.resumeToken)
          && PERSISTED_WORKFLOW_STATES.has(persistedRecovery.status)
          && persistedRecovery.statusSemantics.restartVisible === true
          && persistedRecovery.statusSemantics.status === persistedRecovery.status
          && persistedRecovery.persistence.nextGeneration === persistedRecovery.generation
          && persistedRecovery.persistence.replayWindow.bounded === true
          && persistedRecovery.recoveryPaths.some((path) => path.available)
          && persistedRecovery.restartConsistency.checks.every((check) => typeof check.ok === 'boolean')
          && persistedRecovery.primaryRecoveryPath.available === true,
        status: persistedRecovery.status,
        runtimeStatus: persistedRecovery.runtimeStatus,
        generation: persistedRecovery.generation,
        persistenceOperation: persistedRecovery.persistence.operation,
        revisionKey: persistedRecovery.persistence.revisionKey,
        replayableCommandCount: persistedRecovery.persistence.replayWindow.replayableCommandCount,
        primaryRecoveryPath: persistedRecovery.primaryRecoveryPath.mode,
        restartConsistent: persistedRecovery.restartConsistency.consistent,
        failedRestartChecks: persistedRecovery.restartConsistency.failedChecks
      },
      {
        name: 'command_replay_claims_bound_to_ledger',
        ok: persistedRecovery.commandReplay.commandCount === persistedRecovery.commandLedger.results.length
          && persistedRecovery.commandReplay.claims.every((claim) =>
            persistedRecovery.commandLedger.results.some((result) =>
              result.commandId === claim.commandId
              && result.idempotencyKey === claim.idempotencyKey
              && result.status === claim.status
            )
          )
          && persistedRecovery.commandReplay.claims.every((claim) =>
            claim.replayable
            || claim.blockerCodes.length > 0
            || claim.state === 'observed'
          ),
        commandCount: persistedRecovery.commandReplay.commandCount,
        replayableCount: persistedRecovery.commandReplay.replayableCount,
        blockedCount: persistedRecovery.commandReplay.blockedCount,
        duplicateCount: persistedRecovery.commandReplay.duplicateCount,
        retryableBlockedCount: persistedRecovery.commandReplay.retryableBlockedCount,
        nextRecoveryMode: persistedRecovery.commandReplay.claimSummary.nextRecoveryMode
      },
      {
        name: 'lifecycle_settings_validated',
        ok: lifecycleSettings.validation.valid
          && LIFECYCLE_MODES.has(lifecycleSettings.mode)
          && SYNC_CADENCES.has(lifecycleSettings.schedule.cadence),
        mode: lifecycleSettings.mode,
        cadence: lifecycleSettings.schedule.cadence,
        invalidFields: lifecycleSettings.validation.invalidFields
      },
      {
        name: 'lifecycle_transition_projection_auditable',
        ok: lifecycleTransitionPlan.proof.allCommandsPermissionChecked
          && lifecycleTransitionPlan.proof.projectionConsistent,
        state: lifecycleTransitionPlan.state,
        commandCount: lifecycleTransitionPlan.commandCount,
        blockedTransitionCount: lifecycleTransitionPlan.blockedTransitionCount,
        projectedMode: lifecycleTransitionPlan.projected.mode,
        projectedCadence: lifecycleTransitionPlan.projected.cadence
      },
      {
        name: 'taxonomy_decisions_publishable_or_reviewable',
        ok: blockingDecisions.length === 0,
        blockingIncidentIds: blockingDecisions.map((decision) => decision.incidentId),
        reviewIncidentIds: taxonomyDecisions
          .filter((decision) => decision.acceptanceImpact === 'review_required')
          .map((decision) => decision.incidentId)
      },
      {
        name: 'evidence_refs_scoped_to_active_workspace',
        ok: taxonomyDecisions.every((decision) => decision.proofCoverage.rejectedEvidenceRefs.length === 0),
        inScopeEvidenceCount: evidence.filter((record) => record.usableForProof).length,
        outOfScopeEvidenceCount: evidence.filter((record) => !record.usableForProof).length,
        rejectedEvidenceRefs: taxonomyDecisions.flatMap((decision) =>
          decision.proofCoverage.rejectedEvidenceRefs.map((ref) => `${decision.incidentId}:${ref}`)
        )
      }
    ]
  };
}

function summarizeValidation(provider, providerServiceContract, incidents, syncState, evidence, auditProof, requestContext, selection, tenantScope, tenantBoundary, lifecycleSettings, lifecycleTransitionPlan, taxonomyDecisions) {
  const issues = [];
  const unclassified = incidents.filter((incident) => incident.failureCode === 'unclassified_failure');
  const missingEvidence = incidents.filter((incident) => incident.evidenceRefs.length === 0);
  const blockedCapabilities = provider.negotiation.rejected;
  const unregisteredDecisions = taxonomyDecisions.filter((decision) => !decision.registered);
  const proofBlockedDecisions = taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'blocking');
  const evidenceScopeMismatches = taxonomyDecisions.filter((decision) =>
    decision.proofCoverage.rejectedEvidenceRefs.length > 0
  );

  if (!lifecycleSettings.validation.valid) {
    issues.push({
      code: 'lifecycle_settings_invalid',
      severity: 'critical',
      message: 'Failure taxonomy lifecycle settings contained unsupported values and were normalized by the hosted kernel.',
      refs: lifecycleSettings.validation.invalidFields
    });
  }

  if (lifecycleSettings.mode === 'disabled') {
    issues.push({
      code: 'taxonomy_lifecycle_disabled',
      severity: 'critical',
      message: 'Failure taxonomy lifecycle controls are disabled; mutating recovery actions are blocked until re-enabled.',
      refs: ['enable_taxonomy']
    });
  }

  if (lifecycleSettings.mode === 'maintenance') {
    issues.push({
      code: 'taxonomy_lifecycle_maintenance',
      severity: 'warning',
      message: 'Failure taxonomy is in maintenance mode; publish and retry controls remain unavailable.',
      refs: ['lifecycle.mode']
    });
  }

  if (lifecycleSettings.schedule.cadence === 'manual' || lifecycleSettings.schedule.pausedUntil) {
    issues.push({
      code: 'taxonomy_sync_schedule_paused',
      severity: syncState.pendingIncidents > 0 ? 'degraded' : 'warning',
      message: 'Failure taxonomy sync schedule is paused or manual and requires an explicit lifecycle command.',
      refs: [lifecycleSettings.schedule.pausedUntil || lifecycleSettings.schedule.cadence]
    });
  }

  if (lifecycleTransitionPlan.blockedTransitionCount > 0) {
    issues.push({
      code: 'lifecycle_transition_blocked',
      severity: 'critical',
      message: 'One or more lifecycle settings commands could not be projected into hosted-kernel recovery state.',
      refs: lifecycleTransitionPlan.transitions
        .filter((transition) => transition.blockers.length > 0)
        .map((transition) => `${transition.commandId}:${transition.blockers.join(',')}`)
    });
  }

  if (blockedCapabilities.length) {
    issues.push({
      code: 'provider_capability_rejected',
      severity: 'warning',
      message: 'Provider rejected one or more requested failure-taxonomy capabilities.',
      refs: blockedCapabilities
    });
  }

  if (providerServiceContract.unavailableRequiredCapabilities.length) {
    issues.push({
      code: 'provider_required_contract_unavailable',
      severity: 'critical',
      message: 'Provider service contract is missing required hosted-kernel failure-taxonomy capabilities.',
      refs: providerServiceContract.unavailableRequiredCapabilities
    });
  }

  if (!providerServiceContract.syncMetadata.accepted) {
    issues.push({
      code: 'provider_sync_metadata_unavailable',
      severity: 'critical',
      message: 'Provider cannot supply the sync metadata contract required for restart-safe taxonomy recovery.',
      refs: [providerServiceContract.syncMetadata.providerRoute]
    });
  }

  if (incidents.some((incident) => incident.recoveryMode === 'handoff' || incident.severity === 'critical') && !providerServiceContract.externalHandoff.accepted) {
    issues.push({
      code: 'provider_external_handoff_unavailable',
      severity: 'critical',
      message: 'Provider cannot accept the external handoff contract required by critical or handoff incidents.',
      refs: [providerServiceContract.externalHandoff.providerRoute]
    });
  }

  if (unclassified.length) {
    issues.push({
      code: 'unclassified_incidents_present',
      severity: 'degraded',
      message: 'Some incidents do not have a source failure code and need taxonomy review.',
      refs: unclassified.map((incident) => incident.incidentId)
    });
  }

  if (unregisteredDecisions.length) {
    issues.push({
      code: 'taxonomy_class_unregistered',
      severity: 'degraded',
      message: 'One or more incidents do not match a registered hosted-kernel failure taxonomy class.',
      refs: unregisteredDecisions.map((decision) => decision.incidentId)
    });
  }

  if (proofBlockedDecisions.length) {
    issues.push({
      code: 'taxonomy_decision_proof_incomplete',
      severity: 'critical',
      message: 'One or more taxonomy decisions are missing required proof fields before preview publication.',
      refs: proofBlockedDecisions.map((decision) => `${decision.incidentId}:${decision.proofCoverage.missingFields.join(',')}`)
    });
  }

  if (evidenceScopeMismatches.length) {
    issues.push({
      code: 'evidence_scope_mismatch',
      severity: 'critical',
      message: 'One or more incident evidence references resolve outside the active tenant workspace proof scope.',
      refs: evidenceScopeMismatches.flatMap((decision) =>
        decision.proofCoverage.rejectedEvidenceRefs.map((ref) => `${decision.incidentId}:${ref}`)
      )
    });
  }

  if (missingEvidence.length) {
    issues.push({
      code: 'incident_evidence_missing',
      severity: 'warning',
      message: 'One or more incidents have no evidence references for preview drill-down.',
      refs: missingEvidence.map((incident) => incident.incidentId)
    });
  }

  if (syncState.pendingIncidents > 0) {
    issues.push({
      code: 'sync_backlog_present',
      severity: 'warning',
      message: 'Provider sync is catching up before the taxonomy can be accepted as current.',
      refs: [syncState.cursor]
    });
  }

  if (selection.missingRequestedIncidentIds.length) {
    issues.push({
      code: 'client_requested_incident_missing',
      severity: 'degraded',
      message: 'Client state references incidents that are not present in this hosted-kernel taxonomy response.',
      refs: selection.missingRequestedIncidentIds
    });
  }

  if (requestContext.channel === 'automation' && requestContext.handoffPreference === 'defer') {
    issues.push({
      code: 'automation_handoff_deferred',
      severity: 'warning',
      message: 'Automation clients should acknowledge or externalize recovery handoffs instead of deferring them.',
      refs: [requestContext.requestId]
    });
  }

  if (!tenantBoundary.readable) {
    issues.push({
      code: 'tenant_read_permission_missing',
      severity: 'critical',
      message: 'Tenant role does not grant read access to hosted-kernel failure taxonomy state.',
      refs: [tenantScope.role]
    });
  }

  if (tenantScope.boundary !== 'tenant_local') {
    issues.push({
      code: 'cross_tenant_boundary_requested',
      severity: 'critical',
      message: 'Cross-tenant failure taxonomy access is not allowed for hosted-kernel recovery responses.',
      refs: [tenantScope.tenantId]
    });
  }

  if (tenantBoundary.deniedIncidents.length) {
    issues.push({
      code: 'tenant_workspace_incidents_hidden',
      severity: 'warning',
      message: 'Some incidents were withheld because they are outside the tenant workspace boundary.',
      refs: tenantBoundary.deniedIncidents.map((incident) => incident.incidentId)
    });
  }

  const deniedCommands = tenantBoundary.commandDecisions.filter((decision) => !decision.allowed);
  if (deniedCommands.length) {
    const hardBoundaryReasons = new Set([
      'cross_tenant_boundary_blocked',
      'requested_tenant_mismatch',
      'requested_workspace_not_allowed',
      'target_outside_tenant_workspace_scope'
    ]);
    issues.push({
      code: 'tenant_command_denied',
      severity: deniedCommands.some((decision) => hardBoundaryReasons.has(decision.reason)) ? 'critical' : 'warning',
      message: 'One or more requested commands were blocked by tenant workspace scope or role permissions.',
      refs: deniedCommands.map((decision) => decision.commandId)
    });
  }

  const failedProofs = auditProof.assertions.filter((assertion) => !assertion.ok);
  if (failedProofs.length) {
    issues.push({
      code: 'audit_proof_assertion_failed',
      severity: 'critical',
      message: 'Audit proof contains failed hosted-kernel assertions.',
      refs: failedProofs.map((assertion) => assertion.name)
    });
  }

  return {
    status: issues.some((issue) => issue.severity === 'critical') ? 'blocked' : issues.length ? 'needs_review' : 'passed',
    issueCount: issues.length,
    evidenceCount: evidence.length,
    classifiedIncidentCount: incidents.length - unclassified.length,
    registeredDecisionCount: taxonomyDecisions.length - unregisteredDecisions.length,
    publishableDecisionCount: taxonomyDecisions.filter((decision) => decision.publishable).length,
    requestId: requestContext.requestId,
    selectedIncidentCount: selection.selectedIncidentIds.length,
    tenantId: tenantScope.tenantId,
    workspaceId: tenantScope.activeWorkspaceId,
    hiddenIncidentCount: tenantBoundary.deniedIncidents.length,
    issues
  };
}

function resolveHealthState(validation, syncState, lifecycleSettings, handoff, providerServiceContract) {
  const criticalCount = validation.issues.filter((issue) => issue.severity === 'critical').length;
  const degradedCount = validation.issues.filter((issue) => issue.severity === 'degraded').length;
  const providerBlocked = providerServiceContract.status === 'blocked' || !providerServiceContract.syncMetadata.accepted;
  const lifecycleBlocked = lifecycleSettings.mode === 'disabled' || !lifecycleSettings.validation.valid;

  if (criticalCount || lifecycleBlocked || providerBlocked) {
    return 'blocked';
  }
  if (degradedCount || syncState.status === 'catching_up' || handoff.state.includes('blocked')) {
    return 'degraded';
  }
  if (validation.issueCount || lifecycleSettings.mode === 'maintenance' || syncState.schedule.paused) {
    return 'warning';
  }
  return 'healthy';
}

function normalizeRetryAttempt(input = {}) {
  const retry = input.retry && typeof input.retry === 'object'
    ? input.retry
    : input.health && typeof input.health === 'object'
      ? input.health.retry
      : {};

  return normalizePositiveInteger(retry?.attempt, 0, 0, RETRY_BACKOFF_SECONDS.length - 1);
}

function buildActionableErrors(validation, requestContext, persistedRecovery, retryAttempt) {
  return validation.issues.map((issue, index) => {
    const catalog = ACTIONABLE_ERROR_CATALOG[issue.code] || {
      owner: issue.severity === 'critical' ? 'operator' : 'auditor',
      commandType: 'recover_state',
      action: issue.severity === 'critical' ? 'resolve_blocker' : 'review_validation_issue',
      retryable: issue.severity !== 'critical',
      degradedMode: issue.severity === 'critical' ? 'blocked_review' : 'review_queue'
    };
    const primaryRef = issue.refs[0] || surfaceId;
    const nextRetrySeconds = catalog.retryable
      ? RETRY_BACKOFF_SECONDS[Math.min(retryAttempt, RETRY_BACKOFF_SECONDS.length - 1)]
      : null;

    return {
      errorType: 'hosted-kernel.failure-taxonomy.actionable-error.v1',
      errorId: `${issue.code}:${index + 1}`,
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      owner: catalog.owner,
      action: catalog.action,
      degradedMode: catalog.degradedMode,
      retryable: catalog.retryable,
      refs: issue.refs,
      command: {
        type: catalog.commandType,
        target: primaryRef,
        route: `${requestContext.route}/commands`,
        idempotencyKey: `${catalog.commandType}:${primaryRef}:${persistedRecovery.generation}`,
        enabled: issue.severity !== 'critical' || catalog.commandType !== 'retry_sync'
      },
      retryAfterSeconds: nextRetrySeconds
    };
  });
}

function resolveFailurePhase(error) {
  if (error.code.startsWith('provider_')) {
    return 'provider_contract';
  }
  if (error.code.startsWith('tenant_') || error.code === 'cross_tenant_boundary_requested') {
    return 'tenant_boundary';
  }
  if (error.code.startsWith('taxonomy_lifecycle') || error.code === 'lifecycle_settings_invalid') {
    return 'lifecycle_control';
  }
  if (error.code.includes('proof') || error.code === 'taxonomy_decision_proof_incomplete') {
    return 'audit_proof_gate';
  }
  if (error.code.includes('sync') || error.code === 'sync_backlog_present') {
    return 'sync_recovery';
  }
  if (error.code.includes('handoff')) {
    return 'external_handoff';
  }
  if (error.code.includes('class') || error.code.includes('unclassified')) {
    return 'taxonomy_review';
  }
  return 'validation_review';
}

function chooseCommandAvailability(error, lifecycleControls) {
  if (error.command.type === 'retry_sync') {
    return {
      enabled: lifecycleControls.commands.retry_sync.enabled && error.retryable,
      blockedReason: lifecycleControls.commands.retry_sync.enabled
        ? error.retryable ? null : 'error_not_retryable'
        : lifecycleControls.commands.retry_sync.reason
    };
  }
  if (error.command.type === 'ack_handoff') {
    return {
      enabled: lifecycleControls.commands.ack_handoff.enabled,
      blockedReason: lifecycleControls.commands.ack_handoff.enabled ? null : lifecycleControls.commands.ack_handoff.reason
    };
  }
  if (error.command.type === 'publish_preview') {
    return {
      enabled: lifecycleControls.commands.publish_preview.enabled,
      blockedReason: lifecycleControls.commands.publish_preview.enabled ? null : lifecycleControls.commands.publish_preview.reason
    };
  }
  if (error.command.type === 'enable_taxonomy' || error.command.type === 'disable_taxonomy' || error.command.type === 'set_sync_schedule') {
    return {
      enabled: lifecycleControls.commands.settings_manage.enabled,
      blockedReason: lifecycleControls.commands.settings_manage.enabled ? null : lifecycleControls.commands.settings_manage.reason
    };
  }
  return {
    enabled: error.severity !== 'critical',
    blockedReason: error.severity === 'critical' ? 'manual_recovery_required' : null
  };
}

function buildDegradedModePlan(actionableErrors, lifecycleControls, requestContext) {
  const modes = new Map();

  for (const error of actionableErrors) {
    const phase = resolveFailurePhase(error);
    const availability = chooseCommandAvailability(error, lifecycleControls);
    const current = modes.get(error.degradedMode) || {
      planType: 'hosted-kernel.failure-taxonomy.degraded-mode-plan.v1',
      degradedMode: error.degradedMode,
      state: 'contained',
      severity: error.severity,
      owners: new Set(),
      phases: new Set(),
      issueCodes: [],
      commandTypes: new Set(),
      refs: new Set(),
      retryable: false,
      nextRetrySeconds: null,
      commandBlockedReasons: new Set()
    };

    current.severity = SEVERITY_RANK[error.severity] > SEVERITY_RANK[current.severity]
      ? error.severity
      : current.severity;
    current.owners.add(error.owner);
    current.phases.add(phase);
    current.issueCodes.push(error.code);
    current.commandTypes.add(error.command.type);
    for (const ref of error.refs) {
      current.refs.add(ref);
    }
    current.retryable = current.retryable || (error.retryable && availability.enabled);
    if (Number.isFinite(error.retryAfterSeconds)) {
      current.nextRetrySeconds = current.nextRetrySeconds === null
        ? error.retryAfterSeconds
        : Math.min(current.nextRetrySeconds, error.retryAfterSeconds);
    }
    if (availability.blockedReason) {
      current.commandBlockedReasons.add(availability.blockedReason);
    }
    current.state = error.severity === 'critical'
      ? 'blocked'
      : current.retryable
        ? 'retry_scheduled'
        : 'manual_review';
    modes.set(error.degradedMode, current);
  }

  return [...modes.values()]
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity])
    .map((mode) => ({
      ...mode,
      owners: [...mode.owners],
      phases: [...mode.phases],
      commandTypes: [...mode.commandTypes],
      refs: [...mode.refs].slice(0, 8),
      commandBlockedReasons: [...mode.commandBlockedReasons],
      route: `${requestContext.route}/health/degraded-modes/${encodeURIComponent(mode.degradedMode)}`
    }));
}

function buildFailureStateSnapshot(validation, actionableErrors, lifecycleControls, syncState, providerServiceContract, handoff) {
  const phaseCounts = countBy(actionableErrors, resolveFailurePhase);
  const phaseOrder = ['provider_contract', 'tenant_boundary', 'lifecycle_control', 'audit_proof_gate', 'sync_recovery', 'external_handoff', 'taxonomy_review', 'validation_review'];
  const primaryPhase = phaseOrder.find((phase) => phaseCounts[phase] > 0) || 'steady_state';
  const criticalErrors = actionableErrors.filter((error) => error.severity === 'critical');
  const retryableCommandBlocked = actionableErrors
    .filter((error) => error.retryable)
    .map((error) => chooseCommandAvailability(error, lifecycleControls))
    .filter((availability) => !availability.enabled)
    .map((availability) => availability.blockedReason)
    .filter(Boolean);

  return {
    snapshotType: 'hosted-kernel.failure-taxonomy.failure-state-snapshot.v1',
    status: validation.status,
    phase: primaryPhase,
    phaseCounts,
    terminal: criticalErrors.length > 0 || providerServiceContract.status === 'blocked',
    degradedRecoverable: actionableErrors.some((error) => error.retryable) && retryableCommandBlocked.length === 0,
    providerContractStatus: providerServiceContract.status,
    syncStatus: syncState.status,
    handoffState: handoff.state,
    blockerCodes: criticalErrors.map((error) => error.code),
    retryBlockedReasons: [...new Set(retryableCommandBlocked)]
  };
}

function buildRecoveryRunbook(actionableErrors, lifecycleControls, requestContext, persistedRecovery) {
  return actionableErrors.slice(0, 10).map((error, index) => {
    const availability = chooseCommandAvailability(error, lifecycleControls);
    const phase = resolveFailurePhase(error);

    return {
      stepType: 'hosted-kernel.failure-taxonomy.health-runbook-step.v1',
      stepId: `health-runbook-${index + 1}`,
      phase,
      errorId: error.errorId,
      owner: error.owner,
      action: error.action,
      command: {
        ...error.command,
        enabled: availability.enabled,
        blockedReason: availability.blockedReason,
        idempotencyKey: `${error.command.idempotencyKey}:health:${persistedRecovery.generation}`
      },
      executeAfterSeconds: availability.enabled && error.retryable ? error.retryAfterSeconds : null,
      proofRoute: `${requestContext.route}/proofs/${encodeURIComponent(requestContext.requestId)}`,
      degradedMode: error.degradedMode
    };
  });
}

function buildOperationalHealth(input, now, providerServiceContract, syncState, handoff, validation, lifecycleSettings, lifecycleControls, taxonomyDecisions, persistedRecovery, requestContext) {
  const retryAttempt = normalizeRetryAttempt(input);
  const actionableErrors = buildActionableErrors(validation, requestContext, persistedRecovery, retryAttempt);
  const healthState = resolveHealthState(validation, syncState, lifecycleSettings, handoff, providerServiceContract);
  const retryableErrors = actionableErrors.filter((error) => error.retryable);
  const nextBackoffSeconds = retryableErrors.length
    ? RETRY_BACKOFF_SECONDS[Math.min(retryAttempt, RETRY_BACKOFF_SECONDS.length - 1)]
    : null;
  const blockingDecisionIds = taxonomyDecisions
    .filter((decision) => decision.acceptanceImpact === 'blocking')
    .map((decision) => decision.incidentId);
  const degradedModes = [...new Set(actionableErrors
    .filter((error) => error.severity !== 'info')
    .map((error) => error.degradedMode))];
  const degradedModePlan = buildDegradedModePlan(actionableErrors, lifecycleControls, requestContext);
  const failureStateSnapshot = buildFailureStateSnapshot(validation, actionableErrors, lifecycleControls, syncState, providerServiceContract, handoff);
  const recoveryRunbook = buildRecoveryRunbook(actionableErrors, lifecycleControls, requestContext, persistedRecovery);
  const probes = [
    {
      name: 'provider-contract',
      ok: providerServiceContract.status !== 'blocked',
      route: providerServiceContract.baseRoute,
      detail: providerServiceContract.unavailableRequiredCapabilities.join(',') || providerServiceContract.status
    },
    {
      name: 'sync-watermark',
      ok: providerServiceContract.syncMetadata.accepted && syncState.status !== 'blocked',
      route: providerServiceContract.syncMetadata.providerRoute,
      detail: syncState.nextSyncReason
    },
    {
      name: 'proof-gate',
      ok: blockingDecisionIds.length === 0,
      route: `${requestContext.route}/taxonomy/decisions`,
      detail: blockingDecisionIds.length ? blockingDecisionIds.join(',') : 'all_decisions_have_required_proof'
    },
    {
      name: 'handoff-queue',
      ok: !handoff.required || handoff.queue.every((item) => item.status === 'pending_ack'),
      route: `${requestContext.route}/handoff`,
      detail: handoff.state
    }
  ];

  return {
    contractType: 'hosted-kernel.failure-taxonomy.operational-health.v1',
    generatedAt: now,
    state: healthState,
    degraded: HEALTH_RANK[healthState] >= HEALTH_RANK.degraded,
    degradedModes,
    failureState: {
      ...failureStateSnapshot,
      status: validation.status,
      providerContractStatus: providerServiceContract.status,
      syncStatus: syncState.status,
      lifecycleState: lifecycleControls.state,
      handoffState: handoff.state,
      blockingDecisionIds,
      issueCodes: validation.issues.map((issue) => issue.code)
    },
    degradedModePlan,
    retryPlan: {
      retryable: retryableErrors.length > 0 && lifecycleControls.commands.retry_sync.enabled,
      attempt: retryAttempt,
      nextBackoffSeconds,
      maxBackoffSeconds: RETRY_BACKOFF_SECONDS[RETRY_BACKOFF_SECONDS.length - 1],
      commandRoute: `${requestContext.route}/commands`,
      commandType: 'retry_sync',
      target: syncState.cursor,
      blockedReason: retryableErrors.length
        ? lifecycleControls.commands.retry_sync.reason
        : 'no_retryable_health_errors'
    },
    recoveryRunbook,
    probes,
    actionableErrors,
    auditProof: {
      proofType: 'hosted-kernel.failure-taxonomy.operational-health-proof.v1',
      state: healthState,
      generatedAt: now,
      requestId: requestContext.requestId,
      resumeToken: persistedRecovery.resumeToken,
      failedProbeNames: probes.filter((probe) => !probe.ok).map((probe) => probe.name),
      actionableErrorCount: actionableErrors.length,
      failurePhase: failureStateSnapshot.phase,
      degradedModeCount: degradedModePlan.length,
      runbookStepCount: recoveryRunbook.length,
      retryCommandsExecutable: recoveryRunbook
        .filter((step) => step.command.type === 'retry_sync')
        .every((step) => step.command.enabled || step.command.blockedReason)
    }
  };
}

function countBy(items, resolveKey, allowedKeys = []) {
  const counts = Object.fromEntries(allowedKeys.map((key) => [key, 0]));
  for (const item of items) {
    const key = resolveKey(item);
    if (typeof key === 'string' && key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function normalizeAnalyticsHistory(input = {}) {
  const analytics = input.analytics && typeof input.analytics === 'object' ? input.analytics : {};
  const historyRoot = input.history && typeof input.history === 'object' ? input.history : {};
  const snapshots = Array.isArray(analytics.historySnapshots)
    ? analytics.historySnapshots
    : Array.isArray(historyRoot.failureTaxonomyAnalytics)
      ? historyRoot.failureTaxonomyAnalytics
      : [];

  return snapshots
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .slice(-4)
    .map((snapshot, index) => ({
      snapshotId: cleanString(snapshot.snapshotId || snapshot.id, `history-${index + 1}`),
      capturedAt: cleanString(snapshot.capturedAt || snapshot.generatedAt, null),
      healthState: cleanString(snapshot.healthState, 'unknown'),
      validationStatus: cleanString(snapshot.validationStatus, 'unknown'),
      incidentCount: normalizePositiveInteger(snapshot.incidentCount, 0, 0),
      blockedDecisionCount: normalizePositiveInteger(snapshot.blockedDecisionCount, 0, 0),
      issueCount: normalizePositiveInteger(snapshot.issueCount, 0, 0),
      pendingIncidents: normalizePositiveInteger(snapshot.pendingIncidents, 0, 0),
      exportId: cleanString(snapshot.exportId, null)
    }));
}

function buildAnalyticsDrift(previousSnapshot, currentSnapshot) {
  const driftFields = [
    'incidentCount',
    'blockedDecisionCount',
    'issueCount',
    'pendingIncidents',
    'publishableDecisionCount',
    'handoffQueueCount',
    'hiddenIncidentCount'
  ];

  return {
    driftType: 'hosted-kernel.failure-taxonomy.analytics-drift.v1',
    comparedToSnapshotId: previousSnapshot?.snapshotId || null,
    comparedToCapturedAt: previousSnapshot?.capturedAt || null,
    changed: Boolean(previousSnapshot),
    deltas: Object.fromEntries(driftFields.map((field) => [
      field,
      currentSnapshot[field] - normalizePositiveInteger(previousSnapshot?.[field], 0, 0)
    ])),
    stateChanged: Boolean(previousSnapshot)
      && (
        previousSnapshot.healthState !== currentSnapshot.healthState
        || previousSnapshot.validationStatus !== currentSnapshot.validationStatus
      ),
    direction: !previousSnapshot
      ? 'baseline'
      : currentSnapshot.blockedDecisionCount > normalizePositiveInteger(previousSnapshot.blockedDecisionCount, 0, 0)
        || currentSnapshot.issueCount > normalizePositiveInteger(previousSnapshot.issueCount, 0, 0)
        ? 'worsened'
        : currentSnapshot.blockedDecisionCount < normalizePositiveInteger(previousSnapshot.blockedDecisionCount, 0, 0)
          || currentSnapshot.issueCount < normalizePositiveInteger(previousSnapshot.issueCount, 0, 0)
          ? 'improved'
          : 'unchanged'
  };
}

function buildAnalyticsReportRows(taxonomyDecisions, validation, operationalHealth, tenantBoundary) {
  const issueRows = validation.issues.slice(0, 12).map((issue, index) => ({
    rowType: 'validation_issue',
    rowId: `issue-${index + 1}`,
    key: issue.code,
    severity: issue.severity,
    status: issue.severity === 'critical' ? 'blocking' : 'review',
    value: issue.refs.length,
    refs: issue.refs.slice(0, 5)
  }));
  const decisionRows = taxonomyDecisions.slice(0, 25).map((decision) => ({
    rowType: 'taxonomy_decision',
    rowId: `decision-${decision.incidentId}`,
    key: decision.failureCode,
    severity: decision.severity,
    status: decision.publishable ? 'publishable' : decision.acceptanceImpact,
    value: decision.proofCoverage.missingFields.length,
    refs: [decision.incidentId, ...decision.proofCoverage.missingFields].slice(0, 5)
  }));
  const workspaceRows = tenantBoundary.workspaceAccess.map((workspace) => ({
    rowType: 'workspace_scope',
    rowId: `workspace-${workspace.workspaceId}`,
    key: workspace.workspaceId,
    severity: workspace.allowed ? 'info' : 'warning',
    status: workspace.allowed ? 'visible' : 'hidden',
    value: workspace.visibleIncidentCount + workspace.hiddenIncidentCount,
    refs: workspace.visibleIncidentIds.slice(0, 5)
  }));
  const healthRows = operationalHealth.degradedModePlan.map((plan) => ({
    rowType: 'degraded_mode',
    rowId: `degraded-${plan.degradedMode}`,
    key: plan.degradedMode,
    severity: plan.severity,
    status: plan.state,
    value: plan.issueCodes.length,
    refs: plan.refs.slice(0, 5)
  }));

  return [...issueRows, ...decisionRows, ...workspaceRows, ...healthRows];
}

function buildAnalyticsExports(input, now, requestContext, providerServiceContract, tenantScope, tenantBoundary, syncState, lifecycleSettings, persistedRecovery, handoff, validation, readiness, acceptance, taxonomyDecisions, operationalHealth) {
  const previousSnapshots = normalizeAnalyticsHistory(input);
  const issueSeverityCounts = countBy(validation.issues, (issue) => issue.severity, ['info', 'warning', 'degraded', 'critical']);
  const decisionSeverityCounts = countBy(taxonomyDecisions, (decision) => decision.severity, ['info', 'warning', 'degraded', 'critical']);
  const recoveryModeCounts = countBy(taxonomyDecisions, (decision) => decision.recoveryMode, [...RECOVERY_MODES]);
  const recommendedActionCounts = countBy(taxonomyDecisions, (decision) => decision.recommendedAction);
  const commandStatusCounts = countBy(persistedRecovery.commandLedger.results, (result) => result.status, ['applied', 'blocked', 'duplicate_noop']);
  const workspaceCounters = tenantBoundary.workspaceAccess.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    active: workspace.active,
    allowed: workspace.allowed,
    visibleIncidentCount: workspace.visibleIncidentCount,
    hiddenIncidentCount: workspace.hiddenIncidentCount,
    commandCount: workspace.commandCount
  }));
  const currentSnapshot = {
    snapshotType: 'hosted-kernel.failure-taxonomy.analytics-snapshot.v1',
    snapshotId: `${persistedRecovery.generation}:${requestContext.requestId}`,
    capturedAt: now,
    tenantId: tenantScope.tenantId,
    workspaceId: tenantScope.activeWorkspaceId,
    providerId: providerServiceContract.providerId,
    healthState: operationalHealth.state,
    validationStatus: validation.status,
    readinessState: readiness.state,
    acceptanceDecision: acceptance.decision,
    incidentCount: taxonomyDecisions.length,
    hiddenIncidentCount: tenantBoundary.deniedIncidents.length,
    blockedDecisionCount: taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'blocking').length,
    publishableDecisionCount: validation.publishableDecisionCount,
    issueCount: validation.issueCount,
    pendingIncidents: syncState.pendingIncidents,
    handoffQueueCount: handoff.queue.length,
    commandCount: persistedRecovery.commandLedger.results.length,
    exportId: `failure-taxonomy:${tenantScope.tenantId}:${tenantScope.activeWorkspaceId}:${persistedRecovery.generation}`
  };
  const historySnapshots = [...previousSnapshots, currentSnapshot].slice(-5);
  const previousSnapshot = previousSnapshots[previousSnapshots.length - 1] || null;
  const drift = buildAnalyticsDrift(previousSnapshot, currentSnapshot);
  const reportRows = buildAnalyticsReportRows(taxonomyDecisions, validation, operationalHealth, tenantBoundary);
  const exportReadinessGates = [
    {
      gate: 'tenant_scope_exportable',
      ready: tenantBoundary.readable,
      reason: tenantBoundary.readable ? 'tenant_can_read_taxonomy' : 'tenant_read_permission_missing'
    },
    {
      gate: 'counters_reconciled',
      ready: currentSnapshot.incidentCount === taxonomyDecisions.length
        && currentSnapshot.issueCount === validation.issueCount
        && currentSnapshot.commandCount === persistedRecovery.commandLedger.results.length,
      reason: 'analytics_counters_match_runtime_state'
    },
    {
      gate: 'history_append_only',
      ready: historySnapshots[historySnapshots.length - 1]?.snapshotId === currentSnapshot.snapshotId,
      reason: 'latest_snapshot_retained_at_tail'
    },
    {
      gate: 'audit_proof_linked',
      ready: operationalHealth.auditProof.requestId === requestContext.requestId,
      reason: 'operational_health_proof_bound_to_request'
    }
  ];
  const exportReady = exportReadinessGates.every((gate) => gate.ready);
  const timeline = [
    {
      eventType: 'provider_contract_negotiated',
      occurredAt: providerServiceContract.syncMetadata.lastNegotiatedAt,
      state: providerServiceContract.status,
      detail: providerServiceContract.unavailableRequiredCapabilities.join(',') || providerServiceContract.providerId
    },
    {
      eventType: 'sync_state_sampled',
      occurredAt: syncState.clock.generatedAt,
      state: syncState.status,
      detail: syncState.nextSyncReason
    },
    {
      eventType: 'validation_summarized',
      occurredAt: now,
      state: validation.status,
      detail: `${validation.issueCount} issue(s)`
    },
    {
      eventType: 'health_evaluated',
      occurredAt: operationalHealth.generatedAt,
      state: operationalHealth.state,
      detail: operationalHealth.degradedModes.join(',') || 'no_degraded_modes'
    },
    {
      eventType: 'analytics_snapshot_recorded',
      occurredAt: currentSnapshot.capturedAt,
      state: drift.direction,
      detail: `${historySnapshots.length} retained snapshot(s)`
    },
    {
      eventType: 'analytics_export_readiness_checked',
      occurredAt: now,
      state: exportReady ? 'ready' : 'blocked',
      detail: exportReadinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate).join(',') || 'all_export_gates_ready'
    }
  ];

  return {
    contractType: 'hosted-kernel.failure-taxonomy.analytics-export.v1',
    generatedAt: now,
    exportId: currentSnapshot.exportId,
    exportRoute: `${requestContext.route}/analytics/exports/${encodeURIComponent(currentSnapshot.exportId)}`,
    historyRoute: `${requestContext.route}/analytics/history`,
    reportRoute: `${requestContext.route}/analytics/reports/current`,
    state: exportReady ? 'export_ready' : 'export_blocked',
    exportReadiness: {
      readinessType: 'hosted-kernel.failure-taxonomy.analytics-export-readiness.v1',
      ready: exportReady,
      gateCount: exportReadinessGates.length,
      blockedGates: exportReadinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate),
      gates: exportReadinessGates
    },
    counterSet: {
      counterType: 'hosted-kernel.failure-taxonomy.analytics-counters.v1',
      incidentCount: currentSnapshot.incidentCount,
      hiddenIncidentCount: currentSnapshot.hiddenIncidentCount,
      publishableDecisionCount: currentSnapshot.publishableDecisionCount,
      blockedDecisionCount: currentSnapshot.blockedDecisionCount,
      handoffQueueCount: currentSnapshot.handoffQueueCount,
      pendingIncidentCount: currentSnapshot.pendingIncidents,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      failedProbeCount: operationalHealth.auditProof.failedProbeNames.length,
      issueSeverityCounts,
      decisionSeverityCounts,
      recoveryModeCounts,
      recommendedActionCounts,
      commandStatusCounts,
      workspaceCounters
    },
    history: {
      retainedSnapshotCount: historySnapshots.length,
      latestSnapshotId: currentSnapshot.snapshotId,
      previousSnapshotCount: previousSnapshots.length,
      snapshots: historySnapshots,
      drift
    },
    timeline,
    report: {
      reportType: 'hosted-kernel.failure-taxonomy.analytics-report.v1',
      rowCount: reportRows.length,
      issueRowCount: reportRows.filter((row) => row.rowType === 'validation_issue').length,
      decisionRowCount: reportRows.filter((row) => row.rowType === 'taxonomy_decision').length,
      workspaceRowCount: reportRows.filter((row) => row.rowType === 'workspace_scope').length,
      degradedModeRowCount: reportRows.filter((row) => row.rowType === 'degraded_mode').length,
      rows: reportRows
    },
    exportSummary: {
      schema: 'failure_taxonomy_analytics_export_v1',
      tenantId: tenantScope.tenantId,
      workspaceId: tenantScope.activeWorkspaceId,
      providerId: providerServiceContract.providerId,
      generatedAt: now,
      lifecycleMode: lifecycleSettings.mode,
      syncStatus: syncState.status,
      healthState: operationalHealth.state,
      validationStatus: validation.status,
      readinessState: readiness.state,
      acceptanceDecision: acceptance.decision,
      resumeToken: persistedRecovery.resumeToken,
      cursor: syncState.cursor,
      topIssueCodes: validation.issues.slice(0, 8).map((issue) => issue.code),
      topRecommendedActions: Object.entries(recommendedActionCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([action, count]) => ({ action, count })),
      driftDirection: drift.direction,
      reportRowCount: reportRows.length,
      exportState: exportReady ? 'ready' : 'blocked'
    },
    proof: {
      proofType: 'hosted-kernel.failure-taxonomy.analytics-proof.v1',
      requestId: requestContext.requestId,
      exportId: currentSnapshot.exportId,
      snapshotId: currentSnapshot.snapshotId,
      restartGeneration: persistedRecovery.generation,
      countersReconciled: currentSnapshot.incidentCount === taxonomyDecisions.length
        && currentSnapshot.issueCount === validation.issueCount
        && currentSnapshot.commandCount === persistedRecovery.commandLedger.results.length,
      historyAppendOnly: historySnapshots.length === previousSnapshots.length + 1 || historySnapshots.length === 5,
      reportRowsReconciled: reportRows.length === validation.issues.slice(0, 12).length
        + taxonomyDecisions.slice(0, 25).length
        + tenantBoundary.workspaceAccess.length
        + operationalHealth.degradedModePlan.length,
      exportReady,
      blockedExportGates: exportReadinessGates.filter((gate) => !gate.ready).map((gate) => gate.gate),
      driftDirection: drift.direction
    }
  };
}

function buildExportHandoffPacket(requestContext, analyticsExports, readiness, acceptance, validation, nextSteps, lifecycleControls, persistedRecovery, handoff, tenantBoundary) {
  const handoffQueue = Array.isArray(handoff.queue) ? handoff.queue : [];
  const blockedGates = [
    ...analyticsExports.exportReadiness.blockedGates,
    ...readiness.blockedGates,
    ...acceptance.blockerCodes
  ];
  const publishStep = nextSteps.find((step) => step.action === 'publish_taxonomy_preview') || null;
  const handoffStep = nextSteps.find((step) => step.action === 'acknowledge_external_handoff') || null;
  const primaryStep = publishStep || handoffStep || nextSteps[0] || null;
  const canPublish = acceptance.accepted
    && readiness.state === 'ready'
    && lifecycleControls.commands.publish_preview.enabled
    && analyticsExports.exportReadiness.ready;
  const handoffRequired = Boolean(handoff.required || handoffQueue.length > 0 || tenantBoundary.boundaryProof.handoffRequired);
  const packetState = canPublish
    ? 'publish-ready'
    : blockedGates.length > 0
      ? 'blocked'
      : handoffRequired
        ? 'handoff-ready'
        : 'review-ready';

  return {
    packetType: 'hosted-kernel.failure-taxonomy.export-handoff-packet.v1',
    generatedAt: analyticsExports.generatedAt,
    requestId: requestContext.requestId,
    state: packetState,
    exportId: analyticsExports.exportId,
    exportRoute: analyticsExports.exportRoute,
    reportRoute: analyticsExports.reportRoute,
    historyRoute: analyticsExports.historyRoute,
    resumeToken: persistedRecovery.resumeToken,
    canPublish,
    handoffRequired,
    blockedGateCount: blockedGates.length,
    blockedGates: [...new Set(blockedGates)].slice(0, 12),
    validation: {
      status: validation.status,
      issueCount: validation.issueCount,
      criticalIssueCount: validation.issues.filter((issue) => issue.severity === 'critical').length,
      topIssueCodes: validation.issues.slice(0, 6).map((issue) => issue.code)
    },
    readiness: {
      state: readiness.state,
      readyGateCount: readiness.readyGateCount,
      totalGateCount: readiness.totalGateCount,
      blockedGates: readiness.blockedGates
    },
    analytics: {
      ready: analyticsExports.exportReadiness.ready,
      state: analyticsExports.state,
      counterType: analyticsExports.counterSet.counterType,
      retainedSnapshotCount: analyticsExports.history.retainedSnapshotCount,
      reportRowCount: analyticsExports.report.rowCount,
      driftDirection: analyticsExports.history.drift.direction
    },
    handoff: {
      state: handoff.state,
      queueCount: handoffQueue.length,
      queue: handoffQueue.map((item) => ({
        handoffId: item.handoffId,
        incidentId: item.incidentId,
        status: item.status,
        providerRoute: item.providerRoute || item.command?.route || item.preflight?.route || null
      })),
      tenantBoundaryHandoffRequired: tenantBoundary.boundaryProof.handoffRequired,
      activationRequiredCount: tenantBoundary.boundaryHandoff.activationRequiredCount
    },
    primaryAction: primaryStep ? {
      action: primaryStep.action,
      label: primaryStep.label,
      reason: primaryStep.reason,
      target: primaryStep.target,
      route: primaryStep.nextRoute || (
        primaryStep.action === 'publish_taxonomy_preview'
          ? `${requestContext.route}/preview/acceptance`
          : primaryStep.action === 'acknowledge_external_handoff'
            ? `${requestContext.route}/handoff/ack`
            : `${requestContext.route}/next-steps`
      )
    } : {
      action: canPublish ? 'publish_taxonomy_preview' : 'review_export_handoff_packet',
      label: canPublish ? 'Publish taxonomy preview' : 'Review export handoff packet',
      reason: canPublish ? 'all_export_and_readiness_gates_passed' : packetState,
      target: surfaceId,
      route: canPublish ? `${requestContext.route}/preview/acceptance` : `${requestContext.route}/next-steps`
    },
    routeContract: {
      route: canPublish ? `${requestContext.route}/preview/acceptance` : `${requestContext.route}/export-handoff`,
      method: canPublish ? 'POST' : 'GET',
      requestSchema: 'hosted-kernel.failure-taxonomy.export-handoff-request.v1',
      responseSchema: 'hosted-kernel.failure-taxonomy.export-handoff-packet.v1',
      idempotencyKey: `failure-taxonomy-export-handoff:${persistedRecovery.resumeToken}:${analyticsExports.exportId}`
    }
  };
}

function buildReadiness(provider, providerServiceContract, incidents, syncState, handoff, validation, tenantBoundary, lifecycleSettings, lifecycleControls, taxonomyDecisions) {
  const gates = [
    {
      gate: 'lifecycle_controls_enabled',
      ready: lifecycleSettings.mode === 'enabled' && lifecycleSettings.validation.valid,
      label: 'Lifecycle controls enabled',
      detail: `${lifecycleControls.state}:${lifecycleSettings.schedule.cadence}`
    },
    {
      gate: 'tenant_boundary',
      ready: tenantBoundary.readable && tenantBoundary.deniedIncidents.length === 0,
      label: 'Tenant workspace boundary satisfied',
      detail: tenantBoundary.deniedIncidents.length
        ? `${tenantBoundary.deniedIncidents.length} hidden incident(s)`
        : `${tenantBoundary.workspaceAccess.filter((workspace) => workspace.allowed).length} workspace boundary record(s) active`
    },
    {
      gate: 'provider_contract',
      ready: provider.negotiation.status !== 'rejected' && providerServiceContract.status !== 'blocked',
      label: 'Provider contract negotiated',
      detail: providerServiceContract.unavailableRequiredCapabilities.length
        ? `Missing ${providerServiceContract.unavailableRequiredCapabilities.join(', ')}`
        : provider.negotiation.rejected.length
          ? `${provider.negotiation.granted.length} granted, ${provider.negotiation.rejected.length} rejected`
          : `${provider.negotiation.granted.length} granted`
    },
    {
      gate: 'provider_sync_metadata',
      ready: providerServiceContract.syncMetadata.accepted && syncState.providerMetadata.accepted,
      label: 'Provider sync metadata available',
      detail: providerServiceContract.syncMetadata.providerRoute
    },
    {
      gate: 'sync_current',
      ready: syncState.status === 'current',
      label: 'Audit sync current',
      detail: syncState.nextSyncReason
    },
    {
      gate: 'incidents_classified',
      ready: incidents.every((incident) => incident.failureCode !== 'unclassified_failure')
        && taxonomyDecisions.every((decision) => decision.registered || decision.acceptanceImpact === 'review_required'),
      label: 'Incidents classified',
      detail: `${validation.classifiedIncidentCount}/${incidents.length} classified, ${validation.registeredDecisionCount}/${taxonomyDecisions.length} registered`
    },
    {
      gate: 'taxonomy_decision_proof',
      ready: taxonomyDecisions.every((decision) => decision.acceptanceImpact !== 'blocking'),
      label: 'Taxonomy decision proof complete',
      detail: `${validation.publishableDecisionCount}/${taxonomyDecisions.length} publishable`
    },
    {
      gate: 'handoff_queue_ackable',
      ready: handoff.queue.every((item) => item.status === 'pending_ack'),
      label: 'External handoff queue prepared',
      detail: handoff.required ? `${handoff.queue.length} item(s) pending acknowledgement` : 'No handoff required'
    },
    {
      gate: 'audit_proof_valid',
      ready: validation.status !== 'blocked',
      label: 'Audit proof valid',
      detail: `${validation.issueCount} validation issue(s)`
    }
  ];

  const blocked = gates.filter((gate) => !gate.ready);
  return {
    state: blocked.length ? 'not_ready' : validation.status === 'needs_review' ? 'ready_with_warnings' : 'ready',
    readyGateCount: gates.length - blocked.length,
    totalGateCount: gates.length,
    blockedGates: blocked.map((gate) => gate.gate),
    gates
  };
}

function buildPreview(incidents, handoff, validation, readiness, taxonomyDecisions) {
  const decisionByIncident = new Map(taxonomyDecisions.map((decision) => [decision.incidentId, decision]));
  const severityCounts = incidents.reduce((counts, incident) => {
    counts[incident.severity] = (counts[incident.severity] || 0) + 1;
    return counts;
  }, {});
  const highlightedIncidents = [...incidents]
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity])
    .slice(0, 5)
    .map((incident) => {
      const decision = decisionByIncident.get(incident.incidentId);

      return {
        incidentId: incident.incidentId,
        title: incident.failureCode,
        severity: incident.severity,
        recoveryMode: decision?.recoveryMode || incident.recoveryMode,
        retryable: decision?.retryable ?? incident.retryable,
        evidenceRefs: incident.evidenceRefs,
        taxonomyDecision: decision ? {
          registered: decision.registered,
          publishable: decision.publishable,
          recommendedAction: decision.recommendedAction,
          missingProofFields: decision.proofCoverage.missingFields,
          acceptanceImpact: decision.acceptanceImpact
        } : null
      };
    });

  return {
    title: 'Failure taxonomy recovery preview',
    statusBadge: readiness.state,
    summary: {
      incidentCount: incidents.length,
      severityCounts,
      handoffCount: handoff.queue.length,
      publishableDecisionCount: validation.publishableDecisionCount,
      registeredDecisionCount: validation.registeredDecisionCount,
      validationStatus: validation.status
    },
    cards: highlightedIncidents,
    emptyState: incidents.length ? null : {
      code: 'no_incidents',
      message: 'No hosted-kernel recovery incidents are waiting for taxonomy classification.'
    }
  };
}

function buildAcceptance(readiness, validation, handoff) {
  const blockers = [
    ...readiness.blockedGates,
    ...validation.issues.filter((issue) => issue.severity === 'critical').map((issue) => issue.code)
  ];

  return {
    decision: blockers.length ? 'reject' : validation.status === 'needs_review' ? 'conditional_accept' : 'accept',
    accepted: blockers.length === 0,
    requiresHumanReview: validation.status !== 'passed' || handoff.required,
    blockerCodes: [...new Set(blockers)],
    proofLabel: blockers.length ? 'acceptance-blocked' : 'acceptance-ready'
  };
}

function buildNextSteps(readiness, validation, handoff, syncState, lifecycleSettings, lifecycleControls, lifecycleTransitionPlan) {
  const steps = [];

  if (lifecycleTransitionPlan.blockedTransitionCount > 0) {
    steps.push({
      action: 'resolve_lifecycle_transition_blocker',
      label: 'Resolve blocked lifecycle settings command',
      reason: 'lifecycle_transition_blocked',
      target: lifecycleTransitionPlan.transitions.find((transition) => transition.blockers.length > 0)?.commandId || 'settings/lifecycle'
    });
  }

  if (lifecycleSettings.mode === 'disabled') {
    steps.push({
      action: 'enable_failure_taxonomy',
      label: 'Enable failure taxonomy lifecycle controls',
      reason: 'taxonomy_lifecycle_disabled',
      target: 'enable_taxonomy'
    });
  }

  if (lifecycleSettings.mode === 'maintenance') {
    steps.push({
      action: 'exit_lifecycle_maintenance',
      label: 'Return failure taxonomy lifecycle mode to enabled',
      reason: 'taxonomy_lifecycle_maintenance',
      target: 'enable_taxonomy'
    });
  }

  if (syncState.pendingIncidents > 0 && lifecycleControls.commands.retry_sync.enabled) {
    steps.push({
      action: 'sync_provider_incidents',
      label: 'Continue provider incident sync',
      reason: syncState.nextSyncReason,
      target: syncState.cursor
    });
  }

  for (const issue of validation.issues) {
    steps.push({
      action: issue.severity === 'critical' ? 'resolve_blocker' : 'review_validation_issue',
      label: issue.message,
      reason: issue.code,
      target: issue.refs[0] || surfaceId
    });
  }

  for (const item of handoff.queue) {
    if (lifecycleControls.commands.ack_handoff.enabled) {
      steps.push({
        action: 'acknowledge_external_handoff',
        label: `Acknowledge handoff for ${item.failureCode}`,
        reason: 'external_action_required',
        target: item.handoffId
      });
    }
  }

  if (!steps.length && readiness.state === 'ready' && lifecycleControls.commands.publish_preview.enabled) {
    steps.push({
      action: 'publish_taxonomy_preview',
      label: 'Publish the accepted failure taxonomy preview to clients',
      reason: 'all_readiness_gates_passed',
      target: surfaceId
    });
  }

  return steps;
}

function buildClientHandoffDeliveryPlan(requestContext, destination, scopedQueue, canAcknowledge, persistedRecovery, fallbackReason) {
  const queueRequiresAck = scopedQueue.some((item) => item.status === 'pending_ack');
  const callbackUsable = requestContext.delivery.supportsExternalCallbacks && Boolean(requestContext.callbackRoute);
  const commandPresentation = requestContext.channel === 'cli'
    ? 'cli_command'
    : requestContext.channel === 'automation'
      ? 'machine_action'
      : requestContext.delivery.supportsCommandLinks
        ? 'command_link'
        : 'read_only_instruction';
  const deliveryMode = destination === 'provider_external_handoff'
    ? callbackUsable
      ? 'callback_bound_external'
      : 'provider_polling_external'
    : destination === 'deferred_client_queue'
      ? 'client_resume_queue'
      : requestContext.channel === 'console'
        ? 'inline_console_panel'
        : requestContext.delivery.supportsStreaming
          ? 'streamed_inline_update'
          : 'inline_response_payload';
  const pollAfterSeconds = requestContext.channel === 'automation'
    ? 15
    : requestContext.channel === 'cli'
      ? 30
      : 60;

  return {
    deliveryType: 'hosted-kernel.failure-taxonomy.client-handoff-delivery.v1',
    channel: requestContext.channel,
    mode: deliveryMode,
    commandPresentation,
    callbackRoute: callbackUsable ? requestContext.callbackRoute : null,
    returnRoute: requestContext.returnRoute,
    requiresClientAcknowledgement: queueRequiresAck,
    acknowledgementAvailable: canAcknowledge,
    fallbackReason,
    polling: {
      required: queueRequiresAck && !callbackUsable,
      route: `${requestContext.route}/handoff/status`,
      afterSeconds: pollAfterSeconds,
      untilState: queueRequiresAck ? 'acknowledged_or_blocked' : 'not_required'
    },
    resumePatch: {
      patchType: 'hosted-kernel.failure-taxonomy.client-resume-patch.v1',
      stateVersion: requestContext.stateVersion,
      resumeToken: persistedRecovery.resumeToken,
      generation: persistedRecovery.generation,
      nextRoute: scopedQueue.length ? `${requestContext.route}/handoff` : requestContext.returnRoute,
      replaceClientState: false
    }
  };
}

function buildHandoffCommandPreflight(item, requestContext, persistedRecovery, canAcknowledge, deliveryPlan) {
  const idempotencyKey = `ack_handoff:${item.handoffId}:${persistedRecovery.generation}`;
  const blockedReasons = [
    item.status !== 'pending_ack' ? item.status : null,
    !canAcknowledge ? 'acknowledgement_not_available' : null,
    deliveryPlan.commandPresentation === 'read_only_instruction' ? 'client_command_links_unavailable' : null
  ].filter(Boolean);

  return {
    preflightType: 'hosted-kernel.failure-taxonomy.handoff-command-preflight.v1',
    commandId: `preflight:${item.handoffId}`,
    type: 'ack_handoff',
    target: item.handoffId,
    route: `${requestContext.route}/handoff/ack`,
    idempotencyKey,
    enabled: blockedReasons.length === 0,
    blockedReasons,
    presentation: deliveryPlan.commandPresentation,
    payloadShape: {
      handoffId: item.handoffId,
      incidentId: item.incidentId,
      requestId: requestContext.requestId,
      resumeToken: persistedRecovery.resumeToken,
      idempotencyKey
    },
    auditProofRoute: `${requestContext.route}/proofs/${encodeURIComponent(requestContext.requestId)}`
  };
}

function buildWorkflowHandoffContract(requestContext, provider, providerServiceContract, selection, handoff, readiness, acceptance, persistedRecovery, lifecycleControls, tenantScope) {
  const selectedOrVisibleIds = selection.selectedIncidentIds.length
    ? selection.selectedIncidentIds
    : selection.visibleIncidents.map((incident) => incident.incidentId);
  const scopedQueue = handoff.queue.filter((item) => selectedOrVisibleIds.includes(item.incidentId));
  const externalEnabled = providerServiceContract.externalHandoff.enabled;
  const canAcknowledge = acceptance.accepted
    && lifecycleControls.commands.ack_handoff.enabled
    && canTenant(tenantScope, 'handoff:ack');
  const fallbackReason = !handoff.required
    ? 'handoff_not_required'
    : !providerServiceContract.externalHandoff.accepted
      ? 'provider_external_handoff_contract_unavailable'
      : !externalEnabled
        ? 'external_handoff_lifecycle_disabled'
        : requestContext.handoffPreference === 'defer'
          ? 'client_requested_deferred_handoff'
          : !canAcknowledge
            ? 'acknowledgement_not_available'
            : null;
  const destination = handoff.required
    ? externalEnabled && requestContext.handoffPreference === 'external'
      ? 'provider_external_handoff'
      : requestContext.handoffPreference === 'defer'
        ? 'deferred_client_queue'
        : 'client_inline_handoff'
    : 'taxonomy_preview_publish';
  const state = !acceptance.accepted
    ? 'blocked'
    : scopedQueue.length
      ? canAcknowledge
        ? 'awaiting_handoff_ack'
        : 'handoff_prepared_ack_blocked'
      : readiness.state === 'ready_with_warnings'
        ? 'ready_with_review'
        : 'ready';
  const deliveryPlan = buildClientHandoffDeliveryPlan(
    requestContext,
    destination,
    scopedQueue,
    canAcknowledge,
    persistedRecovery,
    fallbackReason
  );
  const preflightByHandoffId = new Map(scopedQueue.map((item) => [
    item.handoffId,
    buildHandoffCommandPreflight(item, requestContext, persistedRecovery, canAcknowledge, deliveryPlan)
  ]));

  return {
    contractType: 'hosted-kernel.failure-taxonomy.workflow-handoff.v1',
    state,
    destination,
    handoffPreference: requestContext.handoffPreference,
    providerId: provider.providerId,
    providerRoute: providerServiceContract.externalHandoff.providerRoute,
    acknowledgementRoute: `${requestContext.route}/handoff/ack`,
    resumeToken: persistedRecovery.resumeToken,
    fallbackReason,
    delivery: deliveryPlan,
    selectedIncidentIds: selectedOrVisibleIds,
    requirements: {
      externalContractAccepted: providerServiceContract.externalHandoff.accepted,
      externalContractEnabled: externalEnabled,
      acknowledgementPermission: canTenant(tenantScope, 'handoff:ack'),
      acknowledgementControlEnabled: lifecycleControls.commands.ack_handoff.enabled,
      acceptanceDecision: acceptance.decision,
      readinessState: readiness.state
    },
    userVisibleState: {
      badge: state === 'blocked'
        ? 'blocked'
        : scopedQueue.length
          ? 'handoff_required'
          : readiness.state,
      primaryAction: scopedQueue.length
        ? canAcknowledge
          ? 'acknowledge_handoff'
          : 'review_handoff_blocker'
        : acceptance.accepted
          ? 'continue_preview'
          : 'resolve_blockers',
      primaryRoute: scopedQueue.length
        ? `${requestContext.route}/handoff/ack`
        : `${requestContext.route}/preview`,
      secondaryRoute: `${requestContext.route}/proofs/${encodeURIComponent(requestContext.requestId)}`
    },
    queue: scopedQueue.map((item) => ({
      handoffId: item.handoffId,
      incidentId: item.incidentId,
      failureCode: item.failureCode,
      owner: item.owner,
      status: item.status,
      transport: item.transport,
      providerRoute: item.providerRoute,
      deliveryMode: deliveryPlan.mode,
      acknowledgementRoute: `${requestContext.route}/handoff/${encodeURIComponent(item.handoffId)}`,
      preflight: preflightByHandoffId.get(item.handoffId),
      command: {
        type: 'ack_handoff',
        target: item.handoffId,
        route: `${requestContext.route}/handoff/ack`,
        idempotencyKey: `ack_handoff:${item.handoffId}:${persistedRecovery.generation}`,
        enabled: preflightByHandoffId.get(item.handoffId)?.enabled === true
      }
    }))
  };
}

function buildClientRuntimeState(requestContext, provider, providerServiceContract, selection, handoff, readiness, acceptance, nextSteps, persistedRecovery, tenantScope, tenantBoundary, lifecycleSettings, lifecycleControls, lifecycleTransitionPlan, taxonomyDecisions, operationalHealth, analyticsExports) {
  const selectedOrVisibleIds = selection.selectedIncidentIds.length
    ? selection.selectedIncidentIds
    : selection.visibleIncidents.map((incident) => incident.incidentId);
  const workflowHandoff = buildWorkflowHandoffContract(
    requestContext,
    provider,
    providerServiceContract,
    selection,
    handoff,
    readiness,
    acceptance,
    persistedRecovery,
    lifecycleControls,
    tenantScope
  );

  return {
    stateVersion: requestContext.stateVersion,
    request: requestContext,
    tenant: {
      tenantId: tenantScope.tenantId,
      activeWorkspaceId: tenantScope.activeWorkspaceId,
      allowedWorkspaceIds: tenantScope.allowedWorkspaceIds,
      role: tenantScope.role,
      policyVersion: tenantScope.policyVersion,
      boundary: tenantScope.boundary,
      workspaceAccess: tenantBoundary.workspaceAccess.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        allowed: workspace.allowed,
        active: workspace.active,
        visibleIncidentCount: workspace.visibleIncidentCount,
        hiddenIncidentCount: workspace.hiddenIncidentCount,
        commandCount: workspace.commandCount,
        handoffRoute: workspace.handoffRoute
      })),
      boundaryProof: tenantBoundary.boundaryProof,
      boundaryHandoff: tenantBoundary.boundaryHandoff
    },
    selection: {
      selectedIncidentIds: selection.selectedIncidentIds,
      missingRequestedIncidentIds: selection.missingRequestedIncidentIds,
      visibleIncidentCount: selection.visibleIncidents.length,
      hiddenIncidentCount: tenantBoundary.deniedIncidents.length,
      scope: selection.selectedIncidentIds.length ? 'client_selected' : 'all_open_incidents'
    },
    classification: {
      payloadType: 'hosted-kernel.failure-taxonomy.client-classification-state.v1',
      route: `${requestContext.route}/taxonomy/decisions`,
      decisionCount: taxonomyDecisions.length,
      blockingDecisionCount: taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'blocking').length,
      nextRecommendedAction: taxonomyDecisions.find((decision) => !decision.publishable)?.recommendedAction || 'none',
      selectedDecisions: taxonomyDecisions
        .filter((decision) => selectedOrVisibleIds.includes(decision.incidentId))
        .map((decision) => ({
          incidentId: decision.incidentId,
          failureCode: decision.failureCode,
          publishable: decision.publishable,
          recommendedAction: decision.recommendedAction,
          missingProofFields: decision.proofCoverage.missingFields
        }))
    },
    workflowHandoff: {
      ...workflowHandoff,
      route: `${requestContext.route}/handoff`
    },
    providerContract: {
      status: providerServiceContract.status,
      baseRoute: providerServiceContract.baseRoute,
      syncRoute: providerServiceContract.syncMetadata.providerRoute,
      proofRoute: providerServiceContract.proof.proofRoute,
      handoffRoute: providerServiceContract.externalHandoff.providerRoute,
      handoffTransport: providerServiceContract.externalHandoff.transport,
      integrationManifest: {
        manifestType: providerServiceContract.integrationManifest.manifestType,
        endpointCount: providerServiceContract.integrationManifest.endpointCount,
        enabledEndpointCount: providerServiceContract.integrationManifest.enabledEndpointCount,
        blockedRequiredEndpoints: providerServiceContract.integrationManifest.blockedRequiredEndpoints,
        syncLease: providerServiceContract.integrationManifest.syncLease,
        handoffDispatch: providerServiceContract.integrationManifest.handoffDispatch,
        negotiationProof: providerServiceContract.integrationManifest.negotiationProof
      },
      unavailableRequiredCapabilities: providerServiceContract.unavailableRequiredCapabilities,
      availableCapabilities: providerServiceContract.capabilityContracts
        .filter((contract) => contract.status === 'available')
        .map((contract) => contract.capability)
    },
    resume: {
      resumable: workflowHandoff.state !== 'blocked',
      token: persistedRecovery.resumeToken,
      nextAction: nextSteps[0]?.action || 'none',
      nextTarget: nextSteps[0]?.target || surfaceId,
      persistedStatus: persistedRecovery.status,
      runtimeStatus: persistedRecovery.runtimeStatus,
      generation: persistedRecovery.generation,
      primaryRecoveryPath: {
        mode: persistedRecovery.primaryRecoveryPath.mode,
        route: persistedRecovery.primaryRecoveryPath.command.route,
        target: persistedRecovery.primaryRecoveryPath.target,
        available: persistedRecovery.primaryRecoveryPath.available,
        reason: persistedRecovery.primaryRecoveryPath.reason
      },
      restartConsistency: {
        consistent: persistedRecovery.restartConsistency.consistent,
        failedChecks: persistedRecovery.restartConsistency.failedChecks,
        recoveredIncidentIds: persistedRecovery.restartConsistency.recoveredIncidentIds,
        recoveredHandoffIds: persistedRecovery.restartConsistency.recoveredHandoffIds
      },
      recoveryCursor: persistedRecovery.recoveryCursor,
      persistence: {
        operation: persistedRecovery.persistence.operation,
        shouldPersist: persistedRecovery.persistence.shouldPersist,
        revisionKey: persistedRecovery.persistence.revisionKey,
        storagePartition: persistedRecovery.persistence.storagePartition,
        conflictPolicy: persistedRecovery.persistence.conflictPolicy,
        replayWindow: persistedRecovery.persistence.replayWindow
      },
      statusSemantics: {
        terminal: persistedRecovery.statusSemantics.terminal,
        durable: persistedRecovery.statusSemantics.durable,
        clientRetryRecommended: persistedRecovery.statusSemantics.clientRetryRecommended,
        operatorInterventionRequired: persistedRecovery.statusSemantics.operatorInterventionRequired,
        reason: persistedRecovery.statusSemantics.reason,
        commandOutcomeCounts: persistedRecovery.statusSemantics.commandOutcomeCounts
      }
    },
    lifecycle: {
      mode: lifecycleSettings.mode,
      enabled: lifecycleSettings.enabled,
      state: lifecycleControls.state,
      schedule: lifecycleSettings.schedule,
      controls: lifecycleSettings.controls,
      validation: lifecycleSettings.validation,
      transitionPlan: {
        state: lifecycleTransitionPlan.state,
        route: lifecycleTransitionPlan.route,
        current: lifecycleTransitionPlan.current,
        projected: lifecycleTransitionPlan.projected,
        controlsAfterProjection: lifecycleTransitionPlan.controlsAfterProjection,
        nextAction: lifecycleTransitionPlan.nextAction,
        blockedTransitionCount: lifecycleTransitionPlan.blockedTransitionCount,
        transitions: lifecycleTransitionPlan.transitions.map((transition) => ({
          transitionId: transition.transitionId,
          commandId: transition.commandId,
          commandType: transition.commandType,
          action: transition.action,
          appliedToProjection: transition.appliedToProjection,
          blockers: transition.blockers,
          to: transition.to,
          command: transition.command
        }))
      }
    },
    operationalHealth: {
      state: operationalHealth.state,
      degraded: operationalHealth.degraded,
      degradedModes: operationalHealth.degradedModes,
      failureState: {
        status: operationalHealth.failureState.status,
        phase: operationalHealth.failureState.phase,
        terminal: operationalHealth.failureState.terminal,
        degradedRecoverable: operationalHealth.failureState.degradedRecoverable,
        blockerCodes: operationalHealth.failureState.blockerCodes,
        retryBlockedReasons: operationalHealth.failureState.retryBlockedReasons
      },
      retryPlan: operationalHealth.retryPlan,
      degradedModePlan: operationalHealth.degradedModePlan.map((plan) => ({
        degradedMode: plan.degradedMode,
        state: plan.state,
        severity: plan.severity,
        owners: plan.owners,
        phases: plan.phases,
        retryable: plan.retryable,
        nextRetrySeconds: plan.nextRetrySeconds,
        route: plan.route
      })),
      recoveryRunbook: operationalHealth.recoveryRunbook.slice(0, 5).map((step) => ({
        stepId: step.stepId,
        phase: step.phase,
        errorId: step.errorId,
        owner: step.owner,
        action: step.action,
        command: step.command,
        executeAfterSeconds: step.executeAfterSeconds,
        proofRoute: step.proofRoute,
        degradedMode: step.degradedMode
      })),
      failedProbeNames: operationalHealth.auditProof.failedProbeNames,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      topErrors: operationalHealth.actionableErrors.slice(0, 5).map((error) => ({
        errorId: error.errorId,
        code: error.code,
        severity: error.severity,
        owner: error.owner,
        action: error.action,
        retryable: error.retryable,
        command: error.command
      }))
    },
    analytics: {
      payloadType: 'hosted-kernel.failure-taxonomy.client-analytics-state.v1',
      state: analyticsExports.state,
      exportId: analyticsExports.exportId,
      exportRoute: analyticsExports.exportRoute,
      historyRoute: analyticsExports.historyRoute,
      reportRoute: analyticsExports.reportRoute,
      retainedSnapshotCount: analyticsExports.history.retainedSnapshotCount,
      latestSnapshotId: analyticsExports.history.latestSnapshotId,
      drift: {
        direction: analyticsExports.history.drift.direction,
        changed: analyticsExports.history.drift.changed,
        stateChanged: analyticsExports.history.drift.stateChanged,
        deltas: analyticsExports.history.drift.deltas
      },
      counters: {
        incidentCount: analyticsExports.counterSet.incidentCount,
        blockedDecisionCount: analyticsExports.counterSet.blockedDecisionCount,
        publishableDecisionCount: analyticsExports.counterSet.publishableDecisionCount,
        actionableErrorCount: analyticsExports.counterSet.actionableErrorCount,
        failedProbeCount: analyticsExports.counterSet.failedProbeCount,
        issueSeverityCounts: analyticsExports.counterSet.issueSeverityCounts,
        recoveryModeCounts: analyticsExports.counterSet.recoveryModeCounts
      },
      exportReadiness: analyticsExports.exportReadiness,
      report: {
        rowCount: analyticsExports.report.rowCount,
        issueRowCount: analyticsExports.report.issueRowCount,
        decisionRowCount: analyticsExports.report.decisionRowCount,
        workspaceRowCount: analyticsExports.report.workspaceRowCount,
        degradedModeRowCount: analyticsExports.report.degradedModeRowCount
      },
      timeline: analyticsExports.timeline,
      proof: analyticsExports.proof
    },
    permissions: {
      canReadTaxonomy: tenantBoundary.readable,
      canReadAuditProof: tenantBoundary.proofReadable,
      canPublishPreview: acceptance.accepted && readiness.state === 'ready' && lifecycleControls.commands.publish_preview.enabled && canTenant(tenantScope, 'preview:publish'),
      canAcknowledgeHandoff: workflowHandoff.queue.length > 0 && workflowHandoff.requirements.acknowledgementPermission && workflowHandoff.requirements.acknowledgementControlEnabled && acceptance.accepted,
      canRetrySync: nextSteps.some((step) => step.action === 'sync_provider_incidents') && lifecycleControls.commands.retry_sync.enabled && canTenant(tenantScope, 'sync:retry'),
      canManageLifecycleSettings: canTenant(tenantScope, 'settings:manage'),
      workspaceActivationRequired: tenantBoundary.boundaryHandoff.activationRequiredCount > 0,
      workspaceActivationLinks: tenantBoundary.boundaryHandoff.activationLinks,
      deniedCommands: tenantBoundary.commandDecisions.filter((decision) => !decision.allowed),
      commandAuditHandoffs: tenantBoundary.commandDecisions.map((decision) => ({
        commandId: decision.commandId,
        allowed: decision.allowed,
        reason: decision.reason,
        targetWorkspaceId: decision.targetWorkspaceId,
        requiredPermission: decision.requiredPermission,
        workspaceActivationRequired: decision.workspaceActivationRequired,
        activationRoute: decision.workspaceSwitch?.activationRoute || null,
        proofRoute: decision.auditHandoff.proofRoute
      }))
    }
  };
}

function buildPreviewAcceptancePacket(requestContext, preview, readiness, acceptance, validation, nextSteps, lifecycleControls, persistedRecovery, auditProof, taxonomyDecisions, operationalHealth) {
  const blockingIssues = validation.issues.filter((issue) => issue.severity === 'critical');
  const warningIssues = validation.issues.filter((issue) => issue.severity !== 'critical');
  const blockedDecisions = taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'blocking');
  const reviewDecisions = taxonomyDecisions.filter((decision) => decision.acceptanceImpact === 'review_required');
  const visibleNextSteps = nextSteps.slice(0, 8).map((step, index) => {
    const healthError = operationalHealth.actionableErrors.find((error) =>
      error.code === step.reason || error.refs.includes(step.target)
    );
    const commandType = step.action === 'publish_taxonomy_preview'
      ? 'publish_preview'
      : step.action === 'sync_provider_incidents'
        ? 'retry_sync'
        : step.action === 'acknowledge_external_handoff'
          ? 'ack_handoff'
          : step.action === 'enable_failure_taxonomy' || step.action === 'exit_lifecycle_maintenance'
            ? 'enable_taxonomy'
            : 'recover_state';
    const commandControl = commandType === 'publish_preview'
      ? lifecycleControls.commands.publish_preview
      : commandType === 'retry_sync'
        ? lifecycleControls.commands.retry_sync
        : commandType === 'ack_handoff'
          ? lifecycleControls.commands.ack_handoff
          : lifecycleControls.commands.settings_manage;

    return {
      stepType: 'hosted-kernel.failure-taxonomy.explainable-next-step.v1',
      stepId: `preview-next-step-${index + 1}`,
      action: step.action,
      label: step.label,
      reason: step.reason,
      target: step.target,
      command: {
        type: commandType,
        route: commandType === 'publish_preview'
          ? `${requestContext.route}/preview/acceptance`
          : commandType === 'ack_handoff'
            ? `${requestContext.route}/handoff/ack`
            : `${requestContext.route}/commands`,
        idempotencyKey: `${commandType}:${step.target}:${persistedRecovery.generation}:preview`,
        enabled: commandType === 'publish_preview'
          ? acceptance.accepted && readiness.state === 'ready' && commandControl.enabled
          : commandControl.enabled
      },
      explanation: {
        phase: healthError ? resolveFailurePhase(healthError) : 'preview_acceptance',
        owner: healthError?.owner || 'operator',
        severity: healthError?.severity || (acceptance.accepted ? 'info' : 'warning'),
        blockedReason: commandControl.enabled ? null : commandControl.reason,
        proofRoute: `${requestContext.route}/proofs/${encodeURIComponent(auditProof.requestId)}`
      }
    };
  });
  const acceptabilityGates = [
    {
      gate: 'readiness_checklist',
      accepted: readiness.blockedGates.length === 0,
      detail: readiness.blockedGates.join(',') || readiness.state
    },
    {
      gate: 'blocking_validation_issues',
      accepted: blockingIssues.length === 0,
      detail: blockingIssues.map((issue) => issue.code).join(',') || 'none'
    },
    {
      gate: 'taxonomy_decision_blocks',
      accepted: blockedDecisions.length === 0,
      detail: blockedDecisions.map((decision) => decision.incidentId).join(',') || 'none'
    },
    {
      gate: 'publish_command_available',
      accepted: lifecycleControls.commands.publish_preview.enabled,
      detail: lifecycleControls.commands.publish_preview.reason
    }
  ];

  return {
    contractType: 'hosted-kernel.failure-taxonomy.preview-acceptance-packet.v1',
    requestId: requestContext.requestId,
    stateVersion: requestContext.stateVersion,
    generatedForRoute: `${requestContext.route}/preview/acceptance`,
    display: {
      title: preview.title,
      badge: acceptance.accepted ? readiness.state : 'blocked',
      summary: preview.summary,
      primaryIncidentId: preview.cards[0]?.incidentId || null,
      emptyState: preview.emptyState
    },
    validationSummary: {
      status: validation.status,
      issueCount: validation.issueCount,
      blockingIssueCount: blockingIssues.length,
      warningIssueCount: warningIssues.length,
      blockedDecisionCount: blockedDecisions.length,
      reviewDecisionCount: reviewDecisions.length,
      publishableDecisionCount: validation.publishableDecisionCount
    },
    acceptance: {
      decision: acceptance.decision,
      accepted: acceptance.accepted,
      requiresHumanReview: acceptance.requiresHumanReview,
      proofLabel: acceptance.proofLabel,
      submitRoute: `${requestContext.route}/preview/acceptance`,
      submitEnabled: acceptance.accepted && readiness.state === 'ready' && lifecycleControls.commands.publish_preview.enabled,
      blockerCodes: acceptance.blockerCodes
    },
    acceptabilityGates,
    explainableNextSteps: visibleNextSteps,
    proof: {
      proofType: 'hosted-kernel.failure-taxonomy.preview-acceptance-proof.v1',
      requestId: requestContext.requestId,
      resumeToken: persistedRecovery.resumeToken,
      readinessState: readiness.state,
      acceptanceDecision: acceptance.decision,
      allGatesAccepted: acceptabilityGates.every((gate) => gate.accepted),
      nextStepCount: visibleNextSteps.length,
      commandRoutesBound: visibleNextSteps.every((step) => step.command.route.startsWith(requestContext.route))
    }
  };
}

function buildRouteDataContracts(requestContext, preview, readiness, acceptance, validation, nextSteps, lifecycleControls, lifecycleTransitionPlan, persistedRecovery, auditProof, taxonomyDecisions, workflowHandoff, tenantBoundary, operationalHealth, analyticsExports) {
  const criticalIssues = validation.issues.filter((issue) => issue.severity === 'critical');
  const reviewIssues = validation.issues.filter((issue) => issue.severity !== 'critical');
  const publishEnabled = acceptance.accepted
    && readiness.state === 'ready'
    && lifecycleControls.commands.publish_preview.enabled;
  const previewAcceptancePacket = buildPreviewAcceptancePacket(
    requestContext,
    preview,
    readiness,
    acceptance,
    validation,
    nextSteps,
    lifecycleControls,
    persistedRecovery,
    auditProof,
    taxonomyDecisions,
    operationalHealth
  );
  const exportHandoffPacket = buildExportHandoffPacket(
    requestContext,
    analyticsExports,
    readiness,
    acceptance,
    validation,
    nextSteps,
    lifecycleControls,
    persistedRecovery,
    workflowHandoff,
    tenantBoundary
  );
  const issueGroups = validation.issues.reduce((groups, issue) => {
    const existing = groups[issue.severity] || {
      severity: issue.severity,
      count: 0,
      issueCodes: [],
      firstRef: null
    };
    existing.count += 1;
    existing.issueCodes.push(issue.code);
    existing.firstRef = existing.firstRef || issue.refs[0] || null;
    groups[issue.severity] = existing;
    return groups;
  }, {});
  const commandTypeByAction = {
    acknowledge_external_handoff: 'ack_handoff',
    enable_failure_taxonomy: 'enable_taxonomy',
    exit_lifecycle_maintenance: 'enable_taxonomy',
    publish_taxonomy_preview: 'publish_preview',
    resolve_lifecycle_transition_blocker: 'set_sync_schedule',
    resolve_blocker: 'recover_state',
    review_validation_issue: 'recover_state',
    sync_provider_incidents: 'retry_sync'
  };
  const nextStepCommands = nextSteps.map((step, index) => {
    const commandType = commandTypeByAction[step.action] || 'recover_state';
    const commandRoute = commandType === 'ack_handoff'
      ? `${requestContext.route}/handoff/ack`
      : commandType === 'publish_preview'
        ? `${requestContext.route}/preview/acceptance`
        : `${requestContext.route}/commands`;

    return {
      stepId: `next-step-${index + 1}`,
      action: step.action,
      label: step.label,
      reason: step.reason,
      command: {
        type: commandType,
        target: step.target,
        route: commandRoute,
        idempotencyKey: `${commandType}:${step.target}:${persistedRecovery.generation}`,
        enabled: commandType === 'publish_preview'
          ? publishEnabled
          : commandType === 'retry_sync'
            ? lifecycleControls.commands.retry_sync.enabled
            : commandType === 'ack_handoff'
              ? lifecycleControls.commands.ack_handoff.enabled
              : lifecycleControls.commands.settings_manage.enabled || lifecycleControls.commands.publish_preview.enabled
      }
    };
  });

  return {
    contractType: 'hosted-kernel.failure-taxonomy.route-data-contracts.v1',
    requestId: requestContext.requestId,
    stateVersion: requestContext.stateVersion,
    routes: {
      preview: `${requestContext.route}/preview`,
      validationSummary: `${requestContext.route}/validation/summary`,
      readiness: `${requestContext.route}/readiness`,
      acceptance: `${requestContext.route}/preview/acceptance`,
      nextSteps: `${requestContext.route}/next-steps`,
      classificationMatrix: `${requestContext.route}/taxonomy/decisions`,
      workflowHandoff: `${requestContext.route}/handoff/workflow`,
      operationalHealth: `${requestContext.route}/health`,
      analyticsExport: analyticsExports.exportRoute,
      analyticsHistory: analyticsExports.historyRoute,
      exportHandoff: exportHandoffPacket.routeContract.route,
      lifecycleSettings: lifecycleTransitionPlan.route,
      auditProof: `${requestContext.route}/proofs/${encodeURIComponent(auditProof.requestId)}`
    },
    responseHeaders: {
      'x-aios-surface-id': surfaceId,
      'x-aios-request-id': requestContext.requestId,
      'x-aios-proof-type': auditProof.proofType,
      'x-aios-acceptance-decision': acceptance.decision
    },
    previewPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.preview-panel.v1',
      title: preview.title,
      statusBadge: preview.statusBadge,
      summary: preview.summary,
      cardCount: preview.cards.length,
      primaryCardIncidentId: preview.cards[0]?.incidentId || null,
      emptyState: preview.emptyState,
      refreshRoute: `${requestContext.route}/preview?requestId=${encodeURIComponent(requestContext.requestId)}`
    },
    previewAcceptancePacket,
    exportHandoffPacket,
    acceptanceForm: {
      payloadType: 'hosted-kernel.failure-taxonomy.acceptance-form.v1',
      decision: acceptance.decision,
      submitEnabled: publishEnabled,
      submitRoute: `${requestContext.route}/preview/acceptance`,
      submitCommand: {
        type: 'publish_preview',
        target: surfaceId,
        idempotencyKey: `publish_preview:${surfaceId}:${persistedRecovery.resumeToken}`
      },
      blockerCodes: acceptance.blockerCodes,
      proofLabel: acceptance.proofLabel,
      requiresHumanReview: acceptance.requiresHumanReview
    },
    validationSummary: {
      payloadType: 'hosted-kernel.failure-taxonomy.validation-summary.v1',
      status: validation.status,
      issueCount: validation.issueCount,
      criticalIssueCount: criticalIssues.length,
      reviewIssueCount: reviewIssues.length,
      issueGroups: Object.values(issueGroups),
      topIssues: validation.issues.slice(0, 5).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        primaryRef: issue.refs[0] || null
      }))
    },
    tenantBoundaryPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.tenant-boundary-panel.v1',
      state: tenantBoundary.readable
        ? tenantBoundary.boundaryProof.handoffRequired
          ? 'scoped_with_handoff'
          : 'scoped'
        : 'blocked',
      proofType: tenantBoundary.boundaryProof.proofType,
      activeWorkspaceId: tenantBoundary.boundaryProof.activeWorkspaceId,
      allowedWorkspaceIds: tenantBoundary.boundaryProof.allowedWorkspaceIds,
      hiddenIncidentCount: tenantBoundary.boundaryProof.hiddenIncidentCount,
      blockedCommandCount: tenantBoundary.boundaryProof.blockedCommandCount,
      activationRequiredCount: tenantBoundary.boundaryProof.activationRequiredCount,
      failClosed: tenantBoundary.boundaryProof.failClosed,
      disclosureMode: tenantBoundary.boundaryProof.disclosureMode,
      handoff: tenantBoundary.boundaryHandoff,
      workspaces: tenantBoundary.workspaceAccess.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        allowed: workspace.allowed,
        active: workspace.active,
        visibleIncidentCount: workspace.visibleIncidentCount,
        hiddenIncidentCount: workspace.hiddenIncidentCount,
        commandCount: workspace.commandCount,
        handoffRoute: workspace.handoffRoute
      })),
      blockedCommands: tenantBoundary.commandDecisions
        .filter((decision) => !decision.allowed)
        .map((decision) => ({
          commandId: decision.commandId,
          type: decision.type,
          reason: decision.reason,
          targetWorkspaceId: decision.targetWorkspaceId,
          requiredPermission: decision.requiredPermission,
          workspaceActivationRequired: decision.workspaceActivationRequired,
          activationRoute: decision.workspaceSwitch?.activationRoute || null,
          proofRoute: decision.auditHandoff.proofRoute
        }))
    },
    classificationMatrix: {
      payloadType: 'hosted-kernel.failure-taxonomy.classification-matrix.v1',
      decisionCount: taxonomyDecisions.length,
      registeredCount: validation.registeredDecisionCount,
      publishableCount: validation.publishableDecisionCount,
      decisions: taxonomyDecisions.map((decision) => ({
        incidentId: decision.incidentId,
        failureCode: decision.failureCode,
        classificationSource: decision.classificationSource,
        registered: decision.registered,
        severity: decision.severity,
        recoveryMode: decision.recoveryMode,
        recommendedAction: decision.recommendedAction,
        publishable: decision.publishable,
        acceptanceImpact: decision.acceptanceImpact,
        missingProofFields: decision.proofCoverage.missingFields
      }))
    },
    readinessChecklist: {
      payloadType: 'hosted-kernel.failure-taxonomy.readiness-checklist.v1',
      state: readiness.state,
      readyGateCount: readiness.readyGateCount,
      totalGateCount: readiness.totalGateCount,
      blockedGates: readiness.blockedGates,
      gates: readiness.gates.map((gate) => ({
        gate: gate.gate,
        ready: gate.ready,
        label: gate.label,
        detail: gate.detail,
        severity: gate.ready ? 'info' : criticalIssues.length ? 'critical' : 'warning'
      }))
    },
    lifecycleSettingsPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.lifecycle-settings-panel.v1',
      state: lifecycleTransitionPlan.state,
      route: lifecycleTransitionPlan.route,
      current: lifecycleTransitionPlan.current,
      projected: lifecycleTransitionPlan.projected,
      controlsAfterProjection: lifecycleTransitionPlan.controlsAfterProjection,
      nextAction: lifecycleTransitionPlan.nextAction,
      blockedTransitionCount: lifecycleTransitionPlan.blockedTransitionCount,
      proof: lifecycleTransitionPlan.proof,
      transitions: lifecycleTransitionPlan.transitions.map((transition) => ({
        transitionId: transition.transitionId,
        commandId: transition.commandId,
        commandType: transition.commandType,
        action: transition.action,
        target: transition.target,
        allowed: transition.allowed,
        appliedToProjection: transition.appliedToProjection,
        blockers: transition.blockers,
        from: transition.from,
        to: transition.to,
        command: transition.command,
        proofRefs: transition.proofRefs
      }))
    },
    commandReplayPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.command-replay-panel.v1',
      state: persistedRecovery.commandReplay.blockedCount > 0
        ? persistedRecovery.commandReplay.retryableBlockedCount === persistedRecovery.commandReplay.blockedCount
          ? 'retryable-blocked'
          : 'blocked'
        : persistedRecovery.commandReplay.replayableCount > 0
          ? 'replayable'
          : 'idle',
      commandCount: persistedRecovery.commandReplay.commandCount,
      replayableCount: persistedRecovery.commandReplay.replayableCount,
      blockedCount: persistedRecovery.commandReplay.blockedCount,
      duplicateCount: persistedRecovery.commandReplay.duplicateCount,
      retryableBlockedCount: persistedRecovery.commandReplay.retryableBlockedCount,
      summary: persistedRecovery.commandReplay.claimSummary,
      claims: persistedRecovery.commandReplay.claims.map((claim) => ({
        commandId: claim.commandId,
        type: claim.type,
        target: claim.target,
        state: claim.state,
        replayable: claim.replayable,
        retryable: claim.retryable,
        duplicate: claim.duplicate,
        restartSafe: claim.restartSafe,
        blockerCodes: claim.blockerCodes,
        nextCommand: claim.nextCommand
      }))
    },
    workflowHandoffPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.workflow-handoff-panel.v1',
      state: workflowHandoff.state,
      destination: workflowHandoff.destination,
      deliveryMode: workflowHandoff.delivery.mode,
      commandPresentation: workflowHandoff.delivery.commandPresentation,
      badge: workflowHandoff.userVisibleState.badge,
      primaryAction: workflowHandoff.userVisibleState.primaryAction,
      primaryRoute: workflowHandoff.userVisibleState.primaryRoute,
      secondaryRoute: workflowHandoff.userVisibleState.secondaryRoute,
      fallbackReason: workflowHandoff.fallbackReason,
      queueCount: workflowHandoff.queue.length,
      acknowledgementRoute: workflowHandoff.acknowledgementRoute,
      providerRoute: workflowHandoff.providerRoute,
      callbackRoute: workflowHandoff.delivery.callbackRoute,
      returnRoute: workflowHandoff.delivery.returnRoute,
      polling: workflowHandoff.delivery.polling,
      resumePatch: workflowHandoff.delivery.resumePatch,
      requirements: workflowHandoff.requirements,
      items: workflowHandoff.queue.map((item) => ({
        handoffId: item.handoffId,
        incidentId: item.incidentId,
        failureCode: item.failureCode,
        status: item.status,
        deliveryMode: item.deliveryMode,
        commandEnabled: item.command.enabled,
        commandRoute: item.command.route,
        idempotencyKey: item.command.idempotencyKey,
        preflight: item.preflight
      }))
    },
    operationalHealthPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.operational-health-panel.v1',
      state: operationalHealth.state,
      degraded: operationalHealth.degraded,
      degradedModes: operationalHealth.degradedModes,
      failureState: {
        status: operationalHealth.failureState.status,
        phase: operationalHealth.failureState.phase,
        terminal: operationalHealth.failureState.terminal,
        degradedRecoverable: operationalHealth.failureState.degradedRecoverable,
        blockerCodes: operationalHealth.failureState.blockerCodes,
        retryBlockedReasons: operationalHealth.failureState.retryBlockedReasons
      },
      healthRoute: `${requestContext.route}/health`,
      proofType: operationalHealth.auditProof.proofType,
      failedProbeNames: operationalHealth.auditProof.failedProbeNames,
      retryPlan: operationalHealth.retryPlan,
      degradedModePlan: operationalHealth.degradedModePlan.map((plan) => ({
        degradedMode: plan.degradedMode,
        state: plan.state,
        severity: plan.severity,
        owners: plan.owners,
        phases: plan.phases,
        issueCodes: plan.issueCodes,
        commandTypes: plan.commandTypes,
        retryable: plan.retryable,
        nextRetrySeconds: plan.nextRetrySeconds,
        commandBlockedReasons: plan.commandBlockedReasons,
        route: plan.route
      })),
      recoveryRunbook: operationalHealth.recoveryRunbook.map((step) => ({
        stepId: step.stepId,
        phase: step.phase,
        errorId: step.errorId,
        owner: step.owner,
        action: step.action,
        command: step.command,
        executeAfterSeconds: step.executeAfterSeconds,
        proofRoute: step.proofRoute,
        degradedMode: step.degradedMode
      })),
      probes: operationalHealth.probes.map((probe) => ({
        name: probe.name,
        ok: probe.ok,
        route: probe.route,
        detail: probe.detail
      })),
      actionableErrors: operationalHealth.actionableErrors.slice(0, 8).map((error) => ({
        errorId: error.errorId,
        code: error.code,
        severity: error.severity,
        owner: error.owner,
        action: error.action,
        degradedMode: error.degradedMode,
        retryable: error.retryable,
        retryAfterSeconds: error.retryAfterSeconds,
        command: error.command
      }))
    },
    analyticsExportPanel: {
      payloadType: 'hosted-kernel.failure-taxonomy.analytics-export-panel.v1',
      state: analyticsExports.state,
      exportId: analyticsExports.exportId,
      exportRoute: analyticsExports.exportRoute,
      historyRoute: analyticsExports.historyRoute,
      reportRoute: analyticsExports.reportRoute,
      retainedSnapshotCount: analyticsExports.history.retainedSnapshotCount,
      latestSnapshotId: analyticsExports.history.latestSnapshotId,
      counters: analyticsExports.counterSet,
      exportReadiness: analyticsExports.exportReadiness,
      drift: analyticsExports.history.drift,
      timeline: analyticsExports.timeline,
      report: analyticsExports.report,
      summary: analyticsExports.exportSummary,
      proof: analyticsExports.proof
    },
    exportHandoffPanel: {
      payloadType: exportHandoffPacket.packetType,
      state: exportHandoffPacket.state,
      canPublish: exportHandoffPacket.canPublish,
      exportRoute: exportHandoffPacket.exportRoute,
      reportRoute: exportHandoffPacket.reportRoute,
      routeContract: exportHandoffPacket.routeContract,
      blockedGateCount: exportHandoffPacket.blockedGateCount,
      blockedGates: exportHandoffPacket.blockedGates,
      primaryAction: exportHandoffPacket.primaryAction,
      analytics: exportHandoffPacket.analytics,
      handoff: exportHandoffPacket.handoff
    },
    nextStepCommands
  };
}

export function describeFailureTaxonomySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  const provider = normalizeProvider(input);
  const requestContext = normalizeRequestContext(input, now);
  const tenantScope = normalizeTenantScope(input);
  const evidence = normalizeEvidenceRecords(rawEvidence, tenantScope);
  const evidenceIndex = buildEvidenceReferenceIndex(evidence);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const providerServiceContract = buildProviderServiceContract(provider, requestContext, lifecycleSettings, now);
  const commands = normalizeCommandList(input);
  const incidents = Array.isArray(input.incidents)
    ? input.incidents.map((incident, index) => normalizeIncident(incident, index, now))
    : [];
  const tenantBoundary = applyTenantBoundary(tenantScope, incidents, commands);
  const scopedIncidents = tenantBoundary.readable ? tenantBoundary.visibleIncidents : [];
  const selection = chooseVisibleIncidents(requestContext, scopedIncidents);
  const syncState = buildSyncState(input, now, lifecycleSettings, providerServiceContract);
  const taxonomyDecisions = buildTaxonomyDecisions(scopedIncidents, evidenceIndex, providerServiceContract, lifecycleSettings);
  const handoff = buildHandoffState(scopedIncidents, provider, providerServiceContract);
  const initialLifecycleControls = buildLifecycleControls(lifecycleSettings, syncState, handoff);
  const persistedRecovery = buildPersistedRecoveryState(input, now, requestContext, provider, scopedIncidents, syncState, handoff, tenantScope, tenantBoundary, lifecycleSettings, initialLifecycleControls);
  const lifecycleTransitionPlan = buildLifecycleTransitionPlan(commands, lifecycleSettings, syncState, handoff, providerServiceContract, tenantBoundary, requestContext, persistedRecovery, now);
  const baseAuditProof = buildAuditProof(now, provider, providerServiceContract, scopedIncidents, syncState, evidence, requestContext, persistedRecovery, tenantScope, tenantBoundary, lifecycleSettings, lifecycleTransitionPlan, taxonomyDecisions);
  const validation = summarizeValidation(provider, providerServiceContract, scopedIncidents, syncState, evidence, baseAuditProof, requestContext, selection, tenantScope, tenantBoundary, lifecycleSettings, lifecycleTransitionPlan, taxonomyDecisions);
  const lifecycleControls = buildLifecycleControls(lifecycleSettings, syncState, handoff, validation.status);
  const operationalHealth = buildOperationalHealth(input, now, providerServiceContract, syncState, handoff, validation, lifecycleSettings, lifecycleControls, taxonomyDecisions, persistedRecovery, requestContext);
  const readiness = buildReadiness(provider, providerServiceContract, scopedIncidents, syncState, handoff, validation, tenantBoundary, lifecycleSettings, lifecycleControls, taxonomyDecisions);
  const preview = buildPreview(scopedIncidents, handoff, validation, readiness, taxonomyDecisions);
  const acceptance = buildAcceptance(readiness, validation, handoff);
  const nextSteps = buildNextSteps(readiness, validation, handoff, syncState, lifecycleSettings, lifecycleControls, lifecycleTransitionPlan);
  const analyticsExports = buildAnalyticsExports(input, now, requestContext, providerServiceContract, tenantScope, tenantBoundary, syncState, lifecycleSettings, persistedRecovery, handoff, validation, readiness, acceptance, taxonomyDecisions, operationalHealth);
  const auditProof = {
    ...baseAuditProof,
    operationalHealthProof: operationalHealth.auditProof,
    analyticsProof: analyticsExports.proof,
    assertions: [
      ...baseAuditProof.assertions,
      {
        name: 'operational_health_probes_actionable',
        ok: operationalHealth.probes.every((probe) => probe.ok) || operationalHealth.actionableErrors.length > 0,
        state: operationalHealth.state,
        failedProbeNames: operationalHealth.auditProof.failedProbeNames,
        actionableErrorCount: operationalHealth.actionableErrors.length
      },
      {
        name: 'analytics_export_counters_reconciled',
        ok: analyticsExports.proof.countersReconciled
          && analyticsExports.proof.historyAppendOnly
          && analyticsExports.proof.reportRowsReconciled,
        exportId: analyticsExports.exportId,
        snapshotId: analyticsExports.proof.snapshotId,
        retainedSnapshotCount: analyticsExports.history.retainedSnapshotCount,
        reportRowCount: analyticsExports.report.rowCount,
        exportReady: analyticsExports.proof.exportReady,
        blockedExportGates: analyticsExports.proof.blockedExportGates
      }
    ]
  };
  const clientRuntime = buildClientRuntimeState(requestContext, provider, providerServiceContract, selection, handoff, readiness, acceptance, nextSteps, persistedRecovery, tenantScope, tenantBoundary, lifecycleSettings, lifecycleControls, lifecycleTransitionPlan, taxonomyDecisions, operationalHealth, analyticsExports);
  auditProof.workflowHandoffProof = {
    proofType: 'hosted-kernel.failure-taxonomy.workflow-handoff-proof.v1',
    requestId: requestContext.requestId,
    channel: requestContext.channel,
    handoffPreference: requestContext.handoffPreference,
    deliveryMode: clientRuntime.workflowHandoff.delivery.mode,
    resumeToken: persistedRecovery.resumeToken,
    queueCount: clientRuntime.workflowHandoff.queue.length,
    preflightCommandCount: clientRuntime.workflowHandoff.queue.filter((item) => item.preflight).length,
    callbackBound: Boolean(clientRuntime.workflowHandoff.delivery.callbackRoute),
    pollingRequired: clientRuntime.workflowHandoff.delivery.polling.required
  };
  auditProof.assertions.push({
    name: 'workflow_handoff_delivery_bound_to_client_state',
    ok: clientRuntime.workflowHandoff.queue.every((item) =>
      item.preflight
      && item.preflight.payloadShape.requestId === requestContext.requestId
      && item.preflight.payloadShape.resumeToken === persistedRecovery.resumeToken
    ) && clientRuntime.workflowHandoff.delivery.resumePatch.resumeToken === persistedRecovery.resumeToken,
    deliveryMode: clientRuntime.workflowHandoff.delivery.mode,
    commandPresentation: clientRuntime.workflowHandoff.delivery.commandPresentation,
    preflightCommandCount: auditProof.workflowHandoffProof.preflightCommandCount
  });
  const routeDataContracts = buildRouteDataContracts(requestContext, preview, readiness, acceptance, validation, nextSteps, lifecycleControls, lifecycleTransitionPlan, persistedRecovery, auditProof, taxonomyDecisions, clientRuntime.workflowHandoff, tenantBoundary, operationalHealth, analyticsExports);
  auditProof.previewAcceptanceProof = routeDataContracts.previewAcceptancePacket.proof;
  auditProof.assertions.push({
    name: 'preview_acceptance_packet_route_bound',
    ok: routeDataContracts.previewAcceptancePacket.generatedForRoute === routeDataContracts.routes.acceptance
      && routeDataContracts.previewAcceptancePacket.proof.commandRoutesBound
      && routeDataContracts.previewAcceptancePacket.acceptance.decision === acceptance.decision
      && routeDataContracts.previewAcceptancePacket.validationSummary.issueCount === validation.issueCount,
    route: routeDataContracts.previewAcceptancePacket.generatedForRoute,
    decision: routeDataContracts.previewAcceptancePacket.acceptance.decision,
    nextStepCount: routeDataContracts.previewAcceptancePacket.proof.nextStepCount,
    allGatesAccepted: routeDataContracts.previewAcceptancePacket.proof.allGatesAccepted
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      type: 'hosted-kernel.audit-recovery.failure-taxonomy',
      provider,
      providerServiceContract,
      tenantBoundary: {
        tenantId: tenantScope.tenantId,
        activeWorkspaceId: tenantScope.activeWorkspaceId,
        allowedWorkspaceIds: tenantScope.allowedWorkspaceIds,
        role: tenantScope.role,
        policyVersion: tenantScope.policyVersion,
        hiddenIncidentCount: tenantBoundary.deniedIncidents.length,
        deniedIncidents: tenantBoundary.deniedIncidents,
        workspaceAccess: tenantBoundary.workspaceAccess,
        commandDecisions: tenantBoundary.commandDecisions,
        boundaryHandoff: tenantBoundary.boundaryHandoff,
        boundaryProof: tenantBoundary.boundaryProof
      },
      taxonomy: BASE_FAILURE_CLASSES,
      taxonomyDecisions,
      lifecycleSettings,
      lifecycleControls,
      lifecycleTransitionPlan,
      sync: syncState,
      externalHandoff: handoff,
      persistedRecovery,
      operationalHealth,
      clientRuntime,
      preview,
      readiness,
      acceptance,
      validation,
      nextSteps,
      routeDataContracts,
      analyticsExports
    },
    incidents: scopedIncidents,
    taxonomyDecisions,
    hiddenIncidents: tenantBoundary.deniedIncidents,
    auditProof,
    lifecycleSettings,
    lifecycleControls,
    lifecycleTransitionPlan,
    preview,
    readiness,
    acceptance,
    validation,
    nextSteps,
    routeDataContracts,
    clientRuntime,
    persistedRecovery,
    operationalHealth,
    analyticsExports,
    evidence
  };
}

export default describeFailureTaxonomySurface;
