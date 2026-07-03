export const surfaceId = "aios_artifact-filesystem_artifact-retention_040";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "artifact-retention";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultRetentionPolicy = Object.freeze({
  archiveAfterDays: 30,
  deleteAfterDays: 90,
  maxPreviewItems: 50,
  minProofsRequired: 1,
  requireAcceptanceForDelete: true
});

const retentionActionRank = {
  retain: 0,
  archive: 1,
  delete: 2,
  review: 3
};

const retryBackoffMinutes = [5, 15, 60, 240];

function coerceDate(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function daysBetween(later, earlier) {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY));
}

function clampPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clampNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function coerceToken(value, fallback) {
  const token = typeof value === 'string' ? value.trim() : '';
  return token || fallback;
}

function uniqueTokens(values = []) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))].sort();
}

function normalizeStringList(values = []) {
  return Array.isArray(values) ? uniqueTokens(values) : [];
}

function normalizeRoleList(values = []) {
  return normalizeStringList(values).map(value => value.toLowerCase());
}

function normalizePermissionName(value) {
  const permission = coerceToken(value, '').toLowerCase();
  return permission.startsWith('artifact:retention:')
    ? permission
    : permission
      ? `artifact:retention:${permission}`
      : '';
}

function normalizeCapabilityList(values = [], fallback = []) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return normalizeStringList(source).map(value => value.toLowerCase().replace(/^artifact:retention:/, ''));
}

function normalizeHistorySnapshots(values = [], nowDate) {
  return Array.isArray(values)
    ? values
        .map((entry, index) => {
          const observedAt = entry?.observedAt || entry?.generatedAt || entry?.createdAt || entry?.at;
          const counters = entry?.counters || entry?.summary || {};

          return {
            snapshotId: coerceToken(
              entry?.snapshotId || entry?.id,
              buildStableToken(['snapshot', index, observedAt || nowDate.toISOString()])
            ),
            observedAt: coerceDate(observedAt, nowDate).toISOString(),
            status: coerceToken(entry?.status || entry?.readiness, 'unknown'),
            totalItems: clampNonNegativeInteger(counters.totalItems || entry?.totalItems),
            archiveItems: clampNonNegativeInteger(counters.archiveItems || counters.archive || entry?.archiveItems),
            deleteItems: clampNonNegativeInteger(counters.deleteItems || counters.delete || entry?.deleteItems),
            reviewItems: clampNonNegativeInteger(counters.reviewItems || counters.review || entry?.reviewItems),
            retainItems: clampNonNegativeInteger(counters.retainItems || counters.retain || entry?.retainItems),
            destructiveItems: clampNonNegativeInteger(counters.destructiveItems || entry?.destructiveItems),
            pendingItems: clampNonNegativeInteger(counters.pendingItems || entry?.pendingItems),
            failedItems: clampNonNegativeInteger(counters.failedItems || entry?.failedItems),
            totalBytes: clampNonNegativeInteger(counters.totalBytes || entry?.totalBytes),
            destructiveBytes: clampNonNegativeInteger(counters.destructiveBytes || entry?.destructiveBytes)
          };
        })
        .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
        .slice(-20)
    : [];
}

function normalizeJournalAction(value, fallback = 'unknown') {
  const action = coerceToken(value, fallback).toLowerCase();
  return ['archive', 'delete', 'dry_run', 'lifecycle', 'unknown'].includes(action)
    ? action
    : fallback;
}

function normalizeCommandStatus(value, fallback = 'unknown') {
  const status = coerceToken(value, fallback).toLowerCase();
  const aliases = {
    done: 'succeeded',
    complete: 'succeeded',
    completed: 'succeeded',
    success: 'succeeded',
    errored: 'failed',
    error: 'failed',
    timed_out: 'timeout'
  };

  return aliases[status] || status;
}

function commandStatusSemantics(status) {
  const normalized = normalizeCommandStatus(status);
  const succeeded = ['succeeded', 'acknowledged', 'noop', 'skipped'].includes(normalized);
  const failed = ['failed', 'timeout', 'cancelled', 'rejected'].includes(normalized);

  return {
    terminal: succeeded || failed,
    succeeded,
    failed,
    replayable: ['queued', 'dispatching', 'running', 'retry_ready', 'timeout', 'failed'].includes(normalized)
  };
}

function buildStableToken(parts = []) {
  return parts
    .flatMap(part => Array.isArray(part) ? part : [part])
    .map(part => String(part ?? '').trim())
    .filter(Boolean)
    .join(':');
}

