export const surfaceId = "aios_operator-userland_claim-browser_090";
export const surfaceGroup = "operator-userland";
export const surfaceName = "claim-browser";

const STATE_SCHEMA_VERSION = 1;
const COMMAND_RECEIPT_LIMIT = 100;
const LIFECYCLE_COMMAND_RECEIPT_LIMIT = 50;
const COMMAND_AUDIT_LIMIT = 120;
const HOSTED_KERNEL_OUTBOX_LIMIT = 80;
const PROVIDER_DELIVERY_RECEIPT_LIMIT = 80;
const MAILCHIMP_SYNC_RECEIPT_LIMIT = 40;
const RECOVERY_JOURNAL_LIMIT = 80;
const RECOVERY_INTENT_LIMIT = 40;
const HEALTH_COMMAND_RETRY_LIMIT = 40;
const ANALYTICS_HISTORY_LIMIT = 24;
const REPORT_TIMELINE_LIMIT = 80;
const WORKFLOW_HANDOFF_QUEUE_LIMIT = 30;
const HEALTH_QUEUE_DEPTH_WARN = 50;
const HEALTH_RETRY_BASE_MS = 500;
const HEALTH_RETRY_MAX_MS = 30000;
const LIFECYCLE_MODES = new Set(['enabled', 'disabled', 'scheduled']);
const LIFECYCLE_SCHEDULE_STATES = new Set(['active', 'waiting', 'expired', 'disabled']);
const PROVIDER_SYNC_STATES = new Set(['idle', 'pending', 'degraded', 'blocked']);
const KNOWN_STATUS = new Set(['new', 'queued', 'running', 'blocked', 'accepted', 'rejected', 'stale']);
const TERMINAL_STATUS = new Set(['accepted', 'rejected', 'stale']);
const TERMINAL_COMMANDS = new Set(['accept', 'reject']);
const COMMAND_ACTIONS = Object.freeze(['queue', 'block', 'accept', 'reject', 'reopen']);
const LIFECYCLE_COMMAND_ACTIONS = Object.freeze(['enable', 'disable', 'schedule', 'update-settings']);
const PROVIDER_REQUIRED_CAPABILITIES = Object.freeze(['claim-command-write', 'claim-proof-attach', 'claim-command-ack']);
const PROVIDER_OPTIONAL_CAPABILITIES = Object.freeze(['claim-command-batch', 'claim-command-replay', 'claim-lifecycle-control']);
const PROVIDER_HANDOFF_STATES = Object.freeze(['ready', 'awaiting-provider', 'acknowledged', 'failed', 'blocked']);
const PROVIDER_DELIVERY_STATES = Object.freeze(['sent', 'acknowledged', 'failed']);
const PREVIEW_VALIDATION_SEVERITIES = Object.freeze(['info', 'warning', 'blocking']);
const MAILCHIMP_CAMPAIGN_STATUSES = Object.freeze(['draft', 'scheduled', 'sending', 'sent', 'paused', 'archived', 'unknown']);
const RETRYABLE_HEALTH_DENIAL_CODES = new Set([
  'hosted-kernel-unreachable',
  'proof-writer-unavailable',
  'command-queue-backpressure',
  'claim-browser-disabled-until',
  'claim-browser-schedule-not-started',
  'claim-browser-lifecycle-disabled',
  'claim-browser-command-writes-unavailable'
]);
const OPERATOR_ROLES = new Set(['viewer', 'triager', 'approver', 'tenant-admin']);
const CLIENT_VIEW_MODES = new Set(['queue', 'review', 'history']);
const CLIENT_SORT_KEYS = new Set(['updatedAt', 'status', 'title', 'revision']);
const CLAIM_PERMISSION_GRANT_LIMIT = 20;
const ROLE_ACTIONS = Object.freeze({
  viewer: Object.freeze([]),
  triager: Object.freeze(['queue', 'block', 'reopen']),
  approver: Object.freeze(['queue', 'block', 'accept', 'reject', 'reopen']),
  'tenant-admin': Object.freeze(['queue', 'block', 'accept', 'reject', 'reopen'])
});
const RESTART_SAFE_STATUS = Object.freeze({
  running: 'queued',
  blocked: 'blocked',
  queued: 'queued',
  accepted: 'accepted',
  rejected: 'rejected',
  stale: 'stale',
  new: 'queued'
});

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback = min) {
  return Math.min(max, Math.max(min, toFiniteNumber(value, fallback)));
}

function addMillisecondsIso(isoTimestamp, milliseconds) {
  const epochMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(epochMs)) return null;
  return new Date(epochMs + milliseconds).toISOString();
}

function normalizeIsoTimestamp(value) {
  const text = stableText(value, null);
  if (!text) return null;
  const epochMs = Date.parse(text);
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function millisecondsUntil(now, isoTimestamp) {
  const nowMs = Date.parse(now);
  const targetMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(targetMs)) return null;
  return Math.max(0, targetMs - nowMs);
}

function normalizeScope(input) {
  const scope = asRecord(input.scope);
  const persisted = asRecord(input.persistedState);
  return {
    tenantId: stableText(scope.tenantId, stableText(input.tenantId, stableText(persisted.tenantId, 'tenant:default'))),
    workspaceId: stableText(scope.workspaceId, stableText(input.workspaceId, stableText(persisted.workspaceId, 'workspace:default')))
  };
}

function normalizePrincipal(input, scope) {
  const principal = asRecord(input.principal);
  const requestedRole = stableText(principal.role, stableText(input.role, 'viewer'));
  const role = OPERATOR_ROLES.has(requestedRole) ? requestedRole : 'viewer';
  const tenantIds = Array.isArray(principal.tenantIds) ? principal.tenantIds : [principal.tenantId, input.tenantId, scope.tenantId];
  const workspaceIds = Array.isArray(principal.workspaceIds) ? principal.workspaceIds : [principal.workspaceId, input.workspaceId, scope.workspaceId];
  return {
    id: stableText(principal.id, stableText(input.operatorId, 'operator:anonymous')),
    role,
    tenantIds: [...new Set(tenantIds.map((id) => stableText(id, null)).filter(Boolean))],
    workspaceIds: [...new Set(workspaceIds.map((id) => stableText(id, null)).filter(Boolean))]
  };
}

function principalHasScope(principal, tenantId, workspaceId) {
  return principal.tenantIds.includes(tenantId) && principal.workspaceIds.includes(workspaceId);
}

function principalCanApply(principal, action) {
  return ROLE_ACTIONS[principal.role].includes(action);
}

function normalizeEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: stableText(entry.id, `evidence:${index + 1}`),
      kind: stableText(entry.kind, 'operator-note'),
      source: stableText(entry.source, 'claim-browser'),
      observedAt: stableText(entry.observedAt, stableText(entry.generatedAt, null)),
      digest: stableText(entry.digest, stableText(entry.hash, null))
    }));
}

function normalizeProofRef(value, fallback) {
  if (typeof value === 'string') return stableText(value, fallback);
  const record = asRecord(value);
  return stableText(record.id, stableText(record.ref, stableText(record.digest, fallback)));
}

function normalizeProofRefs(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => normalizeProofRef(entry, null))
    .filter(Boolean))];
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => stableText(item, null))
    .filter(Boolean);
}

function firstRecord(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function uniqueKnownProviderCapabilities(...lists) {
  const known = new Set([...PROVIDER_REQUIRED_CAPABILITIES, ...PROVIDER_OPTIONAL_CAPABILITIES]);
  return [...new Set(lists.flatMap((list) => normalizeStringList(list)).filter((capability) => known.has(capability)))];
}

function normalizeClaimPermissionGrants(rawClaim, claimId, scope, now) {
  const claim = asRecord(rawClaim);
  const rawGrants = Array.isArray(claim.permissionGrants)
    ? claim.permissionGrants
    : Array.isArray(claim.operatorGrants)
      ? claim.operatorGrants
      : [];
  const grants = [];
  const warnings = [];
  const boundaryEvents = [];
  for (const [index, rawGrant] of rawGrants.entries()) {
    const grant = asRecord(rawGrant);
    const tenantId = stableText(grant.tenantId, stableText(claim.tenantId, scope.tenantId));
    const workspaceId = stableText(grant.workspaceId, stableText(claim.workspaceId, scope.workspaceId));
    const actions = normalizeStringList(grant.actions).filter((action) => COMMAND_ACTIONS.includes(action));
    const roles = normalizeStringList(grant.roles).filter((role) => OPERATOR_ROLES.has(role));
    const principalIds = normalizeStringList(grant.principalIds);
    const expiresAt = normalizeIsoTimestamp(grant.expiresAt);
    const grantId = stableText(grant.id, `grant:${claimId}:${index + 1}`);
    if (tenantId !== scope.tenantId || workspaceId !== scope.workspaceId) {
      boundaryEvents.push({
        kind: 'claim-permission-grant-scope-rejected',
        claimId,
        grantId,
        tenantId,
        workspaceId,
        expectedTenantId: scope.tenantId,
        expectedWorkspaceId: scope.workspaceId
      });
      warnings.push(`ignored out-of-scope permission grant ${grantId} for ${claimId}`);
      continue;
    }
    if (stableText(grant.expiresAt, null) && !expiresAt) {
      warnings.push(`ignored invalid permission grant expiry ${grantId} for ${claimId}`);
      continue;
    }
    if (expiresAt && Date.parse(expiresAt) <= Date.parse(now)) {
      warnings.push(`ignored expired permission grant ${grantId} for ${claimId}`);
      continue;
    }
    if (!actions.length || (!roles.length && !principalIds.length)) {
      warnings.push(`ignored incomplete permission grant ${grantId} for ${claimId}`);
      continue;
    }
    grants.push({
      id: grantId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actions,
      roles,
      principalIds,
      expiresAt,
      reason: stableText(grant.reason, null),
      proofRef: normalizeProofRef(grant.proofRef, null)
    });
    if (grants.length >= CLAIM_PERMISSION_GRANT_LIMIT) break;
  }
  return { grants, warnings, boundaryEvents };
}

function normalizeWorkspacePolicy(input, scope) {
  const persisted = asRecord(input.persistedState);
  const persistedPolicy = asRecord(persisted.workspacePolicy);
  const requestedPolicy = asRecord(input.workspacePolicy);
  const mergedPolicy = { ...persistedPolicy, ...requestedPolicy };
  const rawAllowedActions = normalizeStringList(mergedPolicy.allowedActions);
  const allowedActions = rawAllowedActions.length
    ? rawAllowedActions.filter((action) => COMMAND_ACTIONS.includes(action))
    : COMMAND_ACTIONS;
  const tenantId = stableText(mergedPolicy.tenantId, scope.tenantId);
  const workspaceId = stableText(mergedPolicy.workspaceId, scope.workspaceId);
  const scopeMatched = tenantId === scope.tenantId && workspaceId === scope.workspaceId;
  const lockedClaimIds = [...new Set(normalizeStringList(mergedPolicy.lockedClaimIds))];
  const terminalEvidenceKinds = normalizeStringList(mergedPolicy.terminalEvidenceKinds);
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    scopeMatched,
    sourceTenantId: tenantId,
    sourceWorkspaceId: workspaceId,
    readOnly: mergedPolicy.readOnly === true,
    allowedActions,
    lockedClaimIds,
    requireTerminalEvidence: mergedPolicy.requireTerminalEvidence === true,
    terminalEvidenceKinds,
    escalationRoute: stableText(mergedPolicy.escalationRoute, 'hosted-kernel.audit.claim-browser.policy')
  };
}

function normalizeLifecycleCommandReceipt(rawReceipt, now) {
  const receipt = asRecord(rawReceipt);
  const commandId = stableText(receipt.commandId, stableText(receipt.id, null));
  if (!commandId) return null;
  return {
    commandId,
    action: stableText(receipt.action, null),
    tenantId: stableText(receipt.tenantId, null),
    workspaceId: stableText(receipt.workspaceId, null),
    accepted: receipt.accepted === true,
    reason: stableText(receipt.reason, 'unknown'),
    previousMode: stableText(receipt.previousMode, null),
    effectiveMode: stableText(receipt.effectiveMode, null),
    scheduleState: stableText(receipt.scheduleState, null),
    nextReviewAt: stableText(receipt.nextReviewAt, null),
    recordedAt: stableText(receipt.recordedAt, now),
    principalId: stableText(receipt.principalId, null)
  };
}

function normalizeLifecycleCommandReceipts(persisted, now) {
  const seen = new Set();
  const receipts = [];
  const rawReceipts = Array.isArray(persisted.lifecycleCommandReceipts) ? persisted.lifecycleCommandReceipts : [];
  for (const rawReceipt of rawReceipts) {
    const receipt = normalizeLifecycleCommandReceipt(rawReceipt, now);
    if (!receipt || seen.has(receipt.commandId)) continue;
    seen.add(receipt.commandId);
    receipts.push(receipt);
  }
  return receipts.slice(-LIFECYCLE_COMMAND_RECEIPT_LIMIT);
}

function lifecycleCommandSettingsPatch(command, now) {
  const request = asRecord(command);
  const action = stableText(request.action, null);
  const settingsPatch = {
    updatedBy: stableText(request.updatedBy, stableText(request.operatorId, null)),
    updatedAt: now
  };
  if (action === 'enable') {
    return {
      ...settingsPatch,
      mode: 'enabled',
      disabledUntil: null,
      disabledReason: null,
      schedule: { startsAt: null, endsAt: null }
    };
  }
  if (action === 'disable') {
    return {
      ...settingsPatch,
      mode: 'disabled',
      disabledUntil: normalizeIsoTimestamp(request.disabledUntil || request.until),
      disabledReason: stableText(request.reason, 'operator-disabled')
    };
  }
  if (action === 'schedule') {
    return {
      ...settingsPatch,
      mode: 'scheduled',
      schedule: {
        startsAt: normalizeIsoTimestamp(request.startsAt || request.enableAt),
        endsAt: normalizeIsoTimestamp(request.endsAt || request.disableAt)
      },
      disabledReason: stableText(request.reason, null)
    };
  }
  if (action === 'update-settings') {
    return {
      ...settingsPatch,
      ...asRecord(request.settings),
      schedule: {
        ...asRecord(asRecord(request.settings).schedule)
      }
    };
  }
  return settingsPatch;
}

function applyLifecycleCommand(input, scope, principal, now, currentSettings) {
  const persisted = asRecord(input.persistedState);
  const request = asRecord(input.lifecycleCommand);
  const commandId = stableText(request.commandId, stableText(request.id, null));
  const action = stableText(request.action, null);
  const tenantId = stableText(request.tenantId, scope.tenantId);
  const workspaceId = stableText(request.workspaceId, scope.workspaceId);
  const receipts = normalizeLifecycleCommandReceipts(persisted, now);
  if (!commandId && !action) {
    return {
      settingsPatch: {},
      receipts,
      auditEntry: null,
      boundaryEvent: null,
      receipt: null
    };
  }

  const priorReceipt = receipts.find((receipt) => receipt.commandId === commandId);
  if (priorReceipt) {
    return { settingsPatch: {}, receipts, auditEntry: null, boundaryEvent: null, receipt: priorReceipt };
  }

  const baseReceipt = {
    commandId,
    action,
    tenantId,
    workspaceId,
    previousMode: currentSettings.effectiveMode,
    recordedAt: now,
    principalId: principal.id
  };
  const reject = (reason, boundaryEvent = null) => {
    const receipt = {
      ...baseReceipt,
      accepted: false,
      reason,
      effectiveMode: currentSettings.effectiveMode,
      scheduleState: currentSettings.scheduleState,
      nextReviewAt: currentSettings.nextReviewAt
    };
    return {
      settingsPatch: {},
      receipts: [...receipts, receipt].slice(-LIFECYCLE_COMMAND_RECEIPT_LIMIT),
      auditEntry: receipt,
      boundaryEvent,
      receipt
    };
  };

  if (!commandId) return reject('missing-lifecycle-command-id');
  if (!LIFECYCLE_COMMAND_ACTIONS.includes(action)) return reject('unsupported-lifecycle-command-action');
  if (tenantId !== scope.tenantId || workspaceId !== scope.workspaceId) {
    return reject('lifecycle-command-scope-denied', {
      kind: 'lifecycle-command-scope-denied',
      commandId,
      action,
      principalId: principal.id,
      tenantId,
      workspaceId,
      expectedTenantId: scope.tenantId,
      expectedWorkspaceId: scope.workspaceId
    });
  }
  if (principal.role !== 'tenant-admin') {
    return reject('lifecycle-command-permission-denied', {
      kind: 'lifecycle-command-permission-denied',
      commandId,
      action,
      principalId: principal.id,
      role: principal.role
    });
  }
  if (!principalHasScope(principal, scope.tenantId, scope.workspaceId)) {
    return reject('lifecycle-command-principal-out-of-scope', {
      kind: 'lifecycle-command-principal-out-of-scope',
      commandId,
      action,
      principalId: principal.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId
    });
  }
  const requestedDisabledUntil = stableText(request.disabledUntil, stableText(request.until, null));
  const requestedStartsAt = stableText(request.startsAt, stableText(request.enableAt, null));
  const requestedEndsAt = stableText(request.endsAt, stableText(request.disableAt, null));
  const startsAt = normalizeIsoTimestamp(requestedStartsAt);
  const endsAt = normalizeIsoTimestamp(requestedEndsAt);
  if (action === 'disable' && requestedDisabledUntil && !normalizeIsoTimestamp(requestedDisabledUntil)) {
    return reject('invalid-lifecycle-disabled-until');
  }
  if (action === 'schedule' && requestedStartsAt && !startsAt) {
    return reject('invalid-lifecycle-schedule-starts-at');
  }
  if (action === 'schedule' && requestedEndsAt && !endsAt) {
    return reject('invalid-lifecycle-schedule-ends-at');
  }
  if (action === 'schedule' && startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    return reject('invalid-lifecycle-schedule-window');
  }

  const settingsPatch = lifecycleCommandSettingsPatch(request, now);
  const nextSettings = normalizeLifecycleSettings({
    persistedState: { lifecycleSettings: currentSettings },
    lifecycleSettings: settingsPatch
  }, now);
  const receipt = {
    ...baseReceipt,
    accepted: true,
    reason: 'applied',
    effectiveMode: nextSettings.effectiveMode,
    scheduleState: nextSettings.scheduleState,
    nextReviewAt: nextSettings.nextReviewAt
  };
  return {
    settingsPatch,
    receipts: [...receipts, receipt].slice(-LIFECYCLE_COMMAND_RECEIPT_LIMIT),
    auditEntry: receipt,
    boundaryEvent: null,
    receipt
  };
}

function normalizeLifecycleSettings(input, now) {
  const persisted = asRecord(input.persistedState);
  const persistedSettings = asRecord(persisted.lifecycleSettings);
  const requestedSettings = {
    ...asRecord(input.lifecycleSettings),
    ...asRecord(input.settingsControls)
  };
  const mergedSettings = { ...persistedSettings, ...requestedSettings };
  const schedule = {
    ...asRecord(persistedSettings.schedule),
    ...asRecord(mergedSettings.schedule)
  };
  const validationWarnings = [];
  const requestedMode = stableText(mergedSettings.mode, null);
  const mode = LIFECYCLE_MODES.has(requestedMode)
    ? requestedMode
    : mergedSettings.enabled === false
      ? 'disabled'
      : 'enabled';
  if (requestedMode && !LIFECYCLE_MODES.has(requestedMode)) {
    validationWarnings.push(`unsupported lifecycle mode ${requestedMode}`);
  }

  const disabledUntil = normalizeIsoTimestamp(mergedSettings.disabledUntil);
  const startsAt = normalizeIsoTimestamp(schedule.startsAt || mergedSettings.enableAt);
  const endsAt = normalizeIsoTimestamp(schedule.endsAt || mergedSettings.disableAt);
  if (stableText(mergedSettings.disabledUntil, null) && !disabledUntil) validationWarnings.push('invalid disabledUntil timestamp');
  if (stableText(schedule.startsAt || mergedSettings.enableAt, null) && !startsAt) validationWarnings.push('invalid schedule startsAt timestamp');
  if (stableText(schedule.endsAt || mergedSettings.disableAt, null) && !endsAt) validationWarnings.push('invalid schedule endsAt timestamp');
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    validationWarnings.push('schedule startsAt must be before endsAt');
  }

  const nowMs = Date.parse(now);
  const startsMs = startsAt ? Date.parse(startsAt) : null;
  const endsMs = endsAt ? Date.parse(endsAt) : null;
  const disabledUntilMs = disabledUntil ? Date.parse(disabledUntil) : null;
  let effectiveMode = mode;
  let scheduleState = 'active';
  let commandWritesAllowed = mode === 'enabled';
  let denialReason = null;
  let nextEnableAt = null;
  let nextDisableAt = null;

  if (mode === 'disabled') {
    commandWritesAllowed = false;
    scheduleState = 'disabled';
    denialReason = 'claim-browser-disabled';
    if (disabledUntil && disabledUntilMs > nowMs) {
      nextEnableAt = disabledUntil;
      denialReason = 'claim-browser-disabled-until';
    } else if (disabledUntil) {
      commandWritesAllowed = true;
      effectiveMode = 'enabled';
      scheduleState = 'expired';
      denialReason = null;
      validationWarnings.push('disabledUntil elapsed; command writes are enabled');
    }
  } else if (mode === 'scheduled') {
    commandWritesAllowed = true;
    if (startsAt && startsMs > nowMs) {
      commandWritesAllowed = false;
      scheduleState = 'waiting';
      denialReason = 'claim-browser-schedule-not-started';
      nextEnableAt = startsAt;
    } else if (endsAt && endsMs <= nowMs) {
      commandWritesAllowed = false;
      scheduleState = 'expired';
      denialReason = 'claim-browser-schedule-expired';
    } else {
      scheduleState = 'active';
      nextDisableAt = endsAt;
    }
    if (!startsAt && !endsAt) validationWarnings.push('scheduled lifecycle mode has no schedule bounds');
  } else if (disabledUntil && disabledUntilMs > nowMs) {
    commandWritesAllowed = false;
    effectiveMode = 'disabled';
    scheduleState = 'disabled';
    denialReason = 'claim-browser-disabled-until';
    nextEnableAt = disabledUntil;
  }

  if (!LIFECYCLE_SCHEDULE_STATES.has(scheduleState)) scheduleState = 'active';
  return {
    mode,
    effectiveMode,
    enabled: commandWritesAllowed,
    commandWritesAllowed,
    scheduleState,
    denialReason,
    disabledReason: stableText(mergedSettings.disabledReason, stableText(mergedSettings.reason, null)),
    disabledUntil,
    schedule: {
      startsAt,
      endsAt,
      nextEnableAt,
      nextDisableAt
    },
    nextReviewAt: nextEnableAt || nextDisableAt || null,
    validationWarnings,
    updatedBy: stableText(mergedSettings.updatedBy, null),
    updatedAt: stableText(mergedSettings.updatedAt, now)
  };
}

function buildActionableHealthError(code, message, operatorAction, retryable, retryAfterMs, escalationRoute) {
  return {
    code,
    message,
    operatorAction,
    retryable,
    retryAfterMs: retryable ? retryAfterMs : null,
    escalationRoute
  };
}

