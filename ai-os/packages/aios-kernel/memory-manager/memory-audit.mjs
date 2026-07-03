export const surfaceId = "aios_memory-manager_memory-audit_050";
export const surfaceGroup = "memory-manager";
export const surfaceName = "memory-audit";

const SCHEMA_VERSION = 1;
const DEFAULT_BOUNDARY = Object.freeze({
  tenantId: 'default-tenant',
  workspaceId: 'default-workspace',
  actorId: 'system',
  role: 'auditor'
});
const ROLE_PERMISSIONS = Object.freeze({
  auditor: Object.freeze(['memory.audit.read', 'memory.audit.ledger.append', 'memory.audit.handoff']),
  operator: Object.freeze([
    'memory.audit.read',
    'memory.audit.checkpoint.write',
    'memory.audit.ledger.append',
    'memory.audit.flush',
    'memory.audit.recover',
    'memory.audit.handoff',
    'memory.audit.provider.write',
    'memory.audit.lifecycle.write'
  ]),
  observer: Object.freeze(['memory.audit.read'])
});
const KNOWN_PERMISSIONS = Object.freeze([...new Set(Object.values(ROLE_PERMISSIONS).flat())].sort());
const EMPTY_CHECKPOINT = Object.freeze({
  cursor: 0,
  generation: 0,
  highWatermark: null
});
const MAX_HISTORY_SNAPSHOTS = 12;
const MAX_COMMAND_RECEIPTS = 64;
const EXPORT_DATASET_NAMES = Object.freeze([
  'ledgerEntries',
  'commandReceipts',
  'boundaryViolations',
  'historySnapshots',
  'timeline'
]);
const EXPORT_PACKAGE_MEDIA_TYPES = Object.freeze({
  jsonl: 'application/x-ndjson',
  json: 'application/json'
});
const DEFAULT_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const MAX_RETRY_ATTEMPTS = 5;
const MIN_AUDIT_INTERVAL_MS = 60000;
const MAX_AUDIT_INTERVAL_MS = 86400000;
const LIFECYCLE_MODES = Object.freeze(['manual', 'scheduled', 'continuous']);
const DEFAULT_LIFECYCLE_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'continuous',
  intervalMs: 300000,
  nextRunAt: null,
  lastRunAt: null,
  disabledReason: null,
  lastConfiguredAt: null
});
const REQUIRED_PROVIDER_CAPABILITIES = Object.freeze([
  'checkpoint-import',
  'ledger-proof',
  'handoff-receipt'
]);
const OPTIONAL_PROVIDER_CAPABILITIES = Object.freeze([
  'delta-sync',
  'retention-attestation',
  'replay-window',
  'external-revision'
]);
const PROVIDER_HANDOFF_RECEIPT_STATUSES = Object.freeze(['pending', 'accepted', 'rejected']);
const SUPPORTED_PROVIDER_CAPABILITIES = Object.freeze([
  ...REQUIRED_PROVIDER_CAPABILITIES,
  ...OPTIONAL_PROVIDER_CAPABILITIES
]);
const DEFAULT_PROVIDER_CONTRACT = Object.freeze({
  providerId: 'hosted-kernel-memory-provider',
  service: 'memory-manager/audit-provider',
  version: '1.0.0',
  endpoint: null,
  requestedCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
  lastNegotiatedAt: null,
  sync: Object.freeze({
    cursor: 0,
    generation: 0,
    externalRevision: null,
    lastSyncedAt: null,
    leaseExpiresAt: null,
    consistency: 'unknown'
  }),
  handoffReceipt: null
});
const PROVIDER_SERVICE_ROUTES = Object.freeze({
  negotiate: '/memory/audit/provider-contract/negotiate',
  sync: '/memory/audit/provider-contract/sync',
  handoff: '/memory/audit/provider-contract/handoff',
  attest: '/memory/audit/provider-contract/attest'
});
const DEFAULT_CLIENT_RUNTIME = Object.freeze({
  clientId: 'hosted-kernel-client',
  sessionId: 'memory-audit-session',
  requestId: null,
  route: '/memory/audit',
  workflow: 'audit-review',
  handoffMode: 'interactive',
  lastSeenAt: null
});
const CLIENT_HANDOFF_ROUTES = Object.freeze({
  ready: '/memory/audit/handoff',
  review: '/memory/audit/review',
  recover: '/memory/audit/recovery',
  provider: '/memory/audit/provider-contract',
  disabled: '/memory/audit/lifecycle'
});
const CLIENT_COMMAND_HANDOFF_VIEWS = Object.freeze({
  ready: 'external-handoff-ready',
  review: 'audit-readiness-review',
  recover: 'audit-recovery',
  provider: 'provider-contract-review',
  disabled: 'audit-lifecycle-disabled'
});

function asIsoTimestamp(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function asNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.floor(numeric);
}

function asNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function normalizePermissionList(value) {
  return Array.isArray(value)
    ? [...new Set(value
        .filter((permission) => typeof permission === 'string' && permission.trim() !== '')
        .map((permission) => permission.trim()))].sort()
    : [];
}

function normalizePermissionClaims(role, requestedPermissions) {
  const inherited = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.observer;
  const requested = normalizePermissionList(requestedPermissions);
  const effective = requested.length === 0
    ? inherited
    : inherited.filter((permission) => requested.includes(permission));
  const denied = requested.filter((permission) => !inherited.includes(permission));
  const unknown = requested.filter((permission) => !KNOWN_PERMISSIONS.includes(permission));

  return {
    role,
    rolePermissions: inherited,
    requested,
    effective: [...new Set(effective)].sort(),
    denied: [...new Set(denied)].sort(),
    unknown: [...new Set(unknown)].sort(),
    source: requested.length === 0 ? 'role-default' : 'role-constrained-request'
  };
}

function normalizePermissions(role, requestedPermissions) {
  return normalizePermissionClaims(role, requestedPermissions).effective;
}

function normalizeBoundary(value = {}, fallback = DEFAULT_BOUNDARY) {
  const raw = value && typeof value === 'object' ? value : {};
  const role = asNonEmptyString(raw.role, fallback.role);
  const tenantId = asNonEmptyString(raw.tenantId, fallback.tenantId);
  const workspaceId = asNonEmptyString(raw.workspaceId, fallback.workspaceId);
  const permissionClaims = normalizePermissionClaims(role, raw.permissions);

  return {
    tenantId,
    workspaceId,
    actorId: asNonEmptyString(raw.actorId, fallback.actorId),
    role,
    permissions: permissionClaims.effective,
    permissionClaims,
    isolation: {
      tenantScoped: true,
      workspaceScoped: true,
      boundaryKey: `${tenantId}:${workspaceId}`
    }
  };
}

function boundariesMatch(expected, actual) {
  return expected.tenantId === actual.tenantId && expected.workspaceId === actual.workspaceId;
}

function evaluateBoundaryAccess(expected, actual, requiredPermission) {
  if (expected.tenantId !== actual.tenantId) {
    return {
      allowed: false,
      reason: 'boundary-mismatch',
      scope: 'tenant',
      expectedTenantId: expected.tenantId,
      actualTenantId: actual.tenantId,
      expectedWorkspaceId: expected.workspaceId,
      actualWorkspaceId: actual.workspaceId,
      requiredPermission,
      permissionClaims: actual.permissionClaims
    };
  }

  if (expected.workspaceId !== actual.workspaceId) {
    return {
      allowed: false,
      reason: 'boundary-mismatch',
      scope: 'workspace',
      expectedTenantId: expected.tenantId,
      actualTenantId: actual.tenantId,
      expectedWorkspaceId: expected.workspaceId,
      actualWorkspaceId: actual.workspaceId,
      requiredPermission,
      permissionClaims: actual.permissionClaims
    };
  }

  if (requiredPermission && !actual.permissions.includes(requiredPermission)) {
    return {
      allowed: false,
      reason: 'permission-denied',
      scope: 'permission',
      expectedTenantId: expected.tenantId,
      actualTenantId: actual.tenantId,
      expectedWorkspaceId: expected.workspaceId,
      actualWorkspaceId: actual.workspaceId,
      requiredPermission,
      permissionClaims: actual.permissionClaims
    };
  }

  return {
    allowed: true,
    reason: 'allowed',
    scope: 'workspace',
    expectedTenantId: expected.tenantId,
    actualTenantId: actual.tenantId,
    expectedWorkspaceId: expected.workspaceId,
    actualWorkspaceId: actual.workspaceId,
    requiredPermission,
    permissionClaims: actual.permissionClaims
  };
}

function operationPermission(op) {
  if (op === 'configure-lifecycle' || op === 'enable-audit' || op === 'disable-audit' || op === 'schedule-audit') {
    return 'memory.audit.lifecycle.write';
  }

  if (op === 'record-checkpoint') {
    return 'memory.audit.checkpoint.write';
  }

  if (op === 'append-ledger-entry') {
    return 'memory.audit.ledger.append';
  }

  if (op === 'mark-flushed') {
    return 'memory.audit.flush';
  }

  if (op === 'recover') {
    return 'memory.audit.recover';
  }

  if (op === 'handoff-audit') {
    return 'memory.audit.handoff';
  }

  if (op === 'negotiate-provider-contract'
    || op === 'update-provider-sync'
    || op === 'acknowledge-provider-handoff') {
    return 'memory.audit.provider.write';
  }

  if (op === 'report-failure' || op === 'enter-degraded-mode' || op === 'clear-degraded-mode') {
    return 'memory.audit.recover';
  }

  return null;
}

function normalizeCheckpoint(value = {}) {
  return {
    cursor: asNonNegativeInteger(value.cursor, EMPTY_CHECKPOINT.cursor),
    generation: asNonNegativeInteger(value.generation, EMPTY_CHECKPOINT.generation),
    highWatermark: typeof value.highWatermark === 'string' && value.highWatermark.trim() !== ''
      ? value.highWatermark
      : EMPTY_CHECKPOINT.highWatermark
  };
}

function normalizeFailure(value = {}, now) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const code = asNonEmptyString(value.code, null);
  if (!code) {
    return null;
  }

  return {
    code,
    message: asNonEmptyString(value.message, 'memory audit operation failed'),
    op: asNonEmptyString(value.op, 'unknown'),
    at: asIsoTimestamp(value.at, now),
    recoverable: value.recoverable !== false,
    retryable: value.retryable !== false,
    detail: value.detail && typeof value.detail === 'object' ? value.detail : null
  };
}

function retryBackoffMs(attempts) {
  const exponent = Math.min(asNonNegativeInteger(attempts, 0), MAX_RETRY_ATTEMPTS);
  return Math.min(DEFAULT_BACKOFF_MS * (2 ** exponent), MAX_BACKOFF_MS);
}

function clampAuditIntervalMs(value, fallback = DEFAULT_LIFECYCLE_SETTINGS.intervalMs) {
  const intervalMs = asNonNegativeInteger(value, fallback);
  return Math.min(Math.max(intervalMs, MIN_AUDIT_INTERVAL_MS), MAX_AUDIT_INTERVAL_MS);
}

function normalizeLifecycleSettings(value = {}, now) {
  const rawMode = asNonEmptyString(value.mode, DEFAULT_LIFECYCLE_SETTINGS.mode);
  const mode = LIFECYCLE_MODES.includes(rawMode)
    ? rawMode
    : DEFAULT_LIFECYCLE_SETTINGS.mode;
  const intervalMs = clampAuditIntervalMs(value.intervalMs);
  const lastRunAt = asIsoTimestamp(value.lastRunAt, null);
  const nextRunAt = mode === 'scheduled'
    ? asIsoTimestamp(
        value.nextRunAt,
        lastRunAt
          ? new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString()
          : new Date(new Date(now).getTime() + intervalMs).toISOString()
      )
    : null;

  return {
    enabled: value.enabled !== false,
    mode,
    intervalMs,
    nextRunAt,
    lastRunAt,
    disabledReason: value.enabled === false
      ? asNonEmptyString(value.disabledReason, 'operator-disabled')
      : null,
    lastConfiguredAt: asIsoTimestamp(value.lastConfiguredAt, null)
  };
}

function validateLifecycleCommand(command = {}, state, now) {
  const op = typeof command?.op === 'string' ? command.op : 'noop';
  const lifecycle = command.lifecycle && typeof command.lifecycle === 'object' ? command.lifecycle : {};
  const findings = [];
  const rawMode = op === 'schedule-audit'
    ? 'scheduled'
    : lifecycle.mode ?? command.mode;
  const rawIntervalMs = op === 'schedule-audit'
    ? command.intervalMs
    : lifecycle.intervalMs ?? command.intervalMs;
  const rawNextRunAt = op === 'schedule-audit'
    ? command.nextRunAt
    : lifecycle.nextRunAt ?? command.nextRunAt;
  const rawEnabled = op === 'disable-audit'
    ? false
    : lifecycle.enabled ?? command.enabled;

  if (rawMode !== undefined && !LIFECYCLE_MODES.includes(rawMode)) {
    findings.push({
      code: 'invalid-lifecycle-mode',
      severity: 'error',
      field: op === 'schedule-audit' ? 'op' : 'lifecycle.mode',
      value: rawMode,
      allowed: LIFECYCLE_MODES,
      action: 'use manual, scheduled, or continuous lifecycle mode'
    });
  }

  if (rawIntervalMs !== undefined) {
    const numericInterval = Number(rawIntervalMs);

    if (!Number.isFinite(numericInterval) || numericInterval < 0) {
      findings.push({
        code: 'invalid-lifecycle-interval',
        severity: 'error',
        field: op === 'schedule-audit' ? 'intervalMs' : 'lifecycle.intervalMs',
        value: rawIntervalMs,
        action: 'provide a non-negative audit interval in milliseconds'
      });
    } else if (numericInterval < MIN_AUDIT_INTERVAL_MS || numericInterval > MAX_AUDIT_INTERVAL_MS) {
      findings.push({
        code: 'lifecycle-interval-clamped',
        severity: 'warning',
        field: op === 'schedule-audit' ? 'intervalMs' : 'lifecycle.intervalMs',
        value: numericInterval,
        effectiveValue: clampAuditIntervalMs(numericInterval, state.lifecycle.intervalMs),
        min: MIN_AUDIT_INTERVAL_MS,
        max: MAX_AUDIT_INTERVAL_MS,
        action: 'persist the effective clamped interval returned by the audit lifecycle contract'
      });
    }
  }

  if ((rawMode === 'scheduled' || op === 'schedule-audit') && rawNextRunAt !== undefined) {
    const normalizedNextRunAt = asIsoTimestamp(rawNextRunAt, null);

    if (!normalizedNextRunAt) {
      findings.push({
        code: 'invalid-lifecycle-next-run',
        severity: 'error',
        field: op === 'schedule-audit' ? 'nextRunAt' : 'lifecycle.nextRunAt',
        value: rawNextRunAt,
        action: 'provide nextRunAt as an ISO timestamp or omit it to let the kernel calculate one'
      });
    } else if (new Date(normalizedNextRunAt).getTime() < new Date(now).getTime()) {
      findings.push({
        code: 'lifecycle-next-run-in-past',
        severity: 'warning',
        field: op === 'schedule-audit' ? 'nextRunAt' : 'lifecycle.nextRunAt',
        value: normalizedNextRunAt,
        action: 'the scheduled audit is immediately due and should be flushed after checkpoint work completes'
      });
    }
  }

  if (rawEnabled === false) {
    const disableReason = asNonEmptyString(
      lifecycle.disabledReason ?? command.reason,
      null
    );

    if (!disableReason) {
      findings.push({
        code: 'lifecycle-disable-reason-missing',
        severity: 'warning',
        field: op === 'disable-audit' ? 'reason' : 'lifecycle.disabledReason',
        action: 'include an operator-visible disabled reason for lifecycle audit trails'
      });
    }
  }

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    findings
  };
}

function projectLifecycleSettingsAfterCommand(command = {}, state, now) {
  const op = typeof command?.op === 'string' ? command.op : 'noop';

  if (op === 'configure-lifecycle') {
    return normalizeLifecycleSettings({
      ...state.lifecycle,
      ...command.lifecycle,
      lastConfiguredAt: now
    }, now);
  }

  if (op === 'enable-audit') {
    return normalizeLifecycleSettings({
      ...state.lifecycle,
      enabled: true,
      disabledReason: null,
      lastConfiguredAt: now
    }, now);
  }

  if (op === 'disable-audit') {
    return normalizeLifecycleSettings({
      ...state.lifecycle,
      enabled: false,
      disabledReason: asNonEmptyString(command.reason, 'operator-disabled'),
      lastConfiguredAt: now
    }, now);
  }

  if (op === 'schedule-audit') {
    const intervalMs = command.intervalMs === undefined
      ? state.lifecycle.intervalMs
      : clampAuditIntervalMs(command.intervalMs, state.lifecycle.intervalMs);

    return normalizeLifecycleSettings({
      ...state.lifecycle,
      mode: 'scheduled',
      intervalMs,
      nextRunAt: command.nextRunAt,
      lastConfiguredAt: now
    }, now);
  }

  return normalizeLifecycleSettings(state.lifecycle, now);
}

function buildLifecycleCommandContract(state, now, command = {}, commandBoundary = state.boundary) {
  const op = typeof command?.op === 'string' ? command.op : 'noop';
  const requiredPermission = operationPermission(op);
  const accessDecision = evaluateBoundaryAccess(state.boundary, commandBoundary, requiredPermission);
  const lifecycleValidation = validateLifecycleCommand(command, state, now);
  const disabledBlocked = !state.lifecycle.enabled && !commandAllowedWhenDisabled(op);
  const projectedSettings = projectLifecycleSettingsAfterCommand(command, state, now);
  const validationBlockers = lifecycleValidation.findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
  const blockingReasons = [
    ...(!accessDecision.allowed ? [accessDecision.reason] : []),
    ...(disabledBlocked ? ['audit-disabled'] : []),
    ...validationBlockers
  ];
  const scheduleDue = projectedSettings.mode === 'scheduled'
    && projectedSettings.nextRunAt
    && new Date(projectedSettings.nextRunAt).getTime() <= new Date(now).getTime();

  return {
    schema: 'memory-audit-lifecycle-command.v1',
    op,
    generatedAt: now,
    command: {
      op,
      mode: command.lifecycle?.mode ?? command.mode ?? (op === 'schedule-audit' ? 'scheduled' : undefined),
      intervalMs: command.lifecycle?.intervalMs ?? command.intervalMs,
      nextRunAt: command.lifecycle?.nextRunAt ?? command.nextRunAt,
      enabled: command.lifecycle?.enabled ?? command.enabled,
      reason: command.reason ?? command.lifecycle?.disabledReason ?? null
    },
    requiredPermission,
    accessDecision: {
      allowed: accessDecision.allowed,
      reason: accessDecision.reason,
      scope: accessDecision.scope,
      requiredPermission
    },
    allowed: blockingReasons.length === 0,
    blockingReasons,
    validation: lifecycleValidation,
    currentSettings: {
      enabled: state.lifecycle.enabled,
      mode: state.lifecycle.mode,
      intervalMs: state.lifecycle.intervalMs,
      nextRunAt: state.lifecycle.nextRunAt,
      disabledReason: state.lifecycle.disabledReason
    },
    projectedSettings: {
      enabled: projectedSettings.enabled,
      mode: projectedSettings.mode,
      intervalMs: projectedSettings.intervalMs,
      nextRunAt: projectedSettings.nextRunAt,
      disabledReason: projectedSettings.disabledReason,
      lastConfiguredAt: projectedSettings.lastConfiguredAt
    },
    nextStateHint: {
      status: projectedSettings.enabled ? 'lifecycle-active' : 'disabled',
      scheduleDue: Boolean(scheduleDue),
      dueCommand: scheduleDue ? { op: 'record-checkpoint' } : null,
      followUpCommand: projectedSettings.enabled && projectedSettings.mode === 'scheduled'
        ? { op: 'schedule-audit', intervalMs: projectedSettings.intervalMs, nextRunAt: projectedSettings.nextRunAt }
        : null
    },
    proof: {
      digestAlgorithm: 'fnv1a32-stable-json',
      digest: stableDigest({
        surfaceId,
        boundaryKey: state.boundary.isolation.boundaryKey,
        op,
        requiredPermission,
        allowed: blockingReasons.length === 0,
        projectedSettings
      })
    }
  };
}

