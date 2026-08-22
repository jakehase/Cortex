export const surfaceId = "aios_package-sdk_compat-adapter_100";
export const surfaceGroup = "package-sdk";
export const surfaceName = "compat-adapter";

const DEFAULT_REQUIRED_KERNEL_CAPABILITIES = Object.freeze([
  'package.install',
  'package.resolve',
  'package.audit'
]);

const ACTION_BY_CODE = Object.freeze({
  MISSING_PACKAGE_ID: 'Provide package.id before attempting hosted-kernel compatibility resolution.',
  MISSING_PACKAGE_VERSION: 'Provide package.version so the adapter can produce deterministic audit proof.',
  INVALID_KERNEL_STATE: 'Wait for the hosted kernel to report ready or degraded before binding packages.',
  MISSING_KERNEL_CAPABILITY: 'Enable the missing hosted-kernel capability or route this package to a compatible kernel.',
  ADAPTER_RETRY_EXHAUSTED: 'Stop automatic retries and surface the last kernel error to the package installer.',
  ADAPTER_DEGRADED_MODE: 'Continue read-only package discovery, but block install and mutation operations.',
  ADAPTER_DISABLED: 'Enable the compat adapter before scheduling lifecycle work.',
  INVALID_LIFECYCLE_COMMAND: 'Use a supported lifecycle command: enable, disable, validate, install, refresh, or suspend.',
  INVALID_SCHEDULE_INTERVAL: 'Set schedule.intervalMs between 60000 and 86400000 for hosted-kernel package work.',
  INVALID_SCHEDULE_NEXT_RUN: 'Provide schedule.nextRunAt and schedule.pausedUntil as valid ISO timestamps.',
  INVALID_SCHEDULE_WINDOW: 'Use schedule.windowStart and schedule.windowEnd in HH:MM format with different values.',
  INVALID_SCHEDULE_CATCH_UP_MODE: 'Use catchUpMode skip, coalesce, or immediate for scheduled lifecycle work.',
  INVALID_CONCURRENCY_LIMIT: 'Set settings.maxConcurrentInstalls between 1 and 8.',
  INVALID_MUTATION_MODE: 'Use mutationMode read-only, guarded, or live for package lifecycle controls.',
  MISSING_PROVIDER_ID: 'Provide provider.id so hosted-kernel service handoff can be audited.',
  INVALID_PROVIDER_STATUS: 'Use provider status ready, degraded, disabled, or unavailable.',
  MISSING_PROVIDER_CAPABILITY: 'Bind a provider that can satisfy the package service capability contract.',
  INVALID_PROVIDER_SYNC_MODE: 'Use provider sync mode cursor, snapshot, event-log, or none.',
  PROVIDER_SYNC_CURSOR_REQUIRED: 'Provide provider.syncCursor when cursor sync is required for resumable metadata sync.',
  INVALID_PROVIDER_SCHEMA_VERSION: 'Publish a provider schema version that matches the hosted-kernel service contract.',
  INVALID_PROVIDER_HANDOFF_TTL: 'Set provider handoff ttlMs between 30000 and 3600000 for external provider leases.',
  PROVIDER_OPERATION_CAPABILITY_MISSING:
    'Advertise the provider capability required by each requested service operation before dispatch.',
  PROVIDER_HANDOFF_BLOCKED: 'Resolve provider contract issues before exporting external handoff state.',
  MISSING_CLIENT_REQUEST_ID: 'Attach a stable request.id so hosted-kernel workflow handoff can be resumed.',
  INVALID_CLIENT_CHANNEL: 'Use client channel cli, web, sdk, or worker for hosted-kernel workflow state.',
  CLIENT_PREVIEW_ACCEPTANCE_REQUIRED: 'Accept the generated compatibility preview before exporting provider handoff.',
  CLIENT_HANDOFF_RETURN_MISSING: 'Provide client.returnUrl or client.callbackRef before handing work to an external provider.',
  MISSING_TENANT_ID: 'Attach tenant.id so hosted-kernel package work is isolated before evaluation or handoff.',
  MISSING_WORKSPACE_ID: 'Attach workspace.id so package compatibility state is scoped to a single workspace.',
  TENANT_BOUNDARY_VIOLATION: 'Route the request through the tenant that owns the package, workspace, and provider contract.',
  WORKSPACE_SCOPE_DENIED: 'Bind the request to a workspace included in the actor or package boundary scope.',
  ROLE_PERMISSION_DENIED: 'Grant the actor a role or permission that covers the requested package lifecycle operation.',
  PERMISSION_GRANT_SCOPE_DENIED:
    'Use a tenant and workspace scoped permission grant that covers the requested hosted-kernel lifecycle operation.',
  AUDIT_HANDOFF_SCOPE_REQUIRED: 'Include tenant, workspace, actor, and trace references before exporting audit handoff proof.',
  PERSISTED_COMMAND_MISSING_FIELDS: 'Repair or discard the persisted hosted-kernel command before resuming lifecycle work.',
  PERSISTED_COMMAND_CONFLICT: 'Do not replay this idempotency key across a different package, command, or sync basis.',
  PERSISTED_COMMAND_TERMINAL_FAILURE: 'Inspect the recorded command failure and create a new idempotency key before retrying.',
  PERSISTED_COMMAND_CHECKPOINT_STALE: 'Revalidate compatibility against the current hosted-kernel state before dispatching work.',
  PERSISTED_COMMAND_LEASE_EXPIRED:
    'Treat the recovered pending command as abandoned, write a new lease, and resume only after the checkpoint is refreshed.',
  PERSISTED_COMMAND_RECOVERY_UNSAFE:
    'Require operator recovery because the persisted command lease cannot prove the command is safe to resume.',
  OPERATIONAL_BACKOFF_ACTIVE: 'Wait until the hosted-kernel retry backoff window expires before dispatching package work.',
  OPERATIONAL_FAILURE_STATE_ACTIVE:
    'Clear the adapter failure state or create a new idempotency key before retrying hosted-kernel package work.',
  OPERATIONAL_DEGRADED_MUTATION_BLOCKED:
    'Keep the adapter in read-only discovery mode until degraded hosted-kernel or provider health is resolved.'
});

const SUPPORTED_LIFECYCLE_COMMANDS = Object.freeze([
  'enable',
  'disable',
  'validate',
  'install',
  'refresh',
  'suspend'
]);

const SUPPORTED_MUTATION_MODES = Object.freeze(['read-only', 'guarded', 'live']);

const SUPPORTED_PROVIDER_STATUSES = Object.freeze(['ready', 'degraded', 'disabled', 'unavailable']);

const DEFAULT_PROVIDER_CAPABILITIES = Object.freeze(['metadata.sync', 'handoff.export']);

const SUPPORTED_PROVIDER_SYNC_MODES = Object.freeze(['cursor', 'snapshot', 'event-log', 'none']);

const PROVIDER_HANDOFF_TTL_LIMITS = Object.freeze({
  minMs: 30_000,
  maxMs: 3_600_000
});

const PROVIDER_OPERATION_CAPABILITY_REQUIREMENTS = Object.freeze({
  metadataSync: 'metadata.sync',
  handoffExport: 'handoff.export',
  installDispatch: 'package.install',
  auditProof: 'package.audit',
  previewAcceptance: 'preview.acceptance'
});

const PROVIDER_OPERATION_SYNC_REQUIREMENTS = Object.freeze({
  metadataSync: true,
  handoffExport: true,
  installDispatch: true,
  auditProof: false,
  previewAcceptance: false
});

const SUPPORTED_CLIENT_CHANNELS = Object.freeze(['cli', 'web', 'sdk', 'worker']);

const SUPPORTED_CLIENT_WORKFLOW_STATES = Object.freeze([
  'requested',
  'previewed',
  'accepted',
  'handoff-pending',
  'completed'
]);

const SUPPORTED_PERSISTED_COMMAND_STATES = Object.freeze([
  'not-started',
  'pending',
  'completed',
  'failed',
  'cancelled'
]);

const SUPPORTED_PERSISTED_RECOVERY_MODES = Object.freeze(['resume', 'replay', 'replace', 'manual']);

const PERSISTED_COMMAND_LEASE_LIMITS = Object.freeze({
  minTtlMs: 30_000,
  defaultTtlMs: 300_000,
  maxTtlMs: 3_600_000
});

const SUPPORTED_REPORT_EXPORT_FORMATS = Object.freeze(['json', 'ndjson', 'csv']);

const ROLE_PERMISSION_GRANTS = Object.freeze({
  viewer: ['package.read', 'package.validate'],
  auditor: ['package.read', 'package.validate', 'package.audit'],
  operator: ['package.read', 'package.validate', 'package.audit', 'package.schedule', 'handoff.export'],
  installer: ['package.read', 'package.validate', 'package.audit', 'package.install', 'package.schedule', 'handoff.export'],
  admin: [
    'package.read',
    'package.validate',
    'package.audit',
    'package.install',
    'package.schedule',
    'package.suspend',
    'package.admin',
    'handoff.export'
  ]
});

const OPERATION_PERMISSION_REQUIREMENTS = Object.freeze({
  discover: 'package.read',
  validate: 'package.validate',
  audit: 'package.audit',
  schedule: 'package.schedule',
  handoff: 'handoff.export',
  install: 'package.install',
  disable: 'package.admin',
  suspend: 'package.suspend',
  refresh: 'package.validate',
  enable: 'package.admin'
});

const SCHEDULE_INTERVAL_LIMITS = Object.freeze({
  minMs: 60_000,
  maxMs: 86_400_000
});

const SUPPORTED_SCHEDULE_CATCH_UP_MODES = Object.freeze(['skip', 'coalesce', 'immediate']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeClockMinute(value) {
  const raw = asNonEmptyString(value);
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return {
      raw: raw || null,
      minuteOfDay: null,
      valid: !raw
    };
  }

  return {
    raw,
    minuteOfDay: Number(match[1]) * 60 + Number(match[2]),
    valid: true
  };
}

function parseTimestampMs(value) {
  const raw = asNonEmptyString(value);
  const parsed = raw ? Date.parse(raw) : Number.NaN;

  return {
    raw: raw || null,
    ms: parsed,
    valid: !raw || Number.isFinite(parsed)
  };
}

function normalizeKernel(input) {
  const kernel = asObject(input.kernel);
  const state = asNonEmptyString(kernel.state || input.kernelState || 'unknown').toLowerCase();
  const capabilities = new Set(
    Array.isArray(kernel.capabilities) ? kernel.capabilities.filter((item) => typeof item === 'string') : []
  );

  return {
    id: asNonEmptyString(kernel.id || input.kernelId || 'hosted-kernel'),
    state,
    capabilities,
    lastError: asNonEmptyString(kernel.lastError || input.lastKernelError),
    degradedReason: asNonEmptyString(kernel.degradedReason || input.degradedReason)
  };
}

function normalizePackage(input) {
  const pkg = asObject(input.package);
  return {
    id: asNonEmptyString(pkg.id || input.packageId),
    version: asNonEmptyString(pkg.version || input.packageVersion),
    requestedCapabilities: Array.isArray(pkg.requiredKernelCapabilities)
      ? pkg.requiredKernelCapabilities.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : DEFAULT_REQUIRED_KERNEL_CAPABILITIES
  };
}

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map(asNonEmptyString).filter(Boolean))].sort();
}

function normalizeRequestedOperations(value, fallback) {
  const operations = normalizeStringList(value, fallback);
  return operations.filter((operation) =>
    ['discover', 'validate', 'install', 'schedule', 'handoff', 'audit', 'enable', 'disable', 'refresh', 'suspend'].includes(
      operation
    )
  );
}

function buildIssue(code, severity, detail = {}) {
  return {
    code,
    severity,
    actionable: true,
    action: ACTION_BY_CODE[code],
    ...detail
  };
}

function normalizeLifecycleSettings(input) {
  const settings = asObject(input.settings || input.adapterSettings);
  const schedule = asObject(input.schedule || settings.schedule);
  const rawCommand = asNonEmptyString(input.lifecycleCommand || input.command || settings.lifecycleCommand || 'validate')
    .toLowerCase();
  const mutationMode = asNonEmptyString(settings.mutationMode || input.mutationMode || 'guarded').toLowerCase();
  const intervalCandidate = Number(schedule.intervalMs ?? input.scheduleIntervalMs ?? 300_000);
  const intervalMs = Number.isFinite(intervalCandidate) ? Math.trunc(intervalCandidate) : 300_000;
  const maxConcurrentInstalls = Number(settings.maxConcurrentInstalls ?? input.maxConcurrentInstalls ?? 1);

  return {
    enabled: asBoolean(settings.enabled ?? input.enabled, true),
    lifecycleCommand: rawCommand,
    mutationMode,
    schedule: {
      enabled: asBoolean(schedule.enabled ?? input.scheduleEnabled, false),
      intervalMs,
      jitterMs: asBoundedInteger(schedule.jitterMs ?? input.scheduleJitterMs, 0, 0, 60_000),
      timezone: asNonEmptyString(schedule.timezone || input.scheduleTimezone || 'UTC'),
      nextRunAt: asNonEmptyString(schedule.nextRunAt || input.nextRunAt) || null,
      pausedUntil: asNonEmptyString(schedule.pausedUntil || input.schedulePausedUntil) || null,
      catchUpMode: asNonEmptyString(schedule.catchUpMode || input.scheduleCatchUpMode || 'coalesce').toLowerCase(),
      windowStart: asNonEmptyString(schedule.windowStart || input.scheduleWindowStart) || null,
      windowEnd: asNonEmptyString(schedule.windowEnd || input.scheduleWindowEnd) || null
    },
    maxConcurrentInstalls: Number.isFinite(maxConcurrentInstalls) ? Math.trunc(maxConcurrentInstalls) : 1,
    proofMode: asNonEmptyString(settings.proofMode || input.proofMode || 'audit'),
    requestedBy: asNonEmptyString(settings.requestedBy || input.requestedBy) || 'system',
    commandReason: asNonEmptyString(settings.commandReason || input.commandReason || input.reason) || null
  };
}

function validateLifecycleSettings(settings) {
  const issues = [];

  if (!SUPPORTED_LIFECYCLE_COMMANDS.includes(settings.lifecycleCommand)) {
    issues.push(buildIssue('INVALID_LIFECYCLE_COMMAND', 'error', {
      lifecycleCommand: settings.lifecycleCommand,
      supportedCommands: SUPPORTED_LIFECYCLE_COMMANDS
    }));
  }

  if (!SUPPORTED_MUTATION_MODES.includes(settings.mutationMode)) {
    issues.push(buildIssue('INVALID_MUTATION_MODE', 'error', {
      mutationMode: settings.mutationMode,
      supportedModes: SUPPORTED_MUTATION_MODES
    }));
  }

  if (
    settings.schedule.enabled &&
    (settings.schedule.intervalMs < SCHEDULE_INTERVAL_LIMITS.minMs ||
      settings.schedule.intervalMs > SCHEDULE_INTERVAL_LIMITS.maxMs)
  ) {
    issues.push(buildIssue('INVALID_SCHEDULE_INTERVAL', 'error', {
      intervalMs: settings.schedule.intervalMs,
      minMs: SCHEDULE_INTERVAL_LIMITS.minMs,
      maxMs: SCHEDULE_INTERVAL_LIMITS.maxMs
    }));
  }

  if (settings.schedule.enabled && !SUPPORTED_SCHEDULE_CATCH_UP_MODES.includes(settings.schedule.catchUpMode)) {
    issues.push(buildIssue('INVALID_SCHEDULE_CATCH_UP_MODE', 'error', {
      catchUpMode: settings.schedule.catchUpMode,
      supportedModes: SUPPORTED_SCHEDULE_CATCH_UP_MODES
    }));
  }

  for (const [field, timestamp] of [
    ['nextRunAt', settings.schedule.nextRunAt],
    ['pausedUntil', settings.schedule.pausedUntil]
  ]) {
    const parsed = parseTimestampMs(timestamp);
    if (!parsed.valid) {
      issues.push(buildIssue('INVALID_SCHEDULE_NEXT_RUN', 'error', {
        field,
        value: timestamp
      }));
    }
  }

  const windowStart = normalizeClockMinute(settings.schedule.windowStart);
  const windowEnd = normalizeClockMinute(settings.schedule.windowEnd);
  const hasPartialWindow = Boolean(settings.schedule.windowStart || settings.schedule.windowEnd);
  if (
    settings.schedule.enabled &&
    (hasPartialWindow &&
      (!windowStart.valid ||
        !windowEnd.valid ||
        !Number.isFinite(windowStart.minuteOfDay) ||
        !Number.isFinite(windowEnd.minuteOfDay) ||
        windowStart.minuteOfDay === windowEnd.minuteOfDay))
  ) {
    issues.push(buildIssue('INVALID_SCHEDULE_WINDOW', 'error', {
      windowStart: settings.schedule.windowStart,
      windowEnd: settings.schedule.windowEnd
    }));
  }

  if (settings.maxConcurrentInstalls < 1 || settings.maxConcurrentInstalls > 8) {
    issues.push(buildIssue('INVALID_CONCURRENCY_LIMIT', 'error', {
      maxConcurrentInstalls: settings.maxConcurrentInstalls,
      min: 1,
      max: 8
    }));
  }

  if (!settings.enabled && !['enable', 'validate'].includes(settings.lifecycleCommand)) {
    issues.push(buildIssue('ADAPTER_DISABLED', 'error', {
      lifecycleCommand: settings.lifecycleCommand,
      enabled: false
    }));
  }

  return issues;
}

function isMinuteInsideWindow(minuteOfDay, windowStart, windowEnd) {
  if (!Number.isFinite(windowStart.minuteOfDay) || !Number.isFinite(windowEnd.minuteOfDay)) {
    return true;
  }

  if (windowStart.minuteOfDay < windowEnd.minuteOfDay) {
    return minuteOfDay >= windowStart.minuteOfDay && minuteOfDay < windowEnd.minuteOfDay;
  }

  return minuteOfDay >= windowStart.minuteOfDay || minuteOfDay < windowEnd.minuteOfDay;
}

function buildScheduleControl(now, settings, blockingIssues) {
  const nowMs = Date.parse(now);
  const nextRun = parseTimestampMs(settings.schedule.nextRunAt);
  const pausedUntil = parseTimestampMs(settings.schedule.pausedUntil);
  const windowStart = normalizeClockMinute(settings.schedule.windowStart);
  const windowEnd = normalizeClockMinute(settings.schedule.windowEnd);
  const nowDate = Number.isFinite(nowMs) ? new Date(nowMs) : new Date();
  const minuteOfDay = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
  const blocked = blockingIssues.length > 0;
  const paused =
    Number.isFinite(pausedUntil.ms) && Number.isFinite(nowMs) && pausedUntil.ms > nowMs;
  const withinWindow = isMinuteInsideWindow(minuteOfDay, windowStart, windowEnd);
  const due =
    settings.schedule.enabled &&
    Number.isFinite(nextRun.ms) &&
    Number.isFinite(nowMs) &&
    nextRun.ms <= nowMs;
  const missedByMs = due ? Math.max(0, nowMs - nextRun.ms) : 0;
  const catchUpRequired = missedByMs >= settings.schedule.intervalMs;
  const dispatchable =
    settings.enabled &&
    settings.schedule.enabled &&
    !blocked &&
    !paused &&
    withinWindow &&
    (due || !settings.schedule.nextRunAt);
  const state = !settings.schedule.enabled
    ? 'not-scheduled'
    : blocked
      ? 'blocked'
      : paused
        ? 'paused'
        : !withinWindow
          ? 'outside-window'
          : dispatchable
            ? 'dispatchable'
            : 'armed';

  return {
    state,
    active: settings.enabled && settings.schedule.enabled && !blocked,
    dispatchable,
    due,
    catchUpRequired,
    catchUpMode: settings.schedule.catchUpMode,
    missedByMs,
    nextRunAt: settings.schedule.nextRunAt,
    pausedUntil: settings.schedule.pausedUntil,
    window: {
      timezone: settings.schedule.timezone,
      evaluatedIn: 'UTC',
      start: windowStart.raw,
      end: windowEnd.raw,
      withinWindow
    },
    blockedBy: blockingIssues.map((issue) => issue.code)
  };
}

