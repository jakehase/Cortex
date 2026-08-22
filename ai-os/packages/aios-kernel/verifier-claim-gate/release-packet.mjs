export const surfaceId = "aios_verifier-claim-gate_release-packet_066";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "release-packet";

const RELEASE_STATUSES = new Set(['draft', 'ready', 'released', 'blocked', 'recovering']);
const TERMINAL_STATUSES = new Set(['released', 'blocked']);
const DEFAULT_COMMAND = 'describe';
const COMMANDS = new Set([DEFAULT_COMMAND, 'prepare', 'release', 'recover', 'enable', 'disable', 'schedule']);
const MAX_COMMAND_LOG = 20;
const MAX_ANALYTICS_HISTORY = 12;
const REQUIRED_RELEASE_ARTIFACTS = new Set([
  'hosted-boot-proof',
  'persisted-state',
  'release-preview',
  'readiness',
  'validation-summary',
  'client-workflow-handoff',
  'audit-handoff',
  'analytics-summary'
]);
const SUPPORTED_BOOT_PROOF_PROTOCOLS = new Set(['hosted-kernel.boot-proof.v1']);
const COMMAND_ROLE_REQUIREMENTS = {
  describe: [],
  prepare: ['release.preparer', 'release.admin'],
  release: ['release.approver', 'release.admin'],
  recover: ['release.operator', 'release.admin'],
  enable: ['release.operator', 'release.admin'],
  disable: ['release.operator', 'release.admin'],
  schedule: ['release.preparer', 'release.operator', 'release.admin']
};
const HUMAN_REVIEW_ROLE_REQUIREMENTS = ['release.reviewer', 'release.admin'];
const COMMAND_PROVIDER_CAPABILITIES = {
  prepare: ['state.write', 'artifact.write', 'audit.append'],
  release: ['state.write', 'artifact.write', 'audit.append', 'external.release-handoff'],
  recover: ['state.write', 'audit.append'],
  enable: ['state.write', 'audit.append'],
  disable: ['state.write', 'audit.append'],
  schedule: ['state.write', 'audit.append']
};
const SUPPORTED_PROVIDER_PROTOCOLS = new Set(['hosted-kernel.release-provider.v1']);
const DEFAULT_PROVIDER_PROTOCOL = 'hosted-kernel.release-provider.v1';
const EXTERNAL_HANDOFF_ACCEPTED_STATES = new Set(['accepted', 'submitted', 'completed', 'ready']);
const EXTERNAL_HANDOFF_FINAL_STATES = new Set(['completed', 'ready']);
const COMMAND_SERVICE_REQUIREMENTS = {
  prepare: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'artifact-store', capabilities: ['artifact.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] }
  ],
  release: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'artifact-store', capabilities: ['artifact.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] },
    { serviceType: 'release-handoff', capabilities: ['external.release-handoff'] }
  ],
  recover: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] }
  ],
  enable: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] }
  ],
  disable: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] }
  ],
  schedule: [
    { serviceType: 'state-store', capabilities: ['state.write'] },
    { serviceType: 'audit-stream', capabilities: ['audit.append'] }
  ]
};
const DEFAULT_HEALTH_RETRY_BASE_SECONDS = 30;
const DEFAULT_HEALTH_RETRY_MAX_SECONDS = 900;
const DEFAULT_HEALTH_RETRY_MAX_ATTEMPTS = 5;
const DEFAULT_SCHEDULE_LEAD_SECONDS = 0;
const DEFAULT_SCHEDULE_MAX_FUTURE_SECONDS = 60 * 60 * 24 * 90;

function isoNow(input) {
  return typeof input.now === 'string' && input.now.length > 0 ? input.now : new Date().toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proofDigest(payload) {
  const text = stableStringify(payload);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function scopedValueMatches(value, expected) {
  return value === null || value === expected;
}

function normalizeClaims(claims, boundary) {
  return asArray(claims).map((claim, index) => ({
    claimId: String(claim.claimId || claim.id || `claim-${index + 1}`),
    gate: String(claim.gate || claim.name || 'unspecified'),
    verified: claim.verified === true,
    verifier: typeof claim.verifier === 'string' ? claim.verifier : 'unknown',
    evidenceDigest: typeof claim.evidenceDigest === 'string' ? claim.evidenceDigest : null,
    tenantId: cleanToken(claim.tenantId, null),
    workspaceId: cleanToken(claim.workspaceId, null),
    tenantScoped: scopedValueMatches(cleanToken(claim.tenantId, null), boundary.tenantId),
    workspaceScoped: scopedValueMatches(cleanToken(claim.workspaceId, null), boundary.workspaceId)
  }));
}

function cleanToken(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeRoles(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((role) => typeof role === 'string')
    .map((role) => role.trim())
    .filter(Boolean))]
    .sort();
}

function normalizeTokenList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanToken(item, null))
    .filter(Boolean))]
    .sort();
}

function normalizeProviderEntries(value) {
  if (Array.isArray(value)) {
    return value.filter((provider) => provider && typeof provider === 'object');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([providerId, provider]) => ({
      ...(provider && typeof provider === 'object' ? provider : {}),
      providerId
    }));
  }
  return [];
}

function normalizeProviderProtocol(provider) {
  const offeredProtocols = normalizeTokenList(provider.protocolVersions || provider.supportedProtocols || [
    provider.protocolVersion || provider.contractVersion || DEFAULT_PROVIDER_PROTOCOL
  ]);
  const acceptedProtocol = offeredProtocols.find((protocol) => SUPPORTED_PROVIDER_PROTOCOLS.has(protocol)) || null;
  return {
    offeredProtocols,
    acceptedProtocol,
    compatible: acceptedProtocol !== null,
    requiredProtocols: [...SUPPORTED_PROVIDER_PROTOCOLS].sort()
  };
}

function normalizeExternalReleaseHandoff(source, state, clientRequest, now, owner = {}) {
  const handoffState = cleanToken(source.externalHandoffState || source.handoffState || source.status, null);
  const handoffReleaseId = cleanToken(source.externalHandoffReleaseId || source.handoffReleaseId || source.releaseId, null);
  const handoffRevision = Number.isSafeInteger(source.externalHandoffRevision)
    ? source.externalHandoffRevision
    : (Number.isSafeInteger(source.handoffRevision)
      ? source.handoffRevision
      : (Number.isSafeInteger(source.revision) ? source.revision : null));
  const target = cleanToken(source.externalHandoffTarget || source.handoffTarget || source.target, clientRequest.handoffTarget);
  const releaseScoped = scopedValueMatches(handoffReleaseId, state.releaseId);
  const targetMatched = target === null || target === clientRequest.handoffTarget;
  const revisionCurrent = handoffRevision === null || handoffRevision >= state.revision;
  const accepted = EXTERNAL_HANDOFF_ACCEPTED_STATES.has(handoffState);
  const final = EXTERNAL_HANDOFF_FINAL_STATES.has(handoffState);
  const ready = accepted && releaseScoped && targetMatched && revisionCurrent;
  const blockedReasons = [
    ...(accepted ? [] : ['external_release_handoff_not_accepted']),
    ...(releaseScoped ? [] : ['external_release_handoff_release_mismatch']),
    ...(targetMatched ? [] : ['external_release_handoff_target_mismatch']),
    ...(revisionCurrent ? [] : ['external_release_handoff_revision_stale'])
  ];

  return {
    handoffId: cleanToken(source.externalHandoffId || source.handoffId, null),
    target,
    expectedTarget: clientRequest.handoffTarget,
    releaseId: handoffReleaseId,
    expectedReleaseId: state.releaseId,
    revision: handoffRevision,
    expectedMinimumRevision: state.revision,
    state: handoffState || 'not_started',
    accepted,
    final,
    ready,
    targetMatched,
    releaseScoped,
    revisionCurrent,
    providerId: cleanToken(owner.providerId, null),
    serviceId: cleanToken(owner.serviceId, null),
    serviceType: cleanToken(owner.serviceType, null),
    blockedReasons,
    observedAt: normalizeIsoTimestamp(source.externalHandoffObservedAt || source.handoffObservedAt || source.observedAt || source.updatedAt) || now
  };
}

function normalizeProviderServices(provider, requiredServices, state, clientRequest, now) {
  const source = provider.serviceContracts || provider.services || provider.integrationServices;
  const serviceEntries = normalizeProviderEntries(source);
  const fallbackServices = serviceEntries.length > 0
    ? []
    : requiredServices.map((requirement) => ({
      serviceType: requirement.serviceType,
      capabilities: requirement.capabilities,
      lastSyncedRevision: provider.lastSyncedRevision,
      syncedAt: provider.syncedAt,
      syncCursor: provider.syncCursor,
      handoffState: provider.externalHandoffState,
      handoffId: provider.externalHandoffId,
      handoffTarget: provider.handoffTarget
    }));
  return [...serviceEntries, ...fallbackServices].map((service, index) => {
    const serviceType = cleanToken(service.serviceType || service.type || service.kind, `service-${index + 1}`);
    const capabilities = normalizeTokenList(service.capabilities || service.supportedCapabilities || service.features);
    const protocol = normalizeProviderProtocol(service);
    const unavailable = service.available === false || service.enabled === false || service.status === 'unavailable';
    const required = requiredServices.find((requirement) => requirement.serviceType === serviceType) || null;
    const missingCapabilities = required
      ? required.capabilities.filter((capability) => !capabilities.includes(capability))
      : [];
    const lastSyncedRevision = Number.isSafeInteger(service.lastSyncedRevision)
      ? service.lastSyncedRevision
      : (Number.isSafeInteger(service.syncedRevision) ? service.syncedRevision : null);
    const syncLag = lastSyncedRevision === null ? null : Math.max(0, state.revision - lastSyncedRevision);
    const inSync = lastSyncedRevision === null || lastSyncedRevision >= state.revision;
    const serviceId = cleanToken(service.serviceId || service.id || service.name, `${serviceType}-${index + 1}`);
    const externalHandoff = normalizeExternalReleaseHandoff(service, state, clientRequest, now, {
      providerId: provider.providerId || provider.id || provider.name,
      serviceId,
      serviceType
    });
    return {
      serviceId,
      serviceType,
      required: required !== null,
      endpoint: cleanToken(service.endpoint || service.route || service.url, null),
      protocol,
      capabilities,
      missingCapabilities,
      unavailable,
      ready: !unavailable && protocol.compatible && missingCapabilities.length === 0 && inSync,
      sync: {
        cursor: cleanToken(service.syncCursor || service.cursor || service.watermark, null),
        lastSyncedRevision,
        syncLag,
        inSync,
        syncedAt: normalizeIsoTimestamp(service.syncedAt || service.lastSyncedAt || service.updatedAt)
      },
      externalHandoff,
      observedAt: normalizeIsoTimestamp(service.observedAt || service.updatedAt) || now
    };
  });
}

function normalizeRoleBindings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([role, actorIds]) => [cleanToken(role, null), normalizeTokenList(actorIds)])
    .filter(([role, actorIds]) => role && actorIds.length > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeCommandLedger(rawState, commandLog, now) {
  const ledgerEntries = Array.isArray(rawState.commandLedger)
    ? rawState.commandLedger
    : Object.entries(rawState.commandLedger && typeof rawState.commandLedger === 'object' ? rawState.commandLedger : {})
      .map(([commandId, entry]) => ({ ...(entry && typeof entry === 'object' ? entry : {}), commandId }));
  const normalized = [...ledgerEntries, ...commandLog].map((entry) => {
    const commandId = cleanToken(entry.commandId || entry.id, null);
    const command = cleanToken(entry.command, DEFAULT_COMMAND);
    const statusAfter = RELEASE_STATUSES.has(entry.statusAfter) ? entry.statusAfter : 'recovering';
    return commandId ? {
      commandId,
      command: COMMANDS.has(command) ? command : DEFAULT_COMMAND,
      statusAfter,
      stateRevision: Number.isSafeInteger(entry.stateRevision) && entry.stateRevision >= 0 ? entry.stateRevision : null,
      resultDigest: typeof entry.resultDigest === 'string' ? entry.resultDigest : proofDigest({
        commandId,
        command,
        statusAfter
      }),
      appliedAt: typeof entry.appliedAt === 'string' ? entry.appliedAt : now
    } : null;
  }).filter(Boolean);
  const byCommandId = new Map();
  for (const entry of normalized) {
    byCommandId.set(entry.commandId, entry);
  }
  return [...byCommandId.values()].slice(-MAX_COMMAND_LOG);
}

function normalizePendingCommand(rawState) {
  const pending = rawState.pendingCommand && typeof rawState.pendingCommand === 'object' ? rawState.pendingCommand : null;
  if (!pending) {
    return null;
  }
  const commandId = cleanToken(pending.commandId || pending.id, null);
  const command = cleanToken(pending.command, null);
  if (!commandId || !COMMANDS.has(command) || command === DEFAULT_COMMAND) {
    return null;
  }
  return {
    commandId,
    command,
    statusBefore: RELEASE_STATUSES.has(pending.statusBefore) ? pending.statusBefore : 'recovering',
    statusAfter: RELEASE_STATUSES.has(pending.statusAfter) ? pending.statusAfter : null,
    startedAt: normalizeIsoTimestamp(pending.startedAt || pending.createdAt),
    checkpointedAt: normalizeIsoTimestamp(pending.checkpointedAt || pending.updatedAt || pending.startedAt),
    expectedRevision: Number.isSafeInteger(pending.expectedRevision) && pending.expectedRevision >= 0
      ? pending.expectedRevision
      : null,
    attempt: normalizePositiveInteger(pending.attempt || pending.retryAttempt, 1),
    operationDigest: cleanToken(pending.operationDigest || pending.digest, null),
    resumeToken: cleanToken(pending.resumeToken, null)
  };
}

function normalizePersistedRecoveryCheckpoint(rawState, stateScope, now) {
  const candidates = [
    rawState.recoveryCheckpoint,
    rawState.restartRecoveryCheckpoint,
    rawState.commandRecoveryPlan?.checkpoint,
    rawState.restartResumeContract?.checkpoint
  ].filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  const source = candidates[0] || null;
  if (!source) {
    return null;
  }

  const commandId = cleanToken(source.commandId || source.id, null);
  const command = cleanToken(source.command, null);
  const statusBefore = RELEASE_STATUSES.has(source.statusBefore) ? source.statusBefore : 'recovering';
  const statusAfter = RELEASE_STATUSES.has(source.statusAfter) ? source.statusAfter : null;
  const expectedRevision = Number.isSafeInteger(source.expectedRevision) && source.expectedRevision >= 0
    ? source.expectedRevision
    : null;
  const checkpointRevision = Number.isSafeInteger(source.checkpointRevision)
    ? source.checkpointRevision
    : (Number.isSafeInteger(source.revision) ? source.revision : expectedRevision);
  const tenantId = cleanToken(source.tenantId, stateScope.tenantId);
  const workspaceId = cleanToken(source.workspaceId, stateScope.workspaceId);
  const releaseId = cleanToken(source.releaseId, stateScope.releaseId);
  const tenantScoped = tenantId === stateScope.tenantId;
  const workspaceScoped = workspaceId === stateScope.workspaceId;
  const releaseScoped = releaseId === stateScope.releaseId;
  const commandSupported = command !== null && COMMANDS.has(command) && command !== DEFAULT_COMMAND;
  const revisionUsable = expectedRevision === null || expectedRevision <= stateScope.revision + 1;
  const checkpointedAt = normalizeIsoTimestamp(source.checkpointedAt || source.updatedAt || source.createdAt) || now;
  const operationDigest = cleanToken(source.operationDigest || source.digest, null) || proofDigest({
    releaseId: stateScope.releaseId,
    tenantId: stateScope.tenantId,
    workspaceId: stateScope.workspaceId,
    commandId,
    command,
    statusBefore,
    expectedRevision
  });
  const blockedReasons = [
    ...(commandId ? [] : ['recovery_checkpoint_command_id_missing']),
    ...(commandSupported ? [] : ['recovery_checkpoint_command_unsupported']),
    ...(tenantScoped ? [] : ['recovery_checkpoint_tenant_mismatch']),
    ...(workspaceScoped ? [] : ['recovery_checkpoint_workspace_mismatch']),
    ...(releaseScoped ? [] : ['recovery_checkpoint_release_mismatch']),
    ...(revisionUsable ? [] : ['recovery_checkpoint_revision_ahead'])
  ];
  const usable = blockedReasons.length === 0;

  return {
    schemaVersion: 1,
    checkpointType: 'release-command-recovery-checkpoint',
    source: rawState.recoveryCheckpoint ? 'recoveryCheckpoint' : (rawState.restartRecoveryCheckpoint
      ? 'restartRecoveryCheckpoint'
      : (rawState.commandRecoveryPlan?.checkpoint ? 'commandRecoveryPlan.checkpoint' : 'restartResumeContract.checkpoint')),
    releaseId,
    tenantId,
    workspaceId,
    expectedReleaseId: stateScope.releaseId,
    expectedTenantId: stateScope.tenantId,
    expectedWorkspaceId: stateScope.workspaceId,
    commandId,
    command,
    statusBefore,
    statusAfter,
    checkpointRevision,
    expectedRevision,
    attempt: normalizePositiveInteger(source.attempt || source.retryAttempt, 1),
    operationDigest,
    resumeToken: cleanToken(source.resumeToken, null),
    checkpointedAt,
    tenantScoped,
    workspaceScoped,
    releaseScoped,
    revisionUsable,
    usable,
    blockedReasons,
    pendingCommand: usable ? {
      commandId,
      command,
      statusBefore,
      statusAfter,
      startedAt: normalizeIsoTimestamp(source.startedAt || source.createdAt) || checkpointedAt,
      checkpointedAt,
      expectedRevision,
      attempt: normalizePositiveInteger(source.attempt || source.retryAttempt, 1),
      operationDigest,
      resumeToken: cleanToken(source.resumeToken, null)
    } : null,
    digest: proofDigest({
      releaseId,
      tenantId,
      workspaceId,
      commandId,
      command,
      statusBefore,
      statusAfter,
      checkpointRevision,
      expectedRevision,
      operationDigest,
      blockedReasons
    })
  };
}

function normalizeIsoTimestamp(value) {
  const token = cleanToken(value, null);
  if (!token) {
    return null;
  }
  const timestamp = Date.parse(token);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeScheduleBlackoutWindows(value, requestedReleaseAt, now) {
  return asArray(value).map((window, index) => {
    const startsAt = normalizeIsoTimestamp(window.startsAt || window.startAt || window.from);
    const endsAt = normalizeIsoTimestamp(window.endsAt || window.endAt || window.until);
    const valid = Boolean(startsAt && endsAt && Date.parse(startsAt) < Date.parse(endsAt));
    const requestedMs = requestedReleaseAt ? Date.parse(requestedReleaseAt) : null;
    const activeForRequestedRelease = valid
      && requestedMs !== null
      && Date.parse(startsAt) <= requestedMs
      && requestedMs < Date.parse(endsAt);
    return {
      windowId: cleanToken(window.windowId || window.id, `blackout-${index + 1}`),
      startsAt,
      endsAt,
      reason: cleanToken(window.reason, 'release blackout window'),
      valid,
      activeForRequestedRelease,
      alreadyElapsed: valid ? Date.parse(endsAt) <= Date.parse(now) : false
    };
  });
}

function normalizeScheduleControls(input, source, requestedReleaseAt, now) {
  const controls = input.scheduleControls && typeof input.scheduleControls === 'object'
    ? input.scheduleControls
    : (source.scheduleControls && typeof source.scheduleControls === 'object' ? source.scheduleControls : {});
  const minLeadSeconds = normalizeNonNegativeInteger(
    controls.minLeadSeconds ?? controls.minimumLeadSeconds,
    DEFAULT_SCHEDULE_LEAD_SECONDS
  );
  const maxFutureSeconds = normalizePositiveInteger(
    controls.maxFutureSeconds ?? controls.maximumFutureSeconds,
    DEFAULT_SCHEDULE_MAX_FUTURE_SECONDS
  );
  const nowMs = Date.parse(now);
  const requestedMs = requestedReleaseAt ? Date.parse(requestedReleaseAt) : null;
  const earliestAllowedAt = addSeconds(now, minLeadSeconds);
  const latestAllowedAt = addSeconds(now, maxFutureSeconds);
  const blackoutWindows = normalizeScheduleBlackoutWindows(
    controls.blackoutWindows || controls.releaseBlackouts,
    requestedReleaseAt,
    now
  );
  const blockingBlackoutWindows = blackoutWindows.filter((window) => window.activeForRequestedRelease);
  const leadTimeSatisfied = requestedMs === null || requestedMs >= nowMs + (minLeadSeconds * 1000);
  const maxFutureSatisfied = requestedMs === null || requestedMs <= nowMs + (maxFutureSeconds * 1000);
  const violations = [
    ...(leadTimeSatisfied ? [] : ['minimum_schedule_lead_time_not_met']),
    ...(maxFutureSatisfied ? [] : ['maximum_schedule_horizon_exceeded']),
    ...(blockingBlackoutWindows.length > 0 ? ['release_blackout_window'] : [])
  ];
  const blackoutReleaseCandidates = blockingBlackoutWindows
    .map((window) => window.endsAt)
    .filter(Boolean)
    .sort();
  const blackoutReleaseAt = blackoutReleaseCandidates.length > 0
    ? blackoutReleaseCandidates[blackoutReleaseCandidates.length - 1]
    : null;
  const nextSchedulableCandidates = [earliestAllowedAt, blackoutReleaseAt]
    .filter(Boolean)
    .sort();
  const nextSchedulableReleaseAt = nextSchedulableCandidates[nextSchedulableCandidates.length - 1] || earliestAllowedAt;

  return {
    schemaVersion: 1,
    minLeadSeconds,
    maxFutureSeconds,
    earliestAllowedAt,
    latestAllowedAt,
    requireDisableReason: controls.requireDisableReason === true,
    blackoutWindowCount: blackoutWindows.length,
    blockingBlackoutWindowIds: blockingBlackoutWindows.map((window) => window.windowId),
    blackoutWindows,
    violations,
    scheduleAllowed: violations.length === 0,
    nextSchedulableReleaseAt
  };
}

function normalizeLifecycleSettings(input, rawState, boundary, now) {
  const source = input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
    ? input.lifecycleSettings
    : (rawState.lifecycleSettings && typeof rawState.lifecycleSettings === 'object' ? rawState.lifecycleSettings : {});
  const tenantId = cleanToken(source.tenantId, null);
  const workspaceId = cleanToken(source.workspaceId, null);
  const tenantScoped = scopedValueMatches(tenantId, boundary.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, boundary.workspaceId);
  const requestedDisabledReason = cleanToken(input.disabledReason || source.requestedDisabledReason, null);
  const disabledReason = cleanToken(source.disabledReason || requestedDisabledReason, null);
  const requestedReleaseAt = normalizeIsoTimestamp(input.releaseAt || input.scheduledFor || input.scheduledReleaseAt);
  const scheduledReleaseAt = requestedReleaseAt || normalizeIsoTimestamp(source.scheduledReleaseAt || source.releaseAt);
  const scheduleInvalid = Boolean(cleanToken(input.releaseAt || input.scheduledFor || input.scheduledReleaseAt, null)) && !requestedReleaseAt;
  const releaseHoldUntil = normalizeIsoTimestamp(source.releaseHoldUntil || input.releaseHoldUntil);
  const nowMs = Date.parse(now);
  const scheduledMs = scheduledReleaseAt ? Date.parse(scheduledReleaseAt) : null;
  const holdMs = releaseHoldUntil ? Date.parse(releaseHoldUntil) : null;
  const enabled = source.enabled === false || input.lifecycleEnabled === false ? false : true;
  const releaseWindowOpen = (!scheduledMs || scheduledMs <= nowMs) && (!holdMs || holdMs <= nowMs);
  const scheduleControls = normalizeScheduleControls(input, source, requestedReleaseAt, now);
  const scheduleRejected = scheduleInvalid || (requestedReleaseAt !== null && !scheduleControls.scheduleAllowed);

  return {
    schemaVersion: 1,
    settingsId: cleanToken(source.settingsId || source.id, `${boundary.tenantId}/${boundary.workspaceId}/release-lifecycle`),
    tenantId,
    workspaceId,
    tenantScoped,
    workspaceScoped,
    enabled,
    requestedDisabledReason,
    disabledReason: enabled ? null : (disabledReason || 'release lifecycle disabled'),
    scheduledReleaseAt,
    releaseHoldUntil,
    requestedReleaseAt,
    scheduleInvalid,
    scheduleRejected,
    scheduleRejectedReasons: [
      ...(scheduleInvalid ? ['invalid_release_schedule'] : []),
      ...scheduleControls.violations
    ],
    scheduleControls,
    releaseWindowOpen,
    nextEligibleReleaseAt: releaseWindowOpen
      ? null
      : [scheduledReleaseAt, releaseHoldUntil].filter(Boolean).sort()[0],
    nextSchedulableReleaseAt: scheduleRejected ? scheduleControls.nextSchedulableReleaseAt : null,
    updatedAt: normalizeIsoTimestamp(source.updatedAt) || now
  };
}

function statusRestartClass(status) {
  if (TERMINAL_STATUSES.has(status)) {
    return 'terminal';
  }
  return status === 'recovering' ? 'needs_recovery' : 'actionable';
}

function normalizeActor(input) {
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  return {
    actorId: cleanToken(actor.actorId || actor.id || input.actorId, 'anonymous'),
    roles: normalizeRoles(actor.roles || input.roles),
    tenantId: cleanToken(actor.tenantId || input.tenantId, 'tenant:default'),
    workspaceId: cleanToken(actor.workspaceId || input.workspaceId, 'workspace:default')
  };
}

function normalizeBoundary(input, actor) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const tenantId = cleanToken(input.tenantId || rawState.tenantId || actor.tenantId, actor.tenantId);
  const workspaceId = cleanToken(input.workspaceId || rawState.workspaceId || actor.workspaceId, actor.workspaceId);
  return {
    tenantId,
    workspaceId,
    actorTenantMatches: actor.tenantId === tenantId,
    actorWorkspaceMatches: actor.workspaceId === workspaceId,
    stateTenantMatches: !rawState.tenantId || rawState.tenantId === tenantId,
    stateWorkspaceMatches: !rawState.workspaceId || rawState.workspaceId === workspaceId
  };
}

function normalizeWorkspaceAccess(input, actor, boundary) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const policy = input.workspaceAccess && typeof input.workspaceAccess === 'object'
    ? input.workspaceAccess
    : (input.workspacePolicy && typeof input.workspacePolicy === 'object'
      ? input.workspacePolicy
      : (rawState.workspaceAccess && typeof rawState.workspaceAccess === 'object'
        ? rawState.workspaceAccess
        : rawState.workspacePolicy));

  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return {
      schemaVersion: 1,
      policyPresent: false,
      allowed: true,
      deniedReason: null,
      tenantScoped: true,
      workspaceScoped: true,
      memberRequired: false,
      actorDirectlyAllowed: false,
      actorRoleAllowed: false,
      actorDenied: false,
      matchedRoles: [],
      allowedActorCount: 0,
      deniedActorCount: 0,
      boundRoleCount: 0
    };
  }

  const tenantId = cleanToken(policy.tenantId, null);
  const workspaceId = cleanToken(policy.workspaceId, null);
  const tenantScoped = scopedValueMatches(tenantId, boundary.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, boundary.workspaceId);
  const allowedActorIds = normalizeTokenList(policy.allowedActorIds || policy.members || policy.actorIds);
  const deniedActorIds = normalizeTokenList(policy.deniedActorIds || policy.revokedActorIds);
  const roleBindings = normalizeRoleBindings(policy.roleBindings || policy.roleMembers);
  const matchedRoles = actor.roles.filter((role) => roleBindings[role]?.includes(actor.actorId));
  const memberRequired = allowedActorIds.length > 0 || Object.keys(roleBindings).length > 0;
  const actorDirectlyAllowed = allowedActorIds.includes(actor.actorId);
  const actorRoleAllowed = matchedRoles.length > 0;
  const actorDenied = deniedActorIds.includes(actor.actorId);
  const allowed = tenantScoped && workspaceScoped && !actorDenied && (!memberRequired || actorDirectlyAllowed || actorRoleAllowed);

  return {
    schemaVersion: 1,
    policyPresent: true,
    policyId: cleanToken(policy.policyId || policy.id, null),
    allowed,
    deniedReason: allowed ? null : (!tenantScoped || !workspaceScoped
      ? 'workspace_policy_outside_boundary'
      : (actorDenied ? 'actor_revoked_from_workspace' : 'actor_not_workspace_member')),
    tenantId,
    workspaceId,
    tenantScoped,
    workspaceScoped,
    memberRequired,
    actorDirectlyAllowed,
    actorRoleAllowed,
    actorDenied,
    matchedRoles,
    allowedActorCount: allowedActorIds.length,
    deniedActorCount: deniedActorIds.length,
    boundRoleCount: Object.keys(roleBindings).length
  };
}

function authorizeCommand(command, actor, boundary, workspaceAccess = null) {
  const requiredRoles = COMMAND_ROLE_REQUIREMENTS[command] || [];
  const hasRole = requiredRoles.length === 0 || requiredRoles.some((role) => actor.roles.includes(role));
  const workspaceAllowed = !workspaceAccess || workspaceAccess.allowed;
  const boundaryAllowed = boundary.actorTenantMatches && boundary.actorWorkspaceMatches && workspaceAllowed;
  return {
    allowed: hasRole && boundaryAllowed,
    requiredRoles,
    actorRoles: actor.roles,
    deniedReason: boundaryAllowed
      ? (hasRole ? null : 'missing_required_role')
      : (!boundary.actorTenantMatches || !boundary.actorWorkspaceMatches
        ? 'actor_outside_workspace_boundary'
        : workspaceAccess.deniedReason)
  };
}

function normalizeState(input, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const actor = normalizeActor(input);
  const boundary = normalizeBoundary(input, actor);
  const stateInBoundary = boundary.stateTenantMatches && boundary.stateWorkspaceMatches;
  const scopedRawState = stateInBoundary ? rawState : {};
  const commandLog = asArray(scopedRawState.commandLog).map((entry) => ({
    commandId: String(entry.commandId || entry.id || 'unknown-command'),
    command: String(entry.command || DEFAULT_COMMAND),
    statusAfter: RELEASE_STATUSES.has(entry.statusAfter) ? entry.statusAfter : 'recovering',
    appliedAt: typeof entry.appliedAt === 'string' ? entry.appliedAt : now
  }));
  const lastKnownStatus = RELEASE_STATUSES.has(scopedRawState.status) ? scopedRawState.status : 'recovering';
  const revision = Number.isSafeInteger(scopedRawState.revision) && scopedRawState.revision >= 0 ? scopedRawState.revision : 0;
  const commandLedger = normalizeCommandLedger(scopedRawState, commandLog, now);
  const pendingCommand = normalizePendingCommand(scopedRawState);
  const releaseId = String(scopedRawState.releaseId || input.releaseId || `${surfaceName}:unassigned`);
  const recoveryCheckpoint = stateInBoundary ? normalizePersistedRecoveryCheckpoint(scopedRawState, {
    releaseId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    revision
  }, now) : null;
  const lifecycleSettings = normalizeLifecycleSettings(input, scopedRawState, boundary, now);
  const restartStatus = !TERMINAL_STATUSES.has(lastKnownStatus) && (pendingCommand || recoveryCheckpoint?.usable)
    ? 'needs_recovery'
    : statusRestartClass(lastKnownStatus);
  const recoveryReasons = [
    ...(rawState.status && !RELEASE_STATUSES.has(rawState.status) ? ['invalid_persisted_status'] : []),
    ...(stateInBoundary ? [] : ['state_boundary_mismatch']),
    ...(scopedRawState.revision !== undefined && !Number.isSafeInteger(scopedRawState.revision) ? ['invalid_revision'] : []),
    ...(pendingCommand ? ['pending_command_interrupted'] : []),
    ...(recoveryCheckpoint ? ['recovery_checkpoint_recorded'] : []),
    ...(recoveryCheckpoint && !recoveryCheckpoint.usable ? recoveryCheckpoint.blockedReasons : [])
  ];

  return {
    schemaVersion: 1,
    releaseId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    status: lastKnownStatus,
    revision,
    lastCommandId: typeof scopedRawState.lastCommandId === 'string' ? scopedRawState.lastCommandId : null,
    recoveredFrom: rawState.status && !RELEASE_STATUSES.has(rawState.status) ? rawState.status : null,
    boundaryRecoveredFrom: stateInBoundary ? null : {
      tenantId: rawState.tenantId || null,
      workspaceId: rawState.workspaceId || null
    },
    pendingCommand: stateInBoundary ? pendingCommand : null,
    recoveryCheckpoint,
    recoveryReasons,
    restartStatus,
    lifecycleSettings,
    commandLedger: stateInBoundary ? commandLedger : [],
    commandLog: commandLog.slice(-MAX_COMMAND_LOG),
    updatedAt: typeof scopedRawState.updatedAt === 'string' ? scopedRawState.updatedAt : now
  };
}

function findAppliedCommand(state, commandId) {
  return commandId
    ? state.commandLedger.find((entry) => entry.commandId === commandId) || null
    : null;
}

