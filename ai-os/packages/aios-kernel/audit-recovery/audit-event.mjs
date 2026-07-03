export const surfaceId = "aios_audit-recovery_audit-event_071";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "audit-event";

const SUPPORTED_CAPABILITIES = Object.freeze([
  'audit-event.ingest.v1',
  'audit-event.proof.v1',
  'audit-event.sync-metadata.v1',
  'audit-event.external-handoff.v1'
]);

const REQUIRED_PROVIDER_METHODS = Object.freeze([
  'appendAuditEvent',
  'readAuditEvent',
  'commitRecoveryProof'
]);

const TERMINAL_HANDOFF_STATES = new Set(['accepted', 'rejected', 'expired', 'completed']);
const ALLOWED_CLIENT_MODES = new Set(['interactive', 'headless', 'replay']);
const ALLOWED_CLIENT_HANDOFF_CHANNELS = new Set(['inline', 'modal', 'toast', 'background']);
const ALLOWED_RECOVERY_INTENTS = new Set(['ingest', 'replay', 'resume', 'handoff']);
const ALLOWED_COMMANDS = new Set([
  'append-event',
  'commit-proof',
  'resume-recovery',
  'acknowledge-handoff',
  'enable-audit-event',
  'disable-audit-event',
  'update-lifecycle-settings',
  'schedule-recovery'
]);
const RESTART_SAFE_STATUSES = new Set(['pending', 'recovering', 'proof-ready', 'handoff-pending', 'completed', 'blocked']);
const USER_VISIBLE_BLOCKER_LIMIT = 6;
const BOUNDARY_SAFE_COMMANDS = new Set(['resume-recovery', 'enable-audit-event']);
const LIFECYCLE_SAFE_COMMANDS = new Set(['enable-audit-event', 'update-lifecycle-settings', 'schedule-recovery', 'resume-recovery']);
const SETTINGS_UPDATE_COMMANDS = new Set(['update-lifecycle-settings', 'schedule-recovery']);
const ALLOWED_PROOF_MODES = new Set(['strict', 'balanced', 'relaxed']);
const ALLOWED_SCHEDULE_MODES = new Set(['manual', 'immediate', 'scheduled', 'paused']);
const LIFECYCLE_COMMAND_INTENTS = Object.freeze({
  'enable-audit-event': 'enable',
  'disable-audit-event': 'disable',
  'update-lifecycle-settings': 'update-settings',
  'schedule-recovery': 'schedule'
});
const ALLOWED_PROVIDER_TIERS = new Set(['hosted-kernel', 'managed', 'external']);
const ALLOWED_DURABILITY_MODES = new Set(['ephemeral', 'replicated', 'immutable']);
const ALLOWED_OPERATIONAL_HEALTH_STATES = new Set(['healthy', 'degraded', 'failed', 'recovering', 'unknown']);
const ALLOWED_DEGRADED_MODES = new Set(['read-only', 'write-delayed', 'handoff-only', 'proof-only', 'none']);
const ALLOWED_BOUNDARY_ENFORCEMENT_MODES = new Set(['strict', 'workspace-intersection', 'observe']);
const ALLOWED_DELIVERY_ORDERING_MODES = new Set(['sequence', 'causal', 'best-effort']);
const ALLOWED_CONSISTENCY_LEVELS = new Set(['linearizable', 'read-after-write', 'eventual']);
const ALLOWED_EXTERNAL_STATE_SINKS = new Set(['kernel-state', 'provider-callback', 'client-poll', 'none']);
const REQUIRED_SYNC_ADAPTERS_BY_TIER = Object.freeze({
  'hosted-kernel': ['cursor', 'checkpoint', 'proof-commit'],
  managed: ['cursor', 'checkpoint'],
  external: ['cursor']
});
const REQUIRED_HANDOFF_MODES_BY_TIER = Object.freeze({
  'hosted-kernel': ['kernel-state'],
  managed: ['callback'],
  external: ['callback']
});
const ROLE_PERMISSIONS = Object.freeze({
  owner: ['audit-event:read', 'audit-event:append', 'audit-event:commit', 'audit-event:handoff', 'audit-event:configure'],
  admin: ['audit-event:read', 'audit-event:append', 'audit-event:commit', 'audit-event:handoff', 'audit-event:configure'],
  auditor: ['audit-event:read', 'audit-event:append', 'audit-event:handoff'],
  operator: ['audit-event:read', 'audit-event:append'],
  viewer: ['audit-event:read']
});
const COMMAND_PERMISSION_REQUIREMENTS = Object.freeze({
  'append-event': 'audit-event:append',
  'commit-proof': 'audit-event:commit',
  'acknowledge-handoff': 'audit-event:handoff',
  'resume-recovery': 'audit-event:read',
  'enable-audit-event': 'audit-event:configure',
  'disable-audit-event': 'audit-event:configure',
  'update-lifecycle-settings': 'audit-event:configure',
  'schedule-recovery': 'audit-event:configure'
});
const COMMAND_PROVIDER_METHODS = Object.freeze({
  'append-event': 'appendAuditEvent',
  'commit-proof': 'commitRecoveryProof',
  'resume-recovery': 'readAuditEvent',
  'acknowledge-handoff': 'appendAuditEvent',
  'enable-audit-event': 'appendAuditEvent',
  'disable-audit-event': 'appendAuditEvent',
  'update-lifecycle-settings': 'appendAuditEvent',
  'schedule-recovery': 'appendAuditEvent'
});
const MUTATING_COMMANDS = new Set([
  'append-event',
  'commit-proof',
  'acknowledge-handoff',
  'enable-audit-event',
  'disable-audit-event',
  'update-lifecycle-settings',
  'schedule-recovery'
]);
const TERMINAL_RECOVERY_STATUSES = new Set(['completed']);
const COMMAND_RESTART_STALE_MS = 15 * 60 * 1000;
const RESTART_COMMAND_STATUSES = new Set(['completed', 'inflight', 'failed', 'abandoned', 'replay-pending']);
const RECOVERY_ROUTE_ACTIONS_BY_STATUS = Object.freeze({
  pending: 'route.auditRecovery.auditEvent.createCursor',
  recovering: 'route.auditRecovery.auditEvent.resumeRecovery',
  'proof-ready': 'route.auditRecovery.auditEvent.commitProof',
  'handoff-pending': 'route.auditRecovery.auditEvent.acknowledgeHandoff',
  completed: 'route.auditRecovery.auditEvent.openReport',
  blocked: 'route.auditRecovery.auditEvent.repairRecovery'
});
const RECOVERY_COMMANDS_BY_STATUS = Object.freeze({
  pending: 'resume-recovery',
  recovering: 'resume-recovery',
  'proof-ready': 'commit-proof',
  'handoff-pending': 'acknowledge-handoff',
  completed: 'resume-recovery',
  blocked: 'resume-recovery'
});

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCapabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(Boolean))].sort();
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(Boolean))];
}

function normalizeStringListOrSingle(value) {
  return Array.isArray(value) ? normalizeStringList(value) : normalizeString(value) ? [normalizeString(value)] : [];
}

function normalizeIsoTimestamp(value, fallback = null) {
  const timestamp = normalizeString(value);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizeRoleList(value) {
  return normalizeStringList(value).map((role) => role.toLowerCase()).filter((role) => ROLE_PERMISSIONS[role]);
}

function normalizePermissionList(value, roles) {
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  return [...new Set([...normalizeStringList(value), ...rolePermissions])].sort();
}

function normalizePersistedCommandRecord(record, fallbackState, now) {
  const command = asRecord(record);
  const commandId = normalizeString(command.commandId) || normalizeString(command.id);
  const idempotencyKey = normalizeString(command.idempotencyKey) || commandId;
  const statusInput = normalizeString(command.status) || fallbackState;
  const status = ['completed', 'inflight', 'failed', 'abandoned'].includes(statusInput) ? statusInput : fallbackState;

  if (!commandId && !idempotencyKey) return null;

  return {
    commandId: commandId || idempotencyKey,
    idempotencyKey: idempotencyKey || commandId,
    name: normalizeString(command.name) || normalizeString(command.type) || null,
    status,
    statusReason: normalizeString(command.statusReason) || normalizeString(command.reason) || null,
    firstSeenAt: normalizeIsoTimestamp(command.firstSeenAt || command.createdAt, now),
    updatedAt: normalizeIsoTimestamp(command.updatedAt || command.completedAt || command.failedAt, now),
    resultCursor: normalizeString(command.resultCursor) || normalizeString(command.recoveryCursor) || null,
    replayable: command.replayable === false ? false : true
  };
}

function normalizePersistedCommandRecords(value, fallbackState, now) {
  if (!Array.isArray(value)) return [];
  const byKey = new Map();

  for (const rawRecord of value) {
    const record = normalizePersistedCommandRecord(rawRecord, fallbackState, now);
    if (record) byKey.set(record.idempotencyKey, record);
  }

  return [...byKey.values()].sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
}

function shapeRestartCommandRecord(record, completedIds, inflightIds, requestContext, now) {
  const statusFromIds = completedIds.includes(record.idempotencyKey) || completedIds.includes(record.commandId)
    ? 'completed'
    : inflightIds.includes(record.idempotencyKey) || inflightIds.includes(record.commandId)
      ? 'inflight'
      : record.status;
  const normalizedStatus = RESTART_COMMAND_STATUSES.has(statusFromIds) ? statusFromIds : 'failed';
  const updatedAtMs = Date.parse(record.updatedAt);
  const nowMs = Date.parse(now);
  const staleInflight = normalizedStatus === 'inflight'
    && Number.isFinite(updatedAtMs)
    && Number.isFinite(nowMs)
    && nowMs - updatedAtMs > COMMAND_RESTART_STALE_MS;
  const effectiveStatus = staleInflight ? 'replay-pending' : normalizedStatus;
  const restartAction = effectiveStatus === 'completed'
    ? 'return-completed-result'
    : effectiveStatus === 'replay-pending'
      ? 'replay-command'
      : effectiveStatus === 'inflight'
        ? 'poll-inflight-command'
        : record.replayable
          ? 'retry-command'
          : 'operator-repair';

  return {
    schemaVersion: 'audit-event.persisted-command-record.v1',
    commandId: record.commandId,
    idempotencyKey: record.idempotencyKey,
    name: record.name,
    status: effectiveStatus,
    persistedStatus: normalizedStatus,
    statusReason: staleInflight ? 'inflight-command-stale-after-restart' : record.statusReason,
    firstSeenAt: record.firstSeenAt,
    updatedAt: record.updatedAt,
    resultCursor: record.resultCursor,
    replayable: record.replayable,
    staleInflight,
    restartSafe: effectiveStatus === 'completed' || record.replayable,
    restartAction,
    routeAction: restartAction === 'return-completed-result'
      ? 'route.auditRecovery.auditEvent.readCommandResult'
      : restartAction === 'poll-inflight-command'
        ? 'route.auditRecovery.auditEvent.pollCommand'
        : restartAction === 'replay-command'
          ? 'route.auditRecovery.auditEvent.resumeRecovery'
          : restartAction === 'retry-command'
            ? 'route.auditRecovery.auditEvent.retryCommand'
            : 'route.auditRecovery.auditEvent.repairCommand',
    owner: requestContext.sessionId || 'hosted-kernel'
  };
}

function buildRestartCommandJournal(ledgerRecords, completedIds, inflightIds, event, requestContext, now) {
  const shapedRecords = ledgerRecords.map((record) => shapeRestartCommandRecord(
    record,
    completedIds,
    inflightIds,
    requestContext,
    now
  ));
  const byIdempotencyKey = new Map();
  const duplicateKeys = [];

  for (const record of shapedRecords) {
    const existing = byIdempotencyKey.get(record.idempotencyKey);
    if (existing) duplicateKeys.push(record.idempotencyKey);
    if (!existing || existing.status !== 'completed') byIdempotencyKey.set(record.idempotencyKey, record);
  }

  const records = [...byIdempotencyKey.values()].sort((left, right) => (
    left.idempotencyKey.localeCompare(right.idempotencyKey)
  ));
  const completed = records.filter((record) => record.status === 'completed');
  const inflight = records.filter((record) => record.status === 'inflight');
  const replayPending = records.filter((record) => record.status === 'replay-pending');
  const failed = records.filter((record) => record.status === 'failed' || record.status === 'abandoned');
  const replayableFailed = failed.filter((record) => record.replayable);
  const unsafe = records.filter((record) => !record.restartSafe && record.status !== 'completed');
  const nextReplay = replayPending[0] || replayableFailed[0] || null;

  return {
    schemaVersion: 'audit-event.command-journal.v2',
    journalId: `${requestContext.requestId}:${event.eventId}:command-journal`,
    generatedAt: now,
    durableKey: [
      requestContext.tenantId || 'unbound-tenant',
      requestContext.workspaceId || 'unbound-workspace',
      event.eventId,
      'commands'
    ].join(':'),
    records,
    completedIds: [...new Set([...completedIds, ...completed.map((record) => record.idempotencyKey)])].sort(),
    inflightIds: [...new Set(inflight.flatMap((record) => [record.commandId, record.idempotencyKey]))].sort(),
    duplicateIdempotencyKeys: [...new Set(duplicateKeys)].sort(),
    restartStatus: unsafe.length
      ? 'operator-repair-required'
      : replayPending.length || replayableFailed.length
        ? 'replay-required'
        : inflight.length
          ? 'inflight-poll-required'
          : 'restart-safe',
    counts: {
      total: records.length,
      completed: completed.length,
      inflight: inflight.length,
      replayPending: replayPending.length,
      failed: failed.length,
      duplicate: new Set(duplicateKeys).size,
      unsafe: unsafe.length
    },
    replayPlan: {
      required: Boolean(nextReplay),
      commandId: nextReplay?.commandId || null,
      idempotencyKey: nextReplay?.idempotencyKey || null,
      action: nextReplay?.restartAction || 'none',
      routeAction: nextReplay?.routeAction || null,
      reason: nextReplay
        ? nextReplay.status === 'replay-pending'
          ? 'stale-inflight-command'
          : 'failed-replayable-command'
        : 'none'
    },
    validation: unsafe.map((record) => `command ${record.commandId} is not restart-safe`)
  };
}

function buildStateLease(persisted, requestContext, sync, now) {
  const lease = asRecord(persisted.lease || persisted.recoveryLease);
  const leaseMs = normalizePositiveInteger(lease.leaseMs ?? persisted.leaseMs, 300000);
  const acquiredAt = normalizeIsoTimestamp(lease.acquiredAt || persisted.leaseAcquiredAt, now);
  const explicitExpiresAt = normalizeIsoTimestamp(lease.expiresAt || persisted.leaseExpiresAt, null);
  const acquiredAtMs = Date.parse(acquiredAt);
  const computedExpiresAt = Number.isFinite(acquiredAtMs)
    ? new Date(acquiredAtMs + leaseMs).toISOString()
    : null;
  const expiresAt = explicitExpiresAt || computedExpiresAt;
  const nowMs = Date.parse(now);
  const expiresAtMs = Date.parse(expiresAt);
  const expired = Boolean(expiresAt && Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs);
  const owner = normalizeString(lease.owner) || normalizeString(persisted.leaseOwner) || requestContext.sessionId || 'hosted-kernel';

  return {
    leaseId: normalizeString(lease.leaseId) || normalizeString(persisted.leaseId) || `${requestContext.requestId}:state-lease`,
    owner,
    acquiredAt,
    expiresAt,
    leaseMs,
    expired,
    renewable: expired || owner === requestContext.sessionId || owner === 'hosted-kernel',
    renewAction: sync.cursor || expired ? 'route.auditRecovery.auditEvent.renewStateLease' : 'route.auditRecovery.auditEvent.createCursor'
  };
}

function negotiateCapabilities(requestedCapabilities, providerCapabilities = SUPPORTED_CAPABILITIES) {
  const requested = normalizeCapabilityList(requestedCapabilities);
  const providerSupported = normalizeCapabilityList(providerCapabilities).filter((capability) => SUPPORTED_CAPABILITIES.includes(capability));
  const providerSet = new Set(providerSupported.length ? providerSupported : SUPPORTED_CAPABILITIES);
  const supported = new Set(SUPPORTED_CAPABILITIES);
  const accepted = requested.length
    ? requested.filter((capability) => supported.has(capability) && providerSet.has(capability))
    : [...providerSet];

  return {
    mode: accepted.length === SUPPORTED_CAPABILITIES.length ? 'full' : 'partial',
    requested,
    accepted,
    unsupported: requested.filter((capability) => !supported.has(capability) || !providerSet.has(capability)),
    providerSupported: [...providerSet].sort(),
    required: [...SUPPORTED_CAPABILITIES]
  };
}

function normalizeProviderContract(provider = {}) {
  const record = asRecord(provider);
  const serviceContract = asRecord(record.serviceContract || record.contract);
  const sync = asRecord(record.sync || serviceContract.sync);
  const handoff = asRecord(record.handoff || serviceContract.handoff);
  const declaredMethods = Array.isArray(record.methods) ? record.methods : [];
  const availableMethods = new Set(declaredMethods.map(normalizeString).filter(Boolean));
  const missingMethods = REQUIRED_PROVIDER_METHODS.filter((method) => !availableMethods.has(method));
  const providerId = normalizeString(record.providerId) || normalizeString(record.id) || 'unbound-provider';
  const tier = normalizeString(serviceContract.tier) || normalizeString(record.tier) || 'hosted-kernel';
  const durability = normalizeString(serviceContract.durability) || normalizeString(record.durability) || 'replicated';
  const supportedCapabilities = normalizeCapabilityList(
    serviceContract.capabilities || record.capabilities || record.supportedCapabilities || SUPPORTED_CAPABILITIES
  );
  const syncAdapters = normalizeStringList(sync.adapters || serviceContract.syncAdapters || record.syncAdapters);
  const handoffModes = normalizeStringList(handoff.modes || serviceContract.handoffModes || record.handoffModes);
  const requiredSyncAdapters = REQUIRED_SYNC_ADAPTERS_BY_TIER[tier] || REQUIRED_SYNC_ADAPTERS_BY_TIER.external;
  const requiredHandoffModes = REQUIRED_HANDOFF_MODES_BY_TIER[tier] || REQUIRED_HANDOFF_MODES_BY_TIER.external;
  const retentionDays = normalizeNonNegativeInteger(serviceContract.retentionDays ?? record.retentionDays, 90);
  const maxBatchSize = normalizeNonNegativeInteger(serviceContract.maxBatchSize ?? record.maxBatchSize, 100);
  const externalHandoffEnabled = handoff.enabled === false || serviceContract.externalHandoffEnabled === false
    ? false
    : true;
  const validation = [];

  if (!ALLOWED_PROVIDER_TIERS.has(tier)) validation.push(`unsupported provider tier: ${tier}`);
  if (!ALLOWED_DURABILITY_MODES.has(durability)) validation.push(`unsupported durability mode: ${durability}`);
  for (const adapter of requiredSyncAdapters) {
    if (!syncAdapters.includes(adapter)) validation.push(`missing sync adapter: ${adapter}`);
  }
  for (const mode of requiredHandoffModes) {
    if (!handoffModes.includes(mode)) validation.push(`missing handoff mode: ${mode}`);
  }
  if (!supportedCapabilities.length) validation.push('provider must expose at least one audit-event capability');
  if (retentionDays < 1 || retentionDays > 3650) validation.push('provider retentionDays must be between 1 and 3650');
  if (maxBatchSize < 1 || maxBatchSize > 1000) validation.push('provider maxBatchSize must be between 1 and 1000');

  return {
    providerId,
    service: normalizeString(record.service) || normalizeString(serviceContract.service) || 'audit-event-store',
    version: normalizeString(record.version) || 'unversioned',
    endpoint: normalizeString(serviceContract.endpoint) || normalizeString(record.endpoint) || null,
    region: normalizeString(serviceContract.region) || normalizeString(record.region) || 'local',
    tier,
    durability,
    status: missingMethods.length || validation.length ? 'incomplete' : 'ready',
    requiredMethods: [...REQUIRED_PROVIDER_METHODS],
    availableMethods: [...availableMethods].sort(),
    missingMethods,
    supportedCapabilities,
    syncContract: {
      adapters: syncAdapters.sort(),
      requiredAdapters: requiredSyncAdapters,
      cursorNamespace: normalizeString(sync.cursorNamespace) || `${surfaceGroup}:${surfaceName}:${providerId}`,
      checkpointWriteMode: normalizeString(sync.checkpointWriteMode) || (tier === 'hosted-kernel' ? 'atomic' : 'provider-managed')
    },
    handoffContract: {
      enabled: externalHandoffEnabled,
      modes: handoffModes.sort(),
      requiredModes: requiredHandoffModes,
      callbackUrl: normalizeString(handoff.callbackUrl) || null,
      stateLeaseMs: normalizeNonNegativeInteger(handoff.stateLeaseMs, 300000)
    },
    serviceLimits: {
      retentionDays,
      maxBatchSize
    },
    validation
  };
}

function normalizeAuditEvent(event = {}, now) {
  const record = asRecord(event);
  const eventId = normalizeString(record.eventId) || normalizeString(record.id);
  const subject = asRecord(record.subject);
  const actor = asRecord(record.actor);
  const sequence = Number.isSafeInteger(record.sequence) && record.sequence >= 0 ? record.sequence : null;
  const occurredAt = normalizeString(record.occurredAt) || normalizeString(record.timestamp) || now;
  const validation = [];

  if (!eventId) validation.push('eventId is required');
  if (!normalizeString(record.kind)) validation.push('kind is required');
  if (!normalizeString(subject.type) || !normalizeString(subject.id)) validation.push('subject.type and subject.id are required');
  if (sequence === null) validation.push('sequence must be a non-negative integer');

  return {
    eventId: eventId || `pending:${surfaceName}:${occurredAt}`,
    kind: normalizeString(record.kind) || 'unspecified',
    tenantId: normalizeString(record.tenantId) || normalizeString(subject.tenantId) || null,
    workspaceId: normalizeString(record.workspaceId) || normalizeString(subject.workspaceId) || null,
    subject: {
      type: normalizeString(subject.type) || 'unknown',
      id: normalizeString(subject.id) || 'unknown'
    },
    actor: {
      type: normalizeString(actor.type) || 'system',
      id: normalizeString(actor.id) || 'hosted-kernel'
    },
    sequence,
    occurredAt,
    payloadHash: normalizeString(record.payloadHash) || null,
    validation
  };
}

function buildSyncMetadata(input, event, now) {
  const sync = asRecord(input.sync);
  const cursor = normalizeString(sync.cursor) || normalizeString(input.cursor);
  const upstreamCheckpoint = normalizeString(sync.upstreamCheckpoint);
  const downstreamCheckpoint = normalizeString(sync.downstreamCheckpoint);

  return {
    state: event.validation.length ? 'blocked' : cursor ? 'resumable' : 'initial',
    cursor: cursor || null,
    upstreamCheckpoint: upstreamCheckpoint || null,
    downstreamCheckpoint: downstreamCheckpoint || null,
    lastObservedAt: normalizeString(sync.lastObservedAt) || now,
    replayWindow: {
      fromSequence: Number.isSafeInteger(sync.fromSequence) ? sync.fromSequence : event.sequence,
      toSequence: Number.isSafeInteger(sync.toSequence) ? sync.toSequence : event.sequence
    }
  };
}

function normalizePersistedState(input, event, requestContext, sync, now) {
  const persisted = asRecord(input.persistedState || input.state);
  const replay = asRecord(persisted.replay);
  const commands = asRecord(persisted.commands);
  const completedCommandIds = normalizeStringList(commands.completedIds || persisted.completedCommandIds).sort();
  const inflightCommandIds = normalizeStringList(commands.inflightIds || persisted.inflightCommandIds)
    .filter((commandId) => !completedCommandIds.includes(commandId))
    .sort();
  const persistedStatus = normalizeString(persisted.status);
  const lastCommittedSequence = Number.isSafeInteger(persisted.lastCommittedSequence)
    ? persisted.lastCommittedSequence
    : null;
  const nextSequence = Number.isSafeInteger(persisted.nextSequence)
    ? persisted.nextSequence
    : (lastCommittedSequence === null ? event.sequence : lastCommittedSequence + 1);
  const replayFromSequence = Number.isSafeInteger(replay.fromSequence)
    ? replay.fromSequence
    : sync.replayWindow.fromSequence;
  const replayToSequence = Number.isSafeInteger(replay.toSequence)
    ? replay.toSequence
    : sync.replayWindow.toSequence;
  const needsReplay = replayFromSequence !== null
    && replayToSequence !== null
    && replayFromSequence <= replayToSequence
    && (lastCommittedSequence === null || replayToSequence > lastCommittedSequence);
  const blocked = event.validation.length > 0 || sync.state === 'blocked';
  const completedRecords = normalizePersistedCommandRecords(commands.completed || persisted.completedCommands, 'completed', now);
  const inflightRecords = normalizePersistedCommandRecords(commands.inflight || persisted.inflightCommands, 'inflight', now)
    .filter((record) => !completedCommandIds.includes(record.idempotencyKey) && !completedCommandIds.includes(record.commandId));
  const failedRecords = normalizePersistedCommandRecords(commands.failed || persisted.failedCommands, 'failed', now);
  const ledgerRecords = [...completedRecords, ...inflightRecords, ...failedRecords];
  const commandJournal = buildRestartCommandJournal(ledgerRecords, completedCommandIds, inflightCommandIds, event, requestContext, now);
  const lease = buildStateLease(persisted, requestContext, sync, now);
  const journalRequiresReplay = commandJournal.replayPlan.required;
  const journalRequiresRepair = commandJournal.restartStatus === 'operator-repair-required';
  const status = blocked || journalRequiresRepair
    ? 'blocked'
    : RESTART_SAFE_STATUSES.has(persistedStatus)
      ? persistedStatus
      : needsReplay || journalRequiresReplay
        ? 'recovering'
        : 'pending';
  const recoveryCursor = normalizeString(persisted.recoveryCursor) || sync.cursor || null;
  const restartSafe = commandJournal.restartStatus === 'restart-safe'
    && (status !== 'pending' || Boolean(sync.cursor || recoveryCursor));
  const recoveryPathState = blocked
    ? 'repair-required'
    : journalRequiresRepair
      ? 'command-repair-required'
    : status === 'completed'
      ? 'terminal'
    : lease.expired
      ? 'lease-renewal-required'
      : journalRequiresReplay
        ? 'command-replay-required'
      : needsReplay
        ? 'replay-required'
      : restartSafe
            ? 'resumable'
            : 'cursor-required';
  const validation = [];

  if (lastCommittedSequence !== null && nextSequence <= lastCommittedSequence) {
    validation.push('nextSequence must be greater than lastCommittedSequence');
  }
  if (status === 'pending' && !recoveryCursor && !sync.cursor) {
    validation.push('pending persisted state requires a recovery cursor before restart-safe dispatch');
  }
  if (lease.expired && !recoveryCursor && !sync.cursor) {
    validation.push('expired state lease requires cursor recreation before replay');
  }
  for (const reason of commandJournal.validation) validation.push(reason);

  return {
    schemaVersion: 'audit-event.persisted-state.v2',
    stateId: normalizeString(persisted.stateId) || `${requestContext.requestId}:${event.eventId}`,
    durableKey: [
      requestContext.tenantId || 'unbound-tenant',
      requestContext.workspaceId || 'unbound-workspace',
      event.eventId
    ].join(':'),
    eventId: event.eventId,
    requestId: requestContext.requestId,
    status,
    restartSafe,
    terminal: TERMINAL_RECOVERY_STATUSES.has(status),
    recoveryCursor,
    lastCommittedSequence,
    nextSequence,
    lease,
    checkpoint: {
      checkpointId: normalizeString(persisted.checkpointId) || `${requestContext.requestId}:${event.eventId}:checkpoint`,
      cursor: recoveryCursor,
      committedSequence: lastCommittedSequence,
      nextSequence,
      writeMode: sync.cursor ? 'resume-existing-cursor' : 'create-cursor-before-dispatch',
      restartStatus: restartSafe ? 'restart-safe' : 'restart-needs-cursor'
    },
    replay: {
      required: needsReplay || journalRequiresReplay,
      fromSequence: replayFromSequence,
      toSequence: replayToSequence,
      reason: journalRequiresReplay ? commandJournal.replayPlan.reason : needsReplay ? 'persisted-sequence-gap' : 'none',
      maxReplayEvents: replayToSequence !== null && replayFromSequence !== null
        ? Math.max(0, replayToSequence - replayFromSequence + 1)
        : 0
    },
    commands: {
      completedIds: commandJournal.completedIds,
      inflightIds: commandJournal.inflightIds,
      ledger: commandJournal.records,
      ledgerSize: commandJournal.records.length,
      journal: commandJournal
    },
    recoveryPath: {
      state: recoveryPathState,
      command: RECOVERY_COMMANDS_BY_STATUS[status],
      routeAction: RECOVERY_ROUTE_ACTIONS_BY_STATUS[status],
      cursorRequired: !recoveryCursor && !sync.cursor,
      leaseRenewalRequired: lease.expired,
      replayRequired: needsReplay || journalRequiresReplay,
      commandReplayRequired: journalRequiresReplay,
      commandRepairRequired: journalRequiresRepair,
      commandJournalId: commandJournal.journalId,
      reason: validation[0]
        || (blocked || journalRequiresRepair
          ? 'input-contract-blocked'
          : lease.expired
            ? 'state-lease-expired'
            : journalRequiresReplay
              ? commandJournal.replayPlan.reason
            : needsReplay
              ? 'persisted-sequence-gap'
              : restartSafe
                ? 'state-can-resume-after-restart'
                : 'missing-recovery-cursor')
    },
    updatedAt: normalizeIsoTimestamp(persisted.updatedAt, now),
    validation
  };
}

function normalizeNonNegativeInteger(value, fallback = null) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function normalizePositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function buildOperationalHealth(input, contract, sync, persistedState, command, now) {
  const health = asRecord(input.operationalHealth || input.health);
  const providerHealth = asRecord(asRecord(input.provider).health || contract.health);
  const failure = asRecord(health.failure || health.failureState || providerHealth.failure);
  const retry = asRecord(health.retry || providerHealth.retry);
  const rawState = normalizeString(health.state) || normalizeString(providerHealth.state) || 'healthy';
  const state = ALLOWED_OPERATIONAL_HEALTH_STATES.has(rawState) ? rawState : 'unknown';
  const degradedModes = normalizeStringListOrSingle(health.degradedModes || health.degradedMode || providerHealth.degradedModes)
    .filter((mode) => ALLOWED_DEGRADED_MODES.has(mode));
  const lastErrorCode = normalizeString(failure.code) || normalizeString(health.lastErrorCode) || null;
  const lastErrorMessage = normalizeString(failure.message) || normalizeString(health.lastErrorMessage) || null;
  const lastFailureAt = normalizeString(failure.lastFailureAt) || normalizeString(health.lastFailureAt) || null;
  const retryAttempt = normalizeNonNegativeInteger(retry.attempt ?? health.retryAttempt, 0);
  const maxAttempts = normalizePositiveInteger(retry.maxAttempts ?? health.maxRetryAttempts, 5);
  const baseDelayMs = normalizePositiveInteger(retry.baseDelayMs ?? health.retryBaseDelayMs, 1000);
  const maxDelayMs = normalizePositiveInteger(retry.maxDelayMs ?? health.retryMaxDelayMs, 30000);
  const retryAfterMsInput = normalizeNonNegativeInteger(retry.retryAfterMs ?? health.retryAfterMs, null);
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(retryAttempt, 8)));
  const providerUnavailable = state === 'failed' || state === 'unknown';
  const writeDelayed = degradedModes.includes('write-delayed');
  const readOnly = degradedModes.includes('read-only');
  const proofOnly = degradedModes.includes('proof-only');
  const handoffOnly = degradedModes.includes('handoff-only');
  const mutating = MUTATING_COMMANDS.has(command.name);
  const retryable = (providerUnavailable || writeDelayed || state === 'recovering')
    && retryAttempt < maxAttempts
    && command.name !== 'disable-audit-event';
  const retryAfterMs = retryable ? retryAfterMsInput ?? exponentialDelayMs : null;
  const validation = [];
  const nowMs = Date.parse(now);
  const nextAttemptAt = retryAfterMs === null || !Number.isFinite(nowMs)
    ? null
    : new Date(nowMs + retryAfterMs).toISOString();

  if (!ALLOWED_OPERATIONAL_HEALTH_STATES.has(rawState)) validation.push(`unsupported health state: ${rawState}`);
  if (providerUnavailable && !retryable) validation.push('provider health is failed and retry budget is exhausted');
  if (readOnly && mutating) validation.push('provider health is read-only for mutating audit-event command');
  if (proofOnly && command.name !== 'commit-proof' && command.name !== 'resume-recovery') {
    validation.push('provider degraded mode allows proof recovery only');
  }
  if (handoffOnly && command.name !== 'acknowledge-handoff' && command.name !== 'resume-recovery') {
    validation.push('provider degraded mode allows handoff recovery only');
  }
  if (sync.state === 'blocked' && state === 'recovering') {
    validation.push('health recovery cannot proceed while sync metadata is blocked');
  }

  return {
    schemaVersion: 'audit-event.operational-health.v1',
    state,
    observedAt: normalizeString(health.observedAt) || normalizeString(providerHealth.observedAt) || now,
    degraded: state === 'degraded' || degradedModes.length > 0,
    degradedModes: degradedModes.length ? degradedModes : ['none'],
    failureState: {
      active: providerUnavailable || Boolean(lastErrorCode || lastErrorMessage),
      code: lastErrorCode,
      message: lastErrorMessage,
      lastFailureAt,
      actionable: Boolean(lastErrorCode || validation.length),
      operatorAction: normalizeString(failure.operatorAction) || (providerUnavailable ? 'inspect-provider-health' : null)
    },
    retryPolicy: {
      retryable,
      attempt: retryAttempt,
      maxAttempts,
      retryAfterMs,
      backoff: retryable ? 'exponential' : 'none',
      nextAttemptAt
    },
    dispatchGate: {
      providerAvailable: !providerUnavailable,
      writesAllowed: !readOnly && !writeDelayed,
      proofWritesAllowed: !readOnly && !handoffOnly,
      handoffWritesAllowed: !readOnly && !proofOnly,
      restartSafe: persistedState.restartSafe || Boolean(sync.cursor)
    },
    validation
  };
}