function normalizeCapabilityList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw
    .filter((capability) => typeof capability === 'string' && capability.trim() !== '')
    .map((capability) => capability.trim()))].sort();
}

function normalizeProviderSync(value = {}, fallback = DEFAULT_PROVIDER_CONTRACT.sync) {
  const raw = value && typeof value === 'object' ? value : {};
  const rawConsistency = asNonEmptyString(raw.consistency, fallback.consistency);
  const consistency = rawConsistency === 'strong' || rawConsistency === 'eventual' || rawConsistency === 'unknown'
    ? rawConsistency
    : fallback.consistency;

  return {
    cursor: asNonNegativeInteger(raw.cursor, fallback.cursor),
    generation: asNonNegativeInteger(raw.generation, fallback.generation),
    externalRevision: asNonEmptyString(raw.externalRevision, fallback.externalRevision),
    lastSyncedAt: asIsoTimestamp(raw.lastSyncedAt, fallback.lastSyncedAt),
    leaseExpiresAt: asIsoTimestamp(raw.leaseExpiresAt, fallback.leaseExpiresAt),
    consistency
  };
}

function normalizeProviderHandoffReceipt(value = {}, now, fallback = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const receiptId = asNonEmptyString(raw.receiptId ?? raw.id, fallback?.receiptId ?? null);
  const statusCandidate = asNonEmptyString(raw.status, fallback?.status ?? 'pending');
  const status = PROVIDER_HANDOFF_RECEIPT_STATUSES.includes(statusCandidate)
    ? statusCandidate
    : 'pending';

  if (!receiptId && !raw.acknowledgedAt && !raw.externalRevision && !raw.proofDigest) {
    return fallback;
  }

  return {
    receiptId: receiptId ?? `provider-handoff:${stableDigest({
      providerId: raw.providerId ?? fallback?.providerId ?? DEFAULT_PROVIDER_CONTRACT.providerId,
      checkpoint: raw.checkpoint ?? fallback?.checkpoint ?? EMPTY_CHECKPOINT,
      externalRevision: raw.externalRevision ?? fallback?.externalRevision ?? null
    }).split(':').at(-1)}`,
    providerId: asNonEmptyString(raw.providerId, fallback?.providerId ?? DEFAULT_PROVIDER_CONTRACT.providerId),
    target: asNonEmptyString(raw.target, fallback?.target ?? 'memory-manager/audit-sink'),
    status,
    acknowledgedAt: asIsoTimestamp(raw.acknowledgedAt ?? raw.at, fallback?.acknowledgedAt ?? now),
    externalRevision: asNonEmptyString(raw.externalRevision, fallback?.externalRevision ?? null),
    checkpoint: normalizeCheckpoint(raw.checkpoint ?? fallback?.checkpoint ?? EMPTY_CHECKPOINT),
    ledgerEntries: asNonNegativeInteger(raw.ledgerEntries, fallback?.ledgerEntries ?? 0),
    proofDigest: asNonEmptyString(raw.proofDigest ?? raw.digest, fallback?.proofDigest ?? null),
    rejectionReason: status === 'rejected'
      ? asNonEmptyString(raw.rejectionReason ?? raw.reason, fallback?.rejectionReason ?? 'provider-rejected-handoff')
      : null
  };
}

function normalizeProviderContract(value = {}, now) {
  const raw = value && typeof value === 'object' ? value : {};
  const requestedCapabilities = normalizeCapabilityList(
    raw.requestedCapabilities ?? raw.capabilities,
    DEFAULT_PROVIDER_CONTRACT.requestedCapabilities
  );
  const grantedCapabilities = requestedCapabilities
    .filter((capability) => SUPPORTED_PROVIDER_CAPABILITIES.includes(capability));
  const unsupportedCapabilities = requestedCapabilities
    .filter((capability) => !SUPPORTED_PROVIDER_CAPABILITIES.includes(capability));
  const missingRequiredCapabilities = REQUIRED_PROVIDER_CAPABILITIES
    .filter((capability) => !grantedCapabilities.includes(capability));
  const sync = normalizeProviderSync(raw.sync, DEFAULT_PROVIDER_CONTRACT.sync);
  const leaseValid = sync.leaseExpiresAt
    ? new Date(sync.leaseExpiresAt).getTime() > new Date(now).getTime()
    : false;

  return {
    providerId: asNonEmptyString(raw.providerId, DEFAULT_PROVIDER_CONTRACT.providerId),
    service: asNonEmptyString(raw.service, DEFAULT_PROVIDER_CONTRACT.service),
    version: asNonEmptyString(raw.version, DEFAULT_PROVIDER_CONTRACT.version),
    endpoint: asNonEmptyString(raw.endpoint, DEFAULT_PROVIDER_CONTRACT.endpoint),
    requestedCapabilities,
    grantedCapabilities,
    unsupportedCapabilities,
    missingRequiredCapabilities,
    negotiated: missingRequiredCapabilities.length === 0,
    lastNegotiatedAt: asIsoTimestamp(raw.lastNegotiatedAt, DEFAULT_PROVIDER_CONTRACT.lastNegotiatedAt),
    sync,
    handoffReceipt: normalizeProviderHandoffReceipt(raw.handoffReceipt ?? raw.receipt, now),
    lease: {
      valid: leaseValid,
      expiresAt: sync.leaseExpiresAt
    }
  };
}

function normalizeClientRuntime(value = {}, now) {
  const raw = value && typeof value === 'object' ? value : {};
  const rawHandoffMode = asNonEmptyString(raw.handoffMode ?? raw.mode, DEFAULT_CLIENT_RUNTIME.handoffMode);
  const handoffMode = rawHandoffMode === 'background' || rawHandoffMode === 'interactive'
    ? rawHandoffMode
    : DEFAULT_CLIENT_RUNTIME.handoffMode;
  const rawWorkflow = asNonEmptyString(raw.workflow, DEFAULT_CLIENT_RUNTIME.workflow);
  const workflow = rawWorkflow === 'handoff'
    || rawWorkflow === 'audit-review'
    || rawWorkflow === 'recovery'
    || rawWorkflow === 'provider-contract'
    || rawWorkflow === 'lifecycle'
    ? rawWorkflow
    : DEFAULT_CLIENT_RUNTIME.workflow;

  return {
    clientId: asNonEmptyString(raw.clientId, DEFAULT_CLIENT_RUNTIME.clientId),
    sessionId: asNonEmptyString(raw.sessionId, DEFAULT_CLIENT_RUNTIME.sessionId),
    requestId: asNonEmptyString(raw.requestId, DEFAULT_CLIENT_RUNTIME.requestId),
    route: asNonEmptyString(raw.route, DEFAULT_CLIENT_RUNTIME.route),
    workflow,
    handoffMode,
    lastSeenAt: asIsoTimestamp(raw.lastSeenAt ?? raw.observedAt, now),
    accepts: {
      commandReceipts: raw.accepts?.commandReceipts !== false,
      evidenceManifest: raw.accepts?.evidenceManifest !== false,
      externalHandoff: raw.accepts?.externalHandoff !== false
    }
  };
}

function commandClientInput(command = {}) {
  if (command.clientRuntime && typeof command.clientRuntime === 'object') {
    return command.clientRuntime;
  }

  if (command.client && typeof command.client === 'object') {
    return command.client;
  }

  if (command.request && typeof command.request === 'object') {
    return command.request;
  }

  return {};
}

function routeForClientWorkflow(workflow, fallback = DEFAULT_CLIENT_RUNTIME.route) {
  if (workflow === 'handoff') {
    return CLIENT_HANDOFF_ROUTES.ready;
  }

  if (workflow === 'recovery') {
    return CLIENT_HANDOFF_ROUTES.recover;
  }

  if (workflow === 'provider-contract') {
    return CLIENT_HANDOFF_ROUTES.provider;
  }

  if (workflow === 'lifecycle') {
    return CLIENT_HANDOFF_ROUTES.disabled;
  }

  if (workflow === 'audit-review') {
    return CLIENT_HANDOFF_ROUTES.review;
  }

  return fallback;
}

function projectClientRuntimeAfterCommand(command = {}, state, now) {
  const rawClient = commandClientInput(command);
  const op = typeof command?.op === 'string' ? command.op : 'noop';
  const fallback = state.clientRuntime ?? DEFAULT_CLIENT_RUNTIME;
  const runtime = normalizeClientRuntime({
    ...fallback,
    ...rawClient,
    requestId: rawClient.requestId ?? command.requestId ?? command.id ?? fallback.requestId,
    observedAt: rawClient.observedAt ?? rawClient.lastSeenAt ?? command.at ?? now
  }, now);
  const workflow = op === 'handoff-audit'
    ? 'handoff'
    : op === 'recover' || op === 'report-failure' || op === 'enter-degraded-mode' || op === 'clear-degraded-mode'
      ? 'recovery'
      : op === 'negotiate-provider-contract'
        || op === 'update-provider-sync'
        || op === 'acknowledge-provider-handoff'
        ? 'provider-contract'
        : op === 'configure-lifecycle'
          || op === 'enable-audit'
          || op === 'disable-audit'
          || op === 'schedule-audit'
          ? 'lifecycle'
          : runtime.workflow;

  return normalizeClientRuntime({
    ...runtime,
    workflow,
    route: rawClient.route ?? routeForClientWorkflow(workflow, runtime.route),
    lastSeenAt: now
  }, now);
}

function clientRouteForCommandResult(result, state) {
  if (result.reason === 'audit-disabled' || !state.lifecycle.enabled) {
    return CLIENT_HANDOFF_ROUTES.disabled;
  }

  if (result.reason === 'permission-denied'
    || result.reason === 'boundary-mismatch'
    || state.boundaryViolations.length > 0) {
    return CLIENT_HANDOFF_ROUTES.review;
  }

  if (result.reason?.startsWith?.('provider-') || !state.providerContract.negotiated) {
    return CLIENT_HANDOFF_ROUTES.provider;
  }

  if (state.degradedMode || state.lastFailure || result.reason === 'invalid-failure-report') {
    return CLIENT_HANDOFF_ROUTES.recover;
  }

  if (state.auditHandoff && result.applied) {
    return CLIENT_HANDOFF_ROUTES.ready;
  }

  return CLIENT_HANDOFF_ROUTES.review;
}

function viewForClientRoute(route) {
  if (route === CLIENT_HANDOFF_ROUTES.ready) {
    return CLIENT_COMMAND_HANDOFF_VIEWS.ready;
  }

  if (route === CLIENT_HANDOFF_ROUTES.provider) {
    return CLIENT_COMMAND_HANDOFF_VIEWS.provider;
  }

  if (route === CLIENT_HANDOFF_ROUTES.recover) {
    return CLIENT_COMMAND_HANDOFF_VIEWS.recover;
  }

  if (route === CLIENT_HANDOFF_ROUTES.disabled) {
    return CLIENT_COMMAND_HANDOFF_VIEWS.disabled;
  }

  return CLIENT_COMMAND_HANDOFF_VIEWS.review;
}

function buildCommandClientWorkflowHandoff(command, result, state, now, commandBoundary) {
  const clientRuntime = projectClientRuntimeAfterCommand(command, state, now);
  const route = clientRouteForCommandResult(result, state);
  const commandReceiptCursor = result.id ?? commandId(command);
  const requiredClientState = {
    boundaryKey: state.boundary.isolation.boundaryKey,
    checkpoint: state.checkpoint,
    providerId: state.providerContract.providerId,
    commandReceiptCursor,
    statusAfter: buildStatus(state)
  };
  const acknowledgementRequired = result.applied
    && route === CLIENT_HANDOFF_ROUTES.ready
    && clientRuntime.handoffMode === 'interactive';
  const primaryCommand = route === CLIENT_HANDOFF_ROUTES.disabled
    ? { op: 'enable-audit' }
    : route === CLIENT_HANDOFF_ROUTES.provider
      ? { op: 'negotiate-provider-contract', requestedCapabilities: REQUIRED_PROVIDER_CAPABILITIES }
      : route === CLIENT_HANDOFF_ROUTES.recover
        ? { op: state.degradedMode ? 'recover' : state.lastFailure?.op ?? 'recover' }
        : state.dirty
          ? { op: 'mark-flushed' }
          : state.auditHandoff
            ? {
                op: 'handoff-audit',
                target: state.auditHandoff.target,
                checkpoint: state.auditHandoff.checkpoint
              }
            : null;

  return {
    schema: 'memory-audit-command-client-handoff.v1',
    generatedAt: now,
    client: {
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      requestId: clientRuntime.requestId,
      requestedRoute: clientRuntime.route,
      requestedWorkflow: clientRuntime.workflow,
      handoffMode: clientRuntime.handoffMode,
      accepts: clientRuntime.accepts
    },
    route,
    view: viewForClientRoute(route),
    command: {
      id: commandReceiptCursor,
      op: result.op ?? command?.op ?? 'noop',
      applied: result.applied === true,
      reason: result.reason ?? (result.applied ? 'applied' : 'rejected')
    },
    primaryAction: {
      action: result.applied ? 'continue-workflow' : 'review-command-rejection',
      reason: result.reason ?? (result.applied ? 'applied' : 'rejected'),
      command: primaryCommand
    },
    requiredClientState,
    acknowledgement: {
      required: acknowledgementRequired,
      payload: {
        handoffToken: stableDigest({
          surfaceId,
          clientId: clientRuntime.clientId,
          sessionId: clientRuntime.sessionId,
          commandReceiptCursor,
          boundaryKey: state.boundary.isolation.boundaryKey,
          checkpoint: state.checkpoint,
          route
        }),
        boundaryKey: state.boundary.isolation.boundaryKey,
        checkpointGeneration: state.checkpoint.generation,
        providerId: state.providerContract.providerId,
        commandReceiptCursor
      }
    },
    boundary: {
      actorId: commandBoundary.actorId,
      role: commandBoundary.role,
      permissionSource: commandBoundary.permissionClaims.source
    },
    proof: {
      digestAlgorithm: 'fnv1a32-stable-json',
      digest: stableDigest({
        surfaceId,
        route,
        view: viewForClientRoute(route),
        commandReceiptCursor,
        clientId: clientRuntime.clientId,
        sessionId: clientRuntime.sessionId,
        requiredClientState,
        acknowledgementRequired
      })
    }
  };
}

function normalizeRetryState(value = {}, now) {
  const attempts = asNonNegativeInteger(value.attempts, 0);
  const maxAttempts = asNonNegativeInteger(value.maxAttempts, MAX_RETRY_ATTEMPTS) || MAX_RETRY_ATTEMPTS;

  return {
    attempts,
    maxAttempts,
    nextRetryAt: asIsoTimestamp(value.nextRetryAt, null),
    backoffMs: asNonNegativeInteger(value.backoffMs, retryBackoffMs(attempts)),
    lastFailure: normalizeFailure(value.lastFailure, now)
  };
}

function normalizeHistorySnapshot(value = {}, index, now) {
  const status = asNonEmptyString(value.status, 'unknown');
  const ledgerEntries = asNonNegativeInteger(value.ledgerEntries, 0);
  const boundaryViolations = asNonNegativeInteger(value.boundaryViolations, 0);
  const failures = asNonNegativeInteger(value.failures, 0);

  return {
    id: asNonEmptyString(value.id, `history-${index}`),
    capturedAt: asIsoTimestamp(value.capturedAt ?? value.at, now),
    status,
    checkpoint: normalizeCheckpoint(value.checkpoint),
    ledgerEntries,
    boundaryViolations,
    failures,
    degraded: Boolean(value.degraded),
    dirty: Boolean(value.dirty),
    exportable: status !== 'degraded' && boundaryViolations === 0,
    counters: value.counters && typeof value.counters === 'object'
      ? {
          commandsApplied: asNonNegativeInteger(value.counters.commandsApplied, 0),
          commandsRejected: asNonNegativeInteger(value.counters.commandsRejected, 0),
          proofs: asNonNegativeInteger(value.counters.proofs, 0),
          handoffs: asNonNegativeInteger(value.counters.handoffs, 0)
        }
      : null
  };
}