function normalizeOperationalHealth(input, now, workspacePolicy, lifecycleSettings) {
  const persisted = asRecord(input.persistedState);
  const persistedHealth = asRecord(persisted.operationalHealth);
  const requestedHealth = {
    ...asRecord(input.hostedKernelHealth),
    ...asRecord(input.operationalHealth)
  };
  const health = { ...persistedHealth, ...requestedHealth };
  const escalationRoute = stableText(health.escalationRoute, workspacePolicy.escalationRoute);
  const consecutiveFailures = Math.max(0, toFiniteNumber(health.consecutiveFailures, 0));
  const queueDepth = Math.max(0, toFiniteNumber(health.commandQueueDepth, 0));
  const kernelReachable = health.kernelReachable !== false && health.status !== 'offline';
  const proofWriterReachable = health.proofWriterReachable !== false;
  const commandWriteDisabled = health.commandWriteDisabled === true;
  const backoffAttempt = clampNumber(consecutiveFailures || toFiniteNumber(health.backoffAttempt, 0), 0, 12, 0);
  const computedRetryAfterMs = clampNumber(
    HEALTH_RETRY_BASE_MS * (2 ** backoffAttempt),
    HEALTH_RETRY_BASE_MS,
    HEALTH_RETRY_MAX_MS,
    HEALTH_RETRY_BASE_MS
  );
  const retryAfterMs = clampNumber(health.retryAfterMs, HEALTH_RETRY_BASE_MS, HEALTH_RETRY_MAX_MS, computedRetryAfterMs);
  const actionableErrors = [];

  if (!kernelReachable) {
    actionableErrors.push(buildActionableHealthError(
      'hosted-kernel-unreachable',
      'Hosted kernel is not reachable for claim command writes.',
      'Retry the command after the backoff window; escalate if the kernel remains offline.',
      true,
      retryAfterMs,
      escalationRoute
    ));
  }
  if (!proofWriterReachable) {
    actionableErrors.push(buildActionableHealthError(
      'proof-writer-unavailable',
      'Claim proof writer is unavailable, so mutating commands cannot produce audit proof.',
      'Keep browsing in read-only mode and retry after proof persistence recovers.',
      true,
      retryAfterMs,
      escalationRoute
    ));
  }
  if (commandWriteDisabled) {
    actionableErrors.push(buildActionableHealthError(
      'command-writes-disabled',
      'Claim command writes are disabled by hosted-kernel health state.',
      'Use read-only review and follow the escalation route before forcing writes.',
      false,
      retryAfterMs,
      escalationRoute
    ));
  }
  if (queueDepth > HEALTH_QUEUE_DEPTH_WARN) {
    actionableErrors.push(buildActionableHealthError(
      'command-queue-backpressure',
      `Claim command queue depth ${queueDepth} exceeds ${HEALTH_QUEUE_DEPTH_WARN}.`,
      'Delay non-urgent commands until queue depth recovers.',
      true,
      retryAfterMs,
      escalationRoute
    ));
  }
  if (!lifecycleSettings.commandWritesAllowed) {
    const retryAfterMs = lifecycleSettings.schedule.nextEnableAt
      ? clampNumber(millisecondsUntil(now, lifecycleSettings.schedule.nextEnableAt), HEALTH_RETRY_BASE_MS, HEALTH_RETRY_MAX_MS, computedRetryAfterMs)
      : computedRetryAfterMs;
    actionableErrors.push(buildActionableHealthError(
      lifecycleSettings.denialReason || 'claim-browser-lifecycle-disabled',
      'Claim browser lifecycle settings currently prevent command writes.',
      lifecycleSettings.schedule.nextEnableAt
        ? 'Wait until the scheduled enable time or update lifecycle settings before issuing commands.'
        : 'Update lifecycle settings before issuing mutating commands.',
      Boolean(lifecycleSettings.schedule.nextEnableAt),
      retryAfterMs,
      escalationRoute
    ));
  }

  const commandWritesEnabled = kernelReachable && proofWriterReachable && !commandWriteDisabled && lifecycleSettings.commandWritesAllowed;
  const degraded = actionableErrors.length > 0 || consecutiveFailures > 0;
  const severity = !kernelReachable || commandWriteDisabled
    ? 'unavailable'
    : degraded
      ? 'degraded'
      : 'ok';
  return {
    status: severity,
    ready: severity !== 'unavailable',
    degraded,
    commandWritesEnabled,
    readOnlyMode: !commandWritesEnabled || workspacePolicy.readOnly,
    lifecycle: lifecycleSettings,
    kernelReachable,
    proofWriterReachable,
    commandQueueDepth: queueDepth,
    consecutiveFailures,
    lastFailureAt: stableText(health.lastFailureAt, null),
    lastFailureReason: stableText(health.lastFailureReason, null),
    retryPolicy: {
      baseMs: HEALTH_RETRY_BASE_MS,
      maxMs: HEALTH_RETRY_MAX_MS,
      attempt: backoffAttempt,
      retryAfterMs,
      nextRetryAt: degraded ? addMillisecondsIso(now, retryAfterMs) : null
    },
    actionableErrors,
    escalationRoute
  };
}

function buildOperationalHealthDecision(operationalHealth, workspacePolicy, now) {
  const retryableErrors = operationalHealth.actionableErrors.filter((error) => error.retryable);
  const blockingErrors = operationalHealth.actionableErrors.filter((error) => !error.retryable);
  const retryAt = operationalHealth.retryPolicy.nextRetryAt;
  const canRetryNow = retryAt ? Date.parse(retryAt) <= Date.parse(now) : false;
  const readOnlyReason = workspacePolicy.readOnly
    ? 'workspace-policy-read-only'
    : !operationalHealth.commandWritesEnabled
      ? 'operational-health-read-only'
      : null;
  const state = operationalHealth.commandWritesEnabled && !workspacePolicy.readOnly
    ? operationalHealth.degraded
      ? 'degraded-writable'
      : 'writable'
    : blockingErrors.length > 0
      ? 'blocked'
      : retryableErrors.length > 0
        ? 'retryable-read-only'
        : 'read-only';

  return {
    contract: 'claim-browser.operational-health-decision.v1',
    state,
    writable: state === 'writable' || state === 'degraded-writable',
    readOnly: Boolean(readOnlyReason) || state === 'read-only' || state === 'retryable-read-only',
    degraded: operationalHealth.degraded,
    retryable: retryableErrors.length > 0,
    canRetryNow,
    retryAt,
    retryAfterMs: operationalHealth.retryPolicy.retryAfterMs,
    readOnlyReason,
    primaryErrorCode: operationalHealth.actionableErrors[0]?.code || null,
    retryableErrorCodes: retryableErrors.map((error) => error.code),
    blockingErrorCodes: blockingErrors.map((error) => error.code),
    escalationRoute: operationalHealth.escalationRoute,
    nextRecoveryAction: state === 'blocked'
      ? 'follow-escalation-route'
      : retryableErrors.length > 0
        ? canRetryNow
          ? 'retry-command-now'
          : 'wait-for-health-retry-window'
        : operationalHealth.degraded
          ? 'continue-with-degraded-health-warning'
          : workspacePolicy.readOnly
            ? 'request-workspace-write-policy'
            : 'continue-normal-claim-review',
    operatorSummary: state === 'writable'
      ? 'Claim browser writes are available.'
      : state === 'degraded-writable'
        ? 'Claim browser writes are available with degraded health warnings.'
        : state === 'retryable-read-only'
          ? 'Claim browser is read-only until retryable health conditions recover.'
          : state === 'blocked'
            ? 'Claim browser command writes are blocked by non-retryable health state.'
            : 'Claim browser is in read-only mode.'
  };
}

function commandProofRefs(command) {
  const request = asRecord(command);
  return [
    ...normalizeStringList(request.proofRefs),
    ...normalizeStringList(request.evidenceRefs)
  ];
}

function commandEvidenceKinds(command) {
  const request = asRecord(command);
  const inlineEvidence = Array.isArray(request.evidence) ? request.evidence : [];
  return inlineEvidence
    .map((entry) => stableText(asRecord(entry).kind, null))
    .filter(Boolean);
}

function commandEvidenceRefs(command, now) {
  const request = asRecord(command);
  const inlineEvidence = normalizeEvidence(request.evidence);
  return inlineEvidence.map((entry, index) => ({
    id: entry.id,
    ref: entry.digest || entry.id || `command-evidence:${now}:${index + 1}`,
    kind: entry.kind,
    source: entry.source,
    observedAt: entry.observedAt || now
  }));
}

function actionReasonText(command) {
  const request = asRecord(command);
  return stableText(request.reason, stableText(request.note, stableText(request.comment, null)));
}

function terminalEvidenceSatisfied(policy, command, target) {
  if (!policy.requireTerminalEvidence) return true;
  const proofRefs = [...target.proofRefs, ...commandProofRefs(command)];
  if (proofRefs.length) return true;
  if (!policy.terminalEvidenceKinds.length) return false;
  const providedKinds = commandEvidenceKinds(command);
  return providedKinds.some((kind) => policy.terminalEvidenceKinds.includes(kind));
}

function buildPolicyBoundaryEvent(policy, commandId, fingerprint, principal, reason, extra = {}) {
  return {
    kind: extra.overrideAccepted ? 'workspace-policy-override' : 'workspace-policy-denied',
    commandId,
    claimId: fingerprint.claimId,
    action: fingerprint.action,
    principalId: principal.id,
    role: principal.role,
    reason,
    tenantId: fingerprint.tenantId,
    workspaceId: fingerprint.workspaceId,
    policyTenantId: policy.tenantId,
    policyWorkspaceId: policy.workspaceId,
    escalationRoute: policy.escalationRoute,
    ...extra
  };
}

function buildHealthBoundaryEvent(operationalHealth, commandId, fingerprint, principal) {
  const primaryError = operationalHealth.actionableErrors[0] || buildActionableHealthError(
    'claim-browser-unhealthy',
    'Claim browser command path is not healthy.',
    'Retry after the published backoff window or escalate to hosted-kernel operations.',
    true,
    operationalHealth.retryPolicy.retryAfterMs,
    operationalHealth.escalationRoute
  );
  return {
    kind: 'claim-browser-health-command-denied',
    commandId,
    claimId: fingerprint.claimId,
    action: fingerprint.action,
    principalId: principal.id,
    healthStatus: operationalHealth.status,
    reason: primaryError.code,
    retryable: primaryError.retryable,
    retryAfterMs: primaryError.retryAfterMs,
    nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
    escalationRoute: operationalHealth.escalationRoute,
    actionableError: primaryError
  };
}

function normalizeHealthRetryDirective(rawDirective, now) {
  const directive = asRecord(rawDirective);
  const commandId = stableText(directive.commandId, stableText(directive.id, null));
  if (!commandId) return null;
  const retryAfterMs = clampNumber(
    directive.retryAfterMs,
    HEALTH_RETRY_BASE_MS,
    HEALTH_RETRY_MAX_MS,
    HEALTH_RETRY_BASE_MS
  );
  const nextRetryAt = normalizeIsoTimestamp(directive.nextRetryAt) || addMillisecondsIso(now, retryAfterMs);
  return {
    kind: stableText(directive.kind, 'claim-browser-command-retry.v1'),
    commandId,
    claimId: stableText(directive.claimId, null),
    action: stableText(directive.action, null),
    tenantId: stableText(directive.tenantId, null),
    workspaceId: stableText(directive.workspaceId, null),
    principalId: stableText(directive.principalId, null),
    reason: stableText(directive.reason, 'claim-browser-command-writes-unavailable'),
    retryable: directive.retryable !== false,
    attempts: Math.max(1, toFiniteNumber(directive.attempts, 1)),
    retryAfterMs,
    nextRetryAt,
    escalationRoute: stableText(directive.escalationRoute, 'hosted-kernel.audit.claim-browser.health'),
    route: stableText(directive.route, null),
    createdAt: normalizeIsoTimestamp(directive.createdAt) || now,
    updatedAt: normalizeIsoTimestamp(directive.updatedAt) || now
  };
}

function normalizeHealthRetryQueue(persisted, now) {
  const seen = new Set();
  const directives = [];
  const rawDirectives = Array.isArray(persisted.healthRetryQueue)
    ? persisted.healthRetryQueue
    : Array.isArray(persisted.commandRetryQueue)
      ? persisted.commandRetryQueue
      : [];
  for (const rawDirective of rawDirectives) {
    const directive = normalizeHealthRetryDirective(rawDirective, now);
    if (!directive || seen.has(directive.commandId)) continue;
    seen.add(directive.commandId);
    directives.push(directive);
  }
  return directives.slice(-HEALTH_COMMAND_RETRY_LIMIT);
}

function buildHealthRetryDirective(operationalHealth, healthEvent, commandId, fingerprint, principal, now) {
  if (!commandId || !healthEvent.retryable) return null;
  const reason = stableText(healthEvent.reason, healthDenialReason(operationalHealth));
  if (!RETRYABLE_HEALTH_DENIAL_CODES.has(reason)) return null;
  const retryAfterMs = clampNumber(
    healthEvent.retryAfterMs,
    HEALTH_RETRY_BASE_MS,
    HEALTH_RETRY_MAX_MS,
    operationalHealth.retryPolicy.retryAfterMs
  );
  return {
    kind: 'claim-browser-command-retry.v1',
    commandId,
    claimId: fingerprint.claimId,
    action: fingerprint.action,
    tenantId: fingerprint.tenantId,
    workspaceId: fingerprint.workspaceId,
    principalId: principal.id,
    reason,
    retryable: true,
    attempts: Math.max(1, operationalHealth.retryPolicy.attempt + 1),
    retryAfterMs,
    nextRetryAt: healthEvent.nextRetryAt || addMillisecondsIso(now, retryAfterMs),
    escalationRoute: operationalHealth.escalationRoute,
    route: `claim-browser://${fingerprint.tenantId}/${fingerprint.workspaceId}/claims/${fingerprint.claimId}/commands/${commandId}/retry`,
    createdAt: now,
    updatedAt: now
  };
}

function appendHealthRetryDirective(state, directive) {
  if (!directive) return state;
  const healthRetryQueue = [
    ...state.healthRetryQueue.filter((entry) => entry.commandId !== directive.commandId),
    directive
  ].slice(-HEALTH_COMMAND_RETRY_LIMIT);
  return {
    ...state,
    healthRetryQueue,
    commandRetryQueue: healthRetryQueue
  };
}

function claimPolicyDenialReason(claim, policy) {
  if (!policy.scopeMatched) return 'workspace-policy-out-of-scope';
  if (policy.readOnly) return 'workspace-read-only';
  if (policy.lockedClaimIds.includes(claim.id)) return 'claim-locked-by-workspace-policy';
  return null;
}

function claimGrantMatchesPrincipal(grant, principal, action) {
  return (
    grant.actions.includes(action) &&
    (
      grant.roles.includes(principal.role) ||
      grant.principalIds.includes(principal.id)
    )
  );
}

function claimActionAllowedByGrants(claim, principal, action) {
  if (!claim || !Array.isArray(claim.permissionGrants) || claim.permissionGrants.length === 0) return true;
  return claim.permissionGrants.some((grant) => claimGrantMatchesPrincipal(grant, principal, action));
}

function claimPermissionDenialReason(claim, principal, action = null) {
  if (!claim || !Array.isArray(claim.permissionGrants) || claim.permissionGrants.length === 0) return null;
  if (!action) return 'claim-permission-grant-required';
  return claimActionAllowedByGrants(claim, principal, action) ? null : 'claim-permission-denied';
}

function buildClaimPermissionBoundaryEvent(commandId, fingerprint, principal, target, reason) {
  return {
    kind: 'claim-permission-denied',
    commandId,
    claimId: fingerprint.claimId,
    action: fingerprint.action,
    principalId: principal.id,
    role: principal.role,
    reason,
    tenantId: fingerprint.tenantId,
    workspaceId: fingerprint.workspaceId,
    grantIds: target.permissionGrants.map((grant) => grant.id),
    grantCount: target.permissionGrants.length
  };
}

function normalizeCommandBoundaryDecision(rawDecision) {
  const decision = asRecord(rawDecision);
  const decisionId = stableText(decision.decisionId, null);
  if (!decisionId) return null;
  const checks = (Array.isArray(decision.checks) ? decision.checks : [])
    .map((rawCheck) => {
      const check = asRecord(rawCheck);
      const name = stableText(check.name, null);
      if (!name) return null;
      return {
        name,
        passed: check.passed === true,
        reason: stableText(check.reason, null)
      };
    })
    .filter(Boolean);
  return {
    kind: stableText(decision.kind, 'claim-browser-command-boundary-decision.v1'),
    decisionId,
    commandId: stableText(decision.commandId, null),
    claimId: stableText(decision.claimId, null),
    action: stableText(decision.action, null),
    tenantId: stableText(decision.tenantId, null),
    workspaceId: stableText(decision.workspaceId, null),
    principalId: stableText(decision.principalId, null),
    role: stableText(decision.role, null),
    accepted: decision.accepted === true,
    reason: stableText(decision.reason, 'unknown'),
    blockingReasons: normalizeStringList(decision.blockingReasons),
    checks,
    scope: asRecord(decision.scope),
    roleGrant: asRecord(decision.roleGrant),
    workspacePolicy: asRecord(decision.workspacePolicy),
    claimPermission: asRecord(decision.claimPermission),
    operationalHealth: asRecord(decision.operationalHealth),
    proof: asRecord(decision.proof),
    route: stableText(decision.route, null),
    auditRoute: stableText(decision.auditRoute, null),
    generatedAt: stableText(decision.generatedAt, null)
  };
}

function buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, options = {}) {
  const target = options.target || null;
  const request = asRecord(options.command);
  const action = fingerprint.action;
  const policy = state.workspacePolicy;
  const healthReason = healthDenialReason(state.operationalHealth);
  const roleAllowed = principalCanApply(principal, action);
  const commandInActiveScope = fingerprint.tenantId === state.tenantId && fingerprint.workspaceId === state.workspaceId;
  const targetInActiveScope = target
    ? target.tenantId === state.tenantId && target.workspaceId === state.workspaceId
    : false;
  const principalInScope = principalHasScope(principal, state.tenantId, state.workspaceId);
  const policyReason = target ? claimPolicyDenialReason(target, policy) : null;
  const grantReason = target ? claimPermissionDenialReason(target, principal, action) : null;
  const terminalBlocked = target && TERMINAL_STATUS.has(target.status) && action !== 'reopen';
  const terminalProofRequired = target && TERMINAL_COMMANDS.has(action) && policy.requireTerminalEvidence === true;
  const terminalProofSatisfied = target
    ? terminalEvidenceSatisfied(policy, request, target) || options.tenantAdminOverride === true
    : false;
  const knownAction = COMMAND_ACTIONS.includes(action);
  const checks = [
    {
      name: 'hosted-kernel-command-writes-enabled',
      passed: !healthReason,
      reason: healthReason
    },
    {
      name: 'known-command-action',
      passed: knownAction,
      reason: knownAction ? null : 'unknown-action'
    },
    {
      name: 'principal-role-allows-action',
      passed: roleAllowed,
      reason: roleAllowed ? null : 'permission-denied'
    },
    {
      name: 'claim-exists',
      passed: Boolean(target),
      reason: target ? null : 'claim-not-found'
    },
    {
      name: 'tenant-workspace-boundary',
      passed: commandInActiveScope && targetInActiveScope && principalInScope,
      reason: commandInActiveScope && targetInActiveScope && principalInScope ? null : 'scope-boundary-denied'
    },
    {
      name: 'workspace-policy',
      passed: target ? !policyReason || options.tenantAdminOverride === true : false,
      reason: target && policyReason && options.tenantAdminOverride !== true ? policyReason : target ? null : 'claim-not-found'
    },
    {
      name: 'claim-permission-grant',
      passed: target ? !grantReason : false,
      reason: target ? grantReason : 'claim-not-found'
    },
    {
      name: 'terminal-transition',
      passed: target ? !terminalBlocked : false,
      reason: terminalBlocked ? 'terminal-claim' : target ? null : 'claim-not-found'
    },
    {
      name: 'terminal-proof',
      passed: target ? !terminalProofRequired || terminalProofSatisfied : false,
      reason: terminalProofRequired && !terminalProofSatisfied ? 'terminal-evidence-required' : target ? null : 'claim-not-found'
    }
  ];
  const failedReasons = checks
    .filter((check) => !check.passed && check.reason)
    .map((check) => check.reason);
  const blockingReasons = [...new Set(options.reason ? [options.reason, ...failedReasons] : failedReasons)];
  return {
    kind: 'claim-browser-command-boundary-decision.v1',
    decisionId: `decision:${state.tenantId}:${state.workspaceId}:${commandId || 'missing-command'}:${now}`,
    commandId,
    claimId: fingerprint.claimId,
    action,
    tenantId: fingerprint.tenantId,
    workspaceId: fingerprint.workspaceId,
    principalId: principal.id,
    role: principal.role,
    accepted: options.accepted === true,
    reason: options.reason || blockingReasons[0] || (options.accepted ? 'applied' : 'blocked'),
    blockingReasons,
    checks,
    scope: {
      activeTenantId: state.tenantId,
      activeWorkspaceId: state.workspaceId,
      commandTenantId: fingerprint.tenantId,
      commandWorkspaceId: fingerprint.workspaceId,
      targetTenantId: target ? target.tenantId : null,
      targetWorkspaceId: target ? target.workspaceId : null,
      principalTenantIds: principal.tenantIds,
      principalWorkspaceIds: principal.workspaceIds
    },
    roleGrant: {
      role: principal.role,
      allowedActions: ROLE_ACTIONS[principal.role] || [],
      actionAllowed: roleAllowed
    },
    workspacePolicy: {
      scopeMatched: policy.scopeMatched,
      readOnly: policy.readOnly,
      allowedActions: policy.allowedActions,
      lockedClaim: target ? policy.lockedClaimIds.includes(target.id) : false,
      terminalEvidenceRequired: policy.requireTerminalEvidence,
      tenantAdminOverride: options.tenantAdminOverride === true,
      escalationRoute: policy.escalationRoute
    },
    claimPermission: {
      grantRequired: target ? target.permissionGrants.length > 0 : false,
      grantCount: target ? target.permissionGrants.length : 0,
      matchingGrantIds: target
        ? target.permissionGrants
            .filter((grant) => claimGrantMatchesPrincipal(grant, principal, action))
            .map((grant) => grant.id)
        : []
    },
    operationalHealth: {
      status: state.operationalHealth.status,
      commandWritesEnabled: state.operationalHealth.commandWritesEnabled,
      denialReason: healthReason,
      retryAfterMs: state.operationalHealth.retryPolicy.retryAfterMs,
      nextRetryAt: state.operationalHealth.retryPolicy.nextRetryAt,
      escalationRoute: state.operationalHealth.escalationRoute
    },
    proof: {
      terminalCommand: TERMINAL_COMMANDS.has(action),
      terminalProofRequired,
      terminalProofSatisfied,
      commandProofRefs: commandProofRefs(request),
      inlineEvidenceRefs: commandEvidenceRefs(request, now).map((entry) => entry.ref)
    },
    route: target
      ? `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${target.id}/commands/${commandId}`
      : `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${fingerprint.claimId || 'unknown'}/commands/${commandId}`,
    auditRoute: `${policy.escalationRoute}.boundary-decision`,
    generatedAt: now
  };
}

function normalizeCommandReceipt(rawReceipt, now) {
  const receipt = asRecord(rawReceipt);
  const commandId = stableText(receipt.commandId, stableText(receipt.id, null));
  if (!commandId) return null;
  const fingerprint = asRecord(receipt.fingerprint);
  return {
    commandId,
    claimId: stableText(receipt.claimId, stableText(fingerprint.claimId, null)),
    action: stableText(receipt.action, stableText(fingerprint.action, null)),
    tenantId: stableText(receipt.tenantId, stableText(fingerprint.tenantId, null)),
    workspaceId: stableText(receipt.workspaceId, stableText(fingerprint.workspaceId, null)),
    accepted: receipt.accepted === true,
    reason: stableText(receipt.reason, 'unknown'),
    appliedRevision: Number.isFinite(receipt.appliedRevision) ? receipt.appliedRevision : null,
    recordedAt: stableText(receipt.recordedAt, now),
    principalId: stableText(receipt.principalId, null),
    boundaryDecision: normalizeCommandBoundaryDecision(receipt.boundaryDecision)
  };
}

function normalizeCommandReceipts(persisted, now) {
  const receipts = [];
  const seen = new Set();
  const rawReceipts = Array.isArray(persisted.commandReceipts) ? persisted.commandReceipts : [];
  for (const rawReceipt of rawReceipts) {
    const receipt = normalizeCommandReceipt(rawReceipt, now);
    if (!receipt || seen.has(receipt.commandId)) continue;
    seen.add(receipt.commandId);
    receipts.push(receipt);
  }
  const legacyLedger = Array.isArray(persisted.commandLedger) ? persisted.commandLedger : [];
  for (const commandId of legacyLedger.map((id) => stableText(id, null)).filter(Boolean)) {
    if (seen.has(commandId)) continue;
    seen.add(commandId);
    receipts.push({
      commandId,
      claimId: null,
      action: null,
      tenantId: null,
      workspaceId: null,
      accepted: true,
      reason: 'legacy-ledger-entry',
      appliedRevision: null,
      recordedAt: now,
      principalId: null
    });
  }
  return receipts.slice(-COMMAND_RECEIPT_LIMIT);
}

function normalizeCommandAuditEntry(rawEntry, now) {
  const entry = asRecord(rawEntry);
  const commandId = stableText(entry.commandId, stableText(entry.id, null));
  if (!commandId) return null;
  return {
    commandId,
    claimId: stableText(entry.claimId, null),
    action: stableText(entry.action, null),
    accepted: entry.accepted === true,
    reason: stableText(entry.reason, 'unknown'),
    principalId: stableText(entry.principalId, null),
    recordedAt: stableText(entry.recordedAt, now),
    beforeStatus: stableText(entry.beforeStatus, null),
    afterStatus: stableText(entry.afterStatus, null),
    beforeRevision: Number.isFinite(entry.beforeRevision) ? entry.beforeRevision : null,
    afterRevision: Number.isFinite(entry.afterRevision) ? entry.afterRevision : null,
    attachedProofRefs: normalizeProofRefs(entry.attachedProofRefs),
    operatorNote: stableText(entry.operatorNote, null),
    boundaryDecision: normalizeCommandBoundaryDecision(entry.boundaryDecision)
  };
}

