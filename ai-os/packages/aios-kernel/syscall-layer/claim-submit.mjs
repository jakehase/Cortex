export const surfaceId = "aios_syscall-layer_claim-submit_029";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "claim-submit";

const FINAL_CLAIM_STATES = new Set(['accepted', 'rejected', 'failed', 'cancelled']);
const POSITIVE_CLAIM_STATES = new Set(['accepted', 'submitted', 'queued', 'verified']);
const LIFECYCLE_COMMANDS = new Set([
  'cancel-schedule',
  'disable',
  'enable',
  'export-now',
  'pause',
  'relax-proof',
  'require-proof',
  'resume',
  'schedule',
  'set-capacity',
  'set-export-policy',
  'set-intake',
  'skip-scheduled-run'
]);
const PERSISTED_COMMAND_RECEIPT_STATES = new Set([
  'accepted',
  'applied',
  'cancelled',
  'failed',
  'pending',
  'rejected',
  'succeeded'
]);
const APPLIED_COMMAND_RECEIPT_STATES = new Set(['accepted', 'applied', 'succeeded']);
const TERMINAL_COMMAND_RECEIPT_STATES = new Set([
  'applied',
  'cancelled',
  'failed',
  'rejected',
  'succeeded'
]);
const KNOWN_CLAIM_STATES = new Set([
  'accepted',
  'cancelled',
  'failed',
  'queued',
  'received',
  'rejected',
  'submitted',
  'verified'
]);
const CLAIM_INTAKE_STATES = new Set(['received', 'submitted', 'queued', 'verified']);
const PROVIDER_STATUSES = new Set(['ok', 'slow', 'down', 'disabled', 'unknown']);
const PROVIDER_HANDOFF_MODES = new Set(['none', 'webhook', 'queue', 'poll']);
const PROVIDER_DELIVERY_GUARANTEES = new Set(['at-most-once', 'at-least-once', 'exactly-once']);
const PROVIDER_CAPABILITIES = new Set([
  'claim-dispatch',
  'audit-proof',
  'async-receipt',
  'idempotent-submit',
  'claim-export'
]);
const ROLE_PERMISSION_GRANTS = {
  owner: ['claim:submit', 'claim:review', 'claim:export', 'claim:admin'],
  admin: ['claim:submit', 'claim:review', 'claim:export'],
  operator: ['claim:submit', 'claim:review'],
  submitter: ['claim:submit'],
  auditor: ['claim:review', 'claim:export'],
  viewer: []
};
const CLAIM_SUBMIT_PERMISSION = 'claim:submit';
const CLAIM_AGE_BUCKETS = [
  { id: 'under-15m', maxMinutes: 15 },
  { id: '15m-1h', maxMinutes: 60 },
  { id: '1h-4h', maxMinutes: 240 },
  { id: '4h-24h', maxMinutes: 1440 },
  { id: 'over-24h', maxMinutes: Number.POSITIVE_INFINITY }
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeStringList(value) {
  return asArray(value).map((entry) => String(entry).trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function timestampToMs(value, fallback) {
  return isIsoTimestamp(value) ? Date.parse(value) : fallback;
}

function routeMatchesPrefix(route, prefix) {
  return route === prefix || route.startsWith(`${prefix}.`);
}

function minutesBetween(start, end) {
  return Math.max(Math.floor((end - start) / 60000), 0);
}

function claimAgeBucketId(ageMinutes) {
  return CLAIM_AGE_BUCKETS.find((bucket) => ageMinutes <= bucket.maxMinutes)?.id || 'over-24h';
}

function normalizeWorkspaceSubmitGrant(rawGrant, index, fallbackTenantId, fallbackWorkspaceId, now) {
  const grant = asObject(rawGrant);
  const roles = uniqueStrings(normalizeStringList(grant.roles || grant.roleGrants));
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
  const explicitPermissions = normalizeStringList(
    grant.permissions || grant.grants || grant.scopes || grant.permissionGrants
  );
  const routePrefixes = uniqueStrings(
    normalizeStringList(grant.routePrefixes || grant.routes || grant.allowedRoutes)
  );
  const allowedPriorities = uniqueStrings(
    normalizeStringList(grant.allowedPriorities || grant.priorities)
      .map((priority) => priority.toLowerCase())
      .filter((priority) => ['high', 'normal', 'low'].includes(priority))
  );
  const expiresAt = isIsoTimestamp(grant.expiresAt || grant.expiry)
    ? grant.expiresAt || grant.expiry
    : null;
  const maxClaimsPerBatch = normalizePositiveInteger(
    grant.maxClaimsPerBatch || grant.batchLimit || grant.claimLimit,
    null
  );

  return {
    contract: 'claim-submit.workspace-submit-grant.v1',
    grantId: String(grant.id || grant.grantId || `workspace-submit-grant-${index + 1}`),
    tenantId: String(grant.tenantId || grant.tenant || fallbackTenantId),
    workspaceId: String(grant.workspaceId || grant.workspace || fallbackWorkspaceId),
    roles,
    permissions: uniqueStrings([...rolePermissions, ...explicitPermissions]).sort(),
    routePrefixes: routePrefixes.length > 0 ? routePrefixes : ['kernel.claim.submit'],
    allowedPriorities: allowedPriorities.length > 0 ? allowedPriorities : ['high', 'normal', 'low'],
    maxClaimsPerBatch,
    expiresAt,
    expired: expiresAt ? Date.parse(expiresAt) <= Date.parse(now) : false,
    source: grant.source ? String(grant.source) : 'authorization.workspaceGrants'
  };
}

function normalizeTenantBoundaryContext(input, now) {
  const rawTenant = asObject(input.tenant || input.tenantContext || input.account);
  const rawWorkspace = asObject(input.workspace || input.workspaceContext);
  const rawAuthz = asObject(input.authorization || input.permissions || input.authz);
  const rawActor = asObject(input.actor || input.principal || input.user);
  const request = asObject(input.request || input.submitRequest || input.workflowRequest);
  const tenantId = String(rawTenant.id || rawTenant.tenantId || input.tenantId || request.tenantId || 'default-tenant');
  const workspaceId = String(
    rawWorkspace.id
      || rawWorkspace.workspaceId
      || input.workspaceId
      || request.workspaceId
      || 'default-workspace'
  );
  const actorId = String(
    rawActor.id
      || rawActor.actorId
      || rawAuthz.actorId
      || input.actorId
      || request.actorId
      || 'anonymous'
  );
  const roles = uniqueStrings(normalizeStringList(rawActor.roles || rawAuthz.roles || input.roles));
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
  const explicitPermissions = normalizeStringList(
    rawAuthz.grants || rawAuthz.permissions || rawAuthz.scopes || input.permissionGrants
  );
  const permissions = uniqueStrings([...rolePermissions, ...explicitPermissions]).sort();
  const allowedTenantIds = uniqueStrings([
    tenantId,
    ...normalizeStringList(rawAuthz.allowedTenantIds || rawTenant.allowedTenantIds)
  ]);
  const allowedWorkspaceIds = uniqueStrings([
    workspaceId,
    ...normalizeStringList(rawAuthz.allowedWorkspaceIds || rawWorkspace.allowedWorkspaceIds)
  ]);
  const requiredPermission = String(rawAuthz.requiredPermission || CLAIM_SUBMIT_PERMISSION);
  const allowCrossTenant = normalizeBoolean(rawAuthz.allowCrossTenant, false);
  const allowUnscopedWorkspace = normalizeBoolean(rawAuthz.allowUnscopedWorkspace, false);
  const hasRequiredPermission = permissions.includes(requiredPermission);
  const workspaceSubmitGrants = [
    ...asArray(rawAuthz.workspaceGrants || rawAuthz.workspaceScopes || rawAuthz.submitGrants),
    ...asArray(rawWorkspace.submitGrants || rawWorkspace.grants),
    ...asArray(input.workspaceGrants || input.submitGrants)
  ].map((grant, index) =>
    normalizeWorkspaceSubmitGrant(grant, index, tenantId, workspaceId, now)
  );
  const activeWorkspaceSubmitGrants = workspaceSubmitGrants.filter((grant) => !grant.expired);

  return {
    contract: 'claim-submit.tenant-boundary.v1',
    generatedAt: now,
    tenantId,
    workspaceId,
    actorId,
    roles,
    permissions,
    requiredPermission,
    allowedTenantIds,
    allowedWorkspaceIds,
    allowCrossTenant,
    allowUnscopedWorkspace,
    hasRequiredPermission,
    workspaceSubmitGrants,
    activeWorkspaceSubmitGrants,
    scopedWorkspaceMode: workspaceSubmitGrants.length > 0,
    boundaryMode: allowCrossTenant ? 'cross-tenant-authorized' : 'single-tenant',
    handoffLabel: `${tenantId}/${workspaceId}`
  };
}

function normalizeClaim(rawClaim, index, now, boundaryContext = null) {
  const claim = rawClaim && typeof rawClaim === 'object' ? rawClaim : {};
  const submittedAt = claim.submittedAt || claim.createdAt || claim.receivedAt || now;
  const status = String(claim.status || claim.state || 'received').toLowerCase();
  const normalizedStatus = KNOWN_CLAIM_STATES.has(status) ? status : 'received';
  const proofArtifacts = asArray(claim.proofArtifacts || claim.proofs || claim.evidence);
  const route = claim.route || claim.syscallRoute || 'kernel.claim.submit';
  const tenantId = String(claim.tenantId || claim.tenant || boundaryContext?.tenantId || 'default-tenant');
  const workspaceId = String(
    claim.workspaceId
      || claim.workspace
      || claim.scope?.workspaceId
      || boundaryContext?.workspaceId
      || 'default-workspace'
  );

  return {
    id: String(claim.id || claim.claimId || `claim-${index + 1}`),
    claimantId: claim.claimantId ? String(claim.claimantId) : 'anonymous',
    subject: claim.subject ? String(claim.subject) : 'unspecified',
    tenantId,
    workspaceId,
    route: String(route),
    status: normalizedStatus,
    priority: claim.priority === 'high' || claim.priority === 'low' ? claim.priority : 'normal',
    submittedAt,
    updatedAt: claim.updatedAt || submittedAt,
    proofArtifactCount: proofArtifacts.length,
    hasAuditProof: proofArtifacts.length > 0 || Boolean(claim.auditProof || claim.proofHash),
    exportTags: asArray(claim.exportTags).map(String).filter(Boolean)
  };
}

function normalizeLifecycleSettings(input, now) {
  const rawSettings = asObject(input.settings || input.lifecycleSettings);
  const rawSchedule = asObject(rawSettings.schedule || rawSettings.scheduling);
  const validation = [];
  const scheduleMode = ['off', 'manual', 'interval', 'at'].includes(rawSchedule.mode)
    ? rawSchedule.mode
    : 'off';
  const cadenceMinutes = normalizePositiveInteger(rawSchedule.cadenceMinutes, 60);
  const nextRunAt = isIsoTimestamp(rawSchedule.nextRunAt) ? rawSchedule.nextRunAt : null;
  const pausedUntil = isIsoTimestamp(rawSchedule.pausedUntil) ? rawSchedule.pausedUntil : null;

  if (rawSchedule.mode && scheduleMode === 'off' && rawSchedule.mode !== 'off') {
    validation.push({
      code: 'invalid-schedule-mode',
      severity: 'error',
      path: 'settings.schedule.mode',
      message: 'Schedule mode must be off, manual, interval, or at.'
    });
  }

  if (scheduleMode === 'interval' && cadenceMinutes < 5) {
    validation.push({
      code: 'cadence-too-small',
      severity: 'error',
      path: 'settings.schedule.cadenceMinutes',
      message: 'Interval schedules must run no more often than every 5 minutes.'
    });
  }

  if (scheduleMode === 'at' && !nextRunAt) {
    validation.push({
      code: 'missing-next-run',
      severity: 'error',
      path: 'settings.schedule.nextRunAt',
      message: 'At-time schedules require a valid nextRunAt timestamp.'
    });
  }

  if (nextRunAt && Date.parse(nextRunAt) < Date.parse(now)) {
    validation.push({
      code: 'next-run-in-past',
      severity: 'warning',
      path: 'settings.schedule.nextRunAt',
      message: 'The configured nextRunAt is in the past and should be rescheduled.'
    });
  }

  return {
    enabled: normalizeBoolean(rawSettings.enabled, true),
    acceptNewClaims: normalizeBoolean(rawSettings.acceptNewClaims, true),
    proofRequired: normalizeBoolean(rawSettings.proofRequired, true),
    exportOnFinal: normalizeBoolean(rawSettings.exportOnFinal, false),
    draining: normalizeBoolean(rawSettings.draining || rawSettings.drainMode, false),
    maxOpenClaims: normalizePositiveInteger(rawSettings.maxOpenClaims, 100),
    schedule: {
      mode: scheduleMode,
      cadenceMinutes,
      nextRunAt,
      paused: normalizeBoolean(rawSchedule.paused, false) || Boolean(pausedUntil),
      pausedUntil
    },
    validation
  };
}

function normalizeLifecycleCommands(input, now) {
  return asArray(input.lifecycleCommands || input.commands).map((rawCommand, index) => {
    const command = typeof rawCommand === 'string' ? { type: rawCommand } : asObject(rawCommand);
    const type = String(command.type || command.command || '').toLowerCase();
    const requestedAt = command.requestedAt || command.at || now;

    return {
      id: String(command.id || `lifecycle-command-${index + 1}`),
      type,
      requestedAt,
      actor: command.actor ? String(command.actor) : 'kernel.syscall',
      reason: command.reason ? String(command.reason) : null,
      schedule: asObject(command.schedule),
      controls: asObject(command.controls || command.settings || command.patch),
      known: LIFECYCLE_COMMANDS.has(type)
    };
  });
}

function cloneLifecycleSettings(settings) {
  return {
    ...settings,
    schedule: { ...settings.schedule },
    validation: [...settings.validation]
  };
}

function normalizeCommandSchedule(command, now) {
  const schedule = asObject(command.schedule);
  const requestedMode = schedule.mode ? String(schedule.mode).toLowerCase() : null;
  const mode = ['off', 'manual', 'interval', 'at'].includes(requestedMode)
    ? requestedMode
    : null;
  const cadenceMinutes = normalizePositiveInteger(schedule.cadenceMinutes, 60);
  const nextRunAt = isIsoTimestamp(schedule.nextRunAt) ? schedule.nextRunAt : null;
  const pausedUntil = isIsoTimestamp(schedule.pausedUntil) ? schedule.pausedUntil : null;
  const validation = [];

  if (requestedMode && !mode) {
    validation.push({
      code: 'invalid-command-schedule-mode',
      severity: 'error',
      path: `lifecycleCommands.${command.id}.schedule.mode`,
      message: 'Lifecycle schedule commands must use off, manual, interval, or at mode.'
    });
  }

  if ((mode || 'interval') === 'interval' && cadenceMinutes < 5) {
    validation.push({
      code: 'command-cadence-too-small',
      severity: 'error',
      path: `lifecycleCommands.${command.id}.schedule.cadenceMinutes`,
      message: 'Lifecycle interval schedules must run no more often than every 5 minutes.'
    });
  }

  if ((mode || 'interval') === 'at' && !nextRunAt) {
    validation.push({
      code: 'command-missing-next-run',
      severity: 'error',
      path: `lifecycleCommands.${command.id}.schedule.nextRunAt`,
      message: 'Lifecycle at-time schedules require a valid nextRunAt timestamp.'
    });
  }

  if (nextRunAt && Date.parse(nextRunAt) < Date.parse(now)) {
    validation.push({
      code: 'command-next-run-in-past',
      severity: 'warning',
      path: `lifecycleCommands.${command.id}.schedule.nextRunAt`,
      message: 'Lifecycle schedule command points to a past nextRunAt timestamp.'
    });
  }

  return {
    mode: mode || 'interval',
    cadenceMinutes,
    nextRunAt,
    paused: normalizeBoolean(schedule.paused, false) || Boolean(pausedUntil),
    pausedUntil,
    validation
  };
}

function normalizeCommandControlPatch(command) {
  const controls = asObject(command.controls);
  const validation = [];
  const patch = {};

  if (command.type === 'set-capacity') {
    const maxOpenClaims = Number(controls.maxOpenClaims ?? controls.capacity ?? controls.limit);

    if (!Number.isInteger(maxOpenClaims) || maxOpenClaims <= 0) {
      validation.push({
        code: 'invalid-command-capacity',
        severity: 'error',
        path: `lifecycleCommands.${command.id}.controls.maxOpenClaims`,
        message: 'Capacity commands require a positive integer maxOpenClaims value.'
      });
    } else {
      patch.maxOpenClaims = maxOpenClaims;
    }
  }

  if (command.type === 'set-intake') {
    const requested = controls.acceptNewClaims ?? controls.enabled;

    if (typeof requested !== 'boolean') {
      validation.push({
        code: 'invalid-command-intake-toggle',
        severity: 'error',
        path: `lifecycleCommands.${command.id}.controls.acceptNewClaims`,
        message: 'Intake commands require a boolean acceptNewClaims value.'
      });
    } else {
      patch.acceptNewClaims = requested;
    }
  }

  if (command.type === 'set-export-policy') {
    const requested = controls.exportOnFinal ?? controls.enabled;

    if (typeof requested !== 'boolean') {
      validation.push({
        code: 'invalid-command-export-policy',
        severity: 'error',
        path: `lifecycleCommands.${command.id}.controls.exportOnFinal`,
        message: 'Export policy commands require a boolean exportOnFinal value.'
      });
    } else {
      patch.exportOnFinal = requested;
    }
  }

  return { patch, validation };
}

function normalizePersistedDispatchOutbox(persisted, now) {
  const rawOutbox = asArray(
    persisted.dispatchOutbox || persisted.outbox || persisted.dispatchReceipts || persisted.envelopes
  );
  const entries = rawOutbox.map((entry, index) => {
    const item = asObject(entry);
    const idempotencyKey = item.idempotencyKey || item.key || item.dispatchKey;
    const status = ['ready', 'held', 'sent', 'acked', 'failed', 'cancelled'].includes(item.status)
      ? item.status
      : 'sent';
    const claimId = item.claimId || item.claim?.id || item.payload?.claimId;
    const lastAttemptAt = item.lastAttemptAt || item.sentAt || item.ackedAt || item.updatedAt;

    return {
      outboxId: String(item.outboxId || item.envelopeId || item.id || `persisted-outbox-${index + 1}`),
      claimId: claimId ? String(claimId) : null,
      route: item.route ? String(item.route) : 'kernel.claim.submit',
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      status,
      terminal: ['acked', 'failed', 'cancelled'].includes(status),
      lastAttemptAt: isIsoTimestamp(lastAttemptAt) ? lastAttemptAt : null,
      attempt: normalizeNonNegativeInteger(item.attempt || item.attemptCount, 0),
      recoveredAt: now
    };
  });
  const byIdempotencyKey = new Map(
    entries
      .filter((entry) => entry.idempotencyKey)
      .map((entry) => [entry.idempotencyKey, entry])
  );
  const byClaimId = new Map(
    entries
      .filter((entry) => entry.claimId)
      .map((entry) => [entry.claimId, entry])
  );

  return {
    entries,
    byIdempotencyKey,
    byClaimId,
    replayableEntries: entries.filter((entry) => !entry.terminal),
    terminalEntries: entries.filter((entry) => entry.terminal)
  };
}

function normalizePersistedCommandJournal(persisted, now) {
  const rawReceipts = asArray(persisted.commandReceipts || persisted.commands || persisted.receipts);
  const entries = rawReceipts.map((receipt, index) => {
    const item = asObject(receipt);
    const statusValue = String(item.status || item.state || item.result || 'applied').toLowerCase();
    const status = PERSISTED_COMMAND_RECEIPT_STATES.has(statusValue) ? statusValue : 'applied';
    const commandId = String(item.commandId || item.id || `persisted-command-${index + 1}`);
    const type = String(item.type || item.command || item.commandType || 'unknown').toLowerCase();
    const requestedAt = item.requestedAt || item.at || item.createdAt;
    const appliedAt = item.appliedAt || item.completedAt || item.updatedAt || item.acknowledgedAt;
    const rejectedReason = item.reason || item.errorCode || item.error || null;
    const terminal = TERMINAL_COMMAND_RECEIPT_STATES.has(status);
    const applied = APPLIED_COMMAND_RECEIPT_STATES.has(status);

    return {
      receiptId: String(item.receiptId || item.id || `persisted-command-receipt-${index + 1}`),
      commandId,
      type,
      status,
      applied,
      terminal,
      replaySafe: applied && terminal,
      requestedAt: isIsoTimestamp(requestedAt) ? requestedAt : null,
      appliedAt: isIsoTimestamp(appliedAt) ? appliedAt : null,
      actor: item.actor ? String(item.actor) : 'kernel.syscall',
      reason: rejectedReason ? String(rejectedReason) : null,
      checkpointSequence: normalizeNonNegativeInteger(item.checkpointSequence || item.sequence, 0),
      recoveredAt: now
    };
  });
  const byCommandId = entries.reduce((accumulator, entry) => {
    accumulator[entry.commandId] = accumulator[entry.commandId] || [];
    accumulator[entry.commandId].push(entry);
    return accumulator;
  }, {});
  const duplicateGroups = Object.values(byCommandId).filter((group) => group.length > 1);
  const conflictingEntries = duplicateGroups.flatMap((group) => {
    const statuses = uniqueStrings(group.map((entry) => entry.status));
    const types = uniqueStrings(group.map((entry) => entry.type));
    return statuses.length > 1 || types.length > 1 ? group : [];
  });
  const appliedEntries = entries.filter((entry) => entry.applied);
  const pendingEntries = entries.filter((entry) => !entry.terminal);
  const failedEntries = entries.filter((entry) => ['failed', 'rejected', 'cancelled'].includes(entry.status));
  const replayableEntries = appliedEntries.filter((entry) => entry.replaySafe);
  const replayIndex = new Set(replayableEntries.map((entry) => entry.commandId));

  return {
    entries,
    byCommandId,
    replayIndex,
    appliedEntries,
    pendingEntries,
    failedEntries,
    conflictingEntries,
    duplicateCommandIds: duplicateGroups.map((group) => group[0].commandId),
    replayableCommandIds: replayableEntries.map((entry) => entry.commandId),
    pendingCommandIds: pendingEntries.map((entry) => entry.commandId),
    failedCommandIds: failedEntries.map((entry) => entry.commandId),
    conflictingCommandIds: uniqueStrings(conflictingEntries.map((entry) => entry.commandId))
  };
}

function projectLifecycleControls(settings, commands, persistedState, now, claims = []) {
  const projected = cloneLifecycleSettings(settings);
  const commandEffects = [];
  const openClaimCount = claims.filter((claim) => !FINAL_CLAIM_STATES.has(claim.status)).length;

  for (const command of commands) {
    if (!command.known) {
      commandEffects.push({
        commandId: command.id,
        type: command.type || 'unknown',
        applied: false,
        reason: 'unknown-lifecycle-command',
        projectedControls: null
      });
      continue;
    }

    if (persistedState.persistedReceiptIndex.has(command.id)) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        idempotentReplay: true,
        reason: 'already-applied-from-persisted-state',
        projectedControls: null
      });
      continue;
    }

    if (persistedState.commandJournal.conflictingCommandIds.includes(command.id)) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        restartRecoveryBlocked: true,
        reason: 'conflicting-persisted-command-receipts',
        projectedControls: null
      });
      continue;
    }

    if (persistedState.commandJournal.pendingCommandIds.includes(command.id)) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        restartRecoveryBlocked: true,
        reason: 'pending-persisted-command-reconciliation',
        projectedControls: null
      });
      continue;
    }

    if (persistedState.commandJournal.failedCommandIds.includes(command.id)) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        idempotentReplay: true,
        reason: 'terminal-failure-from-persisted-state',
        projectedControls: null
      });
      continue;
    }

    if (['export-now', 'schedule'].includes(command.type) && !projected.enabled) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        reason: 'surface-disabled',
        projectedControls: null
      });
      continue;
    }

    const schedulePatch = command.type === 'schedule' ? normalizeCommandSchedule(command, now) : null;
    const controlPatch = ['set-capacity', 'set-intake', 'set-export-policy'].includes(command.type)
      ? normalizeCommandControlPatch(command)
      : { patch: {}, validation: [] };
    const commandValidation = [...(schedulePatch?.validation || []), ...controlPatch.validation];
    const hasCommandError = commandValidation.some((entry) => entry.severity === 'error');
    projected.validation.push(...commandValidation);

    if (hasCommandError) {
      commandEffects.push({
        commandId: command.id,
        type: command.type,
        applied: false,
        reason: 'command-settings-invalid',
        projectedControls: null,
        validationCodes: commandValidation.map((entry) => entry.code)
      });
      continue;
    }

    if (command.type === 'disable') {
      const disableMode = ['immediate', 'drain'].includes(command.controls.mode)
        ? command.controls.mode
        : 'immediate';
      projected.enabled = disableMode === 'drain' && openClaimCount > 0;
      projected.acceptNewClaims = false;
      projected.draining = disableMode === 'drain' && openClaimCount > 0;
    } else if (command.type === 'enable') {
      projected.enabled = true;
      projected.acceptNewClaims = true;
      projected.draining = false;
    } else if (command.type === 'pause') {
      projected.schedule.paused = true;
      projected.schedule.pausedUntil = isIsoTimestamp(command.schedule.pausedUntil)
        ? command.schedule.pausedUntil
        : projected.schedule.pausedUntil;
    } else if (command.type === 'resume') {
      projected.schedule.paused = false;
      projected.schedule.pausedUntil = null;
    } else if (command.type === 'require-proof') {
      projected.proofRequired = true;
    } else if (command.type === 'relax-proof') {
      projected.proofRequired = false;
    } else if (command.type === 'schedule') {
      projected.schedule = {
        mode: schedulePatch.mode,
        cadenceMinutes: schedulePatch.cadenceMinutes,
        nextRunAt: schedulePatch.nextRunAt,
        paused: schedulePatch.paused,
        pausedUntil: schedulePatch.pausedUntil
      };
    } else if (command.type === 'cancel-schedule') {
      projected.schedule = {
        mode: 'off',
        cadenceMinutes: projected.schedule.cadenceMinutes,
        nextRunAt: null,
        paused: false,
        pausedUntil: null
      };
    } else if (command.type === 'skip-scheduled-run') {
      if (projected.schedule.mode === 'interval') {
        projected.schedule.nextRunAt = new Date(
          Date.parse(now) + projected.schedule.cadenceMinutes * 60000
        ).toISOString();
      } else if (projected.schedule.mode === 'at') {
        projected.schedule.nextRunAt = null;
      }
    } else if (command.type === 'export-now') {
      projected.exportOnFinal = true;
    } else if (command.type === 'set-capacity') {
      projected.maxOpenClaims = controlPatch.patch.maxOpenClaims;
    } else if (command.type === 'set-intake') {
      projected.acceptNewClaims = controlPatch.patch.acceptNewClaims;
      projected.draining = projected.draining && !controlPatch.patch.acceptNewClaims;
    } else if (command.type === 'set-export-policy') {
      projected.exportOnFinal = controlPatch.patch.exportOnFinal;
    }

    commandEffects.push({
      commandId: command.id,
      type: command.type,
      applied: true,
      reason: 'projected-into-lifecycle-controls',
      projectedControls: {
        enabled: projected.enabled,
        acceptNewClaims: projected.acceptNewClaims,
        proofRequired: projected.proofRequired,
        exportOnFinal: projected.exportOnFinal,
        maxOpenClaims: projected.maxOpenClaims,
        draining: Boolean(projected.draining),
        schedule: { ...projected.schedule }
      },
      validationCodes: commandValidation.map((entry) => entry.code)
    });
  }

  return {
    settings: projected,
    commandEffects
  };
}