function normalizeCommandReceipt(value = {}, index, now) {
  const id = asNonEmptyString(value.id, `command-${index}`);
  const applied = value.applied === true;
  const reason = asNonEmptyString(value.reason, applied ? 'applied' : 'rejected');
  const op = asNonEmptyString(value.op, 'unknown');
  const boundary = normalizeBoundary(value.boundary, DEFAULT_BOUNDARY);

  return {
    id,
    op,
    at: asIsoTimestamp(value.at, now),
    applied,
    reason,
    idempotent: value.idempotent !== false,
    boundary,
    permissionClaims: value.permissionClaims && typeof value.permissionClaims === 'object'
      ? {
          role: asNonEmptyString(value.permissionClaims.role, boundary.role),
          source: asNonEmptyString(value.permissionClaims.source, boundary.permissionClaims.source),
          requested: normalizePermissionList(value.permissionClaims.requested),
          effective: normalizePermissionList(value.permissionClaims.effective),
          denied: normalizePermissionList(value.permissionClaims.denied),
          unknown: normalizePermissionList(value.permissionClaims.unknown)
        }
      : boundary.permissionClaims,
    accessDecision: value.accessDecision && typeof value.accessDecision === 'object'
      ? {
          allowed: value.accessDecision.allowed === true,
          reason: asNonEmptyString(value.accessDecision.reason, reason),
          scope: asNonEmptyString(value.accessDecision.scope, 'workspace'),
          requiredPermission: asNonEmptyString(value.accessDecision.requiredPermission, null)
        }
      : null,
    lifecycleValidation: value.lifecycleValidation && typeof value.lifecycleValidation === 'object'
      ? {
          ok: value.lifecycleValidation.ok !== false,
          findings: Array.isArray(value.lifecycleValidation.findings)
            ? value.lifecycleValidation.findings
            : []
        }
      : null,
    lifecycleControl: value.lifecycleControl && typeof value.lifecycleControl === 'object'
      ? {
          schema: asNonEmptyString(value.lifecycleControl.schema, 'memory-audit-lifecycle-command.v1'),
          op: asNonEmptyString(value.lifecycleControl.op, op),
          generatedAt: asIsoTimestamp(value.lifecycleControl.generatedAt, now),
          requiredPermission: asNonEmptyString(value.lifecycleControl.requiredPermission, null),
          allowed: value.lifecycleControl.allowed === true,
          blockingReasons: normalizePermissionList(value.lifecycleControl.blockingReasons),
          validation: value.lifecycleControl.validation && typeof value.lifecycleControl.validation === 'object'
            ? {
                ok: value.lifecycleControl.validation.ok !== false,
                findings: Array.isArray(value.lifecycleControl.validation.findings)
                  ? value.lifecycleControl.validation.findings
                  : []
              }
            : null,
          currentSettings: value.lifecycleControl.currentSettings && typeof value.lifecycleControl.currentSettings === 'object'
            ? normalizeLifecycleSettings(value.lifecycleControl.currentSettings, now)
            : null,
          projectedSettings: value.lifecycleControl.projectedSettings && typeof value.lifecycleControl.projectedSettings === 'object'
            ? normalizeLifecycleSettings(value.lifecycleControl.projectedSettings, now)
            : null,
          nextStateHint: value.lifecycleControl.nextStateHint && typeof value.lifecycleControl.nextStateHint === 'object'
            ? {
                status: asNonEmptyString(value.lifecycleControl.nextStateHint.status, 'unknown'),
                scheduleDue: value.lifecycleControl.nextStateHint.scheduleDue === true,
                dueCommand: value.lifecycleControl.nextStateHint.dueCommand ?? null,
                followUpCommand: value.lifecycleControl.nextStateHint.followUpCommand ?? null
              }
            : null,
          proof: value.lifecycleControl.proof && typeof value.lifecycleControl.proof === 'object'
            ? {
                digestAlgorithm: asNonEmptyString(value.lifecycleControl.proof.digestAlgorithm, 'fnv1a32-stable-json'),
                digest: asNonEmptyString(value.lifecycleControl.proof.digest, null)
              }
            : null
        }
      : null,
    providerServiceContract: value.providerServiceContract && typeof value.providerServiceContract === 'object'
      ? {
          schema: asNonEmptyString(value.providerServiceContract.schema, 'memory-audit-provider-service-contract.v1'),
          generatedAt: asIsoTimestamp(value.providerServiceContract.generatedAt, now),
          providerId: asNonEmptyString(value.providerServiceContract.providerId, null),
          service: asNonEmptyString(value.providerServiceContract.service, null),
          phase: asNonEmptyString(value.providerServiceContract.phase, 'unknown'),
          ready: value.providerServiceContract.ready === true,
          blockers: normalizePermissionList(value.providerServiceContract.blockers),
          nextCommand: value.providerServiceContract.nextCommand ?? null,
          proof: value.providerServiceContract.proof && typeof value.providerServiceContract.proof === 'object'
            ? {
                digestAlgorithm: asNonEmptyString(value.providerServiceContract.proof.digestAlgorithm, 'fnv1a32-stable-json'),
                digest: asNonEmptyString(value.providerServiceContract.proof.digest, null)
              }
            : null
        }
      : null,
    clientWorkflowHandoff: value.clientWorkflowHandoff && typeof value.clientWorkflowHandoff === 'object'
      ? {
          schema: asNonEmptyString(value.clientWorkflowHandoff.schema, 'memory-audit-command-client-handoff.v1'),
          generatedAt: asIsoTimestamp(value.clientWorkflowHandoff.generatedAt, now),
          client: value.clientWorkflowHandoff.client && typeof value.clientWorkflowHandoff.client === 'object'
            ? {
                clientId: asNonEmptyString(value.clientWorkflowHandoff.client.clientId, DEFAULT_CLIENT_RUNTIME.clientId),
                sessionId: asNonEmptyString(value.clientWorkflowHandoff.client.sessionId, DEFAULT_CLIENT_RUNTIME.sessionId),
                requestId: asNonEmptyString(value.clientWorkflowHandoff.client.requestId, null),
                requestedRoute: asNonEmptyString(value.clientWorkflowHandoff.client.requestedRoute, DEFAULT_CLIENT_RUNTIME.route),
                requestedWorkflow: asNonEmptyString(value.clientWorkflowHandoff.client.requestedWorkflow, DEFAULT_CLIENT_RUNTIME.workflow),
                handoffMode: asNonEmptyString(value.clientWorkflowHandoff.client.handoffMode, DEFAULT_CLIENT_RUNTIME.handoffMode),
                accepts: {
                  commandReceipts: value.clientWorkflowHandoff.client.accepts?.commandReceipts !== false,
                  evidenceManifest: value.clientWorkflowHandoff.client.accepts?.evidenceManifest !== false,
                  externalHandoff: value.clientWorkflowHandoff.client.accepts?.externalHandoff !== false
                }
              }
            : null,
          route: asNonEmptyString(value.clientWorkflowHandoff.route, CLIENT_HANDOFF_ROUTES.review),
          view: asNonEmptyString(value.clientWorkflowHandoff.view, CLIENT_COMMAND_HANDOFF_VIEWS.review),
          command: value.clientWorkflowHandoff.command && typeof value.clientWorkflowHandoff.command === 'object'
            ? {
                id: asNonEmptyString(value.clientWorkflowHandoff.command.id, id),
                op: asNonEmptyString(value.clientWorkflowHandoff.command.op, op),
                applied: value.clientWorkflowHandoff.command.applied === true,
                reason: asNonEmptyString(value.clientWorkflowHandoff.command.reason, reason)
              }
            : null,
          primaryAction: value.clientWorkflowHandoff.primaryAction && typeof value.clientWorkflowHandoff.primaryAction === 'object'
            ? {
                action: asNonEmptyString(value.clientWorkflowHandoff.primaryAction.action, 'continue-workflow'),
                reason: asNonEmptyString(value.clientWorkflowHandoff.primaryAction.reason, reason),
                command: value.clientWorkflowHandoff.primaryAction.command ?? null
              }
            : null,
          requiredClientState: value.clientWorkflowHandoff.requiredClientState && typeof value.clientWorkflowHandoff.requiredClientState === 'object'
            ? {
                boundaryKey: asNonEmptyString(value.clientWorkflowHandoff.requiredClientState.boundaryKey, boundary.isolation.boundaryKey),
                checkpoint: normalizeCheckpoint(value.clientWorkflowHandoff.requiredClientState.checkpoint),
                providerId: asNonEmptyString(value.clientWorkflowHandoff.requiredClientState.providerId, DEFAULT_PROVIDER_CONTRACT.providerId),
                commandReceiptCursor: asNonEmptyString(value.clientWorkflowHandoff.requiredClientState.commandReceiptCursor, id),
                statusAfter: asNonEmptyString(value.clientWorkflowHandoff.requiredClientState.statusAfter, 'unknown')
              }
            : null,
          acknowledgement: value.clientWorkflowHandoff.acknowledgement && typeof value.clientWorkflowHandoff.acknowledgement === 'object'
            ? {
                required: value.clientWorkflowHandoff.acknowledgement.required === true,
                payload: value.clientWorkflowHandoff.acknowledgement.payload && typeof value.clientWorkflowHandoff.acknowledgement.payload === 'object'
                  ? {
                      handoffToken: asNonEmptyString(value.clientWorkflowHandoff.acknowledgement.payload.handoffToken, null),
                      boundaryKey: asNonEmptyString(value.clientWorkflowHandoff.acknowledgement.payload.boundaryKey, boundary.isolation.boundaryKey),
                      checkpointGeneration: asNonNegativeInteger(value.clientWorkflowHandoff.acknowledgement.payload.checkpointGeneration, 0),
                      providerId: asNonEmptyString(value.clientWorkflowHandoff.acknowledgement.payload.providerId, DEFAULT_PROVIDER_CONTRACT.providerId),
                      commandReceiptCursor: asNonEmptyString(value.clientWorkflowHandoff.acknowledgement.payload.commandReceiptCursor, id)
                    }
                  : null
              }
            : null,
          boundary: value.clientWorkflowHandoff.boundary && typeof value.clientWorkflowHandoff.boundary === 'object'
            ? {
                actorId: asNonEmptyString(value.clientWorkflowHandoff.boundary.actorId, boundary.actorId),
                role: asNonEmptyString(value.clientWorkflowHandoff.boundary.role, boundary.role),
                permissionSource: asNonEmptyString(
                  value.clientWorkflowHandoff.boundary.permissionSource,
                  boundary.permissionClaims.source
                )
              }
            : null,
          proof: value.clientWorkflowHandoff.proof && typeof value.clientWorkflowHandoff.proof === 'object'
            ? {
                digestAlgorithm: asNonEmptyString(value.clientWorkflowHandoff.proof.digestAlgorithm, 'fnv1a32-stable-json'),
                digest: asNonEmptyString(value.clientWorkflowHandoff.proof.digest, null)
              }
            : null
        }
      : null,
    checkpoint: normalizeCheckpoint(value.checkpoint),
    ledgerEntries: asNonNegativeInteger(value.ledgerEntries, 0),
    dirty: Boolean(value.dirty),
    statusAfter: asNonEmptyString(value.statusAfter, 'unknown')
  };
}

function appendHistorySnapshot(history, snapshot) {
  const normalized = [...history, snapshot]
    .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());

  return normalized.slice(Math.max(0, normalized.length - MAX_HISTORY_SNAPSHOTS));
}

function appendCommandReceipt(receipts, receipt) {
  const withoutPrior = receipts.filter((candidate) => candidate.id !== receipt.id);
  const nextReceipts = [...withoutPrior, receipt]
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  return nextReceipts.slice(Math.max(0, nextReceipts.length - MAX_COMMAND_RECEIPTS));
}

function opFromCommandLogId(id) {
  const [op] = String(id).split(':');
  return asNonEmptyString(op, 'unknown');
}

function buildRecoveredCommandReceipt(id, index, state, now) {
  const op = opFromCommandLogId(id);
  const recoveryAccessDecision = {
    allowed: false,
    reason: 'receipt-recovered-from-command-log',
    scope: 'workspace',
    requiredPermission: operationPermission(op)
  };

  return normalizeCommandReceipt({
    id,
    op,
    at: now,
    applied: false,
    reason: 'receipt-recovered-from-command-log',
    idempotent: true,
    boundary: state.boundary,
    permissionClaims: state.boundary.permissionClaims,
    accessDecision: recoveryAccessDecision,
    checkpoint: state.checkpoint,
    ledgerEntries: state.ledger.length,
    dirty: state.dirty,
    statusAfter: 'receipt-recovery-review'
  }, index, now);
}

function alignCommandReceiptsWithLog(state, now) {
  const receiptIds = new Set(state.commandReceipts.map((receipt) => receipt.id));
  const missingReceiptIds = state.commandLog.filter((id) => !receiptIds.has(id));
  const commandLogIds = new Set(state.commandLog);
  const staleReceiptIds = state.commandReceipts
    .filter((receipt) => !commandLogIds.has(receipt.id))
    .map((receipt) => receipt.id);
  const recoveredReceipts = missingReceiptIds.map((id, index) => (
    buildRecoveredCommandReceipt(id, state.commandReceipts.length + index, state, now)
  ));
  const commandReceipts = recoveredReceipts.reduce(
    (receipts, receipt) => appendCommandReceipt(receipts, receipt),
    state.commandReceipts
  );
  const retainedReceiptIds = new Set(commandReceipts.map((receipt) => receipt.id));

  return {
    ...state,
    commandReceipts,
    dirty: state.dirty || recoveredReceipts.length > 0,
    receiptRecovery: {
      schema: 'memory-audit-receipt-recovery.v1',
      observedAt: now,
      aligned: missingReceiptIds.length === 0,
      commandLogCount: state.commandLog.length,
      receiptCount: commandReceipts.length,
      missingReceiptIds,
      recoveredReceiptIds: recoveredReceipts.map((receipt) => receipt.id),
      staleReceiptIds,
      truncatedReceiptIds: state.commandLog.filter((id) => !retainedReceiptIds.has(id)),
      proof: {
        digestAlgorithm: 'fnv1a32-stable-json',
        digest: stableDigest({
          surfaceId,
          boundaryKey: state.boundary.isolation.boundaryKey,
          commandLog: state.commandLog,
          missingReceiptIds,
          recoveredReceiptIds: recoveredReceipts.map((receipt) => receipt.id),
          staleReceiptIds
        })
      }
    }
  };
}

function buildRetryState(failure, previousRetry, now) {
  const previousAttempts = previousRetry?.lastFailure?.code === failure.code
    ? previousRetry.attempts
    : 0;
  const attempts = previousAttempts + 1;
  const maxAttempts = previousRetry?.maxAttempts ?? MAX_RETRY_ATTEMPTS;
  const backoffMs = retryBackoffMs(attempts);

  return {
    attempts,
    maxAttempts,
    nextRetryAt: new Date(new Date(now).getTime() + backoffMs).toISOString(),
    backoffMs,
    lastFailure: failure
  };
}

function normalizeLedgerEntry(entry, index, now, boundary = DEFAULT_BOUNDARY) {
  const id = typeof entry?.id === 'string' && entry.id.trim() !== ''
    ? entry.id
    : `recovered-${index}`;
  const kind = typeof entry?.kind === 'string' && entry.kind.trim() !== ''
    ? entry.kind
    : 'unknown';

  return {
    id,
    kind,
    at: asIsoTimestamp(entry?.at, now),
    scope: typeof entry?.scope === 'string' && entry.scope.trim() !== '' ? entry.scope : surfaceGroup,
    proof: typeof entry?.proof === 'string' && entry.proof.trim() !== '' ? entry.proof : null,
    boundary: normalizeBoundary(entry?.boundary, boundary),
    handoff: entry?.handoff && typeof entry.handoff === 'object'
      ? {
          target: asNonEmptyString(entry.handoff.target, null),
          reason: asNonEmptyString(entry.handoff.reason, 'unspecified'),
          at: asIsoTimestamp(entry.handoff.at, now)
        }
      : null
  };
}

function shapePersistedState(input = {}, now) {
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : {};
  const boundary = normalizeBoundary(
    persisted.boundary && typeof persisted.boundary === 'object' ? persisted.boundary : input.boundary,
    DEFAULT_BOUNDARY
  );
  const rawLedger = Array.isArray(persisted.ledger) ? persisted.ledger : [];
  const ledger = rawLedger
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => normalizeLedgerEntry(entry, index, now, boundary));
  const checkpoint = normalizeCheckpoint(persisted.checkpoint);
  const schemaVersion = asNonNegativeInteger(persisted.schemaVersion, SCHEMA_VERSION);
  const commandLog = Array.isArray(persisted.commandLog)
    ? [...new Set(persisted.commandLog
        .filter((id) => typeof id === 'string' && id.trim() !== '')
        .map((id) => id.trim()))]
    : [];
  const baseState = {
    schemaVersion: schemaVersion === 0 ? SCHEMA_VERSION : schemaVersion,
    boundary,
    checkpoint,
    ledger,
    commandLog,
    commandReceipts: Array.isArray(persisted.commandReceipts)
      ? persisted.commandReceipts
          .filter((receipt) => receipt && typeof receipt === 'object')
          .map((receipt, index) => normalizeCommandReceipt({
            ...receipt,
            boundary: receipt.boundary ?? boundary
          }, index, now))
          .slice(-MAX_COMMAND_RECEIPTS)
      : [],
    boundaryViolations: Array.isArray(persisted.boundaryViolations)
      ? persisted.boundaryViolations.filter((entry) => entry && typeof entry === 'object')
      : [],
    auditHandoff: persisted.auditHandoff && typeof persisted.auditHandoff === 'object'
      ? {
          target: asNonEmptyString(persisted.auditHandoff.target, null),
          reason: asNonEmptyString(persisted.auditHandoff.reason, 'unspecified'),
          at: asIsoTimestamp(persisted.auditHandoff.at, now),
          checkpoint: normalizeCheckpoint(persisted.auditHandoff.checkpoint)
      }
      : null,
    lastRecoveredAt: asIsoTimestamp(persisted.lastRecoveredAt, null),
    degradedMode: Boolean(persisted.degradedMode),
    lastFailure: normalizeFailure(persisted.lastFailure, now),
    retry: normalizeRetryState(persisted.retry, now),
    lifecycle: normalizeLifecycleSettings(persisted.lifecycle, now),
    providerContract: normalizeProviderContract(
      persisted.providerContract && typeof persisted.providerContract === 'object'
        ? persisted.providerContract
        : input.providerContract,
      now
    ),
    clientRuntime: normalizeClientRuntime(
      persisted.clientRuntime && typeof persisted.clientRuntime === 'object'
        ? persisted.clientRuntime
        : input.clientRuntime ?? input.client,
      now
    ),
    history: Array.isArray(persisted.history)
      ? persisted.history
          .filter((snapshot) => snapshot && typeof snapshot === 'object')
          .map((snapshot, index) => normalizeHistorySnapshot(snapshot, index, now))
          .slice(-MAX_HISTORY_SNAPSHOTS)
      : [],
    dirty: Boolean(persisted.dirty),
    receiptRecovery: null
  };

  return alignCommandReceiptsWithLog(baseState, now);
}

function commandId(command) {
  if (typeof command?.id === 'string' && command.id.trim() !== '') {
    return command.id;
  }

  const op = typeof command?.op === 'string' ? command.op : 'noop';
  const cursor = command?.checkpoint?.cursor ?? command?.cursor ?? 'none';
  const generation = command?.checkpoint?.generation ?? command?.generation ?? 'none';
  return `${op}:${cursor}:${generation}`;
}

function rejectCommand(state, command, now, reason, detail = {}) {
  const violation = {
    id: commandId(command),
    op: typeof command?.op === 'string' ? command.op : 'noop',
    at: now,
    reason,
    ...detail
  };
  const accessDecision = detail.accessDecision ?? {
    allowed: false,
    reason,
    scope: detail.scope ?? 'workspace',
    requiredPermission: detail.requiredPermission ?? null,
    permissionClaims: detail.boundary?.permissionClaims ?? null
  };

  const result = {
    id: violation.id,
    applied: false,
    reason,
    op: violation.op,
    boundary: detail.boundary ?? null,
    requiredPermission: detail.requiredPermission ?? null,
    accessDecision,
    permissionClaims: accessDecision.permissionClaims ?? detail.boundary?.permissionClaims ?? null,
    lifecycleValidation: detail.lifecycleValidation ?? null,
    lifecycleControl: detail.lifecycleControl ?? null,
    idempotent: true
  };
  const rejectedClientRuntime = projectClientRuntimeAfterCommand(command, state, now);
  const receiptState = {
    ...state,
    clientRuntime: rejectedClientRuntime,
    boundaryViolations: [...state.boundaryViolations, violation]
  };
  const rejectedState = {
    ...state,
    clientRuntime: rejectedClientRuntime,
    commandLog: state.commandLog.includes(violation.id)
      ? state.commandLog
      : [...state.commandLog, violation.id],
    commandReceipts: appendCommandReceipt(state.commandReceipts, buildCommandReceipt(
      command,
      result,
      receiptState,
      now,
      detail.boundary ?? state.boundary
    )),
    boundaryViolations: [...state.boundaryViolations, violation]
  };

  return { state: rejectedState, result };
}

function buildAuditHandoff(command, state, now, commandBoundary) {
  const restartSafe = state.lifecycle.enabled && !state.dirty;
  const handoffPermission = operationPermission('handoff-audit');
  const boundaryAccess = evaluateBoundaryAccess(state.boundary, commandBoundary, handoffPermission);

  return {
    target: asNonEmptyString(command?.target, 'memory-manager/audit-sink'),
    reason: asNonEmptyString(command?.reason, 'checkpoint-boundary-transfer'),
    at: now,
    checkpoint: normalizeCheckpoint(command?.checkpoint ?? state.checkpoint),
    ledgerEntries: state.ledger.length,
    boundary: commandBoundary,
    proof: {
      surfaceId,
      schemaVersion: state.schemaVersion,
      checkpointGeneration: state.checkpoint.generation,
      restartSafe,
      boundaryAccess: {
        allowed: boundaryAccess.allowed,
        reason: boundaryAccess.reason,
        scope: boundaryAccess.scope,
        requiredPermission: handoffPermission
      },
      permissionClaims: {
        role: commandBoundary.permissionClaims.role,
        source: commandBoundary.permissionClaims.source,
        effective: commandBoundary.permissionClaims.effective,
        denied: commandBoundary.permissionClaims.denied,
        unknown: commandBoundary.permissionClaims.unknown
      }
    }
  };
}

function commandAllowedWhenDisabled(op) {
  return op === 'enable-audit'
    || op === 'configure-lifecycle'
    || op === 'recover'
    || op === 'clear-degraded-mode';
}