function buildLifecycleTransition(settings, compatibility, blockingIssues) {
  const blockingIssueCodes = blockingIssues.map((issue) => issue.code);
  const targetEnabled =
    settings.lifecycleCommand === 'enable'
      ? true
      : ['disable', 'suspend'].includes(settings.lifecycleCommand)
        ? false
        : settings.enabled;
  const writesSetting = ['enable', 'disable', 'suspend'].includes(settings.lifecycleCommand);
  const mutationIntent =
    settings.lifecycleCommand === 'install'
      ? 'package-install'
      : writesSetting
        ? 'adapter-setting'
        : settings.schedule.enabled
          ? 'scheduled-validation'
          : 'read-model';

  return {
    command: settings.lifecycleCommand,
    mutationIntent,
    targetEnabled,
    writesSetting,
    reason: settings.commandReason,
    allowed: blockingIssues.length === 0 && (settings.lifecycleCommand !== 'install' || compatibility.healthState === 'healthy'),
    blockedBy: blockingIssueCodes,
    statePatch: writesSetting
      ? {
          settings: {
            enabled: targetEnabled,
            suspended: settings.lifecycleCommand === 'suspend',
            lastLifecycleCommand: settings.lifecycleCommand,
            lastLifecycleReason: settings.commandReason
          }
        }
      : null
  };
}

function normalizeClientRuntimeState(input, lifecycleSettings) {
  const request = asObject(input.request || input.requestContext);
  const client = asObject(input.client || input.clientRuntime);
  const handoff = asObject(input.clientHandoff || client.handoff);
  const rawChannel = asNonEmptyString(client.channel || request.channel || input.clientChannel || 'sdk').toLowerCase();
  const requestedOperations = normalizeRequestedOperations(
    client.requestedOperations || request.requestedOperations || input.requestedOperations,
    lifecycleSettings.lifecycleCommand === 'install' ? ['validate', 'install', 'audit'] : ['validate', 'audit']
  );
  const acceptedPreviewToken = asNonEmptyString(
    client.acceptedPreviewToken || request.acceptedPreviewToken || input.acceptedPreviewToken
  );
  const returnUrl = asNonEmptyString(handoff.returnUrl || client.returnUrl || request.returnUrl || input.returnUrl);
  const callbackRef = asNonEmptyString(
    handoff.callbackRef || client.callbackRef || request.callbackRef || input.callbackRef
  );
  const handoffRequested = asBoolean(
    handoff.requested ?? client.handoffRequested ?? request.handoffRequested ?? input.handoffRequested,
    requestedOperations.includes('handoff')
  );

  return {
    contractVersion: 1,
    request: {
      id: asNonEmptyString(request.id || request.requestId || input.requestId),
      traceId: asNonEmptyString(request.traceId || input.traceId) || null,
      idempotencyKey: asNonEmptyString(request.idempotencyKey || input.idempotencyKey) || null
    },
    client: {
      id: asNonEmptyString(client.id || input.clientId) || null,
      channel: rawChannel,
      workflowState: asNonEmptyString(client.workflowState || request.workflowState || 'requested').toLowerCase(),
      requestedOperations,
      acceptedPreviewToken: acceptedPreviewToken || null
    },
    handoff: {
      requested: handoffRequested,
      returnUrl: returnUrl || null,
      callbackRef: callbackRef || null,
      resumeToken: asNonEmptyString(handoff.resumeToken || client.resumeToken || input.resumeToken) || null
    }
  };
}

function validateClientRuntimeState(clientRuntime) {
  const issues = [];

  if (!clientRuntime.request.id) {
    issues.push(buildIssue('MISSING_CLIENT_REQUEST_ID', 'warning', {
      channel: clientRuntime.client.channel
    }));
  }

  if (!SUPPORTED_CLIENT_CHANNELS.includes(clientRuntime.client.channel)) {
    issues.push(buildIssue('INVALID_CLIENT_CHANNEL', 'error', {
      channel: clientRuntime.client.channel,
      supportedChannels: SUPPORTED_CLIENT_CHANNELS
    }));
  }

  if (!SUPPORTED_CLIENT_WORKFLOW_STATES.includes(clientRuntime.client.workflowState)) {
    issues.push(buildIssue('CLIENT_PREVIEW_ACCEPTANCE_REQUIRED', 'error', {
      workflowState: clientRuntime.client.workflowState,
      supportedWorkflowStates: SUPPORTED_CLIENT_WORKFLOW_STATES
    }));
  }

  if (clientRuntime.handoff.requested && !clientRuntime.client.acceptedPreviewToken) {
    issues.push(buildIssue('CLIENT_PREVIEW_ACCEPTANCE_REQUIRED', 'error', {
      requestId: clientRuntime.request.id || null,
      requestedOperations: clientRuntime.client.requestedOperations
    }));
  }

  if (clientRuntime.handoff.requested && !clientRuntime.handoff.returnUrl && !clientRuntime.handoff.callbackRef) {
    issues.push(buildIssue('CLIENT_HANDOFF_RETURN_MISSING', 'error', {
      requestId: clientRuntime.request.id || null,
      channel: clientRuntime.client.channel
    }));
  }

  return issues;
}

function normalizeRoleList(value, fallback = ['viewer']) {
  const source = typeof value === 'string' ? [value] : value;
  return normalizeStringList(source, fallback).filter((role) => ROLE_PERMISSION_GRANTS[role]);
}

function buildGrantedPermissions(roles, explicitPermissions) {
  const permissionSource = typeof explicitPermissions === 'string' ? [explicitPermissions] : explicitPermissions;
  const granted = new Set(normalizeStringList(permissionSource));

  for (const role of roles) {
    for (const permission of ROLE_PERMISSION_GRANTS[role] || []) {
      granted.add(permission);
    }
  }

  return [...granted].sort();
}

function normalizePermissionGrantList(value, fallbackSource = 'actor') {
  const source = Array.isArray(value) ? value : [];

  return source
    .map((item, index) => {
      const grant = asObject(item);
      const permission = asNonEmptyString(grant.permission || grant.name || grant.capability);
      const workspaceIds = normalizeStringList(grant.workspaceIds || grant.allowedWorkspaceIds);
      const workspaceId = asNonEmptyString(grant.workspaceId || grant.projectId);
      const operations = normalizeRequestedOperations(grant.operations || grant.requestedOperations, []);

      return {
        id: asNonEmptyString(grant.id || grant.grantId) || `${fallbackSource}-grant-${index}`,
        permission,
        operations,
        tenantId: asNonEmptyString(grant.tenantId || grant.orgId) || null,
        workspaceIds: workspaceIds.length ? workspaceIds : workspaceId ? [workspaceId] : [],
        expiresAt: asNonEmptyString(grant.expiresAt || grant.validUntil) || null,
        source: asNonEmptyString(grant.source || grant.issuer || fallbackSource)
      };
    })
    .filter((grant) => grant.permission);
}

function grantCoversBoundary(grant, tenantId, workspaceId, operation, evaluatedAt) {
  const expiresAtMs = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const expired = Number.isFinite(expiresAtMs) && Number.isFinite(evaluatedAtMs) && expiresAtMs <= evaluatedAtMs;
  const tenantMatches = !grant.tenantId || !tenantId || grant.tenantId === tenantId;
  const workspaceMatches = !grant.workspaceIds.length || !workspaceId || grant.workspaceIds.includes(workspaceId);
  const operationMatches = !grant.operations.length || grant.operations.includes(operation);

  return {
    expired,
    tenantMatches,
    workspaceMatches,
    operationMatches,
    scopeMatched: !expired && tenantMatches && workspaceMatches && operationMatches
  };
}

function buildWorkspaceScopeLane(label, workspaceId, workspaceIds = []) {
  const allowedWorkspaceIds = normalizeStringList(workspaceIds);

  return {
    label,
    workspaceId: workspaceId || null,
    allowedWorkspaceIds,
    constrained: allowedWorkspaceIds.length > 0,
    matched: !workspaceId || allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(workspaceId)
  };
}

function buildWorkspaceScopePolicy(workspaceId, actor, scope, pkg, provider, requestedOperations) {
  const actorReadWorkspaceIds = normalizeStringList(
    actor.readWorkspaceIds ||
      actor.workspaceIds ||
      actor.allowedWorkspaceIds ||
      scope.actorReadWorkspaceIds ||
      scope.actorWorkspaceIds ||
      scope.allowedWorkspaceIds
  );
  const actorWriteWorkspaceIds = normalizeStringList(
    actor.writeWorkspaceIds ||
      actor.mutableWorkspaceIds ||
      actor.adminWorkspaceIds ||
      scope.actorWriteWorkspaceIds ||
      scope.mutableWorkspaceIds
  );
  const packageWorkspaceIds = normalizeStringList(
    scope.packageWorkspaceIds || scope.workspaceIds || scope.allowedWorkspaceIds || pkg.allowedWorkspaceIds
  );
  const providerWorkspaceId = asNonEmptyString(provider.workspaceId || provider.projectId);
  const providerWorkspaceIds = normalizeStringList(
    provider.workspaceIds || provider.allowedWorkspaceIds || scope.providerWorkspaceIds
  );
  const mutationOperations = requestedOperations.filter((operation) =>
    ['install', 'schedule', 'handoff', 'enable', 'disable', 'suspend'].includes(operation)
  );
  const lanes = [
    buildWorkspaceScopeLane('actor-read', workspaceId, actorReadWorkspaceIds),
    buildWorkspaceScopeLane('actor-write', workspaceId, actorWriteWorkspaceIds),
    buildWorkspaceScopeLane('package', workspaceId, packageWorkspaceIds),
    buildWorkspaceScopeLane('provider', workspaceId, providerWorkspaceIds)
  ];

  return {
    mode: lanes.some((lane) => lane.constrained) ? 'lane-scoped' : 'single-workspace',
    writeRequired: mutationOperations.length > 0,
    mutationOperations,
    actorReadWorkspaceIds,
    actorWriteWorkspaceIds,
    packageWorkspaceIds,
    providerWorkspaceId: providerWorkspaceId || null,
    providerWorkspaceIds,
    lanes,
    deniedLanes: lanes
      .filter((lane) => {
        if (lane.label === 'actor-write' && !mutationOperations.length) {
          return false;
        }

        return lane.constrained && !lane.matched;
      })
      .map((lane) => lane.label)
  };
}

function buildOperationAuthorization(requestedOperations, actor, tenantId, workspaceId, evaluatedAt) {
  return requestedOperations
    .map((operation) => {
      const permission = OPERATION_PERMISSION_REQUIREMENTS[operation];
      if (!permission) {
        return null;
      }

      const matchingGrants = actor.permissionGrants
        .filter((grant) => grant.permission === permission)
        .map((grant) => ({
          ...grant,
          coverage: grantCoversBoundary(grant, tenantId, workspaceId, operation, evaluatedAt)
        }));
      const scopedGrant = matchingGrants.find((grant) => grant.coverage.scopeMatched);
      const roleOrExplicitGrant = actor.permissions.includes(permission);
      const granted = Boolean(scopedGrant || (roleOrExplicitGrant && matchingGrants.length === 0));

      return {
        operation,
        permission,
        granted,
        grantSource: scopedGrant ? scopedGrant.source : roleOrExplicitGrant ? 'role-or-explicit-permission' : null,
        grantId: scopedGrant ? scopedGrant.id : null,
        scopedGrantRequired: matchingGrants.length > 0,
        scopedGrantMatched: Boolean(scopedGrant),
        roleOrExplicitGrant,
        deniedBy: granted
          ? []
          : matchingGrants.length
            ? [
                ...new Set(
                  matchingGrants.flatMap((grant) => [
                    grant.coverage.expired ? 'expired' : null,
                    grant.coverage.tenantMatches ? null : 'tenant-scope',
                    grant.coverage.workspaceMatches ? null : 'workspace-scope',
                    grant.coverage.operationMatches ? null : 'operation-scope'
                  ])
                )
              ].filter(Boolean)
            : ['missing-permission']
      };
    })
    .filter(Boolean);
}

function buildBoundaryAuditContract(boundaryContext, workspaceScopePolicy, operationAuthorization) {
  const deniedOperations = operationAuthorization.filter((authorization) => !authorization.granted);
  const scopedOperations = operationAuthorization.filter((authorization) => authorization.scopedGrantRequired);
  const grantProofs = operationAuthorization.map((authorization) => ({
    operation: authorization.operation,
    permission: authorization.permission,
    granted: authorization.granted,
    source: authorization.grantSource,
    grantId: authorization.grantId,
    scopedGrantRequired: authorization.scopedGrantRequired,
    scopedGrantMatched: authorization.scopedGrantMatched,
    deniedBy: authorization.deniedBy
  }));
  const workspaceLaneProofs = workspaceScopePolicy.lanes.map((lane) => ({
    lane: lane.label,
    constrained: lane.constrained,
    matched: lane.matched,
    workspaceId: lane.workspaceId,
    allowedWorkspaceIds: lane.allowedWorkspaceIds
  }));
  const mutationOperations = workspaceScopePolicy.mutationOperations;
  const handoffOperations = ['handoff', 'install', 'schedule'].filter((operation) =>
    boundaryContext.requestedOperations.includes(operation)
  );
  const handoffOperationProofs = grantProofs.filter((proof) => handoffOperations.includes(proof.operation));
  const handoffSafe =
    Boolean(boundaryContext.tenant.id) &&
    Boolean(boundaryContext.workspace.id) &&
    Boolean(boundaryContext.actor.id) &&
    workspaceScopePolicy.deniedLanes.length === 0 &&
    deniedOperations.length === 0 &&
    handoffOperations.every((operation) =>
      operationAuthorization.some((authorization) => authorization.operation === operation && authorization.granted)
    );
  const blockingReasons = [
    boundaryContext.tenant.id ? null : 'missing-tenant',
    boundaryContext.workspace.id ? null : 'missing-workspace',
    boundaryContext.actor.id ? null : 'missing-actor',
    ...workspaceScopePolicy.deniedLanes.map((lane) => `workspace-${lane}`),
    ...deniedOperations.map((authorization) => `permission-${authorization.operation}`)
  ].filter(Boolean);

  return {
    contractVersion: 1,
    isolationMode: workspaceScopePolicy.mode,
    scopeKey: [boundaryContext.tenant.id || 'missing-tenant', boundaryContext.workspace.id || 'missing-workspace'].join(':'),
    actorRef: boundaryContext.actor.id,
    requestedOperations: boundaryContext.requestedOperations,
    mutationOperations,
    handoffOperations,
    requiredPermissions: boundaryContext.requiredPermissions,
    authorizedOperations: operationAuthorization
      .filter((authorization) => authorization.granted)
      .map((authorization) => authorization.operation)
      .sort(),
    deniedOperations: deniedOperations.map((authorization) => authorization.operation).sort(),
    scopedGrantRequired: scopedOperations.length > 0,
    scopedGrantMatched: scopedOperations.every((authorization) => authorization.scopedGrantMatched),
    handoffSafe,
    blockingReasons: [...new Set(blockingReasons)].sort(),
    grantProofs,
    handoffOperationProofs,
    workspaceLaneProofs,
    proofRefs: {
      permissionProofKey: grantProofs
        .map((proof) => [
          proof.operation,
          proof.permission,
          proof.granted ? 'granted' : 'denied',
          proof.grantId || proof.source || 'unscoped',
          proof.deniedBy.join(',')
        ].join(':'))
        .join('|'),
      workspaceProofKey: workspaceLaneProofs
        .map((proof) => [
          proof.lane,
          proof.constrained ? proof.allowedWorkspaceIds.join(',') || 'empty' : 'unconstrained',
          proof.matched ? 'matched' : 'denied'
        ].join(':'))
        .join('|'),
      handoffProofKey: [
        boundaryContext.tenant.id || 'missing-tenant',
        boundaryContext.workspace.id || 'missing-workspace',
        boundaryContext.actor.id || 'missing-actor',
        handoffOperations.join(',') || 'no-handoff-operation',
        handoffSafe ? 'handoff-safe' : 'handoff-blocked'
      ].join('|')
    }
  };
}

function buildBoundaryContext(input, lifecycleSettings, clientRuntime, now) {
  const scope = asObject(input.scope || input.boundary || input.workspaceScope);
  const tenant = asObject(input.tenant || scope.tenant);
  const workspace = asObject(input.workspace || scope.workspace);
  const actor = asObject(input.actor || input.principal || input.user || scope.actor);
  const pkg = asObject(input.package);
  const provider = asObject(input.provider || input.serviceProvider);
  const tenantId = asNonEmptyString(tenant.id || scope.tenantId || input.tenantId || input.orgId);
  const workspaceId = asNonEmptyString(workspace.id || scope.workspaceId || input.workspaceId || input.projectId);
  const packageTenantId = asNonEmptyString(pkg.tenantId || pkg.orgId || input.packageTenantId);
  const packageWorkspaceId = asNonEmptyString(pkg.workspaceId || pkg.projectId || input.packageWorkspaceId);
  const providerTenantId = asNonEmptyString(provider.tenantId || provider.orgId || input.providerTenantId);
  const roles = normalizeRoleList(actor.roles || actor.role || input.roles || input.role);
  const permissions = buildGrantedPermissions(roles, actor.permissions || input.permissions);
  const permissionGrants = normalizePermissionGrantList(
    actor.permissionGrants || actor.grants || actor.entitlements || scope.permissionGrants || input.permissionGrants,
    'actor'
  );
  const requestedOperations = normalizeRequestedOperations(
    [
      ...clientRuntime.client.requestedOperations,
      lifecycleSettings.lifecycleCommand,
      ...(lifecycleSettings.schedule.enabled ? ['schedule'] : []),
      ...(clientRuntime.handoff.requested ? ['handoff'] : [])
    ],
    ['validate', 'audit']
  );
  const workspaceScopePolicy = buildWorkspaceScopePolicy(workspaceId || null, actor, scope, pkg, provider, requestedOperations);
  const requiredPermissions = [
    ...new Set(
      requestedOperations.map((operation) => OPERATION_PERMISSION_REQUIREMENTS[operation]).filter(Boolean)
    )
  ].sort();
  const operationAuthorization = buildOperationAuthorization(
    requestedOperations,
    { permissions, permissionGrants },
    tenantId || null,
    workspaceId || null,
    now
  );
  const allowedWorkspaceIds = normalizeStringList([
    ...workspaceScopePolicy.actorReadWorkspaceIds,
    ...workspaceScopePolicy.actorWriteWorkspaceIds,
    ...workspaceScopePolicy.packageWorkspaceIds
  ]);
  const boundarySeed = {
    tenant: {
      id: tenantId || null
    },
    workspace: {
      id: workspaceId || null
    },
    actor: {
      id: asNonEmptyString(actor.id || actor.actorId || input.actorId) || null
    },
    requestedOperations,
    requiredPermissions
  };
  const auditContract = buildBoundaryAuditContract(boundarySeed, workspaceScopePolicy, operationAuthorization);

  return {
    contractVersion: 1,
    tenant: {
      id: tenantId || null,
      packageTenantId: packageTenantId || null,
      providerTenantId: providerTenantId || null
    },
    workspace: {
      id: workspaceId || null,
      packageWorkspaceId: packageWorkspaceId || null,
      providerWorkspaceId: workspaceScopePolicy.providerWorkspaceId,
      allowedWorkspaceIds,
      scopeMode: workspaceScopePolicy.mode,
      scopePolicy: workspaceScopePolicy
    },
    actor: {
      id: asNonEmptyString(actor.id || actor.actorId || input.actorId) || null,
      type: asNonEmptyString(actor.type || input.actorType || 'user'),
      roles,
      permissions,
      permissionGrants,
      requestedBy: lifecycleSettings.requestedBy
    },
    requestedOperations,
    requiredPermissions,
    operationAuthorization,
    permissionBoundary: auditContract,
    audit: {
      traceId: clientRuntime.request.traceId,
      requestId: clientRuntime.request.id || null,
      idempotencyKey: clientRuntime.request.idempotencyKey,
      scopeKey: auditContract.scopeKey,
      permissionProofKey: auditContract.proofRefs.permissionProofKey,
      workspaceProofKey: auditContract.proofRefs.workspaceProofKey,
      handoffProofKey: auditContract.proofRefs.handoffProofKey,
      handoffSafe: auditContract.handoffSafe,
      blockingReasons: auditContract.blockingReasons
    }
  };
}