function normalizeOperationalRuntime(input, now) {
  const rawOperational = asObject(input.operationalHealth || input.runtimeHealth || input.health);
  const rawTransport = asObject(rawOperational.transport || input.syscallTransport);
  const rawRetry = asObject(rawOperational.retry || input.retryPolicy);
  const rawDependencies = asArray(rawOperational.dependencies || input.dependencies);
  const mode = ['normal', 'degraded', 'maintenance'].includes(rawOperational.mode)
    ? rawOperational.mode
    : 'normal';
  const retryAttempt = normalizeNonNegativeInteger(rawRetry.attempt || rawRetry.attemptNumber, 0);
  const baseDelayMs = normalizePositiveInteger(rawRetry.baseDelayMs, 1000);
  const maxDelayMs = normalizePositiveInteger(rawRetry.maxDelayMs, 30000);
  const cappedDelayMs = Math.min(baseDelayMs * (2 ** Math.min(retryAttempt, 6)), maxDelayMs);
  const lastFailureAt = isIsoTimestamp(rawRetry.lastFailureAt) ? rawRetry.lastFailureAt : null;
  const nextRetryAt = lastFailureAt
    ? new Date(Date.parse(lastFailureAt) + cappedDelayMs).toISOString()
    : null;

  return {
    mode,
    degradedMode: mode === 'degraded' || mode === 'maintenance',
    transport: {
      status: ['ok', 'slow', 'down', 'unknown'].includes(rawTransport.status)
        ? rawTransport.status
        : 'unknown',
      route: rawTransport.route ? String(rawTransport.route) : 'kernel.claim.submit',
      lastOkAt: isIsoTimestamp(rawTransport.lastOkAt) ? rawTransport.lastOkAt : null,
      lastErrorCode: rawTransport.lastErrorCode ? String(rawTransport.lastErrorCode) : null,
      lastErrorMessage: rawTransport.lastErrorMessage ? String(rawTransport.lastErrorMessage) : null
    },
    retryPolicy: {
      attempt: retryAttempt,
      baseDelayMs,
      maxDelayMs,
      nextDelayMs: cappedDelayMs,
      lastFailureAt,
      nextRetryAt,
      retryBudget: normalizeNonNegativeInteger(rawRetry.retryBudget, 3)
    },
    dependencies: rawDependencies.map((dependency, index) => {
      const entry = asObject(dependency);
      const status = ['ok', 'slow', 'down', 'unknown'].includes(entry.status)
        ? entry.status
        : 'unknown';

      return {
        id: String(entry.id || entry.name || `dependency-${index + 1}`),
        status,
        route: entry.route ? String(entry.route) : null,
        required: normalizeBoolean(entry.required, true),
        lastOkAt: isIsoTimestamp(entry.lastOkAt) ? entry.lastOkAt : null,
        lastErrorCode: entry.lastErrorCode ? String(entry.lastErrorCode) : null
      };
    })
  };
}

function normalizeClientHandoffContext(input, now, boundaryContext = null) {
  const rawClient = asObject(input.client || input.clientState || input.requestClient);
  const rawRequest = asObject(input.request || input.submitRequest || input.workflowRequest);
  const rawWorkflow = asObject(rawClient.workflow || input.workflow || input.workflowState);
  const requestedHandoff = rawRequest.handoffMode || rawClient.handoffMode || rawWorkflow.handoffMode;
  const handoffMode = ['inline', 'deferred', 'manual'].includes(requestedHandoff)
    ? requestedHandoff
    : 'inline';
  const requestedChannel = rawClient.channel || rawRequest.channel || rawWorkflow.channel;
  const channel = ['cli', 'api', 'ui', 'scheduler', 'worker'].includes(requestedChannel)
    ? requestedChannel
    : 'api';
  const requestId = rawRequest.id || rawRequest.requestId || input.requestId || rawClient.requestId;
  const sessionId = rawClient.sessionId || rawClient.session || rawRequest.sessionId;
  const actorId = rawClient.actorId || rawClient.userId || rawRequest.actorId || input.actorId;
  const continuationToken = rawWorkflow.continuationToken || rawRequest.continuationToken || null;
  const returnRoute = rawWorkflow.returnRoute || rawRequest.returnRoute || rawClient.returnRoute || null;
  const idempotencyKey = rawRequest.idempotencyKey || rawClient.idempotencyKey || null;
  const requestedClaims = asArray(rawRequest.claimIds || rawClient.claimIds).map(String).filter(Boolean);
  const preferredRoutes = asArray(rawWorkflow.preferredRoutes || rawRequest.preferredRoutes)
    .map(String)
    .filter(Boolean);

  return {
    contract: 'claim-submit.client-handoff-context.v1',
    generatedAt: now,
    requestId: requestId ? String(requestId) : `claim-submit-request-${now.replace(/[:.]/g, '-')}`,
    sessionId: sessionId ? String(sessionId) : null,
    actorId: actorId ? String(actorId) : 'anonymous',
    tenantId: boundaryContext?.tenantId || String(rawRequest.tenantId || rawClient.tenantId || 'default-tenant'),
    workspaceId: boundaryContext?.workspaceId || String(rawRequest.workspaceId || rawClient.workspaceId || 'default-workspace'),
    channel,
    handoffMode,
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
    continuationToken: continuationToken ? String(continuationToken) : null,
    returnRoute: returnRoute ? String(returnRoute) : null,
    requestedClaimIds: requestedClaims,
    preferredRoutes,
    expectsAsyncReceipt: handoffMode === 'deferred' || channel === 'scheduler' || channel === 'worker',
    clientVisible: normalizeBoolean(rawClient.clientVisible, true),
    stateCursor: rawWorkflow.stateCursor ? String(rawWorkflow.stateCursor) : null
  };
}

function normalizePersistedClaimSubmitState(input, claims, now, boundaryContext = null) {
  const persisted = asObject(
    input.persistedState || input.recoveredState || input.claimSubmitState || input.state
  );
  const checkpoint = asObject(persisted.checkpoint || persisted.lastCheckpoint);
  const rawClaims = asArray(persisted.claims || persisted.claimLedger || persisted.acceptedClaims);
  const rawLease = asObject(persisted.dispatchLease || persisted.lease);
  const dispatchOutbox = normalizePersistedDispatchOutbox(persisted, now);
  const commandJournal = normalizePersistedCommandJournal(persisted, now);
  const recoveredClaims = rawClaims.map((claim, index) => normalizeClaim(claim, index, now, boundaryContext));
  const recoveredClaimIds = new Set(recoveredClaims.map((claim) => claim.id));
  const incomingClaimIds = new Set(claims.map((claim) => claim.id));
  const missingFromInput = recoveredClaims
    .filter((claim) => !incomingClaimIds.has(claim.id))
    .map((claim) => claim.id);
  const replacedFromInput = claims
    .filter((claim) => recoveredClaimIds.has(claim.id))
    .map((claim) => claim.id);
  const checkpointAt = isIsoTimestamp(checkpoint.at || persisted.checkpointAt)
    ? checkpoint.at || persisted.checkpointAt
    : null;
  const checkpointSequence = normalizePositiveInteger(
    checkpoint.sequence || persisted.sequence || persisted.revision,
    0
  );
  const appliedCommandIds = commandJournal.appliedEntries.map((entry) => entry.commandId);
  const persistedReceiptIndex = commandJournal.replayIndex;
  const leaseExpiresAt = isIsoTimestamp(rawLease.expiresAt) ? rawLease.expiresAt : null;
  const leaseExpired = leaseExpiresAt ? Date.parse(leaseExpiresAt) <= Date.parse(now) : false;
  const recoveryWarnings = [
    ...(!checkpointAt && Object.keys(persisted).length > 0
      ? [{
          code: 'missing-persisted-checkpoint',
          severity: 'warning',
          path: 'persistedState.checkpoint.at',
          message: 'Recovered claim-submit state does not include a checkpoint timestamp.'
        }]
      : []),
    ...(missingFromInput.length > 0
      ? [{
          code: 'recovered-claims-not-in-request',
          severity: 'info',
          path: 'persistedState.claims',
          message: 'Recovered claims were retained for restart-safe ledger continuity.'
        }]
      : []),
    ...(leaseExpired
      ? [{
          code: 'dispatch-lease-expired',
          severity: 'warning',
          path: 'persistedState.dispatchLease.expiresAt',
          message: 'Recovered dispatch lease expired and should be reacquired before dispatch.'
        }]
      : []),
    ...(dispatchOutbox.replayableEntries.length > 0
      ? [{
          code: 'dispatch-outbox-replay-pending',
          severity: 'info',
          path: 'persistedState.dispatchOutbox',
          message: 'Recovered dispatch outbox entries will be treated as idempotent restart replays.'
        }]
      : []),
    ...(commandJournal.pendingEntries.length > 0
      ? [{
          code: 'persisted-command-pending-reconciliation',
          severity: 'warning',
          path: 'persistedState.commandReceipts',
          message: 'Recovered lifecycle command receipts include pending entries that require restart reconciliation.'
        }]
      : []),
    ...(commandJournal.failedEntries.length > 0
      ? [{
          code: 'persisted-command-terminal-failure',
          severity: 'info',
          path: 'persistedState.commandReceipts',
          message: 'Recovered lifecycle command receipts include terminal failures that will not be replayed as applied.'
        }]
      : []),
    ...(commandJournal.conflictingEntries.length > 0
      ? [{
          code: 'persisted-command-receipt-conflict',
          severity: 'error',
          path: 'persistedState.commandReceipts',
          message: 'Recovered lifecycle command receipts conflict for the same command id and must be repaired before intake.'
        }]
      : [])
  ];

  return {
    hasPersistedState: Object.keys(persisted).length > 0,
    checkpoint: {
      at: checkpointAt,
      sequence: checkpointSequence,
      writer: checkpoint.writer ? String(checkpoint.writer) : 'kernel.claim.submit',
      source: checkpoint.source ? String(checkpoint.source) : 'hosted-kernel-state'
    },
    recoveredClaims,
    recoveredClaimIds: [...recoveredClaimIds],
    missingFromInput,
    replacedFromInput,
    commandJournal,
    appliedCommandIds,
    persistedReceiptIndex,
    dispatchLease: {
      id: rawLease.id ? String(rawLease.id) : null,
      holder: rawLease.holder ? String(rawLease.holder) : null,
      expiresAt: leaseExpiresAt,
      expired: leaseExpired
    },
    dispatchOutbox,
    recoveryWarnings
  };
}

function mergeRecoveredClaims(inputClaims, persistedState) {
  const inputIds = new Set(inputClaims.map((claim) => claim.id));
  const recoveredOnlyClaims = persistedState.recoveredClaims
    .filter((claim) => !inputIds.has(claim.id))
    .map((claim) => ({
      ...claim,
      recoverySource: 'persisted-ledger'
    }));
  const shapedInputClaims = inputClaims.map((claim) => ({
    ...claim,
    recoverySource: persistedState.recoveredClaimIds.includes(claim.id)
      ? 'request-overrides-persisted-ledger'
      : 'request'
  }));

  return [...recoveredOnlyClaims, ...shapedInputClaims];
}