function buildCommandReceipt(command, result, state, now, commandBoundary) {
  const accessDecision = result.accessDecision ?? evaluateBoundaryAccess(
    state.boundary,
    commandBoundary,
    operationPermission(result.op ?? command?.op)
  );

  return normalizeCommandReceipt({
    id: result.id,
    op: result.op ?? command?.op ?? 'noop',
    at: now,
    applied: result.applied,
    reason: result.reason ?? (result.applied ? 'applied' : 'rejected'),
    idempotent: result.idempotent !== false,
    boundary: commandBoundary,
    permissionClaims: commandBoundary.permissionClaims,
    accessDecision,
    lifecycleValidation: result.lifecycleValidation ?? null,
    lifecycleControl: result.lifecycleControl ?? null,
    providerServiceContract: result.providerServiceContract ?? null,
    clientWorkflowHandoff: result.clientWorkflowHandoff
      ?? buildCommandClientWorkflowHandoff(command, result, state, now, commandBoundary),
    checkpoint: state.checkpoint,
    ledgerEntries: state.ledger.length,
    dirty: state.dirty,
    statusAfter: buildStatus(state)
  }, state.commandReceipts.length, now);
}

function applyCommand(state, command, now) {
  const id = commandId(command);
  if (state.commandLog.includes(id)) {
    const previousReceipt = state.commandReceipts.find((receipt) => receipt.id === id) ?? null;
    return {
      state,
      result: {
        id,
        applied: false,
        reason: 'duplicate',
        op: previousReceipt?.op ?? command?.op ?? null,
        idempotent: true,
        previousReceipt
      }
    };
  }

  const op = typeof command?.op === 'string' ? command.op : 'noop';
  const commandBoundary = normalizeBoundary(command?.boundary, state.boundary);
  const requiredPermission = operationPermission(op);
  const accessDecision = evaluateBoundaryAccess(state.boundary, commandBoundary, requiredPermission);

  if (!accessDecision.allowed && accessDecision.reason === 'boundary-mismatch') {
    return rejectCommand(state, command, now, accessDecision.reason, {
      boundary: commandBoundary,
      accessDecision,
      scope: accessDecision.scope,
      expectedTenantId: accessDecision.expectedTenantId,
      expectedWorkspaceId: accessDecision.expectedWorkspaceId,
      actualTenantId: accessDecision.actualTenantId,
      actualWorkspaceId: accessDecision.actualWorkspaceId
    });
  }

  if (!accessDecision.allowed && accessDecision.reason === 'permission-denied') {
    return rejectCommand(state, command, now, accessDecision.reason, {
      boundary: commandBoundary,
      accessDecision,
      scope: accessDecision.scope,
      requiredPermission
    });
  }

  if (!state.lifecycle.enabled && !commandAllowedWhenDisabled(op)) {
    return rejectCommand(state, command, now, 'audit-disabled', {
      boundary: commandBoundary,
      disabledReason: state.lifecycle.disabledReason
    });
  }

  const lifecycleCommandValidation = op === 'configure-lifecycle'
    || op === 'enable-audit'
    || op === 'disable-audit'
    || op === 'schedule-audit'
    ? validateLifecycleCommand(command, state, now)
    : null;
  const lifecycleControl = lifecycleCommandValidation
    ? buildLifecycleCommandContract(state, now, command, commandBoundary)
    : null;

  if (lifecycleCommandValidation) {
    const blockingFinding = lifecycleCommandValidation.findings.find((finding) => finding.severity === 'error');

    if (blockingFinding) {
      return rejectCommand(state, command, now, blockingFinding.code, {
        boundary: commandBoundary,
        requiredPermission,
        lifecycleValidation: lifecycleCommandValidation,
        lifecycleControl
      });
    }
  }

  const next = {
    ...state,
    checkpoint: { ...state.checkpoint },
    ledger: [...state.ledger],
    commandLog: [...state.commandLog, id],
    commandReceipts: [...state.commandReceipts],
    lifecycle: { ...state.lifecycle },
    providerContract: { ...state.providerContract },
    clientRuntime: projectClientRuntimeAfterCommand(command, state, now)
  };

  if (op === 'configure-lifecycle') {
    next.lifecycle = normalizeLifecycleSettings({
      ...next.lifecycle,
      ...command.lifecycle,
      lastConfiguredAt: now
    }, now);
    next.dirty = true;
  } else if (op === 'enable-audit') {
    next.lifecycle = normalizeLifecycleSettings({
      ...next.lifecycle,
      enabled: true,
      disabledReason: null,
      lastConfiguredAt: now
    }, now);
    next.dirty = true;
  } else if (op === 'disable-audit') {
    next.lifecycle = normalizeLifecycleSettings({
      ...next.lifecycle,
      enabled: false,
      disabledReason: asNonEmptyString(command.reason, 'operator-disabled'),
      lastConfiguredAt: now
    }, now);
    next.dirty = true;
  } else if (op === 'schedule-audit') {
    const intervalMs = command.intervalMs === undefined
      ? next.lifecycle.intervalMs
      : clampAuditIntervalMs(command.intervalMs, next.lifecycle.intervalMs);
    next.lifecycle = normalizeLifecycleSettings({
      ...next.lifecycle,
      mode: 'scheduled',
      intervalMs,
      nextRunAt: command.nextRunAt,
      lastConfiguredAt: now
    }, now);
    next.dirty = true;
  } else if (op === 'record-checkpoint') {
    next.checkpoint = normalizeCheckpoint({
      ...next.checkpoint,
      ...command.checkpoint,
      cursor: command.cursor ?? command.checkpoint?.cursor ?? next.checkpoint.cursor,
      generation: command.generation ?? command.checkpoint?.generation ?? next.checkpoint.generation
    });
    next.dirty = true;
  } else if (op === 'append-ledger-entry') {
    next.ledger.push(normalizeLedgerEntry(command.entry, next.ledger.length, now, commandBoundary));
    next.dirty = true;
  } else if (op === 'mark-flushed') {
    next.dirty = false;
    next.lastFailure = null;
    next.retry = normalizeRetryState({}, now);
    next.lifecycle = normalizeLifecycleSettings({
      ...next.lifecycle,
      lastRunAt: now,
      nextRunAt: next.lifecycle.mode === 'scheduled'
        ? new Date(new Date(now).getTime() + next.lifecycle.intervalMs).toISOString()
        : null
    }, now);
  } else if (op === 'recover') {
    next.lastRecoveredAt = now;
    next.degradedMode = false;
    next.lastFailure = null;
    next.retry = normalizeRetryState({}, now);
  } else if (op === 'handoff-audit') {
    next.auditHandoff = buildAuditHandoff(command, next, now, commandBoundary);
    next.ledger.push(normalizeLedgerEntry({
      id: `${id}:handoff`,
      kind: 'audit-handoff',
      at: now,
      proof: next.auditHandoff.proof.restartSafe ? 'restart-safe-boundary-proof' : 'dirty-boundary-proof',
      handoff: {
        target: next.auditHandoff.target,
        reason: next.auditHandoff.reason,
        at: now
      }
    }, next.ledger.length, now, commandBoundary));
  } else if (op === 'negotiate-provider-contract') {
    next.providerContract = normalizeProviderContract({
      ...next.providerContract,
      ...command.providerContract,
      requestedCapabilities: command.requestedCapabilities
        ?? command.capabilities
        ?? command.providerContract?.requestedCapabilities
        ?? next.providerContract.requestedCapabilities,
      sync: {
        ...next.providerContract.sync,
        ...command.providerContract?.sync
      },
      lastNegotiatedAt: now
    }, now);
    next.ledger.push(normalizeLedgerEntry({
      id: `${id}:provider-contract`,
      kind: next.providerContract.negotiated ? 'provider-contract-negotiated' : 'provider-contract-incomplete',
      at: now,
      proof: next.providerContract.negotiated
        ? `provider-capabilities:${next.providerContract.grantedCapabilities.join(',')}`
        : `missing-provider-capabilities:${next.providerContract.missingRequiredCapabilities.join(',')}`,
      boundary: commandBoundary
    }, next.ledger.length, now, commandBoundary));
    next.dirty = true;
  } else if (op === 'update-provider-sync') {
    next.providerContract = normalizeProviderContract({
      ...next.providerContract,
      sync: {
        ...next.providerContract.sync,
        ...command.sync,
        cursor: command.cursor ?? command.sync?.cursor ?? next.providerContract.sync.cursor,
        generation: command.generation ?? command.sync?.generation ?? next.providerContract.sync.generation,
        externalRevision: command.externalRevision
          ?? command.sync?.externalRevision
          ?? next.providerContract.sync.externalRevision,
        lastSyncedAt: command.lastSyncedAt ?? command.sync?.lastSyncedAt ?? now
      }
    }, now);
    next.ledger.push(normalizeLedgerEntry({
      id: `${id}:provider-sync`,
      kind: 'provider-sync-metadata',
      at: now,
      proof: `provider-sync:${next.providerContract.sync.generation}:${next.providerContract.sync.cursor}`,
      boundary: commandBoundary
    }, next.ledger.length, now, commandBoundary));
    next.dirty = true;
  } else if (op === 'acknowledge-provider-handoff') {
    if (!next.auditHandoff) {
      return rejectCommand(next, command, now, 'provider-handoff-missing', {
        boundary: commandBoundary,
        requiredPermission
      });
    }

    if (!next.providerContract.grantedCapabilities.includes('handoff-receipt')) {
      return rejectCommand(next, command, now, 'provider-handoff-receipt-unsupported', {
        boundary: commandBoundary,
        requiredPermission,
        providerId: next.providerContract.providerId
      });
    }

    const receiptStatus = PROVIDER_HANDOFF_RECEIPT_STATUSES.includes(command.status)
      ? command.status
      : 'accepted';
    const handoffReceipt = normalizeProviderHandoffReceipt({
      ...command.receipt,
      receiptId: command.receiptId ?? command.receipt?.receiptId,
      providerId: command.providerId ?? next.providerContract.providerId,
      target: command.target ?? next.auditHandoff.target,
      status: receiptStatus,
      acknowledgedAt: command.acknowledgedAt ?? command.at ?? now,
      externalRevision: command.externalRevision ?? command.receipt?.externalRevision,
      checkpoint: command.checkpoint ?? next.auditHandoff.checkpoint,
      ledgerEntries: command.ledgerEntries ?? next.auditHandoff.ledgerEntries,
      proofDigest: command.proofDigest
        ?? command.receipt?.proofDigest
        ?? stableDigest(next.auditHandoff.proof),
      rejectionReason: command.reason ?? command.receipt?.rejectionReason
    }, now);

    next.providerContract = normalizeProviderContract({
      ...next.providerContract,
      handoffReceipt,
      sync: {
        ...next.providerContract.sync,
        cursor: Math.max(next.providerContract.sync.cursor, handoffReceipt.checkpoint.cursor),
        generation: Math.max(next.providerContract.sync.generation, handoffReceipt.checkpoint.generation),
        externalRevision: handoffReceipt.externalRevision ?? next.providerContract.sync.externalRevision,
        lastSyncedAt: handoffReceipt.acknowledgedAt
      }
    }, now);
    next.ledger.push(normalizeLedgerEntry({
      id: `${id}:provider-handoff-receipt`,
      kind: `provider-handoff-receipt-${handoffReceipt.status}`,
      at: handoffReceipt.acknowledgedAt,
      proof: `provider-handoff-receipt:${handoffReceipt.receiptId}:${handoffReceipt.status}`,
      boundary: commandBoundary,
      handoff: {
        target: handoffReceipt.target,
        reason: handoffReceipt.rejectionReason ?? 'provider-acknowledged-handoff',
        at: handoffReceipt.acknowledgedAt
      }
    }, next.ledger.length, now, commandBoundary));
    next.dirty = true;
  } else if (op === 'report-failure') {
    const failure = normalizeFailure({
      ...command.failure,
      op: command.failure?.op ?? command.failedOp ?? 'memory-audit',
      at: command.failure?.at ?? now
    }, now);

    if (!failure) {
      return rejectCommand(next, command, now, 'invalid-failure-report', {
        boundary: commandBoundary,
        requiredField: 'failure.code'
      });
    }

    next.lastFailure = failure;
    next.retry = failure.retryable
      ? buildRetryState(failure, next.retry, now)
      : normalizeRetryState({ attempts: MAX_RETRY_ATTEMPTS, lastFailure: failure }, now);
    next.degradedMode = !failure.recoverable || next.retry.attempts >= next.retry.maxAttempts;
    next.ledger.push(normalizeLedgerEntry({
      id: `${id}:failure`,
      kind: next.degradedMode ? 'audit-failure-degraded' : 'audit-failure-retryable',
      at: now,
      proof: failure.retryable ? `retry-after:${next.retry.nextRetryAt}` : 'non-retryable-failure',
      boundary: commandBoundary
    }, next.ledger.length, now, commandBoundary));
  } else if (op === 'enter-degraded-mode') {
    next.degradedMode = true;
    next.lastFailure = normalizeFailure(command.failure, now) ?? next.lastFailure ?? {
      code: 'manual-degraded-mode',
      message: asNonEmptyString(command.reason, 'operator placed memory audit in degraded mode'),
      op,
      at: now,
      recoverable: true,
      retryable: false,
      detail: null
    };
  } else if (op === 'clear-degraded-mode') {
    next.degradedMode = false;
    next.lastFailure = null;
    next.retry = normalizeRetryState({}, now);
  } else {
    const result = { id, applied: false, reason: 'unknown-op', op, idempotent: true };
    next.commandReceipts = appendCommandReceipt(
      next.commandReceipts,
      buildCommandReceipt(command, result, next, now, commandBoundary)
    );
    return { state: next, result };
  }

  const result = {
    id,
    applied: true,
    op,
    idempotent: true,
    lifecycleValidation: lifecycleCommandValidation?.findings.length
      ? lifecycleCommandValidation
      : null,
    lifecycleControl,
    providerServiceContract: op === 'negotiate-provider-contract' || op === 'update-provider-sync'
      || op === 'acknowledge-provider-handoff'
      ? buildProviderServiceContract(next, now)
      : null,
    clientWorkflowHandoff: buildCommandClientWorkflowHandoff(command, {
      id,
      applied: true,
      op,
      reason: 'applied'
    }, next, now, commandBoundary)
  };
  next.commandReceipts = appendCommandReceipt(
    next.commandReceipts,
    buildCommandReceipt(command, result, next, now, commandBoundary)
  );

  return { state: next, result };
}

function applyCommands(state, commands, now) {
  return (Array.isArray(commands) ? commands : []).reduce((acc, command) => {
    const applied = applyCommand(acc.state, command, now);
    return {
      state: applied.state,
      results: [...acc.results, applied.result]
    };
  }, { state, results: [] });
}

function buildStatus(state) {
  const hasCheckpoint = state.checkpoint.cursor > 0 || state.checkpoint.highWatermark !== null;
  const hasProof = state.ledger.some((entry) => entry.proof !== null);

  if (!state.lifecycle.enabled) {
    return 'disabled';
  }

  if (state.degradedMode) {
    return 'degraded';
  }

  if (state.lastFailure) {
    return state.retry.attempts >= state.retry.maxAttempts ? 'failed' : 'retrying';
  }

  if (state.boundaryViolations.length > 0) {
    return 'boundary-review';
  }

  if (state.receiptRecovery?.recoveredReceiptIds?.length > 0) {
    return 'receipt-recovery-review';
  }

  if (!state.providerContract.negotiated) {
    return 'provider-contract-review';
  }

  if (state.dirty) {
    return 'pending-flush';
  }

  if (!hasCheckpoint && state.ledger.length === 0) {
    return 'cold-start';
  }

  if (!hasProof) {
    return 'recoverable-unproven';
  }

  return 'ready';
}

function buildLifecycleNextAction(state, now, retryDue) {
  if (!state.lifecycle.enabled) {
    return {
      action: 'enable-audit',
      reason: state.lifecycle.disabledReason,
      dueAt: null,
      command: { op: 'enable-audit' }
    };
  }

  if (state.degradedMode) {
    return {
      action: 'recover',
      reason: state.lastFailure?.code ?? 'degraded-mode',
      dueAt: null,
      command: { op: 'recover' }
    };
  }

  if (state.lastFailure) {
    return {
      action: retryDue ? 'retry-failed-operation' : 'wait-for-retry-window',
      reason: state.lastFailure.code,
      dueAt: retryDue ? now : state.retry.nextRetryAt,
      command: retryDue ? { op: state.lastFailure.op } : null
    };
  }

  if (state.boundaryViolations.length > 0) {
    return {
      action: 'review-boundary-violations',
      reason: 'boundary-violation',
      dueAt: null,
      command: null
    };
  }

  if (!state.providerContract.negotiated) {
    return {
      action: 'negotiate-provider-contract',
      reason: 'provider-capability-missing',
      dueAt: null,
      command: {
        op: 'negotiate-provider-contract',
        requestedCapabilities: REQUIRED_PROVIDER_CAPABILITIES
      }
    };
  }

  if (state.dirty) {
    return {
      action: 'flush-audit-state',
      reason: 'pending-flush',
      dueAt: null,
      command: { op: 'mark-flushed' }
    };
  }

  if (state.lifecycle.mode === 'manual') {
    return {
      action: 'await-manual-audit',
      reason: 'manual-mode',
      dueAt: null,
      command: null
    };
  }

  if (state.lifecycle.mode === 'scheduled' && state.lifecycle.nextRunAt) {
    const due = new Date(state.lifecycle.nextRunAt).getTime() <= new Date(now).getTime();
    return {
      action: due ? 'run-scheduled-audit' : 'wait-for-scheduled-audit',
      reason: 'scheduled-mode',
      dueAt: state.lifecycle.nextRunAt,
      command: due ? { op: 'record-checkpoint' } : null
    };
  }

  return {
    action: 'accept-audit-commands',
    reason: 'continuous-mode',
    dueAt: null,
    command: null
  };
}

function buildRestartRecoveryState(state, now) {
  const providerBehind = state.providerContract.sync.generation < state.checkpoint.generation
    || state.providerContract.sync.cursor < state.checkpoint.cursor;
  const retryDue = state.retry.nextRetryAt
    ? new Date(state.retry.nextRetryAt).getTime() <= new Date(now).getTime()
    : false;
  const commandReceiptsAligned = state.commandLog.every((id) => (
    state.commandReceipts.some((receipt) => receipt.id === id)
  ));
  const recoveredReceiptIds = state.receiptRecovery?.recoveredReceiptIds ?? [];
  const actions = [];

  if (!commandReceiptsAligned) {
    actions.push({
      action: 'rebuild-command-receipts',
      reason: 'persisted-command-log-without-receipts',
      command: null
    });
  }

  if (recoveredReceiptIds.length > 0) {
    actions.push({
      action: 'persist-recovered-command-receipts',
      reason: 'command-log-receipts-recovered-after-restart',
      command: { op: 'mark-flushed' },
      receiptIds: recoveredReceiptIds
    });
  }

  if (state.dirty) {
    actions.push({
      action: 'flush-audit-state',
      reason: 'dirty-state-after-restart',
      command: { op: 'mark-flushed' }
    });
  }

  if (providerBehind) {
    actions.push({
      action: 'update-provider-sync',
      reason: 'provider-sync-behind-local-checkpoint',
      command: {
        op: 'update-provider-sync',
        cursor: state.checkpoint.cursor,
        generation: state.checkpoint.generation
      }
    });
  }

  if (state.degradedMode) {
    actions.push({
      action: 'recover',
      reason: state.lastFailure?.code ?? 'degraded-mode',
      command: { op: 'recover' }
    });
  } else if (state.lastFailure && retryDue) {
    actions.push({
      action: 'retry-failed-operation',
      reason: state.lastFailure.code,
      command: { op: state.lastFailure.op }
    });
  }

  const restartStatus = actions.length === 0
    ? 'restart-stable'
    : actions.some((item) => item.action === 'recover')
      ? 'restart-recovery-required'
      : 'restart-reconciliation-required';

  return {
    observedAt: now,
    restartStatus,
    restartSafe: actions.length === 0 && state.lifecycle.enabled,
    lastRecoveredAt: state.lastRecoveredAt,
    providerBehind,
    retryDue,
    commandReceiptsAligned,
    receiptRecovery: state.receiptRecovery,
    receiptCount: state.commandReceipts.length,
    commandLogCount: state.commandLog.length,
    actions
  };
}