function validateBoundaryContext(boundaryContext, clientRuntime) {
  const issues = [];
  const { tenant, workspace, actor } = boundaryContext;

  if (!tenant.id) {
    issues.push(buildIssue('MISSING_TENANT_ID', 'error', {
      requestedOperations: boundaryContext.requestedOperations
    }));
  }

  if (!workspace.id) {
    issues.push(buildIssue('MISSING_WORKSPACE_ID', 'error', {
      tenantId: tenant.id || null,
      requestedOperations: boundaryContext.requestedOperations
    }));
  }

  for (const targetTenantId of [tenant.packageTenantId, tenant.providerTenantId].filter(Boolean)) {
    if (tenant.id && targetTenantId !== tenant.id) {
      issues.push(buildIssue('TENANT_BOUNDARY_VIOLATION', 'error', {
        tenantId: tenant.id,
        targetTenantId
      }));
    }
  }

  if (workspace.packageWorkspaceId && workspace.id && workspace.packageWorkspaceId !== workspace.id) {
    issues.push(buildIssue('WORKSPACE_SCOPE_DENIED', 'error', {
      workspaceId: workspace.id,
      packageWorkspaceId: workspace.packageWorkspaceId
    }));
  }

  if (workspace.providerWorkspaceId && workspace.id && workspace.providerWorkspaceId !== workspace.id) {
    issues.push(buildIssue('WORKSPACE_SCOPE_DENIED', 'error', {
      workspaceId: workspace.id,
      providerWorkspaceId: workspace.providerWorkspaceId,
      scopeLane: 'provider'
    }));
  }

  if (workspace.allowedWorkspaceIds.length && workspace.id && !workspace.allowedWorkspaceIds.includes(workspace.id)) {
    issues.push(buildIssue('WORKSPACE_SCOPE_DENIED', 'error', {
      workspaceId: workspace.id,
      allowedWorkspaceIds: workspace.allowedWorkspaceIds
    }));
  }

  for (const deniedLane of workspace.scopePolicy.deniedLanes) {
    issues.push(buildIssue('WORKSPACE_SCOPE_DENIED', 'error', {
      workspaceId: workspace.id,
      scopeLane: deniedLane,
      allowedWorkspaceIds:
        workspace.scopePolicy.lanes.find((lane) => lane.label === deniedLane)?.allowedWorkspaceIds || [],
      mutationOperations:
        deniedLane === 'actor-write' ? workspace.scopePolicy.mutationOperations : []
    }));
  }

  for (const authorization of boundaryContext.operationAuthorization) {
    if (authorization.granted) {
      continue;
    }

    if (authorization.deniedBy.includes('missing-permission')) {
      issues.push(buildIssue('ROLE_PERMISSION_DENIED', 'error', {
        actorId: actor.id,
        roles: actor.roles,
        permission: authorization.permission,
        operation: authorization.operation,
        requestedOperations: boundaryContext.requestedOperations
      }));
      continue;
    }

    issues.push(buildIssue('PERMISSION_GRANT_SCOPE_DENIED', 'error', {
      actorId: actor.id,
      permission: authorization.permission,
      operation: authorization.operation,
      tenantId: tenant.id,
      workspaceId: workspace.id,
      deniedBy: authorization.deniedBy
    }));
  }

  if (
    clientRuntime.handoff.requested &&
    (!tenant.id || !workspace.id || !actor.id || !boundaryContext.audit.traceId || !boundaryContext.permissionBoundary.handoffSafe)
  ) {
    issues.push(buildIssue('AUDIT_HANDOFF_SCOPE_REQUIRED', 'error', {
      tenantId: tenant.id,
      workspaceId: workspace.id,
      actorId: actor.id,
      traceId: boundaryContext.audit.traceId,
      handoffSafe: boundaryContext.permissionBoundary.handoffSafe,
      blockingReasons: boundaryContext.permissionBoundary.blockingReasons
    }));
  }

  return issues;
}

function buildLifecycleControls(now, compatibility, settings, clientIssues = [], boundaryIssues = []) {
  const lifecycleIssues = validateLifecycleSettings(settings);
  const blockingIssues = [
    ...compatibility.issues,
    ...compatibility.providerIssues,
    ...lifecycleIssues,
    ...clientIssues,
    ...boundaryIssues
  ].filter((issue) => issue.severity === 'error');
  const mutationRequested = ['install', 'disable', 'suspend'].includes(settings.lifecycleCommand);
  const mutationBlocked =
    settings.mutationMode === 'read-only' ||
    compatibility.healthState === 'degraded' ||
    blockingIssues.length > 0;
  const installEligible =
    settings.enabled &&
    settings.lifecycleCommand === 'install' &&
    settings.mutationMode === 'live' &&
    compatibility.healthState === 'healthy' &&
    blockingIssues.length === 0;
  const scheduleControl = buildScheduleControl(now, settings, blockingIssues);
  const transition = buildLifecycleTransition(settings, compatibility, blockingIssues);
  const scheduleActive = scheduleControl.active;
  const scheduledNextAction =
    scheduleControl.state === 'paused' || scheduleControl.state === 'outside-window'
      ? 'wait-for-schedule-window'
      : 'wait-for-scheduled-run';
  const nextAction = blockingIssues.length
    ? 'resolve-blocking-issues'
    : installEligible
      ? 'dispatch-install'
      : scheduleControl.dispatchable
        ? 'dispatch-scheduled-lifecycle'
        : scheduleActive
          ? scheduledNextAction
        : settings.lifecycleCommand === 'enable'
          ? 'persist-enabled-setting'
          : settings.lifecycleCommand === 'disable'
            ? 'persist-disabled-setting'
            : mutationRequested && mutationBlocked
              ? 'hold-mutation'
              : 'report-compatibility';

  return {
    command: settings.lifecycleCommand,
    enabled: settings.enabled,
    mutationMode: settings.mutationMode,
    requestedBy: settings.requestedBy,
    accepted: blockingIssues.length === 0,
    installEligible,
    mutationBlocked,
    transition,
    scheduling: {
      enabled: settings.schedule.enabled,
      active: scheduleActive,
      state: scheduleControl.state,
      dispatchable: scheduleControl.dispatchable,
      due: scheduleControl.due,
      catchUpRequired: scheduleControl.catchUpRequired,
      catchUpMode: scheduleControl.catchUpMode,
      missedByMs: scheduleControl.missedByMs,
      intervalMs: settings.schedule.intervalMs,
      jitterMs: settings.schedule.jitterMs,
      timezone: settings.schedule.timezone,
      nextRunAt: scheduleActive ? settings.schedule.nextRunAt : null,
      pausedUntil: settings.schedule.pausedUntil,
      window: scheduleControl.window,
      blockedBy: scheduleControl.blockedBy
    },
    concurrency: {
      maxConcurrentInstalls: settings.maxConcurrentInstalls,
      availableInstallSlots: installEligible ? settings.maxConcurrentInstalls : 0
    },
    nextAction: {
      state: nextAction,
      generatedAt: now,
      retryAfterMs: compatibility.retryPolicy.retryable ? compatibility.retryPolicy.nextDelayMs : 0,
      blockedBy: blockingIssues.map((issue) => issue.code)
    },
    issues: lifecycleIssues
  };
}

function normalizeProviderContract(input, pkg) {
  const provider = asObject(input.provider || input.serviceProvider);
  const service = asObject(input.service || input.serviceContract);
  const sync = asObject(provider.sync || service.sync || input.providerSync);
  const handoff = asObject(provider.handoff || service.handoff || input.providerHandoff);
  const providerRouting = asObject(provider.routing || service.routing || input.providerRouting);
  const hasProviderInput = Boolean(input.provider || input.serviceProvider || input.providerId || input.providerCapabilities);
  const requestedServiceCapabilities = normalizeStringList(
    service.requiredCapabilities || input.requiredServiceCapabilities,
    DEFAULT_PROVIDER_CAPABILITIES
  );
  const optionalServiceCapabilities = normalizeStringList(
    service.optionalCapabilities || input.optionalServiceCapabilities,
    []
  );
  const providerCapabilities = normalizeStringList(
    provider.capabilities || input.providerCapabilities,
    hasProviderInput ? [] : DEFAULT_PROVIDER_CAPABILITIES
  );
  const status = asNonEmptyString(provider.status || input.providerStatus || (hasProviderInput ? 'unavailable' : 'ready'))
    .toLowerCase();
  const requestedOperations = normalizeStringList(
    service.operations || service.requestedOperations || input.providerOperations,
    ['metadataSync']
  ).filter((operation) => PROVIDER_OPERATION_CAPABILITY_REQUIREMENTS[operation]);
  const syncMode = asNonEmptyString(
    sync.mode || service.syncMode || input.providerSyncMode || (hasProviderInput ? 'cursor' : 'none')
  ).toLowerCase();
  const schemaVersion = asNonEmptyString(
    provider.schemaVersion || service.schemaVersion || input.providerSchemaVersion || service.contractVersion
  );
  const handoffTtlCandidate = Number(handoff.ttlMs ?? service.handoffTtlMs ?? input.providerHandoffTtlMs ?? 900_000);
  const handoffTtlMs = Number.isFinite(handoffTtlCandidate) ? Math.trunc(handoffTtlCandidate) : 900_000;

  return {
    serviceRef: asNonEmptyString(service.ref || service.id || input.serviceRef) || `${pkg.id || 'unknown'}:compat`,
    contractVersion: asNonEmptyString(service.contractVersion || input.serviceContractVersion || '2026-07-compat-v1'),
    provider: {
      id: asNonEmptyString(provider.id || input.providerId) || (hasProviderInput ? '' : 'hosted-kernel-internal'),
      status,
      capabilities: providerCapabilities,
      endpoint: asNonEmptyString(provider.endpoint || input.providerEndpoint) || null,
      syncCursor: asNonEmptyString(provider.syncCursor || input.providerSyncCursor) || null,
      handoffChannel: asNonEmptyString(provider.handoffChannel || input.handoffChannel || 'hosted-kernel'),
      schemaVersion: schemaVersion || null,
      resourceVersion: asNonEmptyString(provider.resourceVersion || sync.resourceVersion || input.providerResourceVersion) || null,
      lastSyncedAt: asNonEmptyString(provider.lastSyncedAt || sync.lastSyncedAt || input.providerLastSyncedAt) || null
    },
    sync: {
      mode: syncMode,
      cursorRequired: asBoolean(
        sync.cursorRequired ?? service.cursorRequired ?? input.providerCursorRequired,
        hasProviderInput && syncMode === 'cursor'
      ),
      cursor: asNonEmptyString(sync.cursor || provider.syncCursor || input.providerSyncCursor) || null,
      watermark: asNonEmptyString(sync.watermark || input.providerWatermark) || null,
      schemaVersion: schemaVersion || null,
      checkpointRef: asNonEmptyString(sync.checkpointRef || sync.checkpointId || input.providerCheckpointRef) || null,
      eventStreamRef: asNonEmptyString(sync.eventStreamRef || sync.streamRef || input.providerEventStreamRef) || null,
      snapshotRef: asNonEmptyString(sync.snapshotRef || input.providerSnapshotRef) || null
    },
    handoffPolicy: {
      ttlMs: handoffTtlMs,
      leaseRef: asNonEmptyString(handoff.leaseRef || input.providerHandoffLeaseRef) || null,
      resumable: asBoolean(handoff.resumable ?? input.providerHandoffResumable, true)
    },
    routing: {
      routePrefix: asNonEmptyString(providerRouting.routePrefix || provider.routePrefix || service.routePrefix) || null,
      metadataSyncPath: asNonEmptyString(providerRouting.metadataSyncPath || providerRouting.metadataPath) || null,
      handoffExportPath: asNonEmptyString(providerRouting.handoffExportPath || providerRouting.handoffPath) || null,
      installDispatchPath: asNonEmptyString(providerRouting.installDispatchPath || providerRouting.installPath) || null,
      auditProofPath: asNonEmptyString(providerRouting.auditProofPath || providerRouting.auditPath) || null,
      previewAcceptancePath: asNonEmptyString(providerRouting.previewAcceptancePath || providerRouting.previewPath) || null
    },
    localFallback: !hasProviderInput,
    requiredCapabilities: requestedServiceCapabilities,
    optionalCapabilities: optionalServiceCapabilities,
    requestedOperations
  };
}

function buildProviderSyncCheckpoint(contract) {
  const checkpointParts = [
    contract.serviceRef,
    contract.provider.id || 'unbound-provider',
    contract.sync.mode,
    contract.sync.cursor || contract.provider.syncCursor || contract.sync.watermark || 'no-position',
    contract.provider.resourceVersion || contract.sync.snapshotRef || 'no-resource-version',
    contract.sync.schemaVersion || 'no-schema'
  ];

  return {
    mode: contract.sync.mode,
    resumable:
      contract.sync.mode === 'cursor'
        ? Boolean(contract.sync.cursor || contract.provider.syncCursor)
        : ['snapshot', 'event-log'].includes(contract.sync.mode),
    cursor: contract.sync.cursor || contract.provider.syncCursor,
    watermark: contract.sync.watermark,
    checkpointRef: contract.sync.checkpointRef || checkpointParts.join('|'),
    eventStreamRef: contract.sync.eventStreamRef,
    snapshotRef: contract.sync.snapshotRef,
    resourceVersion: contract.provider.resourceVersion,
    schemaVersion: contract.sync.schemaVersion,
    basisKey: checkpointParts.join('|')
  };
}

