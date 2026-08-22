export const surfaceId = "aios_kernel-lifecycle_process-admission_001";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "process-admission";

const KNOWN_CLIENT_STATES = new Set(['anonymous', 'authenticated', 'elevated']);
const KNOWN_RUNTIME_MODES = new Set(['hosted-kernel', 'local-kernel', 'simulation']);
const KNOWN_REQUEST_PRIORITIES = new Set(['low', 'normal', 'high']);
const KNOWN_ADMISSION_COMMANDS = new Set(['request-admission', 'recover-admission', 'cancel-admission']);
const KNOWN_HEALTH_STATES = new Set(['healthy', 'degraded', 'unhealthy', 'unknown']);
const KNOWN_DEPENDENCY_STATES = new Set(['ready', 'degraded', 'unavailable', 'unknown']);
const KNOWN_PROVIDER_STATES = new Set(['ready', 'degraded', 'unavailable', 'unknown']);
const KNOWN_HANDOFF_STATES = new Set(['not-required', 'ready', 'queued', 'blocked', 'cancelled']);
const KNOWN_OBJECTIVE_ORIGINS = new Set(['request', 'command', 'client', 'runtime', 'default']);
const KNOWN_PROVIDER_CONSISTENCY_MODES = new Set(['eventual', 'read-your-writes', 'linearizable']);
const KNOWN_HANDOFF_ACK_MODES = new Set(['none', 'provider-ack', 'durable-provider-ack']);
const KNOWN_POLICY_MODES = new Set(['enforce', 'monitor', 'disabled']);
const KNOWN_SCOPE_BOUNDARY_MODES = new Set(['enforce', 'monitor', 'disabled']);
const KNOWN_LIFECYCLE_CONTROL_STATES = new Set(['enabled', 'disabled', 'maintenance']);
const KNOWN_SCHEDULING_MODES = new Set(['immediate', 'queued', 'manual']);
const KNOWN_LIFECYCLE_SETTING_COMMANDS = new Set([
  'enable-process-admission',
  'disable-process-admission',
  'enter-process-admission-maintenance',
  'release-process-admission-maintenance',
  'set-process-admission-schedule'
]);
const LIFECYCLE_SETTING_COMMAND_TARGET_STATE = {
  'enable-process-admission': 'enabled',
  'disable-process-admission': 'disabled',
  'enter-process-admission-maintenance': 'maintenance',
  'release-process-admission-maintenance': 'enabled',
  'set-process-admission-schedule': null
};
const CRITICAL_DEPENDENCIES = new Set(['process-supervisor', 'persistence-journal', 'spawn-handoff']);
const HOSTED_KERNEL_PROVIDER_CAPABILITIES = [
  'kernel.process.spawn',
  'kernel.process.sync-metadata',
  'kernel.process.external-handoff'
];
const MAILCHIMP_PROVIDER_CAPABILITIES = [
  'mailchimp.audience.read',
  'mailchimp.campaign.write',
  'mailchimp.webhook.handoff'
];
const MAILCHIMP_ACK_MODES = new Set(['provider-ack', 'durable-provider-ack']);
const TERMINAL_PERSISTED_STATUSES = new Set(['admitted', 'denied', 'cancelled']);
const RECOVERABLE_PERSISTED_STATUSES = new Set([
  'pending-authorization',
  'pending-remediation',
  'pending-health-retry',
  'blocked-health',
  'spawn-dispatched',
  'degraded-spawn-dispatched'
]);
const KNOWN_PERSISTED_STATUSES = new Set([
  'not-found',
  ...TERMINAL_PERSISTED_STATUSES,
  ...RECOVERABLE_PERSISTED_STATUSES
]);
const CHECKPOINT_PHASES = new Set(['uninitialized', 'authorization', 'remediation', 'health-retry', 'handoff', 'terminal']);
const CHECKPOINT_STATUS_PHASE = {
  'not-found': 'uninitialized',
  'pending-authorization': 'authorization',
  'pending-remediation': 'remediation',
  'pending-health-retry': 'health-retry',
  'blocked-health': 'health-retry',
  'spawn-dispatched': 'handoff',
  'degraded-spawn-dispatched': 'handoff',
  admitted: 'terminal',
  denied: 'terminal',
  cancelled: 'terminal'
};
const KNOWN_ACTOR_ROLES = new Set(['viewer', 'operator', 'admin', 'system']);
const ROLE_PERMISSIONS = {
  viewer: ['kernel.process.read'],
  operator: ['kernel.process.read', 'kernel.process.request', 'kernel.process.cancel'],
  admin: ['kernel.process.read', 'kernel.process.request', 'kernel.process.cancel', 'kernel.process.recover'],
  system: ['kernel.process.read', 'kernel.process.request', 'kernel.process.cancel', 'kernel.process.recover', 'kernel.process.impersonate']
};
const COMMAND_REQUIRED_PERMISSIONS = {
  'request-admission': ['kernel.process.request'],
  'recover-admission': ['kernel.process.recover'],
  'cancel-admission': ['kernel.process.cancel']
};
const DEPENDENCY_RECOVERY_ACTIONS = {
  'process-supervisor': {
    owner: 'kernel.lifecycle.supervisor',
    action: 'restart-process-supervisor',
    runbook: 'kernel.lifecycle.process-supervisor.restore'
  },
  'persistence-journal': {
    owner: 'kernel.persistence.journal',
    action: 'restore-persistence-journal',
    runbook: 'kernel.persistence.journal.recover'
  },
  'spawn-handoff': {
    owner: 'kernel.lifecycle.spawn',
    action: 'restore-spawn-handoff-channel',
    runbook: 'kernel.lifecycle.spawn.handoff.restore'
  }
};
const REPORT_HISTORY_LIMIT = 12;
const DEFAULT_HEALTH_MAX_AGE_MS = 60000;
const DEFAULT_DEPENDENCY_MAX_AGE_MS = 120000;
const DEFAULT_PROVIDER_SYNC_MAX_AGE_MS = 180000;
const DEFAULT_ADMISSION_HOLD_TTL_MS = 900000;

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textOrDefault(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
}

function normalizePermissionGrantEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((grant, index) => {
      if (typeof grant === 'string') {
        const permission = textOrDefault(grant, null);
        return permission
          ? {
            grantId: `explicit-permission-${index + 1}`,
            permission,
            tenantId: null,
            workspaceId: null,
            source: 'legacy-string-grant',
            scoped: false
          }
          : null;
      }

      if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
        return null;
      }

      const permissionGrant = asPlainObject(grant);
      const scope = asPlainObject(permissionGrant.scope);
      const permission = textOrDefault(
        permissionGrant.permission || permissionGrant.name || permissionGrant.value,
        null
      );

      return permission
        ? {
          grantId: textOrDefault(permissionGrant.grantId || permissionGrant.id, `explicit-permission-${index + 1}`),
          permission,
          tenantId: textOrDefault(permissionGrant.tenantId || scope.tenantId, null),
          workspaceId: textOrDefault(permissionGrant.workspaceId || scope.workspaceId, null),
          source: textOrDefault(permissionGrant.source || permissionGrant.issuer, 'explicit-scoped-grant'),
          scoped: Boolean(permissionGrant.tenantId || permissionGrant.workspaceId || scope.tenantId || scope.workspaceId)
        }
        : null;
    })
    .filter(Boolean);
}

function applyScopedPermissionGrants(grants, scope) {
  const active = [];
  const rejected = [];

  for (const grant of grants) {
    if (grant.source !== 'legacy-string-grant' && !grant.scoped) {
      rejected.push({
        ...grant,
        expectedTenantId: grant.tenantId,
        expectedWorkspaceId: grant.workspaceId,
        actualTenantId: scope.tenantId,
        actualWorkspaceId: scope.workspaceId,
        reason: 'structured-grant-scope-required'
      });
      continue;
    }

    const tenantMatches = !grant.tenantId || grant.tenantId === scope.tenantId;
    const workspaceMatches = !grant.workspaceId || grant.workspaceId === scope.workspaceId;

    if (tenantMatches && workspaceMatches) {
      active.push({
        ...grant,
        isolationKey: `${grant.tenantId || '*'}:${grant.workspaceId || '*'}`
      });
    } else {
      rejected.push({
        ...grant,
        expectedTenantId: grant.tenantId,
        expectedWorkspaceId: grant.workspaceId,
        actualTenantId: scope.tenantId,
        actualWorkspaceId: scope.workspaceId,
        reason: !tenantMatches && !workspaceMatches
          ? 'tenant-and-workspace-scope-mismatch'
          : (!tenantMatches ? 'tenant-scope-mismatch' : 'workspace-scope-mismatch')
      });
    }
  }

  return { active, rejected };
}

function normalizeEvidence(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvidenceItems(value) {
  return normalizeEvidence(value)
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry, index) => {
      const evidence = asPlainObject(entry);
      const type = textOrDefault(evidence.type || evidence.evidenceType || evidence.kind, null);
      const evidenceId = textOrDefault(
        evidence.evidenceId || evidence.id || evidence.ref || evidence.proofId,
        type ? `evidence-${index + 1}:${type}` : `evidence-${index + 1}`
      );

      return {
        evidenceId,
        type,
        source: textOrDefault(evidence.source || evidence.owner || evidence.producer, 'client.evidence'),
        observedAt: textOrDefault(evidence.observedAt || evidence.generatedAt || evidence.at, null),
        proofRef: textOrDefault(evidence.proofRef || evidence.proofId || evidence.ref, evidenceId)
      };
    });
}

function buildObjectiveEvidenceSatisfaction(requiredEvidenceTypes, evidenceItems) {
  const satisfiedTypes = [];
  const missingTypes = [];
  const refsByType = {};

  for (const type of requiredEvidenceTypes) {
    const matches = evidenceItems.filter((entry) => entry.type === type);
    refsByType[type] = matches.map((entry) => entry.proofRef);

    if (matches.length > 0) {
      satisfiedTypes.push(type);
    } else {
      missingTypes.push(type);
    }
  }

  return {
    schemaVersion: 1,
    requiredCount: requiredEvidenceTypes.length,
    satisfiedCount: satisfiedTypes.length,
    missingCount: missingTypes.length,
    satisfied: missingTypes.length === 0,
    satisfiedTypes,
    missingTypes,
    refsByType
  };
}

function normalizeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function timestampToEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const epochMs = Date.parse(value);
  return Number.isFinite(epochMs) ? epochMs : null;
}

function normalizeFreshness({ observedAt, now, maxAgeMs, missingState = 'not-reported' }) {
  const observedEpochMs = timestampToEpochMs(observedAt);
  const nowEpochMs = timestampToEpochMs(now);
  const ageMs = observedEpochMs !== null && nowEpochMs !== null
    ? Math.max(0, nowEpochMs - observedEpochMs)
    : null;

  return {
    observedAt: textOrDefault(observedAt, null),
    maxAgeMs,
    ageMs,
    state: observedEpochMs === null
      ? missingState
      : (ageMs > maxAgeMs ? 'stale' : 'fresh'),
    stale: observedEpochMs !== null && ageMs > maxAgeMs
  };
}

function normalizeDependencyHealth(value, now, defaultMaxAgeMs) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((dependency) => dependency && typeof dependency === 'object' && !Array.isArray(dependency))
    .map((dependency) => {
      const name = textOrDefault(dependency.name || dependency.dependencyName, 'unknown-dependency');
      const state = textOrDefault(dependency.state || dependency.status, 'unknown');
      const observedAt = textOrDefault(
        dependency.observedAt || dependency.checkedAt || dependency.lastCheckedAt || dependency.lastOkAt || dependency.readyAt,
        null
      );
      const maxAgeMs = normalizeInteger(dependency.maxAgeMs ?? dependency.freshnessMaxAgeMs, defaultMaxAgeMs);

      return {
        name,
        state,
        critical: dependency.critical === true || CRITICAL_DEPENDENCIES.has(name),
        lastOkAt: textOrDefault(dependency.lastOkAt || dependency.readyAt, null),
        message: textOrDefault(dependency.message || dependency.reason, null),
        freshness: normalizeFreshness({
          observedAt,
          now,
          maxAgeMs,
          missingState: 'not-reported'
        })
      };
    });
}

function defaultDependencyRecoveryAction(dependency) {
  return {
    owner: dependency.critical ? 'kernel.runtime.health' : 'kernel.runtime.observability',
    action: dependency.critical ? 'restore-critical-runtime-dependency' : 'restore-runtime-dependency',
    runbook: dependency.critical ? 'kernel.runtime.critical-dependency.restore' : 'kernel.runtime.dependency.restore'
  };
}

function buildOperationalFailureState({ health, failedDependencies, degradedDependencies, hardBlocked, admitInDegradedMode, retryable }) {
  const affectedDependencies = [...failedDependencies, ...degradedDependencies];
  const incidents = affectedDependencies.map((dependency) => {
    const recovery = DEPENDENCY_RECOVERY_ACTIONS[dependency.name] || defaultDependencyRecoveryAction(dependency);
    const severity = dependency.critical && dependency.state !== 'degraded'
      ? 'critical'
      : (dependency.state === 'degraded' ? 'warning' : 'error');

    return {
      incidentId: `${dependency.name}:${dependency.state}`,
      dependency: dependency.name,
      state: dependency.state,
      critical: dependency.critical,
      severity,
      owner: recovery.owner,
      action: recovery.action,
      runbook: recovery.runbook,
      message: dependency.message || `${dependency.name} reported ${dependency.state}`,
      lastOkAt: dependency.lastOkAt,
      retryable,
      retryAfterMs: retryable ? health.retry.nextDelayMs : null
    };
  });
  const firstCritical = incidents.find((incident) => incident.severity === 'critical');
  const firstError = incidents.find((incident) => incident.severity === 'error');
  const primaryIncident = firstCritical || firstError || incidents[0] || null;
  const state = hardBlocked
    ? 'blocked'
    : (admitInDegradedMode ? 'degraded-admissible' : (incidents.length > 0 || health.state !== 'healthy' ? 'degraded-hold' : 'ready'));

  return {
    schemaVersion: 1,
    state,
    reason: health.reason || primaryIncident?.message || null,
    incidentCount: incidents.length,
    criticalIncidentCount: incidents.filter((incident) => incident.severity === 'critical').length,
    retryable,
    retryAttempt: health.retry.attempt,
    maxRetryAttempts: health.retry.maxAttempts,
    retryBudgetRemaining: Math.max(0, health.retry.maxAttempts - health.retry.attempt),
    backoff: {
      strategy: health.retry.strategy,
      nextDelayMs: retryable ? health.retry.nextDelayMs : null,
      exhausted: health.retry.exhausted
    },
    degradedMode: {
      allowed: health.degradedModeAllowed,
      active: admitInDegradedMode,
      eligible: !hardBlocked && affectedDependencies.length > 0
    },
    primaryAction: primaryIncident?.action || (retryable ? 'retry-process-admission-readiness' : 'observe-runtime-health'),
    primaryOwner: primaryIncident?.owner || 'kernel.lifecycle.process-admission',
    incidents
  };
}

function normalizeStoredEvents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((event) => event && typeof event === 'object' && !Array.isArray(event))
    .map((event) => ({
      eventId: textOrDefault(event.eventId, null),
      type: textOrDefault(event.type, 'admission.event'),
      at: textOrDefault(event.at, null),
      sequence: normalizeInteger(event.sequence, 0),
      requestId: textOrDefault(event.requestId, null),
      status: textOrDefault(event.status, null),
      commandId: textOrDefault(event.commandId, null),
      idempotencyKey: textOrDefault(event.idempotencyKey, null)
    }));
}

function normalizeCommandReceipts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((receipt) => receipt && typeof receipt === 'object' && !Array.isArray(receipt))
    .map((receipt) => ({
      commandId: textOrDefault(receipt.commandId, null),
      idempotencyKey: textOrDefault(receipt.idempotencyKey, null),
      commandName: textOrDefault(receipt.commandName || receipt.name, null),
      requestId: textOrDefault(receipt.requestId, null),
      status: textOrDefault(receipt.status, null),
      appliedAt: textOrDefault(receipt.appliedAt || receipt.at, null),
      eventId: textOrDefault(receipt.eventId, null),
      writeRevision: normalizeInteger(receipt.writeRevision ?? receipt.revision, 0)
    }));
}

function normalizePersistenceLease(value) {
  const lease = asPlainObject(value);

  return {
    leaseId: textOrDefault(lease.leaseId || lease.id, null),
    holder: textOrDefault(lease.holder || lease.owner, null),
    acquiredAt: textOrDefault(lease.acquiredAt || lease.startedAt, null),
    expiresAt: textOrDefault(lease.expiresAt, null),
    fencingToken: textOrDefault(lease.fencingToken || lease.token, null)
  };
}

function derivePersistenceLeaseStatus(lease, now) {
  const nowEpochMs = timestampToEpochMs(now);
  const expiresEpochMs = timestampToEpochMs(lease.expiresAt);
  const acquiredEpochMs = timestampToEpochMs(lease.acquiredAt);
  const hasLease = Boolean(lease.leaseId || lease.holder || lease.fencingToken);
  const expired = hasLease && expiresEpochMs !== null && nowEpochMs !== null && nowEpochMs > expiresEpochMs;
  const expiresInMs = hasLease && expiresEpochMs !== null && nowEpochMs !== null
    ? expiresEpochMs - nowEpochMs
    : null;
  const heldForMs = hasLease && acquiredEpochMs !== null && nowEpochMs !== null
    ? Math.max(0, nowEpochMs - acquiredEpochMs)
    : null;

  return {
    state: !hasLease ? 'missing' : (expired ? 'expired' : 'active'),
    present: hasLease,
    expired,
    expiresInMs,
    heldForMs,
    restartAction: !hasLease
      ? 'acquire-persistence-lease'
      : (expired ? 'steal-expired-persistence-lease' : 'validate-persistence-lease-fence')
  };
}

function derivePersistedAdmissionExpiration({ status, current, checkpoint, persisted, now }) {
  const nowEpochMs = timestampToEpochMs(now);
  const updatedEpochMs = timestampToEpochMs(current.updatedAt || persisted.updatedAt || checkpoint.persistedAt);
  const explicitDeadline = firstText(
    current.expiresAt,
    checkpoint.expiresAt,
    persisted.expiresAt,
    persisted.holdExpiresAt,
    persisted.admissionExpiresAt
  );
  const explicitDeadlineEpochMs = timestampToEpochMs(explicitDeadline);
  const ttlMs = normalizeInteger(
    current.ttlMs ?? persisted.ttlMs ?? persisted.holdTtlMs ?? persisted.admissionHoldTtlMs,
    DEFAULT_ADMISSION_HOLD_TTL_MS
  );
  const derivedDeadlineEpochMs = explicitDeadlineEpochMs === null && updatedEpochMs !== null
    ? updatedEpochMs + ttlMs
    : null;
  const deadlineEpochMs = explicitDeadlineEpochMs ?? derivedDeadlineEpochMs;
  const deadlineAt = explicitDeadline || (
    derivedDeadlineEpochMs === null ? null : new Date(derivedDeadlineEpochMs).toISOString()
  );
  const terminal = TERMINAL_PERSISTED_STATUSES.has(status);
  const recoverable = RECOVERABLE_PERSISTED_STATUSES.has(status);
  const expired = !terminal
    && recoverable
    && deadlineEpochMs !== null
    && nowEpochMs !== null
    && nowEpochMs > deadlineEpochMs;
  const expiresInMs = !terminal && deadlineEpochMs !== null && nowEpochMs !== null
    ? deadlineEpochMs - nowEpochMs
    : null;
  const ageMs = updatedEpochMs !== null && nowEpochMs !== null
    ? Math.max(0, nowEpochMs - updatedEpochMs)
    : null;

  return {
    schemaVersion: 1,
    state: terminal
      ? 'terminal'
      : (expired ? 'expired' : (deadlineEpochMs === null ? 'unbounded' : 'active')),
    expired,
    terminal,
    recoverable,
    status,
    deadlineAt,
    expiresInMs,
    ageMs,
    ttlMs,
    source: explicitDeadline ? 'explicit-deadline' : (derivedDeadlineEpochMs === null ? 'not-reported' : 'derived-ttl'),
    recoveryAction: expired
      ? 'recover-expired-admission-hold'
      : (recoverable ? 'observe-admission-hold-deadline' : 'observe-terminal-admission-state')
  };
}

function classifyPersistedAdmissionStatus(status) {
  const known = KNOWN_PERSISTED_STATUSES.has(status);
  const terminal = TERMINAL_PERSISTED_STATUSES.has(status);
  const recoverable = RECOVERABLE_PERSISTED_STATUSES.has(status);

  return {
    schemaVersion: 1,
    status,
    known,
    category: status === 'not-found'
      ? 'empty'
      : (terminal ? 'terminal' : (recoverable ? 'recoverable' : 'unknown')),
    terminal,
    recoverable,
    restartSafe: status === 'not-found' || known,
    canReplay: terminal || recoverable,
    blocksAdmissionWrite: !known,
    recoveryAction: known
      ? (terminal ? 'return-persisted-outcome' : (recoverable ? 'resume-or-advance-admission' : 'initialize-admission-envelope'))
      : 'quarantine-unknown-persisted-admission-status'
  };
}

function latestEventSequence(events) {
  return events.reduce((max, event) => Math.max(max, normalizeInteger(event.sequence, 0)), 0);
}

function normalizeCheckpoint(value) {
  const checkpoint = asPlainObject(value);
  const phase = textOrDefault(checkpoint.phase, 'uninitialized');

  return {
    schemaVersion: normalizeInteger(checkpoint.schemaVersion, 1),
    phase: CHECKPOINT_PHASES.has(phase) ? phase : 'uninitialized',
    status: textOrDefault(checkpoint.status, null),
    requestId: textOrDefault(checkpoint.requestId, null),
    commandId: textOrDefault(checkpoint.commandId, null),
    persistedAt: textOrDefault(checkpoint.persistedAt || checkpoint.updatedAt, null),
    nextCommandName: textOrDefault(checkpoint.nextCommandName, null),
    recoveryToken: textOrDefault(checkpoint.recoveryToken, null),
    resumeAfterMs: Number.isInteger(checkpoint.resumeAfterMs) ? checkpoint.resumeAfterMs : null,
    expiresAt: textOrDefault(checkpoint.expiresAt, null),
    handoffRef: textOrDefault(checkpoint.handoffRef || checkpoint.externalHandoffRef, null)
  };
}

function deriveCheckpointPhase(status, admission) {
  if (CHECKPOINT_STATUS_PHASE[status]) {
    return CHECKPOINT_STATUS_PHASE[status];
  }

  if (admission.decision.admitted) {
    return 'handoff';
  }

  if (admission.runtime.health?.retryable || admission.runtime.health?.blocked) {
    return 'health-retry';
  }

  if (admission.client.state === 'anonymous') {
    return 'authorization';
  }

  return 'remediation';
}

function deriveNextCheckpointCommand({ phase, recoveryPlan, commandName, retryAfterMs }) {
  if (phase === 'terminal') {
    return null;
  }

  if (commandName === 'cancel-admission') {
    return null;
  }

  if (phase === 'health-retry' || recoveryPlan.canResume || retryAfterMs !== null) {
    return 'recover-admission';
  }

  return 'request-admission';
}

function buildRestartCommandContracts({ command, recoveryToken, nextCommandName, commandCancelsAdmission, cancellable }) {
  return {
    resume: nextCommandName
      ? {
        commandName: nextCommandName,
        commandIdHint: `${command.commandId}:restart:${nextCommandName}`,
        idempotencyKey: `${recoveryToken}:${nextCommandName}`,
        safeToRetry: true
      }
      : null,
    cancel: cancellable && !commandCancelsAdmission
      ? {
        commandName: 'cancel-admission',
        commandIdHint: `${command.commandId}:restart:cancel`,
        idempotencyKey: `${recoveryToken}:cancel`,
        safeToRetry: true
      }
      : null
  };
}

function normalizeCounterMap(value) {
  const counters = asPlainObject(value);
  const normalized = {};

  for (const [key, count] of Object.entries(counters)) {
    if (typeof key === 'string' && key.trim() && Number.isInteger(count) && count >= 0) {
      normalized[key.trim()] = count;
    }
  }

  return normalized;
}

function incrementCounter(counters, key, amount = 1) {
  counters[key] = (counters[key] || 0) + amount;
}

function classifyActionableErrorSource(error) {
  if (error.code?.includes('persisted') || error.code?.includes('checkpoint') || error.code?.includes('lease')) {
    return 'persistence-recovery';
  }

  if (error.dependency || error.runbook || error.code?.includes('health') || error.code?.includes('dependency')) {
    return 'runtime-health';
  }

  if (error.policyId || error.code?.includes('policy') || error.code?.includes('concurrency') || error.code?.includes('queue_limit')) {
    return 'admission-policy';
  }

  if (error.code?.includes('lifecycle') || error.code?.includes('maintenance') || error.code?.includes('manual_release')) {
    return 'lifecycle-controls';
  }

  if (error.code?.includes('scope') || error.code?.includes('tenant') || error.code?.includes('workspace')) {
    return 'scope-boundary';
  }

  if (error.code?.includes('permission')) {
    return 'actor-authorization';
  }

  if (error.code?.includes('provider')) {
    return 'provider-contract';
  }

  if (error.code?.includes('capability')) {
    return 'client-contract';
  }

  return 'process-admission';
}

function deriveActionableErrorSeverity({ error, source, operationalHealth }) {
  if (error.code?.includes('critical') || source === 'scope-boundary' || source === 'actor-authorization') {
    return 'critical';
  }

  if (source === 'runtime-health' && operationalHealth.blocked && !operationalHealth.retryable) {
    return 'critical';
  }

  if (source === 'runtime-health' && operationalHealth.degradedMode) {
    return 'warning';
  }

  if (error.retryable) {
    return 'warning';
  }

  return 'error';
}

function buildViolationActionableError(violation, operationalHealth) {
  const retryableCodes = new Set([
    'retry_budget_exhausted',
    'tenant_concurrency_limit_reached',
    'admission_queue_limit_reached',
    'process_admission_in_maintenance',
    'process_admission_requires_manual_release',
    'explicit_tenant_scope_required',
    'explicit_workspace_scope_required'
  ]);

  return {
    code: violation.code,
    message: violation.message || 'Resolve the blocked process-admission validation before hosted-kernel handoff.',
    field: violation.field,
    policyId: violation.policyId,
    dependency: violation.dependency,
    retryable: retryableCodes.has(violation.code) && operationalHealth.retryable,
    retryAfterMs: retryableCodes.has(violation.code) ? operationalHealth.retryAfterMs : null
  };
}

function buildActionableErrorTriage({
  actionableErrors,
  violations,
  operationalHealth,
  lifecycleControls,
  scopeBoundary,
  providerNegotiation,
  permissionDecision,
  persistence,
  command,
  requestId,
  scope,
  now
}) {
  const violationErrors = violations.map((violation) => buildViolationActionableError(violation, operationalHealth));
  const merged = [...actionableErrors, ...violationErrors];
  const seen = new Set();
  const items = [];

  for (const error of merged) {
    const source = classifyActionableErrorSource(error);
    const key = [
      source,
      error.code,
      error.dependency || error.field || error.policyId || 'process-admission'
    ].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const retryAfterMs = Number.isInteger(error.retryAfterMs) ? error.retryAfterMs : null;
    const severity = deriveActionableErrorSeverity({ error, source, operationalHealth });
    const owner = textOrDefault(
      error.owner,
      source === 'runtime-health'
        ? operationalHealth.failure.primaryOwner
        : (source === 'lifecycle-controls'
          ? lifecycleControls.audit.owner
          : (source === 'scope-boundary'
            ? 'kernel.security.scope-boundary'
            : (source === 'provider-contract'
              ? 'kernel.provider.router'
              : (source === 'actor-authorization'
                ? 'security.route'
                : (source === 'persistence-recovery' ? 'kernel.persistence.recovery' : 'client.workflow.process-admission')))))
    );
    const action = textOrDefault(
      error.action,
      source === 'runtime-health'
        ? operationalHealth.failure.primaryAction
        : (source === 'lifecycle-controls'
          ? lifecycleControls.nextAction
          : (source === 'scope-boundary'
            ? 'repair-tenant-workspace-scope-boundary'
            : (source === 'provider-contract'
              ? 'select-compatible-hosted-kernel-provider'
              : (source === 'actor-authorization'
                ? 'grant-actor-permissions'
                : (source === 'persistence-recovery' ? 'recover-or-cancel-expired-admission' : 'collect-required-remediation')))))
    );

    items.push({
      schemaVersion: 1,
      errorId: `${command.commandId}:${items.length + 1}:${error.code}`,
      code: error.code,
      source,
      severity,
      message: textOrDefault(error.message, 'Process admission is blocked until this condition is resolved.'),
      owner,
      action,
      field: textOrDefault(error.field, null),
      dependency: textOrDefault(error.dependency, null),
      policyId: textOrDefault(error.policyId, null),
      runbook: textOrDefault(error.runbook, null),
      retryable: error.retryable === true,
      retryAfterMs,
      blocksHandoff: severity !== 'warning' || !operationalHealth.degradedMode,
      degradedModeEligible: source === 'runtime-health' && operationalHealth.degradedMode,
      proofRef: `${persistence.key}#${error.code}`
    });
  }

  const retryableItems = items.filter((item) => item.retryable);
  const blockingItems = items.filter((item) => item.blocksHandoff);
  const retryDelays = retryableItems
    .map((item) => item.retryAfterMs)
    .filter((delay) => Number.isInteger(delay));
  const groupedCounts = items.reduce((groups, item) => {
    groups[item.source] = (groups[item.source] || 0) + 1;
    return groups;
  }, {});
  const primary = blockingItems.find((item) => item.severity === 'critical')
    || blockingItems[0]
    || retryableItems[0]
    || items[0]
    || null;

  return {
    schemaVersion: 1,
    generatedAt: now,
    requestId,
    commandId: command.commandId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    totalCount: items.length,
    blockingCount: blockingItems.length,
    retryableCount: retryableItems.length,
    groupedCounts,
    primary,
    nextRetry: retryableItems.length > 0
      ? {
        commandName: 'recover-admission',
        idempotencyKey: persistence.current.recoveryToken,
        retryAfterMs: retryDelays.length > 0 ? Math.min(...retryDelays) : operationalHealth.retryAfterMs,
        backoffStrategy: operationalHealth.retryable ? 'exponential-backoff' : null,
        retryBudgetRemaining: operationalHealth.failure.retryBudgetRemaining
      }
      : null,
    degradedMode: {
      active: operationalHealth.degradedMode,
      allowedByHealth: operationalHealth.failure.degradedMode.allowed,
      blockedByPolicy: groupedCounts['admission-policy'] > 0 && !operationalHealth.degradedMode,
      blockedByScope: !scopeBoundary.allowed,
      missingProviderCapabilities: providerNegotiation.missingProviderCapabilities
    },
    authorization: {
      allowed: permissionDecision.allowed,
      missingPermissions: permissionDecision.missing
    },
    items
  };
}

function normalizeHistorySnapshots(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((snapshot) => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    .map((snapshot) => ({
      snapshotId: textOrDefault(snapshot.snapshotId, null),
      at: textOrDefault(snapshot.at || snapshot.generatedAt, null),
      requestId: textOrDefault(snapshot.requestId, null),
      commandId: textOrDefault(snapshot.commandId, null),
      tenantId: textOrDefault(snapshot.tenantId, null),
      workspaceId: textOrDefault(snapshot.workspaceId, null),
      status: textOrDefault(snapshot.status, null),
      persistedStatus: textOrDefault(snapshot.persistedStatus, null),
      recoveryMode: textOrDefault(snapshot.recoveryMode, null),
      persistenceWriteOperation: textOrDefault(snapshot.persistenceWriteOperation, null),
      persistenceWriteRevision: normalizeInteger(snapshot.persistenceWriteRevision, 0),
      journalSequence: normalizeInteger(snapshot.journalSequence, 0),
      persistedStatusKnown: snapshot.persistedStatusKnown !== false,
      persistedStatusCategory: textOrDefault(snapshot.persistedStatusCategory, null),
      persistedStatusRecoveryAction: textOrDefault(snapshot.persistedStatusRecoveryAction, null),
      checkpointPhase: textOrDefault(snapshot.checkpointPhase, null),
      checkpointNextCommand: textOrDefault(snapshot.checkpointNextCommand, null),
      mailchimpHandoffState: textOrDefault(snapshot.mailchimpHandoffState, null),
      mailchimpHandoffReady: snapshot.mailchimpHandoffReady === true,
      mailchimpHandoffAccepted: snapshot.mailchimpHandoffAccepted === true,
      mailchimpHandoffExportReady: snapshot.mailchimpHandoffExportReady === true,
      mailchimpBoundaryProofId: textOrDefault(snapshot.mailchimpBoundaryProofId, null),
      mailchimpBlockedBy: normalizeList(snapshot.mailchimpBlockedBy),
      operationalHealthState: textOrDefault(snapshot.operationalHealthState, null),
      operationalFailureState: textOrDefault(snapshot.operationalFailureState, null),
      handoffTarget: textOrDefault(snapshot.handoffTarget, null),
      externalHandoffState: textOrDefault(snapshot.externalHandoffState, null),
      previewStatus: textOrDefault(snapshot.previewStatus, null),
      previewAcceptanceReadyState: textOrDefault(snapshot.previewAcceptanceReadyState, null),
      previewAcceptancePrimaryAction: textOrDefault(snapshot.previewAcceptancePrimaryAction, null),
      previewAcceptanceRouteTarget: textOrDefault(snapshot.previewAcceptanceRouteTarget, null),
      readinessReady: snapshot.readinessReady === true,
      clientRuntimeAdoptionState: textOrDefault(snapshot.clientRuntimeAdoptionState, null),
      clientRuntimeAdoptionNextAction: textOrDefault(snapshot.clientRuntimeAdoptionNextAction, null),
      clientWorkflowState: textOrDefault(snapshot.clientWorkflowState, null),
      clientWorkflowLane: textOrDefault(snapshot.clientWorkflowLane, null),
      nextRequiredAction: textOrDefault(snapshot.nextRequiredAction, null),
      lifecycleControlState: textOrDefault(snapshot.lifecycleControlState, null),
      lifecycleSchedulingMode: textOrDefault(snapshot.lifecycleSchedulingMode, null),
      lifecycleControlNextAction: textOrDefault(snapshot.lifecycleControlNextAction, null),
      scopeBoundaryMode: textOrDefault(snapshot.scopeBoundaryMode, null),
      scopeBoundaryAllowed: snapshot.scopeBoundaryAllowed === true,
      scopeBoundaryViolationCount: normalizeInteger(snapshot.scopeBoundaryViolationCount, 0),
      scopeBoundaryProofId: textOrDefault(snapshot.scopeBoundaryProofId, null),
      scopeTenantSource: textOrDefault(snapshot.scopeTenantSource, null),
      scopeWorkspaceSource: textOrDefault(snapshot.scopeWorkspaceSource, null),
      scopeDefaulted: snapshot.scopeDefaulted === true,
      actorEffectiveRole: textOrDefault(snapshot.actorEffectiveRole, null),
      actorRoleKnown: snapshot.actorRoleKnown === true,
      actorActivePermissionGrantCount: normalizeInteger(snapshot.actorActivePermissionGrantCount, 0),
      actorRejectedPermissionGrantCount: normalizeInteger(snapshot.actorRejectedPermissionGrantCount, 0),
      actorRejectedRequiredGrantCount: normalizeInteger(snapshot.actorRejectedRequiredGrantCount, 0),
      objectiveOrigin: textOrDefault(snapshot.objectiveOrigin, null),
      objectivePresent: snapshot.objectivePresent === true,
      requiredEvidenceSatisfied: snapshot.requiredEvidenceSatisfied === true,
      missingRequiredEvidenceCount: normalizeInteger(snapshot.missingRequiredEvidenceCount, 0),
      ownerBindingAuthorized: snapshot.ownerBindingAuthorized === true,
      intakeEvidenceProofId: textOrDefault(snapshot.intakeEvidenceProofId, null),
      admitted: snapshot.admitted === true,
      retryAfterMs: Number.isInteger(snapshot.retryAfterMs) ? snapshot.retryAfterMs : null,
      violationCount: normalizeInteger(snapshot.violationCount, 0),
      actionableErrorCount: normalizeInteger(snapshot.actionableErrorCount, 0),
      actionableErrorTriageCount: normalizeInteger(snapshot.actionableErrorTriageCount, 0),
      actionableErrorBlockingCount: normalizeInteger(snapshot.actionableErrorBlockingCount, 0),
      actionableErrorRetryableCount: normalizeInteger(snapshot.actionableErrorRetryableCount, 0),
      actionableErrorPrimarySource: textOrDefault(snapshot.actionableErrorPrimarySource, null),
      actionableErrorPrimaryAction: textOrDefault(snapshot.actionableErrorPrimaryAction, null),
      exitContractState: textOrDefault(snapshot.exitContractState, null),
      exitContractOwner: textOrDefault(snapshot.exitContractOwner, null),
      exitContractNextAction: textOrDefault(snapshot.exitContractNextAction, null),
      exitContractTerminal: snapshot.exitContractTerminal === true,
      exitContractFailed: snapshot.exitContractFailed === true,
      exitContractProofId: textOrDefault(snapshot.exitContractProofId, null)
    }))
    .slice(-REPORT_HISTORY_LIMIT);
}

function normalizeReportingState(input) {
  const analytics = asPlainObject(input.analytics);
  const reporting = asPlainObject(input.reporting || analytics.reporting);
  const exportState = asPlainObject(input.export || reporting.export);

  return {
    counters: normalizeCounterMap(analytics.counters || reporting.counters || input.analyticsCounters),
    history: normalizeHistorySnapshots(analytics.history || reporting.history || input.historySnapshots),
    exportedAt: textOrDefault(exportState.exportedAt || reporting.exportedAt, null),
    lastReportId: textOrDefault(reporting.lastReportId || analytics.lastReportId, null)
  };
}

function incrementGroupCount(groups, value, fallback = 'unknown') {
  const key = textOrDefault(value, fallback);
  groups[key] = (groups[key] || 0) + 1;
}

function buildReportHistorySummary(history) {
  const summary = {
    schemaVersion: 1,
    retainedLimit: REPORT_HISTORY_LIMIT,
    retainedCount: history.length,
    firstSnapshotAt: history[0]?.at || null,
    lastSnapshotAt: history[history.length - 1]?.at || null,
    decisionCounts: {},
    persistedStatusCounts: {},
    persistedStatusCategoryCounts: {},
    unknownPersistedStatusCount: 0,
    recoveryModeCounts: {},
    checkpointPhaseCounts: {},
    mailchimpHandoffStateCounts: {},
    mailchimpReadyCount: 0,
    mailchimpAcceptedCount: 0,
    mailchimpExportReadyCount: 0,
    mailchimpBlockedCount: 0,
    mailchimpBlockedReasonCounts: {},
    operationalHealthCounts: {},
    handoffStateCounts: {},
    previewAcceptanceCounts: {},
    clientRuntimeAdoptionCounts: {},
    workflowLaneCounts: {},
    nextRequiredActionCounts: {},
    exitContractStateCounts: {},
    admittedCount: 0,
    heldCount: 0,
    retryScheduledCount: 0,
    blockedErrorCount: 0,
    retryableErrorCount: 0,
    scopeBoundaryBlockedCount: 0,
    terminalExitContractCount: 0,
    failedExitContractCount: 0,
    latestWriteRevision: 0,
    latestJournalSequence: 0
  };

  for (const entry of history) {
    incrementGroupCount(summary.decisionCounts, entry.status);
    incrementGroupCount(summary.persistedStatusCounts, entry.persistedStatus);
    incrementGroupCount(summary.persistedStatusCategoryCounts, entry.persistedStatusCategory);
    incrementGroupCount(summary.recoveryModeCounts, entry.recoveryMode);
    incrementGroupCount(summary.checkpointPhaseCounts, entry.checkpointPhase);
    incrementGroupCount(summary.mailchimpHandoffStateCounts, entry.mailchimpHandoffState);
    incrementGroupCount(summary.operationalHealthCounts, entry.operationalHealthState);
    incrementGroupCount(summary.handoffStateCounts, entry.externalHandoffState || entry.handoffTarget);
    incrementGroupCount(summary.previewAcceptanceCounts, entry.previewAcceptanceReadyState);
    incrementGroupCount(summary.clientRuntimeAdoptionCounts, entry.clientRuntimeAdoptionState);
    incrementGroupCount(summary.workflowLaneCounts, entry.clientWorkflowLane);
    incrementGroupCount(summary.nextRequiredActionCounts, entry.nextRequiredAction);
    incrementGroupCount(summary.exitContractStateCounts, entry.exitContractState);

    if (entry.admitted) {
      summary.admittedCount += 1;
    } else {
      summary.heldCount += 1;
    }

    if (!entry.persistedStatusKnown) {
      summary.unknownPersistedStatusCount += 1;
    }

    if (entry.mailchimpHandoffReady) {
      summary.mailchimpReadyCount += 1;
    }

    if (entry.mailchimpHandoffAccepted) {
      summary.mailchimpAcceptedCount += 1;
    }

    if (entry.mailchimpHandoffExportReady) {
      summary.mailchimpExportReadyCount += 1;
    }

    if (entry.mailchimpHandoffState && entry.mailchimpHandoffState !== 'ready') {
      summary.mailchimpBlockedCount += 1;
    }

    for (const reason of entry.mailchimpBlockedBy) {
      incrementGroupCount(summary.mailchimpBlockedReasonCounts, reason);
    }

    if (Number.isInteger(entry.retryAfterMs)) {
      summary.retryScheduledCount += 1;
    }

    if (entry.actionableErrorBlockingCount > 0) {
      summary.blockedErrorCount += entry.actionableErrorBlockingCount;
    }

    if (entry.actionableErrorRetryableCount > 0) {
      summary.retryableErrorCount += entry.actionableErrorRetryableCount;
    }

    if (entry.scopeBoundaryAllowed === false) {
      summary.scopeBoundaryBlockedCount += 1;
    }

    if (entry.exitContractTerminal) {
      summary.terminalExitContractCount += 1;
    }

    if (entry.exitContractFailed) {
      summary.failedExitContractCount += 1;
    }

    summary.latestWriteRevision = Math.max(summary.latestWriteRevision, entry.persistenceWriteRevision);
    summary.latestJournalSequence = Math.max(summary.latestJournalSequence, entry.journalSequence);
  }

  return summary;
}

function buildExportProof({ reportId, exportRecord, historySummary, timeline }) {
  const basis = [
    reportId,
    exportRecord.requestId,
    exportRecord.commandId,
    exportRecord.persistedStatus,
    exportRecord.checkpointPhase,
    historySummary.retainedCount,
    historySummary.latestWriteRevision,
    historySummary.latestJournalSequence,
    timeline.length
  ].join('|');
  let hash = 0;

  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash * 31) + basis.charCodeAt(index)) >>> 0;
  }

  return {
    schemaVersion: 1,
    proofType: 'process-admission-report-export',
    proofId: `${surfaceId}:export:${hash.toString(16).padStart(8, '0')}`,
    basis,
    historyRetainedCount: historySummary.retainedCount,
    timelineEventCount: timeline.length,
    latestWriteRevision: historySummary.latestWriteRevision,
    latestJournalSequence: historySummary.latestJournalSequence
  };
}

function buildMailchimpAdmissionExport({
  reportId,
  requestId,
  command,
  scope,
  persistence,
  historySummary,
  timeline,
  now
}) {
  const handoff = persistence.productHandoff?.product === 'mailchimp'
    ? persistence.productHandoff
    : null;
  const ready = handoff?.ready === true
    && handoff?.acceptance?.exportReady === true
    && persistence.writePlan.operation !== 'reject-write';
  const blockedBy = [
    ...(handoff ? handoff.blockedBy : ['mailchimp-product-handoff-not-present']),
    ...(persistence.writePlan.operation === 'reject-write' ? ['admission-persistence-write-rejected'] : []),
    ...(persistence.checkpoint.restartSafe ? [] : ['admission-checkpoint-not-restart-safe'])
  ];
  const normalizedBlockedBy = [...new Set(blockedBy)].sort();
  const row = handoff
    ? {
      schemaVersion: 1,
      rowType: 'mailchimp-process-admission-handoff',
      reportId,
      requestId,
      commandId: command.commandId,
      idempotencyKey: handoff.idempotencyKey,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey,
      providerId: handoff.providerId,
      serviceContractId: handoff.serviceContractId,
      handoffId: handoff.handoffId,
      externalRef: handoff.externalRef,
      audienceId: handoff.audienceId,
      campaignId: handoff.campaignId,
      webhookId: handoff.webhookId,
      webhookEndpoint: handoff.webhookEndpoint,
      webhookSigningKeyRef: handoff.webhookSigningKeyRef,
      suppressUnsubscribedContacts: handoff.suppressUnsubscribedContacts !== false,
      state: handoff.state,
      ready: handoff.ready,
      accepted: handoff.acceptance?.accepted === true,
      exportReady: ready,
      boundaryProofId: handoff.boundary?.proofId || null,
      routePartition: handoff.routePartition,
      routePartitionAccepted: handoff.boundary?.routePartitionAccepted === true,
      scopeCursor: handoff.sync?.scopeCursor || null,
      scopeCursorPresent: handoff.boundary?.scopeCursorPresent === true,
      syncGeneration: handoff.sync?.generation || 0,
      syncFreshnessState: handoff.sync?.freshnessState || 'unknown',
      syncFreshnessAgeMs: handoff.sync?.freshnessAgeMs ?? null,
      lastSyncedAt: handoff.sync?.lastSyncedAt || null,
      ackMode: handoff.acknowledgement?.mode || 'none',
      ackRequired: handoff.acknowledgement?.required === true,
      ackDeadlineMs: handoff.acknowledgement?.deadlineMs ?? null,
      restartCommandName: handoff.restart?.commandName || null,
      restartIdempotencyKey: handoff.restart?.idempotencyKey || null,
      blockedBy: normalizedBlockedBy
    }
    : null;
  const mailchimpTimeline = timeline
    .filter((event) => event.type.includes('mailchimp'))
    .map((event) => ({
      at: event.at,
      type: event.type,
      status: event.status,
      handoffId: event.handoffId || null,
      blockedBy: normalizeList(event.blockedBy)
    }));
  const batchId = `${reportId}:mailchimp:${stableAdmissionHash([
    handoff?.handoffId || 'missing-handoff',
    handoff?.sync?.generation || 0,
    persistence.current.writeRevision,
    normalizedBlockedBy.join(',')
  ].join('|'))}`;

  return {
    schemaVersion: 1,
    contract: 'process-admission.mailchimp-export-batch.v1',
    batchId,
    generatedAt: now,
    reportId,
    required: Boolean(handoff),
    ready,
    state: !handoff ? 'not-configured' : (ready ? 'ready' : 'blocked'),
    disposition: !handoff
      ? 'no-mailchimp-product-handoff'
      : (ready ? 'export-ready' : 'hold-for-mailchimp-contract-repair'),
    blockedBy: normalizedBlockedBy,
    rowCount: row ? 1 : 0,
    readyRowCount: ready && row ? 1 : 0,
    rows: row ? [row] : [],
    manifest: {
      format: 'process-admission-mailchimp-handoff.v1',
      destination: 'mailchimp-webhook-handoff',
      partitionKey: `${scope.tenantId}/${scope.workspaceId}/mailchimp`,
      watermark: `${persistence.current.writeRevision}:${persistence.current.journalSequence}:${handoff?.sync?.generation || 0}`,
      historyRetainedCount: historySummary.retainedCount,
      historyMailchimpReadyCount: historySummary.mailchimpReadyCount,
      historyMailchimpExportReadyCount: historySummary.mailchimpExportReadyCount,
      historyMailchimpBlockedCount: historySummary.mailchimpBlockedCount,
      historyMailchimpBlockedReasonCounts: historySummary.mailchimpBlockedReasonCounts,
      timelineEventCount: mailchimpTimeline.length,
      commandId: command.commandId,
      checkpointPhase: persistence.checkpoint.phase,
      restartSafe: persistence.checkpoint.restartSafe
    },
    timeline: mailchimpTimeline,
    proof: {
      proofType: 'process-admission-mailchimp-export-batch',
      proofId: `${surfaceId}:mailchimp-export:${stableAdmissionHash(batchId)}`,
      boundaryProofId: handoff?.boundary?.proofId || null,
      basis: batchId
    }
  };
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstScopedText(candidates, fallback, fallbackSource) {
  for (const candidate of candidates) {
    if (typeof candidate.value === 'string' && candidate.value.trim()) {
      return {
        value: candidate.value.trim(),
        source: candidate.source,
        explicit: true
      };
    }
  }

  return {
    value: fallback,
    source: fallbackSource,
    explicit: false
  };
}

function normalizeActor(input, scope) {
  const command = asPlainObject(input.command);
  const actor = asPlainObject(input.actor);
  const commandActor = asPlainObject(command.actor);
  const client = asPlainObject(input.client);
  const requestedRole = textOrDefault(actor.role || commandActor.role || input.actorRole, 'viewer');
  const roleKnown = KNOWN_ACTOR_ROLES.has(requestedRole);
  const role = roleKnown ? requestedRole : 'viewer';
  const inheritedPermissions = ROLE_PERMISSIONS[role] || [];
  const explicitPermissionGrants = normalizePermissionGrantEntries(
    actor.permissions || commandActor.permissions || input.actorPermissions
  );
  const scopedGrants = applyScopedPermissionGrants(explicitPermissionGrants, scope);
  const explicitPermissions = Array.from(new Set(scopedGrants.active.map((grant) => grant.permission)));
  const permissions = Array.from(new Set([...inheritedPermissions, ...explicitPermissions]));

  return {
    actorId: firstText(actor.actorId, commandActor.actorId, input.actorId, command.actor) || 'kernel.lifecycle.process-admission',
    role,
    requestedRole,
    effectiveRole: role,
    roleKnown,
    permissionSource: roleKnown ? 'role-and-explicit-grants' : 'viewer-fallback-and-explicit-grants',
    explicitPermissions,
    inheritedPermissionCount: inheritedPermissions.length,
    inheritedPermissions,
    explicitPermissionGrants,
    activePermissionGrants: scopedGrants.active,
    rejectedPermissionGrants: scopedGrants.rejected,
    rejectedPermissionCount: scopedGrants.rejected.length,
    permissions,
    sessionId: firstText(actor.sessionId, commandActor.sessionId, client.sessionId, input.sessionId),
    tenantId: firstText(actor.tenantId, commandActor.tenantId, input.actorTenantId),
    workspaceId: firstText(actor.workspaceId, commandActor.workspaceId, input.actorWorkspaceId)
  };
}

function normalizeScope(input) {
  const request = asPlainObject(input.request);
  const client = asPlainObject(input.client);
  const runtime = asPlainObject(input.runtime);
  const tenantInput = asPlainObject(input.tenant);
  const workspaceInput = asPlainObject(input.workspace);

  const tenant = firstScopedText([
    { value: request.tenantId, source: 'request.tenantId' },
    { value: tenantInput.tenantId, source: 'tenant.tenantId' },
    { value: client.tenantId, source: 'client.tenantId' },
    { value: runtime.tenantId, source: 'runtime.tenantId' },
    { value: input.tenantId, source: 'input.tenantId' }
  ], 'default-tenant', 'kernel.defaultTenant');
  const workspace = firstScopedText([
    { value: request.workspaceId, source: 'request.workspaceId' },
    { value: workspaceInput.workspaceId, source: 'workspace.workspaceId' },
    { value: client.workspaceId, source: 'client.workspaceId' },
    { value: runtime.workspaceId, source: 'runtime.workspaceId' },
    { value: input.workspaceId, source: 'input.workspaceId' }
  ], 'default-workspace', 'kernel.defaultWorkspace');

  return {
    tenantId: tenant.value,
    workspaceId: workspace.value,
    tenantSource: tenant.source,
    workspaceSource: workspace.source,
    tenantExplicit: tenant.explicit,
    workspaceExplicit: workspace.explicit,
    clientTenantId: firstText(client.tenantId, input.clientTenantId),
    clientWorkspaceId: firstText(client.workspaceId, input.clientWorkspaceId),
    runtimeTenantId: firstText(runtime.tenantId, input.runtimeTenantId),
    runtimeWorkspaceId: firstText(runtime.workspaceId, input.runtimeWorkspaceId),
    isolationKey: `${tenant.value}:${workspace.value}`,
    scopeSource: {
      tenant: tenant.source,
      workspace: workspace.source,
      defaulted: !tenant.explicit || !workspace.explicit
    }
  };
}

function buildPermissionDecision(commandName, actor) {
  const required = COMMAND_REQUIRED_PERMISSIONS[commandName] || [];
  const granted = new Set(actor.permissions);
  const missing = required.filter((permission) => !granted.has(permission));
  const rejectedRequiredGrants = actor.rejectedPermissionGrants.filter((grant) => required.includes(grant.permission));
  const inherited = new Set(actor.inheritedPermissions);
  const activeExplicit = new Set(actor.activePermissionGrants.map((grant) => grant.permission));

  return {
    required,
    granted: actor.permissions,
    grantScope: {
      activeGrantCount: actor.activePermissionGrants.length,
      rejectedGrantCount: actor.rejectedPermissionGrants.length,
      activeScopedGrantCount: actor.activePermissionGrants.filter((grant) => grant.scoped).length,
      rejectedRequiredGrantCount: rejectedRequiredGrants.length,
      activeIsolationKeys: Array.from(new Set(actor.activePermissionGrants.map((grant) => grant.isolationKey))),
      rejected: actor.rejectedPermissionGrants.map((grant) => ({
        grantId: grant.grantId,
        permission: grant.permission,
        expectedTenantId: grant.expectedTenantId,
        expectedWorkspaceId: grant.expectedWorkspaceId,
        actualTenantId: grant.actualTenantId,
        actualWorkspaceId: grant.actualWorkspaceId,
        reason: grant.reason
      }))
    },
    sources: required.reduce((sources, permission) => {
      sources[permission] = inherited.has(permission)
        ? 'role'
        : (activeExplicit.has(permission) ? 'active-explicit-grant' : 'missing');
      return sources;
    }, {}),
    missing,
    allowed: missing.length === 0 && rejectedRequiredGrants.length === 0
  };
}

function appendScopeViolations(violations, scope, actor) {
  if (scope.clientTenantId && scope.clientTenantId !== scope.tenantId) {
    violations.push({
      field: 'scope.tenantId',
      code: 'client_tenant_mismatch',
      expectedTenantId: scope.tenantId,
      actualTenantId: scope.clientTenantId
    });
  }

  if (scope.clientWorkspaceId && scope.clientWorkspaceId !== scope.workspaceId) {
    violations.push({
      field: 'scope.workspaceId',
      code: 'client_workspace_mismatch',
      expectedWorkspaceId: scope.workspaceId,
      actualWorkspaceId: scope.clientWorkspaceId
    });
  }

  if (scope.runtimeTenantId && scope.runtimeTenantId !== scope.tenantId) {
    violations.push({
      field: 'runtime.tenantId',
      code: 'runtime_tenant_boundary_crossed',
      expectedTenantId: scope.tenantId,
      actualTenantId: scope.runtimeTenantId
    });
  }

  if (actor.tenantId && actor.tenantId !== scope.tenantId && !actor.permissions.includes('kernel.process.impersonate')) {
    violations.push({
      field: 'actor.tenantId',
      code: 'actor_tenant_boundary_crossed',
      expectedTenantId: scope.tenantId,
      actualTenantId: actor.tenantId
    });
  }

  if (actor.workspaceId && actor.workspaceId !== scope.workspaceId && !actor.permissions.includes('kernel.process.impersonate')) {
    violations.push({
      field: 'actor.workspaceId',
      code: 'actor_workspace_boundary_crossed',
      expectedWorkspaceId: scope.workspaceId,
      actualWorkspaceId: actor.workspaceId
    });
  }

  for (const grant of actor.rejectedPermissionGrants) {
    violations.push({
      field: 'actor.permissions',
      code: 'actor_permission_grant_scope_mismatch',
      grantId: grant.grantId,
      permission: grant.permission,
      expectedTenantId: grant.expectedTenantId,
      expectedWorkspaceId: grant.expectedWorkspaceId,
      actualTenantId: grant.actualTenantId,
      actualWorkspaceId: grant.actualWorkspaceId,
      reason: grant.reason
    });
  }
}

function appendPersistedScopeViolations(violations, persistedState, scope) {
  if (!persistedState.found) {
    return;
  }

  if (persistedState.scope.tenantId && persistedState.scope.tenantId !== scope.tenantId) {
    violations.push({
      field: 'persistedAdmission.current.scope.tenantId',
      code: 'persisted_tenant_boundary_mismatch',
      expectedTenantId: scope.tenantId,
      actualTenantId: persistedState.scope.tenantId
    });
  }

  if (persistedState.scope.workspaceId && persistedState.scope.workspaceId !== scope.workspaceId) {
    violations.push({
      field: 'persistedAdmission.current.scope.workspaceId',
      code: 'persisted_workspace_boundary_mismatch',
      expectedWorkspaceId: scope.workspaceId,
      actualWorkspaceId: persistedState.scope.workspaceId
    });
  }
}

function appendPersistedCheckpointViolations(violations, persistedState, requestId) {
  if (!persistedState.found) {
    return;
  }

  if (persistedState.checkpoint.requestId && persistedState.checkpoint.requestId !== requestId) {
    violations.push({
      field: 'persistedAdmission.checkpoint.requestId',
      code: 'persisted_checkpoint_request_mismatch',
      expectedRequestId: requestId,
      actualRequestId: persistedState.checkpoint.requestId
    });
  }

  if (persistedState.checkpoint.status && persistedState.status !== 'not-found' && persistedState.checkpoint.status !== persistedState.status) {
    violations.push({
      field: 'persistedAdmission.checkpoint.status',
      code: 'persisted_checkpoint_status_mismatch',
      expectedStatus: persistedState.status,
      actualStatus: persistedState.checkpoint.status
    });
  }

  if (persistedState.checkpoint.phase === 'handoff' && !persistedState.checkpoint.handoffRef) {
    violations.push({
      field: 'persistedAdmission.checkpoint.handoffRef',
      code: 'persisted_handoff_checkpoint_missing_ref',
      status: persistedState.status
    });
  }
}

function buildPersistedCommandLedger({ current, checkpoint, events, commandReceipts, seenCommandIds, seenIdempotencyKeys, leaseStatus }) {
  const eventStatuses = new Set(events.map((event) => event.status).filter(Boolean));
  const receiptStatuses = new Set(commandReceipts.map((receipt) => receipt.status).filter(Boolean));
  const duplicateCommandIds = [];
  const duplicateIdempotencyKeys = [];
  const commandIdCounts = {};
  const idempotencyKeyCounts = {};
  const latestReceipt = commandReceipts
    .slice()
    .sort((left, right) => right.writeRevision - left.writeRevision)[0] || null;

  for (const commandId of seenCommandIds) {
    commandIdCounts[commandId] = (commandIdCounts[commandId] || 0) + 1;
  }

  for (const idempotencyKey of seenIdempotencyKeys) {
    idempotencyKeyCounts[idempotencyKey] = (idempotencyKeyCounts[idempotencyKey] || 0) + 1;
  }

  for (const [commandId, count] of Object.entries(commandIdCounts)) {
    if (count > 1) {
      duplicateCommandIds.push(commandId);
    }
  }

  for (const [idempotencyKey, count] of Object.entries(idempotencyKeyCounts)) {
    if (count > 1) {
      duplicateIdempotencyKeys.push(idempotencyKey);
    }
  }

  return {
    schemaVersion: 1,
    status: current.status,
    checkpointStatus: checkpoint.status,
    checkpointPhase: checkpoint.phase,
    checkpointAligned: !checkpoint.status || checkpoint.status === current.status,
    commandReceiptCount: commandReceipts.length,
    eventCount: events.length,
    seenCommandCount: seenCommandIds.length,
    seenIdempotencyKeyCount: seenIdempotencyKeys.length,
    duplicateCommandIds,
    duplicateIdempotencyKeys,
    eventStatuses: Array.from(eventStatuses),
    receiptStatuses: Array.from(receiptStatuses),
    latestReceipt: latestReceipt
      ? {
        commandId: latestReceipt.commandId,
        idempotencyKey: latestReceipt.idempotencyKey,
        status: latestReceipt.status,
        writeRevision: latestReceipt.writeRevision,
        appliedAt: latestReceipt.appliedAt
      }
      : null,
    lease: leaseStatus,
    restartConsistency: checkpoint.status && checkpoint.status !== current.status
      ? 'checkpoint-status-mismatch'
      : (leaseStatus.expired ? 'lease-expired' : 'consistent')
  };
}

function findPersistedCommandReceipt(persistedState, command) {
  const matchingReceipts = persistedState.commandReceipts.filter((receipt) => (
    (receipt.commandId && receipt.commandId === command.commandId)
      || (receipt.idempotencyKey && receipt.idempotencyKey === command.idempotencyKey)
  ));

  return matchingReceipts
    .slice()
    .sort((left, right) => right.writeRevision - left.writeRevision)[0] || null;
}

function normalizeScopeBoundaryPolicy(input) {
  const runtime = asPlainObject(input.runtime);
  const tenant = asPlainObject(input.tenant);
  const workspace = asPlainObject(input.workspace);
  const policy = asPlainObject(
    input.scopeBoundaryPolicy
      || runtime.scopeBoundaryPolicy
      || tenant.scopeBoundaryPolicy
      || workspace.scopeBoundaryPolicy
      || input.boundaryPolicy
  );
  const audit = asPlainObject(policy.audit || input.scopeAudit);

  return {
    schemaVersion: 1,
    policyId: textOrDefault(policy.policyId || policy.id, 'hosted-kernel-scope-boundary'),
    mode: textOrDefault(policy.mode, 'enforce'),
    requireExplicitTenant: policy.requireExplicitTenant === true,
    requireExplicitWorkspace: policy.requireExplicitWorkspace === true,
    allowedTenantIds: normalizeList(policy.allowedTenantIds || tenant.allowedTenantIds),
    allowedWorkspaceIds: normalizeList(policy.allowedWorkspaceIds || workspace.allowedWorkspaceIds),
    allowCrossWorkspaceImpersonation: policy.allowCrossWorkspaceImpersonation === true,
    allowCrossTenantImpersonation: policy.allowCrossTenantImpersonation === true,
    audit: {
      sink: textOrDefault(audit.sink || audit.target, 'kernel.audit.scope-boundary'),
      classification: textOrDefault(audit.classification, 'tenant-confidential'),
      redactActorSession: audit.redactActorSession !== false,
      includeDeniedValues: audit.includeDeniedValues === true
    }
  };
}

function buildScopeBoundaryProof({ policy, scope, actor, command, requestId, blockingViolations, warnings, now }) {
  const violationCodes = blockingViolations.map((violation) => violation.code);
  const warningCodes = warnings.map((warning) => warning.code);
  const defaultedAxes = [
    scope.tenantExplicit ? null : 'tenant',
    scope.workspaceExplicit ? null : 'workspace'
  ].filter(Boolean);
  const roleFallbackApplied = actor.roleKnown === false;
  const boundaryHashBasis = [
    policy.policyId,
    policy.mode,
    scope.tenantId,
    scope.workspaceId,
    scope.tenantSource,
    scope.workspaceSource,
    actor.actorId,
    actor.effectiveRole,
    command.commandId,
    violationCodes.join(','),
    warningCodes.join(',')
  ].join('|');
  let hash = 0;

  for (let index = 0; index < boundaryHashBasis.length; index += 1) {
    hash = ((hash * 33) ^ boundaryHashBasis.charCodeAt(index)) >>> 0;
  }

  return {
    schemaVersion: 1,
    proofType: 'hosted-kernel-scope-boundary',
    proofId: `${surfaceId}:scope-boundary:${hash.toString(16).padStart(8, '0')}`,
    requestId,
    commandId: command.commandId,
    policyId: policy.policyId,
    mode: policy.mode,
    isolationKey: scope.isolationKey,
    routePartition: `${scope.tenantId}/${scope.workspaceId}`,
    scopeSources: {
      tenant: scope.tenantSource,
      workspace: scope.workspaceSource,
      tenantExplicit: scope.tenantExplicit,
      workspaceExplicit: scope.workspaceExplicit,
      defaultedAxes
    },
    actorBoundary: {
      actorId: actor.actorId,
      requestedRole: actor.requestedRole,
      effectiveRole: actor.effectiveRole,
      roleKnown: actor.roleKnown,
      roleFallbackApplied,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      canImpersonate: actor.permissions.includes('kernel.process.impersonate'),
      activePermissionGrantCount: actor.activePermissionGrants.length,
      rejectedPermissionGrantCount: actor.rejectedPermissionGrants.length,
      activePermissionGrantRefs: actor.activePermissionGrants.map((grant) => ({
        grantId: grant.grantId,
        permission: grant.permission,
        isolationKey: grant.isolationKey,
        scoped: grant.scoped
      })),
      rejectedPermissionGrantRefs: actor.rejectedPermissionGrants.map((grant) => ({
        grantId: grant.grantId,
        permission: grant.permission,
        reason: grant.reason
      }))
    },
    result: {
      allowed: blockingViolations.length === 0,
      violationCount: blockingViolations.length,
      warningCount: warnings.length,
      violationCodes,
      warningCodes
    },
    auditHandoff: {
      sink: policy.audit.sink,
      classification: policy.audit.classification,
      proofRef: `${surfaceId}:scope-boundary:${requestId}:${command.commandId}`,
      requiresSecurityReview: blockingViolations.length > 0 || roleFallbackApplied,
      emittedAt: now
    },
    generatedAt: now
  };
}

function buildScopeBoundaryDecision({ policy, scope, actor, persistedState, command, requestId, now }) {
  const violations = [];
  const warnings = [];
  const enforceable = policy.mode !== 'disabled';
  const enforced = policy.mode === 'enforce';
  const actorCanImpersonate = actor.permissions.includes('kernel.process.impersonate');
  const crossTenantActor = Boolean(actor.tenantId && actor.tenantId !== scope.tenantId);
  const crossWorkspaceActor = Boolean(actor.workspaceId && actor.workspaceId !== scope.workspaceId);

  if (!KNOWN_SCOPE_BOUNDARY_MODES.has(policy.mode)) {
    violations.push({
      field: 'scopeBoundaryPolicy.mode',
      code: 'unknown_scope_boundary_policy_mode',
      policyId: policy.policyId,
      message: `scopeBoundaryPolicy.mode must be one of ${Array.from(KNOWN_SCOPE_BOUNDARY_MODES).join(', ')}`
    });
  }

  if (policy.requireExplicitTenant && !scope.tenantExplicit) {
    violations.push({
      field: 'scope.tenantId',
      code: 'explicit_tenant_scope_required',
      policyId: policy.policyId,
      source: scope.tenantSource
    });
  }

  if (policy.requireExplicitWorkspace && !scope.workspaceExplicit) {
    violations.push({
      field: 'scope.workspaceId',
      code: 'explicit_workspace_scope_required',
      policyId: policy.policyId,
      source: scope.workspaceSource
    });
  }

  if (policy.allowedTenantIds.length > 0 && !policy.allowedTenantIds.includes(scope.tenantId)) {
    violations.push({
      field: 'scope.tenantId',
      code: 'tenant_scope_not_allowed',
      policyId: policy.policyId,
      allowedTenantCount: policy.allowedTenantIds.length,
      actualTenantId: policy.audit.includeDeniedValues ? scope.tenantId : null
    });
  }

  if (policy.allowedWorkspaceIds.length > 0 && !policy.allowedWorkspaceIds.includes(scope.workspaceId)) {
    violations.push({
      field: 'scope.workspaceId',
      code: 'workspace_scope_not_allowed',
      policyId: policy.policyId,
      allowedWorkspaceCount: policy.allowedWorkspaceIds.length,
      actualWorkspaceId: policy.audit.includeDeniedValues ? scope.workspaceId : null
    });
  }

  if (crossTenantActor && (!actorCanImpersonate || !policy.allowCrossTenantImpersonation)) {
    violations.push({
      field: 'actor.tenantId',
      code: actorCanImpersonate ? 'cross_tenant_impersonation_not_allowed' : 'cross_tenant_impersonation_permission_missing',
      policyId: policy.policyId,
      expectedTenantId: policy.audit.includeDeniedValues ? scope.tenantId : null,
      actualTenantId: policy.audit.includeDeniedValues ? actor.tenantId : null
    });
  }

  if (crossWorkspaceActor && (!actorCanImpersonate || !policy.allowCrossWorkspaceImpersonation)) {
    violations.push({
      field: 'actor.workspaceId',
      code: actorCanImpersonate ? 'cross_workspace_impersonation_not_allowed' : 'cross_workspace_impersonation_permission_missing',
      policyId: policy.policyId,
      expectedWorkspaceId: policy.audit.includeDeniedValues ? scope.workspaceId : null,
      actualWorkspaceId: policy.audit.includeDeniedValues ? actor.workspaceId : null
    });
  }

  if (persistedState.found && persistedState.scope.isolationKey && persistedState.scope.isolationKey !== scope.isolationKey) {
    violations.push({
      field: 'persistedAdmission.current.scope.isolationKey',
      code: 'persisted_isolation_key_mismatch',
      policyId: policy.policyId,
      expectedIsolationKey: policy.audit.includeDeniedValues ? scope.isolationKey : null,
      actualIsolationKey: policy.audit.includeDeniedValues ? persistedState.scope.isolationKey : null
    });
  }

  if (!enforced && enforceable) {
    warnings.push(...violations.map((violation) => ({
      code: violation.code,
      field: violation.field,
      policyId: policy.policyId,
      message: 'Scope boundary policy is monitoring this admission without blocking handoff.'
    })));
  }

  const blockingViolations = enforced ? violations : [];
  const actorSessionId = policy.audit.redactActorSession && actor.sessionId ? 'redacted' : actor.sessionId;
  const proof = buildScopeBoundaryProof({
    policy,
    scope,
    actor,
    command,
    requestId,
    blockingViolations,
    warnings,
    now
  });

  return {
    schemaVersion: 1,
    policyId: policy.policyId,
    mode: policy.mode,
    enforced,
    allowed: blockingViolations.length === 0,
    handoffAllowed: blockingViolations.length === 0,
    isolationKey: scope.isolationKey,
    routePartition: `${scope.tenantId}/${scope.workspaceId}`,
    compartmentKey: `${surfaceId}:${scope.isolationKey}`,
    scopeSources: proof.scopeSources,
    proof,
    violationCount: blockingViolations.length,
    warningCount: warnings.length,
    violations: blockingViolations,
    warnings,
    actionableErrors: blockingViolations.map((violation) => ({
      code: violation.code,
      message: 'Tenant and workspace scope must be isolated before hosted-kernel process handoff.',
      owner: 'kernel.security.scope-boundary',
      retryable: ['explicit_tenant_scope_required', 'explicit_workspace_scope_required'].includes(violation.code),
      retryAfterMs: null
    })),
    audit: {
      sink: policy.audit.sink,
      classification: policy.audit.classification,
      subject: {
        requestId,
        commandId: command.commandId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        actorId: actor.actorId,
        actorRole: actor.role,
        actorSessionId
      },
      evaluatedAt: now,
      handoff: proof.auditHandoff
    }
  };
}

function normalizePersistedAdmissionState(input, now) {
  const persisted = asPlainObject(input.persistedAdmission || input.persistedState || input.state);
  const current = asPlainObject(persisted.current);
  const checkpoint = normalizeCheckpoint(persisted.checkpoint || current.checkpoint);
  const storedStatus = textOrDefault(current.status || persisted.status, 'not-found');
  const storedRequestId = textOrDefault(current.requestId || persisted.requestId, null);
  const storedCommandId = textOrDefault(current.commandId || persisted.commandId, null);
  const scope = asPlainObject(current.scope || persisted.scope);
  const events = normalizeStoredEvents(persisted.events || persisted.journal);
  const commandReceipts = normalizeCommandReceipts(persisted.commandReceipts || persisted.receipts);
  const seenCommandIds = new Set(normalizeList(persisted.seenCommandIds));
  const seenIdempotencyKeys = new Set(normalizeList(persisted.seenIdempotencyKeys));
  const lease = normalizePersistenceLease(persisted.lease || current.lease);
  const leaseStatus = derivePersistenceLeaseStatus(lease, now);

  for (const event of events) {
    if (event.commandId) {
      seenCommandIds.add(event.commandId);
    }

    if (event.idempotencyKey) {
      seenIdempotencyKeys.add(event.idempotencyKey);
    }
  }

  for (const receipt of commandReceipts) {
    if (receipt.commandId) {
      seenCommandIds.add(receipt.commandId);
    }

    if (receipt.idempotencyKey) {
      seenIdempotencyKeys.add(receipt.idempotencyKey);
    }
  }

  const normalizedCurrent = {
    status: storedStatus,
    requestId: storedRequestId,
    commandId: storedCommandId,
    updatedAt: textOrDefault(current.updatedAt || persisted.updatedAt, null),
    expiresAt: textOrDefault(current.expiresAt || persisted.expiresAt || persisted.holdExpiresAt, null),
    ttlMs: current.ttlMs ?? persisted.ttlMs ?? persisted.holdTtlMs ?? persisted.admissionHoldTtlMs
  };
  const normalizedSeenCommandIds = Array.from(seenCommandIds);
  const normalizedSeenIdempotencyKeys = Array.from(seenIdempotencyKeys);
  const statusContract = classifyPersistedAdmissionStatus(storedStatus);
  const expiration = derivePersistedAdmissionExpiration({
    status: storedStatus,
    current: normalizedCurrent,
    checkpoint,
    persisted,
    now
  });

  return {
    version: Number.isInteger(persisted.version) ? persisted.version : 1,
    found: storedStatus !== 'not-found' || events.length > 0,
    status: storedStatus,
    statusContract,
    requestId: storedRequestId,
    commandId: storedCommandId,
    scope: {
      tenantId: textOrDefault(scope.tenantId, null),
      workspaceId: textOrDefault(scope.workspaceId, null),
      isolationKey: textOrDefault(scope.isolationKey, null)
    },
    updatedAt: normalizedCurrent.updatedAt,
    expiration,
    admittedAt: textOrDefault(current.admittedAt || persisted.admittedAt, null),
    productHandoff: normalizePersistedProductHandoff(current.productHandoff || persisted.productHandoff),
    recoveryToken: textOrDefault(current.recoveryToken || persisted.recoveryToken, null),
    writeRevision: normalizeInteger(current.writeRevision ?? current.revision ?? persisted.writeRevision ?? persisted.revision, 0),
    journalSequence: normalizeInteger(persisted.journalSequence ?? persisted.sequence, latestEventSequence(events)),
    lease: {
      ...lease,
      status: leaseStatus
    },
    checkpoint,
    events,
    commandReceipts,
    seenCommandIds: normalizedSeenCommandIds,
    seenIdempotencyKeys: normalizedSeenIdempotencyKeys,
    commandLedger: buildPersistedCommandLedger({
      current: normalizedCurrent,
      checkpoint,
      events,
      commandReceipts,
      seenCommandIds: normalizedSeenCommandIds,
      seenIdempotencyKeys: normalizedSeenIdempotencyKeys,
      leaseStatus
    })
  };
}

function normalizePersistedProductHandoff(value) {
  const handoff = asPlainObject(value);
  const mailchimp = asPlainObject(handoff.mailchimp || handoff.productService);

  if (Object.keys(handoff).length === 0 && Object.keys(mailchimp).length === 0) {
    return null;
  }

  return {
    schemaVersion: normalizeInteger(handoff.schemaVersion, 1),
    product: textOrDefault(handoff.product || mailchimp.product, null),
    state: textOrDefault(handoff.state || mailchimp.state, 'unknown'),
    handoffId: textOrDefault(handoff.handoffId || mailchimp.handoffId, null),
    providerId: textOrDefault(handoff.providerId || mailchimp.providerId, null),
    audienceId: textOrDefault(mailchimp.audienceId || handoff.audienceId, null),
    campaignId: textOrDefault(mailchimp.campaignId || handoff.campaignId, null),
    webhookId: textOrDefault(mailchimp.webhookId || handoff.webhookId, null),
    externalRef: textOrDefault(handoff.externalRef || mailchimp.externalRef, null),
    syncGeneration: normalizeInteger(handoff.syncGeneration ?? mailchimp.syncGeneration, 0),
    persistedAt: textOrDefault(handoff.persistedAt || handoff.updatedAt || mailchimp.persistedAt, null),
    recoveryAction: textOrDefault(handoff.recoveryAction || mailchimp.recoveryAction, null),
    idempotencyKey: textOrDefault(handoff.idempotencyKey || mailchimp.idempotencyKey, null),
    blockedBy: normalizeList(handoff.blockedBy || mailchimp.blockedBy)
  };
}

function normalizeAdmissionCommand(input, now) {
  const command = asPlainObject(input.command);
  const name = textOrDefault(command.name || input.commandName, 'request-admission');
  const commandId = textOrDefault(command.commandId || input.commandId, `admission-command-${now}`);
  const objective = asPlainObject(command.objective || command.processObjective || input.commandObjective);

  return {
    name,
    commandId,
    idempotencyKey: textOrDefault(command.idempotencyKey || input.idempotencyKey, commandId),
    issuedAt: textOrDefault(command.issuedAt || input.issuedAt, now),
    actor: textOrDefault(command.actor || input.actor, 'kernel.lifecycle.process-admission'),
    objective: {
      objective: textOrDefault(objective.objective || objective.goal || objective.summary, null),
      summary: textOrDefault(objective.summary || objective.description, null),
      origin: textOrDefault(objective.origin, null)
    }
  };
}

function normalizeObjectiveText(value) {
  return textOrDefault(value, '')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function stableAdmissionHash(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 45) + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function normalizeProcessObjective({ input, command, requestId, intent, scope, now }) {
  const request = asPlainObject(input.request);
  const client = asPlainObject(input.client);
  const runtime = asPlainObject(input.runtime);
  const commandObjective = asPlainObject(command.objective || request.commandObjective);
  const rawObjective = firstText(
    request.objective,
    request.goal,
    commandObjective.objective,
    commandObjective.summary,
    client.objective,
    runtime.objective,
    input.objective,
    input.goal
  );
  const origin = request.objective || request.goal
    ? 'request'
    : (commandObjective.objective || commandObjective.summary
      ? 'command'
      : (client.objective
        ? 'client'
        : (runtime.objective ? 'runtime' : 'default')));
  const summary = normalizeObjectiveText(rawObjective || intent || 'continue kernel lifecycle');
  const labels = normalizeList(request.objectiveTags || request.tags || input.objectiveTags)
    .map((label) => label.toLowerCase())
    .slice(0, 8);
  const requiredEvidenceTypes = normalizeList(
    request.requiredEvidenceTypes
      || request.evidenceTypes
      || input.requiredEvidenceTypes
  ).slice(0, 8);
  const evidenceItems = normalizeEvidenceItems(input.evidence);
  const evidenceSatisfaction = buildObjectiveEvidenceSatisfaction(requiredEvidenceTypes, evidenceItems);
  const objectiveKeyBasis = [
    requestId,
    scope.tenantId,
    scope.workspaceId,
    summary.toLowerCase(),
    labels.join(','),
    requiredEvidenceTypes.join(',')
  ].join('|');

  return {
    schemaVersion: 1,
    summary,
    normalizedSummary: summary.toLowerCase(),
    present: Boolean(rawObjective),
    origin,
    originKnown: KNOWN_OBJECTIVE_ORIGINS.has(origin),
    objectiveKey: `${surfaceId}:objective:${stableAdmissionHash(objectiveKeyBasis)}`,
    labelCount: labels.length,
    labels,
    requiredEvidenceTypes,
    requiredEvidenceSatisfied: evidenceSatisfaction.satisfied,
    requiredEvidence: evidenceSatisfaction,
    evidenceRefs: evidenceItems
      .filter((entry) => entry.type && requiredEvidenceTypes.includes(entry.type))
      .map((entry) => ({
        type: entry.type,
        evidenceId: entry.evidenceId,
        proofRef: entry.proofRef,
        source: entry.source,
        observedAt: entry.observedAt
      })),
    empty: summary.length === 0,
    generatedAt: now
  };
}

function buildOwnerBinding({ input, command, requestId, scope, actor, objective, now }) {
  const request = asPlainObject(input.request);
  const owner = asPlainObject(request.owner || input.owner || input.processOwner);
  const ownerId = firstText(owner.ownerId, owner.actorId, request.ownerId, input.ownerId, actor.actorId);
  const delegatedBy = firstText(owner.delegatedBy, owner.delegatorId, request.delegatedBy, input.delegatedBy);
  const bindingBasis = [
    requestId,
    command.commandId,
    scope.isolationKey,
    actor.actorId,
    actor.effectiveRole,
    ownerId,
    delegatedBy || 'self',
    objective.objectiveKey
  ].join('|');
  const actorOwnsRequest = ownerId === actor.actorId;
  const delegated = Boolean(delegatedBy && delegatedBy !== actor.actorId);
  const impersonatingOwner = ownerId !== actor.actorId;
  const actorCanBind = actorOwnsRequest
    || actor.permissions.includes('kernel.process.impersonate')
    || (delegated && actor.permissions.includes('kernel.process.request'));

  return {
    schemaVersion: 1,
    bindingId: `${surfaceId}:owner-binding:${stableAdmissionHash(bindingBasis)}`,
    ownerId,
    ownerSource: owner.ownerId || owner.actorId || request.ownerId || input.ownerId ? 'explicit' : 'actor-default',
    actorId: actor.actorId,
    actorRole: actor.effectiveRole,
    delegatedBy,
    delegated,
    impersonatingOwner,
    actorCanBind,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    objectiveKey: objective.objectiveKey,
    generatedAt: now,
    evidenceRef: `${surfaceId}:owner-binding:${requestId}:${command.commandId}`
  };
}

function buildInitialLifecycleEvidenceRefs({ requestId, command, scope, actor, objective, ownerBinding, now }) {
  const intakeRef = `${surfaceId}:intake:${requestId}:${command.commandId}`;
  const initialCheckpointRef = `${surfaceId}:checkpoint:initial:${scope.tenantId}:${scope.workspaceId}:${requestId}`;
  const auditSubjectRef = `${surfaceId}:audit-subject:${scope.tenantId}:${scope.workspaceId}:${ownerBinding.ownerId || actor.actorId}`;
  const proofBasis = [
    intakeRef,
    initialCheckpointRef,
    auditSubjectRef,
    objective.objectiveKey,
    ownerBinding.bindingId,
    objective.requiredEvidence.missingTypes.join(','),
    objective.requiredEvidence.satisfiedTypes.join(',')
  ].join('|');
  const proofId = `${surfaceId}:intake-proof:${stableAdmissionHash(proofBasis)}`;

  return {
    schemaVersion: 1,
    intakeRef,
    objectiveKey: objective.objectiveKey,
    ownerBindingId: ownerBinding.bindingId,
    ownerBindingRef: ownerBinding.evidenceRef,
    initialCheckpointRef,
    auditSubjectRef,
    requiredEvidenceTypes: objective.requiredEvidenceTypes,
    requiredEvidence: objective.requiredEvidence,
    objectiveEvidenceRefs: objective.evidenceRefs,
    checklist: {
      objectivePresent: objective.present && !objective.empty,
      objectiveNormalized: Boolean(objective.objectiveKey && objective.normalizedSummary),
      ownerBound: Boolean(ownerBinding.ownerId && ownerBinding.bindingId),
      ownerBindingAuthorized: ownerBinding.actorCanBind,
      requiredEvidenceSatisfied: objective.requiredEvidenceSatisfied
    },
    proof: {
      schemaVersion: 1,
      proofType: 'process-admission-initial-lifecycle-evidence',
      proofId,
      basis: proofBasis,
      generatedAt: now
    }
  };
}

function appendAdmissionIntakeViolations(violations, objective, ownerBinding) {
  if (!objective.present || objective.empty) {
    violations.push({
      field: 'request.objective',
      code: 'process_objective_required',
      message: 'Process admission requires a non-empty objective before lifecycle handoff.'
    });
  }

  if (!objective.originKnown) {
    violations.push({
      field: 'request.objective',
      code: 'unknown_process_objective_origin',
      actualOrigin: objective.origin
    });
  }

  if (!ownerBinding.ownerId) {
    violations.push({
      field: 'request.ownerId',
      code: 'process_owner_required',
      message: 'Process admission requires a bound owner before lifecycle handoff.'
    });
  }

  if (!ownerBinding.actorCanBind) {
    violations.push({
      field: 'request.ownerId',
      code: 'process_owner_binding_permission_missing',
      ownerId: ownerBinding.ownerId,
      actorId: ownerBinding.actorId,
      delegatedBy: ownerBinding.delegatedBy
    });
  }

  if (!objective.requiredEvidenceSatisfied) {
    violations.push({
      field: 'request.requiredEvidenceTypes',
      code: 'process_objective_required_evidence_missing',
      requiredEvidenceTypes: objective.requiredEvidenceTypes,
      missingEvidenceTypes: objective.requiredEvidence.missingTypes
    });
  }
}

function derivePersistedStatus(admission, commandName) {
  if (commandName === 'cancel-admission') {
    return 'cancelled';
  }

  if (admission.decision.admitted) {
    return admission.runtime.health?.degradedMode ? 'degraded-spawn-dispatched' : 'spawn-dispatched';
  }

  if (admission.runtime.health?.retryable) {
    return 'pending-health-retry';
  }

  if (admission.runtime.health?.blocked) {
    return 'blocked-health';
  }

  const hasOnlyAuthBlocker = admission.decision.violations.length === 0
    && admission.runtime.hostedKernelRequired
    && admission.client.state === 'anonymous';

  return hasOnlyAuthBlocker ? 'pending-authorization' : 'pending-remediation';
}

function buildRecoveryPlan(persistedState, admission, command) {
  const sameRequest = persistedState.requestId === admission.request.requestId;
  const sameTenant = !persistedState.scope.tenantId || persistedState.scope.tenantId === admission.scope.tenantId;
  const sameWorkspace = !persistedState.scope.workspaceId || persistedState.scope.workspaceId === admission.scope.workspaceId;
  const checkpointMatchesRequest = !persistedState.checkpoint.requestId
    || persistedState.checkpoint.requestId === admission.request.requestId;
  const commandIdReplay = persistedState.seenCommandIds.includes(command.commandId)
    || (persistedState.commandId && persistedState.commandId === command.commandId);
  const idempotencyKeyReplay = persistedState.seenIdempotencyKeys.includes(command.idempotencyKey);
  const idempotentReplay = commandIdReplay || idempotencyKeyReplay;
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedState.status);
  const recoverable = RECOVERABLE_PERSISTED_STATUSES.has(persistedState.status);
  const replayBasis = commandIdReplay ? 'command-id' : (idempotencyKeyReplay ? 'idempotency-key' : null);
  const replayReceipt = findPersistedCommandReceipt(persistedState, command);
  const replayStatus = textOrDefault(replayReceipt?.status, null);
  const checkpointInconsistent = persistedState.commandLedger.restartConsistency === 'checkpoint-status-mismatch';
  const leaseExpired = persistedState.lease.status.expired === true;
  const staleWriterRecoveryAction = leaseExpired
    ? 'reacquire-persistence-lease-before-admission-write'
    : 'reload-checkpoint-before-admission-write';
  const holdExpired = persistedState.expiration.expired === true;

  if (!persistedState.found) {
    return {
      mode: 'initialize',
      restartSafeStatus: 'new-command',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: 'persist-admission-envelope'
    };
  }

  if (!persistedState.statusContract.known) {
    return {
      mode: 'quarantine',
      restartSafeStatus: 'unknown-persisted-status',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: persistedState.statusContract.recoveryAction
    };
  }

  if (!sameTenant || !sameWorkspace) {
    return {
      mode: 'quarantine',
      restartSafeStatus: 'scope-boundary-mismatch',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: 'reject-cross-scope-persisted-state'
    };
  }

  if (!sameRequest) {
    return {
      mode: 'fork',
      restartSafeStatus: 'new-request-after-restart',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: 'persist-separate-admission-envelope'
    };
  }

  if (!checkpointMatchesRequest) {
    return {
      mode: 'quarantine',
      restartSafeStatus: 'checkpoint-request-mismatch',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: 'reject-mismatched-restart-checkpoint'
    };
  }

  if (holdExpired && command.name === 'cancel-admission') {
    return {
      mode: 'cancel-expired',
      restartSafeStatus: 'expired-admission-cancelled',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: 'cancel-expired-admission-hold'
    };
  }

  if (holdExpired && command.name === 'recover-admission' && recoverable) {
    return {
      mode: 'resume-expired',
      restartSafeStatus: 'expired-admission-hold',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: true,
      action: leaseExpired
        ? 'reacquire-lease-and-rebuild-expired-admission'
        : 'rebuild-expired-admission-from-checkpoint'
    };
  }

  if (holdExpired) {
    return {
      mode: 'expired-hold',
      restartSafeStatus: 'expired-admission-hold',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: true,
      action: 'issue-recover-admission-for-expired-hold'
    };
  }

  if (checkpointInconsistent && !idempotentReplay && !terminal) {
    return {
      mode: 'repair-checkpoint',
      restartSafeStatus: 'checkpoint-status-mismatch',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: false,
      action: staleWriterRecoveryAction
    };
  }

  if (idempotentReplay || terminal) {
    return {
      mode: 'replay',
      restartSafeStatus: terminal ? persistedState.status : (replayStatus || 'already-applied'),
      idempotentReplay: true,
      replayBasis: terminal && !replayBasis ? 'terminal-status' : replayBasis,
      replayReceipt: replayReceipt
        ? {
          commandId: replayReceipt.commandId,
          idempotencyKey: replayReceipt.idempotencyKey,
          status: replayReceipt.status,
          eventId: replayReceipt.eventId,
          writeRevision: replayReceipt.writeRevision,
          appliedAt: replayReceipt.appliedAt
        }
        : null,
      replayStatus,
      canResume: false,
      action: 'return-persisted-outcome'
    };
  }

  if (leaseExpired && recoverable && command.name !== 'recover-admission') {
    return {
      mode: 'resume-required',
      restartSafeStatus: 'persistence-lease-expired',
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: true,
      action: 'issue-recover-admission-after-lease-reacquire'
    };
  }

  if (command.name === 'recover-admission' && recoverable) {
    return {
      mode: 'resume',
      restartSafeStatus: persistedState.status,
      idempotentReplay: false,
      replayBasis: null,
      replayReceipt: null,
      replayStatus: null,
      canResume: true,
      action: leaseExpired
        ? 'reacquire-lease-and-resume-admission'
        : (admission.decision.admitted ? 're-dispatch-spawn-handoff' : 'resume-client-remediation')
    };
  }

  return {
    mode: 'advance',
    restartSafeStatus: persistedState.status,
    idempotentReplay: false,
    replayBasis: null,
    replayReceipt: null,
    replayStatus: null,
    canResume: recoverable,
    action: 'append-admission-event'
  };
}

function buildPersistenceWritePlan({
  admission,
  persistedState,
  command,
  recoveryPlan,
  nextStatus,
  checkpointPhase,
  nextEvent,
  now
}) {
  const nextRevision = recoveryPlan.idempotentReplay
    ? persistedState.writeRevision
    : persistedState.writeRevision + 1;
  const nextSequence = recoveryPlan.idempotentReplay
    ? persistedState.journalSequence
    : nextEvent.sequence;
  const operation = recoveryPlan.idempotentReplay
    ? 'read-existing'
    : (['quarantine', 'repair-checkpoint', 'resume-required', 'expired-hold'].includes(recoveryPlan.mode)
      ? 'reject-write'
      : (persistedState.found ? 'compare-and-swap-update' : 'insert-if-absent'));

  return {
    schemaVersion: 1,
    operation,
    statusAfterWrite: nextStatus,
    restartSafeStatus: recoveryPlan.restartSafeStatus,
    restartConsistency: persistedState.commandLedger.restartConsistency,
    durableBeforeHandoff: checkpointPhase === 'handoff' || checkpointPhase === 'terminal',
    preconditions: {
      keyAbsent: !persistedState.found,
      expectedRequestId: persistedState.requestId,
      expectedStatus: persistedState.status,
      expectedRevision: persistedState.writeRevision,
      expectedJournalSequence: persistedState.journalSequence,
      leaseId: persistedState.lease.leaseId,
      fencingToken: persistedState.lease.fencingToken,
      leaseState: persistedState.lease.status.state
    },
    mutation: recoveryPlan.idempotentReplay
      ? null
      : {
        writeRevision: nextRevision,
        journalSequence: nextSequence,
        appendEventId: nextEvent.eventId,
        recordReceipt: {
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          commandName: command.name,
          requestId: admission.request.requestId,
          status: nextStatus,
          appliedAt: now,
          eventId: nextEvent.eventId,
          writeRevision: nextRevision
        }
      },
    conflict: {
      onDuplicateCommandId: 'return-existing-receipt',
      onDuplicateIdempotencyKey: 'return-existing-receipt',
      onRevisionMismatch: 'reload-and-rebuild-recovery-plan',
      onLeaseMismatch: 'refuse-stale-writer',
      onExpiredLease: 'require-recover-admission',
      onExpiredAdmissionHold: 'recover-or-cancel-expired-admission'
    },
    proof: {
      requestId: admission.request.requestId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      replayBasis: recoveryPlan.replayBasis,
      generatedAt: now
    }
  };
}

function buildMailchimpProductHandoffIntent({
  providerContract,
  providerNegotiation,
  scope,
  requestId,
  command,
  status,
  recoveryToken,
  now
}) {
  if (!providerNegotiation.productServiceContract || providerNegotiation.productServiceContract.product !== 'mailchimp') {
    return null;
  }

  const product = providerNegotiation.productServiceContract;
  const syncFreshness = providerNegotiation.syncMetadata.freshness;
  const missingCapabilities = providerNegotiation.missingProviderCapabilities
    .filter((capability) => capability.startsWith('mailchimp.'));
  const contractViolations = providerNegotiation.serviceContract.violations
    .filter((violation) => violation.code.startsWith('mailchimp_'));
  const routeReady = providerNegotiation.routing.allowedTenant
    && providerNegotiation.routing.allowedWorkspace
    && providerNegotiation.routing.allowedRoutePartition;
  const syncReady = !providerContract.serviceLevel.requireCurrentSync || syncFreshness.state === 'fresh';
  const ackReady = MAILCHIMP_ACK_MODES.has(providerNegotiation.serviceContract.handoffAckMode)
    && Boolean(providerNegotiation.serviceContract.handoffAckEndpoint);
  const blockedBy = [
    ...missingCapabilities,
    ...contractViolations.map((violation) => violation.code),
    ...(routeReady ? [] : ['mailchimp_route_partition_not_ready']),
    ...(syncReady ? [] : ['mailchimp_provider_sync_not_current']),
    ...(ackReady ? [] : ['mailchimp_provider_ack_not_ready']),
    ...(product.readyForHandoff ? [] : ['mailchimp_product_contract_not_ready'])
  ];
  const ready = blockedBy.length === 0 && status !== 'cancelled';
  const state = status === 'cancelled'
    ? 'cancelled'
    : (ready ? 'ready' : (syncReady ? 'blocked' : 'sync-required'));
  const handoffId = `${surfaceId}:mailchimp:${scope.tenantId}:${scope.workspaceId}:${requestId}:${command.commandId}`;
  const idempotencyKey = `${recoveryToken}:mailchimp:${providerContract.providerId}:${providerNegotiation.syncMetadata.generation}`;
  const boundaryProofBasis = [
    handoffId,
    scope.tenantId,
    scope.workspaceId,
    scope.tenantSource || 'unknown-tenant-source',
    scope.workspaceSource || 'unknown-workspace-source',
    providerNegotiation.routing.routePartition,
    providerNegotiation.routing.declaredRoutePartition || 'undeclared-route-partition',
    providerNegotiation.syncMetadata.scopeCursor || 'missing-scope-cursor',
    providerNegotiation.serviceContract.handoffAckMode,
    providerNegotiation.serviceContract.handoffAckEndpoint || 'missing-ack-endpoint'
  ].join('|');
  const boundaryProofId = `${surfaceId}:mailchimp-boundary:${stableAdmissionHash(boundaryProofBasis)}`;
  const auditPayload = {
    schemaVersion: 1,
    payloadType: 'mailchimp-process-admission-boundary-audit',
    handoffId,
    proofId: boundaryProofId,
    generatedAt: now,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    routePartition: providerNegotiation.routing.routePartition,
    declaredRoutePartition: providerNegotiation.routing.declaredRoutePartition,
    routePartitionAccepted: routeReady,
    scopeCursor: providerNegotiation.syncMetadata.scopeCursor,
    tenantSource: scope.tenantSource,
    workspaceSource: scope.workspaceSource,
    defaultedScope: scope.scopeSource?.defaulted === true,
    providerId: providerContract.providerId,
    serviceContractId: providerNegotiation.serviceContract.contractId,
    product: 'mailchimp',
    audienceId: product.audienceId,
    campaignId: product.campaignId,
    webhookId: product.webhookId,
    syncGeneration: providerNegotiation.syncMetadata.generation,
    syncFreshnessState: syncFreshness.state,
    ackMode: providerNegotiation.serviceContract.handoffAckMode,
    ackEndpoint: providerNegotiation.serviceContract.handoffAckEndpoint,
    blockedBy: [...new Set(blockedBy)].sort(),
    disposition: ready ? 'accepted-for-handoff' : 'held-for-contract-repair'
  };
  const acceptance = {
    schemaVersion: 1,
    accepted: ready,
    acceptedAt: ready ? now : null,
    status: ready ? 'accepted' : 'blocked',
    requiredBeforeSpawn: true,
    boundaryProofId,
    exportReady: ready && ackReady && routeReady,
    blockedBy: auditPayload.blockedBy,
    nextAction: ready
      ? 'deliver-mailchimp-webhook-handoff'
      : syncReady
        ? 'repair-mailchimp-provider-handoff-contract'
        : 'sync-mailchimp-provider-contract'
  };

  return {
    schemaVersion: 1,
    product: 'mailchimp',
    state,
    ready,
    handoffId,
    idempotencyKey,
    providerId: providerContract.providerId,
    serviceContractId: providerNegotiation.serviceContract.contractId,
    audienceId: product.audienceId,
    campaignId: product.campaignId,
    datacenter: product.datacenter,
    webhookId: product.webhookId,
    webhookEndpoint: product.webhookEndpoint,
    webhookSigningKeyRef: product.webhookSigningKeyRef,
    suppressUnsubscribedContacts: product.suppressUnsubscribedContacts,
    externalRef: product.externalHandoffRef || providerContract.handoff.externalId || handoffId,
    routePartition: providerNegotiation.routing.routePartition,
    auditPayload,
    acceptance,
    boundary: {
      proofId: boundaryProofId,
      proofBasis: boundaryProofBasis,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey,
      tenantSource: scope.tenantSource,
      workspaceSource: scope.workspaceSource,
      defaultedScope: scope.scopeSource?.defaulted === true,
      routePartitionAccepted: routeReady,
      scopeCursorPresent: Boolean(providerNegotiation.syncMetadata.scopeCursor)
    },
    sync: {
      cursor: providerNegotiation.syncMetadata.cursor,
      scopeCursor: providerNegotiation.syncMetadata.scopeCursor,
      generation: providerNegotiation.syncMetadata.generation,
      freshnessState: syncFreshness.state,
      freshnessAgeMs: syncFreshness.ageMs,
      lastSyncedAt: providerNegotiation.syncMetadata.lastSyncedAt
    },
    acknowledgement: {
      mode: providerNegotiation.serviceContract.handoffAckMode,
      endpoint: providerNegotiation.serviceContract.handoffAckEndpoint,
      required: providerNegotiation.serviceContract.handoffAckMode !== 'none',
      deadlineMs: providerNegotiation.serviceContract.handoffAckDeadlineMs
    },
    restart: {
      recoveryToken,
      commandName: ready ? 'recover-admission' : 'request-admission',
      idempotencyKey,
      safeToRetry: true,
      recoveryAction: ready ? 'resume-mailchimp-webhook-handoff' : 'repair-mailchimp-provider-handoff-contract'
    },
    exportSummary: {
      format: 'process-admission-mailchimp-handoff.v1',
      ready,
      exportReady: acceptance.exportReady,
      handoffId,
      proofId: boundaryProofId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      providerId: providerContract.providerId,
      audienceId: product.audienceId,
      campaignId: product.campaignId,
      syncGeneration: providerNegotiation.syncMetadata.generation,
      ackRequired: providerNegotiation.serviceContract.handoffAckMode !== 'none',
      blockedBy: auditPayload.blockedBy
    },
    blockedBy: [...new Set(blockedBy)].sort(),
    persistedAt: now
  };
}

function buildPersistenceEnvelope(admission, persistedState, command, recoveryPlan, now, providerContract = null, providerNegotiation = null) {
  const nextStatus = recoveryPlan.idempotentReplay
    ? (recoveryPlan.replayStatus || persistedState.status)
    : derivePersistedStatus(admission, command.name);
  const recoveryToken = persistedState.recoveryToken
    || `${surfaceId}:${admission.request.requestId}:${command.idempotencyKey}`;
  const productHandoff = providerContract && providerNegotiation
    ? buildMailchimpProductHandoffIntent({
      providerContract,
      providerNegotiation,
      scope: admission.scope,
      requestId: admission.request.requestId,
      command,
      status: nextStatus,
      recoveryToken,
      now
    })
    : null;
  const checkpointPhase = deriveCheckpointPhase(nextStatus, admission);
  const nextCheckpointCommand = deriveNextCheckpointCommand({
    phase: checkpointPhase,
    recoveryPlan,
    commandName: command.name,
    retryAfterMs: admission.runtime.health?.retryable ? admission.runtime.health.retryAfterMs : null
  });
  const restartCommands = buildRestartCommandContracts({
    command,
    recoveryToken,
    nextCommandName: nextCheckpointCommand,
    commandCancelsAdmission: command.name === 'cancel-admission',
    cancellable: checkpointPhase !== 'terminal'
  });
  const retainedEvents = persistedState.events.slice(-9);
  const retainedReceipts = persistedState.commandReceipts.slice(-9);
  const nextEvent = {
    eventId: `${command.commandId}:${nextStatus}`,
    type: 'kernel.lifecycle.process-admission.command-applied',
    at: now,
    sequence: persistedState.journalSequence + 1,
    requestId: admission.request.requestId,
    status: nextStatus,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey
  };
  const writePlan = buildPersistenceWritePlan({
    admission,
    persistedState,
    command,
    recoveryPlan,
    nextStatus,
    checkpointPhase,
    nextEvent,
    now
  });
  const appendMutation = !recoveryPlan.idempotentReplay && writePlan.mutation !== null;

  return {
    version: 2,
    key: `${surfaceId}/${admission.scope.tenantId}/${admission.scope.workspaceId}/${admission.request.requestId}`,
    current: {
      requestId: admission.request.requestId,
      commandId: command.commandId,
      status: nextStatus,
      restartSafeStatus: recoveryPlan.restartSafeStatus,
      updatedAt: now,
      admittedAt: admission.decision.admitted ? (persistedState.admittedAt || now) : null,
      recoveryToken,
      scope: admission.scope,
      objectiveKey: admission.request.objective.objectiveKey,
      objectiveSummary: admission.request.objective.summary,
      ownerId: admission.request.ownerBinding.ownerId,
      ownerBindingId: admission.request.ownerBinding.bindingId,
      intakeEvidenceProofId: admission.request.lifecycleEvidenceRefs.proof.proofId,
      productHandoff,
      writeRevision: writePlan.mutation?.writeRevision ?? persistedState.writeRevision,
      journalSequence: writePlan.mutation?.journalSequence ?? persistedState.journalSequence
    },
    restartLedger: {
      schemaVersion: 1,
      consistency: persistedState.commandLedger.restartConsistency,
      persistedStatus: persistedState.status,
      statusContract: persistedState.statusContract,
      replayStatus: recoveryPlan.replayStatus,
      replayReceipt: recoveryPlan.replayReceipt,
      commandReceiptCount: persistedState.commandLedger.commandReceiptCount,
      eventCount: persistedState.commandLedger.eventCount,
      latestReceipt: persistedState.commandLedger.latestReceipt,
      duplicateCommandIds: persistedState.commandLedger.duplicateCommandIds,
      duplicateIdempotencyKeys: persistedState.commandLedger.duplicateIdempotencyKeys,
      lease: persistedState.lease.status,
      expiration: persistedState.expiration,
      productHandoff: persistedState.productHandoff,
      checkpointAligned: persistedState.commandLedger.checkpointAligned
    },
    checkpoint: {
      schemaVersion: 1,
      phase: checkpointPhase,
      status: nextStatus,
      requestId: admission.request.requestId,
      commandId: command.commandId,
      persistedAt: now,
      priorPersistedAt: persistedState.checkpoint.persistedAt,
      recoveredFromPhase: persistedState.checkpoint.phase,
      recoveryToken,
      nextCommandName: nextCheckpointCommand,
      resumeAfterMs: admission.runtime.health?.retryable ? admission.runtime.health.retryAfterMs : null,
      handoffRef: `${surfaceId}/${admission.scope.tenantId}/${admission.scope.workspaceId}/${admission.request.requestId}/${command.commandId}`,
      intakeRef: admission.request.lifecycleEvidenceRefs.intakeRef,
      ownerBindingRef: admission.request.lifecycleEvidenceRefs.ownerBindingRef,
      initialEvidenceProofId: admission.request.lifecycleEvidenceRefs.proof.proofId,
      productHandoffState: productHandoff?.state || null,
      productHandoffId: productHandoff?.handoffId || null,
      restartSafe: !recoveryPlan.idempotentReplay || recoveryPlan.mode === 'replay'
    },
    writePlan,
    idempotency: {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      replay: recoveryPlan.idempotentReplay,
      replayBasis: recoveryPlan.replayBasis,
      replayReceiptStatus: recoveryPlan.replayStatus,
      seenCommandIds: Array.from(new Set([...persistedState.seenCommandIds, command.commandId])),
      seenIdempotencyKeys: Array.from(new Set([...persistedState.seenIdempotencyKeys, command.idempotencyKey])),
      receipts: appendMutation ? [...retainedReceipts, writePlan.mutation.recordReceipt] : retainedReceipts
    },
    productHandoff,
    restartCommands,
    recovery: recoveryPlan,
    events: appendMutation ? [...retainedEvents, nextEvent] : retainedEvents
  };
}

function deriveReplayOutcomeFromPersistedStatus(status) {
  if (status === 'admitted' || status === 'spawn-dispatched' || status === 'degraded-spawn-dispatched') {
    return {
      admitted: true,
      decision: 'admit',
      handoffTarget: status === 'degraded-spawn-dispatched'
        ? 'kernel.lifecycle.spawn.degraded'
        : 'kernel.lifecycle.spawn',
      reason: status === 'degraded-spawn-dispatched'
        ? 'persisted_replay_admitted_with_degraded_runtime_health'
        : 'persisted_replay_admitted_before_process_spawn'
    };
  }

  if (status === 'cancelled') {
    return {
      admitted: false,
      decision: 'cancel',
      handoffTarget: 'kernel.lifecycle.admission.cancelled',
      reason: 'persisted_replay_cancelled_before_process_spawn'
    };
  }

  if (status === 'denied') {
    return {
      admitted: false,
      decision: 'hold',
      handoffTarget: 'client.workflow.authorize',
      reason: 'persisted_replay_denied_before_process_spawn'
    };
  }

  if (status === 'pending-authorization') {
    return {
      admitted: false,
      decision: 'hold',
      handoffTarget: 'client.workflow.authorize',
      reason: 'persisted_replay_pending_client_authorization'
    };
  }

  if (status === 'pending-health-retry' || status === 'blocked-health') {
    return {
      admitted: false,
      decision: 'hold',
      handoffTarget: 'kernel.lifecycle.process-admission.retry',
      reason: status === 'blocked-health'
        ? 'persisted_replay_blocked_on_runtime_health'
        : 'persisted_replay_pending_runtime_health_retry'
    };
  }

  if (status === 'pending-remediation') {
    return {
      admitted: false,
      decision: 'hold',
      handoffTarget: 'client.workflow.process-admission',
      reason: 'persisted_replay_pending_client_or_contract_remediation'
    };
  }

  return null;
}

function buildEffectiveAdmissionOutcome({
  commandCancelsAdmission,
  admitted,
  decision,
  handoffTarget,
  reason,
  persistence,
  recovery
}) {
  const replayOutcome = recovery.mode === 'replay'
    ? deriveReplayOutcomeFromPersistedStatus(persistence.current.status)
    : null;

  if (!replayOutcome) {
    return {
      schemaVersion: 1,
      admitted,
      status: decision,
      handoffTarget,
      reason,
      source: 'computed-admission-evaluation',
      replayed: false,
      replayBasis: recovery.replayBasis,
      persistedStatus: persistence.current.status,
      writeOperation: persistence.writePlan.operation,
      replayOutcomeStatusKnown: false,
      terminalPersistedStatus: TERMINAL_PERSISTED_STATUSES.has(persistence.current.status),
      commandCancelsAdmission
    };
  }

  return {
    schemaVersion: 1,
    admitted: replayOutcome.admitted,
    status: replayOutcome.decision,
    handoffTarget: replayOutcome.handoffTarget,
    reason: replayOutcome.reason,
    source: 'persisted-admission-replay',
    replayed: true,
    replayBasis: recovery.replayBasis || 'persisted-status',
    persistedStatus: persistence.current.status,
    writeOperation: persistence.writePlan.operation,
    replayOutcomeStatusKnown: true,
    terminalPersistedStatus: TERMINAL_PERSISTED_STATUSES.has(persistence.current.status),
    commandCancelsAdmission: replayOutcome.decision === 'cancel'
  };
}

function buildAdmissionReporting({
  input,
  command,
  requestId,
  scope,
  actor,
  objective,
  ownerBinding,
  lifecycleEvidenceRefs,
  clientState,
  runtimeMode,
  priority,
  decision,
  admitted,
  violations,
  actionableErrors,
  errorTriage,
  persistence,
  recovery,
  handoffTarget,
  operationalHealth,
  health,
  missingCapabilities,
  missingProviderCapabilities,
  providerNegotiation,
  clientRuntimeAdoption,
  externalHandoff,
  admissionPolicy,
  lifecycleControls,
  scopeBoundary,
  permissionDecision,
  validationSummary,
  admissionPreview,
  clientWorkflow,
  routePreviewAcceptance,
  nextSteps,
  exitContract,
  now
}) {
  const prior = normalizeReportingState(input);
  const counters = { ...prior.counters };
  incrementCounter(counters, 'commands.total');
  incrementCounter(counters, `commands.${command.name}`);
  incrementCounter(counters, `decisions.${decision}`);
  incrementCounter(counters, `persistedStatus.${persistence.current.status}`);
  incrementCounter(counters, `persistedStatusCategory.${persistence.restartLedger.statusContract.category}`);
  incrementCounter(counters, `recoveryMode.${recovery.mode}`);
  incrementCounter(counters, `checkpointPhase.${persistence.checkpoint.phase}`);
  incrementCounter(counters, `persistenceWrite.${persistence.writePlan.operation}`);
  incrementCounter(counters, `operationalHealth.${operationalHealth.state}`);
  incrementCounter(counters, `operationalFailure.${operationalHealth.failure.state}`);

  if (admitted) {
    incrementCounter(counters, 'outcomes.admitted');
  } else {
    incrementCounter(counters, 'outcomes.held');
  }

  if (command.name === 'cancel-admission') {
    incrementCounter(counters, 'outcomes.cancelled');
  }

  if (operationalHealth.retryable) {
    incrementCounter(counters, 'runtime.retryScheduled');
  }

  if (operationalHealth.degradedMode) {
    incrementCounter(counters, 'runtime.degradedAdmissions');
  }

  if (operationalHealth.blocked) {
    incrementCounter(counters, 'runtime.healthBlocked');
  }

  if (operationalHealth.failure.incidentCount > 0) {
    incrementCounter(counters, 'runtime.healthIncidents', operationalHealth.failure.incidentCount);
  }

  if (operationalHealth.failure.criticalIncidentCount > 0) {
    incrementCounter(counters, 'runtime.criticalHealthIncidents', operationalHealth.failure.criticalIncidentCount);
  }

  if (!permissionDecision.allowed) {
    incrementCounter(counters, 'denials.permission');
  }

  if (missingCapabilities.length > 0) {
    incrementCounter(counters, 'denials.capability');
  }

  if (missingProviderCapabilities.length > 0) {
    incrementCounter(counters, 'denials.providerCapability');
  }

  if (providerNegotiation.serviceContract.violationCount > 0) {
    incrementCounter(counters, 'denials.providerServiceContract', providerNegotiation.serviceContract.violationCount);
  }

  if (providerNegotiation.serviceContract.warningCount > 0) {
    incrementCounter(counters, 'warnings.providerServiceContract', providerNegotiation.serviceContract.warningCount);
  }

  if (persistence.productHandoff?.product === 'mailchimp') {
    incrementCounter(counters, 'productHandoff.mailchimp.total');
    incrementCounter(counters, `productHandoff.mailchimp.${persistence.productHandoff.state}`);
    incrementCounter(counters, `productHandoff.mailchimp.acceptance.${persistence.productHandoff.acceptance?.status || 'unknown'}`);

    if (persistence.productHandoff.ready) {
      incrementCounter(counters, 'productHandoff.mailchimp.ready');
    }

    if (persistence.productHandoff.acceptance?.exportReady) {
      incrementCounter(counters, 'productHandoff.mailchimp.exportReady');
    }

    if (persistence.productHandoff.boundary?.defaultedScope) {
      incrementCounter(counters, 'productHandoff.mailchimp.defaultedScope');
    }

    if (!persistence.productHandoff.boundary?.routePartitionAccepted) {
      incrementCounter(counters, 'productHandoff.mailchimp.routePartitionBlocked');
    }

    if (!persistence.productHandoff.boundary?.scopeCursorPresent) {
      incrementCounter(counters, 'productHandoff.mailchimp.scopeCursorMissing');
    }

    if (persistence.productHandoff.blockedBy.length > 0) {
      incrementCounter(counters, 'productHandoff.mailchimp.blockers', persistence.productHandoff.blockedBy.length);
    }
  }

  if (clientRuntimeAdoption.violationCount > 0) {
    incrementCounter(counters, 'denials.clientRuntimeAdoption', clientRuntimeAdoption.violationCount);
  }

  if (clientRuntimeAdoption.warningCount > 0) {
    incrementCounter(counters, 'warnings.clientRuntimeAdoption', clientRuntimeAdoption.warningCount);
  }

  if (admissionPolicy.violationCount > 0) {
    incrementCounter(counters, admissionPolicy.enforced ? 'denials.policy' : 'warnings.policy', admissionPolicy.violationCount);
  }

  if (externalHandoff.state === 'ready') {
    incrementCounter(counters, 'handoff.ready');
  } else if (externalHandoff.state === 'queued') {
    incrementCounter(counters, 'handoff.queued');
  } else if (externalHandoff.state === 'blocked') {
    incrementCounter(counters, 'handoff.blocked');
  }

  if (persistence.idempotency.replay) {
    incrementCounter(counters, 'idempotency.replays');
    incrementCounter(counters, `idempotencyReplay.${persistence.idempotency.replayBasis || 'unknown'}`);
  }

  if (!persistence.restartLedger.statusContract.known) {
    incrementCounter(counters, 'persistence.unknownPersistedStatus');
  }

  if (persistence.restartCommands.resume) {
    incrementCounter(counters, `restartCommand.${persistence.restartCommands.resume.commandName}`);
  }

  if (persistence.restartCommands.cancel) {
    incrementCounter(counters, 'restartCommand.cancel-admission');
  }

  incrementCounter(counters, `preview.${admissionPreview.status}`);
  incrementCounter(counters, `previewAcceptance.${routePreviewAcceptance.readyState}`);
  incrementCounter(counters, `readiness.${validationSummary.ready ? 'ready' : 'notReady'}`);
  incrementCounter(counters, `clientRuntimeAdoption.${clientRuntimeAdoption.state}`);
  incrementCounter(counters, `clientWorkflow.${clientWorkflow.state}`);
  incrementCounter(counters, `clientWorkflowLane.${clientWorkflow.lane}`);
  incrementCounter(counters, `nextRequiredAction.${nextSteps.nextRequiredAction}`);
  incrementCounter(counters, `lifecycleControls.${lifecycleControls.state}`);
  incrementCounter(counters, `lifecycleScheduling.${lifecycleControls.schedulingMode}`);
  incrementCounter(counters, `scopeBoundary.${scopeBoundary.mode}`);
  incrementCounter(counters, `scopeBoundaryAllowed.${scopeBoundary.allowed ? 'allowed' : 'blocked'}`);
  incrementCounter(counters, `scopeTenantSource.${scope.tenantSource}`);
  incrementCounter(counters, `scopeWorkspaceSource.${scope.workspaceSource}`);
  incrementCounter(counters, `scopeDefaulted.${scope.scopeSource.defaulted ? 'defaulted' : 'explicit'}`);
  incrementCounter(counters, `actorEffectiveRole.${actor.effectiveRole}`);
  incrementCounter(counters, `actorPermissionGrant.active.${actor.activePermissionGrants.length}`);
  incrementCounter(counters, `actorPermissionGrant.rejected.${actor.rejectedPermissionCount}`);
  incrementCounter(counters, `objectiveOrigin.${objective.origin}`);
  incrementCounter(counters, `objectivePresent.${objective.present && !objective.empty ? 'present' : 'missing'}`);
  incrementCounter(counters, `ownerBinding.${ownerBinding.actorCanBind ? 'authorized' : 'blocked'}`);
  incrementCounter(counters, `requiredEvidence.${objective.requiredEvidenceSatisfied ? 'satisfied' : 'missing'}`);
  incrementCounter(counters, `actionableErrorPrimary.${errorTriage.primary?.source || 'none'}`);
  incrementCounter(counters, `exitContract.${exitContract.state}`);
  incrementCounter(counters, `exitContractOwner.${exitContract.owner}`);

  if (!lifecycleControls.enabled) {
    incrementCounter(counters, 'lifecycleControls.disabled');
  }

  if (lifecycleControls.scheduled) {
    incrementCounter(counters, 'lifecycleControls.scheduled');
  }

  if (!scopeBoundary.allowed) {
    incrementCounter(counters, 'denials.scopeBoundary', scopeBoundary.violationCount);
  }

  if (scope.scopeSource.defaulted) {
    incrementCounter(counters, 'warnings.scopeDefaulted');
  }

  if (!actor.roleKnown) {
    incrementCounter(counters, 'warnings.actorRoleFallback');
  }

  if (actor.rejectedPermissionCount > 0) {
    incrementCounter(counters, 'denials.actorPermissionGrantScope', actor.rejectedPermissionCount);
  }

  if (permissionDecision.grantScope.rejectedRequiredGrantCount > 0) {
    incrementCounter(counters, 'denials.requiredPermissionGrantScope', permissionDecision.grantScope.rejectedRequiredGrantCount);
  }

  if (scopeBoundary.warningCount > 0) {
    incrementCounter(counters, 'warnings.scopeBoundary', scopeBoundary.warningCount);
  }

  const scopeViolationCount = violations.filter((violation) => (
    violation.code.includes('tenant') || violation.code.includes('workspace') || violation.code.includes('scope')
  )).length;
  if (scopeViolationCount > 0) {
    incrementCounter(counters, 'denials.scope', scopeViolationCount);
  }

  if (errorTriage.blockingCount > 0) {
    incrementCounter(counters, 'actionableErrors.blocking', errorTriage.blockingCount);
  }

  if (errorTriage.retryableCount > 0) {
    incrementCounter(counters, 'actionableErrors.retryable', errorTriage.retryableCount);
  }

  if (exitContract.terminal) {
    incrementCounter(counters, 'exitContract.terminal');
  }

  if (exitContract.failed) {
    incrementCounter(counters, 'exitContract.failed');
  }

  for (const [source, count] of Object.entries(errorTriage.groupedCounts)) {
    incrementCounter(counters, `actionableErrorSource.${source}`, count);
  }

  const snapshot = {
    snapshotId: `${command.commandId}:${persistence.current.status}`,
    at: now,
    requestId,
    commandId: command.commandId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    status: decision,
    persistedStatus: persistence.current.status,
    recoveryMode: recovery.mode,
    persistenceWriteOperation: persistence.writePlan.operation,
    persistenceWriteRevision: persistence.current.writeRevision,
    journalSequence: persistence.current.journalSequence,
    persistedStatusKnown: persistence.restartLedger.statusContract.known,
    persistedStatusCategory: persistence.restartLedger.statusContract.category,
    persistedStatusRecoveryAction: persistence.restartLedger.statusContract.recoveryAction,
    checkpointPhase: persistence.checkpoint.phase,
    checkpointNextCommand: persistence.checkpoint.nextCommandName,
    mailchimpHandoffState: persistence.productHandoff?.product === 'mailchimp' ? persistence.productHandoff.state : null,
    mailchimpHandoffReady: persistence.productHandoff?.product === 'mailchimp' ? persistence.productHandoff.ready : false,
    mailchimpHandoffAccepted: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.acceptance?.accepted === true
      : false,
    mailchimpHandoffExportReady: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.acceptance?.exportReady === true
      : false,
    mailchimpBoundaryProofId: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.boundary?.proofId || null
      : null,
    mailchimpBlockedBy: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.blockedBy
      : [],
    operationalHealthState: operationalHealth.state,
    operationalFailureState: operationalHealth.failure.state,
    handoffTarget,
    externalHandoffState: externalHandoff.state,
    previewStatus: admissionPreview.status,
    previewAcceptanceReadyState: routePreviewAcceptance.readyState,
    previewAcceptancePrimaryAction: routePreviewAcceptance.display.primaryAction,
    previewAcceptanceRouteTarget: routePreviewAcceptance.routeConsumption.target,
    readinessReady: validationSummary.ready,
    clientRuntimeAdoptionState: clientRuntimeAdoption.state,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction,
    clientWorkflowState: clientWorkflow.state,
    clientWorkflowLane: clientWorkflow.lane,
    nextRequiredAction: nextSteps.nextRequiredAction,
    lifecycleControlState: lifecycleControls.state,
    lifecycleSchedulingMode: lifecycleControls.schedulingMode,
    lifecycleControlNextAction: lifecycleControls.nextAction,
    scopeBoundaryMode: scopeBoundary.mode,
    scopeBoundaryAllowed: scopeBoundary.allowed,
    scopeBoundaryViolationCount: scopeBoundary.violationCount,
    scopeBoundaryProofId: scopeBoundary.proof.proofId,
    scopeTenantSource: scope.tenantSource,
    scopeWorkspaceSource: scope.workspaceSource,
    scopeDefaulted: scope.scopeSource.defaulted,
    actorEffectiveRole: actor.effectiveRole,
    actorRoleKnown: actor.roleKnown,
    actorActivePermissionGrantCount: actor.activePermissionGrants.length,
    actorRejectedPermissionGrantCount: actor.rejectedPermissionCount,
    actorRejectedRequiredGrantCount: permissionDecision.grantScope.rejectedRequiredGrantCount,
    objectiveOrigin: objective.origin,
    objectivePresent: objective.present && !objective.empty,
    requiredEvidenceSatisfied: objective.requiredEvidenceSatisfied,
    missingRequiredEvidenceCount: objective.requiredEvidence.missingCount,
    ownerBindingAuthorized: ownerBinding.actorCanBind,
    intakeEvidenceProofId: lifecycleEvidenceRefs.proof.proofId,
    admitted,
    retryAfterMs: operationalHealth.retryAfterMs,
    violationCount: violations.length,
    actionableErrorCount: actionableErrors.length,
    actionableErrorTriageCount: errorTriage.totalCount,
    actionableErrorBlockingCount: errorTriage.blockingCount,
    actionableErrorRetryableCount: errorTriage.retryableCount,
    actionableErrorPrimarySource: errorTriage.primary?.source || null,
    actionableErrorPrimaryAction: errorTriage.primary?.action || null,
    exitContractState: exitContract.state,
    exitContractOwner: exitContract.owner,
    exitContractNextAction: exitContract.nextAction,
    exitContractTerminal: exitContract.terminal,
    exitContractFailed: exitContract.failed,
    exitContractProofId: exitContract.proof.proofId
  };
  const history = [...prior.history, snapshot].slice(-REPORT_HISTORY_LIMIT);
  const historySummary = buildReportHistorySummary(history);
  const timeline = [
    {
      at: command.issuedAt,
      type: 'command-issued',
      status: command.name,
      actorId: actor.actorId
    },
    {
      at: now,
      type: 'decision-derived',
      status: decision,
      admitted,
      violationCount: violations.length
    },
    {
      at: persistence.current.updatedAt,
      type: 'persistence-shaped',
      status: persistence.current.status,
      checkpointPhase: persistence.checkpoint.phase,
      nextCommandName: persistence.checkpoint.nextCommandName,
      recoveryMode: recovery.mode,
      replay: persistence.idempotency.replay
    },
    ...(persistence.productHandoff?.product === 'mailchimp'
      ? [{
        at: persistence.productHandoff.persistedAt,
        type: 'mailchimp-product-handoff-shaped',
        status: persistence.productHandoff.state,
        ready: persistence.productHandoff.ready,
        accepted: persistence.productHandoff.acceptance?.accepted === true,
        exportReady: persistence.productHandoff.acceptance?.exportReady === true,
        handoffId: persistence.productHandoff.handoffId,
        providerId: persistence.productHandoff.providerId,
        audienceId: persistence.productHandoff.audienceId,
        campaignId: persistence.productHandoff.campaignId,
        boundaryProofId: persistence.productHandoff.boundary?.proofId || null,
        blockedBy: persistence.productHandoff.blockedBy
      }]
      : []),
    {
      at: now,
      type: 'handoff-targeted',
      status: handoffTarget,
      retryAfterMs: operationalHealth.retryAfterMs
    },
    {
      at: externalHandoff.preparedAt,
      type: 'external-handoff-state-shaped',
      status: externalHandoff.state,
      providerId: externalHandoff.providerId,
      syncGeneration: externalHandoff.sync.generation
    },
    {
      at: now,
      type: 'client-preview-shaped',
      status: admissionPreview.status,
      nextRequiredAction: nextSteps.nextRequiredAction,
      readyForSpawn: admissionPreview.readyForSpawn
    },
    {
      at: routePreviewAcceptance.generatedAt,
      type: 'route-preview-acceptance-shaped',
      status: routePreviewAcceptance.readyState,
      routeTarget: routePreviewAcceptance.routeConsumption.target,
      primaryAction: routePreviewAcceptance.display.primaryAction,
      primaryOwner: routePreviewAcceptance.display.primaryOwner,
      blockingGroupCount: routePreviewAcceptance.display.blockingGroupCount,
      retryableGroupCount: routePreviewAcceptance.display.retryableGroupCount
    },
    {
      at: clientRuntimeAdoption.workflow.generatedAt,
      type: 'client-runtime-adoption-shaped',
      status: clientRuntimeAdoption.state,
      target: clientRuntimeAdoption.workflow.target,
      nextAction: clientRuntimeAdoption.workflow.nextAction,
      handoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
      violationCount: clientRuntimeAdoption.violationCount,
      warningCount: clientRuntimeAdoption.warningCount
    },
    {
      at: now,
      type: 'client-workflow-handoff-shaped',
      status: clientWorkflow.state,
      lane: clientWorkflow.lane,
      primaryAction: clientWorkflow.primaryAction
    },
    {
      at: now,
      type: 'lifecycle-controls-evaluated',
      status: lifecycleControls.state,
      schedulingMode: lifecycleControls.schedulingMode,
      nextAction: lifecycleControls.nextAction,
      scheduled: lifecycleControls.scheduled
    },
    {
      at: scopeBoundary.audit.evaluatedAt,
      type: 'scope-boundary-evaluated',
      status: scopeBoundary.allowed ? 'allowed' : 'blocked',
      mode: scopeBoundary.mode,
      violationCount: scopeBoundary.violationCount,
      compartmentKey: scopeBoundary.compartmentKey
    },
    {
      at: errorTriage.generatedAt,
      type: 'actionable-error-triage-shaped',
      status: errorTriage.blockingCount > 0 ? 'blocking' : (errorTriage.retryableCount > 0 ? 'retryable' : 'clear'),
      primarySource: errorTriage.primary?.source || null,
      primaryAction: errorTriage.primary?.action || null,
      blockingCount: errorTriage.blockingCount,
      retryableCount: errorTriage.retryableCount
    },
    {
      at: now,
      type: 'process-exit-contract-shaped',
      status: exitContract.state,
      owner: exitContract.owner,
      nextAction: exitContract.nextAction,
      terminal: exitContract.terminal,
      failed: exitContract.failed,
      proofId: exitContract.proof.proofId
    },
    {
      at: now,
      type: 'report-history-summarized',
      status: historySummary.retainedCount >= REPORT_HISTORY_LIMIT ? 'retained-window-full' : 'retained-window-open',
      retainedCount: historySummary.retainedCount,
      retainedLimit: historySummary.retainedLimit,
      firstSnapshotAt: historySummary.firstSnapshotAt,
      lastSnapshotAt: historySummary.lastSnapshotAt,
      latestWriteRevision: historySummary.latestWriteRevision,
      latestJournalSequence: historySummary.latestJournalSequence
    }
  ];
  incrementCounter(counters, 'analytics.historyWindowsBuilt');
  incrementCounter(counters, 'analytics.historySnapshotsObserved', historySummary.retainedCount);
  incrementCounter(counters, 'analytics.timelineEventsObserved', timeline.length);
  incrementCounter(counters, `analytics.historyWindow.${historySummary.retainedCount >= REPORT_HISTORY_LIMIT ? 'full' : 'open'}`);
  incrementCounter(counters, `analytics.exportDecision.${decision}`);
  incrementCounter(counters, `analytics.exportPersistedStatus.${persistence.current.status}`);
  incrementCounter(counters, 'exports.ready');

  if (historySummary.scopeBoundaryBlockedCount > 0) {
    incrementCounter(counters, 'analytics.historyScopeBoundaryBlocks', historySummary.scopeBoundaryBlockedCount);
  }

  if (historySummary.blockedErrorCount > 0) {
    incrementCounter(counters, 'analytics.historyBlockingErrors', historySummary.blockedErrorCount);
  }

    if (historySummary.retryScheduledCount > 0) {
    incrementCounter(counters, 'analytics.historyRetrySchedules', historySummary.retryScheduledCount);
  }

  if (historySummary.failedExitContractCount > 0) {
    incrementCounter(counters, 'analytics.historyFailedExitContracts', historySummary.failedExitContractCount);
  }

  const reportId = `${surfaceId}:${scope.tenantId}:${scope.workspaceId}:${requestId}:${command.commandId}`;
  const mailchimpExport = buildMailchimpAdmissionExport({
    reportId,
    requestId,
    command,
    scope,
    persistence,
    historySummary,
    timeline,
    now
  });
  incrementCounter(counters, `exports.mailchimp.${mailchimpExport.state}`);
  incrementCounter(counters, `exports.mailchimp.disposition.${mailchimpExport.disposition}`);

  if (mailchimpExport.ready) {
    incrementCounter(counters, 'exports.mailchimp.ready');
  }

  if (mailchimpExport.blockedBy.length > 0) {
    incrementCounter(counters, 'exports.mailchimp.blockers', mailchimpExport.blockedBy.length);
  }

  const exportRecord = {
    surfaceId,
    reportId,
    generatedAt: now,
    requestId,
    commandName: command.name,
    commandId: command.commandId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorRole: actor.role,
    clientState,
    runtimeMode,
    priority,
    decision,
    admitted,
    persistedStatus: persistence.current.status,
    persistedStatusKnown: persistence.restartLedger.statusContract.known,
    persistedStatusCategory: persistence.restartLedger.statusContract.category,
    persistedStatusRecoveryAction: persistence.restartLedger.statusContract.recoveryAction,
    checkpointPhase: persistence.checkpoint.phase,
    checkpointNextCommand: persistence.checkpoint.nextCommandName,
    checkpointRestartSafe: persistence.checkpoint.restartSafe,
    persistenceWriteOperation: persistence.writePlan.operation,
    persistenceWriteRevision: persistence.current.writeRevision,
    journalSequence: persistence.current.journalSequence,
    durableBeforeHandoff: persistence.writePlan.durableBeforeHandoff,
    recoveryMode: recovery.mode,
    recoveryReplayBasis: recovery.replayBasis,
    handoffTarget,
    operationalHealthState: operationalHealth.state,
    operationalFailureState: operationalHealth.failure.state,
    operationalFailureIncidentCount: operationalHealth.failure.incidentCount,
    operationalFailurePrimaryAction: operationalHealth.failure.primaryAction,
    operationalFailurePrimaryOwner: operationalHealth.failure.primaryOwner,
    retryBudgetRemaining: operationalHealth.failure.retryBudgetRemaining,
    healthState: health.state,
    retryable: operationalHealth.retryable,
    retryAfterMs: operationalHealth.retryAfterMs,
    violationCount: violations.length,
    actionableErrorCount: actionableErrors.length,
    actionableErrorTriageCount: errorTriage.totalCount,
    actionableErrorBlockingCount: errorTriage.blockingCount,
    actionableErrorRetryableCount: errorTriage.retryableCount,
    actionableErrorPrimarySource: errorTriage.primary?.source || null,
    actionableErrorPrimaryAction: errorTriage.primary?.action || null,
    actionableErrorNextRetryAfterMs: errorTriage.nextRetry?.retryAfterMs || null,
    missingCapabilityCount: missingCapabilities.length,
    missingProviderCapabilityCount: missingProviderCapabilities.length,
    policyViolationCount: admissionPolicy.violationCount,
    policyMode: admissionPolicy.mode,
    policyId: admissionPolicy.policyId,
    missingPermissionCount: permissionDecision.missing.length,
    providerId: providerNegotiation.providerId,
    providerProtocol: providerNegotiation.protocol,
    providerServiceContractId: providerNegotiation.serviceContract.contractId,
    providerServiceContractVersion: providerNegotiation.serviceContract.contractVersion,
    providerConsistencyMode: providerNegotiation.serviceContract.consistencyMode,
    providerSyncFreshnessState: providerNegotiation.syncMetadata.freshness.state,
    providerSyncFreshnessAgeMs: providerNegotiation.syncMetadata.freshness.ageMs,
    providerRoutePartition: providerNegotiation.routing.routePartition,
    providerDeclaredRoutePartition: providerNegotiation.routing.declaredRoutePartition,
    providerRoutePartitionAllowed: providerNegotiation.routing.allowedRoutePartition,
    providerScopedSyncCursorRequired: providerNegotiation.routing.requireScopedSyncCursor,
    providerScopedSyncCursorPresent: Boolean(providerNegotiation.syncMetadata.scopeCursor),
    providerServiceContractViolationCount: providerNegotiation.serviceContract.violationCount,
    providerServiceContractWarningCount: providerNegotiation.serviceContract.warningCount,
    providerHandoffAckMode: providerNegotiation.serviceContract.handoffAckMode,
    providerHandoffAckRequired: providerNegotiation.serviceContract.handoffAckMode !== 'none',
    providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
    mailchimpHandoffPresent: persistence.productHandoff?.product === 'mailchimp',
    mailchimpHandoffState: persistence.productHandoff?.product === 'mailchimp' ? persistence.productHandoff.state : null,
    mailchimpHandoffReady: persistence.productHandoff?.product === 'mailchimp' ? persistence.productHandoff.ready : false,
    mailchimpHandoffAccepted: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.acceptance?.accepted === true
      : false,
    mailchimpHandoffExportReady: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.acceptance?.exportReady === true
      : false,
    mailchimpHandoffId: persistence.productHandoff?.product === 'mailchimp' ? persistence.productHandoff.handoffId : null,
    mailchimpExportBatchId: mailchimpExport.batchId,
    mailchimpExportState: mailchimpExport.state,
    mailchimpExportDisposition: mailchimpExport.disposition,
    mailchimpExportReadyRowCount: mailchimpExport.readyRowCount,
    mailchimpExportBlockedBy: mailchimpExport.blockedBy,
    mailchimpExportWatermark: mailchimpExport.manifest.watermark,
    mailchimpBoundaryProofId: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.boundary?.proofId || null
      : null,
    mailchimpBoundaryDefaultedScope: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.boundary?.defaultedScope === true
      : false,
    mailchimpBoundaryRoutePartitionAccepted: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.boundary?.routePartitionAccepted === true
      : false,
    mailchimpBoundaryScopeCursorPresent: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.boundary?.scopeCursorPresent === true
      : false,
    mailchimpBlockedBy: persistence.productHandoff?.product === 'mailchimp'
      ? persistence.productHandoff.blockedBy
      : [],
    externalHandoffState: externalHandoff.state,
    externalHandoffAckState: externalHandoff.acknowledgement.state,
    previewStatus: admissionPreview.status,
    previewPrimaryAction: admissionPreview.primaryAction,
    previewAcceptanceReadyState: routePreviewAcceptance.readyState,
    previewAcceptanceRouteTarget: routePreviewAcceptance.routeConsumption.target,
    previewAcceptancePrimaryOwner: routePreviewAcceptance.display.primaryOwner,
    previewAcceptanceNextAction: routePreviewAcceptance.nextStep.action,
    clientRuntimeAdoptionState: clientRuntimeAdoption.state,
    clientRuntimeAdoptionRequired: clientRuntimeAdoption.required,
    clientRuntimeAdoptionHandoffEnabled: clientRuntimeAdoption.handoffEnabled,
    clientRuntimeAdoptionViolationCount: clientRuntimeAdoption.violationCount,
    clientRuntimeAdoptionWarningCount: clientRuntimeAdoption.warningCount,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction,
    clientRuntimeAdoptionTarget: clientRuntimeAdoption.workflow.target,
    clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
    clientRuntimeObservedMode: clientRuntimeAdoption.observedRuntimeMode,
    clientRuntimeAcceptedProtocol: clientRuntimeAdoption.acceptedProtocol,
    clientRuntimeSyncGeneration: clientRuntimeAdoption.sync.clientGeneration,
    clientRuntimeSyncCurrent: clientRuntimeAdoption.sync.current,
    clientWorkflowState: clientWorkflow.state,
    clientWorkflowLane: clientWorkflow.lane,
    clientWorkflowPrimaryAction: clientWorkflow.primaryAction,
    clientWorkflowResumeCommand: clientWorkflow.commands.resume?.commandName || null,
    clientWorkflowCancelCommand: clientWorkflow.commands.cancel?.commandName || null,
    restartResumeCommand: persistence.restartCommands.resume?.commandName || null,
    restartCancelCommand: persistence.restartCommands.cancel?.commandName || null,
    readinessReady: validationSummary.ready,
    validationBlockingGroupCount: validationSummary.blockingGroupCount,
    validationRetryableGroupCount: validationSummary.retryableGroupCount,
    nextRequiredAction: nextSteps.nextRequiredAction,
    nextStepCount: nextSteps.count,
    lifecycleControlState: lifecycleControls.state,
    lifecycleControlEnabled: lifecycleControls.enabled,
    lifecycleSettingsRevision: lifecycleControls.settingsRevision,
    lifecycleSettingCommandName: lifecycleControls.settingCommand.name,
    lifecycleSettingCommandCanApply: lifecycleControls.settingCommand.canApply,
    lifecycleSchedulingWindowState: lifecycleControls.schedulingWindow.state,
    lifecycleCommandEnabled: lifecycleControls.commandEnabled,
    lifecycleSchedulingMode: lifecycleControls.schedulingMode,
    lifecycleScheduled: lifecycleControls.scheduled,
    lifecycleControlNextAction: lifecycleControls.nextAction,
    lifecycleControlProofId: lifecycleControls.proof.proofId,
    scopeBoundaryPolicyId: scopeBoundary.policyId,
    scopeBoundaryMode: scopeBoundary.mode,
    scopeBoundaryAllowed: scopeBoundary.allowed,
    scopeBoundaryViolationCount: scopeBoundary.violationCount,
    scopeBoundaryWarningCount: scopeBoundary.warningCount,
    scopeBoundaryCompartmentKey: scopeBoundary.compartmentKey,
    scopeBoundaryProofId: scopeBoundary.proof.proofId,
    scopeBoundaryAuditProofRef: scopeBoundary.audit.handoff.proofRef,
    scopeTenantSource: scope.tenantSource,
    scopeWorkspaceSource: scope.workspaceSource,
    scopeDefaulted: scope.scopeSource.defaulted,
    actorRequestedRole: actor.requestedRole,
    actorEffectiveRole: actor.effectiveRole,
    actorRoleKnown: actor.roleKnown,
    actorActivePermissionGrantCount: actor.activePermissionGrants.length,
    actorRejectedPermissionGrantCount: actor.rejectedPermissionCount,
    actorRejectedRequiredGrantCount: permissionDecision.grantScope.rejectedRequiredGrantCount,
    objectiveKey: objective.objectiveKey,
    objectiveOrigin: objective.origin,
    objectivePresent: objective.present && !objective.empty,
    requiredEvidenceSatisfied: objective.requiredEvidenceSatisfied,
    missingRequiredEvidenceCount: objective.requiredEvidence.missingCount,
    processOwnerId: ownerBinding.ownerId,
    processOwnerBindingId: ownerBinding.bindingId,
    processOwnerBindingAuthorized: ownerBinding.actorCanBind,
    intakeEvidenceProofId: lifecycleEvidenceRefs.proof.proofId,
    exitContractId: exitContract.contractId,
    exitContractState: exitContract.state,
    exitContractOwner: exitContract.owner,
    exitContractNextAction: exitContract.nextAction,
    exitContractTerminal: exitContract.terminal,
    exitContractFailed: exitContract.failed,
    exitContractProofId: exitContract.proof.proofId,
    observedExitPresent: exitContract.observedExit.present,
    observedExitCode: exitContract.observedExit.exitCode,
    observedExitSignal: exitContract.observedExit.signal,
    syncGeneration: providerNegotiation.syncMetadata.generation,
    idempotentReplay: persistence.idempotency.replay,
    retainedHistoryCount: historySummary.retainedCount,
    retainedHistoryLimit: historySummary.retainedLimit,
    retainedHistoryFirstSnapshotAt: historySummary.firstSnapshotAt,
    retainedHistoryLastSnapshotAt: historySummary.lastSnapshotAt,
    retainedHistoryAdmittedCount: historySummary.admittedCount,
    retainedHistoryHeldCount: historySummary.heldCount,
    retainedHistoryUnknownPersistedStatusCount: historySummary.unknownPersistedStatusCount,
    retainedHistoryRetryScheduledCount: historySummary.retryScheduledCount,
    retainedHistoryBlockedErrorCount: historySummary.blockedErrorCount,
    retainedHistoryRetryableErrorCount: historySummary.retryableErrorCount,
    retainedHistoryScopeBoundaryBlockedCount: historySummary.scopeBoundaryBlockedCount,
    retainedHistoryMailchimpReadyCount: historySummary.mailchimpReadyCount,
    retainedHistoryMailchimpAcceptedCount: historySummary.mailchimpAcceptedCount,
    retainedHistoryMailchimpExportReadyCount: historySummary.mailchimpExportReadyCount,
    retainedHistoryMailchimpBlockedCount: historySummary.mailchimpBlockedCount,
    retainedHistoryLatestWriteRevision: historySummary.latestWriteRevision,
    retainedHistoryLatestJournalSequence: historySummary.latestJournalSequence,
    timelineEventCount: timeline.length,
    counterKeyCount: Object.keys(counters).length
  };
  const exportProof = buildExportProof({
    reportId,
    exportRecord,
    historySummary,
    timeline
  });

  return {
    schemaVersion: 1,
    reportId,
    lastReportId: prior.lastReportId,
    counters,
    currentSnapshot: snapshot,
    history,
    historySummary,
    timeline,
    mailchimpExport,
    export: {
      format: 'process-admission-summary.v1',
      exportedAt: prior.exportedAt,
      ready: true,
      headers: Object.keys(exportRecord),
      record: exportRecord,
      summary: historySummary,
      proof: exportProof,
      productBatches: {
        mailchimp: mailchimpExport
      }
    }
  };
}

function normalizeOperationalHealth(input, now) {
  const runtime = asPlainObject(input.runtime);
  const health = asPlainObject(runtime.health || input.health || input.operationalHealth);
  const retry = asPlainObject(health.retry || runtime.retry || input.retry);
  const state = textOrDefault(health.state || health.status || runtime.healthState || input.healthState, 'healthy');
  const maxAgeMs = normalizeInteger(health.maxAgeMs ?? health.freshnessMaxAgeMs ?? runtime.healthMaxAgeMs, DEFAULT_HEALTH_MAX_AGE_MS);
  const dependencyMaxAgeMs = normalizeInteger(
    health.dependencyMaxAgeMs ?? runtime.dependencyHealthMaxAgeMs,
    DEFAULT_DEPENDENCY_MAX_AGE_MS
  );
  const dependencies = normalizeDependencyHealth(
    health.dependencies || runtime.dependencies || input.dependencies,
    now,
    dependencyMaxAgeMs
  );
  const attempt = normalizeInteger(retry.attempt ?? input.retryAttempt, 0);
  const maxAttempts = normalizeInteger(retry.maxAttempts ?? input.maxRetryAttempts, 3);
  const baseDelayMs = normalizeInteger(retry.baseDelayMs ?? input.retryBaseDelayMs, 1000);
  const cappedAttempt = Math.min(attempt, 6);
  const nextDelayMs = Math.min(30000, baseDelayMs * (2 ** cappedAttempt));

  return {
    state,
    reason: textOrDefault(health.reason || runtime.healthReason || input.healthReason, null),
    degradedModeAllowed: health.degradedModeAllowed === true
      || runtime.degradedModeAllowed === true
      || input.degradedModeAllowed === true,
    freshness: normalizeFreshness({
      observedAt: health.observedAt || health.checkedAt || health.updatedAt || runtime.healthObservedAt,
      now,
      maxAgeMs,
      missingState: 'not-reported'
    }),
    dependencies,
    retry: {
      attempt,
      maxAttempts,
      exhausted: attempt >= maxAttempts,
      nextDelayMs,
      strategy: 'exponential-backoff'
    }
  };
}

function normalizeProviderContract(input) {
  const runtime = asPlainObject(input.runtime);
  const provider = asPlainObject(input.provider || runtime.provider || runtime.hostedProvider);
  const service = asPlainObject(provider.service || input.serviceContract || runtime.serviceContract);
  const sync = asPlainObject(provider.sync || service.sync || input.sync);
  const handoff = asPlainObject(provider.handoff || service.handoff || input.externalHandoff);
  const routing = asPlainObject(provider.routing || service.routing || handoff.routing || input.providerRouting);
  const serviceLevel = asPlainObject(service.serviceLevel || provider.serviceLevel || input.serviceLevel);
  const mailchimp = asPlainObject(provider.mailchimp || service.mailchimp || input.mailchimp);
  const audience = asPlainObject(mailchimp.audience || mailchimp.list || service.audience || provider.audience);
  const campaign = asPlainObject(mailchimp.campaign || service.campaign || provider.campaign);
  const webhook = asPlainObject(mailchimp.webhook || handoff.webhook || service.webhook);
  const state = textOrDefault(provider.state || provider.status || service.state, 'ready');
  const endpoint = textOrDefault(
    provider.endpoint || service.endpoint || handoff.endpoint,
    'kernel.lifecycle.spawn'
  );
  const ackMode = textOrDefault(handoff.ackMode || service.ackMode, handoff.requireAck === true ? 'provider-ack' : 'none');
  const serviceKind = textOrDefault(service.kind || service.serviceKind || provider.serviceKind || provider.kind, 'hosted-kernel');
  const serviceName = textOrDefault(service.name || provider.serviceName, 'hosted-kernel-process-service');
  const mailchimpEnabled = serviceKind === 'mailchimp'
    || serviceName.toLowerCase().includes('mailchimp')
    || mailchimp.enabled === true;

  return {
    providerId: textOrDefault(provider.providerId || provider.id || service.providerId, 'hosted-kernel-provider'),
    serviceName,
    serviceKind,
    contractId: textOrDefault(service.contractId || provider.contractId, null),
    contractVersion: textOrDefault(service.version || provider.contractVersion, '1'),
    state,
    protocol: textOrDefault(service.protocol || provider.protocol, 'aios-kernel-handoff.v1'),
    endpoint,
    region: textOrDefault(provider.region || service.region || runtime.region, 'local'),
    capabilities: normalizeList(provider.capabilities || service.capabilities),
    requiredCapabilities: normalizeList(provider.requiredCapabilities || service.requiredCapabilities),
    consistencyMode: textOrDefault(service.consistencyMode || service.consistency || provider.consistencyMode, 'read-your-writes'),
    serviceLevel: {
      tier: textOrDefault(serviceLevel.tier || service.tier || provider.tier, 'standard'),
      owner: textOrDefault(serviceLevel.owner || service.owner || provider.owner, 'kernel.provider.router'),
      requireCurrentSync: serviceLevel.requireCurrentSync === true
        || service.requireCurrentSync === true
        || sync.requireCurrent === true,
      requireScopedSyncCursor: serviceLevel.requireScopedSyncCursor === true
        || service.requireScopedSyncCursor === true
        || sync.requireScopedCursor === true,
      maxHandoffLatencyMs: normalizeInteger(serviceLevel.maxHandoffLatencyMs ?? handoff.maxLatencyMs, 5000)
    },
    sync: {
      cursor: textOrDefault(sync.cursor || sync.syncCursor, null),
      scopeCursor: textOrDefault(sync.scopeCursor || sync.partitionCursor, null),
      routePartition: textOrDefault(sync.routePartition || sync.partitionKey || routing.partitionKey, null),
      generation: normalizeInteger(sync.generation, 0),
      lastSyncedAt: textOrDefault(sync.lastSyncedAt || sync.updatedAt, null),
      leaseId: textOrDefault(sync.leaseId, null),
      maxAgeMs: normalizeInteger(sync.maxAgeMs ?? sync.freshnessMaxAgeMs, DEFAULT_PROVIDER_SYNC_MAX_AGE_MS)
    },
    routing: {
      routePartition: textOrDefault(routing.routePartition || routing.partitionKey || sync.routePartition, null),
      allowedTenantIds: normalizeList(routing.allowedTenantIds || service.allowedTenantIds || provider.allowedTenantIds),
      allowedWorkspaceIds: normalizeList(routing.allowedWorkspaceIds || service.allowedWorkspaceIds || provider.allowedWorkspaceIds),
      allowedRoutePartitions: normalizeList(routing.allowedRoutePartitions || routing.routePartitions),
      requireDeclaredRoutePartition: routing.requireDeclaredRoutePartition === true
        || service.requireDeclaredRoutePartition === true
        || handoff.requireRoutePartition === true
    },
    handoff: {
      channel: textOrDefault(handoff.channel, endpoint),
      externalId: textOrDefault(handoff.externalId || handoff.handoffId, null),
      expiresAt: textOrDefault(handoff.expiresAt, null),
      ackMode,
      ackEndpoint: textOrDefault(handoff.ackEndpoint || service.ackEndpoint, null),
      ackDeadlineMs: normalizeInteger(handoff.ackDeadlineMs ?? service.ackDeadlineMs, 10000)
    },
    mailchimp: {
      enabled: mailchimpEnabled,
      audienceId: textOrDefault(mailchimp.audienceId || mailchimp.listId || audience.audienceId || audience.id, null),
      campaignId: textOrDefault(mailchimp.campaignId || campaign.campaignId || campaign.id, null),
      datacenter: textOrDefault(mailchimp.datacenter || mailchimp.dc || service.datacenter, null),
      webhookId: textOrDefault(webhook.webhookId || webhook.id || mailchimp.webhookId, null),
      webhookEndpoint: textOrDefault(webhook.endpoint || webhook.url || handoff.endpoint, null),
      webhookSigningKeyRef: textOrDefault(webhook.signingKeyRef || webhook.secretRef || mailchimp.signingKeyRef, null),
      suppressUnsubscribedContacts: mailchimp.suppressUnsubscribedContacts !== false,
      requiredCapabilities: normalizeList(mailchimp.requiredCapabilities).length > 0
        ? normalizeList(mailchimp.requiredCapabilities)
        : MAILCHIMP_PROVIDER_CAPABILITIES,
      mergeFieldMappings: normalizeList(mailchimp.mergeFieldMappings || mailchimp.mergeFields),
      externalHandoffRef: textOrDefault(
        mailchimp.externalHandoffRef || webhook.externalRef || handoff.externalId || handoff.handoffId,
        null
      )
    }
  };
}

function normalizeAdmissionPolicy(input) {
  const runtime = asPlainObject(input.runtime);
  const policy = asPlainObject(input.admissionPolicy || runtime.admissionPolicy || input.policy);
  const limits = asPlainObject(policy.limits || input.admissionLimits);
  const usage = asPlainObject(policy.usage || runtime.usage || input.usage);
  const mode = textOrDefault(policy.mode || input.policyMode, 'enforce');

  return {
    policyId: textOrDefault(policy.policyId || policy.id, 'hosted-kernel-default-admission-policy'),
    mode,
    requireHostedKernel: policy.requireHostedKernel !== false,
    allowDegradedSpawn: policy.allowDegradedSpawn === true,
    requireProviderLease: policy.requireProviderLease === true,
    limits: {
      maxConcurrentPerTenant: normalizeInteger(limits.maxConcurrentPerTenant, 25),
      maxQueueDepth: normalizeInteger(limits.maxQueueDepth, 100),
      maxRetryAttempt: normalizeInteger(limits.maxRetryAttempt, 3)
    },
    usage: {
      concurrentForTenant: normalizeInteger(usage.concurrentForTenant ?? usage.concurrent, 0),
      queueDepth: normalizeInteger(usage.queueDepth, 0),
      retryAttempt: normalizeInteger(usage.retryAttempt ?? usage.attempt, 0)
    }
  };
}

function normalizeLifecycleSettingCommand(value) {
  if (typeof value === 'string') {
    return {
      name: value.trim() || null,
      commandId: null,
      requestedState: LIFECYCLE_SETTING_COMMAND_TARGET_STATE[value.trim()] || null,
      reason: null,
      issuedAt: null,
      force: false,
      scheduling: null
    };
  }

  const command = asPlainObject(value);
  const name = textOrDefault(command.name || command.commandName || command.action, null);
  const scheduling = asPlainObject(command.scheduling || command.schedule);

  return {
    name,
    commandId: textOrDefault(command.commandId || command.id, null),
    requestedState: textOrDefault(command.requestedState || command.state, LIFECYCLE_SETTING_COMMAND_TARGET_STATE[name] || null),
    reason: textOrDefault(command.reason || command.message, null),
    issuedAt: textOrDefault(command.issuedAt || command.at, null),
    force: command.force === true,
    scheduling: Object.keys(scheduling).length > 0
      ? {
        mode: textOrDefault(scheduling.mode, null),
        minDelayMs: Number.isInteger(scheduling.minDelayMs) ? scheduling.minDelayMs : null,
        maxDelayMs: Number.isInteger(scheduling.maxDelayMs) ? scheduling.maxDelayMs : null,
        queueName: textOrDefault(scheduling.queueName, null),
        allowManualOverride: scheduling.allowManualOverride === true,
        windowId: textOrDefault(scheduling.windowId || scheduling.id, null),
        windowOpensAt: textOrDefault(scheduling.windowOpensAt || scheduling.opensAt, null),
        windowClosesAt: textOrDefault(scheduling.windowClosesAt || scheduling.closesAt, null)
      }
      : null
  };
}

function normalizeLifecycleControls(input) {
  const runtime = asPlainObject(input.runtime);
  const settings = asPlainObject(input.lifecycleSettings || runtime.lifecycleSettings || input.settings);
  const processAdmission = asPlainObject(settings.processAdmission || settings.admission || input.processAdmission);
  const scheduling = asPlainObject(processAdmission.scheduling || settings.scheduling || input.scheduling);
  const commands = asPlainObject(processAdmission.commands || settings.commands || input.commandControls);
  const settingCommand = normalizeLifecycleSettingCommand(
    processAdmission.controlCommand || settings.controlCommand || input.lifecycleControlCommand
  );
  const enabled = processAdmission.enabled !== false
    && settings.processAdmissionEnabled !== false
    && input.processAdmissionEnabled !== false;
  const state = textOrDefault(
    processAdmission.state || settings.state || (enabled ? 'enabled' : 'disabled'),
    enabled ? 'enabled' : 'disabled'
  );
  const mode = textOrDefault(scheduling.mode || processAdmission.schedulingMode, 'immediate');
  const minDelayMs = normalizeInteger(scheduling.minDelayMs ?? scheduling.delayMs, 0);
  const maxDelayMs = normalizeInteger(scheduling.maxDelayMs, 30000);
  const boundedDelayMs = Math.min(maxDelayMs, minDelayMs);

  return {
    schemaVersion: 1,
    settingsVersion: normalizeInteger(processAdmission.settingsVersion ?? settings.version, 1),
    settingsRevision: normalizeInteger(processAdmission.revision ?? settings.revision, 0),
    state,
    enabled: state !== 'disabled' && enabled,
    reason: textOrDefault(processAdmission.reason || settings.reason, null),
    owner: textOrDefault(processAdmission.owner || settings.owner, 'kernel.lifecycle.process-admission'),
    updatedAt: textOrDefault(processAdmission.updatedAt || settings.updatedAt, null),
    maintenanceUntil: textOrDefault(processAdmission.maintenanceUntil || settings.maintenanceUntil, null),
    commands: {
      'request-admission': commands['request-admission'] !== false && commands.request !== false,
      'recover-admission': commands['recover-admission'] !== false && commands.recover !== false,
      'cancel-admission': commands['cancel-admission'] !== false && commands.cancel !== false
    },
    scheduling: {
      mode,
      minDelayMs,
      maxDelayMs,
      delayMs: boundedDelayMs,
      queueName: textOrDefault(scheduling.queueName || processAdmission.queueName, 'kernel-lifecycle.process-admission'),
      allowManualOverride: scheduling.allowManualOverride === true,
      windowId: textOrDefault(scheduling.windowId || scheduling.id, null),
      windowOpensAt: textOrDefault(scheduling.windowOpensAt || scheduling.opensAt, null),
      windowClosesAt: textOrDefault(scheduling.windowClosesAt || scheduling.closesAt, null)
    },
    settingCommand: {
      name: settingCommand.name,
      commandId: settingCommand.commandId,
      requestedState: settingCommand.requestedState,
      reason: settingCommand.reason,
      issuedAt: settingCommand.issuedAt,
      force: settingCommand.force,
      scheduling: settingCommand.scheduling
    }
  };
}

function deriveLifecycleWindowState(scheduling, now) {
  const nowEpochMs = timestampToEpochMs(now);
  const opensEpochMs = timestampToEpochMs(scheduling.windowOpensAt);
  const closesEpochMs = timestampToEpochMs(scheduling.windowClosesAt);
  const invalid = opensEpochMs !== null && closesEpochMs !== null && opensEpochMs > closesEpochMs;
  const notOpen = !invalid && opensEpochMs !== null && nowEpochMs !== null && nowEpochMs < opensEpochMs;
  const closed = !invalid && closesEpochMs !== null && nowEpochMs !== null && nowEpochMs > closesEpochMs;
  const delayUntilOpenMs = notOpen ? Math.max(0, opensEpochMs - nowEpochMs) : null;

  return {
    state: invalid ? 'invalid' : (notOpen ? 'not-open' : (closed ? 'closed' : 'open')),
    opensAt: scheduling.windowOpensAt,
    closesAt: scheduling.windowClosesAt,
    delayUntilOpenMs,
    boundedDelayMs: delayUntilOpenMs === null
      ? scheduling.delayMs
      : Math.min(scheduling.maxDelayMs, Math.max(scheduling.delayMs, delayUntilOpenMs)),
    enforced: Boolean(scheduling.windowOpensAt || scheduling.windowClosesAt)
  };
}

function buildLifecycleSettingCommandPlan({
  controls,
  settingCommandKnown,
  operatorCanManageSettings,
  windowState,
  now
}) {
  const command = controls.settingCommand;
  const hasCommand = Boolean(command.name);
  const expectedState = hasCommand ? LIFECYCLE_SETTING_COMMAND_TARGET_STATE[command.name] : null;
  const schedulePatch = asPlainObject(command.scheduling);
  const schedulePatchKeys = Object.keys(schedulePatch)
    .filter((key) => schedulePatch[key] !== null && schedulePatch[key] !== undefined && schedulePatch[key] !== false);
  const projectedScheduling = {
    ...controls.scheduling,
    ...schedulePatch,
    mode: schedulePatch.mode || controls.scheduling.mode,
    minDelayMs: Number.isInteger(schedulePatch.minDelayMs) ? schedulePatch.minDelayMs : controls.scheduling.minDelayMs,
    maxDelayMs: Number.isInteger(schedulePatch.maxDelayMs) ? schedulePatch.maxDelayMs : controls.scheduling.maxDelayMs,
    delayMs: Math.min(
      Number.isInteger(schedulePatch.maxDelayMs) ? schedulePatch.maxDelayMs : controls.scheduling.maxDelayMs,
      Number.isInteger(schedulePatch.minDelayMs) ? schedulePatch.minDelayMs : controls.scheduling.minDelayMs
    ),
    queueName: schedulePatch.queueName || controls.scheduling.queueName,
    allowManualOverride: schedulePatch.allowManualOverride === true || controls.scheduling.allowManualOverride,
    windowId: schedulePatch.windowId || controls.scheduling.windowId,
    windowOpensAt: schedulePatch.windowOpensAt || controls.scheduling.windowOpensAt,
    windowClosesAt: schedulePatch.windowClosesAt || controls.scheduling.windowClosesAt
  };
  const projectedWindow = deriveLifecycleWindowState(projectedScheduling, now);
  const projectedState = expectedState || command.requestedState || controls.state;
  const violations = [];
  const warnings = [];

  if (!hasCommand) {
    return {
      schemaVersion: 1,
      present: false,
      canApply: false,
      applicationState: 'not-requested',
      projectedState: controls.state,
      projectedSchedulingMode: controls.scheduling.mode,
      schedulePatchKeys: [],
      blockedReasons: [],
      warnings,
      violations,
      nextAction: 'observe-lifecycle-settings',
      evidenceRef: `${surfaceId}:lifecycle-setting-command:none`
    };
  }

  if (expectedState && command.requestedState && command.requestedState !== expectedState) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.controlCommand.requestedState',
      code: 'lifecycle_setting_command_state_mismatch',
      commandName: command.name,
      expectedState,
      actualState: command.requestedState
    });
  }

  if (command.requestedState && !KNOWN_LIFECYCLE_CONTROL_STATES.has(command.requestedState)) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.controlCommand.requestedState',
      code: 'unknown_lifecycle_setting_requested_state',
      commandName: command.name,
      actualState: command.requestedState
    });
  }

  if (command.name === 'set-process-admission-schedule') {
    if (schedulePatchKeys.length === 0) {
      violations.push({
        field: 'lifecycleSettings.processAdmission.controlCommand.scheduling',
        code: 'lifecycle_schedule_command_missing_schedule',
        commandName: command.name
      });
    }

    if (schedulePatch.mode && !KNOWN_SCHEDULING_MODES.has(schedulePatch.mode)) {
      violations.push({
        field: 'lifecycleSettings.processAdmission.controlCommand.scheduling.mode',
        code: 'unknown_lifecycle_setting_schedule_mode',
        commandName: command.name,
        actualMode: schedulePatch.mode
      });
    }

    if (projectedScheduling.minDelayMs > projectedScheduling.maxDelayMs) {
      violations.push({
        field: 'lifecycleSettings.processAdmission.controlCommand.scheduling.maxDelayMs',
        code: 'lifecycle_setting_schedule_delay_bounds_invalid',
        minDelayMs: projectedScheduling.minDelayMs,
        maxDelayMs: projectedScheduling.maxDelayMs
      });
    }

    if (projectedWindow.state === 'invalid') {
      violations.push({
        field: 'lifecycleSettings.processAdmission.controlCommand.scheduling.windowOpensAt',
        code: 'lifecycle_setting_schedule_window_invalid',
        windowOpensAt: projectedScheduling.windowOpensAt,
        windowClosesAt: projectedScheduling.windowClosesAt
      });
    }
  } else if (schedulePatchKeys.length > 0) {
    warnings.push({
      code: 'lifecycle_setting_command_ignores_schedule_patch',
      commandName: command.name,
      schedulePatchKeys
    });
  }

  if (expectedState && expectedState === controls.state && schedulePatchKeys.length === 0 && !command.force) {
    warnings.push({
      code: 'lifecycle_setting_command_noop',
      commandName: command.name,
      currentState: controls.state
    });
  }

  const blockedReasons = [
    !settingCommandKnown ? 'unknown-command' : null,
    !operatorCanManageSettings ? 'permission-missing' : null,
    windowState.state === 'invalid' ? 'current-window-invalid' : null,
    ...violations.map((violation) => violation.code)
  ].filter(Boolean);
  const canApply = blockedReasons.length === 0;

  return {
    schemaVersion: 1,
    present: true,
    canApply,
    applicationState: canApply ? 'ready-to-apply' : 'blocked',
    currentState: controls.state,
    projectedState,
    currentSchedulingMode: controls.scheduling.mode,
    projectedSchedulingMode: projectedScheduling.mode,
    schedulePatchKeys,
    schedulePatchApplied: command.name === 'set-process-admission-schedule' && schedulePatchKeys.length > 0,
    projectedWindowState: projectedWindow.state,
    requiresRevisionBump: canApply && (
      projectedState !== controls.state
      || projectedScheduling.mode !== controls.scheduling.mode
      || schedulePatchKeys.length > 0
      || command.force
    ),
    nextRevision: canApply ? controls.settingsRevision + 1 : controls.settingsRevision,
    blockedReasons,
    warnings,
    violations,
    nextAction: canApply ? 'commit-lifecycle-setting-command' : 'repair-lifecycle-setting-command',
    evidenceRef: `${surfaceId}:lifecycle-setting-command:${command.commandId || command.name}`
  };
}

function buildLifecycleControlProof({ controls, command, actor, windowState, violations, warnings, nextAction, now }) {
  const basis = [
    controls.state,
    controls.enabled ? 'enabled' : 'disabled',
    controls.settingsRevision,
    controls.scheduling.mode,
    controls.scheduling.queueName,
    controls.settingCommand.name || 'none',
    controls.settingCommand.requestedState || 'none',
    controls.settingCommand.scheduling?.mode || 'none',
    controls.settingCommand.scheduling?.windowOpensAt || 'none',
    controls.settingCommand.scheduling?.windowClosesAt || 'none',
    command.name,
    command.commandId,
    actor.effectiveRole,
    windowState.state,
    violations.map((violation) => violation.code).join(','),
    warnings.map((warning) => warning.code).join(','),
    nextAction
  ].join('|');
  let hash = 0;

  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash * 37) + basis.charCodeAt(index)) >>> 0;
  }

  return {
    schemaVersion: 1,
    proofType: 'hosted-kernel-process-admission-lifecycle-controls',
    proofId: `${surfaceId}:lifecycle-controls:${hash.toString(16).padStart(8, '0')}`,
    basis,
    settingsVersion: controls.settingsVersion,
    settingsRevision: controls.settingsRevision,
    commandName: command.name,
    settingCommandName: controls.settingCommand.name,
    actorRole: actor.effectiveRole,
    windowState: windowState.state,
    nextAction,
    generatedAt: now
  };
}

function buildLifecycleControlDecision({ controls, command, actor, now }) {
  const violations = [];
  const actionableErrors = [];
  const warnings = [];
  const commandEnabled = controls.commands[command.name] !== false;
  const adminOverride = actor.permissions.includes('kernel.process.impersonate');
  const operatorCanManageSettings = actor.effectiveRole === 'admin'
    || actor.effectiveRole === 'system'
    || adminOverride;
  const settingCommandKnown = !controls.settingCommand.name
    || KNOWN_LIFECYCLE_SETTING_COMMANDS.has(controls.settingCommand.name);
  const settingCommandTargetState = controls.settingCommand.name
    ? LIFECYCLE_SETTING_COMMAND_TARGET_STATE[controls.settingCommand.name]
    : null;
  const windowState = deriveLifecycleWindowState(controls.scheduling, now);
  const controlledByMaintenance = controls.state === 'maintenance'
    && command.name !== 'cancel-admission'
    && !controls.scheduling.allowManualOverride
    && !adminOverride;
  const controlledByManualScheduling = controls.scheduling.mode === 'manual'
    && command.name !== 'cancel-admission'
    && !controls.scheduling.allowManualOverride
    && !adminOverride;
  const controlledByQueue = controls.scheduling.mode === 'queued' && command.name === 'request-admission';
  const controlledByWindow = windowState.state === 'not-open'
    && command.name !== 'cancel-admission'
    && !controls.scheduling.allowManualOverride
    && !adminOverride;
  const settingCommandPlan = buildLifecycleSettingCommandPlan({
    controls,
    settingCommandKnown,
    operatorCanManageSettings,
    windowState,
    now
  });

  if (!KNOWN_LIFECYCLE_CONTROL_STATES.has(controls.state)) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.state',
      code: 'unknown_lifecycle_control_state',
      message: `lifecycleSettings.processAdmission.state must be one of ${Array.from(KNOWN_LIFECYCLE_CONTROL_STATES).join(', ')}`
    });
  }

  if (!KNOWN_SCHEDULING_MODES.has(controls.scheduling.mode)) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.scheduling.mode',
      code: 'unknown_lifecycle_scheduling_mode',
      message: `lifecycleSettings.processAdmission.scheduling.mode must be one of ${Array.from(KNOWN_SCHEDULING_MODES).join(', ')}`
    });
  }

  if (!settingCommandKnown) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.controlCommand.name',
      code: 'unknown_lifecycle_setting_command',
      commandName: controls.settingCommand.name,
      message: `lifecycle controlCommand.name must be one of ${Array.from(KNOWN_LIFECYCLE_SETTING_COMMANDS).join(', ')}`
    });
  }

  if (controls.settingCommand.name && !operatorCanManageSettings) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.controlCommand.name',
      code: 'lifecycle_setting_command_permission_missing',
      commandName: controls.settingCommand.name,
      requiredRole: 'admin',
      actualRole: actor.effectiveRole
    });
  }

  if (controls.scheduling.minDelayMs > controls.scheduling.maxDelayMs) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.scheduling.maxDelayMs',
      code: 'lifecycle_scheduling_delay_bounds_invalid',
      minDelayMs: controls.scheduling.minDelayMs,
      maxDelayMs: controls.scheduling.maxDelayMs
    });
  }

  if (windowState.state === 'invalid') {
    violations.push({
      field: 'lifecycleSettings.processAdmission.scheduling.windowOpensAt',
      code: 'lifecycle_scheduling_window_invalid',
      windowOpensAt: controls.scheduling.windowOpensAt,
      windowClosesAt: controls.scheduling.windowClosesAt
    });
  }

  if (!controls.enabled && command.name !== 'cancel-admission') {
    violations.push({
      field: 'lifecycleSettings.processAdmission.enabled',
      code: 'process_admission_disabled',
      owner: controls.owner,
      reason: controls.reason
    });
  }

  if (!commandEnabled) {
    violations.push({
      field: `lifecycleSettings.processAdmission.commands.${command.name}`,
      code: 'admission_command_disabled',
      commandName: command.name,
      owner: controls.owner
    });
  }

  if (controlledByMaintenance) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.state',
      code: 'process_admission_in_maintenance',
      maintenanceUntil: controls.maintenanceUntil,
      owner: controls.owner
    });
  }

  if (controlledByManualScheduling) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.scheduling.mode',
      code: 'process_admission_requires_manual_release',
      queueName: controls.scheduling.queueName,
      windowId: controls.scheduling.windowId
    });
  }

  if (controlledByWindow) {
    violations.push({
      field: 'lifecycleSettings.processAdmission.scheduling.windowOpensAt',
      code: 'process_admission_window_not_open',
      windowOpensAt: controls.scheduling.windowOpensAt,
      delayUntilOpenMs: windowState.delayUntilOpenMs,
      queueName: controls.scheduling.queueName
    });
  } else if (windowState.state === 'closed') {
    warnings.push({
      code: 'process_admission_schedule_window_closed',
      windowClosesAt: controls.scheduling.windowClosesAt,
      nextAction: 'set-process-admission-schedule'
    });
  }

  if (controlledByQueue) {
    warnings.push({
      code: 'process_admission_scheduled_for_queue',
      queueName: controls.scheduling.queueName,
      delayMs: windowState.boundedDelayMs
    });
  }

  violations.push(...settingCommandPlan.violations);
  warnings.push(...settingCommandPlan.warnings);

  for (const violation of violations) {
    actionableErrors.push({
      code: violation.code,
      message: 'Lifecycle process-admission settings must allow this command before hosted-kernel spawn can proceed.',
      owner: controls.owner,
      retryable: [
        'process_admission_in_maintenance',
        'process_admission_requires_manual_release',
        'process_admission_window_not_open'
      ].includes(violation.code),
      retryAfterMs: violation.code === 'process_admission_window_not_open'
        ? windowState.boundedDelayMs
        : (violation.code === 'process_admission_in_maintenance' ? controls.scheduling.delayMs : null)
    });
  }

  const nextAction = command.name === 'cancel-admission'
    ? 'acknowledge-cancelled-admission'
    : (!controls.enabled
      ? 'enable-process-admission'
      : (!commandEnabled
        ? 'enable-admission-command'
        : (controlledByWindow
          ? 'wait-for-scheduled-process-admission-window'
          : (controlledByManualScheduling
            ? 'release-manual-process-admission'
            : (controlledByMaintenance
              ? 'wait-for-maintenance-release'
              : (controlledByQueue ? 'enqueue-process-admission' : 'evaluate-process-admission'))))));
  const settingCommandCanApply = Boolean(controls.settingCommand.name)
    && settingCommandKnown
    && operatorCanManageSettings
    && settingCommandPlan.canApply;
  const proof = buildLifecycleControlProof({
    controls,
    command,
    actor,
    windowState,
    violations,
    warnings,
    nextAction,
    now
  });

  return {
    schemaVersion: 1,
    state: controls.state,
    enabled: controls.enabled,
    settingsVersion: controls.settingsVersion,
    settingsRevision: controls.settingsRevision,
    commandEnabled,
    schedulingMode: controls.scheduling.mode,
    queueName: controls.scheduling.queueName,
    scheduled: controlledByQueue || controlledByManualScheduling || controlledByMaintenance || controlledByWindow,
    scheduleAfterMs: controlledByQueue || controlledByMaintenance || controlledByWindow ? windowState.boundedDelayMs : null,
    nextAction,
    allowed: violations.length === 0 && !controlledByQueue && !controlledByWindow,
    settingCommand: {
      ...controls.settingCommand,
      known: settingCommandKnown,
      targetState: settingCommandTargetState,
      canApply: settingCommandCanApply,
      nextAction: controls.settingCommand.name
        ? settingCommandPlan.nextAction
        : 'observe-lifecycle-settings',
      proofRef: proof.proofId,
      applicationPlan: settingCommandPlan
    },
    schedulingWindow: windowState,
    settingsValidation: {
      status: violations.length > 0 ? 'invalid' : (warnings.length > 0 ? 'warning' : 'valid'),
      invalidFieldCount: violations.length,
      warningCount: warnings.length,
      controlCommandKnown: settingCommandKnown,
      operatorCanManageSettings,
      windowState: windowState.state
    },
    proof,
    violations,
    warnings,
    actionableErrors,
    audit: {
      owner: controls.owner,
      updatedAt: controls.updatedAt,
      reason: controls.reason,
      maintenanceUntil: controls.maintenanceUntil,
      settingsRevision: controls.settingsRevision,
      proofId: proof.proofId,
      evaluatedAt: now
    },
    commandAcknowledgement: buildLifecycleCommandAcknowledgement({
      controls,
      command,
      actor,
      windowState,
      settingCommandPlan,
      violations,
      warnings,
      nextAction,
      proof,
      now
    })
  };
}

function buildLifecycleCommandAcknowledgement({
  controls,
  command,
  actor,
  windowState,
  settingCommandPlan,
  violations,
  warnings,
  nextAction,
  proof,
  now
}) {
  const violationCodes = violations.map((violation) => violation.code);
  const warningCodes = warnings.map((warning) => warning.code);
  const commandDisposition = violationCodes.length > 0
    ? 'rejected'
    : (nextAction === 'enqueue-process-admission'
      ? 'queued'
      : (nextAction.startsWith('wait-') ? 'deferred' : 'accepted'));
  const settingCommandDisposition = !controls.settingCommand.name
    ? 'not-requested'
    : (settingCommandPlan.canApply ? 'ready' : 'blocked');
  const retryAfterMs = windowState.delayUntilOpenMs !== null
    ? windowState.boundedDelayMs
    : (nextAction === 'enqueue-process-admission' ? controls.scheduling.delayMs : null);
  const statePatch = {
    state: settingCommandPlan.canApply ? settingCommandPlan.projectedState : controls.state,
    settingsRevision: settingCommandPlan.nextRevision,
    schedulingMode: settingCommandPlan.canApply
      ? settingCommandPlan.projectedSchedulingMode
      : controls.scheduling.mode,
    queueName: controls.scheduling.queueName,
    windowState: settingCommandPlan.projectedWindowState || windowState.state
  };
  const handoffRequired = ['queued', 'deferred', 'rejected'].includes(commandDisposition)
    || settingCommandDisposition === 'blocked';
  const operatorAction = violationCodes.includes('process_admission_disabled')
    ? 'enable-process-admission'
    : (violationCodes.includes('admission_command_disabled')
      ? 'enable-admission-command'
      : (settingCommandDisposition === 'blocked'
        ? settingCommandPlan.nextAction
        : nextAction));

  return {
    schemaVersion: 1,
    contractId: `${surfaceId}:lifecycle-command-ack:${command.commandId || command.name}`,
    generatedAt: now,
    command: {
      commandName: command.name,
      commandId: command.commandId,
      disposition: commandDisposition,
      accepted: commandDisposition === 'accepted',
      queued: commandDisposition === 'queued',
      deferred: commandDisposition === 'deferred',
      retryAfterMs,
      nextAction,
      requiredActorRole: COMMAND_REQUIRED_PERMISSIONS[command.name]?.[0] || null,
      actorRole: actor.effectiveRole
    },
    settingsCommand: {
      commandName: controls.settingCommand.name,
      commandId: controls.settingCommand.commandId,
      disposition: settingCommandDisposition,
      canApply: settingCommandPlan.canApply,
      targetState: settingCommandPlan.projectedState,
      schedulePatchKeys: settingCommandPlan.schedulePatchKeys,
      requiresRevisionBump: Boolean(settingCommandPlan.requiresRevisionBump),
      nextRevision: settingCommandPlan.nextRevision,
      nextAction: controls.settingCommand.name
        ? settingCommandPlan.nextAction
        : 'observe-lifecycle-settings'
    },
    userVisible: {
      state: commandDisposition,
      status: commandDisposition === 'accepted'
        ? 'Process admission can continue.'
        : (commandDisposition === 'queued'
          ? `Process admission will be queued on ${controls.scheduling.queueName}.`
          : (commandDisposition === 'deferred'
            ? 'Process admission is waiting for the lifecycle window.'
            : 'Process admission needs lifecycle settings attention.')),
      primaryAction: operatorAction,
      secondaryAction: command.name === 'cancel-admission' ? null : 'cancel-admission',
      handoffRequired,
      retryAfterMs
    },
    statePatch,
    validation: {
      status: violationCodes.length > 0 ? 'invalid' : (warningCodes.length > 0 ? 'warning' : 'valid'),
      violationCodes,
      warningCodes,
      blockedBy: [
        ...violationCodes,
        ...settingCommandPlan.blockedReasons.map((reason) => `setting-command:${reason}`)
      ],
      settingCommandViolations: settingCommandPlan.violations.map((violation) => violation.code)
    },
    audit: {
      proofId: proof.proofId,
      settingsRevision: controls.settingsRevision,
      nextRevision: settingCommandPlan.nextRevision,
      windowState: windowState.state,
      scheduleMode: controls.scheduling.mode,
      queueName: controls.scheduling.queueName,
      evaluatedAt: now
    }
  };
}

function buildAdmissionPolicyDecision({ policy, runtimeMode, health, operationalHealth, providerContract }) {
  const violations = [];
  const actionableErrors = [];
  const warnings = [];
  const enforced = policy.mode === 'enforce';

  if (!KNOWN_POLICY_MODES.has(policy.mode)) {
    violations.push({
      field: 'admissionPolicy.mode',
      code: 'unknown_admission_policy_mode',
      message: `admissionPolicy.mode must be one of ${Array.from(KNOWN_POLICY_MODES).join(', ')}`
    });
  }

  if (policy.requireHostedKernel && runtimeMode !== 'hosted-kernel') {
    violations.push({
      field: 'runtime.mode',
      code: 'policy_requires_hosted_kernel_runtime',
      policyId: policy.policyId,
      actualRuntimeMode: runtimeMode
    });
  }

  if (!policy.allowDegradedSpawn && operationalHealth.degradedMode) {
    violations.push({
      field: 'admissionPolicy.allowDegradedSpawn',
      code: 'policy_blocks_degraded_spawn',
      policyId: policy.policyId,
      operationalHealthState: operationalHealth.state
    });
  }

  if (policy.requireProviderLease && !providerContract.sync.leaseId) {
    violations.push({
      field: 'provider.sync.leaseId',
      code: 'policy_requires_provider_sync_lease',
      policyId: policy.policyId,
      providerId: providerContract.providerId
    });
  }

  if (policy.usage.concurrentForTenant >= policy.limits.maxConcurrentPerTenant) {
    violations.push({
      field: 'admissionPolicy.usage.concurrentForTenant',
      code: 'tenant_concurrency_limit_reached',
      policyId: policy.policyId,
      current: policy.usage.concurrentForTenant,
      limit: policy.limits.maxConcurrentPerTenant
    });
  }

  if (policy.usage.queueDepth >= policy.limits.maxQueueDepth) {
    violations.push({
      field: 'admissionPolicy.usage.queueDepth',
      code: 'admission_queue_limit_reached',
      policyId: policy.policyId,
      current: policy.usage.queueDepth,
      limit: policy.limits.maxQueueDepth
    });
  }

  if (health.retry.attempt > policy.limits.maxRetryAttempt || policy.usage.retryAttempt > policy.limits.maxRetryAttempt) {
    violations.push({
      field: 'admissionPolicy.limits.maxRetryAttempt',
      code: 'policy_retry_limit_reached',
      policyId: policy.policyId,
      current: Math.max(health.retry.attempt, policy.usage.retryAttempt),
      limit: policy.limits.maxRetryAttempt
    });
  }

  for (const violation of violations) {
    const error = {
      code: violation.code,
      message: 'Admission policy must be satisfied before dispatching hosted-kernel spawn.',
      policyId: policy.policyId,
      retryable: ['tenant_concurrency_limit_reached', 'admission_queue_limit_reached'].includes(violation.code),
      retryAfterMs: operationalHealth.retryAfterMs
    };

    if (enforced) {
      actionableErrors.push(error);
    } else {
      warnings.push(error);
    }
  }

  return {
    schemaVersion: 1,
    policyId: policy.policyId,
    mode: policy.mode,
    enforced,
    satisfied: violations.length === 0 || !enforced,
    violationCount: violations.length,
    warningCount: warnings.length,
    violations: enforced ? violations : [],
    warnings: enforced ? [] : warnings,
    actionableErrors,
    limits: policy.limits,
    usage: policy.usage
  };
}

function buildProviderServiceContractProof({
  providerContract,
  requestedCapabilities,
  missingProviderCapabilities,
  contractViolations,
  syncFreshness,
  routePartition,
  now
}) {
  const basis = [
    providerContract.providerId,
    providerContract.serviceName,
    providerContract.contractId || 'implicit',
    providerContract.contractVersion,
    providerContract.protocol,
    providerContract.state,
    providerContract.consistencyMode,
    providerContract.sync.generation,
    syncFreshness.state,
    routePartition,
    providerContract.routing.routePartition || 'undeclared',
    providerContract.handoff.ackMode,
    providerContract.mailchimp.enabled ? providerContract.mailchimp.audienceId || 'mailchimp-audience-missing' : 'mailchimp-disabled',
    providerContract.mailchimp.enabled ? providerContract.mailchimp.campaignId || 'mailchimp-campaign-missing' : 'mailchimp-disabled',
    providerContract.mailchimp.enabled ? providerContract.mailchimp.webhookId || 'mailchimp-webhook-missing' : 'mailchimp-disabled',
    requestedCapabilities.join(','),
    missingProviderCapabilities.join(','),
    contractViolations.map((violation) => violation.code).join(',')
  ].join('|');
  let hash = 0;

  for (let index = 0; index < basis.length; index += 1) {
    hash = ((hash * 41) + basis.charCodeAt(index)) >>> 0;
  }

  return {
    schemaVersion: 1,
    proofType: 'hosted-kernel-provider-service-contract',
    proofId: `${surfaceId}:provider-contract:${hash.toString(16).padStart(8, '0')}`,
    basis,
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractId: providerContract.contractId,
    contractVersion: providerContract.contractVersion,
    routePartition,
    generatedAt: now
  };
}

function buildProviderNegotiation({ providerContract, requestedCapabilities, requiresHostedKernel, scope, now }) {
  const offered = new Set(providerContract.capabilities);
  const required = new Set([
    ...providerContract.requiredCapabilities,
    ...(requiresHostedKernel ? HOSTED_KERNEL_PROVIDER_CAPABILITIES : []),
    ...(providerContract.mailchimp.enabled ? providerContract.mailchimp.requiredCapabilities : [])
  ]);
  const requested = new Set(requestedCapabilities);
  const negotiatedCapabilities = [];
  const contractViolations = [];
  const contractWarnings = [];
  const routePartition = `${scope.tenantId}/${scope.workspaceId}`;
  const declaredRoutePartition = providerContract.routing.routePartition
    || providerContract.sync.routePartition
    || null;
  const allowedTenant = providerContract.routing.allowedTenantIds.length === 0
    || providerContract.routing.allowedTenantIds.includes(scope.tenantId);
  const allowedWorkspace = providerContract.routing.allowedWorkspaceIds.length === 0
    || providerContract.routing.allowedWorkspaceIds.includes(scope.workspaceId);
  const allowedRoutePartition = providerContract.routing.allowedRoutePartitions.length === 0
    || providerContract.routing.allowedRoutePartitions.includes(routePartition);

  for (const capability of requested) {
    if (offered.has(capability)) {
      negotiatedCapabilities.push(capability);
    }
  }

  for (const capability of required) {
    if (offered.has(capability) && !negotiatedCapabilities.includes(capability)) {
      negotiatedCapabilities.push(capability);
    }
  }

  const missingProviderCapabilities = Array.from(required)
    .filter((capability) => !offered.has(capability));
  const unsupportedRequestedCapabilities = Array.from(requested)
    .filter((capability) => !offered.has(capability));
  const syncFreshness = normalizeFreshness({
    observedAt: providerContract.sync.lastSyncedAt,
    now,
    maxAgeMs: providerContract.sync.maxAgeMs,
    missingState: providerContract.serviceLevel.requireCurrentSync ? 'missing-required-sync' : 'not-reported'
  });

  if (!KNOWN_PROVIDER_CONSISTENCY_MODES.has(providerContract.consistencyMode)) {
    contractViolations.push({
      field: 'provider.service.consistencyMode',
      code: 'unknown_provider_consistency_mode',
      providerId: providerContract.providerId,
      actualConsistencyMode: providerContract.consistencyMode
    });
  }

  if (!KNOWN_HANDOFF_ACK_MODES.has(providerContract.handoff.ackMode)) {
    contractViolations.push({
      field: 'provider.handoff.ackMode',
      code: 'unknown_provider_handoff_ack_mode',
      providerId: providerContract.providerId,
      actualAckMode: providerContract.handoff.ackMode
    });
  }

  if (providerContract.serviceLevel.requireCurrentSync && syncFreshness.state !== 'fresh') {
    contractViolations.push({
      field: 'provider.sync.lastSyncedAt',
      code: 'provider_sync_metadata_not_current',
      providerId: providerContract.providerId,
      freshnessState: syncFreshness.state,
      ageMs: syncFreshness.ageMs,
      maxAgeMs: syncFreshness.maxAgeMs
    });
  } else if (syncFreshness.stale) {
    contractWarnings.push({
      field: 'provider.sync.lastSyncedAt',
      code: 'provider_sync_metadata_stale',
      providerId: providerContract.providerId,
      ageMs: syncFreshness.ageMs,
      maxAgeMs: syncFreshness.maxAgeMs
    });
  }

  if (requiresHostedKernel && providerContract.routing.requireDeclaredRoutePartition && !declaredRoutePartition) {
    contractViolations.push({
      field: 'provider.routing.routePartition',
      code: 'provider_route_partition_missing',
      providerId: providerContract.providerId,
      expectedRoutePartition: routePartition
    });
  }

  if (requiresHostedKernel && declaredRoutePartition && declaredRoutePartition !== routePartition) {
    contractViolations.push({
      field: 'provider.routing.routePartition',
      code: 'provider_route_partition_mismatch',
      providerId: providerContract.providerId,
      expectedRoutePartition: routePartition,
      actualRoutePartition: declaredRoutePartition
    });
  }

  if (requiresHostedKernel && !allowedTenant) {
    contractViolations.push({
      field: 'provider.routing.allowedTenantIds',
      code: 'provider_tenant_route_not_allowed',
      providerId: providerContract.providerId,
      tenantId: scope.tenantId,
      allowedTenantCount: providerContract.routing.allowedTenantIds.length
    });
  }

  if (requiresHostedKernel && !allowedWorkspace) {
    contractViolations.push({
      field: 'provider.routing.allowedWorkspaceIds',
      code: 'provider_workspace_route_not_allowed',
      providerId: providerContract.providerId,
      workspaceId: scope.workspaceId,
      allowedWorkspaceCount: providerContract.routing.allowedWorkspaceIds.length
    });
  }

  if (requiresHostedKernel && !allowedRoutePartition) {
    contractViolations.push({
      field: 'provider.routing.allowedRoutePartitions',
      code: 'provider_route_partition_not_allowed',
      providerId: providerContract.providerId,
      routePartition,
      allowedRoutePartitionCount: providerContract.routing.allowedRoutePartitions.length
    });
  }

  if (requiresHostedKernel && providerContract.serviceLevel.requireScopedSyncCursor && !providerContract.sync.scopeCursor) {
    contractViolations.push({
      field: 'provider.sync.scopeCursor',
      code: 'provider_scoped_sync_cursor_missing',
      providerId: providerContract.providerId,
      routePartition,
      syncGeneration: providerContract.sync.generation
    });
  }

  if (providerContract.handoff.ackMode !== 'none' && !providerContract.handoff.ackEndpoint) {
    contractViolations.push({
      field: 'provider.handoff.ackEndpoint',
      code: 'provider_handoff_ack_endpoint_missing',
      providerId: providerContract.providerId,
      ackMode: providerContract.handoff.ackMode
    });
  }

  if (providerContract.mailchimp.enabled) {
    if (!providerContract.mailchimp.audienceId) {
      contractViolations.push({
        field: 'provider.mailchimp.audienceId',
        code: 'mailchimp_audience_id_missing',
        providerId: providerContract.providerId,
        serviceName: providerContract.serviceName
      });
    }

    if (!providerContract.mailchimp.campaignId) {
      contractWarnings.push({
        field: 'provider.mailchimp.campaignId',
        code: 'mailchimp_campaign_id_missing',
        providerId: providerContract.providerId,
        serviceName: providerContract.serviceName
      });
    }

    if (!providerContract.mailchimp.webhookEndpoint) {
      contractViolations.push({
        field: 'provider.mailchimp.webhook.endpoint',
        code: 'mailchimp_webhook_endpoint_missing',
        providerId: providerContract.providerId
      });
    }

    if (!providerContract.mailchimp.webhookSigningKeyRef) {
      contractViolations.push({
        field: 'provider.mailchimp.webhook.signingKeyRef',
        code: 'mailchimp_webhook_signing_key_missing',
        providerId: providerContract.providerId
      });
    }

    if (!MAILCHIMP_ACK_MODES.has(providerContract.handoff.ackMode)) {
      contractViolations.push({
        field: 'provider.handoff.ackMode',
        code: 'mailchimp_handoff_requires_provider_ack',
        providerId: providerContract.providerId,
        actualAckMode: providerContract.handoff.ackMode
      });
    }

    if (!providerContract.mailchimp.suppressUnsubscribedContacts) {
      contractViolations.push({
        field: 'provider.mailchimp.suppressUnsubscribedContacts',
        code: 'mailchimp_unsubscribed_contact_suppression_required',
        providerId: providerContract.providerId
      });
    }
  }

  const proof = buildProviderServiceContractProof({
    providerContract,
    requestedCapabilities,
    missingProviderCapabilities,
    contractViolations,
    syncFreshness,
    routePartition,
    now
  });
  const actionableErrors = contractViolations.map((violation) => ({
    code: violation.code,
    message: 'Hosted-kernel provider service contract must be current and acknowledgeable before process handoff.',
    owner: providerContract.serviceLevel.owner,
    action: violation.code === 'provider_sync_metadata_not_current'
      ? 'refresh-hosted-kernel-provider-sync'
      : (violation.code === 'provider_scoped_sync_cursor_missing'
        ? 'refresh-hosted-kernel-provider-scoped-sync'
        : (violation.code.startsWith('mailchimp_')
          ? 'repair-mailchimp-provider-handoff-contract'
          : (violation.code.includes('route')
          ? 'select-provider-route-for-tenant-workspace'
          : 'repair-hosted-kernel-provider-service-contract'))),
    retryable: violation.code === 'provider_sync_metadata_not_current'
      || violation.code === 'provider_scoped_sync_cursor_missing',
    retryAfterMs: violation.code === 'provider_sync_metadata_not_current'
      || violation.code === 'provider_scoped_sync_cursor_missing'
      ? providerContract.serviceLevel.maxHandoffLatencyMs
      : null
  }));

  return {
    providerId: providerContract.providerId,
    protocol: providerContract.protocol,
    serviceName: providerContract.serviceName,
    contractId: providerContract.contractId || `${providerContract.providerId}:${providerContract.serviceName}:${providerContract.protocol}`,
    contractVersion: providerContract.contractVersion,
    hostedKernelRequired: requiresHostedKernel,
    offeredCapabilities: providerContract.capabilities,
    requiredCapabilities: Array.from(required),
    negotiatedCapabilities,
    missingProviderCapabilities,
    unsupportedRequestedCapabilities,
    syncMetadata: {
      cursor: providerContract.sync.cursor,
      scopeCursor: providerContract.sync.scopeCursor,
      routePartition,
      declaredRoutePartition,
      generation: providerContract.sync.generation,
      lastSyncedAt: providerContract.sync.lastSyncedAt,
      leaseId: providerContract.sync.leaseId,
      freshness: syncFreshness
    },
    routing: {
      routePartition,
      declaredRoutePartition,
      allowedTenant,
      allowedWorkspace,
      allowedRoutePartition,
      requireDeclaredRoutePartition: providerContract.routing.requireDeclaredRoutePartition,
      requireScopedSyncCursor: providerContract.serviceLevel.requireScopedSyncCursor,
      allowedTenantCount: providerContract.routing.allowedTenantIds.length,
      allowedWorkspaceCount: providerContract.routing.allowedWorkspaceIds.length,
      allowedRoutePartitionCount: providerContract.routing.allowedRoutePartitions.length
    },
    serviceContract: {
      schemaVersion: 1,
      serviceName: providerContract.serviceName,
      contractId: providerContract.contractId || `${providerContract.providerId}:${providerContract.serviceName}:${providerContract.protocol}`,
      contractVersion: providerContract.contractVersion,
      consistencyMode: providerContract.consistencyMode,
      serviceTier: providerContract.serviceLevel.tier,
      owner: providerContract.serviceLevel.owner,
      requireCurrentSync: providerContract.serviceLevel.requireCurrentSync,
      requireScopedSyncCursor: providerContract.serviceLevel.requireScopedSyncCursor,
      maxHandoffLatencyMs: providerContract.serviceLevel.maxHandoffLatencyMs,
      handoffAckMode: providerContract.handoff.ackMode,
      handoffAckEndpoint: providerContract.handoff.ackEndpoint,
      handoffAckDeadlineMs: providerContract.handoff.ackDeadlineMs,
      routePartition,
      declaredRoutePartition,
      violationCount: contractViolations.length,
      warningCount: contractWarnings.length,
      violations: contractViolations,
      warnings: contractWarnings,
      actionableErrors,
      proof
    },
    productServiceContract: providerContract.mailchimp.enabled
      ? {
        product: 'mailchimp',
        audienceId: providerContract.mailchimp.audienceId,
        campaignId: providerContract.mailchimp.campaignId,
        datacenter: providerContract.mailchimp.datacenter,
        webhookId: providerContract.mailchimp.webhookId,
        webhookEndpoint: providerContract.mailchimp.webhookEndpoint,
        webhookSigningKeyRef: providerContract.mailchimp.webhookSigningKeyRef,
        suppressUnsubscribedContacts: providerContract.mailchimp.suppressUnsubscribedContacts,
        mergeFieldMappings: providerContract.mailchimp.mergeFieldMappings,
        requiredCapabilities: providerContract.mailchimp.requiredCapabilities,
        externalHandoffRef: providerContract.mailchimp.externalHandoffRef,
        readyForHandoff: contractViolations.every((violation) => !violation.code.startsWith('mailchimp_'))
          && providerContract.mailchimp.requiredCapabilities.every((capability) => offered.has(capability))
      }
      : null,
    satisfied: missingProviderCapabilities.length === 0
      && contractViolations.length === 0
      && providerContract.state !== 'unavailable'
  };
}

function buildExternalHandoffState({
  commandCancelsAdmission,
  admitted,
  operationalHealth,
  providerContract,
  providerNegotiation,
  admissionPolicy,
  lifecycleControls,
  scopeBoundary,
  requestId,
  scope,
  command,
  now
}) {
  const productHandoff = buildMailchimpProductHandoffIntent({
    providerContract,
    providerNegotiation,
    scope,
    requestId,
    command,
    status: commandCancelsAdmission ? 'cancelled' : (admitted ? 'spawn-dispatched' : 'pending-remediation'),
    recoveryToken: `${surfaceId}:${requestId}:${command.idempotencyKey}`,
    now
  });
  const baseState = commandCancelsAdmission
    ? 'cancelled'
    : (!admitted
      ? (operationalHealth.retryable || lifecycleControls.scheduled ? 'queued' : 'blocked')
      : (providerNegotiation.satisfied && scopeBoundary.handoffAllowed ? 'ready' : 'blocked'));
  const productHandoffReady = !productHandoff || productHandoff.ready || commandCancelsAdmission;
  const state = baseState === 'ready' && !productHandoffReady ? 'blocked' : baseState;
  const blockedReasons = [];

  if (!KNOWN_PROVIDER_STATES.has(providerContract.state)) {
    blockedReasons.push('unknown_provider_state');
  }

  if (providerContract.state === 'unavailable') {
    blockedReasons.push('provider_unavailable');
  }

  if (providerNegotiation.missingProviderCapabilities.length > 0) {
    blockedReasons.push('provider_capability_gap');
  }

  if (providerNegotiation.serviceContract.violationCount > 0) {
    blockedReasons.push('provider_service_contract_gap');
  }

  if (providerNegotiation.hostedKernelRequired && (!providerNegotiation.routing.allowedTenant
    || !providerNegotiation.routing.allowedWorkspace
    || !providerNegotiation.routing.allowedRoutePartition
    || (providerNegotiation.routing.requireDeclaredRoutePartition && !providerNegotiation.routing.declaredRoutePartition))) {
    blockedReasons.push('provider_route_partition_gap');
  }

  if (providerNegotiation.hostedKernelRequired
    && providerNegotiation.routing.requireScopedSyncCursor
    && !providerNegotiation.syncMetadata.scopeCursor) {
    blockedReasons.push('provider_scoped_sync_gap');
  }

  if (operationalHealth.blocked) {
    blockedReasons.push('runtime_health_blocked');
  }

  if (!admissionPolicy.satisfied) {
    blockedReasons.push('admission_policy_blocked');
  }

  if (!lifecycleControls.allowed) {
    blockedReasons.push(lifecycleControls.scheduled ? 'lifecycle_scheduled' : 'lifecycle_controls_blocked');
  }

  if (!scopeBoundary.handoffAllowed) {
    blockedReasons.push('scope_boundary_blocked');
  }

  if (productHandoff && !productHandoff.ready && !commandCancelsAdmission) {
    blockedReasons.push('mailchimp_product_handoff_blocked');
  }

  return {
    state,
    stateKnown: KNOWN_HANDOFF_STATES.has(state),
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    serviceContractId: providerNegotiation.serviceContract.contractId,
    protocol: providerContract.protocol,
    endpoint: providerContract.endpoint,
    channel: providerContract.handoff.channel,
    externalId: providerContract.handoff.externalId || `${command.commandId}:${requestId}`,
    expiresAt: providerContract.handoff.expiresAt,
    sync: providerNegotiation.syncMetadata,
    routing: {
      routePartition: providerNegotiation.routing.routePartition,
      declaredRoutePartition: providerNegotiation.routing.declaredRoutePartition,
      tenantAllowed: providerNegotiation.routing.allowedTenant,
      workspaceAllowed: providerNegotiation.routing.allowedWorkspace,
      routePartitionAllowed: providerNegotiation.routing.allowedRoutePartition,
      scopedSyncCursorRequired: providerNegotiation.routing.requireScopedSyncCursor,
      scopedSyncCursorPresent: Boolean(providerNegotiation.syncMetadata.scopeCursor)
    },
    acknowledgement: {
      mode: providerNegotiation.serviceContract.handoffAckMode,
      endpoint: providerNegotiation.serviceContract.handoffAckEndpoint,
      deadlineMs: providerNegotiation.serviceContract.handoffAckDeadlineMs,
      required: providerNegotiation.serviceContract.handoffAckMode !== 'none',
      state: state === 'ready'
        ? (providerNegotiation.serviceContract.handoffAckMode === 'none' ? 'not-required' : 'awaiting-provider-ack')
        : 'not-started',
      proofRef: providerNegotiation.serviceContract.proof.proofId
    },
    productHandoff,
    blockedReasons,
    scopeBoundary: {
      policyId: scopeBoundary.policyId,
      mode: scopeBoundary.mode,
      allowed: scopeBoundary.allowed,
      compartmentKey: scopeBoundary.compartmentKey,
      routePartition: scopeBoundary.routePartition,
      proofId: scopeBoundary.proof.proofId
    },
    payloadRef: `${surfaceId}/${scope.tenantId}/${scope.workspaceId}/${requestId}/${command.commandId}`,
    preparedAt: now
  };
}

function buildClientRuntimeAdoption({
  client,
  runtime,
  clientState,
  requiresHostedKernel,
  providerContract,
  providerNegotiation,
  scope,
  command,
  requestId,
  now
}) {
  const clientRuntime = asPlainObject(client.runtime || client.hostedKernel || client.kernelRuntime);
  const handoff = asPlainObject(client.handoff || clientRuntime.handoff);
  const sync = asPlainObject(clientRuntime.sync || client.sync);
  const observedRuntimeMode = textOrDefault(clientRuntime.mode || client.runtimeMode, null);
  const acceptedProtocol = textOrDefault(clientRuntime.acceptedProtocol || clientRuntime.protocol || handoff.protocol, null);
  const strictSync = clientRuntime.requireCurrentSync === true || sync.requireCurrent === true;
  const clientSyncGeneration = normalizeInteger(sync.generation ?? clientRuntime.syncGeneration, 0);
  const providerSyncGeneration = providerNegotiation.syncMetadata.generation;
  const handoffEnabled = handoff.enabled !== false && clientRuntime.handoffEnabled !== false;
  const violations = [];
  const warnings = [];

  if (requiresHostedKernel && observedRuntimeMode && observedRuntimeMode !== 'hosted-kernel') {
    violations.push({
      field: 'client.runtime.mode',
      code: 'client_runtime_mode_not_hosted_kernel',
      expectedRuntimeMode: 'hosted-kernel',
      actualRuntimeMode: observedRuntimeMode
    });
  }

  if (requiresHostedKernel && acceptedProtocol && acceptedProtocol !== providerContract.protocol) {
    violations.push({
      field: 'client.runtime.acceptedProtocol',
      code: 'client_runtime_protocol_mismatch',
      expectedProtocol: providerContract.protocol,
      actualProtocol: acceptedProtocol,
      providerId: providerContract.providerId
    });
  }

  if (requiresHostedKernel && !handoffEnabled) {
    violations.push({
      field: 'client.handoff.enabled',
      code: 'client_runtime_handoff_disabled',
      providerId: providerContract.providerId
    });
  }

  if (requiresHostedKernel && strictSync && clientSyncGeneration < providerSyncGeneration) {
    violations.push({
      field: 'client.runtime.sync.generation',
      code: 'client_runtime_sync_generation_stale',
      expectedGeneration: providerSyncGeneration,
      actualGeneration: clientSyncGeneration,
      providerId: providerContract.providerId
    });
  } else if (requiresHostedKernel && clientSyncGeneration < providerSyncGeneration) {
    warnings.push({
      field: 'client.runtime.sync.generation',
      code: 'client_runtime_sync_generation_lagging',
      expectedGeneration: providerSyncGeneration,
      actualGeneration: clientSyncGeneration,
      providerId: providerContract.providerId
    });
  }

  const authenticated = clientState !== 'anonymous';
  const providerReady = providerNegotiation.satisfied && providerContract.state === 'ready';
  const state = !requiresHostedKernel
    ? 'not-required'
    : (!authenticated
      ? 'pending-authorization'
      : (violations.length > 0
        ? 'blocked'
        : (providerReady && handoffEnabled ? 'adopted' : 'pending-provider')));
  const nextAction = state === 'adopted'
    ? 'continue-hosted-kernel-handoff'
    : (state === 'pending-authorization'
      ? 'authenticate-client-session'
      : (state === 'pending-provider'
        ? 'refresh-hosted-kernel-provider-contract'
        : 'repair-client-runtime-adoption'));

  return {
    schemaVersion: 1,
    state,
    adopted: state === 'adopted' || state === 'not-required',
    required: requiresHostedKernel,
    clientState,
    expectedRuntimeMode: requiresHostedKernel ? 'hosted-kernel' : runtime.mode || 'local-kernel',
    observedRuntimeMode,
    providerId: providerContract.providerId,
    providerProtocol: providerContract.protocol,
    acceptedProtocol,
    handoffEnabled,
    sync: {
      clientGeneration: clientSyncGeneration,
      providerGeneration: providerSyncGeneration,
      current: clientSyncGeneration >= providerSyncGeneration,
      strict: strictSync
    },
    workflow: {
      nextAction,
      target: state === 'adopted' ? 'kernel.lifecycle.spawn' : 'client.runtime.hosted-kernel-adoption',
      handoffContractId: `${surfaceId}:client-runtime:${scope.tenantId}:${scope.workspaceId}:${requestId}:${command.commandId}`,
      routePartition: `${scope.tenantId}/${scope.workspaceId}`,
      generatedAt: now
    },
    violationCount: violations.length,
    warningCount: warnings.length,
    violations,
    warnings,
    actionableErrors: violations.map((violation) => ({
      code: violation.code,
      message: 'Client runtime adoption must match the hosted-kernel provider contract before process handoff.',
      owner: 'client.runtime.hosted-kernel-adoption',
      action: 'repair-client-runtime-adoption',
      retryable: ['client_runtime_sync_generation_stale'].includes(violation.code),
      retryAfterMs: null
    }))
  };
}

function buildOperationalHealthDecision(health) {
  const violations = [];

  if (!KNOWN_HEALTH_STATES.has(health.state)) {
    violations.push({
      field: 'runtime.health.state',
      code: 'unknown_health_state',
      message: `runtime.health.state must be one of ${Array.from(KNOWN_HEALTH_STATES).join(', ')}`
    });
  }

  const failedDependencies = [];
  const degradedDependencies = [];
  const staleDependencies = [];
  for (const dependency of health.dependencies) {
    if (!KNOWN_DEPENDENCY_STATES.has(dependency.state)) {
      violations.push({
        field: `runtime.dependencies.${dependency.name}.state`,
        code: 'unknown_dependency_state',
        dependency: dependency.name,
        message: `dependency.state must be one of ${Array.from(KNOWN_DEPENDENCY_STATES).join(', ')}`
      });
    }

    if (dependency.state === 'unavailable' || dependency.state === 'unknown') {
      failedDependencies.push(dependency);
    } else if (dependency.state === 'degraded') {
      degradedDependencies.push(dependency);
    }

    if (dependency.freshness.stale) {
      staleDependencies.push(dependency);
      if (dependency.state === 'ready') {
        degradedDependencies.push(dependency);
      }
    }
  }

  const criticalFailures = failedDependencies.filter((dependency) => dependency.critical);
  const criticalDegraded = degradedDependencies.filter((dependency) => dependency.critical);
  const criticalStale = staleDependencies.filter((dependency) => dependency.critical);
  const healthFailurePresent = health.state === 'unhealthy'
    || health.state === 'unknown'
    || health.freshness.stale
    || criticalFailures.length > 0
    || failedDependencies.length > 0
    || degradedDependencies.length > 0
    || staleDependencies.length > 0;
  const hardBlocked = health.state === 'unhealthy'
    || criticalFailures.length > 0
    || (health.freshness.stale && !health.degradedModeAllowed)
    || (criticalStale.length > 0 && !health.degradedModeAllowed)
    || (health.retry.exhausted && healthFailurePresent);
  const degraded = !hardBlocked
    && (health.state === 'degraded'
      || health.state === 'unknown'
      || health.freshness.stale
      || failedDependencies.length > 0
      || criticalDegraded.length > 0
      || staleDependencies.length > 0);
  const admitInDegradedMode = degraded && health.degradedModeAllowed;
  const retryable = !health.retry.exhausted && (hardBlocked || degraded);
  const actionableErrors = [];
  const failure = buildOperationalFailureState({
    health,
    failedDependencies,
    degradedDependencies,
    hardBlocked,
    admitInDegradedMode,
    retryable
  });

  if (criticalFailures.length > 0) {
    violations.push({
      field: 'runtime.dependencies',
      code: 'critical_dependency_unavailable',
      dependencies: criticalFailures.map((dependency) => dependency.name)
    });
  }

  if (health.state === 'unhealthy' || health.state === 'unknown') {
    actionableErrors.push({
      code: 'runtime_health_not_ready',
      message: health.reason || 'Runtime health must report healthy or explicitly allow degraded admission before hosted-kernel spawn.',
      retryable,
      retryAfterMs: retryable ? health.retry.nextDelayMs : null
    });
  }

  if (health.freshness.stale) {
    actionableErrors.push({
      code: 'runtime_health_observation_stale',
      message: `Runtime health observation is ${health.freshness.ageMs}ms old; refresh hosted-kernel readiness before process handoff.`,
      owner: 'kernel.runtime.health',
      action: 'refresh-runtime-health-observation',
      runbook: 'kernel.runtime.health.refresh',
      retryable,
      retryAfterMs: retryable ? health.retry.nextDelayMs : null
    });
  }

  for (const dependency of [...failedDependencies, ...degradedDependencies]) {
    actionableErrors.push({
      code: dependency.freshness.stale
        ? (dependency.critical ? 'critical_dependency_health_stale' : 'dependency_health_stale')
        : (dependency.critical ? 'critical_dependency_not_ready' : 'dependency_not_ready'),
      message: dependency.message || `${dependency.name} is ${dependency.state}; restore it or enable degraded admission where appropriate.`,
      dependency: dependency.name,
      owner: dependency.freshness.stale ? 'kernel.runtime.health' : undefined,
      action: dependency.freshness.stale ? 'refresh-dependency-health-observation' : undefined,
      runbook: dependency.freshness.stale ? 'kernel.runtime.dependency-health.refresh' : undefined,
      retryable,
      retryAfterMs: retryable ? health.retry.nextDelayMs : null
    });
  }

  if (health.retry.exhausted && healthFailurePresent) {
    violations.push({
      field: 'runtime.health.retry',
      code: 'retry_budget_exhausted',
      attempt: health.retry.attempt,
      maxAttempts: health.retry.maxAttempts
    });
  }

  return {
    state: hardBlocked ? 'blocked' : (admitInDegradedMode ? 'degraded-admissible' : (degraded ? 'degraded-hold' : 'ready')),
    degraded,
    degradedMode: admitInDegradedMode,
    blocked: hardBlocked || (degraded && !health.degradedModeAllowed),
    retryable,
    retryAfterMs: retryable ? health.retry.nextDelayMs : null,
    failure,
    failedDependencies: failedDependencies.map((dependency) => dependency.name),
    criticalFailedDependencies: criticalFailures.map((dependency) => dependency.name),
    degradedDependencies: degradedDependencies.map((dependency) => dependency.name),
    staleDependencies: staleDependencies.map((dependency) => dependency.name),
    criticalStaleDependencies: criticalStale.map((dependency) => dependency.name),
    violations,
    actionableErrors: [
      ...actionableErrors,
      ...failure.incidents.map((incident) => ({
        code: incident.critical ? 'operational_incident_requires_owner_action' : 'operational_incident_requires_attention',
        message: incident.message,
        dependency: incident.dependency,
        owner: incident.owner,
        action: incident.action,
        runbook: incident.runbook,
        retryable: incident.retryable,
        retryAfterMs: incident.retryAfterMs
      })),
      ...violations.map((violation) => ({
        code: violation.code,
        message: violation.message || 'Resolve process-admission runtime health before spawning the hosted kernel process.',
        retryable,
        retryAfterMs: retryable ? health.retry.nextDelayMs : null
      }))
    ]
  };
}

function buildValidationSummary({
  admitted,
  commandCancelsAdmission,
  violations,
  objective,
  ownerBinding,
  lifecycleEvidenceRefs,
  missingCapabilities,
  missingProviderCapabilities,
  permissionDecision,
  health,
  operationalHealth,
  providerNegotiation,
  clientRuntimeAdoption,
  externalHandoff,
  admissionPolicy,
  lifecycleControls,
  scopeBoundary,
  persistence,
  recovery,
  scope,
  clientState,
  requiresHostedKernel
}) {
  const scopeViolationCount = violations.filter((violation) => (
    violation.code.includes('tenant') || violation.code.includes('workspace') || violation.code.includes('scope')
  )).length;
  const intakeIssueCount = [
    objective.present && !objective.empty,
    Boolean(objective.objectiveKey && objective.normalizedSummary),
    Boolean(ownerBinding.ownerId && ownerBinding.bindingId),
    ownerBinding.actorCanBind,
    objective.requiredEvidenceSatisfied
  ].filter((ok) => !ok).length;
  const expiredHoldRequiresRecovery = persistence.restartLedger.expiration.expired
    && recovery.mode === 'expired-hold';
  const validationGroups = [
    {
      key: 'process-intake',
      label: 'Process intake',
      status: intakeIssueCount === 0 ? 'passed' : 'blocked',
      issueCount: intakeIssueCount,
      objectiveKey: objective.objectiveKey,
      ownerBindingId: ownerBinding.bindingId,
      initialEvidenceProofId: lifecycleEvidenceRefs.proof.proofId,
      missingEvidenceTypes: objective.requiredEvidence.missingTypes,
      nextAction: !objective.present || objective.empty
        ? 'provide-process-objective'
        : (!ownerBinding.ownerId
          ? 'bind-process-owner'
          : (!ownerBinding.actorCanBind
            ? 'authorize-process-owner-binding'
            : (!objective.requiredEvidenceSatisfied ? 'attach-required-objective-evidence' : null)))
    },
    {
      key: 'client-contract',
      label: 'Client contract',
      status: missingCapabilities.length === 0 && (!requiresHostedKernel || clientState !== 'anonymous') ? 'passed' : 'blocked',
      issueCount: missingCapabilities.length + (requiresHostedKernel && clientState === 'anonymous' ? 1 : 0)
    },
    {
      key: 'client-runtime-adoption',
      label: 'Client runtime adoption',
      status: clientRuntimeAdoption.adopted
        ? (clientRuntimeAdoption.warningCount > 0 ? 'warning' : 'passed')
        : (clientRuntimeAdoption.state === 'pending-authorization' ? 'blocked' : 'blocked'),
      issueCount: clientRuntimeAdoption.violationCount + clientRuntimeAdoption.warningCount,
      expectedRuntimeMode: clientRuntimeAdoption.expectedRuntimeMode,
      observedRuntimeMode: clientRuntimeAdoption.observedRuntimeMode,
      providerProtocol: clientRuntimeAdoption.providerProtocol,
      acceptedProtocol: clientRuntimeAdoption.acceptedProtocol,
      nextAction: clientRuntimeAdoption.workflow.nextAction
    },
    {
      key: 'actor-authorization',
      label: 'Actor authorization',
      status: permissionDecision.allowed ? 'passed' : 'blocked',
      issueCount: permissionDecision.missing.length
    },
    {
      key: 'scope-boundary',
      label: 'Tenant and workspace boundary',
      status: scopeViolationCount === 0 && scopeBoundary.allowed
        ? (scopeBoundary.warningCount > 0 ? 'warning' : 'passed')
        : 'blocked',
      issueCount: scopeViolationCount + scopeBoundary.violationCount + scopeBoundary.warningCount,
      isolationKey: scope.isolationKey,
      policyId: scopeBoundary.policyId,
      mode: scopeBoundary.mode,
      compartmentKey: scopeBoundary.compartmentKey
    },
    {
      key: 'provider-contract',
      label: 'Hosted kernel provider',
      status: providerNegotiation.satisfied && missingProviderCapabilities.length === 0
        ? (providerNegotiation.serviceContract.warningCount > 0 ? 'warning' : 'passed')
        : 'blocked',
      issueCount: missingProviderCapabilities.length
        + providerNegotiation.serviceContract.violationCount
        + providerNegotiation.serviceContract.warningCount,
      contractId: providerNegotiation.serviceContract.contractId,
      consistencyMode: providerNegotiation.serviceContract.consistencyMode,
      syncFreshnessState: providerNegotiation.syncMetadata.freshness.state,
      handoffAckMode: providerNegotiation.serviceContract.handoffAckMode,
      nextAction: providerNegotiation.serviceContract.violationCount > 0
        ? providerNegotiation.serviceContract.actionableErrors[0]?.action
        : null
    },
    {
      key: 'admission-policy',
      label: 'Admission policy',
      status: admissionPolicy.satisfied ? (admissionPolicy.warningCount > 0 ? 'warning' : 'passed') : 'blocked',
      issueCount: admissionPolicy.violationCount,
      policyId: admissionPolicy.policyId,
      mode: admissionPolicy.mode
    },
    {
      key: 'lifecycle-controls',
      label: 'Lifecycle controls',
      status: lifecycleControls.allowed
        ? (lifecycleControls.warnings.length > 0 ? 'queued' : 'passed')
        : (lifecycleControls.scheduled ? 'queued' : 'blocked'),
      issueCount: lifecycleControls.violations.length + lifecycleControls.warnings.length,
      state: lifecycleControls.state,
      schedulingMode: lifecycleControls.schedulingMode,
      nextAction: lifecycleControls.nextAction,
      scheduleAfterMs: lifecycleControls.scheduleAfterMs
    },
    {
      key: 'runtime-readiness',
      label: 'Runtime readiness',
      status: operationalHealth.blocked
        ? (operationalHealth.retryable ? 'retryable' : 'blocked')
        : (operationalHealth.degradedMode ? 'degraded' : 'passed'),
      issueCount: operationalHealth.failedDependencies.length
        + operationalHealth.degradedDependencies.length
        + (health.freshness.stale ? 1 : 0),
      retryAfterMs: operationalHealth.retryAfterMs,
      failureState: operationalHealth.failure.state,
      primaryOwner: operationalHealth.failure.primaryOwner,
      primaryAction: operationalHealth.failure.primaryAction,
      freshnessState: health.freshness.state,
      staleDependencyCount: operationalHealth.staleDependencies.length
    },
    {
      key: 'persistence-status-contract',
      label: 'Persisted status contract',
      status: persistence.restartLedger.statusContract.known ? 'passed' : 'blocked',
      issueCount: persistence.restartLedger.statusContract.known ? 0 : 1,
      persistedStatus: persistence.restartLedger.statusContract.status,
      statusCategory: persistence.restartLedger.statusContract.category,
      nextAction: persistence.restartLedger.statusContract.known
        ? null
        : persistence.restartLedger.statusContract.recoveryAction
    },
    {
      key: 'persistence-expiration',
      label: 'Persisted admission hold',
      status: persistence.restartLedger.expiration.expired
        ? (expiredHoldRequiresRecovery ? 'retryable' : 'warning')
        : 'passed',
      issueCount: persistence.restartLedger.expiration.expired ? 1 : 0,
      persistedStatus: persistence.restartLedger.expiration.status,
      deadlineAt: persistence.restartLedger.expiration.deadlineAt,
      ageMs: persistence.restartLedger.expiration.ageMs,
      expiresInMs: persistence.restartLedger.expiration.expiresInMs,
      nextAction: persistence.restartLedger.expiration.expired
        ? (expiredHoldRequiresRecovery ? 'recover-or-cancel-expired-admission' : recovery.action)
        : null
    },
    {
      key: 'handoff-readiness',
      label: 'Spawn handoff',
      status: externalHandoff.state === 'ready' || commandCancelsAdmission ? 'passed' : externalHandoff.state,
      issueCount: externalHandoff.blockedReasons.length
    }
  ];
  const blockingGroupCount = validationGroups.filter((group) => group.status === 'blocked').length;
  const retryableGroupCount = validationGroups.filter((group) => group.status === 'retryable' || group.status === 'queued').length;

  return {
    schemaVersion: 1,
    ready: admitted && externalHandoff.state === 'ready',
    accepted: admitted,
    cancellable: !admitted || externalHandoff.state !== 'ready',
    state: commandCancelsAdmission
      ? 'cancelled'
      : (admitted
        ? (operationalHealth.degradedMode ? 'accepted-degraded' : 'accepted')
        : (retryableGroupCount > 0 ? 'needs-retry' : 'needs-remediation')),
    blockingGroupCount,
    retryableGroupCount,
    totalViolationCount: violations.length,
    groups: validationGroups
  };
}

function buildAdmissionPreview({ decision, handoffTarget, persistence, recovery, validationSummary, externalHandoff, operationalHealth, lifecycleControls }) {
  return {
    schemaVersion: 1,
    status: validationSummary.state,
    accepted: validationSummary.accepted,
    readyForSpawn: validationSummary.ready,
    primaryAction: !lifecycleControls.allowed
      ? lifecycleControls.nextAction
      : (validationSummary.ready
      ? 'dispatch-hosted-kernel-spawn'
      : (operationalHealth.retryable ? 'schedule-readiness-retry' : 'collect-required-remediation')),
    previewLabel: !lifecycleControls.allowed
      ? 'Hosted kernel process admission is waiting on lifecycle controls'
      : (validationSummary.ready
      ? 'Hosted kernel process is ready to start'
      : (operationalHealth.retryable ? 'Hosted kernel process will retry readiness checks' : 'Hosted kernel process is waiting on required fixes')),
    decisionStatus: decision,
    persistedStatus: persistence.current.status,
    restartSafeStatus: persistence.current.restartSafeStatus,
    recoveryMode: recovery.mode,
    handoffTarget,
    externalHandoffState: externalHandoff.state,
    lifecycleControlState: lifecycleControls.state,
    lifecycleSchedulingMode: lifecycleControls.schedulingMode,
    lifecycleControlNextAction: lifecycleControls.nextAction,
    retryAfterMs: operationalHealth.retryAfterMs,
    validationGroupCount: validationSummary.groups.length,
    blockingGroupCount: validationSummary.blockingGroupCount
  };
}

function buildExplainableNextSteps({
  commandCancelsAdmission,
  admitted,
  objective,
  ownerBinding,
  lifecycleEvidenceRefs,
  missingCapabilities,
  permissionDecision,
  providerNegotiation,
  admissionPolicy,
  lifecycleControls,
  scopeBoundary,
  operationalHealth,
  externalHandoff,
  recovery,
  persistence
}) {
  const steps = [];

  if (commandCancelsAdmission) {
    steps.push({ action: 'acknowledge-cancelled-admission', owner: 'client', required: true, status: 'ready' });
  } else if (admitted && externalHandoff.state === 'ready') {
    steps.push({ action: 'dispatch-hosted-kernel-spawn', owner: 'kernel.lifecycle.spawn', required: true, status: 'ready', payloadRef: externalHandoff.payloadRef });
  }

  if (!objective.present || objective.empty) {
    steps.push({
      action: 'provide-process-objective',
      owner: 'client.workflow.process-admission',
      required: true,
      status: 'blocked',
      intakeRef: lifecycleEvidenceRefs.intakeRef
    });
  }

  if (!ownerBinding.ownerId) {
    steps.push({
      action: 'bind-process-owner',
      owner: 'client.workflow.process-admission',
      required: true,
      status: 'blocked',
      intakeRef: lifecycleEvidenceRefs.intakeRef
    });
  } else if (!ownerBinding.actorCanBind) {
    steps.push({
      action: 'authorize-process-owner-binding',
      owner: 'security.route',
      required: true,
      status: 'blocked',
      ownerBindingId: ownerBinding.bindingId,
      actorId: ownerBinding.actorId,
      ownerId: ownerBinding.ownerId
    });
  }

  if (!objective.requiredEvidenceSatisfied) {
    steps.push({
      action: 'attach-required-objective-evidence',
      owner: 'client.workflow.process-admission',
      required: true,
      status: 'blocked',
      missingEvidenceTypes: objective.requiredEvidence.missingTypes,
      intakeProofId: lifecycleEvidenceRefs.proof.proofId
    });
  }

  if (permissionDecision.missing.length > 0) {
    steps.push({ action: 'grant-actor-permissions', owner: 'security.route', required: true, status: 'blocked', missingPermissions: permissionDecision.missing });
  }

  if (missingCapabilities.length > 0) {
    steps.push({ action: 'refresh-client-capabilities', owner: 'client.session', required: true, status: 'blocked', missingCapabilities });
  }

  if (providerNegotiation.missingProviderCapabilities.length > 0) {
    steps.push({ action: 'select-compatible-hosted-kernel-provider', owner: 'kernel.provider.router', required: true, status: 'blocked', missingCapabilities: providerNegotiation.missingProviderCapabilities });
  }

  if (providerNegotiation.serviceContract.violationCount > 0) {
    const primaryProviderError = providerNegotiation.serviceContract.actionableErrors[0];
    steps.push({
      action: primaryProviderError?.action || 'repair-hosted-kernel-provider-service-contract',
      owner: providerNegotiation.serviceContract.owner,
      required: true,
      status: primaryProviderError?.retryable ? 'queued' : 'blocked',
      providerId: providerNegotiation.providerId,
      contractId: providerNegotiation.serviceContract.contractId,
      violationCount: providerNegotiation.serviceContract.violationCount,
      retryAfterMs: primaryProviderError?.retryAfterMs || null,
      proofId: providerNegotiation.serviceContract.proof.proofId
    });
  }

  if (!admissionPolicy.satisfied) {
    steps.push({
      action: 'adjust-hosted-kernel-admission-policy-or-capacity',
      owner: 'kernel.policy.admission',
      required: true,
      status: 'blocked',
      policyId: admissionPolicy.policyId,
      violationCount: admissionPolicy.violationCount
    });
  }

  if (!lifecycleControls.allowed) {
    steps.push({
      action: lifecycleControls.nextAction,
      owner: lifecycleControls.audit.owner,
      required: commandCancelsAdmission ? false : true,
      status: lifecycleControls.scheduled ? 'queued' : 'blocked',
      controlState: lifecycleControls.state,
      schedulingMode: lifecycleControls.schedulingMode,
      queueName: lifecycleControls.queueName,
      scheduleAfterMs: lifecycleControls.scheduleAfterMs,
      reason: lifecycleControls.audit.reason
    });
  }

  if (!scopeBoundary.allowed) {
    steps.push({
      action: 'repair-tenant-workspace-scope-boundary',
      owner: 'kernel.security.scope-boundary',
      required: commandCancelsAdmission ? false : true,
      status: 'blocked',
      policyId: scopeBoundary.policyId,
      mode: scopeBoundary.mode,
      violationCount: scopeBoundary.violationCount,
      compartmentKey: scopeBoundary.compartmentKey,
      auditSink: scopeBoundary.audit.sink
    });
  }

  if (operationalHealth.retryable) {
    steps.push({
      action: operationalHealth.failure.primaryAction,
      owner: operationalHealth.failure.primaryOwner,
      required: true,
      status: 'queued',
      retryAfterMs: operationalHealth.retryAfterMs,
      retryBudgetRemaining: operationalHealth.failure.retryBudgetRemaining,
      incidentCount: operationalHealth.failure.incidentCount
    });
  } else if (operationalHealth.blocked) {
    steps.push({
      action: operationalHealth.failure.primaryAction,
      owner: operationalHealth.failure.primaryOwner,
      required: true,
      status: 'blocked',
      failedDependencies: operationalHealth.failedDependencies,
      incidentCount: operationalHealth.failure.incidentCount,
      runbook: operationalHealth.failure.incidents[0]?.runbook || null
    });
  }

  if (persistence.restartLedger.expiration.expired && recovery.mode === 'expired-hold') {
    steps.push({
      action: recovery.canResume ? recovery.action : 'cancel-expired-admission-hold',
      owner: 'kernel.persistence.recovery',
      required: true,
      status: recovery.canResume ? 'queued' : 'blocked',
      recoveryToken: persistence.current.recoveryToken,
      persistedStatus: persistence.restartLedger.expiration.status,
      deadlineAt: persistence.restartLedger.expiration.deadlineAt,
      expiredByMs: Math.max(0, -(persistence.restartLedger.expiration.expiresInMs ?? 0))
    });
  }

  if (persistence.restartLedger.statusContract.blocksAdmissionWrite) {
    steps.push({
      action: persistence.restartLedger.statusContract.recoveryAction,
      owner: 'kernel.persistence.recovery',
      required: true,
      status: 'blocked',
      persistedStatus: persistence.restartLedger.statusContract.status,
      statusCategory: persistence.restartLedger.statusContract.category,
      persistenceKey: persistence.key
    });
  }

  if (recovery.canResume) {
    steps.push({ action: recovery.action, owner: 'kernel.persistence.recovery', required: false, status: 'available', recoveryToken: persistence.current.recoveryToken });
  }

  return {
    schemaVersion: 1,
    count: steps.length,
    nextRequiredAction: steps.find((step) => step.required)?.action || 'observe-admission-state',
    steps
  };
}

function buildClientWorkflowHandoff({
  command,
  requestId,
  intent,
  scope,
  objective,
  ownerBinding,
  lifecycleEvidenceRefs,
  clientState,
  admissionPreview,
  validationSummary,
  nextSteps,
  errorTriage,
  externalHandoff,
  persistence,
  recovery,
  operationalHealth,
  permissionDecision,
  missingCapabilities,
  providerNegotiation,
  clientRuntimeAdoption,
  admissionPolicy,
  lifecycleControls,
  scopeBoundary,
  commandCancelsAdmission,
  now
}) {
  const lane = commandCancelsAdmission
    ? 'terminal'
    : (validationSummary.ready
      ? 'spawn'
      : (lifecycleControls.scheduled ? 'schedule' : (operationalHealth.retryable ? 'retry' : (clientState === 'anonymous' ? 'authorize' : 'remediate'))));
  const state = commandCancelsAdmission
    ? 'cancelled'
    : (validationSummary.ready
      ? 'ready-for-spawn'
      : (lifecycleControls.scheduled ? 'waiting-for-lifecycle-release' : (operationalHealth.retryable ? 'waiting-for-runtime' : 'waiting-for-client-action')));
  const resumeCommand = recovery.canResume || operationalHealth.retryable
    ? {
      commandName: 'recover-admission',
      commandIdHint: `${command.commandId}:recover`,
      idempotencyKey: persistence.current.recoveryToken,
      enabled: !commandCancelsAdmission,
      reason: recovery.canResume ? recovery.restartSafeStatus : 'runtime-readiness-retry'
    }
    : null;
  const cancelCommand = validationSummary.cancellable
    ? {
      commandName: 'cancel-admission',
      commandIdHint: `${command.commandId}:cancel`,
      idempotencyKey: `${persistence.current.recoveryToken}:cancel`,
      enabled: !commandCancelsAdmission
    }
    : null;

  return {
    schemaVersion: 1,
    surfaceId,
    requestId,
    intent,
    state,
    lane,
    primaryAction: nextSteps.nextRequiredAction,
    accepted: validationSummary.accepted,
    readyForSpawn: validationSummary.ready,
    cancellable: validationSummary.cancellable,
    retryAfterMs: operationalHealth.retryAfterMs,
    generatedAt: now,
    route: {
      target: lane === 'spawn'
        ? 'kernel.lifecycle.spawn'
        : (lane === 'schedule' ? 'kernel.lifecycle.process-admission.scheduler' : 'client.workflow.process-admission'),
      handoffRef: externalHandoff.payloadRef,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      externalState: externalHandoff.state,
      syncGeneration: externalHandoff.sync.generation,
      handoffAckMode: externalHandoff.acknowledgement.mode,
      handoffAckState: externalHandoff.acknowledgement.state,
      compartmentKey: scopeBoundary.compartmentKey,
      clientRuntimeTarget: clientRuntimeAdoption.workflow.target,
      clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId
    },
    scope: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey
    },
    display: {
      status: admissionPreview.status,
      label: admissionPreview.previewLabel,
      blockingGroupCount: validationSummary.blockingGroupCount,
      retryableGroupCount: validationSummary.retryableGroupCount,
      nextStepCount: nextSteps.count,
      actionableErrorBlockingCount: errorTriage.blockingCount,
      actionableErrorRetryableCount: errorTriage.retryableCount,
      actionableErrorPrimarySource: errorTriage.primary?.source || null,
      actionableErrorPrimaryAction: errorTriage.primary?.action || null,
      clientRuntimeAdoptionState: clientRuntimeAdoption.state,
      clientRuntimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction
    },
    commands: {
      resume: resumeCommand,
      cancel: cancelCommand
    },
    blockers: {
      missingCapabilities,
      missingProviderCapabilities: providerNegotiation.missingProviderCapabilities,
      unsupportedRequestedCapabilities: providerNegotiation.unsupportedRequestedCapabilities,
      providerServiceContractViolations: providerNegotiation.serviceContract.violations.map((violation) => violation.code),
      providerServiceContractWarnings: providerNegotiation.serviceContract.warnings.map((warning) => warning.code),
      clientRuntimeAdoptionViolations: clientRuntimeAdoption.violations.map((violation) => violation.code),
      clientRuntimeAdoptionWarnings: clientRuntimeAdoption.warnings.map((warning) => warning.code),
      policyViolations: admissionPolicy.violations.map((violation) => violation.code),
      policyWarnings: admissionPolicy.warnings.map((warning) => warning.code),
      lifecycleControlViolations: lifecycleControls.violations.map((violation) => violation.code),
      lifecycleControlWarnings: lifecycleControls.warnings.map((warning) => warning.code),
      scopeBoundaryViolations: scopeBoundary.violations.map((violation) => violation.code),
      scopeBoundaryWarnings: scopeBoundary.warnings.map((warning) => warning.code),
      missingPermissions: permissionDecision.missing,
      failedDependencies: operationalHealth.failedDependencies,
      criticalFailedDependencies: operationalHealth.criticalFailedDependencies,
      degradedDependencies: operationalHealth.degradedDependencies,
      operationalIncidents: operationalHealth.failure.incidents
    },
    actionableErrors: {
      totalCount: errorTriage.totalCount,
      blockingCount: errorTriage.blockingCount,
      retryableCount: errorTriage.retryableCount,
      primary: errorTriage.primary,
      nextRetry: errorTriage.nextRetry,
      groupedCounts: errorTriage.groupedCounts
    },
    proofRefs: {
      persistenceKey: persistence.key,
      recoveryToken: persistence.current.recoveryToken,
      persistenceWriteOperation: persistence.writePlan.operation,
      persistenceWriteRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence,
      reportSnapshotId: `${command.commandId}:${persistence.current.status}`,
      objectiveKey: objective.objectiveKey,
      ownerBindingId: ownerBinding.bindingId,
      intakeRef: lifecycleEvidenceRefs.intakeRef,
      intakeEvidenceProofId: lifecycleEvidenceRefs.proof.proofId,
      externalHandoffRef: externalHandoff.payloadRef,
      providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
      handoffAckMode: externalHandoff.acknowledgement.mode,
      handoffAckState: externalHandoff.acknowledgement.state,
      scopeBoundaryPolicyId: scopeBoundary.policyId,
      scopeBoundaryCompartmentKey: scopeBoundary.compartmentKey,
      scopeBoundaryProofId: scopeBoundary.proof.proofId,
      clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
      clientRuntimeAdoptionState: clientRuntimeAdoption.state
    }
  };
}

function buildRoutePreviewAcceptance({
  command,
  requestId,
  scope,
  admissionPreview,
  validationSummary,
  nextSteps,
  clientWorkflow,
  errorTriage,
  externalHandoff,
  persistence,
  operationalHealth,
  lifecycleControls,
  scopeBoundary,
  providerNegotiation,
  now
}) {
  const blockedGroups = validationSummary.groups.filter((group) => group.status === 'blocked');
  const retryableGroups = validationSummary.groups.filter((group) => group.status === 'retryable' || group.status === 'queued');
  const warningGroups = validationSummary.groups.filter((group) => group.status === 'warning' || group.status === 'degraded');
  const passedGroups = validationSummary.groups.filter((group) => group.status === 'passed');
  const primaryBlockingGroup = blockedGroups[0] || retryableGroups[0] || warningGroups[0] || null;
  const primaryNextStep = nextSteps.steps.find((step) => step.required) || nextSteps.steps[0] || null;
  const readyState = validationSummary.ready
    ? 'ready-for-spawn'
    : (retryableGroups.length > 0 || operationalHealth.retryable ? 'retryable-hold' : (blockedGroups.length > 0 ? 'blocked' : 'review'));

  return {
    schemaVersion: 1,
    contractId: `${surfaceId}:preview-acceptance:${requestId}:${command.commandId}`,
    generatedAt: now,
    routeKey: `${scope.tenantId}/${scope.workspaceId}/${requestId}`,
    userVisibleState: admissionPreview.status,
    accepted: validationSummary.accepted,
    ready: validationSummary.ready,
    cancellable: validationSummary.cancellable,
    readyState,
    display: {
      label: admissionPreview.previewLabel,
      primaryAction: admissionPreview.primaryAction,
      nextRequiredAction: nextSteps.nextRequiredAction,
      primaryOwner: primaryNextStep?.owner || clientWorkflow.route.target,
      primaryStatus: primaryNextStep?.status || readyState,
      retryAfterMs: operationalHealth.retryAfterMs,
      blockingGroupCount: blockedGroups.length,
      retryableGroupCount: retryableGroups.length,
      warningGroupCount: warningGroups.length
    },
    acceptance: {
      decisionStatus: admissionPreview.decisionStatus,
      persistedStatus: admissionPreview.persistedStatus,
      restartSafeStatus: admissionPreview.restartSafeStatus,
      checkpointPhase: persistence.checkpoint.phase,
      checkpointNextCommand: persistence.checkpoint.nextCommandName,
      durableBeforeHandoff: persistence.writePlan.durableBeforeHandoff,
      externalHandoffState: externalHandoff.state,
      externalHandoffRef: externalHandoff.payloadRef,
      lifecycleControlState: lifecycleControls.state,
      lifecycleSchedulingMode: lifecycleControls.schedulingMode,
      scopeBoundaryAllowed: scopeBoundary.allowed,
      providerMissingCapabilityCount: providerNegotiation.missingProviderCapabilities.length
    },
    readiness: {
      state: validationSummary.state,
      groupCount: validationSummary.groups.length,
      passedGroupKeys: passedGroups.map((group) => group.key),
      blockedGroupKeys: blockedGroups.map((group) => group.key),
      retryableGroupKeys: retryableGroups.map((group) => group.key),
      warningGroupKeys: warningGroups.map((group) => group.key),
      primaryGroup: primaryBlockingGroup
        ? {
          key: primaryBlockingGroup.key,
          label: primaryBlockingGroup.label,
          status: primaryBlockingGroup.status,
          issueCount: primaryBlockingGroup.issueCount,
          nextAction: primaryBlockingGroup.nextAction || nextSteps.nextRequiredAction
        }
        : null,
      groups: validationSummary.groups.map((group) => ({
        key: group.key,
        label: group.label,
        status: group.status,
        issueCount: group.issueCount,
        nextAction: group.nextAction || null,
        retryAfterMs: Number.isInteger(group.retryAfterMs) ? group.retryAfterMs : null
      }))
    },
    nextStep: primaryNextStep
      ? {
        action: primaryNextStep.action,
        owner: primaryNextStep.owner,
        required: primaryNextStep.required === true,
        status: primaryNextStep.status,
        retryAfterMs: Number.isInteger(primaryNextStep.retryAfterMs) ? primaryNextStep.retryAfterMs : null,
        payloadRef: primaryNextStep.payloadRef || externalHandoff.payloadRef || null,
        recoveryToken: primaryNextStep.recoveryToken || persistence.current.recoveryToken || null
      }
      : {
        action: 'observe-admission-state',
        owner: clientWorkflow.route.target,
        required: false,
        status: readyState,
        retryAfterMs: null,
        payloadRef: externalHandoff.payloadRef,
        recoveryToken: persistence.current.recoveryToken
      },
    routeConsumption: {
      target: clientWorkflow.route.target,
      lane: clientWorkflow.lane,
      handoffRef: clientWorkflow.route.handoffRef,
      providerId: clientWorkflow.route.providerId,
      syncGeneration: clientWorkflow.route.syncGeneration,
      compartmentKey: clientWorkflow.route.compartmentKey,
      resumeCommand: clientWorkflow.commands.resume,
      cancelCommand: clientWorkflow.commands.cancel
    },
    validationSummary: {
      totalViolationCount: validationSummary.totalViolationCount,
      actionableBlockingCount: errorTriage.blockingCount,
      actionableRetryableCount: errorTriage.retryableCount,
      primaryActionableSource: errorTriage.primary?.source || null,
      primaryActionableAction: errorTriage.primary?.action || null,
      nextRetryAfterMs: errorTriage.nextRetry?.retryAfterMs || null
    },
    proofRefs: {
      persistenceKey: persistence.key,
      writeOperation: persistence.writePlan.operation,
      writeRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence,
      recoveryToken: persistence.current.recoveryToken,
      reportSnapshotId: `${command.commandId}:${persistence.current.status}`,
      externalHandoffRef: externalHandoff.payloadRef,
      scopeBoundaryProofId: scopeBoundary.proof.proofId
    }
  };
}

function buildRouteAcceptanceChecklist({ routePreviewAcceptance, validationSummary, nextSteps, errorTriage, now }) {
  const requiredStepsByGroup = new Map(
    nextSteps.steps
      .filter((step) => step.groupKey || step.action)
      .map((step) => [step.groupKey || step.action, step])
  );
  const items = validationSummary.groups.map((group, index) => {
    const matchingStep = requiredStepsByGroup.get(group.key) || requiredStepsByGroup.get(group.nextAction) || null;
    const routeVisible = group.status !== 'passed' || group.key === 'handoff-readiness';
    const blocking = group.status === 'blocked';
    const waiting = group.status === 'retryable' || group.status === 'queued';
    const warning = group.status === 'warning' || group.status === 'degraded';
    const state = blocking
      ? 'blocked'
      : (waiting ? 'waiting' : (warning ? 'attention' : 'ready'));
    const retryAfterMs = Number.isInteger(group.retryAfterMs)
      ? group.retryAfterMs
      : (Number.isInteger(matchingStep?.retryAfterMs) ? matchingStep.retryAfterMs : null);

    return {
      itemId: `${routePreviewAcceptance.contractId}:check:${index + 1}:${group.key}`,
      sequence: index + 1,
      key: group.key,
      label: group.label,
      state,
      status: group.status,
      required: group.status !== 'passed' || matchingStep?.required === true,
      routeVisible,
      issueCount: group.issueCount,
      action: group.nextAction || matchingStep?.action || (state === 'ready' ? 'observe-admission-state' : nextSteps.nextRequiredAction),
      owner: matchingStep?.owner || routePreviewAcceptance.display.primaryOwner,
      retryAfterMs,
      blockedBy: group.violations || group.blockedBy || [],
      previewAnchor: `${routePreviewAcceptance.routeConsumption.handoffRef || routePreviewAcceptance.routeKey}#${group.key}`,
      proofRef: `${routePreviewAcceptance.contractId}#check:${group.key}`
    };
  });
  const requiredItems = items.filter((item) => item.required);
  const actionableItems = items.filter((item) => item.state !== 'ready' || item.required);
  const blockingItems = items.filter((item) => item.state === 'blocked');
  const waitingItems = items.filter((item) => item.state === 'waiting');
  const attentionItems = items.filter((item) => item.state === 'attention');
  const firstUnresolved = blockingItems[0] || waitingItems[0] || attentionItems[0] || null;

  return {
    schemaVersion: 1,
    contract: 'aios.process-admission.route-acceptance-checklist.v1',
    generatedAt: now,
    checklistId: `${routePreviewAcceptance.contractId}:route-checklist`,
    ready: routePreviewAcceptance.ready,
    accepted: routePreviewAcceptance.accepted,
    state: routePreviewAcceptance.ready
      ? 'ready'
      : (waitingItems.length > 0 || errorTriage.retryableCount > 0 ? 'waiting-on-retry' : 'action-required'),
    counts: {
      total: items.length,
      required: requiredItems.length,
      actionable: actionableItems.length,
      blocking: blockingItems.length,
      waiting: waitingItems.length,
      attention: attentionItems.length,
      ready: items.filter((item) => item.state === 'ready').length
    },
    primaryItem: firstUnresolved,
    routeDecision: {
      target: routePreviewAcceptance.routeConsumption.target,
      lane: routePreviewAcceptance.routeConsumption.lane,
      acceptAction: routePreviewAcceptance.ready ? 'dispatch-hosted-kernel-spawn' : 'acknowledge-held-process-admission',
      nextRequiredAction: firstUnresolved?.action || nextSteps.nextRequiredAction,
      retryAfterMs: firstUnresolved?.retryAfterMs || errorTriage.nextRetry?.retryAfterMs || null
    },
    items
  };
}

function buildClientAcceptancePacket({
  command,
  requestId,
  scope,
  routePreviewAcceptance,
  validationSummary,
  nextSteps,
  clientWorkflow,
  externalHandoff,
  persistence,
  errorTriage,
  providerNegotiation,
  clientRuntimeAdoption,
  lifecycleControls,
  scopeBoundary,
  now
}) {
  const blockingGroups = validationSummary.groups.filter((group) => group.status === 'blocked');
  const retryableGroups = validationSummary.groups.filter((group) => group.status === 'retryable' || group.status === 'queued');
  const warningGroups = validationSummary.groups.filter((group) => group.status === 'warning' || group.status === 'degraded');
  const requiredSteps = nextSteps.steps.filter((step) => step.required === true);
  const clientActionableSteps = requiredSteps.filter((step) => (
    step.owner === 'client'
      || step.owner?.startsWith('client.')
      || step.action?.includes('client')
      || step.action === 'grant-actor-permissions'
  ));
  const acceptanceMode = routePreviewAcceptance.ready
    ? 'accept-and-dispatch'
    : (retryableGroups.length > 0 || errorTriage.retryableCount > 0 ? 'accept-and-wait' : 'accept-blocked-preview');
  const validationDigest = validationSummary.groups.map((group) => ({
    key: group.key,
    status: group.status,
    issueCount: group.issueCount,
    routeVisible: group.status !== 'passed' || group.key === 'handoff-readiness',
    nextAction: group.nextAction || (group.status === 'passed' ? 'observe-admission-state' : nextSteps.nextRequiredAction),
    retryAfterMs: Number.isInteger(group.retryAfterMs) ? group.retryAfterMs : null
  }));
  const acceptanceGates = validationSummary.groups.map((group, index) => {
    const matchingStep = nextSteps.steps.find((step) => step.groupKey === group.key || step.action === group.nextAction);
    const retryAfterMs = Number.isInteger(group.retryAfterMs)
      ? group.retryAfterMs
      : (Number.isInteger(matchingStep?.retryAfterMs) ? matchingStep.retryAfterMs : null);
    const blocked = group.status === 'blocked';
    const waiting = group.status === 'retryable' || group.status === 'queued';
    const warning = group.status === 'warning' || group.status === 'degraded';
    const actionable = blocked || waiting || warning || matchingStep?.required === true;

    return {
      gateId: `${routePreviewAcceptance.contractId}:gate:${index + 1}:${group.key}`,
      key: group.key,
      label: group.label,
      status: group.status,
      severity: blocked ? 'blocking' : (waiting ? 'waiting' : (warning ? 'warning' : 'passed')),
      required: group.status !== 'passed' || matchingStep?.required === true,
      actionable,
      routeVisible: actionable || group.key === 'handoff-readiness',
      issueCount: group.issueCount,
      action: group.nextAction || matchingStep?.action || (group.status === 'passed' ? 'observe-admission-state' : nextSteps.nextRequiredAction),
      owner: matchingStep?.owner || (blocked || waiting ? routePreviewAcceptance.display.primaryOwner : 'client.workflow.process-admission'),
      retryAfterMs,
      proofRef: `${routePreviewAcceptance.contractId}#${group.key}`
    };
  });
  const firstBlockingGate = acceptanceGates.find((gate) => gate.severity === 'blocking') || null;
  const firstWaitingGate = acceptanceGates.find((gate) => gate.severity === 'waiting') || null;
  const firstActionableGate = acceptanceGates.find((gate) => gate.actionable) || null;
  const primaryGate = firstBlockingGate || firstWaitingGate || firstActionableGate || acceptanceGates[0] || null;
  const gateCounts = acceptanceGates.reduce((counts, gate) => {
    counts[gate.severity] = (counts[gate.severity] || 0) + 1;
    return counts;
  }, {});
  const routeChecklist = buildRouteAcceptanceChecklist({
    routePreviewAcceptance,
    validationSummary,
    nextSteps,
    errorTriage,
    now
  });

  return {
    schemaVersion: 1,
    packetId: `${routePreviewAcceptance.contractId}:client-acceptance`,
    generatedAt: now,
    requestId,
    commandId: command.commandId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    routeKey: routePreviewAcceptance.routeKey,
    acceptanceMode,
    accepted: routePreviewAcceptance.accepted,
    readyForSpawn: routePreviewAcceptance.ready,
    routeTarget: routePreviewAcceptance.routeConsumption.target,
    workflowLane: clientWorkflow.lane,
    primaryAction: routePreviewAcceptance.display.primaryAction,
    nextRequiredAction: nextSteps.nextRequiredAction,
    clientActionRequired: clientActionableSteps.length > 0,
    acceptanceGates: {
      schemaVersion: 1,
      totalCount: acceptanceGates.length,
      actionableCount: acceptanceGates.filter((gate) => gate.actionable).length,
      blockingCount: gateCounts.blocking || 0,
      waitingCount: gateCounts.waiting || 0,
      warningCount: gateCounts.warning || 0,
      passedCount: gateCounts.passed || 0,
      primaryGate,
      gates: acceptanceGates
    },
    routeChecklist,
    commandAffordances: {
      accept: {
        enabled: routePreviewAcceptance.ready || acceptanceMode === 'accept-and-wait',
        action: routePreviewAcceptance.ready ? 'dispatch-hosted-kernel-spawn' : 'acknowledge-held-process-admission',
        target: routePreviewAcceptance.routeConsumption.target,
        payloadRef: externalHandoff.payloadRef
      },
      resume: routePreviewAcceptance.routeConsumption.resumeCommand,
      cancel: routePreviewAcceptance.routeConsumption.cancelCommand
    },
    readiness: {
      state: validationSummary.state,
      blockingGroupCount: blockingGroups.length,
      retryableGroupCount: retryableGroups.length,
      warningGroupCount: warningGroups.length,
      clientActionableStepCount: clientActionableSteps.length,
      digest: validationDigest
    },
    validationSummary: {
      totalViolationCount: validationSummary.totalViolationCount,
      actionableBlockingCount: errorTriage.blockingCount,
      actionableRetryableCount: errorTriage.retryableCount,
      providerMissingCapabilityCount: providerNegotiation.missingProviderCapabilities.length,
      providerServiceContractViolationCount: providerNegotiation.serviceContract.violationCount,
      clientRuntimeAdoptionState: clientRuntimeAdoption.state,
      lifecycleControlState: lifecycleControls.state,
      lifecycleScheduled: lifecycleControls.scheduled,
      scopeBoundaryAllowed: scopeBoundary.allowed
    },
    routeIntegration: {
      handoffRef: externalHandoff.payloadRef,
      externalHandoffState: externalHandoff.state,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      syncGeneration: externalHandoff.sync.generation,
      handoffAckMode: externalHandoff.acknowledgement.mode,
      compartmentKey: scopeBoundary.compartmentKey,
      clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId
    },
    proofRefs: {
      previewAcceptanceContractId: routePreviewAcceptance.contractId,
      persistenceKey: persistence.key,
      writeRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence,
      recoveryToken: persistence.current.recoveryToken,
      scopeBoundaryProofId: scopeBoundary.proof.proofId,
      providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId
    }
  };
}

function buildClientRouteActionManifest({
  command,
  requestId,
  scope,
  admissionPreview,
  routePreviewAcceptance,
  clientAcceptance,
  clientWorkflow,
  externalHandoff,
  persistence,
  providerNegotiation,
  clientRuntimeAdoption,
  nextSteps,
  errorTriage,
  lifecycleControls,
  scopeBoundary,
  now
}) {
  const acceptAffordance = clientAcceptance.commandAffordances.accept;
  const routeAction = routePreviewAcceptance.ready
    ? 'dispatch-hosted-kernel-spawn'
    : (clientAcceptance.acceptanceMode === 'accept-and-wait'
      ? 'acknowledge-held-process-admission'
      : nextSteps.nextRequiredAction);
  const routeState = routePreviewAcceptance.ready
    ? 'dispatchable'
    : (clientAcceptance.clientActionRequired
      ? 'client-action-required'
      : (errorTriage.retryableCount > 0 || lifecycleControls.scheduled ? 'waiting' : 'blocked'));
  const blockedBy = [
    errorTriage.blockingCount > 0 ? 'actionable-errors' : null,
    providerNegotiation.missingProviderCapabilities.length > 0 ? 'provider-capabilities' : null,
    providerNegotiation.serviceContract.violationCount > 0 ? 'provider-service-contract' : null,
    clientRuntimeAdoption.violationCount > 0 ? 'client-runtime-adoption' : null,
    !scopeBoundary.allowed ? 'scope-boundary' : null,
    lifecycleControls.violations.length > 0 ? 'lifecycle-controls' : null
  ].filter(Boolean);
  const routeTokenBasis = [
    surfaceId,
    requestId,
    command.commandId,
    scope.tenantId,
    scope.workspaceId,
    routePreviewAcceptance.contractId,
    clientAcceptance.packetId,
    persistence.current.writeRevision,
    persistence.current.journalSequence,
    externalHandoff.payloadRef
  ].join('|');

  return {
    schemaVersion: 1,
    manifestId: `${routePreviewAcceptance.contractId}:route-action`,
    generatedAt: now,
    routeKey: `${scope.tenantId}/${scope.workspaceId}/${requestId}`,
    routeState,
    userVisibleStatus: admissionPreview.status,
    action: {
      name: routeAction,
      enabled: acceptAffordance.enabled && blockedBy.length === 0,
      target: routePreviewAcceptance.routeConsumption.target,
      lane: clientWorkflow.lane,
      owner: routePreviewAcceptance.display.primaryOwner,
      label: admissionPreview.previewLabel,
      payloadRef: externalHandoff.payloadRef,
      retryAfterMs: routePreviewAcceptance.display.retryAfterMs
    },
    handoff: {
      externalState: externalHandoff.state,
      ackMode: externalHandoff.acknowledgement.mode,
      ackState: externalHandoff.acknowledgement.state,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      clientRuntimeContractId: clientRuntimeAdoption.workflow.handoffContractId,
      syncGeneration: externalHandoff.sync.generation
    },
    commands: {
      accept: acceptAffordance,
      resume: clientAcceptance.commandAffordances.resume,
      cancel: clientAcceptance.commandAffordances.cancel
    },
    clientState: {
      runtimeAdoptionState: clientRuntimeAdoption.state,
      runtimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction,
      actionRequired: clientAcceptance.clientActionRequired,
      nextRequiredAction: nextSteps.nextRequiredAction,
      blockedBy,
      primaryAcceptanceGate: clientAcceptance.acceptanceGates.primaryGate
        ? {
          key: clientAcceptance.acceptanceGates.primaryGate.key,
          severity: clientAcceptance.acceptanceGates.primaryGate.severity,
          action: clientAcceptance.acceptanceGates.primaryGate.action,
          owner: clientAcceptance.acceptanceGates.primaryGate.owner
        }
        : null
    },
    proofRefs: {
      routeToken: routeTokenBasis,
      previewAcceptanceContractId: routePreviewAcceptance.contractId,
      clientAcceptancePacketId: clientAcceptance.packetId,
      persistenceKey: persistence.key,
      writeRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence,
      scopeBoundaryProofId: scopeBoundary.proof.proofId,
      providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
      externalHandoffRef: externalHandoff.payloadRef
    }
  };
}

function buildWorkflowHandoffReceipt({
  command,
  requestId,
  scope,
  objective,
  ownerBinding,
  lifecycleEvidenceRefs,
  admissionPreview,
  validationSummary,
  clientWorkflow,
  clientAcceptance,
  clientRouteActionManifest,
  externalHandoff,
  persistence,
  providerNegotiation,
  clientRuntimeAdoption,
  lifecycleControls,
  scopeBoundary,
  errorTriage,
  nextSteps,
  now
}) {
  const firstRequiredStep = nextSteps.steps.find((step) => step.required === true) || null;
  const receiptState = command.name === 'cancel-admission'
    ? 'cancelled'
    : (validationSummary.ready
      ? 'ready-for-dispatch'
      : (clientAcceptance.clientActionRequired
        ? 'requires-client-action'
        : (errorTriage.retryableCount > 0 || lifecycleControls.scheduled ? 'waiting-on-runtime' : 'blocked')));
  const handoffEnabled = clientRouteActionManifest.action.enabled
    && externalHandoff.state === 'ready'
    && validationSummary.ready;
  const handoffReceiptBasis = [
    requestId,
    command.commandId,
    scope.isolationKey,
    receiptState,
    clientRouteActionManifest.manifestId,
    clientAcceptance.packetId,
    persistence.current.status,
    persistence.current.writeRevision,
    persistence.current.journalSequence,
    externalHandoff.payloadRef,
    clientRuntimeAdoption.workflow.handoffContractId
  ].join('|');

  return {
    schemaVersion: 1,
    receiptId: `${surfaceId}:workflow-handoff:${stableAdmissionHash(handoffReceiptBasis)}`,
    generatedAt: now,
    requestId,
    commandId: command.commandId,
    state: receiptState,
    handoffEnabled,
    userVisibleStatus: admissionPreview.status,
    userVisibleAction: command.name === 'cancel-admission'
      ? 'acknowledge-cancelled-admission'
      : (handoffEnabled ? 'dispatch-hosted-kernel-spawn' : nextSteps.nextRequiredAction),
    routeKey: `${scope.tenantId}/${scope.workspaceId}/${requestId}`,
    routeTarget: clientRouteActionManifest.action.target,
    workflowLane: clientWorkflow.lane,
    workflowState: clientWorkflow.state,
    owner: firstRequiredStep?.owner || clientRouteActionManifest.action.owner,
    firstRequiredAction: firstRequiredStep?.action || null,
    retryAfterMs: clientRouteActionManifest.action.retryAfterMs,
    commandAffordances: {
      accept: clientAcceptance.commandAffordances.accept,
      resume: clientAcceptance.commandAffordances.resume,
      cancel: clientAcceptance.commandAffordances.cancel
    },
    adoptionGate: {
      required: clientRuntimeAdoption.required,
      state: clientRuntimeAdoption.state,
      adopted: clientRuntimeAdoption.adopted,
      nextAction: clientRuntimeAdoption.workflow.nextAction,
      handoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
      syncCurrent: clientRuntimeAdoption.sync.current
    },
    runtimeContract: {
      externalHandoffState: externalHandoff.state,
      externalHandoffRef: externalHandoff.payloadRef,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
      acknowledgementState: externalHandoff.acknowledgement.state,
      acknowledgementMode: externalHandoff.acknowledgement.mode,
      syncGeneration: externalHandoff.sync.generation
    },
    durability: {
      persistenceKey: persistence.key,
      persistedStatus: persistence.current.status,
      checkpointPhase: persistence.checkpoint.phase,
      checkpointNextCommand: persistence.checkpoint.nextCommandName,
      durableBeforeHandoff: persistence.writePlan.durableBeforeHandoff,
      writeOperation: persistence.writePlan.operation,
      writeRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence,
      recoveryToken: persistence.current.recoveryToken
    },
    intake: {
      objectiveKey: objective.objectiveKey,
      objectivePresent: objective.present && !objective.empty,
      ownerId: ownerBinding.ownerId,
      ownerBindingId: ownerBinding.bindingId,
      ownerBindingAuthorized: ownerBinding.actorCanBind,
      intakeRef: lifecycleEvidenceRefs.intakeRef,
      intakeEvidenceProofId: lifecycleEvidenceRefs.proof.proofId
    },
    blockers: {
      actionableBlockingCount: errorTriage.blockingCount,
      actionableRetryableCount: errorTriage.retryableCount,
      blockedBy: clientRouteActionManifest.clientState.blockedBy,
      acceptanceGateBlockingCount: clientAcceptance.acceptanceGates.blockingCount,
      acceptanceGateWaitingCount: clientAcceptance.acceptanceGates.waitingCount,
      primaryAcceptanceGateKey: clientAcceptance.acceptanceGates.primaryGate?.key || null,
      validationBlockingGroupCount: validationSummary.blockingGroupCount,
      validationRetryableGroupCount: validationSummary.retryableGroupCount,
      lifecycleScheduled: lifecycleControls.scheduled,
      scopeBoundaryAllowed: scopeBoundary.allowed
    },
    proofRefs: {
      routeActionManifestId: clientRouteActionManifest.manifestId,
      clientAcceptancePacketId: clientAcceptance.packetId,
      clientWorkflowPersistenceKey: clientWorkflow.proofRefs.persistenceKey,
      scopeBoundaryProofId: scopeBoundary.proof.proofId,
      providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
      clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
      externalHandoffRef: externalHandoff.payloadRef,
      basis: handoffReceiptBasis
    }
  };
}

function normalizeObservedExit(input) {
  const runtime = asPlainObject(input.runtime);
  const process = asPlainObject(runtime.process || input.process);
  const exit = asPlainObject(input.exit || runtime.exit || process.exit || input.processExit);
  const rawExitCode = exit.exitCode ?? exit.code;
  const exitCode = Number.isInteger(rawExitCode)
    ? rawExitCode
    : null;
  const signal = textOrDefault(exit.signal || exit.signalName, null);
  const reason = textOrDefault(exit.reason || exit.message, null);
  const observedAt = textOrDefault(exit.observedAt || exit.exitedAt || exit.at || process.exitedAt, null);
  const expected = exit.expected === true || process.expectedExit === true;

  return {
    present: exitCode !== null || Boolean(signal || reason || observedAt),
    exitCode,
    signal,
    reason,
    expected,
    observedAt,
    source: textOrDefault(exit.source || process.source, 'runtime.process.exit')
  };
}

function classifyProcessExitState({ observedExit, admitted, commandCancelsAdmission, externalHandoff, validationSummary }) {
  if (observedExit.present) {
    if (observedExit.expected || observedExit.exitCode === 0) {
      return 'exited-cleanly';
    }

    if (observedExit.signal) {
      return 'terminated-by-signal';
    }

    return 'exited-with-error';
  }

  if (commandCancelsAdmission) {
    return 'cancelled-before-spawn';
  }

  if (!admitted) {
    return validationSummary.cancellable ? 'held-before-spawn' : 'blocked-before-spawn';
  }

  if (externalHandoff.acknowledgement.required && externalHandoff.acknowledgement.state === 'awaiting-provider-ack') {
    return 'awaiting-provider-ack';
  }

  return externalHandoff.state === 'ready' ? 'spawn-dispatchable' : 'handoff-blocked';
}

function buildProcessExitContract({
  input,
  command,
  requestId,
  scope,
  admitted,
  commandCancelsAdmission,
  persistence,
  externalHandoff,
  providerNegotiation,
  clientRuntimeAdoption,
  lifecycleControls,
  scopeBoundary,
  operationalHealth,
  validationSummary,
  nextSteps,
  now
}) {
  const observedExit = normalizeObservedExit(input);
  const state = classifyProcessExitState({
    observedExit,
    admitted,
    commandCancelsAdmission,
    externalHandoff,
    validationSummary
  });
  const terminal = [
    'exited-cleanly',
    'exited-with-error',
    'terminated-by-signal',
    'cancelled-before-spawn'
  ].includes(state);
  const failed = state === 'exited-with-error' || state === 'terminated-by-signal';
  const owner = failed
    ? providerNegotiation.serviceContract.owner
    : (commandCancelsAdmission
      ? 'client.workflow.process-admission'
      : (admitted ? 'kernel.lifecycle.spawn' : nextSteps.steps.find((step) => step.required)?.owner || 'client.workflow.process-admission'));
  const nextAction = failed
    ? 'inspect-hosted-kernel-process-exit'
    : (state === 'spawn-dispatchable'
      ? 'dispatch-hosted-kernel-spawn'
      : (state === 'awaiting-provider-ack'
        ? 'await-provider-spawn-acknowledgement'
        : (terminal ? 'observe-terminal-admission-state' : nextSteps.nextRequiredAction)));
  const evidenceRefs = {
    persistenceKey: persistence.key,
    checkpointRef: `${persistence.key}#${persistence.checkpoint.phase}`,
    recoveryToken: persistence.current.recoveryToken,
    externalHandoffRef: externalHandoff.payloadRef,
    providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
    scopeBoundaryProofId: scopeBoundary.proof.proofId,
    lifecycleControlProofId: lifecycleControls.proof.proofId,
    clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
    reportSnapshotId: `${command.commandId}:${persistence.current.status}`
  };
  const proofBasis = [
    requestId,
    command.commandId,
    state,
    persistence.current.status,
    persistence.current.writeRevision,
    persistence.current.journalSequence,
    externalHandoff.state,
    externalHandoff.acknowledgement.state,
    observedExit.exitCode ?? 'none',
    observedExit.signal || 'none'
  ].join('|');
  let hash = 0;

  for (let index = 0; index < proofBasis.length; index += 1) {
    hash = ((hash * 43) + proofBasis.charCodeAt(index)) >>> 0;
  }

  return {
    schemaVersion: 1,
    contractId: `${surfaceId}:exit:${requestId}:${command.commandId}`,
    generatedAt: now,
    state,
    terminal,
    successful: state === 'exited-cleanly' || state === 'cancelled-before-spawn',
    failed,
    owner,
    nextAction,
    requestId,
    commandId: command.commandId,
    commandName: command.name,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    process: {
      admitted,
      dispatchable: admitted && externalHandoff.state === 'ready',
      handoffState: externalHandoff.state,
      acknowledgementState: externalHandoff.acknowledgement.state,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      payloadRef: externalHandoff.payloadRef
    },
    observedExit,
    lifecycle: {
      persistedStatus: persistence.current.status,
      checkpointPhase: persistence.checkpoint.phase,
      checkpointNextCommand: persistence.checkpoint.nextCommandName,
      restartSafe: persistence.checkpoint.restartSafe,
      recoveryMode: persistence.recovery.mode,
      recoveryAction: persistence.recovery.action,
      writeRevision: persistence.current.writeRevision,
      journalSequence: persistence.current.journalSequence
    },
    readiness: {
      readyForSpawn: validationSummary.ready,
      state: validationSummary.state,
      blockingGroupCount: validationSummary.blockingGroupCount,
      retryableGroupCount: validationSummary.retryableGroupCount,
      operationalHealthState: operationalHealth.state,
      retryAfterMs: operationalHealth.retryAfterMs
    },
    evidenceRefs,
    proof: {
      schemaVersion: 1,
      proofType: 'hosted-kernel-process-exit-contract',
      proofId: `${surfaceId}:exit:${hash.toString(16).padStart(8, '0')}`,
      basis: proofBasis,
      generatedAt: now
    }
  };
}

function buildAdmissionContract(input, now) {
  const request = asPlainObject(input.request);
  const client = asPlainObject(input.client);
  const runtime = asPlainObject(input.runtime);
  const persistedState = normalizePersistedAdmissionState(input, now);
  const command = normalizeAdmissionCommand(input, now);
  const scope = normalizeScope(input);
  const actor = normalizeActor(input, scope);

  const requestId = textOrDefault(request.requestId || input.requestId, `admission-${now}`);
  const intent = textOrDefault(request.intent || input.intent, 'continue-kernel-lifecycle');
  const clientState = textOrDefault(client.state || input.clientState, 'anonymous');
  const runtimeMode = textOrDefault(runtime.mode || input.runtimeMode, 'hosted-kernel');
  const priority = textOrDefault(request.priority || input.priority, 'normal');
  const requestedCapabilities = normalizeList(request.capabilities || input.capabilities);
  const clientCapabilities = new Set(normalizeList(client.capabilities || input.clientCapabilities));
  const objective = normalizeProcessObjective({
    input,
    command,
    requestId,
    intent,
    scope,
    now
  });
  const ownerBinding = buildOwnerBinding({
    input,
    command,
    requestId,
    scope,
    actor,
    objective,
    now
  });
  const lifecycleEvidenceRefs = buildInitialLifecycleEvidenceRefs({
    requestId,
    command,
    scope,
    actor,
    objective,
    ownerBinding,
    now
  });
  const health = normalizeOperationalHealth(input, now);
  const operationalHealth = buildOperationalHealthDecision(health);
  const requiresHostedKernel = runtimeMode === 'hosted-kernel';
  const providerContract = normalizeProviderContract(input);
  const admissionPolicy = buildAdmissionPolicyDecision({
    policy: normalizeAdmissionPolicy(input),
    runtimeMode,
    health,
    operationalHealth,
    providerContract
  });
  const providerNegotiation = buildProviderNegotiation({
    providerContract,
    requestedCapabilities,
    requiresHostedKernel,
    scope,
    now
  });
  const clientRuntimeAdoption = buildClientRuntimeAdoption({
    client,
    runtime,
    clientState,
    requiresHostedKernel,
    providerContract,
    providerNegotiation,
    scope,
    command,
    requestId,
    now
  });
  const lifecycleControls = buildLifecycleControlDecision({
    controls: normalizeLifecycleControls(input),
    command,
    actor,
    now
  });
  const scopeBoundary = buildScopeBoundaryDecision({
    policy: normalizeScopeBoundaryPolicy(input),
    scope,
    actor,
    persistedState,
    command,
    requestId,
    now
  });

  const violations = [];
  if (!KNOWN_CLIENT_STATES.has(clientState)) {
    violations.push({
      field: 'client.state',
      code: 'unknown_client_state',
      message: `client.state must be one of ${Array.from(KNOWN_CLIENT_STATES).join(', ')}`
    });
  }

  if (!KNOWN_RUNTIME_MODES.has(runtimeMode)) {
    violations.push({
      field: 'runtime.mode',
      code: 'unknown_runtime_mode',
      message: `runtime.mode must be one of ${Array.from(KNOWN_RUNTIME_MODES).join(', ')}`
    });
  }

  if (!KNOWN_REQUEST_PRIORITIES.has(priority)) {
    violations.push({
      field: 'request.priority',
      code: 'unknown_priority',
      message: `request.priority must be one of ${Array.from(KNOWN_REQUEST_PRIORITIES).join(', ')}`
    });
  }

  if (!KNOWN_ADMISSION_COMMANDS.has(command.name)) {
    violations.push({
      field: 'command.name',
      code: 'unknown_admission_command',
      message: `command.name must be one of ${Array.from(KNOWN_ADMISSION_COMMANDS).join(', ')}`
    });
  }

  if (!actor.roleKnown) {
    violations.push({
      field: 'actor.role',
      code: 'unknown_actor_role',
      actualRole: actor.requestedRole,
      effectiveRole: actor.effectiveRole,
      message: `actor.role must be one of ${Array.from(KNOWN_ACTOR_ROLES).join(', ')}`
    });
  }

  appendAdmissionIntakeViolations(violations, objective, ownerBinding);

  if (!KNOWN_PROVIDER_STATES.has(providerContract.state)) {
    violations.push({
      field: 'provider.state',
      code: 'unknown_provider_state',
      message: `provider.state must be one of ${Array.from(KNOWN_PROVIDER_STATES).join(', ')}`
    });
  }

  if (requiresHostedKernel && providerContract.state === 'unavailable') {
    violations.push({
      field: 'provider.state',
      code: 'hosted_kernel_provider_unavailable',
      providerId: providerContract.providerId
    });
  }

  const missingCapabilities = requestedCapabilities.filter((capability) => !clientCapabilities.has(capability));
  if (missingCapabilities.length > 0) {
    violations.push({
      field: 'request.capabilities',
      code: 'missing_client_capability',
      missingCapabilities
    });
  }

  if (providerNegotiation.missingProviderCapabilities.length > 0) {
    violations.push({
      field: 'provider.capabilities',
      code: 'missing_provider_capability',
      providerId: providerContract.providerId,
      missingCapabilities: providerNegotiation.missingProviderCapabilities
    });
  }

  violations.push(...providerNegotiation.serviceContract.violations);

  appendScopeViolations(violations, scope, actor);
  appendPersistedScopeViolations(violations, persistedState, scope);
  appendPersistedCheckpointViolations(violations, persistedState, requestId);
  if (persistedState.found && !persistedState.statusContract.known) {
    violations.push({
      field: 'persistedAdmission.current.status',
      code: 'unknown_persisted_admission_status',
      actualStatus: persistedState.status,
      recoveryAction: persistedState.statusContract.recoveryAction,
      message: `persistedAdmission.current.status must be one of ${Array.from(KNOWN_PERSISTED_STATUSES).join(', ')}`
    });
  }
  if (persistedState.expiration.expired && command.name !== 'recover-admission' && command.name !== 'cancel-admission') {
    violations.push({
      field: 'persistedAdmission.expiration',
      code: 'persisted_admission_hold_expired',
      persistedStatus: persistedState.status,
      deadlineAt: persistedState.expiration.deadlineAt,
      ageMs: persistedState.expiration.ageMs,
      recoveryAction: persistedState.expiration.recoveryAction,
      message: 'Persisted process admission hold expired; recover or cancel it before appending a new admission event.'
    });
  }
  violations.push(...operationalHealth.violations);
  violations.push(...admissionPolicy.violations);
  violations.push(...clientRuntimeAdoption.violations);
  violations.push(...lifecycleControls.violations);
  violations.push(...scopeBoundary.violations);

  const permissionDecision = buildPermissionDecision(command.name, actor);
  if (permissionDecision.grantScope.rejectedRequiredGrantCount > 0) {
    violations.push({
      field: 'actor.permissions',
      code: 'required_actor_permission_grant_outside_scope',
      requiredPermissions: permissionDecision.required,
      rejectedRequiredGrantCount: permissionDecision.grantScope.rejectedRequiredGrantCount,
      rejectedGrants: permissionDecision.grantScope.rejected
        .filter((grant) => permissionDecision.required.includes(grant.permission))
    });
  }

  if (!permissionDecision.allowed) {
    violations.push({
      field: 'actor.permissions',
      code: 'missing_actor_permission',
      requiredPermissions: permissionDecision.required,
      missingPermissions: permissionDecision.missing
    });
  }

  const commandCancelsAdmission = command.name === 'cancel-admission';
  const admitted = !commandCancelsAdmission
    && violations.length === 0
    && (!requiresHostedKernel || clientState !== 'anonymous')
    && clientRuntimeAdoption.adopted
    && (!requiresHostedKernel || providerNegotiation.satisfied)
    && admissionPolicy.satisfied
    && lifecycleControls.allowed
    && scopeBoundary.allowed
    && !operationalHealth.blocked;
  const decision = commandCancelsAdmission ? 'cancel' : (admitted ? 'admit' : 'hold');
  const handoffTarget = commandCancelsAdmission
    ? 'kernel.lifecycle.admission.cancelled'
    : (admitted
      ? (operationalHealth.degradedMode ? 'kernel.lifecycle.spawn.degraded' : 'kernel.lifecycle.spawn')
      : (!scopeBoundary.allowed ? 'kernel.security.scope-boundary' : (operationalHealth.retryable ? 'kernel.lifecycle.process-admission.retry' : 'client.workflow.authorize')));
  const decisionReason = commandCancelsAdmission
    ? 'request_cancelled_before_process_spawn'
    : (admitted
      ? (operationalHealth.degradedMode
        ? 'request_admitted_with_degraded_runtime_health'
        : 'request_satisfies_process_admission_contract')
      : (providerNegotiation.missingProviderCapabilities.length > 0
        ? 'hosted_kernel_provider_contract_requires_capability_remediation'
        : (providerNegotiation.serviceContract.violationCount > 0
          ? 'hosted_kernel_provider_service_contract_requires_remediation'
          : (!lifecycleControls.allowed
          ? 'lifecycle_controls_require_operator_action'
          : (!scopeBoundary.allowed
            ? 'tenant_workspace_scope_boundary_requires_remediation'
            : (operationalHealth.retryable
          ? 'runtime_health_requires_retry_before_process_spawn'
          : 'request_requires_client_or_contract_remediation'))))));
  const draftAdmission = {
    request: { requestId, objective, ownerBinding, lifecycleEvidenceRefs },
    client: { state: clientState },
    runtime: {
      hostedKernelRequired: requiresHostedKernel,
      health: {
        blocked: operationalHealth.blocked,
        retryable: operationalHealth.retryable,
        retryAfterMs: operationalHealth.retryAfterMs,
        degradedMode: operationalHealth.degradedMode
      }
    },
    scope,
    decision: { admitted, violations }
  };
  const recovery = buildRecoveryPlan(persistedState, draftAdmission, command);
  const persistence = buildPersistenceEnvelope(
    draftAdmission,
    persistedState,
    command,
    recovery,
    now,
    providerContract,
    providerNegotiation
  );
  const effectiveOutcome = buildEffectiveAdmissionOutcome({
    commandCancelsAdmission,
    admitted,
    decision,
    handoffTarget,
    reason: decisionReason,
    persistence,
    recovery
  });
  const effectiveAdmitted = effectiveOutcome.admitted;
  const effectiveDecision = effectiveOutcome.status;
  const effectiveHandoffTarget = effectiveOutcome.handoffTarget;
  const effectiveCommandCancelsAdmission = effectiveOutcome.commandCancelsAdmission;
  const externalHandoff = buildExternalHandoffState({
    commandCancelsAdmission: effectiveCommandCancelsAdmission,
    admitted: effectiveAdmitted,
    operationalHealth,
    providerContract,
    providerNegotiation,
    admissionPolicy,
    lifecycleControls,
    scopeBoundary,
    requestId,
    scope,
    command,
    now
  });
  const validationSummary = buildValidationSummary({
    admitted: effectiveAdmitted,
    commandCancelsAdmission: effectiveCommandCancelsAdmission,
    violations,
    objective,
    ownerBinding,
    lifecycleEvidenceRefs,
    missingCapabilities,
    missingProviderCapabilities: providerNegotiation.missingProviderCapabilities,
    permissionDecision,
    operationalHealth,
    health,
    providerNegotiation,
    clientRuntimeAdoption,
    externalHandoff,
    admissionPolicy,
    lifecycleControls,
    scopeBoundary,
    persistence,
    recovery,
    scope,
    clientState,
    requiresHostedKernel
  });
  const admissionPreview = buildAdmissionPreview({
    decision: effectiveDecision,
    handoffTarget: effectiveHandoffTarget,
    persistence,
    recovery,
    validationSummary,
    externalHandoff,
    operationalHealth,
    lifecycleControls
  });
  const nextSteps = buildExplainableNextSteps({
    commandCancelsAdmission: effectiveCommandCancelsAdmission,
    admitted: effectiveAdmitted,
    objective,
    ownerBinding,
    lifecycleEvidenceRefs,
    missingCapabilities,
    permissionDecision,
    providerNegotiation,
    admissionPolicy,
    lifecycleControls,
    scopeBoundary,
    operationalHealth,
    externalHandoff,
    recovery,
    persistence
  });
  const actionableErrors = [
    ...operationalHealth.actionableErrors,
    ...(persistedState.found && !persistedState.statusContract.known ? [{
      code: 'unknown_persisted_admission_status',
      message: 'Persisted process admission status is not recognized; quarantine and repair the envelope before appending a new admission event.',
      owner: 'kernel.persistence.recovery',
      action: persistedState.statusContract.recoveryAction,
      retryable: false,
      retryAfterMs: null,
      field: 'persistedAdmission.current.status'
    }] : []),
    ...(persistedState.expiration.expired && recovery.mode === 'expired-hold' ? [{
      code: 'persisted_admission_hold_expired',
      message: 'Persisted process admission hold expired; recover or cancel it before appending a new admission event.',
      owner: 'kernel.persistence.recovery',
      action: recovery.canResume ? recovery.action : 'cancel-expired-admission-hold',
      retryable: recovery.canResume,
      retryAfterMs: recovery.canResume ? 0 : null,
      field: 'persistedAdmission.expiration'
    }] : []),
    ...providerNegotiation.serviceContract.actionableErrors,
    ...admissionPolicy.actionableErrors,
    ...clientRuntimeAdoption.actionableErrors,
    ...lifecycleControls.actionableErrors,
    ...scopeBoundary.actionableErrors
  ];
  const errorTriage = buildActionableErrorTriage({
    actionableErrors,
    violations,
    operationalHealth,
    lifecycleControls,
    scopeBoundary,
    providerNegotiation,
    permissionDecision,
    persistence,
    command,
    requestId,
    scope,
    now
  });
  const clientWorkflow = buildClientWorkflowHandoff({
    command,
    requestId,
    intent,
    scope,
    objective,
    ownerBinding,
    lifecycleEvidenceRefs,
    clientState,
    admissionPreview,
    validationSummary,
    nextSteps,
    errorTriage,
    externalHandoff,
    persistence,
    recovery,
    operationalHealth,
    permissionDecision,
    missingCapabilities,
    providerNegotiation,
    clientRuntimeAdoption,
    admissionPolicy,
    lifecycleControls,
    scopeBoundary,
    commandCancelsAdmission: effectiveCommandCancelsAdmission,
    now
  });
  const routePreviewAcceptance = buildRoutePreviewAcceptance({
    command,
    requestId,
    scope,
    admissionPreview,
    validationSummary,
    nextSteps,
    clientWorkflow,
    errorTriage,
    externalHandoff,
    persistence,
    operationalHealth,
    lifecycleControls,
    scopeBoundary,
    providerNegotiation,
    now
  });
  const clientAcceptance = buildClientAcceptancePacket({
    command,
    requestId,
    scope,
    routePreviewAcceptance,
    validationSummary,
    nextSteps,
    clientWorkflow,
    externalHandoff,
    persistence,
    errorTriage,
    providerNegotiation,
    clientRuntimeAdoption,
    lifecycleControls,
    scopeBoundary,
    now
  });
  const clientRouteActionManifest = buildClientRouteActionManifest({
    command,
    requestId,
    scope,
    admissionPreview,
    routePreviewAcceptance,
    clientAcceptance,
    clientWorkflow,
    externalHandoff,
    persistence,
    providerNegotiation,
    clientRuntimeAdoption,
    nextSteps,
    errorTriage,
    lifecycleControls,
    scopeBoundary,
    now
  });
  const workflowHandoffReceipt = buildWorkflowHandoffReceipt({
    command,
    requestId,
    scope,
    objective,
    ownerBinding,
    lifecycleEvidenceRefs,
    admissionPreview,
    validationSummary,
    clientWorkflow,
    clientAcceptance,
    clientRouteActionManifest,
    externalHandoff,
    persistence,
    providerNegotiation,
    clientRuntimeAdoption,
    lifecycleControls,
    scopeBoundary,
    errorTriage,
    nextSteps,
    now
  });
  const exitContract = buildProcessExitContract({
    input,
    command,
    requestId,
    scope,
    admitted: effectiveAdmitted,
    commandCancelsAdmission: effectiveCommandCancelsAdmission,
    persistence,
    externalHandoff,
    providerNegotiation,
    clientRuntimeAdoption,
    lifecycleControls,
    scopeBoundary,
    operationalHealth,
    validationSummary,
    nextSteps,
    now
  });
  const audit = {
    target: 'kernel.audit.process-admission',
    eventType: 'kernel.lifecycle.process-admission.decision',
    subject: {
      requestId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorId: actor.actorId,
      ownerId: ownerBinding.ownerId,
      objectiveKey: objective.objectiveKey
    },
    decision: effectiveDecision,
    admitted: effectiveAdmitted,
    decisionSource: effectiveOutcome.source,
    decisionReason: effectiveOutcome.reason,
    violations: violations.map((violation) => violation.code),
    operationalHealthState: operationalHealth.state,
    operationalFailureState: operationalHealth.failure.state,
    operationalFailureIncidentCount: operationalHealth.failure.incidentCount,
    operationalFailurePrimaryOwner: operationalHealth.failure.primaryOwner,
    operationalFailurePrimaryAction: operationalHealth.failure.primaryAction,
    handoffTarget: effectiveHandoffTarget,
    externalHandoffState: externalHandoff.state,
    routePreviewAcceptanceReadyState: routePreviewAcceptance.readyState,
    routePreviewAcceptanceRouteTarget: routePreviewAcceptance.routeConsumption.target,
    routePreviewAcceptancePrimaryAction: routePreviewAcceptance.display.primaryAction,
    clientAcceptancePacketId: clientAcceptance.packetId,
    clientAcceptanceMode: clientAcceptance.acceptanceMode,
    clientAcceptanceCommandEnabled: clientAcceptance.commandAffordances.accept.enabled,
    clientAcceptanceGateCount: clientAcceptance.acceptanceGates.totalCount,
    clientAcceptanceBlockingGateCount: clientAcceptance.acceptanceGates.blockingCount,
    clientAcceptanceWaitingGateCount: clientAcceptance.acceptanceGates.waitingCount,
    clientAcceptancePrimaryGateKey: clientAcceptance.acceptanceGates.primaryGate?.key || null,
    clientAcceptancePrimaryGateAction: clientAcceptance.acceptanceGates.primaryGate?.action || null,
    clientRouteActionManifestId: clientRouteActionManifest.manifestId,
    clientRouteActionState: clientRouteActionManifest.routeState,
    clientRouteActionName: clientRouteActionManifest.action.name,
    clientRouteActionEnabled: clientRouteActionManifest.action.enabled,
    workflowHandoffReceiptId: workflowHandoffReceipt.receiptId,
    workflowHandoffReceiptState: workflowHandoffReceipt.state,
    workflowHandoffReceiptAction: workflowHandoffReceipt.userVisibleAction,
    workflowHandoffReceiptEnabled: workflowHandoffReceipt.handoffEnabled,
    exitContractId: exitContract.contractId,
    exitContractState: exitContract.state,
    exitContractOwner: exitContract.owner,
    exitContractNextAction: exitContract.nextAction,
    exitContractTerminal: exitContract.terminal,
    exitContractFailed: exitContract.failed,
    exitContractProofId: exitContract.proof.proofId,
    lifecycleControlState: lifecycleControls.state,
    lifecycleControlEnabled: lifecycleControls.enabled,
    lifecycleSchedulingMode: lifecycleControls.schedulingMode,
    lifecycleControlNextAction: lifecycleControls.nextAction,
    lifecycleSettingCommandName: lifecycleControls.settingCommand.name,
    lifecycleSettingCommandCanApply: lifecycleControls.settingCommand.canApply,
    lifecycleSchedulingWindowState: lifecycleControls.schedulingWindow.state,
    lifecycleControlProofId: lifecycleControls.proof.proofId,
    scopeBoundaryPolicyId: scopeBoundary.policyId,
    scopeBoundaryMode: scopeBoundary.mode,
    scopeBoundaryAllowed: scopeBoundary.allowed,
    scopeBoundaryViolationCount: scopeBoundary.violationCount,
    scopeBoundaryAuditSink: scopeBoundary.audit.sink,
    scopeBoundaryCompartmentKey: scopeBoundary.compartmentKey,
    scopeBoundaryProofId: scopeBoundary.proof.proofId,
    scopeTenantSource: scope.tenantSource,
    scopeWorkspaceSource: scope.workspaceSource,
    scopeDefaulted: scope.scopeSource.defaulted,
    actorRequestedRole: actor.requestedRole,
    actorEffectiveRole: actor.effectiveRole,
    actorRoleFallbackApplied: actor.roleKnown === false,
    actorActivePermissionGrantCount: actor.activePermissionGrants.length,
    actorRejectedPermissionGrantCount: actor.rejectedPermissionCount,
    actorRejectedRequiredGrantCount: permissionDecision.grantScope.rejectedRequiredGrantCount,
    objectiveKey: objective.objectiveKey,
    objectiveOrigin: objective.origin,
    objectivePresent: objective.present,
    processOwnerId: ownerBinding.ownerId,
    processOwnerBindingId: ownerBinding.bindingId,
    processOwnerActorCanBind: ownerBinding.actorCanBind,
    initialLifecycleEvidenceRef: lifecycleEvidenceRefs.initialCheckpointRef,
    providerId: providerContract.providerId,
    providerServiceContractId: providerNegotiation.serviceContract.contractId,
    providerServiceContractViolationCount: providerNegotiation.serviceContract.violationCount,
    providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
    providerSyncFreshnessState: providerNegotiation.syncMetadata.freshness.state,
    providerHandoffAckMode: providerNegotiation.serviceContract.handoffAckMode,
    clientRuntimeAdoptionState: clientRuntimeAdoption.state,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction,
    clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
    admissionPolicyId: admissionPolicy.policyId,
    admissionPolicyMode: admissionPolicy.mode,
    admissionPolicySatisfied: admissionPolicy.satisfied,
    admissionPolicyViolationCount: admissionPolicy.violationCount,
    actionableErrorCount: actionableErrors.length,
    actionableErrorTriageCount: errorTriage.totalCount,
    actionableErrorBlockingCount: errorTriage.blockingCount,
    actionableErrorRetryableCount: errorTriage.retryableCount,
    actionableErrorPrimarySource: errorTriage.primary?.source || null,
    actionableErrorPrimaryAction: errorTriage.primary?.action || null,
    persistenceKey: persistence.key,
    persistenceWriteOperation: persistence.writePlan.operation,
    persistenceWriteRevision: persistence.current.writeRevision,
    journalSequence: persistence.current.journalSequence,
    persistenceRestartConsistency: persistence.restartLedger.consistency,
    persistedStatusKnown: persistence.restartLedger.statusContract.known,
    persistedStatusCategory: persistence.restartLedger.statusContract.category,
    persistedStatusRecoveryAction: persistence.restartLedger.statusContract.recoveryAction,
    persistenceLeaseState: persistence.restartLedger.lease.state,
    persistenceLeaseRestartAction: persistence.restartLedger.lease.restartAction,
    persistenceExpirationState: persistence.restartLedger.expiration.state,
    persistenceExpirationDeadlineAt: persistence.restartLedger.expiration.deadlineAt,
    persistenceExpirationRecoveryAction: persistence.restartLedger.expiration.recoveryAction,
    replayReceiptStatus: persistence.restartLedger.replayStatus,
    idempotencyReplayBasis: persistence.idempotency.replayBasis,
    generatedAt: now
  };
  const reporting = buildAdmissionReporting({
    input,
    command,
    requestId,
    scope,
    actor,
    objective,
    ownerBinding,
    lifecycleEvidenceRefs,
    clientState,
    runtimeMode,
    priority,
    decision: effectiveDecision,
    admitted: effectiveAdmitted,
    violations,
    actionableErrors,
    errorTriage,
    persistence,
    recovery,
    handoffTarget: effectiveHandoffTarget,
    operationalHealth,
    health,
    missingCapabilities,
    missingProviderCapabilities: providerNegotiation.missingProviderCapabilities,
    clientRuntimeAdoption,
    admissionPolicy,
    lifecycleControls,
    scopeBoundary,
    providerNegotiation,
    externalHandoff,
    permissionDecision,
    validationSummary,
    admissionPreview,
    clientWorkflow,
    routePreviewAcceptance,
    nextSteps,
    exitContract,
    now
  });

  return {
    version: 1,
    command,
    request: {
      requestId,
      intent,
      priority,
      requestedCapabilities,
      objective,
      ownerBinding,
      lifecycleEvidenceRefs
    },
    scope,
    actor: {
      actorId: actor.actorId,
      role: actor.role,
      requestedRole: actor.requestedRole,
      effectiveRole: actor.effectiveRole,
      roleKnown: actor.roleKnown,
      permissionSource: actor.permissionSource,
      permissionCount: actor.permissions.length,
      inheritedPermissionCount: actor.inheritedPermissionCount,
      explicitPermissionCount: actor.explicitPermissions.length,
      activePermissionGrantCount: actor.activePermissionGrants.length,
      rejectedPermissionGrantCount: actor.rejectedPermissionCount,
      activePermissionGrants: actor.activePermissionGrants.map((grant) => ({
        grantId: grant.grantId,
        permission: grant.permission,
        isolationKey: grant.isolationKey,
        source: grant.source,
        scoped: grant.scoped
      })),
      rejectedPermissionGrants: actor.rejectedPermissionGrants.map((grant) => ({
        grantId: grant.grantId,
        permission: grant.permission,
        expectedTenantId: grant.expectedTenantId,
        expectedWorkspaceId: grant.expectedWorkspaceId,
        actualTenantId: grant.actualTenantId,
        actualWorkspaceId: grant.actualWorkspaceId,
        reason: grant.reason
      })),
      sessionId: actor.sessionId,
      ownerBindingId: ownerBinding.bindingId,
      boundOwnerId: ownerBinding.ownerId
    },
    client: {
      state: clientState,
      capabilityCount: clientCapabilities.size,
      sessionId: textOrDefault(client.sessionId || input.sessionId, null),
      runtimeAdoption: clientRuntimeAdoption
    },
    provider: {
      providerId: providerContract.providerId,
      serviceName: providerContract.serviceName,
      state: providerContract.state,
      protocol: providerContract.protocol,
      endpoint: providerContract.endpoint,
      region: providerContract.region,
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      negotiatedCapabilities: providerNegotiation.negotiatedCapabilities,
      missingCapabilities: providerNegotiation.missingProviderCapabilities,
      unsupportedRequestedCapabilities: providerNegotiation.unsupportedRequestedCapabilities,
      routing: providerNegotiation.routing,
      sync: providerNegotiation.syncMetadata,
      serviceContract: providerNegotiation.serviceContract
    },
    admissionPolicy: {
      schemaVersion: admissionPolicy.schemaVersion,
      policyId: admissionPolicy.policyId,
      mode: admissionPolicy.mode,
      enforced: admissionPolicy.enforced,
      satisfied: admissionPolicy.satisfied,
      violationCount: admissionPolicy.violationCount,
      warningCount: admissionPolicy.warningCount,
      limits: admissionPolicy.limits,
      usage: admissionPolicy.usage,
      violations: admissionPolicy.violations,
      warnings: admissionPolicy.warnings
    },
    lifecycleControls: {
      schemaVersion: lifecycleControls.schemaVersion,
      state: lifecycleControls.state,
      enabled: lifecycleControls.enabled,
      settingsVersion: lifecycleControls.settingsVersion,
      settingsRevision: lifecycleControls.settingsRevision,
      commandEnabled: lifecycleControls.commandEnabled,
      schedulingMode: lifecycleControls.schedulingMode,
      scheduled: lifecycleControls.scheduled,
      queueName: lifecycleControls.queueName,
      scheduleAfterMs: lifecycleControls.scheduleAfterMs,
      nextAction: lifecycleControls.nextAction,
      settingCommand: lifecycleControls.settingCommand,
      commandAcknowledgement: lifecycleControls.commandAcknowledgement,
      schedulingWindow: lifecycleControls.schedulingWindow,
      settingsValidation: lifecycleControls.settingsValidation,
      proof: lifecycleControls.proof,
      violationCount: lifecycleControls.violations.length,
      warningCount: lifecycleControls.warnings.length,
      violations: lifecycleControls.violations,
      warnings: lifecycleControls.warnings,
      audit: lifecycleControls.audit
    },
    scopeBoundary: {
      schemaVersion: scopeBoundary.schemaVersion,
      policyId: scopeBoundary.policyId,
      mode: scopeBoundary.mode,
      enforced: scopeBoundary.enforced,
      allowed: scopeBoundary.allowed,
      handoffAllowed: scopeBoundary.handoffAllowed,
      isolationKey: scopeBoundary.isolationKey,
      routePartition: scopeBoundary.routePartition,
      compartmentKey: scopeBoundary.compartmentKey,
      scopeSources: scopeBoundary.scopeSources,
      proof: scopeBoundary.proof,
      violationCount: scopeBoundary.violationCount,
      warningCount: scopeBoundary.warningCount,
      violations: scopeBoundary.violations,
      warnings: scopeBoundary.warnings,
      audit: scopeBoundary.audit
    },
    runtime: {
      mode: runtimeMode,
      hostedKernelRequired: requiresHostedKernel,
      admissionQueue: textOrDefault(runtime.admissionQueue || input.admissionQueue, 'kernel-lifecycle'),
      health: {
        state: health.state,
        reason: health.reason,
        degradedModeAllowed: health.degradedModeAllowed,
        freshness: health.freshness,
        operationalState: operationalHealth.state,
        degradedMode: operationalHealth.degradedMode,
        retryable: operationalHealth.retryable,
        retryAfterMs: operationalHealth.retryAfterMs,
        failureState: operationalHealth.failure.state,
        failureReason: operationalHealth.failure.reason,
        failureIncidentCount: operationalHealth.failure.incidentCount,
        failurePrimaryAction: operationalHealth.failure.primaryAction,
        failurePrimaryOwner: operationalHealth.failure.primaryOwner,
        retryBudgetRemaining: operationalHealth.failure.retryBudgetRemaining,
        incidents: operationalHealth.failure.incidents,
        failedDependencies: operationalHealth.failedDependencies,
        criticalFailedDependencies: operationalHealth.criticalFailedDependencies,
        degradedDependencies: operationalHealth.degradedDependencies,
        staleDependencies: operationalHealth.staleDependencies,
        criticalStaleDependencies: operationalHealth.criticalStaleDependencies
      }
    },
    decision: {
      admitted: effectiveAdmitted,
      status: effectiveDecision,
      source: effectiveOutcome.source,
      replayed: effectiveOutcome.replayed,
      replayBasis: effectiveOutcome.replayBasis,
      persistedStatus: effectiveOutcome.persistedStatus,
      terminalPersistedStatus: effectiveOutcome.terminalPersistedStatus,
      reason: effectiveOutcome.reason,
      computed: {
        admitted,
        status: decision,
        reason: decisionReason
      },
      violations,
      actionableErrors,
      errorTriage,
      authorization: permissionDecision
    },
    preview: admissionPreview,
    readiness: validationSummary,
    routePreviewAcceptance,
    clientAcceptance,
    clientRouteActionManifest,
    workflowHandoffReceipt,
    exitContract,
    nextSteps,
    clientWorkflow,
    handoff: {
      target: effectiveHandoffTarget,
      label: effectiveCommandCancelsAdmission
        ? 'Admission cancelled'
        : (effectiveAdmitted
          ? (operationalHealth.degradedMode ? 'Start hosted kernel process in degraded mode' : 'Start hosted kernel process')
          : (operationalHealth.retryable ? 'Retry process admission after backoff' : 'Resolve admission requirements')),
      payload: {
        requestId,
        surfaceId,
        intent,
        objectiveKey: objective.objectiveKey,
        objectiveSummary: objective.summary,
        objectiveOrigin: objective.origin,
        processOwnerId: ownerBinding.ownerId,
        processOwnerBindingId: ownerBinding.bindingId,
        initialLifecycleEvidenceRef: lifecycleEvidenceRefs.initialCheckpointRef,
        commandName: command.name,
        runtimeMode,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        isolationKey: scope.isolationKey,
        missingCapabilities,
        missingProviderCapabilities: providerNegotiation.missingProviderCapabilities,
        negotiatedProviderCapabilities: providerNegotiation.negotiatedCapabilities,
        admissionPolicyId: admissionPolicy.policyId,
        admissionPolicyMode: admissionPolicy.mode,
        admissionPolicySatisfied: admissionPolicy.satisfied,
        admissionPolicyViolationCount: admissionPolicy.violationCount,
        admissionPolicyWarningCount: admissionPolicy.warningCount,
        lifecycleControlState: lifecycleControls.state,
        lifecycleControlEnabled: lifecycleControls.enabled,
        lifecycleSchedulingMode: lifecycleControls.schedulingMode,
        lifecycleControlNextAction: lifecycleControls.nextAction,
        lifecycleScheduled: lifecycleControls.scheduled,
        clientRuntimeAdoptionState: clientRuntimeAdoption.state,
        clientRuntimeAdoptionRequired: clientRuntimeAdoption.required,
        clientRuntimeAdoptionHandoffEnabled: clientRuntimeAdoption.handoffEnabled,
        clientRuntimeAdoptionNextAction: clientRuntimeAdoption.workflow.nextAction,
        clientRuntimeHandoffContractId: clientRuntimeAdoption.workflow.handoffContractId,
        clientRuntimeObservedMode: clientRuntimeAdoption.observedRuntimeMode,
        clientRuntimeAcceptedProtocol: clientRuntimeAdoption.acceptedProtocol,
        clientRuntimeSyncGeneration: clientRuntimeAdoption.sync.clientGeneration,
        clientRuntimeSyncCurrent: clientRuntimeAdoption.sync.current,
        scopeBoundaryPolicyId: scopeBoundary.policyId,
        scopeBoundaryMode: scopeBoundary.mode,
        scopeBoundaryAllowed: scopeBoundary.allowed,
        scopeBoundaryViolationCount: scopeBoundary.violationCount,
        scopeBoundaryCompartmentKey: scopeBoundary.compartmentKey,
        scopeBoundaryProofId: scopeBoundary.proof.proofId,
        scopeTenantSource: scope.tenantSource,
        scopeWorkspaceSource: scope.workspaceSource,
        scopeDefaulted: scope.scopeSource.defaulted,
        providerId: providerContract.providerId,
        providerProtocol: providerContract.protocol,
        providerServiceContractId: providerNegotiation.serviceContract.contractId,
        providerServiceContractVersion: providerNegotiation.serviceContract.contractVersion,
        providerConsistencyMode: providerNegotiation.serviceContract.consistencyMode,
        providerServiceContractViolationCount: providerNegotiation.serviceContract.violationCount,
        providerServiceContractWarningCount: providerNegotiation.serviceContract.warningCount,
        providerServiceContractProofId: providerNegotiation.serviceContract.proof.proofId,
        externalHandoffState: externalHandoff.state,
        externalHandoffAckMode: externalHandoff.acknowledgement.mode,
        externalHandoffAckState: externalHandoff.acknowledgement.state,
        externalHandoffRef: externalHandoff.payloadRef,
        workflowHandoffReceiptId: workflowHandoffReceipt.receiptId,
        workflowHandoffReceiptState: workflowHandoffReceipt.state,
        workflowHandoffReceiptAction: workflowHandoffReceipt.userVisibleAction,
        workflowHandoffReceiptEnabled: workflowHandoffReceipt.handoffEnabled,
        workflowHandoffReceiptOwner: workflowHandoffReceipt.owner,
        syncCursor: externalHandoff.sync.cursor,
        syncScopeCursor: externalHandoff.sync.scopeCursor,
        syncGeneration: externalHandoff.sync.generation,
        syncFreshnessState: externalHandoff.sync.freshness.state,
        syncFreshnessAgeMs: externalHandoff.sync.freshness.ageMs,
        persistenceWriteOperation: persistence.writePlan.operation,
        persistenceWriteRevision: persistence.current.writeRevision,
        journalSequence: persistence.current.journalSequence,
        idempotencyReplayBasis: persistence.idempotency.replayBasis,
        missingPermissions: permissionDecision.missing,
        operationalHealthState: operationalHealth.state,
        operationalFailureState: operationalHealth.failure.state,
        operationalHealthFreshnessState: health.freshness.state,
        operationalHealthAgeMs: health.freshness.ageMs,
        staleDependencies: operationalHealth.staleDependencies,
        criticalStaleDependencies: operationalHealth.criticalStaleDependencies,
        retryAfterMs: operationalHealth.retryAfterMs,
        retryStrategy: operationalHealth.retryable ? health.retry.strategy : null,
        retryBudgetRemaining: operationalHealth.failure.retryBudgetRemaining,
        operationalFailurePrimaryAction: operationalHealth.failure.primaryAction,
        operationalFailurePrimaryOwner: operationalHealth.failure.primaryOwner,
        operationalIncidents: operationalHealth.failure.incidents,
        actionableErrorTriageCount: errorTriage.totalCount,
        actionableErrorBlockingCount: errorTriage.blockingCount,
        actionableErrorRetryableCount: errorTriage.retryableCount,
        actionableErrorPrimarySource: errorTriage.primary?.source || null,
        actionableErrorPrimaryAction: errorTriage.primary?.action || null,
        actionableErrorNextRetry: errorTriage.nextRetry,
        exitContractId: exitContract.contractId,
        exitContractState: exitContract.state,
        exitContractOwner: exitContract.owner,
        exitContractNextAction: exitContract.nextAction,
        exitContractTerminal: exitContract.terminal,
        exitContractFailed: exitContract.failed,
        exitContractProofId: exitContract.proof.proofId,
        observedExitPresent: exitContract.observedExit.present,
        observedExitCode: exitContract.observedExit.exitCode,
        observedExitSignal: exitContract.observedExit.signal,
        failedDependencies: operationalHealth.failedDependencies,
        criticalFailedDependencies: operationalHealth.criticalFailedDependencies,
        degradedDependencies: operationalHealth.degradedDependencies
      }
    },
    audit,
    externalHandoff,
    persistence,
    recovery,
    reporting,
    proof: {
      generatedAt: now,
      checks: [
        { name: 'command-known', ok: KNOWN_ADMISSION_COMMANDS.has(command.name) },
        { name: 'process-objective-present', ok: objective.present && !objective.empty },
        { name: 'process-objective-normalized', ok: Boolean(objective.objectiveKey && objective.normalizedSummary) },
        { name: 'process-owner-bound', ok: Boolean(ownerBinding.ownerId && ownerBinding.bindingId) },
        { name: 'process-owner-binding-authorized', ok: ownerBinding.actorCanBind },
        { name: 'initial-lifecycle-evidence-shaped', ok: Boolean(lifecycleEvidenceRefs.intakeRef && lifecycleEvidenceRefs.initialCheckpointRef) },
        { name: 'initial-lifecycle-evidence-proof-shaped', ok: lifecycleEvidenceRefs.proof.schemaVersion === 1 && Boolean(lifecycleEvidenceRefs.proof.proofId) },
        { name: 'initial-lifecycle-evidence-links-owner', ok: lifecycleEvidenceRefs.ownerBindingId === ownerBinding.bindingId },
        { name: 'required-objective-evidence-satisfied', ok: objective.requiredEvidenceSatisfied },
        { name: 'required-objective-evidence-accounted', ok: objective.requiredEvidence.requiredCount === objective.requiredEvidence.satisfiedCount + objective.requiredEvidence.missingCount },
        { name: 'idempotency-key-present', ok: Boolean(command.idempotencyKey) },
        { name: 'persisted-state-shaped', ok: persistence.version === 2 && Boolean(persistence.key) },
        { name: 'persisted-status-known-before-write', ok: persistence.restartLedger.statusContract.known || persistence.writePlan.operation === 'reject-write' },
        { name: 'persistence-write-plan-shaped', ok: persistence.writePlan.schemaVersion === 1 && Boolean(persistence.writePlan.operation) },
        { name: 'persistence-write-plan-has-conflict-policy', ok: persistence.writePlan.conflict.onRevisionMismatch === 'reload-and-rebuild-recovery-plan' },
        { name: 'persistence-restart-ledger-shaped', ok: persistence.restartLedger.schemaVersion === 1 && Boolean(persistence.restartLedger.consistency) },
        { name: 'persistence-lease-restart-action-shaped', ok: Boolean(persistence.restartLedger.lease.restartAction) },
        { name: 'idempotent-replay-uses-receipt-status-when-present', ok: !persistence.idempotency.replayReceiptStatus || persistence.current.status === persistence.idempotency.replayReceiptStatus },
        { name: 'persistence-revision-monotonic', ok: persistence.idempotency.replay || persistence.current.writeRevision > persistedState.writeRevision },
        { name: 'persistence-journal-sequence-monotonic', ok: persistence.idempotency.replay || persistence.current.journalSequence > persistedState.journalSequence },
        { name: 'idempotency-key-tracked', ok: persistence.idempotency.seenIdempotencyKeys.includes(command.idempotencyKey) },
        { name: 'restart-status-derived', ok: Boolean(persistence.current.restartSafeStatus) },
        { name: 'restart-checkpoint-shaped', ok: persistence.checkpoint.schemaVersion === 1 && CHECKPOINT_PHASES.has(persistence.checkpoint.phase) },
        { name: 'restart-checkpoint-request-linked', ok: persistence.checkpoint.requestId === requestId },
        { name: 'restart-command-contract-shaped', ok: !persistence.restartCommands.resume || persistence.restartCommands.resume.idempotencyKey.includes(persistence.current.recoveryToken) },
        { name: 'cancel-command-does-not-spawn', ok: !effectiveCommandCancelsAdmission || !effectiveAdmitted },
        { name: 'replay-outcome-aligned-with-persisted-status', ok: !effectiveOutcome.replayed || effectiveOutcome.status === deriveReplayOutcomeFromPersistedStatus(persistence.current.status)?.decision },
        { name: 'replay-outcome-uses-read-existing-write-plan', ok: !effectiveOutcome.replayed || persistence.writePlan.operation === 'read-existing' },
        { name: 'replay-outcome-status-known', ok: !effectiveOutcome.replayed || effectiveOutcome.replayOutcomeStatusKnown },
        { name: 'client-state-known', ok: KNOWN_CLIENT_STATES.has(clientState) },
        { name: 'runtime-mode-known', ok: KNOWN_RUNTIME_MODES.has(runtimeMode) },
        { name: 'runtime-health-state-known', ok: KNOWN_HEALTH_STATES.has(health.state) },
        { name: 'runtime-health-freshness-shaped', ok: Boolean(health.freshness.state) && Number.isInteger(health.freshness.maxAgeMs) },
        { name: 'stale-health-does-not-spawn-without-degraded-mode', ok: !health.freshness.stale || health.degradedModeAllowed || !admitted || effectiveOutcome.replayed },
        { name: 'critical-stale-dependencies-gate-spawn', ok: operationalHealth.criticalStaleDependencies.length === 0 || health.degradedModeAllowed || !admitted || effectiveOutcome.replayed },
        { name: 'operational-failure-contract-shaped', ok: operationalHealth.failure.schemaVersion === 1 && Number.isInteger(operationalHealth.failure.incidentCount) },
        { name: 'operational-failure-owner-action-present', ok: operationalHealth.failure.incidentCount === 0 || Boolean(operationalHealth.failure.primaryOwner && operationalHealth.failure.primaryAction) },
        { name: 'actionable-error-triage-shaped', ok: errorTriage.schemaVersion === 1 && Number.isInteger(errorTriage.totalCount) && Array.isArray(errorTriage.items) },
        { name: 'actionable-error-primary-action-present', ok: errorTriage.totalCount === 0 || Boolean(errorTriage.primary?.source && errorTriage.primary?.action) },
        { name: 'actionable-error-retry-has-command', ok: errorTriage.retryableCount === 0 || errorTriage.nextRetry?.commandName === 'recover-admission' },
        { name: 'critical-dependencies-ready', ok: operationalHealth.criticalFailedDependencies.length === 0 },
        { name: 'retry-budget-available', ok: !operationalHealth.retryable || !health.retry.exhausted },
        { name: 'degraded-mode-declared', ok: !operationalHealth.degradedMode || health.degradedModeAllowed },
        { name: 'priority-known', ok: KNOWN_REQUEST_PRIORITIES.has(priority) },
        { name: 'capabilities-satisfied', ok: missingCapabilities.length === 0 },
        { name: 'provider-state-known', ok: KNOWN_PROVIDER_STATES.has(providerContract.state) },
        { name: 'provider-capabilities-satisfied', ok: providerNegotiation.missingProviderCapabilities.length === 0 },
        { name: 'provider-sync-shaped', ok: Number.isInteger(providerNegotiation.syncMetadata.generation) },
        { name: 'provider-route-partition-scoped', ok: providerNegotiation.routing.routePartition === `${scope.tenantId}/${scope.workspaceId}` },
        { name: 'provider-route-partition-allowed-before-spawn', ok: !admitted || providerNegotiation.routing.allowedRoutePartition },
        { name: 'provider-scoped-sync-cursor-present-when-required', ok: !providerNegotiation.routing.requireScopedSyncCursor || Boolean(providerNegotiation.syncMetadata.scopeCursor) || !admitted },
        { name: 'provider-sync-freshness-shaped', ok: Boolean(providerNegotiation.syncMetadata.freshness.state) && Number.isInteger(providerNegotiation.syncMetadata.freshness.maxAgeMs) },
        { name: 'provider-service-contract-shaped', ok: providerNegotiation.serviceContract.schemaVersion === 1 && Boolean(providerNegotiation.serviceContract.contractId) },
        { name: 'provider-service-contract-proof-shaped', ok: providerNegotiation.serviceContract.proof.schemaVersion === 1 && Boolean(providerNegotiation.serviceContract.proof.proofId) },
        { name: 'provider-consistency-mode-known', ok: KNOWN_PROVIDER_CONSISTENCY_MODES.has(providerNegotiation.serviceContract.consistencyMode) },
        { name: 'provider-handoff-ack-mode-known', ok: KNOWN_HANDOFF_ACK_MODES.has(providerNegotiation.serviceContract.handoffAckMode) },
        { name: 'provider-service-contract-satisfied-before-spawn', ok: !admitted || providerNegotiation.serviceContract.violationCount === 0 },
        { name: 'provider-handoff-ack-endpoint-present-when-required', ok: providerNegotiation.serviceContract.handoffAckMode === 'none' || Boolean(providerNegotiation.serviceContract.handoffAckEndpoint) },
        { name: 'provider-current-sync-required-before-spawn', ok: !admitted || !providerNegotiation.serviceContract.requireCurrentSync || providerNegotiation.syncMetadata.freshness.state === 'fresh' },
        { name: 'client-runtime-adoption-shaped', ok: clientRuntimeAdoption.schemaVersion === 1 && Boolean(clientRuntimeAdoption.workflow.handoffContractId) },
        { name: 'client-runtime-adoption-gates-spawn', ok: !admitted || clientRuntimeAdoption.adopted },
        { name: 'client-runtime-adoption-route-scoped', ok: clientRuntimeAdoption.workflow.routePartition === `${scope.tenantId}/${scope.workspaceId}` },
        { name: 'process-exit-contract-shaped', ok: exitContract.schemaVersion === 1 && Boolean(exitContract.contractId && exitContract.proof.proofId) },
        { name: 'process-exit-contract-has-owner-action', ok: Boolean(exitContract.owner && exitContract.nextAction) },
        { name: 'process-exit-contract-links-persistence', ok: exitContract.evidenceRefs.persistenceKey === persistence.key },
        { name: 'failed-exit-contract-is-terminal', ok: !exitContract.failed || exitContract.terminal },
        { name: 'admission-policy-mode-known', ok: KNOWN_POLICY_MODES.has(admissionPolicy.mode) },
        { name: 'admission-policy-shaped', ok: Boolean(admissionPolicy.policyId) && Number.isInteger(admissionPolicy.violationCount) },
        { name: 'admission-policy-satisfied-before-spawn', ok: !admitted || admissionPolicy.satisfied },
        { name: 'lifecycle-control-state-known', ok: KNOWN_LIFECYCLE_CONTROL_STATES.has(lifecycleControls.state) },
        { name: 'lifecycle-scheduling-mode-known', ok: KNOWN_SCHEDULING_MODES.has(lifecycleControls.schedulingMode) },
        { name: 'lifecycle-controls-allow-spawn', ok: !admitted || lifecycleControls.allowed },
        { name: 'lifecycle-next-action-present', ok: Boolean(lifecycleControls.nextAction) },
        { name: 'lifecycle-settings-validation-shaped', ok: Boolean(lifecycleControls.settingsValidation.status && lifecycleControls.schedulingWindow.state) },
        { name: 'lifecycle-setting-command-known', ok: lifecycleControls.settingCommand.known },
        { name: 'lifecycle-command-ack-shaped', ok: lifecycleControls.commandAcknowledgement.schemaVersion === 1 && Boolean(lifecycleControls.commandAcknowledgement.contractId) },
        { name: 'lifecycle-command-ack-disposition-valid', ok: ['accepted', 'queued', 'deferred', 'rejected'].includes(lifecycleControls.commandAcknowledgement.command.disposition) },
        { name: 'lifecycle-command-ack-blockers-aligned', ok: lifecycleControls.commandAcknowledgement.validation.violationCodes.length === lifecycleControls.violations.length },
        { name: 'lifecycle-control-proof-shaped', ok: lifecycleControls.proof.schemaVersion === 1 && Boolean(lifecycleControls.proof.proofId) },
        { name: 'lifecycle-window-gates-spawn', ok: lifecycleControls.schedulingWindow.state !== 'not-open' || !admitted },
        { name: 'scope-boundary-mode-known', ok: KNOWN_SCOPE_BOUNDARY_MODES.has(scopeBoundary.mode) },
        { name: 'scope-boundary-allows-spawn', ok: !admitted || scopeBoundary.allowed },
        { name: 'scope-boundary-compartment-linked', ok: scopeBoundary.compartmentKey.endsWith(scope.isolationKey) },
        { name: 'scope-boundary-handoff-gated', ok: scopeBoundary.handoffAllowed || externalHandoff.blockedReasons.includes('scope_boundary_blocked') },
        { name: 'scope-boundary-audit-shaped', ok: Boolean(scopeBoundary.audit.sink && scopeBoundary.audit.subject.requestId === requestId) },
        { name: 'external-handoff-state-known', ok: externalHandoff.stateKnown },
        { name: 'external-handoff-payload-scoped', ok: externalHandoff.payloadRef.includes(`/${scope.tenantId}/${scope.workspaceId}/`) },
        { name: 'hosted-kernel-authenticated', ok: !requiresHostedKernel || clientState !== 'anonymous' },
        { name: 'actor-role-known', ok: actor.roleKnown },
        { name: 'actor-effective-role-known', ok: KNOWN_ACTOR_ROLES.has(actor.effectiveRole) },
        { name: 'unknown-role-falls-back-to-viewer', ok: actor.roleKnown || actor.effectiveRole === 'viewer' },
        { name: 'actor-permissions-satisfied', ok: permissionDecision.allowed },
        { name: 'actor-explicit-grants-scoped-before-authorization', ok: actor.activePermissionGrants.every((grant) => grant.tenantId === null || grant.tenantId === scope.tenantId) && actor.activePermissionGrants.every((grant) => grant.workspaceId === null || grant.workspaceId === scope.workspaceId) },
        { name: 'actor-rejected-required-grants-block-authorization', ok: permissionDecision.grantScope.rejectedRequiredGrantCount === 0 || !permissionDecision.allowed },
        { name: 'actor-grant-scope-evidence-shaped', ok: scopeBoundary.proof.actorBoundary.activePermissionGrantCount === actor.activePermissionGrants.length && scopeBoundary.proof.actorBoundary.rejectedPermissionGrantCount === actor.rejectedPermissionCount },
        { name: 'scope-source-shaped', ok: Boolean(scope.tenantSource && scope.workspaceSource) },
        { name: 'scope-boundary-proof-shaped', ok: scopeBoundary.proof.schemaVersion === 1 && Boolean(scopeBoundary.proof.proofId) },
        { name: 'scope-boundary-proof-audit-linked', ok: scopeBoundary.audit.handoff.proofRef.includes(`${requestId}:${command.commandId}`) },
        { name: 'scope-boundary-proof-sources-linked', ok: scopeBoundary.proof.scopeSources.tenant === scope.tenantSource && scopeBoundary.proof.scopeSources.workspace === scope.workspaceSource },
        { name: 'tenant-boundary-held', ok: !scope.clientTenantId || scope.clientTenantId === scope.tenantId },
        { name: 'workspace-boundary-held', ok: !scope.clientWorkspaceId || scope.clientWorkspaceId === scope.workspaceId },
        { name: 'persistence-key-scoped', ok: persistence.key.includes(`/${scope.tenantId}/${scope.workspaceId}/`) },
        { name: 'audit-handoff-shaped', ok: admissionAuditIsShaped({ audit }) },
        { name: 'persisted-scope-compatible', ok: recovery.mode !== 'quarantine' },
        { name: 'reporting-export-ready', ok: reporting.export.ready && reporting.export.headers.includes('requestId') },
        { name: 'reporting-history-bounded', ok: reporting.history.length <= REPORT_HISTORY_LIMIT },
        { name: 'reporting-current-snapshot-linked', ok: reporting.currentSnapshot.requestId === requestId },
        { name: 'preview-status-shaped', ok: Boolean(admissionPreview.status) && Boolean(admissionPreview.primaryAction) },
        { name: 'route-preview-acceptance-shaped', ok: routePreviewAcceptance.schemaVersion === 1 && Boolean(routePreviewAcceptance.contractId) },
        { name: 'route-preview-acceptance-ready-aligned', ok: routePreviewAcceptance.ready === validationSummary.ready && routePreviewAcceptance.accepted === validationSummary.accepted },
        { name: 'route-preview-acceptance-route-linked', ok: routePreviewAcceptance.routeConsumption.handoffRef === externalHandoff.payloadRef },
        { name: 'route-preview-acceptance-proof-linked', ok: routePreviewAcceptance.proofRefs.persistenceKey === persistence.key },
        { name: 'route-preview-acceptance-scope-proof-linked', ok: routePreviewAcceptance.proofRefs.scopeBoundaryProofId === scopeBoundary.proof.proofId },
        { name: 'client-acceptance-packet-shaped', ok: clientAcceptance.schemaVersion === 1 && Boolean(clientAcceptance.packetId) },
        { name: 'client-acceptance-route-linked', ok: clientAcceptance.routeIntegration.handoffRef === externalHandoff.payloadRef },
        { name: 'client-acceptance-proof-linked', ok: clientAcceptance.proofRefs.persistenceKey === persistence.key },
        { name: 'client-acceptance-readiness-digest-shaped', ok: clientAcceptance.readiness.digest.length === validationSummary.groups.length },
        { name: 'client-acceptance-gates-shaped', ok: clientAcceptance.acceptanceGates.gates.length === validationSummary.groups.length },
        { name: 'client-acceptance-primary-gate-actionable', ok: clientAcceptance.acceptanceGates.totalCount === 0 || Boolean(clientAcceptance.acceptanceGates.primaryGate?.action) },
        { name: 'client-acceptance-gate-counts-aligned', ok: clientAcceptance.acceptanceGates.totalCount === clientAcceptance.acceptanceGates.blockingCount + clientAcceptance.acceptanceGates.waitingCount + clientAcceptance.acceptanceGates.warningCount + clientAcceptance.acceptanceGates.passedCount },
        { name: 'client-acceptance-spawn-requires-readiness', ok: clientAcceptance.acceptanceMode !== 'accept-and-dispatch' || validationSummary.ready },
        { name: 'client-route-action-manifest-shaped', ok: clientRouteActionManifest.schemaVersion === 1 && Boolean(clientRouteActionManifest.manifestId) },
        { name: 'client-route-action-links-preview', ok: clientRouteActionManifest.proofRefs.previewAcceptanceContractId === routePreviewAcceptance.contractId },
        { name: 'client-route-action-links-acceptance', ok: clientRouteActionManifest.proofRefs.clientAcceptancePacketId === clientAcceptance.packetId },
        { name: 'client-route-action-handoff-scoped', ok: clientRouteActionManifest.proofRefs.externalHandoffRef === externalHandoff.payloadRef },
        { name: 'client-route-action-primary-gate-linked', ok: !clientAcceptance.acceptanceGates.primaryGate || clientRouteActionManifest.clientState.primaryAcceptanceGate?.key === clientAcceptance.acceptanceGates.primaryGate.key },
        { name: 'client-route-action-dispatch-requires-readiness', ok: clientRouteActionManifest.action.name !== 'dispatch-hosted-kernel-spawn' || validationSummary.ready },
        { name: 'workflow-handoff-receipt-shaped', ok: workflowHandoffReceipt.schemaVersion === 1 && Boolean(workflowHandoffReceipt.receiptId) },
        { name: 'workflow-handoff-receipt-links-route-action', ok: workflowHandoffReceipt.proofRefs.routeActionManifestId === clientRouteActionManifest.manifestId },
        { name: 'workflow-handoff-receipt-links-acceptance', ok: workflowHandoffReceipt.proofRefs.clientAcceptancePacketId === clientAcceptance.packetId },
        { name: 'workflow-handoff-receipt-links-runtime-contract', ok: workflowHandoffReceipt.proofRefs.clientRuntimeHandoffContractId === clientRuntimeAdoption.workflow.handoffContractId },
        { name: 'workflow-handoff-receipt-dispatch-requires-ready-handoff', ok: !workflowHandoffReceipt.handoffEnabled || (validationSummary.ready && externalHandoff.state === 'ready') },
        { name: 'readiness-groups-shaped', ok: validationSummary.groups.length >= 5 },
        { name: 'readiness-ready-requires-admission', ok: !validationSummary.ready || effectiveAdmitted },
        { name: 'next-steps-contract-shaped', ok: Number.isInteger(nextSteps.count) && Array.isArray(nextSteps.steps) },
        { name: 'next-required-action-present', ok: Boolean(nextSteps.nextRequiredAction) },
        { name: 'client-workflow-shaped', ok: clientWorkflow.schemaVersion === 1 && Boolean(clientWorkflow.primaryAction) },
        { name: 'client-workflow-scoped', ok: clientWorkflow.scope.isolationKey === scope.isolationKey },
        { name: 'client-workflow-proof-linked', ok: clientWorkflow.proofRefs.persistenceKey === persistence.key },
        { name: 'client-workflow-scope-proof-linked', ok: clientWorkflow.proofRefs.scopeBoundaryProofId === scopeBoundary.proof.proofId },
        { name: 'client-workflow-spawn-requires-readiness', ok: clientWorkflow.lane !== 'spawn' || validationSummary.ready }
      ]
    }
  };
}

function admissionAuditIsShaped(admission) {
  return admission.audit?.target === 'kernel.audit.process-admission'
    && Boolean(admission.audit?.subject?.requestId);
}

export function describeProcessAdmissionSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const admission = buildAdmissionContract(input, now);
  return {
    ok: true,
    admitted: admission.decision.admitted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel process admission contract',
    admission,
    userVisibleWorkflow: {
      status: admission.decision.status,
      persistedStatus: admission.persistence.current.status,
      persistedStatusKnown: admission.persistence.restartLedger.statusContract.known,
      persistedStatusCategory: admission.persistence.restartLedger.statusContract.category,
      persistedStatusRecoveryAction: admission.persistence.restartLedger.statusContract.recoveryAction,
      restartSafeStatus: admission.persistence.current.restartSafeStatus,
      checkpointPhase: admission.persistence.checkpoint.phase,
      checkpointNextCommand: admission.persistence.checkpoint.nextCommandName,
      checkpointRestartSafe: admission.persistence.checkpoint.restartSafe,
      recoveryMode: admission.recovery.mode,
      idempotentReplay: admission.persistence.idempotency.replay,
      idempotencyReplayBasis: admission.persistence.idempotency.replayBasis,
      persistenceWriteOperation: admission.persistence.writePlan.operation,
      persistenceWriteRevision: admission.persistence.current.writeRevision,
      journalSequence: admission.persistence.current.journalSequence,
      persistenceRestartConsistency: admission.persistence.restartLedger.consistency,
      persistenceLeaseState: admission.persistence.restartLedger.lease.state,
      persistenceLeaseRestartAction: admission.persistence.restartLedger.lease.restartAction,
      persistenceExpirationState: admission.persistence.restartLedger.expiration.state,
      persistenceExpirationDeadlineAt: admission.persistence.restartLedger.expiration.deadlineAt,
      persistenceExpirationRecoveryAction: admission.persistence.restartLedger.expiration.recoveryAction,
      replayReceiptStatus: admission.persistence.restartLedger.replayStatus,
      durableBeforeHandoff: admission.persistence.writePlan.durableBeforeHandoff,
      restartResumeCommand: admission.persistence.restartCommands.resume?.commandName || null,
      restartCancelCommand: admission.persistence.restartCommands.cancel?.commandName || null,
      nextAction: admission.handoff.label,
      handoffTarget: admission.handoff.target,
      externalHandoffState: admission.externalHandoff.state,
      externalHandoffRef: admission.externalHandoff.payloadRef,
      providerId: admission.provider.providerId,
      providerState: admission.provider.state,
      providerProtocol: admission.provider.protocol,
      providerMissingCapabilityCount: admission.provider.missingCapabilities.length,
      providerServiceContractId: admission.provider.serviceContract.contractId,
      providerServiceContractViolationCount: admission.provider.serviceContract.violationCount,
      providerServiceContractWarningCount: admission.provider.serviceContract.warningCount,
      providerConsistencyMode: admission.provider.serviceContract.consistencyMode,
      providerHandoffAckMode: admission.provider.serviceContract.handoffAckMode,
      providerServiceContractProofId: admission.provider.serviceContract.proof.proofId,
      syncGeneration: admission.provider.sync.generation,
      syncFreshnessState: admission.provider.sync.freshness.state,
      admissionPolicyId: admission.admissionPolicy.policyId,
      admissionPolicyMode: admission.admissionPolicy.mode,
      admissionPolicySatisfied: admission.admissionPolicy.satisfied,
      admissionPolicyViolationCount: admission.admissionPolicy.violationCount,
      admissionPolicyWarningCount: admission.admissionPolicy.warningCount,
      lifecycleControlState: admission.lifecycleControls.state,
      lifecycleControlEnabled: admission.lifecycleControls.enabled,
      lifecycleSettingsRevision: admission.lifecycleControls.settingsRevision,
      lifecycleSettingCommandName: admission.lifecycleControls.settingCommand.name,
      lifecycleSettingCommandCanApply: admission.lifecycleControls.settingCommand.canApply,
      lifecycleSchedulingWindowState: admission.lifecycleControls.schedulingWindow.state,
      lifecycleCommandEnabled: admission.lifecycleControls.commandEnabled,
      lifecycleSchedulingMode: admission.lifecycleControls.schedulingMode,
      lifecycleScheduled: admission.lifecycleControls.scheduled,
      lifecycleControlNextAction: admission.lifecycleControls.nextAction,
      lifecycleControlProofId: admission.lifecycleControls.proof.proofId,
      lifecycleCommandDisposition: admission.lifecycleControls.commandAcknowledgement.command.disposition,
      lifecycleCommandAccepted: admission.lifecycleControls.commandAcknowledgement.command.accepted,
      lifecycleCommandRetryAfterMs: admission.lifecycleControls.commandAcknowledgement.command.retryAfterMs,
      lifecycleCommandUserVisibleStatus: admission.lifecycleControls.commandAcknowledgement.userVisible.status,
      lifecycleCommandPrimaryAction: admission.lifecycleControls.commandAcknowledgement.userVisible.primaryAction,
      scopeBoundaryPolicyId: admission.scopeBoundary.policyId,
      scopeBoundaryMode: admission.scopeBoundary.mode,
      scopeBoundaryAllowed: admission.scopeBoundary.allowed,
      scopeBoundaryViolationCount: admission.scopeBoundary.violationCount,
      scopeBoundaryCompartmentKey: admission.scopeBoundary.compartmentKey,
      scopeBoundaryProofId: admission.scopeBoundary.proof.proofId,
      scopeTenantSource: admission.scope.tenantSource,
      scopeWorkspaceSource: admission.scope.workspaceSource,
      scopeDefaulted: admission.scope.scopeSource.defaulted,
      tenantId: admission.scope.tenantId,
      workspaceId: admission.scope.workspaceId,
      objectiveKey: admission.request.objective.objectiveKey,
      objectiveOrigin: admission.request.objective.origin,
      objectivePresent: admission.request.objective.present,
      requiredEvidenceSatisfied: admission.request.objective.requiredEvidenceSatisfied,
      missingRequiredEvidenceCount: admission.request.objective.requiredEvidence.missingCount,
      processOwnerId: admission.request.ownerBinding.ownerId,
      processOwnerBindingId: admission.request.ownerBinding.bindingId,
      initialLifecycleEvidenceRef: admission.request.lifecycleEvidenceRefs.initialCheckpointRef,
      intakeEvidenceProofId: admission.request.lifecycleEvidenceRefs.proof.proofId,
      actorRole: admission.actor.role,
      actorRequestedRole: admission.actor.requestedRole,
      actorEffectiveRole: admission.actor.effectiveRole,
      actorRoleKnown: admission.actor.roleKnown,
      actorActivePermissionGrantCount: admission.actor.activePermissionGrantCount,
      actorRejectedPermissionGrantCount: admission.actor.rejectedPermissionGrantCount,
      actorRejectedRequiredGrantCount: admission.decision.authorization.grantScope.rejectedRequiredGrantCount,
      operationalHealthState: admission.runtime.health.operationalState,
      operationalFailureState: admission.runtime.health.failureState,
      operationalHealthFreshnessState: admission.runtime.health.freshness.state,
      operationalHealthAgeMs: admission.runtime.health.freshness.ageMs,
      operationalFailureIncidentCount: admission.runtime.health.failureIncidentCount,
      operationalFailurePrimaryAction: admission.runtime.health.failurePrimaryAction,
      operationalFailurePrimaryOwner: admission.runtime.health.failurePrimaryOwner,
      staleDependencyCount: admission.runtime.health.staleDependencies.length,
      criticalStaleDependencyCount: admission.runtime.health.criticalStaleDependencies.length,
      retryAfterMs: admission.runtime.health.retryAfterMs,
      retryBudgetRemaining: admission.runtime.health.retryBudgetRemaining,
      actionableErrorCount: admission.decision.actionableErrors.length,
      actionableErrorTriageCount: admission.decision.errorTriage.totalCount,
      actionableErrorBlockingCount: admission.decision.errorTriage.blockingCount,
      actionableErrorRetryableCount: admission.decision.errorTriage.retryableCount,
      actionableErrorPrimarySource: admission.decision.errorTriage.primary?.source || null,
      actionableErrorPrimaryAction: admission.decision.errorTriage.primary?.action || null,
      actionableErrorNextRetryAfterMs: admission.decision.errorTriage.nextRetry?.retryAfterMs || null,
      reportId: admission.reporting.reportId,
      exportReady: admission.reporting.export.ready,
      mailchimpExportBatchId: admission.reporting.mailchimpExport.batchId,
      mailchimpExportReady: admission.reporting.mailchimpExport.ready,
      mailchimpExportState: admission.reporting.mailchimpExport.state,
      mailchimpExportDisposition: admission.reporting.mailchimpExport.disposition,
      mailchimpExportBlockedBy: admission.reporting.mailchimpExport.blockedBy,
      historySnapshotCount: admission.reporting.history.length,
      previewStatus: admission.preview.status,
      previewLabel: admission.preview.previewLabel,
      previewPrimaryAction: admission.preview.primaryAction,
      previewAcceptanceReadyState: admission.routePreviewAcceptance.readyState,
      previewAcceptancePrimaryOwner: admission.routePreviewAcceptance.display.primaryOwner,
      previewAcceptanceRouteTarget: admission.routePreviewAcceptance.routeConsumption.target,
      previewAcceptanceNextAction: admission.routePreviewAcceptance.nextStep.action,
      clientAcceptancePacketId: admission.clientAcceptance.packetId,
      clientAcceptanceMode: admission.clientAcceptance.acceptanceMode,
      clientAcceptancePrimaryAction: admission.clientAcceptance.primaryAction,
      clientAcceptanceCommandEnabled: admission.clientAcceptance.commandAffordances.accept.enabled,
      clientAcceptanceClientActionRequired: admission.clientAcceptance.clientActionRequired,
      clientAcceptanceRouteTarget: admission.clientAcceptance.routeTarget,
      clientAcceptanceGateCount: admission.clientAcceptance.acceptanceGates.totalCount,
      clientAcceptanceBlockingGateCount: admission.clientAcceptance.acceptanceGates.blockingCount,
      clientAcceptanceWaitingGateCount: admission.clientAcceptance.acceptanceGates.waitingCount,
      clientAcceptanceWarningGateCount: admission.clientAcceptance.acceptanceGates.warningCount,
      clientAcceptancePrimaryGateKey: admission.clientAcceptance.acceptanceGates.primaryGate?.key || null,
      clientAcceptancePrimaryGateSeverity: admission.clientAcceptance.acceptanceGates.primaryGate?.severity || null,
      clientAcceptancePrimaryGateAction: admission.clientAcceptance.acceptanceGates.primaryGate?.action || null,
      clientAcceptancePrimaryGateOwner: admission.clientAcceptance.acceptanceGates.primaryGate?.owner || null,
      clientRouteActionManifestId: admission.clientRouteActionManifest.manifestId,
      clientRouteActionState: admission.clientRouteActionManifest.routeState,
      clientRouteActionName: admission.clientRouteActionManifest.action.name,
      clientRouteActionEnabled: admission.clientRouteActionManifest.action.enabled,
      clientRouteActionTarget: admission.clientRouteActionManifest.action.target,
      clientRouteActionBlockedBy: admission.clientRouteActionManifest.clientState.blockedBy,
      clientRouteActionPrimaryGateKey: admission.clientRouteActionManifest.clientState.primaryAcceptanceGate?.key || null,
      workflowHandoffReceiptId: admission.workflowHandoffReceipt.receiptId,
      workflowHandoffReceiptState: admission.workflowHandoffReceipt.state,
      workflowHandoffReceiptAction: admission.workflowHandoffReceipt.userVisibleAction,
      workflowHandoffReceiptEnabled: admission.workflowHandoffReceipt.handoffEnabled,
      workflowHandoffReceiptOwner: admission.workflowHandoffReceipt.owner,
      workflowHandoffReceiptRouteTarget: admission.workflowHandoffReceipt.routeTarget,
      clientRuntimeAdoptionState: admission.client.runtimeAdoption.state,
      clientRuntimeAdoptionRequired: admission.client.runtimeAdoption.required,
      clientRuntimeAdoptionNextAction: admission.client.runtimeAdoption.workflow.nextAction,
      clientRuntimeHandoffContractId: admission.client.runtimeAdoption.workflow.handoffContractId,
      readyForSpawn: admission.preview.readyForSpawn,
      readinessState: admission.readiness.state,
      readinessBlockingGroupCount: admission.readiness.blockingGroupCount,
      readinessRetryableGroupCount: admission.readiness.retryableGroupCount,
      clientWorkflowState: admission.clientWorkflow.state,
      clientWorkflowLane: admission.clientWorkflow.lane,
      clientWorkflowPrimaryAction: admission.clientWorkflow.primaryAction,
      clientWorkflowCancellable: admission.clientWorkflow.cancellable,
      clientWorkflowResumeCommand: admission.clientWorkflow.commands.resume?.commandName || null,
      exitContractId: admission.exitContract.contractId,
      exitContractState: admission.exitContract.state,
      exitContractOwner: admission.exitContract.owner,
      exitContractNextAction: admission.exitContract.nextAction,
      exitContractTerminal: admission.exitContract.terminal,
      exitContractFailed: admission.exitContract.failed,
      exitContractProofId: admission.exitContract.proof.proofId,
      observedExitPresent: admission.exitContract.observedExit.present,
      observedExitCode: admission.exitContract.observedExit.exitCode,
      observedExitSignal: admission.exitContract.observedExit.signal,
      nextRequiredAction: admission.nextSteps.nextRequiredAction,
      nextStepCount: admission.nextSteps.count
    },
    evidence: [
      ...normalizeEvidence(input.evidence),
      {
        type: 'process-admission-proof',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        status: admission.decision.status,
        persistedStatus: admission.persistence.current.status,
        persistedStatusKnown: admission.persistence.restartLedger.statusContract.known,
        persistedStatusCategory: admission.persistence.restartLedger.statusContract.category,
        persistedStatusRecoveryAction: admission.persistence.restartLedger.statusContract.recoveryAction,
        checkpointPhase: admission.persistence.checkpoint.phase,
        checkpointNextCommand: admission.persistence.checkpoint.nextCommandName,
        checkpointRestartSafe: admission.persistence.checkpoint.restartSafe,
        recoveryMode: admission.recovery.mode,
        recoveryReplayBasis: admission.recovery.replayBasis,
        persistenceWriteOperation: admission.persistence.writePlan.operation,
        persistenceWriteRevision: admission.persistence.current.writeRevision,
        journalSequence: admission.persistence.current.journalSequence,
        persistenceRestartConsistency: admission.persistence.restartLedger.consistency,
        persistenceLeaseState: admission.persistence.restartLedger.lease.state,
        persistenceLeaseRestartAction: admission.persistence.restartLedger.lease.restartAction,
        persistenceExpirationState: admission.persistence.restartLedger.expiration.state,
        persistenceExpirationDeadlineAt: admission.persistence.restartLedger.expiration.deadlineAt,
        persistenceExpirationRecoveryAction: admission.persistence.restartLedger.expiration.recoveryAction,
        replayReceiptStatus: admission.persistence.restartLedger.replayStatus,
        durableBeforeHandoff: admission.persistence.writePlan.durableBeforeHandoff,
        operationalHealthState: admission.runtime.health.operationalState,
        operationalFailureState: admission.runtime.health.failureState,
        operationalHealthFreshnessState: admission.runtime.health.freshness.state,
        operationalHealthAgeMs: admission.runtime.health.freshness.ageMs,
        operationalFailureIncidentCount: admission.runtime.health.failureIncidentCount,
        operationalFailurePrimaryAction: admission.runtime.health.failurePrimaryAction,
        operationalFailurePrimaryOwner: admission.runtime.health.failurePrimaryOwner,
        staleDependencyCount: admission.runtime.health.staleDependencies.length,
        criticalStaleDependencyCount: admission.runtime.health.criticalStaleDependencies.length,
        providerId: admission.provider.providerId,
        providerState: admission.provider.state,
        providerServiceContractId: admission.provider.serviceContract.contractId,
        providerServiceContractViolationCount: admission.provider.serviceContract.violationCount,
        providerServiceContractProofId: admission.provider.serviceContract.proof.proofId,
        admissionPolicyId: admission.admissionPolicy.policyId,
        admissionPolicyMode: admission.admissionPolicy.mode,
        admissionPolicySatisfied: admission.admissionPolicy.satisfied,
        admissionPolicyViolationCount: admission.admissionPolicy.violationCount,
        lifecycleControlState: admission.lifecycleControls.state,
        lifecycleSchedulingMode: admission.lifecycleControls.schedulingMode,
        lifecycleControlNextAction: admission.lifecycleControls.nextAction,
        lifecycleSettingCommandName: admission.lifecycleControls.settingCommand.name,
        lifecycleSettingCommandCanApply: admission.lifecycleControls.settingCommand.canApply,
        lifecycleSchedulingWindowState: admission.lifecycleControls.schedulingWindow.state,
        lifecycleControlProofId: admission.lifecycleControls.proof.proofId,
        scopeBoundaryPolicyId: admission.scopeBoundary.policyId,
        scopeBoundaryMode: admission.scopeBoundary.mode,
        scopeBoundaryAllowed: admission.scopeBoundary.allowed,
        scopeBoundaryViolationCount: admission.scopeBoundary.violationCount,
        scopeBoundaryCompartmentKey: admission.scopeBoundary.compartmentKey,
        externalHandoffState: admission.externalHandoff.state,
        externalHandoffAckMode: admission.externalHandoff.acknowledgement.mode,
        externalHandoffAckState: admission.externalHandoff.acknowledgement.state,
        retryAfterMs: admission.runtime.health.retryAfterMs,
        actionableErrorTriageCount: admission.decision.errorTriage.totalCount,
        actionableErrorBlockingCount: admission.decision.errorTriage.blockingCount,
        actionableErrorRetryableCount: admission.decision.errorTriage.retryableCount,
        actionableErrorPrimarySource: admission.decision.errorTriage.primary?.source || null,
        actionableErrorPrimaryAction: admission.decision.errorTriage.primary?.action || null,
        idempotentReplay: admission.persistence.idempotency.replay,
        previewStatus: admission.preview.status,
        previewAcceptanceReadyState: admission.routePreviewAcceptance.readyState,
        previewAcceptanceRouteTarget: admission.routePreviewAcceptance.routeConsumption.target,
        previewAcceptancePrimaryAction: admission.routePreviewAcceptance.display.primaryAction,
        clientAcceptancePacketId: admission.clientAcceptance.packetId,
        clientAcceptanceMode: admission.clientAcceptance.acceptanceMode,
        clientAcceptancePrimaryAction: admission.clientAcceptance.primaryAction,
        clientAcceptanceCommandEnabled: admission.clientAcceptance.commandAffordances.accept.enabled,
        clientAcceptanceClientActionRequired: admission.clientAcceptance.clientActionRequired,
        clientAcceptanceGateCount: admission.clientAcceptance.acceptanceGates.totalCount,
        clientAcceptanceBlockingGateCount: admission.clientAcceptance.acceptanceGates.blockingCount,
        clientAcceptanceWaitingGateCount: admission.clientAcceptance.acceptanceGates.waitingCount,
        clientAcceptancePrimaryGateKey: admission.clientAcceptance.acceptanceGates.primaryGate?.key || null,
        clientAcceptancePrimaryGateAction: admission.clientAcceptance.acceptanceGates.primaryGate?.action || null,
        clientRouteActionManifestId: admission.clientRouteActionManifest.manifestId,
        clientRouteActionState: admission.clientRouteActionManifest.routeState,
        clientRouteActionName: admission.clientRouteActionManifest.action.name,
        clientRouteActionEnabled: admission.clientRouteActionManifest.action.enabled,
        workflowHandoffReceiptId: admission.workflowHandoffReceipt.receiptId,
        workflowHandoffReceiptState: admission.workflowHandoffReceipt.state,
        workflowHandoffReceiptAction: admission.workflowHandoffReceipt.userVisibleAction,
        workflowHandoffReceiptEnabled: admission.workflowHandoffReceipt.handoffEnabled,
        clientRuntimeAdoptionState: admission.client.runtimeAdoption.state,
        clientRuntimeAdoptionNextAction: admission.client.runtimeAdoption.workflow.nextAction,
        clientRuntimeHandoffContractId: admission.client.runtimeAdoption.workflow.handoffContractId,
        exitContractState: admission.exitContract.state,
        exitContractOwner: admission.exitContract.owner,
        exitContractNextAction: admission.exitContract.nextAction,
        exitContractTerminal: admission.exitContract.terminal,
        exitContractFailed: admission.exitContract.failed,
        exitContractProofId: admission.exitContract.proof.proofId,
        readyForSpawn: admission.preview.readyForSpawn,
        nextRequiredAction: admission.nextSteps.nextRequiredAction,
        clientWorkflowState: admission.clientWorkflow.state,
        clientWorkflowLane: admission.clientWorkflow.lane,
        clientWorkflowPrimaryAction: admission.clientWorkflow.primaryAction,
        generatedAt: now
      },
      {
        type: 'process-admission-exit-contract',
        surfaceId,
        contractId: admission.exitContract.contractId,
        requestId: admission.request.requestId,
        commandId: admission.command.commandId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        state: admission.exitContract.state,
        terminal: admission.exitContract.terminal,
        successful: admission.exitContract.successful,
        failed: admission.exitContract.failed,
        owner: admission.exitContract.owner,
        nextAction: admission.exitContract.nextAction,
        observedExitPresent: admission.exitContract.observedExit.present,
        observedExitCode: admission.exitContract.observedExit.exitCode,
        observedExitSignal: admission.exitContract.observedExit.signal,
        persistedStatus: admission.exitContract.lifecycle.persistedStatus,
        checkpointPhase: admission.exitContract.lifecycle.checkpointPhase,
        externalHandoffState: admission.exitContract.process.handoffState,
        handoffAckState: admission.exitContract.process.acknowledgementState,
        persistenceKey: admission.exitContract.evidenceRefs.persistenceKey,
        externalHandoffRef: admission.exitContract.evidenceRefs.externalHandoffRef,
        providerServiceContractProofId: admission.exitContract.evidenceRefs.providerServiceContractProofId,
        scopeBoundaryProofId: admission.exitContract.evidenceRefs.scopeBoundaryProofId,
        proofId: admission.exitContract.proof.proofId,
        generatedAt: now
      },
      {
        type: 'process-admission-persistence-envelope',
        surfaceId,
        key: admission.persistence.key,
        requestId: admission.request.requestId,
        commandId: admission.command.commandId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        restartSafeStatus: admission.persistence.current.restartSafeStatus,
        persistedStatusKnown: admission.persistence.restartLedger.statusContract.known,
        persistedStatusCategory: admission.persistence.restartLedger.statusContract.category,
        persistedStatusRecoveryAction: admission.persistence.restartLedger.statusContract.recoveryAction,
        checkpointPhase: admission.persistence.checkpoint.phase,
        checkpointNextCommand: admission.persistence.checkpoint.nextCommandName,
        checkpointRestartSafe: admission.persistence.checkpoint.restartSafe,
        persistenceWriteOperation: admission.persistence.writePlan.operation,
        persistenceWriteRevision: admission.persistence.current.writeRevision,
        journalSequence: admission.persistence.current.journalSequence,
        persistenceRestartConsistency: admission.persistence.restartLedger.consistency,
        persistenceLeaseState: admission.persistence.restartLedger.lease.state,
        persistenceLeaseRestartAction: admission.persistence.restartLedger.lease.restartAction,
        persistenceExpirationState: admission.persistence.restartLedger.expiration.state,
        persistenceExpirationDeadlineAt: admission.persistence.restartLedger.expiration.deadlineAt,
        persistenceExpirationRecoveryAction: admission.persistence.restartLedger.expiration.recoveryAction,
        replayReceiptStatus: admission.persistence.restartLedger.replayStatus,
        durableBeforeHandoff: admission.persistence.writePlan.durableBeforeHandoff,
        restartResumeCommand: admission.persistence.restartCommands.resume?.commandName || null,
        restartCancelCommand: admission.persistence.restartCommands.cancel?.commandName || null,
        recoveryToken: admission.persistence.current.recoveryToken,
        operationalHealthState: admission.runtime.health.operationalState,
        operationalFailureState: admission.runtime.health.failureState,
        operationalHealthFreshnessState: admission.runtime.health.freshness.state,
        operationalHealthAgeMs: admission.runtime.health.freshness.ageMs,
        staleDependencyCount: admission.runtime.health.staleDependencies.length,
        retryBudgetRemaining: admission.runtime.health.retryBudgetRemaining,
        idempotencyReplayBasis: admission.persistence.idempotency.replayBasis,
        externalHandoffRef: admission.externalHandoff.payloadRef,
        syncGeneration: admission.provider.sync.generation,
        syncFreshnessState: admission.provider.sync.freshness.state,
        providerServiceContractId: admission.provider.serviceContract.contractId,
        providerServiceContractProofId: admission.provider.serviceContract.proof.proofId,
        generatedAt: now
      },
      {
        type: 'process-admission-audit-handoff',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        actorRole: admission.actor.role,
        auditTarget: admission.audit.target,
        handoffTarget: admission.handoff.target,
        persistenceWriteOperation: admission.persistence.writePlan.operation,
        persistenceWriteRevision: admission.persistence.current.writeRevision,
        journalSequence: admission.persistence.current.journalSequence,
        externalHandoffState: admission.externalHandoff.state,
        providerId: admission.provider.providerId,
        providerServiceContractId: admission.provider.serviceContract.contractId,
        providerServiceContractProofId: admission.provider.serviceContract.proof.proofId,
        admissionPolicyId: admission.admissionPolicy.policyId,
        admissionPolicySatisfied: admission.admissionPolicy.satisfied,
        admissionPolicyViolationCount: admission.admissionPolicy.violationCount,
        scopeBoundaryPolicyId: admission.scopeBoundary.policyId,
        scopeBoundaryMode: admission.scopeBoundary.mode,
        scopeBoundaryAllowed: admission.scopeBoundary.allowed,
        scopeBoundaryAuditSink: admission.scopeBoundary.audit.sink,
        scopeBoundaryProofId: admission.scopeBoundary.proof.proofId,
        scopeBoundaryAuditProofRef: admission.scopeBoundary.audit.handoff.proofRef,
        scopeTenantSource: admission.scope.tenantSource,
        scopeWorkspaceSource: admission.scope.workspaceSource,
        scopeDefaulted: admission.scope.scopeSource.defaulted,
        objectiveKey: admission.request.objective.objectiveKey,
        objectiveOrigin: admission.request.objective.origin,
        objectivePresent: admission.request.objective.present,
        requiredEvidenceSatisfied: admission.request.objective.requiredEvidenceSatisfied,
        missingRequiredEvidenceCount: admission.request.objective.requiredEvidence.missingCount,
        processOwnerId: admission.request.ownerBinding.ownerId,
        processOwnerBindingId: admission.request.ownerBinding.bindingId,
        ownerBindingActorCanBind: admission.request.ownerBinding.actorCanBind,
        initialLifecycleEvidenceRef: admission.request.lifecycleEvidenceRefs.initialCheckpointRef,
        intakeEvidenceProofId: admission.request.lifecycleEvidenceRefs.proof.proofId,
        actorRequestedRole: admission.actor.requestedRole,
        actorEffectiveRole: admission.actor.effectiveRole,
        actorRoleKnown: admission.actor.roleKnown,
        actorActivePermissionGrantCount: admission.actor.activePermissionGrantCount,
        actorRejectedPermissionGrantCount: admission.actor.rejectedPermissionGrantCount,
        actorRejectedRequiredGrantCount: admission.decision.authorization.grantScope.rejectedRequiredGrantCount,
        admitted: admission.decision.admitted,
        generatedAt: now
      },
      {
        type: 'process-admission-intake-contract',
        surfaceId,
        requestId: admission.request.requestId,
        commandId: admission.command.commandId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        objectiveKey: admission.request.objective.objectiveKey,
        objectiveSummary: admission.request.objective.summary,
        objectiveOrigin: admission.request.objective.origin,
        objectivePresent: admission.request.objective.present,
        objectiveLabelCount: admission.request.objective.labelCount,
        requiredEvidenceTypes: admission.request.objective.requiredEvidenceTypes,
        requiredEvidenceSatisfied: admission.request.objective.requiredEvidenceSatisfied,
        missingRequiredEvidenceTypes: admission.request.objective.requiredEvidence.missingTypes,
        objectiveEvidenceRefs: admission.request.objective.evidenceRefs,
        ownerId: admission.request.ownerBinding.ownerId,
        ownerBindingId: admission.request.ownerBinding.bindingId,
        ownerSource: admission.request.ownerBinding.ownerSource,
        ownerActorId: admission.request.ownerBinding.actorId,
        ownerActorCanBind: admission.request.ownerBinding.actorCanBind,
        delegated: admission.request.ownerBinding.delegated,
        impersonatingOwner: admission.request.ownerBinding.impersonatingOwner,
        intakeRef: admission.request.lifecycleEvidenceRefs.intakeRef,
        ownerBindingRef: admission.request.lifecycleEvidenceRefs.ownerBindingRef,
        initialCheckpointRef: admission.request.lifecycleEvidenceRefs.initialCheckpointRef,
        auditSubjectRef: admission.request.lifecycleEvidenceRefs.auditSubjectRef,
        intakeEvidenceProofId: admission.request.lifecycleEvidenceRefs.proof.proofId,
        generatedAt: now
      },
      {
        type: 'process-admission-scope-boundary',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        isolationKey: admission.scope.isolationKey,
        policyId: admission.scopeBoundary.policyId,
        mode: admission.scopeBoundary.mode,
        enforced: admission.scopeBoundary.enforced,
        allowed: admission.scopeBoundary.allowed,
        handoffAllowed: admission.scopeBoundary.handoffAllowed,
        violationCount: admission.scopeBoundary.violationCount,
        warningCount: admission.scopeBoundary.warningCount,
        compartmentKey: admission.scopeBoundary.compartmentKey,
        routePartition: admission.scopeBoundary.routePartition,
        proofId: admission.scopeBoundary.proof.proofId,
        auditProofRef: admission.scopeBoundary.audit.handoff.proofRef,
        tenantSource: admission.scope.tenantSource,
        workspaceSource: admission.scope.workspaceSource,
        tenantExplicit: admission.scope.tenantExplicit,
        workspaceExplicit: admission.scope.workspaceExplicit,
        defaultedAxes: admission.scopeBoundary.proof.scopeSources.defaultedAxes,
        actorRequestedRole: admission.scopeBoundary.proof.actorBoundary.requestedRole,
        actorEffectiveRole: admission.scopeBoundary.proof.actorBoundary.effectiveRole,
        actorRoleFallbackApplied: admission.scopeBoundary.proof.actorBoundary.roleFallbackApplied,
        activePermissionGrantCount: admission.scopeBoundary.proof.actorBoundary.activePermissionGrantCount,
        rejectedPermissionGrantCount: admission.scopeBoundary.proof.actorBoundary.rejectedPermissionGrantCount,
        auditSink: admission.scopeBoundary.audit.sink,
        generatedAt: now
      },
      {
        type: 'process-admission-provider-negotiation',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        providerId: admission.provider.providerId,
        providerState: admission.provider.state,
        providerProtocol: admission.provider.protocol,
        serviceContractId: admission.provider.serviceContract.contractId,
        serviceContractVersion: admission.provider.serviceContract.contractVersion,
        serviceContractProofId: admission.provider.serviceContract.proof.proofId,
        consistencyMode: admission.provider.serviceContract.consistencyMode,
        handoffAckMode: admission.provider.serviceContract.handoffAckMode,
        handoffAckRequired: admission.provider.serviceContract.handoffAckMode !== 'none',
        serviceContractViolationCount: admission.provider.serviceContract.violationCount,
        serviceContractWarningCount: admission.provider.serviceContract.warningCount,
        serviceContractViolations: admission.provider.serviceContract.violations.map((violation) => violation.code),
        negotiatedCapabilities: admission.provider.negotiatedCapabilities,
        missingCapabilities: admission.provider.missingCapabilities,
        admissionPolicyId: admission.admissionPolicy.policyId,
        admissionPolicyMode: admission.admissionPolicy.mode,
        admissionPolicySatisfied: admission.admissionPolicy.satisfied,
        admissionPolicyViolationCount: admission.admissionPolicy.violationCount,
        lifecycleControlState: admission.lifecycleControls.state,
        lifecycleSchedulingMode: admission.lifecycleControls.schedulingMode,
        lifecycleControlNextAction: admission.lifecycleControls.nextAction,
        externalHandoffState: admission.externalHandoff.state,
        externalHandoffAckState: admission.externalHandoff.acknowledgement.state,
        externalHandoffRef: admission.externalHandoff.payloadRef,
        syncGeneration: admission.provider.sync.generation,
        syncFreshnessState: admission.provider.sync.freshness.state,
        generatedAt: now
      },
      {
        type: 'process-admission-reporting-summary',
        surfaceId,
        reportId: admission.reporting.reportId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        exportFormat: admission.reporting.export.format,
        exportReady: admission.reporting.export.ready,
        mailchimpExportBatchId: admission.reporting.mailchimpExport.batchId,
        mailchimpExportState: admission.reporting.mailchimpExport.state,
        mailchimpExportReady: admission.reporting.mailchimpExport.ready,
        mailchimpExportDisposition: admission.reporting.mailchimpExport.disposition,
        mailchimpExportReadyRowCount: admission.reporting.mailchimpExport.readyRowCount,
        mailchimpExportBlockedBy: admission.reporting.mailchimpExport.blockedBy,
        mailchimpExportWatermark: admission.reporting.mailchimpExport.manifest.watermark,
        historySnapshotCount: admission.reporting.history.length,
        totalCommandCount: admission.reporting.counters['commands.total'] || 0,
        retainedHistoryMailchimpReadyCount: admission.reporting.historySummary.mailchimpReadyCount,
        retainedHistoryMailchimpAcceptedCount: admission.reporting.historySummary.mailchimpAcceptedCount,
        retainedHistoryMailchimpExportReadyCount: admission.reporting.historySummary.mailchimpExportReadyCount,
        retainedHistoryMailchimpBlockedCount: admission.reporting.historySummary.mailchimpBlockedCount,
        currentDecision: admission.reporting.currentSnapshot.status,
        currentPersistedStatus: admission.reporting.currentSnapshot.persistedStatus,
        previewStatus: admission.reporting.currentSnapshot.previewStatus,
        previewAcceptanceReadyState: admission.reporting.currentSnapshot.previewAcceptanceReadyState,
        previewAcceptanceRouteTarget: admission.reporting.currentSnapshot.previewAcceptanceRouteTarget,
        readinessReady: admission.reporting.currentSnapshot.readinessReady,
        nextRequiredAction: admission.reporting.currentSnapshot.nextRequiredAction,
        lifecycleControlState: admission.reporting.currentSnapshot.lifecycleControlState,
        lifecycleSchedulingMode: admission.reporting.currentSnapshot.lifecycleSchedulingMode,
        lifecycleControlNextAction: admission.reporting.currentSnapshot.lifecycleControlNextAction,
        validationBlockingGroupCount: admission.readiness.blockingGroupCount,
        generatedAt: now
      },
      {
        type: 'process-admission-mailchimp-export-batch',
        surfaceId,
        reportId: admission.reporting.reportId,
        batchId: admission.reporting.mailchimpExport.batchId,
        requestId: admission.request.requestId,
        commandId: admission.command.commandId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        state: admission.reporting.mailchimpExport.state,
        disposition: admission.reporting.mailchimpExport.disposition,
        ready: admission.reporting.mailchimpExport.ready,
        required: admission.reporting.mailchimpExport.required,
        rowCount: admission.reporting.mailchimpExport.rowCount,
        readyRowCount: admission.reporting.mailchimpExport.readyRowCount,
        blockedBy: admission.reporting.mailchimpExport.blockedBy,
        partitionKey: admission.reporting.mailchimpExport.manifest.partitionKey,
        watermark: admission.reporting.mailchimpExport.manifest.watermark,
        historyMailchimpReadyCount: admission.reporting.mailchimpExport.manifest.historyMailchimpReadyCount,
        historyMailchimpExportReadyCount: admission.reporting.mailchimpExport.manifest.historyMailchimpExportReadyCount,
        historyMailchimpBlockedCount: admission.reporting.mailchimpExport.manifest.historyMailchimpBlockedCount,
        timelineEventCount: admission.reporting.mailchimpExport.manifest.timelineEventCount,
        proofId: admission.reporting.mailchimpExport.proof.proofId,
        boundaryProofId: admission.reporting.mailchimpExport.proof.boundaryProofId,
        generatedAt: now
      },
      {
        type: 'process-admission-preview-contract',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        previewStatus: admission.preview.status,
        previewPrimaryAction: admission.preview.primaryAction,
        previewAcceptanceReadyState: admission.routePreviewAcceptance.readyState,
        previewAcceptanceContractId: admission.routePreviewAcceptance.contractId,
        previewAcceptanceRouteTarget: admission.routePreviewAcceptance.routeConsumption.target,
        previewAcceptancePrimaryOwner: admission.routePreviewAcceptance.display.primaryOwner,
        clientAcceptancePacketId: admission.clientAcceptance.packetId,
        clientAcceptanceMode: admission.clientAcceptance.acceptanceMode,
        clientAcceptanceRouteTarget: admission.clientAcceptance.routeTarget,
        clientAcceptanceCommandEnabled: admission.clientAcceptance.commandAffordances.accept.enabled,
        clientAcceptanceGateCount: admission.clientAcceptance.acceptanceGates.totalCount,
        clientAcceptanceBlockingGateCount: admission.clientAcceptance.acceptanceGates.blockingCount,
        clientAcceptanceWaitingGateCount: admission.clientAcceptance.acceptanceGates.waitingCount,
        clientAcceptancePrimaryGateKey: admission.clientAcceptance.acceptanceGates.primaryGate?.key || null,
        clientAcceptancePrimaryGateAction: admission.clientAcceptance.acceptanceGates.primaryGate?.action || null,
        readyForSpawn: admission.preview.readyForSpawn,
        readinessState: admission.readiness.state,
        readinessBlockingGroupCount: admission.readiness.blockingGroupCount,
        readinessRetryableGroupCount: admission.readiness.retryableGroupCount,
        nextRequiredAction: admission.nextSteps.nextRequiredAction,
        nextStepCount: admission.nextSteps.count,
        lifecycleControlState: admission.lifecycleControls.state,
        lifecycleSchedulingMode: admission.lifecycleControls.schedulingMode,
        lifecycleControlNextAction: admission.lifecycleControls.nextAction,
        generatedAt: now
      },
      {
        type: 'process-admission-route-preview-acceptance',
        surfaceId,
        contractId: admission.routePreviewAcceptance.contractId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        userVisibleState: admission.routePreviewAcceptance.userVisibleState,
        readyState: admission.routePreviewAcceptance.readyState,
        accepted: admission.routePreviewAcceptance.accepted,
        ready: admission.routePreviewAcceptance.ready,
        cancellable: admission.routePreviewAcceptance.cancellable,
        routeTarget: admission.routePreviewAcceptance.routeConsumption.target,
        workflowLane: admission.routePreviewAcceptance.routeConsumption.lane,
        primaryAction: admission.routePreviewAcceptance.display.primaryAction,
        primaryOwner: admission.routePreviewAcceptance.display.primaryOwner,
        nextStepAction: admission.routePreviewAcceptance.nextStep.action,
        nextStepStatus: admission.routePreviewAcceptance.nextStep.status,
        blockedGroupKeys: admission.routePreviewAcceptance.readiness.blockedGroupKeys,
        retryableGroupKeys: admission.routePreviewAcceptance.readiness.retryableGroupKeys,
        warningGroupKeys: admission.routePreviewAcceptance.readiness.warningGroupKeys,
        externalHandoffRef: admission.routePreviewAcceptance.proofRefs.externalHandoffRef,
        persistenceKey: admission.routePreviewAcceptance.proofRefs.persistenceKey,
        generatedAt: now
      },
      {
        type: 'process-admission-client-acceptance-packet',
        surfaceId,
        packetId: admission.clientAcceptance.packetId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        acceptanceMode: admission.clientAcceptance.acceptanceMode,
        accepted: admission.clientAcceptance.accepted,
        readyForSpawn: admission.clientAcceptance.readyForSpawn,
        routeTarget: admission.clientAcceptance.routeTarget,
        workflowLane: admission.clientAcceptance.workflowLane,
        primaryAction: admission.clientAcceptance.primaryAction,
        nextRequiredAction: admission.clientAcceptance.nextRequiredAction,
        clientActionRequired: admission.clientAcceptance.clientActionRequired,
        acceptCommandEnabled: admission.clientAcceptance.commandAffordances.accept.enabled,
        acceptCommandAction: admission.clientAcceptance.commandAffordances.accept.action,
        resumeCommand: admission.clientAcceptance.commandAffordances.resume?.commandName || null,
        cancelCommand: admission.clientAcceptance.commandAffordances.cancel?.commandName || null,
        readinessState: admission.clientAcceptance.readiness.state,
        blockingGroupCount: admission.clientAcceptance.readiness.blockingGroupCount,
        retryableGroupCount: admission.clientAcceptance.readiness.retryableGroupCount,
        warningGroupCount: admission.clientAcceptance.readiness.warningGroupCount,
        clientActionableStepCount: admission.clientAcceptance.readiness.clientActionableStepCount,
        digestGroupCount: admission.clientAcceptance.readiness.digest.length,
        validationTotalViolationCount: admission.clientAcceptance.validationSummary.totalViolationCount,
        actionableBlockingCount: admission.clientAcceptance.validationSummary.actionableBlockingCount,
        actionableRetryableCount: admission.clientAcceptance.validationSummary.actionableRetryableCount,
        externalHandoffState: admission.clientAcceptance.routeIntegration.externalHandoffState,
        externalHandoffRef: admission.clientAcceptance.routeIntegration.handoffRef,
        providerId: admission.clientAcceptance.routeIntegration.providerId,
        serviceContractId: admission.clientAcceptance.routeIntegration.serviceContractId,
        clientRuntimeHandoffContractId: admission.clientAcceptance.routeIntegration.clientRuntimeHandoffContractId,
        scopeBoundaryProofId: admission.clientAcceptance.proofRefs.scopeBoundaryProofId,
        providerServiceContractProofId: admission.clientAcceptance.proofRefs.providerServiceContractProofId,
        persistenceKey: admission.clientAcceptance.proofRefs.persistenceKey,
        generatedAt: now
      },
      {
        type: 'process-admission-actionable-error-triage',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        totalCount: admission.decision.errorTriage.totalCount,
        blockingCount: admission.decision.errorTriage.blockingCount,
        retryableCount: admission.decision.errorTriage.retryableCount,
        primarySource: admission.decision.errorTriage.primary?.source || null,
        primarySeverity: admission.decision.errorTriage.primary?.severity || null,
        primaryAction: admission.decision.errorTriage.primary?.action || null,
        primaryOwner: admission.decision.errorTriage.primary?.owner || null,
        nextRetryAfterMs: admission.decision.errorTriage.nextRetry?.retryAfterMs || null,
        degradedModeActive: admission.decision.errorTriage.degradedMode.active,
        groupedCounts: admission.decision.errorTriage.groupedCounts,
        generatedAt: now
      },
      {
        type: 'process-admission-client-route-action-manifest',
        surfaceId,
        manifestId: admission.clientRouteActionManifest.manifestId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        routeKey: admission.clientRouteActionManifest.routeKey,
        routeState: admission.clientRouteActionManifest.routeState,
        userVisibleStatus: admission.clientRouteActionManifest.userVisibleStatus,
        actionName: admission.clientRouteActionManifest.action.name,
        actionEnabled: admission.clientRouteActionManifest.action.enabled,
        actionTarget: admission.clientRouteActionManifest.action.target,
        workflowLane: admission.clientRouteActionManifest.action.lane,
        actionOwner: admission.clientRouteActionManifest.action.owner,
        payloadRef: admission.clientRouteActionManifest.action.payloadRef,
        retryAfterMs: admission.clientRouteActionManifest.action.retryAfterMs,
        externalHandoffState: admission.clientRouteActionManifest.handoff.externalState,
        externalHandoffAckMode: admission.clientRouteActionManifest.handoff.ackMode,
        externalHandoffAckState: admission.clientRouteActionManifest.handoff.ackState,
        providerId: admission.clientRouteActionManifest.handoff.providerId,
        serviceContractId: admission.clientRouteActionManifest.handoff.serviceContractId,
        clientRuntimeContractId: admission.clientRouteActionManifest.handoff.clientRuntimeContractId,
        runtimeAdoptionState: admission.clientRouteActionManifest.clientState.runtimeAdoptionState,
        runtimeAdoptionNextAction: admission.clientRouteActionManifest.clientState.runtimeAdoptionNextAction,
        clientActionRequired: admission.clientRouteActionManifest.clientState.actionRequired,
        nextRequiredAction: admission.clientRouteActionManifest.clientState.nextRequiredAction,
        blockedBy: admission.clientRouteActionManifest.clientState.blockedBy,
        previewAcceptanceContractId: admission.clientRouteActionManifest.proofRefs.previewAcceptanceContractId,
        clientAcceptancePacketId: admission.clientRouteActionManifest.proofRefs.clientAcceptancePacketId,
        persistenceKey: admission.clientRouteActionManifest.proofRefs.persistenceKey,
        writeRevision: admission.clientRouteActionManifest.proofRefs.writeRevision,
        journalSequence: admission.clientRouteActionManifest.proofRefs.journalSequence,
        scopeBoundaryProofId: admission.clientRouteActionManifest.proofRefs.scopeBoundaryProofId,
        providerServiceContractProofId: admission.clientRouteActionManifest.proofRefs.providerServiceContractProofId,
        externalHandoffRef: admission.clientRouteActionManifest.proofRefs.externalHandoffRef,
        generatedAt: now
      },
      {
        type: 'process-admission-workflow-handoff-receipt',
        surfaceId,
        receiptId: admission.workflowHandoffReceipt.receiptId,
        requestId: admission.request.requestId,
        commandId: admission.command.commandId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        state: admission.workflowHandoffReceipt.state,
        handoffEnabled: admission.workflowHandoffReceipt.handoffEnabled,
        userVisibleStatus: admission.workflowHandoffReceipt.userVisibleStatus,
        userVisibleAction: admission.workflowHandoffReceipt.userVisibleAction,
        routeKey: admission.workflowHandoffReceipt.routeKey,
        routeTarget: admission.workflowHandoffReceipt.routeTarget,
        workflowLane: admission.workflowHandoffReceipt.workflowLane,
        workflowState: admission.workflowHandoffReceipt.workflowState,
        owner: admission.workflowHandoffReceipt.owner,
        firstRequiredAction: admission.workflowHandoffReceipt.firstRequiredAction,
        retryAfterMs: admission.workflowHandoffReceipt.retryAfterMs,
        runtimeAdoptionState: admission.workflowHandoffReceipt.adoptionGate.state,
        runtimeAdoptionNextAction: admission.workflowHandoffReceipt.adoptionGate.nextAction,
        clientRuntimeHandoffContractId: admission.workflowHandoffReceipt.adoptionGate.handoffContractId,
        externalHandoffState: admission.workflowHandoffReceipt.runtimeContract.externalHandoffState,
        externalHandoffRef: admission.workflowHandoffReceipt.runtimeContract.externalHandoffRef,
        providerId: admission.workflowHandoffReceipt.runtimeContract.providerId,
        serviceContractId: admission.workflowHandoffReceipt.runtimeContract.serviceContractId,
        persistedStatus: admission.workflowHandoffReceipt.durability.persistedStatus,
        checkpointPhase: admission.workflowHandoffReceipt.durability.checkpointPhase,
        checkpointNextCommand: admission.workflowHandoffReceipt.durability.checkpointNextCommand,
        writeRevision: admission.workflowHandoffReceipt.durability.writeRevision,
        journalSequence: admission.workflowHandoffReceipt.durability.journalSequence,
        recoveryToken: admission.workflowHandoffReceipt.durability.recoveryToken,
        objectiveKey: admission.workflowHandoffReceipt.intake.objectiveKey,
        ownerBindingId: admission.workflowHandoffReceipt.intake.ownerBindingId,
        intakeEvidenceProofId: admission.workflowHandoffReceipt.intake.intakeEvidenceProofId,
        blockedBy: admission.workflowHandoffReceipt.blockers.blockedBy,
        routeActionManifestId: admission.workflowHandoffReceipt.proofRefs.routeActionManifestId,
        clientAcceptancePacketId: admission.workflowHandoffReceipt.proofRefs.clientAcceptancePacketId,
        scopeBoundaryProofId: admission.workflowHandoffReceipt.proofRefs.scopeBoundaryProofId,
        providerServiceContractProofId: admission.workflowHandoffReceipt.proofRefs.providerServiceContractProofId,
        generatedAt: now
      },
      {
        type: 'process-admission-client-runtime-adoption',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        state: admission.client.runtimeAdoption.state,
        required: admission.client.runtimeAdoption.required,
        adopted: admission.client.runtimeAdoption.adopted,
        expectedRuntimeMode: admission.client.runtimeAdoption.expectedRuntimeMode,
        observedRuntimeMode: admission.client.runtimeAdoption.observedRuntimeMode,
        providerId: admission.client.runtimeAdoption.providerId,
        providerProtocol: admission.client.runtimeAdoption.providerProtocol,
        acceptedProtocol: admission.client.runtimeAdoption.acceptedProtocol,
        handoffEnabled: admission.client.runtimeAdoption.handoffEnabled,
        clientSyncGeneration: admission.client.runtimeAdoption.sync.clientGeneration,
        providerSyncGeneration: admission.client.runtimeAdoption.sync.providerGeneration,
        syncCurrent: admission.client.runtimeAdoption.sync.current,
        nextAction: admission.client.runtimeAdoption.workflow.nextAction,
        target: admission.client.runtimeAdoption.workflow.target,
        handoffContractId: admission.client.runtimeAdoption.workflow.handoffContractId,
        violationCount: admission.client.runtimeAdoption.violationCount,
        warningCount: admission.client.runtimeAdoption.warningCount,
        violations: admission.client.runtimeAdoption.violations.map((violation) => violation.code),
        warnings: admission.client.runtimeAdoption.warnings.map((warning) => warning.code),
        generatedAt: now
      },
      {
        type: 'process-admission-client-workflow',
        surfaceId,
        requestId: admission.request.requestId,
        tenantId: admission.scope.tenantId,
        workspaceId: admission.scope.workspaceId,
        workflowState: admission.clientWorkflow.state,
        workflowLane: admission.clientWorkflow.lane,
        primaryAction: admission.clientWorkflow.primaryAction,
        persistenceWriteOperation: admission.clientWorkflow.proofRefs.persistenceWriteOperation,
        persistenceWriteRevision: admission.clientWorkflow.proofRefs.persistenceWriteRevision,
        journalSequence: admission.clientWorkflow.proofRefs.journalSequence,
        lifecycleControlState: admission.lifecycleControls.state,
        lifecycleSchedulingMode: admission.lifecycleControls.schedulingMode,
        lifecycleControlNextAction: admission.lifecycleControls.nextAction,
        cancellable: admission.clientWorkflow.cancellable,
        resumeCommand: admission.clientWorkflow.commands.resume?.commandName || null,
        cancelCommand: admission.clientWorkflow.commands.cancel?.commandName || null,
        externalHandoffRef: admission.clientWorkflow.proofRefs.externalHandoffRef,
        persistenceKey: admission.clientWorkflow.proofRefs.persistenceKey,
        generatedAt: now
      }
    ]
  };
}

export default describeProcessAdmissionSurface;
