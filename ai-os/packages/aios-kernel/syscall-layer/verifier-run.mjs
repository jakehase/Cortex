export const surfaceId = "aios_syscall-layer_verifier-run_028";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "verifier-run";

const DEFAULT_ATTEMPT_LIMIT = 3;
const DEFAULT_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 10_000;
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_SCHEDULE_INTERVAL_MS = 300_000;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const MAX_SCHEDULE_INTERVAL_MS = 86_400_000;
const DEFAULT_REPORTING_LOOKBACK_MS = 86_400_000;
const DEFAULT_SUCCESS_RATIO_TARGET = 0.95;
const DEFAULT_MAX_FAILURE_STREAK = 2;
const DEFAULT_REQUIRED_CAPABILITIES = ['proof.emit', 'evidence.ingest', 'audit.export'];
const PROVIDER_TYPES = new Set(['hosted-kernel', 'proof-store', 'audit-sink', 'handoff-bridge']);
const SYNC_DIRECTIONS = new Set(['pull', 'push', 'bidirectional']);
const HEALTH_STATES = new Set(['healthy', 'degraded', 'failed']);
const OPERATIONAL_HEALTH_STATUSES = new Set(['ok', 'degraded', 'failed', 'unknown']);
const OPERATIONAL_HEALTH_COMPONENTS = new Set(['hosted-kernel', 'proof-store', 'audit-sink', 'handoff-bridge', 'scheduler', 'evidence-store']);
const LIFECYCLE_COMMANDS = new Set(['run', 'enable', 'disable', 'pause', 'resume', 'schedule']);
const SCHEDULE_MODES = new Set(['manual', 'interval', 'cron']);
const PERSISTED_RUN_STATES = new Set(['idle', 'queued', 'running', 'succeeded', 'failed', 'recovering', 'disabled', 'paused']);
const ACTIVE_RUN_STATES = new Set(['queued', 'running', 'recovering']);
const SIMPLE_CRON_FIELD = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})(,(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2}))*$/;
const CHECKPOINT_STATES = new Set(['absent', 'ready', 'stale', 'corrupt']);
const CLIENT_CHANNELS = new Set(['api', 'cli', 'web', 'worker', 'scheduler', 'system']);
const WORKFLOW_HANDOFF_INTENTS = new Set(['observe', 'continue', 'escalate', 'acknowledge', 'resume']);
const REPORT_EXPORT_MODES = new Set(['summary', 'full', 'evidence-ledger']);
const EVIDENCE_SEVERITIES = new Set(['info', 'warning', 'error']);
const EVIDENCE_RETENTION_CLASSES = new Set(['ephemeral', 'run', 'audit', 'legal-hold']);
const DEFAULT_RECOVERY_WINDOW_MS = 900_000;
const DEFAULT_HEALTH_STALE_AFTER_MS = 600_000;
const MAX_HEALTH_STALE_AFTER_MS = 86_400_000;
const RETRYABLE_FAILURE_CODES = new Set([
  'timeout',
  'transient_io',
  'kernel_unavailable',
  'proof_store_unavailable',
  'rate_limited'
]);
const TERMINAL_FAILURE_CODES = new Set([
  'contract_violation',
  'invalid_proof',
  'policy_denied',
  'integrity_mismatch'
]);
const ISOLATION_MODES = new Set(['unscoped', 'tenant', 'workspace', 'strict']);
const ROLE_PERMISSION_GRANTS = {
  owner: ['verifier.run', 'evidence.ingest', 'proof.emit', 'audit.export', 'lifecycle.manage', 'schedule.manage', 'handoff.export'],
  admin: ['verifier.run', 'evidence.ingest', 'proof.emit', 'audit.export', 'lifecycle.manage', 'schedule.manage', 'handoff.export'],
  operator: ['verifier.run', 'evidence.ingest', 'proof.emit', 'lifecycle.manage', 'schedule.manage'],
  verifier: ['verifier.run', 'evidence.ingest', 'proof.emit'],
  auditor: ['proof.read', 'audit.export'],
  service: ['verifier.run', 'evidence.ingest', 'proof.emit', 'audit.export', 'lifecycle.manage', 'schedule.manage', 'handoff.export'],
  readonly: ['proof.read']
};

function asIsoTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function asNonNegativeInteger(value, fallback) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  return fallback;
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((item) => normalizeString(item, null))
    .filter(Boolean))];
}

function isPlausibleCronExpression(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  const fields = value.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => SIMPLE_CRON_FIELD.test(field));
}

function lifecycleStateFromSettings(settings) {
  if (!settings.enabled) {
    return 'disabled';
  }

  if (settings.paused) {
    return 'paused';
  }

  return settings.schedule.mode === 'manual' ? 'active' : 'scheduled';
}

function lifecycleStateFromPersistedState(persistedState) {
  if (!persistedState.present) {
    return 'unknown';
  }

  if (!persistedState.lifecycle.enabled || persistedState.runState === 'disabled') {
    return 'disabled';
  }

  if (persistedState.lifecycle.paused || persistedState.runState === 'paused') {
    return 'paused';
  }

  return persistedState.runState === 'queued' ? 'scheduled' : 'active';
}

function normalizeRequiredCapabilities(input, providerContracts) {
  const requested = normalizeStringList(input.requiredCapabilities ?? input.capabilityRequirements);
  if (requested.length > 0) {
    return requested;
  }

  return providerContracts.length > 0 ? DEFAULT_REQUIRED_CAPABILITIES : [];
}

function permissionsForRole(role) {
  return ROLE_PERMISSION_GRANTS[role] ?? [];
}

function requiredPermissionsForCommand(command) {
  if (command === 'schedule') {
    return ['schedule.manage', 'verifier.run'];
  }

  if (command === 'enable' || command === 'disable' || command === 'pause' || command === 'resume') {
    return ['lifecycle.manage'];
  }

  return ['verifier.run', 'evidence.ingest', 'proof.emit'];
}

function normalizeWorkspaceBoundary(input, lifecycle, providerContracts) {
  const workspace = normalizeObject(input.workspace ?? input.workspaceScope);
  const tenant = normalizeObject(input.tenant);
  const actor = normalizeObject(input.actor ?? input.principal ?? input.auth);
  const policy = normalizeObject(input.accessPolicy ?? input.permissionPolicy ?? input.boundaryPolicy);
  const requestedIsolationMode = normalizeString(
    input.isolationMode ?? workspace.isolationMode ?? tenant.isolationMode ?? policy.isolationMode,
    null
  );
  const tenantId = normalizeString(input.tenantId ?? tenant.id ?? tenant.tenantId ?? workspace.tenantId, null);
  const workspaceId = normalizeString(input.workspaceId ?? workspace.id ?? workspace.workspaceId, null);
  const role = normalizeString(actor.role ?? input.role, tenantId || workspaceId ? 'verifier' : 'service');
  const grantedPermissions = normalizeStringList(
    actor.permissions ?? input.permissions ?? policy.permissions
  );
  const rolePermissions = permissionsForRole(role);
  const effectivePermissions = [...new Set([...rolePermissions, ...grantedPermissions])].sort();
  const requiredPermissions = normalizeStringList(
    policy.requiredPermissions ?? input.requiredPermissions
  );
  const commandPermissions = requiredPermissionsForCommand(lifecycle.command);
  const requiredForRun = requiredPermissions.length > 0 ? requiredPermissions : commandPermissions;
  const missingPermissions = requiredForRun.filter((permission) => !effectivePermissions.includes(permission));
  const mode = ISOLATION_MODES.has(requestedIsolationMode)
    ? requestedIsolationMode
    : tenantId && workspaceId
      ? 'strict'
      : tenantId
        ? 'tenant'
        : workspaceId
          ? 'workspace'
          : 'unscoped';
  const providerScopeMismatches = providerContracts
    .map((provider) => {
      const providerTenantId = normalizeString(provider.tenantId, tenantId);
      const providerWorkspaceId = normalizeString(provider.workspaceId, workspaceId);
      const mismatches = [];

      if (tenantId && providerTenantId !== tenantId) {
        mismatches.push('tenant');
      }

      if (workspaceId && providerWorkspaceId !== workspaceId) {
        mismatches.push('workspace');
      }

      return {
        providerId: provider.id,
        tenantId: providerTenantId,
        workspaceId: providerWorkspaceId,
        mismatches
      };
    })
    .filter((entry) => entry.mismatches.length > 0);
  const scoped = Boolean(tenantId || workspaceId);
  const strictScoped = mode === 'strict';
  const partitionParts = [
    surfaceGroup,
    surfaceName,
    tenantId ? `tenant:${tenantId}` : 'tenant:unscoped',
    workspaceId ? `workspace:${workspaceId}` : 'workspace:unscoped'
  ];

  return {
    schema: 'aios.syscall-layer.verifier-run.access-boundary.v1',
    mode,
    requestedMode: requestedIsolationMode,
    scoped,
    strictScoped,
    tenantId,
    workspaceId,
    actor: {
      id: normalizeString(actor.id ?? actor.actorId ?? input.actorId, 'system'),
      role,
      roleKnown: Object.prototype.hasOwnProperty.call(ROLE_PERMISSION_GRANTS, role),
      grantedPermissions,
      rolePermissions,
      effectivePermissions
    },
    requiredPermissions: requiredForRun,
    missingPermissions,
    authorized: Object.prototype.hasOwnProperty.call(ROLE_PERMISSION_GRANTS, role) && missingPermissions.length === 0 && providerScopeMismatches.length === 0,
    providerScopeMismatches,
    partitions: {
      isolationKey: partitionParts.join('/'),
      storageKey: partitionParts.join('/'),
      proofNamespace: [tenantId ?? 'global', workspaceId ?? 'global', surfaceName].join(':'),
      auditSubject: {
        tenantId,
        workspaceId,
        actorId: normalizeString(actor.id ?? actor.actorId ?? input.actorId, 'system')
      }
    },
    handoffPolicy: {
      canExportAudit: Object.prototype.hasOwnProperty.call(ROLE_PERMISSION_GRANTS, role) && missingPermissions.length === 0 && effectivePermissions.includes('audit.export'),
      canEmitProof: Object.prototype.hasOwnProperty.call(ROLE_PERMISSION_GRANTS, role) && missingPermissions.length === 0 && effectivePermissions.includes('proof.emit'),
      canIngestEvidence: Object.prototype.hasOwnProperty.call(ROLE_PERMISSION_GRANTS, role) && missingPermissions.length === 0 && effectivePermissions.includes('evidence.ingest'),
      crossTenantExportAllowed: policy.crossTenantExportAllowed === true,
      requireScopedProviders: scoped || strictScoped
    }
  };
}

function normalizeProviderContracts(input, now) {
  const rawProviders = Array.isArray(input.providers)
    ? input.providers
    : input.provider
      ? [input.provider]
      : [];

  return rawProviders
    .filter((provider) => provider && typeof provider === 'object')
    .map((provider, index) => {
      const sync = normalizeObject(provider.sync);
      const handoff = normalizeObject(provider.handoff ?? provider.externalHandoff);
      const health = normalizeObject(provider.health ?? provider.operationalHealth);
      const requestedType = normalizeString(provider.type ?? provider.kind, 'hosted-kernel');
      const requestedDirection = normalizeString(sync.direction, 'bidirectional');
      const requestedHealthStatus = normalizeString(health.status ?? provider.healthStatus, 'unknown');

      return {
        id: normalizeString(provider.id ?? provider.name, `provider-${index + 1}`),
        type: PROVIDER_TYPES.has(requestedType) ? requestedType : 'hosted-kernel',
        requestedType,
        service: normalizeString(provider.service, surfaceName),
        tenantId: normalizeString(provider.tenantId ?? provider.tenant, null),
        workspaceId: normalizeString(provider.workspaceId ?? provider.workspace, null),
        contractVersion: normalizeString(provider.contractVersion ?? provider.version, 'v1'),
        endpoint: normalizeString(provider.endpoint ?? provider.url, null),
        capabilities: normalizeStringList(provider.capabilities),
        optionalCapabilities: normalizeStringList(provider.optionalCapabilities),
        sync: {
          direction: SYNC_DIRECTIONS.has(requestedDirection) ? requestedDirection : 'bidirectional',
          requestedDirection,
          cursor: normalizeString(sync.cursor ?? provider.syncCursor, null),
          watermark: asIsoTimestamp(sync.watermark ?? provider.watermark, now),
          revision: asNonNegativeInteger(sync.revision ?? provider.revision, 0),
          acknowledgedProofId: normalizeString(sync.acknowledgedProofId, null)
        },
        handoff: {
          enabled: normalizeBoolean(handoff.enabled ?? provider.handoffEnabled, false),
          target: normalizeString(handoff.target ?? provider.handoffTarget, null),
          state: normalizeString(handoff.state, 'local-only'),
          correlationId: normalizeString(handoff.correlationId ?? provider.correlationId, null),
          ackRequired: normalizeBoolean(handoff.ackRequired, false)
        },
        health: {
          status: OPERATIONAL_HEALTH_STATUSES.has(requestedHealthStatus) ? requestedHealthStatus : 'unknown',
          requestedStatus: requestedHealthStatus,
          critical: normalizeBoolean(
            health.critical ?? provider.critical,
            requestedType === 'hosted-kernel' || requestedType === 'proof-store'
          ),
          lastSeenAt: asIsoTimestamp(health.lastSeenAt ?? health.checkedAt ?? provider.lastSeenAt, now),
          latencyMs: asNonNegativeInteger(health.latencyMs ?? health.responseMs ?? provider.latencyMs, null),
          consecutiveFailures: asNonNegativeInteger(health.consecutiveFailures ?? provider.consecutiveFailures, 0),
          retryAfterMs: asNonNegativeInteger(health.retryAfterMs ?? provider.retryAfterMs, null),
          message: normalizeString(health.message ?? provider.healthMessage, null)
        }
      };
    });
}

function normalizeOperationalHealth(input, providerContracts, now) {
  const operational = normalizeObject(input.operationalHealth ?? input.healthReport);
  const rawSignals = Array.isArray(operational.signals)
    ? operational.signals
    : Array.isArray(operational.checks)
      ? operational.checks
      : Array.isArray(input.healthChecks)
        ? input.healthChecks
        : Array.isArray(input.healthSignals)
          ? input.healthSignals
          : [];
  const staleAfterMs = Math.min(
    MAX_HEALTH_STALE_AFTER_MS,
    Math.max(1, asNonNegativeInteger(operational.staleAfterMs ?? input.healthStaleAfterMs, DEFAULT_HEALTH_STALE_AFTER_MS))
  );
  const nowMs = Date.parse(now);
  const explicitSignals = rawSignals
    .filter((signal) => signal && typeof signal === 'object')
    .map((signal, index) => {
      const requestedComponent = normalizeString(signal.component ?? signal.name, 'hosted-kernel');
      const requestedStatus = normalizeString(signal.status ?? signal.state, 'unknown');
      const lastSeenAt = asIsoTimestamp(signal.lastSeenAt ?? signal.checkedAt ?? signal.observedAt, now);
      const ageMs = Math.max(0, nowMs - Date.parse(lastSeenAt));

      return {
        id: normalizeString(signal.id, `health-signal-${index + 1}`),
        source: normalizeString(signal.source, 'runtime-health-check'),
        providerId: normalizeString(signal.providerId, null),
        component: OPERATIONAL_HEALTH_COMPONENTS.has(requestedComponent) ? requestedComponent : 'hosted-kernel',
        requestedComponent,
        status: OPERATIONAL_HEALTH_STATUSES.has(requestedStatus) ? requestedStatus : 'unknown',
        requestedStatus,
        critical: normalizeBoolean(signal.critical, requestedComponent === 'hosted-kernel' || requestedComponent === 'proof-store'),
        lastSeenAt,
        ageMs,
        stale: ageMs > staleAfterMs,
        latencyMs: asNonNegativeInteger(signal.latencyMs ?? signal.responseMs, null),
        consecutiveFailures: asNonNegativeInteger(signal.consecutiveFailures, requestedStatus === 'failed' ? 1 : 0),
        retryAfterMs: asNonNegativeInteger(signal.retryAfterMs, null),
        message: normalizeString(signal.message, null)
      };
    });
  const providerSignals = providerContracts.map((provider) => {
    const ageMs = Math.max(0, nowMs - Date.parse(provider.health.lastSeenAt));

    return {
      id: `provider:${provider.id}`,
      source: 'provider-contract',
      providerId: provider.id,
      component: provider.type,
      requestedComponent: provider.requestedType,
      status: provider.health.status,
      requestedStatus: provider.health.requestedStatus,
      critical: provider.health.critical,
      lastSeenAt: provider.health.lastSeenAt,
      ageMs,
      stale: ageMs > staleAfterMs,
      latencyMs: provider.health.latencyMs,
      consecutiveFailures: provider.health.consecutiveFailures,
      retryAfterMs: provider.health.retryAfterMs,
      message: provider.health.message
    };
  });
  const signals = [...explicitSignals, ...providerSignals];
  const failedCriticalSignals = signals.filter((signal) => signal.critical && signal.status === 'failed');
  const staleCriticalSignals = signals.filter((signal) => signal.critical && signal.stale);
  const degradedSignals = signals.filter((signal) => signal.status === 'degraded' || signal.status === 'unknown');
  const providerRetryAfterMs = signals
    .map((signal) => signal.retryAfterMs)
    .filter((retryAfterMs) => Number.isInteger(retryAfterMs) && retryAfterMs > 0);

  return {
    schema: 'aios.syscall-layer.verifier-run.operational-health.v1',
    generatedAt: now,
    staleAfterMs,
    signalCount: signals.length,
    ready: failedCriticalSignals.length === 0 && staleCriticalSignals.length === 0,
    degraded: degradedSignals.length > 0 || staleCriticalSignals.length > 0,
    failedCriticalSignals: failedCriticalSignals.map((signal) => signal.id),
    staleCriticalSignals: staleCriticalSignals.map((signal) => signal.id),
    providerRetryAfterMs: providerRetryAfterMs.length > 0 ? Math.max(...providerRetryAfterMs) : null,
    nextAction: failedCriticalSignals.length > 0
      ? 'repair-critical-provider'
      : staleCriticalSignals.length > 0
        ? 'refresh-provider-health'
        : degradedSignals.length > 0
          ? 'run-degraded-with-audit'
          : 'continue',
    signals
  };
}

function normalizeLifecycleSettings(input, now) {
  const lifecycle = normalizeObject(input.lifecycle);
  const settings = normalizeObject(input.settings);
  const scheduleInput = normalizeObject(input.schedule ?? lifecycle.schedule ?? settings.schedule);
  const rawCommand = normalizeString(input.lifecycleCommand ?? input.command ?? lifecycle.command, 'run');
  const rawEnabled = input.enabled ?? lifecycle.enabled ?? settings.enabled;
  const rawIntervalMs = scheduleInput.intervalMs ?? settings.intervalMs;
  const command = LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : 'run';
  const requestedEnabled = normalizeBoolean(rawEnabled, true);
  const enabled = command === 'enable'
    ? true
    : command === 'disable'
      ? false
      : requestedEnabled;
  const scheduleMode = normalizeString(scheduleInput.mode ?? settings.scheduleMode, 'manual');
  const intervalMs = asNonNegativeInteger(
    rawIntervalMs,
    DEFAULT_SCHEDULE_INTERVAL_MS
  );
  const cronExpression = normalizeString(scheduleInput.cron ?? scheduleInput.cronExpression, null);
  const requestedNextRunAt = scheduleInput.nextRunAt;
  const nextRunAt = scheduleMode === 'interval'
    ? new Date(Date.parse(now) + intervalMs).toISOString()
    : asIsoTimestamp(requestedNextRunAt, null);

  return {
    command,
    requestedCommand: rawCommand,
    enabled,
    requestedEnabled: rawEnabled,
    requestedEnabledProvided: rawEnabled !== undefined,
    paused: command === 'pause' || (lifecycle.paused === true && command !== 'resume'),
    mode: command === 'schedule' ? 'scheduled' : enabled ? 'active' : 'disabled',
    schedule: {
      mode: SCHEDULE_MODES.has(scheduleMode) ? scheduleMode : 'manual',
      requestedMode: scheduleMode,
      intervalMs,
      requestedIntervalMs: rawIntervalMs,
      intervalProvided: rawIntervalMs !== undefined,
      cronExpression,
      cronValid: cronExpression ? isPlausibleCronExpression(cronExpression) : null,
      nextRunAt,
      requestedNextRunAt,
      nextRunAtProvided: requestedNextRunAt !== undefined,
      nextRunAtSource: scheduleMode === 'interval'
        ? 'interval'
        : requestedNextRunAt !== undefined
          ? 'request'
          : 'none'
    }
  };
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const requestedSeverity = normalizeString(entry.severity, 'info');
      const requestedRetentionClass = normalizeString(entry.retentionClass ?? entry.retention, 'audit');
      const digest = normalizeString(entry.digest ?? entry.sha256 ?? entry.contentDigest, null);
      const artifactUri = normalizeString(entry.artifactUri ?? entry.uri ?? entry.url, null);

      return {
        id: normalizeString(entry.id, `evidence-${index + 1}`),
        type: normalizeString(entry.type, 'runtime-observation'),
        source: normalizeString(entry.source, surfaceName),
        providerId: normalizeString(entry.providerId, null),
        observedAt: asIsoTimestamp(entry.observedAt),
        summary: normalizeString(entry.summary, 'Verifier-run evidence was recorded.'),
        digest,
        digestAlgorithm: digest ? normalizeString(entry.digestAlgorithm ?? entry.algorithm, 'sha256') : null,
        artifactUri,
        severity: EVIDENCE_SEVERITIES.has(requestedSeverity) ? requestedSeverity : 'info',
        requestedSeverity,
        retentionClass: EVIDENCE_RETENTION_CLASSES.has(requestedRetentionClass) ? requestedRetentionClass : 'audit',
        requestedRetentionClass,
        redacted: normalizeBoolean(entry.redacted, false),
        tags: normalizeStringList(entry.tags)
      };
    });
}