function providerOperationPath(contract, operation) {
  const explicitPath = contract.routing[`${operation}Path`];
  if (explicitPath) {
    return explicitPath;
  }

  const routePrefix = contract.routing.routePrefix || `/providers/${contract.provider.id || 'unbound-provider'}`;
  return `${routePrefix}/${operation.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function buildProviderOperationMatrix(contract) {
  const syncCheckpoint = buildProviderSyncCheckpoint(contract);

  return contract.requestedOperations.map((operation, index) => {
    const requiredCapability = PROVIDER_OPERATION_CAPABILITY_REQUIREMENTS[operation];
    const supported = contract.provider.capabilities.includes(requiredCapability);
    const requiresSync = Boolean(PROVIDER_OPERATION_SYNC_REQUIREMENTS[operation]);
    const requiresEndpoint = ['handoffExport', 'installDispatch'].includes(operation);
    const statusAllowsDispatch = ['ready', 'degraded'].includes(contract.provider.status);
    const endpointReady = !requiresEndpoint || Boolean(contract.provider.endpoint);
    const syncReady = !requiresSync || contract.sync.mode === 'none' || syncCheckpoint.resumable || Boolean(syncCheckpoint.watermark);

    return {
      operation,
      requiredCapability,
      supported,
      dispatchable: supported && statusAllowsDispatch && endpointReady && syncReady,
      route: {
        providerId: contract.provider.id || null,
        serviceRef: contract.serviceRef,
        path: providerOperationPath(contract, operation),
        channel: operation === 'handoffExport' ? contract.provider.handoffChannel : 'hosted-kernel-service',
        handoffRequired: operation === 'handoffExport',
        idempotencyScope: `${contract.serviceRef}:${operation}:${index}`
      },
      sync: {
        required: requiresSync,
        ready: syncReady,
        checkpointRef: syncCheckpoint.checkpointRef,
        basisKey: syncCheckpoint.basisKey
      },
      blockedBy: [
        supported ? null : 'missing-capability',
        statusAllowsDispatch ? null : 'provider-status',
        endpointReady ? null : 'provider-endpoint',
        syncReady ? null : 'provider-sync'
      ].filter(Boolean)
    };
  });
}

function negotiateProviderContract(contract) {
  const providerCapabilities = new Set(contract.provider.capabilities);
  const missingRequired = contract.requiredCapabilities.filter((capability) => !providerCapabilities.has(capability));
  const acceptedOptional = contract.optionalCapabilities.filter((capability) => providerCapabilities.has(capability));
  const operationMatrix = buildProviderOperationMatrix(contract);
  const syncCheckpoint = buildProviderSyncCheckpoint(contract);
  const issues = [];

  if (!contract.provider.id) {
    issues.push(buildIssue('MISSING_PROVIDER_ID', 'error', { serviceRef: contract.serviceRef }));
  }

  if (!SUPPORTED_PROVIDER_STATUSES.includes(contract.provider.status)) {
    issues.push(buildIssue('INVALID_PROVIDER_STATUS', 'error', {
      providerId: contract.provider.id || null,
      providerStatus: contract.provider.status,
      supportedStatuses: SUPPORTED_PROVIDER_STATUSES
    }));
  }

  for (const capability of missingRequired) {
    issues.push(buildIssue('MISSING_PROVIDER_CAPABILITY', 'error', {
      providerId: contract.provider.id || null,
      serviceRef: contract.serviceRef,
      capability
    }));
  }

  if (!SUPPORTED_PROVIDER_SYNC_MODES.includes(contract.sync.mode)) {
    issues.push(buildIssue('INVALID_PROVIDER_SYNC_MODE', 'error', {
      providerId: contract.provider.id || null,
      serviceRef: contract.serviceRef,
      syncMode: contract.sync.mode,
      supportedModes: SUPPORTED_PROVIDER_SYNC_MODES
    }));
  }

  if (contract.sync.cursorRequired && contract.sync.mode === 'cursor' && !contract.sync.cursor) {
    issues.push(buildIssue('PROVIDER_SYNC_CURSOR_REQUIRED', 'error', {
      providerId: contract.provider.id || null,
      serviceRef: contract.serviceRef,
      syncMode: contract.sync.mode
    }));
  }

  if (contract.provider.schemaVersion && contract.provider.schemaVersion !== contract.contractVersion) {
    issues.push(buildIssue('INVALID_PROVIDER_SCHEMA_VERSION', 'error', {
      providerId: contract.provider.id || null,
      providerSchemaVersion: contract.provider.schemaVersion,
      serviceContractVersion: contract.contractVersion
    }));
  }

  if (
    contract.handoffPolicy.ttlMs < PROVIDER_HANDOFF_TTL_LIMITS.minMs ||
    contract.handoffPolicy.ttlMs > PROVIDER_HANDOFF_TTL_LIMITS.maxMs
  ) {
    issues.push(buildIssue('INVALID_PROVIDER_HANDOFF_TTL', 'error', {
      providerId: contract.provider.id || null,
      ttlMs: contract.handoffPolicy.ttlMs,
      minMs: PROVIDER_HANDOFF_TTL_LIMITS.minMs,
      maxMs: PROVIDER_HANDOFF_TTL_LIMITS.maxMs
    }));
  }

  for (const operation of operationMatrix.filter((item) => !item.supported)) {
    issues.push(buildIssue('PROVIDER_OPERATION_CAPABILITY_MISSING', 'error', {
      providerId: contract.provider.id || null,
      serviceRef: contract.serviceRef,
      operation: operation.operation,
      capability: operation.requiredCapability
    }));
  }

  if (contract.provider.status === 'degraded') {
    issues.push(buildIssue('ADAPTER_DEGRADED_MODE', 'warning', {
      reason: `provider ${contract.provider.id || 'unknown'} reported degraded service status`
    }));
  }

  if (['disabled', 'unavailable'].includes(contract.provider.status)) {
    issues.push(buildIssue('PROVIDER_HANDOFF_BLOCKED', 'error', {
      providerId: contract.provider.id || null,
      providerStatus: contract.provider.status
    }));
  }

  return {
    ...contract,
    negotiation: {
      accepted: issues.every((issue) => issue.severity !== 'error'),
      providerStatus: contract.provider.status,
      required: contract.requiredCapabilities,
      optionalAccepted: acceptedOptional,
      missingRequired,
      operations: operationMatrix,
      dispatchPlan: operationMatrix.map((operation) => ({
        operation: operation.operation,
        dispatchable: operation.dispatchable,
        route: operation.route,
        syncCheckpointRef: operation.sync.checkpointRef,
        blockedBy: operation.blockedBy
      })),
      syncMode: contract.sync.mode,
      syncCursorAccepted: !contract.sync.cursorRequired || Boolean(contract.sync.cursor),
      syncCheckpoint,
      handoffLease: {
        ttlMs: contract.handoffPolicy.ttlMs,
        leaseRef: contract.handoffPolicy.leaseRef,
        resumable: contract.handoffPolicy.resumable
      },
      externalHandoffReady:
        issues.every((issue) => issue.severity !== 'error') &&
        providerCapabilities.has('handoff.export') &&
        Boolean(contract.provider.endpoint)
    },
    issues
  };
}

function buildSyncMetadata(now, compatibility, providerContract, lifecycle, boundaryContext) {
  const packageRef = `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`;
  const syncBasis = [
    surfaceId,
    packageRef,
    boundaryContext.audit.scopeKey,
    compatibility.kernel.id,
    providerContract.provider.id || 'unbound-provider',
    providerContract.sync.cursor || providerContract.provider.syncCursor || 'no-cursor',
    providerContract.sync.mode,
    providerContract.provider.resourceVersion || 'no-resource-version',
    lifecycle.nextAction.state
  ].join('|');

  return {
    syncVersion: 1,
    generatedAt: now,
    packageRef,
    kernelRef: compatibility.kernel.id,
    tenantRef: boundaryContext.tenant.id,
    workspaceRef: boundaryContext.workspace.id,
    providerRef: providerContract.provider.id || null,
    serviceRef: providerContract.serviceRef,
    cursor: providerContract.sync.cursor || providerContract.provider.syncCursor,
    mode: providerContract.sync.mode,
    schemaVersion: providerContract.sync.schemaVersion,
    resourceVersion: providerContract.provider.resourceVersion,
    lastSyncedAt: providerContract.provider.lastSyncedAt,
    basisKey: syncBasis,
    route: providerContract.negotiation.externalHandoffReady ? 'external-provider' : 'hosted-kernel-local',
    providerCheckpoint: providerContract.negotiation.syncCheckpoint,
    providerDispatchPlan: providerContract.negotiation.dispatchPlan,
    freshness: {
      source:
        providerContract.sync.mode === 'event-log'
          ? 'provider-event-log'
          : providerContract.sync.cursor
            ? 'provider-cursor'
            : providerContract.provider.resourceVersion
              ? 'provider-resource-version'
              : 'runtime-assessment',
      lifecycleState: lifecycle.nextAction.state,
      scheduleActive: lifecycle.scheduling.active,
      resumable: providerContract.sync.mode === 'cursor' ? Boolean(providerContract.sync.cursor) : providerContract.sync.mode !== 'none'
    }
  };
}

function buildAcceptanceToken(compatibility, lifecycle, syncMetadata) {
  const packageRef = `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`;
  return [surfaceId, packageRef, compatibility.kernel.id, syncMetadata.basisKey, lifecycle.nextAction.state].join('|');
}

function normalizePersistedCommand(value) {
  const command = asObject(value);
  const state = asNonEmptyString(command.state || command.status || 'not-started').toLowerCase();
  const recoveryMode = asNonEmptyString(command.recoveryMode || command.recovery || 'resume').toLowerCase();
  const leaseTtlMs = asBoundedInteger(
    command.leaseTtlMs ?? command.ttlMs,
    PERSISTED_COMMAND_LEASE_LIMITS.defaultTtlMs,
    PERSISTED_COMMAND_LEASE_LIMITS.minTtlMs,
    PERSISTED_COMMAND_LEASE_LIMITS.maxTtlMs
  );

  return {
    id: asNonEmptyString(command.id || command.commandId) || null,
    command: asNonEmptyString(command.command || command.lifecycleCommand) || null,
    state: SUPPORTED_PERSISTED_COMMAND_STATES.includes(state) ? state : 'failed',
    idempotencyKey: asNonEmptyString(command.idempotencyKey || command.requestKey) || null,
    syncBasisKey: asNonEmptyString(command.syncBasisKey || command.basisKey) || null,
    packageRef: asNonEmptyString(command.packageRef) || null,
    requestedAt: asNonEmptyString(command.requestedAt || command.createdAt) || null,
    heartbeatAt: asNonEmptyString(command.heartbeatAt || command.lastHeartbeatAt || command.updatedAt) || null,
    leaseOwner: asNonEmptyString(command.leaseOwner || command.owner || command.workerId) || null,
    leaseExpiresAt: asNonEmptyString(command.leaseExpiresAt || command.expiresAt) || null,
    leaseTtlMs,
    recoveryMode: SUPPORTED_PERSISTED_RECOVERY_MODES.includes(recoveryMode) ? recoveryMode : 'manual',
    attempt: Math.max(0, Number(command.attempt ?? command.attempts ?? 0) || 0),
    dispatchRef: asNonEmptyString(command.dispatchRef || command.providerDispatchRef || command.operationRef) || null,
    completedAt: asNonEmptyString(command.completedAt || command.finishedAt) || null,
    resultRef: asNonEmptyString(command.resultRef || command.auditRef) || null,
    errorCode: asNonEmptyString(command.errorCode || command.code) || null
  };
}

function commandHasIdentity(command) {
  return Boolean(command.id || command.command || command.packageRef || command.syncBasisKey || command.idempotencyKey);
}

function buildCommandLeaseStatus(now, command) {
  const nowMs = Date.parse(now);
  const requested = parseTimestampMs(command.requestedAt);
  const heartbeat = parseTimestampMs(command.heartbeatAt);
  const explicitLease = parseTimestampMs(command.leaseExpiresAt);
  const basisMs = Number.isFinite(heartbeat.ms) ? heartbeat.ms : requested.ms;
  const computedLeaseMs =
    Number.isFinite(basisMs) && command.state === 'pending' ? basisMs + command.leaseTtlMs : Number.NaN;
  const expiresAtMs = Number.isFinite(explicitLease.ms) ? explicitLease.ms : computedLeaseMs;
  const expiresAt =
    Number.isFinite(expiresAtMs) && command.state === 'pending' ? new Date(expiresAtMs).toISOString() : null;
  const expired = command.state === 'pending' && Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const active = command.state === 'pending' && !expired && Number.isFinite(expiresAtMs);
  const missingLeaseProof =
    command.state === 'pending' && !Number.isFinite(expiresAtMs) && command.recoveryMode !== 'replace';

  return {
    active,
    expired,
    missingLeaseProof,
    leaseOwner: command.leaseOwner,
    leaseTtlMs: command.leaseTtlMs,
    heartbeatAt: command.heartbeatAt,
    expiresAt,
    remainingMs: active && Number.isFinite(nowMs) ? Math.max(0, expiresAtMs - nowMs) : 0
  };
}

function commandMatchesCurrent(record, currentCommand) {
  return (
    record.command === currentCommand.command &&
    record.packageRef === currentCommand.packageRef &&
    record.syncBasisKey === currentCommand.syncBasisKey &&
    (!record.idempotencyKey || record.idempotencyKey === currentCommand.idempotencyKey)
  );
}

function normalizePersistedAdapterState(input, now) {
  const state = asObject(input.persistedState || input.adapterState || input.recoveredState);
  const checkpoint = asObject(state.checkpoint || state.lastCheckpoint);
  const hasState = Boolean(input.persistedState || input.adapterState || input.recoveredState);
  const generation = Math.max(0, Number(state.generation ?? checkpoint.generation ?? 0) || 0);

  return {
    contractVersion: 1,
    restored: hasState || asBoolean(input.restoredFromPersistence, false),
    stateId: asNonEmptyString(state.stateId || state.id || input.stateId) || null,
    generation,
    loadedAt: now,
    checkpoint: {
      savedAt: asNonEmptyString(checkpoint.savedAt || checkpoint.generatedAt || state.savedAt) || null,
      packageRef: asNonEmptyString(checkpoint.packageRef || state.packageRef) || null,
      kernelRef: asNonEmptyString(checkpoint.kernelRef || state.kernelRef) || null,
      syncBasisKey: asNonEmptyString(checkpoint.syncBasisKey || state.syncBasisKey) || null,
      healthState: asNonEmptyString(checkpoint.healthState || state.healthState) || null,
      nextActionState: asNonEmptyString(checkpoint.nextActionState || state.nextActionState) || null
    },
    lastCommand: normalizePersistedCommand(state.lastCommand || checkpoint.lastCommand),
    pendingCommand: normalizePersistedCommand(state.pendingCommand || checkpoint.pendingCommand),
    seenIdempotencyKeys: normalizeStringList(state.seenIdempotencyKeys || checkpoint.seenIdempotencyKeys),
    recoveryCursor: asNonEmptyString(state.recoveryCursor || checkpoint.recoveryCursor) || null
  };
}

function buildRestartSafeStatus(now, compatibility, lifecycle, syncMetadata, clientRuntime, persistedState) {
  const packageRef = `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`;
  const commandKey = clientRuntime.request.idempotencyKey || `${packageRef}:${lifecycle.command}:${syncMetadata.basisKey}`;
  const pending = persistedState.pendingCommand;
  const last = persistedState.lastCommand;
  const pendingLease = buildCommandLeaseStatus(now, pending);
  const pendingMatches =
    pending.state === 'pending' &&
    !pendingLease.expired &&
    !pendingLease.missingLeaseProof &&
    pending.command === lifecycle.command &&
    pending.syncBasisKey === syncMetadata.basisKey &&
    (!pending.idempotencyKey || pending.idempotencyKey === commandKey);
  const expiredPendingMatches =
    pending.state === 'pending' &&
    pendingLease.expired &&
    pending.command === lifecycle.command &&
    pending.syncBasisKey === syncMetadata.basisKey &&
    (!pending.idempotencyKey || pending.idempotencyKey === commandKey);
  const completedMatches =
    last.state === 'completed' &&
    last.command === lifecycle.command &&
    last.syncBasisKey === syncMetadata.basisKey &&
    (!last.idempotencyKey || last.idempotencyKey === commandKey);
  const idempotencySeen = Boolean(commandKey && persistedState.seenIdempotencyKeys.includes(commandKey));
  const staleCheckpoint =
    persistedState.restored &&
    Boolean(persistedState.checkpoint.syncBasisKey) &&
    persistedState.checkpoint.syncBasisKey !== syncMetadata.basisKey;
  const restartAction = completedMatches
    ? 'return-recorded-result'
    : pendingMatches
      ? 'resume-pending-command'
      : expiredPendingMatches
        ? 'renew-expired-command-lease'
      : staleCheckpoint
        ? 'revalidate-from-current-runtime'
        : lifecycle.installEligible
          ? 'persist-before-dispatch'
          : lifecycle.scheduling.active
            ? 'persist-scheduled-status'
            : 'persist-read-model';
  const status = completedMatches
    ? 'idempotent-complete'
    : pendingMatches
      ? 'recovered-pending'
      : expiredPendingMatches
        ? 'pending-lease-expired'
      : staleCheckpoint
        ? 'checkpoint-stale'
        : lifecycle.nextAction.state;

  return {
    contractVersion: 1,
    generatedAt: now,
    status,
    restartAction,
    restored: persistedState.restored,
    idempotentReplay: completedMatches || idempotencySeen,
    duplicateCommand: completedMatches || pendingMatches || idempotencySeen,
    commandKey,
    packageRef,
    syncBasisKey: syncMetadata.basisKey,
    checkpoint: {
      stateId: persistedState.stateId,
      generation: persistedState.generation,
      stale: staleCheckpoint,
      savedAt: persistedState.checkpoint.savedAt,
      priorHealthState: persistedState.checkpoint.healthState,
      priorNextActionState: persistedState.checkpoint.nextActionState
    },
    lease: {
      pendingActive: pendingLease.active,
      pendingExpired: pendingLease.expired,
      missingLeaseProof: pendingLease.missingLeaseProof,
      leaseOwner: pendingLease.leaseOwner,
      heartbeatAt: pendingLease.heartbeatAt,
      expiresAt: pendingLease.expiresAt,
      remainingMs: pendingLease.remainingMs
    },
    recoveredCommand: {
      pending: pendingMatches
        ? {
            id: pending.id,
            command: pending.command,
            requestedAt: pending.requestedAt,
            heartbeatAt: pending.heartbeatAt,
            leaseOwner: pending.leaseOwner,
            leaseExpiresAt: pendingLease.expiresAt,
            dispatchRef: pending.dispatchRef,
            resultRef: pending.resultRef,
            errorCode: pending.errorCode
          }
        : null,
      expiredPending: expiredPendingMatches
        ? {
            id: pending.id,
            command: pending.command,
            requestedAt: pending.requestedAt,
            heartbeatAt: pending.heartbeatAt,
            leaseOwner: pending.leaseOwner,
            leaseExpiresAt: pendingLease.expiresAt,
            dispatchRef: pending.dispatchRef,
            recoveryMode: pending.recoveryMode
          }
        : null,
      completed: completedMatches
        ? {
            id: last.id,
            command: last.command,
            completedAt: last.completedAt,
            resultRef: last.resultRef
          }
        : null
    },
    writeIntent: {
      shouldPersist:
        !completedMatches &&
        ['dispatch-install', 'wait-for-scheduled-run', 'persist-enabled-setting', 'persist-disabled-setting'].includes(
          lifecycle.nextAction.state
        ),
      nextGeneration: persistedState.generation + 1,
      recoveryCursor: [surfaceId, packageRef, syncMetadata.basisKey, lifecycle.nextAction.state].join('|')
    }
  };
}

function buildPersistedStateEnvelope(now, compatibility, lifecycle, syncMetadata, clientRuntime, persistedState, restartSafeStatus) {
  const nowMs = Date.parse(now);
  const leaseExpiresAt = Number.isFinite(nowMs)
    ? new Date(nowMs + PERSISTED_COMMAND_LEASE_LIMITS.defaultTtlMs).toISOString()
    : null;
  const commandRecord = {
    id: clientRuntime.request.id || restartSafeStatus.commandKey,
    command: lifecycle.command,
    state: lifecycle.installEligible ? 'pending' : lifecycle.accepted ? 'completed' : 'failed',
    idempotencyKey: restartSafeStatus.commandKey,
    syncBasisKey: syncMetadata.basisKey,
    packageRef: restartSafeStatus.packageRef,
    requestedAt: now,
    heartbeatAt: lifecycle.installEligible ? now : null,
    leaseOwner: lifecycle.installEligible ? clientRuntime.client.id || clientRuntime.client.channel : null,
    leaseExpiresAt: lifecycle.installEligible ? leaseExpiresAt : null,
    leaseTtlMs: PERSISTED_COMMAND_LEASE_LIMITS.defaultTtlMs,
    recoveryMode: lifecycle.installEligible ? 'resume' : 'replay',
    attempt: lifecycle.installEligible ? persistedState.pendingCommand.attempt + 1 : 0,
    dispatchRef: lifecycle.installEligible
      ? [surfaceId, restartSafeStatus.packageRef, syncMetadata.basisKey, lifecycle.command].join('|')
      : null,
    completedAt: lifecycle.installEligible ? null : now,
    resultRef: lifecycle.installEligible ? null : syncMetadata.basisKey,
    errorCode: lifecycle.accepted ? null : lifecycle.nextAction.blockedBy[0] || 'VALIDATION_BLOCKED'
  };

  return {
    contractVersion: 1,
    stateId: persistedState.stateId || `${surfaceId}:${restartSafeStatus.packageRef}`,
    generation: restartSafeStatus.writeIntent.nextGeneration,
    checkpoint: {
      savedAt: now,
      packageRef: restartSafeStatus.packageRef,
      kernelRef: compatibility.kernel.id,
      syncBasisKey: syncMetadata.basisKey,
      healthState: compatibility.healthState,
      nextActionState: lifecycle.nextAction.state
    },
    pendingCommand: commandRecord.state === 'pending' ? commandRecord : null,
    lastCommand: commandRecord.state === 'pending' ? persistedState.lastCommand : commandRecord,
    seenIdempotencyKeys: normalizeStringList([...persistedState.seenIdempotencyKeys, restartSafeStatus.commandKey]),
    recoveryCursor: restartSafeStatus.writeIntent.recoveryCursor
  };
}

function summarizePersistedCommand(command, role) {
  const active = commandHasIdentity(command);

  return {
    role,
    active,
    id: command.id,
    command: command.command,
    state: command.state,
    idempotencyKey: command.idempotencyKey,
    syncBasisKey: command.syncBasisKey,
    packageRef: command.packageRef,
    requestedAt: command.requestedAt,
    heartbeatAt: command.heartbeatAt,
    leaseOwner: command.leaseOwner,
    leaseExpiresAt: command.leaseExpiresAt,
    leaseTtlMs: command.leaseTtlMs,
    recoveryMode: command.recoveryMode,
    attempt: command.attempt,
    dispatchRef: command.dispatchRef,
    completedAt: command.completedAt,
    resultRef: command.resultRef,
    errorCode: command.errorCode
  };
}

function buildPersistedRecoveryPlan(now, currentCommand, persistedState, restartSafeStatus) {
  const commands = [
    { role: 'pending', command: persistedState.pendingCommand },
    { role: 'last', command: persistedState.lastCommand }
  ].filter((record) => commandHasIdentity(record.command));
  const records = commands.map((record) => {
    const lease = buildCommandLeaseStatus(now, record.command);
    const matchesCurrent = commandMatchesCurrent(record.command, currentCommand);
    const sameIdempotencyKey =
      record.command.idempotencyKey && record.command.idempotencyKey === currentCommand.idempotencyKey;
    const safeToResume =
      record.command.state === 'pending' &&
      matchesCurrent &&
      lease.active &&
      record.command.recoveryMode === 'resume';
    const safeToReplace =
      record.command.state === 'pending' &&
      matchesCurrent &&
      (lease.expired || record.command.recoveryMode === 'replace');

    return {
      role: record.role,
      id: record.command.id,
      state: record.command.state,
      command: record.command.command,
      packageRef: record.command.packageRef,
      syncBasisKey: record.command.syncBasisKey,
      idempotencyKey: record.command.idempotencyKey,
      matchesCurrent,
      sameIdempotencyKey,
      recoveryMode: record.command.recoveryMode,
      dispatchRef: record.command.dispatchRef,
      attempt: record.command.attempt,
      lease,
      safeToResume,
      safeToReplace,
      unsafeReason:
        record.command.state === 'pending' && !safeToResume && !safeToReplace
          ? lease.missingLeaseProof
            ? 'missing-lease-proof'
            : sameIdempotencyKey && !matchesCurrent
              ? 'idempotency-conflict'
              : record.command.recoveryMode === 'manual'
                ? 'manual-recovery-required'
                : 'checkpoint-mismatch'
          : null
    };
  });
  const completedReplay = records.find(
    (record) => record.state === 'completed' && (record.matchesCurrent || record.sameIdempotencyKey)
  );
  const resumablePending = records.find((record) => record.safeToResume);
  const replaceablePending = records.find((record) => record.safeToReplace);
  const unsafePending = records.find((record) => record.unsafeReason);
  const action = completedReplay
    ? 'return-recorded-result'
    : resumablePending
      ? 'resume-active-lease'
      : replaceablePending
        ? 'replace-expired-pending'
        : unsafePending
          ? 'operator-recovery-required'
          : restartSafeStatus.checkpoint.stale
            ? 'refresh-checkpoint'
            : restartSafeStatus.writeIntent.shouldPersist
              ? 'write-new-command'
              : 'observe-only';

  return {
    contractVersion: 1,
    generatedAt: now,
    action,
    resumable: action === 'resume-active-lease',
    replaceable: action === 'replace-expired-pending',
    operatorRecoveryRequired: action === 'operator-recovery-required',
    selectedRecord: completedReplay || resumablePending || replaceablePending || unsafePending || null,
    records,
    leasePolicy: {
      minTtlMs: PERSISTED_COMMAND_LEASE_LIMITS.minTtlMs,
      defaultTtlMs: PERSISTED_COMMAND_LEASE_LIMITS.defaultTtlMs,
      maxTtlMs: PERSISTED_COMMAND_LEASE_LIMITS.maxTtlMs
    }
  };
}

function buildPersistedCommandContract(
  now,
  compatibility,
  lifecycle,
  syncMetadata,
  clientRuntime,
  persistedState,
  restartSafeStatus
) {
  const currentCommand = {
    id: clientRuntime.request.id || restartSafeStatus.commandKey,
    command: lifecycle.command,
    idempotencyKey: restartSafeStatus.commandKey,
    syncBasisKey: syncMetadata.basisKey,
    packageRef: restartSafeStatus.packageRef,
    tenantRef: syncMetadata.tenantRef,
    workspaceRef: syncMetadata.workspaceRef
  };
  const records = [
    summarizePersistedCommand(persistedState.pendingCommand, 'pending'),
    summarizePersistedCommand(persistedState.lastCommand, 'last')
  ].filter((record) => record.active);
  const recovery = buildPersistedRecoveryPlan(now, currentCommand, persistedState, restartSafeStatus);
  const reusableRecord = records.find(
    (record) =>
      record.idempotencyKey === currentCommand.idempotencyKey ||
      (record.syncBasisKey === currentCommand.syncBasisKey && record.command === currentCommand.command)
  );
  const conflictingRecords = records.filter((record) => {
    const keyMatches = record.idempotencyKey && record.idempotencyKey === currentCommand.idempotencyKey;
    const commandMatches = !record.command || record.command === currentCommand.command;
    const packageMatches = !record.packageRef || record.packageRef === currentCommand.packageRef;
    const basisMatches = !record.syncBasisKey || record.syncBasisKey === currentCommand.syncBasisKey;

    return keyMatches && (!commandMatches || !packageMatches || !basisMatches);
  });
  const incompleteRecords = records.filter(
    (record) =>
      ['pending', 'completed', 'failed'].includes(record.state) &&
      (!record.command || !record.packageRef || !record.syncBasisKey || !record.idempotencyKey)
  );
  const terminalFailure = records.find(
    (record) =>
      record.state === 'failed' &&
      record.idempotencyKey === currentCommand.idempotencyKey &&
      record.command === currentCommand.command &&
      record.packageRef === currentCommand.packageRef
  );
  const replayMode = conflictingRecords.length
    ? 'blocked-conflict'
    : terminalFailure
      ? 'blocked-terminal-failure'
      : recovery.operatorRecoveryRequired
        ? 'blocked-unsafe-recovery'
      : restartSafeStatus.recoveredCommand.completed
        ? 'return-result'
      : restartSafeStatus.recoveredCommand.pending
        ? 'resume-pending'
        : restartSafeStatus.recoveredCommand.expiredPending
          ? 'replace-expired-pending'
          : restartSafeStatus.checkpoint.stale
            ? 'revalidate-stale-checkpoint'
            : lifecycle.installEligible
              ? 'create-pending-command'
              : 'record-read-model';
  const hostWriteOperation =
    replayMode === 'create-pending-command'
      ? 'upsert-pending-command'
      : replayMode === 'record-read-model'
        ? 'upsert-command-result'
        : replayMode === 'replace-expired-pending'
          ? 'renew-pending-command-lease'
        : replayMode === 'revalidate-stale-checkpoint'
          ? 'write-revalidation-checkpoint'
          : 'none';

  return {
    contractVersion: 1,
    generatedAt: now,
    currentCommand,
    replay: {
      mode: replayMode,
      reusableRecord: reusableRecord
        ? {
            role: reusableRecord.role,
            id: reusableRecord.id,
            state: reusableRecord.state,
            resultRef: reusableRecord.resultRef,
            errorCode: reusableRecord.errorCode
          }
        : null,
      idempotentReplay: restartSafeStatus.idempotentReplay,
      duplicateCommand: restartSafeStatus.duplicateCommand
    },
    recovery,
    checkpoint: {
      stateId: persistedState.stateId,
      generation: persistedState.generation,
      stale: restartSafeStatus.checkpoint.stale,
      recoveryCursor: persistedState.recoveryCursor,
      currentRecoveryCursor: restartSafeStatus.writeIntent.recoveryCursor
    },
    validation: {
      incompleteRecords,
      conflictingRecords,
      terminalFailure: terminalFailure
        ? {
            role: terminalFailure.role,
            id: terminalFailure.id,
            errorCode: terminalFailure.errorCode,
            resultRef: terminalFailure.resultRef
          }
        : null
    },
    hostWrite: {
      operation: hostWriteOperation,
      required:
        (restartSafeStatus.writeIntent.shouldPersist || replayMode === 'replace-expired-pending') &&
        !conflictingRecords.length &&
        !terminalFailure &&
        !recovery.operatorRecoveryRequired,
      nextGeneration: restartSafeStatus.writeIntent.nextGeneration,
      commandState: lifecycle.installEligible ? 'pending' : lifecycle.accepted ? 'completed' : 'failed',
      commandId: currentCommand.id,
      packageHealthState: compatibility.healthState
    }
  };
}

function validatePersistedCommandContract(contract) {
  const issues = [];

  for (const record of contract.validation.incompleteRecords) {
    issues.push(buildIssue('PERSISTED_COMMAND_MISSING_FIELDS', 'error', {
      role: record.role,
      commandId: record.id,
      state: record.state
    }));
  }

  for (const record of contract.validation.conflictingRecords) {
    issues.push(buildIssue('PERSISTED_COMMAND_CONFLICT', 'error', {
      role: record.role,
      commandId: record.id,
      currentCommand: contract.currentCommand.command,
      persistedCommand: record.command,
      currentPackageRef: contract.currentCommand.packageRef,
      persistedPackageRef: record.packageRef
    }));
  }

  if (contract.validation.terminalFailure) {
    issues.push(buildIssue('PERSISTED_COMMAND_TERMINAL_FAILURE', 'error', {
      commandId: contract.validation.terminalFailure.id,
      errorCode: contract.validation.terminalFailure.errorCode,
      resultRef: contract.validation.terminalFailure.resultRef
    }));
  }

  if (contract.recovery.replaceable) {
    issues.push(buildIssue('PERSISTED_COMMAND_LEASE_EXPIRED', 'warning', {
      commandId: contract.recovery.selectedRecord?.id || null,
      recoveryAction: contract.recovery.action,
      leaseOwner: contract.recovery.selectedRecord?.lease?.leaseOwner || null,
      leaseExpiredAt: contract.recovery.selectedRecord?.lease?.expiresAt || null
    }));
  }

  if (contract.recovery.operatorRecoveryRequired) {
    issues.push(buildIssue('PERSISTED_COMMAND_RECOVERY_UNSAFE', 'error', {
      commandId: contract.recovery.selectedRecord?.id || null,
      recoveryAction: contract.recovery.action,
      unsafeReason: contract.recovery.selectedRecord?.unsafeReason || null,
      recoveryMode: contract.recovery.selectedRecord?.recoveryMode || null
    }));
  }

  if (contract.checkpoint.stale && contract.replay.mode === 'revalidate-stale-checkpoint') {
    issues.push(buildIssue('PERSISTED_COMMAND_CHECKPOINT_STALE', 'warning', {
      stateId: contract.checkpoint.stateId,
      generation: contract.checkpoint.generation,
      recoveryCursor: contract.checkpoint.recoveryCursor
    }));
  }

  return issues;
}

function buildExternalHandoffState(
  now,
  compatibility,
  providerContract,
  lifecycle,
  syncMetadata,
  clientRuntime,
  clientIssues,
  boundaryContext,
  boundaryIssues,
  persistedCommandIssues = []
) {
  const blockingIssueCodes = [
    ...compatibility.issues,
    ...providerContract.issues,
    ...lifecycle.issues,
    ...clientIssues,
    ...boundaryIssues,
    ...persistedCommandIssues
  ]
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const expectedAcceptanceToken = buildAcceptanceToken(compatibility, lifecycle, syncMetadata);
  const clientAcceptedPreview = clientRuntime.client.acceptedPreviewToken === expectedAcceptanceToken;
  const handoffBlockedBy = [
    ...blockingIssueCodes,
    ...(clientRuntime.handoff.requested && !clientAcceptedPreview ? ['CLIENT_PREVIEW_ACCEPTANCE_REQUIRED'] : [])
  ];
  const accepted =
    clientRuntime.handoff.requested &&
    clientAcceptedPreview &&
    providerContract.negotiation.externalHandoffReady &&
    blockingIssueCodes.length === 0;

  return {
    handoffVersion: 1,
    generatedAt: now,
    accepted,
    state: accepted ? 'ready-for-external-provider' : 'blocked',
    channel: providerContract.provider.handoffChannel,
    providerEndpoint: accepted ? providerContract.provider.endpoint : null,
    lease: accepted
      ? {
          ttlMs: providerContract.handoffPolicy.ttlMs,
          leaseRef: providerContract.handoffPolicy.leaseRef,
          resumable: providerContract.handoffPolicy.resumable
        }
      : null,
    serviceRef: providerContract.serviceRef,
    packageRef: syncMetadata.packageRef,
    tenantRef: boundaryContext.tenant.id,
    workspaceRef: boundaryContext.workspace.id,
    syncBasisKey: syncMetadata.basisKey,
    blockedBy: [...new Set(handoffBlockedBy)],
    client: {
      requestId: clientRuntime.request.id || null,
      channel: clientRuntime.client.channel,
      workflowState: clientRuntime.client.workflowState,
      expectedAcceptanceToken,
      acceptedPreviewToken: clientRuntime.client.acceptedPreviewToken,
      acceptedPreviewMatches: clientAcceptedPreview,
      returnUrl: accepted ? clientRuntime.handoff.returnUrl : null,
      callbackRef: accepted ? clientRuntime.handoff.callbackRef : null,
      resumeToken: clientRuntime.handoff.resumeToken
    },
    payloadShape: {
      packageId: compatibility.package.id,
      packageVersion: compatibility.package.version,
      kernelId: compatibility.kernel.id,
      tenantId: boundaryContext.tenant.id,
      workspaceId: boundaryContext.workspace.id,
      actorId: boundaryContext.actor.id,
      requiredKernelCapabilities: compatibility.package.requiredKernelCapabilities,
      requiredProviderCapabilities: providerContract.requiredCapabilities,
      providerOperations: providerContract.negotiation.operations,
      providerSync: {
        mode: providerContract.sync.mode,
        cursor: syncMetadata.cursor,
        schemaVersion: providerContract.sync.schemaVersion,
        resourceVersion: providerContract.provider.resourceVersion,
        checkpointRef: syncMetadata.providerCheckpoint.checkpointRef,
        checkpointBasisKey: syncMetadata.providerCheckpoint.basisKey,
        eventStreamRef: syncMetadata.providerCheckpoint.eventStreamRef,
        snapshotRef: syncMetadata.providerCheckpoint.snapshotRef
      },
      providerDispatchPlan: providerContract.negotiation.dispatchPlan,
      requiredActorPermissions: boundaryContext.requiredPermissions,
      permissionBoundary: {
        isolationMode: boundaryContext.permissionBoundary.isolationMode,
        handoffSafe: boundaryContext.permissionBoundary.handoffSafe,
        scopedGrantRequired: boundaryContext.permissionBoundary.scopedGrantRequired,
        scopedGrantMatched: boundaryContext.permissionBoundary.scopedGrantMatched,
        authorizedOperations: boundaryContext.permissionBoundary.authorizedOperations,
        deniedOperations: boundaryContext.permissionBoundary.deniedOperations,
        blockingReasons: boundaryContext.permissionBoundary.blockingReasons,
        proofRefs: boundaryContext.permissionBoundary.proofRefs,
        handoffOperationProofs: boundaryContext.permissionBoundary.handoffOperationProofs
      },
      operationAuthorization: boundaryContext.operationAuthorization.map((authorization) => ({
        operation: authorization.operation,
        permission: authorization.permission,
        granted: authorization.granted,
        grantId: authorization.grantId,
        grantSource: authorization.grantSource,
        deniedBy: authorization.deniedBy
      })),
      workspaceScopePolicy: {
        mode: boundaryContext.workspace.scopePolicy.mode,
        writeRequired: boundaryContext.workspace.scopePolicy.writeRequired,
        mutationOperations: boundaryContext.workspace.scopePolicy.mutationOperations,
        providerWorkspaceId: boundaryContext.workspace.scopePolicy.providerWorkspaceId,
        deniedLanes: boundaryContext.workspace.scopePolicy.deniedLanes,
        lanes: boundaryContext.workspace.scopePolicy.lanes.map((lane) => ({
          label: lane.label,
          constrained: lane.constrained,
          matched: lane.matched,
          allowedWorkspaceIds: lane.allowedWorkspaceIds
        }))
      },
      clientRequestId: clientRuntime.request.id || null
    }
  };
}

function buildPreviewAcceptanceContract(
  now,
  compatibility,
  lifecycle,
  providerContract,
  syncMetadata,
  externalHandoff,
  clientRuntime,
  boundaryContext,
  issues
) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const packageRef = `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`;
  const acceptanceToken = buildAcceptanceToken(compatibility, lifecycle, syncMetadata);
  const clientAcceptedPreview = clientRuntime.client.acceptedPreviewToken === acceptanceToken;
  const readinessGates = {
    kernelCompatible: compatibility.healthState !== 'failed',
    lifecycleAccepted: lifecycle.accepted,
    installEligible: lifecycle.installEligible,
    scheduleReady: lifecycle.scheduling.active,
    providerAccepted: providerContract.negotiation.accepted,
    externalHandoffReady: externalHandoff.accepted,
    clientPreviewAccepted: clientAcceptedPreview || !clientRuntime.handoff.requested
  };
  const readinessState = errors.length
    ? 'blocked'
    : compatibility.healthState === 'degraded' || warnings.length
      ? 'needs-review'
      : lifecycle.installEligible
        ? 'ready-to-install'
        : lifecycle.scheduling.active
          ? 'scheduled'
          : 'ready';
  const primaryAction = errors.length
    ? 'resolve-validation-errors'
    : lifecycle.installEligible
      ? 'accept-and-install'
      : externalHandoff.accepted
        ? 'export-provider-handoff'
        : lifecycle.scheduling.active
          ? 'keep-scheduled'
          : 'accept-preview';
  const issueContracts = issues.map((issue, index) => ({
    id: `${issue.code}:${index}`,
    code: issue.code,
    severity: issue.severity,
    action: issue.action,
    capability: issue.capability || null,
    providerId: issue.providerId || null,
    lifecycleCommand: issue.lifecycleCommand || null
  }));
  const nextSteps = issueContracts.length
    ? issueContracts.map((issue) => ({
        id: `fix-${issue.id}`,
        kind: issue.severity === 'error' ? 'blocking-fix' : 'review',
        label: issue.code,
        action: issue.action,
        dependsOn: issue.capability || issue.providerId || issue.lifecycleCommand || null,
        completesGate: issue.severity === 'error' ? 'lifecycleAccepted' : 'operatorReview'
      }))
    : [
        {
          id: `confirm-${lifecycle.nextAction.state}`,
          kind: lifecycle.installEligible ? 'install' : 'acceptance',
          label: lifecycle.installEligible ? 'Dispatch install' : 'Accept compatibility preview',
          action: lifecycle.installEligible
            ? 'Accept the hosted-kernel preview and dispatch the install lifecycle command.'
            : 'Accept the hosted-kernel compatibility preview and retain the generated audit proof.',
          dependsOn: syncMetadata.basisKey,
          completesGate: lifecycle.installEligible ? 'installEligible' : 'lifecycleAccepted'
        }
      ];

  return {
    contractVersion: 1,
    generatedAt: now,
    packageRef,
    preview: {
      title: `Hosted-kernel compatibility for ${packageRef}`,
      state: readinessState,
      primaryAction,
      summary:
        errors.length > 0
          ? `${errors.length} blocking issue${errors.length === 1 ? '' : 's'} must be resolved before acceptance.`
          : warnings.length > 0
            ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} require operator review before mutation.`
            : 'Compatibility preview is ready for acceptance.',
      kernelState: compatibility.kernel.state,
      providerState: providerContract.provider.status,
      lifecycleCommand: lifecycle.command,
      syncRoute: syncMetadata.route,
      clientChannel: clientRuntime.client.channel,
      clientWorkflowState: clientRuntime.client.workflowState
    },
    acceptance: {
      accepted: errors.length === 0,
      requiresOperatorReview: warnings.length > 0 || compatibility.healthState === 'degraded',
      token: acceptanceToken,
      clientAcceptedPreview,
      acceptedOperations: {
        discovery: errors.every((issue) => issue.code !== 'MISSING_PACKAGE_ID'),
        install: lifecycle.installEligible,
        schedule: lifecycle.scheduling.active,
        handoff: externalHandoff.accepted
      },
      blockedBy: errors.map((issue) => issue.code)
    },
    readiness: readinessGates,
    validationSummary: {
      total: issues.length,
      errors: errors.length,
      warnings: warnings.length,
      blockingIssueCodes: errors.map((issue) => issue.code),
      warningIssueCodes: warnings.map((issue) => issue.code),
      missingKernelCapabilities: issues
        .filter((issue) => issue.code === 'MISSING_KERNEL_CAPABILITY')
        .map((issue) => issue.capability)
        .filter(Boolean)
        .sort(),
      missingProviderCapabilities: providerContract.negotiation.missingRequired
    },
    clientWorkflow: {
      requestId: clientRuntime.request.id || null,
      traceId: clientRuntime.request.traceId,
      idempotencyKey: clientRuntime.request.idempotencyKey,
      channel: clientRuntime.client.channel,
      state: clientRuntime.client.workflowState,
      requestedOperations: clientRuntime.client.requestedOperations,
      handoffRequested: clientRuntime.handoff.requested,
      resumeMode: clientRuntime.handoff.callbackRef ? 'callback' : clientRuntime.handoff.returnUrl ? 'return-url' : 'none'
    },
    boundary: {
      tenantId: boundaryContext.tenant.id,
      workspaceId: boundaryContext.workspace.id,
      actorId: boundaryContext.actor.id,
      roles: boundaryContext.actor.roles,
      requestedOperations: boundaryContext.requestedOperations,
      requiredPermissions: boundaryContext.requiredPermissions,
      permissionBoundary: {
        isolationMode: boundaryContext.permissionBoundary.isolationMode,
        handoffSafe: boundaryContext.permissionBoundary.handoffSafe,
        scopedGrantRequired: boundaryContext.permissionBoundary.scopedGrantRequired,
        scopedGrantMatched: boundaryContext.permissionBoundary.scopedGrantMatched,
        authorizedOperations: boundaryContext.permissionBoundary.authorizedOperations,
        deniedOperations: boundaryContext.permissionBoundary.deniedOperations,
        blockingReasons: boundaryContext.permissionBoundary.blockingReasons,
        proofRefs: boundaryContext.permissionBoundary.proofRefs
      },
      operationAuthorization: boundaryContext.operationAuthorization,
      scopeKey: boundaryContext.audit.scopeKey,
      permissionProofKey: boundaryContext.audit.permissionProofKey,
      workspaceProofKey: boundaryContext.audit.workspaceProofKey,
      handoffProofKey: boundaryContext.audit.handoffProofKey,
      workspaceScopePolicy: {
        mode: boundaryContext.workspace.scopePolicy.mode,
        writeRequired: boundaryContext.workspace.scopePolicy.writeRequired,
        mutationOperations: boundaryContext.workspace.scopePolicy.mutationOperations,
        deniedLanes: boundaryContext.workspace.scopePolicy.deniedLanes
      }
    },
    nextSteps
  };
}