function validateReceiptRecovery(state) {
  const recovery = state.receiptRecovery;

  if (!recovery) {
    return [];
  }

  const findings = [];

  if (recovery.recoveredReceiptIds.length > 0) {
    findings.push({
      code: 'command-receipts-recovered-from-log',
      severity: 'warning',
      receiptIds: recovery.recoveredReceiptIds,
      action: 'persist recovered receipts before accepting external audit handoff'
    });
  }

  if (recovery.truncatedReceiptIds.length > 0) {
    findings.push({
      code: 'command-receipts-truncated',
      severity: 'warning',
      receiptIds: recovery.truncatedReceiptIds,
      action: 'export or compact command receipts before the retained receipt window overflows'
    });
  }

  if (recovery.staleReceiptIds.length > 0) {
    findings.push({
      code: 'command-receipts-without-log-entry',
      severity: 'warning',
      receiptIds: recovery.staleReceiptIds,
      action: 'keep stale receipts as evidence but rebuild command log during the next persistence cycle'
    });
  }

  return findings;
}

function validateLedger(state) {
  const findings = [];
  const seenIds = new Set();

  state.ledger.forEach((entry, index) => {
    if (seenIds.has(entry.id)) {
      findings.push({
        code: 'duplicate-ledger-id',
        severity: 'error',
        entryId: entry.id,
        action: 'replay from last trusted checkpoint before accepting handoff'
      });
    }
    seenIds.add(entry.id);

    if (!boundariesMatch(state.boundary, entry.boundary)) {
      findings.push({
        code: 'ledger-boundary-drift',
        severity: 'error',
        entryId: entry.id,
        action: 'quarantine entry and request tenant/workspace scoped recovery'
      });
    }

    const previous = state.ledger[index - 1];
    if (previous && new Date(entry.at).getTime() < new Date(previous.at).getTime()) {
      findings.push({
        code: 'ledger-time-regression',
        severity: 'warning',
        entryId: entry.id,
        action: 'keep append order as source of truth and regenerate proof timestamps'
      });
    }
  });

  if (state.dirty && state.auditHandoff) {
    findings.push({
      code: 'dirty-handoff',
      severity: 'error',
      entryId: state.ledger.at(-1)?.id ?? null,
      action: 'flush memory audit state before exposing handoff proof'
    });
  }

  return findings;
}

function validateProviderContract(state, now) {
  const findings = [];

  if (!state.providerContract.negotiated) {
    findings.push({
      code: 'provider-capability-missing',
      severity: 'error',
      providerId: state.providerContract.providerId,
      missingCapabilities: state.providerContract.missingRequiredCapabilities,
      action: 'renegotiate provider contract with checkpoint, ledger proof, and handoff receipt support'
    });
  }

  if (state.providerContract.unsupportedCapabilities.length > 0) {
    findings.push({
      code: 'provider-capability-unsupported',
      severity: 'warning',
      providerId: state.providerContract.providerId,
      unsupportedCapabilities: state.providerContract.unsupportedCapabilities,
      action: 'drop unsupported optional provider capabilities or route them through an adapter'
    });
  }

  if (state.auditHandoff && !state.providerContract.grantedCapabilities.includes('handoff-receipt')) {
    findings.push({
      code: 'provider-handoff-receipt-missing',
      severity: 'error',
      providerId: state.providerContract.providerId,
      action: 'do not expose external audit handoff until the provider can acknowledge receipt'
    });
  }

  if (state.auditHandoff && state.providerContract.handoffReceipt?.status === 'rejected') {
    findings.push({
      code: 'provider-handoff-rejected',
      severity: 'error',
      providerId: state.providerContract.providerId,
      receiptId: state.providerContract.handoffReceipt.receiptId,
      rejectionReason: state.providerContract.handoffReceipt.rejectionReason,
      action: 'route the handoff back through recovery before exposing it to clients'
    });
  }

  if (state.auditHandoff
    && state.providerContract.grantedCapabilities.includes('handoff-receipt')
    && !state.providerContract.handoffReceipt) {
    findings.push({
      code: 'provider-handoff-receipt-pending',
      severity: 'warning',
      providerId: state.providerContract.providerId,
      action: 'wait for provider receipt acknowledgement after external handoff dispatch'
    });
  }

  if (state.providerContract.sync.generation < state.checkpoint.generation) {
    findings.push({
      code: 'provider-sync-behind-checkpoint',
      severity: 'warning',
      providerId: state.providerContract.providerId,
      action: 'publish provider sync metadata after checkpoint generation advances'
    });
  }

  if (state.providerContract.sync.leaseExpiresAt
    && new Date(state.providerContract.sync.leaseExpiresAt).getTime() <= new Date(now).getTime()) {
    findings.push({
      code: 'provider-sync-lease-expired',
      severity: 'warning',
      providerId: state.providerContract.providerId,
      action: 'refresh provider sync lease before handing state to an external service'
    });
  }

  return findings;
}

function providerSyncAligned(state) {
  return state.providerContract.sync.generation >= state.checkpoint.generation
    && state.providerContract.sync.cursor >= state.checkpoint.cursor;
}

function buildProviderServiceContract(state, now) {
  const provider = state.providerContract;
  const syncAligned = providerSyncAligned(state);
  const unsupportedOptional = provider.unsupportedCapabilities
    .filter((capability) => OPTIONAL_PROVIDER_CAPABILITIES.includes(capability));
  const missingRequired = provider.missingRequiredCapabilities;
  const receipt = provider.handoffReceipt;
  const receiptAccepted = receipt?.status === 'accepted';
  const receiptRejected = receipt?.status === 'rejected';
  const leaseExpired = Boolean(provider.sync.leaseExpiresAt)
    && new Date(provider.sync.leaseExpiresAt).getTime() <= new Date(now).getTime();
  const leaseRequired = provider.endpoint !== null || provider.grantedCapabilities.includes('external-revision');
  const deltaRequired = !syncAligned;
  const blockers = [
    ...missingRequired.map((capability) => `missing:${capability}`),
    ...(leaseRequired && !provider.lease.valid ? ['provider-lease-not-valid'] : []),
    ...(leaseExpired ? ['provider-lease-expired'] : []),
    ...(!state.lifecycle.enabled ? ['audit-disabled'] : []),
    ...(state.dirty ? ['dirty-state'] : []),
    ...(state.degradedMode ? ['degraded-mode'] : []),
    ...(state.lastFailure ? [state.lastFailure.code] : []),
    ...(receiptRejected ? ['provider-handoff-rejected'] : []),
    ...(state.boundaryViolations.length > 0 ? ['boundary-violation'] : [])
  ];
  const phase = blockers.length > 0
    ? 'blocked'
    : deltaRequired
      ? 'sync-required'
      : state.auditHandoff
        ? receiptAccepted
          ? 'handoff-received'
          : 'handoff-ready'
        : 'negotiated';
  const nextCommand = missingRequired.length > 0
    ? { op: 'negotiate-provider-contract', requestedCapabilities: REQUIRED_PROVIDER_CAPABILITIES }
    : deltaRequired
      ? {
          op: 'update-provider-sync',
          cursor: state.checkpoint.cursor,
          generation: state.checkpoint.generation,
          externalRevision: provider.sync.externalRevision
        }
      : state.auditHandoff
        ? {
            op: 'handoff-audit',
            target: state.auditHandoff.target,
            checkpoint: state.auditHandoff.checkpoint
          }
        : null;
  const receiptCommand = state.auditHandoff
    && provider.grantedCapabilities.includes('handoff-receipt')
    && (!receipt || receipt.status === 'pending')
    ? {
        op: 'acknowledge-provider-handoff',
        providerId: provider.providerId,
        target: state.auditHandoff.target,
        checkpoint: state.auditHandoff.checkpoint,
        ledgerEntries: state.auditHandoff.ledgerEntries
      }
    : null;
  const digestPayload = {
    surfaceId,
    providerId: provider.providerId,
    service: provider.service,
    version: provider.version,
    boundaryKey: state.boundary.isolation.boundaryKey,
    checkpoint: state.checkpoint,
    sync: provider.sync,
    grantedCapabilities: provider.grantedCapabilities,
    missingRequired,
    receipt,
    phase,
    blockers
  };

  return {
    schema: 'memory-audit-provider-service-contract.v1',
    generatedAt: now,
    providerId: provider.providerId,
    service: provider.service,
    version: provider.version,
    endpoint: provider.endpoint,
    routes: PROVIDER_SERVICE_ROUTES,
    phase,
    ready: phase === 'handoff-ready',
    blockers,
    compatibility: {
      requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
      optionalCapabilities: OPTIONAL_PROVIDER_CAPABILITIES,
      supportedCapabilities: SUPPORTED_PROVIDER_CAPABILITIES,
      requestedCapabilities: provider.requestedCapabilities,
      grantedCapabilities: provider.grantedCapabilities,
      missingRequiredCapabilities: missingRequired,
      unsupportedOptionalCapabilities: unsupportedOptional,
      negotiated: provider.negotiated
    },
    syncMetadata: {
      localCheckpoint: state.checkpoint,
      providerCursor: provider.sync.cursor,
      providerGeneration: provider.sync.generation,
      externalRevision: provider.sync.externalRevision,
      consistency: provider.sync.consistency,
      lastSyncedAt: provider.sync.lastSyncedAt,
      leaseExpiresAt: provider.sync.leaseExpiresAt,
      leaseValid: provider.lease.valid,
      aligned: syncAligned,
      deltaRequired,
      delta: {
        cursor: Math.max(0, state.checkpoint.cursor - provider.sync.cursor),
        generation: Math.max(0, state.checkpoint.generation - provider.sync.generation)
      }
    },
    handoffState: {
      available: state.auditHandoff !== null,
      target: state.auditHandoff?.target ?? null,
      receiptRequired: provider.grantedCapabilities.includes('handoff-receipt'),
      receiptAcknowledged: receiptAccepted,
      receiptStatus: receipt?.status ?? (state.auditHandoff ? 'pending' : null),
      receipt,
      externalRevisionRequired: provider.grantedCapabilities.includes('external-revision'),
      readyForExternalService: phase === 'handoff-ready',
      acknowledgedByExternalService: phase === 'handoff-received'
    },
    nextCommand,
    receiptCommand,
    proof: {
      digestAlgorithm: 'fnv1a32-stable-json',
      digest: stableDigest(digestPayload)
    }
  };
}

function validateBoundaryContracts(state) {
  const findings = [];
  const scopedBoundaries = [
    { source: 'state-boundary', boundary: state.boundary, entryId: null },
    ...state.commandReceipts.map((receipt) => ({
      source: `command-receipt:${receipt.op}`,
      boundary: receipt.boundary,
      entryId: receipt.id
    })),
    ...state.ledger.map((entry) => ({
      source: `ledger:${entry.kind}`,
      boundary: entry.boundary,
      entryId: entry.id
    }))
  ];

  scopedBoundaries.forEach(({ source, boundary, entryId }) => {
    if (boundary.permissionClaims.denied.length > 0) {
      findings.push({
        code: 'permission-claim-denied',
        severity: 'warning',
        source,
        entryId,
        role: boundary.role,
        deniedPermissions: boundary.permissionClaims.denied,
        action: 'treat requested permissions as untrusted and continue with role-scoped effective permissions'
      });
    }

    if (boundary.permissionClaims.unknown.length > 0) {
      findings.push({
        code: 'permission-claim-unknown',
        severity: 'warning',
        source,
        entryId,
        role: boundary.role,
        unknownPermissions: boundary.permissionClaims.unknown,
        action: 'drop unknown memory audit permissions before forwarding boundary proof'
      });
    }
  });

  return findings;
}

function validateLifecycleState(state, now) {
  const findings = [];
  const nextRunAt = state.lifecycle.nextRunAt
    ? new Date(state.lifecycle.nextRunAt).getTime()
    : null;
  const observedAt = new Date(now).getTime();

  if (!LIFECYCLE_MODES.includes(state.lifecycle.mode)) {
    findings.push({
      code: 'invalid-persisted-lifecycle-mode',
      severity: 'error',
      mode: state.lifecycle.mode,
      action: 'rewrite lifecycle settings through configure-lifecycle before accepting audit work'
    });
  }

  if (!state.lifecycle.enabled && !state.lifecycle.disabledReason) {
    findings.push({
      code: 'lifecycle-disabled-without-reason',
      severity: 'warning',
      action: 'record an operator disabled reason for audit provenance'
    });
  }

  if (state.lifecycle.mode === 'scheduled' && !state.lifecycle.nextRunAt) {
    findings.push({
      code: 'scheduled-lifecycle-missing-next-run',
      severity: 'error',
      action: 'schedule the next audit run or switch lifecycle mode to manual'
    });
  }

  if (state.lifecycle.mode === 'scheduled'
    && nextRunAt !== null
    && nextRunAt + state.lifecycle.intervalMs < observedAt
    && !state.dirty
    && !state.lastFailure
    && !state.degradedMode) {
    findings.push({
      code: 'scheduled-lifecycle-overdue',
      severity: 'warning',
      nextRunAt: state.lifecycle.nextRunAt,
      intervalMs: state.lifecycle.intervalMs,
      action: 'run the scheduled audit checkpoint and flush the resulting state'
    });
  }

  if (state.lifecycle.enabled && state.lifecycle.disabledReason) {
    findings.push({
      code: 'enabled-lifecycle-has-disabled-reason',
      severity: 'warning',
      action: 'clear stale disabledReason when enabling the audit lifecycle'
    });
  }

  return findings;
}

function buildLifecycleControlPlane(state, now, retryDue, nextAction) {
  const scheduledDue = state.lifecycle.mode === 'scheduled'
    && state.lifecycle.nextRunAt
    && new Date(state.lifecycle.nextRunAt).getTime() <= new Date(now).getTime();
  const providerReady = state.providerContract.negotiated && state.providerContract.lease.valid;
  const mutationBlockedReason = !state.lifecycle.enabled
    ? 'audit-disabled'
    : state.degradedMode
      ? 'degraded-mode'
      : state.lastFailure
        ? retryDue ? 'retry-due' : 'retry-window-pending'
        : null;
  const controls = [
    {
      control: 'enable',
      enabled: !state.lifecycle.enabled,
      command: { op: 'enable-audit' },
      reason: state.lifecycle.enabled ? 'already-enabled' : state.lifecycle.disabledReason
    },
    {
      control: 'disable',
      enabled: state.lifecycle.enabled,
      command: { op: 'disable-audit', reason: 'operator-disabled' },
      reason: state.lifecycle.enabled ? 'enabled' : 'already-disabled'
    },
    {
      control: 'schedule',
      enabled: state.lifecycle.enabled && !state.degradedMode,
      command: {
        op: 'schedule-audit',
        intervalMs: state.lifecycle.intervalMs,
        nextRunAt: state.lifecycle.nextRunAt
          ?? new Date(new Date(now).getTime() + state.lifecycle.intervalMs).toISOString()
      },
      reason: state.lifecycle.enabled ? 'lifecycle-active' : 'audit-disabled'
    },
    {
      control: 'flush',
      enabled: state.dirty && state.lifecycle.enabled && !state.degradedMode,
      command: { op: 'mark-flushed' },
      reason: state.dirty ? 'pending-flush' : 'state-clean'
    },
    {
      control: 'recover',
      enabled: state.degradedMode || state.lastFailure !== null,
      command: { op: state.degradedMode ? 'recover' : state.lastFailure?.op ?? 'recover' },
      reason: state.degradedMode
        ? 'degraded-mode'
        : state.lastFailure?.code ?? 'no-failure'
    }
  ];
  const controlsWithContracts = controls.map((control) => {
    const contract = buildLifecycleCommandContract(state, now, control.command, state.boundary);

    return {
      ...control,
      enabled: control.enabled && contract.allowed,
      disabledReasons: [
        ...(control.enabled ? [] : [control.reason]),
        ...contract.blockingReasons
      ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index),
      contract
    };
  });
  const allowedCommands = controlsWithContracts
    .filter((control) => control.enabled)
    .map((control) => control.command.op);

  return {
    schema: 'memory-audit-lifecycle-controls.v1',
    generatedAt: now,
    settings: {
      mode: state.lifecycle.mode,
      enabled: state.lifecycle.enabled,
      intervalMs: state.lifecycle.intervalMs,
      nextRunAt: state.lifecycle.nextRunAt,
      lastRunAt: state.lifecycle.lastRunAt,
      disabledReason: state.lifecycle.disabledReason
    },
    policy: {
      allowedModes: LIFECYCLE_MODES,
      minIntervalMs: MIN_AUDIT_INTERVAL_MS,
      maxIntervalMs: MAX_AUDIT_INTERVAL_MS,
      requiredPermission: operationPermission('configure-lifecycle'),
      mutationBlockedReason,
      providerReady,
      allowedCommands,
      blockedCommands: controlsWithContracts
        .filter((control) => !control.enabled)
        .map((control) => ({
          op: control.command.op,
          reasons: control.disabledReasons
        }))
    },
    schedule: {
      due: Boolean(scheduledDue),
      overdue: Boolean(scheduledDue && !state.dirty),
      nextRunAt: state.lifecycle.nextRunAt,
      dueCommand: scheduledDue ? { op: 'record-checkpoint' } : null
    },
    controls: controlsWithContracts,
    nextAction
  };
}

function remediationCommandForFinding(finding, state) {
  if (finding.code === 'provider-capability-missing') {
    return {
      op: 'negotiate-provider-contract',
      requestedCapabilities: REQUIRED_PROVIDER_CAPABILITIES
    };
  }

  if (finding.code === 'provider-sync-behind-checkpoint') {
    return {
      op: 'update-provider-sync',
      cursor: state.checkpoint.cursor,
      generation: state.checkpoint.generation
    };
  }

  if (finding.code === 'provider-sync-lease-expired') {
    return {
      op: 'negotiate-provider-contract',
      providerContract: {
        providerId: state.providerContract.providerId,
        requestedCapabilities: state.providerContract.requestedCapabilities
      }
    };
  }

  if (finding.code === 'dirty-handoff' || finding.code === 'scheduled-lifecycle-overdue') {
    return { op: 'mark-flushed' };
  }

  if (finding.code === 'scheduled-lifecycle-missing-next-run') {
    return {
      op: 'schedule-audit',
      intervalMs: state.lifecycle.intervalMs
    };
  }

  if (finding.code === 'enabled-lifecycle-has-disabled-reason') {
    return {
      op: 'configure-lifecycle',
      lifecycle: {
        ...state.lifecycle,
        disabledReason: null
      }
    };
  }

  return null;
}

function remediationRouteForError(code, source) {
  if (code === 'audit-disabled' || source === 'lifecycle') {
    return CLIENT_HANDOFF_ROUTES.disabled;
  }

  if (code.startsWith('provider-')) {
    return CLIENT_HANDOFF_ROUTES.provider;
  }

  if (code === 'boundary-violation' || code === 'ledger-boundary-drift') {
    return CLIENT_HANDOFF_ROUTES.review;
  }

  return CLIENT_HANDOFF_ROUTES.recover;
}

