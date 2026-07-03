export const surfaceId = "aios_audit-recovery_panic-inspector_075";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "panic-inspector";

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['panic.inspect', 'panic.recover', 'audit.handoff', 'tenant.override'],
  admin: ['panic.inspect', 'panic.recover', 'audit.handoff'],
  operator: ['panic.inspect', 'audit.handoff'],
  auditor: ['panic.inspect', 'audit.handoff.read'],
  viewer: ['panic.inspect.read']
});

const TERMINAL_STATES = new Set(['contained', 'handoff_ready', 'blocked']);
const FAILURE_STATES = new Set(['panic', 'failed', 'blocked', 'quarantined', 'degraded']);
const RETRYABLE_STATES = new Set(['reported', 'panic', 'failed', 'degraded']);
const LIFECYCLE_COMMANDS = new Set(['inspect', 'enable', 'disable', 'pause', 'resume', 'schedule_retry', 'handoff']);
const LIFECYCLE_MODES = new Set(['active', 'paused', 'disabled']);
const CLIENT_CHANNELS = new Set(['web', 'cli', 'api', 'worker']);
const CLIENT_HANDOFF_INTENTS = new Set(['inspect', 'retry', 'recover', 'handoff', 'accept_preview', 'review_blockers']);
const MUTATING_COMMANDS = new Set(['enable', 'disable', 'pause', 'resume', 'schedule_retry', 'handoff']);
const PERSISTED_STATUSES = new Set(['new', 'hydrated', 'in_progress', 'retry_scheduled', 'recovered', 'handoff_ready', 'blocked', 'stale', 'corrupt']);
const COMMAND_TERMINAL_STATUSES = new Set(['applied', 'rejected', 'skipped', 'failed']);
const COMMAND_RECOVERABLE_STATUSES = new Set(['accepted', 'in_progress', 'prepared', 'lease_acquired']);
const EXPORT_FORMATS = new Set(['json', 'ndjson', 'csv']);
const EXPORT_SCOPES = new Set(['summary', 'history', 'timeline', 'full']);
const EXPORT_DELIVERY_CHANNELS = new Set(['inline', 'provider_sync', 'external_handoff']);
const PROVIDER_PROTOCOLS = new Set(['in_process', 'http', 'queue', 'event_bridge']);
const PROVIDER_SYNC_STATUSES = new Set(['unknown', 'current', 'dirty', 'stale', 'blocked', 'failed']);
const PROVIDER_CONSISTENCY_LEVELS = new Set(['eventual', 'read_after_write', 'linearizable']);
const PROVIDER_RECORD_SCHEMAS = Object.freeze({
  incident: 'aios.panic-inspector.incident.v1',
  evidence: 'aios.panic-inspector.evidence.v1',
  summary: 'aios.panic-inspector.summary.v1',
  lifecycle: 'aios.panic-inspector.lifecycle-transition.v1',
  externalHandoff: 'aios.panic-inspector.external-handoff.v1'
});
const PROVIDER_CAPABILITIES = Object.freeze({
  inspect: 'panic.inspect',
  recover: 'panic.recover',
  auditExport: 'audit.export',
  evidenceIngest: 'evidence.ingest',
  syncStatus: 'sync.status',
  externalHandoff: 'handoff.external'
});
const SEVERITY_RANK = Object.freeze({
  unknown: 0,
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5
});
const ACTIONABLE_ERROR_GUIDANCE = Object.freeze({
  tenant_mismatch: {
    severity: 'critical',
    owner: 'tenant-security',
    route: 'audit-recovery/panic-inspector/boundary-review',
    remediation: 'Re-run the inspection from the incident tenant or attach a tenant override proof.'
  },
  workspace_mismatch: {
    severity: 'high',
    owner: 'workspace-admin',
    route: 'audit-recovery/panic-inspector/boundary-review',
    remediation: 'Grant the actor access to the incident workspace before inspecting panic evidence.'
  },
  workspace_not_granted: {
    severity: 'high',
    owner: 'workspace-admin',
    route: 'audit-recovery/panic-inspector/workspace-access',
    remediation: 'Add the incident workspace to the access policy or switch to an authorized workspace principal.'
  },
  workspace_explicitly_denied: {
    severity: 'critical',
    owner: 'workspace-admin',
    route: 'audit-recovery/panic-inspector/workspace-access',
    remediation: 'Remove the explicit workspace denial or route the incident to an owner/admin.'
  },
  tenant_override_required_by_incident_scope: {
    severity: 'critical',
    owner: 'tenant-security',
    route: 'audit-recovery/panic-inspector/boundary-review',
    remediation: 'Attach a tenant override proof before cross-tenant or privileged incident inspection.'
  },
  cross_workspace_evidence_requires_override: {
    severity: 'high',
    owner: 'audit-ops',
    route: 'audit-recovery/panic-inspector/evidence',
    remediation: 'Enable cross-workspace evidence with override permission or redact the cross-workspace records.'
  },
  missing_panic_inspect_permission: {
    severity: 'critical',
    owner: 'iam-admin',
    route: 'audit-recovery/panic-inspector/boundary-review',
    remediation: 'Grant panic.inspect or panic.inspect.read before exposing incident details.'
  },
  terminal_state_requires_recovery_permission: {
    severity: 'high',
    owner: 'recovery-ops',
    route: 'audit-recovery/panic-inspector/recovery',
    remediation: 'Use a recovery-capable principal to inspect terminal panic states.'
  },
  failure_state_requires_evidence: {
    severity: 'critical',
    owner: 'runtime-ops',
    route: 'audit-recovery/panic-inspector/evidence',
    remediation: 'Attach runtime logs, panic traces, or audit records before retrying recovery.'
  },
  blocked_state_requires_failure_signal: {
    severity: 'high',
    owner: 'runtime-ops',
    route: 'audit-recovery/panic-inspector/health',
    remediation: 'Record the blocking component, failure code, and observation timestamp.'
  },
  no_trusted_workspace_evidence: {
    severity: 'high',
    owner: 'audit-ops',
    route: 'audit-recovery/panic-inspector/evidence',
    remediation: 'Replace untrusted or cross-scope evidence with workspace-scoped evidence.'
  },
  related_workspace_not_effective: {
    severity: 'high',
    owner: 'workspace-admin',
    route: 'audit-recovery/panic-inspector/workspace-access',
    remediation: 'Grant the related workspace for cross-workspace evidence or keep it redacted from hosted-kernel handoff.'
  },
  mutation_outside_effective_scope: {
    severity: 'critical',
    owner: 'tenant-security',
    route: 'audit-recovery/panic-inspector/boundary-review',
    remediation: 'Restrict the lifecycle command to the effective incident workspace or attach an override proof.'
  },
  provider_scope_envelope_mismatch: {
    severity: 'critical',
    owner: 'provider-ops',
    route: 'audit-recovery/panic-inspector/provider',
    remediation: 'Require the provider endpoint to accept the same tenant/workspace envelope as the hosted kernel.'
  }
});

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
}

function proofId(prefix, payload) {
  let hash = 2166136261;
  const text = stableString(payload);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function cleanToken(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseTimestampMs(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addMinutesIso(anchor, minutes) {
  const anchorMs = parseTimestampMs(anchor);
  if (anchorMs === null || !Number.isFinite(minutes)) return null;
  return new Date(anchorMs + (Math.max(0, Math.floor(minutes)) * 60000)).toISOString();
}

function normalizeTokenList(values, allowedValues = null) {
  const allowed = allowedValues instanceof Set ? allowedValues : null;
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => allowed === null || allowed.has(value)))].sort();
}

function normalizePrincipal(input) {
  const principal = input.principal && typeof input.principal === 'object' ? input.principal : {};
  const role = cleanToken(principal.role || input.role, 'viewer').toLowerCase();
  const rawWorkspaceGrants = Array.isArray(principal.workspaceIds)
    ? principal.workspaceIds
    : Array.isArray(principal.allowedWorkspaceIds)
      ? principal.allowedWorkspaceIds
      : Array.isArray(input.allowedWorkspaceIds)
        ? input.allowedWorkspaceIds
        : [];
  const permissions = new Set([
    ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer),
    ...(Array.isArray(principal.permissions) ? principal.permissions : []),
    ...(Array.isArray(input.permissions) ? input.permissions : [])
  ].filter((permission) => typeof permission === 'string' && permission.length > 0));

  return {
    id: cleanToken(principal.id || input.actorId, 'anonymous'),
    role,
    tenantId: cleanToken(principal.tenantId || input.tenantId, 'default-tenant'),
    workspaceId: cleanToken(principal.workspaceId || input.workspaceId, 'default-workspace'),
    workspaceIds: [...new Set(rawWorkspaceGrants
      .filter((workspaceId) => typeof workspaceId === 'string' && workspaceId.trim().length > 0)
      .map((workspaceId) => workspaceId.trim()))].sort(),
    permissions: [...permissions].sort()
  };
}

function normalizeIncident(input) {
  const incident = input.incident && typeof input.incident === 'object' ? input.incident : {};
  const scope = incident.scope && typeof incident.scope === 'object'
    ? incident.scope
    : input.scope && typeof input.scope === 'object'
      ? input.scope
      : {};
  const tenantId = cleanToken(incident.tenantId || input.tenantId, 'default-tenant');
  const workspaceId = cleanToken(incident.workspaceId || input.workspaceId, 'default-workspace');
  const state = cleanToken(incident.state || input.state, 'reported').toLowerCase();
  const severity = cleanToken(incident.severity || input.severity, 'unknown').toLowerCase();
  const relatedWorkspaceIds = Array.isArray(scope.relatedWorkspaceIds)
    ? scope.relatedWorkspaceIds
    : Array.isArray(incident.relatedWorkspaceIds)
      ? incident.relatedWorkspaceIds
      : [];

  return {
    id: cleanToken(incident.id || input.incidentId, proofId('incident', { tenantId, workspaceId, state, severity })),
    tenantId,
    workspaceId,
    state,
    severity,
    reason: cleanToken(incident.reason || input.reason, 'panic inspection requested'),
    scope: {
      tenantId,
      workspaceId,
      relatedWorkspaceIds: [...new Set(relatedWorkspaceIds
        .filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate !== workspaceId))].sort(),
      allowCrossWorkspaceEvidence: scope.allowCrossWorkspaceEvidence === true || incident.allowCrossWorkspaceEvidence === true,
      requiresTenantOverride: scope.requiresTenantOverride === true || incident.requiresTenantOverride === true,
      boundaryLabel: cleanToken(scope.boundaryLabel || incident.boundaryLabel, 'hosted-kernel-workspace')
    },
    evidence: Array.isArray(incident.evidence) ? incident.evidence : Array.isArray(input.evidence) ? input.evidence : []
  };
}

function normalizeWorkspaceAccessPolicy(input, principal, incident) {
  const rawPolicy = input.workspaceAccess && typeof input.workspaceAccess === 'object'
    ? input.workspaceAccess
    : input.accessPolicy && typeof input.accessPolicy === 'object'
      ? input.accessPolicy
      : {};
  const rawAllowed = Array.isArray(rawPolicy.allowedWorkspaceIds)
    ? rawPolicy.allowedWorkspaceIds
    : Array.isArray(rawPolicy.workspaceIds)
      ? rawPolicy.workspaceIds
      : [];
  const rawDenied = Array.isArray(rawPolicy.deniedWorkspaceIds) ? rawPolicy.deniedWorkspaceIds : [];
  const granted = new Set([
    principal.workspaceId,
    ...principal.workspaceIds,
    ...rawAllowed
  ].filter((workspaceId) => typeof workspaceId === 'string' && workspaceId.trim().length > 0)
    .map((workspaceId) => workspaceId.trim()));
  const deniedWorkspaceIds = [...new Set(rawDenied
    .filter((workspaceId) => typeof workspaceId === 'string' && workspaceId.trim().length > 0)
    .map((workspaceId) => workspaceId.trim()))].sort();
  const relatedWorkspaceIds = incident.scope.relatedWorkspaceIds;
  const incidentWorkspaceGranted = granted.has(incident.workspaceId);
  const deniedIncidentWorkspace = deniedWorkspaceIds.includes(incident.workspaceId);
  const crossWorkspaceEvidenceIds = incident.evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => cleanToken(entry.workspaceId, incident.workspaceId))
    .filter((workspaceId) => workspaceId !== incident.workspaceId);
  const crossWorkspaceEvidenceAllowed = incident.scope.allowCrossWorkspaceEvidence === true
    && (rawPolicy.allowCrossWorkspaceEvidence === true || hasPermission(principal, 'tenant.override'));

  return {
    schema: 'aios.panic-inspector.workspace-access.v1',
    mode: cleanToken(rawPolicy.mode, crossWorkspaceEvidenceAllowed ? 'cross_workspace_evidence' : 'single_workspace'),
    tenantId: incident.tenantId,
    workspaceId: incident.workspaceId,
    actorWorkspaceId: principal.workspaceId,
    boundaryLabel: incident.scope.boundaryLabel,
    allowedWorkspaceIds: [...granted].sort(),
    deniedWorkspaceIds,
    relatedWorkspaceIds,
    incidentWorkspaceGranted,
    deniedIncidentWorkspace,
    crossWorkspaceEvidenceIds: [...new Set(crossWorkspaceEvidenceIds)].sort(),
    crossWorkspaceEvidenceAllowed,
    requiresTenantOverride: incident.scope.requiresTenantOverride,
    auditRoute: cleanToken(rawPolicy.auditRoute, 'audit-recovery/panic-inspector/workspace-access')
  };
}

function normalizeHealthSignal(input, incident) {
  const health = input.health && typeof input.health === 'object' ? input.health : {};
  const retry = health.retry && typeof health.retry === 'object' ? health.retry : {};
  const rawFailures = Array.isArray(health.failures) ? health.failures : Array.isArray(input.failures) ? input.failures : [];
  const failures = rawFailures
    .filter((failure) => failure && typeof failure === 'object')
    .map((failure, index) => ({
      id: cleanToken(failure.id, proofId('failure', { incidentId: incident.id, index, failure })),
      code: cleanToken(failure.code || failure.kind, 'runtime_failure'),
      message: cleanToken(failure.message || failure.reason, 'panic inspector failure signal'),
      retryable: failure.retryable !== false,
      observedAt: cleanToken(failure.observedAt || failure.at, null),
      component: cleanToken(failure.component || failure.source, 'hosted-kernel')
    }));

  const attempts = Number.isInteger(retry.attempts) && retry.attempts >= 0 ? retry.attempts : 0;
  const maxAttempts = Number.isInteger(retry.maxAttempts) && retry.maxAttempts > 0 ? retry.maxAttempts : 3;
  const baseDelayMs = Number.isFinite(retry.baseDelayMs) && retry.baseDelayMs > 0 ? Math.floor(retry.baseDelayMs) : 500;
  const nextDelayMs = Math.min(30000, baseDelayMs * (2 ** Math.min(attempts, 6)));

  return {
    status: cleanToken(health.status || input.healthStatus, incident.state === 'degraded' ? 'degraded' : 'nominal').toLowerCase(),
    source: cleanToken(health.source || input.healthSource, 'hosted-kernel'),
    observedAt: cleanToken(health.observedAt || health.checkedAt || input.healthObservedAt, null),
    staleAfterMs: Number.isInteger(health.staleAfterMs) && health.staleAfterMs > 0
      ? Math.min(health.staleAfterMs, 86400000)
      : 300000,
    failures,
    retry: {
      attempts,
      maxAttempts,
      exhausted: attempts >= maxAttempts,
      nextDelayMs
    }
  };
}

function validateIncident(incident, health) {
  const errors = [];
  const warnings = [];
  const evidenceCount = incident.evidence.length;
  const trustedEvidenceCount = incident.evidence
    .filter((entry) => entry && typeof entry === 'object')
    .filter((entry) => cleanToken(entry.tenantId, incident.tenantId) === incident.tenantId
      && cleanToken(entry.workspaceId, incident.workspaceId) === incident.workspaceId)
    .length;

  if (!Object.hasOwn(SEVERITY_RANK, incident.severity)) warnings.push('unknown_severity');
  if (FAILURE_STATES.has(incident.state) && evidenceCount === 0) errors.push('failure_state_requires_evidence');
  if (incident.state === 'blocked' && health.failures.length === 0) errors.push('blocked_state_requires_failure_signal');
  if (evidenceCount > 0 && trustedEvidenceCount === 0) errors.push('no_trusted_workspace_evidence');
  if (health.retry.exhausted && RETRYABLE_STATES.has(incident.state)) warnings.push('retry_budget_exhausted');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    evidenceCount,
    trustedEvidenceCount
  };
}

function buildActionableErrorRunbook(incident, boundary, health, validation) {
  const validationAndBoundaryErrors = [...new Set([
    ...boundary.violations,
    ...validation.errors
  ])].sort();
  const failures = health.failures.map((failure) => {
    const failureObservedAt = parseTimestampMs(failure.observedAt) === null ? null : failure.observedAt;
    const failureCode = cleanToken(failure.code, 'runtime_failure');
    const severity = failure.retryable ? incident.severity : 'critical';
    return {
      id: proofId('actionable_failure', { incidentId: incident.id, failure }),
      code: failureCode,
      kind: 'runtime_failure',
      severity,
      owner: failure.component,
      route: `audit-recovery/panic-inspector/health/${failureCode}`,
      retryable: failure.retryable,
      observedAt: failureObservedAt,
      message: failure.message,
      remediation: failure.retryable
        ? 'Allow the configured retry backoff to elapse, then retry the panic inspection.'
        : 'Route to audit handoff or manual recovery because this failure is marked non-retryable.'
    };
  });
  const blockers = validationAndBoundaryErrors.map((code) => {
    const guidance = ACTIONABLE_ERROR_GUIDANCE[code] || {
      severity: SEVERITY_RANK[incident.severity] >= SEVERITY_RANK.high ? incident.severity : 'medium',
      owner: 'audit-ops',
      route: 'audit-recovery/panic-inspector/review',
      remediation: 'Review the panic inspection blocker and attach a corrective audit note.'
    };
    return {
      id: proofId('actionable_blocker', { incidentId: incident.id, code, guidance }),
      code,
      kind: 'inspection_blocker',
      severity: guidance.severity,
      owner: guidance.owner,
      route: guidance.route,
      retryable: false,
      observedAt: null,
      message: code,
      remediation: guidance.remediation
    };
  });
  const items = [...blockers, ...failures].sort((left, right) => {
    const severityDelta = (SEVERITY_RANK[right.severity] || 0) - (SEVERITY_RANK[left.severity] || 0);
    return severityDelta !== 0 ? severityDelta : left.code.localeCompare(right.code);
  });
  const retryableFailureCount = failures.filter((failure) => failure.retryable).length;
  const nonRetryableFailureCount = failures.length - retryableFailureCount;
  const highestSeverity = items.reduce((highest, item) => {
    const rank = SEVERITY_RANK[item.severity] || 0;
    return rank > highest.rank ? { severity: item.severity, rank } : highest;
  }, { severity: incident.severity, rank: SEVERITY_RANK[incident.severity] || 0 }).severity;
  const degradedModeReason = blockers.length > 0
    ? 'inspection_blockers_present'
    : nonRetryableFailureCount > 0
      ? 'non_retryable_failure_present'
      : health.retry.exhausted
        ? 'retry_budget_exhausted'
        : health.status === 'degraded'
          ? 'health_signal_degraded'
          : null;

  return {
    schema: 'aios.panic-inspector.actionable-errors.v1',
    valid: blockers.length === 0 && nonRetryableFailureCount === 0,
    degradedModeReason,
    highestSeverity,
    counts: {
      total: items.length,
      blockers: blockers.length,
      runtimeFailures: failures.length,
      retryableFailures: retryableFailureCount,
      nonRetryableFailures: nonRetryableFailureCount
    },
    retryPolicy: {
      allowed: validation.valid
        && boundary.allowed
        && !health.retry.exhausted
        && nonRetryableFailureCount === 0
        && health.failures.every((failure) => failure.retryable),
      attempts: health.retry.attempts,
      maxAttempts: health.retry.maxAttempts,
      nextDelayMs: health.retry.nextDelayMs,
      exhausted: health.retry.exhausted
    },
    items
  };
}