function buildHealthDispatchDirective(operationalHealth, command, persistedState, now) {
  const mutating = MUTATING_COMMANDS.has(command.name);
  const degradedMode = operationalHealth.degradedModes.find((mode) => mode !== 'none') || null;
  const exhausted = operationalHealth.failureState.active && !operationalHealth.retryPolicy.retryable;
  const blocksWrite = mutating && !operationalHealth.dispatchGate.writesAllowed && command.name !== 'commit-proof';
  const blocksProof = command.name === 'commit-proof' && !operationalHealth.dispatchGate.proofWritesAllowed;
  const blocksHandoff = command.name === 'acknowledge-handoff' && !operationalHealth.dispatchGate.handoffWritesAllowed;
  const providerUnavailable = !operationalHealth.dispatchGate.providerAvailable;
  const retryableBlock = operationalHealth.retryPolicy.retryable
    && (providerUnavailable || blocksWrite || blocksProof || blocksHandoff || operationalHealth.state === 'recovering');
  const hardBlocked = exhausted || blocksProof || blocksHandoff || (blocksWrite && !operationalHealth.retryPolicy.retryable);
  const mode = hardBlocked
    ? 'blocked'
    : retryableBlock
      ? 'defer-retry'
      : operationalHealth.degraded
        ? 'degraded-dispatch'
        : 'dispatch';
  const reason = operationalHealth.validation[0]
    || operationalHealth.failureState.message
    || operationalHealth.failureState.code
    || (blocksProof
      ? 'proof writes are blocked by provider health'
      : blocksHandoff
        ? 'handoff writes are blocked by provider health'
        : blocksWrite
          ? 'mutating audit-event writes are delayed by provider health'
          : providerUnavailable
            ? 'provider health is unavailable'
            : degradedMode
              ? `provider degraded mode active: ${degradedMode}`
              : 'provider health allows dispatch');
  const staleLeaseDuringRetry = retryableBlock && persistedState.lease.expired;
  const cursor = persistedState.recoveryCursor || persistedState.checkpoint.cursor || null;

  return {
    schemaVersion: 'audit-event.health-dispatch-directive.v1',
    mode,
    commandId: command.commandId,
    commandName: command.name,
    dispatchAllowed: mode === 'dispatch' || mode === 'degraded-dispatch',
    retryScheduled: mode === 'defer-retry',
    blocked: mode === 'blocked',
    reason,
    degradedMode,
    retry: {
      retryable: operationalHealth.retryPolicy.retryable,
      attempt: operationalHealth.retryPolicy.attempt,
      maxAttempts: operationalHealth.retryPolicy.maxAttempts,
      retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
      nextAttemptAt: operationalHealth.retryPolicy.nextAttemptAt
    },
    persistence: {
      stateId: persistedState.stateId,
      recoveryCursor: cursor,
      leaseId: persistedState.lease.leaseId,
      leaseRenewalRequired: staleLeaseDuringRetry,
      commandJournalId: persistedState.commands.journal.journalId,
      retryRecordStatus: retryableBlock ? 'inflight' : hardBlocked ? 'failed' : 'none'
    },
    routeContract: {
      routeAction: mode === 'defer-retry'
        ? 'route.auditRecovery.auditEvent.retryProviderOperation'
        : mode === 'blocked'
          ? 'route.auditRecovery.provider.inspectHealth'
          : degradedMode
            ? 'route.auditRecovery.auditEvent.dispatchDegradedOperation'
            : 'route.auditRecovery.auditEvent.dispatchCommand',
      method: mode === 'blocked' ? 'GET' : 'POST',
      enabled: mode !== 'blocked',
      disabledReason: mode === 'blocked' ? reason : null,
      bodySchema: {
        commandId: 'string',
        idempotencyKey: 'string',
        stateId: 'string',
        retryAfterMs: 'integer|null',
        recoveryCursor: 'string|null'
      },
      body: {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        stateId: persistedState.stateId,
        retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
        recoveryCursor: cursor
      }
    },
    actionableError: mode === 'blocked'
      ? {
          code: operationalHealth.failureState.code || 'audit-event-provider-health-blocked',
          message: reason,
          operatorAction: operationalHealth.failureState.operatorAction || 'inspect-provider-health',
          retryable: false
        }
      : mode === 'defer-retry'
        ? {
            code: operationalHealth.failureState.code || 'audit-event-provider-retry-scheduled',
            message: reason,
            operatorAction: 'wait-for-provider-retry',
            retryable: true
          }
        : null,
    generatedAt: now
  };
}

