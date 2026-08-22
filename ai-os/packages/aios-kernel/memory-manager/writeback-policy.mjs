export const surfaceId = "aios_memory-manager_writeback-policy_047";
export const surfaceGroup = "memory-manager";
export const surfaceName = "writeback-policy";

const WRITEBACK_CAPABILITIES = Object.freeze({
  atomicCommit: 'memory.writeback.atomicCommit',
  externalHandoff: 'memory.writeback.externalHandoff',
  proofReceipt: 'memory.writeback.proofReceipt',
  syncCursor: 'memory.writeback.syncCursor'
});

const DEFAULT_PROVIDER = Object.freeze({
  id: 'hosted-kernel-memory-provider',
  priority: 0,
  capabilities: [
    WRITEBACK_CAPABILITIES.atomicCommit,
    WRITEBACK_CAPABILITIES.externalHandoff,
    WRITEBACK_CAPABILITIES.proofReceipt,
    WRITEBACK_CAPABILITIES.syncCursor
  ]
});

const VALID_URGENCY = new Set(['idle', 'normal', 'urgent']);
const VALID_DURABILITY = new Set(['ephemeral', 'eventual', 'durable']);
const VALID_HANDOFF = new Set(['none', 'queued', 'leased', 'blocked']);
const VALID_ACCEPTANCE = new Set(['pending', 'accepted', 'rejected']);
const VALID_CLIENT_SURFACES = new Set(['cli', 'desktop', 'web', 'api', 'hosted-kernel']);
const VALID_WRITEBACK_COMMANDS = new Set(['inspect', 'preview', 'accept', 'reject', 'commit', 'recover', 'enable', 'disable', 'schedule']);
const VALID_PERSISTED_PHASES = new Set(['new', 'previewed', 'accepted', 'committing', 'committed', 'rejected', 'blocked', 'disabled', 'scheduled']);
const VALID_SERVICE_PROTOCOLS = new Set(['hosted-kernel.writeback.v1', 'kernel-worker.writeback.v1', 'external-sync.writeback.v1']);
const VALID_DELIVERY_SEMANTICS = new Set(['at-most-once', 'at-least-once', 'exactly-once']);
const VALID_HANDOFF_CHANNELS = new Set(['kernel-queue', 'provider-webhook', 'external-sync', 'client-resume']);
const VALID_LEASE_STATES = new Set(['unleased', 'active', 'expired', 'revoked']);
const VALID_PROVIDER_RECEIPT_STATES = new Set(['not-required', 'awaiting-receipt', 'received', 'accepted', 'rejected', 'expired']);
const VALID_ACTOR_ROLES = new Set(['viewer', 'operator', 'admin', 'service', 'auditor']);
const VALID_HEALTH_STATES = new Set(['healthy', 'degraded', 'retrying', 'blocked', 'failed']);
const VALID_FAILURE_SOURCES = new Set(['provider', 'handoff', 'service-contract', 'tenant-boundary', 'persisted-state', 'operator', 'unknown']);
const VALID_RECOVERY_OPERATION_STATUSES = new Set(['pending', 'in-flight', 'completed', 'blocked', 'replayed', 'cancelled']);
const VALID_PERSISTENCE_RECORD_STATUSES = new Set(['append-required', 'replay-hit', 'blocked', 'read-only']);
const VALID_LIFECYCLE_MODES = new Set(['enabled', 'disabled', 'paused']);
const VALID_SCHEDULE_MODES = new Set(['immediate', 'manual', 'deferred', 'windowed']);
const VALID_CLIENT_CHECKPOINT_STAGES = new Set(['new', 'preview-opened', 'acceptance-submitted', 'handoff-issued', 'commit-submitted', 'completed']);
const VALID_WORKSPACE_SCOPE_MODES = new Set(['strict', 'tenant', 'workspace', 'delegated']);
const VALID_ANALYTICS_EXPORT_FORMATS = new Set(['json', 'jsonl', 'csv', 'parquet-manifest']);
const VALID_ANALYTICS_REPORT_WINDOWS = new Set(['current', 'rolling-24h', 'rolling-7d', 'rolling-30d', 'all']);
const PROOF_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const WRITEBACK_ROLE_PERMISSIONS = Object.freeze({
  viewer: ['memory.writeback.read', 'memory.writeback.preview'],
  operator: ['memory.writeback.read', 'memory.writeback.preview', 'memory.writeback.accept', 'memory.writeback.reject'],
  admin: ['memory.writeback.read', 'memory.writeback.preview', 'memory.writeback.accept', 'memory.writeback.reject', 'memory.writeback.commit', 'memory.writeback.recover', 'memory.writeback.configure'],
  service: ['memory.writeback.read', 'memory.writeback.preview', 'memory.writeback.accept', 'memory.writeback.commit', 'memory.writeback.recover', 'memory.writeback.configure'],
  auditor: ['memory.writeback.read', 'memory.writeback.preview', 'memory.writeback.audit']
});
const WRITEBACK_COMMAND_PERMISSIONS = Object.freeze({
  inspect: ['memory.writeback.read'],
  preview: ['memory.writeback.read', 'memory.writeback.preview'],
  accept: ['memory.writeback.read', 'memory.writeback.accept'],
  reject: ['memory.writeback.read', 'memory.writeback.reject'],
  commit: ['memory.writeback.read', 'memory.writeback.commit'],
  recover: ['memory.writeback.read', 'memory.writeback.recover'],
  enable: ['memory.writeback.read', 'memory.writeback.configure'],
  disable: ['memory.writeback.read', 'memory.writeback.configure'],
  schedule: ['memory.writeback.read', 'memory.writeback.configure']
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))];
}

function asTimeMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(asObject(value), key);
}

function normalizeCapabilities(value) {
  return asStringList(value);
}

function normalizeProvider(inputProvider = {}) {
  const provider = asObject(inputProvider);
  const capabilities = normalizeCapabilities(provider.capabilities);
  const mergedCapabilities = capabilities.length ? capabilities : DEFAULT_PROVIDER.capabilities;

  return {
    id: asString(provider.id, DEFAULT_PROVIDER.id),
    priority: Number.isFinite(provider.priority) ? provider.priority : DEFAULT_PROVIDER.priority,
    capabilities: mergedCapabilities,
    advertisedAt: asString(provider.advertisedAt, null)
  };
}

function negotiateProvider(provider, requestedCapabilities = []) {
  const requested = normalizeCapabilities(requestedCapabilities);
  const required = requested.length
    ? requested
    : [
      WRITEBACK_CAPABILITIES.atomicCommit,
      WRITEBACK_CAPABILITIES.proofReceipt,
      WRITEBACK_CAPABILITIES.syncCursor
    ];
  const providerCapabilities = new Set(provider.capabilities);
  const accepted = required.filter((capability) => providerCapabilities.has(capability));
  const missing = required.filter((capability) => !providerCapabilities.has(capability));

  return {
    accepted,
    missing,
    ready: missing.length === 0,
    mode: missing.length === 0 ? 'provider-ready' : 'provider-degraded'
  };
}

function normalizeSyncMetadata(input = {}, now) {
  const sync = asObject(input.sync);
  const urgency = VALID_URGENCY.has(sync.urgency) ? sync.urgency : 'normal';
  const durability = VALID_DURABILITY.has(sync.durability) ? sync.durability : 'durable';
  const lastCursor = asString(sync.lastCursor, null);
  const nextCursor = asString(sync.nextCursor, `${surfaceId}:${now}`);
  const batchId = asString(sync.batchId, `writeback:${nextCursor}`);

  return {
    batchId,
    urgency,
    durability,
    lastCursor,
    nextCursor,
    dirtyRecordCount: Number.isInteger(sync.dirtyRecordCount) && sync.dirtyRecordCount >= 0 ? sync.dirtyRecordCount : 0,
    maxBatchBytes: Number.isInteger(sync.maxBatchBytes) && sync.maxBatchBytes > 0 ? sync.maxBatchBytes : 262144
  };
}

function normalizeMailchimpWritebackContext(input = {}, syncMetadata, clientRuntime, tenantBoundary, handoffDeliveryState) {
  const workflow = asObject(input.productWorkflow || input.mailchimp || asObject(input.request).productWorkflow);
  const trustMetadataSource = asObject(
    workflow.trustMetadata
    || input.trustMetadata
    || asObject(input.memoryTrust).mailchimpCampaignContinuity
    || asObject(input.mailchimpTrustMetadata)
  );
  const trustContinuity = asObject(trustMetadataSource.mailchimpCampaignContinuity || trustMetadataSource.continuity || trustMetadataSource);
  const trustDispatchReadiness = asObject(trustContinuity.dispatchReadiness || trustMetadataSource.dispatchReadiness);
  const volatileFactSource = asObject(
    workflow.volatileFactCheck
    || input.volatileFactCheck
    || asObject(input.factCheck).mailchimpFactAnalytics
    || asObject(input.mailchimpFactCheck)
  );
  const factAnalytics = asObject(volatileFactSource.mailchimpFactAnalytics || volatileFactSource.analytics || volatileFactSource);
  const campaign = asObject(workflow.campaign);
  const audience = asObject(workflow.audience);
  const segment = asObject(workflow.segment);
  const provider = asString(workflow.provider, asString(workflow.campaignId || workflow.audienceId, null) ? 'mailchimp' : 'hosted-kernel');
  const applies = provider === 'mailchimp';
  const campaignId = asString(workflow.campaignId, asString(campaign.id, null));
  const audienceId = asString(workflow.audienceId, asString(workflow.listId, asString(audience.id, null)));
  const segmentId = asString(workflow.segmentId, asString(segment.id, null));
  const workflowId = asString(
    workflow.workflowId,
    asString(workflow.journeyId, asString(workflow.automationId, campaignId ? `mailchimp:${campaignId}` : null))
  );
  const stage = ['draft', 'preview', 'approval', 'sync', 'sent', 'archived'].includes(asString(workflow.stage, ''))
    ? asString(workflow.stage, '')
    : handoffDeliveryState.ready
      ? 'sync'
      : 'preview';
  const stateKey = [
    provider,
    workflowId || 'no-workflow',
    campaignId || 'no-campaign',
    audienceId || 'no-audience',
    segmentId || 'no-segment'
  ].join(':');
  const missingIdentifiers = applies
    ? [
      ...(!campaignId ? ['campaignId'] : []),
      ...(!audienceId ? ['audienceId'] : [])
    ]
    : [];
  const trustReadinessApplies = trustDispatchReadiness.applies === true || trustContinuity.applies === true;
  const trustReady = !trustReadinessApplies
    || trustDispatchReadiness.ready === true
    || trustContinuity.restartSafe === true && trustContinuity.auditDisposition === 'ready_for_campaign_handoff';
  const factAnalyticsApplies = factAnalytics.applies === true || factAnalytics.provider === 'mailchimp';
  const factAnalyticsReady = !factAnalyticsApplies || factAnalytics.readyForAnalyticsExport === true;
  const upstreamBlockedReasons = [
    ...(trustReadinessApplies && !trustReady
      ? (Array.isArray(trustDispatchReadiness.blockedReasons) && trustDispatchReadiness.blockedReasons.length
          ? trustDispatchReadiness.blockedReasons.map((reason) => `trust-metadata:${reason}`)
          : ['trust-metadata:mailchimp-dispatch-readiness-blocked'])
      : []),
    ...(factAnalyticsApplies && !factAnalyticsReady
      ? (Array.isArray(factAnalytics.blockedReasons) && factAnalytics.blockedReasons.length
          ? factAnalytics.blockedReasons.map((reason) => `volatile-fact-check:${reason}`)
          : ['volatile-fact-check:mailchimp-analytics-not-export-ready'])
      : [])
  ];
  const blockedReasons = [
    ...missingIdentifiers.map((field) => `mailchimp.${field}.required`),
    ...(applies && !tenantBoundary.allowed ? ['tenant_boundary_blocks_mailchimp_writeback'] : []),
    ...(applies && handoffDeliveryState.required && !handoffDeliveryState.ready ? ['handoff_delivery_not_ready'] : []),
    ...upstreamBlockedReasons
  ];
  const readyForExternalDispatch = applies
    && blockedReasons.length === 0
    && syncMetadata.dirtyRecordCount > 0;
  const upstreamReadiness = {
    trustMetadata: {
      observed: trustReadinessApplies,
      ready: trustReady,
      status: asString(trustDispatchReadiness.status, asString(trustContinuity.auditDisposition, trustReadinessApplies ? 'blocked' : 'not_observed')),
      nextAction: asString(trustDispatchReadiness.nextAction, null),
      proof: asString(trustDispatchReadiness.proof, asString(trustContinuity.proof, null)),
      blockedReasons: trustReadinessApplies && !trustReady
        ? upstreamBlockedReasons.filter((reason) => reason.startsWith('trust-metadata:'))
        : []
    },
    volatileFactCheck: {
      observed: factAnalyticsApplies,
      ready: factAnalyticsReady,
      status: factAnalyticsReady ? 'ready' : asString(factAnalytics.nextAction, 'blocked'),
      nextAction: asString(factAnalytics.nextAction, null),
      proof: asString(factAnalytics.proofDigest, asString(factAnalytics.proof, null)),
      blockedReasons: factAnalyticsApplies && !factAnalyticsReady
        ? upstreamBlockedReasons.filter((reason) => reason.startsWith('volatile-fact-check:'))
        : []
    }
  };

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.mailchimp-campaign-context.v1',
    applies,
    provider,
    stage,
    campaignId,
    audienceId,
    segmentId,
    workflowId,
    stateKey,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    dirtyRecordCount: syncMetadata.dirtyRecordCount,
    missingIdentifiers,
    blockedReasons,
    upstreamReadiness,
    readyForExternalDispatch,
    replayProtection: {
      replayKey: applies
        ? `${tenantBoundary.tenantId}:${tenantBoundary.workspaceId}:${stateKey}:${syncMetadata.nextCursor}`
        : null,
      idempotencyScope: clientRuntime.correlationKey,
      duplicateSafe: applies ? Boolean(clientRuntime.correlationKey && syncMetadata.nextCursor) : true
    },
    auditHandoff: {
      destination: 'memory-manager/writeback-policy/mailchimp-campaign',
      envelopeId: handoffDeliveryState.envelopeId,
      ackTopic: handoffDeliveryState.ackTopic,
      payloadSchema: 'memory.writeback.mailchimp-campaign-context.v1',
      blockedReasons
    },
    proof: `sha256:${stableExternalDispatchProof({
      surfaceId,
      provider,
      stateKey,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      blockedReasons
    })}`
  };
}

function normalizeExternalHandoff(input = {}, provider, negotiation) {
  const handoff = asObject(input.externalHandoff);
  const requestedState = asString(handoff.state, negotiation.ready ? 'queued' : 'blocked');
  const state = VALID_HANDOFF.has(requestedState) ? requestedState : 'blocked';
  const accepted = negotiation.ready && provider.capabilities.includes(WRITEBACK_CAPABILITIES.externalHandoff);

  return {
    state: accepted ? state : 'blocked',
    providerId: provider.id,
    leaseId: accepted ? asString(handoff.leaseId, null) : null,
    target: accepted ? asString(handoff.target, 'hosted-kernel-writeback') : 'provider-capability-missing',
    resumable: accepted && state !== 'none',
    blockedReason: accepted ? null : 'provider-missing-external-handoff-capability'
  };
}

function normalizeProviderServiceContract(input = {}, provider, negotiation, syncMetadata, externalHandoff) {
  const contract = asObject(input.serviceContract);
  const ack = asObject(contract.ack);
  const retry = asObject(contract.retry);
  const requestedProtocol = asString(contract.protocol, 'hosted-kernel.writeback.v1');
  const protocol = VALID_SERVICE_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : 'hosted-kernel.writeback.v1';
  const defaultAckCapabilities = [
    WRITEBACK_CAPABILITIES.atomicCommit,
    WRITEBACK_CAPABILITIES.proofReceipt,
    WRITEBACK_CAPABILITIES.syncCursor
  ];
  const requiredAckCapabilities = normalizeCapabilities(ack.requiredCapabilities).length
    ? normalizeCapabilities(ack.requiredCapabilities)
    : defaultAckCapabilities;
  const acknowledgedCapabilities = requiredAckCapabilities.filter((capability) => provider.capabilities.includes(capability));
  const missingAckCapabilities = requiredAckCapabilities.filter((capability) => !provider.capabilities.includes(capability));
  const deliverySemantics = VALID_DELIVERY_SEMANTICS.has(contract.deliverySemantics)
    ? contract.deliverySemantics
    : missingAckCapabilities.length
      ? 'at-least-once'
      : 'exactly-once';
  const maxInFlightBatches = Number.isInteger(contract.maxInFlightBatches) && contract.maxInFlightBatches > 0
    ? Math.min(contract.maxInFlightBatches, 16)
    : syncMetadata.urgency === 'urgent'
      ? 4
      : 1;
  const ackDeadlineMs = Number.isInteger(ack.deadlineMs) && ack.deadlineMs > 0
    ? Math.min(ack.deadlineMs, 300000)
    : syncMetadata.durability === 'durable'
      ? 30000
      : 90000;
  const maxAttempts = Number.isInteger(retry.maxAttempts) && retry.maxAttempts > 0
    ? Math.min(retry.maxAttempts, 10)
    : syncMetadata.durability === 'durable'
      ? 5
      : 2;
  const backoffMs = Number.isInteger(retry.backoffMs) && retry.backoffMs > 0
    ? Math.min(retry.backoffMs, 60000)
    : syncMetadata.urgency === 'urgent'
      ? 1000
      : 5000;
  const handoffRequired = contract.externalHandoffRequired === false ? false : syncMetadata.dirtyRecordCount > 0;
  const serviceReady = negotiation.ready
    && missingAckCapabilities.length === 0
    && (!handoffRequired || externalHandoff.state !== 'blocked');
  const blockedReasons = [
    ...(!negotiation.ready ? ['provider-negotiation-not-ready'] : []),
    ...missingAckCapabilities.map((capability) => `missing-ack-capability:${capability}`),
    ...(handoffRequired && externalHandoff.state === 'blocked' ? ['external-handoff-required-but-blocked'] : [])
  ];

  return {
    schemaVersion: 1,
    contractId: asString(contract.contractId, `${provider.id}:${syncMetadata.batchId}:service-contract`),
    providerId: provider.id,
    protocol,
    status: serviceReady ? 'ready' : blockedReasons.length ? 'blocked' : 'degraded',
    ready: serviceReady,
    deliverySemantics,
    maxInFlightBatches,
    ack: {
      requiredCapabilities: requiredAckCapabilities,
      acknowledgedCapabilities,
      missingCapabilities: missingAckCapabilities,
      deadlineMs: ackDeadlineMs,
      receiptRequired: acknowledgedCapabilities.includes(WRITEBACK_CAPABILITIES.proofReceipt)
    },
    retry: {
      maxAttempts,
      backoffMs,
      retryAfterCursor: syncMetadata.nextCursor,
      terminalOnMissingCapability: missingAckCapabilities.length > 0
    },
    externalHandoff: {
      required: handoffRequired,
      state: externalHandoff.state,
      target: externalHandoff.target,
      resumable: externalHandoff.resumable
    },
    blockedReasons
  };
}

function normalizeHandoffDeliveryState({
  input = {},
  now,
  syncMetadata,
  externalHandoff,
  serviceContract,
  clientRuntime,
  command,
  tenantBoundary,
  persistedState
}) {
  const handoff = asObject(input.externalHandoff);
  const delivery = asObject(handoff.delivery);
  const lease = asObject(handoff.lease);
  const nowMs = asTimeMs(now) ?? Date.now();
  const requestedChannel = asString(delivery.channel, externalHandoff.state === 'leased' ? 'provider-webhook' : 'kernel-queue');
  const channel = VALID_HANDOFF_CHANNELS.has(requestedChannel) ? requestedChannel : 'kernel-queue';
  const requestedLeaseState = asString(lease.state, externalHandoff.leaseId ? 'active' : 'unleased');
  const leaseState = VALID_LEASE_STATES.has(requestedLeaseState) ? requestedLeaseState : 'unleased';
  const leaseExpiresAt = asString(lease.expiresAt, null);
  const leaseExpiresAtMs = asTimeMs(leaseExpiresAt);
  const leaseExpired = leaseState === 'expired' || (leaseExpiresAtMs !== null && leaseExpiresAtMs <= nowMs);
  const leaseActive = leaseState === 'active' && Boolean(externalHandoff.leaseId) && !leaseExpired;
  const destination = asString(delivery.destination, externalHandoff.target);
  const ackTopic = asString(delivery.ackTopic, `${destination}.ack`);
  const payloadSchema = asString(delivery.payloadSchema, 'memory.writeback.handoff.v1');
  const envelopeId = asString(
    delivery.envelopeId,
    `${tenantBoundary.tenantId}:${tenantBoundary.workspaceId}:${syncMetadata.batchId}:${command.idempotencyKey}`
  );
  const resumeToken = asString(
    handoff.resumeToken,
    `${clientRuntime.correlationKey}:${persistedState.generation}:${syncMetadata.nextCursor}`
  );
  const handoffRequired = serviceContract.externalHandoff.required;
  const blockedReasons = [
    ...(!VALID_HANDOFF_CHANNELS.has(requestedChannel) ? [`invalid-handoff-channel:${requestedChannel}`] : []),
    ...(!VALID_LEASE_STATES.has(requestedLeaseState) ? [`invalid-lease-state:${requestedLeaseState}`] : []),
    ...(externalHandoff.state === 'blocked' ? [externalHandoff.blockedReason || 'external-handoff-blocked'] : []),
    ...(handoffRequired && !destination ? ['missing-handoff-destination'] : []),
    ...(handoffRequired && !ackTopic ? ['missing-handoff-ack-topic'] : []),
    ...(handoffRequired && externalHandoff.state === 'leased' && !leaseActive ? ['handoff-lease-not-active'] : []),
    ...(!tenantBoundary.allowed ? ['tenant-boundary-blocks-handoff'] : []),
    ...(!serviceContract.ready ? ['service-contract-not-ready-for-handoff'] : [])
  ];
  const ready = handoffRequired
    ? blockedReasons.length === 0 && externalHandoff.state !== 'none'
    : blockedReasons.filter((reason) => reason.startsWith('invalid-')).length === 0;

  return {
    schemaVersion: 1,
    envelopeId,
    status: ready ? 'ready' : blockedReasons.length ? 'blocked' : 'not-required',
    ready,
    required: handoffRequired,
    providerId: serviceContract.providerId,
    contractId: serviceContract.contractId,
    channel,
    destination,
    ackTopic,
    payloadSchema,
    resumeToken,
    lease: {
      state: leaseState,
      leaseId: externalHandoff.leaseId,
      active: leaseActive,
      expiresAt: leaseExpiresAt,
      expired: leaseExpired
    },
    payload: {
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      idempotencyKey: command.idempotencyKey,
      writeToken: persistedState.writeToken,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateScopeKey: tenantBoundary.stateScopeKey,
      commandType: command.type,
      deliverySemantics: serviceContract.deliverySemantics,
      ackDeadlineMs: serviceContract.ack.deadlineMs
    },
    blockedReasons
  };
}

function normalizePreviewRequest(input = {}, syncMetadata) {
  const preview = asObject(input.preview);
  const limit = Number.isInteger(preview.limit) && preview.limit > 0 ? Math.min(preview.limit, 25) : 5;
  const dirtyRecords = Array.isArray(preview.dirtyRecords) ? preview.dirtyRecords : [];
  const records = dirtyRecords.slice(0, limit).map((record, index) => {
    const item = asObject(record);
    const recordTenant = asObject(item.tenant);
    const recordWorkspace = asObject(item.workspace);
    const recordId = asString(item.recordId, asString(item.id, `dirty-record-${index + 1}`));
    const collection = asString(item.collection, 'memory');
    const operation = asString(item.operation, 'upsert');
    const byteSize = Number.isInteger(item.byteSize) && item.byteSize >= 0 ? item.byteSize : 0;
    const tenantId = asString(item.tenantId, asString(recordTenant.id, null));
    const workspaceId = asString(item.workspaceId, asString(recordWorkspace.id, null));
    const sourceScopeKey = asString(item.scopeKey, asString(item.stateScopeKey, null));

    return {
      recordId,
      collection,
      operation,
      byteSize,
      tenantId,
      workspaceId,
      sourceScopeKey,
      previewToken: `${syncMetadata.batchId}:${collection}:${recordId}`
    };
  });

  return {
    requested: preview.enabled !== false,
    limit,
    totalDirtyRecords: syncMetadata.dirtyRecordCount,
    shownRecordCount: records.length,
    truncated: syncMetadata.dirtyRecordCount > records.length,
    records
  };
}

function normalizeClientRuntime(input = {}, syncMetadata, now) {
  const request = asObject(input.request);
  const client = asObject(input.client);
  const dispatch = asObject({
    ...asObject(client.dispatch),
    ...asObject(request.dispatch),
    ...asObject(input.dispatch)
  });
  const surface = asString(client.surface, asString(request.surface, 'hosted-kernel'));
  const clientSurface = VALID_CLIENT_SURFACES.has(surface) ? surface : 'hosted-kernel';
  const requestId = asString(request.requestId, asString(input.requestId, `writeback-request:${syncMetadata.batchId}`));
  const clientRequestId = asString(client.requestId, requestId);
  const sessionId = asString(client.sessionId, asString(request.sessionId, `memory-session:${syncMetadata.batchId}`));
  const actor = asString(client.actor, asString(request.actor, 'hosted-kernel'));
  const traceId = asString(request.traceId, `${surfaceId}:${syncMetadata.nextCursor}`);
  const route = asString(request.route, 'memory-manager/writeback-policy');
  const returnTo = asString(request.returnTo, asString(client.returnTo, null));
  const intent = asString(request.intent, syncMetadata.dirtyRecordCount > 0 ? 'persist-dirty-memory' : 'inspect-writeback-state');
  const requestedScopes = asStringList(request.scopes);
  const scopes = requestedScopes.length ? requestedScopes : ['memory.writeback.read', 'memory.writeback.preview'];

  return {
    requestId,
    clientRequestId,
    sessionId,
    traceId,
    actor,
    surface: clientSurface,
    route,
    intent,
    scopes,
    returnTo,
    receivedAt: now,
    stateKey: `${sessionId}:${syncMetadata.batchId}`,
    correlationKey: `${clientSurface}:${clientRequestId}:${syncMetadata.nextCursor}`,
    dispatch: {
      dispatchId: asString(dispatch.dispatchId, null),
      preferredCommand: VALID_WRITEBACK_COMMANDS.has(dispatch.preferredCommand) ? dispatch.preferredCommand : null,
      requireFreshCheckpoint: dispatch.requireFreshCheckpoint === false ? false : true
    }
  };
}

function normalizeClientStateCheckpoint(input = {}, clientRuntime, syncMetadata, command, persistedState) {
  const request = asObject(input.request);
  const client = asObject(input.client);
  const requestState = asObject(request.clientState);
  const clientState = asObject(client.state);
  const checkpoint = asObject({
    ...clientState,
    ...requestState,
    ...asObject(input.clientState)
  });
  const stage = VALID_CLIENT_CHECKPOINT_STAGES.has(checkpoint.stage) ? checkpoint.stage : 'new';
  const acknowledgedStepIds = asStringList(checkpoint.acknowledgedStepIds);
  const lastSeenBatchId = asString(checkpoint.lastSeenBatchId, asString(checkpoint.batchId, null));
  const lastSeenCursor = asString(checkpoint.lastSeenCursor, asString(checkpoint.cursor, null));
  const stateKey = asString(checkpoint.stateKey, clientRuntime.stateKey);
  const revision = Number.isInteger(checkpoint.revision) && checkpoint.revision >= 0 ? checkpoint.revision : 0;
  const pendingCommandType = VALID_WRITEBACK_COMMANDS.has(checkpoint.pendingCommandType)
    ? checkpoint.pendingCommandType
    : null;
  const pendingIdempotencyKey = asString(checkpoint.pendingIdempotencyKey, null);
  const draftDecision = VALID_ACCEPTANCE.has(checkpoint.draftDecision) ? checkpoint.draftDecision : null;
  const batchMatches = !lastSeenBatchId || lastSeenBatchId === syncMetadata.batchId;
  const cursorMatches = !lastSeenCursor || lastSeenCursor === syncMetadata.nextCursor;
  const stateMatches = stateKey === clientRuntime.stateKey;
  const pendingCommandMatches = !pendingCommandType || pendingCommandType === command.type;
  const idempotencyMatches = !pendingIdempotencyKey || pendingIdempotencyKey === command.idempotencyKey;
  const staleReasons = [
    ...(!batchMatches ? [`client-batch-stale:${lastSeenBatchId}`] : []),
    ...(!cursorMatches ? [`client-cursor-stale:${lastSeenCursor}`] : []),
    ...(!stateMatches ? ['client-state-key-mismatch'] : []),
    ...(!pendingCommandMatches ? [`client-pending-command-conflict:${pendingCommandType}`] : []),
    ...(!idempotencyMatches ? ['client-idempotency-key-conflict'] : [])
  ];
  const refreshRequired = staleReasons.length > 0;

  return {
    schemaVersion: 1,
    checkpointType: 'memory.writeback.client-state-checkpoint.v1',
    stage,
    revision,
    stateKey,
    stateMatches,
    lastSeenBatchId,
    lastSeenCursor,
    batchMatches,
    cursorMatches,
    pendingCommandType,
    pendingIdempotencyKey,
    pendingCommandMatches,
    idempotencyMatches,
    draftDecision,
    acknowledgedStepIds,
    refreshRequired,
    staleReasons,
    nextRevision: revision + (refreshRequired || !persistedState.commandAlreadyApplied ? 1 : 0),
    checkpointToken: `${clientRuntime.correlationKey}:${revision}:${stage}`,
    continuationPatch: {
      request: {
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        traceId: clientRuntime.traceId,
        route: clientRuntime.route
      },
      client: {
        requestId: clientRuntime.clientRequestId,
        sessionId: clientRuntime.sessionId,
        surface: clientRuntime.surface,
        state: {
          stage,
          revision: revision + 1,
          stateKey: clientRuntime.stateKey,
          lastSeenBatchId: syncMetadata.batchId,
          lastSeenCursor: syncMetadata.nextCursor,
          pendingCommandType: command.type,
          pendingIdempotencyKey: command.idempotencyKey
        }
      },
      command: {
        type: command.type,
        idempotencyKey: command.idempotencyKey
      }
    }
  };
}

function normalizeAcceptance(input = {}, negotiation, syncMetadata, externalHandoff, tenantBoundary, lifecycleSettings) {
  const acceptance = asObject(input.acceptance);
  const requestedDecision = asString(acceptance.decision, negotiation.ready ? 'pending' : 'rejected');
  const decision = VALID_ACCEPTANCE.has(requestedDecision) ? requestedDecision : 'pending';
  const actor = asString(acceptance.actor, 'hosted-kernel');
  const acceptedAt = asString(acceptance.acceptedAt, null);
  const rejectionReason = asString(acceptance.rejectionReason, null);
  const boundaryAllowed = tenantBoundary ? tenantBoundary.allowed : true;
  const lifecycleReady = lifecycleSettings ? lifecycleSettings.ready : true;
  const canAccept = negotiation.ready && syncMetadata.dirtyRecordCount > 0 && externalHandoff.state !== 'blocked' && boundaryAllowed && lifecycleReady;
  const accepted = decision === 'accepted' && canAccept;
  const blockedReasons = [];

  if (!negotiation.ready) blockedReasons.push('provider-capability-negotiation-incomplete');
  if (syncMetadata.dirtyRecordCount === 0) blockedReasons.push('no-dirty-records-to-writeback');
  if (externalHandoff.state === 'blocked') blockedReasons.push(externalHandoff.blockedReason || 'external-handoff-blocked');
  if (!boundaryAllowed) blockedReasons.push(...tenantBoundary.boundaryViolations);
  if (!lifecycleReady && lifecycleSettings) blockedReasons.push(...lifecycleSettings.blockedReasons);
  if (decision === 'rejected' && rejectionReason) blockedReasons.push(rejectionReason);

  return {
    decision: accepted ? 'accepted' : decision,
    accepted,
    canAccept,
    actor,
    acceptedAt: accepted ? acceptedAt : null,
    blockedReasons,
    tenantId: tenantBoundary ? tenantBoundary.tenantId : null,
    workspaceId: tenantBoundary ? tenantBoundary.workspaceId : null,
    permissionBoundaryAllowed: boundaryAllowed,
    lifecycleReady,
    requiresUserPreview: decision === 'pending' && syncMetadata.dirtyRecordCount > 0
  };
}