function buildTenantBoundaryState(claims, boundaryContext, now) {
  const scopedWorkspaceMode = boundaryContext.scopedWorkspaceMode;
  const activeGrants = asArray(boundaryContext.activeWorkspaceSubmitGrants);
  const grantUseCounts = new Map();
  const claimAuthorizations = claims.map((claim) => {
    const eligibleGrants = activeGrants.filter((grant) =>
      grant.tenantId === claim.tenantId
        && grant.workspaceId === claim.workspaceId
        && grant.permissions.includes(boundaryContext.requiredPermission)
        && grant.routePrefixes.some((prefix) => routeMatchesPrefix(claim.route, prefix))
        && grant.allowedPriorities.includes(claim.priority)
    );
    const matchingGrant = eligibleGrants[0] || null;
    const grantUseCount = matchingGrant ? grantUseCounts.get(matchingGrant.grantId) || 0 : 0;
    const grantLimitReached = Boolean(
      matchingGrant?.maxClaimsPerBatch && grantUseCount >= matchingGrant.maxClaimsPerBatch
    );
    const expiredGrantCandidates = asArray(boundaryContext.workspaceSubmitGrants).filter((grant) =>
      grant.expired
        && grant.tenantId === claim.tenantId
        && grant.workspaceId === claim.workspaceId
    );
    const scopedGrantMissing = scopedWorkspaceMode && !matchingGrant;
    const tenantAllowed = boundaryContext.allowCrossTenant
      || boundaryContext.allowedTenantIds.includes(claim.tenantId);
    const workspaceAllowed = boundaryContext.allowUnscopedWorkspace
      || boundaryContext.allowedWorkspaceIds.includes(claim.workspaceId);
    const permissionAllowed = boundaryContext.hasRequiredPermission;
    const blockers = [
      ...(!tenantAllowed ? ['tenant-boundary-violation'] : []),
      ...(!workspaceAllowed ? ['workspace-boundary-violation'] : []),
      ...(!permissionAllowed ? ['missing-claim-submit-permission'] : []),
      ...(scopedGrantMissing ? ['workspace-submit-grant-missing'] : []),
      ...(grantLimitReached ? ['workspace-submit-grant-batch-limit'] : [])
    ];
    const authorized = blockers.length === 0;

    if (authorized && matchingGrant) {
      grantUseCounts.set(matchingGrant.grantId, grantUseCount + 1);
    }

    return {
      claimId: claim.id,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      actorId: boundaryContext.actorId,
      authorized,
      blockers,
      scopedWorkspaceMode,
      workspaceGrant: matchingGrant
        ? {
            grantId: matchingGrant.grantId,
            source: matchingGrant.source,
            routePrefixes: matchingGrant.routePrefixes,
            allowedPriorities: matchingGrant.allowedPriorities,
            maxClaimsPerBatch: matchingGrant.maxClaimsPerBatch,
            batchUseOrdinal: authorized ? grantUseCount + 1 : null,
            expiresAt: matchingGrant.expiresAt
          }
        : null,
      expiredWorkspaceGrantIds: expiredGrantCandidates.map((grant) => grant.grantId),
      authorizationBasis: {
        tenantAllowed,
        workspaceAllowed,
        permissionAllowed,
        explicitPermission: boundaryContext.permissions.includes(boundaryContext.requiredPermission),
        rolePermissionRoles: boundaryContext.roles.filter((role) =>
          asArray(ROLE_PERMISSION_GRANTS[role]).includes(boundaryContext.requiredPermission)
        ),
        workspaceGrantRequired: scopedWorkspaceMode,
        workspaceGrantSatisfied: Boolean(matchingGrant) && !grantLimitReached
      },
      auditRoute: `kernel.claim.submit.audit.${claim.tenantId}.${claim.workspaceId}`,
      proofOutput: {
        eventType: authorized
          ? 'claim-submit.boundary.authorized'
          : 'claim-submit.boundary.blocked',
        surfaceId,
        generatedAt: now,
        claimId: claim.id,
        tenantId: claim.tenantId,
        workspaceId: claim.workspaceId,
        actorId: boundaryContext.actorId,
        boundaryMode: boundaryContext.boundaryMode,
        workspaceGrantId: matchingGrant?.grantId || null,
        blockerCount: blockers.length
      }
    };
  });
  const authorizedClaimIds = claimAuthorizations
    .filter((entry) => entry.authorized)
    .map((entry) => entry.claimId);
  const blockedClaimIds = claimAuthorizations
    .filter((entry) => !entry.authorized)
    .map((entry) => entry.claimId);
  const tenantIds = uniqueStrings(claimAuthorizations.map((entry) => entry.tenantId)).sort();
  const workspaceIds = uniqueStrings(claimAuthorizations.map((entry) => entry.workspaceId)).sort();

  return {
    ...boundaryContext,
    generatedAt: now,
    claimCount: claims.length,
    submitAllowed: boundaryContext.hasRequiredPermission && blockedClaimIds.length === 0,
    authorizedClaimIds,
    blockedClaimIds,
    tenantIds,
    workspaceIds,
    crossTenantClaimCount: claims.filter((claim) => claim.tenantId !== boundaryContext.tenantId).length,
    crossWorkspaceClaimCount: claims.filter((claim) => claim.workspaceId !== boundaryContext.workspaceId).length,
    claimAuthorizations,
    auditHandoff: {
      contract: 'claim-submit.tenant-audit-handoff.v1',
      generatedAt: now,
      actorId: boundaryContext.actorId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      authorizedClaimIds,
      blockedClaimIds,
      routes: uniqueStrings(claimAuthorizations.map((entry) => entry.auditRoute)).sort(),
      workspaceGrantIds: uniqueStrings(claimAuthorizations
        .map((entry) => entry.workspaceGrant?.grantId)
        .filter(Boolean)).sort(),
      blockedWorkspaceGrantClaimIds: claimAuthorizations
        .filter((entry) =>
          entry.blockers.includes('workspace-submit-grant-missing')
            || entry.blockers.includes('workspace-submit-grant-batch-limit')
        )
        .map((entry) => entry.claimId)
    }
  };
}

function buildAnalytics(claims, evidence, now) {
  const byStatus = Object.fromEntries([...KNOWN_CLAIM_STATES].map((status) => [status, 0]));
  const byRoute = {};
  const byPriority = { high: 0, normal: 0, low: 0 };
  const openAgeBuckets = Object.fromEntries(CLAIM_AGE_BUCKETS.map((bucket) => [bucket.id, 0]));
  const proofDebtByRoute = {};
  let finalCount = 0;
  let proofBackedCount = 0;
  let exportTaggedCount = 0;
  let staleOpenClaimCount = 0;
  let oldestOpenClaim = null;
  const nowMs = timestampToMs(now, Date.now());

  for (const claim of claims) {
    byStatus[claim.status] += 1;
    byRoute[claim.route] = (byRoute[claim.route] || 0) + 1;
    byPriority[claim.priority] += 1;
    finalCount += FINAL_CLAIM_STATES.has(claim.status) ? 1 : 0;
    proofBackedCount += claim.hasAuditProof ? 1 : 0;
    exportTaggedCount += claim.exportTags.length > 0 ? 1 : 0;

    if (!claim.hasAuditProof) {
      proofDebtByRoute[claim.route] = (proofDebtByRoute[claim.route] || 0) + 1;
    }

    if (!FINAL_CLAIM_STATES.has(claim.status)) {
      const submittedMs = timestampToMs(claim.submittedAt, nowMs);
      const ageMinutes = minutesBetween(submittedMs, nowMs);
      const bucketId = claimAgeBucketId(ageMinutes);
      openAgeBuckets[bucketId] += 1;
      staleOpenClaimCount += ageMinutes > 240 ? 1 : 0;

      if (!oldestOpenClaim || submittedMs < oldestOpenClaim.submittedMs) {
        oldestOpenClaim = {
          claimId: claim.id,
          submittedAt: claim.submittedAt,
          ageMinutes,
          submittedMs
        };
      }
    }
  }

  const openCount = claims.length - finalCount;
  const positiveCount = claims.filter((claim) => POSITIVE_CLAIM_STATES.has(claim.status)).length;
  const finalClaims = claims.filter((claim) => FINAL_CLAIM_STATES.has(claim.status));
  const averageFinalizationMinutes = finalClaims.length === 0
    ? null
    : Number((
        finalClaims.reduce((total, claim) => {
          const submittedMs = timestampToMs(claim.submittedAt, nowMs);
          const updatedMs = timestampToMs(claim.updatedAt, submittedMs);
          return total + minutesBetween(submittedMs, updatedMs);
        }, 0) / finalClaims.length
      ).toFixed(2));

  return {
    totalClaims: claims.length,
    openClaims: openCount,
    finalClaims: finalCount,
    acceptanceRate: claims.length === 0 ? 0 : Number((positiveCount / claims.length).toFixed(4)),
    proofCoverageRate: claims.length === 0 ? 0 : Number((proofBackedCount / claims.length).toFixed(4)),
    exportTaggedClaims: exportTaggedCount,
    evidenceItems: evidence.length,
    byStatus,
    byRoute,
    byPriority,
    counters: {
      openAgeBuckets,
      staleOpenClaimCount,
      proofDebtClaims: claims.length - proofBackedCount,
      proofDebtByRoute,
      averageFinalizationMinutes,
      oldestOpenClaim: oldestOpenClaim
        ? {
            claimId: oldestOpenClaim.claimId,
            submittedAt: oldestOpenClaim.submittedAt,
            ageMinutes: oldestOpenClaim.ageMinutes
          }
        : null,
      exportableClaimCount: claims.filter((claim) =>
        claim.exportTags.length > 0 || FINAL_CLAIM_STATES.has(claim.status)
      ).length
    }
  };
}

function buildLifecycleState(claims, analytics, baseSettings, commands, persistedState, now) {
  const controlProjection = projectLifecycleControls(baseSettings, commands, persistedState, now, claims);
  const settings = controlProjection.settings;
  const commandEffectById = new Map(
    controlProjection.commandEffects.map((effect) => [effect.commandId, effect])
  );
  const validationErrors = settings.validation.filter((entry) => entry.severity === 'error');
  const openClaims = claims.filter((claim) => !FINAL_CLAIM_STATES.has(claim.status));
  const prooflessOpenClaims = openClaims.filter((claim) => !claim.hasAuditProof);
  const openClaimLimitReached = openClaims.length >= settings.maxOpenClaims;
  const disabledReason = !settings.enabled
    ? 'surface-disabled'
    : !settings.acceptNewClaims
      ? settings.draining
        ? 'claim-intake-draining'
        : 'claim-intake-disabled'
      : openClaimLimitReached
        ? 'open-claim-limit-reached'
        : validationErrors.length > 0
          ? 'settings-invalid'
          : null;
  const effectiveEnabled = !disabledReason;
  const commandReceipts = commands.map((command) => {
    const duplicateOfPersistedCommand = persistedState.persistedReceiptIndex.has(command.id);

    if (!command.known) {
      return {
        commandId: command.id,
        type: command.type || 'unknown',
        accepted: false,
        reason: 'unknown-lifecycle-command',
        requestedAt: command.requestedAt
      };
    }

    if (duplicateOfPersistedCommand) {
      return {
        commandId: command.id,
        type: command.type,
        accepted: true,
        idempotentReplay: true,
        reason: 'already-applied-from-persisted-state',
        requestedAt: command.requestedAt,
        actor: command.actor,
        proofOutput: {
          eventType: `claim-submit.lifecycle.${command.type}.replay`,
          surfaceId,
          generatedAt: now,
          replayedFromCheckpoint: persistedState.checkpoint.at
        }
      };
    }

    const commandEffect = commandEffectById.get(command.id);
    const blocked = commandEffect && !commandEffect.applied;

    return {
      commandId: command.id,
      type: command.type,
      accepted: !blocked,
      reason: blocked ? commandEffect.reason : 'accepted-for-kernel-dispatch',
      requestedAt: command.requestedAt,
      actor: command.actor,
      restartRecoveryBlocked: Boolean(commandEffect?.restartRecoveryBlocked),
      idempotentReplay: Boolean(commandEffect?.idempotentReplay),
      validationCodes: commandEffect?.validationCodes || [],
      projectedControls: commandEffect?.projectedControls || null,
      proofOutput: {
        eventType: `claim-submit.lifecycle.${command.type}`,
        surfaceId,
        generatedAt: now,
        appliedToProjectedControls: Boolean(commandEffect?.applied)
      }
    };
  });
  const replayedCommandCount = commandReceipts.filter((receipt) => receipt.idempotentReplay).length;
  const scheduleDue = settings.schedule.nextRunAt
    ? Date.parse(settings.schedule.nextRunAt) <= Date.parse(now)
    : false;
  const nextIntervalRunAt = settings.schedule.mode === 'interval'
    ? new Date(Date.parse(now) + settings.schedule.cadenceMinutes * 60000).toISOString()
    : null;
  const scheduleAction = settings.schedule.paused
    ? 'wait-for-schedule-resume'
    : settings.schedule.mode === 'off'
      ? 'no-schedule-configured'
      : scheduleDue
        ? 'dispatch-scheduled-claim-review'
        : 'wait-for-next-scheduled-review';
  const controlSurface = {
    contract: 'claim-submit.lifecycle-controls.v2',
    generatedAt: now,
    enabled: settings.enabled,
    acceptNewClaims: settings.acceptNewClaims,
    draining: Boolean(settings.draining),
    proofRequired: settings.proofRequired,
    exportOnFinal: settings.exportOnFinal,
    maxOpenClaims: settings.maxOpenClaims,
    openClaimCount: openClaims.length,
    remainingCapacity: Math.max(settings.maxOpenClaims - openClaims.length, 0),
    capacityPressure: settings.maxOpenClaims === 0
      ? 1
      : Number((openClaims.length / settings.maxOpenClaims).toFixed(4)),
    schedulerIntent: {
      mode: settings.schedule.mode,
      paused: settings.schedule.paused,
      due: scheduleDue && !settings.schedule.paused,
      nextRunAt: settings.schedule.nextRunAt,
      nextIntervalRunAt,
      pausedUntil: settings.schedule.pausedUntil
    },
    allowedCommands: [
      ...(settings.enabled ? ['disable'] : ['enable']),
      ...(settings.acceptNewClaims ? ['set-intake:false'] : ['set-intake:true']),
      ...(settings.proofRequired ? ['relax-proof'] : ['require-proof']),
      ...(settings.exportOnFinal ? ['set-export-policy:false'] : ['set-export-policy:true']),
      'set-capacity',
      ...(settings.schedule.mode === 'off' ? ['schedule'] : ['cancel-schedule', 'skip-scheduled-run']),
      ...(settings.schedule.paused ? ['resume'] : ['pause']),
      ...(analytics.totalClaims > 0 ? ['export-now'] : [])
    ],
    blockedCommandReasons: {
      exportNow: analytics.totalClaims > 0 ? null : 'no-claims-to-export',
      schedule: !settings.enabled ? 'surface-disabled' : null,
      intake: openClaimLimitReached ? 'open-claim-limit-reached' : null
    }
  };

  return {
    settings,
    controlSurface,
    effectiveEnabled,
    disabledReason,
    openClaimLimitReached,
    prooflessOpenClaimIds: prooflessOpenClaims.map((claim) => claim.id),
    commandReceipts,
    commandEffects: controlProjection.commandEffects,
    persistedRestart: {
      recovered: persistedState.hasPersistedState,
      checkpointAt: persistedState.checkpoint.at,
      checkpointSequence: persistedState.checkpoint.sequence,
      recoveredClaimCount: persistedState.recoveredClaims.length,
      retainedRecoveredClaimIds: persistedState.missingFromInput,
      requestOverrideClaimIds: persistedState.replacedFromInput,
      commandJournal: {
        recoveredReceiptCount: persistedState.commandJournal.entries.length,
        replayableCommandIds: persistedState.commandJournal.replayableCommandIds,
        pendingCommandIds: persistedState.commandJournal.pendingCommandIds,
        failedCommandIds: persistedState.commandJournal.failedCommandIds,
        duplicateCommandIds: persistedState.commandJournal.duplicateCommandIds,
        conflictingCommandIds: persistedState.commandJournal.conflictingCommandIds,
        reconciliationRequired: persistedState.commandJournal.pendingEntries.length > 0
          || persistedState.commandJournal.conflictingEntries.length > 0
      },
      replayedCommandCount,
      dispatchLease: persistedState.dispatchLease,
      status: persistedState.dispatchLease.expired
        ? 'lease-expired-reacquire-before-dispatch'
        : persistedState.commandJournal.conflictingEntries.length > 0
          ? 'command-journal-conflict-repair-required'
          : persistedState.commandJournal.pendingEntries.length > 0
            ? 'command-journal-reconciliation-required'
        : persistedState.hasPersistedState
          ? 'recovered-from-checkpoint'
          : 'cold-start'
    },
    scheduler: {
      mode: settings.schedule.mode,
      paused: settings.schedule.paused,
      nextRunAt: settings.schedule.nextRunAt,
      nextIntervalRunAt,
      due: scheduleDue && !settings.schedule.paused,
      action: scheduleAction
    },
    nextActionState: {
      primary: disabledReason
        ? disabledReason === 'claim-intake-draining'
          ? 'drain-open-claims-before-disable'
          : 'repair-claim-submit-controls'
        : settings.draining
          ? 'drain-open-claims-before-disable'
        : prooflessOpenClaims.length > 0 && settings.proofRequired
          ? 'collect-required-claim-proofs'
          : analytics.openClaims > 0
            ? 'review-open-claims'
            : settings.exportOnFinal && analytics.finalClaims > 0
              ? 'publish-final-claim-export'
              : 'await-claim-submission',
      enabledActions: [
        ...(effectiveEnabled ? ['submit-claim', 'queue-claim-review'] : []),
        ...(settings.enabled ? ['disable-surface'] : ['enable-surface']),
        ...(settings.draining ? ['complete-drain-disable'] : []),
        ...(openClaimLimitReached ? ['raise-open-claim-capacity'] : ['set-open-claim-capacity']),
        ...(settings.schedule.mode === 'off' ? ['schedule-review'] : ['cancel-schedule']),
        ...(settings.schedule.paused ? ['resume-schedule'] : ['pause-schedule']),
        ...(scheduleDue && !settings.schedule.paused ? ['run-scheduled-review', 'skip-scheduled-run'] : []),
        ...(analytics.totalClaims > 0 ? ['export-claim-ledger'] : [])
      ],
      blockedActions: [
        ...(!effectiveEnabled ? ['submit-claim', 'queue-claim-review'] : []),
        ...(settings.proofRequired && prooflessOpenClaims.length > 0 ? ['finalize-proofless-claims'] : [])
      ]
    }
  };
}