function normalizeCommandAudit(persisted, now) {
  const seen = new Set();
  const entries = [];
  const rawEntries = Array.isArray(persisted.commandAudit) ? persisted.commandAudit : [];
  for (const rawEntry of rawEntries) {
    const entry = normalizeCommandAuditEntry(rawEntry, now);
    if (!entry) continue;
    const key = `${entry.commandId}:${entry.recordedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.slice(-COMMAND_AUDIT_LIMIT);
}

function normalizeRecoveryJournalEntry(rawEntry, now) {
  const entry = asRecord(rawEntry);
  const claimId = stableText(entry.claimId, null);
  const recoveryId = stableText(entry.recoveryId, stableText(entry.id, claimId ? `recovery:${claimId}:${now}` : null));
  if (!claimId || !recoveryId) return null;
  return {
    recoveryId,
    kind: stableText(entry.kind, 'claim-restart-recovery'),
    claimId,
    fromStatus: stableText(entry.fromStatus, null),
    toStatus: stableText(entry.toStatus, null),
    fromRevision: Number.isFinite(entry.fromRevision) ? entry.fromRevision : null,
    toRevision: Number.isFinite(entry.toRevision) ? entry.toRevision : null,
    reason: stableText(entry.reason, 'restart-recovery'),
    commandId: stableText(entry.commandId, null),
    evidenceSource: stableText(entry.evidenceSource, null),
    recoveredAt: stableText(entry.recoveredAt, now),
    restartSafe: entry.restartSafe !== false
  };
}

function normalizeRecoveryJournal(persisted, now) {
  const seen = new Set();
  const entries = [];
  const rawJournal = Array.isArray(persisted.recoveryJournal) ? persisted.recoveryJournal : [];
  for (const rawEntry of rawJournal) {
    const entry = normalizeRecoveryJournalEntry(rawEntry, now);
    if (!entry) continue;
    const key = `${entry.recoveryId}:${entry.claimId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.slice(-RECOVERY_JOURNAL_LIMIT);
}

function normalizeRecoveryIntent(rawIntent, now, scope) {
  const intent = asRecord(rawIntent);
  const claimId = stableText(intent.claimId, null);
  if (!claimId) return null;
  const tenantId = stableText(intent.tenantId, scope.tenantId);
  const workspaceId = stableText(intent.workspaceId, scope.workspaceId);
  const requestedStatus = stableText(intent.status, stableText(intent.toStatus, stableText(intent.restartSafeStatus, null)));
  const safeStatus = RESTART_SAFE_STATUS[requestedStatus] || (KNOWN_STATUS.has(requestedStatus) ? requestedStatus : null);
  const revision = Number.isFinite(intent.revision)
    ? Math.max(0, intent.revision)
    : Number.isFinite(intent.toRevision)
      ? Math.max(0, intent.toRevision)
      : null;
  const recordedAt = normalizeIsoTimestamp(intent.recordedAt || intent.recoveredAt || intent.updatedAt) || now;
  return {
    intentId: stableText(intent.intentId, stableText(intent.id, `restart-intent:${tenantId}:${workspaceId}:${claimId}:${recordedAt}`)),
    claimId,
    tenantId,
    workspaceId,
    status: safeStatus,
    revision,
    commandId: stableText(intent.commandId, null),
    reason: stableText(intent.reason, 'persisted-recovery-intent'),
    source: stableText(intent.source, 'persistedState.recoveryIntents'),
    recordedAt
  };
}

function normalizeRecoveryIntents(persisted, now, scope) {
  const seen = new Set();
  const intents = [];
  const rawIntents = Array.isArray(persisted.recoveryIntents)
    ? persisted.recoveryIntents
    : Array.isArray(persisted.restartRecoveryIntents)
      ? persisted.restartRecoveryIntents
      : [];
  for (const rawIntent of rawIntents) {
    const intent = normalizeRecoveryIntent(rawIntent, now, scope);
    if (!intent || seen.has(intent.intentId)) continue;
    seen.add(intent.intentId);
    intents.push(intent);
  }
  return intents
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    .slice(-RECOVERY_INTENT_LIMIT);
}

function commandActionStatus(action) {
  if (action === 'queue' || action === 'reopen') return 'queued';
  if (action === 'block') return 'blocked';
  if (action === 'accept') return 'accepted';
  if (action === 'reject') return 'rejected';
  return null;
}

function latestAcceptedAuditForClaim(claimId, commandAudit) {
  return commandAudit
    .filter((entry) => entry.accepted && entry.claimId === claimId && KNOWN_STATUS.has(entry.afterStatus))
    .sort((left, right) => {
      const revisionDelta = toFiniteNumber(right.afterRevision, -1) - toFiniteNumber(left.afterRevision, -1);
      return revisionDelta || right.recordedAt.localeCompare(left.recordedAt);
    })[0] || null;
}

function latestAcceptedReceiptForClaim(claimId, commandReceipts) {
  return commandReceipts
    .filter((receipt) => receipt.accepted && receipt.claimId === claimId)
    .sort((left, right) => {
      const revisionDelta = toFiniteNumber(right.appliedRevision, -1) - toFiniteNumber(left.appliedRevision, -1);
      return revisionDelta || right.recordedAt.localeCompare(left.recordedAt);
    })[0] || null;
}

function buildRecoveryJournalEntry(claim, nextClaim, reason, now, evidenceSource, commandId = null) {
  return {
    recoveryId: `recovery:${claim.tenantId}:${claim.workspaceId}:${claim.id}:${nextClaim.revision}:${reason}`,
    kind: 'claim-restart-recovery',
    claimId: claim.id,
    fromStatus: claim.status,
    toStatus: nextClaim.status,
    fromRevision: claim.revision,
    toRevision: nextClaim.revision,
    reason,
    commandId,
    evidenceSource,
    recoveredAt: now,
    restartSafe: nextClaim.status === nextClaim.restartSafeStatus
  };
}

function buildRestartStateConflictEvent(claim, normalizedRestartSafeStatus, now) {
  return {
    recoveryId: `recovery:${claim.tenantId}:${claim.workspaceId}:${claim.id}:${claim.revision}:restart-safe-metadata-conflict`,
    kind: 'claim-restart-recovery',
    claimId: claim.id,
    fromStatus: claim.status,
    toStatus: normalizedRestartSafeStatus,
    fromRevision: claim.revision,
    toRevision: claim.revision,
    reason: 'restart-safe-metadata-conflict',
    commandId: stableText(claim.hostedKernelCommandId, null),
    evidenceSource: 'persistedState.claims[].restartSafeStatus',
    recoveredAt: now,
    restartSafe: normalizedRestartSafeStatus === (RESTART_SAFE_STATUS[normalizedRestartSafeStatus] || normalizedRestartSafeStatus)
  };
}

function latestRecoveryIntentForClaim(claim, recoveryIntents) {
  return recoveryIntents
    .filter((intent) => (
      intent.claimId === claim.id &&
      intent.tenantId === claim.tenantId &&
      intent.workspaceId === claim.workspaceId &&
      intent.status &&
      Number.isFinite(intent.revision)
    ))
    .sort((left, right) => right.revision - left.revision || right.recordedAt.localeCompare(left.recordedAt))[0] || null;
}

function recoverClaimRestartState(claim, commandReceipts, commandAudit, hostedKernelOutbox, recoveryIntents, now) {
  let nextClaim = { ...claim };
  const recoveryEvents = [];
  const normalizedPersistedRestartSafeStatus = RESTART_SAFE_STATUS[claim.restartSafeStatus] || (KNOWN_STATUS.has(claim.restartSafeStatus) ? claim.restartSafeStatus : null);
  if (normalizedPersistedRestartSafeStatus && normalizedPersistedRestartSafeStatus !== claim.restartSafeStatus) {
    nextClaim = {
      ...nextClaim,
      restartSafeStatus: normalizedPersistedRestartSafeStatus,
      recoverySource: stableText(nextClaim.recoverySource, 'restart-safe-metadata-normalized')
    };
  } else if (!normalizedPersistedRestartSafeStatus) {
    nextClaim = {
      ...nextClaim,
      restartSafeStatus: RESTART_SAFE_STATUS[claim.status] || 'queued',
      recoverySource: stableText(nextClaim.recoverySource, 'restart-safe-metadata-defaulted')
    };
  }
  if (normalizedPersistedRestartSafeStatus && normalizedPersistedRestartSafeStatus !== (RESTART_SAFE_STATUS[claim.status] || claim.status)) {
    recoveryEvents.push(buildRestartStateConflictEvent(claim, normalizedPersistedRestartSafeStatus, now));
  }

  const recoveryIntent = latestRecoveryIntentForClaim(claim, recoveryIntents);
  if (recoveryIntent && recoveryIntent.revision > nextClaim.revision) {
    const beforeRecovery = nextClaim;
    nextClaim = {
      ...nextClaim,
      status: recoveryIntent.status,
      restartSafeStatus: RESTART_SAFE_STATUS[recoveryIntent.status] || recoveryIntent.status,
      revision: recoveryIntent.revision,
      updatedAt: recoveryIntent.recordedAt,
      lastRecoveredCommandId: recoveryIntent.commandId,
      recoverySource: recoveryIntent.source
    };
    recoveryEvents.push(buildRecoveryJournalEntry(beforeRecovery, nextClaim, recoveryIntent.reason, now, recoveryIntent.source, recoveryIntent.commandId));
  }

  const acceptedAudit = latestAcceptedAuditForClaim(claim.id, commandAudit);
  if (acceptedAudit && toFiniteNumber(acceptedAudit.afterRevision, -1) > nextClaim.revision) {
    nextClaim = {
      ...nextClaim,
      status: RESTART_SAFE_STATUS[acceptedAudit.afterStatus] || acceptedAudit.afterStatus,
      restartSafeStatus: RESTART_SAFE_STATUS[acceptedAudit.afterStatus] || acceptedAudit.afterStatus,
      revision: acceptedAudit.afterRevision,
      updatedAt: acceptedAudit.recordedAt,
      lastRecoveredCommandId: acceptedAudit.commandId,
      recoverySource: 'command-audit'
    };
    recoveryEvents.push(buildRecoveryJournalEntry(claim, nextClaim, 'applied-newer-command-audit', now, 'commandAudit', acceptedAudit.commandId));
  }

  const acceptedReceipt = latestAcceptedReceiptForClaim(claim.id, commandReceipts);
  const receiptStatus = acceptedReceipt ? commandActionStatus(acceptedReceipt.action) : null;
  if (
    acceptedReceipt &&
    receiptStatus &&
    toFiniteNumber(acceptedReceipt.appliedRevision, -1) > nextClaim.revision
  ) {
    const beforeRecovery = nextClaim;
    nextClaim = {
      ...nextClaim,
      status: RESTART_SAFE_STATUS[receiptStatus] || receiptStatus,
      restartSafeStatus: RESTART_SAFE_STATUS[receiptStatus] || receiptStatus,
      revision: acceptedReceipt.appliedRevision,
      updatedAt: acceptedReceipt.recordedAt,
      lastRecoveredCommandId: acceptedReceipt.commandId,
      recoverySource: 'command-receipt'
    };
    recoveryEvents.push(buildRecoveryJournalEntry(beforeRecovery, nextClaim, 'applied-newer-command-receipt', now, 'commandReceipts', acceptedReceipt.commandId));
  }

  const pendingEnvelope = hostedKernelOutbox.find((envelope) => (
    envelope.claimId === nextClaim.id &&
    envelope.deliveryState !== 'acked' &&
    envelope.transition.afterRevision === nextClaim.revision
  ));
  if (pendingEnvelope) {
    nextClaim = {
      ...nextClaim,
      hostedKernelDeliveryState: pendingEnvelope.deliveryState,
      hostedKernelCommandId: pendingEnvelope.commandId,
      restartSafeStatus: RESTART_SAFE_STATUS[nextClaim.status] || nextClaim.status
    };
  }

  if (nextClaim.status !== nextClaim.restartSafeStatus) {
    const beforeRecovery = nextClaim;
    nextClaim = {
      ...nextClaim,
      status: nextClaim.restartSafeStatus,
      updatedAt: normalizeIsoTimestamp(nextClaim.updatedAt) || now,
      recoverySource: stableText(nextClaim.recoverySource, 'restart-safe-status-map')
    };
    recoveryEvents.push(buildRecoveryJournalEntry(beforeRecovery, nextClaim, 'remapped-volatile-status', now, 'restartSafeStatus'));
  }

  return { claim: nextClaim, recoveryEvents };
}

function commandFingerprint(command, state) {
  const request = asRecord(command);
  return {
    claimId: stableText(request.claimId, null),
    action: stableText(request.action, null),
    tenantId: stableText(request.tenantId, state.tenantId),
    workspaceId: stableText(request.workspaceId, state.workspaceId)
  };
}

function commandIdempotencyKey(command, state) {
  const request = asRecord(command);
  const explicitKey = stableText(request.idempotencyKey, stableText(request.clientMutationId, null));
  if (explicitKey) return explicitKey;
  const commandId = stableText(request.commandId, stableText(request.id, null));
  return commandId ? `claim-browser:${state.tenantId}:${state.workspaceId}:${commandId}` : null;
}

function receiptMatchesCommand(receipt, fingerprint) {
  if (!receipt.claimId && !receipt.action) return true;
  return (
    receipt.claimId === fingerprint.claimId &&
    receipt.action === fingerprint.action &&
    receipt.tenantId === fingerprint.tenantId &&
    receipt.workspaceId === fingerprint.workspaceId
  );
}

function outboxEnvelopeMatchesCommand(envelope, fingerprint) {
  return (
    envelope.claimId === fingerprint.claimId &&
    envelope.action === fingerprint.action &&
    envelope.tenantId === fingerprint.tenantId &&
    envelope.workspaceId === fingerprint.workspaceId
  );
}

function receiptFromOutboxEnvelope(envelope, now, reason = 'idempotency-key-replay') {
  return {
    commandId: envelope.commandId,
    claimId: envelope.claimId,
    action: envelope.action,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    accepted: true,
    reason,
    appliedRevision: envelope.transition.afterRevision,
    recordedAt: stableText(envelope.emittedAt, now),
    principalId: envelope.principalId
  };
}

function appendCommandReceipt(state, receipt) {
  const commandReceipts = [
    ...state.commandReceipts.filter((entry) => entry.commandId !== receipt.commandId),
    receipt
  ].slice(-COMMAND_RECEIPT_LIMIT);
  return {
    ...state,
    commandReceipts,
    commandLedger: commandReceipts.map((entry) => entry.commandId)
  };
}

function appendCommandAudit(state, entry) {
  return {
    ...state,
    commandAudit: [...state.commandAudit, entry].slice(-COMMAND_AUDIT_LIMIT)
  };
}

function normalizeHostedKernelCommandEnvelope(rawEnvelope, now) {
  const envelope = asRecord(rawEnvelope);
  const commandId = stableText(envelope.commandId, stableText(envelope.id, null));
  if (!commandId) return null;
  const transition = asRecord(envelope.transition);
  return {
    kind: stableText(envelope.kind, 'hosted-kernel.claim-command.v1'),
    surfaceId: stableText(envelope.surfaceId, surfaceId),
    commandId,
    idempotencyKey: stableText(envelope.idempotencyKey, `claim-browser:${commandId}`),
    tenantId: stableText(envelope.tenantId, null),
    workspaceId: stableText(envelope.workspaceId, null),
    claimId: stableText(envelope.claimId, null),
    action: stableText(envelope.action, null),
    principalId: stableText(envelope.principalId, null),
    role: stableText(envelope.role, null),
    emittedAt: stableText(envelope.emittedAt, now),
    deliveryState: stableText(envelope.deliveryState, 'pending'),
    route: stableText(envelope.route, null),
    correlationId: stableText(envelope.correlationId, null),
    proofRequired: envelope.proofRequired !== false,
    proofRefs: normalizeProofRefs(envelope.proofRefs),
    transition: {
      beforeStatus: stableText(transition.beforeStatus, null),
      afterStatus: stableText(transition.afterStatus, null),
      beforeRevision: Number.isFinite(transition.beforeRevision) ? transition.beforeRevision : null,
      afterRevision: Number.isFinite(transition.afterRevision) ? transition.afterRevision : null
    }
  };
}

function normalizeHostedKernelOutbox(persisted, now) {
  const seen = new Set();
  const envelopes = [];
  const rawOutbox = Array.isArray(persisted.hostedKernelOutbox)
    ? persisted.hostedKernelOutbox
    : Array.isArray(persisted.commandOutbox)
      ? persisted.commandOutbox
      : [];
  for (const rawEnvelope of rawOutbox) {
    const envelope = normalizeHostedKernelCommandEnvelope(rawEnvelope, now);
    if (!envelope || seen.has(envelope.commandId)) continue;
    seen.add(envelope.commandId);
    envelopes.push(envelope);
  }
  return envelopes.slice(-HOSTED_KERNEL_OUTBOX_LIMIT);
}

function buildHostedKernelCommandEnvelope(commandId, target, action, principal, now, beforeStatus, beforeRevision, attachedProofRefs, command) {
  const request = asRecord(command);
  const correlationId = stableText(request.correlationId, stableText(request.clientTraceId, target.clientTraceId));
  const requestedIdempotencyKey = stableText(request.idempotencyKey, stableText(request.clientMutationId, null));
  return {
    kind: 'hosted-kernel.claim-command.v1',
    surfaceId,
    commandId,
    idempotencyKey: requestedIdempotencyKey || `claim-browser:${target.tenantId}:${target.workspaceId}:${commandId}`,
    tenantId: target.tenantId,
    workspaceId: target.workspaceId,
    claimId: target.id,
    action,
    principalId: principal.id,
    role: principal.role,
    emittedAt: now,
    deliveryState: 'pending',
    route: `claim-browser://${target.tenantId}/${target.workspaceId}/claims/${target.id}/commands/${commandId}`,
    correlationId,
    proofRequired: TERMINAL_COMMANDS.has(action),
    proofRefs: attachedProofRefs,
    transition: {
      beforeStatus,
      afterStatus: target.status,
      beforeRevision,
      afterRevision: target.revision
    }
  };
}

function appendHostedKernelOutbox(state, envelope) {
  const hostedKernelOutbox = [
    ...state.hostedKernelOutbox.filter((entry) => entry.commandId !== envelope.commandId),
    envelope
  ].slice(-HOSTED_KERNEL_OUTBOX_LIMIT);
  return {
    ...state,
    hostedKernelOutbox,
    commandOutbox: hostedKernelOutbox
  };
}

function normalizeProviderDeliveryState(rawState) {
  const state = stableText(rawState, null);
  if (state === 'acked' || state === 'ack' || state === 'acknowledged' || state === 'succeeded') return 'acknowledged';
  if (state === 'failed' || state === 'error' || state === 'rejected') return 'failed';
  if (state === 'sent' || state === 'submitted' || state === 'inflight' || state === 'delivered') return 'sent';
  return null;
}

function normalizeProviderDeliveryReceipt(rawReceipt, now, fallbackState = null) {
  const receipt = asRecord(rawReceipt);
  const commandId = stableText(receipt.commandId, stableText(receipt.id, null));
  if (!commandId) return null;
  const state = normalizeProviderDeliveryState(
    receipt.state || receipt.deliveryState || receipt.handoffState || receipt.status || fallbackState
  );
  if (!state || !PROVIDER_DELIVERY_STATES.includes(state)) return null;
  const acknowledgedAt = normalizeIsoTimestamp(receipt.acknowledgedAt || receipt.ackedAt || receipt.completedAt);
  const failedAt = normalizeIsoTimestamp(receipt.failedAt || receipt.completedAt);
  const sentAt = normalizeIsoTimestamp(receipt.sentAt || receipt.submittedAt || receipt.deliveredAt);
  return {
    kind: stableText(receipt.kind, 'hosted-kernel.claim-command-delivery-receipt.v1'),
    commandId,
    state,
    providerCommandId: stableText(receipt.providerCommandId, stableText(receipt.externalCommandId, null)),
    providerRevision: Number.isFinite(receipt.providerRevision) ? receipt.providerRevision : null,
    sentAt,
    acknowledgedAt: state === 'acknowledged' ? acknowledgedAt || sentAt || now : acknowledgedAt,
    failedAt: state === 'failed' ? failedAt || now : failedAt,
    proofRefs: normalizeProofRefs(receipt.proofRefs || receipt.providerProofRefs),
    errorCode: stableText(receipt.errorCode, stableText(receipt.reason, null)),
    errorMessage: stableText(receipt.errorMessage, stableText(receipt.message, null)),
    retryable: receipt.retryable === true,
    statusCode: Number.isFinite(receipt.statusCode) ? receipt.statusCode : null,
    cursor: stableText(receipt.cursor, stableText(receipt.syncCursor, null)),
    receivedAt: normalizeIsoTimestamp(receipt.receivedAt || receipt.recordedAt) || now
  };
}

function normalizeProviderDeliveryReceipts(contract, now) {
  const receipts = [];
  const appendReceipt = (rawReceipt, fallbackState = null) => {
    const receipt = normalizeProviderDeliveryReceipt(rawReceipt, now, fallbackState);
    if (receipt) receipts.push(receipt);
  };
  for (const rawReceipt of Array.isArray(contract.deliveryReceipts) ? contract.deliveryReceipts : []) {
    appendReceipt(rawReceipt);
  }
  for (const rawReceipt of Array.isArray(contract.commandAcks) ? contract.commandAcks : []) {
    appendReceipt(rawReceipt, 'acknowledged');
  }
  for (const rawReceipt of Array.isArray(contract.commandFailures) ? contract.commandFailures : []) {
    appendReceipt(rawReceipt, 'failed');
  }
  for (const commandId of uniqueKnownStringList(contract.ackedCommandIds, contract.acknowledgedCommandIds)) {
    appendReceipt({ commandId, state: 'acknowledged', acknowledgedAt: now }, 'acknowledged');
  }
  for (const commandId of uniqueKnownStringList(contract.failedCommandIds)) {
    appendReceipt({ commandId, state: 'failed', failedAt: now, retryable: true }, 'failed');
  }
  const latestByCommandId = new Map();
  for (const receipt of receipts.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))) {
    latestByCommandId.set(receipt.commandId, receipt);
  }
  return [...latestByCommandId.values()].slice(-PROVIDER_DELIVERY_RECEIPT_LIMIT);
}

function providerReceiptHandoffState(receipt) {
  if (!receipt) return null;
  if (receipt.state === 'acknowledged') return 'acknowledged';
  if (receipt.state === 'failed') return 'failed';
  return 'awaiting-provider';
}

function normalizeMailchimpProviderSyncReceipt(rawReceipt, now) {
  const receipt = asRecord(rawReceipt);
  const receiptId = stableText(receipt.receiptId, stableText(receipt.id, null));
  const campaignId = stableText(receipt.campaignId, stableText(asRecord(receipt.campaign).id, null));
  const audienceId = stableText(
    receipt.audienceId,
    stableText(receipt.listId, stableText(asRecord(receipt.audience).id, stableText(asRecord(receipt.audience).listId, null)))
  );
  if (!receiptId && !campaignId && !audienceId) return null;
  const rawStatus = stableText(
    receipt.campaignStatus,
    stableText(asRecord(receipt.campaign).status, stableText(receipt.status, 'unknown'))
  ).toLowerCase();
  const campaignStatus = MAILCHIMP_CAMPAIGN_STATUSES.includes(rawStatus) ? rawStatus : 'unknown';
  const syncedAt = normalizeIsoTimestamp(receipt.syncedAt || receipt.receivedAt || receipt.updatedAt) || now;
  const revision = Math.max(0, toFiniteNumber(receipt.revision, toFiniteNumber(receipt.providerRevision, 0)));
  return {
    kind: stableText(receipt.kind, 'claim-browser.mailchimp-sync-receipt.v1'),
    receiptId: receiptId || `mailchimp-sync:${campaignId || 'campaign'}:${audienceId || 'audience'}:${syncedAt}`,
    providerId: stableText(receipt.providerId, 'mailchimp'),
    campaignId,
    audienceId,
    campaignStatus,
    revision,
    cursor: stableText(receipt.cursor, stableText(receipt.syncCursor, null)),
    externalStateId: stableText(receipt.externalStateId, stableText(receipt.stateId, null)),
    handoffState: stableText(receipt.handoffState, stableText(receipt.externalStateStatus, null)),
    proofRefs: normalizeProofRefs(receipt.proofRefs || receipt.providerProofRefs),
    syncedAt
  };
}

function normalizeMailchimpProviderSyncReceipts(contract, now) {
  const rawReceipts = [
    ...(Array.isArray(contract.mailchimpSyncReceipts) ? contract.mailchimpSyncReceipts : []),
    ...(Array.isArray(asRecord(contract.mailchimp).syncReceipts) ? asRecord(contract.mailchimp).syncReceipts : []),
    ...(Array.isArray(contract.marketingSyncReceipts) ? contract.marketingSyncReceipts : [])
  ];
  const latestByKey = new Map();
  for (const rawReceipt of rawReceipts) {
    const receipt = normalizeMailchimpProviderSyncReceipt(rawReceipt, now);
    if (!receipt) continue;
    const key = `${receipt.campaignId || '*'}:${receipt.audienceId || '*'}:${receipt.receiptId}`;
    const current = latestByKey.get(key);
    if (!current || receipt.syncedAt.localeCompare(current.syncedAt) >= 0) {
      latestByKey.set(key, receipt);
    }
  }
  return [...latestByKey.values()]
    .sort((left, right) => left.syncedAt.localeCompare(right.syncedAt))
    .slice(-MAILCHIMP_SYNC_RECEIPT_LIMIT);
}

function mailchimpReceiptMatchesClaim(receipt, claim) {
  if (!claim || !claim.mailchimp || !claim.mailchimp.enabled) return false;
  const campaignMatches = !claim.mailchimp.campaignId || receipt.campaignId === claim.mailchimp.campaignId;
  const audienceMatches = !claim.mailchimp.audienceId || receipt.audienceId === claim.mailchimp.audienceId;
  return campaignMatches && audienceMatches;
}

