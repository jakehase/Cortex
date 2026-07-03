export const surfaceId = "aios_memory-manager_project-memory-adapter_044";
export const surfaceGroup = "memory-manager";
export const surfaceName = "project-memory-adapter";

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 125,
  maxDelayMs: 2_000,
  jitterRatio: 0.2
});

const REQUIRED_HOST_CAPABILITIES = Object.freeze([
  'projectMemory.read',
  'projectMemory.write',
  'audit.emit'
]);

const PROVIDER_ROLES = Object.freeze([
  'primary',
  'snapshot',
  'audit',
  'external-sync'
]);

const PROVIDER_ROLE_CAPABILITIES = Object.freeze({
  primary: ['projectMemory.read', 'projectMemory.write'],
  snapshot: ['projectMemory.read'],
  audit: ['audit.emit'],
  'external-sync': ['projectMemory.read']
});

const PROVIDER_SERVICE_CONTRACTS = Object.freeze({
  primary: {
    contractId: 'aios.projectMemory.provider.primary',
    minVersion: 1,
    requiredMethods: ['readProjectMemory', 'writeProjectMemory'],
    optionalMethods: ['readProjectStatus', 'writeProjectStatus'],
    handoffModes: ['local-commit', 'snapshot-export']
  },
  snapshot: {
    contractId: 'aios.projectMemory.provider.snapshot',
    minVersion: 1,
    requiredMethods: ['readProjectMemory', 'captureSnapshot'],
    optionalMethods: ['readProjectStatus'],
    handoffModes: ['snapshot-export']
  },
  audit: {
    contractId: 'aios.projectMemory.provider.audit',
    minVersion: 1,
    requiredMethods: ['emitAuditProof'],
    optionalMethods: ['emitProjectStatusProof'],
    handoffModes: ['proof-export']
  },
  'external-sync': {
    contractId: 'aios.projectMemory.provider.externalSync',
    minVersion: 1,
    requiredMethods: ['readProjectMemory', 'exportProjectMemoryDelta'],
    optionalMethods: ['readProjectStatus'],
    handoffModes: ['external-lease', 'cursor-resume']
  }
});

const PROJECT_STATUS_PROVIDER_METHODS = Object.freeze({
  read: {
    preferredMethod: 'readProjectStatus',
    fallbackMethod: 'readProjectMemory',
    capability: 'projectMemory.read',
    fallbackStrategy: 'canonical-status-memory-entry'
  },
  write: {
    preferredMethod: 'writeProjectStatus',
    fallbackMethod: 'writeProjectMemory',
    capability: 'projectMemory.write',
    fallbackStrategy: 'compare-and-swap-memory-envelope'
  }
});

const FAILURE_ACTIONS = Object.freeze({
  missing_kernel_host: 'Attach the project memory adapter to a hosted kernel before serving memory requests.',
  invalid_project_ref: 'Provide a non-empty projectId or projectRoot so memory entries can be scoped safely.',
  workspace_scope_required: 'Attach tenantId, workspaceId, and principal context before crossing hosted-kernel memory boundaries.',
  tenant_boundary_violation: 'Reject the request and reissue it inside the tenant/workspace/project boundary advertised by the hosted kernel.',
  permission_denied: 'Grant the principal the required project-memory permission or route the request through an authorized kernel role.',
  unavailable_capability: 'Enable the missing hosted-kernel capability or route the request to a read-only fallback.',
  invalid_provider_contract: 'Register providers with the required project-memory service contract id, version, and method surface for their role.',
  unhealthy_store: 'Retry with backoff; if failures persist, enter degraded read-only mode and emit audit proof.',
  invalid_evidence: 'Pass evidence as an array of proof events with stable ids, timestamps, and source labels.',
  invalid_memory_entry: 'Send project memory entries with stable keys and supported value shapes before applying the operation.',
  memory_entry_conflict: 'Send one canonical value per project memory key or mark duplicate submissions as identical idempotent retries.',
  invalid_project_status: 'Write canonical project status with a supported status, current revision, and authorized project-memory write route.',
  invalid_lifecycle_settings: 'Correct lifecycle settings before applying hosted-kernel project memory controls.',
  unavailable_provider: 'Register a hosted-kernel project memory provider with the required service role and capabilities.',
  external_handoff_blocked: 'Complete or release the external sync handoff before accepting primary project-memory writes.',
  retry_budget_exhausted: 'Stop automatic retries, emit a recovery proof, and require an operator recovery probe before accepting writes.',
  recovery_probe_required: 'Run a read-only recovery probe through the selected provider before reopening project-memory writes.'
});

const LIFECYCLE_COMMANDS = Object.freeze([
  'enable',
  'disable',
  'pause',
  'resume',
  'flush',
  'snapshot',
  'validate-settings'
]);

const DEFAULT_LIFECYCLE_SETTINGS = Object.freeze({
  enabled: true,
  autoSnapshot: true,
  syncIntervalMs: 300_000,
  snapshotIntervalMs: 900_000,
  retentionDays: 30,
  maxEntriesPerFlush: 250
});

const LIFECYCLE_COMMAND_REQUIREMENTS = Object.freeze({
  enable: ['projectMemory.read', 'audit.emit'],
  disable: ['audit.emit'],
  pause: ['audit.emit'],
  resume: ['projectMemory.read', 'audit.emit'],
  flush: ['projectMemory.write', 'audit.emit'],
  snapshot: ['projectMemory.read', 'audit.emit'],
  'validate-settings': []
});

const COMMAND_TERMINAL_STATES = Object.freeze(['applied', 'rejected', 'cancelled', 'expired']);
const MEMORY_ENTRY_TYPES = Object.freeze(['fact', 'preference', 'decision', 'task', 'artifact', 'note']);
const SCHEDULABLE_LIFECYCLE_COMMANDS = Object.freeze(['flush', 'snapshot', 'retention-sweep']);
const CANONICAL_PROJECT_STATUSES = Object.freeze([
  'unknown',
  'initializing',
  'active',
  'paused',
  'blocked',
  'read-only',
  'syncing',
  'recovering',
  'archived'
]);
const TERMINAL_PROJECT_STATUSES = Object.freeze(['archived']);
const PROJECT_STATUS_REOPEN_STATUSES = Object.freeze(['active', 'recovering', 'read-only']);
const PROJECT_STATUS_ALIASES = Object.freeze({
  init: 'initializing',
  booting: 'initializing',
  ready: 'active',
  running: 'active',
  ok: 'active',
  idle: 'paused',
  suspended: 'paused',
  hold: 'paused',
  stopped: 'paused',
  error: 'blocked',
  failed: 'blocked',
  failing: 'blocked',
  readonly: 'read-only',
  'read_only': 'read-only',
  locked: 'read-only',
  synchronizing: 'syncing',
  syncing: 'syncing',
  recovering: 'recovering',
  recovery: 'recovering',
  deleted: 'archived',
  complete: 'archived',
  completed: 'archived'
});
const MAX_MEMORY_ENTRY_BYTES = 64_000;

const MEMORY_OPERATION_PERMISSIONS = Object.freeze({
  inspect: ['projectMemory.read'],
  read: ['projectMemory.read'],
  write: ['projectMemory.write'],
  flush: ['projectMemory.write', 'audit.emit'],
  sync: ['projectMemory.write'],
  snapshot: ['projectMemory.read', 'audit.emit']
});

const PRINCIPAL_ROLE_PERMISSIONS = Object.freeze({
  owner: ['projectMemory.read', 'projectMemory.write', 'audit.emit', 'projectMemory.admin'],
  admin: ['projectMemory.read', 'projectMemory.write', 'audit.emit', 'projectMemory.admin'],
  maintainer: ['projectMemory.read', 'projectMemory.write', 'audit.emit'],
  writer: ['projectMemory.read', 'projectMemory.write'],
  reader: ['projectMemory.read'],
  auditor: ['projectMemory.read', 'audit.emit'],
  'sync-agent': ['projectMemory.read', 'projectMemory.write'],
  service: ['projectMemory.read']
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCapabilitySet(capabilities = []) {
  if (Array.isArray(capabilities)) {
    return new Set(capabilities.filter((capability) => typeof capability === 'string' && capability.length > 0));
  }

  if (isObject(capabilities)) {
    return new Set(
      Object.entries(capabilities)
        .filter(([, enabled]) => enabled === true)
        .map(([capability]) => capability)
    );
  }

  return new Set();
}

function normalizeRetryPolicy(inputPolicy = {}) {
  const maxAttempts = Number.isInteger(inputPolicy.maxAttempts) && inputPolicy.maxAttempts > 0
    ? inputPolicy.maxAttempts
    : DEFAULT_RETRY_POLICY.maxAttempts;
  const baseDelayMs = Number.isFinite(inputPolicy.baseDelayMs) && inputPolicy.baseDelayMs >= 0
    ? Math.floor(inputPolicy.baseDelayMs)
    : DEFAULT_RETRY_POLICY.baseDelayMs;
  const maxDelayMs = Number.isFinite(inputPolicy.maxDelayMs) && inputPolicy.maxDelayMs >= baseDelayMs
    ? Math.floor(inputPolicy.maxDelayMs)
    : DEFAULT_RETRY_POLICY.maxDelayMs;
  const jitterRatio = Number.isFinite(inputPolicy.jitterRatio) && inputPolicy.jitterRatio >= 0
    ? Math.min(inputPolicy.jitterRatio, 1)
    : DEFAULT_RETRY_POLICY.jitterRatio;

  return { maxAttempts, baseDelayMs, maxDelayMs, jitterRatio };
}

function buildBackoffSchedule(policy) {
  return Array.from({ length: policy.maxAttempts }, (_, index) => {
    const exponentialDelay = policy.baseDelayMs * (2 ** index);
    const delayMs = Math.min(policy.maxDelayMs, exponentialDelay);

    return {
      attempt: index + 1,
      delayMs,
      jitterWindowMs: Math.round(delayMs * policy.jitterRatio)
    };
  });
}

function normalizeStoreHealth(store = {}) {
  const status = typeof store.status === 'string' ? store.status : 'unknown';
  const lastError = isObject(store.lastError) ? store.lastError : {};
  const consecutiveFailures = Number.isInteger(store.consecutiveFailures) && store.consecutiveFailures > 0
    ? store.consecutiveFailures
    : 0;

  return {
    status,
    writable: store.writable !== false,
    readable: store.readable !== false,
    lastSuccessfulReadAt: store.lastSuccessfulReadAt || null,
    lastSuccessfulWriteAt: store.lastSuccessfulWriteAt || null,
    consecutiveFailures,
    lastError: lastError.code || lastError.message
      ? {
          code: lastError.code || 'store_error',
          message: lastError.message || 'Project memory store reported an unspecified failure.',
          retryable: lastError.retryable !== false
        }
      : null
  };
}

function validateEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [{
      code: 'invalid_evidence',
      severity: 'error',
      message: 'Project memory adapter evidence must be an array.'
    }];
  }

  return evidence.flatMap((event, index) => {
    if (!isObject(event)) {
      return [{
        code: 'invalid_evidence',
        severity: 'error',
        message: `Evidence item ${index} must be an object.`
      }];
    }

    const missing = ['id', 'source', 'timestamp'].filter((field) => !event[field]);
    return missing.length > 0
      ? [{
          code: 'invalid_evidence',
          severity: 'warning',
          message: `Evidence item ${index} is missing ${missing.join(', ')}.`
        }]
      : [];
  });
}

function normalizeLifecycleSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const enabled = source.enabled !== false;
  const paused = source.paused === true;
  const autoSnapshot = source.autoSnapshot !== false;
  const syncIntervalMs = Number.isFinite(source.syncIntervalMs)
    ? Math.floor(source.syncIntervalMs)
    : DEFAULT_LIFECYCLE_SETTINGS.syncIntervalMs;
  const snapshotIntervalMs = Number.isFinite(source.snapshotIntervalMs)
    ? Math.floor(source.snapshotIntervalMs)
    : DEFAULT_LIFECYCLE_SETTINGS.snapshotIntervalMs;
  const retentionDays = Number.isFinite(source.retentionDays)
    ? Math.floor(source.retentionDays)
    : DEFAULT_LIFECYCLE_SETTINGS.retentionDays;
  const maxEntriesPerFlush = Number.isInteger(source.maxEntriesPerFlush)
    ? source.maxEntriesPerFlush
    : DEFAULT_LIFECYCLE_SETTINGS.maxEntriesPerFlush;
  const disabledScheduledCommands = normalizeStringList(
    source.disabledScheduledCommands || source.disabledSchedules || source.disableScheduledCommand
  )
    .filter((command) => SCHEDULABLE_LIFECYCLE_COMMANDS.includes(command));
  const maxDueCommandsPerTick = Number.isInteger(source.maxDueCommandsPerTick) && source.maxDueCommandsPerTick > 0
    ? Math.min(source.maxDueCommandsPerTick, SCHEDULABLE_LIFECYCLE_COMMANDS.length)
    : 1;
  const schedulingPaused = source.schedulingPaused === true || source.automaticScheduling === false;
  const quietUntil = firstString(source.quietUntil, source.schedulingQuietUntil, source.holdSchedulingUntil);
  const scheduleAfterRecoveryProbe = source.scheduleAfterRecoveryProbe !== false;

  return {
    contract: 'aios.projectMemoryAdapter.lifecycleSettings.v1',
    enabled,
    paused,
    autoSnapshot,
    syncIntervalMs,
    snapshotIntervalMs,
    retentionDays,
    maxEntriesPerFlush,
    disabledScheduledCommands: [...new Set(disabledScheduledCommands)].sort(),
    maxDueCommandsPerTick,
    schedulingPaused,
    quietUntil,
    scheduleAfterRecoveryProbe,
    writeMode: enabled && !paused ? 'read-write' : enabled ? 'read-only-paused' : 'disabled',
    schedulingMode: enabled && !paused && !schedulingPaused ? 'automatic' : 'manual-only'
  };
}

function validateLifecycleSettings(settings, requestedCommand) {
  const findings = [];

  if (requestedCommand && !LIFECYCLE_COMMANDS.includes(requestedCommand)) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: `Unsupported lifecycle command: ${requestedCommand}.`
    });
  }

  if (settings.syncIntervalMs < 60_000 || settings.syncIntervalMs > 86_400_000) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: 'syncIntervalMs must be between 60000 and 86400000.'
    });
  }

  if (settings.snapshotIntervalMs < settings.syncIntervalMs) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'warning',
      message: 'snapshotIntervalMs should be greater than or equal to syncIntervalMs.'
    });
  }

  if (settings.retentionDays < 1 || settings.retentionDays > 365) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: 'retentionDays must be between 1 and 365.'
    });
  }

  if (settings.maxEntriesPerFlush < 1 || settings.maxEntriesPerFlush > 5_000) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: 'maxEntriesPerFlush must be between 1 and 5000.'
    });
  }

  if (!settings.enabled && settings.paused) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'warning',
      message: 'paused is ignored while lifecycle settings are disabled.'
    });
  }

  if (!settings.autoSnapshot && requestedCommand === 'snapshot') {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'warning',
      message: 'Manual snapshot was requested while autoSnapshot is disabled; command may still be applied with audit proof.'
    });
  }

  if (settings.quietUntil && toEpochMs(settings.quietUntil) === null) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: 'quietUntil must be an ISO-compatible timestamp when provided.'
    });
  }

  if (!Number.isInteger(settings.maxDueCommandsPerTick) || settings.maxDueCommandsPerTick < 1 || settings.maxDueCommandsPerTick > SCHEDULABLE_LIFECYCLE_COMMANDS.length) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'error',
      message: `maxDueCommandsPerTick must be between 1 and ${SCHEDULABLE_LIFECYCLE_COMMANDS.length}.`
    });
  }

  if (settings.disabledScheduledCommands.length === SCHEDULABLE_LIFECYCLE_COMMANDS.length) {
    findings.push({
      code: 'invalid_lifecycle_settings',
      severity: 'warning',
      message: 'All scheduled lifecycle commands are disabled; lifecycle automation will remain manual-only.'
    });
  }

  return findings;
}

function deriveLifecycleSettingsTransition({ now, command, currentSettings, commandAdmission, providerNegotiation, tenantBoundary }) {
  const effectiveSettings = { ...currentSettings };
  const requestedSettings = { ...currentSettings };
  const appliedChanges = [];
  const proposedChanges = [];

  const setRequested = (field, value) => {
    if (requestedSettings[field] !== value) {
      proposedChanges.push({
        field,
        from: requestedSettings[field],
        to: value
      });
      requestedSettings[field] = value;
    }
  };

  if (command === 'enable') {
    setRequested('enabled', true);
    setRequested('paused', false);
  } else if (command === 'disable') {
    setRequested('enabled', false);
    setRequested('paused', false);
  } else if (command === 'pause') {
    setRequested('paused', true);
  } else if (command === 'resume') {
    setRequested('paused', false);
  } else if (command === 'flush') {
    setRequested('lastManualFlushRequestedAt', now);
  } else if (command === 'snapshot') {
    setRequested('lastManualSnapshotRequestedAt', now);
  }

  if (commandAdmission.allowed) {
    for (const change of proposedChanges) {
      effectiveSettings[change.field] = change.to;
      appliedChanges.push(change);
    }
  }

  effectiveSettings.writeMode = effectiveSettings.enabled && !effectiveSettings.paused
    ? 'read-write'
    : effectiveSettings.enabled
      ? 'read-only-paused'
      : 'disabled';
  effectiveSettings.schedulingMode = effectiveSettings.enabled && !effectiveSettings.paused
    && !effectiveSettings.schedulingPaused
    ? 'automatic'
    : 'manual-only';

  return {
    contract: 'aios.projectMemoryAdapter.lifecycleSettingsTransition.v1',
    evaluatedAt: now,
    state: !command
      ? 'unchanged'
      : commandAdmission.allowed
        ? appliedChanges.length > 0
          ? 'applied'
          : 'idempotent'
        : 'rejected',
    command: command || null,
    currentSettings,
    requestedSettings,
    effectiveSettings,
    appliedChanges,
    proposedChanges,
    blockedReasons: commandAdmission.blockedReasons,
    persistence: {
      required: commandAdmission.allowed && appliedChanges.length > 0,
      reason: appliedChanges.length > 0 ? 'lifecycle-settings-mutated' : null,
      checkpointKey: `${surfaceId}:${tenantBoundary?.isolationKey || 'unscoped'}:lifecycle-settings`
    },
    proof: {
      required: Boolean(command) && command !== 'validate-settings',
      route: command === 'disable' || command === 'pause' || command === 'snapshot'
        ? providerNegotiation?.auditRoute || null
        : command === 'flush'
          ? providerNegotiation?.writeRoute || null
          : providerNegotiation?.readRoute || providerNegotiation?.auditRoute || null,
      subject: tenantBoundary?.auditSubject || null,
      id: command
        ? stableProjectMemoryHash({
            surfaceId,
            isolationKey: tenantBoundary?.isolationKey,
            command,
            requestedSettings,
            state: commandAdmission.state
          })
        : null
    }
  };
}

function buildLifecycleCommandDispatches({ command, transition, commandAdmission, providerNegotiation }) {
  if (!command) {
    return [];
  }

  const dispatches = [];
  const base = {
    id: transition.proof.id,
    command,
    state: commandAdmission.allowed ? 'ready' : 'blocked',
    blockedReasons: commandAdmission.blockedReasons
  };

  if (command === 'flush') {
    dispatches.push({
      ...base,
      type: 'project-memory.flush',
      route: providerNegotiation?.writeRoute || null,
      requiresWritableRoute: true
    });
  } else if (command === 'snapshot') {
    dispatches.push({
      ...base,
      type: 'project-memory.snapshot',
      route: providerNegotiation?.auditRoute || providerNegotiation?.readRoute || null,
      requiresWritableRoute: false
    });
  } else if (['enable', 'disable', 'pause', 'resume'].includes(command)) {
    dispatches.push({
      ...base,
      type: 'project-memory.lifecycle-settings',
      route: transition.proof.route,
      appliedChanges: transition.appliedChanges,
      effectiveWriteMode: transition.effectiveSettings.writeMode,
      schedulingMode: transition.effectiveSettings.schedulingMode
    });
  } else if (command === 'validate-settings') {
    dispatches.push({
      ...base,
      type: 'project-memory.validate-settings',
      route: providerNegotiation?.readRoute || providerNegotiation?.auditRoute || null,
      requiresWritableRoute: false
    });
  }

  if (transition.proof.required) {
    dispatches.push({
      id: `${transition.proof.id}:proof`,
      type: 'project-memory.lifecycle-proof',
      route: providerNegotiation?.auditRoute || null,
      state: providerNegotiation?.auditRoute ? 'ready' : 'blocked',
      proofId: transition.proof.id,
      subject: transition.proof.subject
    });
  }

  return dispatches;
}

function normalizeHistoryEvent(event, index) {
  if (!isObject(event)) {
    return null;
  }

  const operation = typeof event.operation === 'string' && event.operation.length > 0
    ? event.operation
    : 'unknown';
  const status = typeof event.status === 'string' && event.status.length > 0
    ? event.status
    : 'unknown';
  const timestamp = typeof event.timestamp === 'string' && event.timestamp.length > 0
    ? event.timestamp
    : null;
  const durationMs = Number.isFinite(event.durationMs) && event.durationMs >= 0
    ? Math.round(event.durationMs)
    : null;
  const entryCount = Number.isInteger(event.entryCount) && event.entryCount >= 0
    ? event.entryCount
    : 0;

  return {
    id: event.id || `history-${index + 1}`,
    timestamp,
    operation,
    status,
    entryCount,
    durationMs,
    bytes: Number.isInteger(event.bytes) && event.bytes >= 0 ? event.bytes : 0,
    snapshotId: event.snapshotId || null,
    proofId: event.proofId || null,
    route: event.route || surfaceId,
    errorCode: event.errorCode || event.error?.code || null
  };
}

function stableProjectMemoryHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return `pmem-${Math.abs(hash).toString(36)}`;
}

function byteLengthOf(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function normalizeEntryValue(entry) {
  if ('value' in entry) return entry.value;
  if ('content' in entry) return entry.content;
  if ('text' in entry) return entry.text;
  if ('data' in entry) return entry.data;
  return null;
}

function normalizeMemoryEntry(entry, index, { now, projectRef }) {
  if (!isObject(entry)) {
    return {
      entry: null,
      finding: {
        code: 'invalid_memory_entry',
        severity: 'error',
        message: `Project memory entry ${index} must be an object.`
      }
    };
  }

  const key = firstString(entry.key, entry.id, entry.name, entry.path);
  const type = MEMORY_ENTRY_TYPES.includes(entry.type) ? entry.type : 'note';
  const value = normalizeEntryValue(entry);
  const tags = normalizeStringList(entry.tags || entry.tag);
  const valueBytes = value === null ? 0 : byteLengthOf(value);
  const entryFindings = [];

  if (!key) {
    entryFindings.push({
      code: 'invalid_memory_entry',
      severity: 'error',
      message: `Project memory entry ${index} is missing a stable key.`
    });
  }

  if (value === null || typeof value === 'undefined') {
    entryFindings.push({
      code: 'invalid_memory_entry',
      severity: 'error',
      message: `Project memory entry ${key || index} is missing a value.`
    });
  } else if (!['string', 'number', 'boolean'].includes(typeof value) && !isObject(value) && !Array.isArray(value)) {
    entryFindings.push({
      code: 'invalid_memory_entry',
      severity: 'error',
      message: `Project memory entry ${key || index} has an unsupported value type.`
    });
  }

  if (valueBytes > MAX_MEMORY_ENTRY_BYTES) {
    entryFindings.push({
      code: 'invalid_memory_entry',
      severity: 'error',
      message: `Project memory entry ${key || index} exceeds ${MAX_MEMORY_ENTRY_BYTES} bytes.`
    });
  }

  return {
    entry: key && entryFindings.length === 0
      ? {
          contract: 'aios.projectMemoryAdapter.memoryEntry.v1',
          key,
          type,
          projectRef,
          valueShape: Array.isArray(value) ? 'array' : isObject(value) ? 'object' : typeof value,
          valueBytes,
          hash: stableProjectMemoryHash({ key, type, value }),
          tags,
          source: firstString(entry.source, entry.sourceRef, entry.origin) || 'client-request',
          updatedAt: firstString(entry.updatedAt, entry.timestamp, entry.createdAt) || now,
          ttlMs: Number.isFinite(entry.ttlMs) && entry.ttlMs > 0 ? Math.floor(entry.ttlMs) : null,
          sensitivity: firstString(entry.sensitivity, entry.classification) || 'project',
          mergeStrategy: firstString(entry.mergeStrategy, entry.strategy) || 'replace'
        }
      : null,
    findings: entryFindings
  };
}

function buildMemoryEntryDuplicateReport(entries) {
  const groupsByKey = new Map();

  entries.forEach((entry, index) => {
    const existing = groupsByKey.get(entry.key) || [];
    existing.push({ entry, index });
    groupsByKey.set(entry.key, existing);
  });

  const groups = [...groupsByKey.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const hashCounts = items.reduce((counts, item) => {
        counts[item.entry.hash] = (counts[item.entry.hash] || 0) + 1;
        return counts;
      }, {});
      const hashes = Object.keys(hashCounts).sort();
      const strategySet = new Set(items.map((item) => item.entry.mergeStrategy));
      const sourceSet = new Set(items.map((item) => item.entry.source));
      const canonicalItem = items[0];
      const conflicting = hashes.length > 1;

      return {
        contract: 'aios.projectMemoryAdapter.memoryEntryDuplicateGroup.v1',
        key,
        duplicateCount: items.length,
        conflicting,
        canonicalHash: canonicalItem.entry.hash,
        hashes,
        hashCounts,
        mergeStrategies: [...strategySet].sort(),
        sources: [...sourceSet].sort(),
        canonicalOrder: canonicalItem.index + 1,
        duplicateOrders: items.slice(1).map((item) => item.index + 1),
        resolution: conflicting ? 'blocked-for-client-resolution' : 'coalesced-idempotent-duplicates'
      };
    });
  const conflictGroups = groups.filter((group) => group.conflicting);

  return {
    contract: 'aios.projectMemoryAdapter.memoryEntryDuplicateReport.v1',
    duplicateKeyCount: groups.length,
    idempotentDuplicateKeyCount: groups.length - conflictGroups.length,
    conflictKeyCount: conflictGroups.length,
    groups,
    conflictGroups,
    findings: conflictGroups.map((group) => ({
      code: 'memory_entry_conflict',
      severity: 'error',
      message: `Project memory entry key "${group.key}" has ${group.hashes.length} conflicting values in the same request.`,
      key: group.key
    }))
  };
}

function coalesceIdempotentMemoryEntries(entries, duplicateReport) {
  if (duplicateReport.groups.length === 0) {
    return entries;
  }

  const duplicateByKey = new Map(duplicateReport.groups.map((group) => [group.key, group]));
  const emittedKeys = new Set();

  return entries.filter((entry) => {
    const duplicateGroup = duplicateByKey.get(entry.key);

    if (!duplicateGroup || duplicateGroup.conflicting) {
      return true;
    }

    if (emittedKeys.has(entry.key)) {
      return false;
    }

    emittedKeys.add(entry.key);
    return true;
  });
}

function normalizeMemoryEntries(input = {}, { now, projectRef }) {
  const requestSource = isObject(input.request)
    ? input.request
    : isObject(input.memoryRequest)
      ? input.memoryRequest
      : {};
  const rawEntries = Array.isArray(input.entries)
    ? input.entries
    : Array.isArray(input.memoryEntries)
      ? input.memoryEntries
      : Array.isArray(requestSource.entries)
        ? requestSource.entries
        : [];
  const normalized = rawEntries.map((entry, index) => normalizeMemoryEntry(entry, index, { now, projectRef }));
  const validEntries = normalized.map((result) => result.entry).filter(Boolean);
  const duplicateReport = buildMemoryEntryDuplicateReport(validEntries);
  const entries = coalesceIdempotentMemoryEntries(validEntries, duplicateReport);

  return {
    contract: 'aios.projectMemoryAdapter.memoryEntrySet.v1',
    requestedEntryCount: rawEntries.length,
    entries,
    rawValidEntryCount: validEntries.length,
    coalescedDuplicateEntryCount: Math.max(validEntries.length - entries.length, 0),
    duplicateReport,
    findings: normalized
      .flatMap((result) => result.findings || (result.finding ? [result.finding] : []))
      .concat(duplicateReport.findings)
  };
}