function buildEvidenceLedger({ evidence, proofId, accessBoundary, now }) {
  return evidence.map((entry, index) => {
    const digestPresent = Boolean(entry.digest);
    const artifactPresent = Boolean(entry.artifactUri);
    const exportable = digestPresent && accessBoundary.handoffPolicy.canExportAudit;

    return {
      sequence: index + 1,
      ledgerId: `${proofId}:evidence:${index + 1}`,
      evidenceId: entry.id,
      type: entry.type,
      source: entry.source,
      providerId: entry.providerId,
      observedAt: entry.observedAt,
      recordedAt: now,
      severity: entry.severity,
      summary: entry.summary,
      digest: entry.digest,
      digestAlgorithm: entry.digestAlgorithm,
      digestPresent,
      artifactUri: entry.artifactUri,
      artifactPresent,
      retentionClass: entry.retentionClass,
      redacted: entry.redacted,
      tags: entry.tags,
      exportable,
      storagePartition: accessBoundary.partitions.storageKey,
      proofNamespace: accessBoundary.partitions.proofNamespace
    };
  });
}

function normalizeFailure(failure, index) {
  const code = normalizeString(failure?.code, 'unknown_failure');
  const retryable = typeof failure?.retryable === 'boolean'
    ? failure.retryable
    : RETRYABLE_FAILURE_CODES.has(code) && !TERMINAL_FAILURE_CODES.has(code);

  return {
    id: normalizeString(failure?.id, `failure-${index + 1}`),
    code,
    message: normalizeString(failure?.message, 'Verifier-run failed without a detailed message.'),
    severity: normalizeString(failure?.severity, retryable ? 'warning' : 'error'),
    retryable,
    terminal: TERMINAL_FAILURE_CODES.has(code) || failure?.terminal === true,
    component: normalizeString(failure?.component, 'hosted-kernel-verifier'),
    observedAt: asIsoTimestamp(failure?.observedAt)
  };
}

function normalizeFailures(input) {
  const candidates = Array.isArray(input.failures)
    ? input.failures
    : input.failure
      ? [input.failure]
      : [];

  return candidates
    .filter((failure) => failure && typeof failure === 'object')
    .map(normalizeFailure);
}

function normalizeHistoryEntry(entry, index) {
  const checkedAt = asIsoTimestamp(entry?.checkedAt ?? entry?.generatedAt ?? entry?.observedAt);
  const startedAt = asIsoTimestamp(entry?.startedAt ?? entry?.audit?.startedAt, null);
  const completedAt = asIsoTimestamp(entry?.completedAt ?? entry?.audit?.completedAt ?? checkedAt, checkedAt);
  const explicitDurationMs = asNonNegativeInteger(entry?.durationMs ?? entry?.audit?.durationMs, null);
  const measuredDurationMs = startedAt && completedAt
    ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
    : null;
  const state = HEALTH_STATES.has(entry?.health?.state)
    ? entry.health.state
    : HEALTH_STATES.has(entry?.state)
      ? entry.state
      : entry?.ok === false
        ? 'failed'
        : 'healthy';
  const failureCount = asNonNegativeInteger(entry?.failureCount ?? entry?.health?.failureCount, 0);
  const evidenceCount = asNonNegativeInteger(entry?.evidenceCount ?? entry?.health?.evidenceCount, 0);
  const retryAllowed = entry?.retry?.allowed === true || entry?.retryAllowed === true;

  return {
    id: normalizeString(entry?.id ?? entry?.proofId ?? entry?.audit?.proofId, `history-${index + 1}`),
    checkedAt,
    startedAt,
    completedAt,
    durationMs: explicitDurationMs ?? measuredDurationMs,
    state,
    ok: entry?.ok === undefined ? state !== 'failed' : entry.ok === true,
    failureCount,
    evidenceCount,
    evidenceDigestCount: asNonNegativeInteger(entry?.evidenceDigestCount ?? entry?.audit?.evidenceDigestCount, 0),
    retryAllowed,
    providerAckPendingCount: asNonNegativeInteger(
      entry?.providerAckPendingCount ?? entry?.pendingProviderAcks ?? entry?.audit?.pendingProviderAcks,
      0
    ),
    operationalReady: normalizeBoolean(entry?.operationalReady ?? entry?.audit?.operationalHealthReady, true),
    lifecycleNextAction: normalizeString(entry?.lifecycleNextAction ?? entry?.audit?.lifecycleNextAction, null),
    recoveryStatus: normalizeString(entry?.recoveryStatus ?? entry?.audit?.recoveryStatus, null),
    failureCodes: Array.isArray(entry?.failureCodes)
      ? entry.failureCodes.map((code) => normalizeString(code, 'unknown_failure'))
      : Array.isArray(entry?.audit?.failureCodes)
        ? entry.audit.failureCodes.map((code) => normalizeString(code, 'unknown_failure'))
        : [],
    proofId: normalizeString(entry?.proofId ?? entry?.audit?.proofId, null)
  };
}

function normalizeHistory(history, limit = DEFAULT_HISTORY_LIMIT) {
  if (!Array.isArray(history)) {
    return [];
  }

  const snapshots = history
    .filter((entry) => entry && typeof entry === 'object')
    .map(normalizeHistoryEntry)
    .sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt));

  return snapshots.slice(Math.max(0, snapshots.length - limit));
}

function normalizeClientRuntime(input, now) {
  const request = normalizeObject(input.request ?? input.clientRequest ?? input.runtimeRequest);
  const client = normalizeObject(input.client ?? input.clientState ?? input.runtimeClient);
  const workflow = normalizeObject(input.workflow ?? input.workflowHandoff ?? client.workflow);
  const rawChannel = normalizeString(client.channel ?? request.channel ?? input.channel, 'api');
  const rawIntent = normalizeString(workflow.intent ?? input.workflowIntent, 'observe');
  const requestId = normalizeString(
    request.id ?? request.requestId ?? input.requestId,
    normalizeString(input.commandId ?? input.idempotencyKey, null)
  );
  const traceId = normalizeString(request.traceId ?? input.traceId, null);
  const sessionId = normalizeString(client.sessionId ?? request.sessionId ?? input.sessionId, null);
  const returnTo = normalizeString(workflow.returnTo ?? client.returnTo ?? input.returnTo, null);
  const requested = normalizeBoolean(
    workflow.requested ?? input.workflowHandoffRequested,
    Boolean(returnTo || workflow.queue || workflow.intent)
  );
  const notifyOn = normalizeStringList(workflow.notifyOn ?? input.notifyOn);

  return {
    schema: 'aios.syscall-layer.verifier-run.client-runtime.v1',
    observedAt: now,
    request: {
      id: requestId,
      traceId,
      correlationId: normalizeString(request.correlationId ?? input.correlationId, traceId ?? requestId),
      idempotencyKey: normalizeString(request.idempotencyKey ?? input.idempotencyKey ?? input.commandId, null),
      source: normalizeString(request.source ?? input.source, surfaceName)
    },
    client: {
      channel: CLIENT_CHANNELS.has(rawChannel) ? rawChannel : 'api',
      requestedChannel: rawChannel,
      sessionId,
      buildId: normalizeString(client.buildId ?? client.build ?? input.clientBuildId, null),
      version: normalizeString(client.version ?? input.clientVersion, null),
      locale: normalizeString(client.locale ?? request.locale, null)
    },
    workflow: {
      requested,
      intent: WORKFLOW_HANDOFF_INTENTS.has(rawIntent) ? rawIntent : 'observe',
      requestedIntent: rawIntent,
      returnTo,
      queue: normalizeString(workflow.queue ?? input.workflowQueue, null),
      label: normalizeString(workflow.label ?? input.workflowLabel, 'Verifier run'),
      notifyOn,
      ackToken: normalizeString(workflow.ackToken ?? input.workflowAckToken, null)
    },
    stateKey: [
      surfaceGroup,
      surfaceName,
      requestId ? `request:${requestId}` : 'request:untracked',
      sessionId ? `session:${sessionId}` : 'session:headless'
    ].join('/')
  };
}

function normalizeCommandLedger(commands) {
  if (!Array.isArray(commands)) {
    return [];
  }

  return commands
    .filter((command) => command && typeof command === 'object')
    .map((command, index) => ({
      id: normalizeString(command.id ?? command.commandId ?? command.idempotencyKey, `command-${index + 1}`),
      command: normalizeString(command.command, 'run'),
      acceptedAt: asIsoTimestamp(command.acceptedAt ?? command.observedAt),
      proofId: normalizeString(command.proofId, null),
      result: normalizeString(command.result, 'unknown'),
      status: normalizeString(command.status, 'recorded')
    }))
    .sort((left, right) => Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt));
}

function normalizePersistedState(input, now) {
  const raw = normalizeObject(input.persistedState ?? input.state ?? input.recoveryState);
  const lifecycle = normalizeObject(raw.lifecycle);
  const lastRun = normalizeObject(raw.lastRun);
  const checkpoint = normalizeObject(raw.checkpoint);
  const requestedRunState = normalizeString(raw.runState ?? raw.status ?? lastRun.state, 'idle');
  const requestedCheckpointState = normalizeString(checkpoint.state, checkpoint.id || checkpoint.proofId ? 'ready' : 'absent');

  return {
    schema: 'aios.syscall-layer.verifier-run.persisted-state.v1',
    present: Object.keys(raw).length > 0,
    storageKey: normalizeString(raw.storageKey ?? raw.key, `${surfaceGroup}/${surfaceName}`),
    version: asNonNegativeInteger(raw.version, 0),
    revision: asNonNegativeInteger(raw.revision, 0),
    savedAt: asIsoTimestamp(raw.savedAt ?? raw.updatedAt, now),
    runState: PERSISTED_RUN_STATES.has(requestedRunState) ? requestedRunState : 'idle',
    requestedRunState,
    lifecycle: {
      enabled: normalizeBoolean(lifecycle.enabled ?? raw.enabled, true),
      paused: normalizeBoolean(lifecycle.paused ?? raw.paused, false),
      mode: normalizeString(lifecycle.mode ?? raw.mode, 'active'),
      lastCommandId: normalizeString(lifecycle.lastCommandId ?? raw.lastCommandId, null),
      lastCommand: normalizeString(lifecycle.lastCommand ?? raw.lastCommand, null)
    },
    lastRun: {
      runId: normalizeString(lastRun.runId ?? raw.runId, null),
      proofId: normalizeString(lastRun.proofId ?? raw.lastProofId, null),
      state: PERSISTED_RUN_STATES.has(normalizeString(lastRun.state, requestedRunState))
        ? normalizeString(lastRun.state, requestedRunState)
        : 'idle',
      startedAt: asIsoTimestamp(lastRun.startedAt, null),
      completedAt: asIsoTimestamp(lastRun.completedAt, null),
      attempt: asNonNegativeInteger(lastRun.attempt ?? raw.attempt, 0),
      healthState: HEALTH_STATES.has(lastRun.healthState) ? lastRun.healthState : null
    },
    checkpoint: {
      id: normalizeString(checkpoint.id, null),
      proofId: normalizeString(checkpoint.proofId ?? raw.checkpointProofId, null),
      cursor: normalizeString(checkpoint.cursor, null),
      revision: asNonNegativeInteger(checkpoint.revision, 0),
      savedAt: asIsoTimestamp(checkpoint.savedAt ?? checkpoint.updatedAt, raw.savedAt ?? now),
      evidenceCount: asNonNegativeInteger(checkpoint.evidenceCount, 0),
      failureCount: asNonNegativeInteger(checkpoint.failureCount, 0),
      state: CHECKPOINT_STATES.has(requestedCheckpointState) ? requestedCheckpointState : 'corrupt',
      requestedState: requestedCheckpointState
    },
    commandLedger: normalizeCommandLedger(raw.commandLedger ?? raw.commands)
  };
}

function computeBackoff({ attempt, baseBackoffMs, failureCount }) {
  const exponential = baseBackoffMs * (2 ** Math.max(0, attempt - 1));
  const pressure = failureCount > 1 ? baseBackoffMs * (failureCount - 1) : 0;
  return Math.min(MAX_BACKOFF_MS, exponential + pressure);
}