function buildClientRouteDecisionContract(
  now,
  compatibility,
  lifecycle,
  providerContract,
  syncMetadata,
  externalHandoff,
  previewAcceptance,
  clientRuntime,
  boundaryContext,
  operationalHealth
) {
  const primaryProviderRoute =
    providerContract.negotiation.dispatchPlan.find((item) => item.dispatchable)?.route ||
    providerContract.negotiation.dispatchPlan[0]?.route ||
    null;
  const blockedBy = normalizeStringList([
    ...previewAcceptance.acceptance.blockedBy,
    ...externalHandoff.blockedBy,
    ...operationalHealth.nextAction.blockedBy
  ]);
  const routeState = blockedBy.length
    ? 'blocked'
    : externalHandoff.accepted
      ? 'handoff-ready'
      : operationalHealth.dispatchable
        ? 'dispatch-ready'
        : lifecycle.scheduling.dispatchable
          ? 'schedule-ready'
          : previewAcceptance.acceptance.clientAcceptedPreview
            ? 'accepted'
            : 'preview-ready';
  const routeTargets = {
    preview: {
      method: 'GET',
      path: `/packages/${compatibility.package.id || 'unknown'}/compat-preview`,
      requiredState: 'preview-ready',
      responseContract: 'previewAcceptance.preview'
    },
    accept: {
      method: 'POST',
      path: `/packages/${compatibility.package.id || 'unknown'}/compat-preview/accept`,
      requiredState: previewAcceptance.preview.state,
      requestContract: {
        requestId: clientRuntime.request.id || null,
        acceptanceToken: previewAcceptance.acceptance.token,
        syncBasisKey: syncMetadata.basisKey
      }
    },
    install: {
      method: 'POST',
      path: `/packages/${compatibility.package.id || 'unknown'}/install`,
      enabled: lifecycle.installEligible && operationalHealth.dispatchable,
      providerRoute: primaryProviderRoute,
      requiredPermission: 'package.install'
    },
    handoff: {
      method: 'POST',
      path: providerContract.routing.handoffExportPath || primaryProviderRoute?.path || '/handoff/export',
      enabled: externalHandoff.accepted,
      channel: externalHandoff.channel,
      providerEndpoint: externalHandoff.providerEndpoint,
      returnUrl: externalHandoff.client.returnUrl,
      callbackRef: externalHandoff.client.callbackRef
    },
    audit: {
      method: 'GET',
      path: `/packages/${compatibility.package.id || 'unknown'}/compat-audit`,
      contentRefs: [
        syncMetadata.basisKey,
        boundaryContext.audit.permissionProofKey,
        boundaryContext.audit.workspaceProofKey
      ].filter(Boolean)
    }
  };
  const ctas = [
    {
      id: 'resolve-blockers',
      visible: blockedBy.length > 0,
      enabled: blockedBy.length > 0,
      kind: 'validation',
      label: 'Resolve validation blockers',
      route: routeTargets.preview,
      blockedBy: []
    },
    {
      id: 'accept-preview',
      visible: blockedBy.length === 0 && !previewAcceptance.acceptance.clientAcceptedPreview,
      enabled: previewAcceptance.acceptance.accepted && !previewAcceptance.acceptance.clientAcceptedPreview,
      kind: 'acceptance',
      label: 'Accept compatibility preview',
      route: routeTargets.accept,
      blockedBy
    },
    {
      id: 'dispatch-install',
      visible: lifecycle.command === 'install',
      enabled: lifecycle.installEligible && operationalHealth.dispatchable,
      kind: 'mutation',
      label: 'Dispatch hosted-kernel install',
      route: routeTargets.install,
      blockedBy: lifecycle.installEligible && operationalHealth.dispatchable ? [] : blockedBy
    },
    {
      id: 'export-handoff',
      visible: clientRuntime.handoff.requested,
      enabled: externalHandoff.accepted,
      kind: 'handoff',
      label: 'Export provider handoff',
      route: routeTargets.handoff,
      blockedBy: externalHandoff.accepted ? [] : externalHandoff.blockedBy
    },
    {
      id: 'view-audit-proof',
      visible: true,
      enabled: true,
      kind: 'audit',
      label: 'View audit proof',
      route: routeTargets.audit,
      blockedBy: []
    }
  ];
  const selectedCta =
    ctas.find((cta) => cta.visible && cta.enabled && cta.id !== 'view-audit-proof') ||
    ctas.find((cta) => cta.visible && cta.id === 'view-audit-proof');

  return {
    contractVersion: 1,
    generatedAt: now,
    state: routeState,
    client: {
      channel: clientRuntime.client.channel,
      workflowState: clientRuntime.client.workflowState,
      requestId: clientRuntime.request.id || null,
      traceId: clientRuntime.request.traceId,
      handoffRequested: clientRuntime.handoff.requested
    },
    readiness: {
      ...previewAcceptance.readiness,
      operationalDispatchable: operationalHealth.dispatchable,
      providerRouteAvailable: Boolean(primaryProviderRoute),
      routeState
    },
    validation: {
      ...previewAcceptance.validationSummary,
      blockedBy,
      operatorReviewRequired: previewAcceptance.acceptance.requiresOperatorReview
    },
    selectedCta,
    ctas,
    routeTargets,
    auditRefs: {
      syncBasisKey: syncMetadata.basisKey,
      scopeKey: boundaryContext.audit.scopeKey,
      permissionProofKey: boundaryContext.audit.permissionProofKey,
      workspaceProofKey: boundaryContext.audit.workspaceProofKey,
      acceptanceToken: previewAcceptance.acceptance.token
    },
    explainability: previewAcceptance.nextSteps.map((step, index) => ({
      order: index + 1,
      stepId: step.id,
      kind: step.kind,
      label: step.label,
      action: step.action,
      completesGate: step.completesGate,
      route:
        step.kind === 'install'
          ? routeTargets.install
          : step.kind === 'blocking-fix'
            ? routeTargets.preview
            : routeTargets.accept
    }))
  };
}