function buildOperationalDegradationContract(now, incident, boundary, health, validation, errorRunbook) {
  const nowMs = parseTimestampMs(now);
  const healthObservedMs = parseTimestampMs(health.observedAt);
  const telemetryAgeMs = nowMs !== null && healthObservedMs !== null ? Math.max(0, nowMs - healthObservedMs) : null;
  const telemetryStale = health.observedAt
    ? healthObservedMs === null || (telemetryAgeMs !== null && telemetryAgeMs > health.staleAfterMs)
    : health.failures.length > 0;
  const failureContracts = health.failures.map((failure) => {
    const observedMs = parseTimestampMs(failure.observedAt);
    const ageMs = nowMs !== null && observedMs !== null ? Math.max(0, nowMs - observedMs) : null;
    const stale = failure.observedAt ? observedMs === null || (ageMs !== null && ageMs > health.staleAfterMs) : true;
    const retryBlockedReason = !failure.retryable
      ? 'failure_marked_non_retryable'
      : stale
        ? 'failure_signal_stale'
        : !boundary.allowed
          ? 'boundary_not_authorized'
          : !validation.valid
            ? 'incident_validation_failed'
            : health.retry.exhausted
              ? 'retry_budget_exhausted'
              : null;

    return {
      id: proofId('failure_contract', { incidentId: incident.id, failure, stale, retryBlockedReason }),
      failureId: failure.id,
      code: failure.code,
      component: failure.component,
      observedAt: failure.observedAt,
      ageMs,
      stale,
      retryable: failure.retryable && retryBlockedReason === null,
      retryBlockedReason,
      route: stale
        ? 'audit-recovery/panic-inspector/health/refresh'
        : failure.retryable
          ? 'audit-recovery/panic-inspector/retry'
          : 'audit-recovery/panic-inspector/handoff',
      requiredAction: stale
        ? 'refresh_failure_signal'
        : retryBlockedReason
          ? 'repair_retry_blocker'
          : 'queue_retry_after_backoff'
    };
  });
  const staleFailureCount = failureContracts.filter((contract) => contract.stale).length;
  const retryBlockedFailureCount = failureContracts.filter((contract) => contract.retryBlockedReason !== null).length;
  const validationBlocked = validation.errors.length > 0 || boundary.violations.length > 0;
  const shouldEnterDegradedMode = telemetryStale
    || staleFailureCount > 0
    || retryBlockedFailureCount > 0
    || validationBlocked
    || errorRunbook.degradedModeReason !== null
    || health.status === 'degraded'
    || incident.state === 'degraded';
  const recoveryMode = !shouldEnterDegradedMode
    ? 'normal'
    : telemetryStale || staleFailureCount > 0
      ? 'refresh_health_signals'
      : errorRunbook.counts.nonRetryableFailures > 0
        ? 'manual_handoff'
        : health.retry.exhausted
          ? 'retry_exhausted_handoff'
          : validationBlocked
            ? 'blocker_repair'
            : 'read_only_retry_review';
  const nextRoute = recoveryMode === 'refresh_health_signals'
    ? 'audit-recovery/panic-inspector/health/refresh'
    : recoveryMode === 'manual_handoff' || recoveryMode === 'retry_exhausted_handoff'
      ? 'audit-recovery/panic-inspector/handoff'
      : recoveryMode === 'blocker_repair'
        ? 'audit-recovery/panic-inspector/review'
        : recoveryMode === 'read_only_retry_review'
          ? 'audit-recovery/panic-inspector/retry'
          : 'audit-recovery/panic-inspector/health';

  return {
    schema: 'aios.panic-inspector.operational-degradation.v1',
    generatedAt: now,
    status: shouldEnterDegradedMode ? 'degraded' : 'nominal',
    recoveryMode,
    nextRoute,
    telemetry: {
      source: health.source,
      status: health.status,
      observedAt: health.observedAt,
      ageMs: telemetryAgeMs,
      staleAfterMs: health.staleAfterMs,
      stale: telemetryStale
    },
    failureContracts,
    counters: {
      failures: failureContracts.length,
      staleFailures: staleFailureCount,
      retryBlockedFailures: retryBlockedFailureCount,
      validationErrors: validation.errors.length,
      boundaryViolations: boundary.violations.length
    },
    audit: {
      id: proofId('operational_degradation', {
        incidentId: incident.id,
        status: shouldEnterDegradedMode ? 'degraded' : 'nominal',
        recoveryMode,
        telemetryStale,
        staleFailureCount,
        retryBlockedFailureCount
      }),
      format: 'aios.panic-inspector.operational-degradation.v1',
      route: nextRoute
    }
  };
}

function normalizeLifecycleSettings(input, incident, health) {
  const settings = input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
    ? input.lifecycleSettings
    : input.settings && typeof input.settings === 'object'
      ? input.settings
      : {};
  const schedule = settings.schedule && typeof settings.schedule === 'object' ? settings.schedule : {};
  const controls = settings.controls && typeof settings.controls === 'object' ? settings.controls : {};
  const commandPolicy = settings.commandPolicy && typeof settings.commandPolicy === 'object'
    ? settings.commandPolicy
    : controls.commandPolicy && typeof controls.commandPolicy === 'object'
      ? controls.commandPolicy
      : {};
  const rawCommand = cleanToken(input.lifecycleCommand || settings.command || input.command, 'inspect').toLowerCase();
  const requestedMode = cleanToken(settings.mode || input.lifecycleMode, settings.enabled === false ? 'disabled' : 'active').toLowerCase();
  const mode = LIFECYCLE_MODES.has(requestedMode) ? requestedMode : 'active';
  const cadenceMinutes = Number.isFinite(schedule.cadenceMinutes)
    ? Math.floor(schedule.cadenceMinutes)
    : Number.isFinite(settings.cadenceMinutes)
      ? Math.floor(settings.cadenceMinutes)
      : 15;
  const retryWindowMinutes = Number.isFinite(schedule.retryWindowMinutes)
    ? Math.floor(schedule.retryWindowMinutes)
    : Number.isFinite(settings.retryWindowMinutes)
      ? Math.floor(settings.retryWindowMinutes)
      : 60;
  const maxQueuedRetries = Number.isInteger(schedule.maxQueuedRetries) && schedule.maxQueuedRetries >= 0
    ? schedule.maxQueuedRetries
    : 2;
  const queuedRetries = Number.isInteger(schedule.queuedRetries) && schedule.queuedRetries >= 0
    ? schedule.queuedRetries
    : Number.isInteger(settings.queuedRetries) && settings.queuedRetries >= 0
      ? settings.queuedRetries
      : 0;
  const requestedAllowedCommands = normalizeTokenList(commandPolicy.allowedCommands || controls.allowedCommands, LIFECYCLE_COMMANDS);
  const disabledCommands = normalizeTokenList(commandPolicy.disabledCommands || controls.disabledCommands, LIFECYCLE_COMMANDS);
  const allowedCommands = requestedAllowedCommands.length > 0
    ? requestedAllowedCommands
    : [...LIFECYCLE_COMMANDS].sort();
  const effectiveCommands = allowedCommands.filter((command) => !disabledCommands.includes(command)).sort();
  const minCadenceMinutes = Number.isFinite(commandPolicy.minCadenceMinutes)
    ? Math.max(1, Math.floor(commandPolicy.minCadenceMinutes))
    : 1;
  const maxCadenceMinutes = Number.isFinite(commandPolicy.maxCadenceMinutes)
    ? Math.min(1440, Math.floor(commandPolicy.maxCadenceMinutes))
    : 1440;
  const minRetryWindowMinutes = Number.isFinite(commandPolicy.minRetryWindowMinutes)
    ? Math.max(5, Math.floor(commandPolicy.minRetryWindowMinutes))
    : 5;
  const maxRetryWindowMinutes = Number.isFinite(commandPolicy.maxRetryWindowMinutes)
    ? Math.min(10080, Math.floor(commandPolicy.maxRetryWindowMinutes))
    : 10080;

  return {
    command: LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : 'inspect',
    requestedCommand: rawCommand,
    enabled: settings.enabled === false || mode === 'disabled' ? false : true,
    mode,
    requestedMode,
    automation: {
      autoRecover: controls.autoRecover === true || settings.autoRecover === true,
      autoHandoff: controls.autoHandoff !== false && settings.autoHandoff !== false,
      requireProofs: controls.requireProofs !== false && settings.requireProofs !== false,
      requireHumanForCritical: controls.requireHumanForCritical !== false && settings.requireHumanForCritical !== false
    },
    commandPolicy: {
      schema: 'aios.panic-inspector.lifecycle-command-policy.v1',
      allowedCommands,
      disabledCommands,
      effectiveCommands,
      blockedCommandReason: cleanToken(commandPolicy.blockedCommandReason || controls.blockedCommandReason, null),
      requireDisableReason: commandPolicy.requireDisableReason !== false,
      requirePauseUntil: commandPolicy.requirePauseUntil === true,
      requireFutureResumeSchedule: commandPolicy.requireFutureResumeSchedule === true,
      allowRetryWhilePaused: commandPolicy.allowRetryWhilePaused !== false,
      allowAutoEnableOnRetry: commandPolicy.allowAutoEnableOnRetry === true,
      requireProofsForMutation: commandPolicy.requireProofsForMutation !== false,
      cadenceBounds: {
        minMinutes: Math.min(minCadenceMinutes, maxCadenceMinutes),
        maxMinutes: Math.max(minCadenceMinutes, maxCadenceMinutes)
      },
      retryWindowBounds: {
        minMinutes: Math.min(minRetryWindowMinutes, maxRetryWindowMinutes),
        maxMinutes: Math.max(minRetryWindowMinutes, maxRetryWindowMinutes)
      }
    },
    schedule: {
      cadenceMinutes,
      retryWindowMinutes,
      maxQueuedRetries,
      queuedRetries,
      nextInspectionAt: cleanToken(schedule.nextInspectionAt || settings.nextInspectionAt, null),
      pauseUntil: cleanToken(schedule.pauseUntil || settings.pauseUntil, null),
      disabledReason: cleanToken(settings.disabledReason || controls.disabledReason, null)
    },
    observed: {
      incidentState: incident.state,
      retryAttempts: health.retry.attempts,
      retryBudget: health.retry.maxAttempts
    }
  };
}

function validateLifecycleSettings(now, lifecycle, principal, incident, validation, boundary, operationalHealth) {
  const errors = [];
  const warnings = [];
  const nowMs = parseTimestampMs(now);
  const nextInspectionMs = parseTimestampMs(lifecycle.schedule.nextInspectionAt);
  const pauseUntilMs = parseTimestampMs(lifecycle.schedule.pauseUntil);

  if (!LIFECYCLE_COMMANDS.has(lifecycle.requestedCommand)) warnings.push('unknown_lifecycle_command_defaulted_to_inspect');
  if (!LIFECYCLE_MODES.has(lifecycle.requestedMode)) warnings.push('unknown_lifecycle_mode_defaulted_to_active');
  if (!lifecycle.commandPolicy.allowedCommands.includes(lifecycle.command)) errors.push('lifecycle_command_not_allowed_by_policy');
  if (lifecycle.commandPolicy.disabledCommands.includes(lifecycle.command)) errors.push('lifecycle_command_disabled_by_policy');
  if (lifecycle.commandPolicy.effectiveCommands.length === 0) errors.push('lifecycle_command_policy_has_no_effective_commands');
  if (MUTATING_COMMANDS.has(lifecycle.command) && lifecycle.commandPolicy.requireProofsForMutation && lifecycle.automation.requireProofs === false) {
    errors.push('mutating_command_requires_lifecycle_proofs');
  }
  if (
    lifecycle.schedule.cadenceMinutes < lifecycle.commandPolicy.cadenceBounds.minMinutes
    || lifecycle.schedule.cadenceMinutes > lifecycle.commandPolicy.cadenceBounds.maxMinutes
  ) {
    errors.push('cadence_minutes_out_of_policy_range');
  }
  if (
    lifecycle.schedule.retryWindowMinutes < lifecycle.commandPolicy.retryWindowBounds.minMinutes
    || lifecycle.schedule.retryWindowMinutes > lifecycle.commandPolicy.retryWindowBounds.maxMinutes
  ) {
    errors.push('retry_window_minutes_out_of_policy_range');
  }
  if (lifecycle.schedule.nextInspectionAt && nextInspectionMs === null) errors.push('next_inspection_at_unparseable');
  if (lifecycle.schedule.pauseUntil && pauseUntilMs === null) errors.push('pause_until_unparseable');
  if (lifecycle.schedule.nextInspectionAt && nextInspectionMs !== null && nowMs !== null && nextInspectionMs < nowMs) warnings.push('next_inspection_at_in_past');
  if (lifecycle.command === 'pause' && !lifecycle.schedule.pauseUntil) warnings.push('pause_without_until_uses_retry_window');
  if (lifecycle.command === 'pause' && lifecycle.commandPolicy.requirePauseUntil && !lifecycle.schedule.pauseUntil) errors.push('pause_until_required_by_policy');
  if (lifecycle.command === 'pause' && pauseUntilMs !== null && nowMs !== null && pauseUntilMs <= nowMs) errors.push('pause_until_must_be_future');
  if (lifecycle.command === 'enable' && !boundary.permissions.canRecover) errors.push('enable_requires_recovery_permission');
  if (lifecycle.command === 'disable' && !boundary.permissions.canRecover) errors.push('disable_requires_recovery_permission');
  if (lifecycle.command === 'disable' && lifecycle.commandPolicy.requireDisableReason && !lifecycle.schedule.disabledReason) errors.push('disable_requires_reason');
  if (lifecycle.command === 'handoff' && !boundary.permissions.canHandoff) errors.push('handoff_requires_audit_permission');
  if (lifecycle.command === 'schedule_retry' && !operationalHealth.retryable) errors.push('schedule_retry_requires_retryable_incident');
  if (lifecycle.command === 'schedule_retry' && lifecycle.schedule.maxQueuedRetries <= 0) errors.push('schedule_retry_requires_queue_capacity');
  if (lifecycle.command === 'schedule_retry' && lifecycle.schedule.queuedRetries >= lifecycle.schedule.maxQueuedRetries) errors.push('retry_queue_capacity_exhausted');
  if (lifecycle.command === 'schedule_retry' && lifecycle.mode === 'paused' && lifecycle.commandPolicy.allowRetryWhilePaused === false) errors.push('retry_while_paused_disabled_by_policy');
  if (lifecycle.command === 'schedule_retry' && lifecycle.mode === 'disabled' && lifecycle.commandPolicy.allowAutoEnableOnRetry === false) errors.push('retry_while_disabled_requires_auto_enable_policy');
  if (lifecycle.command === 'resume' && lifecycle.mode !== 'paused') warnings.push('resume_requested_while_not_paused');
  if (lifecycle.command === 'resume' && lifecycle.commandPolicy.requireFutureResumeSchedule && (!lifecycle.schedule.nextInspectionAt || nextInspectionMs === null || (nowMs !== null && nextInspectionMs <= nowMs))) {
    errors.push('resume_requires_future_next_inspection');
  }
  if (lifecycle.command === 'pause' && lifecycle.mode === 'disabled') warnings.push('pause_requested_while_disabled');
  if (lifecycle.automation.autoRecover && !boundary.permissions.canRecover) errors.push('auto_recover_requires_recovery_permission');
  if (lifecycle.automation.autoRecover && SEVERITY_RANK[incident.severity] >= SEVERITY_RANK.critical && lifecycle.automation.requireHumanForCritical) {
    warnings.push('critical_incident_human_confirmation_required');
  }
  if (lifecycle.enabled === false && !lifecycle.schedule.disabledReason) warnings.push('disabled_without_reason');
  if (validation.errors.length > 0 && lifecycle.automation.autoRecover) errors.push('auto_recover_blocked_by_validation_errors');
  if (!boundary.allowed && lifecycle.command !== 'inspect') errors.push('lifecycle_mutation_blocked_by_boundary');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    actorId: principal.id
  };
}