function normalizeWritebackCommand(input = {}, clientRuntime, syncMetadata) {
  const command = asObject(input.command);
  const requestedType = asString(command.type, syncMetadata.dirtyRecordCount > 0 ? 'preview' : 'inspect');
  const type = VALID_WRITEBACK_COMMANDS.has(requestedType) ? requestedType : 'inspect';
  const idempotencyKey = asString(
    command.idempotencyKey,
    `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:${type}`
  );
  const actor = asString(command.actor, clientRuntime.actor);
  const issuedAt = asString(command.issuedAt, clientRuntime.receivedAt);

  return {
    type,
    idempotencyKey,
    actor,
    issuedAt,
    targetStateKey: clientRuntime.stateKey,
    targetBatchId: syncMetadata.batchId,
    targetCursor: syncMetadata.nextCursor
  };
}

function buildLifecycleCommandContract({
  input,
  command,
  clientRuntime,
  syncMetadata,
  now,
  requestedMode,
  mode,
  enabled,
  pausedUntil,
  pauseActive,
  schedule,
  scheduleReady,
  invalidScheduleReasons,
  blockedReasons
}) {
  const settings = asObject(input.settings);
  const writebackSettings = asObject(settings.writebackPolicy);
  const lifecycle = asObject(input.lifecycle);
  const rawSchedule = asObject({
    ...asObject(writebackSettings.schedule),
    ...asObject(lifecycle.schedule),
    ...asObject(input.schedule)
  });
  const lifecycleCommand = ['enable', 'disable', 'schedule'].includes(command.type);
  const requestedEnabled = hasOwn(lifecycle, 'enabled')
    ? lifecycle.enabled !== false
    : hasOwn(writebackSettings, 'enabled')
      ? writebackSettings.enabled !== false
      : null;
  const numericValidationReasons = [
    ...(hasOwn(rawSchedule, 'deferByMs') && (!Number.isInteger(rawSchedule.deferByMs) || rawSchedule.deferByMs < 0)
      ? ['invalid-defer-by-ms']
      : []),
    ...(hasOwn(rawSchedule, 'intervalMs') && (!Number.isInteger(rawSchedule.intervalMs) || rawSchedule.intervalMs < 60000)
      ? ['invalid-interval-ms']
      : [])
  ];
  const settingsValidationReasons = [...new Set([
    ...invalidScheduleReasons,
    ...numericValidationReasons
  ])];
  const schedulePatch = {
    mode: schedule.mode,
    scheduledFor: schedule.scheduledFor,
    intervalMs: schedule.intervalMs,
    deferByMs: schedule.deferByMs,
    windowStart: schedule.windowStart,
    windowEnd: schedule.windowEnd
  };
  const nextAction = !enabled
    ? {
      state: 'requires-enable',
      action: 'memory.writeback.lifecycle.enable',
      commandType: 'enable',
      enabled: true,
      reason: 'Writeback policy is disabled'
    }
    : pauseActive
      ? {
        state: 'requires-resume',
        action: 'memory.writeback.lifecycle.resume',
        commandType: 'schedule',
        enabled: true,
        reason: pausedUntil ? `Policy is paused until ${pausedUntil}` : 'Policy is paused'
      }
      : settingsValidationReasons.length
        ? {
          state: 'requires-settings-fix',
          action: 'memory.writeback.lifecycle.settings.fix',
          commandType: 'schedule',
          enabled: true,
          reason: settingsValidationReasons.join(', ')
        }
        : !scheduleReady
          ? {
            state: 'waiting-for-schedule',
            action: 'memory.writeback.lifecycle.schedule.wait',
            commandType: 'schedule',
            enabled: false,
            reason: `Schedule mode ${schedule.mode} is not ready`
          }
          : {
            state: 'ready',
            action: 'memory.writeback.lifecycle.ready',
            commandType: command.type,
            enabled: false,
            reason: 'Lifecycle settings permit writeback'
          };

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.lifecycle-settings-command.v1',
    contractId: `${clientRuntime.stateKey}:${syncMetadata.batchId}:${command.idempotencyKey}:lifecycle`,
    commandType: command.type,
    lifecycleCommand,
    idempotencyKey: command.idempotencyKey,
    requested: {
      mode: requestedMode,
      enabled: requestedEnabled,
      schedule: {
        mode: asString(rawSchedule.mode, null),
        deferByMs: hasOwn(rawSchedule, 'deferByMs') ? rawSchedule.deferByMs : null,
        intervalMs: hasOwn(rawSchedule, 'intervalMs') ? rawSchedule.intervalMs : null,
        windowStart: asString(rawSchedule.windowStart, null),
        windowEnd: asString(rawSchedule.windowEnd, null)
      }
    },
    effectivePatch: {
      settings: {
        writebackPolicy: {
          mode,
          enabled,
          pausedUntil,
          schedule: schedulePatch
        }
      },
      lifecycle: {
        mode,
        enabled,
        pausedUntil,
        schedule: schedulePatch
      }
    },
    commandResult: {
      applied: lifecycleCommand && settingsValidationReasons.length === 0,
      status: settingsValidationReasons.length
        ? 'validation-failed'
        : lifecycleCommand
          ? 'settings-command-applied'
          : 'settings-observed',
      readyAfterCommand: enabled && !pauseActive && scheduleReady && settingsValidationReasons.length === 0,
      blockedReasons
    },
    validation: {
      valid: settingsValidationReasons.length === 0,
      errors: settingsValidationReasons,
      warnings: [
        ...(hasOwn(rawSchedule, 'deferByMs') && Number.isInteger(rawSchedule.deferByMs) && rawSchedule.deferByMs > 86400000 ? ['defer-by-ms-clamped-to-86400000'] : []),
        ...(hasOwn(rawSchedule, 'intervalMs') && Number.isInteger(rawSchedule.intervalMs) && rawSchedule.intervalMs > 86400000 ? ['interval-ms-clamped-to-86400000'] : [])
      ]
    },
    controls: {
      enable: {
        commandType: 'enable',
        enabled: !enabled || command.type === 'enable',
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:enable`
      },
      disable: {
        commandType: 'disable',
        enabled: enabled || command.type === 'disable',
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:disable`
      },
      schedule: {
        commandType: 'schedule',
        enabled: true,
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:schedule`,
        patch: schedulePatch
      }
    },
    nextAction
  };
}

function normalizeLifecycleSettings(input = {}, syncMetadata, command, now, clientRuntime) {
  const settings = asObject(input.settings);
  const writebackSettings = asObject(settings.writebackPolicy);
  const lifecycle = asObject(input.lifecycle);
  const schedule = asObject({
    ...asObject(writebackSettings.schedule),
    ...asObject(lifecycle.schedule),
    ...asObject(input.schedule)
  });
  const nowMs = asTimeMs(now) ?? Date.now();
  const requestedMode = asString(lifecycle.mode, asString(writebackSettings.mode, 'enabled'));
  const commandMode = command.type === 'enable'
    ? 'enabled'
    : command.type === 'disable'
      ? 'disabled'
      : null;
  const mode = commandMode || (VALID_LIFECYCLE_MODES.has(requestedMode) ? requestedMode : 'enabled');
  const enabled = command.type === 'enable'
    ? true
    : command.type === 'disable'
      ? false
      : mode !== 'disabled' && lifecycle.enabled !== false && writebackSettings.enabled !== false;
  const pausedUntil = asString(lifecycle.pausedUntil, asString(writebackSettings.pausedUntil, null));
  const pausedUntilMs = asTimeMs(pausedUntil);
  const pauseActive = mode === 'paused' || (pausedUntilMs !== null && pausedUntilMs > nowMs);
  const requestedScheduleMode = asString(schedule.mode, syncMetadata.urgency === 'urgent' ? 'immediate' : 'manual');
  const scheduleMode = VALID_SCHEDULE_MODES.has(requestedScheduleMode) ? requestedScheduleMode : 'manual';
  const windowStart = asString(schedule.windowStart, null);
  const windowEnd = asString(schedule.windowEnd, null);
  const windowStartMs = asTimeMs(windowStart);
  const windowEndMs = asTimeMs(windowEnd);
  const deferByMs = Number.isInteger(schedule.deferByMs) && schedule.deferByMs >= 0
    ? Math.min(schedule.deferByMs, 86400000)
    : 0;
  const intervalMs = Number.isInteger(schedule.intervalMs) && schedule.intervalMs >= 60000
    ? Math.min(schedule.intervalMs, 86400000)
    : syncMetadata.urgency === 'urgent'
      ? 60000
      : 900000;
  const invalidScheduleReasons = [
    ...(!VALID_LIFECYCLE_MODES.has(requestedMode) ? [`invalid-lifecycle-mode:${requestedMode}`] : []),
    ...(!VALID_SCHEDULE_MODES.has(requestedScheduleMode) ? [`invalid-schedule-mode:${requestedScheduleMode}`] : []),
    ...(pausedUntil && pausedUntilMs === null ? ['invalid-paused-until'] : []),
    ...(hasOwn(schedule, 'deferByMs') && (!Number.isInteger(schedule.deferByMs) || schedule.deferByMs < 0) ? ['invalid-defer-by-ms'] : []),
    ...(hasOwn(schedule, 'intervalMs') && (!Number.isInteger(schedule.intervalMs) || schedule.intervalMs < 60000) ? ['invalid-interval-ms'] : []),
    ...(scheduleMode === 'windowed' && windowStartMs === null ? ['missing-or-invalid-window-start'] : []),
    ...(scheduleMode === 'windowed' && windowEndMs === null ? ['missing-or-invalid-window-end'] : []),
    ...(scheduleMode === 'windowed' && windowStartMs !== null && windowEndMs !== null && windowStartMs >= windowEndMs ? ['window-start-must-precede-window-end'] : [])
  ];
  const withinWindow = scheduleMode !== 'windowed'
    || (windowStartMs !== null && windowEndMs !== null && nowMs >= windowStartMs && nowMs <= windowEndMs);
  const scheduledFor = scheduleMode === 'deferred'
    ? new Date(nowMs + deferByMs).toISOString()
    : scheduleMode === 'windowed' && windowStartMs !== null && nowMs < windowStartMs
      ? new Date(windowStartMs).toISOString()
      : now;
  const scheduleReady = scheduleMode === 'manual'
    ? ['preview', 'accept', 'commit', 'schedule'].includes(command.type)
    : scheduleMode === 'windowed'
      ? withinWindow
      : scheduleMode === 'deferred'
        ? deferByMs === 0
        : true;
  const blockedReasons = [
    ...(!enabled ? ['writeback-policy-disabled'] : []),
    ...(pauseActive ? ['writeback-policy-paused'] : []),
    ...invalidScheduleReasons,
    ...(enabled && !pauseActive && invalidScheduleReasons.length === 0 && !scheduleReady ? [`writeback-schedule-not-ready:${scheduleMode}`] : [])
  ];
  const scheduleState = {
    mode: scheduleMode,
    scheduledFor,
    intervalMs,
    deferByMs,
    windowStart,
    windowEnd,
    withinWindow,
    ready: scheduleReady,
    validationErrors: invalidScheduleReasons
  };
  const settingsCommand = buildLifecycleCommandContract({
    input,
    command,
    clientRuntime,
    syncMetadata,
    now,
    requestedMode,
    mode,
    enabled,
    pausedUntil,
    pauseActive,
    schedule: scheduleState,
    scheduleReady,
    invalidScheduleReasons,
    blockedReasons
  });

  return {
    schemaVersion: 1,
    enabled,
    mode,
    commandAppliedMode: commandMode,
    configurable: command.type === 'enable' || command.type === 'disable' || command.type === 'schedule',
    pausedUntil,
    pauseActive,
    schedule: scheduleState,
    ready: enabled && !pauseActive && scheduleReady && invalidScheduleReasons.length === 0,
    blockedReasons,
    settingsCommand,
    controlState: settingsCommand.controls,
    nextActionState: settingsCommand.nextAction,
    nextLifecycleAction: !enabled
      ? 'memory.writeback.lifecycle.enable'
      : pauseActive
        ? 'memory.writeback.lifecycle.resume'
        : invalidScheduleReasons.length
          ? 'memory.writeback.lifecycle.settings.fix'
          : !scheduleReady
            ? 'memory.writeback.lifecycle.schedule.wait'
            : 'memory.writeback.lifecycle.ready'
  };
}

function normalizeAuthorizationProof(input = {}, clientRuntime, command, persistedState) {
  const request = asObject(input.request);
  const client = asObject(input.client);
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const security = asObject(input.security);
  const tenantId = asString(tenant.id, asString(request.tenantId, asString(client.tenantId, 'hosted-kernel-tenant')));
  const workspaceId = asString(workspace.id, asString(request.workspaceId, asString(client.workspaceId, 'hosted-kernel-workspace')));
  const actorRole = VALID_ACTOR_ROLES.has(security.role)
    ? security.role
    : VALID_ACTOR_ROLES.has(client.role)
      ? client.role
      : VALID_ACTOR_ROLES.has(request.role)
        ? request.role
        : 'viewer';
  const explicitPermissions = asStringList([
    ...clientRuntime.scopes,
    ...asStringList(security.permissions),
    ...asStringList(tenant.permissions),
    ...asStringList(workspace.permissions)
  ]);
  const rolePermissions = WRITEBACK_ROLE_PERMISSIONS[actorRole] || [];
  const grantedPermissions = asStringList([...explicitPermissions, ...rolePermissions]);
  const requiredPermissions = WRITEBACK_COMMAND_PERMISSIONS[command.type] || WRITEBACK_COMMAND_PERMISSIONS.inspect;
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const allowedTenants = asStringList(security.allowedTenants);
  const allowedWorkspaces = asStringList(security.allowedWorkspaces);
  const persistedTenantId = asString(persistedState.tenantId, null);
  const persistedWorkspaceId = asString(persistedState.workspaceId, null);
  const requestedScopeMode = asString(security.workspaceScopeMode, asString(workspace.scopeMode, 'strict'));
  const workspaceScopeMode = VALID_WORKSPACE_SCOPE_MODES.has(requestedScopeMode) ? requestedScopeMode : 'strict';
  const delegatedTenantIds = asStringList(security.delegatedTenantIds);
  const delegatedWorkspaceIds = asStringList(security.delegatedWorkspaceIds);
  const workspaceTenantId = asString(workspace.tenantId, tenantId);
  const workspaceBelongsToTenant = workspaceTenantId === tenantId;
  const tenantAllowed = !allowedTenants.length || allowedTenants.includes(tenantId);
  const workspaceAllowed = !allowedWorkspaces.length || allowedWorkspaces.includes(workspaceId);
  const samePersistedTenant = !persistedTenantId || persistedTenantId === tenantId;
  const samePersistedWorkspace = !persistedWorkspaceId || persistedWorkspaceId === workspaceId;
  const crossTenantAllowed = grantedPermissions.includes('memory.writeback.crossTenant');
  const crossWorkspaceAllowed = grantedPermissions.includes('memory.writeback.crossWorkspace');
  const delegatedTenantAllowed = workspaceScopeMode === 'delegated' && delegatedTenantIds.includes(tenantId);
  const delegatedWorkspaceAllowed = workspaceScopeMode === 'delegated' && delegatedWorkspaceIds.includes(workspaceId);
  const tenantScopeAllowed = workspaceScopeMode === 'tenant' && workspaceBelongsToTenant;
  const strictWorkspaceScope = workspaceScopeMode === 'strict' || workspaceScopeMode === 'workspace';
  const workspaceScopeSatisfied = strictWorkspaceScope
    ? workspaceAllowed && workspaceBelongsToTenant
    : workspaceScopeMode === 'tenant'
      ? tenantScopeAllowed && workspaceAllowed
      : delegatedTenantAllowed && delegatedWorkspaceAllowed;
  const deniedReasons = [
    ...missingPermissions.map((permission) => `missing-permission:${permission}`),
    ...(!tenantAllowed ? [`tenant-not-allowed:${tenantId}`] : []),
    ...(!workspaceAllowed ? [`workspace-not-allowed:${workspaceId}`] : []),
    ...(!workspaceBelongsToTenant && !crossTenantAllowed ? [`workspace-tenant-mismatch:${workspaceTenantId}`] : []),
    ...(!workspaceScopeSatisfied ? [`workspace-scope-not-satisfied:${workspaceScopeMode}`] : []),
    ...(!samePersistedTenant && !crossTenantAllowed ? ['persisted-state-tenant-mismatch'] : []),
    ...(!samePersistedWorkspace && !crossWorkspaceAllowed ? ['persisted-state-workspace-mismatch'] : [])
  ];
  const boundaryAllowed = deniedReasons.length === 0;

  return {
    schemaVersion: 1,
    proofType: 'memory.writeback.authorization-proof.v1',
    proofId: `${clientRuntime.correlationKey}:${command.idempotencyKey}:authorization`,
    tenantId,
    workspaceId,
    workspaceTenantId,
    actor: clientRuntime.actor,
    role: actorRole,
    commandType: command.type,
    workspaceScopeMode,
    requiredPermissions,
    explicitPermissions,
    rolePermissions,
    grantedPermissions,
    missingPermissions,
    allowedTenants,
    allowedWorkspaces,
    delegatedTenantIds,
    delegatedWorkspaceIds,
    persistedTenantId,
    persistedWorkspaceId,
    tenantAllowed,
    workspaceAllowed,
    workspaceBelongsToTenant,
    workspaceScopeSatisfied,
    samePersistedTenant,
    samePersistedWorkspace,
    crossTenantAllowed,
    crossWorkspaceAllowed,
    delegatedTenantAllowed,
    delegatedWorkspaceAllowed,
    boundaryAllowed,
    deniedReasons,
    auditHandoff: {
      subject: `${tenantId}:${workspaceId}:${clientRuntime.actor}`,
      stateScopeKey: `${tenantId}:${workspaceId}:${clientRuntime.stateKey}`,
      commandType: command.type,
      idempotencyKey: command.idempotencyKey,
      decision: boundaryAllowed ? 'allow' : 'deny',
      deniedReasons,
      requiredPermissionCount: requiredPermissions.length,
      grantedPermissionCount: grantedPermissions.length
    }
  };
}

function normalizeTenantBoundary(input = {}, clientRuntime, command, persistedState) {
  const authorizationProof = normalizeAuthorizationProof(input, clientRuntime, command, persistedState);
  const boundaryViolations = authorizationProof.deniedReasons;

  return {
    schemaVersion: 1,
    tenantId: authorizationProof.tenantId,
    workspaceId: authorizationProof.workspaceId,
    workspaceTenantId: authorizationProof.workspaceTenantId,
    actor: authorizationProof.actor,
    role: authorizationProof.role,
    commandType: command.type,
    workspaceScopeMode: authorizationProof.workspaceScopeMode,
    requiredPermissions: authorizationProof.requiredPermissions,
    explicitPermissions: authorizationProof.explicitPermissions,
    rolePermissions: authorizationProof.rolePermissions,
    grantedPermissions: authorizationProof.grantedPermissions,
    missingPermissions: authorizationProof.missingPermissions,
    allowed: authorizationProof.boundaryAllowed,
    tenantAllowed: authorizationProof.tenantAllowed,
    workspaceAllowed: authorizationProof.workspaceAllowed,
    workspaceBelongsToTenant: authorizationProof.workspaceBelongsToTenant,
    workspaceScopeSatisfied: authorizationProof.workspaceScopeSatisfied,
    persistedTenantId: authorizationProof.persistedTenantId,
    persistedWorkspaceId: authorizationProof.persistedWorkspaceId,
    crossTenantAllowed: authorizationProof.crossTenantAllowed,
    crossWorkspaceAllowed: authorizationProof.crossWorkspaceAllowed,
    delegatedTenantAllowed: authorizationProof.delegatedTenantAllowed,
    delegatedWorkspaceAllowed: authorizationProof.delegatedWorkspaceAllowed,
    boundaryViolations,
    authorizationProof,
    auditSubject: authorizationProof.auditHandoff.subject,
    stateScopeKey: authorizationProof.auditHandoff.stateScopeKey
  };
}

function buildWorkspaceScopedPreview(preview, tenantBoundary) {
  const scopedRecords = preview.records.map((record) => {
    const recordTenantId = asString(record.tenantId, tenantBoundary.tenantId);
    const recordWorkspaceId = asString(record.workspaceId, tenantBoundary.workspaceId);
    const tenantMatches = recordTenantId === tenantBoundary.tenantId;
    const workspaceMatches = recordWorkspaceId === tenantBoundary.workspaceId;
    const tenantWritable = tenantMatches || tenantBoundary.crossTenantAllowed;
    const workspaceWritable = workspaceMatches || tenantBoundary.crossWorkspaceAllowed;
    const recordBoundaryViolations = [
      ...(!tenantWritable ? [`record-tenant-mismatch:${recordTenantId}`] : []),
      ...(!workspaceWritable ? [`record-workspace-mismatch:${recordWorkspaceId}`] : []),
      ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations : [])
    ];
    const writable = recordBoundaryViolations.length === 0;
    const scopeKey = `${recordTenantId}:${recordWorkspaceId}:${record.collection}:${record.recordId}`;

    return {
      ...record,
      tenantId: recordTenantId,
      workspaceId: recordWorkspaceId,
      requestedTenantId: record.tenantId,
      requestedWorkspaceId: record.workspaceId,
      sourceScopeKey: record.sourceScopeKey,
      scopeKey,
      expectedScopeKey: `${tenantBoundary.tenantId}:${tenantBoundary.workspaceId}:${record.collection}:${record.recordId}`,
      scopeMatchesBoundary: tenantMatches && workspaceMatches,
      crossTenantOverride: !tenantMatches && tenantBoundary.crossTenantAllowed,
      crossWorkspaceOverride: !workspaceMatches && tenantBoundary.crossWorkspaceAllowed,
      writable,
      withheldReason: writable
        ? null
        : recordBoundaryViolations[0] || 'tenant-permission-boundary-blocked',
      boundaryViolations: [...new Set(recordBoundaryViolations)]
    };
  });
  const writableRecords = scopedRecords.filter((record) => record.writable);
  const withheldRecords = scopedRecords.filter((record) => !record.writable);
  const recordBoundaryViolations = [...new Set(withheldRecords.flatMap((record) => record.boundaryViolations))];

  return {
    ...preview,
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateScopeKey: tenantBoundary.stateScopeKey,
      boundaryAllowed: tenantBoundary.allowed,
      scopedRecordCount: scopedRecords.length,
      writableRecordCount: writableRecords.length,
      withheldRecordCount: withheldRecords.length,
      recordBoundaryViolations
    },
    records: scopedRecords,
    shownRecordCount: writableRecords.length,
    withheldRecordCount: withheldRecords.length,
    truncated: preview.truncated || withheldRecords.length > 0
  };
}

function normalizePersistedFailureLedger(persisted = {}, now) {
  const health = asObject(persisted.operationalHealth);
  const rawFailures = [
    ...(Array.isArray(persisted.failures) ? persisted.failures : []),
    ...(Array.isArray(health.failures) ? health.failures : [])
  ];
  const failures = rawFailures
    .map((entry, index) => {
      const item = asObject(entry);
      const source = VALID_FAILURE_SOURCES.has(item.source) ? item.source : 'persisted-state';
      const code = asString(item.code, asString(item.reason, `persisted-failure-${index + 1}`));
      const firstObservedAt = asString(item.firstObservedAt, asString(item.observedAt, asString(item.timestamp, now)));
      const lastObservedAt = asString(item.lastObservedAt, asString(item.observedAt, firstObservedAt));
      const attempts = Number.isInteger(item.attempts) && item.attempts >= 0
        ? item.attempts
        : Number.isInteger(item.attempt) && item.attempt >= 0
          ? item.attempt
          : 0;

      return {
        code,
        source,
        message: asString(item.message, asString(item.detail, code)),
        retryable: item.retryable === false ? false : true,
        attempts,
        firstObservedAt,
        lastObservedAt,
        lastAction: asString(item.lastAction, null),
        acknowledged: Boolean(item.acknowledged),
        terminal: Boolean(item.terminal) || item.retryable === false
      };
    })
    .filter((failure) => failure.code);
  const openFailures = failures.filter((failure) => !failure.acknowledged);
  const terminalFailures = openFailures.filter((failure) => failure.terminal || !failure.retryable);
  const retryableFailures = openFailures.filter((failure) => failure.retryable && !failure.terminal);
  const maxAttempt = Math.max(0, ...failures.map((failure) => failure.attempts));
  const quarantineUntil = asString(health.quarantineUntil, asString(persisted.quarantineUntil, null));
  const quarantineUntilMs = asTimeMs(quarantineUntil);
  const nowMs = asTimeMs(now) ?? Date.now();
  const quarantined = quarantineUntilMs !== null && quarantineUntilMs > nowMs;

  return {
    schemaVersion: 1,
    state: terminalFailures.length
      ? 'terminal-failure'
      : quarantined
        ? 'quarantined'
        : retryableFailures.length
          ? 'open-retryable-failure'
          : 'clear',
    failures,
    openFailureCount: openFailures.length,
    retryableFailureCount: retryableFailures.length,
    terminalFailureCount: terminalFailures.length,
    maxAttempt,
    lastFailureAt: failures.reduce((latest, failure) => {
      const candidateMs = asTimeMs(failure.lastObservedAt);
      const latestMs = asTimeMs(latest);
      return candidateMs !== null && (latestMs === null || candidateMs > latestMs) ? failure.lastObservedAt : latest;
    }, null),
    quarantined,
    quarantineUntil,
    terminalCodes: terminalFailures.map((failure) => failure.code),
    retryableCodes: retryableFailures.map((failure) => failure.code)
  };
}

function normalizePersistedRecoveryOperations(persisted = {}, now) {
  const rawOperations = [
    ...(Array.isArray(persisted.recoveryOperations) ? persisted.recoveryOperations : []),
    ...(Array.isArray(persisted.recoveryQueue) ? persisted.recoveryQueue : []),
    ...(Array.isArray(persisted.pendingOperations) ? persisted.pendingOperations : [])
  ];
  const byOperationId = new Map();

  for (const [index, entry] of rawOperations.entries()) {
    const item = asObject(entry);
    const action = asString(item.action, asString(item.type, null));
    if (!action || !action.startsWith('memory.writeback.')) continue;
    const operationId = asString(item.operationId, asString(item.id, `${action}:${index + 1}`));
    const requestedStatus = asString(item.status, 'pending');
    const status = VALID_RECOVERY_OPERATION_STATUSES.has(requestedStatus) ? requestedStatus : 'pending';
    const attempt = Number.isInteger(item.attempt) && item.attempt >= 0
      ? item.attempt
      : Number.isInteger(item.attempts) && item.attempts >= 0
        ? item.attempts
        : 0;
    const shaped = {
      operationId,
      action,
      status,
      idempotencyKey: asString(item.idempotencyKey, null),
      cursor: asString(item.cursor, null),
      reason: asString(item.reason, asString(item.detail, action)),
      attempt,
      createdAt: asString(item.createdAt, asString(item.recordedAt, now)),
      updatedAt: asString(item.updatedAt, asString(item.observedAt, now)),
      completedAt: status === 'completed' || status === 'replayed'
        ? asString(item.completedAt, asString(item.updatedAt, now))
        : null,
      lastError: asString(item.lastError, null)
    };
    const existing = byOperationId.get(operationId);
    const existingUpdatedAtMs = existing ? asTimeMs(existing.updatedAt) : null;
    const shapedUpdatedAtMs = asTimeMs(shaped.updatedAt);

    if (!existing || (shapedUpdatedAtMs !== null && (existingUpdatedAtMs === null || shapedUpdatedAtMs >= existingUpdatedAtMs))) {
      byOperationId.set(operationId, shaped);
    }
  }

  const operations = [...byOperationId.values()];
  const openOperations = operations.filter((operation) => !['completed', 'replayed', 'cancelled'].includes(operation.status));

  return {
    schemaVersion: 1,
    operations,
    openOperations,
    openOperationCount: openOperations.length,
    completedOperationCount: operations.filter((operation) => operation.status === 'completed' || operation.status === 'replayed').length,
    lastOperationAt: operations.reduce((latest, operation) => {
      const candidateMs = asTimeMs(operation.updatedAt);
      const latestMs = asTimeMs(latest);
      return candidateMs !== null && (latestMs === null || candidateMs > latestMs) ? operation.updatedAt : latest;
    }, null)
  };
}

function normalizePersistedWritebackState(input = {}, clientRuntime, syncMetadata, command, now) {
  const persisted = asObject(input.persistedState);
  const failureLedger = normalizePersistedFailureLedger(persisted, now);
  const recoveryOperations = normalizePersistedRecoveryOperations(persisted, now);
  const priorCommands = Array.isArray(persisted.commands) ? persisted.commands : [];
  const commands = priorCommands
    .map((entry) => {
      const item = asObject(entry);
      const idempotencyKey = asString(item.idempotencyKey, null);
      if (!idempotencyKey) return null;

      return {
        idempotencyKey,
        type: VALID_WRITEBACK_COMMANDS.has(item.type) ? item.type : 'inspect',
        status: asString(item.status, 'completed'),
        cursor: asString(item.cursor, null),
        completedAt: asString(item.completedAt, asString(item.recordedAt, null))
      };
    })
    .filter(Boolean);
  const completedKeys = new Set(commands
    .filter((entry) => entry.status === 'completed' || entry.status === 'accepted')
    .map((entry) => entry.idempotencyKey));
  const stateKey = asString(persisted.stateKey, clientRuntime.stateKey);
  const phase = VALID_PERSISTED_PHASES.has(persisted.phase) ? persisted.phase : 'new';
  const recovered = Boolean(persisted.stateKey || persisted.lastCursor || persisted.phase || commands.length);
  const generation = Number.isInteger(persisted.generation) && persisted.generation >= 0 ? persisted.generation : 0;
  const lastCursor = asString(persisted.lastCursor, syncMetadata.lastCursor);
  const pendingCursor = asString(persisted.pendingCursor, syncMetadata.nextCursor);
  const commandAlreadyApplied = completedKeys.has(command.idempotencyKey);
  const sameState = stateKey === clientRuntime.stateKey;
  const cursorMatches = !lastCursor || lastCursor === syncMetadata.lastCursor || lastCursor === syncMetadata.nextCursor;

  return {
    schemaVersion: 1,
    stateKey,
    recovered,
    recoverable: sameState && cursorMatches,
    recoveryStatus: !recovered
      ? 'cold-start'
      : sameState && cursorMatches
        ? 'recovered'
        : 'state-mismatch',
    phase,
    generation,
    tenantId: asString(persisted.tenantId, null),
    workspaceId: asString(persisted.workspaceId, null),
    lastCursor,
    pendingCursor,
    commandAlreadyApplied,
    completedCommandCount: completedKeys.size,
    commands,
    journal: Array.isArray(persisted.journal)
      ? persisted.journal
      : Array.isArray(asObject(persisted.persistenceJournal).entries)
        ? asObject(persisted.persistenceJournal).entries
        : [],
    failureLedger,
    recoveryOperations,
    writeToken: `${stateKey}:${generation + (commandAlreadyApplied ? 0 : 1)}:${pendingCursor}`,
    persistedAt: asString(persisted.persistedAt, null),
    observedAt: now
  };
}

function buildRestartSafeStatus({ persistedState, command, readiness, acceptance }) {
  const replaySafe = persistedState.recoverable && persistedState.commandAlreadyApplied;
  const shouldPersist = persistedState.recoverable && !persistedState.commandAlreadyApplied;
  const blocked = !persistedState.recoverable || readiness.failed.includes('provider-capabilities');
  const phaseAfterCommand = (() => {
    if (blocked) return 'blocked';
    if (replaySafe) return persistedState.phase;
    if (command.type === 'accept' && acceptance.canAccept) return 'accepted';
    if (command.type === 'reject') return 'rejected';
    if (command.type === 'commit' && readiness.ready && acceptance.accepted) return 'committing';
    if (command.type === 'disable') return 'disabled';
    if (command.type === 'schedule') return 'scheduled';
    if (command.type === 'enable' && persistedState.phase === 'disabled') return 'new';
    if (command.type === 'preview') return 'previewed';
    return persistedState.phase;
  })();

  return {
    stateKey: persistedState.stateKey,
    status: blocked
      ? 'restart-blocked'
      : replaySafe
        ? 'idempotent-replay'
        : shouldPersist
          ? 'persist-required'
          : 'read-only',
    phaseBeforeCommand: persistedState.phase,
    phaseAfterCommand,
    idempotencyKey: command.idempotencyKey,
    commandAlreadyApplied: persistedState.commandAlreadyApplied,
    replaySafe,
    shouldPersist,
    writeToken: persistedState.writeToken,
    recoveryStatus: persistedState.recoveryStatus,
    blockedReasons: [
      ...(!persistedState.recoverable ? ['persisted-state-does-not-match-request'] : []),
      ...(readiness.failed.includes('provider-capabilities') ? ['provider-capabilities-unavailable-after-restart'] : [])
    ]
  };
}

function buildRecoveryOperationQueue({
  now,
  clientRuntime,
  command,
  syncMetadata,
  persistedState,
  restartSafeStatus,
  recoveryActions,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState
}) {
  const priorByAction = new Map(
    persistedState.recoveryOperations.operations.map((operation) => [
      `${operation.action}:${operation.idempotencyKey || command.idempotencyKey}:${operation.cursor || syncMetadata.nextCursor}`,
      operation
    ])
  );
  const blockingReasonByAction = {
    'memory.writeback.recovery.rebind-state-key': restartSafeStatus.blockedReasons.join(', ') || 'persisted-state-does-not-match-request',
    'memory.writeback.recovery.refresh-client-state': 'client-state-key-mismatch',
    'memory.writeback.recovery.require-authorized-operator': tenantBoundary.boundaryViolations.join(', ') || 'tenant-boundary-blocked',
    'memory.writeback.recovery.resolve-lifecycle': lifecycleSettings.blockedReasons.join(', ') || 'lifecycle-not-ready',
    'memory.writeback.recovery.redeliver-handoff': handoffDeliveryState.blockedReasons.join(', ') || 'handoff-delivery-not-ready',
    'memory.writeback.recovery.wait-for-health-quarantine': persistedState.failureLedger.quarantineUntil || 'health-quarantine-active',
    'memory.writeback.recovery.resume-failure-retry': persistedState.failureLedger.retryableCodes.join(', ') || 'retryable-persisted-failure',
    'memory.writeback.recovery.escalate-terminal-failure': persistedState.failureLedger.terminalCodes.join(', ') || 'terminal-persisted-failure',
    'memory.writeback.persistence.write-next-state': restartSafeStatus.writeToken,
    'memory.writeback.recovery.return-cached-result': restartSafeStatus.writeToken
  };
  const desiredOperations = recoveryActions.map((action, index) => {
    const cursor = syncMetadata.nextCursor;
    const idempotencyKey = command.idempotencyKey;
    const operationKey = `${action}:${idempotencyKey}:${cursor}`;
    const prior = priorByAction.get(operationKey);
    const terminalPrior = prior && ['completed', 'replayed', 'cancelled'].includes(prior.status);
    const actionBlocked = action !== 'memory.writeback.recovery.return-cached-result'
      && (action !== 'memory.writeback.persistence.write-next-state' || !restartSafeStatus.shouldPersist)
      && (
        !persistedState.recoverable
        || !tenantBoundary.allowed
        || !lifecycleSettings.ready
        || (action === 'memory.writeback.recovery.redeliver-handoff' && !handoffDeliveryState.ready)
      );
    const status = terminalPrior
      ? prior.status
      : restartSafeStatus.replaySafe && action === 'memory.writeback.recovery.return-cached-result'
        ? 'replayed'
        : actionBlocked
          ? 'blocked'
          : 'pending';

    return {
      operationId: prior
        ? prior.operationId
        : `${clientRuntime.stateKey}:${syncMetadata.batchId}:${index + 1}:${action.split('.').slice(-1)[0]}`,
      action,
      status,
      idempotencyKey,
      cursor,
      reason: blockingReasonByAction[action] || action,
      attempt: prior && status !== 'pending' ? prior.attempt : prior ? prior.attempt + 1 : 0,
      createdAt: prior ? prior.createdAt : now,
      updatedAt: now,
      completedAt: status === 'completed' || status === 'replayed' ? now : null,
      lastError: status === 'blocked' ? blockingReasonByAction[action] || 'recovery-operation-blocked' : null
    };
  });
  const desiredIds = new Set(desiredOperations.map((operation) => operation.operationId));
  const retainedPriorOperations = persistedState.recoveryOperations.operations
    .filter((operation) => !desiredIds.has(operation.operationId))
    .slice(-16);
  const operations = [...retainedPriorOperations, ...desiredOperations];
  const openOperations = operations.filter((operation) => !['completed', 'replayed', 'cancelled'].includes(operation.status));

  return {
    schemaVersion: 1,
    queueType: 'memory.writeback.recovery-operation-queue.v1',
    status: openOperations.some((operation) => operation.status === 'blocked')
      ? 'blocked'
      : openOperations.length
        ? 'open'
        : 'drained',
    operations,
    openOperations,
    openOperationCount: openOperations.length,
    blockedOperationCount: operations.filter((operation) => operation.status === 'blocked').length,
    replayedOperationCount: operations.filter((operation) => operation.status === 'replayed').length,
    nextOperation: openOperations[0] || null
  };
}

function buildPersistenceJournal({
  now,
  clientRuntime,
  command,
  syncMetadata,
  persistedState,
  restartSafeStatus,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState
}) {
  const priorJournal = Array.isArray(asObject(persistedState).journal)
    ? persistedState.journal
    : [];
  const priorEntries = priorJournal
    .map((entry, index) => {
      const item = asObject(entry);
      const idempotencyKey = asString(item.idempotencyKey, null);
      if (!idempotencyKey) return null;
      const status = VALID_PERSISTENCE_RECORD_STATUSES.has(item.status) ? item.status : 'read-only';

      return {
        journalId: asString(item.journalId, `${persistedState.stateKey}:${index + 1}:journal`),
        schemaVersion: Number.isInteger(item.schemaVersion) && item.schemaVersion > 0 ? item.schemaVersion : 1,
        status,
        commandType: VALID_WRITEBACK_COMMANDS.has(item.commandType) ? item.commandType : 'inspect',
        idempotencyKey,
        cursor: asString(item.cursor, null),
        writeToken: asString(item.writeToken, null),
        recordedAt: asString(item.recordedAt, asString(item.persistedAt, null)),
        generation: Number.isInteger(item.generation) && item.generation >= 0 ? item.generation : 0
      };
    })
    .filter(Boolean);
  const replayEntry = priorEntries.find((entry) => entry.idempotencyKey === command.idempotencyKey);
  const appendStatus = restartSafeStatus.replaySafe
    ? 'replay-hit'
    : restartSafeStatus.blockedReasons.length
      ? 'blocked'
      : restartSafeStatus.shouldPersist
        ? 'append-required'
        : 'read-only';
  const journalId = replayEntry
    ? replayEntry.journalId
    : `${tenantBoundary.stateScopeKey}:${syncMetadata.batchId}:${command.idempotencyKey}:journal`;
  const appendRecord = {
    journalId,
    schemaVersion: 2,
    recordType: 'memory.writeback.persistence-journal-entry.v1',
    status: appendStatus,
    commandType: command.type,
    idempotencyKey: command.idempotencyKey,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    stateKey: persistedState.stateKey,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    generation: persistedState.generation + (restartSafeStatus.shouldPersist ? 1 : 0),
    writeToken: restartSafeStatus.writeToken,
    phaseBeforeCommand: restartSafeStatus.phaseBeforeCommand,
    phaseAfterCommand: restartSafeStatus.phaseAfterCommand,
    recordedAt: now,
    handoffEnvelopeId: handoffDeliveryState.envelopeId,
    lifecycleMode: lifecycleSettings.mode,
    blockedReasons: restartSafeStatus.blockedReasons
  };
  const retainedEntries = priorEntries
    .filter((entry) => entry.idempotencyKey !== command.idempotencyKey)
    .slice(-31);
  const entries = appendStatus === 'replay-hit'
    ? priorEntries
    : [...retainedEntries, appendRecord];
  const openEntries = entries.filter((entry) => entry.status === 'append-required' || entry.status === 'blocked');

  return {
    schemaVersion: 1,
    journalType: 'memory.writeback.persistence-journal.v1',
    status: appendStatus,
    journalId,
    appendRequired: appendStatus === 'append-required',
    replayHit: appendStatus === 'replay-hit',
    blocked: appendStatus === 'blocked',
    idempotencyKey: command.idempotencyKey,
    replaySourceJournalId: replayEntry ? replayEntry.journalId : null,
    durableWriteKey: `${persistedState.stateKey}:${syncMetadata.nextCursor}:${command.idempotencyKey}`,
    stateShape: {
      schemaVersion: 2,
      stateKey: persistedState.stateKey,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      generation: appendRecord.generation,
      cursor: syncMetadata.nextCursor,
      phase: restartSafeStatus.phaseAfterCommand,
      commandType: command.type
    },
    restartSemantics: {
      statusAfterRestart: restartSafeStatus.replaySafe ? 'return-cached-result' : restartSafeStatus.status,
      duplicateCommandBehavior: appendStatus === 'replay-hit' ? 'no-op-return-journal-entry' : 'append-once',
      recoveryRequired: restartSafeStatus.blockedReasons.length > 0 || openEntries.some((entry) => entry.status === 'blocked'),
      resumableFromCursor: persistedState.recoverable ? syncMetadata.nextCursor : null
    },
    appendRecord,
    entries,
    openEntryCount: openEntries.length,
    blockedEntryCount: entries.filter((entry) => entry.status === 'blocked').length,
    compaction: {
      retainedEntryCount: entries.length,
      maxRetainedEntries: 32,
      droppedEntryCount: Math.max(0, priorEntries.length - retainedEntries.length)
    }
  };
}

function buildPersistedStateRecoveryContract({
  now,
  clientRuntime,
  command,
  syncMetadata,
  persistedState,
  restartSafeStatus,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState,
  acceptanceResumeSnapshot
}) {
  const completedStatuses = new Set(['completed', 'accepted']);
  const nextCommandStatus = restartSafeStatus.replaySafe
    ? 'replayed'
    : restartSafeStatus.shouldPersist
      ? 'accepted'
      : restartSafeStatus.blockedReasons.length
        ? 'blocked'
        : 'observed';
  const commandReceipt = {
    idempotencyKey: command.idempotencyKey,
    type: command.type,
    status: nextCommandStatus,
    cursor: syncMetadata.nextCursor,
    recordedAt: now,
    completedAt: completedStatuses.has(nextCommandStatus) ? now : null,
    actor: command.actor,
    writeToken: restartSafeStatus.writeToken
  };
  const retainedCommands = persistedState.commands
    .filter((entry) => entry.idempotencyKey !== command.idempotencyKey)
    .slice(-23);
  const nextCommands = restartSafeStatus.replaySafe
    ? persistedState.commands
    : [...retainedCommands, commandReceipt];
  const nextGeneration = persistedState.generation + (restartSafeStatus.shouldPersist ? 1 : 0);
  const nextPhase = restartSafeStatus.replaySafe
    ? persistedState.phase
    : restartSafeStatus.phaseAfterCommand;
  const recoveryActions = [
    ...(!persistedState.recoverable ? ['memory.writeback.recovery.rebind-state-key'] : []),
    ...(restartSafeStatus.replaySafe ? ['memory.writeback.recovery.return-cached-result'] : []),
    ...(restartSafeStatus.shouldPersist ? ['memory.writeback.persistence.write-next-state'] : []),
    ...(clientRuntime.stateKey !== persistedState.stateKey ? ['memory.writeback.recovery.refresh-client-state'] : []),
    ...(!tenantBoundary.allowed ? ['memory.writeback.recovery.require-authorized-operator'] : []),
    ...(!lifecycleSettings.ready ? ['memory.writeback.recovery.resolve-lifecycle'] : []),
    ...(!handoffDeliveryState.ready ? ['memory.writeback.recovery.redeliver-handoff'] : []),
    ...(persistedState.failureLedger.quarantined ? ['memory.writeback.recovery.wait-for-health-quarantine'] : []),
    ...(persistedState.failureLedger.retryableFailureCount > 0 ? ['memory.writeback.recovery.resume-failure-retry'] : []),
    ...(persistedState.failureLedger.terminalFailureCount > 0 ? ['memory.writeback.recovery.escalate-terminal-failure'] : [])
  ];
  const uniqueRecoveryActions = [...new Set(recoveryActions)];
  const persistenceJournal = buildPersistenceJournal({
    now,
    clientRuntime,
    command,
    syncMetadata,
    persistedState,
    restartSafeStatus,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState
  });
  const recoveryQueue = buildRecoveryOperationQueue({
    now,
    clientRuntime,
    command,
    syncMetadata,
    persistedState,
    restartSafeStatus,
    recoveryActions: uniqueRecoveryActions,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState
  });
  const nextPersistedState = {
    schemaVersion: 2,
    stateKey: persistedState.stateKey,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    phase: nextPhase,
    generation: nextGeneration,
    lastCursor: syncMetadata.nextCursor,
    pendingCursor: syncMetadata.nextCursor,
    writeToken: `${persistedState.stateKey}:${nextGeneration}:${syncMetadata.nextCursor}`,
    persistedAt: restartSafeStatus.shouldPersist ? now : persistedState.persistedAt,
    commands: nextCommands,
    lifecycle: {
      mode: lifecycleSettings.mode,
      enabled: lifecycleSettings.enabled,
      scheduleMode: lifecycleSettings.schedule.mode,
      scheduledFor: lifecycleSettings.schedule.scheduledFor,
      settingsCommandContractId: lifecycleSettings.settingsCommand.contractId,
      settingsCommandStatus: lifecycleSettings.settingsCommand.commandResult.status,
      nextAction: lifecycleSettings.nextActionState.action,
      nextActionState: lifecycleSettings.nextActionState.state,
      validationErrors: lifecycleSettings.settingsCommand.validation.errors
    },
    handoff: {
      envelopeId: handoffDeliveryState.envelopeId,
      ackTopic: handoffDeliveryState.ackTopic,
      resumeToken: handoffDeliveryState.resumeToken,
      status: handoffDeliveryState.status
    },
    persistenceJournal: {
      journalType: persistenceJournal.journalType,
      status: persistenceJournal.status,
      journalId: persistenceJournal.journalId,
      durableWriteKey: persistenceJournal.durableWriteKey,
      appendRequired: persistenceJournal.appendRequired,
      replayHit: persistenceJournal.replayHit,
      blocked: persistenceJournal.blocked,
      openEntryCount: persistenceJournal.openEntryCount,
      blockedEntryCount: persistenceJournal.blockedEntryCount,
      restartSemantics: persistenceJournal.restartSemantics,
      entries: persistenceJournal.entries
    },
    restartStatus: {
      status: restartSafeStatus.status,
      recoveryStatus: persistedState.recoveryStatus,
      replaySafe: restartSafeStatus.replaySafe,
      shouldPersist: restartSafeStatus.shouldPersist,
      commandAlreadyApplied: restartSafeStatus.commandAlreadyApplied,
      idempotencyKey: command.idempotencyKey,
      blockedReasons: restartSafeStatus.blockedReasons,
      lastObservedAt: now
    },
    recoveryQueue: {
      queueType: recoveryQueue.queueType,
      status: recoveryQueue.status,
      openOperationCount: recoveryQueue.openOperationCount,
      blockedOperationCount: recoveryQueue.blockedOperationCount,
      replayedOperationCount: recoveryQueue.replayedOperationCount,
      nextOperationId: recoveryQueue.nextOperation ? recoveryQueue.nextOperation.operationId : null,
      operations: recoveryQueue.operations
    },
    previewAcceptance: acceptanceResumeSnapshot.persistedStateShape,
    operationalHealth: {
      failureLedgerState: persistedState.failureLedger.state,
      openFailureCount: persistedState.failureLedger.openFailureCount,
      retryableFailureCount: persistedState.failureLedger.retryableFailureCount,
      terminalFailureCount: persistedState.failureLedger.terminalFailureCount,
      lastFailureAt: persistedState.failureLedger.lastFailureAt,
      quarantineUntil: persistedState.failureLedger.quarantineUntil
    }
  };
  const status = !persistedState.recoverable
    ? 'recovery-blocked'
    : restartSafeStatus.replaySafe
      ? 'idempotent-replay'
      : restartSafeStatus.shouldPersist
        ? 'ready-to-persist'
        : 'read-only';

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.persisted-state-recovery.v1',
    status,
    stateKey: persistedState.stateKey,
    requestStateKey: clientRuntime.stateKey,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    idempotencyKey: command.idempotencyKey,
    commandType: command.type,
    replaySafe: restartSafeStatus.replaySafe,
    shouldPersist: restartSafeStatus.shouldPersist,
    persistenceJournal,
    commandReceipt,
    nextPersistedState,
    recoveryActions: uniqueRecoveryActions,
    recoveryQueue,
    acceptanceResumeSnapshot,
    consistency: {
      recoverable: persistedState.recoverable,
      recovered: persistedState.recovered,
      recoveryStatus: persistedState.recoveryStatus,
      phaseBeforeCommand: restartSafeStatus.phaseBeforeCommand,
      phaseAfterCommand: nextPhase,
      generationBeforeCommand: persistedState.generation,
      generationAfterCommand: nextGeneration,
      commandAlreadyApplied: persistedState.commandAlreadyApplied,
      tenantScoped: persistedState.tenantId ? persistedState.tenantId === tenantBoundary.tenantId : true,
      workspaceScoped: persistedState.workspaceId ? persistedState.workspaceId === tenantBoundary.workspaceId : true,
      persistedFailureLedgerState: persistedState.failureLedger.state,
      persistedOpenFailureCount: persistedState.failureLedger.openFailureCount,
      persistedTerminalFailureCount: persistedState.failureLedger.terminalFailureCount,
      priorRecoveryOpenOperationCount: persistedState.recoveryOperations.openOperationCount,
      nextRecoveryOpenOperationCount: recoveryQueue.openOperationCount,
      recoveryQueueStatus: recoveryQueue.status,
      journalStatus: persistenceJournal.status,
      journalAppendRequired: persistenceJournal.appendRequired,
      journalReplayHit: persistenceJournal.replayHit,
      journalOpenEntryCount: persistenceJournal.openEntryCount,
      acceptanceSnapshotRestartSafe: acceptanceResumeSnapshot.restartSemantics.restartSafe,
      acceptanceSnapshotStateKeyMatches: acceptanceResumeSnapshot.persistedStateShape.stateKey === persistedState.stateKey,
      acceptanceSnapshotCursorMatches: acceptanceResumeSnapshot.persistedStateShape.cursor === syncMetadata.nextCursor
    },
    restartStatus: {
      status: restartSafeStatus.status,
      blockedReasons: restartSafeStatus.blockedReasons,
      writeToken: restartSafeStatus.writeToken
    }
  };
}

function buildHostedKernelCommitPlan({
  now,
  command,
  syncMetadata,
  preview,
  acceptance,
  readiness,
  serviceContract,
  handoffDeliveryState,
  persistedState,
  restartSafeStatus,
  tenantBoundary,
  lifecycleSettings
}) {
  const writeableRecords = preview.records.filter((record) => record.writable);
  const preconditions = [
    {
      id: 'command-is-commit',
      pass: command.type === 'commit',
      detail: command.type === 'commit' ? 'Commit command requested' : `Command ${command.type} does not execute writeback`
    },
    {
      id: 'accepted-preview',
      pass: acceptance.accepted,
      detail: acceptance.accepted ? 'Preview acceptance recorded' : `Acceptance is ${acceptance.decision}`
    },
    {
      id: 'readiness-clean',
      pass: readiness.ready,
      detail: readiness.ready ? 'Readiness checks passed' : readiness.failed.join(', ')
    },
    {
      id: 'records-writeable',
      pass: writeableRecords.length === preview.records.length && writeableRecords.length > 0,
      detail: `${writeableRecords.length}/${preview.records.length} preview record(s) are writeable`
    },
    {
      id: 'restart-safe',
      pass: restartSafeStatus.shouldPersist || restartSafeStatus.replaySafe,
      detail: restartSafeStatus.status
    },
    {
      id: 'handoff-deliverable',
      pass: handoffDeliveryState.ready,
      detail: handoffDeliveryState.ready ? handoffDeliveryState.envelopeId : handoffDeliveryState.blockedReasons.join(', ')
    }
  ];
  const blockedReasons = [
    ...preconditions.filter((check) => !check.pass).map((check) => `${check.id}:${check.detail}`),
    ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations : []),
    ...(!lifecycleSettings.ready ? lifecycleSettings.blockedReasons : [])
  ];
  const commitReady = blockedReasons.length === 0;
  const mutationSet = writeableRecords.map((record, index) => ({
    ordinal: index + 1,
    mutationId: `${persistedState.writeToken}:${record.collection}:${record.recordId}`,
    operation: record.operation,
    collection: record.collection,
    recordId: record.recordId,
    byteSize: record.byteSize,
    scopeKey: record.scopeKey,
    previewToken: record.previewToken,
    expectedTenantId: tenantBoundary.tenantId,
    expectedWorkspaceId: tenantBoundary.workspaceId
  }));

  return {
    schemaVersion: 1,
    planType: 'memory.writeback.hosted-kernel-commit',
    planId: `${tenantBoundary.stateScopeKey}:${syncMetadata.batchId}:${command.idempotencyKey}:commit-plan`,
    generatedAt: now,
    status: commitReady
      ? 'ready-to-commit'
      : command.type === 'commit'
        ? 'blocked'
        : 'not-requested',
    ready: commitReady,
    dryRun: command.type !== 'commit',
    commandType: command.type,
    idempotencyKey: command.idempotencyKey,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    writeToken: persistedState.writeToken,
    providerContractId: serviceContract.contractId,
    handoffEnvelopeId: handoffDeliveryState.envelopeId,
    deliverySemantics: serviceContract.deliverySemantics,
    ackDeadlineMs: serviceContract.ack.deadlineMs,
    mutationCount: mutationSet.length,
    estimatedByteSize: mutationSet.reduce((total, mutation) => total + mutation.byteSize, 0),
    mutationSet,
    preconditions,
    blockedReasons,
    receiptExpectation: {
      required: serviceContract.ack.receiptRequired,
      proofCapabilityAccepted: serviceContract.ack.acknowledgedCapabilities.includes(WRITEBACK_CAPABILITIES.proofReceipt),
      ackTopic: handoffDeliveryState.ackTopic,
      resumeToken: handoffDeliveryState.resumeToken,
      receiptId: `${handoffDeliveryState.envelopeId}:receipt`
    },
    stateTransition: {
      fromPhase: restartSafeStatus.phaseBeforeCommand,
      toPhase: commitReady ? 'committing' : restartSafeStatus.phaseAfterCommand,
      persistRequired: restartSafeStatus.shouldPersist,
      replaySafe: restartSafeStatus.replaySafe
    }
  };
}

function buildProviderReceiptSettlementContract({
  input,
  now,
  provider,
  serviceContract,
  handoffDeliveryState,
  command,
  syncMetadata,
  tenantBoundary,
  commitPlan
}) {
  const receiptInput = asObject({
    ...asObject(asObject(input.serviceContract).receipt),
    ...asObject(asObject(input.externalHandoff).receipt),
    ...asObject(input.receipt)
  });
  const approvalImpact = asObject(input.approvalImpact || input.impact);
  const externalWriteSettlementInput = asObject(
    input.externalWriteSettlement
    || asObject(input.externalWrite).settlement
    || approvalImpact.externalWriteSettlement
  );
  const expectedReceiptId = asString(
    externalWriteSettlementInput.expectedReceiptId,
    commitPlan.receiptExpectation.receiptId
  );
  const requestedState = asString(receiptInput.state, commitPlan.receiptExpectation.required ? 'awaiting-receipt' : 'not-required');
  const receiptState = VALID_PROVIDER_RECEIPT_STATES.has(requestedState) ? requestedState : 'awaiting-receipt';
  const receiptId = asString(receiptInput.receiptId, asString(receiptInput.id, expectedReceiptId));
  const receivedAt = asString(receiptInput.receivedAt, asString(receiptInput.acknowledgedAt, null));
  const receivedAtMs = asTimeMs(receivedAt);
  const nowMs = asTimeMs(now) ?? Date.now();
  const issuedAtMs = asTimeMs(command.issuedAt) ?? nowMs;
  const receiptAgeMs = receivedAtMs === null ? null : Math.max(0, receivedAtMs - issuedAtMs);
  const deadlineExpiresAt = new Date(issuedAtMs + serviceContract.ack.deadlineMs).toISOString();
  const deadlineExpired = commitPlan.receiptExpectation.required
    && receivedAtMs === null
    && nowMs > issuedAtMs + serviceContract.ack.deadlineMs;
  const providerId = asString(receiptInput.providerId, provider.id);
  const envelopeId = asString(receiptInput.envelopeId, handoffDeliveryState.envelopeId);
  const cursor = asString(receiptInput.cursor, syncMetadata.nextCursor);
  const idempotencyKey = asString(receiptInput.idempotencyKey, command.idempotencyKey);
  const tenantId = asString(receiptInput.tenantId, tenantBoundary.tenantId);
  const workspaceId = asString(receiptInput.workspaceId, tenantBoundary.workspaceId);
  const proofHash = asString(receiptInput.proofHash, asString(receiptInput.proofDigest, null));
  const approvalSettlementProof = asString(externalWriteSettlementInput.proof || externalWriteSettlementInput.settlementProof, null);
  const approvalCommandDigest = asString(externalWriteSettlementInput.commandDigest, null);
  const approvalTargetDigest = asString(externalWriteSettlementInput.targetDigest, null);
  const approvalReceiptProof = asString(
    externalWriteSettlementInput.receiptProof || externalWriteSettlementInput.externalReceiptProof,
    null
  );
  const providerAccepted = receiptState === 'accepted' || receiptInput.accepted === true;
  const providerRejected = receiptState === 'rejected' || receiptInput.accepted === false;
  const receiptObserved = ['received', 'accepted', 'rejected'].includes(receiptState) || receivedAtMs !== null;
  const validationErrors = [
    ...(providerId !== provider.id ? [`receipt-provider-mismatch:${providerId}`] : []),
    ...(receiptId !== expectedReceiptId ? ['receipt-id-mismatch'] : []),
    ...(envelopeId !== handoffDeliveryState.envelopeId ? ['receipt-envelope-mismatch'] : []),
    ...(cursor !== syncMetadata.nextCursor ? [`receipt-cursor-mismatch:${cursor}`] : []),
    ...(idempotencyKey !== command.idempotencyKey ? ['receipt-idempotency-key-mismatch'] : []),
    ...(tenantId !== tenantBoundary.tenantId ? [`receipt-tenant-mismatch:${tenantId}`] : []),
    ...(workspaceId !== tenantBoundary.workspaceId ? [`receipt-workspace-mismatch:${workspaceId}`] : []),
    ...(commitPlan.receiptExpectation.required && receiptObserved && !proofHash ? ['receipt-proof-hash-required'] : []),
    ...(proofHash && !PROOF_HASH_PATTERN.test(proofHash) ? ['receipt-proof-hash-sha256-required'] : []),
    ...(approvalSettlementProof && !PROOF_HASH_PATTERN.test(approvalSettlementProof) ? ['approval-settlement-proof-sha256-required'] : []),
    ...(approvalCommandDigest && !PROOF_HASH_PATTERN.test(approvalCommandDigest) ? ['approval-command-digest-sha256-required'] : []),
    ...(approvalTargetDigest && !PROOF_HASH_PATTERN.test(approvalTargetDigest) ? ['approval-target-digest-sha256-required'] : []),
    ...(approvalReceiptProof && !PROOF_HASH_PATTERN.test(approvalReceiptProof) ? ['approval-receipt-proof-sha256-required'] : []),
    ...(commitPlan.receiptExpectation.required && !commitPlan.receiptExpectation.proofCapabilityAccepted ? ['provider-proof-receipt-capability-missing'] : []),
    ...(deadlineExpired || receiptState === 'expired' ? ['receipt-deadline-expired'] : []),
    ...(providerRejected ? [asString(receiptInput.rejectionReason, 'provider-rejected-writeback-receipt')] : [])
  ];
  const accepted = commitPlan.receiptExpectation.required
    ? providerAccepted && validationErrors.length === 0
    : receiptState === 'not-required';
  const settlementStatus = accepted
    ? 'settled'
    : validationErrors.length
      ? 'blocked'
      : receiptObserved
        ? 'observed'
        : commitPlan.receiptExpectation.required
          ? 'waiting'
          : 'not-required';

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.provider-receipt-settlement.v1',
    settlementId: `${handoffDeliveryState.envelopeId}:${command.idempotencyKey}:settlement`,
    status: settlementStatus,
    accepted,
    required: commitPlan.receiptExpectation.required,
    providerId,
    contractId: serviceContract.contractId,
    receiptId,
    expectedReceiptId,
    receiptState: deadlineExpired ? 'expired' : receiptState,
    envelopeId,
    ackTopic: handoffDeliveryState.ackTopic,
    cursor,
    idempotencyKey,
    tenantId,
    workspaceId,
    receivedAt,
    deadlineExpiresAt,
    receiptAgeMs,
    proofHash,
    approvalSettlement: {
      provided: Boolean(Object.keys(externalWriteSettlementInput).length),
      expectedReceiptId,
      settlementProof: approvalSettlementProof,
      commandDigest: approvalCommandDigest,
      targetDigest: approvalTargetDigest,
      receiptProof: approvalReceiptProof,
      status: asString(externalWriteSettlementInput.status, null),
      settlementReady: externalWriteSettlementInput.settlementReady === true
    },
    proofRequired: commitPlan.receiptExpectation.required,
    validationErrors,
    externalHandoffPatch: {
      state: accepted ? 'none' : deadlineExpired || providerRejected ? 'blocked' : handoffDeliveryState.status === 'ready' ? 'leased' : 'queued',
      resumeToken: handoffDeliveryState.resumeToken,
      envelopeId: handoffDeliveryState.envelopeId,
      receiptId,
      settlementStatus
    },
    syncCursorPatch: {
      lastSettledCursor: accepted ? syncMetadata.nextCursor : null,
      pendingCursor: accepted ? null : syncMetadata.nextCursor,
      receiptWatermark: receivedAt || now
    }
  };
}

function buildExternalDispatchAssurance({
  input,
  now,
  provider,
  serviceContract,
  handoffDeliveryState,
  providerReceiptSettlement,
  command,
  syncMetadata,
  tenantBoundary,
  commitPlan
}) {
  const dispatchInput = asObject(input.externalDispatch || asObject(input.externalHandoff).dispatch);
  const approvalImpact = asObject(input.approvalImpact || input.impact);
  const approvalSettlement = asObject(
    input.externalWriteSettlement
    || asObject(input.externalWrite).settlement
    || approvalImpact.externalWriteSettlement
    || providerReceiptSettlement.approvalSettlement
  );
  const settlementRequired = providerReceiptSettlement.required || approvalSettlement.provided === true;
  const expectedReceiptId = providerReceiptSettlement.expectedReceiptId;
  const receiptProof = asString(
    approvalSettlement.receiptProof
    || approvalSettlement.externalReceiptProof
    || providerReceiptSettlement.proofHash,
    null
  );
  const settlementProof = asString(approvalSettlement.proof || approvalSettlement.settlementProof, null);
  const commandDigest = asString(approvalSettlement.commandDigest, null);
  const targetDigest = asString(approvalSettlement.targetDigest, null);
  const requestedDispatchState = asString(dispatchInput.state, commitPlan.ready ? 'ready' : 'blocked');
  const dispatchState = ['ready', 'queued', 'leased', 'settled', 'blocked'].includes(requestedDispatchState)
    ? requestedDispatchState
    : 'blocked';
  const replayKey = asString(
    dispatchInput.replayKey || dispatchInput.idempotencyKey,
    `${tenantBoundary.stateScopeKey}:${syncMetadata.batchId}:${command.idempotencyKey}:external-dispatch`
  );
  const dedupeWindowMs = Number.isInteger(dispatchInput.dedupeWindowMs) && dispatchInput.dedupeWindowMs >= 1000
    ? Math.min(dispatchInput.dedupeWindowMs, 86400000)
    : 600000;
  const externalTargets = asStringList(
    dispatchInput.targets
    || asObject(input.externalWrite).targets
    || approvalImpact.externalTargets
  );
  const proofErrors = [
    ...(receiptProof && !PROOF_HASH_PATTERN.test(receiptProof) ? ['external-dispatch-receipt-proof-sha256-required'] : []),
    ...(settlementProof && !PROOF_HASH_PATTERN.test(settlementProof) ? ['external-dispatch-settlement-proof-sha256-required'] : []),
    ...(commandDigest && !PROOF_HASH_PATTERN.test(commandDigest) ? ['external-dispatch-command-digest-sha256-required'] : []),
    ...(targetDigest && !PROOF_HASH_PATTERN.test(targetDigest) ? ['external-dispatch-target-digest-sha256-required'] : [])
  ];
  const blockedReasons = [
    ...providerReceiptSettlement.validationErrors.map((reason) => `receipt-settlement:${reason}`),
    ...proofErrors,
    ...(settlementRequired && !expectedReceiptId ? ['external-dispatch-expected-receipt-id-required'] : []),
    ...(settlementRequired && !receiptProof ? ['external-dispatch-receipt-proof-required'] : []),
    ...(settlementRequired && providerReceiptSettlement.status === 'blocked' ? ['external-dispatch-receipt-settlement-blocked'] : []),
    ...(!handoffDeliveryState.ready ? handoffDeliveryState.blockedReasons.map((reason) => `handoff:${reason}`) : []),
    ...(!serviceContract.ready ? serviceContract.blockedReasons.map((reason) => `service-contract:${reason}`) : []),
    ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations.map((reason) => `tenant-boundary:${reason}`) : []),
    ...(commitPlan.status === 'blocked' ? commitPlan.blockedReasons.map((reason) => `commit-plan:${reason}`) : []),
    ...(dispatchState === 'blocked' ? ['external-dispatch-state-blocked'] : [])
  ];
  const ready = blockedReasons.length === 0
    && (dispatchState === 'ready' || dispatchState === 'queued' || dispatchState === 'leased' || dispatchState === 'settled');
  const status = providerReceiptSettlement.accepted
    ? 'settled'
    : ready
      ? 'ready-for-provider-dispatch'
      : providerReceiptSettlement.status === 'waiting'
        ? 'awaiting-provider-receipt'
        : 'blocked';

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.external-dispatch-assurance.v1',
    assuranceId: `${handoffDeliveryState.envelopeId}:${command.idempotencyKey}:external-assurance`,
    generatedAt: now,
    status,
    ready,
    providerId: provider.id,
    serviceContractId: serviceContract.contractId,
    handoffEnvelopeId: handoffDeliveryState.envelopeId,
    receiptSettlementId: providerReceiptSettlement.settlementId,
    expectedReceiptId,
    receiptProof,
    settlementProof,
    commandDigest,
    targetDigest,
    replayProtection: {
      replayKey,
      idempotencyKey: command.idempotencyKey,
      dedupeWindowMs,
      duplicateSafe: Boolean(replayKey && command.idempotencyKey)
    },
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateScopeKey: tenantBoundary.stateScopeKey,
      cursor: syncMetadata.nextCursor,
      batchId: syncMetadata.batchId
    },
    externalTargets,
    settlementRequired,
    receiptAccepted: providerReceiptSettlement.accepted,
    receiptState: providerReceiptSettlement.receiptState,
    blockedReasons: [...new Set(blockedReasons)],
    nextAction: status === 'settled'
      ? 'advance-sync-cursor'
      : ready
        ? 'dispatch-external-write'
        : blockedReasons.includes('external-dispatch-receipt-proof-required')
          ? 'attach-external-receipt-proof'
          : providerReceiptSettlement.status === 'waiting'
            ? 'wait-for-provider-receipt'
            : 'repair-external-dispatch-contract',
    proof: `sha256:${stableExternalDispatchProof({
      providerId: provider.id,
      handoffEnvelopeId: handoffDeliveryState.envelopeId,
      expectedReceiptId,
      receiptProof,
      commandDigest,
      targetDigest,
      replayKey,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      cursor: syncMetadata.nextCursor,
      blockedReasons
    })}`
  };
}

function buildMailchimpCampaignDispatchGuard({
  input,
  now,
  mailchimpWritebackContext,
  acceptance,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState,
  providerReceiptSettlement,
  externalDispatchAssurance,
  command,
  syncMetadata,
  persistedState,
  preview
}) {
  const guardInput = asObject(input.mailchimpDispatchGuard || asObject(input.mailchimp).dispatchGuard);
  const approvalConsole = asObject(input.approvalConsole || input.approvalState);
  const approvalDispatchReadiness = asObject(
    input.mailchimpCampaignDispatch
    || approvalConsole.mailchimpCampaignDispatch
    || asObject(input.mailchimp).approvalDispatch
  );
  const approvalBridge = asObject(
    input.mailchimpWritebackApprovalBridge
    || approvalDispatchReadiness.writebackApprovalBridge
    || approvalConsole.writebackApprovalBridge
    || asObject(input.approval).writebackApprovalBridge
  );
  const approvalBridgePatch = asObject(approvalBridge.writebackPatch);
  const bridgedApproval = asObject(approvalBridgePatch.approval);
  const approval = asObject(input.approval || bridgedApproval || approvalConsole);
  const proofBundle = asObject(approval.proofBundle || approval.proof);
  const workflowAcceptance = asObject(approval.workflowAcceptance || approval.acceptance);
  const externalWriteSettlement = asObject(
    input.externalWriteSettlement
    || asObject(input.externalWrite).settlement
    || asObject(input.approvalImpact || input.impact).externalWriteSettlement
  );
  const applies = mailchimpWritebackContext.applies;
  const approvalBridgeApplies = approvalBridge.applies === true || approvalBridge.format === 'approval-console.mailchimp-writeback-approval-bridge.v1';
  const approvalBridgeReady = approvalBridge.ready === true || approvalBridge.status === 'ready';
  const bridgeAcceptedApprovalIds = asStringList(
    asObject(approvalBridgePatch.mailchimpDispatchGuard).acceptedApprovalIds
    || approvalBridge.readyApprovalIds
  );
  const bridgeBlockedApprovalIds = asStringList(approvalBridge.blockedApprovalIds);
  const bridgeProof = asString(
    approvalBridge.proof
    || asObject(approvalBridgePatch.mailchimpDispatchGuard).bridgeProof,
    null
  );
  const bridgeCampaign = asObject(approvalBridge.campaign);
  const bridgeStateKey = asString(bridgeCampaign.stateKey, asString(approvalBridge.stateKey, null));
  const bridgeTenantId = asString(approvalBridge.tenantId, null);
  const bridgeWorkspaceId = asString(approvalBridge.workspaceId, null);
  const bridgeProofRefs = approvalBridgeApplies
    ? asStringList(approvalBridge.requiredProofRefs)
    : [];
  const bridgeValidation = [
    ...(approvalBridgeApplies && !approvalBridgeReady ? ['mailchimp-approval-bridge-not-ready'] : []),
    ...(approvalBridgeApplies && !bridgeProof ? ['mailchimp-approval-bridge-proof-required'] : []),
    ...(bridgeProof && !PROOF_HASH_PATTERN.test(bridgeProof) ? ['mailchimp-approval-bridge-proof-sha256-required'] : []),
    ...(approvalBridgeApplies && bridgeStateKey && bridgeStateKey !== mailchimpWritebackContext.stateKey
      ? ['mailchimp-approval-bridge-state-key-mismatch']
      : []),
    ...(approvalBridgeApplies && bridgeTenantId && bridgeTenantId !== tenantBoundary.tenantId
      ? ['mailchimp-approval-bridge-tenant-mismatch']
      : []),
    ...(approvalBridgeApplies && bridgeWorkspaceId && bridgeWorkspaceId !== tenantBoundary.workspaceId
      ? ['mailchimp-approval-bridge-workspace-mismatch']
      : []),
    ...(approvalBridgeApplies && bridgeAcceptedApprovalIds.length === 0 ? ['mailchimp-approval-bridge-empty-accepted-approvals'] : []),
    ...bridgeBlockedApprovalIds.map((requestId) => `mailchimp-approval-bridge-blocked:${requestId}`)
  ];
  const approvalState = asString(approval.state, acceptance.accepted ? 'approved' : 'requested');
  const approvalRequestId = asString(
    approval.id || approval.requestId,
    bridgeAcceptedApprovalIds[0] || null
  );
  const approvalProof = asString(proofBundle.proof || approval.proofBundleProof || approval.proof, null);
  const workflowAcceptanceProof = asString(
    workflowAcceptance.acceptanceProof
    || workflowAcceptance.proof
    || approval.workflowAcceptanceProof,
    null
  );
  const settlementProof = asString(
    externalWriteSettlement.proof
    || externalWriteSettlement.settlementProof
    || approval.externalWriteSettlementProof,
    null
  );
  const receiptProof = asString(
    externalWriteSettlement.receiptProof
    || externalWriteSettlement.externalReceiptProof
    || providerReceiptSettlement.proofHash
    || externalDispatchAssurance.receiptProof,
    null
  );
  const requireApprovalProof = guardInput.requireApprovalProof === false ? false : true;
  const requireReceiptBeforeDispatch = guardInput.requireReceiptBeforeDispatch === false
    ? false
    : providerReceiptSettlement.required || externalDispatchAssurance.settlementRequired;
  const requireWorkflowAcceptance = guardInput.requireWorkflowAcceptance === false ? false : true;
  const requireApprovalBridge = guardInput.approvalBridgeRequired === true || approvalBridgeApplies;
  const approved = approvalBridgeReady || approvalState === 'approved' || acceptance.accepted;
  const workflowAccepted = workflowAcceptance.accepted === true
    || approvalBridgeReady
    || workflowAcceptanceProof !== null
    || requireWorkflowAcceptance === false;
  const proofValidation = [
    ...(approvalProof && !PROOF_HASH_PATTERN.test(approvalProof) ? ['mailchimp-approval-proof-sha256-required'] : []),
    ...(workflowAcceptanceProof && !PROOF_HASH_PATTERN.test(workflowAcceptanceProof) ? ['mailchimp-workflow-acceptance-proof-sha256-required'] : []),
    ...(settlementProof && !PROOF_HASH_PATTERN.test(settlementProof) ? ['mailchimp-settlement-proof-sha256-required'] : []),
    ...(receiptProof && !PROOF_HASH_PATTERN.test(receiptProof) ? ['mailchimp-receipt-proof-sha256-required'] : [])
  ];
  const upstreamGate = {
    trustMetadata: {
      observed: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.observed === true,
      ready: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.ready !== false,
      status: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.status || 'not_observed',
      nextAction: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.nextAction || null,
      proof: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.proof || null,
      blockedReasons: mailchimpWritebackContext.upstreamReadiness?.trustMetadata?.blockedReasons || []
    },
    volatileFactCheck: {
      observed: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.observed === true,
      ready: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.ready !== false,
      status: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.status || 'not_observed',
      nextAction: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.nextAction || null,
      proof: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.proof || null,
      blockedReasons: mailchimpWritebackContext.upstreamReadiness?.volatileFactCheck?.blockedReasons || []
    }
  };
  const upstreamGateBlockedReasons = [
    ...(!upstreamGate.trustMetadata.ready ? upstreamGate.trustMetadata.blockedReasons : []),
    ...(!upstreamGate.volatileFactCheck.ready ? upstreamGate.volatileFactCheck.blockedReasons : [])
  ];
  const blockedReasons = !applies
    ? []
    : [
      ...mailchimpWritebackContext.blockedReasons.map((reason) => `mailchimp-context:${reason}`),
      ...upstreamGateBlockedReasons.map((reason) => `upstream:${reason}`),
      ...bridgeValidation,
      ...proofValidation,
      ...(!approved ? ['mailchimp-approval-not-approved'] : []),
      ...(requireApprovalProof && !approvalProof ? ['mailchimp-approval-proof-required'] : []),
      ...(requireWorkflowAcceptance && !workflowAccepted ? ['mailchimp-workflow-acceptance-required'] : []),
      ...(requireApprovalBridge && !approvalBridgeApplies ? ['mailchimp-approval-bridge-required'] : []),
      ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations.map((reason) => `tenant-boundary:${reason}`) : []),
      ...(!lifecycleSettings.ready ? lifecycleSettings.blockedReasons.map((reason) => `lifecycle:${reason}`) : []),
      ...(!handoffDeliveryState.ready ? handoffDeliveryState.blockedReasons.map((reason) => `handoff:${reason}`) : []),
      ...(!externalDispatchAssurance.ready && externalDispatchAssurance.status !== 'settled'
        ? externalDispatchAssurance.blockedReasons.map((reason) => `external-dispatch:${reason}`)
        : []),
      ...(requireReceiptBeforeDispatch && !providerReceiptSettlement.accepted
        ? [`receipt-settlement:${providerReceiptSettlement.status}`]
        : []),
      ...(preview.withheldRecordCount > 0 ? ['mailchimp-preview-records-withheld-by-boundary'] : []),
      ...(persistedState.failureLedger.terminalFailureCount > 0 ? ['mailchimp-persisted-terminal-failure'] : [])
    ];
  const ready = applies
    && blockedReasons.length === 0
    && mailchimpWritebackContext.readyForExternalDispatch
    && (externalDispatchAssurance.ready || externalDispatchAssurance.status === 'settled');
  const nextAction = !applies
    ? 'not-applicable'
    : ready
      ? 'dispatch-mailchimp-campaign-writeback'
      : blockedReasons.some((reason) => reason.includes('approval-proof'))
        ? 'attach-mailchimp-approval-proof'
        : blockedReasons.some((reason) => reason.includes('receipt-settlement'))
          ? 'wait-for-mailchimp-receipt-settlement'
          : blockedReasons.some((reason) => reason.includes('lifecycle:'))
            ? lifecycleSettings.nextLifecycleAction
            : blockedReasons.some((reason) => reason.includes('tenant-boundary:'))
              ? 'repair-mailchimp-tenant-boundary'
              : 'repair-mailchimp-dispatch-contract';
  const dispatchEnvelope = applies
    ? {
      envelopeId: `${tenantBoundary.stateScopeKey}:${mailchimpWritebackContext.stateKey}:${syncMetadata.nextCursor}:mailchimp-dispatch`,
      payloadSchema: 'memory.writeback.mailchimp-campaign-dispatch.v1',
      idempotencyKey: `${mailchimpWritebackContext.replayProtection.replayKey}:${command.idempotencyKey}`,
      replayKey: mailchimpWritebackContext.replayProtection.replayKey,
      destination: handoffDeliveryState.destination,
      ackTopic: handoffDeliveryState.ackTopic,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      writeToken: persistedState.writeToken,
      campaignId: mailchimpWritebackContext.campaignId,
      audienceId: mailchimpWritebackContext.audienceId,
      segmentId: mailchimpWritebackContext.segmentId,
      workflowId: mailchimpWritebackContext.workflowId,
      stateKey: mailchimpWritebackContext.stateKey
    }
    : null;

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.mailchimp-campaign-dispatch-guard.v1',
    generatedAt: now,
    applies,
    status: !applies ? 'not-applicable' : ready ? 'ready' : 'blocked',
    ready,
    nextAction,
    approval: {
      requestId: approvalRequestId,
      state: approvalState,
      approved,
      proofRequired: requireApprovalProof,
      proof: approvalProof,
      workflowAcceptanceRequired: requireWorkflowAcceptance,
      workflowAccepted,
      workflowAcceptanceProof,
      settlementProof,
      receiptProof,
      bridge: {
        observed: approvalBridgeApplies,
        required: requireApprovalBridge,
        ready: approvalBridgeReady,
        proof: bridgeProof,
        acceptedApprovalIds: bridgeAcceptedApprovalIds,
        blockedApprovalIds: bridgeBlockedApprovalIds,
        requiredProofRefs: bridgeProofRefs,
        validation: bridgeValidation
      }
    },
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateScopeKey: tenantBoundary.stateScopeKey,
      boundaryAllowed: tenantBoundary.allowed,
      campaignStateKey: mailchimpWritebackContext.stateKey
    },
    upstreamGate,
    receiptSettlement: {
      required: requireReceiptBeforeDispatch,
      status: providerReceiptSettlement.status,
      accepted: providerReceiptSettlement.accepted,
      receiptId: providerReceiptSettlement.receiptId,
      expectedReceiptId: providerReceiptSettlement.expectedReceiptId,
      deadlineExpiresAt: providerReceiptSettlement.deadlineExpiresAt
    },
    externalDispatch: {
      assuranceId: externalDispatchAssurance.assuranceId,
      status: externalDispatchAssurance.status,
      ready: externalDispatchAssurance.ready,
      nextAction: externalDispatchAssurance.nextAction,
      replayKey: externalDispatchAssurance.replayProtection.replayKey
    },
    dispatchEnvelope,
    auditHandoff: {
      destination: 'memory-manager/writeback-policy/mailchimp-dispatch-guard',
      safeToAppend: applies,
      requiredProofs: [
        ...(requireApprovalProof ? ['approvalProof'] : []),
        ...(requireWorkflowAcceptance ? ['workflowAcceptanceProof'] : []),
        ...(requireApprovalBridge ? ['approvalBridgeProof'] : []),
        ...(requireReceiptBeforeDispatch ? ['receiptProof'] : [])
      ],
      blockedReasons,
      proofRefs: {
        approvalProof,
        approvalBridgeProof: bridgeProof,
        workflowAcceptanceProof,
        settlementProof,
        receiptProof,
        contextProof: mailchimpWritebackContext.proof,
        trustMetadataProof: upstreamGate.trustMetadata.proof,
        volatileFactProof: upstreamGate.volatileFactCheck.proof,
        dispatchProof: externalDispatchAssurance.proof
      }
    },
    blockedReasons: [...new Set(blockedReasons)],
    proof: `sha256:${stableExternalDispatchProof({
      applies,
      ready,
      nextAction,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateKey: mailchimpWritebackContext.stateKey,
      approvalRequestId,
      approvalProof,
      bridgeProof,
      bridgeAcceptedApprovalIds,
      bridgeBlockedApprovalIds,
      workflowAcceptanceProof,
      settlementProof,
      receiptProof,
      upstreamGate,
      blockedReasons
    })}`
  };
}

function stableExternalDispatchProof(payload) {
  const serialized = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(64, '0');
}

function buildWorkflowHandoff({ clientRuntime, syncMetadata, externalHandoff, handoffDeliveryState, acceptance, validationSummary, nextSteps, clientStateCheckpoint }) {
  const primaryStep = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const canResumeInClient = externalHandoff.resumable
    && handoffDeliveryState.ready
    && validationSummary.severity !== 'blocked'
    && !clientStateCheckpoint.refreshRequired;
  const userVisibleStatus = acceptance.accepted
    ? 'accepted-for-commit'
    : clientStateCheckpoint.refreshRequired
      ? 'client-state-refresh-required'
    : validationSummary.severity === 'blocked'
      ? 'blocked'
      : acceptance.requiresUserPreview
        ? 'awaiting-preview-review'
        : 'awaiting-acceptance';

  return {
    handoffType: 'memory.writeback.workflow',
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    stateKey: clientRuntime.stateKey,
    status: userVisibleStatus,
    route: clientRuntime.route,
    returnTo: clientRuntime.returnTo,
    resume: {
      enabled: canResumeInClient,
      target: externalHandoff.target,
      leaseId: externalHandoff.leaseId,
      envelopeId: handoffDeliveryState.envelopeId,
      channel: handoffDeliveryState.channel,
      ackTopic: handoffDeliveryState.ackTopic,
      resumeToken: handoffDeliveryState.resumeToken,
      cursor: syncMetadata.nextCursor,
      action: primaryStep ? primaryStep.action : 'memory.writeback.acceptance.wait'
    },
    clientState: {
      checkpointType: clientStateCheckpoint.checkpointType,
      stage: clientStateCheckpoint.stage,
      revision: clientStateCheckpoint.revision,
      nextRevision: clientStateCheckpoint.nextRevision,
      checkpointToken: clientStateCheckpoint.checkpointToken,
      refreshRequired: clientStateCheckpoint.refreshRequired,
      staleReasons: clientStateCheckpoint.staleReasons,
      continuationPatch: clientStateCheckpoint.continuationPatch
    },
    userMessage: canResumeInClient
      ? `Writeback ${syncMetadata.batchId} can continue from ${clientRuntime.surface}.`
      : clientStateCheckpoint.refreshRequired
        ? `Writeback ${syncMetadata.batchId} needs client state refresh before continuing.`
      : `Writeback ${syncMetadata.batchId} needs ${primaryStep ? primaryStep.label : 'operator review'}.`,
    nextAction: primaryStep
      ? {
        id: primaryStep.id,
        label: primaryStep.label,
        action: primaryStep.action,
        enabled: primaryStep.enabled
      }
      : null
  };
}

function buildClientWorkflowContract({
  clientRuntime,
  command,
  syncMetadata,
  preview,
  acceptance,
  readiness,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState,
  workflowHandoff,
  nextSteps,
  persistedState,
  restartSafeStatus,
  operationalHealth,
  clientStateCheckpoint,
  persistedStateRecovery
}) {
  const commandMatrix = ['inspect', 'preview', 'accept', 'reject', 'commit', 'recover', 'enable', 'disable', 'schedule']
    .map((type) => {
      const requiredPermissions = WRITEBACK_COMMAND_PERMISSIONS[type] || WRITEBACK_COMMAND_PERMISSIONS.inspect;
      const missingPermissions = requiredPermissions.filter((permission) => !tenantBoundary.grantedPermissions.includes(permission));
      const lifecycleBlocked = !lifecycleSettings.ready && !['inspect', 'preview', 'reject', 'enable', 'disable', 'schedule'].includes(type);
      const dirtyRecordsRequired = ['preview', 'accept', 'commit'].includes(type);
      const acceptanceRequired = type === 'commit';
      const handoffRequired = type === 'commit' || type === 'recover';
      const lifecycleControlBlocked = type === 'enable'
        ? lifecycleSettings.settingsCommand.validation.errors.length > 0 && command.type === 'enable'
        : type === 'disable'
          ? lifecycleSettings.settingsCommand.validation.errors.length > 0 && command.type === 'disable'
          : type === 'schedule'
            ? lifecycleSettings.settingsCommand.validation.errors.length > 0
            : false;
      const blockedReasons = [
        ...missingPermissions.map((permission) => `missing-permission:${permission}`),
        ...(dirtyRecordsRequired && syncMetadata.dirtyRecordCount === 0 ? ['no-dirty-records-to-writeback'] : []),
        ...(acceptanceRequired && !acceptance.accepted ? ['acceptance-required-before-commit'] : []),
        ...(handoffRequired && !handoffDeliveryState.ready ? ['handoff-delivery-not-ready'] : []),
        ...(lifecycleBlocked ? lifecycleSettings.blockedReasons : []),
        ...(lifecycleControlBlocked ? lifecycleSettings.settingsCommand.validation.errors : []),
        ...(!tenantBoundary.allowed && !missingPermissions.length ? tenantBoundary.boundaryViolations : [])
      ];

      return {
        type,
        enabled: blockedReasons.length === 0,
        selected: command.type === type,
        requiredPermissions,
        missingPermissions,
        blockedReasons
      };
    });
  const selectedCommand = commandMatrix.find((entry) => entry.selected) || commandMatrix[0];
  const continuationEndpoint = `${clientRuntime.route}/continue/${encodeURIComponent(syncMetadata.batchId)}`;
  const payloadSchema = {
    schemaVersion: 1,
    contentType: 'application/vnd.aios.memory-writeback.workflow+json',
    requiredFields: [
      'requestId',
      'sessionId',
      'stateKey',
      'command.type',
      'command.idempotencyKey',
      'sync.batchId',
      'sync.nextCursor',
      'tenant.id',
      'workspace.id'
    ],
    optionalFields: [
      'acceptance.decision',
      'externalHandoff.resumeToken',
      'externalHandoff.delivery.envelopeId',
      'persistedState.writeToken'
    ]
  };
  const stateBindings = {
    requestId: clientRuntime.requestId,
    clientRequestId: clientRuntime.clientRequestId,
    sessionId: clientRuntime.sessionId,
    stateKey: clientRuntime.stateKey,
    correlationKey: clientRuntime.correlationKey,
    traceId: clientRuntime.traceId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    pendingCursor: persistedState.pendingCursor,
    writeToken: persistedState.writeToken,
    idempotencyKey: command.idempotencyKey,
    handoffEnvelopeId: handoffDeliveryState.envelopeId,
    resumeToken: handoffDeliveryState.resumeToken
  };
  const clientAction = selectedCommand.enabled
    ? `memory.writeback.client.${selectedCommand.type}`
    : nextSteps[0]
      ? nextSteps[0].action
      : 'memory.writeback.client.wait';
  const blockingReasons = [
    ...selectedCommand.blockedReasons,
    ...(clientStateCheckpoint.refreshRequired ? clientStateCheckpoint.staleReasons : []),
    ...(readiness.ready ? [] : readiness.failed.map((id) => `readiness-failed:${id}`)),
    ...(operationalHealth.retryable ? [`retry-after-ms:${operationalHealth.retryAfterMs}`] : []),
    ...(operationalHealth.failureState === 'terminal' ? operationalHealth.terminalReasons : [])
  ];

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.client-workflow.v1',
    surface: clientRuntime.surface,
    route: clientRuntime.route,
    intent: clientRuntime.intent,
    status: workflowHandoff.status,
    continuationEndpoint,
    returnTo: clientRuntime.returnTo,
    clientAction,
    selectedCommand: selectedCommand.type,
    selectedCommandEnabled: selectedCommand.enabled,
    allowedCommands: commandMatrix.filter((entry) => entry.enabled).map((entry) => entry.type),
    commandMatrix,
    lifecycleControls: {
      contractId: lifecycleSettings.settingsCommand.contractId,
      status: lifecycleSettings.settingsCommand.commandResult.status,
      nextAction: lifecycleSettings.nextActionState,
      controls: lifecycleSettings.controlState,
      effectivePatch: lifecycleSettings.settingsCommand.effectivePatch,
      validation: lifecycleSettings.settingsCommand.validation
    },
    stateBindings,
    clientStateCheckpoint: {
      checkpointType: clientStateCheckpoint.checkpointType,
      stage: clientStateCheckpoint.stage,
      revision: clientStateCheckpoint.revision,
      nextRevision: clientStateCheckpoint.nextRevision,
      stateKey: clientStateCheckpoint.stateKey,
      checkpointToken: clientStateCheckpoint.checkpointToken,
      refreshRequired: clientStateCheckpoint.refreshRequired,
      staleReasons: clientStateCheckpoint.staleReasons,
      continuationPatch: clientStateCheckpoint.continuationPatch
    },
    payloadSchema,
    previewSummary: {
      requested: preview.requested,
      shownRecordCount: preview.shownRecordCount,
      totalDirtyRecords: preview.totalDirtyRecords,
      truncated: preview.truncated,
      requiresUserPreview: acceptance.requiresUserPreview
    },
    handoff: {
      resumable: workflowHandoff.resume.enabled,
      channel: workflowHandoff.resume.channel,
      ackTopic: workflowHandoff.resume.ackTopic,
      target: workflowHandoff.resume.target,
      action: workflowHandoff.resume.action
    },
    persistence: {
      recoveryStatus: persistedState.recoveryStatus,
      restartSafeStatus: restartSafeStatus.status,
      shouldPersist: restartSafeStatus.shouldPersist,
      replaySafe: restartSafeStatus.replaySafe,
      recoveryContractType: persistedStateRecovery.contractType,
      recoveryStatusAfterRestart: persistedStateRecovery.status,
      nextPhase: persistedStateRecovery.nextPersistedState.phase,
      nextGeneration: persistedStateRecovery.nextPersistedState.generation,
      recoveryActions: persistedStateRecovery.recoveryActions,
      journalStatus: persistedStateRecovery.persistenceJournal.status,
      journalId: persistedStateRecovery.persistenceJournal.journalId,
      durableWriteKey: persistedStateRecovery.persistenceJournal.durableWriteKey,
      journalAppendRequired: persistedStateRecovery.persistenceJournal.appendRequired,
      journalReplayHit: persistedStateRecovery.persistenceJournal.replayHit,
      restartSemantics: persistedStateRecovery.persistenceJournal.restartSemantics
    },
    blockingReasons: [...new Set(blockingReasons)]
  };
}

function buildPreviewAcceptanceRouteData({
  clientRuntime,
  command,
  syncMetadata,
  preview,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  tenantBoundary,
  handoffDeliveryState,
  persistedState,
  clientStateCheckpoint,
  writableRecords,
  acceptEnabled,
  rejectEnabled
}) {
  const failedReadinessChecks = readiness.checks.filter((check) => !check.pass);
  const routeBase = {
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    traceId: clientRuntime.traceId,
    stateKey: clientRuntime.stateKey,
    tenant: {
      id: tenantBoundary.tenantId
    },
    workspace: {
      id: tenantBoundary.workspaceId
    },
    sync: {
      batchId: syncMetadata.batchId,
      nextCursor: syncMetadata.nextCursor
    },
    persistedState: {
      stateKey: persistedState.stateKey,
      writeToken: persistedState.writeToken,
      generation: persistedState.generation
    },
    externalHandoff: {
      resumeToken: handoffDeliveryState.resumeToken,
      delivery: {
        envelopeId: handoffDeliveryState.envelopeId,
        ackTopic: handoffDeliveryState.ackTopic,
        channel: handoffDeliveryState.channel
      }
    }
  };
  const readinessGateSummary = {
    ready: readiness.ready,
    passedGateIds: readiness.passed,
    failedGateIds: readiness.failed,
    blockingGateCount: failedReadinessChecks.length,
    firstBlockingGateId: failedReadinessChecks[0] ? failedReadinessChecks[0].id : null,
    failedGates: failedReadinessChecks.map((check) => ({
      id: check.id,
      label: check.label,
      message: check.detail,
      recoveryAction: `memory.writeback.resolve.${check.id}`
    }))
  };
  const previewProof = {
    proofType: 'memory.writeback.preview-decision-proof.v1',
    proofId: `${clientRuntime.correlationKey}:${syncMetadata.batchId}:preview-decision`,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    previewRecordCount: preview.records.length,
    writableRecordCount: writableRecords.length,
    withheldRecordCount: preview.withheldRecordCount,
    estimatedWritableBytes: writableRecords.reduce((total, record) => total + record.byteSize, 0),
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    stateScopeKey: tenantBoundary.stateScopeKey,
    checkpointToken: clientStateCheckpoint.checkpointToken,
    recordTokens: preview.records.map((record) => record.previewToken),
    writableRecordTokens: writableRecords.map((record) => record.previewToken),
    withheldRecordTokens: preview.records.filter((record) => !record.writable).map((record) => record.previewToken),
    guarantees: {
      clientCheckpointFresh: !clientStateCheckpoint.refreshRequired,
      tenantBoundaryAllowed: tenantBoundary.allowed,
      previewRecordsWritable: preview.withheldRecordCount === 0,
      handoffDeliverable: handoffDeliveryState.ready,
      readinessClean: readiness.ready,
      acceptanceActionable: acceptEnabled
    }
  };
  const acceptancePayload = {
    ...routeBase,
    command: {
      type: 'accept',
      idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:accept`,
      issuedAt: command.issuedAt
    },
    acceptance: {
      decision: 'accepted',
      actor: acceptance.actor,
      acceptedAt: clientRuntime.receivedAt,
      previewProofId: previewProof.proofId,
      previewTokens: writableRecords.map((record) => record.previewToken)
    },
    clientState: {
      stage: 'acceptance-submitted',
      revision: clientStateCheckpoint.nextRevision,
      stateKey: clientRuntime.stateKey,
      lastSeenBatchId: syncMetadata.batchId,
      lastSeenCursor: syncMetadata.nextCursor,
      pendingCommandType: 'accept',
      pendingIdempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:accept`
    }
  };
  const rejectionPayload = {
    ...routeBase,
    command: {
      type: 'reject',
      idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:reject`,
      issuedAt: command.issuedAt
    },
    acceptance: {
      decision: 'rejected',
      actor: acceptance.actor,
      rejectionReason: 'operator-rejected-preview',
      previewProofId: previewProof.proofId
    },
    clientState: {
      stage: 'acceptance-submitted',
      revision: clientStateCheckpoint.nextRevision,
      stateKey: clientRuntime.stateKey,
      lastSeenBatchId: syncMetadata.batchId,
      lastSeenCursor: syncMetadata.nextCursor,
      pendingCommandType: 'reject',
      pendingIdempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:reject`
    }
  };
  const nextStepBindings = nextSteps.map((step) => ({
    id: step.id,
    action: step.action,
    enabled: step.enabled,
    reason: step.reason,
    routeData: {
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      stateKey: clientRuntime.stateKey,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      checkpointToken: clientStateCheckpoint.checkpointToken,
      commandType: step.action === 'memory.writeback.commit'
        ? 'commit'
        : step.action === 'memory.writeback.preview.review'
          ? 'preview'
          : command.type,
      action: step.action
    }
  }));

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.preview-acceptance-route-data.v1',
    routeBase,
    readinessGateSummary,
    validationSummary: {
      severity: validationSummary.severity,
      valid: validationSummary.valid,
      issueCount: validationSummary.issueCount,
      issues: validationSummary.issues
    },
    previewProof,
    payloads: {
      accept: acceptEnabled ? acceptancePayload : null,
      reject: rejectEnabled ? rejectionPayload : null
    },
    nextStepBindings
  };
}

function buildPreviewAcceptanceContract({
  clientRuntime,
  clientStateCheckpoint,
  command,
  syncMetadata,
  preview,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState,
  persistedState,
  restartSafeStatus,
  operationalHealth
}) {
  const writableRecords = preview.records.filter((record) => record.writable);
  const visibleRecords = preview.records.map((record, index) => ({
    ordinal: index + 1,
    previewToken: record.previewToken,
    recordId: record.recordId,
    collection: record.collection,
    operation: record.operation,
    byteSize: record.byteSize,
    scopeKey: record.scopeKey,
    writable: record.writable,
    withheld: !record.writable,
    withheldReason: record.withheldReason,
    boundaryViolations: record.boundaryViolations,
    acceptPayload: record.writable
      ? {
        previewToken: record.previewToken,
        scopeKey: record.scopeKey,
        collection: record.collection,
        recordId: record.recordId,
        operation: record.operation
      }
      : null
  }));
  const readinessRows = readiness.checks.map((check) => ({
    id: check.id,
    label: check.label,
    state: check.pass ? 'pass' : 'fail',
    message: check.detail,
    nextStepId: check.pass ? null : `resolve-${check.id}`,
    blocking: !check.pass
  }));
  const validationRows = validationSummary.issues.map((issue) => {
    const step = nextSteps.find((candidate) => candidate.id === issue.nextStepId);

    return {
      id: issue.id,
      severity: validationSummary.severity,
      message: issue.message,
      nextStepId: issue.nextStepId,
      action: step ? step.action : `memory.writeback.resolve.${issue.id}`,
      enabled: step ? step.enabled : false
    };
  });
  const suggestedNextSteps = nextSteps.map((step, index) => ({
    ordinal: index + 1,
    id: step.id,
    label: step.label,
    action: step.action,
    enabled: step.enabled,
    reason: step.reason,
    commandPatch: {
      command: {
        type: step.action === 'memory.writeback.commit'
          ? 'commit'
          : step.action === 'memory.writeback.preview.review'
            ? 'preview'
            : command.type,
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:${step.id}`
      },
      request: {
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        traceId: clientRuntime.traceId
      },
      sync: {
        batchId: syncMetadata.batchId,
        nextCursor: syncMetadata.nextCursor
      }
    }
  }));
  const acceptEnabled = acceptance.canAccept
    && writableRecords.length > 0
    && tenantBoundary.allowed
    && lifecycleSettings.ready
    && handoffDeliveryState.ready
    && persistedState.recoverable;
  const commitEnabled = acceptance.accepted && readiness.ready && restartSafeStatus.shouldPersist;
  const rejectEnabled = tenantBoundary.grantedPermissions.includes('memory.writeback.reject');
  const routeData = buildPreviewAcceptanceRouteData({
    clientRuntime,
    command,
    syncMetadata,
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    tenantBoundary,
    handoffDeliveryState,
    persistedState,
    clientStateCheckpoint,
    writableRecords,
    acceptEnabled,
    rejectEnabled
  });

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.preview-acceptance.v1',
    route: clientRuntime.route,
    continuationEndpoint: `${clientRuntime.route}/acceptance/${encodeURIComponent(syncMetadata.batchId)}`,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    stateKey: clientRuntime.stateKey,
    correlationKey: clientRuntime.correlationKey,
    status: acceptance.accepted
      ? 'accepted'
      : validationSummary.severity === 'blocked'
        ? 'blocked'
        : 'awaiting-review',
    preview: {
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      requested: preview.requested,
      totalDirtyRecords: preview.totalDirtyRecords,
      visibleRecordCount: visibleRecords.length,
      writableRecordCount: writableRecords.length,
      withheldRecordCount: preview.withheldRecordCount,
      truncated: preview.truncated,
      estimatedWritableBytes: writableRecords.reduce((total, record) => total + record.byteSize, 0),
      records: visibleRecords
    },
    acceptance: {
      decision: acceptance.decision,
      actor: acceptance.actor,
      accepted: acceptance.accepted,
      canAccept: acceptEnabled,
      canReject: rejectEnabled,
      canCommit: commitEnabled,
      requiresUserPreview: acceptance.requiresUserPreview,
      acceptedAt: acceptance.acceptedAt,
      blockedReasons: acceptance.blockedReasons,
      previewProofId: routeData.previewProof.proofId,
      acceptCommand: acceptEnabled
        ? {
          type: 'accept',
          idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:accept`,
          writeToken: persistedState.writeToken,
          previewTokens: writableRecords.map((record) => record.previewToken),
          routePayload: routeData.payloads.accept
        }
        : null,
      rejectCommand: rejectEnabled
        ? {
          type: 'reject',
          idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:reject`,
          reasonRequired: true,
          routePayload: routeData.payloads.reject
        }
        : null
    },
    readiness: {
      ready: readiness.ready,
      passedCount: readiness.passed.length,
      failedCount: readiness.failed.length,
      gateSummary: routeData.readinessGateSummary,
      rows: readinessRows
    },
    validation: {
      severity: validationSummary.severity,
      valid: validationSummary.valid,
      issueCount: validationSummary.issueCount,
      rows: validationRows,
      operatorMessage: operationalHealth.operatorMessage,
      summary: routeData.validationSummary
    },
    nextSteps: suggestedNextSteps.map((step) => ({
      ...step,
      routeData: (routeData.nextStepBindings.find((binding) => binding.id === step.id) || {}).routeData || null
    })),
    routeData,
    routePayloadSchema: {
      contentType: 'application/vnd.aios.memory-writeback.preview-acceptance+json',
      requiredFields: ['requestId', 'sessionId', 'stateKey', 'sync.batchId', 'sync.nextCursor', 'command.type', 'command.idempotencyKey'],
      acceptanceFields: ['acceptance.decision', 'acceptance.actor', 'acceptance.acceptedAt', 'acceptance.rejectionReason'],
      proofFields: ['persistedState.writeToken', 'externalHandoff.delivery.envelopeId', 'externalHandoff.resumeToken']
    }
  };
}