function normalizeLifecycleSettings(input, requestContext, persistedState, now) {
  const lifecycle = asRecord(input.lifecycle || input.lifecycleSettings);
  const command = asRecord(input.command);
  const commandPayload = asRecord(command.payload);
  const lifecyclePatch = asRecord(command.lifecycle || commandPayload.lifecycle || commandPayload.lifecycleSettings);
  const settingsPatch = asRecord(command.settings || lifecyclePatch.settings || commandPayload.settings);
  const schedulePatch = asRecord(command.schedule || lifecyclePatch.schedule || commandPayload.schedule);
  const requestedCommand = normalizeString(command.name) || normalizeString(command.type);
  const commandIntent = LIFECYCLE_COMMAND_INTENTS[requestedCommand] || null;
  const settings = asRecord(lifecycle.settings || input.settings);
  const schedule = asRecord(lifecycle.schedule || settings.schedule || input.schedule);
  const rawEnabled = typeof lifecycle.enabled === 'boolean'
    ? lifecycle.enabled
    : typeof settings.enabled === 'boolean'
      ? settings.enabled
      : true;
  const requestedEnabled = commandIntent === 'enable'
    ? true
    : commandIntent === 'disable'
      ? false
      : typeof lifecyclePatch.enabled === 'boolean'
        ? lifecyclePatch.enabled
        : typeof settingsPatch.enabled === 'boolean'
          ? settingsPatch.enabled
          : rawEnabled;
  const proofMode = normalizeString(settingsPatch.proofMode) || normalizeString(settings.proofMode) || 'strict';
  const scheduleMode = normalizeString(schedulePatch.mode)
    || (commandIntent === 'schedule' ? 'scheduled' : '')
    || normalizeString(schedule.mode)
    || (normalizeString(schedulePatch.runAt) || normalizeString(schedule.runAt) ? 'scheduled' : 'immediate');
  const runAt = normalizeString(schedulePatch.runAt)
    || normalizeString(lifecyclePatch.nextRunAt)
    || normalizeString(settingsPatch.nextRunAt)
    || normalizeString(schedule.runAt)
    || normalizeString(settings.nextRunAt);
  const runAfterMs = normalizeNonNegativeInteger(schedulePatch.runAfterMs ?? schedule.runAfterMs, null);
  const retentionDays = normalizeNonNegativeInteger(settingsPatch.retentionDays ?? settings.retentionDays, 90);
  const batchSize = normalizeNonNegativeInteger(settingsPatch.batchSize ?? settings.batchSize, 100);
  const maxReplayEvents = normalizeNonNegativeInteger(settingsPatch.maxReplayEvents ?? settings.maxReplayEvents, 1000);
  const validation = [];
  const nowMs = Date.parse(now);
  const runAtMs = runAt ? Date.parse(runAt) : NaN;
  const hasValidRunAt = !runAt || Number.isFinite(runAtMs);
  const relativeRunAt = runAfterMs === null || !Number.isFinite(nowMs)
    ? null
    : new Date(nowMs + runAfterMs).toISOString();
  const effectiveRunAt = runAt || (scheduleMode === 'scheduled' ? relativeRunAt : null);
  const effectiveRunAtMs = effectiveRunAt ? Date.parse(effectiveRunAt) : NaN;
  const scheduleDue = scheduleMode === 'immediate'
    || (hasValidRunAt && Number.isFinite(nowMs) && Number.isFinite(runAtMs) && runAtMs <= nowMs)
    || (runAfterMs !== null && runAfterMs === 0);

  if (!ALLOWED_PROOF_MODES.has(proofMode)) validation.push(`unsupported proofMode: ${proofMode}`);
  if (!ALLOWED_SCHEDULE_MODES.has(scheduleMode)) validation.push(`unsupported schedule mode: ${scheduleMode}`);
  if (!hasValidRunAt) validation.push('schedule.runAt must be an ISO timestamp');
  if (effectiveRunAt && !Number.isFinite(effectiveRunAtMs)) validation.push('effective schedule time must be an ISO timestamp');
  if (retentionDays < 1 || retentionDays > 3650) validation.push('settings.retentionDays must be between 1 and 3650');
  if (batchSize < 1 || batchSize > 1000) validation.push('settings.batchSize must be between 1 and 1000');
  if (maxReplayEvents < 1 || maxReplayEvents > 100000) validation.push('settings.maxReplayEvents must be between 1 and 100000');
  if (scheduleMode === 'scheduled' && !runAt && runAfterMs === null) {
    validation.push('scheduled recovery requires schedule.runAt or schedule.runAfterMs');
  }
  if (scheduleMode === 'paused' && requestedEnabled) {
    validation.push('paused schedule requires lifecycle.enabled=false');
  }
  if (commandIntent === 'schedule' && scheduleMode === 'manual') {
    validation.push('schedule-recovery command requires immediate, scheduled, or paused mode');
  }
  if (commandIntent === 'disable' && !normalizeString(lifecyclePatch.disabledReason) && !normalizeString(settingsPatch.disabledReason)) {
    validation.push('disable-audit-event requires a disabledReason');
  }

  const disabledReason = normalizeString(lifecyclePatch.disabledReason)
    || normalizeString(settingsPatch.disabledReason)
    || normalizeString(lifecycle.disabledReason)
    || normalizeString(settings.disabledReason)
    || null;
  const state = !requestedEnabled
    ? 'disabled'
    : validation.length
      ? 'invalid-settings'
      : scheduleMode === 'paused'
        ? 'paused'
        : scheduleMode === 'scheduled' && !scheduleDue
          ? 'scheduled'
          : persistedState.status === 'completed'
            ? 'completed'
            : 'enabled';

  return {
    lifecycleId: normalizeString(lifecycle.lifecycleId) || `${requestContext.requestId}:lifecycle`,
    schemaVersion: 'audit-event.lifecycle-settings.v2',
    enabled: requestedEnabled,
    state,
    disabledReason,
    commandIntent,
    settings: {
      proofMode,
      retentionDays,
      batchSize,
      maxReplayEvents,
      requireOperatorAcceptance: settingsPatch.requireOperatorAcceptance === false || settings.requireOperatorAcceptance === false ? false : true
    },
    schedule: {
      mode: scheduleMode,
      runAt: effectiveRunAt,
      runAfterMs,
      due: scheduleDue,
      nextRunAt: scheduleMode === 'scheduled' ? effectiveRunAt : null,
      paused: scheduleMode === 'paused'
    },
    effectiveChange: {
      command: requestedCommand || null,
      intent: commandIntent,
      changed: Boolean(commandIntent || Object.keys(lifecyclePatch).length || Object.keys(settingsPatch).length || Object.keys(schedulePatch).length),
      enabledBefore: rawEnabled,
      enabledAfter: requestedEnabled,
      stateBefore: persistedState.status,
      stateAfter: state,
      settingsPatch: {
        proofModeChanged: normalizeString(settingsPatch.proofMode) ? normalizeString(settingsPatch.proofMode) !== normalizeString(settings.proofMode) : false,
        retentionDaysChanged: settingsPatch.retentionDays !== undefined && retentionDays !== normalizeNonNegativeInteger(settings.retentionDays, 90),
        batchSizeChanged: settingsPatch.batchSize !== undefined && batchSize !== normalizeNonNegativeInteger(settings.batchSize, 100),
        maxReplayEventsChanged: settingsPatch.maxReplayEvents !== undefined && maxReplayEvents !== normalizeNonNegativeInteger(settings.maxReplayEvents, 1000)
      },
      schedulePatch: {
        modeChanged: normalizeString(schedulePatch.mode) ? normalizeString(schedulePatch.mode) !== normalizeString(schedule.mode) : false,
        runAtChanged: Boolean(effectiveRunAt && effectiveRunAt !== (normalizeString(schedule.runAt) || normalizeString(settings.nextRunAt))),
        dueNow: scheduleDue
      }
    },
    controls: {
      canEnable: !requestedEnabled || validation.length > 0,
      canDisable: requestedEnabled,
      canUpdateSettings: true,
      canRunNow: requestedEnabled && !validation.length && scheduleMode !== 'paused',
      canSchedule: requestedEnabled && !validation.length,
      canPause: requestedEnabled && !validation.length && scheduleMode !== 'paused',
      canResume: !requestedEnabled || scheduleMode === 'paused',
      routeActions: {
        enable: 'route.auditRecovery.auditEvent.enableLifecycle',
        disable: 'route.auditRecovery.auditEvent.disableLifecycle',
        updateSettings: 'route.auditRecovery.auditEvent.updateLifecycleSettings',
        schedule: 'route.auditRecovery.auditEvent.scheduleRecovery',
        runNow: 'route.auditRecovery.auditEvent.runRecoveryNow'
      }
    },
    validation
  };
}

function normalizeRequestContext(input, now) {
  const request = asRecord(input.request);
  const headers = asRecord(request.headers);
  const workspace = asRecord(request.workspace || input.workspace);
  const recoveryIntent = normalizeString(request.recoveryIntent) || normalizeString(input.intent) || 'ingest';
  const requestedAt = normalizeString(request.requestedAt) || normalizeString(input.requestedAt) || now;
  const requestId = normalizeString(request.requestId)
    || normalizeString(input.requestId)
    || `${surfaceName}:${requestedAt}`;
  const tenantId = normalizeString(request.tenantId) || normalizeString(headers['x-aios-tenant']) || null;
  const workspaceId = normalizeString(request.workspaceId)
    || normalizeString(workspace.workspaceId)
    || normalizeString(workspace.id)
    || null;

  return {
    requestId,
    route: normalizeString(request.route) || `${surfaceGroup}/${surfaceName}`,
    recoveryIntent: ALLOWED_RECOVERY_INTENTS.has(recoveryIntent) ? recoveryIntent : 'ingest',
    requestedAt,
    tenantId,
    workspaceId,
    workspaceBinding: tenantId && workspaceId ? `${tenantId}:${workspaceId}` : null,
    sessionId: normalizeString(request.sessionId) || normalizeString(headers['x-aios-session']) || null,
    correlationId: normalizeString(request.correlationId) || normalizeString(headers['x-correlation-id']) || requestId
  };
}

function normalizeTenantBoundary(input, requestContext, event) {
  const boundary = asRecord(input.boundary || input.tenantBoundary);
  const actor = asRecord(boundary.actor || input.actor);
  const request = asRecord(input.request);
  const workspace = asRecord(request.workspace || input.workspace);
  const eventTenantId = normalizeString(event.tenantId) || normalizeString(boundary.eventTenantId);
  const eventWorkspaceId = normalizeString(event.workspaceId) || normalizeString(boundary.eventWorkspaceId);
  const actorTenantId = normalizeString(actor.tenantId) || normalizeString(boundary.actorTenantId) || null;
  const actorWorkspaceId = normalizeString(actor.workspaceId) || normalizeString(boundary.actorWorkspaceId) || null;
  const roles = normalizeRoleList(boundary.roles || actor.roles || input.roles);
  const permissions = normalizePermissionList(boundary.permissions || actor.permissions || input.permissions, roles);
  const allowedTenantIds = normalizeStringList(boundary.allowedTenantIds || boundary.tenants);
  const deniedTenantIds = normalizeStringList(boundary.deniedTenantIds || boundary.blockedTenants);
  const allowedWorkspaceIds = normalizeStringList(boundary.allowedWorkspaceIds || boundary.workspaces);
  const deniedWorkspaceIds = normalizeStringList(boundary.deniedWorkspaceIds || boundary.blockedWorkspaces);
  const requestedWorkspaceIds = normalizeStringList(
    boundary.requestedWorkspaceIds
    || request.workspaceIds
    || workspace.workspaceIds
    || (requestContext.workspaceId ? [requestContext.workspaceId] : [])
  );
  const enforcementModeInput = normalizeString(boundary.enforcementMode) || normalizeString(boundary.mode) || 'strict';
  const enforcementMode = ALLOWED_BOUNDARY_ENFORCEMENT_MODES.has(enforcementModeInput) ? enforcementModeInput : 'strict';
  const effectiveWorkspaceIds = allowedWorkspaceIds.length
    ? allowedWorkspaceIds
    : requestContext.workspaceId
      ? [requestContext.workspaceId]
      : [];
  const effectiveTenantIds = allowedTenantIds.length
    ? allowedTenantIds
    : requestContext.tenantId
      ? [requestContext.tenantId]
      : [];
  const effectiveWorkspaceSet = new Set(effectiveWorkspaceIds);
  const deniedWorkspaceSet = new Set(deniedWorkspaceIds);
  const scopedWorkspaceIds = requestedWorkspaceIds.length
    ? requestedWorkspaceIds.filter((workspaceId) => effectiveWorkspaceSet.has(workspaceId) && !deniedWorkspaceSet.has(workspaceId))
    : effectiveWorkspaceIds.filter((workspaceId) => !deniedWorkspaceSet.has(workspaceId));
  const rejectedWorkspaceIds = requestedWorkspaceIds.filter((workspaceId) => (
    !effectiveWorkspaceSet.has(workspaceId) || deniedWorkspaceSet.has(workspaceId)
  ));
  const deniedWorkspaceConflictIds = [...new Set([
    ...effectiveWorkspaceIds.filter((workspaceId) => deniedWorkspaceSet.has(workspaceId)),
    ...requestedWorkspaceIds.filter((workspaceId) => deniedWorkspaceSet.has(workspaceId))
  ])].sort();
  const requestWorkspaceScoped = !requestContext.workspaceId || scopedWorkspaceIds.includes(requestContext.workspaceId);
  const actorTenantMatches = !actorTenantId || !requestContext.tenantId || actorTenantId === requestContext.tenantId;
  const actorWorkspaceMatches = !actorWorkspaceId || !requestContext.workspaceId || actorWorkspaceId === requestContext.workspaceId;
  const tenantBound = Boolean(requestContext.tenantId);
  const workspaceBound = Boolean(requestContext.workspaceId);
  const tenantMatches = !eventTenantId || !requestContext.tenantId || eventTenantId === requestContext.tenantId;
  const workspaceMatches = !eventWorkspaceId || !requestContext.workspaceId || eventWorkspaceId === requestContext.workspaceId;
  const workspaceAllowed = !requestContext.workspaceId || !effectiveWorkspaceIds.length || effectiveWorkspaceIds.includes(requestContext.workspaceId);
  const tenantAllowed = !requestContext.tenantId
    || !effectiveTenantIds.length
    || effectiveTenantIds.includes(requestContext.tenantId);
  const tenantDenied = Boolean(requestContext.tenantId && deniedTenantIds.includes(requestContext.tenantId));
  const workspaceDenied = Boolean(requestContext.workspaceId && deniedWorkspaceSet.has(requestContext.workspaceId));
  const workspaceEscalationAttempted = requestedWorkspaceIds.some((workspaceId) => (
    workspaceId !== requestContext.workspaceId && !effectiveWorkspaceSet.has(workspaceId)
  ));
  const validation = [];

  if (!ALLOWED_BOUNDARY_ENFORCEMENT_MODES.has(enforcementModeInput)) {
    validation.push(`unsupported boundary enforcement mode: ${enforcementModeInput}`);
  }
  if (!tenantBound) validation.push('tenantId is required for hosted-kernel audit recovery');
  if (!workspaceBound) validation.push('workspaceId is required for hosted-kernel audit recovery');
  if (!tenantAllowed) validation.push('request tenant is outside actor boundary');
  if (tenantDenied) validation.push('request tenant is explicitly denied by actor boundary');
  if (!actorTenantMatches) validation.push('actor tenant does not match request tenant');
  if (!actorWorkspaceMatches) validation.push('actor workspace does not match request workspace');
  if (!tenantMatches) validation.push('event tenant does not match request tenant');
  if (!workspaceMatches) validation.push('event workspace does not match request workspace');
  if (!workspaceAllowed) validation.push('request workspace is outside actor boundary');
  if (workspaceDenied) validation.push('request workspace is explicitly denied by actor boundary');
  if (!requestWorkspaceScoped) validation.push('request workspace was removed by scoped workspace intersection');
  if (workspaceEscalationAttempted && enforcementMode === 'strict') {
    validation.push('requested workspace set attempts to cross actor boundary');
  }
  if (requestedWorkspaceIds.length && !scopedWorkspaceIds.length) {
    validation.push('no requested workspaces remain inside actor boundary');
  }
  if (!permissions.includes('audit-event:read')) validation.push('audit-event:read permission is required');

  const accessState = validation.length
    ? enforcementMode === 'observe'
      ? 'observed-risk'
      : 'denied'
    : rejectedWorkspaceIds.length
      ? 'reduced'
      : 'granted';

  return {
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    workspaceBinding: requestContext.workspaceBinding,
    actorId: normalizeString(actor.actorId) || normalizeString(actor.id) || event.actor.id,
    actorScope: {
      tenantId: actorTenantId,
      workspaceId: actorWorkspaceId,
      tenantMatches: actorTenantMatches,
      workspaceMatches: actorWorkspaceMatches
    },
    roles,
    permissions,
    allowedTenantIds: effectiveTenantIds.sort(),
    deniedTenantIds: deniedTenantIds.sort(),
    allowedWorkspaceIds: effectiveWorkspaceIds.sort(),
    deniedWorkspaceIds: deniedWorkspaceIds.sort(),
    requestedWorkspaceIds: requestedWorkspaceIds.sort(),
    scopedWorkspaceIds: scopedWorkspaceIds.sort(),
    rejectedWorkspaceIds: rejectedWorkspaceIds.sort(),
    eventScope: {
      tenantId: eventTenantId || requestContext.tenantId,
      workspaceId: eventWorkspaceId || requestContext.workspaceId
    },
    isolation: {
      tenantBound,
      workspaceBound,
      tenantMatches,
      workspaceMatches,
      tenantAllowed,
      tenantDenied,
      workspaceAllowed,
      workspaceDenied,
      requestWorkspaceScoped,
      workspaceEscalationAttempted,
      deniedWorkspaceConflictIds
    },
    accessDecision: {
      schemaVersion: 'audit-event.tenant-access-decision.v1',
      state: accessState,
      enforcementMode,
      reason: validation[0] || (rejectedWorkspaceIds.length ? 'workspace-scope-reduced' : 'workspace-scope-granted'),
      handoffAllowed: accessState === 'granted' || accessState === 'reduced',
      auditHandoffRequired: accessState !== 'granted' || workspaceEscalationAttempted || deniedWorkspaceConflictIds.length > 0,
      scopeHash: [
        requestContext.tenantId || 'unbound-tenant',
        requestContext.workspaceId || 'unbound-workspace',
        scopedWorkspaceIds.join(',') || 'no-scoped-workspaces',
        roles.join(',') || 'no-roles',
        permissions.join(',') || 'no-permissions'
      ].join('|')
    },
    validation
  };
}

function normalizeClientRuntime(input, requestContext, sync, event, persistedState, now) {
  const client = asRecord(input.client);
  const state = asRecord(client.state);
  const route = asRecord(client.route || state.route);
  const handoff = asRecord(client.handoff || state.handoff);
  const pendingActions = normalizeCapabilityList(client.pendingActions || state.pendingActions);
  const lastRenderedEventId = normalizeString(state.lastRenderedEventId) || normalizeString(client.lastRenderedEventId);
  const clientMode = normalizeString(client.mode) || 'interactive';
  const clientVersion = normalizeString(client.version) || normalizeString(input.clientVersion) || 'unversioned-client';
  const recoveryCursor = normalizeString(state.recoveryCursor) || sync.cursor || persistedState.recoveryCursor || null;
  const currentRoute = normalizeString(route.current)
    || normalizeString(client.currentRoute)
    || normalizeString(state.currentRoute)
    || null;
  const expectedRoute = requestContext.route;
  const sessionId = normalizeString(client.sessionId) || normalizeString(state.sessionId) || requestContext.sessionId;
  const tenantId = normalizeString(client.tenantId) || normalizeString(state.tenantId) || requestContext.tenantId;
  const workspaceId = normalizeString(client.workspaceId) || normalizeString(state.workspaceId) || requestContext.workspaceId;
  const handoffChannelInput = normalizeString(handoff.channel) || normalizeString(client.handoffChannel);
  const handoffChannel = ALLOWED_CLIENT_HANDOFF_CHANNELS.has(handoffChannelInput)
    ? handoffChannelInput
    : clientMode === 'headless'
      ? 'background'
      : 'inline';
  const stateRevision = normalizeNonNegativeInteger(state.revision ?? client.stateRevision, 0);
  const cursorMatchesSync = !sync.cursor || !recoveryCursor || sync.cursor === recoveryCursor;
  const requestSessionMatches = !requestContext.sessionId || !sessionId || requestContext.sessionId === sessionId;
  const tenantMatches = !requestContext.tenantId || !tenantId || requestContext.tenantId === tenantId;
  const workspaceMatches = !requestContext.workspaceId || !workspaceId || requestContext.workspaceId === workspaceId;
  const routeBound = !currentRoute || currentRoute === expectedRoute;
  const focusEventId = normalizeString(state.focusEventId) || lastRenderedEventId || event.eventId;
  const validation = [];

  if (!ALLOWED_CLIENT_MODES.has(clientMode)) validation.push(`unsupported client mode: ${clientMode}`);
  if (handoffChannelInput && !ALLOWED_CLIENT_HANDOFF_CHANNELS.has(handoffChannelInput)) {
    validation.push(`unsupported handoff channel: ${handoffChannelInput}`);
  }
  if (!requestSessionMatches) validation.push('client session does not match request session');
  if (!tenantMatches) validation.push('client tenant does not match request tenant');
  if (!workspaceMatches) validation.push('client workspace does not match request workspace');
  if (!routeBound) validation.push('client route is not bound to audit-event recovery route');
  if (!cursorMatchesSync) validation.push('client recovery cursor is stale against sync cursor');
  if (clientMode === 'headless' && handoffChannel !== 'background') {
    validation.push('headless clients must use background handoff channel');
  }

  return {
    clientId: normalizeString(client.clientId) || normalizeString(client.id) || `client:${requestContext.requestId}`,
    mode: ALLOWED_CLIENT_MODES.has(clientMode) ? clientMode : 'interactive',
    version: clientVersion,
    sessionId,
    tenantId,
    workspaceId,
    routeBinding: {
      currentRoute,
      expectedRoute,
      routeBound
    },
    state: {
      focusEventId,
      lastRenderedEventId: lastRenderedEventId || null,
      pendingActions,
      recoveryCursor,
      revision: stateRevision,
      hydratedAt: normalizeString(state.hydratedAt) || now
    },
    handoffUi: {
      channel: handoffChannel,
      visible: clientMode !== 'headless' && handoffChannel !== 'background',
      preferredAction: normalizeString(handoff.preferredAction) || 'review-audit-event',
      leaseAckRequired: handoff.leaseAckRequired === false ? false : true
    },
    adoption: {
      requestBound: Boolean(requestContext.requestId),
      sessionBound: requestSessionMatches,
      routeBound,
      tenantBound: tenantMatches,
      workspaceBound: workspaceMatches,
      cursorBound: Boolean(sync.cursor || state.recoveryCursor || persistedState.recoveryCursor),
      cursorFresh: cursorMatchesSync,
      canRenderHandoff: clientMode !== 'headless' && handoffChannel !== 'background',
      hasPendingUserAction: pendingActions.length > 0,
      adopted: requestSessionMatches && tenantMatches && workspaceMatches && routeBound && cursorMatchesSync
    },
    validation
  };
}