function buildValidation(input, failures, evidence, history, lifecycle, providerContracts, capabilityNegotiation, providerServiceContracts, persistedState, accessBoundary, clientRuntime, operationalHealth) {
  const errors = [];
  const warnings = [];

  if (input && typeof input !== 'object') {
    errors.push({
      field: 'input',
      code: 'invalid_input_type',
      message: 'Verifier-run input must be an object.'
    });
  }

  if (input.attempt !== undefined && !Number.isInteger(input.attempt)) {
    errors.push({
      field: 'attempt',
      code: 'invalid_attempt',
      message: 'attempt must be a non-negative integer when provided.'
    });
  }

  if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)) {
    errors.push({
      field: 'maxAttempts',
      code: 'invalid_attempt_limit',
      message: 'maxAttempts must be a positive integer when provided.'
    });
  }

  if (lifecycle.requestedCommand !== lifecycle.command) {
    errors.push({
      field: 'lifecycle.command',
      code: 'invalid_lifecycle_command',
      message: `lifecycle command must be one of: ${[...LIFECYCLE_COMMANDS].join(', ')}.`
    });
  }

  if (lifecycle.requestedEnabledProvided && typeof lifecycle.requestedEnabled !== 'boolean') {
    errors.push({
      field: 'enabled',
      code: 'invalid_enabled_flag',
      message: 'enabled must be a boolean when provided.'
    });
  }

  if (lifecycle.schedule.requestedMode !== lifecycle.schedule.mode) {
    errors.push({
      field: 'schedule.mode',
      code: 'invalid_schedule_mode',
      message: `schedule.mode must be one of: ${[...SCHEDULE_MODES].join(', ')}.`
    });
  }

  if (
    lifecycle.schedule.intervalProvided &&
    !Number.isInteger(lifecycle.schedule.requestedIntervalMs)
  ) {
    errors.push({
      field: 'schedule.intervalMs',
      code: 'invalid_schedule_interval_type',
      message: 'schedule.intervalMs must be an integer number of milliseconds when provided.'
    });
  }

  if (
    lifecycle.schedule.mode === 'interval' &&
    (lifecycle.schedule.intervalMs < MIN_SCHEDULE_INTERVAL_MS || lifecycle.schedule.intervalMs > MAX_SCHEDULE_INTERVAL_MS)
  ) {
    errors.push({
      field: 'schedule.intervalMs',
      code: 'invalid_schedule_interval',
      message: `schedule.intervalMs must be between ${MIN_SCHEDULE_INTERVAL_MS} and ${MAX_SCHEDULE_INTERVAL_MS}.`
    });
  }

  if (lifecycle.schedule.mode === 'cron' && !lifecycle.schedule.cronExpression) {
    errors.push({
      field: 'schedule.cron',
      code: 'missing_cron_expression',
      message: 'schedule.cron or schedule.cronExpression is required when schedule.mode is cron.'
    });
  }

  if (lifecycle.schedule.mode === 'cron' && lifecycle.schedule.cronExpression && lifecycle.schedule.cronValid === false) {
    errors.push({
      field: 'schedule.cron',
      code: 'invalid_cron_expression',
      message: 'schedule.cron must be a five-field cron expression using numeric values, ranges, lists, or step values.'
    });
  }

  if (
    lifecycle.schedule.nextRunAtProvided &&
    lifecycle.schedule.nextRunAt === null &&
    lifecycle.schedule.requestedNextRunAt !== null
  ) {
    errors.push({
      field: 'schedule.nextRunAt',
      code: 'invalid_schedule_next_run_at',
      message: 'schedule.nextRunAt must be a valid timestamp when provided.'
    });
  }

  if (
    lifecycle.schedule.mode !== 'manual' &&
    lifecycle.schedule.nextRunAt &&
    Date.parse(lifecycle.schedule.nextRunAt) < Date.parse(persistedState.savedAt)
  ) {
    warnings.push({
      field: 'schedule.nextRunAt',
      code: 'schedule_next_run_before_state_save',
      message: 'Scheduled nextRunAt is older than the persisted state timestamp and will be treated as due immediately.'
    });
  }

  if (lifecycle.command === 'schedule' && lifecycle.schedule.mode === 'manual') {
    errors.push({
      field: 'schedule.mode',
      code: 'schedule_command_requires_schedule_mode',
      message: 'lifecycle command schedule requires schedule.mode to be interval or cron.'
    });
  }

  if (lifecycle.command === 'resume' && persistedState.present && (!persistedState.lifecycle.paused || persistedState.runState === 'disabled')) {
    errors.push({
      field: 'lifecycle.command',
      code: 'resume_requires_paused_enabled_state',
      message: 'resume requires a persisted paused verifier-run that is still enabled.'
    });
  }

  if (lifecycle.command === 'pause' && persistedState.present && !persistedState.lifecycle.enabled) {
    errors.push({
      field: 'lifecycle.command',
      code: 'pause_requires_enabled_state',
      message: 'pause requires verifier-run to be enabled in persisted lifecycle state.'
    });
  }

  if (lifecycle.command === 'disable' && ACTIVE_RUN_STATES.has(persistedState.runState)) {
    warnings.push({
      field: 'lifecycle.command',
      code: 'disable_interrupts_active_run',
      message: 'Disabling verifier-run while a run is active will persist a disabled state and require recovery before resuming proof collection.'
    });
  }

  for (const provider of providerContracts) {
    if (provider.requestedType !== provider.type) {
      errors.push({
        field: `providers.${provider.id}.type`,
        code: 'invalid_provider_type',
        message: `provider.type must be one of: ${[...PROVIDER_TYPES].join(', ')}.`
      });
    }

    if (provider.sync.requestedDirection !== provider.sync.direction) {
      errors.push({
        field: `providers.${provider.id}.sync.direction`,
        code: 'invalid_sync_direction',
        message: `provider.sync.direction must be one of: ${[...SYNC_DIRECTIONS].join(', ')}.`
      });
    }

    if (provider.health.requestedStatus !== provider.health.status) {
      errors.push({
        field: `providers.${provider.id}.health.status`,
        code: 'invalid_provider_health_status',
        message: `provider.health.status must be one of: ${[...OPERATIONAL_HEALTH_STATUSES].join(', ')}.`
      });
    }

    if (!provider.endpoint) {
      warnings.push({
        field: `providers.${provider.id}.endpoint`,
        code: 'provider_endpoint_missing',
        message: 'Provider contract is retained for negotiation but cannot receive verifier-run handoff without an endpoint.'
      });
    }

    if (provider.handoff.enabled && !provider.handoff.target) {
      errors.push({
        field: `providers.${provider.id}.handoff.target`,
        code: 'missing_handoff_target',
        message: 'handoff.target is required when provider handoff is enabled.'
      });
    }
  }

  if (providerContracts.length === 0) {
    warnings.push({
      field: 'providers',
      code: 'missing_provider_contracts',
      message: 'No provider contracts were supplied for capability negotiation or external handoff.'
    });
  }

  if (accessBoundary.requestedMode && accessBoundary.requestedMode !== accessBoundary.mode) {
    errors.push({
      field: 'isolationMode',
      code: 'invalid_isolation_mode',
      message: `isolationMode must be one of: ${[...ISOLATION_MODES].join(', ')}.`
    });
  }

  if (accessBoundary.strictScoped && (!accessBoundary.tenantId || !accessBoundary.workspaceId)) {
    errors.push({
      field: 'workspace',
      code: 'strict_scope_incomplete',
      message: 'Strict verifier-run isolation requires both tenantId and workspaceId.'
    });
  }

  if (!accessBoundary.actor.roleKnown) {
    errors.push({
      field: 'actor.role',
      code: 'unknown_actor_role',
      message: `actor.role must be one of: ${Object.keys(ROLE_PERMISSION_GRANTS).join(', ')}.`
    });
  }

  if (accessBoundary.missingPermissions.length > 0) {
    errors.push({
      field: 'actor.permissions',
      code: 'permission_denied',
      message: `Verifier-run command ${lifecycle.command} is missing permissions: ${accessBoundary.missingPermissions.join(', ')}.`
    });
  }

  if (accessBoundary.providerScopeMismatches.length > 0) {
    errors.push({
      field: 'providers',
      code: 'provider_scope_mismatch',
      message: 'Provider contracts must remain inside the active verifier-run tenant/workspace boundary.'
    });
  }

  for (const signal of operationalHealth.signals) {
    if (signal.requestedStatus !== signal.status) {
      errors.push({
        field: `operationalHealth.signals.${signal.id}.status`,
        code: 'invalid_health_signal_status',
        message: `health signal status must be one of: ${[...OPERATIONAL_HEALTH_STATUSES].join(', ')}.`
      });
    }

    if (signal.requestedComponent !== signal.component) {
      warnings.push({
        field: `operationalHealth.signals.${signal.id}.component`,
        code: 'unknown_health_signal_component',
        message: `health signal component was normalized to ${signal.component}.`
      });
    }
  }

  if (operationalHealth.failedCriticalSignals.length > 0) {
    errors.push({
      field: 'operationalHealth',
      code: 'critical_provider_unhealthy',
      message: `Critical verifier-run dependencies are failed: ${operationalHealth.failedCriticalSignals.join(', ')}.`
    });
  }

  if (operationalHealth.staleCriticalSignals.length > 0) {
    errors.push({
      field: 'operationalHealth',
      code: 'critical_provider_health_stale',
      message: `Critical verifier-run dependency health is stale: ${operationalHealth.staleCriticalSignals.join(', ')}.`
    });
  }

  if (operationalHealth.degraded && operationalHealth.ready) {
    warnings.push({
      field: 'operationalHealth',
      code: 'degraded_operational_health',
      message: 'Verifier-run can continue, but at least one dependency reported degraded or unknown health.'
    });
  }

  if (clientRuntime.client.requestedChannel !== clientRuntime.client.channel) {
    errors.push({
      field: 'client.channel',
      code: 'invalid_client_channel',
      message: `client.channel must be one of: ${[...CLIENT_CHANNELS].join(', ')}.`
    });
  }

  if (clientRuntime.workflow.requestedIntent !== clientRuntime.workflow.intent) {
    errors.push({
      field: 'workflow.intent',
      code: 'invalid_workflow_handoff_intent',
      message: `workflow.intent must be one of: ${[...WORKFLOW_HANDOFF_INTENTS].join(', ')}.`
    });
  }

  if (clientRuntime.workflow.requested && !clientRuntime.workflow.returnTo && !clientRuntime.workflow.queue) {
    errors.push({
      field: 'workflow.returnTo',
      code: 'missing_workflow_handoff_target',
      message: 'workflow.returnTo or workflow.queue is required when a client workflow handoff is requested.'
    });
  }

  if (clientRuntime.workflow.requested && !clientRuntime.request.id && !clientRuntime.request.traceId) {
    warnings.push({
      field: 'request.id',
      code: 'workflow_handoff_untracked',
      message: 'Client workflow handoff was requested without request.id or traceId; runtime can display the handoff but cannot correlate it to a client request.'
    });
  }

  if (!accessBoundary.scoped && providerContracts.some((provider) => provider.handoff.enabled)) {
    warnings.push({
      field: 'workspace',
      code: 'unscoped_external_handoff',
      message: 'External handoff is safer when tenantId and workspaceId are supplied for audit partitioning.'
    });
  }

  if (!capabilityNegotiation.satisfied) {
    errors.push({
      field: 'requiredCapabilities',
      code: 'capability_negotiation_failed',
      message: `Missing provider capabilities: ${capabilityNegotiation.missingCapabilities.join(', ')}.`
    });
  }

  if (providerServiceContracts.missingInvokableCapabilities.length > 0) {
    errors.push({
      field: 'providers',
      code: 'capability_handoff_unavailable',
      message: `Required capabilities are advertised but not invokable by ready provider contracts: ${providerServiceContracts.missingInvokableCapabilities.join(', ')}.`
    });
  }

  for (const contract of providerServiceContracts.contracts) {
    if (contract.invocationMode === 'quarantine') {
      errors.push({
        field: `providers.${contract.providerId}`,
        code: 'provider_contract_quarantined',
        message: `Provider ${contract.providerId} cannot participate in hosted-kernel verifier-run until ${contract.blockedReasons.join(', ')} is resolved.`
      });
    }

    if (contract.deliveryState === 'blocked') {
      warnings.push({
        field: `providers.${contract.providerId}.handoff`,
        code: 'provider_handoff_blocked',
        message: `Provider ${contract.providerId} handoff is blocked by: ${contract.blockedReasons.join(', ')}.`
      });
    }
  }

  if (failures.some((failure) => failure.terminal && failure.retryable)) {
    warnings.push({
      field: 'failures',
      code: 'conflicting_retry_contract',
      message: 'Terminal failures are treated as non-retryable even when retryable was requested.'
    });
  }

  if (evidence.length === 0) {
    warnings.push({
      field: 'evidence',
      code: 'missing_runtime_evidence',
      message: 'No verifier evidence was supplied for this run.'
    });
  }

  for (const entry of evidence) {
    if (entry.requestedSeverity !== entry.severity) {
      warnings.push({
        field: `evidence.${entry.id}.severity`,
        code: 'invalid_evidence_severity',
        message: `evidence.severity was normalized to ${entry.severity}.`
      });
    }

    if (entry.requestedRetentionClass !== entry.retentionClass) {
      warnings.push({
        field: `evidence.${entry.id}.retentionClass`,
        code: 'invalid_evidence_retention_class',
        message: `evidence.retentionClass was normalized to ${entry.retentionClass}.`
      });
    }

    if (entry.artifactUri && !entry.digest) {
      warnings.push({
        field: `evidence.${entry.id}.digest`,
        code: 'artifact_digest_missing',
        message: 'Evidence artifacts should include a digest before they are exported in the proof bundle.'
      });
    }

    if (entry.digest && !entry.digestAlgorithm) {
      warnings.push({
        field: `evidence.${entry.id}.digestAlgorithm`,
        code: 'evidence_digest_algorithm_missing',
        message: 'Evidence digest algorithm was not supplied; sha256 is assumed for the proof ledger.'
      });
    }
  }

  if (!lifecycle.enabled) {
    warnings.push({
      field: 'lifecycle.enabled',
      code: 'verifier_disabled',
      message: 'Verifier-run is disabled; runtime proof collection is suspended until it is enabled.'
    });
  }

  if (lifecycle.paused) {
    warnings.push({
      field: 'lifecycle.command',
      code: 'verifier_paused',
      message: 'Verifier-run is paused and will not execute scheduled checks.'
    });
  }

  if (input.history !== undefined && !Array.isArray(input.history)) {
    warnings.push({
      field: 'history',
      code: 'ignored_history',
      message: 'history must be an array of prior verifier-run snapshots when provided.'
    });
  }

  if (history.length > 0 && history.every((entry) => entry.state === 'failed')) {
    warnings.push({
      field: 'history',
      code: 'persistent_verifier_failure',
      message: 'Recent verifier-run history contains only failed snapshots.'
    });
  }

  if (persistedState.present && persistedState.requestedRunState !== persistedState.runState) {
    warnings.push({
      field: 'persistedState.runState',
      code: 'invalid_persisted_run_state',
      message: `Persisted run state was normalized to ${persistedState.runState}.`
    });
  }

  if (persistedState.present && persistedState.checkpoint.requestedState !== persistedState.checkpoint.state) {
    errors.push({
      field: 'persistedState.checkpoint.state',
      code: 'invalid_checkpoint_state',
      message: `checkpoint.state must be one of: ${[...CHECKPOINT_STATES].join(', ')}.`
    });
  }

  if (persistedState.checkpoint.state === 'corrupt') {
    errors.push({
      field: 'persistedState.checkpoint',
      code: 'corrupt_checkpoint',
      message: 'Corrupt verifier-run checkpoints must be repaired or discarded before proof emission.'
    });
  }

  if (persistedState.present && persistedState.runState === 'running' && !persistedState.lastRun.runId && !persistedState.lastRun.proofId) {
    warnings.push({
      field: 'persistedState.lastRun',
      code: 'unidentified_interrupted_run',
      message: 'A running persisted state without runId or proofId cannot be resumed precisely and will be replayed from checkpoint.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function shapeActionableErrors(failures, validation, operationalResponse = null, operationalIncidentPlan = null) {
  const validationErrors = validation.errors.map((error) => ({
    code: error.code,
    message: error.message,
    action: `Correct ${error.field} before invoking verifier-run again.`,
    retryable: false
  }));

  const failureErrors = failures.map((failure) => ({
    code: failure.code,
    message: failure.message,
    action: failure.retryable && !failure.terminal
      ? `Retry ${surfaceName} after the recommended backoff and preserve existing evidence.`
      : `Escalate ${failure.component} with the audit.proof bundle before retrying.`,
    retryable: failure.retryable && !failure.terminal,
    component: failure.component
  }));

  const operationalErrors = operationalResponse?.actions
    ?.filter((action) => action.type === 'refresh-critical-health' || action.type === 'repair-critical-health')
    .map((action) => ({
      code: action.code ?? action.type,
      message: action.type === 'refresh-critical-health'
        ? `Critical health signal ${action.target} is stale and must be refreshed before verifier-run can proceed.`
        : action.type === 'repair-critical-health'
          ? `Critical health signal ${action.target} is failed and must be repaired before verifier-run can proceed.`
          : `Operational action ${action.type} is required for ${action.target}.`,
      action: action.type === 'refresh-critical-health'
        ? 'Refresh provider health and retry with a current health timestamp.'
        : action.type === 'repair-critical-health'
          ? 'Repair or replace the failed provider before retrying verifier-run.'
          : operationalResponse.retry.allowed
            ? `Retry after ${operationalResponse.retry.backoffMs}ms.`
            : 'Escalate with the audit proof bundle and preserved evidence.',
      retryable: action.retryable,
      component: action.target
    })) ?? [];

  const incidentErrors = operationalIncidentPlan?.incidents
    ?.filter((incident) => incident.severity === 'error' || incident.blocking)
    .map((incident) => ({
      code: incident.code,
      message: incident.operatorMessage,
      action: incident.runbook.nextStep,
      retryable: incident.retry.retryable,
      component: incident.component,
      incidentId: incident.id,
      route: incident.runbook.route,
      retryAt: incident.retry.retryAt
    })) ?? [];

  return [...validationErrors, ...failureErrors, ...operationalErrors, ...incidentErrors];
}

function buildOperationalResponse({ operationalHealth, validation, failures, lifecycleSettings, attempt, maxAttempts, retryAllowed, backoffMs, now }) {
  const attemptsRemaining = Math.max(0, maxAttempts - attempt);
  const retryAt = retryAllowed
    ? new Date(Date.parse(now) + backoffMs).toISOString()
    : null;
  const terminalFailures = failures.filter((failure) => failure.terminal || !failure.retryable);
  const retryableFailures = failures.filter((failure) => failure.retryable && !failure.terminal);
  const degradedSignals = operationalHealth.signals.filter((signal) => (
    signal.status === 'degraded' || signal.status === 'unknown' || signal.stale
  ));
  const blockedReasons = [
    ...validation.errors.map((error) => error.code),
    ...terminalFailures.map((failure) => failure.code),
    ...(!lifecycleSettings.enabled ? ['verifier_disabled'] : []),
    ...(lifecycleSettings.paused ? ['verifier_paused'] : [])
  ];
  const degradedReasons = [
    ...degradedSignals.map((signal) => `${signal.component}:${signal.status}${signal.stale ? ':stale' : ''}`),
    ...validation.warnings.map((warning) => warning.code),
    ...retryableFailures.map((failure) => failure.code)
  ];
  const runnable = blockedReasons.length === 0 && operationalHealth.ready;
  const failureState = blockedReasons.length > 0
    ? 'blocked'
    : retryAllowed
      ? 'retry-scheduled'
      : retryableFailures.length > 0 && attemptsRemaining === 0
        ? 'retry-exhausted'
        : !operationalHealth.ready
          ? 'dependency-unready'
          : degradedReasons.length > 0
            ? 'degraded-runnable'
            : 'ready';
  const degradedMode = {
    active: failureState === 'degraded-runnable' || operationalHealth.degraded,
    runnable,
    requiresAudit: degradedReasons.length > 0,
    reasonCount: degradedReasons.length,
    reasons: degradedReasons
  };
  const nextAction = failureState === 'blocked'
    ? 'resolve-blocking-errors'
    : failureState === 'dependency-unready'
      ? operationalHealth.nextAction
      : failureState === 'retry-scheduled'
        ? 'wait-for-backoff'
        : failureState === 'retry-exhausted'
          ? 'escalate-retry-exhausted'
          : degradedMode.active
            ? 'run-degraded-with-audit'
            : 'run-verifier';
  const actions = [
    ...operationalHealth.failedCriticalSignals.map((signalId) => ({
      type: 'repair-critical-health',
      target: signalId,
      severity: 'error',
      retryable: false
    })),
    ...operationalHealth.staleCriticalSignals.map((signalId) => ({
      type: 'refresh-critical-health',
      target: signalId,
      severity: 'error',
      retryable: true
    })),
    ...terminalFailures.map((failure) => ({
      type: 'escalate-failure',
      target: failure.component,
      code: failure.code,
      severity: failure.severity,
      retryable: false
    })),
    ...retryableFailures.map((failure) => ({
      type: retryAllowed ? 'retry-after-backoff' : 'preserve-evidence-and-escalate',
      target: failure.component,
      code: failure.code,
      severity: failure.severity,
      retryable: retryAllowed
    }))
  ];

  return {
    schema: 'aios.syscall-layer.verifier-run.operational-response.v1',
    generatedAt: now,
    failureState,
    runnable,
    nextAction,
    blockedReasons,
    degradedMode,
    retry: {
      allowed: retryAllowed,
      attempt,
      maxAttempts,
      attemptsRemaining,
      backoffMs,
      retryAt,
      providerRetryAfterMs: operationalHealth.providerRetryAfterMs
    },
    actionCount: actions.length,
    actions
  };
}

function signalRunbook(signal, providerContract, operationalResponse) {
  if (signal.stale) {
    return {
      action: 'refresh-health-signal',
      nextStep: `Refresh ${signal.component} health for ${signal.providerId ?? signal.id} before verifier-run continues.`,
      route: providerContract?.handoff.routeKey ?? `${surfaceGroup}/${surfaceName}/health/${signal.component}`,
      evidenceRequired: ['fresh-health-timestamp', 'provider-status-snapshot']
    };
  }

  if (signal.status === 'failed') {
    return {
      action: 'repair-provider',
      nextStep: `Repair or replace ${signal.component} ${signal.providerId ?? signal.id} and rerun verifier health validation.`,
      route: providerContract?.handoff.routeKey ?? `${surfaceGroup}/${surfaceName}/incidents/${signal.component}`,
      evidenceRequired: ['failure-root-cause', 'provider-recovery-proof']
    };
  }

  if (signal.status === 'degraded' || signal.status === 'unknown') {
    return {
      action: operationalResponse.degradedMode.active ? 'run-degraded-with-audit' : 'observe-provider',
      nextStep: `Continue only with degraded-mode audit evidence for ${signal.component}.`,
      route: providerContract?.handoff.routeKey ?? `${surfaceGroup}/${surfaceName}/degraded/${signal.component}`,
      evidenceRequired: ['degraded-mode-acceptance', 'operator-ack']
    };
  }

  return {
    action: 'observe-provider',
    nextStep: `Keep ${signal.component} in the verifier-run health ledger.`,
    route: providerContract?.handoff.routeKey ?? `${surfaceGroup}/${surfaceName}/health/${signal.component}`,
    evidenceRequired: ['health-ledger-entry']
  };
}

function buildOperationalIncidentPlan({
  operationalHealth,
  operationalResponse,
  providerServiceContracts,
  failures,
  validation,
  accessBoundary,
  proofId,
  now
}) {
  const providerContractsById = new Map(
    providerServiceContracts.contracts.map((contract) => [contract.providerId, contract])
  );
  const unhealthySignals = operationalHealth.signals.filter((signal) => (
    signal.status === 'failed' || signal.status === 'degraded' || signal.status === 'unknown' || signal.stale
  ));
  const signalIncidents = unhealthySignals.map((signal, index) => {
    const providerContract = signal.providerId ? providerContractsById.get(signal.providerId) : null;
    const runbook = signalRunbook(signal, providerContract, operationalResponse);
    const blocking = (signal.critical && (signal.status === 'failed' || signal.stale)) || providerContract?.invocationMode === 'quarantine';
    const retryAfterMs = signal.retryAfterMs ?? operationalResponse.retry.providerRetryAfterMs ?? operationalResponse.retry.backoffMs;
    const retryable = !blocking || signal.stale;

    return {
      id: `${proofId}:incident:health:${index + 1}`,
      code: signal.stale
        ? 'health_signal_stale'
        : signal.status === 'failed'
          ? 'health_signal_failed'
          : signal.status === 'unknown'
            ? 'health_signal_unknown'
            : 'health_signal_degraded',
      source: signal.source,
      component: signal.component,
      providerId: signal.providerId,
      severity: blocking ? 'error' : 'warning',
      blocking,
      critical: signal.critical,
      operatorMessage: `${signal.component} health is ${signal.stale ? 'stale' : signal.status} for ${signal.providerId ?? signal.id}.`,
      observedAt: signal.lastSeenAt,
      ageMs: signal.ageMs,
      latencyMs: signal.latencyMs,
      consecutiveFailures: signal.consecutiveFailures,
      runbook,
      retry: {
        retryable,
        retryAfterMs: retryable && retryAfterMs > 0 ? retryAfterMs : null,
        retryAt: retryable && retryAfterMs > 0
          ? new Date(Date.parse(now) + retryAfterMs).toISOString()
          : operationalResponse.retry.retryAt
      },
      providerContract: providerContract
        ? {
          invocationMode: providerContract.invocationMode,
          deliveryState: providerContract.deliveryState,
          blockedReasons: providerContract.blockedReasons,
          matchedCapabilities: providerContract.capabilities.matched
        }
        : null
    };
  });
  const failureIncidents = failures.map((failure, index) => ({
    id: `${proofId}:incident:failure:${index + 1}`,
    code: failure.code,
    source: 'runtime-failure',
    component: failure.component,
    providerId: null,
    severity: failure.terminal || !failure.retryable ? 'error' : 'warning',
    blocking: failure.terminal || !failure.retryable,
    critical: failure.terminal || !failure.retryable,
    operatorMessage: failure.message,
    observedAt: failure.observedAt,
    ageMs: Math.max(0, Date.parse(now) - Date.parse(failure.observedAt)),
    latencyMs: null,
    consecutiveFailures: null,
    runbook: {
      action: failure.retryable && !failure.terminal ? 'retry-after-backoff' : 'escalate-runtime-failure',
      nextStep: failure.retryable && !failure.terminal
        ? `Retry verifier-run after ${operationalResponse.retry.backoffMs}ms while preserving evidence.`
        : `Escalate ${failure.component} with proof ${proofId} and failure evidence.`,
      route: `${surfaceGroup}/${surfaceName}/failures/${failure.component}`,
      evidenceRequired: ['failure-log', 'proof-bundle-ref']
    },
    retry: {
      retryable: failure.retryable && !failure.terminal && operationalResponse.retry.allowed,
      retryAfterMs: operationalResponse.retry.allowed ? operationalResponse.retry.backoffMs : null,
      retryAt: operationalResponse.retry.allowed ? operationalResponse.retry.retryAt : null
    },
    providerContract: null
  }));
  const validationIncidents = validation.errors.map((error, index) => ({
    id: `${proofId}:incident:validation:${index + 1}`,
    code: error.code,
    source: 'contract-validation',
    component: error.field,
    providerId: null,
    severity: 'error',
    blocking: true,
    critical: true,
    operatorMessage: error.message,
    observedAt: now,
    ageMs: 0,
    latencyMs: null,
    consecutiveFailures: null,
    runbook: {
      action: 'fix-input-contract',
      nextStep: `Correct ${error.field} and resubmit verifier-run.`,
      route: `${surfaceGroup}/${surfaceName}/validation`,
      evidenceRequired: ['corrected-request-contract']
    },
    retry: {
      retryable: false,
      retryAfterMs: null,
      retryAt: null
    },
    providerContract: null
  }));
  const incidents = [...signalIncidents, ...failureIncidents, ...validationIncidents];
  const blockingIncidents = incidents.filter((incident) => incident.blocking);
  const retryableIncidents = incidents.filter((incident) => incident.retry.retryable);
  const nextOperatorAction = blockingIncidents[0]?.runbook.action
    ?? retryableIncidents[0]?.runbook.action
    ?? operationalResponse.nextAction;

  return {
    schema: 'aios.syscall-layer.verifier-run.operational-incident-plan.v1',
    generatedAt: now,
    proofId,
    isolationKey: accessBoundary.partitions.isolationKey,
    auditSubject: accessBoundary.partitions.auditSubject,
    status: blockingIncidents.length > 0
      ? 'blocked'
      : retryableIncidents.length > 0
        ? 'retryable'
        : incidents.length > 0
          ? 'degraded'
          : 'clear',
    nextOperatorAction,
    incidentCount: incidents.length,
    blockingIncidentCount: blockingIncidents.length,
    retryableIncidentCount: retryableIncidents.length,
    incidents,
    summary: {
      bySeverity: countBy(incidents, (incident) => incident.severity),
      byComponent: countBy(incidents, (incident) => incident.component),
      byCode: countBy(incidents, (incident) => incident.code)
    }
  };
}

function buildLifecycleControls({ lifecycle, validation, retryAllowed, backoffMs, failures, persistedState, now }) {
  const blocked = !validation.ok;
  const runBlocked = blocked || !lifecycle.enabled || lifecycle.paused;
  const scheduled = lifecycle.command === 'schedule' || lifecycle.schedule.mode !== 'manual';
  const previousLifecycleState = lifecycleStateFromPersistedState(persistedState);
  const nextLifecycleState = lifecycleStateFromSettings(lifecycle);
  const activeRunInterrupted = lifecycle.command === 'disable' && ACTIVE_RUN_STATES.has(persistedState.runState);
  const scheduleDueNow = Boolean(
    lifecycle.schedule.nextRunAt &&
    Date.parse(lifecycle.schedule.nextRunAt) <= Date.parse(now)
  );
  const controlReasons = [
    ...validation.errors.map((error) => error.code),
    ...(!lifecycle.enabled ? ['disabled'] : []),
    ...(lifecycle.paused ? ['paused'] : []),
    ...(activeRunInterrupted ? ['active-run-interrupted'] : []),
    ...(scheduleDueNow ? ['schedule-due'] : []),
    ...failures
      .filter((failure) => failure.terminal || !failure.retryable)
      .map((failure) => `terminal-failure:${failure.code}`)
  ];
  const commandResult = blocked
    ? 'rejected'
    : activeRunInterrupted
      ? 'accepted-with-recovery-required'
      : previousLifecycleState === nextLifecycleState && lifecycle.command !== 'run'
        ? 'already-satisfied'
        : 'accepted';
  const lifecycleWriteIntent = blocked
    ? 'none'
    : lifecycle.command === 'run'
      ? 'observe-run'
      : lifecycle.command === 'schedule'
        ? 'upsert-schedule'
        : `set-${nextLifecycleState}`;
  const retryNextAction = retryAllowed
    ? `retry-after-${backoffMs}ms`
    : failures.length > 0
      ? 'operator-action-required'
      : 'no-retry-needed';

  return {
    schema: 'aios.syscall-layer.verifier-run.lifecycle.v1',
    command: lifecycle.command,
    enabled: lifecycle.enabled,
    paused: lifecycle.paused,
    mode: lifecycle.mode,
    schedule: {
      mode: lifecycle.schedule.mode,
      intervalMs: lifecycle.schedule.intervalMs,
      cronExpression: lifecycle.schedule.cronExpression,
      cronValid: lifecycle.schedule.cronValid,
      nextRunAt: lifecycle.schedule.nextRunAt,
      nextRunAtSource: lifecycle.schedule.nextRunAtSource,
      dueNow: scheduleDueNow
    },
    transition: {
      previousState: previousLifecycleState,
      nextState: nextLifecycleState,
      commandResult,
      writeIntent: lifecycleWriteIntent,
      activeRunInterrupted,
      persistedRunState: persistedState.runState,
      persistedRevision: persistedState.revision
    },
    controls: {
      canRunNow: !runBlocked,
      canEnable: !lifecycle.enabled,
      canDisable: lifecycle.enabled,
      canSchedule: validation.ok && lifecycle.enabled && !lifecycle.paused,
      canResume: lifecycle.paused,
      canPause: validation.ok && lifecycle.enabled && !lifecycle.paused,
      canClearSchedule: validation.ok && lifecycle.schedule.mode !== 'manual',
      requiresOperator: failures.some((failure) => failure.terminal || !failure.retryable) || blocked
    },
    controlReasons: [...new Set(controlReasons)],
    commandPlan: {
      accepted: commandResult !== 'rejected',
      result: commandResult,
      persistenceRequired: lifecycleWriteIntent !== 'none' && commandResult !== 'already-satisfied',
      scheduleMutation: lifecycle.command === 'schedule'
        ? {
          mode: lifecycle.schedule.mode,
          nextRunAt: lifecycle.schedule.nextRunAt,
          dueNow: scheduleDueNow
        }
        : null,
      proofCollection: {
        allowed: !runBlocked,
        mode: lifecycle.paused || !lifecycle.enabled
          ? 'suspended'
          : scheduled
            ? 'scheduled'
            : 'immediate',
        reason: runBlocked ? controlReasons[0] ?? 'blocked' : 'ready'
      }
    },
    nextAction: !validation.ok
      ? 'fix-lifecycle-settings'
      : !lifecycle.enabled
        ? 'enable-verifier-run'
        : lifecycle.paused
          ? 'resume-verifier-run'
          : scheduled
            ? 'await-scheduled-verifier-run'
            : retryNextAction
  };
}

function buildCommandStatus({ input, lifecycle, persistedState, proofId, now }) {
  const commandId = normalizeString(
    input.commandId ?? input.idempotencyKey,
    `${lifecycle.command}:${proofId}`
  );
  const matchingLedgerEntry = persistedState.commandLedger
    .find((entry) => entry.id === commandId && entry.command === lifecycle.command);
  const commandAlreadyApplied = (
    matchingLedgerEntry ||
    (persistedState.lifecycle.lastCommandId === commandId && persistedState.lifecycle.lastCommand === lifecycle.command)
  );
  const idempotentNoop = commandAlreadyApplied ||
    (lifecycle.command === 'enable' && persistedState.lifecycle.enabled && !persistedState.lifecycle.paused) ||
    (lifecycle.command === 'disable' && !persistedState.lifecycle.enabled) ||
    (lifecycle.command === 'pause' && persistedState.lifecycle.paused) ||
    (lifecycle.command === 'resume' && !persistedState.lifecycle.paused);

  return {
    schema: 'aios.syscall-layer.verifier-run.command-status.v1',
    commandId,
    idempotencyKeyProvided: Boolean(input.commandId ?? input.idempotencyKey),
    command: lifecycle.command,
    acceptedAt: now,
    duplicate: Boolean(commandAlreadyApplied),
    idempotent: true,
    effect: idempotentNoop ? 'noop' : 'apply',
    priorResult: matchingLedgerEntry?.result ?? null,
    restartSafe: Boolean(input.commandId ?? input.idempotencyKey) || Boolean(persistedState.lifecycle.lastCommandId),
    ledgerSize: persistedState.commandLedger.length,
    persistAs: {
      id: commandId,
      command: lifecycle.command,
      proofId,
      acceptedAt: now,
      result: idempotentNoop ? 'already-satisfied' : 'accepted',
      status: lifecycle.controls.canRunNow || lifecycle.command !== 'run' ? 'committed' : 'blocked'
    }
  };
}

function buildRecoveryPlan({ persistedState, lifecycle, validation, health, retryAllowed, proofId, now, recoveryWindowMs }) {
  const lastStartedAt = Date.parse(persistedState.lastRun.startedAt);
  const ageMs = Number.isNaN(lastStartedAt) ? null : Math.max(0, Date.parse(now) - lastStartedAt);
  const interrupted = persistedState.runState === 'running' || persistedState.lastRun.state === 'running';
  const checkpointReady = persistedState.checkpoint.state === 'ready' && Boolean(persistedState.checkpoint.proofId || persistedState.checkpoint.cursor);
  const staleInterruptedRun = interrupted && (ageMs === null || ageMs > recoveryWindowMs);
  const canResume = validation.ok && lifecycle.enabled && !lifecycle.paused && interrupted && checkpointReady && !staleInterruptedRun;
  const canReplay = validation.ok && lifecycle.enabled && !lifecycle.paused && (
    staleInterruptedRun ||
    (interrupted && !checkpointReady) ||
    persistedState.runState === 'failed'
  );
  const status = !persistedState.present
    ? 'fresh-start'
    : persistedState.checkpoint.state === 'corrupt'
      ? 'blocked-corrupt-checkpoint'
      : canResume
        ? 'resume-from-checkpoint'
        : canReplay
          ? 'replay-from-last-proof'
          : interrupted
            ? 'await-operator-recovery'
            : retryAllowed
              ? 'retry-scheduled'
              : 'settled';

  return {
    schema: 'aios.syscall-layer.verifier-run.recovery.v1',
    generatedAt: now,
    status,
    restartSafe: status !== 'blocked-corrupt-checkpoint' && status !== 'await-operator-recovery',
    persistedStatePresent: persistedState.present,
    interrupted,
    interruptedAgeMs: ageMs,
    recoveryWindowMs,
    checkpointReady,
    sourceProofId: persistedState.checkpoint.proofId ?? persistedState.lastRun.proofId,
    targetProofId: proofId,
    action: canResume
      ? 'resume-checkpoint'
      : canReplay
        ? 'replay-idempotent-run'
        : status === 'fresh-start'
          ? 'start-new-run'
          : status === 'settled'
            ? 'preserve-state'
            : 'operator-repair-required',
    nextPersistedState: {
      storageKey: persistedState.storageKey,
      version: persistedState.version + 1,
      revision: persistedState.revision + 1,
      savedAt: now,
      runState: health === 'failed' ? 'failed' : lifecycle.controls.canRunNow ? 'running' : lifecycle.enabled ? 'idle' : 'disabled',
      lastProofId: proofId,
      checkpointState: checkpointReady ? 'ready' : persistedState.checkpoint.state
    }
  };
}

function buildPersistedStateTransition({
  persistedState,
  lifecycle,
  commandStatus,
  recovery,
  operationalResponse,
  health,
  proofId,
  now,
  sync,
  validation
}) {
  const paused = lifecycle.paused || lifecycle.command === 'pause';
  const enabled = lifecycle.command === 'enable'
    ? true
    : lifecycle.command === 'disable'
      ? false
      : lifecycle.enabled;
  const commandChangesLifecycle = ['enable', 'disable', 'pause', 'resume', 'schedule'].includes(lifecycle.command);
  const commandNoop = commandStatus.effect === 'noop';
  const canWrite = recovery.restartSafe && validation.ok;
  const shouldAppendCommand = !commandStatus.duplicate && commandStatus.idempotencyKeyProvided;
  const runState = !enabled
    ? 'disabled'
    : paused
      ? 'paused'
      : health === 'failed'
        ? 'failed'
        : operationalResponse.retry.allowed
          ? 'queued'
          : lifecycle.controls.canRunNow && lifecycle.command === 'run' && !commandNoop
            ? 'running'
            : recovery.action === 'resume-checkpoint'
              ? 'recovering'
              : recovery.action === 'replay-idempotent-run'
                ? 'queued'
                : persistedState.present
                  ? persistedState.runState
                  : 'idle';
  const checkpointState = recovery.checkpointReady
    ? 'ready'
    : persistedState.checkpoint.state === 'corrupt'
      ? 'corrupt'
      : health === 'failed'
        ? 'stale'
        : persistedState.checkpoint.state;
  const visibleStatus = !canWrite
    ? 'blocked'
    : commandNoop
      ? 'unchanged'
      : recovery.status === 'resume-from-checkpoint'
        ? 'recovering'
        : operationalResponse.retry.allowed
          ? 'queued-for-retry'
          : runState;
  const conflictPolicy = persistedState.present
    ? 'compare-and-swap-revision'
    : 'create-if-absent';
  const blockedReasons = [
    ...validation.errors.map((error) => error.code),
    ...(!recovery.restartSafe ? [recovery.status] : []),
    ...(operationalResponse.failureState === 'blocked' ? operationalResponse.blockedReasons : [])
  ];
  const commandLedgerEntry = {
    ...commandStatus.persistAs,
    status: canWrite && !commandNoop ? 'committed' : commandStatus.persistAs.status,
    stateAfter: visibleStatus,
    persistedRevision: persistedState.revision + (canWrite && !commandNoop ? 1 : 0)
  };

  return {
    schema: 'aios.syscall-layer.verifier-run.persisted-state-transition.v1',
    generatedAt: now,
    storageKey: persistedState.storageKey,
    writeDisposition: !canWrite
      ? 'blocked'
      : commandNoop
        ? 'idempotent-noop'
        : persistedState.present
          ? 'update-existing'
          : 'create-new',
    conflictPolicy,
    expectedRevision: persistedState.revision,
    nextRevision: persistedState.revision + (canWrite && !commandNoop ? 1 : 0),
    restartStatus: {
      status: visibleStatus,
      restartSafe: recovery.restartSafe,
      recoveryStatus: recovery.status,
      recoveryAction: recovery.action,
      blockedReasons,
      commandDuplicate: commandStatus.duplicate,
      commandEffect: commandStatus.effect,
      retryAt: operationalResponse.retry.retryAt,
      operatorVisible: visibleStatus === 'blocked' || visibleStatus === 'queued-for-retry' || visibleStatus === 'recovering'
    },
    idempotency: {
      commandId: commandStatus.commandId,
      idempotencyKeyProvided: commandStatus.idempotencyKeyProvided,
      duplicate: commandStatus.duplicate,
      appendLedgerEntry: shouldAppendCommand,
      ledgerResult: commandLedgerEntry.result,
      replaySafe: commandStatus.restartSafe && recovery.restartSafe
    },
    persistAs: {
      schema: 'aios.syscall-layer.verifier-run.persisted-state.v1',
      storageKey: persistedState.storageKey,
      version: persistedState.version + (persistedState.present ? 0 : 1),
      revision: persistedState.revision + (canWrite && !commandNoop ? 1 : 0),
      savedAt: now,
      runState,
      lifecycle: {
        enabled,
        paused,
        mode: lifecycle.mode,
        lastCommandId: commandStatus.commandId,
        lastCommand: lifecycle.command,
        commandApplied: !commandNoop,
        commandChangesLifecycle
      },
      lastRun: {
        runId: persistedState.lastRun.runId ?? proofId,
        proofId,
        state: runState,
        startedAt: persistedState.lastRun.startedAt ?? now,
        completedAt: runState === 'running' || runState === 'recovering' || runState === 'queued' ? null : now,
        attempt: operationalResponse.retry.attempt,
        healthState: health
      },
      checkpoint: {
        id: persistedState.checkpoint.id ?? `${proofId}:checkpoint`,
        proofId: recovery.sourceProofId ?? proofId,
        cursor: persistedState.checkpoint.cursor,
        revision: persistedState.checkpoint.revision + (sync.pendingAckCount === 0 && canWrite ? 1 : 0),
        savedAt: now,
        evidenceCount: persistedState.checkpoint.evidenceCount,
        failureCount: persistedState.checkpoint.failureCount,
        state: checkpointState
      },
      commandLedgerAppend: shouldAppendCommand ? commandLedgerEntry : null
    }
  };
}

function negotiateProviderCapabilities(providers, requiredCapabilities) {
  const offered = new Set(providers.flatMap((provider) => provider.capabilities));
  const missing = requiredCapabilities.filter((capability) => !offered.has(capability));
  const providerMatches = providers.map((provider) => {
    const matched = requiredCapabilities.filter((capability) => provider.capabilities.includes(capability));

    return {
      providerId: provider.id,
      type: provider.type,
      service: provider.service,
      matchedCapabilities: matched,
      missingCapabilities: requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability)),
      ready: matched.length > 0 && Boolean(provider.endpoint)
    };
  });

  return {
    schema: 'aios.syscall-layer.verifier-run.capability-negotiation.v1',
    requiredCapabilities,
    offeredCapabilities: [...offered].sort(),
    missingCapabilities: missing,
    providerMatches,
    satisfied: missing.length === 0
  };
}