function buildClaimMailchimpProviderReadiness(claim, mailchimpSyncReceipts, providerExternallyWritable, now) {
  const gate = buildMailchimpLifecycleGate(claim, null);
  if (!claim || !claim.mailchimp.enabled) {
    return null;
  }
  const matchingReceipts = mailchimpSyncReceipts.filter((receipt) => mailchimpReceiptMatchesClaim(receipt, claim));
  const latestReceipt = matchingReceipts.at(-1) || null;
  const receiptCampaignStatus = latestReceipt ? latestReceipt.campaignStatus : claim.mailchimp.campaignStatus;
  const terminalReceipt = ['sent', 'archived'].includes(receiptCampaignStatus);
  const receiptCompatible = Boolean(latestReceipt)
    && (!claim.mailchimp.campaignId || latestReceipt.campaignId === claim.mailchimp.campaignId)
    && (!claim.mailchimp.audienceId || latestReceipt.audienceId === claim.mailchimp.audienceId)
    && !terminalReceipt;
  const ready = gate.ready && receiptCompatible && providerExternallyWritable;
  const reasonCodes = [
    ...gate.reasonCodes.filter((code) => code !== 'mailchimp-lifecycle-ready'),
    ...(latestReceipt ? [] : ['mailchimp-sync-receipt-missing']),
    ...(receiptCompatible ? [] : ['mailchimp-sync-receipt-incompatible']),
    ...(terminalReceipt ? ['mailchimp-campaign-terminal'] : []),
    ...(providerExternallyWritable ? [] : ['provider-command-write-unavailable']),
    ...(ready ? ['mailchimp-provider-handoff-ready'] : [])
  ];
  return {
    contract: 'claim-browser.mailchimp-provider-readiness.v1',
    claimId: claim.id,
    ready,
    state: ready
      ? 'ready'
      : terminalReceipt || !providerExternallyWritable
        ? 'blocked'
        : 'awaiting-sync',
    campaignId: claim.mailchimp.campaignId,
    audienceId: claim.mailchimp.audienceId,
    campaignStatus: receiptCampaignStatus,
    latestReceipt,
    receiptCount: matchingReceipts.length,
    reasonCodes,
    nextProviderAction: ready
      ? 'publish-mailchimp-claim-command'
      : !latestReceipt
        ? 'refresh-mailchimp-sync-receipt'
        : terminalReceipt
          ? 'duplicate-or-reopen-mailchimp-campaign'
          : !providerExternallyWritable
            ? 'repair-provider-command-contract'
            : gate.nextProviderAction,
    evaluatedAt: now
  };
}

function buildMailchimpPublishBarrier(claim, readiness, providerService, now) {
  if (!claim || !claim.mailchimp.enabled) return null;
  const reasonCodes = [
    ...(readiness ? readiness.reasonCodes : ['mailchimp-readiness-unavailable']),
    ...(!providerService.scopeMatched ? ['provider-scope-mismatch'] : []),
    ...(providerService.missingRequiredCapabilities.length ? ['provider-capability-missing'] : []),
    ...(providerService.externallyWritable ? [] : ['provider-command-write-unavailable'])
  ];
  const blockingCodes = reasonCodes.filter((code) => ![
    'mailchimp-provider-handoff-ready',
    'mailchimp-lifecycle-ready'
  ].includes(code));
  const terminalCampaign = ['sent', 'archived'].includes(claim.mailchimp.campaignStatus)
    || ['sent', 'archived'].includes(readiness?.campaignStatus);
  const providerSyncBlocked = blockingCodes.some((code) => [
    'mailchimp-sync-receipt-missing',
    'mailchimp-sync-receipt-incompatible',
    'mailchimp-campaign-terminal',
    'provider-command-write-unavailable',
    'provider-scope-mismatch',
    'provider-capability-missing'
  ].includes(code));
  const ready = Boolean(readiness && readiness.ready && blockingCodes.length === 0);
  const nextProviderAction = ready
    ? 'publish-mailchimp-claim-command'
    : terminalCampaign
      ? 'duplicate-or-reopen-mailchimp-campaign'
      : blockingCodes.includes('mailchimp-sync-receipt-missing') ||
          blockingCodes.includes('mailchimp-sync-receipt-incompatible')
        ? 'refresh-mailchimp-sync-receipt'
        : blockingCodes.includes('provider-command-write-unavailable')
          ? 'repair-provider-command-contract'
          : readiness?.nextProviderAction || 'repair-mailchimp-provider-readiness';
  const operatorCommand = ready
    ? `accept --claim=${claim.id} --mailchimp-campaign=${claim.mailchimp.campaignId}`
    : nextProviderAction === 'refresh-mailchimp-sync-receipt'
      ? `status --claim=${claim.id} --mailchimp-sync --retry`
      : nextProviderAction === 'duplicate-or-reopen-mailchimp-campaign'
        ? `reopen --claim=${claim.id} --mailchimp-campaign-draft`
        : nextProviderAction === 'repair-provider-command-contract'
          ? `status --claim=${claim.id} --provider-contract`
          : readiness?.nextProviderAction === 'select-mailchimp-campaign'
            ? `update-settings --claim=${claim.id} --mailchimp-campaign <campaign-id>`
            : readiness?.nextProviderAction === 'select-mailchimp-audience'
              ? `update-settings --claim=${claim.id} --mailchimp-audience <audience-id>`
              : `status --claim=${claim.id} --mailchimp`;

  return {
    contract: 'claim-browser.mailchimp-publish-barrier.v1',
    claimId: claim.id,
    ready,
    state: ready
      ? 'clear'
      : terminalCampaign || providerSyncBlocked
        ? 'blocked'
        : 'waiting',
    campaignId: claim.mailchimp.campaignId,
    audienceId: claim.mailchimp.audienceId,
    campaignStatus: readiness?.campaignStatus || claim.mailchimp.campaignStatus,
    latestReceiptId: readiness?.latestReceipt?.receiptId || null,
    latestReceiptAt: readiness?.latestReceipt?.syncedAt || null,
    providerId: providerService.providerId,
    serviceId: providerService.serviceId,
    syncCursor: providerService.syncMetadata.cursor,
    reasonCodes: [...new Set(reasonCodes)],
    blockingCodes: [...new Set(blockingCodes)],
    nextProviderAction,
    operatorCommand,
    publishRoute: `claim-browser://${claim.tenantId}/${claim.workspaceId}/claims/${claim.id}/mailchimp/publish`,
    retryable: !ready && !terminalCampaign && (
      nextProviderAction === 'refresh-mailchimp-sync-receipt' ||
      nextProviderAction === 'repair-provider-command-contract'
    ),
    retryAfterMs: providerService.syncMetadata.nextSyncAt
      ? millisecondsUntil(now, providerService.syncMetadata.nextSyncAt)
      : null,
    evaluatedAt: now
  };
}

function normalizeProviderServiceContract(input, state, now) {
  const persisted = asRecord(input.persistedState);
  const persistedContract = asRecord(persisted.providerServiceContract);
  const requestedContract = {
    ...asRecord(input.providerServiceContract),
    ...asRecord(input.hostedKernelProvider)
  };
  const contract = { ...persistedContract, ...requestedContract };
  const tenantId = stableText(contract.tenantId, state.tenantId);
  const workspaceId = stableText(contract.workspaceId, state.workspaceId);
  const scopeMatched = tenantId === state.tenantId && workspaceId === state.workspaceId;
  const supportedCapabilities = uniqueKnownProviderCapabilities(
    PROVIDER_REQUIRED_CAPABILITIES,
    contract.supportedCapabilities,
    contract.capabilities
  );
  const disabledCapabilities = uniqueKnownProviderCapabilities(contract.disabledCapabilities);
  const negotiatedCapabilities = supportedCapabilities.filter((capability) => !disabledCapabilities.includes(capability));
  const missingRequiredCapabilities = PROVIDER_REQUIRED_CAPABILITIES.filter((capability) => !negotiatedCapabilities.includes(capability));
  const deliveryReceipts = normalizeProviderDeliveryReceipts(contract, now);
  const mailchimpSyncReceipts = normalizeMailchimpProviderSyncReceipts(contract, now);
  const receiptByCommandId = new Map(deliveryReceipts.map((receipt) => [receipt.commandId, receipt]));
  const endpoint = stableText(contract.endpoint, stableText(contract.url, 'hosted-kernel://claim-browser/commands'));
  const protocol = stableText(contract.protocol, 'hosted-kernel-command-bus');
  const externallyWritable = scopeMatched && state.operationalHealth.commandWritesEnabled && missingRequiredCapabilities.length === 0;
  const outbox = state.hostedKernelOutbox.map((envelope) => {
    const providerReceipt = receiptByCommandId.get(envelope.commandId) || null;
    const claim = state.claims.find((candidate) => candidate.id === envelope.claimId) || null;
    const mailchimpReadiness = buildClaimMailchimpProviderReadiness(claim, mailchimpSyncReceipts, externallyWritable, now);
    const providerHandoffState = providerReceiptHandoffState(providerReceipt);
    const acknowledged = providerHandoffState === 'acknowledged' || envelope.deliveryState === 'acked';
    const failed = providerHandoffState === 'failed' || envelope.deliveryState === 'failed';
    const handoffState = acknowledged
      ? 'acknowledged'
      : failed
        ? 'failed'
        : externallyWritable
          ? 'awaiting-provider'
          : 'blocked';
    return {
      commandId: envelope.commandId,
      claimId: envelope.claimId,
      action: envelope.action,
      emittedAt: envelope.emittedAt,
      deliveryState: envelope.deliveryState,
      effectiveDeliveryState: acknowledged ? 'acked' : failed ? 'failed' : envelope.deliveryState,
      handoffState,
      endpoint,
      route: envelope.route,
      idempotencyKey: envelope.idempotencyKey,
      correlationId: envelope.correlationId,
      requiredCapabilities: PROVIDER_REQUIRED_CAPABILITIES,
      missingCapabilities: missingRequiredCapabilities,
      providerCommandId: providerReceipt ? providerReceipt.providerCommandId : null,
      providerRevision: providerReceipt ? providerReceipt.providerRevision : null,
      providerProofRefs: providerReceipt ? providerReceipt.proofRefs : [],
      providerAcknowledgedAt: providerReceipt ? providerReceipt.acknowledgedAt : null,
      providerFailedAt: providerReceipt ? providerReceipt.failedAt : null,
      providerErrorCode: providerReceipt ? providerReceipt.errorCode : null,
      providerErrorMessage: providerReceipt ? providerReceipt.errorMessage : null,
      providerRetryable: providerReceipt ? providerReceipt.retryable : false,
      providerStatusCode: providerReceipt ? providerReceipt.statusCode : null,
      mailchimp: mailchimpReadiness,
      blockedReason: handoffState === 'blocked'
        ? !scopeMatched
          ? 'provider-scope-mismatch'
          : !state.operationalHealth.commandWritesEnabled
            ? healthDenialReason(state.operationalHealth)
            : 'provider-capability-missing'
        : null
    };
  });
  const pendingHandoffs = outbox.filter((entry) => entry.handoffState === 'awaiting-provider');
  const blockedHandoffs = outbox.filter((entry) => entry.handoffState === 'blocked');
  const failedHandoffs = outbox.filter((entry) => entry.handoffState === 'failed');
  const acknowledgedHandoffs = outbox.filter((entry) => entry.handoffState === 'acknowledged');
  const orphanDeliveryReceipts = deliveryReceipts.filter((receipt) => !state.hostedKernelOutbox.some((envelope) => envelope.commandId === receipt.commandId));
  const mailchimpClaims = state.claims.filter((claim) => claim.mailchimp && claim.mailchimp.enabled);
  const mailchimpReadinessByClaim = mailchimpClaims.map((claim) => (
    buildClaimMailchimpProviderReadiness(claim, mailchimpSyncReceipts, externallyWritable, now)
  )).filter(Boolean);
  const mailchimpBlockedClaims = mailchimpReadinessByClaim.filter((entry) => entry.state === 'blocked');
  const mailchimpAwaitingSyncClaims = mailchimpReadinessByClaim.filter((entry) => entry.state === 'awaiting-sync');
  const lastSyncedAt = normalizeIsoTimestamp(contract.lastSyncedAt);
  const requestedSyncState = stableText(contract.syncState, null);
  const syncState = blockedHandoffs.length || !scopeMatched || missingRequiredCapabilities.length
    ? 'blocked'
    : failedHandoffs.length || state.operationalHealth.degraded
      ? 'degraded'
      : pendingHandoffs.length
        ? 'pending'
        : PROVIDER_SYNC_STATES.has(requestedSyncState)
          ? requestedSyncState
          : 'idle';
  const nextSyncAt = syncState === 'pending' || syncState === 'degraded'
    ? addMillisecondsIso(now, state.operationalHealth.retryPolicy.retryAfterMs)
    : null;
  const latestReceipt = deliveryReceipts.at(-1) || null;
  const syncCursor = stableText(contract.cursor, stableText(contract.syncCursor, latestReceipt ? latestReceipt.cursor : null));
  const providerServiceView = {
    providerId: stableText(contract.providerId, 'hosted-kernel'),
    serviceId: stableText(contract.serviceId, 'hosted-kernel.claim-browser.commands'),
    scopeMatched,
    externallyWritable,
    missingRequiredCapabilities,
    syncMetadata: {
      cursor: syncCursor,
      nextSyncAt
    }
  };
  const mailchimpPublishBarriers = mailchimpClaims
    .map((claim) => buildMailchimpPublishBarrier(
      claim,
      mailchimpReadinessByClaim.find((entry) => entry.claimId === claim.id) || null,
      providerServiceView,
      now
    ))
    .filter(Boolean);
  return {
    providerId: stableText(contract.providerId, 'hosted-kernel'),
    serviceId: stableText(contract.serviceId, 'hosted-kernel.claim-browser.commands'),
    contractVersion: stableText(contract.contractVersion, 'claim-browser-provider-service.v1'),
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    sourceTenantId: tenantId,
    sourceWorkspaceId: workspaceId,
    scopeMatched,
    endpoint,
    protocol,
    supportedCapabilities,
    disabledCapabilities,
    negotiatedCapabilities,
    missingRequiredCapabilities,
    externallyWritable,
    syncMetadata: {
      state: syncState,
      cursor: syncCursor,
      lastSyncedAt,
      nextSyncAt,
      pendingCount: pendingHandoffs.length,
      blockedCount: blockedHandoffs.length,
      failedCount: failedHandoffs.length,
      acknowledgedCount: acknowledgedHandoffs.length,
      outboxCount: outbox.length,
      deliveryReceiptCount: deliveryReceipts.length,
      orphanDeliveryReceiptCount: orphanDeliveryReceipts.length,
      latestProviderReceiptAt: latestReceipt ? latestReceipt.receivedAt : null,
      mailchimpSyncReceiptCount: mailchimpSyncReceipts.length,
      mailchimpReadyCount: mailchimpReadinessByClaim.filter((entry) => entry.ready).length,
      mailchimpBlockedCount: mailchimpBlockedClaims.length,
      mailchimpAwaitingSyncCount: mailchimpAwaitingSyncClaims.length,
      mailchimpPublishBlockedCount: mailchimpPublishBarriers.filter((barrier) => barrier.state === 'blocked').length,
      mailchimpPublishWaitingCount: mailchimpPublishBarriers.filter((barrier) => barrier.state === 'waiting').length
    },
    deliveryReceipts,
    orphanDeliveryReceipts,
    mailchimpSync: {
      contract: 'claim-browser.mailchimp-provider-sync.v1',
      state: mailchimpBlockedClaims.length
        ? 'blocked'
        : mailchimpAwaitingSyncClaims.length
          ? 'awaiting-sync'
          : mailchimpReadinessByClaim.length
            ? 'ready'
            : 'not-configured',
      receiptLimit: MAILCHIMP_SYNC_RECEIPT_LIMIT,
      receipts: mailchimpSyncReceipts,
      readinessByClaim: mailchimpReadinessByClaim,
      publishBarriers: mailchimpPublishBarriers,
      blockedClaimIds: mailchimpBlockedClaims.map((entry) => entry.claimId),
      awaitingSyncClaimIds: mailchimpAwaitingSyncClaims.map((entry) => entry.claimId),
      publishBlockedClaimIds: mailchimpPublishBarriers
        .filter((barrier) => barrier.state === 'blocked')
        .map((barrier) => barrier.claimId),
      nextProviderAction: mailchimpBlockedClaims[0]?.nextProviderAction
        || mailchimpAwaitingSyncClaims[0]?.nextProviderAction
        || mailchimpPublishBarriers.find((barrier) => !barrier.ready)?.nextProviderAction
        || (mailchimpReadinessByClaim.length ? 'publish-mailchimp-claim-command' : 'ignore-mailchimp-provider-sync')
    },
    externalHandoff: outbox,
    warnings: [
      ...(scopeMatched ? [] : ['provider service contract scope does not match active workspace']),
      ...missingRequiredCapabilities.map((capability) => `provider missing required capability ${capability}`),
      ...orphanDeliveryReceipts.map((receipt) => `provider delivery receipt for unknown command ${receipt.commandId}`),
      ...mailchimpBlockedClaims.map((entry) => `mailchimp provider handoff blocked for claim ${entry.claimId}: ${entry.reasonCodes.join(',')}`),
      ...mailchimpAwaitingSyncClaims.map((entry) => `mailchimp provider sync receipt missing or stale for claim ${entry.claimId}`),
      ...mailchimpPublishBarriers
        .filter((barrier) => !barrier.ready)
        .map((barrier) => `mailchimp publish barrier for claim ${barrier.claimId}: ${barrier.blockingCodes.join(',')}`)
    ]
  };
}

function uniqueKnownStringList(...lists) {
  return [...new Set(lists.flatMap((list) => normalizeStringList(list)))];
}

function recordCommandResult(state, commandId, fingerprint, principal, now, accepted, reason, appliedRevision = null, boundaryEvent = null, boundaryDecision = null) {
  const receipt = {
    commandId,
    ...fingerprint,
    accepted,
    reason,
    appliedRevision,
    recordedAt: now,
    principalId: principal.id,
    boundaryDecision
  };
  const stateWithReceipt = appendCommandReceipt(state, receipt);
  const stateWithAudit = accepted
    ? stateWithReceipt
    : appendCommandAudit(stateWithReceipt, {
        commandId,
        claimId: fingerprint.claimId,
        action: fingerprint.action,
        accepted: false,
        reason,
        principalId: principal.id,
        recordedAt: now,
        beforeStatus: null,
        afterStatus: null,
        beforeRevision: null,
        afterRevision: null,
        attachedProofRefs: [],
        operatorNote: null,
        boundaryDecision
      });
  return {
    state: boundaryEvent
      ? { ...stateWithAudit, boundaryEvents: [...stateWithAudit.boundaryEvents, boundaryEvent] }
      : stateWithAudit,
    accepted,
    idempotent: false,
    reason,
    receipt,
    boundaryDecision
  };
}

function normalizeClaim(rawClaim, index, now, scope) {
  const claim = asRecord(rawClaim);
  const status = KNOWN_STATUS.has(claim.status) ? claim.status : 'new';
  const tenantId = stableText(claim.tenantId, scope.tenantId);
  const workspaceId = stableText(claim.workspaceId, scope.workspaceId);
  const id = stableText(claim.id, `claim:${index + 1}`);
  const permissionGrants = normalizeClaimPermissionGrants(claim, id, scope, now);
  return {
    id,
    tenantId,
    workspaceId,
    title: stableText(claim.title, stableText(claim.summary, `Claim ${index + 1}`)),
    status,
    restartSafeStatus: stableText(claim.restartSafeStatus, RESTART_SAFE_STATUS[status]),
    revision: Math.max(0, toFiniteNumber(claim.revision, 0)),
    updatedAt: stableText(claim.updatedAt, now),
    proofRefs: normalizeProofRefs(claim.proofRefs),
    assignee: stableText(claim.assignee, null),
    requestedBy: stableText(claim.requestedBy, null),
    workflowRef: stableText(claim.workflowRef, stableText(claim.workflowId, null)),
    clientTraceId: stableText(claim.clientTraceId, null),
    mailchimp: normalizeClaimMailchimpContext(claim),
    permissionGrants: permissionGrants.grants,
    permissionWarnings: permissionGrants.warnings,
    permissionBoundaryEvents: permissionGrants.boundaryEvents
  };
}

function normalizeClaimMailchimpContext(claim) {
  const metadata = firstRecord(claim.mailchimp, claim.marketing, claim.providerContext, claim.integration);
  const campaign = firstRecord(metadata.campaign, claim.campaign);
  const audience = firstRecord(metadata.audience, claim.audience);
  const rawStatus = stableText(
    metadata.campaignStatus,
    stableText(campaign.status, stableText(claim.campaignStatus, 'unknown'))
  ).toLowerCase();
  const campaignStatus = MAILCHIMP_CAMPAIGN_STATUSES.includes(rawStatus) ? rawStatus : 'unknown';
  const campaignId = stableText(
    metadata.campaignId,
    stableText(campaign.campaignId, stableText(campaign.id, stableText(claim.campaignId, null)))
  );
  const audienceId = stableText(
    metadata.audienceId,
    stableText(metadata.listId, stableText(audience.audienceId, stableText(audience.listId, stableText(audience.id, null))))
  );
  const segmentIds = [...new Set([
    ...normalizeStringList(metadata.segmentIds),
    ...normalizeStringList(metadata.segments),
    ...normalizeStringList(campaign.segmentIds),
    ...normalizeStringList(audience.segmentIds)
  ])];
  const enabled = Boolean(campaignId || audienceId || segmentIds.length || stableText(metadata.provider, null) === 'mailchimp');

  return {
    contract: 'claim-browser.mailchimp-claim-context.v1',
    enabled,
    campaignId,
    audienceId,
    campaignStatus,
    templateId: stableText(metadata.templateId, stableText(campaign.templateId, null)),
    previewUrl: stableText(metadata.previewUrl, stableText(campaign.previewUrl, stableText(campaign.archiveUrl, null))),
    segmentIds,
    mergeTags: [...new Set([
      ...normalizeStringList(metadata.mergeTags),
      ...normalizeStringList(campaign.mergeTags),
      ...normalizeStringList(audience.mergeTags)
    ])],
    exportLabels: [
      campaignId ? `campaign:${campaignId}` : null,
      audienceId ? `audience:${audienceId}` : null,
      ...segmentIds.map((segmentId) => `segment:${segmentId}`)
    ].filter(Boolean),
    readyForExport: Boolean(campaignId && audienceId)
  };
}

function buildMailchimpLifecycleGate(claim, operationalHealth = null) {
  const mailchimp = claim && claim.mailchimp ? claim.mailchimp : null;
  const lifecycle = operationalHealth ? operationalHealth.lifecycle : null;
  const healthReason = healthDenialReason(operationalHealth);
  const enabled = Boolean(mailchimp && mailchimp.enabled);
  const missingCampaign = enabled && !mailchimp.campaignId;
  const missingAudience = enabled && !mailchimp.audienceId;
  const terminalCampaign = enabled && ['sent', 'archived'].includes(mailchimp.campaignStatus);
  const lifecycleBlocked = enabled && Boolean(healthReason);
  const ready = enabled
    && mailchimp.readyForExport
    && !terminalCampaign
    && !lifecycleBlocked;
  const reasonCodes = [
    ...(enabled ? [] : ['mailchimp-not-configured']),
    ...(missingCampaign ? ['mailchimp-campaign-missing'] : []),
    ...(missingAudience ? ['mailchimp-audience-missing'] : []),
    ...(terminalCampaign ? ['mailchimp-campaign-terminal'] : []),
    ...(lifecycleBlocked ? [healthReason] : []),
    ...(ready ? ['mailchimp-lifecycle-ready'] : [])
  ];
  const nextCommand = ready
    ? `accept --claim=${claim.id} --mailchimp-campaign=${mailchimp.campaignId}`
    : !enabled
      ? null
      : missingCampaign
        ? `update-settings --claim=${claim.id} --mailchimp-campaign <campaign-id>`
        : missingAudience
          ? `update-settings --claim=${claim.id} --mailchimp-audience <audience-id>`
          : terminalCampaign
            ? `reopen --claim=${claim.id} --mailchimp-campaign-draft`
            : lifecycle && lifecycle.schedule.nextEnableAt
              ? `status --until=${lifecycle.schedule.nextEnableAt}`
              : 'enable';

  return {
    contract: 'claim-browser.mailchimp-lifecycle-gate.v1',
    enabled,
    ready,
    state: !enabled
      ? 'not-configured'
      : ready
        ? 'ready'
        : terminalCampaign || lifecycleBlocked
          ? 'blocked'
          : 'needs-context',
    claimId: claim ? claim.id : null,
    campaignId: enabled ? mailchimp.campaignId : null,
    audienceId: enabled ? mailchimp.audienceId : null,
    campaignStatus: enabled ? mailchimp.campaignStatus : null,
    readyForExport: enabled ? mailchimp.readyForExport : false,
    lifecycleMode: lifecycle ? lifecycle.effectiveMode : null,
    scheduleState: lifecycle ? lifecycle.scheduleState : null,
    commandWritesAllowed: operationalHealth ? operationalHealth.commandWritesEnabled : false,
    nextEnableAt: lifecycle ? lifecycle.schedule.nextEnableAt : null,
    reasonCodes,
    nextProviderAction: ready
      ? 'export-mailchimp-claim'
      : !enabled
        ? 'ignore-mailchimp-gate'
        : missingCampaign
          ? 'select-mailchimp-campaign'
          : missingAudience
            ? 'select-mailchimp-audience'
            : terminalCampaign
              ? 'duplicate-or-reopen-mailchimp-campaign'
              : 'wait-for-claim-browser-lifecycle',
    nextOperatorCommand: nextCommand,
    exportLabels: enabled ? mailchimp.exportLabels : []
  };
}

