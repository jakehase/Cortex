import { createHash } from 'node:crypto';

export const surfaceId = "aios_audit-recovery_snapshot_073";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "snapshot";

const DEFAULT_ROUTE = '/audit-recovery/snapshot';
const MAX_EVIDENCE_ITEMS = 25;
const SNAPSHOT_SCHEMA_VERSION = 'audit-recovery.snapshot.v1';
const MAX_RECENT_COMMANDS = 12;
const MAX_RECOVERY_JOURNAL_ENTRIES = 16;
const MAX_HISTORY_SNAPSHOTS = 18;
const RECOVERY_ROUTE_PREFIX = '/audit-recovery';
const DEFAULT_TENANT_ID = 'tenant-default';
const DEFAULT_WORKSPACE_ID = 'workspace-default';
const SNAPSHOT_ARTIFACT_SCHEMA_VERSION = 'audit-recovery.snapshot.artifact.v1';
const MAX_RETRY_AFTER_SECONDS = 900;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_PROVIDER_SYNC_LAG_MS = 5 * 60 * 1000;
const CLIENT_RUNTIME_SCHEMA_VERSION = 'audit-recovery.snapshot.client-runtime.v1';
const MAX_CLIENT_ROUTE_STACK = 8;
const MAX_CLIENT_WORKFLOW_ACTIONS = 8;
const PREVIEW_ACCEPTANCE_SCHEMA_VERSION = 'audit-recovery.snapshot.preview-acceptance.v1';
const ROUTE_PREVIEW_CONTRACT_SCHEMA_VERSION = 'audit-recovery.snapshot.route-preview.v1';
const HANDOFF_RESUME_CONTRACT_SCHEMA_VERSION = 'audit-recovery.snapshot.handoff-resume.v1';
const PERSISTED_RESTART_PROJECTION_SCHEMA_VERSION = 'audit-recovery.snapshot.persisted-restart-projection.v1';
const MAX_PREVIEW_EVIDENCE = 5;
const MAX_NEXT_STEP_ITEMS = 6;
const MAX_ROUTE_BLOCKERS = 5;
const MAX_RESTART_BLOCKERS = 8;
const LIFECYCLE_CONTROL_SCHEMA_VERSION = 'audit-recovery.snapshot.lifecycle-control.v1';
const OPERATIONAL_HEALTH_SCHEMA_VERSION = 'audit-recovery.snapshot.operational-health.v1';
const MAX_HEALTH_REMEDIATION_ACTIONS = 8;
const MAX_DEPENDENCY_LATENCY_MS = 30 * 1000;
const MAX_HEALTH_CHECK_AGE_MS = 2 * 60 * 1000;
const MAX_DISABLE_REASON_LENGTH = 160;
const MAX_SCHEDULE_DRIFT_MS = 15 * 60 * 1000;
const SUPPORTED_SCHEDULE_INTERVALS = new Set(['manual', 'hourly', 'daily', 'weekly']);
const HEALTHY_DEPENDENCY_STATES = new Set(['ok', 'ready', 'available']);
const DEGRADED_DEPENDENCY_STATES = new Set(['degraded', 'slow', 'readonly', 'stale']);
const RECOVERY_RESUME_STATES = new Set(['ready-to-enqueue', 'waiting-for-queue', 'queued', 'pending', 'resume']);
const PROVIDER_SERVICE_CONTRACTS = Object.freeze({
  snapshotStore: {
    service: 'snapshot-store',
    apiVersion: 'audit-recovery.snapshot-store.v1',
    requiredCapabilities: ['snapshot.read', 'snapshot.write', 'checkpoint.commit']
  },
  auditLog: {
    service: 'audit-log',
    apiVersion: 'audit-recovery.audit-log.v1',
    requiredCapabilities: ['audit.append', 'proof.attach']
  },
  proofVerifier: {
    service: 'proof-verifier',
    apiVersion: 'audit-recovery.proof-verifier.v1',
    requiredCapabilities: ['proof.digest', 'proof.verify']
  },
  recoveryQueue: {
    service: 'recovery-queue',
    apiVersion: 'audit-recovery.recovery-queue.v1',
    requiredCapabilities: ['handoff.enqueue', 'handoff.status']
  }
});
const ROLE_CAPABILITIES = Object.freeze({
  owner: ['snapshot:capture', 'snapshot:recover', 'snapshot:handoff', 'workspace:cross-boundary'],
  admin: ['snapshot:capture', 'snapshot:recover', 'snapshot:handoff'],
  operator: ['snapshot:capture', 'snapshot:recover', 'snapshot:handoff'],
  auditor: ['snapshot:capture', 'snapshot:handoff'],
  viewer: []
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function proofDigest(payload) {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

function asString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value, fallback) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => asString(item)).filter(Boolean))].sort()
    : [];
}

function normalizeRouteStack(value) {
  const seen = new Set();
  const routes = [];

  for (const item of Array.isArray(value) ? value : []) {
    const route = asString(item);

    if (!route.startsWith('/') || seen.has(route)) {
      continue;
    }

    seen.add(route);
    routes.push(route);
  }

  return routes.slice(0, MAX_CLIENT_ROUTE_STACK);
}

function normalizeProviderInput(input, key, contract) {
  const providers = isPlainObject(input.providerContracts)
    ? input.providerContracts
    : (isPlainObject(input.providers) ? input.providers : {});
  const services = isPlainObject(input.services) ? input.services : {};
  const byKey = isPlainObject(providers[key]) ? providers[key] : {};
  const byService = isPlainObject(providers[contract.service]) ? providers[contract.service] : {};
  const serviceState = isPlainObject(services[key])
    ? services[key]
    : (isPlainObject(services[contract.service]) ? services[contract.service] : {});

  return { ...byService, ...serviceState, ...byKey };
}

function normalizeProviderContractEntry(input, key, request, generatedAt) {
  const contract = PROVIDER_SERVICE_CONTRACTS[key];
  const provider = normalizeProviderInput(input, key, contract);
  const capabilities = Array.isArray(provider.capabilities)
    ? normalizeStringList(provider.capabilities)
    : contract.requiredCapabilities;
  const missingCapabilities = contract.requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const declaredVersion = asString(provider.apiVersion, asString(provider.contractVersion, contract.apiVersion));
  const endpoint = asString(provider.endpoint, asString(provider.url));
  const sync = isPlainObject(provider.sync) ? provider.sync : {};
  const lagMs = Number.isSafeInteger(sync.lagMs)
    ? Math.max(0, sync.lagMs)
    : (Number.isSafeInteger(provider.syncLagMs) ? Math.max(0, provider.syncLagMs) : 0);
  const cursor = asString(sync.cursor, asString(provider.cursor));
  const writable = asBoolean(provider.writable, true);
  const reachable = asBoolean(provider.reachable, true);
  const stale = lagMs > MAX_PROVIDER_SYNC_LAG_MS || asBoolean(sync.stale, false);
  const versionCompatible = declaredVersion === contract.apiVersion;
  const accepted = reachable && writable && versionCompatible && missingCapabilities.length === 0;
  const status = accepted
    ? (stale ? 'compatible-stale' : 'compatible')
    : (!reachable
      ? 'unreachable'
      : (!writable
        ? 'readonly'
        : (!versionCompatible ? 'version-mismatch' : 'capability-missing')));

  return {
    key,
    service: contract.service,
    providerId: asString(provider.providerId, asString(provider.id, `${request.source}:${contract.service}`)),
    endpoint: endpoint || null,
    expectedApiVersion: contract.apiVersion,
    apiVersion: declaredVersion,
    status,
    accepted,
    requiredCapabilities: contract.requiredCapabilities,
    capabilities,
    missingCapabilities,
    sync: {
      state: stale ? 'stale' : 'current',
      cursor: cursor || null,
      lagMs,
      checkedAt: asString(sync.checkedAt, generatedAt),
      watermark: asString(sync.watermark, cursor || generatedAt)
    },
    handoff: {
      externalReference: asString(provider.externalReference, asString(provider.handoffId)),
      ackRequired: asBoolean(provider.ackRequired, key === 'recoveryQueue'),
      ackedAt: asString(provider.ackedAt),
      targetRoute: asString(provider.targetRoute, key === 'recoveryQueue' ? '/audit-recovery/recover' : '')
    }
  };
}

function buildProviderContracts({ input, request, generatedAt }) {
  const entries = Object.keys(PROVIDER_SERVICE_CONTRACTS)
    .map((key) => normalizeProviderContractEntry(input, key, request, generatedAt));
  const blocking = entries
    .filter((entry) => !entry.accepted)
    .map((entry) => ({
      service: entry.service,
      status: entry.status,
      missingCapabilities: entry.missingCapabilities,
      expectedApiVersion: entry.expectedApiVersion,
      apiVersion: entry.apiVersion
    }));
  const stale = entries.filter((entry) => entry.sync.state === 'stale');
  const capabilityMatrix = entries.reduce((matrix, entry) => {
    matrix[entry.service] = {
      accepted: entry.accepted,
      status: entry.status,
      capabilities: entry.capabilities,
      missingCapabilities: entry.missingCapabilities
    };
    return matrix;
  }, {});

  return {
    schemaVersion: 'audit-recovery.snapshot.provider-contracts.v1',
    generatedAt,
    negotiation: {
      status: blocking.length > 0 ? 'blocked' : (stale.length > 0 ? 'degraded' : 'ready'),
      acceptedServices: entries.filter((entry) => entry.accepted).map((entry) => entry.service),
      blockedServices: blocking.map((entry) => entry.service),
      staleServices: stale.map((entry) => entry.service)
    },
    services: entries,
    capabilityMatrix,
    sync: {
      maxAllowedLagMs: MAX_PROVIDER_SYNC_LAG_MS,
      maxObservedLagMs: entries.reduce((max, entry) => Math.max(max, entry.sync.lagMs), 0),
      cursors: entries.reduce((cursors, entry) => {
        cursors[entry.service] = entry.sync.cursor;
        return cursors;
      }, {})
    },
    blocking
  };
}

function normalizeLifecycleCommand(value) {
  const command = asString(value).toLowerCase();
  const aliases = {
    enable: 'enable-snapshots',
    'snapshot.enable': 'enable-snapshots',
    'snapshots.enable': 'enable-snapshots',
    disable: 'disable-snapshots',
    'snapshot.disable': 'disable-snapshots',
    'snapshots.disable': 'disable-snapshots',
    schedule: 'schedule-snapshot',
    'snapshot.schedule': 'schedule-snapshot',
    pause: 'pause-schedule',
    'schedule.pause': 'pause-schedule',
    resume: 'resume-schedule',
    'schedule.resume': 'resume-schedule'
  };

  return aliases[command] || command;
}

function normalizeScheduleTimestamp(value, generatedAt) {
  const timestamp = asString(value);
  const generatedTime = Date.parse(generatedAt);
  const runTime = timestamp ? Date.parse(timestamp) : NaN;

  return {
    value: timestamp || null,
    present: Boolean(timestamp),
    valid: Boolean(timestamp) && Number.isFinite(runTime),
    inFuture: Boolean(timestamp) && Number.isFinite(runTime) && (!Number.isFinite(generatedTime) || runTime > generatedTime),
    epochMs: Number.isFinite(runTime) ? runTime : null
  };
}

function normalizeDisableControl(settings, input, request, generatedAt) {
  const disableInput = isPlainObject(settings.disable)
    ? settings.disable
    : (isPlainObject(input.disable) ? input.disable : {});
  const rawReason = asString(
    disableInput.reason,
    asString(settings.disableReason, asString(input.disableReason, asString(input.reason)))
  );
  const reason = rawReason.slice(0, MAX_DISABLE_REASON_LENGTH);
  const effectiveUntil = normalizeScheduleTimestamp(disableInput.effectiveUntil ?? settings.disabledUntil, generatedAt);
  const requestedBy = asString(disableInput.requestedBy, request.actor.id);
  const emergency = asBoolean(disableInput.emergency, asBoolean(settings.emergencyDisable, false));

  return {
    reason,
    reasonRequired: true,
    reasonTruncated: rawReason.length > reason.length,
    requestedBy,
    emergency,
    effectiveUntil: effectiveUntil.value,
    effectiveUntilValid: !effectiveUntil.present || effectiveUntil.valid,
    auditToken: proofDigest({
      reason,
      requestedBy,
      emergency,
      effectiveUntil: effectiveUntil.value,
      actorRole: request.actor.role,
      generatedAt
    }).slice(0, 24)
  };
}

function normalizeMaintenanceWindow(scheduleInput, generatedAt) {
  const windowInput = isPlainObject(scheduleInput.maintenanceWindow)
    ? scheduleInput.maintenanceWindow
    : (isPlainObject(scheduleInput.window) ? scheduleInput.window : {});
  const start = normalizeScheduleTimestamp(windowInput.startAt, generatedAt);
  const end = normalizeScheduleTimestamp(windowInput.endAt, generatedAt);
  const generatedTime = Date.parse(generatedAt);
  const hasWindow = start.present || end.present;
  const valid = !hasWindow
    || (start.valid && end.valid && start.epochMs < end.epochMs);
  const active = valid
    && Number.isFinite(generatedTime)
    && start.epochMs !== null
    && end.epochMs !== null
    && start.epochMs <= generatedTime
    && generatedTime <= end.epochMs;

  return {
    configured: hasWindow,
    startAt: start.value,
    endAt: end.value,
    valid,
    active,
    reason: asString(windowInput.reason, asString(scheduleInput.maintenanceReason)),
    blocksAutomatedRuns: asBoolean(windowInput.blocksAutomatedRuns, true)
  };
}

function buildScheduleDriftState({ scheduleEnabled, schedulePaused, interval, scheduleTimestamp, generatedAt }) {
  const generatedTime = Date.parse(generatedAt);
  const lagMs = scheduleEnabled
    && !schedulePaused
    && scheduleTimestamp.epochMs !== null
    && Number.isFinite(generatedTime)
    ? Math.max(0, generatedTime - scheduleTimestamp.epochMs)
    : 0;
  const drifted = lagMs > MAX_SCHEDULE_DRIFT_MS;

  return {
    state: !scheduleEnabled || interval === 'manual'
      ? 'not-scheduled'
      : (schedulePaused
        ? 'paused'
        : (drifted ? 'overdue' : 'on-time')),
    lagMs,
    maxAllowedLagMs: MAX_SCHEDULE_DRIFT_MS,
    missedRun: drifted,
    nextRunAt: scheduleTimestamp.value
  };
}

function buildLifecycleCommandEnvelope({ knownCommand, rawCommand, request, generatedAt, disableControl, interval, scheduleTimestamp }) {
  const commandId = knownCommand
    ? proofDigest({
      command: knownCommand,
      requestedCommand: rawCommand,
      requestId: request.requestId,
      actorId: request.actor.id,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      disableAuditToken: disableControl.auditToken,
      interval,
      nextRunAt: scheduleTimestamp.value
    }).slice(0, 24)
    : null;

  return {
    commandId,
    requestedBy: request.actor.id,
    actorRole: request.actor.role,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    idempotencyScope: commandId ? `${request.tenantId}:${request.workspaceId}:${knownCommand}` : null,
    issuedAt: generatedAt,
    proof: {
      algorithm: 'sha256',
      digest: proofDigest({
        commandId,
        rawCommand,
        knownCommand,
        requestId: request.requestId,
        disableAuditToken: disableControl.auditToken,
        interval,
        nextRunAt: scheduleTimestamp.value
      }),
      covers: ['commandId', 'requestId', 'actor', 'disableAuditToken', 'schedule']
    }
  };
}