function buildCommandRecoveryPlan(state, command, commandId, now) {
  const effectiveCommand = COMMANDS.has(command) ? command : DEFAULT_COMMAND;
  const appliedCommand = findAppliedCommand(state, commandId);
  const pending = state.pendingCommand || state.recoveryCheckpoint?.pendingCommand || null;
  const pendingSource = state.pendingCommand ? 'pendingCommand' : (state.recoveryCheckpoint?.pendingCommand ? 'recoveryCheckpoint' : null);
  const pendingMatchesRequest = Boolean(pending && pending.commandId === commandId);
  const pendingConflictsWithRequest = Boolean(
    pending
      && !pendingMatchesRequest
      && effectiveCommand !== DEFAULT_COMMAND
      && effectiveCommand !== 'recover'
  );
  const restartBlocked = state.restartStatus === 'needs_recovery' || pendingConflictsWithRequest;
  const requiredCommand = pending
    ? 'recover'
    : (state.restartStatus === 'needs_recovery' ? 'recover' : null);
  const status = appliedCommand
    ? 'already_applied'
    : (pendingMatchesRequest
      ? 'pending_replay_deferred'
      : (pendingConflictsWithRequest
        ? 'blocked_by_interrupted_command'
        : (state.restartStatus === 'needs_recovery' ? 'recovery_required' : 'clear')));
  const blockedReasons = [
    ...(state.restartStatus === 'needs_recovery' ? ['state_restart_recovery_required'] : []),
    ...(pending ? ['pending_command_interrupted'] : []),
    ...(pendingConflictsWithRequest ? ['conflicting_command_while_pending'] : [])
  ];
  const checkpoint = pending ? {
    commandId: pending.commandId,
    command: pending.command,
    statusBefore: pending.statusBefore,
    statusAfter: pending.statusAfter,
    expectedRevision: pending.expectedRevision,
    attempt: pending.attempt,
    startedAt: pending.startedAt,
    checkpointedAt: pending.checkpointedAt,
    operationDigest: pending.operationDigest || proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      commandId: pending.commandId,
      command: pending.command,
      statusBefore: pending.statusBefore,
      expectedRevision: pending.expectedRevision
    }),
      resumeToken: pending.resumeToken
  } : null;

  return {
    schemaVersion: 1,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    command: effectiveCommand,
    commandId,
    status,
    restartBlocked,
    blockedReasons,
    requiredCommand,
    pendingSource,
    idempotentReplay: Boolean(appliedCommand || pendingMatchesRequest),
    pendingMatchesRequest,
    pendingConflictsWithRequest,
    appliedCommand: appliedCommand ? {
      commandId: appliedCommand.commandId,
      command: appliedCommand.command,
      statusAfter: appliedCommand.statusAfter,
      stateRevision: appliedCommand.stateRevision,
      resultDigest: appliedCommand.resultDigest,
      appliedAt: appliedCommand.appliedAt
    } : null,
    checkpoint,
    persistedCheckpoint: state.recoveryCheckpoint || null,
    recoveryCommand: requiredCommand ? {
      command: requiredCommand,
      commandId: pending ? `recover:${pending.commandId}` : `recover:${state.revision}`,
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      resumeToken: checkpoint ? checkpoint.resumeToken : null
    } : null,
    evaluatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      command: effectiveCommand,
      commandId,
      status,
      blockedReasons,
      checkpoint
    })
  };
}

function buildRestartResumeContract(state, commandRecoveryPlan, now) {
  const checkpoint = commandRecoveryPlan?.checkpoint || state.recoveryCheckpoint?.pendingCommand || null;
  const recoveryCommand = commandRecoveryPlan?.recoveryCommand || null;
  const replayProtected = commandRecoveryPlan?.appliedCommand !== null;
  const resumeAvailable = Boolean(checkpoint && recoveryCommand && !replayProtected);
  const clearCheckpointPatch = {
    pendingCommand: null,
    recoveryCheckpoint: null,
    restartResumeContract: null,
    restartStatus: statusRestartClass(state.status),
    recoveryReasons: state.recoveryReasons.filter((reason) => ![
      'pending_command_interrupted',
      'recovery_checkpoint_recorded'
    ].includes(reason)),
    updatedAt: now
  };

  return {
    schemaVersion: 1,
    contractType: 'release-packet-restart-resume',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    restartStatus: state.restartStatus,
    resumeAvailable,
    replayProtected,
    recoveryStatus: commandRecoveryPlan?.status || 'clear',
    blockedReasons: commandRecoveryPlan?.blockedReasons || [],
    checkpoint,
    recoveryCommand,
    idempotency: {
      strategy: 'command-ledger-and-checkpoint-digest',
      commandId: checkpoint?.commandId || recoveryCommand?.commandId || null,
      operationDigest: checkpoint?.operationDigest || state.recoveryCheckpoint?.operationDigest || null,
      ledgerContainsCommand: checkpoint ? findAppliedCommand(state, checkpoint.commandId) !== null : false,
      safeReplay: commandRecoveryPlan?.idempotentReplay === true || resumeAvailable
    },
    resumePayload: resumeAvailable ? {
      command: recoveryCommand.command,
      commandId: recoveryCommand.commandId,
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      expectedRevision: checkpoint.expectedRevision,
      resumeToken: checkpoint.resumeToken,
      recoveryCheckpointDigest: state.recoveryCheckpoint?.digest || proofDigest(checkpoint)
    } : null,
    persistencePatch: resumeAvailable ? {
      pendingCommand: checkpoint,
      restartStatus: 'needs_recovery',
      recoveryCheckpoint: state.recoveryCheckpoint,
      updatedAt: now
    } : clearCheckpointPatch,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      restartStatus: state.restartStatus,
      resumeAvailable,
      replayProtected,
      recoveryStatus: commandRecoveryPlan?.status || 'clear',
      checkpoint,
      recoveryCommand
    })
  };
}

function buildStateHealth(state) {
  const lastLedgerEntry = state.lastCommandId ? findAppliedCommand(state, state.lastCommandId) : null;
  const recoveryPlan = state.commandRecoveryPlan || null;
  const restartResume = state.restartResumeContract || null;
  const checks = [
    {
      checkId: 'status-valid',
      status: RELEASE_STATUSES.has(state.status) ? 'passed' : 'failed',
      detail: `status ${state.status}`
    },
    {
      checkId: 'restart-classified',
      status: state.restartStatus === 'needs_recovery' ? 'pending' : 'passed',
      detail: state.restartStatus
    },
    {
      checkId: 'last-command-ledgered',
      status: !state.lastCommandId || lastLedgerEntry ? 'passed' : 'failed',
      detail: state.lastCommandId || 'no command applied yet'
    },
    {
      checkId: 'no-pending-command',
      status: state.pendingCommand || state.recoveryCheckpoint?.usable ? 'pending' : 'passed',
      detail: state.pendingCommand?.commandId || state.recoveryCheckpoint?.commandId || 'none'
    },
    {
      checkId: 'restart-recovery-command-safe',
      status: recoveryPlan && recoveryPlan.pendingConflictsWithRequest ? 'failed' : (recoveryPlan && recoveryPlan.restartBlocked ? 'pending' : 'passed'),
      detail: recoveryPlan ? recoveryPlan.status : 'clear'
    },
    {
      checkId: 'restart-resume-contract-shaped',
      status: restartResume && restartResume.resumeAvailable ? 'pending' : (state.recoveryCheckpoint && !state.recoveryCheckpoint.usable ? 'failed' : 'passed'),
      detail: restartResume?.recoveryStatus || state.recoveryCheckpoint?.blockedReasons[0] || 'clear'
    }
  ];
  return {
    schemaVersion: 1,
    healthy: checks.every((check) => check.status !== 'failed'),
    restartSafe: checks.every((check) => check.status === 'passed'),
    recoveryReasons: state.recoveryReasons,
    checks
  };
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function normalizePositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeRetryPolicy(input, source) {
  const policy = input.retryPolicy && typeof input.retryPolicy === 'object'
    ? input.retryPolicy
    : (source.retryPolicy && typeof source.retryPolicy === 'object' ? source.retryPolicy : {});
  return {
    schemaVersion: 1,
    baseDelaySeconds: normalizePositiveInteger(policy.baseDelaySeconds, DEFAULT_HEALTH_RETRY_BASE_SECONDS),
    maxDelaySeconds: normalizePositiveInteger(policy.maxDelaySeconds, DEFAULT_HEALTH_RETRY_MAX_SECONDS),
    maxAttempts: normalizePositiveInteger(policy.maxAttempts, DEFAULT_HEALTH_RETRY_MAX_ATTEMPTS),
    strategy: cleanToken(policy.strategy, 'exponential-backoff')
  };
}

function providerHealthComponent(componentId, status, reason, detail = {}) {
  return {
    componentId,
    route: 'hosted-kernel.provider-contracts',
    status,
    required: true,
    failureCount: normalizeNonNegativeInteger(detail.failureCount, status === 'healthy' ? 0 : 1),
    retryAfter: detail.retryAfter || null,
    lastErrorCode: reason,
    lastErrorMessage: detail.message || reason,
    remediation: detail.remediation || null,
    providerId: detail.providerId || null,
    serviceId: detail.serviceId || null,
    serviceType: detail.serviceType || null,
    observedAt: detail.observedAt || null
  };
}

function deriveProviderHealthComponents(providerContracts, now) {
  if (!providerContracts || providerContracts.contractPresent !== true) {
    return [];
  }
  const missingCapabilityComponents = providerContracts.missingRequiredCapabilities.map((capability) => providerHealthComponent(
    `provider-capability:${capability}`,
    'unavailable',
    'provider_capability_missing',
    {
      message: `No active provider exposes required capability ${capability}`,
      remediation: {
        action: 'attach_provider_capability',
        capability,
        expectedProtocols: [...SUPPORTED_PROVIDER_PROTOCOLS].sort()
      },
      observedAt: now
    }
  ));
  const missingServiceComponents = providerContracts.missingRequiredServiceTypes.map((serviceType) => providerHealthComponent(
    `provider-service:${serviceType}`,
    'unavailable',
    'provider_service_contract_missing',
    {
      serviceType,
      message: `No active provider has a ready ${serviceType} service contract`,
      remediation: {
        action: 'attach_provider_service_contract',
        serviceType,
        requiredServices: providerContracts.requiredServices
      },
      observedAt: now
    }
  ));
  const staleProviderComponents = providerContracts.providers
    .filter((provider) => provider.active && provider.sync.inSync === false)
    .map((provider) => providerHealthComponent(
      `provider-sync:${provider.providerId}`,
      'degraded',
      'provider_sync_stale',
      {
        providerId: provider.providerId,
        failureCount: provider.sync.syncLag,
        message: `${provider.providerId} is ${provider.sync.syncLag} revision(s) behind release packet state`,
        remediation: {
        action: 'resync_provider_contract',
        providerId: provider.providerId,
        lastSyncedRevision: provider.sync.lastSyncedRevision,
        syncCursor: provider.sync.cursor
      },
        observedAt: provider.observedAt || now
      }
    ));
  const staleServiceComponents = providerContracts.staleProviderServices.map((service) => providerHealthComponent(
    `provider-service-sync:${service.providerId}:${service.serviceType}`,
    'degraded',
    'provider_service_sync_stale',
    {
      providerId: service.providerId,
      serviceId: service.serviceId,
      serviceType: service.serviceType,
      failureCount: service.syncLag,
      message: `${service.serviceType} service ${service.serviceId} is ${service.syncLag} revision(s) behind`,
      remediation: {
        action: 'resync_provider_service',
        providerId: service.providerId,
        serviceId: service.serviceId,
        serviceType: service.serviceType
      },
      observedAt: now
    }
  ));
  const incompatibleProviderComponents = providerContracts.providers
    .filter((provider) => provider.tenantScoped && provider.workspaceScoped && !provider.protocol.compatible)
    .map((provider) => providerHealthComponent(
      `provider-protocol:${provider.providerId}`,
      'unavailable',
      'provider_protocol_incompatible',
      {
        providerId: provider.providerId,
        message: `${provider.providerId} does not offer a supported release-provider protocol`,
        remediation: {
          action: 'upgrade_provider_protocol',
          providerId: provider.providerId,
          offeredProtocols: provider.protocol.offeredProtocols,
          requiredProtocols: provider.protocol.requiredProtocols
        },
        observedAt: provider.observedAt || now
      }
    ));
  const incompatibleServiceComponents = providerContracts.incompatibleProviderServices.map((service) => providerHealthComponent(
    `provider-service-protocol:${service.providerId}:${service.serviceType}`,
    'unavailable',
    'provider_service_protocol_incompatible',
    {
      providerId: service.providerId,
      serviceId: service.serviceId,
      serviceType: service.serviceType,
      message: `${service.serviceType} service ${service.serviceId} does not offer a supported protocol`,
      remediation: {
        action: 'upgrade_provider_service_protocol',
        providerId: service.providerId,
        serviceId: service.serviceId,
        serviceType: service.serviceType,
        offeredProtocols: service.offeredProtocols,
        requiredProtocols: [...SUPPORTED_PROVIDER_PROTOCOLS].sort()
      },
      observedAt: now
    }
  ));
  const handoffComponent = providerContracts.handoffAccepted || providerContracts.command !== 'release'
    ? []
    : [providerHealthComponent('provider-handoff:release', 'unavailable', 'external_release_handoff_not_accepted', {
      message: providerContracts.externalHandoffContract?.blockedReasons[0] || 'Release handoff provider has not accepted the external release submission contract',
      remediation: {
        action: providerContracts.externalHandoffContract?.status === 'missing'
          ? 'attach_external_release_handoff_provider'
          : 'confirm_external_release_handoff',
        requiredCapability: 'external.release-handoff',
        requiredServiceType: 'release-handoff',
        expectedTarget: providerContracts.externalHandoffContract?.target || null,
        expectedReleaseId: providerContracts.externalHandoffContract?.releaseId || null,
        expectedMinimumRevision: providerContracts.externalHandoffContract?.revision || null
      },
      observedAt: now
    })];

  return [
    ...missingCapabilityComponents,
    ...missingServiceComponents,
    ...staleProviderComponents,
    ...staleServiceComponents,
    ...incompatibleProviderComponents,
    ...incompatibleServiceComponents,
    ...handoffComponent
  ];
}

function addSeconds(isoTimestamp, seconds) {
  const baseMs = Date.parse(isoTimestamp);
  return new Date(baseMs + (seconds * 1000)).toISOString();
}

function buildHealthRetryPlan(component, retryPolicy, now) {
  const retryRequired = component.status !== 'healthy' || component.stale;
  const attempt = retryRequired ? Math.max(1, component.failureCount + 1) : 0;
  const exponentialDelay = retryRequired
    ? retryPolicy.baseDelaySeconds * (2 ** Math.max(0, attempt - 1))
    : 0;
  const backoffSeconds = retryRequired
    ? Math.min(retryPolicy.maxDelaySeconds, exponentialDelay)
    : 0;
  const exhausted = retryRequired && attempt > retryPolicy.maxAttempts;
  const nextRetryAt = retryRequired
    ? (component.retryAfter || addSeconds(now, backoffSeconds))
    : null;
  return {
    retryRequired,
    retryable: retryRequired && !exhausted,
    attempt,
    maxAttempts: retryPolicy.maxAttempts,
    exhausted,
    backoffSeconds,
    nextRetryAt,
    escalationRequired: exhausted || (component.required && component.blocking),
    reason: retryRequired
      ? (component.stale ? 'component_health_stale' : `component_${component.status}`)
      : 'component_healthy'
  };
}

function normalizeOperationalHealth(input, state, command, now, providerContracts = null) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : (rawState.operationalHealth && typeof rawState.operationalHealth === 'object' ? rawState.operationalHealth : {});
  const retryPolicy = normalizeRetryPolicy(input, source);
  const componentEntries = Array.isArray(source.components)
    ? source.components
    : Object.entries(source.components && typeof source.components === 'object' ? source.components : {})
      .map(([componentId, component]) => ({ ...(component && typeof component === 'object' ? component : {}), componentId }));
  const providerDerivedComponents = deriveProviderHealthComponents(providerContracts, now);
  const components = [...componentEntries, ...providerDerivedComponents].map((component, index) => {
    const status = ['healthy', 'degraded', 'unavailable', 'unknown'].includes(component.status) ? component.status : 'unknown';
    const required = component.required !== false;
    const failureCount = normalizeNonNegativeInteger(component.failureCount || component.consecutiveFailures, 0);
    const retryAfter = normalizeIsoTimestamp(component.retryAfter || component.retryAfterAt || component.nextRetryAt);
    const staleAfter = normalizeIsoTimestamp(component.staleAfter || component.expiresAt);
    const stale = staleAfter ? Date.parse(staleAfter) <= Date.parse(now) : false;
    const blocking = required && (status === 'unavailable' || stale);
    const normalizedComponent = {
      componentId: cleanToken(component.componentId || component.id || component.name, `component-${index + 1}`),
      route: cleanToken(component.route, `${surfaceGroup}/${surfaceName}`),
      status,
      required,
      blocking,
      degraded: status === 'degraded' || status === 'unknown' || stale,
      stale,
      failureCount,
      lastErrorCode: cleanToken(component.lastErrorCode || component.errorCode, null),
      lastErrorMessage: cleanToken(component.lastErrorMessage || component.message, null),
      remediation: component.remediation && typeof component.remediation === 'object' ? component.remediation : null,
      providerId: cleanToken(component.providerId, null),
      serviceId: cleanToken(component.serviceId, null),
      serviceType: cleanToken(component.serviceType, null),
      retryAfter,
      staleAfter,
      observedAt: normalizeIsoTimestamp(component.observedAt || component.updatedAt) || now
    };
    return {
      ...normalizedComponent,
      retryPlan: buildHealthRetryPlan(normalizedComponent, retryPolicy, now)
    };
  });
  const degradedModeEnabled = source.degradedModeEnabled === true || source.allowDegradedMode === true;
  const degradedModeAcknowledged = source.degradedModeAcknowledged === true || source.degradedModeAccepted === true;
  const commandRequiresHealthy = command === 'release' || command === 'prepare';
  const blockingComponents = components.filter((component) => component.blocking);
  const degradedComponents = components.filter((component) => component.degraded && !component.blocking);
  const retryAfterCandidates = components
    .map((component) => component.retryPlan.nextRetryAt || component.retryAfter)
    .filter(Boolean)
    .sort();
  const exhaustedComponents = components.filter((component) => component.retryPlan.exhausted);
  const degradedReleaseNeedsAcknowledgement = command === 'release'
    && degradedComponents.length > 0
    && degradedModeEnabled
    && !degradedModeAcknowledged;
  const commandBlocked = commandRequiresHealthy
    && ((blockingComponents.length > 0 && !degradedModeEnabled)
      || exhaustedComponents.some((component) => component.required)
      || degradedReleaseNeedsAcknowledgement);
  const failureState = blockingComponents.length > 0
    ? 'failed'
    : (degradedComponents.length > 0 || degradedModeEnabled ? 'degraded' : 'healthy');
  const actionableErrors = [
    ...blockingComponents.map((component) => ({
      code: component.stale ? 'operational_component_stale' : 'operational_component_unavailable',
      severity: component.retryPlan.exhausted ? 'critical' : 'error',
      componentId: component.componentId,
      route: component.route,
      retryAfter: component.retryPlan.nextRetryAt,
      retryPlan: component.retryPlan,
      remediation: component.remediation,
      providerId: component.providerId,
      serviceId: component.serviceId,
      serviceType: component.serviceType,
      message: component.lastErrorMessage || `${component.componentId} is not available for release packet commands`
    })),
    ...degradedComponents.map((component) => ({
      code: component.stale ? 'operational_component_stale' : 'operational_component_degraded',
      severity: degradedReleaseNeedsAcknowledgement ? 'warning' : 'info',
      componentId: component.componentId,
      route: component.route,
      retryAfter: component.retryPlan.nextRetryAt,
      retryPlan: component.retryPlan,
      remediation: component.remediation,
      providerId: component.providerId,
      serviceId: component.serviceId,
      serviceType: component.serviceType,
      message: component.lastErrorMessage || `${component.componentId} is degraded`
    })),
    ...(degradedReleaseNeedsAcknowledgement ? [{
      code: 'degraded_mode_acknowledgement_required',
      severity: 'warning',
      componentId: 'release-packet',
      route: `${surfaceGroup}/${surfaceName}`,
      retryAfter: retryAfterCandidates[0] || null,
      retryPlan: null,
      message: 'Release requires explicit degraded-mode acknowledgement before submission'
    }] : []),
    ...exhaustedComponents.map((component) => ({
      code: 'operational_retry_budget_exhausted',
      severity: 'critical',
      componentId: component.componentId,
      route: component.route,
      retryAfter: component.retryPlan.nextRetryAt,
      retryPlan: component.retryPlan,
      remediation: component.remediation,
      providerId: component.providerId,
      serviceId: component.serviceId,
      serviceType: component.serviceType,
      message: `${component.componentId} exhausted ${component.retryPlan.maxAttempts} retry attempt(s)`
    }))
  ];
  const retryPlanSummary = {
    policy: retryPolicy,
    retryableComponentCount: components.filter((component) => component.retryPlan.retryable).length,
    exhaustedComponentCount: exhaustedComponents.length,
    nextRetryAt: retryAfterCandidates[0] || null,
    escalationRequired: components.some((component) => component.retryPlan.escalationRequired),
    components: components.map((component) => ({
      componentId: component.componentId,
      status: component.status,
      required: component.required,
      retryPlan: component.retryPlan
    }))
  };

  return {
    schemaVersion: 1,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    command,
    status: failureState,
    healthy: failureState === 'healthy',
    degradedModeEnabled,
    degradedModeAcknowledged,
    commandRequiresHealthy,
    commandBlocked,
    retryAfter: retryPlanSummary.nextRetryAt,
    retryPlan: retryPlanSummary,
    failureState: {
      state: failureState,
      commandBlocked,
      blockedReasons: [
        ...(blockingComponents.length > 0 && !degradedModeEnabled ? ['required_component_unavailable'] : []),
        ...(exhaustedComponents.some((component) => component.required) ? ['retry_budget_exhausted'] : []),
        ...(degradedReleaseNeedsAcknowledgement ? ['degraded_mode_acknowledgement_required'] : [])
      ],
      degradedModeAvailable: degradedModeEnabled,
      degradedModeAcknowledged,
      degradedReleaseNeedsAcknowledgement
    },
    componentCount: components.length,
    providerDerivedComponentCount: providerDerivedComponents.length,
    blockingComponentCount: blockingComponents.length,
    degradedComponentCount: degradedComponents.length,
    exhaustedComponentCount: exhaustedComponents.length,
    components,
    actionableErrors,
    observedAt: normalizeIsoTimestamp(source.observedAt || source.updatedAt) || now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      command,
      degradedModeEnabled,
      degradedModeAcknowledged,
      retryPlanSummary,
      components
    })
  };
}

function normalizeProviderContracts(input, state, command, clientRequest, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.providerContracts || input.integrationProviders || rawState.providerContracts || rawState.integrationProviders;
  const contractPresent = source !== undefined && source !== null;
  const requiredCapabilities = COMMAND_PROVIDER_CAPABILITIES[command] || [];
  const requiredServices = COMMAND_SERVICE_REQUIREMENTS[command] || [];
  const providerContracts = normalizeProviderEntries(source).map((provider, index) => {
    const tenantId = cleanToken(provider.tenantId, null);
    const workspaceId = cleanToken(provider.workspaceId, null);
    const tenantScoped = scopedValueMatches(tenantId, state.tenantId);
    const workspaceScoped = scopedValueMatches(workspaceId, state.workspaceId);
    const protocol = normalizeProviderProtocol(provider);
    const capabilities = normalizeTokenList(provider.capabilities || provider.supportedCapabilities || provider.features);
    const unavailable = provider.available === false || provider.enabled === false || provider.status === 'unavailable';
    const active = tenantScoped && workspaceScoped && !unavailable && protocol.compatible;
    const matchedCapabilities = capabilities.filter((capability) => requiredCapabilities.includes(capability));
    const lastSyncedRevision = Number.isSafeInteger(provider.lastSyncedRevision)
      ? provider.lastSyncedRevision
      : (Number.isSafeInteger(provider.syncedRevision) ? provider.syncedRevision : null);
    const syncLag = lastSyncedRevision === null ? null : Math.max(0, state.revision - lastSyncedRevision);
    const services = normalizeProviderServices(provider, requiredServices, state, clientRequest, now);
    const providerId = cleanToken(provider.providerId || provider.id || provider.name, `provider-${index + 1}`);
    const externalHandoff = normalizeExternalReleaseHandoff(provider, state, clientRequest, now, {
      providerId
    });
    const requiredServiceTypes = requiredServices.map((requirement) => requirement.serviceType);
    const readyServiceTypes = [...new Set(services
      .filter((service) => service.required && service.ready)
      .map((service) => service.serviceType))]
      .sort();
    const missingRequiredServiceTypes = requiredServiceTypes
      .filter((serviceType) => !readyServiceTypes.includes(serviceType));
    const staleServiceCount = services
      .filter((service) => service.required && service.sync.inSync === false)
      .length;
    const incompatibleServiceCount = services
      .filter((service) => service.required && !service.protocol.compatible)
      .length;
    return {
      providerId,
      providerType: cleanToken(provider.providerType || provider.type, 'hosted-kernel-integration'),
      endpoint: cleanToken(provider.endpoint || provider.route || provider.url, null),
      tenantId,
      workspaceId,
      tenantScoped,
      workspaceScoped,
      protocol,
      active,
      unavailable,
      capabilities,
      matchedCapabilities,
      missingCapabilities: requiredCapabilities.filter((capability) => !capabilities.includes(capability)),
      serviceContracts: {
        requiredServiceTypes,
        readyServiceTypes,
        missingRequiredServiceTypes,
        staleServiceCount,
        incompatibleServiceCount,
        services
      },
      sync: {
        cursor: cleanToken(provider.syncCursor || provider.cursor || provider.watermark, null),
        lastSyncedRevision,
        syncLag,
        inSync: lastSyncedRevision === null || lastSyncedRevision >= state.revision,
        syncedAt: normalizeIsoTimestamp(provider.syncedAt || provider.lastSyncedAt || provider.updatedAt)
      },
      externalHandoff,
      lastErrorCode: cleanToken(provider.lastErrorCode || provider.errorCode, null),
      observedAt: normalizeIsoTimestamp(provider.observedAt || provider.updatedAt) || now
    };
  });
  const activeCapabilities = [...new Set(providerContracts
    .filter((provider) => provider.active)
    .flatMap((provider) => provider.capabilities))]
    .sort();
  const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !activeCapabilities.includes(capability));
  const staleProviders = providerContracts.filter((provider) => provider.active && provider.sync.inSync === false);
  const incompatibleProviders = providerContracts.filter((provider) => provider.tenantScoped && provider.workspaceScoped && !provider.protocol.compatible);
  const activeServiceTypes = [...new Set(providerContracts
    .filter((provider) => provider.active)
    .flatMap((provider) => provider.serviceContracts.readyServiceTypes))]
    .sort();
  const missingRequiredServiceTypes = requiredServices
    .map((requirement) => requirement.serviceType)
    .filter((serviceType) => !activeServiceTypes.includes(serviceType));
  const staleProviderServices = providerContracts
    .filter((provider) => provider.active)
    .flatMap((provider) => provider.serviceContracts.services
      .filter((service) => service.required && service.sync.inSync === false)
      .map((service) => ({
        providerId: provider.providerId,
        serviceId: service.serviceId,
        serviceType: service.serviceType,
        syncLag: service.sync.syncLag
      })));
  const incompatibleProviderServices = providerContracts
    .filter((provider) => provider.active)
    .flatMap((provider) => provider.serviceContracts.services
      .filter((service) => service.required && !service.protocol.compatible)
      .map((service) => ({
        providerId: provider.providerId,
        serviceId: service.serviceId,
        serviceType: service.serviceType,
        offeredProtocols: service.protocol.offeredProtocols
      })));
  const releaseHandoffRequired = command === 'release'
    && (requiredCapabilities.includes('external.release-handoff')
      || requiredServices.some((requirement) => requirement.serviceType === 'release-handoff'));
  const handoffProviderCandidates = providerContracts
    .filter((provider) => provider.active && provider.capabilities.includes('external.release-handoff'))
    .map((provider) => ({
      providerId: provider.providerId,
      candidateType: 'provider',
      endpoint: provider.endpoint,
      sync: provider.sync,
      handoff: provider.externalHandoff
    }));
  const handoffServiceCandidates = providerContracts
    .filter((provider) => provider.active)
    .flatMap((provider) => provider.serviceContracts.services)
    .filter((service) => service.serviceType === 'release-handoff' && service.required)
    .map((service) => ({
      providerId: service.externalHandoff.providerId,
      serviceId: service.serviceId,
      serviceType: service.serviceType,
      candidateType: 'service',
      endpoint: service.endpoint,
      sync: service.sync,
      handoff: service.externalHandoff
    }));
  const handoffCandidates = [...handoffProviderCandidates, ...handoffServiceCandidates];
  const readyHandoffCandidates = handoffCandidates.filter((candidate) => candidate.handoff.ready);
  const staleHandoffCandidates = handoffCandidates.filter((candidate) => !candidate.handoff.revisionCurrent);
  const targetMismatchHandoffCandidates = handoffCandidates.filter((candidate) => !candidate.handoff.targetMatched);
  const unacceptedHandoffCandidates = handoffCandidates.filter((candidate) => !candidate.handoff.accepted);
  const handoffAccepted = !releaseHandoffRequired || readyHandoffCandidates.length > 0;
  const externalHandoffBlockedReasons = !releaseHandoffRequired || readyHandoffCandidates.length > 0
    ? []
    : [
      ...(handoffCandidates.length === 0 ? ['external_release_handoff_provider_missing'] : []),
      ...(handoffCandidates.length > 0 ? ['external_release_handoff_not_ready'] : []),
      ...(staleHandoffCandidates.length > 0 ? ['external_release_handoff_revision_stale'] : []),
      ...(targetMismatchHandoffCandidates.length > 0 ? ['external_release_handoff_target_mismatch'] : []),
      ...(unacceptedHandoffCandidates.length > 0 ? ['external_release_handoff_not_accepted'] : [])
    ];
  const externalHandoffContract = {
    schemaVersion: 1,
    contractType: 'external-release-handoff-negotiation',
    required: releaseHandoffRequired,
    command,
    target: clientRequest.handoffTarget,
    releaseId: state.releaseId,
    revision: state.revision,
    status: !releaseHandoffRequired
      ? 'not_required'
      : (readyHandoffCandidates.length > 0 ? 'ready' : (handoffCandidates.length > 0 ? 'blocked' : 'missing')),
    accepted: handoffAccepted,
    candidateCount: handoffCandidates.length,
    readyCandidateCount: readyHandoffCandidates.length,
    staleCandidateCount: staleHandoffCandidates.length,
    targetMismatchCandidateCount: targetMismatchHandoffCandidates.length,
    unacceptedCandidateCount: unacceptedHandoffCandidates.length,
    selectedCandidate: readyHandoffCandidates[0] || null,
    blockedReasons: externalHandoffBlockedReasons,
    candidates: handoffCandidates,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      command,
      target: clientRequest.handoffTarget,
      releaseHandoffRequired,
      handoffCandidates
    })
  };
  const commandBlocked = contractPresent
    && (command === 'prepare' || command === 'release')
    && (missingRequiredCapabilities.length > 0
      || staleProviders.length > 0
      || incompatibleProviders.length > 0
      || missingRequiredServiceTypes.length > 0
      || staleProviderServices.length > 0
      || incompatibleProviderServices.length > 0
      || !handoffAccepted);
  return {
    schemaVersion: 1,
    contractPresent,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    command,
    requiredCapabilities,
    requiredServices,
    activeCapabilities,
    missingRequiredCapabilities,
    activeServiceTypes,
    missingRequiredServiceTypes,
    providerCount: providerContracts.length,
    activeProviderCount: providerContracts.filter((provider) => provider.active).length,
    incompatibleProviderCount: incompatibleProviders.length,
    staleProviderCount: staleProviders.length,
    staleProviderServices,
    incompatibleProviderServices,
    handoffAccepted,
    externalHandoffContract,
    commandBlocked,
    blockedReasons: [
      ...(missingRequiredCapabilities.length > 0 ? ['provider_capability_missing'] : []),
      ...(staleProviders.length > 0 ? ['provider_sync_stale'] : []),
      ...(incompatibleProviders.length > 0 ? ['provider_protocol_incompatible'] : []),
      ...(missingRequiredServiceTypes.length > 0 ? ['provider_service_contract_missing'] : []),
      ...(staleProviderServices.length > 0 ? ['provider_service_sync_stale'] : []),
      ...(incompatibleProviderServices.length > 0 ? ['provider_service_protocol_incompatible'] : []),
      ...(!handoffAccepted ? externalHandoffContract.blockedReasons : [])
    ],
    providers: providerContracts,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      command,
      requiredCapabilities,
      requiredServices,
      activeCapabilities,
      activeServiceTypes,
      externalHandoffContract,
      providers: providerContracts.map((provider) => ({
        providerId: provider.providerId,
        active: provider.active,
        protocol: provider.protocol,
        capabilities: provider.capabilities,
        serviceContracts: provider.serviceContracts,
        sync: provider.sync,
        externalHandoff: provider.externalHandoff
      }))
    })
  };
}