function buildOperationAcceptanceActions(blockedReasons) {
  const actionByReason = {
    'invalid-memory-entry': 'Fix invalid memory entries before applying this request.',
    'memory-entry-key-conflict': 'Resolve duplicate project memory keys so each write has one canonical value.',
    'no-memory-entries': 'Add at least one project memory entry or switch the request to inspect mode.',
    'write-route-not-available': 'Use read-only preview until a writable hosted-kernel route is available.',
    'tenant-boundary-not-accepted': 'Resolve tenant, workspace, project, and principal scope before applying memory changes.',
    'permission-grant-denied': 'Use a principal or hosted-kernel grant that does not deny this project-memory operation.',
    'external-handoff-blocks-write': 'Wait for the external sync handoff lease to release before accepting writes.',
    'recovery-gate-blocks-write': 'Run the required recovery probe before accepting project-memory writes.'
  };

  return blockedReasons.map((reason, index) => ({
    order: index + 1,
    reason,
    action: actionByReason[reason] || 'Inspect the project memory operation audit proof before continuing.'
  }));
}

function buildEntryAcceptanceRows({ entrySet, writeLikeOperation, route, blockedReasons, tenantBoundary, lifecycle, failureRecovery, externalHandoff }) {
  const globalBlockers = [...blockedReasons];
  const writable = writeLikeOperation
    && lifecycle.canWrite
    && tenantBoundary.allowed
    && failureRecovery.writeAdmission === 'open'
    && !externalHandoff.blocksWrites;
  const readable = !writeLikeOperation && lifecycle.canRead && tenantBoundary.allowed;
  const acceptedState = writeLikeOperation ? 'will-upsert' : 'inspect-only';

  const validRows = entrySet.entries.map((entry, index) => {
    const blocked = writeLikeOperation ? !writable : !readable;
    return {
      contract: 'aios.projectMemoryAdapter.entryAcceptanceRow.v1',
      order: index + 1,
      key: entry.key,
      type: entry.type,
      hash: entry.hash,
      valueShape: entry.valueShape,
      valueBytes: entry.valueBytes,
      sensitivity: entry.sensitivity,
      mergeStrategy: entry.mergeStrategy,
      route,
      state: blocked ? 'blocked' : acceptedState,
      accepted: !blocked,
      previewOnly: !writeLikeOperation,
      proofInputs: {
        projectRef: entry.projectRef,
        isolationKey: tenantBoundary.isolationKey,
        source: entry.source,
        updatedAt: entry.updatedAt
      },
      blockedReasons: blocked ? globalBlockers : []
    };
  });

  const invalidRows = entrySet.findings.map((finding, index) => ({
    contract: 'aios.projectMemoryAdapter.entryAcceptanceRow.v1',
    order: validRows.length + index + 1,
    key: finding.key || null,
    type: null,
    hash: null,
    valueShape: 'invalid',
    valueBytes: 0,
    sensitivity: 'unknown',
    mergeStrategy: null,
    route,
    state: 'rejected',
    accepted: false,
    previewOnly: false,
    proofInputs: {
      projectRef: tenantBoundary.projectRef,
      isolationKey: tenantBoundary.isolationKey,
      source: 'validation',
      updatedAt: null
    },
    blockedReasons: finding.code === 'memory_entry_conflict'
      ? ['memory-entry-key-conflict']
      : ['invalid-memory-entry'],
    finding: {
      code: finding.code,
      severity: finding.severity,
      message: finding.message
    }
  }));

  return validRows.concat(invalidRows);
}

function summarizeEntryAcceptance(rows) {
  const counts = rows.reduce((summary, row) => {
    summary.total += 1;
    summary.bytes += row.valueBytes;
    summary.byState[row.state] = (summary.byState[row.state] || 0) + 1;
    if (row.accepted) summary.accepted += 1;
    if (row.state === 'blocked') summary.blocked += 1;
    if (row.state === 'rejected') summary.rejected += 1;
    return summary;
  }, {
    total: 0,
    accepted: 0,
    blocked: 0,
    rejected: 0,
    bytes: 0,
    byState: {}
  });

  return {
    contract: 'aios.projectMemoryAdapter.entryAcceptanceSummary.v1',
    state: counts.rejected > 0
      ? 'entry-validation-failed'
      : counts.blocked > 0
        ? 'blocked'
        : counts.accepted > 0
          ? 'accepted'
          : 'empty',
    totalEntries: counts.total,
    acceptedEntries: counts.accepted,
    blockedEntries: counts.blocked,
    rejectedEntries: counts.rejected,
    byteEstimate: counts.bytes,
    byState: counts.byState
  };
}

function buildMemoryOperationPlan({ now, clientState, entries, lifecycle, tenantBoundary, providerNegotiation, externalHandoff, failureRecovery }) {
  const writeLikeOperation = clientState.operation === 'write' || clientState.pendingMutationCount > 0;
  const route = writeLikeOperation ? providerNegotiation.writeRoute : providerNegotiation.readRoute;
  const entryShapeFindings = entries.findings.filter((finding) => finding.code !== 'memory_entry_conflict');
  const conflictFindings = entries.findings.filter((finding) => finding.code === 'memory_entry_conflict');
  const blockedReasons = [];

  if (entryShapeFindings.length > 0) blockedReasons.push('invalid-memory-entry');
  if (conflictFindings.length > 0) blockedReasons.push('memory-entry-key-conflict');
  if (writeLikeOperation && entries.entries.length === 0) blockedReasons.push('no-memory-entries');
  if (writeLikeOperation && !lifecycle.canWrite) blockedReasons.push('write-route-not-available');
  if (!tenantBoundary.allowed) blockedReasons.push('tenant-boundary-not-accepted');
  if (tenantBoundary.deniedPermissions.length > 0) blockedReasons.push('permission-grant-denied');
  if (externalHandoff.blocksWrites && writeLikeOperation) blockedReasons.push('external-handoff-blocks-write');
  if (failureRecovery.writeAdmission !== 'open' && writeLikeOperation) blockedReasons.push('recovery-gate-blocks-write');

  const batches = entries.entries.reduce((groups, entry, index) => {
    const batchIndex = Math.floor(index / 50);
    if (!groups[batchIndex]) {
      groups[batchIndex] = {
        batchId: `memory-batch-${batchIndex + 1}`,
        operation: writeLikeOperation ? 'upsert' : 'inspect',
        route,
        entryCount: 0,
        byteEstimate: 0,
        entryKeys: [],
        hashes: []
      };
    }

    groups[batchIndex].entryCount += 1;
    groups[batchIndex].byteEstimate += entry.valueBytes;
    groups[batchIndex].entryKeys.push(entry.key);
    groups[batchIndex].hashes.push(entry.hash);
    return groups;
  }, []);
  const entryAcceptanceRows = buildEntryAcceptanceRows({
    entrySet: entries,
    writeLikeOperation,
    route,
    blockedReasons,
    tenantBoundary,
    lifecycle,
    failureRecovery,
    externalHandoff
  });
  const entryAcceptanceSummary = summarizeEntryAcceptance(entryAcceptanceRows);

  return {
    contract: 'aios.projectMemoryAdapter.memoryOperationPlan.v1',
    generatedAt: now,
    projectRef: clientState.projectRef,
    operation: clientState.operation,
    requestedEntryCount: entries.requestedEntryCount,
    rawValidEntryCount: entries.rawValidEntryCount,
    coalescedDuplicateEntryCount: entries.coalescedDuplicateEntryCount,
    duplicateReport: entries.duplicateReport,
    state: blockedReasons.length === 0 ? 'ready' : writeLikeOperation ? 'blocked' : 'inspect-only',
    route,
    isolationKey: tenantBoundary.isolationKey,
    writeAdmission: failureRecovery.writeAdmission,
    blockedReasons,
    entries: entries.entries,
    findings: entries.findings.concat(
      writeLikeOperation && entries.requestedEntryCount === 0
        ? [{
            code: 'invalid_memory_entry',
            severity: 'warning',
            message: 'Write-like project memory request did not include entries to apply.'
          }]
        : []
    ),
    batches,
    entryAcceptance: {
      contract: 'aios.projectMemoryAdapter.entryAcceptance.v1',
      generatedAt: now,
      writeLikeOperation,
      route,
      summary: entryAcceptanceSummary,
      rows: entryAcceptanceRows,
      actions: buildOperationAcceptanceActions(blockedReasons)
    },
    proofRequirements: [
      'entry-key-validation',
      'entry-shape-validation',
      'entry-content-fingerprint',
      'tenant-isolation-key',
      'permission-grant-evaluation',
      writeLikeOperation ? 'write-route-admission' : 'read-route-admission'
    ]
  };
}

function normalizeCanonicalProjectStatusValue(value) {
  if (typeof value !== 'string') {
    return {
      status: 'unknown',
      rawStatus: null,
      supported: false,
      normalizedFromAlias: false
    };
  }

  const rawStatus = value.trim();
  const normalized = rawStatus.toLowerCase().replace(/\s+/g, '-');
  const directCanonical = CANONICAL_PROJECT_STATUSES.includes(normalized);
  const status = CANONICAL_PROJECT_STATUSES.includes(normalized)
    ? normalized
    : PROJECT_STATUS_ALIASES[normalized] || 'unknown';

  return {
    status,
    rawStatus,
    supported: directCanonical || Boolean(PROJECT_STATUS_ALIASES[normalized]),
    normalizedFromAlias: Boolean(PROJECT_STATUS_ALIASES[normalized])
  };
}

function buildProjectStatusDispatch({ now, current, writeRequest, nextRecord, blockedReasons, providerNegotiation, tenantBoundary, clientState, statusKey, providerContract, statusWriteGuard }) {
  const readDispatch = {
    contract: 'aios.projectMemoryAdapter.projectStatusDispatch.v1',
    type: 'project-status.read',
    state: providerContract.read.ready ? 'ready' : 'blocked',
    route: providerContract.read.route || providerNegotiation.readRoute,
    providerId: providerContract.read.providerId,
    method: providerContract.read.selectedMethod,
    strategy: providerContract.read.strategy,
    statusKey,
    projectRef: clientState.projectRef,
    expectedRevision: null,
    blockedReasons: providerContract.read.ready ? [] : providerContract.read.blockedReasons
  };

  if (!writeRequest.requested) {
    return [readDispatch];
  }

  return [
    readDispatch,
    {
      contract: 'aios.projectMemoryAdapter.projectStatusDispatch.v1',
      type: 'project-status.write',
      state: statusWriteGuard?.idempotentNoop
        ? 'idempotent'
        : blockedReasons.length === 0 && providerContract.write.ready
          ? 'ready'
          : 'blocked',
      route: providerContract.write.route || providerNegotiation.writeRoute,
      providerId: providerContract.write.providerId,
      method: providerContract.write.selectedMethod,
      strategy: providerContract.write.strategy,
      commitRequired: statusWriteGuard?.commitRequired === true,
      statusKey,
      projectRef: clientState.projectRef,
      requestedAt: writeRequest.requestedAt || now,
      requestedBy: writeRequest.requestedBy || tenantBoundary.principal.id,
      expectedRevision: writeRequest.expectedRevision,
      currentRevision: current.revision,
      nextRevision: nextRecord?.revision ?? null,
      nextStatus: nextRecord?.status || null,
      idempotencyKey: `${surfaceId}:${tenantBoundary.isolationKey || 'unscoped'}:${clientState.requestId}:project-status`,
      proofId: nextRecord?.proofId || null,
      blockedReasons: [...new Set(blockedReasons.concat(providerContract.write.ready ? [] : providerContract.write.blockedReasons))]
    }
  ];
}

function buildProjectStatusPersistencePlan({ current, nextRecord, writeRequest, blockedReasons, persistedEnvelope, statusKey, tenantBoundary, clientState, statusWriteGuard }) {
  const persistRequired = writeRequest.requested
    && blockedReasons.length === 0
    && statusWriteGuard?.commitRequired !== false;

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusPersistencePlan.v1',
    checkpointId: persistedEnvelope.checkpointId,
    persistRequired,
    statusKey,
    strategy: persistRequired ? 'compare-and-swap' : 'read-only',
    writeGuardState: statusWriteGuard?.state || null,
    commitRequired: persistRequired,
    compareAndSwap: {
      key: statusKey,
      expectedRevision: writeRequest.expectedRevision ?? current.revision,
      expectedProofId: current.proofId || null,
      nextRevision: persistRequired ? nextRecord.revision : current.revision,
      nextProofId: persistRequired ? nextRecord.proofId : current.proofId || null
    },
    idempotencyKey: `${surfaceId}:${tenantBoundary.isolationKey || 'unscoped'}:${clientState.requestId}:project-status`,
    checkpointStatus: persistRequired ? nextRecord.status : current.status,
    checkpointRevision: persistRequired ? nextRecord.revision : current.revision,
    blockedReasons
  };
}

function buildProjectStatusWorkflowHandoff({ now, current, writeRequest, nextRecord, blockedReasons, providerContract, persistencePlan, dispatches, tenantBoundary, clientState, statusKey, failedItems, statusBoundary, statusWriteGuard }) {
  const writeDispatch = dispatches.find((dispatch) => dispatch.type === 'project-status.write') || null;
  const readDispatch = dispatches.find((dispatch) => dispatch.type === 'project-status.read') || null;
  const handoffRoute = writeRequest.requested
    ? writeDispatch?.route || providerContract.write.route || providerContract.read.route
    : readDispatch?.route || providerContract.read.route;
  const accepted = writeRequest.requested
    ? blockedReasons.length === 0 && (providerContract.write.ready || statusWriteGuard?.idempotentNoop)
    : providerContract.read.ready;
  const resumeToken = stableProjectMemoryHash({
    surfaceId,
    isolationKey: tenantBoundary.isolationKey,
    requestId: clientState.requestId,
    statusKey,
    status: nextRecord?.status || current.status,
    revision: nextRecord?.revision ?? current.revision,
    blockedReasons
  });
  const compareAndSwap = persistencePlan.compareAndSwap || {};
  const commitEnvelope = writeRequest.requested
    ? {
        contract: 'aios.projectMemoryAdapter.projectStatusCommitEnvelope.v1',
        state: statusWriteGuard?.idempotentNoop ? 'idempotent-noop' : accepted ? 'ready' : 'blocked',
        route: providerContract.write.route,
        providerId: providerContract.write.providerId,
        method: providerContract.write.selectedMethod,
        idempotencyKey: persistencePlan.idempotencyKey,
        proofId: nextRecord?.proofId || null,
        commitRequired: statusWriteGuard?.commitRequired === true,
        statusKey,
        current: {
          status: current.status,
          revision: current.revision,
          proofId: current.proofId || null
        },
        next: accepted
          ? {
              status: nextRecord.status,
              revision: nextRecord.revision,
              proofId: nextRecord.proofId,
              updatedAt: nextRecord.updatedAt,
              updatedBy: nextRecord.updatedBy
            }
          : null,
        compareAndSwap: {
          expectedRevision: compareAndSwap.expectedRevision ?? current.revision,
          expectedProofId: compareAndSwap.expectedProofId || null,
          nextRevision: compareAndSwap.nextRevision ?? null,
          nextProofId: compareAndSwap.nextProofId || null
        },
        boundary: statusBoundary.commitBoundary
      }
    : null;
  const blockedActionItems = failedItems.map((item, index) => ({
    order: index + 1,
    code: item.blockingReason,
    label: item.label,
    action: item.action,
    route: item.id.includes('write') ? providerContract.write.route : providerContract.read.route,
    retryableAfterRefresh: item.blockingReason === 'stale-status-revision'
      || item.blockingReason === 'status-provider-read-not-bound'
      || item.blockingReason === 'status-provider-write-not-bound'
  }));
  const dispatchActionItems = dispatches.map((dispatch, index) => ({
    order: index + 1,
    code: dispatch.type,
    action: dispatch.state === 'idempotent'
      ? 'Return the current canonical project status without dispatching a write.'
      : dispatch.state === 'ready'
        ? dispatch.type === 'project-status.write'
        ? 'Commit canonical project status through the selected provider method.'
        : 'Refresh canonical project status before presenting the workflow.'
        : 'Hold this workflow step until the provider route is ready.',
    route: dispatch.route,
    providerId: dispatch.providerId,
    method: dispatch.method,
    blockedReasons: dispatch.blockedReasons
  }));

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusWorkflowHandoff.v1',
    generatedAt: now,
    state: writeRequest.requested
      ? accepted
        ? statusWriteGuard?.idempotentNoop
          ? 'idempotent-noop'
          : 'ready-for-commit'
        : 'blocked-before-commit'
      : accepted
        ? 'ready-for-refresh'
        : 'blocked-before-refresh',
    requestId: clientState.requestId,
    resumeToken,
    statusKey,
    route: handoffRoute || null,
    isolationKey: tenantBoundary.isolationKey,
    auditSubject: tenantBoundary.auditSubject,
    mode: writeRequest.requested ? 'write' : 'read',
    userVisible: {
      headline: accepted
        ? writeRequest.requested
          ? statusWriteGuard?.idempotentNoop
            ? `Project status is already ${current.status}; no checkpoint write is required.`
            : `Status update to ${nextRecord?.status || writeRequest.status} is ready to apply.`
          : `Project status ${current.status} is ready to refresh.`
        : blockedActionItems[0]?.action || 'Project status workflow is waiting for a provider route.',
      currentStatus: current.status,
      currentRevision: current.revision,
      nextStatus: nextRecord?.status || (writeRequest.requested ? writeRequest.status : current.status),
      nextRevision: nextRecord?.revision ?? (writeRequest.requested ? (writeRequest.revision ?? current.revision + 1) : current.revision),
      writeGuardState: statusWriteGuard?.state || null,
      blockedReasons
    },
    commitEnvelope,
    refreshEnvelope: {
      contract: 'aios.projectMemoryAdapter.projectStatusRefreshEnvelope.v1',
      state: providerContract.read.ready ? 'ready' : 'blocked',
      route: providerContract.read.route,
      providerId: providerContract.read.providerId,
      method: providerContract.read.selectedMethod,
      statusKey,
      consistency: current.proofId || current.snapshotId ? 'proof-backed' : 'best-effort'
    },
    proof: {
      required: writeRequest.requested || blockedReasons.length > 0,
      proofId: nextRecord?.proofId || resumeToken,
      idempotencyKey: persistencePlan.idempotencyKey,
      expectedSubject: tenantBoundary.auditSubject,
      proofInputs: {
        requestId: clientState.requestId,
        statusKey,
        fromStatus: current.status,
        toStatus: nextRecord?.status || writeRequest.status || current.status,
        expectedRevision: persistencePlan.compareAndSwap.expectedRevision,
        boundaryState: statusBoundary.state,
        boundaryProofId: statusBoundary.proof.proofId,
        blockedReasons
      }
    },
    actions: blockedActionItems.length > 0 ? blockedActionItems : dispatchActionItems
  };
}

function buildProjectStatusClientContract({ now, current, writeRequest, nextRecord, blockedReasons, providerContract, persistencePlan, dispatches, tenantBoundary, clientState, lifecycle, failureRecovery, externalHandoff, memoryOperationPlan, statusKey, statusBoundary, statusWriteGuard }) {
  const reasonActions = {
    'unsupported-status': 'Choose one of the canonical project statuses before saving.',
    'stale-status-revision': 'Refresh project status and retry with the latest revision.',
    'non-advancing-status-revision': 'Use a revision greater than the current project status revision.',
    'status-boundary-mismatch': 'Refresh project status from the tenant/workspace route before writing.',
    'status-boundary-unscoped': 'Attach a tenant/workspace/project boundary to the status record before writing.',
    'status-revision-gap': 'Refresh project status and retry with the next consecutive revision.',
    'terminal-status-reopen-blocked': 'Provide an audited terminal reopen request before changing an archived project status.',
    'status-write-route-not-admitted': 'Wait for the hosted-kernel write route to become available.',
    'memory-operation-blocked': 'Resolve blocked project memory entries before saving status.',
    'status-provider-write-not-bound': 'Bind a provider method that can write canonical project status.',
    'status-provider-read-not-bound': 'Bind a provider method that can read canonical project status.'
  };
  const validationItems = [
    {
      id: 'canonical-status',
      label: 'Canonical status',
      ready: !writeRequest.requested || writeRequest.statusSupported,
      blockingReason: 'unsupported-status'
    },
    {
      id: 'expected-revision',
      label: 'Expected revision',
      ready: !writeRequest.requested || writeRequest.expectedRevision === null || writeRequest.expectedRevision === current.revision,
      blockingReason: 'stale-status-revision'
    },
    {
      id: 'next-revision',
      label: 'Next revision',
      ready: !writeRequest.requested || statusWriteGuard.idempotentNoop || writeRequest.revision === null || writeRequest.revision > current.revision,
      blockingReason: 'non-advancing-status-revision'
    },
    {
      id: 'status-boundary',
      label: 'Status boundary',
      ready: !writeRequest.requested || statusBoundary.writeAllowed,
      blockingReason: statusBoundary.blockedReason
    },
    {
      id: 'status-write-guard',
      label: 'Status write guard',
      ready: !writeRequest.requested || statusWriteGuard.state !== 'blocked',
      blockingReason: statusWriteGuard.blockedReasons[0] || null
    },
    {
      id: 'status-provider-read',
      label: 'Status read provider',
      ready: providerContract.read.ready,
      blockingReason: 'status-provider-read-not-bound'
    },
    {
      id: 'status-provider-write',
      label: 'Status write provider',
      ready: !writeRequest.requested || statusWriteGuard.idempotentNoop || providerContract.write.ready,
      blockingReason: 'status-provider-write-not-bound'
    },
    {
      id: 'write-admission',
      label: 'Write admission',
      ready: !writeRequest.requested || blockedReasons.length === 0,
      blockingReason: blockedReasons[0] || null
    }
  ].map((item) => ({
    ...item,
    state: item.ready ? 'pass' : 'blocked',
    action: item.ready ? null : reasonActions[item.blockingReason] || 'Inspect project status validation before continuing.'
  }));
  const failedItems = validationItems.filter((item) => !item.ready);
  const requestedTransition = writeRequest.requested
    ? {
        fromStatus: current.status,
        toStatus: nextRecord?.status || writeRequest.status,
        fromRevision: current.revision,
        toRevision: nextRecord?.revision ?? writeRequest.revision ?? current.revision + 1,
        normalizedFromAlias: writeRequest.normalizedFromAlias,
        rawStatus: writeRequest.rawStatus
      }
    : null;
  const statusDispatches = dispatches.map((dispatch) => ({
    type: dispatch.type,
    state: dispatch.state,
    route: dispatch.route,
    providerId: dispatch.providerId,
    method: dispatch.method,
    blockedReasons: dispatch.blockedReasons
  }));
  const readyToWrite = writeRequest.requested
    && blockedReasons.length === 0
    && (providerContract.write.ready || statusWriteGuard.idempotentNoop);
  const workflowHandoff = buildProjectStatusWorkflowHandoff({
    now,
    current,
    writeRequest,
    nextRecord,
    blockedReasons,
    providerContract,
    persistencePlan,
    dispatches,
    tenantBoundary,
    clientState,
    statusKey,
    failedItems,
    statusBoundary,
    statusWriteGuard
  });

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusClientContract.v1',
    generatedAt: now,
    statusKey,
    preview: {
      contract: 'aios.projectMemoryAdapter.projectStatusPreview.v1',
      state: writeRequest.requested
        ? readyToWrite
          ? 'write-preview-ready'
          : 'write-preview-blocked'
        : providerContract.read.ready
          ? 'read-preview-ready'
          : 'read-preview-blocked',
      tone: failedItems.length > 0 ? 'danger' : writeRequest.requested ? 'success' : 'neutral',
      projectRef: clientState.projectRef,
      currentStatus: current.status,
      currentRevision: current.revision,
      requestedTransition,
      displayStatus: nextRecord?.status || current.status,
      displayRevision: nextRecord?.revision ?? current.revision,
      readRoute: providerContract.read.route,
      writeRoute: providerContract.write.route,
      providerStrategy: writeRequest.requested ? providerContract.write.strategy : providerContract.read.strategy,
      persistenceStrategy: persistencePlan.strategy,
      persistRequired: persistencePlan.persistRequired,
      writeGuardState: statusWriteGuard.state,
      commitRequired: statusWriteGuard.commitRequired
    },
    boundary: statusBoundary,
    acceptance: {
      contract: 'aios.projectMemoryAdapter.projectStatusAcceptance.v1',
      state: writeRequest.requested
        ? readyToWrite
          ? 'accepted'
          : 'blocked'
        : providerContract.read.ready
          ? 'read-accepted'
          : 'blocked',
      acceptedAt: readyToWrite || (!writeRequest.requested && providerContract.read.ready) ? now : null,
      acceptToken: readyToWrite
        ? `${surfaceId}:${tenantBoundary.isolationKey || 'unscoped'}:${clientState.requestId}:project-status`
        : null,
      idempotencyKey: persistencePlan.idempotencyKey,
      compareAndSwap: persistencePlan.compareAndSwap,
      blockedReasons,
      dispatches: statusDispatches
    },
    readiness: {
      contract: 'aios.projectMemoryAdapter.projectStatusReadiness.v1',
      state: failedItems.length === 0 ? 'ready' : 'blocked',
      score: Math.round(((validationItems.length - failedItems.length) / validationItems.length) * 100),
      gates: validationItems,
      routeHealth: {
        lifecycleCanRead: lifecycle.canRead,
        lifecycleCanWrite: lifecycle.canWrite,
        recoveryGate: failureRecovery.recoveryGate,
        writeAdmission: failureRecovery.writeAdmission,
        externalHandoffBlocksWrites: externalHandoff.blocksWrites,
        memoryOperationState: memoryOperationPlan.state
      },
      writeGuard: {
        state: statusWriteGuard.state,
        commitRequired: statusWriteGuard.commitRequired,
        idempotentNoop: statusWriteGuard.idempotentNoop,
        blockedReasons: statusWriteGuard.blockedReasons
      }
    },
    validationSummary: {
      contract: 'aios.projectMemoryAdapter.projectStatusValidationSummary.v1',
      valid: failedItems.length === 0,
      errors: failedItems.length,
      warnings: writeRequest.normalizedFromAlias ? 1 : 0,
      checkedCount: validationItems.length,
      blockedReasons,
      firstBlockedReason: blockedReasons[0] || failedItems[0]?.blockingReason || null,
      headline: failedItems.length === 0
        ? writeRequest.requested
          ? `Project status can move from ${current.status} to ${nextRecord?.status || writeRequest.status}.`
          : `Project status ${current.status} is readable.`
        : reasonActions[blockedReasons[0] || failedItems[0]?.blockingReason] || 'Project status needs attention before continuing.'
    },
    nextSteps: {
      contract: 'aios.projectMemoryAdapter.projectStatusNextSteps.v1',
      primary: failedItems.length > 0
        ? {
            state: 'blocked',
            reason: blockedReasons[0] || failedItems[0].blockingReason,
            action: reasonActions[blockedReasons[0] || failedItems[0].blockingReason] || 'Resolve project status validation.',
            route: providerContract.read.route || providerContract.write.route
          }
        : writeRequest.requested
          ? {
            state: 'ready-to-write',
            reason: 'project-status-write-accepted',
            action: statusWriteGuard.idempotentNoop
              ? 'Return the current canonical project status without writing a new checkpoint.'
              : 'Apply canonical project status with compare-and-swap persistence.',
            route: providerContract.write.route
          }
          : {
              state: 'ready-to-read',
              reason: 'project-status-read-accepted',
              action: 'Read canonical project status from the selected provider route.',
              route: providerContract.read.route
            },
      ordered: failedItems.length > 0
        ? failedItems.map((item, index) => ({
            order: index + 1,
            code: item.blockingReason,
            label: item.label,
            action: item.action,
            route: item.id.includes('write') ? providerContract.write.route : providerContract.read.route
          }))
        : statusDispatches.map((dispatch, index) => ({
            order: index + 1,
            code: dispatch.type,
            label: dispatch.type === 'project-status.write' ? 'Write canonical project status' : 'Read canonical project status',
            action: dispatch.state === 'idempotent'
              ? 'Return current status without dispatching a write.'
              : dispatch.state === 'ready'
                ? 'Dispatch through selected provider method.'
                : 'Hold until provider route is ready.',
            route: dispatch.route
          }))
    },
    workflowHandoff
  };
}