function buildHistorySnapshots(claims, now) {
  const sortedClaims = [...claims].sort((left, right) =>
    String(left.submittedAt).localeCompare(String(right.submittedAt))
  );
  let runningTotal = 0;
  let runningProofs = 0;
  let runningFinal = 0;
  const runningByStatus = Object.fromEntries([...KNOWN_CLAIM_STATES].map((status) => [status, 0]));

  const snapshots = sortedClaims.map((claim) => {
    runningTotal += 1;
    runningProofs += claim.hasAuditProof ? 1 : 0;
    runningFinal += FINAL_CLAIM_STATES.has(claim.status) ? 1 : 0;
    runningByStatus[claim.status] += 1;

    return {
      at: claim.submittedAt,
      claimId: claim.id,
      status: claim.status,
      cumulativeClaims: runningTotal,
      cumulativeProofBackedClaims: runningProofs,
      cumulativeFinalClaims: runningFinal,
      proofCoverageRate: Number((runningProofs / runningTotal).toFixed(4)),
      statusCounters: { ...runningByStatus },
      openClaims: sortedClaims
        .slice(0, runningTotal)
        .filter((entry) => !FINAL_CLAIM_STATES.has(entry.status)).length
    };
  });

  return snapshots.length > 0
    ? snapshots
    : [{
        at: now,
        claimId: null,
        status: 'empty',
        cumulativeClaims: 0,
        cumulativeProofBackedClaims: 0,
        cumulativeFinalClaims: 0,
        proofCoverageRate: 0,
        statusCounters: Object.fromEntries([...KNOWN_CLAIM_STATES].map((status) => [status, 0])),
        openClaims: 0
      }];
}

function buildExportSummary(claims, analytics, historySnapshots, now) {
  const columns = [
    'id',
    'claimantId',
    'subject',
    'tenantId',
    'workspaceId',
    'route',
    'status',
    'priority',
    'submittedAt',
    'updatedAt',
    'proofArtifactCount'
  ];
  const lastSnapshot = historySnapshots[historySnapshots.length - 1] || null;
  const prooflessClaimIds = claims.filter((claim) => !claim.hasAuditProof).map((claim) => claim.id);
  const finalClaimIds = claims.filter((claim) => FINAL_CLAIM_STATES.has(claim.status)).map((claim) => claim.id);
  const sortedRoutes = Object.keys(analytics.byRoute).sort();

  return {
    generatedAt: now,
    formatVersion: 1,
    dataset: 'claim-submit-analytics',
    rowCount: claims.length,
    columns,
    ready: claims.length > 0,
    partitionHints: {
      status: Object.keys(analytics.byStatus).filter((status) => analytics.byStatus[status] > 0),
      route: sortedRoutes,
      proofState: prooflessClaimIds.length > 0 ? ['proof-backed', 'proof-missing'] : ['proof-backed']
    },
    batchManifest: {
      contract: 'claim-submit.export.batch-manifest.v1',
      batchId: `claim-submit-${now.replace(/[:.]/g, '-')}`,
      recommendedFileName: `claim-submit-${now.slice(0, 10)}.json`,
      highWatermarkAt: lastSnapshot?.at || now,
      claimIdRange: {
        first: claims[0]?.id || null,
        last: claims[claims.length - 1]?.id || null
      },
      routeCount: sortedRoutes.length,
      finalClaimCount: finalClaimIds.length,
      prooflessClaimIds,
      qualityGates: {
        hasRows: claims.length > 0,
        noProofDebt: prooflessClaimIds.length === 0,
        noOpenStaleClaims: analytics.counters.staleOpenClaimCount === 0
      }
    },
    rows: claims.map((claim) => ({
      id: claim.id,
      claimantId: claim.claimantId,
      subject: claim.subject,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      route: claim.route,
      status: claim.status,
      priority: claim.priority,
      submittedAt: claim.submittedAt,
      updatedAt: claim.updatedAt,
      proofArtifactCount: claim.proofArtifactCount,
      exportEligible: claim.exportTags.length > 0 || FINAL_CLAIM_STATES.has(claim.status),
      proofState: claim.hasAuditProof ? 'proof-backed' : 'proof-missing'
    }))
  };
}

function buildTimeline(claims, evidence, now) {
  const claimEvents = claims.map((claim) => ({
    at: claim.submittedAt,
    type: 'claim.submitted',
    claimId: claim.id,
    route: claim.route,
    status: claim.status
  }));
  const proofEvents = evidence.map((entry, index) => ({
    at: entry?.at || entry?.timestamp || now,
    type: 'audit.evidence',
    evidenceId: String(entry?.id || entry?.proofId || `evidence-${index + 1}`),
    claimId: entry?.claimId ? String(entry.claimId) : null
  }));
  const reportingEvents = claims
    .filter((claim) => FINAL_CLAIM_STATES.has(claim.status) || claim.exportTags.length > 0)
    .map((claim) => ({
      at: claim.updatedAt || claim.submittedAt,
      type: FINAL_CLAIM_STATES.has(claim.status) ? 'claim.finalized' : 'claim.export-tagged',
      claimId: claim.id,
      route: claim.route,
      status: claim.status,
      exportTags: claim.exportTags
    }));

  return [...claimEvents, ...proofEvents, ...reportingEvents].sort((left, right) =>
    String(left.at).localeCompare(String(right.at))
  );
}

function buildReportingState(
  analytics,
  historySnapshots,
  exportSummary,
  submitPreview,
  operationalHealth,
  lifecycleState,
  clientNextStepContract,
  now
) {
  const lastSnapshot = historySnapshots[historySnapshots.length - 1];
  const proofDebtOpen = analytics.counters.proofDebtClaims > 0;
  const staleOpenClaims = analytics.counters.staleOpenClaimCount > 0;
  const reportHealth = operationalHealth.status === 'unhealthy'
    ? 'needs-operational-repair'
    : submitPreview.readiness === 'blocked'
      ? 'needs-attention'
      : staleOpenClaims
        ? 'stale-open-claims'
        : operationalHealth.status === 'degraded'
          ? 'degraded'
          : analytics.openClaims > 0
            ? 'active'
            : 'settled';

  return {
    contract: 'claim-submit.reporting-state.v2',
    health: reportHealth,
    lastSnapshotAt: lastSnapshot?.at || now,
    highWatermarkAt: exportSummary.batchManifest.highWatermarkAt,
    exportReady: exportSummary.ready,
    exportBatchId: exportSummary.batchManifest.batchId,
    needsProofAttention: proofDebtOpen,
    staleOpenClaimCount: analytics.counters.staleOpenClaimCount,
    oldestOpenClaim: analytics.counters.oldestOpenClaim,
    previewReady: submitPreview.ready,
    operationalRetryAfter: operationalHealth.failureState.retryAfter,
    nextActions: [
      clientNextStepContract.primaryStepId,
      lifecycleState.nextActionState.primary,
      ...(operationalHealth.actionableErrors.length > 0 ? ['repair-claim-submit-operational-health'] : []),
      ...(staleOpenClaims ? ['review-stale-open-claims'] : []),
      ...(analytics.openClaims > 0 ? ['review-open-claims'] : []),
      ...(proofDebtOpen ? ['attach-missing-claim-proofs'] : []),
      ...(lifecycleState.scheduler.due ? ['run-scheduled-claim-review'] : []),
      ...(exportSummary.ready ? ['publish-claim-submit-export'] : [])
    ].filter((action, index, actions) => action && actions.indexOf(action) === index)
  };
}

function buildValidationSummary(claims, lifecycleSettings, lifecycleState, persistedState, tenantBoundaryState) {
  const duplicateClaimIds = claims
    .map((claim) => claim.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const prooflessRequiredClaims = lifecycleSettings.proofRequired
    ? claims.filter((claim) => CLAIM_INTAKE_STATES.has(claim.status) && !claim.hasAuditProof).map((claim) => claim.id)
    : [];
  const nonIntakeClaims = claims
    .filter((claim) => !CLAIM_INTAKE_STATES.has(claim.status))
    .map((claim) => claim.id);
  const boundaryItems = tenantBoundaryState.claimAuthorizations.flatMap((entry) =>
    entry.blockers.map((blocker) => ({
      code: blocker,
      severity: 'error',
      path: `claims.${entry.claimId}.tenantBoundary`,
      message: blocker === 'tenant-boundary-violation'
        ? 'Claim tenant is outside the actor tenant boundary.'
        : blocker === 'workspace-boundary-violation'
          ? 'Claim workspace is outside the actor workspace boundary.'
          : blocker === 'workspace-submit-grant-missing'
            ? 'Claim does not match an active workspace submit grant for this actor, route, and priority.'
            : blocker === 'workspace-submit-grant-batch-limit'
              ? 'Workspace submit grant batch limit was reached before this claim could be authorized.'
              : 'Actor does not have permission to submit claims in this boundary.'
    }))
  );
  const validationItems = [
    ...lifecycleSettings.validation,
    ...persistedState.recoveryWarnings,
    ...boundaryItems,
    ...duplicateClaimIds.map((claimId) => ({
      code: 'duplicate-claim-id',
      severity: 'error',
      path: `claims.${claimId}.id`,
      message: 'Claim ids must be unique within a submit batch.'
    })),
    ...prooflessRequiredClaims.map((claimId) => ({
      code: 'missing-required-proof',
      severity: 'error',
      path: `claims.${claimId}.proofArtifacts`,
      message: 'Claim submit requires an audit proof artifact before intake.'
    })),
    ...nonIntakeClaims.map((claimId) => ({
      code: 'non-intake-claim-state',
      severity: 'warning',
      path: `claims.${claimId}.status`,
      message: 'Final or rejected claims are visible in the ledger but are not accepted for new intake.'
    })),
    ...(!lifecycleState.effectiveEnabled
      ? [{
          code: lifecycleState.disabledReason,
          severity: 'error',
          path: 'lifecycleState.effectiveEnabled',
          message: 'Claim submit intake is not currently ready to accept new claims.'
        }]
      : [])
  ];
  const bySeverity = validationItems.reduce((accumulator, item) => {
    accumulator[item.severity] = (accumulator[item.severity] || 0) + 1;
    return accumulator;
  }, { error: 0, warning: 0, info: 0 });

  return {
    valid: bySeverity.error === 0,
    errorCount: bySeverity.error,
    warningCount: bySeverity.warning,
    infoCount: bySeverity.info,
    blockingCodes: validationItems
      .filter((item) => item.severity === 'error')
      .map((item) => item.code),
    items: validationItems
  };
}

function buildOperationalHealth(runtime, lifecycleState, validationSummary, analytics, now) {
  const blockingValidationCodes = new Set(validationSummary.blockingCodes);
  const requiredDependencyFailures = runtime.dependencies.filter((dependency) =>
    dependency.required && ['down', 'unknown'].includes(dependency.status)
  );
  const transportUnavailable = ['down', 'unknown'].includes(runtime.transport.status);
  const retryBudgetExhausted = runtime.retryPolicy.attempt >= runtime.retryPolicy.retryBudget;
  const canRetry = !retryBudgetExhausted && (transportUnavailable || requiredDependencyFailures.length > 0);
  const actionableErrors = [
    ...(transportUnavailable
      ? [{
          code: 'claim-submit-transport-unavailable',
          severity: 'error',
          route: runtime.transport.route,
          retryable: canRetry,
          nextRetryAt: canRetry ? runtime.retryPolicy.nextRetryAt || now : null,
          action: canRetry ? 'retry-claim-submit-route' : 'escalate-claim-submit-transport',
          message: runtime.transport.lastErrorMessage || 'Claim submit transport is not available.'
        }]
      : []),
    ...requiredDependencyFailures.map((dependency) => ({
      code: 'claim-submit-required-dependency-unhealthy',
      severity: 'error',
      dependencyId: dependency.id,
      route: dependency.route || runtime.transport.route,
      retryable: canRetry,
      nextRetryAt: canRetry ? runtime.retryPolicy.nextRetryAt || now : null,
      action: dependency.lastErrorCode ? 'repair-failing-dependency' : 'confirm-dependency-health',
      message: 'A required claim-submit dependency is not healthy.'
    })),
    ...(lifecycleState.persistedRestart.dispatchLease.expired
      ? [{
          code: 'claim-submit-dispatch-lease-expired',
          severity: 'warning',
          route: 'kernel.claim.submit.lifecycle',
          retryable: true,
          nextRetryAt: now,
          action: 'reacquire-dispatch-lease-before-submit',
          message: 'Dispatch lease expired and must be reacquired before claim dispatch.'
        }]
      : []),
    ...([...blockingValidationCodes].map((code) => ({
      code: `claim-submit-validation-${code}`,
      severity: 'error',
      route: 'kernel.claim.submit.preview',
      retryable: false,
      nextRetryAt: null,
      action: 'repair-claim-submit-request',
      message: 'Claim submit request validation is blocking dispatch.'
    })))
  ];
  const degradedReasons = [
    ...(runtime.degradedMode ? [`runtime-${runtime.mode}`] : []),
    ...(runtime.transport.status === 'slow' ? ['transport-slow'] : []),
    ...runtime.dependencies
      .filter((dependency) => dependency.status === 'slow' || (!dependency.required && dependency.status !== 'ok'))
      .map((dependency) => `dependency-${dependency.id}-${dependency.status}`),
    ...(analytics.proofCoverageRate < 1 && analytics.totalClaims > 0 ? ['proof-coverage-incomplete'] : [])
  ];
  const status = actionableErrors.some((error) => error.severity === 'error')
    ? 'unhealthy'
    : degradedReasons.length > 0
      ? 'degraded'
      : lifecycleState.effectiveEnabled
        ? 'healthy'
        : 'disabled';

  return {
    contract: 'claim-submit.operational-health.v1',
    generatedAt: now,
    status,
    degraded: status === 'degraded',
    retryable: actionableErrors.some((error) => error.retryable),
    retryPolicy: runtime.retryPolicy,
    transport: runtime.transport,
    dependencySummary: {
      total: runtime.dependencies.length,
      requiredUnhealthy: requiredDependencyFailures.map((dependency) => dependency.id),
      slow: runtime.dependencies.filter((dependency) => dependency.status === 'slow').map((dependency) => dependency.id)
    },
    degradedReasons,
    actionableErrors,
    failureState: {
      acceptingNewClaims: lifecycleState.effectiveEnabled && status !== 'unhealthy',
      dispatchAllowed: status !== 'unhealthy' && !lifecycleState.persistedRestart.dispatchLease.expired,
      retryAfter: actionableErrors.find((error) => error.retryable)?.nextRetryAt || null,
      blockedRoutes: actionableErrors.map((error) => error.route).filter((route, index, routes) =>
        route && routes.indexOf(route) === index
      )
    }
  };
}

function routeMatchesHealthSignal(signalRoute, route) {
  if (!signalRoute || !route) {
    return false;
  }

  return signalRoute === route
    || route.startsWith(`${signalRoute}.`)
    || signalRoute.startsWith(`${route}.`);
}

function buildDispatchHealthGate(route, claim, operationalHealth, now) {
  const routeErrors = operationalHealth.actionableErrors.filter((error) =>
    routeMatchesHealthSignal(error.route, route)
  );
  const blockedByGlobalHealth = !operationalHealth.failureState.dispatchAllowed;
  const blockedByRouteError = routeErrors.some((error) => error.severity === 'error');
  const degradedPriorityHold = operationalHealth.status === 'degraded' && claim.priority !== 'high';
  const nextRetryAt = routeErrors.find((error) => error.retryable)?.nextRetryAt
    || operationalHealth.failureState.retryAfter
    || null;
  const recoveryActions = uniqueStrings([
    ...routeErrors.map((error) => error.action),
    ...(blockedByGlobalHealth ? ['repair-claim-submit-operational-health'] : []),
    ...(degradedPriorityHold ? ['wait-for-normal-health-or-raise-priority'] : [])
  ]);
  const holdReasons = uniqueStrings([
    ...(blockedByGlobalHealth ? ['operational-dispatch-blocked'] : []),
    ...(blockedByRouteError ? routeErrors.map((error) => error.code) : []),
    ...(degradedPriorityHold ? ['degraded-mode-priority-hold'] : [])
  ]);
  const dispatchAllowed = holdReasons.length === 0;

  return {
    contract: 'claim-submit.dispatch-health-gate.v1',
    route,
    status: dispatchAllowed
      ? operationalHealth.status === 'degraded'
        ? 'degraded-dispatch-allowed'
        : 'dispatch-allowed'
      : nextRetryAt
        ? 'held-until-retry-window'
        : 'held-until-health-repair',
    dispatchAllowed,
    degradedMode: operationalHealth.status === 'degraded',
    priorityPolicy: operationalHealth.status === 'degraded'
      ? 'high-priority-only'
      : 'all-accepted-claims',
    claimPriority: claim.priority,
    nextRetryAt,
    retryable: routeErrors.some((error) => error.retryable) || Boolean(nextRetryAt),
    holdReasons,
    recoveryActions,
    actionableErrorCodes: routeErrors.map((error) => error.code),
    clientMessage: dispatchAllowed
      ? 'Claim dispatch may proceed on this route.'
      : nextRetryAt
        ? 'Claim dispatch is held until the retry window or a health repair clears the route.'
        : 'Claim dispatch is held until claim-submit operational health is repaired.',
    proofOutput: {
      eventType: dispatchAllowed
        ? 'claim-submit.dispatch.health-gate.allowed'
        : 'claim-submit.dispatch.health-gate.held',
      surfaceId,
      generatedAt: now,
      route,
      claimId: claim.id,
      status: operationalHealth.status,
      holdReasonCount: holdReasons.length
    }
  };
}

function buildClaimPreview(claim, index, lifecycleSettings, lifecycleState, validationSummary, now) {
  const validationForClaim = validationSummary.items.filter((item) =>
    String(item.path || '').includes(`claims.${claim.id}.`)
  );
  const blockers = [
    ...(!lifecycleState.effectiveEnabled ? [lifecycleState.disabledReason] : []),
    ...(lifecycleSettings.proofRequired && !claim.hasAuditProof ? ['missing-required-proof'] : []),
    ...(!CLAIM_INTAKE_STATES.has(claim.status) ? ['non-intake-claim-state'] : []),
    ...(validationForClaim.filter((item) => item.severity === 'error').map((item) => item.code))
  ].filter((code, index, codes) => code && codes.indexOf(code) === index);
  const accepted = blockers.length === 0;
  const queuePosition = accepted ? index + 1 : null;

  return {
    claimId: claim.id,
    claimantId: claim.claimantId,
    subject: claim.subject,
    tenantId: claim.tenantId,
    workspaceId: claim.workspaceId,
    route: claim.route,
    status: claim.status,
    accepted,
    readiness: accepted ? 'ready-for-kernel-dispatch' : 'blocked-before-kernel-dispatch',
    queuePosition,
    blockers,
    warnings: validationForClaim.filter((item) => item.severity === 'warning').map((item) => item.code),
    acceptanceReceipt: accepted
      ? {
          receiptType: 'claim-submit.preview.acceptance.v1',
          surfaceId,
          eventType: 'claim-submit.preview.accepted',
          generatedAt: now,
          claimId: claim.id,
          tenantId: claim.tenantId,
          workspaceId: claim.workspaceId,
          dispatchRoute: claim.route,
          proofRequired: lifecycleSettings.proofRequired,
          proofArtifactCount: claim.proofArtifactCount
        }
      : null
  };
}

function buildSubmitPreview(claims, analytics, lifecycleSettings, lifecycleState, validationSummary, now) {
  const previews = claims.map((claim, index) =>
    buildClaimPreview(claim, index, lifecycleSettings, lifecycleState, validationSummary, now)
  );
  const acceptedPreviews = previews.filter((preview) => preview.accepted);
  const blockedPreviews = previews.filter((preview) => !preview.accepted);
  const readiness = validationSummary.valid && lifecycleState.effectiveEnabled && blockedPreviews.length === 0
    ? 'ready'
    : acceptedPreviews.length > 0
      ? 'partially-ready'
      : 'blocked';

  return {
    generatedAt: now,
    contract: 'claim-submit.preview.acceptance.v1',
    readiness,
    ready: readiness === 'ready',
    acceptedCount: acceptedPreviews.length,
    blockedCount: blockedPreviews.length,
    totalClaims: claims.length,
    validationSummary,
    intakeCapacity: {
      maxOpenClaims: lifecycleSettings.maxOpenClaims,
      openClaims: analytics.openClaims,
      remainingOpenClaimSlots: Math.max(lifecycleSettings.maxOpenClaims - analytics.openClaims, 0),
      limitReached: lifecycleState.openClaimLimitReached
    },
    previews
  };
}

function buildKernelDispatchPlan(submitPreview, claims, lifecycleState, operationalHealth, persistedState, now) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const dispatchAllowed = operationalHealth.failureState.dispatchAllowed && lifecycleState.effectiveEnabled;
  const acceptedPreviews = submitPreview.previews.filter((preview) => preview.accepted);
  const blockedPreviews = submitPreview.previews.filter((preview) => !preview.accepted);
  const globalBlockers = [
    ...(!lifecycleState.effectiveEnabled ? [lifecycleState.disabledReason] : []),
    ...(!operationalHealth.failureState.dispatchAllowed ? ['operational-dispatch-blocked'] : [])
  ].filter((code, index, codes) => code && codes.indexOf(code) === index);
  const envelopes = acceptedPreviews.map((preview, index) => {
    const claim = claimsById.get(preview.claimId);
    const dispatchHealthGate = buildDispatchHealthGate(
      claim?.route || preview.route,
      claim || { id: preview.claimId, priority: 'normal' },
      operationalHealth,
      now
    );
    const idempotencyKey = [
      surfaceId,
      claim?.tenantId || 'default-tenant',
      claim?.workspaceId || 'default-workspace',
      claim?.route || preview.route,
      preview.claimId,
      claim?.submittedAt || now,
      claim?.proofArtifactCount || 0
    ].join(':');
    const recoveredOutboxEntry = persistedState.dispatchOutbox.byIdempotencyKey.get(idempotencyKey)
      || persistedState.dispatchOutbox.byClaimId.get(preview.claimId)
      || null;
    const replayTerminalReceipt = recoveredOutboxEntry?.terminal || false;
    const restartReplay = Boolean(recoveredOutboxEntry && !replayTerminalReceipt);
    const status = replayTerminalReceipt
      ? 'completed'
      : restartReplay
        ? 'replay'
        : dispatchAllowed && dispatchHealthGate.dispatchAllowed
          ? 'ready'
          : 'held';
    const holdReasons = status === 'held'
      ? uniqueStrings([...globalBlockers, ...dispatchHealthGate.holdReasons])
      : restartReplay
        ? ['idempotent-dispatch-replay-from-persisted-outbox']
        : [];

    return {
      envelopeId: `claim-submit-dispatch-${index + 1}`,
      claimId: preview.claimId,
      route: claim?.route || preview.route,
      idempotencyKey,
      priority: claim?.priority || 'normal',
      status,
      restartReplay,
      persistedOutboxId: recoveredOutboxEntry?.outboxId || null,
      persistedOutboxStatus: recoveredOutboxEntry?.status || null,
      holdReasons,
      dispatchHealthGate,
      payloadContract: 'claim-submit.kernel-dispatch-envelope.v1',
      payload: {
        claimId: preview.claimId,
        claimantId: claim?.claimantId || preview.claimantId,
        subject: claim?.subject || preview.subject,
        tenantId: claim?.tenantId || 'default-tenant',
        workspaceId: claim?.workspaceId || 'default-workspace',
        submittedAt: claim?.submittedAt || now,
        proofArtifactCount: claim?.proofArtifactCount || 0,
        proofRequired: preview.acceptanceReceipt?.proofRequired ?? true,
        previewReceiptType: preview.acceptanceReceipt?.receiptType || null
      },
      proofOutput: {
        eventType: replayTerminalReceipt
          ? 'claim-submit.dispatch.completed-from-persisted-outbox'
          : restartReplay
            ? 'claim-submit.dispatch.replayed-from-persisted-outbox'
            : dispatchAllowed
              ? 'claim-submit.dispatch.enqueued'
              : 'claim-submit.dispatch.held',
        surfaceId,
        generatedAt: now,
        claimId: preview.claimId,
        tenantId: claim?.tenantId || 'default-tenant',
        workspaceId: claim?.workspaceId || 'default-workspace',
        idempotencyKey,
        acceptedPreviewReceipt: Boolean(preview.acceptanceReceipt),
        persistedOutboxId: recoveredOutboxEntry?.outboxId || null,
        healthGateStatus: dispatchHealthGate.status,
        retryableAfter: dispatchHealthGate.nextRetryAt
      }
    };
  });
  const blockedClaims = blockedPreviews.map((preview) => ({
    claimId: preview.claimId,
    route: preview.route,
    blockers: preview.blockers,
    proofOutput: {
      eventType: 'claim-submit.dispatch.blocked',
      surfaceId,
      generatedAt: now,
      claimId: preview.claimId,
      blockerCount: preview.blockers.length
    }
  }));
  const routeBatches = Object.values(envelopes.reduce((accumulator, envelope) => {
    const existing = accumulator[envelope.route] || {
      route: envelope.route,
      readyEnvelopeIds: [],
      heldEnvelopeIds: [],
      replayEnvelopeIds: [],
      completedEnvelopeIds: [],
      healthGateStatuses: [],
      nextRetryAt: null,
      claimIds: []
    };
    existing.claimIds.push(envelope.claimId);
    existing.healthGateStatuses = uniqueStrings([
      ...existing.healthGateStatuses,
      envelope.dispatchHealthGate.status
    ]);
    existing.nextRetryAt = existing.nextRetryAt || envelope.dispatchHealthGate.nextRetryAt;
    if (envelope.status === 'ready') {
      existing.readyEnvelopeIds.push(envelope.envelopeId);
    } else if (envelope.status === 'held') {
      existing.heldEnvelopeIds.push(envelope.envelopeId);
    } else if (envelope.status === 'replay') {
      existing.replayEnvelopeIds.push(envelope.envelopeId);
    } else if (envelope.status === 'completed') {
      existing.completedEnvelopeIds.push(envelope.envelopeId);
    }
    accumulator[envelope.route] = existing;
    return accumulator;
  }, {})).sort((left, right) => left.route.localeCompare(right.route));
  const replayedOutboxEnvelopes = envelopes.filter((envelope) => envelope.restartReplay);
  const completedFromOutboxEnvelopes = envelopes.filter((envelope) => envelope.status === 'completed');
  const healthHeldEnvelopes = envelopes.filter((envelope) =>
    envelope.dispatchHealthGate.holdReasons.length > 0
  );
  const retryableHeldEnvelopes = healthHeldEnvelopes.filter((envelope) =>
    envelope.dispatchHealthGate.retryable
  );

  return {
    contract: 'claim-submit.kernel-dispatch-plan.v1',
    generatedAt: now,
    dispatchAllowed,
    readiness: dispatchAllowed && envelopes.some((envelope) => envelope.status === 'ready')
      ? 'ready-to-dispatch'
      : replayedOutboxEnvelopes.length > 0
        ? 'restart-replay-pending'
        : completedFromOutboxEnvelopes.length > 0 && blockedPreviews.length === 0
          ? 'already-dispatched-from-persisted-outbox'
          : envelopes.length > 0
            ? 'held-before-dispatch'
            : 'nothing-to-dispatch',
    acceptedPreviewCount: acceptedPreviews.length,
    blockedPreviewCount: blockedPreviews.length,
    readyEnvelopeCount: envelopes.filter((envelope) => envelope.status === 'ready').length,
    heldEnvelopeCount: envelopes.filter((envelope) => envelope.status === 'held').length,
    replayedOutboxEnvelopeCount: replayedOutboxEnvelopes.length,
    completedOutboxEnvelopeCount: completedFromOutboxEnvelopes.length,
    healthHeldEnvelopeCount: healthHeldEnvelopes.length,
    retryableHeldEnvelopeCount: retryableHeldEnvelopes.length,
    blockedClaimCount: blockedClaims.length,
    globalBlockers,
    operationalDispatchPolicy: {
      contract: 'claim-submit.operational-dispatch-policy.v1',
      mode: operationalHealth.status === 'degraded'
        ? 'degraded-high-priority-only'
        : operationalHealth.status === 'unhealthy'
          ? 'blocked-until-health-repair'
          : 'normal',
      retryAfter: operationalHealth.failureState.retryAfter,
      healthHeldEnvelopeIds: healthHeldEnvelopes.map((envelope) => envelope.envelopeId),
      retryableEnvelopeIds: retryableHeldEnvelopes.map((envelope) => envelope.envelopeId),
      recoveryActions: uniqueStrings(healthHeldEnvelopes.flatMap((envelope) =>
        envelope.dispatchHealthGate.recoveryActions
      ))
    },
    restartRecovery: {
      recoveredOutboxCount: persistedState.dispatchOutbox.entries.length,
      replayableOutboxCount: persistedState.dispatchOutbox.replayableEntries.length,
      terminalOutboxCount: persistedState.dispatchOutbox.terminalEntries.length,
      replayEnvelopeIds: replayedOutboxEnvelopes.map((envelope) => envelope.envelopeId),
      completedEnvelopeIds: completedFromOutboxEnvelopes.map((envelope) => envelope.envelopeId)
    },
    routeBatches,
    envelopes,
    blockedClaims
  };
}