function buildPersistenceContract(state, stateHealth, operationalHealth, boundaryEvidence) {
  return {
    schemaVersion: 2,
    storageKey: `${state.tenantId}/${state.workspaceId}/${state.releaseId}`,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    status: state.status,
    revision: state.revision,
    restartStatus: state.restartStatus,
    restartSafe: stateHealth.restartSafe,
    updatedAt: state.updatedAt,
    lastCommandId: state.lastCommandId,
    pendingCommand: state.pendingCommand,
    recoveryCheckpoint: state.recoveryCheckpoint || null,
    commandRecoveryPlan: state.commandRecoveryPlan || null,
    restartResumeContract: state.restartResumeContract || null,
    commandRecoveryCheckpoint: state.commandRecoveryPlan ? state.commandRecoveryPlan.checkpoint : null,
    lifecycleSettings: state.lifecycleSettings,
    operationalHealth,
    boundaryEvidence,
    recoveryReasons: stateHealth.recoveryReasons,
    replayProtection: {
      strategy: 'command-ledger',
      commandIds: state.commandLedger.map((entry) => entry.commandId),
      windowSize: state.commandLedger.length,
      maxWindowSize: MAX_COMMAND_LOG
    },
    commandLog: state.commandLog,
    commandLedger: state.commandLedger
  };
}

function buildGateReport(claims) {
  const outOfScope = claims.filter((claim) => !claim.tenantScoped || !claim.workspaceScoped).map((claim) => ({
    claimId: claim.claimId,
    gate: claim.gate,
    reason: 'claim_outside_workspace_boundary',
    tenantId: claim.tenantId,
    workspaceId: claim.workspaceId,
    tenantScoped: claim.tenantScoped,
    workspaceScoped: claim.workspaceScoped
  }));
  const missing = claims.filter((claim) => claim.verified !== true && claim.tenantScoped && claim.workspaceScoped).map((claim) => ({
    claimId: claim.claimId,
    gate: claim.gate,
    reason: 'claim_not_verified'
  }));
  const verifiedInScopeCount = claims.filter((claim) => claim.verified === true && claim.tenantScoped && claim.workspaceScoped).length;

  return {
    requiredClaimCount: claims.length,
    scopedClaimCount: claims.length - outOfScope.length,
    verifiedClaimCount: verifiedInScopeCount,
    outOfScopeClaimCount: outOfScope.length,
    missing: [...outOfScope, ...missing],
    passed: claims.length > 0 && outOfScope.length === 0 && missing.length === 0
  };
}

function normalizeAcceptance(input, boundary) {
  const acceptance = input.acceptance && typeof input.acceptance === 'object' ? input.acceptance : {};
  const acceptedBy = cleanToken(acceptance.acceptedBy || input.acceptedBy, null);
  const acceptedAt = cleanToken(acceptance.acceptedAt || input.acceptedAt, null);
  const decision = cleanToken(acceptance.decision || input.acceptanceDecision, 'pending');
  const tenantId = cleanToken(acceptance.tenantId || input.acceptanceTenantId, null);
  const workspaceId = cleanToken(acceptance.workspaceId || input.acceptanceWorkspaceId, null);
  const previewDigest = cleanToken(
    acceptance.previewDigest || acceptance.acceptedPreviewDigest || input.acceptancePreviewDigest || input.acceptedPreviewDigest,
    null
  );
  const clientRuntimeAdoptionDigest = cleanToken(
    acceptance.clientRuntimeAdoptionDigest || acceptance.handoffDigest || input.acceptanceClientRuntimeAdoptionDigest,
    null
  );
  const tenantScoped = scopedValueMatches(tenantId, boundary.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, boundary.workspaceId);
  const accepted = (acceptance.accepted === true || decision === 'accepted') && tenantScoped && workspaceScoped;
  return {
    accepted,
    decision: accepted ? 'accepted' : (decision === 'accepted' ? 'boundary_rejected' : decision),
    acceptedBy,
    acceptedAt,
    previewDigest,
    clientRuntimeAdoptionDigest,
    tenantId,
    workspaceId,
    tenantScoped,
    workspaceScoped,
    requiresActor: acceptedBy === null,
    requiresTimestamp: acceptedAt === null,
    deniedReason: tenantScoped && workspaceScoped ? null : 'acceptance_outside_workspace_boundary'
  };
}

function buildValidationSummary({ gateReport, authorization, releaseAuthorization, acceptance, command, state, workspaceAccess, releaseBoundaryPolicy, boundaryEvidence, operationalHealth, providerContracts, lifecycleControlPlan, clientRuntimeAdoption }) {
  const lifecycleSettings = state.lifecycleSettings;
  const commandRecoveryPlan = state.commandRecoveryPlan || null;
  const checks = [
    {
      checkId: 'claims-present',
      label: 'Claims attached',
      status: gateReport.requiredClaimCount > 0 ? 'passed' : 'failed',
      detail: `${gateReport.requiredClaimCount} claim(s) attached`
    },
    {
      checkId: 'claims-verified',
      label: 'Claims verified',
      status: gateReport.passed ? 'passed' : 'failed',
      detail: `${gateReport.verifiedClaimCount}/${gateReport.requiredClaimCount} claim(s) verified`
    },
    {
      checkId: 'claims-in-boundary',
      label: 'Claims in workspace boundary',
      status: gateReport.outOfScopeClaimCount === 0 ? 'passed' : 'failed',
      detail: `${gateReport.outOfScopeClaimCount} claim(s) outside packet boundary`
    },
    {
      checkId: 'command-authorized',
      label: 'Command authorized',
      status: authorization.allowed ? 'passed' : 'failed',
      detail: authorization.deniedReason || 'actor has required command role'
    },
    {
      checkId: 'workspace-access-authorized',
      label: 'Workspace access authorized',
      status: workspaceAccess.allowed ? 'passed' : 'failed',
      detail: workspaceAccess.deniedReason || (workspaceAccess.policyPresent ? 'actor is permitted by workspace policy' : 'no workspace policy attached')
    },
    {
      checkId: 'release-boundary-policy-authorized',
      label: 'Release boundary policy authorized',
      status: releaseBoundaryPolicy.allowed ? 'passed' : 'failed',
      detail: releaseBoundaryPolicy.deniedReason || (releaseBoundaryPolicy.policyPresent ? 'release boundary policy matched' : 'no release boundary policy attached')
    },
    {
      checkId: 'tenant-workspace-boundary-evidence',
      label: 'Tenant workspace boundary evidence complete',
      status: boundaryEvidence.handoffSafe ? 'passed' : 'failed',
      detail: boundaryEvidence.handoffSafe ? boundaryEvidence.auditScope.partitionKey : boundaryEvidence.isolationFaults.join(',')
    },
    {
      checkId: 'operational-health',
      label: 'Operational health available',
      status: operationalHealth.commandBlocked ? 'failed' : (operationalHealth.healthy ? 'passed' : 'pending'),
      detail: operationalHealth.commandBlocked
        ? operationalHealth.failureState.blockedReasons.join(',')
        : (operationalHealth.healthy ? 'all release packet dependencies are healthy' : `${operationalHealth.degradedComponentCount} component(s) degraded`)
    },
    {
      checkId: 'provider-contracts-ready',
      label: 'Provider contracts ready',
      status: providerContracts.commandBlocked ? 'failed' : 'passed',
      detail: providerContracts.commandBlocked
        ? providerContracts.blockedReasons.join(',')
        : (providerContracts.contractPresent
          ? `${providerContracts.activeCapabilities.length}/${providerContracts.requiredCapabilities.length} required provider capability group(s) available`
          : 'no provider contract attached')
    },
    {
      checkId: 'client-runtime-adopted',
      label: 'Client runtime handoff adopted',
      status: clientRuntimeAdoption.commandBlocked ? 'failed' : 'passed',
      detail: clientRuntimeAdoption.commandBlocked
        ? clientRuntimeAdoption.blockedReasons.join(',')
        : clientRuntimeAdoption.userVisibleHandoff.reason
    },
    {
      checkId: 'restart-recovery-command-safe',
      label: 'Restart recovery command safe',
      status: commandRecoveryPlan && commandRecoveryPlan.pendingConflictsWithRequest
        ? 'failed'
        : (commandRecoveryPlan && commandRecoveryPlan.restartBlocked ? 'pending' : 'passed'),
      detail: commandRecoveryPlan
        ? (commandRecoveryPlan.blockedReasons[0] || commandRecoveryPlan.status)
        : 'no restart recovery required'
    },
    {
      checkId: 'lifecycle-settings-scoped',
      label: 'Lifecycle settings in workspace boundary',
      status: lifecycleSettings.tenantScoped && lifecycleSettings.workspaceScoped ? 'passed' : 'failed',
      detail: lifecycleSettings.tenantScoped && lifecycleSettings.workspaceScoped ? 'settings match packet boundary' : 'settings outside packet boundary'
    },
    {
      checkId: 'lifecycle-enabled',
      label: 'Release lifecycle enabled',
      status: lifecycleSettings.enabled ? 'passed' : 'failed',
      detail: lifecycleSettings.disabledReason || 'release lifecycle accepts commands'
    },
    {
      checkId: 'schedule-valid',
      label: 'Release schedule valid',
      status: lifecycleSettings.scheduleRejected ? 'failed' : 'passed',
      detail: lifecycleSettings.scheduleRejected
        ? lifecycleSettings.scheduleRejectedReasons.join(',')
        : (lifecycleSettings.scheduledReleaseAt || 'no schedule requested')
    },
    {
      checkId: 'schedule-controls-satisfied',
      label: 'Release schedule controls satisfied',
      status: lifecycleSettings.scheduleControls.scheduleAllowed ? 'passed' : 'failed',
      detail: lifecycleSettings.scheduleControls.scheduleAllowed
        ? `schedule allowed from ${lifecycleSettings.scheduleControls.earliestAllowedAt} through ${lifecycleSettings.scheduleControls.latestAllowedAt}`
        : lifecycleSettings.scheduleControls.violations.join(',')
    },
    {
      checkId: 'schedule-window-open',
      label: 'Release window open',
      status: lifecycleSettings.releaseWindowOpen ? 'passed' : 'pending',
      detail: lifecycleSettings.releaseWindowOpen ? 'release may run now' : `next eligible release at ${lifecycleSettings.nextEligibleReleaseAt}`
    },
    {
      checkId: 'lifecycle-command-control',
      label: 'Lifecycle command control available',
      status: !lifecycleControlPlan.commandControl || lifecycleControlPlan.commandControl.allowed ? 'passed' : 'failed',
      detail: !lifecycleControlPlan.commandControl || lifecycleControlPlan.commandControl.allowed
        ? lifecycleControlPlan.commandEffect
        : lifecycleControlPlan.commandControl.blockedReasons.join(',')
    },
    {
      checkId: 'release-authorized',
      label: 'Release role available',
      status: releaseAuthorization.allowed ? 'passed' : 'failed',
      detail: releaseAuthorization.deniedReason || 'actor may approve release'
    },
    {
      checkId: 'acceptance-recorded',
      label: 'Acceptance recorded',
      status: acceptance.accepted ? 'passed' : 'pending',
      detail: acceptance.accepted ? `accepted by ${acceptance.acceptedBy || 'unknown'}` : (acceptance.deniedReason || 'awaiting explicit preview acceptance')
    },
    {
      checkId: 'not-terminal',
      label: 'Release still actionable',
      status: TERMINAL_STATUSES.has(state.status) ? 'failed' : 'passed',
      detail: `current status is ${state.status}`
    }
  ];
  const failed = checks.filter((check) => check.status === 'failed');
  const pending = checks.filter((check) => check.status === 'pending');
  return {
    schemaVersion: 1,
    command,
    passed: failed.length === 0,
    readyForRelease: failed.length === 0 && pending.length === 0,
    failedCount: failed.length,
    pendingCount: pending.length,
    checks
  };
}

function validationIssueCategory(checkId) {
  if (checkId.startsWith('claims-')) {
    return 'claims';
  }
  if (checkId.includes('authorized') || checkId.includes('access') || checkId.includes('boundary')) {
    return 'access';
  }
  if (checkId.includes('operational') || checkId.includes('provider') || checkId.includes('runtime')) {
    return 'integration';
  }
  if (checkId.includes('lifecycle') || checkId.includes('schedule')) {
    return 'lifecycle';
  }
  if (checkId.includes('acceptance')) {
    return 'acceptance';
  }
  return 'state';
}

function validationIssueAction(check, context) {
  const actions = {
    'claims-present': 'attach_claims',
    'claims-verified': 'verify_claims',
    'claims-in-boundary': 'scope_claims_to_workspace',
    'command-authorized': 'request_command_role',
    'workspace-access-authorized': 'request_workspace_access',
    'release-boundary-policy-authorized': 'resolve_release_boundary_policy',
    'tenant-workspace-boundary-evidence': 'refresh_boundary_evidence',
    'operational-health': 'restore_operational_health',
    'provider-contracts-ready': 'resolve_provider_contracts',
    'client-runtime-adopted': 'refresh_client_handoff',
    'restart-recovery-command-safe': 'run_recovery_command',
    'lifecycle-settings-scoped': 'scope_lifecycle_settings',
    'lifecycle-enabled': 'enable_lifecycle',
    'schedule-valid': 'fix_release_schedule',
    'schedule-controls-satisfied': 'choose_allowed_release_time',
    'schedule-window-open': 'wait_for_release_window',
    'lifecycle-command-control': 'resolve_lifecycle_control',
    'release-authorized': 'request_release_approval',
    'acceptance-recorded': 'accept_preview',
    'not-terminal': 'start_new_release_packet'
  };
  const action = actions[check.checkId] || 'review_validation_check';
  return {
    action,
    command: action === 'run_recovery_command' ? 'recover' : null,
    releaseAt: action === 'choose_allowed_release_time'
      ? context.lifecycleSettings.nextSchedulableReleaseAt
      : null,
    retryAfter: action === 'restore_operational_health' ? context.operationalHealth.retryAfter : null,
    providerContractDigest: action === 'resolve_provider_contracts' ? context.providerContracts.digest : null,
    handoffDigest: action === 'refresh_client_handoff'
      ? context.clientRuntimeAdoption.handoffProof.expectedHandoffDigest
      : null
  };
}

function buildValidationIssueSummary({ validationSummary, state, operationalHealth, providerContracts, lifecycleControlPlan, clientRuntimeAdoption }) {
  const actionableChecks = validationSummary.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => {
      const category = validationIssueCategory(check.checkId);
      const severity = check.status === 'failed' ? 'blocking' : 'waiting';
      return {
        issueId: `validation:${check.checkId}`,
        checkId: check.checkId,
        category,
        severity,
        status: check.status,
        label: check.label,
        detail: check.detail,
        userMessage: `${check.label}: ${check.detail}`,
        nextStep: validationIssueAction(check, {
          lifecycleSettings: state.lifecycleSettings,
          operationalHealth,
          providerContracts,
          clientRuntimeAdoption
        })
      };
    });
  const categories = ['claims', 'access', 'integration', 'lifecycle', 'acceptance', 'state']
    .map((category) => {
      const issues = actionableChecks.filter((issue) => issue.category === category);
      return {
        category,
        issueCount: issues.length,
        blockingCount: issues.filter((issue) => issue.severity === 'blocking').length,
        waitingCount: issues.filter((issue) => issue.severity === 'waiting').length,
        firstIssueId: issues[0]?.issueId || null
      };
    })
    .filter((bucket) => bucket.issueCount > 0);
  const topIssues = actionableChecks.slice(0, 6);
  const primaryIssue = topIssues[0] || null;

  return {
    schemaVersion: 1,
    contractType: 'release-packet-validation-issue-summary',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    readyForRelease: validationSummary.readyForRelease,
    passed: validationSummary.passed,
    issueCount: actionableChecks.length,
    blockingIssueCount: actionableChecks.filter((issue) => issue.severity === 'blocking').length,
    waitingIssueCount: actionableChecks.filter((issue) => issue.severity === 'waiting').length,
    categories,
    primaryIssue,
    topIssues,
    routeHints: {
      previewRoute: 'client.release-workbench.preview',
      validationRoute: 'verifier-claim-gate.validation',
      nextActionRoute: lifecycleControlPlan.nextActionState.action,
      handoffTarget: clientRuntimeAdoption.handoffTarget
    },
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      readyForRelease: validationSummary.readyForRelease,
      actionableChecks: actionableChecks.map((issue) => ({
        checkId: issue.checkId,
        severity: issue.severity,
        status: issue.status,
        category: issue.category,
        action: issue.nextStep.action
      }))
    })
  };
}

function buildPreviewContract({ state, claims, gateReport, acceptance, validationSummary, validationIssueSummary, providerContracts, lifecycleControlPlan }) {
  const claimRows = claims.map((claim) => ({
    claimId: claim.claimId,
    gate: claim.gate,
    verifier: claim.verifier,
    verified: claim.verified,
    evidenceDigest: claim.evidenceDigest,
    tenantId: claim.tenantId,
    workspaceId: claim.workspaceId,
    tenantScoped: claim.tenantScoped,
    workspaceScoped: claim.workspaceScoped,
    displayStatus: claim.tenantScoped && claim.workspaceScoped ? (claim.verified ? 'verified' : 'needs_verification') : 'out_of_scope'
  }));
  return {
    schemaVersion: 1,
    releaseId: state.releaseId,
    title: `Release packet ${state.releaseId}`,
    statusBadge: validationSummary.readyForRelease ? 'ready_to_release' : (gateReport.passed ? 'awaiting_acceptance' : state.status),
    summary: {
      claimCount: gateReport.requiredClaimCount,
      scopedClaimCount: gateReport.scopedClaimCount,
      verifiedClaimCount: gateReport.verifiedClaimCount,
      missingClaimCount: gateReport.missing.length,
      outOfScopeClaimCount: gateReport.outOfScopeClaimCount,
      accepted: acceptance.accepted,
      validationIssueCount: validationIssueSummary.issueCount,
      blockingIssueCount: validationIssueSummary.blockingIssueCount,
      waitingIssueCount: validationIssueSummary.waitingIssueCount
    },
    validationIssueSummary,
    providerContracts: {
      commandBlocked: providerContracts.commandBlocked,
      activeProviderCount: providerContracts.activeProviderCount,
      incompatibleProviderCount: providerContracts.incompatibleProviderCount,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServiceCount: providerContracts.staleProviderServices.length,
      incompatibleProviderServiceCount: providerContracts.incompatibleProviderServices.length,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffStatus: providerContracts.externalHandoffContract.status,
      externalHandoffTarget: providerContracts.externalHandoffContract.target,
      externalHandoffBlockedReasons: providerContracts.externalHandoffContract.blockedReasons
    },
    lifecycle: {
      enabled: state.lifecycleSettings.enabled,
      scheduledReleaseAt: state.lifecycleSettings.scheduledReleaseAt,
      releaseHoldUntil: state.lifecycleSettings.releaseHoldUntil,
      releaseWindowOpen: state.lifecycleSettings.releaseWindowOpen,
      nextEligibleReleaseAt: state.lifecycleSettings.nextEligibleReleaseAt,
      nextSchedulableReleaseAt: state.lifecycleSettings.nextSchedulableReleaseAt,
      scheduleRejectedReasons: state.lifecycleSettings.scheduleRejectedReasons,
      scheduleControls: {
        minLeadSeconds: state.lifecycleSettings.scheduleControls.minLeadSeconds,
        maxFutureSeconds: state.lifecycleSettings.scheduleControls.maxFutureSeconds,
        earliestAllowedAt: state.lifecycleSettings.scheduleControls.earliestAllowedAt,
        latestAllowedAt: state.lifecycleSettings.scheduleControls.latestAllowedAt,
        blackoutWindowCount: state.lifecycleSettings.scheduleControls.blackoutWindowCount,
        blockingBlackoutWindowIds: state.lifecycleSettings.scheduleControls.blockingBlackoutWindowIds
      },
      commandEffect: lifecycleControlPlan.commandEffect,
      lifecycleBlocked: lifecycleControlPlan.lifecycleBlocked,
      nextActionState: lifecycleControlPlan.nextActionState,
      executionPlan: {
        executionState: lifecycleControlPlan.executionPlan.executionState,
        nextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
        waitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
        runnableCommandCount: lifecycleControlPlan.executionPlan.runnableCommandCount,
        waitingCommandCount: lifecycleControlPlan.executionPlan.waitingCommandCount,
        blockedCommandCount: lifecycleControlPlan.executionPlan.blockedCommandCount,
        settingsMutationRequired: lifecycleControlPlan.executionPlan.settingsMutationRequired,
        digest: lifecycleControlPlan.executionPlan.digest
      },
      commandControls: lifecycleControlPlan.commandControls.map((control) => ({
        command: control.command,
        allowed: control.allowed,
        actionState: control.actionState,
        blockedReasons: control.blockedReasons,
        requiredInputs: control.requiredInputs,
        commandPayload: control.commandPayload,
        settingsMutation: control.settingsMutation,
        proofDigest: control.proof.digest
      }))
    },
    claimRows,
    blockingReasons: [
      ...gateReport.missing.map((missing) => ({
        reason: missing.reason,
        claimId: missing.claimId,
        gate: missing.gate
      })),
      ...validationSummary.checks
        .filter((check) => check.status === 'failed' && check.checkId !== 'claims-verified')
        .map((check) => ({ reason: check.checkId, detail: check.detail }))
    ]
  };
}

function buildReadinessContract({ state, gateReport, acceptance, validationSummary, validationIssueSummary, releaseAuthorization, workspaceAccess, releaseBoundaryPolicy, boundaryEvidence, operationalHealth, providerContracts, lifecycleControlPlan, clientRuntimeAdoption }) {
  const missingInputs = [];
  if (!gateReport.passed) {
    if (gateReport.outOfScopeClaimCount > 0) {
      missingInputs.push('claims_within_workspace_boundary');
    }
    if (gateReport.verifiedClaimCount < gateReport.scopedClaimCount) {
      missingInputs.push('verified_claims');
    }
  }
  if (!releaseAuthorization.allowed) {
    missingInputs.push('release_permission');
  }
  if (!workspaceAccess.allowed) {
    missingInputs.push(workspaceAccess.deniedReason || 'workspace_access');
  }
  if (!releaseBoundaryPolicy.allowed) {
    missingInputs.push(releaseBoundaryPolicy.deniedReason || 'release_boundary_policy');
  }
  if (!boundaryEvidence.handoffSafe) {
    missingInputs.push('tenant_workspace_boundary_evidence');
  }
  if (operationalHealth.commandBlocked) {
    missingInputs.push(...(operationalHealth.failureState.blockedReasons.length > 0
      ? operationalHealth.failureState.blockedReasons
      : ['operational_health_restored']));
  } else if (!operationalHealth.healthy) {
    missingInputs.push(operationalHealth.degradedModeAcknowledged
      ? 'operational_health_degraded_monitoring'
      : 'operational_health_degraded_acknowledgement');
  }
  if (providerContracts.commandBlocked) {
    missingInputs.push(...providerContracts.blockedReasons);
  }
  if (clientRuntimeAdoption.commandBlocked) {
    missingInputs.push(...clientRuntimeAdoption.blockedReasons);
  }
  if (!state.lifecycleSettings.tenantScoped || !state.lifecycleSettings.workspaceScoped) {
    missingInputs.push('lifecycle_settings_within_workspace_boundary');
  }
  if (!state.lifecycleSettings.enabled) {
    missingInputs.push('lifecycle_enabled');
  }
  if (state.lifecycleSettings.scheduleInvalid) {
    missingInputs.push('valid_release_schedule');
  }
  if (state.lifecycleSettings.scheduleControls.violations.length > 0) {
    missingInputs.push(...state.lifecycleSettings.scheduleControls.violations);
  }
  if (!state.lifecycleSettings.releaseWindowOpen) {
    missingInputs.push('release_schedule_window');
  }
  if (lifecycleControlPlan.commandControl && !lifecycleControlPlan.commandControl.allowed) {
    missingInputs.push('lifecycle_command_control');
  }
  if (!acceptance.accepted) {
    missingInputs.push(acceptance.deniedReason ? 'acceptance_within_workspace_boundary' : 'preview_acceptance');
  }
  if (TERMINAL_STATUSES.has(state.status)) {
    missingInputs.push('non_terminal_release_state');
  }
  return {
    schemaVersion: 1,
    state: validationSummary.readyForRelease ? 'ready' : 'not_ready',
    canSubmitRelease: validationSummary.readyForRelease && !TERMINAL_STATUSES.has(state.status),
    missingInputs,
    nextEligibleReleaseAt: state.lifecycleSettings.nextEligibleReleaseAt,
    nextSchedulableReleaseAt: state.lifecycleSettings.nextSchedulableReleaseAt,
    retryAfter: operationalHealth.retryAfter,
    providerContractDigest: providerContracts.digest,
    clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
    validationIssueSummaryDigest: validationIssueSummary.digest,
    primaryBlockingIssue: validationIssueSummary.primaryIssue,
    lifecycleNextAction: lifecycleControlPlan.nextActionState,
    readinessScore: Math.max(0, validationSummary.checks.length - validationSummary.failedCount - validationSummary.pendingCount),
    readinessMaxScore: validationSummary.checks.length
  };
}

function buildAcceptanceControlContract({ state, clientRequest, preview, acceptance, validationSummary, readiness, clientRuntimeAdoption, now }) {
  const previewDigest = proofDigest({
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    statusBadge: preview.statusBadge,
    summary: preview.summary,
    providerContracts: preview.providerContracts,
    lifecycle: preview.lifecycle,
    blockingReasons: preview.blockingReasons
  });
  const acceptedAtValid = acceptance.acceptedAt === null || normalizeIsoTimestamp(acceptance.acceptedAt) !== null;
  const acceptanceSubmitted = acceptance.decision !== 'pending' || acceptance.acceptedBy !== null || acceptance.acceptedAt !== null;
  const echoedPreviewDigest = acceptance.previewDigest || clientRequest.previewDigest;
  const previewDigestRequired = acceptanceSubmitted || acceptance.accepted;
  const previewDigestMatched = echoedPreviewDigest === previewDigest;
  const previewDigestBindingState = !previewDigestRequired
    ? 'not_submitted'
    : (previewDigestMatched ? 'matched' : (echoedPreviewDigest ? 'stale_or_mismatched' : 'missing'));
  const clientRuntimeDigestMatched = acceptance.clientRuntimeAdoptionDigest === null
    || acceptance.clientRuntimeAdoptionDigest === clientRuntimeAdoption.digest;
  const acceptanceBoundToPreview = acceptance.accepted
    && acceptedAtValid
    && acceptance.acceptedBy !== null
    && previewDigestMatched
    && clientRuntimeDigestMatched
    && validationSummary.failedCount === 0
    && preview.blockingReasons.length === 0;
  const inputRequirements = [
    {
      field: 'acceptance.decision',
      required: true,
      expected: 'accepted',
      satisfied: acceptance.accepted
    },
    {
      field: 'acceptance.acceptedBy',
      required: true,
      expected: clientRequest.actorId,
      satisfied: acceptance.acceptedBy !== null
    },
    {
      field: 'acceptance.acceptedAt',
      required: true,
      expected: 'ISO-8601 timestamp',
      satisfied: acceptance.acceptedAt !== null && acceptedAtValid
    },
    {
      field: 'acceptance.previewDigest',
      required: previewDigestRequired,
      expected: previewDigest,
      satisfied: !previewDigestRequired || previewDigestMatched
    },
    {
      field: 'acceptance.clientRuntimeAdoptionDigest',
      required: false,
      expected: clientRuntimeAdoption.digest,
      satisfied: clientRuntimeDigestMatched
    },
    {
      field: 'acceptance.tenantId',
      required: false,
      expected: state.tenantId,
      satisfied: acceptance.tenantScoped
    },
    {
      field: 'acceptance.workspaceId',
      required: false,
      expected: state.workspaceId,
      satisfied: acceptance.workspaceScoped
    }
  ];
  const missingFields = inputRequirements
    .filter((requirement) => requirement.required && !requirement.satisfied)
    .map((requirement) => requirement.field);
  const controlState = acceptanceBoundToPreview && readiness.canSubmitRelease
    ? 'accepted_ready'
    : (acceptanceBoundToPreview
      ? 'accepted_blocked_by_readiness'
      : (previewDigestBindingState === 'stale_or_mismatched'
        ? 'accepted_preview_stale'
        : (acceptanceSubmitted ? 'acceptance_needs_review' : 'awaiting_acceptance')));
  const acceptPreviewPayload = {
    command: 'describe',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    clientRequest: {
      requestId: clientRequest.requestId,
      route: clientRequest.route,
      handoffTarget: clientRequest.handoffTarget,
      lastSeenRevision: state.revision,
      acknowledgedRevision: state.revision,
      previewDigest,
      handoffDigest: clientRuntimeAdoption.handoffProof.expectedHandoffDigest,
      runtimeContractVersion: clientRuntimeAdoption.runtimeContractVersion,
      resumeToken: clientRequest.resumeToken
    },
    acceptance: {
      decision: 'accepted',
      acceptedBy: clientRequest.actorId,
      acceptedAt: now,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      previewDigest,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest
    }
  };
  const refreshPreviewPayload = {
    command: 'describe',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    clientRequest: {
      requestId: clientRequest.requestId,
      route: clientRequest.route,
      view: clientRequest.view,
      intent: 'refresh_release_preview_acceptance',
      handoffTarget: clientRequest.handoffTarget,
      lastSeenRevision: state.revision,
      acknowledgedRevision: state.revision,
      previewDigest,
      handoffDigest: clientRuntimeAdoption.handoffProof.expectedHandoffDigest,
      runtimeContractVersion: clientRuntimeAdoption.runtimeContractVersion,
      resumeToken: clientRequest.resumeToken
    }
  };

  return {
    schemaVersion: 1,
    contractType: 'release-preview-acceptance-control',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    requestId: clientRequest.requestId,
    route: clientRequest.route,
    handoffTarget: clientRequest.handoffTarget,
    controlState,
    acceptanceSubmitted,
    acceptanceBoundToPreview,
    acceptedAtValid,
    previewDigest,
    echoedPreviewDigest,
    previewDigestBinding: {
      state: previewDigestBindingState,
      expectedDigest: previewDigest,
      echoedDigest: echoedPreviewDigest,
      matched: previewDigestMatched,
      required: previewDigestRequired,
      source: acceptance.previewDigest ? 'acceptance' : (clientRequest.previewDigest ? 'clientRequest' : 'missing')
    },
    clientRuntimeAdoptionDigestBinding: {
      expectedDigest: clientRuntimeAdoption.digest,
      echoedDigest: acceptance.clientRuntimeAdoptionDigest,
      matched: clientRuntimeDigestMatched,
      required: false
    },
    previewRevision: state.revision,
    missingFields,
    inputRequirements,
    acceptPreviewPayload,
    refreshPreviewPayload,
    submitPayload: {
      command: 'release',
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      clientRequest: {
        requestId: clientRequest.requestId,
        route: clientRequest.route,
        handoffTarget: clientRequest.handoffTarget,
        lastSeenRevision: state.revision,
        acknowledgedRevision: state.revision,
        handoffDigest: clientRuntimeAdoption.handoffProof.expectedHandoffDigest,
        runtimeContractVersion: clientRuntimeAdoption.runtimeContractVersion,
        resumeToken: clientRequest.resumeToken
      },
      acceptance: {
        decision: 'accepted',
        acceptedBy: clientRequest.actorId,
        acceptedAt: now,
        tenantId: state.tenantId,
        workspaceId: state.workspaceId,
        previewDigest,
        clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest
      }
    },
    disabledReasons: [
      ...missingFields,
      ...(acceptedAtValid ? [] : ['acceptance.acceptedAt_invalid']),
      ...(previewDigestMatched || !previewDigestRequired ? [] : ['acceptance.previewDigest_mismatch']),
      ...(clientRuntimeDigestMatched ? [] : ['acceptance.clientRuntimeAdoptionDigest_mismatch']),
      ...(acceptance.tenantScoped && acceptance.workspaceScoped ? [] : ['acceptance_outside_workspace_boundary']),
      ...(validationSummary.failedCount === 0 ? [] : ['validation_failed']),
      ...(preview.blockingReasons.length === 0 ? [] : ['preview_has_blocking_reasons'])
    ],
    nextAction: {
      action: acceptanceBoundToPreview
        ? (readiness.canSubmitRelease ? 'submit_release' : 'resolve_readiness')
        : (previewDigestBindingState === 'stale_or_mismatched' ? 'refresh_preview' : 'accept_preview'),
      route: acceptanceBoundToPreview
        ? 'verifier-claim-gate.release'
        : (previewDigestBindingState === 'stale_or_mismatched'
          ? 'client.release-workbench.preview'
          : 'client.release-workbench.acceptance'),
      payload: acceptanceBoundToPreview
        ? null
        : (previewDigestBindingState === 'stale_or_mismatched' ? refreshPreviewPayload : acceptPreviewPayload)
    },
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      requestId: clientRequest.requestId,
      controlState,
      acceptanceSubmitted,
      acceptanceBoundToPreview,
      previewDigest,
      echoedPreviewDigest,
      previewDigestBindingState,
      clientRuntimeDigestMatched,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
      missingFields
    })
  };
}

