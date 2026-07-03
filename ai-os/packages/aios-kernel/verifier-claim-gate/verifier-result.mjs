export const surfaceId = "aios_verifier-claim-gate_verifier-result_062";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "verifier-result";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  requireProof: true,
  maxClaimAgeMs: 15 * 60 * 1000,
  staleResultAction: 'request-refresh',
  schedule: Object.freeze({
    mode: 'manual',
    intervalMs: null,
    nextRunAt: null
  })
});

const LIFECYCLE_COMMANDS = new Set([
  'inspect',
  'enable',
  'disable',
  'pause-schedule',
  'resume-schedule',
  'run-now',
  'configure-schedule',
  'update-settings'
]);

const STALE_RESULT_ACTIONS = new Set(['request-refresh', 'hold-claim', 'reject-claim']);
const SCHEDULE_MODES = new Set(['manual', 'interval', 'paused']);
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 15 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const FAILURE_RETRYABLE_ERROR_CODES = new Set([
  'provider-capability-mismatch',
  'provider-contract-mismatch',
  'sync-not-observed',
  'handoff-failed',
  'tenant-boundary-violation',
  'permission-denied',
  'provider-reported-degraded',
  'provider-reported-failed'
]);
const CONTRACT_VERSION = '2026-07-01.verifier-result.v1';
const PERSISTED_STATE_VERSION = '2026-07-01.verifier-result.state.v1';
const ANALYTICS_EXPORT_VERSION = '2026-07-01.verifier-result.analytics.v1';
const ANALYTICS_HISTORY_LIMIT = 12;
const COMMAND_RECEIPT_LIMIT = 20;
const ANALYTICS_SLA_THRESHOLDS_MS = Object.freeze({
  resultFresh: 5 * 60 * 1000,
  syncFresh: 2 * 60 * 1000,
  handoffAttention: 60 * 1000
});
const CLAIM_HANDOFF_STATES = new Set(['none', 'queued', 'dispatched', 'acknowledged', 'failed']);
const WORKFLOW_INTENTS = new Set(['inspect', 'release', 'refresh', 'hold', 'reject', 'repair']);
const RECOVERABLE_HANDOFF_STATES = new Set(['queued', 'dispatched']);
const MUTABLE_SETTING_KEYS = new Set(['enabled', 'requireProof', 'maxClaimAgeMs', 'staleResultAction']);
const CLIENT_PANELS = new Set(['overview', 'proof', 'handoff', 'settings', 'audit']);
const RESULT_TIMESTAMP_FIELDS = Object.freeze(['generatedAt', 'checkedAt', 'observedAt']);
const MAX_RESULT_FUTURE_SKEW_MS = 30 * 1000;
const SECURITY_ROLE_GRANTS = Object.freeze({
  verifier_viewer: Object.freeze(['tenant.workspace.read', 'verifier.result.read']),
  verifier_operator: Object.freeze(['tenant.workspace.read', 'verifier.result.read', 'verifier.proof.read', 'verifier.result.refresh.request']),
  claim_releaser: Object.freeze(['tenant.workspace.read', 'verifier.result.read', 'verifier.proof.read', 'claim.release', 'audit.write']),
  claim_resolver: Object.freeze(['tenant.workspace.read', 'verifier.result.read', 'claim.hold', 'claim.reject', 'audit.write']),
  tenant_admin: Object.freeze([
    'tenant.workspace.read',
    'verifier.result.read',
    'verifier.proof.read',
    'verifier.result.refresh.request',
    'claim.release',
    'claim.hold',
    'claim.reject',
    'audit.write'
  ])
});
const CLIENT_WORKFLOW_STATES = new Set([
  'idle',
  'reviewing',
  'waiting-on-verifier',
  'ready-to-release',
  'handoff-dispatched',
  'blocked',
  'operator-action-required'
]);
const WORKSPACE_SCOPE_STATUSES = new Set(['enforced', 'blocked', 'unscoped']);
const REPORTED_HEALTH_STATES = new Set(['healthy', 'degraded', 'failed', 'recovering', 'unknown']);
const REPORTED_HEALTH_MODES = new Set(['active', 'degraded', 'maintenance', 'read-only', 'operator-required']);
const RELEASE_BLOCKER_MESSAGES = Object.freeze({
  'gate-disabled': 'Verifier claim gate is disabled.',
  'missing-proof': 'A verifier proof is required before this claim can be released.',
  'verifier-result-not-accepted': 'The verifier result has not accepted the claim.',
  'missing-claim-identity': 'The claim needs a stable claimId before a verifier result can authorize release.',
  'verifier-result-unbound': 'The verifier result must identify the claim it verified before release.',
  'verifier-result-claim-mismatch': 'The verifier result is bound to a different claim and cannot release this claim.',
  'missing-result-timestamp': 'The verifier result needs a generatedAt or checkedAt timestamp.',
  'future-verifier-result-timestamp': 'The verifier result timestamp is ahead of the verifier gate clock and must be refreshed.',
  'stale-verifier-result': 'The verifier result is older than the configured maximum age.',
  'missing-claim-gate-evidence': 'Boot completion claims require all claim-gate evidence artifacts before release.'
});
const DEFAULT_BOOT_COMPLETION_EVIDENCE_ARTIFACTS = Object.freeze([
  'verifier-result',
  'claim-binding',
  'verifier-proof',
  'source',
  'owner'
]);
const VERIFIER_GATE_DOMAINS = Object.freeze(['boot', 'run', 'claim']);
const VERIFIER_GATE_STATUSES = new Set(['green', 'red']);
const PROVIDER_CAPABILITIES = Object.freeze({
  resultRead: 'verifier.result.read',
  proofRead: 'verifier.proof.read',
  refreshRequest: 'verifier.result.refresh.request',
  claimRelease: 'claim.release',
  claimHold: 'claim.hold',
  claimReject: 'claim.reject',
  auditWrite: 'audit.write'
});
const WORKFLOW_INTENT_CONTRACTS = Object.freeze({
  inspect: Object.freeze({
    action: 'inspect-verifier-result',
    capability: PROVIDER_CAPABILITIES.resultRead,
    panel: 'overview',
    command: null,
    dispatchCommand: 'inspect'
  }),
  release: Object.freeze({
    action: 'release-claim',
    capability: PROVIDER_CAPABILITIES.claimRelease,
    panel: 'handoff',
    command: null,
    dispatchCommand: 'dispatch-claim-release'
  }),
  refresh: Object.freeze({
    action: 'request-verifier-refresh',
    capability: PROVIDER_CAPABILITIES.refreshRequest,
    panel: 'handoff',
    command: 'run-now',
    dispatchCommand: 'dispatch-verifier-refresh'
  }),
  hold: Object.freeze({
    action: 'hold-claim',
    capability: PROVIDER_CAPABILITIES.claimHold,
    panel: 'handoff',
    command: null,
    dispatchCommand: 'dispatch-claim-hold'
  }),
  reject: Object.freeze({
    action: 'reject-claim',
    capability: PROVIDER_CAPABILITIES.claimReject,
    panel: 'handoff',
    command: null,
    dispatchCommand: 'dispatch-claim-reject'
  }),
  repair: Object.freeze({
    action: 'repair-verifier-handoff',
    capability: PROVIDER_CAPABILITIES.auditWrite,
    panel: 'audit',
    command: null,
    dispatchCommand: 'open-handoff-repair'
  })
});
const HOSTED_KERNEL_SERVICE_CONTRACTS = Object.freeze({
  'verifier-result': Object.freeze({
    serviceContractId: 'hosted-kernel.verifier-result.service.v1',
    canonicalService: 'verifier-result',
    defaultHandoffProtocol: 'kernel-command-envelope',
    supportedHandoffProtocols: Object.freeze(['kernel-command-envelope', 'webhook-command-envelope']),
    requiredCapabilities: Object.freeze([
      PROVIDER_CAPABILITIES.resultRead,
      PROVIDER_CAPABILITIES.auditWrite
    ]),
    syncStaleAfterMs: 5 * 60 * 1000,
    externalHandoffRequired: true
  }),
  'claim-release-gateway': Object.freeze({
    serviceContractId: 'hosted-kernel.claim-release-gateway.service.v1',
    canonicalService: 'claim-release-gateway',
    defaultHandoffProtocol: 'kernel-command-envelope',
    supportedHandoffProtocols: Object.freeze(['kernel-command-envelope']),
    requiredCapabilities: Object.freeze([
      PROVIDER_CAPABILITIES.resultRead,
      PROVIDER_CAPABILITIES.proofRead,
      PROVIDER_CAPABILITIES.claimRelease,
      PROVIDER_CAPABILITIES.auditWrite
    ]),
    syncStaleAfterMs: 2 * 60 * 1000,
    externalHandoffRequired: true
  })
});
const ACTIONABLE_ERROR_CATALOG = Object.freeze({
  'settings-invalid': {
    severity: 'warning',
    owner: 'operator',
    action: 'correct-settings',
    message: 'Verifier-result settings were normalized because one or more values were invalid.'
  },
  'provider-capability-mismatch': {
    severity: 'error',
    owner: 'platform',
    action: 'provision-provider-capabilities',
    message: 'The configured verifier provider cannot satisfy the current gate contract.'
  },
  'provider-contract-mismatch': {
    severity: 'error',
    owner: 'platform',
    action: 'upgrade-provider-contract',
    message: 'The configured verifier provider does not support the hosted-kernel verifier-result service contract.'
  },
  'sync-not-observed': {
    severity: 'warning',
    owner: 'platform',
    action: 'restore-sync-feed',
    message: 'No verifier-result sync checkpoint has been observed for this request.'
  },
  'handoff-failed': {
    severity: 'error',
    owner: 'workflow',
    action: 'repair-handoff',
    message: 'The external verifier-result handoff cannot be dispatched.'
  },
  'release-blocked': {
    severity: 'error',
    owner: 'verifier',
    action: 'resolve-release-blockers',
    message: 'The verifier result does not currently satisfy claim-release criteria.'
  },
  'retry-exhausted': {
    severity: 'critical',
    owner: 'operator',
    action: 'manual-intervention',
    message: 'Automatic verifier-result retries are exhausted for this failure state.'
  },
  'retry-window-active': {
    severity: 'warning',
    owner: 'workflow',
    action: 'wait-for-retry-window',
    message: 'Verifier-result recovery is waiting for the configured retry backoff window.'
  },
  'tenant-boundary-violation': {
    severity: 'critical',
    owner: 'security',
    action: 'restore-tenant-workspace-scope',
    message: 'Verifier-result handoff was blocked because the request crosses a tenant or workspace boundary.'
  },
  'permission-denied': {
    severity: 'error',
    owner: 'security',
    action: 'grant-required-verifier-permissions',
    message: 'The actor does not have the permissions required for this verifier-result decision.'
  },
  'reported-health-invalid': {
    severity: 'warning',
    owner: 'operator',
    action: 'normalize-health-contract',
    message: 'The hosted verifier reported an invalid operational-health contract.'
  },
  'provider-reported-degraded': {
    severity: 'warning',
    owner: 'platform',
    action: 'inspect-provider-health',
    message: 'The hosted verifier reports degraded service for verifier-result decisions.'
  },
  'provider-reported-failed': {
    severity: 'error',
    owner: 'platform',
    action: 'restore-provider-health',
    message: 'The hosted verifier reports failed service for verifier-result decisions.'
  }
});

function stableChecksum(parts) {
  const text = parts
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join('|');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `vrp_${(hash >>> 0).toString(36)}`;
}

function coerceIso(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeVerifierResultTimestamp(verifierResult = {}, nowMs) {
  const candidates = RESULT_TIMESTAMP_FIELDS.map((field) => ({
    field,
    rawValue: verifierResult[field],
    iso: coerceIso(verifierResult[field], null)
  }));
  const selected = candidates.find((candidate) => candidate.iso) || null;
  const observedAtMs = selected ? new Date(selected.iso).getTime() : null;
  const rawAgeMs = Number.isFinite(observedAtMs) ? nowMs - observedAtMs : null;
  const futureSkewMs = rawAgeMs !== null && rawAgeMs < 0 ? Math.abs(rawAgeMs) : 0;
  const futureSkewAllowed = futureSkewMs > 0 && futureSkewMs <= MAX_RESULT_FUTURE_SKEW_MS;
  const futureDated = futureSkewMs > MAX_RESULT_FUTURE_SKEW_MS;
  const resultAgeMs = rawAgeMs === null
    ? null
    : futureSkewAllowed
      ? 0
      : rawAgeMs;

  return {
    version: `${CONTRACT_VERSION}.result-timestamp.v1`,
    status: selected
      ? futureDated
        ? 'future-dated'
        : futureSkewAllowed
          ? 'clock-skew-normalized'
          : 'observed'
      : 'missing',
    selectedField: selected?.field || null,
    observedAt: selected?.iso || null,
    resultAgeMs,
    rawAgeMs,
    futureSkewMs,
    maxFutureSkewMs: MAX_RESULT_FUTURE_SKEW_MS,
    futureSkewAllowed,
    valid: Boolean(selected) && !futureDated,
    missing: !selected,
    futureDated,
    candidates: candidates.map((candidate) => ({
      field: candidate.field,
      present: candidate.rawValue !== undefined && candidate.rawValue !== null && String(candidate.rawValue).trim() !== '',
      valid: Boolean(candidate.iso)
    })),
    auditFingerprint: stableChecksum([
      'verifier-result-timestamp',
      selected?.field,
      selected?.iso,
      resultAgeMs,
      futureDated,
      futureSkewAllowed
    ])
  };
}

function normalizeSchedule(schedule = {}, nowMs) {
  const requestedMode = SCHEDULE_MODES.has(schedule.mode) ? schedule.mode : DEFAULT_SETTINGS.schedule.mode;
  const issues = [];
  let mode = requestedMode;
  let intervalMs = null;

  if (mode === 'interval') {
    const numericInterval = Number(schedule.intervalMs);
    if (!Number.isFinite(numericInterval)) {
      issues.push('schedule.intervalMs is required for interval mode');
      mode = 'manual';
    } else {
      intervalMs = Math.trunc(numericInterval);
      if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
        issues.push(`schedule.intervalMs must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}`);
        mode = 'manual';
        intervalMs = null;
      }
    }
  }

  const explicitNextRunAt = coerceIso(schedule.nextRunAt, null);
  let nextRunAt = mode === 'interval'
    ? explicitNextRunAt || new Date(nowMs + intervalMs).toISOString()
    : null;
  if (mode === 'interval' && nextRunAt && new Date(nextRunAt).getTime() <= nowMs) {
    issues.push('schedule.nextRunAt was in the past and was advanced by one interval');
    nextRunAt = new Date(nowMs + intervalMs).toISOString();
  }

  return {
    value: { mode, intervalMs, nextRunAt },
    issues
  };
}

function resolveScheduleRuntime(settings, nowMs) {
  const schedule = settings.schedule || DEFAULT_SETTINGS.schedule;
  const nextRunMs = schedule.nextRunAt ? new Date(schedule.nextRunAt).getTime() : null;
  const hasRunnableInterval = schedule.mode === 'interval'
    && Number.isFinite(Number(schedule.intervalMs))
    && Number(schedule.intervalMs) >= MIN_INTERVAL_MS;
  const due = Boolean(
    settings.enabled
    && hasRunnableInterval
    && Number.isFinite(nextRunMs)
    && nextRunMs <= nowMs
  );
  const blockedReason = !settings.enabled
    ? 'gate-disabled'
    : schedule.mode === 'paused'
      ? 'schedule-paused'
      : schedule.mode === 'manual'
        ? 'manual-schedule'
        : !hasRunnableInterval
          ? 'missing-interval'
          : null;
  const status = due
    ? 'due'
    : blockedReason
      ? 'blocked'
      : Number.isFinite(nextRunMs)
        ? 'scheduled'
        : 'unscheduled';
  const nextDueAt = hasRunnableInterval && due
    ? new Date(nowMs + Math.trunc(Number(schedule.intervalMs))).toISOString()
    : schedule.nextRunAt || null;

  return {
    status,
    due,
    blockedReason,
    intervalReady: hasRunnableInterval,
    nextDueAt,
    evaluatedAt: new Date(nowMs).toISOString()
  };
}

function buildLifecycleDirective({ lifecycle, replayed, settings, scheduleRuntime, appliedControls, commandIssues }) {
  const mutationApplied = !replayed && appliedControls.length > 0 && commandIssues.length === 0;
  const refreshRequested = !replayed && commandIssues.length === 0 && (lifecycle === 'run-now' || scheduleRuntime.due);
  const commandStatus = replayed
    ? 'duplicate-ignored'
    : commandIssues.length > 0
      ? 'rejected'
      : mutationApplied || lifecycle === 'inspect'
        ? 'applied'
        : 'no-op';
  const schedulerDirective = refreshRequested
    ? 'enqueue-verifier-refresh'
    : scheduleRuntime.status === 'blocked'
      ? 'hold-scheduler'
      : scheduleRuntime.status === 'scheduled'
        ? 'wait-until-next-run'
        : 'manual-only';
  const nextLifecycleAction = settings.enabled
    ? refreshRequested
      ? 'observe-refresh-result'
      : scheduleRuntime.status === 'scheduled'
        ? 'wait-for-scheduled-refresh'
        : 'inspect-verifier-result'
    : 'enable-gate';

  return {
    commandStatus,
    mutationApplied,
    refreshRequested,
    schedulerDirective,
    nextLifecycleAction,
    scheduleStatus: scheduleRuntime.status,
    scheduleBlockedReason: scheduleRuntime.blockedReason,
    dueAt: scheduleRuntime.nextDueAt
  };
}

function normalizeSettings(inputSettings = {}, nowMs) {
  const issues = [];
  const settings = {
    ...DEFAULT_SETTINGS,
    enabled: inputSettings.enabled === undefined ? DEFAULT_SETTINGS.enabled : inputSettings.enabled === true,
    requireProof: inputSettings.requireProof === undefined ? DEFAULT_SETTINGS.requireProof : inputSettings.requireProof === true,
    maxClaimAgeMs: Number.isFinite(Number(inputSettings.maxClaimAgeMs))
      ? Math.trunc(Number(inputSettings.maxClaimAgeMs))
      : DEFAULT_SETTINGS.maxClaimAgeMs,
    staleResultAction: STALE_RESULT_ACTIONS.has(inputSettings.staleResultAction)
      ? inputSettings.staleResultAction
      : DEFAULT_SETTINGS.staleResultAction
  };

  if (settings.maxClaimAgeMs < 1000 || settings.maxClaimAgeMs > 7 * 24 * 60 * 60 * 1000) {
    issues.push('maxClaimAgeMs must be between 1000 and 604800000');
    settings.maxClaimAgeMs = DEFAULT_SETTINGS.maxClaimAgeMs;
  }

  if (inputSettings.staleResultAction !== undefined && !STALE_RESULT_ACTIONS.has(inputSettings.staleResultAction)) {
    issues.push(`staleResultAction must be one of ${Array.from(STALE_RESULT_ACTIONS).join(', ')}`);
  }

  const normalizedSchedule = normalizeSchedule(inputSettings.schedule || {}, nowMs);
  settings.schedule = normalizedSchedule.value;
  issues.push(...normalizedSchedule.issues);

  return { settings, issues };
}