function buildLifecycleTransition(now, lifecycle, lifecycleValidation, incident, boundary, operationalHealth, handoff) {
  const accepted = boundary.allowed && lifecycleValidation.valid;
  const pausedUntil = lifecycle.command === 'pause'
    ? lifecycle.schedule.pauseUntil || addMinutesIso(now, lifecycle.schedule.retryWindowMinutes)
    : lifecycle.mode === 'paused'
      ? lifecycle.schedule.pauseUntil
      : null;
  const retryDueAt = operationalHealth.retryAfterMs === null
    ? null
    : new Date((parseTimestampMs(now) || Date.now()) + operationalHealth.retryAfterMs).toISOString();
  const fallbackInspectionAt = addMinutesIso(now, lifecycle.schedule.cadenceMinutes) || now;
  const target = accepted
    ? lifecycle.command === 'disable'
      ? { enabled: false, mode: 'disabled', status: 'disabled', nextInspectionAt: null, pausedUntil: null }
      : lifecycle.command === 'pause'
        ? { enabled: true, mode: 'paused', status: 'paused', nextInspectionAt: pausedUntil, pausedUntil }
        : lifecycle.command === 'resume' || lifecycle.command === 'enable'
          ? { enabled: true, mode: 'active', status: 'active', nextInspectionAt: lifecycle.schedule.nextInspectionAt || now, pausedUntil: null }
          : lifecycle.command === 'schedule_retry'
            ? {
              enabled: lifecycle.mode === 'disabled' ? lifecycle.commandPolicy.allowAutoEnableOnRetry : true,
              mode: lifecycle.mode === 'disabled' && lifecycle.commandPolicy.allowAutoEnableOnRetry ? 'active' : lifecycle.mode,
              status: 'retry_scheduled',
              nextInspectionAt: retryDueAt || fallbackInspectionAt,
              pausedUntil: null
            }
            : lifecycle.command === 'handoff'
              ? { enabled: lifecycle.enabled, mode: lifecycle.mode, status: handoff.status === 'ready' ? 'handoff_ready' : 'handoff_pending', nextInspectionAt: lifecycle.schedule.nextInspectionAt || fallbackInspectionAt, pausedUntil: lifecycle.mode === 'paused' ? lifecycle.schedule.pauseUntil : null }
              : { enabled: lifecycle.enabled, mode: lifecycle.mode, status: incident.state, nextInspectionAt: lifecycle.schedule.nextInspectionAt || now, pausedUntil: lifecycle.mode === 'paused' ? lifecycle.schedule.pauseUntil : null }
    : {
      enabled: lifecycle.enabled,
      mode: lifecycle.mode,
      status: 'rejected',
      nextInspectionAt: lifecycle.schedule.nextInspectionAt,
      pausedUntil: lifecycle.mode === 'paused' ? lifecycle.schedule.pauseUntil : null
    };
  const schedulePatch = {
    cadenceMinutes: lifecycle.schedule.cadenceMinutes,
    retryWindowMinutes: lifecycle.schedule.retryWindowMinutes,
    maxQueuedRetries: lifecycle.schedule.maxQueuedRetries,
    queuedRetries: accepted && lifecycle.command === 'schedule_retry'
      ? Math.min(lifecycle.schedule.maxQueuedRetries, lifecycle.schedule.queuedRetries + 1)
      : lifecycle.schedule.queuedRetries,
    nextInspectionAt: target.nextInspectionAt,
    pauseUntil: target.pausedUntil,
    disabledReason: target.enabled ? null : lifecycle.schedule.disabledReason || 'operator_disabled'
  };
  const targetState = {
    enabled: target.enabled,
    mode: target.mode,
    status: target.status,
    nextInspectionAt: target.nextInspectionAt,
    pausedUntil: target.pausedUntil
  };

  return {
    schema: 'aios.panic-inspector.lifecycle-transition.v1',
    accepted,
    command: lifecycle.command,
    commandKey: proofId('lifecycle_command', {
      incidentId: incident.id,
      command: lifecycle.command,
      targetState,
      errors: lifecycleValidation.errors
    }),
    previousState: {
      enabled: lifecycle.enabled,
      mode: lifecycle.mode,
      status: incident.state,
      nextInspectionAt: lifecycle.schedule.nextInspectionAt,
      pausedUntil: lifecycle.mode === 'paused' ? lifecycle.schedule.pauseUntil : null
    },
    targetState,
    settingsPatch: {
      enabled: target.enabled,
      mode: target.mode,
      automation: lifecycle.automation,
      commandPolicy: lifecycle.commandPolicy,
      schedule: schedulePatch
    },
    schedulerDirective: {
      action: accepted
        ? lifecycle.command === 'disable'
          ? 'cancel_scheduled_inspections'
          : lifecycle.command === 'pause'
            ? 'hold_until_pause_expires'
            : lifecycle.command === 'schedule_retry'
              ? 'enqueue_retry'
              : lifecycle.command === 'handoff'
                ? 'prepare_handoff_dispatch'
                : 'upsert_inspection_schedule'
        : 'reject_command',
      dueAt: target.nextInspectionAt,
      retryAfterMs: lifecycle.command === 'schedule_retry' ? operationalHealth.retryAfterMs : null,
      route: lifecycle.command === 'handoff' ? handoff.route : 'audit-recovery/panic-inspector/lifecycle',
      policyEnvelope: {
        allowedCommands: lifecycle.commandPolicy.allowedCommands,
        disabledCommands: lifecycle.commandPolicy.disabledCommands,
        effectiveCommands: lifecycle.commandPolicy.effectiveCommands,
        blockedCommandReason: accepted ? null : lifecycle.commandPolicy.blockedCommandReason
      }
    },
    audit: {
      id: proofId('lifecycle_transition', { incidentId: incident.id, command: lifecycle.command, accepted, targetState, schedulePatch }),
      format: 'aios.panic-inspector.lifecycle-transition.v1',
      generatedAt: now,
      boundaryDecisionId: boundary.proof.id,
      incidentId: incident.id
    }
  };
}

function normalizeProviderContract(input, incident) {
  const rawProvider = input.provider && typeof input.provider === 'object'
    ? input.provider
    : input.serviceProvider && typeof input.serviceProvider === 'object'
      ? input.serviceProvider
      : {};
  const rawSync = rawProvider.sync && typeof rawProvider.sync === 'object'
    ? rawProvider.sync
    : input.sync && typeof input.sync === 'object'
      ? input.sync
      : {};
  const rawHandoff = rawProvider.handoff && typeof rawProvider.handoff === 'object'
    ? rawProvider.handoff
    : input.externalHandoff && typeof input.externalHandoff === 'object'
      ? input.externalHandoff
      : {};
  const rawService = rawProvider.service && typeof rawProvider.service === 'object'
    ? rawProvider.service
    : input.serviceContract && typeof input.serviceContract === 'object'
      ? input.serviceContract
      : {};
  const rawSchemas = Array.isArray(rawProvider.acceptedRecordSchemas)
    ? rawProvider.acceptedRecordSchemas
    : Array.isArray(rawSync.acceptedRecordSchemas)
      ? rawSync.acceptedRecordSchemas
      : Array.isArray(rawService.acceptedRecordSchemas)
        ? rawService.acceptedRecordSchemas
        : Object.values(PROVIDER_RECORD_SCHEMAS);
  const hasExplicitCapabilities = Array.isArray(rawProvider.capabilities) || Array.isArray(input.capabilities);
  const rawCapabilities = Array.isArray(rawProvider.capabilities)
    ? rawProvider.capabilities
    : Array.isArray(input.capabilities)
      ? input.capabilities
      : Object.values(PROVIDER_CAPABILITIES);
  const capabilities = [...new Set(rawCapabilities
    .filter((capability) => typeof capability === 'string' && capability.trim().length > 0)
    .map((capability) => capability.trim()))].sort();
  const endpoint = rawProvider.endpoint && typeof rawProvider.endpoint === 'object' ? rawProvider.endpoint : {};
  const lastSyncedAt = cleanToken(rawSync.lastSyncedAt || rawSync.observedAt || rawProvider.lastSyncedAt, null);
  const watermark = cleanToken(rawSync.watermark || rawSync.cursor || rawProvider.watermark, null);
  const replayToken = cleanToken(rawSync.replayToken || rawSync.replayCursor, null);
  const protocol = cleanToken(rawService.protocol || rawProvider.protocol, 'in_process').toLowerCase();
  const consistency = cleanToken(rawSync.consistency || rawService.consistency, 'read_after_write').toLowerCase();
  const maxBatchSize = Number.isInteger(rawSync.maxBatchSize) && rawSync.maxBatchSize > 0
    ? Math.min(rawSync.maxBatchSize, 500)
    : Number.isInteger(rawService.maxBatchSize) && rawService.maxBatchSize > 0
      ? Math.min(rawService.maxBatchSize, 500)
      : 100;
  const ackTimeoutMs = Number.isInteger(rawService.ackTimeoutMs) && rawService.ackTimeoutMs > 0
    ? Math.min(rawService.ackTimeoutMs, 120000)
    : 15000;

  return {
    id: cleanToken(rawProvider.id || rawProvider.name || input.providerId, 'hosted-kernel-provider'),
    kind: cleanToken(rawProvider.kind || rawProvider.type, 'hosted-kernel-service'),
    version: cleanToken(rawProvider.version || rawProvider.contractVersion, '1.0.0'),
    service: {
      schema: 'aios.panic-inspector.provider-service-contract.v1',
      protocol: PROVIDER_PROTOCOLS.has(protocol) ? protocol : 'in_process',
      requestedProtocol: protocol,
      contractSchema: cleanToken(rawService.contractSchema || rawProvider.contractSchema, 'aios.panic-inspector.provider.v1'),
      serviceLevel: cleanToken(rawService.serviceLevel || rawProvider.serviceLevel, 'hosted-kernel-local'),
      supportsIdempotency: rawService.supportsIdempotency !== false && rawProvider.supportsIdempotency !== false,
      supportsCompareAndSwap: rawService.supportsCompareAndSwap !== false,
      ackTimeoutMs,
      acceptedRecordSchemas: [...new Set(rawSchemas
        .filter((schema) => typeof schema === 'string' && schema.trim().length > 0)
        .map((schema) => schema.trim()))].sort()
    },
    endpoint: {
      route: cleanToken(endpoint.route || rawProvider.route, 'audit-recovery/panic-inspector/provider'),
      region: cleanToken(endpoint.region || rawProvider.region, 'local'),
      tenantScoped: endpoint.tenantScoped !== false,
      workspaceScoped: endpoint.workspaceScoped !== false
    },
    capabilities,
    capabilitySource: hasExplicitCapabilities ? 'provider_declared' : 'hosted_kernel_default',
    sync: {
      status: PROVIDER_SYNC_STATUSES.has(cleanToken(rawSync.status || rawProvider.syncStatus, 'unknown').toLowerCase())
        ? cleanToken(rawSync.status || rawProvider.syncStatus, 'unknown').toLowerCase()
        : 'unknown',
      lastSyncedAt,
      watermark,
      replayToken,
      incidentId: cleanToken(rawSync.incidentId, incident.id),
      dirty: rawSync.dirty === true || rawSync.status === 'dirty',
      acceptsDelta: rawSync.acceptsDelta !== false,
      pendingRecords: Number.isInteger(rawSync.pendingRecords) && rawSync.pendingRecords >= 0 ? rawSync.pendingRecords : 0,
      consistency: PROVIDER_CONSISTENCY_LEVELS.has(consistency) ? consistency : 'read_after_write',
      checkpointId: cleanToken(rawSync.checkpointId || rawSync.checkpoint, null),
      leaseToken: cleanToken(rawSync.leaseToken, null),
      leaseOwnerId: cleanToken(rawSync.leaseOwnerId, null),
      maxBatchSize
    },
    externalHandoff: {
      requested: rawHandoff.requested === true || rawHandoff.status === 'requested',
      status: cleanToken(rawHandoff.status, 'not_requested').toLowerCase(),
      target: cleanToken(rawHandoff.target || rawHandoff.system, null),
      ticketId: cleanToken(rawHandoff.ticketId || rawHandoff.externalId, null),
      route: cleanToken(rawHandoff.route, null),
      acknowledgedAt: cleanToken(rawHandoff.acknowledgedAt || rawHandoff.acceptedAt, null),
      payloadSchema: cleanToken(rawHandoff.payloadSchema, PROVIDER_RECORD_SCHEMAS.externalHandoff),
      dispatchStateToken: cleanToken(rawHandoff.dispatchStateToken || rawHandoff.stateToken, null),
      callbackRoute: cleanToken(rawHandoff.callbackRoute || rawHandoff.webhookRoute, null)
    }
  };
}

function negotiateProviderContract(provider, principal, incident, boundary, validation, operationalHealth, lifecycleControls, handoff, scopeGuard) {
  const provided = new Set(provider.capabilities);
  const required = new Set([PROVIDER_CAPABILITIES.inspect, PROVIDER_CAPABILITIES.syncStatus]);
  const warnings = [];
  const errors = [];

  if (validation.evidenceCount > 0) required.add(PROVIDER_CAPABILITIES.evidenceIngest);
  if (boundary.permissions.canRecover && operationalHealth.canSelfRecover) required.add(PROVIDER_CAPABILITIES.recover);
  if (handoff.status === 'ready' || lifecycleControls.command === 'handoff') required.add(PROVIDER_CAPABILITIES.auditExport);
  if (provider.externalHandoff.requested) required.add(PROVIDER_CAPABILITIES.externalHandoff);

  const accepted = [...required].filter((capability) => provided.has(capability)).sort();
  const missing = [...required].filter((capability) => !provided.has(capability)).sort();
  if (missing.length > 0) errors.push('provider_missing_required_capabilities');
  if (!provider.endpoint.tenantScoped || !provider.endpoint.workspaceScoped) errors.push('provider_endpoint_must_be_tenant_workspace_scoped');
  if (provider.sync.incidentId !== incident.id) errors.push('provider_sync_incident_mismatch');
  if (provider.sync.status === 'stale' || provider.sync.dirty) warnings.push('provider_sync_requires_refresh');
  if (provider.sync.pendingRecords > 0 && !provider.sync.acceptsDelta) warnings.push('provider_requires_full_sync_before_handoff');
  if (provider.externalHandoff.requested && !provider.externalHandoff.target) errors.push('external_handoff_requires_target');
  if (provider.externalHandoff.status === 'acknowledged' && !provider.externalHandoff.acknowledgedAt) warnings.push('external_handoff_ack_missing_timestamp');
  if (!boundary.allowed && provider.externalHandoff.requested) errors.push('external_handoff_blocked_by_boundary');
  if (!PROVIDER_PROTOCOLS.has(provider.service.requestedProtocol)) warnings.push('provider_protocol_defaulted_to_in_process');
  if (!provider.service.acceptedRecordSchemas.includes(PROVIDER_RECORD_SCHEMAS.incident)) errors.push('provider_missing_incident_record_schema');
  if (validation.evidenceCount > 0 && !provider.service.acceptedRecordSchemas.includes(PROVIDER_RECORD_SCHEMAS.evidence)) errors.push('provider_missing_evidence_record_schema');
  if ((handoff.status === 'ready' || lifecycleControls.command === 'handoff') && !provider.service.acceptedRecordSchemas.includes(PROVIDER_RECORD_SCHEMAS.summary)) {
    errors.push('provider_missing_summary_export_schema');
  }
  if (provider.externalHandoff.requested && provider.externalHandoff.payloadSchema !== PROVIDER_RECORD_SCHEMAS.externalHandoff) {
    errors.push('external_handoff_payload_schema_unsupported');
  }
  if (provider.sync.consistency === 'eventual' && lifecycleControls.command === 'handoff') warnings.push('handoff_sync_consistency_is_eventual');
  if (provider.sync.leaseToken && provider.sync.leaseOwnerId && provider.sync.leaseOwnerId !== principal.id) warnings.push('provider_sync_lease_owned_by_another_actor');
  if (!provider.service.supportsIdempotency && ['schedule_retry', 'handoff'].includes(lifecycleControls.command)) errors.push('provider_mutation_requires_idempotency');
  if (scopeGuard.valid === false) errors.push('provider_scope_envelope_mismatch');
  if (scopeGuard.evidencePolicy.redactedWorkspaceIds.length > 0 && provider.externalHandoff.requested) warnings.push('external_handoff_uses_redacted_effective_scope');
  if (scopeGuard.mutationPolicy.requiresOverrideForQuarantinedWorkspaces && ['schedule_retry', 'handoff'].includes(lifecycleControls.command)) {
    errors.push('mutation_outside_effective_scope');
  }

  const canSync = errors.length === 0
    && boundary.allowed
    && scopeGuard.valid
    && provided.has(PROVIDER_CAPABILITIES.syncStatus)
    && provider.sync.incidentId === incident.id;
  const externalHandoffReady = provider.externalHandoff.requested
    && errors.length === 0
    && handoff.status === 'ready'
    && provided.has(PROVIDER_CAPABILITIES.externalHandoff)
    && provided.has(PROVIDER_CAPABILITIES.auditExport);
  const capabilityMatrix = Object.entries(PROVIDER_CAPABILITIES).map(([name, capability]) => ({
    name,
    capability,
    required: required.has(capability),
    provided: provided.has(capability),
    accepted: required.has(capability) && provided.has(capability),
    missing: required.has(capability) && !provided.has(capability)
  }));
  const syncRecordSchemas = [
    PROVIDER_RECORD_SCHEMAS.incident,
    validation.evidenceCount > 0 ? PROVIDER_RECORD_SCHEMAS.evidence : null,
    lifecycleControls.transition.accepted ? PROVIDER_RECORD_SCHEMAS.lifecycle : null,
    handoff.status === 'ready' || lifecycleControls.command === 'handoff' ? PROVIDER_RECORD_SCHEMAS.summary : null
  ].filter(Boolean);
  const acceptedSyncSchemas = syncRecordSchemas
    .filter((schema) => provider.service.acceptedRecordSchemas.includes(schema))
    .sort();
  const syncBatchSize = provider.sync.acceptsDelta
    ? Math.min(provider.sync.maxBatchSize, Math.max(1, provider.sync.pendingRecords || acceptedSyncSchemas.length))
    : provider.sync.maxBatchSize;
  const syncDirectiveStatus = canSync
    ? provider.sync.dirty || provider.sync.status === 'stale'
      ? 'refresh_before_dispatch'
      : provider.sync.pendingRecords > 0
        ? 'flush_pending_records'
        : 'ready'
    : 'blocked';

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    schema: 'aios.panic-inspector.provider-negotiation.v1',
    requiredCapabilities: [...required].sort(),
    acceptedCapabilities: accepted,
    missingCapabilities: missing,
    capabilityMatrix,
    providerId: provider.id,
    actorId: principal.id,
    service: {
      providerId: provider.id,
      kind: provider.kind,
      version: provider.version,
      protocol: provider.service.protocol,
      route: provider.endpoint.route,
      contractSchema: provider.service.contractSchema,
      serviceLevel: provider.service.serviceLevel,
      idempotencyRequired: ['schedule_retry', 'handoff'].includes(lifecycleControls.command),
      idempotencySupported: provider.service.supportsIdempotency,
      compareAndSwapSupported: provider.service.supportsCompareAndSwap,
      ackTimeoutMs: provider.service.ackTimeoutMs,
      acceptedRecordSchemas: provider.service.acceptedRecordSchemas,
      scopeEnvelope: {
        schema: scopeGuard.schema,
        id: scopeGuard.audit.id,
        tenantId: scopeGuard.tenantId,
        workspaceId: scopeGuard.workspaceId,
        effectiveWorkspaceIds: scopeGuard.effectiveWorkspaceIds,
        quarantinedWorkspaceIds: scopeGuard.quarantinedWorkspaceIds,
        evidenceMode: scopeGuard.evidencePolicy.mode
      }
    },
    sync: {
      status: canSync ? (provider.sync.dirty ? 'refresh_required' : 'negotiated') : 'blocked',
      mode: provider.sync.acceptsDelta && provider.sync.watermark ? 'delta' : 'full',
      watermark: provider.sync.watermark,
      replayToken: provider.sync.replayToken,
      lastSyncedAt: provider.sync.lastSyncedAt,
      pendingRecords: provider.sync.pendingRecords,
      route: provider.endpoint.route,
      consistency: provider.sync.consistency,
      checkpointId: provider.sync.checkpointId,
      leaseToken: provider.sync.leaseToken,
      leaseOwnerId: provider.sync.leaseOwnerId,
      acceptedRecordSchemas: acceptedSyncSchemas,
      missingRecordSchemas: syncRecordSchemas.filter((schema) => !provider.service.acceptedRecordSchemas.includes(schema)).sort(),
      directive: {
        id: proofId('provider_sync_directive', {
          incidentId: incident.id,
          providerId: provider.id,
          mode: provider.sync.acceptsDelta && provider.sync.watermark ? 'delta' : 'full',
          schemas: acceptedSyncSchemas,
          watermark: provider.sync.watermark,
          effectiveWorkspaceIds: scopeGuard.effectiveWorkspaceIds
        }),
        status: syncDirectiveStatus,
        writeMode: provider.sync.acceptsDelta && provider.sync.watermark ? 'delta_append' : 'full_replace',
        maxBatchSize: syncBatchSize,
        requiresLease: lifecycleControls.command !== 'inspect' || provider.sync.pendingRecords > 0,
        requiresCompareAndSwap: provider.service.supportsCompareAndSwap && lifecycleControls.transition.accepted,
        tenantWorkspaceEnvelope: {
          guardId: scopeGuard.audit.id,
          tenantId: scopeGuard.tenantId,
          workspaceIds: scopeGuard.effectiveWorkspaceIds,
          redactedWorkspaceIds: scopeGuard.evidencePolicy.redactedWorkspaceIds,
          mutationReadOnly: scopeGuard.mutationPolicy.readOnly
        },
        nextWatermark: proofId('provider_watermark', {
          incidentId: incident.id,
          previous: provider.sync.watermark,
          lifecycleRevision: lifecycleControls.transition.audit.id,
          acceptedSyncSchemas,
          scopeGuardId: scopeGuard.audit.id
        })
      }
    },
    externalHandoff: {
      state: externalHandoffReady
        ? 'ready_to_dispatch'
        : provider.externalHandoff.requested
          ? 'waiting_for_contract'
          : 'not_requested',
      target: provider.externalHandoff.target,
      ticketId: provider.externalHandoff.ticketId,
      route: provider.externalHandoff.route || handoff.route,
      acknowledgedAt: provider.externalHandoff.acknowledgedAt,
      payloadSchema: provider.externalHandoff.payloadSchema,
      dispatchStateToken: provider.externalHandoff.dispatchStateToken,
      callbackRoute: provider.externalHandoff.callbackRoute,
      directive: {
        id: proofId('external_handoff_directive', {
          incidentId: incident.id,
          providerId: provider.id,
          target: provider.externalHandoff.target,
          ticketId: provider.externalHandoff.ticketId,
          ready: externalHandoffReady
        }),
        method: externalHandoffReady ? 'POST' : 'HOLD',
        bodySchema: provider.externalHandoff.payloadSchema,
        includeAuditHandoffId: handoff.id,
        requiresAcknowledgement: provider.externalHandoff.status !== 'acknowledged',
        stateToken: provider.externalHandoff.dispatchStateToken || proofId('external_handoff_state', {
          incidentId: incident.id,
          providerId: provider.id,
          handoffId: handoff.id
        })
      }
    }
  };
}