function buildNextSteps({ command, commandResult, gateReport, acceptance, readiness, releaseAuthorization, workspaceAccess, releaseBoundaryPolicy, operationalHealth, providerContracts, lifecycleControlPlan, clientRuntimeAdoption }) {
  const lifecycleSettings = commandResult.state.lifecycleSettings;
  if (clientRuntimeAdoption.commandBlocked) {
    return [{
      action: 'refresh_client_handoff',
      label: clientRuntimeAdoption.userVisibleHandoff.label,
      reason: clientRuntimeAdoption.blockedReasons[0] || 'client runtime handoff must be refreshed',
      serverRevision: clientRuntimeAdoption.revision.serverRevision,
      clientRevision: clientRuntimeAdoption.revision.clientLastSeenRevision,
      expectedHandoffDigest: clientRuntimeAdoption.handoffProof.expectedHandoffDigest,
      recoveryPayload: clientRuntimeAdoption.recoveryPayload
    }];
  }
  if (operationalHealth.commandBlocked) {
    return operationalHealth.actionableErrors.slice(0, 5).map((error) => ({
      action: 'restore_operational_dependency',
      label: `Restore ${error.componentId}`,
      reason: error.code,
      componentId: error.componentId,
      route: error.route,
      retryAfter: error.retryAfter,
      remediation: error.remediation || null,
      providerId: error.providerId || null,
      serviceId: error.serviceId || null,
      serviceType: error.serviceType || null
    }));
  }
  if (!operationalHealth.healthy && command === 'release') {
    return [{
      action: 'review_degraded_mode',
      label: 'Review degraded-mode release risk',
      reason: 'one or more release packet dependencies are degraded',
      retryAfter: operationalHealth.retryAfter
    }];
  }
  if (providerContracts.commandBlocked) {
    return [{
      action: 'resolve_provider_contract',
      label: 'Resolve provider contract',
      reason: providerContracts.blockedReasons[0] || 'provider contract is not ready',
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServiceCount: providerContracts.staleProviderServices.length,
      incompatibleProviderServiceCount: providerContracts.incompatibleProviderServices.length,
      externalHandoff: providerContracts.externalHandoffContract
    }];
  }
  if (commandResult.denied) {
    if (!workspaceAccess.allowed) {
      return [{
        action: 'request_workspace_access',
        label: 'Request access to this workspace',
        reason: workspaceAccess.deniedReason || 'workspace policy denied this actor'
      }];
    }
    if (!releaseBoundaryPolicy.allowed) {
      return [{
        action: 'resolve_release_boundary_policy',
        label: 'Resolve release boundary policy',
        reason: releaseBoundaryPolicy.deniedReason || 'release boundary policy denied this command'
      }];
    }
    return [{
      action: 'request_role_or_boundary_fix',
      label: 'Request access before changing this release packet',
      reason: 'current command was denied'
    }];
  }
  if (gateReport.missing.length > 0) {
    return gateReport.missing.slice(0, 5).map((missing) => ({
      action: 'verify_claim',
      label: `Verify ${missing.gate}`,
      claimId: missing.claimId,
      reason: missing.reason
    }));
  }
  if (!acceptance.accepted) {
    return [{ action: 'accept_preview', label: 'Accept the release preview', reason: 'acceptance is required before release submission' }];
  }
  if (!lifecycleSettings.enabled) {
    return [{ action: 'enable_lifecycle', label: 'Enable release lifecycle', reason: lifecycleSettings.disabledReason || 'release lifecycle is disabled' }];
  }
  if (lifecycleSettings.scheduleInvalid) {
    return [{ action: 'fix_schedule', label: 'Set a valid release schedule', reason: 'scheduled release time must be an ISO timestamp' }];
  }
  if (lifecycleSettings.scheduleControls.violations.length > 0) {
    return [{
      action: 'adjust_schedule_controls',
      label: 'Choose an allowed release time',
      reason: lifecycleSettings.scheduleControls.violations[0],
      nextSchedulableReleaseAt: lifecycleSettings.nextSchedulableReleaseAt,
      scheduleRejectedReasons: lifecycleSettings.scheduleRejectedReasons
    }];
  }
  if (lifecycleControlPlan.commandControl && !lifecycleControlPlan.commandControl.allowed) {
    return [{
      action: 'resolve_lifecycle_control',
      label: 'Resolve lifecycle command control',
      reason: lifecycleControlPlan.commandControl.blockedReasons[0] || 'lifecycle command is blocked',
      command: lifecycleControlPlan.commandControl.command
    }];
  }
  if (!lifecycleSettings.releaseWindowOpen) {
    return [{
      action: 'wait_for_release_window',
      label: 'Wait for scheduled release window',
      reason: `next eligible release at ${lifecycleSettings.nextEligibleReleaseAt}`,
      nextEligibleReleaseAt: lifecycleSettings.nextEligibleReleaseAt
    }];
  }
  if (!releaseAuthorization.allowed) {
    return [{ action: 'request_release_approval', label: 'Route packet to a release approver', reason: releaseAuthorization.deniedReason }];
  }
  if (!releaseBoundaryPolicy.allowed) {
    return [{ action: 'resolve_release_boundary_policy', label: 'Resolve release boundary policy', reason: releaseBoundaryPolicy.deniedReason }];
  }
  if (readiness.canSubmitRelease && command !== 'release') {
    return [{ action: 'submit_release', label: 'Submit release command', reason: 'all release requirements are satisfied' }];
  }
  return [{ action: 'monitor_audit_handoff', label: 'Monitor audit handoff', reason: `release packet status is ${commandResult.state.status}` }];
}

function normalizeClientRequest(input, actor, boundary, commandId, now) {
  const source = input.clientRequest && typeof input.clientRequest === 'object'
    ? input.clientRequest
    : (input.clientState && typeof input.clientState === 'object'
      ? input.clientState
      : (input.requestContext && typeof input.requestContext === 'object' ? input.requestContext : {}));
  const tenantId = cleanToken(source.tenantId || input.clientTenantId, null);
  const workspaceId = cleanToken(source.workspaceId || input.clientWorkspaceId, null);
  const tenantScoped = scopedValueMatches(tenantId, boundary.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, boundary.workspaceId);
  const lastSeenRevision = Number.isSafeInteger(source.lastSeenRevision)
    ? source.lastSeenRevision
    : (Number.isSafeInteger(source.stateRevision) ? source.stateRevision : null);
  const acknowledgedRevision = Number.isSafeInteger(source.acknowledgedRevision)
    ? source.acknowledgedRevision
    : (Number.isSafeInteger(source.acceptedRevision)
      ? source.acceptedRevision
      : (Number.isSafeInteger(input.acknowledgedRevision) ? input.acknowledgedRevision : lastSeenRevision));
  const requestId = cleanToken(source.requestId || source.id || input.requestId, commandId);
  const sessionId = cleanToken(source.sessionId || input.sessionId, null);
  const route = cleanToken(source.route || input.route, `${surfaceGroup}/${surfaceName}`);
  return {
    schemaVersion: 1,
    requestId,
    sessionId,
    clientId: cleanToken(source.clientId || source.appId || input.clientId, 'hosted-kernel-client'),
    actorId: actor.actorId,
    route,
    view: cleanToken(source.view || input.view, 'release-packet'),
    intent: cleanToken(source.intent || input.intent, 'inspect_release_packet'),
    requestedCommandId: commandId,
    tenantId,
    workspaceId,
    tenantScoped,
    workspaceScoped,
    boundaryAccepted: tenantScoped && workspaceScoped,
    lastSeenRevision,
    acknowledgedRevision,
    previewDigest: cleanToken(source.previewDigest || source.acceptedPreviewDigest || input.previewDigest, null),
    handoffDigest: cleanToken(source.handoffDigest || source.clientWorkflowDigest || input.handoffDigest, null),
    runtimeContractVersion: cleanToken(source.runtimeContractVersion || source.contractVersion, 'client-runtime-adoption.v1'),
    resumeToken: cleanToken(source.resumeToken || input.resumeToken, null),
    traceparent: cleanToken(source.traceparent || source.traceParent || input.traceparent, null),
    handoffTarget: cleanToken(source.handoffTarget || input.handoffTarget, 'release-workbench'),
    submittedAt: normalizeIsoTimestamp(source.submittedAt || input.submittedAt) || now
  };
}

function buildClientRuntimeAdoptionContract({ state, command, clientRequest, acceptance, gateReport, operationalHealth, providerContracts, now }) {
  const releaseCommand = command === 'release';
  const revisionAcknowledged = clientRequest.acknowledgedRevision !== null
    && clientRequest.acknowledgedRevision >= state.revision;
  const readRevisionCurrent = clientRequest.lastSeenRevision === null
    || clientRequest.lastSeenRevision >= state.revision;
  const expectedHandoffDigest = proofDigest({
    contractType: 'client-runtime-adoption',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    status: state.status,
    gateReport: {
      requiredClaimCount: gateReport.requiredClaimCount,
      scopedClaimCount: gateReport.scopedClaimCount,
      verifiedClaimCount: gateReport.verifiedClaimCount,
      missing: gateReport.missing
    },
    acceptance: {
      decision: acceptance.decision,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      tenantScoped: acceptance.tenantScoped,
      workspaceScoped: acceptance.workspaceScoped
    },
    lifecycle: {
      enabled: state.lifecycleSettings.enabled,
      scheduledReleaseAt: state.lifecycleSettings.scheduledReleaseAt,
      releaseHoldUntil: state.lifecycleSettings.releaseHoldUntil,
      releaseWindowOpen: state.lifecycleSettings.releaseWindowOpen,
      scheduleRejectedReasons: state.lifecycleSettings.scheduleRejectedReasons,
      executionState: state.lifecycleSettings.enabled ? 'controls_enabled' : 'controls_disabled'
    },
    operationalHealthDigest: operationalHealth.digest,
    providerContractDigest: providerContracts.digest
  });
  const echoedHandoffDigest = clientRequest.handoffDigest || clientRequest.previewDigest;
  const handoffDigestMatched = echoedHandoffDigest === expectedHandoffDigest;
  const handoffDigestRequired = releaseCommand;
  const blockedReasons = [
    ...(clientRequest.boundaryAccepted ? [] : ['client_request_outside_workspace_boundary']),
    ...(releaseCommand && !readRevisionCurrent ? ['client_state_stale'] : []),
    ...(releaseCommand && !revisionAcknowledged ? ['client_revision_not_acknowledged'] : []),
    ...(handoffDigestRequired && !echoedHandoffDigest ? ['client_handoff_digest_required'] : []),
    ...(handoffDigestRequired && echoedHandoffDigest && !handoffDigestMatched ? ['client_handoff_digest_mismatch'] : [])
  ];
  const commandBlocked = releaseCommand && blockedReasons.length > 0;
  const recoveryPayload = {
    command: 'describe',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    clientRequest: {
      requestId: clientRequest.requestId,
      sessionId: clientRequest.sessionId,
      route: clientRequest.route,
      view: clientRequest.view,
      intent: 'refresh_release_packet_handoff',
      handoffTarget: clientRequest.handoffTarget,
      lastSeenRevision: state.revision,
      acknowledgedRevision: state.revision,
      handoffDigest: expectedHandoffDigest,
      runtimeContractVersion: clientRequest.runtimeContractVersion,
      resumeToken: clientRequest.resumeToken
    }
  };

  return {
    schemaVersion: 1,
    contractType: 'client-runtime-adoption',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    command,
    requestId: clientRequest.requestId,
    clientId: clientRequest.clientId,
    sessionId: clientRequest.sessionId,
    route: clientRequest.route,
    handoffTarget: clientRequest.handoffTarget,
    runtimeContractVersion: clientRequest.runtimeContractVersion,
    requiredForCommand: releaseCommand,
    commandBlocked,
    blockedReasons,
    revision: {
      serverRevision: state.revision,
      clientLastSeenRevision: clientRequest.lastSeenRevision,
      clientAcknowledgedRevision: clientRequest.acknowledgedRevision,
      readRevisionCurrent,
      revisionAcknowledged
    },
    handoffProof: {
      expectedHandoffDigest,
      echoedHandoffDigest,
      matched: handoffDigestMatched,
      required: handoffDigestRequired
    },
    recoveryPayload,
    userVisibleHandoff: {
      state: commandBlocked ? 'refresh_required' : 'adopted',
      label: commandBlocked ? 'Refresh release packet before submitting' : 'Release packet handoff is current',
      reason: blockedReasons[0] || 'client acknowledged the hosted-kernel release handoff',
      nextCommand: commandBlocked ? 'describe' : command,
      retryAfter: commandBlocked ? now : null
    },
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      command,
      requestId: clientRequest.requestId,
      revisionAcknowledged,
      readRevisionCurrent,
      expectedHandoffDigest,
      echoedHandoffDigest,
      blockedReasons
    })
  };
}

function normalizeReleaseBoundaryPolicy(input, actor, boundary, clientRequest, acceptance, command) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.releaseBoundaryPolicy && typeof input.releaseBoundaryPolicy === 'object'
    ? input.releaseBoundaryPolicy
    : (rawState.releaseBoundaryPolicy && typeof rawState.releaseBoundaryPolicy === 'object' ? rawState.releaseBoundaryPolicy : null);

  if (!source) {
    return {
      schemaVersion: 1,
      policyPresent: false,
      allowed: true,
      deniedReason: null,
      tenantScoped: true,
      workspaceScoped: true,
      commandAllowed: true,
      routeAllowed: true,
      handoffTargetAllowed: true,
      separationOfDutiesRequired: false,
      acceptanceActorConflict: false,
      selfApprovalOverride: false,
      allowedCommandCount: 0,
      allowedRouteCount: 0,
      trustedHandoffTargetCount: 0,
      allowedCommands: [],
      allowedRoutes: [],
      trustedHandoffTargets: []
    };
  }

  const tenantId = cleanToken(source.tenantId, null);
  const workspaceId = cleanToken(source.workspaceId, null);
  const tenantScoped = scopedValueMatches(tenantId, boundary.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, boundary.workspaceId);
  const allowedCommands = normalizeTokenList(source.allowedCommands || source.commandAllowlist);
  const allowedRoutes = normalizeTokenList(source.allowedRoutes || source.allowedReleaseRoutes || source.routeAllowlist);
  const trustedHandoffTargets = normalizeTokenList(source.trustedHandoffTargets || source.handoffTargetAllowlist);
  const commandAllowed = allowedCommands.length === 0 || allowedCommands.includes(command);
  const routeAllowed = allowedRoutes.length === 0 || allowedRoutes.includes(clientRequest.route);
  const handoffTargetAllowed = trustedHandoffTargets.length === 0 || trustedHandoffTargets.includes(clientRequest.handoffTarget);
  const separationOfDutiesRequired = source.requireSeparateAcceptanceActor === true || source.separationOfDuties === true;
  const acceptanceActorConflict = command === 'release'
    && separationOfDutiesRequired
    && acceptance.acceptedBy !== null
    && acceptance.acceptedBy === actor.actorId;
  const selfApprovalOverride = actor.roles.includes('release.self-approve')
    || (source.allowAdminSelfApproval === true && actor.roles.includes('release.admin'));
  const allowed = tenantScoped
    && workspaceScoped
    && commandAllowed
    && routeAllowed
    && handoffTargetAllowed
    && (!acceptanceActorConflict || selfApprovalOverride);
  const deniedReason = allowed ? null : (!tenantScoped || !workspaceScoped
    ? 'release_boundary_policy_outside_workspace'
    : (!commandAllowed
      ? 'command_not_allowed_by_release_boundary'
      : (!routeAllowed
        ? 'client_route_not_allowed_by_release_boundary'
        : (!handoffTargetAllowed
          ? 'handoff_target_not_trusted_by_release_boundary'
          : 'release_requires_separate_acceptance_actor'))));

  return {
    schemaVersion: 1,
    policyPresent: true,
    policyId: cleanToken(source.policyId || source.id, null),
    allowed,
    deniedReason,
    tenantId,
    workspaceId,
    tenantScoped,
    workspaceScoped,
    commandAllowed,
    routeAllowed,
    handoffTargetAllowed,
    separationOfDutiesRequired,
    acceptanceActorConflict,
    selfApprovalOverride,
    allowedCommands,
    allowedRoutes,
    trustedHandoffTargets,
    clientRoute: clientRequest.route,
    handoffTarget: clientRequest.handoffTarget,
    allowedCommandCount: allowedCommands.length,
    allowedRouteCount: allowedRoutes.length,
    trustedHandoffTargetCount: trustedHandoffTargets.length
  };
}

function buildBoundaryEvidenceContract({ actor, boundary, clientRequest, state, gateReport, acceptance, workspaceAccess, releaseBoundaryPolicy, providerContracts, now }) {
  const providerBoundaryMismatches = providerContracts.providers
    .filter((provider) => !provider.tenantScoped || !provider.workspaceScoped)
    .map((provider) => ({
      providerId: provider.providerId,
      tenantId: provider.tenantId,
      workspaceId: provider.workspaceId,
      tenantScoped: provider.tenantScoped,
      workspaceScoped: provider.workspaceScoped
    }));
  const isolationFaults = [
    ...(boundary.actorTenantMatches ? [] : ['actor_tenant_mismatch']),
    ...(boundary.actorWorkspaceMatches ? [] : ['actor_workspace_mismatch']),
    ...(boundary.stateTenantMatches ? [] : ['persisted_state_tenant_mismatch']),
    ...(boundary.stateWorkspaceMatches ? [] : ['persisted_state_workspace_mismatch']),
    ...(clientRequest.boundaryAccepted ? [] : ['client_request_outside_workspace_boundary']),
    ...(workspaceAccess.allowed ? [] : [workspaceAccess.deniedReason || 'workspace_access_denied']),
    ...(releaseBoundaryPolicy.allowed ? [] : [releaseBoundaryPolicy.deniedReason || 'release_boundary_policy_denied']),
    ...(acceptance.tenantScoped && acceptance.workspaceScoped ? [] : ['acceptance_outside_workspace_boundary']),
    ...(state.lifecycleSettings.tenantScoped && state.lifecycleSettings.workspaceScoped ? [] : ['lifecycle_settings_outside_workspace_boundary']),
    ...(gateReport.outOfScopeClaimCount === 0 ? [] : ['claim_evidence_outside_workspace_boundary']),
    ...(providerBoundaryMismatches.length === 0 ? [] : ['provider_contract_outside_workspace_boundary'])
  ];
  const uniqueIsolationFaults = [...new Set(isolationFaults)];
  const actorBoundary = {
    actorId: actor.actorId,
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    roles: actor.roles,
    tenantMatches: boundary.actorTenantMatches,
    workspaceMatches: boundary.actorWorkspaceMatches
  };
  const packetBoundary = {
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    stateTenantMatches: boundary.stateTenantMatches,
    stateWorkspaceMatches: boundary.stateWorkspaceMatches,
    recoveredFrom: state.boundaryRecoveredFrom
  };
  const scopedSubjects = {
    claims: {
      total: gateReport.requiredClaimCount,
      scoped: gateReport.scopedClaimCount,
      outOfScope: gateReport.outOfScopeClaimCount
    },
    providers: {
      total: providerContracts.providerCount,
      active: providerContracts.activeProviderCount,
      outOfScope: providerBoundaryMismatches.length
    },
    acceptance: {
      acceptedBy: acceptance.acceptedBy,
      tenantScoped: acceptance.tenantScoped,
      workspaceScoped: acceptance.workspaceScoped
    },
    clientRequest: {
      requestId: clientRequest.requestId,
      route: clientRequest.route,
      handoffTarget: clientRequest.handoffTarget,
      tenantScoped: clientRequest.tenantScoped,
      workspaceScoped: clientRequest.workspaceScoped
    }
  };
  return {
    schemaVersion: 1,
    contractType: 'release-packet-boundary-evidence',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    actorBoundary,
    packetBoundary,
    scopedSubjects,
    workspaceAccess: {
      policyPresent: workspaceAccess.policyPresent,
      allowed: workspaceAccess.allowed,
      deniedReason: workspaceAccess.deniedReason,
      matchedRoles: workspaceAccess.matchedRoles
    },
    releaseBoundaryPolicy: {
      policyPresent: releaseBoundaryPolicy.policyPresent,
      allowed: releaseBoundaryPolicy.allowed,
      deniedReason: releaseBoundaryPolicy.deniedReason,
      commandAllowed: releaseBoundaryPolicy.commandAllowed,
      routeAllowed: releaseBoundaryPolicy.routeAllowed,
      handoffTargetAllowed: releaseBoundaryPolicy.handoffTargetAllowed
    },
    providerBoundaryMismatches,
    isolationFaults: uniqueIsolationFaults,
    isolationFaultCount: uniqueIsolationFaults.length,
    handoffSafe: uniqueIsolationFaults.length === 0,
    auditScope: {
      stream: `${surfaceGroup}.${surfaceName}`,
      storageRoot: `${state.tenantId}/${state.workspaceId}/${state.releaseId}`,
      partitionKey: `${state.tenantId}:${state.workspaceId}`,
      expectedTenantId: state.tenantId,
      expectedWorkspaceId: state.workspaceId
    },
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      actorBoundary,
      packetBoundary,
      scopedSubjects,
      providerBoundaryMismatches,
      isolationFaults: uniqueIsolationFaults
    })
  };
}

function normalizeHostedBootProof(input, state, boundaryEvidence, providerContracts, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.hostedBootProof && typeof input.hostedBootProof === 'object'
    ? input.hostedBootProof
    : (input.bootProof && typeof input.bootProof === 'object'
      ? input.bootProof
      : (rawState.hostedBootProof && typeof rawState.hostedBootProof === 'object'
        ? rawState.hostedBootProof
        : (rawState.bootProof && typeof rawState.bootProof === 'object' ? rawState.bootProof : null)));
  const present = source !== null;
  const proofId = cleanToken(source?.proofId || source?.id, `${state.releaseId}:hosted-boot-proof`);
  const protocolVersion = cleanToken(source?.protocolVersion || source?.contractVersion, 'hosted-kernel.boot-proof.v1');
  const tenantId = cleanToken(source?.tenantId, null);
  const workspaceId = cleanToken(source?.workspaceId, null);
  const releaseId = cleanToken(source?.releaseId, null);
  const revision = Number.isSafeInteger(source?.revision)
    ? source.revision
    : (Number.isSafeInteger(source?.stateRevision) ? source.stateRevision : null);
  const bootedAt = normalizeIsoTimestamp(source?.bootedAt || source?.startedAt || source?.observedAt);
  const expiresAt = normalizeIsoTimestamp(source?.expiresAt || source?.validUntil);
  const tenantScoped = scopedValueMatches(tenantId, state.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, state.workspaceId);
  const releaseScoped = scopedValueMatches(releaseId, state.releaseId);
  const revisionCurrent = revision === null || revision >= state.revision;
  const protocolSupported = SUPPORTED_BOOT_PROOF_PROTOCOLS.has(protocolVersion);
  const expired = expiresAt !== null && Date.parse(expiresAt) <= Date.parse(now);
  const kernelVersion = cleanToken(source?.kernelVersion || source?.imageVersion || source?.runtimeVersion, null);
  const imageDigest = cleanToken(source?.imageDigest || source?.runtimeDigest || source?.bootImageDigest, null);
  const bootNonce = cleanToken(source?.bootNonce || source?.nonce || source?.challenge, null);
  const signatureDigest = cleanToken(source?.signatureDigest || source?.signature || source?.attestationDigest, null);
  const providerId = cleanToken(source?.providerId || source?.hostedProviderId, null);
  const providerMatched = providerId === null || providerContracts.providers.some((provider) => provider.providerId === providerId && provider.active);
  const boundarySafe = boundaryEvidence.handoffSafe;
  const blockedReasons = [
    ...(present ? [] : ['hosted_boot_proof_missing']),
    ...(protocolSupported ? [] : ['hosted_boot_proof_protocol_unsupported']),
    ...(tenantScoped ? [] : ['hosted_boot_proof_tenant_mismatch']),
    ...(workspaceScoped ? [] : ['hosted_boot_proof_workspace_mismatch']),
    ...(releaseScoped ? [] : ['hosted_boot_proof_release_mismatch']),
    ...(revisionCurrent ? [] : ['hosted_boot_proof_revision_stale']),
    ...(bootedAt ? [] : ['hosted_boot_proof_boot_timestamp_missing']),
    ...(expired ? ['hosted_boot_proof_expired'] : []),
    ...(kernelVersion ? [] : ['hosted_boot_proof_kernel_version_missing']),
    ...(imageDigest ? [] : ['hosted_boot_proof_image_digest_missing']),
    ...(bootNonce ? [] : ['hosted_boot_proof_nonce_missing']),
    ...(signatureDigest ? [] : ['hosted_boot_proof_signature_missing']),
    ...(providerMatched ? [] : ['hosted_boot_proof_provider_not_active']),
    ...(boundarySafe ? [] : ['hosted_boot_proof_boundary_not_safe'])
  ];

  return {
    schemaVersion: 1,
    contractType: 'hosted-kernel-boot-proof',
    proofId,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    present,
    ready: present && blockedReasons.length === 0,
    protocolVersion,
    supportedProtocols: [...SUPPORTED_BOOT_PROOF_PROTOCOLS].sort(),
    tenantScoped,
    workspaceScoped,
    releaseScoped,
    revisionCurrent,
    bootedAt,
    expiresAt,
    expired,
    kernelVersion,
    imageDigest,
    bootNoncePresent: bootNonce !== null,
    signatureDigest,
    providerId,
    providerMatched,
    boundaryEvidenceDigest: boundaryEvidence.digest,
    providerContractDigest: providerContracts.digest,
    blockedReasons,
    observedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      proofId,
      protocolVersion,
      bootedAt,
      expiresAt,
      kernelVersion,
      imageDigest,
      bootNonce,
      signatureDigest,
      providerId,
      boundaryEvidenceDigest: boundaryEvidence.digest,
      providerContractDigest: providerContracts.digest,
      blockedReasons
    })
  };
}

function buildLifecycleCommandAction({ state, settings, candidate, allowed, blockedReasons, now }) {
  const hasRequestedReleaseAt = settings.requestedReleaseAt !== null;
  const proposedReleaseAt = settings.requestedReleaseAt
    || settings.nextSchedulableReleaseAt
    || settings.scheduledReleaseAt
    || settings.scheduleControls.earliestAllowedAt;
  const disabledReason = settings.requestedDisabledReason
    || settings.disabledReason
    || (settings.scheduleControls.requireDisableReason ? null : 'disabled by release operator');
  const settingsPatch = candidate === 'enable'
    ? {
      enabled: true,
      disabledReason: null,
      updatedAt: now
    }
    : (candidate === 'disable'
      ? {
        enabled: false,
        disabledReason,
        updatedAt: now
      }
      : (candidate === 'schedule'
        ? {
          scheduledReleaseAt: proposedReleaseAt,
          scheduleInvalid: false,
          scheduleRejected: false,
          scheduleRejectedReasons: [],
          nextSchedulableReleaseAt: null,
          updatedAt: now
        }
        : {
          expectedStatus: 'released',
          requiresLifecycleEnabled: true,
          requiresReleaseWindowOpen: true
        }));
  const requiredInputs = [
    ...(candidate === 'disable' && settings.scheduleControls.requireDisableReason ? [{
      field: 'disabledReason',
      required: true,
      satisfied: disabledReason !== null,
      expected: 'operator supplied disable reason'
    }] : []),
    ...(candidate === 'schedule' ? [{
      field: 'releaseAt',
      required: true,
      satisfied: hasRequestedReleaseAt,
      expected: 'ISO-8601 timestamp within schedule controls'
    }] : []),
    ...(candidate === 'release' ? [{
      field: 'acceptance.decision',
      required: true,
      satisfied: true,
      expected: 'accepted release preview'
    }] : [])
  ];
  const commandInput = candidate === 'enable'
    ? { lifecycleEnabled: true }
    : (candidate === 'disable'
      ? { lifecycleEnabled: false, disabledReason }
      : (candidate === 'schedule'
        ? { releaseAt: proposedReleaseAt }
        : {}));
  const actionState = allowed
    ? 'ready'
    : (blockedReasons.includes('release_window_not_open')
      ? 'waiting'
      : (blockedReasons.some((reason) => reason.includes('schedule') || reason.includes('blackout'))
        ? 'needs_schedule_update'
        : 'blocked'));
  const actionProof = {
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    command: candidate,
    actionState,
    settingsPatch,
    blockedReasons,
    requiredInputs
  };

  return {
    actionState,
    requiredInputs,
    commandPayload: {
      command: candidate,
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      expectedRevision: state.revision,
      lifecycleSettings: commandInput
    },
    settingsMutation: {
      mutationType: `lifecycle.${candidate}`,
      before: {
        enabled: settings.enabled,
        disabledReason: settings.disabledReason,
        scheduledReleaseAt: settings.scheduledReleaseAt,
        releaseHoldUntil: settings.releaseHoldUntil,
        releaseWindowOpen: settings.releaseWindowOpen
      },
      patch: settingsPatch,
      blockedReasons,
      appliesWhenAllowed: allowed
    },
    proof: {
      proofType: 'release-lifecycle-command-action-v1',
      digest: proofDigest(actionProof),
      generatedAt: now
    }
  };
}

function buildLifecycleExecutionPlan({ state, settings, commandControls, command, commandResult, now }) {
  const retryableReasons = new Set([
    'release_window_not_open',
    'minimum_schedule_lead_time_not_met',
    'release_blackout_window',
    'maximum_schedule_horizon_exceeded'
  ]);
  const planSteps = commandControls
    .map((control) => {
      const waitingForSchedule = control.blockedReasons.includes('release_window_not_open')
        || control.blockedReasons.includes('minimum_schedule_lead_time_not_met')
        || control.blockedReasons.includes('release_blackout_window');
      const missingInputs = control.requiredInputs
        .filter((requirement) => requirement.required && !requirement.satisfied)
        .map((requirement) => requirement.field);
      const retryAfter = control.command === 'release' && waitingForSchedule
        ? (settings.nextEligibleReleaseAt || settings.nextSchedulableReleaseAt)
        : (control.command === 'schedule' && settings.nextSchedulableReleaseAt
          ? settings.nextSchedulableReleaseAt
          : null);
      const runnable = control.allowed && missingInputs.length === 0;
      const blockedByPolicy = control.blockedReasons.some((reason) => [
        'missing_required_role',
        'actor_outside_workspace_boundary',
        'command_not_allowed_by_release_boundary',
        'actor_not_workspace_member',
        'actor_revoked_from_workspace'
      ].includes(reason));
      const terminalBlock = control.blockedReasons.some((reason) => !retryableReasons.has(reason))
        && !waitingForSchedule
        && missingInputs.length === 0;
      const priority = control.command === 'enable' && !settings.enabled
        ? 10
        : (control.command === 'schedule' && (settings.scheduleInvalid || settings.scheduleRejected || !settings.releaseWindowOpen)
          ? 20
          : (control.command === 'release' && settings.enabled && settings.releaseWindowOpen
            ? 30
            : (control.command === 'disable' ? 90 : 80)));

      return {
        stepId: `lifecycle:${control.command}`,
        command: control.command,
        priority,
        runnable,
        actionState: control.actionState,
        blockedReasons: control.blockedReasons,
        blockedByPolicy,
        terminalBlock,
        waitingForSchedule,
        retryAfter,
        missingInputs,
        commandPayload: control.commandPayload,
        settingsMutation: control.settingsMutation,
        proofDigest: control.proof.digest
      };
    })
    .sort((left, right) => {
      if (left.runnable !== right.runnable) {
        return left.runnable ? -1 : 1;
      }
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.command.localeCompare(right.command);
    });
  const runnableSteps = planSteps.filter((step) => step.runnable);
  const waitingSteps = planSteps.filter((step) => step.waitingForSchedule);
  const blockedSteps = planSteps.filter((step) => !step.runnable && !step.waitingForSchedule);
  const nextRunnableStep = runnableSteps[0] || null;
  const waitingUntilCandidates = [
    settings.nextEligibleReleaseAt,
    settings.nextSchedulableReleaseAt,
    ...waitingSteps.map((step) => step.retryAfter)
  ].filter(Boolean).sort();
  const currentCommandStep = planSteps.find((step) => step.command === command) || null;
  const settingsMutationRequired = Boolean(
    nextRunnableStep
      && ['enable', 'disable', 'schedule'].includes(nextRunnableStep.command)
      && nextRunnableStep.settingsMutation.appliesWhenAllowed
  );
  const executionState = nextRunnableStep
    ? 'ready'
    : (waitingSteps.length > 0 ? 'waiting_for_schedule' : (blockedSteps.length > 0 ? 'blocked' : 'monitoring'));

  return {
    schemaVersion: 1,
    planType: 'release-lifecycle-execution-plan',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    command,
    commandDenied: commandResult.denied,
    executionState,
    settingsMutationRequired,
    nextRunnableCommand: nextRunnableStep?.command || null,
    nextAction: nextRunnableStep
      ? nextRunnableStep.commandPayload
      : (waitingSteps[0]?.commandPayload || null),
    waitingUntil: waitingUntilCandidates[0] || null,
    runnableCommandCount: runnableSteps.length,
    waitingCommandCount: waitingSteps.length,
    blockedCommandCount: blockedSteps.length,
    currentCommandStep,
    runnableSteps,
    waitingSteps,
    blockedSteps,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      command,
      executionState,
      settingsMutationRequired,
      nextRunnableCommand: nextRunnableStep?.command || null,
      waitingUntil: waitingUntilCandidates[0] || null,
      planSteps: planSteps.map((step) => ({
        command: step.command,
        runnable: step.runnable,
        actionState: step.actionState,
        blockedReasons: step.blockedReasons,
        missingInputs: step.missingInputs,
        retryAfter: step.retryAfter,
        proofDigest: step.proofDigest
      }))
    })
  };
}