function selectProviderOperationForWorkflow(providerContract, lifecycle, externalHandoff, previewAcceptance) {
  const desiredOperation = externalHandoff.accepted
    ? 'handoffExport'
    : lifecycle.installEligible
      ? 'installDispatch'
      : previewAcceptance.acceptance.clientAcceptedPreview
        ? 'auditProof'
        : 'previewAcceptance';

  return (
    providerContract.negotiation.operations.find((operation) => operation.operation === desiredOperation) ||
    providerContract.negotiation.operations.find((operation) => operation.dispatchable) ||
    providerContract.negotiation.operations[0] ||
    null
  );
}

function buildClientWorkflowHandoffContract(
  now,
  compatibility,
  lifecycle,
  providerContract,
  syncMetadata,
  externalHandoff,
  previewAcceptance,
  clientRouteDecision,
  clientRuntime,
  boundaryContext,
  operationalHealth
) {
  const selectedProviderOperation = selectProviderOperationForWorkflow(
    providerContract,
    lifecycle,
    externalHandoff,
    previewAcceptance
  );
  const selectedCta = clientRouteDecision.selectedCta || null;
  const blockedBy = normalizeStringList([
    ...clientRouteDecision.validation.blockedBy,
    ...operationalHealth.nextAction.blockedBy,
    ...externalHandoff.blockedBy
  ]);
  const currentWorkflowState = clientRuntime.client.workflowState;
  const nextWorkflowState = blockedBy.length
    ? currentWorkflowState
    : externalHandoff.accepted
      ? 'handoff-pending'
      : lifecycle.installEligible && operationalHealth.dispatchable
        ? 'accepted'
        : previewAcceptance.acceptance.clientAcceptedPreview
          ? 'accepted'
          : 'previewed';
  const handoffMode = externalHandoff.accepted
    ? 'external-provider'
    : lifecycle.installEligible && operationalHealth.dispatchable
      ? 'hosted-kernel-dispatch'
      : previewAcceptance.acceptance.clientAcceptedPreview
        ? 'hosted-kernel-follow-up'
        : 'preview-acceptance';
  const packageRef = `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`;
  const resumeToken =
    clientRuntime.handoff.resumeToken ||
    [
      surfaceId,
      clientRuntime.request.id || 'anonymous-request',
      boundaryContext.audit.scopeKey,
      syncMetadata.basisKey,
      nextWorkflowState
    ].join('|');
  const handoffProofKey = [
    packageRef,
    boundaryContext.audit.scopeKey,
    boundaryContext.audit.permissionProofKey || 'no-permission-proof',
    syncMetadata.basisKey,
    selectedProviderOperation?.operation || 'no-provider-operation',
    nextWorkflowState
  ].join('|');

  return {
    contractVersion: 1,
    generatedAt: now,
    state: blockedBy.length ? 'blocked' : nextWorkflowState,
    mode: handoffMode,
    packageRef,
    selectedAction: selectedCta
      ? {
          id: selectedCta.id,
          kind: selectedCta.kind,
          label: selectedCta.label,
          enabled: selectedCta.enabled,
          route: selectedCta.route
        }
      : null,
    workflowStatePatch: {
      requestId: clientRuntime.request.id || null,
      traceId: clientRuntime.request.traceId,
      from: currentWorkflowState,
      to: nextWorkflowState,
      idempotencyKey: clientRuntime.request.idempotencyKey,
      resumeToken,
      acceptedPreviewToken: previewAcceptance.acceptance.clientAcceptedPreview
        ? clientRuntime.client.acceptedPreviewToken
        : null
    },
    providerOperation: selectedProviderOperation
      ? {
          operation: selectedProviderOperation.operation,
          dispatchable: selectedProviderOperation.dispatchable,
          requiredCapability: selectedProviderOperation.requiredCapability,
          route: selectedProviderOperation.route,
          syncCheckpointRef: selectedProviderOperation.sync.checkpointRef,
          blockedBy: selectedProviderOperation.blockedBy
        }
      : null,
    handoffTarget: {
      channel: externalHandoff.accepted ? externalHandoff.channel : clientRuntime.client.channel,
      providerEndpoint: externalHandoff.providerEndpoint,
      returnUrl: externalHandoff.client.returnUrl,
      callbackRef: externalHandoff.client.callbackRef,
      lease: externalHandoff.lease,
      resumeToken
    },
    proof: {
      handoffProofKey,
      acceptanceToken: previewAcceptance.acceptance.token,
      syncBasisKey: syncMetadata.basisKey,
      scopeKey: boundaryContext.audit.scopeKey,
      permissionProofKey: boundaryContext.audit.permissionProofKey,
      workspaceProofKey: boundaryContext.audit.workspaceProofKey
    },
    blockedBy
  };
}