function normalizePolicy(policy = {}) {
  const archiveAfterDays = clampPositiveInteger(
    policy.archiveAfterDays,
    defaultRetentionPolicy.archiveAfterDays
  );
  const deleteAfterDays = Math.max(
    archiveAfterDays,
    clampPositiveInteger(policy.deleteAfterDays, defaultRetentionPolicy.deleteAfterDays)
  );

  return {
    archiveAfterDays,
    deleteAfterDays,
    maxPreviewItems: clampPositiveInteger(policy.maxPreviewItems, defaultRetentionPolicy.maxPreviewItems),
    minProofsRequired: clampPositiveInteger(policy.minProofsRequired, defaultRetentionPolicy.minProofsRequired),
    requireAcceptanceForDelete: policy.requireAcceptanceForDelete !== false
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeLifecycleMode(value, fallback = 'automatic') {
  const mode = coerceToken(value, fallback).toLowerCase();
  return ['automatic', 'manual', 'disabled'].includes(mode) ? mode : fallback;
}

function normalizeLifecycleSettingsAction(value, fallback = 'noop') {
  const action = coerceToken(value, fallback).toLowerCase().replaceAll('-', '_');
  const aliases = {
    turn_on: 'enable',
    start: 'enable',
    turn_off: 'disable',
    stop: 'disable',
    unpause: 'resume',
    update_schedule: 'reschedule',
    schedule: 'reschedule',
    configure: 'update',
    settings: 'update'
  };
  const normalized = aliases[action] || action;
  return ['noop', 'enable', 'disable', 'pause', 'resume', 'reschedule', 'update'].includes(normalized)
    ? normalized
    : fallback;
}

function normalizeLifecycleControls(input, nowDate) {
  const raw = input.lifecycleSettings
    || input.lifecycleControls
    || input.retentionLifecycle
    || input.settings?.retentionLifecycle
    || {};
  const scheduler = raw.scheduler || raw.schedule || {};
  const execution = raw.execution || raw.executionControls || {};
  const mode = normalizeLifecycleMode(raw.mode || raw.lifecycleMode);
  const enabled = mode !== 'disabled' && normalizeBoolean(raw.enabled, true);
  const schedulerEnabled = enabled && normalizeBoolean(scheduler.enabled ?? raw.scheduleEnabled, mode === 'automatic');
  const intervalMinutes = Math.max(5, clampPositiveInteger(
    scheduler.intervalMinutes || scheduler.everyMinutes || raw.intervalMinutes,
    24 * 60
  ));
  const nextRunAtSource = scheduler.nextRunAt || raw.nextRunAt || raw.scheduledAt;
  const nextRunAtDate = nextRunAtSource
    ? coerceDate(nextRunAtSource, nowDate)
    : minutesFrom(nowDate.toISOString(), intervalMinutes);
  const pauseUntilSource = scheduler.pauseUntil || raw.pauseUntil;
  const pauseUntilDate = pauseUntilSource ? coerceDate(pauseUntilSource, nowDate) : null;
  const paused = Boolean(pauseUntilDate && pauseUntilDate.getTime() > nowDate.getTime());
  const due = schedulerEnabled
    && !paused
    && nextRunAtDate.getTime() <= nowDate.getTime();
  const destructiveExecutionEnabled = normalizeBoolean(
    execution.allowDelete ?? execution.destructiveExecutionEnabled ?? raw.allowDestructiveExecution,
    true
  );
  const archiveExecutionEnabled = normalizeBoolean(execution.allowArchive ?? raw.allowArchiveExecution, true);
  const dryRun = normalizeBoolean(execution.dryRun ?? raw.dryRun, false);
  const maxArchiveItemsPerRun = clampNonNegativeInteger(
    execution.maxArchiveItemsPerRun || raw.maxArchiveItemsPerRun,
    0
  );
  const maxDeleteItemsPerRun = clampNonNegativeInteger(
    execution.maxDeleteItemsPerRun || raw.maxDeleteItemsPerRun,
    0
  );
  const warnings = [];

  if (!enabled && (scheduler.enabled === true || raw.scheduleEnabled === true)) {
    warnings.push({
      code: 'schedule_ignored_while_disabled',
      message: 'Retention scheduler was requested but lifecycle controls are disabled.'
    });
  }

  if (schedulerEnabled && mode === 'manual') {
    warnings.push({
      code: 'manual_mode_schedule_ignored',
      message: 'Manual lifecycle mode does not dispatch scheduled retention jobs automatically.'
    });
  }

  if (raw.intervalMinutes && Number(raw.intervalMinutes) < 5) {
    warnings.push({
      code: 'schedule_interval_clamped',
      message: 'Retention schedule interval was raised to the minimum supported value of 5 minutes.'
    });
  }

  return {
    contract: 'artifact-retention.lifecycle-controls.v1',
    enabled,
    mode: enabled ? mode : 'disabled',
    dryRun,
    scheduler: {
      enabled: schedulerEnabled && mode === 'automatic',
      due,
      paused,
      pauseUntil: pauseUntilDate ? pauseUntilDate.toISOString() : null,
      nextRunAt: nextRunAtDate.toISOString(),
      intervalMinutes,
      timezone: coerceToken(scheduler.timezone || raw.timezone, 'UTC'),
      window: {
        start: scheduler.windowStart || raw.windowStart || null,
        end: scheduler.windowEnd || raw.windowEnd || null
      }
    },
    execution: {
      archiveEnabled: archiveExecutionEnabled,
      deleteEnabled: destructiveExecutionEnabled,
      maxArchiveItemsPerRun,
      maxDeleteItemsPerRun
    },
    warnings
  };
}

function buildLifecycleSettingsControlState({
  input,
  lifecycleControls,
  summary,
  requestState,
  nowDate
}) {
  const raw = input.lifecycleCommand
    || input.lifecycleSettingsCommand
    || input.retentionLifecycleCommand
    || input.settings?.retentionLifecycleCommand
    || input.lifecycleControls?.command
    || input.lifecycleSettings?.command
    || {};
  const hasCommand = raw && typeof raw === 'object' && Object.keys(raw).length > 0;
  const scheduler = raw.scheduler || raw.schedule || {};
  const execution = raw.execution || raw.executionControls || {};
  const action = normalizeLifecycleSettingsAction(raw.action || raw.command || raw.type, hasCommand ? 'update' : 'noop');
  const requestedMode = action === 'enable'
    ? normalizeLifecycleMode(raw.mode || raw.lifecycleMode, lifecycleControls.mode === 'disabled' ? 'automatic' : lifecycleControls.mode)
    : action === 'disable'
      ? 'disabled'
      : normalizeLifecycleMode(raw.mode || raw.lifecycleMode, lifecycleControls.mode);
  const requestedEnabled = action === 'enable'
    ? true
    : action === 'disable'
      ? false
      : normalizeBoolean(raw.enabled, lifecycleControls.enabled);
  const requestedScheduleEnabled = normalizeBoolean(
    scheduler.enabled ?? raw.scheduleEnabled,
    requestedEnabled && requestedMode === 'automatic' && lifecycleControls.scheduler.enabled
  );
  const intervalSource = scheduler.intervalMinutes
    || scheduler.everyMinutes
    || raw.intervalMinutes
    || lifecycleControls.scheduler.intervalMinutes;
  const intervalMinutes = Math.max(5, clampPositiveInteger(intervalSource, lifecycleControls.scheduler.intervalMinutes));
  const nextRunAtSource = scheduler.nextRunAt || raw.nextRunAt || raw.scheduledAt;
  const nextRunAt = nextRunAtSource
    ? coerceDate(nextRunAtSource, nowDate).toISOString()
    : action === 'reschedule'
      ? minutesFrom(nowDate.toISOString(), intervalMinutes).toISOString()
      : lifecycleControls.scheduler.nextRunAt;
  const pauseUntilSource = scheduler.pauseUntil || raw.pauseUntil;
  const pauseUntil = action === 'resume'
    ? null
    : pauseUntilSource
      ? coerceDate(pauseUntilSource, nowDate).toISOString()
      : action === 'pause'
        ? minutesFrom(nowDate.toISOString(), intervalMinutes).toISOString()
        : lifecycleControls.scheduler.pauseUntil;
  const archiveEnabled = normalizeBoolean(
    execution.allowArchive ?? execution.archiveEnabled ?? raw.allowArchiveExecution,
    lifecycleControls.execution.archiveEnabled
  );
  const deleteEnabled = normalizeBoolean(
    execution.allowDelete ?? execution.deleteEnabled ?? raw.allowDestructiveExecution,
    lifecycleControls.execution.deleteEnabled
  );
  const dryRun = normalizeBoolean(execution.dryRun ?? raw.dryRun, lifecycleControls.dryRun);
  const validationErrors = [];
  const warnings = [];

  if (action === 'pause' && pauseUntil && new Date(pauseUntil).getTime() <= nowDate.getTime()) {
    validationErrors.push({
      code: 'pause_until_must_be_future',
      message: 'Retention lifecycle pauseUntil must be in the future.'
    });
  }

  if (action === 'reschedule' && requestedScheduleEnabled && new Date(nextRunAt).getTime() < nowDate.getTime()) {
    validationErrors.push({
      code: 'next_run_at_must_not_be_past',
      message: 'Retention lifecycle nextRunAt must not be earlier than the current evaluation time.'
    });
  }

  if (Number(intervalSource) > 0 && Number(intervalSource) < 5) {
    warnings.push({
      code: 'settings_interval_clamped',
      message: 'Requested lifecycle schedule interval was raised to the minimum supported value of 5 minutes.'
    });
  }

  if (!requestedEnabled && (summary.byAction.archive > 0 || summary.byAction.delete > 0)) {
    warnings.push({
      code: 'disabling_with_pending_retention_work',
      archiveItems: summary.byAction.archive,
      deleteItems: summary.byAction.delete,
      message: 'Lifecycle disable command leaves current retention candidates for manual follow-up.'
    });
  }

  if (summary.byAction.archive > 0 && !archiveEnabled) {
    warnings.push({
      code: 'archive_candidates_blocked_by_settings',
      archiveItems: summary.byAction.archive,
      message: 'Archive candidates exist while archive execution is disabled.'
    });
  }

  if (summary.byAction.delete > 0 && !deleteEnabled) {
    warnings.push({
      code: 'delete_candidates_blocked_by_settings',
      deleteItems: summary.byAction.delete,
      message: 'Delete candidates exist while destructive execution is disabled.'
    });
  }

  const proposedSettings = {
    contract: 'artifact-retention.lifecycle-settings-patch.v1',
    enabled: requestedEnabled,
    mode: requestedEnabled ? requestedMode : 'disabled',
    dryRun,
    scheduler: {
      enabled: requestedEnabled && requestedMode === 'automatic' && requestedScheduleEnabled,
      intervalMinutes,
      nextRunAt,
      pauseUntil,
      timezone: coerceToken(scheduler.timezone || raw.timezone, lifecycleControls.scheduler.timezone),
      window: {
        start: scheduler.windowStart || raw.windowStart || lifecycleControls.scheduler.window.start,
        end: scheduler.windowEnd || raw.windowEnd || lifecycleControls.scheduler.window.end
      }
    },
    execution: {
      archiveEnabled,
      deleteEnabled,
      maxArchiveItemsPerRun: clampNonNegativeInteger(
        execution.maxArchiveItemsPerRun || raw.maxArchiveItemsPerRun,
        lifecycleControls.execution.maxArchiveItemsPerRun
      ),
      maxDeleteItemsPerRun: clampNonNegativeInteger(
        execution.maxDeleteItemsPerRun || raw.maxDeleteItemsPerRun,
        lifecycleControls.execution.maxDeleteItemsPerRun
      )
    }
  };
  const commandId = buildStableToken([
    requestState.workflowId,
    'lifecycle-settings',
    action,
    proposedSettings.mode,
    proposedSettings.scheduler.nextRunAt
  ]);
  const applyAllowed = validationErrors.length === 0 && action !== 'noop';

  return {
    contract: 'artifact-retention.lifecycle-settings-controls.v1',
    command: {
      commandId,
      action,
      requestedBy: coerceToken(raw.requestedBy || input.requestedBy, requestState.clientId),
      requestedAt: raw.requestedAt ? coerceDate(raw.requestedAt, nowDate).toISOString() : nowDate.toISOString(),
      reason: coerceToken(raw.reason, action === 'noop' ? 'no_settings_command' : 'operator_requested_lifecycle_change'),
      idempotencyKey: buildStableToken([requestState.workflowId, 'settings', action, commandId])
    },
    currentSettings: lifecycleControls,
    proposedSettings,
    applyAllowed,
    status: action === 'noop'
      ? 'idle'
      : applyAllowed
        ? 'ready_to_apply'
        : 'blocked',
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
      warnings
    },
    nextAction: {
      id: action === 'noop'
        ? 'observe-retention-lifecycle-settings'
        : applyAllowed
          ? 'apply-retention-lifecycle-settings'
          : 'repair-retention-lifecycle-settings',
      status: action === 'noop'
        ? 'complete'
        : applyAllowed
          ? 'ready'
          : 'blocked',
      reason: validationErrors[0]?.code || warnings[0]?.code || action,
      commandId
    }
  };
}

const supportedClientRuntimeContracts = Object.freeze([
  'artifact-retention.preview.v1',
  'artifact-retention.workflow-handoff.v1',
  'artifact-retention.client-preview-acceptance.v1',
  'artifact-retention.dispatch-intent.v1',
  'artifact-retention.audit-proof.v1'
]);

const providerOperationCapabilities = Object.freeze([
  'archive',
  'delete',
  'proof',
  'sync',
  'external-handoff'
]);

const providerPayloadContractsByCapability = Object.freeze({
  archive: 'artifact-retention.provider-archive-command.v1',
  delete: 'artifact-retention.provider-delete-command.v1',
  proof: 'artifact-retention.provider-proof-request.v1',
  sync: 'artifact-retention.provider-sync-checkpoint.v1',
  'external-handoff': 'artifact-retention.provider-handoff-envelope.v1'
});

function normalizeRuntimeContractList(values = []) {
  const contracts = normalizeStringList(values);
  return contracts.length > 0 ? contracts : [...supportedClientRuntimeContracts];
}

function normalizeProviderPayloadContractList(values = []) {
  const contracts = normalizeStringList(values);
  return contracts.length > 0
    ? contracts
    : uniqueTokens([
        ...Object.values(providerPayloadContractsByCapability),
        'artifact-retention.dispatch-intent.v1'
      ]);
}

function normalizeHandoffMode(value, fallback = 'inline') {
  const mode = coerceToken(value, fallback).toLowerCase();
  return ['inline', 'external', 'return', 'none'].includes(mode) ? mode : fallback;
}

function normalizeClientRuntimeAdoption({
  input,
  request,
  client,
  runtime,
  workflow,
  requestId,
  clientId,
  sessionId
}) {
  const raw = input.clientRuntime
    || client.runtime
    || runtime.clientRuntime
    || runtime.client
    || workflow.clientRuntime
    || {};
  const capabilities = normalizeCapabilityList(
    raw.capabilities || client.capabilities || input.clientCapabilities,
    ['preview', 'acceptance', 'dispatch-intent', 'handoff', 'audit-proof']
  );
  const acceptedContracts = normalizeRuntimeContractList(
    raw.acceptedContracts || raw.contracts || client.acceptedContracts || input.acceptedContracts
  );
  const handoffMode = normalizeHandoffMode(
    raw.handoffMode || workflow.handoffMode || client.handoffMode,
    raw.externalHandoff === true ? 'external' : 'inline'
  );
  const canRenderPreview = capabilities.includes('preview')
    || acceptedContracts.includes('artifact-retention.preview.v1');
  const canAcceptDestructive = normalizeBoolean(raw.acceptanceEnabled, capabilities.includes('acceptance'))
    || capabilities.includes('destructive-acceptance');
  const canDispatch = capabilities.includes('dispatch')
    || capabilities.includes('dispatch-intent')
    || acceptedContracts.includes('artifact-retention.dispatch-intent.v1');
  const canReceiveProof = capabilities.includes('audit-proof')
    || capabilities.includes('proof')
    || acceptedContracts.includes('artifact-retention.audit-proof.v1');
  const prefersHostedKernel = normalizeBoolean(
    raw.preferHostedKernel ?? raw.hostedKernelPreferred ?? runtime.hostedKernelPreferred,
    true
  );
  const returnTo = raw.returnTo || workflow.returnTo || client.returnTo || request.returnTo || null;

  return {
    contract: 'artifact-retention.client-runtime-adoption.v1',
    requestId,
    clientId,
    sessionId,
    surface: coerceToken(raw.surface || client.surface || request.surface, surfaceId),
    channel: coerceToken(raw.channel || client.channel || request.channel, 'hosted-kernel'),
    handoffMode,
    returnTo,
    capabilities,
    acceptedContracts,
    featureGates: {
      preview: canRenderPreview,
      destructiveAcceptance: canAcceptDestructive,
      dispatchIntent: canDispatch,
      auditProof: canReceiveProof,
      hostedKernelPreferred: prefersHostedKernel
    },
    routeHints: {
      requestRoute: input.route || request.route || runtime.route || null,
      resumeRoute: raw.resumeRoute || workflow.resumeRoute || returnTo,
      proofRoute: raw.proofRoute || workflow.proofRoute || returnTo,
      dispatchRoute: raw.dispatchRoute || workflow.dispatchRoute || returnTo
    }
  };
}

function normalizeArtifact(rawArtifact = {}, index, nowDate) {
  const id = String(rawArtifact.id || rawArtifact.artifactId || `artifact-${index + 1}`);
  const createdAt = coerceDate(rawArtifact.createdAt || rawArtifact.created_at, nowDate);
  const lastAccessedAt = coerceDate(
    rawArtifact.lastAccessedAt || rawArtifact.last_accessed_at || rawArtifact.updatedAt,
    createdAt
  );
  const expiresAt = rawArtifact.expiresAt || rawArtifact.expires_at
    ? coerceDate(rawArtifact.expiresAt || rawArtifact.expires_at, nowDate)
    : null;
  const sizeBytes = Math.max(0, Number(rawArtifact.sizeBytes || rawArtifact.bytes || 0));

  return {
    id,
    path: String(rawArtifact.path || rawArtifact.uri || rawArtifact.name || id),
    tenantId: rawArtifact.tenantId || rawArtifact.tenant_id || null,
    workspaceId: rawArtifact.workspaceId || rawArtifact.workspace_id || null,
    classification: String(rawArtifact.classification || rawArtifact.retentionClass || 'standard'),
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    createdAt: createdAt.toISOString(),
    lastAccessedAt: lastAccessedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    pinned: Boolean(rawArtifact.pinned),
    legalHold: Boolean(rawArtifact.legalHold || rawArtifact.legal_hold),
    proofRefs: Array.isArray(rawArtifact.proofRefs) ? rawArtifact.proofRefs.map(String) : [],
    ageDays: daysBetween(nowDate, createdAt),
    idleDays: daysBetween(nowDate, lastAccessedAt)
  };
}

function scopeArtifact(artifact, boundaryContext) {
  const tenantId = coerceToken(artifact.tenantId, boundaryContext.tenantId);
  const workspaceId = coerceToken(artifact.workspaceId, boundaryContext.workspaceId);
  const tenantMatch = tenantId === boundaryContext.tenantId;
  const requestedWorkspaceMatch = workspaceId === boundaryContext.workspaceId;
  const workspaceAllowed = requestedWorkspaceMatch
    || boundaryContext.allowedWorkspaceIds.includes('*')
    || boundaryContext.allowedWorkspaceIds.includes(workspaceId);
  const grant = boundaryContext.workspaceGrants.find(entry => (
    entry.tenantId === tenantId
    && (entry.workspaceId === '*' || entry.workspaceId === workspaceId)
  ));

  return {
    ...artifact,
    tenantId,
    workspaceId,
    scope: {
      tenantId,
      workspaceId,
      tenantMatch,
      workspaceMatch: requestedWorkspaceMatch,
      requestedWorkspaceMatch,
      workspaceAllowed,
      delegatedWorkspace: tenantMatch && workspaceAllowed && !requestedWorkspaceMatch,
      grantId: grant?.grantId || null,
      grantPermissions: grant?.permissions || [],
      inBoundary: tenantMatch && workspaceAllowed
    }
  };
}

function normalizeRequestState(input, nowDate) {
  const request = input.request || {};
  const client = input.client || input.clientState || {};
  const runtime = input.runtime || {};
  const workflow = input.workflow || input.handoff || {};
  const fallbackRequestId = `retention-${nowDate.toISOString()}`;
  const requestId = coerceToken(
    input.requestId || request.id || request.requestId || runtime.requestId,
    fallbackRequestId
  );
  const clientId = coerceToken(
    input.clientId || client.id || client.clientId || request.clientId,
    'anonymous-client'
  );
  const sessionId = coerceToken(
    input.sessionId || client.sessionId || request.sessionId || runtime.sessionId,
    `${clientId}:session`
  );
  const workflowId = coerceToken(
    input.workflowId || workflow.id || workflow.workflowId,
    `${requestId}:artifact-retention`
  );
  const clientRuntime = normalizeClientRuntimeAdoption({
    input,
    request,
    client,
    runtime,
    workflow,
    requestId,
    clientId,
    sessionId
  });

  return {
    requestId,
    clientId,
    sessionId,
    workflowId,
    requestKind: coerceToken(request.kind || input.requestKind, 'artifact_retention_preview'),
    source: coerceToken(request.source || client.surface || runtime.source, surfaceId),
    returnTo: clientRuntime.returnTo,
    clientRuntime,
    trace: {
      route: input.route || request.route || runtime.route || null,
      correlationId: input.correlationId || request.correlationId || runtime.correlationId || requestId,
      parentSpanId: input.parentSpanId || request.parentSpanId || runtime.parentSpanId || null
    }
  };
}

function normalizeBoundaryContext(input, requestState) {
  const request = input.request || {};
  const client = input.client || input.clientState || {};
  const runtime = input.runtime || {};
  const actor = input.actor || input.principal || input.user || {};
  const actorRole = actor.role || input.role;
  const tenantId = coerceToken(
    input.tenantId || request.tenantId || client.tenantId || runtime.tenantId,
    'default-tenant'
  );
  const workspaceId = coerceToken(
    input.workspaceId || request.workspaceId || client.workspaceId || runtime.workspaceId,
    'default-workspace'
  );
  const actorId = coerceToken(
    input.actorId || actor.id || actor.actorId || actor.userId || input.requestedBy,
    'system-retention-worker'
  );
  const roles = normalizeRoleList(
    actor.roles || input.roles || (actorRole ? [actorRole] : [])
  );
  const permissions = normalizeStringList(actor.permissions || input.permissions);
  const effectiveRoles = roles.length > 0 ? roles : ['system'];
  const impliedPermissions = new Set(permissions);

  if (effectiveRoles.some(role => ['system', 'admin', 'owner', 'maintainer'].includes(role))) {
    impliedPermissions.add('artifact:retention:archive');
    impliedPermissions.add('artifact:retention:delete');
  }

  if (effectiveRoles.includes('editor')) {
    impliedPermissions.add('artifact:retention:archive');
  }

  const workspaceAccessSource = input.workspaceAccess
    || input.workspaceGrants
    || input.access?.workspaceGrants
    || actor.workspaceGrants
    || actor.workspaceAccess
    || [];
  const workspaceAccessEntries = Array.isArray(workspaceAccessSource)
    ? workspaceAccessSource
    : workspaceAccessSource && typeof workspaceAccessSource === 'object'
      ? Object.values(workspaceAccessSource)
      : [];
  const globalPermissions = uniqueTokens([...impliedPermissions].map(normalizePermissionName));
  const roleCanSpanTenant = effectiveRoles.some(role => ['system', 'admin', 'owner'].includes(role));
  const workspaceGrants = workspaceAccessEntries
    .flatMap((entry, index) => {
      const grantTenantId = coerceToken(entry?.tenantId || entry?.tenant_id, tenantId);
      const workspaceIds = normalizeStringList(
        entry?.workspaceIds || entry?.workspace_ids || entry?.workspaces || (
          entry?.workspaceId || entry?.workspace_id ? [entry.workspaceId || entry.workspace_id] : []
        )
      );
      const normalizedWorkspaceIds = workspaceIds.length > 0 ? workspaceIds : [workspaceId];
      const grantPermissions = uniqueTokens([
        ...normalizeStringList(entry?.permissions || entry?.scopes).map(normalizePermissionName),
        ...globalPermissions.filter(permission => entry?.inheritActorPermissions === true)
      ]);
      const grantRoles = normalizeRoleList(
        entry?.roles || (entry?.role ? [entry.role] : [])
      );
      const effectiveGrantPermissions = new Set(grantPermissions);

      if (grantRoles.some(role => ['system', 'admin', 'owner', 'maintainer'].includes(role))) {
        effectiveGrantPermissions.add('artifact:retention:archive');
        effectiveGrantPermissions.add('artifact:retention:delete');
      }

      if (grantRoles.includes('editor')) {
        effectiveGrantPermissions.add('artifact:retention:archive');
      }

      return normalizedWorkspaceIds.map(grantWorkspaceId => ({
        contract: 'artifact-retention.workspace-grant.v1',
        grantId: coerceToken(
          entry?.grantId || entry?.id,
          buildStableToken(['grant', grantTenantId, grantWorkspaceId, index])
        ),
        tenantId: grantTenantId,
        workspaceId: coerceToken(grantWorkspaceId, workspaceId),
        permissions: uniqueTokens([...effectiveGrantPermissions]),
        roles: grantRoles,
        source: coerceToken(entry?.source || entry?.issuer, 'request')
      }));
    })
    .filter(entry => (
      entry.tenantId === tenantId
      && (entry.workspaceId !== '*' || roleCanSpanTenant)
      && entry.permissions.length > 0
    ));
  const allowedWorkspaceIds = uniqueTokens([
    workspaceId,
    ...workspaceGrants.map(entry => entry.workspaceId)
  ]);
  const tenantWideRequested = workspaceAccessEntries.some(entry => {
    const workspaceIds = normalizeStringList(
      entry?.workspaceIds || entry?.workspace_ids || entry?.workspaces || (
        entry?.workspaceId || entry?.workspace_id ? [entry.workspaceId || entry.workspace_id] : []
      )
    );
    return workspaceIds.includes('*');
  });

  return {
    contract: 'artifact-retention.boundary-context.v1',
    tenantId,
    workspaceId,
    actorId,
    roles: effectiveRoles,
    permissions: globalPermissions,
    workspaceGrants,
    allowedWorkspaceIds,
    isolation: {
      contract: 'artifact-retention.tenant-isolation.v1',
      tenantWideAccess: allowedWorkspaceIds.includes('*'),
      tenantWideRequestDenied: tenantWideRequested && !allowedWorkspaceIds.includes('*'),
      delegatedWorkspaceCount: allowedWorkspaceIds.filter(id => id !== workspaceId && id !== '*').length,
      enforceTenantMatch: true,
      enforceWorkspaceGrant: true
    },
    scopeToken: buildStableToken([surfaceId, tenantId, workspaceId, requestState.workflowId])
  };
}

function normalizePersistedRetentionState(input, requestState, nowDate) {
  const persisted = input.persistedState || input.state || input.retentionState || {};
  const persistedRequestId = coerceToken(
    persisted.requestId || persisted.request_id,
    requestState.requestId
  );
  const persistedWorkflowId = coerceToken(
    persisted.workflowId || persisted.workflow_id,
    requestState.workflowId
  );
  const archiveCompletedIds = normalizeStringList(
    persisted.archiveCompletedArtifactIds || persisted.archivedArtifactIds || persisted.archived
  );
  const deleteCompletedIds = normalizeStringList(
    persisted.deleteCompletedArtifactIds || persisted.deletedArtifactIds || persisted.deleted
  );
  const failedArtifactIds = normalizeStringList(
    persisted.failedArtifactIds || persisted.failures
  );
  const failureEvents = Array.isArray(persisted.failureEvents || persisted.errorEvents)
    ? (persisted.failureEvents || persisted.errorEvents)
        .map((entry, index) => {
          const artifactId = coerceToken(
            entry?.artifactId || entry?.artifact_id || entry?.id,
            ''
          );
          const retryable = entry?.retryable !== false && entry?.permanent !== true;
          const failedAt = entry?.failedAt || entry?.observedAt || entry?.createdAt;

          return {
            eventId: coerceToken(entry?.eventId || entry?.id, artifactId
              ? buildStableToken([artifactId, index])
              : ''),
            artifactId,
            action: coerceToken(entry?.action || entry?.operation, 'unknown'),
            code: coerceToken(entry?.code || entry?.errorCode, retryable ? 'retention_action_failed' : 'retention_action_permanent_failure'),
            message: coerceToken(entry?.message || entry?.reason, 'Retention action failed.'),
            retryable,
            attempts: clampNonNegativeInteger(entry?.attempts || entry?.retryCount, 1),
            failedAt: failedAt ? coerceDate(failedAt, nowDate).toISOString() : nowDate.toISOString()
          };
        })
        .filter(entry => entry.artifactId)
    : failedArtifactIds.map((artifactId, index) => ({
        eventId: buildStableToken([artifactId, 'legacy-failure', index]),
        artifactId,
        action: 'unknown',
        code: 'retention_action_failed',
        message: 'Artifact was marked failed by persisted retention state.',
        retryable: true,
        attempts: 1,
        failedAt: nowDate.toISOString()
      }));
  const skippedArtifactIds = normalizeStringList(
    persisted.skippedArtifactIds || persisted.skipped
  );
  const compatibleWithRequest = persistedRequestId === requestState.requestId
    && persistedWorkflowId === requestState.workflowId;
  const idempotencyScope = coerceToken(
    persisted.idempotencyScope
      || persisted.idempotency_key
      || persisted.commandEnvelope?.idempotencyScope
      || persisted.commandEnvelope?.idempotency_key,
    buildStableToken([surfaceId, persistedWorkflowId, requestState.trace.correlationId])
  );
  const commandJournalSource = persisted.commandJournal
    || persisted.commandLedger
    || persisted.commands
    || persisted.commandEnvelope?.journal
    || [];
  const commandJournal = Array.isArray(commandJournalSource)
    ? commandJournalSource
        .map((entry, index) => {
          const action = normalizeJournalAction(
            entry?.action,
            entry?.type === 'artifact_retention.delete'
              ? 'delete'
              : entry?.type === 'artifact_retention.archive'
                ? 'archive'
                : entry?.type === 'artifact_retention.dry_run'
                  ? 'dry_run'
                  : 'unknown'
          );
          const status = normalizeCommandStatus(entry?.status, 'unknown');
          const semantics = commandStatusSemantics(status);
          const artifactIds = normalizeStringList(
            entry?.artifactIds || entry?.artifact_ids || entry?.artifacts
          );
          const commandId = coerceToken(
            entry?.commandId || entry?.id,
            buildStableToken([idempotencyScope, action, artifactIds, index])
          );

          return {
            contract: 'artifact-retention.persisted-command-journal-entry.v1',
            commandId,
            idempotencyKey: coerceToken(
              entry?.idempotencyKey || entry?.idempotency_key,
              buildStableToken([idempotencyScope, commandId])
            ),
            action,
            type: coerceToken(entry?.type, action === 'unknown' ? 'unknown' : `artifact_retention.${action}`),
            status,
            artifactIds,
            terminal: semantics.terminal,
            succeeded: semantics.succeeded,
            failed: semantics.failed,
            replayable: semantics.replayable,
            dispatchedAt: entry?.dispatchedAt || entry?.startedAt
              ? coerceDate(entry.dispatchedAt || entry.startedAt, nowDate).toISOString()
              : null,
            completedAt: entry?.completedAt || entry?.acknowledgedAt
              ? coerceDate(entry.completedAt || entry.acknowledgedAt, nowDate).toISOString()
              : null
          };
        })
        .filter(entry => entry.commandId)
    : [];
  const status = coerceToken(persisted.status, 'not_started');
  const historySnapshots = normalizeHistorySnapshots(
    persisted.historySnapshots || persisted.analyticsHistory || persisted.snapshots,
    nowDate
  );
  const normalizedFailedArtifactIds = uniqueTokens([
    ...failedArtifactIds,
    ...failureEvents.map(event => event.artifactId)
  ]);

  return {
    contract: 'artifact-retention.persisted-state.v1',
    requestId: persistedRequestId,
    workflowId: persistedWorkflowId,
    idempotencyScope,
    status,
    statusObservedAt: persisted.statusObservedAt
      ? coerceDate(persisted.statusObservedAt, nowDate).toISOString()
      : nowDate.toISOString(),
    lastCheckpointAt: persisted.lastCheckpointAt
      ? coerceDate(persisted.lastCheckpointAt, nowDate).toISOString()
      : null,
    leaseOwner: persisted.leaseOwner || persisted.owner || null,
    leaseExpiresAt: persisted.leaseExpiresAt
      ? coerceDate(persisted.leaseExpiresAt, nowDate).toISOString()
      : null,
    completed: {
      archiveArtifactIds: archiveCompletedIds,
      deleteArtifactIds: deleteCompletedIds
    },
    failedArtifactIds: normalizedFailedArtifactIds,
    failureEvents,
    skippedArtifactIds,
    commandJournal,
    historySnapshots,
    compatibleWithRequest
  };
}

function decideRetentionAction(artifact, policy, nowDate) {
  if (artifact.legalHold) {
    return { action: 'retain', reason: 'legal_hold', destructive: false };
  }

  if (artifact.pinned) {
    return { action: 'retain', reason: 'pinned', destructive: false };
  }

  if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() <= nowDate.getTime()) {
    return { action: 'delete', reason: 'expired', destructive: true };
  }

  if (artifact.idleDays >= policy.deleteAfterDays) {
    return { action: 'delete', reason: 'idle_delete_threshold', destructive: true };
  }

  if (artifact.idleDays >= policy.archiveAfterDays) {
    return { action: 'archive', reason: 'idle_archive_threshold', destructive: false };
  }

  return { action: 'retain', reason: 'within_retention_window', destructive: false };
}

function hasPermission(boundaryContext, permission, workspaceId = boundaryContext.workspaceId) {
  const normalizedPermission = normalizePermissionName(permission);
  if (boundaryContext.permissions.includes(normalizedPermission)) {
    return true;
  }

  return boundaryContext.workspaceGrants.some(grant => (
    grant.tenantId === boundaryContext.tenantId
    && (grant.workspaceId === workspaceId || grant.workspaceId === '*')
    && grant.permissions.includes(normalizedPermission)
  ));
}

function enforceBoundaryAndPermissions(item, boundaryContext) {
  if (!item.artifact.scope.inBoundary) {
    return {
      ...item,
      action: 'review',
      reason: item.artifact.scope.tenantMatch ? 'workspace_boundary_mismatch' : 'tenant_boundary_mismatch',
      destructive: false,
      blocked: true,
      blockedReason: 'artifact_outside_request_boundary',
      originalDecision: {
        action: item.action,
        reason: item.reason,
        destructive: item.destructive
      }
    };
  }

  if (item.action === 'delete' && !hasPermission(boundaryContext, 'artifact:retention:delete', item.artifact.workspaceId)) {
    return {
      ...item,
      action: 'review',
      reason: 'delete_permission_required',
      destructive: false,
      blocked: true,
      blockedReason: 'actor_lacks_delete_permission',
      originalDecision: {
        action: item.action,
        reason: item.reason,
        destructive: item.destructive
      }
    };
  }

  if (item.action === 'archive' && !hasPermission(boundaryContext, 'artifact:retention:archive', item.artifact.workspaceId)) {
    return {
      ...item,
      action: 'review',
      reason: 'archive_permission_required',
      destructive: false,
      blocked: true,
      blockedReason: 'actor_lacks_archive_permission',
      originalDecision: {
        action: item.action,
        reason: item.reason,
        destructive: item.destructive
      }
    };
  }

  return {
    ...item,
    blocked: false,
    blockedReason: null,
    originalDecision: null
  };
}

function summarizePreview(items) {
  return items.reduce((summary, item) => {
    summary.totalItems += 1;
    summary.totalBytes += item.artifact.sizeBytes;
    summary.byAction[item.action] = (summary.byAction[item.action] || 0) + 1;
    if (item.destructive) {
      summary.destructiveItems += 1;
      summary.destructiveBytes += item.artifact.sizeBytes;
    }
    if (!item.artifact.scope.inBoundary) {
      summary.boundaryBlockedItems += 1;
    }
    if (item.artifact.scope.delegatedWorkspace) {
      summary.delegatedWorkspaceItems += 1;
    }
    if (item.blockedReason === 'actor_lacks_delete_permission' || item.blockedReason === 'actor_lacks_archive_permission') {
      summary.permissionBlockedItems += 1;
    }
    return summary;
  }, {
    totalItems: 0,
    totalBytes: 0,
    destructiveItems: 0,
    destructiveBytes: 0,
    boundaryBlockedItems: 0,
    delegatedWorkspaceItems: 0,
    permissionBlockedItems: 0,
    byAction: { retain: 0, archive: 0, delete: 0, review: 0 }
  });
}