function buildLifecycleControlPlan({ state, actor, boundary, workspaceAccess, releaseBoundaryPolicy, command, commandResult, now }) {
  const settings = state.lifecycleSettings;
  const controlledCommands = ['enable', 'disable', 'schedule', 'release'];
  const currentCommandApplied = commandResult.denied === false
    && commandResult.audit.some((event) => event.type === 'command_applied' && event.command === command);
  const commandControls = controlledCommands.map((candidate) => {
    const candidateAuthorization = authorizeCommand(candidate, actor, boundary, workspaceAccess);
    const allowedByBoundaryPolicy = !releaseBoundaryPolicy.policyPresent
      || releaseBoundaryPolicy.allowedCommandCount === 0
      || releaseBoundaryPolicy.allowedCommands.includes(candidate);
    const blockedReasons = [
      ...(candidateAuthorization.allowed ? [] : [candidateAuthorization.deniedReason || 'command_not_authorized']),
      ...(allowedByBoundaryPolicy ? [] : ['command_not_allowed_by_release_boundary']),
      ...(candidate === 'enable' && settings.enabled && !(candidate === command && currentCommandApplied) ? ['lifecycle_already_enabled'] : []),
      ...(candidate === 'disable' && !settings.enabled && !(candidate === command && currentCommandApplied) ? ['lifecycle_already_disabled'] : []),
      ...(candidate === 'disable' && settings.scheduleControls.requireDisableReason && !settings.requestedDisabledReason ? ['disable_reason_required'] : []),
      ...(candidate === 'schedule' && command === 'schedule' && !settings.requestedReleaseAt ? ['requested_release_time_required'] : []),
      ...(candidate === 'schedule' && settings.scheduleRejected ? settings.scheduleRejectedReasons : []),
      ...(candidate === 'release' && !settings.enabled ? ['lifecycle_disabled'] : []),
      ...(candidate === 'release' && settings.scheduleRejected ? settings.scheduleRejectedReasons : []),
      ...(candidate === 'release' && !settings.releaseWindowOpen ? ['release_window_not_open'] : [])
    ];
    const allowed = blockedReasons.length === 0;
    const actionContract = buildLifecycleCommandAction({
      state,
      settings,
      candidate,
      allowed,
      blockedReasons,
      now
    });
    return {
      command: candidate,
      allowed,
      roleAllowed: candidateAuthorization.allowed,
      boundaryPolicyAllowed: allowedByBoundaryPolicy,
      blockedReasons,
      requiredRoles: candidateAuthorization.requiredRoles,
      ...actionContract
    };
  });
  const commandControl = commandControls.find((control) => control.command === command) || null;
  const lifecycleBlockedReasons = [
    ...(!settings.tenantScoped || !settings.workspaceScoped ? ['lifecycle_settings_outside_workspace_boundary'] : []),
    ...(!settings.enabled ? ['lifecycle_disabled'] : []),
    ...(settings.scheduleRejected ? settings.scheduleRejectedReasons : []),
    ...(!settings.releaseWindowOpen ? ['release_window_not_open'] : []),
    ...(commandResult.denied ? ['command_denied'] : []),
    ...(operationalHealthCommandBlocked(command, commandResult.audit) ? ['operational_health_blocked'] : [])
  ];
  const scheduleState = settings.scheduleInvalid
    ? 'invalid'
    : (settings.scheduleRejected
      ? 'rejected'
      : (settings.releaseWindowOpen ? 'open' : 'waiting'));
  const currentCommandEffect = command === 'enable'
    ? (settings.enabled ? 'confirmed_enabled' : 'enable_blocked')
    : (command === 'disable'
      ? (!settings.enabled ? 'confirmed_disabled' : 'disable_blocked')
      : (command === 'schedule'
        ? (settings.scheduleRejected ? 'schedule_rejected' : 'schedule_recorded')
        : (command === 'release'
          ? (state.status === 'released' ? 'release_completed' : (lifecycleBlockedReasons.length > 0 ? 'release_blocked' : 'release_pending'))
          : 'inspect_only')));
  const nextControl = commandControls.find((control) => {
    if (!settings.enabled) {
      return control.command === 'enable' && control.roleAllowed && control.boundaryPolicyAllowed;
    }
    if (settings.scheduleInvalid) {
      return control.command === 'schedule' && control.roleAllowed && control.boundaryPolicyAllowed;
    }
    if (settings.scheduleRejected) {
      return control.command === 'schedule' && control.roleAllowed && control.boundaryPolicyAllowed;
    }
    if (!settings.releaseWindowOpen) {
      return control.command === 'schedule' && control.roleAllowed && control.boundaryPolicyAllowed;
    }
    return control.command === 'release' && control.roleAllowed && control.boundaryPolicyAllowed;
  }) || null;
  const executionPlan = buildLifecycleExecutionPlan({
    state,
    settings,
    commandControls,
    command,
    commandResult,
    now
  });
  return {
    schemaVersion: 1,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    command,
    commandEffect: currentCommandEffect,
    lifecycleBlocked: lifecycleBlockedReasons.length > 0,
    lifecycleBlockedReasons,
    settingsValid: settings.tenantScoped && settings.workspaceScoped && !settings.scheduleInvalid,
    controlsEnabled: settings.enabled,
    schedule: {
      state: scheduleState,
      requestedReleaseAt: settings.requestedReleaseAt,
      scheduledReleaseAt: settings.scheduledReleaseAt,
      releaseHoldUntil: settings.releaseHoldUntil,
      releaseWindowOpen: settings.releaseWindowOpen,
      nextEligibleReleaseAt: settings.nextEligibleReleaseAt,
      nextSchedulableReleaseAt: settings.nextSchedulableReleaseAt,
      scheduleRejected: settings.scheduleRejected,
      rejectedReasons: settings.scheduleRejectedReasons,
      controls: settings.scheduleControls
    },
    commandControl,
    commandControls,
    executionPlan,
    nextActionState: nextControl ? {
      action: nextControl.command === 'release' ? 'submit_release' : `${nextControl.command}_lifecycle`,
      command: nextControl.command,
      reason: lifecycleBlockedReasons[0] || (nextControl.command === 'release' ? 'release_window_open' : 'lifecycle_control_available'),
      enabled: nextControl.allowed,
      blockedReasons: nextControl.blockedReasons,
      actionState: nextControl.actionState,
      requiredInputs: nextControl.requiredInputs,
      commandPayload: nextControl.commandPayload,
      settingsMutation: nextControl.settingsMutation,
      proof: nextControl.proof
    } : {
      action: 'monitor_lifecycle',
      command: null,
      reason: state.status === 'released' ? 'release_already_completed' : 'no_lifecycle_command_available',
      enabled: false,
      blockedReasons: lifecycleBlockedReasons
    },
    updatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      command,
      settings,
      commandControls: commandControls.map((control) => ({
        command: control.command,
        allowed: control.allowed,
        actionState: control.actionState,
        blockedReasons: control.blockedReasons,
        settingsMutation: control.settingsMutation,
        proofDigest: control.proof.digest
      })),
      executionPlanDigest: executionPlan.digest,
      executionState: executionPlan.executionState,
      nextRunnableCommand: executionPlan.nextRunnableCommand,
      lifecycleBlockedReasons
    })
  };
}

function operationalHealthCommandBlocked(command, audit) {
  return (command === 'prepare' || command === 'release')
    && audit.some((event) => event.type === 'operational_health_blocked');
}

function buildClientWorkflowHandoff({ clientRequest, commandResult, preview, readiness, validationSummary, validationIssueSummary, nextSteps, stateHealth, boundaryEvidence, operationalHealth, providerContracts, lifecycleControlPlan, acceptanceControl, clientRuntimeAdoption, now }) {
  const acceptanceNeedsCurrentPreview = !acceptanceControl.acceptanceBoundToPreview;
  const primaryStep = acceptanceNeedsCurrentPreview ? {
    action: acceptanceControl.nextAction.action,
    label: acceptanceControl.nextAction.action === 'refresh_preview'
      ? 'Refresh release preview'
      : 'Accept the current release preview',
    reason: acceptanceControl.previewDigestBinding.state === 'stale_or_mismatched'
      ? 'accepted preview digest does not match the current preview'
      : 'current preview acceptance is required before release submission',
    route: acceptanceControl.nextAction.route,
    payload: acceptanceControl.nextAction.payload
  } : (nextSteps[0] || {
    action: 'monitor_audit_handoff',
    label: 'Monitor audit handoff',
    reason: `release packet status is ${commandResult.state.status}`
  });
  const staleRevision = clientRequest.lastSeenRevision !== null && clientRequest.lastSeenRevision < commandResult.state.revision;
  const blockedByBoundary = !clientRequest.boundaryAccepted;
  const blockedByOperationalHealth = operationalHealth.commandBlocked;
  const blockedByProviderContract = providerContracts.commandBlocked;
  const blockedByClientRuntime = clientRuntimeAdoption.commandBlocked;
  const blockedByState = !stateHealth.healthy || commandResult.denied || blockedByOperationalHealth || blockedByProviderContract || blockedByClientRuntime;
  const canContinue = !blockedByBoundary && !blockedByState;
  const workflowState = blockedByBoundary
      ? 'blocked_boundary'
      : (commandResult.denied
        ? 'blocked_authorization'
        : (blockedByOperationalHealth
          ? 'blocked_operational_health'
          : (blockedByProviderContract
            ? 'blocked_provider_contract'
            : (blockedByClientRuntime
              ? 'refresh_required'
              : (acceptanceNeedsCurrentPreview
                ? acceptanceControl.controlState
                : (readiness.canSubmitRelease ? 'ready_to_submit' : (staleRevision ? 'refresh_required' : 'needs_input')))))));
  const disabledReasons = [
    ...(blockedByBoundary ? ['client_request_outside_workspace_boundary'] : []),
    ...(commandResult.denied ? ['command_denied'] : []),
    ...(blockedByOperationalHealth ? ['operational_health_blocked'] : []),
    ...(blockedByProviderContract ? providerContracts.blockedReasons : []),
    ...(blockedByClientRuntime ? clientRuntimeAdoption.blockedReasons : []),
    ...(acceptanceNeedsCurrentPreview ? acceptanceControl.disabledReasons : []),
    ...(!stateHealth.healthy ? ['state_health_failed'] : []),
    ...(staleRevision ? ['client_state_stale'] : [])
  ];

  return {
    schemaVersion: 1,
    requestId: clientRequest.requestId,
    clientId: clientRequest.clientId,
    sessionId: clientRequest.sessionId,
    route: clientRequest.route,
    view: clientRequest.view,
    intent: clientRequest.intent,
    handoffTarget: clientRequest.handoffTarget,
    workflowState,
    canContinue,
    staleRevision,
    clientRevision: clientRequest.lastSeenRevision,
    serverRevision: commandResult.state.revision,
    submittedAt: clientRequest.submittedAt,
    generatedAt: now,
    primaryAction: {
      action: primaryStep.action,
      label: primaryStep.label,
      reason: primaryStep.reason || null,
      route: primaryStep.route || null,
      payload: primaryStep.payload || null,
      enabled: canContinue && !staleRevision && primaryStep.action !== 'wait_for_release_window'
    },
    userVisibleStatus: {
      statusBadge: preview.statusBadge,
      releaseStatus: commandResult.state.status,
      readyForRelease: validationSummary.readyForRelease,
      canSubmitRelease: readiness.canSubmitRelease && acceptanceControl.acceptanceBoundToPreview,
      blockingReasonCount: preview.blockingReasons.length,
      validationIssueCount: validationIssueSummary.issueCount,
      primaryValidationIssue: validationIssueSummary.primaryIssue,
      nextEligibleReleaseAt: readiness.nextEligibleReleaseAt,
      nextSchedulableReleaseAt: readiness.nextSchedulableReleaseAt,
      operationalHealth: operationalHealth.status,
      retryAfter: readiness.retryAfter,
      lifecycleCommandEffect: lifecycleControlPlan.commandEffect,
      lifecycleNextAction: lifecycleControlPlan.nextActionState.action,
      lifecycleExecutionState: lifecycleControlPlan.executionPlan.executionState,
      lifecycleNextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
      lifecycleWaitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
      lifecycleScheduleRejectedReasons: lifecycleControlPlan.schedule.rejectedReasons,
      providerContractState: providerContracts.commandBlocked ? 'blocked' : 'ready',
      externalHandoffState: providerContracts.externalHandoffContract.status,
      externalHandoffTarget: providerContracts.externalHandoffContract.target,
      clientRuntimeState: clientRuntimeAdoption.userVisibleHandoff.state,
      clientRuntimeReason: clientRuntimeAdoption.userVisibleHandoff.reason,
      acceptanceControlState: acceptanceControl.controlState,
      previewDigest: acceptanceControl.previewDigest,
      acceptedPreviewDigest: acceptanceControl.echoedPreviewDigest,
      acceptedPreviewCurrent: acceptanceControl.previewDigestBinding.matched,
      acceptanceNextAction: acceptanceControl.nextAction.action,
      acceptanceNextRoute: acceptanceControl.nextAction.route
    },
    validationIssues: {
      digest: validationIssueSummary.digest,
      issueCount: validationIssueSummary.issueCount,
      blockingIssueCount: validationIssueSummary.blockingIssueCount,
      waitingIssueCount: validationIssueSummary.waitingIssueCount,
      categories: validationIssueSummary.categories,
      primaryIssue: validationIssueSummary.primaryIssue,
      topIssues: validationIssueSummary.topIssues
    },
    disabledReasons,
    boundaryEvidence: {
      digest: boundaryEvidence.digest,
      handoffSafe: boundaryEvidence.handoffSafe,
      isolationFaults: boundaryEvidence.isolationFaults,
      auditScope: boundaryEvidence.auditScope,
      scopedSubjects: boundaryEvidence.scopedSubjects
    },
    refreshPolicy: {
      shouldRefresh: staleRevision || blockedByState || acceptanceControl.previewDigestBinding.state === 'stale_or_mismatched',
      reason: staleRevision
        ? 'server_revision_advanced'
        : (acceptanceControl.previewDigestBinding.state === 'stale_or_mismatched'
          ? 'accepted_preview_digest_stale'
          : (blockedByState ? 'state_or_command_blocked' : null)),
      storageKey: `${commandResult.state.tenantId}/${commandResult.state.workspaceId}/${commandResult.state.releaseId}`
    },
    degradedMode: {
      enabled: operationalHealth.degradedModeEnabled,
      acknowledged: operationalHealth.degradedModeAcknowledged,
      status: operationalHealth.status,
      failureState: operationalHealth.failureState.state,
      blockedReasons: operationalHealth.failureState.blockedReasons,
      componentCount: operationalHealth.componentCount,
      providerDerivedComponentCount: operationalHealth.providerDerivedComponentCount,
      blockingComponentCount: operationalHealth.blockingComponentCount,
      degradedComponentCount: operationalHealth.degradedComponentCount,
      exhaustedComponentCount: operationalHealth.exhaustedComponentCount,
      retryAfter: operationalHealth.retryAfter,
      retryPolicy: operationalHealth.retryPlan.policy,
      escalationRequired: operationalHealth.retryPlan.escalationRequired
    },
    providerContracts: {
      digest: providerContracts.digest,
      commandBlocked: providerContracts.commandBlocked,
      blockedReasons: providerContracts.blockedReasons,
      activeProviderCount: providerContracts.activeProviderCount,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      activeServiceTypes: providerContracts.activeServiceTypes,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      incompatibleProviderCount: providerContracts.incompatibleProviderCount,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServices: providerContracts.staleProviderServices,
      incompatibleProviderServices: providerContracts.incompatibleProviderServices,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffContract: providerContracts.externalHandoffContract
    },
    lifecycleControls: {
      digest: lifecycleControlPlan.digest,
      settingsValid: lifecycleControlPlan.settingsValid,
      lifecycleBlocked: lifecycleControlPlan.lifecycleBlocked,
      blockedReasons: lifecycleControlPlan.lifecycleBlockedReasons,
      nextActionState: lifecycleControlPlan.nextActionState,
      executionPlan: lifecycleControlPlan.executionPlan,
      schedule: lifecycleControlPlan.schedule,
      commandControls: lifecycleControlPlan.commandControls.map((control) => ({
        command: control.command,
        allowed: control.allowed,
        actionState: control.actionState,
        blockedReasons: control.blockedReasons,
        requiredInputs: control.requiredInputs,
        commandPayload: control.commandPayload,
        settingsMutation: control.settingsMutation,
        proofDigest: control.proof.digest
      }))
    },
    acceptanceControl: {
      digest: acceptanceControl.digest,
      controlState: acceptanceControl.controlState,
      acceptanceBoundToPreview: acceptanceControl.acceptanceBoundToPreview,
      previewDigest: acceptanceControl.previewDigest,
      echoedPreviewDigest: acceptanceControl.echoedPreviewDigest,
      previewDigestBinding: acceptanceControl.previewDigestBinding,
      clientRuntimeAdoptionDigestBinding: acceptanceControl.clientRuntimeAdoptionDigestBinding,
      missingFields: acceptanceControl.missingFields,
      disabledReasons: acceptanceControl.disabledReasons,
      acceptPreviewPayload: acceptanceControl.acceptPreviewPayload,
      refreshPreviewPayload: acceptanceControl.refreshPreviewPayload,
      nextAction: acceptanceControl.nextAction,
      submitPayload: acceptanceControl.submitPayload
    },
    clientRuntimeAdoption: {
      digest: clientRuntimeAdoption.digest,
      commandBlocked: clientRuntimeAdoption.commandBlocked,
      blockedReasons: clientRuntimeAdoption.blockedReasons,
      requiredForCommand: clientRuntimeAdoption.requiredForCommand,
      revision: clientRuntimeAdoption.revision,
      handoffProof: clientRuntimeAdoption.handoffProof,
      recoveryPayload: clientRuntimeAdoption.recoveryPayload,
      userVisibleHandoff: clientRuntimeAdoption.userVisibleHandoff
    },
    correlation: {
      traceparent: clientRequest.traceparent,
      commandId: commandResult.state.lastCommandId || clientRequest.requestedCommandId,
      digest: proofDigest({
        requestId: clientRequest.requestId,
        releaseId: commandResult.state.releaseId,
        workflowState,
        revision: commandResult.state.revision,
        primaryAction: primaryStep.action,
        disabledReasons
      })
    }
  };
}

function buildHistorySnapshots({ recoveredState, currentState, gateReport, validationSummary, acceptance, commandResult, now }) {
  const ledgerSnapshots = currentState.commandLedger.map((entry) => ({
    snapshotId: `ledger:${entry.commandId}`,
    source: 'command_ledger',
    releaseId: currentState.releaseId,
    tenantId: currentState.tenantId,
    workspaceId: currentState.workspaceId,
    status: entry.statusAfter,
    revision: entry.stateRevision,
    command: entry.command,
    commandId: entry.commandId,
    capturedAt: entry.appliedAt,
    resultDigest: entry.resultDigest
  }));
  const recoverySnapshot = recoveredState.recoveryReasons.length > 0 ? [{
    snapshotId: `recovery:${recoveredState.revision}`,
    source: 'state_recovery',
    releaseId: recoveredState.releaseId,
    tenantId: recoveredState.tenantId,
    workspaceId: recoveredState.workspaceId,
    status: recoveredState.status,
    revision: recoveredState.revision,
    restartStatus: recoveredState.restartStatus,
    capturedAt: recoveredState.updatedAt,
    recoveryReasons: recoveredState.recoveryReasons
  }] : [];
  const currentSnapshot = {
    snapshotId: `current:${currentState.revision}`,
    source: 'current_state',
    releaseId: currentState.releaseId,
    tenantId: currentState.tenantId,
    workspaceId: currentState.workspaceId,
    status: currentState.status,
    revision: currentState.revision,
    restartStatus: currentState.restartStatus,
    lifecycleEnabled: currentState.lifecycleSettings.enabled,
    scheduledReleaseAt: currentState.lifecycleSettings.scheduledReleaseAt,
    nextEligibleReleaseAt: currentState.lifecycleSettings.nextEligibleReleaseAt,
    command: commandResult.command,
    commandId: currentState.lastCommandId,
    capturedAt: currentState.updatedAt || now,
    releaseReady: validationSummary.readyForRelease,
    gatePassed: gateReport.passed,
    acceptanceDecision: acceptance.decision
  };
  const bySnapshotId = new Map([...recoverySnapshot, ...ledgerSnapshots, currentSnapshot]
    .map((snapshot) => [snapshot.snapshotId, snapshot]));
  return [...bySnapshotId.values()].slice(-MAX_COMMAND_LOG);
}

function buildReportingTimeline({ state, audit, validationSummary, readiness, acceptance, workspaceAccess, now }) {
  const auditEvents = audit.map((event, index) => ({
    eventId: `audit:${index + 1}`,
    phase: 'audit',
    occurredAt: event.at || now,
    status: event.type,
    severity: event.type.endsWith('_denied') || event.type.endsWith('_rejected') ? 'error' : 'info',
    summary: event.reason || event.detail || event.type,
    releaseId: state.releaseId,
    commandId: event.commandId || null
  }));
  const validationEvents = validationSummary.checks.map((check) => ({
    eventId: `validation:${check.checkId}`,
    phase: 'validation',
    occurredAt: state.updatedAt || now,
    status: check.status,
    severity: check.status === 'failed' ? 'error' : (check.status === 'pending' ? 'warning' : 'info'),
    summary: check.detail,
    releaseId: state.releaseId,
    commandId: state.lastCommandId
  }));
  return [
    {
      eventId: 'packet:current-state',
      phase: 'state',
      occurredAt: state.updatedAt || now,
      status: state.status,
      severity: readiness.canSubmitRelease || state.status === 'released' ? 'info' : 'warning',
      summary: `release packet is ${state.status}`,
      releaseId: state.releaseId,
      commandId: state.lastCommandId
    },
    {
      eventId: 'workspace:access',
      phase: 'boundary',
      occurredAt: now,
      status: workspaceAccess.allowed ? 'allowed' : 'denied',
      severity: workspaceAccess.allowed ? 'info' : 'error',
      summary: workspaceAccess.deniedReason || (workspaceAccess.policyPresent ? 'workspace policy matched' : 'workspace policy absent'),
      releaseId: state.releaseId,
      commandId: state.lastCommandId
    },
    {
      eventId: 'acceptance:decision',
      phase: 'acceptance',
      occurredAt: acceptance.acceptedAt || now,
      status: acceptance.decision,
      severity: acceptance.accepted ? 'info' : 'warning',
      summary: acceptance.accepted ? `accepted by ${acceptance.acceptedBy || 'unknown'}` : 'acceptance pending or rejected',
      releaseId: state.releaseId,
      commandId: state.lastCommandId
    },
    ...validationEvents,
    ...auditEvents
  ];
}

function normalizeAnalyticsCounterMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([, counterValue]) => Number.isFinite(counterValue))
    .map(([key, counterValue]) => [key, Math.max(0, Math.trunc(counterValue))])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeAnalyticsHistory(input, state, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.analyticsHistory || input.analytics?.historySnapshots || input.analytics?.history
    || rawState.analyticsHistory || rawState.analytics?.historySnapshots || rawState.analytics?.history;
  const entries = Array.isArray(source)
    ? source
    : Object.entries(source && typeof source === 'object' ? source : {})
      .map(([snapshotId, snapshot]) => ({ ...(snapshot && typeof snapshot === 'object' ? snapshot : {}), snapshotId }));

  return entries.map((snapshot, index) => {
    const counters = normalizeAnalyticsCounterMap(snapshot.counters || snapshot.analyticsCounters);
    const releaseId = cleanToken(snapshot.releaseId, state.releaseId);
    const tenantId = cleanToken(snapshot.tenantId, state.tenantId);
    const workspaceId = cleanToken(snapshot.workspaceId, state.workspaceId);
    const revision = Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 ? snapshot.revision : null;
    const capturedAt = normalizeIsoTimestamp(snapshot.capturedAt || snapshot.generatedAt || snapshot.observedAt) || now;
    return {
      snapshotId: cleanToken(snapshot.snapshotId || snapshot.id, `analytics-history:${index + 1}`),
      source: cleanToken(snapshot.source, 'analytics_history'),
      releaseId,
      tenantId,
      workspaceId,
      status: RELEASE_STATUSES.has(snapshot.status) ? snapshot.status : null,
      revision,
      capturedAt,
      counters,
      counterCount: Object.keys(counters).length,
      digest: cleanToken(snapshot.digest, null) || proofDigest({
        releaseId,
        tenantId,
        workspaceId,
        revision,
        capturedAt,
        counters
      })
    };
  })
    .filter((snapshot) => snapshot.releaseId === state.releaseId
      && snapshot.tenantId === state.tenantId
      && snapshot.workspaceId === state.workspaceId
      && snapshot.counterCount > 0)
    .sort((left, right) => {
      const leftRevision = left.revision === null ? -1 : left.revision;
      const rightRevision = right.revision === null ? -1 : right.revision;
      if (leftRevision !== rightRevision) {
        return leftRevision - rightRevision;
      }
      return Date.parse(left.capturedAt) - Date.parse(right.capturedAt);
    })
    .slice(-MAX_ANALYTICS_HISTORY);
}

function buildAnalyticsCounterTrends(counters, previousSnapshot) {
  const previousCounters = previousSnapshot ? previousSnapshot.counters : {};
  const metricNames = [...new Set([...Object.keys(previousCounters), ...Object.keys(counters)])].sort();
  return metricNames.map((metric) => {
    const value = counters[metric] || 0;
    const previousValue = previousCounters[metric] || 0;
    const delta = value - previousValue;
    return {
      metric,
      value,
      previousValue,
      delta,
      direction: delta > 0 ? 'increased' : (delta < 0 ? 'decreased' : 'unchanged')
    };
  });
}

function summarizeTimelineForExport(timeline) {
  const ordered = [...timeline].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  return {
    eventCount: timeline.length,
    errorCount: timeline.filter((event) => event.severity === 'error').length,
    warningCount: timeline.filter((event) => event.severity === 'warning').length,
    firstEventAt: ordered[0]?.occurredAt || null,
    lastEventAt: ordered[ordered.length - 1]?.occurredAt || null,
    phases: [...new Set(timeline.map((event) => event.phase))].sort()
  };
}

function normalizeAnalyticsExportSinks(input, state, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.analyticsExportSinks || input.analytics?.exportSinks || input.analyticsExport?.sinks
    || rawState.analyticsExportSinks || rawState.analytics?.exportSinks || rawState.analyticsExport?.sinks;
  const sinkEntries = Array.isArray(source)
    ? source
    : Object.entries(source && typeof source === 'object' ? source : {})
      .map(([sinkId, sink]) => ({ ...(sink && typeof sink === 'object' ? sink : {}), sinkId }));
  const defaultSink = sinkEntries.length > 0 ? [] : [{
    sinkId: 'release-packet-analytics-summary',
    sinkType: 'object-store',
    endpoint: `${state.tenantId}/${state.workspaceId}/${state.releaseId}/analytics-summary.json`,
    format: 'json',
    required: true
  }];

  return [...sinkEntries, ...defaultSink].map((sink, index) => {
    const tenantId = cleanToken(sink.tenantId, null);
    const workspaceId = cleanToken(sink.workspaceId, null);
    const tenantScoped = scopedValueMatches(tenantId, state.tenantId);
    const workspaceScoped = scopedValueMatches(workspaceId, state.workspaceId);
    const enabled = sink.enabled === false || sink.status === 'disabled' ? false : true;
    const sinkType = cleanToken(sink.sinkType || sink.type || sink.kind, 'object-store');
    const lastExportedAt = normalizeIsoTimestamp(sink.lastExportedAt || sink.lastSyncedAt || sink.updatedAt);
    const minimumIntervalSeconds = normalizeNonNegativeInteger(sink.minimumIntervalSeconds || sink.minIntervalSeconds, 0);
    const nextEligibleExportAt = lastExportedAt && minimumIntervalSeconds > 0
      ? addSeconds(lastExportedAt, minimumIntervalSeconds)
      : null;
    const due = !nextEligibleExportAt || Date.parse(nextEligibleExportAt) <= Date.parse(now);
    const blockedReasons = [
      ...(enabled ? [] : ['analytics_export_sink_disabled']),
      ...(tenantScoped && workspaceScoped ? [] : ['analytics_export_sink_outside_workspace_boundary']),
      ...(due ? [] : ['analytics_export_interval_not_elapsed'])
    ];
    return {
      sinkId: cleanToken(sink.sinkId || sink.id || sink.name, `analytics-sink-${index + 1}`),
      sinkType,
      endpoint: cleanToken(sink.endpoint || sink.route || sink.storageKey || sink.url, null),
      format: cleanToken(sink.format || sink.contentType, sinkType === 'warehouse' ? 'jsonl' : 'json'),
      required: sink.required !== false,
      enabled,
      tenantId,
      workspaceId,
      tenantScoped,
      workspaceScoped,
      lastExportedAt,
      minimumIntervalSeconds,
      nextEligibleExportAt,
      due,
      blockedReasons,
      ready: blockedReasons.length === 0,
      observedAt: normalizeIsoTimestamp(sink.observedAt || sink.updatedAt) || now
    };
  });
}

function buildAnalyticsExportBatch({ state, commandResult, clientWorkflowHandoff, counters, trends, historyWindow, timeline, now }) {
  const currentSnapshot = historyWindow[historyWindow.length - 1] || null;
  const previousSnapshot = historyWindow.length > 1 ? historyWindow[historyWindow.length - 2] : null;
  const timelineSummary = summarizeTimelineForExport(timeline);
  const metricRows = trends.map((trend) => ({
    rowType: 'counter',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    command: commandResult.command,
    commandId: state.lastCommandId,
    metric: trend.metric,
    value: trend.value,
    previousValue: trend.previousValue,
    delta: trend.delta,
    direction: trend.direction,
    capturedAt: now
  }));
  return {
    schemaVersion: 1,
    exportType: 'release-packet-analytics-export-batch',
    batchId: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      counters,
      timelineSummary
    }),
    partitionKey: `${state.tenantId}:${state.workspaceId}`,
    storagePrefix: `${state.tenantId}/${state.workspaceId}/${state.releaseId}/analytics`,
    appendOnly: true,
    currentSnapshotId: currentSnapshot?.snapshotId || null,
    previousSnapshotId: previousSnapshot?.snapshotId || null,
    historyWindowSize: historyWindow.length,
    timelineSummary,
    workflowState: clientWorkflowHandoff.workflowState,
    rows: metricRows,
    rowCount: metricRows.length,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      metricRows,
      currentSnapshotId: currentSnapshot?.snapshotId || null,
      previousSnapshotId: previousSnapshot?.snapshotId || null,
      timelineSummary
    })
  };
}

function buildAnalyticsExportReadiness({ state, exportSinks, exportBatch, historyWindow, timeline, counterTrends, now }) {
  const requiredBlockedSinks = exportSinks.filter((sink) => sink.required && !sink.ready);
  const optionalBlockedSinks = exportSinks.filter((sink) => !sink.required && !sink.ready);
  const readySinks = exportSinks.filter((sink) => sink.ready);
  const currentSnapshot = historyWindow[historyWindow.length - 1] || null;
  const timelineSummary = summarizeTimelineForExport(timeline);
  const blockedReasons = [
    ...(currentSnapshot ? [] : ['analytics_snapshot_missing']),
    ...(exportBatch.rowCount > 0 ? [] : ['analytics_export_rows_empty']),
    ...(timelineSummary.eventCount > 0 ? [] : ['analytics_timeline_empty']),
    ...(requiredBlockedSinks.length > 0 ? ['required_analytics_export_sink_blocked'] : [])
  ];
  const sinkPlans = exportSinks.map((sink) => ({
    sinkId: sink.sinkId,
    sinkType: sink.sinkType,
    endpoint: sink.endpoint,
    format: sink.format,
    required: sink.required,
    ready: sink.ready,
    due: sink.due,
    blockedReasons: sink.blockedReasons,
    batchId: exportBatch.batchId,
    rowCount: sink.ready ? exportBatch.rowCount : 0,
    partitionKey: exportBatch.partitionKey,
    storagePrefix: exportBatch.storagePrefix,
    nextEligibleExportAt: sink.nextEligibleExportAt
  }));
  const nextExportAtCandidates = exportSinks
    .filter((sink) => !sink.ready && sink.nextEligibleExportAt)
    .map((sink) => sink.nextEligibleExportAt)
    .sort();

  return {
    schemaVersion: 1,
    readinessType: 'release-packet-analytics-export-readiness',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    ready: blockedReasons.length === 0,
    blockedReasons,
    readySinkCount: readySinks.length,
    requiredSinkCount: exportSinks.filter((sink) => sink.required).length,
    requiredBlockedSinkCount: requiredBlockedSinks.length,
    optionalBlockedSinkCount: optionalBlockedSinks.length,
    rowCount: exportBatch.rowCount,
    historyWindowSize: historyWindow.length,
    currentSnapshotId: currentSnapshot?.snapshotId || null,
    timelineSummary,
    materialDeltaCount: counterTrends.filter((trend) => trend.delta !== 0).length,
    nextExportAt: nextExportAtCandidates[0] || null,
    sinkPlans,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      blockedReasons,
      sinkPlans,
      exportBatchDigest: exportBatch.digest,
      currentSnapshotId: currentSnapshot?.snapshotId || null,
      timelineSummary
    })
  };
}