function buildProviderServiceContracts({ providers, requiredCapabilities, capabilityNegotiation, operationalHealth, accessBoundary, proofId, now }) {
  const failedCritical = new Set(operationalHealth.failedCriticalSignals);
  const staleCritical = new Set(operationalHealth.staleCriticalSignals);
  const scopeMismatchByProvider = new Map(
    accessBoundary.providerScopeMismatches.map((entry) => [entry.providerId, entry.mismatches])
  );
  const capabilityCoverage = Object.fromEntries(requiredCapabilities.map((capability) => [capability, []]));
  const contracts = providers.map((provider) => {
    const match = capabilityNegotiation.providerMatches.find((entry) => entry.providerId === provider.id);
    const healthSignalId = `provider:${provider.id}`;
    const scopeMismatches = scopeMismatchByProvider.get(provider.id) ?? [];
    const matchedCapabilities = match?.matchedCapabilities ?? [];
    const missingCapabilities = match?.missingCapabilities ?? requiredCapabilities;
    const endpointReady = Boolean(provider.endpoint);
    const ackPending = provider.handoff.ackRequired && provider.sync.acknowledgedProofId !== proofId;
    const syncLagMs = Math.max(0, Date.parse(now) - Date.parse(provider.sync.watermark));
    const blockedReasons = [
      ...(scopeMismatches.length > 0 ? ['provider-scope-mismatch'] : []),
      ...(failedCritical.has(healthSignalId) ? ['critical-health-failed'] : []),
      ...(staleCritical.has(healthSignalId) ? ['critical-health-stale'] : []),
      ...(!endpointReady ? ['endpoint-missing'] : []),
      ...(matchedCapabilities.length === 0 && requiredCapabilities.length > 0 ? ['no-required-capability-match'] : [])
    ];
    const invocationMode = scopeMismatches.length > 0 || failedCritical.has(healthSignalId)
      ? 'quarantine'
      : staleCritical.has(healthSignalId)
        ? 'hold'
        : endpointReady && matchedCapabilities.length > 0
          ? 'invoke'
          : endpointReady
            ? 'observe'
            : 'local-contract-only';
    const deliveryState = provider.handoff.enabled
      ? blockedReasons.length > 0
        ? 'blocked'
        : ackPending
          ? 'pending-ack'
          : 'ready'
      : 'not-configured';

    for (const capability of matchedCapabilities) {
      capabilityCoverage[capability]?.push(provider.id);
    }

    return {
      schema: 'aios.syscall-layer.verifier-run.provider-service-contract.v1',
      providerId: provider.id,
      type: provider.type,
      service: provider.service,
      contractVersion: provider.contractVersion,
      proofId,
      generatedAt: now,
      invocationMode,
      deliveryState,
      blockedReasons,
      endpointReady,
      healthStatus: provider.health.status,
      critical: provider.health.critical,
      capabilities: {
        matched: matchedCapabilities,
        missing: missingCapabilities,
        optional: provider.optionalCapabilities
      },
      sync: {
        direction: provider.sync.direction,
        cursor: provider.sync.cursor,
        watermark: provider.sync.watermark,
        revision: provider.sync.revision,
        syncLagMs,
        ackRequired: provider.handoff.ackRequired,
        ackPending
      },
      handoff: {
        enabled: provider.handoff.enabled,
        target: provider.handoff.target,
        correlationId: provider.handoff.correlationId,
        routeKey: provider.handoff.target
          ? `${accessBoundary.partitions.proofNamespace}:${provider.handoff.target}`
          : null,
        payloadRef: `${proofId}:provider:${provider.id}`,
        isolationKey: accessBoundary.partitions.isolationKey
      }
    };
  });
  const invokableCapabilityCoverage = Object.fromEntries(requiredCapabilities.map((capability) => [
    capability,
    contracts
      .filter((contract) => contract.invocationMode === 'invoke' && contract.capabilities.matched.includes(capability))
      .map((contract) => contract.providerId)
  ]));

  return {
    schema: 'aios.syscall-layer.verifier-run.provider-service-contracts.v1',
    generatedAt: now,
    proofId,
    requiredCapabilities,
    advertisedCapabilityCoverage: capabilityCoverage,
    invokableCapabilityCoverage,
    missingInvokableCapabilities: requiredCapabilities.filter((capability) => invokableCapabilityCoverage[capability].length === 0),
    invocationSummary: countBy(contracts, (contract) => contract.invocationMode),
    deliverySummary: countBy(contracts, (contract) => contract.deliveryState),
    contracts
  };
}

function buildSyncMetadata({ providers, proofId, now }) {
  const activeProviders = providers.filter((provider) => provider.endpoint);
  const pendingAckCount = activeProviders.filter((provider) => (
    provider.handoff.ackRequired && provider.sync.acknowledgedProofId !== proofId
  )).length;
  const newestWatermark = activeProviders
    .map((provider) => provider.sync.watermark)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? now;

  return {
    schema: 'aios.syscall-layer.verifier-run.sync.v1',
    generatedAt: now,
    proofId,
    providerCount: providers.length,
    activeProviderCount: activeProviders.length,
    pendingAckCount,
    newestWatermark,
    cursors: activeProviders.map((provider) => ({
      providerId: provider.id,
      direction: provider.sync.direction,
      cursor: provider.sync.cursor,
      watermark: provider.sync.watermark,
      revision: provider.sync.revision,
      acknowledged: provider.sync.acknowledgedProofId === proofId
    }))
  };
}