function buildLifecycleControlPlan({
  knownCommand,
  rawCommand,
  request,
  previousEnabled,
  previousScheduleEnabled,
  previousPaused,
  enabled,
  scheduleEnabled,
  schedulePaused,
  interval,
  retentionDays,
  requestedRetention,
  scheduleTimestamp,
  maintenanceWindow,
  scheduleDrift,
  disableControl,
  generatedAt,
  errors,
  warnings
}) {
  const transitionErrors = [];
  const transitionWarnings = [];

  if (knownCommand === 'schedule-snapshot' && interval === 'manual') {
    transitionErrors.push('schedule-command-requires-automated-interval');
  }

  if (knownCommand === 'schedule-snapshot' && !scheduleTimestamp.present) {
    transitionErrors.push('schedule-command-requires-next-run-at');
  } else if ((knownCommand === 'schedule-snapshot' || knownCommand === 'resume-schedule')
    && scheduleTimestamp.present && !scheduleTimestamp.valid) {
    transitionErrors.push('schedule-next-run-at-invalid');
  } else if ((knownCommand === 'schedule-snapshot' || knownCommand === 'resume-schedule')
    && scheduleTimestamp.valid && !scheduleTimestamp.inFuture) {
    transitionErrors.push('schedule-next-run-at-not-future');
  }

  if ((knownCommand === 'pause-schedule' || knownCommand === 'resume-schedule') && !previousScheduleEnabled) {
    transitionErrors.push('schedule-control-requires-enabled-schedule');
  }

  if (knownCommand === 'pause-schedule' && previousPaused) {
    transitionWarnings.push('schedule-already-paused');
  }

  if (knownCommand === 'resume-schedule' && !previousPaused) {
    transitionWarnings.push('schedule-already-running');
  }

  if (knownCommand === 'enable-snapshots' && previousEnabled) {
    transitionWarnings.push('snapshots-already-enabled');
  }

  if (knownCommand === 'disable-snapshots' && !previousEnabled) {
    transitionWarnings.push('snapshots-already-disabled');
  }

  if (knownCommand === 'disable-snapshots' && !disableControl.reason) {
    transitionErrors.push('disable-command-requires-audit-reason');
  }

  if (!disableControl.effectiveUntilValid) {
    transitionErrors.push('disable-effective-until-invalid');
  }

  if (maintenanceWindow.configured && !maintenanceWindow.valid) {
    transitionErrors.push('schedule-maintenance-window-invalid');
  }

  if (scheduleEnabled && !schedulePaused && maintenanceWindow.active && maintenanceWindow.blocksAutomatedRuns) {
    transitionWarnings.push('schedule-run-blocked-by-maintenance-window');
  }

  if (scheduleDrift.state === 'overdue') {
    transitionWarnings.push('schedule-next-run-overdue');
  }

  if (scheduleEnabled && interval === 'manual') {
    transitionWarnings.push('manual-interval-disables-automation');
  }

  const commandEnvelope = buildLifecycleCommandEnvelope({
    knownCommand,
    rawCommand,
    request,
    generatedAt,
    disableControl,
    interval,
    scheduleTimestamp
  });
  const canApply = Boolean(knownCommand)
    && errors.length === 0
    && transitionErrors.length === 0;
  const effect = {
    enabled,
    scheduleEnabled,
    schedulePaused,
    interval,
    retentionDays
  };
  const previous = {
    enabled: previousEnabled,
    scheduleEnabled: previousScheduleEnabled,
    schedulePaused: previousPaused,
    retentionDays: Number.isSafeInteger(requestedRetention) ? requestedRetention : null
  };
  const digestInput = {
    schemaVersion: LIFECYCLE_CONTROL_SCHEMA_VERSION,
    command: knownCommand || null,
    previous,
    effect,
    commandEnvelope,
    maintenanceWindow,
    scheduleDrift,
    disableControl,
    transitionErrors,
    validationErrors: errors,
    generatedAt
  };

  return {
    schemaVersion: LIFECYCLE_CONTROL_SCHEMA_VERSION,
    generatedAt,
    command: knownCommand || null,
    requestedCommand: rawCommand || null,
    canApply,
    state: !rawCommand
      ? 'idle'
      : (!knownCommand
        ? 'ignored'
        : (canApply ? 'ready-to-apply' : 'blocked')),
    previous,
    effect,
    commandEnvelope,
    disableControl,
    scheduleWindow: {
      nextRunAt: scheduleTimestamp.value,
      nextRunAtValid: scheduleTimestamp.valid,
      nextRunAtInFuture: scheduleTimestamp.inFuture,
      maintenance: maintenanceWindow,
      drift: scheduleDrift
    },
    transitionValidation: {
      errors: transitionErrors,
      warnings: transitionWarnings
    },
    audit: {
      algorithm: 'sha256',
      digest: proofDigest(digestInput),
      covers: ['command', 'previous', 'effect', 'commandEnvelope', 'disableControl', 'scheduleWindow', 'transitionValidation', 'validationErrors']
    }
  };
}

function normalizeLifecycleSettings(input, request, generatedAt) {
  const rootSettings = isPlainObject(input.settings) ? input.settings : {};
  const settings = isPlainObject(input.lifecycleSettings)
    ? input.lifecycleSettings
    : (isPlainObject(rootSettings.snapshot) ? rootSettings.snapshot : {});
  const scheduleInput = isPlainObject(settings.schedule) ? settings.schedule : {};
  const rawCommand = normalizeLifecycleCommand(input.lifecycleCommand ?? input.command ?? input.action);
  const knownCommand = [
    'enable-snapshots',
    'disable-snapshots',
    'schedule-snapshot',
    'pause-schedule',
    'resume-schedule'
  ].includes(rawCommand) ? rawCommand : '';
  const errors = [];
  const warnings = [];
  const requestedRetention = settings.retentionDays ?? settings.retention?.days;
  const retentionDays = asInteger(requestedRetention, DEFAULT_RETENTION_DAYS);
  const requestedInterval = asString(scheduleInput.interval, asString(settings.scheduleInterval, 'manual')).toLowerCase();

  if (requestedRetention !== undefined && !Number.isSafeInteger(requestedRetention)) {
    errors.push('retention-days-not-integer');
  } else if (retentionDays < MIN_RETENTION_DAYS || retentionDays > MAX_RETENTION_DAYS) {
    errors.push('retention-days-out-of-range');
  }

  if (!SUPPORTED_SCHEDULE_INTERVALS.has(requestedInterval)) {
    errors.push('unsupported-schedule-interval');
  }

  if (rawCommand && !knownCommand) {
    warnings.push('unknown-lifecycle-command-ignored');
  }

  const previousEnabled = asBoolean(settings.enabled, true);
  const previousScheduleEnabled = asBoolean(scheduleInput.enabled, requestedInterval !== 'manual');
  const previousPaused = asBoolean(scheduleInput.paused, false);
  const enabled = knownCommand === 'enable-snapshots'
    ? true
    : (knownCommand === 'disable-snapshots' ? false : previousEnabled);
  const scheduleEnabled = knownCommand === 'schedule-snapshot'
    ? true
    : (knownCommand === 'disable-snapshots' ? false : previousScheduleEnabled);
  const schedulePaused = knownCommand === 'pause-schedule'
    ? true
    : (knownCommand === 'resume-schedule' ? false : previousPaused);
  const interval = SUPPORTED_SCHEDULE_INTERVALS.has(requestedInterval) ? requestedInterval : 'manual';
  const scheduleTimestamp = normalizeScheduleTimestamp(scheduleInput.nextRunAt, generatedAt);
  const maintenanceWindow = normalizeMaintenanceWindow(scheduleInput, generatedAt);
  const scheduleDrift = buildScheduleDriftState({
    scheduleEnabled,
    schedulePaused,
    interval,
    scheduleTimestamp,
    generatedAt
  });
  const disableControl = normalizeDisableControl(settings, input, request, generatedAt);
  const controlPlan = buildLifecycleControlPlan({
    knownCommand,
    rawCommand,
    request,
    previousEnabled,
    previousScheduleEnabled,
    previousPaused,
    enabled,
    scheduleEnabled,
    schedulePaused,
    interval,
    retentionDays,
    requestedRetention,
    scheduleTimestamp,
    maintenanceWindow,
    scheduleDrift,
    disableControl,
    generatedAt,
    errors,
    warnings
  });
  const allErrors = [...errors, ...controlPlan.transitionValidation.errors];
  const allWarnings = [...warnings, ...controlPlan.transitionValidation.warnings];
  const captureAllowed = enabled && !schedulePaused && allErrors.length === 0;
  const nextRunAt = scheduleTimestamp.value;
  const commandAccepted = controlPlan.canApply;

  return {
    schemaVersion: 'audit-recovery.snapshot.lifecycle.v1',
    generatedAt,
    enabled,
    captureAllowed,
    command: {
      requested: rawCommand || null,
      normalized: knownCommand || null,
      accepted: commandAccepted,
      rejectedReason: rawCommand && !knownCommand
        ? 'unknown-command'
        : (allErrors.length > 0 ? 'settings-validation-failed' : null)
    },
    controls: controlPlan,
    retention: {
      days: Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, retentionDays)),
      minDays: MIN_RETENTION_DAYS,
      maxDays: MAX_RETENTION_DAYS
    },
    schedule: {
      enabled: scheduleEnabled,
      interval,
      paused: schedulePaused,
      timezone: asString(scheduleInput.timezone, 'UTC'),
      nextRunAt: scheduleEnabled && !schedulePaused ? nextRunAt : null,
      drift: scheduleDrift,
      maintenanceWindow
    },
    disableControl: {
      reason: disableControl.reason || null,
      reasonRequired: disableControl.reasonRequired,
      reasonTruncated: disableControl.reasonTruncated,
      requestedBy: disableControl.requestedBy,
      emergency: disableControl.emergency,
      effectiveUntil: disableControl.effectiveUntil,
      auditToken: disableControl.auditToken
    },
    validation: {
      state: allErrors.length > 0 ? 'invalid' : (allWarnings.length > 0 ? 'warning' : 'valid'),
      errors: allErrors,
      warnings: allWarnings
    },
    nextAction: !enabled
      ? 'enable-snapshots'
      : (allErrors.length > 0
        ? 'fix-lifecycle-settings'
        : (schedulePaused
          ? 'resume-schedule'
          : (maintenanceWindow.active && maintenanceWindow.blocksAutomatedRuns
            ? 'wait-for-maintenance-window'
            : (scheduleDrift.state === 'overdue'
              ? 'run-overdue-snapshot'
              : (scheduleEnabled ? 'await-scheduled-capture' : 'capture-now')))))
  };
}

function normalizeActorCapabilities(actor) {
  const role = asString(actor.role, 'operator').toLowerCase();
  const roleCapabilities = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.viewer;
  const granted = new Set([...roleCapabilities, ...normalizeStringList(actor.permissions)]);

  return {
    role,
    granted: [...granted].sort()
  };
}

function normalizeRequest(input) {
  const request = isPlainObject(input.request) ? input.request : {};
  const headers = isPlainObject(request.headers) ? request.headers : {};
  const actor = isPlainObject(input.actor)
    ? input.actor
    : (isPlainObject(request.actor) ? request.actor : {});
  const route = asString(request.route, asString(input.route, DEFAULT_ROUTE));
  const actorCapabilities = normalizeActorCapabilities(actor);

  return {
    requestId: asString(request.requestId, asString(input.requestId, `snapshot-${proofDigest({ route, at: input.now || '' }).slice(0, 12)}`)),
    route,
    method: asString(request.method, 'POST').toUpperCase(),
    source: asString(request.source, asString(input.source, 'hosted-kernel')),
    clientSessionId: asString(request.clientSessionId, asString(input.clientSessionId, 'anonymous-session')),
    tenantId: asString(request.tenantId, asString(headers['x-aios-tenant-id'], asString(input.tenantId, DEFAULT_TENANT_ID))),
    workspaceId: asString(request.workspaceId, asString(headers['x-aios-workspace-id'], asString(input.workspaceId, DEFAULT_WORKSPACE_ID))),
    actor: {
      id: asString(actor.id, 'anonymous'),
      role: actorCapabilities.role,
      capabilities: actorCapabilities.granted
    },
    headers: {
      traceparent: asString(headers.traceparent),
      referer: asString(headers.referer)
    }
  };
}

function normalizeBoundaryPolicy(input, request, clientState) {
  const tenant = isPlainObject(input.tenant) ? input.tenant : {};
  const workspace = isPlainObject(input.workspace) ? input.workspace : {};
  const allowedTenantIds = normalizeStringList(tenant.allowedTenantIds).concat(request.tenantId);
  const allowedWorkspaceIds = normalizeStringList(workspace.allowedWorkspaceIds).concat(request.workspaceId);
  const tenantId = asString(tenant.id, request.tenantId);
  const workspaceId = asString(workspace.id, request.workspaceId);
  const requestedTarget = clientState.recovery.target;
  const capabilities = new Set(request.actor.capabilities);
  const crossWorkspaceRequested = requestedTarget !== 'current-workspace' && requestedTarget !== workspaceId;
  const violations = [];

  if (!allowedTenantIds.includes(tenantId) || tenantId !== request.tenantId) {
    violations.push('tenant-mismatch');
  }

  if (!allowedWorkspaceIds.includes(workspaceId) || workspaceId !== request.workspaceId) {
    violations.push('workspace-mismatch');
  }

  if (!capabilities.has('snapshot:capture')) {
    violations.push('missing-snapshot-capture-permission');
  }

  if (clientState.recovery.handoffRequested && !capabilities.has('snapshot:handoff')) {
    violations.push('missing-snapshot-handoff-permission');
  }

  if (clientState.recovery.handoffRequested && !capabilities.has('snapshot:recover')) {
    violations.push('missing-snapshot-recover-permission');
  }

  if (crossWorkspaceRequested && !capabilities.has('workspace:cross-boundary')) {
    violations.push('cross-workspace-target-denied');
  }

  return {
    tenantId,
    workspaceId,
    requestTenantId: request.tenantId,
    requestWorkspaceId: request.workspaceId,
    actorRole: request.actor.role,
    actorCapabilities: request.actor.capabilities,
    requestedTarget,
    crossWorkspaceRequested,
    decision: violations.length === 0 ? 'allow' : 'deny',
    violations,
    auditPartition: `${tenantId}:${workspaceId}`
  };
}

function normalizeClientRuntime(input, state, request, generatedAt) {
  const runtime = isPlainObject(input.clientRuntime)
    ? input.clientRuntime
    : (isPlainObject(state.runtime) ? state.runtime : (isPlainObject(input.runtime) ? input.runtime : {}));
  const navigation = isPlainObject(runtime.navigation) ? runtime.navigation : {};
  const routeStackInput = Array.isArray(navigation.routeStack)
    ? navigation.routeStack
    : (Array.isArray(runtime.routeStack) ? runtime.routeStack : []);
  const routeStack = normalizeRouteStack([request.route, ...routeStackInput]);
  const cache = isPlainObject(runtime.cache) ? runtime.cache : {};
  const localCheckpoint = isPlainObject(runtime.localCheckpoint)
    ? runtime.localCheckpoint
    : (isPlainObject(cache.snapshotCheckpoint) ? cache.snapshotCheckpoint : {});
  const pendingHandoff = isPlainObject(runtime.pendingHandoff)
    ? runtime.pendingHandoff
    : (isPlainObject(cache.pendingHandoff) ? cache.pendingHandoff : {});
  const dirty = asBoolean(localCheckpoint.dirty, false)
    || asBoolean(cache.dirty, false)
    || asString(localCheckpoint.proofDigest) !== asString(cache.serverProofDigest, asString(localCheckpoint.proofDigest));

  return {
    schemaVersion: CLIENT_RUNTIME_SCHEMA_VERSION,
    generatedAt,
    clientSessionId: request.clientSessionId,
    currentRoute: request.route,
    routeStack,
    viewStateKey: asString(runtime.viewStateKey, `snapshot:${request.tenantId}:${request.workspaceId}:${request.clientSessionId}`),
    localCheckpoint: {
      snapshotId: asString(localCheckpoint.snapshotId, asString(cache.snapshotId)),
      proofDigest: asString(localCheckpoint.proofDigest, asString(cache.proofDigest)),
      cursor: asString(localCheckpoint.cursor, asString(cache.cursor)),
      generation: asInteger(localCheckpoint.generation, 0),
      dirty
    },
    pendingHandoff: {
      id: asString(pendingHandoff.id, asString(pendingHandoff.handoffId)),
      status: asString(pendingHandoff.status, pendingHandoff.id ? 'pending' : 'none'),
      snapshotId: asString(pendingHandoff.snapshotId),
      targetRoute: asString(pendingHandoff.targetRoute, '/audit-recovery/review'),
      createdAt: asString(pendingHandoff.createdAt)
    },
    ui: {
      pane: asString(runtime.pane, 'snapshot'),
      selectedTab: asString(runtime.selectedTab, 'overview'),
      toastChannel: asString(runtime.toastChannel, 'audit-recovery')
    }
  };
}

function normalizeClientState(input, request, generatedAt) {
  const state = isPlainObject(input.clientState) ? input.clientState : {};
  const recovery = isPlainObject(state.recovery) ? state.recovery : {};
  const selectedSnapshot = isPlainObject(state.selectedSnapshot) ? state.selectedSnapshot : {};
  const workflow = isPlainObject(state.workflow) ? state.workflow : {};
  const intent = asString(state.intent, asString(input.intent, 'capture'));

  return {
    view: asString(state.view, 'audit-recovery.snapshot'),
    intent,
    selectedSnapshot: {
      id: asString(selectedSnapshot.id),
      label: asString(selectedSnapshot.label),
      capturedAt: asString(selectedSnapshot.capturedAt)
    },
    recovery: {
      mode: asString(recovery.mode, 'preview'),
      target: asString(recovery.target, 'current-workspace'),
      handoffRequested: recovery.handoffRequested === true || input.handoff === true
    },
    workflow: {
      step: asString(workflow.step, intent === 'recover' ? 'handoff-review' : 'capture-review'),
      handoffMode: asString(workflow.handoffMode, recovery.handoffRequested || input.handoff === true ? 'enqueue' : 'review'),
      returnRoute: asString(workflow.returnRoute, '/audit-recovery/snapshot'),
      optimisticCommit: asBoolean(workflow.optimisticCommit, false)
    },
    runtime: normalizeClientRuntime(input, state, request, generatedAt)
  };
}