function buildProjectStatusProviderMethod({ operation, provider, fallbackBinding, route, statusKey, writeRequest, blockedReasons }) {
  const methodSpec = PROJECT_STATUS_PROVIDER_METHODS[operation];
  const providerMethods = Array.isArray(provider?.serviceContract?.methods) ? provider.serviceContract.methods : [];
  const providerCapabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
  const directSupported = providerMethods.includes(methodSpec.preferredMethod);
  const fallbackSupported = providerMethods.includes(methodSpec.fallbackMethod)
    || fallbackBinding?.method === methodSpec.fallbackMethod;
  const fallbackReady = fallbackBinding?.ready === true;
  const capabilityNegotiated = providerCapabilities.includes(methodSpec.capability);
  const routeReady = Boolean(route);
  const directReady = Boolean(provider?.available && routeReady && capabilityNegotiated && directSupported && fallbackReady);
  const ready = directReady || (!directSupported && fallbackSupported && fallbackReady);
  const strategy = directReady ? 'provider-status-method' : fallbackSupported ? methodSpec.fallbackStrategy : 'unavailable';

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusProviderMethod.v1',
    operation,
    statusKey,
    providerId: provider?.id || fallbackBinding?.providerId || null,
    route: ready ? route || fallbackBinding?.route || null : route || fallbackBinding?.route || null,
    preferredMethod: methodSpec.preferredMethod,
    fallbackMethod: methodSpec.fallbackMethod,
    selectedMethod: directReady
      ? methodSpec.preferredMethod
      : ready
        ? methodSpec.fallbackMethod
        : null,
    strategy,
    ready,
    state: ready
      ? directReady
        ? 'direct-status-bound'
        : 'memory-envelope-bound'
      : 'blocked',
    capability: methodSpec.capability,
    capabilityNegotiated,
    directSupported,
    fallbackSupported,
    fallbackBindingState: fallbackBinding?.state || 'unbound',
    proofRequired: operation === 'write',
    expectedRevision: operation === 'write' ? writeRequest.expectedRevision : null,
    requestedRevision: operation === 'write' ? writeRequest.revision : null,
    blockedReasons: [
      provider ? null : 'provider-unavailable',
      provider && !provider.available ? 'provider-not-available' : null,
      provider && !routeReady ? 'status-route-unavailable' : null,
      provider && !capabilityNegotiated ? 'capability-not-negotiated' : null,
      !directSupported && !fallbackSupported ? 'status-method-not-advertised' : null,
      fallbackSupported && !fallbackReady ? 'fallback-memory-binding-blocked' : null,
      ...(operation === 'write' ? blockedReasons : [])
    ].filter(Boolean)
  };
}

function buildProjectStatusProviderContract({ providerNegotiation, statusKey, writeRequest, blockedReasons }) {
  const primaryProvider = providerNegotiation.providers.find(
    (provider) => provider.id === providerNegotiation.selected.primaryProviderId
  ) || null;
  const writableProvider = providerNegotiation.providers.find(
    (provider) => provider.id === providerNegotiation.selected.writableProviderId
  ) || null;
  const readBinding = buildProjectStatusProviderMethod({
    operation: 'read',
    provider: primaryProvider,
    fallbackBinding: providerNegotiation.serviceBindings.bindings.readProjectMemory,
    route: providerNegotiation.readRoute,
    statusKey,
    writeRequest,
    blockedReasons: []
  });
  const writeBinding = buildProjectStatusProviderMethod({
    operation: 'write',
    provider: writableProvider,
    fallbackBinding: providerNegotiation.serviceBindings.bindings.writeProjectMemory,
    route: providerNegotiation.writeRoute,
    statusKey,
    writeRequest,
    blockedReasons
  });

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusProviderContract.v1',
    statusKey,
    state: writeRequest.requested
      ? writeBinding.ready && blockedReasons.length === 0
        ? 'write-bound'
        : 'write-blocked'
      : readBinding.ready
        ? 'read-bound'
        : 'read-blocked',
    read: readBinding,
    write: writeBinding,
    negotiatedMethods: [
      readBinding.ready ? readBinding.selectedMethod : null,
      writeBinding.ready ? writeBinding.selectedMethod : null
    ].filter(Boolean),
    fallbackStrategies: [
      readBinding.strategy === PROJECT_STATUS_PROVIDER_METHODS.read.fallbackStrategy ? readBinding.strategy : null,
      writeBinding.strategy === PROJECT_STATUS_PROVIDER_METHODS.write.fallbackStrategy ? writeBinding.strategy : null
    ].filter(Boolean),
    selectedProviders: {
      readProviderId: readBinding.providerId,
      writeProviderId: writeBinding.providerId
    },
    blockedReasons: [...new Set(readBinding.blockedReasons.concat(writeRequest.requested ? writeBinding.blockedReasons : []))]
  };
}

function selectProjectStatusSource(input = {}) {
  if (isObject(input.projectStatus)) return input.projectStatus;
  if (isObject(input.canonicalProjectStatus)) return input.canonicalProjectStatus;
  if (isObject(input.state?.projectStatus)) return input.state.projectStatus;
  return {};
}

function normalizeProjectStatusBoundaryClaim(input = {}, { tenantBoundary, projectRef }) {
  const source = selectProjectStatusSource(input);
  const metadata = isObject(source.metadata) ? source.metadata : {};
  const scope = isObject(source.scope)
    ? source.scope
    : isObject(source.boundary)
      ? source.boundary
      : isObject(metadata.scope)
        ? metadata.scope
        : {};
  const tenantId = firstString(source.tenantId, scope.tenantId, scope.tenant, metadata.tenantId);
  const workspaceId = firstString(source.workspaceId, scope.workspaceId, scope.workspace, metadata.workspaceId);
  const claimedProjectRef = firstString(source.projectRef, source.projectId, source.projectRoot, scope.projectRef, scope.projectId, metadata.projectRef);
  const principalId = firstString(source.principalId, source.updatedBy, scope.principalId, metadata.principalId);
  const claimedIsolationKey = firstString(source.isolationKey, scope.isolationKey, metadata.isolationKey)
    || (tenantId && workspaceId && claimedProjectRef ? `${tenantId}:${workspaceId}:${claimedProjectRef}` : null);
  const expected = {
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    projectRef,
    isolationKey: tenantBoundary.isolationKey,
    principalId: tenantBoundary.principal.id
  };
  const claimed = {
    tenantId,
    workspaceId,
    projectRef: claimedProjectRef,
    isolationKey: claimedIsolationKey,
    principalId
  };
  const presentFields = Object.entries(claimed)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([field]) => field);
  const mismatches = [
    tenantId && expected.tenantId && tenantId !== expected.tenantId
      ? { field: 'tenantId', expected: expected.tenantId, actual: tenantId }
      : null,
    workspaceId && expected.workspaceId && workspaceId !== expected.workspaceId
      ? { field: 'workspaceId', expected: expected.workspaceId, actual: workspaceId }
      : null,
    claimedProjectRef && expected.projectRef && claimedProjectRef !== expected.projectRef
      ? { field: 'projectRef', expected: expected.projectRef, actual: claimedProjectRef }
      : null,
    claimedIsolationKey && expected.isolationKey && claimedIsolationKey !== expected.isolationKey
      ? { field: 'isolationKey', expected: expected.isolationKey, actual: claimedIsolationKey }
      : null
  ].filter(Boolean);
  const expectedScoped = Boolean(expected.tenantId && expected.workspaceId && expected.projectRef && expected.isolationKey);
  const state = mismatches.length > 0
    ? 'mismatch'
    : presentFields.length > 0
      ? 'accepted'
      : expectedScoped
        ? 'derived-from-request-boundary'
        : 'unscoped';

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusBoundaryClaim.v1',
    state,
    sourceShape: Object.keys(source).length > 0 ? 'status-record' : 'empty',
    claimed,
    expected,
    presentFields,
    mismatches,
    source: firstString(source.source, metadata.source) || (Object.keys(source).length > 0 ? 'provider-status' : 'none')
  };
}

function buildProjectStatusBoundaryGuard({ now, input, writeRequest, tenantBoundary, providerNegotiation, projectRef, statusKey, clientState }) {
  const claim = normalizeProjectStatusBoundaryClaim(input, { tenantBoundary, projectRef });
  const mismatched = claim.mismatches.length > 0;
  const lacksResolvedScope = !tenantBoundary.isolationKey;
  const writeAllowed = !writeRequest.requested
    || (!mismatched && !lacksResolvedScope);
  const blockedReason = mismatched
    ? 'status-boundary-mismatch'
    : lacksResolvedScope
      ? 'status-boundary-unscoped'
      : null;
  const proofId = stableProjectMemoryHash({
    surfaceId,
    requestId: clientState.requestId,
    statusKey,
    claim: claim.claimed,
    expected: claim.expected,
    mismatches: claim.mismatches
  });

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusBoundaryGuard.v1',
    evaluatedAt: now,
    state: writeAllowed ? claim.state : 'blocked',
    writeAllowed,
    blockedReason: writeAllowed ? null : blockedReason,
    claim,
    commitBoundary: {
      isolationKey: tenantBoundary.isolationKey,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      projectRef,
      auditSubject: tenantBoundary.auditSubject,
      statusKey
    },
    proof: {
      required: writeRequest.requested || mismatched,
      proofId,
      route: providerNegotiation.auditRoute || providerNegotiation.readRoute || null,
      subject: tenantBoundary.auditSubject,
      inputs: {
        requestId: clientState.requestId,
        statusKey,
        claimState: claim.state,
        mismatchFields: claim.mismatches.map((item) => item.field),
        permissionGrantState: tenantBoundary.permissionGrants.state
      }
    }
  };
}

function normalizeProjectStatusRecord(input = {}, { now, projectRef }) {
  const source = selectProjectStatusSource(input);
  const normalizedStatus = normalizeCanonicalProjectStatusValue(firstString(source.status, source.state, source.value) || 'unknown');
  const revision = Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0;

  return {
    contract: 'aios.projectMemoryAdapter.canonicalProjectStatusRecord.v1',
    projectRef: firstString(source.projectRef, source.projectId, source.projectRoot) || projectRef,
    status: normalizedStatus.status,
    rawStatus: normalizedStatus.rawStatus || 'unknown',
    statusSupported: normalizedStatus.supported || normalizedStatus.status === 'unknown',
    normalizedFromAlias: normalizedStatus.normalizedFromAlias,
    revision,
    updatedAt: firstString(source.updatedAt, source.timestamp, source.observedAt) || null,
    updatedBy: firstString(source.updatedBy, source.actorId, source.principalId) || null,
    source: firstString(source.source, source.sourceRef) || (Object.keys(source).length > 0 ? 'input' : 'empty'),
    proofId: firstString(source.proofId, source.lastProofId),
    snapshotId: firstString(source.snapshotId, source.lastSnapshotId),
    metadata: isObject(source.metadata) ? source.metadata : {}
  };
}

function normalizeProjectStatusWriteRequest(input = {}, { now, clientState }) {
  const requestSource = isObject(input.request)
    ? input.request
    : isObject(input.memoryRequest)
      ? input.memoryRequest
      : {};
  const source = isObject(input.projectStatusUpdate)
    ? input.projectStatusUpdate
    : isObject(input.statusPatch)
      ? input.statusPatch
      : isObject(requestSource.projectStatusUpdate)
        ? requestSource.projectStatusUpdate
        : isObject(requestSource.statusPatch)
          ? requestSource.statusPatch
          : {};
  const requestedStatus = firstString(source.status, source.state, source.value);
  const normalizedStatus = normalizeCanonicalProjectStatusValue(requestedStatus);
  const requestedRevision = Number.isInteger(source.revision) && source.revision > 0 ? source.revision : null;
  const expectedRevision = Number.isInteger(source.expectedRevision) && source.expectedRevision >= 0
    ? source.expectedRevision
    : Number.isInteger(source.previousRevision) && source.previousRevision >= 0
      ? source.previousRevision
      : null;

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusWriteRequest.v1',
    requested: Object.keys(source).length > 0,
    requestId: clientState.requestId,
    requestedAt: firstString(source.requestedAt, requestSource.requestedAt) || now,
    requestedBy: firstString(source.requestedBy, source.actorId, input.principalId),
    status: normalizedStatus.status,
    rawStatus: normalizedStatus.rawStatus,
    statusSupported: normalizedStatus.supported,
    normalizedFromAlias: normalizedStatus.normalizedFromAlias,
    revision: requestedRevision,
    expectedRevision,
    reason: firstString(source.reason, source.message, requestSource.intent),
    metadata: isObject(source.metadata) ? source.metadata : {}
  };
}

function buildProjectStatusWriteGuard({ now, current, writeRequest, statusBoundary, tenantBoundary, clientState, statusKey }) {
  const requested = writeRequest.requested === true;
  const sameStatus = requested && writeRequest.status === current.status;
  const requestedRevision = writeRequest.revision;
  const expectedRevision = writeRequest.expectedRevision;
  const currentRevision = current.revision;
  const revisionMatches = expectedRevision === null || expectedRevision === currentRevision;
  const requestedRevisionDelta = requestedRevision === null ? null : requestedRevision - currentRevision;
  const revisionGap = requestedRevisionDelta !== null && requestedRevisionDelta > 1;
  const nonAdvancingRevision = requestedRevision !== null && requestedRevision <= currentRevision;
  const idempotentNoop = requested
    && sameStatus
    && revisionMatches
    && (requestedRevision === null || requestedRevision === currentRevision);
  const terminalCurrent = TERMINAL_PROJECT_STATUSES.includes(current.status);
  const terminalReopenRequested = requested
    && terminalCurrent
    && current.status !== writeRequest.status;
  const terminalReopenAllowed = terminalReopenRequested
    && writeRequest.metadata.allowTerminalReopen === true
    && PROJECT_STATUS_REOPEN_STATUSES.includes(writeRequest.status)
    && tenantBoundary.capabilities.canAudit;
  const blockedReasons = [
    requested && revisionGap ? 'status-revision-gap' : null,
    requested && nonAdvancingRevision && !idempotentNoop ? 'non-advancing-status-revision' : null,
    terminalReopenRequested && !terminalReopenAllowed ? 'terminal-status-reopen-blocked' : null
  ].filter(Boolean);
  const proofId = stableProjectMemoryHash({
    surfaceId,
    requestId: clientState.requestId,
    statusKey,
    currentStatus: current.status,
    currentRevision,
    requestedStatus: writeRequest.status,
    requestedRevision,
    expectedRevision,
    boundaryProofId: statusBoundary.proof.proofId,
    blockedReasons
  });

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusWriteGuard.v1',
    evaluatedAt: now,
    state: !requested
      ? 'read-only'
      : blockedReasons.length > 0
        ? 'blocked'
        : idempotentNoop
          ? 'idempotent-noop'
          : terminalReopenAllowed
            ? 'terminal-reopen-admitted'
            : 'admitted',
    requested,
    idempotentNoop,
    commitRequired: requested && blockedReasons.length === 0 && !idempotentNoop,
    blockedReasons,
    concurrency: {
      currentRevision,
      expectedRevision,
      requestedRevision,
      revisionMatches,
      requestedRevisionDelta,
      revisionGap,
      compareAndSwapRequired: requested && !idempotentNoop
    },
    transition: {
      fromStatus: current.status,
      toStatus: requested ? writeRequest.status : current.status,
      sameStatus,
      terminalCurrent,
      terminalReopenRequested,
      terminalReopenAllowed,
      allowedReopenStatuses: terminalCurrent ? PROJECT_STATUS_REOPEN_STATUSES : []
    },
    proof: {
      required: requested && (blockedReasons.length > 0 || terminalReopenAllowed || idempotentNoop),
      proofId,
      route: tenantBoundary.capabilities.canAudit ? statusBoundary.proof.route : null,
      subject: tenantBoundary.auditSubject,
      inputs: {
        requestId: clientState.requestId,
        statusKey,
        isolationKey: tenantBoundary.isolationKey,
        boundaryState: statusBoundary.state,
        blockedReasons
      }
    },
    operatorActions: blockedReasons.map((reason, index) => ({
      order: index + 1,
      reason,
      action: reason === 'status-revision-gap'
        ? 'Refresh project status and retry with the next consecutive revision.'
        : reason === 'terminal-status-reopen-blocked'
          ? 'Attach an audited terminal reopen request with an allowed recovery status.'
          : 'Refresh project status before retrying the write.'
    }))
  };
}

function buildProjectStatusTimelineExport({ now, current, writeRequest, nextRecord, blockedReasons, providerContract, persistencePlan, dispatches, tenantBoundary, clientState, statusBoundary, statusWriteGuard, history = [], evidence = [] }) {
  const statusProofIds = new Set([
    current.proofId,
    nextRecord?.proofId,
    statusBoundary.proof.proofId,
    statusWriteGuard.proof.proofId,
    persistencePlan.compareAndSwap?.expectedProofId,
    persistencePlan.compareAndSwap?.nextProofId
  ].filter(Boolean));
  const relevantOperations = new Set(['project-status', 'status', 'read', 'write', 'snapshot']);
  const supportingEvents = history
    .filter((event) => relevantOperations.has(event.operation) || statusProofIds.has(event.proofId) || statusProofIds.has(event.snapshotId))
    .slice(-25);
  const transitionState = writeRequest.requested
    ? statusWriteGuard.idempotentNoop
      ? 'idempotent'
      : blockedReasons.length === 0
        ? 'accepted'
        : 'blocked'
    : providerContract.read.ready
      ? 'observed'
      : 'blocked';
  const currentSnapshot = {
    snapshotId: current.snapshotId || stableProjectMemoryHash({
      status: current.status,
      revision: current.revision,
      proofId: current.proofId,
      projectRef: current.projectRef
    }),
    kind: 'current-status',
    capturedAt: current.updatedAt || now,
    status: current.status,
    revision: current.revision,
    proofId: current.proofId || null,
    source: current.source,
    projectRef: current.projectRef
  };
  const nextSnapshot = nextRecord
    ? {
        snapshotId: nextRecord.snapshotId || stableProjectMemoryHash({
          status: nextRecord.status,
          revision: nextRecord.revision,
          proofId: nextRecord.proofId,
          projectRef: nextRecord.projectRef
        }),
        kind: 'next-status',
        capturedAt: nextRecord.updatedAt || now,
        status: nextRecord.status,
        revision: nextRecord.revision,
        proofId: nextRecord.proofId || null,
        source: nextRecord.source,
        projectRef: nextRecord.projectRef
      }
    : null;
  const statusSnapshots = [currentSnapshot, nextSnapshot].filter(Boolean);
  const timeline = supportingEvents.map((event) => ({
    at: event.timestamp || now,
    kind: event.operation,
    state: event.status,
    eventId: event.id,
    status: event.status,
    revision: null,
    route: event.route,
    proofId: event.proofId || null,
    snapshotId: event.snapshotId || null,
    errorCode: event.errorCode || null
  }));
  const transitionEvent = {
    at: writeRequest.requested ? writeRequest.requestedAt : now,
    kind: writeRequest.requested ? 'project-status.write' : 'project-status.read',
    state: transitionState,
    eventId: stableProjectMemoryHash({
      requestId: clientState.requestId,
      fromStatus: current.status,
      toStatus: nextRecord?.status || writeRequest.status || current.status,
      fromRevision: current.revision,
      toRevision: nextRecord?.revision ?? current.revision,
      blockedReasons
    }),
    fromStatus: current.status,
    toStatus: nextRecord?.status || writeRequest.status || current.status,
    fromRevision: current.revision,
    toRevision: nextRecord?.revision ?? current.revision,
    route: writeRequest.requested ? providerContract.write.route : providerContract.read.route,
    proofId: nextRecord?.proofId || statusWriteGuard.proof.proofId || statusBoundary.proof.proofId,
    blockedReasons
  };
  const allTimelineEvents = timeline
    .concat(transitionEvent)
    .sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')))
    .slice(-30);
  const counters = {
    supportingEventCount: supportingEvents.length,
    timelineEventCount: allTimelineEvents.length,
    statusSnapshotCount: statusSnapshots.length,
    blockedTransitionCount: transitionState === 'blocked' ? 1 : 0,
    acceptedTransitionCount: transitionState === 'accepted' ? 1 : 0,
    idempotentTransitionCount: transitionState === 'idempotent' ? 1 : 0,
    proofBackedSnapshotCount: statusSnapshots.filter((snapshot) => snapshot.proofId).length,
    evidenceCount: evidence.length,
    byStatus: {},
    byTimelineKind: {}
  };

  for (const snapshot of statusSnapshots) {
    incrementCounter(counters.byStatus, snapshot.status);
  }

  for (const event of allTimelineEvents) {
    incrementCounter(counters.byTimelineKind, event.kind);
  }

  return {
    contract: 'aios.projectMemoryAdapter.projectStatusAnalytics.v1',
    generatedAt: now,
    state: transitionState === 'blocked'
      ? 'blocked'
      : persistencePlan.persistRequired
        ? 'export-ready-with-pending-commit'
        : 'export-ready',
    requestId: clientState.requestId,
    isolationKey: tenantBoundary.isolationKey,
    auditSubject: tenantBoundary.auditSubject,
    counters,
    snapshots: statusSnapshots,
    timeline: allTimelineEvents,
    exportSummary: {
      schema: 'aios.projectMemoryAdapter.projectStatusExportSummary.v1',
      projectRef: current.projectRef,
      currentStatus: current.status,
      currentRevision: current.revision,
      requestedStatus: writeRequest.requested ? writeRequest.status : null,
      nextStatus: nextRecord?.status || current.status,
      nextRevision: nextRecord?.revision ?? current.revision,
      transitionState,
      persistRequired: persistencePlan.persistRequired,
      commitRequired: statusWriteGuard.commitRequired,
      providerState: providerContract.state,
      readMethod: providerContract.read.selectedMethod,
      writeMethod: providerContract.write.selectedMethod,
      dispatchStates: dispatches.map((dispatch) => `${dispatch.type}:${dispatch.state}`),
      blockedReasons,
      proofIds: [...statusProofIds].sort()
    }
  };
}

function deriveCanonicalProjectStatus({ now, input, projectRef, mode, lifecycle, tenantBoundary, providerNegotiation, externalHandoff, failureRecovery, memoryOperationPlan, persistedEnvelope, clientState, history = [], evidence = [] }) {
  const current = normalizeProjectStatusRecord(input, { now, projectRef });
  const writeRequest = normalizeProjectStatusWriteRequest(input, { now, clientState });
  const requestedStatusSupported = !writeRequest.requested || writeRequest.statusSupported === true;
  const expectedRevisionMatches = writeRequest.expectedRevision === null || writeRequest.expectedRevision === current.revision;
  const statusKey = `project-status:${tenantBoundary.isolationKey || projectRef || 'unscoped'}`;
  const statusBoundary = buildProjectStatusBoundaryGuard({
    now,
    input,
    writeRequest,
    tenantBoundary,
    providerNegotiation,
    projectRef,
    statusKey,
    clientState
  });
  const statusWriteGuard = buildProjectStatusWriteGuard({
    now,
    current,
    writeRequest,
    statusBoundary,
    tenantBoundary,
    clientState,
    statusKey
  });
  const writeAllowed = lifecycle.canWrite
    && tenantBoundary.allowed
    && tenantBoundary.capabilities.canWrite
    && statusBoundary.writeAllowed
    && failureRecovery.writeAdmission === 'open'
    && !externalHandoff.blocksWrites
    && Boolean(providerNegotiation.writeRoute);
  let blockedReasons = [
    writeRequest.requested && !requestedStatusSupported ? 'unsupported-status' : null,
    writeRequest.requested && !expectedRevisionMatches ? 'stale-status-revision' : null,
    writeRequest.requested && !statusBoundary.writeAllowed ? statusBoundary.blockedReason : null,
    ...statusWriteGuard.blockedReasons,
    writeRequest.requested && !statusWriteGuard.idempotentNoop && !writeAllowed ? 'status-write-route-not-admitted' : null,
    writeRequest.requested && memoryOperationPlan.state === 'blocked' ? 'memory-operation-blocked' : null
  ].filter(Boolean);
  const providerContract = buildProjectStatusProviderContract({
    providerNegotiation,
    statusKey,
    writeRequest,
    blockedReasons
  });

  blockedReasons = [
    ...blockedReasons,
    writeRequest.requested && !statusWriteGuard.idempotentNoop && !providerContract.write.ready ? 'status-provider-write-not-bound' : null,
    !writeRequest.requested && !providerContract.read.ready ? 'status-provider-read-not-bound' : null
  ].filter(Boolean);

  const nextRevision = statusWriteGuard.idempotentNoop
    ? current.revision
    : writeRequest.revision || current.revision + (writeRequest.requested ? 1 : 0);
  const nextStatus = writeRequest.requested && blockedReasons.length === 0 ? writeRequest.status : current.status;
  const nextRecord = writeRequest.requested && blockedReasons.length === 0
    ? {
        ...current,
        status: nextStatus,
        rawStatus: writeRequest.rawStatus || writeRequest.status,
        statusSupported: true,
        normalizedFromAlias: writeRequest.normalizedFromAlias,
        revision: nextRevision,
        updatedAt: writeRequest.requestedAt,
        updatedBy: writeRequest.requestedBy || tenantBoundary.principal.id,
        source: 'status-write-request',
        proofId: stableProjectMemoryHash({
          surfaceId,
          projectRef,
          isolationKey: tenantBoundary.isolationKey,
          boundaryProofId: statusBoundary.proof.proofId,
          status: nextStatus,
          revision: nextRevision,
          requestId: clientState.requestId
        }),
        metadata: writeRequest.metadata
      }
    : null;
  const dispatches = buildProjectStatusDispatch({
    now,
    current,
    writeRequest,
    nextRecord,
    blockedReasons,
    providerNegotiation,
    tenantBoundary,
    clientState,
    statusKey,
    providerContract,
    statusWriteGuard
  });
  const persistencePlan = buildProjectStatusPersistencePlan({
    current,
    nextRecord,
    writeRequest,
    blockedReasons,
    persistedEnvelope,
    statusKey,
    tenantBoundary,
    clientState,
    statusWriteGuard
  });
  const clientContract = buildProjectStatusClientContract({
    now,
    current,
    writeRequest,
    nextRecord,
    blockedReasons,
    providerContract,
    persistencePlan,
    dispatches,
    tenantBoundary,
    clientState,
    lifecycle,
    failureRecovery,
    externalHandoff,
    memoryOperationPlan,
    statusKey,
    statusBoundary,
    statusWriteGuard
  });
  const statusAnalytics = buildProjectStatusTimelineExport({
    now,
    current,
    writeRequest,
    nextRecord,
    blockedReasons,
    providerContract,
    persistencePlan,
    dispatches,
    tenantBoundary,
    clientState,
    statusBoundary,
    statusWriteGuard,
    history,
    evidence
  });

  return {
    contract: 'aios.projectMemoryAdapter.canonicalProjectStatus.v1',
    generatedAt: now,
    projectRef,
    state: writeRequest.requested
      ? blockedReasons.length === 0
        ? 'write-ready'
        : 'write-blocked'
      : lifecycle.canRead && providerContract.read.ready
        ? 'read-ready'
        : 'read-blocked',
    current,
    read: {
      allowed: lifecycle.canRead && mode !== 'failed' && providerContract.read.ready,
      route: providerContract.read.route || providerNegotiation.readRoute,
      providerId: providerContract.read.providerId,
      method: providerContract.read.selectedMethod,
      strategy: providerContract.read.strategy,
      statusKey,
      consistency: current.proofId || current.snapshotId ? 'proof-backed' : 'best-effort'
    },
    write: {
      requested: writeRequest.requested,
      allowed: writeRequest.requested && blockedReasons.length === 0,
      route: providerContract.write.route || providerNegotiation.writeRoute,
      providerId: providerContract.write.providerId,
      method: providerContract.write.selectedMethod,
      strategy: providerContract.write.strategy,
      request: writeRequest,
      guardState: statusWriteGuard.state,
      commitRequired: statusWriteGuard.commitRequired,
      idempotentNoop: statusWriteGuard.idempotentNoop,
      blockedReasons,
      idempotencyKey: persistencePlan.idempotencyKey,
      expectedRevision: writeRequest.expectedRevision,
      nextRecord
    },
    boundary: statusBoundary,
    writeGuard: statusWriteGuard,
    persistence: {
      checkpointId: persistencePlan.checkpointId,
      persistRequired: persistencePlan.persistRequired,
      statusKey,
      checkpointStatus: persistencePlan.checkpointStatus,
      checkpointRevision: persistencePlan.checkpointRevision,
      strategy: persistencePlan.strategy,
      compareAndSwap: persistencePlan.compareAndSwap,
      idempotencyKey: persistencePlan.idempotencyKey
    },
    providerContract,
    analytics: statusAnalytics,
    clientContract,
    persistencePlan,
    dispatches,
    findings: blockedReasons.map((reason) => ({
      code: 'invalid_project_status',
      severity: 'error',
      message: reason === 'status-provider-read-not-bound'
        ? `Canonical project status read blocked: ${reason}.`
        : `Canonical project status write blocked: ${reason}.`
    }))
  };
}

function normalizeOperationHistory(input = {}) {
  const rawHistory = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.operationHistory)
      ? input.operationHistory
      : [];

  return rawHistory
    .map(normalizeHistoryEvent)
    .filter(Boolean)
    .sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
}