function providerMatchesAccessBoundary(provider, accessBoundary) {
  const providerTenantId = normalizeString(provider.tenantId, accessBoundary.tenantId);
  const providerWorkspaceId = normalizeString(provider.workspaceId, accessBoundary.workspaceId);

  return {
    tenantMatched: !accessBoundary.tenantId || providerTenantId === accessBoundary.tenantId,
    workspaceMatched: !accessBoundary.workspaceId || providerWorkspaceId === accessBoundary.workspaceId,
    providerTenantId,
    providerWorkspaceId
  };
}

function buildScopedHandoffProjection({ provider, serviceContract, accessBoundary, blockedReasons }) {
  const boundaryMatch = providerMatchesAccessBoundary(provider, accessBoundary);
  const redactionReasons = [
    ...(!accessBoundary.handoffPolicy.canExportAudit ? ['audit-export-not-authorized'] : []),
    ...(!boundaryMatch.tenantMatched ? ['tenant-boundary-mismatch'] : []),
    ...(!boundaryMatch.workspaceMatched ? ['workspace-boundary-mismatch'] : []),
    ...(serviceContract?.invocationMode === 'quarantine' ? ['provider-contract-quarantined'] : [])
  ];
  const canExposeTarget = redactionReasons.length === 0;
  const deliveryBlocked = blockedReasons.length > 0 || serviceContract?.deliveryState === 'blocked';

  return {
    canExposeTarget,
    redactionReasons,
    providerId: provider.id,
    tenantId: boundaryMatch.providerTenantId,
    workspaceId: boundaryMatch.providerWorkspaceId,
    endpoint: canExposeTarget ? provider.endpoint : null,
    target: canExposeTarget ? provider.handoff.target : null,
    routeKey: canExposeTarget ? serviceContract?.handoff.routeKey ?? null : null,
    payloadRef: serviceContract?.handoff.payloadRef ?? null,
    correlationId: canExposeTarget ? provider.handoff.correlationId : null,
    visibleState: deliveryBlocked
      ? 'blocked'
      : provider.handoff.state,
    sensitivity: {
      endpointRedacted: !canExposeTarget && Boolean(provider.endpoint),
      targetRedacted: !canExposeTarget && Boolean(provider.handoff.target),
      correlationIdRedacted: !canExposeTarget && Boolean(provider.handoff.correlationId)
    },
    boundary: {
      tenantMatched: boundaryMatch.tenantMatched,
      workspaceMatched: boundaryMatch.workspaceMatched,
      isolationKey: accessBoundary.partitions.isolationKey
    }
  };
}

function buildExternalHandoffState({ providers, validation, health, proofId, accessBoundary, providerServiceContracts }) {
  const enabledProviders = providers.filter((provider) => provider.handoff.enabled);
  const blockedReasons = [];
  const endpointlessProviders = enabledProviders.filter((provider) => !provider.endpoint);
  const blockedServiceContracts = providerServiceContracts.contracts.filter((contract) => (
    contract.handoff.enabled && (contract.deliveryState === 'blocked' || contract.invocationMode === 'quarantine')
  ));

  if (!validation.ok) {
    blockedReasons.push('validation-errors');
  }

  if (health === 'failed') {
    blockedReasons.push('failed-health-state');
  }

  if (endpointlessProviders.length > 0) {
    blockedReasons.push('provider-endpoint-missing');
  }

  if (enabledProviders.length > 0 && !accessBoundary.handoffPolicy.canExportAudit) {
    blockedReasons.push('audit-export-permission-missing');
  }

  if (accessBoundary.providerScopeMismatches.length > 0) {
    blockedReasons.push('provider-scope-mismatch');
  }

  if (blockedServiceContracts.length > 0) {
    blockedReasons.push('provider-service-contract-blocked');
  }

  return {
    schema: 'aios.syscall-layer.verifier-run.external-handoff.v1',
    proofId,
    isolationKey: accessBoundary.partitions.isolationKey,
    auditSubject: accessBoundary.partitions.auditSubject,
    enabled: enabledProviders.length > 0,
    ready: enabledProviders.length > 0 && blockedReasons.length === 0,
    blockedReasons,
    targets: enabledProviders.map((provider) => {
      const serviceContract = providerServiceContracts.contracts.find((contract) => contract.providerId === provider.id);
      const scopedProjection = buildScopedHandoffProjection({
        provider,
        serviceContract,
        accessBoundary,
        blockedReasons
      });

      return {
        providerId: provider.id,
        tenantId: scopedProjection.tenantId,
        workspaceId: scopedProjection.workspaceId,
        endpoint: scopedProjection.endpoint,
        target: scopedProjection.target,
        state: scopedProjection.visibleState,
        serviceInvocationMode: serviceContract?.invocationMode ?? 'local-contract-only',
        serviceDeliveryState: serviceContract?.deliveryState ?? 'not-configured',
        routeKey: scopedProjection.routeKey,
        payloadRef: scopedProjection.payloadRef ?? `${proofId}:provider:${provider.id}`,
        correlationId: scopedProjection.correlationId,
        ackRequired: provider.handoff.ackRequired,
        exposure: {
          allowed: scopedProjection.canExposeTarget,
          redactionReasons: scopedProjection.redactionReasons,
          sensitivity: scopedProjection.sensitivity,
          boundary: scopedProjection.boundary
        }
      };
    })
  };
}

function buildProviderHandoffDispatch({ providerServiceContracts, externalHandoff, sync, accessBoundary, proofId, now }) {
  const syncCursorByProvider = new Map(sync.cursors.map((cursor) => [cursor.providerId, cursor]));
  const enabledContracts = providerServiceContracts.contracts.filter((contract) => contract.handoff.enabled);
  const outbox = enabledContracts.map((contract, index) => {
    const syncCursor = syncCursorByProvider.get(contract.providerId);
    const blockedReasons = [
      ...externalHandoff.blockedReasons,
      ...contract.blockedReasons,
      ...(contract.deliveryState === 'pending-ack' ? ['provider-ack-pending'] : []),
      ...(contract.invocationMode !== 'invoke' ? [`provider-${contract.invocationMode}`] : [])
    ];
    const canExposeRoute = accessBoundary.handoffPolicy.canExportAudit && !contract.blockedReasons.includes('provider-scope-mismatch');
    const dispatchable = externalHandoff.ready && blockedReasons.length === 0;

    return {
      schema: 'aios.syscall-layer.verifier-run.provider-handoff-outbox-entry.v1',
      sequence: index + 1,
      outboxId: `${proofId}:handoff:${contract.providerId}`,
      providerId: contract.providerId,
      service: contract.service,
      type: contract.type,
      routeKey: canExposeRoute ? contract.handoff.routeKey : null,
      target: canExposeRoute ? contract.handoff.target : null,
      payloadRef: contract.handoff.payloadRef,
      isolationKey: contract.handoff.isolationKey,
      auditSubject: accessBoundary.partitions.auditSubject,
      correlationId: canExposeRoute ? contract.handoff.correlationId ?? `${proofId}:${contract.providerId}` : null,
      dispatchable,
      status: dispatchable
        ? 'ready-to-dispatch'
        : contract.deliveryState === 'pending-ack'
          ? 'waiting-for-ack'
          : 'blocked',
      blockedReasons: [...new Set(blockedReasons)],
      exposure: {
        routeVisible: canExposeRoute,
        redactionReasons: canExposeRoute
          ? []
          : [
            ...(!accessBoundary.handoffPolicy.canExportAudit ? ['audit-export-not-authorized'] : []),
            ...(contract.blockedReasons.includes('provider-scope-mismatch') ? ['provider-scope-mismatch'] : [])
          ],
        routeRedacted: !canExposeRoute && Boolean(contract.handoff.routeKey),
        targetRedacted: !canExposeRoute && Boolean(contract.handoff.target)
      },
      requiredAck: contract.sync.ackRequired,
      acked: syncCursor?.acknowledged === true,
      sync: {
        direction: contract.sync.direction,
        cursor: contract.sync.cursor,
        watermark: contract.sync.watermark,
        revision: contract.sync.revision,
        lagMs: contract.sync.syncLagMs
      },
      lease: {
        key: `${accessBoundary.partitions.storageKey}/handoff/${contract.providerId}`,
        acquireAfter: now,
        expiresAt: contract.sync.ackRequired ? null : new Date(Date.parse(now) + DEFAULT_SCHEDULE_INTERVAL_MS).toISOString(),
        conflictPolicy: 'single-flight-provider-dispatch'
      }
    };
  });
  const dispatchableEntries = outbox.filter((entry) => entry.dispatchable);
  const ackWaitlist = outbox
    .filter((entry) => entry.requiredAck && !entry.acked)
    .map((entry) => ({
      providerId: entry.providerId,
      outboxId: entry.outboxId,
      routeKey: entry.routeKey,
      payloadRef: entry.payloadRef,
      cursor: entry.sync.cursor,
      watermark: entry.sync.watermark
    }));

  return {
    schema: 'aios.syscall-layer.verifier-run.provider-handoff-dispatch.v1',
    generatedAt: now,
    proofId,
    enabled: enabledContracts.length > 0,
    ready: enabledContracts.length > 0 && dispatchableEntries.length === enabledContracts.length,
    status: enabledContracts.length === 0
      ? 'not-configured'
      : dispatchableEntries.length === enabledContracts.length
        ? 'ready'
        : dispatchableEntries.length > 0
          ? 'partial'
          : 'blocked',
    dispatchableCount: dispatchableEntries.length,
    blockedCount: outbox.length - dispatchableEntries.length,
    ackWaitCount: ackWaitlist.length,
    dispatchableProviderIds: dispatchableEntries.map((entry) => entry.providerId),
    blockedProviderIds: outbox.filter((entry) => !entry.dispatchable).map((entry) => entry.providerId),
    ackWaitlist,
    outbox
  };
}

function buildBoundaryDecision({ accessBoundary, validation, externalHandoff, handoffDispatch, providerServiceContracts, clientRuntime, proofId, now }) {
  const providerScopeMismatches = new Set(accessBoundary.providerScopeMismatches.map((entry) => entry.providerId));
  const redactedHandoffTargets = externalHandoff.targets.filter((target) => target.exposure.allowed === false);
  const blockedOutboxEntries = handoffDispatch.outbox.filter((entry) => !entry.dispatchable);
  const denyReasons = [
    ...validation.errors
      .filter((error) => error.code === 'permission_denied' || error.code === 'unknown_actor_role' || error.code === 'provider_scope_mismatch')
      .map((error) => error.code),
    ...accessBoundary.missingPermissions.map((permission) => `missing-permission:${permission}`),
    ...(providerScopeMismatches.size > 0 ? ['provider-scope-mismatch'] : []),
    ...(redactedHandoffTargets.length > 0 ? ['handoff-target-redacted'] : [])
  ];
  const providerDecisions = providerServiceContracts.contracts.map((contract) => ({
    providerId: contract.providerId,
    invocationMode: contract.invocationMode,
    deliveryState: contract.deliveryState,
    scopeMatched: !providerScopeMismatches.has(contract.providerId),
    canDispatch: handoffDispatch.dispatchableProviderIds.includes(contract.providerId),
    targetVisible: handoffDispatch.outbox.find((entry) => entry.providerId === contract.providerId)?.exposure.routeVisible ?? false,
    blockedReasons: [
      ...contract.blockedReasons,
      ...(blockedOutboxEntries.find((entry) => entry.providerId === contract.providerId)?.blockedReasons ?? [])
    ]
  }));

  return {
    schema: 'aios.syscall-layer.verifier-run.boundary-decision.v1',
    generatedAt: now,
    proofId,
    decision: accessBoundary.authorized && denyReasons.length === 0 ? 'allow' : 'deny',
    authorized: accessBoundary.authorized,
    denyReasons: [...new Set(denyReasons)],
    scope: {
      mode: accessBoundary.mode,
      strictScoped: accessBoundary.strictScoped,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      isolationKey: accessBoundary.partitions.isolationKey,
      storageKey: accessBoundary.partitions.storageKey,
      proofNamespace: accessBoundary.partitions.proofNamespace
    },
    actor: {
      id: accessBoundary.actor.id,
      role: accessBoundary.actor.role,
      roleKnown: accessBoundary.actor.roleKnown,
      effectivePermissions: accessBoundary.actor.effectivePermissions,
      missingPermissions: accessBoundary.missingPermissions
    },
    handoff: {
      exportAllowed: accessBoundary.handoffPolicy.canExportAudit,
      proofEmitAllowed: accessBoundary.handoffPolicy.canEmitProof,
      evidenceIngestAllowed: accessBoundary.handoffPolicy.canIngestEvidence,
      externalHandoffReady: externalHandoff.ready,
      dispatchStatus: handoffDispatch.status,
      redactedTargetCount: redactedHandoffTargets.length,
      dispatchableProviderIds: handoffDispatch.dispatchableProviderIds,
      blockedProviderIds: handoffDispatch.blockedProviderIds
    },
    client: {
      requestId: clientRuntime.request.id,
      traceId: clientRuntime.request.traceId,
      channel: clientRuntime.client.channel,
      workflowRequested: clientRuntime.workflow.requested
    },
    providerDecisions
  };
}

function buildProofBundle({ proofId, evidence, providers, validation, health, accessBoundary, sync, externalHandoff, handoffDispatch, boundaryDecision, lifecycle, commandStatus, recovery, stateTransition, operationalResponse, operationalIncidentPlan, providerServiceContracts, previewAcceptance, now }) {
  const evidenceLedger = buildEvidenceLedger({ evidence, proofId, accessBoundary, now });
  const evidenceWithoutDigest = evidenceLedger.filter((entry) => !entry.digestPresent);
  const exportableEvidence = evidenceLedger.filter((entry) => entry.exportable);
  const providerCommitments = providers.map((provider) => ({
    providerId: provider.id,
    type: provider.type,
    service: provider.service,
    endpoint: provider.endpoint,
    tenantId: provider.tenantId ?? accessBoundary.tenantId,
    workspaceId: provider.workspaceId ?? accessBoundary.workspaceId,
    capabilities: provider.capabilities,
    cursor: provider.sync.cursor,
    watermark: provider.sync.watermark,
    revision: provider.sync.revision,
    acknowledged: provider.sync.acknowledgedProofId === proofId,
    handoffEnabled: provider.handoff.enabled,
    handoffTarget: provider.handoff.target,
    healthStatus: provider.health.status,
    critical: provider.health.critical
  }));
  const exportBlockedReasons = [
    ...(!validation.ok ? ['validation-errors'] : []),
    ...(health === 'failed' ? ['failed-health-state'] : []),
    ...(!accessBoundary.handoffPolicy.canExportAudit ? ['audit-export-permission-missing'] : []),
    ...(evidence.length > 0 && evidenceWithoutDigest.length === evidence.length ? ['evidence-digests-missing'] : []),
    ...(externalHandoff.enabled && !externalHandoff.ready ? ['provider-handoff-blocked'] : [])
  ];
  const verificationStages = [
    {
      name: 'input-contract',
      status: validation.ok ? 'passed' : 'failed',
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length
    },
    {
      name: 'access-boundary',
      status: accessBoundary.authorized ? 'passed' : 'failed',
      isolationKey: accessBoundary.partitions.isolationKey,
      missingPermissions: accessBoundary.missingPermissions
    },
    {
      name: 'evidence-ledger',
      status: evidenceWithoutDigest.length === 0 ? 'passed' : evidence.length === 0 ? 'empty' : 'partial',
      evidenceCount: evidenceLedger.length,
      digestCount: evidenceLedger.length - evidenceWithoutDigest.length,
      exportableCount: exportableEvidence.length
    },
    {
      name: 'provider-sync',
      status: sync.pendingAckCount === 0 ? 'passed' : 'pending-ack',
      activeProviderCount: sync.activeProviderCount,
      pendingAckCount: sync.pendingAckCount
    },
    {
      name: 'provider-service-contracts',
      status: providerServiceContracts.missingInvokableCapabilities.length === 0
        ? 'passed'
        : 'handoff-unavailable',
      invokableProviderCount: providerServiceContracts.contracts.filter((contract) => contract.invocationMode === 'invoke').length,
      missingInvokableCapabilities: providerServiceContracts.missingInvokableCapabilities
    },
    {
      name: 'provider-handoff-dispatch',
      status: !handoffDispatch.enabled
        ? 'not-configured'
        : handoffDispatch.ready
          ? 'ready'
          : handoffDispatch.status,
      dispatchableCount: handoffDispatch.dispatchableCount,
      blockedCount: handoffDispatch.blockedCount,
      ackWaitCount: handoffDispatch.ackWaitCount
    },
    {
      name: 'lifecycle-controls',
      status: lifecycle.commandPlan.accepted
        ? lifecycle.transition.activeRunInterrupted
          ? 'accepted-recovery-required'
          : lifecycle.commandPlan.persistenceRequired
            ? 'write-ready'
            : 'no-op'
        : 'rejected',
      command: lifecycle.command,
      commandResult: lifecycle.transition.commandResult,
      previousState: lifecycle.transition.previousState,
      nextState: lifecycle.transition.nextState,
      controlReasons: lifecycle.controlReasons
    },
    {
      name: 'preview-acceptance',
      status: previewAcceptance.acceptance.accepted
        ? 'accepted'
        : previewAcceptance.acceptance.blocked
          ? 'blocked'
          : 'preview',
      decision: previewAcceptance.acceptance.decision,
      readinessScore: previewAcceptance.readiness.score,
      blockingCount: previewAcceptance.acceptance.blockingReasons.length
    },
    {
      name: 'recovery-policy',
      status: recovery.restartSafe ? 'passed' : 'operator-required',
      recoveryStatus: recovery.status,
      action: recovery.action
    },
    {
      name: 'persisted-state-transition',
      status: stateTransition.writeDisposition === 'blocked'
        ? 'blocked'
        : stateTransition.writeDisposition === 'idempotent-noop'
          ? 'idempotent'
          : 'write-ready',
      writeDisposition: stateTransition.writeDisposition,
      expectedRevision: stateTransition.expectedRevision,
      nextRevision: stateTransition.nextRevision,
      restartStatus: stateTransition.restartStatus.status
    },
    {
      name: 'operational-incident-plan',
      status: operationalIncidentPlan.status,
      incidentCount: operationalIncidentPlan.incidentCount,
      blockingIncidentCount: operationalIncidentPlan.blockingIncidentCount,
      retryableIncidentCount: operationalIncidentPlan.retryableIncidentCount,
      nextOperatorAction: operationalIncidentPlan.nextOperatorAction
    }
  ];

  return {
    schema: 'aios.syscall-layer.verifier-run.proof-bundle.v1',
    generatedAt: now,
    proofId,
    proofType: 'hosted-kernel-verifier-run',
    healthState: health,
    ok: validation.ok && health !== 'failed',
    exportReady: exportBlockedReasons.length === 0,
    exportBlockedReasons,
    evidenceLedger,
    evidenceSummary: {
      total: evidenceLedger.length,
      withDigest: evidenceLedger.length - evidenceWithoutDigest.length,
      withoutDigest: evidenceWithoutDigest.length,
      exportable: exportableEvidence.length,
      redacted: evidenceLedger.filter((entry) => entry.redacted).length,
      bySeverity: countBy(evidenceLedger, (entry) => entry.severity),
      byRetentionClass: countBy(evidenceLedger, (entry) => entry.retentionClass)
    },
    providerCommitments,
    providerServiceContracts,
    handoffDispatch,
    boundaryDecision,
    verificationStages,
    auditEnvelope: {
      subject: accessBoundary.partitions.auditSubject,
      isolationKey: accessBoundary.partitions.isolationKey,
      storageKey: accessBoundary.partitions.storageKey,
      proofNamespace: accessBoundary.partitions.proofNamespace,
      boundaryDecision: boundaryDecision.decision,
      boundaryDenyReasons: boundaryDecision.denyReasons,
      boundaryRedactedTargetCount: boundaryDecision.handoff.redactedTargetCount,
      lifecycleCommand: lifecycle.command,
      lifecycleNextAction: lifecycle.nextAction,
      lifecycleCommandResult: lifecycle.transition.commandResult,
      lifecycleWriteIntent: lifecycle.transition.writeIntent,
      lifecyclePreviousState: lifecycle.transition.previousState,
      lifecycleNextState: lifecycle.transition.nextState,
      lifecycleControlReasons: lifecycle.controlReasons,
      commandId: commandStatus.commandId,
      commandEffect: commandStatus.effect,
      recoveryStatus: recovery.status,
      stateWriteDisposition: stateTransition.writeDisposition,
      stateRestartStatus: stateTransition.restartStatus.status,
      stateNextRevision: stateTransition.nextRevision,
      operationalFailureState: operationalResponse.failureState,
      operationalNextAction: operationalResponse.nextAction,
      operationalIncidentStatus: operationalIncidentPlan.status,
      operationalIncidentCount: operationalIncidentPlan.incidentCount,
      operationalBlockingIncidentCount: operationalIncidentPlan.blockingIncidentCount,
      operationalNextOperatorAction: operationalIncidentPlan.nextOperatorAction,
      previewDecision: previewAcceptance.acceptance.decision,
      previewAccepted: previewAcceptance.acceptance.accepted,
      previewReadinessScore: previewAcceptance.readiness.score
    }
  };
}