function buildClientWorkflowHandoff({ request, clientState, evidence, snapshotId, boundary, lifecycleSettings, providerContracts, operationalHealth, canContinue, destination, resumeContract, generatedAt }) {
  const healthBlocked = !operationalHealth.canAcceptSnapshot || operationalHealth.dependencies.recoveryQueue === 'failed';
  const lifecycleBlocked = !lifecycleSettings.enabled || lifecycleSettings.schedule.paused || lifecycleSettings.validation.errors.length > 0;
  const providerBlocked = providerContracts.negotiation.blockedServices.includes('recovery-queue');
  const actions = [];

  if (resumeContract?.clientPrompt?.visible) {
    actions.push({
      id: 'resume-pending-recovery',
      type: 'navigate',
      label: 'Resume pending recovery',
      route: resumeContract.route.targetRoute,
      enabled: resumeContract.resume.enabled,
      reason: resumeContract.resume.reason,
      resumeToken: resumeContract.resume.token
    });
  }

  if (evidence.length === 0) {
    actions.push({
      id: 'attach-evidence',
      type: 'open-panel',
      label: 'Attach audit evidence',
      route: '/audit-recovery/snapshot/evidence',
      enabled: boundary.decision === 'allow',
      reason: 'recovery handoff requires at least one evidence item'
    });
  }

  if (lifecycleBlocked) {
    actions.push({
      id: 'resolve-lifecycle',
      type: 'open-panel',
      label: 'Resolve lifecycle controls',
      route: '/audit-recovery/snapshot/settings',
      enabled: true,
      reason: lifecycleSettings.nextAction
    });
  }

  if (healthBlocked && operationalHealth.retryPolicy.retryable) {
    actions.push({
      id: 'retry-health-check',
      type: 'retry',
      label: 'Retry hosted-kernel health check',
      route: request.route,
      enabled: true,
      retryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
      reason: operationalHealth.failureState?.code || 'dependency-retryable'
    });
  }

  actions.push({
    id: canContinue && clientState.recovery.handoffRequested ? 'enqueue-recovery-handoff' : 'open-review',
    type: canContinue && clientState.recovery.handoffRequested ? 'enqueue' : 'navigate',
    label: canContinue && clientState.recovery.handoffRequested ? 'Queue recovery handoff' : 'Open snapshot review',
    route: destination,
    enabled: boundary.decision === 'allow' && !providerBlocked && operationalHealth.canAcceptSnapshot,
    reason: canContinue ? 'snapshot is ready for client workflow handoff' : 'snapshot remains in review workflow'
  });

  if (operationalHealth.degradedMode) {
    actions.push({
      id: 'acknowledge-degraded-mode',
      type: 'acknowledge',
      label: 'Acknowledge degraded mode',
      route: destination,
      enabled: canContinue,
      reason: 'provider or dependency health is degraded'
    });
  }

  return {
    schemaVersion: 'audit-recovery.snapshot.client-workflow.v1',
    generatedAt,
    clientSessionId: request.clientSessionId,
    viewStateKey: clientState.runtime.viewStateKey,
    currentRoute: request.route,
    destination,
    returnRoute: clientState.workflow.returnRoute,
    step: canContinue
      ? (clientState.recovery.handoffRequested ? 'handoff-ready' : 'review-ready')
      : (boundary.decision === 'allow' ? 'needs-attention' : 'blocked'),
    handoffMode: clientState.workflow.handoffMode,
    optimisticCommit: clientState.workflow.optimisticCommit && operationalHealth.canAcceptSnapshot,
    localCheckpointState: clientState.runtime.localCheckpoint.dirty ? 'dirty' : 'clean',
    routeStack: clientState.runtime.routeStack,
    pendingHandoff: clientState.runtime.pendingHandoff,
    resumeContract: resumeContract
      ? {
        schemaVersion: resumeContract.schemaVersion,
        state: resumeContract.state,
        routeState: resumeContract.route.state,
        targetRoute: resumeContract.route.targetRoute,
        resumeEnabled: resumeContract.resume.enabled,
        token: resumeContract.resume.token,
        blockers: resumeContract.resume.blockers
      }
      : null,
    actions: actions.slice(0, MAX_CLIENT_WORKFLOW_ACTIONS),
    proof: {
      actionDigest: proofDigest({ snapshotId, destination, actions, resumeContract }).slice(0, 24),
      covers: ['destination', 'actions', 'localCheckpointState', 'pendingHandoff', 'resumeContract']
    }
  };
}

function normalizeEvidenceItem(item, index, generatedAt) {
  if (typeof item === 'string') {
    return {
      id: `evidence-${index + 1}`,
      type: 'note',
      source: 'client',
      capturedAt: generatedAt,
      summary: item.trim(),
      digest: proofDigest({ index, item })
    };
  }

  const source = isPlainObject(item) ? item : {};
  const payload = isPlainObject(source.payload) ? source.payload : {};
  const summary = asString(source.summary, asString(source.label, `Evidence ${index + 1}`));

  return {
    id: asString(source.id, `evidence-${index + 1}`),
    type: asString(source.type, 'artifact'),
    source: asString(source.source, 'hosted-kernel'),
    capturedAt: asString(source.capturedAt, generatedAt),
    summary,
    payload,
    digest: asString(source.digest, proofDigest({ index, summary, payload }))
  };
}

function normalizeEvidence(input, generatedAt) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  return evidence
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item, index) => normalizeEvidenceItem(item, index, generatedAt))
    .filter((item) => item.summary.length > 0);
}

function normalizeRecoveryJournalEntry(item, index) {
  const entry = isPlainObject(item) ? item : {};
  const snapshotId = asString(entry.snapshotId, asString(entry.id));
  const event = asString(entry.event, 'snapshot.checkpoint');
  const status = asString(entry.status, 'unknown');
  const checkpointCursor = asString(entry.checkpointCursor, asString(entry.cursor));
  const commandKey = asString(entry.commandKey, asString(entry.idempotencyKey));
  const previousDigest = asString(entry.previousDigest);
  const recordedAt = asString(entry.recordedAt, asString(entry.acceptedAt));
  const expectedDigest = proofDigest({
    snapshotId,
    event,
    status,
    checkpointCursor,
    commandKey,
    previousDigest,
    recordedAt
  });
  const digest = asString(entry.digest, expectedDigest);

  return {
    sequence: Number.isSafeInteger(entry.sequence) && entry.sequence >= 0 ? entry.sequence : index + 1,
    snapshotId,
    event,
    status,
    checkpointCursor,
    commandKey,
    previousDigest: previousDigest || null,
    recordedAt,
    digest,
    verified: digest === expectedDigest
  };
}

function normalizePendingRecovery(value) {
  const pending = isPlainObject(value) ? value : {};
  const requested = asBoolean(pending.requested, false) || Boolean(asString(pending.snapshotId));

  return {
    requested,
    snapshotId: asString(pending.snapshotId),
    targetRoute: asString(pending.targetRoute, '/audit-recovery/recover'),
    mode: asString(pending.mode, requested ? 'resume' : 'none'),
    status: requested ? asString(pending.status, 'pending') : 'none',
    idempotencyKey: asString(pending.idempotencyKey),
    queuedAt: asString(pending.queuedAt),
    lastAttemptAt: asString(pending.lastAttemptAt),
    attempts: normalizeRetryAttempt(pending.attempts),
    resumeCursor: asString(pending.resumeCursor, asString(pending.cursor))
  };
}

function normalizeRecoveryLease(value, { activeSnapshotId, pendingSnapshotId, generatedAt }) {
  const lease = isPlainObject(value) ? value : {};
  const expiresAt = asString(lease.expiresAt, asString(lease.deadlineAt));
  const generatedTime = Date.parse(generatedAt);
  const expiryTime = Date.parse(expiresAt);
  const expired = Boolean(expiresAt)
    && Number.isFinite(generatedTime)
    && Number.isFinite(expiryTime)
    && expiryTime <= generatedTime;
  const snapshotId = asString(lease.snapshotId, asString(pendingSnapshotId, activeSnapshotId));
  const holder = asString(lease.holder, asString(lease.owner, 'hosted-kernel'));

  return {
    holder,
    snapshotId,
    status: expired ? 'expired' : asString(lease.status, snapshotId ? 'held' : 'none'),
    acquiredAt: asString(lease.acquiredAt, asString(lease.createdAt)),
    expiresAt: expiresAt || null,
    expired,
    fencingToken: asString(lease.fencingToken, snapshotId
      ? proofDigest({ holder, snapshotId, expiresAt }).slice(0, 20)
      : ''),
    attempts: normalizeRetryAttempt(lease.attempts ?? lease.recoveryAttempts)
  };
}

function buildRestartProjection({ storageKey, bootId, activeSnapshot, checkpoint, pendingRecovery, recoveryJournal, integrity, recoveryLease, generatedAt }) {
  const hasActiveSnapshot = Boolean(activeSnapshot.id);
  const hasProofDigest = Boolean(activeSnapshot.proofDigest);
  const hasCheckpointCursor = Boolean(checkpoint.cursor);
  const latestJournal = recoveryJournal[0] || null;
  const latestJournalMatchesActive = !hasActiveSnapshot || latestJournal?.snapshotId === activeSnapshot.id;
  const pendingMatchesActive = !pendingRecovery.requested
    || !pendingRecovery.snapshotId
    || pendingRecovery.snapshotId === activeSnapshot.id;
  const leaseMatchesActive = !recoveryLease.snapshotId
    || !activeSnapshot.id
    || recoveryLease.snapshotId === activeSnapshot.id;
  const canResumePending = pendingRecovery.requested
    && RECOVERY_RESUME_STATES.has(pendingRecovery.status)
    && Boolean(pendingRecovery.resumeCursor)
    && Boolean(pendingRecovery.idempotencyKey);
  const blockers = [
    integrity.status !== 'verified' ? `integrity-${integrity.status}` : '',
    !hasActiveSnapshot ? 'active-snapshot-missing' : '',
    !hasProofDigest ? 'active-snapshot-proof-missing' : '',
    !hasCheckpointCursor ? 'checkpoint-cursor-missing' : '',
    latestJournalMatchesActive ? '' : 'latest-journal-not-active-snapshot',
    pendingMatchesActive ? '' : 'pending-recovery-snapshot-mismatch',
    leaseMatchesActive ? '' : 'recovery-lease-snapshot-mismatch',
    recoveryLease.expired ? 'recovery-lease-expired' : '',
    pendingRecovery.requested && !pendingRecovery.idempotencyKey ? 'pending-recovery-idempotency-missing' : '',
    pendingRecovery.requested && !pendingRecovery.resumeCursor ? 'pending-recovery-cursor-missing' : ''
  ].filter(Boolean).slice(0, MAX_RESTART_BLOCKERS);
  const command = blockers.length > 0
    ? 'reconcile-persisted-state'
    : (canResumePending ? 'resume-pending-recovery' : (hasActiveSnapshot ? 'review-active-snapshot' : 'capture-snapshot'));
  const resumeToken = blockers.length === 0
    ? proofDigest({
      schemaVersion: PERSISTED_RESTART_PROJECTION_SCHEMA_VERSION,
      storageKey,
      bootId,
      snapshotId: activeSnapshot.id,
      checkpointCursor: checkpoint.cursor,
      proofDigest: activeSnapshot.proofDigest,
      pendingRecoveryKey: pendingRecovery.idempotencyKey,
      leaseToken: recoveryLease.fencingToken
    }).slice(0, 28)
    : null;
  const status = blockers.length > 0
    ? 'blocked'
    : (canResumePending ? 'resume-ready' : (hasActiveSnapshot ? 'review-ready' : 'idle'));
  const projection = {
    schemaVersion: PERSISTED_RESTART_PROJECTION_SCHEMA_VERSION,
    generatedAt,
    status,
    restartSafe: blockers.length === 0 && hasCheckpointCursor && hasProofDigest,
    command,
    storageKey,
    bootId,
    snapshotId: activeSnapshot.id || null,
    checkpointCursor: checkpoint.cursor || null,
    checkpointGeneration: checkpoint.generation,
    pendingRecoveryStatus: pendingRecovery.status,
    pendingRecoveryRequested: pendingRecovery.requested,
    resumeToken,
    blockers,
    recoveryLease: {
      holder: recoveryLease.holder,
      status: recoveryLease.status,
      snapshotId: recoveryLease.snapshotId || null,
      expiresAt: recoveryLease.expiresAt,
      expired: recoveryLease.expired,
      fencingToken: recoveryLease.fencingToken || null,
      attempts: recoveryLease.attempts
    },
    journal: {
      latestDigest: integrity.latestJournalDigest,
      latestSnapshotId: latestJournal?.snapshotId || null,
      entryCount: integrity.journalEntryCount,
      verified: integrity.journalVerified
    }
  };

  return {
    ...projection,
    proof: {
      algorithm: 'sha256',
      digest: proofDigest(projection),
      covers: ['status', 'command', 'snapshotId', 'checkpointCursor', 'pendingRecoveryStatus', 'recoveryLease', 'journal', 'blockers']
    }
  };
}

function normalizePersistedState(input) {
  const persisted = isPlainObject(input.persistedState) ? input.persistedState : {};
  const activeSnapshot = isPlainObject(persisted.activeSnapshot) ? persisted.activeSnapshot : {};
  const checkpoint = isPlainObject(persisted.checkpoint) ? persisted.checkpoint : {};
  const recentCommands = Array.isArray(persisted.recentCommands) ? persisted.recentCommands : [];
  const recoveryJournal = (Array.isArray(persisted.recoveryJournal) ? persisted.recoveryJournal : [])
    .slice(0, MAX_RECOVERY_JOURNAL_ENTRIES)
    .map((item, index) => normalizeRecoveryJournalEntry(item, index));
  const pendingRecovery = normalizePendingRecovery(persisted.pendingRecovery);
  const verifiedJournal = recoveryJournal.every((entry) => entry.verified);
  const activeJournalEntry = recoveryJournal.find((entry) => entry.snapshotId === asString(activeSnapshot.id));
  const generatedAt = asString(input.now, new Date(0).toISOString());
  const shapedActiveSnapshot = {
    id: asString(activeSnapshot.id),
    status: asString(activeSnapshot.status),
    proofDigest: asString(activeSnapshot.proofDigest)
  };
  const shapedCheckpoint = {
    cursor: asString(checkpoint.cursor),
    generation: Number.isSafeInteger(checkpoint.generation) && checkpoint.generation >= 0
      ? checkpoint.generation
      : 0
  };
  const recoveryLease = normalizeRecoveryLease(persisted.recoveryLease ?? persisted.restartLease, {
    activeSnapshotId: shapedActiveSnapshot.id,
    pendingSnapshotId: pendingRecovery.snapshotId,
    generatedAt
  });
  const integrity = {
    journalVerified: verifiedJournal,
    journalEntryCount: recoveryJournal.length,
    activeSnapshotJournaled: Boolean(!activeSnapshot.id || activeJournalEntry),
    latestJournalDigest: recoveryJournal[0]?.digest || null,
    status: verifiedJournal && (!activeSnapshot.id || activeJournalEntry)
      ? 'verified'
      : (verifiedJournal ? 'active-snapshot-missing-journal-entry' : 'journal-digest-mismatch')
  };
  const storageKey = asString(persisted.storageKey, 'aios:audit-recovery:snapshot');
  const bootId = asString(persisted.bootId, asString(input.bootId, 'boot-unknown'));

  return {
    schemaVersion: asString(persisted.schemaVersion, SNAPSHOT_SCHEMA_VERSION),
    storageKey,
    bootId,
    lastCommittedAt: asString(persisted.lastCommittedAt),
    activeSnapshot: shapedActiveSnapshot,
    checkpoint: shapedCheckpoint,
    recentCommands: recentCommands
      .slice(0, MAX_RECENT_COMMANDS)
      .map((item, index) => {
        const command = isPlainObject(item) ? item : {};
        return {
          idempotencyKey: asString(command.idempotencyKey, `legacy-command-${index + 1}`),
          command: asString(command.command, 'unknown'),
          snapshotId: asString(command.snapshotId),
          acceptedAt: asString(command.acceptedAt),
          resultDigest: asString(command.resultDigest)
        };
      })
      .filter((command) => command.idempotencyKey.length > 0),
    recoveryJournal,
    pendingRecovery,
    recoveryLease,
    integrity,
    restartProjection: buildRestartProjection({
      storageKey,
      bootId,
      activeSnapshot: shapedActiveSnapshot,
      checkpoint: shapedCheckpoint,
      pendingRecovery,
      recoveryJournal,
      integrity,
      recoveryLease,
      generatedAt
    })
  };
}