function normalizeClientRequest(input, state) {
  const request = asRecord(input.clientRequest);
  const filters = asRecord(request.filters);
  const requestedMode = stableText(request.viewMode, stableText(input.viewMode, 'queue'));
  const requestedSort = stableText(request.sortBy, 'updatedAt');
  const selectedClaimId = stableText(request.selectedClaimId, stableText(input.selectedClaimId, null));
  const filterStatuses = normalizeStringList(filters.statuses).filter((status) => KNOWN_STATUS.has(status));
  const invalidStatuses = normalizeStringList(filters.statuses).filter((status) => !KNOWN_STATUS.has(status));
  const includeTerminal = filters.includeTerminal === true || requestedMode === 'history';
  const pageSize = Math.min(100, Math.max(1, toFiniteNumber(request.pageSize, 25)));
  const cursor = stableText(request.cursor, stableText(input.cursor, state.cursor));
  return {
    mode: CLIENT_VIEW_MODES.has(requestedMode) ? requestedMode : 'queue',
    selectedClaimId,
    cursor,
    pageSize,
    sortBy: CLIENT_SORT_KEYS.has(requestedSort) ? requestedSort : 'updatedAt',
    filters: {
      statuses: filterStatuses,
      includeTerminal,
      assignee: stableText(filters.assignee, null),
      text: stableText(filters.text, null)
    },
    validationWarnings: [
      ...(CLIENT_VIEW_MODES.has(requestedMode) ? [] : [`unsupported viewMode ${requestedMode}`]),
      ...(CLIENT_SORT_KEYS.has(requestedSort) ? [] : [`unsupported sortBy ${requestedSort}`]),
      ...invalidStatuses.map((status) => `unsupported status filter ${status}`)
    ],
    correlationId: stableText(request.correlationId, stableText(input.correlationId, state.sessionId))
  };
}