function buildExternalHandoff(input, event, contract, requestContext, clientRuntime, tenantBoundary) {
  const handoff = asRecord(input.externalHandoff);
  const requestedState = normalizeString(handoff.state) || 'pending';
  const isTerminal = TERMINAL_HANDOFF_STATES.has(requestedState);
  const target = normalizeString(handoff.target) || normalizeString(handoff.providerId) || contract.providerId;
  const displayMode = clientRuntime.handoffUi.visible ? 'visible' : 'background';
  const boundaryBlocked = tenantBoundary.validation.length > 0;
  const providerBlocked = contract.validation.length > 0 || contract.missingMethods.length > 0;
  const handoffDisabled = !contract.handoffContract.enabled;
  const requestedMode = normalizeString(handoff.mode)
    || (displayMode === 'background' && contract.handoffContract.modes.includes('callback')
      ? 'callback'
      : contract.handoffContract.requiredModes[0]);
  const modeSupported = contract.handoffContract.modes.includes(requestedMode);
  const blockedReason = boundaryBlocked
    ? 'tenant-boundary'
    : providerBlocked
      ? 'provider-contract'
      : handoffDisabled
        ? 'handoff-disabled'
        : !modeSupported
          ? 'handoff-mode'
          : null;
  const effectiveState = blockedReason
    ? 'rejected'
    : isTerminal || requestedState === 'pending'
      ? requestedState
      : 'pending';

  return {
    handoffId: normalizeString(handoff.handoffId) || `${event.eventId}:${target}`,
    target,
    mode: requestedMode,
    state: effectiveState,
    terminal: Boolean(blockedReason) || isTerminal,
    blockedReason,
    requestId: requestContext.requestId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    clientId: clientRuntime.clientId,
    displayMode,
    clientChannel: clientRuntime.handoffUi.channel,
    callbackUrl: requestedMode === 'callback' ? contract.handoffContract.callbackUrl : null,
    stateLeaseMs: contract.handoffContract.stateLeaseMs,
    acknowledgedAt: normalizeString(handoff.acknowledgedAt) || null,
    retryAfterMs: Number.isSafeInteger(handoff.retryAfterMs) && handoff.retryAfterMs >= 0 ? handoff.retryAfterMs : null,
    nextUserAction: blockedReason || isTerminal
      ? 'none'
      : displayMode === 'visible'
        ? 'review-audit-event'
        : 'poll-handoff-status'
  };
}

function buildProviderServiceBinding(input, contract, capabilities, sync, handoff, requestContext, command, now) {
  const provider = asRecord(input.provider);
  const serviceContract = asRecord(provider.serviceContract || provider.contract);
  const binding = asRecord(input.providerBinding || serviceContract.binding || provider.binding);
  const delivery = asRecord(binding.delivery || serviceContract.delivery || provider.delivery);
  const externalState = asRecord(binding.externalState || binding.handoffState || serviceContract.externalState);
  const requestedBatchSize = normalizePositiveInteger(
    delivery.batchSize ?? binding.batchSize ?? command.batchSize,
    Math.min(contract.serviceLimits.maxBatchSize, 100)
  );
  const batchSize = Math.min(requestedBatchSize, contract.serviceLimits.maxBatchSize);
  const orderingInput = normalizeString(delivery.ordering) || normalizeString(binding.ordering) || 'sequence';
  const consistencyInput = normalizeString(delivery.consistency) || normalizeString(binding.consistency)
    || (contract.tier === 'hosted-kernel' ? 'linearizable' : 'read-after-write');
  const stateSinkInput = normalizeString(externalState.sink) || normalizeString(binding.stateSink)
    || (contract.tier === 'hosted-kernel' ? 'kernel-state' : 'provider-callback');
  const requiresProofCommit = capabilities.accepted.includes('audit-event.proof.v1') || command.name === 'commit-proof';
  const requiresExternalHandoff = capabilities.accepted.includes('audit-event.external-handoff.v1')
    || command.name === 'acknowledge-handoff'
    || handoff.state === 'pending';
  const requiresSyncMetadata = capabilities.accepted.includes('audit-event.sync-metadata.v1')
    || sync.state !== 'initial'
    || command.name === 'resume-recovery';
  const validation = [];

  if (!ALLOWED_DELIVERY_ORDERING_MODES.has(orderingInput)) validation.push(`unsupported delivery ordering: ${orderingInput}`);
  if (!ALLOWED_CONSISTENCY_LEVELS.has(consistencyInput)) validation.push(`unsupported consistency level: ${consistencyInput}`);
  if (!ALLOWED_EXTERNAL_STATE_SINKS.has(stateSinkInput)) validation.push(`unsupported external state sink: ${stateSinkInput}`);
  if (requestedBatchSize > contract.serviceLimits.maxBatchSize) {
    validation.push(`requested batchSize exceeds provider maxBatchSize: ${contract.serviceLimits.maxBatchSize}`);
  }
  if (contract.tier === 'hosted-kernel' && orderingInput !== 'sequence') {
    validation.push('hosted-kernel provider binding requires sequence ordering');
  }
  if (contract.tier === 'hosted-kernel' && consistencyInput !== 'linearizable') {
    validation.push('hosted-kernel provider binding requires linearizable consistency');
  }
  if (requiresProofCommit && !contract.syncContract.adapters.includes('proof-commit')) {
    validation.push('proof capability requires proof-commit sync adapter');
  }
  if (requiresSyncMetadata && !contract.syncContract.adapters.includes('checkpoint')) {
    validation.push('sync metadata capability requires checkpoint adapter');
  }
  if (requiresExternalHandoff && !contract.handoffContract.modes.includes(handoff.mode)) {
    validation.push(`handoff mode is not available from provider binding: ${handoff.mode}`);
  }
  if (requiresExternalHandoff && stateSinkInput === 'none') {
    validation.push('external handoff capability requires a persisted handoff state sink');
  }
  if (stateSinkInput === 'provider-callback' && !contract.handoffContract.callbackUrl) {
    validation.push('provider-callback handoff state sink requires callbackUrl');
  }

  return {
    schemaVersion: 'audit-event.provider-service-binding.v1',
    bindingId: normalizeString(binding.bindingId) || `${requestContext.requestId}:${contract.providerId}:service-binding`,
    generatedAt: now,
    providerId: contract.providerId,
    tier: contract.tier,
    capabilityNegotiation: {
      requested: capabilities.requested,
      accepted: capabilities.accepted,
      unsupported: capabilities.unsupported,
      requiredForCommand: [
        'audit-event.ingest.v1',
        requiresProofCommit ? 'audit-event.proof.v1' : null,
        requiresSyncMetadata ? 'audit-event.sync-metadata.v1' : null,
        requiresExternalHandoff ? 'audit-event.external-handoff.v1' : null
      ].filter(Boolean),
      complete: capabilities.unsupported.length === 0 && capabilities.accepted.length > 0
    },
    deliveryContract: {
      ordering: ALLOWED_DELIVERY_ORDERING_MODES.has(orderingInput) ? orderingInput : 'sequence',
      consistency: ALLOWED_CONSISTENCY_LEVELS.has(consistencyInput) ? consistencyInput : 'linearizable',
      batchSize,
      requestedBatchSize,
      maxBatchSize: contract.serviceLimits.maxBatchSize,
      idempotencyKey: command.idempotencyKey,
      cursorNamespace: contract.syncContract.cursorNamespace
    },
    syncMetadataContract: {
      required: requiresSyncMetadata,
      state: sync.state,
      cursor: sync.cursor,
      checkpointWriteMode: contract.syncContract.checkpointWriteMode,
      adapters: contract.syncContract.adapters,
      replayWindow: sync.replayWindow
    },
    externalHandoffState: {
      required: requiresExternalHandoff,
      handoffId: handoff.handoffId,
      handoffState: handoff.state,
      sink: ALLOWED_EXTERNAL_STATE_SINKS.has(stateSinkInput) ? stateSinkInput : 'kernel-state',
      leaseMs: contract.handoffContract.stateLeaseMs,
      callbackUrl: stateSinkInput === 'provider-callback' ? contract.handoffContract.callbackUrl : null
    },
    validation
  };
}

function buildWorkflowHandoff(event, requestContext, clientRuntime, sync, externalHandoff, proofReady) {
  const blockers = [];
  const validation = [];
  if (event.validation.length) blockers.push('event-contract');
  if (!clientRuntime.adoption.requestBound) blockers.push('request-context');
  if (!clientRuntime.adoption.adopted) blockers.push('client-runtime');
  if (sync.state === 'blocked') blockers.push('sync-metadata');
  if (externalHandoff.blockedReason === 'provider-contract') blockers.push('provider-contract');
  if (externalHandoff.blockedReason === 'handoff-mode') blockers.push('handoff-mode');
  if (externalHandoff.terminal) blockers.push(`handoff-${externalHandoff.state}`);

  const step = proofReady && !blockers.length
    ? externalHandoff.nextUserAction
    : 'repair-audit-event';
  const visible = clientRuntime.mode !== 'headless' && step !== 'none';
  const recoveryCursor = sync.cursor || `${event.eventId}:${event.sequence ?? 'pending'}`;
  const hydrationRequired = !clientRuntime.adoption.adopted
    || clientRuntime.state.focusEventId !== event.eventId
    || clientRuntime.state.recoveryCursor !== recoveryCursor;
  const routeAction = step === 'review-audit-event'
    ? 'client.auditEvent.openPreview'
    : step === 'poll-handoff-status'
      ? 'client.auditEvent.pollHandoffStatus'
      : step === 'none'
        ? 'client.auditEvent.closeHandoff'
        : 'client.auditEvent.repairRecovery';
  const workflowState = externalHandoff.terminal
    ? 'terminal'
    : blockers.length
      ? 'repair-required'
      : step === 'poll-handoff-status'
        ? 'background-poll'
        : 'handoff-ready';
  const pendingActions = step === 'review-audit-event'
    ? [...new Set([...clientRuntime.state.pendingActions, 'acknowledge-audit-event'])]
    : step === 'poll-handoff-status'
      ? [...new Set([...clientRuntime.state.pendingActions, 'poll-handoff-status'])]
      : clientRuntime.state.pendingActions;
  const clientStatePatch = {
    schemaVersion: 'audit-event.client-state-patch.v1',
    focusEventId: event.eventId,
    recoveryCursor,
    revision: clientRuntime.state.revision + 1,
    route: requestContext.route,
    sessionId: requestContext.sessionId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    handoffChannel: externalHandoff.clientChannel,
    pendingActions
  };

  if (visible && !requestContext.sessionId) validation.push('visible workflow handoff requires a request sessionId');
  if (step === 'review-audit-event' && !clientRuntime.adoption.canRenderHandoff) {
    validation.push('review handoff requires a renderable client handoff channel');
  }
  if (step === 'poll-handoff-status' && externalHandoff.mode !== 'callback' && externalHandoff.displayMode !== 'background') {
    validation.push('poll handoff requires callback mode or background display');
  }
  if (hydrationRequired && clientRuntime.mode === 'headless' && externalHandoff.displayMode === 'visible') {
    validation.push('headless clients cannot hydrate a visible workflow handoff');
  }

  return {
    schemaVersion: 'audit-event.workflow-handoff.v2',
    workflowId: `${requestContext.requestId}:${event.eventId}`,
    state: workflowState,
    step,
    routeAction,
    userVisible: visible,
    resumeCursor: recoveryCursor,
    handoffId: externalHandoff.handoffId,
    handoffState: externalHandoff.state,
    displayMode: externalHandoff.displayMode,
    clientId: clientRuntime.clientId,
    blockers,
    hydration: {
      required: hydrationRequired,
      reason: hydrationRequired
        ? clientRuntime.adoption.adopted
          ? 'client-focus-or-cursor-stale'
          : 'client-runtime-not-adopted'
        : 'already-hydrated',
      currentRevision: clientRuntime.state.revision,
      nextRevision: clientStatePatch.revision,
      cursorFresh: clientRuntime.adoption.cursorFresh,
      routeBound: clientRuntime.adoption.routeBound
    },
    userActionContract: {
      actionId: `${requestContext.requestId}:${event.eventId}:${step}`,
      routeAction,
      method: step === 'poll-handoff-status' ? 'GET' : 'PATCH',
      enabled: !validation.length && workflowState !== 'terminal',
      disabledReason: validation[0] || blockers[0] || (workflowState === 'terminal' ? `handoff ${externalHandoff.state}` : null),
      bodySchema: {
        eventId: 'string',
        requestId: 'string',
        handoffId: 'string',
        clientId: 'string',
        clientStatePatch: 'audit-event.client-state-patch.v1'
      },
      body: {
        eventId: event.eventId,
        requestId: requestContext.requestId,
        handoffId: externalHandoff.handoffId,
        clientId: clientRuntime.clientId,
        clientStatePatch
      }
    },
    clientStatePatch,
    validation
  };
}

function normalizeRecoveryCommand(input, event, requestContext, tenantBoundary, lifecycleSettings) {
  const command = asRecord(input.command);
  const requestedName = normalizeString(command.name) || normalizeString(command.type) || 'append-event';
  const name = ALLOWED_COMMANDS.has(requestedName) ? requestedName : 'append-event';
  const commandId = normalizeString(command.commandId)
    || normalizeString(command.id)
    || `${requestContext.requestId}:${event.eventId}:${name}`;
  const idempotencyKey = normalizeString(command.idempotencyKey) || commandId;
  const requiredPermission = COMMAND_PERMISSION_REQUIREMENTS[name];
  const commandValidation = ALLOWED_COMMANDS.has(requestedName) ? [] : [`unsupported command: ${requestedName}`];
  if (requiredPermission && !tenantBoundary.permissions.includes(requiredPermission)) {
    commandValidation.push(`missing permission: ${requiredPermission}`);
  }
  if (tenantBoundary.validation.length && !BOUNDARY_SAFE_COMMANDS.has(name)) {
    commandValidation.push('tenant boundary must be repaired before command execution');
  }
  if (!lifecycleSettings.enabled && !LIFECYCLE_SAFE_COMMANDS.has(name)) {
    commandValidation.push('audit event lifecycle is disabled');
  }
  if (lifecycleSettings.validation.length && !SETTINGS_UPDATE_COMMANDS.has(name)) {
    commandValidation.push('lifecycle settings must be repaired before command execution');
  }
  if (lifecycleSettings.schedule.mode === 'scheduled' && !lifecycleSettings.schedule.due && name !== 'schedule-recovery') {
    commandValidation.push('recovery is scheduled for a future run');
  }
  if (lifecycleSettings.schedule.paused && name !== 'enable-audit-event' && name !== 'update-lifecycle-settings') {
    commandValidation.push('recovery schedule is paused');
  }

  return {
    commandId,
    name,
    idempotencyKey,
    requestedName,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    requiredPermission,
    issuedAt: normalizeString(command.issuedAt) || requestContext.requestedAt,
    payloadHash: normalizeString(command.payloadHash) || event.payloadHash,
    replaySafe: name === 'resume-recovery'
      || name === 'acknowledge-handoff'
      || name === 'enable-audit-event'
      || name === 'disable-audit-event'
      || name === 'schedule-recovery',
    validation: commandValidation
  };
}

function buildCommandOutcome(command, persistedState, proof, externalHandoff, lifecycleSettings, healthDirective) {
  const completedLedgerRecord = persistedState.commands.ledger.find((record) => (
    record.status === 'completed'
    && (record.idempotencyKey === command.idempotencyKey || record.commandId === command.commandId)
  ));
  const inflightLedgerRecord = persistedState.commands.ledger.find((record) => (
    (record.status === 'inflight' || record.status === 'replay-pending')
    && (record.idempotencyKey === command.idempotencyKey || record.commandId === command.commandId)
  ));
  const failedReplayableRecord = persistedState.commands.ledger.find((record) => (
    record.status === 'failed'
    && record.replayable
    && (record.idempotencyKey === command.idempotencyKey || record.commandId === command.commandId)
  ));
  const alreadyCompleted = persistedState.commands.completedIds.includes(command.idempotencyKey)
    || persistedState.commands.completedIds.includes(command.commandId)
    || Boolean(completedLedgerRecord);
  const alreadyInflight = persistedState.commands.inflightIds.includes(command.idempotencyKey)
    || persistedState.commands.inflightIds.includes(command.commandId)
    || Boolean(inflightLedgerRecord);
  const replayingPersistedFailure = Boolean(failedReplayableRecord && command.replaySafe);
  const blockedReasons = [];

  if (command.validation.length) blockedReasons.push('command-contract');
  for (const reason of persistedState.validation) blockedReasons.push(reason);
  if (proof.status !== 'ready' && command.name !== 'resume-recovery' && !LIFECYCLE_SAFE_COMMANDS.has(command.name)) {
    blockedReasons.push('proof-not-ready');
  }
  if (persistedState.status === 'blocked' && command.name !== 'resume-recovery' && !LIFECYCLE_SAFE_COMMANDS.has(command.name)) {
    blockedReasons.push('state-blocked');
  }
  if (externalHandoff.terminal && command.name === 'acknowledge-handoff') blockedReasons.push(`handoff-${externalHandoff.state}`);
  if (!lifecycleSettings.enabled && !LIFECYCLE_SAFE_COMMANDS.has(command.name)) blockedReasons.push('lifecycle-disabled');
  if (lifecycleSettings.state === 'scheduled' && command.name !== 'schedule-recovery') blockedReasons.push('schedule-not-due');
  if (persistedState.recoveryPath.leaseRenewalRequired && command.name !== 'resume-recovery') {
    blockedReasons.push('state-lease-renewal-required');
  }
  if (healthDirective.blocked) blockedReasons.push(healthDirective.reason);

  const healthDeferred = healthDirective.retryScheduled && !alreadyCompleted && !alreadyInflight && !blockedReasons.length;
  const accepted = !alreadyCompleted && !alreadyInflight && !blockedReasons.length && !healthDeferred;
  const queuedForRetry = healthDeferred && command.replaySafe;
  if (healthDeferred && !queuedForRetry) blockedReasons.push(`${healthDirective.reason}; command is not replay-safe`);
  const currentJournalRecord = {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    name: command.name,
    status: alreadyCompleted ? 'completed' : alreadyInflight ? 'inflight' : accepted || queuedForRetry ? 'inflight' : 'failed',
    statusReason: alreadyCompleted
      ? 'idempotent-replay'
      : alreadyInflight
        ? inflightLedgerRecord?.statusReason || 'idempotent-inflight-replay'
        : queuedForRetry
          ? 'provider-health-retry-scheduled'
        : replayingPersistedFailure
          ? 'replaying-failed-command'
          : blockedReasons[0] || 'accepted-for-dispatch',
    firstSeenAt: completedLedgerRecord?.firstSeenAt || inflightLedgerRecord?.firstSeenAt || command.issuedAt,
    updatedAt: command.issuedAt,
    resultCursor: completedLedgerRecord?.resultCursor
      || inflightLedgerRecord?.resultCursor
      || persistedState.recoveryCursor
      || `${persistedState.eventId}:${persistedState.nextSequence ?? 'pending'}`,
    replayable: command.replaySafe || queuedForRetry
  };
  const nextStatus = alreadyCompleted
    ? persistedState.status
    : blockedReasons.length
      ? 'blocked'
      : command.name === 'commit-proof'
        ? 'proof-ready'
        : command.name === 'disable-audit-event'
          ? 'blocked'
          : command.name === 'enable-audit-event'
            ? 'recovering'
            : command.name === 'schedule-recovery'
              ? 'pending'
        : command.name === 'acknowledge-handoff'
          ? 'completed'
          : command.name === 'resume-recovery'
            ? 'recovering'
            : 'handoff-pending';

  return {
    commandId: command.commandId,
    name: command.name,
    idempotencyKey: command.idempotencyKey,
    accepted,
    queuedForRetry,
    duplicate: alreadyCompleted || alreadyInflight,
    restartSafe: command.replaySafe || Boolean(persistedState.recoveryCursor),
    status: alreadyCompleted ? 'already-applied' : alreadyInflight ? 'already-inflight' : queuedForRetry ? 'retry-scheduled' : accepted ? 'accepted' : 'blocked',
    healthDirective,
    restartSemantics: {
      schemaVersion: 'audit-event.command-restart-semantics.v1',
      journalId: persistedState.commands.journal.journalId,
      journalRestartStatus: persistedState.commands.journal.restartStatus,
      idempotentReplay: alreadyCompleted,
      inflightReplay: alreadyInflight,
      failedReplay: replayingPersistedFailure,
      replayPlan: persistedState.commands.journal.replayPlan,
      duplicateIdempotencyKeys: persistedState.commands.journal.duplicateIdempotencyKeys,
      routeAction: alreadyCompleted
        ? 'route.auditRecovery.auditEvent.readCommandResult'
        : alreadyInflight
          ? 'route.auditRecovery.auditEvent.pollCommand'
          : queuedForRetry
            ? 'route.auditRecovery.auditEvent.retryProviderOperation'
          : accepted
            ? 'route.auditRecovery.auditEvent.dispatchCommand'
            : 'route.auditRecovery.auditEvent.repairCommand'
    },
    nextPersistedState: {
      stateId: persistedState.stateId,
      status: nextStatus,
      recoveryCursor: persistedState.recoveryCursor || `${persistedState.eventId}:${persistedState.nextSequence ?? 'pending'}`,
      completedCommandIds: accepted
        ? [...new Set([...persistedState.commands.completedIds, command.idempotencyKey])].sort()
        : persistedState.commands.completedIds,
      inflightCommandIds: alreadyInflight
        ? persistedState.commands.inflightIds
        : accepted || queuedForRetry
          ? [...new Set([...persistedState.commands.inflightIds, command.commandId])].sort()
          : persistedState.commands.inflightIds
    },
    commandJournalPatch: {
      schemaVersion: 'audit-event.command-journal-patch.v1',
      stateId: persistedState.stateId,
      durableKey: persistedState.durableKey,
      mode: alreadyCompleted
        ? 'return-completed-result'
        : alreadyInflight
          ? 'return-inflight-status'
          : accepted || queuedForRetry
            ? 'append-inflight-record'
            : 'append-failed-record',
      current: currentJournalRecord,
      append: alreadyCompleted || alreadyInflight ? [] : [currentJournalRecord],
      restartSemantics: {
        journalId: persistedState.commands.journal.journalId,
        previousRestartStatus: persistedState.commands.journal.restartStatus,
        commandRestartAction: currentJournalRecord.status === 'completed'
          ? 'return-completed-result'
          : currentJournalRecord.status === 'inflight'
            ? 'poll-or-dispatch'
            : 'repair-before-replay'
      },
      retainCompletedIds: [...new Set([
        ...persistedState.commands.completedIds,
        ...(alreadyCompleted ? [command.idempotencyKey] : [])
      ])].sort(),
      retainInflightIds: accepted || queuedForRetry || alreadyInflight
        ? [...new Set([...persistedState.commands.inflightIds, command.commandId, command.idempotencyKey])].sort()
        : persistedState.commands.inflightIds
    },
    blockedReasons
  };
}