function buildAnalyticsReport({ input, state, recoveredState, claims, gateReport, acceptance, validationSummary, validationIssueSummary, readiness, stateHealth, boundaryEvidence, operationalHealth, providerContracts, workspaceAccess, releaseBoundaryPolicy, lifecycleControlPlan, acceptanceControl, clientRuntimeAdoption, commandResult, clientWorkflowHandoff, audit, now }) {
  const historySnapshots = buildHistorySnapshots({
    recoveredState,
    currentState: state,
    gateReport,
    validationSummary,
    acceptance,
    commandResult,
    now
  });
  const timeline = buildReportingTimeline({
    state,
    audit,
    validationSummary,
    readiness,
    acceptance,
    workspaceAccess,
    now
  });
  const exportSinks = normalizeAnalyticsExportSinks(input, state, now);
  const counters = {
    claimTotal: gateReport.requiredClaimCount,
    claimScoped: gateReport.scopedClaimCount,
    claimVerified: gateReport.verifiedClaimCount,
    claimMissing: gateReport.missing.length,
    claimOutOfScope: gateReport.outOfScopeClaimCount,
    validationPassed: validationSummary.checks.filter((check) => check.status === 'passed').length,
    validationPending: validationSummary.pendingCount,
    validationFailed: validationSummary.failedCount,
    validationIssues: validationIssueSummary.issueCount,
    validationBlockingIssues: validationIssueSummary.blockingIssueCount,
    validationWaitingIssues: validationIssueSummary.waitingIssueCount,
    validationIssueCategories: validationIssueSummary.categories.length,
    auditEvents: audit.length,
    auditErrors: timeline.filter((event) => event.phase === 'audit' && event.severity === 'error').length,
    commandLedgerEntries: state.commandLedger.length,
    historySnapshots: historySnapshots.length,
    readinessScore: readiness.readinessScore,
    readinessMaxScore: readiness.readinessMaxScore,
    workspacePoliciesEvaluated: workspaceAccess.policyPresent ? 1 : 0,
    workspaceDenials: workspaceAccess.allowed ? 0 : 1,
    boundaryIsolationFaults: boundaryEvidence.isolationFaultCount,
    boundaryHandoffUnsafe: boundaryEvidence.handoffSafe ? 0 : 1,
    boundaryProviderMismatches: boundaryEvidence.providerBoundaryMismatches.length,
    restartResumeAvailable: state.restartResumeContract?.resumeAvailable ? 1 : 0,
    restartResumeReplayProtected: state.restartResumeContract?.replayProtected ? 1 : 0,
    restartCheckpointUsable: state.recoveryCheckpoint?.usable ? 1 : 0,
    restartCheckpointBlockedReasons: state.recoveryCheckpoint?.blockedReasons.length || 0,
    releaseBoundaryPoliciesEvaluated: releaseBoundaryPolicy.policyPresent ? 1 : 0,
    releaseBoundaryDenials: releaseBoundaryPolicy.allowed ? 0 : 1,
    releaseBoundaryRouteDenials: releaseBoundaryPolicy.routeAllowed ? 0 : 1,
    releaseBoundaryHandoffDenials: releaseBoundaryPolicy.handoffTargetAllowed ? 0 : 1,
    releaseBoundaryDutyConflicts: releaseBoundaryPolicy.acceptanceActorConflict && !releaseBoundaryPolicy.selfApprovalOverride ? 1 : 0,
    lifecycleEnabled: state.lifecycleSettings.enabled ? 1 : 0,
    lifecycleScheduleBlocked: state.lifecycleSettings.releaseWindowOpen ? 0 : 1,
    lifecycleSettingsInvalid: state.lifecycleSettings.scheduleInvalid ? 1 : 0,
    lifecycleScheduleRejected: state.lifecycleSettings.scheduleRejected ? 1 : 0,
    lifecycleScheduleControlViolations: state.lifecycleSettings.scheduleControls.violations.length,
    lifecycleBlackoutWindows: state.lifecycleSettings.scheduleControls.blackoutWindowCount,
    lifecycleBlockingBlackoutWindows: state.lifecycleSettings.scheduleControls.blockingBlackoutWindowIds.length,
    lifecycleCommandBlocked: lifecycleControlPlan.commandControl && !lifecycleControlPlan.commandControl.allowed ? 1 : 0,
    lifecycleControlOptions: lifecycleControlPlan.commandControls.length,
    lifecycleControlsAvailable: lifecycleControlPlan.commandControls.filter((control) => control.allowed).length,
    lifecycleExecutionReady: lifecycleControlPlan.executionPlan.executionState === 'ready' ? 1 : 0,
    lifecycleExecutionWaiting: lifecycleControlPlan.executionPlan.executionState === 'waiting_for_schedule' ? 1 : 0,
    lifecycleExecutionBlocked: lifecycleControlPlan.executionPlan.executionState === 'blocked' ? 1 : 0,
    lifecycleRunnableCommands: lifecycleControlPlan.executionPlan.runnableCommandCount,
    lifecycleWaitingCommands: lifecycleControlPlan.executionPlan.waitingCommandCount,
    lifecycleBlockedCommands: lifecycleControlPlan.executionPlan.blockedCommandCount,
    lifecycleSettingsMutationRequired: lifecycleControlPlan.executionPlan.settingsMutationRequired ? 1 : 0,
    clientHandoffBlocked: clientWorkflowHandoff.canContinue ? 0 : 1,
    clientRefreshRequired: clientWorkflowHandoff.refreshPolicy.shouldRefresh ? 1 : 0,
    clientRuntimeCommandBlocks: clientRuntimeAdoption.commandBlocked ? 1 : 0,
    clientRuntimeRevisionAcknowledged: clientRuntimeAdoption.revision.revisionAcknowledged ? 1 : 0,
    clientRuntimeHandoffDigestMatched: clientRuntimeAdoption.handoffProof.matched ? 1 : 0,
    operationalComponents: operationalHealth.componentCount,
    operationalProviderDerivedComponents: operationalHealth.providerDerivedComponentCount,
    operationalBlockingComponents: operationalHealth.blockingComponentCount,
    operationalDegradedComponents: operationalHealth.degradedComponentCount,
    operationalCommandBlocks: operationalHealth.commandBlocked ? 1 : 0,
    degradedModeEnabled: operationalHealth.degradedModeEnabled ? 1 : 0,
    degradedModeAcknowledged: operationalHealth.degradedModeAcknowledged ? 1 : 0,
    operationalRetryableComponents: operationalHealth.retryPlan.retryableComponentCount,
    operationalRetryBudgetExhausted: operationalHealth.retryPlan.exhaustedComponentCount,
    operationalEscalationsRequired: operationalHealth.retryPlan.escalationRequired ? 1 : 0,
    providerContracts: providerContracts.providerCount,
    providerContractsActive: providerContracts.activeProviderCount,
    providerContractsIncompatible: providerContracts.incompatibleProviderCount,
    providerContractsStale: providerContracts.staleProviderCount,
    providerContractCommandBlocks: providerContracts.commandBlocked ? 1 : 0,
    providerCapabilitiesMissing: providerContracts.missingRequiredCapabilities.length,
    providerServiceTypesActive: providerContracts.activeServiceTypes.length,
    providerServiceTypesMissing: providerContracts.missingRequiredServiceTypes.length,
    providerServicesStale: providerContracts.staleProviderServices.length,
    providerServiceProtocolsIncompatible: providerContracts.incompatibleProviderServices.length,
    externalHandoffAccepted: providerContracts.handoffAccepted ? 1 : 0,
    externalHandoffRequired: providerContracts.externalHandoffContract.required ? 1 : 0,
    externalHandoffReadyCandidates: providerContracts.externalHandoffContract.readyCandidateCount,
    externalHandoffBlockedReasons: providerContracts.externalHandoffContract.blockedReasons.length,
    externalHandoffTargetMismatches: providerContracts.externalHandoffContract.targetMismatchCandidateCount,
    externalHandoffStaleCandidates: providerContracts.externalHandoffContract.staleCandidateCount,
    acceptanceBoundToPreview: acceptanceControl.acceptanceBoundToPreview ? 1 : 0,
    acceptancePreviewDigestMatched: acceptanceControl.previewDigestBinding.matched ? 1 : 0,
    acceptancePreviewDigestRequired: acceptanceControl.previewDigestBinding.required ? 1 : 0,
    acceptancePreviewDigestMissing: acceptanceControl.previewDigestBinding.state === 'missing' ? 1 : 0,
    acceptancePreviewDigestStale: acceptanceControl.previewDigestBinding.state === 'stale_or_mismatched' ? 1 : 0,
    acceptanceRuntimeDigestMatched: acceptanceControl.clientRuntimeAdoptionDigestBinding.matched ? 1 : 0,
    acceptanceMissingFields: acceptanceControl.missingFields.length,
    acceptanceControlDisabledReasons: acceptanceControl.disabledReasons.length,
    analyticsExportSinks: exportSinks.length,
    analyticsExportSinksReady: exportSinks.filter((sink) => sink.ready).length,
    analyticsExportSinksRequired: exportSinks.filter((sink) => sink.required).length,
    analyticsExportSinksBlocked: exportSinks.filter((sink) => !sink.ready).length,
    analyticsTimelineEvents: timeline.length,
    analyticsTimelineErrors: timeline.filter((event) => event.severity === 'error').length,
    analyticsTimelineWarnings: timeline.filter((event) => event.severity === 'warning').length,
    recoveryReasons: stateHealth.recoveryReasons.length
  };
  const persistedAnalyticsHistory = normalizeAnalyticsHistory(input, state, now);
  const analyticsSnapshot = {
    snapshotId: `analytics:${state.revision}:${commandResult.command}`,
    source: 'current_analytics',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    status: state.status,
    revision: state.revision,
    command: commandResult.command,
    commandId: state.lastCommandId,
    capturedAt: now,
    counters,
    counterCount: Object.keys(counters).length,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      command: commandResult.command,
      counters
    })
  };
  const analyticsHistoryWindow = [...persistedAnalyticsHistory, analyticsSnapshot].slice(-MAX_ANALYTICS_HISTORY);
  const previousAnalyticsSnapshot = analyticsHistoryWindow.length > 1
    ? analyticsHistoryWindow[analyticsHistoryWindow.length - 2]
    : null;
  const counterTrends = buildAnalyticsCounterTrends(counters, previousAnalyticsSnapshot);
  const trendSummary = {
    comparedToSnapshotId: previousAnalyticsSnapshot?.snapshotId || null,
    comparedToRevision: previousAnalyticsSnapshot?.revision ?? null,
    increasedCount: counterTrends.filter((trend) => trend.direction === 'increased').length,
    decreasedCount: counterTrends.filter((trend) => trend.direction === 'decreased').length,
    unchangedCount: counterTrends.filter((trend) => trend.direction === 'unchanged').length,
    materialDeltas: counterTrends
      .filter((trend) => trend.delta !== 0)
      .slice(0, 25)
  };
  const exportBatch = buildAnalyticsExportBatch({
    state,
    commandResult,
    clientWorkflowHandoff,
    counters,
    trends: counterTrends,
    historyWindow: analyticsHistoryWindow,
    timeline,
    now
  });
  const exportReadiness = buildAnalyticsExportReadiness({
    state,
    exportSinks,
    exportBatch,
    historyWindow: analyticsHistoryWindow,
    timeline,
    counterTrends,
    now
  });
  const exportSummary = {
    schemaVersion: 1,
    exportType: 'release-packet-analytics-summary',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    status: state.status,
    revision: state.revision,
    readyForRelease: validationSummary.readyForRelease,
    canSubmitRelease: readiness.canSubmitRelease,
    accepted: acceptance.accepted,
    command: commandResult.command,
    commandId: state.lastCommandId,
    generatedAt: now,
    clientWorkflow: {
      requestId: clientWorkflowHandoff.requestId,
      workflowState: clientWorkflowHandoff.workflowState,
      primaryAction: clientWorkflowHandoff.primaryAction.action,
      canContinue: clientWorkflowHandoff.canContinue,
      digest: clientWorkflowHandoff.correlation.digest
    },
    validationIssues: {
      issueCount: validationIssueSummary.issueCount,
      blockingIssueCount: validationIssueSummary.blockingIssueCount,
      waitingIssueCount: validationIssueSummary.waitingIssueCount,
      categories: validationIssueSummary.categories,
      primaryIssue: validationIssueSummary.primaryIssue,
      topIssues: validationIssueSummary.topIssues,
      digest: validationIssueSummary.digest
    },
    clientRuntimeAdoption: {
      commandBlocked: clientRuntimeAdoption.commandBlocked,
      blockedReasons: clientRuntimeAdoption.blockedReasons,
      serverRevision: clientRuntimeAdoption.revision.serverRevision,
      clientAcknowledgedRevision: clientRuntimeAdoption.revision.clientAcknowledgedRevision,
      handoffDigestMatched: clientRuntimeAdoption.handoffProof.matched,
      digest: clientRuntimeAdoption.digest
    },
    operationalHealth: {
      status: operationalHealth.status,
      commandBlocked: operationalHealth.commandBlocked,
      retryAfter: operationalHealth.retryAfter,
      blockedReasons: operationalHealth.failureState.blockedReasons,
      providerDerivedComponentCount: operationalHealth.providerDerivedComponentCount,
      retryableComponentCount: operationalHealth.retryPlan.retryableComponentCount,
      exhaustedComponentCount: operationalHealth.retryPlan.exhaustedComponentCount,
      escalationRequired: operationalHealth.retryPlan.escalationRequired,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      digest: operationalHealth.digest
    },
    providerContracts: {
      commandBlocked: providerContracts.commandBlocked,
      blockedReasons: providerContracts.blockedReasons,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      activeServiceTypes: providerContracts.activeServiceTypes,
      incompatibleProviderCount: providerContracts.incompatibleProviderCount,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServiceCount: providerContracts.staleProviderServices.length,
      incompatibleProviderServiceCount: providerContracts.incompatibleProviderServices.length,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffContract: providerContracts.externalHandoffContract,
      digest: providerContracts.digest
    },
    lifecycleControls: {
      commandEffect: lifecycleControlPlan.commandEffect,
      lifecycleBlocked: lifecycleControlPlan.lifecycleBlocked,
      nextAction: lifecycleControlPlan.nextActionState.action,
      executionState: lifecycleControlPlan.executionPlan.executionState,
      nextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
      waitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
      executionPlanDigest: lifecycleControlPlan.executionPlan.digest,
      scheduleState: lifecycleControlPlan.schedule.state,
      scheduleRejectedReasons: lifecycleControlPlan.schedule.rejectedReasons,
      nextSchedulableReleaseAt: lifecycleControlPlan.schedule.nextSchedulableReleaseAt,
      digest: lifecycleControlPlan.digest
    },
    acceptanceControl: {
      controlState: acceptanceControl.controlState,
      acceptanceBoundToPreview: acceptanceControl.acceptanceBoundToPreview,
      previewDigest: acceptanceControl.previewDigest,
      echoedPreviewDigest: acceptanceControl.echoedPreviewDigest,
      previewDigestBinding: acceptanceControl.previewDigestBinding,
      clientRuntimeAdoptionDigestBinding: acceptanceControl.clientRuntimeAdoptionDigestBinding,
      nextAction: acceptanceControl.nextAction,
      digest: acceptanceControl.digest
    },
    boundaryEvidence: {
      handoffSafe: boundaryEvidence.handoffSafe,
      isolationFaults: boundaryEvidence.isolationFaults,
      auditScope: boundaryEvidence.auditScope,
      digest: boundaryEvidence.digest
    },
    restartRecovery: {
      restartStatus: state.restartStatus,
      resumeAvailable: state.restartResumeContract?.resumeAvailable || false,
      recoveryStatus: state.restartResumeContract?.recoveryStatus || 'clear',
      checkpointDigest: state.recoveryCheckpoint?.digest || null,
      restartResumeDigest: state.restartResumeContract?.digest || null
    },
    analyticsHistory: {
      currentSnapshotId: analyticsSnapshot.snapshotId,
      previousSnapshotId: previousAnalyticsSnapshot?.snapshotId || null,
      windowSize: analyticsHistoryWindow.length,
      persistedSnapshotCount: persistedAnalyticsHistory.length,
      trendSummary,
      exportBatchDigest: exportBatch.digest,
      exportReadinessDigest: exportReadiness.digest
    },
    exportReadiness: {
      ready: exportReadiness.ready,
      blockedReasons: exportReadiness.blockedReasons,
      readySinkCount: exportReadiness.readySinkCount,
      requiredSinkCount: exportReadiness.requiredSinkCount,
      requiredBlockedSinkCount: exportReadiness.requiredBlockedSinkCount,
      optionalBlockedSinkCount: exportReadiness.optionalBlockedSinkCount,
      rowCount: exportReadiness.rowCount,
      nextExportAt: exportReadiness.nextExportAt,
      sinkPlans: exportReadiness.sinkPlans,
      digest: exportReadiness.digest
    },
    counters,
    claimGateBreakdown: claims.map((claim) => ({
      claimId: claim.claimId,
      gate: claim.gate,
      status: claim.tenantScoped && claim.workspaceScoped ? (claim.verified ? 'verified' : 'missing') : 'out_of_scope',
      verifier: claim.verifier,
      evidenceDigest: claim.evidenceDigest
    })),
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      counters,
      clientWorkflowDigest: clientWorkflowHandoff.correlation.digest,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
      lifecycleControlDigest: lifecycleControlPlan.digest,
      boundaryEvidenceDigest: boundaryEvidence.digest,
      validationIssueSummaryDigest: validationIssueSummary.digest,
      historySnapshots,
      analyticsHistoryWindow,
      counterTrends,
      exportBatchDigest: exportBatch.digest,
      exportReadinessDigest: exportReadiness.digest,
      timeline
    })
  };
  return {
    schemaVersion: 1,
    counters,
    historySnapshots,
    analyticsSnapshot,
    analyticsHistoryWindow,
    counterTrends,
    trendSummary,
    timeline,
    exportSinks,
    exportBatch,
    exportReadiness,
    exportSummary
  };
}

function buildArtifactDescriptor({ state, artifactType, payload, storageKey, route, required = true, retentionClass = 'release-record' }) {
  const produced = payload !== null && payload !== undefined;
  return {
    artifactId: `${state.releaseId}:${artifactType}`,
    artifactType,
    schemaVersion: payload && typeof payload === 'object' && Number.isSafeInteger(payload.schemaVersion)
      ? payload.schemaVersion
      : 1,
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    storageKey,
    route,
    required,
    produced,
    retentionClass,
    digest: produced ? proofDigest({
      artifactType,
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      payload
    }) : null
  };
}

function normalizeBundleArtifactEntries(value) {
  if (Array.isArray(value)) {
    return value.filter((artifact) => artifact && typeof artifact === 'object');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([artifactType, artifact]) => ({
      ...(artifact && typeof artifact === 'object' ? artifact : {}),
      artifactType
    }));
  }
  return [];
}

function normalizeArtifactBundleScope(source, state) {
  const tenantId = cleanToken(source?.tenantId, null);
  const workspaceId = cleanToken(source?.workspaceId, null);
  const releaseId = cleanToken(source?.releaseId, null);
  const revision = Number.isSafeInteger(source?.revision)
    ? source.revision
    : (Number.isSafeInteger(source?.stateRevision) ? source.stateRevision : null);
  const tenantScoped = scopedValueMatches(tenantId, state.tenantId);
  const workspaceScoped = scopedValueMatches(workspaceId, state.workspaceId);
  const releaseScoped = scopedValueMatches(releaseId, state.releaseId);
  const revisionCurrent = revision === null || revision >= state.revision;
  return {
    tenantId,
    workspaceId,
    releaseId,
    revision,
    tenantScoped,
    workspaceScoped,
    releaseScoped,
    revisionCurrent,
    expectedTenantId: state.tenantId,
    expectedWorkspaceId: state.workspaceId,
    expectedReleaseId: state.releaseId,
    expectedMinimumRevision: state.revision,
    blockedReasons: [
      ...(tenantScoped ? [] : ['artifact_bundle_tenant_mismatch']),
      ...(workspaceScoped ? [] : ['artifact_bundle_workspace_mismatch']),
      ...(releaseScoped ? [] : ['artifact_bundle_release_mismatch']),
      ...(revisionCurrent ? [] : ['artifact_bundle_revision_stale'])
    ]
  };
}

function findDuplicateTokens(tokens) {
  const seen = new Set();
  const duplicates = new Set();
  for (const token of tokens) {
    if (seen.has(token)) {
      duplicates.add(token);
    } else {
      seen.add(token);
    }
  }
  return [...duplicates].sort();
}

function normalizeArtifactBundleAttestation(input, state, artifacts, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.artifactBundle && typeof input.artifactBundle === 'object'
    ? input.artifactBundle
    : (input.releaseArtifactBundle && typeof input.releaseArtifactBundle === 'object'
      ? input.releaseArtifactBundle
      : (rawState.artifactBundle && typeof rawState.artifactBundle === 'object' ? rawState.artifactBundle : null));
  const bundleScope = normalizeArtifactBundleScope(source, state);
  const expectedByType = new Map(artifacts.map((artifact) => [artifact.artifactType, artifact]));
  const declaredArtifacts = normalizeBundleArtifactEntries(source?.artifacts || source?.manifest || source?.entries)
    .map((entry, index) => {
      const artifactType = cleanToken(entry.artifactType || entry.type || entry.name, `bundle-artifact-${index + 1}`);
      const expected = expectedByType.get(artifactType) || null;
      const digest = cleanToken(entry.digest || entry.proofDigest || entry.hash, null);
      const storageKey = cleanToken(entry.storageKey || entry.path || entry.uri, null);
      const declaredTenantId = cleanToken(entry.tenantId, null);
      const declaredWorkspaceId = cleanToken(entry.workspaceId, null);
      const declaredReleaseId = cleanToken(entry.releaseId, null);
      const declaredRevision = Number.isSafeInteger(entry.revision)
        ? entry.revision
        : (Number.isSafeInteger(entry.stateRevision) ? entry.stateRevision : null);
      return {
        artifactType,
        storageKey,
        digest,
        tenantId: declaredTenantId,
        workspaceId: declaredWorkspaceId,
        releaseId: declaredReleaseId,
        revision: declaredRevision,
        expectedDigest: expected?.digest || null,
        expectedStorageKey: expected?.storageKey || null,
        required: expected ? expected.required : false,
        knownArtifact: expected !== null,
        digestMatches: expected ? digest === expected.digest : false,
        storageKeyMatches: expected ? storageKey === expected.storageKey : false,
        digestPresent: digest !== null,
        storageKeyPresent: storageKey !== null,
        tenantScoped: scopedValueMatches(declaredTenantId, state.tenantId),
        workspaceScoped: scopedValueMatches(declaredWorkspaceId, state.workspaceId),
        releaseScoped: scopedValueMatches(declaredReleaseId, state.releaseId),
        revisionCurrent: declaredRevision === null || declaredRevision >= state.revision
      };
    });
  const declaredTypes = declaredArtifacts.map((artifact) => artifact.artifactType);
  const duplicateArtifactTypes = findDuplicateTokens(declaredTypes);
  const missingRequiredArtifacts = artifacts
    .filter((artifact) => artifact.required && !declaredTypes.includes(artifact.artifactType))
    .map((artifact) => artifact.artifactType);
  const digestMismatches = declaredArtifacts
    .filter((artifact) => artifact.knownArtifact && !artifact.digestMatches)
    .map((artifact) => artifact.artifactType);
  const storageMismatches = declaredArtifacts
    .filter((artifact) => artifact.knownArtifact && !artifact.storageKeyMatches)
    .map((artifact) => artifact.artifactType);
  const unknownArtifacts = declaredArtifacts
    .filter((artifact) => !artifact.knownArtifact)
    .map((artifact) => artifact.artifactType);
  const digestlessDeclaredArtifacts = declaredArtifacts
    .filter((artifact) => !artifact.digestPresent)
    .map((artifact) => artifact.artifactType);
  const storageKeylessDeclaredArtifacts = declaredArtifacts
    .filter((artifact) => !artifact.storageKeyPresent)
    .map((artifact) => artifact.artifactType);
  const outOfScopeDeclaredArtifacts = declaredArtifacts
    .filter((artifact) => !artifact.tenantScoped || !artifact.workspaceScoped || !artifact.releaseScoped)
    .map((artifact) => ({
      artifactType: artifact.artifactType,
      tenantId: artifact.tenantId,
      workspaceId: artifact.workspaceId,
      releaseId: artifact.releaseId,
      tenantScoped: artifact.tenantScoped,
      workspaceScoped: artifact.workspaceScoped,
      releaseScoped: artifact.releaseScoped
    }));
  const staleDeclaredArtifacts = declaredArtifacts
    .filter((artifact) => !artifact.revisionCurrent)
    .map((artifact) => ({
      artifactType: artifact.artifactType,
      revision: artifact.revision,
      expectedMinimumRevision: state.revision
    }));
  const present = source !== null;
  const blockedReasons = [
    ...(present ? [] : ['artifact_bundle_attestation_missing']),
    ...bundleScope.blockedReasons,
    ...(missingRequiredArtifacts.length > 0 ? ['artifact_bundle_missing_required_artifacts'] : []),
    ...(duplicateArtifactTypes.length > 0 ? ['artifact_bundle_duplicate_artifacts'] : []),
    ...(digestlessDeclaredArtifacts.length > 0 ? ['artifact_bundle_artifact_digest_missing'] : []),
    ...(storageKeylessDeclaredArtifacts.length > 0 ? ['artifact_bundle_artifact_storage_key_missing'] : []),
    ...(outOfScopeDeclaredArtifacts.length > 0 ? ['artifact_bundle_artifact_outside_workspace_boundary'] : []),
    ...(staleDeclaredArtifacts.length > 0 ? ['artifact_bundle_artifact_revision_stale'] : []),
    ...(digestMismatches.length > 0 ? ['artifact_bundle_digest_mismatch'] : []),
    ...(storageMismatches.length > 0 ? ['artifact_bundle_storage_key_mismatch'] : []),
    ...(unknownArtifacts.length > 0 ? ['artifact_bundle_contains_unknown_artifacts'] : [])
  ];

  return {
    schemaVersion: 1,
    contractType: 'release-artifact-bundle-attestation',
    bundleId: cleanToken(source?.bundleId || source?.id, `${state.releaseId}:artifact-bundle`),
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    present,
    ready: present && blockedReasons.length === 0,
    bundleScope,
    declaredArtifactCount: declaredArtifacts.length,
    expectedArtifactCount: artifacts.length,
    missingRequiredArtifacts,
    duplicateArtifactTypes,
    digestlessDeclaredArtifacts,
    storageKeylessDeclaredArtifacts,
    outOfScopeDeclaredArtifacts,
    staleDeclaredArtifacts,
    digestMismatches,
    storageMismatches,
    unknownArtifacts,
    blockedReasons,
    declaredArtifacts,
    submittedBy: cleanToken(source?.submittedBy || source?.actorId, null),
    submittedAt: normalizeIsoTimestamp(source?.submittedAt || source?.createdAt) || null,
    observedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      bundleScope,
      declaredArtifacts,
      blockedReasons
    })
  };
}

function buildHumanReviewContract({ input, state, actor, boundary, releaseBoundaryPolicy, acceptance, validationSummary, readiness, bundleAttestation, now }) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.humanReview && typeof input.humanReview === 'object'
    ? input.humanReview
    : (input.releaseReview && typeof input.releaseReview === 'object'
      ? input.releaseReview
      : (rawState.humanReview && typeof rawState.humanReview === 'object' ? rawState.humanReview : {}));
  const decision = cleanToken(source.decision || input.reviewDecision, 'pending');
  const reviewedBy = cleanToken(source.reviewedBy || source.actorId || input.reviewedBy, null);
  const reviewedAt = normalizeIsoTimestamp(source.reviewedAt || input.reviewedAt);
  const reviewTenantId = cleanToken(source.tenantId || source.reviewTenantId || input.reviewTenantId, null);
  const reviewWorkspaceId = cleanToken(source.workspaceId || source.reviewWorkspaceId || input.reviewWorkspaceId, null);
  const reviewReleaseId = cleanToken(source.releaseId || source.reviewReleaseId || input.reviewReleaseId, null);
  const reviewerRoles = normalizeRoles(source.reviewerRoles || source.roles || input.reviewerRoles);
  const reviewerIsRequestActor = reviewedBy !== null && reviewedBy === actor.actorId;
  const effectiveReviewerRoles = reviewerRoles.length > 0 || !reviewerIsRequestActor
    ? reviewerRoles
    : actor.roles;
  const tenantScoped = scopedValueMatches(reviewTenantId, state.tenantId);
  const workspaceScoped = scopedValueMatches(reviewWorkspaceId, state.workspaceId);
  const releaseScoped = scopedValueMatches(reviewReleaseId, state.releaseId);
  const reviewerTenantMatches = !reviewerIsRequestActor || boundary.actorTenantMatches;
  const reviewerWorkspaceMatches = !reviewerIsRequestActor || boundary.actorWorkspaceMatches;
  const reviewerHasRole = decision !== 'approved'
    || HUMAN_REVIEW_ROLE_REQUIREMENTS.some((role) => effectiveReviewerRoles.includes(role));
  const reviewerRoleAttested = decision !== 'approved'
    || effectiveReviewerRoles.length > 0;
  const reviewBoundarySafe = tenantScoped
    && workspaceScoped
    && releaseScoped
    && reviewerTenantMatches
    && reviewerWorkspaceMatches;
  const selfReviewConflict = decision === 'approved'
    && releaseBoundaryPolicy.separationOfDutiesRequired
    && acceptance.acceptedBy !== null
    && acceptance.acceptedBy === reviewedBy;
  const selfReviewOverride = releaseBoundaryPolicy.selfApprovalOverride
    || effectiveReviewerRoles.includes('release.self-review');
  const artifactBundleDigest = cleanToken(source.artifactBundleDigest || source.bundleDigest, null);
  const validationDigest = cleanToken(source.validationDigest || source.validationSummaryDigest, null);
  const readinessDigest = cleanToken(source.readinessDigest, null);
  const expectedValidationDigest = proofDigest(validationSummary);
  const expectedReadinessDigest = proofDigest(readiness);
  const requiredInputs = [
    { field: 'humanReview.decision', expected: 'approved', satisfied: decision === 'approved' },
    { field: 'humanReview.reviewedBy', expected: 'reviewer actor id', satisfied: reviewedBy !== null },
    { field: 'humanReview.reviewedAt', expected: 'ISO-8601 timestamp', satisfied: reviewedAt !== null },
    { field: 'humanReview.reviewerRoles', expected: HUMAN_REVIEW_ROLE_REQUIREMENTS.join('|'), satisfied: reviewerHasRole && reviewerRoleAttested },
    { field: 'humanReview.tenantId', expected: state.tenantId, satisfied: tenantScoped },
    { field: 'humanReview.workspaceId', expected: state.workspaceId, satisfied: workspaceScoped },
    { field: 'humanReview.releaseId', expected: state.releaseId, satisfied: releaseScoped },
    { field: 'humanReview.artifactBundleDigest', expected: bundleAttestation.digest, satisfied: artifactBundleDigest === bundleAttestation.digest },
    { field: 'humanReview.validationDigest', expected: expectedValidationDigest, satisfied: validationDigest === null || validationDigest === expectedValidationDigest },
    { field: 'humanReview.readinessDigest', expected: expectedReadinessDigest, satisfied: readinessDigest === null || readinessDigest === expectedReadinessDigest }
  ];
  const blockedReasons = [
    ...(decision === 'approved' ? [] : ['human_review_not_approved']),
    ...(reviewedBy ? [] : ['human_reviewer_missing']),
    ...(reviewedAt ? [] : ['human_review_timestamp_missing_or_invalid']),
    ...(reviewBoundarySafe ? [] : ['human_review_outside_workspace_boundary']),
    ...(reviewerRoleAttested ? [] : ['human_review_role_attestation_missing']),
    ...(reviewerHasRole ? [] : ['human_reviewer_missing_required_role']),
    ...(!selfReviewConflict || selfReviewOverride ? [] : ['human_review_requires_separate_acceptance_actor']),
    ...(artifactBundleDigest === bundleAttestation.digest ? [] : ['human_review_artifact_bundle_digest_mismatch']),
    ...(acceptance.accepted ? [] : ['preview_acceptance_missing']),
    ...(validationSummary.failedCount === 0 ? [] : ['validation_failed']),
    ...(readiness.canSubmitRelease ? [] : ['readiness_not_submittable'])
  ];

  return {
    schemaVersion: 1,
    contractType: 'release-packet-human-review',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    decision,
    reviewedBy,
    reviewedAt,
    approved: blockedReasons.length === 0,
    reviewScope: {
      tenantId: reviewTenantId,
      workspaceId: reviewWorkspaceId,
      releaseId: reviewReleaseId,
      expectedTenantId: state.tenantId,
      expectedWorkspaceId: state.workspaceId,
      expectedReleaseId: state.releaseId,
      tenantScoped,
      workspaceScoped,
      releaseScoped,
      reviewerTenantMatches,
      reviewerWorkspaceMatches,
      boundarySafe: reviewBoundarySafe
    },
    reviewerAuthorization: {
      requiredRoles: HUMAN_REVIEW_ROLE_REQUIREMENTS,
      reviewerRoles: effectiveReviewerRoles,
      roleAttested: reviewerRoleAttested,
      hasRequiredRole: reviewerHasRole,
      reviewerIsRequestActor,
      separationOfDutiesRequired: releaseBoundaryPolicy.separationOfDutiesRequired,
      acceptanceActorConflict: selfReviewConflict,
      selfReviewOverride
    },
    artifactBundleDigest,
    expectedArtifactBundleDigest: bundleAttestation.digest,
    validationDigest,
    expectedValidationDigest,
    readinessDigest,
    expectedReadinessDigest,
    requiredInputs,
    blockedReasons,
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      decision,
      reviewedBy,
      reviewedAt,
      reviewTenantId,
      reviewWorkspaceId,
      reviewReleaseId,
      effectiveReviewerRoles,
      reviewerHasRole,
      reviewerRoleAttested,
      reviewBoundarySafe,
      selfReviewConflict,
      selfReviewOverride,
      artifactBundleDigest,
      validationDigest,
      readinessDigest,
      expectedValidationDigest,
      expectedReadinessDigest,
      blockedReasons
    })
  };
}