function compareClaimRows(left, right, sortBy) {
  if (sortBy === 'status') return left.status.localeCompare(right.status) || right.updatedAt.localeCompare(left.updatedAt);
  if (sortBy === 'title') return left.title.localeCompare(right.title) || right.updatedAt.localeCompare(left.updatedAt);
  if (sortBy === 'revision') return right.revision - left.revision || right.updatedAt.localeCompare(left.updatedAt);
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function claimMatchesClientRequest(claim, clientRequest) {
  if (!clientRequest.filters.includeTerminal && TERMINAL_STATUS.has(claim.status)) return false;
  if (clientRequest.filters.statuses.length && !clientRequest.filters.statuses.includes(claim.status)) return false;
  if (clientRequest.filters.assignee && claim.assignee !== clientRequest.filters.assignee) return false;
  if (clientRequest.filters.text) {
    const needle = clientRequest.filters.text.toLowerCase();
    return claim.title.toLowerCase().includes(needle) || claim.id.toLowerCase().includes(needle);
  }
  return true;
}

function healthDenialReason(operationalHealth) {
  if (!operationalHealth || operationalHealth.commandWritesEnabled) return null;
  const primaryError = operationalHealth.actionableErrors[0];
  return primaryError ? primaryError.code : 'claim-browser-command-writes-unavailable';
}

function nextClaimActions(claim, principal, policy = null, operationalHealth = null) {
  const allowed = ROLE_ACTIONS[principal.role] || [];
  if (!claim) return [];
  if (healthDenialReason(operationalHealth)) return [];
  if (policy && claimPolicyDenialReason(claim, policy)) return [];
  const policyAllowed = policy ? policy.allowedActions : COMMAND_ACTIONS;
  const applyBoundaries = (actions) => actions
    .filter((action) => policyAllowed.includes(action))
    .filter((action) => claimActionAllowedByGrants(claim, principal, action));
  if (TERMINAL_STATUS.has(claim.status)) return applyBoundaries(allowed.includes('reopen') ? ['reopen'] : []);
  if (claim.status === 'blocked') return applyBoundaries(allowed.filter((action) => ['reopen', 'reject'].includes(action)));
  if (claim.status === 'queued' || claim.status === 'running') return applyBoundaries(allowed.filter((action) => ['block', 'accept', 'reject'].includes(action)));
  return applyBoundaries(allowed.filter((action) => ['queue', 'block'].includes(action)));
}

function nextActionBlockedReason(claim, principal, policy, operationalHealth) {
  if (!claim) return 'claim-not-selected';
  const healthReason = healthDenialReason(operationalHealth);
  if (healthReason) return healthReason;
  const policyReason = policy ? claimPolicyDenialReason(claim, policy) : null;
  if (policyReason) return policyReason;
  if (!principalHasScope(principal, claim.tenantId, claim.workspaceId)) return 'principal-out-of-scope';
  if (!ROLE_ACTIONS[principal.role] || ROLE_ACTIONS[principal.role].length === 0) return 'role-read-only';
  const roleActions = ROLE_ACTIONS[principal.role] || [];
  const candidateActions = COMMAND_ACTIONS.filter((action) => roleActions.includes(action));
  const grantAllowsAnyCandidate = candidateActions.some((action) => claimActionAllowedByGrants(claim, principal, action));
  if (!grantAllowsAnyCandidate) return claimPermissionDenialReason(claim, principal);
  if (TERMINAL_STATUS.has(claim.status)) return 'terminal-claim-reopen-only';
  return 'no-valid-transition';
}

function buildNextActionState(claim, principal, policy, operationalHealth) {
  const availableActions = nextClaimActions(claim, principal, policy, operationalHealth);
  const lifecycle = operationalHealth ? operationalHealth.lifecycle : null;
  const mailchimpGate = buildMailchimpLifecycleGate(claim, operationalHealth);
  return {
    canMutate: availableActions.length > 0,
    availableActions,
    blockedReason: availableActions.length ? null : nextActionBlockedReason(claim, principal, policy, operationalHealth),
    mailchimpLifecycleGate: mailchimpGate.enabled ? mailchimpGate : null,
    mailchimpExportReady: mailchimpGate.enabled ? mailchimpGate.ready : null,
    lifecycleMode: lifecycle ? lifecycle.effectiveMode : null,
    scheduleState: lifecycle ? lifecycle.scheduleState : null,
    nextEnableAt: lifecycle ? lifecycle.schedule.nextEnableAt : null,
    nextDisableAt: lifecycle ? lifecycle.schedule.nextDisableAt : null,
    retryAfterMs: operationalHealth ? operationalHealth.retryPolicy.retryAfterMs : null,
    nextRetryAt: operationalHealth ? operationalHealth.retryPolicy.nextRetryAt : null,
    escalationRoute: operationalHealth ? operationalHealth.escalationRoute : null
  };
}

function previewTransitionStatus(claim, action) {
  if (!claim) return null;
  if (action === 'queue' || action === 'reopen') return 'queued';
  if (action === 'block') return 'blocked';
  if (action === 'accept') return 'accepted';
  if (action === 'reject') return 'rejected';
  return claim.status;
}

function previewFinding(severity, code, message, route = null, details = {}) {
  return {
    severity: PREVIEW_VALIDATION_SEVERITIES.includes(severity) ? severity : 'info',
    code,
    message,
    route,
    details
  };
}

function summarizePreviewFindings(findings) {
  const counts = countBy(findings, (finding) => finding.severity);
  const blocking = counts.blocking || 0;
  const warning = counts.warning || 0;
  const info = counts.info || 0;
  return {
    ready: blocking === 0,
    severity: blocking ? 'blocking' : warning ? 'warning' : 'info',
    counts: { blocking, warning, info },
    findings
  };
}

function buildPreviewValidationSummary(claim, action, principal, policy, operationalHealth, nextActionState, now) {
  const route = claim
    ? `claim-browser://${claim.tenantId}/${claim.workspaceId}/claims/${claim.id}`
    : `claim-browser://${policy ? policy.tenantId : 'tenant:unknown'}/${policy ? policy.workspaceId : 'workspace:unknown'}/claims`;
  const findings = [];
  if (!claim) {
    findings.push(previewFinding('blocking', 'claim-not-selected', 'Select a claim before previewing a command.', route));
    return summarizePreviewFindings(findings);
  }
  if (!principalHasScope(principal, claim.tenantId, claim.workspaceId)) {
    findings.push(previewFinding('blocking', 'principal-out-of-scope', 'The operator principal is outside the claim scope.', route, {
      principalId: principal.id,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId
    }));
  }
  const healthReason = healthDenialReason(operationalHealth);
  if (healthReason) {
    findings.push(previewFinding('blocking', healthReason, 'Hosted-kernel command writes are not ready for this workspace.', route, {
      retryAfterMs: operationalHealth ? operationalHealth.retryPolicy.retryAfterMs : null,
      nextRetryAt: operationalHealth ? operationalHealth.retryPolicy.nextRetryAt : null
    }));
  }
  const policyReason = policy ? claimPolicyDenialReason(claim, policy) : null;
  if (policyReason) {
    findings.push(previewFinding('blocking', policyReason, 'Workspace policy blocks mutating this claim.', route, {
      escalationRoute: policy.escalationRoute
    }));
  }
  const permissionReason = claimPermissionDenialReason(claim, principal, action);
  if (permissionReason) {
    findings.push(previewFinding('blocking', permissionReason, 'Claim permission grants do not allow this action.', route, {
      grantCount: claim.permissionGrants.length,
      role: principal.role
    }));
  }
  if (TERMINAL_STATUS.has(claim.status) && action !== 'reopen') {
    findings.push(previewFinding('blocking', 'terminal-claim', 'Terminal claims can only be reopened before another terminal action.', route, {
      status: claim.status
    }));
  }
  if (policy && policy.requireTerminalEvidence && TERMINAL_COMMANDS.has(action) && claim.proofRefs.length === 0) {
    findings.push(previewFinding('warning', 'terminal-evidence-expected', 'This terminal action should include proof or inline evidence.', route, {
      acceptedEvidenceKinds: policy.terminalEvidenceKinds
    }));
  }
  const mailchimpGate = buildMailchimpLifecycleGate(claim, operationalHealth);
  if (mailchimpGate.enabled && action === 'accept' && !mailchimpGate.ready) {
    findings.push(previewFinding(
      mailchimpGate.state === 'needs-context' ? 'warning' : 'blocking',
      mailchimpGate.reasonCodes.find((code) => code !== 'mailchimp-not-configured') || 'mailchimp-lifecycle-not-ready',
      'Mailchimp campaign handoff is not ready for this claim.',
      route,
      {
        gate: mailchimpGate,
        nextProviderAction: mailchimpGate.nextProviderAction,
        nextOperatorCommand: mailchimpGate.nextOperatorCommand
      }
    ));
  }
  if (nextActionState && !nextActionState.availableActions.includes(action)) {
    findings.push(previewFinding('blocking', nextActionState.blockedReason || 'action-not-available', 'This action is not available from the current claim state.', route, {
      availableActions: nextActionState.availableActions,
      status: claim.status
    }));
  }
  findings.push(previewFinding('info', 'preview-generated', 'Preview reflects the current hosted-kernel claim browser state.', route, {
    generatedAt: now,
    expectedRevision: claim.revision
  }));
  return summarizePreviewFindings(findings);
}

function buildActionPreview(claim, action, principal, policy, operationalHealth, nextActionState, now) {
  const afterStatus = previewTransitionStatus(claim, action);
  const validationSummary = buildPreviewValidationSummary(claim, action, principal, policy, operationalHealth, nextActionState, now);
  const requiresProof = TERMINAL_COMMANDS.has(action);
  return {
    action,
    label: `${action} claim`,
    ready: validationSummary.ready,
    requiresProof,
    beforeStatus: claim ? claim.status : null,
    afterStatus,
    expectedRevision: claim ? claim.revision : null,
    nextRevision: claim && validationSummary.ready ? claim.revision + 1 : null,
    validationSummary,
    commandTemplate: claim
      ? {
          claimId: claim.id,
          action,
          tenantId: claim.tenantId,
          workspaceId: claim.workspaceId,
          expectedRevision: claim.revision,
          proofRefs: requiresProof ? [] : undefined,
          evidence: requiresProof ? [] : undefined,
          correlationId: claim.clientTraceId,
          route: `claim-browser://${claim.tenantId}/${claim.workspaceId}/claims/${claim.id}/commands`,
          idempotencyKeyHint: `claim-browser:${claim.tenantId}:${claim.workspaceId}:${claim.id}:${action}:${claim.revision}`
        }
      : null
  };
}

function buildClaimPreviewAcceptance(claim, principal, policy, operationalHealth, nextActionState, now) {
  const candidateActions = claim
    ? [...new Set([...nextActionState.availableActions, ...COMMAND_ACTIONS.filter((action) => ROLE_ACTIONS[principal.role].includes(action))])]
    : [];
  const actionPreviews = candidateActions.map((action) => buildActionPreview(
    claim,
    action,
    principal,
    policy,
    operationalHealth,
    nextActionState,
    now
  ));
  const readyPreviews = actionPreviews.filter((preview) => preview.ready);
  const suggested = readyPreviews[0] || actionPreviews[0] || null;
  return {
    kind: 'claim-browser-preview-acceptance.v1',
    generatedAt: now,
    claimId: claim ? claim.id : null,
    tenantId: claim ? claim.tenantId : policy.tenantId,
    workspaceId: claim ? claim.workspaceId : policy.workspaceId,
    status: claim ? claim.status : null,
    revision: claim ? claim.revision : null,
    ready: readyPreviews.length > 0,
    suggestedAction: suggested ? suggested.action : null,
    readiness: {
      commandWritesEnabled: operationalHealth ? operationalHealth.commandWritesEnabled : false,
      principalInScope: claim ? principalHasScope(principal, claim.tenantId, claim.workspaceId) : false,
      workspaceWritable: policy ? policy.scopeMatched && !policy.readOnly : false,
      hasAvailableAction: nextActionState.availableActions.length > 0,
      mailchimpLifecycleGate: claim ? buildMailchimpLifecycleGate(claim, operationalHealth) : null,
      blockedReason: readyPreviews.length ? null : nextActionState.blockedReason
    },
    validationSummary: summarizePreviewFindings(actionPreviews.flatMap((preview) => preview.validationSummary.findings)),
    actions: actionPreviews,
    explainableNextSteps: actionPreviews.map((preview) => ({
      action: preview.action,
      ready: preview.ready,
      blockedReason: preview.ready
        ? null
        : preview.validationSummary.findings.find((finding) => finding.severity === 'blocking')?.code || 'validation-blocked',
      afterStatus: preview.afterStatus,
      requiresProof: preview.requiresProof,
      route: preview.commandTemplate ? preview.commandTemplate.route : null
    })),
    route: claim
      ? `claim-browser://${claim.tenantId}/${claim.workspaceId}/claims/${claim.id}/preview`
      : `claim-browser://${policy.tenantId}/${policy.workspaceId}/claims/preview`
  };
}

function buildLifecycleControlState(state, principal, lifecycleCommandReceipt = null) {
  const canControl = principal.role === 'tenant-admin' && principalHasScope(principal, state.tenantId, state.workspaceId);
  const lifecycle = state.lifecycleSettings;
  return {
    canControl,
    availableControls: canControl ? LIFECYCLE_COMMAND_ACTIONS : [],
    blockedReason: canControl
      ? null
      : principal.role === 'tenant-admin'
        ? 'principal-out-of-scope'
        : 'tenant-admin-required',
    currentMode: lifecycle.effectiveMode,
    configuredMode: lifecycle.mode,
    scheduleState: lifecycle.scheduleState,
    commandWritesAllowed: lifecycle.commandWritesAllowed,
    denialReason: lifecycle.denialReason,
    nextEnableAt: lifecycle.schedule.nextEnableAt,
    nextDisableAt: lifecycle.schedule.nextDisableAt,
    nextReviewAt: lifecycle.nextReviewAt,
    validationWarnings: lifecycle.validationWarnings,
    lastCommandReceipt: lifecycleCommandReceipt,
    route: `claim-browser://${state.tenantId}/${state.workspaceId}/lifecycle`
  };
}

function buildClientRuntime(state, clientRequest, principal, now) {
  const allVisibleRows = state.claims
    .filter((claim) => claimMatchesClientRequest(claim, clientRequest))
    .sort((left, right) => compareClaimRows(left, right, clientRequest.sortBy));
  const cursorIndex = clientRequest.cursor
    ? allVisibleRows.findIndex((claim) => claim.id === clientRequest.cursor)
    : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageRows = allVisibleRows.slice(startIndex, startIndex + clientRequest.pageSize);
  const selectedClaim = state.claims.find((claim) => claim.id === clientRequest.selectedClaimId) || pageRows[0] || null;
  const selectedInView = selectedClaim ? pageRows.some((claim) => claim.id === selectedClaim.id) : false;
  const nextCursor = allVisibleRows.length > startIndex + pageRows.length ? pageRows.at(-1).id : null;
  const runtimeHealthDenialReason = healthDenialReason(state.operationalHealth);
  const selectionActionState = selectedClaim
    ? buildNextActionState(selectedClaim, principal, state.workspacePolicy, state.operationalHealth)
    : null;
  const selectionPreviewAcceptance = selectedClaim
    ? buildClaimPreviewAcceptance(
        selectedClaim,
        principal,
        state.workspacePolicy,
        state.operationalHealth,
        selectionActionState,
        now
      )
    : buildClaimPreviewAcceptance(
        null,
        principal,
        state.workspacePolicy,
        state.operationalHealth,
        { availableActions: [], blockedReason: 'claim-not-selected' },
        now
      );
  return {
    request: clientRequest,
    rows: pageRows.map((claim) => {
      const nextActionState = buildNextActionState(claim, principal, state.workspacePolicy, state.operationalHealth);
      return {
        policyDenialReason: claimPolicyDenialReason(claim, state.workspacePolicy),
        healthDenialReason: runtimeHealthDenialReason,
        id: claim.id,
        title: claim.title,
        status: claim.status,
        restartSafeStatus: claim.restartSafeStatus,
        revision: claim.revision,
        updatedAt: claim.updatedAt,
        assignee: claim.assignee,
        proofRefCount: claim.proofRefs.length,
        recoverySource: stableText(claim.recoverySource, null),
        hostedKernelDeliveryState: stableText(claim.hostedKernelDeliveryState, null),
        mailchimp: claim.mailchimp.enabled
          ? {
              campaignId: claim.mailchimp.campaignId,
              audienceId: claim.mailchimp.audienceId,
              campaignStatus: claim.mailchimp.campaignStatus,
              segmentCount: claim.mailchimp.segmentIds.length,
              readyForExport: claim.mailchimp.readyForExport,
              exportLabels: claim.mailchimp.exportLabels,
              lifecycleGate: nextActionState.mailchimpLifecycleGate
            }
          : null,
        permissionGrantCount: claim.permissionGrants.length,
        permissionDenialReason: claimPermissionDenialReason(claim, principal),
        workflowRef: claim.workflowRef,
        nextActions: nextActionState.availableActions,
        nextActionState
      };
    }),
    selection: selectedClaim
      ? {
          claimId: selectedClaim.id,
          inCurrentView: selectedInView,
          status: selectedClaim.status,
          restartSafeStatus: selectedClaim.restartSafeStatus,
          recoverySource: stableText(selectedClaim.recoverySource, null),
          hostedKernelDeliveryState: stableText(selectedClaim.hostedKernelDeliveryState, null),
          mailchimp: selectedClaim.mailchimp,
          proofRefs: selectedClaim.proofRefs,
          policyDenialReason: claimPolicyDenialReason(selectedClaim, state.workspacePolicy),
          permissionGrantCount: selectedClaim.permissionGrants.length,
          permissionDenialReason: claimPermissionDenialReason(selectedClaim, principal),
          healthDenialReason: runtimeHealthDenialReason,
          nextActions: selectionActionState.availableActions,
          nextActionState: selectionActionState,
          previewAcceptance: selectionPreviewAcceptance,
          canMutate: selectionActionState.canMutate
        }
      : null,
    previewAcceptance: selectionPreviewAcceptance,
    pageInfo: {
      totalMatching: allVisibleRows.length,
      cursor: clientRequest.cursor,
      cursorFound: !clientRequest.cursor || cursorIndex >= 0,
      startIndex,
      returned: pageRows.length,
      nextCursor
    }
  };
}

function buildClaimProofOutputs(state, clientRuntime, evidence, commandResult) {
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const visibleClaimIds = new Set(clientRuntime.rows.map((row) => row.id));
  return state.claims
    .filter((claim) => visibleClaimIds.has(claim.id) || (clientRuntime.selection && clientRuntime.selection.claimId === claim.id))
    .map((claim) => {
      const appliedReceipt = commandResult && commandResult.receipt && commandResult.receipt.claimId === claim.id
        ? commandResult.receipt
        : null;
      return {
        kind: 'claim-browser-proof-output',
        surfaceId,
        tenantId: state.tenantId,
        workspaceId: state.workspaceId,
        claimId: claim.id,
        status: claim.status,
        revision: claim.revision,
        updatedAt: claim.updatedAt,
        restartSafeStatus: claim.restartSafeStatus,
        recoverySource: stableText(claim.recoverySource, null),
        lastRecoveredCommandId: stableText(claim.lastRecoveredCommandId, null),
        hostedKernelDeliveryState: stableText(claim.hostedKernelDeliveryState, null),
        mailchimp: claim.mailchimp.enabled ? claim.mailchimp : null,
        proofRefs: claim.proofRefs,
        permissionGrantCount: claim.permissionGrants.length,
        evidence: claim.proofRefs
          .map((ref) => evidenceById.get(ref))
          .filter(Boolean)
          .map((entry) => ({ id: entry.id, kind: entry.kind, digest: entry.digest })),
        lastAppliedCommandId: appliedReceipt && appliedReceipt.accepted ? appliedReceipt.commandId : null,
        commandBoundaryDecision: appliedReceipt ? appliedReceipt.boundaryDecision : null,
        route: `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${claim.id}`
      };
    });
}

function handoffPriority(kind, reason = null) {
  if (kind === 'selected-claim-blocked') return 10;
  if (kind === 'provider-command-failed') return 20;
  if (kind === 'health-command-retry-ready') return 30;
  if (kind === 'mailchimp-publish-blocked') return 35;
  if (kind === 'mailchimp-publish-waiting') return 36;
  if (kind === 'provider-command-blocked') return 40;
  if (kind === 'terminal-proof-backlog') return 50;
  if (kind === 'selected-command-ready') return 60;
  if (kind === 'provider-command-awaiting-ack') return 70;
  if (reason === 'claim-not-selected') return 80;
  return 90;
}

function buildWorkflowHandoffQueue(state, clientRuntime, providerServiceContract, now) {
  const entries = [];
  const selectedClaimId = clientRuntime.selection ? clientRuntime.selection.claimId : null;
  const selectedPreview = clientRuntime.previewAcceptance;
  const selectedRoute = selectedClaimId
    ? `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${selectedClaimId}`
    : `claim-browser://${state.tenantId}/${state.workspaceId}/claims`;
  const suggestedPreview = selectedPreview.actions.find((preview) => preview.action === selectedPreview.suggestedAction) || null;
  const selectedBlockingFinding = selectedPreview.validationSummary.findings.find((finding) => finding.severity === 'blocking') || null;

  if (selectedPreview.ready && suggestedPreview) {
    entries.push({
      kind: 'selected-command-ready',
      claimId: selectedClaimId,
      action: suggestedPreview.action,
      reason: 'operator-command-ready',
      title: 'Selected claim has a ready hosted-kernel command.',
      route: suggestedPreview.commandTemplate ? suggestedPreview.commandTemplate.route : selectedRoute,
      commandTemplate: suggestedPreview.commandTemplate,
      generatedAt: now
    });
  } else {
    entries.push({
      kind: 'selected-claim-blocked',
      claimId: selectedClaimId,
      action: selectedPreview.suggestedAction,
      reason: selectedBlockingFinding ? selectedBlockingFinding.code : 'claim-not-selected',
      title: selectedClaimId
        ? 'Selected claim cannot be handed off for mutation.'
        : 'No claim is selected for workflow handoff.',
      route: selectedBlockingFinding ? selectedBlockingFinding.route : selectedRoute,
      details: selectedBlockingFinding ? selectedBlockingFinding.details : {},
      generatedAt: now
    });
  }

  for (const handoff of providerServiceContract.externalHandoff) {
    if (handoff.handoffState === 'acknowledged') continue;
    const failed = handoff.handoffState === 'failed';
    const blocked = handoff.handoffState === 'blocked';
    entries.push({
      kind: failed
        ? 'provider-command-failed'
        : blocked
          ? 'provider-command-blocked'
          : 'provider-command-awaiting-ack',
      commandId: handoff.commandId,
      claimId: handoff.claimId,
      action: handoff.action,
      reason: handoff.blockedReason || handoff.providerErrorCode || handoff.handoffState,
      title: failed
        ? 'Hosted-kernel provider reported command failure.'
        : blocked
          ? 'Hosted-kernel provider handoff is blocked.'
          : 'Hosted-kernel provider handoff is awaiting acknowledgement.',
      route: handoff.route,
      providerCommandId: handoff.providerCommandId,
      providerRetryable: handoff.providerRetryable,
      providerStatusCode: handoff.providerStatusCode,
      providerFailedAt: handoff.providerFailedAt,
      generatedAt: now
    });
  }

  for (const barrier of providerServiceContract.mailchimpSync.publishBarriers.filter((entry) => !entry.ready)) {
    entries.push({
      kind: barrier.state === 'blocked' ? 'mailchimp-publish-blocked' : 'mailchimp-publish-waiting',
      claimId: barrier.claimId,
      reason: barrier.blockingCodes[0] || barrier.state,
      title: barrier.state === 'blocked'
        ? 'Mailchimp publish is blocked for this claim.'
        : 'Mailchimp publish is waiting on provider state.',
      route: barrier.publishRoute,
      campaignId: barrier.campaignId,
      audienceId: barrier.audienceId,
      campaignStatus: barrier.campaignStatus,
      latestReceiptAt: barrier.latestReceiptAt,
      syncCursor: barrier.syncCursor,
      retryable: barrier.retryable,
      retryAfterMs: barrier.retryAfterMs,
      nextProviderAction: barrier.nextProviderAction,
      operatorCommand: barrier.operatorCommand,
      blockingCodes: barrier.blockingCodes,
      generatedAt: now
    });
  }

  for (const retry of state.healthRetryQueue.filter((entry) => entry.retryable)) {
    const retryDue = retry.nextRetryAt ? Date.parse(retry.nextRetryAt) <= Date.parse(now) : false;
    entries.push({
      kind: retryDue ? 'health-command-retry-ready' : 'health-command-retry-waiting',
      commandId: retry.commandId,
      claimId: retry.claimId,
      action: retry.action,
      reason: retry.reason,
      title: retryDue
        ? 'A hosted-kernel health retry is ready.'
        : 'A hosted-kernel health retry is scheduled.',
      route: retry.route,
      retryAfterMs: retry.retryAfterMs,
      nextRetryAt: retry.nextRetryAt,
      escalationRoute: retry.escalationRoute,
      generatedAt: now
    });
  }

  for (const row of clientRuntime.rows) {
    if (!TERMINAL_STATUS.has(row.status) || row.proofRefCount > 0) continue;
    entries.push({
      kind: 'terminal-proof-backlog',
      claimId: row.id,
      reason: 'terminal-claim-missing-proof',
      title: 'Terminal claim is missing attached proof.',
      route: `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${row.id}/proof`,
      status: row.status,
      revision: row.revision,
      generatedAt: now
    });
  }

  const sortedEntries = entries
    .map((entry) => ({ ...entry, priority: handoffPriority(entry.kind, entry.reason) }))
    .sort((left, right) => left.priority - right.priority || stableText(left.generatedAt, now).localeCompare(stableText(right.generatedAt, now)))
    .slice(0, WORKFLOW_HANDOFF_QUEUE_LIMIT);
  return {
    kind: 'claim-browser-workflow-handoff-queue.v1',
    generatedAt: now,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    selectedClaimId,
    correlationId: clientRuntime.request.correlationId,
    queueLimit: WORKFLOW_HANDOFF_QUEUE_LIMIT,
    entries: sortedEntries,
    summary: {
      total: sortedEntries.length,
      requiresOperatorAction: sortedEntries.some((entry) => entry.priority <= 60),
      providerAttentionCount: sortedEntries.filter((entry) => entry.kind.startsWith('provider-command-')).length,
      mailchimpPublishAttentionCount: sortedEntries.filter((entry) => entry.kind.startsWith('mailchimp-publish-')).length,
      retryReadyCount: sortedEntries.filter((entry) => entry.kind === 'health-command-retry-ready').length,
      proofBacklogCount: sortedEntries.filter((entry) => entry.kind === 'terminal-proof-backlog').length,
      selectedBlockedReason: selectedPreview.ready
        ? null
        : selectedBlockingFinding
          ? selectedBlockingFinding.code
          : 'claim-not-selected'
    }
  };
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = stableText(keyFn(item), 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeAnalyticsSnapshot(rawSnapshot) {
  const snapshot = asRecord(rawSnapshot);
  const generatedAt = normalizeIsoTimestamp(snapshot.generatedAt);
  if (!generatedAt) return null;
  return {
    kind: stableText(snapshot.kind, 'claim-browser-analytics-snapshot.v1'),
    surfaceId: stableText(snapshot.surfaceId, surfaceId),
    tenantId: stableText(snapshot.tenantId, null),
    workspaceId: stableText(snapshot.workspaceId, null),
    generatedAt,
    claimCount: Math.max(0, toFiniteNumber(snapshot.claimCount, 0)),
    unresolvedCount: Math.max(0, toFiniteNumber(snapshot.unresolvedCount, 0)),
    terminalCount: Math.max(0, toFiniteNumber(snapshot.terminalCount, 0)),
    acceptedCommandCount: Math.max(0, toFiniteNumber(snapshot.acceptedCommandCount, 0)),
    deniedCommandCount: Math.max(0, toFiniteNumber(snapshot.deniedCommandCount, 0)),
    proofBacklogCount: Math.max(0, toFiniteNumber(snapshot.proofBacklogCount, 0)),
    hostedKernelPendingCount: Math.max(0, toFiniteNumber(snapshot.hostedKernelPendingCount, 0)),
    healthRetryQueueCount: Math.max(0, toFiniteNumber(snapshot.healthRetryQueueCount, 0)),
    mailchimpClaimCount: Math.max(0, toFiniteNumber(snapshot.mailchimpClaimCount, 0)),
    mailchimpExportReadyCount: Math.max(0, toFiniteNumber(snapshot.mailchimpExportReadyCount, 0)),
    mailchimpCampaignCount: Math.max(0, toFiniteNumber(snapshot.mailchimpCampaignCount, 0)),
    mailchimpAudienceCount: Math.max(0, toFiniteNumber(snapshot.mailchimpAudienceCount, 0)),
    mailchimpLifecycleReadyCount: Math.max(0, toFiniteNumber(snapshot.mailchimpLifecycleReadyCount, 0)),
    mailchimpLifecycleBlockedCount: Math.max(0, toFiniteNumber(snapshot.mailchimpLifecycleBlockedCount, 0)),
    mailchimpExportLedgerRecordCount: Math.max(0, toFiniteNumber(snapshot.mailchimpExportLedgerRecordCount, 0)),
    mailchimpExportLedgerAcceptedCount: Math.max(0, toFiniteNumber(snapshot.mailchimpExportLedgerAcceptedCount, 0)),
    mailchimpExportLedgerBlockingCount: Math.max(0, toFiniteNumber(snapshot.mailchimpExportLedgerBlockingCount, 0)),
    healthStatus: stableText(snapshot.healthStatus, null),
    restartSafe: snapshot.restartSafe === true
  };
}

function normalizeAnalyticsHistory(persisted) {
  const seen = new Set();
  const rawHistory = Array.isArray(persisted.analyticsHistory) ? persisted.analyticsHistory : [];
  const history = [];
  for (const rawSnapshot of rawHistory) {
    const snapshot = normalizeAnalyticsSnapshot(rawSnapshot);
    if (!snapshot) continue;
    const key = `${snapshot.tenantId}:${snapshot.workspaceId}:${snapshot.generatedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(snapshot);
  }
  return history
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    .slice(-ANALYTICS_HISTORY_LIMIT);
}

function normalizeMailchimpExportLedgerRecord(rawRecord, index, scope) {
  const record = asRecord(rawRecord);
  const generatedAt = normalizeIsoTimestamp(record.generatedAt || record.at || record.timestamp);
  if (!generatedAt) return null;
  const tenantId = stableText(record.tenantId, stableText(asRecord(record.scope).tenantId, scope.tenantId));
  const workspaceId = stableText(record.workspaceId, stableText(asRecord(record.scope).workspaceId, scope.workspaceId));
  const campaign = asRecord(record.campaign);
  const audience = asRecord(record.audience);
  const campaignId = stableText(record.campaignId, stableText(campaign.campaignId, null));
  const audienceId = stableText(record.audienceId, stableText(audience.audienceId, null));
  const idempotencyKey = stableText(record.idempotencyKey, stableText(record.persistenceKey, null));
  const ledgerId = stableText(
    record.ledgerId,
    stableText(record.exportId, `mailchimp-export:${campaignId || 'campaign'}:${audienceId || 'audience'}:${index + 1}`)
  );
  const campaignStatus = stableText(record.campaignStatus, stableText(campaign.status, 'unknown')).toLowerCase();

  return {
    contract: 'claim-browser.mailchimp-export-ledger-record.v1',
    sourceContract: stableText(record.contract, 'operator-userland.cli-claim.mailchimp-export-ledger-record.v1'),
    ledgerId,
    exportId: stableText(record.exportId, ledgerId),
    generatedAt,
    tenantId,
    workspaceId,
    principalId: stableText(record.principalId, null),
    campaignId,
    audienceId,
    campaignStatus: MAILCHIMP_CAMPAIGN_STATUSES.includes(campaignStatus) ? campaignStatus : 'unknown',
    ready: record.ready === true || record.exportReady === true,
    accepted: record.accepted === true || record.acceptanceRecorded === true,
    restartSafe: record.restartSafe === true,
    blockingCodes: normalizeStringList(record.blockingCodes || record.reasonCodes),
    idempotencyKey,
    providerCursor: stableText(record.providerCursor, stableText(record.syncCursor, stableText(record.cursor, null))),
    providerRevision: stableText(record.providerRevision, null),
    nextProviderAction: stableText(record.nextProviderAction, null),
    selectedOutputFormat: stableText(record.selectedOutputFormat, stableText(record.outputFormat, null)),
    persistedStorageKey: stableText(record.persistedStorageKey, stableText(record.storageKey, null))
  };
}

function normalizeMailchimpExportLedger(persisted, scope) {
  const analytics = asRecord(persisted.analytics);
  const exportSummary = asRecord(persisted.exportSummary);
  const summaryLedger = asRecord(exportSummary.mailchimpExportLedger);
  const analyticsLedger = asRecord(analytics.mailchimpExportLedger);
  const rawRecords = [
    ...(Array.isArray(persisted.mailchimpExportLedger) ? persisted.mailchimpExportLedger : []),
    ...(Array.isArray(persisted.mailchimpExportHistory) ? persisted.mailchimpExportHistory : []),
    ...(Array.isArray(analyticsLedger.records) ? analyticsLedger.records : []),
    ...(Array.isArray(summaryLedger.records) ? summaryLedger.records : []),
    ...(asRecord(analyticsLedger.currentRecord).generatedAt ? [analyticsLedger.currentRecord] : []),
    ...(asRecord(summaryLedger.currentRecord).generatedAt ? [summaryLedger.currentRecord] : [])
  ];
  const seen = new Set();
  const records = [];
  const rejected = [];
  for (const [index, rawRecord] of rawRecords.entries()) {
    const record = normalizeMailchimpExportLedgerRecord(rawRecord, index, scope);
    if (!record) continue;
    const key = `${record.tenantId}:${record.workspaceId}:${record.ledgerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (record.tenantId !== scope.tenantId || record.workspaceId !== scope.workspaceId) {
      rejected.push({
        ledgerId: record.ledgerId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        expectedTenantId: scope.tenantId,
        expectedWorkspaceId: scope.workspaceId
      });
      continue;
    }
    records.push(record);
  }

  return {
    records: records
      .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
      .slice(-ANALYTICS_HISTORY_LIMIT),
    rejected
  };
}

function buildReportTimeline(state, commandResult, now) {
  const claimEvents = state.claims.map((claim) => ({
    kind: 'claim-status-snapshot',
    at: claim.updatedAt,
    claimId: claim.id,
    status: claim.status,
    revision: claim.revision,
    principalId: stableText(claim.lastOperatorId, null),
    route: `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${claim.id}`
  }));
  const commandEvents = state.commandAudit.map((entry) => ({
    kind: entry.accepted ? 'command-applied' : 'command-recorded',
    at: entry.recordedAt,
    commandId: entry.commandId,
    claimId: entry.claimId,
    action: entry.action,
    beforeStatus: entry.beforeStatus,
    afterStatus: entry.afterStatus,
    revision: entry.afterRevision,
    principalId: entry.principalId,
    proofRefCount: entry.attachedProofRefs.length
  }));
  const boundaryEvents = state.boundaryEvents.map((event, index) => ({
    kind: 'boundary-event',
    boundaryKind: stableText(event.kind, 'boundary-event'),
    at: stableText(event.recordedAt, now),
    sequence: index + 1,
    claimId: stableText(event.claimId, null),
    commandId: stableText(event.commandId, null),
    reason: stableText(event.reason, null),
    escalationRoute: stableText(event.escalationRoute, null)
  }));
  const retryEvents = state.healthRetryQueue.map((directive) => ({
    kind: 'health-command-retry-scheduled',
    at: directive.updatedAt,
    commandId: directive.commandId,
    claimId: directive.claimId,
    action: directive.action,
    reason: directive.reason,
    retryAfterMs: directive.retryAfterMs,
    nextRetryAt: directive.nextRetryAt,
    escalationRoute: directive.escalationRoute
  }));
  const currentCommandEvent = commandResult && commandResult.receipt
    ? [{
        kind: commandResult.accepted ? 'command-receipt-accepted' : 'command-receipt-denied',
        at: commandResult.receipt.recordedAt,
        commandId: commandResult.receipt.commandId,
        claimId: commandResult.receipt.claimId,
        action: commandResult.receipt.action,
        reason: commandResult.receipt.reason,
        principalId: commandResult.receipt.principalId
      }]
    : [];
  return [...claimEvents, ...commandEvents, ...boundaryEvents, ...retryEvents, ...currentCommandEvent]
    .filter((event) => normalizeIsoTimestamp(event.at))
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, REPORT_TIMELINE_LIMIT);
}

function buildMailchimpAnalyticsSummary(claims, visibleRows, operationalHealth = null) {
  const mailchimpClaims = claims.filter((claim) => claim.mailchimp && claim.mailchimp.enabled);
  const visibleClaimIds = new Set(visibleRows.map((row) => row.id));
  const visibleMailchimpClaims = mailchimpClaims.filter((claim) => visibleClaimIds.has(claim.id));
  const campaigns = countBy(mailchimpClaims.filter((claim) => claim.mailchimp.campaignId), (claim) => claim.mailchimp.campaignId);
  const audiences = countBy(mailchimpClaims.filter((claim) => claim.mailchimp.audienceId), (claim) => claim.mailchimp.audienceId);
  const campaignStatuses = countBy(mailchimpClaims, (claim) => claim.mailchimp.campaignStatus);
  const exportReadyClaims = mailchimpClaims.filter((claim) => claim.mailchimp.readyForExport);
  const attentionClaims = mailchimpClaims.filter((claim) => !claim.mailchimp.readyForExport);
  const lifecycleGates = mailchimpClaims.map((claim) => buildMailchimpLifecycleGate(claim, operationalHealth));
  const lifecycleReadyGates = lifecycleGates.filter((gate) => gate.ready);
  const lifecycleBlockedGates = lifecycleGates.filter((gate) => gate.state === 'blocked');
  const lifecycleGateStates = countBy(lifecycleGates, (gate) => gate.state);
  const lifecycleGateReasons = countBy(lifecycleGates.flatMap((gate) => gate.reasonCodes), (code) => code);
  const segmentIds = [...new Set(mailchimpClaims.flatMap((claim) => claim.mailchimp.segmentIds))].sort();
  const exportLabels = [...new Set(mailchimpClaims.flatMap((claim) => claim.mailchimp.exportLabels))].sort();

  return {
    contract: 'claim-browser.mailchimp-analytics-summary.v1',
    enabled: mailchimpClaims.length > 0,
    claimCount: mailchimpClaims.length,
    visibleClaimCount: visibleMailchimpClaims.length,
    exportReadyCount: exportReadyClaims.length,
    lifecycleReadyCount: lifecycleReadyGates.length,
    lifecycleBlockedCount: lifecycleBlockedGates.length,
    attentionCount: attentionClaims.length,
    campaignCount: Object.keys(campaigns).length,
    audienceCount: Object.keys(audiences).length,
    segmentCount: segmentIds.length,
    campaigns,
    audiences,
    campaignStatuses,
    lifecycleGateStates,
    lifecycleGateReasons,
    segmentIds,
    exportLabels,
    lifecycleGates,
    exportReadyClaimIds: exportReadyClaims.map((claim) => claim.id),
    lifecycleReadyClaimIds: lifecycleReadyGates.map((gate) => gate.claimId),
    lifecycleBlockedClaimIds: lifecycleBlockedGates.map((gate) => gate.claimId),
    attentionClaimIds: attentionClaims.map((claim) => claim.id),
    visibleClaimIds: visibleMailchimpClaims.map((claim) => claim.id),
    nextAction: lifecycleBlockedGates.length
      ? lifecycleBlockedGates[0].nextProviderAction
      : attentionClaims.length
      ? 'complete-mailchimp-campaign-audience-context'
      : mailchimpClaims.length
        ? 'export-mailchimp-claim-summary'
        : 'no-mailchimp-claims'
  };
}

function buildAnalyticsReporting(state, clientRuntime, commandResult, now, persisted) {
  const commandReceipts = state.commandReceipts;
  const acceptedReceipts = commandReceipts.filter((receipt) => receipt.accepted);
  const deniedReceipts = commandReceipts.filter((receipt) => !receipt.accepted);
  const terminalClaims = state.claims.filter((claim) => TERMINAL_STATUS.has(claim.status));
  const unresolvedClaims = state.claims.filter((claim) => !TERMINAL_STATUS.has(claim.status));
  const proofBacklogClaims = state.claims.filter((claim) => TERMINAL_STATUS.has(claim.status) && claim.proofRefs.length === 0);
  const pendingOutbox = state.hostedKernelOutbox.filter((entry) => entry.deliveryState === 'pending' || entry.deliveryState === 'failed');
  const activeHealthRetries = state.healthRetryQueue.filter((entry) => entry.retryable);
  const mailchimpSummary = buildMailchimpAnalyticsSummary(state.claims, clientRuntime.rows, state.operationalHealth);
  const mailchimpExportLedger = normalizeMailchimpExportLedger(persisted, {
    tenantId: state.tenantId,
    workspaceId: state.workspaceId
  });
  const latestMailchimpExportRecord = mailchimpExportLedger.records.at(-1) || null;
  const currentCampaignIds = new Set(Object.keys(mailchimpSummary.campaigns));
  const currentAudienceIds = new Set(Object.keys(mailchimpSummary.audiences));
  const ledgerCampaignIds = new Set(mailchimpExportLedger.records.map((record) => record.campaignId).filter(Boolean));
  const ledgerAudienceIds = new Set(mailchimpExportLedger.records.map((record) => record.audienceId).filter(Boolean));
  const orphanLedgerRecords = mailchimpExportLedger.records.filter((record) => (
    (record.campaignId && !currentCampaignIds.has(record.campaignId))
      || (record.audienceId && !currentAudienceIds.has(record.audienceId))
  ));
  const blockingLedgerRecords = mailchimpExportLedger.records.filter((record) => record.blockingCodes.length > 0);
  const restartUnsafeLedgerRecords = mailchimpExportLedger.records.filter((record) => !record.restartSafe);
  const mailchimpLedgerSummary = {
    contract: 'claim-browser.mailchimp-export-ledger-summary.v1',
    source: 'persistedState.mailchimpExportLedger',
    retainedRecordCount: mailchimpExportLedger.records.length,
    rejectedOutOfScopeCount: mailchimpExportLedger.rejected.length,
    readyRecordCount: mailchimpExportLedger.records.filter((record) => record.ready).length,
    acceptedRecordCount: mailchimpExportLedger.records.filter((record) => record.accepted).length,
    blockingRecordCount: blockingLedgerRecords.length,
    restartUnsafeRecordCount: restartUnsafeLedgerRecords.length,
    orphanRecordCount: orphanLedgerRecords.length,
    campaignCount: ledgerCampaignIds.size,
    audienceCount: ledgerAudienceIds.size,
    latestRecord: latestMailchimpExportRecord,
    rejectedRecords: mailchimpExportLedger.rejected,
    blockingLedgerIds: blockingLedgerRecords.map((record) => record.ledgerId),
    orphanLedgerIds: orphanLedgerRecords.map((record) => record.ledgerId),
    restartUnsafeLedgerIds: restartUnsafeLedgerRecords.map((record) => record.ledgerId),
    recoveryState: mailchimpExportLedger.rejected.length
      ? 'scope-repair-required'
      : restartUnsafeLedgerRecords.length
        ? 'restart-confirmation-required'
        : orphanLedgerRecords.length
          ? 'stale-export-context'
          : latestMailchimpExportRecord
            ? 'recovered'
            : 'empty',
    nextRecoveryAction: mailchimpExportLedger.rejected.length
      ? 'drop-out-of-scope-mailchimp-export-records'
      : restartUnsafeLedgerRecords.length
        ? 'replay-mailchimp-export-ledger-after-restart'
        : orphanLedgerRecords.length
          ? 'refresh-mailchimp-campaign-audience-context'
          : latestMailchimpExportRecord
            ? 'reuse-latest-mailchimp-export-record'
            : 'emit-mailchimp-export-ledger-from-cli-claim'
  };
  const snapshot = {
    kind: 'claim-browser-analytics-snapshot.v1',
    surfaceId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    generatedAt: now,
    claimCount: state.claims.length,
    unresolvedCount: unresolvedClaims.length,
    terminalCount: terminalClaims.length,
    acceptedCommandCount: acceptedReceipts.length,
    deniedCommandCount: deniedReceipts.length,
    proofBacklogCount: proofBacklogClaims.length,
    hostedKernelPendingCount: pendingOutbox.length,
    healthRetryQueueCount: activeHealthRetries.length,
    mailchimpClaimCount: mailchimpSummary.claimCount,
    mailchimpExportReadyCount: mailchimpSummary.exportReadyCount,
    mailchimpCampaignCount: mailchimpSummary.campaignCount,
    mailchimpAudienceCount: mailchimpSummary.audienceCount,
    mailchimpLifecycleReadyCount: mailchimpSummary.lifecycleReadyCount,
    mailchimpLifecycleBlockedCount: mailchimpSummary.lifecycleBlockedCount,
    mailchimpExportLedgerRecordCount: mailchimpLedgerSummary.retainedRecordCount,
    mailchimpExportLedgerAcceptedCount: mailchimpLedgerSummary.acceptedRecordCount,
    mailchimpExportLedgerBlockingCount: mailchimpLedgerSummary.blockingRecordCount,
    healthStatus: state.operationalHealth.status,
    restartSafe: !state.claims.some((claim) => claim.status === 'running' || claim.status === 'new')
      && mailchimpLedgerSummary.restartUnsafeRecordCount === 0
  };
  const priorHistory = normalizeAnalyticsHistory(persisted);
  const analyticsHistory = [...priorHistory, snapshot]
    .filter((entry, index, list) => list.findIndex((candidate) => candidate.generatedAt === entry.generatedAt) === index)
    .slice(-ANALYTICS_HISTORY_LIMIT);
  const counters = {
    claimsByStatus: countBy(state.claims, (claim) => claim.status),
    claimsByAssignee: countBy(state.claims.filter((claim) => claim.assignee), (claim) => claim.assignee),
    commandsByAction: countBy(commandReceipts.filter((receipt) => receipt.action), (receipt) => receipt.action),
    denialsByReason: countBy(deniedReceipts, (receipt) => receipt.reason),
    outboxByDeliveryState: countBy(state.hostedKernelOutbox, (entry) => entry.deliveryState),
    healthRetriesByReason: countBy(activeHealthRetries, (entry) => entry.reason),
    boundaryEventsByKind: countBy(state.boundaryEvents, (event) => event.kind),
    mailchimpCampaigns: mailchimpSummary.campaigns,
    mailchimpAudiences: mailchimpSummary.audiences,
    mailchimpCampaignStatuses: mailchimpSummary.campaignStatuses,
    mailchimpLifecycleGateStates: mailchimpSummary.lifecycleGateStates,
    mailchimpLifecycleGateReasons: mailchimpSummary.lifecycleGateReasons,
    mailchimpExportLedgerByCampaign: countBy(mailchimpExportLedger.records.filter((record) => record.campaignId), (record) => record.campaignId),
    mailchimpExportLedgerByAudience: countBy(mailchimpExportLedger.records.filter((record) => record.audienceId), (record) => record.audienceId),
    mailchimpExportLedgerByStatus: countBy(mailchimpExportLedger.records, (record) => record.ready ? 'ready' : 'blocked')
  };
  const exportSummary = {
    kind: 'claim-browser-export-summary.v1',
    generatedAt: now,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    correlationId: clientRuntime.request.correlationId,
    selectedClaimId: clientRuntime.selection ? clientRuntime.selection.claimId : null,
    viewMode: clientRuntime.request.mode,
    visibleClaimCount: clientRuntime.pageInfo.returned,
    totalMatchingClaimCount: clientRuntime.pageInfo.totalMatching,
    snapshot,
    counters,
    mailchimp: mailchimpSummary,
    proofBacklogClaimIds: proofBacklogClaims.map((claim) => claim.id),
    unresolvedClaimIds: unresolvedClaims.map((claim) => claim.id),
    pendingHostedKernelCommandIds: pendingOutbox.map((entry) => entry.commandId),
    healthRetryCommandIds: activeHealthRetries.map((entry) => entry.commandId),
    nextHealthRetryAt: activeHealthRetries
      .map((entry) => entry.nextRetryAt)
      .filter(Boolean)
      .sort()[0] || null,
    latestCommandReceipt: commandReceipts.at(-1) || null,
    mailchimpExportLedger: {
      ...mailchimpLedgerSummary,
      records: mailchimpExportLedger.records
    },
    timelineLimit: REPORT_TIMELINE_LIMIT
  };
  return {
    counters,
    snapshot,
    history: analyticsHistory,
    exportSummary,
    timeline: buildReportTimeline(state, commandResult, now)
  };
}

function shapePersistedState(input, now) {
  const scope = normalizeScope(input);
  const persisted = asRecord(input.persistedState);
  const principal = normalizePrincipal(input, scope);
  const persistedClaims = Array.isArray(persisted.claims) ? persisted.claims : [];
  const incomingClaims = Array.isArray(input.claims) ? input.claims : [];
  const claimsById = new Map();
  const warnings = [];
  const boundaryEvents = [];

  for (const claim of persistedClaims.map((item, index) => normalizeClaim(item, index, now, scope))) {
    claimsById.set(claim.id, claim);
    warnings.push(...claim.permissionWarnings);
    boundaryEvents.push(...claim.permissionBoundaryEvents);
  }
  for (const claim of incomingClaims.map((item, index) => normalizeClaim(item, persistedClaims.length + index, now, scope))) {
    warnings.push(...claim.permissionWarnings);
    boundaryEvents.push(...claim.permissionBoundaryEvents);
    if (claim.tenantId !== scope.tenantId || claim.workspaceId !== scope.workspaceId) {
      boundaryEvents.push({
        kind: 'claim-scope-rejected',
        claimId: claim.id,
        tenantId: claim.tenantId,
        workspaceId: claim.workspaceId,
        expectedTenantId: scope.tenantId,
        expectedWorkspaceId: scope.workspaceId
      });
      warnings.push(`ignored out-of-scope claim ${claim.id}`);
      continue;
    }
    const existing = claimsById.get(claim.id);
    if (!existing || claim.revision >= existing.revision) {
      claimsById.set(claim.id, claim);
    } else {
      warnings.push(`ignored older claim revision for ${claim.id}`);
    }
  }

  const commandReceipts = normalizeCommandReceipts(persisted, now);
  const commandAudit = normalizeCommandAudit(persisted, now);
  const hostedKernelOutbox = normalizeHostedKernelOutbox(persisted, now);
  const healthRetryQueue = normalizeHealthRetryQueue(persisted, now);
  const priorRecoveryJournal = normalizeRecoveryJournal(persisted, now);
  const recoveryIntents = normalizeRecoveryIntents(persisted, now, scope);
  const recoveryJournalEntries = [];
  const claims = [...claimsById.values()].map((claim) => {
    const recovered = recoverClaimRestartState(claim, commandReceipts, commandAudit, hostedKernelOutbox, recoveryIntents, now);
    recoveryJournalEntries.push(...recovered.recoveryEvents);
    for (const event of recovered.recoveryEvents) {
      warnings.push(`recovered ${event.claimId} from ${event.fromStatus} to ${event.toStatus}: ${event.reason}`);
      boundaryEvents.push({
        kind: 'claim-restart-recovered',
        claimId: event.claimId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        fromRevision: event.fromRevision,
        toRevision: event.toRevision,
        reason: event.reason,
        commandId: event.commandId,
        evidenceSource: event.evidenceSource,
        recoveredAt: event.recoveredAt
      });
    }
    const { permissionWarnings, permissionBoundaryEvents, ...persistableClaim } = recovered.claim;
    return persistableClaim;
  });
  const recoveryJournal = [...priorRecoveryJournal, ...recoveryJournalEntries]
    .filter((entry, index, list) => list.findIndex((candidate) => candidate.recoveryId === entry.recoveryId) === index)
    .slice(-RECOVERY_JOURNAL_LIMIT);
  const workspacePolicy = normalizeWorkspacePolicy(input, scope);
  const baseLifecycleSettings = normalizeLifecycleSettings(input, now);
  const lifecycleCommand = applyLifecycleCommand(input, scope, principal, now, baseLifecycleSettings);
  const lifecycleSettings = lifecycleCommand.settingsPatch && Object.keys(lifecycleCommand.settingsPatch).length
    ? normalizeLifecycleSettings({
        persistedState: { lifecycleSettings: baseLifecycleSettings },
        lifecycleSettings: lifecycleCommand.settingsPatch
      }, now)
    : baseLifecycleSettings;
  const operationalHealth = normalizeOperationalHealth(input, now, workspacePolicy, lifecycleSettings);
  if (lifecycleCommand.boundaryEvent) {
    boundaryEvents.push(lifecycleCommand.boundaryEvent);
  }
  if (!workspacePolicy.scopeMatched) {
    boundaryEvents.push({
      kind: 'workspace-policy-scope-rejected',
      tenantId: workspacePolicy.sourceTenantId,
      workspaceId: workspacePolicy.sourceWorkspaceId,
      expectedTenantId: scope.tenantId,
      expectedWorkspaceId: scope.workspaceId,
      escalationRoute: workspacePolicy.escalationRoute
    });
    warnings.push('ignored out-of-scope workspace policy');
  }
  if (operationalHealth.degraded) {
    warnings.push(`claim browser health ${operationalHealth.status}`);
  }
  for (const warning of lifecycleSettings.validationWarnings) {
    warnings.push(`lifecycle settings: ${warning}`);
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    sessionId: stableText(persisted.sessionId, stableText(input.sessionId, `claim-browser:${now}`)),
    cursor: stableText(persisted.cursor, null),
    claims,
    commandReceipts,
    commandLedger: commandReceipts.map((receipt) => receipt.commandId),
    commandAudit,
    hostedKernelOutbox,
    commandOutbox: hostedKernelOutbox,
    healthRetryQueue,
    commandRetryQueue: healthRetryQueue,
    recoveryIntents,
    restartRecoveryIntents: recoveryIntents,
    recoveryJournal,
    lifecycleCommandReceipts: lifecycleCommand.receipts,
    lifecycleCommandAudit: lifecycleCommand.auditEntry
      ? [...(Array.isArray(persisted.lifecycleCommandAudit) ? persisted.lifecycleCommandAudit : []), lifecycleCommand.auditEntry].slice(-LIFECYCLE_COMMAND_RECEIPT_LIMIT)
      : (Array.isArray(persisted.lifecycleCommandAudit) ? persisted.lifecycleCommandAudit : []).slice(-LIFECYCLE_COMMAND_RECEIPT_LIMIT),
    lastLifecycleCommandReceipt: lifecycleCommand.receipt,
    workspacePolicy,
    lifecycleSettings,
    operationalHealth,
    recoveredFromVersion: toFiniteNumber(persisted.schemaVersion, 0) === STATE_SCHEMA_VERSION ? null : toFiniteNumber(persisted.schemaVersion, 0),
    warnings,
    boundaryEvents
  };
}

function rejectCommand(state, commandId, fingerprint, principal, now, reason, boundaryEvent = null, boundaryDecision = null) {
  if (!commandId) {
    return { state, accepted: false, idempotent: false, reason, receipt: null };
  }
  return recordCommandResult(state, commandId, fingerprint, principal, now, false, reason, null, boundaryEvent, boundaryDecision);
}

function applyCommand(state, command, now, principal) {
  const request = asRecord(command);
  const commandId = stableText(request.commandId, stableText(request.id, null));
  const fingerprint = commandFingerprint(request, state);
  const idempotencyKey = commandIdempotencyKey(request, state);
  if (!commandId) {
    return { state, accepted: false, idempotent: false, reason: 'missing-command-id', receipt: null };
  }
  const priorReceipt = state.commandReceipts.find((receipt) => receipt.commandId === commandId);
  if (priorReceipt) {
    if (!receiptMatchesCommand(priorReceipt, fingerprint)) {
      const conflictEvent = {
        kind: 'command-id-conflict',
        commandId,
        originalClaimId: priorReceipt.claimId,
        originalAction: priorReceipt.action,
        requestedClaimId: fingerprint.claimId,
        requestedAction: fingerprint.action,
        originalTenantId: priorReceipt.tenantId,
        originalWorkspaceId: priorReceipt.workspaceId,
        requestedTenantId: fingerprint.tenantId,
        requestedWorkspaceId: fingerprint.workspaceId
      };
      return {
        state: { ...state, boundaryEvents: [...state.boundaryEvents, conflictEvent] },
        accepted: false,
        idempotent: true,
        reason: 'command-id-conflict',
        receipt: priorReceipt
      };
    }
    return {
      state,
      accepted: priorReceipt.accepted,
      idempotent: true,
      reason: priorReceipt.reason,
      receipt: priorReceipt
    };
  }

  const priorEnvelopeByIdempotencyKey = idempotencyKey
    ? state.hostedKernelOutbox.find((envelope) => envelope.idempotencyKey === idempotencyKey)
    : null;
  if (priorEnvelopeByIdempotencyKey) {
    const priorEnvelopeReceipt = state.commandReceipts.find((receipt) => receipt.commandId === priorEnvelopeByIdempotencyKey.commandId) ||
      receiptFromOutboxEnvelope(priorEnvelopeByIdempotencyKey, now);
    if (!outboxEnvelopeMatchesCommand(priorEnvelopeByIdempotencyKey, fingerprint)) {
      const conflictEvent = {
        kind: 'command-idempotency-key-conflict',
        commandId,
        idempotencyKey,
        originalCommandId: priorEnvelopeByIdempotencyKey.commandId,
        originalClaimId: priorEnvelopeByIdempotencyKey.claimId,
        originalAction: priorEnvelopeByIdempotencyKey.action,
        requestedClaimId: fingerprint.claimId,
        requestedAction: fingerprint.action,
        originalTenantId: priorEnvelopeByIdempotencyKey.tenantId,
        originalWorkspaceId: priorEnvelopeByIdempotencyKey.workspaceId,
        requestedTenantId: fingerprint.tenantId,
        requestedWorkspaceId: fingerprint.workspaceId
      };
      return {
        state: { ...state, boundaryEvents: [...state.boundaryEvents, conflictEvent] },
        accepted: false,
        idempotent: true,
        reason: 'command-idempotency-key-conflict',
        receipt: priorEnvelopeReceipt
      };
    }
    return {
      state: priorEnvelopeReceipt.commandId === priorEnvelopeByIdempotencyKey.commandId &&
        state.commandReceipts.some((receipt) => receipt.commandId === priorEnvelopeReceipt.commandId)
        ? state
        : appendCommandReceipt(state, priorEnvelopeReceipt),
      accepted: priorEnvelopeReceipt.accepted,
      idempotent: true,
      reason: priorEnvelopeReceipt.reason,
      receipt: priorEnvelopeReceipt
    };
  }

  const targetId = fingerprint.claimId;
  const action = fingerprint.action;
  if (!state.operationalHealth.commandWritesEnabled) {
    const healthEvent = buildHealthBoundaryEvent(state.operationalHealth, commandId, fingerprint, principal);
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      command: request,
      accepted: false,
      reason: healthEvent.reason
    });
    const retryDirective = buildHealthRetryDirective(
      state.operationalHealth,
      healthEvent,
      commandId,
      fingerprint,
      principal,
      now
    );
    return rejectCommand(
      appendHealthRetryDirective(state, retryDirective),
      commandId,
      fingerprint,
      principal,
      now,
      healthEvent.reason,
      healthEvent,
      boundaryDecision
    );
  }
  if (!principalCanApply(principal, action)) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      command: request,
      accepted: false,
      reason: 'permission-denied'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'permission-denied', {
      kind: 'command-permission-denied',
      commandId,
      claimId: targetId,
      action,
      principalId: principal.id,
      role: principal.role
    }, boundaryDecision);
  }
  const claims = state.claims.map((claim) => ({ ...claim }));
  const target = claims.find((claim) => claim.id === targetId);
  if (!target) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      command: request,
      accepted: false,
      reason: 'claim-not-found'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'claim-not-found', null, boundaryDecision);
  }
  const commandTenantId = fingerprint.tenantId;
  const commandWorkspaceId = fingerprint.workspaceId;
  if (
    commandTenantId !== state.tenantId ||
    commandWorkspaceId !== state.workspaceId ||
    target.tenantId !== state.tenantId ||
    target.workspaceId !== state.workspaceId ||
    !principalHasScope(principal, state.tenantId, state.workspaceId)
  ) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'scope-boundary-denied'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'scope-boundary-denied', {
      kind: 'command-scope-denied',
      commandId,
      claimId: targetId,
      action,
      principalId: principal.id,
      tenantId: commandTenantId,
      workspaceId: commandWorkspaceId,
      targetTenantId: target.tenantId,
      targetWorkspaceId: target.workspaceId,
      activeTenantId: state.tenantId,
      activeWorkspaceId: state.workspaceId
    }, boundaryDecision);
  }
  const claimPermissionReason = claimPermissionDenialReason(target, principal, action);
  if (claimPermissionReason) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: claimPermissionReason
    });
    return rejectCommand(
      state,
      commandId,
      fingerprint,
      principal,
      now,
      claimPermissionReason,
      buildClaimPermissionBoundaryEvent(commandId, fingerprint, principal, target, claimPermissionReason),
      boundaryDecision
    );
  }
  const policy = state.workspacePolicy;
  const tenantAdminOverride = principal.role === 'tenant-admin' && request.policyOverride === true;
  if (!policy.scopeMatched) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'workspace-policy-out-of-scope',
      tenantAdminOverride
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'workspace-policy-out-of-scope', buildPolicyBoundaryEvent(
      policy,
      commandId,
      fingerprint,
      principal,
      'workspace-policy-out-of-scope',
      {
        sourceTenantId: policy.sourceTenantId,
        sourceWorkspaceId: policy.sourceWorkspaceId
      }
    ), boundaryDecision);
  }
  if (policy.readOnly && !tenantAdminOverride) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'workspace-read-only'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'workspace-read-only', buildPolicyBoundaryEvent(
      policy,
      commandId,
      fingerprint,
      principal,
      'workspace-read-only'
    ), boundaryDecision);
  }
  if (!policy.allowedActions.includes(action) && !tenantAdminOverride) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'workspace-action-denied'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'workspace-action-denied', buildPolicyBoundaryEvent(
      policy,
      commandId,
      fingerprint,
      principal,
      'workspace-action-denied',
      { allowedActions: policy.allowedActions }
    ), boundaryDecision);
  }
  if (policy.lockedClaimIds.includes(target.id) && !tenantAdminOverride) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'claim-locked-by-workspace-policy'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'claim-locked-by-workspace-policy', buildPolicyBoundaryEvent(
      policy,
      commandId,
      fingerprint,
      principal,
      'claim-locked-by-workspace-policy'
    ), boundaryDecision);
  }
  if (TERMINAL_STATUS.has(target.status) && action !== 'reopen') {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'terminal-claim',
      tenantAdminOverride
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'terminal-claim', null, boundaryDecision);
  }
  if (TERMINAL_COMMANDS.has(action) && !terminalEvidenceSatisfied(policy, request, target) && !tenantAdminOverride) {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'terminal-evidence-required'
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'terminal-evidence-required', buildPolicyBoundaryEvent(
      policy,
      commandId,
      fingerprint,
      principal,
      'terminal-evidence-required',
      { terminalEvidenceKinds: policy.terminalEvidenceKinds }
    ), boundaryDecision);
  }

  const beforeStatus = target.status;
  const beforeRevision = target.revision;
  const attachedEvidenceRefs = commandEvidenceRefs(request, now);
  const attachedProofRefs = [
    ...commandProofRefs(request),
    ...attachedEvidenceRefs.map((entry) => entry.ref)
  ].filter(Boolean);
  if (action === 'queue') target.status = 'queued';
  else if (action === 'block') target.status = 'blocked';
  else if (action === 'accept') target.status = 'accepted';
  else if (action === 'reject') target.status = 'rejected';
  else if (action === 'reopen') target.status = 'queued';
  else {
    const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
      target,
      command: request,
      accepted: false,
      reason: 'unknown-action',
      tenantAdminOverride
    });
    return rejectCommand(state, commandId, fingerprint, principal, now, 'unknown-action', null, boundaryDecision);
  }

  const boundaryDecision = buildCommandBoundaryDecision(state, commandId, fingerprint, principal, now, {
    target,
    command: request,
    accepted: true,
    reason: 'applied',
    tenantAdminOverride
  });
  target.restartSafeStatus = RESTART_SAFE_STATUS[target.status];
  target.revision += 1;
  target.updatedAt = now;
  target.lastOperatorId = principal.id;
  target.proofRefs = [...new Set([...target.proofRefs, ...attachedProofRefs])];
  target.lastOperatorNote = actionReasonText(request);
  const policyOverrideEvent = tenantAdminOverride
    ? buildPolicyBoundaryEvent(state.workspacePolicy, commandId, fingerprint, principal, 'tenant-admin-policy-override', {
        overrideAccepted: true
      })
    : null;
  const auditedState = appendCommandAudit({ ...state, claims }, {
    commandId,
    claimId: target.id,
    action,
    accepted: true,
    reason: 'applied',
    principalId: principal.id,
    recordedAt: now,
    beforeStatus,
    afterStatus: target.status,
    beforeRevision,
    afterRevision: target.revision,
    attachedProofRefs,
    operatorNote: target.lastOperatorNote,
    boundaryDecision
  });
  const outboxState = appendHostedKernelOutbox(
    auditedState,
    buildHostedKernelCommandEnvelope(
      commandId,
      target,
      action,
      principal,
      now,
      beforeStatus,
      beforeRevision,
      attachedProofRefs,
      request
    )
  );
  return recordCommandResult(outboxState, commandId, fingerprint, principal, now, true, 'applied', target.revision, policyOverrideEvent, boundaryDecision);
}