function buildKernelOperationPlan(
  command,
  commandOutcome,
  contract,
  proof,
  persistedState,
  sync,
  handoff,
  requestContext,
  lifecycleSettings,
  operationalHealth,
  providerServiceBinding,
  now
) {
  const providerMethod = COMMAND_PROVIDER_METHODS[command.name] || 'appendAuditEvent';
  const availableMethods = new Set(contract.availableMethods);
  const mutating = MUTATING_COMMANDS.has(command.name);
  const providerReady = availableMethods.has(providerMethod)
    && contract.missingMethods.length === 0
    && contract.validation.length === 0;
  const hostedKernelWrite = contract.tier === 'hosted-kernel' && mutating;
  const requiresAtomicCheckpoint = hostedKernelWrite && contract.syncContract.checkpointWriteMode === 'atomic';
  const validation = [];

  if (!availableMethods.has(providerMethod)) validation.push(`provider method unavailable: ${providerMethod}`);
  if (commandOutcome.status === 'blocked') validation.push('command outcome is blocked');
  if (command.name === 'commit-proof' && proof.status !== 'ready') validation.push('ready proof is required before commit');
  if (hostedKernelWrite && contract.durability === 'ephemeral') validation.push('hosted-kernel writes require durable provider storage');
  if (hostedKernelWrite && contract.syncContract.checkpointWriteMode !== 'atomic') {
    validation.push('hosted-kernel writes require atomic checkpointWriteMode');
  }
  if (lifecycleSettings.state === 'scheduled' && command.name !== 'schedule-recovery') {
    validation.push('scheduled lifecycle cannot dispatch provider write yet');
  }
  for (const reason of operationalHealth.validation) validation.push(reason);
  if (!operationalHealth.dispatchGate.providerAvailable && !operationalHealth.retryPolicy.retryable) {
    validation.push('provider health blocks dispatch without retry');
  }
  if (mutating && !operationalHealth.dispatchGate.writesAllowed && command.name !== 'commit-proof') {
    validation.push('provider health is delaying mutating audit-event writes');
  }
  if (command.name === 'commit-proof' && !operationalHealth.dispatchGate.proofWritesAllowed) {
    validation.push('provider health blocks proof commit writes');
  }
  if (command.name === 'acknowledge-handoff' && !operationalHealth.dispatchGate.handoffWritesAllowed) {
    validation.push('provider health blocks handoff acknowledgement writes');
  }
  for (const reason of providerServiceBinding.validation) validation.push(reason);

  const dispatchable = commandOutcome.accepted && providerReady && validation.length === 0;
  const operationState = dispatchable
    ? 'dispatch-ready'
    : operationalHealth.retryPolicy.retryable
      ? 'retry-scheduled'
    : commandOutcome.duplicate
      ? 'idempotent-replay'
      : 'blocked';
  const checkpointSequence = Number.isSafeInteger(persistedState.nextSequence)
    ? persistedState.nextSequence
    : command.name === 'resume-recovery'
      ? persistedState.lastCommittedSequence
      : null;

  return {
    schemaVersion: 'audit-event.kernel-operation.v1',
    operationId: `${requestContext.requestId}:${command.commandId}:kernel-operation`,
    generatedAt: now,
    state: operationState,
    dispatchable,
    routeAction: `kernel.auditRecovery.auditEvent.${providerMethod}`,
    provider: {
      providerId: contract.providerId,
      tier: contract.tier,
      method: providerMethod,
      durable: contract.durability !== 'ephemeral',
      region: contract.region,
      healthState: operationalHealth.state,
      serviceBindingId: providerServiceBinding.bindingId
    },
    command: {
      commandId: command.commandId,
      name: command.name,
      idempotencyKey: command.idempotencyKey,
      replaySafe: command.replaySafe,
      accepted: commandOutcome.accepted
    },
    preconditions: {
      providerReady,
      proofReady: proof.status === 'ready',
      commandAccepted: commandOutcome.accepted,
      lifecycleReady: lifecycleSettings.enabled && lifecycleSettings.validation.length === 0,
      syncReady: sync.state !== 'blocked',
      handoffOpen: !handoff.terminal,
      providerHealthReady: operationalHealth.validation.length === 0 && operationalHealth.dispatchGate.providerAvailable,
      providerServiceBindingReady: providerServiceBinding.validation.length === 0,
      requiresAtomicCheckpoint,
      idempotencyKey: command.idempotencyKey
    },
    deliveryPlan: {
      schemaVersion: providerServiceBinding.schemaVersion,
      bindingId: providerServiceBinding.bindingId,
      ordering: providerServiceBinding.deliveryContract.ordering,
      consistency: providerServiceBinding.deliveryContract.consistency,
      batchSize: providerServiceBinding.deliveryContract.batchSize,
      requestedBatchSize: providerServiceBinding.deliveryContract.requestedBatchSize,
      capabilityComplete: providerServiceBinding.capabilityNegotiation.complete,
      requiredCapabilities: providerServiceBinding.capabilityNegotiation.requiredForCommand,
      syncMetadataRequired: providerServiceBinding.syncMetadataContract.required,
      externalHandoffState: providerServiceBinding.externalHandoffState
    },
    writeSet: {
      atomic: requiresAtomicCheckpoint,
      cursorNamespace: contract.syncContract.cursorNamespace,
      checkpointSequence,
      recoveryCursor: commandOutcome.nextPersistedState.recoveryCursor,
      persistedStatePatch: {
        schemaVersion: persistedState.schemaVersion,
        stateId: persistedState.stateId,
        durableKey: persistedState.durableKey,
        fromStatus: persistedState.status,
        toStatus: commandOutcome.nextPersistedState.status,
        checkpoint: persistedState.checkpoint,
        recoveryPath: persistedState.recoveryPath,
        lease: persistedState.lease,
        commandJournal: persistedState.commands.journal,
        commandJournalPatch: commandOutcome.commandJournalPatch
      },
      nextPersistedState: commandOutcome.nextPersistedState,
      proofCommit: command.name === 'commit-proof'
        ? {
            proofKey: proof.proofKey,
            eventId: proof.eventId,
            workspaceId: proof.workspaceId,
            acceptedAt: dispatchable ? now : null
          }
        : null,
      appendEvent: providerMethod === 'appendAuditEvent'
        ? {
            eventId: proof.eventId,
            payloadHash: command.payloadHash,
            sequence: checkpointSequence,
            tenantId: command.tenantId,
            workspaceId: command.workspaceId
          }
        : null
    },
    proofEnvelope: {
      proofKey: proof.proofKey,
      proofStatus: proof.status,
      surfaceId,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId
    },
    retry: {
      scheduled: operationState === 'retry-scheduled',
      retryable: operationalHealth.retryPolicy.retryable,
      retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
      nextAttemptAt: operationalHealth.retryPolicy.nextAttemptAt,
      attempt: operationalHealth.retryPolicy.attempt,
      maxAttempts: operationalHealth.retryPolicy.maxAttempts
    },
    healthDispatchDirective: commandOutcome.healthDirective,
    actionableError: operationalHealth.failureState.active || validation.length
      ? {
          code: commandOutcome.healthDirective.actionableError?.code
            || operationalHealth.failureState.code
            || 'audit-event-operation-blocked',
          message: commandOutcome.healthDirective.actionableError?.message
            || operationalHealth.failureState.message
            || validation[0]
            || 'audit event operation is blocked',
          operatorAction: commandOutcome.healthDirective.actionableError?.operatorAction
            || operationalHealth.failureState.operatorAction
            || 'inspect-kernel-operation',
          retryable: commandOutcome.healthDirective.actionableError?.retryable
            ?? operationalHealth.retryPolicy.retryable
        }
      : null,
    validation
  };
}

function buildProof(
  event,
  contract,
  capabilities,
  sync,
  handoff,
  requestContext,
  clientRuntime,
  tenantBoundary,
  lifecycleSettings,
  providerServiceBinding
) {
  const proofInputs = [
    surfaceId,
    tenantBoundary.workspaceBinding || 'unscoped-workspace',
    tenantBoundary.accessDecision.scopeHash,
    tenantBoundary.accessDecision.state,
    requestContext.requestId,
    event.eventId,
    event.kind,
    event.subject.type,
    event.subject.id,
    String(event.sequence ?? 'pending'),
    contract.providerId,
    clientRuntime.clientId,
    sync.state,
    handoff.state,
    capabilities.accepted.join(','),
    lifecycleSettings.state,
    lifecycleSettings.settings.proofMode,
    lifecycleSettings.schedule.nextRunAt || 'due-now',
    providerServiceBinding.bindingId,
    providerServiceBinding.deliveryContract.ordering,
    providerServiceBinding.deliveryContract.consistency,
    providerServiceBinding.externalHandoffState.sink
  ];
  const requestBound = Boolean(requestContext.requestId && requestContext.correlationId);
  const clientAdopted = clientRuntime.adoption.requestBound && clientRuntime.adoption.canRenderHandoff;
  const clientRuntimeValid = clientRuntime.validation.length === 0 && clientRuntime.adoption.adopted;
  const boundaryValid = tenantBoundary.validation.length === 0;
  const lifecycleReady = lifecycleSettings.enabled
    && lifecycleSettings.validation.length === 0
    && lifecycleSettings.state !== 'paused'
    && lifecycleSettings.state !== 'scheduled';

  return {
    type: 'audit-event-recovery-proof',
    surfaceId,
    requestId: requestContext.requestId,
    eventId: event.eventId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    actorId: tenantBoundary.actorId,
    providerId: contract.providerId,
    clientId: clientRuntime.clientId,
    status: event.validation.length
      || contract.missingMethods.length
      || contract.validation.length
      || !capabilities.accepted.length
      || !requestBound
      || !clientRuntimeValid
      || !boundaryValid
      || !lifecycleReady
      || providerServiceBinding.validation.length
      ? 'rejected'
      : 'ready',
    proofKey: proofInputs.join('|'),
    checks: {
      eventContractValid: event.validation.length === 0,
      providerContractReady: contract.missingMethods.length === 0,
      providerServiceReady: contract.validation.length === 0,
      providerDurable: contract.durability !== 'ephemeral',
      providerSyncReady: contract.syncContract.requiredAdapters.every((adapter) => contract.syncContract.adapters.includes(adapter)),
      providerHandoffReady: contract.handoffContract.enabled
        && contract.handoffContract.requiredModes.every((mode) => contract.handoffContract.modes.includes(mode)),
      capabilitiesAccepted: capabilities.accepted.length > 0,
      providerCapabilitiesAccepted: capabilities.accepted.every((capability) => contract.supportedCapabilities.includes(capability)),
      providerServiceBindingReady: providerServiceBinding.validation.length === 0,
      providerDeliveryOrdered: providerServiceBinding.deliveryContract.ordering === 'sequence',
      providerDeliveryConsistent: providerServiceBinding.deliveryContract.consistency === 'linearizable',
      providerExternalStateReady: !providerServiceBinding.externalHandoffState.required
        || providerServiceBinding.externalHandoffState.sink !== 'none',
      syncReady: sync.state !== 'blocked',
      requestContextBound: requestBound,
      clientRuntimeAdopted: clientAdopted,
      clientRuntimeValid,
      clientRouteBound: clientRuntime.adoption.routeBound,
      clientSessionBound: clientRuntime.adoption.sessionBound,
      clientCursorFresh: clientRuntime.adoption.cursorFresh,
      tenantBoundaryValid: boundaryValid,
      tenantAccessGranted: tenantBoundary.accessDecision.state === 'granted' || tenantBoundary.accessDecision.state === 'reduced',
      tenantAccessDecision: tenantBoundary.accessDecision.state,
      tenantAccessHandoffRequired: tenantBoundary.accessDecision.auditHandoffRequired,
      tenantMatches: tenantBoundary.isolation.tenantMatches,
      workspaceAllowed: tenantBoundary.isolation.workspaceAllowed,
      workspaceScopeReduced: tenantBoundary.rejectedWorkspaceIds.length > 0,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleSettingsValid: lifecycleSettings.validation.length === 0,
      lifecycleScheduleDue: lifecycleSettings.schedule.due,
      lifecycleReady
    }
  };
}

function normalizeAcceptanceIntent(input) {
  const acceptance = asRecord(input.acceptance);
  const intent = normalizeString(acceptance.state)
    || normalizeString(acceptance.intent)
    || normalizeString(input.acceptanceIntent);
  const normalized = intent.toLowerCase();

  if (['accept', 'accepted', 'approve', 'approved'].includes(normalized)) return 'accepted';
  if (['reject', 'rejected', 'deny', 'denied'].includes(normalized)) return 'rejected';
  return 'preview';
}

function buildValidationSummary(
  event,
  contract,
  capabilities,
  sync,
  handoff,
  proof,
  commandOutcome,
  clientRuntime,
  tenantBoundary,
  lifecycleSettings,
  kernelOperation,
  operationalHealth,
  providerServiceBinding,
  workflowHandoff
) {
  const blockers = [];
  const warnings = [];

  for (const reason of event.validation) blockers.push({ source: 'event', reason });
  for (const reason of clientRuntime.validation) blockers.push({ source: 'client-runtime', reason });
  for (const reason of tenantBoundary.validation) blockers.push({ source: 'tenant-boundary', reason });
  for (const reason of lifecycleSettings.validation) blockers.push({ source: 'lifecycle-settings', reason });
  for (const method of contract.missingMethods) blockers.push({ source: 'provider', reason: `missing ${method}` });
  for (const reason of contract.validation) blockers.push({ source: 'provider-service', reason });
  for (const reason of commandOutcome.blockedReasons) blockers.push({ source: 'command', reason });
  for (const reason of kernelOperation.validation) blockers.push({ source: 'kernel-operation', reason });
  for (const reason of operationalHealth.validation) blockers.push({ source: 'operational-health', reason });
  for (const reason of providerServiceBinding.validation) blockers.push({ source: 'provider-service-binding', reason });
  for (const reason of workflowHandoff.validation) blockers.push({ source: 'workflow-handoff', reason });
  for (const capability of capabilities.unsupported) warnings.push({ source: 'capability', reason: `unsupported ${capability}` });
  for (const capability of capabilities.accepted) {
    if (!contract.supportedCapabilities.includes(capability)) {
      blockers.push({ source: 'provider-service', reason: `provider does not support ${capability}` });
    }
  }

  if (!lifecycleSettings.enabled) {
    blockers.push({ source: 'lifecycle', reason: lifecycleSettings.disabledReason || 'audit event lifecycle disabled' });
  }
  if (lifecycleSettings.state === 'paused') {
    blockers.push({ source: 'lifecycle', reason: 'recovery schedule paused' });
  }
  if (lifecycleSettings.state === 'scheduled') {
    warnings.push({ source: 'lifecycle', reason: `scheduled for ${lifecycleSettings.schedule.nextRunAt || 'future run'}` });
  }
  if (!capabilities.accepted.length) blockers.push({ source: 'capability', reason: 'no supported capabilities accepted' });
  if (!clientRuntime.adoption.adopted) blockers.push({ source: 'client-runtime', reason: 'client state is not adopted by request context' });
  if (sync.state === 'blocked') blockers.push({ source: 'sync', reason: 'replay blocked by invalid event contract' });
  if (handoff.terminal && !['accepted', 'completed'].includes(handoff.state)) {
    blockers.push({ source: 'handoff', reason: `terminal ${handoff.state}` });
  }
  if (handoff.retryAfterMs !== null) warnings.push({ source: 'handoff', reason: `retry after ${handoff.retryAfterMs}ms` });
  if (handoff.blockedReason) blockers.push({ source: 'handoff', reason: handoff.blockedReason });
  if (operationalHealth.degraded && !operationalHealth.validation.length) {
    warnings.push({ source: 'operational-health', reason: `provider degraded: ${operationalHealth.degradedModes.join(', ')}` });
  }
  if (operationalHealth.retryPolicy.retryable) {
    warnings.push({ source: 'operational-health', reason: `retry scheduled after ${operationalHealth.retryPolicy.retryAfterMs}ms` });
  }
  if (commandOutcome.queuedForRetry) {
    warnings.push({ source: 'command', reason: commandOutcome.healthDirective.reason });
  }
  if (tenantBoundary.accessDecision.auditHandoffRequired) {
    warnings.push({
      source: 'tenant-boundary',
      reason: `tenant access decision requires audit handoff: ${tenantBoundary.accessDecision.reason}`
    });
  }
  if (workflowHandoff.hydration.required && !workflowHandoff.validation.length) {
    warnings.push({ source: 'workflow-handoff', reason: workflowHandoff.hydration.reason });
  }
  if (workflowHandoff.state === 'background-poll') {
    warnings.push({ source: 'workflow-handoff', reason: 'handoff status will be polled in the background' });
  }

  return {
    state: blockers.length ? 'blocked' : warnings.length ? 'ready-with-warnings' : 'ready',
    valid: blockers.length === 0,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers: blockers.slice(0, USER_VISIBLE_BLOCKER_LIMIT),
    warnings,
    checks: {
      ...proof.checks,
      clientRuntimeAdopted: clientRuntime.adoption.adopted,
      kernelOperationDispatchable: kernelOperation.dispatchable,
      kernelOperationRetryScheduled: kernelOperation.retry.scheduled,
      kernelOperationAtomic: kernelOperation.writeSet.atomic,
      providerServiceBindingReady: providerServiceBinding.validation.length === 0,
      providerCapabilityComplete: providerServiceBinding.capabilityNegotiation.complete,
      operationalHealthReady: operationalHealth.validation.length === 0,
      operationalHealthRetryable: operationalHealth.retryPolicy.retryable,
      workflowHandoffReady: workflowHandoff.validation.length === 0 && workflowHandoff.state !== 'repair-required',
      workflowHydrationRequired: workflowHandoff.hydration.required,
      workflowUserActionEnabled: workflowHandoff.userActionContract.enabled
    }
  };
}

function buildUserPreview(
  event,
  requestContext,
  clientRuntime,
  sync,
  handoff,
  workflowHandoff,
  validationSummary,
  tenantBoundary,
  lifecycleSettings,
  operationalHealth
) {
  const sequenceLabel = event.sequence === null ? 'pending sequence' : `sequence ${event.sequence}`;
  const subjectLabel = `${event.subject.type}:${event.subject.id}`;

  return {
    previewId: `${requestContext.requestId}:${event.eventId}:preview`,
    title: validationSummary.valid ? `Ready to recover ${event.eventId}` : `Review required for ${event.eventId}`,
    subtitle: `${event.kind} on ${subjectLabel} (${sequenceLabel})`,
    route: requestContext.route,
    visible: workflowHandoff.userVisible,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    clientId: clientRuntime.clientId,
    primaryEntity: {
      type: event.subject.type,
      id: event.subject.id,
      label: subjectLabel
    },
    actorLabel: `${event.actor.type}:${event.actor.id}`,
    occurredAt: event.occurredAt,
    syncState: sync.state,
    handoffState: handoff.state,
    lifecycleState: lifecycleSettings.state,
    nextUserAction: workflowHandoff.step,
    statusBadge: validationSummary.state,
    badges: [
      event.kind,
      sync.state,
      lifecycleSettings.state,
      operationalHealth.degraded ? `health-${operationalHealth.state}` : 'health-healthy',
      tenantBoundary.workspaceId ? 'workspace-scoped' : 'workspace-unbound',
      handoff.terminal ? `handoff-${handoff.state}` : 'handoff-open'
    ]
  };
}