function buildScopeAccessManifest({ previewItems, boundaryContext, requestState, nowDate }) {
  const workspaceMap = new Map();
  const deniedArtifacts = [];

  for (const item of previewItems) {
    const workspaceId = item.artifact.workspaceId;
    const existing = workspaceMap.get(workspaceId) || {
      workspaceId,
      tenantId: item.artifact.tenantId,
      artifactIds: [],
      actionCounts: { retain: 0, archive: 0, delete: 0, review: 0 },
      blockedArtifactIds: [],
      destructiveArtifactIds: [],
      delegated: item.artifact.scope.delegatedWorkspace,
      grantIds: new Set(),
      permissions: new Set()
    };

    existing.artifactIds.push(item.artifact.id);
    existing.actionCounts[item.action] = (existing.actionCounts[item.action] || 0) + 1;

    if (item.blocked) {
      existing.blockedArtifactIds.push(item.artifact.id);
    }

    if (item.destructive) {
      existing.destructiveArtifactIds.push(item.artifact.id);
    }

    if (item.artifact.scope.grantId) {
      existing.grantIds.add(item.artifact.scope.grantId);
    }

    for (const permission of item.artifact.scope.grantPermissions || []) {
      existing.permissions.add(permission);
    }

    if (item.blockedReason) {
      deniedArtifacts.push({
        contract: 'artifact-retention.scope-denial.v1',
        artifactId: item.artifact.id,
        workspaceId,
        tenantId: item.artifact.tenantId,
        requestedAction: item.originalDecision?.action || item.action,
        effectiveAction: item.action,
        reason: item.blockedReason,
        tenantMatch: item.artifact.scope.tenantMatch,
        workspaceAllowed: item.artifact.scope.workspaceAllowed,
        requiredPermission: item.blockedReason === 'actor_lacks_delete_permission'
          ? 'artifact:retention:delete'
          : item.blockedReason === 'actor_lacks_archive_permission'
            ? 'artifact:retention:archive'
            : null
      });
    }

    workspaceMap.set(workspaceId, existing);
  }

  const workspaceScopes = [...workspaceMap.values()]
    .map(scope => ({
      contract: 'artifact-retention.workspace-access-scope.v1',
      scopeId: buildStableToken(['scope', requestState.workflowId, boundaryContext.tenantId, scope.workspaceId]),
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestedWorkspace: scope.workspaceId === boundaryContext.workspaceId,
      delegated: scope.delegated,
      grantIds: [...scope.grantIds].sort(),
      permissions: [...scope.permissions].sort(),
      artifactIds: uniqueTokens(scope.artifactIds),
      destructiveArtifactIds: uniqueTokens(scope.destructiveArtifactIds),
      blockedArtifactIds: uniqueTokens(scope.blockedArtifactIds),
      actionCounts: scope.actionCounts,
      dispatchAllowed: scope.blockedArtifactIds.length === 0
    }))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const blockedWorkspaceIds = workspaceScopes
    .filter(scope => !scope.dispatchAllowed)
    .map(scope => scope.workspaceId);

  return {
    contract: 'artifact-retention.scope-access-manifest.v1',
    manifestId: buildStableToken([
      'scope-access',
      requestState.workflowId,
      boundaryContext.scopeToken,
      previewItems.map(item => [item.artifact.id, item.action, item.blockedReason || 'ok'])
    ]),
    generatedAt: nowDate.toISOString(),
    tenantId: boundaryContext.tenantId,
    requestedWorkspaceId: boundaryContext.workspaceId,
    actorId: boundaryContext.actorId,
    scopeToken: boundaryContext.scopeToken,
    allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
    workspaceScopes,
    deniedArtifacts,
    blockedWorkspaceIds,
    counts: {
      workspaceCount: workspaceScopes.length,
      delegatedWorkspaceCount: workspaceScopes.filter(scope => scope.delegated).length,
      deniedArtifactCount: deniedArtifacts.length,
      blockedWorkspaceCount: blockedWorkspaceIds.length,
      dispatchableWorkspaceCount: workspaceScopes.filter(scope => scope.dispatchAllowed).length
    },
    auditHandoff: {
      contract: 'artifact-retention.scope-audit-handoff.v1',
      proofSubject: 'artifact_retention_workspace_scope',
      proofRoute: requestState.clientRuntime.routeHints.proofRoute,
      correlationId: requestState.trace.correlationId,
      manifestDigest: buildStableToken(workspaceScopes.map(scope => [
        scope.workspaceId,
        scope.artifactIds,
        scope.blockedArtifactIds,
        scope.grantIds
      ])),
      requiresOperatorReview: deniedArtifacts.length > 0
    }
  };
}