function buildActionableErrorContract(state, now, error) {
  const retryable = error.retryable === true;
  const retryDue = retryable
    && (!error.retryAt || new Date(error.retryAt).getTime() <= new Date(now).getTime());
  const command = error.command ?? null;
  const route = error.route ?? remediationRouteForError(error.code, error.source);
  const severity = error.severity ?? (error.degradesService ? 'critical' : 'error');

  return {
    schema: 'memory-audit-actionable-error.v1',
    code: error.code,
    source: error.source,
    severity,
    message: error.message,
    action: error.action,
    route,
    retryable,
    retry: {
      attempts: error.retryAttempts ?? state.retry.attempts,
      maxAttempts: error.maxAttempts ?? state.retry.maxAttempts,
      backoffMs: error.backoffMs ?? (retryable ? retryBackoffMs(state.retry.attempts) : 0),
      retryAt: error.retryAt ?? null,
      due: Boolean(retryDue),
      exhausted: retryable
        ? (error.retryAttempts ?? state.retry.attempts) >= (error.maxAttempts ?? state.retry.maxAttempts)
        : false
    },
    remediation: {
      command,
      commandAllowed: command
        ? buildLifecycleCommandContract(state, now, command, state.boundary).allowed
        : false,
      commandId: command ? commandId(command) : null
    },
    degradedMode: {
      active: state.degradedMode,
      triggeredByThisError: Boolean(error.degradesService),
      clearCommand: state.degradedMode ? { op: 'recover' } : null
    },
    proof: {
      digestAlgorithm: 'fnv1a32-stable-json',
      digest: stableDigest({
        surfaceId,
        boundaryKey: state.boundary.isolation.boundaryKey,
        code: error.code,
        source: error.source,
        severity,
        route,
        command,
        retryable,
        checkpoint: state.checkpoint
      })
    }
  };
}

function buildActionableErrors(state, findings, now) {
  const errors = findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => ({
      code: finding.code,
      source: finding.code.startsWith('provider-')
        ? 'provider'
        : finding.code.startsWith('lifecycle-') || finding.code.startsWith('scheduled-lifecycle')
          ? 'lifecycle'
          : 'validation',
      severity: 'error',
      message: `Memory audit validation failed: ${finding.code}`,
      action: finding.action,
      command: remediationCommandForFinding(finding, state),
      retryable: finding.code !== 'ledger-boundary-drift',
      degradesService: finding.code === 'ledger-boundary-drift' || finding.code === 'dirty-handoff'
    }));

  if (state.lastFailure) {
    errors.push({
      code: state.lastFailure.code,
      source: 'failure-state',
      severity: state.degradedMode ? 'critical' : 'error',
      message: state.lastFailure.message,
      action: state.lastFailure.retryable && state.retry.nextRetryAt
        ? `retry ${state.lastFailure.op} after ${state.retry.nextRetryAt}`
        : 'operator recovery required before accepting new audit handoff',
      command: state.lastFailure.retryable && state.retry.attempts < state.retry.maxAttempts
        ? { op: state.lastFailure.op }
        : { op: 'recover' },
      retryable: state.lastFailure.retryable && state.retry.attempts < state.retry.maxAttempts,
      retryAttempts: state.retry.attempts,
      maxAttempts: state.retry.maxAttempts,
      backoffMs: state.retry.backoffMs,
      retryAt: state.retry.nextRetryAt,
      degradesService: state.degradedMode
    });
  }

  if (state.boundaryViolations.length > 0) {
    errors.push({
      code: 'boundary-violation',
      source: 'boundary',
      severity: 'error',
      message: 'A memory audit command targeted a different tenant/workspace boundary',
      action: 'reject cross-boundary command and request scoped credentials',
      command: null,
      retryable: false
    });
  }

  if (!state.lifecycle.enabled) {
    errors.push({
      code: 'audit-disabled',
      source: 'lifecycle',
      severity: 'warning',
      message: 'Memory audit lifecycle is disabled',
      action: 'enable audit lifecycle before accepting checkpoint, ledger, or handoff commands',
      command: { op: 'enable-audit' },
      retryable: true
    });
  }

  return errors.map((error) => buildActionableErrorContract(state, now, error));
}

function buildOperationalHealth(state, now) {
  const ledgerFindings = validateLedger(state);
  const providerFindings = validateProviderContract(state, now);
  const boundaryFindings = validateBoundaryContracts(state);
  const lifecycleFindings = validateLifecycleState(state, now);
  const receiptRecoveryFindings = validateReceiptRecovery(state);
  const findings = [
    ...ledgerFindings,
    ...providerFindings,
    ...boundaryFindings,
    ...lifecycleFindings,
    ...receiptRecoveryFindings
  ];
  const actionableErrors = buildActionableErrors(state, findings, now);
  const retryDue = state.retry.nextRetryAt
    ? new Date(state.retry.nextRetryAt).getTime() <= new Date(now).getTime()
    : false;
  const nextAction = buildLifecycleNextAction(state, now, retryDue);

  return {
    state: buildStatus(state),
    degraded: state.degradedMode,
    restartRecovery: buildRestartRecoveryState(state, now),
    validation: {
      ok: findings.every((finding) => finding.severity !== 'error'),
      findings
    },
    failure: state.lastFailure,
    retry: {
      ...state.retry,
      retryDue,
      exhausted: state.retry.attempts >= state.retry.maxAttempts
    },
    lifecycle: {
      ...state.lifecycle,
      nextAction,
      validation: {
        ok: lifecycleFindings.every((finding) => finding.severity !== 'error'),
        findings: lifecycleFindings
      },
      controls: buildLifecycleControlPlane(state, now, retryDue, nextAction)
    },
    providerContract: state.providerContract,
    providerServiceContract: buildProviderServiceContract(state, now),
    receiptRecovery: state.receiptRecovery,
    actionableErrors
  };
}

function buildAnalyticsCounters(state, commands, operationalHealth) {
  const appliedCommands = commands.filter((result) => result.applied);
  const rejectedCommands = commands.filter((result) => !result.applied);
  const ledgerKinds = state.ledger.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {});
  const proofEntries = state.ledger.filter((entry) => entry.proof !== null);
  const handoffEntries = state.ledger.filter((entry) => entry.handoff !== null || entry.kind === 'audit-handoff');
  const retryableErrors = operationalHealth.actionableErrors.filter((error) => error.retryable).length;
  const commandPermissionClaims = state.commandReceipts.map((receipt) => receipt.permissionClaims);
  const deniedPermissionClaims = commandPermissionClaims
    .reduce((total, claim) => total + claim.denied.length, 0);
  const unknownPermissionClaims = commandPermissionClaims
    .reduce((total, claim) => total + claim.unknown.length, 0);
  const lifecycleCommandFindings = state.commandReceipts
    .reduce((total, receipt) => total + (receipt.lifecycleValidation?.findings.length ?? 0), 0);
  const clientWorkflowReceipts = state.commandReceipts
    .filter((receipt) => receipt.clientWorkflowHandoff !== null);
  const clientRoutes = countBy(
    clientWorkflowReceipts,
    (receipt) => receipt.clientWorkflowHandoff.route
  );
  const acknowledgementRequired = clientWorkflowReceipts
    .filter((receipt) => receipt.clientWorkflowHandoff.acknowledgement?.required).length;

  return {
    commands: {
      total: commands.length,
      applied: appliedCommands.length,
      rejected: rejectedCommands.length,
      duplicates: rejectedCommands.filter((result) => result.reason === 'duplicate').length,
      permissionDenied: rejectedCommands.filter((result) => result.reason === 'permission-denied').length,
      boundaryRejected: rejectedCommands.filter((result) => result.reason === 'boundary-mismatch').length,
      disabledRejected: rejectedCommands.filter((result) => result.reason === 'audit-disabled').length
    },
    permissions: {
      knownPermissions: KNOWN_PERMISSIONS.length,
      role: state.boundary.role,
      effectiveForBoundary: state.boundary.permissions.length,
      deniedCommandClaims: deniedPermissionClaims,
      unknownCommandClaims: unknownPermissionClaims,
      constrainedReceipts: commandPermissionClaims
        .filter((claim) => claim.source === 'role-constrained-request').length
    },
    ledger: {
      total: state.ledger.length,
      byKind: ledgerKinds,
      proofs: proofEntries.length,
      handoffs: handoffEntries.length,
      lastEntryAt: state.ledger.at(-1)?.at ?? null
    },
    reliability: {
      failures: state.lastFailure ? 1 : 0,
      boundaryViolations: state.boundaryViolations.length,
      retryAttempts: state.retry.attempts,
      retryableErrors,
      validationFindings: operationalHealth.validation.findings.length,
      restartRecoveryActions: operationalHealth.restartRecovery.actions.length,
      receiptRecoveryAligned: state.receiptRecovery?.aligned ?? true,
      recoveredCommandReceipts: state.receiptRecovery?.recoveredReceiptIds.length ?? 0,
      staleCommandReceipts: state.receiptRecovery?.staleReceiptIds.length ?? 0,
      truncatedCommandReceipts: state.receiptRecovery?.truncatedReceiptIds.length ?? 0
    },
    checkpoint: {
      cursor: state.checkpoint.cursor,
      generation: state.checkpoint.generation,
      hasHighWatermark: state.checkpoint.highWatermark !== null
    },
    lifecycle: {
      enabled: state.lifecycle.enabled,
      mode: state.lifecycle.mode,
      nextRunAt: state.lifecycle.nextRunAt,
      validationFindings: operationalHealth.lifecycle.validation.findings.length,
      commandValidationFindings: lifecycleCommandFindings,
      controlsAvailable: operationalHealth.lifecycle.controls.controls
        .filter((control) => control.enabled).length,
      commandContracts: operationalHealth.lifecycle.controls.controls
        .filter((control) => control.contract)
        .length,
      blockedCommandContracts: operationalHealth.lifecycle.controls.policy.blockedCommands.length,
      scheduledDue: operationalHealth.lifecycle.controls.schedule.due,
      mutationBlocked: operationalHealth.lifecycle.controls.policy.mutationBlockedReason !== null
    },
    provider: {
      providerId: state.providerContract.providerId,
      negotiated: state.providerContract.negotiated,
      servicePhase: operationalHealth.providerServiceContract.phase,
      serviceReady: operationalHealth.providerServiceContract.ready,
      serviceBlockers: operationalHealth.providerServiceContract.blockers.length,
      grantedCapabilities: state.providerContract.grantedCapabilities.length,
      unsupportedCapabilities: state.providerContract.unsupportedCapabilities.length,
      missingRequiredCapabilities: state.providerContract.missingRequiredCapabilities.length,
      handoffReceiptStatus: state.providerContract.handoffReceipt?.status ?? null,
      handoffReceiptAcknowledged: state.providerContract.handoffReceipt?.status === 'accepted',
      syncGeneration: state.providerContract.sync.generation,
      syncCursor: state.providerContract.sync.cursor,
      leaseValid: state.providerContract.lease.valid
    },
    clientRuntime: {
      clientId: state.clientRuntime.clientId,
      sessionId: state.clientRuntime.sessionId,
      requestId: state.clientRuntime.requestId,
      workflow: state.clientRuntime.workflow,
      route: state.clientRuntime.route,
      commandWorkflowReceipts: clientWorkflowReceipts.length,
      acknowledgementRequired,
      routes: clientRoutes
    }
  };
}

function buildBoundaryContractSummary(state, operationalHealth) {
  const permissionFindings = operationalHealth.validation.findings
    .filter((finding) => finding.code === 'permission-claim-denied' || finding.code === 'permission-claim-unknown');

  return {
    tenantId: state.boundary.tenantId,
    workspaceId: state.boundary.workspaceId,
    actorId: state.boundary.actorId,
    role: state.boundary.role,
    isolation: state.boundary.isolation,
    permissions: {
      effective: state.boundary.permissions,
      source: state.boundary.permissionClaims.source,
      denied: state.boundary.permissionClaims.denied,
      unknown: state.boundary.permissionClaims.unknown
    },
    enforcement: {
      mode: 'role-capped-least-privilege',
      knownPermissions: KNOWN_PERMISSIONS,
      commandReceiptsChecked: state.commandReceipts.length,
      permissionFindings: permissionFindings.length
    }
  };
}

function buildTimeline(state, commands, now) {
  const commandEvents = commands.map((result) => ({
    at: now,
    type: result.applied ? 'command-applied' : 'command-rejected',
    id: result.id,
    op: result.op ?? null,
    reason: result.reason ?? null,
    severity: result.applied ? 'info' : 'warning'
  }));
  const ledgerEvents = state.ledger.map((entry) => ({
    at: entry.at,
    type: 'ledger-entry',
    id: entry.id,
    kind: entry.kind,
    proof: entry.proof,
    severity: entry.proof ? 'info' : 'notice'
  }));
  const violationEvents = state.boundaryViolations.map((violation) => ({
    at: violation.at,
    type: 'boundary-violation',
    id: violation.id,
    op: violation.op,
    reason: violation.reason,
    severity: 'error'
  }));

  return [...ledgerEvents, ...violationEvents, ...commandEvents]
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .slice(-50);
}