function buildLifecycleControls(now, lifecycle, lifecycleValidation, incident, boundary, operationalHealth, handoff) {
  const transition = buildLifecycleTransition(now, lifecycle, lifecycleValidation, incident, boundary, operationalHealth, handoff);
  const commandAccepted = boundary.allowed && lifecycleValidation.valid;
  const disabled = transition.targetState.enabled === false || transition.targetState.mode === 'disabled';
  const paused = transition.targetState.mode === 'paused';
  const retryScheduled = commandAccepted && lifecycle.command === 'schedule_retry' && operationalHealth.retryable;
  const commandRoutes = {
    inspect: 'audit-recovery/panic-inspector',
    enable: 'audit-recovery/panic-inspector/lifecycle/enable',
    disable: 'audit-recovery/panic-inspector/lifecycle/disable',
    pause: 'audit-recovery/panic-inspector/lifecycle/pause',
    resume: 'audit-recovery/panic-inspector/lifecycle/resume',
    schedule_retry: 'audit-recovery/panic-inspector/retry',
    handoff: handoff.route
  };
  const commandAvailability = [...LIFECYCLE_COMMANDS].sort().map((command) => {
    const policyAllowed = lifecycle.commandPolicy.allowedCommands.includes(command);
    const policyDisabled = lifecycle.commandPolicy.disabledCommands.includes(command);
    const permissionBlocked = ['enable', 'disable', 'pause', 'resume', 'schedule_retry'].includes(command) && !boundary.permissions.canRecover
      ? 'recovery_permission_required'
      : command === 'handoff' && !boundary.permissions.canHandoff
        ? 'audit_handoff_permission_required'
        : null;
    const stateBlocked = command === 'schedule_retry' && !operationalHealth.retryable
      ? 'incident_not_retryable'
      : command === 'resume' && lifecycle.mode !== 'paused'
        ? 'lifecycle_not_paused'
        : command === 'pause' && lifecycle.mode === 'disabled'
          ? 'lifecycle_disabled'
          : null;
    const blockedReason = !policyAllowed
      ? 'command_not_allowed_by_policy'
      : policyDisabled
        ? lifecycle.commandPolicy.blockedCommandReason || 'command_disabled_by_policy'
        : permissionBlocked || stateBlocked;

    return {
      command,
      enabled: blockedReason === null,
      route: commandRoutes[command],
      blockedReason
    };
  });
  const nextInspectionAt = transition.targetState.nextInspectionAt || (disabled
    ? null
    : paused
      ? lifecycle.schedule.pauseUntil
      : lifecycle.schedule.nextInspectionAt || now);
  const nextAction = disabled
      ? 'lifecycle_disabled'
      : !commandAccepted
        ? 'repair_lifecycle_settings'
        : retryScheduled
          ? 'retry_after_backoff'
          : lifecycle.command === 'enable'
            ? 'lifecycle_enabled'
          : lifecycle.command === 'disable'
            ? 'lifecycle_disabled'
          : lifecycle.command === 'pause'
            ? 'lifecycle_paused'
          : lifecycle.command === 'resume'
            ? 'lifecycle_resumed'
        : lifecycle.command === 'handoff'
          ? handoff.status === 'ready' ? 'export_audit_handoff' : 'prepare_audit_handoff'
          : operationalHealth.canSelfRecover && lifecycle.automation.autoRecover
            ? 'run_recovery_checkpoint'
            : operationalHealth.retryable
              ? 'schedule_retry'
              : 'continue_inspection';

  return {
    command: lifecycle.command,
    commandAccepted,
    enabled: !disabled,
    mode: disabled ? 'disabled' : paused ? 'paused' : 'active',
    automation: lifecycle.automation,
    commandPolicy: lifecycle.commandPolicy,
    commandAvailability,
    schedule: {
      cadenceMinutes: lifecycle.schedule.cadenceMinutes,
      retryWindowMinutes: lifecycle.schedule.retryWindowMinutes,
      maxQueuedRetries: lifecycle.schedule.maxQueuedRetries,
      queuedRetries: transition.settingsPatch.schedule.queuedRetries,
      nextInspectionAt,
      retryAfterMs: retryScheduled ? operationalHealth.retryAfterMs : null,
      pausedUntil: paused ? transition.targetState.pausedUntil : null,
      disabledReason: disabled ? lifecycle.schedule.disabledReason || 'operator_disabled' : null
    },
    nextAction: {
      state: nextAction,
      route: nextAction === 'export_audit_handoff'
        ? handoff.route
        : nextAction === 'repair_lifecycle_settings'
          ? 'audit-recovery/panic-inspector/lifecycle-settings'
          : nextAction === 'retry_after_backoff'
            ? 'audit-recovery/panic-inspector/retry'
          : ['lifecycle_enabled', 'lifecycle_disabled', 'lifecycle_paused', 'lifecycle_resumed'].includes(nextAction)
            ? transition.schedulerDirective.route
          : 'audit-recovery/panic-inspector/lifecycle',
      dueAt: retryScheduled ? now : nextInspectionAt,
      incidentId: incident.id,
      commandKey: transition.commandKey,
      blockedReason: commandAccepted ? null : lifecycleValidation.errors[0] || lifecycle.commandPolicy.blockedCommandReason
    },
    transition,
    validation: lifecycleValidation
  };
}

function buildOperationalHealth(now, principal, incident, boundary, health, validation) {
  const failureSeverity = SEVERITY_RANK[incident.severity] || 0;
  const failureState = FAILURE_STATES.has(incident.state);
  const errorRunbook = buildActionableErrorRunbook(incident, boundary, health, validation);
  const degradation = buildOperationalDegradationContract(now, incident, boundary, health, validation, errorRunbook);
  const degraded = degradation.status === 'degraded'
    || health.status === 'degraded'
    || incident.state === 'degraded'
    || validation.errors.length > 0
    || (failureState && validation.trustedEvidenceCount === 0)
    || errorRunbook.degradedModeReason !== null;
  const retryable = RETRYABLE_STATES.has(incident.state)
    && boundary.allowed
    && validation.valid
    && degradation.telemetry.stale === false
    && degradation.counters.staleFailures === 0
    && !health.retry.exhausted
    && errorRunbook.retryPolicy.allowed;
  const actions = [];

  if (!boundary.allowed) actions.push('resolve_boundary_violations_before_inspection');
  if (degradation.telemetry.stale) actions.push('refresh_hosted_kernel_health_signal');
  if (degradation.counters.staleFailures > 0) actions.push('refresh_stale_failure_observations');
  if (validation.errors.includes('failure_state_requires_evidence')) actions.push('attach_runtime_or_audit_evidence');
  if (validation.errors.includes('blocked_state_requires_failure_signal')) actions.push('record_blocking_failure_signal');
  if (validation.errors.includes('no_trusted_workspace_evidence')) actions.push('replace_cross_scope_evidence_with_workspace_scoped_evidence');
  if (health.retry.exhausted) actions.push('escalate_to_audit_handoff_without_retry');
  if (retryable) actions.push('retry_panic_inspection_after_backoff');
  if (boundary.permissions.canRecover && failureSeverity >= SEVERITY_RANK.high) actions.push('prepare_recovery_checkpoint');
  if (actions.length === 0) actions.push(degraded ? 'hold_in_degraded_review' : 'continue_audit_handoff');

  return {
    status: degraded ? 'degraded' : 'healthy',
    failureState,
    retryable,
    retryAfterMs: retryable ? health.retry.nextDelayMs : null,
    degradedModeReason: degradation.recoveryMode === 'normal' ? errorRunbook.degradedModeReason : degradation.recoveryMode,
    mode: degraded ? 'read_only_degraded_inspection' : 'active_inspection',
    canSelfRecover: boundary.permissions.canRecover && boundary.allowed && validation.valid,
    actionableErrors: [...boundary.violations, ...validation.errors],
    errorRunbook,
    degradation,
    failureSummary: {
      source: health.source,
      status: health.status,
      observedAt: health.observedAt,
      stale: degradation.telemetry.stale,
      highestSeverity: errorRunbook.highestSeverity,
      totalFailures: health.failures.length,
      staleFailures: degradation.counters.staleFailures,
      retryableFailures: errorRunbook.counts.retryableFailures,
      nonRetryableFailures: errorRunbook.counts.nonRetryableFailures
    },
    retryPlan: {
      allowed: retryable,
      attempts: health.retry.attempts,
      maxAttempts: health.retry.maxAttempts,
      nextDelayMs: retryable ? health.retry.nextDelayMs : null,
      blockedReason: retryable
        ? null
        : !boundary.allowed
          ? 'boundary_not_authorized'
          : degradation.telemetry.stale
            ? 'health_signal_stale'
            : degradation.counters.staleFailures > 0
              ? 'failure_signal_stale'
              : !validation.valid
            ? 'incident_validation_failed'
            : health.retry.exhausted
              ? 'retry_budget_exhausted'
              : errorRunbook.counts.nonRetryableFailures > 0
                ? 'non_retryable_failure_present'
                : !RETRYABLE_STATES.has(incident.state)
                  ? 'incident_state_not_retryable'
                  : null
    },
    actions,
    observedFailures: health.failures
  };
}

function hasPermission(principal, permission) {
  return principal.permissions.includes(permission);
}

function decideBoundary(principal, incident, workspaceAccess) {
  const sameTenant = principal.tenantId === incident.tenantId;
  const sameWorkspace = principal.workspaceId === incident.workspaceId;
  const canOverrideTenant = hasPermission(principal, 'tenant.override');
  const canInspect = hasPermission(principal, 'panic.inspect') || hasPermission(principal, 'panic.inspect.read');
  const canRecover = hasPermission(principal, 'panic.recover');
  const canHandoff = hasPermission(principal, 'audit.handoff');
  const canReadHandoff = hasPermission(principal, 'audit.handoff.read') || canHandoff;
  const workspaceGranted = workspaceAccess.incidentWorkspaceGranted || sameWorkspace || canOverrideTenant;
  const workspaceDenied = workspaceAccess.deniedIncidentWorkspace && !canOverrideTenant;
  const crossWorkspaceEvidenceBlocked = workspaceAccess.crossWorkspaceEvidenceIds.length > 0
    && !workspaceAccess.crossWorkspaceEvidenceAllowed;
  const violations = [];

  if (!sameTenant && !canOverrideTenant) violations.push('tenant_mismatch');
  if (!sameWorkspace && !workspaceGranted) violations.push('workspace_mismatch');
  if (!workspaceGranted) violations.push('workspace_not_granted');
  if (workspaceDenied) violations.push('workspace_explicitly_denied');
  if (incident.scope.requiresTenantOverride && !canOverrideTenant) violations.push('tenant_override_required_by_incident_scope');
  if (crossWorkspaceEvidenceBlocked) violations.push('cross_workspace_evidence_requires_override');
  if (!canInspect) violations.push('missing_panic_inspect_permission');
  if (TERMINAL_STATES.has(incident.state) && !canRecover) violations.push('terminal_state_requires_recovery_permission');

  const allowed = violations.length === 0;
  const decision = allowed
    ? 'scope_authorized'
    : sameTenant && canInspect
      ? 'scope_retained_for_review'
      : 'scope_rejected';
  return {
    allowed,
    decision,
    scope: {
      tenantId: incident.tenantId,
      workspaceId: incident.workspaceId,
      actorTenantId: principal.tenantId,
      actorWorkspaceId: principal.workspaceId,
      tenantIsolated: sameTenant || canOverrideTenant,
      workspaceIsolated: workspaceGranted && !workspaceDenied,
      workspaceGranted,
      workspaceDenied,
      crossWorkspaceEvidenceAllowed: workspaceAccess.crossWorkspaceEvidenceAllowed,
      crossWorkspaceEvidenceIds: workspaceAccess.crossWorkspaceEvidenceIds,
      boundaryLabel: workspaceAccess.boundaryLabel
    },
    permissions: {
      canInspect,
      canRecover,
      canHandoff,
      canReadHandoff,
      canOverrideTenant
    },
    accessPolicy: {
      schema: workspaceAccess.schema,
      mode: workspaceAccess.mode,
      allowedWorkspaceIds: workspaceAccess.allowedWorkspaceIds,
      deniedWorkspaceIds: workspaceAccess.deniedWorkspaceIds,
      relatedWorkspaceIds: workspaceAccess.relatedWorkspaceIds,
      auditRoute: workspaceAccess.auditRoute
    },
    violations,
    proof: {
      id: proofId('boundary_decision', {
        actor: principal.id,
        incident: incident.id,
        decision,
        violations,
        workspaceAccess
      }),
      format: 'aios.panic-inspector.boundary-decision.v1',
      decision,
      enforceReadOnly: !allowed || !canRecover,
      handoffReadable: canReadHandoff && sameTenant && !workspaceDenied
    }
  };
}

function buildEffectiveScopeGuard(now, principal, incident, workspaceAccess, boundary) {
  const denied = new Set(workspaceAccess.deniedWorkspaceIds);
  const granted = new Set(workspaceAccess.allowedWorkspaceIds.filter((workspaceId) => !denied.has(workspaceId)));
  const evidenceWorkspaceIds = [...new Set(incident.evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => cleanToken(entry.workspaceId, incident.workspaceId)))].sort();
  const requestedWorkspaceIds = [...new Set([
    incident.workspaceId,
    ...workspaceAccess.relatedWorkspaceIds,
    ...evidenceWorkspaceIds
  ])].sort();
  const effectiveWorkspaceIds = requestedWorkspaceIds
    .filter((workspaceId) => workspaceId === incident.workspaceId || granted.has(workspaceId) || boundary.permissions.canOverrideTenant)
    .filter((workspaceId) => !denied.has(workspaceId) || boundary.permissions.canOverrideTenant)
    .sort();
  const quarantinedWorkspaceIds = requestedWorkspaceIds
    .filter((workspaceId) => !effectiveWorkspaceIds.includes(workspaceId))
    .sort();
  const allowedEvidenceWorkspaceIds = new Set([
    incident.workspaceId,
    ...(workspaceAccess.crossWorkspaceEvidenceAllowed ? effectiveWorkspaceIds : [])
  ]);
  const redactedEvidenceWorkspaceIds = evidenceWorkspaceIds
    .filter((workspaceId) => !allowedEvidenceWorkspaceIds.has(workspaceId))
    .sort();
  const relatedWorkspaceGaps = workspaceAccess.relatedWorkspaceIds
    .filter((workspaceId) => !effectiveWorkspaceIds.includes(workspaceId))
    .sort();
  const guardViolations = [
    !effectiveWorkspaceIds.includes(incident.workspaceId) ? 'workspace_not_granted' : null,
    denied.has(incident.workspaceId) && !boundary.permissions.canOverrideTenant ? 'workspace_explicitly_denied' : null
  ].filter(Boolean);
  const guardWarnings = [
    ...relatedWorkspaceGaps.map(() => 'related_workspace_not_effective'),
    redactedEvidenceWorkspaceIds.length > 0 ? 'evidence_redacted_by_effective_scope' : null
  ].filter(Boolean);

  return {
    schema: 'aios.panic-inspector.effective-scope.v1',
    generatedAt: now,
    tenantId: incident.tenantId,
    actorTenantId: principal.tenantId,
    workspaceId: incident.workspaceId,
    actorWorkspaceId: principal.workspaceId,
    boundaryDecisionId: boundary.proof.id,
    effectiveTenantMode: boundary.scope.tenantIsolated ? 'tenant_isolated' : 'tenant_review',
    effectiveWorkspaceMode: quarantinedWorkspaceIds.length > 0 ? 'partial_workspace_scope' : 'incident_workspace_scope',
    effectiveWorkspaceIds,
    requestedWorkspaceIds,
    quarantinedWorkspaceIds,
    relatedWorkspaceGaps,
    evidencePolicy: {
      mode: workspaceAccess.crossWorkspaceEvidenceAllowed ? 'cross_workspace_with_scope_guard' : 'incident_workspace_only',
      allowedWorkspaceIds: [...allowedEvidenceWorkspaceIds].sort(),
      redactedWorkspaceIds: redactedEvidenceWorkspaceIds,
      redactCrossTenant: true,
      redactDeniedWorkspace: true
    },
    mutationPolicy: {
      readOnly: boundary.proof.enforceReadOnly,
      canMutateIncidentWorkspace: boundary.allowed && !denied.has(incident.workspaceId),
      requiresOverrideForQuarantinedWorkspaces: quarantinedWorkspaceIds.length > 0
    },
    audit: {
      id: proofId('effective_scope_guard', {
        actor: principal.id,
        incident: incident.id,
        effectiveWorkspaceIds,
        quarantinedWorkspaceIds,
        redactedEvidenceWorkspaceIds
      }),
      format: 'aios.panic-inspector.effective-scope.v1',
      route: quarantinedWorkspaceIds.length > 0
        ? 'audit-recovery/panic-inspector/workspace-access'
        : 'audit-recovery/panic-inspector/boundary-review'
    },
    valid: guardViolations.length === 0,
    violations: [...new Set(guardViolations)].sort(),
    warnings: [...new Set(guardWarnings)].sort()
  };
}