function normalizeHumanReviewHistory(input, state, now) {
  const rawState = input.persistedState && typeof input.persistedState === 'object' ? input.persistedState : {};
  const source = input.humanReviewHistory || input.reviewHistory || rawState.humanReviewHistory || rawState.reviewHistory;
  const entries = Array.isArray(source)
    ? source
    : Object.entries(source && typeof source === 'object' ? source : {})
      .map(([reviewId, review]) => ({ ...(review && typeof review === 'object' ? review : {}), reviewId }));

  return entries.map((review, index) => {
    const releaseId = cleanToken(review.releaseId, state.releaseId);
    const tenantId = cleanToken(review.tenantId, state.tenantId);
    const workspaceId = cleanToken(review.workspaceId, state.workspaceId);
    const decision = cleanToken(review.decision || review.status, 'pending');
    const reviewedAt = normalizeIsoTimestamp(review.reviewedAt || review.decidedAt || review.updatedAt) || now;
    const blockedReasons = normalizeTokenList(review.blockedReasons || review.rejectionReasons || review.reasons);
    return {
      reviewId: cleanToken(review.reviewId || review.id, `human-review-history:${index + 1}`),
      source: cleanToken(review.source, 'human_review_history'),
      releaseId,
      tenantId,
      workspaceId,
      revision: Number.isSafeInteger(review.revision) && review.revision >= 0 ? review.revision : null,
      decision,
      approved: decision === 'approved' && blockedReasons.length === 0,
      reviewedBy: cleanToken(review.reviewedBy || review.actorId, null),
      reviewedAt,
      blockedReasons,
      artifactBundleDigest: cleanToken(review.artifactBundleDigest || review.bundleDigest, null),
      digest: cleanToken(review.digest, null) || proofDigest({
        releaseId,
        tenantId,
        workspaceId,
        decision,
        reviewedAt,
        blockedReasons
      })
    };
  })
    .filter((review) => review.releaseId === state.releaseId
      && review.tenantId === state.tenantId
      && review.workspaceId === state.workspaceId)
    .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt))
    .slice(-MAX_ANALYTICS_HISTORY);
}

function buildHumanReviewReportingState({ input, state, bundleAttestation, humanReview, validationSummary, readiness, now }) {
  const persistedHistory = normalizeHumanReviewHistory(input, state, now);
  const currentReviewSnapshot = {
    reviewId: `human-review:${state.revision}`,
    source: 'current_human_review',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    decision: humanReview.decision,
    approved: humanReview.approved,
    reviewedBy: humanReview.reviewedBy,
    reviewedAt: humanReview.reviewedAt || now,
    blockedReasons: humanReview.blockedReasons,
    reviewScope: humanReview.reviewScope,
    reviewerAuthorization: humanReview.reviewerAuthorization,
    artifactBundleDigest: humanReview.artifactBundleDigest,
    expectedArtifactBundleDigest: humanReview.expectedArtifactBundleDigest,
    validationDigest: humanReview.validationDigest,
    readinessDigest: humanReview.readinessDigest,
    digest: humanReview.digest
  };
  const historyWindow = [...persistedHistory, currentReviewSnapshot].slice(-MAX_ANALYTICS_HISTORY);
  const previousReview = historyWindow.length > 1 ? historyWindow[historyWindow.length - 2] : null;
  const counters = {
    humanReviewHistorySnapshots: historyWindow.length,
    humanReviewApproved: humanReview.approved ? 1 : 0,
    humanReviewBlockedReasons: humanReview.blockedReasons.length,
    humanReviewRequiredInputs: humanReview.requiredInputs.length,
    humanReviewMissingInputs: humanReview.requiredInputs.filter((inputRequirement) => !inputRequirement.satisfied).length,
    humanReviewBundleReady: bundleAttestation.ready ? 1 : 0,
    humanReviewBundleBlockedReasons: bundleAttestation.blockedReasons.length,
    humanReviewValidationFailures: validationSummary.failedCount,
    humanReviewValidationPending: validationSummary.pendingCount,
    humanReviewReadinessSubmittable: readiness.canSubmitRelease ? 1 : 0
  };
  const timelineEvent = {
    eventId: `human-review:${state.revision}`,
    phase: 'human_review',
    occurredAt: humanReview.reviewedAt || now,
    status: humanReview.approved ? 'approved' : humanReview.decision,
    severity: humanReview.approved ? 'info' : (humanReview.decision === 'pending' ? 'warning' : 'error'),
    summary: humanReview.approved
      ? `human review approved by ${humanReview.reviewedBy || 'unknown'}`
      : (humanReview.blockedReasons[0] || 'human review pending'),
    releaseId: state.releaseId,
    commandId: state.lastCommandId,
    reviewDigest: humanReview.digest
  };

  return {
    schemaVersion: 1,
    reportType: 'release-packet-human-review-reporting-state',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    readyForAuditExport: humanReview.approved && bundleAttestation.ready,
    previousReviewId: previousReview?.reviewId || null,
    currentReviewId: currentReviewSnapshot.reviewId,
    historyWindow,
    counters,
    timelineEvent,
    exportRow: {
      rowType: 'human_review',
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      decision: humanReview.decision,
      approved: humanReview.approved,
      reviewedBy: humanReview.reviewedBy,
      reviewedAt: humanReview.reviewedAt,
      reviewBoundarySafe: humanReview.reviewScope.boundarySafe,
      reviewerHasRequiredRole: humanReview.reviewerAuthorization.hasRequiredRole,
      reviewerRoleAttested: humanReview.reviewerAuthorization.roleAttested,
      reviewerIsRequestActor: humanReview.reviewerAuthorization.reviewerIsRequestActor,
      separationOfDutiesRequired: humanReview.reviewerAuthorization.separationOfDutiesRequired,
      acceptanceActorConflict: humanReview.reviewerAuthorization.acceptanceActorConflict,
      blockedReasonCount: humanReview.blockedReasons.length,
      artifactBundleReady: bundleAttestation.ready,
      artifactBundleDigest: bundleAttestation.digest,
      humanReviewDigest: humanReview.digest,
      capturedAt: now
    },
    generatedAt: now,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      currentReviewSnapshot,
      previousReviewId: previousReview?.reviewId || null,
      counters,
      timelineEvent
    })
  };
}

function buildReleaseArtifactManifest({ input, state, actor, boundary, releaseBoundaryPolicy, persistence, preview, readiness, validationSummary, acceptance, clientWorkflowHandoff, auditHandoff, analytics, hostedBootProof, boundaryEvidence, operationalHealth, providerContracts, lifecycleControlPlan, acceptanceControl, clientRuntimeAdoption, audit, claims, now }) {
  const storageRoot = `${state.tenantId}/${state.workspaceId}/${state.releaseId}`;
  const artifacts = [
    buildArtifactDescriptor({
      state,
      artifactType: 'hosted-boot-proof',
      payload: hostedBootProof,
      storageKey: `${storageRoot}/hosted-boot-proof.json`,
      route: 'hosted-kernel.boot-proof',
      retentionClass: 'audit-record'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'persisted-state',
      payload: persistence,
      storageKey: `${storageRoot}/state.json`,
      route: 'kernel.persistence.release-packet',
      retentionClass: 'state-snapshot'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'release-preview',
      payload: preview,
      storageKey: `${storageRoot}/preview.json`,
      route: 'client.release-workbench.preview'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'readiness',
      payload: readiness,
      storageKey: `${storageRoot}/readiness.json`,
      route: 'verifier-claim-gate.readiness'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'validation-summary',
      payload: validationSummary,
      storageKey: `${storageRoot}/validation.json`,
      route: 'verifier-claim-gate.validation'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'client-workflow-handoff',
      payload: clientWorkflowHandoff,
      storageKey: `${storageRoot}/client-workflow.json`,
      route: clientWorkflowHandoff.handoffTarget
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'audit-handoff',
      payload: auditHandoff,
      storageKey: `${storageRoot}/audit-handoff.json`,
      route: auditHandoff.stream,
      retentionClass: 'audit-record'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'analytics-summary',
      payload: analytics.exportSummary,
      storageKey: `${storageRoot}/analytics-summary.json`,
      route: 'release-packet.analytics'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'boundary-evidence',
      payload: boundaryEvidence,
      storageKey: `${storageRoot}/boundary-evidence.json`,
      route: 'hosted-kernel.boundary-evidence',
      required: false,
      retentionClass: 'audit-record'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'operational-health',
      payload: operationalHealth,
      storageKey: `${storageRoot}/operational-health.json`,
      route: 'hosted-kernel.operational-health',
      required: false,
      retentionClass: 'health-snapshot'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'provider-contracts',
      payload: providerContracts,
      storageKey: `${storageRoot}/provider-contracts.json`,
      route: 'hosted-kernel.provider-contracts',
      required: false,
      retentionClass: 'integration-contract'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'lifecycle-control-plan',
      payload: lifecycleControlPlan,
      storageKey: `${storageRoot}/lifecycle-control-plan.json`,
      route: 'hosted-kernel.lifecycle-controls',
      required: false,
      retentionClass: 'control-plan'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'acceptance-control',
      payload: acceptanceControl,
      storageKey: `${storageRoot}/acceptance-control.json`,
      route: 'client.release-workbench.acceptance',
      required: false,
      retentionClass: 'control-plan'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'client-runtime-adoption',
      payload: clientRuntimeAdoption,
      storageKey: `${storageRoot}/client-runtime-adoption.json`,
      route: clientRuntimeAdoption.handoffTarget,
      required: false,
      retentionClass: 'control-plan'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'restart-resume-contract',
      payload: state.restartResumeContract,
      storageKey: `${storageRoot}/restart-resume-contract.json`,
      route: 'kernel.persistence.restart-recovery',
      required: false,
      retentionClass: 'state-snapshot'
    }),
    buildArtifactDescriptor({
      state,
      artifactType: 'claim-evidence-index',
      payload: claims.map((claim) => ({
        claimId: claim.claimId,
        gate: claim.gate,
        verifier: claim.verifier,
        verified: claim.verified,
        evidenceDigest: claim.evidenceDigest,
        tenantScoped: claim.tenantScoped,
        workspaceScoped: claim.workspaceScoped
      })),
      storageKey: `${storageRoot}/claim-evidence-index.json`,
      route: 'verifier-claim-gate.evidence-index',
      required: false
    })
  ];
  const missingRequiredArtifacts = artifacts
    .filter((artifact) => REQUIRED_RELEASE_ARTIFACTS.has(artifact.artifactType) && !artifact.produced)
    .map((artifact) => artifact.artifactType);
  const digestlessArtifacts = artifacts
    .filter((artifact) => artifact.produced && !artifact.digest)
    .map((artifact) => artifact.artifactType);
  const boundaryMismatches = artifacts
    .filter((artifact) => artifact.tenantId !== state.tenantId || artifact.workspaceId !== state.workspaceId)
    .map((artifact) => artifact.artifactType);
  const checks = [
    {
      checkId: 'required-artifacts-produced',
      status: missingRequiredArtifacts.length === 0 ? 'passed' : 'failed',
      detail: missingRequiredArtifacts.length === 0 ? 'all required artifacts produced' : missingRequiredArtifacts.join(',')
    },
    {
      checkId: 'hosted-boot-proof-ready',
      status: hostedBootProof.ready ? 'passed' : 'failed',
      detail: hostedBootProof.ready ? hostedBootProof.proofId : hostedBootProof.blockedReasons.join(',')
    },
    {
      checkId: 'artifact-digests-present',
      status: digestlessArtifacts.length === 0 ? 'passed' : 'failed',
      detail: digestlessArtifacts.length === 0 ? 'all produced artifacts have proof digests' : digestlessArtifacts.join(',')
    },
    {
      checkId: 'artifact-boundary-scoped',
      status: boundaryMismatches.length === 0 ? 'passed' : 'failed',
      detail: boundaryMismatches.length === 0 ? 'all artifacts match packet boundary' : boundaryMismatches.join(',')
    },
    {
      checkId: 'audit-event-count-matches',
      status: auditHandoff.eventCount === audit.length ? 'passed' : 'failed',
      detail: `${auditHandoff.eventCount}/${audit.length} audit event(s) declared`
    },
    {
      checkId: 'persistence-revision-matches',
      status: persistence.revision === state.revision ? 'passed' : 'failed',
      detail: `state revision ${state.revision}, persistence revision ${persistence.revision}`
    }
  ];
  const writePlan = artifacts.map((artifact) => ({
    artifactType: artifact.artifactType,
    storageKey: artifact.storageKey,
    route: artifact.route,
    required: artifact.required,
    digest: artifact.digest,
    retentionClass: artifact.retentionClass
  }));
  const bundleAttestation = normalizeArtifactBundleAttestation(input, state, artifacts, now);
  const humanReview = buildHumanReviewContract({
    input,
    state,
    actor,
    boundary,
    releaseBoundaryPolicy,
    acceptance,
    validationSummary,
    readiness,
    bundleAttestation,
    now
  });
  const humanReviewReporting = buildHumanReviewReportingState({
    input,
    state,
    bundleAttestation,
    humanReview,
    validationSummary,
    readiness,
    now
  });
  return {
    schemaVersion: 1,
    manifestType: 'hosted-kernel-release-packet-artifacts',
    releaseId: state.releaseId,
    tenantId: state.tenantId,
    workspaceId: state.workspaceId,
    revision: state.revision,
    generatedAt: now,
    storageRoot,
    complete: checks.every((check) => check.status === 'passed'),
    requiredArtifactTypes: [...REQUIRED_RELEASE_ARTIFACTS].sort(),
    producedArtifactCount: artifacts.filter((artifact) => artifact.produced).length,
    artifactCount: artifacts.length,
    bundleAttestation,
    humanReview,
    humanReviewReporting,
    hostedBootProof,
    handoffReady: checks.every((check) => check.status === 'passed') && hostedBootProof.ready && bundleAttestation.ready && humanReview.approved,
    handoffBlockedReasons: [
      ...checks.filter((check) => check.status !== 'passed').map((check) => check.checkId),
      ...hostedBootProof.blockedReasons,
      ...bundleAttestation.blockedReasons,
      ...humanReview.blockedReasons
    ],
    checks,
    artifacts,
    writePlan,
    digest: proofDigest({
      releaseId: state.releaseId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      revision: state.revision,
      artifacts: artifacts.map((artifact) => ({
        artifactType: artifact.artifactType,
        storageKey: artifact.storageKey,
        route: artifact.route,
        required: artifact.required,
        digest: artifact.digest
      })),
      checks,
      hostedBootProofDigest: hostedBootProof.digest,
      hostedBootProofReady: hostedBootProof.ready,
      bundleAttestationDigest: bundleAttestation.digest,
      bundleAttestationReady: bundleAttestation.ready,
      humanReviewDigest: humanReview.digest,
      humanReviewApproved: humanReview.approved,
      humanReviewReportingDigest: humanReviewReporting.digest,
      humanReviewReadyForAuditExport: humanReviewReporting.readyForAuditExport
    })
  };
}

function releaseFinalizationIssue(issue) {
  return {
    issueId: issue.issueId,
    code: issue.code,
    severity: issue.severity || 'blocking',
    route: issue.route || `${surfaceGroup}.${surfaceName}`,
    message: issue.message,
    retryAfter: issue.retryAfter || null,
    nextStep: issue.nextStep || { action: 'review_release_packet' },
    evidence: issue.evidence || null
  };
}

function buildReleaseFinalizationGate({ commandResult, readiness, acceptanceControl, hostedBootProof, artifactManifest, operationalHealth, providerContracts, clientRuntimeAdoption, now }) {
  const artifactBundle = artifactManifest.bundleAttestation;
  const humanReview = artifactManifest.humanReview;
  const commandCanSubmit = readiness.canSubmitRelease && acceptanceControl.acceptanceBoundToPreview;
  const infrastructureBlocked = operationalHealth.commandBlocked
    || providerContracts.commandBlocked
    || clientRuntimeAdoption.commandBlocked;
  const assemblyReady = hostedBootProof.ready
    && artifactManifest.complete
    && artifactBundle.ready
    && humanReview.approved;
  const issues = [
    ...(!readiness.canSubmitRelease ? [releaseFinalizationIssue({
      issueId: 'release-finalization:readiness',
      code: 'release_readiness_not_satisfied',
      message: readiness.primaryBlockingIssue?.userMessage || 'Release readiness still has unresolved validation input',
      retryAfter: readiness.retryAfter,
      nextStep: readiness.primaryBlockingIssue?.nextStep || { action: 'resolve_readiness' },
      evidence: {
        missingInputs: readiness.missingInputs,
        validationIssueSummaryDigest: readiness.validationIssueSummaryDigest
      }
    })] : []),
    ...(!acceptanceControl.acceptanceBoundToPreview ? [releaseFinalizationIssue({
      issueId: 'release-finalization:acceptance',
      code: 'release_preview_acceptance_not_current',
      message: 'Release preview acceptance is missing, stale, or not bound to the current preview digest',
      nextStep: {
        action: acceptanceControl.nextAction.action,
        route: acceptanceControl.nextAction.route,
        payload: acceptanceControl.nextAction.payload
      },
      evidence: {
        controlState: acceptanceControl.controlState,
        disabledReasons: acceptanceControl.disabledReasons,
        previewDigestBinding: acceptanceControl.previewDigestBinding
      }
    })] : []),
    ...(clientRuntimeAdoption.commandBlocked ? [releaseFinalizationIssue({
      issueId: 'release-finalization:client-runtime',
      code: 'client_runtime_handoff_not_adopted',
      message: clientRuntimeAdoption.userVisibleHandoff.reason,
      retryAfter: clientRuntimeAdoption.userVisibleHandoff.retryAfter,
      nextStep: {
        action: 'refresh_client_handoff',
        route: clientRuntimeAdoption.route,
        payload: clientRuntimeAdoption.recoveryPayload
      },
      evidence: {
        blockedReasons: clientRuntimeAdoption.blockedReasons,
        handoffProof: clientRuntimeAdoption.handoffProof
      }
    })] : []),
    ...(operationalHealth.commandBlocked ? operationalHealth.actionableErrors.slice(0, 5).map((error) => releaseFinalizationIssue({
      issueId: `release-finalization:health:${error.componentId}`,
      code: error.code,
      severity: error.severity === 'critical' ? 'critical' : 'blocking',
      route: error.route,
      message: error.message,
      retryAfter: error.retryAfter,
      nextStep: {
        action: 'restore_operational_dependency',
        componentId: error.componentId,
        remediation: error.remediation
      },
      evidence: {
        retryPlan: error.retryPlan,
        providerId: error.providerId,
        serviceId: error.serviceId,
        serviceType: error.serviceType
      }
    })) : []),
    ...(providerContracts.commandBlocked ? [releaseFinalizationIssue({
      issueId: 'release-finalization:provider-contracts',
      code: 'provider_contracts_not_ready',
      message: providerContracts.blockedReasons[0] || 'Provider contracts are not ready for release handoff',
      nextStep: {
        action: 'resolve_provider_contracts',
        providerContractDigest: providerContracts.digest
      },
      evidence: {
        blockedReasons: providerContracts.blockedReasons,
        missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
        missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
        externalHandoffContract: providerContracts.externalHandoffContract
      }
    })] : []),
    ...(!hostedBootProof.ready ? [releaseFinalizationIssue({
      issueId: 'release-finalization:hosted-boot-proof',
      code: 'hosted_boot_proof_not_ready',
      message: hostedBootProof.blockedReasons[0] || 'Hosted boot proof is not ready',
      nextStep: {
        action: 'refresh_hosted_boot_proof',
        proofId: hostedBootProof.proofId,
        expectedProtocol: hostedBootProof.supportedProtocols[0] || null
      },
      evidence: {
        blockedReasons: hostedBootProof.blockedReasons,
        providerId: hostedBootProof.providerId,
        providerMatched: hostedBootProof.providerMatched,
        digest: hostedBootProof.digest
      }
    })] : []),
    ...(!artifactManifest.complete || !artifactBundle.ready ? [releaseFinalizationIssue({
      issueId: 'release-finalization:artifact-bundle',
      code: 'artifact_bundle_not_attested',
      message: artifactBundle.blockedReasons[0] || artifactManifest.handoffBlockedReasons[0] || 'Release artifact bundle attestation is incomplete',
      nextStep: {
        action: 'repair_artifact_bundle_attestation',
        bundleId: artifactBundle.bundleId,
        expectedArtifactCount: artifactBundle.expectedArtifactCount
      },
      evidence: {
        manifestComplete: artifactManifest.complete,
        bundleReady: artifactBundle.ready,
        missingRequiredArtifacts: artifactBundle.missingRequiredArtifacts,
        digestMismatches: artifactBundle.digestMismatches,
        storageMismatches: artifactBundle.storageMismatches,
        blockedReasons: artifactBundle.blockedReasons
      }
    })] : []),
    ...(!humanReview.approved ? [releaseFinalizationIssue({
      issueId: 'release-finalization:human-review',
      code: 'human_review_not_approved',
      message: humanReview.blockedReasons[0] || 'Human review approval is required before release handoff',
      nextStep: {
        action: 'request_human_review',
        requiredRoles: humanReview.reviewerAuthorization.requiredRoles,
        expectedArtifactBundleDigest: humanReview.expectedArtifactBundleDigest
      },
      evidence: {
        decision: humanReview.decision,
        requiredInputs: humanReview.requiredInputs,
        blockedReasons: humanReview.blockedReasons,
        digest: humanReview.digest
      }
    })] : [])
  ];
  const criticalIssue = issues.find((issue) => issue.severity === 'critical') || null;
  const retryAfterCandidates = [
    readiness.retryAfter,
    operationalHealth.retryAfter,
    ...issues.map((issue) => issue.retryAfter)
  ].filter(Boolean).sort();
  const canFinalizeRelease = commandCanSubmit
    && !infrastructureBlocked
    && assemblyReady
    && issues.length === 0;
  const failureState = canFinalizeRelease
    ? 'ready'
    : (criticalIssue ? 'failed' : (infrastructureBlocked ? 'blocked_infrastructure' : 'blocked_review'));

  return {
    schemaVersion: 1,
    gateType: 'release-finalization-gate',
    releaseId: commandResult.state.releaseId,
    tenantId: commandResult.state.tenantId,
    workspaceId: commandResult.state.workspaceId,
    revision: commandResult.state.revision,
    command: commandResult.command,
    commandCanSubmit,
    infrastructureBlocked,
    assemblyReady,
    canFinalizeRelease,
    failureState,
    blockedReasons: issues.map((issue) => issue.code),
    criticalIssue,
    primaryIssue: criticalIssue || issues[0] || null,
    issueCount: issues.length,
    retryAfter: retryAfterCandidates[0] || null,
    degradedMode: {
      enabled: operationalHealth.degradedModeEnabled,
      acknowledged: operationalHealth.degradedModeAcknowledged,
      releaseNeedsAcknowledgement: operationalHealth.failureState.degradedReleaseNeedsAcknowledgement,
      status: operationalHealth.status
    },
    readinessDigest: readiness.validationIssueSummaryDigest,
    hostedBootProofDigest: hostedBootProof.digest,
    artifactManifestDigest: artifactManifest.digest,
    artifactBundleDigest: artifactBundle.digest,
    humanReviewDigest: humanReview.digest,
    providerContractDigest: providerContracts.digest,
    operationalHealthDigest: operationalHealth.digest,
    clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
    nextAction: issues[0]?.nextStep || {
      action: commandResult.command === 'release' ? 'monitor_release_handoff' : 'submit_release',
      route: commandResult.command === 'release' ? 'release-packet.audit-handoff' : 'verifier-claim-gate.release'
    },
    issues,
    generatedAt: now,
    digest: proofDigest({
      releaseId: commandResult.state.releaseId,
      tenantId: commandResult.state.tenantId,
      workspaceId: commandResult.state.workspaceId,
      revision: commandResult.state.revision,
      command: commandResult.command,
      commandCanSubmit,
      infrastructureBlocked,
      assemblyReady,
      canFinalizeRelease,
      failureState,
      issues: issues.map((issue) => ({
        issueId: issue.issueId,
        code: issue.code,
        severity: issue.severity,
        retryAfter: issue.retryAfter,
        action: issue.nextStep.action
      }))
    })
  };
}

function applyCommand({ state, command, commandId, now, gateReport, authorization, acceptance, releaseBoundaryPolicy, operationalHealth, providerContracts, clientRuntimeAdoption }) {
  const audit = [];
  const effectiveCommand = COMMANDS.has(command) ? command : DEFAULT_COMMAND;
  const appliedCommand = findAppliedCommand(state, commandId);
  const nextState = { ...state, commandLog: [...state.commandLog], commandLedger: [...state.commandLedger] };

  if (effectiveCommand !== command) {
    audit.push({ type: 'command_rejected', commandId, command, reason: 'unknown_command', at: now });
    return { state: nextState, audit, idempotent: false, denied: true, command: effectiveCommand };
  }

  if (!authorization.allowed) {
    audit.push({
      type: 'permission_denied',
      commandId,
      command,
      reason: authorization.deniedReason,
      requiredRoles: authorization.requiredRoles,
      actorRoles: authorization.actorRoles,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      at: now
    });
    return { state: nextState, audit, idempotent: false, denied: true, command: effectiveCommand };
  }

  if (!releaseBoundaryPolicy.allowed) {
    audit.push({
      type: 'release_boundary_policy_denied',
      commandId,
      command,
      reason: releaseBoundaryPolicy.deniedReason,
      policyId: releaseBoundaryPolicy.policyId || null,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      clientRoute: releaseBoundaryPolicy.clientRoute || null,
      handoffTarget: releaseBoundaryPolicy.handoffTarget || null,
      separationOfDutiesRequired: releaseBoundaryPolicy.separationOfDutiesRequired,
      acceptanceActorConflict: releaseBoundaryPolicy.acceptanceActorConflict,
      selfApprovalOverride: releaseBoundaryPolicy.selfApprovalOverride,
      at: now
    });
    return { state: nextState, audit, idempotent: false, denied: true, command: effectiveCommand };
  }

  if (appliedCommand) {
    audit.push({
      type: 'idempotent_replay',
      commandId,
      command: appliedCommand.command,
      status: appliedCommand.statusAfter,
      stateRevision: appliedCommand.stateRevision,
      resultDigest: appliedCommand.resultDigest,
      at: now
    });
    return { state: nextState, audit, idempotent: true, denied: false, command: effectiveCommand };
  }

  if (state.commandRecoveryPlan?.pendingConflictsWithRequest) {
    audit.push({
      type: 'pending_command_conflict_blocked',
      commandId,
      command: effectiveCommand,
      pendingCommandId: state.commandRecoveryPlan.checkpoint.commandId,
      pendingCommand: state.commandRecoveryPlan.checkpoint.command,
      requiredCommand: state.commandRecoveryPlan.requiredCommand,
      recoveryCommand: state.commandRecoveryPlan.recoveryCommand,
      recoveryPlanDigest: state.commandRecoveryPlan.digest,
      at: now
    });
    return { state: nextState, audit, idempotent: false, denied: true, command: effectiveCommand };
  }

  if (state.commandRecoveryPlan?.pendingMatchesRequest && effectiveCommand !== 'recover') {
    audit.push({
      type: 'pending_command_replay_deferred',
      commandId,
      command: effectiveCommand,
      requiredCommand: state.commandRecoveryPlan.requiredCommand,
      recoveryCommand: state.commandRecoveryPlan.recoveryCommand,
      recoveryPlanDigest: state.commandRecoveryPlan.digest,
      at: now
    });
    return { state: nextState, audit, idempotent: true, denied: false, command: effectiveCommand };
  }

  if (clientRuntimeAdoption.commandBlocked && effectiveCommand === 'release') {
    nextState.status = 'blocked';
    audit.push({
      type: 'client_runtime_handoff_blocked',
      commandId,
      command: effectiveCommand,
      statusBefore: state.status,
      statusAfter: nextState.status,
      blockedReasons: clientRuntimeAdoption.blockedReasons,
      serverRevision: clientRuntimeAdoption.revision.serverRevision,
      clientLastSeenRevision: clientRuntimeAdoption.revision.clientLastSeenRevision,
      clientAcknowledgedRevision: clientRuntimeAdoption.revision.clientAcknowledgedRevision,
      expectedHandoffDigest: clientRuntimeAdoption.handoffProof.expectedHandoffDigest,
      echoedHandoffDigest: clientRuntimeAdoption.handoffProof.echoedHandoffDigest,
      recoveryPayload: clientRuntimeAdoption.recoveryPayload,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
      at: now
    });
  } else if (operationalHealth.commandBlocked && (effectiveCommand === 'prepare' || effectiveCommand === 'release')) {
    nextState.status = 'recovering';
    audit.push({
      type: 'operational_health_blocked',
      commandId,
      command: effectiveCommand,
      statusBefore: state.status,
      statusAfter: nextState.status,
      blockingComponentCount: operationalHealth.blockingComponentCount,
      retryAfter: operationalHealth.retryAfter,
      actionableErrors: operationalHealth.actionableErrors,
      healthDigest: operationalHealth.digest,
      at: now
    });
  } else if (providerContracts.commandBlocked && (effectiveCommand === 'prepare' || effectiveCommand === 'release')) {
    nextState.status = 'blocked';
    audit.push({
      type: 'provider_contract_blocked',
      commandId,
      command: effectiveCommand,
      statusBefore: state.status,
      statusAfter: nextState.status,
      blockedReasons: providerContracts.blockedReasons,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      staleProviderCount: providerContracts.staleProviderCount,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffContract: providerContracts.externalHandoffContract,
      providerContractDigest: providerContracts.digest,
      at: now
    });
  } else if (!operationalHealth.healthy && effectiveCommand === 'release') {
    audit.push({
      type: 'operational_health_degraded_mode',
      commandId,
      command: effectiveCommand,
      degradedModeEnabled: operationalHealth.degradedModeEnabled,
      degradedComponentCount: operationalHealth.degradedComponentCount,
      retryAfter: operationalHealth.retryAfter,
      healthDigest: operationalHealth.digest,
      at: now
    });
  }

  if (clientRuntimeAdoption.commandBlocked && effectiveCommand === 'release') {
    // Command was recorded as a blocked client-runtime handoff transition above.
  } else if (operationalHealth.commandBlocked && (effectiveCommand === 'prepare' || effectiveCommand === 'release')) {
    // Command was recorded as a recovering state transition above.
  } else if (providerContracts.commandBlocked && (effectiveCommand === 'prepare' || effectiveCommand === 'release')) {
    // Command was recorded as a blocked provider-contract transition above.
  } else if (effectiveCommand === 'prepare') {
    nextState.status = gateReport.passed ? 'ready' : 'blocked';
  } else if (effectiveCommand === 'release') {
    if (!gateReport.passed) {
      nextState.status = 'blocked';
    } else if (!state.lifecycleSettings.tenantScoped || !state.lifecycleSettings.workspaceScoped) {
      nextState.status = 'blocked';
      audit.push({
        type: 'release_lifecycle_boundary_rejected',
        commandId,
        command: effectiveCommand,
        tenantId: state.lifecycleSettings.tenantId,
        workspaceId: state.lifecycleSettings.workspaceId,
        expectedTenantId: state.tenantId,
        expectedWorkspaceId: state.workspaceId,
        at: now
      });
    } else if (!state.lifecycleSettings.enabled) {
      nextState.status = 'blocked';
      audit.push({
        type: 'release_lifecycle_disabled',
        commandId,
        command: effectiveCommand,
        disabledReason: state.lifecycleSettings.disabledReason,
        at: now
      });
    } else if (state.lifecycleSettings.scheduleRejected || !state.lifecycleSettings.releaseWindowOpen) {
      audit.push({
        type: 'release_schedule_blocked',
        commandId,
        command: effectiveCommand,
        scheduledReleaseAt: state.lifecycleSettings.scheduledReleaseAt,
        releaseHoldUntil: state.lifecycleSettings.releaseHoldUntil,
        nextEligibleReleaseAt: state.lifecycleSettings.nextEligibleReleaseAt,
        scheduleRejectedReasons: state.lifecycleSettings.scheduleRejectedReasons,
        reason: state.lifecycleSettings.scheduleRejected
          ? (state.lifecycleSettings.scheduleRejectedReasons[0] || 'release_schedule_rejected')
          : 'release_window_not_open',
        at: now
      });
    } else if (acceptance.accepted && !TERMINAL_STATUSES.has(state.status)) {
      nextState.status = 'released';
    } else {
      audit.push({
        type: 'release_acceptance_required',
        commandId,
        command: effectiveCommand,
        status: state.status,
        accepted: acceptance.accepted,
        at: now
      });
    }
  } else if (effectiveCommand === 'recover') {
    if (state.pendingCommand) {
      audit.push({
        type: 'pending_command_recovered',
        commandId: state.pendingCommand.commandId,
        command: state.pendingCommand.command,
        statusBefore: state.pendingCommand.statusBefore,
        at: now
      });
    }
    if (state.recoveryCheckpoint?.usable) {
      audit.push({
        type: 'recovery_checkpoint_replayed',
        commandId: state.recoveryCheckpoint.commandId,
        command: state.recoveryCheckpoint.command,
        checkpointDigest: state.recoveryCheckpoint.digest,
        resumeToken: state.recoveryCheckpoint.resumeToken,
        at: now
      });
    }
    nextState.status = TERMINAL_STATUSES.has(state.status) ? state.status : (gateReport.passed ? 'ready' : 'recovering');
    nextState.pendingCommand = null;
    nextState.recoveryCheckpoint = null;
    nextState.restartResumeContract = null;
    nextState.restartStatus = statusRestartClass(nextState.status);
    nextState.recoveryReasons = state.recoveryReasons.filter((reason) => ![
      'pending_command_interrupted',
      'recovery_checkpoint_recorded'
    ].includes(reason));
  } else if (effectiveCommand === 'enable') {
    nextState.lifecycleSettings = {
      ...state.lifecycleSettings,
      enabled: true,
      disabledReason: null,
      updatedAt: now
    };
  } else if (effectiveCommand === 'disable') {
    const disableReason = cleanToken(
      state.lifecycleSettings.requestedDisabledReason || state.lifecycleSettings.disabledReason,
      null
    );
    if (state.lifecycleSettings.scheduleControls.requireDisableReason && !disableReason) {
      audit.push({
        type: 'release_lifecycle_disable_rejected',
        commandId,
        command: effectiveCommand,
        reason: 'disable_reason_required',
        requireDisableReason: true,
        at: now
      });
    } else {
      nextState.lifecycleSettings = {
        ...state.lifecycleSettings,
        enabled: false,
        disabledReason: disableReason || 'disabled by release operator',
        updatedAt: now
      };
      if (!TERMINAL_STATUSES.has(nextState.status)) {
        nextState.status = 'blocked';
      }
    }
  } else if (effectiveCommand === 'schedule') {
    const acceptedSchedule = !state.lifecycleSettings.scheduleRejected && state.lifecycleSettings.requestedReleaseAt;
    nextState.lifecycleSettings = acceptedSchedule ? {
      ...state.lifecycleSettings,
      scheduledReleaseAt: state.lifecycleSettings.requestedReleaseAt,
      scheduleInvalid: false,
      scheduleRejected: false,
      scheduleRejectedReasons: [],
      releaseWindowOpen: Date.parse(state.lifecycleSettings.requestedReleaseAt) <= Date.parse(now),
      nextEligibleReleaseAt: Date.parse(state.lifecycleSettings.requestedReleaseAt) > Date.parse(now)
        ? state.lifecycleSettings.requestedReleaseAt
        : null,
      nextSchedulableReleaseAt: null,
      updatedAt: now
    } : {
      ...state.lifecycleSettings,
      scheduledReleaseAt: state.lifecycleSettings.scheduledReleaseAt,
      releaseWindowOpen: state.lifecycleSettings.releaseWindowOpen,
      nextEligibleReleaseAt: state.lifecycleSettings.nextEligibleReleaseAt,
      updatedAt: now
    };
    const scheduleRejectedReasons = state.lifecycleSettings.requestedReleaseAt
      ? state.lifecycleSettings.scheduleRejectedReasons
      : ['requested_release_time_required'];
    audit.push({
      type: acceptedSchedule ? 'release_schedule_updated' : 'release_schedule_rejected',
      commandId,
      command: effectiveCommand,
      scheduledReleaseAt: nextState.lifecycleSettings.scheduledReleaseAt,
      requestedReleaseAt: state.lifecycleSettings.requestedReleaseAt,
      scheduleControls: state.lifecycleSettings.scheduleControls,
      reason: !acceptedSchedule
        ? (scheduleRejectedReasons[0] || 'release_schedule_rejected')
        : null,
      rejectedReasons: acceptedSchedule ? [] : scheduleRejectedReasons,
      at: now
    });
  }

  if (effectiveCommand !== DEFAULT_COMMAND) {
    nextState.revision += 1;
    nextState.lastCommandId = commandId;
    nextState.updatedAt = now;
    nextState.restartStatus = statusRestartClass(nextState.status);
    const ledgerEntry = {
      commandId,
      command: effectiveCommand,
      statusAfter: nextState.status,
      stateRevision: nextState.revision,
      resultDigest: proofDigest({
        releaseId: nextState.releaseId,
        tenantId: nextState.tenantId,
        workspaceId: nextState.workspaceId,
        commandId,
        command: effectiveCommand,
        statusAfter: nextState.status,
        revision: nextState.revision
      }),
      appliedAt: now
    };
    nextState.commandLog.push({
      commandId,
      command: effectiveCommand,
      statusAfter: nextState.status,
      appliedAt: now
    });
    nextState.commandLedger.push(ledgerEntry);
    nextState.commandLog = nextState.commandLog.slice(-MAX_COMMAND_LOG);
    nextState.commandLedger = nextState.commandLedger.slice(-MAX_COMMAND_LOG);
    nextState.commandRecoveryPlan = buildCommandRecoveryPlan(nextState, effectiveCommand, commandId, now);
    audit.push({
      type: 'command_applied',
      commandId,
      command: effectiveCommand,
      statusBefore: state.status,
      statusAfter: nextState.status,
      stateRevision: nextState.revision,
      resultDigest: ledgerEntry.resultDigest,
      tenantId: nextState.tenantId,
      workspaceId: nextState.workspaceId,
      at: now
    });
  }

  return { state: nextState, audit, idempotent: false, denied: false, command: effectiveCommand };
}