function normalizeProviderDescriptor(provider, index, hostCapabilities) {
  if (!isObject(provider)) {
    return null;
  }

  const role = PROVIDER_ROLES.includes(provider.role) ? provider.role : 'primary';
  const providerCapabilities = normalizeCapabilitySet(provider.capabilities);
  const effectiveCapabilities = new Set([...providerCapabilities].filter((capability) => hostCapabilities.has(capability)));
  const requiredForRole = PROVIDER_ROLE_CAPABILITIES[role] || [];
  const missingRoleCapabilities = requiredForRole.filter((capability) => !effectiveCapabilities.has(capability));
  const status = typeof provider.status === 'string' && provider.status.length > 0
    ? provider.status
    : 'available';
  const priority = Number.isFinite(provider.priority) ? Number(provider.priority) : index + 1;
  const serviceContract = normalizeProviderServiceContract(provider, role);

  return {
    id: provider.id || provider.name || `${role}-provider-${index + 1}`,
    role,
    service: provider.service || provider.serviceName || 'project-memory',
    status,
    priority,
    endpointRef: provider.endpointRef || provider.endpoint || null,
    leaseId: provider.leaseId || null,
    syncCursor: provider.syncCursor || provider.cursor || null,
    lastSyncedAt: provider.lastSyncedAt || provider.lastSuccessfulSyncAt || null,
    serviceContract,
    capabilities: [...effectiveCapabilities].sort(),
    requestedCapabilities: [...providerCapabilities].sort(),
    missingRoleCapabilities,
    writable: role === 'primary' && effectiveCapabilities.has('projectMemory.write') && provider.writable !== false,
    readable: effectiveCapabilities.has('projectMemory.read') && provider.readable !== false,
    canEmitAudit: effectiveCapabilities.has('audit.emit'),
    available: status !== 'offline'
      && status !== 'disabled'
      && missingRoleCapabilities.length === 0
      && serviceContract.compatible
  };
}

function normalizeProviderCatalog(input, hostCapabilities) {
  const providerSource = Array.isArray(input.providers)
    ? input.providers
    : Array.isArray(input.kernelHost?.providers)
      ? input.kernelHost.providers
      : Array.isArray(input.kernelHost?.services)
        ? input.kernelHost.services
        : [];

  return providerSource
    .map((provider, index) => normalizeProviderDescriptor(provider, index, hostCapabilities))
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function normalizeProviderContractVersion(version) {
  if (Number.isInteger(version) && version > 0) {
    return version;
  }

  if (typeof version === 'string') {
    const major = Number.parseInt(version.split('.')[0], 10);
    return Number.isInteger(major) && major > 0 ? major : null;
  }

  return null;
}

function normalizeProviderMethodSet(provider = {}, role) {
  const source = provider.methods || provider.apiMethods || provider.operations || provider.supportedOperations;
  const declaredMethods = normalizeStringList(source);

  if (declaredMethods.length > 0) {
    return [...new Set(declaredMethods)].sort();
  }

  const roleContract = PROVIDER_SERVICE_CONTRACTS[role];
  return [...roleContract.requiredMethods].sort();
}

function normalizeProviderHandoffModes(provider = {}, role) {
  const roleContract = PROVIDER_SERVICE_CONTRACTS[role];
  const declaredModes = normalizeStringList(provider.handoffModes || provider.handoffMode || provider.supportedHandoffs);
  const modes = declaredModes.length > 0
    ? declaredModes.filter((mode) => roleContract.handoffModes.includes(mode))
    : roleContract.handoffModes;

  return [...new Set(modes)].sort();
}

function normalizeProviderServiceContract(provider = {}, role) {
  const roleContract = PROVIDER_SERVICE_CONTRACTS[role];
  const source = isObject(provider.serviceContract)
    ? provider.serviceContract
    : isObject(provider.contract)
      ? provider.contract
      : {};
  const explicitContract = Boolean(
    source.id
      || source.contractId
      || provider.contractId
      || provider.serviceContractId
      || provider.protocol
      || provider.serviceContract
      || provider.contract
  );
  const explicitMethods = Boolean(provider.methods || provider.apiMethods || provider.operations || provider.supportedOperations || source.methods || source.apiMethods || source.operations);
  const contractId = firstString(
    source.id,
    source.contractId,
    provider.contractId,
    provider.serviceContractId,
    provider.protocol
  ) || roleContract.contractId;
  const version = normalizeProviderContractVersion(
    source.version || source.contractVersion || provider.contractVersion || provider.version
  ) || roleContract.minVersion;
  const methods = normalizeProviderMethodSet({ ...provider, ...source }, role);
  const missingMethods = roleContract.requiredMethods.filter((method) => !methods.includes(method));
  const optionalMethods = roleContract.optionalMethods || [];
  const supportedOptionalMethods = optionalMethods.filter((method) => methods.includes(method));
  const acceptedHandoffModes = normalizeProviderHandoffModes({ ...provider, ...source }, role);
  const contractIdMatches = contractId === roleContract.contractId;
  const versionAccepted = version >= roleContract.minVersion;

  return {
    contract: 'aios.projectMemoryAdapter.providerServiceContract.v1',
    role,
    contractId,
    expectedContractId: roleContract.contractId,
    version,
    minVersion: roleContract.minVersion,
    methods,
    requiredMethods: roleContract.requiredMethods,
    optionalMethods,
    supportedOptionalMethods,
    missingMethods,
    acceptedHandoffModes,
    advertisement: explicitContract || explicitMethods ? 'declared' : 'inferred-from-role-capabilities',
    compatible: contractIdMatches && versionAccepted && missingMethods.length === 0,
    findings: [
      !contractIdMatches
        ? {
            code: 'invalid_provider_contract',
            severity: 'error',
            message: `Provider advertised ${contractId}; expected ${roleContract.contractId} for ${role}.`
          }
        : null,
      !versionAccepted
        ? {
            code: 'invalid_provider_contract',
            severity: 'error',
            message: `Provider contract ${contractId} version ${version || 'unknown'} is below required major ${roleContract.minVersion}.`
          }
        : null,
      missingMethods.length > 0
        ? {
            code: 'invalid_provider_contract',
            severity: 'error',
            message: `Provider contract ${contractId} is missing methods: ${missingMethods.join(', ')}.`
          }
        : null
    ].filter(Boolean)
  };
}

function chooseProvider(providers, role, predicate = () => true) {
  return providers.find((provider) => provider.role === role && provider.available && predicate(provider)) || null;
}

function summarizeSelectedProviderContract(provider) {
  if (!provider?.serviceContract) {
    return null;
  }

  return {
    providerId: provider.id,
    role: provider.role,
    service: provider.service,
    contractId: provider.serviceContract.contractId,
    version: provider.serviceContract.version,
    methods: provider.serviceContract.methods,
    optionalMethods: provider.serviceContract.optionalMethods || [],
    supportedOptionalMethods: provider.serviceContract.supportedOptionalMethods || [],
    handoffModes: provider.serviceContract.acceptedHandoffModes,
    endpointRef: provider.endpointRef,
    compatible: provider.serviceContract.compatible
  };
}

function buildProviderMethodBinding({ provider, route, method, capability, mode, storeHealth, proofRequired = false }) {
  const methodSupported = provider?.serviceContract?.methods?.includes(method) === true;
  const providerCapabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
  const capabilityNegotiated = !capability || providerCapabilities.includes(capability);
  const storeAdmits = capability === 'projectMemory.write'
    ? storeHealth.writable && mode === 'ready'
    : capability === 'projectMemory.read'
      ? storeHealth.readable && mode !== 'failed'
      : true;
  const ready = Boolean(provider && route && provider.available && methodSupported && capabilityNegotiated && storeAdmits);

  return {
    contract: 'aios.projectMemoryAdapter.providerMethodBinding.v1',
    providerId: provider?.id || null,
    role: provider?.role || null,
    service: provider?.service || null,
    route: ready ? route : route || null,
    method,
    requiredCapability: capability || null,
    state: ready ? 'ready' : provider ? 'blocked' : 'unbound',
    ready,
    proofRequired,
    contractId: provider?.serviceContract?.contractId || null,
    contractVersion: provider?.serviceContract?.version || null,
    endpointRef: provider?.endpointRef || null,
    blockedReasons: [
      provider ? null : 'provider-unavailable',
      provider && !provider.available ? 'provider-not-available' : null,
      provider && !methodSupported ? 'method-not-advertised' : null,
      provider && !capabilityNegotiated ? 'capability-not-negotiated' : null,
      provider && !storeAdmits ? 'store-or-mode-not-admitted' : null
    ].filter(Boolean)
  };
}

function buildProviderServiceBindings({ primary, writablePrimary, snapshot, audit, externalSync, mode, storeHealth }) {
  const readRoute = primary ? `${primary.service}:${primary.id}` : null;
  const writeRoute = writablePrimary ? `${writablePrimary.service}:${writablePrimary.id}` : null;
  const snapshotRoute = snapshot ? `${snapshot.service}:${snapshot.id}` : null;
  const auditRoute = audit ? `${audit.service}:${audit.id}` : null;
  const externalRoute = externalSync ? `${externalSync.service}:${externalSync.id}` : null;
  const bindings = {
    readProjectMemory: buildProviderMethodBinding({
      provider: primary,
      route: readRoute,
      method: 'readProjectMemory',
      capability: 'projectMemory.read',
      mode,
      storeHealth
    }),
    writeProjectMemory: buildProviderMethodBinding({
      provider: writablePrimary,
      route: writeRoute,
      method: 'writeProjectMemory',
      capability: 'projectMemory.write',
      mode,
      storeHealth,
      proofRequired: true
    }),
    captureSnapshot: buildProviderMethodBinding({
      provider: snapshot,
      route: snapshotRoute,
      method: 'captureSnapshot',
      capability: 'projectMemory.read',
      mode,
      storeHealth,
      proofRequired: true
    }),
    emitAuditProof: buildProviderMethodBinding({
      provider: audit,
      route: auditRoute,
      method: 'emitAuditProof',
      capability: 'audit.emit',
      mode,
      storeHealth,
      proofRequired: true
    }),
    exportProjectMemoryDelta: buildProviderMethodBinding({
      provider: externalSync,
      route: externalRoute,
      method: 'exportProjectMemoryDelta',
      capability: 'projectMemory.read',
      mode,
      storeHealth,
      proofRequired: true
    })
  };
  const readyMethods = Object.values(bindings).filter((binding) => binding.ready).map((binding) => binding.method);
  const blockedMethods = Object.values(bindings)
    .filter((binding) => !binding.ready)
    .map((binding) => ({
      method: binding.method,
      providerId: binding.providerId,
      blockedReasons: binding.blockedReasons
    }));

  return {
    contract: 'aios.projectMemoryAdapter.providerServiceBindings.v1',
    state: bindings.readProjectMemory.ready && bindings.emitAuditProof.ready
      ? bindings.writeProjectMemory.ready
        ? 'read-write-bound'
        : 'read-only-bound'
      : 'incomplete',
    bindings,
    readyMethods,
    blockedMethods,
    dispatchOrder: [
      bindings.readProjectMemory.ready ? 'readProjectMemory' : null,
      bindings.writeProjectMemory.ready ? 'writeProjectMemory' : null,
      bindings.captureSnapshot.ready ? 'captureSnapshot' : null,
      bindings.exportProjectMemoryDelta.ready ? 'exportProjectMemoryDelta' : null,
      bindings.emitAuditProof.ready ? 'emitAuditProof' : null
    ].filter(Boolean)
  };
}

function buildProviderNegotiation({ providers, capabilities, mode, storeHealth }) {
  const directProvider = providers.length === 0
    ? {
        id: 'hosted-kernel-direct',
        role: 'primary',
        service: 'hosted-kernel',
        available: true,
        readable: capabilities.has('projectMemory.read'),
        writable: capabilities.has('projectMemory.write'),
        canEmitAudit: capabilities.has('audit.emit'),
        capabilities: [...capabilities].filter((capability) => REQUIRED_HOST_CAPABILITIES.includes(capability)).sort(),
        requestedCapabilities: [...capabilities].sort(),
        missingRoleCapabilities: [],
        syncCursor: null,
        lastSyncedAt: null,
        endpointRef: 'kernelHost.projectMemory',
        serviceContract: {
          contract: 'aios.projectMemoryAdapter.providerServiceContract.v1',
          role: 'primary',
          contractId: PROVIDER_SERVICE_CONTRACTS.primary.contractId,
          expectedContractId: PROVIDER_SERVICE_CONTRACTS.primary.contractId,
          version: PROVIDER_SERVICE_CONTRACTS.primary.minVersion,
          minVersion: PROVIDER_SERVICE_CONTRACTS.primary.minVersion,
          methods: PROVIDER_SERVICE_CONTRACTS.primary.requiredMethods,
          requiredMethods: PROVIDER_SERVICE_CONTRACTS.primary.requiredMethods,
          optionalMethods: PROVIDER_SERVICE_CONTRACTS.primary.optionalMethods,
          supportedOptionalMethods: [],
          missingMethods: [],
          acceptedHandoffModes: PROVIDER_SERVICE_CONTRACTS.primary.handoffModes,
          compatible: true,
          findings: []
        }
      }
    : null;
  const directAuditProvider = directProvider && directProvider.canEmitAudit
    ? {
        ...directProvider,
        role: 'audit',
        serviceContract: {
          ...directProvider.serviceContract,
          role: 'audit',
          contractId: PROVIDER_SERVICE_CONTRACTS.audit.contractId,
          expectedContractId: PROVIDER_SERVICE_CONTRACTS.audit.contractId,
          methods: PROVIDER_SERVICE_CONTRACTS.audit.requiredMethods,
          requiredMethods: PROVIDER_SERVICE_CONTRACTS.audit.requiredMethods,
          optionalMethods: PROVIDER_SERVICE_CONTRACTS.audit.optionalMethods,
          supportedOptionalMethods: [],
          acceptedHandoffModes: PROVIDER_SERVICE_CONTRACTS.audit.handoffModes
        }
      }
    : null;
  const negotiableProviders = directProvider
    ? [directProvider, directAuditProvider].filter(Boolean)
    : providers;
  const primary = chooseProvider(negotiableProviders, 'primary', (provider) => provider.readable);
  const writablePrimary = chooseProvider(negotiableProviders, 'primary', (provider) => provider.writable);
  const snapshot = chooseProvider(negotiableProviders, 'snapshot', (provider) => provider.readable) || primary;
  const audit = chooseProvider(negotiableProviders, 'audit', (provider) => provider.canEmitAudit);
  const externalSync = chooseProvider(providers, 'external-sync', (provider) => provider.readable);
  const negotiatedCapabilities = new Set();

  if (primary && capabilities.has('projectMemory.read') && storeHealth.readable && mode !== 'failed') {
    negotiatedCapabilities.add('projectMemory.read');
  }

  if (writablePrimary && capabilities.has('projectMemory.write') && storeHealth.writable && mode === 'ready') {
    negotiatedCapabilities.add('projectMemory.write');
  }

  if (audit && capabilities.has('audit.emit')) {
    negotiatedCapabilities.add('audit.emit');
  }

  const serviceBindings = buildProviderServiceBindings({
    primary,
    writablePrimary,
    snapshot,
    audit,
    externalSync,
    mode,
    storeHealth
  });

  return {
    contract: 'aios.projectMemoryAdapter.providerNegotiation.v1',
    providers,
    fallback: directProvider ? 'hosted-kernel-direct' : null,
    selected: {
      primaryProviderId: primary?.id || null,
      writableProviderId: writablePrimary?.id || null,
      snapshotProviderId: snapshot?.id || null,
      auditProviderId: audit?.id || null,
      externalSyncProviderId: externalSync?.id || null
    },
    selectedContracts: {
      primary: summarizeSelectedProviderContract(primary),
      writable: summarizeSelectedProviderContract(writablePrimary),
      snapshot: summarizeSelectedProviderContract(snapshot),
      audit: summarizeSelectedProviderContract(audit),
      externalSync: summarizeSelectedProviderContract(externalSync)
    },
    serviceBindings,
    negotiatedCapabilities: [...negotiatedCapabilities].sort(),
    missingCapabilities: REQUIRED_HOST_CAPABILITIES.filter((capability) => !negotiatedCapabilities.has(capability)),
    readRoute: primary ? `${primary.service}:${primary.id}` : null,
    writeRoute: writablePrimary ? `${writablePrimary.service}:${writablePrimary.id}` : null,
    auditRoute: audit ? `${audit.service}:${audit.id}` : null,
    externalHandoffContract: externalSync
      ? {
          providerId: externalSync.id,
          route: `${externalSync.service}:${externalSync.id}`,
          leaseRequired: externalSync.serviceContract.acceptedHandoffModes.includes('external-lease'),
          cursorResumeSupported: externalSync.serviceContract.acceptedHandoffModes.includes('cursor-resume'),
          methods: externalSync.serviceContract.methods,
          contractId: externalSync.serviceContract.contractId,
          version: externalSync.serviceContract.version
        }
      : null
  };
}

function normalizeExternalHandoff(input = {}, providers = []) {
  const source = isObject(input.externalHandoff)
    ? input.externalHandoff
    : isObject(input.handoff)
      ? input.handoff
      : {};
  const providerId = source.providerId || chooseProvider(providers, 'external-sync')?.id || null;
  const provider = providers.find((candidate) => candidate.id === providerId) || null;
  const serviceContract = provider?.serviceContract || null;
  const state = typeof source.state === 'string' && source.state.length > 0
    ? source.state
    : providerId
      ? 'available'
      : 'none';

  return {
    contract: 'aios.projectMemoryAdapter.externalHandoff.v1',
    state,
    providerId,
    route: provider ? `${provider.service}:${provider.id}` : null,
    leaseId: source.leaseId || provider?.leaseId || null,
    syncCursor: source.syncCursor || provider?.syncCursor || null,
    serviceContract: serviceContract
      ? {
          contractId: serviceContract.contractId,
          version: serviceContract.version,
          methods: serviceContract.methods,
          handoffModes: serviceContract.acceptedHandoffModes,
          leaseRequired: serviceContract.acceptedHandoffModes.includes('external-lease'),
          cursorResumeSupported: serviceContract.acceptedHandoffModes.includes('cursor-resume')
        }
      : null,
    owner: source.owner || source.ownerService || null,
    requestedAt: source.requestedAt || null,
    expiresAt: source.expiresAt || null,
    blocksWrites: state === 'active' || state === 'pending',
    accepted: state === 'none' || Boolean(serviceContract?.compatible),
    reason: source.reason || null
  };
}

function buildSyncMetadata({ now, projectRef, history, scheduling, providerNegotiation, externalHandoff }) {
  const lastSyncEvent = history.findLast?.((event) => event.operation === 'sync' || event.operation === 'flush') || null;
  const lastWriteEvent = history.findLast?.((event) => event.operation === 'write') || null;
  const selectedProvider = providerNegotiation.providers.find(
    (provider) => provider.id === providerNegotiation.selected.primaryProviderId
  ) || null;

  return {
    contract: 'aios.projectMemoryAdapter.syncMetadata.v1',
    projectRef,
    evaluatedAt: now,
    sourceProviderId: providerNegotiation.selected.primaryProviderId,
    externalProviderId: providerNegotiation.selected.externalSyncProviderId,
    cursor: externalHandoff.syncCursor || selectedProvider?.syncCursor || lastSyncEvent?.id || null,
    lastSyncedAt: externalHandoff.requestedAt || selectedProvider?.lastSyncedAt || lastSyncEvent?.timestamp || null,
    lastLocalWriteAt: lastWriteEvent?.timestamp || scheduling.anchors.lastWriteAt,
    pendingLocalChanges: history
      .filter((event) => event.operation === 'write' && (!lastSyncEvent?.timestamp || String(event.timestamp || '') > String(lastSyncEvent.timestamp)))
      .reduce((total, event) => total + event.entryCount, 0),
    handoff: {
      state: externalHandoff.state,
      providerId: externalHandoff.providerId,
      leaseId: externalHandoff.leaseId,
      blocksWrites: externalHandoff.blocksWrites,
      route: externalHandoff.route,
      contract: externalHandoff.serviceContract
    },
    nextSync: {
      state: scheduling.jobs.sync,
      route: providerNegotiation.writeRoute || providerNegotiation.readRoute,
      auditRoute: providerNegotiation.auditRoute,
      providerContract: providerNegotiation.selectedContracts.writable
        || providerNegotiation.selectedContracts.primary
        || providerNegotiation.selectedContracts.externalSync,
      methodBinding: providerNegotiation.serviceBindings.bindings.writeProjectMemory.ready
        ? providerNegotiation.serviceBindings.bindings.writeProjectMemory
        : providerNegotiation.serviceBindings.bindings.readProjectMemory
    },
    deltaExport: {
      state: providerNegotiation.serviceBindings.bindings.exportProjectMemoryDelta.ready
        ? externalHandoff.blocksWrites
          ? 'lease-held'
          : 'ready'
        : 'unavailable',
      methodBinding: providerNegotiation.serviceBindings.bindings.exportProjectMemoryDelta,
      cursorResumeSupported: externalHandoff.serviceContract?.cursorResumeSupported === true,
      leaseRequired: externalHandoff.serviceContract?.leaseRequired === true,
      leaseId: externalHandoff.leaseId,
      resumeCursor: externalHandoff.syncCursor || selectedProvider?.syncCursor || lastSyncEvent?.id || null
    }
  };
}

function incrementCounter(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function buildAnalyticsCounters(history, evidence, findings) {
  const counters = {
    totalEvents: history.length,
    reads: 0,
    writes: 0,
    snapshots: 0,
    auditProofs: evidence.length,
    failures: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    exportedEntries: 0,
    exportedBytes: 0,
    averageDurationMs: null,
    byOperation: {},
    byStatus: {}
  };
  let durationTotal = 0;
  let durationCount = 0;

  for (const event of history) {
    incrementCounter(counters.byOperation, event.operation);
    incrementCounter(counters.byStatus, event.status);
    counters.exportedEntries += event.entryCount;
    counters.exportedBytes += event.bytes;

    if (event.operation === 'read') counters.reads += 1;
    if (event.operation === 'write') counters.writes += 1;
    if (event.snapshotId || event.operation === 'snapshot') counters.snapshots += 1;
    if (event.status === 'failed' || event.errorCode) counters.failures += 1;

    if (event.durationMs !== null) {
      durationTotal += event.durationMs;
      durationCount += 1;
    }
  }

  counters.averageDurationMs = durationCount > 0 ? Math.round(durationTotal / durationCount) : null;
  return counters;
}

function buildHistorySnapshots(history, now) {
  const latestBySnapshot = new Map();

  for (const event of history) {
    if (!event.snapshotId) continue;
    latestBySnapshot.set(event.snapshotId, {
      snapshotId: event.snapshotId,
      capturedAt: event.timestamp || now,
      sourceEventId: event.id,
      operation: event.operation,
      status: event.status,
      entryCount: event.entryCount,
      bytes: event.bytes,
      proofId: event.proofId
    });
  }

  return [...latestBySnapshot.values()].slice(-5);
}

function buildTimeline(history, findings, now) {
  const events = history.slice(-12).map((event) => ({
    at: event.timestamp || now,
    kind: event.operation,
    status: event.status,
    id: event.id,
    proofId: event.proofId,
    errorCode: event.errorCode
  }));

  for (const finding of findings) {
    events.push({
      at: now,
      kind: 'validation',
      status: finding.severity,
      id: finding.code,
      proofId: null,
      errorCode: finding.severity === 'error' ? finding.code : null
    });
  }

  return events.sort((left, right) => String(left.at).localeCompare(String(right.at)));
}

function normalizeAnalyticsExportRequest(input = {}, now) {
  const source = isObject(input.analyticsExport)
    ? input.analyticsExport
    : isObject(input.exportRequest)
      ? input.exportRequest
      : {};
  const requestedFormats = normalizeStringList(source.formats || source.format);
  const allowedFormats = new Set(['jsonl', 'summary-json', 'timeline-json', 'audit-manifest-json']);
  const formats = requestedFormats.filter((format) => allowedFormats.has(format));
  const maxEvents = Number.isInteger(source.maxEvents) && source.maxEvents > 0
    ? Math.min(source.maxEvents, 5_000)
    : 250;

  return {
    contract: 'aios.projectMemoryAdapter.analyticsExportRequest.v1',
    requested: Object.keys(source).length > 0,
    requestedAt: firstString(source.requestedAt, input.requestedAt) || now,
    requestedBy: firstString(source.requestedBy, source.actorId, input.principalId),
    destinationRef: firstString(source.destinationRef, source.destination, source.bucketRef),
    formats: formats.length > 0 ? formats : ['summary-json'],
    window: {
      from: firstString(source.from, source.windowFrom, source.since),
      to: firstString(source.to, source.windowTo, source.until)
    },
    includeTimeline: source.includeTimeline !== false,
    includeProofManifest: source.includeProofManifest !== false,
    redactProofIds: source.redactProofIds === true,
    maxEvents,
    statusFilter: normalizeStringList(source.status || source.statuses),
    operationFilter: normalizeStringList(source.operation || source.operations)
  };
}

function eventInExportWindow(event, exportRequest) {
  const eventEpoch = toEpochMs(event.timestamp);
  const fromEpoch = toEpochMs(exportRequest.window.from);
  const toEpoch = toEpochMs(exportRequest.window.to);

  if (fromEpoch !== null && eventEpoch !== null && eventEpoch < fromEpoch) {
    return false;
  }

  if (toEpoch !== null && eventEpoch !== null && eventEpoch > toEpoch) {
    return false;
  }

  if (exportRequest.statusFilter.length > 0 && !exportRequest.statusFilter.includes(event.status)) {
    return false;
  }

  if (exportRequest.operationFilter.length > 0 && !exportRequest.operationFilter.includes(event.operation)) {
    return false;
  }

  return true;
}

function buildProofManifest({ events, evidence, snapshots, exportRequest, tenantBoundary }) {
  const proofEvents = events
    .filter((event) => event.proofId || event.snapshotId || event.errorCode)
    .map((event) => ({
      eventId: event.id,
      proofId: exportRequest.redactProofIds ? null : event.proofId,
      snapshotId: event.snapshotId,
      operation: event.operation,
      status: event.status,
      at: event.timestamp,
      errorCode: event.errorCode
    }));
  const acceptedEvidence = evidence.map((event) => ({
    id: event.id,
    source: event.source,
    timestamp: event.timestamp,
    proofId: exportRequest.redactProofIds ? null : event.proofId || event.id
  }));

  return {
    contract: 'aios.projectMemoryAdapter.proofManifest.v1',
    isolationKey: tenantBoundary.isolationKey,
    auditSubject: tenantBoundary.auditSubject,
    redacted: exportRequest.redactProofIds,
    proofEventCount: proofEvents.length,
    evidenceCount: acceptedEvidence.length,
    snapshotCount: snapshots.length,
    latestSnapshotId: snapshots[snapshots.length - 1]?.snapshotId || null,
    events: proofEvents.slice(-exportRequest.maxEvents),
    evidence: acceptedEvidence.slice(-exportRequest.maxEvents)
  };
}

function buildAnalyticsReportingState({ now, projectRef, mode, history, evidence, findings, snapshots, timeline, exportRequest, tenantBoundary, providerNegotiation }) {
  const exportableEvents = history
    .filter((event) => eventInExportWindow(event, exportRequest))
    .slice(-exportRequest.maxEvents);
  const exportCounters = buildAnalyticsCounters(exportableEvents, evidence, findings);
  const timelineEvents = exportRequest.includeTimeline
    ? timeline
        .filter((event) => {
          const eventEpoch = toEpochMs(event.at);
          const fromEpoch = toEpochMs(exportRequest.window.from);
          const toEpoch = toEpochMs(exportRequest.window.to);
          return (fromEpoch === null || eventEpoch === null || eventEpoch >= fromEpoch)
            && (toEpoch === null || eventEpoch === null || eventEpoch <= toEpoch);
        })
        .slice(-exportRequest.maxEvents)
    : [];
  const lastExportableEvent = exportableEvents[exportableEvents.length - 1] || null;
  const blockedReasons = [];

  if (mode === 'failed') blockedReasons.push('adapter-validation-failed');
  if (exportableEvents.length === 0) blockedReasons.push('no-events-in-export-window');
  if (!providerNegotiation.auditRoute) blockedReasons.push('audit-route-unavailable');

  return {
    contract: 'aios.projectMemoryAdapter.reportingState.v1',
    generatedAt: now,
    projectRef,
    state: blockedReasons.length === 0 ? 'export-ready' : exportRequest.requested ? 'blocked' : 'idle',
    request: exportRequest,
    blockedReasons,
    watermarks: {
      historyEventCount: history.length,
      exportableEventCount: exportableEvents.length,
      firstExportableAt: exportableEvents[0]?.timestamp || null,
      lastExportableAt: lastExportableEvent?.timestamp || null,
      lastExportableEventId: lastExportableEvent?.id || null,
      latestSnapshotId: snapshots[snapshots.length - 1]?.snapshotId || null
    },
    counters: exportCounters,
    batches: exportRequest.formats.map((format) => ({
      format,
      destinationRef: exportRequest.destinationRef,
      eventCount: format === 'summary-json' ? 1 : exportableEvents.length,
      byteEstimate: exportCounters.exportedBytes,
      ready: blockedReasons.length === 0,
      cursor: lastExportableEvent?.id || null
    })),
    timeline: timelineEvents,
    proofManifest: exportRequest.includeProofManifest
      ? buildProofManifest({
          events: exportableEvents,
          evidence,
          snapshots,
          exportRequest,
          tenantBoundary
        })
      : null
  };
}

function toEpochMs(timestamp) {
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function addMsToIso(timestamp, delayMs) {
  const epochMs = toEpochMs(timestamp);
  return epochMs === null ? null : new Date(epochMs + delayMs).toISOString();
}

function deriveFailureRecoveryState({ now, history, storeHealth, retryPolicy, backoffSchedule, providerNegotiation, externalHandoff }) {
  const latestSuccessfulEvent = [...history]
    .reverse()
    .find((event) => event.status === 'applied' || event.status === 'ok' || event.status === 'succeeded' || event.status === 'success') || null;
  const latestSuccessEpoch = Math.max(
    toEpochMs(storeHealth.lastSuccessfulReadAt) || 0,
    toEpochMs(storeHealth.lastSuccessfulWriteAt) || 0,
    toEpochMs(latestSuccessfulEvent?.timestamp) || 0
  );
  const failedEvents = history
    .filter((event) => event.status === 'failed' || event.errorCode)
    .filter((event) => {
      const failureEpoch = toEpochMs(event.timestamp);
      return latestSuccessEpoch === 0 || failureEpoch === null || failureEpoch > latestSuccessEpoch;
    })
    .slice(-retryPolicy.maxAttempts);
  const lastFailureEvent = failedEvents[failedEvents.length - 1] || null;
  const lastFailureAt = storeHealth.lastError
    ? storeHealth.lastSuccessfulWriteAt || storeHealth.lastSuccessfulReadAt || lastFailureEvent?.timestamp || now
    : lastFailureEvent?.timestamp || null;
  const observedFailures = Math.max(storeHealth.consecutiveFailures, failedEvents.length);
  const budgetExhausted = observedFailures >= retryPolicy.maxAttempts && observedFailures > 0;
  const nextAttemptIndex = Math.min(observedFailures, Math.max(backoffSchedule.length - 1, 0));
  const nextBackoff = backoffSchedule[nextAttemptIndex] || null;
  const nextProbeAt = nextBackoff && lastFailureAt
    ? addMsToIso(lastFailureAt, nextBackoff.delayMs)
    : null;
  const route = providerNegotiation.readRoute || providerNegotiation.writeRoute || null;
  const storeOffline = !storeHealth.readable || storeHealth.status === 'offline';
  const circuitOpen = storeOffline || budgetExhausted;
  const recoveryGate = circuitOpen
    ? 'operator-probe-required'
    : observedFailures > 0
      ? 'backoff-probe-scheduled'
      : 'closed';

  return {
    contract: 'aios.projectMemoryAdapter.failureRecovery.v1',
    state: circuitOpen ? 'open' : observedFailures > 0 ? 'half-open' : 'closed',
    recoveryGate,
    route,
    writeAdmission: circuitOpen || externalHandoff.blocksWrites ? 'blocked' : observedFailures > 0 ? 'read-probe-first' : 'open',
    observedFailures,
    retryBudget: {
      maxAttempts: retryPolicy.maxAttempts,
      remainingAttempts: Math.max(retryPolicy.maxAttempts - observedFailures, 0),
      exhausted: budgetExhausted
    },
    lastFailure: lastFailureEvent || storeHealth.lastError
      ? {
          at: lastFailureAt,
          code: lastFailureEvent?.errorCode || storeHealth.lastError?.code || 'store_error',
          retryable: storeHealth.lastError?.retryable !== false,
          source: lastFailureEvent ? 'operation-history' : 'store-health'
        }
      : null,
    nextRecoveryProbe: observedFailures > 0
      ? {
          at: budgetExhausted ? null : nextProbeAt,
          delayMs: budgetExhausted ? null : nextBackoff?.delayMs || null,
          jitterWindowMs: budgetExhausted ? null : nextBackoff?.jitterWindowMs || null,
          operation: 'read',
          auditRequired: true
        }
      : null,
    retryQueue: failedEvents.map((event, index) => ({
      order: index + 1,
      eventId: event.id,
      operation: event.operation,
      errorCode: event.errorCode || 'operation_failed',
      route: event.route,
      eligibleForRetry: !budgetExhausted && event.operation !== 'write'
    })),
    degradedReason: storeOffline
      ? 'store-unreadable'
      : budgetExhausted
        ? 'retry-budget-exhausted'
        : observedFailures > 0
          ? 'recent-operation-failure'
          : null
  };
}

function buildExportSummary({ now, projectRef, mode, history, counters, snapshots }) {
  const lastEvent = history[history.length - 1] || null;

  return {
    schema: 'aios.projectMemoryAdapter.analyticsExport.v1',
    generatedAt: now,
    projectRef,
    mode,
    range: {
      from: history[0]?.timestamp || null,
      to: lastEvent?.timestamp || null
    },
    totals: {
      events: counters.totalEvents,
      reads: counters.reads,
      writes: counters.writes,
      snapshots: counters.snapshots,
      failures: counters.failures,
      warnings: counters.warnings,
      entries: counters.exportedEntries,
      bytes: counters.exportedBytes
    },
    latestSnapshotId: snapshots[snapshots.length - 1]?.snapshotId || null,
    latestProofId: lastEvent?.proofId || null,
    readyForExport: mode !== 'failed' && counters.totalEvents > 0,
    formats: ['jsonl', 'summary-json']
  };
}

function buildProviderFindings(providerNegotiation, externalHandoff) {
  const findings = [];

  for (const provider of providerNegotiation.providers) {
    for (const finding of provider.serviceContract?.findings || []) {
      findings.push({
        ...finding,
        providerId: provider.id,
        role: provider.role
      });
    }
  }

  if (providerNegotiation.providers.length > 0) {
    for (const role of ['primary', 'audit']) {
      const selectedKey = role === 'primary' ? 'primaryProviderId' : 'auditProviderId';
      if (!providerNegotiation.selected[selectedKey]) {
        findings.push({
          code: 'unavailable_provider',
          severity: role === 'primary' ? 'error' : 'warning',
          message: `No available ${role} provider was negotiated for hosted project memory.`
        });
      }
    }
  }

  if (externalHandoff.blocksWrites) {
    findings.push({
      code: 'external_handoff_blocked',
      severity: 'warning',
      message: `External project-memory handoff is ${externalHandoff.state}; writes should wait for lease release.`,
      providerId: externalHandoff.providerId
    });
  }

  if (externalHandoff.providerId && externalHandoff.accepted === false) {
    findings.push({
      code: 'invalid_provider_contract',
      severity: 'error',
      message: `External handoff provider ${externalHandoff.providerId} does not expose an accepted project-memory sync contract.`,
      providerId: externalHandoff.providerId
    });
  }

  return findings;
}

function buildOperationalFindings(input, hostCapabilities, storeHealth, lifecycleSettings, lifecycleCommand, providerNegotiation, externalHandoff, tenantBoundary, failureRecovery, memoryOperationPlan) {
  const findings = [];
  const projectRef = input.projectId || input.projectRoot;
  const requestSource = isObject(input.request)
    ? input.request
    : isObject(input.memoryRequest)
      ? input.memoryRequest
      : {};
  const requestedOperation = firstString(
    requestSource.operation,
    input.operation,
    lifecycleCommand === 'flush' ? 'flush' : null
  );

  if (!isObject(input.kernelHost)) {
    findings.push({
      code: 'missing_kernel_host',
      severity: 'error',
      message: 'No hosted-kernel host context was provided.'
    });
  }

  if (typeof projectRef !== 'string' || projectRef.trim().length === 0) {
    findings.push({
      code: 'invalid_project_ref',
      severity: 'error',
      message: 'Project memory requests require a non-empty projectId or projectRoot.'
    });
  }

  for (const capability of REQUIRED_HOST_CAPABILITIES) {
    if (!hostCapabilities.has(capability)) {
      findings.push({
        code: 'unavailable_capability',
        severity: capability === 'projectMemory.write' ? 'warning' : 'error',
        message: `Hosted kernel capability is unavailable: ${capability}.`,
        capability
      });
    }
  }

  if (!storeHealth.readable || storeHealth.status === 'offline') {
    findings.push({
      code: 'unhealthy_store',
      severity: 'error',
      message: 'Project memory store is not readable for hosted-kernel requests.'
    });
  } else if (!storeHealth.writable || storeHealth.consecutiveFailures > 0 || storeHealth.lastError) {
    findings.push({
      code: 'unhealthy_store',
      severity: 'warning',
      message: 'Project memory store is degraded and should avoid writes until recovery proof is emitted.'
    });
  }

  if (failureRecovery.retryBudget.exhausted) {
    findings.push({
      code: 'retry_budget_exhausted',
      severity: storeHealth.readable ? 'warning' : 'error',
      message: `Project memory retry budget is exhausted after ${failureRecovery.observedFailures} observed failures.`
    });
  } else if (failureRecovery.nextRecoveryProbe) {
    findings.push({
      code: 'recovery_probe_required',
      severity: 'warning',
      message: 'Project memory has recent failures and should pass a read-only recovery probe before writes resume.'
    });
  }

  if ((requestedOperation === 'write' || requestedOperation === 'sync' || requestedOperation === 'flush')
    && memoryOperationPlan?.requestedEntryCount === 0) {
    findings.push({
      code: 'invalid_memory_entry',
      severity: 'warning',
      message: 'Project memory write-like requests should include entries or pending mutations to apply.'
    });
  }

  return findings
    .concat(buildTenantBoundaryFindings(tenantBoundary))
    .concat(buildProviderFindings(providerNegotiation, externalHandoff))
    .concat(memoryOperationPlan?.findings || [])
    .concat(validateEvidence(input.evidence))
    .concat(validateLifecycleSettings(lifecycleSettings, lifecycleCommand));
}

function deriveMode(findings) {
  if (findings.some((finding) => finding.severity === 'error')) {
    return 'failed';
  }

  if (findings.some((finding) => finding.severity === 'warning')) {
    return 'degraded-read-only';
  }

  return 'ready';
}

function buildActionableErrors(findings) {
  return findings.map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    action: FAILURE_ACTIONS[finding.code] || 'Inspect the hosted-kernel audit trail for the failing memory operation.',
    capability: finding.capability,
    providerId: finding.providerId,
    grantIds: finding.grantIds
  }));
}