function buildAuditHandoff(now, principal, incident, boundary, scopeGuard = null) {
  const allowedEvidenceWorkspaceIds = new Set(scopeGuard?.evidencePolicy?.allowedWorkspaceIds || [incident.workspaceId]);
  const acceptedEvidence = incident.evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const tenantId = cleanToken(entry.tenantId, incident.tenantId);
      const workspaceId = cleanToken(entry.workspaceId, incident.workspaceId);
      const sameEvidenceTenant = tenantId === incident.tenantId;
      const sameEvidenceWorkspace = workspaceId === incident.workspaceId;
      const crossWorkspace = sameEvidenceTenant && !sameEvidenceWorkspace;
      const workspaceAllowed = allowedEvidenceWorkspaceIds.has(workspaceId);
      const visible = sameEvidenceTenant && (sameEvidenceWorkspace || (crossWorkspace && boundary.scope.crossWorkspaceEvidenceAllowed && workspaceAllowed));
      const evidenceId = cleanToken(entry.id, proofId('evidence', { incidentId: incident.id, index, entry }));

      return {
        id: evidenceId,
        kind: visible ? cleanToken(entry.kind || entry.type, 'runtime') : 'redacted_cross_workspace',
        tenantId: visible ? tenantId : incident.tenantId,
        workspaceId: visible ? workspaceId : incident.workspaceId,
        trusted: sameEvidenceTenant && sameEvidenceWorkspace,
        visible,
        redacted: !visible,
        sourceScope: {
          tenantMatches: sameEvidenceTenant,
          workspaceMatches: sameEvidenceWorkspace,
          crossWorkspace,
          workspaceAllowedByEffectiveScope: workspaceAllowed
        },
        redactionReason: visible
          ? null
          : !sameEvidenceTenant
            ? 'cross_tenant_evidence_not_authorized'
            : crossWorkspace && !workspaceAllowed
              ? 'workspace_not_in_effective_scope'
              : 'cross_workspace_evidence_not_authorized'
      };
    });
  const visibleEvidence = acceptedEvidence.filter((entry) => entry.visible);
  const redactedEvidence = acceptedEvidence.filter((entry) => entry.redacted);

  const handoffId = proofId('audit_handoff', {
    surfaceId,
    actor: principal.id,
    incident: incident.id,
    boundary,
    evidence: visibleEvidence,
    redactedEvidenceCount: redactedEvidence.length
  });

  return {
    id: handoffId,
    generatedAt: now,
    status: boundary.allowed && boundary.permissions.canHandoff ? 'ready' : 'retained_for_review',
    route: boundary.allowed ? 'audit-recovery/panic-inspector/handoff' : 'audit-recovery/panic-inspector/boundary-review',
    actor: {
      id: principal.id,
      role: principal.role,
      permissions: principal.permissions
    },
    incident: {
      id: incident.id,
      state: incident.state,
      severity: incident.severity,
      reason: incident.reason
    },
    evidence: visibleEvidence,
    redactedEvidence,
    evidencePolicy: {
      schema: 'aios.panic-inspector.audit-evidence-boundary.v1',
      visibleCount: visibleEvidence.length,
      redactedCount: redactedEvidence.length,
      crossWorkspaceEvidenceAllowed: boundary.scope.crossWorkspaceEvidenceAllowed,
      boundaryDecisionId: boundary.proof.id,
      effectiveScopeGuardId: scopeGuard?.audit?.id || null,
      allowedWorkspaceIds: scopeGuard?.evidencePolicy?.allowedWorkspaceIds || [incident.workspaceId],
      redactedWorkspaceIds: scopeGuard?.evidencePolicy?.redactedWorkspaceIds || []
    },
    rejectedEvidenceCount: redactedEvidence.length
  };
}

function normalizeHistorySnapshots(input, now, incident) {
  const rawHistory = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : [];

  return rawHistory
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .slice(-12)
    .map((snapshot, index) => {
      const state = cleanToken(snapshot.state, incident.state).toLowerCase();
      const severity = cleanToken(snapshot.severity, incident.severity).toLowerCase();
      const validationErrors = Array.isArray(snapshot.validationErrors)
        ? snapshot.validationErrors.filter((error) => typeof error === 'string' && error.length > 0)
        : [];
      const boundaryViolations = Array.isArray(snapshot.boundaryViolations)
        ? snapshot.boundaryViolations.filter((violation) => typeof violation === 'string' && violation.length > 0)
        : [];

      return {
        id: cleanToken(snapshot.id, proofId('history_snapshot', { incidentId: incident.id, index, snapshot })),
        observedAt: cleanToken(snapshot.observedAt || snapshot.generatedAt || snapshot.at, now),
        state,
        severity,
        decision: cleanToken(snapshot.decision, validationErrors.length > 0 || boundaryViolations.length > 0 ? 'inspect_blocked' : 'inspect_allowed'),
        retryable: snapshot.retryable === true,
        evidenceCount: Number.isInteger(snapshot.evidenceCount) && snapshot.evidenceCount >= 0 ? snapshot.evidenceCount : 0,
        trustedEvidenceCount: Number.isInteger(snapshot.trustedEvidenceCount) && snapshot.trustedEvidenceCount >= 0 ? snapshot.trustedEvidenceCount : 0,
        validationErrors,
        boundaryViolations
      };
    });
}

function buildCurrentSnapshot(now, incident, validation, boundary, operationalHealth, handoff, lifecycleValidation) {
  const lifecycleErrors = lifecycleValidation?.errors || [];
  const lifecycleValid = lifecycleValidation?.valid !== false;
  const decision = boundary.allowed && validation.valid && lifecycleValid ? 'inspect_allowed' : 'inspect_blocked';

  return {
    id: proofId('history_snapshot', {
      incidentId: incident.id,
      generatedAt: now,
      decision,
      handoffStatus: handoff.status
    }),
    observedAt: now,
    state: incident.state,
    severity: incident.severity,
    decision,
    retryable: operationalHealth.retryable,
    evidenceCount: validation.evidenceCount,
    trustedEvidenceCount: validation.trustedEvidenceCount,
    validationErrors: [...validation.errors, ...lifecycleErrors],
    boundaryViolations: boundary.violations
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = cleanToken(item[key], 'unknown');
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function normalizeAnalyticsExportRequest(input, principal, incident) {
  const rawExport = input.export && typeof input.export === 'object'
    ? input.export
    : input.exportRequest && typeof input.exportRequest === 'object'
      ? input.exportRequest
      : input.reporting && typeof input.reporting === 'object'
        ? input.reporting
        : {};
  const requestedFormat = cleanToken(rawExport.format, 'json').toLowerCase();
  const requestedScope = cleanToken(rawExport.scope, 'summary').toLowerCase();
  const requestedDelivery = cleanToken(rawExport.delivery || rawExport.channel, 'inline').toLowerCase();
  const includeProofs = rawExport.includeProofs !== false;
  const includeTimeline = rawExport.includeTimeline === true || requestedScope === 'timeline' || requestedScope === 'full';
  const includeHistory = rawExport.includeHistory === true || requestedScope === 'history' || requestedScope === 'full';
  const redactionMode = cleanToken(rawExport.redactionMode, principal.permissions.includes('tenant.override') ? 'boundary_aware' : 'workspace_only');

  return {
    schema: 'aios.panic-inspector.analytics-export-request.v1',
    requestedAt: cleanToken(rawExport.requestedAt, null),
    requestedBy: cleanToken(rawExport.requestedBy || rawExport.actorId, principal.id),
    format: EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : 'json',
    requestedFormat,
    scope: EXPORT_SCOPES.has(requestedScope) ? requestedScope : 'summary',
    requestedScope,
    delivery: EXPORT_DELIVERY_CHANNELS.has(requestedDelivery) ? requestedDelivery : 'inline',
    requestedDelivery,
    includeProofs,
    includeTimeline,
    includeHistory,
    redactionMode,
    destination: cleanToken(rawExport.destination || rawExport.target, null),
    correlationId: cleanToken(rawExport.correlationId, null),
    subject: {
      tenantId: incident.tenantId,
      workspaceId: incident.workspaceId,
      incidentId: incident.id
    }
  };
}

function buildSnapshotTransitions(snapshots) {
  return snapshots.slice(1).map((snapshot, index) => {
    const previous = snapshots[index];
    const stateChanged = previous.state !== snapshot.state;
    const decisionChanged = previous.decision !== snapshot.decision;
    const severityDelta = (SEVERITY_RANK[snapshot.severity] || 0) - (SEVERITY_RANK[previous.severity] || 0);

    return {
      id: proofId('history_transition', {
        previous: previous.id,
        current: snapshot.id,
        state: snapshot.state,
        decision: snapshot.decision,
        severity: snapshot.severity
      }),
      fromSnapshotId: previous.id,
      toSnapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      fromState: previous.state,
      toState: snapshot.state,
      fromDecision: previous.decision,
      toDecision: snapshot.decision,
      stateChanged,
      decisionChanged,
      severityDelta,
      newlyBlocked: previous.decision === 'inspect_allowed' && snapshot.decision !== 'inspect_allowed',
      newlyCleared: previous.decision !== 'inspect_allowed' && snapshot.decision === 'inspect_allowed'
    };
  });
}

function countBlockerCodes(snapshots) {
  return snapshots.reduce((counts, snapshot) => {
    [...snapshot.validationErrors, ...snapshot.boundaryViolations].forEach((code) => {
      counts[code] = (counts[code] || 0) + 1;
    });
    return counts;
  }, {});
}

function buildExportReadyAnalyticsPackage({
  now,
  incident,
  exportRequest,
  analytics,
  history,
  timeline,
  proofs,
  providerNegotiation,
  lifecycleControls,
  operationalHealth,
  blockerCounts
}) {
  const requestedSections = {
    summary: true,
    proofs: exportRequest.includeProofs,
    history: exportRequest.includeHistory,
    timeline: exportRequest.includeTimeline,
    providerSync: exportRequest.delivery === 'provider_sync',
    externalHandoff: exportRequest.delivery === 'external_handoff'
  };
  const selectedProofs = exportRequest.includeProofs
    ? proofs.map((proof) => ({
      id: proof.id,
      type: cleanToken(proof.type, 'unknown_proof'),
      passed: proof.passed === true,
      route: cleanToken(proof.route, null)
    }))
    : [];
  const historyRows = exportRequest.includeHistory
    ? history.snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      state: snapshot.state,
      severity: snapshot.severity,
      decision: snapshot.decision,
      retryable: snapshot.retryable,
      evidenceCount: snapshot.evidenceCount,
      trustedEvidenceCount: snapshot.trustedEvidenceCount,
      blockerCount: snapshot.validationErrors.length + snapshot.boundaryViolations.length
    }))
    : [];
  const timelineRows = exportRequest.includeTimeline
    ? timeline.events.map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      type: event.type,
      state: event.state,
      severity: event.severity,
      decision: event.decision,
      blocked: event.blocked === true
    }))
    : [];
  const summaryRecord = {
    schema: PROVIDER_RECORD_SCHEMAS.summary,
    generatedAt: now,
    incidentId: incident.id,
    status: timeline.reportStatus,
    exportBlocked: timeline.exportBlocked,
    nextAction: {
      state: timeline.nextActionState,
      dueAt: timeline.nextActionAt,
      route: lifecycleControls.nextAction.route
    },
    counters: {
      snapshots: analytics.snapshotCount,
      blockedSnapshots: analytics.blockedCount,
      retryableSnapshots: analytics.retryableCount,
      proofsPassed: selectedProofs.filter((proof) => proof.passed).length,
      proofsFailed: selectedProofs.filter((proof) => !proof.passed).length,
      blockers: Object.values(blockerCounts).reduce((total, count) => total + count, 0),
      providerErrors: providerNegotiation.errors.length,
      providerWarnings: providerNegotiation.warnings.length,
      retryAfterMs: operationalHealth.retryAfterMs
    }
  };
  const records = [
    { kind: 'summary', schema: PROVIDER_RECORD_SCHEMAS.summary, body: summaryRecord },
    ...historyRows.map((row) => ({ kind: 'history_snapshot', schema: 'aios.panic-inspector.history-row.v1', body: row })),
    ...timelineRows.map((row) => ({ kind: 'timeline_event', schema: 'aios.panic-inspector.timeline-row.v1', body: row })),
    ...selectedProofs.map((proof) => ({ kind: 'proof', schema: 'aios.panic-inspector.proof-row.v1', body: proof }))
  ];
  const redaction = {
    mode: exportRequest.redactionMode,
    tenantId: incident.tenantId,
    workspaceId: incident.workspaceId,
    redactsEvidenceBodies: true,
    redactsCrossWorkspaceRows: exportRequest.redactionMode === 'workspace_only'
  };
  const delivery = {
    channel: exportRequest.delivery,
    destination: exportRequest.destination,
    correlationId: exportRequest.correlationId,
    contentType: exportRequest.format === 'csv'
      ? 'text/csv'
      : exportRequest.format === 'ndjson'
        ? 'application/x-ndjson'
        : 'application/json',
    providerRoute: exportRequest.delivery === 'provider_sync' ? providerNegotiation.sync.route : null,
    externalRoute: exportRequest.delivery === 'external_handoff' ? providerNegotiation.externalHandoff.route : null,
    writeMode: exportRequest.format === 'ndjson' ? 'append_records' : 'replace_report'
  };

  return {
    schema: 'aios.panic-inspector.analytics-export-package.v1',
    generatedAt: now,
    format: exportRequest.format,
    scope: exportRequest.scope,
    sections: requestedSections,
    redaction,
    delivery,
    records,
    recordSummary: {
      total: records.length,
      summary: 1,
      history: historyRows.length,
      timeline: timelineRows.length,
      proofs: selectedProofs.length
    },
    integrity: {
      id: proofId('analytics_export_package', {
        incidentId: incident.id,
        format: exportRequest.format,
        scope: exportRequest.scope,
        records: records.map((record) => ({ kind: record.kind, schema: record.schema, body: record.body }))
      }),
      generatedFrom: {
        firstObservedAt: timeline.firstObservedAt,
        currentObservedAt: timeline.currentObservedAt,
        providerSyncStatus: providerNegotiation.sync.status,
        lifecycleCommandKey: lifecycleControls.transition.commandKey
      }
    }
  };
}

function buildAnalyticsAndReporting(now, incident, validation, boundary, operationalHealth, handoff, proofs, historicalSnapshots, lifecycleControls, providerNegotiation, exportRequest) {
  const currentSnapshot = buildCurrentSnapshot(now, incident, validation, boundary, operationalHealth, handoff, lifecycleControls.validation);
  const snapshots = [...historicalSnapshots, currentSnapshot];
  const transitions = buildSnapshotTransitions(snapshots);
  const blockedSnapshots = snapshots.filter((snapshot) => snapshot.decision !== 'inspect_allowed');
  const retryableSnapshots = snapshots.filter((snapshot) => snapshot.retryable);
  const trustedEvidenceTotal = snapshots.reduce((total, snapshot) => total + snapshot.trustedEvidenceCount, 0);
  const evidenceTotal = snapshots.reduce((total, snapshot) => total + snapshot.evidenceCount, 0);
  const blockerCounts = countBlockerCodes(snapshots);
  const transitionCounters = transitions.reduce((counts, transition) => {
    if (transition.stateChanged) counts.stateChanges += 1;
    if (transition.decisionChanged) counts.decisionChanges += 1;
    if (transition.newlyBlocked) counts.newlyBlocked += 1;
    if (transition.newlyCleared) counts.newlyCleared += 1;
    if (transition.severityDelta > 0) counts.severityEscalations += 1;
    if (transition.severityDelta < 0) counts.severityDeescalations += 1;
    return counts;
  }, {
    stateChanges: 0,
    decisionChanges: 0,
    newlyBlocked: 0,
    newlyCleared: 0,
    severityEscalations: 0,
    severityDeescalations: 0
  });
  const currentSeverityRank = SEVERITY_RANK[incident.severity] || 0;
  const highestSeverity = snapshots.reduce((highest, snapshot) => {
    const rank = SEVERITY_RANK[snapshot.severity] || 0;
    return rank > highest.rank ? { severity: snapshot.severity, rank } : highest;
  }, { severity: 'unknown', rank: 0 }).severity;
  const proofCounters = proofs.reduce((counts, proof) => {
    counts.total += 1;
    counts[proof.passed ? 'passed' : 'failed'] += 1;
    return counts;
  }, { total: 0, passed: 0, failed: 0 });
  const firstObservedAt = snapshots[0]?.observedAt || now;
  const latestBlockedAt = [...blockedSnapshots].reverse()[0]?.observedAt || null;
  const exportBlocked = exportRequest.delivery === 'provider_sync' && providerNegotiation.sync.status === 'blocked'
    ? 'provider_sync_blocked'
    : exportRequest.delivery === 'external_handoff' && providerNegotiation.externalHandoff.state !== 'ready_to_dispatch'
      ? 'external_handoff_not_ready'
      : exportRequest.includeTimeline && snapshots.length === 0
        ? 'timeline_empty'
        : null;
  const reportStatus = boundary.allowed && validation.valid && lifecycleControls.validation.valid
    ? operationalHealth.retryable
      ? lifecycleControls.nextAction.state === 'retry_after_backoff' ? 'retry_scheduled' : 'retry_available'
      : providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
        ? 'external_handoff_ready'
        : handoff.status === 'ready'
        ? 'handoff_export_ready'
        : 'inspection_export_ready'
    : 'blocked_report_ready';
  const analytics = {
    incidentId: incident.id,
    snapshotCount: snapshots.length,
    blockedCount: blockedSnapshots.length,
    retryableCount: retryableSnapshots.length,
    proofPassRate: proofCounters.total === 0 ? 0 : Number((proofCounters.passed / proofCounters.total).toFixed(3)),
    trustedEvidenceRatio: evidenceTotal === 0 ? 0 : Number((trustedEvidenceTotal / evidenceTotal).toFixed(3)),
    stateCounts: countBy(snapshots, 'state'),
    severityCounts: countBy(snapshots, 'severity'),
    decisionCounts: countBy(snapshots, 'decision'),
    blockerCounts,
    transitionCounters,
    currentSeverityRank,
    highestSeverity
  };
  const history = {
    retention: {
      maxSnapshots: 13,
      receivedSnapshots: historicalSnapshots.length,
      includesCurrentInspection: true
    },
    snapshots,
    transitions
  };
  const timelineEvents = [
    ...snapshots.map((snapshot) => ({
      at: snapshot.observedAt,
      type: snapshot.id === currentSnapshot.id ? 'current_inspection' : 'history_snapshot',
      state: snapshot.state,
      severity: snapshot.severity,
      decision: snapshot.decision,
      blocked: snapshot.decision !== 'inspect_allowed'
    })),
    {
      at: lifecycleControls.nextAction.dueAt || now,
      type: 'lifecycle_next_action',
      state: incident.state,
      severity: incident.severity,
      decision: lifecycleControls.nextAction.state,
      blocked: !lifecycleControls.commandAccepted
    },
    {
      at: providerNegotiation.sync.lastSyncedAt || now,
      type: 'provider_sync_contract',
      state: providerNegotiation.sync.status,
      severity: incident.severity,
      decision: providerNegotiation.valid ? 'provider_contract_accepted' : 'provider_contract_blocked',
      blocked: !providerNegotiation.valid
    }
  ];
  const timeline = {
    firstObservedAt,
    currentObservedAt: now,
    latestBlockedAt,
    reportStatus,
    exportBlocked,
    nextActionAt: lifecycleControls.nextAction.dueAt,
    nextActionState: lifecycleControls.nextAction.state,
    events: timelineEvents
  };
  const exportPackage = buildExportReadyAnalyticsPackage({
    now,
    incident,
    exportRequest,
    analytics,
    history,
    timeline,
    proofs,
    providerNegotiation,
    lifecycleControls,
    operationalHealth,
    blockerCounts
  });

  return {
    analytics,
    history,
    timeline,
    exportPackage,
    exportSummary: {
      id: proofId('panic_export', { incidentId: incident.id, generatedAt: now, analytics: proofCounters, reportStatus, exportRequest }),
      format: 'aios.panic-inspector.summary.v1',
      generatedAt: now,
      route: reportStatus === 'external_handoff_ready'
        ? providerNegotiation.externalHandoff.route
        : reportStatus === 'handoff_export_ready' ? handoff.route : 'audit-recovery/panic-inspector/report',
      status: exportBlocked ? 'export_blocked' : reportStatus,
      request: exportRequest,
      subject: {
        tenantId: incident.tenantId,
        workspaceId: incident.workspaceId,
        incidentId: incident.id
      },
      manifest: {
        schema: 'aios.panic-inspector.analytics-export-manifest.v1',
        exportId: proofId('panic_export_manifest', {
          incidentId: incident.id,
          exportRequest,
          snapshotCount: snapshots.length,
          proofCount: proofCounters.total
        }),
        ready: exportBlocked === null,
        blockedReason: exportBlocked,
        redactionMode: exportRequest.redactionMode,
        delivery: exportRequest.delivery,
        destination: exportRequest.destination,
        correlationId: exportRequest.correlationId,
        sections: {
          summary: true,
          proofs: exportRequest.includeProofs,
          history: exportRequest.includeHistory,
          timeline: exportRequest.includeTimeline,
          providerSync: exportRequest.delivery === 'provider_sync',
          externalHandoff: exportRequest.delivery === 'external_handoff'
        },
        recordCounts: {
          snapshots: exportRequest.includeHistory ? snapshots.length : 0,
          transitions: exportRequest.includeHistory ? transitions.length : 0,
          timelineEvents: exportRequest.includeTimeline ? snapshots.length + 2 : 0,
          proofs: exportRequest.includeProofs ? proofCounters.total : 0,
          blockers: Object.values(blockerCounts).reduce((total, count) => total + count, 0),
          exportRecords: exportPackage.recordSummary.total
        }
      },
      package: {
        schema: exportPackage.schema,
        integrityId: exportPackage.integrity.id,
        contentType: exportPackage.delivery.contentType,
        writeMode: exportPackage.delivery.writeMode,
        recordSummary: exportPackage.recordSummary,
        redaction: exportPackage.redaction
      },
      counters: {
        proofs: proofCounters,
        snapshots: snapshots.length,
        transitions: transitions.length,
        blocked: blockedSnapshots.length,
        retryable: retryableSnapshots.length,
        stateChanges: transitionCounters.stateChanges,
        decisionChanges: transitionCounters.decisionChanges,
        severityEscalations: transitionCounters.severityEscalations,
        validationErrors: validation.errors.length,
        boundaryViolations: boundary.violations.length,
        lifecycleErrors: lifecycleControls.validation.errors.length,
        lifecycleWarnings: lifecycleControls.validation.warnings.length,
        providerErrors: providerNegotiation.errors.length,
        providerWarnings: providerNegotiation.warnings.length,
        missingProviderCapabilities: providerNegotiation.missingCapabilities.length
      }
    }
  };
}