function buildClientWorkflowHandoff({
  clientRuntime,
  externalHandoff,
  handoffDispatch,
  lifecycle,
  recovery,
  validation,
  health,
  operationalResponse,
  operationalIncidentPlan,
  proofId,
  accessBoundary,
  now
}) {
  const requested = clientRuntime.workflow.requested;
  const blockedReasons = [];
  const blockingIncidents = operationalIncidentPlan.incidents.filter((incident) => incident.blocking);
  const retryAt = operationalResponse.retry.retryAt ?? blockingIncidents.find((incident) => incident.retry.retryAt)?.retry.retryAt ?? null;

  if (!validation.ok) {
    blockedReasons.push('validation-errors');
  }

  if (health === 'failed' && clientRuntime.workflow.intent !== 'escalate') {
    blockedReasons.push('failed-run-requires-escalation-intent');
  }

  if (externalHandoff.enabled && !externalHandoff.ready) {
    blockedReasons.push('provider-handoff-blocked');
  }

  if (operationalIncidentPlan.status === 'blocked') {
    blockedReasons.push('operational-incidents-blocked');
  }

  const status = !requested
    ? 'not-requested'
    : blockedReasons.length > 0
      ? 'blocked'
      : health === 'failed'
        ? 'escalate'
        : lifecycle.controls.canRunNow
          ? 'ready'
          : 'waiting';
  const destination = clientRuntime.workflow.returnTo
    ? { type: 'client-route', target: clientRuntime.workflow.returnTo }
    : clientRuntime.workflow.queue
      ? { type: 'workflow-queue', target: clientRuntime.workflow.queue }
      : { type: 'none', target: null };
  const deliveryMode = destination.type === 'workflow-queue'
    ? 'queue'
    : destination.type === 'client-route'
      ? 'client-callback'
      : 'inline-only';
  const clientAction = status === 'blocked'
    ? operationalIncidentPlan.nextOperatorAction
    : status === 'escalate'
      ? 'open-incident-handoff'
      : status === 'ready'
        ? lifecycle.controls.canRunNow ? 'continue-verifier-run' : lifecycle.nextAction
        : status === 'waiting'
          ? lifecycle.nextAction
          : 'observe-inline-result';
  const incidentHandoff = blockingIncidents[0] ?? operationalIncidentPlan.incidents[0] ?? null;
  const providerAckWaitlist = handoffDispatch.ackWaitlist.map((entry) => ({
    providerId: entry.providerId,
    outboxId: entry.outboxId,
    routeKey: entry.routeKey,
    payloadRef: entry.payloadRef,
    watermark: entry.watermark
  }));
  const handoffRef = `${proofId}:client-workflow`;
  const resumeToken = [
    clientRuntime.request.id ?? 'request:untracked',
    clientRuntime.client.sessionId ?? 'session:headless',
    proofId,
    recovery.status
  ].join('|');
  const ackRequired = Boolean(clientRuntime.workflow.ackToken || providerAckWaitlist.length > 0 || deliveryMode === 'queue');
  const clientStatePatch = {
    stateKey: clientRuntime.stateKey,
    proofId,
    status,
    health,
    lifecycleNextAction: lifecycle.nextAction,
    operationalNextAction: operationalResponse.nextAction,
    recoveryStatus: recovery.status,
    retryAt,
    providerAckWaitCount: providerAckWaitlist.length,
    updatedAt: now
  };

  return {
    schema: 'aios.syscall-layer.verifier-run.workflow-handoff.v1',
    generatedAt: now,
    proofId,
    handoffRef,
    requestId: clientRuntime.request.id,
    traceId: clientRuntime.request.traceId,
    correlationId: clientRuntime.request.correlationId,
    channel: clientRuntime.client.channel,
    sessionId: clientRuntime.client.sessionId,
    requested,
    status,
    ready: requested && blockedReasons.length === 0,
    blockedReasons,
    intent: clientRuntime.workflow.intent,
    destination,
    delivery: {
      mode: deliveryMode,
      dispatchStatus: handoffDispatch.status,
      dispatchableProviderIds: handoffDispatch.dispatchableProviderIds,
      blockedProviderIds: handoffDispatch.blockedProviderIds,
      providerAckWaitlist,
      ackRequired,
      ackToken: clientRuntime.workflow.ackToken,
      retryAt
    },
    clientAction: {
      action: clientAction,
      route: incidentHandoff?.runbook.route ?? destination.target,
      retryAt,
      proofRef: proofId,
      resumeToken,
      requiresOperator: blockedReasons.length > 0 || operationalIncidentPlan.blockingIncidentCount > 0,
      incidentId: incidentHandoff?.id ?? null,
      message: incidentHandoff?.operatorMessage ?? null
    },
    display: {
      label: clientRuntime.workflow.label,
      state: health,
      nextAction: lifecycle.nextAction,
      recoveryStatus: recovery.status,
      providerHandoffReady: externalHandoff.ready,
      operationalStatus: operationalIncidentPlan.status,
      providerAckWaitCount: providerAckWaitlist.length
    },
    persistAs: {
      ...clientStatePatch,
      requestId: clientRuntime.request.id,
      acceptedAt: now,
      destination,
      deliveryMode,
      handoffRef,
      resumeToken,
      ackRequired,
      isolationKey: accessBoundary.partitions.isolationKey,
      auditSubject: accessBoundary.partitions.auditSubject
    },
    statePatch: clientStatePatch,
    notifyOn: clientRuntime.workflow.notifyOn
  };
}

function determineHealth({ requestedState, validation, failures, degradedMode, operationalHealth }) {
  const terminalFailure = failures.some((failure) => failure.terminal || !failure.retryable);

  if (!validation.ok || terminalFailure) {
    return 'failed';
  }

  if (degradedMode || operationalHealth.degraded || failures.length > 0 || validation.warnings.length > 0) {
    return 'degraded';
  }

  if (HEALTH_STATES.has(requestedState)) {
    return requestedState;
  }

  return 'healthy';
}