function countBy(items, selectKey) {
  return items.reduce((counts, item) => {
    const key = asString(selectKey(item), 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeHistorySnapshot(item, index, generatedAt) {
  const snapshot = isPlainObject(item) ? item : {};
  const id = asString(snapshot.id, asString(snapshot.snapshotId, `history-snapshot-${index + 1}`));
  const status = asString(snapshot.status, 'unknown');
  const capturedAt = asString(snapshot.capturedAt, asString(snapshot.generatedAt, asString(snapshot.committedAt, generatedAt)));
  const proofDigestValue = asString(snapshot.proofDigest, asString(snapshot.digest));

  return {
    id,
    status,
    capturedAt,
    tenantId: asString(snapshot.tenantId, DEFAULT_TENANT_ID),
    workspaceId: asString(snapshot.workspaceId, DEFAULT_WORKSPACE_ID),
    evidenceCount: Number.isSafeInteger(snapshot.evidenceCount) && snapshot.evidenceCount >= 0
      ? snapshot.evidenceCount
      : 0,
    recoveryStatus: asString(snapshot.recoveryStatus, 'unknown'),
    proofDigest: proofDigestValue,
    rowDigest: proofDigest({
      id,
      status,
      capturedAt,
      proofDigestValue,
      index
    }).slice(0, 20)
  };
}

function collectHistorySnapshots({ input, persistedState, nextPersistedState, snapshotId, auditProofDigest, generatedAt, boundary, evidence, operationalHealth }) {
  const history = isPlainObject(input.history) ? input.history : {};
  const sourceSnapshots = Array.isArray(history.snapshots)
    ? history.snapshots
    : (Array.isArray(input.snapshotHistory) ? input.snapshotHistory : []);
  const historical = sourceSnapshots
    .slice(0, MAX_HISTORY_SNAPSHOTS)
    .map((item, index) => normalizeHistorySnapshot(item, index, generatedAt));
  const previous = persistedState.activeSnapshot.id
    ? [normalizeHistorySnapshot({
      id: persistedState.activeSnapshot.id,
      status: persistedState.activeSnapshot.status || 'previous-active',
      capturedAt: persistedState.lastCommittedAt,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      evidenceCount: persistedState.recentCommands.filter((command) => command.snapshotId === persistedState.activeSnapshot.id).length,
      recoveryStatus: 'previous',
      proofDigest: persistedState.activeSnapshot.proofDigest
    }, historical.length, generatedAt)]
    : [];
  const current = normalizeHistorySnapshot({
    id: snapshotId,
    status: nextPersistedState.activeSnapshot.status,
    capturedAt: generatedAt,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    evidenceCount: evidence.length,
    recoveryStatus: operationalHealth.canAcceptSnapshot ? 'current' : 'blocked',
    proofDigest: auditProofDigest
  }, historical.length + previous.length, generatedAt);
  const byId = new Map();

  for (const snapshot of [...historical, ...previous, current]) {
    byId.set(snapshot.id, snapshot);
  }

  return [...byId.values()]
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
    .slice(0, MAX_HISTORY_SNAPSHOTS);
}

function buildSnapshotTimeline({ request, clientState, boundary, evidence, lifecycleSettings, providerContracts, operationalHealth, idempotentCommand, nextPersistedState, recoveryPaths, handoff, generatedAt }) {
  const evidenceEvent = evidence.length > 0
    ? {
      at: generatedAt,
      event: 'snapshot.evidence-attached',
      state: 'recorded',
      count: evidence.length,
      evidenceDigests: evidence.map((item) => item.digest)
    }
    : {
      at: generatedAt,
      event: 'snapshot.evidence-missing',
      state: 'awaiting-evidence',
      count: 0,
      evidenceDigests: []
    };

  return [
    {
      at: generatedAt,
      event: 'snapshot.request-normalized',
      state: request.method,
      route: request.route,
      requestId: request.requestId
    },
    {
      at: generatedAt,
      event: 'snapshot.boundary-decision',
      state: boundary.decision,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      violations: boundary.violations
    },
    {
      at: lifecycleSettings.generatedAt,
      event: 'snapshot.lifecycle-settings-evaluated',
      state: lifecycleSettings.validation.state,
      enabled: lifecycleSettings.enabled,
      captureAllowed: lifecycleSettings.captureAllowed,
      scheduleInterval: lifecycleSettings.schedule.interval,
      controlState: lifecycleSettings.controls.state,
      controlDigest: lifecycleSettings.controls.audit.digest,
      nextAction: lifecycleSettings.nextAction
    },
    {
      at: providerContracts.generatedAt,
      event: 'snapshot.provider-contracts-negotiated',
      state: providerContracts.negotiation.status,
      acceptedServices: providerContracts.negotiation.acceptedServices,
      blockedServices: providerContracts.negotiation.blockedServices,
      staleServices: providerContracts.negotiation.staleServices,
      maxObservedLagMs: providerContracts.sync.maxObservedLagMs
    },
    evidenceEvent,
    {
      at: operationalHealth.checkedAt,
      event: 'snapshot.health-checked',
      state: operationalHealth.state,
      dependencyStates: operationalHealth.dependencies,
      dependencyProbeSummary: operationalHealth.dependencyProbes.summary,
      actionableErrorCount: operationalHealth.actionableErrors.length
    },
    {
      at: idempotentCommand.acceptedAt,
      event: `command.${idempotentCommand.command}`,
      state: idempotentCommand.status,
      idempotencyKey: idempotentCommand.idempotencyKey,
      replaySafe: idempotentCommand.replaySafe
    },
    {
      at: nextPersistedState.lastCommittedAt,
      event: 'snapshot.checkpoint-shaped',
      state: nextPersistedState.activeSnapshot.status,
      checkpointCursor: nextPersistedState.checkpoint.cursor,
      generation: nextPersistedState.checkpoint.generation,
      journalDigest: nextPersistedState.integrity.latestJournalDigest,
      pendingRecoveryStatus: nextPersistedState.pendingRecovery.status,
      restartProjectionStatus: nextPersistedState.restartProjection.status,
      restartProjectionSafe: nextPersistedState.restartProjection.restartSafe,
      restartBlockerCount: nextPersistedState.restartProjection.blockers.length
    },
    {
      at: generatedAt,
      event: 'snapshot.recovery-path-evaluated',
      state: recoveryPaths.recover.status,
      restartStatus: recoveryPaths.restart.status,
      handoffStatus: handoff.status
    },
    {
      at: handoff.clientWorkflow.generatedAt,
      event: 'snapshot.client-workflow-shaped',
      state: handoff.clientWorkflow.step,
      clientSessionId: request.clientSessionId,
      viewStateKey: clientState.runtime.viewStateKey,
      actionCount: handoff.clientWorkflow.actions.length,
      actionDigest: handoff.clientWorkflow.proof.actionDigest
    },
    {
      at: handoff.resumeContract.generatedAt,
      event: 'snapshot.handoff-resume-contract-shaped',
      state: handoff.resumeContract.state,
      routeState: handoff.resumeContract.route.state,
      targetRoute: handoff.resumeContract.route.targetRoute,
      resumeEnabled: handoff.resumeContract.resume.enabled,
      blockerCount: handoff.resumeContract.resume.blockers.length,
      auditDigest: handoff.resumeContract.audit.digest
    }
  ];
}

function buildAnalyticsReport({ input, request, clientState, boundary, evidence, persistedState, nextPersistedState, snapshotId, auditProofDigest, lifecycleSettings, providerContracts, operationalHealth, idempotentCommand, recoveryPaths, handoff, generatedAt }) {
  const historySnapshots = collectHistorySnapshots({
    input,
    persistedState,
    nextPersistedState,
    snapshotId,
    auditProofDigest,
    generatedAt,
    boundary,
    evidence,
    operationalHealth
  });
  const timeline = buildSnapshotTimeline({
    request,
    clientState,
    boundary,
    evidence,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    idempotentCommand,
    nextPersistedState,
    recoveryPaths,
    handoff,
    generatedAt
  });
  const dependencyCounts = countBy(Object.values(operationalHealth.dependencies), (state) => state);
  const counters = {
    evidenceTotal: evidence.length,
    evidenceByType: countBy(evidence, (item) => item.type),
    actionableErrorsTotal: operationalHealth.actionableErrors.length,
    actionableErrorsBySeverity: countBy(operationalHealth.actionableErrors, (item) => item.severity),
    actionableErrorsByDomain: countBy(operationalHealth.actionableErrors, (item) => item.domain),
    healthRetryableErrorTotal: operationalHealth.actionableErrors.filter((item) => item.retryable).length,
    healthCaptureBlockingTotal: operationalHealth.actionableErrors.filter((item) => item.blocksCapture).length,
    healthHandoffBlockingTotal: operationalHealth.actionableErrors.filter((item) => item.blocksHandoff).length,
    healthRemediationActionTotal: operationalHealth.remediationPlan.length,
    healthQueueHandoffReadyTotal: operationalHealth.canQueueRecoveryHandoff ? 1 : 0,
    boundaryViolationTotal: boundary.violations.length,
    lifecycleSettingsErrorTotal: lifecycleSettings.validation.errors.length,
    lifecycleCommandAcceptedTotal: lifecycleSettings.command.accepted ? 1 : 0,
    lifecycleControlBlockedTotal: lifecycleSettings.controls.state === 'blocked' ? 1 : 0,
    lifecycleControlReadyTotal: lifecycleSettings.controls.state === 'ready-to-apply' ? 1 : 0,
    lifecycleCaptureAllowedTotal: lifecycleSettings.captureAllowed ? 1 : 0,
    lifecycleScheduleOverdueTotal: lifecycleSettings.schedule.drift.state === 'overdue' ? 1 : 0,
    lifecycleMaintenanceWindowActiveTotal: lifecycleSettings.schedule.maintenanceWindow.active ? 1 : 0,
    lifecycleDisableReasonMissingTotal: lifecycleSettings.command.normalized === 'disable-snapshots'
      && !lifecycleSettings.disableControl.reason ? 1 : 0,
    clientWorkflowActionTotal: handoff.clientWorkflow.actions.length,
    clientWorkflowEnabledActionTotal: handoff.clientWorkflow.actions.filter((action) => action.enabled).length,
    clientRuntimeDirtyCheckpointTotal: clientState.runtime.localCheckpoint.dirty ? 1 : 0,
    handoffResumeReadyTotal: handoff.resumeContract.resume.enabled ? 1 : 0,
    handoffResumeBlockedTotal: handoff.resumeContract.state === 'resume-blocked' ? 1 : 0,
    handoffResumeBlockerTotal: handoff.resumeContract.resume.blockers.length,
    handoffResumePromptVisibleTotal: handoff.resumeContract.clientPrompt.visible ? 1 : 0,
    providerContractBlockedTotal: providerContracts.blocking.length,
    providerContractStaleTotal: providerContracts.negotiation.staleServices.length,
    providerContractAcceptedTotal: providerContracts.negotiation.acceptedServices.length,
    dependencyStates: dependencyCounts,
    healthStaleProbeTotal: operationalHealth.dependencyProbes.summary.stale.length,
    healthTimedOutProbeTotal: operationalHealth.dependencyProbes.summary.timedOut.length,
    healthCircuitOpenProbeTotal: operationalHealth.dependencyProbes.summary.circuitOpen.length,
    healthCaptureCriticalProbeTotal: operationalHealth.dependencyProbes.summary.captureCriticalAttention.length,
    healthHandoffCriticalProbeTotal: operationalHealth.dependencyProbes.summary.handoffCriticalAttention.length,
    historySnapshotTotal: historySnapshots.length,
    replayableCommandTotal: persistedState.recentCommands.filter((command) => command.resultDigest).length,
    restartReadyTotal: recoveryPaths.restart.status.startsWith('resume-ready') ? 1 : 0,
    persistedJournalEntryTotal: nextPersistedState.integrity.journalEntryCount,
    persistedJournalVerifiedTotal: nextPersistedState.integrity.journalVerified ? 1 : 0,
    pendingRecoveryTotal: nextPersistedState.pendingRecovery.requested ? 1 : 0,
    persistedRestartBlockedTotal: nextPersistedState.restartProjection.status === 'blocked' ? 1 : 0,
    persistedRestartResumeReadyTotal: nextPersistedState.restartProjection.status === 'resume-ready' ? 1 : 0,
    persistedRestartBlockerTotal: nextPersistedState.restartProjection.blockers.length,
    idempotencyConflictTotal: idempotentCommand.status === 'idempotency-conflict' ? 1 : 0,
    exportRowTotal: timeline.length + historySnapshots.length
  };
  const exportRows = [
    ...historySnapshots.map((snapshot) => ({
      type: 'history-snapshot',
      id: snapshot.id,
      at: snapshot.capturedAt,
      state: snapshot.status,
      digest: snapshot.rowDigest,
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId
    })),
    ...timeline.map((event, index) => ({
      type: 'timeline-event',
      id: `${event.event}-${index + 1}`,
      at: event.at,
      state: event.state,
      digest: proofDigest(event).slice(0, 20),
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId
    }))
  ];
  const summary = {
    schemaVersion: 'audit-recovery.snapshot.analytics.v1',
    snapshotId,
    generatedAt,
    requestId: request.requestId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorRole: request.actor.role,
    intent: clientState.intent,
    lifecycleNextAction: lifecycleSettings.nextAction,
    lifecycleEnabled: lifecycleSettings.enabled,
    lifecycleScheduleInterval: lifecycleSettings.schedule.interval,
    lifecycleScheduleDriftState: lifecycleSettings.schedule.drift.state,
    lifecycleMaintenanceWindowActive: lifecycleSettings.schedule.maintenanceWindow.active,
    lifecycleDisableAuditToken: lifecycleSettings.disableControl.auditToken,
    lifecycleControlState: lifecycleSettings.controls.state,
    lifecycleControlDigest: lifecycleSettings.controls.audit.digest,
    providerNegotiationStatus: providerContracts.negotiation.status,
    providerMaxObservedLagMs: providerContracts.sync.maxObservedLagMs,
    boundaryDecision: boundary.decision,
    healthState: operationalHealth.state,
    healthMode: operationalHealth.mode,
    healthPrimaryFailureCode: operationalHealth.failureState?.primaryCode || null,
    healthRetryAfterSeconds: operationalHealth.retryPolicy.retryAfterSeconds,
    healthProbeDigest: proofDigest(operationalHealth.dependencyProbes).slice(0, 24),
    canQueueRecoveryHandoff: operationalHealth.canQueueRecoveryHandoff,
    commandStatus: idempotentCommand.status,
    handoffStatus: handoff.status,
    handoffResumeState: handoff.resumeContract.state,
    handoffResumeRouteState: handoff.resumeContract.route.state,
    handoffResumeEnabled: handoff.resumeContract.resume.enabled,
    handoffResumeAuditDigest: handoff.resumeContract.audit.digest,
    clientWorkflowStep: handoff.clientWorkflow.step,
    clientWorkflowActionDigest: handoff.clientWorkflow.proof.actionDigest,
    restartStatus: recoveryPaths.restart.status,
    recoverStatus: recoveryPaths.recover.status,
    checkpointGeneration: nextPersistedState.checkpoint.generation,
    checkpointCursor: nextPersistedState.checkpoint.cursor,
    persistenceIntegrityStatus: nextPersistedState.integrity.status,
    pendingRecoveryStatus: nextPersistedState.pendingRecovery.status,
    persistedRestartProjectionStatus: nextPersistedState.restartProjection.status,
    persistedRestartProjectionCommand: nextPersistedState.restartProjection.command,
    persistedRestartProjectionDigest: nextPersistedState.restartProjection.proof.digest,
    counters
  };
  const reportDigest = proofDigest({ summary, exportRows });

  return {
    summary,
    counters,
    historySnapshots,
    timeline,
    exports: {
      format: 'jsonl-compatible',
      primaryKey: 'digest',
      rowCount: exportRows.length,
      rows: exportRows,
      summaryDigest: reportDigest
    },
    audit: {
      algorithm: 'sha256',
      reportDigest,
      proofDigest: auditProofDigest,
      covers: ['summary', 'historySnapshots', 'timeline', 'exports.rows']
    }
  };
}

function buildProviderWriteIntent({ service, status, accepted, sync, handoff }, payloadDigest, generatedAt) {
  const writeMode = service === 'snapshot-store'
    ? 'commit-checkpoint'
    : (service === 'audit-log'
      ? 'append-proof'
      : (service === 'proof-verifier' ? 'verify-digest' : 'enqueue-handoff'));

  return {
    service,
    writeMode,
    accepted,
    status,
    payloadDigest,
    syncCursor: sync.cursor,
    watermark: sync.watermark,
    targetRoute: handoff.targetRoute || null,
    externalReference: handoff.externalReference || null,
    ackRequired: handoff.ackRequired,
    ackedAt: handoff.ackedAt || null,
    generatedAt
  };
}

function buildSnapshotArtifactContract({ request, clientState, evidence, snapshotId, auditProofDigest, nextPersistedState, lifecycleSettings, providerContracts, operationalHealth, recoveryPaths, handoff, analytics, generatedAt }) {
  const sections = {
    checkpoint: {
      storageKey: nextPersistedState.storageKey,
      generation: nextPersistedState.checkpoint.generation,
      cursor: nextPersistedState.checkpoint.cursor,
      activeSnapshot: nextPersistedState.activeSnapshot,
      pendingRecovery: nextPersistedState.pendingRecovery,
      recoveryLease: nextPersistedState.recoveryLease,
      restartProjection: nextPersistedState.restartProjection
    },
    proof: {
      algorithm: 'sha256',
      digest: auditProofDigest,
      journalDigest: nextPersistedState.integrity.latestJournalDigest,
      analyticsDigest: analytics.exports.summaryDigest
    },
    recovery: {
      restartStatus: recoveryPaths.restart.status,
      recoverStatus: recoveryPaths.recover.status,
      handoffStatus: handoff.status,
      destination: handoff.destination,
      externalHandoff: handoff.externalHandoff,
      resumeContract: {
        schemaVersion: handoff.resumeContract.schemaVersion,
        state: handoff.resumeContract.state,
        route: handoff.resumeContract.route,
        resume: handoff.resumeContract.resume,
        queuePayload: handoff.resumeContract.queuePayload,
        auditDigest: handoff.resumeContract.audit.digest
      }
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      captureAllowed: lifecycleSettings.captureAllowed,
      retentionDays: lifecycleSettings.retention.days,
      schedule: lifecycleSettings.schedule,
      disableControl: lifecycleSettings.disableControl,
      command: lifecycleSettings.command,
      controls: {
        schemaVersion: lifecycleSettings.controls.schemaVersion,
        state: lifecycleSettings.controls.state,
        canApply: lifecycleSettings.controls.canApply,
        effect: lifecycleSettings.controls.effect,
        transitionValidation: lifecycleSettings.controls.transitionValidation,
        audit: lifecycleSettings.controls.audit
      },
      validation: lifecycleSettings.validation,
      nextAction: lifecycleSettings.nextAction
    },
    clientRuntime: {
      sessionId: request.clientSessionId,
      viewStateKey: clientState.runtime.viewStateKey,
      routeStack: clientState.runtime.routeStack,
      localCheckpointState: clientState.runtime.localCheckpoint.dirty ? 'dirty' : 'clean',
      workflowStep: handoff.clientWorkflow.step,
      resumePromptVisible: handoff.resumeContract.clientPrompt.visible,
      resumeTargetRoute: handoff.resumeContract.route.targetRoute
    },
    health: {
      schemaVersion: operationalHealth.schemaVersion,
      state: operationalHealth.state,
      mode: operationalHealth.mode,
      canAcceptSnapshot: operationalHealth.canAcceptSnapshot,
      canQueueRecoveryHandoff: operationalHealth.canQueueRecoveryHandoff,
      degradedMode: operationalHealth.degradedMode,
      dependencies: operationalHealth.dependencies,
      dependencyProbes: operationalHealth.dependencyProbes,
      degradedCapabilities: operationalHealth.degradedCapabilities,
      retryPolicy: operationalHealth.retryPolicy,
      remediationPlan: operationalHealth.remediationPlan,
      failureState: operationalHealth.failureState
    }
  };
  const sectionDigests = Object.entries(sections).reduce((digests, [name, section]) => {
    digests[name] = proofDigest(section);
    return digests;
  }, {});
  const evidenceDigest = proofDigest(evidence.map((item) => ({
    id: item.id,
    type: item.type,
    source: item.source,
    digest: item.digest
  })));
  const payloadDigest = proofDigest({
    schemaVersion: SNAPSHOT_ARTIFACT_SCHEMA_VERSION,
    snapshotId,
    requestId: request.requestId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    evidenceDigest,
    sectionDigests
  });
  const providerWrites = providerContracts.services.map((entry) => buildProviderWriteIntent(entry, payloadDigest, generatedAt));
  const missingSections = Object.entries(sections)
    .filter(([, section]) => !isPlainObject(section) || Object.keys(section).length === 0)
    .map(([name]) => name);
  const blockedWrites = providerWrites
    .filter((write) => !write.accepted)
    .map((write) => ({
      service: write.service,
      status: write.status,
      writeMode: write.writeMode
    }));
  const requiredEvidenceSatisfied = evidence.length > 0 || recoveryPaths.recover.status === 'needs-snapshot-evidence';
  const exportable = operationalHealth.canAcceptSnapshot
    && nextPersistedState.integrity.status === 'verified'
    && missingSections.length === 0
    && requiredEvidenceSatisfied;

  return {
    schemaVersion: SNAPSHOT_ARTIFACT_SCHEMA_VERSION,
    generatedAt,
    snapshotId,
    requestId: request.requestId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    contentType: 'application/vnd.aios.audit-recovery.snapshot+json',
    exportable,
    state: exportable
      ? (blockedWrites.length > 0 ? 'exportable-with-provider-blockers' : 'exportable')
      : (operationalHealth.canAcceptSnapshot ? 'incomplete' : 'blocked'),
    sections,
    sectionDigests,
    evidenceDigest,
    payloadDigest,
    providerWrites,
    validation: {
      status: exportable && blockedWrites.length === 0 ? 'valid' : 'attention-required',
      missingSections,
      blockedWrites,
      requiredEvidenceSatisfied,
      persistenceIntegrity: nextPersistedState.integrity.status,
      restartProjectionStatus: nextPersistedState.restartProjection.status,
      restartProjectionBlockers: nextPersistedState.restartProjection.blockers,
      healthState: operationalHealth.state,
      healthMode: operationalHealth.mode,
      canQueueRecoveryHandoff: operationalHealth.canQueueRecoveryHandoff,
      healthRemediationCount: operationalHealth.remediationPlan.length,
      primaryFailureCode: operationalHealth.failureState?.primaryCode || null,
      lifecycleValidationState: lifecycleSettings.validation.state
    },
    proof: {
      algorithm: 'sha256',
      digest: proofDigest({
        snapshotId,
        payloadDigest,
        sectionDigests,
        providerWrites,
        validationState: operationalHealth.state
      }),
      covers: ['sections', 'sectionDigests', 'evidenceDigest', 'providerWrites', 'validation']
    }
  };
}

function normalizeDependencyHealth(value, fallback = 'ok') {
  const source = isPlainObject(value)
    ? (value.state ?? value.status ?? value.health ?? value.availability)
    : value;
  const raw = asString(source, fallback).toLowerCase();

  if (HEALTHY_DEPENDENCY_STATES.has(raw)) {
    return 'ok';
  }

  if (DEGRADED_DEPENDENCY_STATES.has(raw)) {
    return 'degraded';
  }

  if (raw === 'missing' || raw === 'disabled' || raw === 'unavailable' || raw === 'down' || raw === 'failed') {
    return 'failed';
  }

  return fallback;
}

function normalizeDependencyProbe(name, value, generatedAt) {
  const probe = isPlainObject(value) ? value : {};
  const observedAt = asString(probe.observedAt, asString(probe.checkedAt, asString(probe.lastSeenAt, generatedAt)));
  const generatedTime = Date.parse(generatedAt);
  const observedTime = Date.parse(observedAt);
  const observedAgeMs = Number.isFinite(generatedTime) && Number.isFinite(observedTime)
    ? Math.max(0, generatedTime - observedTime)
    : null;
  const latencyMs = Number.isSafeInteger(probe.latencyMs)
    ? Math.max(0, probe.latencyMs)
    : (Number.isSafeInteger(probe.durationMs) ? Math.max(0, probe.durationMs) : 0);
  const state = normalizeDependencyHealth(value);
  const stale = asBoolean(probe.stale, false)
    || (observedAgeMs !== null && observedAgeMs > MAX_HEALTH_CHECK_AGE_MS);
  const timeout = asBoolean(probe.timeout, asBoolean(probe.timedOut, false))
    || latencyMs > MAX_DEPENDENCY_LATENCY_MS;
  const circuitOpen = asBoolean(probe.circuitOpen, false);
  const captureCritical = name === 'snapshotStore' || name === 'auditLog';
  const handoffCritical = name === 'recoveryQueue';

  return {
    name,
    state,
    observedAt,
    observedAgeMs,
    latencyMs,
    stale,
    timeout,
    circuitOpen,
    captureCritical,
    handoffCritical,
    providerKey: name,
    evidence: {
      probeId: asString(probe.probeId, `${name}:${proofDigest({ name, observedAt, state }).slice(0, 10)}`),
      region: asString(probe.region, asString(probe.zone, 'hosted-kernel')),
      source: asString(probe.source, 'kernel-health'),
      message: asString(probe.message)
    }
  };
}

function buildDependencyProbeContract(dependencies, generatedAt) {
  const probes = {
    snapshotStore: normalizeDependencyProbe('snapshotStore', dependencies.snapshotStore ?? dependencies.storage, generatedAt),
    auditLog: normalizeDependencyProbe('auditLog', dependencies.auditLog, generatedAt),
    proofVerifier: normalizeDependencyProbe('proofVerifier', dependencies.proofVerifier, generatedAt),
    recoveryQueue: normalizeDependencyProbe('recoveryQueue', dependencies.recoveryQueue, generatedAt)
  };
  const stale = Object.values(probes).filter((probe) => probe.stale).map((probe) => probe.name);
  const timedOut = Object.values(probes).filter((probe) => probe.timeout).map((probe) => probe.name);
  const circuitOpen = Object.values(probes).filter((probe) => probe.circuitOpen).map((probe) => probe.name);

  return {
    schemaVersion: 'audit-recovery.snapshot.dependency-probes.v1',
    generatedAt,
    maxAllowedAgeMs: MAX_HEALTH_CHECK_AGE_MS,
    maxAllowedLatencyMs: MAX_DEPENDENCY_LATENCY_MS,
    probes,
    summary: {
      stale,
      timedOut,
      circuitOpen,
      captureCriticalAttention: Object.values(probes)
        .filter((probe) => probe.captureCritical && (probe.state === 'failed' || probe.timeout || probe.circuitOpen))
        .map((probe) => probe.name),
      handoffCriticalAttention: Object.values(probes)
        .filter((probe) => probe.handoffCritical && (probe.state !== 'ok' || probe.timeout || probe.circuitOpen || probe.stale))
        .map((probe) => probe.name)
    }
  };
}

function normalizeRetryAttempt(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 10) : 0;
}

function buildRetryPolicy({ input, request, failureCount }) {
  const retry = isPlainObject(input.retry) ? input.retry : {};
  const attempt = normalizeRetryAttempt(retry.attempt ?? input.retryAttempt);
  const retryable = failureCount > 0;
  const retryAfterSeconds = retryable
    ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(5, (2 ** attempt) * 5))
    : 0;

  return {
    retryable,
    attempt,
    retryAfterSeconds,
    nextIdempotencyHint: retryable
      ? proofDigest({
        requestId: request.requestId,
        clientSessionId: request.clientSessionId,
        attempt: attempt + 1
      }).slice(0, 18)
      : null,
    backoff: retryable ? 'exponential-jitter-compatible' : 'none'
  };
}

function classifyOperationalError(error) {
  const code = asString(error.code, 'SNAPSHOT_UNKNOWN_ERROR');
  const severity = asString(error.severity, 'error');
  const domain = code.includes('BOUNDARY')
    ? 'boundary'
    : (code.includes('LIFECYCLE')
      ? 'lifecycle'
      : (code.includes('PROVIDER')
        ? 'provider-contract'
        : (code.includes('EVIDENCE')
          ? 'evidence'
          : (code.includes('ROUTE') ? 'route' : 'dependency'))));

  return {
    ...error,
    code,
    severity,
    retryable: error.retryable === true,
    domain,
    blocksCapture: severity === 'error',
    blocksHandoff: severity === 'error'
      || code.includes('RECOVERY_QUEUE')
      || code.includes('EVIDENCE')
      || code.includes('SCHEDULE_PAUSED'),
    operatorVisible: severity !== 'info' || domain === 'evidence'
  };
}

function routeForHealthAction(error, request) {
  if (error.domain === 'lifecycle') {
    return `${RECOVERY_ROUTE_PREFIX}/snapshot/settings`;
  }

  if (error.domain === 'provider-contract' || error.domain === 'dependency') {
    return `${RECOVERY_ROUTE_PREFIX}/snapshot/health`;
  }

  if (error.domain === 'evidence') {
    return `${RECOVERY_ROUTE_PREFIX}/snapshot/evidence`;
  }

  return request.route.startsWith(RECOVERY_ROUTE_PREFIX) ? request.route : `${RECOVERY_ROUTE_PREFIX}/snapshot`;
}

function buildDegradedCapabilities({ dependencyHealth, providerContracts, lifecycleSettings, evidence }) {
  const dependencyReady = (name) => dependencyHealth[name] !== 'failed';
  const providerAccepted = (key) => providerContracts.services.find((entry) => entry.key === key)?.accepted === true;
  const lifecycleUsable = lifecycleSettings.enabled && lifecycleSettings.validation.errors.length === 0;
  const hasEvidence = evidence.length > 0;

  return {
    previewSnapshot: true,
    commitCheckpoint: lifecycleUsable && dependencyReady('snapshotStore') && providerAccepted('snapshotStore'),
    appendAuditProof: dependencyReady('auditLog') && providerAccepted('auditLog'),
    verifyProofOnline: dependencyHealth.proofVerifier === 'ok' && providerAccepted('proofVerifier'),
    queueRecoveryHandoff: lifecycleUsable
      && hasEvidence
      && dependencyHealth.recoveryQueue === 'ok'
      && providerAccepted('recoveryQueue'),
    recoverAfterRestart: lifecycleUsable
      && hasEvidence
      && dependencyReady('snapshotStore')
      && dependencyReady('auditLog'),
    degradedProofAccepted: dependencyHealth.proofVerifier !== 'ok',
    requiresEvidenceBeforeRecovery: !hasEvidence
  };
}

function buildHealthRemediationPlan({ errors, retryPolicy, request }) {
  const byCode = new Map();

  for (const error of errors.filter((item) => item.operatorVisible)) {
    if (byCode.has(error.code)) {
      continue;
    }

    const priority = error.blocksCapture
      ? 10
      : (error.blocksHandoff ? 30 : (error.severity === 'warning' ? 60 : 90));

    byCode.set(error.code, {
      id: error.code.toLowerCase().replaceAll('_', '-'),
      code: error.code,
      domain: error.domain,
      severity: error.severity,
      priority,
      route: routeForHealthAction(error, request),
      retryable: error.retryable,
      retryAfterSeconds: error.retryable ? retryPolicy.retryAfterSeconds : 0,
      action: error.action,
      expectedResolution: error.blocksCapture
        ? 'capture-unblocked'
        : (error.blocksHandoff ? 'handoff-unblocked' : 'operator-acknowledged')
    });
  }

  return [...byCode.values()]
    .sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code))
    .slice(0, MAX_HEALTH_REMEDIATION_ACTIONS);
}