function buildMailchimpWorkflowAcceptanceContract({
  now,
  clientRuntime,
  syncMetadata,
  tenantBoundary,
  handoffDeliveryState,
  mailchimpWritebackContext,
  mailchimpCampaignDispatchGuard,
  previewAcceptanceContract,
  acceptance
}) {
  const applies = mailchimpWritebackContext.applies;
  const visibleRecords = previewAcceptanceContract.preview.records;
  const writableRecords = visibleRecords.filter((record) => record.writable);
  const requiredPreviewTokens = writableRecords.map((record) => record.previewToken);
  const acceptedPreviewTokens = acceptance.accepted ? requiredPreviewTokens : [];
  const missingPreviewTokens = applies
    ? requiredPreviewTokens.filter((token) => !acceptedPreviewTokens.includes(token))
    : [];
  const acceptanceRoutePayload = previewAcceptanceContract.acceptance.acceptCommand?.routePayload || null;
  const acceptanceProof = acceptance.accepted
    ? `sha256:${stableExternalDispatchProof({
      surfaceId,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateKey: mailchimpWritebackContext.stateKey,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      acceptedPreviewTokens,
      actor: acceptance.actor,
      acceptedAt: acceptance.acceptedAt
    })}`
    : null;
  const blockedReasons = !applies
    ? []
    : [
      ...mailchimpWritebackContext.missingIdentifiers.map((field) => `mailchimp.${field}.required`),
      ...mailchimpWritebackContext.blockedReasons.map((reason) => `mailchimp-context:${reason}`),
      ...previewAcceptanceContract.validation.rows
        .filter((row) => row.blocking !== false && row.severity === 'blocked')
        .map((row) => `preview-validation:${row.id}`),
      ...(!previewAcceptanceContract.acceptance.canAccept && !acceptance.accepted
        ? ['mailchimp-preview-acceptance-disabled']
        : []),
      ...missingPreviewTokens.map((token) => `mailchimp-preview-token-unaccepted:${token}`),
      ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations.map((reason) => `tenant-boundary:${reason}`) : []),
      ...(!handoffDeliveryState.ready ? handoffDeliveryState.blockedReasons.map((reason) => `handoff:${reason}`) : [])
    ];
  const ready = applies
    && acceptance.accepted
    && acceptanceProof !== null
    && missingPreviewTokens.length === 0
    && blockedReasons.length === 0;
  const nextAction = !applies
    ? 'not-applicable'
    : ready
      ? 'submit-mailchimp-workflow-acceptance'
      : missingPreviewTokens.length > 0 || !acceptance.accepted
        ? 'accept-mailchimp-preview-sections'
        : blockedReasons.some((reason) => reason.startsWith('tenant-boundary:'))
          ? 'repair-mailchimp-tenant-boundary'
          : blockedReasons.some((reason) => reason.startsWith('handoff:'))
            ? 'repair-mailchimp-handoff-delivery'
            : 'repair-mailchimp-workflow-acceptance';
  const writebackPatch = applies
    ? {
      approval: {
        workflowAcceptance: {
          accepted: ready,
          acceptanceProof,
          acceptedPreviewTokens,
          acceptedAt: acceptance.acceptedAt,
          actor: acceptance.actor
        }
      },
      mailchimpDispatchGuard: {
        requireWorkflowAcceptance: true,
        workflowAcceptanceProof: acceptanceProof,
        workflowAcceptanceStateKey: mailchimpWritebackContext.stateKey
      }
    }
    : null;

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.mailchimp-workflow-acceptance.v1',
    generatedAt: now,
    applies,
    status: !applies ? 'not-applicable' : ready ? 'ready' : 'blocked',
    ready,
    nextAction,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    campaign: {
      campaignId: mailchimpWritebackContext.campaignId,
      audienceId: mailchimpWritebackContext.audienceId,
      segmentId: mailchimpWritebackContext.segmentId,
      workflowId: mailchimpWritebackContext.workflowId,
      stateKey: mailchimpWritebackContext.stateKey,
      stage: mailchimpWritebackContext.stage
    },
    acceptance: {
      decision: acceptance.decision,
      accepted: acceptance.accepted,
      actor: acceptance.actor,
      acceptedAt: acceptance.acceptedAt,
      proof: acceptanceProof,
      previewProofId: previewAcceptanceContract.acceptance.previewProofId,
      route: previewAcceptanceContract.continuationEndpoint,
      routePayload: acceptanceRoutePayload,
      requiredPreviewTokens,
      acceptedPreviewTokens,
      missingPreviewTokens
    },
    dispatchGuard: {
      observed: mailchimpCampaignDispatchGuard.applies === true,
      status: mailchimpCampaignDispatchGuard.status,
      ready: mailchimpCampaignDispatchGuard.ready,
      nextAction: mailchimpCampaignDispatchGuard.nextAction,
      proof: mailchimpCampaignDispatchGuard.proof
    },
    clientContinuation: {
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      traceId: clientRuntime.traceId,
      correlationKey: clientRuntime.correlationKey,
      returnTo: clientRuntime.returnTo
    },
    auditHandoff: {
      destination: 'memory-manager/writeback-policy/mailchimp-workflow-acceptance',
      safeToAppend: applies && ready,
      envelopeId: handoffDeliveryState.envelopeId,
      requiredProofs: ['previewAcceptanceProof', 'workflowAcceptanceProof', 'mailchimpDispatchGuardProof'],
      proofRefs: {
        previewAcceptanceProof: previewAcceptanceContract.routeData.previewProof.proofId,
        workflowAcceptanceProof: acceptanceProof,
        mailchimpDispatchGuardProof: mailchimpCampaignDispatchGuard.proof,
        contextProof: mailchimpWritebackContext.proof
      },
      blockedReasons: [...new Set(blockedReasons)]
    },
    writebackPatch,
    blockedReasons: [...new Set(blockedReasons)],
    proof: `sha256:${stableExternalDispatchProof({
      applies,
      ready,
      nextAction,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateKey: mailchimpWritebackContext.stateKey,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      acceptanceProof,
      acceptedPreviewTokens,
      blockedReasons
    })}`
  };
}