function normalizePreviewAcceptance(input, principal) {
  const rawAcceptance = input.acceptance && typeof input.acceptance === 'object'
    ? input.acceptance
    : input.previewAcceptance && typeof input.previewAcceptance === 'object'
      ? input.previewAcceptance
      : {};
  const rawDecision = cleanToken(rawAcceptance.decision || rawAcceptance.status, 'pending').toLowerCase();
  const accepted = rawAcceptance.accepted === true || rawDecision === 'accepted' || rawDecision === 'accept';
  const rejected = rawAcceptance.rejected === true || rawDecision === 'rejected' || rawDecision === 'reject';

  return {
    decision: accepted ? 'accepted' : rejected ? 'rejected' : 'pending',
    actorId: cleanToken(rawAcceptance.actorId || rawAcceptance.acceptedBy, principal.id),
    acceptedAt: accepted ? cleanToken(rawAcceptance.acceptedAt || rawAcceptance.decidedAt, null) : null,
    rejectedAt: rejected ? cleanToken(rawAcceptance.rejectedAt || rawAcceptance.decidedAt, null) : null,
    note: cleanToken(rawAcceptance.note || rawAcceptance.reason, null),
    previewVersion: cleanToken(rawAcceptance.previewVersion || rawAcceptance.version, 'aios.panic-inspector.preview.v1')
  };
}

function normalizeClientRuntimeState(input, principal, incident) {
  const rawClient = input.client && typeof input.client === 'object'
    ? input.client
    : input.clientRuntime && typeof input.clientRuntime === 'object'
      ? input.clientRuntime
      : {};
  const rawRequest = input.request && typeof input.request === 'object'
    ? input.request
    : {};
  const rawState = rawClient.state && typeof rawClient.state === 'object'
    ? rawClient.state
    : input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : {};
  const rawAcknowledgements = Array.isArray(rawClient.acknowledgedProofIds)
    ? rawClient.acknowledgedProofIds
    : Array.isArray(rawState.acknowledgedProofIds)
      ? rawState.acknowledgedProofIds
      : [];
  const requestedChannel = cleanToken(rawClient.channel || rawRequest.channel || input.channel, 'api').toLowerCase();
  const requestedIntent = cleanToken(rawClient.intent || rawRequest.intent || input.intent, 'inspect').toLowerCase();

  return {
    requestId: cleanToken(rawRequest.id || rawClient.requestId || input.requestId, proofId('panic_request', {
      actor: principal.id,
      incident: incident.id
    })),
    sessionId: cleanToken(rawClient.sessionId || rawRequest.sessionId, null),
    channel: CLIENT_CHANNELS.has(requestedChannel) ? requestedChannel : 'api',
    requestedChannel,
    intent: CLIENT_HANDOFF_INTENTS.has(requestedIntent) ? requestedIntent : 'inspect',
    requestedIntent,
    route: cleanToken(rawRequest.route || rawClient.route, 'audit-recovery/panic-inspector'),
    referrerRoute: cleanToken(rawClient.referrerRoute || rawRequest.referrerRoute, null),
    idempotencyKey: cleanToken(rawRequest.idempotencyKey || rawClient.idempotencyKey, null),
    correlationId: cleanToken(rawRequest.correlationId || rawClient.correlationId, null),
    hydrated: rawState.hydrated === true || rawClient.hydrated === true,
    optimisticAction: cleanToken(rawState.optimisticAction || rawClient.optimisticAction, null),
    acknowledgedProofIds: [...new Set(rawAcknowledgements
      .filter((proofIdValue) => typeof proofIdValue === 'string' && proofIdValue.trim().length > 0)
      .map((proofIdValue) => proofIdValue.trim()))].sort(),
    cachedIncidentId: cleanToken(rawState.incidentId || rawClient.incidentId, null),
    clientRevision: cleanToken(rawState.revision || rawClient.revision, 'unversioned')
  };
}

function buildClientWorkflowHandoff(now, clientRuntime, principal, incident, validation, boundary, operationalHealth, lifecycleControls, providerNegotiation, handoff) {
  const errors = [];
  const warnings = [];
  const blockers = [...new Set([
    ...boundary.violations,
    ...validation.errors,
    ...lifecycleControls.validation.errors,
    ...providerNegotiation.errors
  ])].sort();

  if (!CLIENT_CHANNELS.has(clientRuntime.requestedChannel)) warnings.push('unknown_client_channel_defaulted_to_api');
  if (!CLIENT_HANDOFF_INTENTS.has(clientRuntime.requestedIntent)) warnings.push('unknown_client_intent_defaulted_to_inspect');
  if (clientRuntime.cachedIncidentId && clientRuntime.cachedIncidentId !== incident.id) errors.push('client_state_incident_mismatch');
  if (clientRuntime.intent === 'retry' && !operationalHealth.retryable) errors.push('client_retry_intent_requires_retryable_incident');
  if (clientRuntime.intent === 'recover' && !boundary.permissions.canRecover) errors.push('client_recover_intent_requires_recovery_permission');
  if (clientRuntime.intent === 'handoff' && !boundary.permissions.canHandoff) errors.push('client_handoff_intent_requires_audit_permission');
  if (clientRuntime.optimisticAction && clientRuntime.optimisticAction !== lifecycleControls.nextAction.state) warnings.push('client_optimistic_action_reconciled');
  if (!clientRuntime.idempotencyKey && ['retry', 'recover', 'handoff', 'accept_preview'].includes(clientRuntime.intent)) warnings.push('mutation_intent_without_idempotency_key');

  const blocked = blockers.length > 0 || errors.length > 0;
  const route = blocked
    ? 'audit-recovery/panic-inspector/review'
    : clientRuntime.intent === 'accept_preview'
      ? 'audit-recovery/panic-inspector/preview/accept'
      : providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
        ? providerNegotiation.externalHandoff.route
        : lifecycleControls.nextAction.route;
  const status = blocked
    ? 'client_handoff_blocked'
    : clientRuntime.intent === 'accept_preview'
      ? 'awaiting_preview_acceptance'
      : providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
        ? 'external_handoff_dispatchable'
        : lifecycleControls.nextAction.state === 'retry_after_backoff'
          ? 'retry_scheduled'
          : 'client_handoff_ready';
  const disabledControls = [
    !boundary.permissions.canRecover ? 'recover' : null,
    !boundary.permissions.canHandoff ? 'handoff' : null,
    !operationalHealth.retryable ? 'retry' : null,
    blocked ? 'dispatch' : null
  ].filter(Boolean);
  const cacheKeys = [
    `panic-inspector:${incident.tenantId}:${incident.workspaceId}:${incident.id}`,
    providerNegotiation.sync.watermark ? `provider-sync:${providerNegotiation.providerId}:${providerNegotiation.sync.watermark}` : null,
    handoff.status === 'ready' ? `audit-handoff:${handoff.id}` : null
  ].filter(Boolean);
  const handoffPayload = {
    surfaceId,
    requestId: clientRuntime.requestId,
    incidentId: incident.id,
    actorId: principal.id,
    route,
    status,
    blockers,
    errors
  };

  return {
    status,
    route,
    valid: !blocked,
    token: proofId('client_handoff', handoffPayload),
    request: {
      id: clientRuntime.requestId,
      sessionId: clientRuntime.sessionId,
      channel: clientRuntime.channel,
      intent: clientRuntime.intent,
      route: clientRuntime.route,
      referrerRoute: clientRuntime.referrerRoute,
      idempotencyKey: clientRuntime.idempotencyKey,
      correlationId: clientRuntime.correlationId
    },
    statePatch: {
      incidentId: incident.id,
      revision: proofId('client_state', { incident, status, route, generatedAt: now }),
      activeRoute: route,
      pendingAction: blocked ? 'repair_blockers' : lifecycleControls.nextAction.state,
      hydrated: true,
      banner: blocked ? 'panic_inspection_needs_attention' : status,
      disabledControls,
      retryAfterMs: operationalHealth.retryAfterMs,
      cacheKeysToInvalidate: cacheKeys
    },
    dispatch: {
      method: blocked ? 'GET' : ['retry', 'recover', 'handoff', 'accept_preview'].includes(clientRuntime.intent) ? 'POST' : 'GET',
      route,
      bodySchema: blocked ? null : 'aios.panic-inspector.client-handoff.v1',
      dueAt: lifecycleControls.nextAction.dueAt || now,
      externalTarget: providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
        ? providerNegotiation.externalHandoff.target
        : null
    },
    auditEnvelope: {
      id: proofId('client_audit', handoffPayload),
      generatedAt: now,
      format: 'aios.panic-inspector.client-runtime.v1',
      actorId: principal.id,
      tenantId: incident.tenantId,
      workspaceId: incident.workspaceId,
      incidentId: incident.id,
      decision: status,
      blockers,
      warnings,
      errors
    },
    validation: {
      valid: !blocked,
      errors,
      warnings,
      blockers
    }
  };
}

function normalizePersistedInspectorState(input, now, principal, incident, lifecycleControls, clientRuntime) {
  const rawState = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.recoveryState && typeof input.recoveryState === 'object'
      ? input.recoveryState
      : input.checkpoint && typeof input.checkpoint === 'object'
        ? input.checkpoint
        : {};
  const rawLedger = Array.isArray(rawState.commandLedger)
    ? rawState.commandLedger
    : Array.isArray(rawState.commands)
      ? rawState.commands
      : [];
  const rawLock = rawState.lock && typeof rawState.lock === 'object' ? rawState.lock : {};
  const requestedStatus = cleanToken(rawState.status || rawState.recoveryStatus, 'new').toLowerCase();
  const storageKey = cleanToken(rawState.storageKey, `panic-inspector:${incident.tenantId}:${incident.workspaceId}:${incident.id}`);
  const commandKey = cleanToken(
    clientRuntime.idempotencyKey,
    proofId('panic_command', {
      surfaceId,
      incidentId: incident.id,
      actorId: principal.id,
      command: lifecycleControls.command,
      requestId: clientRuntime.requestId
    })
  );
  const commandLedger = rawLedger
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-20)
    .map((entry, index) => {
      const command = cleanToken(entry.command || entry.intent, 'inspect').toLowerCase();
      const status = cleanToken(entry.status || entry.result, 'unknown').toLowerCase();
      return {
        id: cleanToken(entry.id || entry.commandKey, proofId('persisted_command', { incidentId: incident.id, index, entry })),
        command,
        status,
        actorId: cleanToken(entry.actorId, principal.id),
        requestId: cleanToken(entry.requestId, null),
        idempotencyKey: cleanToken(entry.idempotencyKey || entry.commandKey, null),
        revision: cleanToken(entry.revision, null),
        recordedAt: cleanToken(entry.recordedAt || entry.at, null),
        terminal: COMMAND_TERMINAL_STATUSES.has(status),
        recoverable: COMMAND_RECOVERABLE_STATUSES.has(status)
      };
    });
  const matchingCommand = commandLedger.find((entry) => entry.idempotencyKey === commandKey || entry.id === commandKey) || null;
  const latestAppliedCommand = [...commandLedger]
    .reverse()
    .find((entry) => entry.status === 'applied') || null;
  const lockExpiresAt = cleanToken(rawLock.expiresAt || rawState.lockExpiresAt, null);
  const lockExpiresMs = parseTimestampMs(lockExpiresAt);
  const nowMs = parseTimestampMs(now);
  const lockExpired = lockExpiresMs !== null && nowMs !== null && lockExpiresMs <= nowMs;

  return {
    schema: 'aios.panic-inspector.persisted-state.v1',
    storageKey,
    incidentId: cleanToken(rawState.incidentId, incident.id),
    tenantId: cleanToken(rawState.tenantId, incident.tenantId),
    workspaceId: cleanToken(rawState.workspaceId, incident.workspaceId),
    status: PERSISTED_STATUSES.has(requestedStatus) ? requestedStatus : 'corrupt',
    requestedStatus,
    revision: cleanToken(rawState.revision || rawState.etag, null),
    lastStableRevision: cleanToken(rawState.lastStableRevision, null),
    lastCompletedAction: cleanToken(rawState.lastCompletedAction, null),
    lastObservedAt: cleanToken(rawState.lastObservedAt || rawState.updatedAt, null),
    hydratedAt: cleanToken(rawState.hydratedAt, null),
    commandKey,
    matchingCommand,
    latestAppliedCommand,
    commandLedger,
    lock: {
      ownerId: cleanToken(rawLock.ownerId || rawState.lockOwnerId, null),
      token: cleanToken(rawLock.token || rawState.lockToken, null),
      acquiredAt: cleanToken(rawLock.acquiredAt, null),
      expiresAt: lockExpiresAt,
      expired: lockExpired === true
    }
  };
}