function countBy(items, selectKey) {
  return items.reduce((counts, item) => {
    const key = selectKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function computeCurrentStreak(runs, predicate) {
  let streak = 0;

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (!predicate(runs[index])) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function normalizeReportingOptions(input) {
  const reporting = normalizeObject(input.reporting ?? input.analyticsReporting ?? input.exportReporting);
  const requestedExportMode = normalizeString(reporting.exportMode ?? input.exportMode, 'summary');
  const lookbackMs = Math.max(1, asNonNegativeInteger(
    reporting.lookbackMs ?? input.reportingLookbackMs,
    DEFAULT_REPORTING_LOOKBACK_MS
  ));
  const successRatioTarget = Math.min(1, Math.max(0, Number.isFinite(reporting.successRatioTarget)
    ? reporting.successRatioTarget
    : DEFAULT_SUCCESS_RATIO_TARGET));
  const maxFailureStreak = Math.max(0, asNonNegativeInteger(
    reporting.maxFailureStreak ?? input.maxFailureStreak,
    DEFAULT_MAX_FAILURE_STREAK
  ));

  return {
    schema: 'aios.syscall-layer.verifier-run.reporting-options.v1',
    exportMode: REPORT_EXPORT_MODES.has(requestedExportMode) ? requestedExportMode : 'summary',
    requestedExportMode,
    lookbackMs,
    successRatioTarget,
    maxFailureStreak,
    includeTimeline: normalizeBoolean(reporting.includeTimeline ?? input.includeTimeline, true),
    includeEvidenceLedger: normalizeBoolean(
      reporting.includeEvidenceLedger ?? input.includeEvidenceLedger,
      requestedExportMode === 'evidence-ledger'
    )
  };
}

function dayBucket(timestamp) {
  return asIsoTimestamp(timestamp).slice(0, 10);
}

function buildBucketedHistory(runs) {
  const buckets = new Map();

  for (const entry of runs) {
    const bucketId = dayBucket(entry.checkedAt);
    const bucket = buckets.get(bucketId) ?? {
      bucket: bucketId,
      snapshotCount: 0,
      failedRuns: 0,
      degradedRuns: 0,
      healthyRuns: 0,
      evidenceCount: 0,
      failureCount: 0,
      pendingProviderAcks: 0,
      durationTotalMs: 0,
      measuredRuns: 0,
      firstProofId: null,
      lastProofId: null
    };

    bucket.snapshotCount += 1;
    bucket.failedRuns += entry.state === 'failed' ? 1 : 0;
    bucket.degradedRuns += entry.state === 'degraded' ? 1 : 0;
    bucket.healthyRuns += entry.state === 'healthy' ? 1 : 0;
    bucket.evidenceCount += entry.evidenceCount;
    bucket.failureCount += entry.failureCount;
    bucket.pendingProviderAcks += entry.providerAckPendingCount ?? 0;
    bucket.firstProofId ??= entry.proofId;
    bucket.lastProofId = entry.proofId;

    if (Number.isInteger(entry.durationMs)) {
      bucket.durationTotalMs += entry.durationMs;
      bucket.measuredRuns += 1;
    }

    buckets.set(bucketId, bucket);
  }

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    averageDurationMs: bucket.measuredRuns > 0
      ? Math.round(bucket.durationTotalMs / bucket.measuredRuns)
      : null,
    successRatio: bucket.snapshotCount > 0
      ? Number(((bucket.snapshotCount - bucket.failedRuns) / bucket.snapshotCount).toFixed(4))
      : 1
  }));
}

function buildSnapshotDelta(current, previous) {
  if (!previous) {
    return {
      baseline: 'none',
      stateChanged: false,
      stateTransition: null,
      evidenceDelta: current.evidenceCount,
      failureDelta: current.failureCount,
      durationDeltaMs: current.durationMs,
      providerAckDelta: current.providerAckPendingCount,
      recovered: false,
      regressed: current.state === 'failed'
    };
  }

  return {
    baseline: previous.proofId ?? previous.id,
    stateChanged: previous.state !== current.state,
    stateTransition: previous.state === current.state ? null : `${previous.state}->${current.state}`,
    evidenceDelta: current.evidenceCount - previous.evidenceCount,
    failureDelta: current.failureCount - previous.failureCount,
    durationDeltaMs: Number.isInteger(current.durationMs) && Number.isInteger(previous.durationMs)
      ? current.durationMs - previous.durationMs
      : null,
    providerAckDelta: current.providerAckPendingCount - previous.providerAckPendingCount,
    recovered: previous.state === 'failed' && current.state !== 'failed',
    regressed: previous.state !== 'failed' && current.state === 'failed'
  };
}

function buildAnalytics({ current, history, reportingOptions }) {
  const runs = [...history, current];
  const failedRuns = runs.filter((entry) => entry.state === 'failed').length;
  const degradedRuns = runs.filter((entry) => entry.state === 'degraded').length;
  const retryableRuns = runs.filter((entry) => entry.retryAllowed).length;
  const failureCodes = runs.flatMap((entry) => entry.failureCodes);
  const latestFailureCode = current.failureCodes[0] ?? history.at(-1)?.failureCodes?.[0] ?? null;
  const durations = runs
    .map((entry) => entry.durationMs)
    .filter((durationMs) => Number.isInteger(durationMs));
  const evidenceTotal = runs.reduce((total, entry) => total + entry.evidenceCount, 0);
  const failureTotal = runs.reduce((total, entry) => total + entry.failureCount, 0);
  const pendingProviderAcks = runs.reduce((total, entry) => total + (entry.providerAckPendingCount ?? 0), 0);
  const oldestSnapshotAt = runs[0]?.checkedAt ?? null;
  const newestSnapshotAt = runs.at(-1)?.checkedAt ?? null;
  const previous = history.at(-1) ?? null;
  const currentFailureStreak = computeCurrentStreak(runs, (entry) => entry.state === 'failed');
  const currentOkStreak = computeCurrentStreak(runs, (entry) => entry.ok && entry.state !== 'failed');
  const successRatio = runs.length === 0 ? 1 : Number(((runs.length - failedRuns) / runs.length).toFixed(4));
  const buckets = buildBucketedHistory(runs);
  const exportableSnapshots = runs.filter((entry) => entry.proofId && entry.operationalReady !== false);
  const snapshotsWithPendingAcks = runs.filter((entry) => (entry.providerAckPendingCount ?? 0) > 0);
  const currentDelta = buildSnapshotDelta(current, previous);
  const sloStatus = successRatio >= reportingOptions.successRatioTarget && currentFailureStreak <= reportingOptions.maxFailureStreak
    ? 'within-target'
    : currentFailureStreak > reportingOptions.maxFailureStreak
      ? 'failure-streak-breach'
      : 'success-ratio-breach';

  return {
    schema: 'aios.syscall-layer.verifier-run.analytics.v1',
    counters: {
      totalSnapshots: runs.length,
      historySnapshots: history.length,
      currentEvidenceCount: current.evidenceCount,
      currentFailureCount: current.failureCount,
      failedRuns,
      degradedRuns,
      healthyRuns: runs.length - failedRuns - degradedRuns,
      retryableRuns,
      terminalRuns: runs.filter((entry) => entry.failureCount > 0 && !entry.retryAllowed).length,
      evidenceDigestCount: current.evidenceDigestCount,
      evidenceTotal,
      failureTotal,
      pendingProviderAcks,
      operationallyBlockedRuns: runs.filter((entry) => entry.operationalReady === false).length
    },
    failureCodeCounts: countBy(failureCodes, (code) => code),
    healthStateCounts: countBy(runs, (entry) => entry.state),
    dailyBuckets: buckets,
    currentDelta,
    exportReadiness: {
      mode: reportingOptions.exportMode,
      exportableSnapshots: exportableSnapshots.length,
      snapshotsMissingProof: runs.length - runs.filter((entry) => entry.proofId).length,
      snapshotsWithPendingAcks: snapshotsWithPendingAcks.length,
      evidenceLedgerIncluded: reportingOptions.includeEvidenceLedger,
      timelineIncluded: reportingOptions.includeTimeline
    },
    latestFailureCode,
    window: {
      oldestSnapshotAt,
      newestSnapshotAt,
      durationMs: oldestSnapshotAt && newestSnapshotAt
        ? Math.max(0, Date.parse(newestSnapshotAt) - Date.parse(oldestSnapshotAt))
        : 0,
      currentFailureStreak,
      currentOkStreak
    },
    performance: {
      averageDurationMs: durations.length > 0
        ? Math.round(durations.reduce((total, durationMs) => total + durationMs, 0) / durations.length)
        : null,
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : null,
      measuredRuns: durations.length,
      evidencePerSnapshot: runs.length > 0 ? Number((evidenceTotal / runs.length).toFixed(4)) : 0,
      failuresPerSnapshot: runs.length > 0 ? Number((failureTotal / runs.length).toFixed(4)) : 0
    },
    reliability: {
      successRatio,
      degradedRatio: runs.length === 0 ? 0 : Number((degradedRuns / runs.length).toFixed(4)),
      retryPressure: retryableRuns > 0 ? 'active' : failedRuns > 0 ? 'operator' : 'none',
      slo: {
        targetSuccessRatio: reportingOptions.successRatioTarget,
        maxFailureStreak: reportingOptions.maxFailureStreak,
        status: sloStatus,
        withinTarget: sloStatus === 'within-target'
      },
      trend: !previous
        ? 'new-run'
        : previous.state === current.state
          ? 'unchanged'
          : previous.state === 'failed' && current.state !== 'failed'
            ? 'recovering'
            : current.state === 'failed'
              ? 'regressing'
              : current.state === 'degraded'
                ? 'degrading'
                : 'improving'
    }
  };
}

function buildTimeline({ current, history }) {
  const snapshots = [...history, current];
  const bucketSequences = {};

  return snapshots.map((entry, index) => {
    const previous = snapshots[index - 1] ?? null;
    const bucket = dayBucket(entry.checkedAt);
    bucketSequences[bucket] = (bucketSequences[bucket] ?? 0) + 1;
    const transition = previous && previous.state !== entry.state
      ? `${previous.state}->${entry.state}`
      : 'none';

    return {
      sequence: index + 1,
      bucket,
      bucketSequence: bucketSequences[bucket],
      at: entry.checkedAt,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      durationMs: entry.durationMs,
      state: entry.state,
      previousState: previous?.state ?? null,
      transition,
      ok: entry.ok,
      failureCount: entry.failureCount,
      evidenceCount: entry.evidenceCount,
      evidenceDigestCount: entry.evidenceDigestCount,
      providerAckPendingCount: entry.providerAckPendingCount,
      operationalReady: entry.operationalReady,
      retryAllowed: entry.retryAllowed,
      lifecycleNextAction: entry.lifecycleNextAction,
      recoveryStatus: entry.recoveryStatus,
      proofId: entry.proofId,
      exportEligible: Boolean(entry.proofId) && entry.operationalReady !== false,
      severity: entry.state === 'failed'
        ? 'error'
        : entry.state === 'degraded' || entry.providerAckPendingCount > 0 || entry.operationalReady === false
          ? 'warning'
          : 'info',
      event: entry.failureCount > 0
        ? 'verifier-run-failure-observed'
        : entry.state === 'degraded'
          ? 'verifier-run-degraded'
          : transition !== 'none'
            ? 'verifier-run-state-transition'
            : 'verifier-run-healthy'
    };
  });
}

function estimateJsonBytes(value) {
  return JSON.stringify(value).length;
}

function buildHistorySnapshotArchive({ history, current, timeline, analytics, proofId, now, accessBoundary }) {
  const snapshots = [...history, current];
  const timelineByProofId = new Map(
    timeline
      .filter((event) => event.proofId)
      .map((event) => [event.proofId, event])
  );

  return snapshots.map((snapshot, index) => {
    const timelineEvent = timelineByProofId.get(snapshot.proofId) ?? timeline[index] ?? null;
    const retention = snapshot.state === 'failed' || snapshot.operationalReady === false
      ? 'audit'
      : snapshot.evidenceDigestCount > 0
        ? 'run'
        : 'ephemeral';
    const exportBlockedReasons = [
      ...(!snapshot.proofId ? ['proof-id-missing'] : []),
      ...(snapshot.operationalReady === false ? ['operational-health-not-ready'] : []),
      ...(snapshot.providerAckPendingCount > 0 ? ['provider-ack-pending'] : []),
      ...(snapshot.evidenceCount > 0 && snapshot.evidenceDigestCount === 0 ? ['evidence-digests-missing'] : [])
    ];

    return {
      schema: 'aios.syscall-layer.verifier-run.history-snapshot.v1',
      sequence: index + 1,
      archiveId: `${proofId}:history:${index + 1}`,
      proofId: snapshot.proofId,
      checkedAt: snapshot.checkedAt,
      bucket: timelineEvent?.bucket ?? dayBucket(snapshot.checkedAt),
      state: snapshot.state,
      ok: snapshot.ok,
      retention,
      exportEligible: exportBlockedReasons.length === 0,
      exportBlockedReasons,
      counters: {
        failureCount: snapshot.failureCount,
        evidenceCount: snapshot.evidenceCount,
        evidenceDigestCount: snapshot.evidenceDigestCount,
        providerAckPendingCount: snapshot.providerAckPendingCount
      },
      timeline: {
        sequence: timelineEvent?.sequence ?? index + 1,
        event: timelineEvent?.event ?? 'verifier-run-snapshot',
        transition: timelineEvent?.transition ?? null,
        severity: timelineEvent?.severity ?? 'info'
      },
      auditRef: {
        isolationKey: accessBoundary.partitions.isolationKey,
        proofNamespace: accessBoundary.partitions.proofNamespace,
        storageKey: `${accessBoundary.partitions.storageKey}/history/${snapshot.proofId ?? `snapshot-${index + 1}`}`
      },
      reliabilityAtSnapshot: {
        trend: index === snapshots.length - 1 ? analytics.reliability.trend : 'historical',
        currentFailureStreak: index === snapshots.length - 1 ? analytics.window.currentFailureStreak : null,
        currentOkStreak: index === snapshots.length - 1 ? analytics.window.currentOkStreak : null
      }
    };
  });
}

function buildExportManifest({ exportSummary, proofBundle, reportingOptions, historyArchive, timeline, analytics, accessBoundary, proofId, now }) {
  const timelineCriticalEvents = timeline.filter((event) => event.severity !== 'info');
  const exportableSnapshots = historyArchive.filter((snapshot) => snapshot.exportEligible);
  const blockedSnapshots = historyArchive.filter((snapshot) => !snapshot.exportEligible);
  const includedSections = [
    {
      id: 'summary',
      schema: exportSummary.schema,
      included: true,
      recordCount: 1,
      estimatedBytes: estimateJsonBytes(exportSummary),
      contentRef: `${proofId}:export:summary`
    },
    {
      id: 'counters',
      schema: analytics.schema,
      included: true,
      recordCount: Object.keys(analytics.counters).length,
      estimatedBytes: estimateJsonBytes(analytics.counters),
      contentRef: `${proofId}:export:counters`
    },
    {
      id: 'history-snapshots',
      schema: 'aios.syscall-layer.verifier-run.history-snapshot.v1',
      included: true,
      recordCount: historyArchive.length,
      exportableRecordCount: exportableSnapshots.length,
      blockedRecordCount: blockedSnapshots.length,
      estimatedBytes: estimateJsonBytes(historyArchive),
      contentRef: `${proofId}:export:history`
    },
    {
      id: 'timeline',
      schema: 'aios.syscall-layer.verifier-run.timeline.v1',
      included: reportingOptions.includeTimeline,
      recordCount: reportingOptions.includeTimeline ? timeline.length : 0,
      criticalRecordCount: timelineCriticalEvents.length,
      estimatedBytes: reportingOptions.includeTimeline ? estimateJsonBytes(timeline) : 0,
      contentRef: reportingOptions.includeTimeline ? `${proofId}:export:timeline` : null
    },
    {
      id: 'evidence-ledger',
      schema: 'aios.syscall-layer.verifier-run.evidence-ledger.v1',
      included: reportingOptions.includeEvidenceLedger,
      recordCount: reportingOptions.includeEvidenceLedger ? proofBundle.evidenceLedger.length : 0,
      exportableRecordCount: reportingOptions.includeEvidenceLedger ? proofBundle.evidenceSummary.exportable : 0,
      estimatedBytes: reportingOptions.includeEvidenceLedger ? estimateJsonBytes(proofBundle.evidenceLedger) : 0,
      contentRef: reportingOptions.includeEvidenceLedger ? `${proofId}:export:evidence-ledger` : null
    },
    {
      id: 'proof-bundle',
      schema: proofBundle.schema,
      included: reportingOptions.exportMode !== 'summary',
      recordCount: reportingOptions.exportMode !== 'summary' ? 1 : 0,
      estimatedBytes: reportingOptions.exportMode !== 'summary' ? estimateJsonBytes(proofBundle) : 0,
      contentRef: reportingOptions.exportMode !== 'summary' ? `${proofId}:export:proof-bundle` : null
    },
    {
      id: 'provider-handoff-dispatch',
      schema: proofBundle.handoffDispatch.schema,
      included: proofBundle.handoffDispatch.enabled,
      recordCount: proofBundle.handoffDispatch.enabled ? proofBundle.handoffDispatch.outbox.length : 0,
      estimatedBytes: proofBundle.handoffDispatch.enabled ? estimateJsonBytes(proofBundle.handoffDispatch) : 0,
      contentRef: proofBundle.handoffDispatch.enabled ? `${proofId}:export:provider-handoff-dispatch` : null
    }
  ];
  const activeSections = includedSections.filter((section) => section.included);
  const blockedReasons = [
    ...exportSummary.exportBlockedReasons,
    ...(blockedSnapshots.length > 0 ? ['history-snapshot-export-blocked'] : []),
    ...(proofBundle.exportReady ? [] : proofBundle.exportBlockedReasons.map((reason) => `proof-bundle:${reason}`))
  ];

  return {
    schema: 'aios.syscall-layer.verifier-run.export-manifest.v1',
    manifestId: `${proofId}:export-manifest`,
    generatedAt: now,
    proofId,
    mode: reportingOptions.exportMode,
    ready: blockedReasons.length === 0,
    blockedReasons: [...new Set(blockedReasons)],
    destination: {
      scope: accessBoundary.scoped ? 'workspace' : 'global',
      isolationKey: accessBoundary.partitions.isolationKey,
      proofNamespace: accessBoundary.partitions.proofNamespace,
      auditSubject: accessBoundary.partitions.auditSubject
    },
    totals: {
      sectionCount: activeSections.length,
      recordCount: activeSections.reduce((total, section) => total + section.recordCount, 0),
      estimatedBytes: activeSections.reduce((total, section) => total + section.estimatedBytes, 0),
      exportableSnapshots: exportableSnapshots.length,
      blockedSnapshots: blockedSnapshots.length,
      criticalTimelineEvents: timelineCriticalEvents.length
    },
    sections: includedSections,
    publishState: {
      status: blockedReasons.length === 0 ? 'ready-to-publish' : 'blocked',
      nextAction: blockedReasons.length === 0
        ? 'publish-export-manifest'
        : blockedSnapshots.length > 0
          ? 'repair-history-snapshot-export'
          : 'resolve-export-blockers',
      cursor: {
        firstTimelineEventAt: timeline[0]?.at ?? null,
        lastTimelineEventAt: timeline.at(-1)?.at ?? null,
        latestProofId: proofId,
        historyWindowStart: analytics.window.oldestSnapshotAt,
        historyWindowEnd: analytics.window.newestSnapshotAt
      }
    }
  };
}

function buildReportingState({ analytics, exportSummary, exportManifest, timeline, historyArchive, historyLimit, validation, health, accessBoundary, proofId, now, reportingOptions }) {
  const criticalTimelineEvents = timeline
    .filter((event) => event.severity !== 'info')
    .map((event) => ({
      sequence: event.sequence,
      bucket: event.bucket,
      at: event.at,
      state: event.state,
      severity: event.severity,
      failureCount: event.failureCount,
      providerAckPendingCount: event.providerAckPendingCount,
      proofId: event.proofId
    }));
  const exportBlockedReasons = [
    ...(!validation.ok ? ['validation-errors'] : []),
    ...(!accessBoundary.handoffPolicy.canExportAudit ? ['audit-export-permission-missing'] : []),
    ...(health === 'failed' ? ['failed-health-state'] : []),
    ...(analytics.reliability.slo.withinTarget ? [] : ['slo-target-breach'])
  ];
  const exportReady = exportBlockedReasons.length === 0;

  return {
    schema: 'aios.syscall-layer.verifier-run.reporting.v1',
    generatedAt: now,
    exportReady,
    exportBlockedReasons,
    exportFormat: 'json',
    exportMode: reportingOptions.exportMode,
    exportScope: accessBoundary.scoped ? 'workspace' : 'global',
    exportProofId: proofId,
    exportManifestId: exportManifest.manifestId,
    historyLimit,
    lookbackMs: reportingOptions.lookbackMs,
    summary: exportSummary,
    manifest: {
      id: exportManifest.manifestId,
      ready: exportManifest.ready,
      status: exportManifest.publishState.status,
      sectionCount: exportManifest.totals.sectionCount,
      recordCount: exportManifest.totals.recordCount,
      estimatedBytes: exportManifest.totals.estimatedBytes,
      blockedReasons: exportManifest.blockedReasons,
      nextAction: exportManifest.publishState.nextAction
    },
    criticalTimelineEvents,
    reportSections: [
      'summary',
      'counters',
      'reliability',
      'history-window',
      ...(reportingOptions.includeTimeline ? ['timeline'] : []),
      ...(reportingOptions.includeEvidenceLedger ? ['evidence-ledger'] : [])
    ],
    snapshotBuckets: analytics.dailyBuckets.map((bucket) => ({
      bucket: bucket.bucket,
      snapshotCount: bucket.snapshotCount,
      successRatio: bucket.successRatio,
      failureCount: bucket.failureCount,
      pendingProviderAcks: bucket.pendingProviderAcks
    })),
    historyArchive: {
      snapshotCount: historyArchive.length,
      exportableSnapshotCount: historyArchive.filter((snapshot) => snapshot.exportEligible).length,
      blockedSnapshotCount: historyArchive.filter((snapshot) => !snapshot.exportEligible).length,
      retentionCounts: countBy(historyArchive, (snapshot) => snapshot.retention)
    },
    timelineDigest: {
      eventCount: timeline.length,
      criticalEventCount: criticalTimelineEvents.length,
      firstEventAt: timeline[0]?.at ?? null,
      lastEventAt: timeline.at(-1)?.at ?? null,
      currentTrend: analytics.reliability.trend,
      sloStatus: analytics.reliability.slo.status,
      currentFailureStreak: analytics.window.currentFailureStreak,
      currentOkStreak: analytics.window.currentOkStreak
    },
    recommendedChannel: health === 'failed'
      ? 'incident-report'
      : health === 'degraded'
        ? 'operations-dashboard'
        : analytics.counters.pendingProviderAcks > 0
          ? 'provider-ack-dashboard'
          : 'health-ledger'
  };
}

function buildPreviewAcceptanceContract({
  input,
  proofId,
  validation,
  health,
  lifecycle,
  operationalHealth,
  operationalResponse,
  capabilityNegotiation,
  providerServiceContracts,
  externalHandoff,
  workflowHandoff,
  recovery,
  sync,
  accessBoundary,
  now
}) {
  const previewInput = normalizeObject(input.preview ?? input.acceptancePreview ?? input.uiPreview);
  const acceptanceInput = normalizeObject(input.acceptance ?? input.clientAcceptance);
  const acceptRequested = normalizeBoolean(
    acceptanceInput.accept ?? acceptanceInput.accepted ?? input.acceptPreview,
    false
  );
  const previewOnly = normalizeBoolean(
    previewInput.previewOnly ?? input.previewOnly ?? input.dryRun,
    !acceptRequested
  );
  const validationIssueCount = validation.errors.length + validation.warnings.length;
  const readinessChecks = [
    {
      id: 'validation',
      label: 'Validation',
      ready: validation.ok,
      severity: validation.ok ? 'info' : 'error',
      detail: validation.ok ? 'Input contract is valid.' : `${validation.errors.length} validation error(s) must be fixed.`
    },
    {
      id: 'lifecycle',
      label: 'Lifecycle',
      ready: lifecycle.controls.canRunNow,
      severity: lifecycle.controls.canRunNow ? 'info' : 'warning',
      detail: lifecycle.controls.canRunNow ? 'Run controls are available.' : `Lifecycle next action is ${lifecycle.nextAction}.`
    },
    {
      id: 'operational-health',
      label: 'Operational health',
      ready: operationalHealth.ready,
      severity: operationalHealth.ready ? 'info' : 'error',
      detail: operationalHealth.ready ? 'Critical hosted-kernel dependencies are current.' : `Operational next action is ${operationalHealth.nextAction}.`
    },
    {
      id: 'capabilities',
      label: 'Capabilities',
      ready: capabilityNegotiation.satisfied && providerServiceContracts.missingInvokableCapabilities.length === 0,
      severity: capabilityNegotiation.satisfied ? 'info' : 'error',
      detail: capabilityNegotiation.satisfied
        ? `${providerServiceContracts.contracts.length} provider contract(s) negotiated.`
        : `Missing capabilities: ${capabilityNegotiation.missingCapabilities.join(', ')}.`
    },
    {
      id: 'audit-handoff',
      label: 'Audit handoff',
      ready: !externalHandoff.enabled || externalHandoff.ready,
      severity: !externalHandoff.enabled || externalHandoff.ready ? 'info' : 'warning',
      detail: externalHandoff.enabled
        ? externalHandoff.ready ? 'External audit handoff is ready.' : `Handoff blocked by ${externalHandoff.blockedReasons.join(', ')}.`
        : 'External audit handoff is not configured.'
    },
    {
      id: 'workflow-handoff',
      label: 'Workflow handoff',
      ready: !workflowHandoff.requested || workflowHandoff.ready,
      severity: !workflowHandoff.requested || workflowHandoff.ready ? 'info' : 'warning',
      detail: workflowHandoff.requested
        ? `Workflow handoff status is ${workflowHandoff.status}.`
        : 'No client workflow handoff was requested.'
    },
    {
      id: 'recovery',
      label: 'Recovery',
      ready: recovery.restartSafe,
      severity: recovery.restartSafe ? 'info' : 'error',
      detail: `Recovery status is ${recovery.status}.`
    }
  ];
  const blockingChecks = readinessChecks.filter((check) => !check.ready && check.severity === 'error');
  const warningChecks = readinessChecks.filter((check) => !check.ready && check.severity === 'warning');
  const readinessScore = readinessChecks.length === 0
    ? 1
    : Number((readinessChecks.filter((check) => check.ready).length / readinessChecks.length).toFixed(4));
  const hardBlocked = blockingChecks.length > 0 || health === 'failed' || operationalResponse.failureState === 'blocked';
  const accepted = acceptRequested && !previewOnly && !hardBlocked;
  const decision = hardBlocked
    ? 'blocked'
    : accepted
      ? 'accepted'
      : warningChecks.length > 0 || health === 'degraded'
        ? 'preview-with-warnings'
        : 'preview-ready';
  const primaryNextStep = hardBlocked
    ? operationalResponse.nextAction
    : accepted
      ? lifecycle.controls.canRunNow ? 'start-hosted-kernel-verifier-run' : lifecycle.nextAction
      : 'review-and-accept-preview';

  return {
    schema: 'aios.syscall-layer.verifier-run.preview-acceptance.v1',
    generatedAt: now,
    proofId,
    request: {
      previewOnly,
      acceptRequested,
      acceptedBy: normalizeString(acceptanceInput.actorId ?? acceptanceInput.acceptedBy ?? input.actorId, null),
      acceptedAt: accepted ? asIsoTimestamp(acceptanceInput.acceptedAt, now) : null,
      clientLabel: normalizeString(previewInput.label ?? acceptanceInput.label, 'Hosted kernel verifier-run preview')
    },
    readiness: {
      score: readinessScore,
      ready: !hardBlocked,
      health,
      validationIssueCount,
      checks: readinessChecks,
      blockingChecks: blockingChecks.map((check) => check.id),
      warningChecks: warningChecks.map((check) => check.id)
    },
    validationSummary: {
      ok: validation.ok,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      blockingFields: validation.errors.slice(0, 5).map((error) => error.field),
      warningCodes: validation.warnings.slice(0, 8).map((warning) => warning.code)
    },
    acceptance: {
      decision,
      accepted,
      blocked: hardBlocked,
      blockingReasons: [
        ...blockingChecks.map((check) => check.id),
        ...(health === 'failed' ? ['failed-health-state'] : []),
        ...(operationalResponse.failureState === 'blocked' ? operationalResponse.blockedReasons : [])
      ],
      warningReasons: warningChecks.map((check) => check.id),
      persistable: accepted && recovery.restartSafe,
      auditRequired: accepted || warningChecks.length > 0 || operationalResponse.degradedMode.requiresAudit
    },
    nextStep: {
      action: primaryNextStep,
      routeHint: accepted ? 'syscall-layer/verifier-run/execute' : 'syscall-layer/verifier-run/preview',
      retryAt: operationalResponse.retry.retryAt,
      pendingProviderAcks: sync.pendingAckCount,
      proofRef: proofId,
      isolationKey: accessBoundary.partitions.isolationKey
    }
  };
}

export function describeVerifierRunSurface(input = {}) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const now = asIsoTimestamp(safeInput.now);
  const evidence = normalizeEvidence(safeInput.evidence);
  const failures = normalizeFailures(safeInput);
  const historyLimit = Math.max(1, asNonNegativeInteger(safeInput.historyLimit, DEFAULT_HISTORY_LIMIT));
  const history = normalizeHistory(safeInput.history, historyLimit);
  const providerContracts = normalizeProviderContracts(safeInput, now);
  const operationalHealth = normalizeOperationalHealth(safeInput, providerContracts, now);
  const requiredCapabilities = normalizeRequiredCapabilities(safeInput, providerContracts);
  const capabilityNegotiation = negotiateProviderCapabilities(providerContracts, requiredCapabilities);
  const persistedState = normalizePersistedState(safeInput, now);
  const attempt = asNonNegativeInteger(safeInput.attempt, failures.length > 0 ? 1 : 0);
  const maxAttempts = Math.max(1, asNonNegativeInteger(safeInput.maxAttempts, DEFAULT_ATTEMPT_LIMIT));
  const baseBackoffMs = Math.max(1, asNonNegativeInteger(safeInput.baseBackoffMs, DEFAULT_BACKOFF_MS));
  const recoveryWindowMs = Math.max(1, asNonNegativeInteger(safeInput.recoveryWindowMs, DEFAULT_RECOVERY_WINDOW_MS));
  const degradedMode = safeInput.degradedMode === true || safeInput.allowDegraded === true;
  const lifecycleSettings = normalizeLifecycleSettings(safeInput, now);
  const accessBoundary = normalizeWorkspaceBoundary(safeInput, lifecycleSettings, providerContracts);
  const clientRuntime = normalizeClientRuntime(safeInput, now);
  const reportingOptions = normalizeReportingOptions(safeInput);
  const proofId = normalizeString(
    safeInput.proofId,
    `${surfaceId}:${now}:${evidence.length}:${failures.length}:contract`
  );
  const providerServiceContracts = buildProviderServiceContracts({
    providers: providerContracts,
    requiredCapabilities,
    capabilityNegotiation,
    operationalHealth,
    accessBoundary,
    proofId,
    now
  });
  const validation = buildValidation(
    safeInput,
    failures,
    evidence,
    history,
    lifecycleSettings,
    providerContracts,
    capabilityNegotiation,
    providerServiceContracts,
    persistedState,
    accessBoundary,
    clientRuntime,
    operationalHealth
  );
  const health = determineHealth({
    requestedState: safeInput.health,
    validation,
    failures,
    degradedMode,
    operationalHealth
  });
  const retryableFailures = failures.filter((failure) => failure.retryable && !failure.terminal);
  const retryAllowed = validation.ok && lifecycleSettings.enabled && !lifecycleSettings.paused && retryableFailures.length > 0 && attempt < maxAttempts;
  const computedBackoffMs = retryAllowed
    ? computeBackoff({ attempt: attempt + 1, baseBackoffMs, failureCount: retryableFailures.length })
    : 0;
  const backoffMs = operationalHealth.providerRetryAfterMs && retryAllowed
    ? Math.max(computedBackoffMs, operationalHealth.providerRetryAfterMs)
    : computedBackoffMs;
  const operationalResponse = buildOperationalResponse({
    operationalHealth,
    validation,
    failures,
    lifecycleSettings,
    attempt,
    maxAttempts,
    retryAllowed,
    backoffMs,
    now
  });
  const operationalIncidentPlan = buildOperationalIncidentPlan({
    operationalHealth,
    operationalResponse,
    providerServiceContracts,
    failures,
    validation,
    accessBoundary,
    proofId,
    now
  });
  const lifecycle = buildLifecycleControls({
    lifecycle: lifecycleSettings,
    validation,
    retryAllowed,
    backoffMs,
    failures,
    persistedState,
    now
  });
  const actionableErrors = shapeActionableErrors(failures, validation, operationalResponse, operationalIncidentPlan);
  const sync = buildSyncMetadata({ providers: providerContracts, proofId, now });
  const externalHandoff = buildExternalHandoffState({
    providers: providerContracts,
    validation,
    health,
    proofId,
    accessBoundary,
    providerServiceContracts
  });
  const handoffDispatch = buildProviderHandoffDispatch({
    providerServiceContracts,
    externalHandoff,
    sync,
    accessBoundary,
    proofId,
    now
  });
  const boundaryDecision = buildBoundaryDecision({
    accessBoundary,
    validation,
    externalHandoff,
    handoffDispatch,
    providerServiceContracts,
    clientRuntime,
    proofId,
    now
  });
  const commandStatus = buildCommandStatus({
    input: safeInput,
    lifecycle,
    persistedState,
    proofId,
    now
  });
  const recovery = buildRecoveryPlan({
    persistedState,
    lifecycle,
    validation,
    health,
    retryAllowed,
    proofId,
    now,
    recoveryWindowMs
  });
  const stateTransition = buildPersistedStateTransition({
    persistedState,
    lifecycle,
    commandStatus,
    recovery,
    operationalResponse,
    health,
    proofId,
    now,
    sync,
    validation
  });
  const workflowHandoff = buildClientWorkflowHandoff({
    clientRuntime,
    externalHandoff,
    handoffDispatch,
    lifecycle,
    recovery,
    validation,
    health,
    operationalResponse,
    operationalIncidentPlan,
    proofId,
    accessBoundary,
    now
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    input: safeInput,
    proofId,
    validation,
    health,
    lifecycle,
    operationalHealth,
    operationalResponse,
    capabilityNegotiation,
    providerServiceContracts,
    externalHandoff,
    workflowHandoff,
    recovery,
    sync,
    accessBoundary,
    now
  });
  const proofBundle = buildProofBundle({
    proofId,
    evidence,
    providers: providerContracts,
    validation,
    health,
    accessBoundary,
    sync,
    externalHandoff,
    handoffDispatch,
    boundaryDecision,
    lifecycle,
    commandStatus,
    recovery,
    stateTransition,
    operationalResponse,
    operationalIncidentPlan,
    providerServiceContracts,
    previewAcceptance,
    now
  });
  const currentSnapshot = {
    id: proofId,
    checkedAt: now,
    startedAt: asIsoTimestamp(safeInput.startedAt ?? safeInput.runStartedAt, null),
    completedAt: asIsoTimestamp(safeInput.completedAt ?? safeInput.runCompletedAt, now),
    durationMs: asNonNegativeInteger(
      safeInput.durationMs,
      safeInput.startedAt || safeInput.runStartedAt
        ? Math.max(0, Date.parse(now) - Date.parse(asIsoTimestamp(safeInput.startedAt ?? safeInput.runStartedAt, now)))
        : null
    ),
    state: health,
    ok: validation.ok && health !== 'failed',
    failureCount: failures.length,
    evidenceCount: evidence.length,
    retryAllowed,
    failureCodes: failures.map((failure) => failure.code),
    proofId,
    evidenceDigestCount: proofBundle.evidenceSummary.withDigest,
    providerAckPendingCount: sync.pendingAckCount,
    operationalReady: operationalHealth.ready,
    lifecycleNextAction: lifecycle.nextAction,
    recoveryStatus: recovery.status
  };
  const analytics = buildAnalytics({ current: currentSnapshot, history, reportingOptions });
  const timeline = buildTimeline({ current: currentSnapshot, history });
  const historyArchive = buildHistorySnapshotArchive({
    history,
    current: currentSnapshot,
    timeline,
    analytics,
    proofId,
    now,
    accessBoundary
  });
  const exportSummary = {
    schema: 'aios.syscall-layer.verifier-run.export.v1',
    generatedAt: now,
    surfaceId,
    proofId,
    healthState: health,
    ok: currentSnapshot.ok,
    counters: analytics.counters,
    failureCodeCounts: analytics.failureCodeCounts,
    healthStateCounts: analytics.healthStateCounts,
    dailyBuckets: analytics.dailyBuckets,
    currentDelta: analytics.currentDelta,
    exportReadiness: analytics.exportReadiness,
    latestFailureCode: analytics.latestFailureCode,
    reliability: analytics.reliability,
    performance: analytics.performance,
    historyWindow: analytics.window,
    retryNextAction: retryAllowed
      ? `retry-after-${backoffMs}ms`
      : failures.length > 0
        ? 'operator-action-required'
        : 'no-retry-needed',
    lifecycleNextAction: lifecycle.nextAction,
    lifecycleMode: lifecycle.mode,
    lifecycleCommandResult: lifecycle.transition.commandResult,
    lifecyclePreviousState: lifecycle.transition.previousState,
    lifecycleNextState: lifecycle.transition.nextState,
    lifecycleWriteIntent: lifecycle.transition.writeIntent,
    lifecycleControlReasons: lifecycle.controlReasons,
    lifecycleProofCollectionMode: lifecycle.commandPlan.proofCollection.mode,
    lifecycleScheduleDueNow: lifecycle.schedule.dueNow,
    providerCount: providerContracts.length,
    activeProviderCount: sync.activeProviderCount,
    capabilitySatisfied: capabilityNegotiation.satisfied,
    invokableProviderCount: providerServiceContracts.contracts.filter((contract) => contract.invocationMode === 'invoke').length,
    missingInvokableCapabilities: providerServiceContracts.missingInvokableCapabilities,
    providerServiceDeliverySummary: providerServiceContracts.deliverySummary,
    providerHandoffDispatchStatus: handoffDispatch.status,
    providerHandoffDispatchableCount: handoffDispatch.dispatchableCount,
    providerHandoffBlockedCount: handoffDispatch.blockedCount,
    providerHandoffAckWaitCount: handoffDispatch.ackWaitCount,
    proofBundleReady: proofBundle.exportReady,
    proofBundleBlockedReasons: proofBundle.exportBlockedReasons,
    proofBundleStageCount: proofBundle.verificationStages.length,
    proofBundleEvidenceLedgerCount: proofBundle.evidenceLedger.length,
    proofBundleExportableEvidenceCount: proofBundle.evidenceSummary.exportable,
    proofBundleRedactedEvidenceCount: proofBundle.evidenceSummary.redacted,
    historyArchiveSnapshotCount: historyArchive.length,
    historyArchiveExportableSnapshotCount: historyArchive.filter((snapshot) => snapshot.exportEligible).length,
    historyArchiveBlockedSnapshotCount: historyArchive.filter((snapshot) => !snapshot.exportEligible).length,
    historyArchiveRetentionCounts: countBy(historyArchive, (snapshot) => snapshot.retention),
    tenantScoped: accessBoundary.scoped,
    isolationMode: accessBoundary.mode,
    permissionAuthorized: accessBoundary.authorized,
    boundaryDecision: boundaryDecision.decision,
    boundaryDenyReasons: boundaryDecision.denyReasons,
    boundaryRedactedTargetCount: boundaryDecision.handoff.redactedTargetCount,
    missingPermissions: accessBoundary.missingPermissions,
    handoffReady: externalHandoff.ready,
    workflowHandoffReady: workflowHandoff.ready,
    workflowHandoffStatus: workflowHandoff.status,
    workflowHandoffDeliveryMode: workflowHandoff.delivery.mode,
    workflowHandoffAckRequired: workflowHandoff.delivery.ackRequired,
    workflowHandoffProviderAckWaitCount: workflowHandoff.delivery.providerAckWaitlist.length,
    workflowHandoffClientAction: workflowHandoff.clientAction.action,
    workflowHandoffResumeTokenPresent: Boolean(workflowHandoff.clientAction.resumeToken),
    previewDecision: previewAcceptance.acceptance.decision,
    previewAccepted: previewAcceptance.acceptance.accepted,
    previewReadinessScore: previewAcceptance.readiness.score,
    previewNextAction: previewAcceptance.nextStep.action,
    clientChannel: clientRuntime.client.channel,
    requestId: clientRuntime.request.id,
    traceId: clientRuntime.request.traceId,
    pendingProviderAcks: sync.pendingAckCount,
    operationalHealthReady: operationalHealth.ready,
    operationalHealthSignalCount: operationalHealth.signalCount,
    operationalHealthNextAction: operationalHealth.nextAction,
    operationalFailureState: operationalResponse.failureState,
    operationalNextAction: operationalResponse.nextAction,
    operationalBlockedReasons: operationalResponse.blockedReasons,
    operationalIncidentStatus: operationalIncidentPlan.status,
    operationalIncidentCount: operationalIncidentPlan.incidentCount,
    operationalBlockingIncidentCount: operationalIncidentPlan.blockingIncidentCount,
    operationalRetryableIncidentCount: operationalIncidentPlan.retryableIncidentCount,
    operationalNextOperatorAction: operationalIncidentPlan.nextOperatorAction,
    degradedModeActive: operationalResponse.degradedMode.active,
    degradedModeReasonCount: operationalResponse.degradedMode.reasonCount,
    retryAt: operationalResponse.retry.retryAt,
    attemptsRemaining: operationalResponse.retry.attemptsRemaining,
    staleCriticalHealthSignals: operationalHealth.staleCriticalSignals,
    failedCriticalHealthSignals: operationalHealth.failedCriticalSignals,
    restartSafe: recovery.restartSafe,
    recoveryStatus: recovery.status,
    stateWriteDisposition: stateTransition.writeDisposition,
    stateRestartStatus: stateTransition.restartStatus.status,
    stateNextRevision: stateTransition.nextRevision,
    stateCommandLedgerAppend: stateTransition.idempotency.appendLedgerEntry,
    commandEffect: commandStatus.effect,
    commandDuplicate: commandStatus.duplicate,
    timelineEvents: timeline.length,
    criticalTimelineEvents: timeline.filter((event) => event.severity !== 'info').length,
    reportMode: reportingOptions.exportMode,
    reportSections: [
      'summary',
      'counters',
      'reliability',
      'history-window',
      ...(reportingOptions.includeTimeline ? ['timeline'] : []),
      ...(reportingOptions.includeEvidenceLedger ? ['evidence-ledger'] : [])
    ],
    sloStatus: analytics.reliability.slo.status,
    sloWithinTarget: analytics.reliability.slo.withinTarget,
    exportBlockedReasons: [
      ...(!validation.ok ? ['validation-errors'] : []),
      ...(!accessBoundary.handoffPolicy.canExportAudit ? ['audit-export-permission-missing'] : []),
      ...(health === 'failed' ? ['failed-health-state'] : []),
      ...(analytics.reliability.slo.withinTarget ? [] : ['slo-target-breach'])
    ]
  };
  const exportManifest = buildExportManifest({
    exportSummary,
    proofBundle,
    reportingOptions,
    historyArchive,
    timeline,
    analytics,
    accessBoundary,
    proofId,
    now
  });
  const reporting = buildReportingState({
    analytics,
    exportSummary,
    exportManifest,
    timeline,
    historyArchive,
    historyLimit,
    validation,
    health,
    accessBoundary,
    proofId,
    now,
    reportingOptions
  });

  return {
    ok: validation.ok && health !== 'failed',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel verifier-run health and retry contract',
    health: {
      state: health,
      degradedMode,
      validationOk: validation.ok,
      failureCount: failures.length,
      evidenceCount: evidence.length,
      operationalReady: operationalHealth.ready,
      operationalSignalCount: operationalHealth.signalCount,
      operationalNextAction: operationalHealth.nextAction
    },
    validation,
    lifecycle,
    retry: {
      allowed: retryAllowed,
      attempt,
      maxAttempts,
      backoffMs,
      nextAction: retryAllowed
        ? `retry-after-${backoffMs}ms`
        : failures.length > 0
          ? 'operator-action-required'
          : 'no-retry-needed'
    },
    failures,
    actionableErrors,
    audit: {
      proofId,
      proofType: 'hosted-kernel-verifier-run',
      route: normalizeString(safeInput.route, 'syscall-layer/verifier-run'),
      checkedAt: now,
      evidenceDigestCount: proofBundle.evidenceSummary.withDigest,
      evidenceLedgerCount: proofBundle.evidenceLedger.length,
      exportableEvidenceCount: proofBundle.evidenceSummary.exportable,
      proofBundleReady: proofBundle.exportReady,
      proofBundleBlockedReasons: proofBundle.exportBlockedReasons,
      proofVerificationStages: proofBundle.verificationStages.map((stage) => ({
        name: stage.name,
        status: stage.status
      })),
      failureCodes: failures.map((failure) => failure.code),
      lifecycleCommand: lifecycle.command,
      lifecycleNextAction: lifecycle.nextAction,
      lifecycleCommandResult: lifecycle.transition.commandResult,
      lifecyclePreviousState: lifecycle.transition.previousState,
      lifecycleNextState: lifecycle.transition.nextState,
      lifecycleWriteIntent: lifecycle.transition.writeIntent,
      lifecycleControlReasons: lifecycle.controlReasons,
      lifecycleProofCollectionMode: lifecycle.commandPlan.proofCollection.mode,
      lifecycleScheduleDueNow: lifecycle.schedule.dueNow,
      scheduleMode: lifecycle.schedule.mode,
      scheduledNextRunAt: lifecycle.schedule.nextRunAt,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      actorId: accessBoundary.actor.id,
      actorRole: accessBoundary.actor.role,
      requestId: clientRuntime.request.id,
      traceId: clientRuntime.request.traceId,
      clientChannel: clientRuntime.client.channel,
      clientSessionId: clientRuntime.client.sessionId,
      workflowHandoffRequested: workflowHandoff.requested,
      workflowHandoffReady: workflowHandoff.ready,
      workflowHandoffStatus: workflowHandoff.status,
      workflowHandoffIntent: workflowHandoff.intent,
      workflowHandoffRef: workflowHandoff.handoffRef,
      workflowHandoffDeliveryMode: workflowHandoff.delivery.mode,
      workflowHandoffAckRequired: workflowHandoff.delivery.ackRequired,
      workflowHandoffClientAction: workflowHandoff.clientAction.action,
      workflowHandoffIncidentId: workflowHandoff.clientAction.incidentId,
      previewDecision: previewAcceptance.acceptance.decision,
      previewAccepted: previewAcceptance.acceptance.accepted,
      previewReadinessScore: previewAcceptance.readiness.score,
      previewNextAction: previewAcceptance.nextStep.action,
      previewBlockingReasons: previewAcceptance.acceptance.blockingReasons,
      isolationMode: accessBoundary.mode,
      isolationKey: accessBoundary.partitions.isolationKey,
      auditSubject: accessBoundary.partitions.auditSubject,
      permissionAuthorized: accessBoundary.authorized,
      boundaryDecision: boundaryDecision.decision,
      boundaryDenyReasons: boundaryDecision.denyReasons,
      boundaryRedactedTargetCount: boundaryDecision.handoff.redactedTargetCount,
      missingPermissions: accessBoundary.missingPermissions,
      providerScopeMismatchCount: accessBoundary.providerScopeMismatches.length,
      providerCount: providerContracts.length,
      requiredCapabilities,
      missingCapabilities: capabilityNegotiation.missingCapabilities,
      missingInvokableCapabilities: providerServiceContracts.missingInvokableCapabilities,
      providerInvocationSummary: providerServiceContracts.invocationSummary,
      providerDeliverySummary: providerServiceContracts.deliverySummary,
      providerHandoffDispatchStatus: handoffDispatch.status,
      providerHandoffDispatchableCount: handoffDispatch.dispatchableCount,
      providerHandoffBlockedCount: handoffDispatch.blockedCount,
      providerHandoffAckWaitCount: handoffDispatch.ackWaitCount,
      handoffReady: externalHandoff.ready,
      pendingProviderAcks: sync.pendingAckCount,
      operationalHealthReady: operationalHealth.ready,
      operationalHealthDegraded: operationalHealth.degraded,
      operationalHealthNextAction: operationalHealth.nextAction,
      operationalFailureState: operationalResponse.failureState,
      operationalResponseNextAction: operationalResponse.nextAction,
      operationalBlockedReasons: operationalResponse.blockedReasons,
      operationalIncidentStatus: operationalIncidentPlan.status,
      operationalIncidentCount: operationalIncidentPlan.incidentCount,
      operationalBlockingIncidentCount: operationalIncidentPlan.blockingIncidentCount,
      operationalNextOperatorAction: operationalIncidentPlan.nextOperatorAction,
      degradedModeActive: operationalResponse.degradedMode.active,
      degradedModeRequiresAudit: operationalResponse.degradedMode.requiresAudit,
      degradedModeReasons: operationalResponse.degradedMode.reasons,
      retryAt: operationalResponse.retry.retryAt,
      attemptsRemaining: operationalResponse.retry.attemptsRemaining,
      failedCriticalHealthSignals: operationalHealth.failedCriticalSignals,
      staleCriticalHealthSignals: operationalHealth.staleCriticalSignals,
      commandId: commandStatus.commandId,
      commandEffect: commandStatus.effect,
      recoveryStatus: recovery.status,
      restartSafe: recovery.restartSafe,
      persistedRevision: recovery.nextPersistedState.revision,
      stateWriteDisposition: stateTransition.writeDisposition,
      stateRestartStatus: stateTransition.restartStatus.status,
      stateConflictPolicy: stateTransition.conflictPolicy,
      stateExpectedRevision: stateTransition.expectedRevision,
      stateNextRevision: stateTransition.nextRevision,
      stateCommandLedgerAppend: stateTransition.idempotency.appendLedgerEntry,
      analyticsTrend: analytics.reliability.trend,
      analyticsSloStatus: analytics.reliability.slo.status,
      analyticsSloWithinTarget: analytics.reliability.slo.withinTarget,
      currentSnapshotDelta: analytics.currentDelta,
      reportExportMode: reportingOptions.exportMode,
      reportLookbackMs: reportingOptions.lookbackMs,
      reportExportableSnapshots: analytics.exportReadiness.exportableSnapshots,
      reportSnapshotsWithPendingAcks: analytics.exportReadiness.snapshotsWithPendingAcks,
      reportDailyBucketCount: analytics.dailyBuckets.length,
      reportManifestId: exportManifest.manifestId,
      reportManifestReady: exportManifest.ready,
      reportManifestStatus: exportManifest.publishState.status,
      reportManifestSectionCount: exportManifest.totals.sectionCount,
      reportManifestRecordCount: exportManifest.totals.recordCount,
      reportManifestEstimatedBytes: exportManifest.totals.estimatedBytes,
      reportManifestBlockedReasons: exportManifest.blockedReasons,
      historyArchiveSnapshotCount: historyArchive.length,
      historyArchiveExportableSnapshotCount: historyArchive.filter((snapshot) => snapshot.exportEligible).length,
      historyArchiveBlockedSnapshotCount: historyArchive.filter((snapshot) => !snapshot.exportEligible).length
    },
    proof: proofBundle,
    preview: previewAcceptance,
    analytics,
    history: {
      limit: historyLimit,
      snapshots: history,
      current: currentSnapshot,
      archive: historyArchive
    },
    timeline,
    reporting: {
      ...reporting,
      exportManifest
    },
    integration: {
      acceptsEvidence: true,
      emitsProof: true,
      emitsProofBundle: true,
      emitsEvidenceLedger: true,
      emitsProviderCommitments: true,
      supportsDegradedMode: true,
      emitsAnalytics: true,
      emitsExportSummary: true,
      supportsLifecycleControls: true,
      validatesSchedulingSettings: true,
      validatesCronScheduleShape: true,
      emitsLifecycleCommandPlan: true,
      emitsLifecycleTransitionState: true,
      gatesPauseResumeAgainstPersistedState: true,
      flagsScheduleDueState: true,
      validatesProviderContracts: true,
      negotiatesProviderCapabilities: true,
      emitsProviderServiceContracts: true,
      gatesCapabilityHandoffByInvokableProviders: true,
      emitsSyncMetadata: true,
      emitsExternalHandoffState: true,
      emitsProviderHandoffDispatchOutbox: true,
      emitsProviderHandoffDispatchLeases: true,
      emitsProviderAckWaitlist: true,
      emitsClientRuntimeContract: true,
      emitsWorkflowHandoffState: true,
      emitsWorkflowHandoffDeliveryContract: true,
      emitsWorkflowHandoffClientAction: true,
      emitsWorkflowResumeToken: true,
      emitsPreviewAcceptanceContract: true,
      emitsReadinessValidationSummary: true,
      emitsExplainableNextStepContract: true,
      validatesClientWorkflowHandoff: true,
      preservesHistorySnapshots: true,
      shapesPersistedState: true,
      supportsIdempotentCommands: true,
      emitsRecoveryPlan: true,
      emitsPersistedStateTransition: true,
      emitsCompareAndSwapStateRevision: true,
      emitsRestartVisibleStatus: true,
      enforcesTenantWorkspaceBoundary: true,
      validatesActorPermissions: true,
      emitsAuditSubjectPartition: true,
      blocksCrossScopeProviderHandoff: true,
      emitsOperationalHealthContract: true,
      emitsOperationalResponseContract: true,
      emitsOperationalIncidentPlan: true,
      emitsProviderAwareOperationalRunbooks: true,
      emitsDegradedModeRunbook: true,
      emitsRetryWindow: true,
      emitsProviderHealthActions: true,
      blocksStaleCriticalProviderHealth: true,
      honorsProviderRetryAfterBackoff: true,
      emitsDailyAnalyticsBuckets: true,
      emitsSnapshotDeltaAnalytics: true,
      emitsReportSloGates: true,
      emitsExportManifestSections: true,
      emitsVersionedExportManifest: true,
      emitsHistorySnapshotArchive: true,
      emitsExportPublishState: true,
      validatesEvidenceExportContract: true,
      shapesHostedKernelProofEnvelope: true,
      restartSafeStatusSemantics: true,
      retryBackoff: 'bounded-exponential',
      kernelSurface: `${surfaceGroup}/${surfaceName}`,
      providerContractSchema: 'aios.syscall-layer.verifier-run.provider-contract.v1'
    },
    state: {
      schema: 'aios.syscall-layer.verifier-run.state-contract.v1',
      persisted: persistedState,
      command: commandStatus,
      lifecycleControls: lifecycle,
      recovery,
      transition: stateTransition,
      operationalResponse,
      operationalHealth,
      operationalIncidentPlan,
      accessBoundary,
      boundaryDecision,
      clientRuntime,
      workflowHandoff,
      previewAcceptance,
      proofBundle: {
        schema: proofBundle.schema,
        proofId: proofBundle.proofId,
        exportReady: proofBundle.exportReady,
        exportBlockedReasons: proofBundle.exportBlockedReasons,
        evidenceSummary: proofBundle.evidenceSummary,
        verificationStages: proofBundle.verificationStages
      },
      providerServiceContracts,
      handoffDispatch,
      boundaryDecision,
      exportManifest,
      historyArchive,
      reportingOptions
    },
    providers: {
      schema: 'aios.syscall-layer.verifier-run.provider-contract.v1',
      contracts: providerContracts,
      serviceContracts: providerServiceContracts,
      capabilityNegotiation,
      sync,
      externalHandoff,
      handoffDispatch
    },
    evidence
  };
}

export default describeVerifierRunSurface;