function lifecycleSettingsFromContinuation(persistedStateRecovery, commandType) {
  const lifecycle = asObject(asObject(persistedStateRecovery.nextPersistedState).lifecycle);
  const schedule = {
    mode: asString(lifecycle.scheduleMode, 'manual'),
    scheduledFor: asString(lifecycle.scheduledFor, null)
  };
  const enabled = commandType === 'enable'
    ? true
    : commandType === 'disable'
      ? false
      : lifecycle.enabled !== false;
  const mode = commandType === 'enable'
    ? 'enabled'
    : commandType === 'disable'
      ? 'disabled'
      : asString(lifecycle.mode, enabled ? 'enabled' : 'disabled');

  return {
    writebackPolicy: {
      mode,
      enabled,
      schedule
    }
  };
}

function buildClientContinuationDispatch({
  clientRuntime,
  command,
  syncMetadata,
  tenantBoundary,
  handoffDeliveryState,
  workflowHandoff,
  clientWorkflowContract,
  previewAcceptanceContract,
  clientStateCheckpoint,
  persistedStateRecovery,
  readiness,
  acceptance
}) {
  const requestedDispatch = asObject(asObject(clientRuntime).dispatch);
  const preferredCommand = requestedDispatch.preferredCommand
    ? clientWorkflowContract.commandMatrix.find((entry) => entry.type === requestedDispatch.preferredCommand)
    : null;
  const selectedCommand = preferredCommand
    || clientWorkflowContract.commandMatrix.find((entry) => entry.selected)
    || clientWorkflowContract.commandMatrix.find((entry) => entry.enabled)
    || clientWorkflowContract.commandMatrix[0];
  const acceptRoutePayload = previewAcceptanceContract.acceptance.acceptCommand
    ? previewAcceptanceContract.acceptance.acceptCommand.routePayload
    : null;
  const rejectRoutePayload = previewAcceptanceContract.acceptance.rejectCommand
    ? previewAcceptanceContract.acceptance.rejectCommand.routePayload
    : null;
  const commitPayload = {
    request: {
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      traceId: clientRuntime.traceId,
      route: clientRuntime.route,
      returnTo: clientRuntime.returnTo
    },
    client: {
      requestId: clientRuntime.clientRequestId,
      sessionId: clientRuntime.sessionId,
      surface: clientRuntime.surface,
      state: {
        stage: 'commit-submitted',
        revision: clientStateCheckpoint.nextRevision,
        stateKey: clientRuntime.stateKey,
        lastSeenBatchId: syncMetadata.batchId,
        lastSeenCursor: syncMetadata.nextCursor,
        pendingCommandType: 'commit',
        pendingIdempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:commit`
      }
    },
    command: {
      type: 'commit',
      idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:commit`,
      issuedAt: command.issuedAt
    },
    tenant: {
      id: tenantBoundary.tenantId
    },
    workspace: {
      id: tenantBoundary.workspaceId
    },
    sync: {
      batchId: syncMetadata.batchId,
      nextCursor: syncMetadata.nextCursor
    },
    externalHandoff: {
      resumeToken: handoffDeliveryState.resumeToken,
      delivery: {
        envelopeId: handoffDeliveryState.envelopeId,
        ackTopic: handoffDeliveryState.ackTopic,
        channel: handoffDeliveryState.channel
      }
    },
    persistedState: {
      stateKey: persistedStateRecovery.nextPersistedState.stateKey,
      writeToken: persistedStateRecovery.nextPersistedState.writeToken,
      generation: persistedStateRecovery.nextPersistedState.generation
    }
  };
  const payloadByCommand = {
    accept: acceptRoutePayload,
    reject: rejectRoutePayload,
    commit: acceptance.accepted ? commitPayload : null,
    preview: clientStateCheckpoint.continuationPatch,
    inspect: clientStateCheckpoint.continuationPatch,
    recover: {
      ...clientStateCheckpoint.continuationPatch,
      command: {
        type: 'recover',
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:recover`
      },
      persistedStateRecovery: {
        contractType: persistedStateRecovery.contractType,
        recoveryActions: persistedStateRecovery.recoveryActions,
        nextPersistedState: persistedStateRecovery.nextPersistedState
      }
    },
    schedule: {
      ...clientStateCheckpoint.continuationPatch,
      command: {
        type: 'schedule',
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:schedule`
      },
      settings: lifecycleSettingsFromContinuation(persistedStateRecovery, 'schedule')
    }
  };
  payloadByCommand.enable = {
    ...clientStateCheckpoint.continuationPatch,
    command: {
      type: 'enable',
      idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:enable`
    },
    settings: lifecycleSettingsFromContinuation(persistedStateRecovery, 'enable')
  };
  payloadByCommand.disable = {
    ...clientStateCheckpoint.continuationPatch,
    command: {
      type: 'disable',
      idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:disable`
    },
    settings: lifecycleSettingsFromContinuation(persistedStateRecovery, 'disable')
  };
  const selectedPayload = payloadByCommand[selectedCommand.type] || null;
  const lifecycleControlCommand = ['enable', 'disable', 'schedule'].includes(selectedCommand.type);
  const dispatchBlockedReasons = [
    ...(selectedCommand.enabled ? [] : selectedCommand.blockedReasons),
    ...(requestedDispatch.requireFreshCheckpoint !== false && clientStateCheckpoint.refreshRequired ? clientStateCheckpoint.staleReasons : []),
    ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations : []),
    ...(!handoffDeliveryState.ready && ['commit', 'recover'].includes(selectedCommand.type) ? handoffDeliveryState.blockedReasons : []),
    ...(selectedCommand.type === 'commit' && !acceptance.accepted ? ['acceptance-required-before-dispatch'] : []),
    ...(readiness.ready || lifecycleControlCommand ? [] : readiness.failed.map((id) => `readiness-failed:${id}`)),
    ...(!selectedPayload ? [`missing-route-payload:${selectedCommand.type}`] : [])
  ];
  const dispatchReady = dispatchBlockedReasons.length === 0;
  const dispatchId = asString(
    requestedDispatch.dispatchId,
    `${clientRuntime.correlationKey}:${syncMetadata.batchId}:${selectedCommand.type}:dispatch`
  );

  return {
    schemaVersion: 1,
    contractType: 'memory.writeback.client-continuation-dispatch.v1',
    dispatchId,
    status: dispatchReady ? 'ready' : clientStateCheckpoint.refreshRequired ? 'refresh-required' : 'blocked',
    ready: dispatchReady,
    surface: clientRuntime.surface,
    route: clientRuntime.route,
    continuationEndpoint: clientWorkflowContract.continuationEndpoint,
    returnTo: clientRuntime.returnTo,
    selectedCommand: selectedCommand.type,
    clientAction: clientWorkflowContract.clientAction,
    statePreconditions: {
      requestId: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      stateKey: clientRuntime.stateKey,
      checkpointToken: clientStateCheckpoint.checkpointToken,
      checkpointFresh: !clientStateCheckpoint.refreshRequired,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      handoffEnvelopeId: handoffDeliveryState.envelopeId,
      resumeToken: handoffDeliveryState.resumeToken
    },
    payloadContract: {
      contentType: 'application/vnd.aios.memory-writeback.client-continuation+json',
      commandType: selectedCommand.type,
      requiredFields: clientWorkflowContract.payloadSchema.requiredFields,
      optionalFields: clientWorkflowContract.payloadSchema.optionalFields,
      routePayload: dispatchReady ? selectedPayload : null,
      refreshPatch: clientStateCheckpoint.refreshRequired ? clientStateCheckpoint.continuationPatch : null
    },
    workflowHandoff: {
      status: workflowHandoff.status,
      resumeEnabled: workflowHandoff.resume.enabled,
      resumeAction: workflowHandoff.resume.action,
      userMessage: workflowHandoff.userMessage
    },
    blockedReasons: [...new Set(dispatchBlockedReasons)]
  };
}