function buildOperationalHealthEnvelope({ now, mode, clientState, lifecycle, providerNegotiation, tenantBoundary, externalHandoff, storeHealth, failureRecovery, memoryOperationPlan, findings, actionableErrors }) {
  const writeRequested = clientState.operation === 'write'
    || clientState.operation === 'sync'
    || clientState.operation === 'flush'
    || clientState.expectsWriteAck;
  const validationFailures = findings
    .filter((finding) => finding.severity === 'error' || finding.severity === 'warning')
    .map((finding, index) => ({
      contract: 'aios.projectMemoryAdapter.healthIncident.v1',
      incidentId: stableProjectMemoryHash({
        surfaceId,
        projectRef: clientState.projectRef,
        code: finding.code,
        message: finding.message,
        index
      }),
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      action: FAILURE_ACTIONS[finding.code] || 'Inspect the hosted-kernel project memory audit proof.',
      capability: finding.capability || null,
      providerId: finding.providerId || null,
      grantIds: finding.grantIds || [],
      blocksWrites: finding.severity === 'error' || ['unhealthy_store', 'retry_budget_exhausted', 'recovery_probe_required'].includes(finding.code),
      blocksReads: finding.severity === 'error' && ['missing_kernel_host', 'invalid_project_ref', 'workspace_scope_required', 'tenant_boundary_violation', 'permission_denied', 'unavailable_capability'].includes(finding.code)
    }));
  const readRouteState = lifecycle.canRead
    ? 'serving'
    : mode === 'failed'
      ? 'blocked'
      : 'unavailable';
  const writeRouteState = lifecycle.canWrite && failureRecovery.writeAdmission === 'open' && !externalHandoff.blocksWrites
    ? 'serving'
    : writeRequested
      ? 'blocked'
      : 'held';
  const auditRouteState = lifecycle.canSnapshot || providerNegotiation.auditRoute
    ? 'serving'
    : 'unavailable';
  const retryAttempts = failureRecovery.retryQueue.map((item, index) => ({
    attempt: index + 1,
    eventId: item.eventId,
    operation: item.operation,
    route: item.route || failureRecovery.route || providerNegotiation.readRoute,
    errorCode: item.errorCode,
    eligible: item.eligibleForRetry,
    decision: item.eligibleForRetry ? 'schedule-read-probe' : 'hold-for-operator'
  }));
  const degradedActive = mode !== 'ready' || failureRecovery.state !== 'closed' || externalHandoff.blocksWrites;
  const primaryIncident = validationFailures.find((incident) => incident.severity === 'error')
    || validationFailures.find((incident) => incident.blocksWrites)
    || null;
  const operatorActions = actionableErrors.slice(0, 6).map((error, index) => ({
    order: index + 1,
    code: error.code,
    severity: error.severity,
    action: error.action,
    grantIds: error.grantIds || [],
    route: error.capability === 'audit.emit'
      ? providerNegotiation.auditRoute
      : error.capability === 'projectMemory.write'
        ? providerNegotiation.writeRoute
        : providerNegotiation.readRoute || providerNegotiation.auditRoute,
    requiredBefore: error.severity === 'error' ? 'read-service' : 'write-service'
  }));

  if (failureRecovery.nextRecoveryProbe && !operatorActions.some((action) => action.code === 'recovery_probe_required')) {
    operatorActions.push({
      order: operatorActions.length + 1,
      code: 'recovery_probe_required',
      severity: 'warning',
      action: FAILURE_ACTIONS.recovery_probe_required,
      route: failureRecovery.route || providerNegotiation.readRoute,
      requiredBefore: 'write-service',
      dueAt: failureRecovery.nextRecoveryProbe.at
    });
  }

  return {
    contract: 'aios.projectMemoryAdapter.operationalHealth.v1',
    generatedAt: now,
    projectRef: clientState.projectRef,
    state: mode === 'failed'
      ? 'blocked'
      : degradedActive
        ? 'degraded'
        : 'healthy',
    serviceLevel: lifecycle.canWrite
      ? 'read-write'
      : lifecycle.canRead
        ? 'read-only'
        : 'offline',
    primaryIncidentId: primaryIncident?.incidentId || null,
    routes: {
      read: {
        state: readRouteState,
        route: providerNegotiation.readRoute,
        readable: lifecycle.canRead
      },
      write: {
        state: writeRouteState,
        route: providerNegotiation.writeRoute,
        admission: failureRecovery.writeAdmission,
        writable: lifecycle.canWrite,
        blockedReason: externalHandoff.blocksWrites
          ? 'external_handoff_blocked'
          : failureRecovery.writeAdmission !== 'open'
            ? failureRecovery.recoveryGate
            : null
      },
      audit: {
        state: auditRouteState,
        route: providerNegotiation.auditRoute,
        proofRequired: validationFailures.length > 0 || memoryOperationPlan.state !== 'ready'
      }
    },
    degradedMode: {
      active: degradedActive,
      reason: failureRecovery.degradedReason || primaryIncident?.code || (externalHandoff.blocksWrites ? 'external_handoff_blocked' : null),
      readBehavior: lifecycle.canRead ? 'serve-last-known-safe-state' : 'reject',
      writeBehavior: lifecycle.canWrite && failureRecovery.writeAdmission === 'open' ? 'accept' : 'reject-with-proof',
      exitCriteria: [
        'hosted-kernel-capabilities-present',
        'tenant-boundary-accepted',
        'read-route-serving',
        'retry-budget-available',
        'recovery-probe-applied'
      ]
    },
    retryPlan: {
      state: failureRecovery.retryBudget.exhausted
        ? 'exhausted'
        : failureRecovery.nextRecoveryProbe
          ? 'scheduled'
          : 'idle',
      remainingAttempts: failureRecovery.retryBudget.remainingAttempts,
      nextProbe: failureRecovery.nextRecoveryProbe,
      attempts: retryAttempts
    },
    validationFailures,
    operatorActions,
    auditProof: {
      required: validationFailures.length > 0 || degradedActive || memoryOperationPlan.blockedReasons.length > 0,
      proofId: stableProjectMemoryHash({
        surfaceId,
        projectRef: clientState.projectRef,
        requestId: clientState.requestId,
        mode,
        recoveryGate: failureRecovery.recoveryGate,
        operationState: memoryOperationPlan.state
      }),
      subject: tenantBoundary.auditSubject,
      isolationKey: tenantBoundary.isolationKey,
      inputs: {
        requestId: clientState.requestId,
        operation: clientState.operation,
        storeStatus: storeHealth.status,
        failureState: failureRecovery.state,
        recoveryGate: failureRecovery.recoveryGate,
        memoryOperationState: memoryOperationPlan.state,
        blockedReasons: memoryOperationPlan.blockedReasons,
        permissionGrantState: tenantBoundary.permissionGrants.state,
        matchedGrantIds: tenantBoundary.permissionGrants.evaluation.matchedGrantIds,
        deniedGrantIds: tenantBoundary.permissionGrants.evaluation.denyGrantIds
      }
    }
  };
}

function deriveScheduledJob({ now, enabled, intervalMs, anchorAt, fallbackState, command, route, blockedReasons = [] }) {
  const nextDueAt = enabled
    ? addMsToIso(anchorAt || now, intervalMs)
    : null;
  const due = enabled && nextDueAt !== null && String(nextDueAt) <= String(now);
  const blocked = blockedReasons.length > 0;

  return {
    state: enabled
      ? blocked
        ? 'held'
        : due
          ? 'due'
          : 'scheduled'
      : fallbackState,
    command: enabled ? command : null,
    nextDueAt,
    route: enabled && !blocked ? route : null,
    due: due && !blocked,
    intervalMs: enabled ? intervalMs : null
  };
}

function buildScheduledCommandBlockers({ now, command, settings, mode, lifecycle, providerNegotiation, externalHandoff, failureRecovery }) {
  const blockers = [];
  const quietUntilEpoch = toEpochMs(settings.quietUntil);
  const nowEpoch = toEpochMs(now);
  const nowBlockedByQuietWindow = quietUntilEpoch !== null && nowEpoch !== null && quietUntilEpoch > nowEpoch;

  if (!settings.enabled) blockers.push('lifecycle-disabled');
  if (settings.paused) blockers.push('lifecycle-paused');
  if (settings.schedulingPaused) blockers.push('scheduling-paused');
  if (nowBlockedByQuietWindow) blockers.push('quiet-window-active');
  if (settings.disabledScheduledCommands.includes(command)) blockers.push('scheduled-command-disabled');
  if (mode === 'failed') blockers.push('adapter-validation-failed');
  if (failureRecovery?.writeAdmission !== 'open' && settings.scheduleAfterRecoveryProbe) blockers.push('recovery-probe-required');

  if (command === 'flush') {
    if (!lifecycle?.canFlush) blockers.push('flush-not-admitted');
    if (!providerNegotiation?.writeRoute) blockers.push('write-route-unavailable');
    if (externalHandoff?.blocksWrites) blockers.push('external-handoff-blocks-write');
  } else if (command === 'snapshot') {
    if (!settings.autoSnapshot) blockers.push('auto-snapshot-disabled');
    if (!lifecycle?.canSnapshot) blockers.push('snapshot-not-admitted');
    if (!providerNegotiation?.auditRoute) blockers.push('audit-route-unavailable');
  } else if (command === 'retention-sweep') {
    if (!lifecycle?.canSnapshot) blockers.push('audit-route-unavailable');
    if (settings.retentionDays < 1) blockers.push('retention-disabled');
  }

  return [...new Set(blockers)];
}

function attachSchedulingAdmission(job, blockers) {
  return {
    ...job,
    blockedReasons: blockers,
    runnable: job.due && blockers.length === 0,
    admission: blockers.length === 0 ? 'admitted' : 'held'
  };
}

function selectNextScheduledAction({ jobs, settings, providerNegotiation }) {
  const orderedDueJobs = jobs
    .filter((job) => job.runnable)
    .sort((left, right) => String(left.nextDueAt || '').localeCompare(String(right.nextDueAt || '')));
  const dispatchable = orderedDueJobs.slice(0, settings.maxDueCommandsPerTick);
  const firstHeldJob = jobs.find((job) => job.blockedReasons.length > 0) || null;
  const nextScheduledJob = jobs
    .filter((job) => job.blockedReasons.length === 0 && job.nextDueAt)
    .sort((left, right) => String(left.nextDueAt).localeCompare(String(right.nextDueAt)))[0] || null;
  const selected = dispatchable[0] || nextScheduledJob || firstHeldJob;

  return {
    contract: 'aios.projectMemoryAdapter.scheduledNextAction.v1',
    state: dispatchable.length > 0
      ? 'dispatch-ready'
      : nextScheduledJob
        ? 'scheduled'
        : firstHeldJob
          ? 'held'
          : 'idle',
    command: selected?.command || null,
    dueAt: selected?.nextDueAt || null,
    route: selected?.route === 'audit'
      ? providerNegotiation?.auditRoute || null
      : selected?.route === 'write'
        ? providerNegotiation?.writeRoute || null
        : null,
    dispatchableCommands: dispatchable.map((job) => job.command),
    heldCommands: jobs
      .filter((job) => job.blockedReasons.length > 0)
      .map((job) => ({
        command: job.command,
        blockedReasons: job.blockedReasons,
        nextDueAt: job.nextDueAt
      })),
    maxDueCommandsPerTick: settings.maxDueCommandsPerTick
  };
}

function buildSchedulingControls({ now, settings, storeHealth, mode, history, lifecycle, providerNegotiation, externalHandoff, failureRecovery }) {
  const latestWriteAt = storeHealth.lastSuccessfulWriteAt || history.findLast?.((event) => event.operation === 'write')?.timestamp || null;
  const latestSnapshotAt = history.findLast?.((event) => event.snapshotId || event.operation === 'snapshot')?.timestamp || null;
  const latestRetentionAt = history.findLast?.((event) => event.operation === 'retention-sweep')?.timestamp || null;
  const quietUntilEpoch = toEpochMs(settings.quietUntil);
  const nowEpoch = toEpochMs(now);
  const quietWindowActive = quietUntilEpoch !== null && nowEpoch !== null && quietUntilEpoch > nowEpoch;
  const schedulingEnabled = settings.enabled && !settings.paused && !settings.schedulingPaused && !quietWindowActive && mode !== 'failed';
  const flushBlockers = buildScheduledCommandBlockers({
    now,
    command: 'flush',
    settings,
    mode,
    lifecycle,
    providerNegotiation,
    externalHandoff,
    failureRecovery
  });
  const snapshotBlockers = buildScheduledCommandBlockers({
    now,
    command: 'snapshot',
    settings,
    mode,
    lifecycle,
    providerNegotiation,
    externalHandoff,
    failureRecovery
  });
  const retentionBlockers = buildScheduledCommandBlockers({
    now,
    command: 'retention-sweep',
    settings,
    mode,
    lifecycle,
    providerNegotiation,
    externalHandoff,
    failureRecovery
  });
  const syncJob = attachSchedulingAdmission(deriveScheduledJob({
    now,
    enabled: settings.enabled && !settings.paused,
    intervalMs: settings.syncIntervalMs,
    anchorAt: latestWriteAt,
    fallbackState: 'held',
    command: 'flush',
    route: 'write',
    blockedReasons: flushBlockers
  }), flushBlockers);
  const snapshotJob = attachSchedulingAdmission(deriveScheduledJob({
    now,
    enabled: settings.enabled && !settings.paused && settings.autoSnapshot,
    intervalMs: settings.snapshotIntervalMs,
    anchorAt: latestSnapshotAt || latestWriteAt,
    fallbackState: 'held',
    command: 'snapshot',
    route: 'audit',
    blockedReasons: snapshotBlockers
  }), snapshotBlockers);
  const retentionJob = attachSchedulingAdmission(deriveScheduledJob({
    now,
    enabled: settings.enabled && !settings.paused,
    intervalMs: 86_400_000,
    anchorAt: latestRetentionAt || latestSnapshotAt || latestWriteAt,
    fallbackState: 'held',
    command: 'retention-sweep',
    route: 'audit',
    blockedReasons: retentionBlockers
  }), retentionBlockers);
  const jobList = [syncJob, snapshotJob, retentionJob];
  const nextScheduledAction = selectNextScheduledAction({
    jobs: jobList,
    settings,
    providerNegotiation
  });

  return {
    contract: 'aios.projectMemoryAdapter.scheduling.v1',
    enabled: schedulingEnabled,
    paused: settings.schedulingPaused,
    quietUntil: settings.quietUntil,
    quietWindowActive,
    syncIntervalMs: settings.syncIntervalMs,
    snapshotIntervalMs: settings.autoSnapshot ? settings.snapshotIntervalMs : null,
    retentionDays: settings.retentionDays,
    maxEntriesPerFlush: settings.maxEntriesPerFlush,
    disabledScheduledCommands: settings.disabledScheduledCommands,
    maxDueCommandsPerTick: settings.maxDueCommandsPerTick,
    anchors: {
      evaluatedAt: now,
      lastWriteAt: latestWriteAt,
      lastSnapshotAt: latestSnapshotAt,
      lastRetentionSweepAt: latestRetentionAt
    },
    jobs: {
      sync: syncJob.state,
      snapshot: snapshotJob.state,
      retentionSweep: retentionJob.state
    },
    jobDetails: {
      sync: syncJob,
      snapshot: snapshotJob,
      retentionSweep: retentionJob
    },
    dueCommands: jobList
      .filter((job) => job.due && job.command)
      .map((job) => job.command),
    dispatchableCommands: nextScheduledAction.dispatchableCommands,
    heldCommands: nextScheduledAction.heldCommands,
    nextScheduledAction
  };
}

function evaluateLifecycleCommandAdmission({ command, settings, mode, storeHealth, capabilities, negotiated, tenantBoundary, externalHandoff, findings }) {
  if (!command) {
    return {
      allowed: mode !== 'failed',
      state: mode === 'failed' ? 'blocked' : 'idle',
      blockedReasons: mode === 'failed' ? ['adapter-validation-failed'] : [],
      requiredCapabilities: []
    };
  }

  const requiredCapabilities = LIFECYCLE_COMMAND_REQUIREMENTS[command] || [];
  const blockedReasons = [];

  if (!LIFECYCLE_COMMANDS.includes(command)) blockedReasons.push('unsupported-command');
  if (command !== 'validate-settings' && findings.some((finding) => finding.severity === 'error')) blockedReasons.push('validation-errors');
  if ((command === 'disable' || command === 'pause') && !capabilities.has('audit.emit')) blockedReasons.push('audit-capability-missing');
  if ((command === 'resume' || command === 'flush') && !settings.enabled) blockedReasons.push('adapter-disabled');
  if (command === 'enable' && settings.enabled) blockedReasons.push('already-enabled');
  if (command === 'pause' && settings.paused) blockedReasons.push('already-paused');
  if (command === 'resume' && !settings.paused) blockedReasons.push('not-paused');
  if (command === 'flush' && (!storeHealth.writable || externalHandoff?.blocksWrites)) blockedReasons.push('write-route-held');
  if (command === 'snapshot' && !tenantBoundary?.capabilities.canAudit) blockedReasons.push('audit-permission-missing');

  for (const capability of requiredCapabilities) {
    if (!capabilities.has(capability) || (negotiated.size > 0 && !negotiated.has(capability))) {
      blockedReasons.push(`missing-${capability}`);
    }
  }

  return {
    allowed: blockedReasons.length === 0,
    state: blockedReasons.length === 0 ? 'admitted' : 'rejected',
    blockedReasons: [...new Set(blockedReasons)],
    requiredCapabilities
  };
}