function countBy(items, selector) {
  const counts = {};

  for (const item of items) {
    const key = asNonEmptyString(selector(item));
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return counts;
}

function normalizeHistorySnapshot(snapshot, index) {
  const value = asObject(snapshot);
  const issueCodes = Array.isArray(value.issueCodes)
    ? value.issueCodes.map(asNonEmptyString).filter(Boolean)
    : [];
  const missingCapabilities = Array.isArray(value.missingCapabilities)
    ? value.missingCapabilities.map(asNonEmptyString).filter(Boolean)
    : [];

  return {
    sequence: Number.isFinite(value.sequence) ? value.sequence : index,
    generatedAt: asNonEmptyString(value.generatedAt || value.at || value.timestamp) || null,
    healthState: asNonEmptyString(value.healthState || value.state || 'unknown').toLowerCase(),
    packageId: asNonEmptyString(value.packageId) || null,
    packageVersion: asNonEmptyString(value.packageVersion) || null,
    kernelId: asNonEmptyString(value.kernelId) || null,
    retryable: Boolean(value.retryable),
    attempts: Math.max(0, Number.isFinite(value.attempts) ? value.attempts : Number(value.retryAttempts || 0) || 0),
    issueCodes,
    missingCapabilities
  };
}

function buildAnalytics(compatibility, historySnapshots) {
  const missingCapabilities = compatibility.issues
    .filter((issue) => issue.code === 'MISSING_KERNEL_CAPABILITY')
    .map((issue) => issue.capability)
    .filter(Boolean)
    .sort();
  const allSnapshots = [
    ...historySnapshots,
    {
      healthState: compatibility.healthState,
      issueCodes: compatibility.issues.map((issue) => issue.code),
      missingCapabilities,
      retryable: compatibility.retryPolicy.retryable,
      attempts: compatibility.retryPolicy.attempts
    }
  ];
  const failedSnapshots = allSnapshots.filter((snapshot) => snapshot.healthState === 'failed').length;
  const degradedSnapshots = allSnapshots.filter((snapshot) => snapshot.healthState === 'degraded').length;
  const retryableSnapshots = allSnapshots.filter((snapshot) => snapshot.retryable).length;
  const uniqueIssueCodes = [...new Set(allSnapshots.flatMap((snapshot) => snapshot.issueCodes))].sort();
  const uniqueMissingCapabilities = [...new Set(allSnapshots.flatMap((snapshot) => snapshot.missingCapabilities))].sort();

  return {
    sampleCount: allSnapshots.length,
    priorSampleCount: historySnapshots.length,
    failedSnapshots,
    degradedSnapshots,
    retryableSnapshots,
    currentIssueCount: compatibility.issues.length,
    currentErrorCount: compatibility.issues.filter((issue) => issue.severity === 'error').length,
    currentWarningCount: compatibility.issues.filter((issue) => issue.severity === 'warning').length,
    issueCodeCounts: countBy(allSnapshots.flatMap((snapshot) => snapshot.issueCodes), (code) => code),
    issueSeverityCounts: countBy(compatibility.issues, (issue) => issue.severity),
    missingCapabilityCounts: countBy(allSnapshots.flatMap((snapshot) => snapshot.missingCapabilities), (capability) => capability),
    uniqueIssueCodes,
    uniqueMissingCapabilities,
    readyForInstall: compatibility.healthState === 'healthy' && compatibility.issues.length === 0,
    exportRisk: failedSnapshots > 0 ? 'blocked' : degradedSnapshots > 0 ? 'degraded' : 'clear'
  };
}

function buildTimeline(now, compatibility, historySnapshots) {
  const priorEvents = historySnapshots.map((snapshot, index) => ({
    sequence: snapshot.sequence,
    generatedAt: snapshot.generatedAt,
    event: 'compat-history-snapshot',
    healthState: snapshot.healthState,
    retryable: snapshot.retryable,
    attempts: snapshot.attempts,
    issueCodes: snapshot.issueCodes,
    missingCapabilities: snapshot.missingCapabilities,
    order: index
  }));
  const currentMissingCapabilities = compatibility.issues
    .filter((issue) => issue.code === 'MISSING_KERNEL_CAPABILITY')
    .map((issue) => issue.capability)
    .filter(Boolean)
    .sort();

  return [
    ...priorEvents,
    {
      sequence: historySnapshots.length,
      generatedAt: now,
      event: 'compat-current-assessment',
      healthState: compatibility.healthState,
      retryable: compatibility.retryPolicy.retryable,
      attempts: compatibility.retryPolicy.attempts,
      issueCodes: compatibility.issues.map((issue) => issue.code),
      missingCapabilities: currentMissingCapabilities,
      order: historySnapshots.length
    }
  ];
}

function buildExportSummary(
  now,
  compatibility,
  analytics,
  lifecycle,
  providerContract,
  syncMetadata,
  externalHandoff,
  clientRuntime,
  clientIssues,
  boundaryContext,
  boundaryIssues,
  previewAcceptance,
  clientRouteDecision,
  clientWorkflowHandoff,
  restartSafeStatus,
  persistedCommandContract,
  persistedCommandIssues,
  operationalHealth
) {
  return {
    exportVersion: 1,
    generatedAt: now,
    surfaceId,
    packageRef: `${compatibility.package.id || 'unknown'}@${compatibility.package.version || 'unknown'}`,
    kernelRef: compatibility.kernel.id,
    healthState: compatibility.healthState,
    installEligible: lifecycle.installEligible,
    lifecycleCommand: lifecycle.command,
    lifecycleAccepted: lifecycle.accepted,
    nextActionState: lifecycle.nextAction.state,
    retryable: compatibility.retryPolicy.retryable,
    nextRetryDelayMs: compatibility.retryPolicy.nextDelayMs,
    operationalState: operationalHealth.state,
    operationalDispatchable: operationalHealth.dispatchable,
    issueCodes: [
      ...compatibility.issues,
      ...providerContract.issues,
      ...lifecycle.issues,
      ...clientIssues,
      ...boundaryIssues,
      ...persistedCommandIssues,
      ...operationalHealth.issues
    ].map((issue) => issue.code),
    counters: {
      samples: analytics.sampleCount,
      errors: analytics.currentErrorCount,
      warnings: analytics.currentWarningCount,
      failedSnapshots: analytics.failedSnapshots,
      degradedSnapshots: analytics.degradedSnapshots
    },
    missingKernelCapabilities: analytics.uniqueMissingCapabilities,
    scheduleActive: lifecycle.scheduling.active,
    provider: {
      id: providerContract.provider.id,
      status: providerContract.provider.status,
      serviceRef: providerContract.serviceRef,
      contractVersion: providerContract.contractVersion,
      negotiationAccepted: providerContract.negotiation.accepted,
      externalHandoffReady: providerContract.negotiation.externalHandoffReady,
      missingRequiredCapabilities: providerContract.negotiation.missingRequired,
      operationMatrix: providerContract.negotiation.operations,
      dispatchPlan: providerContract.negotiation.dispatchPlan,
      syncMode: providerContract.sync.mode,
      syncCheckpoint: providerContract.negotiation.syncCheckpoint,
      schemaVersion: providerContract.provider.schemaVersion,
      resourceVersion: providerContract.provider.resourceVersion,
      handoffLeaseTtlMs: providerContract.handoffPolicy.ttlMs
    },
    sync: {
      route: syncMetadata.route,
      cursor: syncMetadata.cursor,
      mode: syncMetadata.mode,
      schemaVersion: syncMetadata.schemaVersion,
      resourceVersion: syncMetadata.resourceVersion,
      providerCheckpointRef: syncMetadata.providerCheckpoint.checkpointRef,
      providerCheckpointBasisKey: syncMetadata.providerCheckpoint.basisKey,
      basisKey: syncMetadata.basisKey,
      tenantRef: syncMetadata.tenantRef,
      workspaceRef: syncMetadata.workspaceRef
    },
    boundary: {
      tenantId: boundaryContext.tenant.id,
      packageTenantId: boundaryContext.tenant.packageTenantId,
      providerTenantId: boundaryContext.tenant.providerTenantId,
      workspaceId: boundaryContext.workspace.id,
      packageWorkspaceId: boundaryContext.workspace.packageWorkspaceId,
      providerWorkspaceId: boundaryContext.workspace.providerWorkspaceId,
      actorId: boundaryContext.actor.id,
      actorType: boundaryContext.actor.type,
      roles: boundaryContext.actor.roles,
      requestedOperations: boundaryContext.requestedOperations,
      requiredPermissions: boundaryContext.requiredPermissions,
      operationAuthorization: boundaryContext.operationAuthorization.map((authorization) => ({
        operation: authorization.operation,
        permission: authorization.permission,
        granted: authorization.granted,
        scopedGrantRequired: authorization.scopedGrantRequired,
        scopedGrantMatched: authorization.scopedGrantMatched,
        deniedBy: authorization.deniedBy
      })),
      permissionBoundary: {
        isolationMode: boundaryContext.permissionBoundary.isolationMode,
        handoffSafe: boundaryContext.permissionBoundary.handoffSafe,
        scopedGrantRequired: boundaryContext.permissionBoundary.scopedGrantRequired,
        scopedGrantMatched: boundaryContext.permissionBoundary.scopedGrantMatched,
        authorizedOperations: boundaryContext.permissionBoundary.authorizedOperations,
        deniedOperations: boundaryContext.permissionBoundary.deniedOperations,
        blockingReasons: boundaryContext.permissionBoundary.blockingReasons,
        proofRefs: boundaryContext.permissionBoundary.proofRefs
      },
      permissionProofKey: boundaryContext.audit.permissionProofKey,
      workspaceProofKey: boundaryContext.audit.workspaceProofKey,
      handoffProofKey: boundaryContext.audit.handoffProofKey,
      workspaceScopePolicy: {
        mode: boundaryContext.workspace.scopePolicy.mode,
        writeRequired: boundaryContext.workspace.scopePolicy.writeRequired,
        mutationOperations: boundaryContext.workspace.scopePolicy.mutationOperations,
        deniedLanes: boundaryContext.workspace.scopePolicy.deniedLanes,
        lanes: boundaryContext.workspace.scopePolicy.lanes.map((lane) => ({
          label: lane.label,
          constrained: lane.constrained,
          matched: lane.matched
        }))
      },
      issueCodes: boundaryIssues.map((issue) => issue.code)
    },
    restartSafety: {
      status: restartSafeStatus.status,
      restartAction: restartSafeStatus.restartAction,
      idempotentReplay: restartSafeStatus.idempotentReplay,
      duplicateCommand: restartSafeStatus.duplicateCommand,
      checkpointStale: restartSafeStatus.checkpoint.stale,
      shouldPersist: restartSafeStatus.writeIntent.shouldPersist,
      nextGeneration: restartSafeStatus.writeIntent.nextGeneration,
      replayMode: persistedCommandContract.replay.mode,
      recoveryAction: persistedCommandContract.recovery.action,
      recoveryResumable: persistedCommandContract.recovery.resumable,
      recoveryReplaceable: persistedCommandContract.recovery.replaceable,
      operatorRecoveryRequired: persistedCommandContract.recovery.operatorRecoveryRequired,
      selectedRecoveryRecord: persistedCommandContract.recovery.selectedRecord
        ? {
            role: persistedCommandContract.recovery.selectedRecord.role,
            id: persistedCommandContract.recovery.selectedRecord.id,
            state: persistedCommandContract.recovery.selectedRecord.state,
            recoveryMode: persistedCommandContract.recovery.selectedRecord.recoveryMode,
            unsafeReason: persistedCommandContract.recovery.selectedRecord.unsafeReason,
            lease: persistedCommandContract.recovery.selectedRecord.lease
          }
        : null,
      hostWriteOperation: persistedCommandContract.hostWrite.operation,
      hostWriteRequired: persistedCommandContract.hostWrite.required,
      persistedIssueCodes: persistedCommandIssues.map((issue) => issue.code)
    },
    operationalHealth: {
      state: operationalHealth.state,
      dispatchable: operationalHealth.dispatchable,
      degradedMode: operationalHealth.degradedMode,
      failureState: operationalHealth.failureState,
      retryWindow: operationalHealth.retryWindow,
      nextAction: operationalHealth.nextAction,
      issueCodes: operationalHealth.issues.map((issue) => issue.code)
    },
    externalHandoff: {
      state: externalHandoff.state,
      accepted: externalHandoff.accepted,
      channel: externalHandoff.channel,
      blockedBy: externalHandoff.blockedBy
    },
    clientRuntime: {
      requestId: clientRuntime.request.id || null,
      traceId: clientRuntime.request.traceId,
      channel: clientRuntime.client.channel,
      workflowState: clientRuntime.client.workflowState,
      handoffRequested: clientRuntime.handoff.requested,
      requestedOperations: clientRuntime.client.requestedOperations,
      issueCodes: clientIssues.map((issue) => issue.code)
    },
    validationSummary: previewAcceptance.validationSummary,
    clientPreview: {
      state: previewAcceptance.preview.state,
      primaryAction: previewAcceptance.preview.primaryAction,
      summary: previewAcceptance.preview.summary,
      acceptanceToken: previewAcceptance.acceptance.token,
      readiness: previewAcceptance.readiness,
      nextStepCount: previewAcceptance.nextSteps.length
    },
    clientRouteDecision: {
      state: clientRouteDecision.state,
      selectedCta: clientRouteDecision.selectedCta,
      routeTargets: clientRouteDecision.routeTargets,
      blockedBy: clientRouteDecision.validation.blockedBy,
      auditRefs: clientRouteDecision.auditRefs
    },
    clientWorkflowHandoff: {
      state: clientWorkflowHandoff.state,
      mode: clientWorkflowHandoff.mode,
      selectedAction: clientWorkflowHandoff.selectedAction,
      workflowStatePatch: clientWorkflowHandoff.workflowStatePatch,
      providerOperation: clientWorkflowHandoff.providerOperation,
      handoffTarget: clientWorkflowHandoff.handoffTarget,
      proof: clientWorkflowHandoff.proof,
      blockedBy: clientWorkflowHandoff.blockedBy
    }
  };
}

function normalizeReportingOptions(input) {
  const reporting = asObject(input.reporting || input.analyticsReporting || input.exportReporting);
  const exportRequest = asObject(input.export || reporting.export);
  const requestedFormats = normalizeStringList(
    exportRequest.formats || reporting.formats || input.exportFormats,
    ['json']
  ).filter((format) => SUPPORTED_REPORT_EXPORT_FORMATS.includes(format));

  return {
    contractVersion: 1,
    requestedBy: asNonEmptyString(reporting.requestedBy || input.reportingRequestedBy || input.requestedBy) || 'system',
    retentionLimit: asBoundedInteger(reporting.retentionLimit ?? input.historyRetentionLimit, 12, 1, 50),
    includeTimeline: asBoolean(reporting.includeTimeline ?? input.includeTimelineReport, true),
    includeEvidence: asBoolean(reporting.includeEvidence ?? input.includeEvidenceReport, true),
    formats: requestedFormats.length ? requestedFormats : ['json'],
    destinationRef: asNonEmptyString(exportRequest.destinationRef || reporting.destinationRef || input.exportDestinationRef) || null,
    reportRef:
      asNonEmptyString(reporting.reportRef || exportRequest.reportRef || input.reportRef) ||
      `${surfaceId}:compat-report`
  };
}

function buildCurrentHistorySnapshot(now, compatibility, lifecycle, providerContract, clientRuntime, boundaryContext, issues) {
  const issueCodes = issues.map((issue) => issue.code).filter(Boolean);
  const missingCapabilities = compatibility.issues
    .filter((issue) => issue.code === 'MISSING_KERNEL_CAPABILITY')
    .map((issue) => issue.capability)
    .filter(Boolean)
    .sort();

  return {
    sequence: null,
    generatedAt: now,
    healthState: compatibility.healthState,
    packageId: compatibility.package.id,
    packageVersion: compatibility.package.version,
    kernelId: compatibility.kernel.id,
    providerId: providerContract.provider.id || null,
    providerStatus: providerContract.provider.status,
    tenantId: boundaryContext.tenant.id,
    workspaceId: boundaryContext.workspace.id,
    lifecycleCommand: lifecycle.command,
    nextActionState: lifecycle.nextAction.state,
    clientChannel: clientRuntime.client.channel,
    clientWorkflowState: clientRuntime.client.workflowState,
    retryable: compatibility.retryPolicy.retryable,
    attempts: compatibility.retryPolicy.attempts,
    issueCodes,
    missingCapabilities
  };
}

function countIssueSeverities(issues) {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    total: issues.length
  };
}

function buildReportingState(
  now,
  reportingOptions,
  compatibility,
  lifecycle,
  providerContract,
  clientRuntime,
  boundaryContext,
  historySnapshots,
  timeline,
  exportSummary,
  restartSafeStatus,
  issues
) {
  const currentSnapshot = buildCurrentHistorySnapshot(
    now,
    compatibility,
    lifecycle,
    providerContract,
    clientRuntime,
    boundaryContext,
    issues
  );
  const retainedSnapshots = [...historySnapshots, currentSnapshot]
    .slice(-reportingOptions.retentionLimit)
    .map((snapshot, index) => ({
      ...snapshot,
      sequence: index
    }));
  const previous = retainedSnapshots.length > 1 ? retainedSnapshots[retainedSnapshots.length - 2] : null;
  const currentIssueCounts = countIssueSeverities(issues);
  const exportBlockedBy = [
    ...new Set([
      ...exportSummary.issueCodes.filter((code) =>
        ['MISSING_TENANT_ID', 'MISSING_WORKSPACE_ID', 'TENANT_BOUNDARY_VIOLATION', 'WORKSPACE_SCOPE_DENIED'].includes(code)
      ),
      ...(restartSafeStatus.checkpoint.stale ? ['STALE_PERSISTED_CHECKPOINT'] : [])
    ])
  ];
  const recordCount =
    1 + retainedSnapshots.length + (reportingOptions.includeTimeline ? timeline.length : 0) + (reportingOptions.includeEvidence ? 2 : 0);

  return {
    contractVersion: 1,
    generatedAt: now,
    reportRef: reportingOptions.reportRef,
    requestedBy: reportingOptions.requestedBy,
    exportReady: exportBlockedBy.length === 0,
    exportBlockedBy,
    retention: {
      limit: reportingOptions.retentionLimit,
      retained: retainedSnapshots.length,
      dropped: Math.max(0, historySnapshots.length + 1 - retainedSnapshots.length)
    },
    counters: {
      current: currentIssueCounts,
      providerIssueCount: providerContract.issues.length,
      boundaryIssueCount: exportSummary.boundary.issueCodes.length,
      clientIssueCount: exportSummary.clientRuntime.issueCodes.length,
      retainedFailed: retainedSnapshots.filter((snapshot) => snapshot.healthState === 'failed').length,
      retainedDegraded: retainedSnapshots.filter((snapshot) => snapshot.healthState === 'degraded').length,
      retainedRetryable: retainedSnapshots.filter((snapshot) => snapshot.retryable).length
    },
    delta: {
      previousHealthState: previous ? previous.healthState : null,
      healthStateChanged: previous ? previous.healthState !== compatibility.healthState : false,
      issueCountDelta: previous ? currentIssueCounts.total - previous.issueCodes.length : currentIssueCounts.total,
      retryAttemptsDelta: previous ? compatibility.retryPolicy.attempts - previous.attempts : compatibility.retryPolicy.attempts
    },
    snapshots: retainedSnapshots,
    timelineReport: {
      included: reportingOptions.includeTimeline,
      eventCount: reportingOptions.includeTimeline ? timeline.length : 0,
      latestEvent: reportingOptions.includeTimeline ? timeline[timeline.length - 1] || null : null,
      nextActionState: lifecycle.nextAction.state
    },
    exports: reportingOptions.formats.map((format) => ({
      format,
      destinationRef: reportingOptions.destinationRef,
      ready: exportBlockedBy.length === 0,
      recordCount,
      contentRef: `${reportingOptions.reportRef}:${format}:${exportSummary.sync.basisKey}`,
      mimeType:
        format === 'csv'
          ? 'text/csv'
          : format === 'ndjson'
            ? 'application/x-ndjson'
            : 'application/json'
    }))
  };
}

function normalizeAnalyticsExportRun(value, index) {
  const run = asObject(value);
  const format = asNonEmptyString(run.format || run.exportFormat || 'json').toLowerCase();
  const requestedAt = asNonEmptyString(run.requestedAt || run.generatedAt || run.at) || null;
  const completedAt = asNonEmptyString(run.completedAt || run.finishedAt) || null;
  const issueCodes = normalizeStringList(run.issueCodes || run.blockedBy);
  const ready = asBoolean(run.ready ?? run.exportReady, issueCodes.length === 0);

  return {
    sequence: Number.isFinite(run.sequence) ? run.sequence : index,
    runId: asNonEmptyString(run.runId || run.id || run.exportId) || `analytics-export-${index}`,
    reportRef: asNonEmptyString(run.reportRef) || null,
    format: SUPPORTED_REPORT_EXPORT_FORMATS.includes(format) ? format : 'json',
    destinationRef: asNonEmptyString(run.destinationRef || run.destination) || null,
    contentRef: asNonEmptyString(run.contentRef || run.artifactRef) || null,
    requestedAt,
    completedAt,
    status: asNonEmptyString(run.status || (ready ? 'ready' : 'blocked')).toLowerCase(),
    ready,
    recordCount: Math.max(0, Number(run.recordCount || 0) || 0),
    issueCodes
  };
}

function normalizeAnalyticsExportHistory(input) {
  const reporting = asObject(input.reporting || input.analyticsReporting || input.exportReporting);
  const exportRequest = asObject(input.export || reporting.export);
  const source =
    input.analyticsExportHistory ||
    input.exportHistory ||
    reporting.exportHistory ||
    exportRequest.history ||
    [];

  return Array.isArray(source) ? source.map(normalizeAnalyticsExportRun) : [];
}

function buildCurrentAnalyticsExportRuns(now, reportingState, exportSummary) {
  return reportingState.exports.map((item, index) => ({
    sequence: index,
    runId: `${reportingState.reportRef}:${item.format}:${index}`,
    reportRef: reportingState.reportRef,
    format: item.format,
    destinationRef: item.destinationRef,
    contentRef: item.contentRef,
    requestedAt: now,
    completedAt: item.ready ? now : null,
    status: item.ready ? 'ready' : 'blocked',
    ready: item.ready,
    recordCount: item.recordCount,
    issueCodes: item.ready ? [] : exportSummary.issueCodes
  }));
}

function buildAnalyticsExportHistoryState(
  now,
  reportingOptions,
  reportingState,
  exportSummary,
  priorExportRuns,
  timeline,
  issues
) {
  const currentRuns = buildCurrentAnalyticsExportRuns(now, reportingState, exportSummary);
  const retainedRuns = [...priorExportRuns, ...currentRuns]
    .slice(-reportingOptions.retentionLimit)
    .map((run, index) => ({
      ...run,
      sequence: index
    }));
  const blockedRuns = retainedRuns.filter((run) => !run.ready || run.status === 'blocked');
  const readyRuns = retainedRuns.filter((run) => run.ready && run.status !== 'blocked');
  const latestRun = retainedRuns[retainedRuns.length - 1] || null;
  const currentIssueCodes = normalizeStringList(issues.map((issue) => issue.code));
  const destinationRefs = normalizeStringList(retainedRuns.map((run) => run.destinationRef).filter(Boolean));

  return {
    contractVersion: 1,
    generatedAt: now,
    reportRef: reportingState.reportRef,
    retention: {
      limit: reportingOptions.retentionLimit,
      retained: retainedRuns.length,
      priorRuns: priorExportRuns.length,
      currentRuns: currentRuns.length,
      dropped: Math.max(0, priorExportRuns.length + currentRuns.length - retainedRuns.length)
    },
    counters: {
      byFormat: countBy(retainedRuns, (run) => run.format),
      byStatus: countBy(retainedRuns, (run) => run.status),
      ready: readyRuns.length,
      blocked: blockedRuns.length,
      currentReady: currentRuns.filter((run) => run.ready).length,
      currentBlocked: currentRuns.filter((run) => !run.ready).length,
      issueCodeCounts: countBy(retainedRuns.flatMap((run) => run.issueCodes), (code) => code)
    },
    latestRun,
    exportReady: reportingState.exportReady && currentRuns.every((run) => run.ready),
    exportBlockedBy: normalizeStringList([
      ...reportingState.exportBlockedBy,
      ...currentRuns.flatMap((run) => run.issueCodes),
      ...currentIssueCodes.filter((code) => code.startsWith('AUDIT_') || code.startsWith('PERSISTED_COMMAND_'))
    ]),
    manifest: {
      packageRef: exportSummary.packageRef,
      kernelRef: exportSummary.kernelRef,
      tenantRef: exportSummary.sync.tenantRef,
      workspaceRef: exportSummary.sync.workspaceRef,
      syncBasisKey: exportSummary.sync.basisKey,
      destinationRefs,
      formats: reportingOptions.formats,
      contentRefs: currentRuns.map((run) => run.contentRef).filter(Boolean),
      evidenceRefs: [
        exportSummary.sync.basisKey,
        exportSummary.restartSafety.replayMode,
        exportSummary.operationalHealth.state,
        reportingState.reportRef
      ]
    },
    timelineAppend: {
      event: 'analytics-export-history-appended',
      generatedAt: now,
      reportRef: reportingState.reportRef,
      exportReady: reportingState.exportReady,
      runCount: currentRuns.length,
      latestCompatibilityEvent: timeline[timeline.length - 1]?.event || null,
      latestHealthState: timeline[timeline.length - 1]?.healthState || null
    },
    runs: retainedRuns
  };
}