export function describeClaimBrowserSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const persisted = asRecord(input.persistedState);
  const shapedState = shapePersistedState(input, now);
  const principal = normalizePrincipal(input, { tenantId: shapedState.tenantId, workspaceId: shapedState.workspaceId });
  const commandResult = input.command ? applyCommand(shapedState, input.command, now, principal) : null;
  const state = commandResult ? commandResult.state : shapedState;
  const clientRequest = normalizeClientRequest(input, state);
  const clientRuntime = buildClientRuntime(state, clientRequest, principal, now);
  const lifecycleControlState = buildLifecycleControlState(state, principal, state.lastLifecycleCommandReceipt);
  const evidence = normalizeEvidence(input.evidence);
  const proofOutputs = buildClaimProofOutputs(state, clientRuntime, evidence, commandResult);
  const analyticsReporting = buildAnalyticsReporting(state, clientRuntime, commandResult, now, persisted);
  const providerServiceContract = normalizeProviderServiceContract(input, state, now);
  const workflowHandoffQueue = buildWorkflowHandoffQueue(state, clientRuntime, providerServiceContract, now);
  const operationalHealthDecision = buildOperationalHealthDecision(state.operationalHealth, state.workspacePolicy, now);
  const persistedState = {
    ...state,
    providerServiceContract,
    providerSyncMetadata: providerServiceContract.syncMetadata,
    providerDeliveryReceipts: providerServiceContract.deliveryReceipts,
    providerOrphanDeliveryReceipts: providerServiceContract.orphanDeliveryReceipts,
    externalHandoff: providerServiceContract.externalHandoff,
    analyticsCounters: analyticsReporting.counters,
    analyticsSnapshot: analyticsReporting.snapshot,
    analyticsHistory: analyticsReporting.history,
    reportTimeline: analyticsReporting.timeline,
    exportSummary: analyticsReporting.exportSummary,
    operationalHealthDecision,
    previewAcceptance: clientRuntime.previewAcceptance,
    workflowHandoffQueue
  };
  const lastCommandReceipt = state.commandReceipts.at(-1) || null;
  const lastCommandAuditEntry = state.commandAudit.at(-1) || null;
  const lastHostedKernelEnvelope = state.hostedKernelOutbox.at(-1) || null;
  const nextHealthRetry = state.healthRetryQueue
    .filter((entry) => entry.retryable && entry.nextRetryAt)
    .sort((left, right) => left.nextRetryAt.localeCompare(right.nextRetryAt))[0] || null;
  const statusCounts = state.claims.reduce((counts, claim) => {
    counts[claim.status] = (counts[claim.status] || 0) + 1;
    return counts;
  }, {});
  const unresolvedClaims = state.claims.filter((claim) => !TERMINAL_STATUS.has(claim.status));
  const mailchimpClaims = state.claims.filter((claim) => claim.mailchimp.enabled);
  const mailchimpExportReadyClaims = mailchimpClaims.filter((claim) => claim.mailchimp.readyForExport);
  const permissionBoundedClaims = state.claims.filter((claim) => claim.permissionGrants.length > 0);
  const recoveredClaims = state.claims.filter((claim) => stableText(claim.recoverySource, null));
  const proof = {
    surfaceId,
    schemaVersion: STATE_SCHEMA_VERSION,
    generatedAt: now,
    restartSafe: !state.claims.some((claim) => claim.status === 'running' || claim.status === 'new'),
    healthStatus: state.operationalHealth.status,
    degradedMode: state.operationalHealth.degraded,
    commandWritesEnabled: state.operationalHealth.commandWritesEnabled,
    operationalHealthDecisionState: operationalHealthDecision.state,
    operationalHealthNextRecoveryAction: operationalHealthDecision.nextRecoveryAction,
    operationalHealthCanRetryNow: operationalHealthDecision.canRetryNow,
    operationalHealthPrimaryErrorCode: operationalHealthDecision.primaryErrorCode,
    lifecycleMode: state.lifecycleSettings.effectiveMode,
    lifecycleScheduleState: state.lifecycleSettings.scheduleState,
    lifecycleNextReviewAt: state.lifecycleSettings.nextReviewAt,
    lifecycleControlAllowed: lifecycleControlState.canControl,
    lifecycleCommandReceiptCount: state.lifecycleCommandReceipts.length,
    lastLifecycleCommandReason: state.lastLifecycleCommandReceipt ? state.lastLifecycleCommandReceipt.reason : null,
    retryAfterMs: state.operationalHealth.retryPolicy.retryAfterMs,
    workspacePolicyReadOnly: state.workspacePolicy.readOnly,
    workspacePolicyScopeMatched: state.workspacePolicy.scopeMatched,
    workspaceLockedClaimCount: state.workspacePolicy.lockedClaimIds.length,
    evidenceCount: evidence.length,
    claimCount: state.claims.length,
    unresolvedCount: unresolvedClaims.length,
    permissionBoundedClaimCount: permissionBoundedClaims.length,
    recoveredFromVersion: state.recoveredFromVersion,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    boundaryEventCount: state.boundaryEvents.length,
    recoveryIntentCount: state.recoveryIntents.length,
    recoveryJournalCount: state.recoveryJournal.length,
    recoveredClaimCount: recoveredClaims.length,
    commandReceiptCount: state.commandReceipts.length,
    commandAuditCount: state.commandAudit.length,
    hostedKernelOutboxCount: state.hostedKernelOutbox.length,
    healthRetryQueueCount: state.healthRetryQueue.length,
    nextHealthRetryAt: nextHealthRetry ? nextHealthRetry.nextRetryAt : null,
    providerSyncState: providerServiceContract.syncMetadata.state,
    providerPendingHandoffCount: providerServiceContract.syncMetadata.pendingCount,
    providerBlockedHandoffCount: providerServiceContract.syncMetadata.blockedCount,
    providerFailedHandoffCount: providerServiceContract.syncMetadata.failedCount,
    providerAcknowledgedHandoffCount: providerServiceContract.syncMetadata.acknowledgedCount,
    providerDeliveryReceiptCount: providerServiceContract.syncMetadata.deliveryReceiptCount,
    providerOrphanDeliveryReceiptCount: providerServiceContract.syncMetadata.orphanDeliveryReceiptCount,
    latestProviderReceiptAt: providerServiceContract.syncMetadata.latestProviderReceiptAt,
    providerMissingCapabilityCount: providerServiceContract.missingRequiredCapabilities.length,
    analyticsSnapshotCount: analyticsReporting.history.length,
    proofBacklogCount: analyticsReporting.snapshot.proofBacklogCount,
    hostedKernelPendingCount: analyticsReporting.snapshot.hostedKernelPendingCount,
    healthRetryCommandCount: analyticsReporting.snapshot.healthRetryQueueCount,
    mailchimpClaimCount: analyticsReporting.snapshot.mailchimpClaimCount,
    mailchimpExportReadyCount: analyticsReporting.snapshot.mailchimpExportReadyCount,
    mailchimpCampaignCount: analyticsReporting.snapshot.mailchimpCampaignCount,
    mailchimpAudienceCount: analyticsReporting.snapshot.mailchimpAudienceCount,
    lastCommandReason: lastCommandReceipt ? lastCommandReceipt.reason : null,
    visibleClaimCount: clientRuntime.pageInfo.returned,
    selectedClaimId: clientRuntime.selection ? clientRuntime.selection.claimId : null,
    recoveredClaimIds: recoveredClaims.map((claim) => claim.id),
    proofOutputCount: proofOutputs.length,
    previewAcceptanceReady: clientRuntime.previewAcceptance.ready,
    previewSuggestedAction: clientRuntime.previewAcceptance.suggestedAction,
    previewBlockingFindingCount: clientRuntime.previewAcceptance.validationSummary.counts.blocking,
    workflowHandoffQueueCount: workflowHandoffQueue.summary.total,
    workflowHandoffRequiresOperatorAction: workflowHandoffQueue.summary.requiresOperatorAction,
    workflowHandoffProviderAttentionCount: workflowHandoffQueue.summary.providerAttentionCount,
    workflowHandoffRetryReadyCount: workflowHandoffQueue.summary.retryReadyCount,
    workflowHandoffProofBacklogCount: workflowHandoffQueue.summary.proofBacklogCount
  };
  const workflowHandoff = {
    destination: 'hosted-kernel.audit.claim-browser',
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    principalId: principal.id,
    commandId: commandResult ? stableText(asRecord(input.command).commandId, stableText(asRecord(input.command).id, null)) : null,
    correlationId: clientRequest.correlationId,
    commandBoundaryDecision: commandResult ? commandResult.boundaryDecision : null,
    selectedClaimId: clientRuntime.selection ? clientRuntime.selection.claimId : null,
    policyDenialReason: clientRuntime.selection ? clientRuntime.selection.policyDenialReason : null,
    permissionDenialReason: clientRuntime.selection ? clientRuntime.selection.permissionDenialReason : null,
    policyEscalationRoute: state.workspacePolicy.escalationRoute,
    healthEscalationRoute: state.operationalHealth.escalationRoute,
    healthActionableErrors: state.operationalHealth.actionableErrors,
    operationalHealthDecision,
    retryPolicy: state.operationalHealth.retryPolicy,
    healthRetryQueue: state.healthRetryQueue,
    nextHealthRetry,
    providerServiceContract: {
      providerId: providerServiceContract.providerId,
      serviceId: providerServiceContract.serviceId,
      endpoint: providerServiceContract.endpoint,
      protocol: providerServiceContract.protocol,
      externallyWritable: providerServiceContract.externallyWritable,
      negotiatedCapabilities: providerServiceContract.negotiatedCapabilities,
      missingRequiredCapabilities: providerServiceContract.missingRequiredCapabilities,
      syncMetadata: providerServiceContract.syncMetadata,
      deliveryReceiptCount: providerServiceContract.deliveryReceipts.length,
      orphanDeliveryReceiptCount: providerServiceContract.orphanDeliveryReceipts.length,
      latestProviderReceiptAt: providerServiceContract.syncMetadata.latestProviderReceiptAt
    },
    externalHandoffState: providerServiceContract.externalHandoff.find((entry) => entry.commandId === (commandResult && commandResult.receipt ? commandResult.receipt.commandId : null)) || null,
    nextActions: clientRuntime.selection ? clientRuntime.selection.nextActions : [],
    nextActionState: clientRuntime.selection ? clientRuntime.selection.nextActionState : null,
    previewAcceptance: clientRuntime.previewAcceptance,
    workflowHandoffQueue,
    lifecycleControlState,
    route: clientRuntime.selection
      ? `claim-browser://${state.tenantId}/${state.workspaceId}/claims/${clientRuntime.selection.claimId}`
      : `claim-browser://${state.tenantId}/${state.workspaceId}/claims`,
    requiresOperatorAction: workflowHandoffQueue.summary.requiresOperatorAction
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel claim browser state persistence and recovery contract',
    dataContract: {
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      commandActions: COMMAND_ACTIONS,
      roles: [...OPERATOR_ROLES],
      roleActions: ROLE_ACTIONS,
      statuses: [...KNOWN_STATUS],
      restartStatusMapping: RESTART_SAFE_STATUS,
      scopeFields: ['tenantId', 'workspaceId'],
      workspacePolicy: {
        fields: [
          'tenantId',
          'workspaceId',
          'readOnly',
          'allowedActions',
          'lockedClaimIds',
          'requireTerminalEvidence',
          'terminalEvidenceKinds',
          'escalationRoute'
        ],
        denialReasons: [
          'workspace-policy-out-of-scope',
          'workspace-read-only',
          'workspace-action-denied',
          'claim-locked-by-workspace-policy',
          'terminal-evidence-required'
        ],
        tenantAdminOverrideField: 'policyOverride'
      },
      claimPermissions: {
        acceptedInputs: ['claims[].permissionGrants', 'claims[].operatorGrants'],
        grantLimitPerClaim: CLAIM_PERMISSION_GRANT_LIMIT,
        fields: [
          'id',
          'tenantId',
          'workspaceId',
          'actions',
          'roles',
          'principalIds',
          'expiresAt',
          'reason',
          'proofRef'
        ],
        semantics: 'claims without grants use role and workspace policy checks; claims with grants require a matching action plus role or principal id',
        denialReasons: [
          'claim-permission-grant-required',
          'claim-permission-denied'
        ],
        boundaryEvents: [
          'claim-permission-grant-scope-rejected',
          'claim-permission-denied'
        ]
      },
      operationalHealth: {
        fields: [
          'status',
          'ready',
          'degraded',
          'commandWritesEnabled',
          'readOnlyMode',
          'kernelReachable',
          'proofWriterReachable',
          'commandQueueDepth',
          'consecutiveFailures',
          'lastFailureAt',
          'lastFailureReason',
          'retryPolicy',
          'actionableErrors',
          'lifecycle',
          'escalationRoute'
        ],
        acceptedInputs: ['operationalHealth', 'hostedKernelHealth', 'persistedState.operationalHealth'],
        degradationCodes: [
          'hosted-kernel-unreachable',
          'proof-writer-unavailable',
          'command-writes-disabled',
          'command-queue-backpressure'
        ],
        commandDenialEvent: 'claim-browser-health-command-denied',
        retryBackoff: {
          baseMs: HEALTH_RETRY_BASE_MS,
          maxMs: HEALTH_RETRY_MAX_MS,
          queueDepthWarning: HEALTH_QUEUE_DEPTH_WARN
        },
        commandRetryQueue: {
          acceptedInputs: ['persistedState.healthRetryQueue', 'persistedState.commandRetryQueue'],
          retainedDirectives: HEALTH_COMMAND_RETRY_LIMIT,
          kind: 'claim-browser-command-retry.v1',
          retryableDenialCodes: [...RETRYABLE_HEALTH_DENIAL_CODES],
          directiveFields: [
            'kind',
            'commandId',
            'claimId',
            'action',
            'tenantId',
            'workspaceId',
            'principalId',
            'reason',
            'retryable',
            'attempts',
            'retryAfterMs',
            'nextRetryAt',
            'escalationRoute',
            'route',
            'createdAt',
            'updatedAt'
          ]
        }
      },
      lifecycleSettings: {
        acceptedInputs: ['lifecycleSettings', 'settingsControls', 'persistedState.lifecycleSettings'],
        commandInputs: ['lifecycleCommand'],
        commandActions: LIFECYCLE_COMMAND_ACTIONS,
        commandReceiptFields: [
          'commandId',
          'action',
          'tenantId',
          'workspaceId',
          'accepted',
          'reason',
          'previousMode',
          'effectiveMode',
          'scheduleState',
          'nextReviewAt',
          'recordedAt',
          'principalId'
        ],
        controlStateFields: [
          'canControl',
          'availableControls',
          'blockedReason',
          'currentMode',
          'configuredMode',
          'scheduleState',
          'commandWritesAllowed',
          'denialReason',
          'nextEnableAt',
          'nextDisableAt',
          'nextReviewAt',
          'validationWarnings',
          'lastCommandReceipt',
          'route'
        ],
        modes: [...LIFECYCLE_MODES],
        scheduleStates: [...LIFECYCLE_SCHEDULE_STATES],
        fields: [
          'mode',
          'effectiveMode',
          'enabled',
          'commandWritesAllowed',
          'scheduleState',
          'denialReason',
          'disabledReason',
          'disabledUntil',
          'schedule',
          'nextReviewAt',
          'validationWarnings',
          'updatedBy',
          'updatedAt'
        ],
        scheduleFields: ['startsAt', 'endsAt', 'nextEnableAt', 'nextDisableAt'],
        commandDenialReasons: [
          'claim-browser-disabled',
          'claim-browser-disabled-until',
          'claim-browser-schedule-not-started',
          'claim-browser-schedule-expired',
          'claim-browser-lifecycle-disabled',
          'missing-lifecycle-command-id',
          'unsupported-lifecycle-command-action',
          'lifecycle-command-scope-denied',
          'lifecycle-command-permission-denied',
          'lifecycle-command-principal-out-of-scope',
          'invalid-lifecycle-disabled-until',
          'invalid-lifecycle-schedule-starts-at',
          'invalid-lifecycle-schedule-ends-at',
          'invalid-lifecycle-schedule-window'
        ]
      },
      providerServiceContract: {
        acceptedInputs: [
          'providerServiceContract',
          'hostedKernelProvider',
          'persistedState.providerServiceContract'
        ],
        providerFields: [
          'providerId',
          'serviceId',
          'contractVersion',
          'tenantId',
          'workspaceId',
          'endpoint',
          'protocol',
          'supportedCapabilities',
          'disabledCapabilities',
          'deliveryReceipts',
          'commandAcks',
          'commandFailures',
          'ackedCommandIds',
          'failedCommandIds',
          'cursor',
          'lastSyncedAt'
        ],
        requiredCapabilities: PROVIDER_REQUIRED_CAPABILITIES,
        optionalCapabilities: PROVIDER_OPTIONAL_CAPABILITIES,
        negotiatedFields: [
          'supportedCapabilities',
          'disabledCapabilities',
          'negotiatedCapabilities',
          'missingRequiredCapabilities',
          'externallyWritable'
        ],
        syncStates: [...PROVIDER_SYNC_STATES],
        handoffStates: PROVIDER_HANDOFF_STATES,
        deliveryStates: PROVIDER_DELIVERY_STATES,
        syncMetadataFields: [
          'state',
          'cursor',
          'lastSyncedAt',
          'nextSyncAt',
          'pendingCount',
          'blockedCount',
          'failedCount',
          'acknowledgedCount',
          'outboxCount',
          'deliveryReceiptCount',
          'orphanDeliveryReceiptCount',
          'latestProviderReceiptAt'
        ],
        deliveryReceiptFields: [
          'kind',
          'commandId',
          'state',
          'providerCommandId',
          'providerRevision',
          'sentAt',
          'acknowledgedAt',
          'failedAt',
          'proofRefs',
          'errorCode',
          'errorMessage',
          'retryable',
          'statusCode',
          'cursor',
          'receivedAt'
        ],
        externalHandoffFields: [
          'commandId',
          'claimId',
          'action',
          'emittedAt',
          'deliveryState',
          'effectiveDeliveryState',
          'handoffState',
          'endpoint',
          'route',
          'idempotencyKey',
          'correlationId',
          'requiredCapabilities',
          'missingCapabilities',
          'providerCommandId',
          'providerRevision',
          'providerProofRefs',
          'providerAcknowledgedAt',
          'providerFailedAt',
          'providerErrorCode',
          'providerErrorMessage',
          'providerRetryable',
          'providerStatusCode',
          'blockedReason'
        ],
        retainedDeliveryReceipts: PROVIDER_DELIVERY_RECEIPT_LIMIT
      },
      clientRequest: {
        viewModes: [...CLIENT_VIEW_MODES],
        sortKeys: [...CLIENT_SORT_KEYS],
        filterFields: ['statuses', 'includeTerminal', 'assignee', 'text'],
        selectionField: 'selectedClaimId',
        correlationField: 'correlationId',
        cursorSemantics: 'cursor is the last seen claim id in the sorted filtered result set'
      },
      clientRowFields: [
        'policyDenialReason',
        'healthDenialReason',
        'id',
        'title',
        'status',
        'restartSafeStatus',
        'revision',
        'updatedAt',
        'assignee',
        'proofRefCount',
        'recoverySource',
        'hostedKernelDeliveryState',
        'mailchimp',
        'permissionGrantCount',
        'permissionDenialReason',
        'workflowRef',
        'nextActions',
        'nextActionState'
      ],
      previewAcceptance: {
        acceptedInputs: ['clientRequest.selectedClaimId', 'selectedClaimId'],
        kind: 'claim-browser-preview-acceptance.v1',
        routePattern: 'claim-browser://{tenantId}/{workspaceId}/claims/{claimId}/preview',
        severityLevels: PREVIEW_VALIDATION_SEVERITIES,
        readinessFields: [
          'commandWritesEnabled',
          'principalInScope',
          'workspaceWritable',
          'hasAvailableAction',
          'blockedReason'
        ],
        actionPreviewFields: [
          'action',
          'label',
          'ready',
          'requiresProof',
          'beforeStatus',
          'afterStatus',
          'expectedRevision',
          'nextRevision',
          'validationSummary',
          'commandTemplate'
        ],
        commandTemplateFields: [
          'claimId',
          'action',
          'tenantId',
          'workspaceId',
          'expectedRevision',
          'proofRefs',
          'evidence',
          'correlationId',
          'route',
          'idempotencyKeyHint'
        ],
        validationSummaryFields: ['ready', 'severity', 'counts', 'findings'],
        findingFields: ['severity', 'code', 'message', 'route', 'details'],
        explainableNextStepFields: ['action', 'ready', 'blockedReason', 'afterStatus', 'requiresProof', 'route']
      },
      workflowHandoffQueue: {
        kind: 'claim-browser-workflow-handoff-queue.v1',
        queueLimit: WORKFLOW_HANDOFF_QUEUE_LIMIT,
        acceptedInputs: [
          'clientRequest.selectedClaimId',
          'providerServiceContract.deliveryReceipts',
          'providerServiceContract.commandAcks',
          'providerServiceContract.commandFailures',
          'persistedState.healthRetryQueue',
          'persistedState.hostedKernelOutbox'
        ],
        entryKinds: [
          'selected-command-ready',
          'selected-claim-blocked',
          'provider-command-failed',
          'provider-command-blocked',
          'provider-command-awaiting-ack',
          'health-command-retry-ready',
          'health-command-retry-waiting',
          'terminal-proof-backlog'
        ],
        entryFields: [
          'kind',
          'priority',
          'commandId',
          'claimId',
          'action',
          'reason',
          'title',
          'route',
          'commandTemplate',
          'providerCommandId',
          'providerRetryable',
          'retryAfterMs',
          'nextRetryAt',
          'escalationRoute',
          'generatedAt'
        ],
        summaryFields: [
          'total',
          'requiresOperatorAction',
          'providerAttentionCount',
          'retryReadyCount',
          'proofBacklogCount',
          'selectedBlockedReason'
        ]
      },
      commandReceiptFields: [
        'commandId',
        'claimId',
        'action',
        'tenantId',
        'workspaceId',
        'accepted',
        'reason',
        'appliedRevision',
        'recordedAt',
        'principalId',
        'boundaryDecision'
      ],
      commandAuditFields: [
        'commandId',
        'claimId',
        'action',
        'accepted',
        'reason',
        'principalId',
        'recordedAt',
        'beforeStatus',
        'afterStatus',
        'beforeRevision',
        'afterRevision',
        'attachedProofRefs',
        'operatorNote',
        'boundaryDecision'
      ],
      commandBoundaryDecision: {
        kind: 'claim-browser-command-boundary-decision.v1',
        retainedOn: ['commandReceipts[].boundaryDecision', 'commandAudit[].boundaryDecision', 'audit.handoff.commandBoundaryDecision'],
        checkNames: [
          'hosted-kernel-command-writes-enabled',
          'known-command-action',
          'principal-role-allows-action',
          'claim-exists',
          'tenant-workspace-boundary',
          'workspace-policy',
          'claim-permission-grant',
          'terminal-transition',
          'terminal-proof'
        ],
        fields: [
          'kind',
          'decisionId',
          'commandId',
          'claimId',
          'action',
          'tenantId',
          'workspaceId',
          'principalId',
          'role',
          'accepted',
          'reason',
          'blockingReasons',
          'checks',
          'scope',
          'roleGrant',
          'workspacePolicy',
          'claimPermission',
          'operationalHealth',
          'proof',
          'route',
          'auditRoute',
          'generatedAt'
        ]
      },
      restartRecovery: {
        acceptedInputs: [
          'persistedState.claims',
          'persistedState.commandReceipts',
          'persistedState.commandAudit',
          'persistedState.hostedKernelOutbox',
          'persistedState.recoveryIntents',
          'persistedState.restartRecoveryIntents',
          'persistedState.recoveryJournal'
        ],
        retainedRecoveryIntents: RECOVERY_INTENT_LIMIT,
        retainedRecoveryEvents: RECOVERY_JOURNAL_LIMIT,
        volatileStatusMapping: RESTART_SAFE_STATUS,
        recoveryReasons: [
          'persisted-recovery-intent',
          'applied-newer-command-audit',
          'applied-newer-command-receipt',
          'restart-safe-metadata-conflict',
          'remapped-volatile-status'
        ],
        recoveryIntentFields: [
          'intentId',
          'claimId',
          'tenantId',
          'workspaceId',
          'status',
          'revision',
          'commandId',
          'reason',
          'source',
          'recordedAt'
        ],
        journalFields: [
          'recoveryId',
          'kind',
          'claimId',
          'fromStatus',
          'toStatus',
          'fromRevision',
          'toRevision',
          'reason',
          'commandId',
          'evidenceSource',
          'recoveredAt',
          'restartSafe'
        ],
        boundaryEvent: 'claim-restart-recovered'
      },
      hostedKernelOutbox: {
        acceptedInputs: ['persistedState.hostedKernelOutbox', 'persistedState.commandOutbox'],
        retainedEnvelopes: HOSTED_KERNEL_OUTBOX_LIMIT,
        deliveryStates: ['pending', 'sent', 'acked', 'failed'],
        fields: [
          'kind',
          'surfaceId',
          'commandId',
          'idempotencyKey',
          'tenantId',
          'workspaceId',
          'claimId',
          'action',
          'principalId',
          'role',
          'emittedAt',
          'deliveryState',
          'route',
          'correlationId',
          'proofRequired',
          'proofRefs',
          'transition'
        ],
        transitionFields: ['beforeStatus', 'afterStatus', 'beforeRevision', 'afterRevision']
      },
      analyticsReporting: {
        acceptedInputs: ['persistedState.analyticsHistory'],
        retainedSnapshots: ANALYTICS_HISTORY_LIMIT,
        timelineLimit: REPORT_TIMELINE_LIMIT,
        counterGroups: [
          'claimsByStatus',
          'claimsByAssignee',
          'commandsByAction',
          'denialsByReason',
          'outboxByDeliveryState',
          'boundaryEventsByKind',
          'mailchimpCampaigns',
          'mailchimpAudiences',
          'mailchimpCampaignStatuses'
        ],
        snapshotFields: [
          'kind',
          'surfaceId',
          'tenantId',
          'workspaceId',
          'generatedAt',
          'claimCount',
          'unresolvedCount',
          'terminalCount',
          'acceptedCommandCount',
          'deniedCommandCount',
          'proofBacklogCount',
          'hostedKernelPendingCount',
          'healthRetryQueueCount',
          'mailchimpClaimCount',
          'mailchimpExportReadyCount',
          'mailchimpCampaignCount',
          'mailchimpAudienceCount',
          'mailchimpExportLedgerRecordCount',
          'mailchimpExportLedgerAcceptedCount',
          'mailchimpExportLedgerBlockingCount',
          'healthStatus',
          'restartSafe'
        ],
        exportSummaryFields: [
          'kind',
          'generatedAt',
          'tenantId',
          'workspaceId',
          'correlationId',
          'selectedClaimId',
          'viewMode',
          'visibleClaimCount',
          'totalMatchingClaimCount',
          'snapshot',
          'counters',
          'mailchimp',
          'mailchimpExportLedger',
          'proofBacklogClaimIds',
          'unresolvedClaimIds',
          'pendingHostedKernelCommandIds',
          'healthRetryCommandIds',
          'nextHealthRetryAt',
          'latestCommandReceipt',
          'timelineLimit'
        ],
        timelineEventKinds: [
          'claim-status-snapshot',
          'command-applied',
          'command-recorded',
          'command-receipt-accepted',
          'command-receipt-denied',
          'health-command-retry-scheduled',
          'boundary-event'
        ]
      },
      mailchimpMarketing: {
        claimContextKind: 'claim-browser.mailchimp-claim-context.v1',
        analyticsSummaryKind: 'claim-browser.mailchimp-analytics-summary.v1',
        exportLedgerKind: 'claim-browser.mailchimp-export-ledger-summary.v1',
        acceptedInputs: [
          'claims[].mailchimp',
          'claims[].marketing',
          'claims[].providerContext',
          'claims[].integration',
          'claims[].campaign',
          'claims[].audience',
          'persistedState.mailchimpExportLedger',
          'persistedState.mailchimpExportHistory',
          'persistedState.analytics.mailchimpExportLedger',
          'persistedState.exportSummary.mailchimpExportLedger'
        ],
        claimFields: [
          'enabled',
          'campaignId',
          'audienceId',
          'campaignStatus',
          'templateId',
          'previewUrl',
          'segmentIds',
          'mergeTags',
          'exportLabels',
          'readyForExport'
        ],
        campaignStatuses: MAILCHIMP_CAMPAIGN_STATUSES,
        exportReadiness: 'ready when both campaignId and audienceId are present for a Mailchimp claim'
      },
      proofOutputFields: [
        'kind',
        'surfaceId',
        'tenantId',
        'workspaceId',
        'claimId',
        'status',
        'revision',
        'updatedAt',
        'restartSafeStatus',
        'recoverySource',
        'lastRecoveredCommandId',
        'hostedKernelDeliveryState',
        'mailchimp',
        'proofRefs',
        'permissionGrantCount',
        'evidence',
        'lastAppliedCommandId',
        'commandBoundaryDecision',
        'route'
      ],
      idempotency: {
        keyField: 'commandId',
        alternateKeyFields: ['idempotencyKey', 'clientMutationId'],
        conflictReason: 'command-id-conflict',
        alternateConflictReason: 'command-idempotency-key-conflict',
        replaySource: 'persistedState.commandReceipts',
        alternateReplaySource: 'persistedState.hostedKernelOutbox',
        retainedReceipts: COMMAND_RECEIPT_LIMIT
      }
    },
    status: {
      ready: state.operationalHealth.ready,
      restartSafe: proof.restartSafe,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      operationalHealth: state.operationalHealth,
      providerServiceContract,
      statusCounts,
      activeClaimIds: unresolvedClaims.map((claim) => claim.id),
      mailchimp: analyticsReporting.exportSummary.mailchimp,
      mailchimpExportLedger: analyticsReporting.exportSummary.mailchimpExportLedger,
      mailchimpClaimIds: mailchimpClaims.map((claim) => claim.id),
      mailchimpExportReadyClaimIds: mailchimpExportReadyClaims.map((claim) => claim.id),
      permissionBoundedClaimIds: permissionBoundedClaims.map((claim) => claim.id),
      recoveredClaimIds: recoveredClaims.map((claim) => claim.id),
      selectedClaimId: workflowHandoff.selectedClaimId,
      previewAcceptance: clientRuntime.previewAcceptance,
      workflowHandoffQueue,
      previewAcceptanceReady: clientRuntime.previewAcceptance.ready,
      previewSuggestedAction: clientRuntime.previewAcceptance.suggestedAction,
      visibleClaimCount: clientRuntime.pageInfo.returned,
      requiresOperatorAction: workflowHandoff.requiresOperatorAction,
      workflowHandoffQueue,
      workflowHandoffSummary: workflowHandoffQueue.summary,
      commandReceiptCount: state.commandReceipts.length,
      commandAuditCount: state.commandAudit.length,
      healthRetryQueueCount: state.healthRetryQueue.length,
      nextHealthRetry,
      recoveryIntentCount: state.recoveryIntents.length,
      recoveryJournalCount: state.recoveryJournal.length,
      lifecycleCommandReceiptCount: state.lifecycleCommandReceipts.length,
      hostedKernelOutboxCount: state.hostedKernelOutbox.length,
      analytics: {
        counters: analyticsReporting.counters,
        snapshot: analyticsReporting.snapshot,
        historyCount: analyticsReporting.history.length,
        timelineCount: analyticsReporting.timeline.length,
        exportSummary: analyticsReporting.exportSummary
      },
      lastCommandReceipt,
      lastCommandAuditEntry,
      lastHostedKernelEnvelope,
      workspacePolicy: {
        readOnly: state.workspacePolicy.readOnly,
        allowedActions: state.workspacePolicy.allowedActions,
        lockedClaimCount: state.workspacePolicy.lockedClaimIds.length,
        requireTerminalEvidence: state.workspacePolicy.requireTerminalEvidence,
        escalationRoute: state.workspacePolicy.escalationRoute
      },
      lifecycleSettings: state.lifecycleSettings,
      lifecycleControlState
    },
    principal,
    clientRuntime,
    persistedState,
    commandResult,
    audit: {
      proof,
      proofOutputs,
      analyticsSnapshot: analyticsReporting.snapshot,
      analyticsHistory: analyticsReporting.history,
      exportSummary: analyticsReporting.exportSummary,
      reportTimeline: analyticsReporting.timeline,
      workflowHandoffQueue,
      providerServiceContract,
      providerSyncMetadata: providerServiceContract.syncMetadata,
      providerDeliveryReceipts: providerServiceContract.deliveryReceipts,
      providerOrphanDeliveryReceipts: providerServiceContract.orphanDeliveryReceipts,
      externalHandoff: providerServiceContract.externalHandoff,
      healthRetryQueue: state.healthRetryQueue,
      nextHealthRetry,
      warnings: [...state.warnings, ...providerServiceContract.warnings],
      boundaryEvents: state.boundaryEvents,
      recoveryIntents: state.recoveryIntents,
      recoveryJournal: state.recoveryJournal,
      handoff: workflowHandoff,
      previewAcceptance: clientRuntime.previewAcceptance,
      lifecycleControlState,
      lifecycleCommandReceipts: state.lifecycleCommandReceipts,
      lifecycleCommandAudit: state.lifecycleCommandAudit,
      evidenceRefs: evidence.map((entry) => ({ id: entry.id, kind: entry.kind, digest: entry.digest }))
    },
    evidence
  };
}

export default describeClaimBrowserSurface;