function buildLifecycleControls({ now, command, settings, mode, storeHealth, capabilities, findings, providerNegotiation, externalHandoff, tenantBoundary }) {
  const negotiated = normalizeCapabilitySet(providerNegotiation?.negotiatedCapabilities || []);
  const commandAdmission = evaluateLifecycleCommandAdmission({
    command,
    settings,
    mode,
    storeHealth,
    capabilities,
    negotiated,
    tenantBoundary,
    externalHandoff,
    findings
  });
  const transition = deriveLifecycleSettingsTransition({
    now,
    command,
    currentSettings: settings,
    commandAdmission,
    providerNegotiation,
    tenantBoundary
  });
  const effectiveSettings = transition.effectiveSettings;
  const commandDispatches = buildLifecycleCommandDispatches({
    command,
    transition,
    commandAdmission,
    providerNegotiation
  });
  const writeAllowed = mode === 'ready'
    && storeHealth.writable
    && capabilities.has('projectMemory.write')
    && negotiated.has('projectMemory.write')
    && tenantBoundary?.capabilities.canWrite
    && tenantBoundary?.allowed
    && !externalHandoff?.blocksWrites;

  return {
    contract: 'aios.projectMemoryAdapter.lifecycleControls.v1',
    requestedCommand: command || null,
    commandAllowed: commandAdmission.allowed,
    commandAdmission,
    settingsTransition: transition,
    effectiveSettings,
    commandDispatches,
    enabled: effectiveSettings.enabled && mode !== 'failed',
    paused: effectiveSettings.paused || mode === 'failed',
    canRead: mode !== 'failed'
      && storeHealth.readable
      && capabilities.has('projectMemory.read')
      && negotiated.has('projectMemory.read')
      && tenantBoundary?.capabilities.canRead
      && tenantBoundary?.allowed,
    canWrite: effectiveSettings.enabled && !effectiveSettings.paused && writeAllowed,
    canFlush: effectiveSettings.enabled && !effectiveSettings.paused && writeAllowed,
    canSnapshot: effectiveSettings.enabled
      && mode !== 'failed'
      && capabilities.has('audit.emit')
      && negotiated.has('audit.emit')
      && tenantBoundary?.capabilities.canRead
      && tenantBoundary?.capabilities.canAudit
      && tenantBoundary?.allowed,
    providerRoutes: {
      read: providerNegotiation?.readRoute || null,
      write: providerNegotiation?.writeRoute || null,
      audit: providerNegotiation?.auditRoute || null
    },
    commandEnvelope: command
      ? {
          contract: 'aios.projectMemoryAdapter.lifecycleCommand.v1',
          command,
          state: commandAdmission.state,
          requiredCapabilities: commandAdmission.requiredCapabilities,
          blockedReasons: commandAdmission.blockedReasons,
          route: command === 'flush'
            ? providerNegotiation?.writeRoute || null
            : command === 'snapshot' || command === 'disable' || command === 'pause'
              ? providerNegotiation?.auditRoute || null
              : providerNegotiation?.readRoute || providerNegotiation?.writeRoute || null,
          proofRequired: command !== 'validate-settings',
          proofId: transition.proof.id,
          idempotencyScope: `${surfaceId}:${tenantBoundary?.isolationKey || 'unscoped'}:${command}`
        }
      : null,
    disabledReason: effectiveSettings.enabled
      ? null
      : 'disabled-by-lifecycle-settings'
  };
}

function deriveNextLifecycleAction({ mode, command, controls, scheduling, actionableErrors }) {
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'error');

  if (blockingErrors.length > 0) {
    return {
      state: 'blocked',
      command: 'validate-settings',
      reason: blockingErrors[0].code,
      auditRequired: true,
      blockedReasons: controls.commandAdmission?.blockedReasons || [blockingErrors[0].code],
      dueAt: null,
      route: controls.providerRoutes.audit || controls.providerRoutes.read
    };
  }

  if (command && controls.commandAllowed) {
    return {
      state: 'ready-to-apply',
      command,
      reason: 'requested-command-validated',
      auditRequired: command !== 'validate-settings',
      blockedReasons: [],
      dueAt: null,
      route: controls.commandEnvelope?.route || controls.providerRoutes.write || controls.providerRoutes.read
    };
  }

  if (command && !controls.commandAllowed) {
    return {
      state: 'rejected',
      command,
      reason: controls.commandAdmission?.blockedReasons?.[0] || 'command-not-admitted',
      auditRequired: true,
      blockedReasons: controls.commandAdmission?.blockedReasons || ['command-not-admitted'],
      dueAt: null,
      route: controls.commandEnvelope?.route || controls.providerRoutes.audit || controls.providerRoutes.read
    };
  }

  if (!controls.enabled) {
    return {
      state: 'disabled',
      command: null,
      reason: controls.disabledReason,
      auditRequired: false,
      blockedReasons: [controls.disabledReason].filter(Boolean),
      dueAt: null,
      route: controls.providerRoutes.read
    };
  }

  if (mode === 'degraded-read-only') {
    return {
      state: 'degraded',
      command: 'snapshot',
      reason: 'capture-read-only-recovery-proof',
      auditRequired: true,
      blockedReasons: [],
      dueAt: null,
      route: controls.providerRoutes.audit || controls.providerRoutes.read
    };
  }

  const scheduledAction = scheduling.nextScheduledAction || null;
  const dueJob = scheduledAction?.state === 'dispatch-ready'
    ? {
        command: scheduledAction.command,
        nextDueAt: scheduledAction.dueAt,
        route: scheduledAction.route === controls.providerRoutes.audit ? 'audit' : 'write'
      }
    : null;

  return {
    state: dueJob ? 'due' : scheduledAction?.state === 'held' ? 'held' : scheduling.enabled ? 'scheduled' : 'idle',
    command: dueJob?.command || scheduledAction?.command || (scheduling.enabled ? 'flush' : null),
    reason: dueJob
      ? `${dueJob.command}-due`
      : scheduledAction?.state === 'held'
        ? 'scheduled-command-held'
        : scheduling.enabled
          ? 'next-scheduled-sync-ready'
          : 'scheduling-held',
    auditRequired: dueJob?.command === 'snapshot',
    blockedReasons: scheduledAction?.state === 'held'
      ? scheduledAction.heldCommands?.[0]?.blockedReasons || []
      : [],
    dueAt: dueJob?.nextDueAt || scheduledAction?.dueAt || scheduling.jobDetails?.sync?.nextDueAt || null,
    route: dueJob?.route === 'audit'
      ? controls.providerRoutes.audit
      : scheduledAction?.route || controls.providerRoutes.write || controls.providerRoutes.read
  };
}

function summarizeValidationFindings(findings) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byCode = {};

  for (const finding of findings) {
    const severity = finding.severity || 'info';
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    byCode[finding.code] = (byCode[finding.code] || 0) + 1;
  }

  const firstBlockingFinding = findings.find((finding) => finding.severity === 'error') || null;
  const firstWarning = findings.find((finding) => finding.severity === 'warning') || null;

  return {
    contract: 'aios.projectMemoryAdapter.validationSummary.v1',
    valid: bySeverity.error === 0,
    status: bySeverity.error > 0 ? 'blocked' : bySeverity.warning > 0 ? 'needs-attention' : 'clean',
    counts: {
      errors: bySeverity.error,
      warnings: bySeverity.warning,
      info: bySeverity.info,
      total: findings.length
    },
    byCode,
    firstBlockingFinding,
    headline: firstBlockingFinding?.message || firstWarning?.message || 'Project memory adapter validation passed.'
  };
}

function buildReadinessGates({ input, projectRef, mode, lifecycle, providerNegotiation, externalHandoff, tenantBoundary, findings }) {
  const negotiated = normalizeCapabilitySet(providerNegotiation.negotiatedCapabilities);
  const gateInputs = [
    {
      id: 'host-attached',
      label: 'Hosted kernel attached',
      ready: isObject(input.kernelHost),
      blocking: true,
      reason: 'missing_kernel_host'
    },
    {
      id: 'project-scoped',
      label: 'Project scope resolved',
      ready: typeof projectRef === 'string' && projectRef.trim().length > 0,
      blocking: true,
      reason: 'invalid_project_ref'
    },
    {
      id: 'tenant-workspace-boundary',
      label: 'Tenant workspace boundary',
      ready: tenantBoundary.allowed,
      blocking: true,
      reason: tenantBoundary.missingPermissions.length > 0 ? 'permission_denied' : 'tenant_boundary_violation'
    },
    {
      id: 'principal-permission',
      label: 'Principal authorized',
      ready: tenantBoundary.checks.permissionAllowed,
      blocking: true,
      reason: 'permission_denied'
    },
    {
      id: 'read-route',
      label: 'Read route negotiated',
      ready: lifecycle.canRead && negotiated.has('projectMemory.read'),
      blocking: true,
      reason: 'unavailable_capability'
    },
    {
      id: 'provider-service-contracts',
      label: 'Provider service contracts',
      ready: providerNegotiation.providers.every((provider) => provider.serviceContract?.compatible !== false),
      blocking: true,
      reason: 'invalid_provider_contract'
    },
    {
      id: 'write-route',
      label: 'Write route acceptable',
      ready: lifecycle.canWrite && negotiated.has('projectMemory.write'),
      blocking: false,
      reason: externalHandoff.blocksWrites ? 'external_handoff_blocked' : 'unavailable_capability'
    },
    {
      id: 'audit-route',
      label: 'Audit proof route available',
      ready: lifecycle.canSnapshot && negotiated.has('audit.emit'),
      blocking: true,
      reason: 'unavailable_capability'
    },
    {
      id: 'handoff-clear',
      label: 'External handoff clear',
      ready: !externalHandoff.blocksWrites,
      blocking: false,
      reason: 'external_handoff_blocked'
    }
  ];
  const gates = gateInputs.map((gate) => ({
    ...gate,
    severity: gate.ready ? 'pass' : gate.blocking ? 'error' : 'warning',
    findingCount: findings.filter((finding) => finding.code === gate.reason).length
  }));
  const requiredGates = gates.filter((gate) => gate.blocking);
  const passedRequired = requiredGates.filter((gate) => gate.ready).length;

  return {
    contract: 'aios.projectMemoryAdapter.readiness.v1',
    state: mode === 'failed'
      ? 'blocked'
      : gates.some((gate) => !gate.ready && !gate.blocking)
        ? 'read-only-ready'
        : 'ready',
    score: requiredGates.length > 0 ? Math.round((passedRequired / requiredGates.length) * 100) : 100,
    gates,
    acceptedOperations: {
      read: lifecycle.canRead,
      write: lifecycle.canWrite,
      snapshot: lifecycle.canSnapshot,
      flush: lifecycle.canFlush
    }
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : null))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function derivePrincipalPermissions(principalSource = {}, clientSource = {}) {
  const roles = [
    ...normalizeStringList(principalSource.roles),
    ...normalizeStringList(clientSource.roles)
  ];
  const explicitPermissions = [
    ...normalizeStringList(principalSource.permissions),
    ...normalizeStringList(clientSource.permissions)
  ];
  const rolePermissions = roles.flatMap((role) => PRINCIPAL_ROLE_PERMISSIONS[role] || []);

  return {
    roles: [...new Set(roles)].sort(),
    permissions: [...new Set([...explicitPermissions, ...rolePermissions])].sort(),
    explicitPermissions: [...new Set(explicitPermissions)].sort(),
    rolePermissions: [...new Set(rolePermissions)].sort()
  };
}

function normalizeTenantPermissionGrant(grant, index, { tenantId, workspaceId, projectRef, principalId, now }) {
  if (!isObject(grant)) {
    return null;
  }

  const scope = isObject(grant.scope) ? grant.scope : grant;
  const operationScope = normalizeStringList(grant.operations || grant.operation || grant.allowedOperations);
  const permissionScope = normalizeStringList(grant.permissions || grant.permission || grant.capabilities);
  const tenantScope = normalizeStringList(scope.tenantIds || scope.tenants || scope.tenantId);
  const workspaceScope = normalizeStringList(scope.workspaceIds || scope.workspaces || scope.workspaceId);
  const projectScope = normalizeStringList(scope.projectRefs || scope.projects || scope.projectRef || scope.projectId || scope.projectRoot);
  const principalScope = normalizeStringList(scope.principalIds || scope.principals || scope.principalId || scope.userId);
  const effect = firstString(grant.effect, grant.action, grant.decision) === 'deny' ? 'deny' : 'allow';
  const expiresAt = firstString(grant.expiresAt, grant.validUntil);
  const expired = expiresAt ? String(expiresAt) <= String(now) : false;
  const scopeMatch = {
    tenant: tenantScope.length === 0 || (tenantId !== null && tenantScope.includes(tenantId)),
    workspace: workspaceScope.length === 0 || (workspaceId !== null && workspaceScope.includes(workspaceId)),
    project: projectScope.length === 0 || (projectRef !== null && projectScope.includes(projectRef)),
    principal: principalScope.length === 0 || (principalId !== null && principalScope.includes(principalId))
  };
  const matched = Object.values(scopeMatch).every(Boolean) && !expired;

  return {
    contract: 'aios.projectMemoryAdapter.permissionGrant.v1',
    id: firstString(grant.id, grant.grantId) || `permission-grant-${index + 1}`,
    source: firstString(grant.source, grant.issuer, grant.authority) || 'hosted-kernel-policy',
    effect,
    permissions: [...new Set(permissionScope)].sort(),
    operations: [...new Set(operationScope)].sort(),
    scope: {
      tenants: tenantScope,
      workspaces: workspaceScope,
      projects: projectScope,
      principals: principalScope
    },
    expiresAt,
    matched,
    inactiveReason: expired
      ? 'expired'
      : matched
        ? null
        : 'scope-mismatch',
    scopeMatch
  };
}

function normalizeTenantPermissionGrants({ input, tenantSource, workspaceSource, kernelHost, now, tenantId, workspaceId, projectRef, principalId }) {
  const rawGrants = [
    ...(
      Array.isArray(input.permissionGrants)
        ? input.permissionGrants
        : Array.isArray(input.grants)
          ? input.grants
          : []
    ),
    ...(Array.isArray(tenantSource.permissionGrants) ? tenantSource.permissionGrants : []),
    ...(Array.isArray(workspaceSource.permissionGrants) ? workspaceSource.permissionGrants : []),
    ...(Array.isArray(kernelHost.permissionGrants) ? kernelHost.permissionGrants : [])
  ];

  return rawGrants
    .map((grant, index) => normalizeTenantPermissionGrant(grant, index, {
      tenantId,
      workspaceId,
      projectRef,
      principalId,
      now
    }))
    .filter(Boolean);
}

function evaluateTenantPermissionGrants({ grants, operation, requiredPermissions }) {
  const appliesToOperation = (grant) => grant.operations.length === 0 || grant.operations.includes(operation);
  const matchedGrants = grants.filter((grant) => grant.matched && appliesToOperation(grant));
  const allowGrants = matchedGrants.filter((grant) => grant.effect === 'allow');
  const denyGrants = matchedGrants.filter((grant) => grant.effect === 'deny');
  const grantedPermissions = [...new Set(allowGrants.flatMap((grant) => grant.permissions))].sort();
  const deniedPermissions = [...new Set(denyGrants.flatMap((grant) => grant.permissions))].sort();
  const requiredDenied = requiredPermissions.filter((permission) => deniedPermissions.includes(permission));
  const requiredGranted = requiredPermissions.filter((permission) => grantedPermissions.includes(permission));

  return {
    contract: 'aios.projectMemoryAdapter.permissionGrantEvaluation.v1',
    state: requiredDenied.length > 0
      ? 'denied'
      : requiredGranted.length > 0
        ? 'granted'
        : 'not-applicable',
    matchedGrantIds: matchedGrants.map((grant) => grant.id),
    allowGrantIds: allowGrants.map((grant) => grant.id),
    denyGrantIds: denyGrants.map((grant) => grant.id),
    grantedPermissions,
    deniedPermissions,
    requiredGranted,
    requiredDenied,
    inactiveGrantIds: grants.filter((grant) => !grant.matched).map((grant) => grant.id)
  };
}

function normalizeTenantWorkspaceBoundary({ input, now, projectRef, lifecycleCommand }) {
  const kernelHost = isObject(input.kernelHost) ? input.kernelHost : {};
  const tenantSource = isObject(input.tenant)
    ? input.tenant
    : isObject(input.tenantContext)
      ? input.tenantContext
      : isObject(kernelHost.tenant)
        ? kernelHost.tenant
        : {};
  const workspaceSource = isObject(input.workspace)
    ? input.workspace
    : isObject(input.workspaceContext)
      ? input.workspaceContext
      : isObject(kernelHost.workspace)
        ? kernelHost.workspace
        : {};
  const clientSource = isObject(input.clientState)
    ? input.clientState
    : isObject(input.client)
      ? input.client
      : {};
  const principalSource = isObject(input.principal)
    ? input.principal
    : isObject(input.actor)
      ? input.actor
      : isObject(clientSource.principal)
        ? clientSource.principal
        : isObject(kernelHost.principal)
          ? kernelHost.principal
          : {};
  const requestSource = isObject(input.request)
    ? input.request
    : isObject(input.memoryRequest)
      ? input.memoryRequest
      : {};
  const tenantId = firstString(input.tenantId, tenantSource.id, tenantSource.tenantId, kernelHost.tenantId);
  const workspaceId = firstString(input.workspaceId, workspaceSource.id, workspaceSource.workspaceId, kernelHost.workspaceId);
  const principalId = firstString(principalSource.id, principalSource.principalId, principalSource.userId, clientSource.userId, input.principalId);
  const requestedOperation = firstString(
    requestSource.operation,
    input.operation,
    lifecycleCommand === 'snapshot' || lifecycleCommand === 'flush' ? lifecycleCommand : null
  ) || 'inspect';
  const operation = MEMORY_OPERATION_PERMISSIONS[requestedOperation] ? requestedOperation : 'inspect';
  const allowedTenants = normalizeStringList(kernelHost.allowedTenants || tenantSource.allowedTenants);
  const allowedWorkspaces = normalizeStringList(kernelHost.allowedWorkspaces || tenantSource.allowedWorkspaces);
  const allowedProjects = normalizeStringList(workspaceSource.projectRefs || workspaceSource.projects || kernelHost.allowedProjects);
  const permissionShape = derivePrincipalPermissions(principalSource, clientSource);
  const scopeRequired = kernelHost.multiTenant === true || kernelHost.requireTenantScope === true || allowedTenants.length > 0 || allowedWorkspaces.length > 0;
  const hostServicePermissions = !scopeRequired && !principalId && permissionShape.permissions.length === 0
    ? [...normalizeCapabilitySet(kernelHost.capabilities)].filter((capability) => REQUIRED_HOST_CAPABILITIES.includes(capability))
    : [];
  const requiredPermissions = MEMORY_OPERATION_PERMISSIONS[operation] || MEMORY_OPERATION_PERMISSIONS.inspect;
  const permissionGrants = normalizeTenantPermissionGrants({
    input,
    tenantSource,
    workspaceSource,
    kernelHost,
    now,
    tenantId,
    workspaceId,
    projectRef,
    principalId
  });
  const grantEvaluation = evaluateTenantPermissionGrants({
    grants: permissionGrants,
    operation,
    requiredPermissions
  });
  const effectivePermissions = [...new Set([
    ...permissionShape.permissions,
    ...hostServicePermissions,
    ...grantEvaluation.grantedPermissions
  ])].sort();
  const permissionSet = new Set(effectivePermissions);
  const missingPermissions = requiredPermissions.filter((permission) => !permissionSet.has(permission));
  const deniedRequiredPermissions = requiredPermissions.filter((permission) => grantEvaluation.deniedPermissions.includes(permission));
  const tenantAllowed = allowedTenants.length === 0 || (tenantId !== null && allowedTenants.includes(tenantId));
  const workspaceAllowed = allowedWorkspaces.length === 0 || (workspaceId !== null && allowedWorkspaces.includes(workspaceId));
  const projectAllowed = allowedProjects.length === 0 || (projectRef !== null && allowedProjects.includes(projectRef));
  const workspaceTenantId = firstString(workspaceSource.tenantId, workspaceSource.ownerTenantId);
  const tenantMatchesWorkspace = !tenantId || !workspaceTenantId || tenantId === workspaceTenantId;
  const scopeComplete = Boolean(tenantId && workspaceId && principalId);
  const canRead = permissionSet.has('projectMemory.read') || permissionSet.has('projectMemory.admin');
  const canWrite = permissionSet.has('projectMemory.write') || permissionSet.has('projectMemory.admin');
  const canAudit = permissionSet.has('audit.emit') || permissionSet.has('projectMemory.admin');
  const allowed = (!scopeRequired || scopeComplete)
    && tenantAllowed
    && workspaceAllowed
    && projectAllowed
    && tenantMatchesWorkspace
    && missingPermissions.length === 0
    && deniedRequiredPermissions.length === 0;

  return {
    contract: 'aios.projectMemoryAdapter.tenantWorkspaceBoundary.v1',
    evaluatedAt: now,
    tenantId,
    workspaceId,
    projectRef,
    principal: {
      id: principalId,
      type: firstString(principalSource.type, principalSource.kind) || (hostServicePermissions.length > 0 ? 'host-service' : 'unknown'),
      roles: permissionShape.roles,
      permissions: effectivePermissions,
      permissionSources: {
        rolePermissions: permissionShape.rolePermissions,
        explicitPermissions: permissionShape.explicitPermissions,
        hostServicePermissions,
        grantPermissions: grantEvaluation.grantedPermissions
      }
    },
    operation,
    requiredPermissions,
    missingPermissions,
    deniedPermissions: deniedRequiredPermissions,
    permissionGrants: {
      contract: 'aios.projectMemoryAdapter.permissionGrantSet.v1',
      state: grantEvaluation.state,
      grants: permissionGrants,
      evaluation: grantEvaluation
    },
    allowedTenants,
    allowedWorkspaces,
    allowedProjects,
    checks: {
      scopeRequired,
      scopeComplete,
      tenantAllowed,
      workspaceAllowed,
      projectAllowed,
      tenantMatchesWorkspace,
      permissionAllowed: missingPermissions.length === 0 && deniedRequiredPermissions.length === 0,
      grantAllowed: grantEvaluation.state !== 'denied'
    },
    capabilities: {
      canRead,
      canWrite,
      canAudit
    },
    allowed,
    isolationKey: tenantId && workspaceId && projectRef
      ? `${tenantId}:${workspaceId}:${projectRef}`
      : null,
    auditSubject: `${tenantId || 'tenant-unscoped'}:${workspaceId || 'workspace-unscoped'}:${principalId || 'principal-unscoped'}`
  };
}

function buildTenantBoundaryFindings(tenantBoundary) {
  const findings = [];

  if (tenantBoundary.checks.scopeRequired && !tenantBoundary.checks.scopeComplete) {
    findings.push({
      code: 'workspace_scope_required',
      severity: 'error',
      message: 'Hosted project memory requires tenantId, workspaceId, and principal identity before serving this request.'
    });
  }

  for (const [check, ready] of Object.entries({
    tenantAllowed: tenantBoundary.checks.tenantAllowed,
    workspaceAllowed: tenantBoundary.checks.workspaceAllowed,
    projectAllowed: tenantBoundary.checks.projectAllowed,
    tenantMatchesWorkspace: tenantBoundary.checks.tenantMatchesWorkspace
  })) {
    if (!ready) {
      findings.push({
        code: 'tenant_boundary_violation',
        severity: 'error',
        message: `Project memory request failed tenant/workspace boundary check: ${check}.`
      });
    }
  }

  if (tenantBoundary.missingPermissions.length > 0) {
    findings.push({
      code: 'permission_denied',
      severity: 'error',
      message: `Principal is missing permissions for ${tenantBoundary.operation}: ${tenantBoundary.missingPermissions.join(', ')}.`
    });
  }

  if (tenantBoundary.deniedPermissions.length > 0) {
    findings.push({
      code: 'permission_denied',
      severity: 'error',
      message: `Scoped tenant permission grant denies ${tenantBoundary.operation}: ${tenantBoundary.deniedPermissions.join(', ')}.`,
      grantIds: tenantBoundary.permissionGrants.evaluation.denyGrantIds
    });
  }

  return findings;
}

function normalizeClientRequestState({ input, now, projectRef, lifecycleCommand }) {
  const clientSource = isObject(input.clientState)
    ? input.clientState
    : isObject(input.client)
      ? input.client
      : {};
  const requestSource = isObject(input.request)
    ? input.request
    : isObject(input.memoryRequest)
      ? input.memoryRequest
      : {};
  const allowedOperations = new Set(['read', 'write', 'snapshot', 'flush', 'sync', 'inspect']);
  const requestedOperation = firstString(
    requestSource.operation,
    input.operation,
    lifecycleCommand === 'snapshot' || lifecycleCommand === 'flush' ? lifecycleCommand : null
  ) || 'inspect';
  const operation = allowedOperations.has(requestedOperation) ? requestedOperation : 'inspect';
  const pendingMutations = Array.isArray(clientSource.pendingMutations)
    ? clientSource.pendingMutations.length
    : Number.isInteger(clientSource.pendingMutationCount) && clientSource.pendingMutationCount > 0
      ? clientSource.pendingMutationCount
      : 0;
  const requestedHandoff = clientSource.requestExternalHandoff === true
    || requestSource.handoff === 'external'
    || requestSource.target === 'external-sync';

  return {
    contract: 'aios.projectMemoryAdapter.clientRequestState.v1',
    requestId: firstString(requestSource.id, requestSource.requestId, input.requestId) || `request:${surfaceId}:${now}`,
    sessionId: firstString(clientSource.sessionId, input.sessionId),
    workflowId: firstString(clientSource.workflowId, requestSource.workflowId),
    projectRef,
    operation,
    intent: firstString(requestSource.intent, clientSource.intent) || 'project-memory-workflow',
    clientMode: firstString(clientSource.mode, requestSource.clientMode) || 'interactive',
    requestedAt: firstString(requestSource.requestedAt, clientSource.requestedAt) || now,
    lastSeenProofId: firstString(clientSource.lastSeenProofId, requestSource.lastSeenProofId),
    lastAcceptedSnapshotId: firstString(clientSource.lastAcceptedSnapshotId, requestSource.lastAcceptedSnapshotId),
    pendingMutationCount: pendingMutations,
    requestedHandoff,
    expectsWriteAck: operation === 'write' || pendingMutations > 0,
    wantsFreshSnapshot: operation === 'snapshot' || requestSource.freshSnapshot === true
  };
}

function normalizePersistedState({ input, now, projectRef, history }) {
  const source = isObject(input.persistedState)
    ? input.persistedState
    : isObject(input.state)
      ? input.state
      : isObject(input.checkpoint)
        ? input.checkpoint
        : {};
  const commandSource = isObject(source.lastCommand)
    ? source.lastCommand
    : isObject(source.command)
      ? source.command
      : {};
  const lastHistoryEvent = history[history.length - 1] || null;
  const status = firstString(source.status, source.adapterStatus) || 'cold-start';
  const commandState = firstString(commandSource.state, commandSource.status) || null;
  const commandId = firstString(commandSource.id, commandSource.commandId, source.commandId);

  return {
    contract: 'aios.projectMemoryAdapter.persistedState.v1',
    projectRef: firstString(source.projectRef, source.projectId, source.projectRoot) || projectRef,
    checkpointId: firstString(source.checkpointId, source.id) || `checkpoint:${surfaceId}:${projectRef || 'unscoped'}`,
    version: Number.isInteger(source.version) && source.version > 0 ? source.version : 1,
    status,
    restoredAt: now,
    persistedAt: firstString(source.persistedAt, source.updatedAt, source.timestamp),
    lastStableStatus: firstString(source.lastStableStatus, source.stableStatus) || (status === 'ready' ? 'ready' : null),
    lastProofId: firstString(source.lastProofId, source.proofId, lastHistoryEvent?.proofId),
    lastSnapshotId: firstString(source.lastSnapshotId, source.snapshotId, lastHistoryEvent?.snapshotId),
    lastAppliedEventId: firstString(source.lastAppliedEventId, source.eventId, lastHistoryEvent?.id),
    lastCommand: commandId
      ? {
          id: commandId,
          command: firstString(commandSource.command, commandSource.name),
          state: commandState || 'unknown',
          requestId: firstString(commandSource.requestId, source.requestId),
          idempotencyKey: firstString(commandSource.idempotencyKey, commandSource.key),
          route: firstString(commandSource.route, source.route),
          startedAt: firstString(commandSource.startedAt, commandSource.requestedAt),
          completedAt: firstString(commandSource.completedAt, commandSource.appliedAt),
          proofId: firstString(commandSource.proofId, source.lastProofId),
          resultEventId: firstString(commandSource.resultEventId, source.lastAppliedEventId)
        }
      : null,
    pendingReplay: Array.isArray(source.pendingReplay)
      ? source.pendingReplay.filter((item) => isObject(item)).slice(-10)
      : [],
    dirty: source.dirty === true || status === 'recovering' || status === 'interrupted',
    sourceShape: Object.keys(source).length > 0 ? 'restored' : 'empty'
  };
}