function buildValidationSummary(input, artifacts, previewItems, policy, boundaryContext, lifecycleControls, lifecycleSettingsControls, scopeAccessManifest) {
  const errors = [];
  const warnings = [
    ...lifecycleControls.warnings,
    ...lifecycleSettingsControls.validation.warnings
  ];
  const proofCount = Array.isArray(input.evidence) ? input.evidence.length : 0;

  if (!lifecycleSettingsControls.validation.ok) {
    errors.push(...lifecycleSettingsControls.validation.errors.map(error => ({
      ...error,
      commandId: lifecycleSettingsControls.command.commandId,
      message: error.message
    })));
  }

  if (!Array.isArray(input.artifacts)) {
    warnings.push({
      code: 'artifacts_missing',
      message: 'No artifact list was provided; preview uses an empty candidate set.'
    });
  }

  if (proofCount < policy.minProofsRequired) {
    warnings.push({
      code: 'proofs_below_policy',
      message: `Retention preview has ${proofCount} proof item(s); policy asks for ${policy.minProofsRequired}.`
    });
  }

  if (boundaryContext.isolation.tenantWideRequestDenied) {
    warnings.push({
      code: 'tenant_wide_workspace_grant_denied',
      actorId: boundaryContext.actorId,
      message: 'Tenant-wide workspace access was requested but not granted for this actor role.'
    });
  }

  for (const artifact of artifacts) {
    if (!artifact.path || artifact.path === artifact.id) {
      warnings.push({
        code: 'artifact_path_weak',
        artifactId: artifact.id,
        message: 'Artifact has no explicit path or URI.'
      });
    }
  }

  const boundaryBlocked = previewItems.filter(item => !item.artifact.scope.inBoundary);
  if (boundaryBlocked.length > 0) {
    errors.push({
      code: 'artifact_boundary_mismatch',
      artifactIds: boundaryBlocked.map(item => item.artifact.id),
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      message: 'Retention preview includes artifacts outside the requested tenant or workspace boundary.'
    });
  }

  const delegatedWorkspaceItems = previewItems.filter(item => item.artifact.scope.delegatedWorkspace);
  if (delegatedWorkspaceItems.length > 0) {
    warnings.push({
      code: 'delegated_workspace_scope_active',
      artifactIds: delegatedWorkspaceItems.map(item => item.artifact.id),
      workspaceIds: uniqueTokens(delegatedWorkspaceItems.map(item => item.artifact.workspaceId)),
      message: 'Retention preview includes artifacts allowed by explicit workspace grants outside the requested workspace.'
    });
  }

  const permissionBlocked = previewItems.filter(item => item.blockedReason?.startsWith('actor_lacks_'));
  if (permissionBlocked.length > 0) {
    errors.push({
      code: 'retention_permission_denied',
      artifactIds: permissionBlocked.map(item => item.artifact.id),
      actorId: boundaryContext.actorId,
      roles: boundaryContext.roles,
      requiredPermissions: uniqueTokens(permissionBlocked.map(item => (
        item.originalDecision?.action === 'delete'
          ? 'artifact:retention:delete'
          : 'artifact:retention:archive'
      ))),
      message: 'Actor is not authorized to execute one or more retention actions.'
    });
  }

  if (scopeAccessManifest.deniedArtifacts.length > 0) {
    warnings.push({
      code: 'scope_access_manifest_has_denials',
      manifestId: scopeAccessManifest.manifestId,
      deniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
      blockedWorkspaceIds: scopeAccessManifest.blockedWorkspaceIds,
      message: 'Scope access manifest contains denied artifacts for audit handoff.'
    });
  }

  const destructiveWithoutProof = previewItems.filter(
    item => item.destructive && item.artifact.proofRefs.length === 0
  );
  if (destructiveWithoutProof.length > 0) {
    errors.push({
      code: 'destructive_items_missing_proof_refs',
      artifactIds: destructiveWithoutProof.map(item => item.artifact.id),
      message: 'Delete candidates must carry proofRefs before acceptance can complete.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checkedArtifactCount: artifacts.length,
    checkedPreviewItemCount: previewItems.length,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    actorId: boundaryContext.actorId,
    lifecycleEnabled: lifecycleControls.enabled,
    lifecycleMode: lifecycleControls.mode,
    scheduled: lifecycleControls.scheduler.enabled,
    scheduleDue: lifecycleControls.scheduler.due,
    scopeAccessManifestId: scopeAccessManifest.manifestId,
    scopeDeniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
    scopeBlockedWorkspaceIds: scopeAccessManifest.blockedWorkspaceIds,
    settingsCommandStatus: lifecycleSettingsControls.status,
    settingsCommandAction: lifecycleSettingsControls.command.action,
    settingsCommandApplyAllowed: lifecycleSettingsControls.applyAllowed,
    delegatedWorkspaceCount: boundaryContext.isolation.delegatedWorkspaceCount,
    tenantWideAccess: boundaryContext.isolation.tenantWideAccess
  };
}

function limitArtifactIds(ids, limit) {
  return limit > 0 ? ids.slice(0, limit) : ids;
}

function buildRetentionCommands({ previewItems, requestState, persistedState, lifecycleControls, lifecycleSettingsControls }) {
  const completedArchive = new Set(
    persistedState.compatibleWithRequest ? persistedState.completed.archiveArtifactIds : []
  );
  const completedDelete = new Set(
    persistedState.compatibleWithRequest ? persistedState.completed.deleteArtifactIds : []
  );
  const completedArchiveFromCommands = new Set(
    persistedState.compatibleWithRequest
      ? persistedState.commandJournal
          .filter(entry => entry.action === 'archive' && entry.succeeded)
          .flatMap(entry => entry.artifactIds)
      : []
  );
  const completedDeleteFromCommands = new Set(
    persistedState.compatibleWithRequest
      ? persistedState.commandJournal
          .filter(entry => entry.action === 'delete' && entry.succeeded)
          .flatMap(entry => entry.artifactIds)
      : []
  );
  const replayableCommandIds = persistedState.compatibleWithRequest
    ? persistedState.commandJournal
        .filter(entry => entry.replayable && !entry.succeeded)
        .map(entry => entry.commandId)
    : [];
  const skipped = new Set(
    persistedState.compatibleWithRequest ? persistedState.skippedArtifactIds : []
  );
  const failed = new Set(
    persistedState.compatibleWithRequest ? persistedState.failedArtifactIds : []
  );

  const archiveArtifactIds = previewItems
    .filter(item => item.action === 'archive')
    .map(item => item.artifact.id)
    .filter(id => !completedArchive.has(id) && !completedArchiveFromCommands.has(id) && !skipped.has(id));
  const deleteArtifactIds = previewItems
    .filter(item => item.action === 'delete')
    .map(item => item.artifact.id)
    .filter(id => !completedDelete.has(id) && !completedDeleteFromCommands.has(id) && !skipped.has(id));
  const stableArchiveArtifactIds = lifecycleControls.enabled
    && lifecycleControls.execution.archiveEnabled
    && !lifecycleControls.dryRun
    ? uniqueTokens(limitArtifactIds(archiveArtifactIds, lifecycleControls.execution.maxArchiveItemsPerRun))
    : [];
  const stableDeleteArtifactIds = lifecycleControls.enabled
    && lifecycleControls.execution.deleteEnabled
    && !lifecycleControls.dryRun
    ? uniqueTokens(limitArtifactIds(deleteArtifactIds, lifecycleControls.execution.maxDeleteItemsPerRun))
    : [];
  const retryArtifactIds = uniqueTokens([
    ...stableArchiveArtifactIds.filter(id => failed.has(id)),
    ...stableDeleteArtifactIds.filter(id => failed.has(id))
  ]);
  const plannedArchiveArtifactIds = uniqueTokens(archiveArtifactIds);
  const plannedDeleteArtifactIds = uniqueTokens(deleteArtifactIds);
  const commandBase = persistedState.compatibleWithRequest
    ? [persistedState.idempotencyScope]
    : [
        surfaceId,
        requestState.workflowId,
        requestState.trace.correlationId
      ];
  const idempotencyScope = buildStableToken(commandBase);

  return {
    contract: 'artifact-retention.commands.v1',
    idempotencyScope,
    archive: {
      commandId: buildStableToken([...commandBase, 'archive', stableArchiveArtifactIds]),
      type: 'artifact_retention.archive',
      artifactIds: stableArchiveArtifactIds,
      idempotent: true,
      idempotencyKey: buildStableToken([idempotencyScope, 'archive', stableArchiveArtifactIds])
    },
    delete: {
      commandId: buildStableToken([...commandBase, 'delete', stableDeleteArtifactIds]),
      type: 'artifact_retention.delete',
      artifactIds: stableDeleteArtifactIds,
      idempotent: true,
      destructive: stableDeleteArtifactIds.length > 0,
      idempotencyKey: buildStableToken([idempotencyScope, 'delete', stableDeleteArtifactIds])
    },
    dryRun: {
      commandId: buildStableToken([...commandBase, 'dry-run', plannedArchiveArtifactIds, plannedDeleteArtifactIds]),
      type: 'artifact_retention.dry_run',
      enabled: lifecycleControls.enabled && lifecycleControls.dryRun,
      archiveArtifactIds: lifecycleControls.dryRun ? plannedArchiveArtifactIds : [],
      deleteArtifactIds: lifecycleControls.dryRun ? plannedDeleteArtifactIds : [],
      idempotencyKey: buildStableToken([idempotencyScope, 'dry-run', plannedArchiveArtifactIds, plannedDeleteArtifactIds])
    },
    lifecycle: {
      commandId: lifecycleSettingsControls.applyAllowed
        ? lifecycleSettingsControls.command.commandId
        : buildStableToken([...commandBase, 'lifecycle', lifecycleControls.mode, lifecycleControls.scheduler.nextRunAt]),
      type: 'artifact_retention.lifecycle.configure',
      enabled: true,
      action: lifecycleSettingsControls.command.action,
      applySettingsPatch: lifecycleSettingsControls.applyAllowed,
      settings: lifecycleSettingsControls.applyAllowed
        ? lifecycleSettingsControls.proposedSettings
        : lifecycleControls,
      currentSettings: lifecycleControls,
      settingsPatch: lifecycleSettingsControls.proposedSettings,
      settingsValidation: lifecycleSettingsControls.validation,
      idempotencyKey: lifecycleSettingsControls.applyAllowed
        ? lifecycleSettingsControls.command.idempotencyKey
        : buildStableToken([idempotencyScope, 'lifecycle', lifecycleControls.mode])
    },
    replay: {
      contract: 'artifact-retention.command-replay.v1',
      replayableCommandIds: uniqueTokens(replayableCommandIds),
      completedArchiveArtifactIds: uniqueTokens([...completedArchiveFromCommands]),
      completedDeleteArtifactIds: uniqueTokens([...completedDeleteFromCommands]),
      suppressCompletedArtifacts: true
    },
    retry: {
      contract: 'artifact-retention.retry-command.v1',
      commandId: buildStableToken([...commandBase, 'retry', retryArtifactIds]),
      type: 'artifact_retention.retry_failed',
      artifactIds: retryArtifactIds,
      enabled: retryArtifactIds.length > 0,
      idempotent: true,
      idempotencyKey: buildStableToken([idempotencyScope, 'retry', retryArtifactIds])
    },
    plannedArtifactIds: uniqueTokens([...plannedArchiveArtifactIds, ...plannedDeleteArtifactIds]),
    retryArtifactIds,
    pendingArtifactIds: uniqueTokens([...stableArchiveArtifactIds, ...stableDeleteArtifactIds])
  };
}

function classifyRecoveryLease({ persistedState, requestState, nowDate }) {
  const leaseExpiresAt = persistedState.leaseExpiresAt
    ? new Date(persistedState.leaseExpiresAt)
    : null;
  const expired = Boolean(leaseExpiresAt && leaseExpiresAt.getTime() <= nowDate.getTime());
  const active = Boolean(leaseExpiresAt && leaseExpiresAt.getTime() > nowDate.getTime());
  const owner = coerceToken(persistedState.leaseOwner, '');
  const status = !persistedState.compatibleWithRequest
    ? 'ignored_incompatible_checkpoint'
    : !leaseExpiresAt
      ? 'unleased'
      : expired
        ? 'expired'
        : 'active';

  return {
    contract: 'artifact-retention.recovery-lease.v1',
    status,
    owner: owner || null,
    expiresAt: leaseExpiresAt ? leaseExpiresAt.toISOString() : null,
    expired,
    active,
    takeoverAllowed: persistedState.compatibleWithRequest && !active,
    takeoverReason: !persistedState.compatibleWithRequest
      ? 'checkpoint_identity_mismatch'
      : active
        ? 'lease_still_active'
        : expired
          ? 'lease_expired'
          : 'lease_missing',
    nextLeaseOwner: requestState.clientId,
    fencingToken: buildStableToken([
      'retention-lease',
      requestState.workflowId,
      requestState.trace.correlationId,
      owner || 'unowned',
      leaseExpiresAt ? leaseExpiresAt.toISOString() : 'no-expiry'
    ]),
    observedAt: nowDate.toISOString()
  };
}

function buildRestartReplayIntents({ persistedState, commands, pendingArtifactIds, leaseState, nowDate }) {
  if (!persistedState.compatibleWithRequest) {
    return [];
  }

  const pending = new Set(pendingArtifactIds);
  return persistedState.commandJournal
    .filter(entry => entry.replayable && !entry.succeeded)
    .map(entry => {
      const artifactIds = entry.artifactIds.filter(artifactId => pending.has(artifactId));
      const replayStatus = entry.failed || entry.status === 'timeout'
        ? 'retry_ready'
        : leaseState.takeoverAllowed
          ? 'replay_ready'
          : 'awaiting_lease_release';
      const dispatchAllowed = artifactIds.length > 0
        && leaseState.takeoverAllowed
        && ['retry_ready', 'replay_ready'].includes(replayStatus);

      return {
        contract: 'artifact-retention.restart-replay-intent.v1',
        intentId: buildStableToken([
          'restart-replay',
          commands.idempotencyScope,
          entry.commandId,
          replayStatus,
          artifactIds
        ]),
        commandId: entry.commandId,
        idempotencyKey: entry.idempotencyKey,
        action: entry.action,
        type: entry.type,
        originalStatus: entry.status,
        replayStatus,
        dispatchAllowed,
        artifactIds,
        artifactCount: artifactIds.length,
        suppressedArtifactIds: entry.artifactIds.filter(artifactId => !pending.has(artifactId)),
        leaseFencingToken: leaseState.fencingToken,
        retryCommandId: replayStatus === 'retry_ready' ? commands.retry.commandId : null,
        observedAt: nowDate.toISOString()
      };
    })
    .filter(intent => intent.artifactCount > 0 || intent.suppressedArtifactIds.length > 0);
}

function buildRecoveryState({ readiness, previewItems, requestState, persistedState, commands, nowDate }) {
  const previewArchiveIds = previewItems
    .filter(item => item.action === 'archive')
    .map(item => item.artifact.id);
  const previewDeleteIds = previewItems
    .filter(item => item.action === 'delete')
    .map(item => item.artifact.id);
  const completedIds = uniqueTokens([
    ...persistedState.completed.archiveArtifactIds,
    ...persistedState.completed.deleteArtifactIds,
    ...persistedState.skippedArtifactIds
  ]);
  const expectedWorkIds = uniqueTokens([...previewArchiveIds, ...previewDeleteIds]);
  const pendingArtifactIds = expectedWorkIds.filter(id => !completedIds.includes(id));
  const leaseExpiresAt = persistedState.leaseExpiresAt
    ? new Date(persistedState.leaseExpiresAt)
    : null;
  const leaseExpired = Boolean(leaseExpiresAt && leaseExpiresAt.getTime() <= nowDate.getTime());
  const leaseState = classifyRecoveryLease({ persistedState, requestState, nowDate });
  const persistedTerminal = ['complete', 'completed', 'cancelled', 'failed'].includes(persistedState.status);
  const restartStatus = !persistedState.compatibleWithRequest
    ? 'discard_incompatible_checkpoint'
    : persistedTerminal && pendingArtifactIds.length === 0
      ? 'terminal_checkpoint'
      : leaseExpired
        ? 'resume_after_expired_lease'
        : pendingArtifactIds.length > 0
          ? 'resume_pending_work'
          : readiness === 'ready'
          ? 'ready_without_pending_work'
          : 'awaiting_preview_readiness';
  const resumeCommandIds = [
    commands.archive.artifactIds.length > 0 ? commands.archive.commandId : null,
    commands.delete.artifactIds.length > 0 ? commands.delete.commandId : null
  ].filter(Boolean);
  const nextRuntimeStatus = restartStatus === 'terminal_checkpoint'
    ? persistedState.status
    : restartStatus === 'discard_incompatible_checkpoint'
      ? 'reinitialized'
      : pendingArtifactIds.length > 0
        ? 'resumable'
        : readiness;
  const checkpointArtifactState = {
    archiveCompletedArtifactIds: uniqueTokens([
      ...persistedState.completed.archiveArtifactIds,
      ...commands.replay.completedArchiveArtifactIds
    ]),
    deleteCompletedArtifactIds: uniqueTokens([
      ...persistedState.completed.deleteArtifactIds,
      ...commands.replay.completedDeleteArtifactIds
    ]),
    skippedArtifactIds: persistedState.compatibleWithRequest ? persistedState.skippedArtifactIds : [],
    failedArtifactIds: persistedState.compatibleWithRequest ? persistedState.failedArtifactIds : []
  };
  const commandCheckpoint = [
    commands.archive.artifactIds.length > 0
      ? {
          commandId: commands.archive.commandId,
          idempotencyKey: commands.archive.idempotencyKey,
          action: 'archive',
          type: commands.archive.type,
          status: 'planned',
          artifactIds: commands.archive.artifactIds
        }
      : null,
    commands.delete.artifactIds.length > 0
      ? {
          commandId: commands.delete.commandId,
          idempotencyKey: commands.delete.idempotencyKey,
          action: 'delete',
          type: commands.delete.type,
          status: 'planned',
          artifactIds: commands.delete.artifactIds
        }
      : null,
    commands.dryRun.enabled
      ? {
          commandId: commands.dryRun.commandId,
          idempotencyKey: commands.dryRun.idempotencyKey,
          action: 'dry_run',
          type: commands.dryRun.type,
          status: 'planned',
          artifactIds: uniqueTokens([
            ...commands.dryRun.archiveArtifactIds,
            ...commands.dryRun.deleteArtifactIds
          ])
    }
      : null
  ].filter(Boolean);
  const replayIntents = buildRestartReplayIntents({
    persistedState,
    commands,
    pendingArtifactIds,
    leaseState,
    nowDate
  });
  const dispatchableReplayIntents = replayIntents.filter(intent => intent.dispatchAllowed);
  const suppressedReplayArtifactIds = uniqueTokens(
    replayIntents.flatMap(intent => intent.suppressedArtifactIds)
  );
  const recoveryCommand = {
    contract: 'artifact-retention.restart-recovery-command.v1',
    commandId: buildStableToken([
      commands.idempotencyScope,
      'restart-recovery',
      restartStatus,
      pendingArtifactIds,
      dispatchableReplayIntents.map(intent => intent.commandId)
    ]),
    type: 'artifact_retention.restart_recovery',
    enabled: restartStatus !== 'terminal_checkpoint'
      && restartStatus !== 'ready_without_pending_work'
      && (pendingArtifactIds.length > 0 || dispatchableReplayIntents.length > 0),
    status: dispatchableReplayIntents.length > 0
      ? 'replay_ready'
      : leaseState.active
        ? 'lease_wait'
        : pendingArtifactIds.length > 0
          ? 'resume_ready'
          : 'idle',
    idempotent: true,
    idempotencyKey: buildStableToken([
      commands.idempotencyScope,
      'restart-recovery',
      leaseState.fencingToken,
      pendingArtifactIds
    ]),
    leaseFencingToken: leaseState.fencingToken,
    replayIntentIds: dispatchableReplayIntents.map(intent => intent.intentId),
    pendingArtifactIds,
    suppressedReplayArtifactIds
  };

  return {
    contract: 'artifact-retention.recovery.v1',
    restartSafeStatus: restartStatus,
    nextRuntimeStatus,
    persistedStatus: persistedState.status,
    idempotencyScope: commands.idempotencyScope,
    compatibleCheckpoint: persistedState.compatibleWithRequest,
    leaseState,
    leaseExpired,
    pendingArtifactIds,
    retryArtifactIds: commands.retryArtifactIds,
    completedArtifactIds: completedIds,
    resumeCommandIds,
    replayableCommandIds: commands.replay.replayableCommandIds,
    replayIntents,
    recoveryCommand,
    checkpointToPersist: {
      contract: 'artifact-retention.next-persisted-state.v1',
      requestId: requestState.requestId,
      workflowId: requestState.workflowId,
      idempotencyScope: commands.idempotencyScope,
      status: nextRuntimeStatus,
      statusObservedAt: nowDate.toISOString(),
      lastCheckpointAt: nowDate.toISOString(),
      restartSafeStatus: restartStatus,
      artifacts: checkpointArtifactState,
      commandJournalAppend: commandCheckpoint,
      recovery: {
        contract: 'artifact-retention.persisted-recovery-state.v1',
        lease: leaseState,
        replayIntentIds: replayIntents.map(intent => intent.intentId),
        recoveryCommandId: recoveryCommand.commandId,
        recoveryCommandStatus: recoveryCommand.status,
        suppressedReplayArtifactIds
      },
      pendingArtifactIds,
      resumeCommandIds
    }
  };
}

function minutesFrom(dateIso, minutes) {
  return new Date(new Date(dateIso).getTime() + minutes * 60 * 1000);
}

function buildOperationalHealth({ readiness, validationSummary, persistedState, commands, recoveryState, nowDate }) {
  const retryCandidateIds = new Set(commands.retryArtifactIds);
  const pendingIds = new Set(recoveryState.pendingArtifactIds);
  const relevantFailures = persistedState.compatibleWithRequest
    ? persistedState.failureEvents.filter(event => pendingIds.has(event.artifactId))
    : [];
  const retryPlans = relevantFailures.map(event => {
    const backoffIndex = Math.min(event.attempts, retryBackoffMinutes.length - 1);
    const nextRetryAt = minutesFrom(event.failedAt, retryBackoffMinutes[backoffIndex]);
    const attemptLimitReached = event.attempts >= retryBackoffMinutes.length;
    const retryDue = retryCandidateIds.has(event.artifactId)
      && event.retryable
      && !attemptLimitReached
      && nextRetryAt.getTime() <= nowDate.getTime();

    return {
      artifactId: event.artifactId,
      action: event.action,
      code: event.code,
      attempts: event.attempts,
      retryable: event.retryable && !attemptLimitReached,
      retryDue,
      nextRetryAt: nextRetryAt.toISOString(),
      backoffMinutes: retryBackoffMinutes[backoffIndex],
      lastFailureAt: event.failedAt,
      message: event.message
    };
  });
  const permanentFailures = retryPlans.filter(plan => !plan.retryable);
  const waitingRetries = retryPlans.filter(plan => plan.retryable && !plan.retryDue);
  const dueRetries = retryPlans.filter(plan => plan.retryDue);
  const retryDueArtifactIds = dueRetries.map(plan => plan.artifactId);
  const waitingArtifactIds = waitingRetries.map(plan => plan.artifactId);
  const permanentlyFailedArtifactIds = permanentFailures.map(plan => plan.artifactId);
  const commandFailures = persistedState.commandJournal.filter(entry => (
    ['failed', 'error', 'timed_out', 'timeout'].includes(entry.status)
  ));
  const recoveryBlockedByLease = recoveryState.leaseState.active
    && recoveryState.pendingArtifactIds.length > 0;
  const replayReadyIntents = recoveryState.replayIntents.filter(intent => intent.dispatchAllowed);
  const replayWaitingIntents = recoveryState.replayIntents.filter(intent => (
    intent.replayStatus === 'awaiting_lease_release'
  ));
  const incidentItems = [
    ...validationSummary.errors.map(error => ({
      incidentId: buildStableToken(['incident', 'validation', error.code, error.artifactIds || []]),
      category: 'validation',
      severity: 'error',
      status: 'open',
      code: error.code,
      artifactIds: error.artifactIds || [],
      owner: 'requester',
      nextAction: 'resolve_validation_error',
      retryCommandId: null,
      message: error.message
    })),
    ...permanentFailures.map(plan => ({
      incidentId: buildStableToken(['incident', 'permanent-failure', plan.artifactId, plan.code]),
      category: 'retention_failure',
      severity: 'error',
      status: 'operator_review_required',
      code: plan.code,
      artifactIds: [plan.artifactId],
      owner: 'retention_operator',
      nextAction: 'inspect_artifact_failure',
      retryCommandId: null,
      message: plan.message,
      lastFailureAt: plan.lastFailureAt
    })),
    ...waitingRetries.map(plan => ({
      incidentId: buildStableToken(['incident', 'retry-backoff', plan.artifactId, plan.nextRetryAt]),
      category: 'retry_backoff',
      severity: 'warning',
      status: 'waiting',
      code: 'retry_backoff_active',
      artifactIds: [plan.artifactId],
      owner: 'hosted_kernel',
      nextAction: 'wait_for_retry_window',
      retryCommandId: commands.retry.commandId,
      nextRetryAt: plan.nextRetryAt,
      message: `Retention retry is waiting for the configured backoff window until ${plan.nextRetryAt}.`
    })),
    ...dueRetries.map(plan => ({
      incidentId: buildStableToken(['incident', 'retry-due', plan.artifactId, commands.retry.commandId]),
      category: 'retry_ready',
      severity: 'info',
      status: 'ready',
      code: 'retry_window_elapsed',
      artifactIds: [plan.artifactId],
      owner: 'hosted_kernel',
      nextAction: 'dispatch_retry_command',
      retryCommandId: commands.retry.commandId,
      nextRetryAt: plan.nextRetryAt,
      message: 'Retention retry window has elapsed and the artifact is eligible for retry dispatch.'
    })),
    ...replayReadyIntents.map(intent => ({
      incidentId: buildStableToken(['incident', 'restart-replay-ready', intent.intentId]),
      category: 'restart_recovery',
      severity: 'info',
      status: 'ready',
      code: 'restart_replay_ready',
      artifactIds: intent.artifactIds,
      owner: 'hosted_kernel',
      nextAction: 'dispatch_restart_replay',
      retryCommandId: intent.retryCommandId,
      commandId: intent.commandId,
      message: 'A persisted retention command is ready for idempotent restart replay.'
    })),
    ...replayWaitingIntents.map(intent => ({
      incidentId: buildStableToken(['incident', 'restart-replay-waiting', intent.intentId]),
      category: 'restart_recovery',
      severity: 'warning',
      status: 'waiting',
      code: 'restart_replay_waiting_for_lease',
      artifactIds: intent.artifactIds,
      owner: 'hosted_kernel',
      nextAction: 'wait_for_active_lease',
      commandId: intent.commandId,
      leaseOwner: recoveryState.leaseState.owner,
      leaseExpiresAt: recoveryState.leaseState.expiresAt,
      message: 'Restart replay is waiting because the previous retention lease is still active.'
    })),
    recoveryBlockedByLease
      ? {
          incidentId: buildStableToken([
            'incident',
            'active-recovery-lease',
            recoveryState.leaseState.fencingToken
          ]),
          category: 'restart_recovery',
          severity: 'warning',
          status: 'waiting',
          code: 'active_recovery_lease',
          artifactIds: recoveryState.pendingArtifactIds,
          owner: 'hosted_kernel',
          nextAction: 'wait_for_active_lease',
          leaseOwner: recoveryState.leaseState.owner,
          leaseExpiresAt: recoveryState.leaseState.expiresAt,
          message: 'Pending retention work is restart-safe but held until the active lease expires.'
        }
      : null
  ].filter(Boolean);
  const validationBlocked = !validationSummary.ok;
  const healthStatus = validationBlocked || permanentFailures.length > 0
    ? 'blocked'
    : recoveryBlockedByLease
      ? 'degraded'
    : waitingRetries.length > 0
      ? 'degraded'
      : commandFailures.length > 0 || dueRetries.length > 0 || replayReadyIntents.length > 0
        ? 'retry_ready'
        : readiness === 'ready'
          ? 'healthy'
          : 'pending';
  const executionAllowed = readiness === 'ready'
    && !validationBlocked
    && permanentFailures.length === 0
    && waitingRetries.length === 0
    && !recoveryBlockedByLease;
  const actionableErrors = [
    ...validationSummary.errors.map(error => ({
      code: error.code,
      severity: 'error',
      action: 'resolve_validation_error',
      message: error.message,
      artifactIds: error.artifactIds || []
    })),
    ...permanentFailures.map(plan => ({
      code: plan.code,
      severity: 'error',
      action: 'operator_review_required',
      message: plan.message,
      artifactIds: [plan.artifactId],
      lastFailureAt: plan.lastFailureAt
    })),
    ...waitingRetries.map(plan => ({
      code: 'retry_backoff_active',
      severity: 'warning',
      action: 'wait_for_retry_window',
      message: `Retry for artifact ${plan.artifactId} is delayed until ${plan.nextRetryAt}.`,
      artifactIds: [plan.artifactId],
      nextRetryAt: plan.nextRetryAt
    })),
    ...dueRetries.map(plan => ({
      code: 'retry_window_elapsed',
      severity: 'info',
      action: 'dispatch_retry_command',
      message: `Retry for artifact ${plan.artifactId} is ready to dispatch.`,
      artifactIds: [plan.artifactId],
      retryCommandId: commands.retry.commandId,
      nextRetryAt: plan.nextRetryAt
    }))
  ];

  return {
    contract: 'artifact-retention.operational-health.v1',
    status: healthStatus,
    executionAllowed,
    degradedMode: {
      enabled: healthStatus === 'degraded',
      reason: recoveryBlockedByLease
        ? 'active_recovery_lease'
        : waitingRetries.length > 0
          ? 'retry_backoff_active'
          : null,
      affectedArtifactIds: recoveryBlockedByLease
        ? recoveryState.pendingArtifactIds
        : waitingRetries.map(plan => plan.artifactId)
    },
    retryPolicy: {
      backoffMinutes: retryBackoffMinutes,
      maxAttempts: retryBackoffMinutes.length
    },
    incidentQueue: {
      contract: 'artifact-retention.operational-incident-queue.v1',
      openCount: incidentItems.length,
      retryReadyCount: dueRetries.length,
      waitingRetryCount: waitingRetries.length,
      permanentFailureCount: permanentFailures.length,
      validationFailureCount: validationSummary.errors.length,
      items: incidentItems
    },
    retryCommand: {
      ...commands.retry,
      dispatchableArtifactIds: retryDueArtifactIds,
      waitingArtifactIds,
      permanentlyFailedArtifactIds,
      blocked: validationBlocked || permanentFailures.length > 0,
      blockedReason: validationBlocked
        ? 'validation_failed'
        : permanentFailures.length > 0
          ? 'permanent_failure_requires_review'
          : null
    },
    restartRecovery: {
      ...recoveryState.recoveryCommand,
      lease: recoveryState.leaseState,
      replayReadyCount: replayReadyIntents.length,
      replayWaitingCount: replayWaitingIntents.length,
      replayIntentIds: recoveryState.replayIntents.map(intent => intent.intentId),
      blockedByActiveLease: recoveryBlockedByLease
    },
    retryPlan: {
      retryDueArtifactIds,
      waitingArtifactIds,
      permanentlyFailedArtifactIds,
      items: retryPlans
    },
    commandFailureCount: commandFailures.length,
    actionableErrors
  };
}

function incrementCounter(target, key, count = 1) {
  const normalizedKey = coerceToken(key, 'unknown');
  target[normalizedKey] = (target[normalizedKey] || 0) + count;
}

function incrementBytes(target, key, bytes) {
  const normalizedKey = coerceToken(key, 'unknown');
  target[normalizedKey] = (target[normalizedKey] || 0) + clampNonNegativeInteger(bytes);
}

function buildExportDigestToken(rows) {
  return buildStableToken(rows.map(row => [
    row.artifactId,
    row.action,
    row.reason,
    row.sizeBytes,
    row.blockedReason || 'unblocked',
    row.proofRefCount
  ]));
}

function summarizeCommandJournal(commandJournal = []) {
  return commandJournal.reduce((summary, entry) => {
    incrementCounter(summary.byAction, entry.action);
    incrementCounter(summary.byStatus, entry.status);

    if (entry.terminal) {
      summary.terminalCommandCount += 1;
    }

    if (entry.replayable && !entry.succeeded) {
      summary.replayableCommandCount += 1;
    }

    if (entry.failed) {
      summary.failedCommandCount += 1;
    }

    summary.referencedArtifactCount += entry.artifactIds.length;
    return summary;
  }, {
    totalCommandCount: commandJournal.length,
    terminalCommandCount: 0,
    failedCommandCount: 0,
    replayableCommandCount: 0,
    referencedArtifactCount: 0,
    byAction: {},
    byStatus: {}
  });
}

function buildTimelineEvent({ at, type, status, label, artifactIds = [], metadata = {} }) {
  const observedAt = coerceDate(at, '1970-01-01T00:00:00.000Z').toISOString();

  return {
    contract: 'artifact-retention.timeline-event.v1',
    eventId: buildStableToken(['timeline', observedAt, type, status, label, artifactIds]),
    at: observedAt,
    type,
    status,
    label,
    artifactIds,
    ...metadata
  };
}

function buildAnalyticsReportingState({
  readiness,
  summary,
  previewItems,
  validationSummary,
  acceptance,
  requestState,
  boundaryContext,
  persistedState,
  recoveryState,
  operationalHealth,
  lifecycleSettingsControls,
  commands,
  nowDate
}) {
  const byReason = {};
  const byClassification = {};
  const bytesByAction = {};
  const destructiveBytesByReason = {};
  const blockedByReason = {};
  const delegatedWorkspaceIds = new Set();

  for (const item of previewItems) {
    incrementCounter(byReason, item.reason);
    incrementCounter(byClassification, item.artifact.classification);
    incrementBytes(bytesByAction, item.action, item.artifact.sizeBytes);

    if (item.blockedReason) {
      incrementCounter(blockedByReason, item.blockedReason);
    }

    if (item.artifact.scope.delegatedWorkspace) {
      delegatedWorkspaceIds.add(item.artifact.workspaceId);
    }

    if (item.destructive) {
      incrementBytes(destructiveBytesByReason, item.reason, item.artifact.sizeBytes);
    }
  }

  const commandCounters = summarizeCommandJournal(
    persistedState.compatibleWithRequest ? persistedState.commandJournal : []
  );
  const acceptedDestructiveIds = acceptance.accepted ? acceptance.destructiveArtifactIds : [];
  const exportable = validationSummary.ok && readiness !== 'blocked';
  const currentSnapshot = {
    snapshotId: buildStableToken(['snapshot', requestState.workflowId, nowDate.toISOString()]),
    observedAt: nowDate.toISOString(),
    status: readiness,
    totalItems: summary.totalItems,
    archiveItems: summary.byAction.archive,
    deleteItems: summary.byAction.delete,
    reviewItems: summary.byAction.review,
    retainItems: summary.byAction.retain,
    destructiveItems: summary.destructiveItems,
    pendingItems: recoveryState.pendingArtifactIds.length,
    failedItems: operationalHealth.retryPlan.permanentlyFailedArtifactIds.length,
    totalBytes: summary.totalBytes,
    destructiveBytes: summary.destructiveBytes
  };
  const history = [...persistedState.historySnapshots, currentSnapshot]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(-21);
  const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
  const deltaFromPrevious = previousSnapshot
    ? {
        totalItems: currentSnapshot.totalItems - previousSnapshot.totalItems,
        archiveItems: currentSnapshot.archiveItems - previousSnapshot.archiveItems,
        deleteItems: currentSnapshot.deleteItems - previousSnapshot.deleteItems,
        destructiveItems: currentSnapshot.destructiveItems - previousSnapshot.destructiveItems,
        pendingItems: currentSnapshot.pendingItems - previousSnapshot.pendingItems,
        failedItems: currentSnapshot.failedItems - previousSnapshot.failedItems,
        totalBytes: currentSnapshot.totalBytes - previousSnapshot.totalBytes,
        destructiveBytes: currentSnapshot.destructiveBytes - previousSnapshot.destructiveBytes
      }
    : null;
  const exportRows = previewItems.map(item => ({
    artifactId: item.artifact.id,
    path: item.artifact.path,
    action: item.action,
    reason: item.reason,
    classification: item.artifact.classification,
    sizeBytes: item.artifact.sizeBytes,
    idleDays: item.artifact.idleDays,
    tenantId: item.artifact.tenantId,
    workspaceId: item.artifact.workspaceId,
    blockedReason: item.blockedReason,
    destructive: item.destructive,
    proofRefCount: item.artifact.proofRefs.length,
    inBoundary: item.artifact.scope.inBoundary,
    delegatedWorkspace: item.artifact.scope.delegatedWorkspace,
    grantId: item.artifact.scope.grantId
  }));
  const exportDigest = buildExportDigestToken(exportRows);
  const exportWarnings = [
    exportRows.length !== summary.totalItems
      ? {
          code: 'export_row_count_mismatch',
          message: 'Retention export rows do not match the current preview item count.'
        }
      : null,
    !validationSummary.ok
      ? {
          code: 'export_contains_validation_errors',
          message: 'Retention export is generated for review but should not be dispatched until validation passes.'
        }
      : null,
    summary.destructiveItems > 0 && !acceptance.accepted
      ? {
          code: 'destructive_export_not_accepted',
          message: 'Retention export contains destructive candidates that still require acceptance.'
        }
      : null
  ].filter(Boolean);
  const timeline = [
    persistedState.lastCheckpointAt
      ? buildTimelineEvent({
          at: persistedState.lastCheckpointAt,
          type: 'checkpoint',
          status: persistedState.status,
          label: 'Persisted retention checkpoint observed'
        })
      : null,
    ...persistedState.failureEvents.map(event => buildTimelineEvent({
      at: event.failedAt,
      type: 'failure',
      status: event.retryable ? 'retryable' : 'permanent',
      label: event.code,
      artifactIds: [event.artifactId],
      metadata: {
        action: event.action,
        attempts: event.attempts,
        retryable: event.retryable
      }
    })),
    ...persistedState.commandJournal.map(entry => buildTimelineEvent({
      at: entry.completedAt || entry.dispatchedAt || persistedState.statusObservedAt,
      type: 'command',
      status: entry.status,
      label: 'Retention command journal entry',
      artifactIds: entry.artifactIds,
      metadata: {
        commandId: entry.commandId,
        action: entry.action,
        replayable: entry.replayable
      }
    })),
    acceptance.accepted
      ? buildTimelineEvent({
          at: acceptance.acceptedAt || nowDate.toISOString(),
          type: 'acceptance',
          status: 'accepted',
          label: 'Destructive retention preview accepted',
          artifactIds: acceptedDestructiveIds,
          metadata: {
            acceptedBy: acceptance.acceptedBy || null
          }
        })
      : acceptance.required
        ? buildTimelineEvent({
            at: nowDate.toISOString(),
            type: 'acceptance',
            status: 'required',
            label: 'Destructive retention preview requires acceptance',
            artifactIds: acceptance.destructiveArtifactIds
          })
        : null,
    buildTimelineEvent({
      at: nowDate.toISOString(),
      type: 'preview',
      status: readiness,
      label: 'Retention preview generated',
      metadata: {
        candidateCount: summary.totalItems,
        pendingCount: recoveryState.pendingArtifactIds.length,
        exportDigest
      }
    })
  ]
    .filter(Boolean)
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-40);

  return {
    contract: 'artifact-retention.analytics-reporting.v1',
    counters: {
      totalItems: summary.totalItems,
      totalBytes: summary.totalBytes,
      destructiveItems: summary.destructiveItems,
      destructiveBytes: summary.destructiveBytes,
      boundaryBlockedItems: summary.boundaryBlockedItems,
      delegatedWorkspaceItems: summary.delegatedWorkspaceItems,
      permissionBlockedItems: summary.permissionBlockedItems,
      validationErrorCount: validationSummary.errors.length,
      validationWarningCount: validationSummary.warnings.length,
      pendingArtifactCount: recoveryState.pendingArtifactIds.length,
      retryDueArtifactCount: operationalHealth.retryPlan.retryDueArtifactIds.length,
      retryBackoffArtifactCount: operationalHealth.retryPlan.waitingArtifactIds.length,
      permanentlyFailedArtifactCount: operationalHealth.retryPlan.permanentlyFailedArtifactIds.length,
      acceptedDestructiveItems: acceptedDestructiveIds.length,
      acceptedDestructiveBytes: previewItems
        .filter(item => acceptedDestructiveIds.includes(item.artifact.id))
        .reduce((total, item) => total + item.artifact.sizeBytes, 0),
      commandJournal: commandCounters,
      exportRowCount: exportRows.length,
      exportWarningCount: exportWarnings.length,
      timelineEventCount: timeline.length,
      lifecycleSettingsWarningCount: lifecycleSettingsControls.validation.warnings.length,
      lifecycleSettingsErrorCount: lifecycleSettingsControls.validation.errors.length,
      delegatedWorkspaceIds: [...delegatedWorkspaceIds].sort(),
      byAction: summary.byAction,
      byReason,
      byClassification,
      blockedByReason,
      bytesByAction,
      destructiveBytesByReason
    },
    history: {
      snapshots: history,
      currentSnapshot,
      previousSnapshot,
      deltaFromPrevious
    },
    exportSummary: {
      exportId: buildStableToken(['export', requestState.workflowId, requestState.trace.correlationId]),
      generatedAt: nowDate.toISOString(),
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      workflowId: requestState.workflowId,
      commandIds: recoveryState.resumeCommandIds,
      idempotencyScope: commands.idempotencyScope,
      exportable,
      digest: exportDigest,
      rowCount: exportRows.length,
      warningCount: exportWarnings.length,
      warnings: exportWarnings,
      columns: [
        'artifactId',
        'path',
        'action',
        'reason',
        'classification',
        'sizeBytes',
        'idleDays',
        'tenantId',
        'workspaceId',
        'blockedReason',
        'destructive',
        'proofRefCount',
        'inBoundary',
        'delegatedWorkspace',
        'grantId'
      ],
      rows: exportRows
    },
    timeline,
    reportingState: {
      contract: 'artifact-retention.reporting-state.v1',
      generatedAt: nowDate.toISOString(),
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      workflowId: requestState.workflowId,
      currentSnapshotId: currentSnapshot.snapshotId,
      exportId: buildStableToken(['export', requestState.workflowId, requestState.trace.correlationId]),
      exportDigest,
      exportable,
      latestTimelineEventId: timeline.length > 0 ? timeline[timeline.length - 1].eventId : null,
      persistableHistoryAppend: currentSnapshot,
      persistableReportCursor: buildStableToken([
        'report',
        requestState.workflowId,
        nowDate.toISOString(),
        exportDigest
      ]),
      countersToPersist: {
        totalItems: summary.totalItems,
        archiveItems: summary.byAction.archive,
        deleteItems: summary.byAction.delete,
        reviewItems: summary.byAction.review,
        retainItems: summary.byAction.retain,
        pendingItems: recoveryState.pendingArtifactIds.length,
        failedItems: operationalHealth.retryPlan.permanentlyFailedArtifactIds.length,
        validationErrorCount: validationSummary.errors.length,
        commandFailureCount: commandCounters.failedCommandCount,
        exportWarningCount: exportWarnings.length,
        lifecycleSettingsStatus: lifecycleSettingsControls.status,
        lifecycleSettingsAction: lifecycleSettingsControls.command.action,
        lifecycleSettingsApplyAllowed: lifecycleSettingsControls.applyAllowed
      }
    }
  };
}

function buildLifecycleNextAction({ lifecycleControls, commands, summary, readiness, nowDate }) {
  const hasPlannedWork = commands.plannedArtifactIds.length > 0;
  const hasDispatchWork = commands.pendingArtifactIds.length > 0 || commands.dryRun.enabled;
  const disabledReason = !lifecycleControls.enabled
    ? 'lifecycle_disabled'
    : lifecycleControls.scheduler.paused
      ? 'lifecycle_paused'
      : lifecycleControls.mode === 'automatic' && lifecycleControls.scheduler.enabled && !lifecycleControls.scheduler.due
        ? 'schedule_not_due'
        : !lifecycleControls.execution.archiveEnabled && summary.byAction.archive > 0
            ? 'archive_execution_disabled'
            : !lifecycleControls.execution.deleteEnabled && summary.byAction.delete > 0
              ? 'delete_execution_disabled'
              : null;
  const executionAllowed = readiness === 'ready'
    && hasDispatchWork
    && !disabledReason;
  const dryRunReady = executionAllowed && lifecycleControls.dryRun;

  return {
    contract: 'artifact-retention.lifecycle-next-action.v1',
    status: dryRunReady
      ? 'dry_run_enabled'
      : executionAllowed
      ? 'dispatchable'
      : !hasPlannedWork
        ? 'idle'
        : disabledReason || 'awaiting_readiness',
    executionAllowed,
    plannedWork: {
      artifactIds: commands.plannedArtifactIds,
      archiveCount: summary.byAction.archive,
      deleteCount: summary.byAction.delete,
      destructiveCount: summary.destructiveItems
    },
    schedule: {
      mode: lifecycleControls.mode,
      due: lifecycleControls.scheduler.due,
      paused: lifecycleControls.scheduler.paused,
      nextRunAt: lifecycleControls.scheduler.nextRunAt,
      pauseUntil: lifecycleControls.scheduler.pauseUntil,
      evaluatedAt: nowDate.toISOString()
    },
    commandIds: [
      commands.archive.artifactIds.length > 0 ? commands.archive.commandId : null,
      commands.delete.artifactIds.length > 0 ? commands.delete.commandId : null,
      commands.dryRun.enabled ? commands.dryRun.commandId : null,
      commands.lifecycle.commandId
    ].filter(Boolean),
    disabledReason
  };
}

function normalizeOperationMethod(value, fallback = 'POST') {
  const method = coerceToken(value, fallback).toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method : fallback;
}

function normalizeProviderOperations(rawProvider, providerId, capabilities, acceptedPayloadContracts) {
  const operationSource = rawProvider.operations
    || rawProvider.operationContracts
    || rawProvider.routes
    || rawProvider.handlers
    || {};
  const baseEndpoint = rawProvider.endpoint || rawProvider.url || rawProvider.target || null;

  return Object.fromEntries(providerOperationCapabilities.map(capability => {
    const rawOperation = operationSource[capability]
      || operationSource[capability.replace('-', '_')]
      || {};
    const defaultPayloadContract = providerPayloadContractsByCapability[capability];
    const payloadContract = coerceToken(
      rawOperation.payloadContract || rawOperation.contract || rawOperation.requestContract,
      defaultPayloadContract
    );
    const responseContract = coerceToken(
      rawOperation.responseContract || rawOperation.receiptContract,
      `${payloadContract}.receipt`
    );
    const endpoint = rawOperation.endpoint
      || rawOperation.url
      || rawOperation.route
      || (capability === 'external-handoff' ? rawProvider.handoffEndpoint : null)
      || baseEndpoint;
    const supported = capabilities.includes(capability);
    const accepted = acceptedPayloadContracts.includes(payloadContract)
      || acceptedPayloadContracts.includes(defaultPayloadContract)
      || acceptedPayloadContracts.includes('artifact-retention.dispatch-intent.v1');

    return [capability, {
      contract: 'artifact-retention.provider-operation-contract.v1',
      operationId: buildStableToken(['provider-operation', providerId, capability]),
      capability,
      supported,
      enabled: supported && normalizeBoolean(rawOperation.enabled, true),
      endpoint,
      method: normalizeOperationMethod(rawOperation.method),
      payloadContract,
      responseContract,
      accepted,
      deliveryMode: coerceToken(
        rawOperation.deliveryMode || rawOperation.mode,
        endpoint ? 'http' : 'in-process'
      ),
      requiresExternalHandoff: capability === 'external-handoff'
        || normalizeBoolean(rawOperation.requiresExternalHandoff, false)
    }];
  }));
}

function normalizeProviderContract(rawProvider = {}, index) {
  const providerId = coerceToken(
    rawProvider.providerId || rawProvider.id || rawProvider.name,
    `hosted-kernel-retention-${index + 1}`
  );
  const kind = coerceToken(rawProvider.kind || rawProvider.type, 'hosted-kernel').toLowerCase();
  const capabilities = normalizeCapabilityList(
    rawProvider.capabilities || rawProvider.supportedCapabilities,
    kind === 'hosted-kernel'
      ? ['archive', 'delete', 'proof', 'sync', 'external-handoff']
      : []
  );
  const maxBatchSize = clampPositiveInteger(
    rawProvider.maxBatchSize || rawProvider.batchSize || rawProvider.limits?.maxBatchSize,
    100
  );
  const endpoint = rawProvider.endpoint || rawProvider.url || rawProvider.target || null;
  const enabled = normalizeBoolean(rawProvider.enabled, true);
  const acceptedPayloadContracts = normalizeProviderPayloadContractList(
    rawProvider.acceptedPayloadContracts || rawProvider.acceptedContracts || rawProvider.contracts
  );
  const operations = normalizeProviderOperations(
    rawProvider,
    providerId,
    capabilities,
    acceptedPayloadContracts
  );
  const unsupportedOperationContracts = providerOperationCapabilities.filter(capability => (
    capabilities.includes(capability)
    && (!operations[capability].enabled || !operations[capability].accepted)
  ));

  return {
    contract: 'artifact-retention.provider-contract.v1',
    providerId,
    kind,
    enabled,
    displayName: coerceToken(rawProvider.displayName || rawProvider.label, providerId),
    endpoint,
    capabilities,
    maxBatchSize,
    requiresAcknowledgement: normalizeBoolean(
      rawProvider.requiresAcknowledgement ?? rawProvider.requireAck,
      kind !== 'hosted-kernel'
    ),
    serviceContract: coerceToken(
      rawProvider.serviceContract || rawProvider.contractName,
      kind === 'hosted-kernel'
        ? 'artifact-retention.hosted-kernel-provider.v1'
        : 'artifact-retention.external-provider.v1'
    ),
    acceptedPayloadContracts,
    operations,
    unsupportedOperationContracts,
    contractHealth: {
      contract: 'artifact-retention.provider-contract-health.v1',
      ready: enabled && unsupportedOperationContracts.length === 0,
      supportedOperationCount: providerOperationCapabilities
        .filter(capability => operations[capability].supported).length,
      acceptedOperationCount: providerOperationCapabilities
        .filter(capability => operations[capability].supported && operations[capability].accepted).length,
      unsupportedOperationContracts
    },
    syncMode: coerceToken(rawProvider.syncMode || rawProvider.mode, kind === 'hosted-kernel' ? 'in-process' : 'external'),
    acknowledgementTimeoutSeconds: clampPositiveInteger(
      rawProvider.acknowledgementTimeoutSeconds || rawProvider.ackTimeoutSeconds || rawProvider.limits?.acknowledgementTimeoutSeconds,
      kind === 'hosted-kernel' ? 30 : 300
    ),
    priority: clampNonNegativeInteger(rawProvider.priority, index),
    metadata: rawProvider.metadata && typeof rawProvider.metadata === 'object'
      ? rawProvider.metadata
      : {}
  };
}

function chunkValues(values, chunkSize) {
  const size = Math.max(1, clampPositiveInteger(chunkSize, 100));
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function selectProviderForCapability(enabledProviders, capability) {
  return enabledProviders
    .filter(provider => (
      provider.capabilities.includes(capability)
      && provider.operations?.[capability]?.enabled
      && provider.operations?.[capability]?.accepted
    ))
    .sort((left, right) => (
      left.priority - right.priority
      || left.maxBatchSize - right.maxBatchSize
      || left.providerId.localeCompare(right.providerId)
    ))[0] || null;
}

function buildProviderCommandAssignments({
  commands,
  enabledProviders,
  requestState,
  boundaryContext,
  scopeAccessManifest,
  nowDate
}) {
  const scopeByArtifactId = new Map(scopeAccessManifest.workspaceScopes.flatMap(scope => (
    scope.artifactIds.map(artifactId => [artifactId, scope])
  )));
  const commandSpecs = [
    {
      action: 'archive',
      capability: 'archive',
      command: commands.archive,
      artifactIds: commands.archive.artifactIds,
      destructive: false
    },
    {
      action: 'delete',
      capability: 'delete',
      command: commands.delete,
      artifactIds: commands.delete.artifactIds,
      destructive: true
    },
    commands.dryRun.enabled
      ? {
          action: 'dry_run',
          capability: 'sync',
          command: commands.dryRun,
          artifactIds: uniqueTokens([
            ...commands.dryRun.archiveArtifactIds,
            ...commands.dryRun.deleteArtifactIds
          ]),
          destructive: false
        }
      : null,
    commands.retry.enabled
      ? {
          action: 'retry_failed',
          capability: 'sync',
          command: commands.retry,
          artifactIds: commands.retry.artifactIds,
          destructive: false
        }
      : null
  ].filter(Boolean);

  const assignments = commandSpecs.flatMap(spec => {
    const provider = selectProviderForCapability(enabledProviders, spec.capability);
    if (!provider || spec.artifactIds.length === 0) {
      return [];
    }

    return chunkValues(spec.artifactIds, provider.maxBatchSize).map((artifactIds, batchIndex) => {
      const workspaceScopes = uniqueTokens(
        artifactIds
          .map(artifactId => scopeByArtifactId.get(artifactId)?.workspaceId)
          .filter(Boolean)
      );
      const grantIds = uniqueTokens(
        artifactIds.flatMap(artifactId => scopeByArtifactId.get(artifactId)?.grantIds || [])
      );
      const blockedArtifactIds = artifactIds.filter(artifactId => (
        scopeByArtifactId.get(artifactId)?.blockedArtifactIds.includes(artifactId)
      ));
      const operation = provider.operations[spec.capability];
      const deliveryState = blockedArtifactIds.length > 0
        ? 'blocked_by_scope'
        : operation.requiresExternalHandoff
          ? 'handoff_ready'
          : operation.endpoint
            ? 'remote_dispatch_ready'
            : 'hosted_kernel_dispatch_ready';

      return {
        contract: 'artifact-retention.provider-command-assignment.v1',
        assignmentId: buildStableToken([
          'provider-assignment',
          requestState.workflowId,
          provider.providerId,
          spec.command.commandId,
          batchIndex
        ]),
        providerId: provider.providerId,
        providerKind: provider.kind,
        serviceContract: provider.serviceContract,
        operationContract: operation,
        action: spec.action,
        capability: spec.capability,
        commandId: spec.command.commandId,
        commandType: spec.command.type,
        payloadContract: operation.payloadContract,
        responseContract: operation.responseContract,
        artifactIds,
        artifactCount: artifactIds.length,
        destructive: spec.destructive,
        acknowledgementRequired: provider.requiresAcknowledgement,
        acknowledgementTimeoutSeconds: provider.acknowledgementTimeoutSeconds,
        idempotencyKey: buildStableToken([
          commands.idempotencyScope,
          provider.providerId,
          spec.command.commandId,
          batchIndex,
          artifactIds
        ]),
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        workspaceScopes,
        grantIds,
        scopeAccessManifestId: scopeAccessManifest.manifestId,
        boundaryGuard: {
          contract: 'artifact-retention.provider-assignment-boundary-guard.v1',
          scopeToken: boundaryContext.scopeToken,
          blockedArtifactIds,
          dispatchAllowed: blockedArtifactIds.length === 0,
          proofDigest: buildStableToken([
            scopeAccessManifest.manifestId,
            provider.providerId,
            operation.operationId,
            spec.command.commandId,
            artifactIds,
            workspaceScopes,
            grantIds
          ])
        },
        delivery: {
          contract: 'artifact-retention.provider-delivery-state.v1',
          state: deliveryState,
          mode: operation.deliveryMode,
          endpoint: operation.endpoint,
          method: operation.method,
          routeRequired: Boolean(operation.endpoint),
          externalHandoffRequired: operation.requiresExternalHandoff,
          payloadContract: operation.payloadContract,
          responseContract: operation.responseContract
        },
        createdAt: nowDate.toISOString()
      };
    });
  });
  const unassignedCommands = commandSpecs
    .filter(spec => spec.artifactIds.length > 0 && !selectProviderForCapability(enabledProviders, spec.capability))
    .map(spec => ({
      action: spec.action,
      commandId: spec.command.commandId,
      capability: spec.capability,
      artifactIds: spec.artifactIds,
      reason: 'provider_capability_gap'
    }));

  return {
    contract: 'artifact-retention.provider-command-assignments.v1',
    assignmentCount: assignments.length,
    assignedArtifactCount: assignments.reduce((total, assignment) => total + assignment.artifactCount, 0),
    acknowledgementRequired: assignments.some(assignment => assignment.acknowledgementRequired),
    assignments,
    unassignedCommands
  };
}

function collectProviderInputs(input) {
  const configured = input.integrationProviders
    || input.retentionProviders
    || input.providers
    || input.services?.retentionProviders
    || input.services?.artifactRetention
    || [];

  if (Array.isArray(configured)) {
    return configured;
  }

  if (configured && typeof configured === 'object') {
    return Object.values(configured);
  }

  return [];
}

function buildIntegrationProviderContracts({
  input,
  commands,
  lifecycleAction,
  requestState,
  boundaryContext,
  scopeAccessManifest,
  nowDate
}) {
  const rawProviders = collectProviderInputs(input);
  const providers = (rawProviders.length > 0 ? rawProviders : [{ providerId: 'hosted-kernel-retention' }])
    .map((provider, index) => normalizeProviderContract(provider, index))
    .sort((left, right) => left.priority - right.priority || left.providerId.localeCompare(right.providerId));
  const enabledProviders = providers.filter(provider => provider.enabled);
  const findProviders = capability => enabledProviders
    .filter(provider => (
      provider.capabilities.includes(capability)
      && provider.operations?.[capability]?.enabled
      && provider.operations?.[capability]?.accepted
    ))
    .map(provider => provider.providerId);
  const actionCoverage = {
    archive: findProviders('archive'),
    delete: findProviders('delete'),
    proof: findProviders('proof'),
    sync: findProviders('sync'),
    externalHandoff: findProviders('external-handoff')
  };
  const requiredCapabilities = uniqueTokens([
    commands.archive.artifactIds.length > 0 || commands.dryRun.archiveArtifactIds.length > 0 ? 'archive' : null,
    commands.delete.artifactIds.length > 0 || commands.dryRun.deleteArtifactIds.length > 0 ? 'delete' : null,
    commands.delete.artifactIds.length > 0 ? 'proof' : null,
    lifecycleAction.executionAllowed ? 'sync' : null
  ].filter(Boolean));
  const unsupportedCapabilities = requiredCapabilities.filter(capability => (
    actionCoverage[capability]?.length === 0
  ));
  const syncSource = input.syncMetadata || input.providerSync || input.externalSyncState || {};
  const syncCursor = coerceToken(
    syncSource.cursor || syncSource.syncCursor || syncSource.checkpointId,
    buildStableToken(['sync', requestState.workflowId, requestState.trace.correlationId])
  );
  const externalProviderIds = enabledProviders
    .filter(provider => provider.kind !== 'hosted-kernel' || provider.endpoint)
    .map(provider => provider.providerId);
  const handoffProviderIds = uniqueTokens([
    ...externalProviderIds,
    ...actionCoverage.externalHandoff
  ]);
  const dispatchable = lifecycleAction.executionAllowed && unsupportedCapabilities.length === 0;
  const commandAssignments = buildProviderCommandAssignments({
    commands,
    enabledProviders,
    requestState,
    boundaryContext,
    scopeAccessManifest,
    nowDate
  });
  const assignmentProviderIds = uniqueTokens(commandAssignments.assignments.map(assignment => assignment.providerId));
  const externalDeliveryAssignments = commandAssignments.assignments.filter(assignment => (
    assignment.delivery.externalHandoffRequired || assignment.delivery.routeRequired
  ));
  const providerContractIssues = providers.flatMap(provider => (
    provider.unsupportedOperationContracts.map(capability => ({
      contract: 'artifact-retention.provider-contract-issue.v1',
      providerId: provider.providerId,
      capability,
      operationId: provider.operations[capability].operationId,
      payloadContract: provider.operations[capability].payloadContract,
      reason: provider.operations[capability].accepted
        ? 'operation_disabled'
        : 'payload_contract_not_accepted'
    }))
  ));
  const acknowledgementDeadlineAt = commandAssignments.acknowledgementRequired
    ? minutesFrom(nowDate.toISOString(), Math.ceil(Math.max(
        ...commandAssignments.assignments.map(assignment => assignment.acknowledgementTimeoutSeconds),
        0
      ) / 60)).toISOString()
    : null;

  return {
    contract: 'artifact-retention.integration-providers.v1',
    providers,
    negotiation: {
      requiredCapabilities,
      unsupportedCapabilities,
      providerContractIssues,
      dispatchable: dispatchable && commandAssignments.unassignedCommands.length === 0,
      actionCoverage,
      selectedProviderIds: uniqueTokens([
        ...requiredCapabilities.flatMap(capability => actionCoverage[capability] || []),
        ...assignmentProviderIds
      ]),
      assignmentCoverage: {
        assigned: commandAssignments.unassignedCommands.length === 0,
        assignmentCount: commandAssignments.assignmentCount,
        assignedArtifactCount: commandAssignments.assignedArtifactCount,
        unassignedCommandCount: commandAssignments.unassignedCommands.length,
        externalDeliveryAssignmentCount: externalDeliveryAssignments.length
      }
    },
    commandAssignments,
    syncMetadata: {
      contract: 'artifact-retention.provider-sync.v1',
      cursor: syncCursor,
      observedAt: nowDate.toISOString(),
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      workflowId: requestState.workflowId,
      scopeAccessManifestId: scopeAccessManifest.manifestId,
      scopeDeniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
      lastSyncedAt: syncSource.lastSyncedAt
        ? coerceDate(syncSource.lastSyncedAt, nowDate).toISOString()
        : null,
      providerCount: providers.length,
      enabledProviderCount: enabledProviders.length,
      pendingCommandCount: commands.pendingArtifactIds.length,
      plannedArtifactIds: commands.plannedArtifactIds,
      assignmentCount: commandAssignments.assignmentCount,
      assignmentProviderIds,
      providerContractIssueCount: providerContractIssues.length,
      providerContracts: providers.map(provider => ({
        providerId: provider.providerId,
        serviceContract: provider.serviceContract,
        ready: provider.contractHealth.ready,
        capabilities: provider.capabilities,
        unsupportedOperationContracts: provider.unsupportedOperationContracts
      })),
      nextCheckpoint: {
        contract: 'artifact-retention.provider-sync-checkpoint.v1',
        checkpointId: buildStableToken(['provider-sync-checkpoint', requestState.workflowId, syncCursor]),
        cursor: syncCursor,
        assignmentIds: commandAssignments.assignments.map(assignment => assignment.assignmentId),
        unassignedCommandIds: commandAssignments.unassignedCommands.map(command => command.commandId),
        externalDeliveryAssignmentIds: externalDeliveryAssignments.map(assignment => assignment.assignmentId),
        acknowledgementDeadlineAt,
        state: commandAssignments.unassignedCommands.length > 0
          ? 'blocked'
          : commandAssignments.assignmentCount > 0
            ? 'ready_to_sync'
            : 'idle'
      }
    },
    externalHandoff: {
      contract: 'artifact-retention.external-handoff-state.v1',
      enabled: dispatchable && handoffProviderIds.length > 0 && commandAssignments.unassignedCommands.length === 0,
      providerIds: handoffProviderIds,
      state: dispatchable && commandAssignments.unassignedCommands.length === 0
        ? handoffProviderIds.length > 0 ? 'handoff_ready' : 'hosted_kernel_only'
        : unsupportedCapabilities.length > 0 || commandAssignments.unassignedCommands.length > 0 ? 'capability_gap' : 'not_dispatchable',
      envelopeId: buildStableToken(['handoff', requestState.workflowId, requestState.trace.correlationId]),
      acknowledgementRequired: commandAssignments.acknowledgementRequired,
      acknowledgementDeadlineAt,
      assignmentIds: commandAssignments.assignments.map(assignment => assignment.assignmentId),
      deliveryAssignments: externalDeliveryAssignments.map(assignment => ({
        assignmentId: assignment.assignmentId,
        providerId: assignment.providerId,
        operationId: assignment.operationContract.operationId,
        state: assignment.delivery.state,
        mode: assignment.delivery.mode,
        endpoint: assignment.delivery.endpoint,
        method: assignment.delivery.method,
        payloadContract: assignment.payloadContract,
        artifactCount: assignment.artifactCount
      })),
      unassignedCommands: commandAssignments.unassignedCommands,
      commandIds: lifecycleAction.commandIds,
      idempotencyScope: commands.idempotencyScope,
      scopeAccessManifestId: scopeAccessManifest.manifestId,
      scopeAuditHandoff: scopeAccessManifest.auditHandoff
    }
  };
}

function buildNextSteps({ accepted, validationSummary, summary, policy, requestState, operationalHealth, lifecycleAction, lifecycleSettingsControls, integrationProviderContracts }) {
  if (!validationSummary.ok) {
    return [{
      id: 'fix-validation-errors',
      label: 'Resolve retention validation errors',
      status: 'blocked',
      reason: validationSummary.errors[0]?.code || 'validation_failed',
      workflowId: requestState.workflowId
    }];
  }

  if (lifecycleSettingsControls.status === 'ready_to_apply') {
    return [{
      id: 'apply-retention-lifecycle-settings',
      label: 'Apply artifact retention lifecycle settings',
      status: 'ready',
      reason: lifecycleSettingsControls.command.action,
      workflowId: requestState.workflowId,
      commandId: lifecycleSettingsControls.command.commandId
    }];
  }

  if (operationalHealth.status === 'blocked') {
    return [{
      id: 'repair-retention-failures',
      label: 'Repair failed retention actions',
      status: 'blocked',
      reason: operationalHealth.actionableErrors[0]?.code || 'retention_failure_blocked',
      workflowId: requestState.workflowId
    }];
  }

  if (operationalHealth.degradedMode.enabled) {
    return [{
      id: 'wait-for-retention-retry',
      label: 'Wait for retention retry backoff',
      status: 'blocked',
      reason: operationalHealth.degradedMode.reason,
      workflowId: requestState.workflowId
    }];
  }

  if (lifecycleAction.status === 'lifecycle_disabled') {
    return [{
      id: 'enable-retention-lifecycle',
      label: 'Enable artifact retention lifecycle',
      status: 'required',
      reason: 'lifecycle_disabled',
      workflowId: requestState.workflowId
    }];
  }

  if (lifecycleAction.status === 'lifecycle_paused') {
    return [{
      id: 'resume-retention-lifecycle',
      label: 'Resume artifact retention lifecycle',
      status: 'blocked',
      reason: 'lifecycle_paused',
      workflowId: requestState.workflowId,
      resumeAfter: lifecycleAction.schedule.pauseUntil
    }];
  }

  if (lifecycleAction.status === 'schedule_not_due') {
    return [{
      id: 'wait-for-retention-schedule',
      label: 'Wait for next artifact retention schedule',
      status: 'scheduled',
      reason: 'schedule_not_due',
      workflowId: requestState.workflowId,
      scheduledAt: lifecycleAction.schedule.nextRunAt
    }];
  }

  if (lifecycleAction.status === 'dry_run_enabled') {
    return [{
      id: 'run-retention-dry-run',
      label: 'Run artifact retention dry run',
      status: 'ready',
      reason: 'dry_run_enabled',
      workflowId: requestState.workflowId
    }];
  }

  if (lifecycleAction.status === 'archive_execution_disabled' || lifecycleAction.status === 'delete_execution_disabled') {
    return [{
      id: 'update-retention-execution-controls',
      label: 'Update artifact retention execution controls',
      status: 'required',
      reason: lifecycleAction.status,
      workflowId: requestState.workflowId
    }];
  }

  if (
    integrationProviderContracts?.negotiation?.unsupportedCapabilities?.length > 0
    && (summary.byAction.archive > 0 || summary.byAction.delete > 0)
  ) {
    return [{
      id: 'configure-retention-provider',
      label: 'Configure artifact retention provider capabilities',
      status: 'blocked',
      reason: 'provider_capability_gap',
      workflowId: requestState.workflowId,
      missingCapabilities: integrationProviderContracts.negotiation.unsupportedCapabilities
    }];
  }

  if (summary.destructiveItems > 0 && policy.requireAcceptanceForDelete && !accepted) {
    if (!requestState.clientRuntime.featureGates.destructiveAcceptance) {
      return [{
        id: 'open-retention-acceptance-handoff',
        label: 'Open artifact retention acceptance handoff',
        status: 'required',
        reason: 'client_cannot_accept_destructive_preview',
        workflowId: requestState.workflowId,
        handoffMode: requestState.clientRuntime.handoffMode,
        returnTo: requestState.clientRuntime.returnTo
      }];
    }

    return [{
      id: 'accept-retention-preview',
      label: 'Review and accept destructive retention preview',
      status: 'required',
      reason: 'delete_candidates_require_user_acceptance',
      workflowId: requestState.workflowId
    }];
  }

  if (summary.byAction.archive > 0 || summary.byAction.delete > 0) {
    if (!requestState.clientRuntime.featureGates.dispatchIntent) {
      return [{
        id: 'open-retention-dispatch-handoff',
        label: 'Open artifact retention dispatch handoff',
        status: 'ready',
        reason: 'client_cannot_dispatch_retention_intent',
        workflowId: requestState.workflowId,
        handoffMode: requestState.clientRuntime.handoffMode,
        returnTo: requestState.clientRuntime.returnTo
      }];
    }

    return [{
      id: 'dispatch-retention-job',
      label: 'Dispatch artifact retention job',
      status: 'ready',
      reason: 'preview_ready_for_execution',
      workflowId: requestState.workflowId
    }];
  }

  return [{
    id: 'no-op-retention',
    label: 'No retention work required',
    status: 'complete',
    reason: 'all_artifacts_within_policy',
    workflowId: requestState.workflowId
  }];
}

function buildWorkflowHandoff({
  readiness,
  nextSteps,
  acceptance,
  summary,
  previewItems,
  requestState,
  boundaryContext,
  commands,
  recoveryState,
  operationalHealth,
  lifecycleAction,
  integrationProviderContracts
}) {
  const primaryStep = nextSteps[0] || {
    id: 'artifact-retention-idle',
    label: 'Artifact retention preview',
    status: readiness,
    reason: 'preview_state_unavailable'
  };
  const archiveIds = previewItems
    .filter(item => item.action === 'archive')
    .map(item => item.artifact.id);
  const deleteIds = previewItems
    .filter(item => item.action === 'delete')
    .map(item => item.artifact.id);
  const providerDispatchable = integrationProviderContracts?.negotiation?.dispatchable !== false;
  const clientRuntime = requestState.clientRuntime;
  const clientCanDispatch = clientRuntime.featureGates.dispatchIntent;
  const clientCanAccept = clientRuntime.featureGates.destructiveAcceptance;
  const providerHandoffReady = integrationProviderContracts?.externalHandoff?.enabled === true;
  const dispatchable = operationalHealth.executionAllowed
    && lifecycleAction.executionAllowed
    && providerDispatchable
    && clientCanDispatch;
  const handoffDispatchable = operationalHealth.executionAllowed
    && lifecycleAction.executionAllowed
    && providerDispatchable
    && !clientCanDispatch
    && providerHandoffReady;
  const acceptanceHandoffRequired = acceptance.required && !acceptance.accepted && !clientCanAccept;
  const userVisibleMode = acceptanceHandoffRequired
    ? 'acceptance_handoff_required'
    : dispatchable
      ? 'client_dispatch_ready'
      : handoffDispatchable
        ? 'provider_handoff_ready'
        : clientRuntime.handoffMode === 'return' && clientRuntime.returnTo
          ? 'return_to_client'
          : primaryStep.status;
  const clientDisabledReason = !clientRuntime.featureGates.preview
    ? 'client_preview_contract_missing'
    : acceptanceHandoffRequired
      ? 'client_cannot_accept_destructive_preview'
      : !clientCanDispatch && (archiveIds.length > 0 || deleteIds.length > 0)
        ? 'client_cannot_dispatch_retention_intent'
        : null;

  return {
    contract: 'artifact-retention.workflow-handoff.v1',
    workflowId: requestState.workflowId,
    requestId: requestState.requestId,
    clientId: requestState.clientId,
    sessionId: requestState.sessionId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    status: readiness,
    userVisibleStatus: primaryStep.label,
    requiredAction: primaryStep.status === 'required' ? primaryStep.id : null,
    blockedReason: primaryStep.status === 'blocked' ? primaryStep.reason : null,
    returnTo: requestState.returnTo,
    clientRuntime,
    userVisibleHandoff: {
      contract: 'artifact-retention.user-visible-handoff.v1',
      mode: userVisibleMode,
      visibleToClient: clientRuntime.featureGates.preview,
      handoffMode: clientRuntime.handoffMode,
      channel: clientRuntime.channel,
      returnTo: clientRuntime.returnTo,
      disabledReason: clientDisabledReason,
      acceptance: {
        required: acceptance.required,
        accepted: acceptance.accepted,
        enabledInClient: clientCanAccept,
        route: clientRuntime.routeHints.resumeRoute
      },
      dispatch: {
        enabledInClient: clientCanDispatch,
        enabledThroughProvider: handoffDispatchable,
        route: clientRuntime.routeHints.dispatchRoute,
        commandIds: lifecycleAction.commandIds,
        idempotencyScope: commands.idempotencyScope
      },
      proof: {
        enabledInClient: clientRuntime.featureGates.auditProof,
        route: clientRuntime.routeHints.proofRoute,
        scopeToken: boundaryContext.scopeToken
      }
    },
    transition: {
      nextStepId: primaryStep.id,
      nextStepStatus: primaryStep.status,
      dispatchable,
      handoffDispatchable,
      acceptanceRequired: acceptance.required,
      acceptanceSatisfied: acceptance.accepted,
      operationalStatus: operationalHealth.status,
      lifecycleStatus: lifecycleAction.status,
      providerStatus: providerDispatchable ? 'ready' : 'capability_gap',
      clientStatus: clientDisabledReason ? 'handoff_required' : 'ready'
    },
    dispatchIntent: {
      type: commands.dryRun.enabled ? commands.dryRun.type : 'artifact_retention.execute',
      enabled: dispatchable,
      disabledReason: dispatchable
        ? null
        : clientDisabledReason || (
            integrationProviderContracts?.negotiation?.unsupportedCapabilities?.length > 0
              ? 'provider_capability_gap'
              : lifecycleAction.disabledReason || operationalHealth.actionableErrors[0]?.code || primaryStep.reason || null
          ),
      handoffEnabled: handoffDispatchable,
      handoffMode: clientRuntime.handoffMode,
      archiveArtifactIds: commands.archive.artifactIds,
      deleteArtifactIds: commands.delete.artifactIds,
      dryRunArchiveArtifactIds: commands.dryRun.archiveArtifactIds,
      dryRunDeleteArtifactIds: commands.dryRun.deleteArtifactIds,
      plannedArchiveArtifactIds: archiveIds,
      plannedDeleteArtifactIds: deleteIds,
      destructiveArtifactIds: acceptance.destructiveArtifactIds,
      commandIds: lifecycleAction.commandIds,
      idempotencyScope: commands.idempotencyScope,
      restartSafeStatus: recoveryState.restartSafeStatus,
      pendingArtifactIds: recoveryState.pendingArtifactIds,
      candidateCount: summary.totalItems,
      destructiveCount: summary.destructiveItems,
      boundaryBlockedCount: summary.boundaryBlockedItems,
      delegatedWorkspaceCount: summary.delegatedWorkspaceItems,
      permissionBlockedCount: summary.permissionBlockedItems,
      scopeToken: boundaryContext.scopeToken,
      workspaceIsolation: boundaryContext.isolation,
      lifecycle: lifecycleAction,
      providerNegotiation: integrationProviderContracts?.negotiation || null,
      externalHandoff: integrationProviderContracts?.externalHandoff || null
    },
    operationalHealth
  };
}

function buildClientPreviewAcceptanceContract({
  readiness,
  summary,
  previewItems,
  validationSummary,
  acceptance,
  nextSteps,
  workflowHandoff,
  requestState,
  boundaryContext,
  policy,
  lifecycleAction,
  lifecycleSettingsControls,
  operationalHealth,
  integrationProviderContracts,
  nowDate
}) {
  const primaryStep = nextSteps[0] || {
    id: 'artifact-retention-idle',
    label: 'Artifact retention preview',
    status: 'complete',
    reason: 'preview_state_unavailable'
  };
  const routeHints = requestState.clientRuntime.routeHints;
  const destructivePreviewRows = previewItems
    .filter(item => item.destructive || item.blocked)
    .map(item => ({
      artifactId: item.artifact.id,
      path: item.artifact.path,
      action: item.action,
      reason: item.reason,
      classification: item.artifact.classification,
      sizeBytes: item.artifact.sizeBytes,
      idleDays: item.artifact.idleDays,
      destructive: item.destructive,
      blocked: item.blocked,
      blockedReason: item.blockedReason,
      proofRefCount: item.artifact.proofRefs.length,
      scope: item.artifact.scope
    }));
  const readinessGates = [
    {
      id: 'validation',
      label: 'Validation',
      status: validationSummary.ok ? 'passed' : 'blocked',
      blocking: !validationSummary.ok,
      count: validationSummary.errors.length,
      route: routeHints.resumeRoute
    },
    {
      id: 'acceptance',
      label: 'Destructive acceptance',
      status: !acceptance.required ? 'not_required' : acceptance.accepted ? 'accepted' : 'required',
      blocking: acceptance.required && !acceptance.accepted,
      count: acceptance.destructiveArtifactIds.length,
      route: routeHints.resumeRoute
    },
    {
      id: 'lifecycle',
      label: 'Lifecycle dispatch',
      status: lifecycleAction.executionAllowed ? 'ready' : lifecycleAction.status,
      blocking: summary.byAction.archive + summary.byAction.delete > 0 && !lifecycleAction.executionAllowed,
      count: lifecycleAction.plannedWork.archiveCount + lifecycleAction.plannedWork.deleteCount,
      route: routeHints.dispatchRoute
    },
    {
      id: 'provider',
      label: 'Provider capability',
      status: integrationProviderContracts.negotiation.dispatchable ? 'ready' : 'capability_gap',
      blocking: integrationProviderContracts.negotiation.unsupportedCapabilities.length > 0,
      count: integrationProviderContracts.negotiation.unsupportedCapabilities.length,
      route: routeHints.dispatchRoute
    },
    {
      id: 'settings',
      label: 'Lifecycle settings',
      status: lifecycleSettingsControls.validation.ok ? lifecycleSettingsControls.status : 'blocked',
      blocking: !lifecycleSettingsControls.validation.ok,
      count: lifecycleSettingsControls.validation.errors.length,
      route: routeHints.dispatchRoute
    },
    {
      id: 'operations',
      label: 'Operational health',
      status: operationalHealth.status,
      blocking: !operationalHealth.executionAllowed && operationalHealth.status !== 'pending',
      count: operationalHealth.actionableErrors.length,
      route: routeHints.proofRoute
    }
  ];
  const blockedGateIds = readinessGates.filter(gate => gate.blocking).map(gate => gate.id);
  const nextStepPayloads = nextSteps.map(step => ({
    ...step,
    contract: 'artifact-retention.explainable-next-step.v1',
    routeIntent: step.id.includes('accept') || step.id.includes('handoff')
      ? 'acceptance'
      : step.id.includes('dispatch') || step.id.includes('dry-run')
        ? 'dispatch'
        : step.id.includes('validation') || step.id.includes('repair')
          ? 'validation'
          : 'review',
    enabled: !['blocked'].includes(step.status),
    blockedByGateIds: blockedGateIds,
    route: step.id.includes('dispatch') || step.id.includes('dry-run')
      ? routeHints.dispatchRoute
      : step.id.includes('accept') || step.id.includes('handoff')
        ? routeHints.resumeRoute
        : routeHints.proofRoute || routeHints.resumeRoute,
    evidence: {
      reason: step.reason,
      validationErrorCount: validationSummary.errors.length,
      validationWarningCount: validationSummary.warnings.length,
      destructiveCount: summary.destructiveItems,
      lifecycleSettingsStatus: lifecycleSettingsControls.status,
      lifecycleSettingsAction: lifecycleSettingsControls.command.action,
      unsupportedCapabilities: integrationProviderContracts.negotiation.unsupportedCapabilities
    }
  }));
  const acceptedAt = acceptance.acceptedAt
    ? coerceDate(acceptance.acceptedAt, nowDate).toISOString()
    : null;

  return {
    contract: 'artifact-retention.client-preview-acceptance.v1',
    generatedAt: nowDate.toISOString(),
    workflowId: requestState.workflowId,
    requestId: requestState.requestId,
    clientId: requestState.clientId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    renderable: requestState.clientRuntime.featureGates.preview,
    readiness: {
      status: readiness,
      userVisibleStatus: workflowHandoff.userVisibleStatus,
      blockedGateIds,
      gates: readinessGates
    },
    validation: {
      ok: validationSummary.ok,
      errorCount: validationSummary.errors.length,
      warningCount: validationSummary.warnings.length,
      errors: validationSummary.errors,
      warnings: validationSummary.warnings
    },
    acceptance: {
      required: acceptance.required,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt,
      enabledInClient: requestState.clientRuntime.featureGates.destructiveAcceptance,
      destructiveArtifactIds: acceptance.destructiveArtifactIds,
      disabledReason: acceptance.required && !requestState.clientRuntime.featureGates.destructiveAcceptance
        ? 'client_cannot_accept_destructive_preview'
        : null,
      route: routeHints.resumeRoute,
      policy: {
        requireAcceptanceForDelete: policy.requireAcceptanceForDelete,
        minProofsRequired: policy.minProofsRequired
      }
    },
    previewSummary: {
      totalItems: summary.totalItems,
      totalBytes: summary.totalBytes,
      archiveItems: summary.byAction.archive,
      deleteItems: summary.byAction.delete,
      reviewItems: summary.byAction.review,
      retainItems: summary.byAction.retain,
      destructiveItems: summary.destructiveItems,
      destructiveBytes: summary.destructiveBytes,
      boundaryBlockedItems: summary.boundaryBlockedItems,
      delegatedWorkspaceItems: summary.delegatedWorkspaceItems,
      permissionBlockedItems: summary.permissionBlockedItems
    },
    focusRows: destructivePreviewRows,
    nextSteps: nextStepPayloads,
    routes: {
      resume: routeHints.resumeRoute,
      dispatch: routeHints.dispatchRoute,
      proof: routeHints.proofRoute,
      returnTo: requestState.clientRuntime.returnTo
    },
    dispatchIntent: {
      enabled: workflowHandoff.dispatchIntent.enabled,
      disabledReason: workflowHandoff.dispatchIntent.disabledReason,
      handoffEnabled: workflowHandoff.dispatchIntent.handoffEnabled,
      commandIds: workflowHandoff.dispatchIntent.commandIds,
      idempotencyScope: workflowHandoff.dispatchIntent.idempotencyScope
    },
    lifecycleSettingsControls
  };
}

function buildClientRouteContracts({
  readiness,
  summary,
  previewItems,
  validationSummary,
  acceptance,
  nextSteps,
  workflowHandoff,
  clientPreviewAcceptance,
  requestState,
  boundaryContext,
  commands,
  hostedKernelDispatch,
  nowDate
}) {
  const routeHints = requestState.clientRuntime.routeHints;
  const primaryStep = clientPreviewAcceptance.nextSteps[0] || {
    id: 'no-op-retention',
    label: 'No retention work required',
    status: 'complete',
    reason: 'all_artifacts_within_policy',
    route: routeHints.resumeRoute
  };
  const destructiveRows = previewItems.filter(item => item.destructive);
  const blockedRows = previewItems.filter(item => item.blocked);
  const visibleRows = previewItems
    .filter(item => item.action !== 'retain' || item.blocked)
    .slice(0, 25)
    .map(item => ({
      contract: 'artifact-retention.route-preview-row.v1',
      rowId: buildStableToken(['row', requestState.workflowId, item.artifact.id]),
      artifactId: item.artifact.id,
      path: item.artifact.path,
      action: item.action,
      reason: item.reason,
      classification: item.artifact.classification,
      sizeBytes: item.artifact.sizeBytes,
      idleDays: item.artifact.idleDays,
      destructive: item.destructive,
      blocked: item.blocked,
      blockedReason: item.blockedReason,
      proofReady: item.artifact.proofRefs.length > 0,
      workspaceId: item.artifact.workspaceId
    }));
  const acceptanceToken = buildStableToken([
    'acceptance',
    requestState.workflowId,
    commands.idempotencyScope,
    acceptance.destructiveArtifactIds
  ]);
  const validationBanner = !validationSummary.ok
    ? {
        tone: 'error',
        title: 'Retention preview is blocked',
        detail: validationSummary.errors[0]?.message || 'Resolve validation errors before dispatch.'
      }
    : validationSummary.warnings.length > 0
      ? {
          tone: 'warning',
          title: 'Retention preview has warnings',
          detail: validationSummary.warnings[0].message
        }
      : {
          tone: 'success',
          title: 'Retention preview is ready',
          detail: acceptance.required && !acceptance.accepted
            ? 'Destructive candidates need acceptance before dispatch.'
            : 'Preview validation passed.'
        };
  const actionItems = nextSteps.map(step => ({
    contract: 'artifact-retention.route-action.v1',
    actionId: step.id,
    label: step.label,
    status: step.status,
    reason: step.reason,
    route: step.id.includes('dispatch')
      ? routeHints.dispatchRoute
      : step.id.includes('accept') || step.id.includes('handoff')
        ? routeHints.resumeRoute
        : routeHints.proofRoute || routeHints.resumeRoute,
    method: step.id.includes('dispatch') || step.id.includes('accept') || step.id.includes('apply')
      ? 'POST'
      : 'GET',
    enabled: step.status === 'ready' || step.status === 'required',
    commandId: step.commandId || null,
    workflowId: requestState.workflowId
  }));

  return {
    contract: 'artifact-retention.client-route-contracts.v1',
    generatedAt: nowDate.toISOString(),
    workflowId: requestState.workflowId,
    requestId: requestState.requestId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    routes: {
      preview: routeHints.requestRoute || routeHints.resumeRoute,
      resume: routeHints.resumeRoute,
      acceptance: routeHints.resumeRoute,
      dispatch: routeHints.dispatchRoute,
      proof: routeHints.proofRoute,
      returnTo: requestState.clientRuntime.returnTo
    },
    readinessBadge: {
      status: readiness,
      tone: validationBanner.tone,
      label: workflowHandoff.userVisibleStatus,
      blockedGateIds: clientPreviewAcceptance.readiness.blockedGateIds
    },
    validationBanner,
    previewTable: {
      contract: 'artifact-retention.route-preview-table.v1',
      rowCount: visibleRows.length,
      totalCandidateCount: summary.totalItems,
      destructiveCount: summary.destructiveItems,
      blockedCount: blockedRows.length,
      rows: visibleRows
    },
    acceptanceForm: {
      contract: 'artifact-retention.acceptance-form.v1',
      required: acceptance.required,
      accepted: acceptance.accepted,
      enabled: acceptance.required
        && !acceptance.accepted
        && validationSummary.ok
        && requestState.clientRuntime.featureGates.destructiveAcceptance,
      disabledReason: !acceptance.required
        ? 'acceptance_not_required'
        : acceptance.accepted
          ? 'already_accepted'
          : !validationSummary.ok
            ? 'validation_failed'
            : !requestState.clientRuntime.featureGates.destructiveAcceptance
              ? 'client_cannot_accept_destructive_preview'
              : null,
      method: 'POST',
      route: routeHints.resumeRoute,
      payloadContract: 'artifact-retention.acceptance-command.v1',
      payloadTemplate: {
        workflowId: requestState.workflowId,
        requestId: requestState.requestId,
        acceptanceToken,
        accepted: true,
        acceptedArtifactIds: acceptance.destructiveArtifactIds,
        idempotencyKey: buildStableToken([commands.idempotencyScope, 'acceptance', acceptanceToken])
      },
      destructiveRows: destructiveRows.map(item => ({
        artifactId: item.artifact.id,
        path: item.artifact.path,
        reason: item.reason,
        sizeBytes: item.artifact.sizeBytes,
        proofRefCount: item.artifact.proofRefs.length
      }))
    },
    primaryAction: actionItems[0] || {
      contract: 'artifact-retention.route-action.v1',
      actionId: primaryStep.id,
      label: primaryStep.label,
      status: primaryStep.status,
      reason: primaryStep.reason,
      route: primaryStep.route,
      method: 'GET',
      enabled: false,
      commandId: null,
      workflowId: requestState.workflowId
    },
    actions: actionItems,
    proofLinks: {
      auditProofId: hostedKernelDispatch.proofOutputs.auditProofId,
      dispatchReceiptId: hostedKernelDispatch.proofOutputs.dispatchReceiptId,
      acceptanceReceiptId: hostedKernelDispatch.proofOutputs.acceptanceReceiptId,
      route: routeHints.proofRoute,
      scopeToken: boundaryContext.scopeToken
    }
  };
}

function buildClientRuntimeStateEnvelope({
  readiness,
  requestState,
  boundaryContext,
  clientPreviewAcceptance,
  clientRouteContracts,
  workflowHandoff,
  hostedKernelDispatch,
  analyticsReporting,
  recoveryState,
  operationalHealth,
  nowDate
}) {
  const routeHints = requestState.clientRuntime.routeHints;
  const blockedGateIds = clientPreviewAcceptance.readiness.blockedGateIds;
  const primaryAction = clientRouteContracts.primaryAction;
  const proofOutputs = hostedKernelDispatch.proofOutputs;
  const resumeReason = blockedGateIds[0]
    || workflowHandoff.dispatchIntent.disabledReason
    || primaryAction.reason
    || readiness;
  const handoffTarget = workflowHandoff.userVisibleHandoff.mode === 'provider_handoff_ready'
    ? routeHints.dispatchRoute
    : workflowHandoff.userVisibleHandoff.mode === 'acceptance_handoff_required'
      ? routeHints.resumeRoute
      : requestState.clientRuntime.returnTo || routeHints.resumeRoute || routeHints.dispatchRoute;
  const runtimeStatus = hostedKernelDispatch.dispatchable
    ? 'dispatch_ready'
    : blockedGateIds.length > 0
      ? 'blocked'
      : clientPreviewAcceptance.acceptance.required && !clientPreviewAcceptance.acceptance.accepted
        ? 'awaiting_acceptance'
        : primaryAction.status === 'scheduled'
          ? 'scheduled'
          : recoveryState.pendingArtifactIds.length > 0
            ? 'resumable'
            : readiness;
  const resumable = recoveryState.pendingArtifactIds.length > 0
    || operationalHealth.retryPlan.retryDueArtifactIds.length > 0
    || hostedKernelDispatch.status === 'blocked';
  const clientStatePatch = {
    contract: 'artifact-retention.client-state-patch.v1',
    requestId: requestState.requestId,
    workflowId: requestState.workflowId,
    sessionId: requestState.sessionId,
    status: runtimeStatus,
    readiness,
    route: handoffTarget,
    resumeReason,
    primaryActionId: primaryAction.actionId,
    primaryActionStatus: primaryAction.status,
    pendingArtifactIds: recoveryState.pendingArtifactIds,
    blockedGateIds,
    dispatchable: hostedKernelDispatch.dispatchable,
    auditProofId: proofOutputs.auditProofId,
    dispatchReceiptId: proofOutputs.dispatchReceiptId,
    analyticsExportId: analyticsReporting.exportSummary.exportId,
    updatedAt: nowDate.toISOString()
  };

  return {
    contract: 'artifact-retention.client-runtime-state.v1',
    generatedAt: nowDate.toISOString(),
    requestId: requestState.requestId,
    workflowId: requestState.workflowId,
    clientId: requestState.clientId,
    sessionId: requestState.sessionId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    status: runtimeStatus,
    resumable,
    resumeReason,
    handoffTarget,
    routeState: {
      previewRoute: clientRouteContracts.routes.preview,
      resumeRoute: clientRouteContracts.routes.resume,
      dispatchRoute: clientRouteContracts.routes.dispatch,
      proofRoute: clientRouteContracts.routes.proof,
      returnTo: clientRouteContracts.routes.returnTo,
      handoffMode: requestState.clientRuntime.handoffMode,
      userVisibleMode: workflowHandoff.userVisibleHandoff.mode
    },
    activeAction: {
      actionId: primaryAction.actionId,
      label: primaryAction.label,
      status: primaryAction.status,
      reason: primaryAction.reason,
      enabled: primaryAction.enabled,
      method: primaryAction.method,
      route: primaryAction.route,
      commandId: primaryAction.commandId
    },
    clientStatePatch,
    proofState: {
      contract: 'artifact-retention.client-proof-state.v1',
      enabledInClient: requestState.clientRuntime.featureGates.auditProof,
      route: clientRouteContracts.routes.proof,
      auditProofId: proofOutputs.auditProofId,
      dispatchReceiptId: proofOutputs.dispatchReceiptId,
      acceptanceReceiptId: proofOutputs.acceptanceReceiptId,
      retryReceiptId: proofOutputs.retryReceiptId,
      checkpointId: proofOutputs.checkpointId,
      exportId: analyticsReporting.exportSummary.exportId,
      latestTimelineEventId: analyticsReporting.reportingState.latestTimelineEventId
    },
    persistenceHints: {
      contract: 'artifact-retention.client-runtime-persistence-hints.v1',
      persistClientState: true,
      checkpointStatus: recoveryState.checkpointToPersist.status,
      nextRuntimeStatus: recoveryState.nextRuntimeStatus,
      restartSafeStatus: recoveryState.restartSafeStatus,
      recoveryLeaseStatus: recoveryState.leaseState.status,
      recoveryCommandStatus: recoveryState.recoveryCommand.status,
      replayIntentCount: recoveryState.replayIntents.length,
      idempotencyScope: recoveryState.idempotencyScope,
      scopeToken: boundaryContext.scopeToken
    }
  };
}

function buildHostedKernelDispatchPlan({
  readiness,
  acceptance,
  summary,
  validationSummary,
  workflowHandoff,
  requestState,
  boundaryContext,
  scopeAccessManifest,
  commands,
  lifecycleAction,
  lifecycleSettingsControls,
  integrationProviderContracts,
  operationalHealth,
  analyticsReporting,
  nowDate
}) {
  const providerNegotiation = integrationProviderContracts.negotiation;
  const routeHints = requestState.clientRuntime.routeHints;
  const retryDispatchArtifactIds = operationalHealth.retryCommand.dispatchableArtifactIds;
  const dispatchCommandIds = lifecycleAction.commandIds.filter(commandId => (
    commandId !== commands.lifecycle.commandId
  ));
  const allDispatchCommandIds = uniqueTokens([
    ...dispatchCommandIds,
    retryDispatchArtifactIds.length > 0 ? commands.retry.commandId : null
  ].filter(Boolean));
  const hasExecutableCommand = dispatchCommandIds.length > 0
    || commands.dryRun.enabled
    || retryDispatchArtifactIds.length > 0;
  const destructiveAccepted = !acceptance.required || acceptance.accepted;
  const gates = [
    {
      id: 'validation',
      status: validationSummary.ok ? 'passed' : 'blocked',
      blocking: !validationSummary.ok,
      reason: validationSummary.errors[0]?.code || null
    },
    {
      id: 'destructive_acceptance',
      status: destructiveAccepted ? 'passed' : 'blocked',
      blocking: !destructiveAccepted,
      reason: destructiveAccepted ? null : 'destructive_preview_not_accepted'
    },
    {
      id: 'lifecycle_execution',
      status: lifecycleAction.executionAllowed ? 'passed' : 'blocked',
      blocking: !lifecycleAction.executionAllowed && hasExecutableCommand,
      reason: lifecycleAction.executionAllowed ? null : lifecycleAction.disabledReason || lifecycleAction.status
    },
    {
      id: 'lifecycle_settings',
      status: lifecycleSettingsControls.validation.ok ? 'passed' : 'blocked',
      blocking: !lifecycleSettingsControls.validation.ok,
      reason: lifecycleSettingsControls.validation.errors[0]?.code || null
    },
    {
      id: 'provider_capability',
      status: providerNegotiation.dispatchable ? 'passed' : 'blocked',
      blocking: !providerNegotiation.dispatchable,
      reason: providerNegotiation.unsupportedCapabilities.length > 0
        ? 'provider_capability_gap'
        : null
    },
    {
      id: 'operational_health',
      status: operationalHealth.executionAllowed ? 'passed' : operationalHealth.status,
      blocking: !operationalHealth.executionAllowed && operationalHealth.status !== 'pending',
      reason: operationalHealth.actionableErrors[0]?.code || null
    },
    {
      id: 'client_dispatch_contract',
      status: requestState.clientRuntime.featureGates.dispatchIntent ? 'passed' : 'handoff',
      blocking: false,
      reason: requestState.clientRuntime.featureGates.dispatchIntent
        ? null
        : 'client_dispatch_intent_contract_missing'
    }
  ];
  const blockingGates = gates.filter(gate => gate.blocking);
  const dispatchable = readiness === 'ready'
    && hasExecutableCommand
    && blockingGates.length === 0
    && workflowHandoff.dispatchIntent.enabled;
  const proofBase = [
    surfaceId,
    requestState.workflowId,
    requestState.trace.correlationId,
    commands.idempotencyScope
  ];
  const providerAssignments = integrationProviderContracts.commandAssignments;
  const assignmentIdsByAction = action => providerAssignments.assignments
    .filter(assignment => assignment.action === action)
    .map(assignment => assignment.assignmentId);
  const makeEvent = ({ command, action, artifactIds, providerIds, destructive = false }) => ({
    contract: 'artifact-retention.hosted-kernel-event.v1',
    eventId: buildStableToken(['event', command.commandId || action, artifactIds]),
    commandId: command.commandId,
    type: command.type,
    action,
    enabled: dispatchable && artifactIds.length > 0,
    destructive,
    artifactIds,
    providerIds,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    route: routeHints.dispatchRoute,
    idempotencyKey: buildStableToken([commands.idempotencyScope, command.commandId]),
    proofRef: buildStableToken(['proof', command.commandId || action]),
    providerAssignmentIds: assignmentIdsByAction(action)
  });
  const events = [
    makeEvent({
      command: commands.archive,
      action: 'archive',
      artifactIds: commands.archive.artifactIds,
      providerIds: providerNegotiation.actionCoverage.archive
    }),
    makeEvent({
      command: commands.delete,
      action: 'delete',
      artifactIds: commands.delete.artifactIds,
      providerIds: providerNegotiation.actionCoverage.delete,
      destructive: true
    }),
    commands.dryRun.enabled
      ? makeEvent({
          command: commands.dryRun,
          action: 'dry_run',
          artifactIds: uniqueTokens([
            ...commands.dryRun.archiveArtifactIds,
            ...commands.dryRun.deleteArtifactIds
          ]),
          providerIds: providerNegotiation.selectedProviderIds
        })
      : null,
    retryDispatchArtifactIds.length > 0
      ? makeEvent({
          command: commands.retry,
          action: 'retry_failed',
          artifactIds: retryDispatchArtifactIds,
          providerIds: providerNegotiation.selectedProviderIds
        })
      : null
  ].filter(Boolean);

  return {
    contract: 'artifact-retention.hosted-kernel-dispatch.v1',
    generatedAt: nowDate.toISOString(),
    workflowId: requestState.workflowId,
    requestId: requestState.requestId,
    dispatchable,
    status: dispatchable
      ? 'ready'
      : hasExecutableCommand
        ? 'blocked'
        : 'idle',
    disabledReason: dispatchable
      ? null
      : blockingGates[0]?.reason || workflowHandoff.dispatchIntent.disabledReason || 'no_dispatchable_work',
    gates,
    commandEnvelope: {
      contract: 'artifact-retention.hosted-kernel-command-envelope.v1',
      idempotencyScope: commands.idempotencyScope,
      commandIds: allDispatchCommandIds,
      lifecycleCommandId: commands.lifecycle.commandId,
      idempotencyKeys: {
        archive: commands.archive.idempotencyKey,
        delete: commands.delete.idempotencyKey,
        dryRun: commands.dryRun.idempotencyKey,
        retry: commands.retry.idempotencyKey,
        lifecycle: commands.lifecycle.idempotencyKey
      },
      replay: commands.replay,
      retry: operationalHealth.retryCommand,
      restartRecovery: operationalHealth.restartRecovery,
      providerAssignments,
      pendingArtifactIds: commands.pendingArtifactIds,
      plannedArtifactIds: commands.plannedArtifactIds,
      destructiveArtifactIds: acceptance.destructiveArtifactIds,
      workspaceBoundary: {
        contract: 'artifact-retention.command-workspace-boundary.v1',
        tenantId: boundaryContext.tenantId,
        requestedWorkspaceId: boundaryContext.workspaceId,
        allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
        delegatedWorkspaceCount: summary.delegatedWorkspaceItems,
        tenantWideAccess: boundaryContext.isolation.tenantWideAccess,
        scopeToken: boundaryContext.scopeToken,
        scopeAccessManifestId: scopeAccessManifest.manifestId,
        deniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
        blockedWorkspaceIds: scopeAccessManifest.blockedWorkspaceIds,
        dispatchableWorkspaceCount: scopeAccessManifest.counts.dispatchableWorkspaceCount
      },
      scopeAccessManifest,
      dryRun: commands.dryRun.enabled,
      routes: {
        dispatch: routeHints.dispatchRoute,
        proof: routeHints.proofRoute,
        returnTo: requestState.clientRuntime.returnTo
      }
    },
    events,
    proofOutputs: {
      contract: 'artifact-retention.hosted-kernel-proof-outputs.v1',
      auditProofId: buildStableToken(['audit-proof', ...proofBase]),
      dispatchReceiptId: buildStableToken(['dispatch-receipt', ...proofBase]),
      acceptanceReceiptId: acceptance.accepted
        ? buildStableToken(['acceptance-receipt', ...proofBase, acceptance.acceptedBy || 'accepted'])
        : null,
      retryReceiptId: retryDispatchArtifactIds.length > 0
        ? buildStableToken(['retry-receipt', ...proofBase, commands.retry.commandId])
        : null,
      analyticsExportId: analyticsReporting.exportSummary.exportId,
      checkpointId: buildStableToken(['checkpoint', requestState.workflowId, commands.idempotencyScope, nowDate.toISOString()]),
      lifecycleSettingsCommandId: lifecycleSettingsControls.command.commandId,
      lifecycleSettingsStatus: lifecycleSettingsControls.status,
      scopeToken: boundaryContext.scopeToken,
      scopeAccessManifestId: scopeAccessManifest.manifestId,
      scopeAuditHandoff: scopeAccessManifest.auditHandoff,
      scopeDeniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
      scopeBlockedWorkspaceCount: scopeAccessManifest.counts.blockedWorkspaceCount,
      destructiveCount: summary.destructiveItems,
      delegatedWorkspaceCount: summary.delegatedWorkspaceItems,
      validationErrorCount: validationSummary.errors.length,
      retryReadyCount: retryDispatchArtifactIds.length,
      restartRecoveryStatus: operationalHealth.restartRecovery.status,
      restartRecoveryCommandId: operationalHealth.restartRecovery.commandId,
      restartRecoveryReplayReadyCount: operationalHealth.restartRecovery.replayReadyCount,
      restartRecoveryReplayWaitingCount: operationalHealth.restartRecovery.replayWaitingCount,
      restartRecoveryBlockedByActiveLease: operationalHealth.restartRecovery.blockedByActiveLease,
      providerUnsupportedCapabilities: providerNegotiation.unsupportedCapabilities
        .filter(Boolean),
      providerContractIssueCount: providerNegotiation.providerContractIssues.length,
      providerAssignmentCount: providerAssignments.assignmentCount,
      providerAssignmentIds: providerAssignments.assignments.map(assignment => assignment.assignmentId),
      providerExternalDeliveryAssignmentCount: providerNegotiation.assignmentCoverage.externalDeliveryAssignmentCount,
      providerUnassignedCommandCount: providerAssignments.unassignedCommands.length,
      providerSyncCheckpointId: integrationProviderContracts.syncMetadata.nextCheckpoint.checkpointId
    }
  };
}

export function describeArtifactRetentionSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const nowDate = coerceDate(now, new Date().toISOString());
  const requestState = normalizeRequestState(input, nowDate);
  const boundaryContext = normalizeBoundaryContext(input, requestState);
  const persistedState = normalizePersistedRetentionState(input, requestState, nowDate);
  const policy = normalizePolicy(input.retentionPolicy);
  const lifecycleControls = normalizeLifecycleControls(input, nowDate);
  const artifacts = Array.isArray(input.artifacts)
    ? input.artifacts.map((artifact, index) => scopeArtifact(
        normalizeArtifact(artifact, index, nowDate),
        boundaryContext
      ))
    : [];
  const accepted = Boolean(input.acceptance?.accepted || input.accepted);
  const previewItems = artifacts
    .map(artifact => ({
      artifact,
      ...decideRetentionAction(artifact, policy, nowDate)
    }))
    .map(item => enforceBoundaryAndPermissions(item, boundaryContext))
    .sort((left, right) => {
      const rankDelta = retentionActionRank[right.action] - retentionActionRank[left.action];
      return rankDelta || right.artifact.idleDays - left.artifact.idleDays;
    })
    .slice(0, policy.maxPreviewItems);
  const summary = summarizePreview(previewItems);
  const scopeAccessManifest = buildScopeAccessManifest({
    previewItems,
    boundaryContext,
    requestState,
    nowDate
  });
  const lifecycleSettingsControls = buildLifecycleSettingsControlState({
    input,
    lifecycleControls,
    summary,
    requestState,
    nowDate
  });
  const validationSummary = buildValidationSummary(
    input,
    artifacts,
    previewItems,
    policy,
    boundaryContext,
    lifecycleControls,
    lifecycleSettingsControls,
    scopeAccessManifest
  );
  const acceptance = {
    required: summary.destructiveItems > 0 && policy.requireAcceptanceForDelete,
    accepted,
    acceptedBy: input.acceptance?.acceptedBy || input.acceptedBy || null,
    acceptedAt: input.acceptance?.acceptedAt || input.acceptedAt || null,
    destructiveArtifactIds: previewItems
      .filter(item => item.destructive)
      .map(item => item.artifact.id)
  };
  const readiness = !validationSummary.ok
    ? 'blocked'
    : acceptance.required && !acceptance.accepted
      ? 'needs_acceptance'
      : 'ready';
  const commands = buildRetentionCommands({
    previewItems,
    requestState,
    persistedState,
    lifecycleControls,
    lifecycleSettingsControls
  });
  const recoveryState = buildRecoveryState({
    readiness,
    previewItems,
    requestState,
    persistedState,
    commands,
    nowDate
  });
  const operationalHealth = buildOperationalHealth({
    readiness,
    validationSummary,
    persistedState,
    commands,
    recoveryState,
    nowDate
  });
  const lifecycleAction = buildLifecycleNextAction({
    lifecycleControls,
    commands,
    summary,
    readiness,
    nowDate
  });
  const integrationProviderContracts = buildIntegrationProviderContracts({
    input,
    commands,
    lifecycleAction,
    requestState,
    boundaryContext,
    scopeAccessManifest,
    nowDate
  });
  const nextSteps = buildNextSteps({
    accepted,
    validationSummary,
    summary,
    policy,
    requestState,
    operationalHealth,
    lifecycleAction,
    lifecycleSettingsControls,
    integrationProviderContracts
  });
  const workflowHandoff = buildWorkflowHandoff({
    readiness,
    nextSteps,
    acceptance,
    summary,
    previewItems,
    requestState,
    boundaryContext,
    commands,
    recoveryState,
    operationalHealth,
    lifecycleAction,
    integrationProviderContracts
  });
  const clientPreviewAcceptance = buildClientPreviewAcceptanceContract({
    readiness,
    summary,
    previewItems,
    validationSummary,
    acceptance,
    nextSteps,
    workflowHandoff,
    requestState,
    boundaryContext,
    policy,
    lifecycleAction,
    lifecycleSettingsControls,
    operationalHealth,
    integrationProviderContracts,
    nowDate
  });
  const analyticsReporting = buildAnalyticsReportingState({
    readiness,
    summary,
    previewItems,
    validationSummary,
    acceptance,
    requestState,
    boundaryContext,
    persistedState,
    recoveryState,
    operationalHealth,
    lifecycleSettingsControls,
    commands,
    nowDate
  });
  const hostedKernelDispatch = buildHostedKernelDispatchPlan({
    readiness,
    acceptance,
    summary,
    validationSummary,
    workflowHandoff,
    requestState,
    boundaryContext,
    scopeAccessManifest,
    commands,
    lifecycleAction,
    lifecycleSettingsControls,
    integrationProviderContracts,
    operationalHealth,
    analyticsReporting,
    nowDate
  });
  const clientRouteContracts = buildClientRouteContracts({
    readiness,
    summary,
    previewItems,
    validationSummary,
    acceptance,
    nextSteps,
    workflowHandoff,
    clientPreviewAcceptance,
    requestState,
    boundaryContext,
    commands,
    hostedKernelDispatch,
    nowDate
  });
  const clientRuntimeState = buildClientRuntimeStateEnvelope({
    readiness,
    requestState,
    boundaryContext,
    clientPreviewAcceptance,
    clientRouteContracts,
    workflowHandoff,
    hostedKernelDispatch,
    analyticsReporting,
    recoveryState,
    operationalHealth,
    nowDate
  });

  return {
    ok: validationSummary.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: nowDate.toISOString(),
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'artifact-retention.preview.v1',
    requestState,
    boundaryContext,
    retentionPolicy: policy,
    lifecycleControls,
    lifecycleSettingsControls,
    scopeAccessManifest,
    readiness,
    persistedState,
    recoveryState,
    lifecycleAction,
    integrationProviderContracts,
    hostedKernelDispatch,
    operationalHealth,
    analyticsReporting,
    commands,
    validationSummary,
    acceptance,
    preview: {
      summary,
      items: previewItems
    },
    nextSteps,
    workflowHandoff,
    clientPreviewAcceptance,
    clientRouteContracts,
    clientRuntimeState,
    audit: {
      route: requestState.trace.route,
      requestedBy: input.requestedBy || null,
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      proof: {
        surfaceId,
        requestId: requestState.requestId,
        workflowId: requestState.workflowId,
        clientId: requestState.clientId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        actorId: boundaryContext.actorId,
        actorRoles: boundaryContext.roles,
        correlationId: requestState.trace.correlationId,
        generatedAt: nowDate.toISOString(),
        candidateCount: artifacts.length,
        previewCount: previewItems.length,
        destructiveCount: summary.destructiveItems,
        boundaryBlockedCount: summary.boundaryBlockedItems,
        delegatedWorkspaceCount: summary.delegatedWorkspaceItems,
        permissionBlockedCount: summary.permissionBlockedItems,
        allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
        workspaceGrantCount: boundaryContext.workspaceGrants.length,
        tenantWideAccess: boundaryContext.isolation.tenantWideAccess,
        tenantWideRequestDenied: boundaryContext.isolation.tenantWideRequestDenied,
        accepted,
        restartSafeStatus: recoveryState.restartSafeStatus,
        nextRuntimeStatus: recoveryState.nextRuntimeStatus,
        recoveryLeaseStatus: recoveryState.leaseState.status,
        recoveryLeaseTakeoverAllowed: recoveryState.leaseState.takeoverAllowed,
        recoveryCommandStatus: recoveryState.recoveryCommand.status,
        recoveryCommandEnabled: recoveryState.recoveryCommand.enabled,
        restartReplayIntentCount: recoveryState.replayIntents.length,
        restartReplayDispatchableCount: recoveryState.replayIntents
          .filter(intent => intent.dispatchAllowed).length,
        pendingArtifactCount: recoveryState.pendingArtifactIds.length,
        replayableCommandCount: recoveryState.replayableCommandIds.length,
        checkpointPersistContract: recoveryState.checkpointToPersist.contract,
        checkpointPersistStatus: recoveryState.checkpointToPersist.status,
        operationalStatus: operationalHealth.status,
        analyticsSnapshotId: analyticsReporting.history.currentSnapshot.snapshotId,
        analyticsExportId: analyticsReporting.exportSummary.exportId,
        analyticsTimelineEventCount: analyticsReporting.timeline.length,
        analyticsHistorySnapshotCount: analyticsReporting.history.snapshots.length,
        lifecycleEnabled: lifecycleControls.enabled,
        lifecycleMode: lifecycleControls.mode,
        lifecycleStatus: lifecycleAction.status,
        lifecycleSettingsStatus: lifecycleSettingsControls.status,
        lifecycleSettingsAction: lifecycleSettingsControls.command.action,
        lifecycleSettingsApplyAllowed: lifecycleSettingsControls.applyAllowed,
        lifecycleSettingsCommandId: lifecycleSettingsControls.command.commandId,
        lifecycleScheduleDue: lifecycleControls.scheduler.due,
        lifecycleNextRunAt: lifecycleControls.scheduler.nextRunAt,
        lifecycleDispatchAllowed: lifecycleAction.executionAllowed,
        providerContractCount: integrationProviderContracts.providers.length,
        providerEnabledCount: integrationProviderContracts.syncMetadata.enabledProviderCount,
        providerDispatchAllowed: integrationProviderContracts.negotiation.dispatchable,
        providerUnsupportedCapabilities: integrationProviderContracts.negotiation.unsupportedCapabilities,
        providerContractIssueCount: integrationProviderContracts.negotiation.providerContractIssues.length,
        providerSyncCursor: integrationProviderContracts.syncMetadata.cursor,
        providerSyncCheckpointId: integrationProviderContracts.syncMetadata.nextCheckpoint.checkpointId,
        providerExternalDeliveryAssignmentCount: integrationProviderContracts.negotiation.assignmentCoverage.externalDeliveryAssignmentCount,
        externalHandoffState: integrationProviderContracts.externalHandoff.state,
        externalHandoffDeliveryAssignmentCount: integrationProviderContracts.externalHandoff.deliveryAssignments.length,
        retryDueArtifactCount: operationalHealth.retryPlan.retryDueArtifactIds.length,
        retryBackoffArtifactCount: operationalHealth.retryPlan.waitingArtifactIds.length,
        permanentlyFailedArtifactCount: operationalHealth.retryPlan.permanentlyFailedArtifactIds.length,
        idempotencyScope: commands.idempotencyScope,
        scopeToken: boundaryContext.scopeToken,
        scopeAccessManifestId: scopeAccessManifest.manifestId,
        scopeAccessManifestContract: scopeAccessManifest.contract,
        scopeAccessDeniedArtifactCount: scopeAccessManifest.counts.deniedArtifactCount,
        scopeAccessBlockedWorkspaceCount: scopeAccessManifest.counts.blockedWorkspaceCount,
        scopeAccessDispatchableWorkspaceCount: scopeAccessManifest.counts.dispatchableWorkspaceCount,
        scopeAccessAuditDigest: scopeAccessManifest.auditHandoff.manifestDigest,
        scopeAccessRequiresOperatorReview: scopeAccessManifest.auditHandoff.requiresOperatorReview,
        handoffStatus: workflowHandoff.status,
        dispatchEnabled: workflowHandoff.dispatchIntent.enabled,
        clientPreviewAcceptanceRenderable: clientPreviewAcceptance.renderable,
        clientPreviewAcceptanceGateCount: clientPreviewAcceptance.readiness.gates.length,
        clientPreviewAcceptanceBlockedGates: clientPreviewAcceptance.readiness.blockedGateIds,
        clientPreviewAcceptanceNextStepCount: clientPreviewAcceptance.nextSteps.length,
        clientRouteContract: clientRouteContracts.contract,
        clientRoutePrimaryActionId: clientRouteContracts.primaryAction.actionId,
        clientRoutePreviewRowCount: clientRouteContracts.previewTable.rowCount,
        clientRouteAcceptanceEnabled: clientRouteContracts.acceptanceForm.enabled,
        clientRouteAcceptanceDisabledReason: clientRouteContracts.acceptanceForm.disabledReason,
        clientRuntimeStateStatus: clientRuntimeState.status,
        clientRuntimeStateResumable: clientRuntimeState.resumable,
        clientRuntimeStatePrimaryActionId: clientRuntimeState.activeAction.actionId,
        clientRuntimeStateHandoffTarget: clientRuntimeState.handoffTarget,
        clientRuntimeStatePatchContract: clientRuntimeState.clientStatePatch.contract,
        clientRuntimeStateProofEnabled: clientRuntimeState.proofState.enabledInClient,
        clientRuntimeStateProofRoute: clientRuntimeState.proofState.route,
        hostedKernelDispatchStatus: hostedKernelDispatch.status,
        hostedKernelDispatchable: hostedKernelDispatch.dispatchable,
        hostedKernelDispatchEventCount: hostedKernelDispatch.events.length,
        hostedKernelDispatchBlockedGates: hostedKernelDispatch.gates
          .filter(gate => gate.blocking)
          .map(gate => gate.id),
        hostedKernelDispatchReceiptId: hostedKernelDispatch.proofOutputs.dispatchReceiptId,
        hostedKernelAuditProofId: hostedKernelDispatch.proofOutputs.auditProofId,
        hostedKernelCheckpointId: hostedKernelDispatch.proofOutputs.checkpointId
      }
    }
  };
}

export default describeArtifactRetentionSurface;