function computeRetryPolicy(input, healthState) {
  const retry = asObject(input.retry);
  const attempts = Math.max(0, Number.isFinite(retry.attempts) ? retry.attempts : Number(input.retryAttempts || 0) || 0);
  const maxAttempts = Math.max(1, Number.isFinite(retry.maxAttempts) ? retry.maxAttempts : 3);
  const baseDelayMs = Math.max(50, Number.isFinite(retry.baseDelayMs) ? retry.baseDelayMs : 250);
  const maxDelayMs = Math.max(baseDelayMs, Number.isFinite(retry.maxDelayMs) ? retry.maxDelayMs : 30_000);
  const lastAttemptAt = parseTimestampMs(retry.lastAttemptAt || input.retryLastAttemptAt);
  const explicitRetryAfter = parseTimestampMs(retry.retryAfterAt || input.retryAfterAt);
  const cappedAttempt = Math.min(attempts, maxAttempts);
  const nextDelayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** cappedAttempt);
  const retryable = healthState === 'failed' && attempts < maxAttempts;
  const computedRetryAfterMs =
    retryable && Number.isFinite(lastAttemptAt.ms) ? lastAttemptAt.ms + nextDelayMs : Number.NaN;
  const retryAfterMs = Number.isFinite(explicitRetryAfter.ms)
    ? explicitRetryAfter.ms
    : computedRetryAfterMs;

  return {
    attempts,
    maxAttempts,
    maxDelayMs,
    retryable,
    nextDelayMs: retryable ? nextDelayMs : 0,
    retryAfterAt: retryable && Number.isFinite(retryAfterMs) ? new Date(retryAfterMs).toISOString() : null,
    backoff: retryable ? `exponential:${baseDelayMs}ms:${nextDelayMs}ms` : 'none',
    exhausted: healthState === 'failed' && attempts >= maxAttempts
  };
}

function buildOperationalHealthContract(now, compatibility, lifecycle, providerContract, persistedCommandContract) {
  const nowMs = Date.parse(now);
  const retryAfterMs = compatibility.retryPolicy.retryAfterAt ? Date.parse(compatibility.retryPolicy.retryAfterAt) : Number.NaN;
  const backoffActive =
    compatibility.retryPolicy.retryable &&
    Number.isFinite(nowMs) &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > nowMs;
  const terminalFailure = persistedCommandContract.validation.terminalFailure;
  const degradedSources = [
    compatibility.healthState === 'degraded' ? 'kernel' : null,
    providerContract.provider.status === 'degraded' ? 'provider' : null
  ].filter(Boolean);
  const mutationCommand = ['install', 'disable', 'suspend', 'enable'].includes(lifecycle.command);
  const mutationBlockedByDegradation = mutationCommand && degradedSources.length > 0;
  const hardFailure =
    compatibility.retryPolicy.exhausted ||
    Boolean(terminalFailure) ||
    persistedCommandContract.replay.mode === 'blocked-conflict' ||
    persistedCommandContract.replay.mode === 'blocked-unsafe-recovery';
  const dispatchState = hardFailure
    ? 'terminal-failure'
    : backoffActive
      ? 'backoff'
      : mutationBlockedByDegradation
        ? 'degraded-read-only'
        : compatibility.healthState === 'failed'
          ? 'retryable-failure'
          : 'open';
  const issues = [];

  if (backoffActive) {
    issues.push(buildIssue('OPERATIONAL_BACKOFF_ACTIVE', 'error', {
      retryAfterAt: compatibility.retryPolicy.retryAfterAt,
      nextDelayMs: compatibility.retryPolicy.nextDelayMs,
      attempts: compatibility.retryPolicy.attempts,
      maxAttempts: compatibility.retryPolicy.maxAttempts
    }));
  }

  if (hardFailure) {
    issues.push(buildIssue('OPERATIONAL_FAILURE_STATE_ACTIVE', 'error', {
      retryExhausted: compatibility.retryPolicy.exhausted,
      replayMode: persistedCommandContract.replay.mode,
      recoveryAction: persistedCommandContract.recovery.action,
      terminalFailureCode: terminalFailure ? terminalFailure.errorCode : null
    }));
  }

  if (mutationBlockedByDegradation) {
    issues.push(buildIssue('OPERATIONAL_DEGRADED_MUTATION_BLOCKED', 'error', {
      command: lifecycle.command,
      degradedSources,
      fallbackMode: 'read-only-discovery'
    }));
  }

  return {
    contractVersion: 1,
    generatedAt: now,
    state: dispatchState,
    dispatchable: dispatchState === 'open' && lifecycle.installEligible,
    degradedMode: {
      active: degradedSources.length > 0,
      sources: degradedSources,
      allowedOperations: degradedSources.length ? ['discover', 'validate', 'audit'] : ['discover', 'validate', 'audit', 'install'],
      blockedOperations: degradedSources.length ? ['install', 'enable', 'disable', 'suspend'] : []
    },
    failureState: {
      active: hardFailure,
      retryExhausted: compatibility.retryPolicy.exhausted,
      replayMode: persistedCommandContract.replay.mode,
      recoveryAction: persistedCommandContract.recovery.action,
      terminalFailure: terminalFailure
        ? {
            commandId: terminalFailure.id,
            errorCode: terminalFailure.errorCode,
            resultRef: terminalFailure.resultRef
          }
        : null
    },
    retryWindow: {
      active: backoffActive,
      retryable: compatibility.retryPolicy.retryable,
      attempts: compatibility.retryPolicy.attempts,
      maxAttempts: compatibility.retryPolicy.maxAttempts,
      nextDelayMs: compatibility.retryPolicy.nextDelayMs,
      retryAfterAt: compatibility.retryPolicy.retryAfterAt,
      backoff: compatibility.retryPolicy.backoff
    },
    nextAction: {
      state:
        dispatchState === 'open'
          ? lifecycle.nextAction.state
          : dispatchState === 'backoff'
            ? 'wait-for-retry-backoff'
            : dispatchState === 'degraded-read-only'
              ? 'serve-read-only-compatibility'
              : 'require-operator-recovery',
      blockedBy: issues.map((issue) => issue.code)
    },
    issues
  };
}

function assessCompatibility(input) {
  const kernel = normalizeKernel(input);
  const pkg = normalizePackage(input);
  const providerContract = negotiateProviderContract(normalizeProviderContract(input, pkg));
  const issues = [];

  if (!pkg.id) {
    issues.push(buildIssue('MISSING_PACKAGE_ID', 'error'));
  }

  if (!pkg.version) {
    issues.push(buildIssue('MISSING_PACKAGE_VERSION', 'error'));
  }

  if (!['ready', 'degraded'].includes(kernel.state)) {
    issues.push(buildIssue('INVALID_KERNEL_STATE', 'error', { kernelState: kernel.state }));
  }

  for (const capability of pkg.requestedCapabilities) {
    if (!kernel.capabilities.has(capability)) {
      issues.push(buildIssue('MISSING_KERNEL_CAPABILITY', 'error', { capability }));
    }
  }

  if (kernel.state === 'degraded') {
    issues.push(buildIssue('ADAPTER_DEGRADED_MODE', 'warning', {
      reason: kernel.degradedReason || 'hosted kernel reported degraded state'
    }));
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  const healthState = hasError ? 'failed' : kernel.state === 'degraded' ? 'degraded' : 'healthy';
  const retryPolicy = computeRetryPolicy(input, healthState);

  if (healthState === 'failed' && !retryPolicy.retryable) {
    issues.push(buildIssue('ADAPTER_RETRY_EXHAUSTED', 'error', {
      attempts: retryPolicy.attempts,
      maxAttempts: retryPolicy.maxAttempts,
      lastError: kernel.lastError || 'compatibility validation failed'
    }));
  }

  return {
    healthState,
    degraded: healthState === 'degraded',
    package: {
      id: pkg.id || null,
      version: pkg.version || null,
      requiredKernelCapabilities: pkg.requestedCapabilities
    },
    kernel: {
      id: kernel.id,
      state: kernel.state,
      capabilities: [...kernel.capabilities].sort()
    },
    retryPolicy,
    issues,
    providerContract,
    providerIssues: providerContract.issues
  };
}

export function describeCompatAdapterSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const compatibility = assessCompatibility(input);
  const lifecycleSettings = normalizeLifecycleSettings(input);
  const clientRuntime = normalizeClientRuntimeState(input, lifecycleSettings);
  const clientIssues = validateClientRuntimeState(clientRuntime);
  const boundaryContext = buildBoundaryContext(input, lifecycleSettings, clientRuntime, now);
  const boundaryIssues = validateBoundaryContext(boundaryContext, clientRuntime);
  const lifecycle = buildLifecycleControls(now, compatibility, lifecycleSettings, clientIssues, boundaryIssues);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const historySnapshots = Array.isArray(input.history)
    ? input.history.map(normalizeHistorySnapshot)
    : [];
  const analytics = buildAnalytics(compatibility, historySnapshots);
  const timeline = buildTimeline(now, compatibility, historySnapshots);
  const reportingOptions = normalizeReportingOptions(input);
  const syncMetadata = buildSyncMetadata(now, compatibility, compatibility.providerContract, lifecycle, boundaryContext);
  const persistedState = normalizePersistedAdapterState(input, now);
  const restartSafeStatus = buildRestartSafeStatus(
    now,
    compatibility,
    lifecycle,
    syncMetadata,
    clientRuntime,
    persistedState
  );
  const persistedStateEnvelope = buildPersistedStateEnvelope(
    now,
    compatibility,
    lifecycle,
    syncMetadata,
    clientRuntime,
    persistedState,
    restartSafeStatus
  );
  const persistedCommandContract = buildPersistedCommandContract(
    now,
    compatibility,
    lifecycle,
    syncMetadata,
    clientRuntime,
    persistedState,
    restartSafeStatus
  );
  const persistedCommandIssues = validatePersistedCommandContract(persistedCommandContract);
  const operationalHealth = buildOperationalHealthContract(
    now,
    compatibility,
    lifecycle,
    compatibility.providerContract,
    persistedCommandContract
  );
  const allIssues = [
    ...compatibility.issues,
    ...compatibility.providerIssues,
    ...lifecycle.issues,
    ...clientIssues,
    ...boundaryIssues,
    ...persistedCommandIssues,
    ...operationalHealth.issues
  ];
  const externalHandoff = buildExternalHandoffState(
    now,
    compatibility,
    compatibility.providerContract,
    lifecycle,
    syncMetadata,
    clientRuntime,
    clientIssues,
    boundaryContext,
    boundaryIssues,
    [...persistedCommandIssues, ...operationalHealth.issues]
  );
  const previewAcceptance = buildPreviewAcceptanceContract(
    now,
    compatibility,
    lifecycle,
    compatibility.providerContract,
    syncMetadata,
    externalHandoff,
    clientRuntime,
    boundaryContext,
    allIssues
  );
  const clientRouteDecision = buildClientRouteDecisionContract(
    now,
    compatibility,
    lifecycle,
    compatibility.providerContract,
    syncMetadata,
    externalHandoff,
    previewAcceptance,
    clientRuntime,
    boundaryContext,
    operationalHealth
  );
  const clientWorkflowHandoff = buildClientWorkflowHandoffContract(
    now,
    compatibility,
    lifecycle,
    compatibility.providerContract,
    syncMetadata,
    externalHandoff,
    previewAcceptance,
    clientRouteDecision,
    clientRuntime,
    boundaryContext,
    operationalHealth
  );
  const exportSummary = buildExportSummary(
    now,
    compatibility,
    analytics,
    lifecycle,
    compatibility.providerContract,
    syncMetadata,
    externalHandoff,
    clientRuntime,
    clientIssues,
    boundaryContext,
    boundaryIssues,
    previewAcceptance,
    clientRouteDecision,
    clientWorkflowHandoff,
    restartSafeStatus,
    persistedCommandContract,
    persistedCommandIssues,
    operationalHealth
  );
  const reportingState = buildReportingState(
    now,
    reportingOptions,
    compatibility,
    lifecycle,
    compatibility.providerContract,
    clientRuntime,
    boundaryContext,
    historySnapshots,
    timeline,
    exportSummary,
    restartSafeStatus,
    allIssues
  );
  const priorAnalyticsExportRuns = normalizeAnalyticsExportHistory(input);
  const analyticsExportHistory = buildAnalyticsExportHistoryState(
    now,
    reportingOptions,
    reportingState,
    exportSummary,
    priorAnalyticsExportRuns,
    timeline,
    allIssues
  );
  const auditProof = {
    surfaceId,
    generatedAt: now,
    packageId: compatibility.package.id,
    packageVersion: compatibility.package.version,
    kernelId: compatibility.kernel.id,
    tenantId: boundaryContext.tenant.id,
    workspaceId: boundaryContext.workspace.id,
    actorId: boundaryContext.actor.id,
    actorRoles: boundaryContext.actor.roles,
    boundaryScopeKey: boundaryContext.audit.scopeKey,
    permissionProofKey: boundaryContext.audit.permissionProofKey,
    workspaceProofKey: boundaryContext.audit.workspaceProofKey,
    handoffProofKey: boundaryContext.audit.handoffProofKey,
    permissionBoundary: boundaryContext.permissionBoundary,
    workspaceScopePolicy: {
      mode: boundaryContext.workspace.scopePolicy.mode,
      writeRequired: boundaryContext.workspace.scopePolicy.writeRequired,
      mutationOperations: boundaryContext.workspace.scopePolicy.mutationOperations,
      deniedLanes: boundaryContext.workspace.scopePolicy.deniedLanes
    },
    requiredActorPermissions: boundaryContext.requiredPermissions,
    grantedActorPermissions: boundaryContext.actor.permissions,
    operationAuthorization: boundaryContext.operationAuthorization,
    healthState: compatibility.healthState,
    lifecycleCommand: lifecycle.command,
    nextActionState: lifecycle.nextAction.state,
    scheduleActive: lifecycle.scheduling.active,
    providerId: compatibility.providerContract.provider.id,
    providerStatus: compatibility.providerContract.provider.status,
    providerNegotiationAccepted: compatibility.providerContract.negotiation.accepted,
    providerOperationMatrix: compatibility.providerContract.negotiation.operations,
    providerDispatchPlan: compatibility.providerContract.negotiation.dispatchPlan,
    providerSyncMode: compatibility.providerContract.sync.mode,
    providerSyncCheckpointRef: compatibility.providerContract.negotiation.syncCheckpoint.checkpointRef,
    providerSyncCheckpointBasisKey: compatibility.providerContract.negotiation.syncCheckpoint.basisKey,
    providerSchemaVersion: compatibility.providerContract.provider.schemaVersion,
    providerResourceVersion: compatibility.providerContract.provider.resourceVersion,
    providerHandoffLeaseTtlMs: compatibility.providerContract.handoffPolicy.ttlMs,
    externalHandoffState: externalHandoff.state,
    syncBasisKey: syncMetadata.basisKey,
    previewState: previewAcceptance.preview.state,
    acceptanceToken: previewAcceptance.acceptance.token,
    clientRequestId: clientRuntime.request.id || null,
    clientChannel: clientRuntime.client.channel,
    clientWorkflowState: clientRuntime.client.workflowState,
    clientHandoffRequested: clientRuntime.handoff.requested,
    clientPreviewAccepted: previewAcceptance.acceptance.clientAcceptedPreview,
    boundaryIssueCodes: boundaryIssues.map((issue) => issue.code),
    restartSafeStatus: restartSafeStatus.status,
    restartAction: restartSafeStatus.restartAction,
    idempotentReplay: restartSafeStatus.idempotentReplay,
    persistedCommandReplayMode: persistedCommandContract.replay.mode,
    persistedCommandRecoveryAction: persistedCommandContract.recovery.action,
    persistedCommandRecoverySelectedRecord: persistedCommandContract.recovery.selectedRecord
      ? {
          role: persistedCommandContract.recovery.selectedRecord.role,
          id: persistedCommandContract.recovery.selectedRecord.id,
          state: persistedCommandContract.recovery.selectedRecord.state,
          recoveryMode: persistedCommandContract.recovery.selectedRecord.recoveryMode,
          lease: persistedCommandContract.recovery.selectedRecord.lease,
          unsafeReason: persistedCommandContract.recovery.selectedRecord.unsafeReason
        }
      : null,
    persistedCommandHostWrite: persistedCommandContract.hostWrite.operation,
    persistedCommandIssueCodes: persistedCommandIssues.map((issue) => issue.code),
    operationalHealthState: operationalHealth.state,
    operationalDispatchable: operationalHealth.dispatchable,
    operationalIssueCodes: operationalHealth.issues.map((issue) => issue.code),
    clientRouteDecisionState: clientRouteDecision.state,
    clientRouteSelectedCta: clientRouteDecision.selectedCta,
    clientRouteAuditRefs: clientRouteDecision.auditRefs,
    clientWorkflowHandoffState: clientWorkflowHandoff.state,
    clientWorkflowHandoffMode: clientWorkflowHandoff.mode,
    clientWorkflowStatePatch: clientWorkflowHandoff.workflowStatePatch,
    clientWorkflowHandoffProof: clientWorkflowHandoff.proof,
    degradedMode: operationalHealth.degradedMode,
    failureState: operationalHealth.failureState,
    retryWindow: operationalHealth.retryWindow,
    persistenceGeneration: persistedStateEnvelope.generation,
    persistenceCursor: persistedStateEnvelope.recoveryCursor,
    readiness: previewAcceptance.readiness,
    validationSummary: previewAcceptance.validationSummary,
    issueCodes: allIssues.map((issue) => issue.code),
    analyticsCounters: {
      sampleCount: analytics.sampleCount,
      currentErrorCount: analytics.currentErrorCount,
      currentWarningCount: analytics.currentWarningCount,
      retryableSnapshots: analytics.retryableSnapshots,
      exportRisk: analytics.exportRisk
    },
    reporting: {
      reportRef: reportingState.reportRef,
      exportReady: reportingState.exportReady,
      exportBlockedBy: reportingState.exportBlockedBy,
      retainedSnapshots: reportingState.retention.retained,
      exportFormats: reportingState.exports.map((item) => item.format)
    },
    analyticsExportHistory: {
      retainedRuns: analyticsExportHistory.retention.retained,
      currentRuns: analyticsExportHistory.retention.currentRuns,
      exportReady: analyticsExportHistory.exportReady,
      exportBlockedBy: analyticsExportHistory.exportBlockedBy,
      readyRuns: analyticsExportHistory.counters.ready,
      blockedRuns: analyticsExportHistory.counters.blocked,
      latestRunStatus: analyticsExportHistory.latestRun ? analyticsExportHistory.latestRun.status : null,
      manifestContentRefs: analyticsExportHistory.manifest.contentRefs
    }
  };

  return {
    ok: compatibility.healthState !== 'failed' && lifecycle.accepted && allIssues.every((issue) => issue.severity !== 'error'),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel package compatibility health and actionable failure contract',
    health: {
      state: compatibility.healthState,
      degraded: compatibility.degraded,
      retryable: compatibility.retryPolicy.retryable,
      nextRetryDelayMs: compatibility.retryPolicy.nextDelayMs,
      retryAfterAt: compatibility.retryPolicy.retryAfterAt,
      operationalState: operationalHealth.state,
      dispatchable: operationalHealth.dispatchable,
      nextActionState: operationalHealth.nextAction.state
    },
    package: compatibility.package,
    kernel: compatibility.kernel,
    providerContract: compatibility.providerContract,
    clientRuntime,
    boundaryContext,
    boundaryIssues,
    persistedState,
    restartSafeStatus,
    persistedCommandContract,
    persistedCommandIssues,
    operationalHealth,
    persistedStateEnvelope,
    syncMetadata,
    externalHandoff,
    previewAcceptance,
    clientRouteDecision,
    clientWorkflowHandoff,
    retryPolicy: compatibility.retryPolicy,
    lifecycle,
    issues: allIssues,
    analytics,
    reportingState,
    analyticsExportHistory,
    history: {
      snapshots: historySnapshots,
      latest: timeline[timeline.length - 1],
      retained: historySnapshots.length
    },
    timeline,
    exportSummary,
    auditProof,
    evidence: [
      ...evidence,
      auditProof,
      exportSummary,
      reportingState,
      analyticsExportHistory,
      persistedCommandContract,
      operationalHealth,
      clientRouteDecision,
      clientWorkflowHandoff
    ]
  };
}

export default describeCompatAdapterSurface;