function buildClientRequestBinding(clientContext, claims, submitPreview, kernelDispatchPlan, now) {
  const claimIds = new Set(claims.map((claim) => claim.id));
  const requestedClaimIds = uniqueStrings(clientContext.requestedClaimIds);
  const scoped = requestedClaimIds.length > 0;
  const missingClaimIds = requestedClaimIds.filter((claimId) => !claimIds.has(claimId));
  const activeClaimIds = scoped
    ? requestedClaimIds.filter((claimId) => claimIds.has(claimId))
    : claims.map((claim) => claim.id);
  const activeClaimIdSet = new Set(activeClaimIds);
  const previewByClaimId = new Map(submitPreview.previews.map((preview) => [preview.claimId, preview]));
  const envelopeByClaimId = new Map(kernelDispatchPlan.envelopes.map((envelope) => [envelope.claimId, envelope]));
  const blockedClaimIds = activeClaimIds.filter((claimId) => {
    const preview = previewByClaimId.get(claimId);
    return preview && !preview.accepted;
  });
  const acceptedClaimIds = activeClaimIds.filter((claimId) => {
    const preview = previewByClaimId.get(claimId);
    return preview?.accepted;
  });
  const dispatchEnvelopeIds = activeClaimIds
    .map((claimId) => envelopeByClaimId.get(claimId)?.envelopeId)
    .filter(Boolean);
  const readyDispatchEnvelopeIds = activeClaimIds
    .map((claimId) => envelopeByClaimId.get(claimId))
    .filter((envelope) => envelope?.status === 'ready')
    .map((envelope) => envelope.envelopeId);
  const heldDispatchEnvelopeIds = activeClaimIds
    .map((claimId) => envelopeByClaimId.get(claimId))
    .filter((envelope) => envelope && ['held', 'replay', 'completed'].includes(envelope.status))
    .map((envelope) => envelope.envelopeId);
  const healthHeldDispatch = activeClaimIds
    .map((claimId) => envelopeByClaimId.get(claimId))
    .filter((envelope) =>
      envelope?.status === 'held' && envelope.dispatchHealthGate.holdReasons.length > 0
    )
    .map((envelope) => ({
      envelopeId: envelope.envelopeId,
      claimId: envelope.claimId,
      route: envelope.route,
      retryable: envelope.dispatchHealthGate.retryable,
      nextRetryAt: envelope.dispatchHealthGate.nextRetryAt,
      holdReasons: envelope.dispatchHealthGate.holdReasons,
      recoveryActions: envelope.dispatchHealthGate.recoveryActions
    }));
  const outOfScopeClaimIds = scoped
    ? claims.map((claim) => claim.id).filter((claimId) => !activeClaimIdSet.has(claimId))
    : [];
  const warnings = [
    ...(missingClaimIds.length > 0
      ? [{
          code: 'requested-claims-missing',
          severity: 'warning',
          path: 'client.requestedClaimIds',
          message: 'Some client-requested claim ids were not present in the hosted-kernel claim ledger.'
        }]
      : []),
    ...(scoped && activeClaimIds.length === 0
      ? [{
          code: 'requested-claims-empty-scope',
          severity: 'error',
          path: 'client.requestedClaimIds',
          message: 'No client-requested claim ids could be bound to this claim-submit request.'
        }]
      : [])
  ];

  return {
    contract: 'claim-submit.client-request-binding.v1',
    generatedAt: now,
    requestId: clientContext.requestId,
    scopeMode: scoped ? 'requested-claims' : 'all-claims',
    requestedClaimIds,
    activeClaimIds,
    acceptedClaimIds,
    blockedClaimIds,
    missingClaimIds,
    outOfScopeClaimIds,
    dispatchEnvelopeIds,
    readyDispatchEnvelopeIds,
    heldDispatchEnvelopeIds,
    healthHeldDispatch,
    retryableHealthHeldEnvelopeIds: healthHeldDispatch
      .filter((entry) => entry.retryable)
      .map((entry) => entry.envelopeId),
    nextRetryAt: healthHeldDispatch.find((entry) => entry.nextRetryAt)?.nextRetryAt || null,
    selectedCount: activeClaimIds.length,
    warnings,
    proofOutput: {
      eventType: missingClaimIds.length > 0
        ? 'claim-submit.client-request.partially-bound'
        : 'claim-submit.client-request.bound',
      surfaceId,
      generatedAt: now,
      requestId: clientContext.requestId,
      scopeMode: scoped ? 'requested-claims' : 'all-claims',
      requestedClaimCount: requestedClaimIds.length,
      selectedClaimCount: activeClaimIds.length,
      missingClaimCount: missingClaimIds.length
    }
  };
}

function buildClientWorkflowHandoff(step, clientContext, index, now) {
  const claimIds = asArray(step.claimIds).map(String);
  const basis = [
    surfaceId,
    clientContext.requestId,
    clientContext.sessionId || 'no-session',
    step.id,
    claimIds.join(',') || 'no-claims',
    clientContext.idempotencyKey || 'no-idempotency-key'
  ].join(':');

  return {
    contract: 'claim-submit.workflow-handoff.v1',
    handoffId: `claim-submit-handoff-${index + 1}`,
    generatedAt: now,
    requestId: clientContext.requestId,
    sessionId: clientContext.sessionId,
    actorId: clientContext.actorId,
    tenantId: clientContext.tenantId,
    workspaceId: clientContext.workspaceId,
    channel: clientContext.channel,
    mode: clientContext.handoffMode,
    continuationToken: clientContext.continuationToken,
    returnRoute: clientContext.returnRoute,
    stateCursor: clientContext.stateCursor,
    asyncReceiptExpected: clientContext.expectsAsyncReceipt,
    idempotencyKey: clientContext.idempotencyKey || basis,
    claimIds,
    proofOutput: {
      eventType: `claim-submit.client-handoff.${step.id}`,
      surfaceId,
      generatedAt: now,
      handoffId: `claim-submit-handoff-${index + 1}`,
      requestId: clientContext.requestId,
      stepId: step.id,
      enabled: step.enabled
    }
  };
}

function buildClientNextStepContract(
  submitPreview,
  lifecycleState,
  exportSummary,
  operationalHealth,
  clientContext,
  clientRequestBinding,
  now
) {
  const nextSteps = [];
  const scopedClaimIds = new Set(clientRequestBinding.activeClaimIds);
  const scopePreview = (preview) =>
    clientRequestBinding.scopeMode === 'all-claims' || scopedClaimIds.has(preview.claimId);
  const scopedAcceptedClaimIds = submitPreview.previews
    .filter((preview) => scopePreview(preview) && preview.accepted)
    .map((preview) => preview.claimId);
  const scopedBlockedClaimIds = submitPreview.previews
    .filter((preview) => scopePreview(preview) && !preview.accepted)
    .map((preview) => preview.claimId);

  if (scopedAcceptedClaimIds.length > 0) {
    nextSteps.push({
      id: 'accept-previewed-claims',
      label: 'Accept previewed claims',
      route: 'kernel.claim.submit.accept',
      method: 'POST',
      enabled: scopedBlockedClaimIds.length === 0 && clientRequestBinding.missingClaimIds.length === 0,
      requires: ['claimIds', 'acceptanceReceipts'],
      claimIds: scopedAcceptedClaimIds,
      dispatchEnvelopeIds: clientRequestBinding.readyDispatchEnvelopeIds
    });
  }

  if (scopedBlockedClaimIds.length > 0) {
    nextSteps.push({
      id: 'repair-blocked-claims',
      label: 'Repair blocked claims',
      route: 'kernel.claim.submit.preview',
      method: 'POST',
      enabled: true,
      requires: submitPreview.validationSummary.blockingCodes,
      claimIds: scopedBlockedClaimIds
    });
  }

  if (clientRequestBinding.missingClaimIds.length > 0) {
    nextSteps.push({
      id: 'reconcile-requested-claims',
      label: 'Reconcile requested claims',
      route: 'kernel.claim.submit.preview',
      method: 'POST',
      enabled: true,
      requires: ['client.requestedClaimIds'],
      claimIds: clientRequestBinding.missingClaimIds
    });
  }

  nextSteps.push({
    id: lifecycleState.scheduler.due ? 'run-scheduled-review' : 'observe-scheduler',
    label: lifecycleState.scheduler.due ? 'Run scheduled review' : 'Observe scheduler',
    route: 'kernel.claim.submit.lifecycle',
    method: 'POST',
    enabled: lifecycleState.scheduler.due,
    requires: lifecycleState.scheduler.due ? ['scheduleReceipt'] : []
  });

  if (exportSummary.ready) {
    nextSteps.push({
      id: 'publish-claim-ledger',
      label: 'Publish claim ledger',
      route: 'kernel.claim.submit.export',
      method: 'POST',
      enabled: true,
      requires: ['exportSummary']
    });
  }

  if (operationalHealth.actionableErrors.length > 0) {
    nextSteps.push({
      id: 'repair-operational-health',
      label: 'Repair operational health',
      route: 'kernel.claim.submit.health',
      method: 'POST',
      enabled: true,
      requires: operationalHealth.actionableErrors.map((error) => error.code)
    });
  }

  if (clientRequestBinding.healthHeldDispatch.length > 0) {
    nextSteps.push({
      id: clientRequestBinding.retryableHealthHeldEnvelopeIds.length > 0
        ? 'retry-health-held-dispatch'
        : 'await-operational-recovery',
      label: clientRequestBinding.retryableHealthHeldEnvelopeIds.length > 0
        ? 'Retry held dispatch'
        : 'Await operational recovery',
      route: 'kernel.claim.submit.dispatch',
      method: 'POST',
      enabled: clientRequestBinding.retryableHealthHeldEnvelopeIds.length > 0,
      requires: uniqueStrings(clientRequestBinding.healthHeldDispatch.flatMap((entry) =>
        entry.recoveryActions
      )),
      dispatchEnvelopeIds: clientRequestBinding.retryableHealthHeldEnvelopeIds,
      retryAfter: clientRequestBinding.nextRetryAt
    });
  }

  const stepsWithHandoff = nextSteps.map((step, index) => ({
    ...step,
    clientState: {
      requestId: clientContext.requestId,
      sessionId: clientContext.sessionId,
      actorId: clientContext.actorId,
      tenantId: clientContext.tenantId,
      workspaceId: clientContext.workspaceId,
      channel: clientContext.channel,
      handoffMode: clientContext.handoffMode,
      clientVisible: clientContext.clientVisible,
      claimScopeMode: clientRequestBinding.scopeMode,
      selectedClaimIds: clientRequestBinding.activeClaimIds,
      missingClaimIds: clientRequestBinding.missingClaimIds,
      dispatchEnvelopeIds: clientRequestBinding.dispatchEnvelopeIds,
      retryableHealthHeldEnvelopeIds: clientRequestBinding.retryableHealthHeldEnvelopeIds,
      nextRetryAt: clientRequestBinding.nextRetryAt,
      preferred: clientContext.preferredRoutes.length === 0
        || clientContext.preferredRoutes.includes(step.route)
    },
    handoff: buildClientWorkflowHandoff(step, clientContext, index, now)
  }));
  const preferredEnabledStep = stepsWithHandoff.find((step) =>
    step.enabled && step.clientState.preferred
  );
  const firstEnabledStep = stepsWithHandoff.find((step) => step.enabled);

  return {
    contract: 'claim-submit.client-next-steps.v2',
    clientContext,
    clientRequestBinding,
    primaryStepId: preferredEnabledStep?.id || firstEnabledStep?.id || null,
    primaryHandoffId: preferredEnabledStep?.handoff.handoffId || firstEnabledStep?.handoff.handoffId || null,
    pendingAsyncReceipt: clientContext.expectsAsyncReceipt
      ? stepsWithHandoff
          .filter((step) => step.enabled)
          .map((step) => ({
            handoffId: step.handoff.handoffId,
            route: step.route,
            stepId: step.id,
            requestId: clientContext.requestId,
            claimIds: asArray(step.claimIds).filter((claimId) =>
              clientRequestBinding.scopeMode === 'all-claims' || scopedClaimIds.has(claimId)
            ),
            dispatchEnvelopeIds: step.dispatchEnvelopeIds || []
          }))
      : [],
    nextSteps: stepsWithHandoff
  };
}