function normalizeMutableSettingsPatch(patch = {}) {
  const issues = [];
  const value = {};
  const ignoredKeys = Object.keys(patch).filter((key) => !MUTABLE_SETTING_KEYS.has(key));

  if (ignoredKeys.length > 0) {
    issues.push(`unsupported mutable setting keys: ${ignoredKeys.join(', ')}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    if (typeof patch.enabled === 'boolean') {
      value.enabled = patch.enabled;
    } else {
      issues.push('enabled must be a boolean when updated by lifecycle command');
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'requireProof')) {
    if (typeof patch.requireProof === 'boolean') {
      value.requireProof = patch.requireProof;
    } else {
      issues.push('requireProof must be a boolean when updated by lifecycle command');
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxClaimAgeMs')) {
    const numericAge = Number(patch.maxClaimAgeMs);
    if (Number.isFinite(numericAge) && numericAge >= 1000 && numericAge <= 7 * 24 * 60 * 60 * 1000) {
      value.maxClaimAgeMs = Math.trunc(numericAge);
    } else {
      issues.push('maxClaimAgeMs lifecycle update must be between 1000 and 604800000');
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'staleResultAction')) {
    if (STALE_RESULT_ACTIONS.has(patch.staleResultAction)) {
      value.staleResultAction = patch.staleResultAction;
    } else {
      issues.push(`staleResultAction lifecycle update must be one of ${Array.from(STALE_RESULT_ACTIONS).join(', ')}`);
    }
  }

  return {
    value,
    issues,
    appliedKeys: Object.keys(value),
    ignoredKeys
  };
}

function normalizeLifecycleControlRequest(input = {}, nowMs) {
  const rawLifecycle = input.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const rawOptions = input.lifecycleOptions && typeof input.lifecycleOptions === 'object'
    ? input.lifecycleOptions
    : input.commandOptions && typeof input.commandOptions === 'object'
      ? input.commandOptions
      : rawLifecycle.options && typeof rawLifecycle.options === 'object'
        ? rawLifecycle.options
        : {};
  const schedulePatch = rawOptions.schedule && typeof rawOptions.schedule === 'object'
    ? rawOptions.schedule
    : rawLifecycle.schedule && typeof rawLifecycle.schedule === 'object'
      ? rawLifecycle.schedule
      : null;
  const settingsPatchSource = rawOptions.settings && typeof rawOptions.settings === 'object'
    ? rawOptions.settings
    : rawLifecycle.settings && typeof rawLifecycle.settings === 'object'
      ? rawLifecycle.settings
      : {};
  const normalizedSchedule = schedulePatch ? normalizeSchedule(schedulePatch, nowMs) : null;
  const normalizedSettingsPatch = normalizeMutableSettingsPatch(settingsPatchSource);
  const requestedCommand = input.lifecycleCommand || input.command || rawLifecycle.command;
  const command = LIFECYCLE_COMMANDS.has(requestedCommand) ? requestedCommand : 'inspect';

  return {
    command,
    requestedCommand: requestedCommand || null,
    schedulePatch: normalizedSchedule?.value || null,
    settingsPatch: normalizedSettingsPatch.value,
    appliedSettingKeys: normalizedSettingsPatch.appliedKeys,
    ignoredSettingKeys: normalizedSettingsPatch.ignoredKeys,
    issues: [
      ...(requestedCommand && !LIFECYCLE_COMMANDS.has(requestedCommand) ? [`unsupported lifecycle command: ${requestedCommand}`] : []),
      ...(schedulePatch ? normalizedSchedule.issues : []),
      ...normalizedSettingsPatch.issues
    ],
    hasSchedulePatch: Boolean(schedulePatch),
    hasSettingsPatch: normalizedSettingsPatch.appliedKeys.length > 0
  };
}

function normalizeProviderContract(provider = {}, settings) {
  const requestedCapabilities = Array.isArray(provider.capabilities)
    ? provider.capabilities.filter((capability) => typeof capability === 'string' && capability.trim() !== '')
    : [];
  const requestedSet = new Set(requestedCapabilities);
  const providerId = typeof provider.providerId === 'string' && provider.providerId.trim() !== ''
    ? provider.providerId.trim()
    : 'hosted-kernel-verifier';
  const requestedService = typeof provider.service === 'string' && provider.service.trim() !== ''
    ? provider.service.trim()
    : 'verifier-result';
  const serviceContract = HOSTED_KERNEL_SERVICE_CONTRACTS[requestedService] || HOSTED_KERNEL_SERVICE_CONTRACTS['verifier-result'];
  const serviceSupported = requestedService === serviceContract.canonicalService;
  const declaredContractVersions = normalizeStringList(
    provider.contractVersions
    || provider.supportedContractVersions
    || (provider.contractVersion ? [provider.contractVersion] : [])
  );
  const supportedContractVersions = declaredContractVersions.length > 0
    ? declaredContractVersions
    : [CONTRACT_VERSION];
  const contractVersionSource = declaredContractVersions.length > 0 ? 'provider-declared' : 'hosted-kernel-default';
  const negotiatedContractVersion = supportedContractVersions.includes(CONTRACT_VERSION) ? CONTRACT_VERSION : null;
  const requestedProtocol = typeof provider.handoffProtocol === 'string' && provider.handoffProtocol.trim() !== ''
    ? provider.handoffProtocol.trim()
    : typeof provider.protocol === 'string' && provider.protocol.trim() !== ''
      ? provider.protocol.trim()
      : serviceContract.defaultHandoffProtocol;
  const handoffProtocolSupported = serviceContract.supportedHandoffProtocols.includes(requestedProtocol);
  const serviceIssues = [];
  if (!serviceSupported) serviceIssues.push(`unsupported provider service: ${requestedService}`);
  if (!negotiatedContractVersion) serviceIssues.push(`unsupported contract version: ${CONTRACT_VERSION}`);
  if (!handoffProtocolSupported) serviceIssues.push(`unsupported handoff protocol: ${requestedProtocol}`);
  const requiredCapabilities = Array.from(new Set([
    ...serviceContract.requiredCapabilities
  ]));
  if (settings.requireProof) requiredCapabilities.push(PROVIDER_CAPABILITIES.proofRead);
  if (settings.staleResultAction === 'request-refresh') requiredCapabilities.push(PROVIDER_CAPABILITIES.refreshRequest);
  if (settings.staleResultAction === 'hold-claim') requiredCapabilities.push(PROVIDER_CAPABILITIES.claimHold);
  if (settings.staleResultAction === 'reject-claim') requiredCapabilities.push(PROVIDER_CAPABILITIES.claimReject);

  const missingCapabilities = Array.from(new Set(requiredCapabilities)).filter((capability) => !requestedSet.has(capability));
  const endpoint = typeof provider.endpoint === 'string' && provider.endpoint.trim() !== ''
    ? provider.endpoint.trim()
    : null;
  const negotiated = missingCapabilities.length === 0 && serviceIssues.length === 0;

  return {
    providerId,
    service: serviceContract.canonicalService,
    requestedService,
    serviceSupported,
    serviceContractId: serviceContract.serviceContractId,
    endpoint,
    contractVersion: CONTRACT_VERSION,
    supportedContractVersions,
    contractVersionSource,
    negotiatedContractVersion,
    requestedCapabilities,
    requiredCapabilities: Array.from(new Set(requiredCapabilities)),
    missingCapabilities,
    handoffProtocol: requestedProtocol,
    supportedHandoffProtocols: [...serviceContract.supportedHandoffProtocols],
    handoffProtocolSupported,
    externalHandoffRequired: serviceContract.externalHandoffRequired,
    syncStaleAfterMs: serviceContract.syncStaleAfterMs,
    contractIssues: serviceIssues,
    negotiated,
    mode: negotiated ? 'active' : serviceIssues.length > 0 ? 'incompatible' : 'degraded'
  };
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())))
    : [];
}

function normalizeClaimBinding(input = {}, verifierResult = {}) {
  const claim = input.claim && typeof input.claim === 'object' ? input.claim : {};
  const resultClaim = verifierResult.claim && typeof verifierResult.claim === 'object'
    ? verifierResult.claim
    : {};
  const expectedClaimId = cleanString(input.claimId)
    || cleanString(claim.claimId)
    || cleanString(claim.id)
    || cleanString(input.subject);
  const resultClaimId = cleanString(verifierResult.claimId)
    || cleanString(verifierResult.targetClaimId)
    || cleanString(verifierResult.subjectClaimId)
    || cleanString(resultClaim.claimId)
    || cleanString(resultClaim.id);
  const expectedSubject = cleanString(input.subject)
    || cleanString(claim.subject)
    || expectedClaimId;
  const resultSubject = cleanString(verifierResult.subject)
    || cleanString(verifierResult.targetSubject)
    || cleanString(resultClaim.subject)
    || resultClaimId;
  const bindingSource = resultClaimId
    ? 'verifier-result-claim-id'
    : resultSubject
      ? 'verifier-result-subject'
      : 'missing';
  const expectedAvailable = Boolean(expectedClaimId);
  const resultBindingAvailable = Boolean(resultClaimId || resultSubject);
  const identityMatches = Boolean(
    expectedAvailable
    && resultClaimId
    && expectedClaimId === resultClaimId
  );
  const subjectMatches = Boolean(
    expectedSubject
    && resultSubject
    && expectedSubject === resultSubject
  );
  const equivalent = identityMatches || (!resultClaimId && subjectMatches);
  const status = !expectedAvailable
    ? 'missing-claim-identity'
    : !resultBindingAvailable
      ? 'unbound'
      : equivalent
        ? 'bound'
        : 'mismatch';
  const blocker = status === 'missing-claim-identity'
    ? 'missing-claim-identity'
    : status === 'unbound'
      ? 'verifier-result-unbound'
      : status === 'mismatch'
        ? 'verifier-result-claim-mismatch'
        : null;

  return {
    version: `${CONTRACT_VERSION}.claim-binding.v1`,
    status,
    bound: status === 'bound',
    expectedClaimId,
    resultClaimId,
    expectedSubject,
    resultSubject,
    bindingSource,
    identityMatches,
    subjectMatches,
    blocker,
    auditFingerprint: stableChecksum([
      'claim-binding',
      expectedClaimId,
      resultClaimId,
      expectedSubject,
      resultSubject,
      status
    ])
  };
}

function normalizePersistedCommandReceipt(receipt = {}, requestContext, index) {
  const idempotencyKey = cleanString(receipt.idempotencyKey);
  const issuedAt = coerceIso(receipt.issuedAt || receipt.appliedAt || receipt.committedAt, null);
  const command = cleanString(receipt.command || receipt.lifecycleCommand) || 'inspect';
  const stateRevision = Number.isFinite(Number(receipt.stateRevision))
    ? Math.max(0, Math.trunc(Number(receipt.stateRevision)))
    : null;
  const durableStatus = cleanString(receipt.durableStatus) || cleanString(receipt.outcome) || 'unknown';
  const receiptId = cleanString(receipt.receiptId) || stableChecksum([
    'command-receipt',
    requestContext.surfaceRoute,
    idempotencyKey,
    command,
    stateRevision,
    index
  ]);

  return {
    receiptId,
    idempotencyKey,
    requestId: cleanString(receipt.requestId),
    correlationId: cleanString(receipt.correlationId),
    command,
    lifecycleCommand: command,
    commandStatus: cleanString(receipt.commandStatus || receipt.status) || 'applied',
    outcome: cleanString(receipt.outcome) || durableStatus,
    durableStatus,
    stateRevision,
    claimId: cleanString(receipt.claimId),
    resultId: cleanString(receipt.resultId),
    handoffId: cleanString(receipt.handoffId),
    handoffState: CLAIM_HANDOFF_STATES.has(receipt.handoffState) ? receipt.handoffState : 'none',
    decision: cleanString(receipt.decision),
    proofToken: cleanString(receipt.proofToken),
    recoveryAction: cleanString(receipt.recoveryAction) || 'none',
    issuedAt,
    checksum: cleanString(receipt.checksum) || stableChecksum([
      receiptId,
      idempotencyKey,
      command,
      durableStatus,
      receipt.claimId,
      receipt.resultId,
      receipt.handoffId,
      issuedAt
    ])
  };
}

function normalizePersistedGateStateSnapshot(snapshot = {}, requestContext, nowIso) {
  const rawDomains = snapshot.domains && typeof snapshot.domains === 'object' ? snapshot.domains : {};
  const fallbackRedDomains = Array.from(new Set([
    ...normalizeStringList(snapshot.redDomains || snapshot.redRequiredDomains),
    ...(VERIFIER_GATE_DOMAINS.includes(snapshot.primaryRedDomain) ? [snapshot.primaryRedDomain] : [])
  ]));
  const fallbackGreenDomains = normalizeStringList(snapshot.greenDomains)
    .filter((domain) => VERIFIER_GATE_DOMAINS.includes(domain));
  const hasDomainSnapshot = Object.keys(rawDomains).length > 0;
  const domains = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const rawDomain = rawDomains[domain] && typeof rawDomains[domain] === 'object' ? rawDomains[domain] : {};
    const status = VERIFIER_GATE_STATUSES.has(rawDomain.status)
      ? rawDomain.status
      : fallbackRedDomains.includes(domain)
        ? 'red'
        : fallbackGreenDomains.includes(domain) || !hasDomainSnapshot
          ? 'green'
          : 'red';
    const redEvidenceCount = Number.isFinite(Number(rawDomain.redEvidenceCount))
      ? Math.max(0, Math.trunc(Number(rawDomain.redEvidenceCount)))
      : 0;
    const greenEvidenceCount = Number.isFinite(Number(rawDomain.greenEvidenceCount))
      ? Math.max(0, Math.trunc(Number(rawDomain.greenEvidenceCount)))
      : 0;

    return [domain, {
      status,
      required: rawDomain.required === true,
      passed: status === 'green',
      primaryBlocker: cleanString(rawDomain.primaryBlocker),
      primaryRemediationAction: cleanString(rawDomain.primaryRemediationAction),
      retryAfterAt: coerceIso(rawDomain.retryAfterAt, null),
      owner: cleanString(rawDomain.owner),
      redEvidenceCount,
      greenEvidenceCount,
      evidenceCount: redEvidenceCount + greenEvidenceCount,
      routePanel: cleanString(rawDomain.routePanel),
      nextAction: cleanString(rawDomain.nextAction),
      nextActionEnabled: rawDomain.nextActionEnabled === true
    }];
  }));
  const redDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].status === 'red');
  const greenDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].status === 'green');
  const requiredDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].required);
  const redRequiredDomains = requiredDomains.filter((domain) => domains[domain].status === 'red');
  const observedAt = coerceIso(snapshot.observedAt || snapshot.generatedAt || snapshot.normalizedAt, nowIso);
  const releaseDecision = cleanString(snapshot.releaseDecision)
    || (redRequiredDomains.length === 0 ? 'release-authorized' : 'release-blocked');

  return {
    version: cleanString(snapshot.version) || `${PERSISTED_STATE_VERSION}.gate-state-snapshot.v1`,
    snapshotId: cleanString(snapshot.snapshotId) || stableChecksum([
      'persisted-gate-state',
      requestContext.surfaceRoute,
      requestContext.correlationId,
      observedAt,
      redDomains.join(',')
    ]),
    observedAt,
    stateRevision: Number.isFinite(Number(snapshot.stateRevision))
      ? Math.max(0, Math.trunc(Number(snapshot.stateRevision)))
      : null,
    claimId: cleanString(snapshot.claimId),
    resultId: cleanString(snapshot.resultId),
    checksum: cleanString(snapshot.checksum),
    gateEvidenceChecksum: cleanString(snapshot.gateEvidenceChecksum),
    gateWorkflowHandoffId: cleanString(snapshot.gateWorkflowHandoffId),
    gateWorkflowState: cleanString(snapshot.gateWorkflowState),
    releaseDecision,
    requiredStatus: redRequiredDomains.length === 0 ? 'green' : 'red',
    status: redDomains.length === 0 ? 'green' : 'red',
    primaryRedDomain: VERIFIER_GATE_DOMAINS.includes(snapshot.primaryRedDomain)
      ? snapshot.primaryRedDomain
      : redRequiredDomains[0] || redDomains[0] || null,
    redDomains,
    greenDomains,
    requiredDomains,
    redRequiredDomains,
    domains,
    restartSafe: {
      recoverable: redDomains.length > 0 || cleanString(snapshot.gateWorkflowState) !== null,
      statusSemantics: redDomains.length > 0
        ? 'restart should resume at the first red verifier gate domain'
        : 'restart may reuse all-green verifier gate evidence until a fresher result arrives',
      nextRecoveryDomain: redRequiredDomains[0] || redDomains[0] || null
    }
  };
}

function normalizeSecurityBoundary(input = {}, requestContext, persistedState, evaluation, providerContract) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const claim = input.claim && typeof input.claim === 'object' ? input.claim : {};
  const verifierResult = input.verifierResult && typeof input.verifierResult === 'object'
    ? input.verifierResult
    : input.result && typeof input.result === 'object'
      ? input.result
      : {};
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const rawScope = input.securityScope && typeof input.securityScope === 'object'
    ? input.securityScope
    : input.tenantScope && typeof input.tenantScope === 'object'
      ? input.tenantScope
      : {};
  const previousScope = persistedState?.securityScope || {};
  const tenantId = cleanString(rawScope.tenantId)
    || cleanString(request.tenantId)
    || cleanString(claim.tenantId)
    || cleanString(verifierResult.tenantId)
    || cleanString(input.tenantId);
  const workspaceId = cleanString(rawScope.workspaceId)
    || cleanString(request.workspaceId)
    || cleanString(claim.workspaceId)
    || cleanString(verifierResult.workspaceId)
    || cleanString(input.workspaceId);
  const claimTenantId = cleanString(claim.tenantId) || cleanString(input.claimTenantId);
  const claimWorkspaceId = cleanString(claim.workspaceId) || cleanString(input.claimWorkspaceId);
  const resultTenantId = cleanString(verifierResult.tenantId) || cleanString(verifierResult.scopeTenantId);
  const resultWorkspaceId = cleanString(verifierResult.workspaceId) || cleanString(verifierResult.scopeWorkspaceId);
  const actorId = cleanString(actor.actorId) || cleanString(actor.id) || cleanString(input.actorId) || 'hosted-kernel';
  const actorTenantId = cleanString(actor.tenantId) || cleanString(rawScope.actorTenantId) || tenantId;
  const actorWorkspaceIds = normalizeStringList(actor.workspaceIds || actor.workspaces || rawScope.actorWorkspaceIds);
  const allowedTenantIds = normalizeStringList(rawScope.allowedTenantIds || actor.tenantIds || actor.tenants);
  const allowedWorkspaceIds = normalizeStringList(rawScope.allowedWorkspaceIds || rawScope.workspaceIds);
  const effectiveWorkspaceIds = Array.from(new Set([...actorWorkspaceIds, ...allowedWorkspaceIds])).sort();
  const roles = normalizeStringList(actor.roles || rawScope.roles);
  const explicitPermissions = normalizeStringList(actor.permissions || rawScope.permissions);
  const rolePermissions = roles.flatMap((role) => SECURITY_ROLE_GRANTS[role] || []);
  const permissions = Array.from(new Set([...explicitPermissions, ...rolePermissions])).sort();
  const scopeIssues = [];

  if (!tenantId) scopeIssues.push('tenantId is required for verifier-result boundary enforcement');
  if (!workspaceId) scopeIssues.push('workspaceId is required for verifier-result boundary enforcement');
  if (actorTenantId && tenantId && actorTenantId !== tenantId) scopeIssues.push('actor tenant does not match request tenant');
  if (allowedTenantIds.length > 0 && tenantId && !allowedTenantIds.includes(tenantId)) {
    scopeIssues.push('request tenant is outside the actor tenant allowlist');
  }
  if (effectiveWorkspaceIds.length > 0 && workspaceId && !effectiveWorkspaceIds.includes(workspaceId)) {
    scopeIssues.push('actor is not scoped to the request workspace');
  }
  if (claimTenantId && tenantId && claimTenantId !== tenantId) {
    scopeIssues.push('claim tenant does not match request tenant');
  }
  if (claimWorkspaceId && workspaceId && claimWorkspaceId !== workspaceId) {
    scopeIssues.push('claim workspace does not match request workspace');
  }
  if (resultTenantId && tenantId && resultTenantId !== tenantId) {
    scopeIssues.push('verifier result tenant does not match request tenant');
  }
  if (resultWorkspaceId && workspaceId && resultWorkspaceId !== workspaceId) {
    scopeIssues.push('verifier result workspace does not match request workspace');
  }
  if (previousScope.tenantId && tenantId && previousScope.tenantId !== tenantId) {
    scopeIssues.push('persisted state tenant does not match request tenant');
  }
  if (previousScope.workspaceId && workspaceId && previousScope.workspaceId !== workspaceId) {
    scopeIssues.push('persisted state workspace does not match request workspace');
  }

  const requiredPermissions = new Set(['tenant.workspace.read', PROVIDER_CAPABILITIES.resultRead]);
  if (evaluation.proof.required) requiredPermissions.add(PROVIDER_CAPABILITIES.proofRead);
  if (evaluation.nextAction === 'release-claim') requiredPermissions.add(PROVIDER_CAPABILITIES.claimRelease);
  if (evaluation.nextAction === 'request-refresh') requiredPermissions.add(PROVIDER_CAPABILITIES.refreshRequest);
  if (evaluation.nextAction === 'hold-claim') requiredPermissions.add(PROVIDER_CAPABILITIES.claimHold);
  if (evaluation.nextAction === 'reject-claim') requiredPermissions.add(PROVIDER_CAPABILITIES.claimReject);
  if (evaluation.nextAction !== 'gate-disabled') requiredPermissions.add(PROVIDER_CAPABILITIES.auditWrite);

  const missingPermissions = Array.from(requiredPermissions)
    .filter((permission) => !permissions.includes(permission) && !providerContract.requestedCapabilities.includes(permission));
  const boundaryOk = scopeIssues.length === 0;
  const permissionOk = missingPermissions.length === 0;
  const scopeHash = stableChecksum([tenantId, workspaceId, actorId, requestContext.correlationId]);
  const workspaceStatus = !tenantId || !workspaceId
    ? 'unscoped'
    : boundaryOk
      ? 'enforced'
      : 'blocked';
  const workspaceDecision = {
    version: `${CONTRACT_VERSION}.workspace-boundary-decision.v1`,
    decisionId: stableChecksum([
      'workspace-boundary',
      requestContext.requestId,
      tenantId,
      workspaceId,
      actorId,
      scopeIssues.join(',')
    ]),
    status: WORKSPACE_SCOPE_STATUSES.has(workspaceStatus) ? workspaceStatus : 'blocked',
    dispatchSafe: workspaceStatus === 'enforced',
    requestScope: {
      tenantId,
      workspaceId,
      surfaceRoute: requestContext.surfaceRoute
    },
    claimScope: {
      tenantId: claimTenantId,
      workspaceId: claimWorkspaceId
    },
    resultScope: {
      tenantId: resultTenantId,
      workspaceId: resultWorkspaceId
    },
    persistedScope: {
      tenantId: cleanString(previousScope.tenantId),
      workspaceId: cleanString(previousScope.workspaceId),
      scopeHash: cleanString(previousScope.scopeHash)
    },
    actorScope: {
      tenantId: actorTenantId,
      workspaceIds: effectiveWorkspaceIds,
      allowedTenantIds
    },
    violations: scopeIssues,
    handoffPolicy: workspaceStatus === 'enforced' ? 'allow-dispatch' : 'block-and-audit'
  };

  return {
    version: `${CONTRACT_VERSION}.tenant-boundary.v1`,
    tenantId,
    workspaceId,
    scopeHash,
    actor: {
      actorId,
      tenantId: actorTenantId,
      workspaceIds: actorWorkspaceIds,
      effectiveWorkspaceIds,
      allowedTenantIds,
      roles,
      permissions
    },
    workspaceDecision,
    requiredPermissions: Array.from(requiredPermissions).sort(),
    missingPermissions,
    boundaryOk,
    permissionOk,
    allowed: boundaryOk && permissionOk,
    issues: scopeIssues,
    blockers: [
      ...(!boundaryOk ? ['tenant-boundary-violation'] : []),
      ...(!permissionOk ? ['permission-denied'] : [])
    ],
    auditSubject: `${tenantId || 'unscoped'}:${workspaceId || 'unscoped'}:${actorId}`,
    auditHandoff: {
      topic: workspaceDecision.dispatchSafe ? 'verifier-result.boundary.enforced' : 'verifier-result.boundary.blocked',
      decisionId: workspaceDecision.decisionId,
      policy: workspaceDecision.handoffPolicy,
      subject: `${tenantId || 'unscoped'}:${workspaceId || 'unscoped'}`,
      actorId,
      violations: workspaceDecision.violations,
      requiredCapability: PROVIDER_CAPABILITIES.auditWrite
    }
  };
}

function normalizeSyncMetadata(sync = {}, nowIso, nowMs) {
  const lastSyncedAt = coerceIso(sync.lastSyncedAt || sync.syncedAt, null);
  const cursor = typeof sync.cursor === 'string' && sync.cursor.trim() !== '' ? sync.cursor.trim() : null;
  const checkpoint = typeof sync.checkpoint === 'string' && sync.checkpoint.trim() !== '' ? sync.checkpoint.trim() : null;
  const lagMs = lastSyncedAt ? Math.max(0, nowMs - new Date(lastSyncedAt).getTime()) : null;
  const sourceRevision = typeof sync.sourceRevision === 'string' && sync.sourceRevision.trim() !== ''
    ? sync.sourceRevision.trim()
    : null;

  return {
    cursor,
    checkpoint,
    sourceRevision,
    lastSyncedAt,
    observedAt: nowIso,
    lagMs,
    status: lastSyncedAt ? 'observed' : 'not-synced'
  };
}

function normalizeRequestContext(input = {}, nowIso) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const rawIntent = request.intent || client.intent || input.intent || input.workflowIntent;
  const workflowIntent = WORKFLOW_INTENTS.has(rawIntent) ? rawIntent : 'inspect';
  const requestId = typeof request.requestId === 'string' && request.requestId.trim() !== ''
    ? request.requestId.trim()
    : typeof input.requestId === 'string' && input.requestId.trim() !== ''
      ? input.requestId.trim()
      : stableChecksum([surfaceId, input.claimId, input.subject, nowIso]);
  const clientSessionId = typeof client.sessionId === 'string' && client.sessionId.trim() !== ''
    ? client.sessionId.trim()
    : typeof request.clientSessionId === 'string' && request.clientSessionId.trim() !== ''
      ? request.clientSessionId.trim()
      : null;
  const correlationId = typeof request.correlationId === 'string' && request.correlationId.trim() !== ''
    ? request.correlationId.trim()
    : requestId;
  const idempotencyKey = typeof request.idempotencyKey === 'string' && request.idempotencyKey.trim() !== ''
    ? request.idempotencyKey.trim()
    : stableChecksum([correlationId, workflowIntent, input.claimId, input.subject]);
  const returnRoute = typeof client.returnRoute === 'string' && client.returnRoute.trim() !== ''
    ? client.returnRoute.trim()
    : typeof request.returnRoute === 'string' && request.returnRoute.trim() !== ''
      ? request.returnRoute.trim()
      : null;
  const surfaceRoute = typeof request.surfaceRoute === 'string' && request.surfaceRoute.trim() !== ''
    ? request.surfaceRoute.trim()
    : `${surfaceGroup}/${surfaceName}`;

  return {
    requestId,
    correlationId,
    idempotencyKey,
    workflowIntent,
    surfaceRoute,
    returnRoute,
    clientSessionId,
    source: typeof request.source === 'string' && request.source.trim() !== '' ? request.source.trim() : 'hosted-kernel-client',
    receivedAt: coerceIso(request.receivedAt, nowIso)
  };
}

function normalizeClientRuntimeState(input = {}, requestContext, nowIso) {
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const rawState = input.clientState && typeof input.clientState === 'object'
    ? input.clientState
    : client.state && typeof client.state === 'object'
      ? client.state
      : {};
  const stateVersion = Number.isFinite(Number(rawState.stateVersion))
    ? Math.max(0, Math.trunc(Number(rawState.stateVersion)))
    : 0;
  const activePanel = CLIENT_PANELS.has(rawState.activePanel)
    ? rawState.activePanel
    : CLIENT_PANELS.has(client.activePanel)
      ? client.activePanel
      : 'overview';
  const workflowState = CLIENT_WORKFLOW_STATES.has(rawState.workflowState)
    ? rawState.workflowState
    : CLIENT_WORKFLOW_STATES.has(client.workflowState)
      ? client.workflowState
      : 'idle';
  const pendingAction = typeof rawState.pendingAction === 'string' && rawState.pendingAction.trim() !== ''
    ? rawState.pendingAction.trim()
    : typeof client.pendingAction === 'string' && client.pendingAction.trim() !== ''
      ? client.pendingAction.trim()
      : null;
  const acknowledgedHandoffId = typeof rawState.acknowledgedHandoffId === 'string' && rawState.acknowledgedHandoffId.trim() !== ''
    ? rawState.acknowledgedHandoffId.trim()
    : typeof client.acknowledgedHandoffId === 'string' && client.acknowledgedHandoffId.trim() !== ''
      ? client.acknowledgedHandoffId.trim()
      : null;
  const acknowledgedReceiptId = typeof rawState.acknowledgedReceiptId === 'string' && rawState.acknowledgedReceiptId.trim() !== ''
    ? rawState.acknowledgedReceiptId.trim()
    : typeof client.acknowledgedReceiptId === 'string' && client.acknowledgedReceiptId.trim() !== ''
      ? client.acknowledgedReceiptId.trim()
      : null;
  const visibleClaimId = typeof rawState.visibleClaimId === 'string' && rawState.visibleClaimId.trim() !== ''
    ? rawState.visibleClaimId.trim()
    : typeof input.claimId === 'string' && input.claimId.trim() !== ''
      ? input.claimId.trim()
      : null;

  return {
    stateVersion,
    workflowState,
    activePanel,
    pendingAction,
    acknowledgedHandoffId,
    acknowledgedReceiptId,
    visibleClaimId,
    route: requestContext.returnRoute || requestContext.surfaceRoute,
    sessionId: requestContext.clientSessionId,
    lastObservedAt: coerceIso(rawState.lastObservedAt || client.lastObservedAt, null),
    observedAt: nowIso
  };
}

function normalizePersistedState(input = {}, requestContext, nowIso) {
  const rawState = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : input.previousState && typeof input.previousState === 'object'
        ? input.previousState
        : {};
  const loaded = Object.keys(rawState).length > 0;
  const stateId = typeof rawState.stateId === 'string' && rawState.stateId.trim() !== ''
    ? rawState.stateId.trim()
    : stableChecksum([surfaceId, requestContext.surfaceRoute, requestContext.correlationId]);
  const stateRevision = Number.isFinite(Number(rawState.stateRevision))
    ? Math.max(0, Math.trunc(Number(rawState.stateRevision)))
    : 0;
  const rawCommands = Array.isArray(rawState.appliedCommands) ? rawState.appliedCommands : [];
  const appliedCommands = rawCommands
    .filter((command) => command && typeof command === 'object')
    .map((command) => ({
      command: typeof command.command === 'string' ? command.command : 'inspect',
      idempotencyKey: typeof command.idempotencyKey === 'string' ? command.idempotencyKey : null,
      requestId: typeof command.requestId === 'string' ? command.requestId : null,
      appliedAt: coerceIso(command.appliedAt, null),
      stateRevision: Number.isFinite(Number(command.stateRevision)) ? Math.trunc(Number(command.stateRevision)) : null
    }))
    .filter((command) => command.idempotencyKey)
    .slice(-20);
  const rawCommandReceipts = Array.isArray(rawState.commandReceipts)
    ? rawState.commandReceipts
    : Array.isArray(rawState.completedCommandReceipts)
      ? rawState.completedCommandReceipts
      : [];
  const commandReceipts = rawCommandReceipts
    .filter((receipt) => receipt && typeof receipt === 'object')
    .map((receipt, index) => normalizePersistedCommandReceipt(receipt, requestContext, index))
    .filter((receipt) => receipt.idempotencyKey)
    .slice(-COMMAND_RECEIPT_LIMIT);
  const replayedReceipt = commandReceipts
    .slice()
    .reverse()
    .find((receipt) => receipt.idempotencyKey === requestContext.idempotencyKey) || null;
  const replayedCommand = replayedReceipt
    ? {
        command: replayedReceipt.command,
        idempotencyKey: replayedReceipt.idempotencyKey,
        requestId: replayedReceipt.requestId,
        appliedAt: replayedReceipt.issuedAt,
        stateRevision: replayedReceipt.stateRevision,
        receiptId: replayedReceipt.receiptId
      }
    : appliedCommands
    .slice()
    .reverse()
    .find((command) => command.idempotencyKey === requestContext.idempotencyKey) || null;
  const lastDecision = rawState.lastDecision && typeof rawState.lastDecision === 'object'
    ? rawState.lastDecision
    : {};
  const pendingHandoff = rawState.pendingHandoff && typeof rawState.pendingHandoff === 'object'
    ? rawState.pendingHandoff
    : {};
  const rawSecurityScope = rawState.securityScope && typeof rawState.securityScope === 'object'
    ? rawState.securityScope
    : {};
  const rawOperationalHealth = rawState.operationalHealth && typeof rawState.operationalHealth === 'object'
    ? rawState.operationalHealth
    : {};
  const rawPersistedFailure = rawOperationalHealth.failureBudget && typeof rawOperationalHealth.failureBudget === 'object'
    ? rawOperationalHealth.failureBudget
    : rawOperationalHealth.failureState && typeof rawOperationalHealth.failureState === 'object'
      ? rawOperationalHealth.failureState
      : rawState.failureState && typeof rawState.failureState === 'object'
        ? rawState.failureState
        : {};
  const rawAnalyticsHistory = Array.isArray(rawState.analyticsHistory)
    ? rawState.analyticsHistory
    : Array.isArray(rawState.historySnapshots)
      ? rawState.historySnapshots
      : [];
  const rawGateStateSnapshot = rawState.gateStateSnapshot && typeof rawState.gateStateSnapshot === 'object'
    ? rawState.gateStateSnapshot
    : rawState.lastGateState && typeof rawState.lastGateState === 'object'
      ? rawState.lastGateState
      : rawState.lastDecision?.gateWorkflowHandoff && typeof rawState.lastDecision.gateWorkflowHandoff === 'object'
        ? {
            gateWorkflowHandoffId: rawState.lastDecision.gateWorkflowHandoff.handoffId,
            gateWorkflowState: rawState.lastDecision.gateWorkflowHandoff.state,
            releaseDecision: rawState.lastDecision.gateWorkflowHandoff.releaseDecision,
            primaryRedDomain: rawState.lastDecision.gateWorkflowHandoff.primaryDomain,
            redRequiredDomains: rawState.lastDecision.gateWorkflowHandoff.redRequiredDomains,
            checksum: rawState.lastDecision.gateWorkflowHandoff.checksum,
            observedAt: rawState.lastDecision.decidedAt
          }
        : {};
  const gateStateSnapshot = Object.keys(rawGateStateSnapshot).length > 0
    ? normalizePersistedGateStateSnapshot(rawGateStateSnapshot, requestContext, nowIso)
    : null;
  const analyticsHistory = rawAnalyticsHistory
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .map((snapshot) => ({
      snapshotId: cleanString(snapshot.snapshotId) || stableChecksum([
        requestContext.surfaceRoute,
        snapshot.requestId,
        snapshot.claimId,
        snapshot.observedAt || snapshot.generatedAt
      ]),
      observedAt: coerceIso(snapshot.observedAt || snapshot.generatedAt, nowIso),
      stateRevision: Number.isFinite(Number(snapshot.stateRevision)) ? Math.trunc(Number(snapshot.stateRevision)) : null,
      requestId: cleanString(snapshot.requestId),
      claimId: cleanString(snapshot.claimId),
      resultId: cleanString(snapshot.resultId),
      claimBindingStatus: cleanString(snapshot.claimBindingStatus),
      claimBindingFingerprint: cleanString(snapshot.claimBindingFingerprint),
      resultTimestampStatus: cleanString(snapshot.resultTimestampStatus),
      resultTimestampFingerprint: cleanString(snapshot.resultTimestampFingerprint),
      decision: cleanString(snapshot.decision),
      accepted: snapshot.accepted === true,
      releaseAuthorized: snapshot.releaseAuthorized === true,
      healthState: cleanString(snapshot.healthState),
      readinessState: cleanString(snapshot.readinessState),
      handoffState: CLAIM_HANDOFF_STATES.has(snapshot.handoffState) ? snapshot.handoffState : 'none',
      workflowState: CLIENT_WORKFLOW_STATES.has(snapshot.workflowState) ? snapshot.workflowState : null,
      blockerCount: Number.isFinite(Number(snapshot.blockerCount)) ? Math.max(0, Math.trunc(Number(snapshot.blockerCount))) : 0,
      primaryErrorCode: cleanString(snapshot.primaryErrorCode),
      retryable: snapshot.retryable === true,
      replayed: snapshot.replayed === true,
      resultAgeMs: Number.isFinite(Number(snapshot.resultAgeMs)) ? Math.max(0, Math.trunc(Number(snapshot.resultAgeMs))) : null,
      providerMode: cleanString(snapshot.providerMode),
      providerService: cleanString(snapshot.providerService),
      serviceContractId: cleanString(snapshot.serviceContractId),
      handoffProtocol: cleanString(snapshot.handoffProtocol),
      workspaceDecisionId: cleanString(snapshot.workspaceDecisionId),
      workspaceBoundaryStatus: cleanString(snapshot.workspaceBoundaryStatus),
      boundaryHandoffPolicy: cleanString(snapshot.boundaryHandoffPolicy),
      syncStatus: cleanString(snapshot.syncStatus),
      syncLagMs: Number.isFinite(Number(snapshot.syncLagMs)) ? Math.max(0, Math.trunc(Number(snapshot.syncLagMs))) : null,
      gateEvidenceStatus: cleanString(snapshot.gateEvidenceStatus),
      greenGateCount: Number.isFinite(Number(snapshot.greenGateCount)) ? Math.max(0, Math.trunc(Number(snapshot.greenGateCount))) : 0,
      redGateCount: Number.isFinite(Number(snapshot.redGateCount)) ? Math.max(0, Math.trunc(Number(snapshot.redGateCount))) : 0,
      bootGateStatus: VERIFIER_GATE_STATUSES.has(snapshot.bootGateStatus) ? snapshot.bootGateStatus : null,
      runGateStatus: VERIFIER_GATE_STATUSES.has(snapshot.runGateStatus) ? snapshot.runGateStatus : null,
      claimGateStatus: VERIFIER_GATE_STATUSES.has(snapshot.claimGateStatus) ? snapshot.claimGateStatus : null,
      bootRedEvidenceCount: Number.isFinite(Number(snapshot.bootRedEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.bootRedEvidenceCount))) : 0,
      runRedEvidenceCount: Number.isFinite(Number(snapshot.runRedEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.runRedEvidenceCount))) : 0,
      claimRedEvidenceCount: Number.isFinite(Number(snapshot.claimRedEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.claimRedEvidenceCount))) : 0,
      bootGreenEvidenceCount: Number.isFinite(Number(snapshot.bootGreenEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.bootGreenEvidenceCount))) : 0,
      runGreenEvidenceCount: Number.isFinite(Number(snapshot.runGreenEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.runGreenEvidenceCount))) : 0,
      claimGreenEvidenceCount: Number.isFinite(Number(snapshot.claimGreenEvidenceCount)) ? Math.max(0, Math.trunc(Number(snapshot.claimGreenEvidenceCount))) : 0,
      primaryRedDomain: VERIFIER_GATE_DOMAINS.includes(snapshot.primaryRedDomain) ? snapshot.primaryRedDomain : null,
      redRequiredDomainCount: Number.isFinite(Number(snapshot.redRequiredDomainCount)) ? Math.max(0, Math.trunc(Number(snapshot.redRequiredDomainCount))) : 0
    }))
    .slice(-ANALYTICS_HISTORY_LIMIT);
  const pendingState = CLAIM_HANDOFF_STATES.has(pendingHandoff.state) ? pendingHandoff.state : 'none';
  const pendingRequestedAt = coerceIso(pendingHandoff.requestedAt, null);
  const pendingAcknowledgedAt = coerceIso(pendingHandoff.acknowledgedAt, null);
  const recoverableHandoff = RECOVERABLE_HANDOFF_STATES.has(pendingState) && !pendingAcknowledgedAt;
  const status = replayedCommand
    ? 'replayed'
    : recoverableHandoff
      ? 'recovering'
      : loaded
        ? 'loaded'
        : 'initialized';
  const recoveryAction = replayedCommand
    ? 'return-previous-command-result'
    : recoverableHandoff
      ? 'resume-pending-handoff'
      : 'none';

  return {
    version: PERSISTED_STATE_VERSION,
    loaded,
    stateId,
    stateRevision,
    status,
    recoveryAction,
    commandReplay: {
      replayed: Boolean(replayedCommand),
      matchedCommand: replayedCommand,
      matchedReceipt: replayedReceipt,
      replaySource: replayedReceipt ? 'command-receipt' : replayedCommand ? 'applied-command' : 'none'
    },
    appliedCommands,
    commandReceipts,
    lastDecision: {
      decision: typeof lastDecision.decision === 'string' ? lastDecision.decision : null,
      accepted: lastDecision.accepted === true,
      resultId: typeof lastDecision.resultId === 'string' ? lastDecision.resultId : null,
      proofToken: typeof lastDecision.proofToken === 'string' ? lastDecision.proofToken : null,
      decidedAt: coerceIso(lastDecision.decidedAt, null)
    },
    pendingHandoff: {
      state: pendingState,
      handoffId: typeof pendingHandoff.handoffId === 'string' && pendingHandoff.handoffId.trim() !== ''
        ? pendingHandoff.handoffId.trim()
        : null,
      target: typeof pendingHandoff.target === 'string' && pendingHandoff.target.trim() !== ''
        ? pendingHandoff.target.trim()
        : null,
      action: typeof pendingHandoff.action === 'string' ? pendingHandoff.action : null,
      serviceContractId: cleanString(pendingHandoff.serviceContractId),
      handoffProtocol: cleanString(pendingHandoff.handoffProtocol),
      requestedAt: pendingRequestedAt,
      acknowledgedAt: pendingAcknowledgedAt
    },
    securityScope: {
      tenantId: cleanString(rawSecurityScope.tenantId),
      workspaceId: cleanString(rawSecurityScope.workspaceId),
      scopeHash: cleanString(rawSecurityScope.scopeHash)
    },
    operationalHealth: {
      state: cleanString(rawOperationalHealth.state),
      mode: cleanString(rawOperationalHealth.mode),
      retryable: rawOperationalHealth.retryable === true,
      retryAfterAt: coerceIso(rawOperationalHealth.retryAfterAt, null),
      attempts: Number.isFinite(Number(rawOperationalHealth.attempts))
        ? Math.max(0, Math.trunc(Number(rawOperationalHealth.attempts)))
        : null,
      primaryErrorCode: cleanString(rawOperationalHealth.primaryErrorCode),
      failureBudget: {
        attempts: Number.isFinite(Number(rawPersistedFailure.attempts))
          ? Math.max(0, Math.trunc(Number(rawPersistedFailure.attempts)))
          : Number.isFinite(Number(rawOperationalHealth.attempts))
            ? Math.max(0, Math.trunc(Number(rawOperationalHealth.attempts)))
            : 0,
        lastFailedAt: coerceIso(rawPersistedFailure.lastFailedAt || rawPersistedFailure.failedAt, null),
        lastRecoveredAt: coerceIso(rawPersistedFailure.lastRecoveredAt, null),
        retryAfterAt: coerceIso(rawPersistedFailure.retryAfterAt || rawOperationalHealth.retryAfterAt, null),
        errorCode: cleanString(rawPersistedFailure.errorCode || rawOperationalHealth.primaryErrorCode),
        fingerprint: cleanString(rawPersistedFailure.fingerprint),
        status: cleanString(rawPersistedFailure.status) || 'none'
      }
    },
    gateStateSnapshot,
    analyticsHistory,
    observedAt: nowIso
  };
}

function resolveExternalHandoff({ input, evaluation, providerContract, syncMetadata, persistedState, securityBoundary, nowIso }) {
  const inputHandoff = input.externalHandoff || input.handoff;
  const rawHandoff = inputHandoff && typeof inputHandoff === 'object'
    ? inputHandoff
    : persistedState?.recoveryAction === 'resume-pending-handoff'
      ? persistedState.pendingHandoff
      : {};
  const previousState = CLAIM_HANDOFF_STATES.has(rawHandoff.state) ? rawHandoff.state : 'none';
  const target = typeof rawHandoff.target === 'string' && rawHandoff.target.trim() !== ''
    ? rawHandoff.target.trim()
    : providerContract.endpoint;
  const handoffId = typeof rawHandoff.handoffId === 'string' && rawHandoff.handoffId.trim() !== ''
    ? rawHandoff.handoffId.trim()
    : null;
  const requestedAt = coerceIso(rawHandoff.requestedAt, evaluation.canReleaseClaim ? nowIso : null);
  const blockers = [];

  if (!providerContract.negotiated) blockers.push('provider-capability-mismatch');
  if (providerContract.contractIssues.length > 0) blockers.push('provider-contract-mismatch');
  blockers.push(...securityBoundary.blockers);
  if (providerContract.externalHandoffRequired && !target && evaluation.nextAction !== 'gate-disabled') blockers.push('missing-handoff-target');
  if (evaluation.reasons.length > 0) blockers.push(...evaluation.reasons);

  let state = 'none';
  if (evaluation.canReleaseClaim) {
    state = providerContract.negotiated && target ? 'queued' : 'failed';
  } else if (evaluation.nextAction === 'request-refresh') {
    state = providerContract.negotiated && target ? 'queued' : 'failed';
  } else if (previousState !== 'none' && previousState !== 'acknowledged') {
    state = blockers.length === 0 ? previousState : 'failed';
  }

  return {
    state,
    previousState,
    handoffId,
    target,
    requestedAt,
    acknowledgedAt: coerceIso(rawHandoff.acknowledgedAt, null),
    providerId: providerContract.providerId,
    service: providerContract.service,
    serviceContractId: providerContract.serviceContractId,
    handoffProtocol: providerContract.handoffProtocol,
    syncCursor: syncMetadata.cursor,
    action: evaluation.nextAction,
    recoverySource: inputHandoff ? 'request' : persistedState?.recoveryAction === 'resume-pending-handoff' ? 'persisted-state' : 'none',
    workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
    workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
    boundaryHandoffPolicy: securityBoundary.workspaceDecision.handoffPolicy,
    blockers: Array.from(new Set(blockers))
  };
}

function normalizeFailureState(input = {}, nowIso, nowMs) {
  const rawFailure = input.failureState && typeof input.failureState === 'object'
    ? input.failureState
    : input.operationalFailure && typeof input.operationalFailure === 'object'
      ? input.operationalFailure
      : {};
  const attempts = Number.isFinite(Number(rawFailure.attempts))
    ? Math.max(0, Math.trunc(Number(rawFailure.attempts)))
    : 0;
  const lastFailedAt = coerceIso(rawFailure.lastFailedAt || rawFailure.failedAt, null);
  const lastFailureAgeMs = lastFailedAt ? Math.max(0, nowMs - new Date(lastFailedAt).getTime()) : null;
  const retryAfterAt = coerceIso(rawFailure.retryAfterAt, null);
  const retryBlockedUntilMs = retryAfterAt ? new Date(retryAfterAt).getTime() : null;
  const retryBlocked = Number.isFinite(retryBlockedUntilMs) && retryBlockedUntilMs > nowMs;

  return {
    attempts,
    lastFailedAt,
    lastFailureAgeMs,
    retryAfterAt: retryBlocked ? new Date(retryBlockedUntilMs).toISOString() : null,
    retryBlocked,
    errorCode: typeof rawFailure.errorCode === 'string' && rawFailure.errorCode.trim() !== ''
      ? rawFailure.errorCode.trim()
      : null,
    message: typeof rawFailure.message === 'string' && rawFailure.message.trim() !== ''
      ? rawFailure.message.trim()
      : null,
    observedAt: nowIso
  };
}

function normalizeReportedOperationalHealth(input = {}, persistedState, nowIso, nowMs) {
  const rawHealth = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.health && typeof input.health === 'object'
      ? input.health
      : input.reportedHealth && typeof input.reportedHealth === 'object'
        ? input.reportedHealth
        : {};
  const rawState = cleanString(rawHealth.state) || cleanString(rawHealth.status) || 'unknown';
  const rawMode = cleanString(rawHealth.mode) || cleanString(rawHealth.serviceMode) || 'active';
  const state = REPORTED_HEALTH_STATES.has(rawState) ? rawState : 'unknown';
  const mode = REPORTED_HEALTH_MODES.has(rawMode) ? rawMode : 'degraded';
  const observedAt = coerceIso(rawHealth.observedAt || rawHealth.checkedAt || rawHealth.generatedAt, null);
  const ageMs = observedAt ? Math.max(0, nowMs - new Date(observedAt).getTime()) : null;
  const retryAfterAt = coerceIso(rawHealth.retryAfterAt, null);
  const retryAfterMs = retryAfterAt ? new Date(retryAfterAt).getTime() : null;
  const issueCodes = normalizeStringList(rawHealth.issueCodes || rawHealth.errors || rawHealth.errorCodes);
  const primaryErrorCode = cleanString(rawHealth.primaryErrorCode || rawHealth.errorCode)
    || issueCodes[0]
    || cleanString(persistedState.operationalHealth.primaryErrorCode);
  const attempts = Number.isFinite(Number(rawHealth.attempts))
    ? Math.max(0, Math.trunc(Number(rawHealth.attempts)))
    : persistedState.operationalHealth.attempts;
  const contractIssues = [];

  if (rawState !== 'unknown' && !REPORTED_HEALTH_STATES.has(rawState)) {
    contractIssues.push(`unsupported operationalHealth.state: ${rawState}`);
  }
  if (rawMode !== 'active' && !REPORTED_HEALTH_MODES.has(rawMode)) {
    contractIssues.push(`unsupported operationalHealth.mode: ${rawMode}`);
  }
  if (observedAt === null && Object.keys(rawHealth).length > 0) {
    contractIssues.push('operationalHealth.observedAt is required when health is reported');
  }
  if (retryAfterAt && Number.isFinite(retryAfterMs) && retryAfterMs <= nowMs && rawHealth.retryable === true) {
    contractIssues.push('operationalHealth.retryAfterAt must be in the future for retryable failures');
  }
  if (attempts !== null && attempts > MAX_RETRY_ATTEMPTS * 2) {
    contractIssues.push(`operationalHealth.attempts exceeds supported retry accounting window: ${MAX_RETRY_ATTEMPTS * 2}`);
  }

  return {
    version: `${CONTRACT_VERSION}.reported-health.v1`,
    present: Object.keys(rawHealth).length > 0,
    state,
    mode,
    observedAt,
    ageMs,
    stale: ageMs !== null && ageMs > ANALYTICS_SLA_THRESHOLDS_MS.syncFresh,
    retryable: rawHealth.retryable === true,
    retryAfterAt,
    attempts,
    primaryErrorCode,
    issueCodes,
    contractIssues,
    valid: contractIssues.length === 0,
    declaredDegraded: state === 'degraded' || state === 'recovering' || mode === 'degraded' || mode === 'maintenance' || mode === 'read-only',
    declaredFailed: state === 'failed' || mode === 'operator-required',
    observedBy: cleanString(rawHealth.observedBy) || 'hosted-kernel-provider',
    normalizedAt: nowIso
  };
}

function advanceFailureBudget({ failureState, persistedFailure, errorCodes, retryable, nowIso, nowMs }) {
  const retryableCodes = errorCodes.filter((code) => FAILURE_RETRYABLE_ERROR_CODES.has(code));
  const primaryRetryableCode = retryableCodes[0] || null;
  const previousAttempts = Number.isFinite(Number(persistedFailure?.attempts))
    ? Math.max(0, Math.trunc(Number(persistedFailure.attempts)))
    : 0;
  const reportedAttempts = Number.isFinite(Number(failureState.attempts))
    ? Math.max(0, Math.trunc(Number(failureState.attempts)))
    : 0;
  const observedAttempts = Math.max(previousAttempts, reportedAttempts);
  const previousRetryAfterAt = coerceIso(persistedFailure?.retryAfterAt || failureState.retryAfterAt, null);
  const previousRetryAfterMs = previousRetryAfterAt ? new Date(previousRetryAfterAt).getTime() : null;
  const retryWindowActive = Number.isFinite(previousRetryAfterMs) && previousRetryAfterMs > nowMs;
  const fingerprint = primaryRetryableCode
    ? stableChecksum([
        primaryRetryableCode,
        errorCodes.join(','),
        failureState.errorCode
      ])
    : null;
  const sameFailure = Boolean(fingerprint && persistedFailure?.fingerprint === fingerprint);

  if (!retryable || !primaryRetryableCode) {
    return {
      status: observedAttempts > 0 ? 'recovered' : 'none',
      attempts: 0,
      previousAttempts: observedAttempts,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      exhausted: false,
      retryWindowActive: false,
      retryAfterAt: null,
      backoffMs: null,
      primaryErrorCode: null,
      fingerprint: null,
      lastFailedAt: failureState.lastFailedAt || persistedFailure?.lastFailedAt || null,
      lastRecoveredAt: errorCodes.length === 0 && observedAttempts > 0 ? nowIso : persistedFailure?.lastRecoveredAt || null,
      resetReason: observedAttempts > 0 ? 'retryable-failure-cleared' : 'no-retryable-failure'
    };
  }

  const nextAttempts = retryWindowActive
    ? observedAttempts
    : sameFailure
      ? observedAttempts + 1
      : Math.max(1, reportedAttempts || 1);
  const exhausted = nextAttempts >= MAX_RETRY_ATTEMPTS;
  const backoffMs = exhausted
    ? null
    : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, nextAttempts - 1)));
  const retryAfterAt = exhausted
    ? null
    : retryWindowActive
      ? previousRetryAfterAt
      : new Date(nowMs + backoffMs).toISOString();

  return {
    status: exhausted ? 'exhausted' : retryWindowActive ? 'backoff-blocked' : 'retry-scheduled',
    attempts: nextAttempts,
    previousAttempts: observedAttempts,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    exhausted,
    retryWindowActive,
    retryAfterAt,
    backoffMs,
    primaryErrorCode: primaryRetryableCode,
    fingerprint,
    lastFailedAt: failureState.lastFailedAt || nowIso,
    lastRecoveredAt: null,
    resetReason: null
  };
}

function buildOperationalRecoveryPlan({ state, actionableErrors, failureBudget, externalHandoff, providerContract, syncMetadata, securityBoundary, evaluation, reportedHealth, nowIso }) {
  const primaryError = actionableErrors[0] || null;
  const autoRetryAllowed = Boolean(
    primaryError
    && failureBudget.status !== 'exhausted'
    && !failureBudget.retryWindowActive
    && providerContract.negotiated
    && securityBoundary.allowed
    && (evaluation.nextAction === 'request-refresh' || externalHandoff.state === 'failed' || reportedHealth.retryable)
  );
  const retryBlockedReason = failureBudget.exhausted
    ? 'retry-exhausted'
    : failureBudget.retryWindowActive
      ? 'retry-window-active'
      : !providerContract.negotiated
        ? 'provider-not-negotiated'
        : !securityBoundary.allowed
          ? 'security-boundary-blocked'
          : primaryError
            ? null
            : 'no-actionable-error';
  const steps = [];

  if (failureBudget.retryWindowActive) {
    steps.push({
      action: 'wait-for-backoff',
      label: 'Wait for verifier-result retry backoff',
      retryAfterAt: failureBudget.retryAfterAt,
      blockingErrorCode: failureBudget.primaryErrorCode
    });
  }
  if (autoRetryAllowed) {
    steps.push({
      action: evaluation.nextAction === 'request-refresh' ? 'enqueue-verifier-refresh' : 'retry-verifier-handoff',
      label: evaluation.nextAction === 'request-refresh'
        ? 'Retry verifier-result refresh'
        : 'Retry verifier-result handoff',
      dispatchCommand: evaluation.nextAction === 'request-refresh'
        ? 'dispatch-verifier-refresh'
        : 'dispatch-verifier-handoff-retry',
      retryAfterAt: failureBudget.retryAfterAt,
      serviceContractId: providerContract.serviceContractId,
      handoffProtocol: providerContract.handoffProtocol
    });
  }
  if (reportedHealth.declaredFailed || failureBudget.exhausted) {
    steps.push({
      action: 'escalate-provider-health',
      label: 'Escalate hosted verifier-result provider health',
      owner: 'platform',
      errorCode: reportedHealth.primaryErrorCode || failureBudget.primaryErrorCode || primaryError?.code || 'provider-reported-failed'
    });
  }
  if (syncMetadata.status !== 'observed') {
    steps.push({
      action: 'restore-sync-feed',
      label: 'Restore verifier-result sync checkpoint',
      owner: 'platform'
    });
  }
  if (!securityBoundary.allowed) {
    steps.push({
      action: 'resolve-security-boundary',
      label: 'Resolve tenant boundary or permission blocker before retry',
      owner: 'security',
      blockers: securityBoundary.blockers
    });
  }

  return {
    version: `${CONTRACT_VERSION}.operational-recovery.v1`,
    state,
    phase: state === 'healthy'
      ? 'none'
      : failureBudget.retryWindowActive
        ? 'backoff'
        : autoRetryAllowed
          ? 'auto-retry-ready'
          : state === 'failed'
            ? 'operator-escalation'
            : 'degraded-monitoring',
    autoRetryAllowed,
    retryBlockedReason,
    nextAttemptAt: autoRetryAllowed ? failureBudget.retryAfterAt || nowIso : failureBudget.retryAfterAt,
    primaryAction: steps[0] || null,
    steps,
    audit: {
      errorCodes: actionableErrors.map((error) => error.code),
      providerId: providerContract.providerId,
      serviceContractId: providerContract.serviceContractId,
      handoffState: externalHandoff.state,
      syncStatus: syncMetadata.status,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId
    }
  };
}

function buildOperationalHealth({ input, evaluation, providerContract, syncMetadata, externalHandoff, validationIssues, persistedState, securityBoundary, nowIso, nowMs }) {
  const failureState = normalizeFailureState(input, nowIso, nowMs);
  const reportedHealth = normalizeReportedOperationalHealth(input, persistedState, nowIso, nowMs);
  const syncFresh = syncMetadata.lagMs !== null && syncMetadata.lagMs <= providerContract.syncStaleAfterMs;
  const healthSignals = {
    settingsValid: validationIssues.length === 0,
    providerNegotiated: providerContract.negotiated,
    providerContractCompatible: providerContract.contractIssues.length === 0,
    syncObserved: syncMetadata.status === 'observed',
    syncFresh,
    handoffHealthy: externalHandoff.state !== 'failed',
    releaseCriteriaSatisfied: evaluation.reasons.length === 0,
    recoveryActive: persistedState.status === 'recovering',
    tenantBoundaryOk: securityBoundary.boundaryOk,
    permissionOk: securityBoundary.permissionOk,
    reportedHealthValid: reportedHealth.valid,
    providerReportedDegraded: reportedHealth.declaredDegraded,
    providerReportedFailed: reportedHealth.declaredFailed
  };
  const errorCodes = [];
  if (!healthSignals.settingsValid) errorCodes.push('settings-invalid');
  if (!healthSignals.providerNegotiated) errorCodes.push('provider-capability-mismatch');
  if (!healthSignals.providerContractCompatible) errorCodes.push('provider-contract-mismatch');
  if (!healthSignals.syncObserved) errorCodes.push('sync-not-observed');
  if (!healthSignals.handoffHealthy) errorCodes.push('handoff-failed');
  if (!healthSignals.releaseCriteriaSatisfied) errorCodes.push('release-blocked');
  if (!healthSignals.tenantBoundaryOk) errorCodes.push('tenant-boundary-violation');
  if (!healthSignals.permissionOk) errorCodes.push('permission-denied');
  if (!healthSignals.reportedHealthValid) errorCodes.push('reported-health-invalid');
  if (healthSignals.providerReportedFailed) errorCodes.push('provider-reported-failed');
  if (!healthSignals.providerReportedFailed && healthSignals.providerReportedDegraded) errorCodes.push('provider-reported-degraded');
  const retryableCandidate = evaluation.nextAction === 'request-refresh'
    || externalHandoff.state === 'failed'
    || persistedState.recoveryAction === 'resume-pending-handoff'
    || reportedHealth.retryable;
  const failureBudget = advanceFailureBudget({
    failureState,
    persistedFailure: persistedState.operationalHealth.failureBudget,
    errorCodes,
    retryable: retryableCandidate,
    nowIso,
    nowMs
  });
  if (failureBudget.retryWindowActive) errorCodes.push('retry-window-active');
  if (failureBudget.exhausted) errorCodes.push('retry-exhausted');

  const actionableErrors = Array.from(new Set(errorCodes)).map((code) => ({
    code,
    ...ACTIONABLE_ERROR_CATALOG[code],
    details: code === 'provider-capability-mismatch'
      ? providerContract.missingCapabilities
      : code === 'provider-contract-mismatch'
        ? providerContract.contractIssues
        : code === 'handoff-failed'
          ? externalHandoff.blockers
          : code === 'release-blocked'
            ? evaluation.reasons
            : code === 'settings-invalid'
              ? validationIssues
              : code === 'tenant-boundary-violation'
                ? securityBoundary.issues
                : code === 'permission-denied'
                  ? securityBoundary.missingPermissions
                  : code === 'retry-window-active' || code === 'retry-exhausted'
                    ? {
                        attempts: failureBudget.attempts,
                        maxAttempts: failureBudget.maxAttempts,
                        retryAfterAt: failureBudget.retryAfterAt,
                        primaryErrorCode: failureBudget.primaryErrorCode
                      }
                    : code === 'reported-health-invalid'
                      ? reportedHealth.contractIssues
                      : code === 'provider-reported-degraded' || code === 'provider-reported-failed'
                        ? {
                            state: reportedHealth.state,
                            mode: reportedHealth.mode,
                            observedAt: reportedHealth.observedAt,
                            issueCodes: reportedHealth.issueCodes,
                            primaryErrorCode: reportedHealth.primaryErrorCode
                          }
                  : []
  }));
  const retryable = retryableCandidate;
  const retryExhausted = failureBudget.exhausted;
  const backoffMs = failureBudget.backoffMs;
  const retryAfterAt = failureBudget.retryAfterAt;
  const degraded = actionableErrors.some((error) => error.severity === 'warning' || error.severity === 'error')
    || persistedState.recoveryAction === 'resume-pending-handoff';
  const state = retryExhausted
    ? 'failed'
    : reportedHealth.declaredFailed || actionableErrors.some((error) => error.severity === 'critical')
      ? 'failed'
      : retryable && failureBudget.retryWindowActive
        ? 'retry-wait'
        : degraded
          ? 'degraded'
          : 'healthy';
  const recoveryPlan = buildOperationalRecoveryPlan({
    state,
    actionableErrors,
    failureBudget,
    externalHandoff,
    providerContract,
    syncMetadata,
    securityBoundary,
    evaluation,
    reportedHealth,
    nowIso
  });

  return {
    state,
    mode: state === 'healthy' ? 'active' : state === 'failed' ? 'operator-required' : 'degraded',
    degraded,
    retryable: retryable && !retryExhausted,
    retry: {
      attempts: failureState.attempts,
      effectiveAttempts: failureBudget.attempts,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      backoffMs,
      retryAfterAt,
      blockedUntilRetryAfter: failureBudget.retryWindowActive,
      exhausted: retryExhausted
    },
    failureBudget,
    failureState,
    reportedHealth,
    recoveryPlan,
    signals: healthSignals,
    actionableErrors,
    primaryError: actionableErrors[0] || null,
    observedAt: nowIso
  };
}

function buildRuntimeDataContract({ requestContext, clientState, preview, evaluation, providerContract, syncMetadata, externalHandoff, acceptance, readiness, persistedState, operationalHealth, lifecycle, lifecycleControls, securityBoundary, requestIntentContract, claimGate = null, gateEvidence = null, gateResultNormalization = null, gateDecisionCards = null, gateWorkflowHandoff = null }) {
  const requiredFields = [
    { path: 'claim.claimId', present: Boolean(preview.claimId) },
    { path: 'verifierResult.resultId', present: Boolean(preview.resultId) },
    { path: 'verifierResult.status', present: preview.status !== 'unknown' },
    { path: 'verifierResult.claimBinding', present: evaluation.claimBinding.bound },
    { path: 'provider.providerId', present: Boolean(providerContract.providerId) },
    { path: 'provider.serviceContractId', present: Boolean(providerContract.serviceContractId) },
    { path: 'provider.negotiatedContractVersion', present: Boolean(providerContract.negotiatedContractVersion) },
    { path: 'provider.handoffProtocol', present: providerContract.handoffProtocolSupported },
    { path: 'request.requestId', present: Boolean(requestContext.requestId) }
  ];
  if (evaluation.proof.required) {
    requiredFields.push({ path: 'proof.proofId', present: Boolean(evaluation.proof.proofId) });
  }
  if (externalHandoff.action === 'release-claim' || externalHandoff.action === 'request-refresh') {
    requiredFields.push({ path: 'handoff.target', present: Boolean(externalHandoff.target) });
  }
  if (evaluation.nextAction !== 'gate-disabled') {
    requiredFields.push(
      { path: 'security.tenantId', present: Boolean(securityBoundary.tenantId) },
      { path: 'security.workspaceId', present: Boolean(securityBoundary.workspaceId) }
    );
  }

  const missingFields = requiredFields
    .filter((field) => !field.present)
    .map((field) => field.path);

  return {
    version: CONTRACT_VERSION,
    request: {
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      idempotencyKey: requestContext.idempotencyKey,
      workflowIntent: requestContext.workflowIntent,
      surfaceRoute: requestContext.surfaceRoute,
      intentAllowed: requestIntentContract.allowed,
      intentAction: requestIntentContract.action,
      intentBlockers: requestIntentContract.blockers
    },
    client: {
      sessionId: clientState.sessionId,
      route: clientState.route,
      activePanel: clientState.activePanel,
      workflowState: clientState.workflowState,
      stateVersion: clientState.stateVersion,
      pendingAction: clientState.pendingAction,
      acknowledgedReceiptId: clientState.acknowledgedReceiptId,
      gateWorkflowHandoffId: gateWorkflowHandoff?.handoffId || null,
      gatePrimaryDomain: gateWorkflowHandoff?.primaryDomain || null
    },
    claim: {
      claimId: preview.claimId,
      subject: preview.subject
    },
    verifierResult: {
      resultId: preview.resultId,
      status: preview.status,
      resultAgeMs: evaluation.resultAgeMs,
      timestamp: {
        version: evaluation.timestamp.version,
        status: evaluation.timestamp.status,
        selectedField: evaluation.timestamp.selectedField,
        observedAt: evaluation.timestamp.observedAt,
        rawAgeMs: evaluation.timestamp.rawAgeMs,
        resultAgeMs: evaluation.timestamp.resultAgeMs,
        futureSkewMs: evaluation.timestamp.futureSkewMs,
        maxFutureSkewMs: evaluation.timestamp.maxFutureSkewMs,
        futureSkewAllowed: evaluation.timestamp.futureSkewAllowed,
        valid: evaluation.timestamp.valid,
        auditFingerprint: evaluation.timestamp.auditFingerprint
      },
      accepted: evaluation.proof.accepted,
      claimBinding: {
        version: evaluation.claimBinding.version,
        status: evaluation.claimBinding.status,
        bound: evaluation.claimBinding.bound,
        expectedClaimId: evaluation.claimBinding.expectedClaimId,
        resultClaimId: evaluation.claimBinding.resultClaimId,
        bindingSource: evaluation.claimBinding.bindingSource,
        blocker: evaluation.claimBinding.blocker,
        auditFingerprint: evaluation.claimBinding.auditFingerprint
      }
    },
    provider: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      requestedService: providerContract.requestedService,
      serviceContractId: providerContract.serviceContractId,
      contractVersion: providerContract.contractVersion,
      supportedContractVersions: providerContract.supportedContractVersions,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      contractVersionSource: providerContract.contractVersionSource,
      negotiated: providerContract.negotiated,
      mode: providerContract.mode,
      requiredCapabilities: providerContract.requiredCapabilities,
      missingCapabilities: providerContract.missingCapabilities,
      handoffProtocol: providerContract.handoffProtocol,
      supportedHandoffProtocols: providerContract.supportedHandoffProtocols,
      contractIssues: providerContract.contractIssues
    },
    proof: {
      required: evaluation.proof.required,
      proofId: evaluation.proof.proofId,
      present: evaluation.proof.present
    },
    claimGate: claimGate ? {
      fileName: claimGate.fileName,
      gateId: claimGate.gateId,
      required: claimGate.required,
      allowed: claimGate.allowed,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      checksum: claimGate.checksum
    } : null,
    decision: {
      accepted: acceptance.accepted,
      nextAction: evaluation.nextAction,
      failedCriteria: acceptance.failedCriteria,
      readinessState: readiness.state,
      claimBindingStatus: evaluation.claimBinding.status,
      gateEvidenceStatus: gateEvidence?.status || null,
      redGateCount: gateEvidence?.summary.red || 0,
      gateWorkflowState: gateWorkflowHandoff?.state || null,
      gateWorkflowBlocked: gateWorkflowHandoff?.blocked || false
    },
    gateEvidence: gateEvidence ? {
      version: gateEvidence.version,
      status: gateEvidence.status,
      checksum: gateEvidence.checksum,
      greenGateCount: gateEvidence.summary.green,
      redGateCount: gateEvidence.summary.red,
      gates: gateEvidence.gates.map((gate) => ({
        gateId: gate.gateId,
        domain: gate.domain,
        status: gate.status,
        passed: gate.passed,
        required: gate.required,
        blockers: gate.blockers,
          evidenceCount: gate.evidence.length
      }))
    } : null,
    normalizedGateResult: gateResultNormalization ? {
      version: gateResultNormalization.version,
      status: gateResultNormalization.status,
      requiredStatus: gateResultNormalization.requiredStatus,
      releaseDecision: gateResultNormalization.releaseDecision,
      checksum: gateResultNormalization.checksum,
      totals: gateResultNormalization.totals,
      domains: gateResultNormalization.domains,
      redEvidenceCount: gateResultNormalization.redEvidence.length,
      greenEvidenceCount: gateResultNormalization.greenEvidence.length
    } : null,
    gateDecisionCards: gateDecisionCards ? {
      version: gateDecisionCards.version,
      state: gateDecisionCards.state,
      headline: gateDecisionCards.headline,
      summary: gateDecisionCards.summary,
      primaryCardId: gateDecisionCards.primaryCardId,
      cards: gateDecisionCards.cards.map((card) => ({
        cardId: card.cardId,
        domain: card.domain,
        title: card.title,
        status: card.status,
        tone: card.tone,
        route: card.route,
        routePanel: card.routePanel,
        required: card.required,
        passed: card.passed,
        primaryBlocker: card.primaryBlocker,
        blockerCount: card.blockerCount,
        evidenceCounts: card.evidenceCounts,
        nextStep: card.nextStep
      }))
    } : null,
    gateWorkflowHandoff: gateWorkflowHandoff ? {
      version: gateWorkflowHandoff.version,
      handoffId: gateWorkflowHandoff.handoffId,
      state: gateWorkflowHandoff.state,
      blocked: gateWorkflowHandoff.blocked,
      primaryDomain: gateWorkflowHandoff.primaryDomain,
      primaryRoute: gateWorkflowHandoff.primaryRoute,
      primaryPanel: gateWorkflowHandoff.primaryPanel,
      primaryAction: gateWorkflowHandoff.primaryAction,
      requiredGreen: gateWorkflowHandoff.requiredGreen,
      redRequiredDomains: gateWorkflowHandoff.redRequiredDomains,
      domainStatuses: gateWorkflowHandoff.domainStatuses,
      dispatchHints: gateWorkflowHandoff.dispatchHints.map((hint) => ({
        domain: hint.domain,
        action: hint.action,
        route: hint.route,
        enabled: hint.enabled,
        blockedReasons: hint.blockedReasons
      })),
      clientStatePatch: gateWorkflowHandoff.clientStatePatch,
      checksum: gateWorkflowHandoff.checksum
    } : null,
    lifecycle: {
      command: lifecycle.lifecycle,
      commandStatus: lifecycle.commandStatus,
      appliedControls: lifecycle.appliedControls,
      refreshRequested: lifecycle.refreshRequested,
      schedulerDirective: lifecycle.schedulerDirective,
      nextLifecycleAction: lifecycle.nextLifecycleAction,
      scheduleStatus: lifecycle.scheduleControl.status,
      commandValid: lifecycle.issues.length === 0,
      commandIssues: lifecycle.issues,
      controls: {
        version: lifecycleControls.version,
        state: lifecycleControls.state,
        primaryAction: lifecycleControls.primaryAction,
        blockedReasons: lifecycleControls.blockedReasons,
        schedule: lifecycleControls.schedule,
        settingsValidation: lifecycleControls.settingsValidation,
        availableControls: lifecycleControls.controls.map((control) => ({
          action: control.action,
          label: control.label,
          lifecycleCommand: control.lifecycleCommand,
          enabled: control.enabled,
          disabledReasons: control.disabledReasons
        }))
      }
    },
    requestIntent: {
      version: requestIntentContract.version,
      requestedIntent: requestIntentContract.requestedIntent,
      action: requestIntentContract.action,
      dispatchCommand: requestIntentContract.dispatchCommand,
      routePanel: requestIntentContract.routePanel,
      allowed: requestIntentContract.allowed,
      blockers: requestIntentContract.blockers,
      requiredCapabilities: requestIntentContract.requiredCapabilities,
      missingProviderCapabilities: requestIntentContract.missingProviderCapabilities,
      missingActorPermissions: requestIntentContract.missingActorPermissions,
      userVisibleState: requestIntentContract.userVisible.state,
      userVisibleLabel: requestIntentContract.userVisible.label,
      auditFingerprint: requestIntentContract.audit.fingerprint
    },
    handoff: {
      state: externalHandoff.state,
      target: externalHandoff.target,
      providerId: externalHandoff.providerId,
      serviceContractId: externalHandoff.serviceContractId,
      handoffProtocol: externalHandoff.handoffProtocol,
      action: externalHandoff.action
    },
    security: {
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      actorId: securityBoundary.actor.actorId,
      allowed: securityBoundary.allowed,
      boundaryOk: securityBoundary.boundaryOk,
      permissionOk: securityBoundary.permissionOk,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceStatus: securityBoundary.workspaceDecision.status,
      dispatchSafe: securityBoundary.workspaceDecision.dispatchSafe,
      handoffPolicy: securityBoundary.workspaceDecision.handoffPolicy,
      requiredPermissions: securityBoundary.requiredPermissions,
      missingPermissions: securityBoundary.missingPermissions,
      blockers: securityBoundary.blockers
    },
    sync: {
      cursor: syncMetadata.cursor,
      checkpoint: syncMetadata.checkpoint,
      sourceRevision: syncMetadata.sourceRevision,
      lagMs: syncMetadata.lagMs,
      staleAfterMs: providerContract.syncStaleAfterMs,
      freshness: syncMetadata.lagMs === null
        ? 'unknown'
        : syncMetadata.lagMs <= providerContract.syncStaleAfterMs
          ? 'fresh'
          : 'stale'
    },
    persistence: {
      version: persistedState.version,
      stateId: persistedState.stateId,
      stateRevision: persistedState.stateRevision,
      loaded: persistedState.loaded,
      status: persistedState.status,
      recoveryAction: persistedState.recoveryAction,
      replayedCommand: persistedState.commandReplay.replayed,
      replaySource: persistedState.commandReplay.replaySource,
      replayReceiptId: persistedState.commandReplay.matchedReceipt?.receiptId || null,
      lastCommandReceiptId: persistedState.commandReceipts.at(-1)?.receiptId || null,
      gateStateSnapshot: persistedState.gateStateSnapshot ? {
        snapshotId: persistedState.gateStateSnapshot.snapshotId,
        observedAt: persistedState.gateStateSnapshot.observedAt,
        status: persistedState.gateStateSnapshot.status,
        requiredStatus: persistedState.gateStateSnapshot.requiredStatus,
        releaseDecision: persistedState.gateStateSnapshot.releaseDecision,
        primaryRedDomain: persistedState.gateStateSnapshot.primaryRedDomain,
        redDomains: persistedState.gateStateSnapshot.redDomains,
        greenDomains: persistedState.gateStateSnapshot.greenDomains,
        redRequiredDomains: persistedState.gateStateSnapshot.redRequiredDomains,
        gateWorkflowState: persistedState.gateStateSnapshot.gateWorkflowState,
        gateWorkflowHandoffId: persistedState.gateStateSnapshot.gateWorkflowHandoffId,
        restartSafe: persistedState.gateStateSnapshot.restartSafe
      } : null
    },
    health: {
      state: operationalHealth.state,
      mode: operationalHealth.mode,
      retryable: operationalHealth.retryable,
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      retryAttempts: operationalHealth.retry.effectiveAttempts,
      failureBudgetStatus: operationalHealth.failureBudget.status,
      primaryError: operationalHealth.primaryError,
      reported: {
        present: operationalHealth.reportedHealth.present,
        state: operationalHealth.reportedHealth.state,
        mode: operationalHealth.reportedHealth.mode,
        valid: operationalHealth.reportedHealth.valid,
        stale: operationalHealth.reportedHealth.stale,
        observedAt: operationalHealth.reportedHealth.observedAt,
        contractIssues: operationalHealth.reportedHealth.contractIssues
      },
      recoveryPlan: {
        phase: operationalHealth.recoveryPlan.phase,
        autoRetryAllowed: operationalHealth.recoveryPlan.autoRetryAllowed,
        retryBlockedReason: operationalHealth.recoveryPlan.retryBlockedReason,
        nextAttemptAt: operationalHealth.recoveryPlan.nextAttemptAt,
        primaryAction: operationalHealth.recoveryPlan.primaryAction
      }
    },
    validation: {
      contractReady: missingFields.length === 0,
      requiredFields,
      missingFields
    }
  };
}

function buildClientWorkflowContinuation({ clientState, requestContext, preview, acceptance, readiness, externalHandoff, workflowHandoff, requestIntentContract, clientNextSteps, proofReceipt, operationalHealth, securityBoundary, gateWorkflowHandoff, nowIso }) {
  const workflowState = operationalHealth.state === 'failed'
    ? 'operator-action-required'
    : acceptance.accepted
      ? externalHandoff.state === 'queued' || externalHandoff.state === 'dispatched'
        ? 'handoff-dispatched'
        : 'ready-to-release'
      : readiness.state === 'needs-refresh' || workflowHandoff.command === 'request-verifier-refresh'
        ? 'waiting-on-verifier'
        : 'blocked';
  const activePanel = workflowState === 'ready-to-release' || workflowState === 'handoff-dispatched'
    ? 'handoff'
    : clientNextSteps.primary.action === 'attach-proof'
      ? 'proof'
      : clientNextSteps.primary.action === 'correct-lifecycle-command'
        ? 'settings'
        : clientState.activePanel === 'audit'
          ? 'audit'
          : 'overview';
  const bannerTone = workflowState === 'ready-to-release'
    ? 'success'
    : workflowState === 'waiting-on-verifier'
      ? 'info'
      : workflowState === 'operator-action-required'
        ? 'critical'
        : 'warning';
  const handoffAckRequired = Boolean(
    workflowHandoff.dispatchable
    && externalHandoff.handoffId
    && clientState.acknowledgedHandoffId !== externalHandoff.handoffId
  );
  const receiptAckRequired = Boolean(
    proofReceipt.receiptId
    && clientState.acknowledgedReceiptId !== proofReceipt.receiptId
    && (proofReceipt.releaseAuthorized || operationalHealth.primaryError)
  );
  const resumeToken = stableChecksum([
    requestContext.clientSessionId,
    requestContext.idempotencyKey,
    proofReceipt.receiptId,
    workflowState,
    activePanel
  ]);
  const routeForPanel = (panel) => {
    const baseRoute = requestContext.returnRoute || requestContext.surfaceRoute || clientState.route;
    const separator = baseRoute.includes('?') ? '&' : '?';
    return panel ? `${baseRoute}${separator}panel=${panel}` : baseRoute;
  };
  const requestedIntentStep = requestIntentContract.requestedIntent !== 'inspect'
    ? {
        action: requestIntentContract.action,
        label: requestIntentContract.userVisible.label,
        command: requestIntentContract.lifecycleCommand,
        capability: requestIntentContract.requiredCapabilities.at(-1) || null,
        routePanel: requestIntentContract.routePanel,
        dispatchCommand: requestIntentContract.dispatchCommand,
        disabledReasons: requestIntentContract.allowed ? [] : requestIntentContract.blockers,
        requestedIntent: requestIntentContract.requestedIntent
      }
    : null;
  const inferredSteps = requestedIntentStep
    ? [
        requestedIntentStep,
        ...clientNextSteps.steps.filter((step) => step.action !== requestedIntentStep.action)
      ]
    : clientNextSteps.steps;
  const instructionSource = inferredSteps.length > 0
    ? inferredSteps
    : [{ action: workflowHandoff.command || 'inspect', label: workflowHandoff.userVisibleLabel || 'Inspect verifier result state' }];
  const workflowInstructions = instructionSource.map((step, index) => {
    const routePanel = step.routePanel || (step.action === 'attach-proof'
      ? 'proof'
      : step.action === 'correct-lifecycle-command' || step.action === 'enable-gate'
        ? 'settings'
        : step.action === 'release-claim' || step.action === 'repair-handoff' || step.action === 'request-refresh' || step.action === 'request-verifier-refresh'
          ? 'handoff'
        : operationalHealth.state === 'failed'
          ? 'audit'
            : activePanel);
    const dispatchCommand = step.dispatchCommand || (step.command
      ? 'apply-lifecycle-command'
      : step.action === 'release-claim'
        ? 'dispatch-claim-release'
        : step.action === 'request-refresh'
          ? 'dispatch-verifier-refresh'
          : step.action);
    const disabledReasons = [
      ...(Array.isArray(step.disabledReasons) ? step.disabledReasons : []),
      ...(step.action === 'release-claim' && !proofReceipt.releaseAuthorized ? ['release-not-authorized'] : []),
      ...(step.action === 'release-claim' && !workflowHandoff.dispatchable ? ['handoff-not-dispatchable'] : []),
      ...((step.action === 'request-refresh' || step.action === 'request-verifier-refresh') && externalHandoff.state === 'failed' ? ['handoff-failed'] : []),
      ...(step.action === 'grant-verifier-permissions' ? securityBoundary.missingPermissions.map((permission) => `missing:${permission}`) : []),
      ...(operationalHealth.retry.retryAfterAt && step.action !== 'wait-for-backoff' ? [`retry-after:${operationalHealth.retry.retryAfterAt}`] : [])
    ];

    return {
      instructionId: stableChecksum([
        requestContext.requestId,
        requestContext.idempotencyKey,
        preview.claimId,
        proofReceipt.receiptId,
        step.action,
        index
      ]),
      order: index + 1,
      action: step.action,
      label: step.label,
      dispatchCommand,
      route: routeForPanel(routePanel),
      routePanel,
      enabled: disabledReasons.length === 0,
      disabledReasons,
      capability: step.capability || null,
      lifecycleCommand: step.command || null,
      retryAfterAt: step.retryAfterAt || operationalHealth.retry.retryAfterAt,
      requestedIntent: step.requestedIntent || null,
      payloadBinding: {
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
        idempotencyKey: requestContext.idempotencyKey,
        claimId: preview.claimId,
        resultId: preview.resultId,
        receiptId: proofReceipt.receiptId,
        handoffId: externalHandoff.handoffId,
        handoffTarget: externalHandoff.target,
        tenantId: workflowHandoff.payload.tenantId,
        workspaceId: workflowHandoff.payload.workspaceId,
        scopeHash: workflowHandoff.payload.scopeHash
      }
    };
  });
  const primaryInstruction = workflowInstructions.find((instruction) => instruction.enabled) || workflowInstructions[0] || null;
  const acknowledgementInstructions = [
    ...(handoffAckRequired ? [{
      instructionId: stableChecksum(['ack-handoff', requestContext.requestId, externalHandoff.handoffId]),
      action: 'acknowledge-handoff',
      label: 'Acknowledge verifier-result handoff',
      expectedId: externalHandoff.handoffId,
      route: routeForPanel('handoff')
    }] : []),
    ...(receiptAckRequired ? [{
      instructionId: stableChecksum(['ack-receipt', requestContext.requestId, proofReceipt.receiptId]),
      action: 'acknowledge-proof-receipt',
      label: 'Acknowledge verifier-result proof receipt',
      expectedId: proofReceipt.receiptId,
      route: routeForPanel(proofReceipt.releaseAuthorized ? 'handoff' : 'audit')
    }] : [])
  ];

  return {
    version: `${CONTRACT_VERSION}.client-workflow.v1`,
    stateId: stableChecksum([requestContext.requestId, clientState.sessionId, preview.claimId, proofReceipt.receiptId]),
    stateVersion: clientState.stateVersion + 1,
    resumeToken,
    route: clientState.route,
    workflowState,
    activePanel,
    userVisible: {
      state: workflowHandoff.userVisibleState,
      label: workflowHandoff.userVisibleLabel,
      bannerTone,
      primaryAction: primaryInstruction?.action || clientNextSteps.primary.action,
      primaryLabel: primaryInstruction?.label || clientNextSteps.primary.label,
      primaryRoute: primaryInstruction?.route || routeForPanel(activePanel)
    },
    acknowledgement: {
      handoffAckRequired,
      receiptAckRequired,
      acknowledgedHandoffId: clientState.acknowledgedHandoffId,
      acknowledgedReceiptId: clientState.acknowledgedReceiptId,
      expectedHandoffId: externalHandoff.handoffId,
      expectedReceiptId: proofReceipt.receiptId,
      instructions: acknowledgementInstructions
    },
    statePatch: {
      workflowState,
      activePanel,
      pendingAction: workflowHandoff.dispatchable ? workflowHandoff.command : primaryInstruction?.action || clientNextSteps.primary.action,
      visibleClaimId: preview.claimId,
      lastReceiptId: proofReceipt.receiptId,
      lastHandoffId: externalHandoff.handoffId,
      requestedWorkflowIntent: requestIntentContract.requestedIntent,
      requestedIntentAllowed: requestIntentContract.allowed,
      requestedIntentFingerprint: requestIntentContract.audit.fingerprint,
      lastObservedAt: nowIso,
      stateVersion: clientState.stateVersion + 1,
      ...gateWorkflowHandoff.clientStatePatch
    },
    requestIntent: {
      requestedIntent: requestIntentContract.requestedIntent,
      action: requestIntentContract.action,
      allowed: requestIntentContract.allowed,
      blockers: requestIntentContract.blockers,
      missingActorPermissions: requestIntentContract.missingActorPermissions,
      missingProviderCapabilities: requestIntentContract.missingProviderCapabilities,
      route: requestIntentContract.route,
      routePanel: requestIntentContract.routePanel,
      dispatchCommand: requestIntentContract.dispatchCommand,
      statePatch: requestIntentContract.statePatch,
      auditFingerprint: requestIntentContract.audit.fingerprint
    },
    handoff: {
      lane: workflowHandoff.lane,
      command: workflowHandoff.command,
      dispatchable: workflowHandoff.dispatchable,
      destination: workflowHandoff.destination,
      returnRoute: workflowHandoff.returnRoute,
      instructions: workflowInstructions,
      primaryInstructionId: primaryInstruction?.instructionId || null,
      disabledInstructionCount: workflowInstructions.filter((instruction) => !instruction.enabled).length
    },
    analytics: {
      event: `verifier-result.client.${workflowState}`,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      claimId: preview.claimId,
      receiptId: proofReceipt.receiptId,
      healthState: operationalHealth.state,
      gateWorkflowState: gateWorkflowHandoff.state,
      primaryGateDomain: gateWorkflowHandoff.primaryDomain
    }
  };
}

function buildWorkflowHandoffEnvelope({ requestContext, preview, evaluation, providerContract, externalHandoff, acceptance, clientNextSteps, runtimeContract, operationalHealth, securityBoundary, gateWorkflowHandoff, nowIso }) {
  const blocked = !acceptance.accepted;
  const lane = acceptance.accepted
    ? 'claim-release'
    : evaluation.nextAction === 'request-refresh'
      ? 'verifier-refresh'
      : evaluation.nextAction === 'hold-claim' || evaluation.nextAction === 'reject-claim'
        ? 'claim-resolution'
        : 'operator-remediation';
  const dispatchable = !blocked
    ? providerContract.negotiated && externalHandoff.state === 'queued' && securityBoundary.allowed
    : evaluation.nextAction === 'request-refresh' && providerContract.negotiated && externalHandoff.state === 'queued' && securityBoundary.allowed;
  const command = acceptance.accepted
    ? 'release-claim'
    : evaluation.nextAction === 'request-refresh'
      ? 'request-verifier-refresh'
      : clientNextSteps.primary.action;
  const proofToken = stableChecksum([
    CONTRACT_VERSION,
    requestContext.idempotencyKey,
    preview.claimId,
    preview.resultId,
    evaluation.proof.proofId,
    evaluation.claimBinding.auditFingerprint,
    evaluation.nextAction,
    externalHandoff.state
  ]);

  return {
    lane,
    command,
    dispatchable,
    destination: externalHandoff.target,
    requestedAt: externalHandoff.requestedAt || nowIso,
    returnRoute: requestContext.returnRoute,
    clientSessionId: requestContext.clientSessionId,
    userVisibleState: operationalHealth.state === 'failed'
      ? 'operator-action-required'
      : operationalHealth.state === 'retry-wait'
        ? 'waiting-for-retry-window'
        : acceptance.accepted
      ? 'ready-to-release'
      : runtimeContract.validation.contractReady
        ? 'waiting-on-verifier-workflow'
        : 'needs-client-input',
    userVisibleLabel: operationalHealth.primaryError
      ? operationalHealth.primaryError.message
      : acceptance.accepted
      ? 'Verifier result is ready to release the claim'
      : clientNextSteps.primary.label,
    payload: {
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      idempotencyKey: requestContext.idempotencyKey,
      claimId: preview.claimId,
      resultId: preview.resultId,
      proofId: evaluation.proof.proofId,
      decision: evaluation.nextAction,
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      actorId: securityBoundary.actor.actorId,
      scopeHash: securityBoundary.scopeHash,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
      boundaryHandoffPolicy: securityBoundary.workspaceDecision.handoffPolicy,
      failedCriteria: acceptance.failedCriteria,
      boundaryBlockers: securityBoundary.blockers,
      healthState: operationalHealth.state,
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      providerService: providerContract.service,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      handoffProtocol: providerContract.handoffProtocol,
      gateWorkflowHandoffId: gateWorkflowHandoff.handoffId,
      gateWorkflowState: gateWorkflowHandoff.state,
      gatePrimaryDomain: gateWorkflowHandoff.primaryDomain,
      gateReleaseDecision: gateWorkflowHandoff.releaseDecision,
      gateRedRequiredDomains: gateWorkflowHandoff.redRequiredDomains,
      gateDomainStatuses: gateWorkflowHandoff.domainStatuses
    },
    auditProof: {
      proofToken,
      contractVersion: CONTRACT_VERSION,
      evidence: [
        requestContext.requestId,
        preview.claimId,
        preview.resultId,
        evaluation.proof.proofId,
        evaluation.timestamp.auditFingerprint,
        evaluation.claimBinding.auditFingerprint,
        securityBoundary.scopeHash,
        securityBoundary.workspaceDecision.decisionId,
        gateWorkflowHandoff.checksum
      ].filter(Boolean),
      checksumInputs: [
        'contractVersion',
        'idempotencyKey',
        'claimId',
        'resultId',
        'proofId',
        'timestampFingerprint',
        'claimBindingFingerprint',
        'decision',
        'handoffState',
        'scopeHash',
        'workspaceDecisionId'
      ]
    }
  };
}

function buildPersistedStateUpdate({ persistedState, requestContext, lifecycle, preview, evaluation, acceptance, externalHandoff, workflowHandoff, operationalHealth, securityBoundary, gateEvidence, gateResultNormalization, gateWorkflowHandoff, nowIso }) {
  const replayed = persistedState.commandReplay.replayed;
  const nextRevision = replayed ? persistedState.stateRevision : persistedState.stateRevision + 1;
  const commandRecord = {
    command: lifecycle.lifecycle,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    idempotencyKey: requestContext.idempotencyKey,
    appliedAt: nowIso,
    stateRevision: nextRevision,
    replayed
  };
  const appliedCommands = replayed
    ? persistedState.appliedCommands
    : [...persistedState.appliedCommands, commandRecord].slice(-20);
  const pendingHandoff = RECOVERABLE_HANDOFF_STATES.has(externalHandoff.state)
    ? {
        state: externalHandoff.state,
        handoffId: externalHandoff.handoffId || stableChecksum([
          persistedState.stateId,
          requestContext.idempotencyKey,
          externalHandoff.action,
          externalHandoff.target
        ]),
        target: externalHandoff.target,
        action: externalHandoff.action,
        serviceContractId: externalHandoff.serviceContractId,
        handoffProtocol: externalHandoff.handoffProtocol,
        requestedAt: externalHandoff.requestedAt || nowIso,
        acknowledgedAt: externalHandoff.acknowledgedAt
      }
    : {
        state: externalHandoff.state,
        handoffId: externalHandoff.handoffId,
        target: externalHandoff.target,
        action: externalHandoff.action,
        serviceContractId: externalHandoff.serviceContractId,
        handoffProtocol: externalHandoff.handoffProtocol,
        requestedAt: externalHandoff.requestedAt,
        acknowledgedAt: externalHandoff.acknowledgedAt
      };
  const recoveryStatus = replayed
    ? 'replayed'
    : persistedState.recoveryAction === 'resume-pending-handoff'
      ? 'recovered'
      : 'committed';
  const durableStatus = RECOVERABLE_HANDOFF_STATES.has(pendingHandoff.state) ? 'pending-external-ack' : 'settled';
  const replayedReceipt = persistedState.commandReplay.matchedReceipt;
  const receiptSeed = [
    'command-receipt',
    PERSISTED_STATE_VERSION,
    persistedState.stateId,
    requestContext.idempotencyKey,
    lifecycle.lifecycle,
    nextRevision,
    evaluation.nextAction,
    pendingHandoff.state,
    securityBoundary.scopeHash,
    evaluation.claimBinding.auditFingerprint,
    evaluation.timestamp.auditFingerprint
  ];
  const commandReceipt = replayed && replayedReceipt
    ? {
        ...replayedReceipt,
        commandStatus: 'duplicate-ignored',
        replayed: true,
        replayedAt: nowIso,
        replaySource: 'command-receipt'
      }
    : {
        receiptId: stableChecksum(receiptSeed),
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
        idempotencyKey: requestContext.idempotencyKey,
        command: lifecycle.lifecycle,
        lifecycleCommand: lifecycle.lifecycle,
        commandStatus: replayed ? 'duplicate-ignored' : lifecycle.commandStatus,
        outcome: recoveryStatus,
        durableStatus,
        stateRevision: nextRevision,
        claimId: preview.claimId,
        resultId: preview.resultId,
        decision: evaluation.nextAction,
        accepted: acceptance.accepted,
        releaseAuthorized: acceptance.accepted && operationalHealth.state === 'healthy' && securityBoundary.allowed,
        handoffId: pendingHandoff.handoffId,
        handoffState: pendingHandoff.state,
        proofToken: workflowHandoff.auditProof.proofToken,
        gateWorkflowHandoffId: gateWorkflowHandoff.handoffId,
        gateWorkflowState: gateWorkflowHandoff.state,
        gatePrimaryDomain: gateWorkflowHandoff.primaryDomain,
        gateReleaseDecision: gateWorkflowHandoff.releaseDecision,
        gateWorkflowChecksum: gateWorkflowHandoff.checksum,
        recoveryAction: persistedState.recoveryAction,
        replayed,
        replaySource: persistedState.commandReplay.replaySource,
        issuedAt: nowIso,
        checksum: stableChecksum([
          ...receiptSeed,
          acceptance.accepted,
          operationalHealth.state,
          operationalHealth.primaryError?.code || 'none',
          pendingHandoff.handoffId,
          evaluation.claimBinding.status
        ])
      };
  const commandReceipts = replayed
    ? persistedState.commandReceipts
    : [...persistedState.commandReceipts, commandReceipt].slice(-COMMAND_RECEIPT_LIMIT);
  const gateStateSnapshot = replayed && persistedState.gateStateSnapshot
    ? {
        ...persistedState.gateStateSnapshot,
        replayed: true,
        replayedAt: nowIso,
        restartSafe: {
          ...persistedState.gateStateSnapshot.restartSafe,
          statusSemantics: 'prior persisted verifier gate state returned for duplicate command'
        }
      }
    : buildPersistedGateStateSnapshot({
        requestContext,
        preview,
        gateResultNormalization,
        gateEvidence,
        gateWorkflowHandoff,
        nextRevision,
        nowIso
      });

  return {
    version: persistedState.version,
    stateId: persistedState.stateId,
    stateRevision: nextRevision,
    status: recoveryStatus,
    loadedFromRevision: persistedState.stateRevision,
    commandStatus: replayed ? 'duplicate-ignored' : lifecycle.commandStatus,
    commandRecord,
    appliedCommands,
    commandReceipt,
    commandReceipts,
    lastDecision: {
      decision: evaluation.nextAction,
      accepted: acceptance.accepted,
      claimId: preview.claimId,
      resultId: preview.resultId,
      proofId: evaluation.proof.proofId,
      proofToken: workflowHandoff.auditProof.proofToken,
      claimBinding: {
        status: evaluation.claimBinding.status,
        expectedClaimId: evaluation.claimBinding.expectedClaimId,
        resultClaimId: evaluation.claimBinding.resultClaimId,
        auditFingerprint: evaluation.claimBinding.auditFingerprint
      },
      timestamp: {
        status: evaluation.timestamp.status,
        selectedField: evaluation.timestamp.selectedField,
        observedAt: evaluation.timestamp.observedAt,
        resultAgeMs: evaluation.timestamp.resultAgeMs,
        rawAgeMs: evaluation.timestamp.rawAgeMs,
        auditFingerprint: evaluation.timestamp.auditFingerprint
      },
      decidedAt: nowIso,
      failedCriteria: acceptance.failedCriteria,
      gateWorkflowHandoff: {
        handoffId: gateWorkflowHandoff.handoffId,
        state: gateWorkflowHandoff.state,
        releaseDecision: gateWorkflowHandoff.releaseDecision,
        primaryDomain: gateWorkflowHandoff.primaryDomain,
        primaryAction: gateWorkflowHandoff.primaryAction,
        primaryRoute: gateWorkflowHandoff.primaryRoute,
        requiredGreen: gateWorkflowHandoff.requiredGreen,
        redRequiredDomains: gateWorkflowHandoff.redRequiredDomains,
        checksum: gateWorkflowHandoff.checksum
      }
    },
    pendingHandoff,
    gateStateSnapshot,
    securityScope: {
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      actorId: securityBoundary.actor.actorId,
      allowed: securityBoundary.allowed,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceStatus: securityBoundary.workspaceDecision.status,
      handoffPolicy: securityBoundary.workspaceDecision.handoffPolicy
    },
    restartSafe: {
      idempotencyKey: requestContext.idempotencyKey,
      replayDetected: replayed,
      replaySource: persistedState.commandReplay.replaySource,
      commandReceiptId: commandReceipt.receiptId,
      receiptChecksum: commandReceipt.checksum,
      recoveryAction: persistedState.recoveryAction,
      durableStatus,
      gateStatus: gateStateSnapshot.status,
      gateRequiredStatus: gateStateSnapshot.requiredStatus,
      gatePrimaryRedDomain: gateStateSnapshot.primaryRedDomain,
      gateRecoveryDomain: gateStateSnapshot.restartSafe.nextRecoveryDomain,
      gateSnapshotId: gateStateSnapshot.snapshotId,
      statusSemantics: replayed
        ? 'prior command receipt returned without applying lifecycle mutation'
        : durableStatus === 'pending-external-ack'
          ? 'state committed and external acknowledgement may be resumed after restart'
          : 'state committed with no recoverable external handoff pending'
    },
    lifecycleSettings: {
      enabled: lifecycle.settings.enabled,
      requireProof: lifecycle.settings.requireProof,
      maxClaimAgeMs: lifecycle.settings.maxClaimAgeMs,
      staleResultAction: lifecycle.settings.staleResultAction,
      schedule: {
        mode: lifecycle.settings.schedule.mode,
        intervalMs: lifecycle.settings.schedule.intervalMs,
        nextRunAt: lifecycle.settings.schedule.nextRunAt,
        lastRequestedRunAt: lifecycle.settings.schedule.lastRequestedRunAt || null
      },
      commandStatus: lifecycle.commandStatus,
      schedulerDirective: lifecycle.schedulerDirective,
      nextLifecycleAction: lifecycle.nextLifecycleAction,
      scheduleStatus: lifecycle.scheduleControl.status,
      scheduleBlockedReason: lifecycle.scheduleControl.blockedReason,
      refreshRequested: lifecycle.refreshRequested,
      updatedAt: nowIso
    },
    operationalHealth: {
      state: operationalHealth.state,
      mode: operationalHealth.mode,
      retryable: operationalHealth.retryable,
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      attempts: operationalHealth.retry.effectiveAttempts,
      primaryErrorCode: operationalHealth.primaryError?.code || null,
      reportedHealth: {
        version: operationalHealth.reportedHealth.version,
        present: operationalHealth.reportedHealth.present,
        state: operationalHealth.reportedHealth.state,
        mode: operationalHealth.reportedHealth.mode,
        observedAt: operationalHealth.reportedHealth.observedAt,
        retryable: operationalHealth.reportedHealth.retryable,
        retryAfterAt: operationalHealth.reportedHealth.retryAfterAt,
        attempts: operationalHealth.reportedHealth.attempts,
        primaryErrorCode: operationalHealth.reportedHealth.primaryErrorCode,
        issueCodes: operationalHealth.reportedHealth.issueCodes,
        valid: operationalHealth.reportedHealth.valid,
        contractIssues: operationalHealth.reportedHealth.contractIssues
      },
      recoveryPlan: {
        version: operationalHealth.recoveryPlan.version,
        phase: operationalHealth.recoveryPlan.phase,
        autoRetryAllowed: operationalHealth.recoveryPlan.autoRetryAllowed,
        retryBlockedReason: operationalHealth.recoveryPlan.retryBlockedReason,
        nextAttemptAt: operationalHealth.recoveryPlan.nextAttemptAt,
        primaryAction: operationalHealth.recoveryPlan.primaryAction,
        stepCount: operationalHealth.recoveryPlan.steps.length
      },
      failureBudget: {
        status: operationalHealth.failureBudget.status,
        attempts: operationalHealth.failureBudget.attempts,
        previousAttempts: operationalHealth.failureBudget.previousAttempts,
        maxAttempts: operationalHealth.failureBudget.maxAttempts,
        exhausted: operationalHealth.failureBudget.exhausted,
        retryWindowActive: operationalHealth.failureBudget.retryWindowActive,
        retryAfterAt: operationalHealth.failureBudget.retryAfterAt,
        backoffMs: operationalHealth.failureBudget.backoffMs,
        primaryErrorCode: operationalHealth.failureBudget.primaryErrorCode,
        fingerprint: operationalHealth.failureBudget.fingerprint,
        lastFailedAt: operationalHealth.failureBudget.lastFailedAt,
        lastRecoveredAt: operationalHealth.failureBudget.lastRecoveredAt,
        resetReason: operationalHealth.failureBudget.resetReason
      }
    }
  };
}

function applyLifecycleCommand(settings, controlRequest, nowMs, commandReplay = false) {
  const lifecycle = controlRequest.command;
  const nextSettings = {
    ...settings,
    schedule: { ...settings.schedule }
  };
  const effects = [];
  const commandIssues = [...controlRequest.issues];
  const appliedControls = [];

  if (commandReplay) {
    effects.push('duplicate idempotency key observed; lifecycle mutation skipped');
  } else if (lifecycle === 'enable') {
    nextSettings.enabled = true;
    effects.push('verifier-result gate enabled');
    appliedControls.push('enabled');
  } else if (lifecycle === 'disable') {
    nextSettings.enabled = false;
    effects.push('verifier-result gate disabled');
    appliedControls.push('enabled');
  } else if (lifecycle === 'pause-schedule') {
    nextSettings.schedule.mode = 'paused';
    nextSettings.schedule.nextRunAt = null;
    effects.push('scheduled verifier-result refresh paused');
    appliedControls.push('schedule');
  } else if (lifecycle === 'resume-schedule') {
    if (settings.schedule.intervalMs) {
      nextSettings.schedule.mode = 'interval';
      nextSettings.schedule.nextRunAt = new Date(nowMs + settings.schedule.intervalMs).toISOString();
      effects.push('scheduled verifier-result refresh resumed');
      appliedControls.push('schedule');
    } else {
      nextSettings.schedule.mode = 'manual';
      effects.push('no interval configured; schedule remains manual');
    }
  } else if (lifecycle === 'run-now') {
    if (!nextSettings.enabled) {
      commandIssues.push('run-now cannot request verifier refresh while the gate is disabled');
      effects.push('immediate verifier-result refresh was rejected because the gate is disabled');
    } else {
      nextSettings.schedule.lastRequestedRunAt = new Date(nowMs).toISOString();
      nextSettings.schedule.nextRunAt = nextSettings.schedule.mode === 'interval' && nextSettings.schedule.intervalMs
        ? new Date(nowMs + nextSettings.schedule.intervalMs).toISOString()
        : nextSettings.schedule.nextRunAt;
      effects.push('immediate verifier-result refresh requested');
      appliedControls.push('schedule.lastRequestedRunAt');
    }
  } else if (lifecycle === 'configure-schedule') {
    if (controlRequest.hasSchedulePatch && commandIssues.length === 0) {
      nextSettings.schedule = controlRequest.schedulePatch;
      effects.push(`verifier-result schedule configured for ${nextSettings.schedule.mode} mode`);
      appliedControls.push('schedule');
    } else if (!controlRequest.hasSchedulePatch) {
      commandIssues.push('configure-schedule requires lifecycleOptions.schedule');
    }
  } else if (lifecycle === 'update-settings') {
    if (controlRequest.hasSettingsPatch && commandIssues.length === 0) {
      Object.assign(nextSettings, controlRequest.settingsPatch);
      effects.push(`verifier-result settings updated: ${controlRequest.appliedSettingKeys.join(', ')}`);
      appliedControls.push(...controlRequest.appliedSettingKeys);
    } else if (!controlRequest.hasSettingsPatch) {
      commandIssues.push('update-settings requires at least one supported mutable setting');
    }
  }
  const scheduleRuntime = resolveScheduleRuntime(nextSettings, nowMs);
  if (!commandReplay && scheduleRuntime.due && lifecycle !== 'run-now') {
    nextSettings.schedule.lastRequestedRunAt = scheduleRuntime.evaluatedAt;
    nextSettings.schedule.nextRunAt = scheduleRuntime.nextDueAt;
    effects.push('scheduled verifier-result refresh became due');
    appliedControls.push('schedule.lastRequestedRunAt', 'schedule.nextRunAt');
  }
  const directive = buildLifecycleDirective({
    lifecycle,
    replayed: commandReplay,
    settings: nextSettings,
    scheduleRuntime,
    appliedControls,
    commandIssues
  });

  return {
    lifecycle,
    requestedCommand: controlRequest.requestedCommand,
    settings: nextSettings,
    effects,
    issues: commandIssues,
    appliedControls,
    ignoredSettingKeys: controlRequest.ignoredSettingKeys,
    commandStatus: directive.commandStatus,
    mutationApplied: directive.mutationApplied,
    refreshRequested: directive.refreshRequested,
    schedulerDirective: directive.schedulerDirective,
    nextLifecycleAction: directive.nextLifecycleAction,
    scheduleControl: {
      mode: nextSettings.schedule.mode,
      intervalMs: nextSettings.schedule.intervalMs,
      nextRunAt: nextSettings.schedule.nextRunAt,
      lastRequestedRunAt: nextSettings.schedule.lastRequestedRunAt || null,
      status: directive.scheduleStatus,
      due: scheduleRuntime.due,
      dueAt: directive.dueAt,
      blockedReason: directive.scheduleBlockedReason,
      schedulerDirective: directive.schedulerDirective
    }
  };
}

function buildLifecycleControlState({ lifecycle, validationIssues, nowIso }) {
  const commandRejected = lifecycle.commandStatus === 'rejected';
  const schedule = lifecycle.settings.schedule || DEFAULT_SETTINGS.schedule;
  const hasInterval = schedule.mode === 'interval' && Number.isFinite(Number(schedule.intervalMs));
  const schedulePaused = schedule.mode === 'paused';
  const scheduleBlocked = lifecycle.scheduleControl.status === 'blocked';
  const disabled = lifecycle.settings.enabled === false;
  const blockedReasons = Array.from(new Set([
    ...(disabled ? ['gate-disabled'] : []),
    ...(commandRejected ? lifecycle.issues.map((issue) => `command:${issue}`) : []),
    ...(scheduleBlocked && lifecycle.scheduleControl.blockedReason ? [`schedule:${lifecycle.scheduleControl.blockedReason}`] : []),
    ...validationIssues.map((issue) => `settings:${issue}`)
  ]));
  const controlSeed = [
    lifecycle.lifecycle,
    lifecycle.commandStatus,
    lifecycle.schedulerDirective,
    schedule.mode,
    schedule.nextRunAt,
    blockedReasons.join(',')
  ];
  const controls = [
    {
      controlId: stableChecksum([...controlSeed, 'enable']),
      action: 'enable-gate',
      label: 'Enable verifier claim gate',
      lifecycleCommand: 'enable',
      enabled: disabled && !commandRejected,
      disabledReasons: disabled ? [] : ['gate-already-enabled']
    },
    {
      controlId: stableChecksum([...controlSeed, 'disable']),
      action: 'disable-gate',
      label: 'Disable verifier claim gate',
      lifecycleCommand: 'disable',
      enabled: !disabled && !commandRejected,
      disabledReasons: disabled ? ['gate-already-disabled'] : []
    },
    {
      controlId: stableChecksum([...controlSeed, 'run-now']),
      action: 'request-refresh',
      label: 'Run verifier refresh now',
      lifecycleCommand: 'run-now',
      enabled: !disabled && !commandRejected,
      disabledReasons: [
        ...(disabled ? ['gate-disabled'] : []),
        ...(commandRejected ? ['command-invalid'] : [])
      ]
    },
    {
      controlId: stableChecksum([...controlSeed, 'pause-schedule']),
      action: 'pause-schedule',
      label: 'Pause scheduled verifier refresh',
      lifecycleCommand: 'pause-schedule',
      enabled: !disabled && hasInterval && !schedulePaused && !commandRejected,
      disabledReasons: [
        ...(disabled ? ['gate-disabled'] : []),
        ...(hasInterval ? [] : ['interval-not-configured']),
        ...(schedulePaused ? ['schedule-already-paused'] : []),
        ...(commandRejected ? ['command-invalid'] : [])
      ]
    },
    {
      controlId: stableChecksum([...controlSeed, 'resume-schedule']),
      action: 'resume-schedule',
      label: 'Resume scheduled verifier refresh',
      lifecycleCommand: 'resume-schedule',
      enabled: !disabled && schedulePaused && Number.isFinite(Number(schedule.intervalMs)) && !commandRejected,
      disabledReasons: [
        ...(disabled ? ['gate-disabled'] : []),
        ...(schedulePaused ? [] : ['schedule-not-paused']),
        ...(Number.isFinite(Number(schedule.intervalMs)) ? [] : ['interval-not-configured']),
        ...(commandRejected ? ['command-invalid'] : [])
      ]
    },
    {
      controlId: stableChecksum([...controlSeed, 'configure-schedule']),
      action: 'configure-schedule',
      label: 'Configure verifier refresh schedule',
      lifecycleCommand: 'configure-schedule',
      enabled: !commandRejected,
      disabledReasons: commandRejected ? ['command-invalid'] : []
    }
  ];
  const primaryControl = controls.find((control) => {
    if (commandRejected) return control.action === 'configure-schedule';
    if (disabled) return control.action === 'enable-gate';
    if (lifecycle.refreshRequested) return control.action === 'request-refresh';
    if (schedulePaused && Number.isFinite(Number(schedule.intervalMs))) return control.action === 'resume-schedule';
    if (lifecycle.scheduleControl.status === 'scheduled') return control.action === 'request-refresh';
    return false;
  }) || controls.find((control) => control.enabled) || controls.at(-1);

  return {
    version: `${CONTRACT_VERSION}.lifecycle-controls.v1`,
    state: commandRejected
      ? 'command-rejected'
      : disabled
        ? 'gate-disabled'
        : lifecycle.refreshRequested
          ? 'refresh-requested'
          : lifecycle.scheduleControl.status,
    commandStatus: lifecycle.commandStatus,
    schedulerDirective: lifecycle.schedulerDirective,
    nextLifecycleAction: lifecycle.nextLifecycleAction,
    primaryAction: {
      action: primaryControl.action,
      label: primaryControl.label,
      lifecycleCommand: primaryControl.lifecycleCommand,
      enabled: primaryControl.enabled,
      disabledReasons: primaryControl.disabledReasons
    },
    schedule: {
      mode: schedule.mode,
      intervalMs: schedule.intervalMs,
      nextRunAt: schedule.nextRunAt,
      due: lifecycle.scheduleControl.due,
      dueAt: lifecycle.scheduleControl.dueAt,
      blockedReason: lifecycle.scheduleControl.blockedReason
    },
    settingsValidation: {
      ok: validationIssues.length === 0 && !commandRejected,
      issueCount: Array.from(new Set([...validationIssues, ...lifecycle.issues])).length,
      issues: Array.from(new Set([...validationIssues, ...lifecycle.issues]))
    },
    blockedReasons,
    controls,
    observedAt: nowIso
  };
}

function evaluateVerifierResult({ settings, verifierResult = {}, input = {}, nowMs, refreshRequested = false }) {
  const timestamp = normalizeVerifierResultTimestamp(verifierResult, nowMs);
  const resultAgeMs = timestamp.resultAgeMs;
  const hasProof = typeof verifierResult.proofId === 'string' && verifierResult.proofId.trim() !== '';
  const accepted = verifierResult.status === 'accepted' || verifierResult.ok === true;
  const claimBinding = normalizeClaimBinding(input, verifierResult);
  const reasons = [];

  if (!settings.enabled) reasons.push('gate-disabled');
  if (settings.requireProof && !hasProof) reasons.push('missing-proof');
  if (!accepted) reasons.push('verifier-result-not-accepted');
  if (claimBinding.blocker) reasons.push(claimBinding.blocker);
  if (resultAgeMs === null) reasons.push('missing-result-timestamp');
  if (timestamp.futureDated) reasons.push('future-verifier-result-timestamp');
  if (resultAgeMs !== null && resultAgeMs > settings.maxClaimAgeMs) reasons.push('stale-verifier-result');

  const canReleaseClaim = settings.enabled && accepted && reasons.length === 0 && !refreshRequested;
  const stale = reasons.includes('stale-verifier-result')
    || reasons.includes('missing-result-timestamp')
    || reasons.includes('future-verifier-result-timestamp');
  const nextAction = !settings.enabled
    ? 'gate-disabled'
    : refreshRequested
      ? 'request-refresh'
    : canReleaseClaim
      ? 'release-claim'
      : stale
        ? settings.staleResultAction
        : 'await-valid-proof';

  return {
    canReleaseClaim,
    nextAction,
    reasons,
    resultAgeMs,
    timestamp,
    refreshRequested,
    claimBinding,
    proof: {
      required: settings.requireProof,
      present: hasProof,
      proofId: hasProof ? verifierResult.proofId : null,
      accepted
    }
  };
}

function normalizeClaimPreview(input = {}, verifierResult = {}) {
  const claim = input.claim && typeof input.claim === 'object' ? input.claim : {};
  const claimId = typeof input.claimId === 'string' && input.claimId.trim() !== ''
    ? input.claimId.trim()
    : cleanString(claim.claimId) || cleanString(claim.id);
  const subject = typeof input.subject === 'string' && input.subject.trim() !== ''
    ? input.subject.trim()
    : cleanString(claim.subject) || claimId;
  const resultId = typeof verifierResult.resultId === 'string' && verifierResult.resultId.trim() !== ''
    ? verifierResult.resultId.trim()
    : typeof verifierResult.id === 'string' && verifierResult.id.trim() !== ''
      ? verifierResult.id.trim()
      : null;
  const summary = typeof verifierResult.summary === 'string' && verifierResult.summary.trim() !== ''
    ? verifierResult.summary.trim()
    : verifierResult.status === 'accepted' || verifierResult.ok === true
      ? 'Verifier accepted the claim result.'
      : 'Verifier result is not yet accepted.';

  return {
    claimId,
    subject,
    resultId,
    summary,
    status: typeof verifierResult.status === 'string' ? verifierResult.status : verifierResult.ok === true ? 'accepted' : 'unknown'
  };
}

function buildAcceptanceContract({ evaluation, providerContract, externalHandoff, preview, securityBoundary }) {
  const releaseCapabilityReady = !evaluation.canReleaseClaim
    || providerContract.requestedCapabilities.includes(PROVIDER_CAPABILITIES.claimRelease);
  const providerExecutable = providerContract.negotiated && releaseCapabilityReady;
  const criteria = [
    {
      id: 'gate-enabled',
      label: 'Gate enabled',
      passed: !evaluation.reasons.includes('gate-disabled'),
      reason: evaluation.reasons.includes('gate-disabled') ? RELEASE_BLOCKER_MESSAGES['gate-disabled'] : null
    },
    {
      id: 'verifier-accepted',
      label: 'Verifier accepted result',
      passed: !evaluation.reasons.includes('verifier-result-not-accepted'),
      reason: evaluation.reasons.includes('verifier-result-not-accepted')
        ? RELEASE_BLOCKER_MESSAGES['verifier-result-not-accepted']
        : null
    },
    {
      id: 'proof-present',
      label: 'Required proof available',
      passed: evaluation.proof.required ? evaluation.proof.present : true,
      reason: evaluation.reasons.includes('missing-proof') ? RELEASE_BLOCKER_MESSAGES['missing-proof'] : null
    },
    {
      id: 'claim-binding',
      label: 'Verifier result matches claim',
      passed: evaluation.claimBinding.bound,
      reason: evaluation.claimBinding.blocker
        ? RELEASE_BLOCKER_MESSAGES[evaluation.claimBinding.blocker]
        : null,
      evidence: {
        status: evaluation.claimBinding.status,
        expectedClaimId: evaluation.claimBinding.expectedClaimId,
        resultClaimId: evaluation.claimBinding.resultClaimId,
        bindingSource: evaluation.claimBinding.bindingSource,
        auditFingerprint: evaluation.claimBinding.auditFingerprint
      }
    },
    {
      id: 'result-current',
      label: 'Verifier result is current',
      passed: !evaluation.reasons.includes('missing-result-timestamp')
        && !evaluation.reasons.includes('future-verifier-result-timestamp')
        && !evaluation.reasons.includes('stale-verifier-result'),
      reason: evaluation.reasons.includes('missing-result-timestamp')
        ? RELEASE_BLOCKER_MESSAGES['missing-result-timestamp']
        : evaluation.reasons.includes('future-verifier-result-timestamp')
          ? RELEASE_BLOCKER_MESSAGES['future-verifier-result-timestamp']
          : evaluation.reasons.includes('stale-verifier-result')
            ? RELEASE_BLOCKER_MESSAGES['stale-verifier-result']
            : null,
      evidence: {
        status: evaluation.timestamp.status,
        selectedField: evaluation.timestamp.selectedField,
        observedAt: evaluation.timestamp.observedAt,
        resultAgeMs: evaluation.timestamp.resultAgeMs,
        rawAgeMs: evaluation.timestamp.rawAgeMs,
        futureSkewMs: evaluation.timestamp.futureSkewMs,
        maxFutureSkewMs: evaluation.timestamp.maxFutureSkewMs,
        auditFingerprint: evaluation.timestamp.auditFingerprint
      }
    },
    {
      id: 'provider-ready',
      label: 'Provider can execute decision',
      passed: providerExecutable,
      reason: providerExecutable
        ? null
        : releaseCapabilityReady
          ? `Provider is missing capabilities: ${providerContract.missingCapabilities.join(', ')}`
          : `Provider is missing capability: ${PROVIDER_CAPABILITIES.claimRelease}`
    },
    {
      id: 'handoff-ready',
      label: 'External handoff target is ready',
      passed: externalHandoff.state !== 'failed',
      reason: externalHandoff.state === 'failed' ? externalHandoff.blockers.join(', ') || 'Handoff failed.' : null
    },
    {
      id: 'tenant-boundary-ready',
      label: 'Tenant workspace boundary is valid',
      passed: securityBoundary.allowed,
      reason: securityBoundary.allowed
        ? null
        : [...securityBoundary.issues, ...securityBoundary.missingPermissions].join(', ') || 'Tenant boundary blocked.'
    }
  ];
  const failed = criteria.filter((criterion) => !criterion.passed);

  return {
    accepted: evaluation.canReleaseClaim && providerExecutable && externalHandoff.state !== 'failed' && securityBoundary.allowed,
    claimId: preview.claimId,
    resultId: preview.resultId,
    proofId: evaluation.proof.proofId,
    criteria,
    failedCriteria: failed.map((criterion) => criterion.id),
    decisionText: failed.length === 0
      ? 'Claim is accepted for release.'
      : `Claim is blocked by ${failed.length} acceptance ${failed.length === 1 ? 'check' : 'checks'}.`
  };
}

function buildReadinessContract({ evaluation, providerContract, syncMetadata, externalHandoff, validationIssues, securityBoundary }) {
  const checks = {
    settingsValid: validationIssues.length === 0,
    providerReady: providerContract.negotiated,
    providerContractCompatible: providerContract.contractIssues.length === 0,
    resultUsable: evaluation.reasons.length === 0,
    claimBound: evaluation.claimBinding.bound,
    proofReady: !evaluation.proof.required || evaluation.proof.present,
    syncObserved: syncMetadata.status === 'observed',
    syncFresh: syncMetadata.lagMs !== null && syncMetadata.lagMs <= providerContract.syncStaleAfterMs,
    handoffReady: externalHandoff.state !== 'failed',
    tenantBoundaryReady: securityBoundary.allowed
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);

  return {
    state: missing.length === 0 ? 'ready' : evaluation.nextAction === 'request-refresh' ? 'needs-refresh' : 'blocked',
    score: Object.values(checks).filter(Boolean).length,
    total: Object.keys(checks).length,
    checks,
    missing,
    lastSyncedAt: syncMetadata.lastSyncedAt,
    syncLagMs: syncMetadata.lagMs,
    syncStaleAfterMs: providerContract.syncStaleAfterMs,
    resultAgeMs: evaluation.resultAgeMs
  };
}

function buildValidationSummary(issues, providerContract, evaluation) {
  const providerIssues = providerContract.missingCapabilities.map((capability) => `missing provider capability: ${capability}`);
  const providerContractIssues = providerContract.contractIssues.map((issue) => `provider contract mismatch: ${issue}`);
  const releaseIssues = evaluation.reasons.map((reason) => RELEASE_BLOCKER_MESSAGES[reason] || reason);
  const allIssues = [...issues, ...providerIssues, ...providerContractIssues, ...releaseIssues];

  return {
    ok: allIssues.length === 0,
    issueCount: allIssues.length,
    settingsIssueCount: issues.length,
    providerIssueCount: providerIssues.length + providerContractIssues.length,
    providerContractIssueCount: providerContractIssues.length,
    releaseIssueCount: releaseIssues.length,
    issues: allIssues
  };
}

function buildClientNextSteps({ evaluation, providerContract, externalHandoff, lifecycleSettings, operationalHealth, lifecycle, lifecycleControls, securityBoundary }) {
  const steps = [];
  if (lifecycle?.issues?.length > 0) {
    steps.push({
      action: 'correct-lifecycle-command',
      label: 'Correct verifier-result lifecycle command options',
      issues: lifecycle.issues
    });
  }
  if (
    lifecycleControls?.primaryAction
    && lifecycleControls.primaryAction.action !== 'configure-schedule'
    && lifecycleControls.primaryAction.action !== 'disable-gate'
    && lifecycleControls.primaryAction.enabled
    && !steps.some((step) => step.action === lifecycleControls.primaryAction.action)
  ) {
    steps.push({
      action: lifecycleControls.primaryAction.action,
      label: lifecycleControls.primaryAction.label,
      command: lifecycleControls.primaryAction.lifecycleCommand,
      disabledReasons: lifecycleControls.primaryAction.disabledReasons,
      schedule: lifecycleControls.schedule,
      lifecycleControlState: lifecycleControls.state
    });
  }
  if (operationalHealth?.state === 'retry-wait') {
    steps.push({
      action: 'wait-for-backoff',
      label: 'Wait for verifier-result retry backoff',
      retryAfterAt: operationalHealth.retry.retryAfterAt
    });
  }
  if (operationalHealth?.state === 'failed') {
    steps.push({
      action: 'escalate-operational-health',
      label: 'Escalate verifier-result operational failure',
      errorCode: operationalHealth.primaryError?.code || 'unknown'
    });
  }
  if (operationalHealth?.recoveryPlan?.primaryAction) {
    steps.push({
      action: operationalHealth.recoveryPlan.primaryAction.action,
      label: operationalHealth.recoveryPlan.primaryAction.label,
      retryAfterAt: operationalHealth.recoveryPlan.primaryAction.retryAfterAt || operationalHealth.recoveryPlan.nextAttemptAt,
      dispatchCommand: operationalHealth.recoveryPlan.primaryAction.dispatchCommand || null,
      disabledReasons: operationalHealth.recoveryPlan.autoRetryAllowed
        ? []
        : [operationalHealth.recoveryPlan.retryBlockedReason].filter(Boolean),
      recoveryPhase: operationalHealth.recoveryPlan.phase
    });
  }
  if (!securityBoundary.boundaryOk) {
    steps.push({
      action: 'restore-tenant-workspace-scope',
      label: 'Restore matching tenant and workspace scope',
      issues: securityBoundary.issues
    });
  }
  if (!securityBoundary.permissionOk) {
    steps.push({
      action: 'grant-verifier-permissions',
      label: 'Grant required verifier-result permissions',
      missingPermissions: securityBoundary.missingPermissions
    });
  }
  if (evaluation.reasons.includes('gate-disabled')) {
    steps.push({ action: 'enable-gate', label: 'Enable verifier claim gate', command: 'enable' });
  }
  if (evaluation.reasons.includes('missing-proof')) {
    steps.push({ action: 'attach-proof', label: 'Attach or fetch verifier proof', capability: PROVIDER_CAPABILITIES.proofRead });
  }
  if (evaluation.reasons.includes('missing-claim-identity')) {
    steps.push({
      action: 'attach-claim-identity',
      label: 'Attach a stable claim identity before verifier release'
    });
  }
  if (evaluation.reasons.includes('verifier-result-unbound')) {
    steps.push({
      action: 'request-bound-verifier-result',
      label: 'Request a verifier result bound to this claim',
      capability: PROVIDER_CAPABILITIES.refreshRequest
    });
  }
  if (evaluation.reasons.includes('verifier-result-claim-mismatch')) {
    steps.push({
      action: 'replace-mismatched-verifier-result',
      label: 'Replace the verifier result bound to a different claim',
      capability: PROVIDER_CAPABILITIES.refreshRequest,
      binding: {
        expectedClaimId: evaluation.claimBinding.expectedClaimId,
        resultClaimId: evaluation.claimBinding.resultClaimId,
        auditFingerprint: evaluation.claimBinding.auditFingerprint
      }
    });
  }
  if (
    evaluation.reasons.includes('missing-result-timestamp')
    || evaluation.reasons.includes('future-verifier-result-timestamp')
    || evaluation.reasons.includes('stale-verifier-result')
  ) {
    steps.push({ action: 'request-refresh', label: 'Request a fresh verifier result', capability: PROVIDER_CAPABILITIES.refreshRequest });
  }
  if (evaluation.reasons.includes('verifier-result-not-accepted')) {
    steps.push({ action: 'wait-for-acceptance', label: 'Wait for verifier acceptance or resubmit evidence' });
  }
  if (!providerContract.negotiated) {
    steps.push({ action: 'negotiate-provider', label: 'Provision missing provider capabilities', missingCapabilities: providerContract.missingCapabilities });
  }
  if (externalHandoff.state === 'failed') {
    steps.push({ action: 'repair-handoff', label: 'Provide a valid handoff target or retry failed handoff', blockers: externalHandoff.blockers });
  }
  if (steps.length === 0 && evaluation.canReleaseClaim) {
    steps.push({ action: 'release-claim', label: 'Release claim through the configured handoff', capability: PROVIDER_CAPABILITIES.claimRelease });
  }

  return {
    primary: steps[0] || { action: 'inspect', label: 'Inspect verifier result state' },
    steps,
    scheduleDueAt: lifecycleSettings.schedule.nextRunAt,
    scheduleMode: lifecycleSettings.schedule.mode,
    refreshRequested: lifecycle?.refreshRequested === true,
    lifecycleControlState: lifecycleControls?.state || null,
    lifecyclePrimaryCommand: lifecycleControls?.primaryAction?.lifecycleCommand || null
  };
}

function buildRequestIntentContract({ requestContext, clientState, preview, evaluation, acceptance, readiness, providerContract, externalHandoff, operationalHealth, securityBoundary, lifecycle }) {
  const requestedIntent = requestContext.workflowIntent;
  const intentSpec = WORKFLOW_INTENT_CONTRACTS[requestedIntent] || WORKFLOW_INTENT_CONTRACTS.inspect;
  const requiredCapabilities = Array.from(new Set([
    PROVIDER_CAPABILITIES.resultRead,
    ...(intentSpec.capability ? [intentSpec.capability] : []),
    ...(requestedIntent === 'release' ? [PROVIDER_CAPABILITIES.proofRead, PROVIDER_CAPABILITIES.auditWrite] : []),
    ...(requestedIntent === 'repair' ? [PROVIDER_CAPABILITIES.auditWrite] : [])
  ]));
  const missingProviderCapabilities = requiredCapabilities
    .filter((capability) => !providerContract.requestedCapabilities.includes(capability));
  const missingActorPermissions = requiredCapabilities
    .filter((capability) => !securityBoundary.actor.permissions.includes(capability));
  const blockers = [];

  if (!providerContract.negotiated && requestedIntent !== 'inspect') blockers.push('provider-not-negotiated');
  if (missingProviderCapabilities.length > 0 && requestedIntent !== 'inspect') blockers.push('missing-provider-capability');
  if (missingActorPermissions.length > 0 && requestedIntent !== 'inspect') blockers.push('missing-actor-permission');
  if (!securityBoundary.boundaryOk) blockers.push('tenant-boundary-violation');
  if (!securityBoundary.permissionOk) blockers.push('permission-denied');
  if (operationalHealth.state === 'failed' && requestedIntent !== 'repair' && requestedIntent !== 'inspect') blockers.push('operational-health-failed');
  if (operationalHealth.state === 'retry-wait' && requestedIntent !== 'inspect') blockers.push('retry-window-active');

  if (requestedIntent === 'release') {
    if (!acceptance.accepted) blockers.push('release-criteria-not-accepted');
    if (evaluation.nextAction !== 'release-claim') blockers.push(`verifier-next-action:${evaluation.nextAction}`);
    if (externalHandoff.state === 'failed') blockers.push('handoff-failed');
    if (!['queued', 'dispatched', 'acknowledged'].includes(externalHandoff.state)) blockers.push(`handoff-not-ready:${externalHandoff.state}`);
    if (readiness.state !== 'ready') blockers.push(`readiness-not-ready:${readiness.state}`);
  } else if (requestedIntent === 'refresh') {
    if (!lifecycle.settings.enabled) blockers.push('gate-disabled');
    if (evaluation.canReleaseClaim && readiness.state === 'ready') blockers.push('fresh-result-already-release-ready');
    if (externalHandoff.state === 'failed') blockers.push('refresh-handoff-failed');
  } else if (requestedIntent === 'hold') {
    if (evaluation.nextAction === 'release-claim') blockers.push('claim-is-release-ready');
    if (externalHandoff.state === 'failed') blockers.push('hold-handoff-failed');
  } else if (requestedIntent === 'reject') {
    if (evaluation.nextAction === 'release-claim') blockers.push('claim-is-release-ready');
    if (externalHandoff.state === 'failed') blockers.push('reject-handoff-failed');
  } else if (requestedIntent === 'repair') {
    if (externalHandoff.state !== 'failed' && operationalHealth.state !== 'failed') blockers.push('no-repair-needed');
  }

  const uniqueBlockers = Array.from(new Set(blockers));
  const allowed = requestedIntent === 'inspect' || uniqueBlockers.length === 0;
  const dispatchCommand = allowed
    ? intentSpec.dispatchCommand
    : requestedIntent === 'repair'
      ? 'open-handoff-repair'
      : 'inspect';
  const routeBase = requestContext.returnRoute || requestContext.surfaceRoute || clientState.route;
  const routeSeparator = routeBase.includes('?') ? '&' : '?';
  const routePanel = allowed ? intentSpec.panel : uniqueBlockers.includes('permission-denied') ? 'audit' : 'overview';
  const route = `${routeBase}${routeSeparator}panel=${routePanel}`;
  const state = allowed
    ? `${requestedIntent}-ready`
    : requestedIntent === 'repair'
      ? 'repair-not-required'
      : `${requestedIntent}-blocked`;
  const label = allowed
    ? `Verifier-result ${requestedIntent} workflow is ready`
    : `Verifier-result ${requestedIntent} workflow is blocked`;
  const fingerprint = stableChecksum([
    CONTRACT_VERSION,
    requestContext.requestId,
    requestContext.workflowIntent,
    preview.claimId,
    preview.resultId,
    intentSpec.action,
    uniqueBlockers.join(','),
    securityBoundary.scopeHash
  ]);

  return {
    version: `${CONTRACT_VERSION}.request-intent.v1`,
    requestedIntent,
    action: intentSpec.action,
    dispatchCommand,
    lifecycleCommand: intentSpec.command,
    route,
    routePanel,
    allowed,
    blockers: uniqueBlockers,
    requiredCapabilities,
    missingProviderCapabilities,
    missingActorPermissions,
    expectedVerifierAction: evaluation.nextAction,
    handoffState: externalHandoff.state,
    readinessState: readiness.state,
    statePatch: {
      workflowIntent: requestedIntent,
      pendingAction: allowed ? intentSpec.action : null,
      activePanel: routePanel,
      intentFingerprint: fingerprint,
      lastIntentObservedAt: requestContext.receivedAt
    },
    userVisible: {
      state,
      label,
      route,
      primaryAction: allowed ? intentSpec.action : 'inspect-verifier-result',
      primaryDispatchCommand: dispatchCommand
    },
    audit: {
      fingerprint,
      subject: `${preview.claimId || 'unknown-claim'}:${requestedIntent}`,
      capability: intentSpec.capability,
      blockerCount: uniqueBlockers.length
    }
  };
}

function buildClientReviewPacket({ requestContext, preview, evaluation, acceptance, readiness, validationSummary, clientNextSteps, providerContract, syncMetadata, externalHandoff, operationalHealth, proofReceipt, securityBoundary, claimGate, gateEvidence, gateDecisionCards, lifecycleControls, nowIso }) {
  const checklistGroups = [
    {
      groupId: 'release-acceptance',
      label: 'Release acceptance',
      passed: acceptance.criteria.filter((criterion) => criterion.passed).length,
      total: acceptance.criteria.length,
      items: acceptance.criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        status: criterion.passed ? 'passed' : 'blocked',
        explanation: criterion.reason
      }))
    },
    {
      groupId: 'runtime-readiness',
      label: 'Runtime readiness',
      passed: readiness.score,
      total: readiness.total,
      items: Object.entries(readiness.checks).map(([id, passed]) => ({
        id,
        label: id.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()),
        status: passed ? 'passed' : 'blocked',
        explanation: readiness.missing.includes(id) ? `Readiness check ${id} is not satisfied.` : null
      }))
    }
  ];
  const validationSeverity = operationalHealth.state === 'failed'
    ? 'critical'
    : validationSummary.issueCount > 0 || acceptance.failedCriteria.length > 0
      ? 'attention'
      : readiness.state === 'needs-refresh'
        ? 'refresh'
        : 'clear';
  const previewState = proofReceipt.releaseAuthorized
    ? 'release-authorized'
    : acceptance.accepted
      ? 'accepted-pending-handoff'
      : operationalHealth.state === 'retry-wait'
        ? 'retry-window'
        : readiness.state;
  const primaryStep = clientNextSteps.primary || { action: 'inspect', label: 'Inspect verifier result state' };
  const explainableCommands = clientNextSteps.steps.map((step, index) => ({
    commandId: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      step.action,
      index
    ]),
    priority: index + 1,
    action: step.action,
    label: step.label,
    capability: step.capability || null,
    lifecycleCommand: step.command || null,
    retryAfterAt: step.retryAfterAt || null,
    reasons: [
      ...(Array.isArray(step.issues) ? step.issues : []),
      ...(Array.isArray(step.missingPermissions) ? step.missingPermissions.map((permission) => `missing permission: ${permission}`) : []),
      ...(Array.isArray(step.missingCapabilities) ? step.missingCapabilities.map((capability) => `missing capability: ${capability}`) : []),
      ...(Array.isArray(step.blockers) ? step.blockers : [])
    ],
    routeHint: step.action === 'attach-proof'
      ? 'proof'
      : step.action === 'correct-lifecycle-command' || step.action === 'enable-gate'
        ? 'settings'
        : step.action === 'release-claim' || step.action === 'repair-handoff'
          ? 'handoff'
          : 'overview'
  }));
  const blockingReasons = [
    ...acceptance.criteria
      .filter((criterion) => !criterion.passed)
      .map((criterion) => ({ source: 'acceptance', code: criterion.id, message: criterion.reason || criterion.label })),
    ...validationSummary.issues.map((issue) => ({ source: 'validation', code: stableChecksum([issue]), message: issue })),
    ...securityBoundary.blockers.map((blocker) => ({ source: 'security', code: blocker, message: blocker }))
  ];

  return {
    version: `${CONTRACT_VERSION}.client-review.v1`,
    packetId: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      proofReceipt.receiptId,
      previewState,
      validationSeverity
    ]),
    generatedAt: nowIso,
    route: {
      surfaceRoute: requestContext.surfaceRoute,
      returnRoute: requestContext.returnRoute,
      activePanel: explainableCommands[0]?.routeHint || 'overview'
    },
    preview: {
      state: previewState,
      severity: validationSeverity,
      headline: proofReceipt.releaseAuthorized
        ? 'Verifier proof authorizes release'
        : acceptance.accepted
          ? 'Verifier result is accepted'
          : 'Verifier result needs review',
      summary: preview.summary,
      claimId: preview.claimId,
      subject: preview.subject,
      resultId: preview.resultId,
      resultStatus: preview.status,
      claimBindingStatus: evaluation.claimBinding.status,
      resultAgeMs: readiness.resultAgeMs,
      releaseAuthorized: proofReceipt.releaseAuthorized
    },
    validation: {
      ok: validationSummary.ok,
      severity: validationSeverity,
      issueCount: validationSummary.issueCount,
      providerIssueCount: validationSummary.providerIssueCount,
      releaseIssueCount: validationSummary.releaseIssueCount,
      blockingReasons
    },
    readiness: {
      state: readiness.state,
      score: readiness.score,
      total: readiness.total,
      missing: readiness.missing,
      sync: {
        status: syncMetadata.status,
        lastSyncedAt: syncMetadata.lastSyncedAt,
        lagMs: syncMetadata.lagMs,
        staleAfterMs: providerContract.syncStaleAfterMs
      }
    },
    provider: {
      providerId: providerContract.providerId,
      mode: providerContract.mode,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      handoffProtocol: providerContract.handoffProtocol,
      missingCapabilities: providerContract.missingCapabilities
    },
    handoff: {
      state: externalHandoff.state,
      target: externalHandoff.target,
      action: externalHandoff.action,
      dispatchBlocked: externalHandoff.state === 'failed' || securityBoundary.allowed === false,
      blockers: externalHandoff.blockers
    },
    checklistGroups,
    nextSteps: {
      primary: {
        action: primaryStep.action,
        label: primaryStep.label,
        routeHint: explainableCommands[0]?.routeHint || 'overview'
      },
      commands: explainableCommands,
      emptyState: explainableCommands.length === 0 ? 'No verifier-result action is currently required.' : null,
      lifecycleControls: {
        state: lifecycleControls.state,
        primaryAction: lifecycleControls.primaryAction,
        schedule: lifecycleControls.schedule,
        settingsValidation: lifecycleControls.settingsValidation
      }
    },
    proof: {
      receiptId: proofReceipt.receiptId,
      releaseAuthorized: proofReceipt.releaseAuthorized,
      missingEvidenceKinds: proofReceipt.proof.missingEvidenceKinds,
      claimBindingFingerprint: proofReceipt.proof.claimBindingFingerprint,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      auditTopic: proofReceipt.integrationEvents[0]?.topic || null
    },
    claimGate: {
      fileName: claimGate.fileName,
      gateId: claimGate.gateId,
      required: claimGate.required,
      allowed: claimGate.allowed,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      checksum: claimGate.checksum
    },
    gateEvidence: {
      status: gateEvidence.status,
      checksum: gateEvidence.checksum,
      summary: gateEvidence.summary,
      gates: gateEvidence.gates.map((gate) => ({
        gateId: gate.gateId,
        domain: gate.domain,
        label: gate.label,
        status: gate.status,
        blockers: gate.blockers,
        evidenceKinds: gate.evidenceKinds
      }))
    },
    gateDecisionCards: {
      state: gateDecisionCards.state,
      headline: gateDecisionCards.headline,
      summary: gateDecisionCards.summary,
      primaryCardId: gateDecisionCards.primaryCardId,
      primaryDomain: gateDecisionCards.primaryDomain,
      cards: gateDecisionCards.cards.map((card) => ({
        cardId: card.cardId,
        domain: card.domain,
        title: card.title,
        status: card.status,
        tone: card.tone,
        route: card.route,
        nextStep: card.nextStep,
        evidenceCounts: card.evidenceCounts,
        primaryBlocker: card.primaryBlocker
      }))
    }
  };
}

function buildDecisionPreviewContract({ requestContext, preview, acceptance, readiness, validationSummary, clientNextSteps, clientWorkflow, providerContract, externalHandoff, proofReceipt, operationalHealth, securityBoundary, claimGate, gateEvidence, gateDecisionCards, lifecycleControls, nowIso }) {
  const blockedAcceptance = acceptance.criteria.filter((criterion) => !criterion.passed);
  const passedAcceptanceCount = acceptance.criteria.length - blockedAcceptance.length;
  const primaryStep = clientNextSteps.primary || { action: 'inspect', label: 'Inspect verifier result state' };
  const routeBase = requestContext.returnRoute || requestContext.surfaceRoute;
  const routeWithPanel = (panel) => {
    const separator = routeBase.includes('?') ? '&' : '?';
    return `${routeBase}${separator}panel=${panel}`;
  };
  const previewState = proofReceipt.releaseAuthorized
    ? 'authorized'
    : acceptance.accepted
      ? 'accepted'
      : operationalHealth.state === 'retry-wait'
        ? 'retry-wait'
        : readiness.state === 'needs-refresh'
          ? 'needs-refresh'
          : 'blocked';
  const severity = operationalHealth.state === 'failed'
    ? 'critical'
    : proofReceipt.releaseAuthorized || acceptance.accepted
      ? 'success'
      : readiness.state === 'needs-refresh' || operationalHealth.state === 'retry-wait'
        ? 'info'
        : 'warning';
  const primaryPanel = primaryStep.action === 'attach-proof'
    ? 'proof'
    : primaryStep.action === 'release-claim' || primaryStep.action === 'request-refresh' || primaryStep.action === 'repair-handoff'
      ? 'handoff'
      : primaryStep.action === 'enable-gate' || primaryStep.action === 'correct-lifecycle-command'
        ? 'settings'
        : operationalHealth.state === 'failed'
          ? 'audit'
          : clientWorkflow.activePanel;
  const blockerPreview = [
    ...blockedAcceptance.map((criterion) => ({
      source: 'acceptance',
      code: criterion.id,
      label: criterion.label,
      message: criterion.reason || criterion.label
    })),
    ...validationSummary.issues.slice(0, 4).map((issue) => ({
      source: 'validation',
      code: stableChecksum([issue]),
      label: 'Validation issue',
      message: issue
    })),
    ...securityBoundary.blockers.map((blocker) => ({
      source: 'security',
      code: blocker,
      label: 'Security boundary',
      message: blocker
    }))
  ];
  const actionQueue = clientNextSteps.steps.map((step, index) => {
    const panel = step.action === 'attach-proof'
      ? 'proof'
      : step.action === 'release-claim' || step.action === 'request-refresh' || step.action === 'repair-handoff'
        ? 'handoff'
        : step.action === 'enable-gate' || step.action === 'correct-lifecycle-command'
          ? 'settings'
          : operationalHealth.state === 'failed'
            ? 'audit'
            : 'overview';

    return {
      actionId: stableChecksum([requestContext.requestId, preview.claimId, step.action, index]),
      priority: index + 1,
      action: step.action,
      label: step.label,
      panel,
      route: routeWithPanel(panel),
      capability: step.capability || null,
      lifecycleCommand: step.command || null,
      retryAfterAt: step.retryAfterAt || operationalHealth.retry.retryAfterAt,
      requiresOperator: step.action === 'escalate-operational-health' || step.action === 'grant-verifier-permissions'
    };
  });

  return {
    version: `${CONTRACT_VERSION}.decision-preview.v1`,
    previewId: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      preview.resultId,
      proofReceipt.receiptId,
      previewState,
      clientWorkflow.stateVersion
    ]),
    generatedAt: nowIso,
    state: previewState,
    severity,
    headline: proofReceipt.releaseAuthorized
      ? 'Release is authorized by verifier proof'
      : acceptance.accepted
        ? 'Verifier result is accepted and ready for release workflow'
        : operationalHealth.primaryError?.message || acceptance.decisionText,
    summary: {
      claimId: preview.claimId,
      subject: preview.subject,
      resultId: preview.resultId,
      resultStatus: preview.status,
      resultAgeMs: readiness.resultAgeMs,
      providerMode: providerContract.mode,
      healthState: operationalHealth.state,
      workflowState: clientWorkflow.workflowState
    },
    acceptanceMeter: {
      accepted: acceptance.accepted,
      passed: passedAcceptanceCount,
      total: acceptance.criteria.length,
      failedCriteria: acceptance.failedCriteria,
      releaseAuthorized: proofReceipt.releaseAuthorized
    },
    readinessMeter: {
      state: readiness.state,
      score: readiness.score,
      total: readiness.total,
      missing: readiness.missing,
      syncFresh: readiness.checks.syncFresh,
      handoffReady: readiness.checks.handoffReady
    },
    validationMeter: {
      ok: validationSummary.ok,
      issueCount: validationSummary.issueCount,
      providerIssueCount: validationSummary.providerIssueCount,
      releaseIssueCount: validationSummary.releaseIssueCount,
      primaryIssue: validationSummary.issues[0] || null
    },
    routeSlots: {
      surfaceRoute: requestContext.surfaceRoute,
      returnRoute: requestContext.returnRoute,
      activePanel: clientWorkflow.activePanel,
      primaryPanel,
      primaryRoute: routeWithPanel(primaryPanel),
      auditRoute: routeWithPanel('audit')
    },
    primaryAction: {
      action: primaryStep.action,
      label: primaryStep.label,
      route: routeWithPanel(primaryPanel),
      enabled: operationalHealth.state !== 'retry-wait' || primaryStep.action === 'wait-for-backoff',
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      capability: primaryStep.capability || null,
      lifecycleCommand: primaryStep.command || null
    },
    lifecycleControlsPreview: {
      state: lifecycleControls.state,
      schedulerDirective: lifecycleControls.schedulerDirective,
      nextLifecycleAction: lifecycleControls.nextLifecycleAction,
      primaryAction: lifecycleControls.primaryAction,
      blockedReasons: lifecycleControls.blockedReasons,
      schedule: lifecycleControls.schedule,
      availableControlCount: lifecycleControls.controls.length,
      enabledControlCount: lifecycleControls.controls.filter((control) => control.enabled).length
    },
    actionQueue,
    blockers: blockerPreview,
    handoffPreview: {
      state: externalHandoff.state,
      action: externalHandoff.action,
      dispatchable: clientWorkflow.handoff.dispatchable,
      target: externalHandoff.target,
      serviceContractId: externalHandoff.serviceContractId,
      handoffProtocol: externalHandoff.handoffProtocol,
      blockers: externalHandoff.blockers
    },
    proofPreview: {
      receiptId: proofReceipt.receiptId,
      releaseAuthorized: proofReceipt.releaseAuthorized,
      missingEvidenceKinds: proofReceipt.proof.missingEvidenceKinds,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      auditTopic: proofReceipt.integrationEvents[0]?.topic || null
    },
    claimGatePreview: {
      fileName: claimGate.fileName,
      gateId: claimGate.gateId,
      required: claimGate.required,
      allowed: claimGate.allowed,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      checksum: claimGate.checksum
    },
    gateEvidencePreview: {
      status: gateEvidence.status,
      checksum: gateEvidence.checksum,
      greenGateCount: gateEvidence.summary.green,
      redGateCount: gateEvidence.summary.red,
      redEvidenceKinds: Array.from(new Set(gateEvidence.redEvidence.map((item) => item.kind))).sort(),
      redGateIds: gateEvidence.gates.filter((gate) => gate.status === 'red').map((gate) => gate.gateId)
    },
    gateDecisionPreview: {
      state: gateDecisionCards.state,
      headline: gateDecisionCards.headline,
      primaryCardId: gateDecisionCards.primaryCardId,
      primaryDomain: gateDecisionCards.primaryDomain,
      primaryRoute: gateDecisionCards.routeSlots.primary,
      summary: gateDecisionCards.summary,
      cards: gateDecisionCards.cards.map((card) => ({
        cardId: card.cardId,
        domain: card.domain,
        title: card.title,
        status: card.status,
        tone: card.tone,
        routePanel: card.routePanel,
        nextAction: card.nextStep.action,
        nextLabel: card.nextStep.label,
        reasonCodes: card.nextStep.reasonCodes,
        redEvidenceCount: card.evidenceCounts.red,
        greenEvidenceCount: card.evidenceCounts.green
      }))
    },
    auditRefs: {
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      idempotencyKey: requestContext.idempotencyKey,
      proofReceiptId: proofReceipt.receiptId,
      scopeHash: securityBoundary.scopeHash,
      providerId: providerContract.providerId,
      serviceContractId: providerContract.serviceContractId,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceBoundaryStatus: securityBoundary.workspaceDecision.status
    }
  };
}

function normalizeEvidenceManifest(inputEvidence = [], { preview, evaluation, providerContract, syncMetadata, requestContext, nowIso }) {
  const normalizedItems = inputEvidence
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const evidenceId = typeof item.evidenceId === 'string' && item.evidenceId.trim() !== ''
        ? item.evidenceId.trim()
        : typeof item.id === 'string' && item.id.trim() !== ''
          ? item.id.trim()
          : stableChecksum([requestContext.requestId, preview.claimId, preview.resultId, index]);
      const kind = typeof item.kind === 'string' && item.kind.trim() !== ''
        ? item.kind.trim()
        : typeof item.type === 'string' && item.type.trim() !== ''
          ? item.type.trim()
          : 'verifier-evidence';
      const source = typeof item.source === 'string' && item.source.trim() !== ''
        ? item.source.trim()
        : providerContract.providerId;
      const capturedAt = coerceIso(item.capturedAt || item.observedAt || item.createdAt, nowIso);
      const checksum = typeof item.checksum === 'string' && item.checksum.trim() !== ''
        ? item.checksum.trim()
        : stableChecksum([evidenceId, kind, source, capturedAt, item.uri || item.ref || item.summary]);

      return {
        evidenceId,
        kind,
        source,
        capturedAt,
        checksum,
        uri: typeof item.uri === 'string' && item.uri.trim() !== '' ? item.uri.trim() : null,
        summary: typeof item.summary === 'string' && item.summary.trim() !== '' ? item.summary.trim() : null
      };
    });
  const derivedItems = [
    {
      evidenceId: stableChecksum(['verifier-result', requestContext.requestId, preview.resultId]),
      kind: 'verifier-result',
      source: providerContract.providerId,
      capturedAt: nowIso,
      checksum: stableChecksum([preview.resultId, preview.status, evaluation.resultAgeMs, evaluation.nextAction]),
      uri: null,
      summary: `${preview.summary} Claim binding status: ${evaluation.claimBinding.status}.`
    },
    {
      evidenceId: stableChecksum(['claim-binding', requestContext.requestId, evaluation.claimBinding.auditFingerprint]),
      kind: 'claim-binding',
      source: providerContract.providerId,
      capturedAt: nowIso,
      checksum: stableChecksum([
        evaluation.claimBinding.expectedClaimId,
        evaluation.claimBinding.resultClaimId,
        evaluation.claimBinding.status,
        evaluation.claimBinding.auditFingerprint
      ]),
      uri: null,
      summary: evaluation.claimBinding.bound
        ? 'Verifier result is bound to the claim under review.'
        : RELEASE_BLOCKER_MESSAGES[evaluation.claimBinding.blocker] || 'Verifier result claim binding is not release-ready.'
    },
    {
      evidenceId: stableChecksum(['result-timestamp', requestContext.requestId, evaluation.timestamp.auditFingerprint]),
      kind: 'result-timestamp',
      source: providerContract.providerId,
      capturedAt: evaluation.timestamp.observedAt || nowIso,
      checksum: evaluation.timestamp.auditFingerprint,
      uri: null,
      summary: evaluation.timestamp.valid
        ? `Verifier result timestamp accepted from ${evaluation.timestamp.selectedField}.`
        : evaluation.timestamp.futureDated
          ? RELEASE_BLOCKER_MESSAGES['future-verifier-result-timestamp']
          : RELEASE_BLOCKER_MESSAGES['missing-result-timestamp']
    }
  ];

  if (evaluation.proof.proofId) {
    derivedItems.push({
      evidenceId: stableChecksum(['verifier-proof', requestContext.requestId, evaluation.proof.proofId]),
      kind: 'verifier-proof',
      source: providerContract.providerId,
      capturedAt: nowIso,
      checksum: stableChecksum([evaluation.proof.proofId, evaluation.proof.accepted, evaluation.proof.required]),
      uri: null,
      summary: 'Verifier proof observed for claim gate decision.'
    });
  }
  if (syncMetadata.cursor || syncMetadata.checkpoint) {
    derivedItems.push({
      evidenceId: stableChecksum(['verifier-sync', requestContext.requestId, syncMetadata.cursor, syncMetadata.checkpoint]),
      kind: 'sync-checkpoint',
      source: providerContract.service,
      capturedAt: syncMetadata.lastSyncedAt || nowIso,
      checksum: stableChecksum([syncMetadata.cursor, syncMetadata.checkpoint, syncMetadata.sourceRevision]),
      uri: null,
      summary: 'Verifier-result sync checkpoint observed.'
    });
  }

  const byId = new Map();
  [...normalizedItems, ...derivedItems].forEach((item) => {
    byId.set(item.evidenceId, item);
  });

  return {
    version: `${CONTRACT_VERSION}.evidence-manifest`,
    requiredKinds: evaluation.proof.required
      ? ['verifier-result', 'result-timestamp', 'claim-binding', 'verifier-proof']
      : ['verifier-result', 'result-timestamp', 'claim-binding'],
    items: Array.from(byId.values()),
    observedKinds: Array.from(new Set(Array.from(byId.values()).map((item) => item.kind))).sort()
  };
}

function isBootCompletionClaim(input = {}, preview) {
  const claim = input.claim && typeof input.claim === 'object' ? input.claim : {};
  const rawTokens = [
    input.claimType,
    input.intent,
    input.action,
    input.status,
    preview.subject,
    claim.type,
    claim.kind,
    claim.intent,
    claim.action,
    claim.status,
    claim.name
  ];
  const tokens = normalizeStringList(rawTokens);
  const searchable = rawTokens
    .filter((token) => typeof token === 'string')
    .join(' ')
    .toLowerCase();

  return tokens.some((token) => [
    'boot-complete',
    'boot-completion',
    'boot_completion',
    'complete-boot',
    'kernel-boot-complete',
    'kernel.boot.complete'
  ].includes(token.toLowerCase()))
    || /\bboot[\s._-]*completion\b/.test(searchable)
    || /\bboot[\s._-]*complete\b/.test(searchable)
    || /\bcomplete[\s._-]*boot\b/.test(searchable);
}

function normalizeRequiredClaimGateArtifacts(input = {}, evaluation) {
  const claimGate = input.claimGate && typeof input.claimGate === 'object' ? input.claimGate : {};
  const configured = normalizeStringList(
    claimGate.requiredEvidenceArtifacts
    || claimGate.requiredArtifacts
    || input.requiredEvidenceArtifacts
  );
  const required = configured.length > 0
    ? configured
    : DEFAULT_BOOT_COMPLETION_EVIDENCE_ARTIFACTS;

  return evaluation.proof.required
    ? Array.from(new Set(required)).sort()
    : Array.from(new Set(required.filter((artifact) => artifact !== 'verifier-proof'))).sort();
}

function buildClaimGateArtifact({ input, requestContext, preview, evaluation, evidenceManifest, securityBoundary, nowIso }) {
  const bootCompletionClaim = isBootCompletionClaim(input, preview);
  const requiredArtifacts = bootCompletionClaim
    ? normalizeRequiredClaimGateArtifacts(input, evaluation)
    : [];
  const observedArtifacts = Array.from(new Set(evidenceManifest.items.flatMap((item) => [
    item.kind,
    item.evidenceId
  ].filter(Boolean)))).sort();
  const evidenceByArtifact = Object.fromEntries(requiredArtifacts.map((artifact) => {
    const matches = evidenceManifest.items
      .filter((item) => item.kind === artifact || item.evidenceId === artifact)
      .map((item) => ({
        evidenceId: item.evidenceId,
        kind: item.kind,
        checksum: item.checksum,
        capturedAt: item.capturedAt,
        source: item.source
      }));
    return [artifact, matches];
  }));
  const missingArtifacts = requiredArtifacts
    .filter((artifact) => !observedArtifacts.includes(artifact));
  const blocked = bootCompletionClaim && missingArtifacts.length > 0;
  const gateId = stableChecksum([
    'claim_gate.json',
    requestContext.requestId,
    preview.claimId,
    preview.resultId,
    requiredArtifacts.join(','),
    missingArtifacts.join(','),
    securityBoundary.scopeHash
  ]);
  const payload = {
    schemaVersion: `${CONTRACT_VERSION}.claim-gate-json.v1`,
    fileName: 'claim_gate.json',
    gateId,
    generatedAt: nowIso,
    claim: {
      claimId: preview.claimId,
      subject: preview.subject,
      bootCompletionClaim
    },
    decision: {
      allowed: !blocked,
      blocked,
      blockerCode: blocked ? 'missing-claim-gate-evidence' : null,
      missingEvidenceArtifacts: missingArtifacts
    },
    evidence: {
      requiredArtifacts,
      observedArtifacts,
      byArtifact: evidenceByArtifact,
      manifestVersion: evidenceManifest.version,
      manifestItemCount: evidenceManifest.items.length
    },
    security: {
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId
    }
  };

  return {
    version: `${CONTRACT_VERSION}.claim-gate.v1`,
    fileName: 'claim_gate.json',
    gateId,
    required: bootCompletionClaim,
    allowed: !blocked,
    blocked,
    blockerCodes: blocked ? ['missing-claim-gate-evidence'] : [],
    requiredEvidenceArtifacts: requiredArtifacts,
    observedEvidenceArtifacts: observedArtifacts,
    missingEvidenceArtifacts: missingArtifacts,
    payload,
    checksum: stableChecksum([gateId, stableChecksum([JSON.stringify(payload)])])
  };
}

function buildGateOperationalHealthImpact({ requestContext, operationalHealth, nowIso }) {
  const actionableErrors = Array.isArray(operationalHealth.actionableErrors)
    ? operationalHealth.actionableErrors
    : [];
  const primaryAction = operationalHealth.recoveryPlan?.primaryAction || null;
  const domainSeverity = (domain) => {
    if (operationalHealth.state === 'failed') return 'critical';
    if (operationalHealth.state === 'retry-wait') return 'warning';
    if (domain === 'run' && operationalHealth.state === 'degraded') return 'warning';
    return null;
  };
  const impactedDomains = VERIFIER_GATE_DOMAINS.filter((domain) => {
    if (domain === 'boot') {
      return operationalHealth.state === 'failed'
        && actionableErrors.some((error) => error.code === 'provider-reported-failed' || error.code === 'reported-health-invalid');
    }
    if (domain === 'run') return operationalHealth.state !== 'healthy';
    if (domain === 'claim') return operationalHealth.state === 'failed' || operationalHealth.state === 'retry-wait';
    return false;
  });
  const blockerByDomain = {
    boot: operationalHealth.primaryError?.code || 'provider-reported-failed',
    run: operationalHealth.primaryError?.code || `operational-health-${operationalHealth.state}`,
    claim: operationalHealth.state === 'retry-wait'
      ? 'retry-window-active'
      : operationalHealth.primaryError?.code || 'operational-health-failed'
  };
  const evidenceByDomain = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const impacted = impactedDomains.includes(domain);
    const blockingError = actionableErrors.find((error) => error.code === blockerByDomain[domain])
      || operationalHealth.primaryError
      || null;

    return [domain, impacted ? [{
      evidenceId: stableChecksum([
        'domain-health-impact',
        requestContext.requestId,
        domain,
        operationalHealth.state,
        blockerByDomain[domain],
        operationalHealth.retry.retryAfterAt
      ]),
      kind: `operational-health:${domain}`,
      source: 'operational-health',
      observedAt: operationalHealth.observedAt || nowIso,
      ref: blockerByDomain[domain],
      status: 'red',
      summary: blockingError?.message || `Operational health is ${operationalHealth.state} for ${domain} gate evaluation.`,
      severity: domainSeverity(domain),
      owner: blockingError?.owner || primaryAction?.owner || 'workflow',
      remediationAction: primaryAction?.action || blockingError?.action || 'inspect-provider-health',
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      recoveryPhase: operationalHealth.recoveryPlan?.phase || 'none'
    }] : []];
  }));

  return {
    impactedDomains,
    blockersByDomain: Object.fromEntries(impactedDomains.map((domain) => [domain, blockerByDomain[domain]])),
    evidenceByDomain
  };
}

function buildGateEvidenceNormalization({ requestContext, preview, evaluation, acceptance, readiness, lifecycle, externalHandoff, operationalHealth, securityBoundary, evidenceManifest, claimGate, nowIso }) {
  const normalizeGate = ({ gateId, domain, label, required = true, passed, blockers = [], evidence = [] }) => {
    const normalizedBlockers = Array.from(new Set(blockers.filter(Boolean))).sort();
    const normalizedEvidence = evidence
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        evidenceId: cleanString(item.evidenceId) || stableChecksum([
          'gate-evidence',
          requestContext.requestId,
          gateId,
          item.kind,
          index
        ]),
        kind: cleanString(item.kind) || 'gate-signal',
        status: item.status === 'red' ? 'red' : 'green',
        source: cleanString(item.source) || surfaceName,
        observedAt: coerceIso(item.observedAt || item.capturedAt, nowIso),
        ref: cleanString(item.ref),
        summary: cleanString(item.summary),
        severity: cleanString(item.severity),
        owner: cleanString(item.owner),
        remediationAction: cleanString(item.remediationAction),
        retryAfterAt: coerceIso(item.retryAfterAt, null),
        recoveryPhase: cleanString(item.recoveryPhase)
      }));
    const status = required && (!passed || normalizedBlockers.length > 0) ? 'red' : 'green';

    return {
      gateId,
      domain,
      label,
      required,
      passed: status === 'green',
      status,
      blockers: normalizedBlockers,
      evidence: normalizedEvidence,
      evidenceKinds: Array.from(new Set(normalizedEvidence.map((item) => item.kind))).sort(),
      checksum: stableChecksum([
        gateId,
        domain,
        status,
        normalizedBlockers.join(','),
        normalizedEvidence.map((item) => [
          item.kind,
          item.status,
          item.ref || item.evidenceId,
          item.remediationAction,
          item.retryAfterAt
        ].join(':')).join(',')
      ])
    };
  };
  const healthImpact = buildGateOperationalHealthImpact({ requestContext, operationalHealth, nowIso });
  const resultEvidence = evidenceManifest.items.filter((item) => item.kind === 'verifier-result');
  const timestampEvidence = evidenceManifest.items.filter((item) => item.kind === 'result-timestamp');
  const bindingEvidence = evidenceManifest.items.filter((item) => item.kind === 'claim-binding');
  const proofEvidence = evidenceManifest.items.filter((item) => item.kind === 'verifier-proof');
  const syncEvidence = evidenceManifest.items.filter((item) => item.kind === 'sync-checkpoint');
  const bootEvidence = evidenceManifest.items
    .filter((item) => claimGate.requiredEvidenceArtifacts.includes(item.kind) || claimGate.requiredEvidenceArtifacts.includes(item.evidenceId))
    .map((item) => ({
      evidenceId: item.evidenceId,
      kind: item.kind,
      source: item.source,
      observedAt: item.capturedAt,
      ref: item.uri || item.checksum,
      status: 'green',
      summary: item.summary
    }));
  const acceptanceEvidence = acceptance.criteria.map((criterion) => ({
    evidenceId: stableChecksum(['acceptance', requestContext.requestId, criterion.id]),
    kind: `acceptance:${criterion.id}`,
    source: 'acceptance-contract',
    observedAt: nowIso,
    ref: criterion.id,
    status: criterion.passed ? 'green' : 'red',
    summary: criterion.reason || criterion.label
  }));
  const runGatePassed = lifecycle.settings.enabled
    && lifecycle.issues.length === 0
    && operationalHealth.state === 'healthy'
    && externalHandoff.state !== 'failed'
    && securityBoundary.allowed
    && readiness.checks.syncObserved
    && readiness.checks.syncFresh;
  const runBlockers = [
    ...lifecycle.issues.map((issue) => `lifecycle:${issue}`),
    ...(lifecycle.settings.enabled ? [] : ['gate-disabled']),
    ...(healthImpact.blockersByDomain.run ? [healthImpact.blockersByDomain.run] : []),
    ...(operationalHealth.state === 'failed' ? ['operational-health-failed'] : []),
    ...(operationalHealth.state === 'retry-wait' ? ['retry-window-active'] : []),
    ...(externalHandoff.state === 'failed' ? ['handoff-failed'] : []),
    ...(readiness.checks.syncObserved ? [] : ['sync-not-observed']),
    ...(readiness.checks.syncFresh ? [] : ['sync-stale']),
    ...securityBoundary.blockers
  ];
  const gates = [
    normalizeGate({
      gateId: 'boot-gate',
      domain: 'boot',
      label: 'Boot completion evidence',
      required: claimGate.required,
      passed: !claimGate.required || claimGate.allowed,
      blockers: [
        ...claimGate.blockerCodes,
        ...(healthImpact.blockersByDomain.boot ? [healthImpact.blockersByDomain.boot] : [])
      ],
      evidence: [
        ...bootEvidence,
        ...healthImpact.evidenceByDomain.boot,
        ...claimGate.missingEvidenceArtifacts.map((artifact) => ({
          evidenceId: stableChecksum(['missing-boot-artifact', requestContext.requestId, artifact]),
          kind: artifact,
          source: claimGate.fileName,
          observedAt: nowIso,
          ref: artifact,
          status: 'red',
          summary: `Required boot artifact is missing: ${artifact}`
        }))
      ]
    }),
    normalizeGate({
      gateId: 'run-gate',
      domain: 'run',
      label: 'Verifier run and handoff health',
      passed: runGatePassed,
      blockers: runBlockers,
      evidence: [
        {
          evidenceId: stableChecksum(['run-health', requestContext.requestId, operationalHealth.state]),
          kind: 'operational-health',
          source: 'hosted-kernel',
          observedAt: operationalHealth.observedAt,
          ref: operationalHealth.primaryError?.code || operationalHealth.state,
          status: runGatePassed ? 'green' : 'red',
          summary: operationalHealth.primaryError?.message || `Operational health is ${operationalHealth.state}`
        },
        {
          evidenceId: stableChecksum(['run-sync', requestContext.requestId, readiness.checks.syncObserved, readiness.checks.syncFresh]),
          kind: 'sync-freshness',
          source: 'verifier-result-sync',
          observedAt: syncEvidence[0]?.capturedAt || nowIso,
          ref: syncEvidence[0]?.checksum || readiness.state,
          status: readiness.checks.syncObserved && readiness.checks.syncFresh ? 'green' : 'red',
          summary: readiness.checks.syncObserved
            ? readiness.checks.syncFresh
              ? 'Verifier-result sync is fresh.'
              : 'Verifier-result sync is stale.'
            : 'Verifier-result sync has not been observed.'
        },
        {
          evidenceId: stableChecksum(['run-handoff', requestContext.requestId, externalHandoff.state]),
          kind: 'handoff-state',
          source: externalHandoff.service,
          observedAt: externalHandoff.requestedAt || nowIso,
          ref: externalHandoff.handoffId || externalHandoff.target || externalHandoff.state,
          status: externalHandoff.state === 'failed' ? 'red' : 'green',
          summary: `External handoff state is ${externalHandoff.state}`
        },
        ...healthImpact.evidenceByDomain.run,
        ...syncEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          source: item.source,
          observedAt: item.capturedAt,
          ref: item.uri || item.checksum,
          status: readiness.checks.syncFresh ? 'green' : 'red',
          summary: item.summary
        }))
      ]
    }),
    normalizeGate({
      gateId: 'claim-gate',
      domain: 'claim',
      label: 'Claim release decision',
      passed: acceptance.accepted
        && readiness.state === 'ready'
        && evaluation.canReleaseClaim
        && !healthImpact.blockersByDomain.claim,
      blockers: [
        ...evaluation.reasons,
        ...acceptance.failedCriteria.map((criterion) => `acceptance:${criterion}`),
        ...(readiness.state === 'ready' ? [] : [`readiness:${readiness.state}`]),
        ...(healthImpact.blockersByDomain.claim ? [healthImpact.blockersByDomain.claim] : [])
      ],
      evidence: [
        ...resultEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          source: item.source,
          observedAt: item.capturedAt,
          ref: item.uri || item.checksum,
          status: evaluation.proof.accepted ? 'green' : 'red',
          summary: item.summary
        })),
        ...timestampEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          source: item.source,
          observedAt: item.capturedAt,
          ref: evaluation.timestamp.auditFingerprint,
          status: evaluation.timestamp.valid ? 'green' : 'red',
          summary: item.summary
        })),
        ...bindingEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          source: item.source,
          observedAt: item.capturedAt,
          ref: evaluation.claimBinding.auditFingerprint,
          status: evaluation.claimBinding.bound ? 'green' : 'red',
          summary: item.summary
        })),
        ...proofEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          kind: item.kind,
          source: item.source,
          observedAt: item.capturedAt,
          ref: item.uri || item.checksum,
          status: evaluation.proof.present ? 'green' : 'red',
          summary: item.summary
        })),
        ...healthImpact.evidenceByDomain.claim,
        ...acceptanceEvidence
      ]
    })
  ];
  const summary = gates.reduce((acc, gate) => {
    acc[gate.status] += 1;
    acc.total += 1;
    if (gate.required) acc.required += 1;
    return acc;
  }, { green: 0, red: 0, total: 0, required: 0 });

  return {
    version: `${CONTRACT_VERSION}.gate-evidence.v1`,
    normalizedAt: nowIso,
    claimId: preview.claimId,
    resultId: preview.resultId,
    status: summary.red === 0 ? 'green' : 'red',
    summary,
    gates,
    redEvidence: gates.flatMap((gate) => gate.evidence
      .filter((item) => item.status === 'red')
      .map((item) => ({ gateId: gate.gateId, domain: gate.domain, ...item }))),
    greenEvidence: gates.flatMap((gate) => gate.evidence
      .filter((item) => item.status === 'green')
      .map((item) => ({ gateId: gate.gateId, domain: gate.domain, ...item }))),
    checksum: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      preview.resultId,
      gates.map((gate) => `${gate.gateId}:${gate.status}:${gate.checksum}`).join(',')
    ])
  };
}

function normalizeVerifierGateResultEvidence({ requestContext, preview, acceptance, readiness, operationalHealth, claimGate, gateEvidence, nowIso }) {
  const evidenceIndex = gateEvidence.gates.flatMap((gate) => gate.evidence.map((item) => ({
    evidenceId: item.evidenceId,
    gateId: gate.gateId,
    domain: gate.domain,
    kind: item.kind,
    status: VERIFIER_GATE_STATUSES.has(item.status) ? item.status : gate.status,
    source: item.source,
    observedAt: item.observedAt,
    ref: item.ref,
    summary: item.summary,
    severity: item.severity,
    owner: item.owner,
    remediationAction: item.remediationAction,
    retryAfterAt: item.retryAfterAt,
    recoveryPhase: item.recoveryPhase,
    actionable: item.status === 'red' && Boolean(item.remediationAction),
    checksum: stableChecksum([
      gate.gateId,
      gate.domain,
      item.evidenceId,
      item.kind,
      item.status,
      item.ref,
      item.remediationAction,
      item.retryAfterAt
    ])
  })));
  const domains = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const gates = gateEvidence.gates.filter((gate) => gate.domain === domain);
    const requiredGates = gates.filter((gate) => gate.required);
    const redGates = gates.filter((gate) => gate.status === 'red');
    const domainEvidence = evidenceIndex.filter((item) => item.domain === domain);
    const redEvidence = domainEvidence.filter((item) => item.status === 'red');
    const greenEvidence = domainEvidence.filter((item) => item.status === 'green');
    const primaryGate = redGates[0] || requiredGates[0] || gates[0] || null;

    return [domain, {
      status: redGates.length > 0 ? 'red' : 'green',
      passed: redGates.length === 0,
      required: requiredGates.length > 0,
      gateIds: gates.map((gate) => gate.gateId),
      requiredGateIds: requiredGates.map((gate) => gate.gateId),
      redGateIds: redGates.map((gate) => gate.gateId),
      blockerCodes: Array.from(new Set(gates.flatMap((gate) => gate.blockers))).sort(),
      primaryBlocker: redGates.flatMap((gate) => gate.blockers)[0] || null,
      actionableErrorCodes: Array.from(new Set(redEvidence
        .map((item) => item.ref)
        .filter(Boolean))).sort(),
      primaryRemediationAction: redEvidence.find((item) => item.remediationAction)?.remediationAction || null,
      retryAfterAt: redEvidence.find((item) => item.retryAfterAt)?.retryAfterAt || null,
      owner: redEvidence.find((item) => item.owner)?.owner || null,
      evidenceCounts: {
        total: domainEvidence.length,
        green: greenEvidence.length,
        red: redEvidence.length
      },
      greenEvidenceRefs: greenEvidence.map((item) => item.evidenceId),
      redEvidenceRefs: redEvidence.map((item) => item.evidenceId),
      primaryGateChecksum: primaryGate?.checksum || null
    }];
  }));
  const requiredDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].required);
  const redRequiredDomains = requiredDomains.filter((domain) => domains[domain].status === 'red');
  const totals = {
    gates: gateEvidence.summary.total,
    requiredGates: gateEvidence.summary.required,
    greenGates: gateEvidence.summary.green,
    redGates: gateEvidence.summary.red,
    evidence: evidenceIndex.length,
    greenEvidence: evidenceIndex.filter((item) => item.status === 'green').length,
    redEvidence: evidenceIndex.filter((item) => item.status === 'red').length
  };
  const releaseDecision = acceptance.accepted && readiness.state === 'ready' && operationalHealth.state === 'healthy' && redRequiredDomains.length === 0
    ? 'release-authorized'
    : readiness.state === 'needs-refresh' || operationalHealth.state === 'retry-wait'
      ? 'refresh-required'
      : 'release-blocked';

  return {
    version: `${CONTRACT_VERSION}.normalized-gate-result.v1`,
    normalizedAt: nowIso,
    claimId: preview.claimId,
    resultId: preview.resultId,
    status: gateEvidence.status,
    requiredStatus: redRequiredDomains.length === 0 ? 'green' : 'red',
    releaseDecision,
    domains,
    requiredDomains,
    redRequiredDomains,
    missingBootEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
    failedAcceptanceCriteria: acceptance.failedCriteria,
    readinessState: readiness.state,
    healthState: operationalHealth.state,
    totals,
    redEvidence: evidenceIndex.filter((item) => item.status === 'red'),
    greenEvidence: evidenceIndex.filter((item) => item.status === 'green'),
    checksum: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      preview.resultId,
      gateEvidence.checksum,
      redRequiredDomains.join(','),
      releaseDecision,
      totals.redEvidence,
      totals.greenEvidence
    ])
  };
}

function buildGateDecisionCards({ requestContext, preview, gateResultNormalization, gateEvidence, acceptance, readiness, clientNextSteps, nowIso }) {
  const routeBase = requestContext.returnRoute || requestContext.surfaceRoute;
  const routeForPanel = (panel) => {
    const separator = routeBase.includes('?') ? '&' : '?';
    return `${routeBase}${separator}panel=${panel}`;
  };
  const domainMeta = {
    boot: { title: 'Boot evidence', panel: 'proof', readyAction: 'inspect-boot-evidence' },
    run: { title: 'Run health', panel: 'audit', readyAction: 'inspect-run-health' },
    claim: { title: 'Claim release', panel: 'handoff', readyAction: 'inspect-claim-decision' }
  };
  const actionPanel = (action, fallbackPanel) => {
    if (action === 'attach-proof' || action === 'attach-claim-gate-evidence') return 'proof';
    if (action === 'release-claim' || action === 'request-refresh' || action === 'repair-handoff') return 'handoff';
    if (action === 'enable-gate' || action === 'correct-lifecycle-command') return 'settings';
    if (action === 'escalate-operational-health' || action === 'grant-verifier-permissions') return 'audit';
    return fallbackPanel;
  };
  const pickStepForDomain = (domain, domainState) => {
    const steps = clientNextSteps.steps || [];
    if (domain === 'boot' && gateResultNormalization.missingBootEvidenceArtifacts.length > 0) {
      return {
        action: 'attach-claim-gate-evidence',
        label: 'Attach missing boot evidence artifacts',
        reasons: gateResultNormalization.missingBootEvidenceArtifacts,
        enabled: true
      };
    }
    if (domain === 'run') {
      return steps.find((step) => [
        'request-refresh',
        'repair-handoff',
        'wait-for-backoff',
        'escalate-operational-health',
        'grant-verifier-permissions',
        'restore-tenant-workspace-scope'
      ].includes(step.action)) || null;
    }
    if (domain === 'claim') {
      return steps.find((step) => [
        'release-claim',
        'attach-proof',
        'wait-for-acceptance',
        'request-bound-verifier-result',
        'replace-mismatched-verifier-result',
        'attach-claim-identity'
      ].includes(step.action)) || null;
    }
    return domainState.status === 'red' ? clientNextSteps.primary : null;
  };
  const cards = VERIFIER_GATE_DOMAINS.map((domain, index) => {
    const meta = domainMeta[domain];
    const domainState = gateResultNormalization.domains[domain];
    const redEvidence = gateResultNormalization.redEvidence.filter((item) => item.domain === domain);
    const greenEvidence = gateResultNormalization.greenEvidence.filter((item) => item.domain === domain);
    const sourceGate = gateEvidence.gates.find((gate) => gate.domain === domain) || null;
    const selectedStep = pickStepForDomain(domain, domainState);
    const fallbackAction = domainState.status === 'green' ? meta.readyAction : clientNextSteps.primary.action;
    const action = selectedStep?.action || fallbackAction;
    const routePanel = actionPanel(action, meta.panel);
    const reasonCodes = domainState.status === 'red'
      ? Array.from(new Set([
          domainState.primaryBlocker,
          ...domainState.blockerCodes,
          ...redEvidence.map((item) => item.ref)
        ].filter(Boolean))).sort()
      : [];

    return {
      cardId: stableChecksum([
        'gate-decision-card',
        requestContext.requestId,
        preview.claimId,
        domain,
        domainState.status,
        domainState.primaryBlocker,
        index
      ]),
      order: index + 1,
      domain,
      title: meta.title,
      status: domainState.status,
      tone: domainState.status === 'green' ? 'success' : domain === 'run' ? 'warning' : 'critical',
      required: domainState.required,
      passed: domainState.passed,
      routePanel,
      route: routeForPanel(routePanel),
      gateIds: domainState.gateIds,
      requiredGateIds: domainState.requiredGateIds,
      redGateIds: domainState.redGateIds,
      primaryBlocker: domainState.primaryBlocker,
      blockerCount: domainState.blockerCodes.length,
      blockers: domainState.blockerCodes,
      acceptanceFailedCriteria: domain === 'claim' ? acceptance.failedCriteria : [],
      readinessMissing: domain === 'run' ? readiness.missing : [],
      evidenceCounts: domainState.evidenceCounts,
      evidencePreview: (redEvidence.length > 0 ? redEvidence : greenEvidence).slice(0, 3).map((item) => ({
        evidenceId: item.evidenceId,
        kind: item.kind,
        status: item.status,
        source: item.source,
        summary: item.summary,
        remediationAction: item.remediationAction,
        retryAfterAt: item.retryAfterAt
      })),
      nextStep: {
        action,
        label: selectedStep?.label || (domainState.status === 'green' ? `Review ${meta.title.toLowerCase()}` : clientNextSteps.primary.label),
        enabled: domainState.status === 'green' || !selectedStep?.disabledReasons?.length,
        routePanel,
        route: routeForPanel(routePanel),
        lifecycleCommand: selectedStep?.command || null,
        capability: selectedStep?.capability || null,
        retryAfterAt: selectedStep?.retryAfterAt || domainState.retryAfterAt || null,
        reasonCodes
      },
      sourceGateChecksum: sourceGate?.checksum || domainState.primaryGateChecksum
    };
  });
  const primaryCard = cards.find((card) => card.status === 'red') || cards.find((card) => card.domain === 'claim') || cards[0] || null;

  return {
    version: `${CONTRACT_VERSION}.gate-decision-cards.v1`,
    generatedAt: nowIso,
    claimId: preview.claimId,
    resultId: preview.resultId,
    state: gateResultNormalization.releaseDecision,
    headline: gateResultNormalization.releaseDecision === 'release-authorized'
      ? 'All verifier gates are green'
      : gateResultNormalization.releaseDecision === 'refresh-required'
        ? 'Verifier gates need a refresh'
        : 'Verifier gates need attention',
    summary: {
      totalCards: cards.length,
      greenCards: cards.filter((card) => card.status === 'green').length,
      redCards: cards.filter((card) => card.status === 'red').length,
      requiredStatus: gateResultNormalization.requiredStatus,
      redRequiredDomains: gateResultNormalization.redRequiredDomains,
      releaseDecision: gateResultNormalization.releaseDecision
    },
    primaryCardId: primaryCard?.cardId || null,
    primaryDomain: primaryCard?.domain || null,
    routeSlots: {
      boot: routeForPanel(domainMeta.boot.panel),
      run: routeForPanel(domainMeta.run.panel),
      claim: routeForPanel(domainMeta.claim.panel),
      primary: primaryCard?.route || routeForPanel('overview')
    },
    cards,
    checksum: stableChecksum([
      requestContext.requestId,
      preview.claimId,
      gateResultNormalization.checksum,
      cards.map((card) => `${card.domain}:${card.status}:${card.nextStep.action}:${card.primaryBlocker || 'none'}`).join(',')
    ])
  };
}

function buildGateWorkflowHandoff({ requestContext, clientState, preview, gateResultNormalization, gateDecisionCards, externalHandoff, nowIso }) {
  const primaryDomain = gateResultNormalization.redRequiredDomains[0]
    || gateDecisionCards.primaryDomain
    || 'claim';
  const primaryCard = gateDecisionCards.cards.find((card) => card.domain === primaryDomain)
    || gateDecisionCards.cards.find((card) => card.cardId === gateDecisionCards.primaryCardId)
    || gateDecisionCards.cards[0]
    || null;
  const domainStatuses = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const domainState = gateResultNormalization.domains[domain];
    const card = gateDecisionCards.cards.find((candidate) => candidate.domain === domain) || {};

    return [domain, {
      status: domainState.status,
      required: domainState.required,
      passed: domainState.passed,
      route: card.route || gateDecisionCards.routeSlots[domain] || null,
      routePanel: card.routePanel || null,
      blockerCount: domainState.blockerCodes.length,
      primaryBlocker: domainState.primaryBlocker,
      redEvidenceCount: domainState.evidenceCounts.red,
      greenEvidenceCount: domainState.evidenceCounts.green,
      nextAction: card.nextStep?.action || null,
      nextActionEnabled: card.nextStep?.enabled === true
    }];
  }));
  const redRequiredDomains = gateResultNormalization.redRequiredDomains;
  const requiredGreen = redRequiredDomains.length === 0;
  const blocked = !requiredGreen || externalHandoff.state === 'failed';
  const state = requiredGreen
    ? gateResultNormalization.releaseDecision === 'release-authorized'
      ? 'handoff-release-ready'
      : 'handoff-review-ready'
    : gateResultNormalization.releaseDecision === 'refresh-required'
      ? 'handoff-refresh-required'
      : 'handoff-domain-blocked';
  const dispatchHints = gateDecisionCards.cards.map((card) => {
    const domainState = gateResultNormalization.domains[card.domain];
    const blockedReasons = Array.from(new Set([
      ...(domainState.status === 'red' ? domainState.blockerCodes : []),
      ...(card.nextStep?.reasonCodes || []),
      ...(externalHandoff.state === 'failed' ? ['handoff-failed'] : []),
      ...(card.nextStep?.enabled === false ? ['next-step-disabled'] : [])
    ].filter(Boolean))).sort();

    return {
      hintId: stableChecksum([
        'gate-workflow-handoff-hint',
        requestContext.requestId,
        preview.claimId,
        card.domain,
        domainState.status,
        card.nextStep?.action
      ]),
      domain: card.domain,
      status: domainState.status,
      action: card.nextStep?.action || 'inspect-verifier-result',
      label: card.nextStep?.label || card.title,
      route: card.nextStep?.route || card.route,
      routePanel: card.nextStep?.routePanel || card.routePanel,
      enabled: blockedReasons.length === 0,
      blockedReasons,
      redEvidenceRefs: domainState.redEvidenceRefs,
      greenEvidenceRefs: domainState.greenEvidenceRefs,
      evidenceCounts: domainState.evidenceCounts,
      retryAfterAt: card.nextStep?.retryAfterAt || domainState.retryAfterAt || null
    };
  });
  const primaryHint = dispatchHints.find((hint) => hint.domain === primaryDomain)
    || dispatchHints.find((hint) => hint.enabled)
    || dispatchHints[0]
    || null;
  const handoffId = stableChecksum([
    'gate-workflow-handoff',
    requestContext.requestId,
    requestContext.idempotencyKey,
    preview.claimId,
    gateResultNormalization.checksum,
    primaryDomain,
    state
  ]);
  const userVisibleLabel = requiredGreen
    ? 'Verifier gate evidence is ready for workflow handoff'
    : `${primaryDomain} gate needs attention before workflow handoff`;

  return {
    version: `${CONTRACT_VERSION}.gate-workflow-handoff.v1`,
    handoffId,
    generatedAt: nowIso,
    state,
    blocked,
    requiredGreen,
    releaseDecision: gateResultNormalization.releaseDecision,
    primaryDomain,
    primaryCardId: primaryCard?.cardId || null,
    primaryRoute: primaryHint?.route || primaryCard?.route || clientState.route,
    primaryPanel: primaryHint?.routePanel || primaryCard?.routePanel || clientState.activePanel,
    primaryAction: primaryHint?.action || 'inspect-verifier-result',
    primaryLabel: primaryHint?.label || userVisibleLabel,
    userVisibleLabel,
    redRequiredDomains,
    greenDomains: VERIFIER_GATE_DOMAINS.filter((domain) => gateResultNormalization.domains[domain].status === 'green'),
    domainStatuses,
    dispatchHints,
    clientStatePatch: {
      gateWorkflowHandoffId: handoffId,
      gateWorkflowState: state,
      gateReleaseDecision: gateResultNormalization.releaseDecision,
      gateEvidenceStatus: gateResultNormalization.status,
      primaryGateDomain: primaryDomain,
      primaryGateRoute: primaryHint?.route || primaryCard?.route || null,
      redRequiredDomains,
      greenGateDomains: VERIFIER_GATE_DOMAINS.filter((domain) => gateResultNormalization.domains[domain].status === 'green'),
      pendingAction: primaryHint?.enabled ? primaryHint.action : 'inspect-verifier-result',
      activePanel: primaryHint?.routePanel || primaryCard?.routePanel || clientState.activePanel,
      lastGateWorkflowObservedAt: nowIso
    },
    audit: {
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      idempotencyKey: requestContext.idempotencyKey,
      checksumSource: gateResultNormalization.checksum,
      redEvidenceCount: gateResultNormalization.totals.redEvidence,
      greenEvidenceCount: gateResultNormalization.totals.greenEvidence
    },
    checksum: stableChecksum([
      handoffId,
      state,
      primaryDomain,
      redRequiredDomains.join(','),
      dispatchHints.map((hint) => `${hint.domain}:${hint.action}:${hint.enabled}:${hint.blockedReasons.join('+')}`).join(',')
    ])
  };
}

function buildPersistedGateStateSnapshot({ requestContext, preview, gateResultNormalization, gateEvidence, gateWorkflowHandoff, nextRevision, nowIso }) {
  const domains = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const domainState = gateResultNormalization.domains[domain];
    const workflowState = gateWorkflowHandoff.domainStatuses[domain] || {};
    return [domain, {
      status: domainState.status,
      required: domainState.required,
      passed: domainState.passed,
      primaryBlocker: domainState.primaryBlocker,
      primaryRemediationAction: domainState.primaryRemediationAction,
      retryAfterAt: domainState.retryAfterAt,
      owner: domainState.owner,
      redEvidenceCount: domainState.evidenceCounts.red,
      greenEvidenceCount: domainState.evidenceCounts.green,
      evidenceCount: domainState.evidenceCounts.total,
      routePanel: workflowState.routePanel || null,
      nextAction: workflowState.nextAction || null,
      nextActionEnabled: workflowState.nextActionEnabled === true
    }];
  }));
  const redDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].status === 'red');
  const greenDomains = VERIFIER_GATE_DOMAINS.filter((domain) => domains[domain].status === 'green');
  const primaryRedDomain = gateResultNormalization.redRequiredDomains[0]
    || redDomains[0]
    || null;
  const snapshotId = stableChecksum([
    'persisted-gate-state',
    PERSISTED_STATE_VERSION,
    requestContext.idempotencyKey,
    preview.claimId,
    preview.resultId,
    nextRevision,
    gateResultNormalization.checksum
  ]);
  const checksum = stableChecksum([
    snapshotId,
    gateEvidence.checksum,
    gateWorkflowHandoff.checksum,
    gateResultNormalization.releaseDecision,
    primaryRedDomain,
    redDomains.join(','),
    greenDomains.join(',')
  ]);

  return {
    version: `${PERSISTED_STATE_VERSION}.gate-state-snapshot.v1`,
    snapshotId,
    observedAt: nowIso,
    stateRevision: nextRevision,
    claimId: preview.claimId,
    resultId: preview.resultId,
    checksum,
    gateEvidenceChecksum: gateEvidence.checksum,
    normalizedGateChecksum: gateResultNormalization.checksum,
    gateWorkflowHandoffId: gateWorkflowHandoff.handoffId,
    gateWorkflowState: gateWorkflowHandoff.state,
    releaseDecision: gateResultNormalization.releaseDecision,
    requiredStatus: gateResultNormalization.requiredStatus,
    status: gateResultNormalization.status,
    primaryRedDomain,
    redDomains,
    greenDomains,
    requiredDomains: gateResultNormalization.requiredDomains,
    redRequiredDomains: gateResultNormalization.redRequiredDomains,
    domains,
    restartSafe: {
      recoverable: redDomains.length > 0 || gateWorkflowHandoff.blocked,
      statusSemantics: redDomains.length > 0
        ? 'state committed with red verifier gate evidence that can be resumed after restart'
        : 'state committed with all verifier gate domains green',
      nextRecoveryDomain: primaryRedDomain,
      resumeHandoffId: gateWorkflowHandoff.handoffId
    }
  };
}

function buildHostedKernelProofReceipt({ requestContext, preview, evaluation, providerContract, syncMetadata, externalHandoff, acceptance, readiness, operationalHealth, evidenceManifest, claimGate, gateEvidence, gateResultNormalization, nextPersistedState, workflowHandoff, securityBoundary, nowIso }) {
  const missingEvidenceKinds = evidenceManifest.requiredKinds.filter((kind) => !evidenceManifest.observedKinds.includes(kind));
  const receiptInputs = [
    CONTRACT_VERSION,
    requestContext.requestId,
    requestContext.correlationId,
    requestContext.idempotencyKey,
    preview.claimId,
    preview.resultId,
    evaluation.proof.proofId,
    evaluation.nextAction,
    acceptance.accepted,
    externalHandoff.state,
    evaluation.claimBinding.auditFingerprint,
    securityBoundary.scopeHash,
    securityBoundary.allowed,
    securityBoundary.workspaceDecision.decisionId,
    syncMetadata.cursor,
    nextPersistedState.stateId,
    nextPersistedState.stateRevision,
    claimGate.checksum,
    evidenceManifest.items.map((item) => item.checksum).join(',')
  ];
  const receiptId = stableChecksum(receiptInputs);
  const auditEventId = stableChecksum(['audit-event', receiptId, requestContext.surfaceRoute]);
  const decisionEventId = stableChecksum(['decision-event', receiptId, evaluation.nextAction]);
  const releaseAuthorized = acceptance.accepted
    && readiness.state === 'ready'
    && operationalHealth.state === 'healthy'
    && securityBoundary.allowed
    && claimGate.allowed
    && missingEvidenceKinds.length === 0;

  return {
    version: `${CONTRACT_VERSION}.hosted-kernel-proof-receipt`,
    receiptId,
    issuedAt: nowIso,
    releaseAuthorized,
    decision: {
      action: evaluation.nextAction,
      accepted: acceptance.accepted,
      canReleaseClaim: evaluation.canReleaseClaim,
      claimBinding: {
        status: evaluation.claimBinding.status,
        bound: evaluation.claimBinding.bound,
        expectedClaimId: evaluation.claimBinding.expectedClaimId,
        resultClaimId: evaluation.claimBinding.resultClaimId,
        blocker: evaluation.claimBinding.blocker,
        auditFingerprint: evaluation.claimBinding.auditFingerprint
      },
      timestamp: {
        status: evaluation.timestamp.status,
        selectedField: evaluation.timestamp.selectedField,
        observedAt: evaluation.timestamp.observedAt,
        resultAgeMs: evaluation.timestamp.resultAgeMs,
        rawAgeMs: evaluation.timestamp.rawAgeMs,
        futureSkewMs: evaluation.timestamp.futureSkewMs,
        maxFutureSkewMs: evaluation.timestamp.maxFutureSkewMs,
        auditFingerprint: evaluation.timestamp.auditFingerprint
      },
      failedCriteria: acceptance.failedCriteria,
      blockerCodes: [...evaluation.reasons, ...securityBoundary.blockers, ...claimGate.blockerCodes]
    },
    security: {
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      actorId: securityBoundary.actor.actorId,
      allowed: securityBoundary.allowed,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceStatus: securityBoundary.workspaceDecision.status,
      dispatchSafe: securityBoundary.workspaceDecision.dispatchSafe,
      handoffPolicy: securityBoundary.workspaceDecision.handoffPolicy,
      requiredPermissions: securityBoundary.requiredPermissions,
      missingPermissions: securityBoundary.missingPermissions
    },
    proof: {
      token: workflowHandoff.auditProof.proofToken,
      verifierProofId: evaluation.proof.proofId,
      required: evaluation.proof.required,
      claimBindingFingerprint: evaluation.claimBinding.auditFingerprint,
      timestampFingerprint: evaluation.timestamp.auditFingerprint,
      missingEvidenceKinds,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      evidenceChecksums: evidenceManifest.items.map((item) => item.checksum)
    },
    claimGate: {
      fileName: claimGate.fileName,
      gateId: claimGate.gateId,
      required: claimGate.required,
      allowed: claimGate.allowed,
      checksum: claimGate.checksum,
      missingEvidenceArtifacts: claimGate.missingEvidenceArtifacts
    },
    gateEvidence: {
      version: gateEvidence.version,
      status: gateEvidence.status,
      checksum: gateEvidence.checksum,
      greenGateCount: gateEvidence.summary.green,
      redGateCount: gateEvidence.summary.red,
      redEvidenceKinds: Array.from(new Set(gateEvidence.redEvidence.map((item) => item.kind))).sort(),
      gates: gateEvidence.gates.map((gate) => ({
        gateId: gate.gateId,
        domain: gate.domain,
        status: gate.status,
        blockers: gate.blockers,
        checksum: gate.checksum
      }))
    },
    normalizedGateResult: {
      version: gateResultNormalization.version,
      status: gateResultNormalization.status,
      requiredStatus: gateResultNormalization.requiredStatus,
      releaseDecision: gateResultNormalization.releaseDecision,
      checksum: gateResultNormalization.checksum,
      redRequiredDomains: gateResultNormalization.redRequiredDomains,
      missingBootEvidenceArtifacts: gateResultNormalization.missingBootEvidenceArtifacts,
      totals: gateResultNormalization.totals
    },
    integrationEvents: [
      {
        eventId: decisionEventId,
        topic: 'verifier-result.decision.recorded',
        requiredCapability: PROVIDER_CAPABILITIES.auditWrite,
        payloadRef: receiptId,
        serviceContractId: providerContract.serviceContractId,
        handoffProtocol: providerContract.handoffProtocol,
        workspaceDecisionId: securityBoundary.workspaceDecision.decisionId
      },
      {
        eventId: auditEventId,
        topic: releaseAuthorized ? 'claim.release.authorized' : 'claim.release.blocked',
        requiredCapability: releaseAuthorized ? PROVIDER_CAPABILITIES.claimRelease : PROVIDER_CAPABILITIES.auditWrite,
        payloadRef: receiptId,
        serviceContractId: providerContract.serviceContractId,
        handoffProtocol: providerContract.handoffProtocol,
        workspaceDecisionId: securityBoundary.workspaceDecision.decisionId
      },
      {
        eventId: stableChecksum(['boundary-event', receiptId, securityBoundary.workspaceDecision.decisionId]),
        topic: securityBoundary.auditHandoff.topic,
        requiredCapability: securityBoundary.auditHandoff.requiredCapability,
        payloadRef: securityBoundary.workspaceDecision.decisionId,
        serviceContractId: providerContract.serviceContractId,
        handoffProtocol: providerContract.handoffProtocol,
        workspaceDecisionId: securityBoundary.workspaceDecision.decisionId
      }
    ],
    anchors: {
      stateId: nextPersistedState.stateId,
      stateRevision: nextPersistedState.stateRevision,
      syncCursor: syncMetadata.cursor,
      syncCheckpoint: syncMetadata.checkpoint,
      providerId: providerContract.providerId,
      providerService: providerContract.service,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      handoffProtocol: providerContract.handoffProtocol,
      claimBindingStatus: evaluation.claimBinding.status,
      claimBindingFingerprint: evaluation.claimBinding.auditFingerprint,
      resultTimestampStatus: evaluation.timestamp.status,
      resultTimestampFingerprint: evaluation.timestamp.auditFingerprint,
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
      handoffState: externalHandoff.state,
      handoffTarget: externalHandoff.target
    },
    checksumInputs: [
      'contractVersion',
      'requestId',
      'correlationId',
      'idempotencyKey',
      'claimId',
      'resultId',
      'proofId',
      'decision',
      'accepted',
      'handoffState',
      'resultTimestampFingerprint',
      'claimBindingFingerprint',
      'scopeHash',
      'boundaryAllowed',
      'syncCursor',
      'stateId',
      'stateRevision',
      'claimGateChecksum',
      'evidenceChecksums',
      'workspaceDecisionId'
    ]
  };
}

function incrementCounter(counters, key, by = 1) {
  counters[key] = (counters[key] || 0) + by;
}

function classifyAnalyticsSnapshot(snapshot) {
  if (snapshot.releaseAuthorized) return 'release-authorized';
  if (snapshot.primaryErrorCode) return 'operator-attention';
  if (snapshot.decision === 'request-refresh' || snapshot.retryable) return 'refresh-monitoring';
  if (snapshot.accepted) return 'release-review';
  return 'blocked-review';
}

function buildAnalyticsDimensions(snapshot) {
  return {
    outcome: classifyAnalyticsSnapshot(snapshot),
    decision: snapshot.decision || 'unknown',
    healthState: snapshot.healthState || 'unknown',
    readinessState: snapshot.readinessState || 'unknown',
    gateEvidenceStatus: snapshot.gateEvidenceStatus || 'unknown',
    handoffState: snapshot.handoffState || 'none',
    workflowState: snapshot.workflowState || 'unknown',
    providerMode: snapshot.providerMode || 'unknown',
    providerService: snapshot.providerService || 'unknown',
    handoffProtocol: snapshot.handoffProtocol || 'unknown',
    syncStatus: snapshot.syncStatus || 'unknown'
  };
}

function buildRollingAnalyticsSummary(history) {
  const totals = {
    releaseAuthorized: 0,
    blocked: 0,
    retryable: 0,
    replayed: 0,
    resultFresh: 0,
    syncFresh: 0,
    handoffAttention: 0
  };
  const byOutcome = {};
  const byDecision = {};
  const byHealthState = {};
  const errorCodes = {};

  for (const snapshot of history) {
    const dimensions = buildAnalyticsDimensions(snapshot);
    incrementCounter(byOutcome, dimensions.outcome);
    incrementCounter(byDecision, dimensions.decision);
    incrementCounter(byHealthState, dimensions.healthState);
    if (snapshot.primaryErrorCode) incrementCounter(errorCodes, snapshot.primaryErrorCode);
    if (snapshot.releaseAuthorized) incrementCounter(totals, 'releaseAuthorized');
    if (!snapshot.accepted || snapshot.blockerCount > 0) incrementCounter(totals, 'blocked');
    if (snapshot.retryable) incrementCounter(totals, 'retryable');
    if (snapshot.replayed) incrementCounter(totals, 'replayed');
    if (snapshot.resultAgeMs !== null && snapshot.resultAgeMs <= ANALYTICS_SLA_THRESHOLDS_MS.resultFresh) {
      incrementCounter(totals, 'resultFresh');
    }
    if (snapshot.syncLagMs !== null && snapshot.syncLagMs <= ANALYTICS_SLA_THRESHOLDS_MS.syncFresh) {
      incrementCounter(totals, 'syncFresh');
    }
    if (snapshot.handoffState === 'failed' || (snapshot.handoffState === 'queued' && snapshot.releaseAuthorized)) {
      incrementCounter(totals, 'handoffAttention');
    }
  }

  const observations = history.length;
  return {
    observations,
    rates: {
      releaseAuthorization: observations === 0 ? 0 : totals.releaseAuthorized / observations,
      blocked: observations === 0 ? 0 : totals.blocked / observations,
      retryable: observations === 0 ? 0 : totals.retryable / observations,
      replayed: observations === 0 ? 0 : totals.replayed / observations,
      resultFresh: observations === 0 ? 0 : totals.resultFresh / observations,
      syncFresh: observations === 0 ? 0 : totals.syncFresh / observations
    },
    totals,
    byOutcome,
    byDecision,
    byHealthState,
    errorCodes
  };
}

function buildGateDomainAnalytics({ gateResultNormalization, history }) {
  const currentDomains = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => {
    const current = gateResultNormalization.domains[domain] || {};
    return [domain, {
      status: VERIFIER_GATE_STATUSES.has(current.status) ? current.status : 'red',
      required: current.required === true,
      blockerCodes: Array.isArray(current.blockerCodes) ? current.blockerCodes : [],
      primaryBlocker: cleanString(current.primaryBlocker),
      evidenceCounts: {
        total: Number.isFinite(Number(current.evidenceCounts?.total)) ? Math.max(0, Math.trunc(Number(current.evidenceCounts.total))) : 0,
        green: Number.isFinite(Number(current.evidenceCounts?.green)) ? Math.max(0, Math.trunc(Number(current.evidenceCounts.green))) : 0,
        red: Number.isFinite(Number(current.evidenceCounts?.red)) ? Math.max(0, Math.trunc(Number(current.evidenceCounts.red))) : 0
      },
      primaryRemediationAction: cleanString(current.primaryRemediationAction),
      retryAfterAt: coerceIso(current.retryAfterAt, null),
      owner: cleanString(current.owner)
    }];
  }));
  const domainCounters = Object.fromEntries(VERIFIER_GATE_DOMAINS.map((domain) => [domain, {
    observations: 0,
    green: 0,
    red: 0,
    redEvidence: 0,
    greenEvidence: 0,
    redRate: 0,
    currentStatus: currentDomains[domain].status,
    currentPrimaryBlocker: currentDomains[domain].primaryBlocker,
    currentRemediationAction: currentDomains[domain].primaryRemediationAction
  }]));

  for (const snapshot of history) {
    for (const domain of VERIFIER_GATE_DOMAINS) {
      const status = VERIFIER_GATE_STATUSES.has(snapshot[`${domain}GateStatus`])
        ? snapshot[`${domain}GateStatus`]
        : null;
      if (!status) continue;
      incrementCounter(domainCounters[domain], 'observations');
      incrementCounter(domainCounters[domain], status);
      incrementCounter(domainCounters[domain], 'redEvidence', snapshot[`${domain}RedEvidenceCount`] || 0);
      incrementCounter(domainCounters[domain], 'greenEvidence', snapshot[`${domain}GreenEvidenceCount`] || 0);
    }
  }

  for (const domain of VERIFIER_GATE_DOMAINS) {
    const observations = domainCounters[domain].observations;
    domainCounters[domain].redRate = observations === 0 ? 0 : domainCounters[domain].red / observations;
  }

  const currentRedDomains = VERIFIER_GATE_DOMAINS.filter((domain) => currentDomains[domain].status === 'red');
  const priorRedDomainCounts = history.slice(0, -1).map((snapshot) => (
    VERIFIER_GATE_DOMAINS.filter((domain) => snapshot[`${domain}GateStatus`] === 'red').length
  ));
  const previousRedDomainCount = priorRedDomainCounts.at(-1) ?? 0;
  const currentRedDomainCount = currentRedDomains.length;
  const attentionDomain = currentRedDomains
    .slice()
    .sort((left, right) => domainCounters[right].redRate - domainCounters[left].redRate)[0] || null;

  return {
    version: `${ANALYTICS_EXPORT_VERSION}.gate-domain-rollup.v1`,
    state: currentRedDomainCount === 0
      ? 'all-domains-green'
      : currentRedDomainCount > previousRedDomainCount
        ? 'domain-regression'
        : 'domain-attention',
    currentRedDomains,
    currentGreenDomains: VERIFIER_GATE_DOMAINS.filter((domain) => currentDomains[domain].status === 'green'),
    currentRedDomainCount,
    previousRedDomainCount,
    redDomainDelta: currentRedDomainCount - previousRedDomainCount,
    attentionDomain,
    domains: currentDomains,
    counters: domainCounters,
    timelinePoints: history.map((snapshot) => ({
      observedAt: snapshot.observedAt,
      stateRevision: snapshot.stateRevision,
      requestId: snapshot.requestId,
      redDomains: VERIFIER_GATE_DOMAINS.filter((domain) => snapshot[`${domain}GateStatus`] === 'red'),
      redRequiredDomainCount: snapshot.redRequiredDomainCount || 0,
      primaryRedDomain: snapshot.primaryRedDomain || null
    }))
  };
}

function buildAnalyticsExportReport({ requestContext, preview, evaluation, acceptance, readiness, providerContract, syncMetadata, externalHandoff, operationalHealth, proofReceipt, clientWorkflow, persistedState, nextPersistedState, securityBoundary, validationSummary, gateEvidence, gateResultNormalization, nowIso }) {
  const currentSnapshot = {
    snapshotId: stableChecksum([
      ANALYTICS_EXPORT_VERSION,
      nextPersistedState.stateId,
      nextPersistedState.stateRevision,
      requestContext.requestId,
      preview.claimId,
      proofReceipt.receiptId
    ]),
    observedAt: nowIso,
    stateRevision: nextPersistedState.stateRevision,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    claimId: preview.claimId,
    resultId: preview.resultId,
    claimBindingStatus: evaluation.claimBinding.status,
    claimBindingFingerprint: evaluation.claimBinding.auditFingerprint,
    resultTimestampStatus: evaluation.timestamp.status,
    resultTimestampFingerprint: evaluation.timestamp.auditFingerprint,
    decision: evaluation.nextAction,
    accepted: acceptance.accepted,
    releaseAuthorized: proofReceipt.releaseAuthorized,
    healthState: operationalHealth.state,
    readinessState: readiness.state,
    handoffState: externalHandoff.state,
    workflowState: clientWorkflow.workflowState,
    blockerCount: acceptance.failedCriteria.length + securityBoundary.blockers.length,
    primaryErrorCode: operationalHealth.primaryError?.code || null,
    retryable: operationalHealth.retryable,
    replayed: nextPersistedState.commandStatus === 'duplicate-ignored',
    resultAgeMs: evaluation.resultAgeMs,
    providerMode: providerContract.mode,
    providerService: providerContract.service,
    serviceContractId: providerContract.serviceContractId,
    negotiatedContractVersion: providerContract.negotiatedContractVersion,
    handoffProtocol: providerContract.handoffProtocol,
    providerContractIssueCount: providerContract.contractIssues.length,
    syncStatus: syncMetadata.status,
    syncLagMs: syncMetadata.lagMs,
    tenantId: securityBoundary.tenantId,
    workspaceId: securityBoundary.workspaceId,
    workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
    workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
    boundaryHandoffPolicy: securityBoundary.workspaceDecision.handoffPolicy,
    actorId: securityBoundary.actor.actorId,
    receiptId: proofReceipt.receiptId,
    gateEvidenceStatus: gateEvidence.status,
    greenGateCount: gateEvidence.summary.green,
    redGateCount: gateEvidence.summary.red,
    redGateIds: gateEvidence.gates.filter((gate) => gate.status === 'red').map((gate) => gate.gateId),
    bootGateStatus: gateResultNormalization.domains.boot.status,
    runGateStatus: gateResultNormalization.domains.run.status,
    claimGateStatus: gateResultNormalization.domains.claim.status,
    bootRedEvidenceCount: gateResultNormalization.domains.boot.evidenceCounts.red,
    runRedEvidenceCount: gateResultNormalization.domains.run.evidenceCounts.red,
    claimRedEvidenceCount: gateResultNormalization.domains.claim.evidenceCounts.red,
    bootGreenEvidenceCount: gateResultNormalization.domains.boot.evidenceCounts.green,
    runGreenEvidenceCount: gateResultNormalization.domains.run.evidenceCounts.green,
    claimGreenEvidenceCount: gateResultNormalization.domains.claim.evidenceCounts.green,
    primaryRedDomain: gateResultNormalization.redRequiredDomains[0]
      || VERIFIER_GATE_DOMAINS.find((domain) => gateResultNormalization.domains[domain].status === 'red')
      || null,
    redRequiredDomainCount: gateResultNormalization.redRequiredDomains.length
  };
  const history = [...persistedState.analyticsHistory, currentSnapshot].slice(-ANALYTICS_HISTORY_LIMIT);
  const domainAnalytics = buildGateDomainAnalytics({ gateResultNormalization, history });
  const counters = {
    observations: history.length,
    accepted: 0,
    blocked: 0,
    releaseAuthorized: 0,
    refreshRequested: 0,
    missingProof: 0,
    staleResult: 0,
    unboundVerifierResult: 0,
    claimBindingMismatch: 0,
    providerDegraded: 0,
    boundaryBlocked: 0,
    handoffQueued: 0,
    handoffFailed: 0,
    retryable: 0,
    replayed: 0
  };

  for (const snapshot of history) {
    if (snapshot.accepted) incrementCounter(counters, 'accepted');
    if (!snapshot.accepted || snapshot.blockerCount > 0) incrementCounter(counters, 'blocked');
    if (snapshot.releaseAuthorized) incrementCounter(counters, 'releaseAuthorized');
    if (snapshot.decision === 'request-refresh') incrementCounter(counters, 'refreshRequested');
    if (snapshot.handoffState === 'queued' || snapshot.handoffState === 'dispatched') incrementCounter(counters, 'handoffQueued');
    if (snapshot.handoffState === 'failed') incrementCounter(counters, 'handoffFailed');
    if (snapshot.retryable) incrementCounter(counters, 'retryable');
    if (snapshot.replayed) incrementCounter(counters, 'replayed');
    if (snapshot.healthState && snapshot.healthState !== 'healthy') incrementCounter(counters, 'providerDegraded');
  }
  if (evaluation.reasons.includes('verifier-result-unbound')) incrementCounter(counters, 'unboundVerifierResult');
  if (evaluation.reasons.includes('verifier-result-claim-mismatch')) incrementCounter(counters, 'claimBindingMismatch');
  if (evaluation.reasons.includes('missing-proof')) incrementCounter(counters, 'missingProof');
  if (
    evaluation.reasons.includes('stale-verifier-result')
    || evaluation.reasons.includes('missing-result-timestamp')
    || evaluation.reasons.includes('future-verifier-result-timestamp')
  ) {
    incrementCounter(counters, 'staleResult');
  }
  if (!securityBoundary.allowed) incrementCounter(counters, 'boundaryBlocked');
  const rollingSummary = buildRollingAnalyticsSummary(history);

  const timeline = [
    {
      at: requestContext.receivedAt,
      type: 'request.received',
      label: 'Verifier-result request received',
      state: requestContext.workflowIntent,
      ref: requestContext.requestId
    },
    {
      at: nowIso,
      type: 'decision.evaluated',
      label: acceptance.accepted ? 'Release criteria accepted' : 'Release criteria blocked',
      state: evaluation.nextAction,
      ref: preview.resultId
    },
    {
      at: externalHandoff.requestedAt || nowIso,
      type: 'handoff.resolved',
      label: `External handoff ${externalHandoff.state}`,
      state: externalHandoff.state,
      ref: externalHandoff.handoffId || externalHandoff.target
    },
    {
      at: proofReceipt.issuedAt,
      type: 'proof.receipt.issued',
      label: proofReceipt.releaseAuthorized ? 'Release proof authorized' : 'Release proof blocked',
      state: proofReceipt.releaseAuthorized ? 'authorized' : 'blocked',
      ref: proofReceipt.receiptId
    },
    {
      at: nowIso,
      type: 'client.workflow.updated',
      label: clientWorkflow.userVisible.label,
      state: clientWorkflow.workflowState,
      ref: clientWorkflow.resumeToken
    }
  ];
  const exportRows = history.map((snapshot) => ({
    observedAt: snapshot.observedAt,
    stateRevision: snapshot.stateRevision,
    requestId: snapshot.requestId,
    claimId: snapshot.claimId,
    resultId: snapshot.resultId,
    claimBindingStatus: snapshot.claimBindingStatus || 'unknown',
    resultTimestampStatus: snapshot.resultTimestampStatus || 'unknown',
    decision: snapshot.decision,
    accepted: snapshot.accepted,
    releaseAuthorized: snapshot.releaseAuthorized,
    healthState: snapshot.healthState,
    readinessState: snapshot.readinessState,
    handoffState: snapshot.handoffState,
    workflowState: snapshot.workflowState,
    blockerCount: snapshot.blockerCount,
    primaryErrorCode: snapshot.primaryErrorCode,
    retryable: snapshot.retryable,
    replayed: snapshot.replayed,
    resultAgeMs: snapshot.resultAgeMs,
    syncLagMs: snapshot.syncLagMs,
    providerMode: snapshot.providerMode,
    providerService: snapshot.providerService,
    handoffProtocol: snapshot.handoffProtocol,
    workspaceBoundaryStatus: snapshot.workspaceBoundaryStatus || 'unknown',
    gateEvidenceStatus: snapshot.gateEvidenceStatus || 'unknown',
    greenGateCount: snapshot.greenGateCount || 0,
    redGateCount: snapshot.redGateCount || 0,
    bootGateStatus: snapshot.bootGateStatus || 'unknown',
    runGateStatus: snapshot.runGateStatus || 'unknown',
    claimGateStatus: snapshot.claimGateStatus || 'unknown',
    bootRedEvidenceCount: snapshot.bootRedEvidenceCount || 0,
    runRedEvidenceCount: snapshot.runRedEvidenceCount || 0,
    claimRedEvidenceCount: snapshot.claimRedEvidenceCount || 0,
    bootGreenEvidenceCount: snapshot.bootGreenEvidenceCount || 0,
    runGreenEvidenceCount: snapshot.runGreenEvidenceCount || 0,
    claimGreenEvidenceCount: snapshot.claimGreenEvidenceCount || 0,
    primaryRedDomain: snapshot.primaryRedDomain || null,
    redRequiredDomainCount: snapshot.redRequiredDomainCount || 0,
    outcome: classifyAnalyticsSnapshot(snapshot)
  }));
  const exportColumns = [
    'observedAt',
    'stateRevision',
    'requestId',
    'claimId',
    'resultId',
    'claimBindingStatus',
    'resultTimestampStatus',
    'decision',
    'accepted',
    'releaseAuthorized',
    'healthState',
    'readinessState',
    'handoffState',
    'workflowState',
    'blockerCount',
    'primaryErrorCode',
    'retryable',
    'replayed',
    'resultAgeMs',
    'syncLagMs',
    'providerMode',
    'providerService',
    'handoffProtocol',
    'workspaceBoundaryStatus',
    'gateEvidenceStatus',
    'greenGateCount',
    'redGateCount',
    'bootGateStatus',
    'runGateStatus',
    'claimGateStatus',
    'bootRedEvidenceCount',
    'runRedEvidenceCount',
    'claimRedEvidenceCount',
    'bootGreenEvidenceCount',
    'runGreenEvidenceCount',
    'claimGreenEvidenceCount',
    'primaryRedDomain',
    'redRequiredDomainCount',
    'outcome'
  ];
  const exportPartition = {
    tenantId: securityBoundary.tenantId || 'unscoped',
    workspaceId: securityBoundary.workspaceId || 'unscoped',
    surfaceId,
    providerService: providerContract.service,
    date: nowIso.slice(0, 10)
  };
  const exportManifest = {
    dataset: 'verifier_result_claim_gate_observations',
    schemaVersion: ANALYTICS_EXPORT_VERSION,
    partition: exportPartition,
    columns: exportColumns,
    rowCount: exportRows.length,
    checksum: stableChecksum([
      ANALYTICS_EXPORT_VERSION,
      exportPartition.tenantId,
      exportPartition.workspaceId,
      exportPartition.date,
      exportRows.map((row) => `${row.stateRevision}:${row.requestId}:${row.outcome}:${row.primaryErrorCode || 'none'}`).join(',')
    ]),
    generatedBy: surfaceId
  };
  const reportingWarnings = [
    ...(history.length >= ANALYTICS_HISTORY_LIMIT ? ['analytics-history-truncated-to-window'] : []),
    ...(securityBoundary.tenantId && securityBoundary.workspaceId ? [] : ['analytics-export-unscoped']),
    ...(validationSummary.issueCount > 0 ? ['validation-issues-present'] : []),
    ...(rollingSummary.totals.handoffAttention > 0 ? ['handoff-attention-needed'] : [])
  ];
  const reportState = operationalHealth.state === 'failed'
    ? 'operator-attention'
    : counters.releaseAuthorized > 0 && counters.handoffFailed === 0
      ? 'release-reportable'
      : counters.refreshRequested > 0 || operationalHealth.retryable
        ? 'refresh-monitoring'
        : 'review-monitoring';

  return {
    version: ANALYTICS_EXPORT_VERSION,
    reportId: stableChecksum([ANALYTICS_EXPORT_VERSION, requestContext.correlationId, currentSnapshot.snapshotId]),
    generatedAt: nowIso,
    reportState,
    counters,
    rollingSummary,
    currentSnapshot,
    history,
    persistedHistory: history.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      stateRevision: snapshot.stateRevision,
      requestId: snapshot.requestId,
      claimId: snapshot.claimId,
      resultId: snapshot.resultId,
      claimBindingStatus: snapshot.claimBindingStatus,
      claimBindingFingerprint: snapshot.claimBindingFingerprint,
      resultTimestampStatus: snapshot.resultTimestampStatus,
      resultTimestampFingerprint: snapshot.resultTimestampFingerprint,
      decision: snapshot.decision,
      accepted: snapshot.accepted,
      releaseAuthorized: snapshot.releaseAuthorized,
      healthState: snapshot.healthState,
      readinessState: snapshot.readinessState,
      handoffState: snapshot.handoffState,
      workflowState: snapshot.workflowState,
      blockerCount: snapshot.blockerCount,
      primaryErrorCode: snapshot.primaryErrorCode,
      retryable: snapshot.retryable,
      replayed: snapshot.replayed,
      resultAgeMs: snapshot.resultAgeMs,
      providerMode: snapshot.providerMode,
      providerService: snapshot.providerService,
      serviceContractId: snapshot.serviceContractId,
      handoffProtocol: snapshot.handoffProtocol,
      workspaceDecisionId: snapshot.workspaceDecisionId,
      workspaceBoundaryStatus: snapshot.workspaceBoundaryStatus,
      boundaryHandoffPolicy: snapshot.boundaryHandoffPolicy,
      syncStatus: snapshot.syncStatus,
      syncLagMs: snapshot.syncLagMs,
      gateEvidenceStatus: snapshot.gateEvidenceStatus,
      greenGateCount: snapshot.greenGateCount,
      redGateCount: snapshot.redGateCount,
      bootGateStatus: snapshot.bootGateStatus,
      runGateStatus: snapshot.runGateStatus,
      claimGateStatus: snapshot.claimGateStatus,
      bootRedEvidenceCount: snapshot.bootRedEvidenceCount,
      runRedEvidenceCount: snapshot.runRedEvidenceCount,
      claimRedEvidenceCount: snapshot.claimRedEvidenceCount,
      bootGreenEvidenceCount: snapshot.bootGreenEvidenceCount,
      runGreenEvidenceCount: snapshot.runGreenEvidenceCount,
      claimGreenEvidenceCount: snapshot.claimGreenEvidenceCount,
      primaryRedDomain: snapshot.primaryRedDomain,
      redRequiredDomainCount: snapshot.redRequiredDomainCount
    })),
    timeline: timeline
      .filter((event) => event.at)
      .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
      .map((event, index) => ({
        ...event,
        sequence: index + 1,
        lane: event.type.startsWith('handoff.')
          ? 'handoff'
          : event.type.startsWith('proof.')
            ? 'proof'
            : event.type.startsWith('client.')
              ? 'client'
              : 'decision'
      })),
    exportSummary: {
      format: 'json-lines-ready',
      columns: exportColumns,
      rowCount: exportRows.length,
      rows: exportRows,
      manifest: exportManifest,
      reportingWarnings,
      redaction: {
        tenantScoped: Boolean(securityBoundary.tenantId && securityBoundary.workspaceId),
        excludesProofToken: true,
        excludesEvidencePayloads: true
      }
    },
    domainAnalytics,
    auditRollup: {
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      providerId: providerContract.providerId,
      providerService: providerContract.service,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      handoffProtocol: providerContract.handoffProtocol,
      syncCursor: syncMetadata.cursor,
      validationIssueCount: validationSummary.issueCount,
      primaryErrorCode: operationalHealth.primaryError?.code || null,
      releaseAuthorizationRate: rollingSummary.rates.releaseAuthorization,
      blockedRate: rollingSummary.rates.blocked,
      retryableRate: rollingSummary.rates.retryable,
      gateDomainState: domainAnalytics.state,
      attentionDomain: domainAnalytics.attentionDomain,
      redDomainDelta: domainAnalytics.redDomainDelta,
      topErrorCodes: Object.entries(rollingSummary.errorCodes)
        .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
        .map(([code, count]) => ({ code, count })),
      reportingWarnings
    }
  };
}

export function describeVerifierResultSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const normalizedNowMs = Number.isNaN(nowMs) ? Date.now() : nowMs;
  const normalizedNow = new Date(normalizedNowMs).toISOString();
  const requestContext = normalizeRequestContext(input, normalizedNow);
  const clientState = normalizeClientRuntimeState(input, requestContext, normalizedNow);
  const persistedState = normalizePersistedState(input, requestContext, normalizedNow);
  const normalizedSettings = normalizeSettings(input.settings || {}, normalizedNowMs);
  const lifecycleControlRequest = normalizeLifecycleControlRequest(input, normalizedNowMs);
  const lifecycle = applyLifecycleCommand(
    normalizedSettings.settings,
    lifecycleControlRequest,
    normalizedNowMs,
    persistedState.commandReplay.replayed
  );
  const validationIssues = [...normalizedSettings.issues, ...lifecycle.issues];
  const lifecycleControlState = buildLifecycleControlState({
    lifecycle,
    validationIssues,
    nowIso: normalizedNow
  });
  const evaluation = evaluateVerifierResult({
    settings: lifecycle.settings,
    verifierResult: input.verifierResult || input.result || {},
    input,
    nowMs: normalizedNowMs,
    refreshRequested: lifecycle.refreshRequested
  });
  const providerContract = normalizeProviderContract(input.provider || input.serviceProvider || {}, lifecycle.settings);
  const securityBoundary = normalizeSecurityBoundary(input, requestContext, persistedState, evaluation, providerContract);
  const syncMetadata = normalizeSyncMetadata(input.sync || input.syncMetadata || {}, normalizedNow, normalizedNowMs);
  const externalHandoff = resolveExternalHandoff({
    input,
    evaluation,
    providerContract,
    syncMetadata,
    persistedState,
    securityBoundary,
    nowIso: normalizedNow
  });
  const verifierResultInput = input.verifierResult || input.result || {};
  const preview = normalizeClaimPreview(input, verifierResultInput);
  const evidenceManifest = normalizeEvidenceManifest(Array.isArray(input.evidence) ? input.evidence : [], {
    preview,
    evaluation,
    providerContract,
    syncMetadata,
    requestContext,
    nowIso: normalizedNow
  });
  const claimGate = buildClaimGateArtifact({
    input,
    requestContext,
    preview,
    evaluation,
    evidenceManifest,
    securityBoundary,
    nowIso: normalizedNow
  });
  const acceptance = buildAcceptanceContract({
    evaluation,
    providerContract,
    externalHandoff,
    preview,
    securityBoundary
  });
  const readiness = buildReadinessContract({
    evaluation,
    providerContract,
    syncMetadata,
    externalHandoff,
    validationIssues,
    securityBoundary
  });
  const operationalHealth = buildOperationalHealth({
    input,
    evaluation,
    providerContract,
    syncMetadata,
    externalHandoff,
    validationIssues,
    persistedState,
    securityBoundary,
    nowIso: normalizedNow,
    nowMs: normalizedNowMs
  });
  const gateEvidence = buildGateEvidenceNormalization({
    requestContext,
    preview,
    evaluation,
    acceptance,
    readiness,
    lifecycle,
    externalHandoff,
    operationalHealth,
    securityBoundary,
    evidenceManifest,
    claimGate,
    nowIso: normalizedNow
  });
  const gateResultNormalization = normalizeVerifierGateResultEvidence({
    requestContext,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    claimGate,
    gateEvidence,
    nowIso: normalizedNow
  });
  const validationSummary = buildValidationSummary(validationIssues, providerContract, evaluation);
  const clientNextSteps = buildClientNextSteps({
    evaluation,
    providerContract,
    externalHandoff,
    lifecycleSettings: lifecycle.settings,
    operationalHealth,
    lifecycle,
    lifecycleControls: lifecycleControlState,
    securityBoundary
  });
  const gateDecisionCards = buildGateDecisionCards({
    requestContext,
    preview,
    gateResultNormalization,
    gateEvidence,
    acceptance,
    readiness,
    clientNextSteps,
    nowIso: normalizedNow
  });
  const gateWorkflowHandoff = buildGateWorkflowHandoff({
    requestContext,
    clientState,
    preview,
    gateResultNormalization,
    gateDecisionCards,
    externalHandoff,
    nowIso: normalizedNow
  });
  const requestIntentContract = buildRequestIntentContract({
    requestContext,
    clientState,
    preview,
    evaluation,
    acceptance,
    readiness,
    providerContract,
    externalHandoff,
    operationalHealth,
    securityBoundary,
    lifecycle
  });
  const runtimeContract = buildRuntimeDataContract({
    requestContext,
    clientState,
    preview,
    evaluation,
    providerContract,
    syncMetadata,
    externalHandoff,
    acceptance,
    readiness,
    persistedState,
    operationalHealth,
    lifecycle,
    lifecycleControls: lifecycleControlState,
    securityBoundary,
    requestIntentContract,
    claimGate,
    gateEvidence,
    gateResultNormalization,
    gateDecisionCards,
    gateWorkflowHandoff
  });
  const workflowHandoff = buildWorkflowHandoffEnvelope({
    requestContext,
    preview,
    evaluation,
    providerContract,
    externalHandoff,
    acceptance,
    clientNextSteps,
    runtimeContract,
    operationalHealth,
    securityBoundary,
    gateWorkflowHandoff,
    nowIso: normalizedNow
  });
  const nextPersistedState = buildPersistedStateUpdate({
    persistedState,
    requestContext,
    lifecycle,
    preview,
    evaluation,
    acceptance,
    externalHandoff,
    workflowHandoff,
    operationalHealth,
    securityBoundary,
    gateEvidence,
    gateResultNormalization,
    gateWorkflowHandoff,
    nowIso: normalizedNow
  });
  const proofReceipt = buildHostedKernelProofReceipt({
    requestContext,
    preview,
    evaluation,
    providerContract,
    syncMetadata,
    externalHandoff,
    acceptance,
    readiness,
    operationalHealth,
    evidenceManifest,
    claimGate,
    gateEvidence,
    gateResultNormalization,
    nextPersistedState,
    workflowHandoff,
    securityBoundary,
    nowIso: normalizedNow
  });
  const clientReviewPacket = buildClientReviewPacket({
    requestContext,
    preview,
    evaluation,
    acceptance,
    readiness,
    validationSummary,
    clientNextSteps,
    providerContract,
    syncMetadata,
    externalHandoff,
    operationalHealth,
    proofReceipt,
    securityBoundary,
    claimGate,
    gateEvidence,
    gateDecisionCards,
    lifecycleControls: lifecycleControlState,
    nowIso: normalizedNow
  });
  const clientWorkflow = buildClientWorkflowContinuation({
    clientState,
    requestContext,
    preview,
    acceptance,
    readiness,
    externalHandoff,
    workflowHandoff,
    requestIntentContract,
    clientNextSteps,
    proofReceipt,
    operationalHealth,
    securityBoundary,
    gateWorkflowHandoff,
    nowIso: normalizedNow
  });
  const decisionPreview = buildDecisionPreviewContract({
    requestContext,
    preview,
    acceptance,
    readiness,
    validationSummary,
    clientNextSteps,
    clientWorkflow,
    providerContract,
    externalHandoff,
    proofReceipt,
    operationalHealth,
    securityBoundary,
    claimGate,
    gateEvidence,
    gateDecisionCards,
    lifecycleControls: lifecycleControlState,
    nowIso: normalizedNow
  });
  const analyticsReporting = buildAnalyticsExportReport({
    requestContext,
    preview,
    evaluation,
    acceptance,
    readiness,
    providerContract,
    syncMetadata,
    externalHandoff,
    operationalHealth,
    proofReceipt,
    clientWorkflow,
    persistedState,
    nextPersistedState,
    securityBoundary,
    validationSummary,
    gateEvidence,
    gateResultNormalization,
    nowIso: normalizedNow
  });

  return {
    ok: (acceptance.accepted && claimGate.allowed) || evaluation.nextAction !== 'release-claim',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: normalizedNow,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel verifier-result lifecycle and claim-release contract',
    request: requestContext,
    client: {
      ...clientWorkflow,
      reviewPacket: clientReviewPacket,
      decisionPreview
    },
    providerContract,
    securityBoundary,
    sync: syncMetadata,
    persistence: {
      current: persistedState,
      next: {
        ...nextPersistedState,
        analyticsHistory: analyticsReporting.persistedHistory
      }
    },
    lifecycle: {
      command: lifecycle.lifecycle,
      requestedCommand: lifecycle.requestedCommand,
      commandStatus: lifecycle.commandStatus,
      effects: lifecycle.effects,
      enabled: lifecycle.settings.enabled,
      appliedControls: lifecycle.appliedControls,
      mutationApplied: lifecycle.mutationApplied,
      issues: lifecycle.issues,
      schedulerDirective: lifecycle.schedulerDirective,
      nextLifecycleAction: lifecycle.nextLifecycleAction,
      scheduleControl: lifecycle.scheduleControl,
      refreshRequested: lifecycle.refreshRequested
    },
    lifecycleControlState,
    settings: lifecycle.settings,
    validation: {
      ok: validationIssues.length === 0,
      issues: validationIssues,
      settingsIssues: normalizedSettings.issues,
      lifecycleIssues: lifecycle.issues,
      summary: validationSummary
    },
    preview: {
      ...preview,
      headline: acceptance.accepted ? 'Verifier result ready for claim release' : 'Verifier result requires attention',
      decision: evaluation.nextAction,
      timestampStatus: evaluation.timestamp.status,
      timestampObservedAt: evaluation.timestamp.observedAt,
      timestampFutureSkewMs: evaluation.timestamp.futureSkewMs,
      blockingReasons: evaluation.reasons.map((reason) => ({
        code: reason,
        message: RELEASE_BLOCKER_MESSAGES[reason] || reason
      }))
    },
    acceptance,
    readiness,
    verifierResult: evaluation,
    audit: {
      subject: input.claimId || input.subject || null,
      actor: input.actor || 'hosted-kernel',
      route: `${surfaceGroup}/${surfaceName}`,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
      idempotencyKey: requestContext.idempotencyKey,
      decision: evaluation.nextAction,
      reasonCount: evaluation.reasons.length,
      evidenceCount: evidenceManifest.items.length,
      evidenceManifestVersion: evidenceManifest.version,
      claimGateId: claimGate.gateId,
      claimGateRequired: claimGate.required,
      claimGateAllowed: claimGate.allowed,
      claimGateMissingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      gateEvidenceStatus: gateEvidence.status,
      gateEvidenceChecksum: gateEvidence.checksum,
      gateEvidenceGreenCount: gateEvidence.summary.green,
      gateEvidenceRedCount: gateEvidence.summary.red,
      normalizedGateResultStatus: gateResultNormalization.status,
      normalizedGateRequiredStatus: gateResultNormalization.requiredStatus,
      normalizedGateReleaseDecision: gateResultNormalization.releaseDecision,
      normalizedGateChecksum: gateResultNormalization.checksum,
      normalizedGateRedEvidenceCount: gateResultNormalization.totals.redEvidence,
      normalizedGateGreenEvidenceCount: gateResultNormalization.totals.greenEvidence,
      normalizedGateRedRequiredDomains: gateResultNormalization.redRequiredDomains,
      gateDecisionCardsChecksum: gateDecisionCards.checksum,
      gateDecisionCardsState: gateDecisionCards.state,
      gateDecisionPrimaryDomain: gateDecisionCards.primaryDomain,
      gateDecisionPrimaryCardId: gateDecisionCards.primaryCardId,
      gateDecisionRedCards: gateDecisionCards.summary.redCards,
      gateDecisionGreenCards: gateDecisionCards.summary.greenCards,
      gateWorkflowHandoffId: gateWorkflowHandoff.handoffId,
      gateWorkflowState: gateWorkflowHandoff.state,
      gateWorkflowPrimaryDomain: gateWorkflowHandoff.primaryDomain,
      gateWorkflowPrimaryAction: gateWorkflowHandoff.primaryAction,
      gateWorkflowPrimaryRoute: gateWorkflowHandoff.primaryRoute,
      gateWorkflowBlocked: gateWorkflowHandoff.blocked,
      gateWorkflowChecksum: gateWorkflowHandoff.checksum,
      resultTimestampStatus: evaluation.timestamp.status,
      resultTimestampObservedAt: evaluation.timestamp.observedAt,
      resultTimestampFingerprint: evaluation.timestamp.auditFingerprint,
      resultTimestampFutureSkewMs: evaluation.timestamp.futureSkewMs,
      proofReceiptId: proofReceipt.receiptId,
      releaseAuthorized: proofReceipt.releaseAuthorized,
      providerId: providerContract.providerId,
      providerService: providerContract.service,
      requestedProviderService: providerContract.requestedService,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      providerContractIssues: providerContract.contractIssues,
      handoffProtocol: providerContract.handoffProtocol,
      tenantId: securityBoundary.tenantId,
      workspaceId: securityBoundary.workspaceId,
      scopeHash: securityBoundary.scopeHash,
      actorId: securityBoundary.actor.actorId,
      boundaryAllowed: securityBoundary.allowed,
      boundaryBlockers: securityBoundary.blockers,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
      workspaceBoundaryViolations: securityBoundary.workspaceDecision.violations,
      boundaryHandoffTopic: securityBoundary.auditHandoff.topic,
      boundaryHandoffPolicy: securityBoundary.auditHandoff.policy,
      contractVersion: providerContract.contractVersion,
      syncCursor: syncMetadata.cursor,
      handoffState: externalHandoff.state,
      workflowLane: workflowHandoff.lane,
      clientWorkflowState: clientWorkflow.workflowState,
      clientActivePanel: clientWorkflow.activePanel,
      clientResumeToken: clientWorkflow.resumeToken,
      requestIntent: requestIntentContract.requestedIntent,
      requestIntentAllowed: requestIntentContract.allowed,
      requestIntentFingerprint: requestIntentContract.audit.fingerprint,
      proofToken: workflowHandoff.auditProof.proofToken,
      stateId: nextPersistedState.stateId,
      stateRevision: nextPersistedState.stateRevision,
      commandReceiptId: nextPersistedState.commandReceipt.receiptId,
      commandReceiptChecksum: nextPersistedState.commandReceipt.checksum,
      commandStatus: nextPersistedState.commandStatus,
      lifecycleCommand: lifecycle.lifecycle,
      lifecycleAppliedControls: lifecycle.appliedControls,
      recoveryAction: nextPersistedState.restartSafe.recoveryAction,
      restartDurableStatus: nextPersistedState.restartSafe.durableStatus,
      replaySource: nextPersistedState.restartSafe.replaySource,
      operationalHealthState: operationalHealth.state,
      primaryErrorCode: operationalHealth.primaryError?.code || null,
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      reportedHealthState: operationalHealth.reportedHealth.state,
      reportedHealthMode: operationalHealth.reportedHealth.mode,
      reportedHealthValid: operationalHealth.reportedHealth.valid,
      recoveryPhase: operationalHealth.recoveryPlan.phase,
      recoveryAutoRetryAllowed: operationalHealth.recoveryPlan.autoRetryAllowed,
      recoveryNextAttemptAt: operationalHealth.recoveryPlan.nextAttemptAt
    },
    evidence: evidenceManifest.items,
    evidenceManifest,
    gateEvidence,
    normalizedGateResult: gateResultNormalization,
    gateDecisionCards,
    gateWorkflowHandoff,
    claimGate,
    claimGateJson: claimGate.payload,
    proofReceipt,
    clientReviewPacket,
    decisionPreview,
    analytics: {
      version: analyticsReporting.version,
      reportId: analyticsReporting.reportId,
      reportState: analyticsReporting.reportState,
      counters: analyticsReporting.counters,
      rollingSummary: analyticsReporting.rollingSummary,
      domainAnalytics: analyticsReporting.domainAnalytics,
      currentSnapshot: analyticsReporting.currentSnapshot,
      history: analyticsReporting.history
    },
    timeline: analyticsReporting.timeline,
    exportSummary: analyticsReporting.exportSummary,
    auditRollup: analyticsReporting.auditRollup,
    externalHandoff,
    operationalHealth,
    runtimeContract,
    requestIntentContract,
    workflowHandoff,
    clientWorkflow,
    clientNextSteps,
    nextAction: {
      state: evaluation.nextAction,
      canReleaseClaim: evaluation.canReleaseClaim,
      claimGateAllowed: claimGate.allowed,
      claimGateRequired: claimGate.required,
      claimGateFileName: claimGate.fileName,
      claimGateMissingEvidenceArtifacts: claimGate.missingEvidenceArtifacts,
      gateEvidenceStatus: gateEvidence.status,
      gateEvidenceChecksum: gateEvidence.checksum,
      normalizedGateResultStatus: gateResultNormalization.status,
      normalizedGateRequiredStatus: gateResultNormalization.requiredStatus,
      normalizedGateReleaseDecision: gateResultNormalization.releaseDecision,
      normalizedGateChecksum: gateResultNormalization.checksum,
      normalizedGateDomains: gateResultNormalization.domains,
      normalizedGateRedEvidenceRefs: gateResultNormalization.redEvidence.map((item) => item.evidenceId),
      normalizedGateGreenEvidenceRefs: gateResultNormalization.greenEvidence.map((item) => item.evidenceId),
      gateDecisionCardsState: gateDecisionCards.state,
      gateDecisionCardsChecksum: gateDecisionCards.checksum,
      gateDecisionPrimaryCardId: gateDecisionCards.primaryCardId,
      gateDecisionPrimaryDomain: gateDecisionCards.primaryDomain,
      gateDecisionPrimaryRoute: gateDecisionCards.routeSlots.primary,
      gateWorkflowHandoffId: gateWorkflowHandoff.handoffId,
      gateWorkflowState: gateWorkflowHandoff.state,
      gateWorkflowBlocked: gateWorkflowHandoff.blocked,
      gateWorkflowRequiredGreen: gateWorkflowHandoff.requiredGreen,
      gateWorkflowPrimaryDomain: gateWorkflowHandoff.primaryDomain,
      gateWorkflowPrimaryAction: gateWorkflowHandoff.primaryAction,
      gateWorkflowPrimaryRoute: gateWorkflowHandoff.primaryRoute,
      gateWorkflowClientStatePatch: gateWorkflowHandoff.clientStatePatch,
      gateWorkflowDomainStatuses: gateWorkflowHandoff.domainStatuses,
      gateWorkflowDispatchHints: gateWorkflowHandoff.dispatchHints.map((hint) => ({
        domain: hint.domain,
        action: hint.action,
        label: hint.label,
        route: hint.route,
        enabled: hint.enabled,
        blockedReasons: hint.blockedReasons,
        retryAfterAt: hint.retryAfterAt
      })),
      gateDecisionCardStatuses: Object.fromEntries(gateDecisionCards.cards.map((card) => [card.domain, card.status])),
      gateDecisionNextSteps: gateDecisionCards.cards.map((card) => ({
        domain: card.domain,
        action: card.nextStep.action,
        label: card.nextStep.label,
        route: card.nextStep.route,
        enabled: card.nextStep.enabled,
        reasonCodes: card.nextStep.reasonCodes
      })),
      greenGateCount: gateEvidence.summary.green,
      redGateCount: gateEvidence.summary.red,
      redGateIds: gateEvidence.gates.filter((gate) => gate.status === 'red').map((gate) => gate.gateId),
      resultTimestampStatus: evaluation.timestamp.status,
      resultTimestampFutureSkewMs: evaluation.timestamp.futureSkewMs,
      resultTimestampFingerprint: evaluation.timestamp.auditFingerprint,
      scheduleDueAt: lifecycle.settings.schedule.nextRunAt,
      scheduleMode: lifecycle.settings.schedule.mode,
      scheduleStatus: lifecycle.scheduleControl.status,
      scheduleBlockedReason: lifecycle.scheduleControl.blockedReason,
      schedulerDirective: lifecycle.schedulerDirective,
      nextLifecycleAction: lifecycle.nextLifecycleAction,
      lifecycleControlState: lifecycleControlState.state,
      lifecyclePrimaryAction: lifecycleControlState.primaryAction,
      lifecycleBlockedReasons: lifecycleControlState.blockedReasons,
      refreshRequested: lifecycle.refreshRequested,
      blockingReasons: evaluation.reasons,
      providerReady: providerContract.negotiated,
      providerMode: providerContract.mode,
      serviceContractId: providerContract.serviceContractId,
      negotiatedContractVersion: providerContract.negotiatedContractVersion,
      handoffProtocol: providerContract.handoffProtocol,
      providerContractIssues: providerContract.contractIssues,
      boundaryAllowed: securityBoundary.allowed,
      workspaceBoundaryStatus: securityBoundary.workspaceDecision.status,
      workspaceDecisionId: securityBoundary.workspaceDecision.decisionId,
      handoffState: externalHandoff.state,
      workflowLane: workflowHandoff.lane,
      dispatchable: workflowHandoff.dispatchable && claimGate.allowed,
      operationalHealthState: operationalHealth.state,
      degradedMode: operationalHealth.degraded,
      retryable: operationalHealth.retryable,
      retryAfterAt: operationalHealth.retry.retryAfterAt,
      reportedHealthState: operationalHealth.reportedHealth.state,
      reportedHealthValid: operationalHealth.reportedHealth.valid,
      recoveryPhase: operationalHealth.recoveryPlan.phase,
      recoveryAutoRetryAllowed: operationalHealth.recoveryPlan.autoRetryAllowed,
      recoveryNextAttemptAt: operationalHealth.recoveryPlan.nextAttemptAt,
      actionableError: operationalHealth.primaryError,
      requestedIntent: requestIntentContract.requestedIntent,
      requestedIntentAllowed: requestIntentContract.allowed,
      requestedIntentBlockers: requestIntentContract.blockers,
      requestedIntentRoute: requestIntentContract.route,
      requestedIntentDispatchCommand: requestIntentContract.dispatchCommand,
      requestId: requestContext.requestId,
      commandReceiptId: nextPersistedState.commandReceipt.receiptId,
      restartDurableStatus: nextPersistedState.restartSafe.durableStatus,
      replaySource: nextPersistedState.restartSafe.replaySource,
      explanation: clientNextSteps.primary.label,
      clientAction: clientNextSteps.primary.action
    }
  };
}

export default describeVerifierResultSurface;