function buildReadiness(proof, validationSummary, commandOutcome, acceptanceState) {
  const canAccept = proof.status === 'ready' && validationSummary.valid && commandOutcome.accepted;
  const canCommit = acceptanceState === 'accepted' && canAccept;

  return {
    state: commandOutcome.queuedForRetry ? 'retry-scheduled' : canCommit ? 'commit-ready' : canAccept ? 'preview-ready' : 'blocked',
    canPreview: true,
    canAccept,
    canCommit,
    retryScheduled: commandOutcome.queuedForRetry,
    requiresUserAcceptance: canAccept,
    acceptanceState
  };
}

function buildReadinessChecklist(
  event,
  requestContext,
  readiness,
  validationSummary,
  proof,
  recoveryCommand,
  sync,
  handoff,
  clientRuntime,
  tenantBoundary,
  lifecycleSettings,
  operationalHealth,
  providerServiceBinding,
  kernelOperation
) {
  const checklistItems = [
    {
      id: 'event-contract',
      label: 'Audit event contract',
      ready: event.validation.length === 0,
      state: event.validation.length ? 'blocked' : 'ready',
      reason: event.validation[0] || 'event has required identity, subject, kind, and sequence',
      routeAction: 'route.auditRecovery.auditEvent.editEvent',
      payload: { eventId: event.eventId, focusField: 'event' }
    },
    {
      id: 'workspace-boundary',
      label: 'Tenant and workspace boundary',
      ready: tenantBoundary.validation.length === 0 && tenantBoundary.accessDecision.handoffAllowed,
      state: tenantBoundary.validation.length ? tenantBoundary.accessDecision.state : 'ready',
      reason: tenantBoundary.validation[0] || tenantBoundary.accessDecision.reason,
      routeAction: 'route.auditRecovery.auditEvent.bindWorkspace',
      payload: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        scopedWorkspaceIds: tenantBoundary.scopedWorkspaceIds
      }
    },
    {
      id: 'client-runtime',
      label: 'Client runtime adoption',
      ready: clientRuntime.adoption.adopted,
      state: clientRuntime.adoption.adopted ? 'ready' : 'needs-adoption',
      reason: clientRuntime.validation[0] || (clientRuntime.adoption.adopted ? 'client state is bound to this request' : 'client state must adopt this request'),
      routeAction: 'client.auditEvent.adoptRuntimeState',
      payload: {
        clientId: clientRuntime.clientId,
        focusEventId: event.eventId,
        route: requestContext.route,
        recoveryCursor: sync.cursor || `${event.eventId}:${event.sequence ?? 'pending'}`
      }
    },
    {
      id: 'lifecycle',
      label: 'Lifecycle controls',
      ready: lifecycleSettings.enabled && lifecycleSettings.validation.length === 0 && lifecycleSettings.state !== 'paused' && lifecycleSettings.state !== 'scheduled',
      state: lifecycleSettings.state,
      reason: lifecycleSettings.validation[0] || lifecycleSettings.disabledReason || (lifecycleSettings.state === 'enabled' ? 'lifecycle is ready' : `lifecycle is ${lifecycleSettings.state}`),
      routeAction: lifecycleSettings.enabled ? 'route.auditRecovery.auditEvent.updateLifecycleSettings' : 'route.auditRecovery.auditEvent.enableLifecycle',
      payload: {
        lifecycleId: lifecycleSettings.lifecycleId,
        enabled: lifecycleSettings.enabled,
        scheduleMode: lifecycleSettings.schedule.mode,
        nextRunAt: lifecycleSettings.schedule.nextRunAt
      }
    },
    {
      id: 'provider-service',
      label: 'Provider service binding',
      ready: providerServiceBinding.validation.length === 0 && providerServiceBinding.capabilityNegotiation.complete,
      state: providerServiceBinding.validation.length ? 'blocked' : providerServiceBinding.capabilityNegotiation.complete ? 'ready' : 'partial',
      reason: providerServiceBinding.validation[0] || (providerServiceBinding.capabilityNegotiation.complete ? 'provider binding satisfies command capabilities' : 'provider capabilities are incomplete'),
      routeAction: 'route.auditRecovery.provider.configureServiceBinding',
      payload: {
        bindingId: providerServiceBinding.bindingId,
        providerId: providerServiceBinding.providerId,
        requiredCapabilities: providerServiceBinding.capabilityNegotiation.requiredForCommand
      }
    },
    {
      id: 'provider-health',
      label: 'Provider health',
      ready: operationalHealth.validation.length === 0 && operationalHealth.dispatchGate.providerAvailable,
      state: kernelOperation.healthDispatchDirective.mode,
      reason: kernelOperation.healthDispatchDirective.reason,
      routeAction: operationalHealth.retryPolicy.retryable
        ? 'route.auditRecovery.auditEvent.retryProviderOperation'
        : 'route.auditRecovery.provider.inspectHealth',
      payload: {
        directiveMode: kernelOperation.healthDispatchDirective.mode,
        retryable: operationalHealth.retryPolicy.retryable,
        retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
        nextAttemptAt: operationalHealth.retryPolicy.nextAttemptAt
      }
    },
    {
      id: 'proof',
      label: 'Recovery proof',
      ready: proof.status === 'ready',
      state: proof.status,
      reason: proof.status === 'ready' ? 'proof envelope is ready for operator review' : validationSummary.blockers[0]?.reason || 'proof is not ready',
      routeAction: 'route.auditRecovery.auditEvent.openPreview',
      payload: { proofKey: proof.status === 'ready' ? proof.proofKey : null, eventId: event.eventId }
    },
    {
      id: 'kernel-dispatch',
      label: 'Hosted-kernel dispatch',
      ready: kernelOperation.dispatchable,
      state: kernelOperation.state,
      reason: kernelOperation.validation[0] || (kernelOperation.dispatchable ? 'kernel operation can dispatch' : 'kernel operation is not dispatchable'),
      routeAction: 'route.auditRecovery.auditEvent.inspectKernelOperation',
      payload: {
        operationId: kernelOperation.operationId,
        commandId: recoveryCommand.commandId,
        providerMethod: kernelOperation.provider.method
      }
    },
    {
      id: 'external-handoff',
      label: 'External handoff',
      ready: !handoff.terminal || ['accepted', 'completed'].includes(handoff.state),
      state: handoff.state,
      reason: handoff.blockedReason || (handoff.terminal ? `handoff ${handoff.state}` : 'handoff is open for review'),
      routeAction: 'route.auditRecovery.auditEvent.acknowledgeHandoff',
      payload: { handoffId: handoff.handoffId, state: handoff.state }
    }
  ];
  const blockedItems = checklistItems.filter((item) => !item.ready);
  const firstRepair = blockedItems[0] || null;

  return {
    schemaVersion: 'audit-event.readiness-checklist.v1',
    checklistId: `${requestContext.requestId}:${event.eventId}:readiness-checklist`,
    generatedFor: {
      eventId: event.eventId,
      requestId: requestContext.requestId,
      commandId: recoveryCommand.commandId,
      acceptanceState: readiness.acceptanceState
    },
    state: readiness.canCommit ? 'commit-ready' : blockedItems.length ? 'repair-required' : 'acceptance-ready',
    readyCount: checklistItems.length - blockedItems.length,
    blockedCount: blockedItems.length,
    firstRepairAction: firstRepair
      ? {
          itemId: firstRepair.id,
          routeAction: firstRepair.routeAction,
          reason: firstRepair.reason,
          payload: firstRepair.payload
        }
      : null,
    items: checklistItems,
    routeContract: {
      routeAction: firstRepair?.routeAction || (readiness.canCommit
        ? 'route.auditRecovery.auditEvent.commitProof'
        : 'client.auditEvent.acceptPreview'),
      method: readiness.canCommit ? 'POST' : firstRepair ? 'PATCH' : 'POST',
      bodySchema: {
        eventId: 'string',
        requestId: 'string',
        commandId: 'string',
        checklistId: 'string',
        repairItemId: 'string|null'
      },
      body: {
        eventId: event.eventId,
        requestId: requestContext.requestId,
        commandId: recoveryCommand.commandId,
        checklistId: `${requestContext.requestId}:${event.eventId}:readiness-checklist`,
        repairItemId: firstRepair?.id || null
      }
    }
  };
}

function buildAcceptanceDecision(
  acceptanceState,
  event,
  requestContext,
  preview,
  readiness,
  validationSummary,
  recoveryCommand,
  proof,
  tenantBoundary,
  now
) {
  const primaryBlocker = validationSummary.blockers[0]?.reason || null;
  const requestedAccepted = acceptanceState === 'accepted';
  const requestedRejected = acceptanceState === 'rejected';
  const blockedReason = readiness.canAccept
    ? null
    : primaryBlocker || 'audit event recovery is not ready for acceptance';
  const state = requestedRejected
    ? 'rejected'
    : requestedAccepted && readiness.canAccept
      ? 'accepted'
      : requestedAccepted
        ? 'acceptance-blocked'
        : readiness.canAccept
          ? 'awaiting-acceptance'
          : 'preview-only';
  const operatorMessage = state === 'accepted'
    ? 'Preview accepted; recovery proof can be committed.'
    : state === 'rejected'
      ? 'Preview rejected by operator; no proof commit will be offered.'
      : state === 'acceptance-blocked'
        ? `Preview cannot be accepted: ${blockedReason}`
        : state === 'awaiting-acceptance'
          ? 'Preview is ready for operator acceptance.'
          : `Preview is blocked: ${blockedReason}`;
  const decisionPayload = {
    eventId: event.eventId,
    requestId: requestContext.requestId,
    workspaceId: tenantBoundary.workspaceId,
    acceptanceIntent: state === 'accepted' ? 'accepted' : requestedRejected ? 'rejected' : 'preview',
    idempotencyKey: `${recoveryCommand.idempotencyKey}:accept-preview`
  };

  return {
    schemaVersion: 'audit-event.acceptance-decision.v1',
    decisionId: `${preview.previewId}:acceptance-decision`,
    previewId: preview.previewId,
    generatedAt: now,
    requestedIntent: acceptanceState,
    state,
    accepted: state === 'accepted',
    rejected: state === 'rejected',
    commitAllowed: state === 'accepted' && readiness.canCommit,
    gate: readiness.canAccept ? 'operator-acceptance' : 'validation',
    disabledReason: state === 'accepted' || state === 'rejected' ? null : blockedReason,
    operatorMessage,
    proofKey: state === 'accepted' ? proof.proofKey : null,
    auditTrail: {
      actorId: tenantBoundary.actorId,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      correlationId: requestContext.correlationId,
      acceptedAt: state === 'accepted' ? now : null,
      rejectedAt: state === 'rejected' ? now : null
    },
    routePayload: decisionPayload,
    validation: {
      valid: validationSummary.valid,
      blockerCount: validationSummary.blockerCount,
      warningCount: validationSummary.warningCount,
      firstBlocker: primaryBlocker
    }
  };
}

function buildLifecycleNextAction(lifecycleSettings, readiness, commandOutcome) {
  if (!lifecycleSettings.enabled) {
    return {
      state: 'enable-required',
      command: 'enable-audit-event',
      routeAction: 'route.auditRecovery.auditEvent.enableLifecycle',
      dueAt: null,
      operatorRequired: true
    };
  }

  if (lifecycleSettings.validation.length) {
    return {
      state: 'settings-repair-required',
      command: 'update-lifecycle-settings',
      routeAction: 'route.auditRecovery.auditEvent.updateLifecycleSettings',
      dueAt: null,
      operatorRequired: true
    };
  }

  if (lifecycleSettings.state === 'paused') {
    return {
      state: 'schedule-paused',
      command: 'schedule-recovery',
      routeAction: 'route.auditRecovery.auditEvent.viewSchedule',
      dueAt: lifecycleSettings.schedule.nextRunAt,
      operatorRequired: true
    };
  }

  if (lifecycleSettings.state === 'scheduled') {
    return {
      state: 'awaiting-schedule',
      command: 'schedule-recovery',
      routeAction: 'route.auditRecovery.auditEvent.viewSchedule',
      dueAt: lifecycleSettings.schedule.nextRunAt,
      operatorRequired: false
    };
  }

  if (readiness.canCommit) {
    return {
      state: 'commit-ready',
      command: 'commit-proof',
      routeAction: 'route.auditRecovery.auditEvent.commitProof',
      dueAt: null,
      operatorRequired: false
    };
  }

  return {
    state: commandOutcome.accepted ? 'handoff-pending' : 'review-required',
    command: commandOutcome.accepted ? 'acknowledge-handoff' : 'resume-recovery',
    routeAction: commandOutcome.accepted
      ? 'route.auditRecovery.auditEvent.acknowledgeHandoff'
      : 'route.auditRecovery.auditEvent.openPreview',
    dueAt: null,
    operatorRequired: true
  };
}

function buildLifecycleControlAudit(lifecycleSettings, recoveryCommand, requestContext, tenantBoundary, commandOutcome, now) {
  const allowed = {
    'enable-audit-event': lifecycleSettings.controls.canEnable,
    'disable-audit-event': lifecycleSettings.controls.canDisable,
    'update-lifecycle-settings': lifecycleSettings.controls.canUpdateSettings,
    'schedule-recovery': lifecycleSettings.controls.canSchedule || lifecycleSettings.controls.canRunNow || lifecycleSettings.controls.canPause
  };
  const commandAllowed = allowed[recoveryCommand.name] ?? true;
  const blockedReasons = [];

  if (lifecycleSettings.validation.length) blockedReasons.push(...lifecycleSettings.validation);
  if (!commandAllowed && LIFECYCLE_COMMAND_INTENTS[recoveryCommand.name]) {
    blockedReasons.push(`lifecycle control is not available for ${recoveryCommand.name}`);
  }
  if (commandOutcome.blockedReasons.includes('lifecycle-disabled')) blockedReasons.push('lifecycle is disabled for command');
  if (commandOutcome.blockedReasons.includes('schedule-not-due')) blockedReasons.push('scheduled recovery is not due');

  return {
    schemaVersion: 'audit-event.lifecycle-control-audit.v1',
    auditId: `${requestContext.requestId}:${recoveryCommand.commandId}:lifecycle-control`,
    generatedAt: now,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    actorId: tenantBoundary.actorId,
    command: {
      commandId: recoveryCommand.commandId,
      name: recoveryCommand.name,
      intent: lifecycleSettings.commandIntent,
      idempotencyKey: recoveryCommand.idempotencyKey,
      allowed: commandAllowed,
      accepted: commandOutcome.accepted
    },
    stateTransition: {
      fromEnabled: lifecycleSettings.effectiveChange.enabledBefore,
      toEnabled: lifecycleSettings.effectiveChange.enabledAfter,
      fromStatus: lifecycleSettings.effectiveChange.stateBefore,
      toLifecycleState: lifecycleSettings.effectiveChange.stateAfter,
      toPersistedStatus: commandOutcome.nextPersistedState.status
    },
    effectiveSettings: {
      proofMode: lifecycleSettings.settings.proofMode,
      retentionDays: lifecycleSettings.settings.retentionDays,
      batchSize: lifecycleSettings.settings.batchSize,
      maxReplayEvents: lifecycleSettings.settings.maxReplayEvents,
      requireOperatorAcceptance: lifecycleSettings.settings.requireOperatorAcceptance
    },
    effectiveSchedule: {
      mode: lifecycleSettings.schedule.mode,
      runAt: lifecycleSettings.schedule.runAt,
      nextRunAt: lifecycleSettings.schedule.nextRunAt,
      due: lifecycleSettings.schedule.due,
      paused: lifecycleSettings.schedule.paused
    },
    controlAvailability: {
      canEnable: lifecycleSettings.controls.canEnable,
      canDisable: lifecycleSettings.controls.canDisable,
      canUpdateSettings: lifecycleSettings.controls.canUpdateSettings,
      canRunNow: lifecycleSettings.controls.canRunNow,
      canSchedule: lifecycleSettings.controls.canSchedule,
      canPause: lifecycleSettings.controls.canPause,
      canResume: lifecycleSettings.controls.canResume
    },
    blockedReasons: [...new Set(blockedReasons)]
  };
}

function buildNextSteps(
  readiness,
  event,
  contract,
  capabilities,
  sync,
  handoff,
  validationSummary,
  clientRuntime,
  tenantBoundary,
  lifecycleSettings,
  kernelOperation,
  operationalHealth,
  providerServiceBinding
) {
  const steps = [];

  if (event.validation.length) {
    steps.push({
      id: 'repair-event-contract',
      label: 'Repair audit event contract',
      action: 'route.auditRecovery.auditEvent.editEvent',
      reason: event.validation[0],
      required: true
    });
  }

  if (contract.missingMethods.length) {
    steps.push({
      id: 'bind-provider-methods',
      label: 'Bind audit event provider methods',
      action: 'route.auditRecovery.provider.bind',
      reason: `missing ${contract.missingMethods.join(', ')}`,
      required: true
    });
  }

  if (contract.validation.length) {
    steps.push({
      id: 'repair-provider-service-contract',
      label: 'Repair audit event service contract',
      action: 'route.auditRecovery.provider.configureService',
      reason: contract.validation[0],
      required: true
    });
  }

  if (tenantBoundary.validation.length) {
    steps.push({
      id: 'repair-tenant-boundary',
      label: 'Repair tenant and workspace boundary',
      action: 'route.auditRecovery.auditEvent.bindWorkspace',
      reason: tenantBoundary.validation[0],
      required: true
    });
  }

  if (clientRuntime.validation.length || !clientRuntime.adoption.adopted) {
    steps.push({
      id: 'adopt-client-runtime',
      label: 'Adopt request into client runtime',
      action: 'client.auditEvent.adoptRuntimeState',
      reason: clientRuntime.validation[0] || 'client state is not adopted by request context',
      required: true
    });
  }

  if (!lifecycleSettings.enabled) {
    steps.push({
      id: 'enable-audit-event-lifecycle',
      label: 'Enable audit event lifecycle',
      action: 'route.auditRecovery.auditEvent.enableLifecycle',
      reason: lifecycleSettings.disabledReason || 'lifecycle disabled',
      required: true
    });
  }

  if (lifecycleSettings.validation.length) {
    steps.push({
      id: 'repair-lifecycle-settings',
      label: 'Repair lifecycle settings',
      action: 'route.auditRecovery.auditEvent.updateLifecycleSettings',
      reason: lifecycleSettings.validation[0],
      required: true
    });
  }

  if (lifecycleSettings.state === 'scheduled') {
    steps.push({
      id: 'wait-for-scheduled-recovery',
      label: 'Wait for scheduled recovery',
      action: 'route.auditRecovery.auditEvent.viewSchedule',
      reason: `scheduled for ${lifecycleSettings.schedule.nextRunAt || 'future run'}`,
      required: false
    });
  }

  if (lifecycleSettings.state === 'paused') {
    steps.push({
      id: 'resume-paused-schedule',
      label: 'Resume audit event schedule',
      action: 'route.auditRecovery.auditEvent.scheduleRecovery',
      reason: 'recovery schedule is paused',
      required: true
    });
  }

  if (!capabilities.accepted.length) {
    steps.push({
      id: 'renegotiate-capabilities',
      label: 'Request a supported audit event capability',
      action: 'client.capabilities.request',
      reason: 'no supported capability accepted',
      required: true
    });
  }

  if (kernelOperation.validation.length) {
    steps.push({
      id: 'repair-kernel-operation',
      label: 'Repair hosted-kernel operation dispatch',
      action: 'route.auditRecovery.auditEvent.inspectKernelOperation',
      reason: kernelOperation.validation[0],
      required: true
    });
  }

  if (providerServiceBinding.validation.length) {
    steps.push({
      id: 'repair-provider-service-binding',
      label: 'Repair provider service binding',
      action: 'route.auditRecovery.provider.configureServiceBinding',
      reason: providerServiceBinding.validation[0],
      required: true
    });
  }

  if (operationalHealth.failureState.active || operationalHealth.retryPolicy.retryable) {
    steps.push({
      id: operationalHealth.retryPolicy.retryable ? 'retry-provider-operation' : 'repair-provider-health',
      label: operationalHealth.retryPolicy.retryable ? 'Retry audit event provider operation' : 'Repair provider health',
      action: operationalHealth.retryPolicy.retryable
        ? 'route.auditRecovery.auditEvent.retryProviderOperation'
        : 'route.auditRecovery.provider.inspectHealth',
      reason: operationalHealth.failureState.message
        || operationalHealth.failureState.code
        || `provider health ${operationalHealth.state}`,
      required: !operationalHealth.retryPolicy.retryable
    });
  }

  if (kernelOperation.healthDispatchDirective.retryScheduled && !steps.some((step) => step.id === 'retry-provider-operation')) {
    steps.push({
      id: 'retry-provider-operation',
      label: 'Retry audit event provider operation',
      action: kernelOperation.healthDispatchDirective.routeContract.routeAction,
      reason: kernelOperation.healthDispatchDirective.reason,
      required: false
    });
  }

  if (sync.state === 'initial') {
    steps.push({
      id: 'create-sync-cursor',
      label: 'Create recovery sync cursor',
      action: 'route.auditRecovery.auditEvent.createCursor',
      reason: 'initial replay window has no cursor',
      required: false
    });
  }

  if (!handoff.terminal) {
    steps.push({
      id: readiness.canAccept ? 'accept-preview' : 'review-preview',
      label: readiness.canAccept ? 'Accept preview for commit' : 'Review preview blockers',
      action: readiness.canAccept ? 'client.auditEvent.acceptPreview' : 'client.auditEvent.openPreview',
      reason: validationSummary.valid ? 'operator acceptance required before commit' : validationSummary.blockers[0]?.reason || 'blocked',
      required: readiness.canAccept
    });
  }

  return steps;
}