function buildUiAcceptanceDecisionContract(
  submitPreview,
  validationSummary,
  lifecycleState,
  kernelDispatchPlan,
  providerIntegrationState,
  clientNextStepContract,
  reportingState,
  now
) {
  const primaryStep = clientNextStepContract.nextSteps.find((step) =>
    step.id === clientNextStepContract.primaryStepId
  ) || null;
  const readyEnvelopeIds = kernelDispatchPlan.envelopes
    .filter((envelope) => envelope.status === 'ready')
    .map((envelope) => envelope.envelopeId);
  const heldEnvelopeIds = kernelDispatchPlan.envelopes
    .filter((envelope) => envelope.status === 'held')
    .map((envelope) => envelope.envelopeId);
  const replayEnvelopeIds = kernelDispatchPlan.envelopes
    .filter((envelope) => envelope.status === 'replay')
    .map((envelope) => envelope.envelopeId);
  const validationByClaimId = validationSummary.items.reduce((accumulator, item) => {
    const match = String(item.path || '').match(/^claims\.([^.]+)\./);
    if (match) {
      accumulator[match[1]] = accumulator[match[1]] || [];
      accumulator[match[1]].push({
        code: item.code,
        severity: item.severity,
        message: item.message
      });
    }
    return accumulator;
  }, {});
  const allBlockingCodes = uniqueStrings([
    ...validationSummary.blockingCodes,
    ...kernelDispatchPlan.globalBlockers,
    ...providerIntegrationState.validation
      .filter((item) => item.severity === 'error')
      .map((item) => item.code)
  ]);
  const providerBlocked = providerIntegrationState.unsupportedRoutes.length > 0
    || providerIntegrationState.blockedProviderHandoffCount > 0;
  const decision = submitPreview.ready && kernelDispatchPlan.readyEnvelopeCount > 0 && !providerBlocked
    ? 'accept-enabled'
    : submitPreview.acceptedCount > 0
      ? 'accept-partial-after-repair'
      : 'accept-blocked';
  const providerErrors = providerIntegrationState.validation
    .filter((item) => item.severity === 'error')
    .map((item) => ({
      code: item.code,
      route: item.route || null,
      providerId: item.providerId || null,
      message: item.message
    }));

  return {
    contract: 'claim-submit.ui-acceptance-decision.v1',
    generatedAt: now,
    decision,
    ready: decision === 'accept-enabled',
    headlineState: submitPreview.readiness,
    dispatchReadiness: kernelDispatchPlan.readiness,
    reportHealth: reportingState.health,
    primaryAction: primaryStep
      ? {
          id: primaryStep.id,
          label: primaryStep.label,
          route: primaryStep.route,
          method: primaryStep.method,
          enabled: primaryStep.enabled,
          handoffId: primaryStep.handoff?.handoffId || null,
          requires: primaryStep.requires || []
        }
      : null,
    disabledReasons: decision === 'accept-enabled'
      ? []
      : allBlockingCodes.length > 0
        ? allBlockingCodes
        : ['no-ready-dispatch-envelopes'],
    validationRollup: {
      valid: validationSummary.valid,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      infoCount: validationSummary.infoCount,
      blockingCodes: allBlockingCodes,
      firstBlockingMessage: validationSummary.items.find((item) => item.severity === 'error')?.message || null
    },
    acceptanceSummary: {
      acceptedCount: submitPreview.acceptedCount,
      blockedCount: submitPreview.blockedCount,
      totalClaims: submitPreview.totalClaims,
      remainingOpenClaimSlots: submitPreview.intakeCapacity.remainingOpenClaimSlots,
      openClaimLimitReached: submitPreview.intakeCapacity.limitReached,
      lifecycleEnabled: lifecycleState.effectiveEnabled,
      lifecycleDisabledReason: lifecycleState.disabledReason
    },
    dispatchSummary: {
      readyEnvelopeIds,
      heldEnvelopeIds,
      replayEnvelopeIds,
      readyEnvelopeCount: kernelDispatchPlan.readyEnvelopeCount,
      heldEnvelopeCount: kernelDispatchPlan.heldEnvelopeCount,
      retryableHeldEnvelopeCount: kernelDispatchPlan.retryableHeldEnvelopeCount,
      providerReadyHandoffCount: providerIntegrationState.readyProviderHandoffCount,
      providerBlockedHandoffCount: providerIntegrationState.blockedProviderHandoffCount,
      providerRecoveredHandoffCount: providerIntegrationState.recoveredProviderHandoffCount,
      providerPendingAckCount: providerIntegrationState.pendingProviderAckCount,
      providerSyncBacklogCount: providerIntegrationState.syncMetadata.backlogCount,
      unsupportedRoutes: providerIntegrationState.unsupportedRoutes,
      providerErrors
    },
    claimRows: submitPreview.previews.map((preview) => {
      const envelope = kernelDispatchPlan.envelopes.find((entry) => entry.claimId === preview.claimId) || null;
      return {
        claimId: preview.claimId,
        subject: preview.subject,
        route: preview.route,
        status: preview.status,
        accepted: preview.accepted,
        readiness: preview.readiness,
        queuePosition: preview.queuePosition,
        blockers: preview.blockers,
        warnings: preview.warnings,
        validation: validationByClaimId[preview.claimId] || [],
        envelopeId: envelope?.envelopeId || null,
        envelopeStatus: envelope?.status || 'not-created',
        providerHandoffId: providerIntegrationState.handoffs.find((handoff) =>
          handoff.claimId === preview.claimId
        )?.handoffId || null,
        explain: preview.accepted
          ? envelope?.status === 'ready'
            ? 'Preview accepted and dispatch envelope is ready.'
            : envelope?.status === 'replay'
              ? 'Preview accepted and dispatch will replay from persisted outbox.'
              : 'Preview accepted but dispatch is waiting for health or provider readiness.'
          : 'Preview is blocked by validation or lifecycle controls.'
      };
    }),
    proofOutput: {
      eventType: decision === 'accept-enabled'
        ? 'claim-submit.ui.acceptance.enabled'
        : 'claim-submit.ui.acceptance.blocked',
      surfaceId,
      generatedAt: now,
      acceptedCount: submitPreview.acceptedCount,
      blockedCount: submitPreview.blockedCount,
      readyEnvelopeCount: kernelDispatchPlan.readyEnvelopeCount,
      blockingCodeCount: allBlockingCodes.length
    }
  };
}

function validationSummaryByArea(items) {
  const areaForPath = (path) => {
    const value = String(path || '');
    if (value.startsWith('claims.')) return 'claims';
    if (value.startsWith('settings.') || value.startsWith('lifecycle')) return 'lifecycle';
    if (value.startsWith('persistedState.')) return 'recovery';
    if (value.startsWith('integrationProviders.') || value.startsWith('providerIntegrationState.')) return 'provider';
    if (value.startsWith('client.')) return 'client';
    return 'surface';
  };
  const grouped = items.reduce((accumulator, item) => {
    const area = areaForPath(item.path);
    const existing = accumulator[area] || {
      area,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      codes: [],
      firstMessage: null
    };
    existing[`${item.severity}Count`] = (existing[`${item.severity}Count`] || 0) + 1;
    existing.codes = uniqueStrings([...existing.codes, item.code]);
    existing.firstMessage = existing.firstMessage || item.message || null;
    accumulator[area] = existing;
    return accumulator;
  }, {});

  return Object.values(grouped).sort((left, right) =>
    left.area.localeCompare(right.area)
  );
}

function buildUiReviewPacket(
  uiAcceptanceDecision,
  submitPreview,
  clientNextStepContract,
  providerIntegrationState,
  operationalHealth,
  reportingState,
  now
) {
  const validationGroups = validationSummaryByArea(submitPreview.validationSummary.items);
  const enabledNextSteps = clientNextStepContract.nextSteps.filter((step) => step.enabled);
  const disabledNextSteps = clientNextStepContract.nextSteps.filter((step) => !step.enabled);
  const claimRowsByState = uiAcceptanceDecision.claimRows.reduce((accumulator, row) => {
    const state = row.accepted ? row.envelopeStatus : 'blocked';
    accumulator[state] = (accumulator[state] || 0) + 1;
    return accumulator;
  }, {});
  const providerAckState = providerIntegrationState.pendingProviderAckCount > 0
    ? 'awaiting-provider-ack'
    : providerIntegrationState.blockedProviderHandoffCount > 0
      ? 'provider-contract-blocked'
      : providerIntegrationState.readyProviderHandoffCount > 0
        ? 'provider-handoff-ready'
        : 'no-provider-handoff-needed';

  return {
    contract: 'claim-submit.ui-review-packet.v1',
    generatedAt: now,
    visibleState: {
      decision: uiAcceptanceDecision.decision,
      ready: uiAcceptanceDecision.ready,
      headlineState: uiAcceptanceDecision.headlineState,
      reportHealth: reportingState.health,
      providerAckState,
      operationalStatus: operationalHealth.status
    },
    acceptanceControls: {
      primaryAction: uiAcceptanceDecision.primaryAction,
      enabledActionIds: enabledNextSteps.map((step) => step.id),
      disabledActionIds: disabledNextSteps.map((step) => step.id),
      disabledReasons: uiAcceptanceDecision.disabledReasons,
      requiresAsyncReceipt: clientNextStepContract.pendingAsyncReceipt.length > 0,
      pendingAsyncReceipt: clientNextStepContract.pendingAsyncReceipt
    },
    readinessSummary: {
      acceptedClaims: submitPreview.acceptedCount,
      blockedClaims: submitPreview.blockedCount,
      totalClaims: submitPreview.totalClaims,
      readyDispatchEnvelopes: uiAcceptanceDecision.dispatchSummary.readyEnvelopeCount,
      heldDispatchEnvelopes: uiAcceptanceDecision.dispatchSummary.heldEnvelopeCount,
      retryableHeldEnvelopes: uiAcceptanceDecision.dispatchSummary.retryableHeldEnvelopeCount,
      providerBlockedHandoffs: uiAcceptanceDecision.dispatchSummary.providerBlockedHandoffCount,
      rowStates: claimRowsByState
    },
    validationSummary: {
      valid: uiAcceptanceDecision.validationRollup.valid,
      errorCount: uiAcceptanceDecision.validationRollup.errorCount,
      warningCount: uiAcceptanceDecision.validationRollup.warningCount,
      infoCount: uiAcceptanceDecision.validationRollup.infoCount,
      firstBlockingMessage: uiAcceptanceDecision.validationRollup.firstBlockingMessage,
      groups: validationGroups
    },
    nextStepExplanations: clientNextStepContract.nextSteps.map((step) => ({
      stepId: step.id,
      route: step.route,
      method: step.method,
      enabled: step.enabled,
      handoffId: step.handoff?.handoffId || null,
      claimIds: asArray(step.claimIds),
      dispatchEnvelopeIds: step.dispatchEnvelopeIds || [],
      explanation: step.enabled
        ? 'This step can be invoked by the client with the attached handoff contract.'
        : asArray(step.requires).length > 0
          ? 'This step is waiting for required claim-submit data or repair actions.'
          : 'This step is currently informational and has no enabled route action.'
    })),
    proofOutput: {
      eventType: uiAcceptanceDecision.ready
        ? 'claim-submit.ui.review.ready'
        : 'claim-submit.ui.review.needs-action',
      surfaceId,
      generatedAt: now,
      decision: uiAcceptanceDecision.decision,
      acceptedClaimCount: submitPreview.acceptedCount,
      blockedClaimCount: submitPreview.blockedCount,
      enabledNextStepCount: enabledNextSteps.length,
      validationGroupCount: validationGroups.length,
      providerAckState
    }
  };
}

function normalizeProviderServiceContract(entry) {
  const service = asObject(entry.service || entry.serviceContract || entry.sla);
  const rawCapabilities = normalizeStringList(entry.capabilities || entry.supportedCapabilities || entry.contracts);
  const deliveryGuarantee = PROVIDER_DELIVERY_GUARANTEES.has(service.deliveryGuarantee)
    ? service.deliveryGuarantee
    : rawCapabilities.includes('idempotent-submit')
      ? 'exactly-once'
      : 'at-least-once';
  const maxBatchSize = normalizePositiveInteger(service.maxBatchSize || entry.maxBatchSize, 50);
  const maxInFlight = normalizePositiveInteger(service.maxInFlight || entry.maxInFlight, 25);
  const receiptTtlMinutes = normalizePositiveInteger(service.receiptTtlMinutes, 1440);
  const timeoutMs = normalizePositiveInteger(service.timeoutMs || entry.timeoutMs, 15000);
  const endpoint = asObject(entry.endpoint || service.endpoint || entry.delivery);
  const endpointUrl = endpoint.url || endpoint.uri || endpoint.href;

  return {
    contract: 'claim-submit.provider-service-contract.v1',
    deliveryGuarantee,
    maxBatchSize,
    maxInFlight,
    receiptTtlMinutes,
    timeoutMs,
    endpoint: {
      type: ['webhook', 'queue', 'poll', 'internal'].includes(endpoint.type)
        ? endpoint.type
        : null,
      url: endpointUrl ? String(endpointUrl) : null,
      queueName: endpoint.queueName || endpoint.queue ? String(endpoint.queueName || endpoint.queue) : null,
      ackRoute: endpoint.ackRoute ? String(endpoint.ackRoute) : null
    },
    requiresAck: normalizeBoolean(service.requiresAck, deliveryGuarantee !== 'at-most-once'),
    supportsBatching: normalizeBoolean(service.supportsBatching, maxBatchSize > 1)
  };
}

function normalizeProviderHandoffLedger(input, now) {
  const persisted = asObject(
    input.persistedState || input.recoveredState || input.claimSubmitState || input.state
  );
  const rawLedger = asArray(
    persisted.providerHandoffs
      || persisted.externalHandoffs
      || input.providerHandoffLedger
      || input.externalHandoffState
  );
  const entries = rawLedger.map((entry, index) => {
    const item = asObject(entry);
    const status = ['ready', 'sent', 'acked', 'failed', 'held', 'cancelled'].includes(item.status)
      ? item.status
      : 'sent';
    const idempotencyKey = item.idempotencyKey || item.key || item.dispatchKey;
    const lastTransitionAt = item.lastTransitionAt || item.updatedAt || item.sentAt || item.ackedAt;

    return {
      handoffId: String(item.handoffId || item.id || `provider-handoff-ledger-${index + 1}`),
      providerId: item.providerId ? String(item.providerId) : null,
      claimId: item.claimId ? String(item.claimId) : null,
      envelopeId: item.envelopeId ? String(item.envelopeId) : null,
      route: item.route ? String(item.route) : null,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      status,
      terminal: ['acked', 'failed', 'cancelled'].includes(status),
      attempt: normalizeNonNegativeInteger(item.attempt || item.attemptCount, 0),
      receiptId: item.receiptId || item.providerReceiptId ? String(item.receiptId || item.providerReceiptId) : null,
      lastTransitionAt: isIsoTimestamp(lastTransitionAt) ? lastTransitionAt : null,
      recoveredAt: now
    };
  });

  return {
    entries,
    byIdempotencyKey: new Map(entries
      .filter((entry) => entry.idempotencyKey)
      .map((entry) => [entry.idempotencyKey, entry])),
    byEnvelopeId: new Map(entries
      .filter((entry) => entry.envelopeId)
      .map((entry) => [entry.envelopeId, entry])),
    pendingEntries: entries.filter((entry) => !entry.terminal),
    terminalEntries: entries.filter((entry) => entry.terminal)
  };
}

function normalizeProviderContracts(input, now) {
  const rawProviders = asArray(
    input.integrationProviders || input.providers || input.serviceContracts || input.externalProviders
  );
  const providers = rawProviders.length > 0
    ? rawProviders
    : [{
        id: 'hosted-kernel-dispatch',
        routePrefixes: ['kernel.claim.submit'],
        capabilities: ['claim-dispatch', 'audit-proof', 'async-receipt', 'idempotent-submit', 'claim-export'],
        status: 'ok',
        handoffMode: 'queue',
        sync: { cursor: null, lastSyncedAt: null }
      }];

  return providers.map((provider, index) => {
    const entry = asObject(provider);
    const sync = asObject(entry.sync || entry.syncMetadata || entry.checkpoint);
    const serviceContract = normalizeProviderServiceContract(entry);
    const capabilities = uniqueStrings(
      normalizeStringList(entry.capabilities || entry.supportedCapabilities || entry.contracts)
        .filter((capability) => PROVIDER_CAPABILITIES.has(capability))
    );
    const routePrefixes = uniqueStrings(
      normalizeStringList(entry.routePrefixes || entry.routes || entry.routeContracts)
    );
    const status = PROVIDER_STATUSES.has(entry.status) ? entry.status : 'unknown';
    const handoffMode = PROVIDER_HANDOFF_MODES.has(entry.handoffMode)
      ? entry.handoffMode
      : PROVIDER_HANDOFF_MODES.has(entry.externalHandoffMode)
        ? entry.externalHandoffMode
        : 'none';

    return {
      contract: 'claim-submit.integration-provider.v1',
      providerId: String(entry.id || entry.providerId || entry.name || `claim-submit-provider-${index + 1}`),
      displayName: String(entry.displayName || entry.name || entry.id || `Claim Submit Provider ${index + 1}`),
      status,
      enabled: normalizeBoolean(entry.enabled, status !== 'disabled'),
      routePrefixes: routePrefixes.length > 0 ? routePrefixes : ['kernel.claim.submit'],
      capabilities,
      missingRequiredCapabilities: ['claim-dispatch', 'idempotent-submit'].filter((capability) =>
        !capabilities.includes(capability)
      ),
      serviceContract,
      handoffMode,
      receiptContract: entry.receiptContract
        ? String(entry.receiptContract)
        : capabilities.includes('async-receipt')
          ? 'claim-submit.provider.async-receipt.v1'
          : 'claim-submit.provider.sync-receipt.v1',
      sync: {
        cursor: sync.cursor || sync.stateCursor ? String(sync.cursor || sync.stateCursor) : null,
        lastSyncedAt: isIsoTimestamp(sync.lastSyncedAt || sync.syncedAt) ? sync.lastSyncedAt || sync.syncedAt : null,
        watermarkAt: isIsoTimestamp(sync.watermarkAt || sync.highWatermarkAt)
          ? sync.watermarkAt || sync.highWatermarkAt
          : null,
        sequence: normalizeNonNegativeInteger(sync.sequence || sync.revision, 0),
        source: sync.source ? String(sync.source) : 'provider-contract'
      },
      generatedAt: now
    };
  });
}