function buildOperationalHealth({ input, request, boundary, evidence, lifecycleSettings, providerContracts, generatedAt }) {
  const health = isPlainObject(input.health)
    ? input.health
    : (isPlainObject(input.kernelHealth) ? input.kernelHealth : {});
  const dependencies = isPlainObject(health.dependencies) ? health.dependencies : health;
  const routeValid = request.route.startsWith(RECOVERY_ROUTE_PREFIX);
  const dependencyProbeContract = buildDependencyProbeContract(dependencies, generatedAt);
  const dependencyHealth = {
    snapshotStore: dependencyProbeContract.probes.snapshotStore.state,
    auditLog: dependencyProbeContract.probes.auditLog.state,
    proofVerifier: dependencyProbeContract.probes.proofVerifier.state,
    recoveryQueue: dependencyProbeContract.probes.recoveryQueue.state
  };
  const errors = [];

  if (!routeValid) {
    errors.push({
      code: 'SNAPSHOT_ROUTE_OUTSIDE_AUDIT_RECOVERY',
      severity: 'error',
      retryable: false,
      message: 'Snapshot capture must be routed under /audit-recovery so restart proof and recovery handoff share the same boundary.',
      action: `Retry the request on ${RECOVERY_ROUTE_PREFIX}/snapshot.`
    });
  }

  for (const violation of boundary.violations) {
    errors.push({
      code: `SNAPSHOT_BOUNDARY_${violation.toUpperCase().replaceAll('-', '_')}`,
      severity: 'error',
      retryable: false,
      message: `Hosted-kernel boundary rejected snapshot capture: ${violation}.`,
      action: 'Use a tenant, workspace, actor role, and recovery target that match the request boundary.'
    });
  }

  if (lifecycleSettings.validation.errors.length > 0) {
    errors.push({
      code: 'SNAPSHOT_LIFECYCLE_SETTINGS_INVALID',
      severity: 'error',
      retryable: false,
      message: `Snapshot lifecycle settings are invalid: ${lifecycleSettings.validation.errors.join(', ')}.`,
      action: 'Correct retention and scheduling settings before capturing a hosted-kernel recovery snapshot.'
    });
  }

  if (!lifecycleSettings.enabled) {
    errors.push({
      code: 'SNAPSHOT_LIFECYCLE_DISABLED',
      severity: 'error',
      retryable: false,
      message: 'Snapshot capture is disabled by lifecycle settings.',
      action: 'Enable snapshots before requesting capture or recovery handoff.'
    });
  } else if (lifecycleSettings.schedule.paused) {
    errors.push({
      code: 'SNAPSHOT_LIFECYCLE_SCHEDULE_PAUSED',
      severity: 'warning',
      retryable: false,
      message: 'Snapshot scheduling is paused; manual capture can be reviewed but automated recovery handoff should wait.',
      action: 'Resume the snapshot schedule before relying on automated recovery handoff.'
    });
  }

  if (dependencyHealth.snapshotStore === 'failed') {
    errors.push({
      code: 'SNAPSHOT_STORE_UNAVAILABLE',
      severity: 'error',
      retryable: true,
      message: 'Snapshot state cannot be committed because the snapshot store is unavailable.',
      action: 'Retry after the hosted-kernel storage dependency reports ready.'
    });
  } else if (dependencyHealth.snapshotStore === 'degraded') {
    errors.push({
      code: 'SNAPSHOT_STORE_DEGRADED',
      severity: 'warning',
      retryable: true,
      message: 'Snapshot state can be accepted, but persistence is running in degraded mode.',
      action: 'Keep the idempotency key and retry confirmation if checkpoint acknowledgement is delayed.'
    });
  }

  if (dependencyHealth.auditLog === 'failed') {
    errors.push({
      code: 'SNAPSHOT_AUDIT_LOG_UNAVAILABLE',
      severity: 'error',
      retryable: true,
      message: 'Audit proof output cannot be durably recorded while the audit log is unavailable.',
      action: 'Retry after audit logging is restored; do not start recovery from an unaudited snapshot.'
    });
  }

  if (dependencyHealth.proofVerifier !== 'ok') {
    errors.push({
      code: 'SNAPSHOT_PROOF_VERIFIER_DEGRADED',
      severity: dependencyHealth.proofVerifier === 'failed' ? 'warning' : 'info',
      retryable: true,
      message: 'Proof digest was generated locally and should be revalidated when verifier health recovers.',
      action: 'Proceed only in preview mode or retry before recovery handoff.'
    });
  }

  if (dependencyHealth.recoveryQueue === 'failed') {
    errors.push({
      code: 'SNAPSHOT_RECOVERY_QUEUE_UNAVAILABLE',
      severity: 'warning',
      retryable: true,
      message: 'Snapshot capture can be recorded, but automated recovery handoff cannot be queued.',
      action: 'Store the snapshot proof and retry handoff when the recovery queue is available.'
    });
  }

  for (const probe of Object.values(dependencyProbeContract.probes)) {
    if (probe.timeout) {
      errors.push({
        code: `SNAPSHOT_DEPENDENCY_${probe.name.toUpperCase()}_TIMEOUT`,
        severity: probe.captureCritical ? 'error' : 'warning',
        retryable: true,
        message: `Dependency probe for ${probe.name} exceeded ${MAX_DEPENDENCY_LATENCY_MS}ms latency budget.`,
        action: 'Retry with the same idempotency key after the dependency latency budget recovers.'
      });
    }

    if (probe.circuitOpen) {
      errors.push({
        code: `SNAPSHOT_DEPENDENCY_${probe.name.toUpperCase()}_CIRCUIT_OPEN`,
        severity: probe.captureCritical ? 'error' : 'warning',
        retryable: true,
        message: `Hosted-kernel circuit breaker is open for ${probe.name}.`,
        action: 'Wait for the provider circuit breaker to half-open before accepting a new snapshot checkpoint.'
      });
    }

    if (probe.stale) {
      errors.push({
        code: `SNAPSHOT_DEPENDENCY_${probe.name.toUpperCase()}_HEALTH_STALE`,
        severity: probe.captureCritical ? 'warning' : 'info',
        retryable: true,
        message: `Dependency probe for ${probe.name} is older than ${MAX_HEALTH_CHECK_AGE_MS}ms.`,
        action: 'Refresh hosted-kernel health probes before recovery handoff.'
      });
    }
  }

  for (const blocked of providerContracts.blocking) {
    errors.push({
      code: `SNAPSHOT_PROVIDER_${blocked.service.toUpperCase().replaceAll('-', '_')}_CONTRACT_BLOCKED`,
      severity: blocked.service === 'proof-verifier' ? 'warning' : 'error',
      retryable: blocked.status === 'unreachable' || blocked.status === 'readonly',
      message: `Provider contract for ${blocked.service} is not compatible with hosted-kernel snapshot requirements: ${blocked.status}.`,
      action: blocked.missingCapabilities.length > 0
        ? `Enable required capabilities: ${blocked.missingCapabilities.join(', ')}.`
        : `Expose ${blocked.expectedApiVersion} before accepting snapshot handoff from this provider.`
    });
  }

  for (const service of providerContracts.negotiation.staleServices) {
    errors.push({
      code: `SNAPSHOT_PROVIDER_${service.toUpperCase().replaceAll('-', '_')}_SYNC_STALE`,
      severity: 'warning',
      retryable: true,
      message: `Provider sync metadata for ${service} is stale and may lag the recovery snapshot checkpoint.`,
      action: 'Refresh provider sync metadata or keep the handoff in review until cursors catch up.'
    });
  }

  if (evidence.length === 0) {
    errors.push({
      code: 'SNAPSHOT_EVIDENCE_REQUIRED_FOR_RECOVERY',
      severity: 'info',
      retryable: false,
      message: 'Snapshot was accepted as awaiting-evidence and is not recoverable until evidence is attached.',
      action: 'Attach at least one evidence item with a non-empty summary before starting recovery.'
    });
  }

  const actionableErrors = errors.map((error) => classifyOperationalError(error));
  const blockingErrors = actionableErrors.filter((item) => item.blocksCapture);
  const handoffBlockingErrors = actionableErrors.filter((item) => item.blocksHandoff);
  const degraded = actionableErrors.some((item) => item.severity === 'warning');
  const retryPolicy = buildRetryPolicy({ input, request, failureCount: actionableErrors.filter((item) => item.retryable).length });
  const degradedCapabilities = buildDegradedCapabilities({
    dependencyHealth,
    providerContracts,
    lifecycleSettings,
    evidence
  });
  const remediationPlan = buildHealthRemediationPlan({
    errors: actionableErrors,
    retryPolicy,
    request
  });
  const primaryFailure = blockingErrors[0] || handoffBlockingErrors[0] || actionableErrors.find((item) => item.retryable) || null;
  const mode = blockingErrors.length > 0
    ? 'capture-blocked'
    : (handoffBlockingErrors.length > 0
      ? 'handoff-blocked'
      : (degraded ? 'degraded-accepted' : 'normal'));

  return {
    schemaVersion: OPERATIONAL_HEALTH_SCHEMA_VERSION,
    checkedAt: generatedAt,
    state: blockingErrors.length > 0 ? 'failed' : (degraded ? 'degraded' : 'healthy'),
    mode,
    canAcceptSnapshot: blockingErrors.length === 0,
    canQueueRecoveryHandoff: handoffBlockingErrors.length === 0 && degradedCapabilities.queueRecoveryHandoff,
    degradedMode: blockingErrors.length === 0 && degraded,
    dependencies: dependencyHealth,
    dependencyProbes: dependencyProbeContract,
    degradedCapabilities,
    retryPolicy,
    remediationPlan,
    actionableErrors,
    failureState: primaryFailure
      ? {
        code: blockingErrors.length > 0 ? 'SNAPSHOT_CAPTURE_BLOCKED' : 'SNAPSHOT_HANDOFF_ATTENTION_REQUIRED',
        primaryCode: primaryFailure.code,
        primaryDomain: primaryFailure.domain,
        retryable: primaryFailure.retryable,
        retryAfterSeconds: primaryFailure.retryable ? retryPolicy.retryAfterSeconds : 0,
        failedChecks: blockingErrors.map((item) => item.code),
        handoffBlockedChecks: handoffBlockingErrors.map((item) => item.code),
        clientMessage: primaryFailure.message,
        nextAction: remediationPlan[0]?.id || null
      }
      : null
  };
}