function buildNextStepRoutePayload(step, event, requestContext, recoveryCommand, acceptanceDecision) {
  const basePayload = {
    eventId: event.eventId,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    stepId: step.id
  };

  if (step.id === 'accept-preview') {
    return {
      ...basePayload,
      ...acceptanceDecision.routePayload
    };
  }

  if (step.id === 'review-preview') {
    return {
      ...basePayload,
      previewId: acceptanceDecision.previewId,
      reason: step.reason
    };
  }

  if (step.id === 'repair-lifecycle-settings' || step.id === 'enable-audit-event-lifecycle' || step.id === 'resume-paused-schedule') {
    return {
      ...basePayload,
      command: step.id === 'enable-audit-event-lifecycle'
        ? 'enable-audit-event'
        : step.id === 'resume-paused-schedule'
          ? 'schedule-recovery'
          : 'update-lifecycle-settings',
      lifecycle: step.id === 'resume-paused-schedule'
        ? { enabled: true, schedule: { mode: 'immediate' } }
        : undefined,
      idempotencyKey: `${recoveryCommand.idempotencyKey}:${step.id}`
    };
  }

  if (step.id === 'repair-event-contract' || step.id === 'repair-tenant-boundary') {
    return {
      ...basePayload,
      focusField: step.id === 'repair-event-contract' ? 'event' : 'tenantBoundary'
    };
  }

  if (step.id === 'adopt-client-runtime') {
    return {
      ...basePayload,
      clientStatePatch: {
        focusEventId: event.eventId,
        recoveryCursor: `${event.eventId}:${event.sequence ?? 'pending'}`,
        route: requestContext.route
      },
      reason: step.reason
    };
  }

  if (step.id === 'retry-provider-operation' || step.id === 'repair-provider-health') {
    return {
      ...basePayload,
      command: step.id === 'retry-provider-operation' ? recoveryCommand.name : 'inspect-provider-health',
      reason: step.reason,
      idempotencyKey: `${recoveryCommand.idempotencyKey}:${step.id}`
    };
  }

  if (step.id === 'repair-provider-service-binding') {
    return {
      ...basePayload,
      command: 'update-provider-service-binding',
      reason: step.reason,
      idempotencyKey: `${recoveryCommand.idempotencyKey}:${step.id}`
    };
  }

  return {
    ...basePayload,
    command: recoveryCommand.name,
    idempotencyKey: `${recoveryCommand.idempotencyKey}:${step.id}`
  };
}

function buildClientRouteContracts(
  event,
  requestContext,
  preview,
  readiness,
  validationSummary,
  nextSteps,
  lifecycleNextAction,
  recoveryCommand,
  workflowHandoff,
  proof,
  acceptanceDecision,
  operationalHealth,
  clientRuntime,
  tenantBoundary,
  persistedState,
  commandOutcome,
  lifecycleControlAudit,
  providerServiceBinding,
  readinessChecklist,
  now
) {
  const primaryBlocker = validationSummary.blockers[0]?.reason || null;
  const acceptanceDisabledReason = acceptanceDecision.disabledReason;
  const commitDisabledReason = readiness.canCommit
    ? null
    : !acceptanceDecision.accepted
      ? acceptanceDecision.operatorMessage
      : acceptanceDisabledReason;
  const typedPreviewFields = [
    { name: 'eventId', type: 'string', required: true, value: event.eventId },
    { name: 'kind', type: 'string', required: true, value: event.kind },
    { name: 'subject.type', type: 'string', required: true, value: event.subject.type },
    { name: 'subject.id', type: 'string', required: true, value: event.subject.id },
    { name: 'sequence', type: 'integer|null', required: true, value: event.sequence },
    { name: 'occurredAt', type: 'iso-timestamp', required: true, value: event.occurredAt },
    { name: 'payloadHash', type: 'string|null', required: false, value: event.payloadHash }
  ];
  const nextStepActions = nextSteps.map((step, index) => ({
    ordinal: index + 1,
    stepId: step.id,
    routeAction: step.action,
    label: step.label,
    required: step.required,
    reason: step.reason,
    blocked: step.required && validationSummary.blockerCount > 0 && step.id !== 'review-preview',
    payloadSchema: {
      eventId: 'string',
      requestId: 'string',
      correlationId: 'string',
      stepId: 'string'
    },
    payload: buildNextStepRoutePayload(step, event, requestContext, recoveryCommand, acceptanceDecision)
  }));

  return {
    schemaVersion: 'audit-event.client-contract.v1',
    contractId: `${requestContext.requestId}:${event.eventId}:client-contract`,
    generatedAt: now,
    previewContract: {
      previewId: preview.previewId,
      routeAction: 'route.auditRecovery.auditEvent.openPreview',
      method: 'GET',
      visible: preview.visible,
      title: preview.title,
      statusBadge: preview.statusBadge,
      fields: typedPreviewFields,
      clientStatePatch: workflowHandoff.clientStatePatch
    },
    runtimeAdoptionContract: {
      schemaVersion: 'audit-event.client-runtime-adoption.v1',
      clientId: clientRuntime.clientId,
      mode: clientRuntime.mode,
      sessionId: clientRuntime.sessionId,
      tenantId: clientRuntime.tenantId,
      workspaceId: clientRuntime.workspaceId,
      stateRevision: clientRuntime.state.revision,
      adopted: clientRuntime.adoption.adopted,
      validation: clientRuntime.validation,
      routeBinding: clientRuntime.routeBinding,
      cursor: {
        recoveryCursor: clientRuntime.state.recoveryCursor,
        syncCursorFresh: clientRuntime.adoption.cursorFresh,
        cursorBound: clientRuntime.adoption.cursorBound
      },
      handoffUi: clientRuntime.handoffUi,
      requiredPatch: clientRuntime.adoption.adopted
        ? null
        : {
            focusEventId: event.eventId,
            recoveryCursor: workflowHandoff.resumeCursor,
            route: requestContext.route,
            sessionId: requestContext.sessionId,
            tenantId: requestContext.tenantId,
            workspaceId: requestContext.workspaceId,
            revision: clientRuntime.state.revision + 1
          }
    },
    workflowHandoffContract: {
      schemaVersion: workflowHandoff.schemaVersion,
      workflowId: workflowHandoff.workflowId,
      state: workflowHandoff.state,
      step: workflowHandoff.step,
      routeAction: workflowHandoff.routeAction,
      userVisible: workflowHandoff.userVisible,
      displayMode: workflowHandoff.displayMode,
      handoffId: workflowHandoff.handoffId,
      handoffState: workflowHandoff.handoffState,
      resumeCursor: workflowHandoff.resumeCursor,
      hydration: workflowHandoff.hydration,
      clientStatePatch: workflowHandoff.clientStatePatch,
      userActionContract: workflowHandoff.userActionContract,
      blockers: workflowHandoff.blockers,
      validation: workflowHandoff.validation
    },
    tenantBoundaryContract: {
      schemaVersion: tenantBoundary.accessDecision.schemaVersion,
      routeAction: 'route.auditRecovery.auditEvent.bindWorkspace',
      state: tenantBoundary.accessDecision.state,
      enforcementMode: tenantBoundary.accessDecision.enforcementMode,
      reason: tenantBoundary.accessDecision.reason,
      auditHandoffRequired: tenantBoundary.accessDecision.auditHandoffRequired,
      handoffAllowed: tenantBoundary.accessDecision.handoffAllowed,
      actorScope: tenantBoundary.actorScope,
      requestedScope: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        requestedWorkspaceIds: tenantBoundary.requestedWorkspaceIds
      },
      effectiveScope: {
        workspaceBinding: tenantBoundary.workspaceBinding,
        scopedWorkspaceIds: tenantBoundary.scopedWorkspaceIds,
        rejectedWorkspaceIds: tenantBoundary.rejectedWorkspaceIds,
        deniedWorkspaceIds: tenantBoundary.deniedWorkspaceIds
      },
      requiredPermissions: ['audit-event:read'],
      grantedPermissions: tenantBoundary.permissions,
      validation: tenantBoundary.validation
    },
    acceptanceContract: {
      actionId: `${preview.previewId}:acceptance`,
      routeAction: 'route.auditRecovery.auditEvent.acceptPreview',
      method: 'POST',
      enabled: readiness.canAccept,
      disabledReason: acceptanceDisabledReason,
      bodySchema: {
        eventId: 'string',
        requestId: 'string',
        acceptanceIntent: 'accepted|rejected|preview',
        idempotencyKey: 'string'
      },
      body: {
        ...acceptanceDecision.routePayload,
        acceptanceIntent: readiness.canAccept ? acceptanceDecision.routePayload.acceptanceIntent : 'preview'
      }
    },
    acceptanceDecisionContract: {
      decisionId: acceptanceDecision.decisionId,
      schemaVersion: acceptanceDecision.schemaVersion,
      state: acceptanceDecision.state,
      operatorMessage: acceptanceDecision.operatorMessage,
      accepted: acceptanceDecision.accepted,
      rejected: acceptanceDecision.rejected,
      commitAllowed: acceptanceDecision.commitAllowed,
      gate: acceptanceDecision.gate,
      proofKey: acceptanceDecision.proofKey,
      auditTrail: acceptanceDecision.auditTrail
    },
    commitContract: {
      actionId: `${preview.previewId}:commit`,
      routeAction: lifecycleNextAction.routeAction,
      method: 'POST',
      enabled: readiness.canCommit,
      disabledReason: commitDisabledReason,
      command: readiness.canCommit ? 'commit-proof' : lifecycleNextAction.command,
      proofKey: readiness.canCommit ? proof.proofKey : null
    },
    readinessContract: {
      state: readiness.state,
      canPreview: readiness.canPreview,
      canAccept: readiness.canAccept,
      canCommit: readiness.canCommit,
      requiresUserAcceptance: readiness.requiresUserAcceptance,
      acceptanceState: readiness.acceptanceState,
      nextActionState: lifecycleNextAction.state,
      checklistId: readinessChecklist.checklistId,
      checklistState: readinessChecklist.state,
      readyCount: readinessChecklist.readyCount,
      blockedCount: readinessChecklist.blockedCount,
      firstRepairAction: readinessChecklist.firstRepairAction
    },
    persistedStateContract: {
      schemaVersion: persistedState.schemaVersion,
      stateId: persistedState.stateId,
      durableKey: persistedState.durableKey,
      status: persistedState.status,
      restartSafe: persistedState.restartSafe,
      terminal: persistedState.terminal,
      recoveryCursor: persistedState.recoveryCursor,
      checkpoint: persistedState.checkpoint,
      lease: persistedState.lease,
      recoveryPath: persistedState.recoveryPath,
      commandJournal: {
        schemaVersion: persistedState.commands.journal.schemaVersion,
        journalId: persistedState.commands.journal.journalId,
        restartStatus: persistedState.commands.journal.restartStatus,
        counts: persistedState.commands.journal.counts,
        replayPlan: persistedState.commands.journal.replayPlan,
        duplicateIdempotencyKeys: persistedState.commands.journal.duplicateIdempotencyKeys,
        records: persistedState.commands.journal.records.map((record) => ({
          commandId: record.commandId,
          idempotencyKey: record.idempotencyKey,
          name: record.name,
          status: record.status,
          restartAction: record.restartAction,
          routeAction: record.routeAction,
          restartSafe: record.restartSafe,
          resultCursor: record.resultCursor
        }))
      },
      commandJournalPatch: commandOutcome.commandJournalPatch,
      routeContract: {
        routeAction: persistedState.recoveryPath.routeAction,
        method: persistedState.recoveryPath.state === 'terminal' ? 'GET' : 'POST',
        enabled: persistedState.validation.length === 0 && !persistedState.terminal,
        disabledReason: persistedState.terminal ? 'recovery already completed' : persistedState.validation[0] || null,
        bodySchema: {
          stateId: 'string',
          durableKey: 'string',
          command: 'resume-recovery|commit-proof|acknowledge-handoff',
          recoveryCursor: 'string|null',
          leaseId: 'string',
          commandJournalId: 'string',
          replayCommandId: 'string|null'
        },
        body: {
          stateId: persistedState.stateId,
          durableKey: persistedState.durableKey,
          command: persistedState.recoveryPath.command,
          recoveryCursor: persistedState.recoveryCursor,
          leaseId: persistedState.lease.leaseId,
          commandJournalId: persistedState.commands.journal.journalId,
          replayCommandId: persistedState.commands.journal.replayPlan.commandId
        }
      }
    },
    readinessChecklistContract: {
      schemaVersion: readinessChecklist.schemaVersion,
      checklistId: readinessChecklist.checklistId,
      state: readinessChecklist.state,
      generatedFor: readinessChecklist.generatedFor,
      items: readinessChecklist.items.map((item) => ({
        id: item.id,
        label: item.label,
        ready: item.ready,
        state: item.state,
        reason: item.reason,
        routeAction: item.routeAction,
        payloadSchema: {
          eventId: 'string',
          requestId: 'string',
          commandId: 'string'
        },
        payload: {
          eventId: event.eventId,
          requestId: requestContext.requestId,
          commandId: recoveryCommand.commandId,
          ...item.payload
        }
      })),
      routeContract: readinessChecklist.routeContract
    },
    lifecycleControlContract: {
      schemaVersion: lifecycleControlAudit.schemaVersion,
      auditId: lifecycleControlAudit.auditId,
      routeActions: {
        enable: 'route.auditRecovery.auditEvent.enableLifecycle',
        disable: 'route.auditRecovery.auditEvent.disableLifecycle',
        updateSettings: 'route.auditRecovery.auditEvent.updateLifecycleSettings',
        schedule: 'route.auditRecovery.auditEvent.scheduleRecovery',
        runNow: 'route.auditRecovery.auditEvent.runRecoveryNow'
      },
      command: lifecycleControlAudit.command,
      stateTransition: lifecycleControlAudit.stateTransition,
      effectiveSettings: lifecycleControlAudit.effectiveSettings,
      effectiveSchedule: lifecycleControlAudit.effectiveSchedule,
      controlAvailability: lifecycleControlAudit.controlAvailability,
      blockedReasons: lifecycleControlAudit.blockedReasons,
      bodySchema: {
        command: 'enable-audit-event|disable-audit-event|update-lifecycle-settings|schedule-recovery',
        idempotencyKey: 'string',
        lifecycle: {
          enabled: 'boolean',
          disabledReason: 'string|null',
          settings: 'audit-event.lifecycle-settings',
          schedule: 'audit-event.lifecycle-schedule'
        }
      },
      body: {
        command: lifecycleControlAudit.command.name,
        idempotencyKey: lifecycleControlAudit.command.idempotencyKey,
        lifecycle: {
          enabled: lifecycleControlAudit.stateTransition.toEnabled,
          disabledReason: lifecycleControlAudit.stateTransition.toEnabled ? null : lifecycleControlAudit.blockedReasons[0] || 'operator-disabled',
          settings: lifecycleControlAudit.effectiveSettings,
          schedule: lifecycleControlAudit.effectiveSchedule
        }
      }
    },
    validationContract: {
      state: validationSummary.state,
      valid: validationSummary.valid,
      blockerCount: validationSummary.blockerCount,
      warningCount: validationSummary.warningCount,
      firstBlocker: primaryBlocker,
      blockers: validationSummary.blockers,
      warnings: validationSummary.warnings
    },
    healthContract: {
      schemaVersion: operationalHealth.schemaVersion,
      state: operationalHealth.state,
      degraded: operationalHealth.degraded,
      degradedModes: operationalHealth.degradedModes,
      retryable: operationalHealth.retryPolicy.retryable,
      retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
      nextAttemptAt: operationalHealth.retryPolicy.nextAttemptAt,
      failureCode: operationalHealth.failureState.code,
      failureMessage: operationalHealth.failureState.message,
      operatorAction: operationalHealth.failureState.operatorAction,
      dispatchGate: operationalHealth.dispatchGate,
      dispatchDirective: commandOutcome.healthDirective
    },
    providerServiceContract: {
      schemaVersion: providerServiceBinding.schemaVersion,
      bindingId: providerServiceBinding.bindingId,
      routeAction: 'route.auditRecovery.provider.configureServiceBinding',
      providerId: providerServiceBinding.providerId,
      tier: providerServiceBinding.tier,
      capabilityNegotiation: providerServiceBinding.capabilityNegotiation,
      deliveryContract: providerServiceBinding.deliveryContract,
      syncMetadataContract: providerServiceBinding.syncMetadataContract,
      externalHandoffState: providerServiceBinding.externalHandoffState,
      valid: providerServiceBinding.validation.length === 0,
      validation: providerServiceBinding.validation,
      bodySchema: {
        bindingId: 'string',
        providerId: 'string',
        delivery: {
          ordering: 'sequence|causal|best-effort',
          consistency: 'linearizable|read-after-write|eventual',
          batchSize: 'integer'
        },
        externalState: {
          sink: 'kernel-state|provider-callback|client-poll|none',
          handoffId: 'string'
        }
      },
      body: {
        bindingId: providerServiceBinding.bindingId,
        providerId: providerServiceBinding.providerId,
        delivery: {
          ordering: providerServiceBinding.deliveryContract.ordering,
          consistency: providerServiceBinding.deliveryContract.consistency,
          batchSize: providerServiceBinding.deliveryContract.batchSize
        },
        externalState: {
          sink: providerServiceBinding.externalHandoffState.sink,
          handoffId: providerServiceBinding.externalHandoffState.handoffId
        }
      }
    },
    nextStepContracts: nextStepActions
  };
}

function normalizeHistorySnapshot(snapshot, fallback, index) {
  const record = asRecord(snapshot);
  const sequence = Number.isSafeInteger(record.sequence) && record.sequence >= 0
    ? record.sequence
    : fallback.sequence;
  const blockerCount = Number.isSafeInteger(record.blockerCount) && record.blockerCount >= 0
    ? record.blockerCount
    : fallback.blockerCount;
  const warningCount = Number.isSafeInteger(record.warningCount) && record.warningCount >= 0
    ? record.warningCount
    : fallback.warningCount;
  const snapshotAt = normalizeString(record.snapshotAt)
    || normalizeString(record.observedAt)
    || normalizeString(record.occurredAt)
    || fallback.snapshotAt;
  const status = normalizeString(record.status) || fallback.status;

  return {
    snapshotId: normalizeString(record.snapshotId) || normalizeString(record.id) || `${fallback.eventId}:history:${index}`,
    eventId: normalizeString(record.eventId) || fallback.eventId,
    sequence,
    snapshotAt,
    status,
    syncState: normalizeString(record.syncState) || fallback.syncState,
    handoffState: normalizeString(record.handoffState) || fallback.handoffState,
    commandStatus: normalizeString(record.commandStatus) || fallback.commandStatus,
    proofStatus: normalizeString(record.proofStatus) || fallback.proofStatus,
    lifecycleState: normalizeString(record.lifecycleState) || fallback.lifecycleState,
    operationState: normalizeString(record.operationState) || fallback.operationState,
    healthState: normalizeString(record.healthState) || fallback.healthState,
    blockerCount,
    warningCount,
    replayRequired: typeof record.replayRequired === 'boolean' ? record.replayRequired : fallback.replayRequired,
    exportable: record.exportable === false ? false : true,
    source: normalizeString(record.source) || 'audit-event-history'
  };
}