export function describeReleasePacketSurface(input = {}) {
  const now = isoNow(input);
  const command = typeof input.command === 'string' ? input.command : DEFAULT_COMMAND;
  const commandId = typeof input.commandId === 'string' && input.commandId.length > 0
    ? input.commandId
    : `${command}:${now}`;
  const actor = normalizeActor(input);
  const boundary = normalizeBoundary(input, actor);
  const clientRequest = normalizeClientRequest(input, actor, boundary, commandId, now);
  const workspaceAccess = normalizeWorkspaceAccess(input, actor, boundary);
  const authorization = authorizeCommand(command, actor, boundary, workspaceAccess);
  const releaseAuthorization = authorizeCommand('release', actor, boundary, workspaceAccess);
  const claims = normalizeClaims(input.claims || input.evidence, boundary);
  const gateReport = buildGateReport(claims);
  const acceptance = normalizeAcceptance(input, boundary);
  const releaseBoundaryPolicy = normalizeReleaseBoundaryPolicy(input, actor, boundary, clientRequest, acceptance, command);
  const recoveredState = normalizeState(input, now);
  recoveredState.commandRecoveryPlan = buildCommandRecoveryPlan(recoveredState, command, commandId, now);
  recoveredState.restartResumeContract = buildRestartResumeContract(recoveredState, recoveredState.commandRecoveryPlan, now);
  const providerContracts = normalizeProviderContracts(input, recoveredState, command, clientRequest, now);
  const operationalHealth = normalizeOperationalHealth(input, recoveredState, command, now, providerContracts);
  const boundaryEvidence = buildBoundaryEvidenceContract({
    actor,
    boundary,
    clientRequest,
    state: recoveredState,
    gateReport,
    acceptance,
    workspaceAccess,
    releaseBoundaryPolicy,
    providerContracts,
    now
  });
  const clientRuntimeAdoption = buildClientRuntimeAdoptionContract({
    state: recoveredState,
    command,
    clientRequest,
    acceptance,
    gateReport,
    operationalHealth,
    providerContracts,
    now
  });
  const commandResult = applyCommand({
    state: recoveredState,
    command,
    commandId,
    now,
    gateReport,
    authorization,
    acceptance,
    releaseBoundaryPolicy,
    operationalHealth,
    providerContracts,
    clientRuntimeAdoption
  });
  commandResult.state.commandRecoveryPlan = commandResult.state.commandRecoveryPlan
    || buildCommandRecoveryPlan(commandResult.state, commandResult.command, commandId, now);
  commandResult.state.restartResumeContract = buildRestartResumeContract(
    commandResult.state,
    commandResult.state.commandRecoveryPlan,
    now
  );
  const hostedBootProof = normalizeHostedBootProof(input, commandResult.state, boundaryEvidence, providerContracts, now);
  const lifecycleControlPlan = buildLifecycleControlPlan({
    state: commandResult.state,
    actor,
    boundary,
    workspaceAccess,
    releaseBoundaryPolicy,
    command: commandResult.command,
    commandResult,
    now
  });
  const stateHealth = buildStateHealth(commandResult.state);
  const persistence = buildPersistenceContract(commandResult.state, stateHealth, operationalHealth, boundaryEvidence);
  const validationSummary = buildValidationSummary({
    gateReport,
    authorization,
    releaseAuthorization,
    acceptance,
    command: commandResult.command,
    state: commandResult.state,
    workspaceAccess,
    releaseBoundaryPolicy,
    boundaryEvidence,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    clientRuntimeAdoption
  });
  const validationIssueSummary = buildValidationIssueSummary({
    validationSummary,
    state: commandResult.state,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    clientRuntimeAdoption
  });
  const preview = buildPreviewContract({
    state: commandResult.state,
    claims,
    gateReport,
    acceptance,
    validationSummary,
    validationIssueSummary,
    providerContracts,
    lifecycleControlPlan
  });
  const readiness = buildReadinessContract({
    state: commandResult.state,
    gateReport,
    acceptance,
    validationSummary,
    validationIssueSummary,
    releaseAuthorization,
    workspaceAccess,
    releaseBoundaryPolicy,
    boundaryEvidence,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    clientRuntimeAdoption
  });
  const acceptanceControl = buildAcceptanceControlContract({
    state: commandResult.state,
    clientRequest,
    preview,
    acceptance,
    validationSummary,
    readiness,
    clientRuntimeAdoption,
    now
  });
  const nextSteps = buildNextSteps({
    command,
    commandResult,
    gateReport,
    acceptance,
    readiness,
    releaseAuthorization,
    workspaceAccess,
    releaseBoundaryPolicy,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    clientRuntimeAdoption
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    clientRequest,
    commandResult,
    preview,
    readiness,
    validationSummary,
    validationIssueSummary,
    nextSteps,
    stateHealth,
    boundaryEvidence,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    acceptanceControl,
    clientRuntimeAdoption,
    now
  });
  const audit = [
    ...(recoveredState.recoveredFrom ? [{ type: 'state_recovered', fromStatus: recoveredState.recoveredFrom, toStatus: recoveredState.status, at: now }] : []),
    ...recoveredState.recoveryReasons.map((reason) => ({
      type: 'state_recovery_reason',
      reason,
      status: recoveredState.status,
      releaseId: recoveredState.releaseId,
      at: now
    })),
    ...(recoveredState.restartResumeContract.resumeAvailable ? [{
      type: 'restart_resume_contract_available',
      releaseId: recoveredState.releaseId,
      commandId: recoveredState.restartResumeContract.checkpoint?.commandId || null,
      recoveryCommand: recoveredState.restartResumeContract.recoveryCommand,
      resumePayload: recoveredState.restartResumeContract.resumePayload,
      restartResumeDigest: recoveredState.restartResumeContract.digest,
      at: now
    }] : []),
    ...gateReport.missing
      .filter((missing) => missing.reason === 'claim_outside_workspace_boundary')
      .map((missing) => ({
        type: 'claim_boundary_rejected',
        claimId: missing.claimId,
        gate: missing.gate,
        tenantId: missing.tenantId,
        workspaceId: missing.workspaceId,
        expectedTenantId: commandResult.state.tenantId,
        expectedWorkspaceId: commandResult.state.workspaceId,
        at: now
      })),
    ...(acceptance.deniedReason ? [{
      type: 'acceptance_boundary_rejected',
      acceptedBy: acceptance.acceptedBy,
      tenantId: acceptance.tenantId,
      workspaceId: acceptance.workspaceId,
      expectedTenantId: commandResult.state.tenantId,
      expectedWorkspaceId: commandResult.state.workspaceId,
      at: now
    }] : []),
    ...(!clientRequest.boundaryAccepted ? [{
      type: 'client_request_boundary_rejected',
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId,
      expectedTenantId: commandResult.state.tenantId,
      expectedWorkspaceId: commandResult.state.workspaceId,
      route: clientRequest.route,
      at: now
    }] : []),
    ...(clientWorkflowHandoff.staleRevision ? [{
      type: 'client_state_stale',
      requestId: clientRequest.requestId,
      clientRevision: clientWorkflowHandoff.clientRevision,
      serverRevision: clientWorkflowHandoff.serverRevision,
      releaseId: commandResult.state.releaseId,
      route: clientRequest.route,
      at: now
    }] : []),
    {
      type: 'hosted_boot_proof_evaluated',
      releaseId: commandResult.state.releaseId,
      proofId: hostedBootProof.proofId,
      ready: hostedBootProof.ready,
      protocolVersion: hostedBootProof.protocolVersion,
      providerId: hostedBootProof.providerId,
      providerMatched: hostedBootProof.providerMatched,
      blockedReasons: hostedBootProof.blockedReasons,
      hostedBootProofDigest: hostedBootProof.digest,
      at: now
    },
    {
      type: 'acceptance_control_evaluated',
      releaseId: commandResult.state.releaseId,
      requestId: clientRequest.requestId,
      controlState: acceptanceControl.controlState,
      acceptanceBoundToPreview: acceptanceControl.acceptanceBoundToPreview,
      previewDigest: acceptanceControl.previewDigest,
      echoedPreviewDigest: acceptanceControl.echoedPreviewDigest,
      previewDigestBindingState: acceptanceControl.previewDigestBinding.state,
      previewDigestMatched: acceptanceControl.previewDigestBinding.matched,
      clientRuntimeAdoptionDigestMatched: acceptanceControl.clientRuntimeAdoptionDigestBinding.matched,
      nextAction: acceptanceControl.nextAction.action,
      disabledReasons: acceptanceControl.disabledReasons,
      acceptanceControlDigest: acceptanceControl.digest,
      at: now
    },
    {
      type: 'validation_issue_summary_evaluated',
      releaseId: commandResult.state.releaseId,
      readyForRelease: validationIssueSummary.readyForRelease,
      issueCount: validationIssueSummary.issueCount,
      blockingIssueCount: validationIssueSummary.blockingIssueCount,
      waitingIssueCount: validationIssueSummary.waitingIssueCount,
      primaryIssue: validationIssueSummary.primaryIssue,
      validationIssueSummaryDigest: validationIssueSummary.digest,
      at: now
    },
    {
      type: 'client_runtime_adoption_evaluated',
      releaseId: commandResult.state.releaseId,
      requestId: clientRequest.requestId,
      command,
      commandBlocked: clientRuntimeAdoption.commandBlocked,
      blockedReasons: clientRuntimeAdoption.blockedReasons,
      serverRevision: clientRuntimeAdoption.revision.serverRevision,
      clientLastSeenRevision: clientRuntimeAdoption.revision.clientLastSeenRevision,
      clientAcknowledgedRevision: clientRuntimeAdoption.revision.clientAcknowledgedRevision,
      handoffDigestMatched: clientRuntimeAdoption.handoffProof.matched,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
      at: now
    },
    {
      type: 'tenant_workspace_boundary_evidence_evaluated',
      releaseId: commandResult.state.releaseId,
      tenantId: commandResult.state.tenantId,
      workspaceId: commandResult.state.workspaceId,
      actorId: actor.actorId,
      handoffSafe: boundaryEvidence.handoffSafe,
      isolationFaults: boundaryEvidence.isolationFaults,
      scopedSubjects: boundaryEvidence.scopedSubjects,
      auditScope: boundaryEvidence.auditScope,
      boundaryEvidenceDigest: boundaryEvidence.digest,
      at: now
    },
    ...operationalHealth.actionableErrors.map((error) => ({
      type: error.code,
      componentId: error.componentId,
      route: error.route,
      message: error.message,
      severity: error.severity,
      retryAfter: error.retryAfter,
      remediation: error.remediation || null,
      providerId: error.providerId || null,
      serviceId: error.serviceId || null,
      serviceType: error.serviceType || null,
      retryAttempt: error.retryPlan ? error.retryPlan.attempt : null,
      retryExhausted: error.retryPlan ? error.retryPlan.exhausted : false,
      releaseId: commandResult.state.releaseId,
      command,
      at: now
    })),
    ...(providerContracts.commandBlocked ? [{
      type: 'provider_contracts_not_ready',
      releaseId: commandResult.state.releaseId,
      command,
      blockedReasons: providerContracts.blockedReasons,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      incompatibleProviderCount: providerContracts.incompatibleProviderCount,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServices: providerContracts.staleProviderServices,
      incompatibleProviderServices: providerContracts.incompatibleProviderServices,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffContract: providerContracts.externalHandoffContract,
      providerContractDigest: providerContracts.digest,
      at: now
    }] : []),
    ...(lifecycleControlPlan.schedule.rejectedReasons.length > 0 ? [{
      type: 'lifecycle_schedule_controls_rejected',
      releaseId: commandResult.state.releaseId,
      command,
      scheduleState: lifecycleControlPlan.schedule.state,
      requestedReleaseAt: lifecycleControlPlan.schedule.requestedReleaseAt,
      nextSchedulableReleaseAt: lifecycleControlPlan.schedule.nextSchedulableReleaseAt,
      rejectedReasons: lifecycleControlPlan.schedule.rejectedReasons,
      blockingBlackoutWindowIds: lifecycleControlPlan.schedule.controls.blockingBlackoutWindowIds,
      lifecycleControlDigest: lifecycleControlPlan.digest,
      at: now
    }] : []),
    {
      type: 'lifecycle_execution_plan_evaluated',
      releaseId: commandResult.state.releaseId,
      command,
      executionState: lifecycleControlPlan.executionPlan.executionState,
      nextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
      waitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
      runnableCommandCount: lifecycleControlPlan.executionPlan.runnableCommandCount,
      waitingCommandCount: lifecycleControlPlan.executionPlan.waitingCommandCount,
      blockedCommandCount: lifecycleControlPlan.executionPlan.blockedCommandCount,
      settingsMutationRequired: lifecycleControlPlan.executionPlan.settingsMutationRequired,
      executionPlanDigest: lifecycleControlPlan.executionPlan.digest,
      at: now
    },
    ...(!workspaceAccess.allowed ? [{
      type: 'workspace_access_denied',
      actorId: actor.actorId,
      policyId: workspaceAccess.policyId,
      reason: workspaceAccess.deniedReason,
      tenantId: workspaceAccess.tenantId,
      workspaceId: workspaceAccess.workspaceId,
      expectedTenantId: commandResult.state.tenantId,
      expectedWorkspaceId: commandResult.state.workspaceId,
      actorDirectlyAllowed: workspaceAccess.actorDirectlyAllowed,
      actorRoleAllowed: workspaceAccess.actorRoleAllowed,
      actorDenied: workspaceAccess.actorDenied,
      matchedRoles: workspaceAccess.matchedRoles,
      at: now
    }] : []),
    ...(!releaseBoundaryPolicy.allowed ? [{
      type: 'release_boundary_policy_rejected',
      policyId: releaseBoundaryPolicy.policyId || null,
      reason: releaseBoundaryPolicy.deniedReason,
      tenantId: releaseBoundaryPolicy.tenantId || null,
      workspaceId: releaseBoundaryPolicy.workspaceId || null,
      expectedTenantId: commandResult.state.tenantId,
      expectedWorkspaceId: commandResult.state.workspaceId,
      command,
      clientRoute: releaseBoundaryPolicy.clientRoute || null,
      handoffTarget: releaseBoundaryPolicy.handoffTarget || null,
      separationOfDutiesRequired: releaseBoundaryPolicy.separationOfDutiesRequired,
      acceptanceActorConflict: releaseBoundaryPolicy.acceptanceActorConflict,
      selfApprovalOverride: releaseBoundaryPolicy.selfApprovalOverride,
      at: now
    }] : []),
    ...(recoveredState.boundaryRecoveredFrom ? [{
      type: 'tenant_boundary_recovered',
      fromTenantId: recoveredState.boundaryRecoveredFrom.tenantId,
      fromWorkspaceId: recoveredState.boundaryRecoveredFrom.workspaceId,
      toTenantId: recoveredState.tenantId,
      toWorkspaceId: recoveredState.workspaceId,
      at: now
    }] : []),
    ...commandResult.audit
  ];
  const auditHandoff = {
    stream: `${surfaceGroup}.${surfaceName}`,
    tenantId: commandResult.state.tenantId,
    workspaceId: commandResult.state.workspaceId,
    actorId: actor.actorId,
    eventCount: audit.length,
    workspaceAccess: {
      policyPresent: workspaceAccess.policyPresent,
      allowed: workspaceAccess.allowed,
      deniedReason: workspaceAccess.deniedReason,
      policyId: workspaceAccess.policyId || null,
      matchedRoles: workspaceAccess.matchedRoles
    },
    releaseBoundaryPolicy: {
      policyPresent: releaseBoundaryPolicy.policyPresent,
      allowed: releaseBoundaryPolicy.allowed,
      deniedReason: releaseBoundaryPolicy.deniedReason,
      policyId: releaseBoundaryPolicy.policyId || null,
      commandAllowed: releaseBoundaryPolicy.commandAllowed,
      routeAllowed: releaseBoundaryPolicy.routeAllowed,
      handoffTargetAllowed: releaseBoundaryPolicy.handoffTargetAllowed,
      separationOfDutiesRequired: releaseBoundaryPolicy.separationOfDutiesRequired,
      acceptanceActorConflict: releaseBoundaryPolicy.acceptanceActorConflict,
      selfApprovalOverride: releaseBoundaryPolicy.selfApprovalOverride
    },
    boundaryEvidence: {
      digest: boundaryEvidence.digest,
      handoffSafe: boundaryEvidence.handoffSafe,
      isolationFaults: boundaryEvidence.isolationFaults,
      isolationFaultCount: boundaryEvidence.isolationFaultCount,
      auditScope: boundaryEvidence.auditScope,
      scopedSubjects: boundaryEvidence.scopedSubjects
    },
    lifecycleControls: {
      digest: lifecycleControlPlan.digest,
      commandEffect: lifecycleControlPlan.commandEffect,
      lifecycleBlocked: lifecycleControlPlan.lifecycleBlocked,
      blockedReasons: lifecycleControlPlan.lifecycleBlockedReasons,
      nextActionState: lifecycleControlPlan.nextActionState,
      executionPlan: {
        digest: lifecycleControlPlan.executionPlan.digest,
        executionState: lifecycleControlPlan.executionPlan.executionState,
        nextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
        waitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
        runnableCommandCount: lifecycleControlPlan.executionPlan.runnableCommandCount,
        waitingCommandCount: lifecycleControlPlan.executionPlan.waitingCommandCount,
        blockedCommandCount: lifecycleControlPlan.executionPlan.blockedCommandCount,
        settingsMutationRequired: lifecycleControlPlan.executionPlan.settingsMutationRequired
      },
      schedule: lifecycleControlPlan.schedule
    },
    operationalHealth: {
      digest: operationalHealth.digest,
      status: operationalHealth.status,
      commandBlocked: operationalHealth.commandBlocked,
      blockedReasons: operationalHealth.failureState.blockedReasons,
      degradedModeEnabled: operationalHealth.degradedModeEnabled,
      degradedModeAcknowledged: operationalHealth.degradedModeAcknowledged,
      retryAfter: operationalHealth.retryAfter,
      providerDerivedComponentCount: operationalHealth.providerDerivedComponentCount,
      retryableComponentCount: operationalHealth.retryPlan.retryableComponentCount,
      exhaustedComponentCount: operationalHealth.retryPlan.exhaustedComponentCount,
      escalationRequired: operationalHealth.retryPlan.escalationRequired
    },
    acceptanceControl: {
      digest: acceptanceControl.digest,
      controlState: acceptanceControl.controlState,
      acceptanceBoundToPreview: acceptanceControl.acceptanceBoundToPreview,
      previewDigest: acceptanceControl.previewDigest,
      echoedPreviewDigest: acceptanceControl.echoedPreviewDigest,
      previewDigestBinding: acceptanceControl.previewDigestBinding,
      clientRuntimeAdoptionDigestBinding: acceptanceControl.clientRuntimeAdoptionDigestBinding,
      missingFields: acceptanceControl.missingFields,
      disabledReasons: acceptanceControl.disabledReasons,
      nextAction: acceptanceControl.nextAction
    },
    validationIssues: {
      digest: validationIssueSummary.digest,
      issueCount: validationIssueSummary.issueCount,
      blockingIssueCount: validationIssueSummary.blockingIssueCount,
      waitingIssueCount: validationIssueSummary.waitingIssueCount,
      categories: validationIssueSummary.categories,
      primaryIssue: validationIssueSummary.primaryIssue
    },
    clientRuntimeAdoption: {
      digest: clientRuntimeAdoption.digest,
      commandBlocked: clientRuntimeAdoption.commandBlocked,
      blockedReasons: clientRuntimeAdoption.blockedReasons,
      serverRevision: clientRuntimeAdoption.revision.serverRevision,
      clientAcknowledgedRevision: clientRuntimeAdoption.revision.clientAcknowledgedRevision,
      handoffDigestMatched: clientRuntimeAdoption.handoffProof.matched
    },
    providerContracts: {
      digest: providerContracts.digest,
      commandBlocked: providerContracts.commandBlocked,
      blockedReasons: providerContracts.blockedReasons,
      requiredCapabilities: providerContracts.requiredCapabilities,
      requiredServices: providerContracts.requiredServices,
      missingRequiredCapabilities: providerContracts.missingRequiredCapabilities,
      activeServiceTypes: providerContracts.activeServiceTypes,
      missingRequiredServiceTypes: providerContracts.missingRequiredServiceTypes,
      incompatibleProviderCount: providerContracts.incompatibleProviderCount,
      activeProviderCount: providerContracts.activeProviderCount,
      staleProviderCount: providerContracts.staleProviderCount,
      staleProviderServices: providerContracts.staleProviderServices,
      incompatibleProviderServices: providerContracts.incompatibleProviderServices,
      handoffAccepted: providerContracts.handoffAccepted,
      externalHandoffContract: providerContracts.externalHandoffContract
    },
    hostedBootProof: {
      digest: hostedBootProof.digest,
      ready: hostedBootProof.ready,
      proofId: hostedBootProof.proofId,
      protocolVersion: hostedBootProof.protocolVersion,
      bootedAt: hostedBootProof.bootedAt,
      expiresAt: hostedBootProof.expiresAt,
      providerId: hostedBootProof.providerId,
      providerMatched: hostedBootProof.providerMatched,
      blockedReasons: hostedBootProof.blockedReasons
    },
    restartRecovery: {
      digest: commandResult.state.restartResumeContract.digest,
      restartStatus: commandResult.state.restartStatus,
      resumeAvailable: commandResult.state.restartResumeContract.resumeAvailable,
      replayProtected: commandResult.state.restartResumeContract.replayProtected,
      recoveryStatus: commandResult.state.restartResumeContract.recoveryStatus,
      blockedReasons: commandResult.state.restartResumeContract.blockedReasons,
      checkpointDigest: commandResult.state.recoveryCheckpoint?.digest || null
    },
    eventDigest: proofDigest(audit)
  };
  const analytics = buildAnalyticsReport({
    input,
    state: commandResult.state,
    recoveredState,
    claims,
    gateReport,
    acceptance,
    validationSummary,
    validationIssueSummary,
    readiness,
    stateHealth,
    boundaryEvidence,
    operationalHealth,
    providerContracts,
    workspaceAccess,
    releaseBoundaryPolicy,
    lifecycleControlPlan,
    acceptanceControl,
    clientRuntimeAdoption,
    commandResult,
    clientWorkflowHandoff,
    audit,
    now
  });
  const artifactManifest = buildReleaseArtifactManifest({
    input,
    state: commandResult.state,
    actor,
    boundary,
    releaseBoundaryPolicy,
    persistence,
    preview,
    readiness,
    validationSummary,
    acceptance,
    clientWorkflowHandoff,
    auditHandoff,
    analytics,
    hostedBootProof,
    boundaryEvidence,
    operationalHealth,
    providerContracts,
    lifecycleControlPlan,
    acceptanceControl,
    clientRuntimeAdoption,
    audit,
    claims,
    now
  });
  const releaseFinalizationGate = buildReleaseFinalizationGate({
    commandResult,
    readiness,
    acceptanceControl,
    hostedBootProof,
    artifactManifest,
    operationalHealth,
    providerContracts,
    clientRuntimeAdoption,
    now
  });
  const proof = {
    proofType: 'release-packet-state-v1',
    digest: proofDigest({
      surfaceId,
      releaseId: commandResult.state.releaseId,
      tenantId: commandResult.state.tenantId,
      workspaceId: commandResult.state.workspaceId,
      status: commandResult.state.status,
      revision: commandResult.state.revision,
      restartStatus: commandResult.state.restartStatus,
      gateReport,
      acceptance,
      readiness,
      validationSummary,
      validationIssueSummary,
      stateHealth,
      operationalHealth,
      providerContracts,
      lifecycleControlPlan,
      acceptanceControl,
      clientRuntimeAdoption,
      restartResumeContract: commandResult.state.restartResumeContract,
      persistence,
      hostedBootProof,
      releaseFinalizationGate,
      workspaceAccess,
      releaseBoundaryPolicy,
      boundaryEvidence,
      providerContracts,
      analyticsDigest: analytics.exportSummary.digest,
      hostedBootProofDigest: hostedBootProof.digest,
      hostedBootProofReady: hostedBootProof.ready,
      analyticsCounters: analytics.counters,
      lifecycleControlDigest: lifecycleControlPlan.digest,
      acceptanceControlDigest: acceptanceControl.digest,
      clientRuntimeAdoptionDigest: clientRuntimeAdoption.digest,
      releaseFinalizationGateDigest: releaseFinalizationGate.digest,
      canFinalizeRelease: releaseFinalizationGate.canFinalizeRelease,
      artifactManifestDigest: artifactManifest.digest,
      artifactManifestComplete: artifactManifest.complete,
      clientWorkflowDigest: clientWorkflowHandoff.correlation.digest,
      boundaryEvidenceDigest: boundaryEvidence.digest,
      providerContractDigest: providerContracts.digest,
      restartResumeDigest: commandResult.state.restartResumeContract.digest,
      lastCommandId: commandResult.state.lastCommandId,
      auditHandoff
    }),
    generatedAt: now
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel release packet state contract v1',
    command: {
      name: commandResult.command,
      commandId,
      idempotent: commandResult.idempotent,
      denied: commandResult.denied,
      requiredRoles: authorization.requiredRoles
    },
    boundary: {
      tenantId: commandResult.state.tenantId,
      workspaceId: commandResult.state.workspaceId,
      actorId: actor.actorId,
      releasePermission: releaseAuthorization.allowed ? 'allowed' : 'denied',
      releaseDeniedReason: releaseAuthorization.deniedReason,
      actorTenantMatches: boundary.actorTenantMatches,
      actorWorkspaceMatches: boundary.actorWorkspaceMatches,
      stateTenantMatches: boundary.stateTenantMatches,
      stateWorkspaceMatches: boundary.stateWorkspaceMatches,
      workspaceAccess,
      releaseBoundaryPolicy,
      boundaryEvidence
    },
    releasePacket: {
      releaseId: commandResult.state.releaseId,
      status: commandResult.state.status,
      restartStatus: commandResult.state.restartStatus,
      restartSafe: stateHealth.restartSafe,
      canRelease: releaseFinalizationGate.canFinalizeRelease,
      commandCanSubmit: releaseFinalizationGate.commandCanSubmit,
      releaseFinalizationState: releaseFinalizationGate.failureState,
      releaseFinalizationIssueCount: releaseFinalizationGate.issueCount,
      primaryReleaseFinalizationIssue: releaseFinalizationGate.primaryIssue,
      releaseFinalizationNextAction: releaseFinalizationGate.nextAction,
      accepted: acceptance.accepted,
      operationalHealth: operationalHealth.status,
      providerContractState: providerContracts.commandBlocked ? 'blocked' : 'ready',
      externalHandoffState: providerContracts.externalHandoffContract.status,
      externalHandoffTarget: providerContracts.externalHandoffContract.target,
      externalHandoffReadyCandidateCount: providerContracts.externalHandoffContract.readyCandidateCount,
      lifecycleScheduleState: lifecycleControlPlan.schedule.state,
      lifecycleExecutionState: lifecycleControlPlan.executionPlan.executionState,
      lifecycleNextRunnableCommand: lifecycleControlPlan.executionPlan.nextRunnableCommand,
      lifecycleWaitingUntil: lifecycleControlPlan.executionPlan.waitingUntil,
      nextSchedulableReleaseAt: lifecycleControlPlan.schedule.nextSchedulableReleaseAt,
      retryAfter: operationalHealth.retryAfter,
      commandRecoveryStatus: commandResult.state.commandRecoveryPlan?.status || 'clear',
      recoveryCommand: commandResult.state.commandRecoveryPlan?.recoveryCommand || null,
      restartResumeAvailable: commandResult.state.restartResumeContract.resumeAvailable,
      restartRecoveryStatus: commandResult.state.restartResumeContract.recoveryStatus,
      restartResumePayload: commandResult.state.restartResumeContract.resumePayload,
      clientWorkflowState: clientWorkflowHandoff.workflowState,
      primaryClientAction: clientWorkflowHandoff.primaryAction.action,
      validationIssueCount: validationIssueSummary.issueCount,
      primaryValidationIssue: validationIssueSummary.primaryIssue,
      acceptanceControlState: acceptanceControl.controlState,
      acceptedPreviewCurrent: acceptanceControl.previewDigestBinding.matched,
      acceptanceNextAction: acceptanceControl.nextAction.action,
      hostedBootProofReady: hostedBootProof.ready,
      hostedBootProofBlockedReasons: hostedBootProof.blockedReasons,
      artifactBundleReady: artifactManifest.bundleAttestation.ready,
      humanReviewApproved: artifactManifest.humanReview.approved,
      releaseHandoffReady: artifactManifest.handoffReady,
      releaseHandoffBlockedReasons: artifactManifest.handoffBlockedReasons,
      finalizationBlockedReasons: releaseFinalizationGate.blockedReasons,
      persistedState: persistence
    },
    stateHealth,
    operationalHealth,
    providerContracts,
    preview,
    acceptance,
    readiness,
    validationSummary,
    validationIssueSummary,
    nextSteps,
    acceptanceControl,
    hostedBootProof,
    boundaryEvidence,
    clientRequest,
    clientWorkflowHandoff,
    gateReport,
    lifecycleControlPlan,
    analytics,
    artifactManifest,
    releaseFinalizationGate,
    audit,
    auditHandoff,
    proof,
    evidence: claims
  };
}

export default describeReleasePacketSurface;