function buildReadiness({ negotiation, syncMetadata, externalHandoff, serviceContract, handoffDeliveryState, acceptance, tenantBoundary, lifecycleSettings, preview }) {
  const checks = [
    {
      id: 'provider-capabilities',
      label: 'Provider supports required writeback capabilities',
      pass: negotiation.ready,
      detail: negotiation.missing.length ? `Missing: ${negotiation.missing.join(', ')}` : 'All required capabilities accepted'
    },
    {
      id: 'dirty-records-present',
      label: 'Writeback has records to persist',
      pass: syncMetadata.dirtyRecordCount > 0,
      detail: `${syncMetadata.dirtyRecordCount} dirty record(s) queued`
    },
    {
      id: 'cursor-continuity',
      label: 'Next sync cursor is available',
      pass: Boolean(syncMetadata.nextCursor),
      detail: syncMetadata.lastCursor ? `Advancing from ${syncMetadata.lastCursor}` : 'Starting cursor chain'
    },
    {
      id: 'external-handoff',
      label: 'External handoff can resume or queue',
      pass: externalHandoff.state !== 'blocked',
      detail: externalHandoff.blockedReason || `Handoff ${externalHandoff.state} for ${externalHandoff.target}`
    },
    {
      id: 'service-contract',
      label: 'Provider service contract can acknowledge writeback',
      pass: serviceContract.ready,
      detail: serviceContract.blockedReasons.length
        ? serviceContract.blockedReasons.join(', ')
        : `${serviceContract.protocol} using ${serviceContract.deliverySemantics} delivery`
    },
    {
      id: 'handoff-delivery-state',
      label: 'External handoff envelope is deliverable',
      pass: handoffDeliveryState.ready,
      detail: handoffDeliveryState.blockedReasons.length
        ? handoffDeliveryState.blockedReasons.join(', ')
        : `${handoffDeliveryState.channel} delivery to ${handoffDeliveryState.destination}`
    },
    {
      id: 'acceptance',
      label: 'Preview acceptance is actionable',
      pass: acceptance.canAccept,
      detail: acceptance.blockedReasons.length ? acceptance.blockedReasons.join(', ') : 'Ready for preview acceptance'
    },
    {
      id: 'tenant-permission-boundary',
      label: 'Tenant and workspace boundary permits command',
      pass: tenantBoundary.allowed,
      detail: tenantBoundary.allowed
        ? `${tenantBoundary.role} can ${tenantBoundary.commandType} in ${tenantBoundary.tenantId}/${tenantBoundary.workspaceId}`
        : tenantBoundary.boundaryViolations.join(', ')
    },
    {
      id: 'preview-record-boundaries',
      label: 'Preview records are scoped to the active workspace',
      pass: preview.withheldRecordCount === 0,
      detail: preview.withheldRecordCount === 0
        ? `${preview.shownRecordCount} preview record(s) scoped to ${tenantBoundary.tenantId}/${tenantBoundary.workspaceId}`
        : preview.scope.recordBoundaryViolations.join(', ')
    },
    {
      id: 'lifecycle-settings',
      label: 'Lifecycle settings permit writeback',
      pass: lifecycleSettings.ready,
      detail: lifecycleSettings.ready
        ? `${lifecycleSettings.mode} policy using ${lifecycleSettings.schedule.mode} scheduling`
        : lifecycleSettings.blockedReasons.join(', ')
    }
  ];

  return {
    ready: checks.every((check) => check.pass),
    passed: checks.filter((check) => check.pass).map((check) => check.id),
    failed: checks.filter((check) => !check.pass).map((check) => check.id),
    checks
  };
}

function buildValidationSummary(readiness, acceptance, preview) {
  const severity = readiness.ready ? 'ready' : acceptance.blockedReasons.length ? 'blocked' : 'needs-review';

  return {
    severity,
    valid: readiness.ready,
    previewRecordCount: preview.shownRecordCount,
    acceptanceDecision: acceptance.decision,
    issueCount: readiness.failed.length,
    issues: readiness.checks
      .filter((check) => !check.pass)
      .map((check) => ({
        id: check.id,
        message: check.detail,
        nextStepId: `resolve-${check.id}`
      }))
  };
}

function buildNextSteps({ readiness, acceptance, preview, externalHandoff, lifecycleSettings }) {
  if (readiness.ready && acceptance.accepted) {
    return [
      {
        id: 'commit-writeback-batch',
        label: 'Commit accepted writeback batch',
        action: 'memory.writeback.commit',
        enabled: true,
        reason: 'Preview accepted and readiness checks passed'
      }
    ];
  }

  const steps = [];

  if (!lifecycleSettings.ready) {
    steps.push({
      id: 'resolve-lifecycle-settings',
      label: lifecycleSettings.enabled ? 'Update writeback lifecycle settings' : 'Enable writeback policy',
      action: lifecycleSettings.nextLifecycleAction,
      enabled: lifecycleSettings.enabled || lifecycleSettings.configurable,
      reason: lifecycleSettings.blockedReasons.join(', ')
    });
  }

  if (preview.requested && acceptance.requiresUserPreview) {
    steps.push({
      id: 'review-writeback-preview',
      label: 'Review writeback preview',
      action: 'memory.writeback.preview.review',
      enabled: preview.shownRecordCount > 0,
      reason: preview.shownRecordCount > 0 ? 'Dirty record preview is available' : 'No preview records were supplied'
    });
  }

  for (const failed of readiness.checks.filter((check) => !check.pass && check.id !== 'lifecycle-settings')) {
    steps.push({
      id: `resolve-${failed.id}`,
      label: failed.label,
      action: `memory.writeback.resolve.${failed.id}`,
      enabled: failed.id !== 'external-handoff' || externalHandoff.state === 'blocked',
      reason: failed.detail
    });
  }

  if (!steps.length) {
    steps.push({
      id: 'wait-for-acceptance',
      label: 'Wait for preview acceptance',
      action: 'memory.writeback.acceptance.wait',
      enabled: true,
      reason: 'Writeback is ready but acceptance has not been recorded'
    });
  }

  return steps;
}