function providerSupportsRoute(provider, route) {
  return provider.enabled
    && provider.status !== 'down'
    && provider.status !== 'disabled'
    && provider.capabilities.includes('claim-dispatch')
    && provider.capabilities.includes('idempotent-submit')
    && provider.routePrefixes.some((prefix) => routeMatchesHealthSignal(prefix, route));
}

function buildProviderIntegrationState(
  providerContracts,
  kernelDispatchPlan,
  exportSummary,
  clientContext,
  providerHandoffLedger,
  now
) {
  const providersByRoute = new Map();
  const negotiation = kernelDispatchPlan.routeBatches.map((batch) => {
    const candidates = providerContracts.filter((provider) => providerSupportsRoute(provider, batch.route));
    const selectedProvider = candidates.find((provider) => provider.status === 'ok') || candidates[0] || null;
    const optionalCapabilityGaps = selectedProvider
      ? [
          ...(batch.replayEnvelopeIds.length > 0 && !selectedProvider.capabilities.includes('async-receipt')
            ? ['async-receipt']
            : []),
          ...(exportSummary.ready && !selectedProvider.capabilities.includes('claim-export')
            ? ['claim-export']
            : []),
          ...(!selectedProvider.capabilities.includes('audit-proof') ? ['audit-proof'] : [])
        ]
      : [];

    if (selectedProvider) {
      providersByRoute.set(batch.route, selectedProvider);
    }

    return {
      route: batch.route,
      selectedProviderId: selectedProvider?.providerId || null,
      availableProviderIds: candidates.map((provider) => provider.providerId),
      capabilityState: selectedProvider ? 'capability-negotiated' : 'missing-provider-capability',
      requiredCapabilities: ['claim-dispatch', 'idempotent-submit'],
      optionalCapabilityGaps,
      serviceContract: selectedProvider?.serviceContract || null,
      maxBatchSize: selectedProvider?.serviceContract.maxBatchSize || null,
      readyEnvelopeIds: batch.readyEnvelopeIds,
      heldEnvelopeIds: batch.heldEnvelopeIds,
      replayEnvelopeIds: batch.replayEnvelopeIds,
      nextRetryAt: batch.nextRetryAt
    };
  });
  const unsupportedRoutes = negotiation
    .filter((entry) => !entry.selectedProviderId)
    .map((entry) => entry.route);
  const handoffEnvelopes = kernelDispatchPlan.envelopes
    .filter((envelope) => ['ready', 'replay'].includes(envelope.status))
    .map((envelope, index) => {
      const provider = providersByRoute.get(envelope.route) || null;
      const recoveredHandoff = providerHandoffLedger.byIdempotencyKey.get(envelope.idempotencyKey)
        || providerHandoffLedger.byEnvelopeId.get(envelope.envelopeId)
        || null;
      const handoffState = provider && provider.handoffMode !== 'none'
        ? recoveredHandoff?.terminal
          ? `provider-${recoveredHandoff.status}`
          : recoveredHandoff
            ? 'resume-external-provider-handoff'
            : 'ready-for-external-provider'
        : provider
          ? 'provider-sync-only'
          : 'awaiting-provider-contract';
      const attempt = recoveredHandoff
        ? recoveredHandoff.attempt + (recoveredHandoff.terminal ? 0 : 1)
        : envelope.restartReplay
          ? 1
          : 0;
      const serviceContract = provider?.serviceContract || null;

      return {
        contract: 'claim-submit.external-provider-handoff.v1',
        handoffId: `claim-submit-provider-handoff-${index + 1}`,
        generatedAt: now,
        providerId: provider?.providerId || null,
        route: envelope.route,
        claimId: envelope.claimId,
        envelopeId: envelope.envelopeId,
        idempotencyKey: envelope.idempotencyKey,
        status: handoffState,
        handoffMode: provider?.handoffMode || 'none',
        receiptContract: provider?.receiptContract || null,
        serviceContract,
        deliveryGuarantee: serviceContract?.deliveryGuarantee || null,
        attempt,
        recoveredHandoffId: recoveredHandoff?.handoffId || null,
        recoveredReceiptId: recoveredHandoff?.receiptId || null,
        recoveredStatus: recoveredHandoff?.status || null,
        terminal: Boolean(recoveredHandoff?.terminal),
        asyncReceiptExpected: Boolean(provider?.capabilities.includes('async-receipt')),
        syncCursor: provider?.sync.cursor || null,
        syncSequence: provider ? provider.sync.sequence + 1 : null,
        clientRequestId: clientContext.requestId,
        externalState: {
          state: handoffState,
          awaitingAck: Boolean(provider && serviceContract?.requiresAck && !recoveredHandoff?.terminal),
          ackRoute: serviceContract?.endpoint.ackRoute || null,
          expiresAt: serviceContract
            ? new Date(Date.parse(now) + serviceContract.receiptTtlMinutes * 60000).toISOString()
            : null,
          nextPollAt: provider?.handoffMode === 'poll'
            ? new Date(Date.parse(now) + 60000).toISOString()
            : null
        },
        proofOutput: {
          eventType: provider
            ? recoveredHandoff
              ? 'claim-submit.provider-handoff.recovered'
              : 'claim-submit.provider-handoff.negotiated'
            : 'claim-submit.provider-handoff.blocked',
          surfaceId,
          generatedAt: now,
          handoffId: `claim-submit-provider-handoff-${index + 1}`,
          claimId: envelope.claimId,
          providerId: provider?.providerId || null,
          route: envelope.route,
          recoveredHandoffId: recoveredHandoff?.handoffId || null,
          deliveryGuarantee: serviceContract?.deliveryGuarantee || null
        }
      };
    });
  const nextSyncSequence = Math.max(0, ...providerContracts.map((provider) => provider.sync.sequence)) + 1;
  const pendingHandoffs = handoffEnvelopes.filter((handoff) =>
    ['ready-for-external-provider', 'resume-external-provider-handoff', 'provider-sync-only'].includes(handoff.status)
  );
  const ackedHandoffs = handoffEnvelopes.filter((handoff) => handoff.status === 'provider-acked');

  return {
    contract: 'claim-submit.provider-integration-state.v1',
    generatedAt: now,
    providers: providerContracts,
    negotiation,
    unsupportedRoutes,
    readyProviderHandoffCount: handoffEnvelopes
      .filter((handoff) => handoff.status === 'ready-for-external-provider')
      .length,
    blockedProviderHandoffCount: handoffEnvelopes
      .filter((handoff) => handoff.status === 'awaiting-provider-contract')
      .length,
    recoveredProviderHandoffCount: handoffEnvelopes
      .filter((handoff) => handoff.recoveredHandoffId)
      .length,
    pendingProviderAckCount: handoffEnvelopes
      .filter((handoff) => handoff.externalState.awaitingAck)
      .length,
    syncMetadata: {
      contract: 'claim-submit.provider-sync-metadata.v1',
      highWatermarkAt: exportSummary.batchManifest.highWatermarkAt,
      nextSequence: nextSyncSequence,
      providerCount: providerContracts.length,
      routeCount: kernelDispatchPlan.routeBatches.length,
      exportBatchId: exportSummary.batchManifest.batchId,
      syncRequired: handoffEnvelopes.length > 0 || exportSummary.ready,
      pendingHandoffIds: pendingHandoffs.map((handoff) => handoff.handoffId),
      ackedHandoffIds: ackedHandoffs.map((handoff) => handoff.handoffId),
      recoveredPendingHandoffIds: providerHandoffLedger.pendingEntries.map((entry) => entry.handoffId),
      backlogCount: pendingHandoffs.length + providerHandoffLedger.pendingEntries.length,
      stateCursor: [
        surfaceId,
        clientContext.requestId,
        exportSummary.batchManifest.batchId,
        nextSyncSequence
      ].join(':')
    },
    handoffs: handoffEnvelopes,
    validation: [
      ...providerContracts.flatMap((provider) =>
        provider.missingRequiredCapabilities.map((capability) => ({
          code: 'provider-missing-required-capability',
          severity: 'warning',
          path: `integrationProviders.${provider.providerId}.capabilities`,
          providerId: provider.providerId,
          capability,
          message: 'Provider contract is missing a capability required for claim-submit dispatch.'
        }))
      ),
      ...unsupportedRoutes.map((route) => ({
        code: 'route-without-provider-contract',
        severity: 'error',
        path: `kernelDispatchPlan.routeBatches.${route}`,
        route,
        message: 'No enabled provider contract can accept idempotent claim-submit dispatch for this route.'
      })),
      ...negotiation.flatMap((entry) =>
        entry.optionalCapabilityGaps.map((capability) => ({
          code: 'provider-optional-capability-gap',
          severity: 'info',
          path: `integrationProviders.${entry.selectedProviderId}.capabilities`,
          providerId: entry.selectedProviderId,
          route: entry.route,
          capability,
          message: 'Provider can dispatch claims but lacks an optional claim-submit integration capability.'
        }))
      ),
      ...handoffEnvelopes
        .filter((handoff) => handoff.externalState.awaitingAck && !handoff.asyncReceiptExpected)
        .map((handoff) => ({
          code: 'provider-ack-required-without-async-receipt',
          severity: 'warning',
          path: `providerIntegrationState.handoffs.${handoff.handoffId}`,
          providerId: handoff.providerId,
          route: handoff.route,
          message: 'Provider service contract requires an acknowledgement but did not negotiate async receipts.'
        })),
      ...providerHandoffLedger.pendingEntries
        .filter((entry) => !handoffEnvelopes.some((handoff) => handoff.recoveredHandoffId === entry.handoffId))
        .map((entry) => ({
          code: 'orphaned-provider-handoff-recovery',
          severity: 'warning',
          path: 'persistedState.providerHandoffs',
          providerId: entry.providerId,
          route: entry.route,
          message: 'Recovered provider handoff could not be matched to a current dispatch envelope.'
        }))
    ]
  };
}

function buildOperationalRecoveryRegister(
  operationalHealth,
  kernelDispatchPlan,
  providerIntegrationState,
  clientRequestBinding,
  now
) {
  const retryableErrors = operationalHealth.actionableErrors.filter((error) => error.retryable);
  const heldEnvelopes = kernelDispatchPlan.envelopes.filter((envelope) => envelope.status === 'held');
  const providerBlockedHandoffs = providerIntegrationState.handoffs.filter((handoff) =>
    handoff.status === 'awaiting-provider-contract'
  );
  const providerAckHandoffs = providerIntegrationState.handoffs.filter((handoff) =>
    handoff.externalState.awaitingAck
  );
  const retryAfterValues = uniqueStrings([
    operationalHealth.failureState.retryAfter,
    clientRequestBinding.nextRetryAt,
    ...heldEnvelopes.map((envelope) => envelope.dispatchHealthGate.nextRetryAt),
    ...providerIntegrationState.negotiation.map((entry) => entry.nextRetryAt)
  ].filter(Boolean)).sort();
  const earliestRetryAt = retryAfterValues[0] || null;
  const incidents = [
    ...operationalHealth.actionableErrors.map((error, index) => ({
      incidentId: `claim-submit-operational-${index + 1}`,
      source: 'operational-health',
      severity: error.severity,
      code: error.code,
      route: error.route || null,
      retryable: error.retryable,
      nextRetryAt: error.nextRetryAt,
      impactedClaimIds: heldEnvelopes
        .filter((envelope) =>
          error.route ? routeMatchesHealthSignal(error.route, envelope.route) : false
        )
        .map((envelope) => envelope.claimId),
      impactedEnvelopeIds: heldEnvelopes
        .filter((envelope) =>
          error.route ? routeMatchesHealthSignal(error.route, envelope.route) : false
        )
        .map((envelope) => envelope.envelopeId),
      recoveryAction: error.action,
      clientActionable: true,
      message: error.message
    })),
    ...providerIntegrationState.unsupportedRoutes.map((route, index) => ({
      incidentId: `claim-submit-provider-contract-${index + 1}`,
      source: 'provider-integration',
      severity: 'error',
      code: 'route-without-provider-contract',
      route,
      retryable: false,
      nextRetryAt: null,
      impactedClaimIds: kernelDispatchPlan.envelopes
        .filter((envelope) => envelope.route === route)
        .map((envelope) => envelope.claimId),
      impactedEnvelopeIds: kernelDispatchPlan.envelopes
        .filter((envelope) => envelope.route === route)
        .map((envelope) => envelope.envelopeId),
      recoveryAction: 'register-idempotent-claim-submit-provider',
      clientActionable: false,
      message: 'A dispatch route has no enabled provider with claim-dispatch and idempotent-submit support.'
    })),
    ...providerAckHandoffs.map((handoff, index) => ({
      incidentId: `claim-submit-provider-ack-${index + 1}`,
      source: 'provider-ack',
      severity: 'warning',
      code: 'provider-ack-pending',
      route: handoff.route,
      retryable: handoff.handoffMode === 'poll',
      nextRetryAt: handoff.externalState.nextPollAt,
      impactedClaimIds: [handoff.claimId],
      impactedEnvelopeIds: [handoff.envelopeId],
      recoveryAction: handoff.handoffMode === 'poll'
        ? 'poll-provider-receipt-route'
        : 'wait-for-provider-acknowledgement',
      clientActionable: false,
      message: 'Provider handoff is awaiting an external acknowledgement before final receipt.'
    }))
  ];
  const retryWindows = retryableErrors.map((error, index) => ({
    windowId: `claim-submit-retry-window-${index + 1}`,
    route: error.route || 'kernel.claim.submit',
    errorCode: error.code,
    opensAt: error.nextRetryAt || now,
    backoffMs: operationalHealth.retryPolicy.nextDelayMs,
    attempt: operationalHealth.retryPolicy.attempt,
    remainingBudget: Math.max(
      operationalHealth.retryPolicy.retryBudget - operationalHealth.retryPolicy.attempt,
      0
    ),
    eligibleEnvelopeIds: heldEnvelopes
      .filter((envelope) =>
        !error.route || routeMatchesHealthSignal(error.route, envelope.route)
      )
      .filter((envelope) => envelope.dispatchHealthGate.retryable)
      .map((envelope) => envelope.envelopeId)
  }));
  const degradedPolicy = {
    active: operationalHealth.status === 'degraded',
    mode: operationalHealth.status === 'degraded' ? 'high-priority-dispatch-only' : 'normal',
    allowedEnvelopeIds: kernelDispatchPlan.envelopes
      .filter((envelope) =>
        envelope.status === 'ready'
          && (operationalHealth.status !== 'degraded' || envelope.priority === 'high')
      )
      .map((envelope) => envelope.envelopeId),
    heldForPriorityEnvelopeIds: heldEnvelopes
      .filter((envelope) =>
        envelope.dispatchHealthGate.holdReasons.includes('degraded-mode-priority-hold')
      )
      .map((envelope) => envelope.envelopeId),
    reasons: operationalHealth.degradedReasons
  };

  return {
    contract: 'claim-submit.operational-recovery-register.v1',
    generatedAt: now,
    status: incidents.some((incident) => incident.severity === 'error')
      ? 'incident-open'
      : incidents.length > 0
        ? 'watch'
        : 'clear',
    earliestRetryAt,
    retryableIncidentCount: incidents.filter((incident) => incident.retryable).length,
    blockedEnvelopeIds: heldEnvelopes.map((envelope) => envelope.envelopeId),
    clientVisibleIncidentIds: incidents
      .filter((incident) => incident.clientActionable)
      .map((incident) => incident.incidentId),
    providerBlockedHandoffIds: providerBlockedHandoffs.map((handoff) => handoff.handoffId),
    retryWindows,
    degradedPolicy,
    incidents,
    proofOutput: {
      eventType: incidents.length > 0
        ? 'claim-submit.operational-recovery.incidents-open'
        : 'claim-submit.operational-recovery.clear',
      surfaceId,
      generatedAt: now,
      incidentCount: incidents.length,
      retryWindowCount: retryWindows.length,
      blockedEnvelopeCount: heldEnvelopes.length,
      providerBlockedHandoffCount: providerBlockedHandoffs.length
    }
  };
}