function buildPersistedState({ persistedState, request, clientState, evidence, snapshotId, proofDigestValue, idempotentCommand, generatedAt, boundary, lifecycleSettings, providerContracts, operationalHealth }) {
  const generation = persistedState.activeSnapshot.id === snapshotId
    ? persistedState.checkpoint.generation
    : persistedState.checkpoint.generation + 1;
  const cursor = proofDigest({
    storageKey: persistedState.storageKey,
    generation,
    snapshotId,
    proofDigestValue,
    auditPartition: boundary.auditPartition
  }).slice(0, 20);
  const scopedStorageKey = `${persistedState.storageKey}:${boundary.tenantId}:${boundary.workspaceId}`;
  const activeStatus = operationalHealth.canAcceptSnapshot
    ? (evidence.length > 0 ? 'committed' : 'awaiting-evidence')
    : (boundary.decision === 'allow' ? 'health-blocked' : 'boundary-denied');
  const handoffRequested = clientState.recovery.handoffRequested && operationalHealth.canAcceptSnapshot && evidence.length > 0;
  const pendingRecovery = handoffRequested
    ? {
      requested: true,
      snapshotId,
      targetRoute: '/audit-recovery/recover',
      mode: clientState.recovery.mode,
      status: operationalHealth.dependencies.recoveryQueue === 'failed' ? 'waiting-for-queue' : 'ready-to-enqueue',
      idempotencyKey: proofDigest({
        snapshotId,
        route: '/audit-recovery/recover',
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        clientSessionId: request.clientSessionId
      }).slice(0, 24),
      queuedAt: '',
      lastAttemptAt: generatedAt,
      attempts: 0,
      resumeCursor: cursor
    }
    : {
      requested: false,
      snapshotId: '',
      targetRoute: '/audit-recovery/recover',
      mode: 'none',
      status: 'none',
      idempotencyKey: '',
      queuedAt: '',
      lastAttemptAt: '',
      attempts: 0,
      resumeCursor: ''
    };
  const previousDigest = persistedState.recoveryJournal[0]?.digest || null;
  const journalEntryBase = {
    snapshotId,
    event: handoffRequested ? 'snapshot.recovery-handoff-prepared' : 'snapshot.checkpoint-committed',
    status: activeStatus,
    checkpointCursor: cursor,
    commandKey: idempotentCommand?.idempotencyKey || pendingRecovery.idempotencyKey || proofDigest({ requestId: request.requestId, snapshotId }).slice(0, 24),
    previousDigest,
    recordedAt: generatedAt
  };
  const journalEntry = {
    sequence: persistedState.recoveryJournal.length + 1,
    ...journalEntryBase,
    digest: proofDigest(journalEntryBase),
    verified: true
  };
  const recoveryJournal = [journalEntry, ...persistedState.recoveryJournal]
    .slice(0, MAX_RECOVERY_JOURNAL_ENTRIES);
  const shouldRecordCommand = idempotentCommand
    && idempotentCommand.status !== 'rejected'
    && idempotentCommand.status !== 'idempotency-conflict'
    && idempotentCommand.status !== 'state-reconciliation-required';
  const existingCommandIndex = shouldRecordCommand
    ? persistedState.recentCommands.findIndex((command) => command.idempotencyKey === idempotentCommand.idempotencyKey)
    : -1;
  const recentCommandRecord = shouldRecordCommand
    ? {
      idempotencyKey: idempotentCommand.idempotencyKey,
      command: idempotentCommand.command,
      snapshotId,
      acceptedAt: idempotentCommand.acceptedAt,
      resultDigest: idempotentCommand.resultDigest
    }
    : null;
  const recentCommands = shouldRecordCommand
    ? [
      recentCommandRecord,
      ...persistedState.recentCommands.filter((_, index) => index !== existingCommandIndex)
    ].slice(0, MAX_RECENT_COMMANDS)
    : persistedState.recentCommands.slice(0, MAX_RECENT_COMMANDS);
  const activeSnapshot = {
    id: snapshotId,
    status: activeStatus,
    proofDigest: proofDigestValue
  };
  const checkpoint = {
    cursor,
    generation
  };
  const recoveryLease = normalizeRecoveryLease({
    snapshotId,
    holder: `${request.source}:${request.clientSessionId}`,
    status: pendingRecovery.requested ? 'held-for-handoff' : 'held',
    acquiredAt: generatedAt,
    attempts: pendingRecovery.attempts,
    fencingToken: proofDigest({
      snapshotId,
      cursor,
      requestId: request.requestId,
      commandKey: journalEntry.commandKey
    }).slice(0, 20)
  }, {
    activeSnapshotId: snapshotId,
    pendingSnapshotId: pendingRecovery.snapshotId,
    generatedAt
  });
  const integrity = {
    journalVerified: recoveryJournal.every((entry) => entry.verified),
    journalEntryCount: recoveryJournal.length,
    activeSnapshotJournaled: recoveryJournal.some((entry) => entry.snapshotId === snapshotId),
    latestJournalDigest: recoveryJournal[0]?.digest || null,
    status: 'verified'
  };
  const restartProjection = buildRestartProjection({
    storageKey: scopedStorageKey,
    bootId: persistedState.bootId,
    activeSnapshot,
    checkpoint,
    pendingRecovery,
    recoveryJournal,
    integrity,
    recoveryLease,
    generatedAt
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    storageKey: scopedStorageKey,
    bootId: persistedState.bootId,
    lastCommittedAt: generatedAt,
    activeSnapshot,
    checkpoint,
    recentCommands,
    replayShape: {
      requestId: request.requestId,
      route: request.route,
      clientSessionId: request.clientSessionId,
      intent: clientState.intent,
      evidenceDigests: evidence.map((item) => item.digest),
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      lifecycle: {
        enabled: lifecycleSettings.enabled,
        retentionDays: lifecycleSettings.retention.days,
        scheduleInterval: lifecycleSettings.schedule.interval,
        schedulePaused: lifecycleSettings.schedule.paused,
        scheduleDriftState: lifecycleSettings.schedule.drift.state,
        maintenanceWindowActive: lifecycleSettings.schedule.maintenanceWindow.active,
        disableAuditToken: lifecycleSettings.disableControl.auditToken,
        controlState: lifecycleSettings.controls.state,
        controlDigest: lifecycleSettings.controls.audit.digest,
        nextAction: lifecycleSettings.nextAction,
        validationState: lifecycleSettings.validation.state
      },
      clientRuntime: {
        schemaVersion: clientState.runtime.schemaVersion,
        viewStateKey: clientState.runtime.viewStateKey,
        currentRoute: clientState.runtime.currentRoute,
        routeStack: clientState.runtime.routeStack,
        workflowStep: clientState.workflow.step,
        handoffMode: clientState.workflow.handoffMode,
        localCheckpoint: clientState.runtime.localCheckpoint,
        pendingHandoff: clientState.runtime.pendingHandoff
      },
      providerContracts: {
        schemaVersion: providerContracts.schemaVersion,
        negotiationStatus: providerContracts.negotiation.status,
        acceptedServices: providerContracts.negotiation.acceptedServices,
        blockedServices: providerContracts.negotiation.blockedServices,
        staleServices: providerContracts.negotiation.staleServices,
        syncCursors: providerContracts.sync.cursors,
        maxObservedLagMs: providerContracts.sync.maxObservedLagMs
      },
      boundaryDecision: boundary.decision,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      restartProjection: {
        schemaVersion: restartProjection.schemaVersion,
        status: restartProjection.status,
        restartSafe: restartProjection.restartSafe,
        command: restartProjection.command,
        resumeToken: restartProjection.resumeToken,
        blockers: restartProjection.blockers,
        proofDigest: restartProjection.proof.digest
      }
    },
    pendingRecovery,
    recoveryLease,
    recoveryJournal,
    integrity,
    restartProjection
  };
}

function buildIdempotentCommand({ persistedState, request, clientState, evidence, snapshotId, proofDigestValue, generatedAt, boundary, lifecycleSettings, providerContracts, operationalHealth }) {
  const command = lifecycleSettings.command.normalized || (clientState.recovery.handoffRequested ? 'snapshot.recover' : 'snapshot.capture');
  const idempotencyKey = proofDigest({
    command,
    requestId: request.requestId,
    clientSessionId: request.clientSessionId,
    snapshotId,
    recoveryTarget: clientState.recovery.target,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId
  }).slice(0, 24);
  const prior = persistedState.recentCommands.find((item) => item.idempotencyKey === idempotencyKey);
  const resultDigest = proofDigest({
    snapshotId,
    proofDigestValue,
    evidenceCount: evidence.length,
    recoveryMode: clientState.recovery.mode,
    lifecycleNextAction: lifecycleSettings.nextAction,
    lifecycleValidationState: lifecycleSettings.validation.state,
    lifecycleControlState: lifecycleSettings.controls.state,
    lifecycleControlDigest: lifecycleSettings.controls.audit.digest,
    providerNegotiationStatus: providerContracts.negotiation.status,
    providerSyncCursors: providerContracts.sync.cursors,
    boundaryDecision: boundary.decision
  });
  const priorDigestMatches = !prior?.resultDigest || prior.resultDigest === resultDigest;
  const persistedStateTrusted = persistedState.integrity.status === 'verified';
  const status = !operationalHealth.canAcceptSnapshot
    ? 'rejected'
    : (!persistedStateTrusted
      ? 'state-reconciliation-required'
      : (prior
        ? (priorDigestMatches ? 'deduplicated' : 'idempotency-conflict')
        : 'accepted'));

  return {
    command,
    idempotencyKey,
    status,
    acceptedAt: prior?.acceptedAt || generatedAt,
    snapshotId,
    resultDigest,
    replaySafe: operationalHealth.canAcceptSnapshot && persistedStateTrusted && priorDigestMatches,
    priorResultDigest: prior?.resultDigest || null,
    persistenceIntegrity: persistedState.integrity.status,
    reason: boundary.decision === 'deny'
      ? `request stopped at hosted-kernel boundary: ${boundary.violations.join(', ')}`
      : !operationalHealth.canAcceptSnapshot
      ? `snapshot capture blocked by operational health: ${operationalHealth.failureState?.failedChecks.join(', ')}`
      : !persistedStateTrusted
      ? `persisted recovery state requires reconciliation before replay: ${persistedState.integrity.status}`
      : prior && !priorDigestMatches
      ? 'idempotency key was previously recorded with a different result digest'
      : providerContracts.negotiation.status !== 'ready'
      ? `provider contracts accepted with ${providerContracts.negotiation.status} sync state`
      : lifecycleSettings.command.accepted
      ? `lifecycle command ${lifecycleSettings.command.normalized} accepted for snapshot workflow`
      : prior
      ? 'matching command already recorded in persisted state'
      : 'command can be retried with the same idempotency key after restart'
  };
}

function buildRecoveryPaths({ request, clientState, evidence, snapshotId, persistedState, proofDigestValue, boundary, lifecycleSettings, providerContracts, operationalHealth }) {
  const routeRecoverable = request.route.startsWith(RECOVERY_ROUTE_PREFIX);
  const hasEvidence = evidence.length > 0;
  const boundaryAllowed = boundary.decision === 'allow';
  const healthAllowed = operationalHealth.canAcceptSnapshot;
  const lifecycleAllowed = lifecycleSettings.enabled && !lifecycleSettings.schedule.paused && lifecycleSettings.validation.errors.length === 0;
  const persistedStateTrusted = persistedState.integrity.status === 'verified';
  const activeMatchesProof = persistedState.activeSnapshot.id === snapshotId
    && persistedState.activeSnapshot.proofDigest === proofDigestValue;

  return {
    restart: {
      status: hasEvidence && routeRecoverable && boundaryAllowed && healthAllowed && persistedStateTrusted
        && lifecycleAllowed
        ? (operationalHealth.degradedMode ? 'resume-ready-degraded' : 'resume-ready')
        : (!persistedStateTrusted ? 'blocked-persistence-reconciliation' : 'blocked'),
      cursor: persistedState.checkpoint.cursor || null,
      snapshotId,
      requiredState: ['storageKey', 'checkpoint.cursor', 'activeSnapshot.proofDigest', 'recoveryJournal.digest'],
      healthState: operationalHealth.state,
      lifecycleNextAction: lifecycleSettings.nextAction,
      providerNegotiationStatus: providerContracts.negotiation.status,
      providerSyncCursors: providerContracts.sync.cursors,
      persistenceIntegrity: persistedState.integrity
    },
    rollback: {
      status: !persistedStateTrusted
        ? 'reconcile-journal-first'
        : (persistedState.activeSnapshot.id && !activeMatchesProof ? 'available' : 'not-required'),
      previousSnapshotId: persistedState.activeSnapshot.id || null,
      previousStatus: persistedState.activeSnapshot.status || null,
      latestJournalDigest: persistedState.integrity.latestJournalDigest
    },
    recover: {
      status: !boundaryAllowed
        ? 'blocked-by-boundary'
        : (!healthAllowed
          ? 'blocked-by-health'
          : (!persistedStateTrusted
            ? 'blocked-by-persistence-reconciliation'
            : (!lifecycleAllowed
            ? 'blocked-by-lifecycle'
            : (hasEvidence && routeRecoverable
            ? (operationalHealth.degradedMode ? 'armed-degraded' : 'armed')
            : 'needs-snapshot-evidence')))),
      route: clientState.recovery.handoffRequested ? '/audit-recovery/recover' : '/audit-recovery/review',
      mode: clientState.recovery.mode,
      target: clientState.recovery.target,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleNextAction: lifecycleSettings.nextAction,
      providerNegotiationStatus: providerContracts.negotiation.status,
      boundaryDecision: boundary.decision,
      healthState: operationalHealth.state,
      persistenceIntegrity: persistedState.integrity.status,
      actionableErrors: healthAllowed ? [] : operationalHealth.actionableErrors
    }
  };
}

function buildRestartSafeStatus({ request, evidence, command, recoveryPaths, persistedState, snapshotId, boundary, lifecycleSettings, providerContracts, operationalHealth }) {
  if (!request.route.startsWith(RECOVERY_ROUTE_PREFIX)) {
    return {
      state: 'invalid-route',
      restartSafe: false,
      snapshotId,
      message: 'snapshot requests must stay under the audit-recovery route prefix'
    };
  }

  if (boundary.decision !== 'allow') {
    return {
      state: 'boundary-denied',
      restartSafe: false,
      snapshotId,
      violations: boundary.violations,
      message: 'snapshot recovery was stopped before persistence handoff because tenant or workspace permissions did not match'
    };
  }

  if (!operationalHealth.canAcceptSnapshot) {
    return {
      state: 'health-blocked',
      restartSafe: false,
      snapshotId,
      retryPolicy: operationalHealth.retryPolicy,
      nextAction: lifecycleSettings.nextAction,
      providerNegotiationStatus: providerContracts.negotiation.status,
      failedChecks: operationalHealth.failureState?.failedChecks || [],
      message: operationalHealth.failureState?.clientMessage || 'snapshot recovery is blocked by hosted-kernel operational health'
    };
  }

  if (command.status === 'state-reconciliation-required' || command.status === 'idempotency-conflict') {
    return {
      state: command.status,
      restartSafe: false,
      snapshotId,
      storageKey: persistedState.storageKey,
      checkpointCursor: persistedState.checkpoint.cursor,
      persistenceIntegrity: command.persistenceIntegrity,
      priorResultDigest: command.priorResultDigest,
      resultDigest: command.resultDigest,
      nextAction: 'reconcile-persisted-snapshot-state',
      message: command.status === 'idempotency-conflict'
        ? 'idempotency key exists with a different result digest and must not be replayed automatically'
        : 'persisted recovery journal must be reconciled before restart resume'
    };
  }

  if (persistedState.restartProjection?.status === 'blocked') {
    return {
      state: 'restart-projection-blocked',
      restartSafe: false,
      snapshotId,
      storageKey: persistedState.storageKey,
      checkpointCursor: persistedState.checkpoint.cursor,
      restartProjection: {
        status: persistedState.restartProjection.status,
        command: persistedState.restartProjection.command,
        blockers: persistedState.restartProjection.blockers,
        proofDigest: persistedState.restartProjection.proof.digest
      },
      nextAction: 'reconcile-persisted-snapshot-state',
      message: 'persisted restart projection contains blockers and must be reconciled before automatic recovery resume'
    };
  }

  if (evidence.length === 0) {
    return {
      state: 'waiting-for-evidence',
      restartSafe: persistedState.restartProjection?.restartSafe === true,
      snapshotId,
      nextAction: lifecycleSettings.nextAction,
      restartProjection: {
        status: persistedState.restartProjection?.status || 'unknown',
        command: persistedState.restartProjection?.command || null,
        proofDigest: persistedState.restartProjection?.proof?.digest || null
      },
      degradedMode: operationalHealth.degradedMode,
      message: 'empty snapshot persisted as awaiting-evidence and can be completed after restart'
    };
  }

  return {
    state: command.status === 'deduplicated' ? 'already-applied' : recoveryPaths.restart.status,
    restartSafe: true,
    snapshotId,
    storageKey: persistedState.storageKey,
    checkpointCursor: recoveryPaths.restart.cursor,
    nextAction: lifecycleSettings.nextAction,
    pendingRecovery: persistedState.pendingRecovery,
    restartProjection: {
      status: persistedState.restartProjection?.status || 'unknown',
      command: persistedState.restartProjection?.command || null,
      resumeToken: persistedState.restartProjection?.resumeToken || null,
      proofDigest: persistedState.restartProjection?.proof?.digest || null
    },
    persistenceIntegrity: persistedState.integrity,
    providerNegotiationStatus: providerContracts.negotiation.status,
    providerSyncCursors: providerContracts.sync.cursors,
    degradedMode: operationalHealth.degradedMode,
    message: command.status === 'deduplicated'
      ? 'idempotent command result was replayed from persisted state'
      : 'snapshot checkpoint can resume recovery after hosted-kernel restart'
  };
}

function buildHandoffResumeContract({
  request,
  clientState,
  evidence,
  snapshotId,
  destination,
  boundary,
  lifecycleSettings,
  providerContracts,
  operationalHealth,
  nextPersistedState,
  recoveryPaths,
  canContinue,
  generatedAt
}) {
  const pendingRecovery = nextPersistedState.pendingRecovery;
  const runtimePending = clientState.runtime.pendingHandoff;
  const providerBlocked = providerContracts.negotiation.blockedServices.includes('recovery-queue');
  const runtimeHasPending = Boolean(runtimePending.id) && runtimePending.status !== 'none';
  const persistedHasPending = pendingRecovery.requested === true;
  const routeStack = normalizeRouteStack([
    request.route,
    destination,
    pendingRecovery.targetRoute,
    runtimePending.targetRoute,
    ...clientState.runtime.routeStack
  ]);
  const targetRoute = asString(pendingRecovery.targetRoute, asString(runtimePending.targetRoute, destination));
  const blockers = [
    evidence.length === 0 ? 'evidence-required' : '',
    boundary.decision !== 'allow' ? 'boundary-denied' : '',
    !lifecycleSettings.enabled ? 'lifecycle-disabled' : '',
    lifecycleSettings.schedule.paused ? 'schedule-paused' : '',
    lifecycleSettings.validation.errors.length > 0 ? 'lifecycle-validation-errors' : '',
    !operationalHealth.canAcceptSnapshot ? 'health-blocked' : '',
    operationalHealth.dependencies.recoveryQueue === 'failed' ? 'recovery-queue-unavailable' : '',
    providerBlocked ? 'recovery-queue-contract-blocked' : '',
    nextPersistedState.integrity.status !== 'verified' ? 'persistence-integrity-unverified' : '',
    clientState.runtime.localCheckpoint.dirty ? 'client-checkpoint-dirty' : ''
  ].filter(Boolean);
  const resumeEnabled = canContinue
    && persistedHasPending
    && Boolean(pendingRecovery.resumeCursor)
    && blockers.length === 0;
  const state = resumeEnabled
    ? 'resume-ready'
    : (runtimeHasPending || persistedHasPending
      ? (blockers.length > 0 ? 'resume-blocked' : 'resume-review')
      : 'no-pending-handoff');
  const token = proofDigest({
    schemaVersion: HANDOFF_RESUME_CONTRACT_SCHEMA_VERSION,
    requestId: request.requestId,
    clientSessionId: request.clientSessionId,
    snapshotId,
    targetRoute,
    resumeCursor: pendingRecovery.resumeCursor,
    idempotencyKey: pendingRecovery.idempotencyKey,
    routeStack,
    blockers
  }).slice(0, 28);
  const payload = {
    snapshotId,
    requestId: request.requestId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    clientSessionId: request.clientSessionId,
    targetRoute,
    resumeCursor: pendingRecovery.resumeCursor || null,
    idempotencyKey: pendingRecovery.idempotencyKey || null,
    recoveryMode: clientState.recovery.mode,
    recoveryTarget: clientState.recovery.target,
    checkpointCursor: nextPersistedState.checkpoint.cursor,
    proofDigest: nextPersistedState.activeSnapshot.proofDigest,
    providerSyncCursor: providerContracts.sync.cursors['recovery-queue'] || null
  };

  return {
    schemaVersion: HANDOFF_RESUME_CONTRACT_SCHEMA_VERSION,
    generatedAt,
    state,
    source: {
      runtimePending: runtimeHasPending,
      persistedPending: persistedHasPending,
      runtimeStatus: runtimePending.status,
      persistedStatus: pendingRecovery.status,
      selectedSnapshotId: clientState.selectedSnapshot.id || null,
      activeSnapshotId: nextPersistedState.activeSnapshot.id || null
    },
    route: {
      currentRoute: request.route,
      targetRoute,
      returnRoute: clientState.workflow.returnRoute,
      routeStack,
      state: routeStack.includes(targetRoute) ? 'route-stack-ready' : 'target-route-injected'
    },
    resume: {
      enabled: resumeEnabled,
      reason: resumeEnabled
        ? 'pending recovery can resume from persisted checkpoint and client route state'
        : (blockers[0] || 'no persisted recovery handoff is pending'),
      token,
      blockers,
      requiredInputs: resumeEnabled ? ['resumeCursor', 'idempotencyKey', 'proofDigest'] : blockers
    },
    queuePayload: payload,
    recoveryPathStatus: {
      restart: recoveryPaths.restart.status,
      recover: recoveryPaths.recover.status,
      handoffRequested: clientState.recovery.handoffRequested
    },
    clientPrompt: {
      visible: runtimeHasPending || persistedHasPending,
      severity: resumeEnabled ? 'info' : (blockers.length > 0 ? 'warning' : 'info'),
      label: resumeEnabled ? 'Resume pending recovery' : 'Review pending recovery',
      route: targetRoute
    },
    audit: {
      algorithm: 'sha256',
      digest: proofDigest({ payload, state, routeStack, blockers, generatedAt }),
      covers: ['source', 'route', 'resume', 'queuePayload', 'recoveryPathStatus']
    }
  };
}

function buildHandoff({ request, clientState, evidence, snapshotId, generatedAt, boundary, lifecycleSettings, providerContracts, operationalHealth, nextPersistedState, recoveryPaths }) {
  const recoveryQueueContract = providerContracts.services.find((entry) => entry.key === 'recoveryQueue');
  const canContinue = evidence.length > 0
    && request.route.startsWith('/audit-recovery')
    && boundary.decision === 'allow'
    && lifecycleSettings.enabled
    && !lifecycleSettings.schedule.paused
    && operationalHealth.canAcceptSnapshot
    && operationalHealth.dependencies.recoveryQueue !== 'failed'
    && recoveryQueueContract?.accepted === true;
  const destination = clientState.recovery.handoffRequested
    ? '/audit-recovery/recover'
    : '/audit-recovery/review';
  const healthBlocked = !operationalHealth.canAcceptSnapshot || operationalHealth.dependencies.recoveryQueue === 'failed';
  const lifecycleBlocked = !lifecycleSettings.enabled || lifecycleSettings.schedule.paused;
  const resumeContract = buildHandoffResumeContract({
    request,
    clientState,
    evidence,
    snapshotId,
    destination,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    nextPersistedState,
    recoveryPaths,
    canContinue,
    generatedAt
  });
  const clientWorkflow = buildClientWorkflowHandoff({
    request,
    clientState,
    evidence,
    snapshotId,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    canContinue,
    destination,
    resumeContract,
    generatedAt
  });

  return {
    visibleToClient: true,
    status: canContinue
      ? (operationalHealth.degradedMode ? 'ready-degraded' : 'ready')
      : (boundary.decision === 'allow'
        ? (lifecycleBlocked ? 'blocked-by-lifecycle' : (healthBlocked ? 'blocked-by-health' : 'needs-evidence'))
        : 'blocked-by-boundary'),
    destination,
    label: canContinue
      ? (operationalHealth.degradedMode ? 'Review recovery snapshot after degraded-mode acknowledgement' : 'Review recovery snapshot')
      : (boundary.decision === 'allow'
        ? (lifecycleBlocked ? 'Resolve snapshot lifecycle controls before recovery handoff' : (healthBlocked ? 'Hosted-kernel health blocked recovery handoff' : 'Add audit evidence before recovery'))
        : 'Tenant or workspace permission boundary blocked recovery'),
    snapshotId,
    requestId: request.requestId,
    generatedAt,
    requiredEvidence: canContinue || healthBlocked || lifecycleBlocked || evidence.length > 0 ? [] : ['At least one evidence item with a non-empty summary'],
    recoveryMode: clientState.recovery.mode,
    target: clientState.recovery.target,
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      schedulePaused: lifecycleSettings.schedule.paused,
      controlState: lifecycleSettings.controls.state,
      controlDigest: lifecycleSettings.controls.audit.digest,
      nextAction: lifecycleSettings.nextAction,
      commandAccepted: lifecycleSettings.command.accepted
    },
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    boundaryDecision: boundary.decision,
    boundaryViolations: boundary.violations,
    healthState: operationalHealth.state,
    providerNegotiation: providerContracts.negotiation,
    externalHandoff: {
      state: canContinue
        ? (recoveryQueueContract?.handoff.ackRequired && !recoveryQueueContract.handoff.ackedAt ? 'awaiting-provider-ack' : 'ready')
        : (recoveryQueueContract?.accepted ? 'blocked-upstream' : 'provider-contract-blocked'),
      providerId: recoveryQueueContract?.providerId || null,
      service: recoveryQueueContract?.service || 'recovery-queue',
      externalReference: recoveryQueueContract?.handoff.externalReference || null,
      targetRoute: recoveryQueueContract?.handoff.targetRoute || destination,
      syncCursor: recoveryQueueContract?.sync.cursor || null,
      ackRequired: recoveryQueueContract?.handoff.ackRequired === true,
      ackedAt: recoveryQueueContract?.handoff.ackedAt || null
    },
    resumeContract,
    clientWorkflow,
    retryPolicy: healthBlocked ? operationalHealth.retryPolicy : null,
    actionableErrors: healthBlocked
      ? operationalHealth.actionableErrors.filter((item) => item.severity !== 'info')
      : []
  };
}