function buildAcceptanceResumeSnapshot({
  now,
  clientRuntime,
  command,
  syncMetadata,
  preview,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  tenantBoundary,
  lifecycleSettings,
  handoffDeliveryState,
  persistedState,
  restartSafeStatus,
  clientStateCheckpoint
}) {
  const writableRecords = preview.records.filter((record) => record.writable);
  const failedChecks = readiness.checks.filter((check) => !check.pass);
  const firstStep = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const routeBase = `${clientRuntime.route}/acceptance/${encodeURIComponent(syncMetadata.batchId)}`;
  const accepted = acceptance.accepted;
  const acceptBlockedReasons = [
    ...(acceptance.canAccept ? [] : acceptance.blockedReasons),
    ...(writableRecords.length > 0 ? [] : ['no-writable-preview-records']),
    ...(tenantBoundary.allowed ? [] : tenantBoundary.boundaryViolations),
    ...(lifecycleSettings.ready ? [] : lifecycleSettings.blockedReasons),
    ...(handoffDeliveryState.ready ? [] : handoffDeliveryState.blockedReasons),
    ...(persistedState.recoverable ? [] : ['persisted-state-not-recoverable']),
    ...(clientStateCheckpoint.refreshRequired ? clientStateCheckpoint.staleReasons : [])
  ];
  const canSubmitAccept = acceptBlockedReasons.length === 0 && !accepted;
  const canSubmitCommit = accepted && readiness.ready && restartSafeStatus.shouldPersist;
  const status = accepted
    ? canSubmitCommit ? 'accepted-commit-ready' : 'accepted-waiting-recovery'
    : canSubmitAccept
      ? 'acceptance-ready'
      : validationSummary.severity === 'blocked'
        ? 'acceptance-blocked'
        : 'awaiting-review';
  const snapshotId = `${tenantBoundary.stateScopeKey}:${syncMetadata.batchId}:${command.idempotencyKey}:acceptance-resume`;
  const acceptedAt = acceptance.acceptedAt || (accepted ? now : null);

  return {
    schemaVersion: 1,
    snapshotType: 'memory.writeback.acceptance-resume-snapshot.v1',
    snapshotId,
    generatedAt: now,
    status,
    route: routeBase,
    request: {
      requestId: clientRuntime.requestId,
      clientRequestId: clientRuntime.clientRequestId,
      sessionId: clientRuntime.sessionId,
      traceId: clientRuntime.traceId,
      surface: clientRuntime.surface,
      returnTo: clientRuntime.returnTo
    },
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      stateScopeKey: tenantBoundary.stateScopeKey,
      actor: tenantBoundary.actor,
      role: tenantBoundary.role
    },
    preview: {
      batchId: syncMetadata.batchId,
      cursor: syncMetadata.nextCursor,
      totalDirtyRecords: preview.totalDirtyRecords,
      visibleRecordCount: preview.records.length,
      writableRecordCount: writableRecords.length,
      withheldRecordCount: preview.withheldRecordCount,
      writablePreviewTokens: writableRecords.map((record) => record.previewToken),
      withheldPreviewTokens: preview.records.filter((record) => !record.writable).map((record) => record.previewToken)
    },
    acceptance: {
      decision: acceptance.decision,
      accepted,
      actor: acceptance.actor,
      acceptedAt,
      canSubmitAccept,
      canSubmitCommit,
      requiresUserPreview: acceptance.requiresUserPreview,
      blockedReasons: [...new Set(acceptBlockedReasons)]
    },
    readiness: {
      ready: readiness.ready,
      passedGateIds: readiness.passed,
      failedGateIds: readiness.failed,
      firstFailedGateId: failedChecks[0]?.id || null,
      failedGateSummaries: failedChecks.map((check) => ({
        gateId: check.id,
        label: check.label,
        detail: check.detail
      }))
    },
    validation: {
      severity: validationSummary.severity,
      valid: validationSummary.valid,
      issueCount: validationSummary.issueCount,
      issueIds: validationSummary.issues.map((issue) => issue.id)
    },
    handoff: {
      envelopeId: handoffDeliveryState.envelopeId,
      status: handoffDeliveryState.status,
      ready: handoffDeliveryState.ready,
      channel: handoffDeliveryState.channel,
      destination: handoffDeliveryState.destination,
      ackTopic: handoffDeliveryState.ackTopic,
      resumeToken: handoffDeliveryState.resumeToken,
      blockedReasons: handoffDeliveryState.blockedReasons
    },
    commands: {
      current: {
        type: command.type,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt
      },
      accept: {
        type: 'accept',
        enabled: canSubmitAccept,
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:accept`
      },
      commit: {
        type: 'commit',
        enabled: canSubmitCommit,
        idempotencyKey: `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:commit`
      },
      next: firstStep
        ? {
            stepId: firstStep.id,
            action: firstStep.action,
            enabled: firstStep.enabled,
            reason: firstStep.reason
          }
        : null
    },
    persistedStateShape: {
      snapshotType: 'memory.writeback.acceptance-resume-state.v1',
      snapshotId,
      stateKey: persistedState.stateKey,
      writeToken: persistedState.writeToken,
      generation: persistedState.generation,
      phase: restartSafeStatus.phaseAfterCommand,
      cursor: syncMetadata.nextCursor,
      accepted,
      acceptedAt,
      status,
      route: routeBase,
      checkpointToken: clientStateCheckpoint.checkpointToken,
      pendingCommandType: accepted ? 'commit' : canSubmitAccept ? 'accept' : command.type,
      pendingIdempotencyKey: accepted
        ? `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:commit`
        : canSubmitAccept
          ? `${clientRuntime.clientRequestId}:${syncMetadata.batchId}:accept`
          : command.idempotencyKey,
      resumeToken: handoffDeliveryState.resumeToken,
      blockingReasons: [...new Set(acceptBlockedReasons)]
    },
    restartSemantics: {
      restartSafe: persistedState.recoverable && !clientStateCheckpoint.refreshRequired,
      duplicateAcceptBehavior: accepted ? 'skip-already-accepted' : 'resubmit-with-same-idempotency-key',
      duplicateCommitBehavior: restartSafeStatus.replaySafe ? 'return-cached-result' : 'commit-once-after-acceptance',
      refreshRequired: clientStateCheckpoint.refreshRequired,
      refreshReasons: clientStateCheckpoint.staleReasons,
      recoveryStatus: persistedState.recoveryStatus,
      restartSafeStatus: restartSafeStatus.status
    }
  };
}

function normalizeReportedFailures(input = {}, now) {
  const health = asObject(input.operationalHealth);
  const failures = [
    ...(Array.isArray(input.failures) ? input.failures : []),
    ...(Array.isArray(health.failures) ? health.failures : [])
  ];

  return failures
    .map((entry, index) => {
      const item = asObject(entry);
      const source = VALID_FAILURE_SOURCES.has(item.source) ? item.source : 'unknown';
      const code = asString(item.code, asString(item.reason, `reported-failure-${index + 1}`));
      const message = asString(item.message, asString(item.detail, code));

      return {
        code,
        message,
        source,
        retryable: item.retryable === false ? false : true,
        observedAt: asString(item.observedAt, asString(item.timestamp, now)),
        attempt: Number.isInteger(item.attempt) && item.attempt >= 0 ? item.attempt : 0
      };
    })
    .filter((failure) => failure.code);
}

function buildOperationalHealth({
  input,
  now,
  readiness,
  serviceContract,
  externalHandoff,
  persistedState,
  restartSafeStatus,
  tenantBoundary,
  lifecycleSettings,
  syncMetadata,
  nextSteps
}) {
  const health = asObject(input.operationalHealth);
  const reportedFailures = normalizeReportedFailures(input, now);
  const explicitAttempt = Number.isInteger(health.attempt) && health.attempt >= 0 ? health.attempt : null;
  const persistedLedger = persistedState.failureLedger || normalizePersistedFailureLedger({}, now);
  const attempt = explicitAttempt ?? Math.max(
    0,
    persistedLedger.maxAttempt,
    ...reportedFailures.map((failure) => failure.attempt)
  );
  const maxAttempts = serviceContract.retry.maxAttempts;
  const persistedRetryFailures = persistedLedger.failures
    .filter((failure) => !failure.acknowledged && failure.retryable && !failure.terminal)
    .map((failure) => ({
      code: failure.code,
      message: failure.message,
      source: failure.source,
      retryable: true,
      observedAt: failure.lastObservedAt,
      attempt: failure.attempts,
      persisted: true
    }));
  const persistedTerminalFailures = persistedLedger.failures
    .filter((failure) => !failure.acknowledged && (!failure.retryable || failure.terminal))
    .map((failure) => ({
      code: failure.code,
      message: failure.message,
      source: failure.source,
      retryable: false,
      observedAt: failure.lastObservedAt,
      attempt: failure.attempts,
      persisted: true
    }));
  const observedFailures = [...persistedRetryFailures, ...persistedTerminalFailures, ...reportedFailures];
  const missingCapabilities = [
    ...serviceContract.ack.missingCapabilities,
    ...readiness.checks
      .filter((check) => check.id === 'provider-capabilities' && !check.pass)
      .flatMap(() => serviceContract.ack.requiredCapabilities.filter((capability) => !serviceContract.ack.acknowledgedCapabilities.includes(capability)))
  ];
  const uniqueMissingCapabilities = [...new Set(missingCapabilities)];
  const terminalReasons = [
    ...uniqueMissingCapabilities.map((capability) => `terminal-missing-capability:${capability}`),
    ...(!tenantBoundary.allowed ? tenantBoundary.boundaryViolations.map((violation) => `terminal-boundary:${violation}`) : []),
    ...(!persistedState.recoverable ? ['terminal-persisted-state-mismatch'] : []),
    ...(!lifecycleSettings.enabled ? ['terminal-lifecycle-disabled'] : []),
    ...lifecycleSettings.schedule.validationErrors.map((reason) => `terminal-lifecycle-settings:${reason}`),
    ...(persistedLedger.terminalCodes.map((code) => `terminal-persisted:${code}`)),
    ...(reportedFailures.filter((failure) => !failure.retryable).map((failure) => `terminal-reported:${failure.code}`))
  ];
  const transientReasons = [
    ...(externalHandoff.state === 'blocked' && !uniqueMissingCapabilities.length ? ['external-handoff-blocked'] : []),
    ...(!serviceContract.ready && !uniqueMissingCapabilities.length ? serviceContract.blockedReasons : []),
    ...(lifecycleSettings.enabled && !lifecycleSettings.ready && !lifecycleSettings.schedule.validationErrors.length ? lifecycleSettings.blockedReasons : []),
    ...(restartSafeStatus.blockedReasons.filter((reason) => !terminalReasons.some((terminal) => terminal.includes(reason)))),
    ...(persistedLedger.quarantined ? [`persisted-health-quarantine:${persistedLedger.quarantineUntil}`] : []),
    ...(persistedLedger.retryableCodes.map((code) => `persisted-retryable:${code}`)),
    ...(reportedFailures.filter((failure) => failure.retryable).map((failure) => `reported:${failure.code}`))
  ];
  const exhaustedRetries = transientReasons.length > 0 && attempt >= maxAttempts;
  const retryable = transientReasons.length > 0 && terminalReasons.length === 0 && !exhaustedRetries;
  const operationallyClean = readiness.ready && terminalReasons.length === 0 && transientReasons.length === 0;
  const degradedMode = operationallyClean
    ? 'normal'
    : terminalReasons.length || exhaustedRetries
      ? 'blocked'
      : syncMetadata.durability === 'ephemeral'
        ? 'preview-only'
        : 'retrying-writeback';
  const state = operationallyClean
    ? 'healthy'
    : terminalReasons.length || exhaustedRetries
      ? 'failed'
      : retryable
        ? 'retrying'
        : 'degraded';
  const normalizedState = VALID_HEALTH_STATES.has(state) ? state : 'degraded';
  const retryDelayMs = retryable
    ? Math.min(serviceContract.retry.backoffMs * (2 ** Math.min(attempt, 5)), 300000)
    : null;
  const retryWindow = retryable
    ? {
      scheduledAt: new Date((asTimeMs(now) ?? Date.now()) + retryDelayMs).toISOString(),
      backoffMs: serviceContract.retry.backoffMs,
      computedDelayMs: retryDelayMs,
      attempt: attempt + 1,
      maxAttempts,
      cursor: serviceContract.retry.retryAfterCursor,
      resumeAction: persistedLedger.quarantined
        ? 'memory.writeback.health.wait-quarantine'
        : 'memory.writeback.health.retry'
    }
    : null;
  const actionableErrors = readiness.checks
    .filter((check) => !check.pass)
    .map((check) => {
      const step = nextSteps.find((candidate) => candidate.id === `resolve-${check.id}`);

      return {
        code: `memory.writeback.${check.id}.failed`,
        message: check.detail,
        source: check.id === 'tenant-permission-boundary'
          ? 'tenant-boundary'
          : check.id === 'lifecycle-settings'
            ? 'operator'
          : check.id === 'service-contract'
            ? 'service-contract'
            : check.id === 'external-handoff'
              ? 'handoff'
              : check.id === 'provider-capabilities'
                ? 'provider'
                : 'operator',
        retryable: retryable && !terminalReasons.some((reason) => reason.includes(check.id)),
        nextStepId: step ? step.id : `resolve-${check.id}`,
        action: step ? step.action : `memory.writeback.resolve.${check.id}`
      };
    });
  const persistedFailureErrors = observedFailures
    .filter((failure) => failure.persisted || !failure.retryable)
    .map((failure) => ({
      code: `memory.writeback.failure.${failure.code}`,
      message: failure.message,
      source: failure.source,
      retryable: retryable && failure.retryable,
      nextStepId: failure.retryable ? 'retry-persisted-failure' : 'escalate-terminal-failure',
      action: failure.retryable
        ? 'memory.writeback.health.retry'
        : 'memory.writeback.health.escalate',
      observedAt: failure.observedAt,
      attempt: failure.attempt,
      persisted: Boolean(failure.persisted)
    }));

  return {
    schemaVersion: 1,
    state: normalizedState,
    degradedMode,
    retryable,
    operationallyClean,
    attempt,
    maxAttempts,
    exhaustedRetries,
    retryAfterMs: retryDelayMs,
    retryAfterCursor: retryable ? serviceContract.retry.retryAfterCursor : null,
    retryWindow,
    failureState: terminalReasons.length || exhaustedRetries ? 'terminal' : transientReasons.length ? 'transient' : 'none',
    terminalReasons,
    transientReasons: [...new Set(transientReasons)],
    persistedFailureLedger: {
      state: persistedLedger.state,
      openFailureCount: persistedLedger.openFailureCount,
      retryableFailureCount: persistedLedger.retryableFailureCount,
      terminalFailureCount: persistedLedger.terminalFailureCount,
      lastFailureAt: persistedLedger.lastFailureAt,
      quarantined: persistedLedger.quarantined,
      quarantineUntil: persistedLedger.quarantineUntil
    },
    reportedFailures,
    observedFailures,
    actionableErrors: [...actionableErrors, ...persistedFailureErrors],
    operatorMessage: actionableErrors.length
      ? actionableErrors[0].message
      : persistedFailureErrors.length
        ? persistedFailureErrors[0].message
      : operationallyClean
        ? `Writeback ${syncMetadata.batchId} is healthy.`
        : `Writeback ${syncMetadata.batchId} is waiting for operational recovery.`
  };
}

function normalizeHistorySnapshots(input = {}, currentSnapshot) {
  const analytics = asObject(input.analytics);
  const persisted = asObject(input.persistedState);
  const candidates = [
    ...(Array.isArray(input.history) ? input.history : []),
    ...(Array.isArray(analytics.history) ? analytics.history : []),
    ...(Array.isArray(persisted.history) ? persisted.history : [])
  ];
  const snapshots = candidates
    .map((entry, index) => {
      const item = asObject(entry);
      const batchId = asString(item.batchId, asString(item.syncBatchId, null));
      const observedAt = asString(item.observedAt, asString(item.generatedAt, asString(item.timestamp, null)));
      if (!batchId || !observedAt) return null;

      return {
        sequence: Number.isInteger(item.sequence) && item.sequence >= 0 ? item.sequence : index + 1,
        observedAt,
        batchId,
        cursor: asString(item.cursor, asString(item.syncCursor, null)),
        phase: VALID_PERSISTED_PHASES.has(item.phase) ? item.phase : 'new',
        commandType: VALID_WRITEBACK_COMMANDS.has(item.commandType) ? item.commandType : 'inspect',
        acceptanceDecision: VALID_ACCEPTANCE.has(item.acceptanceDecision) ? item.acceptanceDecision : 'pending',
        dirtyRecordCount: Number.isInteger(item.dirtyRecordCount) && item.dirtyRecordCount >= 0 ? item.dirtyRecordCount : 0,
        previewRecordCount: Number.isInteger(item.previewRecordCount) && item.previewRecordCount >= 0 ? item.previewRecordCount : 0,
        byteSize: Number.isInteger(item.byteSize) && item.byteSize >= 0 ? item.byteSize : 0,
        ready: Boolean(item.ready),
        blocked: Boolean(item.blocked),
        restartSafeStatus: asString(item.restartSafeStatus, null),
        workflowStatus: asString(item.workflowStatus, null),
        providerMode: asString(item.providerMode, null)
      };
    })
    .filter(Boolean);

  return [...snapshots, { ...currentSnapshot, sequence: snapshots.length + 1 }];
}

function buildAnalyticsCounters({ historySnapshots, readiness, syncMetadata, preview, acceptance, persistedState, restartSafeStatus }) {
  const totals = historySnapshots.reduce((accumulator, snapshot) => {
    accumulator.dirtyRecords += snapshot.dirtyRecordCount;
    accumulator.previewRecords += snapshot.previewRecordCount;
    accumulator.bytes += snapshot.byteSize;
    if (snapshot.ready) accumulator.readyBatches += 1;
    if (snapshot.blocked) accumulator.blockedBatches += 1;
    if (snapshot.acceptanceDecision === 'accepted') accumulator.acceptedBatches += 1;
    if (snapshot.acceptanceDecision === 'rejected') accumulator.rejectedBatches += 1;
    return accumulator;
  }, {
    dirtyRecords: 0,
    previewRecords: 0,
    bytes: 0,
    readyBatches: 0,
    blockedBatches: 0,
    acceptedBatches: 0,
    rejectedBatches: 0
  });
  const commandCounts = historySnapshots.reduce((accumulator, snapshot) => ({
    ...accumulator,
    [snapshot.commandType]: (accumulator[snapshot.commandType] || 0) + 1
  }), {});
  const latestBlocked = readiness.failed.length + acceptance.blockedReasons.length + restartSafeStatus.blockedReasons.length;

  return {
    schemaVersion: 1,
    observedBatchCount: historySnapshots.length,
    currentDirtyRecordCount: syncMetadata.dirtyRecordCount,
    currentPreviewRecordCount: preview.shownRecordCount,
    historicalDirtyRecordCount: totals.dirtyRecords,
    historicalPreviewRecordCount: totals.previewRecords,
    historicalByteSize: totals.bytes,
    readyBatchCount: totals.readyBatches,
    blockedBatchCount: totals.blockedBatches,
    acceptedBatchCount: totals.acceptedBatches,
    rejectedBatchCount: totals.rejectedBatches,
    commandCounts,
    currentIssueCount: readiness.failed.length,
    currentBlockedReasonCount: latestBlocked,
    restartRecoveryCount: persistedState.recovered ? 1 : 0,
    idempotentReplayCount: restartSafeStatus.replaySafe ? 1 : 0,
    persistRequiredCount: restartSafeStatus.shouldPersist ? 1 : 0
  };
}

function buildTimelineReport({ historySnapshots, analyticsCounters, clientRuntime, syncMetadata, workflowHandoff, restartSafeStatus }) {
  const timeline = historySnapshots.map((snapshot) => ({
    id: `${snapshot.batchId}:${snapshot.sequence}`,
    occurredAt: snapshot.observedAt,
    batchId: snapshot.batchId,
    cursor: snapshot.cursor,
    phase: snapshot.phase,
    commandType: snapshot.commandType,
    status: snapshot.blocked
      ? 'blocked'
      : snapshot.ready
        ? 'ready'
        : 'needs-review',
    dirtyRecordCount: snapshot.dirtyRecordCount,
    previewRecordCount: snapshot.previewRecordCount,
    workflowStatus: snapshot.workflowStatus
  }));
  const latest = timeline[timeline.length - 1] || null;

  return {
    schemaVersion: 1,
    reportType: 'memory.writeback.timeline',
    exportId: `${clientRuntime.requestId}:${syncMetadata.batchId}:writeback-report`,
    generatedFor: clientRuntime.surface,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    status: workflowHandoff.status,
    restartSafeStatus: restartSafeStatus.status,
    latestEventId: latest ? latest.id : null,
    timeline,
    summary: {
      observedBatchCount: analyticsCounters.observedBatchCount,
      dirtyRecordCount: analyticsCounters.historicalDirtyRecordCount,
      previewRecordCount: analyticsCounters.historicalPreviewRecordCount,
      blockedBatchCount: analyticsCounters.blockedBatchCount,
      readyBatchCount: analyticsCounters.readyBatchCount
    }
  };
}

function buildExportSummary({ analyticsCounters, timelineReport, validationSummary, auditProof, serviceContract, handoffDeliveryState, tenantBoundary, operationalHealth, lifecycleSettings, commitPlan, providerReceiptSettlement, externalDispatchAssurance, preview, persistedStateRecovery, mailchimpWritebackContext, mailchimpCampaignDispatchGuard }) {
  return {
    schemaVersion: 1,
    exportType: 'memory.writeback.analytics-summary',
    exportId: timelineReport.exportId,
    generatedAt: auditProof.generatedAt,
    proofType: auditProof.proofType,
    validationSeverity: validationSummary.severity,
    ready: validationSummary.valid,
    counters: analyticsCounters,
    latestTimelineEventId: timelineReport.latestEventId,
    recommendedNextStepIds: validationSummary.issues.map((issue) => issue.nextStepId),
    providerContract: {
      contractId: serviceContract.contractId,
      protocol: serviceContract.protocol,
      status: serviceContract.status,
      deliverySemantics: serviceContract.deliverySemantics,
      ackDeadlineMs: serviceContract.ack.deadlineMs,
      retryMaxAttempts: serviceContract.retry.maxAttempts,
      missingAckCapabilities: serviceContract.ack.missingCapabilities
    },
    handoffDelivery: {
      envelopeId: handoffDeliveryState.envelopeId,
      status: handoffDeliveryState.status,
      ready: handoffDeliveryState.ready,
      required: handoffDeliveryState.required,
      channel: handoffDeliveryState.channel,
      destination: handoffDeliveryState.destination,
      ackTopic: handoffDeliveryState.ackTopic,
      leaseState: handoffDeliveryState.lease.state,
      leaseActive: handoffDeliveryState.lease.active,
      blockedReasons: handoffDeliveryState.blockedReasons
    },
    mailchimpWritebackContext: {
      contractType: mailchimpWritebackContext.contractType,
      applies: mailchimpWritebackContext.applies,
      stage: mailchimpWritebackContext.stage,
      campaignId: mailchimpWritebackContext.campaignId,
      audienceId: mailchimpWritebackContext.audienceId,
      segmentId: mailchimpWritebackContext.segmentId,
      stateKey: mailchimpWritebackContext.stateKey,
      readyForExternalDispatch: mailchimpWritebackContext.readyForExternalDispatch,
      replayKey: mailchimpWritebackContext.replayProtection.replayKey,
      blockedReasons: mailchimpWritebackContext.blockedReasons,
      proof: mailchimpWritebackContext.proof
    },
    mailchimpCampaignDispatchGuard: {
      contractType: mailchimpCampaignDispatchGuard.contractType,
      applies: mailchimpCampaignDispatchGuard.applies,
      status: mailchimpCampaignDispatchGuard.status,
      ready: mailchimpCampaignDispatchGuard.ready,
      nextAction: mailchimpCampaignDispatchGuard.nextAction,
      approvalRequestId: mailchimpCampaignDispatchGuard.approval.requestId,
      approved: mailchimpCampaignDispatchGuard.approval.approved,
      workflowAccepted: mailchimpCampaignDispatchGuard.approval.workflowAccepted,
      receiptSettlementStatus: mailchimpCampaignDispatchGuard.receiptSettlement.status,
      receiptSettlementAccepted: mailchimpCampaignDispatchGuard.receiptSettlement.accepted,
      dispatchEnvelopeId: mailchimpCampaignDispatchGuard.dispatchEnvelope
        ? mailchimpCampaignDispatchGuard.dispatchEnvelope.envelopeId
        : null,
      blockedReasons: mailchimpCampaignDispatchGuard.blockedReasons,
      proof: mailchimpCampaignDispatchGuard.proof
    },
    operationalHealth: {
      state: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      failureState: operationalHealth.failureState,
      retryable: operationalHealth.retryable,
      retryAfterMs: operationalHealth.retryAfterMs,
      retryWindow: operationalHealth.retryWindow,
      exhaustedRetries: operationalHealth.exhaustedRetries,
      persistedFailureLedger: operationalHealth.persistedFailureLedger,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      ready: lifecycleSettings.ready,
      settingsCommandContractId: lifecycleSettings.settingsCommand.contractId,
      settingsCommandStatus: lifecycleSettings.settingsCommand.commandResult.status,
      settingsCommandApplied: lifecycleSettings.settingsCommand.commandResult.applied,
      nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
      nextActionState: lifecycleSettings.nextActionState,
      scheduleMode: lifecycleSettings.schedule.mode,
      scheduledFor: lifecycleSettings.schedule.scheduledFor,
      validationErrors: lifecycleSettings.schedule.validationErrors,
      blockedReasons: lifecycleSettings.blockedReasons
    },
    commitPlan: {
      planId: commitPlan.planId,
      status: commitPlan.status,
      ready: commitPlan.ready,
      dryRun: commitPlan.dryRun,
      mutationCount: commitPlan.mutationCount,
      estimatedByteSize: commitPlan.estimatedByteSize,
      receiptRequired: commitPlan.receiptExpectation.required,
      blockedReasons: commitPlan.blockedReasons
    },
    providerReceiptSettlement: {
      contractType: providerReceiptSettlement.contractType,
      settlementId: providerReceiptSettlement.settlementId,
      status: providerReceiptSettlement.status,
      accepted: providerReceiptSettlement.accepted,
      required: providerReceiptSettlement.required,
      receiptId: providerReceiptSettlement.receiptId,
      expectedReceiptId: providerReceiptSettlement.expectedReceiptId,
      receiptState: providerReceiptSettlement.receiptState,
      deadlineExpiresAt: providerReceiptSettlement.deadlineExpiresAt,
      proofRequired: providerReceiptSettlement.proofRequired,
      proofHashPresent: Boolean(providerReceiptSettlement.proofHash),
      validationErrors: providerReceiptSettlement.validationErrors,
      nextHandoffState: providerReceiptSettlement.externalHandoffPatch.state,
      lastSettledCursor: providerReceiptSettlement.syncCursorPatch.lastSettledCursor,
      pendingCursor: providerReceiptSettlement.syncCursorPatch.pendingCursor
    },
    externalDispatchAssurance: {
      contractType: externalDispatchAssurance.contractType,
      assuranceId: externalDispatchAssurance.assuranceId,
      status: externalDispatchAssurance.status,
      ready: externalDispatchAssurance.ready,
      providerId: externalDispatchAssurance.providerId,
      handoffEnvelopeId: externalDispatchAssurance.handoffEnvelopeId,
      receiptSettlementId: externalDispatchAssurance.receiptSettlementId,
      expectedReceiptId: externalDispatchAssurance.expectedReceiptId,
      receiptProofPresent: Boolean(externalDispatchAssurance.receiptProof),
      settlementRequired: externalDispatchAssurance.settlementRequired,
      receiptAccepted: externalDispatchAssurance.receiptAccepted,
      replayKey: externalDispatchAssurance.replayProtection.replayKey,
      blockedReasons: externalDispatchAssurance.blockedReasons,
      nextAction: externalDispatchAssurance.nextAction
    },
    persistedStateRecovery: {
      contractType: persistedStateRecovery.contractType,
      status: persistedStateRecovery.status,
      replaySafe: persistedStateRecovery.replaySafe,
      shouldPersist: persistedStateRecovery.shouldPersist,
      nextPhase: persistedStateRecovery.nextPersistedState.phase,
      nextGeneration: persistedStateRecovery.nextPersistedState.generation,
      commandReceiptStatus: persistedStateRecovery.commandReceipt.status,
      recoveryQueueStatus: persistedStateRecovery.recoveryQueue.status,
      recoveryOpenOperationCount: persistedStateRecovery.recoveryQueue.openOperationCount,
      recoveryBlockedOperationCount: persistedStateRecovery.recoveryQueue.blockedOperationCount,
      recoveryNextOperationId: persistedStateRecovery.recoveryQueue.nextOperation
        ? persistedStateRecovery.recoveryQueue.nextOperation.operationId
        : null,
      journalStatus: persistedStateRecovery.persistenceJournal.status,
      journalId: persistedStateRecovery.persistenceJournal.journalId,
      durableWriteKey: persistedStateRecovery.persistenceJournal.durableWriteKey,
      journalAppendRequired: persistedStateRecovery.persistenceJournal.appendRequired,
      journalReplayHit: persistedStateRecovery.persistenceJournal.replayHit,
      journalOpenEntryCount: persistedStateRecovery.persistenceJournal.openEntryCount,
      recoveryActions: persistedStateRecovery.recoveryActions
    },
    tenantBoundary: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      workspaceTenantId: tenantBoundary.workspaceTenantId,
      role: tenantBoundary.role,
      commandType: tenantBoundary.commandType,
      workspaceScopeMode: tenantBoundary.workspaceScopeMode,
      allowed: tenantBoundary.allowed,
      missingPermissions: tenantBoundary.missingPermissions,
      workspaceScopeSatisfied: tenantBoundary.workspaceScopeSatisfied,
      authorizationProofId: tenantBoundary.authorizationProof.proofId,
      authorizationDecision: tenantBoundary.authorizationProof.auditHandoff.decision,
      boundaryViolations: tenantBoundary.boundaryViolations
    },
    previewScope: {
      scopedRecordCount: preview.scope.scopedRecordCount,
      writableRecordCount: preview.scope.writableRecordCount,
      withheldRecordCount: preview.scope.withheldRecordCount,
      recordBoundaryViolations: preview.scope.recordBoundaryViolations
    },
    proofGuarantees: auditProof.guarantees
  };
}

function normalizeAnalyticsReportingOptions(input = {}) {
  const analytics = asObject(input.analytics);
  const reporting = asObject(analytics.reporting);
  const exportOptions = asObject({
    ...asObject(analytics.export),
    ...asObject(input.export)
  });
  const requestedFormat = asString(exportOptions.format, asString(reporting.format, 'json'));
  const requestedWindow = asString(reporting.window, asString(exportOptions.window, 'all'));

  return {
    schemaVersion: 1,
    format: VALID_ANALYTICS_EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : 'json',
    requestedFormat,
    window: VALID_ANALYTICS_REPORT_WINDOWS.has(requestedWindow) ? requestedWindow : 'all',
    requestedWindow,
    includeTimeline: reporting.includeTimeline === false || exportOptions.includeTimeline === false ? false : true,
    includeProof: reporting.includeProof === false || exportOptions.includeProof === false ? false : true,
    includeSnapshots: reporting.includeSnapshots === false || exportOptions.includeSnapshots === false ? false : true,
    destination: asString(exportOptions.destination, asString(reporting.destination, 'hosted-kernel.analytics.writeback')),
    maxSnapshots: Number.isInteger(reporting.maxSnapshots) && reporting.maxSnapshots > 0
      ? Math.min(reporting.maxSnapshots, 128)
      : 64,
    retentionDays: Number.isInteger(reporting.retentionDays) && reporting.retentionDays > 0
      ? Math.min(reporting.retentionDays, 365)
      : 30
  };
}

function buildAnalyticsReportingState({
  input,
  now,
  historySnapshots,
  analyticsCounters,
  timelineReport,
  exportSummary,
  auditProof,
  clientRuntime,
  syncMetadata,
  persistedStateRecovery,
  operationalHealth
}) {
  const options = normalizeAnalyticsReportingOptions(input);
  const nowMs = asTimeMs(now) ?? Date.now();
  const windowCutoffMs = options.window === 'rolling-24h'
    ? nowMs - 86400000
    : options.window === 'rolling-7d'
      ? nowMs - 604800000
      : options.window === 'rolling-30d'
        ? nowMs - 2592000000
        : null;
  const windowedSnapshots = historySnapshots
    .filter((snapshot) => {
      if (options.window === 'current') return snapshot.batchId === syncMetadata.batchId && snapshot.cursor === syncMetadata.nextCursor;
      if (windowCutoffMs === null) return true;
      const observedAtMs = asTimeMs(snapshot.observedAt);
      return observedAtMs === null || observedAtMs >= windowCutoffMs;
    })
    .slice(-options.maxSnapshots);
  const snapshotRows = options.includeSnapshots
    ? windowedSnapshots.map((snapshot) => ({
      rowId: `${snapshot.batchId}:${snapshot.sequence}`,
      observedAt: snapshot.observedAt,
      batchId: snapshot.batchId,
      cursor: snapshot.cursor,
      phase: snapshot.phase,
      commandType: snapshot.commandType,
      acceptanceDecision: snapshot.acceptanceDecision,
      dirtyRecordCount: snapshot.dirtyRecordCount,
      previewRecordCount: snapshot.previewRecordCount,
      byteSize: snapshot.byteSize,
      ready: snapshot.ready,
      blocked: snapshot.blocked,
      workflowStatus: snapshot.workflowStatus,
      operationalHealthState: asString(snapshot.operationalHealthState, null)
    }))
    : [];
  const phaseCounts = windowedSnapshots.reduce((accumulator, snapshot) => ({
    ...accumulator,
    [snapshot.phase]: (accumulator[snapshot.phase] || 0) + 1
  }), {});
  const statusCounts = windowedSnapshots.reduce((accumulator, snapshot) => {
    const status = snapshot.blocked ? 'blocked' : snapshot.ready ? 'ready' : 'needs-review';
    return {
      ...accumulator,
      [status]: (accumulator[status] || 0) + 1
    };
  }, {});
  const firstSnapshot = windowedSnapshots[0] || null;
  const lastSnapshot = windowedSnapshots[windowedSnapshots.length - 1] || null;
  const basePath = `${options.destination}/${clientRuntime.surface}/${syncMetadata.batchId}`;
  const exportFiles = [
    {
      role: 'summary',
      contentType: 'application/vnd.aios.memory-writeback.analytics-summary+json',
      format: 'json',
      path: `${basePath}/summary.json`,
      included: true,
      recordCount: 1
    },
    {
      role: 'timeline',
      contentType: options.format === 'csv'
        ? 'text/csv'
        : 'application/vnd.aios.memory-writeback.timeline+json',
      format: options.format === 'csv' ? 'csv' : options.format,
      path: `${basePath}/timeline.${options.format === 'csv' ? 'csv' : 'json'}`,
      included: options.includeTimeline,
      recordCount: options.includeTimeline ? timelineReport.timeline.length : 0
    },
    {
      role: 'history-snapshots',
      contentType: options.format === 'jsonl'
        ? 'application/x-ndjson'
        : 'application/vnd.aios.memory-writeback.history-snapshots+json',
      format: options.format === 'jsonl' ? 'jsonl' : 'json',
      path: `${basePath}/history.${options.format === 'jsonl' ? 'jsonl' : 'json'}`,
      included: options.includeSnapshots,
      recordCount: snapshotRows.length
    },
    {
      role: 'audit-proof',
      contentType: 'application/vnd.aios.memory-writeback.audit-proof+json',
      format: 'json',
      path: `${basePath}/audit-proof.json`,
      included: options.includeProof,
      recordCount: options.includeProof ? 1 : 0
    }
  ];
  const invalidOptionReasons = [
    ...(!VALID_ANALYTICS_EXPORT_FORMATS.has(options.requestedFormat) ? [`invalid-export-format:${options.requestedFormat}`] : []),
    ...(!VALID_ANALYTICS_REPORT_WINDOWS.has(options.requestedWindow) ? [`invalid-report-window:${options.requestedWindow}`] : []),
    ...(options.format === 'parquet-manifest' && !options.includeSnapshots ? ['parquet-manifest-requires-snapshots'] : [])
  ];
  const ready = invalidOptionReasons.length === 0 && exportFiles.some((file) => file.included);

  return {
    schemaVersion: 1,
    reportType: 'memory.writeback.analytics-reporting-state.v1',
    reportId: `${timelineReport.exportId}:reporting-state`,
    generatedAt: now,
    ready,
    status: ready ? 'export-ready' : 'export-blocked',
    options,
    invalidOptionReasons,
    watermarks: {
      firstObservedAt: firstSnapshot ? firstSnapshot.observedAt : null,
      lastObservedAt: lastSnapshot ? lastSnapshot.observedAt : null,
      lastBatchId: lastSnapshot ? lastSnapshot.batchId : syncMetadata.batchId,
      lastCursor: lastSnapshot ? lastSnapshot.cursor : syncMetadata.nextCursor,
      nextResumeToken: `${clientRuntime.correlationKey}:${syncMetadata.nextCursor}:analytics-export`
    },
    rollups: {
      window: options.window,
      snapshotCount: windowedSnapshots.length,
      phaseCounts,
      statusCounts,
      dirtyRecordCount: windowedSnapshots.reduce((total, snapshot) => total + snapshot.dirtyRecordCount, 0),
      previewRecordCount: windowedSnapshots.reduce((total, snapshot) => total + snapshot.previewRecordCount, 0),
      byteSize: windowedSnapshots.reduce((total, snapshot) => total + snapshot.byteSize, 0),
      persistedRecoveryOpenOperationCount: persistedStateRecovery.recoveryQueue.openOperationCount,
      persistedRecoveryBlockedOperationCount: persistedStateRecovery.recoveryQueue.blockedOperationCount,
      operationalFailureState: operationalHealth.failureState
    },
    exportManifest: {
      manifestType: 'memory.writeback.analytics-export-manifest.v1',
      exportId: exportSummary.exportId,
      destination: options.destination,
      format: options.format,
      fileCount: exportFiles.filter((file) => file.included).length,
      files: exportFiles,
      counters: {
        observedBatchCount: analyticsCounters.observedBatchCount,
        blockedBatchCount: analyticsCounters.blockedBatchCount,
        readyBatchCount: analyticsCounters.readyBatchCount,
        acceptedBatchCount: analyticsCounters.acceptedBatchCount,
        rejectedBatchCount: analyticsCounters.rejectedBatchCount
      },
      proofId: options.includeProof ? `${auditProof.syncBatchId}:${auditProof.idempotencyKey}:analytics-proof` : null
    },
    snapshotRows
  };
}

function buildAuditProof({ now, provider, negotiation, syncMetadata, handoff, serviceContract, handoffDeliveryState, clientRuntime, workflowHandoff, persistedState, restartSafeStatus, persistedStateRecovery, tenantBoundary, lifecycleSettings, operationalHealth, commitPlan, providerReceiptSettlement, externalDispatchAssurance, preview, mailchimpWritebackContext, mailchimpCampaignDispatchGuard }) {
  return {
    proofType: 'hosted-kernel-memory-writeback-policy',
    generatedAt: now,
    providerId: provider.id,
    providerMode: negotiation.mode,
    serviceContractId: serviceContract.contractId,
    serviceProtocol: serviceContract.protocol,
    serviceContractStatus: serviceContract.status,
    handoffEnvelopeId: handoffDeliveryState.envelopeId,
    handoffDeliveryStatus: handoffDeliveryState.status,
    handoffDeliveryChannel: handoffDeliveryState.channel,
    handoffAckTopic: handoffDeliveryState.ackTopic,
    syncBatchId: syncMetadata.batchId,
    syncCursor: syncMetadata.nextCursor,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    traceId: clientRuntime.traceId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    auditSubject: tenantBoundary.auditSubject,
    authorizationProofId: tenantBoundary.authorizationProof.proofId,
    authorizationDecision: tenantBoundary.authorizationProof.auditHandoff.decision,
    authorizationWorkspaceScopeMode: tenantBoundary.authorizationProof.workspaceScopeMode,
    authorizationDeniedReasons: tenantBoundary.authorizationProof.deniedReasons,
    externalHandoffState: handoff.state,
    workflowStatus: workflowHandoff.status,
    persistedStateKey: persistedState.stateKey,
    recoveryStatus: persistedState.recoveryStatus,
    restartSafeStatus: restartSafeStatus.status,
    persistedStateRecoveryStatus: persistedStateRecovery.status,
    nextPersistedStatePhase: persistedStateRecovery.nextPersistedState.phase,
    nextPersistedStateGeneration: persistedStateRecovery.nextPersistedState.generation,
    persistenceJournalStatus: persistedStateRecovery.persistenceJournal.status,
    persistenceJournalId: persistedStateRecovery.persistenceJournal.journalId,
    persistenceDurableWriteKey: persistedStateRecovery.persistenceJournal.durableWriteKey,
    persistenceJournalOpenEntryCount: persistedStateRecovery.persistenceJournal.openEntryCount,
    nextRecoveryQueueStatus: persistedStateRecovery.recoveryQueue.status,
    nextRecoveryOpenOperationCount: persistedStateRecovery.recoveryQueue.openOperationCount,
    lifecycleMode: lifecycleSettings.mode,
    lifecycleEnabled: lifecycleSettings.enabled,
    lifecycleSettingsCommandContractId: lifecycleSettings.settingsCommand.contractId,
    lifecycleSettingsCommandStatus: lifecycleSettings.settingsCommand.commandResult.status,
    lifecycleNextActionState: lifecycleSettings.nextActionState.state,
    lifecycleScheduleMode: lifecycleSettings.schedule.mode,
    lifecycleScheduledFor: lifecycleSettings.schedule.scheduledFor,
    operationalHealthState: operationalHealth.state,
    operationalFailureState: operationalHealth.failureState,
    operationalDegradedMode: operationalHealth.degradedMode,
    operationalRetryScheduledAt: operationalHealth.retryWindow ? operationalHealth.retryWindow.scheduledAt : null,
    operationalPersistedFailureState: operationalHealth.persistedFailureLedger.state,
    operationalOpenFailureCount: operationalHealth.persistedFailureLedger.openFailureCount,
    commitPlanId: commitPlan.planId,
    commitPlanStatus: commitPlan.status,
    commitMutationCount: commitPlan.mutationCount,
    providerReceiptSettlementId: providerReceiptSettlement.settlementId,
    providerReceiptSettlementStatus: providerReceiptSettlement.status,
    providerReceiptAccepted: providerReceiptSettlement.accepted,
    providerReceiptState: providerReceiptSettlement.receiptState,
    providerReceiptDeadlineExpiresAt: providerReceiptSettlement.deadlineExpiresAt,
    providerReceiptValidationErrors: providerReceiptSettlement.validationErrors,
    externalDispatchAssuranceId: externalDispatchAssurance.assuranceId,
    externalDispatchAssuranceStatus: externalDispatchAssurance.status,
    externalDispatchReady: externalDispatchAssurance.ready,
    externalDispatchNextAction: externalDispatchAssurance.nextAction,
    externalDispatchBlockedReasons: externalDispatchAssurance.blockedReasons,
    mailchimpCampaignContextApplies: mailchimpWritebackContext.applies,
    mailchimpCampaignStateKey: mailchimpWritebackContext.stateKey,
    mailchimpCampaignReadyForDispatch: mailchimpWritebackContext.readyForExternalDispatch,
    mailchimpCampaignBlockedReasons: mailchimpWritebackContext.blockedReasons,
    mailchimpCampaignProof: mailchimpWritebackContext.proof,
    mailchimpDispatchGuardStatus: mailchimpCampaignDispatchGuard.status,
    mailchimpDispatchGuardReady: mailchimpCampaignDispatchGuard.ready,
    mailchimpDispatchGuardNextAction: mailchimpCampaignDispatchGuard.nextAction,
    mailchimpDispatchGuardBlockedReasons: mailchimpCampaignDispatchGuard.blockedReasons,
    mailchimpDispatchGuardProof: mailchimpCampaignDispatchGuard.proof,
    idempotencyKey: restartSafeStatus.idempotencyKey,
    guarantees: {
      atomicCommit: negotiation.accepted.includes(WRITEBACK_CAPABILITIES.atomicCommit),
      proofReceipt: negotiation.accepted.includes(WRITEBACK_CAPABILITIES.proofReceipt),
      cursorContinuity: negotiation.accepted.includes(WRITEBACK_CAPABILITIES.syncCursor),
      handoffResumable: handoff.resumable,
      handoffEnvelopeReady: handoffDeliveryState.ready,
      handoffLeaseActive: handoffDeliveryState.lease.active,
      handoffPayloadScoped: handoffDeliveryState.payload.tenantId === tenantBoundary.tenantId
        && handoffDeliveryState.payload.workspaceId === tenantBoundary.workspaceId,
      providerServiceReady: serviceContract.ready,
      tenantBoundaryAllowed: tenantBoundary.allowed,
      tenantAllowed: tenantBoundary.tenantAllowed,
      workspaceAllowed: tenantBoundary.workspaceAllowed,
      workspaceBelongsToTenant: tenantBoundary.workspaceBelongsToTenant,
      workspaceScopeSatisfied: tenantBoundary.workspaceScopeSatisfied,
      authorizationProofIssued: tenantBoundary.authorizationProof.proofType === 'memory.writeback.authorization-proof.v1',
      authorizationDecisionAllowsBoundary: tenantBoundary.authorizationProof.auditHandoff.decision === (tenantBoundary.allowed ? 'allow' : 'deny'),
      commandPermissionsSatisfied: tenantBoundary.missingPermissions.length === 0,
      previewRecordsScoped: preview.withheldRecordCount === 0,
      previewRecordsWritable: preview.records.every((record) => record.writable),
      withheldPreviewRecordCount: preview.withheldRecordCount,
      persistedStateScoped: !tenantBoundary.boundaryViolations.includes('persisted-state-tenant-mismatch')
        && !tenantBoundary.boundaryViolations.includes('persisted-state-workspace-mismatch'),
      deliverySemantics: serviceContract.deliverySemantics,
      ackReceiptDeadlineMs: serviceContract.ack.deadlineMs,
      clientStateCorrelated: Boolean(clientRuntime.stateKey && clientRuntime.correlationKey),
      clientCheckpointFresh: !workflowHandoff.clientState.refreshRequired,
      clientCheckpointStateMatches: workflowHandoff.clientState.continuationPatch.client.state.stateKey === clientRuntime.stateKey,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleReady: lifecycleSettings.ready,
      lifecycleScheduleReady: lifecycleSettings.schedule.ready,
      lifecycleSettingsCommandValid: lifecycleSettings.settingsCommand.validation.valid,
      lifecycleControlsIssued: Boolean(lifecycleSettings.controlState.enable && lifecycleSettings.controlState.disable && lifecycleSettings.controlState.schedule),
      lifecycleNextActionDeterministic: lifecycleSettings.nextActionState.action === lifecycleSettings.nextLifecycleAction,
      restartRecoverable: persistedState.recoverable,
      idempotentCommand: restartSafeStatus.replaySafe || restartSafeStatus.shouldPersist,
      recoveryContractIssued: persistedStateRecovery.contractType === 'memory.writeback.persisted-state-recovery.v1',
      recoveryCommandReceiptScoped: persistedStateRecovery.commandReceipt.writeToken === restartSafeStatus.writeToken,
      recoveryNextStateScoped: persistedStateRecovery.nextPersistedState.tenantId === tenantBoundary.tenantId
        && persistedStateRecovery.nextPersistedState.workspaceId === tenantBoundary.workspaceId,
      recoveryActionsDeterministic: persistedStateRecovery.recoveryActions.every((action) => action.startsWith('memory.writeback.recovery.')
        || action === 'memory.writeback.persistence.write-next-state'),
      recoveryQueueDeterministic: persistedStateRecovery.recoveryQueue.operations.every((operation) => operation.operationId
        && operation.action.startsWith('memory.writeback.')
        && VALID_RECOVERY_OPERATION_STATUSES.has(operation.status))
        && persistedStateRecovery.recoveryActions.every((action) => persistedStateRecovery.recoveryQueue.operations.some((operation) => operation.action === action
          && operation.idempotencyKey === restartSafeStatus.idempotencyKey
          && operation.cursor === syncMetadata.nextCursor)),
      recoveryQueuePersistedInNextState: persistedStateRecovery.nextPersistedState.recoveryQueue.operations.length
        === persistedStateRecovery.recoveryQueue.operations.length,
      persistenceJournalIssued: persistedStateRecovery.persistenceJournal.journalType === 'memory.writeback.persistence-journal.v1',
      persistenceJournalScoped: persistedStateRecovery.persistenceJournal.appendRecord.tenantId === tenantBoundary.tenantId
        && persistedStateRecovery.persistenceJournal.appendRecord.workspaceId === tenantBoundary.workspaceId
        && persistedStateRecovery.persistenceJournal.appendRecord.stateKey === persistedState.stateKey,
      persistenceJournalIdempotent: persistedStateRecovery.persistenceJournal.replayHit
        ? persistedStateRecovery.persistenceJournal.replaySourceJournalId !== null
        : persistedStateRecovery.persistenceJournal.appendRecord.idempotencyKey === restartSafeStatus.idempotencyKey,
      persistenceJournalRestartSafe: persistedStateRecovery.persistenceJournal.restartSemantics.statusAfterRestart !== 'restart-blocked'
        || persistedStateRecovery.persistenceJournal.blocked,
      persistenceJournalPersistedInNextState: persistedStateRecovery.nextPersistedState.persistenceJournal.entries.length
        === persistedStateRecovery.persistenceJournal.entries.length,
      commitPlanReady: commitPlan.ready,
      commitPlanScoped: commitPlan.mutationSet.every((mutation) => mutation.expectedTenantId === tenantBoundary.tenantId
        && mutation.expectedWorkspaceId === tenantBoundary.workspaceId
        && mutation.scopeKey.startsWith(`${tenantBoundary.tenantId}:${tenantBoundary.workspaceId}:`)),
      commitReceiptExpected: commitPlan.receiptExpectation.required,
      providerReceiptContractIssued: providerReceiptSettlement.contractType === 'memory.writeback.provider-receipt-settlement.v1',
      providerReceiptMatchesEnvelope: providerReceiptSettlement.envelopeId === handoffDeliveryState.envelopeId,
      providerReceiptMatchesCursor: providerReceiptSettlement.cursor === syncMetadata.nextCursor,
      providerReceiptMatchesCommand: providerReceiptSettlement.idempotencyKey === restartSafeStatus.idempotencyKey,
      providerReceiptScoped: providerReceiptSettlement.tenantId === tenantBoundary.tenantId
        && providerReceiptSettlement.workspaceId === tenantBoundary.workspaceId,
      providerReceiptProofSatisfied: !providerReceiptSettlement.required
        || Boolean(providerReceiptSettlement.proofHash)
        || providerReceiptSettlement.status === 'waiting',
      providerReceiptSettlementAccepted: providerReceiptSettlement.accepted,
      providerReceiptCursorSettled: providerReceiptSettlement.accepted
        ? providerReceiptSettlement.syncCursorPatch.lastSettledCursor === syncMetadata.nextCursor
        : providerReceiptSettlement.syncCursorPatch.pendingCursor === syncMetadata.nextCursor,
      externalDispatchAssuranceIssued: externalDispatchAssurance.contractType === 'memory.writeback.external-dispatch-assurance.v1',
      externalDispatchScoped: externalDispatchAssurance.scope.tenantId === tenantBoundary.tenantId
        && externalDispatchAssurance.scope.workspaceId === tenantBoundary.workspaceId
        && externalDispatchAssurance.scope.cursor === syncMetadata.nextCursor,
      externalDispatchReceiptAligned: externalDispatchAssurance.expectedReceiptId === providerReceiptSettlement.expectedReceiptId
        && externalDispatchAssurance.receiptSettlementId === providerReceiptSettlement.settlementId,
      externalDispatchReplayProtected: externalDispatchAssurance.replayProtection.duplicateSafe
        && externalDispatchAssurance.replayProtection.idempotencyKey === restartSafeStatus.idempotencyKey,
      externalDispatchBlocksUnsettledReceipt: providerReceiptSettlement.accepted
        || externalDispatchAssurance.status !== 'settled',
      retryScheduled: operationalHealth.retryable,
      retryAfterMs: operationalHealth.retryAfterMs,
      retryWindowIssued: operationalHealth.retryWindow === null || operationalHealth.retryWindow.cursor === serviceContract.retry.retryAfterCursor,
      persistedFailureLedgerLoaded: operationalHealth.persistedFailureLedger.state === persistedState.failureLedger.state,
      persistedTerminalFailuresBlockRetry: operationalHealth.persistedFailureLedger.terminalFailureCount === 0 || operationalHealth.failureState === 'terminal',
      quarantinedFailuresDelayRetry: !operationalHealth.persistedFailureLedger.quarantined
        || operationalHealth.transientReasons.some((reason) => reason.startsWith('persisted-health-quarantine:')),
      terminalFailurePreventedCommit: operationalHealth.failureState === 'terminal'
        || (mailchimpWritebackContext.applies && !mailchimpWritebackContext.readyForExternalDispatch),
      mailchimpCampaignScoped: !mailchimpWritebackContext.applies
        || (mailchimpWritebackContext.tenantId === tenantBoundary.tenantId
          && mailchimpWritebackContext.workspaceId === tenantBoundary.workspaceId),
      mailchimpCampaignIdentifiersComplete: !mailchimpWritebackContext.applies
        || mailchimpWritebackContext.missingIdentifiers.length === 0,
      mailchimpCampaignReplayProtected: !mailchimpWritebackContext.applies
        || mailchimpWritebackContext.replayProtection.duplicateSafe,
      mailchimpCampaignHandoffAligned: !mailchimpWritebackContext.applies
        || mailchimpWritebackContext.auditHandoff.envelopeId === handoffDeliveryState.envelopeId,
      mailchimpDispatchGuardIssued: !mailchimpWritebackContext.applies
        || mailchimpCampaignDispatchGuard.contractType === 'memory.writeback.mailchimp-campaign-dispatch-guard.v1',
      mailchimpDispatchGuardBlocksUnsafeDispatch: !mailchimpWritebackContext.applies
        || mailchimpCampaignDispatchGuard.ready
        || mailchimpCampaignDispatchGuard.blockedReasons.length > 0,
      mailchimpDispatchEnvelopeScoped: !mailchimpCampaignDispatchGuard.dispatchEnvelope
        || (mailchimpCampaignDispatchGuard.dispatchEnvelope.campaignId === mailchimpWritebackContext.campaignId
          && mailchimpCampaignDispatchGuard.dispatchEnvelope.audienceId === mailchimpWritebackContext.audienceId
          && mailchimpCampaignDispatchGuard.dispatchEnvelope.cursor === syncMetadata.nextCursor)
    }
  };
}

export function describeWritebackPolicySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const provider = normalizeProvider(input.provider);
  const negotiation = negotiateProvider(provider, input.requestedCapabilities);
  const syncMetadata = normalizeSyncMetadata(input, now);
  const externalHandoff = normalizeExternalHandoff(input, provider, negotiation);
  const serviceContract = normalizeProviderServiceContract(input, provider, negotiation, syncMetadata, externalHandoff);
  const previewBase = normalizePreviewRequest(input, syncMetadata);
  const clientRuntime = normalizeClientRuntime(input, syncMetadata, now);
  const command = normalizeWritebackCommand(input, clientRuntime, syncMetadata);
  const lifecycleSettings = normalizeLifecycleSettings(input, syncMetadata, command, now, clientRuntime);
  const persistedState = normalizePersistedWritebackState(input, clientRuntime, syncMetadata, command, now);
  const clientStateCheckpoint = normalizeClientStateCheckpoint(input, clientRuntime, syncMetadata, command, persistedState);
  const tenantBoundary = normalizeTenantBoundary(input, clientRuntime, command, persistedState);
  const handoffDeliveryState = normalizeHandoffDeliveryState({
    input,
    now,
    syncMetadata,
    externalHandoff,
    serviceContract,
    clientRuntime,
    command,
    tenantBoundary,
    persistedState
  });
  const mailchimpWritebackContext = normalizeMailchimpWritebackContext(
    input,
    syncMetadata,
    clientRuntime,
    tenantBoundary,
    handoffDeliveryState
  );
  const preview = buildWorkspaceScopedPreview(previewBase, tenantBoundary);
  const acceptance = normalizeAcceptance(input, negotiation, syncMetadata, externalHandoff, tenantBoundary, lifecycleSettings);
  const readiness = buildReadiness({ negotiation, syncMetadata, externalHandoff, serviceContract, handoffDeliveryState, acceptance, tenantBoundary, lifecycleSettings, preview });
  const validationSummary = buildValidationSummary(readiness, acceptance, preview);
  const nextSteps = buildNextSteps({ readiness, acceptance, preview, externalHandoff, lifecycleSettings });
  const restartSafeStatus = buildRestartSafeStatus({ persistedState, command, readiness, acceptance });
  const acceptanceResumeSnapshot = buildAcceptanceResumeSnapshot({
    now,
    clientRuntime,
    command,
    syncMetadata,
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState,
    persistedState,
    restartSafeStatus,
    clientStateCheckpoint
  });
  const persistedStateRecovery = buildPersistedStateRecoveryContract({
    now,
    clientRuntime,
    command,
    syncMetadata,
    persistedState,
    restartSafeStatus,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState,
    acceptanceResumeSnapshot
  });
  const operationalHealth = buildOperationalHealth({
    input,
    now,
    readiness,
    serviceContract,
    externalHandoff,
    persistedState,
    restartSafeStatus,
    tenantBoundary,
    lifecycleSettings,
    syncMetadata,
    nextSteps
  });
  const commitPlan = buildHostedKernelCommitPlan({
    now,
    command,
    syncMetadata,
    preview,
    acceptance,
    readiness,
    serviceContract,
    handoffDeliveryState,
    persistedState,
    restartSafeStatus,
    tenantBoundary,
    lifecycleSettings
  });
  const providerReceiptSettlement = buildProviderReceiptSettlementContract({
    input,
    now,
    provider,
    serviceContract,
    handoffDeliveryState,
    command,
    syncMetadata,
    tenantBoundary,
    commitPlan
  });
  const externalDispatchAssurance = buildExternalDispatchAssurance({
    input,
    now,
    provider,
    serviceContract,
    handoffDeliveryState,
    providerReceiptSettlement,
    command,
    syncMetadata,
    tenantBoundary,
    commitPlan
  });
  const mailchimpCampaignDispatchGuard = buildMailchimpCampaignDispatchGuard({
    input,
    now,
    mailchimpWritebackContext,
    acceptance,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState,
    providerReceiptSettlement,
    externalDispatchAssurance,
    command,
    syncMetadata,
    persistedState,
    preview
  });
  const workflowHandoff = buildWorkflowHandoff({
    clientRuntime,
    syncMetadata,
    externalHandoff,
    handoffDeliveryState,
    acceptance,
    validationSummary,
    nextSteps,
    clientStateCheckpoint
  });
  const clientWorkflowContract = buildClientWorkflowContract({
    clientRuntime,
    command,
    syncMetadata,
    preview,
    acceptance,
    readiness,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState,
    workflowHandoff,
    nextSteps,
    persistedState,
    restartSafeStatus,
    operationalHealth,
    clientStateCheckpoint,
    persistedStateRecovery
  });
  const previewAcceptanceContract = buildPreviewAcceptanceContract({
    clientRuntime,
    clientStateCheckpoint,
    command,
    syncMetadata,
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    tenantBoundary,
    lifecycleSettings,
    handoffDeliveryState,
    persistedState,
    restartSafeStatus,
    operationalHealth
  });
  const mailchimpWorkflowAcceptance = buildMailchimpWorkflowAcceptanceContract({
    now,
    clientRuntime,
    syncMetadata,
    tenantBoundary,
    handoffDeliveryState,
    mailchimpWritebackContext,
    mailchimpCampaignDispatchGuard,
    previewAcceptanceContract,
    acceptance
  });
  const clientContinuationDispatch = buildClientContinuationDispatch({
    clientRuntime,
    command,
    syncMetadata,
    tenantBoundary,
    handoffDeliveryState,
    workflowHandoff,
    clientWorkflowContract,
    previewAcceptanceContract,
    clientStateCheckpoint,
    persistedStateRecovery,
    readiness,
    acceptance
  });
  const currentHistorySnapshot = {
    observedAt: now,
    batchId: syncMetadata.batchId,
    cursor: syncMetadata.nextCursor,
    phase: restartSafeStatus.phaseAfterCommand,
    commandType: command.type,
    acceptanceDecision: acceptance.decision,
    dirtyRecordCount: syncMetadata.dirtyRecordCount,
    previewRecordCount: preview.shownRecordCount,
    byteSize: preview.records.reduce((total, record) => total + record.byteSize, 0),
    ready: readiness.ready,
    blocked: validationSummary.severity === 'blocked',
    restartSafeStatus: restartSafeStatus.status,
    workflowStatus: workflowHandoff.status,
    providerMode: negotiation.mode,
    operationalHealthState: operationalHealth.state,
    mailchimpCampaignStateKey: mailchimpWritebackContext.applies ? mailchimpWritebackContext.stateKey : null,
    mailchimpCampaignReady: mailchimpWritebackContext.readyForExternalDispatch
  };
  const historySnapshots = normalizeHistorySnapshots(input, currentHistorySnapshot);
  const analyticsCounters = buildAnalyticsCounters({
    historySnapshots,
    readiness,
    syncMetadata,
    preview,
    acceptance,
    persistedState,
    restartSafeStatus
  });
  const auditProof = buildAuditProof({
    now,
    provider,
    negotiation,
    syncMetadata,
    handoff: externalHandoff,
    serviceContract,
    handoffDeliveryState,
    clientRuntime,
    workflowHandoff,
    persistedState,
    restartSafeStatus,
    acceptanceResumeSnapshot,
    persistedStateRecovery,
    tenantBoundary,
    lifecycleSettings,
    operationalHealth,
    commitPlan,
    providerReceiptSettlement,
    externalDispatchAssurance,
    mailchimpWritebackContext,
    mailchimpCampaignDispatchGuard,
    preview
  });
  const timelineReport = buildTimelineReport({
    historySnapshots,
    analyticsCounters,
    clientRuntime,
    syncMetadata,
    workflowHandoff,
    restartSafeStatus
  });
  const exportSummary = buildExportSummary({
    analyticsCounters,
    timelineReport,
    validationSummary,
    auditProof,
    serviceContract,
    handoffDeliveryState,
    tenantBoundary,
    lifecycleSettings,
    operationalHealth,
    commitPlan,
    providerReceiptSettlement,
    externalDispatchAssurance,
    preview,
    persistedStateRecovery,
    mailchimpWritebackContext,
    mailchimpCampaignDispatchGuard
  });
  const analyticsReportingState = buildAnalyticsReportingState({
    input,
    now,
    historySnapshots,
    analyticsCounters,
    timelineReport,
    exportSummary,
    auditProof,
    clientRuntime,
    syncMetadata,
    persistedStateRecovery,
    operationalHealth
  });
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  return {
    ok: negotiation.ready,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel memory writeback policy provider contract',
    provider,
    capabilities: {
      advertised: provider.capabilities,
      required: negotiation.accepted.concat(negotiation.missing),
      accepted: negotiation.accepted,
      missing: negotiation.missing,
      mode: negotiation.mode
    },
    syncMetadata,
    externalHandoff,
    serviceContract,
    handoffDeliveryState,
    mailchimpWritebackContext,
    preview,
    clientRuntime,
    command,
    lifecycleSettings,
    persistedState,
    tenantBoundary,
    restartSafeStatus,
    persistedStateRecovery,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    operationalHealth,
    commitPlan,
    providerReceiptSettlement,
    externalDispatchAssurance,
    mailchimpCampaignDispatchGuard,
    mailchimpWorkflowAcceptance,
    workflowHandoff,
    clientWorkflowContract,
    previewAcceptanceContract,
    clientContinuationDispatch,
    analyticsCounters,
    historySnapshots,
    timelineReport,
    exportSummary,
    analyticsReportingState,
    auditProof,
    evidence: [
      ...evidence,
      {
        type: 'writeback-policy.contract',
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        traceId: clientRuntime.traceId,
        providerId: provider.id,
        serviceContractId: serviceContract.contractId,
        serviceContractStatus: serviceContract.status,
        serviceProtocol: serviceContract.protocol,
        batchId: syncMetadata.batchId,
        handoffState: externalHandoff.state,
        handoffEnvelopeId: handoffDeliveryState.envelopeId,
        handoffDeliveryStatus: handoffDeliveryState.status,
        handoffDeliveryChannel: handoffDeliveryState.channel,
        workflowStatus: workflowHandoff.status,
        clientCheckpointStage: clientStateCheckpoint.stage,
        clientCheckpointRefreshRequired: clientStateCheckpoint.refreshRequired,
        clientCheckpointStaleReasons: clientStateCheckpoint.staleReasons,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        permissionBoundaryAllowed: tenantBoundary.allowed,
        lifecycleReady: lifecycleSettings.ready,
        lifecycleMode: lifecycleSettings.mode,
        lifecycleSettingsCommandContractId: lifecycleSettings.settingsCommand.contractId,
        lifecycleSettingsCommandStatus: lifecycleSettings.settingsCommand.commandResult.status,
        lifecycleSettingsCommandApplied: lifecycleSettings.settingsCommand.commandResult.applied,
        lifecycleScheduleMode: lifecycleSettings.schedule.mode,
        lifecycleNextActionState: lifecycleSettings.nextActionState.state,
        lifecycleNextActionCommandType: lifecycleSettings.nextActionState.commandType,
        ready: readiness.ready,
        acceptanceDecision: acceptance.decision,
        validationSeverity: validationSummary.severity,
        operationalHealthState: operationalHealth.state,
        operationalFailureState: operationalHealth.failureState,
        degradedMode: operationalHealth.degradedMode,
        retryable: operationalHealth.retryable,
        retryAfterMs: operationalHealth.retryAfterMs,
        retryScheduledAt: operationalHealth.retryWindow ? operationalHealth.retryWindow.scheduledAt : null,
        persistedFailureLedgerState: operationalHealth.persistedFailureLedger.state,
        persistedOpenFailureCount: operationalHealth.persistedFailureLedger.openFailureCount,
        persistedTerminalFailureCount: operationalHealth.persistedFailureLedger.terminalFailureCount,
        recoveryStatus: persistedState.recoveryStatus,
        restartSafeStatus: restartSafeStatus.status,
        persistedStateRecoveryStatus: persistedStateRecovery.status,
        acceptanceResumeStatus: acceptanceResumeSnapshot.status,
        acceptanceResumeRoute: acceptanceResumeSnapshot.route,
        acceptanceResumeSnapshotId: acceptanceResumeSnapshot.snapshotId,
        acceptanceResumeRestartSafe: acceptanceResumeSnapshot.restartSemantics.restartSafe,
        persistedStateRecoveryActions: persistedStateRecovery.recoveryActions,
        persistedRecoveryQueueStatus: persistedStateRecovery.recoveryQueue.status,
        persistedRecoveryOpenOperationCount: persistedStateRecovery.recoveryQueue.openOperationCount,
        persistedRecoveryBlockedOperationCount: persistedStateRecovery.recoveryQueue.blockedOperationCount,
        persistenceJournalStatus: persistedStateRecovery.persistenceJournal.status,
        persistenceJournalId: persistedStateRecovery.persistenceJournal.journalId,
        persistenceDurableWriteKey: persistedStateRecovery.persistenceJournal.durableWriteKey,
        persistenceJournalAppendRequired: persistedStateRecovery.persistenceJournal.appendRequired,
        persistenceJournalReplayHit: persistedStateRecovery.persistenceJournal.replayHit,
        persistenceJournalOpenEntryCount: persistedStateRecovery.persistenceJournal.openEntryCount,
        nextPersistedStatePhase: persistedStateRecovery.nextPersistedState.phase,
        nextPersistedStateGeneration: persistedStateRecovery.nextPersistedState.generation,
        commitPlanStatus: commitPlan.status,
        commitMutationCount: commitPlan.mutationCount,
        providerReceiptSettlementStatus: providerReceiptSettlement.status,
        providerReceiptAccepted: providerReceiptSettlement.accepted,
        providerReceiptState: providerReceiptSettlement.receiptState,
        providerReceiptValidationErrors: providerReceiptSettlement.validationErrors,
        externalDispatchAssuranceStatus: externalDispatchAssurance.status,
        externalDispatchReady: externalDispatchAssurance.ready,
        externalDispatchNextAction: externalDispatchAssurance.nextAction,
        externalDispatchBlockedReasons: externalDispatchAssurance.blockedReasons,
        mailchimpCampaignContextApplies: mailchimpWritebackContext.applies,
        mailchimpCampaignStateKey: mailchimpWritebackContext.stateKey,
        mailchimpCampaignReadyForExternalDispatch: mailchimpWritebackContext.readyForExternalDispatch,
        mailchimpCampaignReplayKey: mailchimpWritebackContext.replayProtection.replayKey,
        mailchimpCampaignBlockedReasons: mailchimpWritebackContext.blockedReasons,
        mailchimpCampaignProof: mailchimpWritebackContext.proof,
        mailchimpDispatchGuardStatus: mailchimpCampaignDispatchGuard.status,
        mailchimpDispatchGuardReady: mailchimpCampaignDispatchGuard.ready,
        mailchimpDispatchGuardNextAction: mailchimpCampaignDispatchGuard.nextAction,
        mailchimpDispatchGuardBlockedReasons: mailchimpCampaignDispatchGuard.blockedReasons,
        mailchimpDispatchGuardProof: mailchimpCampaignDispatchGuard.proof,
        mailchimpWorkflowAcceptanceStatus: mailchimpWorkflowAcceptance.status,
        mailchimpWorkflowAcceptanceReady: mailchimpWorkflowAcceptance.ready,
        mailchimpWorkflowAcceptanceNextAction: mailchimpWorkflowAcceptance.nextAction,
        mailchimpWorkflowAcceptanceProof: mailchimpWorkflowAcceptance.proof,
        idempotencyKey: restartSafeStatus.idempotencyKey,
        analyticsObservedBatchCount: analyticsCounters.observedBatchCount,
        analyticsBlockedBatchCount: analyticsCounters.blockedBatchCount,
        analyticsReportStatus: analyticsReportingState.status,
        analyticsReportWindow: analyticsReportingState.options.window,
        analyticsExportFormat: analyticsReportingState.options.format,
        analyticsExportFileCount: analyticsReportingState.exportManifest.fileCount,
        analyticsExportResumeToken: analyticsReportingState.watermarks.nextResumeToken,
        nextStepIds: nextSteps.map((step) => step.id)
      },
      {
        type: 'writeback-policy.mailchimp-campaign-context',
        contractType: mailchimpWritebackContext.contractType,
        applies: mailchimpWritebackContext.applies,
        provider: mailchimpWritebackContext.provider,
        stage: mailchimpWritebackContext.stage,
        campaignId: mailchimpWritebackContext.campaignId,
        audienceId: mailchimpWritebackContext.audienceId,
        segmentId: mailchimpWritebackContext.segmentId,
        workflowId: mailchimpWritebackContext.workflowId,
        stateKey: mailchimpWritebackContext.stateKey,
        tenantId: mailchimpWritebackContext.tenantId,
        workspaceId: mailchimpWritebackContext.workspaceId,
        batchId: mailchimpWritebackContext.batchId,
        cursor: mailchimpWritebackContext.cursor,
        dirtyRecordCount: mailchimpWritebackContext.dirtyRecordCount,
        readyForExternalDispatch: mailchimpWritebackContext.readyForExternalDispatch,
        missingIdentifiers: mailchimpWritebackContext.missingIdentifiers,
        blockedReasons: mailchimpWritebackContext.blockedReasons,
        replayKey: mailchimpWritebackContext.replayProtection.replayKey,
        auditDestination: mailchimpWritebackContext.auditHandoff.destination,
        auditEnvelopeId: mailchimpWritebackContext.auditHandoff.envelopeId,
        proof: mailchimpWritebackContext.proof
      },
      {
        type: 'writeback-policy.mailchimp-campaign-dispatch-guard',
        contractType: mailchimpCampaignDispatchGuard.contractType,
        applies: mailchimpCampaignDispatchGuard.applies,
        status: mailchimpCampaignDispatchGuard.status,
        ready: mailchimpCampaignDispatchGuard.ready,
        nextAction: mailchimpCampaignDispatchGuard.nextAction,
        approval: mailchimpCampaignDispatchGuard.approval,
        scope: mailchimpCampaignDispatchGuard.scope,
        receiptSettlement: mailchimpCampaignDispatchGuard.receiptSettlement,
        externalDispatch: mailchimpCampaignDispatchGuard.externalDispatch,
        dispatchEnvelope: mailchimpCampaignDispatchGuard.dispatchEnvelope,
        auditHandoff: mailchimpCampaignDispatchGuard.auditHandoff,
        blockedReasons: mailchimpCampaignDispatchGuard.blockedReasons,
        proof: mailchimpCampaignDispatchGuard.proof
      },
      {
        type: 'writeback-policy.mailchimp-workflow-acceptance',
        contractType: mailchimpWorkflowAcceptance.contractType,
        applies: mailchimpWorkflowAcceptance.applies,
        status: mailchimpWorkflowAcceptance.status,
        ready: mailchimpWorkflowAcceptance.ready,
        nextAction: mailchimpWorkflowAcceptance.nextAction,
        campaign: mailchimpWorkflowAcceptance.campaign,
        acceptance: {
          decision: mailchimpWorkflowAcceptance.acceptance.decision,
          accepted: mailchimpWorkflowAcceptance.acceptance.accepted,
          actor: mailchimpWorkflowAcceptance.acceptance.actor,
          acceptedAt: mailchimpWorkflowAcceptance.acceptance.acceptedAt,
          requiredPreviewTokens: mailchimpWorkflowAcceptance.acceptance.requiredPreviewTokens,
          acceptedPreviewTokens: mailchimpWorkflowAcceptance.acceptance.acceptedPreviewTokens,
          missingPreviewTokens: mailchimpWorkflowAcceptance.acceptance.missingPreviewTokens,
          proof: mailchimpWorkflowAcceptance.acceptance.proof
        },
        dispatchGuard: mailchimpWorkflowAcceptance.dispatchGuard,
        auditHandoff: mailchimpWorkflowAcceptance.auditHandoff,
        blockedReasons: mailchimpWorkflowAcceptance.blockedReasons,
        proof: mailchimpWorkflowAcceptance.proof
      },
      {
        type: 'writeback-policy.tenant-boundary',
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        actor: tenantBoundary.actor,
        role: tenantBoundary.role,
        commandType: tenantBoundary.commandType,
        workspaceTenantId: tenantBoundary.workspaceTenantId,
        workspaceScopeMode: tenantBoundary.workspaceScopeMode,
        auditSubject: tenantBoundary.auditSubject,
        stateScopeKey: tenantBoundary.stateScopeKey,
        authorizationProofId: tenantBoundary.authorizationProof.proofId,
        authorizationDecision: tenantBoundary.authorizationProof.auditHandoff.decision,
        allowed: tenantBoundary.allowed,
        tenantAllowed: tenantBoundary.tenantAllowed,
        workspaceAllowed: tenantBoundary.workspaceAllowed,
        workspaceBelongsToTenant: tenantBoundary.workspaceBelongsToTenant,
        workspaceScopeSatisfied: tenantBoundary.workspaceScopeSatisfied,
        requiredPermissions: tenantBoundary.requiredPermissions,
        explicitPermissions: tenantBoundary.explicitPermissions,
        rolePermissions: tenantBoundary.rolePermissions,
        missingPermissions: tenantBoundary.missingPermissions,
        crossTenantAllowed: tenantBoundary.crossTenantAllowed,
        crossWorkspaceAllowed: tenantBoundary.crossWorkspaceAllowed,
        delegatedTenantAllowed: tenantBoundary.delegatedTenantAllowed,
        delegatedWorkspaceAllowed: tenantBoundary.delegatedWorkspaceAllowed,
        boundaryViolations: tenantBoundary.boundaryViolations
      },
      {
        type: 'writeback-policy.authorization-proof',
        proofType: tenantBoundary.authorizationProof.proofType,
        proofId: tenantBoundary.authorizationProof.proofId,
        tenantId: tenantBoundary.authorizationProof.tenantId,
        workspaceId: tenantBoundary.authorizationProof.workspaceId,
        workspaceTenantId: tenantBoundary.authorizationProof.workspaceTenantId,
        actor: tenantBoundary.authorizationProof.actor,
        role: tenantBoundary.authorizationProof.role,
        commandType: tenantBoundary.authorizationProof.commandType,
        workspaceScopeMode: tenantBoundary.authorizationProof.workspaceScopeMode,
        decision: tenantBoundary.authorizationProof.auditHandoff.decision,
        boundaryAllowed: tenantBoundary.authorizationProof.boundaryAllowed,
        tenantAllowed: tenantBoundary.authorizationProof.tenantAllowed,
        workspaceAllowed: tenantBoundary.authorizationProof.workspaceAllowed,
        workspaceBelongsToTenant: tenantBoundary.authorizationProof.workspaceBelongsToTenant,
        workspaceScopeSatisfied: tenantBoundary.authorizationProof.workspaceScopeSatisfied,
        samePersistedTenant: tenantBoundary.authorizationProof.samePersistedTenant,
        samePersistedWorkspace: tenantBoundary.authorizationProof.samePersistedWorkspace,
        crossTenantAllowed: tenantBoundary.authorizationProof.crossTenantAllowed,
        crossWorkspaceAllowed: tenantBoundary.authorizationProof.crossWorkspaceAllowed,
        delegatedTenantAllowed: tenantBoundary.authorizationProof.delegatedTenantAllowed,
        delegatedWorkspaceAllowed: tenantBoundary.authorizationProof.delegatedWorkspaceAllowed,
        requiredPermissions: tenantBoundary.authorizationProof.requiredPermissions,
        explicitPermissions: tenantBoundary.authorizationProof.explicitPermissions,
        rolePermissions: tenantBoundary.authorizationProof.rolePermissions,
        grantedPermissions: tenantBoundary.authorizationProof.grantedPermissions,
        missingPermissions: tenantBoundary.authorizationProof.missingPermissions,
        deniedReasons: tenantBoundary.authorizationProof.deniedReasons,
        auditHandoff: tenantBoundary.authorizationProof.auditHandoff
      },
      {
        type: 'writeback-policy.client-handoff',
        stateKey: clientRuntime.stateKey,
        correlationKey: clientRuntime.correlationKey,
        surface: clientRuntime.surface,
        route: workflowHandoff.route,
        resumeEnabled: workflowHandoff.resume.enabled,
        resumeAction: workflowHandoff.resume.action,
        resumeToken: workflowHandoff.resume.resumeToken,
        handoffEnvelopeId: workflowHandoff.resume.envelopeId,
        handoffChannel: workflowHandoff.resume.channel,
        handoffAckTopic: workflowHandoff.resume.ackTopic,
        userVisibleStatus: workflowHandoff.status
      },
      {
        type: 'writeback-policy.client-state-checkpoint',
        checkpointType: clientStateCheckpoint.checkpointType,
        stage: clientStateCheckpoint.stage,
        revision: clientStateCheckpoint.revision,
        nextRevision: clientStateCheckpoint.nextRevision,
        checkpointToken: clientStateCheckpoint.checkpointToken,
        stateKey: clientStateCheckpoint.stateKey,
        stateMatches: clientStateCheckpoint.stateMatches,
        lastSeenBatchId: clientStateCheckpoint.lastSeenBatchId,
        lastSeenCursor: clientStateCheckpoint.lastSeenCursor,
        batchMatches: clientStateCheckpoint.batchMatches,
        cursorMatches: clientStateCheckpoint.cursorMatches,
        pendingCommandType: clientStateCheckpoint.pendingCommandType,
        pendingCommandMatches: clientStateCheckpoint.pendingCommandMatches,
        idempotencyMatches: clientStateCheckpoint.idempotencyMatches,
        draftDecision: clientStateCheckpoint.draftDecision,
        acknowledgedStepIds: clientStateCheckpoint.acknowledgedStepIds,
        refreshRequired: clientStateCheckpoint.refreshRequired,
        staleReasons: clientStateCheckpoint.staleReasons,
        continuationPatch: clientStateCheckpoint.continuationPatch
      },
      {
        type: 'writeback-policy.client-workflow-contract',
        contractType: clientWorkflowContract.contractType,
        surface: clientWorkflowContract.surface,
        route: clientWorkflowContract.route,
        continuationEndpoint: clientWorkflowContract.continuationEndpoint,
        status: clientWorkflowContract.status,
        selectedCommand: clientWorkflowContract.selectedCommand,
        selectedCommandEnabled: clientWorkflowContract.selectedCommandEnabled,
        allowedCommands: clientWorkflowContract.allowedCommands,
        lifecycleControlStatus: clientWorkflowContract.lifecycleControls.status,
        lifecycleNextAction: clientWorkflowContract.lifecycleControls.nextAction.action,
        lifecycleValidationErrors: clientWorkflowContract.lifecycleControls.validation.errors,
        clientAction: clientWorkflowContract.clientAction,
        requestId: clientWorkflowContract.stateBindings.requestId,
        sessionId: clientWorkflowContract.stateBindings.sessionId,
        stateKey: clientWorkflowContract.stateBindings.stateKey,
        correlationKey: clientWorkflowContract.stateBindings.correlationKey,
        batchId: clientWorkflowContract.stateBindings.batchId,
        cursor: clientWorkflowContract.stateBindings.cursor,
        idempotencyKey: clientWorkflowContract.stateBindings.idempotencyKey,
        handoffEnvelopeId: clientWorkflowContract.stateBindings.handoffEnvelopeId,
        resumeToken: clientWorkflowContract.stateBindings.resumeToken,
        clientCheckpointStage: clientWorkflowContract.clientStateCheckpoint.stage,
        clientCheckpointRefreshRequired: clientWorkflowContract.clientStateCheckpoint.refreshRequired,
        clientCheckpointToken: clientWorkflowContract.clientStateCheckpoint.checkpointToken,
        requiredPayloadFields: clientWorkflowContract.payloadSchema.requiredFields,
        previewRecordCount: clientWorkflowContract.previewSummary.shownRecordCount,
        totalDirtyRecords: clientWorkflowContract.previewSummary.totalDirtyRecords,
        resumable: clientWorkflowContract.handoff.resumable,
        restartSafeStatus: clientWorkflowContract.persistence.restartSafeStatus,
        shouldPersist: clientWorkflowContract.persistence.shouldPersist,
        recoveryStatusAfterRestart: clientWorkflowContract.persistence.recoveryStatusAfterRestart,
        recoveryActions: clientWorkflowContract.persistence.recoveryActions,
        nextPersistedPhase: clientWorkflowContract.persistence.nextPhase,
        nextPersistedGeneration: clientWorkflowContract.persistence.nextGeneration,
        blockingReasons: clientWorkflowContract.blockingReasons
      },
      {
        type: 'writeback-policy.client-continuation-dispatch',
        contractType: clientContinuationDispatch.contractType,
        dispatchId: clientContinuationDispatch.dispatchId,
        status: clientContinuationDispatch.status,
        ready: clientContinuationDispatch.ready,
        surface: clientContinuationDispatch.surface,
        route: clientContinuationDispatch.route,
        continuationEndpoint: clientContinuationDispatch.continuationEndpoint,
        selectedCommand: clientContinuationDispatch.selectedCommand,
        clientAction: clientContinuationDispatch.clientAction,
        requestId: clientContinuationDispatch.statePreconditions.requestId,
        sessionId: clientContinuationDispatch.statePreconditions.sessionId,
        stateKey: clientContinuationDispatch.statePreconditions.stateKey,
        checkpointToken: clientContinuationDispatch.statePreconditions.checkpointToken,
        checkpointFresh: clientContinuationDispatch.statePreconditions.checkpointFresh,
        batchId: clientContinuationDispatch.statePreconditions.batchId,
        cursor: clientContinuationDispatch.statePreconditions.cursor,
        handoffEnvelopeId: clientContinuationDispatch.statePreconditions.handoffEnvelopeId,
        resumeToken: clientContinuationDispatch.statePreconditions.resumeToken,
        payloadContentType: clientContinuationDispatch.payloadContract.contentType,
        routePayloadAvailable: Boolean(clientContinuationDispatch.payloadContract.routePayload),
        refreshPatchAvailable: Boolean(clientContinuationDispatch.payloadContract.refreshPatch),
        resumeEnabled: clientContinuationDispatch.workflowHandoff.resumeEnabled,
        resumeAction: clientContinuationDispatch.workflowHandoff.resumeAction,
        blockedReasons: clientContinuationDispatch.blockedReasons
      },
      {
        type: 'writeback-policy.preview-acceptance-contract',
        contractType: previewAcceptanceContract.contractType,
        route: previewAcceptanceContract.route,
        continuationEndpoint: previewAcceptanceContract.continuationEndpoint,
        status: previewAcceptanceContract.status,
        requestId: previewAcceptanceContract.requestId,
        sessionId: previewAcceptanceContract.sessionId,
        stateKey: previewAcceptanceContract.stateKey,
        correlationKey: previewAcceptanceContract.correlationKey,
        batchId: previewAcceptanceContract.preview.batchId,
        cursor: previewAcceptanceContract.preview.cursor,
        visibleRecordCount: previewAcceptanceContract.preview.visibleRecordCount,
        writableRecordCount: previewAcceptanceContract.preview.writableRecordCount,
        withheldRecordCount: previewAcceptanceContract.preview.withheldRecordCount,
        estimatedWritableBytes: previewAcceptanceContract.preview.estimatedWritableBytes,
        acceptanceDecision: previewAcceptanceContract.acceptance.decision,
        canAccept: previewAcceptanceContract.acceptance.canAccept,
        canReject: previewAcceptanceContract.acceptance.canReject,
        canCommit: previewAcceptanceContract.acceptance.canCommit,
        acceptCommandIdempotencyKey: previewAcceptanceContract.acceptance.acceptCommand
          ? previewAcceptanceContract.acceptance.acceptCommand.idempotencyKey
          : null,
        readinessPassedCount: previewAcceptanceContract.readiness.passedCount,
        readinessFailedCount: previewAcceptanceContract.readiness.failedCount,
        validationSeverity: previewAcceptanceContract.validation.severity,
        validationIssueCount: previewAcceptanceContract.validation.issueCount,
        nextStepIds: previewAcceptanceContract.nextSteps.map((step) => step.id),
        requiredRoutePayloadFields: previewAcceptanceContract.routePayloadSchema.requiredFields
      },
      {
        type: 'writeback-policy.acceptance-resume-snapshot',
        snapshotType: acceptanceResumeSnapshot.snapshotType,
        snapshotId: acceptanceResumeSnapshot.snapshotId,
        status: acceptanceResumeSnapshot.status,
        route: acceptanceResumeSnapshot.route,
        requestId: acceptanceResumeSnapshot.request.requestId,
        sessionId: acceptanceResumeSnapshot.request.sessionId,
        tenantId: acceptanceResumeSnapshot.scope.tenantId,
        workspaceId: acceptanceResumeSnapshot.scope.workspaceId,
        stateScopeKey: acceptanceResumeSnapshot.scope.stateScopeKey,
        batchId: acceptanceResumeSnapshot.preview.batchId,
        cursor: acceptanceResumeSnapshot.preview.cursor,
        writableRecordCount: acceptanceResumeSnapshot.preview.writableRecordCount,
        withheldRecordCount: acceptanceResumeSnapshot.preview.withheldRecordCount,
        acceptanceDecision: acceptanceResumeSnapshot.acceptance.decision,
        accepted: acceptanceResumeSnapshot.acceptance.accepted,
        canSubmitAccept: acceptanceResumeSnapshot.acceptance.canSubmitAccept,
        canSubmitCommit: acceptanceResumeSnapshot.acceptance.canSubmitCommit,
        acceptanceBlockedReasons: acceptanceResumeSnapshot.acceptance.blockedReasons,
        readinessReady: acceptanceResumeSnapshot.readiness.ready,
        failedGateIds: acceptanceResumeSnapshot.readiness.failedGateIds,
        validationSeverity: acceptanceResumeSnapshot.validation.severity,
        handoffEnvelopeId: acceptanceResumeSnapshot.handoff.envelopeId,
        handoffStatus: acceptanceResumeSnapshot.handoff.status,
        handoffReady: acceptanceResumeSnapshot.handoff.ready,
        resumeToken: acceptanceResumeSnapshot.handoff.resumeToken,
        currentCommand: acceptanceResumeSnapshot.commands.current,
        acceptCommand: acceptanceResumeSnapshot.commands.accept,
        commitCommand: acceptanceResumeSnapshot.commands.commit,
        nextCommand: acceptanceResumeSnapshot.commands.next,
        persistedStateShape: acceptanceResumeSnapshot.persistedStateShape,
        restartSemantics: acceptanceResumeSnapshot.restartSemantics
      },
      {
        type: 'writeback-policy.persisted-state',
        stateKey: persistedState.stateKey,
        schemaVersion: persistedState.schemaVersion,
        phaseBeforeCommand: restartSafeStatus.phaseBeforeCommand,
        phaseAfterCommand: restartSafeStatus.phaseAfterCommand,
        writeToken: restartSafeStatus.writeToken,
        commandAlreadyApplied: restartSafeStatus.commandAlreadyApplied,
        shouldPersist: restartSafeStatus.shouldPersist,
        blockedReasons: restartSafeStatus.blockedReasons,
        recoveryContractType: persistedStateRecovery.contractType,
        recoveryStatus: persistedStateRecovery.status,
        commandReceiptStatus: persistedStateRecovery.commandReceipt.status,
        nextStateSchemaVersion: persistedStateRecovery.nextPersistedState.schemaVersion,
        nextStatePhase: persistedStateRecovery.nextPersistedState.phase,
        nextStateGeneration: persistedStateRecovery.nextPersistedState.generation,
        nextStateCommandCount: persistedStateRecovery.nextPersistedState.commands.length,
        nextStateRecoveryQueueStatus: persistedStateRecovery.nextPersistedState.recoveryQueue.status,
        nextStateRecoveryOpenOperationCount: persistedStateRecovery.nextPersistedState.recoveryQueue.openOperationCount,
        nextStateRecoveryOperationIds: persistedStateRecovery.nextPersistedState.recoveryQueue.operations.map((operation) => operation.operationId),
        nextStatePersistenceJournalStatus: persistedStateRecovery.nextPersistedState.persistenceJournal.status,
        nextStatePersistenceJournalId: persistedStateRecovery.nextPersistedState.persistenceJournal.journalId,
        nextStatePersistenceDurableWriteKey: persistedStateRecovery.nextPersistedState.persistenceJournal.durableWriteKey,
        nextStatePersistenceJournalEntryCount: persistedStateRecovery.nextPersistedState.persistenceJournal.entries.length,
        nextStatePersistenceRestartSemantics: persistedStateRecovery.nextPersistedState.persistenceJournal.restartSemantics,
        nextStatePreviewAcceptance: persistedStateRecovery.nextPersistedState.previewAcceptance,
        nextStateRestartStatus: persistedStateRecovery.nextPersistedState.restartStatus,
        nextStateOperationalHealth: persistedStateRecovery.nextPersistedState.operationalHealth,
        nextStateLifecycle: persistedStateRecovery.nextPersistedState.lifecycle,
        recoveryActions: persistedStateRecovery.recoveryActions,
        consistency: persistedStateRecovery.consistency
      },
      {
        type: 'writeback-policy.analytics-export',
        exportId: exportSummary.exportId,
        reportType: timelineReport.reportType,
        observedBatchCount: analyticsCounters.observedBatchCount,
        historicalDirtyRecordCount: analyticsCounters.historicalDirtyRecordCount,
        historicalPreviewRecordCount: analyticsCounters.historicalPreviewRecordCount,
        latestTimelineEventId: timelineReport.latestEventId,
        validationSeverity: exportSummary.validationSeverity,
        ready: exportSummary.ready,
        tenantBoundaryAllowed: exportSummary.tenantBoundary.allowed,
        tenantBoundaryViolations: exportSummary.tenantBoundary.boundaryViolations,
        previewWritableRecordCount: exportSummary.previewScope.writableRecordCount,
        previewWithheldRecordCount: exportSummary.previewScope.withheldRecordCount,
        previewRecordBoundaryViolations: exportSummary.previewScope.recordBoundaryViolations
      },
      {
        type: 'writeback-policy.analytics-reporting-state',
        reportType: analyticsReportingState.reportType,
        reportId: analyticsReportingState.reportId,
        status: analyticsReportingState.status,
        ready: analyticsReportingState.ready,
        exportId: analyticsReportingState.exportManifest.exportId,
        destination: analyticsReportingState.exportManifest.destination,
        format: analyticsReportingState.exportManifest.format,
        window: analyticsReportingState.options.window,
        includeTimeline: analyticsReportingState.options.includeTimeline,
        includeProof: analyticsReportingState.options.includeProof,
        includeSnapshots: analyticsReportingState.options.includeSnapshots,
        invalidOptionReasons: analyticsReportingState.invalidOptionReasons,
        firstObservedAt: analyticsReportingState.watermarks.firstObservedAt,
        lastObservedAt: analyticsReportingState.watermarks.lastObservedAt,
        lastBatchId: analyticsReportingState.watermarks.lastBatchId,
        lastCursor: analyticsReportingState.watermarks.lastCursor,
        nextResumeToken: analyticsReportingState.watermarks.nextResumeToken,
        snapshotCount: analyticsReportingState.rollups.snapshotCount,
        dirtyRecordCount: analyticsReportingState.rollups.dirtyRecordCount,
        previewRecordCount: analyticsReportingState.rollups.previewRecordCount,
        byteSize: analyticsReportingState.rollups.byteSize,
        phaseCounts: analyticsReportingState.rollups.phaseCounts,
        statusCounts: analyticsReportingState.rollups.statusCounts,
        operationalFailureState: analyticsReportingState.rollups.operationalFailureState,
        exportFileCount: analyticsReportingState.exportManifest.fileCount,
        exportFiles: analyticsReportingState.exportManifest.files
          .filter((file) => file.included)
          .map((file) => ({
            role: file.role,
            contentType: file.contentType,
            format: file.format,
            path: file.path,
            recordCount: file.recordCount
          })),
        proofId: analyticsReportingState.exportManifest.proofId
      },
      {
        type: 'writeback-policy.lifecycle-settings',
        enabled: lifecycleSettings.enabled,
        mode: lifecycleSettings.mode,
        commandAppliedMode: lifecycleSettings.commandAppliedMode,
        configurable: lifecycleSettings.configurable,
        settingsCommandContractId: lifecycleSettings.settingsCommand.contractId,
        settingsCommandStatus: lifecycleSettings.settingsCommand.commandResult.status,
        settingsCommandApplied: lifecycleSettings.settingsCommand.commandResult.applied,
        settingsCommandValidation: lifecycleSettings.settingsCommand.validation,
        controlState: lifecycleSettings.controlState,
        pausedUntil: lifecycleSettings.pausedUntil,
        pauseActive: lifecycleSettings.pauseActive,
        scheduleMode: lifecycleSettings.schedule.mode,
        scheduledFor: lifecycleSettings.schedule.scheduledFor,
        intervalMs: lifecycleSettings.schedule.intervalMs,
        deferByMs: lifecycleSettings.schedule.deferByMs,
        withinWindow: lifecycleSettings.schedule.withinWindow,
        scheduleReady: lifecycleSettings.schedule.ready,
        validationErrors: lifecycleSettings.schedule.validationErrors,
        blockedReasons: lifecycleSettings.blockedReasons,
        nextActionState: lifecycleSettings.nextActionState,
        nextLifecycleAction: lifecycleSettings.nextLifecycleAction
      },
      {
        type: 'writeback-policy.provider-service-contract',
        contractId: serviceContract.contractId,
        providerId: serviceContract.providerId,
        protocol: serviceContract.protocol,
        status: serviceContract.status,
        ready: serviceContract.ready,
        deliverySemantics: serviceContract.deliverySemantics,
        ackDeadlineMs: serviceContract.ack.deadlineMs,
        acknowledgedCapabilities: serviceContract.ack.acknowledgedCapabilities,
        missingAckCapabilities: serviceContract.ack.missingCapabilities,
        retryMaxAttempts: serviceContract.retry.maxAttempts,
        retryBackoffMs: serviceContract.retry.backoffMs,
        externalHandoffRequired: serviceContract.externalHandoff.required,
        externalHandoffState: serviceContract.externalHandoff.state
      },
      {
        type: 'writeback-policy.handoff-delivery-state',
        envelopeId: handoffDeliveryState.envelopeId,
        status: handoffDeliveryState.status,
        ready: handoffDeliveryState.ready,
        required: handoffDeliveryState.required,
        providerId: handoffDeliveryState.providerId,
        contractId: handoffDeliveryState.contractId,
        channel: handoffDeliveryState.channel,
        destination: handoffDeliveryState.destination,
        ackTopic: handoffDeliveryState.ackTopic,
        payloadSchema: handoffDeliveryState.payloadSchema,
        resumeToken: handoffDeliveryState.resumeToken,
        leaseState: handoffDeliveryState.lease.state,
        leaseActive: handoffDeliveryState.lease.active,
        leaseExpired: handoffDeliveryState.lease.expired,
        batchId: handoffDeliveryState.payload.batchId,
        cursor: handoffDeliveryState.payload.cursor,
        idempotencyKey: handoffDeliveryState.payload.idempotencyKey,
        tenantId: handoffDeliveryState.payload.tenantId,
        workspaceId: handoffDeliveryState.payload.workspaceId,
        stateScopeKey: handoffDeliveryState.payload.stateScopeKey,
        deliverySemantics: handoffDeliveryState.payload.deliverySemantics,
        ackDeadlineMs: handoffDeliveryState.payload.ackDeadlineMs,
        blockedReasons: handoffDeliveryState.blockedReasons
      },
      {
        type: 'writeback-policy.operational-health',
        state: operationalHealth.state,
        degradedMode: operationalHealth.degradedMode,
        failureState: operationalHealth.failureState,
        retryable: operationalHealth.retryable,
        attempt: operationalHealth.attempt,
        maxAttempts: operationalHealth.maxAttempts,
        exhaustedRetries: operationalHealth.exhaustedRetries,
        retryAfterMs: operationalHealth.retryAfterMs,
        retryAfterCursor: operationalHealth.retryAfterCursor,
        retryWindow: operationalHealth.retryWindow,
        persistedFailureLedger: operationalHealth.persistedFailureLedger,
        terminalReasons: operationalHealth.terminalReasons,
        transientReasons: operationalHealth.transientReasons,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
        actionableErrors: operationalHealth.actionableErrors,
        reportedFailureCodes: operationalHealth.reportedFailures.map((failure) => failure.code),
        observedFailureCodes: operationalHealth.observedFailures.map((failure) => failure.code),
        operatorMessage: operationalHealth.operatorMessage
      },
      {
        type: 'writeback-policy.commit-plan',
        planId: commitPlan.planId,
        status: commitPlan.status,
        ready: commitPlan.ready,
        dryRun: commitPlan.dryRun,
        commandType: commitPlan.commandType,
        batchId: commitPlan.batchId,
        cursor: commitPlan.cursor,
        writeToken: commitPlan.writeToken,
        providerContractId: commitPlan.providerContractId,
        handoffEnvelopeId: commitPlan.handoffEnvelopeId,
        deliverySemantics: commitPlan.deliverySemantics,
        ackDeadlineMs: commitPlan.ackDeadlineMs,
        mutationCount: commitPlan.mutationCount,
        estimatedByteSize: commitPlan.estimatedByteSize,
        receiptRequired: commitPlan.receiptExpectation.required,
        receiptId: commitPlan.receiptExpectation.receiptId,
        stateTransition: commitPlan.stateTransition,
        failedPreconditionIds: commitPlan.preconditions.filter((check) => !check.pass).map((check) => check.id),
        blockedReasons: commitPlan.blockedReasons,
        mutationIds: commitPlan.mutationSet.map((mutation) => mutation.mutationId)
      },
      {
        type: 'writeback-policy.provider-receipt-settlement',
        contractType: providerReceiptSettlement.contractType,
        settlementId: providerReceiptSettlement.settlementId,
        status: providerReceiptSettlement.status,
        accepted: providerReceiptSettlement.accepted,
        required: providerReceiptSettlement.required,
        providerId: providerReceiptSettlement.providerId,
        contractId: providerReceiptSettlement.contractId,
        receiptId: providerReceiptSettlement.receiptId,
        expectedReceiptId: providerReceiptSettlement.expectedReceiptId,
        receiptState: providerReceiptSettlement.receiptState,
        envelopeId: providerReceiptSettlement.envelopeId,
        ackTopic: providerReceiptSettlement.ackTopic,
        cursor: providerReceiptSettlement.cursor,
        idempotencyKey: providerReceiptSettlement.idempotencyKey,
        tenantId: providerReceiptSettlement.tenantId,
        workspaceId: providerReceiptSettlement.workspaceId,
        receivedAt: providerReceiptSettlement.receivedAt,
        deadlineExpiresAt: providerReceiptSettlement.deadlineExpiresAt,
        receiptAgeMs: providerReceiptSettlement.receiptAgeMs,
        proofRequired: providerReceiptSettlement.proofRequired,
        proofHashPresent: Boolean(providerReceiptSettlement.proofHash),
        validationErrors: providerReceiptSettlement.validationErrors,
        externalHandoffPatch: providerReceiptSettlement.externalHandoffPatch,
        syncCursorPatch: providerReceiptSettlement.syncCursorPatch
      }
    ]
  };
}

export default describeWritebackPolicySurface;
