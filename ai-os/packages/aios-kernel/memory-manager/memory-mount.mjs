export const surfaceId = "aios_memory-manager_memory-mount_041";
export const surfaceGroup = "memory-manager";
export const surfaceName = "memory-mount";

const DEFAULT_ROUTE = '/kernel/memory-manager/memory-mount';
const DEFAULT_SESSION_ID = 'anonymous-session';
const DEFAULT_CLIENT_ID = 'unbound-client';
const DEFAULT_TENANT_ID = 'default-tenant';
const DEFAULT_WORKSPACE_ID = 'default-workspace';
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 30;
const PERSISTED_STATE_SCHEMA_VERSION = 2;
const ALLOWED_MOUNT_KINDS = new Set([
  'project',
  'structural',
  'episodic',
  'artifact',
  'volatile',
  'conversation',
  'workspace',
  'agent',
  'ephemeral'
]);
const ALLOWED_HANDOFFS = new Set(['continue', 'review', 'repair', 'persist']);
const ALLOWED_COMMANDS = new Set(['attach', 'detach', 'select', 'refresh', 'recover', 'enable', 'disable', 'schedule']);
const ALLOWED_LIFECYCLE_MODES = new Set(['automatic', 'manual', 'paused']);
const ALLOWED_SCHEDULE_RUN_POLICIES = new Set(['defer', 'run_now', 'skip_if_recent']);
const ALLOWED_CLIENT_VIEWS = new Set(['mounts', 'preview', 'validation', 'repair', 'workflow']);
const ALLOWED_SOURCE_KINDS = new Set(['kernel-store', 'thread-log', 'workspace-index', 'agent-cache', 'artifact-store', 'ephemeral-buffer']);
const ALLOWED_ACCESS_MODES = new Set(['read', 'write', 'read-write']);
const ALLOWED_PROVIDER_CAPABILITIES = new Set([
  'mount:read',
  'mount:write',
  'mount:recover',
  'mount:schedule',
  'mount:handoff',
  'sync:metadata',
  'sync:incremental',
  'sync:snapshot',
  'audit:proof',
  'artifact:resolve'
]);
const ALLOWED_PROVIDER_SYNC_MODES = new Set(['incremental', 'snapshot', 'disabled']);
const ALLOWED_PROVIDER_HEALTH_STATES = new Set(['healthy', 'degraded', 'unavailable', 'throttled', 'stale']);
const MAX_HEALTH_FAILURES = 10;
const MAX_PROVIDER_FAILURES = 12;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_SECONDS = 15;
const MAX_RETRY_DELAY_SECONDS = 900;
const HEALTH_STALE_AFTER_SECONDS = 300;
const SOURCE_CONTRACT_CLOCK_SKEW_SECONDS = 120;
const MIN_SCHEDULE_INTERVAL_MINUTES = 5;
const MAX_SCHEDULE_INTERVAL_MINUTES = 1440;
const MAX_SCHEDULE_JITTER_SECONDS = 300;
const SCHEDULE_PRESETS = [
  { key: 'near_realtime', label: 'Every 5 minutes', intervalMinutes: 5, jitterSeconds: 30 },
  { key: 'balanced', label: 'Every 30 minutes', intervalMinutes: 30, jitterSeconds: 90 },
  { key: 'daily', label: 'Daily', intervalMinutes: 1440, jitterSeconds: 300 }
];
const MAX_ANALYTICS_HISTORY = 16;
const MAX_ANALYTICS_TIMELINE = 24;
const MAX_COMMAND_LOG_ENTRIES = 25;
const MAX_STATE_JOURNAL_ENTRIES = 20;
const MAX_COMMAND_EXECUTION_RECORDS = 32;
const MAX_MAILCHIMP_CONTINUITY_SUBJECTS = 12;
const MOUNT_KIND_ALIASES = {
  conversation: 'episodic',
  workspace: 'project',
  agent: 'structural',
  ephemeral: 'volatile'
};
const MEMORY_MOUNT_DESCRIPTORS = {
  project: {
    kind: 'project',
    label: 'Project memory',
    summary: 'Durable workspace facts, decisions, and project-level operating context.',
    sourceKind: 'workspace-index',
    defaultScopeKind: 'workspace',
    defaultRetentionPolicy: 'workspace',
    defaultTtlMinutes: 43200,
    durability: 'durable',
    mutability: 'curated',
    visibility: 'workspace',
    lifecycle: 'scheduled_refresh',
    routeSegment: 'project'
  },
  structural: {
    kind: 'structural',
    label: 'Structural memory',
    summary: 'Reusable schemas, relationships, and agent operating structures for the workspace.',
    sourceKind: 'agent-cache',
    defaultScopeKind: 'workspace',
    defaultRetentionPolicy: 'workspace',
    defaultTtlMinutes: 43200,
    durability: 'durable',
    mutability: 'system_managed',
    visibility: 'workspace',
    lifecycle: 'provider_synchronized',
    routeSegment: 'structural'
  },
  episodic: {
    kind: 'episodic',
    label: 'Episodic memory',
    summary: 'Thread-local interaction history and recent workflow events.',
    sourceKind: 'thread-log',
    defaultScopeKind: 'thread',
    defaultRetentionPolicy: 'session',
    defaultTtlMinutes: 10080,
    durability: 'recoverable',
    mutability: 'append_only',
    visibility: 'session',
    lifecycle: 'refresh_on_resume',
    routeSegment: 'episodic'
  },
  artifact: {
    kind: 'artifact',
    label: 'Artifact memory',
    summary: 'Resolved files, generated artifacts, and artifact metadata linked to the workflow.',
    sourceKind: 'artifact-store',
    defaultScopeKind: 'workspace',
    defaultRetentionPolicy: 'artifact',
    defaultTtlMinutes: 525600,
    durability: 'durable',
    mutability: 'content_addressed',
    visibility: 'workspace',
    lifecycle: 'resolve_on_access',
    routeSegment: 'artifact'
  },
  volatile: {
    kind: 'volatile',
    label: 'Volatile memory',
    summary: 'Short-lived scratch state scoped to the current session.',
    sourceKind: 'ephemeral-buffer',
    defaultScopeKind: 'session',
    defaultRetentionPolicy: 'session',
    defaultTtlMinutes: 120,
    durability: 'transient',
    mutability: 'overwrite_allowed',
    visibility: 'session',
    lifecycle: 'discard_on_session_end',
    routeSegment: 'volatile'
  }
};
const REQUIRED_DESCRIPTOR_MOUNT_KINDS = ['project', 'structural', 'episodic', 'artifact', 'volatile'];
const DESCRIPTOR_COMMAND_POLICY = {
  project: {
    supportedCommands: ['attach', 'detach', 'select', 'refresh', 'recover', 'enable', 'disable', 'schedule'],
    writeCommands: ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'],
    requiredCapabilities: ['mount:read', 'mount:write', 'mount:recover', 'mount:schedule', 'sync:metadata', 'sync:incremental', 'sync:snapshot'],
    handoffAction: 'persist_project_memory'
  },
  structural: {
    supportedCommands: ['attach', 'detach', 'select', 'refresh', 'recover', 'enable', 'disable', 'schedule'],
    writeCommands: ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'],
    requiredCapabilities: ['mount:read', 'mount:write', 'mount:recover', 'mount:schedule', 'sync:metadata', 'sync:incremental', 'sync:snapshot'],
    handoffAction: 'synchronize_structural_memory'
  },
  episodic: {
    supportedCommands: ['attach', 'detach', 'select', 'refresh', 'recover', 'enable', 'disable', 'schedule'],
    writeCommands: ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'],
    requiredCapabilities: ['mount:read', 'mount:write', 'mount:recover', 'mount:schedule', 'sync:metadata', 'sync:incremental', 'sync:snapshot'],
    handoffAction: 'resume_thread_memory'
  },
  artifact: {
    supportedCommands: ['attach', 'detach', 'select', 'refresh', 'recover', 'enable', 'disable', 'schedule'],
    writeCommands: ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'],
    requiredCapabilities: ['mount:read', 'mount:write', 'mount:recover', 'mount:schedule', 'sync:metadata', 'sync:snapshot', 'artifact:resolve'],
    handoffAction: 'resolve_artifact_memory'
  },
  volatile: {
    supportedCommands: ['attach', 'detach', 'select', 'refresh', 'enable', 'disable', 'schedule'],
    writeCommands: ['attach', 'detach', 'enable', 'disable', 'schedule'],
    requiredCapabilities: ['mount:read', 'mount:write', 'mount:schedule', 'sync:metadata', 'sync:incremental'],
    handoffAction: 'bind_session_scratch_memory'
  }
};
const DESCRIPTOR_SCOPE_KINDS = new Set(['tenant', 'workspace', 'thread', 'session', 'artifact']);
const DESCRIPTOR_DURABILITY_VALUES = new Set(['durable', 'recoverable', 'transient']);
const DESCRIPTOR_VISIBILITY_VALUES = new Set(['tenant', 'workspace', 'session']);
const ALLOWED_RETENTION_POLICIES = new Set(['tenant', 'workspace', 'session', 'artifact', 'ephemeral']);
const DESCRIPTOR_CANONICAL_FIELDS = [
  'sourceKind',
  'scopeKind',
  'defaultScopeKind',
  'defaultRetentionPolicy',
  'durability',
  'mutability',
  'visibility',
  'lifecycle',
  'routeSegment'
];
const SOURCE_KIND_BY_MOUNT_KIND = {
  project: MEMORY_MOUNT_DESCRIPTORS.project.sourceKind,
  structural: MEMORY_MOUNT_DESCRIPTORS.structural.sourceKind,
  episodic: MEMORY_MOUNT_DESCRIPTORS.episodic.sourceKind,
  artifact: MEMORY_MOUNT_DESCRIPTORS.artifact.sourceKind,
  volatile: MEMORY_MOUNT_DESCRIPTORS.volatile.sourceKind,
  conversation: 'thread-log',
  workspace: 'workspace-index',
  agent: 'agent-cache',
  ephemeral: 'ephemeral-buffer'
};
const RESTART_RECOVERY_COMMANDS = new Set(['recover', 'refresh', 'select']);
const MAX_CLIENT_HANDOFFS = 8;
const MAX_BOUNDARY_AUDIT_REJECTIONS = 12;
const ACCEPTANCE_REQUIRED_COMMANDS = new Set(['attach', 'detach', 'recover', 'enable', 'disable', 'schedule']);
const TARGETED_COMMANDS = new Set(['detach', 'select', 'refresh', 'recover']);
const ALLOWED_ROLES = new Set(['memory_viewer', 'memory_operator', 'memory_auditor', 'tenant_admin']);
const ALLOWED_PERMISSIONS = new Set([
  'memory:read',
  'memory:write',
  'memory:audit',
  'memory:recover',
  'memory:crossTenant'
]);
const ROLE_PERMISSIONS = {
  memory_viewer: ['memory:read'],
  memory_operator: ['memory:read', 'memory:write', 'memory:recover'],
  memory_auditor: ['memory:read', 'memory:audit'],
  tenant_admin: ['memory:read', 'memory:write', 'memory:audit', 'memory:recover', 'memory:crossTenant']
};
const COMMAND_PERMISSION = {
  attach: 'memory:write',
  detach: 'memory:write',
  select: 'memory:read',
  refresh: 'memory:read',
  recover: 'memory:recover',
  enable: 'memory:write',
  disable: 'memory:write',
  schedule: 'memory:write'
};
const REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND = {
  attach: ['mount:write', 'sync:metadata'],
  detach: ['mount:write', 'sync:metadata'],
  select: ['mount:read'],
  refresh: ['mount:read', 'sync:incremental'],
  recover: ['mount:recover', 'sync:snapshot'],
  enable: ['mount:write'],
  disable: ['mount:write'],
  schedule: ['mount:schedule']
};
const PROVIDER_SERVICE_BY_SOURCE_KIND = {
  'kernel-store': 'kernel.memory.store',
  'thread-log': 'kernel.memory.thread-log',
  'workspace-index': 'kernel.memory.workspace-index',
  'agent-cache': 'kernel.memory.agent-cache',
  'artifact-store': 'kernel.memory.artifact-store',
  'ephemeral-buffer': 'kernel.memory.ephemeral-buffer'
};
const PROVIDER_OPERATION_BY_COMMAND = {
  attach: 'memory.mount.attach',
  detach: 'memory.mount.detach',
  select: 'memory.mount.select',
  refresh: 'memory.mount.refresh',
  recover: 'memory.mount.recover',
  enable: 'memory.lifecycle.enable',
  disable: 'memory.lifecycle.disable',
  schedule: 'memory.lifecycle.schedule'
};
const PROVIDER_HANDOFF_ACTION_BY_CAPABILITY = {
  'mount:read': 'request_read_mount_scope',
  'mount:write': 'request_write_mount_scope',
  'mount:recover': 'request_recovery_snapshot',
  'mount:schedule': 'request_schedule_control',
  'mount:handoff': 'request_external_handoff',
  'sync:metadata': 'request_sync_metadata',
  'sync:incremental': 'request_incremental_sync',
  'sync:snapshot': 'request_snapshot_sync',
  'audit:proof': 'request_audit_proof',
  'artifact:resolve': 'request_artifact_resolution'
};
const PROVIDER_SYNC_MODE_BY_MOUNT_KIND = {
  project: 'incremental',
  structural: 'snapshot',
  episodic: 'incremental',
  artifact: 'snapshot',
  volatile: 'incremental'
};
const PROVIDER_EXTERNAL_HANDOFF_REQUIRED_KINDS = new Set(['project', 'structural', 'artifact']);
const HEALTH_WRITE_COMMANDS = new Set(['attach', 'detach', 'recover', 'enable', 'disable', 'schedule']);
const MAILCHIMP_MEMORY_SOURCE_KINDS = new Set(['workspace-index', 'agent-cache', 'artifact-store']);
const MAILCHIMP_SYNC_EVENT_KINDS = new Set(['audience-sync', 'campaign-sync', 'segment-sync', 'automation-sync']);
const MAILCHIMP_REQUIRED_SYNC_FIELDS = ['audienceId'];

function stableString(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableString).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proofToken(parts) {
  let hash = 2166136261;
  const text = stableString(parts);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mmount-${(hash >>> 0).toString(36).padStart(7, '0')}`;
}

function normalizeNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeIsoString(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value.trim()))
    ? new Date(Date.parse(value.trim())).toISOString()
    : null;
}

function normalizeMailchimpMountContext(value = {}, fallback = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const source = raw.mailchimp && typeof raw.mailchimp === 'object' ? raw.mailchimp : raw;
  const identifiers = source.identifiers && typeof source.identifiers === 'object' ? source.identifiers : {};
  const audienceId = normalizeNonEmptyString(source.audienceId ?? source.listId ?? identifiers.audienceId, fallback.audienceId ?? null);
  const campaignId = normalizeNonEmptyString(source.campaignId ?? identifiers.campaignId, fallback.campaignId ?? null);
  const segmentId = normalizeNonEmptyString(source.segmentId ?? identifiers.segmentId, fallback.segmentId ?? null);
  const automationId = normalizeNonEmptyString(source.automationId ?? identifiers.automationId, fallback.automationId ?? null);
  const rawEventKinds = normalizeStringList(source.eventKinds ?? source.events);
  const eventKinds = (rawEventKinds.length ? rawEventKinds : ['audience-sync'])
    .filter((kind, index, list) => MAILCHIMP_SYNC_EVENT_KINDS.has(kind) && list.indexOf(kind) === index);
  const unsupportedEventKinds = rawEventKinds.filter((kind) => !MAILCHIMP_SYNC_EVENT_KINDS.has(kind));
  const requestedSyncMode = normalizeNonEmptyString(source.syncMode ?? source.mode, fallback.syncMode ?? 'incremental');
  const syncMode = ['incremental', 'snapshot', 'webhook'].includes(requestedSyncMode)
    ? requestedSyncMode
    : 'incremental';
  const missingRequiredFields = [
    ...(!audienceId ? ['audienceId'] : [])
  ];
  const externalRevision = normalizeNonEmptyString(source.externalRevision ?? source.revision, fallback.externalRevision ?? null);
  const lastSyncedAt = normalizeIsoString(source.lastSyncedAt ?? source.syncedAt) || fallback.lastSyncedAt || null;
  const ready = missingRequiredFields.length === 0 && eventKinds.length > 0;

  return {
    schemaVersion: 1,
    provider: 'mailchimp',
    ready,
    subjectKey: `mailchimp:${audienceId || 'audience-unbound'}:${campaignId || segmentId || automationId || 'workspace'}`,
    identifiers: {
      audienceId,
      campaignId,
      segmentId,
      automationId,
      missingRequiredFields
    },
    sync: {
      mode: syncMode,
      eventKinds,
      unsupportedEventKinds,
      externalRevision,
      lastSyncedAt
    },
    validationIssues: [
      ...missingRequiredFields.map((field) => ({
        field: `mailchimp.${field}`,
        reason: 'mailchimp_required_sync_field_missing',
        requiredFields: MAILCHIMP_REQUIRED_SYNC_FIELDS
      })),
      ...unsupportedEventKinds.map((kind) => ({
        field: 'mailchimp.eventKinds',
        reason: 'unsupported_mailchimp_sync_event_kind',
        value: kind,
        allowed: [...MAILCHIMP_SYNC_EVENT_KINDS].sort()
      })),
      ...(requestedSyncMode === syncMode ? [] : [{
        field: 'mailchimp.syncMode',
        reason: 'unsupported_mailchimp_sync_mode',
        value: requestedSyncMode,
        normalizedValue: syncMode
      }])
    ],
    nextAction: ready
      ? {
          action: 'sync_mailchimp_memory_scope',
          requiredCapability: syncMode === 'snapshot' ? 'sync:snapshot' : 'sync:incremental'
        }
      : {
          action: 'collect_mailchimp_sync_scope',
          missingRequiredFields
        }
  };
}

function buildMailchimpMountSyncContract({ mountId, sourceKind, providerMailchimp, mountMailchimp, lifecycle, shapedState }) {
  const context = normalizeMailchimpMountContext(mountMailchimp, providerMailchimp.identifiers);
  const sourceSupported = MAILCHIMP_MEMORY_SOURCE_KINDS.has(sourceKind);
  const scheduleAligned = lifecycle.settings.schedule.enabled
    ? lifecycle.settings.schedule.nextRunAt !== null
    : true;
  const ready = context.ready && sourceSupported && scheduleAligned;
  const blockers = [
    ...context.identifiers.missingRequiredFields.map((field) => `missing:${field}`),
    ...(!sourceSupported ? [`unsupported-source:${sourceKind}`] : []),
    ...(!scheduleAligned ? ['schedule-next-run-missing'] : [])
  ];
  const contract = {
    schemaVersion: 1,
    mountId,
    provider: 'mailchimp',
    sourceKind,
    ready,
    status: ready ? 'ready' : 'blocked',
    subjectKey: context.subjectKey,
    identifiers: context.identifiers,
    eventKinds: context.sync.eventKinds,
    syncMode: context.sync.mode,
    externalRevision: context.sync.externalRevision,
    lastSyncedAt: context.sync.lastSyncedAt,
    nextSyncAt: lifecycle.settings.schedule.enabled ? lifecycle.settings.schedule.nextRunAt : null,
    stateEpoch: shapedState.persistedStatePatch.epoch,
    blockers,
    validationIssues: [
      ...context.validationIssues,
      ...(!sourceSupported ? [{
        field: `mounts.${mountId}.source.kind`,
        reason: 'mailchimp_source_kind_not_syncable',
        value: sourceKind,
        allowed: [...MAILCHIMP_MEMORY_SOURCE_KINDS].sort()
      }] : [])
    ],
    nextAction: ready
      ? {
          action: 'publish_mailchimp_mount_sync',
          payload: {
            mountId,
            audienceId: context.identifiers.audienceId,
            campaignId: context.identifiers.campaignId,
            externalRevision: context.sync.externalRevision
          }
        }
      : {
          action: 'repair_mailchimp_mount_sync',
          blockers
        }
  };

  return {
    ...contract,
    proof: proofToken(contract)
  };
}

function buildMailchimpMountClientWorkflow({ request, command, lifecycle, shapedState, mailchimpMountSync }) {
  const routeBase = `${request.route}/provider/mailchimp-sync`;
  const readyMounts = mailchimpMountSync.filter((entry) => entry.ready);
  const blockedMounts = mailchimpMountSync.filter((entry) => !entry.ready);
  const validationIssueCount = mailchimpMountSync
    .reduce((total, entry) => total + entry.validationIssues.length, 0);
  const acceptanceToken = proofToken({
    surfaceId,
    commandId: command.commandId,
    stateEpoch: shapedState.persistedStatePatch.epoch,
    readyMountIds: readyMounts.map((entry) => entry.mountId),
    blockedMountIds: blockedMounts.map((entry) => entry.mountId),
    subjects: mailchimpMountSync.map((entry) => entry.subjectKey)
  });
  const status = blockedMounts.length
    ? 'needs_review'
    : (readyMounts.length ? 'ready_for_acceptance' : 'not_requested');
  const routeCards = mailchimpMountSync.map((entry) => ({
    mountId: entry.mountId,
    subjectKey: entry.subjectKey,
    status: entry.ready ? 'ready' : 'blocked',
    route: entry.ready ? `${routeBase}/preview/${entry.mountId}` : `${routeBase}/scope/${entry.mountId}`,
    nextAction: entry.nextAction.action,
    blockers: entry.blockers,
    validationIssueCount: entry.validationIssues.length,
    proof: proofToken({
      mountId: entry.mountId,
      subjectKey: entry.subjectKey,
      ready: entry.ready,
      blockers: entry.blockers,
      nextAction: entry.nextAction.action
    })
  }));

  return {
    schemaVersion: 1,
    contentType: 'application/vnd.aios.memory-mount.mailchimp-workflow+json',
    status,
    routeBase,
    commandId: command.commandId,
    commandType: command.type,
    stateEpoch: shapedState.persistedStatePatch.epoch,
    lifecycle: {
      enabled: lifecycle.settings.enabled,
      scheduleEnabled: lifecycle.settings.schedule.enabled,
      nextRunAt: lifecycle.settings.schedule.nextRunAt
    },
    preview: {
      route: `${routeBase}/preview`,
      readyMountIds: readyMounts.map((entry) => entry.mountId),
      blockedMountIds: blockedMounts.map((entry) => entry.mountId),
      cards: routeCards,
      validationIssueCount
    },
    acceptance: {
      route: `${routeBase}/accept`,
      method: 'POST',
      required: readyMounts.length > 0,
      enabled: readyMounts.length > 0 && blockedMounts.length === 0,
      token: readyMounts.length > 0 && blockedMounts.length === 0 ? acceptanceToken : null,
      blockedReason: blockedMounts.length ? 'mailchimp_mount_sync_blocked' : null,
      body: readyMounts.length > 0 && blockedMounts.length === 0
        ? {
            commandId: command.commandId,
            stateEpoch: shapedState.persistedStatePatch.epoch,
            mountIds: readyMounts.map((entry) => entry.mountId),
            token: acceptanceToken
          }
        : null
    },
    validationSummary: {
      route: `${routeBase}/validation`,
      status: blockedMounts.length ? 'review' : 'clean',
      issueCount: validationIssueCount,
      blockedMountIds: blockedMounts.map((entry) => entry.mountId),
      issues: blockedMounts.flatMap((entry) =>
        entry.validationIssues.map((issue) => ({
          mountId: entry.mountId,
          subjectKey: entry.subjectKey,
          ...issue
        }))
      )
    },
    nextSteps: blockedMounts.length
      ? blockedMounts.map((entry) => ({
          action: 'repair_mailchimp_mount_sync',
          route: `${routeBase}/scope/${entry.mountId}`,
          mountId: entry.mountId,
          blockers: entry.blockers
        }))
      : readyMounts.map((entry) => ({
          action: 'publish_mailchimp_mount_sync',
          route: `${routeBase}/accept`,
          mountId: entry.mountId,
          token: acceptanceToken
        })),
    proof: proofToken({
      commandId: command.commandId,
      status,
      routeProofs: routeCards.map((card) => card.proof),
      acceptanceToken,
      validationIssueCount
    })
  };
}

function evaluateSourceClockBoundary(source, rawMount, retentionContract, now, id) {
  const observedAt = normalizeIsoString(
    source.observedAt ?? source.checkedAt ?? source.syncedAt ?? rawMount.observedAt ?? rawMount.lastSyncedAt
  );
  const issuedAt = normalizeIsoString(
    source.issuedAt ?? source.generatedAt ?? source.createdAt ?? rawMount.issuedAt
  );
  const nowMs = Date.parse(now);
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const issuedMs = issuedAt ? Date.parse(issuedAt) : NaN;
  const maxFutureSkewMs = SOURCE_CONTRACT_CLOCK_SKEW_SECONDS * 1000;
  const ttlMs = retentionContract.ttlMinutes * 60 * 1000;
  const staleAfterMs = Number.isFinite(observedMs) ? observedMs + ttlMs : NaN;
  const violations = [];

  if (!observedAt) {
    violations.push('source_observed_at_missing');
  } else if (Number.isFinite(nowMs) && observedMs > nowMs + maxFutureSkewMs) {
    violations.push('source_observed_at_from_future');
  } else if (Number.isFinite(nowMs) && Number.isFinite(staleAfterMs) && staleAfterMs < nowMs) {
    violations.push('source_contract_stale');
  }

  if (issuedAt && Number.isFinite(nowMs) && issuedMs > nowMs + maxFutureSkewMs) {
    violations.push('source_issued_at_from_future');
  }

  const status = violations.some((violation) => violation.endsWith('_from_future'))
    ? 'clock_skew'
    : violations.includes('source_contract_stale')
      ? 'stale'
      : violations.includes('source_observed_at_missing')
        ? 'unproven'
        : 'fresh';

  return {
    schemaVersion: 1,
    mountId: id,
    status,
    observedAt,
    issuedAt,
    evaluatedAt: now,
    maxFutureSkewSeconds: SOURCE_CONTRACT_CLOCK_SKEW_SECONDS,
    ttlMinutes: retentionContract.ttlMinutes,
    staleAfterAt: Number.isFinite(staleAfterMs) ? new Date(staleAfterMs).toISOString() : null,
    restartSafe: status === 'fresh',
    violations,
    proof: proofToken({
      id,
      observedAt,
      issuedAt,
      now,
      ttlMinutes: retentionContract.ttlMinutes,
      violations
    })
  };
}

function canonicalMountKind(kind) {
  const requested = typeof kind === 'string' && kind.trim() ? kind.trim() : 'project';
  return MOUNT_KIND_ALIASES[requested] || requested;
}

function normalizeMountKindContract(rawKind, id, field = 'mounts.kind') {
  const requestedKind = typeof rawKind === 'string' && rawKind.trim() ? rawKind.trim() : 'project';
  const canonicalKind = canonicalMountKind(requestedKind);
  const aliasKind = MOUNT_KIND_ALIASES[requestedKind] || null;
  const requestedAllowed = ALLOWED_MOUNT_KINDS.has(requestedKind);
  const descriptorAvailable = Boolean(MEMORY_MOUNT_DESCRIPTORS[canonicalKind]);
  const accepted = requestedAllowed && descriptorAvailable;
  const issues = [];

  if (!requestedAllowed) {
    issues.push({
      field,
      reason: 'unsupported_mount_kind',
      value: requestedKind,
      normalizedValue: descriptorAvailable ? canonicalKind : null
    });
  }

  if (requestedAllowed && aliasKind) {
    issues.push({
      field,
      reason: 'legacy_mount_kind_alias_canonicalized',
      value: requestedKind,
      normalizedValue: canonicalKind
    });
  }

  if (requestedAllowed && !descriptorAvailable) {
    issues.push({
      field,
      reason: 'mount_kind_descriptor_missing',
      value: requestedKind,
      normalizedValue: canonicalKind
    });
  }

  const contract = {
    schemaVersion: 1,
    mountId: id || null,
    requestedKind,
    canonicalKind,
    aliasKind,
    requestedAllowed,
    descriptorAvailable,
    accepted,
    descriptorRoute: descriptorAvailable
      ? `/kernel/memory-manager/memory-mount/descriptors/${MEMORY_MOUNT_DESCRIPTORS[canonicalKind].routeSegment}`
      : null,
    status: accepted
      ? (aliasKind ? 'canonicalized' : 'accepted')
      : 'rejected',
    issues
  };

  return {
    ...contract,
    proof: proofToken(contract)
  };
}

function descriptorDefaultScopeValue(defaultScopeKind, clientState) {
  if (defaultScopeKind === 'tenant') {
    return clientState.tenantId;
  }
  if (defaultScopeKind === 'workspace') {
    return clientState.workspaceId;
  }
  if (defaultScopeKind === 'thread') {
    return clientState.activeThreadId || clientState.sessionId;
  }
  return clientState.sessionId;
}

function descriptorScopeValue(scopeKind, fallbackScope, clientState) {
  if (scopeKind === 'tenant') {
    return clientState.tenantId;
  }
  if (scopeKind === 'workspace') {
    return clientState.workspaceId;
  }
  if (scopeKind === 'thread') {
    return clientState.activeThreadId || fallbackScope || clientState.sessionId;
  }
  if (scopeKind === 'artifact') {
    return fallbackScope || clientState.workspaceId;
  }
  return fallbackScope || clientState.sessionId;
}

function parseMemoryMountScope(rawScope, { descriptorScopeKind, fallbackScope, clientState }) {
  const scope = normalizeNonEmptyString(rawScope, fallbackScope || clientState.sessionId);
  const [prefix, ...rest] = scope.split(':');
  const requestedScopeKind = rest.length > 0 && prefix.trim() ? prefix.trim() : null;
  const requestedScopeValue = rest.length > 0 ? rest.join(':').trim() : scope;
  const fallbackScopeKind = DESCRIPTOR_SCOPE_KINDS.has(descriptorScopeKind) ? descriptorScopeKind : 'session';
  const scopeKind = requestedScopeKind && DESCRIPTOR_SCOPE_KINDS.has(requestedScopeKind)
    ? requestedScopeKind
    : fallbackScopeKind;
  const defaultScopeValue = descriptorScopeValue(scopeKind, fallbackScope, clientState);
  const scopeValue = normalizeNonEmptyString(requestedScopeValue, defaultScopeValue);
  const canonicalScope = requestedScopeKind ? `${scopeKind}:${scopeValue}` : scopeValue;
  const issues = [];

  if (requestedScopeKind && !DESCRIPTOR_SCOPE_KINDS.has(requestedScopeKind)) {
    issues.push({
      field: 'scope',
      reason: 'unsupported_scope_kind',
      value: requestedScopeKind,
      normalizedValue: scopeKind
    });
  }

  if (requestedScopeKind && requestedScopeKind !== scopeKind) {
    issues.push({
      field: 'scope',
      reason: 'scope_kind_normalized',
      value: requestedScopeKind,
      normalizedValue: scopeKind
    });
  }

  if (canonicalScope !== scope) {
    issues.push({
      field: 'scope',
      reason: 'scope_value_canonicalized',
      value: scope,
      normalizedValue: canonicalScope
    });
  }

  return {
    rawScope: scope,
    requestedScopeKind,
    scopeKind,
    scopeValue,
    canonicalScope,
    scopeEnforced: Boolean(requestedScopeKind && DESCRIPTOR_SCOPE_KINDS.has(requestedScopeKind)),
    issues,
    proof: proofToken({
      rawScope: scope,
      requestedScopeKind,
      scopeKind,
      scopeValue,
      canonicalScope
    })
  };
}

function normalizeRetentionContract({ requestedPolicy, requestedTtlMinutes, descriptorTemplate, canonicalKind, id }) {
  const policy = ALLOWED_RETENTION_POLICIES.has(requestedPolicy)
    ? requestedPolicy
    : descriptorTemplate.defaultRetentionPolicy;
  const effectivePolicy = canonicalKind === 'volatile' ? 'session' : policy;
  const ttlMinutes = normalizeInteger(
    requestedTtlMinutes,
    descriptorTemplate.defaultTtlMinutes,
    5,
    525600
  );
  const issues = [];

  if (!ALLOWED_RETENTION_POLICIES.has(requestedPolicy)) {
    issues.push({
      field: `mounts.${id}.source.retention.policy`,
      reason: 'unsupported_retention_policy',
      value: requestedPolicy,
      normalizedValue: policy
    });
  }

  if (canonicalKind === 'volatile' && policy !== 'session') {
    issues.push({
      field: `mounts.${id}.source.retention.policy`,
      reason: 'volatile_retention_forced_to_session',
      value: policy,
      normalizedValue: effectivePolicy
    });
  }

  if (Number.isFinite(requestedTtlMinutes) && requestedTtlMinutes !== ttlMinutes) {
    issues.push({
      field: `mounts.${id}.source.retention.ttlMinutes`,
      reason: 'retention_ttl_minutes_clamped',
      value: requestedTtlMinutes,
      normalizedValue: ttlMinutes
    });
  }

  return {
    policy: effectivePolicy,
    requestedPolicy,
    ttlMinutes,
    issues,
    proof: proofToken({ id, canonicalKind, requestedPolicy, policy: effectivePolicy, ttlMinutes })
  };
}

function buildDescriptorSourceBinding({ canonicalKind, requestedKind, requestedSourceKind, baseSourceKind, id, clientState }) {
  const template = MEMORY_MOUNT_DESCRIPTORS[canonicalKind] || MEMORY_MOUNT_DESCRIPTORS.project;
  const expectedSourceKind = template.sourceKind;
  const normalized = baseSourceKind !== expectedSourceKind;
  const sourceKind = normalized ? expectedSourceKind : baseSourceKind;
  const binding = {
    schemaVersion: 1,
    mountKind: canonicalKind,
    requestedKind,
    mountId: id,
    expectedSourceKind,
    requestedSourceKind,
    sourceKind,
    sourceNormalized: normalized,
    bindingPolicy: 'descriptor_canonical_source',
    status: normalized ? 'normalized' : 'bound',
    providerServiceId: PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind],
    defaultSourceUri: `aios://memory/${clientState.tenantId}/${clientState.workspaceId}/${sourceKind}/${id}`,
    descriptorRoute: `/kernel/memory-manager/memory-mount/descriptors/${template.routeSegment}`
  };

  return {
    sourceKind,
    binding: {
      ...binding,
      proof: proofToken(binding)
    },
    issues: normalized
      ? [{
          field: `mounts.${id}.source.kind`,
          reason: 'descriptor_source_kind_normalized',
          value: requestedSourceKind,
          normalizedValue: sourceKind,
          expectedSourceKind,
          descriptorKind: canonicalKind
        }]
      : []
  };
}

function requestedDescriptorValue(descriptor, field, fallback) {
  if (!descriptor || typeof descriptor !== 'object') {
    return fallback;
  }
  if (field === 'sourceKind') {
    return normalizeNonEmptyString(descriptor.sourceKind ?? descriptor.defaultSourceKind, fallback);
  }
  if (field === 'scopeKind') {
    return normalizeNonEmptyString(descriptor.scopeKind ?? descriptor.defaultScopeKind, fallback);
  }
  if (field === 'defaultRetentionPolicy') {
    return normalizeNonEmptyString(descriptor.defaultRetentionPolicy ?? descriptor.retentionPolicy, fallback);
  }
  return normalizeNonEmptyString(descriptor[field], fallback);
}

function descriptorTemplateFallback(template, field) {
  if (field === 'scopeKind') {
    return template.defaultScopeKind;
  }
  if (field === 'sourceKind') {
    return template.sourceKind;
  }
  if (field === 'defaultRetentionPolicy') {
    return template.defaultRetentionPolicy;
  }
  return template[field];
}

function buildRequiredDescriptorRepairs({ rawDescriptor, canonicalKind, requestedKind, template, normalized }) {
  const descriptor = rawDescriptor && typeof rawDescriptor === 'object' ? rawDescriptor : {};
  const repairs = [];

  if (requestedKind !== canonicalKind) {
    repairs.push({
      field: 'descriptor.kind',
      reason: 'descriptor_kind_alias_canonicalized',
      value: requestedKind,
      normalizedValue: canonicalKind,
      descriptorKind: canonicalKind
    });
  }

  if (typeof descriptor.kind === 'string' && descriptor.kind.trim() && canonicalMountKind(descriptor.kind) !== canonicalKind) {
    repairs.push({
      field: 'descriptor.kind',
      reason: 'descriptor_kind_forced_to_mount_kind',
      value: descriptor.kind.trim(),
      normalizedValue: canonicalKind,
      descriptorKind: canonicalKind
    });
  }

  for (const field of DESCRIPTOR_CANONICAL_FIELDS) {
    const requestedValue = requestedDescriptorValue(descriptor, field, descriptorTemplateFallback(template, field));
    const normalizedValue = normalized[field];
    if (requestedValue !== normalizedValue) {
      repairs.push({
        field: `descriptor.${field}`,
        reason: 'required_descriptor_field_canonicalized',
        value: requestedValue,
        normalizedValue,
        descriptorKind: canonicalKind
      });
    }
  }

  if (Number.isFinite(descriptor.ttlMinutes) && descriptor.ttlMinutes !== normalized.ttlMinutes) {
    repairs.push({
      field: 'descriptor.ttlMinutes',
      reason: 'descriptor_ttl_minutes_normalized',
      value: descriptor.ttlMinutes,
      normalizedValue: normalized.ttlMinutes,
      descriptorKind: canonicalKind
    });
  }

  return repairs;
}

function buildMemoryMountDescriptor({ rawDescriptor, kind, id, scope, sourceKind, clientState }) {
  const kindContract = normalizeMountKindContract(kind, id, 'descriptor.kind');
  const canonicalKind = kindContract.canonicalKind;
  const template = MEMORY_MOUNT_DESCRIPTORS[canonicalKind] || MEMORY_MOUNT_DESCRIPTORS.project;
  const descriptor = rawDescriptor && typeof rawDescriptor === 'object' ? rawDescriptor : {};
  const scopeKind = DESCRIPTOR_SCOPE_KINDS.has(template.defaultScopeKind) ? template.defaultScopeKind : 'session';
  const durability = DESCRIPTOR_DURABILITY_VALUES.has(template.durability) ? template.durability : 'recoverable';
  const visibility = DESCRIPTOR_VISIBILITY_VALUES.has(template.visibility) ? template.visibility : 'session';
  const routeSegment = template.routeSegment;
  const defaultScopeKind = template.defaultScopeKind;
  const retentionPolicy = template.defaultRetentionPolicy;
  const ttlMinutes = normalizeInteger(descriptor.ttlMinutes, template.defaultTtlMinutes, 5, 525600);
  const commandPolicy = buildDescriptorCommandContract(canonicalKind);
  const descriptorScope = scopeKind === 'tenant'
    ? clientState.tenantId
    : (scopeKind === 'workspace'
        ? clientState.workspaceId
        : (scopeKind === 'thread'
            ? clientState.activeThreadId || scope
            : scope));
  const normalized = {
    sourceKind,
    scopeKind,
    defaultScopeKind,
    defaultRetentionPolicy: retentionPolicy,
    durability,
    mutability: template.mutability,
    visibility,
    lifecycle: template.lifecycle,
    routeSegment,
    ttlMinutes
  };
  const repairIssues = buildRequiredDescriptorRepairs({
    rawDescriptor: descriptor,
    canonicalKind,
    requestedKind: kind,
    template,
    normalized
  });
  const contract = {
    schemaVersion: 1,
    descriptorId: proofToken({ kind: canonicalKind, id, scope, sourceKind, descriptorScope }),
    kind: canonicalKind,
    requestedKind: kind,
    legacyKind: canonicalKind === kind ? null : kind,
    kindContract,
    label: normalizeNonEmptyString(descriptor.label, template.label),
    summary: normalizeNonEmptyString(descriptor.summary, template.summary),
    sourceKind,
    scopeKind,
    defaultScopeKind,
    descriptorScope,
    durability,
    mutability: template.mutability,
    visibility,
    lifecycle: template.lifecycle,
    commandPolicy,
    route: `/kernel/memory-manager/memory-mount/descriptors/${routeSegment}`,
    defaultSourceKind: template.sourceKind,
    sourceBindingStatus: sourceKind === template.sourceKind ? 'bound' : 'normalized',
    providerServiceId: PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind],
    retentionPolicy,
    ttlMinutes,
    descriptorStatus: repairIssues.length ? 'repaired' : 'canonical',
    requiredDescriptorSurface: REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(canonicalKind),
    repairIssues,
    repairProof: proofToken({
      canonicalKind,
      kindContractProof: kindContract.proof,
      id,
      sourceKind,
      commandPolicyProof: commandPolicy.proof,
      repairIssues
    })
  };

  return {
    ...contract,
    proof: proofToken(contract)
  };
}

function buildDescriptorCommandContract(canonicalKind) {
  const policy = DESCRIPTOR_COMMAND_POLICY[canonicalKind] || DESCRIPTOR_COMMAND_POLICY.project;
  const supportedCommands = policy.supportedCommands.filter((command) => ALLOWED_COMMANDS.has(command));
  const writeCommands = policy.writeCommands.filter((command) => supportedCommands.includes(command));
  const readCommands = supportedCommands.filter((command) => !writeCommands.includes(command));
  const requiredCapabilities = policy.requiredCapabilities
    .filter((capability) => ALLOWED_PROVIDER_CAPABILITIES.has(capability))
    .filter((capability, index, list) => list.indexOf(capability) === index)
    .sort();
  const contract = {
    schemaVersion: 1,
    kind: canonicalKind,
    supportedCommands,
    readCommands,
    writeCommands,
    requiredCapabilities,
    handoffAction: policy.handoffAction,
    unsupportedCommands: [...ALLOWED_COMMANDS].filter((command) => !supportedCommands.includes(command)).sort()
  };

  return {
    ...contract,
    proof: proofToken(contract)
  };
}

function descriptorSupportsCommand(mount, commandType) {
  const descriptorPolicy = mount.descriptor?.commandPolicy;
  const fallbackPolicy = buildDescriptorCommandContract(mount.kind);
  const supportedCommands = Array.isArray(descriptorPolicy?.supportedCommands)
    ? descriptorPolicy.supportedCommands
    : fallbackPolicy.supportedCommands;
  return supportedCommands.includes(commandType);
}

function buildDescriptorCommandBoundary({ mount, command }) {
  const policy = mount.descriptor?.commandPolicy || buildDescriptorCommandContract(mount.kind);
  const supported = descriptorSupportsCommand(mount, command.type);
  const commandRequiredCapabilities = REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[command.type] || ['mount:read'];
  const providerCommand = mount.sourceContract?.providerContract?.commandCapabilities?.[command.type] || null;
  const boundary = {
    schemaVersion: 1,
    mountId: mount.id,
    descriptorKind: mount.descriptor?.kind || mount.kind,
    commandType: command.type,
    supported,
    supportedCommands: policy.supportedCommands,
    writeCommands: policy.writeCommands,
    requiredCapabilities: policy.requiredCapabilities,
    commandRequiredCapabilities,
    providerOperation: providerCommand?.operation || PROVIDER_OPERATION_BY_COMMAND[command.type] || 'memory.mount.command',
    providerCommandCapabilityStatus: providerCommand?.status || (supported ? 'declared' : 'unsupported'),
    providerCommandCapabilities: providerCommand?.requiredCapabilities || commandRequiredCapabilities,
    providerServiceId: mount.sourceContract?.providerContract?.serviceId || null,
    handoffAction: policy.handoffAction,
    descriptorPolicyProof: policy.proof || null
  };

  return {
    ...boundary,
    proof: proofToken(boundary)
  };
}

function buildMountProviderContract({
  id,
  canonicalKind,
  sourceKind,
  uri,
  accessMode,
  sourceEpoch,
  checksum,
  labels,
  commandPolicy,
  sourceBinding,
  scopeContract,
  retentionContract,
  clientState
}) {
  const preferredSyncMode = PROVIDER_SYNC_MODE_BY_MOUNT_KIND[canonicalKind] || 'incremental';
  const serviceId = PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind] || 'kernel.memory.unknown-source';
  const supportedCommands = Array.isArray(commandPolicy.supportedCommands) ? commandPolicy.supportedCommands : [];
  const descriptorRequiredCapabilities = Array.isArray(commandPolicy.requiredCapabilities)
    ? commandPolicy.requiredCapabilities
    : [];
  const commandCapabilities = Object.fromEntries(supportedCommands.map((commandType) => {
    const baseRequired = REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[commandType] || ['mount:read'];
    const requiredCapabilities = [...new Set([
      ...baseRequired,
      ...(commandType === 'recover' ? ['sync:snapshot'] : []),
      ...(canonicalKind === 'artifact' ? ['artifact:resolve'] : [])
    ])].filter((capability) => ALLOWED_PROVIDER_CAPABILITIES.has(capability)).sort();
    const missingFromDescriptor = requiredCapabilities.filter((capability) => !descriptorRequiredCapabilities.includes(capability));
    const contract = {
      operation: PROVIDER_OPERATION_BY_COMMAND[commandType] || 'memory.mount.command',
      requiredCapabilities,
      missingFromDescriptor,
      status: missingFromDescriptor.length ? 'descriptor_gap' : 'declared',
      writeOperation: ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'].includes(commandType)
    };
    return [commandType, {
      ...contract,
      proof: proofToken({ id, canonicalKind, sourceKind, commandType, contract })
    }];
  }));
  const syncMetadata = {
    mode: preferredSyncMode,
    metadataCapability: 'sync:metadata',
    cursorFields: ['mountId', 'sourceKind', 'sourceEpoch', 'checksum', 'scopeProof', 'retentionProof'],
    cursor: proofToken({
      mountId: id,
      sourceKind,
      sourceEpoch,
      checksum,
      scopeProof: scopeContract.proof,
      retentionProof: retentionContract.proof
    }),
    sourceEpoch,
    checksum,
    labels,
    retentionPolicy: retentionContract.policy,
    ttlMinutes: retentionContract.ttlMinutes,
    scopeKind: scopeContract.scopeKind,
    canonicalScope: scopeContract.canonicalScope,
    snapshotRequired: preferredSyncMode === 'snapshot',
    incrementalAllowed: preferredSyncMode === 'incremental'
  };
  const externalHandoffRequired = PROVIDER_EXTERNAL_HANDOFF_REQUIRED_KINDS.has(canonicalKind);
  const externalHandoff = {
    required: externalHandoffRequired,
    action: commandPolicy.handoffAction,
    route: `/kernel/memory-manager/memory-mount/provider/services/${sourceKind}/handoff`,
    payloadHint: externalHandoffRequired ? 'provider_service_ticket' : 'inline_kernel_handoff',
    requiredCapability: externalHandoffRequired ? 'mount:handoff' : null
  };
  const contract = {
    schemaVersion: 1,
    mountId: id,
    descriptorKind: canonicalKind,
    sourceKind,
    serviceId,
    serviceRoute: `/kernel/memory-manager/memory-mount/provider/services/${sourceKind}`,
    sourceUri: uri,
    accessMode,
    bindingProof: sourceBinding.proof,
    syncMetadata,
    commandCapabilities,
    externalHandoff,
    negotiationStatus: Object.values(commandCapabilities).some((entry) => entry.status === 'descriptor_gap')
      ? 'descriptor_gap'
      : 'declared',
    clientScope: {
      tenantId: clientState.tenantId,
      workspaceId: clientState.workspaceId,
      sessionId: clientState.sessionId,
      activeThreadId: clientState.activeThreadId
    }
  };

  return {
    ...contract,
    proof: proofToken(contract)
  };
}

function buildMemoryMountDescriptorCatalog({ request, clientState }) {
  const aliasesByCanonicalKind = Object.entries(MOUNT_KIND_ALIASES).reduce((aliases, [alias, canonicalKind]) => {
    aliases[canonicalKind] = [...(aliases[canonicalKind] || []), alias].sort();
    return aliases;
  }, {});
  const descriptors = Object.values(MEMORY_MOUNT_DESCRIPTORS).map((descriptor) => {
    const scope = descriptorDefaultScopeValue(descriptor.defaultScopeKind, clientState);
    const commandPolicy = buildDescriptorCommandContract(descriptor.kind);
    const sourceBinding = {
      bindingPolicy: 'descriptor_canonical_source',
      expectedSourceKind: descriptor.sourceKind,
      sourceKind: descriptor.sourceKind,
      providerServiceId: PROVIDER_SERVICE_BY_SOURCE_KIND[descriptor.sourceKind],
      defaultSourceUri: `aios://memory/${clientState.tenantId}/${clientState.workspaceId}/${descriptor.sourceKind}/${descriptor.kind}`,
      status: 'bound'
    };
    const providerContract = {
      serviceId: sourceBinding.providerServiceId,
      preferredSyncMode: PROVIDER_SYNC_MODE_BY_MOUNT_KIND[descriptor.kind] || 'incremental',
      syncMetadataRequired: true,
      externalHandoffRequired: PROVIDER_EXTERNAL_HANDOFF_REQUIRED_KINDS.has(descriptor.kind),
      externalHandoffAction: commandPolicy.handoffAction,
      operationByCommand: Object.fromEntries(commandPolicy.supportedCommands.map((command) => [
        command,
        PROVIDER_OPERATION_BY_COMMAND[command] || 'memory.mount.command'
      ])),
      requiredCapabilitiesByCommand: Object.fromEntries(commandPolicy.supportedCommands.map((command) => [
        command,
        REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[command] || ['mount:read']
      ]))
    };
    const contract = {
      schemaVersion: 1,
      kind: descriptor.kind,
      aliases: aliasesByCanonicalKind[descriptor.kind] || [],
      label: descriptor.label,
      summary: descriptor.summary,
      sourceKind: descriptor.sourceKind,
      defaultScopeKind: descriptor.defaultScopeKind,
      defaultScopeValue: scope,
      defaultRetentionPolicy: descriptor.defaultRetentionPolicy,
      defaultTtlMinutes: descriptor.defaultTtlMinutes,
      durability: descriptor.durability,
      mutability: descriptor.mutability,
      visibility: descriptor.visibility,
      lifecycle: descriptor.lifecycle,
      commandPolicy,
      route: `${request.route}/descriptors/${descriptor.routeSegment}`,
      defaultSourceUri: sourceBinding.defaultSourceUri,
      providerServiceId: sourceBinding.providerServiceId,
      providerContract: {
        ...providerContract,
        proof: proofToken(providerContract)
      },
      sourceBinding: {
        ...sourceBinding,
        proof: proofToken(sourceBinding)
      },
      requiredForDescriptorSurface: REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(descriptor.kind)
    };
    return {
      ...contract,
      proof: proofToken(contract)
    };
  });
  const descriptorKinds = descriptors.map((descriptor) => descriptor.kind);
  const missingRequiredKinds = REQUIRED_DESCRIPTOR_MOUNT_KINDS.filter((kind) => !descriptorKinds.includes(kind));
  const sourceMismatches = descriptors
    .filter((descriptor) => descriptor.sourceKind !== SOURCE_KIND_BY_MOUNT_KIND[descriptor.kind])
    .map((descriptor) => ({
      kind: descriptor.kind,
      sourceKind: descriptor.sourceKind,
      expectedSourceKind: SOURCE_KIND_BY_MOUNT_KIND[descriptor.kind]
    }));
  const requiredCoverage = {
    schemaVersion: 1,
    status: missingRequiredKinds.length || sourceMismatches.length ? 'incomplete' : 'complete',
    requiredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS,
    coveredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS.filter((kind) => descriptorKinds.includes(kind)),
    missingKinds: missingRequiredKinds,
    sourceMismatches,
    descriptorRoutes: Object.fromEntries(descriptors
      .filter((descriptor) => REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(descriptor.kind))
      .map((descriptor) => [descriptor.kind, descriptor.route])),
    providerServices: Object.fromEntries(descriptors
      .filter((descriptor) => REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(descriptor.kind))
      .map((descriptor) => [descriptor.kind, descriptor.providerServiceId])),
    providerSyncModes: Object.fromEntries(descriptors
      .filter((descriptor) => REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(descriptor.kind))
      .map((descriptor) => [descriptor.kind, descriptor.providerContract.preferredSyncMode])),
    providerHandoffRequiredKinds: descriptors
      .filter((descriptor) => descriptor.providerContract.externalHandoffRequired)
      .map((descriptor) => descriptor.kind),
    commandPolicies: Object.fromEntries(descriptors
      .filter((descriptor) => REQUIRED_DESCRIPTOR_MOUNT_KINDS.includes(descriptor.kind))
      .map((descriptor) => [descriptor.kind, {
        supportedCommands: descriptor.commandPolicy.supportedCommands,
        requiredCapabilities: descriptor.commandPolicy.requiredCapabilities,
        providerRequiredCapabilitiesByCommand: descriptor.providerContract.requiredCapabilitiesByCommand,
        proof: descriptor.commandPolicy.proof
      }])),
    proof: proofToken({
      requiredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS,
      coveredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS.filter((kind) => descriptorKinds.includes(kind)),
      missingRequiredKinds,
      sourceMismatches,
      commandPolicyProofs: descriptors.map((descriptor) => descriptor.commandPolicy.proof)
    })
  };

  return {
    schemaVersion: 1,
    contentType: 'application/vnd.aios.memory-mount.descriptors+json',
    route: `${request.route}/descriptors`,
    supportedKinds: descriptors.map((descriptor) => descriptor.kind),
    requiredCoverage,
    descriptors,
    legacyAliases: MOUNT_KIND_ALIASES,
    proof: proofToken({
      route: request.route,
      supportedKinds: descriptors.map((descriptor) => descriptor.kind),
      descriptorProofs: descriptors.map((descriptor) => descriptor.proof),
      legacyAliases: MOUNT_KIND_ALIASES,
      requiredCoverageProof: requiredCoverage.proof
    })
  };
}

function normalizeMountSourceContract(rawMount, { kind, requestedKind, id, scope, clientState, now }) {
  const source = rawMount.source && typeof rawMount.source === 'object' ? rawMount.source : {};
  const kindContract = normalizeMountKindContract(requestedKind || kind, id, `mounts.${id}.kind`);
  const canonicalKind = kindContract.canonicalKind;
  const descriptorTemplate = MEMORY_MOUNT_DESCRIPTORS[canonicalKind] || MEMORY_MOUNT_DESCRIPTORS.project;
  const requestedSourceKind = normalizeNonEmptyString(source.kind ?? rawMount.sourceKind, descriptorTemplate.sourceKind);
  const baseSourceKind = ALLOWED_SOURCE_KINDS.has(requestedSourceKind)
    ? requestedSourceKind
    : descriptorTemplate.sourceKind;
  const sourceBinding = buildDescriptorSourceBinding({
    canonicalKind,
    requestedKind: requestedKind || kind,
    requestedSourceKind,
    baseSourceKind,
    id,
    clientState
  });
  const sourceKind = sourceBinding.sourceKind;
  const requestedAccessMode = normalizeNonEmptyString(source.accessMode ?? rawMount.accessMode, rawMount.writable === true ? 'read-write' : 'read');
  const accessMode = ALLOWED_ACCESS_MODES.has(requestedAccessMode) ? requestedAccessMode : 'read';
  const uri = normalizeNonEmptyString(
    source.uri ?? rawMount.sourceUri,
    `aios://memory/${clientState.tenantId}/${clientState.workspaceId}/${sourceKind}/${id}`
  );
  const sourceEpoch = normalizeInteger(source.epoch ?? rawMount.sourceEpoch, 0, 0, Number.MAX_SAFE_INTEGER);
  const checksum = typeof source.checksum === 'string' && source.checksum.trim() ? source.checksum.trim() : null;
  const retention = source.retention && typeof source.retention === 'object' ? source.retention : {};
  const requestedRetentionPolicy = normalizeNonEmptyString(retention.policy ?? rawMount.retentionPolicy, descriptorTemplate.defaultRetentionPolicy);
  const requestedTtlMinutes = retention.ttlMinutes ?? rawMount.ttlMinutes;
  const retentionContract = normalizeRetentionContract({
    requestedPolicy: requestedRetentionPolicy,
    requestedTtlMinutes,
    descriptorTemplate,
    canonicalKind,
    id
  });
  const sourceFreshness = evaluateSourceClockBoundary(source, rawMount, retentionContract, now, id);
  const scopeContract = parseMemoryMountScope(scope, {
    descriptorScopeKind: descriptorTemplate.defaultScopeKind,
    fallbackScope: scope,
    clientState
  });
  const labels = normalizeStringList(source.labels ?? rawMount.labels).slice(0, 12);
  const issues = [...kindContract.issues];

  if (!ALLOWED_SOURCE_KINDS.has(requestedSourceKind)) {
    issues.push({ field: `mounts.${id}.source.kind`, reason: 'unsupported_source_kind', value: requestedSourceKind, normalizedValue: sourceKind });
  }
  if (!ALLOWED_ACCESS_MODES.has(requestedAccessMode)) {
    issues.push({ field: `mounts.${id}.source.accessMode`, reason: 'unsupported_access_mode', value: requestedAccessMode, normalizedValue: accessMode });
  }
  issues.push(...sourceBinding.issues);
  issues.push(...retentionContract.issues);
  issues.push(...sourceFreshness.violations.map((violation) => ({
    field: `mounts.${id}.source.observedAt`,
    reason: violation,
    value: source.observedAt ?? source.checkedAt ?? source.syncedAt ?? rawMount.observedAt ?? rawMount.lastSyncedAt ?? null,
    normalizedValue: sourceFreshness.observedAt,
    status: sourceFreshness.status,
    staleAfterAt: sourceFreshness.staleAfterAt
  })));
  issues.push(...scopeContract.issues.map((issue) => ({
    ...issue,
    field: `mounts.${id}.${issue.field}`
  })));

  const descriptor = buildMemoryMountDescriptor({
    rawDescriptor: rawMount.descriptor,
    kind: requestedKind || kind,
    id,
    scope,
    sourceKind,
    clientState
  });
  issues.push(...descriptor.repairIssues.map((issue) => ({
    ...issue,
    field: `mounts.${id}.${issue.field}`
  })));
  const providerContract = buildMountProviderContract({
    id,
    canonicalKind,
    sourceKind,
    kindContract,
    uri,
    accessMode,
    sourceEpoch,
    checksum,
    labels,
    commandPolicy: descriptor.commandPolicy,
    sourceBinding: sourceBinding.binding,
    scopeContract,
    retentionContract,
    clientState
  });
  const contract = {
    sourceKind,
    uri,
    scope,
    canonicalScope: scopeContract.canonicalScope,
    scopeContract,
    descriptorSourceBinding: sourceBinding.binding,
    accessMode,
    sourceEpoch,
    checksum,
    labels,
    retention: {
      policy: retentionContract.policy,
      requestedPolicy: retentionContract.requestedPolicy,
      ttlMinutes: retentionContract.ttlMinutes,
      proof: retentionContract.proof
    },
    sourceFreshness,
    providerContract,
    kernelRoute: `/kernel/memory-manager/memory-mount/sources/${sourceKind}`,
    consistency: sourceEpoch > 0 || checksum ? 'source_backed' : 'declared',
    descriptorKind: descriptor.kind,
    descriptorProof: descriptor.proof,
    proof: proofToken({
      id,
      kind,
      canonicalKind,
      sourceKind,
      kindContractProof: kindContract.proof,
      uri,
      scope,
      accessMode,
      sourceEpoch,
      checksum,
      labels,
      retentionPolicy: retentionContract.policy,
      ttlMinutes: retentionContract.ttlMinutes,
      scopeContractProof: scopeContract.proof,
      retentionProof: retentionContract.proof,
      sourceFreshnessProof: sourceFreshness.proof,
      descriptorSourceBindingProof: sourceBinding.binding.proof,
      providerContractProof: providerContract.proof,
      descriptorProof: descriptor.proof
    })
  };

  return { contract, descriptor, issues };
}

function addMinutesToIso(now, minutes) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp + minutes * 60 * 1000).toISOString();
}

function addSecondsToIso(now, seconds) {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp + seconds * 1000).toISOString();
}

function isFutureIso(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  return Number.isFinite(timestamp) && Number.isFinite(nowTimestamp) && timestamp > nowTimestamp;
}

function isRunnableIso(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  return Number.isFinite(timestamp) && Number.isFinite(nowTimestamp) && timestamp >= nowTimestamp;
}

function minutesSinceIso(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) {
    return null;
  }
  return Math.max(0, Math.floor((nowTimestamp - timestamp) / 60000));
}

function normalizeRequest(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const route = typeof request.route === 'string' && request.route.trim() ? request.route.trim() : DEFAULT_ROUTE;
  const action = typeof request.action === 'string' && request.action.trim() ? request.action.trim() : 'mount';
  const handoff = ALLOWED_HANDOFFS.has(request.handoff) ? request.handoff : 'continue';

  return {
    route,
    action,
    handoff,
    requestId: typeof request.requestId === 'string' && request.requestId.trim()
      ? request.requestId.trim()
      : proofToken({ route, action, handoff })
  };
}

function normalizeClientState(input) {
  const state = input.clientState && typeof input.clientState === 'object' ? input.clientState : {};
  return {
    clientId: typeof state.clientId === 'string' && state.clientId.trim() ? state.clientId.trim() : DEFAULT_CLIENT_ID,
    sessionId: typeof state.sessionId === 'string' && state.sessionId.trim() ? state.sessionId.trim() : DEFAULT_SESSION_ID,
    tenantId: normalizeNonEmptyString(state.tenantId, DEFAULT_TENANT_ID),
    workspaceId: normalizeNonEmptyString(state.workspaceId, DEFAULT_WORKSPACE_ID),
    activeThreadId: typeof state.activeThreadId === 'string' && state.activeThreadId.trim()
      ? state.activeThreadId.trim()
      : null,
    selectedMountId: typeof state.selectedMountId === 'string' && state.selectedMountId.trim()
      ? state.selectedMountId.trim()
      : null
  };
}

function normalizeClientRuntime(input, request, clientState) {
  const state = input.clientState && typeof input.clientState === 'object' ? input.clientState : {};
  const runtime = state.memoryMountRuntime && typeof state.memoryMountRuntime === 'object'
    ? state.memoryMountRuntime
    : {};
  const rawHandoffs = Array.isArray(runtime.pendingHandoffs) ? runtime.pendingHandoffs : [];
  const pendingHandoffs = rawHandoffs
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      handoffId: normalizeNonEmptyString(entry.handoffId, proofToken({
        route: entry.route,
        commandId: entry.commandId,
        mountId: entry.mountId
      })),
      route: normalizeNonEmptyString(entry.route, request.route),
      status: normalizeNonEmptyString(entry.status, 'pending'),
      commandId: typeof entry.commandId === 'string' && entry.commandId.trim() ? entry.commandId.trim() : null,
      mountId: typeof entry.mountId === 'string' && entry.mountId.trim() ? entry.mountId.trim() : null,
      token: typeof entry.token === 'string' && entry.token.trim() ? entry.token.trim() : null,
      createdAt: typeof entry.createdAt === 'string' && entry.createdAt.trim() ? entry.createdAt.trim() : null
    }))
    .slice(-MAX_CLIENT_HANDOFFS);
  const selectedView = typeof runtime.selectedView === 'string' && ALLOWED_CLIENT_VIEWS.has(runtime.selectedView)
    ? runtime.selectedView
    : 'mounts';

  return {
    clientId: clientState.clientId,
    sessionId: clientState.sessionId,
    selectedView,
    lastKnownEpoch: normalizeInteger(runtime.lastKnownEpoch, 0, 0, Number.MAX_SAFE_INTEGER),
    lastAcceptedToken: typeof runtime.lastAcceptedToken === 'string' && runtime.lastAcceptedToken.trim()
      ? runtime.lastAcceptedToken.trim()
      : null,
    pendingHandoffId: typeof runtime.pendingHandoffId === 'string' && runtime.pendingHandoffId.trim()
      ? runtime.pendingHandoffId.trim()
      : null,
    pendingHandoffs,
    routeBindings: {
      mountRoute: normalizeNonEmptyString(runtime.routeBindings?.mountRoute, request.route),
      previewRoute: normalizeNonEmptyString(runtime.routeBindings?.previewRoute, `${request.route}/preview`),
      acceptanceRoute: normalizeNonEmptyString(runtime.routeBindings?.acceptanceRoute, `${request.route}/accept`),
      validationRoute: normalizeNonEmptyString(runtime.routeBindings?.validationRoute, `${request.route}/validation`),
      workflowRoute: normalizeNonEmptyString(runtime.routeBindings?.workflowRoute, `${request.route}/workflow`)
    }
  };
}

function normalizePrincipal(input, clientState) {
  const principal = input.principal && typeof input.principal === 'object' ? input.principal : {};
  const rawRoles = normalizeStringList(principal.roles ?? clientState.roles);
  const roles = rawRoles.filter((role) => ALLOWED_ROLES.has(role));
  const effectiveRoles = roles.length ? roles : ['memory_operator'];
  const rolePermissions = effectiveRoles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const explicitPermissions = normalizeStringList(principal.permissions).filter((permission) => ALLOWED_PERMISSIONS.has(permission));
  const permissions = [...new Set([...rolePermissions, ...explicitPermissions])].sort();

  return {
    principalId: normalizeNonEmptyString(principal.principalId, clientState.clientId),
    tenantId: normalizeNonEmptyString(principal.tenantId, clientState.tenantId),
    workspaceId: normalizeNonEmptyString(principal.workspaceId, clientState.workspaceId),
    roles: effectiveRoles,
    permissions,
    canCrossTenant: permissions.includes('memory:crossTenant'),
    canWrite: permissions.includes('memory:write'),
    canAudit: permissions.includes('memory:audit')
  };
}

function normalizePersistedState(input) {
  const state = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const commandLog = Array.isArray(state.commandLog) ? state.commandLog : [];
  const mountsById = state.mountsById && typeof state.mountsById === 'object' ? state.mountsById : {};
  const lifecycle = state.lifecycle && typeof state.lifecycle === 'object' ? state.lifecycle : {};
  const schedule = lifecycle.schedule && typeof lifecycle.schedule === 'object' ? lifecycle.schedule : {};
  const lifecycleMode = ALLOWED_LIFECYCLE_MODES.has(lifecycle.mode) ? lifecycle.mode : 'manual';

  return {
    version: Number.isInteger(state.version) && state.version > 0 ? state.version : PERSISTED_STATE_SCHEMA_VERSION,
    epoch: Number.isInteger(state.epoch) && state.epoch >= 0 ? state.epoch : 0,
    activeMountId: typeof state.activeMountId === 'string' && state.activeMountId.trim()
      ? state.activeMountId.trim()
      : null,
    lastCommittedAt: normalizeIsoString(state.lastCommittedAt),
    mountsById,
    lifecycle: {
      enabled: normalizeBoolean(lifecycle.enabled, true),
      mode: lifecycleMode,
      refreshOnResume: normalizeBoolean(lifecycle.refreshOnResume, true),
      schedule: {
        enabled: normalizeBoolean(schedule.enabled, lifecycleMode === 'automatic') && lifecycleMode === 'automatic',
        intervalMinutes: normalizeInteger(schedule.intervalMinutes, DEFAULT_SCHEDULE_INTERVAL_MINUTES, 5, 1440),
        jitterSeconds: normalizeInteger(schedule.jitterSeconds, 0, 0, 300),
        lastRunAt: normalizeIsoString(schedule.lastRunAt),
        nextRunAt: normalizeIsoString(schedule.nextRunAt)
      }
    },
    analytics: normalizeAnalyticsState(state.analytics),
    commandLog: commandLog
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.commandId === 'string' && entry.commandId.trim())
      .slice(-MAX_COMMAND_LOG_ENTRIES)
      .map((entry) => ({
        commandId: entry.commandId.trim(),
        idempotencyKey: typeof entry.idempotencyKey === 'string' && entry.idempotencyKey.trim()
          ? entry.idempotencyKey.trim()
          : null,
        type: typeof entry.type === 'string' && ALLOWED_COMMANDS.has(entry.type) ? entry.type : null,
        result: typeof entry.result === 'string' && entry.result.trim() ? entry.result.trim() : 'accepted',
        committedAt: normalizeIsoString(entry.committedAt)
      })),
    commandJournal: normalizeStateCommitJournal(state.commandJournal ?? state.stateJournal),
    commandExecutions: normalizeCommandExecutionLedger(state.commandExecutions ?? state.commandExecutionLedger),
    mailchimpContinuity: normalizePersistedMailchimpContinuityState(
      state.mailchimpContinuity ?? state.mailchimpSyncState ?? state.providerContinuity?.mailchimp
    )
  };
}

function normalizeCommand(input, request, clientState) {
  const raw = input.command && typeof input.command === 'object' ? input.command : {};
  const type = typeof raw.type === 'string' && ALLOWED_COMMANDS.has(raw.type) ? raw.type : request.action;
  const normalizedType = ALLOWED_COMMANDS.has(type) ? type : 'attach';
  const mountId = typeof raw.mountId === 'string' && raw.mountId.trim()
    ? raw.mountId.trim()
    : clientState.selectedMountId;
  const commandId = typeof raw.commandId === 'string' && raw.commandId.trim()
    ? raw.commandId.trim()
    : proofToken({ requestId: request.requestId, type: normalizedType, mountId });

  return {
    commandId,
    type: normalizedType,
    mountId,
    idempotencyKey: proofToken({ commandId, type: normalizedType, mountId, route: request.route }),
    schedule: raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : null
  };
}

function normalizeLifecycleSettings(input, persistedState) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const lifecycle = settings.lifecycle && typeof settings.lifecycle === 'object'
    ? settings.lifecycle
    : (persistedState?.lifecycle || {});
  const schedule = lifecycle.schedule && typeof lifecycle.schedule === 'object' ? lifecycle.schedule : {};
  const mode = typeof lifecycle.mode === 'string' && ALLOWED_LIFECYCLE_MODES.has(lifecycle.mode)
    ? lifecycle.mode
    : 'manual';
  const intervalMinutes = normalizeInteger(
    schedule.intervalMinutes,
    DEFAULT_SCHEDULE_INTERVAL_MINUTES,
    MIN_SCHEDULE_INTERVAL_MINUTES,
    MAX_SCHEDULE_INTERVAL_MINUTES
  );
  const jitterSeconds = normalizeInteger(schedule.jitterSeconds, 0, 0, MAX_SCHEDULE_JITTER_SECONDS);
  const lastRunAt = normalizeIsoString(schedule.lastRunAt);
  const nextRunAt = normalizeIsoString(schedule.nextRunAt);
  const enabled = normalizeBoolean(lifecycle.enabled, true);
  const scheduleEnabled = normalizeBoolean(schedule.enabled, mode === 'automatic');
  const refreshOnResume = normalizeBoolean(lifecycle.refreshOnResume, true);
  const validationIssues = [];

  if (typeof lifecycle.mode === 'string' && lifecycle.mode.trim() && !ALLOWED_LIFECYCLE_MODES.has(lifecycle.mode)) {
    validationIssues.push({ field: 'settings.lifecycle.mode', reason: 'unsupported_lifecycle_mode', value: lifecycle.mode });
  }
  if (Number.isFinite(schedule.intervalMinutes) && schedule.intervalMinutes !== intervalMinutes) {
    validationIssues.push({
      field: 'settings.lifecycle.schedule.intervalMinutes',
      reason: 'schedule_interval_clamped',
      value: schedule.intervalMinutes,
      normalizedValue: intervalMinutes
    });
  }
  if (Number.isFinite(schedule.jitterSeconds) && schedule.jitterSeconds !== jitterSeconds) {
    validationIssues.push({
      field: 'settings.lifecycle.schedule.jitterSeconds',
      reason: 'schedule_jitter_clamped',
      value: schedule.jitterSeconds,
      normalizedValue: jitterSeconds
    });
  }
  if (typeof schedule.lastRunAt === 'string' && schedule.lastRunAt.trim() && !lastRunAt) {
    validationIssues.push({
      field: 'settings.lifecycle.schedule.lastRunAt',
      reason: 'invalid_schedule_last_run_at',
      value: schedule.lastRunAt
    });
  }
  if (typeof schedule.nextRunAt === 'string' && schedule.nextRunAt.trim() && !nextRunAt) {
    validationIssues.push({
      field: 'settings.lifecycle.schedule.nextRunAt',
      reason: 'invalid_schedule_next_run_at',
      value: schedule.nextRunAt
    });
  }
  if (scheduleEnabled && mode !== 'automatic') {
    validationIssues.push({
      field: 'settings.lifecycle.schedule.enabled',
      reason: 'schedule_requires_automatic_mode',
      value: scheduleEnabled
    });
  }

  return {
    enabled,
    mode,
    refreshOnResume,
    schedule: {
      enabled: scheduleEnabled && mode === 'automatic',
      intervalMinutes,
      jitterSeconds,
      lastRunAt,
      nextRunAt
    },
    validationIssues
  };
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeCounterMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => typeof key === 'string' && key.trim() && Number.isFinite(count))
      .map(([key, count]) => [key.trim(), Math.max(0, Math.round(count))])
  );
}

function normalizeAnalyticsHistory(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === 'object')
        .slice(-MAX_ANALYTICS_HISTORY)
        .map((entry) => ({
          snapshotId: normalizeNonEmptyString(entry.snapshotId, proofToken(entry)),
          capturedAt: normalizeIsoString(entry.capturedAt),
          epoch: normalizeInteger(entry.epoch, 0, 0, Number.MAX_SAFE_INTEGER),
          commandId: typeof entry.commandId === 'string' && entry.commandId.trim() ? entry.commandId.trim() : null,
          commandType: typeof entry.commandType === 'string' && ALLOWED_COMMANDS.has(entry.commandType) ? entry.commandType : 'refresh',
          outcome: normalizeNonEmptyString(entry.outcome, 'unknown'),
          activeMountId: typeof entry.activeMountId === 'string' && entry.activeMountId.trim() ? entry.activeMountId.trim() : null,
          acceptedCount: normalizeInteger(entry.acceptedCount, 0, 0, Number.MAX_SAFE_INTEGER),
          rejectedCount: normalizeInteger(entry.rejectedCount, 0, 0, Number.MAX_SAFE_INTEGER),
          writableCount: normalizeInteger(entry.writableCount, 0, 0, Number.MAX_SAFE_INTEGER),
          recoveredCount: normalizeInteger(entry.recoveredCount, 0, 0, Number.MAX_SAFE_INTEGER),
          tombstonedCount: normalizeInteger(entry.tombstonedCount, 0, 0, Number.MAX_SAFE_INTEGER),
          lifecycleMode: ALLOWED_LIFECYCLE_MODES.has(entry.lifecycleMode) ? entry.lifecycleMode : 'manual',
          lifecycleEnabled: normalizeBoolean(entry.lifecycleEnabled, true),
          scheduled: normalizeBoolean(entry.scheduled, false),
          lifecycleIssueCount: normalizeInteger(entry.lifecycleIssueCount, 0, 0, Number.MAX_SAFE_INTEGER),
          sourceIssueCount: normalizeInteger(entry.sourceIssueCount, 0, 0, Number.MAX_SAFE_INTEGER),
          readinessLevel: normalizeNonEmptyString(entry.readinessLevel, 'unknown'),
          restartLevel: normalizeNonEmptyString(entry.restartLevel, 'unknown'),
          healthStatus: normalizeNonEmptyString(entry.healthStatus, 'unknown'),
          validationStatus: normalizeNonEmptyString(entry.validationStatus, 'unknown'),
          mountKinds: normalizeCounterMap(entry.mountKinds),
          sourceKinds: normalizeCounterMap(entry.sourceKinds),
          descriptorStatuses: normalizeCounterMap(entry.descriptorStatuses),
          descriptorLifecycles: normalizeCounterMap(entry.descriptorLifecycles),
          retentionPolicies: normalizeCounterMap(entry.retentionPolicies),
          scopeKinds: normalizeCounterMap(entry.scopeKinds),
          durabilityClasses: normalizeCounterMap(entry.durabilityClasses),
          sourceAccessModes: normalizeCounterMap(entry.sourceAccessModes),
          proof: typeof entry.proof === 'string' && entry.proof.trim() ? entry.proof.trim() : proofToken(entry)
        }))
    : [];
}

function normalizeAnalyticsState(value) {
  const analytics = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 1,
    counters: {
      totalCommands: normalizeInteger(analytics.counters?.totalCommands, 0, 0, Number.MAX_SAFE_INTEGER),
      acceptedMountsSeen: normalizeInteger(analytics.counters?.acceptedMountsSeen, 0, 0, Number.MAX_SAFE_INTEGER),
      rejectedMountsSeen: normalizeInteger(analytics.counters?.rejectedMountsSeen, 0, 0, Number.MAX_SAFE_INTEGER),
      recoveredMountsSeen: normalizeInteger(analytics.counters?.recoveredMountsSeen, 0, 0, Number.MAX_SAFE_INTEGER),
      tombstonedMountsSeen: normalizeInteger(analytics.counters?.tombstonedMountsSeen, 0, 0, Number.MAX_SAFE_INTEGER),
      blockedCommands: normalizeInteger(analytics.counters?.blockedCommands, 0, 0, Number.MAX_SAFE_INTEGER),
      replayedCommands: normalizeInteger(analytics.counters?.replayedCommands, 0, 0, Number.MAX_SAFE_INTEGER),
      degradedHealthEvents: normalizeInteger(analytics.counters?.degradedHealthEvents, 0, 0, Number.MAX_SAFE_INTEGER),
      scheduledCommands: normalizeInteger(analytics.counters?.scheduledCommands, 0, 0, Number.MAX_SAFE_INTEGER),
      cleanValidationEvents: normalizeInteger(analytics.counters?.cleanValidationEvents, 0, 0, Number.MAX_SAFE_INTEGER),
      reviewValidationEvents: normalizeInteger(analytics.counters?.reviewValidationEvents, 0, 0, Number.MAX_SAFE_INTEGER),
      sourceContractIssueEvents: normalizeInteger(analytics.counters?.sourceContractIssueEvents, 0, 0, Number.MAX_SAFE_INTEGER),
      lifecycleNormalizationEvents: normalizeInteger(analytics.counters?.lifecycleNormalizationEvents, 0, 0, Number.MAX_SAFE_INTEGER),
      commandsByType: normalizeCounterMap(analytics.counters?.commandsByType),
      outcomesByStatus: normalizeCounterMap(analytics.counters?.outcomesByStatus),
      mountsByKind: normalizeCounterMap(analytics.counters?.mountsByKind),
      sourceKinds: normalizeCounterMap(analytics.counters?.sourceKinds),
      descriptorStatuses: normalizeCounterMap(analytics.counters?.descriptorStatuses),
      descriptorLifecycles: normalizeCounterMap(analytics.counters?.descriptorLifecycles),
      retentionPolicies: normalizeCounterMap(analytics.counters?.retentionPolicies),
      scopeKinds: normalizeCounterMap(analytics.counters?.scopeKinds),
      durabilityClasses: normalizeCounterMap(analytics.counters?.durabilityClasses),
      sourceAccessModes: normalizeCounterMap(analytics.counters?.sourceAccessModes),
      readinessByLevel: normalizeCounterMap(analytics.counters?.readinessByLevel),
      healthByStatus: normalizeCounterMap(analytics.counters?.healthByStatus),
      restartByLevel: normalizeCounterMap(analytics.counters?.restartByLevel),
      activeMountSelections: normalizeCounterMap(analytics.counters?.activeMountSelections)
    },
    history: normalizeAnalyticsHistory(analytics.history),
    lastSnapshotId: typeof analytics.lastSnapshotId === 'string' && analytics.lastSnapshotId.trim()
      ? analytics.lastSnapshotId.trim()
      : null,
    lastExportedAt: normalizeIsoString(analytics.lastExportedAt)
  };
}

function normalizePersistedMailchimpContinuityState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const subjects = Array.isArray(state.subjects) ? state.subjects : [];

  return {
    schemaVersion: 1,
    provider: 'mailchimp',
    status: normalizeNonEmptyString(state.status, 'not_requested'),
    checkpointKey: normalizeNonEmptyString(state.checkpointKey, null),
    lastCommittedAt: normalizeIsoString(state.lastCommittedAt),
    lastAcceptedToken: normalizeNonEmptyString(state.lastAcceptedToken, null),
    replaySafe: normalizeBoolean(state.replaySafe, false),
    pendingHandoff: state.pendingHandoff && typeof state.pendingHandoff === 'object'
      ? {
          route: normalizeNonEmptyString(state.pendingHandoff.route, null),
          payloadRef: normalizeNonEmptyString(state.pendingHandoff.payloadRef, null),
          subjectKeys: normalizeStringList(state.pendingHandoff.subjectKeys),
          reason: normalizeNonEmptyString(state.pendingHandoff.reason, null)
        }
      : null,
    subjects: subjects
      .filter((entry) => entry && typeof entry === 'object')
      .slice(-MAX_MAILCHIMP_CONTINUITY_SUBJECTS)
      .map((entry) => ({
        subjectKey: normalizeNonEmptyString(entry.subjectKey, 'mailchimp:audience-unbound:workspace'),
        status: normalizeNonEmptyString(entry.status, 'blocked'),
        mountIds: normalizeStringList(entry.mountIds),
        readyMountIds: normalizeStringList(entry.readyMountIds),
        blockedMountIds: normalizeStringList(entry.blockedMountIds),
        eventKinds: normalizeStringList(entry.eventKinds).filter((kind) => MAILCHIMP_SYNC_EVENT_KINDS.has(kind)),
        syncMode: ['incremental', 'snapshot', 'webhook'].includes(entry.syncMode) ? entry.syncMode : 'incremental',
        externalRevision: normalizeNonEmptyString(entry.externalRevision, null),
        lastSyncedAt: normalizeIsoString(entry.lastSyncedAt),
        nextSyncAt: normalizeIsoString(entry.nextSyncAt),
        blockerCount: normalizeInteger(entry.blockerCount, 0, 0, Number.MAX_SAFE_INTEGER),
        proof: normalizeNonEmptyString(entry.proof, proofToken(entry))
      }))
  };
}

function normalizeStateCommitJournal(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === 'object' && typeof entry.commandId === 'string' && entry.commandId.trim())
        .slice(-MAX_STATE_JOURNAL_ENTRIES)
        .map((entry) => {
          const commandId = entry.commandId.trim();
          const commandType = typeof entry.commandType === 'string' && ALLOWED_COMMANDS.has(entry.commandType)
            ? entry.commandType
            : 'refresh';
          const status = ['applied', 'blocked', 'replayed'].includes(entry.status) ? entry.status : 'applied';
          const epoch = normalizeInteger(entry.epoch, 0, 0, Number.MAX_SAFE_INTEGER);
          const mountIds = normalizeStringList(entry.mountIds);
          const tombstonedMountIds = normalizeStringList(entry.tombstonedMountIds);
          const committedAt = normalizeIsoString(entry.committedAt);
          const restartLevel = normalizeNonEmptyString(entry.restartLevel, status === 'blocked' ? 'blocked' : 'stable');
          const idempotencyKey = normalizeNonEmptyString(
            entry.idempotencyKey,
            proofToken({ commandId, commandType, epoch })
          );
          const journal = {
            commandId,
            idempotencyKey,
            commandType,
            status,
            epoch,
            activeMountId: typeof entry.activeMountId === 'string' && entry.activeMountId.trim()
              ? entry.activeMountId.trim()
              : null,
            committedAt,
            restartLevel,
            restartSafe: normalizeBoolean(entry.restartSafe, status !== 'blocked'),
            mountIds,
            tombstonedMountIds
          };
          return {
            ...journal,
            proof: typeof entry.proof === 'string' && entry.proof.trim()
              ? entry.proof.trim()
              : proofToken(journal)
          };
        })
    : [];
}

function normalizeCommandExecutionLedger(value) {
  const rawRecords = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? Object.values(value) : []);
  const records = rawRecords
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.commandId === 'string' && entry.commandId.trim())
    .slice(-MAX_COMMAND_EXECUTION_RECORDS)
    .map((entry) => {
      const commandId = entry.commandId.trim();
      const commandType = typeof entry.commandType === 'string' && ALLOWED_COMMANDS.has(entry.commandType)
        ? entry.commandType
        : (typeof entry.type === 'string' && ALLOWED_COMMANDS.has(entry.type) ? entry.type : 'refresh');
      const status = ['applied', 'blocked'].includes(entry.status) ? entry.status : 'applied';
      const epoch = normalizeInteger(entry.epoch ?? entry.resultEpoch, 0, 0, Number.MAX_SAFE_INTEGER);
      const idempotencyKey = normalizeNonEmptyString(
        entry.idempotencyKey,
        proofToken({ commandId, commandType, epoch })
      );
      const mountIds = normalizeStringList(entry.mountIds);
      const tombstonedMountIds = normalizeStringList(entry.tombstonedMountIds);
      const recoveredMountIds = normalizeStringList(entry.recoveredMountIds);
      const checkpoint = {
        schemaVersion: 1,
        commandId,
        idempotencyKey,
        commandType,
        status,
        epoch,
        activeMountId: typeof entry.activeMountId === 'string' && entry.activeMountId.trim()
          ? entry.activeMountId.trim()
          : null,
        restartLevel: normalizeNonEmptyString(entry.restartLevel, status === 'blocked' ? 'blocked' : 'stable'),
        restartSafe: normalizeBoolean(entry.restartSafe, status !== 'blocked'),
        committedAt: normalizeIsoString(entry.committedAt),
        mountIds,
        recoveredMountIds,
        tombstonedMountIds,
        stateFingerprint: normalizeNonEmptyString(entry.stateFingerprint, proofToken({
          commandId,
          idempotencyKey,
          commandType,
          status,
          epoch,
          mountIds,
          recoveredMountIds,
          tombstonedMountIds
        })),
        replayable: normalizeBoolean(entry.replayable, true)
      };
      return {
        ...checkpoint,
        proof: typeof entry.proof === 'string' && entry.proof.trim()
          ? entry.proof.trim()
          : proofToken(checkpoint)
      };
    });
  const deduped = new Map();

  for (const record of records) {
    deduped.set(record.idempotencyKey, record);
    deduped.set(record.commandId, record);
  }

  return [...new Map(records
    .filter((record) => deduped.get(record.commandId) === record || deduped.get(record.idempotencyKey) === record)
    .map((record) => [record.idempotencyKey, record])).values()]
    .slice(-MAX_COMMAND_EXECUTION_RECORDS);
}

function findCommandReplayCheckpoint({ persistedState, command }) {
  const executionRecord = persistedState.commandExecutions.find((entry) =>
    entry.replayable
    && (entry.commandId === command.commandId || entry.idempotencyKey === command.idempotencyKey)
  ) || null;
  if (executionRecord) {
    return {
      source: 'command_executions',
      commandId: executionRecord.commandId,
      idempotencyKey: executionRecord.idempotencyKey,
      status: executionRecord.status,
      epoch: executionRecord.epoch,
      activeMountId: executionRecord.activeMountId,
      restartLevel: executionRecord.restartLevel,
      restartSafe: executionRecord.restartSafe,
      stateFingerprint: executionRecord.stateFingerprint,
      proof: executionRecord.proof
    };
  }

  const commandLogEntry = persistedState.commandLog.find((entry) =>
    entry.commandId === command.commandId || entry.idempotencyKey === command.idempotencyKey
  ) || null;
  if (commandLogEntry) {
    return {
      source: 'command_log',
      commandId: commandLogEntry.commandId,
      idempotencyKey: commandLogEntry.idempotencyKey,
      status: commandLogEntry.result === 'blocked' ? 'blocked' : 'applied',
      epoch: persistedState.epoch,
      activeMountId: persistedState.activeMountId,
      restartLevel: persistedState.activeMountId ? 'stable' : 'needs_recovery',
      restartSafe: Boolean(persistedState.activeMountId && persistedState.mountsById[persistedState.activeMountId]),
      stateFingerprint: proofToken({
        commandLogEntry,
        epoch: persistedState.epoch,
        activeMountId: persistedState.activeMountId
      }),
      proof: proofToken(commandLogEntry)
    };
  }

  const journalEntry = persistedState.commandJournal.find((entry) =>
    entry.commandId === command.commandId || entry.idempotencyKey === command.idempotencyKey
  ) || null;
  if (journalEntry) {
    return {
      source: 'command_journal',
      commandId: journalEntry.commandId,
      idempotencyKey: journalEntry.idempotencyKey,
      status: journalEntry.status === 'blocked' ? 'blocked' : 'applied',
      epoch: journalEntry.epoch,
      activeMountId: journalEntry.activeMountId,
      restartLevel: journalEntry.restartLevel,
      restartSafe: journalEntry.restartSafe,
      stateFingerprint: proofToken({
        journalProof: journalEntry.proof,
        epoch: journalEntry.epoch,
        activeMountId: journalEntry.activeMountId
      }),
      proof: journalEntry.proof
    };
  }

  return null;
}

function buildCommandExecutionRecord({ command, persistedStatePatch, recovery, restartStatus, now, status }) {
  const mountIds = Object.keys(persistedStatePatch.mountsById).sort();
  const recoveredMountIds = Array.isArray(recovery.recoveredMountIds)
    ? [...recovery.recoveredMountIds].sort()
    : [];
  const tombstonedMountIds = Array.isArray(recovery.tombstonedMountIds)
    ? [...recovery.tombstonedMountIds].sort()
    : [];
  const stateFingerprint = proofToken({
    version: persistedStatePatch.version,
    epoch: persistedStatePatch.epoch,
    activeMountId: persistedStatePatch.activeMountId,
    mountIds,
    lifecycle: persistedStatePatch.lifecycle,
    commandType: command.type,
    status
  });
  const record = {
    schemaVersion: 1,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    commandType: command.type,
    status,
    epoch: persistedStatePatch.epoch,
    activeMountId: persistedStatePatch.activeMountId,
    restartLevel: restartStatus.level,
    restartSafe: restartStatus.stable === true && recovery.restartSafe === true,
    committedAt: now,
    mountIds,
    recoveredMountIds,
    tombstonedMountIds,
    stateFingerprint,
    replayable: true
  };

  return {
    ...record,
    proof: proofToken({
      ...record,
      recoveryStatus: recovery.status,
      recoveryReason: recovery.reason,
      restartReason: restartStatus.reason
    })
  };
}

function appendCommandExecution({ persistedState, persistedStatePatch, command, recovery, restartStatus, now, status }) {
  const executionRecord = buildCommandExecutionRecord({
    command,
    persistedStatePatch,
    recovery,
    restartStatus,
    now,
    status
  });
  const priorRecords = Array.isArray(persistedState.commandExecutions) ? persistedState.commandExecutions : [];
  const deduped = priorRecords.filter((entry) =>
    entry.commandId !== command.commandId && entry.idempotencyKey !== command.idempotencyKey
  );
  return [...deduped, executionRecord].slice(-MAX_COMMAND_EXECUTION_RECORDS);
}

function applyLifecycleCommand({ settings, command, now }) {
  const validationIssues = [...settings.validationIssues];
  const rejected = [];
  const decisions = [];
  const commandPatch = command.schedule && typeof command.schedule === 'object' ? command.schedule : {};
  const next = {
    ...settings,
    schedule: { ...settings.schedule },
    validationIssues: undefined
  };

  if (command.type === 'enable') {
    next.enabled = true;
    next.mode = next.mode === 'paused' ? 'manual' : next.mode;
    decisions.push('lifecycle_enabled');
  }

  if (command.type === 'disable') {
    next.enabled = false;
    next.schedule.enabled = false;
    decisions.push('lifecycle_disabled');
  }

  if (command.type === 'schedule') {
    const requestedMode = typeof commandPatch.mode === 'string' && ALLOWED_LIFECYCLE_MODES.has(commandPatch.mode)
      ? commandPatch.mode
      : 'automatic';
    const requestedScheduleEnabled = normalizeBoolean(commandPatch.enabled, requestedMode === 'automatic');
    const requestedRefreshOnResume = normalizeBoolean(commandPatch.refreshOnResume, next.refreshOnResume);
    const requestedRunPolicy = typeof commandPatch.runPolicy === 'string' && commandPatch.runPolicy.trim()
      ? commandPatch.runPolicy.trim()
      : (commandPatch.runImmediately === true ? 'run_now' : 'defer');
    const runPolicy = ALLOWED_SCHEDULE_RUN_POLICIES.has(requestedRunPolicy) ? requestedRunPolicy : 'defer';
    next.enabled = true;
    next.mode = requestedMode;
    next.refreshOnResume = requestedRefreshOnResume;
    next.schedule.enabled = requestedMode === 'automatic' && requestedScheduleEnabled;
    next.schedule.intervalMinutes = normalizeInteger(
      commandPatch.intervalMinutes,
      next.schedule.intervalMinutes,
      MIN_SCHEDULE_INTERVAL_MINUTES,
      MAX_SCHEDULE_INTERVAL_MINUTES
    );
    next.schedule.jitterSeconds = normalizeInteger(commandPatch.jitterSeconds, next.schedule.jitterSeconds, 0, MAX_SCHEDULE_JITTER_SECONDS);
    if (typeof commandPatch.mode === 'string' && commandPatch.mode.trim() && !ALLOWED_LIFECYCLE_MODES.has(commandPatch.mode)) {
      validationIssues.push({ field: 'command.schedule.mode', reason: 'unsupported_lifecycle_mode', value: commandPatch.mode, normalizedValue: requestedMode });
    }
    if (typeof commandPatch.runPolicy === 'string' && commandPatch.runPolicy.trim() && !ALLOWED_SCHEDULE_RUN_POLICIES.has(commandPatch.runPolicy)) {
      validationIssues.push({
        field: 'command.schedule.runPolicy',
        reason: 'unsupported_schedule_run_policy',
        value: commandPatch.runPolicy,
        normalizedValue: runPolicy
      });
    }
    if (Number.isFinite(commandPatch.intervalMinutes) && commandPatch.intervalMinutes !== next.schedule.intervalMinutes) {
      validationIssues.push({
        field: 'command.schedule.intervalMinutes',
        reason: 'schedule_interval_clamped',
        value: commandPatch.intervalMinutes,
        normalizedValue: next.schedule.intervalMinutes
      });
    }
    if (Number.isFinite(commandPatch.jitterSeconds) && commandPatch.jitterSeconds !== next.schedule.jitterSeconds) {
      validationIssues.push({
        field: 'command.schedule.jitterSeconds',
        reason: 'schedule_jitter_clamped',
        value: commandPatch.jitterSeconds,
        normalizedValue: next.schedule.jitterSeconds
      });
    }
    if (requestedScheduleEnabled && requestedMode !== 'automatic') {
      validationIssues.push({
        field: 'command.schedule.enabled',
        reason: 'schedule_requires_automatic_mode',
        value: requestedScheduleEnabled,
        normalizedValue: false
      });
    }
    if (typeof commandPatch.nextRunAt === 'string' && commandPatch.nextRunAt.trim()) {
      const requestedNextRunAt = normalizeIsoString(commandPatch.nextRunAt);
      if (requestedNextRunAt && isFutureIso(requestedNextRunAt, now)) {
        next.schedule.nextRunAt = requestedNextRunAt;
        decisions.push('schedule_next_run_accepted');
      } else {
        validationIssues.push({
          field: 'command.schedule.nextRunAt',
          reason: requestedNextRunAt ? 'schedule_next_run_must_be_future' : 'invalid_schedule_next_run_at',
          value: commandPatch.nextRunAt
        });
      }
    }
    if (runPolicy === 'run_now') {
      if (next.schedule.enabled) {
        next.schedule.nextRunAt = now;
        decisions.push('schedule_run_now_queued');
      } else {
        validationIssues.push({
          field: 'command.schedule.runPolicy',
          reason: 'run_now_requires_enabled_schedule',
          value: runPolicy,
          normalizedValue: 'defer'
        });
      }
    }
    if (runPolicy === 'skip_if_recent') {
      const minutesSinceLastRun = minutesSinceIso(next.schedule.lastRunAt, now);
      if (minutesSinceLastRun !== null && minutesSinceLastRun < next.schedule.intervalMinutes) {
        next.schedule.nextRunAt = addMinutesToIso(next.schedule.lastRunAt, next.schedule.intervalMinutes);
        decisions.push('schedule_recent_run_skipped');
      } else if (next.schedule.enabled) {
        next.schedule.nextRunAt = now;
        decisions.push('schedule_skip_window_elapsed');
      }
    }
    decisions.push(next.schedule.enabled ? 'schedule_enabled' : 'schedule_disabled');
  }

  if (!next.enabled && !['enable', 'disable', 'select'].includes(command.type)) {
    rejected.push({ commandId: command.commandId, type: command.type, reason: 'lifecycle_disabled' });
    decisions.push('command_blocked_by_disabled_lifecycle');
  }

  const nextRunAt = next.enabled && next.schedule.enabled
    ? (next.schedule.nextRunAt && isRunnableIso(next.schedule.nextRunAt, now)
        ? next.schedule.nextRunAt
        : addMinutesToIso(now, next.schedule.intervalMinutes))
    : null;

  return {
    settings: {
      enabled: next.enabled,
      mode: next.mode,
      refreshOnResume: next.refreshOnResume,
      schedule: {
        ...next.schedule,
        nextRunAt
      }
    },
    validationIssues,
    rejected,
    decisions
  };
}

function buildMountLifecycleActionState({ request, mount, lifecycle, principal, operationalHealth, command, now }) {
  const policy = mount.descriptor?.commandPolicy || buildDescriptorCommandContract(mount.kind);
  const supportedCommands = Array.isArray(policy.supportedCommands) ? policy.supportedCommands : [];
  const activeFailure = operationalHealth.providerHealth?.failures?.find((failure) =>
    failure.mountId === mount.id || failure.sourceKind === mount.sourceContract?.sourceKind
  ) || null;
  const sourceWritable = mount.writable && mount.sourceContract?.accessMode !== 'read';
  const scheduleReady = lifecycle.settings.enabled
    && lifecycle.settings.mode === 'automatic'
    && lifecycle.settings.schedule.enabled;
  const commandTypes = ['select', 'refresh', 'recover', 'detach', 'enable', 'disable', 'schedule'];
  const actions = commandTypes.map((commandType) => {
    const requiredPermission = COMMAND_PERMISSION[commandType] || 'memory:read';
    const supported = supportedCommands.includes(commandType);
    const permissionAllowed = principal.permissions.includes(requiredPermission);
    const writeCommand = HEALTH_WRITE_COMMANDS.has(commandType);
    const commandGuard = operationalHealth.mountCommandGuards
      ?.find((guard) => guard.mountId === mount.id)
      ?.commandStates
      ?.find((state) => state.commandType === commandType) || null;
    const sourceAllowsCommand = !writeCommand
      || commandType === 'enable'
      || commandType === 'disable'
      || commandType === 'schedule'
      || sourceWritable;
    const legacyHealthAllowsCommand = !activeFailure
      || activeFailure.status !== 'unavailable'
      || !writeCommand;
    const healthAllowsCommand = commandGuard ? commandGuard.allowed : legacyHealthAllowsCommand;
    const lifecycleAllowsCommand = lifecycle.settings.enabled
      || commandType === 'enable'
      || commandType === 'select';
    const scheduleAllowsCommand = commandType !== 'schedule'
      || lifecycle.settings.enabled;
    const disabledReasons = [
      ...(supported ? [] : ['descriptor_command_not_supported']),
      ...(permissionAllowed ? [] : ['missing_required_permission']),
      ...(sourceAllowsCommand ? [] : ['source_not_write_capable']),
      ...(healthAllowsCommand ? [] : (commandGuard?.blockedReasons || ['provider_source_unavailable'])),
      ...(lifecycleAllowsCommand ? [] : ['lifecycle_disabled']),
      ...(scheduleAllowsCommand ? [] : ['schedule_requires_enabled_lifecycle'])
    ];
    const enabled = disabledReasons.length === 0;
    const action = {
      commandType,
      enabled,
      route: `${request.route}/mounts/${mount.id}/commands/${commandType}`,
      requiredPermission,
      descriptorSupported: supported,
      descriptorKind: mount.descriptor?.kind || mount.kind,
      sourceKind: mount.sourceContract?.sourceKind || null,
      sourceAccessMode: mount.sourceContract?.accessMode || null,
      providerFailureId: activeFailure?.failureId || null,
      healthGuard: commandGuard
        ? {
            mode: commandGuard.mode,
            retryable: commandGuard.retryable,
            retryAfter: commandGuard.retryAfter,
            operatorAction: commandGuard.operatorAction,
            proof: commandGuard.proof
          }
        : null,
      disabledReasons,
      command: {
        type: commandType,
        mountId: mount.id,
        ...(commandType === 'schedule'
          ? {
              schedule: {
                mode: 'automatic',
                enabled: true,
                intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
                jitterSeconds: lifecycle.settings.schedule.jitterSeconds,
                runPolicy: scheduleReady ? 'skip_if_recent' : 'defer'
              }
            }
          : {})
      }
    };
    return {
      ...action,
      proof: proofToken({
        mountId: mount.id,
        commandType,
        enabled,
        requiredPermission,
        disabledReasons,
        descriptorPolicyProof: policy.proof || null,
        sourceProof: mount.sourceContract?.proof || null,
        providerFailureId: activeFailure?.failureId || null,
        healthGuardProof: commandGuard?.proof || null
      })
    };
  });
  const firstEnabledAction = actions.find((action) => action.enabled && action.commandType === command.type)
    || actions.find((action) => action.enabled && action.commandType === 'refresh')
    || actions.find((action) => action.enabled && action.commandType === 'select')
    || actions.find((action) => action.enabled)
    || null;
  const state = {
    mountId: mount.id,
    kind: mount.kind,
    descriptorKind: mount.descriptor?.kind || mount.kind,
    selected: Boolean(mount.selected || command.mountId === mount.id),
    lifecycleReady: lifecycle.settings.enabled,
    scheduleReady,
    sourceWritable,
    providerStatus: activeFailure?.status || operationalHealth.providerHealth?.status || 'healthy',
    providerFailureId: activeFailure?.failureId || null,
    recommendedCommand: firstEnabledAction?.commandType || 'repair',
    blockedCommandCount: actions.filter((action) => !action.enabled).length,
    enabledCommandCount: actions.filter((action) => action.enabled).length,
    actions,
    computedAt: now
  };

  return {
    ...state,
    proof: proofToken({
      mountId: mount.id,
      lifecycleReady: state.lifecycleReady,
      scheduleReady,
      sourceWritable,
      providerStatus: state.providerStatus,
      recommendedCommand: state.recommendedCommand,
      actionProofs: actions.map((action) => action.proof)
    })
  };
}

function buildLifecycleControlState({ request, command, lifecycle, principal, mounts, operationalHealth, now }) {
  const activeMount = mounts.accepted.find((mount) => mount.selected) || mounts.accepted[0] || null;
  const writeAllowed = principal.canWrite && !mounts.blocked;
  const scheduleEligible = writeAllowed && lifecycle.settings.enabled && lifecycle.settings.mode === 'automatic';
  const lastRunMinutesAgo = minutesSinceIso(lifecycle.settings.schedule.lastRunAt, now);
  const nextRunDue = lifecycle.settings.schedule.enabled
    && lifecycle.settings.schedule.nextRunAt
    && isRunnableIso(lifecycle.settings.schedule.nextRunAt, now)
    && !isFutureIso(lifecycle.settings.schedule.nextRunAt, now);
  const runNowAllowed = scheduleEligible
    && lifecycle.settings.schedule.enabled
    && operationalHealth.status !== 'blocked';
  const disabledReason = principal.canWrite
    ? (mounts.blocked ? 'mount_command_blocked' : null)
    : 'missing_memory_write_permission';
  const nextRecommendedCommand = !lifecycle.settings.enabled
    ? 'enable'
    : (nextRunDue
        ? 'refresh'
        : (!lifecycle.settings.schedule.enabled && lifecycle.settings.mode === 'automatic' ? 'schedule' : command.type));
  const mountActionStates = mounts.accepted.map((mount) => buildMountLifecycleActionState({
    request,
    mount,
    lifecycle,
    principal,
    operationalHealth,
    command,
    now
  }));
  const targetActionState = command.mountId
    ? mountActionStates.find((state) => state.mountId === command.mountId) || null
    : (mountActionStates.find((state) => state.selected) || mountActionStates[0] || null);
  const presetControls = SCHEDULE_PRESETS.map((preset) => ({
    control: `schedule_preset_${preset.key}`,
    enabled: scheduleEligible,
    route: `${request.route}/settings/lifecycle/schedule`,
    command: {
      type: 'schedule',
      schedule: {
        mode: 'automatic',
        enabled: true,
        intervalMinutes: preset.intervalMinutes,
        jitterSeconds: preset.jitterSeconds,
        runPolicy: 'defer'
      }
    },
    label: preset.label,
    disabledReason: scheduleEligible ? null : (disabledReason || 'automatic_mode_required')
  }));

  const controls = [
    {
      control: 'enable',
      enabled: principal.canWrite && !lifecycle.settings.enabled,
      route: `${request.route}/settings/lifecycle/enable`,
      command: { type: 'enable', mountId: command.mountId || activeMount?.id || null },
      disabledReason: principal.canWrite ? (lifecycle.settings.enabled ? 'already_enabled' : null) : 'missing_memory_write_permission'
    },
    {
      control: 'disable',
      enabled: writeAllowed && lifecycle.settings.enabled,
      route: `${request.route}/settings/lifecycle/disable`,
      command: { type: 'disable', mountId: command.mountId || activeMount?.id || null },
      disabledReason: lifecycle.settings.enabled ? disabledReason : 'already_disabled'
    },
    {
      control: 'pause_schedule',
      enabled: writeAllowed && lifecycle.settings.schedule.enabled,
      route: `${request.route}/settings/lifecycle/schedule`,
      command: { type: 'schedule', schedule: { mode: 'automatic', enabled: false } },
      disabledReason: lifecycle.settings.schedule.enabled ? disabledReason : 'schedule_not_enabled'
    },
    {
      control: 'resume_schedule',
      enabled: scheduleEligible && !lifecycle.settings.schedule.enabled,
      route: `${request.route}/settings/lifecycle/schedule`,
      command: {
        type: 'schedule',
        schedule: {
          mode: 'automatic',
          enabled: true,
          intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
          jitterSeconds: lifecycle.settings.schedule.jitterSeconds
        }
      },
      disabledReason: scheduleEligible ? (lifecycle.settings.schedule.enabled ? 'schedule_already_enabled' : null) : (disabledReason || 'automatic_mode_required')
    },
    {
      control: 'run_schedule_now',
      enabled: runNowAllowed,
      route: `${request.route}/settings/lifecycle/schedule`,
      command: {
        type: 'schedule',
        schedule: {
          mode: 'automatic',
          enabled: true,
          intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
          jitterSeconds: lifecycle.settings.schedule.jitterSeconds,
          runPolicy: 'run_now'
        }
      },
      disabledReason: runNowAllowed
        ? null
        : (lifecycle.settings.schedule.enabled ? (disabledReason || 'health_blocked') : 'schedule_not_enabled')
    },
    {
      control: 'skip_recent_run',
      enabled: runNowAllowed && lifecycle.settings.schedule.lastRunAt !== null,
      route: `${request.route}/settings/lifecycle/schedule`,
      command: {
        type: 'schedule',
        schedule: {
          mode: 'automatic',
          enabled: true,
          intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
          jitterSeconds: lifecycle.settings.schedule.jitterSeconds,
          runPolicy: 'skip_if_recent'
        }
      },
      disabledReason: lifecycle.settings.schedule.lastRunAt ? (runNowAllowed ? null : (disabledReason || 'health_blocked')) : 'schedule_never_ran'
    },
    {
      control: 'manual_mode',
      enabled: writeAllowed && lifecycle.settings.mode !== 'manual',
      route: `${request.route}/settings/lifecycle/schedule`,
      command: { type: 'schedule', schedule: { mode: 'manual', enabled: false, runPolicy: 'defer' } },
      disabledReason: lifecycle.settings.mode === 'manual' ? 'already_manual' : disabledReason
    },
    {
      control: 'automatic_mode',
      enabled: writeAllowed && lifecycle.settings.mode !== 'automatic',
      route: `${request.route}/settings/lifecycle/schedule`,
      command: {
        type: 'schedule',
        schedule: {
          mode: 'automatic',
          enabled: true,
          intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
          jitterSeconds: lifecycle.settings.schedule.jitterSeconds,
          runPolicy: 'defer'
        }
      },
      disabledReason: lifecycle.settings.mode === 'automatic' ? 'already_automatic' : disabledReason
    },
    ...presetControls
  ].map((control) => ({
    ...control,
    proof: proofToken({
      control: control.control,
      enabled: control.enabled,
      route: control.route,
      command: control.command,
      label: control.label,
      disabledReason: control.disabledReason
    })
  }));

  return {
    schemaVersion: 1,
    route: `${request.route}/settings/lifecycle`,
    status: operationalHealth.status === 'blocked'
      ? 'blocked'
      : (lifecycle.settings.enabled ? (lifecycle.settings.schedule.enabled ? 'scheduled' : 'enabled_manual') : 'disabled'),
    activeMountId: activeMount?.id || null,
    nextRecommendedCommand,
    targetActionState,
    mountActionStates,
    commandMatrix: {
      totalMounts: mountActionStates.length,
      enabledMounts: mountActionStates.filter((state) => state.enabledCommandCount > 0).length,
      blockedMounts: mountActionStates.filter((state) => state.enabledCommandCount === 0).length,
      scheduleReadyMounts: mountActionStates.filter((state) => state.scheduleReady).length,
      providerBlockedMounts: mountActionStates.filter((state) => state.providerStatus === 'unavailable').length,
      recommendedCommands: countBy(mountActionStates, (state) => state.recommendedCommand),
      proof: proofToken({
        mountActionProofs: mountActionStates.map((state) => state.proof)
      })
    },
    scheduleWindow: {
      enabled: lifecycle.settings.schedule.enabled,
      intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
      jitterSeconds: lifecycle.settings.schedule.jitterSeconds,
      lastRunAt: lifecycle.settings.schedule.lastRunAt,
      nextRunAt: lifecycle.settings.schedule.nextRunAt,
      lastRunMinutesAgo,
      dueNow: Boolean(nextRunDue),
      runNowAllowed,
      computedAt: now
    },
    controls,
    proof: proofToken({
      route: request.route,
      commandId: command.commandId,
      lifecycle: lifecycle.settings,
      activeMountId: activeMount?.id || null,
      controlProofs: controls.map((control) => control.proof),
      mountActionProofs: mountActionStates.map((state) => state.proof),
      healthStatus: operationalHealth.status
    })
  };
}

function normalizeMounts(input, clientState, now) {
  const sourceMounts = Array.isArray(input.mounts) ? input.mounts : [];
  const seen = new Set();
  const rejected = [];
  const accepted = [];

  for (const [index, rawMount] of sourceMounts.entries()) {
    const mount = rawMount && typeof rawMount === 'object' ? rawMount : {};
    const id = typeof mount.id === 'string' && mount.id.trim() ? mount.id.trim() : '';
    const kindContract = normalizeMountKindContract(mount.kind, id, `mounts.${index}.kind`);
    const requestedKind = kindContract.requestedKind;
    const kind = kindContract.canonicalKind;
    const scope = typeof mount.scope === 'string' && mount.scope.trim() ? mount.scope.trim() : clientState.sessionId;
    const tenantId = normalizeNonEmptyString(mount.tenantId, clientState.tenantId);
    const workspaceId = normalizeNonEmptyString(mount.workspaceId, clientState.workspaceId);
    const priority = Number.isFinite(mount.priority) ? Math.max(0, Math.min(100, Math.round(mount.priority))) : 50;

    if (!id) {
      rejected.push({ index, reason: 'missing_mount_id' });
      continue;
    }
    if (seen.has(id)) {
      rejected.push({ id, index, reason: 'duplicate_mount_id' });
      continue;
    }
    if (!kindContract.accepted) {
      rejected.push({
        id,
        index,
        reason: kindContract.issues[0]?.reason || 'unsupported_mount_kind',
        kind: requestedKind,
        normalizedKind: kindContract.descriptorAvailable ? kind : null,
        kindContract
      });
      continue;
    }

    const source = normalizeMountSourceContract(mount, { kind, requestedKind, id, scope, clientState, now });
    seen.add(id);
    accepted.push({
      id,
      kind,
      requestedKind,
      kindContract,
      scope,
      tenantId,
      workspaceId,
      priority,
      writable: mount.writable === true,
      selected: clientState.selectedMountId === id,
      descriptor: source.descriptor,
      sourceContract: source.contract,
      mailchimpSync: normalizeMailchimpMountContext(mount.mailchimpSync ?? mount.mailchimp),
      sourceValidationIssues: source.issues,
      evidence: [
        ...normalizeStringList(mount.evidence),
        `kind:${id}:${source.contract.kindContract.status}:${source.contract.kindContract.proof}`,
        `descriptor:${id}:${source.descriptor.kind}:${source.descriptor.proof}`,
        `descriptor-source-binding:${id}:${source.contract.descriptorSourceBinding.status}:${source.contract.descriptorSourceBinding.proof}`,
        `source:${id}:${source.contract.sourceKind}:${source.contract.proof}`
      ]
    });
  }

  accepted.sort((left, right) => Number(right.selected) - Number(left.selected) || right.priority - left.priority || left.id.localeCompare(right.id));
  return { accepted, rejected };
}

function recoverMountsFromPersistedState(persistedState, clientState, now) {
  const accepted = [];
  const rejected = [];

  for (const [id, rawMount] of Object.entries(persistedState.mountsById)) {
    const mount = rawMount && typeof rawMount === 'object' ? rawMount : {};
    const trimmedId = id.trim();
    const kindContract = normalizeMountKindContract(mount.kind, trimmedId, `persistedState.mountsById.${trimmedId || id}.kind`);
    const requestedKind = kindContract.requestedKind;
    const kind = kindContract.accepted ? kindContract.canonicalKind : null;
    const scope = typeof mount.scope === 'string' && mount.scope.trim() ? mount.scope.trim() : clientState.sessionId;
    const tenantId = normalizeNonEmptyString(mount.tenantId, clientState.tenantId);
    const workspaceId = normalizeNonEmptyString(mount.workspaceId, clientState.workspaceId);
    const priority = Number.isFinite(mount.priority) ? Math.max(0, Math.min(100, Math.round(mount.priority))) : 50;

    if (!trimmedId) {
      rejected.push({ id, reason: 'persisted_mount_id_empty' });
      continue;
    }
    if (!kind) {
      rejected.push({
        id: trimmedId,
        reason: kindContract.issues[0]?.reason || 'persisted_mount_kind_invalid',
        kind: mount.kind,
        normalizedKind: kindContract.descriptorAvailable ? kindContract.canonicalKind : null,
        kindContract
      });
      continue;
    }

    const source = normalizeMountSourceContract(mount, { kind, requestedKind, id: trimmedId, scope, clientState, now });
    const persistedSource = mount.sourceContract && typeof mount.sourceContract === 'object'
      ? mount.sourceContract
      : {};
    const persistedDescriptor = mount.descriptor && typeof mount.descriptor === 'object'
      ? mount.descriptor
      : {};
    const persistedSourceKind = ALLOWED_SOURCE_KINDS.has(persistedSource.sourceKind)
      ? persistedSource.sourceKind
      : null;
    const persistedRetention = persistedSource.retention && typeof persistedSource.retention === 'object'
      ? persistedSource.retention
      : {};
    const retainedPolicy = normalizeNonEmptyString(
      persistedRetention.policy,
      source.contract.retention.policy
    );
    const retainedTtlMinutes = normalizeInteger(
      persistedRetention.ttlMinutes,
      source.contract.retention.ttlMinutes,
      5,
      525600
    );
    const retentionChanged = retainedPolicy !== source.contract.retention.policy
      || retainedTtlMinutes !== source.contract.retention.ttlMinutes;
    const retainedScopeContract = parseMemoryMountScope(
      persistedSource.canonicalScope ?? persistedSource.scope ?? scope,
      {
        descriptorScopeKind: source.descriptor.defaultScopeKind,
        fallbackScope: scope,
        clientState
      }
    );
    const persistedSourceKindNormalized = persistedSourceKind !== null && persistedSourceKind !== source.contract.sourceKind;
    const descriptorSourceBinding = persistedSourceKindNormalized
      ? {
          ...source.contract.descriptorSourceBinding,
          requestedSourceKind: persistedSourceKind,
          sourceNormalized: true,
          status: 'normalized',
          proof: proofToken({
            bindingProof: source.contract.descriptorSourceBinding?.proof || null,
            persistedSourceKind,
            normalizedValue: source.contract.sourceKind
          })
        }
      : source.contract.descriptorSourceBinding;
    const persistedSourceIssues = persistedSourceKindNormalized
      ? [{
          field: `persistedState.mountsById.${trimmedId}.sourceContract.sourceKind`,
          reason: 'descriptor_source_kind_normalized',
          value: persistedSourceKind,
          normalizedValue: source.contract.sourceKind,
          expectedSourceKind: source.contract.sourceKind,
          descriptorKind: kind
        }]
      : [];
    if (retentionChanged) {
      persistedSourceIssues.push({
        field: `persistedState.mountsById.${trimmedId}.sourceContract.retention`,
        reason: 'persisted_retention_contract_repaired',
        value: persistedRetention,
        normalizedValue: source.contract.retention,
        descriptorKind: kind
      });
    }
    persistedSourceIssues.push(...retainedScopeContract.issues.map((issue) => ({
      ...issue,
      field: `persistedState.mountsById.${trimmedId}.sourceContract.${issue.field}`
    })));
    const persistedSourceFreshness = evaluateSourceClockBoundary(
      persistedSource,
      mount,
      source.contract.retention,
      now,
      trimmedId
    );
    persistedSourceIssues.push(...persistedSourceFreshness.violations.map((violation) => ({
      field: `persistedState.mountsById.${trimmedId}.sourceContract.observedAt`,
      reason: violation,
      value: persistedSource.observedAt ?? persistedSource.checkedAt ?? persistedSource.syncedAt ?? mount.observedAt ?? mount.lastSyncedAt ?? null,
      normalizedValue: persistedSourceFreshness.observedAt,
      status: persistedSourceFreshness.status,
      staleAfterAt: persistedSourceFreshness.staleAfterAt
    })));
    const descriptor = {
      ...source.descriptor,
      descriptorId: normalizeNonEmptyString(persistedDescriptor.descriptorId, source.descriptor.descriptorId),
      label: normalizeNonEmptyString(persistedDescriptor.label, source.descriptor.label),
      summary: normalizeNonEmptyString(persistedDescriptor.summary, source.descriptor.summary),
      proof: proofToken({
        id: trimmedId,
        kind,
        persistedDescriptor,
        fallbackProof: source.descriptor.proof
      })
    };
    const sourceContract = {
      ...source.contract,
      sourceKind: persistedSourceKind === source.contract.sourceKind ? persistedSourceKind : source.contract.sourceKind,
      uri: normalizeNonEmptyString(persistedSource.uri, source.contract.uri),
      accessMode: ALLOWED_ACCESS_MODES.has(persistedSource.accessMode) ? persistedSource.accessMode : source.contract.accessMode,
      sourceEpoch: normalizeInteger(persistedSource.sourceEpoch, source.contract.sourceEpoch, 0, Number.MAX_SAFE_INTEGER),
      checksum: typeof persistedSource.checksum === 'string' && persistedSource.checksum.trim() ? persistedSource.checksum.trim() : source.contract.checksum,
      canonicalScope: retainedScopeContract.canonicalScope,
      scopeContract: retainedScopeContract,
      retention: {
        ...source.contract.retention,
        policy: source.contract.retention.policy,
        ttlMinutes: source.contract.retention.ttlMinutes,
        requestedPolicy: retainedPolicy,
        proof: proofToken({
          id: trimmedId,
          kind,
          retainedPolicy,
          retainedTtlMinutes,
          normalizedPolicy: source.contract.retention.policy,
          normalizedTtlMinutes: source.contract.retention.ttlMinutes
        })
      },
      sourceFreshness: persistedSourceFreshness,
      descriptorSourceBinding,
      descriptorKind: descriptor.kind,
      descriptorProof: descriptor.proof,
      proof: proofToken({
        id: trimmedId,
        kind,
        persistedSourceKind: persistedSource.sourceKind,
        persistedUri: persistedSource.uri,
        persistedAccessMode: persistedSource.accessMode,
        persistedEpoch: persistedSource.sourceEpoch,
        retainedScopeProof: retainedScopeContract.proof,
        retentionProof: source.contract.retention.proof,
        sourceFreshnessProof: persistedSourceFreshness.proof,
        descriptorSourceBindingProof: descriptorSourceBinding?.proof || null,
        descriptorProof: descriptor.proof,
        fallbackProof: source.contract.proof
      })
    };
    accepted.push({
      id: trimmedId,
      kind,
      requestedKind,
      kindContract,
      scope,
      tenantId,
      workspaceId,
      priority,
      writable: mount.writable === true,
      selected: clientState.selectedMountId === trimmedId || persistedState.activeMountId === trimmedId,
      descriptor,
      sourceContract,
      sourceValidationIssues: [...source.issues, ...persistedSourceIssues],
      evidence: [
        `persisted:${persistedState.epoch}:${trimmedId}`,
        `kind:${trimmedId}:${sourceContract.kindContract.status}:${sourceContract.kindContract.proof}`,
        `descriptor:${trimmedId}:${descriptor.kind}:${descriptor.proof}`,
        `descriptor-source-binding:${trimmedId}:${descriptorSourceBinding.status}:${descriptorSourceBinding.proof}`,
        `source:${trimmedId}:${sourceContract.sourceKind}:${sourceContract.proof}`
      ]
    });
  }

  accepted.sort((left, right) => Number(right.selected) - Number(left.selected) || right.priority - left.priority || left.id.localeCompare(right.id));
  return { accepted, rejected };
}

function classifyWorkspaceScope({ mount, principal, clientState }) {
  const parsedScope = mount.sourceContract?.scopeContract && typeof mount.sourceContract.scopeContract === 'object'
    ? mount.sourceContract.scopeContract
    : parseMemoryMountScope(mount.scope, {
        descriptorScopeKind: mount.descriptor?.scopeKind || mount.descriptor?.defaultScopeKind || mount.kind,
        fallbackScope: clientState.sessionId,
        clientState
      });
  const rawScope = normalizeNonEmptyString(parsedScope.rawScope, mount.scope || clientState.sessionId);
  const scopeKind = DESCRIPTOR_SCOPE_KINDS.has(parsedScope.scopeKind)
    ? parsedScope.scopeKind
    : 'session';
  const normalizedValue = normalizeNonEmptyString(parsedScope.scopeValue, clientState.sessionId);
  const scopeEnforced = normalizeBoolean(parsedScope.scopeEnforced, false);
  const violations = [];

  if (mount.tenantId !== principal.tenantId && !principal.canCrossTenant) {
    violations.push({
      reason: 'tenant_boundary_violation',
      mountTenantId: mount.tenantId,
      principalTenantId: principal.tenantId
    });
  }

  if (mount.workspaceId !== principal.workspaceId && mount.kind !== 'volatile') {
    violations.push({
      reason: 'workspace_boundary_violation',
      mountWorkspaceId: mount.workspaceId,
      principalWorkspaceId: principal.workspaceId
    });
  }

  if (scopeEnforced && scopeKind === 'tenant' && normalizedValue !== principal.tenantId && !principal.canCrossTenant) {
    violations.push({
      reason: 'scope_tenant_mismatch',
      scopeTenantId: normalizedValue,
      principalTenantId: principal.tenantId
    });
  }

  if (scopeEnforced && scopeKind === 'workspace' && normalizedValue !== principal.workspaceId) {
    violations.push({
      reason: 'scope_workspace_mismatch',
      scopeWorkspaceId: normalizedValue,
      principalWorkspaceId: principal.workspaceId
    });
  }

  if (scopeEnforced && scopeKind === 'session' && normalizedValue !== clientState.sessionId) {
    violations.push({
      reason: 'scope_session_mismatch',
      scopeSessionId: normalizedValue,
      clientSessionId: clientState.sessionId
    });
  }

  if (scopeEnforced && scopeKind === 'thread' && clientState.activeThreadId && normalizedValue !== clientState.activeThreadId) {
    violations.push({
      reason: 'scope_thread_mismatch',
      scopeThreadId: normalizedValue,
      activeThreadId: clientState.activeThreadId
    });
  }

  return {
    scope: rawScope,
    scopeKind,
    scopeValue: normalizedValue,
    scopeEnforced,
    tenantId: mount.tenantId,
    workspaceId: mount.workspaceId,
    principalTenantId: principal.tenantId,
    principalWorkspaceId: principal.workspaceId,
    clientSessionId: clientState.sessionId,
    activeThreadId: clientState.activeThreadId,
    canonicalScope: parsedScope.canonicalScope || normalizedValue,
    isolation: mount.kind === 'volatile' ? 'session' : (principal.canCrossTenant ? 'cross_tenant_authorized' : 'tenant_workspace'),
    violations,
    proof: proofToken({
      mountId: mount.id,
      rawScope,
      scopeKind,
      normalizedValue,
      scopeEnforced,
      canonicalScope: parsedScope.canonicalScope || normalizedValue,
      tenantId: mount.tenantId,
      workspaceId: mount.workspaceId,
      principalTenantId: principal.tenantId,
      principalWorkspaceId: principal.workspaceId,
      clientSessionId: clientState.sessionId,
      activeThreadId: clientState.activeThreadId,
      violations
    })
  };
}

function parseHostedMemoryUri(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    return { hosted: false, valid: false, reason: 'source_uri_absent' };
  }

  const trimmed = uri.trim();
  const match = /^aios:\/\/memory\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(trimmed);
  if (!match) {
    return { hosted: false, valid: true, reason: 'external_source_uri' };
  }

  const [, tenantId, workspaceId, sourceKind, sourcePath] = match;
  return {
    hosted: true,
    valid: Boolean(tenantId && workspaceId && sourceKind && sourcePath),
    tenantId,
    workspaceId,
    sourceKind,
    sourcePath,
    reason: tenantId && workspaceId && sourceKind && sourcePath ? 'hosted_source_uri' : 'malformed_hosted_source_uri'
  };
}

function classifyVolatileSessionBoundary({ mount, sourceContract, parsedUri, clientState }) {
  if (mount.kind !== 'volatile') {
    return {
      schemaVersion: 1,
      enforced: false,
      violations: [],
      proof: proofToken({ mountId: mount.id, enforced: false })
    };
  }

  const scopeContract = sourceContract.scopeContract && typeof sourceContract.scopeContract === 'object'
    ? sourceContract.scopeContract
    : {};
  const scopeKind = DESCRIPTOR_SCOPE_KINDS.has(scopeContract.scopeKind)
    ? scopeContract.scopeKind
    : 'session';
  const scopeValue = normalizeNonEmptyString(scopeContract.scopeValue, mount.scope || clientState.sessionId);
  const expectedSourceKind = MEMORY_MOUNT_DESCRIPTORS.volatile.sourceKind;
  const violations = [];

  if (scopeKind !== 'session') {
    violations.push({
      reason: 'volatile_scope_must_be_session',
      scopeKind,
      normalizedValue: 'session'
    });
  }

  if (scopeValue !== clientState.sessionId) {
    violations.push({
      reason: 'volatile_session_scope_mismatch',
      scopeSessionId: scopeValue,
      clientSessionId: clientState.sessionId
    });
  }

  if (mount.tenantId !== clientState.tenantId) {
    violations.push({
      reason: 'volatile_tenant_boundary_mismatch',
      mountTenantId: mount.tenantId,
      clientTenantId: clientState.tenantId
    });
  }

  if (mount.workspaceId !== clientState.workspaceId) {
    violations.push({
      reason: 'volatile_workspace_boundary_mismatch',
      mountWorkspaceId: mount.workspaceId,
      clientWorkspaceId: clientState.workspaceId
    });
  }

  if (!parsedUri.hosted) {
    violations.push({
      reason: 'volatile_external_source_not_allowed',
      sourceUri: sourceContract.uri
    });
  }

  if (parsedUri.hosted && parsedUri.sourceKind !== expectedSourceKind) {
    violations.push({
      reason: 'volatile_source_kind_must_be_ephemeral_buffer',
      sourceUriKind: parsedUri.sourceKind,
      normalizedValue: expectedSourceKind
    });
  }

  if (parsedUri.hosted && parsedUri.sourcePath !== mount.id) {
    violations.push({
      reason: 'volatile_source_path_must_match_mount_id',
      sourcePath: parsedUri.sourcePath,
      mountId: mount.id
    });
  }

  return {
    schemaVersion: 1,
    enforced: true,
    expectedScopeKind: 'session',
    expectedSessionId: clientState.sessionId,
    expectedSourceKind,
    scopeKind,
    scopeValue,
    sourcePath: parsedUri.sourcePath || null,
    violations,
    proof: proofToken({
      mountId: mount.id,
      expectedScopeKind: 'session',
      expectedSessionId: clientState.sessionId,
      expectedSourceKind,
      scopeKind,
      scopeValue,
      sourceUri: sourceContract.uri,
      parsedUri,
      violations
    })
  };
}

function buildBoundaryAuditHandoff({ command, principal, clientState, accepted, rejected }) {
  const rejectedScopes = rejected
    .filter((entry) =>
      (entry.reason && String(entry.reason).includes('boundary'))
      || String(entry.reason || '').includes('scope_')
      || String(entry.reason || '').includes('source_boundary_')
      || String(entry.reason || '').startsWith('volatile_')
      || entry.reason === 'descriptor_command_not_supported'
      || entry.reason === 'command_target_not_visible'
    )
    .slice(-MAX_BOUNDARY_AUDIT_REJECTIONS);
  const acceptedScopeProofs = accepted.map((mount) => mount.boundary?.proof).filter(Boolean);
  const rejectedScopeProofs = rejectedScopes
    .map((entry) => entry.boundaryProof || entry.sourceBoundaryProof || entry.descriptorCommandBoundaryProof)
    .filter(Boolean);
  const crossTenantAcceptedMountIds = accepted
    .filter((mount) => mount.boundary?.isolation === 'cross_tenant_authorized')
    .map((mount) => mount.id);
  const volatileAcceptedMountIds = accepted
    .filter((mount) => mount.kind === 'volatile')
    .map((mount) => mount.id);
  const volatileRejectedMountIds = rejectedScopes
    .filter((entry) => String(entry.reason || '').startsWith('volatile_'))
    .map((entry) => entry.id || entry.mountId || null)
    .filter(Boolean);
  const envelope = {
    schemaVersion: 1,
    route: '/kernel/memory-manager/memory-mount/boundary/audit',
    commandId: command.commandId,
    commandType: command.type,
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    clientSessionId: clientState.sessionId,
    activeThreadId: clientState.activeThreadId,
    acceptedCount: accepted.length,
    rejectedCount: rejectedScopes.length,
    crossTenantAcceptedMountIds,
    volatileAcceptedMountIds,
    volatileRejectedMountIds,
    acceptedScopeProofs,
    rejectedScopeProofs,
    handoffRequired: rejectedScopes.length > 0 || crossTenantAcceptedMountIds.length > 0,
    requiredRole: rejectedScopes.length || crossTenantAcceptedMountIds.length ? 'memory_auditor' : null,
    retention: rejectedScopes.length ? 'persist_until_reviewed' : 'ephemeral',
    status: rejectedScopes.length
      ? 'review_required'
      : (crossTenantAcceptedMountIds.length ? 'cross_tenant_review' : 'clear')
  };

  return {
    ...envelope,
    proof: proofToken(envelope)
  };
}

function classifySourceBoundary({ mount, command, principal, clientState }) {
  const sourceContract = mount.sourceContract || {};
  const parsedUri = parseHostedMemoryUri(sourceContract.uri);
  const violations = [];
  const requiredWrite = ['attach', 'recover'].includes(command.type);
  const volatileBoundary = classifyVolatileSessionBoundary({ mount, sourceContract, parsedUri, clientState });

  if (parsedUri.hosted && !parsedUri.valid) {
    violations.push({
      reason: 'source_boundary_malformed_hosted_uri',
      sourceUri: sourceContract.uri
    });
  }

  if (parsedUri.hosted && parsedUri.tenantId !== mount.tenantId) {
    violations.push({
      reason: 'source_boundary_tenant_uri_mismatch',
      sourceTenantId: parsedUri.tenantId,
      mountTenantId: mount.tenantId
    });
  }

  if (parsedUri.hosted && parsedUri.workspaceId !== mount.workspaceId) {
    violations.push({
      reason: 'source_boundary_workspace_uri_mismatch',
      sourceWorkspaceId: parsedUri.workspaceId,
      mountWorkspaceId: mount.workspaceId
    });
  }

  if (parsedUri.hosted && parsedUri.sourceKind !== sourceContract.sourceKind) {
    violations.push({
      reason: 'source_boundary_kind_uri_mismatch',
      sourceUriKind: parsedUri.sourceKind,
      contractSourceKind: sourceContract.sourceKind
    });
  }

  if (requiredWrite && mount.writable && sourceContract.accessMode === 'read') {
    violations.push({
      reason: 'source_boundary_write_requested_on_read_source',
      commandType: command.type,
      accessMode: sourceContract.accessMode
    });
  }

  violations.push(...volatileBoundary.violations);

  const writeClass = mount.writable && principal.canWrite && sourceContract.accessMode !== 'read'
    ? 'write_capable'
    : 'read_scoped';

  return {
    schemaVersion: 1,
    sourceUri: sourceContract.uri,
    hostedKernelSource: parsedUri.hosted,
    uriValid: parsedUri.valid,
    uriTenantId: parsedUri.tenantId || null,
    uriWorkspaceId: parsedUri.workspaceId || null,
    uriSourceKind: parsedUri.sourceKind || null,
    expectedTenantId: mount.tenantId,
    expectedWorkspaceId: mount.workspaceId,
    expectedSourceKind: sourceContract.sourceKind,
    commandRequiresWrite: requiredWrite,
    writeClass,
    volatileSessionBoundary: volatileBoundary,
    violations,
    proof: proofToken({
      mountId: mount.id,
      commandId: command.commandId,
      commandType: command.type,
      principalId: principal.principalId,
      sourceUri: sourceContract.uri,
      parsedUri,
      expectedTenantId: mount.tenantId,
      expectedWorkspaceId: mount.workspaceId,
      expectedSourceKind: sourceContract.sourceKind,
      accessMode: sourceContract.accessMode,
      mountWritable: mount.writable,
      writeClass,
      volatileBoundaryProof: volatileBoundary.proof,
      violations
    })
  };
}

function shouldRecoverFromPersistedState({ requestedMounts, persistedState, command, clientRuntime }) {
  if (requestedMounts.accepted.length > 0) {
    return { recover: false, reason: 'request_mounts_present' };
  }
  if (!Object.keys(persistedState.mountsById).length) {
    return { recover: false, reason: 'persisted_mounts_absent' };
  }
  if (command.type === 'recover') {
    return { recover: true, reason: 'explicit_recover_command' };
  }
  if (RESTART_RECOVERY_COMMANDS.has(command.type) && clientRuntime.lastKnownEpoch < persistedState.epoch) {
    return { recover: true, reason: 'client_epoch_behind_persisted_state' };
  }
  if (command.type === 'select' && command.mountId && persistedState.mountsById[command.mountId]) {
    return { recover: true, reason: 'selected_mount_in_persisted_state' };
  }
  return { recover: false, reason: 'command_not_recoverable_from_persisted_state' };
}

function buildPersistedStateContract({ persistedStatePatch, recovery, command }) {
  const mountIds = Object.keys(persistedStatePatch.mountsById).sort();
  const commandJournal = Array.isArray(persistedStatePatch.commandJournal) ? persistedStatePatch.commandJournal : [];
  const commandExecutions = Array.isArray(persistedStatePatch.commandExecutions) ? persistedStatePatch.commandExecutions : [];
  const latestJournalEntry = commandJournal[commandJournal.length - 1] || null;
  const latestExecution = commandExecutions[commandExecutions.length - 1] || null;
  const sourceContracts = mountIds.map((mountId) => {
    const mount = persistedStatePatch.mountsById[mountId] || {};
    const sourceContract = mount.sourceContract && typeof mount.sourceContract === 'object'
      ? mount.sourceContract
      : {};
    const descriptor = mount.descriptor && typeof mount.descriptor === 'object'
      ? mount.descriptor
      : {};
    const kindContract = sourceContract.kindContract && typeof sourceContract.kindContract === 'object'
      ? sourceContract.kindContract
      : normalizeMountKindContract(mount.kind || descriptor.kind, mountId, `persistedState.mountsById.${mountId}.kind`);
    return {
      mountId,
      requestedKind: kindContract.requestedKind,
      canonicalKind: kindContract.canonicalKind,
      kindStatus: kindContract.status,
      kindProof: kindContract.proof,
      kindIssueCount: Array.isArray(kindContract.issues) ? kindContract.issues.length : 0,
      descriptorKind: descriptor.kind || mount.kind || null,
      descriptorLabel: descriptor.label || null,
      descriptorStatus: descriptor.descriptorStatus || null,
      descriptorProof: descriptor.proof || sourceContract.descriptorProof || null,
      descriptorRepairProof: descriptor.repairProof || null,
      descriptorRepairIssueCount: Array.isArray(descriptor.repairIssues) ? descriptor.repairIssues.length : 0,
      descriptorSupportedCommands: Array.isArray(descriptor.commandPolicy?.supportedCommands)
        ? descriptor.commandPolicy.supportedCommands
        : [],
      descriptorRequiredCapabilities: Array.isArray(descriptor.commandPolicy?.requiredCapabilities)
        ? descriptor.commandPolicy.requiredCapabilities
        : [],
      descriptorCommandPolicyProof: descriptor.commandPolicy?.proof || null,
      sourceKind: sourceContract.sourceKind || null,
      providerServiceId: sourceContract.providerContract?.serviceId || null,
      providerSyncMode: sourceContract.providerContract?.syncMetadata?.mode || null,
      providerNegotiationStatus: sourceContract.providerContract?.negotiationStatus || null,
      providerExternalHandoffRequired: sourceContract.providerContract?.externalHandoff?.required ?? null,
      providerContractProof: sourceContract.providerContract?.proof || null,
      descriptorSourceBindingStatus: sourceContract.descriptorSourceBinding?.status || null,
      descriptorSourceBindingProof: sourceContract.descriptorSourceBinding?.proof || null,
      canonicalScope: sourceContract.canonicalScope || mount.scope || null,
      scopeKind: sourceContract.scopeContract?.scopeKind || descriptor.scopeKind || null,
      scopeValue: sourceContract.scopeContract?.scopeValue || mount.scope || null,
      scopeProof: sourceContract.scopeContract?.proof || null,
      retentionPolicy: sourceContract.retention?.policy || descriptor.retentionPolicy || null,
      retentionTtlMinutes: Number.isInteger(sourceContract.retention?.ttlMinutes) ? sourceContract.retention.ttlMinutes : null,
      retentionProof: sourceContract.retention?.proof || null,
      uri: sourceContract.uri || null,
      accessMode: sourceContract.accessMode || null,
      sourceEpoch: Number.isInteger(sourceContract.sourceEpoch) ? sourceContract.sourceEpoch : 0,
      proof: sourceContract.proof || null
    };
  });
  return {
    schemaVersion: PERSISTED_STATE_SCHEMA_VERSION,
    stateKey: 'memory-manager.memory-mount.persisted-state',
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    commandType: command.type,
    epoch: persistedStatePatch.epoch,
    activeMountId: persistedStatePatch.activeMountId,
    mountIds,
    sourceContracts,
    lifecycleMode: persistedStatePatch.lifecycle.mode,
    lifecycleEnabled: persistedStatePatch.lifecycle.enabled,
    analyticsSnapshotId: persistedStatePatch.analytics?.lastSnapshotId || null,
    analyticsCommandCount: persistedStatePatch.analytics?.counters?.totalCommands || 0,
    analyticsHistoryCount: Array.isArray(persistedStatePatch.analytics?.history)
      ? persistedStatePatch.analytics.history.length
      : 0,
    mailchimpContinuity: {
      status: persistedStatePatch.mailchimpContinuity?.status || 'not_requested',
      checkpointKey: persistedStatePatch.mailchimpContinuity?.checkpointKey || null,
      subjectCount: persistedStatePatch.mailchimpContinuity?.subjects?.length || 0,
      readySubjectCount: (persistedStatePatch.mailchimpContinuity?.subjects || [])
        .filter((subject) => subject.status === 'ready')
        .length,
      blockedSubjectCount: (persistedStatePatch.mailchimpContinuity?.subjects || [])
        .filter((subject) => subject.status === 'blocked')
        .length,
      replaySafe: persistedStatePatch.mailchimpContinuity?.replaySafe === true,
      pendingHandoff: persistedStatePatch.mailchimpContinuity?.pendingHandoff || null
    },
    analyticsDescriptorCounters: {
      descriptorStatuses: persistedStatePatch.analytics?.counters?.descriptorStatuses || {},
      descriptorLifecycles: persistedStatePatch.analytics?.counters?.descriptorLifecycles || {},
      retentionPolicies: persistedStatePatch.analytics?.counters?.retentionPolicies || {},
      scopeKinds: persistedStatePatch.analytics?.counters?.scopeKinds || {},
      durabilityClasses: persistedStatePatch.analytics?.counters?.durabilityClasses || {},
      sourceAccessModes: persistedStatePatch.analytics?.counters?.sourceAccessModes || {}
    },
    commandJournalCount: commandJournal.length,
    latestJournalStatus: latestJournalEntry?.status || null,
    latestJournalProof: latestJournalEntry?.proof || null,
    commandExecutionCount: commandExecutions.length,
    latestExecutionStatus: latestExecution?.status || null,
    latestExecutionEpoch: latestExecution?.epoch ?? null,
    latestExecutionProof: latestExecution?.proof || null,
    replayCheckpoint: recovery.replayCheckpoint || null,
    restartSafe: recovery.restartSafe,
    recoveryStatus: recovery.status,
    requiredFields: ['version', 'epoch', 'activeMountId', 'mountsById', 'lifecycle', 'analytics', 'commandLog', 'commandJournal', 'commandExecutions'],
    proof: proofToken({
      version: persistedStatePatch.version,
      epoch: persistedStatePatch.epoch,
      activeMountId: persistedStatePatch.activeMountId,
      mountIds,
      sourceContracts,
      lifecycle: persistedStatePatch.lifecycle,
      mailchimpContinuity: persistedStatePatch.mailchimpContinuity,
      analytics: {
        counters: persistedStatePatch.analytics?.counters,
        lastSnapshotId: persistedStatePatch.analytics?.lastSnapshotId,
        descriptorCounters: {
          descriptorStatuses: persistedStatePatch.analytics?.counters?.descriptorStatuses,
          descriptorLifecycles: persistedStatePatch.analytics?.counters?.descriptorLifecycles,
          retentionPolicies: persistedStatePatch.analytics?.counters?.retentionPolicies,
          scopeKinds: persistedStatePatch.analytics?.counters?.scopeKinds,
          durabilityClasses: persistedStatePatch.analytics?.counters?.durabilityClasses,
          sourceAccessModes: persistedStatePatch.analytics?.counters?.sourceAccessModes
        },
        proof: persistedStatePatch.analytics?.proof
      },
      commandLog: persistedStatePatch.commandLog,
      commandJournalProofs: commandJournal.map((entry) => entry.proof),
      commandExecutionProofs: commandExecutions.map((entry) => entry.proof),
      replayCheckpoint: recovery.replayCheckpoint || null,
      recoveryStatus: recovery.status
    })
  };
}

function buildMailchimpContinuityState({ previousState, mountsById, lifecycle, command, epoch, now }) {
  const mountEntries = Object.values(mountsById)
    .filter((mount) => mount && typeof mount === 'object')
    .map((mount) => {
      const sourceKind = mount.sourceContract?.sourceKind || SOURCE_KIND_BY_MOUNT_KIND[mount.kind] || 'workspace-index';
      const context = normalizeMailchimpMountContext(mount.mailchimpSync ?? mount.mailchimp);
      const requested = Boolean(
        context.identifiers.audienceId ||
        context.identifiers.campaignId ||
        context.identifiers.segmentId ||
        context.identifiers.automationId ||
        context.sync.externalRevision ||
        context.sync.unsupportedEventKinds.length > 0 ||
        context.subjectKey !== 'mailchimp:audience-unbound:workspace'
      );
      const sourceSupported = MAILCHIMP_MEMORY_SOURCE_KINDS.has(sourceKind);
      const scheduleAligned = lifecycle.schedule.enabled ? lifecycle.schedule.nextRunAt !== null : true;
      const ready = context.ready && sourceSupported && scheduleAligned;
      const blockers = [
        ...context.identifiers.missingRequiredFields.map((field) => `missing:${field}`),
        ...(!sourceSupported ? [`unsupported-source:${sourceKind}`] : []),
        ...(!scheduleAligned ? ['schedule-next-run-missing'] : [])
      ];

      return {
        mountId: mount.id,
        sourceKind,
        subjectKey: context.subjectKey,
        requested,
        ready,
        status: ready ? 'ready' : 'blocked',
        eventKinds: context.sync.eventKinds,
        syncMode: context.sync.mode,
        externalRevision: context.sync.externalRevision,
        lastSyncedAt: context.sync.lastSyncedAt,
        nextSyncAt: lifecycle.schedule.enabled ? lifecycle.schedule.nextRunAt : null,
        blockers,
        proof: proofToken({
          mountId: mount.id,
          sourceKind,
          subjectKey: context.subjectKey,
          requested,
          ready,
          blockers,
          epoch
        })
      };
    })
    .filter((entry) => entry.requested);
  const subjects = Object.values(mountEntries.reduce((groups, entry) => {
    const existing = groups[entry.subjectKey] || {
      subjectKey: entry.subjectKey,
      status: 'ready',
      mountIds: [],
      readyMountIds: [],
      blockedMountIds: [],
      eventKinds: [],
      syncMode: entry.syncMode,
      externalRevision: entry.externalRevision,
      lastSyncedAt: entry.lastSyncedAt,
      nextSyncAt: entry.nextSyncAt,
      blockerCount: 0,
      proofs: []
    };
    existing.mountIds.push(entry.mountId);
    if (entry.ready) {
      existing.readyMountIds.push(entry.mountId);
    } else {
      existing.blockedMountIds.push(entry.mountId);
      existing.status = 'blocked';
    }
    existing.eventKinds = [...new Set([...existing.eventKinds, ...entry.eventKinds])].sort();
    existing.externalRevision = existing.externalRevision || entry.externalRevision;
    existing.lastSyncedAt = existing.lastSyncedAt || entry.lastSyncedAt;
    existing.nextSyncAt = existing.nextSyncAt || entry.nextSyncAt;
    existing.blockerCount += entry.blockers.length;
    existing.proofs.push(entry.proof);
    groups[entry.subjectKey] = existing;
    return groups;
  }, {}))
    .map((subject) => ({
      subjectKey: subject.subjectKey,
      status: subject.status,
      mountIds: subject.mountIds.sort(),
      readyMountIds: subject.readyMountIds.sort(),
      blockedMountIds: subject.blockedMountIds.sort(),
      eventKinds: subject.eventKinds,
      syncMode: subject.syncMode,
      externalRevision: subject.externalRevision,
      lastSyncedAt: subject.lastSyncedAt,
      nextSyncAt: subject.nextSyncAt,
      blockerCount: subject.blockerCount,
      proof: proofToken({
        subjectKey: subject.subjectKey,
        status: subject.status,
        mountIds: subject.mountIds.sort(),
        readyMountIds: subject.readyMountIds.sort(),
        blockedMountIds: subject.blockedMountIds.sort(),
        eventKinds: subject.eventKinds,
        epoch,
        proofs: subject.proofs
      })
    }))
    .slice(-MAX_MAILCHIMP_CONTINUITY_SUBJECTS);
  const blockedSubjects = subjects.filter((subject) => subject.status === 'blocked');
  const readySubjects = subjects.filter((subject) => subject.status === 'ready');
  const status = subjects.length === 0 ? 'not_requested' : blockedSubjects.length > 0 ? 'blocked' : 'ready';
  const checkpointKey = proofToken({
    provider: 'mailchimp',
    epoch,
    commandId: command.commandId,
    subjectProofs: subjects.map((subject) => subject.proof),
    previousCheckpointKey: previousState.checkpointKey
  });

  return {
    schemaVersion: 1,
    provider: 'mailchimp',
    status,
    checkpointKey,
    lastCommittedAt: now,
    lastAcceptedToken: readySubjects.length > 0 ? checkpointKey : previousState.lastAcceptedToken,
    replaySafe: status !== 'blocked',
    pendingHandoff: status === 'ready'
      ? {
          route: '/kernel/memory-manager/memory-mount/provider/mailchimp-sync/accept',
          payloadRef: checkpointKey,
          subjectKeys: readySubjects.map((subject) => subject.subjectKey),
          reason: 'mailchimp_mount_sync_ready'
        }
      : blockedSubjects.length > 0
        ? {
            route: '/kernel/memory-manager/memory-mount/provider/mailchimp-sync/validation',
            payloadRef: checkpointKey,
            subjectKeys: blockedSubjects.map((subject) => subject.subjectKey),
            reason: 'mailchimp_mount_sync_blocked'
          }
        : null,
    subjects,
    proof: proofToken({
      status,
      checkpointKey,
      subjects: subjects.map((subject) => subject.proof),
      replaySafe: status !== 'blocked'
    })
  };
}

function buildCommandJournalEntry({ command, persistedStatePatch, recovery, restartStatus, now, status }) {
  const mountIds = Object.keys(persistedStatePatch.mountsById).sort();
  const tombstonedMountIds = Array.isArray(recovery.tombstonedMountIds)
    ? [...recovery.tombstonedMountIds].sort()
    : [];
  const entry = {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    commandType: command.type,
    status,
    epoch: persistedStatePatch.epoch,
    activeMountId: persistedStatePatch.activeMountId,
    committedAt: now,
    restartLevel: restartStatus.level,
    restartSafe: restartStatus.stable === true && recovery.restartSafe === true,
    mountIds,
    tombstonedMountIds
  };
  return {
    ...entry,
    proof: proofToken({
      ...entry,
      recoveryStatus: recovery.status,
      recoveryReason: recovery.reason,
      restartReason: restartStatus.reason
    })
  };
}

function appendCommandJournal({ persistedState, persistedStatePatch, command, recovery, restartStatus, now, status }) {
  const priorJournal = Array.isArray(persistedState.commandJournal) ? persistedState.commandJournal : [];
  const journalEntry = buildCommandJournalEntry({
    command,
    persistedStatePatch,
    recovery,
    restartStatus,
    now,
    status
  });
  const deduped = priorJournal.filter((entry) =>
    entry.commandId !== command.commandId && entry.idempotencyKey !== command.idempotencyKey
  );
  return [...deduped, journalEntry].slice(-MAX_STATE_JOURNAL_ENTRIES);
}

function classifyRestartStatus({ persistedStatePatch, recovery, mounts }) {
  if (recovery.status === 'boundary_blocked') {
    return {
      level: 'blocked',
      stable: false,
      reason: 'state_write_blocked_by_boundary',
      resumeCommand: 'repair'
    };
  }
  if (recovery.replayedCommandId && !recovery.restartSafe) {
    const replayLevel = ['blocked', 'needs_recovery', 'review'].includes(recovery.replayCheckpoint?.restartLevel)
      ? recovery.replayCheckpoint.restartLevel
      : 'needs_recovery';
    return {
      level: replayLevel,
      stable: false,
      reason: 'idempotent_command_replayed_with_unstable_checkpoint',
      resumeCommand: replayLevel === 'blocked' ? 'repair' : 'recover'
    };
  }
  if (recovery.replayedCommandId) {
    return {
      level: 'stable',
      stable: true,
      reason: 'idempotent_command_replayed_without_state_change',
      resumeCommand: 'refresh'
    };
  }
  if (!persistedStatePatch.activeMountId || !mounts.accepted.length) {
    return {
      level: 'needs_recovery',
      stable: false,
      reason: 'no_active_mount_after_commit',
      resumeCommand: 'recover'
    };
  }
  if (recovery.tombstonedMountIds.length) {
    return {
      level: 'review',
      stable: true,
      reason: 'persisted_mounts_tombstoned',
      resumeCommand: 'refresh'
    };
  }
  return {
    level: 'stable',
    stable: true,
    reason: 'active_mount_persisted',
    resumeCommand: 'refresh'
  };
}

function enforceMemoryBoundaries({ mounts, command, principal, clientState }) {
  const accepted = [];
  const rejected = [...mounts.rejected];
  const decisions = [];
  const requiredPermission = COMMAND_PERMISSION[command.type] || 'memory:read';
  const visibleTarget = command.mountId
    ? mounts.accepted.find((mount) => mount.id === command.mountId) || null
    : null;

  if (command.mountId && TARGETED_COMMANDS.has(command.type) && !visibleTarget) {
    rejected.push({
      commandId: command.commandId,
      type: command.type,
      mountId: command.mountId,
      reason: 'command_target_not_visible'
    });
    decisions.push('command_target_not_visible');
    return { accepted, rejected, decisions, blocked: true, boundaryContract: null };
  }

  if (!principal.permissions.includes(requiredPermission)) {
    rejected.push({
      commandId: command.commandId,
      type: command.type,
      reason: 'command_permission_denied',
      requiredPermission
    });
    decisions.push('command_permission_denied');
    return { accepted, rejected, decisions, blocked: true, boundaryContract: null };
  }

  for (const mount of mounts.accepted) {
    const scopeBoundary = classifyWorkspaceScope({ mount, principal, clientState });
    const blockingViolation = scopeBoundary.violations[0] || null;

    if (blockingViolation) {
      rejected.push({
        id: mount.id,
        ...blockingViolation,
        scopeKind: scopeBoundary.scopeKind,
        scopeValue: scopeBoundary.scopeValue,
        boundaryProof: scopeBoundary.proof
      });
      decisions.push(`${blockingViolation.reason}_rejected`);
      continue;
    }

    const sourceBoundary = classifySourceBoundary({ mount, command, principal, clientState });
    const sourceViolation = sourceBoundary.violations[0] || null;

    if (sourceViolation) {
      rejected.push({
        id: mount.id,
        ...sourceViolation,
        scopeKind: scopeBoundary.scopeKind,
        scopeValue: scopeBoundary.scopeValue,
        sourceUri: sourceBoundary.sourceUri,
        sourceKind: sourceBoundary.expectedSourceKind,
        sourceBoundaryProof: sourceBoundary.proof,
        boundaryProof: proofToken({
          mountId: mount.id,
          scopeProof: scopeBoundary.proof,
          sourceProof: sourceBoundary.proof,
          violation: sourceViolation
        })
      });
      decisions.push(`${sourceViolation.reason}_rejected`);
      continue;
    }

    const descriptorCommandBoundary = buildDescriptorCommandBoundary({ mount, command });
    if (!descriptorCommandBoundary.supported) {
      rejected.push({
        id: mount.id,
        reason: 'descriptor_command_not_supported',
        commandType: command.type,
        descriptorKind: descriptorCommandBoundary.descriptorKind,
        supportedCommands: descriptorCommandBoundary.supportedCommands,
        descriptorCommandBoundaryProof: descriptorCommandBoundary.proof,
        boundaryProof: proofToken({
          mountId: mount.id,
          scopeProof: scopeBoundary.proof,
          sourceProof: sourceBoundary.proof,
          descriptorCommandProof: descriptorCommandBoundary.proof
        })
      });
      decisions.push('descriptor_command_not_supported_rejected');
      continue;
    }

    const writable = mount.writable && principal.canWrite;
    const sourceAccessMode = writable && mount.sourceContract.accessMode !== 'read'
      ? mount.sourceContract.accessMode
      : 'read';
    const providerContract = mount.sourceContract.providerContract
      ? {
          ...mount.sourceContract.providerContract,
          accessMode: sourceAccessMode,
          proof: proofToken({
            providerProof: mount.sourceContract.providerContract.proof,
            mountId: mount.id,
            sourceAccessMode,
            principalId: principal.principalId,
            permissions: principal.permissions
          })
        }
      : null;
    accepted.push({
      ...mount,
      writable,
      sourceContract: {
        ...mount.sourceContract,
        accessMode: sourceAccessMode,
        ...(providerContract ? { providerContract } : {}),
        permissionAdjusted: sourceAccessMode !== mount.sourceContract.accessMode,
        proof: proofToken({
          mountId: mount.id,
          sourceProof: mount.sourceContract.proof,
          sourceAccessMode,
          providerContractProof: providerContract?.proof || mount.sourceContract.providerContract?.proof || null,
          principalId: principal.principalId,
          permissions: principal.permissions
        })
      },
      boundary: {
        schemaVersion: 1,
        tenantId: mount.tenantId,
        workspaceId: mount.workspaceId,
        principalId: principal.principalId,
        principalTenantId: principal.tenantId,
        principalWorkspaceId: principal.workspaceId,
        scopeKind: scopeBoundary.scopeKind,
        scopeValue: scopeBoundary.scopeValue,
        scopeEnforced: scopeBoundary.scopeEnforced,
        isolation: scopeBoundary.isolation,
        commandTargeted: command.mountId === mount.id,
        access: writable ? 'read_write' : 'read_only',
        sourceAccess: sourceAccessMode,
        sourceBoundary: {
          hostedKernelSource: sourceBoundary.hostedKernelSource,
          uriTenantId: sourceBoundary.uriTenantId,
          uriWorkspaceId: sourceBoundary.uriWorkspaceId,
          uriSourceKind: sourceBoundary.uriSourceKind,
          writeClass: sourceBoundary.writeClass,
          volatileSessionBoundary: sourceBoundary.volatileSessionBoundary,
          proof: sourceBoundary.proof
        },
        descriptorCommandBoundary,
        violations: [],
        proof: proofToken({
          mountId: mount.id,
          tenantId: mount.tenantId,
          workspaceId: mount.workspaceId,
          principalId: principal.principalId,
          permissions: principal.permissions,
          scopeProof: scopeBoundary.proof,
          commandId: command.commandId,
          commandType: command.type,
          commandTargeted: command.mountId === mount.id,
          sourceAccessMode,
          sourceBoundaryProof: sourceBoundary.proof,
          descriptorCommandBoundaryProof: descriptorCommandBoundary.proof
        })
      }
    });
    decisions.push(writable === mount.writable ? 'mount_boundary_admitted' : 'mount_write_downgraded');
  }

  const boundaryAuditHandoff = buildBoundaryAuditHandoff({ command, principal, clientState, accepted, rejected });
  const boundaryContract = {
    schemaVersion: 1,
    commandId: command.commandId,
    commandType: command.type,
    commandMountId: command.mountId,
    requiredPermission,
    principal: {
      principalId: principal.principalId,
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      roles: principal.roles,
      permissions: principal.permissions,
      canCrossTenant: principal.canCrossTenant
    },
    acceptedScopes: accepted.map((mount) => ({
      mountId: mount.id,
      kind: mount.kind,
      tenantId: mount.tenantId,
      workspaceId: mount.workspaceId,
      scopeKind: mount.boundary.scopeKind,
      scopeValue: mount.boundary.scopeValue,
      scopeEnforced: mount.boundary.scopeEnforced,
      isolation: mount.boundary.isolation,
      access: mount.boundary.access,
      sourceAccess: mount.boundary.sourceAccess,
      sourceBoundaryProof: mount.boundary.sourceBoundary.proof,
      descriptorCommandBoundaryProof: mount.boundary.descriptorCommandBoundary.proof,
      proof: mount.boundary.proof
    })),
    rejectedScopes: rejected
      .filter((entry) =>
        (entry.reason && String(entry.reason).includes('boundary'))
        || String(entry.reason || '').includes('scope_')
        || String(entry.reason || '').includes('source_boundary_')
        || String(entry.reason || '').startsWith('volatile_')
        || entry.reason === 'descriptor_command_not_supported'
        || entry.reason === 'command_target_not_visible'
      )
      .map((entry) => ({
        id: entry.id || entry.mountId || null,
        reason: entry.reason,
        scopeKind: entry.scopeKind || null,
        scopeValue: entry.scopeValue || null,
        sourceUri: entry.sourceUri || null,
        sourceKind: entry.sourceKind || null,
        sourceBoundaryProof: entry.sourceBoundaryProof || null,
        descriptorCommandBoundaryProof: entry.descriptorCommandBoundaryProof || null,
        proof: entry.boundaryProof || null
      })),
    sourceBoundarySummary: {
      hostedKernelSources: accepted.filter((mount) => mount.boundary.sourceBoundary.hostedKernelSource).length,
      externalSources: accepted.filter((mount) => !mount.boundary.sourceBoundary.hostedKernelSource).length,
      writeCapableSources: accepted.filter((mount) => mount.boundary.sourceBoundary.writeClass === 'write_capable').length,
      volatileSessionEnforced: accepted.filter((mount) => mount.boundary.sourceBoundary.volatileSessionBoundary?.enforced).length,
      volatileSessionRejected: rejected.filter((entry) => String(entry.reason || '').startsWith('volatile_')).length,
      rejectedSourceBoundaries: rejected.filter((entry) => String(entry.reason || '').includes('source_boundary_')).length,
      descriptorCommandPolicies: accepted.map((mount) => ({
        mountId: mount.id,
        descriptorKind: mount.boundary.descriptorCommandBoundary.descriptorKind,
        supportedCommandCount: mount.boundary.descriptorCommandBoundary.supportedCommands.length,
        commandSupported: mount.boundary.descriptorCommandBoundary.supported,
        proof: mount.boundary.descriptorCommandBoundary.proof
      })),
      rejectedDescriptorCommands: rejected.filter((entry) => entry.reason === 'descriptor_command_not_supported').length,
      handoffRoute: '/kernel/memory-manager/memory-mount/boundary/source-review',
      proof: proofToken({
        acceptedSourceProofs: accepted.map((mount) => mount.boundary.sourceBoundary.proof),
        acceptedDescriptorCommandProofs: accepted.map((mount) => mount.boundary.descriptorCommandBoundary.proof),
        rejectedSourceProofs: rejected.map((entry) => entry.sourceBoundaryProof).filter(Boolean),
        rejectedDescriptorCommandProofs: rejected.map((entry) => entry.descriptorCommandBoundaryProof).filter(Boolean),
        volatileBoundaryProofs: accepted
          .map((mount) => mount.boundary.sourceBoundary.volatileSessionBoundary?.proof)
          .filter(Boolean)
      })
    },
    boundaryAuditHandoff,
    proof: proofToken({
      commandId: command.commandId,
      commandType: command.type,
      requiredPermission,
      principalId: principal.principalId,
      principalTenantId: principal.tenantId,
      principalWorkspaceId: principal.workspaceId,
      acceptedProofs: accepted.map((mount) => mount.boundary.proof),
      acceptedSourceProofs: accepted.map((mount) => mount.boundary.sourceBoundary.proof),
      acceptedDescriptorCommandProofs: accepted.map((mount) => mount.boundary.descriptorCommandBoundary.proof),
      boundaryAuditHandoffProof: boundaryAuditHandoff.proof,
      rejectedReasons: rejected.map((entry) => entry.reason || 'unknown_rejection')
    })
  };
  const targetedMountRejected = command.mountId
    && TARGETED_COMMANDS.has(command.type)
    && !accepted.some((mount) => mount.id === command.mountId);

  if (targetedMountRejected) {
    decisions.push('targeted_mount_blocked_by_boundary');
  }

  return { accepted, rejected, decisions, blocked: Boolean(targetedMountRejected), boundaryContract };
}

function buildAnalyticsSnapshot({ command, mounts, lifecycle, recovery, restartStatus, epoch, activeMountId, now }) {
  const acceptedMounts = mounts.accepted || [];
  const rejectedMounts = mounts.rejected || [];
  const sourceIssueCount = acceptedMounts
    .flatMap((mount) => Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [])
    .length;
  const outcome = recovery.replayedCommandId
    ? 'replayed'
    : (mounts.blocked ? 'blocked' : recovery.status);
  const snapshot = {
    capturedAt: now,
    epoch,
    commandId: command.commandId,
    commandType: command.type,
    outcome,
    activeMountId,
    acceptedCount: acceptedMounts.length,
    rejectedCount: rejectedMounts.length,
    writableCount: acceptedMounts.filter((mount) => mount.writable).length,
    recoveredCount: recovery.recoveredMountIds.length,
    tombstonedCount: recovery.tombstonedMountIds.length,
    lifecycleMode: lifecycle.settings.mode,
    lifecycleEnabled: lifecycle.settings.enabled,
    scheduled: lifecycle.settings.schedule.enabled,
    lifecycleIssueCount: lifecycle.validationIssues.length,
    sourceIssueCount,
    readinessLevel: restartStatus.stable ? 'ready' : restartStatus.level,
    restartLevel: restartStatus.level,
    healthStatus: mounts.blocked || !recovery.restartSafe ? 'degraded' : 'healthy',
    validationStatus: rejectedMounts.length || lifecycle.validationIssues.length || sourceIssueCount ? 'review' : 'clean',
    mountKinds: countBy(acceptedMounts, (mount) => mount.kind),
    sourceKinds: countBy(acceptedMounts, (mount) => mount.sourceContract?.sourceKind),
    descriptorStatuses: countBy(acceptedMounts, (mount) => mount.descriptor?.descriptorStatus),
    descriptorLifecycles: countBy(acceptedMounts, (mount) => mount.descriptor?.lifecycle),
    retentionPolicies: countBy(acceptedMounts, (mount) => mount.sourceContract?.retention?.policy),
    scopeKinds: countBy(acceptedMounts, (mount) =>
      mount.sourceContract?.scopeContract?.scopeKind || mount.descriptor?.scopeKind),
    durabilityClasses: countBy(acceptedMounts, (mount) => mount.descriptor?.durability),
    sourceAccessModes: countBy(acceptedMounts, (mount) => mount.sourceContract?.accessMode)
  };
  return {
    ...snapshot,
    snapshotId: proofToken(snapshot),
    proof: proofToken({
      ...snapshot,
      mountIds: acceptedMounts.map((mount) => mount.id),
      rejectedReasons: rejectedMounts.map((entry) => entry.reason || 'unknown_rejection')
    })
  };
}

function mergeCounterMap(left, right) {
  const merged = { ...left };
  for (const [key, count] of Object.entries(right)) {
    merged[key] = (merged[key] || 0) + count;
  }
  return merged;
}

function advanceAnalyticsState({ analytics, snapshot }) {
  const counters = analytics.counters;
  const history = [...analytics.history, snapshot].slice(-MAX_ANALYTICS_HISTORY);
  return {
    schemaVersion: 1,
    counters: {
      totalCommands: counters.totalCommands + 1,
      acceptedMountsSeen: counters.acceptedMountsSeen + snapshot.acceptedCount,
      rejectedMountsSeen: counters.rejectedMountsSeen + snapshot.rejectedCount,
      recoveredMountsSeen: counters.recoveredMountsSeen + snapshot.recoveredCount,
      tombstonedMountsSeen: counters.tombstonedMountsSeen + snapshot.tombstonedCount,
      blockedCommands: counters.blockedCommands + (snapshot.outcome === 'blocked' ? 1 : 0),
      replayedCommands: counters.replayedCommands + (snapshot.outcome === 'replayed' ? 1 : 0),
      degradedHealthEvents: counters.degradedHealthEvents + (snapshot.healthStatus === 'degraded' ? 1 : 0),
      scheduledCommands: counters.scheduledCommands + (snapshot.scheduled ? 1 : 0),
      cleanValidationEvents: counters.cleanValidationEvents + (snapshot.validationStatus === 'clean' ? 1 : 0),
      reviewValidationEvents: counters.reviewValidationEvents + (snapshot.validationStatus !== 'clean' ? 1 : 0),
      sourceContractIssueEvents: counters.sourceContractIssueEvents + snapshot.sourceIssueCount,
      lifecycleNormalizationEvents: counters.lifecycleNormalizationEvents + snapshot.lifecycleIssueCount,
      commandsByType: mergeCounterMap(counters.commandsByType, { [snapshot.commandType]: 1 }),
      outcomesByStatus: mergeCounterMap(counters.outcomesByStatus, { [snapshot.outcome]: 1 }),
      mountsByKind: mergeCounterMap(counters.mountsByKind, snapshot.mountKinds),
      sourceKinds: mergeCounterMap(counters.sourceKinds, snapshot.sourceKinds),
      descriptorStatuses: mergeCounterMap(counters.descriptorStatuses, snapshot.descriptorStatuses),
      descriptorLifecycles: mergeCounterMap(counters.descriptorLifecycles, snapshot.descriptorLifecycles),
      retentionPolicies: mergeCounterMap(counters.retentionPolicies, snapshot.retentionPolicies),
      scopeKinds: mergeCounterMap(counters.scopeKinds, snapshot.scopeKinds),
      durabilityClasses: mergeCounterMap(counters.durabilityClasses, snapshot.durabilityClasses),
      sourceAccessModes: mergeCounterMap(counters.sourceAccessModes, snapshot.sourceAccessModes),
      readinessByLevel: mergeCounterMap(counters.readinessByLevel, { [snapshot.readinessLevel]: 1 }),
      healthByStatus: mergeCounterMap(counters.healthByStatus, { [snapshot.healthStatus]: 1 }),
      restartByLevel: mergeCounterMap(counters.restartByLevel, { [snapshot.restartLevel]: 1 }),
      activeMountSelections: snapshot.activeMountId
        ? mergeCounterMap(counters.activeMountSelections, { [snapshot.activeMountId]: 1 })
        : { ...counters.activeMountSelections }
    },
    history,
    lastSnapshotId: snapshot.snapshotId,
    lastExportedAt: analytics.lastExportedAt,
    proof: proofToken({
      counters: {
        totalCommands: counters.totalCommands + 1,
        blockedCommands: counters.blockedCommands + (snapshot.outcome === 'blocked' ? 1 : 0),
        replayedCommands: counters.replayedCommands + (snapshot.outcome === 'replayed' ? 1 : 0),
        sourceContractIssueEvents: counters.sourceContractIssueEvents + snapshot.sourceIssueCount,
        lifecycleNormalizationEvents: counters.lifecycleNormalizationEvents + snapshot.lifecycleIssueCount
      },
      lastSnapshotId: snapshot.snapshotId,
      historyProofs: history.map((entry) => entry.proof)
    })
  };
}

function shapePersistedState({ persistedState, command, mounts, clientState, lifecycle, now }) {
  const existingIds = new Set(Object.keys(persistedState.mountsById));
  const replay = findCommandReplayCheckpoint({ persistedState, command });
  const recovered = [];
  const tombstoned = [];
  const mountsById = {};

  if (replay) {
    let persistedStatePatch = {
      version: persistedState.version,
      epoch: persistedState.epoch,
      activeMountId: persistedState.activeMountId,
      lastCommittedAt: persistedState.lastCommittedAt,
      mountsById: persistedState.mountsById,
      lifecycle: persistedState.lifecycle,
      analytics: persistedState.analytics,
      commandLog: persistedState.commandLog,
      commandJournal: persistedState.commandJournal,
      commandExecutions: persistedState.commandExecutions,
      mailchimpContinuity: persistedState.mailchimpContinuity
    };
    const persistedMountIds = Object.keys(persistedState.mountsById);
    const recovery = {
      status: 'replayed',
      restartSafe: replay.restartSafe,
      activeMountId: replay.activeMountId || persistedState.activeMountId,
      recoveredMountIds: persistedMountIds,
      tombstonedMountIds: [],
      replayedCommandId: replay.commandId,
      replayCheckpoint: replay,
      reason: `idempotency_key_already_committed_from_${replay.source}`
    };
    const restartStatus = classifyRestartStatus({ persistedStatePatch, recovery, mounts });
    persistedStatePatch = {
      ...persistedStatePatch,
      commandExecutions: persistedState.commandExecutions
    };
    return {
      persistedStatePatch: {
        ...persistedStatePatch,
        stateContract: buildPersistedStateContract({ persistedStatePatch, recovery, command })
      },
      recovery: {
        ...recovery,
        restartStatus
      }
    };
  }

  if (mounts.blocked) {
    let persistedStatePatch = {
      version: persistedState.version,
      epoch: persistedState.epoch,
      activeMountId: persistedState.activeMountId,
      lastCommittedAt: persistedState.lastCommittedAt,
      mountsById: persistedState.mountsById,
      lifecycle: persistedState.lifecycle,
      analytics: persistedState.analytics,
      commandLog: persistedState.commandLog,
      commandJournal: persistedState.commandJournal,
      commandExecutions: persistedState.commandExecutions,
      mailchimpContinuity: persistedState.mailchimpContinuity
    };
    const recovery = {
      status: 'boundary_blocked',
      restartSafe: false,
      activeMountId: persistedState.activeMountId,
      recoveredMountIds: [],
      tombstonedMountIds: [],
      replayedCommandId: null,
      replayCheckpoint: null,
      reason: 'blocked_command_did_not_mutate_persisted_state'
    };
    const restartStatus = classifyRestartStatus({ persistedStatePatch, recovery, mounts });
    const commandJournal = appendCommandJournal({
      persistedState,
      persistedStatePatch,
      command,
      recovery,
      restartStatus,
      now,
      status: 'blocked'
    });
    const analyticsSnapshot = buildAnalyticsSnapshot({
      command,
      mounts,
      lifecycle,
      recovery,
      restartStatus,
      epoch: persistedStatePatch.epoch,
      activeMountId: persistedStatePatch.activeMountId,
      now
    });
    persistedStatePatch = {
      ...persistedStatePatch,
      analytics: advanceAnalyticsState({ analytics: persistedState.analytics, snapshot: analyticsSnapshot }),
      commandJournal
    };
    const commandExecutions = appendCommandExecution({
      persistedState,
      persistedStatePatch,
      command,
      recovery,
      restartStatus,
      now,
      status: 'blocked'
    });
    persistedStatePatch = {
      ...persistedStatePatch,
      commandExecutions
    };
    return {
      persistedStatePatch: {
        ...persistedStatePatch,
        stateContract: buildPersistedStateContract({ persistedStatePatch, recovery, command })
      },
      recovery: {
        ...recovery,
        restartStatus
      }
    };
  }

  for (const mount of mounts.accepted) {
    mountsById[mount.id] = {
      id: mount.id,
      kind: mount.kind,
      requestedKind: mount.requestedKind || mount.kind,
      scope: mount.scope,
      tenantId: mount.tenantId,
      workspaceId: mount.workspaceId,
      priority: mount.priority,
      writable: mount.writable,
      selected: mount.selected,
      boundary: mount.boundary,
      descriptor: mount.descriptor,
      sourceContract: mount.sourceContract,
      mailchimpSync: mount.mailchimpSync,
      sourceValidationIssues: mount.sourceValidationIssues,
      committedAt: now,
      source: existingIds.has(mount.id) ? 'persisted-refresh' : 'request'
    };
    if (existingIds.has(mount.id)) {
      recovered.push(mount.id);
    }
  }

  for (const existingId of existingIds) {
    if (!mountsById[existingId]) {
      tombstoned.push(existingId);
    }
  }

  const requestedActiveId = command.type === 'detach' && command.mountId === persistedState.activeMountId
    ? null
    : command.mountId || clientState.selectedMountId || persistedState.activeMountId;
  const activeMountId = requestedActiveId && mountsById[requestedActiveId]
    ? requestedActiveId
    : mounts.accepted[0]?.id || null;
  const status = mounts.accepted.length ? (recovered.length ? 'recovered' : 'ready') : 'empty';
  const commandResult = `committed_${command.type}`;
  let persistedStatePatch = {
    version: Math.max(persistedState.version, PERSISTED_STATE_SCHEMA_VERSION),
    epoch: persistedState.epoch + 1,
    activeMountId,
    lastCommittedAt: now,
    mountsById,
    lifecycle: lifecycle.settings,
    analytics: persistedState.analytics,
    commandLog: [
      ...persistedState.commandLog,
      {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        type: command.type,
        result: commandResult,
        committedAt: now
      }
    ].slice(-MAX_COMMAND_LOG_ENTRIES),
    commandJournal: persistedState.commandJournal,
    commandExecutions: persistedState.commandExecutions,
    mailchimpContinuity: null
  };
  persistedStatePatch = {
    ...persistedStatePatch,
    mailchimpContinuity: buildMailchimpContinuityState({
      previousState: persistedState.mailchimpContinuity,
      mountsById: persistedStatePatch.mountsById,
      lifecycle: persistedStatePatch.lifecycle,
      command,
      epoch: persistedStatePatch.epoch,
      now
    })
  };
  const recovery = {
    status,
    restartSafe: mounts.rejected.length === 0 && status !== 'empty',
    activeMountId,
    recoveredMountIds: recovered,
    tombstonedMountIds: tombstoned,
    replayedCommandId: null,
    replayCheckpoint: null,
    reason: recovered.length ? 'persisted_mounts_rehydrated' : 'command_committed'
  };
  const restartStatus = classifyRestartStatus({ persistedStatePatch, recovery, mounts });
  const commandJournal = appendCommandJournal({
    persistedState,
    persistedStatePatch,
    command,
    recovery,
    restartStatus,
    now,
    status: 'applied'
  });
  const analyticsSnapshot = buildAnalyticsSnapshot({
    command,
    mounts,
    lifecycle,
    recovery,
    restartStatus,
    epoch: persistedStatePatch.epoch,
    activeMountId: persistedStatePatch.activeMountId,
    now
  });
  persistedStatePatch = {
    ...persistedStatePatch,
    analytics: advanceAnalyticsState({ analytics: persistedState.analytics, snapshot: analyticsSnapshot }),
    commandJournal
  };
  const commandExecutions = appendCommandExecution({
    persistedState,
    persistedStatePatch,
    command,
    recovery,
    restartStatus,
    now,
    status: 'applied'
  });
  persistedStatePatch = {
    ...persistedStatePatch,
    commandExecutions
  };

  return {
    persistedStatePatch: {
      ...persistedStatePatch,
      stateContract: buildPersistedStateContract({ persistedStatePatch, recovery, command })
    },
    recovery: {
      ...recovery,
      restartStatus
    }
  };
}

function buildNextActionState({ command, mounts, lifecycle, now }) {
  const activeMount = mounts.accepted.find((mount) => mount.selected) || mounts.accepted[0] || null;
  const blockingRejection = mounts.rejected.find((entry) => entry.reason === 'lifecycle_disabled')
    || mounts.rejected.find((entry) => entry.reason === 'command_permission_denied')
    || null;

  if (blockingRejection?.reason === 'lifecycle_disabled') {
    return {
      type: 'enable_memory_mount',
      blocked: true,
      targetMountId: command.mountId || activeMount?.id || null,
      reason: 'lifecycle_disabled',
      routeHint: 'settings.lifecycle.enabled'
    };
  }

  if (blockingRejection?.reason === 'command_permission_denied') {
    return {
      type: 'request_permission',
      blocked: true,
      targetMountId: command.mountId || activeMount?.id || null,
      reason: 'command_permission_denied',
      routeHint: 'principal.permissions'
    };
  }

  if (!activeMount) {
    return {
      type: 'attach_memory_scope',
      blocked: false,
      targetMountId: null,
      reason: 'no_active_mount',
      routeHint: 'memory-manager.mounts'
    };
  }

  if (lifecycle.settings.enabled && lifecycle.settings.schedule.enabled) {
    const dueNow = lifecycle.settings.schedule.nextRunAt
      && isRunnableIso(lifecycle.settings.schedule.nextRunAt, now)
      && !isFutureIso(lifecycle.settings.schedule.nextRunAt, now);
    return {
      type: 'scheduled_refresh',
      blocked: false,
      targetMountId: activeMount.id,
      reason: dueNow ? 'schedule_due_now' : 'schedule_enabled',
      runAt: lifecycle.settings.schedule.nextRunAt,
      dueNow: Boolean(dueNow),
      routeHint: 'settings.lifecycle.schedule'
    };
  }

  return {
    type: command.type === 'refresh' ? 'continue_after_refresh' : 'continue_memory_workflow',
    blocked: false,
    targetMountId: activeMount.id,
    reason: lifecycle.settings.enabled ? 'lifecycle_ready' : 'manual_enable_required',
    routeHint: 'memory-manager.workflow'
  };
}

function classifyReadiness({ mounts, lifecycle, recovery }) {
  const sourceIssueCount = mounts.accepted
    .flatMap((mount) => Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [])
    .length;

  if (mounts.blocked) {
    return {
      level: 'blocked',
      reason: mounts.rejected.find((entry) => entry.reason === 'command_permission_denied') ? 'permission_blocked' : 'mount_validation_blocked',
      routeHint: 'memory-manager.validation'
    };
  }

  if (!lifecycle.settings.enabled) {
    return {
      level: 'blocked',
      reason: 'lifecycle_disabled',
      routeHint: 'settings.lifecycle.enabled'
    };
  }

  if (!mounts.accepted.length) {
    return {
      level: 'empty',
      reason: 'no_mounts_available',
      routeHint: 'memory-manager.mounts'
    };
  }

  if (mounts.rejected.length || lifecycle.validationIssues.length || sourceIssueCount) {
    return {
      level: 'needs_review',
      reason: 'non_blocking_validation_issues',
      routeHint: 'memory-manager.preview.validation'
    };
  }

  return {
    level: recovery.restartSafe ? 'ready' : 'needs_review',
    reason: recovery.restartSafe ? 'restart_safe' : 'restart_state_incomplete',
    routeHint: recovery.restartSafe ? 'memory-manager.workflow' : 'memory-manager.recovery'
  };
}

function buildDescriptorValidationIssues({ mounts, memoryMountDescriptors }) {
  const catalog = memoryMountDescriptors && typeof memoryMountDescriptors === 'object'
    ? memoryMountDescriptors
    : {};
  const requiredCoverage = catalog.requiredCoverage && typeof catalog.requiredCoverage === 'object'
    ? catalog.requiredCoverage
    : {};
  const descriptorByKind = new Map(
    (Array.isArray(catalog.descriptors) ? catalog.descriptors : [])
      .filter((descriptor) => descriptor && typeof descriptor === 'object' && descriptor.kind)
      .map((descriptor) => [descriptor.kind, descriptor])
  );
  const issues = [
    ...normalizeStringList(requiredCoverage.missingKinds).map((kind) => ({
      field: 'memoryMountDescriptors.requiredCoverage.missingKinds',
      reason: 'required_descriptor_kind_missing',
      value: kind
    })),
    ...(Array.isArray(requiredCoverage.sourceMismatches) ? requiredCoverage.sourceMismatches : []).map((mismatch) => ({
      field: `memoryMountDescriptors.descriptors.${mismatch.kind}.sourceKind`,
      reason: 'descriptor_catalog_source_kind_mismatch',
      value: mismatch.sourceKind,
      normalizedValue: mismatch.expectedSourceKind,
      descriptorKind: mismatch.kind
    }))
  ];

  for (const mount of mounts.accepted) {
    const descriptor = descriptorByKind.get(mount.kind);
    const mountDescriptor = mount.descriptor || {};
    const sourceContract = mount.sourceContract || {};
    const binding = sourceContract.descriptorSourceBinding || {};
    const repairIssues = Array.isArray(mountDescriptor.repairIssues)
      ? mountDescriptor.repairIssues
      : [];
    const descriptorCommandPolicy = mountDescriptor.commandPolicy && typeof mountDescriptor.commandPolicy === 'object'
      ? mountDescriptor.commandPolicy
      : null;
    const providerContract = sourceContract.providerContract && typeof sourceContract.providerContract === 'object'
      ? sourceContract.providerContract
      : null;

    issues.push(...repairIssues.map((issue) => ({
      ...issue,
      field: `mounts.${mount.id}.${issue.field || 'descriptor'}`,
      reason: issue.reason || 'descriptor_repaired',
      descriptorKind: issue.descriptorKind || mount.kind
    })));

    if (!descriptor) {
      issues.push({
        field: `mounts.${mount.id}.descriptor.kind`,
        reason: 'mount_descriptor_not_in_catalog',
        value: mount.kind
      });
      continue;
    }

    if (mountDescriptor.defaultSourceKind && mountDescriptor.defaultSourceKind !== descriptor.sourceKind) {
      issues.push({
        field: `mounts.${mount.id}.descriptor.defaultSourceKind`,
        reason: 'mount_descriptor_default_source_mismatch',
        value: mountDescriptor.defaultSourceKind,
        normalizedValue: descriptor.sourceKind,
        descriptorKind: mount.kind
      });
    }

    if (sourceContract.sourceKind !== descriptor.sourceKind) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.sourceKind`,
        reason: 'mount_source_kind_not_descriptor_canonical',
        value: sourceContract.sourceKind,
        normalizedValue: descriptor.sourceKind,
        descriptorKind: mount.kind
      });
    }

    if (binding.expectedSourceKind && binding.expectedSourceKind !== descriptor.sourceKind) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.descriptorSourceBinding.expectedSourceKind`,
        reason: 'descriptor_source_binding_expected_kind_mismatch',
        value: binding.expectedSourceKind,
        normalizedValue: descriptor.sourceKind,
        descriptorKind: mount.kind
      });
    }

    if (!sourceContract.scopeContract || !DESCRIPTOR_SCOPE_KINDS.has(sourceContract.scopeContract.scopeKind)) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.scopeContract`,
        reason: 'mount_scope_contract_missing_or_invalid',
        value: sourceContract.scopeContract || null,
        normalizedValue: mount.descriptor?.scopeKind || descriptor.defaultScopeKind || 'session',
        descriptorKind: mount.kind
      });
    } else if (sourceContract.scopeContract.scopeKind !== descriptor.defaultScopeKind) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.scopeContract.scopeKind`,
        reason: 'mount_scope_kind_differs_from_descriptor_default',
        value: sourceContract.scopeContract.scopeKind,
        normalizedValue: descriptor.defaultScopeKind,
        descriptorKind: mount.kind
      });
    }

    if (!sourceContract.retention || !ALLOWED_RETENTION_POLICIES.has(sourceContract.retention.policy)) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.retention.policy`,
        reason: 'mount_retention_policy_missing_or_invalid',
        value: sourceContract.retention?.policy || null,
        normalizedValue: descriptor.defaultRetentionPolicy,
        descriptorKind: mount.kind
      });
    }

    if (!providerContract) {
      issues.push({
        field: `mounts.${mount.id}.sourceContract.providerContract`,
        reason: 'mount_provider_contract_missing',
        value: null,
        normalizedValue: descriptor.providerContract || null,
        descriptorKind: mount.kind
      });
    } else {
      const expectedServiceId = PROVIDER_SERVICE_BY_SOURCE_KIND[sourceContract.sourceKind];
      const expectedSyncMode = PROVIDER_SYNC_MODE_BY_MOUNT_KIND[mount.kind] || 'incremental';
      const commandCapabilities = providerContract.commandCapabilities && typeof providerContract.commandCapabilities === 'object'
        ? providerContract.commandCapabilities
        : {};
      const missingProviderCommands = descriptor.commandPolicy.supportedCommands
        .filter((command) => !commandCapabilities[command]);
      const descriptorGapCommands = Object.entries(commandCapabilities)
        .filter(([, contract]) => contract?.status === 'descriptor_gap')
        .map(([command]) => command);

      if (providerContract.serviceId !== expectedServiceId) {
        issues.push({
          field: `mounts.${mount.id}.sourceContract.providerContract.serviceId`,
          reason: 'mount_provider_service_mismatch',
          value: providerContract.serviceId,
          normalizedValue: expectedServiceId,
          descriptorKind: mount.kind
        });
      }
      if (providerContract.syncMetadata?.mode !== expectedSyncMode) {
        issues.push({
          field: `mounts.${mount.id}.sourceContract.providerContract.syncMetadata.mode`,
          reason: 'mount_provider_sync_mode_mismatch',
          value: providerContract.syncMetadata?.mode,
          normalizedValue: expectedSyncMode,
          descriptorKind: mount.kind
        });
      }
      if (missingProviderCommands.length) {
        issues.push({
          field: `mounts.${mount.id}.sourceContract.providerContract.commandCapabilities`,
          reason: 'mount_provider_command_capabilities_missing',
          value: missingProviderCommands,
          normalizedValue: descriptor.commandPolicy.supportedCommands,
          descriptorKind: mount.kind
        });
      }
      if (descriptorGapCommands.length) {
        issues.push({
          field: `mounts.${mount.id}.sourceContract.providerContract.commandCapabilities`,
          reason: 'mount_provider_capability_descriptor_gap',
          value: descriptorGapCommands,
          normalizedValue: descriptor.commandPolicy.requiredCapabilities,
          descriptorKind: mount.kind
        });
      }
    }

    if (!descriptorCommandPolicy || !Array.isArray(descriptorCommandPolicy.supportedCommands)) {
      issues.push({
        field: `mounts.${mount.id}.descriptor.commandPolicy`,
        reason: 'descriptor_command_policy_missing',
        value: descriptorCommandPolicy,
        normalizedValue: descriptor.commandPolicy,
        descriptorKind: mount.kind
      });
    } else {
      const unsupportedCommands = descriptorCommandPolicy.supportedCommands.filter((entry) => !ALLOWED_COMMANDS.has(entry));
      const missingCatalogCommands = descriptor.commandPolicy.supportedCommands
        .filter((entry) => !descriptorCommandPolicy.supportedCommands.includes(entry));
      if (unsupportedCommands.length) {
        issues.push({
          field: `mounts.${mount.id}.descriptor.commandPolicy.supportedCommands`,
          reason: 'descriptor_command_policy_contains_unknown_command',
          value: unsupportedCommands,
          normalizedValue: descriptor.commandPolicy.supportedCommands,
          descriptorKind: mount.kind
        });
      }
      if (missingCatalogCommands.length) {
        issues.push({
          field: `mounts.${mount.id}.descriptor.commandPolicy.supportedCommands`,
          reason: 'descriptor_command_policy_differs_from_catalog',
          value: descriptorCommandPolicy.supportedCommands,
          normalizedValue: descriptor.commandPolicy.supportedCommands,
          descriptorKind: mount.kind
        });
      }
    }
  }

  return issues;
}

function buildValidationSummary({ mounts, lifecycle, principal, command, boundaryContract, memoryMountDescriptors }) {
  const rejectionCounts = mounts.rejected.reduce((counts, entry) => {
    const reason = entry.reason || 'unknown_rejection';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const lifecycleIssueCounts = lifecycle.validationIssues.reduce((counts, entry) => {
    const reason = entry.reason || 'unknown_lifecycle_issue';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const sourceIssueCounts = mounts.accepted
    .flatMap((mount) => Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [])
    .reduce((counts, entry) => {
      const reason = entry.reason || 'unknown_source_issue';
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {});
  const descriptorValidationIssues = buildDescriptorValidationIssues({ mounts, memoryMountDescriptors });
  const descriptorIssueCounts = descriptorValidationIssues.reduce((counts, entry) => {
    const reason = entry.reason || 'unknown_descriptor_issue';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const sourceContracts = mounts.accepted.map((mount) => ({
    mountId: mount.id,
    descriptor: {
      kind: mount.descriptor?.kind || mount.kind,
      label: mount.descriptor?.label || mount.kind,
      scopeKind: mount.descriptor?.scopeKind || null,
      defaultScopeKind: mount.descriptor?.defaultScopeKind || null,
      durability: mount.descriptor?.durability || null,
      lifecycle: mount.descriptor?.lifecycle || null,
      commandPolicy: mount.descriptor?.commandPolicy || null,
      retentionPolicy: mount.descriptor?.retentionPolicy || null,
      ttlMinutes: mount.descriptor?.ttlMinutes || null,
      defaultSourceKind: mount.descriptor?.defaultSourceKind || null,
      sourceBindingStatus: mount.descriptor?.sourceBindingStatus || null,
      descriptorStatus: mount.descriptor?.descriptorStatus || null,
      repairIssueCount: Array.isArray(mount.descriptor?.repairIssues) ? mount.descriptor.repairIssues.length : 0,
      repairProof: mount.descriptor?.repairProof || null,
      proof: mount.descriptor?.proof || null
      },
      descriptorSourceBinding: mount.sourceContract.descriptorSourceBinding || null,
      descriptorCommandBoundary: mount.boundary?.descriptorCommandBoundary || null,
      providerContract: mount.sourceContract.providerContract
        ? {
            serviceId: mount.sourceContract.providerContract.serviceId,
            negotiationStatus: mount.sourceContract.providerContract.negotiationStatus,
            syncMode: mount.sourceContract.providerContract.syncMetadata?.mode || null,
            syncCursor: mount.sourceContract.providerContract.syncMetadata?.cursor || null,
            externalHandoff: mount.sourceContract.providerContract.externalHandoff || null,
            proof: mount.sourceContract.providerContract.proof || null
          }
        : null,
      scopeContract: mount.sourceContract.scopeContract || null,
    sourceFreshness: mount.sourceContract.sourceFreshness || null,
    canonicalScope: mount.sourceContract.canonicalScope || mount.scope,
    retention: mount.sourceContract.retention || null,
    sourceKind: mount.sourceContract.sourceKind,
    uri: mount.sourceContract.uri,
    accessMode: mount.sourceContract.accessMode,
    consistency: mount.sourceContract.consistency,
    proof: mount.sourceContract.proof
  }));
  const requiredPermission = COMMAND_PERMISSION[command.type] || 'memory:read';

  return {
    status: mounts.blocked
      ? 'blocked'
      : (mounts.rejected.length || lifecycle.validationIssues.length || Object.keys(sourceIssueCounts).length || Object.keys(descriptorIssueCounts).length ? 'review' : 'clean'),
    requiredPermission,
    permissionSatisfied: principal.permissions.includes(requiredPermission),
    descriptorCoverage: memoryMountDescriptors?.requiredCoverage || {
      schemaVersion: 1,
      status: 'unknown',
      requiredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS,
      coveredKinds: [],
      missingKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS,
      sourceMismatches: [],
      proof: proofToken({ status: 'unknown', requiredKinds: REQUIRED_DESCRIPTOR_MOUNT_KINDS })
    },
    boundaryContract: boundaryContract || {
      schemaVersion: 1,
      commandId: command.commandId,
      commandType: command.type,
      requiredPermission,
      acceptedScopes: [],
      rejectedScopes: [],
      proof: proofToken({
        commandId: command.commandId,
        commandType: command.type,
        requiredPermission,
        status: 'not_available'
      })
    },
    scopeSummary: {
      acceptedByIsolation: countBy(boundaryContract?.acceptedScopes || [], (entry) => entry.isolation),
      acceptedByScopeKind: countBy(boundaryContract?.acceptedScopes || [], (entry) => entry.scopeKind),
      rejectedByReason: countBy(boundaryContract?.rejectedScopes || [], (entry) => entry.reason),
      proof: proofToken({
        acceptedScopes: boundaryContract?.acceptedScopes || [],
        rejectedScopes: boundaryContract?.rejectedScopes || []
      })
    },
    rejectionCounts,
    lifecycleIssueCounts,
    sourceIssueCounts,
    descriptorIssueCounts,
    descriptorValidationIssues,
    acceptedMountIds: mounts.accepted.map((mount) => mount.id),
    rejectedMountIds: mounts.rejected.filter((entry) => entry.id).map((entry) => entry.id),
    writableMountIds: mounts.accepted.filter((mount) => mount.writable).map((mount) => mount.id),
    sourceContracts,
    messages: [
      principal.permissions.includes(requiredPermission)
        ? `Command ${command.type} has ${requiredPermission}.`
        : `Command ${command.type} needs ${requiredPermission}.`,
      mounts.accepted.length
        ? `${mounts.accepted.length} memory mount${mounts.accepted.length === 1 ? '' : 's'} ready for this workspace.`
        : 'No memory mounts are ready for this workspace.',
      lifecycle.validationIssues.length
        ? `${lifecycle.validationIssues.length} lifecycle setting${lifecycle.validationIssues.length === 1 ? '' : 's'} normalized.`
        : 'Lifecycle settings are valid.',
      Object.keys(sourceIssueCounts).length
        ? `${Object.values(sourceIssueCounts).reduce((total, count) => total + count, 0)} memory source contract issue${Object.values(sourceIssueCounts).reduce((total, count) => total + count, 0) === 1 ? '' : 's'} normalized.`
        : 'Memory source contracts are valid.',
      Object.keys(descriptorIssueCounts).length
        ? `${Object.values(descriptorIssueCounts).reduce((total, count) => total + count, 0)} memory descriptor issue${Object.values(descriptorIssueCounts).reduce((total, count) => total + count, 0) === 1 ? '' : 's'} needs review.`
        : `Memory descriptor catalog covers ${REQUIRED_DESCRIPTOR_MOUNT_KINDS.join(', ')}.`
    ]
  };
}

function normalizeOperationalHealthInput(input) {
  const health = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : (input.health && typeof input.health === 'object' ? input.health : {});
  return {
    consecutiveFailures: normalizeInteger(health.consecutiveFailures, 0, 0, MAX_HEALTH_FAILURES),
    lastFailureAt: normalizeIsoString(health.lastFailureAt),
    lastSuccessAt: normalizeIsoString(health.lastSuccessAt),
    suppressedUntil: normalizeIsoString(health.suppressedUntil),
    degradedMode: normalizeBoolean(health.degradedMode, false),
    operatorNote: typeof health.operatorNote === 'string' && health.operatorNote.trim()
      ? health.operatorNote.trim().slice(0, 240)
      : null
  };
}

function normalizeProviderFailureEntry(entry, index, now) {
  const failure = entry && typeof entry === 'object' ? entry : {};
  const requestedStatus = normalizeNonEmptyString(failure.status ?? failure.state, 'degraded');
  const status = ALLOWED_PROVIDER_HEALTH_STATES.has(requestedStatus) ? requestedStatus : 'degraded';
  const sourceKind = ALLOWED_SOURCE_KINDS.has(failure.sourceKind) ? failure.sourceKind : null;
  const since = normalizeIsoString(failure.since ?? failure.firstSeenAt) || now;
  const lastSeenAt = normalizeIsoString(failure.lastSeenAt) || since;
  const retryAfterSeconds = normalizeInteger(failure.retryAfterSeconds, 0, 0, MAX_RETRY_DELAY_SECONDS);
  const retryAfter = normalizeIsoString(failure.retryAfter)
    || (retryAfterSeconds > 0 ? addSecondsToIso(now, retryAfterSeconds) : null);

  return {
    failureId: normalizeNonEmptyString(failure.failureId, proofToken({ index, failure, now })),
    status,
    code: normalizeNonEmptyString(failure.code ?? failure.reason, `provider_${status}`),
    serviceId: normalizeNonEmptyString(failure.serviceId, sourceKind ? PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind] : 'aios.memory-provider'),
    mountId: typeof failure.mountId === 'string' && failure.mountId.trim() ? failure.mountId.trim() : null,
    sourceKind,
    retryable: normalizeBoolean(failure.retryable, status !== 'unavailable'),
    since,
    lastSeenAt,
    retryAfter,
    operatorAction: normalizeNonEmptyString(failure.operatorAction, status === 'throttled' ? 'wait_for_provider_retry_window' : 'inspect_provider_health'),
    message: normalizeNonEmptyString(failure.message, `Provider reported ${status}.`).slice(0, 220)
  };
}

function normalizeProviderHealthInput(input, now) {
  const provider = input.providerContract && typeof input.providerContract === 'object'
    ? input.providerContract
    : (input.provider && typeof input.provider === 'object' ? input.provider : {});
  const health = provider.health && typeof provider.health === 'object'
    ? provider.health
    : (input.providerHealth && typeof input.providerHealth === 'object' ? input.providerHealth : {});
  const requestedStatus = normalizeNonEmptyString(health.status ?? health.state, 'healthy');
  const status = ALLOWED_PROVIDER_HEALTH_STATES.has(requestedStatus) ? requestedStatus : 'degraded';
  const serviceStatuses = Array.isArray(health.services)
    ? health.services
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, MAX_PROVIDER_FAILURES)
        .map((entry, index) => normalizeProviderFailureEntry({
          ...entry,
          code: entry.code ?? `${entry.sourceKind || 'provider'}_${entry.status || entry.state || 'degraded'}`
        }, index, now))
    : [];
  const reportedFailures = [
    ...serviceStatuses.filter((entry) => entry.status !== 'healthy'),
    ...(Array.isArray(health.failures)
      ? health.failures
          .filter((entry) => entry && typeof entry === 'object')
          .slice(0, MAX_PROVIDER_FAILURES)
          .map((entry, index) => normalizeProviderFailureEntry(entry, index + serviceStatuses.length, now))
      : [])
  ].slice(0, MAX_PROVIDER_FAILURES);
  const failures = reportedFailures.length || status === 'healthy'
    ? reportedFailures
    : [normalizeProviderFailureEntry({
        status,
        code: `provider_${status}`,
        serviceId: normalizeNonEmptyString(provider.serviceId, 'aios.memory-manager.memory-mount'),
        retryable: status !== 'unavailable',
        operatorAction: status === 'throttled' ? 'wait_for_provider_retry_window' : 'inspect_provider_health',
        message: `Provider reported ${status} without a source-specific failure.`
      }, serviceStatuses.length, now)];
  const suppressedUntil = normalizeIsoString(health.suppressedUntil);

  return {
    status: failures.length && status === 'healthy' ? 'degraded' : status,
    providerId: normalizeNonEmptyString(provider.providerId, 'hosted-kernel-memory-provider'),
    checkedAt: normalizeIsoString(health.checkedAt) || now,
    suppressedUntil,
    suppressed: suppressedUntil ? isFutureIso(suppressedUntil, now) : false,
    failures,
    failureSourceKinds: [...new Set(failures.map((failure) => failure.sourceKind).filter(Boolean))].sort(),
    unavailableSourceKinds: [...new Set(failures
      .filter((failure) => failure.status === 'unavailable')
      .map((failure) => failure.sourceKind)
      .filter(Boolean))].sort(),
    proof: proofToken({
      status,
      providerId: provider.providerId,
      checkedAt: health.checkedAt,
      suppressedUntil,
      failures
    })
  };
}

function buildOperationalHealthError({ reason, severity, routeHint, targetMountId = null, retryable = false, userMessage, detail = {} }) {
  return {
    code: `memory_mount_${reason}`,
    reason,
    severity,
    targetMountId,
    routeHint,
    retryable,
    userMessage,
    detail,
    proof: proofToken({ reason, severity, routeHint, targetMountId, retryable, detail })
  };
}

function secondsSinceIso(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) {
    return null;
  }
  return Math.max(0, Math.floor((nowTimestamp - timestamp) / 1000));
}

function getMountProviderFailure({ mount, providerFailuresForActiveMounts }) {
  return providerFailuresForActiveMounts.find((failure) =>
    failure.mountId === mount.id
    || (failure.sourceKind && failure.sourceKind === mount.sourceContract?.sourceKind)
    || (!failure.mountId && !failure.sourceKind)
  ) || null;
}

function commandAllowedInHealthMode({ commandType, failure, suppressed, staleHealth, retryBudgetExhausted }) {
  const writeCommand = HEALTH_WRITE_COMMANDS.has(commandType);
  const blockedReasons = [];

  if (retryBudgetExhausted && failure?.retryable) {
    blockedReasons.push('retry_budget_exhausted');
  }
  if (suppressed && writeCommand) {
    blockedReasons.push('provider_health_suppressed_for_write');
  }
  if (staleHealth && writeCommand) {
    blockedReasons.push('provider_health_check_stale_for_write');
  }
  if (failure?.status === 'unavailable' && writeCommand) {
    blockedReasons.push('provider_source_unavailable_for_write');
  }
  if (failure?.status === 'throttled' && writeCommand) {
    blockedReasons.push('provider_source_throttled_for_write');
  }

  return {
    allowed: blockedReasons.length === 0,
    blockedReasons,
    mode: blockedReasons.length
      ? 'blocked'
      : (failure || staleHealth || suppressed ? (writeCommand ? 'guarded_write' : 'read_limited') : 'normal')
  };
}

function buildMountHealthCommandGuards({
  request,
  command,
  mounts,
  providerHealth,
  providerFailuresForActiveMounts,
  retryBudget,
  nextRetryAt,
  now
}) {
  const checkedAgeSeconds = secondsSinceIso(providerHealth.checkedAt, now);
  const staleHealth = checkedAgeSeconds !== null && checkedAgeSeconds > HEALTH_STALE_AFTER_SECONDS;
  const retryBudgetExhausted = retryBudget.exhausted === true;

  return mounts.accepted.map((mount) => {
    const policy = mount.descriptor?.commandPolicy || buildDescriptorCommandContract(mount.kind);
    const supportedCommands = Array.isArray(policy.supportedCommands) ? policy.supportedCommands : [];
    const failure = getMountProviderFailure({ mount, providerFailuresForActiveMounts });
    const commandStates = supportedCommands.map((commandType) => {
      const requiredCapabilities = mount.sourceContract?.providerContract?.commandCapabilities?.[commandType]?.requiredCapabilities
        || REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[commandType]
        || ['mount:read'];
      const healthMode = commandAllowedInHealthMode({
        commandType,
        failure,
        suppressed: providerHealth.suppressed,
        staleHealth,
        retryBudgetExhausted
      });
      const writeCommand = HEALTH_WRITE_COMMANDS.has(commandType);
      const state = {
        commandType,
        allowed: healthMode.allowed,
        mode: healthMode.mode,
        writeCommand,
        requiredCapabilities,
        blockedReasons: healthMode.blockedReasons,
        retryable: Boolean(!healthMode.allowed && failure?.retryable && !providerHealth.suppressed && !retryBudgetExhausted),
        retryAfter: !healthMode.allowed && failure?.retryable ? (failure.retryAfter || nextRetryAt) : null,
        route: `${request.route}/mounts/${mount.id}/commands/${commandType}`,
        operatorAction: healthMode.allowed
          ? 'continue_memory_mount_command'
          : (failure?.operatorAction || (staleHealth ? 'refresh_provider_health' : 'review_memory_mount_health'))
      };
      return {
        ...state,
        proof: proofToken({
          mountId: mount.id,
          commandType,
          failureId: failure?.failureId || null,
          providerHealthProof: providerHealth.proof,
          staleHealth,
          retryBudgetProof: retryBudget.proof,
          state
        })
      };
    });
    const currentCommand = commandStates.find((state) => state.commandType === command.type) || null;
    const effectiveCurrentCommand = currentCommand || {
      commandType: command.type,
      allowed: false,
      mode: 'blocked',
      writeCommand: HEALTH_WRITE_COMMANDS.has(command.type),
      requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[command.type] || ['mount:read'],
      blockedReasons: ['descriptor_command_not_supported'],
      retryable: false,
      retryAfter: null,
      route: `${request.route}/mounts/${mount.id}/commands/${command.type}`,
      operatorAction: 'choose_supported_memory_command',
      proof: proofToken({ mountId: mount.id, commandType: command.type, reason: 'descriptor_command_not_supported' })
    };
    const fallbackCommand = commandStates.find((state) => state.allowed && state.commandType === 'select')
      || commandStates.find((state) => state.allowed && state.commandType === 'refresh')
      || commandStates.find((state) => state.allowed)
      || null;
    const guard = {
      schemaVersion: 1,
      mountId: mount.id,
      descriptorKind: mount.descriptor?.kind || mount.kind,
      sourceKind: mount.sourceContract?.sourceKind || null,
      providerServiceId: mount.sourceContract?.providerContract?.serviceId || null,
      providerStatus: failure?.status || providerHealth.status,
      providerFailureId: failure?.failureId || null,
      providerHealthStale: staleHealth,
      suppressed: providerHealth.suppressed,
      checkedAt: providerHealth.checkedAt,
      currentCommand: effectiveCurrentCommand,
      fallbackCommand: fallbackCommand?.commandType || null,
      commandStates,
      summary: effectiveCurrentCommand.allowed === false
        ? `Command ${command.type} is ${effectiveCurrentCommand.mode} for ${mount.id}.`
        : `Command ${command.type} can proceed for ${mount.id} with ${failure ? 'provider guardrails' : 'normal provider health'}.`
    };
    return {
      ...guard,
      proof: proofToken({
        mountId: mount.id,
        commandId: command.commandId,
        providerFailureId: failure?.failureId || null,
        currentCommandProof: guard.currentCommand.proof,
        fallbackCommand: guard.fallbackCommand,
        commandStateProofs: commandStates.map((state) => state.proof)
      })
    };
  });
}

function buildHealthIncidentPlan({
  request,
  command,
  mounts,
  providerHealth,
  providerFailuresForActiveMounts,
  errors,
  consecutiveFailures,
  retryable,
  backoffSeconds,
  nextRetryAt,
  now
}) {
  const commandRequiresWrite = HEALTH_WRITE_COMMANDS.has(command.type);
  const checkedAgeSeconds = secondsSinceIso(providerHealth.checkedAt, now);
  const staleHealth = checkedAgeSeconds !== null && checkedAgeSeconds > HEALTH_STALE_AFTER_SECONDS;
  const unavailableFailures = providerFailuresForActiveMounts.filter((failure) => failure.status === 'unavailable');
  const throttledFailures = providerFailuresForActiveMounts.filter((failure) => failure.status === 'throttled');
  const staleFailures = providerFailuresForActiveMounts.filter((failure) => failure.status === 'stale');
  const affectedMountIds = [...new Set(providerFailuresForActiveMounts
    .map((failure) => failure.mountId
      || mounts.accepted.find((mount) => mount.sourceContract?.sourceKind === failure.sourceKind)?.id
      || null)
    .filter(Boolean))].sort();
  const affectedSourceKinds = [...new Set(providerFailuresForActiveMounts
    .map((failure) => failure.sourceKind)
    .filter(Boolean))].sort();
  const blockedWriteReasons = [
    ...errors.filter((error) => error.severity === 'critical').map((error) => error.reason),
    ...(commandRequiresWrite && unavailableFailures.length ? ['provider_source_unavailable_for_write'] : []),
    ...(staleHealth && commandRequiresWrite ? ['provider_health_check_stale_for_write'] : [])
  ];
  const degradedReadOnly = providerFailuresForActiveMounts.length > 0
    || staleHealth
    || errors.some((error) => error.severity === 'warning');
  const writePolicy = {
    commandType: command.type,
    writeCommand: commandRequiresWrite,
    allowed: blockedWriteReasons.length === 0,
    mode: blockedWriteReasons.length
      ? 'blocked'
      : (degradedReadOnly && commandRequiresWrite ? 'degraded_write_with_retry_guard' : (degradedReadOnly ? 'read_limited' : 'normal')),
    blockedReasons: blockedWriteReasons,
    affectedMountIds,
    affectedSourceKinds,
    proof: proofToken({
      commandId: command.commandId,
      commandType: command.type,
      commandRequiresWrite,
      blockedWriteReasons,
      affectedMountIds,
      affectedSourceKinds
    })
  };
  const incidents = [
    ...providerFailuresForActiveMounts.map((failure) => ({
      incidentId: proofToken({ failureId: failure.failureId, commandId: command.commandId, route: request.route }),
      source: 'provider',
      status: failure.status,
      severity: failure.status === 'unavailable' && commandRequiresWrite ? 'critical' : 'warning',
      code: failure.code,
      mountId: failure.mountId
        || mounts.accepted.find((mount) => mount.sourceContract?.sourceKind === failure.sourceKind)?.id
        || null,
      sourceKind: failure.sourceKind,
      serviceId: failure.serviceId,
      retryable: failure.retryable && retryable,
      retryAfter: failure.retryAfter || nextRetryAt,
      operatorAction: failure.operatorAction,
      route: `${request.route}/provider/health`,
      proof: proofToken({
        failureId: failure.failureId,
        status: failure.status,
        commandId: command.commandId,
        retryAfter: failure.retryAfter || nextRetryAt
      })
    })),
    ...errors
      .filter((error) => error.severity === 'critical' || error.severity === 'warning')
      .map((error) => ({
        incidentId: proofToken({ errorProof: error.proof, commandId: command.commandId }),
        source: 'memory-mount',
        status: error.reason,
        severity: error.severity,
        code: error.code,
        mountId: error.targetMountId,
        sourceKind: error.detail?.sourceKind || null,
        serviceId: error.detail?.serviceId || null,
        retryable: error.retryable,
        retryAfter: error.retryable ? nextRetryAt : null,
        operatorAction: error.retryable ? 'retry_after_repair_or_backoff' : 'repair_configuration_before_retry',
        route: error.routeHint,
        proof: error.proof
      }))
  ].slice(0, MAX_PROVIDER_FAILURES + MAX_HEALTH_FAILURES);
  const repairSteps = [];

  if (staleHealth) {
    repairSteps.push({
      type: 'refresh_provider_health',
      route: `${request.route}/provider/health`,
      label: 'Refresh hosted memory provider health',
      reason: 'provider_health_check_stale',
      retryable: true
    });
  }
  if (unavailableFailures.length) {
    repairSteps.push({
      type: 'repair_provider_source',
      route: `${request.route}/provider/health`,
      label: 'Repair unavailable hosted memory source',
      reason: 'provider_source_unavailable',
      retryable: false,
      sourceKinds: [...new Set(unavailableFailures.map((failure) => failure.sourceKind).filter(Boolean))].sort()
    });
  }
  if (throttledFailures.length || retryable) {
    repairSteps.push({
      type: 'retry_after_backoff',
      route: `${request.route}/health/retry`,
      label: 'Retry memory mount after backoff',
      reason: throttledFailures.length ? 'provider_throttled' : 'retryable_health_error',
      retryable: true,
      retryAfter: nextRetryAt,
      backoffSeconds
    });
  }
  if (staleFailures.length) {
    repairSteps.push({
      type: 'resync_stale_sources',
      route: `${request.route}/provider/sync`,
      label: 'Resync stale memory sources',
      reason: 'provider_source_stale',
      retryable: true,
      sourceKinds: [...new Set(staleFailures.map((failure) => failure.sourceKind).filter(Boolean))].sort()
    });
  }
  if (!repairSteps.length && errors.length) {
    repairSteps.push({
      type: 'review_memory_mount_errors',
      route: errors[0].routeHint,
      label: 'Review memory mount errors',
      reason: errors[0].reason,
      retryable: errors.some((error) => error.retryable)
    });
  }

  const retryBudget = {
    attemptsUsed: consecutiveFailures,
    attemptsRemaining: Math.max(0, MAX_RETRY_ATTEMPTS - consecutiveFailures),
    exhausted: consecutiveFailures >= MAX_RETRY_ATTEMPTS,
    nextRetryAt,
    backoffSeconds,
    proof: proofToken({
      consecutiveFailures,
      retryable,
      backoffSeconds,
      nextRetryAt
    })
  };

  return {
    schemaVersion: 1,
    status: blockedWriteReasons.length ? 'write_blocked' : (incidents.length ? 'attention_required' : 'clear'),
    checkedAt: now,
    providerCheckedAt: providerHealth.checkedAt,
    providerCheckAgeSeconds: checkedAgeSeconds,
    providerHealthStale: staleHealth,
    degradedReadOnly,
    writePolicy,
    retryBudget,
    incidents,
    repairSteps: repairSteps.map((step) => ({
      ...step,
      proof: proofToken({ commandId: command.commandId, step, retryBudget })
    })),
    proof: proofToken({
      commandId: command.commandId,
      providerHealthProof: providerHealth.proof,
      writePolicyProof: writePolicy.proof,
      retryBudgetProof: retryBudget.proof,
      incidentProofs: incidents.map((incident) => incident.proof)
    })
  };
}

function buildOperationalHealth({ input, request, command, mounts, lifecycle, recovery, validationSummary, now }) {
  const priorHealth = normalizeOperationalHealthInput(input);
  const providerHealth = normalizeProviderHealthInput(input, now);
  const sourceIssues = mounts.accepted.flatMap((mount) =>
    (Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : []).map((issue) => ({
      mountId: mount.id,
      ...issue
    }))
  );
  const blockingRejection = mounts.rejected.find((entry) => entry.reason === 'command_permission_denied')
    || mounts.rejected.find((entry) => entry.reason === 'lifecycle_disabled')
    || null;
  const mountRejection = mounts.rejected.find((entry) => entry.reason !== 'command_permission_denied' && entry.reason !== 'lifecycle_disabled') || null;
  const errors = [];
  const activeSourceKinds = [...new Set(mounts.accepted.map((mount) => mount.sourceContract?.sourceKind).filter(Boolean))].sort();
  const commandRequiresProviderWrite = HEALTH_WRITE_COMMANDS.has(command.type);
  const providerFailuresForActiveMounts = providerHealth.failures.filter((failure) =>
    !failure.sourceKind || activeSourceKinds.includes(failure.sourceKind)
  );

  if (blockingRejection?.reason === 'command_permission_denied') {
    errors.push(buildOperationalHealthError({
      reason: 'command_permission_denied',
      severity: 'critical',
      routeHint: 'principal.permissions',
      targetMountId: command.mountId,
      retryable: false,
      userMessage: `Grant ${blockingRejection.requiredPermission || COMMAND_PERMISSION[command.type] || 'memory:read'} before retrying ${command.type}.`,
      detail: {
        commandId: command.commandId,
        commandType: command.type,
        requiredPermission: blockingRejection.requiredPermission || COMMAND_PERMISSION[command.type] || 'memory:read'
      }
    }));
  }

  if (blockingRejection?.reason === 'lifecycle_disabled') {
    errors.push(buildOperationalHealthError({
      reason: 'lifecycle_disabled',
      severity: 'critical',
      routeHint: 'settings.lifecycle.enabled',
      targetMountId: command.mountId,
      retryable: false,
      userMessage: 'Enable memory mount lifecycle before retrying this command.',
      detail: { commandId: command.commandId, commandType: command.type }
    }));
  }

  if (!mounts.accepted.length) {
    errors.push(buildOperationalHealthError({
      reason: 'no_mounts_available',
      severity: 'warning',
      routeHint: 'memory-manager.mounts',
      retryable: command.type === 'recover',
      userMessage: 'Attach or recover at least one memory scope before continuing.',
      detail: { rejectedCount: mounts.rejected.length, recoveryStatus: recovery.status }
    }));
  }

  if (mountRejection) {
    errors.push(buildOperationalHealthError({
      reason: mountRejection.reason || 'mount_validation_failed',
      severity: mounts.accepted.length ? 'warning' : 'critical',
      routeHint: 'memory-manager.validation',
      targetMountId: mountRejection.id || command.mountId,
      retryable: true,
      userMessage: 'Review rejected memory mount input and retry after correcting the mount contract.',
      detail: mountRejection
    }));
  }

  if (sourceIssues.length) {
    errors.push(buildOperationalHealthError({
      reason: 'source_contract_normalized',
      severity: 'warning',
      routeHint: 'memory-manager.preview.validation',
      targetMountId: sourceIssues[0].mountId,
      retryable: true,
      userMessage: 'Review normalized source contract fields before trusting this memory mount.',
      detail: {
        issueCount: sourceIssues.length,
        reasons: [...new Set(sourceIssues.map((issue) => issue.reason || 'unknown_source_issue'))].sort()
      }
    }));
  }

  for (const failure of providerFailuresForActiveMounts) {
    const affectedMount = failure.mountId
      ? mounts.accepted.find((mount) => mount.id === failure.mountId) || null
      : mounts.accepted.find((mount) => mount.sourceContract?.sourceKind === failure.sourceKind) || null;
    const severity = failure.status === 'unavailable' && (commandRequiresProviderWrite || failure.mountId === command.mountId)
      ? 'critical'
      : (failure.status === 'throttled' || failure.status === 'stale' ? 'warning' : 'warning');
    errors.push(buildOperationalHealthError({
      reason: `provider_${failure.status}`,
      severity,
      routeHint: `${request.route}/provider/health`,
      targetMountId: affectedMount?.id || failure.mountId || command.mountId,
      retryable: failure.retryable && !providerHealth.suppressed,
      userMessage: failure.status === 'unavailable'
        ? 'Hosted memory provider is unavailable for this source; repair the provider before writing memory state.'
        : 'Hosted memory provider is degraded; continue in read-limited mode or retry after the provider window.',
      detail: {
        failureId: failure.failureId,
        providerId: providerHealth.providerId,
        serviceId: failure.serviceId,
        sourceKind: failure.sourceKind,
        status: failure.status,
        code: failure.code,
        retryAfter: failure.retryAfter,
        operatorAction: failure.operatorAction,
        suppressed: providerHealth.suppressed,
        providerHealthProof: providerHealth.proof
      }
    }));
  }

  if (lifecycle.validationIssues.length) {
    errors.push(buildOperationalHealthError({
      reason: 'lifecycle_settings_normalized',
      severity: 'info',
      routeHint: 'settings.lifecycle',
      retryable: true,
      userMessage: 'Lifecycle settings were normalized; review scheduling before relying on automatic refresh.',
      detail: {
        issueCount: lifecycle.validationIssues.length,
        reasons: [...new Set(lifecycle.validationIssues.map((issue) => issue.reason || 'unknown_lifecycle_issue'))].sort()
      }
    }));
  }

  if (!recovery.restartSafe) {
    errors.push(buildOperationalHealthError({
      reason: recovery.restartStatus?.reason || 'restart_state_incomplete',
      severity: recovery.restartStatus?.level === 'blocked' ? 'critical' : 'warning',
      routeHint: recovery.restartStatus?.resumeCommand === 'recover' ? 'memory-manager.recovery' : 'memory-manager.validation',
      targetMountId: recovery.activeMountId,
      retryable: recovery.restartStatus?.resumeCommand === 'recover',
      userMessage: 'Memory mount state is not restart-safe; recover or repair before depending on persisted state.',
      detail: {
        recoveryStatus: recovery.status,
        restartLevel: recovery.restartStatus?.level || 'unknown',
        resumeCommand: recovery.restartStatus?.resumeCommand || null
      }
    }));
  }

  const criticalError = errors.find((error) => error.severity === 'critical') || null;
  const retryable = !criticalError && errors.some((error) => error.retryable);
  const hasFailure = errors.length > 0 || validationSummary.status !== 'clean';
  const consecutiveFailures = hasFailure
    ? Math.min(MAX_HEALTH_FAILURES, priorHealth.consecutiveFailures + 1)
    : 0;
  const backoffSeconds = retryable
    ? Math.max(
        providerFailuresForActiveMounts
          .map((failure) => failure.retryAfter ? Math.ceil((Date.parse(failure.retryAfter) - Date.parse(now)) / 1000) : 0)
          .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
          .reduce((max, seconds) => Math.max(max, seconds), 0),
        Math.min(MAX_RETRY_DELAY_SECONDS, BASE_RETRY_DELAY_SECONDS * 2 ** Math.min(consecutiveFailures, MAX_RETRY_ATTEMPTS))
      )
    : 0;
  const degradedMode = priorHealth.degradedMode
    || providerHealth.status !== 'healthy'
    || providerFailuresForActiveMounts.length > 0
    || errors.some((error) => ['critical', 'warning'].includes(error.severity))
    || recovery.restartStatus?.level === 'needs_recovery';
  const status = criticalError
    ? 'blocked'
    : (degradedMode ? 'degraded' : (retryable ? 'retrying' : 'healthy'));
  const nextRetryAt = retryable ? addSecondsToIso(now, backoffSeconds) : null;
  const nextAction = criticalError
    ? (criticalError.reason === 'command_permission_denied' ? 'request_permission' : 'repair_memory_mount')
    : (retryable ? 'retry_with_backoff' : (providerFailuresForActiveMounts.length ? 'continue_read_limited' : (degradedMode ? 'review_degraded_mode' : 'continue_memory_workflow')));
  const incidentPlan = buildHealthIncidentPlan({
    request,
    command,
    mounts,
    providerHealth,
    providerFailuresForActiveMounts,
    errors,
    consecutiveFailures,
    retryable,
    backoffSeconds,
    nextRetryAt,
    now
  });
  const mountCommandGuards = buildMountHealthCommandGuards({
    request,
    command,
    mounts,
    providerHealth,
    providerFailuresForActiveMounts,
    retryBudget: incidentPlan.retryBudget,
    nextRetryAt,
    now
  });

  return {
    status,
    degradedMode,
    retryable,
    consecutiveFailures,
    lastFailureAt: hasFailure ? now : priorHealth.lastFailureAt,
    lastSuccessAt: hasFailure ? priorHealth.lastSuccessAt : now,
    suppressedUntil: priorHealth.suppressedUntil,
    operatorNote: priorHealth.operatorNote,
    retryPolicy: {
      strategy: retryable ? 'exponential_backoff' : 'none',
      attemptsUsed: consecutiveFailures,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      baseDelaySeconds: BASE_RETRY_DELAY_SECONDS,
      backoffSeconds,
      nextRetryAt,
      retryCommand: retryable ? (providerFailuresForActiveMounts.length ? 'refresh' : (recovery.restartStatus?.resumeCommand || command.type)) : null
    },
    circuitBreaker: {
      open: Boolean(criticalError) || consecutiveFailures >= MAX_RETRY_ATTEMPTS,
      reason: criticalError?.reason || (consecutiveFailures >= MAX_RETRY_ATTEMPTS ? 'retry_budget_exhausted' : null),
      resetRoute: criticalError ? criticalError.routeHint : `${request.route}/health/reset`
    },
    providerHealth: {
      status: providerHealth.status,
      providerId: providerHealth.providerId,
      checkedAt: providerHealth.checkedAt,
      suppressed: providerHealth.suppressed,
      suppressedUntil: providerHealth.suppressedUntil,
      activeSourceKinds,
      failureSourceKinds: providerHealth.failureSourceKinds,
      unavailableSourceKinds: providerHealth.unavailableSourceKinds,
      activeFailureCount: providerFailuresForActiveMounts.length,
      failures: providerFailuresForActiveMounts,
      degradedReadOnly: providerFailuresForActiveMounts.length > 0 && !criticalError,
      proof: providerHealth.proof
    },
    nextAction,
    incidentPlan,
    writePolicy: incidentPlan.writePolicy,
    retryBudget: incidentPlan.retryBudget,
    mountCommandGuards,
    commandGuardSummary: {
      guardedMountCount: mountCommandGuards.filter((guard) => guard.currentCommand.mode !== 'normal').length,
      blockedMountCount: mountCommandGuards.filter((guard) => guard.currentCommand.allowed === false).length,
      fallbackCommands: countBy(mountCommandGuards, (guard) => guard.fallbackCommand || 'none'),
      proof: proofToken({
        commandId: command.commandId,
        guardProofs: mountCommandGuards.map((guard) => guard.proof)
      })
    },
    repairSteps: incidentPlan.repairSteps,
    errors,
    proof: proofToken({
      status,
      degradedMode,
      retryable,
      consecutiveFailures,
      nextRetryAt,
      nextAction,
      incidentPlanProof: incidentPlan.proof,
      mountCommandGuardProofs: mountCommandGuards.map((guard) => guard.proof),
      providerHealthProof: providerHealth.proof,
      providerFailureIds: providerFailuresForActiveMounts.map((failure) => failure.failureId),
      errorProofs: errors.map((error) => error.proof),
      commandId: command.commandId,
      recoveryStatus: recovery.status,
      validationStatus: validationSummary.status
    })
  };
}

function buildPreviewAcceptance({ request, command, mounts, lifecycle, persistedStatePatch, recovery, nextAction, validationSummary, operationalHealth, input }) {
  const acceptance = input.acceptance && typeof input.acceptance === 'object' ? input.acceptance : {};
  const readiness = classifyReadiness({ mounts, lifecycle, recovery });
  const requiresAcceptance = ACCEPTANCE_REQUIRED_COMMANDS.has(command.type);
  const routeContracts = {
    previewRoute: `${request.route}/preview`,
    acceptanceRoute: `${request.route}/accept`,
    readinessRoute: `${request.route}/readiness`,
    validationRoute: `${request.route}/validation`,
    nextStepRoute: `${request.route}/next-step`
  };
  const validationIssueTotal = mounts.rejected.length
    + lifecycle.validationIssues.length
    + Object.values(validationSummary.sourceIssueCounts).reduce((total, count) => total + count, 0)
    + Object.values(validationSummary.descriptorIssueCounts || {}).reduce((total, count) => total + count, 0);
  const writePolicyBlocked = operationalHealth?.writePolicy?.allowed === false;
  const healthBlocked = operationalHealth && operationalHealth.status !== 'healthy';
  const activeMount = mounts.accepted.find((mount) => mount.id === recovery.activeMountId) || mounts.accepted[0] || null;
  const acceptanceToken = proofToken({
    requestId: request.requestId,
    commandId: command.commandId,
    commandType: command.type,
    mountIds: mounts.accepted.map((mount) => mount.id),
    rejectedMounts: mounts.rejected,
    lifecycleMode: lifecycle.settings.mode,
    lifecycleEnabled: lifecycle.settings.enabled,
    nextActionType: nextAction.type,
    validationStatus: validationSummary.status,
    healthStatus: operationalHealth?.status || 'unknown',
    writePolicyAllowed: operationalHealth?.writePolicy?.allowed ?? null
  });
  const tokenAccepted = typeof acceptance.token === 'string' && acceptance.token === acceptanceToken;
  const commandAccepted = acceptance.accepted === true && (
    !acceptance.commandId || acceptance.commandId === command.commandId
  );
  const accepted = !requiresAcceptance || tokenAccepted || commandAccepted;
  const mountPreviewCards = mounts.accepted.map((mount) => {
    const sourceContract = mount.sourceContract || {};
    const validationIssues = Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [];
    const healthGuard = operationalHealth.mountCommandGuards?.find((guard) => guard.mountId === mount.id) || null;
    const card = {
      mountId: mount.id,
      kind: mount.kind,
      requestedKind: mount.requestedKind || mount.kind,
      descriptor: {
        kind: mount.descriptor?.kind || mount.kind,
        label: mount.descriptor?.label || mount.kind,
        summary: mount.descriptor?.summary || null,
        scopeKind: mount.descriptor?.scopeKind || null,
        durability: mount.descriptor?.durability || null,
        visibility: mount.descriptor?.visibility || null,
        lifecycle: mount.descriptor?.lifecycle || null,
        commandPolicy: mount.descriptor?.commandPolicy || null,
        route: mount.descriptor?.route || null,
        defaultSourceKind: mount.descriptor?.defaultSourceKind || null,
        sourceBindingStatus: mount.descriptor?.sourceBindingStatus || null,
        proof: mount.descriptor?.proof || null
      },
      scope: mount.scope,
      canonicalScope: sourceContract.canonicalScope || mount.scope,
      scopeContract: sourceContract.scopeContract || null,
      selected: mount.id === recovery.activeMountId || mount.selected,
      access: mount.writable ? 'read_write' : 'read_only',
      sourceKind: sourceContract.sourceKind,
      sourceUri: sourceContract.uri,
      retention: sourceContract.retention || null,
      descriptorSourceBinding: sourceContract.descriptorSourceBinding || null,
      providerContract: sourceContract.providerContract
        ? {
            serviceId: sourceContract.providerContract.serviceId,
            negotiationStatus: sourceContract.providerContract.negotiationStatus,
            syncMode: sourceContract.providerContract.syncMetadata?.mode || null,
            syncCursor: sourceContract.providerContract.syncMetadata?.cursor || null,
            externalHandoff: sourceContract.providerContract.externalHandoff || null,
            proof: sourceContract.providerContract.proof || null
          }
        : null,
      sourceConsistency: sourceContract.consistency,
      boundaryIsolation: mount.boundary?.isolation || 'unknown',
      healthCommandGuard: healthGuard
        ? {
            providerStatus: healthGuard.providerStatus,
            providerFailureId: healthGuard.providerFailureId,
            providerHealthStale: healthGuard.providerHealthStale,
            currentCommand: healthGuard.currentCommand,
            fallbackCommand: healthGuard.fallbackCommand,
            summary: healthGuard.summary,
            proof: healthGuard.proof
          }
        : null,
      validationIssueCount: validationIssues.length,
      visibleStatus: healthGuard?.currentCommand?.allowed === false
        ? 'health_blocked'
        : (validationIssues.length ? 'needs_review' : (healthGuard?.currentCommand?.mode === 'normal' || !healthGuard ? 'ready' : 'degraded')),
      proof: proofToken({
        mountId: mount.id,
        descriptorProof: mount.descriptor?.proof,
        descriptorSourceBindingProof: sourceContract.descriptorSourceBinding?.proof || null,
        scopeProof: sourceContract.scopeContract?.proof || null,
        retentionProof: sourceContract.retention?.proof || null,
        sourceProof: sourceContract.proof,
        boundaryProof: mount.boundary?.proof,
        healthGuardProof: healthGuard?.proof || null,
        activeMountId: recovery.activeMountId,
        validationIssues
      })
    };
    return card;
  });
  const readinessBlockers = [
    ...(accepted ? [] : [{
      type: 'acceptance_required',
      route: routeContracts.acceptanceRoute,
      reason: 'awaiting_user_acceptance',
      severity: 'blocking'
    }]),
    ...(readiness.level === 'blocked' ? [{
      type: 'readiness_blocked',
      route: routeContracts.readinessRoute,
      reason: readiness.reason,
      severity: 'blocking'
    }] : []),
    ...(writePolicyBlocked ? [{
      type: 'write_policy_blocked',
      route: operationalHealth.writePolicy?.proof ? `${request.route}/health/write-policy` : routeContracts.readinessRoute,
      reason: operationalHealth.writePolicy?.blockedReasons?.[0] || 'write_policy_blocked',
      severity: 'blocking'
    }] : []),
    ...(validationIssueTotal ? [{
      type: 'validation_review',
      route: routeContracts.validationRoute,
      reason: validationSummary.status,
      severity: mounts.blocked ? 'blocking' : 'review'
    }] : []),
    ...(healthBlocked ? [{
      type: 'operational_health',
      route: operationalHealth.circuitBreaker?.open
        ? operationalHealth.circuitBreaker.resetRoute
        : (operationalHealth.errors?.[0]?.routeHint || routeContracts.readinessRoute),
      reason: operationalHealth.errors?.[0]?.reason || operationalHealth.status,
      severity: operationalHealth.status === 'blocked' ? 'blocking' : 'review',
      retryAfter: operationalHealth.retryPolicy?.nextRetryAt || null
    }] : [])
  ].map((blocker) => ({
    ...blocker,
    proof: proofToken({ commandId: command.commandId, blocker })
  }));
  const validationBadges = [
    {
      key: 'mounts',
      status: mounts.rejected.length ? 'review' : 'clean',
      count: mounts.rejected.length,
      route: routeContracts.validationRoute
    },
    {
      key: 'lifecycle',
      status: lifecycle.validationIssues.length ? 'review' : 'clean',
      count: lifecycle.validationIssues.length,
      route: `${request.route}/settings/lifecycle`
    },
    {
      key: 'sources',
      status: Object.keys(validationSummary.sourceIssueCounts).length ? 'review' : 'clean',
      count: Object.values(validationSummary.sourceIssueCounts).reduce((total, count) => total + count, 0),
      route: routeContracts.validationRoute
    },
    {
      key: 'descriptors',
      status: Object.keys(validationSummary.descriptorIssueCounts || {}).length ? 'review' : 'clean',
      count: Object.values(validationSummary.descriptorIssueCounts || {}).reduce((total, count) => total + count, 0),
      route: `${request.route}/descriptors`
    },
    {
      key: 'health',
      status: operationalHealth?.status || 'unknown',
      count: operationalHealth?.errors?.length || 0,
      route: `${request.route}/health`
    }
  ].map((badge) => ({
    ...badge,
    proof: proofToken({ commandId: command.commandId, badge })
  }));
  const acceptancePayload = {
    contentType: 'application/vnd.aios.memory-mount.acceptance+json',
    route: routeContracts.acceptanceRoute,
    method: 'POST',
    body: {
      requestId: request.requestId,
      commandId: command.commandId,
      commandType: command.type,
      accepted: true,
      token: acceptanceToken,
      expectedEpoch: persistedStatePatch.epoch,
      activeMountId: recovery.activeMountId,
      validationStatus: validationSummary.status,
      readinessLevel: readiness.level
    },
    proof: proofToken({
      route: routeContracts.acceptanceRoute,
      commandId: command.commandId,
      token: acceptanceToken,
      epoch: persistedStatePatch.epoch,
      validationStatus: validationSummary.status,
      readinessLevel: readiness.level
    })
  };
  const routeActions = [
    {
      key: 'open_preview',
      label: 'Open memory mount preview',
      route: routeContracts.previewRoute,
      enabled: true
    },
    {
      key: 'accept_preview',
      label: 'Accept memory mount preview',
      route: routeContracts.acceptanceRoute,
      enabled: requiresAcceptance && !accepted,
      payloadRef: acceptancePayload.proof
    },
    {
      key: 'review_validation',
      label: 'Review validation summary',
      route: routeContracts.validationRoute,
      enabled: validationSummary.status !== 'clean'
    },
    {
      key: 'continue_workflow',
      label: 'Continue memory workflow',
      route: routeContracts.nextStepRoute,
      enabled: accepted && !readinessBlockers.some((blocker) => blocker.severity === 'blocking')
    }
  ].map((action) => ({
    ...action,
    disabledReason: action.enabled ? null : (action.key === 'accept_preview' ? 'acceptance_not_required_or_already_satisfied' : 'route_action_not_ready'),
    proof: proofToken({ commandId: command.commandId, action })
  }));

  return {
    preview: {
      schemaVersion: 2,
      contentType: 'application/vnd.aios.memory-mount.preview+json',
      title: activeMount ? `Preview ${command.type} for ${activeMount.kind} memory` : `Preview ${command.type} memory mount`,
      commandId: command.commandId,
      commandType: command.type,
      targetMountId: command.mountId || activeMount?.id || null,
      activeMountIdAfterCommit: recovery.activeMountId,
      epochAfterCommit: persistedStatePatch.epoch,
      replayedCommandId: recovery.replayedCommandId,
      changedMountIds: mounts.accepted.map((mount) => mount.id),
      tombstonedMountIds: recovery.tombstonedMountIds,
      recoveredMountIds: recovery.recoveredMountIds,
      sourceContractsAfterCommit: mounts.accepted.map((mount) => ({
        mountId: mount.id,
        descriptorKind: mount.descriptor?.kind || mount.kind,
        descriptorProof: mount.descriptor?.proof || null,
        descriptorCommandPolicyProof: mount.descriptor?.commandPolicy?.proof || null,
        descriptorSupportedCommands: mount.descriptor?.commandPolicy?.supportedCommands || [],
        descriptorSourceBindingProof: mount.sourceContract.descriptorSourceBinding?.proof || null,
        sourceKind: mount.sourceContract.sourceKind,
        accessMode: mount.sourceContract.accessMode,
        canonicalScope: mount.sourceContract.canonicalScope || mount.scope,
        retentionPolicy: mount.sourceContract.retention?.policy || null,
        retentionTtlMinutes: mount.sourceContract.retention?.ttlMinutes || null,
        uri: mount.sourceContract.uri,
        providerServiceId: mount.sourceContract.providerContract?.serviceId || null,
        providerSyncMode: mount.sourceContract.providerContract?.syncMetadata?.mode || null,
        providerSyncCursor: mount.sourceContract.providerContract?.syncMetadata?.cursor || null,
        providerExternalHandoffRequired: mount.sourceContract.providerContract?.externalHandoff?.required ?? null,
        providerContractProof: mount.sourceContract.providerContract?.proof || null,
        proof: mount.sourceContract.proof
      })),
      lifecycleAfterCommit: {
        enabled: lifecycle.settings.enabled,
        mode: lifecycle.settings.mode,
        nextRunAt: lifecycle.settings.schedule.nextRunAt
      },
      mountPreviewCards,
      validationBadges,
      readinessBlockers,
      routeActions,
      userVisibleSummary: activeMount
        ? `${command.type} will make ${activeMount.kind} memory ${activeMount.id} active at epoch ${persistedStatePatch.epoch}.`
        : `${command.type} has no active memory mount to preview at epoch ${persistedStatePatch.epoch}.`,
      proof: proofToken({
        commandId: command.commandId,
        epochAfterCommit: persistedStatePatch.epoch,
        mountCardProofs: mountPreviewCards.map((card) => card.proof),
        validationBadgeProofs: validationBadges.map((badge) => badge.proof),
        blockerProofs: readinessBlockers.map((blocker) => blocker.proof),
        routeActionProofs: routeActions.map((action) => action.proof)
      })
    },
    acceptance: {
      required: requiresAcceptance,
      accepted,
      token: acceptanceToken,
      acceptedBy: tokenAccepted ? 'token' : (commandAccepted ? 'command_confirmation' : null),
      blockedReason: accepted ? null : 'awaiting_user_acceptance',
      payload: acceptancePayload,
      prompt: requiresAcceptance
        ? `Review and accept memory mount command ${command.commandId} before applying it in the client.`
        : 'No explicit acceptance is required for this read-only memory mount command.',
      proof: proofToken({
        commandId: command.commandId,
        required: requiresAcceptance,
        accepted,
        token: acceptanceToken,
        payloadProof: acceptancePayload.proof
      })
    },
    readiness: {
      ...readiness,
      accepted,
      blockerCount: readinessBlockers.filter((blocker) => blocker.severity === 'blocking').length,
      reviewCount: readinessBlockers.filter((blocker) => blocker.severity !== 'blocking').length,
      blockers: readinessBlockers,
      route: routeContracts.readinessRoute,
      proof: proofToken({
        readiness,
        accepted,
        blockerProofs: readinessBlockers.map((blocker) => blocker.proof),
        validationStatus: validationSummary.status,
        healthStatus: operationalHealth?.status || 'unknown'
      })
    },
    validationPreview: {
      status: validationSummary.status,
      issueTotal: validationIssueTotal,
      badges: validationBadges,
      acceptedMountIds: validationSummary.acceptedMountIds,
      rejectedMountIds: validationSummary.rejectedMountIds,
      sourceContracts: validationSummary.sourceContracts,
      descriptorCoverage: validationSummary.descriptorCoverage,
      descriptorValidationIssues: validationSummary.descriptorValidationIssues,
      messages: validationSummary.messages,
      route: routeContracts.validationRoute,
      proof: proofToken({
        status: validationSummary.status,
        issueTotal: validationIssueTotal,
        badgeProofs: validationBadges.map((badge) => badge.proof),
        sourceContracts: validationSummary.sourceContracts,
        descriptorCoverageProof: validationSummary.descriptorCoverage?.proof || null,
        descriptorIssues: validationSummary.descriptorValidationIssues || []
      })
    },
    routeContracts,
    routeActions,
    proof: proofToken({
      previewProof: proofToken(mountPreviewCards),
      acceptanceProof: acceptancePayload.proof,
      readinessBlockerProofs: readinessBlockers.map((blocker) => blocker.proof),
      validationBadgeProofs: validationBadges.map((badge) => badge.proof)
    })
  };
}

function buildExplainableNextSteps({ nextAction, previewAcceptance, validationSummary, operationalHealth }) {
  const steps = [];

  if (!previewAcceptance.acceptance.accepted) {
    steps.push({
      type: 'accept_preview',
      label: 'Accept memory mount preview',
      route: previewAcceptance.routeContracts.acceptanceRoute,
      token: previewAcceptance.acceptance.token,
      reason: previewAcceptance.acceptance.blockedReason
    });
  }

  if (validationSummary.status !== 'clean') {
    steps.push({
      type: 'review_validation',
      label: 'Review memory mount validation',
      route: previewAcceptance.routeContracts.validationRoute,
      reason: validationSummary.status,
      counts: {
        rejected: validationSummary.rejectedMountIds.length,
        lifecycleIssues: Object.values(validationSummary.lifecycleIssueCounts).reduce((total, count) => total + count, 0),
        sourceIssues: Object.values(validationSummary.sourceIssueCounts).reduce((total, count) => total + count, 0),
        descriptorIssues: Object.values(validationSummary.descriptorIssueCounts || {}).reduce((total, count) => total + count, 0)
      }
    });
  }

  if (operationalHealth.status !== 'healthy') {
    steps.push({
      type: operationalHealth.nextAction,
      label: operationalHealth.circuitBreaker.open ? 'Repair memory mount health' : 'Retry memory mount operation',
      route: operationalHealth.circuitBreaker.open
        ? operationalHealth.circuitBreaker.resetRoute
        : (operationalHealth.errors[0]?.routeHint || previewAcceptance.routeContracts.readinessRoute),
      reason: operationalHealth.errors[0]?.reason || operationalHealth.status,
      blocked: operationalHealth.circuitBreaker.open,
      retryAfter: operationalHealth.retryPolicy.nextRetryAt,
      errorCount: operationalHealth.errors.length
    });
  }

  for (const repairStep of operationalHealth.repairSteps || []) {
    if (!steps.some((step) => step.type === repairStep.type && step.route === repairStep.route)) {
      steps.push({
        type: repairStep.type,
        label: repairStep.label,
        route: repairStep.route,
        reason: repairStep.reason,
        blocked: repairStep.retryable === false,
        retryAfter: repairStep.retryAfter || null,
        proof: repairStep.proof
      });
    }
  }

  steps.push({
    type: nextAction.type,
    label: nextAction.blocked ? 'Repair memory mount before continuing' : 'Continue memory workflow',
    route: nextAction.routeHint,
    targetMountId: nextAction.targetMountId,
    reason: nextAction.reason,
    blocked: nextAction.blocked
  });

  return steps;
}

function buildDescriptorNextStepContract({
  request,
  command,
  mounts,
  previewAcceptance,
  validationSummary,
  providerServiceContract,
  operationalHealth,
  shapedState,
  now
}) {
  const descriptorIssuesByMountId = new Map();
  for (const issue of validationSummary.descriptorValidationIssues || []) {
    const match = typeof issue.field === 'string' ? /^mounts\.([^.]+)\./.exec(issue.field) : null;
    if (match) {
      descriptorIssuesByMountId.set(match[1], [...(descriptorIssuesByMountId.get(match[1]) || []), issue]);
    }
  }

  const providerTicketsByMountId = new Map();
  for (const ticket of providerServiceContract.sourceServiceContracts?.handoffTickets || []) {
    if (ticket.mountId) {
      providerTicketsByMountId.set(ticket.mountId, [...(providerTicketsByMountId.get(ticket.mountId) || []), ticket]);
    }
  }
  const healthGuardByMountId = new Map(
    (operationalHealth.mountCommandGuards || []).map((guard) => [guard.mountId, guard])
  );

  const lanes = mounts.accepted.map((mount) => {
    const sourceIssues = Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [];
    const descriptorIssues = descriptorIssuesByMountId.get(mount.id) || [];
    const providerTickets = providerTicketsByMountId.get(mount.id) || [];
    const healthGuard = healthGuardByMountId.get(mount.id) || null;
    const providerFailure = operationalHealth.providerHealth?.failures?.find((failure) =>
      failure.mountId === mount.id || failure.sourceKind === mount.sourceContract?.sourceKind
    ) || null;
    const acceptancePending = previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted;
    const blockedReasons = [
      ...(acceptancePending ? ['acceptance_pending'] : []),
      ...(providerTickets.length ? ['provider_handoff_pending'] : []),
      ...(providerFailure?.status === 'unavailable' ? ['provider_source_unavailable'] : []),
      ...(healthGuard?.currentCommand?.allowed === false ? healthGuard.currentCommand.blockedReasons : []),
      ...(mounts.blocked ? ['memory_boundary_blocked'] : [])
    ];
    const reviewReasons = [
      ...sourceIssues.map((issue) => issue.reason || 'source_contract_review'),
      ...descriptorIssues.map((issue) => issue.reason || 'descriptor_contract_review'),
      ...(healthGuard && healthGuard.currentCommand.allowed && healthGuard.currentCommand.mode !== 'normal'
        ? [`health_${healthGuard.currentCommand.mode}`]
        : []),
      ...(providerFailure && providerFailure.status !== 'unavailable' ? [`provider_${providerFailure.status}`] : [])
    ];
    const stepType = blockedReasons[0]
      || (reviewReasons.length ? 'review_descriptor_contract' : command.type === 'select' ? 'resume_with_selected_memory' : 'continue_memory_workflow');
    const route = blockedReasons.includes('acceptance_pending')
      ? previewAcceptance.routeContracts.acceptanceRoute
      : (blockedReasons.includes('provider_handoff_pending')
          ? providerTickets[0].route
          : (healthGuard?.currentCommand?.allowed === false
              ? `${request.route}/health`
          : (reviewReasons.length
              ? previewAcceptance.routeContracts.validationRoute
              : previewAcceptance.routeContracts.nextStepRoute)));
    const lane = {
      mountId: mount.id,
      descriptorKind: mount.descriptor?.kind || mount.kind,
      descriptorLabel: mount.descriptor?.label || mount.kind,
      descriptorRoute: mount.descriptor?.route || `${request.route}/descriptors/${mount.kind}`,
      sourceKind: mount.sourceContract?.sourceKind || null,
      canonicalScope: mount.sourceContract?.canonicalScope || mount.scope,
      activeAfterCommit: shapedState.recovery.activeMountId === mount.id,
      stateEpoch: shapedState.persistedStatePatch.epoch,
      status: blockedReasons.length ? 'blocked' : (reviewReasons.length ? 'review' : 'ready'),
      stepType,
      route,
      blockedReasons,
      reviewReasons: [...new Set(reviewReasons)].sort(),
      validationCounts: {
        sourceIssues: sourceIssues.length,
        descriptorIssues: descriptorIssues.length,
        providerTickets: providerTickets.length,
        healthBlockedCommands: healthGuard?.currentCommand?.allowed === false ? 1 : 0
      },
      healthCommandGuard: healthGuard
        ? {
            providerStatus: healthGuard.providerStatus,
            currentCommandMode: healthGuard.currentCommand.mode,
            currentCommandAllowed: healthGuard.currentCommand.allowed,
            fallbackCommand: healthGuard.fallbackCommand,
            retryAfter: healthGuard.currentCommand.retryAfter,
            proof: healthGuard.proof
          }
        : null,
      payload: {
        commandId: command.commandId,
        commandType: command.type,
        mountId: mount.id,
        descriptorKind: mount.descriptor?.kind || mount.kind,
        acceptanceToken: acceptancePending ? previewAcceptance.acceptance.token : null,
        providerTicketIds: providerTickets.map((ticket) => ticket.ticketId),
        expectedEpoch: shapedState.persistedStatePatch.epoch
      },
      userVisibleReason: blockedReasons[0]
        || reviewReasons[0]
        || `Ready to continue with ${mount.descriptor?.label || mount.kind}.`
    };
    return {
      ...lane,
      proof: proofToken({
        commandId: command.commandId,
        mountId: mount.id,
        descriptorProof: mount.descriptor?.proof || null,
        sourceProof: mount.sourceContract?.proof || null,
        providerTicketProofs: providerTickets.map((ticket) => ticket.proof),
        healthGuardProof: healthGuard?.proof || null,
        blockedReasons,
        reviewReasons,
        stateEpoch: shapedState.persistedStatePatch.epoch
      })
    };
  });
  const activeLane = lanes.find((lane) => lane.activeAfterCommit)
    || lanes.find((lane) => lane.status === 'ready')
    || lanes[0]
    || null;
  const requiredCoverage = validationSummary.descriptorCoverage || {};
  const contract = {
    schemaVersion: 1,
    contentType: 'application/vnd.aios.memory-mount.descriptor-next-step+json',
    route: `${request.route}/descriptor-next-step`,
    generatedAt: now,
    commandId: command.commandId,
    commandType: command.type,
    status: lanes.some((lane) => lane.status === 'blocked')
      ? 'blocked'
      : (lanes.some((lane) => lane.status === 'review') ? 'review' : (lanes.length ? 'ready' : 'empty')),
    activeMountId: activeLane?.mountId || null,
    activeDescriptorKind: activeLane?.descriptorKind || null,
    descriptorCoverage: {
      status: requiredCoverage.status || 'unknown',
      requiredKinds: requiredCoverage.requiredKinds || REQUIRED_DESCRIPTOR_MOUNT_KINDS,
      coveredKinds: requiredCoverage.coveredKinds || [],
      missingKinds: requiredCoverage.missingKinds || [],
      proof: requiredCoverage.proof || null
    },
    lanes,
    nextStep: activeLane
      ? {
          type: activeLane.stepType,
          route: activeLane.route,
          mountId: activeLane.mountId,
          descriptorKind: activeLane.descriptorKind,
          payload: activeLane.payload,
          blocked: activeLane.status === 'blocked',
          reason: activeLane.userVisibleReason,
          proof: activeLane.proof
        }
      : {
          type: 'attach_memory_scope',
          route: previewAcceptance.routeContracts.previewRoute,
          mountId: null,
          descriptorKind: null,
          payload: { commandId: command.commandId, commandType: command.type },
          blocked: false,
          reason: 'no_memory_mount_lanes_available',
          proof: proofToken({ commandId: command.commandId, reason: 'no_memory_mount_lanes_available' })
        },
    summary: {
      readyCount: lanes.filter((lane) => lane.status === 'ready').length,
      reviewCount: lanes.filter((lane) => lane.status === 'review').length,
      blockedCount: lanes.filter((lane) => lane.status === 'blocked').length,
      descriptorKinds: countBy(lanes, (lane) => lane.descriptorKind),
      sourceKinds: countBy(lanes, (lane) => lane.sourceKind),
      userVisible: activeLane
        ? `${activeLane.descriptorLabel} is ${activeLane.status}; next step is ${activeLane.stepType}.`
        : 'Attach a memory scope before descriptor next steps are available.'
    }
  };

  return {
    ...contract,
    proof: proofToken({
      commandId: command.commandId,
      status: contract.status,
      activeMountId: contract.activeMountId,
      descriptorCoverage: contract.descriptorCoverage,
      laneProofs: lanes.map((lane) => lane.proof),
      nextStep: contract.nextStep,
      generatedAt: now
    })
  };
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sumTimeline(timeline, selector) {
  return timeline.reduce((total, entry) => total + normalizeInteger(selector(entry), 0, 0, Number.MAX_SAFE_INTEGER), 0);
}

function mergeTimelineCounters(timeline, selector) {
  return timeline.reduce((merged, entry) => mergeCounterMap(merged, selector(entry) || {}), {});
}

function compactCounterList(value) {
  return Object.entries(normalizeCounterMap(value))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}:${count}`)
    .join('|');
}

function lastMatchingTimelineEntry(timeline, predicate) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (predicate(timeline[index])) {
      return timeline[index];
    }
  }
  return null;
}

function buildAnalyticsReportingWindow({ timeline, analytics, now }) {
  const first = timeline[0] || null;
  const latest = timeline[timeline.length - 1] || null;
  const blockedEntries = timeline.filter((entry) => entry.outcome === 'blocked');
  const degradedEntries = timeline.filter((entry) => entry.healthStatus === 'degraded' || entry.healthStatus === 'blocked');
  const reviewEntries = timeline.filter((entry) => entry.validationStatus !== 'clean');
  const scheduledEntries = timeline.filter((entry) => entry.scheduled);
  const peakRejectedEntry = timeline.reduce((peak, entry) =>
    !peak || entry.rejectedCount > peak.rejectedCount ? entry : peak, null);
  const lastCleanEntry = lastMatchingTimelineEntry(timeline, (entry) => entry.validationStatus === 'clean');
  const lastDegradedEntry = lastMatchingTimelineEntry(timeline, (entry) => entry.healthStatus !== 'healthy');
  const latestEpoch = latest?.epoch || 0;
  const firstEpoch = first?.epoch || latestEpoch;
  const windowCommandCount = timeline.length;
  const issueTotals = {
    rejectedMounts: sumTimeline(timeline, (entry) => entry.rejectedCount),
    sourceContractIssues: sumTimeline(timeline, (entry) => entry.sourceIssueCount),
    lifecycleNormalizations: sumTimeline(timeline, (entry) => entry.lifecycleIssueCount)
  };
  const statusMix = {
    outcomes: countBy(timeline, (entry) => entry.outcome),
    readiness: countBy(timeline, (entry) => entry.readinessLevel),
    health: countBy(timeline, (entry) => entry.healthStatus),
    validation: countBy(timeline, (entry) => entry.validationStatus),
    restart: countBy(timeline, (entry) => entry.restartLevel)
  };
  const descriptorMix = {
    mountKinds: mergeTimelineCounters(timeline, (entry) => entry.mountKinds),
    sourceKinds: mergeTimelineCounters(timeline, (entry) => entry.sourceKinds),
    descriptorStatuses: mergeTimelineCounters(timeline, (entry) => entry.descriptorStatuses),
    descriptorLifecycles: mergeTimelineCounters(timeline, (entry) => entry.descriptorLifecycles),
    retentionPolicies: mergeTimelineCounters(timeline, (entry) => entry.retentionPolicies),
    scopeKinds: mergeTimelineCounters(timeline, (entry) => entry.scopeKinds),
    durabilityClasses: mergeTimelineCounters(timeline, (entry) => entry.durabilityClasses),
    sourceAccessModes: mergeTimelineCounters(timeline, (entry) => entry.sourceAccessModes)
  };
  const latestDescriptorState = latest
    ? {
        mountKinds: latest.mountKinds || {},
        sourceKinds: latest.sourceKinds || {},
        descriptorStatuses: latest.descriptorStatuses || {},
        descriptorLifecycles: latest.descriptorLifecycles || {},
        retentionPolicies: latest.retentionPolicies || {},
        scopeKinds: latest.scopeKinds || {},
        durabilityClasses: latest.durabilityClasses || {},
        sourceAccessModes: latest.sourceAccessModes || {}
      }
    : {
        mountKinds: {},
        sourceKinds: {},
        descriptorStatuses: {},
        descriptorLifecycles: {},
        retentionPolicies: {},
        scopeKinds: {},
        durabilityClasses: {},
        sourceAccessModes: {}
      };
  const exportWatermark = proofToken({
    latestSnapshotId: analytics.lastSnapshotId,
    latestEpoch,
    windowCommandCount,
    issueTotals,
    statusMix,
    descriptorMix,
    latestDescriptorState,
    generatedAt: now
  });

  return {
    schemaVersion: 1,
    window: {
      snapshotCount: windowCommandCount,
      firstSnapshotId: first?.snapshotId || null,
      latestSnapshotId: latest?.snapshotId || null,
      firstCapturedAt: first?.capturedAt || null,
      latestCapturedAt: latest?.capturedAt || null,
      firstEpoch,
      latestEpoch,
      epochDelta: Math.max(0, latestEpoch - firstEpoch)
    },
    countersAtExport: {
      totalCommands: analytics.counters.totalCommands,
      blockedCommands: analytics.counters.blockedCommands,
      replayedCommands: analytics.counters.replayedCommands,
      scheduledCommands: analytics.counters.scheduledCommands,
      degradedHealthEvents: analytics.counters.degradedHealthEvents,
      cleanValidationEvents: analytics.counters.cleanValidationEvents,
      reviewValidationEvents: analytics.counters.reviewValidationEvents,
      sourceContractIssueEvents: analytics.counters.sourceContractIssueEvents,
      lifecycleNormalizationEvents: analytics.counters.lifecycleNormalizationEvents
    },
    windowSignals: {
      blockedCount: blockedEntries.length,
      degradedCount: degradedEntries.length,
      reviewCount: reviewEntries.length,
      scheduledCount: scheduledEntries.length,
      issueTotals,
      statusMix,
      descriptorMix,
      latestDescriptorState,
      peakRejectedSnapshotId: peakRejectedEntry?.snapshotId || null,
      peakRejectedCount: peakRejectedEntry?.rejectedCount || 0,
      lastCleanSnapshotId: lastCleanEntry?.snapshotId || null,
      lastDegradedSnapshotId: lastDegradedEntry?.snapshotId || null
    },
    exportWatermark,
    proof: proofToken({
      latestSnapshotId: analytics.lastSnapshotId,
      historyProofs: timeline.map((entry) => entry.proof),
      counters: analytics.counters,
      descriptorMix,
      latestDescriptorState,
      exportWatermark
    })
  };
}

function incidentSeverityRank(severity) {
  if (severity === 'critical') return 4;
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'info') return 1;
  return 0;
}

function normalizeHealthIncidentForExport(incident, index, now) {
  const source = incident && typeof incident === 'object' ? incident : {};
  const severity = normalizeNonEmptyString(source.severity, 'warning');
  const status = normalizeNonEmptyString(source.status, 'attention_required');
  const retryAfter = normalizeIsoString(source.retryAfter);

  return {
    incidentId: normalizeNonEmptyString(source.incidentId, proofToken({ index, source, now })),
    source: normalizeNonEmptyString(source.source, 'memory-mount'),
    status,
    severity,
    code: normalizeNonEmptyString(source.code, status),
    mountId: typeof source.mountId === 'string' && source.mountId.trim() ? source.mountId.trim() : null,
    sourceKind: ALLOWED_SOURCE_KINDS.has(source.sourceKind) ? source.sourceKind : null,
    serviceId: normalizeNonEmptyString(source.serviceId, null),
    retryable: normalizeBoolean(source.retryable, false),
    retryAfter,
    operatorAction: normalizeNonEmptyString(source.operatorAction, source.retryable ? 'retry_after_backoff' : 'review_memory_mount_health'),
    route: normalizeNonEmptyString(source.route, null),
    proof: normalizeNonEmptyString(source.proof, proofToken({ index, source, retryAfter }))
  };
}

function normalizeHealthRepairStepForExport(step, index, now) {
  const source = step && typeof step === 'object' ? step : {};
  const retryAfter = normalizeIsoString(source.retryAfter);
  return {
    stepId: normalizeNonEmptyString(source.stepId, proofToken({ index, source, now })),
    type: normalizeNonEmptyString(source.type, 'review_memory_mount_health'),
    route: normalizeNonEmptyString(source.route, null),
    label: normalizeNonEmptyString(source.label, 'Review memory mount health'),
    reason: normalizeNonEmptyString(source.reason, 'operational_health_attention_required'),
    retryable: normalizeBoolean(source.retryable, false),
    retryAfter,
    backoffSeconds: normalizeInteger(source.backoffSeconds, 0, 0, MAX_RETRY_DELAY_SECONDS),
    sourceKinds: Array.isArray(source.sourceKinds)
      ? [...new Set(source.sourceKinds.filter((kind) => ALLOWED_SOURCE_KINDS.has(kind)))].sort()
      : [],
    proof: normalizeNonEmptyString(source.proof, proofToken({ index, source, retryAfter }))
  };
}

function buildHealthIncidentAnalyticsExport({ operationalHealth, timeline, now }) {
  const incidentPlan = operationalHealth?.incidentPlan && typeof operationalHealth.incidentPlan === 'object'
    ? operationalHealth.incidentPlan
    : {};
  const incidents = Array.isArray(incidentPlan.incidents)
    ? incidentPlan.incidents
        .map((incident, index) => normalizeHealthIncidentForExport(incident, index, now))
        .sort((left, right) =>
          incidentSeverityRank(right.severity) - incidentSeverityRank(left.severity)
          || left.code.localeCompare(right.code)
          || (left.mountId || '').localeCompare(right.mountId || '')
        )
    : [];
  const repairSteps = Array.isArray(incidentPlan.repairSteps)
    ? incidentPlan.repairSteps.map((step, index) => normalizeHealthRepairStepForExport(step, index, now))
    : [];
  const currentWritePolicy = incidentPlan.writePolicy && typeof incidentPlan.writePolicy === 'object'
    ? incidentPlan.writePolicy
    : operationalHealth?.writePolicy || {};
  const retryBudget = incidentPlan.retryBudget && typeof incidentPlan.retryBudget === 'object'
    ? incidentPlan.retryBudget
    : operationalHealth?.retryBudget || {};
  const timelineHealth = countBy(timeline, (entry) => entry.healthStatus || 'unknown');
  const blockedTimelineEntries = timeline.filter((entry) =>
    entry.outcome === 'blocked' || entry.healthStatus === 'blocked' || entry.healthStatus === 'degraded');
  const incidentsBySeverity = countBy(incidents, (incident) => incident.severity);
  const incidentsByStatus = countBy(incidents, (incident) => incident.status);
  const incidentsBySourceKind = countBy(incidents, (incident) => incident.sourceKind || 'unspecified');
  const incidentsByMountId = countBy(incidents, (incident) => incident.mountId || 'unscoped');
  const retryableIncidentCount = incidents.filter((incident) => incident.retryable).length;
  const nextRetryAt = incidents
    .map((incident) => incident.retryAfter)
    .filter(Boolean)
    .sort()[0] || retryBudget.nextRetryAt || null;
  const highestSeverity = incidents[0]?.severity || (operationalHealth.status === 'healthy' ? 'info' : 'warning');
  const currentState = currentWritePolicy.allowed === false
    ? 'write-blocked'
    : incidents.length
      ? 'incident-open'
      : operationalHealth.status === 'healthy'
        ? 'clear'
        : 'attention-required';

  return {
    schemaVersion: 1,
    generatedAt: now,
    state: currentState,
    healthStatus: operationalHealth.status,
    providerStatus: operationalHealth.providerHealth?.status || 'unknown',
    highestSeverity,
    degradedMode: Boolean(operationalHealth.degradedMode),
    writePolicy: {
      mode: currentWritePolicy.mode || 'unknown',
      allowed: currentWritePolicy.allowed !== false,
      blockedReasons: Array.isArray(currentWritePolicy.blockedReasons) ? currentWritePolicy.blockedReasons : [],
      affectedMountIds: Array.isArray(currentWritePolicy.affectedMountIds) ? currentWritePolicy.affectedMountIds : [],
      affectedSourceKinds: Array.isArray(currentWritePolicy.affectedSourceKinds) ? currentWritePolicy.affectedSourceKinds : [],
      proof: currentWritePolicy.proof || null
    },
    retryBudget: {
      attemptsUsed: normalizeInteger(retryBudget.attemptsUsed, 0, 0, MAX_RETRY_ATTEMPTS),
      attemptsRemaining: normalizeInteger(retryBudget.attemptsRemaining, MAX_RETRY_ATTEMPTS, 0, MAX_RETRY_ATTEMPTS),
      exhausted: normalizeBoolean(retryBudget.exhausted, false),
      nextRetryAt,
      backoffSeconds: normalizeInteger(retryBudget.backoffSeconds, 0, 0, MAX_RETRY_DELAY_SECONDS),
      proof: retryBudget.proof || null
    },
    counters: {
      incidentCount: incidents.length,
      retryableIncidentCount,
      repairStepCount: repairSteps.length,
      timelineHealthEvents: timeline.length,
      blockedTimelineEvents: blockedTimelineEntries.length,
      bySeverity: incidentsBySeverity,
      byStatus: incidentsByStatus,
      bySourceKind: incidentsBySourceKind,
      byMountId: incidentsByMountId,
      timelineHealth
    },
    incidents,
    repairSteps,
    routes: {
      health: operationalHealth.incidentPlan?.repairSteps?.[0]?.route || null,
      report: null,
      retry: nextRetryAt ? operationalHealth.incidentPlan?.repairSteps?.find((step) => step.retryable)?.route || null : null
    },
    proof: proofToken({
      healthStatus: operationalHealth.status,
      providerStatus: operationalHealth.providerHealth?.status || null,
      incidentProofs: incidents.map((incident) => incident.proof),
      repairStepProofs: repairSteps.map((step) => step.proof),
      writePolicyProof: currentWritePolicy.proof || null,
      retryBudgetProof: retryBudget.proof || null,
      timelineHealth,
      nextRetryAt
    })
  };
}

function buildAnalyticsReport({ request, command, shapedState, validationSummary, operationalHealth, previewAcceptance, now }) {
  const analytics = shapedState.persistedStatePatch.analytics;
  const history = Array.isArray(analytics.history) ? analytics.history : [];
  const latestSnapshot = history[history.length - 1] || null;
  const timeline = history.slice(-MAX_ANALYTICS_TIMELINE).map((entry) => ({
    snapshotId: entry.snapshotId,
    capturedAt: entry.capturedAt,
    epoch: entry.epoch,
    commandType: entry.commandType,
    outcome: entry.outcome,
    activeMountId: entry.activeMountId,
    acceptedCount: entry.acceptedCount,
    rejectedCount: entry.rejectedCount,
    lifecycleMode: entry.lifecycleMode,
    scheduled: entry.scheduled,
    lifecycleIssueCount: entry.lifecycleIssueCount,
    sourceIssueCount: entry.sourceIssueCount,
    restartLevel: entry.restartLevel,
    healthStatus: entry.healthStatus,
    validationStatus: entry.validationStatus,
    readinessLevel: entry.readinessLevel,
    mountKinds: entry.mountKinds || {},
    sourceKinds: entry.sourceKinds || {},
    descriptorStatuses: entry.descriptorStatuses || {},
    descriptorLifecycles: entry.descriptorLifecycles || {},
    retentionPolicies: entry.retentionPolicies || {},
    scopeKinds: entry.scopeKinds || {},
    durabilityClasses: entry.durabilityClasses || {},
    sourceAccessModes: entry.sourceAccessModes || {},
    proof: entry.proof
  }));
  const reportingWindow = buildAnalyticsReportingWindow({ timeline, analytics, now });
  const healthIncidentExport = buildHealthIncidentAnalyticsExport({ operationalHealth, timeline, now });
  healthIncidentExport.routes.report = `${request.route}/analytics/health-incidents`;
  const csvColumns = [
    'capturedAt',
    'epoch',
    'commandType',
    'outcome',
    'activeMountId',
    'acceptedCount',
    'rejectedCount',
    'sourceIssueCount',
    'lifecycleIssueCount',
    'restartLevel',
    'healthStatus',
    'healthIncidentState',
    'healthIncidentCount',
    'healthWritePolicyMode',
    'healthRetryAfter',
    'validationStatus',
    'readinessLevel',
    'mountKinds',
    'sourceKinds',
    'descriptorStatuses',
    'descriptorLifecycles',
    'retentionPolicies',
    'scopeKinds',
    'durabilityClasses',
    'sourceAccessModes',
    'snapshotId'
  ];
  const csvValue = (entry, column) => {
    if ([
      'mountKinds',
      'sourceKinds',
      'descriptorStatuses',
      'descriptorLifecycles',
      'retentionPolicies',
      'scopeKinds',
      'durabilityClasses',
      'sourceAccessModes'
    ].includes(column)) {
      return compactCounterList(entry[column]);
    }
    if (column === 'healthIncidentState') {
      return healthIncidentExport.state;
    }
    if (column === 'healthIncidentCount') {
      return healthIncidentExport.counters.incidentCount;
    }
    if (column === 'healthWritePolicyMode') {
      return healthIncidentExport.writePolicy.mode;
    }
    if (column === 'healthRetryAfter') {
      return healthIncidentExport.retryBudget.nextRetryAt;
    }
    return entry[column];
  };
  const csvRows = [
    csvColumns.join(','),
    ...timeline.map((entry) => csvColumns.map((column) => csvCell(csvValue(entry, column))).join(','))
  ];
  const summary = {
    generatedAt: now,
    route: request.route,
    commandId: command.commandId,
    commandType: command.type,
    epoch: shapedState.persistedStatePatch.epoch,
    activeMountId: shapedState.recovery.activeMountId,
    totalCommands: analytics.counters.totalCommands,
    blockedCommands: analytics.counters.blockedCommands,
    replayedCommands: analytics.counters.replayedCommands,
    degradedHealthEvents: analytics.counters.degradedHealthEvents,
    scheduledCommands: analytics.counters.scheduledCommands,
    cleanValidationEvents: analytics.counters.cleanValidationEvents,
    reviewValidationEvents: analytics.counters.reviewValidationEvents,
    sourceContractIssueEvents: analytics.counters.sourceContractIssueEvents,
    lifecycleNormalizationEvents: analytics.counters.lifecycleNormalizationEvents,
    acceptedMountsSeen: analytics.counters.acceptedMountsSeen,
    rejectedMountsSeen: analytics.counters.rejectedMountsSeen,
    recoveredMountsSeen: analytics.counters.recoveredMountsSeen,
    tombstonedMountsSeen: analytics.counters.tombstonedMountsSeen,
    commandsByType: analytics.counters.commandsByType,
    outcomesByStatus: analytics.counters.outcomesByStatus,
    mountsByKind: analytics.counters.mountsByKind,
    sourceKinds: analytics.counters.sourceKinds,
    descriptorStatuses: analytics.counters.descriptorStatuses,
    descriptorLifecycles: analytics.counters.descriptorLifecycles,
    retentionPolicies: analytics.counters.retentionPolicies,
    scopeKinds: analytics.counters.scopeKinds,
    durabilityClasses: analytics.counters.durabilityClasses,
    sourceAccessModes: analytics.counters.sourceAccessModes,
    readinessByLevel: analytics.counters.readinessByLevel,
    healthByStatus: analytics.counters.healthByStatus,
    restartByLevel: analytics.counters.restartByLevel,
    activeMountSelections: analytics.counters.activeMountSelections,
    reportingWindow: reportingWindow.window,
    windowSignals: reportingWindow.windowSignals,
    validationStatus: validationSummary.status,
    readinessLevel: previewAcceptance.readiness.level,
    healthStatus: operationalHealth.status,
    healthIncidentState: healthIncidentExport.state,
    healthIncidentCount: healthIncidentExport.counters.incidentCount,
    healthIncidentHighestSeverity: healthIncidentExport.highestSeverity,
    healthWritePolicyMode: healthIncidentExport.writePolicy.mode,
    healthWriteAllowed: healthIncidentExport.writePolicy.allowed,
    healthRetryAfter: healthIncidentExport.retryBudget.nextRetryAt,
    healthIncidentProof: healthIncidentExport.proof,
    restartLevel: shapedState.recovery.restartStatus.level,
    latestSnapshotId: analytics.lastSnapshotId,
    latestSnapshotProof: latestSnapshot?.proof || null,
    analyticsProof: analytics.proof,
    reportingProof: reportingWindow.proof
  };

  return {
    summary,
    latestSnapshot,
    timeline,
    reportingWindow,
    exportReady: {
      json: {
        contentType: 'application/json',
        fileName: `memory-mount-analytics-${shapedState.persistedStatePatch.epoch}.json`,
        body: {
          surfaceId,
          summary,
          timeline,
          reportingWindow,
          healthIncidentExport
        }
      },
      csv: {
        contentType: 'text/csv',
        fileName: `memory-mount-analytics-${shapedState.persistedStatePatch.epoch}.csv`,
        columns: csvColumns,
        rows: csvRows
      },
      manifest: {
        contentType: 'application/vnd.aios.memory-mount.analytics-manifest+json',
        fileName: `memory-mount-analytics-${shapedState.persistedStatePatch.epoch}-manifest.json`,
        exportWatermark: reportingWindow.exportWatermark,
        files: [
          `memory-mount-analytics-${shapedState.persistedStatePatch.epoch}.json`,
          `memory-mount-analytics-${shapedState.persistedStatePatch.epoch}.csv`
        ],
        proof: proofToken({
          epoch: shapedState.persistedStatePatch.epoch,
          exportWatermark: reportingWindow.exportWatermark,
          summaryProof: reportingWindow.proof,
          healthIncidentProof: healthIncidentExport.proof,
          csvRows
        })
      }
    },
    routes: {
      reportRoute: `${request.route}/analytics/report`,
      historyRoute: `${request.route}/analytics/history`,
      timelineRoute: `${request.route}/analytics/timeline`,
      exportRoute: `${request.route}/analytics/export`
    },
    healthIncidentExport,
    proof: proofToken({
      summary,
      timelineProofs: timeline.map((entry) => entry.proof),
      csvRows,
      reportingProof: reportingWindow.proof,
      healthIncidentProof: healthIncidentExport.proof,
      exportManifestProof: reportingWindow.exportWatermark,
      analyticsProof: analytics.proof
    })
  };
}

function buildWorkflowHandoff({ request, clientState, command, mounts, lifecycle, now }) {
  const activeMount = mounts.accepted.find((mount) => mount.selected) || mounts.accepted[0] || null;
  const nextAction = buildNextActionState({ command, mounts, lifecycle, now });
  return {
    mode: request.handoff,
    label: activeMount ? `Resume ${activeMount.kind} memory` : 'Start memory mount',
    route: request.route,
    requestId: request.requestId,
    targetMountId: activeMount ? activeMount.id : null,
    clientStatePatch: {
      memoryMountReady: mounts.accepted.length > 0,
      activeMemoryMountId: activeMount ? activeMount.id : null,
      activeMemoryDescriptorKind: activeMount ? activeMount.descriptor?.kind || activeMount.kind : null,
      activeMemoryDescriptorLabel: activeMount ? activeMount.descriptor?.label || activeMount.kind : null,
      activeMemoryDescriptorProof: activeMount ? activeMount.descriptor?.proof || null : null,
      activeMemoryTenantId: activeMount ? activeMount.tenantId : clientState.tenantId,
      activeMemoryWorkspaceId: activeMount ? activeMount.workspaceId : clientState.workspaceId,
      activeMemorySourceKind: activeMount ? activeMount.sourceContract.sourceKind : null,
      activeMemorySourceUri: activeMount ? activeMount.sourceContract.uri : null,
      activeMemorySourceAccess: activeMount ? activeMount.sourceContract.accessMode : null,
      activeMemorySourceProof: activeMount ? activeMount.sourceContract.proof : null,
      memoryMountRejectedCount: mounts.rejected.length,
      memoryMountLifecycleEnabled: lifecycle.settings.enabled,
      memoryMountLifecycleMode: lifecycle.settings.mode,
      memoryMountNextRunAt: lifecycle.settings.schedule.nextRunAt,
      memoryMountNextAction: nextAction.type,
      lastMemoryMountAt: now
    },
    nextAction,
    userVisibleNextStep: activeMount
      ? (nextAction.blocked
          ? 'Memory mount is blocked until lifecycle settings or permissions are repaired.'
          : `Continue with ${activeMount.kind} memory scope ${activeMount.scope}.`)
      : 'No valid memory mount is available; open the memory manager to attach a scope.'
  };
}

function normalizeProviderServiceBinding(entry, index, request) {
  const binding = entry && typeof entry === 'object' ? entry : {};
  const requestedSourceKind = normalizeNonEmptyString(binding.sourceKind, 'kernel-store');
  const sourceKind = ALLOWED_SOURCE_KINDS.has(requestedSourceKind) ? requestedSourceKind : 'kernel-store';
  const serviceId = normalizeNonEmptyString(binding.serviceId, PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind]);
  const requestedCapabilities = normalizeStringList(binding.capabilities)
    .filter((capability, capabilityIndex, list) => list.indexOf(capability) === capabilityIndex);
  const grantedCapabilities = requestedCapabilities.filter((capability) => ALLOWED_PROVIDER_CAPABILITIES.has(capability)).sort();
  const requestedSyncMode = normalizeNonEmptyString(binding.syncMode ?? binding.sync?.mode, 'incremental');
  const syncMode = ALLOWED_PROVIDER_SYNC_MODES.has(requestedSyncMode) ? requestedSyncMode : 'incremental';
  const endpointRoute = normalizeNonEmptyString(
    binding.endpointRoute,
    `${request.route}/provider/services/${sourceKind}/handoff`
  );
  const validationIssues = [
    ...(ALLOWED_SOURCE_KINDS.has(requestedSourceKind) ? [] : [{
      field: `provider.services.${index}.sourceKind`,
      reason: 'unsupported_provider_service_source_kind',
      value: requestedSourceKind,
      normalizedValue: sourceKind
    }]),
    ...(ALLOWED_PROVIDER_SYNC_MODES.has(requestedSyncMode) ? [] : [{
      field: `provider.services.${index}.syncMode`,
      reason: 'unsupported_provider_service_sync_mode',
      value: requestedSyncMode,
      normalizedValue: syncMode
    }]),
    ...requestedCapabilities
      .filter((capability) => !ALLOWED_PROVIDER_CAPABILITIES.has(capability))
      .map((capability) => ({
        field: `provider.services.${index}.capabilities`,
        reason: 'unsupported_provider_service_capability',
        value: capability
      }))
  ];

  return {
    sourceKind,
    serviceId,
    endpointRoute,
    syncMode,
    capabilities: grantedCapabilities,
    validationIssues,
    proof: proofToken({
      sourceKind,
      serviceId,
      endpointRoute,
      syncMode,
      capabilities: grantedCapabilities
    })
  };
}

function normalizeProviderIntegration(input, request) {
  const provider = input.providerContract && typeof input.providerContract === 'object'
    ? input.providerContract
    : (input.provider && typeof input.provider === 'object' ? input.provider : {});
  const requestedCapabilities = normalizeStringList(provider.capabilities ?? provider.requestedCapabilities)
    .filter((capability, index, list) => list.indexOf(capability) === index);
  const sync = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
  const requestedSyncMode = normalizeNonEmptyString(sync.mode ?? provider.syncMode, 'incremental');
  const syncMode = ALLOWED_PROVIDER_SYNC_MODES.has(requestedSyncMode) ? requestedSyncMode : 'incremental';
  const serviceBindings = Array.isArray(provider.services)
    ? provider.services
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, ALLOWED_SOURCE_KINDS.size)
        .map((entry, index) => normalizeProviderServiceBinding(entry, index, request))
    : [];
  const mailchimpSync = normalizeMailchimpMountContext(provider.mailchimpSync ?? provider.mailchimp);

  return {
    providerId: normalizeNonEmptyString(provider.providerId, 'hosted-kernel-memory-provider'),
    serviceId: normalizeNonEmptyString(provider.serviceId, 'aios.memory-manager.memory-mount'),
    serviceVersion: normalizeNonEmptyString(provider.serviceVersion, `schema-${PERSISTED_STATE_SCHEMA_VERSION}`),
    displayName: normalizeNonEmptyString(provider.displayName ?? provider.name, 'Hosted kernel memory provider'),
    endpointRoute: normalizeNonEmptyString(provider.endpointRoute, `${request.route}/provider/handoff`),
    requestedCapabilities,
    syncMode,
    acceptsExternalHandoff: normalizeBoolean(provider.acceptsExternalHandoff, true),
    declaredSchemaVersion: normalizeInteger(provider.schemaVersion, 1, 1, Number.MAX_SAFE_INTEGER),
    serviceBindings,
    mailchimpSync,
    validationIssues: [
      ...(ALLOWED_PROVIDER_SYNC_MODES.has(requestedSyncMode)
        ? []
        : [{ field: 'provider.sync.mode', reason: 'unsupported_provider_sync_mode', value: requestedSyncMode, normalizedValue: syncMode }]),
      ...serviceBindings.flatMap((binding) => binding.validationIssues),
      ...mailchimpSync.validationIssues.map((issue) => ({
        ...issue,
        field: `provider.${issue.field}`
      }))
    ]
  };
}

function buildProviderSourceServiceContracts({
  provider,
  request,
  command,
  acceptedMounts,
  grantedCapabilities,
  missingRequiredCapabilities,
  lifecycle,
  shapedState,
  operationalHealth,
  now
}) {
  const bindingBySourceKind = new Map(provider.serviceBindings.map((binding) => [binding.sourceKind, binding]));
  const serviceContracts = acceptedMounts.map((mount) => {
    const sourceKind = mount.sourceContract?.sourceKind || SOURCE_KIND_BY_MOUNT_KIND[mount.kind];
    const binding = bindingBySourceKind.get(sourceKind) || {
      sourceKind,
      serviceId: PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind] || 'kernel.memory.unknown-source',
      endpointRoute: `${request.route}/provider/services/${sourceKind}/handoff`,
      syncMode: provider.syncMode,
      capabilities: [],
      validationIssues: [],
      proof: proofToken({ sourceKind, fallback: true })
    };
    const serviceCapabilities = binding.capabilities.length
      ? binding.capabilities.filter((capability) => grantedCapabilities.includes(capability))
      : grantedCapabilities;
    const mountProviderContract = mount.sourceContract?.providerContract || null;
    const providerCommandContract = mountProviderContract?.commandCapabilities?.[command.type] || null;
    const requiredForCommand = providerCommandContract?.requiredCapabilities
      || REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[command.type]
      || ['mount:read'];
    const missingForService = requiredForCommand.filter((capability) => !serviceCapabilities.includes(capability));
    const failure = operationalHealth.providerHealth?.failures?.find((entry) =>
      entry.mountId === mount.id || entry.sourceKind === sourceKind
    ) || null;
    const blocked = missingForService.length > 0 || failure?.status === 'unavailable';
    const operation = {
      operationId: proofToken({
        providerId: provider.providerId,
        serviceId: binding.serviceId,
        commandId: command.commandId,
        mountId: mount.id,
        sourceKind,
        stateEpoch: shapedState.persistedStatePatch.epoch
      }),
      name: PROVIDER_OPERATION_BY_COMMAND[command.type] || 'memory.mount.command',
      commandId: command.commandId,
      commandType: command.type,
      mountId: mount.id,
      sourceKind,
      accessMode: mount.sourceContract?.accessMode || 'read',
      stateEpoch: shapedState.persistedStatePatch.epoch,
      requiredCapabilities: requiredForCommand,
      grantedCapabilities: serviceCapabilities,
      missingCapabilities: missingForService,
      providerCommandStatus: providerCommandContract?.status || 'declared',
      syncCursor: mountProviderContract?.syncMetadata?.cursor || proofToken({
        mountId: mount.id,
        sourceKind,
        sourceEpoch: mount.sourceContract?.sourceEpoch || 0,
        checksum: mount.sourceContract?.checksum || null,
        stateEpoch: shapedState.persistedStatePatch.epoch
      }),
      syncMetadata: mountProviderContract?.syncMetadata || null,
      scheduleWindow: {
        mode: mountProviderContract?.syncMetadata?.mode || binding.syncMode,
        nextRunAt: lifecycle.settings.schedule.enabled ? lifecycle.settings.schedule.nextRunAt : null,
        refreshOnResume: lifecycle.settings.refreshOnResume
      }
    };

    return {
      mountId: mount.id,
      sourceKind,
      serviceId: binding.serviceId,
      endpointRoute: binding.endpointRoute,
      bindingProof: binding.proof,
      status: blocked ? 'blocked' : (failure ? 'degraded' : 'ready'),
      failureId: failure?.failureId || null,
      providerContractProof: mountProviderContract?.proof || null,
      operation,
      proof: proofToken({
        serviceId: binding.serviceId,
        endpointRoute: binding.endpointRoute,
        mountId: mount.id,
        operation,
        providerContractProof: mountProviderContract?.proof || null,
        failureId: failure?.failureId || null,
        missingRequiredCapabilities
      })
    };
  });
  const handoffTickets = [
    ...missingRequiredCapabilities.map((capability) => ({
      ticketId: proofToken({
        providerId: provider.providerId,
        commandId: command.commandId,
        capability,
        epoch: shapedState.persistedStatePatch.epoch
      }),
      type: 'capability_negotiation',
      action: PROVIDER_HANDOFF_ACTION_BY_CAPABILITY[capability] || 'request_provider_capability',
      capability,
      route: `${request.route}/provider/capabilities`,
      status: 'open',
      createdAt: now
    })),
    ...serviceContracts
      .filter((contract) => contract.status !== 'ready')
      .map((contract) => ({
        ticketId: proofToken({
          providerId: provider.providerId,
          commandId: command.commandId,
          mountId: contract.mountId,
          serviceId: contract.serviceId,
          status: contract.status
        }),
        type: 'source_service_handoff',
        action: contract.failureId ? 'repair_source_service' : 'complete_source_service_negotiation',
        capability: contract.operation.missingCapabilities[0] || null,
        mountId: contract.mountId,
        sourceKind: contract.sourceKind,
        serviceId: contract.serviceId,
        route: contract.endpointRoute,
        status: 'open',
        createdAt: now
      }))
  ].map((ticket) => ({
    ...ticket,
    proof: proofToken(ticket)
  }));

  return {
    serviceContracts,
    handoffTickets,
    serviceStatus: serviceContracts.some((contract) => contract.status === 'blocked')
      ? 'blocked'
      : (serviceContracts.some((contract) => contract.status === 'degraded') ? 'degraded' : 'ready'),
    proof: proofToken({
      providerId: provider.providerId,
      serviceProofs: serviceContracts.map((contract) => contract.proof),
      ticketProofs: handoffTickets.map((ticket) => ticket.proof)
    })
  };
}

function buildProviderServiceContract({ input, request, clientState, principal, command, mounts, lifecycle, shapedState, operationalHealth, now }) {
  const provider = normalizeProviderIntegration(input, request);
  const acceptedMounts = mounts.accepted || [];
  const sourceKinds = [...new Set(acceptedMounts.map((mount) => mount.sourceContract?.sourceKind).filter(Boolean))].sort();
  const writableMounts = acceptedMounts.filter((mount) => mount.writable);
  const availableCapabilities = new Set(['mount:read', 'mount:handoff', 'sync:metadata', 'audit:proof']);

  if (writableMounts.length && principal.canWrite) {
    availableCapabilities.add('mount:write');
  }
  if (principal.permissions.includes('memory:recover')) {
    availableCapabilities.add('mount:recover');
  }
  if (lifecycle.settings.enabled && lifecycle.settings.schedule.enabled && principal.canWrite) {
    availableCapabilities.add('mount:schedule');
  }
  if (provider.syncMode === 'incremental' && acceptedMounts.some((mount) => mount.sourceContract?.consistency === 'source_backed')) {
    availableCapabilities.add('sync:incremental');
  }
  if (provider.syncMode !== 'disabled' && acceptedMounts.length) {
    availableCapabilities.add('sync:snapshot');
  }
  if (sourceKinds.includes('artifact-store')) {
    availableCapabilities.add('artifact:resolve');
  }

  const defaultRequestedCapabilities = [...availableCapabilities].sort();
  const requestedCapabilities = provider.requestedCapabilities.length
    ? provider.requestedCapabilities
    : defaultRequestedCapabilities;
  const unsupportedCapabilities = requestedCapabilities.filter((capability) => !ALLOWED_PROVIDER_CAPABILITIES.has(capability));
  const grantedCapabilities = requestedCapabilities
    .filter((capability) => ALLOWED_PROVIDER_CAPABILITIES.has(capability) && availableCapabilities.has(capability))
    .filter((capability, index, list) => list.indexOf(capability) === index)
    .sort();
  const requiredCapabilities = [...new Set([
    'mount:handoff',
    ...(REQUIRED_PROVIDER_CAPABILITIES_BY_COMMAND[command.type] || ['mount:read'])
  ])].sort();
  const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !grantedCapabilities.includes(capability));
  const providerCriticalFailure = operationalHealth.providerHealth?.failures?.find((failure) =>
    failure.status === 'unavailable'
    && (!failure.sourceKind || sourceKinds.includes(failure.sourceKind))
    && ['attach', 'detach', 'recover', 'enable', 'disable', 'schedule'].includes(command.type)
  ) || null;
  const blocked = missingRequiredCapabilities.length > 0 || !provider.acceptsExternalHandoff || Boolean(providerCriticalFailure);
  const activeMount = acceptedMounts.find((mount) => mount.id === shapedState.recovery.activeMountId)
    || acceptedMounts.find((mount) => mount.selected)
    || acceptedMounts[0]
    || null;
  const mountSyncMetadata = acceptedMounts.map((mount) => {
    const contract = mount.sourceContract || {};
    const sourceKind = contract.sourceKind || SOURCE_KIND_BY_MOUNT_KIND[mount.kind];
    const serviceBinding = PROVIDER_SERVICE_BY_SOURCE_KIND[sourceKind] || 'kernel.memory.unknown-source';
    const cursor = proofToken({
      providerId: provider.providerId,
      mountId: mount.id,
      sourceKind,
      sourceEpoch: contract.sourceEpoch || 0,
      checksum: contract.checksum || null,
      stateEpoch: shapedState.persistedStatePatch.epoch
    });
    return {
      mountId: mount.id,
      sourceKind,
      serviceBinding,
      syncMode: provider.syncMode,
      syncStatus: blocked
        ? 'blocked'
        : (provider.syncMode === 'disabled' ? 'metadata_only' : (contract.consistency === 'source_backed' ? 'ready' : 'declared')),
      sourceEpoch: contract.sourceEpoch || 0,
      checksum: contract.checksum || null,
      cursor,
      nextSyncAt: provider.syncMode !== 'disabled' && lifecycle.settings.schedule.enabled
        ? lifecycle.settings.schedule.nextRunAt
        : null,
      mailchimpSync: buildMailchimpMountSyncContract({
        mountId: mount.id,
        sourceKind,
        providerMailchimp: provider.mailchimpSync,
        mountMailchimp: mount.mailchimpSync,
        lifecycle,
        shapedState
      }),
      proof: proofToken({ mountId: mount.id, serviceBinding, cursor, accessMode: contract.accessMode, boundary: mount.boundary?.proof })
    };
  });
  const mailchimpMountSync = mountSyncMetadata.map((entry) => entry.mailchimpSync);
  const mailchimpSyncSummary = {
    schemaVersion: 1,
    provider: 'mailchimp',
    status: mailchimpMountSync.some((entry) => entry.status === 'blocked')
      ? 'blocked'
      : (mailchimpMountSync.length ? 'ready' : 'not_requested'),
    readyMountIds: mailchimpMountSync.filter((entry) => entry.ready).map((entry) => entry.mountId),
    blockedMounts: mailchimpMountSync
      .filter((entry) => !entry.ready)
      .map((entry) => ({
        mountId: entry.mountId,
        subjectKey: entry.subjectKey,
        blockers: entry.blockers,
        validationIssues: entry.validationIssues
      })),
    eventKinds: [...new Set(mailchimpMountSync.flatMap((entry) => entry.eventKinds))].sort(),
    nextAction: mailchimpMountSync.some((entry) => !entry.ready)
      ? {
          action: 'repair_mailchimp_sync_scope',
          mountIds: mailchimpMountSync.filter((entry) => !entry.ready).map((entry) => entry.mountId)
        }
      : {
          action: 'publish_mailchimp_sync_metadata',
          mountIds: mailchimpMountSync.map((entry) => entry.mountId)
        }
  };
  const mailchimpClientWorkflow = buildMailchimpMountClientWorkflow({
    request,
    command,
    lifecycle,
    shapedState,
    mailchimpMountSync
  });
  const mailchimpContinuity = shapedState.persistedStatePatch.mailchimpContinuity || normalizePersistedMailchimpContinuityState();
  const sourceServiceContracts = buildProviderSourceServiceContracts({
    provider,
    request,
    command,
    acceptedMounts,
    grantedCapabilities,
    missingRequiredCapabilities,
    lifecycle,
    shapedState,
    operationalHealth,
    now
  });
  const validationIssues = [
    ...provider.validationIssues,
    ...unsupportedCapabilities.map((capability) => ({
      field: 'provider.capabilities',
      reason: 'unsupported_provider_capability',
      value: capability
    })),
    ...missingRequiredCapabilities.map((capability) => ({
      field: 'provider.capabilities',
      reason: 'required_provider_capability_missing',
      value: capability
    })),
    ...(provider.acceptsExternalHandoff ? [] : [{
      field: 'provider.acceptsExternalHandoff',
      reason: 'external_handoff_not_accepted',
      value: false
    }]),
    ...(providerCriticalFailure ? [{
      field: 'provider.health.failures',
      reason: 'required_provider_source_unavailable',
      value: providerCriticalFailure.sourceKind || providerCriticalFailure.serviceId,
      normalizedValue: providerCriticalFailure.status,
      proof: providerCriticalFailure.failureId
    }] : []),
    ...mailchimpMountSync.flatMap((entry) => entry.validationIssues)
  ];
  const handoffState = {
    status: blocked || sourceServiceContracts.serviceStatus === 'blocked'
      ? 'blocked'
      : (operationalHealth.status === 'healthy' && sourceServiceContracts.serviceStatus === 'ready' ? 'ready' : 'degraded'),
    route: provider.endpointRoute,
    providerId: provider.providerId,
    serviceId: provider.serviceId,
    activeMountId: activeMount?.id || null,
    commandId: command.commandId,
    stateEpoch: shapedState.persistedStatePatch.epoch,
    payloadRef: proofToken({
      providerId: provider.providerId,
      commandId: command.commandId,
      activeMountId: activeMount?.id || null,
      stateEpoch: shapedState.persistedStatePatch.epoch,
      mountProofs: mountSyncMetadata.map((entry) => entry.proof),
      mailchimpProofs: mailchimpMountSync.map((entry) => entry.proof),
      serviceProofs: sourceServiceContracts.serviceContracts.map((entry) => entry.proof),
      handoffTicketProofs: sourceServiceContracts.handoffTickets.map((entry) => entry.proof)
    }),
    expiresAt: lifecycle.settings.schedule.nextRunAt || addMinutesToIso(now, DEFAULT_SCHEDULE_INTERVAL_MINUTES),
    serviceStatus: sourceServiceContracts.serviceStatus,
    handoffTickets: sourceServiceContracts.handoffTickets,
    operationCount: sourceServiceContracts.serviceContracts.length
  };
  const operationalStatus = {
    status: operationalHealth.providerHealth?.status || 'healthy',
    degradedReadOnly: Boolean(operationalHealth.providerHealth?.degradedReadOnly),
    checkedAt: operationalHealth.providerHealth?.checkedAt || now,
    suppressed: Boolean(operationalHealth.providerHealth?.suppressed),
    activeFailureCount: operationalHealth.providerHealth?.activeFailureCount || 0,
    unavailableSourceKinds: operationalHealth.providerHealth?.unavailableSourceKinds || [],
    failureSourceKinds: operationalHealth.providerHealth?.failureSourceKinds || [],
    failureRoute: `${request.route}/provider/health`,
    retryAfter: operationalHealth.retryPolicy.nextRetryAt,
    writePolicy: operationalHealth.writePolicy,
    retryBudget: operationalHealth.retryBudget,
    repairStepCount: Array.isArray(operationalHealth.repairSteps) ? operationalHealth.repairSteps.length : 0,
    requiredRepair: providerCriticalFailure
      ? {
          sourceKind: providerCriticalFailure.sourceKind,
          serviceId: providerCriticalFailure.serviceId,
          operatorAction: providerCriticalFailure.operatorAction,
          failureId: providerCriticalFailure.failureId
        }
      : null,
    proof: proofToken({
      providerId: provider.providerId,
      status: operationalHealth.providerHealth?.status || 'healthy',
      activeFailures: operationalHealth.providerHealth?.failures || [],
      retryAfter: operationalHealth.retryPolicy.nextRetryAt,
      writePolicyProof: operationalHealth.writePolicy?.proof,
      retryBudgetProof: operationalHealth.retryBudget?.proof,
      blocked
    })
  };

  return {
    provider: {
      providerId: provider.providerId,
      serviceId: provider.serviceId,
      serviceVersion: provider.serviceVersion,
      displayName: provider.displayName,
      declaredSchemaVersion: provider.declaredSchemaVersion,
      mailchimpSync: provider.mailchimpSync
    },
    capabilityNegotiation: {
      requestedCapabilities,
      availableCapabilities: [...availableCapabilities].sort(),
      grantedCapabilities,
      requiredCapabilities,
      missingRequiredCapabilities,
      unsupportedCapabilities,
      status: blocked ? 'blocked' : 'granted'
    },
    syncMetadata: {
      mode: provider.syncMode,
      sourceKinds,
      mountSyncMetadata,
      mailchimpSyncSummary: {
        ...mailchimpSyncSummary,
        workflowStatus: mailchimpClientWorkflow.status,
        workflowRoute: mailchimpClientWorkflow.routeBase,
        acceptanceRequired: mailchimpClientWorkflow.acceptance.required,
        acceptanceEnabled: mailchimpClientWorkflow.acceptance.enabled,
        acceptanceToken: mailchimpClientWorkflow.acceptance.token,
        continuityStatus: mailchimpContinuity.status,
        continuityCheckpointKey: mailchimpContinuity.checkpointKey,
        replaySafe: mailchimpContinuity.replaySafe,
        persistedSubjectCount: mailchimpContinuity.subjects.length,
        pendingHandoff: mailchimpContinuity.pendingHandoff,
        proof: proofToken(mailchimpSyncSummary)
      },
      mailchimpClientWorkflow,
      mailchimpContinuity,
      nextScheduledSyncAt: lifecycle.settings.schedule.enabled ? lifecycle.settings.schedule.nextRunAt : null
    },
    sourceServiceContracts: {
      status: sourceServiceContracts.serviceStatus,
      services: sourceServiceContracts.serviceContracts,
      operationEnvelope: {
        commandId: command.commandId,
        commandType: command.type,
        operationName: PROVIDER_OPERATION_BY_COMMAND[command.type] || 'memory.mount.command',
        stateEpoch: shapedState.persistedStatePatch.epoch,
        requiredCapabilities,
        ticketCount: sourceServiceContracts.handoffTickets.length,
        proof: sourceServiceContracts.proof
      },
      handoffTickets: sourceServiceContracts.handoffTickets,
      proof: sourceServiceContracts.proof
    },
    operationalStatus,
    externalHandoffState: handoffState,
    validationIssues,
    proof: proofToken({
      provider,
      requestedCapabilities,
      grantedCapabilities,
      requiredCapabilities,
      missingRequiredCapabilities,
      operationalStatus,
      mountSyncProofs: mountSyncMetadata.map((entry) => entry.proof),
      sourceServiceProof: sourceServiceContracts.proof,
      mailchimpClientWorkflowProof: mailchimpClientWorkflow.proof,
      mailchimpContinuityProof: mailchimpContinuity.proof,
      handoffState
    })
  };
}

function buildClientRuntimeHandoff({ request, clientState, clientRuntime, command, mounts, previewAcceptance, shapedState, nextAction, operationalHealth, providerServiceContract, now }) {
  const activeMount = mounts.accepted.find((mount) => mount.id === shapedState.recovery.activeMountId)
    || mounts.accepted.find((mount) => mount.selected)
    || mounts.accepted[0]
    || null;
  const commandJournal = Array.isArray(shapedState.persistedStatePatch.commandJournal)
    ? shapedState.persistedStatePatch.commandJournal
    : [];
  const latestJournalEntry = commandJournal[commandJournal.length - 1] || null;
  const readiness = previewAcceptance.readiness;
  const needsAcceptance = previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted;
  const providerBlocked = providerServiceContract.capabilityNegotiation.status === 'blocked'
    || providerServiceContract.externalHandoffState.status === 'blocked';
  const status = needsAcceptance
    ? 'awaiting_acceptance'
    : (providerBlocked || operationalHealth.status === 'blocked' || nextAction.blocked || readiness.level === 'blocked' ? 'blocked' : readiness.level);
  const selectedView = needsAcceptance
    ? 'preview'
    : (providerBlocked || operationalHealth.status === 'blocked' || nextAction.blocked ? 'repair' : (readiness.level === 'needs_review' || operationalHealth.status === 'degraded' ? 'validation' : 'workflow'));
  const route = needsAcceptance
    ? previewAcceptance.routeContracts.acceptanceRoute
    : (providerBlocked
        ? providerServiceContract.externalHandoffState.route
        : (operationalHealth.status === 'blocked'
        ? operationalHealth.circuitBreaker.resetRoute
        : (nextAction.blocked
        ? previewAcceptance.routeContracts.validationRoute
        : (readiness.level === 'needs_review'
            ? previewAcceptance.routeContracts.validationRoute
            : clientRuntime.routeBindings.workflowRoute))));
  const handoffId = proofToken({
    requestId: request.requestId,
    commandId: command.commandId,
    status,
    selectedView,
    route,
    activeMountId: activeMount?.id || null,
    epoch: shapedState.persistedStatePatch.epoch
  });
  const handoffEntry = {
    handoffId,
    route,
    status,
    commandId: command.commandId,
    commandType: command.type,
    mountId: activeMount?.id || command.mountId || null,
    token: needsAcceptance ? previewAcceptance.acceptance.token : null,
    createdAt: now
  };
  const priorQueue = clientRuntime.pendingHandoffs.filter((entry) => entry.handoffId !== handoffId);
  const shouldQueue = status !== 'ready' || needsAcceptance || providerBlocked || nextAction.blocked || readiness.level === 'needs_review';
  const pendingHandoffs = shouldQueue
    ? [...priorQueue, handoffEntry].slice(-MAX_CLIENT_HANDOFFS)
    : priorQueue.filter((entry) => entry.commandId !== command.commandId).slice(-MAX_CLIENT_HANDOFFS);
  const blockingSteps = [
    ...(needsAcceptance ? [{
      type: 'accept_preview',
      route: previewAcceptance.routeContracts.acceptanceRoute,
      reason: previewAcceptance.acceptance.blockedReason,
      token: previewAcceptance.acceptance.token
    }] : []),
    ...(providerBlocked ? providerServiceContract.sourceServiceContracts.handoffTickets.map((ticket) => ({
      type: ticket.type,
      route: ticket.route,
      reason: ticket.action,
      ticketId: ticket.ticketId,
      capability: ticket.capability || null,
      mountId: ticket.mountId || null,
      proof: ticket.proof
    })) : []),
    ...(operationalHealth.status === 'blocked' ? [{
      type: operationalHealth.nextAction,
      route: operationalHealth.circuitBreaker.resetRoute,
      reason: operationalHealth.circuitBreaker.reason || operationalHealth.status,
      retryAfter: operationalHealth.retryPolicy.nextRetryAt
    }] : []),
    ...(readiness.blockers || [])
      .filter((blocker) => blocker.severity === 'blocking')
      .map((blocker) => ({
        type: blocker.type,
        route: blocker.route,
        reason: blocker.reason,
        retryAfter: blocker.retryAfter || null,
        proof: blocker.proof
      }))
  ];
  const reviewSteps = [
    ...(readiness.blockers || [])
      .filter((blocker) => blocker.severity !== 'blocking')
      .map((blocker) => ({
        type: blocker.type,
        route: blocker.route,
        reason: blocker.reason,
        retryAfter: blocker.retryAfter || null,
        proof: blocker.proof
      })),
    ...(operationalHealth.repairSteps || []).map((step) => ({
      type: step.type,
      route: step.route,
      reason: step.reason,
      retryAfter: step.retryAfter || null,
      blocked: step.retryable === false,
      proof: step.proof
    })),
    ...(providerServiceContract.validationIssues || []).slice(0, 6).map((issue) => ({
      type: 'provider_contract_review',
      route: providerServiceContract.externalHandoffState.route,
      reason: issue.reason || 'provider_contract_issue',
      field: issue.field || null,
      value: issue.value ?? null,
      proof: issue.proof || proofToken(issue)
    }))
  ];
  const workflowLane = needsAcceptance
    ? 'acceptance'
    : (providerBlocked
        ? 'provider_handoff'
        : (operationalHealth.status === 'blocked'
            ? 'repair'
            : (readiness.level === 'needs_review' || operationalHealth.status === 'degraded'
                ? 'validation'
                : 'resume')));
  const handoffPayload = {
    contentType: 'application/vnd.aios.memory-mount.workflow-handoff+json',
    method: 'POST',
    route,
    body: {
      requestId: request.requestId,
      commandId: command.commandId,
      commandType: command.type,
      handoffId,
      lane: workflowLane,
      selectedView,
      activeMountId: activeMount?.id || null,
      stateEpoch: shapedState.persistedStatePatch.epoch,
      acceptedPreviewToken: previewAcceptance.acceptance.accepted ? previewAcceptance.acceptance.token : null,
      requiredPreviewToken: needsAcceptance ? previewAcceptance.acceptance.token : null,
      providerPayloadRef: providerServiceContract.externalHandoffState.payloadRef,
      healthWriteAllowed: operationalHealth.writePolicy.allowed,
      nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
      blockingStepCount: blockingSteps.length,
      reviewStepCount: reviewSteps.length
    }
  };
  const workflowManifest = {
    schemaVersion: 1,
    contentType: 'application/vnd.aios.memory-mount.workflow-manifest+json',
    handoffId,
    lane: workflowLane,
    status,
    selectedView,
    route,
    generatedAt: now,
    requestId: request.requestId,
    commandId: command.commandId,
    commandType: command.type,
    activeMountId: activeMount?.id || null,
    activeMountLabel: activeMount ? `${activeMount.descriptor?.label || activeMount.kind}:${activeMount.scope}` : null,
    activeDescriptor: activeMount
      ? {
          kind: activeMount.descriptor?.kind || activeMount.kind,
          label: activeMount.descriptor?.label || activeMount.kind,
          route: activeMount.descriptor?.route || null,
          proof: activeMount.descriptor?.proof || null
        }
      : null,
    stateEpoch: shapedState.persistedStatePatch.epoch,
    pending: shouldQueue,
    queuePosition: shouldQueue ? pendingHandoffs.findIndex((entry) => entry.handoffId === handoffId) + 1 : 0,
    routeMap: {
      activeRoute: route,
      previewRoute: previewAcceptance.routeContracts.previewRoute,
      acceptanceRoute: previewAcceptance.routeContracts.acceptanceRoute,
      validationRoute: previewAcceptance.routeContracts.validationRoute,
      readinessRoute: previewAcceptance.routeContracts.readinessRoute,
      workflowRoute: clientRuntime.routeBindings.workflowRoute,
      providerRoute: providerServiceContract.externalHandoffState.route,
      healthRoute: `${request.route}/health`
    },
    gates: {
      acceptance: needsAcceptance ? 'required' : (previewAcceptance.acceptance.accepted ? 'accepted' : 'not_required'),
      readiness: readiness.level,
      health: operationalHealth.status,
      writePolicy: operationalHealth.writePolicy.allowed ? 'allowed' : 'blocked',
      provider: providerServiceContract.externalHandoffState.status,
      persistedState: shapedState.recovery.restartStatus.level
    },
    blockingSteps,
    reviewSteps,
    providerTickets: providerServiceContract.sourceServiceContracts.handoffTickets,
    handoffPayload: {
      ...handoffPayload,
      proof: proofToken(handoffPayload)
    },
    userVisibleState: {
      heading: needsAcceptance
        ? 'Memory mount preview needs acceptance'
        : (providerBlocked
            ? 'Memory provider handoff needs attention'
            : (operationalHealth.status === 'blocked'
                ? 'Memory mount health needs repair'
                : (activeMount ? `Memory mount ready for ${activeMount.id}` : 'Memory mount needs a scope'))),
      nextStep: route,
      canContinue: !blockingSteps.length && !needsAcceptance && !providerBlocked && !nextAction.blocked && operationalHealth.status !== 'blocked',
      retryAfter: operationalHealth.retryPolicy.nextRetryAt
    },
    proof: proofToken({
      handoffId,
      workflowLane,
      status,
      selectedView,
      route,
      activeMountId: activeMount?.id || null,
      epoch: shapedState.persistedStatePatch.epoch,
      blockingProofs: blockingSteps.map((step) => step.proof || proofToken(step)),
      reviewProofs: reviewSteps.map((step) => step.proof || proofToken(step)),
      providerTicketProofs: providerServiceContract.sourceServiceContracts.handoffTickets.map((ticket) => ticket.proof),
      payloadProof: proofToken(handoffPayload)
    })
  };

  return {
    handoffId,
    status,
    selectedView,
    route,
    routeBindings: {
      ...clientRuntime.routeBindings,
      activeRoute: route
    },
    resumeContext: {
      clientId: clientState.clientId,
      sessionId: clientState.sessionId,
      requestId: request.requestId,
      commandId: command.commandId,
      commandType: command.type,
      activeMountId: activeMount?.id || null,
      activeMountKind: activeMount?.kind || null,
      activeMountRequestedKind: activeMount?.requestedKind || activeMount?.kind || null,
      activeDescriptorKind: activeMount?.descriptor?.kind || activeMount?.kind || null,
      activeDescriptorLabel: activeMount?.descriptor?.label || null,
      activeDescriptorSummary: activeMount?.descriptor?.summary || null,
      activeDescriptorRoute: activeMount?.descriptor?.route || null,
      activeDescriptorProof: activeMount?.descriptor?.proof || null,
      activeMountScope: activeMount?.scope || null,
      activeSourceKind: activeMount?.sourceContract.sourceKind || null,
      activeSourceUri: activeMount?.sourceContract.uri || null,
      activeSourceAccessMode: activeMount?.sourceContract.accessMode || null,
      activeSourceProof: activeMount?.sourceContract.proof || null,
      activeBoundaryProof: activeMount?.boundary?.proof || null,
      activeScopeKind: activeMount?.boundary?.scopeKind || null,
      activeScopeValue: activeMount?.boundary?.scopeValue || null,
      activeIsolation: activeMount?.boundary?.isolation || null,
      epoch: shapedState.persistedStatePatch.epoch,
      readinessLevel: readiness.level,
      readinessReason: readiness.reason,
      healthStatus: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
      healthProof: operationalHealth.proof,
      healthIncidentStatus: operationalHealth.incidentPlan.status,
      healthWriteMode: operationalHealth.writePolicy.mode,
      healthWriteAllowed: operationalHealth.writePolicy.allowed,
      healthRepairStepCount: operationalHealth.repairSteps.length,
      healthIncidentProof: operationalHealth.incidentPlan.proof,
      providerServiceId: providerServiceContract.provider.serviceId,
      providerCapabilityStatus: providerServiceContract.capabilityNegotiation.status,
      providerGrantedCapabilities: providerServiceContract.capabilityNegotiation.grantedCapabilities,
      providerHandoffStatus: providerServiceContract.externalHandoffState.status,
      providerPayloadRef: providerServiceContract.externalHandoffState.payloadRef,
      providerProof: providerServiceContract.proof,
      stateJournalStatus: latestJournalEntry?.status || null,
      stateJournalProof: latestJournalEntry?.proof || null
    },
    clientStatePatch: {
      memoryMountRuntime: {
        selectedView,
        pendingHandoffId: shouldQueue ? handoffId : null,
        lastKnownEpoch: shapedState.persistedStatePatch.epoch,
        lastAcceptedToken: previewAcceptance.acceptance.accepted
          ? previewAcceptance.acceptance.token
          : clientRuntime.lastAcceptedToken,
        pendingHandoffs,
        workflowManifest,
        operationalHealth: {
          status: operationalHealth.status,
          degradedMode: operationalHealth.degradedMode,
          retryable: operationalHealth.retryable,
          consecutiveFailures: operationalHealth.consecutiveFailures,
          nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
          circuitOpen: operationalHealth.circuitBreaker.open,
          incidentStatus: operationalHealth.incidentPlan.status,
          providerHealthStale: operationalHealth.incidentPlan.providerHealthStale,
          writePolicy: operationalHealth.writePolicy,
          retryBudget: operationalHealth.retryBudget,
          repairSteps: operationalHealth.repairSteps,
          proof: operationalHealth.proof
        },
        providerService: {
          providerId: providerServiceContract.provider.providerId,
          serviceId: providerServiceContract.provider.serviceId,
          capabilityStatus: providerServiceContract.capabilityNegotiation.status,
          grantedCapabilities: providerServiceContract.capabilityNegotiation.grantedCapabilities,
          missingRequiredCapabilities: providerServiceContract.capabilityNegotiation.missingRequiredCapabilities,
          operationalStatus: providerServiceContract.operationalStatus.status,
          degradedReadOnly: providerServiceContract.operationalStatus.degradedReadOnly,
          activeFailureCount: providerServiceContract.operationalStatus.activeFailureCount,
          unavailableSourceKinds: providerServiceContract.operationalStatus.unavailableSourceKinds,
          retryAfter: providerServiceContract.operationalStatus.retryAfter,
          requiredRepair: providerServiceContract.operationalStatus.requiredRepair,
          syncMode: providerServiceContract.syncMetadata.mode,
          nextScheduledSyncAt: providerServiceContract.syncMetadata.nextScheduledSyncAt,
          externalHandoff: providerServiceContract.externalHandoffState,
          proof: providerServiceContract.proof
        },
        persistedStateStatus: {
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          journalStatus: latestJournalEntry?.status || null,
          restartLevel: shapedState.recovery.restartStatus.level,
          restartSafe: shapedState.recovery.restartSafe,
          activeMountId: shapedState.recovery.activeMountId,
          epoch: shapedState.persistedStatePatch.epoch,
          replayedCommandId: shapedState.recovery.replayedCommandId,
          replayCheckpoint: shapedState.recovery.replayCheckpoint || null,
          executionCount: shapedState.persistedStatePatch.commandExecutions?.length || 0,
          latestExecutionProof: shapedState.persistedStatePatch.commandExecutions?.at(-1)?.proof || null,
          proof: latestJournalEntry?.proof || shapedState.persistedStatePatch.stateContract.proof
        },
        routeBindings: {
          mountRoute: request.route,
          previewRoute: previewAcceptance.routeContracts.previewRoute,
          acceptanceRoute: previewAcceptance.routeContracts.acceptanceRoute,
          validationRoute: previewAcceptance.routeContracts.validationRoute,
          workflowRoute: clientRuntime.routeBindings.workflowRoute
        }
      }
    },
    workflowManifest,
    userVisibleWorkflow: needsAcceptance
      ? `Review ${command.type} preview before the memory mount is applied.`
      : (providerBlocked
          ? 'Resolve memory provider capability negotiation before continuing the workflow.'
          : (operationalHealth.status === 'blocked'
          ? 'Repair memory mount health before continuing the workflow.'
          : (nextAction.blocked
          ? 'Resolve the memory mount blocker before continuing the workflow.'
          : (activeMount
              ? `Resume workflow with ${activeMount.kind} memory ${activeMount.id}.`
              : 'Attach a memory scope before continuing the workflow.')))),
    proof: proofToken({
      handoffId,
      status,
      route,
      pendingHandoffCount: pendingHandoffs.length,
      selectedView,
      activeMountId: activeMount?.id || null,
      acceptanceAccepted: previewAcceptance.acceptance.accepted,
      healthStatus: operationalHealth.status,
      healthProof: operationalHealth.proof,
      providerCapabilityStatus: providerServiceContract.capabilityNegotiation.status,
      providerPayloadRef: providerServiceContract.externalHandoffState.payloadRef,
      providerProof: providerServiceContract.proof,
      stateJournalStatus: latestJournalEntry?.status || null,
      stateJournalProof: latestJournalEntry?.proof || null,
      workflowManifestProof: workflowManifest.proof
    })
  };
}

export function describeMemoryMountSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const request = normalizeRequest(input);
  const clientState = normalizeClientState(input);
  const memoryMountDescriptors = buildMemoryMountDescriptorCatalog({ request, clientState });
  const clientRuntime = normalizeClientRuntime(input, request, clientState);
  const principal = normalizePrincipal(input, clientState);
  const persistedState = normalizePersistedState(input);
  const command = normalizeCommand(input, request, clientState);
  const lifecycleSettings = normalizeLifecycleSettings(input, persistedState);
  const lifecycle = applyLifecycleCommand({ settings: lifecycleSettings, command, now });
  const requestedMounts = normalizeMounts(input, clientState, now);
  const recoveryDecision = shouldRecoverFromPersistedState({
    requestedMounts,
    persistedState,
    command,
    clientRuntime
  });
  const recoveredMounts = recoveryDecision.recover
    ? recoverMountsFromPersistedState(persistedState, clientState, now)
    : { accepted: [], rejected: [] };
  const mounts = recoveredMounts.accepted.length
    ? {
        accepted: recoveredMounts.accepted,
        rejected: [...requestedMounts.rejected, ...recoveredMounts.rejected]
      }
    : requestedMounts;
  const boundaryMounts = enforceMemoryBoundaries({ mounts, command, principal, clientState });
  const boundedMounts = {
    ...boundaryMounts,
    rejected: [...boundaryMounts.rejected, ...lifecycle.rejected],
    decisions: [...boundaryMounts.decisions, ...lifecycle.decisions],
    blocked: boundaryMounts.blocked || lifecycle.rejected.length > 0
  };
  const shapedState = shapePersistedState({ persistedState, command, mounts: boundedMounts, clientState, lifecycle, now });
  const workflowHandoff = buildWorkflowHandoff({ request, clientState, command, mounts: boundedMounts, lifecycle, now });
  const nextAction = workflowHandoff.nextAction;
  const validationSummary = buildValidationSummary({
    mounts: boundedMounts,
    lifecycle,
    principal,
    command,
    boundaryContract: boundaryMounts.boundaryContract,
    memoryMountDescriptors
  });
  const operationalHealth = buildOperationalHealth({
    input,
    request,
    command,
    mounts: boundedMounts,
    lifecycle,
    recovery: shapedState.recovery,
    validationSummary,
    now
  });
  const lifecycleControlState = buildLifecycleControlState({
    request,
    command,
    lifecycle,
    principal,
    mounts: boundedMounts,
    operationalHealth,
    now
  });
  const providerServiceContract = buildProviderServiceContract({
    input,
    request,
    clientState,
    principal,
    command,
    mounts: boundedMounts,
    lifecycle,
    shapedState,
    operationalHealth,
    now
  });
  const previewAcceptance = buildPreviewAcceptance({
    request,
    command,
    mounts: boundedMounts,
    lifecycle,
    persistedStatePatch: shapedState.persistedStatePatch,
    recovery: shapedState.recovery,
    nextAction,
    validationSummary,
    operationalHealth,
    input
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    request,
    clientState,
    clientRuntime,
    command,
    mounts: boundedMounts,
    previewAcceptance,
    shapedState,
    nextAction,
    operationalHealth,
    providerServiceContract,
    now
  });
  const explainableNextSteps = buildExplainableNextSteps({ nextAction, previewAcceptance, validationSummary, operationalHealth });
  const descriptorNextStepContract = buildDescriptorNextStepContract({
    request,
    command,
    mounts: boundedMounts,
    previewAcceptance,
    validationSummary,
    providerServiceContract,
    operationalHealth,
    shapedState,
    now
  });
  const analyticsReport = buildAnalyticsReport({
    request,
    command,
    shapedState,
    validationSummary,
    operationalHealth,
    previewAcceptance,
    now
  });
  const auditId = proofToken({
    surfaceId,
    request,
    clientState,
    principal,
    command,
    lifecycle: lifecycle.settings,
    lifecycleValidationIssues: lifecycle.validationIssues,
    lifecycleControlState,
    nextAction,
    clientRuntime,
    clientRuntimeHandoff,
    previewAcceptance,
    validationSummary,
    operationalHealth,
    providerServiceContract,
    memoryMountDescriptors,
    descriptorNextStepContract,
    analyticsReportProof: analyticsReport.proof,
    explainableNextSteps,
    persistedEpoch: persistedState.epoch,
    acceptedMountIds: boundedMounts.accepted.map((mount) => mount.id),
    sourceContracts: boundedMounts.accepted.map((mount) => ({
      mountId: mount.id,
      sourceKind: mount.sourceContract.sourceKind,
      accessMode: mount.sourceContract.accessMode,
      proof: mount.sourceContract.proof
    })),
    boundaryContractProof: boundaryMounts.boundaryContract?.proof || null,
    rejectedMounts: boundedMounts.rejected,
    generatedAt: now
  });

  return {
    ok: boundedMounts.rejected.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      version: 1,
      route: request.route,
      action: request.action,
      data: 'hosted-kernel-memory-mount-state',
      accepts: ['request', 'clientState', 'principal', 'mounts', 'mounts.source', 'persistedState', 'persistedState.commandJournal', 'persistedState.commandExecutions', 'command', 'settings.lifecycle', 'acceptance', 'evidence'],
      emits: [
        'runtimeState',
        'persistedStatePatch',
        'persistedStatePatch.commandJournal',
        'persistedStatePatch.commandExecutions',
        'recovery',
        'workflowHandoff',
        'clientRuntimeHandoff',
        'nextAction',
        'lifecycleControlState',
        'previewAcceptance',
        'validationSummary',
        'operationalHealth',
        'providerServiceContract',
        'analyticsReport',
        'memoryMountDescriptors',
        'descriptorNextStepContract',
        'explainableNextSteps',
        'audit'
      ]
    },
    runtimeState: {
      request,
      clientState,
      clientRuntime,
      principal: {
        principalId: principal.principalId,
        tenantId: principal.tenantId,
        workspaceId: principal.workspaceId,
        roles: principal.roles,
        permissions: principal.permissions
      },
      command,
      memoryMountDescriptors,
      lifecycle: {
        settings: lifecycle.settings,
        validationIssues: lifecycle.validationIssues,
        controls: {
          canEnable: principal.canWrite,
          canDisable: principal.canWrite,
          canSchedule: principal.canWrite,
          commandBlocked: lifecycle.rejected.length > 0,
          activeControlRoute: lifecycleControlState.route,
          nextRecommendedCommand: lifecycleControlState.nextRecommendedCommand,
          availableControls: lifecycleControlState.controls
        },
        controlState: lifecycleControlState
      },
      mounts: boundedMounts.accepted,
      rejectedMounts: boundedMounts.rejected,
      counts: {
        accepted: boundedMounts.accepted.length,
        rejected: boundedMounts.rejected.length,
        writable: boundedMounts.accepted.filter((mount) => mount.writable).length,
        recovered: shapedState.recovery.recoveredMountIds.length,
        tombstoned: shapedState.recovery.tombstonedMountIds.length,
        lifecycleValidationIssues: lifecycle.validationIssues.length,
        sourceValidationIssues: boundedMounts.accepted
          .flatMap((mount) => Array.isArray(mount.sourceValidationIssues) ? mount.sourceValidationIssues : [])
          .length,
        descriptorValidationIssues: validationSummary.descriptorValidationIssues.length
      },
      boundaryContract: boundaryMounts.boundaryContract,
      analytics: {
        counters: shapedState.persistedStatePatch.analytics.counters,
        latestSnapshot: analyticsReport.latestSnapshot,
        timelineLength: analyticsReport.timeline.length,
        reportingWindow: analyticsReport.reportingWindow.window,
        windowSignals: analyticsReport.reportingWindow.windowSignals,
        healthIncidentState: analyticsReport.healthIncidentExport.state,
        healthIncidentCount: analyticsReport.healthIncidentExport.counters.incidentCount,
        healthIncidentHighestSeverity: analyticsReport.healthIncidentExport.highestSeverity,
        healthIncidentRetryAfter: analyticsReport.healthIncidentExport.retryBudget.nextRetryAt,
        healthIncidentWritePolicy: analyticsReport.healthIncidentExport.writePolicy,
        healthIncidentRoutes: analyticsReport.healthIncidentExport.routes,
        descriptorMix: analyticsReport.reportingWindow.windowSignals.descriptorMix,
        latestDescriptorState: analyticsReport.reportingWindow.windowSignals.latestDescriptorState,
        descriptorCounters: {
          descriptorStatuses: shapedState.persistedStatePatch.analytics.counters.descriptorStatuses,
          descriptorLifecycles: shapedState.persistedStatePatch.analytics.counters.descriptorLifecycles,
          retentionPolicies: shapedState.persistedStatePatch.analytics.counters.retentionPolicies,
          scopeKinds: shapedState.persistedStatePatch.analytics.counters.scopeKinds,
          durabilityClasses: shapedState.persistedStatePatch.analytics.counters.durabilityClasses,
          sourceAccessModes: shapedState.persistedStatePatch.analytics.counters.sourceAccessModes
        },
        exportFiles: {
          json: analyticsReport.exportReady.json.fileName,
          csv: analyticsReport.exportReady.csv.fileName,
          manifest: analyticsReport.exportReady.manifest.fileName
        },
        routes: analyticsReport.routes,
        proof: analyticsReport.proof
      },
      readiness: previewAcceptance.readiness,
      descriptorNextStepContract,
      operationalHealth,
      providerServiceContract,
      restartStatus: shapedState.recovery.restartStatus,
      persistedStateStatus: {
        epoch: shapedState.persistedStatePatch.epoch,
        activeMountId: shapedState.persistedStatePatch.activeMountId,
        journalStatus: shapedState.persistedStatePatch.commandJournal?.at(-1)?.status || null,
        journalProof: shapedState.persistedStatePatch.commandJournal?.at(-1)?.proof || null,
        journalCount: shapedState.persistedStatePatch.commandJournal?.length || 0,
        executionStatus: shapedState.persistedStatePatch.commandExecutions?.at(-1)?.status || null,
        executionProof: shapedState.persistedStatePatch.commandExecutions?.at(-1)?.proof || null,
        executionCount: shapedState.persistedStatePatch.commandExecutions?.length || 0,
        replayedCommandId: shapedState.recovery.replayedCommandId,
        replayCheckpoint: shapedState.recovery.replayCheckpoint || null,
        stateContractProof: shapedState.persistedStatePatch.stateContract.proof
      },
      recoveryDecision,
      handoff: {
        status: clientRuntimeHandoff.status,
        selectedView: clientRuntimeHandoff.selectedView,
        route: clientRuntimeHandoff.route,
        pendingHandoffId: clientRuntimeHandoff.clientStatePatch.memoryMountRuntime.pendingHandoffId,
        pendingHandoffCount: clientRuntimeHandoff.clientStatePatch.memoryMountRuntime.pendingHandoffs.length
      },
      validationSummary
    },
    persistedStatePatch: shapedState.persistedStatePatch,
    recovery: shapedState.recovery,
    workflowHandoff: {
      ...workflowHandoff,
      clientRuntimePatch: clientRuntimeHandoff.clientStatePatch.memoryMountRuntime,
      handoffRoute: clientRuntimeHandoff.route,
      handoffStatus: clientRuntimeHandoff.status,
      userVisibleNextStep: clientRuntimeHandoff.userVisibleWorkflow
    },
    clientRuntimeHandoff,
    nextAction,
    lifecycleControlState,
    previewAcceptance,
    validationSummary,
    operationalHealth,
    providerServiceContract,
    memoryMountDescriptors,
    descriptorNextStepContract,
    analyticsReport,
    explainableNextSteps,
    audit: {
      auditId,
      proof: proofToken({
        auditId,
        surfaceId,
        route: request.route,
        mountCount: boundedMounts.accepted.length,
        lifecycleMode: lifecycle.settings.mode,
        lifecycleEnabled: lifecycle.settings.enabled,
        scheduleNextRunAt: lifecycle.settings.schedule.nextRunAt,
        lifecycleControlProof: lifecycleControlState.proof,
        restartStatus: shapedState.recovery.restartStatus,
        recoveryDecision,
        previewAccepted: previewAcceptance.acceptance.accepted,
        readinessLevel: previewAcceptance.readiness.level,
        healthStatus: operationalHealth.status,
        healthProof: operationalHealth.proof,
        healthIncidentProof: operationalHealth.incidentPlan.proof,
        healthWritePolicyProof: operationalHealth.writePolicy.proof,
        healthRetryBudgetProof: operationalHealth.retryBudget.proof,
        providerCapabilityStatus: providerServiceContract.capabilityNegotiation.status,
        providerHandoffStatus: providerServiceContract.externalHandoffState.status,
        providerProof: providerServiceContract.proof,
        descriptorCatalogProof: memoryMountDescriptors.proof,
        descriptorNextStepProof: descriptorNextStepContract.proof,
        nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
        analyticsProof: analyticsReport.proof,
        analyticsSnapshotId: shapedState.persistedStatePatch.analytics.lastSnapshotId,
        stateJournalStatus: shapedState.persistedStatePatch.commandJournal?.at(-1)?.status || null,
        stateJournalProof: shapedState.persistedStatePatch.commandJournal?.at(-1)?.proof || null,
        stateExecutionStatus: shapedState.persistedStatePatch.commandExecutions?.at(-1)?.status || null,
        stateExecutionProof: shapedState.persistedStatePatch.commandExecutions?.at(-1)?.proof || null,
        replayCheckpointProof: shapedState.recovery.replayCheckpoint?.proof || null,
        validationStatus: validationSummary.status,
        boundaryContractProof: boundaryMounts.boundaryContract?.proof || null,
        acceptedScopeProofs: boundaryMounts.boundaryContract?.acceptedScopes?.map((entry) => entry.proof) || [],
        rejectedScopeReasons: boundaryMounts.boundaryContract?.rejectedScopes?.map((entry) => entry.reason) || [],
        epoch: shapedState.persistedStatePatch.epoch,
        activeMountId: shapedState.recovery.activeMountId,
        handoffId: clientRuntimeHandoff.handoffId,
        handoffStatus: clientRuntimeHandoff.status,
        handoffRoute: clientRuntimeHandoff.route,
        handoffProof: clientRuntimeHandoff.proof
      }),
      decisions: [
        boundedMounts.accepted.length ? 'memory_mounts_attached' : 'memory_mounts_empty',
        boundedMounts.rejected.length ? 'memory_mount_validation_rejections_present' : 'memory_mount_validation_clean',
        clientState.selectedMountId ? 'client_selected_mount_considered' : 'client_selected_mount_absent',
        shapedState.recovery.status === 'replayed' ? 'command_idempotency_replay' : 'command_committed',
        shapedState.recovery.replayCheckpoint ? `command_replay_checkpoint_${shapedState.recovery.replayCheckpoint.source}` : 'command_replay_checkpoint_absent',
        shapedState.recovery.restartSafe ? 'restart_safe_status_ready' : 'restart_safe_status_blocked',
        principal.canCrossTenant ? 'principal_cross_tenant_capable' : 'principal_tenant_scoped',
        lifecycle.settings.enabled ? 'lifecycle_enabled' : 'lifecycle_disabled',
        lifecycle.settings.schedule.enabled ? 'lifecycle_schedule_enabled' : 'lifecycle_schedule_inactive',
        lifecycle.validationIssues.length ? 'lifecycle_settings_normalized' : 'lifecycle_settings_valid',
        `lifecycle_controls_${lifecycleControlState.status}`,
        `lifecycle_next_command_${lifecycleControlState.nextRecommendedCommand}`,
        validationSummary.sourceContracts.length ? 'source_contracts_bound' : 'source_contracts_absent',
        Object.keys(validationSummary.sourceIssueCounts).length ? 'source_contracts_normalized' : 'source_contracts_valid',
        recoveryDecision.recover ? `persisted_recovery_${recoveryDecision.reason}` : `persisted_recovery_skipped_${recoveryDecision.reason}`,
        `restart_status_${shapedState.recovery.restartStatus.level}`,
        previewAcceptance.acceptance.required ? 'preview_acceptance_required' : 'preview_acceptance_not_required',
        previewAcceptance.acceptance.accepted ? 'preview_acceptance_satisfied' : 'preview_acceptance_pending',
        `client_handoff_${clientRuntimeHandoff.status}`,
        `client_view_${clientRuntimeHandoff.selectedView}`,
        clientRuntimeHandoff.clientStatePatch.memoryMountRuntime.pendingHandoffId
          ? 'client_handoff_queued'
          : 'client_handoff_queue_cleared',
        `readiness_${previewAcceptance.readiness.level}`,
        `health_${operationalHealth.status}`,
        operationalHealth.degradedMode ? 'health_degraded_mode_active' : 'health_degraded_mode_inactive',
        operationalHealth.retryable ? 'health_retry_backoff_available' : 'health_retry_not_available',
        operationalHealth.circuitBreaker.open ? 'health_circuit_open' : 'health_circuit_closed',
        `health_incident_${operationalHealth.incidentPlan.status}`,
        `health_write_policy_${operationalHealth.writePolicy.mode}`,
        operationalHealth.writePolicy.allowed ? 'health_write_policy_allowed' : 'health_write_policy_blocked',
        operationalHealth.retryBudget.exhausted ? 'health_retry_budget_exhausted' : 'health_retry_budget_available',
        operationalHealth.incidentPlan.providerHealthStale ? 'health_provider_check_stale' : 'health_provider_check_fresh',
        `provider_capabilities_${providerServiceContract.capabilityNegotiation.status}`,
        `provider_handoff_${providerServiceContract.externalHandoffState.status}`,
        `provider_sync_${providerServiceContract.syncMetadata.mode}`,
        providerServiceContract.validationIssues.length ? 'provider_contract_requires_attention' : 'provider_contract_valid',
        `memory_descriptors_${memoryMountDescriptors.supportedKinds.join('_')}`,
        `descriptor_next_step_${descriptorNextStepContract.status}`,
        validationSummary.status === 'clean' ? 'validation_summary_clean' : 'validation_summary_requires_attention',
        boundaryMounts.boundaryContract?.acceptedScopes?.length ? 'boundary_scopes_classified' : 'boundary_scopes_absent',
        boundaryMounts.boundaryContract?.rejectedScopes?.length ? 'boundary_scope_rejections_present' : 'boundary_scope_rejections_absent',
        `analytics_snapshot_${shapedState.persistedStatePatch.analytics.lastSnapshotId || 'absent'}`,
        analyticsReport.timeline.length ? 'analytics_timeline_available' : 'analytics_timeline_empty',
        `analytics_export_json_${analyticsReport.exportReady.json.fileName}`,
        `analytics_export_csv_${analyticsReport.exportReady.csv.fileName}`,
        ...boundedMounts.decisions
      ],
      evidence: [
        ...boundedMounts.accepted.flatMap((mount) => mount.evidence),
        ...boundedMounts.accepted.map((mount) => `boundary:${mount.id}:${mount.boundary.proof}`),
        ...(boundaryMounts.boundaryContract ? [`boundary-contract:${boundaryMounts.boundaryContract.proof}`] : []),
        ...(boundaryMounts.boundaryContract?.acceptedScopes || []).map((entry) => `boundary-scope:${entry.mountId}:${entry.scopeKind}:${entry.isolation}:${entry.proof}`),
        ...(boundaryMounts.boundaryContract?.rejectedScopes || []).map((entry) => `boundary-rejection:${entry.id || 'command'}:${entry.reason}:${entry.proof || 'no-proof'}`),
        ...boundedMounts.accepted.map((mount) => `source-contract:${mount.id}:${mount.sourceContract.sourceKind}:${mount.sourceContract.proof}`),
        `lifecycle:${proofToken({ settings: lifecycle.settings, validationIssues: lifecycle.validationIssues })}`,
        `lifecycle-controls:${lifecycleControlState.status}:${lifecycleControlState.proof}`,
        ...lifecycleControlState.controls.map((control) => `lifecycle-control:${control.control}:${control.enabled ? 'enabled' : 'disabled'}:${control.proof}`),
        `preview:${previewAcceptance.acceptance.token}`,
        `handoff:${clientRuntimeHandoff.handoffId}:${clientRuntimeHandoff.proof}`,
        `client-runtime:${clientRuntime.clientId}:${clientRuntime.sessionId}:${clientRuntimeHandoff.status}`,
        `readiness:${previewAcceptance.readiness.level}:${previewAcceptance.readiness.reason}`,
        `health:${operationalHealth.status}:${operationalHealth.proof}`,
        `health-incident:${operationalHealth.incidentPlan.status}:${operationalHealth.incidentPlan.proof}`,
        `health-write-policy:${operationalHealth.writePolicy.mode}:${operationalHealth.writePolicy.proof}`,
        `health-retry-budget:${operationalHealth.retryBudget.attemptsRemaining}:${operationalHealth.retryBudget.proof}`,
        ...operationalHealth.repairSteps.map((step) => `health-repair-step:${step.type}:${step.reason}:${step.proof}`),
        ...operationalHealth.incidentPlan.incidents.map((incident) => `health-incident-item:${incident.source}:${incident.status}:${incident.proof}`),
        ...operationalHealth.errors.map((error) => `health-error:${error.reason}:${error.proof}`),
        `provider:${providerServiceContract.provider.providerId}:${providerServiceContract.proof}`,
        `provider-handoff:${providerServiceContract.externalHandoffState.status}:${providerServiceContract.externalHandoffState.payloadRef}`,
        `descriptor-catalog:${memoryMountDescriptors.proof}`,
        `descriptor-next-step:${descriptorNextStepContract.status}:${descriptorNextStepContract.proof}`,
        ...descriptorNextStepContract.lanes.map((lane) => `descriptor-next-step-lane:${lane.mountId}:${lane.status}:${lane.proof}`),
        ...memoryMountDescriptors.descriptors.map((descriptor) => `descriptor-kind:${descriptor.kind}:${descriptor.sourceKind}:${descriptor.proof}`),
        ...providerServiceContract.syncMetadata.mountSyncMetadata.map((entry) => `provider-sync:${entry.mountId}:${entry.serviceBinding}:${entry.cursor}`),
        `analytics:${shapedState.persistedStatePatch.analytics.lastSnapshotId}:${analyticsReport.proof}`,
        `analytics-export:json:${analyticsReport.exportReady.json.fileName}`,
        `analytics-export:csv:${analyticsReport.exportReady.csv.fileName}`,
        `restart:${shapedState.recovery.restartStatus.level}:${shapedState.recovery.restartStatus.reason}`,
        `state-contract:${shapedState.persistedStatePatch.stateContract.proof}`,
        ...(shapedState.recovery.replayCheckpoint ? [`state-replay:${shapedState.recovery.replayCheckpoint.source}:${shapedState.recovery.replayCheckpoint.proof}`] : []),
        ...(shapedState.persistedStatePatch.commandExecutions || []).slice(-3).map((entry) => `state-execution:${entry.status}:${entry.commandId}:${entry.proof}`),
        ...(shapedState.persistedStatePatch.commandJournal || []).slice(-3).map((entry) => `state-journal:${entry.status}:${entry.commandId}:${entry.proof}`),
        `validation:${validationSummary.status}:${proofToken(validationSummary)}`,
        ...(Array.isArray(input.evidence) ? input.evidence.filter((entry) => typeof entry === 'string' && entry.trim()) : [])
      ]
    }
  };
}

export default describeMemoryMountSurface;