function buildAnalyticsHistory(
  input,
  event,
  persistedState,
  sync,
  handoff,
  validationSummary,
  commandOutcome,
  proof,
  lifecycleSettings,
  kernelOperation,
  operationalHealth,
  now
) {
  const analytics = asRecord(input.analytics);
  const historyInput = input.history || analytics.history;
  const historyRecord = asRecord(historyInput);
  const rawSnapshots = Array.isArray(historyInput)
    ? historyInput
    : Array.isArray(historyRecord.snapshots)
      ? historyRecord.snapshots
      : [];
  const fallback = {
    eventId: event.eventId,
    sequence: event.sequence,
    snapshotAt: now,
    status: validationSummary.state,
    syncState: sync.state,
    handoffState: handoff.state,
    commandStatus: commandOutcome.status,
    proofStatus: proof.status,
    lifecycleState: lifecycleSettings.state,
    operationState: kernelOperation.state,
    healthState: operationalHealth.state,
    blockerCount: validationSummary.blockerCount,
    warningCount: validationSummary.warningCount,
    replayRequired: persistedState.replay.required
  };
  const snapshots = rawSnapshots.map((snapshot, index) => normalizeHistorySnapshot(snapshot, fallback, index));
  const currentSnapshot = {
    ...fallback,
    snapshotId: `${event.eventId}:current:${now}`,
    exportable: true,
    source: 'audit-event-current-state'
  };
  const byId = new Map();

  for (const snapshot of [...snapshots, currentSnapshot]) {
    byId.set(snapshot.snapshotId, snapshot);
  }

  return [...byId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.snapshotAt);
    const rightTime = Date.parse(right.snapshotAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return (left.sequence ?? -1) - (right.sequence ?? -1);
  });
}

function buildSnapshotWindow(historySnapshots, now) {
  const first = historySnapshots[0] || null;
  const latest = historySnapshots[historySnapshots.length - 1] || null;
  const generatedAtMs = Date.parse(now);
  let observedDurationMs = 0;
  let blockedDurationMs = 0;
  let warningDurationMs = 0;

  for (let index = 0; index < historySnapshots.length; index += 1) {
    const snapshot = historySnapshots[index];
    const snapshotAtMs = Date.parse(snapshot.snapshotAt);
    const nextAtMs = Date.parse(historySnapshots[index + 1]?.snapshotAt);
    const endAtMs = Number.isFinite(nextAtMs)
      ? nextAtMs
      : Number.isFinite(generatedAtMs)
        ? generatedAtMs
        : snapshotAtMs;
    const durationMs = Number.isFinite(snapshotAtMs) && Number.isFinite(endAtMs) && endAtMs > snapshotAtMs
      ? endAtMs - snapshotAtMs
      : 0;

    observedDurationMs += durationMs;
    if (snapshot.blockerCount > 0 || snapshot.status === 'blocked') blockedDurationMs += durationMs;
    if (snapshot.warningCount > 0 && snapshot.blockerCount === 0) warningDurationMs += durationMs;
  }

  return {
    firstSnapshotAt: first?.snapshotAt || null,
    latestSnapshotAt: latest?.snapshotAt || null,
    observedDurationMs,
    blockedDurationMs,
    warningDurationMs,
    recovered: Boolean(first && latest && first.blockerCount > 0 && latest.blockerCount === 0),
    blockerDelta: first && latest ? latest.blockerCount - first.blockerCount : 0,
    warningDelta: first && latest ? latest.warningCount - first.warningCount : 0
  };
}

function buildSnapshotTransitions(historySnapshots) {
  const transitions = [];

  for (let index = 1; index < historySnapshots.length; index += 1) {
    const previous = historySnapshots[index - 1];
    const current = historySnapshots[index];
    const changedFields = ['status', 'syncState', 'handoffState', 'commandStatus', 'proofStatus', 'operationState', 'healthState']
      .filter((field) => previous[field] !== current[field]);

    if (!changedFields.length && previous.blockerCount === current.blockerCount && previous.warningCount === current.warningCount) {
      continue;
    }

    transitions.push({
      transitionId: `${previous.snapshotId}->${current.snapshotId}`,
      fromSnapshotId: previous.snapshotId,
      toSnapshotId: current.snapshotId,
      at: current.snapshotAt,
      changedFields,
      blockerDelta: current.blockerCount - previous.blockerCount,
      warningDelta: current.warningCount - previous.warningCount,
      recoveredBlockers: previous.blockerCount > 0 && current.blockerCount === 0,
      becameBlocked: previous.blockerCount === 0 && current.blockerCount > 0
    });
  }

  return transitions;
}

function buildAnalyticsCounters(historySnapshots, validationSummary, commandOutcome, persistedState, handoff, now) {
  const exportableSnapshots = historySnapshots.filter((snapshot) => snapshot.exportable);
  const blockedSnapshots = historySnapshots.filter((snapshot) => snapshot.blockerCount > 0 || snapshot.status === 'blocked');
  const readySnapshots = historySnapshots.filter((snapshot) => snapshot.status === 'ready' || snapshot.status === 'ready-with-warnings');
  const terminalHandoffSnapshots = historySnapshots.filter((snapshot) => TERMINAL_HANDOFF_STATES.has(snapshot.handoffState));
  const degradedHealthSnapshots = historySnapshots.filter((snapshot) => snapshot.healthState && snapshot.healthState !== 'healthy');
  const replaySnapshots = historySnapshots.filter((snapshot) => snapshot.replayRequired);
  const acceptedCommandCount = commandOutcome.accepted ? 1 : 0;
  const duplicateCommandCount = commandOutcome.duplicate ? 1 : 0;
  const sequences = historySnapshots
    .map((snapshot) => snapshot.sequence)
    .filter((sequence) => Number.isSafeInteger(sequence));
  const window = buildSnapshotWindow(historySnapshots, now);
  const transitions = buildSnapshotTransitions(historySnapshots);

  return {
    schemaVersion: 'audit-event.analytics-counters.v2',
    snapshotCount: historySnapshots.length,
    exportableSnapshotCount: exportableSnapshots.length,
    blockedSnapshotCount: blockedSnapshots.length,
    readySnapshotCount: readySnapshots.length,
    terminalHandoffSnapshotCount: terminalHandoffSnapshots.length,
    degradedHealthSnapshotCount: degradedHealthSnapshots.length,
    replaySnapshotCount: replaySnapshots.length,
    transitionCount: transitions.length,
    recoveredTransitionCount: transitions.filter((transition) => transition.recoveredBlockers).length,
    becameBlockedTransitionCount: transitions.filter((transition) => transition.becameBlocked).length,
    currentBlockerCount: validationSummary.blockerCount,
    currentWarningCount: validationSummary.warningCount,
    acceptedCommandCount,
    duplicateCommandCount,
    inflightCommandCount: commandOutcome.nextPersistedState.inflightCommandIds.length,
    completedCommandCount: commandOutcome.nextPersistedState.completedCommandIds.length,
    persistedCommandJournalStatus: persistedState.commands.journal.restartStatus,
    persistedCommandReplayPendingCount: persistedState.commands.journal.counts.replayPending,
    persistedCommandUnsafeCount: persistedState.commands.journal.counts.unsafe,
    persistedCommandDuplicateCount: persistedState.commands.journal.counts.duplicate,
    replayGapCount: persistedState.replay.required ? 1 : 0,
    handoffOpenCount: handoff.terminal ? 0 : 1,
    firstSequence: sequences.length ? Math.min(...sequences) : null,
    latestSequence: sequences.length ? Math.max(...sequences) : null,
    window,
    transitions
  };
}

function buildAnalyticsExport(event, requestContext, tenantBoundary, historySnapshots, counters, now) {
  const rowSchema = [
    { name: 'eventId', type: 'string' },
    { name: 'tenantId', type: 'string|null' },
    { name: 'workspaceId', type: 'string|null' },
    { name: 'sequence', type: 'integer|null' },
    { name: 'snapshotAt', type: 'iso-timestamp' },
    { name: 'status', type: 'string' },
    { name: 'syncState', type: 'string' },
    { name: 'handoffState', type: 'string' },
    { name: 'commandStatus', type: 'string' },
    { name: 'proofStatus', type: 'string' },
    { name: 'lifecycleState', type: 'string' },
    { name: 'operationState', type: 'string' },
    { name: 'healthState', type: 'string' },
    { name: 'accessDecisionState', type: 'string' },
    { name: 'enforcementMode', type: 'string' },
    { name: 'scopedWorkspaceCount', type: 'integer' },
    { name: 'rejectedWorkspaceCount', type: 'integer' },
    { name: 'blockerCount', type: 'integer' },
    { name: 'warningCount', type: 'integer' },
    { name: 'replayRequired', type: 'boolean' }
  ];
  const rows = historySnapshots
    .filter((snapshot) => snapshot.exportable)
    .map((snapshot) => ({
      eventId: snapshot.eventId,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      sequence: snapshot.sequence,
      snapshotAt: snapshot.snapshotAt,
      status: snapshot.status,
      syncState: snapshot.syncState,
      handoffState: snapshot.handoffState,
      commandStatus: snapshot.commandStatus,
      proofStatus: snapshot.proofStatus,
      lifecycleState: snapshot.lifecycleState,
      operationState: snapshot.operationState,
      healthState: snapshot.healthState,
      accessDecisionState: tenantBoundary.accessDecision.state,
      enforcementMode: tenantBoundary.accessDecision.enforcementMode,
      scopedWorkspaceCount: tenantBoundary.scopedWorkspaceIds.length,
      rejectedWorkspaceCount: tenantBoundary.rejectedWorkspaceIds.length,
      blockerCount: snapshot.blockerCount,
      warningCount: snapshot.warningCount,
      replayRequired: snapshot.replayRequired
    }));

  return {
    exportId: `${requestContext.requestId}:${event.eventId}:analytics-export`,
    schemaVersion: 'audit-event.analytics-export.v1',
    generatedAt: now,
    format: 'jsonl-ready',
    exportReady: rows.length > 0,
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      eventId: event.eventId
    },
    columns: rowSchema.map((column) => column.name),
    rowSchema,
    counters,
    summary: {
      rowCount: rows.length,
      firstSnapshotAt: counters.window.firstSnapshotAt,
      latestSnapshotAt: counters.window.latestSnapshotAt,
      observedDurationMs: counters.window.observedDurationMs,
      blockedDurationMs: counters.window.blockedDurationMs,
      recovered: counters.window.recovered,
      latestStatus: rows[rows.length - 1]?.status || null,
      latestOperationState: rows[rows.length - 1]?.operationState || null
    },
    rows
  };
}

function buildReportingTimeline(event, requestContext, historySnapshots, counters, validationSummary, readiness) {
  const timeline = historySnapshots.map((snapshot) => ({
    id: snapshot.snapshotId,
    at: snapshot.snapshotAt,
    label: snapshot.status === 'blocked'
      ? 'Recovery blocked'
      : snapshot.commandStatus === 'accepted'
        ? 'Command accepted'
        : snapshot.handoffState === 'completed'
          ? 'Handoff completed'
          : 'Recovery observed',
    sequence: snapshot.sequence,
    state: snapshot.status,
    severity: snapshot.blockerCount ? 'error' : snapshot.warningCount ? 'warning' : 'info',
    metrics: {
      blockerCount: snapshot.blockerCount,
      warningCount: snapshot.warningCount,
      replayRequired: snapshot.replayRequired,
      proofStatus: snapshot.proofStatus,
      operationState: snapshot.operationState,
      healthState: snapshot.healthState
    }
  }));

  return {
    reportId: `${requestContext.requestId}:${event.eventId}:report`,
    state: validationSummary.valid && readiness.canCommit ? 'commit-report-ready' : validationSummary.state,
    generatedFromSnapshots: counters.snapshotCount,
    window: counters.window,
    transitionCount: counters.transitionCount,
    transitions: counters.transitions,
    lanes: {
      recovery: timeline.filter((entry) => entry.state === 'blocked' || entry.state === 'ready' || entry.state === 'ready-with-warnings').length,
      handoff: historySnapshots.filter((snapshot) => snapshot.handoffState !== 'pending').length,
      provider: historySnapshots.filter((snapshot) => snapshot.healthState && snapshot.healthState !== 'healthy').length
    },
    timeline,
    latest: timeline[timeline.length - 1] || null
  };
}

export function describeAuditEventSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const event = normalizeAuditEvent(input.event, now);
  const providerContract = normalizeProviderContract(input.provider);
  const capabilities = negotiateCapabilities(input.capabilities, providerContract.supportedCapabilities);
  const syncMetadata = buildSyncMetadata(input, event, now);
  const requestContext = normalizeRequestContext(input, now);
  const tenantBoundary = normalizeTenantBoundary(input, requestContext, event);
  const persistedState = normalizePersistedState(input, event, requestContext, syncMetadata, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, requestContext, persistedState, now);
  const clientRuntime = normalizeClientRuntime(input, requestContext, syncMetadata, event, persistedState, now);
  const externalHandoff = buildExternalHandoff(input, event, providerContract, requestContext, clientRuntime, tenantBoundary);
  const recoveryCommand = normalizeRecoveryCommand(input, event, requestContext, tenantBoundary, lifecycleSettings);
  const providerServiceBinding = buildProviderServiceBinding(
    input,
    providerContract,
    capabilities,
    syncMetadata,
    externalHandoff,
    requestContext,
    recoveryCommand,
    now
  );
  const proof = buildProof(
    event,
    providerContract,
    capabilities,
    syncMetadata,
    externalHandoff,
    requestContext,
    clientRuntime,
    tenantBoundary,
    lifecycleSettings,
    providerServiceBinding
  );
  const operationalHealth = buildOperationalHealth(
    input,
    providerContract,
    syncMetadata,
    persistedState,
    recoveryCommand,
    now
  );
  const healthDirective = buildHealthDispatchDirective(operationalHealth, recoveryCommand, persistedState, now);
  const commandOutcome = buildCommandOutcome(
    recoveryCommand,
    persistedState,
    proof,
    externalHandoff,
    lifecycleSettings,
    healthDirective
  );
  const kernelOperation = buildKernelOperationPlan(
    recoveryCommand,
    commandOutcome,
    providerContract,
    proof,
    persistedState,
    syncMetadata,
    externalHandoff,
    requestContext,
    lifecycleSettings,
    operationalHealth,
    providerServiceBinding,
    now
  );
  const workflowHandoff = buildWorkflowHandoff(
    event,
    requestContext,
    clientRuntime,
    syncMetadata,
    externalHandoff,
    proof.status === 'ready'
  );
  const acceptanceState = normalizeAcceptanceIntent(input);
  const validationSummary = buildValidationSummary(
    event,
    providerContract,
    capabilities,
    syncMetadata,
    externalHandoff,
    proof,
    commandOutcome,
    clientRuntime,
    tenantBoundary,
    lifecycleSettings,
    kernelOperation,
    operationalHealth,
    providerServiceBinding,
    workflowHandoff
  );
  const preview = buildUserPreview(
    event,
    requestContext,
    clientRuntime,
    syncMetadata,
    externalHandoff,
    workflowHandoff,
    validationSummary,
    tenantBoundary,
    lifecycleSettings,
    operationalHealth
  );
  const readiness = buildReadiness(proof, validationSummary, commandOutcome, acceptanceState);
  const acceptanceDecision = buildAcceptanceDecision(
    acceptanceState,
    event,
    requestContext,
    preview,
    readiness,
    validationSummary,
    recoveryCommand,
    proof,
    tenantBoundary,
    now
  );
  const lifecycleNextAction = buildLifecycleNextAction(lifecycleSettings, readiness, commandOutcome);
  const lifecycleControlAudit = buildLifecycleControlAudit(
    lifecycleSettings,
    recoveryCommand,
    requestContext,
    tenantBoundary,
    commandOutcome,
    now
  );
  const readinessChecklist = buildReadinessChecklist(
    event,
    requestContext,
    readiness,
    validationSummary,
    proof,
    recoveryCommand,
    syncMetadata,
    externalHandoff,
    clientRuntime,
    tenantBoundary,
    lifecycleSettings,
    operationalHealth,
    providerServiceBinding,
    kernelOperation
  );
  const nextSteps = buildNextSteps(
    readiness,
    event,
    providerContract,
    capabilities,
    syncMetadata,
    externalHandoff,
    validationSummary,
    clientRuntime,
    tenantBoundary,
    lifecycleSettings,
    kernelOperation,
    operationalHealth,
    providerServiceBinding
  );
  const historySnapshots = buildAnalyticsHistory(
    input,
    event,
    persistedState,
    syncMetadata,
    externalHandoff,
    validationSummary,
    commandOutcome,
    proof,
    lifecycleSettings,
    kernelOperation,
    operationalHealth,
    now
  );
  const analyticsCounters = buildAnalyticsCounters(
    historySnapshots,
    validationSummary,
    commandOutcome,
    persistedState,
    externalHandoff,
    now
  );
  const analyticsExport = buildAnalyticsExport(
    event,
    requestContext,
    tenantBoundary,
    historySnapshots,
    analyticsCounters,
    now
  );
  const reporting = buildReportingTimeline(
    event,
    requestContext,
    historySnapshots,
    analyticsCounters,
    validationSummary,
    readiness
  );
  const clientContracts = buildClientRouteContracts(
    event,
    requestContext,
    preview,
    readiness,
    validationSummary,
    nextSteps,
    lifecycleNextAction,
    recoveryCommand,
    workflowHandoff,
    proof,
    acceptanceDecision,
    operationalHealth,
    clientRuntime,
    tenantBoundary,
    persistedState,
    commandOutcome,
    lifecycleControlAudit,
    providerServiceBinding,
    readinessChecklist,
    now
  );

  return {
    ok: readiness.canCommit,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      type: 'hosted-kernel-audit-event',
      provider: providerContract,
      capabilities,
      event,
      request: requestContext,
      tenantBoundary,
      clientRuntime,
      persistedState,
      lifecycleSettings,
      lifecycleControlAudit,
      recoveryCommand,
      operationalHealth,
      healthDirective,
      providerServiceBinding,
      kernelOperation
    },
    preview,
    acceptance: {
      state: acceptanceState,
      accepted: readiness.canCommit,
      acceptedAt: readiness.canCommit ? now : null,
      gate: readiness.canAccept ? 'operator-acceptance' : 'validation',
      commitProofKey: readiness.canCommit ? proof.proofKey : null,
      decision: acceptanceDecision
    },
    readiness,
    readinessChecklist,
    validationSummary,
    nextSteps,
    clientContracts,
    syncMetadata,
    recovery: {
      status: commandOutcome.nextPersistedState.status,
      restartSafe: persistedState.restartSafe && commandOutcome.restartSafe,
      replayRequired: persistedState.replay.required,
      persistedState: {
        schemaVersion: persistedState.schemaVersion,
        stateId: persistedState.stateId,
        durableKey: persistedState.durableKey,
        status: persistedState.status,
        terminal: persistedState.terminal,
        recoveryCursor: persistedState.recoveryCursor,
        checkpoint: persistedState.checkpoint,
        lease: persistedState.lease,
        replay: persistedState.replay,
        recoveryPath: persistedState.recoveryPath,
        commandJournal: persistedState.commands.journal,
        validation: persistedState.validation
      },
      statePatch: kernelOperation.writeSet.persistedStatePatch,
      lifecycleState: lifecycleSettings.state,
      nextAction: lifecycleNextAction,
      lifecycleControlAudit,
      command: commandOutcome,
      operationalHealth,
      providerServiceBinding,
      kernelOperation
    },
    analytics: {
      counters: analyticsCounters,
      historySnapshots,
      export: analyticsExport,
      reporting
    },
    externalHandoff,
    workflowHandoff,
    proof: {
      ...proof,
      checks: {
        ...proof.checks,
        persistedStateRestartSafe: persistedState.restartSafe,
        persistedCommandJournalRestartSafe: persistedState.commands.journal.restartStatus === 'restart-safe',
        persistedCommandReplayRequired: persistedState.commands.journal.replayPlan.required,
        persistedCommandRepairRequired: persistedState.commands.journal.restartStatus === 'operator-repair-required',
        commandIdempotent: commandOutcome.duplicate || commandOutcome.accepted,
        commandAccepted: commandOutcome.accepted,
        commandQueuedForRetry: commandOutcome.queuedForRetry,
        kernelOperationDispatchable: kernelOperation.dispatchable,
        kernelOperationRetryScheduled: kernelOperation.retry.scheduled,
        kernelOperationAtomic: kernelOperation.writeSet.atomic,
        providerServiceBindingReady: providerServiceBinding.validation.length === 0,
        lifecycleControlAllowed: lifecycleControlAudit.command.allowed,
        lifecycleControlBlocked: lifecycleControlAudit.blockedReasons.length > 0,
        workflowHandoffReady: workflowHandoff.validation.length === 0 && workflowHandoff.state !== 'repair-required',
        workflowHydrationRequired: workflowHandoff.hydration.required,
        workflowUserActionEnabled: workflowHandoff.userActionContract.enabled
      }
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeAuditEventSurface;