function deriveRestartStatus({ mode, storeHealth, persistedState, lifecycleCommand, clientState, providerNegotiation }) {
  const lastCommand = persistedState.lastCommand;
  const activeCommand = lastCommand && !COMMAND_TERMINAL_STATES.includes(lastCommand.state);
  const requestedCommand = lifecycleCommand || (clientState.operation === 'inspect' ? null : clientState.operation);
  const idempotencyKey = `${surfaceId}:${persistedState.projectRef || clientState.projectRef || 'unscoped'}:${requestedCommand || 'inspect'}:${clientState.requestId}`;
  const sameCommandReplay = Boolean(
    activeCommand
      && requestedCommand
      && activeCommand.command === requestedCommand
      && (activeCommand.requestId === clientState.requestId || activeCommand.idempotencyKey === idempotencyKey)
  );
  const staleProjectState = Boolean(
    persistedState.projectRef
      && clientState.projectRef
      && persistedState.projectRef !== clientState.projectRef
  );
  let state = 'fresh';
  let action = 'continue';
  let reason = 'no-persisted-command';

  if (staleProjectState) {
    state = 'discarded';
    action = 'ignore-persisted-state';
    reason = 'persisted-project-ref-mismatch';
  } else if (sameCommandReplay) {
    state = 'idempotent-replay';
    action = activeCommand.proofId ? 'return-existing-proof' : 'resume-command-proof';
    reason = 'same-command-observed-after-restart';
  } else if (activeCommand) {
    state = mode === 'failed' || !storeHealth.readable ? 'recovery-blocked' : 'recovering';
    action = state === 'recovering' ? 'reconcile-inflight-command' : 'hold-command-until-store-readable';
    reason = `interrupted-${activeCommand.command || 'command'}`;
  } else if (persistedState.dirty) {
    state = mode === 'failed' ? 'recovery-blocked' : 'recovering';
    action = state === 'recovering' ? 'emit-recovery-snapshot' : 'hold-recovery';
    reason = 'dirty-checkpoint-restored';
  } else if (persistedState.sourceShape === 'restored') {
    state = 'restored';
    action = 'continue-from-checkpoint';
    reason = 'stable-checkpoint-restored';
  }

  return {
    contract: 'aios.projectMemoryAdapter.restartStatus.v1',
    state,
    reason,
    action,
    idempotencyKey,
    restoredFromCheckpoint: persistedState.sourceShape === 'restored' && !staleProjectState,
    commandReplay: sameCommandReplay,
    acceptsNewCommand: !activeCommand || sameCommandReplay || COMMAND_TERMINAL_STATES.includes(activeCommand.state),
    requiresAuditProof: state === 'recovering' || state === 'idempotent-replay' || state === 'recovery-blocked',
    route: providerNegotiation.writeRoute || providerNegotiation.readRoute,
    lastCommand: activeCommand || lastCommand,
    continuity: {
      lastProofId: persistedState.lastProofId,
      lastSnapshotId: persistedState.lastSnapshotId,
      lastAppliedEventId: persistedState.lastAppliedEventId,
      lastStableStatus: persistedState.lastStableStatus
    }
  };
}

function normalizePersistedCommandRecord(command, index, fallback = {}) {
  const commandName = firstString(command.command, command.operation, command.name, fallback.command) || 'inspect';
  const requestId = firstString(command.requestId, fallback.requestId);
  const projectRef = firstString(command.projectRef, fallback.projectRef);
  const idempotencyKey = firstString(command.idempotencyKey, command.key, fallback.idempotencyKey)
    || `${surfaceId}:${projectRef || 'unscoped'}:${commandName}:${requestId || `journal-${index + 1}`}`;
  const state = firstString(command.state, command.status) || 'pending';

  return {
    contract: 'aios.projectMemoryAdapter.persistedCommandRecord.v1',
    order: index + 1,
    id: firstString(command.id, command.commandId) || stableProjectMemoryHash({ idempotencyKey, index }),
    command: commandName,
    state,
    terminal: COMMAND_TERMINAL_STATES.includes(state),
    requestId,
    projectRef,
    idempotencyKey,
    route: firstString(command.route, fallback.route),
    startedAt: firstString(command.startedAt, command.requestedAt, fallback.startedAt),
    completedAt: firstString(command.completedAt, command.appliedAt),
    proofId: firstString(command.proofId, fallback.proofId),
    resultEventId: firstString(command.resultEventId, fallback.resultEventId),
    replayReason: firstString(command.replayReason, fallback.replayReason)
  };
}

function buildRestartCommandJournal({ now, persistedState, restartStatus, clientState, lifecycle, memoryOperationPlan, providerNegotiation, tenantBoundary, nextAction }) {
  const restoredRecords = [
    persistedState.lastCommand
      ? normalizePersistedCommandRecord(persistedState.lastCommand, 0, {
          projectRef: persistedState.projectRef,
          proofId: persistedState.lastProofId,
          resultEventId: persistedState.lastAppliedEventId
        })
      : null,
    ...persistedState.pendingReplay.map((item, index) => normalizePersistedCommandRecord(item, index + 1, {
      projectRef: persistedState.projectRef,
      route: providerNegotiation.writeRoute || providerNegotiation.readRoute,
      replayReason: 'pending-replay'
    }))
  ].filter(Boolean);
  const requestedCommand = lifecycle.requestedCommand || (clientState.operation === 'inspect' ? null : clientState.operation);
  const requestedRecord = requestedCommand
    ? normalizePersistedCommandRecord({
        id: `${clientState.requestId}:${requestedCommand}`,
        command: requestedCommand,
        requestId: clientState.requestId,
        projectRef: clientState.projectRef,
        state: lifecycle.commandAllowed || memoryOperationPlan.state === 'ready' ? 'admitted' : 'rejected',
        route: lifecycle.commandEnvelope?.route || memoryOperationPlan.route || providerNegotiation.readRoute,
        proofId: lifecycle.settingsTransition?.proof?.id
      }, restoredRecords.length, {
        idempotencyKey: restartStatus.idempotencyKey,
        startedAt: clientState.requestedAt
      })
    : null;
  const latestByKey = new Map();

  for (const record of restoredRecords.concat(requestedRecord ? [requestedRecord] : [])) {
    latestByKey.set(record.idempotencyKey, record);
  }

  const journal = [...latestByKey.values()];
  const activeRecords = journal.filter((record) => !record.terminal && record.state !== 'rejected');
  const replayedRecord = requestedRecord
    ? restoredRecords.find((record) => record.idempotencyKey === requestedRecord.idempotencyKey || record.requestId === requestedRecord.requestId)
    : null;
  const route = providerNegotiation.writeRoute || providerNegotiation.readRoute;
  const dispatchDecisions = journal.map((record) => {
    const currentRequest = requestedRecord && record.idempotencyKey === requestedRecord.idempotencyKey;
    const blockedByRestart = restartStatus.state === 'recovery-blocked' && !record.terminal;
    const duplicateReplay = currentRequest && replayedRecord && replayedRecord.id !== record.id;
    const shouldDispatch = currentRequest
      && !duplicateReplay
      && !blockedByRestart
      && record.state !== 'rejected'
      && restartStatus.acceptsNewCommand;

    return {
      contract: 'aios.projectMemoryAdapter.commandDispatchDecision.v1',
      commandId: record.id,
      command: record.command,
      requestId: record.requestId,
      idempotencyKey: record.idempotencyKey,
      state: shouldDispatch
        ? 'dispatch'
        : duplicateReplay
          ? 'suppress-duplicate'
          : blockedByRestart
            ? 'hold-for-recovery'
            : record.terminal
              ? 'terminal'
              : record.state === 'rejected'
                ? 'reject'
                : 'observe',
      route: record.route || route,
      proofId: duplicateReplay ? replayedRecord.proofId || record.proofId : record.proofId,
      requiresPersistence: shouldDispatch || duplicateReplay || blockedByRestart,
      reason: shouldDispatch
        ? 'new-command-admitted'
        : duplicateReplay
          ? 'idempotency-key-already-recorded'
          : blockedByRestart
            ? restartStatus.reason
            : record.state
    };
  });
  const journalState = restartStatus.state === 'recovery-blocked'
    ? 'recovery-blocked'
    : dispatchDecisions.some((decision) => decision.state === 'dispatch')
      ? 'dispatch-ready'
      : dispatchDecisions.some((decision) => decision.state === 'hold-for-recovery')
        ? 'recovery-held'
        : dispatchDecisions.some((decision) => decision.state === 'suppress-duplicate')
          ? 'idempotent-replay'
          : activeRecords.length > 0
            ? 'reconcile'
            : 'stable';

  return {
    contract: 'aios.projectMemoryAdapter.commandJournal.v1',
    generatedAt: now,
    state: journalState,
    checkpointKey: `${surfaceId}:${tenantBoundary.isolationKey || clientState.projectRef || 'unscoped'}:command-journal`,
    restoredCount: restoredRecords.length,
    activeCount: activeRecords.length,
    requestedCommand,
    replayedCommandId: replayedRecord?.id || null,
    dispatchDecisions,
    records: journal.slice(-12),
    nextCheckpointRecord: requestedRecord
      ? {
          ...requestedRecord,
          state: dispatchDecisions.find((decision) => decision.commandId === requestedRecord.id)?.state === 'dispatch'
            ? 'in-flight'
            : requestedRecord.state,
          recordedAt: now,
          auditSubject: tenantBoundary.auditSubject
        }
      : null,
    proof: {
      required: restartStatus.requiresAuditProof || dispatchDecisions.some((decision) => decision.requiresPersistence),
      proofId: stableProjectMemoryHash({
        surfaceId,
        requestId: clientState.requestId,
        restartState: restartStatus.state,
        journalState,
        decisions: dispatchDecisions.map((decision) => `${decision.commandId}:${decision.state}`)
      }),
      subject: tenantBoundary.auditSubject,
      route: providerNegotiation.auditRoute || providerNegotiation.readRoute,
      inputs: {
        nextAction: nextAction.command,
        memoryOperationState: memoryOperationPlan.state,
        restartAction: restartStatus.action,
        idempotencyKey: restartStatus.idempotencyKey
      }
    }
  };
}

function buildPersistedStateEnvelope({ now, mode, projectRef, persistedState, restartStatus, lifecycle, nextAction, syncMetadata, commandJournal }) {
  const nextStatus = mode === 'failed'
    ? 'blocked'
    : restartStatus.state === 'recovering'
      ? 'recovering'
      : commandJournal?.state === 'recovery-held'
        ? 'recovering'
      : lifecycle.canWrite
        ? 'ready'
        : lifecycle.canRead
          ? 'read-only'
          : 'held';

  return {
    contract: 'aios.projectMemoryAdapter.persistedEnvelope.v1',
    checkpointId: persistedState.checkpointId,
    projectRef,
    observedAt: now,
    previous: {
      status: persistedState.status,
      persistedAt: persistedState.persistedAt,
      version: persistedState.version
    },
    next: {
      status: nextStatus,
      version: persistedState.version + 1,
      persistRequired: nextStatus !== persistedState.status
        || restartStatus.requiresAuditProof
        || nextAction.auditRequired
        || commandJournal?.proof.required === true,
      writeGuard: lifecycle.canWrite ? 'write-through' : 'read-only-checkpoint',
      command: nextAction.command,
      cursor: syncMetadata.cursor,
      proofId: commandJournal?.proof.required ? commandJournal.proof.proofId : restartStatus.continuity.lastProofId,
      snapshotId: restartStatus.continuity.lastSnapshotId
    },
    recovery: restartStatus,
    commandJournal: {
      state: commandJournal?.state || 'unavailable',
      checkpointKey: commandJournal?.checkpointKey || null,
      activeCount: commandJournal?.activeCount || 0,
      replayedCommandId: commandJournal?.replayedCommandId || null,
      nextCheckpointRecord: commandJournal?.nextCheckpointRecord || null,
      proof: commandJournal?.proof || null,
      dispatchDecisions: commandJournal?.dispatchDecisions || []
    },
    replayQueue: persistedState.pendingReplay.map((item, index) => ({
      order: index + 1,
      id: firstString(item.id, item.commandId) || `replay-${index + 1}`,
      command: firstString(item.command, item.operation) || 'inspect',
      state: firstString(item.state, item.status) || 'pending',
      idempotencyKey: firstString(item.idempotencyKey, item.key)
    }))
  };
}

function deriveWorkflowHandoff({ now, clientState, lifecycle, readiness, providerNegotiation, externalHandoff, tenantBoundary, syncMetadata, nextAction, actionableErrors }) {
  const firstBlockingError = actionableErrors.find((error) => error.severity === 'error') || null;
  const externalProviderId = externalHandoff.providerId || providerNegotiation.selected.externalSyncProviderId;
  const writeRequested = clientState.operation === 'write' || clientState.expectsWriteAck;
  const snapshotRequested = clientState.operation === 'snapshot' || clientState.wantsFreshSnapshot;
  const readAllowed = lifecycle.canRead && readiness.acceptedOperations.read;
  const writeAllowed = lifecycle.canWrite && readiness.acceptedOperations.write;
  const snapshotAllowed = lifecycle.canSnapshot && readiness.acceptedOperations.snapshot;
  let state = 'continue-local';
  let reason = 'project-memory-route-ready';
  let primaryAction = writeRequested ? 'commit-local-write' : 'continue-project-memory-workflow';

  if (firstBlockingError) {
    state = 'blocked';
    reason = firstBlockingError.code;
    primaryAction = 'resolve-blocking-validation';
  } else if (externalHandoff.blocksWrites && writeRequested) {
    state = 'external-handoff-required';
    reason = 'external-handoff-blocks-write';
    primaryAction = 'wait-for-handoff-release';
  } else if (clientState.requestedHandoff && externalProviderId) {
    state = 'handoff-ready';
    reason = 'external-sync-provider-negotiated';
    primaryAction = 'open-external-sync-handoff';
  } else if (writeRequested && !writeAllowed && readAllowed) {
    state = 'read-only-workflow';
    reason = 'write-route-not-available';
    primaryAction = 'continue-read-only';
  } else if (snapshotRequested && !snapshotAllowed) {
    state = 'audit-proof-needed';
    reason = 'snapshot-audit-route-not-available';
    primaryAction = 'validate-audit-route';
  }

  const handoffToken = state === 'handoff-ready' || state === 'external-handoff-required'
    ? `${surfaceId}:${clientState.requestId}:${externalProviderId || 'pending'}`
    : null;

  return {
    contract: 'aios.projectMemoryAdapter.workflowHandoff.v1',
    generatedAt: now,
    state,
    reason,
    requestId: clientState.requestId,
    workflowId: clientState.workflowId,
    operation: clientState.operation,
    providerId: externalProviderId || null,
    leaseId: externalHandoff.leaseId,
    handoffToken,
    route: state === 'handoff-ready'
      ? providerNegotiation.selected.externalSyncProviderId
      : writeAllowed
        ? providerNegotiation.writeRoute
        : providerNegotiation.readRoute,
    cursor: syncMetadata.cursor,
    isolationKey: tenantBoundary.isolationKey,
    primaryAction,
    secondaryAction: nextAction.auditRequired ? 'emit-audit-proof' : null,
    disabledOperations: {
      write: !writeAllowed || externalHandoff.blocksWrites,
      snapshot: !snapshotAllowed,
      flush: !lifecycle.canFlush
    },
    proofRequirements: [
      'tenant-workspace-boundary',
      'principal-permission-check',
      'client-request-state',
      'provider-route-negotiation',
      state === 'handoff-ready' || state === 'external-handoff-required' ? 'external-handoff-lease' : 'local-route-acceptance',
      nextAction.auditRequired ? 'audit-proof-emission' : 'audit-route-presence'
    ],
    userVisible: {
      tone: state === 'blocked' ? 'danger' : state === 'continue-local' || state === 'handoff-ready' ? 'success' : 'warning',
      label: state === 'continue-local'
        ? 'Project memory workflow can continue.'
        : state === 'handoff-ready'
          ? 'External sync handoff is ready.'
          : state === 'external-handoff-required'
            ? 'Writes are waiting on external sync handoff.'
            : state === 'read-only-workflow'
              ? 'Project memory is available read-only.'
              : 'Project memory workflow needs attention.'
    }
  };
}

function buildClientRuntimeBridge({ now, clientState, workflowHandoff, memoryOperationPlan, lifecycle, providerNegotiation, tenantBoundary, externalHandoff, restartStatus, persistedEnvelope, failureRecovery, commandJournal }) {
  const writeLikeOperation = memoryOperationPlan.operation === 'write'
    || memoryOperationPlan.operation === 'flush'
    || memoryOperationPlan.operation === 'sync'
    || clientState.expectsWriteAck;
  const acceptedEntries = memoryOperationPlan.entryAcceptance.rows.filter((row) => row.accepted);
  const blockedEntries = memoryOperationPlan.entryAcceptance.rows.filter((row) => !row.accepted);
  const route = workflowHandoff.route || memoryOperationPlan.route || providerNegotiation.readRoute;
  const ackState = workflowHandoff.state === 'blocked' || memoryOperationPlan.state === 'blocked'
    ? 'blocked'
    : workflowHandoff.state === 'handoff-ready'
      ? 'handoff-ready'
      : workflowHandoff.state === 'read-only-workflow'
        ? 'read-only-accepted'
        : writeLikeOperation
          ? 'write-accepted'
          : 'preview-accepted';
  const dispatches = [];

  if (acceptedEntries.length > 0 && writeLikeOperation && ackState === 'write-accepted') {
    dispatches.push({
      id: `${clientState.requestId}:apply-memory`,
      type: 'project-memory.apply',
      route,
      state: lifecycle.canWrite ? 'ready' : 'held',
      entryCount: acceptedEntries.length,
      byteEstimate: acceptedEntries.reduce((total, row) => total + row.valueBytes, 0),
      idempotencyKey: `${surfaceId}:${tenantBoundary.isolationKey || 'unscoped'}:${clientState.requestId}:apply`
    });
  }

  if (workflowHandoff.state === 'handoff-ready' || workflowHandoff.state === 'external-handoff-required') {
    dispatches.push({
      id: `${clientState.requestId}:external-handoff`,
      type: 'project-memory.external-handoff',
      route: providerNegotiation.selected.externalSyncProviderId,
      state: workflowHandoff.state === 'handoff-ready' ? 'ready' : 'waiting',
      providerId: workflowHandoff.providerId,
      leaseId: externalHandoff.leaseId,
      handoffToken: workflowHandoff.handoffToken,
      cursor: workflowHandoff.cursor
    });
  }

  if (workflowHandoff.secondaryAction === 'emit-audit-proof' || blockedEntries.length > 0 || restartStatus.requiresAuditProof) {
    dispatches.push({
      id: `${clientState.requestId}:audit-proof`,
      type: 'project-memory.audit-proof',
      route: providerNegotiation.auditRoute,
      state: providerNegotiation.auditRoute ? 'ready' : 'blocked',
      proofInputs: {
        requestId: clientState.requestId,
        isolationKey: tenantBoundary.isolationKey,
        handoffState: workflowHandoff.state,
        memoryOperationState: memoryOperationPlan.state,
        restartState: restartStatus.state,
        recoveryGate: failureRecovery.recoveryGate,
        permissionGrantState: tenantBoundary.permissionGrants.state,
        matchedGrantIds: tenantBoundary.permissionGrants.evaluation.matchedGrantIds,
        deniedGrantIds: tenantBoundary.permissionGrants.evaluation.denyGrantIds
      }
    });
  }

  if (failureRecovery.writeAdmission !== 'open' && writeLikeOperation) {
    dispatches.push({
      id: `${clientState.requestId}:recovery-probe`,
      type: 'project-memory.recovery-probe',
      route: failureRecovery.route || providerNegotiation.readRoute,
      state: failureRecovery.nextRecoveryProbe ? 'scheduled' : 'operator-required',
      dueAt: failureRecovery.nextRecoveryProbe?.at || null,
      retryBudgetRemaining: failureRecovery.retryBudget.remainingAttempts
    });
  }

  for (const lifecycleDispatch of lifecycle.commandDispatches || []) {
    dispatches.push({
      id: `${clientState.requestId}:${lifecycleDispatch.type}:${lifecycleDispatch.command}`,
      type: lifecycleDispatch.type,
      route: lifecycleDispatch.route,
      state: lifecycleDispatch.state,
      command: lifecycleDispatch.command,
      proofId: lifecycleDispatch.proofId || lifecycleDispatch.id,
      blockedReasons: lifecycleDispatch.blockedReasons || [],
      appliedChanges: lifecycleDispatch.appliedChanges || [],
      idempotencyKey: `${surfaceId}:${tenantBoundary.isolationKey || 'unscoped'}:${clientState.requestId}:${lifecycleDispatch.command}`
    });
  }

  for (const decision of commandJournal.dispatchDecisions.filter((item) => item.state === 'hold-for-recovery' || item.state === 'suppress-duplicate')) {
    dispatches.push({
      id: `${clientState.requestId}:restart-${decision.commandId}`,
      type: 'project-memory.restart-command',
      route: decision.route,
      state: decision.state,
      command: decision.command,
      proofId: decision.proofId || commandJournal.proof.proofId,
      idempotencyKey: decision.idempotencyKey,
      reason: decision.reason
    });
  }

  return {
    contract: 'aios.projectMemoryAdapter.clientRuntimeBridge.v1',
    generatedAt: now,
    requestId: clientState.requestId,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    projectRef: clientState.projectRef,
    ack: {
      state: ackState,
      acceptedEntryCount: acceptedEntries.length,
      blockedEntryCount: blockedEntries.length,
      route,
      writeAckExpected: clientState.expectsWriteAck,
      handoffToken: workflowHandoff.handoffToken,
      idempotencyKey: restartStatus.idempotencyKey,
      checkpointId: persistedEnvelope.checkpointId
    },
    commandJournal: {
      state: commandJournal.state,
      checkpointKey: commandJournal.checkpointKey,
      requestedCommand: commandJournal.requestedCommand,
      replayedCommandId: commandJournal.replayedCommandId,
      proofId: commandJournal.proof.proofId,
      dispatchDecisions: commandJournal.dispatchDecisions.map((decision) => ({
        commandId: decision.commandId,
        command: decision.command,
        state: decision.state,
        route: decision.route,
        reason: decision.reason
      }))
    },
    cursor: {
      previousProofId: clientState.lastSeenProofId,
      previousSnapshotId: clientState.lastAcceptedSnapshotId,
      nextProofId: persistedEnvelope.next.proofId,
      nextSnapshotId: persistedEnvelope.next.snapshotId,
      syncCursor: workflowHandoff.cursor,
      persistRequired: persistedEnvelope.next.persistRequired
    },
    clientStatePatch: {
      requestId: clientState.requestId,
      projectRef: clientState.projectRef,
      lastRoute: route,
      lastWorkflowHandoffState: workflowHandoff.state,
      pendingMutationCount: ackState === 'write-accepted' ? 0 : clientState.pendingMutationCount,
      writeDisabled: workflowHandoff.disabledOperations.write,
      snapshotDisabled: workflowHandoff.disabledOperations.snapshot,
      recoveryGate: failureRecovery.recoveryGate
    },
    dispatches,
    blockedEntries: blockedEntries.slice(0, 5).map((row) => ({
      key: row.key,
      state: row.state,
      blockedReasons: row.blockedReasons,
      finding: row.finding || null
    })),
    userVisible: {
      tone: workflowHandoff.userVisible.tone,
      label: workflowHandoff.userVisible.label,
      primaryAction: workflowHandoff.primaryAction,
      secondaryAction: workflowHandoff.secondaryAction,
      disabledOperations: workflowHandoff.disabledOperations
    }
  };
}