function buildAcceptanceGate(id, label, passed, route, reason, severity = 'error', details = {}) {
  return {
    id,
    label,
    state: passed ? 'passed' : 'failed',
    passed,
    severity: passed ? 'ok' : severity,
    route,
    reason: passed ? 'ready' : reason,
    ...details
  };
}

function buildPreviewAcceptanceContract({
  request,
  clientState,
  evidence,
  snapshotId,
  boundary,
  lifecycleSettings,
  providerContracts,
  operationalHealth,
  idempotentCommand,
  recoveryPaths,
  restartStatus,
  handoff,
  snapshotArtifact,
  generatedAt
}) {
  const gates = [
    buildAcceptanceGate(
      'boundary',
      'Tenant and workspace boundary',
      boundary.decision === 'allow',
      request.route,
      boundary.violations.join(', ') || 'boundary rejected snapshot request',
      'error',
      { violations: boundary.violations }
    ),
    buildAcceptanceGate(
      'lifecycle',
      'Snapshot lifecycle controls',
      lifecycleSettings.captureAllowed,
      '/audit-recovery/snapshot/settings',
      lifecycleSettings.validation.errors.join(', ') || lifecycleSettings.nextAction,
      'error',
      { nextAction: lifecycleSettings.nextAction, controlState: lifecycleSettings.controls.state }
    ),
    buildAcceptanceGate(
      'provider-contracts',
      'Hosted-kernel provider contracts',
      providerContracts.blocking.length === 0,
      '/audit-recovery/snapshot/health',
      providerContracts.blocking.map((item) => `${item.service}:${item.status}`).join(', ') || 'provider contract blocked',
      'error',
      { negotiationStatus: providerContracts.negotiation.status, staleServices: providerContracts.negotiation.staleServices }
    ),
    buildAcceptanceGate(
      'operational-health',
      'Operational health',
      operationalHealth.canAcceptSnapshot,
      '/audit-recovery/snapshot/health',
      operationalHealth.failureState?.clientMessage || 'hosted-kernel health blocked snapshot acceptance',
      'error',
      { healthState: operationalHealth.state, mode: operationalHealth.mode, retryPolicy: operationalHealth.retryPolicy }
    ),
    buildAcceptanceGate(
      'audit-evidence',
      'Audit evidence',
      evidence.length > 0,
      '/audit-recovery/snapshot/evidence',
      'attach at least one evidence item before recovery handoff',
      'warning',
      { evidenceCount: evidence.length, requiredForRecovery: true }
    ),
    buildAcceptanceGate(
      'persistence-proof',
      'Restart-safe proof',
      restartStatus.restartSafe === true && snapshotArtifact.validation.persistenceIntegrity === 'verified',
      '/audit-recovery/snapshot/review',
      restartStatus.message || snapshotArtifact.validation.persistenceIntegrity,
      'error',
      { restartState: restartStatus.state, artifactState: snapshotArtifact.state }
    )
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const blockingGates = failedGates.filter((gate) => gate.severity === 'error');
  const warningGates = failedGates.filter((gate) => gate.severity === 'warning');
  const acceptanceState = blockingGates.length > 0
    ? 'blocked'
    : (warningGates.length > 0 || operationalHealth.degradedMode || providerContracts.negotiation.status !== 'ready'
      ? 'requires-attention'
      : 'accepted');
  const previewEvidence = evidence.slice(0, MAX_PREVIEW_EVIDENCE).map((item) => ({
    id: item.id,
    type: item.type,
    source: item.source,
    capturedAt: item.capturedAt,
    summary: item.summary,
    digest: item.digest
  }));
  const nextSteps = [
    ...failedGates.map((gate) => ({
      id: `resolve-${gate.id}`,
      type: gate.severity === 'warning' ? 'review' : 'resolve',
      label: gate.label,
      route: gate.route,
      reason: gate.reason,
      requiredInputs: gate.id === 'audit-evidence' ? ['evidence.summary', 'evidence.digest'] : []
    })),
    ...handoff.clientWorkflow.actions
      .filter((action) => action.enabled)
      .map((action) => ({
        id: action.id,
        type: action.type,
        label: action.label,
        route: action.route,
        reason: action.reason,
        requiredInputs: action.type === 'enqueue' ? ['snapshotId', 'idempotencyKey', 'proofDigest'] : []
      }))
  ].slice(0, MAX_NEXT_STEP_ITEMS);
  const readinessScore = Math.round((gates.filter((gate) => gate.passed).length / gates.length) * 100);
  const validationSummary = {
    state: acceptanceState,
    passed: gates.length - failedGates.length,
    failed: failedGates.length,
    blocking: blockingGates.map((gate) => gate.id),
    warnings: [
      ...warningGates.map((gate) => gate.id),
      ...lifecycleSettings.validation.warnings,
      ...operationalHealth.actionableErrors.filter((item) => item.severity === 'warning').map((item) => item.code)
    ],
    artifactValidation: snapshotArtifact.validation,
    commandStatus: idempotentCommand.status
  };
  const proofInput = {
    schemaVersion: PREVIEW_ACCEPTANCE_SCHEMA_VERSION,
    snapshotId,
    requestId: request.requestId,
    acceptanceState,
    gates,
    nextSteps,
    artifactPayloadDigest: snapshotArtifact.payloadDigest,
    commandResultDigest: idempotentCommand.resultDigest
  };

  return {
    schemaVersion: PREVIEW_ACCEPTANCE_SCHEMA_VERSION,
    generatedAt,
    snapshotId,
    requestId: request.requestId,
    preview: {
      title: evidence.length > 0 ? 'Recovery snapshot preview' : 'Recovery snapshot preview needs evidence',
      status: acceptanceState,
      route: request.route,
      destination: handoff.destination,
      selectedSnapshotId: clientState.selectedSnapshot.id || null,
      evidence: previewEvidence,
      evidenceRemaining: Math.max(0, evidence.length - previewEvidence.length),
      degradedMode: operationalHealth.degradedMode
    },
    acceptance: {
      state: acceptanceState,
      submitEnabled: acceptanceState !== 'blocked' && snapshotArtifact.exportable,
      acceptLabel: handoff.status.startsWith('ready') ? 'Accept and continue' : 'Keep in review',
      requiredAcknowledgements: operationalHealth.degradedMode ? ['degraded-mode'] : [],
      gates
    },
    readiness: {
      score: readinessScore,
      label: readinessScore === 100 ? 'ready' : (blockingGates.length > 0 ? 'blocked' : 'attention-required'),
      restartSafe: restartStatus.restartSafe === true,
      recoveryStatus: recoveryPaths.recover.status,
      handoffStatus: handoff.status,
      providerNegotiationStatus: providerContracts.negotiation.status
    },
    validationSummary,
    nextSteps,
    audit: {
      algorithm: 'sha256',
      digest: proofDigest(proofInput),
      covers: ['preview', 'acceptance.gates', 'readiness', 'validationSummary', 'nextSteps']
    }
  };
}

function buildRoutePreviewContract({
  request,
  clientState,
  snapshotId,
  previewAcceptance,
  snapshotArtifact,
  lifecycleSettings,
  providerContracts,
  operationalHealth,
  idempotentCommand,
  generatedAt
}) {
  const blockingGates = previewAcceptance.acceptance.gates
    .filter((gate) => !gate.passed && gate.severity === 'error');
  const warningGates = previewAcceptance.acceptance.gates
    .filter((gate) => !gate.passed && gate.severity === 'warning');
  const primaryAction = previewAcceptance.nextSteps.find((step) => step.type === 'resolve')
    || previewAcceptance.nextSteps.find((step) => step.type === 'enqueue')
    || previewAcceptance.nextSteps[0]
    || null;
  const routeBlockers = blockingGates
    .map((gate) => ({
      id: gate.id,
      label: gate.label,
      route: gate.route,
      reason: gate.reason,
      domain: gate.id === 'provider-contracts' ? 'provider' : gate.id
    }))
    .slice(0, MAX_ROUTE_BLOCKERS);
  const clientCta = {
    primary: {
      id: primaryAction?.id || 'refresh-preview',
      label: primaryAction?.label || 'Refresh snapshot preview',
      route: primaryAction?.route || request.route,
      enabled: previewAcceptance.acceptance.submitEnabled && blockingGates.length === 0,
      disabledReason: blockingGates[0]?.reason
        || (!snapshotArtifact.exportable ? snapshotArtifact.validation.status : null)
    },
    secondary: {
      id: 'open-snapshot-review',
      label: 'Open snapshot review',
      route: '/audit-recovery/snapshot/review',
      enabled: operationalHealth.canAcceptSnapshot,
      disabledReason: operationalHealth.failureState?.primaryCode || null
    }
  };
  const validationBadges = [
    {
      id: 'readiness',
      label: previewAcceptance.readiness.label,
      state: previewAcceptance.readiness.score === 100 ? 'ok' : previewAcceptance.readiness.label,
      value: previewAcceptance.readiness.score
    },
    {
      id: 'artifact',
      label: snapshotArtifact.state,
      state: snapshotArtifact.exportable ? 'ok' : 'attention',
      value: snapshotArtifact.validation.status
    },
    {
      id: 'providers',
      label: providerContracts.negotiation.status,
      state: providerContracts.blocking.length === 0 ? 'ok' : 'blocked',
      value: providerContracts.negotiation.acceptedServices.length
    },
    {
      id: 'health',
      label: operationalHealth.mode,
      state: operationalHealth.canAcceptSnapshot ? operationalHealth.state : 'blocked',
      value: operationalHealth.actionableErrors.length
    }
  ];
  const digestInput = {
    schemaVersion: ROUTE_PREVIEW_CONTRACT_SCHEMA_VERSION,
    snapshotId,
    requestId: request.requestId,
    viewStateKey: clientState.runtime.viewStateKey,
    primaryAction,
    routeBlockers,
    validationBadges,
    previewAuditDigest: previewAcceptance.audit.digest,
    artifactPayloadDigest: snapshotArtifact.payloadDigest,
    commandStatus: idempotentCommand.status
  };

  return {
    schemaVersion: ROUTE_PREVIEW_CONTRACT_SCHEMA_VERSION,
    generatedAt,
    route: request.route,
    viewStateKey: clientState.runtime.viewStateKey,
    snapshotId,
    state: blockingGates.length > 0
      ? 'blocked'
      : (warningGates.length > 0 || operationalHealth.degradedMode ? 'review-required' : 'ready'),
    clientCta,
    validationBadges,
    routeBlockers,
    explainableNextStep: primaryAction
      ? {
        id: primaryAction.id,
        type: primaryAction.type,
        route: primaryAction.route,
        reason: primaryAction.reason,
        requiredInputs: primaryAction.requiredInputs
      }
      : null,
    readinessSummary: {
      score: previewAcceptance.readiness.score,
      label: previewAcceptance.readiness.label,
      restartSafe: previewAcceptance.readiness.restartSafe,
      submitEnabled: previewAcceptance.acceptance.submitEnabled,
      artifactExportable: snapshotArtifact.exportable,
      lifecycleNextAction: lifecycleSettings.nextAction,
      providerNegotiationStatus: providerContracts.negotiation.status,
      healthMode: operationalHealth.mode,
      commandStatus: idempotentCommand.status
    },
    telemetry: {
      eventName: 'audit_recovery_snapshot_preview_rendered',
      properties: {
        acceptanceState: previewAcceptance.acceptance.state,
        readinessScore: previewAcceptance.readiness.score,
        blockerCount: blockingGates.length,
        warningCount: warningGates.length,
        providerStatus: providerContracts.negotiation.status,
        healthState: operationalHealth.state,
        commandStatus: idempotentCommand.status
      }
    },
    audit: {
      algorithm: 'sha256',
      digest: proofDigest(digestInput),
      covers: ['clientCta', 'validationBadges', 'routeBlockers', 'explainableNextStep', 'readinessSummary', 'telemetry']
    }
  };
}

export function describeSnapshotSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const request = normalizeRequest(input);
  const clientState = normalizeClientState(input, request, now);
  const boundary = normalizeBoundaryPolicy(input, request, clientState);
  const evidence = normalizeEvidence(input, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, request, now);
  const providerContracts = buildProviderContracts({
    input,
    request,
    generatedAt: now
  });
  const persistedState = normalizePersistedState(input);
  const snapshotId = `snapshot_${proofDigest({
    surfaceId,
    request,
    clientState,
    clientRuntime: {
      schemaVersion: clientState.runtime.schemaVersion,
      viewStateKey: clientState.runtime.viewStateKey,
      routeStack: clientState.runtime.routeStack,
      localCheckpoint: clientState.runtime.localCheckpoint,
      pendingHandoff: clientState.runtime.pendingHandoff,
      workflow: clientState.workflow
    },
    lifecycleSettings,
    providerContracts,
    boundary,
    evidence,
    generatedAt: now
  }).slice(0, 16)}`;
  const proofInput = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    surfaceId,
    surfaceGroup,
    surfaceName,
    snapshotId,
    generatedAt: now,
    request,
    clientState,
    lifecycleSettings,
    providerContracts,
    boundary,
    evidenceDigests: evidence.map((item) => item.digest)
  };
  const auditProofDigest = proofDigest(proofInput);
  const operationalHealth = buildOperationalHealth({
    input,
    request,
    boundary,
    evidence,
    lifecycleSettings,
    providerContracts,
    generatedAt: now
  });
  const idempotentCommand = buildIdempotentCommand({
    persistedState,
    request,
    clientState,
    evidence,
    snapshotId,
    proofDigestValue: auditProofDigest,
    generatedAt: now,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth
  });
  const nextPersistedState = buildPersistedState({
    persistedState,
    request,
    clientState,
    evidence,
    snapshotId,
    proofDigestValue: auditProofDigest,
    idempotentCommand,
    generatedAt: now,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth
  });
  const recoveryPaths = buildRecoveryPaths({
    request,
    clientState,
    evidence,
    snapshotId,
    persistedState: nextPersistedState,
    proofDigestValue: auditProofDigest,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth
  });
  const restartStatus = buildRestartSafeStatus({
    request,
    evidence,
    command: idempotentCommand,
    recoveryPaths,
    persistedState: nextPersistedState,
    snapshotId,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth
  });
  const handoff = buildHandoff({
    request,
    clientState,
    evidence,
    snapshotId,
    generatedAt: now,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    nextPersistedState,
    recoveryPaths
  });
  const analytics = buildAnalyticsReport({
    input,
    request,
    clientState,
    boundary,
    evidence,
    persistedState,
    nextPersistedState,
    snapshotId,
    auditProofDigest,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    idempotentCommand,
    recoveryPaths,
    handoff,
    generatedAt: now
  });
  const snapshotArtifact = buildSnapshotArtifactContract({
    request,
    clientState,
    evidence,
    snapshotId,
    auditProofDigest,
    nextPersistedState,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    recoveryPaths,
    handoff,
    analytics,
    generatedAt: now
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    request,
    clientState,
    evidence,
    snapshotId,
    boundary,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    idempotentCommand,
    recoveryPaths,
    restartStatus,
    handoff,
    snapshotArtifact,
    generatedAt: now
  });
  const routePreview = buildRoutePreviewContract({
    request,
    clientState,
    snapshotId,
    previewAcceptance,
    snapshotArtifact,
    lifecycleSettings,
    providerContracts,
    operationalHealth,
    idempotentCommand,
    generatedAt: now
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contract: {
      kind: 'hosted-kernel-audit-recovery-snapshot',
      request,
      clientState,
      clientRuntime: {
        schemaVersion: clientState.runtime.schemaVersion,
        viewStateKey: clientState.runtime.viewStateKey,
        currentRoute: clientState.runtime.currentRoute,
        routeStack: clientState.runtime.routeStack,
        workflow: clientState.workflow,
        localCheckpoint: clientState.runtime.localCheckpoint,
        pendingHandoff: clientState.runtime.pendingHandoff
      },
      persistedState: {
        storageKey: nextPersistedState.storageKey,
        checkpointGeneration: nextPersistedState.checkpoint.generation,
        checkpointCursor: nextPersistedState.checkpoint.cursor,
        bootId: nextPersistedState.bootId,
        integrity: nextPersistedState.integrity,
        pendingRecovery: {
          requested: nextPersistedState.pendingRecovery.requested,
          status: nextPersistedState.pendingRecovery.status,
          targetRoute: nextPersistedState.pendingRecovery.targetRoute,
          resumeCursor: nextPersistedState.pendingRecovery.resumeCursor
        },
        recoveryLease: nextPersistedState.recoveryLease,
        restartProjection: {
          schemaVersion: nextPersistedState.restartProjection.schemaVersion,
          status: nextPersistedState.restartProjection.status,
          restartSafe: nextPersistedState.restartProjection.restartSafe,
          command: nextPersistedState.restartProjection.command,
          resumeToken: nextPersistedState.restartProjection.resumeToken,
          blockers: nextPersistedState.restartProjection.blockers,
          proofDigest: nextPersistedState.restartProjection.proof.digest
        }
      },
      evidenceLimit: MAX_EVIDENCE_ITEMS,
      evidenceCount: evidence.length,
      lifecycleSettings: {
        schemaVersion: lifecycleSettings.schemaVersion,
        enabled: lifecycleSettings.enabled,
        captureAllowed: lifecycleSettings.captureAllowed,
        retentionDays: lifecycleSettings.retention.days,
        schedule: lifecycleSettings.schedule,
        disableControl: lifecycleSettings.disableControl,
        command: lifecycleSettings.command,
        controls: lifecycleSettings.controls,
        validation: lifecycleSettings.validation,
        nextAction: lifecycleSettings.nextAction
      },
      boundary,
      providerContracts: {
        schemaVersion: providerContracts.schemaVersion,
        negotiation: providerContracts.negotiation,
        sync: providerContracts.sync,
        capabilityMatrix: providerContracts.capabilityMatrix
      },
      operationalHealth: {
        schemaVersion: operationalHealth.schemaVersion,
        state: operationalHealth.state,
        mode: operationalHealth.mode,
        canAcceptSnapshot: operationalHealth.canAcceptSnapshot,
        canQueueRecoveryHandoff: operationalHealth.canQueueRecoveryHandoff,
        degradedMode: operationalHealth.degradedMode,
        dependencies: operationalHealth.dependencies,
        dependencyProbes: {
          schemaVersion: operationalHealth.dependencyProbes.schemaVersion,
          summary: operationalHealth.dependencyProbes.summary,
          probes: operationalHealth.dependencyProbes.probes
        },
        degradedCapabilities: operationalHealth.degradedCapabilities,
        retryPolicy: operationalHealth.retryPolicy,
        failureState: operationalHealth.failureState,
        remediationPlan: operationalHealth.remediationPlan,
        actionableErrors: operationalHealth.actionableErrors.map((error) => ({
          code: error.code,
          domain: error.domain,
          severity: error.severity,
          retryable: error.retryable,
          blocksCapture: error.blocksCapture,
          blocksHandoff: error.blocksHandoff,
          action: error.action
        }))
      },
      analytics: {
        schemaVersion: analytics.summary.schemaVersion,
        summaryDigest: analytics.exports.summaryDigest,
        exportFormat: analytics.exports.format,
        exportRowCount: analytics.exports.rowCount
      },
      snapshotArtifact: {
        schemaVersion: snapshotArtifact.schemaVersion,
        contentType: snapshotArtifact.contentType,
        state: snapshotArtifact.state,
        exportable: snapshotArtifact.exportable,
        payloadDigest: snapshotArtifact.payloadDigest,
        proofDigest: snapshotArtifact.proof.digest,
        sectionDigests: snapshotArtifact.sectionDigests,
        providerWrites: snapshotArtifact.providerWrites.map((write) => ({
          service: write.service,
          writeMode: write.writeMode,
          accepted: write.accepted,
          status: write.status,
          payloadDigest: write.payloadDigest,
          syncCursor: write.syncCursor,
          ackRequired: write.ackRequired,
          ackedAt: write.ackedAt
        })),
        validation: snapshotArtifact.validation
      },
      clientWorkflow: {
        schemaVersion: handoff.clientWorkflow.schemaVersion,
        step: handoff.clientWorkflow.step,
        destination: handoff.clientWorkflow.destination,
        actionDigest: handoff.clientWorkflow.proof.actionDigest,
        resumeContract: handoff.clientWorkflow.resumeContract,
        actions: handoff.clientWorkflow.actions.map((action) => ({
          id: action.id,
          type: action.type,
          route: action.route,
          enabled: action.enabled,
          reason: action.reason,
          resumeToken: action.resumeToken || null
        }))
      },
      previewAcceptance: {
        schemaVersion: previewAcceptance.schemaVersion,
        preview: previewAcceptance.preview,
        acceptance: previewAcceptance.acceptance,
        readiness: previewAcceptance.readiness,
        validationSummary: previewAcceptance.validationSummary,
        nextSteps: previewAcceptance.nextSteps,
        auditDigest: previewAcceptance.audit.digest
      },
      routePreview: {
        schemaVersion: routePreview.schemaVersion,
        state: routePreview.state,
        route: routePreview.route,
        viewStateKey: routePreview.viewStateKey,
        clientCta: routePreview.clientCta,
        validationBadges: routePreview.validationBadges,
        routeBlockers: routePreview.routeBlockers,
        explainableNextStep: routePreview.explainableNextStep,
        readinessSummary: routePreview.readinessSummary,
        telemetry: routePreview.telemetry,
        auditDigest: routePreview.audit.digest
      }
    },
    snapshot: {
      id: snapshotId,
      status: operationalHealth.canAcceptSnapshot
        ? (evidence.length > 0 ? (operationalHealth.degradedMode ? 'captured-degraded' : 'captured') : 'empty')
        : 'blocked',
      route: request.route,
      source: request.source,
      actorId: request.actor.id,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      selectedSnapshot: clientState.selectedSnapshot.id || null,
      lifecycleNextAction: lifecycleSettings.nextAction,
      evidence
    },
    auditProof: {
      algorithm: 'sha256',
      digest: auditProofDigest,
      input: proofInput
    },
    persistence: {
      previous: persistedState,
      next: nextPersistedState,
      command: idempotentCommand,
      restartStatus
    },
    recoveryPaths,
    providerContracts,
    operationalHealth,
    handoff,
    snapshotArtifact,
    previewAcceptance,
    routePreview,
    analytics
  };
}

export default describeSnapshotSurface;