function countBy(items, selector) {
  return items.reduce((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function buildStatusTransitions(history, status, now) {
  const samples = [...history, { status, capturedAt: now }];

  return samples.reduce((acc, sample) => {
    const previous = acc.at(-1);
    if (!previous || previous.to !== sample.status) {
      acc.push({
        from: previous?.to ?? null,
        to: sample.status,
        at: sample.capturedAt
      });
    }

    return acc;
  }, []).slice(-10);
}

function buildHistoryDeltas(history, currentSnapshot) {
  const previous = history.at(-1) ?? null;

  if (!previous) {
    return {
      sinceSnapshotId: null,
      ledgerEntries: currentSnapshot.ledgerEntries,
      boundaryViolations: currentSnapshot.boundaryViolations,
      failures: currentSnapshot.failures,
      commandsApplied: currentSnapshot.counters?.commandsApplied ?? 0,
      commandsRejected: currentSnapshot.counters?.commandsRejected ?? 0,
      proofs: currentSnapshot.counters?.proofs ?? 0,
      handoffs: currentSnapshot.counters?.handoffs ?? 0
    };
  }

  return {
    sinceSnapshotId: previous.id,
    ledgerEntries: currentSnapshot.ledgerEntries - previous.ledgerEntries,
    boundaryViolations: currentSnapshot.boundaryViolations - previous.boundaryViolations,
    failures: currentSnapshot.failures - previous.failures,
    commandsApplied: (currentSnapshot.counters?.commandsApplied ?? 0) - (previous.counters?.commandsApplied ?? 0),
    commandsRejected: (currentSnapshot.counters?.commandsRejected ?? 0) - (previous.counters?.commandsRejected ?? 0),
    proofs: (currentSnapshot.counters?.proofs ?? 0) - (previous.counters?.proofs ?? 0),
    handoffs: (currentSnapshot.counters?.handoffs ?? 0) - (previous.counters?.handoffs ?? 0)
  };
}

function buildHistoryTrend(history, currentSnapshot) {
  const samples = [...history.slice(-MAX_HISTORY_SNAPSHOTS), currentSnapshot];
  const lastHealthyIndex = samples.findLastIndex((snapshot) => (
    snapshot.exportable && !snapshot.degraded && snapshot.boundaryViolations === 0
  ));
  const unhealthyTail = lastHealthyIndex === -1
    ? samples.length
    : samples.length - lastHealthyIndex - 1;
  const statusTransitions = buildStatusTransitions(samples.slice(0, -1), currentSnapshot.status, currentSnapshot.capturedAt);
  const previous = samples.at(-2) ?? null;

  return {
    sampleCount: samples.length,
    latestStatus: currentSnapshot.status,
    previousStatus: previous?.status ?? null,
    statusChanged: previous ? previous.status !== currentSnapshot.status : false,
    statusChangedAt: statusTransitions.at(-1)?.at ?? currentSnapshot.capturedAt,
    unhealthySnapshotsInTail: unhealthyTail,
    boundaryViolationTrend: previous
      ? currentSnapshot.boundaryViolations - previous.boundaryViolations
      : currentSnapshot.boundaryViolations,
    proofTrend: previous
      ? (currentSnapshot.counters?.proofs ?? 0) - (previous.counters?.proofs ?? 0)
      : currentSnapshot.counters?.proofs ?? 0,
    handoffTrend: previous
      ? (currentSnapshot.counters?.handoffs ?? 0) - (previous.counters?.handoffs ?? 0)
      : currentSnapshot.counters?.handoffs ?? 0
  };
}

function datasetExportBlockers(datasetName, dataset, state, operationalHealth, providerSyncAligned) {
  const validationBlocked = operationalHealth.validation.ok ? [] : ['validation-failed'];
  const dirtyBlocked = state.dirty ? ['dirty-state'] : [];
  const degradedBlocked = state.degradedMode ? ['degraded-mode'] : [];
  const providerBlocked = providerSyncAligned ? [] : ['provider-sync-behind-checkpoint'];

  if (datasetName === 'ledgerEntries') {
    return [
      ...validationBlocked,
      ...dirtyBlocked,
      ...degradedBlocked,
      ...providerBlocked,
      ...operationalHealth.actionableErrors.map((error) => error.code)
    ];
  }

  if (datasetName === 'commandReceipts') {
    return validationBlocked;
  }

  if (datasetName === 'boundaryViolations') {
    return state.boundaryViolations.length > 0 ? [] : ['no-boundary-violations'];
  }

  if (datasetName === 'historySnapshots') {
    return dataset.records > 0 ? [] : ['no-retained-history'];
  }

  if (datasetName === 'timeline') {
    return [];
  }

  return ['unknown-dataset'];
}

function buildDatasetExportPlan(state, datasets, operationalHealth, providerSyncAligned, now) {
  return EXPORT_DATASET_NAMES.map((name) => {
    const dataset = datasets[name];
    const blockers = [...new Set(datasetExportBlockers(
      name,
      dataset,
      state,
      operationalHealth,
      providerSyncAligned
    ))].sort();
    const cursor = stableDigest({
      surfaceId,
      dataset: name,
      boundaryKey: state.boundary.isolation.boundaryKey,
      checkpoint: state.checkpoint,
      records: dataset.records,
      highWatermark: dataset.highWatermark
    });

    return {
      dataset: name,
      datasetId: `${surfaceId}:${state.boundary.isolation.boundaryKey}:${name}`,
      generatedAt: now,
      cursor,
      format: dataset.format,
      records: dataset.records,
      highWatermark: dataset.highWatermark,
      exportable: dataset.exportable && blockers.length === 0,
      blockers,
      requiredFields: dataset.requiredFields,
      proof: {
        digestAlgorithm: 'fnv1a32-stable-json',
        digest: stableDigest({
          dataset: name,
          cursor,
          schemaVersion: dataset.schemaVersion,
          requiredFields: dataset.requiredFields,
          exportable: dataset.exportable && blockers.length === 0
        })
      },
      nextCommand: blockers.includes('provider-sync-behind-checkpoint')
        ? {
            op: 'update-provider-sync',
            cursor: state.checkpoint.cursor,
            generation: state.checkpoint.generation
          }
        : null
    };
  });
}

function buildDatasetExportWindow(name, state, timeline, history) {
  if (name === 'ledgerEntries') {
    return {
      cursor: state.ledger[0]?.id ?? null,
      head: state.ledger.at(-1)?.id ?? null,
      from: state.ledger[0]?.at ?? null,
      to: state.ledger.at(-1)?.at ?? null
    };
  }

  if (name === 'commandReceipts') {
    return {
      cursor: state.commandReceipts[0]?.id ?? null,
      head: state.commandReceipts.at(-1)?.id ?? null,
      from: state.commandReceipts[0]?.at ?? null,
      to: state.commandReceipts.at(-1)?.at ?? null
    };
  }

  if (name === 'boundaryViolations') {
    return {
      cursor: state.boundaryViolations[0]?.id ?? null,
      head: state.boundaryViolations.at(-1)?.id ?? null,
      from: state.boundaryViolations[0]?.at ?? null,
      to: state.boundaryViolations.at(-1)?.at ?? null
    };
  }

  if (name === 'historySnapshots') {
    return {
      cursor: history[0]?.id ?? null,
      head: history.at(-1)?.id ?? null,
      from: history[0]?.capturedAt ?? null,
      to: history.at(-1)?.capturedAt ?? null
    };
  }

  return {
    cursor: timeline[0]?.id ?? null,
    head: timeline.at(-1)?.id ?? null,
    from: timeline[0]?.at ?? null,
    to: timeline.at(-1)?.at ?? null
  };
}

function buildExportPackageSummaries(state, datasets, exportPlan, timeline, history, operationalHealth, now) {
  const validationCodes = operationalHealth.validation.findings.map((finding) => finding.code).sort();

  return exportPlan.map((plan) => {
    const dataset = datasets[plan.dataset];
    const window = buildDatasetExportWindow(plan.dataset, state, timeline, history);
    const contentDescriptor = {
      surfaceId,
      dataset: plan.dataset,
      boundaryKey: state.boundary.isolation.boundaryKey,
      checkpoint: state.checkpoint,
      cursor: plan.cursor,
      records: plan.records,
      highWatermark: plan.highWatermark,
      window,
      validationCodes
    };
    const packageDigest = stableDigest({
      ...contentDescriptor,
      exportable: plan.exportable,
      blockers: plan.blockers
    });

    return {
      packageId: `${plan.datasetId}:package:${packageDigest.split(':').at(-1)}`,
      dataset: plan.dataset,
      generatedAt: now,
      route: `/memory/audit/exports/${plan.dataset}`,
      method: 'GET',
      mediaType: EXPORT_PACKAGE_MEDIA_TYPES[dataset.format] ?? EXPORT_PACKAGE_MEDIA_TYPES.json,
      format: dataset.format,
      records: plan.records,
      highWatermark: plan.highWatermark,
      window,
      exportable: plan.exportable,
      blockers: plan.blockers,
      requiredFields: plan.requiredFields,
      contentDigest: stableDigest(contentDescriptor),
      packageDigest,
      providerSync: {
        aligned: operationalHealth.providerServiceContract.syncMetadata.aligned,
        generation: state.providerContract.sync.generation,
        cursor: state.providerContract.sync.cursor,
        leaseValid: state.providerContract.lease.valid
      },
      proof: {
        digestAlgorithm: 'fnv1a32-stable-json',
        digest: stableDigest({
          packageDigest,
          contentDigest: stableDigest(contentDescriptor),
          proofDigest: plan.proof.digest,
          manifestId: `${surfaceId}:${state.boundary.tenantId}:${state.boundary.workspaceId}`
        })
      },
      nextCommand: plan.nextCommand
    };
  });
}

function buildExportAnalytics(datasets, exportPlan, exportPackages) {
  const blockerCounts = exportPlan.reduce((acc, dataset) => {
    dataset.blockers.forEach((blocker) => {
      acc[blocker] = (acc[blocker] ?? 0) + 1;
    });

    return acc;
  }, {});
  const datasetRecords = Object.fromEntries(Object.entries(datasets).map(([name, dataset]) => [
    name,
    dataset.records
  ]));
  const exportableRecords = exportPlan
    .filter((dataset) => dataset.exportable)
    .reduce((total, dataset) => total + dataset.records, 0);
  const blockedRecords = exportPlan
    .filter((dataset) => !dataset.exportable)
    .reduce((total, dataset) => total + dataset.records, 0);

  return {
    datasets: exportPlan.length,
    datasetRecords,
    totalRecords: Object.values(datasetRecords).reduce((total, records) => total + records, 0),
    exportableDatasets: exportPlan.filter((dataset) => dataset.exportable).length,
    blockedDatasets: exportPlan.filter((dataset) => !dataset.exportable).length,
    exportableRecords,
    blockedRecords,
    packages: exportPackages.length,
    readyPackages: exportPackages.filter((pkg) => pkg.exportable).length,
    blockedPackages: exportPackages.filter((pkg) => !pkg.exportable).length,
    blockerCounts,
    firstReadyPackageId: exportPackages.find((pkg) => pkg.exportable)?.packageId ?? null,
    lastPackageDigest: exportPackages.at(-1)?.packageDigest ?? null
  };
}

function buildExportDatasets(state, timeline, history, operationalHealth, now) {
  const providerSyncAligned = operationalHealth.providerServiceContract.syncMetadata.aligned;
  const sharedBlockers = operationalHealth.actionableErrors.map((error) => error.code).sort();
  const blocked = sharedBlockers.length > 0 || !operationalHealth.validation.ok || state.dirty || state.degradedMode;
  const datasetBase = {
    generatedAt: now,
    boundaryKey: state.boundary.isolation.boundaryKey,
    redaction: 'tenant-workspace-boundary-only',
    schemaVersion: state.schemaVersion
  };

  return {
    ledgerEntries: {
      ...datasetBase,
      format: 'jsonl',
      records: state.ledger.length,
      highWatermark: state.ledger.at(-1)?.at ?? null,
      exportable: !blocked && providerSyncAligned,
      requiredFields: ['id', 'kind', 'at', 'scope', 'proof', 'boundary.isolation.boundaryKey']
    },
    commandReceipts: {
      ...datasetBase,
      format: 'jsonl',
      records: state.commandReceipts.length,
      highWatermark: state.commandReceipts.at(-1)?.at ?? null,
      exportable: operationalHealth.validation.ok,
      requiredFields: ['id', 'op', 'at', 'applied', 'reason', 'accessDecision', 'clientWorkflowHandoff']
    },
    boundaryViolations: {
      ...datasetBase,
      format: 'jsonl',
      records: state.boundaryViolations.length,
      highWatermark: state.boundaryViolations.at(-1)?.at ?? null,
      exportable: state.boundaryViolations.length > 0,
      requiredFields: ['id', 'op', 'at', 'reason', 'expectedTenantId', 'actualTenantId']
    },
    historySnapshots: {
      ...datasetBase,
      format: 'jsonl',
      records: history.length,
      highWatermark: history.at(-1)?.capturedAt ?? null,
      exportable: history.length > 0,
      requiredFields: ['id', 'capturedAt', 'status', 'checkpoint', 'counters']
    },
    timeline: {
      ...datasetBase,
      format: 'jsonl',
      records: timeline.length,
      highWatermark: timeline.at(-1)?.at ?? null,
      exportable: timeline.length > 0,
      requiredFields: ['at', 'type', 'id', 'severity']
    }
  };
}

function buildReportingState(state, analytics, timeline, history, currentSnapshot, operationalHealth, status, now) {
  const timelineSeverity = countBy(timeline, (event) => event.severity ?? 'unknown');
  const timelineTypes = countBy(timeline, (event) => event.type ?? 'unknown');
  const historyStatuses = countBy(history, (snapshot) => snapshot.status);
  const exportableSnapshots = history.filter((snapshot) => snapshot.exportable);
  const failedExportReasons = [
    ...operationalHealth.actionableErrors.map((error) => error.code),
    ...(!operationalHealth.validation.ok ? ['validation-failed'] : []),
    ...(state.dirty ? ['dirty-state'] : []),
    ...(state.degradedMode ? ['degraded-mode'] : [])
  ];
  const providerSyncAligned = operationalHealth.providerServiceContract.syncMetadata.aligned;
  const datasets = buildExportDatasets(state, timeline, history, operationalHealth, now);
  const exportPlan = buildDatasetExportPlan(state, datasets, operationalHealth, providerSyncAligned, now);
  const exportPackages = buildExportPackageSummaries(
    state,
    datasets,
    exportPlan,
    timeline,
    history,
    operationalHealth,
    now
  );
  const exportAnalytics = buildExportAnalytics(datasets, exportPlan, exportPackages);

  return {
    generatedAt: now,
    statusTransitions: buildStatusTransitions(history, status, now),
    historyTrend: buildHistoryTrend(history.slice(0, -1), currentSnapshot),
    retainedHistory: {
      snapshots: history.length,
      maxSnapshots: MAX_HISTORY_SNAPSHOTS,
      statuses: historyStatuses,
      firstCapturedAt: history[0]?.capturedAt ?? null,
      lastCapturedAt: history.at(-1)?.capturedAt ?? null,
      exportableSnapshots: exportableSnapshots.length,
      lastExportableAt: exportableSnapshots.at(-1)?.capturedAt ?? null,
      deltas: buildHistoryDeltas(history.slice(0, -1), currentSnapshot)
    },
    retainedTimeline: {
      events: timeline.length,
      firstEventAt: timeline[0]?.at ?? null,
      lastEventAt: timeline.at(-1)?.at ?? null,
      byType: timelineTypes,
      bySeverity: timelineSeverity,
      lastErrorAt: timeline.filter((event) => event.severity === 'error').at(-1)?.at ?? null
    },
    exportReadiness: {
      ready: failedExportReasons.length === 0 && operationalHealth.validation.ok,
      reasons: [...new Set(failedExportReasons)].sort(),
      proofEntries: analytics.ledger.proofs,
      handoffs: analytics.ledger.handoffs,
      providerLeaseValid: state.providerContract.lease.valid,
      providerSyncAligned,
      exportableDatasets: exportPlan.filter((dataset) => dataset.exportable).length,
      blockedDatasets: exportPlan.filter((dataset) => !dataset.exportable).length,
      exportableRecords: exportAnalytics.exportableRecords,
      blockedRecords: exportAnalytics.blockedRecords,
      readyPackages: exportAnalytics.readyPackages
    },
    datasets,
    exportPlan,
    exportPackages,
    exportAnalytics
  };
}

function buildCurrentHistorySnapshot(state, counters, status, now) {
  return normalizeHistorySnapshot({
    id: `${surfaceId}:${state.checkpoint.generation}:${state.ledger.length}:${state.boundaryViolations.length}`,
    capturedAt: now,
    status,
    checkpoint: state.checkpoint,
    ledgerEntries: state.ledger.length,
    boundaryViolations: state.boundaryViolations.length,
    failures: state.lastFailure ? 1 : 0,
    degraded: state.degradedMode,
    dirty: state.dirty,
    counters: {
      commandsApplied: counters.commands.applied,
      commandsRejected: counters.commands.rejected,
      proofs: counters.ledger.proofs,
      handoffs: counters.ledger.handoffs
    }
  }, state.history.length, now);
}

function selectClientHandoffRoute(state, operationalHealth, externalReady) {
  if (externalReady) {
    return CLIENT_HANDOFF_ROUTES.ready;
  }

  if (!state.lifecycle.enabled) {
    return CLIENT_HANDOFF_ROUTES.disabled;
  }

  if (state.degradedMode || state.lastFailure) {
    return CLIENT_HANDOFF_ROUTES.recover;
  }

  if (!state.providerContract.negotiated) {
    return CLIENT_HANDOFF_ROUTES.provider;
  }

  return CLIENT_HANDOFF_ROUTES.review;
}

function buildClientWorkflowHandoff(state, operationalHealth, now, externalReady, blockers) {
  const route = selectClientHandoffRoute(state, operationalHealth, externalReady);
  const client = state.clientRuntime;
  const nextAction = operationalHealth.lifecycle.nextAction;
  const commandReceiptCursor = state.commandReceipts.at(-1)?.id ?? null;
  const handoffToken = stableDigest({
    clientId: client.clientId,
    sessionId: client.sessionId,
    boundaryKey: state.boundary.isolation.boundaryKey,
    checkpoint: state.checkpoint,
    providerId: state.providerContract.providerId,
    route,
    commandReceiptCursor,
    ready: externalReady
  });

  return {
    generatedAt: now,
    client: {
      clientId: client.clientId,
      sessionId: client.sessionId,
      requestId: client.requestId,
      requestedRoute: client.route,
      requestedWorkflow: client.workflow,
      handoffMode: client.handoffMode,
      accepts: client.accepts
    },
    route,
    view: externalReady
      ? 'external-handoff-ready'
      : route === CLIENT_HANDOFF_ROUTES.provider
        ? 'provider-contract-review'
        : route === CLIENT_HANDOFF_ROUTES.recover
          ? 'audit-recovery'
          : route === CLIENT_HANDOFF_ROUTES.disabled
            ? 'audit-lifecycle-disabled'
            : 'audit-readiness-review',
    primaryAction: {
      action: externalReady ? 'acknowledge-external-handoff' : nextAction.action,
      reason: externalReady ? 'handoff-ready' : nextAction.reason,
      command: externalReady
        ? {
            op: 'handoff-audit',
            target: state.auditHandoff?.target ?? 'memory-manager/audit-sink',
            checkpoint: state.auditHandoff?.checkpoint ?? state.checkpoint
          }
        : nextAction.command
    },
    requiredClientState: {
      boundaryKey: state.boundary.isolation.boundaryKey,
      checkpoint: state.checkpoint,
      providerId: state.providerContract.providerId,
      commandReceiptCursor,
      evidenceManifestRequired: client.accepts.evidenceManifest,
      externalHandoffRequired: client.accepts.externalHandoff
    },
    acknowledgement: {
      required: externalReady && client.handoffMode === 'interactive',
      payload: {
        handoffToken,
        boundaryKey: state.boundary.isolation.boundaryKey,
        checkpointGeneration: state.checkpoint.generation,
        providerId: state.providerContract.providerId,
        commandReceiptCursor
      }
    },
    blockers
  };
}

function buildExternalHandoffState(state, operationalHealth, now) {
  const blocked = operationalHealth.actionableErrors.map((error) => error.code);
  const handoff = state.auditHandoff;
  const provider = state.providerContract;
  const providerServiceContract = operationalHealth.providerServiceContract;
  const checkpointAligned = providerServiceContract.syncMetadata.aligned;
  const ready = provider.negotiated
    && handoff !== null
    && checkpointAligned
    && blocked.length === 0
    && !state.dirty
    && !state.degradedMode;

  return {
    id: `${surfaceId}:${provider.providerId}:external-handoff`,
    generatedAt: now,
    provider: {
      providerId: provider.providerId,
      service: provider.service,
      version: provider.version,
      endpoint: provider.endpoint,
      capabilities: provider.grantedCapabilities,
      negotiated: provider.negotiated
    },
    providerServiceContract,
    boundaryContract: buildBoundaryContractSummary(state, operationalHealth),
    sync: {
      ...provider.sync,
      checkpointAligned,
      leaseValid: provider.lease.valid
    },
    receipt: provider.handoffReceipt
      ? {
          receiptId: provider.handoffReceipt.receiptId,
          status: provider.handoffReceipt.status,
          acknowledgedAt: provider.handoffReceipt.acknowledgedAt,
          externalRevision: provider.handoffReceipt.externalRevision,
          checkpoint: provider.handoffReceipt.checkpoint,
          proofDigest: provider.handoffReceipt.proofDigest,
          rejectionReason: provider.handoffReceipt.rejectionReason
        }
      : null,
    receiptState: {
      required: provider.grantedCapabilities.includes('handoff-receipt'),
      pending: handoff !== null && !provider.handoffReceipt,
      accepted: provider.handoffReceipt?.status === 'accepted',
      rejected: provider.handoffReceipt?.status === 'rejected',
      command: providerServiceContract.receiptCommand
    },
    handoff: handoff
      ? {
          target: handoff.target,
          reason: handoff.reason,
          at: handoff.at,
          checkpoint: handoff.checkpoint,
          ledgerEntries: handoff.ledgerEntries,
          proof: handoff.proof
        }
      : null,
    ready,
    blockers: blocked,
    clientWorkflow: buildClientWorkflowHandoff(state, operationalHealth, now, ready, blocked)
  };
}

function buildPreviewAcceptanceCriterion(id, accepted, reason, detail = {}) {
  return {
    id,
    accepted: Boolean(accepted),
    reason,
    ...detail
  };
}

function buildPreviewAcceptanceContract(state, operationalHealth, reportingState, externalHandoffState, evidenceManifest, now) {
  const clientWorkflow = externalHandoffState.clientWorkflow;
  const validationErrors = operationalHealth.validation.findings
    .filter((finding) => finding.severity === 'error');
  const validationWarnings = operationalHealth.validation.findings
    .filter((finding) => finding.severity === 'warning');
  const readyPackageCount = reportingState?.exportAnalytics?.readyPackages ?? 0;
  const exportableDatasetCount = reportingState?.exportReadiness?.exportableDatasets ?? 0;
  const criteria = [
    buildPreviewAcceptanceCriterion(
      'validation-ok',
      validationErrors.length === 0,
      validationErrors.length === 0 ? 'validation-passed' : 'validation-errors-present',
      { errorCount: validationErrors.length, warningCount: validationWarnings.length }
    ),
    buildPreviewAcceptanceCriterion(
      'actionable-errors-clear',
      operationalHealth.actionableErrors.length === 0,
      operationalHealth.actionableErrors.length === 0 ? 'no-actionable-errors' : 'actionable-errors-present',
      { blockers: operationalHealth.actionableErrors.map((error) => error.code) }
    ),
    buildPreviewAcceptanceCriterion(
      'provider-service-ready',
      operationalHealth.providerServiceContract.ready || operationalHealth.providerServiceContract.phase === 'handoff-received',
      operationalHealth.providerServiceContract.phase,
      {
        providerId: state.providerContract.providerId,
        blockers: operationalHealth.providerServiceContract.blockers
      }
    ),
    buildPreviewAcceptanceCriterion(
      'evidence-manifest-exportable',
      evidenceManifest.exportable,
      evidenceManifest.exportable ? 'evidence-exportable' : 'evidence-blocked',
      { manifestDigest: evidenceManifest.manifestDigest }
    ),
    buildPreviewAcceptanceCriterion(
      'client-workflow-routable',
      Boolean(clientWorkflow.route && clientWorkflow.primaryAction),
      clientWorkflow.view,
      {
        route: clientWorkflow.route,
        primaryAction: clientWorkflow.primaryAction.action
      }
    ),
    buildPreviewAcceptanceCriterion(
      'export-packages-ready',
      readyPackageCount > 0 || exportableDatasetCount > 0,
      readyPackageCount > 0 ? 'ready-packages-available' : 'no-ready-export-package',
      {
        readyPackages: readyPackageCount,
        exportableDatasets: exportableDatasetCount,
        blockedPackages: reportingState?.exportAnalytics?.blockedPackages ?? 0
      }
    )
  ];
  const failedCriteria = criteria.filter((criterion) => !criterion.accepted);
  const readiness = failedCriteria.length === 0
    ? 'accepted'
    : state.degradedMode || state.lastFailure
      ? 'recovery-required'
      : operationalHealth.providerServiceContract.blockers.length > 0
        ? 'provider-review-required'
        : 'user-review-required';
  const commandPreview = clientWorkflow.primaryAction.command
    ? {
        command: clientWorkflow.primaryAction.command,
        commandId: commandId(clientWorkflow.primaryAction.command),
        allowed: buildLifecycleCommandContract(
          state,
          now,
          clientWorkflow.primaryAction.command,
          state.boundary
        ).allowed
      }
    : null;
  const validationSummary = {
    ok: operationalHealth.validation.ok,
    errors: validationErrors.length,
    warnings: validationWarnings.length,
    topFindings: operationalHealth.validation.findings.slice(0, 5).map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      action: finding.action ?? null
    }))
  };
  const nextSteps = [
    ...operationalHealth.actionableErrors.slice(0, 4).map((error, index) => ({
      priority: index + 1,
      source: error.source,
      action: error.action,
      route: error.route,
      command: error.remediation.command,
      commandAllowed: error.remediation.commandAllowed,
      reason: error.code
    })),
    ...(commandPreview && failedCriteria.length === 0
      ? [{
          priority: 1,
          source: 'client-workflow',
          action: clientWorkflow.primaryAction.action,
          route: clientWorkflow.route,
          command: commandPreview.command,
          commandAllowed: commandPreview.allowed,
          reason: clientWorkflow.primaryAction.reason
        }]
      : [])
  ];

  return {
    schema: 'memory-audit-preview-acceptance.v1',
    generatedAt: now,
    route: clientWorkflow.route,
    view: clientWorkflow.view,
    status: operationalHealth.state,
    preview: {
      title: `Memory audit ${operationalHealth.state}`,
      checkpoint: state.checkpoint,
      boundaryKey: state.boundary.isolation.boundaryKey,
      providerId: state.providerContract.providerId,
      changedSincePreviousSnapshot: reportingState?.retainedHistory?.deltas ?? null,
      visibleCounts: {
        ledgerEntries: state.ledger.length,
        commandReceipts: state.commandReceipts.length,
        boundaryViolations: state.boundaryViolations.length,
        readyPackages: readyPackageCount,
        blockedDatasets: reportingState?.exportReadiness?.blockedDatasets ?? 0
      }
    },
    acceptance: {
      accepted: failedCriteria.length === 0,
      readiness,
      criteria,
      failedCriteria: failedCriteria.map((criterion) => criterion.id),
      acknowledgementRequired: clientWorkflow.acknowledgement.required,
      acknowledgementPayload: clientWorkflow.acknowledgement.payload
    },
    validationSummary,
    nextSteps,
    commandPreview,
    proof: {
      digestAlgorithm: 'fnv1a32-stable-json',
      digest: stableDigest({
        surfaceId,
        boundaryKey: state.boundary.isolation.boundaryKey,
        status: operationalHealth.state,
        readiness,
        criteria: criteria.map((criterion) => [criterion.id, criterion.accepted, criterion.reason]),
        validationSummary,
        route: clientWorkflow.route,
        manifestDigest: evidenceManifest.manifestDigest,
        commandPreview
      })
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function stableDigest(value) {
  const payload = stableJson(value);
  let hash = 2166136261;

  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function buildLedgerProofChain(state) {
  return state.ledger.reduce((acc, entry, index) => {
    const previousDigest = acc.at(-1)?.chainDigest ?? null;
    const entryCommitment = {
      index,
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      scope: entry.scope,
      proof: entry.proof,
      boundaryKey: entry.boundary.isolation.boundaryKey,
      previousDigest
    };
    const entryDigest = stableDigest(entryCommitment);
    const chainDigest = stableDigest({
      surfaceId,
      schemaVersion: state.schemaVersion,
      previousDigest,
      entryDigest,
      checkpoint: state.checkpoint
    });

    return [...acc, {
      index,
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      entryDigest,
      previousDigest,
      chainDigest,
      hasProof: entry.proof !== null,
      boundaryKey: entry.boundary.isolation.boundaryKey
    }];
  }, []);
}

function buildAuditEvidenceManifest(state, operationalHealth, analytics, now) {
  const ledgerChain = buildLedgerProofChain(state);
  const providerServiceContract = operationalHealth.providerServiceContract;
  const providerSyncAligned = providerServiceContract.syncMetadata.aligned;
  const validationCodes = operationalHealth.validation.findings.map((finding) => finding.code).sort();
  const blockers = operationalHealth.actionableErrors.map((error) => error.code).sort();
  const checkpointDigest = stableDigest({
    surfaceId,
    schemaVersion: state.schemaVersion,
    boundaryKey: state.boundary.isolation.boundaryKey,
    checkpoint: state.checkpoint
  });
  const providerDigest = stableDigest({
    providerId: state.providerContract.providerId,
    service: state.providerContract.service,
    version: state.providerContract.version,
    capabilities: state.providerContract.grantedCapabilities,
    sync: state.providerContract.sync,
    handoffReceipt: state.providerContract.handoffReceipt
  });
  const manifestDigest = stableDigest({
    checkpointDigest,
    providerDigest,
    providerServiceDigest: providerServiceContract.proof.digest,
    ledgerHeadDigest: ledgerChain.at(-1)?.chainDigest ?? null,
    validationCodes,
    blockers,
    dirty: state.dirty,
    degraded: state.degradedMode
  });

  return {
    manifestId: `${surfaceId}:${state.boundary.tenantId}:${state.boundary.workspaceId}:evidence:${state.checkpoint.generation}`,
    generatedAt: now,
    schemaVersion: state.schemaVersion,
    digestAlgorithm: 'fnv1a32-stable-json',
    manifestDigest,
    checkpointDigest,
    providerDigest,
    boundaryDigest: stableDigest({
      tenantId: state.boundary.tenantId,
      workspaceId: state.boundary.workspaceId,
      role: state.boundary.role,
      permissions: state.boundary.permissions
    }),
    ledger: {
      entries: ledgerChain.length,
      proofEntries: analytics.ledger.proofs,
      headDigest: ledgerChain.at(-1)?.chainDigest ?? null,
      chain: ledgerChain
    },
    provider: {
      providerId: state.providerContract.providerId,
      negotiated: state.providerContract.negotiated,
      servicePhase: providerServiceContract.phase,
      serviceReady: providerServiceContract.ready,
      serviceBlockers: providerServiceContract.blockers,
      handoffReceiptStatus: state.providerContract.handoffReceipt?.status ?? null,
      handoffReceiptAcknowledgedAt: state.providerContract.handoffReceipt?.acknowledgedAt ?? null,
      syncAligned: providerSyncAligned,
      leaseValid: state.providerContract.lease.valid
    },
    validation: {
      ok: operationalHealth.validation.ok,
      codes: validationCodes,
      blockers
    },
    exportable: operationalHealth.validation.ok
      && blockers.length === 0
      && providerSyncAligned
      && !state.dirty
      && !state.degradedMode
  };
}

function buildExportSummary(state, counters, timeline, operationalHealth, status, now, reportingState) {
  const blockerCodes = operationalHealth.actionableErrors.map((error) => error.code);
  const externalHandoffState = buildExternalHandoffState(state, operationalHealth, now);
  const evidenceManifest = buildAuditEvidenceManifest(state, operationalHealth, counters, now);
  const previewAcceptance = buildPreviewAcceptanceContract(
    state,
    operationalHealth,
    reportingState,
    externalHandoffState,
    evidenceManifest,
    now
  );

  return {
    exportId: `${surfaceId}:${state.boundary.tenantId}:${state.boundary.workspaceId}:${state.checkpoint.generation}`,
    generatedAt: now,
    schemaVersion: state.schemaVersion,
    status,
    ready: blockerCodes.length === 0 && operationalHealth.validation.ok && !state.degradedMode,
    boundary: state.boundary,
    boundaryContract: buildBoundaryContractSummary(state, operationalHealth),
    checkpoint: state.checkpoint,
    counters,
    providerContract: state.providerContract,
    providerServiceContract: operationalHealth.providerServiceContract,
    clientRuntime: state.clientRuntime,
    lifecycle: operationalHealth.lifecycle,
    restartRecovery: operationalHealth.restartRecovery,
    receiptRecovery: operationalHealth.receiptRecovery,
    reportingState,
    datasets: reportingState?.datasets ?? {},
    exportPlan: reportingState?.exportPlan ?? [],
    exportPackages: reportingState?.exportPackages ?? [],
    exportAnalytics: reportingState?.exportAnalytics ?? null,
    timelineEvents: timeline.length,
    evidenceTypes: {
      ledgerEntries: state.ledger.length,
      boundaryViolations: state.boundaryViolations.length,
      handoffAvailable: state.auditHandoff !== null,
      externalHandoffReady: externalHandoffState.ready
    },
    blockers: blockerCodes,
    nextRetryAt: operationalHealth.retry.retryDue ? now : operationalHealth.retry.nextRetryAt,
    nextAction: operationalHealth.lifecycle.nextAction,
    clientWorkflow: externalHandoffState.clientWorkflow,
    externalHandoffState,
    evidenceManifest,
    previewAcceptance
  };
}

function buildAuditProof(state, analytics, now, reportingState = null) {
  const operationalHealth = buildOperationalHealth(state, now);
  const evidenceManifest = buildAuditEvidenceManifest(state, operationalHealth, analytics, now);
  const externalHandoffState = buildExternalHandoffState(state, operationalHealth, now);

  return {
    surfaceId,
    schemaVersion: state.schemaVersion,
    generatedAt: now,
    checkpoint: state.checkpoint,
    ledgerEntries: state.ledger.length,
    lastLedgerEntryId: state.ledger.at(-1)?.id ?? null,
    boundary: state.boundary,
    boundaryContract: buildBoundaryContractSummary(state, operationalHealth),
    boundaryViolations: state.boundaryViolations.length,
    auditHandoff: state.auditHandoff,
    providerContract: state.providerContract,
    externalHandoffState,
    restartSafe: state.lifecycle.enabled && !state.dirty,
    status: operationalHealth.state,
    restartRecovery: operationalHealth.restartRecovery,
    lifecycle: operationalHealth.lifecycle,
    previewAcceptance: buildPreviewAcceptanceContract(
      state,
      operationalHealth,
      reportingState,
      externalHandoffState,
      evidenceManifest,
      now
    ),
    evidenceManifest,
    operationalHealth
  };
}

export function describeMemoryAuditSurface(input = {}) {
  const now = asIsoTimestamp(input.now, new Date().toISOString());
  const shapedState = shapePersistedState(input, now);
  const { state, results } = applyCommands(shapedState, input.commands, now);
  const operationalHealth = buildOperationalHealth(state, now);
  const status = operationalHealth.state;
  const analytics = buildAnalyticsCounters(state, results, operationalHealth);
  const timeline = buildTimeline(state, results, now);
  const currentHistorySnapshot = buildCurrentHistorySnapshot(state, analytics, status, now);
  const history = appendHistorySnapshot(state.history, currentHistorySnapshot);
  const reportingState = buildReportingState(
    state,
    analytics,
    timeline,
    history,
    currentHistorySnapshot,
    operationalHealth,
    status,
    now
  );
  const reporting = {
    timeline,
    history,
    latestSnapshot: currentHistorySnapshot,
    reportingState,
    exportSummary: buildExportSummary(state, analytics, timeline, operationalHealth, status, now, reportingState)
  };
  const reportedState = {
    ...state,
    history
  };

  return {
    ok: operationalHealth.validation.ok
      && !operationalHealth.retry.exhausted
      && !state.degradedMode
      && operationalHealth.actionableErrors.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'memory audit persisted-state recovery contract',
    status,
    restartSafe: state.lifecycle.enabled
      && (status === 'ready' || status === 'cold-start' || status === 'recoverable-unproven'),
    boundary: state.boundary,
    state: reportedState,
    commands: results,
    analytics,
    reporting,
    previewAcceptance: reporting.exportSummary.previewAcceptance,
    operationalHealth,
    auditProof: {
      ...buildAuditProof(state, analytics, now, reportingState),
      analytics,
      exportSummary: reporting.exportSummary,
      reportingState,
      historySnapshot: currentHistorySnapshot
    },
    evidence: [
      ...state.ledger.map((entry) => ({
        type: 'memory-audit-ledger-entry',
        id: entry.id,
        kind: entry.kind,
        at: entry.at,
        proof: entry.proof,
        boundary: entry.boundary,
        handoff: entry.handoff
      })),
      ...state.boundaryViolations.map((violation) => ({
        type: 'memory-audit-boundary-violation',
        id: violation.id,
        op: violation.op,
        at: violation.at,
        reason: violation.reason,
        scope: violation.scope ?? violation.accessDecision?.scope ?? null,
        expectedTenantId: violation.expectedTenantId ?? null,
        expectedWorkspaceId: violation.expectedWorkspaceId ?? null,
        actualTenantId: violation.actualTenantId ?? violation.boundary?.tenantId ?? null,
        actualWorkspaceId: violation.actualWorkspaceId ?? violation.boundary?.workspaceId ?? null,
        requiredPermission: violation.requiredPermission ?? null,
        permissionClaims: violation.accessDecision?.permissionClaims ?? violation.boundary?.permissionClaims ?? null
      })),
      ...state.commandReceipts.map((receipt) => ({
        type: 'memory-audit-command-receipt',
        id: receipt.id,
        op: receipt.op,
        at: receipt.at,
        applied: receipt.applied,
        reason: receipt.reason,
        boundary: receipt.boundary,
        permissionClaims: receipt.permissionClaims,
        accessDecision: receipt.accessDecision,
        lifecycleValidation: receipt.lifecycleValidation,
        lifecycleControl: receipt.lifecycleControl,
        providerServiceContract: receipt.providerServiceContract,
        clientWorkflowHandoff: receipt.clientWorkflowHandoff
      })),
      {
        type: 'memory-audit-export-summary',
        id: reporting.exportSummary.exportId,
        at: reporting.exportSummary.generatedAt,
        status: reporting.exportSummary.status,
        ready: reporting.exportSummary.ready,
        blockers: reporting.exportSummary.blockers,
        counters: analytics
      },
      {
        type: 'memory-audit-reporting-state',
        id: `${reporting.exportSummary.exportId}:reporting-state`,
        at: reportingState.generatedAt,
        retainedHistory: reportingState.retainedHistory,
        historyTrend: reportingState.historyTrend,
        retainedTimeline: reportingState.retainedTimeline,
        exportReadiness: reportingState.exportReadiness,
        datasets: Object.fromEntries(Object.entries(reportingState.datasets).map(([name, dataset]) => [
          name,
          {
            records: dataset.records,
            highWatermark: dataset.highWatermark,
            exportable: dataset.exportable,
            format: dataset.format
          }
        ])),
        exportPlan: reportingState.exportPlan.map((dataset) => ({
          dataset: dataset.dataset,
          cursor: dataset.cursor,
          records: dataset.records,
          exportable: dataset.exportable,
          blockers: dataset.blockers,
          nextCommand: dataset.nextCommand
        }))
      },
      {
        type: 'memory-audit-lifecycle-state',
        id: `${reporting.exportSummary.exportId}:lifecycle`,
        at: now,
        enabled: state.lifecycle.enabled,
        mode: state.lifecycle.mode,
        nextRunAt: state.lifecycle.nextRunAt,
        nextAction: operationalHealth.lifecycle.nextAction,
        validation: operationalHealth.lifecycle.validation,
        controls: operationalHealth.lifecycle.controls
      },
      {
        type: 'memory-audit-receipt-recovery',
        id: `${reporting.exportSummary.exportId}:receipt-recovery`,
        at: state.receiptRecovery.observedAt,
        aligned: state.receiptRecovery.aligned,
        commandLogCount: state.receiptRecovery.commandLogCount,
        receiptCount: state.receiptRecovery.receiptCount,
        missingReceiptIds: state.receiptRecovery.missingReceiptIds,
        recoveredReceiptIds: state.receiptRecovery.recoveredReceiptIds,
        staleReceiptIds: state.receiptRecovery.staleReceiptIds,
        truncatedReceiptIds: state.receiptRecovery.truncatedReceiptIds,
        proof: state.receiptRecovery.proof
      },
      {
        type: 'memory-audit-provider-contract',
        id: `${reporting.exportSummary.exportId}:provider-contract`,
        at: state.providerContract.lastNegotiatedAt ?? now,
        providerId: state.providerContract.providerId,
        service: state.providerContract.service,
        negotiated: state.providerContract.negotiated,
        grantedCapabilities: state.providerContract.grantedCapabilities,
        missingRequiredCapabilities: state.providerContract.missingRequiredCapabilities,
        sync: state.providerContract.sync,
        handoffReceipt: state.providerContract.handoffReceipt
      },
      {
        type: 'memory-audit-provider-service-contract',
        id: `${reporting.exportSummary.exportId}:provider-service-contract`,
        at: operationalHealth.providerServiceContract.generatedAt,
        providerId: operationalHealth.providerServiceContract.providerId,
        service: operationalHealth.providerServiceContract.service,
        phase: operationalHealth.providerServiceContract.phase,
        ready: operationalHealth.providerServiceContract.ready,
        blockers: operationalHealth.providerServiceContract.blockers,
        compatibility: operationalHealth.providerServiceContract.compatibility,
        syncMetadata: operationalHealth.providerServiceContract.syncMetadata,
        handoffState: operationalHealth.providerServiceContract.handoffState,
        nextCommand: operationalHealth.providerServiceContract.nextCommand,
        proof: operationalHealth.providerServiceContract.proof
      },
      {
        type: 'memory-audit-external-handoff-state',
        id: reporting.exportSummary.externalHandoffState.id,
        at: reporting.exportSummary.externalHandoffState.generatedAt,
        ready: reporting.exportSummary.externalHandoffState.ready,
        provider: reporting.exportSummary.externalHandoffState.provider,
        providerServiceContract: reporting.exportSummary.externalHandoffState.providerServiceContract,
        boundaryContract: reporting.exportSummary.externalHandoffState.boundaryContract,
        sync: reporting.exportSummary.externalHandoffState.sync,
        receipt: reporting.exportSummary.externalHandoffState.receipt,
        receiptState: reporting.exportSummary.externalHandoffState.receiptState,
        blockers: reporting.exportSummary.externalHandoffState.blockers
      },
      {
        type: 'memory-audit-client-workflow-handoff',
        id: `${reporting.exportSummary.exportId}:client-workflow`,
        at: reporting.exportSummary.clientWorkflow.generatedAt,
        route: reporting.exportSummary.clientWorkflow.route,
        view: reporting.exportSummary.clientWorkflow.view,
        client: reporting.exportSummary.clientWorkflow.client,
        primaryAction: reporting.exportSummary.clientWorkflow.primaryAction,
        requiredClientState: reporting.exportSummary.clientWorkflow.requiredClientState,
        acknowledgement: reporting.exportSummary.clientWorkflow.acknowledgement,
        blockers: reporting.exportSummary.clientWorkflow.blockers
      },
      {
        type: 'memory-audit-preview-acceptance',
        id: `${reporting.exportSummary.exportId}:preview-acceptance`,
        at: reporting.exportSummary.previewAcceptance.generatedAt,
        route: reporting.exportSummary.previewAcceptance.route,
        view: reporting.exportSummary.previewAcceptance.view,
        status: reporting.exportSummary.previewAcceptance.status,
        preview: reporting.exportSummary.previewAcceptance.preview,
        acceptance: reporting.exportSummary.previewAcceptance.acceptance,
        validationSummary: reporting.exportSummary.previewAcceptance.validationSummary,
        nextSteps: reporting.exportSummary.previewAcceptance.nextSteps,
        commandPreview: reporting.exportSummary.previewAcceptance.commandPreview,
        proof: reporting.exportSummary.previewAcceptance.proof
      },
      {
        type: 'memory-audit-evidence-manifest',
        id: reporting.exportSummary.evidenceManifest.manifestId,
        at: reporting.exportSummary.evidenceManifest.generatedAt,
        digestAlgorithm: reporting.exportSummary.evidenceManifest.digestAlgorithm,
        manifestDigest: reporting.exportSummary.evidenceManifest.manifestDigest,
        checkpointDigest: reporting.exportSummary.evidenceManifest.checkpointDigest,
        providerDigest: reporting.exportSummary.evidenceManifest.providerDigest,
        providerServiceDigest: reporting.exportSummary.evidenceManifest.providerServiceDigest,
        boundaryDigest: reporting.exportSummary.evidenceManifest.boundaryDigest,
        ledgerHeadDigest: reporting.exportSummary.evidenceManifest.ledger.headDigest,
        exportable: reporting.exportSummary.evidenceManifest.exportable,
        validation: reporting.exportSummary.evidenceManifest.validation
      },
      ...(Array.isArray(input.evidence) ? input.evidence : [])
    ]
  };
}

export default describeMemoryAuditSurface;