function buildPersistedRecoveryContract(now, persistedState, incident, validation, boundary, operationalHealth, lifecycleControls, providerNegotiation, clientWorkflowHandoff) {
  const errors = [];
  const warnings = [];
  const stateScopeMatches = persistedState.incidentId === incident.id
    && persistedState.tenantId === incident.tenantId
    && persistedState.workspaceId === incident.workspaceId;
  const mutatingCommand = MUTATING_COMMANDS.has(lifecycleControls.command) || clientWorkflowHandoff.dispatch.method === 'POST';
  const commandAlreadyApplied = persistedState.matchingCommand?.terminal === true
    && persistedState.matchingCommand.status === 'applied';
  const commandAlreadyRejected = persistedState.matchingCommand?.terminal === true
    && persistedState.matchingCommand.status === 'rejected';
  const inFlightCommand = persistedState.matchingCommand
    && !persistedState.matchingCommand.terminal
    && persistedState.matchingCommand.recoverable;
  const conflictingCommand = persistedState.matchingCommand
    && persistedState.matchingCommand.command !== lifecycleControls.command
    ? persistedState.matchingCommand
    : null;
  const lastObservedMs = parseTimestampMs(persistedState.lastObservedAt);
  const nowMs = parseTimestampMs(now);
  const persistedAgeMs = lastObservedMs !== null && nowMs !== null ? Math.max(0, nowMs - lastObservedMs) : null;
  const staleInProgress = persistedState.status === 'in_progress'
    && (persistedAgeMs === null || persistedAgeMs > Math.max(60000, lifecycleControls.schedule.retryWindowMinutes * 60000));
  const revisionSeed = {
    incidentId: incident.id,
    previousRevision: persistedState.revision,
    commandKey: persistedState.commandKey,
    lifecycleCommand: lifecycleControls.command,
    nextAction: lifecycleControls.nextAction.state,
    status: clientWorkflowHandoff.status
  };

  if (!stateScopeMatches) errors.push('persisted_state_scope_mismatch');
  if (persistedState.status === 'corrupt') errors.push('persisted_state_status_unrecognized');
  if (persistedState.lock.token && !persistedState.lock.expired && persistedState.lock.ownerId !== clientWorkflowHandoff.request.id) {
    warnings.push('persisted_state_locked_by_another_request');
  }
  if (mutatingCommand && !clientWorkflowHandoff.request.idempotencyKey) warnings.push('persisted_mutation_uses_generated_idempotency_key');
  if (inFlightCommand) warnings.push('idempotent_command_resume_in_progress');
  if (commandAlreadyRejected) errors.push('idempotent_command_previously_rejected');
  if (conflictingCommand) errors.push('idempotent_command_key_reused_for_different_command');
  if (persistedState.lastObservedAt && parseTimestampMs(persistedState.lastObservedAt) === null) warnings.push('persisted_last_observed_at_unparseable');
  if (staleInProgress) warnings.push('stale_in_progress_checkpoint_requires_replay');

  const blocked = errors.length > 0
    || !boundary.allowed
    || !validation.valid
    || providerNegotiation.valid === false
    || clientWorkflowHandoff.valid === false;
  const recoveryPath = !stateScopeMatches || persistedState.status === 'corrupt'
    ? 'quarantine_persisted_state'
    : commandAlreadyApplied
      ? 'return_prior_command_result'
      : inFlightCommand
        ? 'resume_inflight_command'
        : persistedState.status === 'in_progress' || persistedState.lock.expired || staleInProgress
          ? 'replay_from_last_stable_revision'
          : operationalHealth.retryable && lifecycleControls.nextAction.state === 'retry_after_backoff'
            ? 'restore_retry_schedule'
            : lifecycleControls.nextAction.state === 'export_audit_handoff'
              ? 'restore_handoff_ready_state'
              : blocked
                ? 'persist_blocked_review'
                : 'persist_current_inspection';
  const restartSafeStatus = recoveryPath === 'quarantine_persisted_state'
    ? 'restart_blocked'
    : blocked
      ? 'restart_safe_blocked'
      : ['return_prior_command_result', 'resume_inflight_command', 'replay_from_last_stable_revision'].includes(recoveryPath)
        ? 'restart_resumable'
        : 'restart_safe';
  const writeIntent = commandAlreadyApplied
    ? 'skip_duplicate'
    : blocked
      ? 'write_blocked_status'
      : mutatingCommand
        ? 'compare_and_swap_command'
        : 'upsert_read_model';
  const nextRevision = proofId('persisted_revision', revisionSeed);
  const shapedStatus = blocked
    ? 'blocked'
    : clientWorkflowHandoff.status === 'retry_scheduled'
      ? 'retry_scheduled'
      : lifecycleControls.nextAction.state === 'export_audit_handoff'
        ? 'handoff_ready'
        : operationalHealth.canSelfRecover && lifecycleControls.command === 'resume'
          ? 'recovered'
          : 'hydrated';
  const commandRecord = {
    id: persistedState.commandKey,
    command: lifecycleControls.command,
    status: blocked ? 'rejected' : commandAlreadyApplied ? 'skipped' : 'applied',
    actorId: clientWorkflowHandoff.auditEnvelope.actorId,
    requestId: clientWorkflowHandoff.request.id,
    idempotencyKey: persistedState.commandKey,
    revision: nextRevision,
    recordedAt: now
  };
  const priorCommandResult = commandAlreadyApplied ? {
    commandId: persistedState.matchingCommand.id,
    revision: persistedState.matchingCommand.revision,
    recordedAt: persistedState.matchingCommand.recordedAt,
    status: 'replayed_without_write'
  } : null;
  const recoveryCursor = {
    incidentId: incident.id,
    commandKey: persistedState.commandKey,
    sourceRevision: recoveryPath === 'return_prior_command_result'
      ? persistedState.matchingCommand?.revision || persistedState.revision
      : recoveryPath === 'replay_from_last_stable_revision'
        ? persistedState.lastStableRevision || persistedState.revision
        : persistedState.revision,
    nextRevision,
    replayFromLedgerIndex: persistedState.commandLedger.findIndex((entry) => entry.id === persistedState.matchingCommand?.id),
    latestAppliedCommandId: persistedState.latestAppliedCommand?.id || null
  };
  const writePreconditions = {
    expectedRevision: persistedState.revision,
    expectedLockToken: persistedState.lock.expired ? null : persistedState.lock.token,
    expectedIncidentId: incident.id,
    rejectIfStatusIn: recoveryPath === 'return_prior_command_result' ? [] : ['corrupt'],
    allowCreate: persistedState.requestedStatus === 'new' && persistedState.revision === null,
    requireCompareAndSwap: mutatingCommand && !commandAlreadyApplied,
    idempotencyKey: persistedState.commandKey
  };
  const restartStatusSnapshot = {
    schema: 'aios.panic-inspector.restart-status.v1',
    status: shapedStatus,
    safeStatus: restartSafeStatus,
    recoveryPath,
    dispatchState: blocked
      ? 'held_for_review'
      : commandAlreadyApplied
        ? 'deduped'
        : inFlightCommand
          ? 'resumable'
          : 'ready',
    stable: !blocked && !inFlightCommand && !staleInProgress,
    retryScheduledAt: shapedStatus === 'retry_scheduled' ? lifecycleControls.schedule.nextInspectionAt : null,
    handoffReady: shapedStatus === 'handoff_ready',
    proofRequired: blocked || providerNegotiation.sync.status === 'blocked'
  };

  return {
    valid: errors.length === 0,
    schema: persistedState.schema,
    storage: {
      key: persistedState.storageKey,
      compareRevision: persistedState.revision,
      nextRevision,
      writeIntent,
      compareAndSwapRequired: mutatingCommand && !commandAlreadyApplied,
      stateScopeMatches,
      writePreconditions
    },
    restart: {
      safeStatus: restartSafeStatus,
      recoveryPath,
      commandAlreadyApplied,
      inFlightCommand: Boolean(inFlightCommand),
      staleInProgress,
      lockExpired: persistedState.lock.expired,
      resumeFromRevision: persistedState.lastStableRevision || persistedState.revision,
      lastCompletedAction: persistedState.lastCompletedAction,
      statusSnapshot: restartStatusSnapshot,
      recoveryCursor,
      priorCommandResult
    },
    command: commandRecord,
    statePatch: {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      workspaceId: incident.workspaceId,
      status: shapedStatus,
      revision: nextRevision,
      lastStableRevision: blocked ? persistedState.lastStableRevision : nextRevision,
      lastCompletedAction: commandRecord.command,
      lastObservedAt: now,
      lifecycle: lifecycleControls.transition.settingsPatch,
      commandLedgerAppend: commandAlreadyApplied ? null : commandRecord,
      restartStatus: restartStatusSnapshot,
      lock: null
    },
    recoveryPaths: {
      primary: recoveryPath,
      fallback: stateScopeMatches ? 'persist_blocked_review' : 'quarantine_persisted_state',
      replayable: ['resume_inflight_command', 'replay_from_last_stable_revision', 'restore_retry_schedule'].includes(recoveryPath),
      idempotentReplay: commandAlreadyApplied,
      cursor: recoveryCursor
    },
    validation: {
      valid: errors.length === 0,
      errors,
      warnings
    }
  };
}

function buildHostedKernelResumePlan(now, incident, persistedRecovery, operationalHealth, lifecycleControls, providerNegotiation, clientWorkflowHandoff) {
  const errors = [];
  const warnings = [...persistedRecovery.validation.warnings];
  const restartPath = persistedRecovery.restart.recoveryPath;
  const writeIntent = persistedRecovery.storage.writeIntent;
  const requiresMutationLease = persistedRecovery.storage.compareAndSwapRequired
    || ['resume_inflight_command', 'replay_from_last_stable_revision'].includes(restartPath);
  const dispatchable = clientWorkflowHandoff.valid
    && persistedRecovery.valid
    && persistedRecovery.restart.safeStatus !== 'restart_blocked'
    && providerNegotiation.sync.status !== 'blocked';
  const checkpointRoute = restartPath === 'quarantine_persisted_state'
    ? 'audit-recovery/panic-inspector/state-quarantine'
    : restartPath === 'restore_handoff_ready_state'
      ? clientWorkflowHandoff.dispatch.route
      : restartPath === 'restore_retry_schedule'
        ? 'audit-recovery/panic-inspector/retry'
        : restartPath === 'persist_blocked_review'
          ? 'audit-recovery/panic-inspector/review'
          : 'audit-recovery/panic-inspector/state';

  if (!persistedRecovery.storage.stateScopeMatches) errors.push('resume_plan_state_scope_mismatch');
  if (persistedRecovery.restart.safeStatus === 'restart_blocked') errors.push('resume_plan_restart_blocked');
  if (providerNegotiation.sync.status === 'blocked') errors.push('resume_plan_provider_sync_blocked');
  if (requiresMutationLease && !persistedRecovery.storage.compareRevision && !persistedRecovery.restart.resumeFromRevision) {
    warnings.push('resume_plan_without_prior_revision');
  }
  if (clientWorkflowHandoff.dispatch.method === 'POST' && !clientWorkflowHandoff.request.idempotencyKey) {
    warnings.push('resume_plan_mutation_without_client_idempotency_key');
  }

  const resumeMode = restartPath === 'quarantine_persisted_state'
    ? 'quarantine'
    : restartPath === 'return_prior_command_result'
      ? 'dedupe_return'
      : restartPath === 'resume_inflight_command'
        ? 'resume_command'
        : restartPath === 'replay_from_last_stable_revision'
          ? 'replay_checkpoint'
          : restartPath === 'restore_retry_schedule'
            ? 'retry_scheduler'
            : restartPath === 'restore_handoff_ready_state'
              ? 'handoff_restore'
              : restartPath === 'persist_blocked_review'
                ? 'blocked_review'
                : 'read_model_upsert';
  const nextDispatchState = errors.length > 0
    ? 'blocked'
    : persistedRecovery.restart.statusSnapshot.dispatchState === 'deduped'
      ? 'duplicate_command_replayed'
      : persistedRecovery.restart.statusSnapshot.dispatchState === 'resumable'
        ? 'resume_dispatch_ready'
    : clientWorkflowHandoff.dispatch.method === 'POST'
      ? 'mutating_dispatch_ready'
      : 'read_dispatch_ready';
  const checkpointKeys = [
    persistedRecovery.storage.key,
    persistedRecovery.restart.resumeFromRevision ? `${persistedRecovery.storage.key}:revision:${persistedRecovery.restart.resumeFromRevision}` : null,
    providerNegotiation.sync.watermark ? `${persistedRecovery.storage.key}:provider:${providerNegotiation.sync.watermark}` : null
  ].filter(Boolean);

  return {
    schema: 'aios.panic-inspector.hosted-kernel-resume.v1',
    valid: errors.length === 0,
    generatedAt: now,
    incidentId: incident.id,
    mode: resumeMode,
    restartPath,
    dispatchable,
    restartStatus: persistedRecovery.restart.statusSnapshot,
    storage: {
      key: persistedRecovery.storage.key,
      compareRevision: persistedRecovery.storage.compareRevision,
      nextRevision: persistedRecovery.storage.nextRevision,
      writeIntent,
      requiresMutationLease,
      checkpointKeys,
      writePreconditions: persistedRecovery.storage.writePreconditions,
      recoveryCursor: persistedRecovery.restart.recoveryCursor
    },
    execution: {
      state: nextDispatchState,
      method: errors.length > 0 || persistedRecovery.restart.commandAlreadyApplied ? 'GET' : clientWorkflowHandoff.dispatch.method,
      route: errors.length > 0 ? 'audit-recovery/panic-inspector/state-recovery' : checkpointRoute,
      dueAt: lifecycleControls.nextAction.dueAt || now,
      retryAfterMs: operationalHealth.retryAfterMs,
      providerSyncMode: providerNegotiation.sync.mode,
      providerRoute: providerNegotiation.sync.route,
      externalTarget: clientWorkflowHandoff.dispatch.externalTarget,
      priorCommandResult: persistedRecovery.restart.priorCommandResult
    },
    audit: {
      id: proofId('hosted_kernel_resume', {
        incidentId: incident.id,
        restartPath,
        writeIntent,
        nextRevision: persistedRecovery.storage.nextRevision,
        route: checkpointRoute
      }),
      format: 'aios.panic-inspector.hosted-kernel-resume.v1',
      generatedAt: now,
      subject: {
        incidentId: incident.id,
        tenantId: persistedRecovery.statePatch.tenantId,
        workspaceId: persistedRecovery.statePatch.workspaceId
      }
    },
    validation: {
      valid: errors.length === 0,
      errors,
      warnings
    }
  };
}

function buildGate(id, label, passed, blockers = [], route = null) {
  return {
    id,
    label,
    passed,
    route,
    blockers: blockers.filter((blocker) => typeof blocker === 'string' && blocker.length > 0)
  };
}

function explainPreviewGate(gate, proofIndex) {
  const primaryBlocker = gate.blockers[0] || null;
  const proofType = gate.id === 'scope'
    ? 'workspace_access_policy'
    : gate.id === 'incident_validation'
      ? 'health_proof'
      : gate.id === 'lifecycle'
        ? 'lifecycle_settings'
        : gate.id === 'provider'
          ? 'provider_contract'
          : gate.id === 'operational_health'
            ? 'operational_health'
            : 'lifecycle_transition';

  return {
    id: `explain_${gate.id}`,
    gateId: gate.id,
    status: gate.passed ? 'passed' : 'blocked',
    proofId: proofIndex[proofType] || null,
    primaryBlocker,
    route: gate.passed ? null : gate.route,
    message: gate.passed
      ? `${gate.label} passed`
      : `${gate.label} blocked by ${primaryBlocker || 'unknown_blocker'}`
  };
}

function buildPreviewRouteContract(now, incident, principal, acceptanceInput, readinessStatus, primaryRoute, uniqueBlockers, warnings) {
  const acceptEnabled = readinessStatus === 'awaiting_acceptance';
  const rejected = readinessStatus === 'rejected';
  const submitRoute = acceptEnabled || rejected
    ? 'audit-recovery/panic-inspector/preview/accept'
    : primaryRoute;
  const requestBody = {
    schema: 'aios.panic-inspector.preview-acceptance-request.v1',
    incidentId: incident.id,
    tenantId: incident.tenantId,
    workspaceId: incident.workspaceId,
    previewVersion: acceptanceInput.previewVersion,
    decision: acceptEnabled ? 'accept' : acceptanceInput.decision,
    actorId: acceptanceInput.actorId,
    actorRole: principal.role,
    actorTenantId: principal.tenantId,
    acceptedAt: acceptEnabled ? now : acceptanceInput.acceptedAt,
    noteRequired: rejected,
    idempotencyScope: `${incident.tenantId}:${incident.workspaceId}:${incident.id}:preview`
  };

  return {
    schema: 'aios.panic-inspector.preview-route-contract.v1',
    status: readinessStatus,
    generatedAt: now,
    route: {
      view: 'audit-recovery/panic-inspector/preview',
      submit: submitRoute,
      review: uniqueBlockers.length > 0 ? 'audit-recovery/panic-inspector/review' : null
    },
    method: acceptEnabled || rejected ? 'POST' : 'GET',
    bodySchema: acceptEnabled || rejected ? requestBody.schema : null,
    requestBody: acceptEnabled || rejected ? requestBody : null,
    disabledReasons: {
      accept: acceptEnabled ? null : rejected ? 'preview_rejected' : 'acceptance_not_required',
      dispatch: uniqueBlockers.length > 0 ? 'validation_blockers_present' : acceptEnabled ? 'preview_acceptance_required' : null
    },
    cache: {
      key: `panic-preview:${incident.tenantId}:${incident.workspaceId}:${incident.id}`,
      varyBy: ['actorId', 'previewVersion', 'readinessStatus'],
      invalidateOn: ['accept_preview', 'reject_preview', 'repair_blockers']
    },
    warnings
  };
}

function buildPreviewAcceptanceReadiness(now, input, principal, incident, validation, boundary, operationalHealth, lifecycleControls, providerNegotiation, handoff, proofs, reporting) {
  const acceptanceInput = normalizePreviewAcceptance(input, principal);
  const proofIndex = proofs.reduce((index, proof) => {
    index[proof.type] = proof.id;
    return index;
  }, {});
  const lifecycleWarnings = lifecycleControls.validation.warnings;
  const providerWarnings = providerNegotiation.warnings;
  const blockers = [
    ...boundary.violations,
    ...validation.errors,
    ...lifecycleControls.validation.errors,
    ...providerNegotiation.errors,
    ...operationalHealth.actionableErrors
  ];
  const uniqueBlockers = [...new Set(blockers)].sort();
  const warnings = [...new Set([
    ...validation.warnings,
    ...lifecycleWarnings,
    ...providerWarnings
  ])].sort();
  const acceptanceRequired = SEVERITY_RANK[incident.severity] >= SEVERITY_RANK.critical
    || lifecycleControls.nextAction.state === 'export_audit_handoff'
    || providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
    || operationalHealth.status === 'degraded';
  const acceptanceState = acceptanceRequired
    ? acceptanceInput.decision === 'accepted'
      ? 'accepted'
      : acceptanceInput.decision === 'rejected'
        ? 'rejected'
        : 'required'
    : 'not_required';
  const gates = [
    buildGate('scope', 'Tenant and workspace boundary', boundary.allowed, boundary.violations, 'audit-recovery/panic-inspector/boundary-review'),
    buildGate('incident_validation', 'Incident evidence validation', validation.valid, validation.errors, 'audit-recovery/panic-inspector/evidence'),
    buildGate('lifecycle', 'Lifecycle command validation', lifecycleControls.validation.valid, lifecycleControls.validation.errors, 'audit-recovery/panic-inspector/lifecycle-settings'),
    buildGate('provider', 'Hosted provider contract', providerNegotiation.valid, providerNegotiation.errors, providerNegotiation.sync.route),
    buildGate('operational_health', 'Operational readiness', operationalHealth.status === 'healthy', operationalHealth.actionableErrors, 'audit-recovery/panic-inspector/health'),
    buildGate('operator_acceptance', 'Preview acceptance', acceptanceState !== 'required' && acceptanceState !== 'rejected', acceptanceState === 'rejected' ? ['preview_rejected'] : acceptanceState === 'required' ? ['preview_acceptance_required'] : [], 'audit-recovery/panic-inspector/preview/accept')
  ];
  const passedGateCount = gates.filter((gate) => gate.passed).length;
  const readinessStatus = uniqueBlockers.length > 0
    ? 'blocked'
    : acceptanceState === 'required'
      ? 'awaiting_acceptance'
      : acceptanceState === 'rejected'
        ? 'rejected'
        : providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
          ? 'ready_for_external_handoff'
          : handoff.status === 'ready'
            ? 'ready_for_audit_handoff'
            : 'ready_for_inspection';
  const primaryRoute = readinessStatus === 'awaiting_acceptance'
    ? 'audit-recovery/panic-inspector/preview/accept'
    : readinessStatus === 'ready_for_external_handoff'
      ? providerNegotiation.externalHandoff.route
      : lifecycleControls.nextAction.route;
  const gateExplanations = gates.map((gate) => explainPreviewGate(gate, proofIndex));
  const routeContract = buildPreviewRouteContract(
    now,
    incident,
    principal,
    acceptanceInput,
    readinessStatus,
    primaryRoute,
    uniqueBlockers,
    warnings
  );
  const acceptanceProof = {
    id: proofId('preview_acceptance', {
      incidentId: incident.id,
      actorId: acceptanceInput.actorId,
      decision: acceptanceState,
      readinessStatus,
      blockers: uniqueBlockers,
      previewVersion: acceptanceInput.previewVersion
    }),
    format: 'aios.panic-inspector.preview-acceptance.v1',
    generatedAt: now,
    actorId: acceptanceInput.actorId,
    accepted: acceptanceState === 'accepted',
    rejected: acceptanceState === 'rejected',
    required: acceptanceRequired,
    route: routeContract.route.submit,
    bodySchema: routeContract.bodySchema
  };
  const previewCards = [
    {
      id: 'incident_summary',
      title: 'Incident summary',
      severity: incident.severity,
      state: incident.state,
      value: incident.reason,
      route: 'audit-recovery/panic-inspector'
    },
    {
      id: 'readiness_summary',
      title: 'Readiness',
      severity: uniqueBlockers.length > 0 ? 'high' : warnings.length > 0 ? 'medium' : 'info',
      state: readinessStatus,
      value: `${passedGateCount}/${gates.length} gates passed`,
      route: uniqueBlockers.length > 0 ? routeContract.route.review : primaryRoute
    },
    {
      id: 'evidence_summary',
      title: 'Evidence',
      severity: validation.trustedEvidenceCount === 0 && validation.evidenceCount > 0 ? 'high' : 'info',
      state: validation.valid ? 'validated' : 'needs_review',
      value: `${validation.trustedEvidenceCount}/${validation.evidenceCount} trusted evidence records`,
      route: 'audit-recovery/panic-inspector/evidence'
    }
  ];

  return {
    preview: {
      id: proofId('panic_preview', { incidentId: incident.id, generatedAt: now, readinessStatus, primaryRoute }),
      version: acceptanceInput.previewVersion,
      generatedAt: now,
      route: 'audit-recovery/panic-inspector/preview',
      status: readinessStatus,
      title: `${incident.severity} ${incident.state} incident`,
      summary: {
        incidentId: incident.id,
        decision: reporting.timeline.reportStatus,
        nextAction: lifecycleControls.nextAction.state,
        primaryRoute,
        retryAfterMs: operationalHealth.retryAfterMs,
        evidence: {
          total: validation.evidenceCount,
          trusted: validation.trustedEvidenceCount,
          rejected: handoff.rejectedEvidenceCount
        }
      },
      cards: previewCards,
      routeContract
    },
    acceptance: {
      required: acceptanceRequired,
      state: acceptanceState,
      route: 'audit-recovery/panic-inspector/preview/accept',
      actorId: acceptanceInput.actorId,
      acceptedAt: acceptanceInput.acceptedAt,
      rejectedAt: acceptanceInput.rejectedAt,
      note: acceptanceInput.note,
      acceptedDecision: acceptanceState === 'accepted' ? lifecycleControls.nextAction.state : null,
      proof: acceptanceProof,
      requestContract: routeContract.requestBody
    },
    readiness: {
      status: readinessStatus,
      score: Number((passedGateCount / gates.length).toFixed(3)),
      passedGateCount,
      totalGateCount: gates.length,
      gates,
      explanations: gateExplanations
    },
    validationSummary: {
      valid: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings,
      explainable: {
        firstBlockingGate: gateExplanations.find((explanation) => explanation.status === 'blocked') || null,
        routeContractId: routeContract.schema,
        acceptanceProofId: acceptanceProof.id
      },
      counts: {
        validationErrors: validation.errors.length,
        boundaryViolations: boundary.violations.length,
        lifecycleErrors: lifecycleControls.validation.errors.length,
        providerErrors: providerNegotiation.errors.length,
        providerWarnings: providerWarnings.length,
        proofFailures: proofs.filter((proof) => !proof.passed).length
      }
    },
    nextSteps: [
      {
        id: 'repair_blockers',
        label: 'Resolve blockers',
        route: uniqueBlockers.length > 0 ? gates.find((gate) => !gate.passed)?.route || 'audit-recovery/panic-inspector/review' : null,
        enabled: uniqueBlockers.length > 0,
        reason: uniqueBlockers[0] || null,
        proofId: proofIndex.workspace_scope || proofIndex.operational_health || null
      },
      {
        id: 'accept_preview',
        label: 'Accept inspection preview',
        route: 'audit-recovery/panic-inspector/preview/accept',
        enabled: acceptanceState === 'required',
        reason: acceptanceState === 'required' ? 'operator_acceptance_required' : null,
        proofId: proofIndex.lifecycle_settings || null
      },
      {
        id: 'perform_next_action',
        label: lifecycleControls.nextAction.state,
        route: primaryRoute,
        enabled: uniqueBlockers.length === 0 && acceptanceState !== 'required' && acceptanceState !== 'rejected',
        reason: lifecycleControls.nextAction.state,
        proofId: proofIndex.provider_contract || proofIndex.provider_sync || null
      }
    ]
  };
}