export function describeClaimSubmitSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = asArray(input.evidence);
  const tenantBoundaryContext = normalizeTenantBoundaryContext(input, now);
  const requestClaims = asArray(input.claims || input.submissions).map((claim, index) =>
    normalizeClaim(claim, index, now, tenantBoundaryContext)
  );
  const persistedState = normalizePersistedClaimSubmitState(input, requestClaims, now, tenantBoundaryContext);
  const claims = mergeRecoveredClaims(requestClaims, persistedState);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const lifecycleCommands = normalizeLifecycleCommands(input, now);
  const operationalRuntime = normalizeOperationalRuntime(input, now);
  const clientHandoffContext = normalizeClientHandoffContext(input, now, tenantBoundaryContext);
  const providerHandoffLedger = normalizeProviderHandoffLedger(input, now);
  const analytics = buildAnalytics(claims, evidence, now);
  const tenantBoundaryState = buildTenantBoundaryState(claims, tenantBoundaryContext, now);
  const lifecycleState = buildLifecycleState(
    claims,
    analytics,
    lifecycleSettings,
    lifecycleCommands,
    persistedState,
    now
  );
  const historySnapshots = buildHistorySnapshots(claims, now);
  const exportSummary = buildExportSummary(claims, analytics, historySnapshots, now);
  const timeline = buildTimeline(claims, evidence, now);
  const validationSummary = buildValidationSummary(
    claims,
    lifecycleState.settings,
    lifecycleState,
    persistedState,
    tenantBoundaryState
  );
  const submitPreview = buildSubmitPreview(
    claims,
    analytics,
    lifecycleState.settings,
    lifecycleState,
    validationSummary,
    now
  );
  const operationalHealth = buildOperationalHealth(
    operationalRuntime,
    lifecycleState,
    validationSummary,
    analytics,
    now
  );
  const kernelDispatchPlan = buildKernelDispatchPlan(
    submitPreview,
    claims,
    lifecycleState,
    operationalHealth,
    persistedState,
    now
  );
  const providerContracts = normalizeProviderContracts(input, now);
  const providerIntegrationState = buildProviderIntegrationState(
    providerContracts,
    kernelDispatchPlan,
    exportSummary,
    clientHandoffContext,
    providerHandoffLedger,
    now
  );
  const clientRequestBinding = buildClientRequestBinding(
    clientHandoffContext,
    claims,
    submitPreview,
    kernelDispatchPlan,
    now
  );
  const operationalRecoveryRegister = buildOperationalRecoveryRegister(
    operationalHealth,
    kernelDispatchPlan,
    providerIntegrationState,
    clientRequestBinding,
    now
  );
  const clientNextStepContract = buildClientNextStepContract(
    submitPreview,
    lifecycleState,
    exportSummary,
    operationalHealth,
    clientHandoffContext,
    clientRequestBinding,
    now
  );
  const reportingState = buildReportingState(
    analytics,
    historySnapshots,
    exportSummary,
    submitPreview,
    operationalHealth,
    lifecycleState,
    clientNextStepContract,
    now
  );
  const uiAcceptanceDecision = buildUiAcceptanceDecisionContract(
    submitPreview,
    validationSummary,
    lifecycleState,
    kernelDispatchPlan,
    providerIntegrationState,
    clientNextStepContract,
    reportingState,
    now
  );
  const uiReviewPacket = buildUiReviewPacket(
    uiAcceptanceDecision,
    submitPreview,
    clientNextStepContract,
    providerIntegrationState,
    operationalHealth,
    reportingState,
    now
  );
  const auditProof = {
    proofType: 'claim-submit.analytics.v1',
    generatedAt: now,
    surfaceId,
    evidenceItems: evidence.length,
    proofBackedClaims: claims.filter((claim) => claim.hasAuditProof).map((claim) => claim.id),
    lifecycleCommandCount: lifecycleState.commandReceipts.length,
    settingsValidation: lifecycleState.settings.validation.map((entry) => entry.code),
    projectedLifecycleCommandCount: lifecycleState.commandEffects.filter((effect) => effect.applied).length,
    projectedLifecycleControlState: {
      enabled: lifecycleState.settings.enabled,
      acceptNewClaims: lifecycleState.settings.acceptNewClaims,
      proofRequired: lifecycleState.settings.proofRequired,
      exportOnFinal: lifecycleState.settings.exportOnFinal,
      draining: Boolean(lifecycleState.settings.draining),
      maxOpenClaims: lifecycleState.settings.maxOpenClaims,
      remainingCapacity: lifecycleState.controlSurface.remainingCapacity,
      scheduleMode: lifecycleState.settings.schedule.mode,
      schedulePaused: lifecycleState.settings.schedule.paused,
      scheduleDue: lifecycleState.scheduler.due,
      nextIntervalRunAt: lifecycleState.scheduler.nextIntervalRunAt
    },
    recoveredFromCheckpoint: persistedState.hasPersistedState,
    checkpointSequence: persistedState.checkpoint.sequence,
    recoveredCommandReceiptCount: persistedState.commandJournal.entries.length,
    replayableCommandReceiptCount: persistedState.commandJournal.replayableCommandIds.length,
    pendingCommandReceiptCount: persistedState.commandJournal.pendingCommandIds.length,
    failedCommandReceiptCount: persistedState.commandJournal.failedCommandIds.length,
    conflictingCommandReceiptCount: persistedState.commandJournal.conflictingCommandIds.length,
    replayedLifecycleCommandCount: lifecycleState.persistedRestart.replayedCommandCount,
    restartSafeStatus: lifecycleState.persistedRestart.status,
    dispatchPlanReadiness: kernelDispatchPlan.readiness,
    dispatchEnvelopeCount: kernelDispatchPlan.envelopes.length,
    readyDispatchEnvelopeCount: kernelDispatchPlan.readyEnvelopeCount,
    heldDispatchEnvelopeCount: kernelDispatchPlan.heldEnvelopeCount,
    healthHeldDispatchEnvelopeCount: kernelDispatchPlan.healthHeldEnvelopeCount,
    retryableHeldDispatchEnvelopeCount: kernelDispatchPlan.retryableHeldEnvelopeCount,
    replayedDispatchEnvelopeCount: kernelDispatchPlan.replayedOutboxEnvelopeCount,
    completedDispatchEnvelopeCount: kernelDispatchPlan.completedOutboxEnvelopeCount,
    blockedDispatchClaimCount: kernelDispatchPlan.blockedClaimCount,
    dispatchRouteCount: kernelDispatchPlan.routeBatches.length,
    providerContractCount: providerIntegrationState.providers.length,
    providerUnsupportedRouteCount: providerIntegrationState.unsupportedRoutes.length,
    providerReadyHandoffCount: providerIntegrationState.readyProviderHandoffCount,
    providerBlockedHandoffCount: providerIntegrationState.blockedProviderHandoffCount,
    providerRecoveredHandoffCount: providerIntegrationState.recoveredProviderHandoffCount,
    providerPendingAckCount: providerIntegrationState.pendingProviderAckCount,
    providerSyncBacklogCount: providerIntegrationState.syncMetadata.backlogCount,
    providerSyncCursor: providerIntegrationState.syncMetadata.stateCursor,
    operationalDispatchPolicyMode: kernelDispatchPlan.operationalDispatchPolicy.mode,
    operationalDispatchRecoveryActions: kernelDispatchPlan.operationalDispatchPolicy.recoveryActions,
    operationalHealthStatus: operationalHealth.status,
    actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
    operationalRecoveryStatus: operationalRecoveryRegister.status,
    operationalRecoveryIncidentCount: operationalRecoveryRegister.incidents.length,
    operationalRecoveryRetryWindowCount: operationalRecoveryRegister.retryWindows.length,
    operationalRecoveryEarliestRetryAt: operationalRecoveryRegister.earliestRetryAt,
    operationalRecoveryBlockedEnvelopeCount: operationalRecoveryRegister.blockedEnvelopeIds.length,
    operationalRecoveryProviderBlockedHandoffCount: operationalRecoveryRegister.providerBlockedHandoffIds.length,
    degradedDispatchPolicyMode: operationalRecoveryRegister.degradedPolicy.mode,
    degradedPriorityHeldEnvelopeCount: operationalRecoveryRegister.degradedPolicy.heldForPriorityEnvelopeIds.length,
    clientRequestId: clientHandoffContext.requestId,
    clientSessionId: clientHandoffContext.sessionId,
    clientChannel: clientHandoffContext.channel,
    clientHandoffMode: clientHandoffContext.handoffMode,
    clientClaimScopeMode: clientRequestBinding.scopeMode,
    clientRequestedClaimCount: clientRequestBinding.requestedClaimIds.length,
    clientSelectedClaimCount: clientRequestBinding.selectedCount,
    clientMissingClaimCount: clientRequestBinding.missingClaimIds.length,
    primaryClientHandoffId: clientNextStepContract.primaryHandoffId,
    pendingAsyncReceiptCount: clientNextStepContract.pendingAsyncReceipt.length,
    uiAcceptanceDecision: uiAcceptanceDecision.decision,
    uiAcceptanceReady: uiAcceptanceDecision.ready,
    uiAcceptanceDisabledReasons: uiAcceptanceDecision.disabledReasons,
    uiPrimaryActionId: uiAcceptanceDecision.primaryAction?.id || null,
    uiClaimRowCount: uiAcceptanceDecision.claimRows.length,
    uiReadyEnvelopeCount: uiAcceptanceDecision.dispatchSummary.readyEnvelopeCount,
    uiProviderBlockedHandoffCount: uiAcceptanceDecision.dispatchSummary.providerBlockedHandoffCount,
    uiReviewPacketReady: uiReviewPacket.visibleState.ready,
    uiReviewProviderAckState: uiReviewPacket.visibleState.providerAckState,
    uiReviewEnabledNextStepCount: uiReviewPacket.acceptanceControls.enabledActionIds.length,
    uiReviewValidationGroupCount: uiReviewPacket.validationSummary.groups.length,
    tenantId: tenantBoundaryState.tenantId,
    workspaceId: tenantBoundaryState.workspaceId,
    actorId: tenantBoundaryState.actorId,
    requiredPermission: tenantBoundaryState.requiredPermission,
    submitPermissionGranted: tenantBoundaryState.hasRequiredPermission,
    boundaryMode: tenantBoundaryState.boundaryMode,
    scopedWorkspaceMode: tenantBoundaryState.scopedWorkspaceMode,
    workspaceSubmitGrantCount: tenantBoundaryState.workspaceSubmitGrants.length,
    activeWorkspaceSubmitGrantCount: tenantBoundaryState.activeWorkspaceSubmitGrants.length,
    workspaceGrantAuthorizedClaimCount: tenantBoundaryState.claimAuthorizations
      .filter((entry) => entry.workspaceGrant)
      .length,
    workspaceGrantBlockedClaimCount: tenantBoundaryState.claimAuthorizations
      .filter((entry) =>
        entry.blockers.includes('workspace-submit-grant-missing')
          || entry.blockers.includes('workspace-submit-grant-batch-limit')
      )
      .length,
    workspaceGrantAuditHandoffIds: tenantBoundaryState.auditHandoff.workspaceGrantIds,
    boundaryBlockedClaimCount: tenantBoundaryState.blockedClaimIds.length,
    crossTenantClaimCount: tenantBoundaryState.crossTenantClaimCount,
    crossWorkspaceClaimCount: tenantBoundaryState.crossWorkspaceClaimCount,
    countersHashInput: {
      totalClaims: analytics.totalClaims,
      openClaims: analytics.openClaims,
      finalClaims: analytics.finalClaims,
      evidenceItems: analytics.evidenceItems,
      lifecycleCommands: lifecycleState.commandReceipts.length,
      projectedLifecycleCommands: lifecycleState.commandEffects.filter((effect) => effect.applied).length,
      replayedLifecycleCommands: lifecycleState.persistedRestart.replayedCommandCount,
      recoveredCommandReceipts: persistedState.commandJournal.entries.length,
      pendingCommandReceipts: persistedState.commandJournal.pendingCommandIds.length,
      failedCommandReceipts: persistedState.commandJournal.failedCommandIds.length,
      conflictingCommandReceipts: persistedState.commandJournal.conflictingCommandIds.length,
      recoveredClaims: persistedState.recoveredClaims.length,
      effectiveEnabled: lifecycleState.effectiveEnabled,
      previewAcceptedClaims: submitPreview.acceptedCount,
      previewBlockedClaims: submitPreview.blockedCount,
      operationalActionableErrors: operationalHealth.actionableErrors.length,
      operationalRetryable: operationalHealth.retryable,
      operationalRecoveryIncidents: operationalRecoveryRegister.incidents.length,
      operationalRecoveryRetryWindows: operationalRecoveryRegister.retryWindows.length,
      operationalRecoveryBlockedEnvelopes: operationalRecoveryRegister.blockedEnvelopeIds.length,
      degradedPriorityHeldEnvelopes: operationalRecoveryRegister.degradedPolicy.heldForPriorityEnvelopeIds.length,
      proofDebtClaims: analytics.counters.proofDebtClaims,
      staleOpenClaimCount: analytics.counters.staleOpenClaimCount,
      lifecycleDraining: Boolean(lifecycleState.settings.draining),
      lifecycleRemainingCapacity: lifecycleState.controlSurface.remainingCapacity,
      lifecycleAllowedCommands: lifecycleState.controlSurface.allowedCommands.length,
      schedulerDue: lifecycleState.scheduler.due,
      schedulerAction: lifecycleState.scheduler.action,
      dispatchAllowed: kernelDispatchPlan.dispatchAllowed,
      readyDispatchEnvelopes: kernelDispatchPlan.readyEnvelopeCount,
      heldDispatchEnvelopes: kernelDispatchPlan.heldEnvelopeCount,
      providerContracts: providerIntegrationState.providers.length,
      providerUnsupportedRoutes: providerIntegrationState.unsupportedRoutes.length,
      providerReadyHandoffs: providerIntegrationState.readyProviderHandoffCount,
      providerBlockedHandoffs: providerIntegrationState.blockedProviderHandoffCount,
      providerRecoveredHandoffs: providerIntegrationState.recoveredProviderHandoffCount,
      providerPendingAcks: providerIntegrationState.pendingProviderAckCount,
      providerSyncBacklog: providerIntegrationState.syncMetadata.backlogCount,
      providerSyncRequired: providerIntegrationState.syncMetadata.syncRequired,
      healthHeldDispatchEnvelopes: kernelDispatchPlan.healthHeldEnvelopeCount,
      retryableHeldDispatchEnvelopes: kernelDispatchPlan.retryableHeldEnvelopeCount,
      replayedDispatchEnvelopes: kernelDispatchPlan.replayedOutboxEnvelopeCount,
      completedDispatchEnvelopes: kernelDispatchPlan.completedOutboxEnvelopeCount,
      blockedDispatchClaims: kernelDispatchPlan.blockedClaimCount,
      exportBatchId: exportSummary.batchManifest.batchId,
      exportHighWatermarkAt: exportSummary.batchManifest.highWatermarkAt,
      clientRequestId: clientHandoffContext.requestId,
      clientChannel: clientHandoffContext.channel,
      clientHandoffMode: clientHandoffContext.handoffMode,
      clientClaimScopeMode: clientRequestBinding.scopeMode,
      clientSelectedClaims: clientRequestBinding.selectedCount,
      clientMissingClaims: clientRequestBinding.missingClaimIds.length,
      clientRetryableHealthHeldEnvelopes: clientRequestBinding.retryableHealthHeldEnvelopeIds.length,
      pendingAsyncReceipts: clientNextStepContract.pendingAsyncReceipt.length,
      uiAcceptanceDecision: uiAcceptanceDecision.decision,
      uiAcceptanceReady: uiAcceptanceDecision.ready,
      uiDisabledReasons: uiAcceptanceDecision.disabledReasons.length,
      uiClaimRows: uiAcceptanceDecision.claimRows.length,
      uiProviderErrors: uiAcceptanceDecision.dispatchSummary.providerErrors.length,
      uiReviewReady: uiReviewPacket.visibleState.ready,
      uiReviewEnabledActions: uiReviewPacket.acceptanceControls.enabledActionIds.length,
      uiReviewValidationGroups: uiReviewPacket.validationSummary.groups.length,
      uiReviewProviderAckState: uiReviewPacket.visibleState.providerAckState,
      tenantId: tenantBoundaryState.tenantId,
      workspaceId: tenantBoundaryState.workspaceId,
      boundaryBlockedClaims: tenantBoundaryState.blockedClaimIds.length,
      submitPermissionGranted: tenantBoundaryState.hasRequiredPermission,
      scopedWorkspaceMode: tenantBoundaryState.scopedWorkspaceMode,
      workspaceSubmitGrants: tenantBoundaryState.workspaceSubmitGrants.length,
      activeWorkspaceSubmitGrants: tenantBoundaryState.activeWorkspaceSubmitGrants.length,
      workspaceGrantAuthorizedClaims: tenantBoundaryState.claimAuthorizations
        .filter((entry) => entry.workspaceGrant)
        .length,
      workspaceGrantBlockedClaims: tenantBoundaryState.claimAuthorizations
        .filter((entry) =>
          entry.blockers.includes('workspace-submit-grant-missing')
            || entry.blockers.includes('workspace-submit-grant-batch-limit')
        )
        .length
    }
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel claim submission analytics, history, export, and audit proof contract',
    claims,
    analytics,
    lifecycleState,
    tenantBoundaryState,
    historySnapshots,
    exportSummary,
    timeline,
    validationSummary,
    submitPreview,
    operationalHealth,
    operationalRecoveryRegister,
    kernelDispatchPlan,
    providerIntegrationState,
    clientHandoffContext,
    clientRequestBinding,
    clientNextStepContract,
    uiAcceptanceDecision,
    uiReviewPacket,
    auditProof,
    persistenceState: {
      contract: 'claim-submit.persisted-state.v1',
      restartSafeStatus: lifecycleState.persistedRestart.status,
      checkpoint: persistedState.checkpoint,
      recoveredClaimIds: persistedState.recoveredClaimIds,
      retainedRecoveredClaimIds: persistedState.missingFromInput,
      requestOverrideClaimIds: persistedState.replacedFromInput,
      appliedCommandIds: persistedState.appliedCommandIds,
      pendingCommandIds: lifecycleState.commandReceipts
        .filter((receipt) => receipt.accepted && !receipt.idempotentReplay)
        .map((receipt) => receipt.commandId),
      commandJournal: {
        contract: 'claim-submit.persisted-command-journal.v1',
        recoveredReceiptCount: persistedState.commandJournal.entries.length,
        replayableCommandIds: persistedState.commandJournal.replayableCommandIds,
        pendingRecoveredCommandIds: persistedState.commandJournal.pendingCommandIds,
        failedRecoveredCommandIds: persistedState.commandJournal.failedCommandIds,
        duplicateRecoveredCommandIds: persistedState.commandJournal.duplicateCommandIds,
        conflictingRecoveredCommandIds: persistedState.commandJournal.conflictingCommandIds,
        reconciliationRequired: lifecycleState.persistedRestart.commandJournal.reconciliationRequired,
        receipts: persistedState.commandJournal.entries.map((entry) => ({
          receiptId: entry.receiptId,
          commandId: entry.commandId,
          type: entry.type,
          status: entry.status,
          applied: entry.applied,
          terminal: entry.terminal,
          replaySafe: entry.replaySafe,
          requestedAt: entry.requestedAt,
          appliedAt: entry.appliedAt,
          checkpointSequence: entry.checkpointSequence
        })),
        projectedReceipts: lifecycleState.commandReceipts.map((receipt) => ({
          commandId: receipt.commandId,
          type: receipt.type,
          accepted: receipt.accepted,
          idempotentReplay: Boolean(receipt.idempotentReplay),
          restartRecoveryBlocked: Boolean(receipt.restartRecoveryBlocked),
          reason: receipt.reason
        }))
      },
      dispatchOutbox: {
        recoveredCount: persistedState.dispatchOutbox.entries.length,
        replayableCount: persistedState.dispatchOutbox.replayableEntries.length,
        terminalCount: persistedState.dispatchOutbox.terminalEntries.length,
        replayableOutboxIds: persistedState.dispatchOutbox.replayableEntries.map((entry) => entry.outboxId),
        terminalOutboxIds: persistedState.dispatchOutbox.terminalEntries.map((entry) => entry.outboxId),
        replayEnvelopeIds: kernelDispatchPlan.restartRecovery.replayEnvelopeIds,
        completedEnvelopeIds: kernelDispatchPlan.restartRecovery.completedEnvelopeIds
      },
      providerHandoffLedger: {
        recoveredCount: providerHandoffLedger.entries.length,
        pendingCount: providerHandoffLedger.pendingEntries.length,
        terminalCount: providerHandoffLedger.terminalEntries.length,
        recoveredHandoffIds: providerHandoffLedger.entries.map((entry) => entry.handoffId),
        pendingHandoffIds: providerHandoffLedger.pendingEntries.map((entry) => entry.handoffId),
        terminalHandoffIds: providerHandoffLedger.terminalEntries.map((entry) => entry.handoffId),
        matchedRecoveredHandoffIds: providerIntegrationState.handoffs
          .map((handoff) => handoff.recoveredHandoffId)
          .filter(Boolean),
        pendingAckHandoffIds: providerIntegrationState.handoffs
          .filter((handoff) => handoff.externalState.awaitingAck)
          .map((handoff) => handoff.handoffId)
      },
      recoveryWarnings: persistedState.recoveryWarnings.map((entry) => entry.code),
      nextCheckpoint: {
        at: now,
        sequence: persistedState.checkpoint.sequence + 1,
        claimCount: claims.length,
        commandReceiptCount: lifecycleState.commandReceipts.length,
        dispatchOutboxCount: kernelDispatchPlan.envelopes
          .filter((envelope) => ['ready', 'replay', 'held'].includes(envelope.status))
          .length,
        completedDispatchCount: kernelDispatchPlan.completedOutboxEnvelopeCount,
        writer: 'kernel.claim.submit'
      }
    },
    reportingState,
    evidence
  };
}

export default describeClaimSubmitSurface;