function buildClientPreviewAcceptance({ now, input, projectRef, mode, lifecycle, scheduling, syncMetadata, providerNegotiation, externalHandoff, tenantBoundary, findings, actionableErrors, analyticsCounters, exportSummary, reportingState, nextAction, history, clientState, workflowHandoff, clientRuntime, restartStatus, persistedEnvelope, failureRecovery, memoryOperationPlan, commandJournal, projectStatus }) {
  const validationSummary = summarizeValidationFindings(findings);
  const readiness = buildReadinessGates({
    input,
    projectRef,
    mode,
    lifecycle,
    providerNegotiation,
    externalHandoff,
    tenantBoundary,
    findings
  });
  const lastEvent = history[history.length - 1] || null;
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'error');
  const warnings = actionableErrors.filter((error) => error.severity === 'warning');
  const canAccept = readiness.state !== 'blocked' && lifecycle.canRead && validationSummary.valid;

  return {
    preview: {
      contract: 'aios.projectMemoryAdapter.clientPreview.v1',
      generatedAt: now,
      projectRef,
      status: readiness.state,
      statusTone: mode === 'ready' ? 'success' : mode === 'failed' ? 'danger' : 'warning',
      headline: validationSummary.headline,
      primaryRoute: lifecycle.canWrite ? providerNegotiation.writeRoute : providerNegotiation.readRoute,
      auditRoute: providerNegotiation.auditRoute,
      lastActivityAt: lastEvent?.timestamp || syncMetadata.lastSyncedAt || null,
      visibleMetrics: {
        retainedEvents: analyticsCounters.totalEvents,
        pendingLocalChanges: syncMetadata.pendingLocalChanges,
        proofsAccepted: analyticsCounters.auditProofs,
        latestProofId: exportSummary.latestProofId,
        exportableEvents: reportingState.watermarks.exportableEventCount,
        exportBlockedReasons: reportingState.blockedReasons.length,
        projectStatusTimelineEvents: projectStatus?.analytics?.counters?.timelineEventCount || 0,
        projectStatusSnapshots: projectStatus?.analytics?.counters?.statusSnapshotCount || 0,
        projectStatusBlockedTransitions: projectStatus?.analytics?.counters?.blockedTransitionCount || 0,
        duplicateMemoryKeys: memoryOperationPlan.duplicateReport.duplicateKeyCount,
        conflictingMemoryKeys: memoryOperationPlan.duplicateReport.conflictKeyCount
      },
      visibleActions: {
        canRead: lifecycle.canRead,
        canWrite: lifecycle.canWrite,
        canSnapshot: lifecycle.canSnapshot,
        lifecycleCommandState: lifecycle.commandAdmission.state,
        lifecycleBlockedReasons: lifecycle.commandAdmission.blockedReasons,
        lifecycleTransitionState: lifecycle.settingsTransition.state,
        lifecycleAppliedChanges: lifecycle.settingsTransition.appliedChanges,
        lifecycleDispatchCount: lifecycle.commandDispatches.length,
        schedulingPaused: scheduling.paused,
        schedulingQuietUntil: scheduling.quietUntil,
        scheduledDispatchableCommands: scheduling.dispatchableCommands,
        scheduledHeldCommandCount: scheduling.heldCommands.length,
        nextCommand: nextAction.command,
        nextCommandDueAt: nextAction.dueAt,
        workflowAction: workflowHandoff.primaryAction,
        clientAckState: clientRuntime.ack.state,
        clientDispatchCount: clientRuntime.dispatches.length,
        restartAction: restartStatus.action,
        recoveryAction: failureRecovery.recoveryGate
      },
      reporting: {
        state: reportingState.state,
        requested: reportingState.request.requested,
        formats: reportingState.request.formats,
        destinationRef: reportingState.request.destinationRef,
        lastExportableEventId: reportingState.watermarks.lastExportableEventId
      },
      failureState: {
        state: failureRecovery.state,
        writeAdmission: failureRecovery.writeAdmission,
        observedFailures: failureRecovery.observedFailures,
        retryBudgetRemaining: failureRecovery.retryBudget.remainingAttempts,
        nextProbeAt: failureRecovery.nextRecoveryProbe?.at || null,
        degradedReason: failureRecovery.degradedReason
      },
      workflowHandoff: {
        state: workflowHandoff.state,
        reason: workflowHandoff.reason,
        operation: workflowHandoff.operation,
        route: workflowHandoff.route,
        providerId: workflowHandoff.providerId,
        isolationKey: workflowHandoff.isolationKey,
        label: workflowHandoff.userVisible.label
      },
      providerServiceContracts: {
        primary: providerNegotiation.selectedContracts.primary,
        write: providerNegotiation.selectedContracts.writable,
        audit: providerNegotiation.selectedContracts.audit,
        externalHandoff: providerNegotiation.externalHandoffContract,
        bindingState: providerNegotiation.serviceBindings.state,
        readyMethods: providerNegotiation.serviceBindings.readyMethods,
        blockedMethods: providerNegotiation.serviceBindings.blockedMethods.slice(0, 5),
        dispatchOrder: providerNegotiation.serviceBindings.dispatchOrder
      },
      clientRuntime: {
        ackState: clientRuntime.ack.state,
        route: clientRuntime.ack.route,
        acceptedEntryCount: clientRuntime.ack.acceptedEntryCount,
        blockedEntryCount: clientRuntime.ack.blockedEntryCount,
        dispatches: clientRuntime.dispatches.map((dispatch) => ({
          id: dispatch.id,
          type: dispatch.type,
          state: dispatch.state,
          route: dispatch.route
        })),
        nextClientState: clientRuntime.clientStatePatch
      },
      memoryOperation: {
        state: memoryOperationPlan.state,
        operation: memoryOperationPlan.operation,
        route: memoryOperationPlan.route,
        requestedEntryCount: memoryOperationPlan.requestedEntryCount,
        rawValidEntryCount: memoryOperationPlan.rawValidEntryCount,
        entryCount: memoryOperationPlan.entries.length,
        coalescedDuplicateEntryCount: memoryOperationPlan.coalescedDuplicateEntryCount,
        duplicateKeyCount: memoryOperationPlan.duplicateReport.duplicateKeyCount,
        conflictKeyCount: memoryOperationPlan.duplicateReport.conflictKeyCount,
        batchCount: memoryOperationPlan.batches.length,
        blockedReasons: memoryOperationPlan.blockedReasons,
        acceptanceState: memoryOperationPlan.entryAcceptance.summary.state,
        acceptedEntryCount: memoryOperationPlan.entryAcceptance.summary.acceptedEntries,
        blockedEntryCount: memoryOperationPlan.entryAcceptance.summary.blockedEntries,
        rejectedEntryCount: memoryOperationPlan.entryAcceptance.summary.rejectedEntries,
        byteEstimate: memoryOperationPlan.entryAcceptance.summary.byteEstimate,
        previewRows: memoryOperationPlan.entryAcceptance.rows.slice(0, 5).map((row) => ({
          key: row.key,
          type: row.type,
          hash: row.hash,
          state: row.state,
          valueShape: row.valueShape,
          valueBytes: row.valueBytes,
          route: row.route,
          blockedReasons: row.blockedReasons
        }))
      },
      persistence: {
        state: restartStatus.state,
        reason: restartStatus.reason,
        idempotentReplay: restartStatus.commandReplay,
        checkpointId: persistedEnvelope.checkpointId,
        persistRequired: persistedEnvelope.next.persistRequired,
        nextStatus: persistedEnvelope.next.status,
        commandJournalState: commandJournal.state,
        commandJournalProofId: commandJournal.proof.proofId,
        replayedCommandId: commandJournal.replayedCommandId,
        commandDecisions: commandJournal.dispatchDecisions.map((decision) => ({
          command: decision.command,
          state: decision.state,
          reason: decision.reason
        }))
      },
      warnings: warnings.slice(0, 3).map((warning) => ({
        code: warning.code,
        message: warning.message,
        action: warning.action
      }))
    },
    acceptance: {
      contract: 'aios.projectMemoryAdapter.acceptance.v1',
      state: canAccept ? 'accepted' : blockingErrors.length > 0 ? 'blocked' : 'needs-attention',
      acceptedAt: canAccept ? now : null,
      acceptToken: canAccept ? `${surfaceId}:${projectRef || 'unscoped'}:${mode}` : null,
      requiredProofs: [
        'hosted-kernel-capability-check',
        'tenant-workspace-boundary',
        'principal-permission-check',
        'provider-service-contract-check',
        'project-scope-validation',
        'provider-route-negotiation',
        'audit-proof-route'
      ],
      blockers: blockingErrors.map((error) => ({
        code: error.code,
        message: error.message,
        action: error.action
      })),
      clientAcks: {
        degradedReadOnly: mode === 'degraded-read-only',
        externalHandoffBlocksWrites: externalHandoff.blocksWrites,
        exportReady: exportSummary.readyForExport && reportingState.state === 'export-ready',
        exportState: reportingState.state,
        exportableEventCount: reportingState.watermarks.exportableEventCount,
        requestId: clientState.requestId,
        workflowHandoffState: workflowHandoff.state,
        clientRuntimeAckState: clientRuntime.ack.state,
        clientRuntimeDispatchCount: clientRuntime.dispatches.length,
        restartState: restartStatus.state,
        idempotencyKey: restartStatus.idempotencyKey,
        isolationKey: tenantBoundary.isolationKey,
        recoveryGate: failureRecovery.recoveryGate,
        retryBudgetExhausted: failureRecovery.retryBudget.exhausted,
        memoryOperationState: memoryOperationPlan.state,
        memoryEntryCount: memoryOperationPlan.entries.length,
        memoryEntryAcceptanceState: memoryOperationPlan.entryAcceptance.summary.state,
        memoryEntriesAccepted: memoryOperationPlan.entryAcceptance.summary.acceptedEntries,
        memoryEntriesBlocked: memoryOperationPlan.entryAcceptance.summary.blockedEntries,
        memoryEntriesRejected: memoryOperationPlan.entryAcceptance.summary.rejectedEntries,
        memoryDuplicateKeys: memoryOperationPlan.duplicateReport.duplicateKeyCount,
        memoryConflictKeys: memoryOperationPlan.duplicateReport.conflictKeyCount,
        permissionGrantState: tenantBoundary.permissionGrants.state,
        permissionGrantMatches: tenantBoundary.permissionGrants.evaluation.matchedGrantIds.length,
        permissionGrantDenied: tenantBoundary.deniedPermissions.length > 0
      }
    },
    readiness,
    validationSummary,
    nextSteps: {
      contract: 'aios.projectMemoryAdapter.nextSteps.v1',
      primary: {
        state: nextAction.state,
        command: nextAction.command,
        reason: nextAction.reason,
        auditRequired: nextAction.auditRequired,
        route: nextAction.route,
        dueAt: nextAction.dueAt,
        blockedReasons: nextAction.blockedReasons
      },
      ordered: actionableErrors.length > 0
        ? actionableErrors.slice(0, 5).map((error, index) => ({
            order: index + 1,
            code: error.code,
            label: error.message,
            action: error.action,
            route: error.capability?.startsWith('audit') ? providerNegotiation.auditRoute : providerNegotiation.readRoute
          }))
        : [{
            order: 1,
            code: nextAction.reason,
            label: nextAction.command ? `Ready to ${nextAction.command} project memory.` : 'Project memory adapter is idle.',
            action: nextAction.auditRequired ? 'Emit audit proof before applying the command.' : 'No operator action is required.',
            route: providerNegotiation.writeRoute || providerNegotiation.readRoute
          }],
      scheduling: {
        sync: scheduling.jobs.sync,
        snapshot: scheduling.jobs.snapshot,
        schedulingMode: lifecycle.effectiveSettings.schedulingMode,
        writeMode: lifecycle.effectiveSettings.writeMode,
        nextRoute: syncMetadata.nextSync.route,
        dueCommands: scheduling.dueCommands,
        dispatchableCommands: scheduling.dispatchableCommands,
        heldCommands: scheduling.heldCommands,
        disabledScheduledCommands: scheduling.disabledScheduledCommands,
        maxDueCommandsPerTick: scheduling.maxDueCommandsPerTick,
        quietUntil: scheduling.quietUntil,
        nextScheduledAction: scheduling.nextScheduledAction,
        nextSyncDueAt: scheduling.jobDetails.sync.nextDueAt,
        nextSnapshotDueAt: scheduling.jobDetails.snapshot.nextDueAt,
        nextSyncMethod: syncMetadata.nextSync.methodBinding.method,
        deltaExportState: syncMetadata.deltaExport.state,
        deltaExportCursor: syncMetadata.deltaExport.resumeCursor
      },
      persistence: {
        commandReplay: restartStatus.commandReplay,
        acceptsNewCommand: restartStatus.acceptsNewCommand,
        checkpointWrite: persistedEnvelope.next.persistRequired ? 'required' : 'not-required',
        commandJournalState: commandJournal.state,
        commandJournalCheckpointKey: commandJournal.checkpointKey
      },
      recovery: {
        state: failureRecovery.state,
        gate: failureRecovery.recoveryGate,
        nextProbeAt: failureRecovery.nextRecoveryProbe?.at || null,
        retryQueueDepth: failureRecovery.retryQueue.length
      },
      lifecycle: {
        command: lifecycle.requestedCommand,
        transitionState: lifecycle.settingsTransition.state,
        appliedChanges: lifecycle.settingsTransition.appliedChanges,
        proposedChanges: lifecycle.settingsTransition.proposedChanges,
        proofId: lifecycle.settingsTransition.proof.id,
        dispatches: lifecycle.commandDispatches.map((dispatch) => ({
          id: dispatch.id,
          type: dispatch.type,
          state: dispatch.state,
          route: dispatch.route
        }))
      },
      memoryOperation: {
        state: memoryOperationPlan.state,
        acceptanceState: memoryOperationPlan.entryAcceptance.summary.state,
        acceptedEntries: memoryOperationPlan.entryAcceptance.summary.acceptedEntries,
        rejectedEntries: memoryOperationPlan.entryAcceptance.summary.rejectedEntries,
        blockedEntries: memoryOperationPlan.entryAcceptance.summary.blockedEntries,
        actions: memoryOperationPlan.entryAcceptance.actions,
        firstBlockedEntry: memoryOperationPlan.entryAcceptance.rows.find((row) => !row.accepted) || null
      }
    }
  };
}

export function describeProjectMemoryAdapterSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const capabilities = normalizeCapabilitySet(input.kernelHost?.capabilities);
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const backoffSchedule = buildBackoffSchedule(retryPolicy);
  const storeHealth = normalizeStoreHealth(input.store);
  const providerCatalog = normalizeProviderCatalog(input, capabilities);
  const provisionalProviderNegotiation = buildProviderNegotiation({
    providers: providerCatalog,
    capabilities,
    mode: 'ready',
    storeHealth
  });
  const externalHandoff = normalizeExternalHandoff(input, providerCatalog);
  const lifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || input.settings);
  const lifecycleCommand = typeof input.lifecycleCommand === 'string'
    ? input.lifecycleCommand
    : typeof input.command === 'string'
      ? input.command
      : null;
  const projectRef = firstString(input.projectId, input.projectRoot);
  const history = normalizeOperationHistory(input);
  const tenantBoundary = normalizeTenantWorkspaceBoundary({
    input,
    now,
    projectRef,
    lifecycleCommand
  });
  const memoryEntries = normalizeMemoryEntries(input, { now, projectRef });
  const provisionalFailureRecovery = deriveFailureRecoveryState({
    now,
    history,
    storeHealth,
    retryPolicy,
    backoffSchedule,
    providerNegotiation: provisionalProviderNegotiation,
    externalHandoff
  });
  const findings = buildOperationalFindings(
    input,
    capabilities,
    storeHealth,
    lifecycleSettings,
    lifecycleCommand,
    provisionalProviderNegotiation,
    externalHandoff,
    tenantBoundary,
    provisionalFailureRecovery,
    memoryEntries
  );
  const mode = deriveMode(findings);
  const providerNegotiation = buildProviderNegotiation({
    providers: providerCatalog,
    capabilities,
    mode,
    storeHealth
  });
  const failureRecovery = deriveFailureRecoveryState({
    now,
    history,
    storeHealth,
    retryPolicy,
    backoffSchedule,
    providerNegotiation,
    externalHandoff
  });
  const actionableErrors = buildActionableErrors(findings);
  const acceptedEvidence = Array.isArray(input.evidence)
    ? input.evidence.filter((event) => isObject(event) && event.id && event.source && event.timestamp)
    : [];
  const analyticsCounters = buildAnalyticsCounters(history, acceptedEvidence, findings);
  const historySnapshots = buildHistorySnapshots(history, now);
  const timeline = buildTimeline(history, findings, now);
  const exportRequest = normalizeAnalyticsExportRequest(input, now);
  const exportSummary = buildExportSummary({
    now,
    projectRef,
    mode,
    history,
    counters: analyticsCounters,
    snapshots: historySnapshots
  });
  const reportingState = buildAnalyticsReportingState({
    now,
    projectRef,
    mode,
    history,
    evidence: acceptedEvidence,
    findings,
    snapshots: historySnapshots,
    timeline,
    exportRequest,
    tenantBoundary,
    providerNegotiation
  });
  const lifecycle = buildLifecycleControls({
    now,
    command: lifecycleCommand,
    settings: lifecycleSettings,
    mode,
    storeHealth,
    capabilities,
    findings,
    providerNegotiation,
    externalHandoff,
    tenantBoundary
  });
  const scheduling = buildSchedulingControls({
    now,
    settings: lifecycle.effectiveSettings,
    storeHealth,
    mode,
    history,
    lifecycle,
    providerNegotiation,
    externalHandoff,
    failureRecovery
  });
  const syncMetadata = buildSyncMetadata({
    now,
    projectRef,
    history,
    scheduling,
    providerNegotiation,
    externalHandoff
  });
  const nextAction = deriveNextLifecycleAction({
    mode,
    command: lifecycleCommand,
    controls: lifecycle,
    scheduling,
    actionableErrors
  });
  const clientState = normalizeClientRequestState({
    input,
    now,
    projectRef,
    lifecycleCommand
  });
  const memoryOperationPlan = buildMemoryOperationPlan({
    now,
    clientState,
    entries: memoryEntries,
    lifecycle,
    tenantBoundary,
    providerNegotiation,
    externalHandoff,
    failureRecovery
  });
  const operationalHealth = buildOperationalHealthEnvelope({
    now,
    mode,
    clientState,
    lifecycle,
    providerNegotiation,
    tenantBoundary,
    externalHandoff,
    storeHealth,
    failureRecovery,
    memoryOperationPlan,
    findings,
    actionableErrors
  });
  const workflowHandoff = deriveWorkflowHandoff({
    now,
    clientState,
    lifecycle,
    readiness: buildReadinessGates({
      input,
      projectRef,
      mode,
      lifecycle,
      providerNegotiation,
      externalHandoff,
      tenantBoundary,
      findings
    }),
    providerNegotiation,
    externalHandoff,
    tenantBoundary,
    syncMetadata,
    nextAction,
    actionableErrors
  });
  const persistedState = normalizePersistedState({
    input,
    now,
    projectRef,
    history
  });
  const restartStatus = deriveRestartStatus({
    mode,
    storeHealth,
    persistedState,
    lifecycleCommand,
    clientState,
    providerNegotiation
  });
  const commandJournal = buildRestartCommandJournal({
    now,
    persistedState,
    restartStatus,
    clientState,
    lifecycle,
    memoryOperationPlan,
    providerNegotiation,
    tenantBoundary,
    nextAction
  });
  const persistedEnvelope = buildPersistedStateEnvelope({
    now,
    mode,
    projectRef,
    persistedState,
    restartStatus,
    lifecycle,
    nextAction,
    syncMetadata,
    commandJournal
  });
  const projectStatus = deriveCanonicalProjectStatus({
    now,
    input,
    projectRef,
    mode,
    lifecycle,
    tenantBoundary,
    providerNegotiation,
    externalHandoff,
    failureRecovery,
    memoryOperationPlan,
    persistedEnvelope,
    clientState,
    history,
    evidence: acceptedEvidence
  });
  const finalFindings = findings.concat(projectStatus.findings);
  const finalActionableErrors = actionableErrors.concat(buildActionableErrors(projectStatus.findings));
  const clientRuntime = buildClientRuntimeBridge({
    now,
    clientState,
    workflowHandoff,
    memoryOperationPlan,
    lifecycle,
    providerNegotiation,
    tenantBoundary,
    externalHandoff,
    restartStatus,
    persistedEnvelope,
    failureRecovery,
    commandJournal
  });
  const clientContracts = buildClientPreviewAcceptance({
    now,
    input,
    projectRef,
    mode,
    lifecycle,
    scheduling,
    syncMetadata,
    providerNegotiation,
    externalHandoff,
    tenantBoundary,
    findings,
    actionableErrors,
    analyticsCounters,
    exportSummary,
    reportingState,
    nextAction,
    history,
    clientState,
    workflowHandoff,
    clientRuntime,
    restartStatus,
    persistedEnvelope,
    failureRecovery,
    memoryOperationPlan,
    commandJournal,
    projectStatus
  });

  return {
    ok: mode !== 'failed',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel project memory adapter operational health contract',
    projectRef,
    mode,
    health: {
      status: mode,
      readable: mode !== 'failed' && storeHealth.readable,
      writable: mode === 'ready' && storeHealth.writable,
      degraded: mode === 'degraded-read-only',
      failureCount: storeHealth.consecutiveFailures,
      requiredCapabilities: REQUIRED_HOST_CAPABILITIES,
      availableCapabilities: [...capabilities].sort(),
      isolationKey: tenantBoundary.isolationKey,
      failureState: failureRecovery.state,
      recoveryGate: failureRecovery.recoveryGate,
      retryBudgetRemaining: failureRecovery.retryBudget.remainingAttempts,
      serviceLevel: operationalHealth.serviceLevel,
      primaryIncidentId: operationalHealth.primaryIncidentId
    },
    workspaceScope: tenantBoundary,
    validation: {
      valid: finalFindings.every((finding) => finding.severity !== 'error'),
      findings: finalFindings,
      summary: summarizeValidationFindings(finalFindings)
    },
    preview: clientContracts.preview,
    acceptance: clientContracts.acceptance,
    readiness: clientContracts.readiness,
    operationalHealth,
    client: {
      contract: 'aios.projectMemoryAdapter.clientRuntime.v1',
      state: clientState,
      workflowHandoff,
      runtime: clientRuntime,
      restart: restartStatus,
      commandJournal,
      memoryOperation: {
        state: memoryOperationPlan.state,
        route: memoryOperationPlan.route,
        blockedReasons: memoryOperationPlan.blockedReasons,
        batchCount: memoryOperationPlan.batches.length,
        acceptance: memoryOperationPlan.entryAcceptance.summary
      }
    },
    memoryOperation: memoryOperationPlan,
    projectStatus,
    persistence: persistedEnvelope,
    commandJournal,
    analytics: {
      contract: 'aios.projectMemoryAdapter.analytics.v1',
      counters: analyticsCounters,
      historyWindow: {
        retainedEvents: history.length,
        firstEventAt: history[0]?.timestamp || null,
        lastEventAt: history[history.length - 1]?.timestamp || null
      },
      exportRequest,
      reportingState: {
        state: reportingState.state,
        blockedReasons: reportingState.blockedReasons,
        watermarks: reportingState.watermarks,
        batches: reportingState.batches
      }
    },
    providerContracts: providerNegotiation,
    sync: syncMetadata,
    externalHandoff,
    history: {
      contract: 'aios.projectMemoryAdapter.history.v1',
      snapshots: historySnapshots,
      recentEvents: history.slice(-10)
    },
    reporting: {
      timeline,
      exportSummary,
      exportRequest,
      state: reportingState
    },
    lifecycle,
    settings: {
      contract: 'aios.projectMemoryAdapter.settings.v1',
      requested: lifecycle.settingsTransition.requestedSettings,
      applied: lifecycle.effectiveSettings,
      transition: lifecycle.settingsTransition,
      valid: !findings.some((finding) => finding.code === 'invalid_lifecycle_settings' && finding.severity === 'error'),
      persistRequired: lifecycle.settingsTransition.persistence.required
    },
    scheduling,
    nextAction,
    recovery: failureRecovery,
    nextSteps: clientContracts.nextSteps,
    retry: {
      policy: retryPolicy,
      schedule: backoffSchedule,
      budget: failureRecovery.retryBudget,
      queue: failureRecovery.retryQueue,
      nextAttempt: actionableErrors.length > 0 && storeHealth.lastError?.retryable !== false && !failureRecovery.retryBudget.exhausted
        ? failureRecovery.nextRecoveryProbe || backoffSchedule[0] || null
        : null
    },
    degradedMode: {
      enabled: mode === 'degraded-read-only' || failureRecovery.state !== 'closed',
      reason: failureRecovery.degradedReason,
      readSource: mode === 'degraded-read-only' || failureRecovery.state !== 'closed' ? 'last-known-project-memory-snapshot' : 'primary-project-memory-store',
      writeBehavior: mode === 'ready' && failureRecovery.writeAdmission === 'open' ? 'accept' : 'reject-with-audit-proof',
      recoveryProbe: failureRecovery.nextRecoveryProbe
    },
    errors: finalActionableErrors,
    audit: {
      proofType: 'project-memory-adapter-operational-health',
      generatedAt: now,
      evidenceAccepted: acceptedEvidence.length,
      evidenceRejected: Array.isArray(input.evidence) ? input.evidence.length - acceptedEvidence.length : 0,
      decision: mode,
      providerNegotiation: providerNegotiation.selected,
      providerServiceContracts: providerNegotiation.selectedContracts,
      providerServiceBindings: {
        state: providerNegotiation.serviceBindings.state,
        readyMethods: providerNegotiation.serviceBindings.readyMethods,
        blockedMethods: providerNegotiation.serviceBindings.blockedMethods,
        dispatchOrder: providerNegotiation.serviceBindings.dispatchOrder,
        bindings: Object.fromEntries(
          Object.entries(providerNegotiation.serviceBindings.bindings).map(([name, binding]) => [
            name,
            {
              providerId: binding.providerId,
              route: binding.route,
              method: binding.method,
              state: binding.state,
              ready: binding.ready,
              proofRequired: binding.proofRequired,
              blockedReasons: binding.blockedReasons
            }
          ])
        )
      },
      clientRequest: {
        requestId: clientState.requestId,
        sessionId: clientState.sessionId,
        workflowId: clientState.workflowId,
        operation: clientState.operation,
        requestedHandoff: clientState.requestedHandoff,
        pendingMutationCount: clientState.pendingMutationCount
      },
      workspaceBoundary: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        projectRef: tenantBoundary.projectRef,
        principalId: tenantBoundary.principal.id,
        operation: tenantBoundary.operation,
        allowed: tenantBoundary.allowed,
        isolationKey: tenantBoundary.isolationKey,
        auditSubject: tenantBoundary.auditSubject,
        missingPermissions: tenantBoundary.missingPermissions,
        deniedPermissions: tenantBoundary.deniedPermissions,
        permissionGrantState: tenantBoundary.permissionGrants.state,
        matchedGrantIds: tenantBoundary.permissionGrants.evaluation.matchedGrantIds,
        deniedGrantIds: tenantBoundary.permissionGrants.evaluation.denyGrantIds
      },
      workflowHandoff: {
        state: workflowHandoff.state,
        reason: workflowHandoff.reason,
        providerId: workflowHandoff.providerId,
        leaseId: workflowHandoff.leaseId,
        handoffToken: workflowHandoff.handoffToken
      },
      clientRuntime: {
        ackState: clientRuntime.ack.state,
        route: clientRuntime.ack.route,
        acceptedEntryCount: clientRuntime.ack.acceptedEntryCount,
        blockedEntryCount: clientRuntime.ack.blockedEntryCount,
        dispatchTypes: clientRuntime.dispatches.map((dispatch) => dispatch.type),
        statePatch: clientRuntime.clientStatePatch
      },
      memoryOperation: {
        state: memoryOperationPlan.state,
        operation: memoryOperationPlan.operation,
        route: memoryOperationPlan.route,
        requestedEntryCount: memoryOperationPlan.requestedEntryCount,
        rawValidEntryCount: memoryOperationPlan.rawValidEntryCount,
        entryCount: memoryOperationPlan.entries.length,
        coalescedDuplicateEntryCount: memoryOperationPlan.coalescedDuplicateEntryCount,
        duplicateReport: {
          duplicateKeyCount: memoryOperationPlan.duplicateReport.duplicateKeyCount,
          idempotentDuplicateKeyCount: memoryOperationPlan.duplicateReport.idempotentDuplicateKeyCount,
          conflictKeyCount: memoryOperationPlan.duplicateReport.conflictKeyCount,
          groups: memoryOperationPlan.duplicateReport.groups.slice(0, 10).map((group) => ({
            key: group.key,
            duplicateCount: group.duplicateCount,
            conflicting: group.conflicting,
            canonicalHash: group.canonicalHash,
            hashes: group.hashes,
            resolution: group.resolution
          }))
        },
        batchCount: memoryOperationPlan.batches.length,
        blockedReasons: memoryOperationPlan.blockedReasons,
        entryAcceptance: memoryOperationPlan.entryAcceptance.summary,
        entryActions: memoryOperationPlan.entryAcceptance.actions,
        proofRequirements: memoryOperationPlan.proofRequirements
      },
      projectStatus: {
        state: projectStatus.state,
        currentStatus: projectStatus.current.status,
        currentRevision: projectStatus.current.revision,
        readAllowed: projectStatus.read.allowed,
        readProviderId: projectStatus.read.providerId,
        readMethod: projectStatus.read.method,
        readStrategy: projectStatus.read.strategy,
        writeRequested: projectStatus.write.requested,
        writeAllowed: projectStatus.write.allowed,
        writeRoute: projectStatus.write.route,
        writeProviderId: projectStatus.write.providerId,
        writeMethod: projectStatus.write.method,
        writeStrategy: projectStatus.write.strategy,
        writeGuardState: projectStatus.writeGuard.state,
        statusCommitRequired: projectStatus.write.commitRequired,
        statusIdempotentNoop: projectStatus.write.idempotentNoop,
        nextStatus: projectStatus.write.nextRecord?.status || projectStatus.current.status,
        nextRevision: projectStatus.persistence.checkpointRevision,
        blockedReasons: projectStatus.write.blockedReasons,
        boundaryState: projectStatus.boundary.state,
        boundaryProofId: projectStatus.boundary.proof.proofId,
        boundaryMismatches: projectStatus.boundary.claim.mismatches,
        statusKey: projectStatus.persistence.statusKey,
        persistRequired: projectStatus.persistence.persistRequired,
        providerContractState: projectStatus.providerContract.state,
        negotiatedMethods: projectStatus.providerContract.negotiatedMethods,
        fallbackStrategies: projectStatus.providerContract.fallbackStrategies,
        analyticsState: projectStatus.analytics.state,
        analyticsTimelineEvents: projectStatus.analytics.counters.timelineEventCount,
        analyticsSnapshots: projectStatus.analytics.counters.statusSnapshotCount,
        analyticsBlockedTransitions: projectStatus.analytics.counters.blockedTransitionCount,
        analyticsProofBackedSnapshots: projectStatus.analytics.counters.proofBackedSnapshotCount
      },
      externalHandoff: {
        state: externalHandoff.state,
        providerId: externalHandoff.providerId,
        leaseId: externalHandoff.leaseId,
        route: externalHandoff.route,
        serviceContract: externalHandoff.serviceContract,
        accepted: externalHandoff.accepted
      },
      lifecycleCommand,
      lifecycleCommandAdmission: lifecycle.commandAdmission,
      lifecycleCommandEnvelope: lifecycle.commandEnvelope,
      lifecycleSettingsTransition: lifecycle.settingsTransition,
      lifecycleCommandDispatches: lifecycle.commandDispatches,
      lifecycleScheduling: {
        enabled: scheduling.enabled,
        paused: scheduling.paused,
        quietUntil: scheduling.quietUntil,
        jobs: scheduling.jobs,
        dueCommands: scheduling.dueCommands,
        dispatchableCommands: scheduling.dispatchableCommands,
        heldCommands: scheduling.heldCommands,
        disabledScheduledCommands: scheduling.disabledScheduledCommands,
        maxDueCommandsPerTick: scheduling.maxDueCommandsPerTick,
        nextScheduledAction: scheduling.nextScheduledAction,
        nextSyncDueAt: scheduling.jobDetails.sync.nextDueAt,
        nextSnapshotDueAt: scheduling.jobDetails.snapshot.nextDueAt
      },
      nextAction,
      restartStatus: {
        state: restartStatus.state,
        reason: restartStatus.reason,
        action: restartStatus.action,
        idempotencyKey: restartStatus.idempotencyKey,
        commandReplay: restartStatus.commandReplay
      },
      persistedCheckpoint: {
        checkpointId: persistedEnvelope.checkpointId,
        previousStatus: persistedEnvelope.previous.status,
        nextStatus: persistedEnvelope.next.status,
        persistRequired: persistedEnvelope.next.persistRequired,
        commandJournalState: commandJournal.state,
        commandJournalProofId: commandJournal.proof.proofId,
        commandDecisions: commandJournal.dispatchDecisions.map((decision) => ({
          commandId: decision.commandId,
          command: decision.command,
          state: decision.state,
          reason: decision.reason
        }))
      },
      recovery: {
        state: failureRecovery.state,
        gate: failureRecovery.recoveryGate,
        observedFailures: failureRecovery.observedFailures,
        retryBudget: failureRecovery.retryBudget,
        nextProbe: failureRecovery.nextRecoveryProbe,
        writeAdmission: failureRecovery.writeAdmission
      },
      reporting: {
        state: reportingState.state,
        requested: reportingState.request.requested,
        destinationRef: reportingState.request.destinationRef,
        formats: reportingState.request.formats,
        watermarks: reportingState.watermarks,
        proofManifest: reportingState.proofManifest
      },
      operationalHealth: {
        state: operationalHealth.state,
        serviceLevel: operationalHealth.serviceLevel,
        primaryIncidentId: operationalHealth.primaryIncidentId,
        auditProofId: operationalHealth.auditProof.proofId,
        operatorActionCount: operationalHealth.operatorActions.length
      },
      store: storeHealth
    },
    evidence: acceptedEvidence
  };
}

export default describeProjectMemoryAdapterSurface;