function buildClientProofAcknowledgementContract(now, clientRuntime, principal, incident, proofs, previewContract, clientWorkflowHandoff) {
  const acknowledged = new Set(clientRuntime.acknowledgedProofIds);
  const failedProofs = proofs
    .filter((proof) => proof && proof.passed === false)
    .map((proof) => ({
      id: proof.id,
      type: cleanToken(proof.type, 'unknown_proof'),
      route: cleanToken(proof.route, 'audit-recovery/panic-inspector/review')
    }));
  const blockingProofTypes = new Set([
    'workspace_access_policy',
    'effective_scope_guard',
    'role_permission',
    'operational_health',
    'lifecycle_settings',
    'lifecycle_transition',
    'provider_contract',
    'provider_sync',
    'external_handoff',
    'client_workflow_handoff',
    'persisted_recovery',
    'hosted_kernel_resume',
    'analytics_export'
  ]);
  const requiredAcknowledgements = failedProofs
    .filter((proof) => blockingProofTypes.has(proof.type) || previewContract.validationSummary.blockers.length > 0)
    .map((proof) => ({
      proofId: proof.id,
      proofType: proof.type,
      route: proof.route,
      acknowledged: acknowledged.has(proof.id)
    }));
  const missingAcknowledgements = requiredAcknowledgements
    .filter((proof) => !proof.acknowledged)
    .map((proof) => proof.proofId)
    .sort();
  const mutatingIntent = ['retry', 'recover', 'handoff', 'accept_preview'].includes(clientRuntime.intent)
    || clientWorkflowHandoff.dispatch.method === 'POST';
  const previewAwaitingAcceptance = previewContract.acceptance.required
    && previewContract.acceptance.state !== 'accepted'
    && previewContract.acceptance.state !== 'not_required';
  const acknowledgementRequired = requiredAcknowledgements.length > 0 || previewAwaitingAcceptance;
  const dispatchAllowed = clientWorkflowHandoff.valid
    && missingAcknowledgements.length === 0
    && previewAwaitingAcceptance === false;
  const holdReason = previewAwaitingAcceptance
    ? 'preview_acceptance_required'
    : missingAcknowledgements.length > 0
      ? 'blocking_proofs_unacknowledged'
      : clientWorkflowHandoff.valid
        ? null
        : 'client_workflow_handoff_invalid';
  const acknowledgementRoute = missingAcknowledgements.length > 0
    ? 'audit-recovery/panic-inspector/proofs/acknowledge'
    : previewAwaitingAcceptance
      ? previewContract.acceptance.route
      : clientWorkflowHandoff.dispatch.route;
  const stateRevision = proofId('client_ack_state', {
    incidentId: incident.id,
    requestId: clientRuntime.requestId,
    missingAcknowledgements,
    previewState: previewContract.acceptance.state,
    workflowStatus: clientWorkflowHandoff.status
  });

  return {
    schema: 'aios.panic-inspector.client-proof-acknowledgement.v1',
    generatedAt: now,
    valid: dispatchAllowed || !mutatingIntent,
    status: acknowledgementRequired
      ? dispatchAllowed
        ? 'acknowledged'
        : 'awaiting_acknowledgement'
      : 'not_required',
    request: {
      id: clientRuntime.requestId,
      channel: clientRuntime.channel,
      intent: clientRuntime.intent,
      actorId: principal.id,
      acknowledgedProofIds: [...acknowledged].sort()
    },
    requiredAcknowledgements,
    missingAcknowledgements,
    dispatchGate: {
      allowed: dispatchAllowed,
      mutatingIntent,
      holdReason,
      route: dispatchAllowed ? clientWorkflowHandoff.dispatch.route : acknowledgementRoute,
      method: dispatchAllowed ? clientWorkflowHandoff.dispatch.method : 'POST',
      bodySchema: dispatchAllowed
        ? clientWorkflowHandoff.dispatch.bodySchema
        : 'aios.panic-inspector.proof-acknowledgement-request.v1',
      requestBody: dispatchAllowed ? null : {
        schema: 'aios.panic-inspector.proof-acknowledgement-request.v1',
        incidentId: incident.id,
        tenantId: incident.tenantId,
        workspaceId: incident.workspaceId,
        actorId: principal.id,
        requestId: clientRuntime.requestId,
        proofIds: missingAcknowledgements,
        previewAcceptanceRequired: previewAwaitingAcceptance
      }
    },
    statePatch: {
      incidentId: incident.id,
      revision: stateRevision,
      activeRoute: dispatchAllowed ? clientWorkflowHandoff.statePatch.activeRoute : acknowledgementRoute,
      pendingAction: dispatchAllowed ? clientWorkflowHandoff.statePatch.pendingAction : 'acknowledge_blocking_proofs',
      banner: holdReason || clientWorkflowHandoff.statePatch.banner,
      disabledControls: dispatchAllowed
        ? clientWorkflowHandoff.statePatch.disabledControls
        : [...new Set([...clientWorkflowHandoff.statePatch.disabledControls, 'dispatch'])].sort()
    },
    audit: {
      id: proofId('client_acknowledgement_audit', {
        incidentId: incident.id,
        requestId: clientRuntime.requestId,
        missingAcknowledgements,
        dispatchAllowed,
        holdReason
      }),
      format: 'aios.panic-inspector.client-proof-acknowledgement.v1',
      generatedAt: now,
      actorId: principal.id,
      decision: dispatchAllowed ? 'dispatch_allowed' : 'dispatch_held_for_acknowledgement',
      holdReason
    }
  };
}

export function describePanicInspectorSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const principal = normalizePrincipal(input);
  const incident = normalizeIncident(input);
  const health = normalizeHealthSignal(input, incident);
  const validation = validateIncident(incident, health);
  const workspaceAccess = normalizeWorkspaceAccessPolicy(input, principal, incident);
  const boundary = decideBoundary(principal, incident, workspaceAccess);
  const scopeGuard = buildEffectiveScopeGuard(now, principal, incident, workspaceAccess, boundary);
  const handoff = buildAuditHandoff(now, principal, incident, boundary, scopeGuard);
  const operationalHealth = buildOperationalHealth(now, principal, incident, boundary, health, validation);
  const lifecycle = normalizeLifecycleSettings(input, incident, health);
  const lifecycleValidation = validateLifecycleSettings(now, lifecycle, principal, incident, validation, boundary, operationalHealth);
  const lifecycleControls = buildLifecycleControls(now, lifecycle, lifecycleValidation, incident, boundary, operationalHealth, handoff);
  const providerContract = normalizeProviderContract(input, incident);
  const providerNegotiation = negotiateProviderContract(providerContract, principal, incident, boundary, validation, operationalHealth, lifecycleControls, handoff, scopeGuard);
  const clientRuntime = normalizeClientRuntimeState(input, principal, incident);
  const clientWorkflowHandoff = buildClientWorkflowHandoff(
    now,
    clientRuntime,
    principal,
    incident,
    validation,
    boundary,
    operationalHealth,
    lifecycleControls,
    providerNegotiation,
    handoff
  );
  const persistedState = normalizePersistedInspectorState(input, now, principal, incident, lifecycleControls, clientRuntime);
  const persistedRecovery = buildPersistedRecoveryContract(
    now,
    persistedState,
    incident,
    validation,
    boundary,
    operationalHealth,
    lifecycleControls,
    providerNegotiation,
    clientWorkflowHandoff
  );
  const hostedKernelResume = buildHostedKernelResumePlan(
    now,
    incident,
    persistedRecovery,
    operationalHealth,
    lifecycleControls,
    providerNegotiation,
    clientWorkflowHandoff
  );
  const exportRequest = normalizeAnalyticsExportRequest(input, principal, incident);
  const decision = boundary.allowed
    && scopeGuard.valid
    && validation.valid
    && lifecycleValidation.valid
    && providerNegotiation.valid
    && clientWorkflowHandoff.valid
    && persistedRecovery.valid
    && hostedKernelResume.valid
    ? 'inspect_allowed'
    : 'inspect_blocked';
  const proofs = [
    {
      id: proofId('scope_proof', { principal, incident, boundary: boundary.scope }),
      type: 'workspace_scope',
      passed: boundary.scope.tenantIsolated && boundary.scope.workspaceIsolated
    },
    {
      id: boundary.proof.id,
      type: 'workspace_access_policy',
      passed: boundary.allowed
        && workspaceAccess.incidentWorkspaceGranted
        && workspaceAccess.deniedIncidentWorkspace === false
        && (workspaceAccess.crossWorkspaceEvidenceIds.length === 0 || workspaceAccess.crossWorkspaceEvidenceAllowed),
      decision: boundary.proof.decision,
      route: workspaceAccess.auditRoute
    },
    {
      id: scopeGuard.audit.id,
      type: 'effective_scope_guard',
      passed: scopeGuard.valid
        && scopeGuard.effectiveWorkspaceIds.includes(incident.workspaceId)
        && scopeGuard.evidencePolicy.allowedWorkspaceIds.includes(incident.workspaceId),
      route: scopeGuard.audit.route,
      redactedWorkspaceIds: scopeGuard.evidencePolicy.redactedWorkspaceIds,
      warnings: scopeGuard.warnings
    },
    {
      id: proofId('permission_proof', { principal, permissions: boundary.permissions }),
      type: 'role_permission',
      passed: boundary.permissions.canInspect
    },
    {
      id: proofId('handoff_proof', handoff),
      type: 'audit_handoff',
      passed: handoff.status === 'ready'
    },
    {
      id: proofId('health_proof', { incident, health, validation, operationalHealth }),
      type: 'operational_health',
      passed: validation.valid && operationalHealth.status === 'healthy'
    },
    {
      id: proofId('retry_proof', { incidentId: incident.id, retry: health.retry, retryable: operationalHealth.retryable }),
      type: 'retry_backoff',
      passed: operationalHealth.retryable ? health.retry.nextDelayMs > 0 : true
    },
    {
      id: operationalHealth.degradation.audit.id,
      type: 'operational_degradation',
      passed: operationalHealth.degradation.status === 'nominal'
        || operationalHealth.degradation.recoveryMode !== 'normal',
      route: operationalHealth.degradation.audit.route,
      recoveryMode: operationalHealth.degradation.recoveryMode,
      telemetryStale: operationalHealth.degradation.telemetry.stale,
      staleFailures: operationalHealth.degradation.counters.staleFailures
    },
    {
      id: proofId('lifecycle_settings_proof', { incidentId: incident.id, lifecycle, lifecycleValidation }),
      type: 'lifecycle_settings',
      passed: lifecycleValidation.valid && lifecycleControls.commandAccepted
    },
    {
      id: proofId('lifecycle_schedule_proof', { incidentId: incident.id, schedule: lifecycleControls.schedule, nextAction: lifecycleControls.nextAction }),
      type: 'lifecycle_schedule',
      passed: lifecycleControls.enabled ? lifecycleControls.schedule.nextInspectionAt !== null : lifecycleControls.schedule.disabledReason !== null
    },
    {
      id: lifecycleControls.transition.audit.id,
      type: 'lifecycle_transition',
      passed: lifecycleControls.transition.accepted === lifecycleControls.commandAccepted
        && lifecycleControls.transition.targetState.mode === lifecycleControls.mode
        && lifecycleControls.transition.settingsPatch.schedule.queuedRetries <= lifecycleControls.transition.settingsPatch.schedule.maxQueuedRetries,
      route: lifecycleControls.transition.schedulerDirective.route
    },
    {
      id: proofId('provider_contract_proof', { incidentId: incident.id, providerContract, providerNegotiation }),
      type: 'provider_contract',
      passed: providerNegotiation.valid && providerNegotiation.missingCapabilities.length === 0
    },
    {
      id: proofId('provider_sync_proof', { incidentId: incident.id, sync: providerNegotiation.sync }),
      type: 'provider_sync',
      passed: providerNegotiation.sync.status !== 'blocked'
    },
    {
      id: proofId('external_handoff_proof', { incidentId: incident.id, externalHandoff: providerNegotiation.externalHandoff }),
      type: 'external_handoff',
      passed: providerNegotiation.externalHandoff.state === 'not_requested'
        || providerNegotiation.externalHandoff.state === 'ready_to_dispatch'
    },
    {
      id: proofId('client_workflow_handoff_proof', { incidentId: incident.id, clientRuntime, clientWorkflowHandoff }),
      type: 'client_workflow_handoff',
      passed: clientWorkflowHandoff.valid
        && clientWorkflowHandoff.statePatch.incidentId === incident.id
        && clientWorkflowHandoff.request.id === clientRuntime.requestId
    },
    {
      id: proofId('persisted_recovery_proof', { incidentId: incident.id, persistedState, persistedRecovery }),
      type: 'persisted_recovery',
      passed: persistedRecovery.valid
        && persistedRecovery.storage.stateScopeMatches
        && persistedRecovery.restart.safeStatus !== 'restart_blocked'
        && persistedRecovery.statePatch.incidentId === incident.id
    },
    {
      id: hostedKernelResume.audit.id,
      type: 'hosted_kernel_resume',
      passed: hostedKernelResume.valid
        && hostedKernelResume.incidentId === incident.id
        && hostedKernelResume.storage.nextRevision === persistedRecovery.storage.nextRevision
        && hostedKernelResume.audit.subject.workspaceId === incident.workspaceId,
      route: hostedKernelResume.execution.route
    }
  ];
  const reporting = buildAnalyticsAndReporting(
    now,
    incident,
    validation,
    boundary,
    operationalHealth,
    handoff,
    proofs,
    normalizeHistorySnapshots(input, now, incident),
    lifecycleControls,
    providerNegotiation,
    exportRequest
  );
  proofs.push({
    id: proofId('analytics_export_proof', {
      incidentId: incident.id,
      exportRequest,
      exportSummary: reporting.exportSummary
    }),
    type: 'analytics_export',
    passed: reporting.exportSummary.manifest.ready
      && reporting.exportSummary.request.subject.incidentId === incident.id
      && reporting.exportSummary.manifest.recordCounts.snapshots <= reporting.history.snapshots.length,
    route: reporting.exportSummary.route
  });
  const previewContract = buildPreviewAcceptanceReadiness(
    now,
    input,
    principal,
    incident,
    validation,
    boundary,
    operationalHealth,
    lifecycleControls,
    providerNegotiation,
    handoff,
    proofs,
    reporting
  );
  const clientProofAcknowledgement = buildClientProofAcknowledgementContract(
    now,
    clientRuntime,
    principal,
    incident,
    proofs,
    previewContract,
    clientWorkflowHandoff
  );
  proofs.push({
    id: clientProofAcknowledgement.audit.id,
    type: 'client_proof_acknowledgement',
    passed: clientProofAcknowledgement.valid
      && clientProofAcknowledgement.dispatchGate.holdReason === null
      && clientProofAcknowledgement.statePatch.incidentId === incident.id,
    route: clientProofAcknowledgement.dispatchGate.route
  });

  return {
    ok: boundary.allowed
      && scopeGuard.valid
      && validation.valid
      && lifecycleValidation.valid
      && providerNegotiation.valid
      && clientWorkflowHandoff.valid
      && persistedRecovery.valid
      && hostedKernelResume.valid
      && clientProofAcknowledgement.valid
      && persistedRecovery.restart.safeStatus !== 'restart_blocked'
      && operationalHealth.status === 'healthy'
      && previewContract.readiness.status !== 'awaiting_acceptance'
      && previewContract.acceptance.state !== 'rejected',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel panic inspection with tenant/workspace boundaries and audit handoff',
    decision,
    principal: {
      id: principal.id,
      role: principal.role,
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      workspaceIds: principal.workspaceIds
    },
    incident,
    validation,
    workspaceAccess,
    scopeGuard,
    boundary,
    operationalHealth,
    lifecycleControls,
    providerContract,
    providerNegotiation,
    clientRuntime,
    clientWorkflowHandoff,
    clientProofAcknowledgement,
    persistedState,
    persistedRecovery,
    hostedKernelResume,
    auditHandoff: handoff,
    proofs,
    analytics: reporting.analytics,
    history: reporting.history,
    timeline: reporting.timeline,
    exportSummary: reporting.exportSummary,
    preview: previewContract.preview,
    acceptance: previewContract.acceptance,
    readiness: previewContract.readiness,
    validationSummary: previewContract.validationSummary,
    nextSteps: previewContract.nextSteps
  };
}

export default describePanicInspectorSurface;
