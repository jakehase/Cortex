export const surfaceId = "aios_memory-manager_trust-metadata_042";
export const surfaceGroup = "memory-manager";
export const surfaceName = "trust-metadata";

const CURRENT_SCHEMA_VERSION = 1;
const KNOWN_COMMANDS = new Set([
  'upsertSubjectTrust',
  'revokeSubjectTrust',
  'checkpoint',
  'configureLifecycleSettings',
  'enableTrustLifecycle',
  'disableTrustLifecycle',
  'scheduleLifecycleSweep'
]);
const TRUST_LEVELS = new Set(['unknown', 'untrusted', 'provisional', 'trusted', 'pinned']);
const DEFAULT_TENANT_ID = 'hosted-kernel';
const DEFAULT_WORKSPACE_ID = 'global';
const TRUST_WRITE_ROLES = new Set(['owner', 'admin', 'trust-manager', 'kernel']);
const TRUST_WRITE_PERMISSIONS = new Set(['memory.trust.write', 'memory.trust.revoke', 'memory.trust.admin']);
const TRUST_REVOKE_ROLES = new Set(['owner', 'admin', 'trust-manager', 'kernel']);
const TRUST_REVOKE_PERMISSIONS = new Set(['memory.trust.revoke', 'memory.trust.admin']);
const TRUST_ADMIN_ROLES = new Set(['owner', 'admin', 'kernel']);
const TRUST_ADMIN_PERMISSIONS = new Set(['memory.trust.admin']);
const WORKSPACE_WILDCARD = '*';
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5000;
const MAX_ANALYTICS_HISTORY_SNAPSHOTS = 12;
const MAX_TIMELINE_EVENTS = 50;
const MAX_COMMAND_LEDGER_ENTRIES = 200;
const ANALYTICS_EXPORT_FORMATS = ['json', 'jsonl'];
const ANALYTICS_EXPORT_DATASETS = ['summary', 'history', 'timeline', 'subjectTransitions', 'trendReport'];
const DEFAULT_CLIENT_ID = 'hosted-kernel-client';
const LIFECYCLE_COMMANDS = new Set([
  'configureLifecycleSettings',
  'enableTrustLifecycle',
  'disableTrustLifecycle',
  'scheduleLifecycleSweep'
]);
const DEFAULT_LIFECYCLE_SETTINGS = {
  staleAfterDays: 90,
  reviewCadenceHours: 24,
  retentionDays: 365,
  maxSubjectsPerSweep: 200,
  evidenceRequiredForTrusted: true,
  autoDisableOnDegraded: true,
  checkpointBeforeDisable: true
};
const LIFECYCLE_SETTING_LIMITS = {
  staleAfterDays: { min: 1, max: 3650 },
  reviewCadenceHours: { min: 1, max: 720 },
  retentionDays: { min: 7, max: 3650 },
  maxSubjectsPerSweep: { min: 1, max: 5000 }
};
const LIFECYCLE_SCHEDULE_LIMITS = {
  intervalMinutes: { min: 15, max: 43200 },
  minLeadTimeMinutes: { min: 0, max: 10080 }
};
const TRUST_RANK = {
  unknown: 0,
  untrusted: 0,
  provisional: 1,
  trusted: 2,
  pinned: 3
};
const CLIENT_HANDOFF_ROUTES = {
  resume: '/memory-manager/trust-metadata/client/resume',
  reconcile: '/memory-manager/trust-metadata/client/reconcile',
  review: '/memory-manager/trust-metadata/client/review',
  checkpoint: '/memory-manager/trust-metadata/client/checkpoint',
  adopt: '/memory-manager/trust-metadata/client/adopt'
};
const PROVIDER_SERVICE_ROUTES = {
  negotiate: '/memory-manager/trust-metadata/provider/negotiate',
  sync: '/memory-manager/trust-metadata/provider/sync',
  export: '/memory-manager/trust-metadata/provider/export',
  handoff: '/memory-manager/trust-metadata/provider/handoff'
};
const PROVIDER_SYNC_MODES = new Set(['checkpoint', 'delta', 'metadata-only']);
const PREVIEW_DECISIONS = new Set(['accept', 'reject', 'defer']);
const MAX_PROVIDER_SYNC_SUBJECT_KEYS = 100;
const PRODUCT_WORKFLOW_PROVIDERS = new Set(['mailchimp', 'hosted-kernel', 'external']);
const PRODUCT_WORKFLOW_STAGES = new Set(['draft', 'preview', 'approval', 'sync', 'sent', 'archived']);
const PROVIDER_CAPABILITIES = [
  'trustMetadata.read',
  'trustMetadata.write',
  'trustMetadata.revoke',
  'trustMetadata.checkpoint',
  'trustMetadata.lifecycle',
  'trustMetadata.analyticsExport',
  'trustMetadata.clientHandoff'
];

function clampRetryAttempt(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX_RETRY_ATTEMPTS) : 1;
}

function retryDelayForAttempt(attempt) {
  const boundedAttempt = clampRetryAttempt(attempt);
  return Math.min(BASE_RETRY_DELAY_MS * (2 ** (boundedAttempt - 1)), MAX_RETRY_DELAY_MS);
}

function commandFailureKind(error) {
  if (!error) {
    return null;
  }

  if (error.includes('unsupported command type') || error.includes('subjectId is required') || error.includes('lifecycle setting')) {
    return 'validation';
  }

  if (error.includes('boundary') || error.includes('permission')) {
    return 'authorization';
  }

  return 'runtime';
}

function actionForFailure(kind, command) {
  if (kind === 'validation') {
    return command.type === 'revokeSubjectTrust' || command.type === 'upsertSubjectTrust'
      ? 'repair command payload with a non-empty subjectId before replay'
      : 'replace unsupported trust metadata command type before replay';
  }

  if (kind === 'authorization') {
    return LIFECYCLE_COMMANDS.has(command.type)
      ? 'route lifecycle command through an actor with tenant/workspace-aligned memory.trust.admin authority'
      : 'route command through an actor with tenant/workspace-aligned memory.trust.write authority';
  }

  if (kind === 'runtime') {
    return 'retry with hosted-kernel backoff and preserve the original commandId for idempotency';
  }

  return 'no action required';
}

function buildFailureState(auditEntry, command) {
  const kind = commandFailureKind(auditEntry.error);
  const retryable = kind === 'runtime';
  const attempt = clampRetryAttempt(command.retryAttempt);
  const nextRetryDelayMs = retryable ? retryDelayForAttempt(attempt) : null;

  return {
    commandId: auditEntry.commandId,
    type: auditEntry.type,
    tenantId: auditEntry.tenantId,
    workspaceId: auditEntry.workspaceId,
    actorId: auditEntry.actorId,
    kind,
    retryable,
    retryAttempt: retryable ? attempt : 0,
    maxRetryAttempts: retryable ? MAX_RETRY_ATTEMPTS : 0,
    nextRetryDelayMs,
    exhausted: retryable ? attempt >= MAX_RETRY_ATTEMPTS : true,
    message: auditEntry.error,
    action: actionForFailure(kind, command),
    proof: proofFor({
      commandId: auditEntry.commandId,
      kind,
      retryable,
      retryAttempt: retryable ? attempt : 0,
      message: auditEntry.error
    })
  };
}

function normalizeCommandLedgerEntry(entry = {}, index = 0) {
  const commandId = typeof entry.commandId === 'string' && entry.commandId.trim()
    ? entry.commandId.trim()
    : `recovered-command:${index}`;
  const type = typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim() : 'checkpoint';
  const scope = normalizeScope(entry);
  const error = typeof entry.error === 'string' && entry.error.trim() ? entry.error.trim() : null;
  const status = ['applied', 'rejected', 'duplicate', 'observed'].includes(entry.status)
    ? entry.status
    : error
      ? 'rejected'
      : 'applied';
  const failureKind = commandFailureKind(error);
  const retryable = Boolean(entry.retryable) || failureKind === 'runtime';
  const retryAttempt = retryable ? clampRetryAttempt(entry.retryAttempt) : 0;
  const exhausted = Boolean(entry.exhausted) || (retryable && retryAttempt >= MAX_RETRY_ATTEMPTS);

  return {
    format: 'aios.trustMetadata.commandLedgerEntry.v1',
    commandId,
    type,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: typeof entry.actorId === 'string' && entry.actorId.trim() ? entry.actorId.trim() : null,
    status,
    error,
    errorKind: failureKind,
    retryable,
    restartSafe: status !== 'rejected' || !retryable || exhausted,
    exhausted,
    retryAttempt,
    beforeEpoch: Number.isSafeInteger(entry.beforeEpoch) && entry.beforeEpoch >= 0 ? entry.beforeEpoch : null,
    afterEpoch: Number.isSafeInteger(entry.afterEpoch) && entry.afterEpoch >= 0 ? entry.afterEpoch : null,
    firstSeenAt: typeof entry.firstSeenAt === 'string' ? entry.firstSeenAt : null,
    lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
    idempotencyKey: commandId,
    replayDisposition: status === 'applied' || status === 'duplicate'
      ? 'skip-already-applied'
      : retryable && !exhausted
        ? 'retry-with-same-command-id'
        : 'manual-review-required',
    proof: typeof entry.proof === 'string'
      ? entry.proof
      : proofFor({ surfaceId, commandId, type, status, error })
  };
}

function normalizeCommandLedger(persistedState = {}) {
  const explicitLedger = Array.isArray(persistedState?.commandLedger)
    ? persistedState.commandLedger
    : Array.isArray(persistedState?.appliedCommands)
      ? persistedState.appliedCommands
      : [];
  const legacyApplied = Array.isArray(persistedState?.appliedCommandIds)
    ? persistedState.appliedCommandIds
    : [];
  const entries = [
    ...explicitLedger,
    ...legacyApplied.map((commandId) => ({ commandId, status: 'applied' }))
  ]
    .map(normalizeCommandLedgerEntry)
    .filter((entry) => entry.commandId);
  const byCommandId = new Map();

  for (const entry of entries) {
    byCommandId.set(entry.commandId, {
      ...byCommandId.get(entry.commandId),
      ...entry
    });
  }

  return [...byCommandId.values()].slice(-MAX_COMMAND_LEDGER_ENTRIES);
}

function commandLedgerEntryFor({ command, result, beforeEpoch, afterEpoch, now }) {
  const errorKind = commandFailureKind(result.error);
  const retryable = errorKind === 'runtime';
  const retryAttempt = retryable ? clampRetryAttempt(command.retryAttempt) : 0;
  const exhausted = retryable ? retryAttempt >= MAX_RETRY_ATTEMPTS : Boolean(result.error);
  const status = result.error ? 'rejected' : result.duplicate ? 'duplicate' : result.applied ? 'applied' : 'observed';

  return normalizeCommandLedgerEntry({
    commandId: command.commandId,
    type: command.type,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    actorId: result.actor?.actorId || null,
    status,
    error: result.error,
    retryable,
    retryAttempt,
    exhausted,
    beforeEpoch,
    afterEpoch,
    firstSeenAt: result.previousLedgerEntry?.firstSeenAt || now,
    lastSeenAt: now,
    proof: proofFor({
      surfaceId,
      commandId: command.commandId,
      status,
      error: result.error,
      beforeEpoch,
      afterEpoch
    })
  });
}

function withCommandLedgerEntry(state, ledgerEntry) {
  const retained = (state.commandLedger || []).filter((entry) => entry.commandId !== ledgerEntry.commandId);
  const commandLedger = [...retained, ledgerEntry].slice(-MAX_COMMAND_LEDGER_ENTRIES);

  return {
    ...state,
    appliedCommandIds: [...new Set([
      ...state.appliedCommandIds,
      ledgerEntry.commandId
    ])],
    commandLedger
  };
}

function findCommandLedgerEntry(state, commandId) {
  return (state.commandLedger || []).find((entry) => entry.commandId === commandId) || null;
}

function canRetryRejectedLedgerEntry(entry, command) {
  if (!entry || entry.status !== 'rejected' || !entry.retryable || entry.exhausted) {
    return false;
  }

  const requestedAttempt = clampRetryAttempt(command.retryAttempt);
  return requestedAttempt > (entry.retryAttempt || 0);
}

function commandBypassesHealthBarrier(command) {
  return command.type === 'checkpoint' || command.type === 'disableTrustLifecycle';
}

function buildLedgerFailureState(entry, command = {}) {
  const kind = entry.errorKind || commandFailureKind(entry.error);
  const retryable = Boolean(entry.retryable) || kind === 'runtime';
  const retryAttempt = retryable ? clampRetryAttempt(command.retryAttempt || entry.retryAttempt) : 0;
  const exhausted = retryable ? Boolean(entry.exhausted) || retryAttempt >= MAX_RETRY_ATTEMPTS : true;
  const nextRetryDelayMs = retryable && !exhausted ? retryDelayForAttempt(retryAttempt + 1) : null;

  return {
    commandId: entry.commandId,
    type: entry.type,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    kind,
    retryable,
    retryAttempt,
    maxRetryAttempts: retryable ? MAX_RETRY_ATTEMPTS : 0,
    nextRetryDelayMs,
    exhausted,
    message: entry.error,
    action: retryable && !exhausted
      ? `retry command ${entry.commandId} with retryAttempt ${retryAttempt + 1} and the same commandId`
      : actionForFailure(kind, command),
    replayDisposition: entry.replayDisposition,
    source: 'command-ledger',
    proof: proofFor({
      commandId: entry.commandId,
      kind,
      retryable,
      retryAttempt,
      exhausted,
      source: 'command-ledger'
    })
  };
}

function buildHealthBarrier({ state, command }) {
  if (commandBypassesHealthBarrier(command)) {
    return { blocked: false, reason: null, blockers: [], proof: proofFor({ surfaceId, commandId: command.commandId, bypass: true }) };
  }

  const rejected = (state.commandLedger || [])
    .filter((entry) => entry.status === 'rejected')
    .map((entry) => buildLedgerFailureState(entry, entry.commandId === command.commandId ? command : {}));
  const openBlockers = rejected.filter((failure) => failure.retryable && !failure.exhausted);
  const manualBlockers = rejected.filter((failure) => !failure.retryable || failure.exhausted);
  const sameCommandRetry = openBlockers.some((failure) => failure.commandId === command.commandId)
    && canRetryRejectedLedgerEntry(findCommandLedgerEntry(state, command.commandId), command);
  const blocked = (openBlockers.length > 0 || manualBlockers.length > 0) && !sameCommandRetry;
  const primary = openBlockers[0] || manualBlockers[0] || null;

  return {
    blocked,
    reason: blocked
      ? `trust metadata degraded by ${primary.commandId}; ${primary.action}`
      : null,
    blockers: [...openBlockers, ...manualBlockers],
    retryingCommandId: sameCommandRetry ? command.commandId : null,
    proof: proofFor({
      surfaceId,
      commandId: command.commandId,
      blocked,
      blockerCommandIds: [...openBlockers, ...manualBlockers].map((failure) => failure.commandId),
      sameCommandRetry
    })
  };
}

function buildRecoveryState({ recoveredState, currentState, audit, now }) {
  const ledger = currentState.commandLedger || [];
  const persistedRejected = ledger.filter((entry) => entry.status === 'rejected');
  const retryable = persistedRejected.filter((entry) => entry.retryable && !entry.exhausted);
  const manualReview = persistedRejected.filter((entry) => !entry.retryable || entry.exhausted);
  const replayedCommandIds = audit.filter((entry) => entry.duplicate).map((entry) => entry.commandId);

  return {
    format: 'aios.trustMetadata.recoveryState.v1',
    generatedAt: now,
    recoveredEpoch: recoveredState.epoch,
    currentEpoch: currentState.epoch,
    ledgerEntryCount: ledger.length,
    persistedRejectedCommandIds: persistedRejected.map((entry) => entry.commandId),
    retryableCommandIds: retryable.map((entry) => entry.commandId),
    manualReviewCommandIds: manualReview.map((entry) => entry.commandId),
    replayedCommandIds,
    restartStatus: retryable.length > 0
      ? 'retry-required'
      : manualReview.length > 0
        ? 'manual-recovery-required'
        : 'restart-safe',
    restartSafe: retryable.length === 0,
    checkpointRequired: currentState.checkpointProof === null || audit.some((entry) => entry.applied),
    recoveryRoute: retryable.length > 0
      ? '/memory-manager/trust-metadata/recovery/retry'
      : manualReview.length > 0
        ? '/memory-manager/trust-metadata/recovery/review'
        : '/memory-manager/trust-metadata/recovery/status',
    proof: proofFor({
      surfaceId,
      epoch: currentState.epoch,
      ledger,
      replayedCommandIds,
      restartSafe: retryable.length === 0
    })
  };
}

function buildOperationalHealth(audit, commands, currentState) {
  const commandsById = new Map(commands.map((command) => [command.commandId, command]));
  const auditFailures = audit
    .filter((entry) => entry.error)
    .map((entry) => buildFailureState(entry, commandsById.get(entry.commandId) || {}));
  const ledgerFailures = (currentState.commandLedger || [])
    .filter((entry) => entry.status === 'rejected')
    .filter((entry) => !auditFailures.some((failure) => failure.commandId === entry.commandId))
    .map((entry) => buildLedgerFailureState(entry, commandsById.get(entry.commandId) || {}));
  const failures = [...auditFailures, ...ledgerFailures];
  const retryableFailures = failures.filter((failure) => failure.retryable && !failure.exhausted);
  const exhaustedRetries = failures.filter((failure) => failure.retryable && failure.exhausted);
  const validationFailures = failures.filter((failure) => failure.kind === 'validation');
  const authorizationFailures = failures.filter((failure) => failure.kind === 'authorization');
  const manualRecoveryFailures = failures.filter((failure) => !failure.retryable || failure.exhausted);
  const hasPinnedSubjects = Object.values(currentState.subjects).some((record) => record.trustLevel === 'pinned');
  const degraded = validationFailures.length > 0 || authorizationFailures.length > 0 || exhaustedRetries.length > 0;
  const retrying = retryableFailures.length > 0 && !degraded;
  const writeBarrierActive = degraded || retrying;
  const primaryFailure = manualRecoveryFailures[0] || retryableFailures[0] || null;

  return {
    status: failures.length === 0 ? 'healthy' : degraded ? 'degraded' : 'retrying',
    degraded,
    retrying,
    mode: writeBarrierActive ? 'read-only-trust-metadata' : 'read-write-trust-metadata',
    writeEnabled: !writeBarrierActive,
    readEnabled: true,
    pinnedTrustStillEnforced: hasPinnedSubjects,
    retryPolicy: {
      baseDelayMs: BASE_RETRY_DELAY_MS,
      maxDelayMs: MAX_RETRY_DELAY_MS,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      retryableKinds: ['runtime']
    },
    failureSources: {
      currentBatchFailureCount: auditFailures.length,
      persistedLedgerFailureCount: ledgerFailures.length,
      proof: proofFor({ surfaceId, auditFailures, ledgerFailures })
    },
    degradedMode: {
      active: writeBarrierActive,
      reason: primaryFailure?.message || null,
      allowedCommandTypes: writeBarrierActive
        ? ['checkpoint', 'disableTrustLifecycle']
        : [...KNOWN_COMMANDS],
      blockedCommandTypes: writeBarrierActive
        ? [...KNOWN_COMMANDS].filter((type) => !['checkpoint', 'disableTrustLifecycle'].includes(type))
        : [],
      recoveryRoute: primaryFailure?.retryable && !primaryFailure.exhausted
        ? '/memory-manager/trust-metadata/recovery/retry'
        : failures.length > 0
          ? '/memory-manager/trust-metadata/recovery/review'
          : '/memory-manager/trust-metadata/recovery/status',
      proof: proofFor({ surfaceId, writeBarrierActive, primaryFailure })
    },
    counters: {
      failureCount: failures.length,
      retryableFailureCount: retryableFailures.length,
      exhaustedRetryCount: exhaustedRetries.length,
      validationFailureCount: validationFailures.length,
      authorizationFailureCount: authorizationFailures.length,
      manualRecoveryFailureCount: manualRecoveryFailures.length
    },
    nextRetryDelayMs: retryableFailures.length > 0
      ? Math.min(...retryableFailures.map((failure) => failure.nextRetryDelayMs))
      : null,
    nextRetryAtMs: retryableFailures.length > 0
      ? Math.min(...retryableFailures.map((failure) => failure.nextRetryDelayMs))
      : null,
    actionableErrors: failures,
    degradedReason: writeBarrierActive
      ? primaryFailure?.message || 'trust metadata command processing degraded'
      : null,
    proof: proofFor({ surfaceId, failures, epoch: currentState.epoch })
  };
}

function normalizeBoundaryPart(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeScope(source = {}) {
  return {
    tenantId: normalizeBoundaryPart(source.tenantId, DEFAULT_TENANT_ID),
    workspaceId: normalizeBoundaryPart(source.workspaceId, DEFAULT_WORKSPACE_ID)
  };
}

function scopedSubjectKey(scope, subjectId) {
  return `${scope.tenantId}/${scope.workspaceId}/${subjectId}`;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
    : [];
}

function normalizeProductWorkflowContext(input = {}, clientRequestSource = {}, runtime = {}) {
  const source = input.productWorkflow && typeof input.productWorkflow === 'object'
    ? input.productWorkflow
    : input.mailchimp && typeof input.mailchimp === 'object'
      ? input.mailchimp
      : clientRequestSource.productWorkflow && typeof clientRequestSource.productWorkflow === 'object'
        ? clientRequestSource.productWorkflow
        : runtime.productWorkflow && typeof runtime.productWorkflow === 'object'
          ? runtime.productWorkflow
          : {};
  const provider = typeof source.provider === 'string' && PRODUCT_WORKFLOW_PROVIDERS.has(source.provider.trim())
    ? source.provider.trim()
    : source.campaignId || source.audienceId || source.segmentId
      ? 'mailchimp'
      : 'hosted-kernel';
  const stage = typeof source.stage === 'string' && PRODUCT_WORKFLOW_STAGES.has(source.stage.trim())
    ? source.stage.trim()
    : source.sentAt
      ? 'sent'
      : source.approvalRequired === true
        ? 'approval'
        : 'preview';
  const campaignId = normalizeBoundaryPart(source.campaignId || source.campaign?.id, null);
  const audienceId = normalizeBoundaryPart(source.audienceId || source.listId || source.audience?.id, null);
  const segmentId = normalizeBoundaryPart(source.segmentId || source.segment?.id, null);
  const workflowId = normalizeBoundaryPart(
    source.workflowId || source.journeyId || source.automationId,
    campaignId ? `mailchimp:${campaignId}` : null
  );
  const requestedTags = normalizeStringList(source.tags || source.mergeTags || source.interests);
  const externalReference = normalizeBoundaryPart(
    source.externalReference || source.externalId || source.url || source.webId,
    null
  );
  const validation = [
    provider === 'mailchimp' && !campaignId ? 'mailchimp.campaignId.required_for_campaign_handoff' : null,
    provider === 'mailchimp' && !audienceId ? 'mailchimp.audienceId.required_for_audience_scoped_trust' : null,
    source.sentAt && !normalizeIsoTimestamp(source.sentAt) ? 'mailchimp.sentAt.invalid_iso_timestamp' : null,
    source.updatedAt && !normalizeIsoTimestamp(source.updatedAt) ? 'mailchimp.updatedAt.invalid_iso_timestamp' : null
  ].filter(Boolean);
  const identityParts = [
    provider,
    workflowId || 'no-workflow',
    campaignId || 'no-campaign',
    audienceId || 'no-audience',
    segmentId || 'no-segment'
  ];

  return {
    format: 'aios.trustMetadata.productWorkflowContext.v1',
    provider,
    stage,
    workflowId,
    campaignId,
    audienceId,
    segmentId,
    externalReference,
    requestedTags,
    approvalRequired: source.approvalRequired === true || stage === 'approval',
    sentAt: normalizeIsoTimestamp(source.sentAt),
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    stateKey: identityParts.join(':'),
    validation,
    valid: validation.length === 0,
    proof: proofFor({ surfaceId, identityParts, stage, requestedTags, validation })
  };
}

function buildMailchimpCampaignContinuityContract({ productWorkflow, clientRequest, currentState, operationalHealth, recoveryState, now }) {
  const applies = productWorkflow.provider === 'mailchimp';
  const scopedSubjectKeys = applies
    ? Object.values(currentState.subjects)
      .filter((record) => record.tenantId === clientRequest.tenantId && record.workspaceId === clientRequest.workspaceId)
      .filter((record) => record.productWorkflow?.stateKey === productWorkflow.stateKey
        || record.subjectId === productWorkflow.campaignId
        || record.subjectId === productWorkflow.audienceId)
      .map((record) => record.subjectKey)
      .sort()
    : [];
  const scopedSubjects = applies
    ? scopedSubjectKeys.map((subjectKey) => currentState.subjects[subjectKey]).filter(Boolean)
    : [];
  const trustDistribution = scopedSubjects.reduce((counts, record) => {
    counts[record.trustLevel] = (counts[record.trustLevel] || 0) + 1;
    return counts;
  }, {});
  const untrustedSubjectKeys = scopedSubjects
    .filter((record) => record.trustLevel === 'untrusted' || record.trustLevel === 'unknown')
    .map((record) => record.subjectKey)
    .sort();
  const reviewSubjectKeys = scopedSubjects
    .filter((record) => record.integrity?.requiresReview || record.integrity?.warnings?.length > 0)
    .map((record) => record.subjectKey)
    .sort();
  const requiredIdentifiers = [
    { field: 'campaignId', present: Boolean(productWorkflow.campaignId) },
    { field: 'audienceId', present: Boolean(productWorkflow.audienceId) }
  ];
  const missingIdentifiers = requiredIdentifiers.filter((item) => !item.present).map((item) => item.field);
  const campaignScoped = scopedSubjectKeys.length > 0;
  const canExportTrustSnapshot = applies
    && missingIdentifiers.length === 0
    && operationalHealth.readEnabled
    && recoveryState.restartSafe;
  const restartSafe = applies
    ? recoveryState.restartSafe && operationalHealth.writeEnabled && missingIdentifiers.length === 0
    : true;
  const auditDisposition = !applies
    ? 'not_applicable'
    : missingIdentifiers.length > 0
      ? 'blocked_missing_mailchimp_scope'
      : !operationalHealth.writeEnabled
        ? 'blocked_trust_metadata_degraded'
        : recoveryState.restartSafe
          ? 'ready_for_campaign_handoff'
          : 'requires_recovery_before_campaign_handoff';
  const readinessBlockedReasons = !applies
    ? []
    : [
      ...missingIdentifiers.map((field) => `mailchimp.${field}.required`),
      ...(!campaignScoped ? ['mailchimp.trust_subject_scope.empty'] : []),
      ...(untrustedSubjectKeys.length > 0 ? ['mailchimp.trust_subjects.untrusted_present'] : []),
      ...(reviewSubjectKeys.length > 0 ? ['mailchimp.trust_subjects.review_required'] : []),
      ...(!operationalHealth.readEnabled ? ['trust_metadata.read_unavailable'] : []),
      ...(!operationalHealth.writeEnabled ? ['trust_metadata.write_barrier_active'] : []),
      ...(!recoveryState.restartSafe ? ['trust_metadata.recovery_required'] : [])
    ];
  const readinessStatus = !applies
    ? 'not_applicable'
    : readinessBlockedReasons.length === 0
      ? 'ready'
      : operationalHealth.retrying
        ? 'retrying'
        : 'blocked';
  const nextAction = !applies
    ? 'observe-hosted-kernel-trust'
    : missingIdentifiers.length > 0
      ? 'provide-mailchimp-campaign-and-audience'
      : !campaignScoped
        ? 'bind-trust-subjects-to-mailchimp-campaign'
        : reviewSubjectKeys.length > 0
          ? 'review-mailchimp-trust-subjects'
          : untrustedSubjectKeys.length > 0
            ? 'repair-untrusted-mailchimp-subjects'
            : !recoveryState.restartSafe
              ? 'recover-trust-metadata-before-mailchimp-handoff'
              : !operationalHealth.writeEnabled
                ? operationalHealth.degradedMode.recoveryRoute
                : 'continue-mailchimp-campaign-handoff';
  const dispatchReadiness = {
    format: 'aios.trustMetadata.mailchimp-campaign-dispatch-readiness.v1',
    status: readinessStatus,
    ready: readinessStatus === 'ready',
    nextAction,
    canExportTrustSnapshot,
    campaignScoped,
    trustDistribution,
    trustedSubjectCount: scopedSubjects.filter((record) => record.trustLevel === 'trusted' || record.trustLevel === 'pinned').length,
    untrustedSubjectKeys,
    reviewSubjectKeys,
    healthStatus: operationalHealth.status,
    healthMode: operationalHealth.mode,
    recoveryStatus: recoveryState.restartStatus,
    blockedReasons: [...new Set(readinessBlockedReasons)],
    proof: proofFor({
      surfaceId,
      stateKey: productWorkflow.stateKey,
      readinessStatus,
      nextAction,
      scopedSubjectKeys,
      untrustedSubjectKeys,
      reviewSubjectKeys,
      healthStatus: operationalHealth.status,
      recoveryStatus: recoveryState.restartStatus
    })
  };

  return {
    format: 'aios.trustMetadata.mailchimp-campaign-continuity.v1',
    generatedAt: now,
    applies,
    provider: productWorkflow.provider,
    stage: productWorkflow.stage,
    tenantId: clientRequest.tenantId,
    workspaceId: clientRequest.workspaceId,
    campaignId: productWorkflow.campaignId,
    audienceId: productWorkflow.audienceId,
    segmentId: productWorkflow.segmentId,
    workflowId: productWorkflow.workflowId,
    stateKey: productWorkflow.stateKey,
    scopedSubjectKeys,
    missingIdentifiers,
    restartSafe,
    auditDisposition,
    dispatchReadiness,
    replayKey: applies
      ? `${clientRequest.tenantId}:${clientRequest.workspaceId}:${productWorkflow.stateKey}`
      : null,
    handoff: {
      route: CLIENT_HANDOFF_ROUTES.resume,
      resumeToken: applies
        ? proofFor({
          surfaceId,
          clientId: clientRequest.clientId,
          requestId: clientRequest.requestId,
          stateKey: productWorkflow.stateKey,
          epoch: currentState.epoch
        })
        : null,
      blockedReasons: [
        ...dispatchReadiness.blockedReasons
      ],
      nextAction: dispatchReadiness.nextAction,
      readinessStatus: dispatchReadiness.status
    },
    exportRecord: {
      dataset: 'mailchimpCampaignContinuity',
      recordId: applies ? `${clientRequest.requestId}:${productWorkflow.stateKey}` : null,
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId,
      subjectCount: scopedSubjectKeys.length,
      ready: dispatchReadiness.ready,
      readinessStatus: dispatchReadiness.status,
      nextAction: dispatchReadiness.nextAction,
      blockedReasons: dispatchReadiness.blockedReasons,
      checksum: proofFor({
        stateKey: productWorkflow.stateKey,
        scopedSubjectKeys,
        auditDisposition,
        restartSafe,
        readinessStatus: dispatchReadiness.status
      })
    },
    proof: proofFor({
      surfaceId,
      applies,
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId,
      stateKey: productWorkflow.stateKey,
      scopedSubjectKeys,
      restartSafe,
      auditDisposition,
      dispatchReadinessProof: dispatchReadiness.proof
    })
  };
}

function boundedInteger(value, fallback, limits) {
  if (!Number.isSafeInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, limits.min), limits.max);
}

function normalizeIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function addMinutesIso(value, minutes) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp + minutes * 60 * 1000).toISOString();
}

function normalizeLifecycleSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};

  return {
    staleAfterDays: boundedInteger(
      source.staleAfterDays,
      DEFAULT_LIFECYCLE_SETTINGS.staleAfterDays,
      LIFECYCLE_SETTING_LIMITS.staleAfterDays
    ),
    reviewCadenceHours: boundedInteger(
      source.reviewCadenceHours,
      DEFAULT_LIFECYCLE_SETTINGS.reviewCadenceHours,
      LIFECYCLE_SETTING_LIMITS.reviewCadenceHours
    ),
    retentionDays: boundedInteger(
      source.retentionDays,
      DEFAULT_LIFECYCLE_SETTINGS.retentionDays,
      LIFECYCLE_SETTING_LIMITS.retentionDays
    ),
    maxSubjectsPerSweep: boundedInteger(
      source.maxSubjectsPerSweep,
      DEFAULT_LIFECYCLE_SETTINGS.maxSubjectsPerSweep,
      LIFECYCLE_SETTING_LIMITS.maxSubjectsPerSweep
    ),
    evidenceRequiredForTrusted: typeof source.evidenceRequiredForTrusted === 'boolean'
      ? source.evidenceRequiredForTrusted
      : DEFAULT_LIFECYCLE_SETTINGS.evidenceRequiredForTrusted,
    autoDisableOnDegraded: typeof source.autoDisableOnDegraded === 'boolean'
      ? source.autoDisableOnDegraded
      : DEFAULT_LIFECYCLE_SETTINGS.autoDisableOnDegraded,
    checkpointBeforeDisable: typeof source.checkpointBeforeDisable === 'boolean'
      ? source.checkpointBeforeDisable
      : DEFAULT_LIFECYCLE_SETTINGS.checkpointBeforeDisable
  };
}

function validateLifecycleSettings(settings) {
  const normalized = normalizeLifecycleSettings(settings);
  const errors = [];

  for (const [key, limits] of Object.entries(LIFECYCLE_SETTING_LIMITS)) {
    if (settings && Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== normalized[key]) {
      errors.push(`lifecycle setting ${key} must be an integer from ${limits.min} to ${limits.max}`);
    }
  }
  if (normalized.retentionDays < normalized.staleAfterDays) {
    errors.push('lifecycle setting retentionDays must be greater than or equal to staleAfterDays');
  }

  return {
    valid: errors.length === 0,
    settings: normalized,
    errors,
    proof: proofFor({ surfaceId, normalized, errors })
  };
}

function normalizeLifecycleSchedule(schedule = {}) {
  const source = schedule && typeof schedule === 'object' ? schedule : {};
  const nextRunAt = normalizeIsoTimestamp(source.nextRunAt);
  const lastRunAt = normalizeIsoTimestamp(source.lastRunAt);
  const pausedUntil = normalizeIsoTimestamp(source.pausedUntil);

  return {
    enabled: source.enabled !== false,
    nextRunAt,
    lastRunAt,
    intervalMinutes: boundedInteger(source.intervalMinutes, 1440, LIFECYCLE_SCHEDULE_LIMITS.intervalMinutes),
    minLeadTimeMinutes: boundedInteger(source.minLeadTimeMinutes, 15, LIFECYCLE_SCHEDULE_LIMITS.minLeadTimeMinutes),
    timezone: typeof source.timezone === 'string' && source.timezone.trim() ? source.timezone.trim() : 'UTC',
    pausedUntil,
    pauseReason: typeof source.pauseReason === 'string' && source.pauseReason.trim()
      ? source.pauseReason.trim()
      : pausedUntil
        ? 'paused by hosted kernel lifecycle schedule'
        : null
  };
}

function validateLifecycleSchedule(schedule, context = {}) {
  const normalized = normalizeLifecycleSchedule(schedule);
  const errors = [];
  const now = normalizeIsoTimestamp(context.now);
  const requireFuture = context.requireFuture === true;

  if (schedule && Object.prototype.hasOwnProperty.call(schedule, 'nextRunAt') && !normalized.nextRunAt) {
    errors.push('lifecycle setting schedule.nextRunAt must be an ISO timestamp');
  }
  if (schedule && Object.prototype.hasOwnProperty.call(schedule, 'intervalMinutes') && schedule.intervalMinutes !== normalized.intervalMinutes) {
    const limits = LIFECYCLE_SCHEDULE_LIMITS.intervalMinutes;
    errors.push(`lifecycle setting schedule.intervalMinutes must be an integer from ${limits.min} to ${limits.max}`);
  }
  if (schedule && Object.prototype.hasOwnProperty.call(schedule, 'minLeadTimeMinutes') && schedule.minLeadTimeMinutes !== normalized.minLeadTimeMinutes) {
    const limits = LIFECYCLE_SCHEDULE_LIMITS.minLeadTimeMinutes;
    errors.push(`lifecycle setting schedule.minLeadTimeMinutes must be an integer from ${limits.min} to ${limits.max}`);
  }
  if (schedule && Object.prototype.hasOwnProperty.call(schedule, 'pausedUntil') && schedule.pausedUntil !== null && !normalized.pausedUntil) {
    errors.push('lifecycle setting schedule.pausedUntil must be an ISO timestamp or null');
  }
  if (now && normalized.pausedUntil && Date.parse(normalized.pausedUntil) <= Date.parse(now)) {
    errors.push('lifecycle setting schedule.pausedUntil must be later than the command time');
  }
  if (now && requireFuture && normalized.nextRunAt) {
    const earliestRunAt = addMinutesIso(now, normalized.minLeadTimeMinutes);
    if (earliestRunAt && Date.parse(normalized.nextRunAt) < Date.parse(earliestRunAt)) {
      errors.push(`lifecycle setting schedule.nextRunAt must be at least ${normalized.minLeadTimeMinutes} minutes after the command time`);
    }
  }
  if (normalized.pausedUntil && normalized.nextRunAt && Date.parse(normalized.nextRunAt) < Date.parse(normalized.pausedUntil)) {
    errors.push('lifecycle setting schedule.nextRunAt cannot occur before schedule.pausedUntil');
  }

  return {
    valid: errors.length === 0,
    schedule: normalized,
    errors,
    proof: proofFor({ surfaceId, normalized, errors })
  };
}

function buildLifecycleScheduleReadiness({ controls, operationalHealth, candidateSubjectKeys, now }) {
  const nowMs = Date.parse(now);
  const nextRunMs = controls.schedule.nextRunAt ? Date.parse(controls.schedule.nextRunAt) : null;
  const pausedUntilMs = controls.schedule.pausedUntil ? Date.parse(controls.schedule.pausedUntil) : null;
  const paused = Boolean(pausedUntilMs && pausedUntilMs > nowMs);
  const due = Boolean(controls.schedule.enabled && nextRunMs !== null && nextRunMs <= nowMs);
  const suspendedByHealth = controls.enabled && controls.settings.autoDisableOnDegraded && operationalHealth.degraded;
  const blockedReason = !controls.enabled
    ? controls.disabledReason
    : !controls.schedule.enabled
      ? 'lifecycle schedule is disabled'
      : paused
        ? controls.schedule.pauseReason || `lifecycle schedule is paused until ${controls.schedule.pausedUntil}`
        : suspendedByHealth
          ? operationalHealth.degradedReason || 'trust metadata health is degraded'
          : null;
  const nextEligibleRunAt = paused
    ? controls.schedule.pausedUntil
    : controls.schedule.nextRunAt || addMinutesIso(now, controls.schedule.minLeadTimeMinutes);
  const canRunNow = controls.enabled
    && controls.schedule.enabled
    && !paused
    && !suspendedByHealth
    && due;

  return {
    format: 'aios.trustMetadata.lifecycleScheduleReadiness.v1',
    status: canRunNow
      ? 'sweep-ready'
      : blockedReason
        ? 'blocked'
        : controls.schedule.nextRunAt
          ? 'scheduled'
          : 'unscheduled',
    enabled: controls.schedule.enabled,
    paused,
    pausedUntil: controls.schedule.pausedUntil,
    pauseReason: controls.schedule.pauseReason,
    due,
    canRunNow,
    blockedReason,
    nextEligibleRunAt,
    candidateSubjectCount: candidateSubjectKeys.length,
    sweepCommandTemplate: canRunNow
      ? {
        type: 'scheduleLifecycleSweep',
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        schedule: {
          enabled: true,
          lastRunAt: now,
          nextRunAt: addMinutesIso(now, controls.schedule.intervalMinutes),
          intervalMinutes: controls.schedule.intervalMinutes,
          minLeadTimeMinutes: controls.schedule.minLeadTimeMinutes,
          timezone: controls.schedule.timezone
        },
        subjectKeys: candidateSubjectKeys,
        proof: proofFor({ surfaceId, now, candidateSubjectKeys, revision: controls.revision })
      }
      : null,
    proof: proofFor({ surfaceId, controls, now, candidateSubjectKeys, blockedReason })
  };
}

function normalizeLifecycleControls(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const settings = normalizeLifecycleSettings(source.settings);
  const schedule = normalizeLifecycleSchedule(source.schedule);

  return {
    format: 'aios.trustMetadata.lifecycleControls.v1',
    enabled: source.enabled === true,
    mode: source.enabled === true ? 'active' : 'disabled',
    disabledReason: typeof source.disabledReason === 'string' && source.disabledReason.trim()
      ? source.disabledReason.trim()
      : source.enabled === true
        ? null
        : 'lifecycle controls have not been enabled',
    settings,
    schedule,
    lastUpdatedAt: typeof source.lastUpdatedAt === 'string' ? source.lastUpdatedAt : null,
    lastActorId: typeof source.lastActorId === 'string' ? source.lastActorId : null,
    lastCommandId: typeof source.lastCommandId === 'string' ? source.lastCommandId : null,
    revision: Number.isSafeInteger(source.revision) && source.revision > 0 ? source.revision : 1,
    proof: proofFor({ surfaceId, enabled: source.enabled === true, settings, schedule })
  };
}

function buildLifecycleRuntimeState({ lifecycleControls, operationalHealth, currentState, now }) {
  const controls = normalizeLifecycleControls(lifecycleControls);
  const subjectRecords = Object.values(currentState.subjects);
  const reviewRequiredSubjectKeys = subjectRecords
    .filter((record) => record.integrity?.requiresReview)
    .map((record) => record.subjectKey)
    .sort();
  const staleSubjectKeys = subjectRecords
    .filter((record) => {
      if (!record.lastUpdatedAt || Number.isNaN(Date.parse(record.lastUpdatedAt))) return false;
      const ageMs = Date.parse(now) - Date.parse(record.lastUpdatedAt);
      return ageMs >= controls.settings.staleAfterDays * 24 * 60 * 60 * 1000;
    })
    .map((record) => record.subjectKey)
    .sort();
  const candidateSubjectKeys = [...new Set([...staleSubjectKeys, ...reviewRequiredSubjectKeys])]
    .sort()
    .slice(0, controls.settings.maxSubjectsPerSweep);
  const scheduleReadiness = buildLifecycleScheduleReadiness({
    controls,
    operationalHealth,
    candidateSubjectKeys,
    now
  });
  const due = scheduleReadiness.due;
  const suspendedByHealth = controls.enabled && controls.settings.autoDisableOnDegraded && operationalHealth.degraded;
  const nextAction = !controls.enabled
    ? {
      actionId: 'enable-trust-lifecycle',
      route: '/memory-manager/trust-metadata/lifecycle/enable',
      required: false,
      reason: controls.disabledReason
    }
    : suspendedByHealth
      ? {
        actionId: 'resolve-lifecycle-health-blocker',
        route: '/memory-manager/trust-metadata/readiness',
        required: true,
        reason: operationalHealth.degradedReason || 'trust metadata health is degraded'
      }
      : scheduleReadiness.paused
        ? {
          actionId: 'resume-lifecycle-schedule',
          route: '/memory-manager/trust-metadata/lifecycle/schedule',
          required: true,
          reason: scheduleReadiness.blockedReason
        }
      : due
        ? {
          actionId: 'run-lifecycle-sweep',
          route: '/memory-manager/trust-metadata/lifecycle/sweep',
          required: true,
          reason: `${staleSubjectKeys.length + reviewRequiredSubjectKeys.length} subjects require lifecycle evaluation`
        }
        : controls.schedule.enabled && controls.schedule.nextRunAt
          ? {
            actionId: 'wait-for-scheduled-sweep',
            route: '/memory-manager/trust-metadata/lifecycle/schedule',
            required: false,
            reason: `next lifecycle sweep scheduled for ${controls.schedule.nextRunAt}`
          }
          : {
            actionId: 'schedule-lifecycle-sweep',
            route: '/memory-manager/trust-metadata/lifecycle/schedule',
            required: true,
            reason: 'lifecycle controls are enabled without a next scheduled sweep'
          };

  return {
    ...controls,
    mode: controls.enabled && !suspendedByHealth ? 'active' : controls.enabled ? 'suspended' : 'disabled',
    canWriteTrustMetadata: controls.enabled && !suspendedByHealth && operationalHealth.writeEnabled,
    canRunScheduledSweep: scheduleReadiness.canRunNow,
    candidateCounts: {
      staleSubjectCount: staleSubjectKeys.length,
      reviewRequiredSubjectCount: reviewRequiredSubjectKeys.length,
      sweepLimit: controls.settings.maxSubjectsPerSweep
    },
    candidateSubjectKeys,
    scheduleReadiness,
    nextAction: {
      ...nextAction,
      proof: proofFor({ surfaceId, nextAction, epoch: currentState.epoch, now })
    },
    routeContract: {
      settingsRoute: '/memory-manager/trust-metadata/lifecycle/settings',
      enableRoute: '/memory-manager/trust-metadata/lifecycle/enable',
      disableRoute: '/memory-manager/trust-metadata/lifecycle/disable',
      scheduleRoute: '/memory-manager/trust-metadata/lifecycle/schedule',
      nextActionRoute: '/memory-manager/trust-metadata/lifecycle/next-action',
      sweepCommandRoute: '/memory-manager/trust-metadata/lifecycle/sweep-command',
      proof: proofFor({ surfaceId, revision: controls.revision, mode: controls.mode })
    },
    proof: proofFor({ surfaceId, controls, operationalHealth, staleSubjectKeys, reviewRequiredSubjectKeys })
  };
}

function normalizeEvidenceItems(value, context = {}) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const source = item && typeof item === 'object'
        ? item
        : { uri: typeof item === 'string' ? item : null };
      const uri = typeof source.uri === 'string' && source.uri.trim()
        ? source.uri.trim()
        : typeof source.source === 'string' && source.source.trim()
          ? source.source.trim()
          : null;
      const evidenceId = typeof source.evidenceId === 'string' && source.evidenceId.trim()
        ? source.evidenceId.trim()
        : uri
          ? proofFor({ uri, index })
          : null;

      if (!uri || !evidenceId) {
        return null;
      }

      const evidenceType = typeof source.evidenceType === 'string' && source.evidenceType.trim()
        ? source.evidenceType.trim()
        : uri.startsWith('http')
          ? 'url'
          : uri.includes(':')
            ? 'artifact'
            : 'note';

      return {
        evidenceId,
        evidenceType,
        uri,
        label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : uri,
        capturedAt: typeof source.capturedAt === 'string' && source.capturedAt.trim()
          ? source.capturedAt.trim()
          : context.now || null,
        actorId: typeof source.actorId === 'string' && source.actorId.trim()
          ? source.actorId.trim()
          : context.actorId || null,
        commandId: typeof source.commandId === 'string' && source.commandId.trim()
          ? source.commandId.trim()
          : context.commandId || null,
        proof: proofFor({ evidenceId, evidenceType, uri, commandId: context.commandId })
      };
    })
    .filter(Boolean);
}

function evidenceUrisFromItems(evidenceItems) {
  return [...new Set(evidenceItems.map((item) => item.uri))];
}

function buildSubjectIntegrity(record) {
  const warnings = [];
  const evidenceItems = normalizeEvidenceItems(record.evidenceItems || record.evidence, {
    actorId: record.lastActorId,
    commandId: record.lastCommandId,
    now: record.lastUpdatedAt
  });
  const rank = TRUST_RANK[record.trustLevel] ?? 0;

  if (rank >= TRUST_RANK.trusted && evidenceItems.length === 0) {
    warnings.push('trusted subjects require at least one evidence item');
  }
  if (!record.lastActorId || !record.lastCommandId) {
    warnings.push('subject provenance is incomplete');
  }
  if (record.trustLevel === 'untrusted' && !record.revokedAt) {
    warnings.push('untrusted subject is missing revokedAt timestamp');
  }

  const recallEligible = rank >= TRUST_RANK.trusted && record.trustLevel !== 'untrusted' && warnings.length === 0;

  return {
    format: 'aios.trustMetadata.subjectIntegrity.v1',
    subjectKey: record.subjectKey,
    trustRank: rank,
    evidenceCount: evidenceItems.length,
    provenanceComplete: Boolean(record.lastActorId && record.lastCommandId),
    recallEligible,
    requiresReview: warnings.length > 0 || record.trustLevel === 'provisional',
    warnings,
    proof: proofFor({
      subjectKey: record.subjectKey,
      trustLevel: record.trustLevel,
      revision: record.revision,
      evidenceItems,
      warnings
    })
  };
}

function shapeSubjectRecord(record) {
  const evidenceItems = normalizeEvidenceItems(record.evidenceItems || record.evidence, {
    actorId: record.lastActorId,
    commandId: record.lastCommandId,
    now: record.lastUpdatedAt
  });
  const shaped = {
    ...record,
    evidence: evidenceUrisFromItems(evidenceItems),
    evidenceItems
  };
  const integrity = buildSubjectIntegrity(shaped);

  return {
    ...shaped,
    integrity,
    recallPolicy: {
      canUseForMemoryRecall: integrity.recallEligible,
      minTrustLevel: 'trusted',
      blockedReason: integrity.recallEligible
        ? null
        : integrity.warnings[0] || `subject trust level ${shaped.trustLevel} is below recall threshold`,
      proof: proofFor({ subjectKey: shaped.subjectKey, integrityProof: integrity.proof })
    },
    routeContract: {
      subjectRoute: `/memory-manager/trust-metadata/subjects/${encodeURIComponent(shaped.subjectKey)}`,
      evidenceRoute: `/memory-manager/trust-metadata/subjects/${encodeURIComponent(shaped.subjectKey)}/evidence`,
      reviewRoute: `/memory-manager/trust-metadata/subjects/${encodeURIComponent(shaped.subjectKey)}/review`,
      proof: proofFor({ subjectKey: shaped.subjectKey, revision: shaped.revision })
    },
    recordProof: proofFor({
      subjectKey: shaped.subjectKey,
      trustLevel: shaped.trustLevel,
      revision: shaped.revision,
      evidenceItems,
      lastCommandId: shaped.lastCommandId
    })
  };
}

function buildSubjectContracts(subjects) {
  const records = Object.values(subjects);
  const recallEligibleSubjectKeys = records
    .filter((record) => record.recallPolicy?.canUseForMemoryRecall)
    .map((record) => record.subjectKey)
    .sort();
  const reviewRequiredSubjectKeys = records
    .filter((record) => record.integrity?.requiresReview)
    .map((record) => record.subjectKey)
    .sort();

  return {
    format: 'aios.trustMetadata.subjectContracts.v1',
    subjectCount: records.length,
    recallEligibleSubjectKeys,
    reviewRequiredSubjectKeys,
    evidenceItemCount: records.reduce((count, record) => count + (record.evidenceItems?.length || 0), 0),
    fields: ['subjectKey', 'trustLevel', 'evidenceItems', 'integrity', 'recallPolicy', 'routeContract', 'recordProof'],
    proof: proofFor({ surfaceId, recallEligibleSubjectKeys, reviewRequiredSubjectKeys })
  };
}

function normalizeClientRuntimeRequest(input = {}) {
  const source = input.clientRequest && typeof input.clientRequest === 'object'
    ? input.clientRequest
    : input.request && typeof input.request === 'object'
      ? input.request
      : {};
  const runtime = input.clientRuntime && typeof input.clientRuntime === 'object' ? input.clientRuntime : {};
  const scope = normalizeScope({
    tenantId: source.tenantId || runtime.tenantId || input.tenantId,
    workspaceId: source.workspaceId || runtime.workspaceId || input.workspaceId
  });
  const requestedCommandIds = normalizeStringList(source.commandIds || source.requestedCommandIds);
  const continuationToken = typeof source.continuationToken === 'string' && source.continuationToken.trim()
    ? source.continuationToken.trim()
    : null;
  const returnRoute = typeof source.returnRoute === 'string' && source.returnRoute.trim()
    ? source.returnRoute.trim()
    : CLIENT_HANDOFF_ROUTES.resume;
  const productWorkflow = normalizeProductWorkflowContext(input, source, runtime);

  return {
    requestId: normalizeBoundaryPart(source.requestId || input.requestId, `request:${scope.tenantId}:${scope.workspaceId}`),
    clientId: normalizeBoundaryPart(source.clientId || runtime.clientId, DEFAULT_CLIENT_ID),
    sessionId: typeof source.sessionId === 'string' && source.sessionId.trim() ? source.sessionId.trim() : null,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    requestedCommandIds,
    continuationToken,
    returnRoute,
    productWorkflow,
    wantsPreview: source.wantsPreview !== false,
    wantsCheckpoint: source.wantsCheckpoint !== false,
    acceptsPartialApply: Boolean(source.acceptsPartialApply),
    proof: proofFor({
      surfaceId,
      requestId: source.requestId || input.requestId,
      clientId: source.clientId || runtime.clientId,
      scope,
      requestedCommandIds,
      continuationToken,
      returnRoute,
      productWorkflow: productWorkflow.proof
    })
  };
}

function normalizeClientRuntimeState(input = {}, clientRequest) {
  const runtime = input.clientRuntime && typeof input.clientRuntime === 'object' ? input.clientRuntime : {};
  const source = input.clientState && typeof input.clientState === 'object'
    ? input.clientState
    : runtime.state && typeof runtime.state === 'object'
      ? runtime.state
      : {};

  return {
    format: 'aios.trustMetadata.clientRuntimeState.v1',
    clientId: clientRequest.clientId,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId,
    tenantId: clientRequest.tenantId,
    workspaceId: clientRequest.workspaceId,
    trustMetadataEpoch: Number.isSafeInteger(source.trustMetadataEpoch) && source.trustMetadataEpoch >= 0
      ? source.trustMetadataEpoch
      : null,
    readinessStatus: typeof source.readinessStatus === 'string' && source.readinessStatus.trim()
      ? source.readinessStatus.trim()
      : null,
    healthStatus: typeof source.healthStatus === 'string' && source.healthStatus.trim()
      ? source.healthStatus.trim()
      : null,
    acceptedCommandIds: normalizeStringList(source.acceptedCommandIds),
    rejectedCommandIds: normalizeStringList(source.rejectedCommandIds),
    missingCommandIds: normalizeStringList(source.missingCommandIds),
    pendingCommandIds: normalizeStringList(source.pendingCommandIds),
    lastResumeToken: typeof source.lastResumeToken === 'string' && source.lastResumeToken.trim()
      ? source.lastResumeToken.trim()
      : null,
    previewProof: typeof source.previewProof === 'string' && source.previewProof.trim()
      ? source.previewProof.trim()
      : null,
    analyticsSnapshotId: typeof source.analyticsSnapshotId === 'string' && source.analyticsSnapshotId.trim()
      ? source.analyticsSnapshotId.trim()
      : null,
    proof: proofFor({ surfaceId, clientRequest, source })
  };
}

function appendUnique(base, additions) {
  return [...new Set([...normalizeStringList(base), ...normalizeStringList(additions)])];
}

function normalizeActor(actor) {
  const source = actor && typeof actor === 'object' ? actor : null;
  const roles = source ? normalizeStringList(source.roles) : ['kernel'];
  const permissions = source ? normalizeStringList(source.permissions) : ['memory.trust.admin'];
  const workspaceIds = source ? normalizeStringList(source.workspaceIds) : [WORKSPACE_WILDCARD];

  return {
    actorId: normalizeBoundaryPart(source?.actorId, 'kernel-system'),
    tenantId: typeof source?.tenantId === 'string' ? source.tenantId.trim() : null,
    workspaceIds,
    roles,
    permissions,
    canWriteTrust: roles.some((role) => TRUST_WRITE_ROLES.has(role))
      || permissions.some((permission) => TRUST_WRITE_PERMISSIONS.has(permission))
  };
}

function actorHasAny(actor, roleSet, permissionSet) {
  return actor.roles.some((role) => roleSet.has(role))
    || actor.permissions.some((permission) => permissionSet.has(permission));
}

function requiredAuthorityForCommand(command) {
  if (command.type === 'checkpoint') {
    return { roles: new Set(), permissions: new Set(), label: 'checkpoint' };
  }

  if (LIFECYCLE_COMMANDS.has(command.type)) {
    return {
      roles: TRUST_ADMIN_ROLES,
      permissions: TRUST_ADMIN_PERMISSIONS,
      label: 'memory.trust.admin'
    };
  }

  if (command.type === 'revokeSubjectTrust') {
    return {
      roles: TRUST_REVOKE_ROLES,
      permissions: TRUST_REVOKE_PERMISSIONS,
      label: 'memory.trust.revoke'
    };
  }

  if (command.trustLevel === 'pinned') {
    return {
      roles: TRUST_ADMIN_ROLES,
      permissions: TRUST_ADMIN_PERMISSIONS,
      label: 'memory.trust.admin'
    };
  }

  return {
    roles: TRUST_WRITE_ROLES,
    permissions: TRUST_WRITE_PERMISSIONS,
    label: 'memory.trust.write'
  };
}

function authorizeBoundary(command, scope) {
  if (command.type === 'checkpoint') {
    return { allowed: true, reason: null, actor: normalizeActor(command.actor) };
  }

  const actor = normalizeActor(command.actor);
  const requiredAuthority = requiredAuthorityForCommand(command);
  if (!actorHasAny(actor, requiredAuthority.roles, requiredAuthority.permissions)) {
    return { allowed: false, reason: `actor lacks ${requiredAuthority.label} permission`, actor };
  }

  if (actor.tenantId && actor.tenantId !== scope.tenantId) {
    return { allowed: false, reason: 'actor tenant boundary mismatch', actor };
  }

  const hasWorkspaceGrant = actor.workspaceIds.includes(WORKSPACE_WILDCARD)
    || actor.workspaceIds.includes(scope.workspaceId);
  if (actor.workspaceIds.length > 0 && !hasWorkspaceGrant) {
    return { allowed: false, reason: 'actor workspace boundary mismatch', actor };
  }

  return { allowed: true, reason: null, actor };
}

function normalizeExpectedSubjectScope(command) {
  const source = command.expectedSubjectScope && typeof command.expectedSubjectScope === 'object'
    ? command.expectedSubjectScope
    : null;

  if (!source) {
    return null;
  }

  return {
    tenantId: normalizeBoundaryPart(source.tenantId, command.tenantId),
    workspaceId: normalizeBoundaryPart(source.workspaceId, command.workspaceId)
  };
}

function subjectBoundaryViolation(command, previous) {
  if (!previous) {
    return null;
  }

  const expected = normalizeExpectedSubjectScope(command);
  if (expected && (previous.tenantId !== expected.tenantId || previous.workspaceId !== expected.workspaceId)) {
    return 'subject expected scope does not match persisted trust metadata boundary';
  }

  if (previous.tenantId !== command.tenantId || previous.workspaceId !== command.workspaceId) {
    return 'subject trust metadata cannot be moved across tenant/workspace boundary';
  }

  return null;
}

function summarizeBoundaryAudit(audit) {
  const rejected = audit.filter((entry) => entry.error);
  const byTenantWorkspace = {};
  const byActor = {};

  for (const entry of rejected) {
    const boundaryKey = `${entry.tenantId}/${entry.workspaceId}`;
    byTenantWorkspace[boundaryKey] = (byTenantWorkspace[boundaryKey] || 0) + 1;

    const actorKey = entry.actorId || 'unknown-actor';
    byActor[actorKey] = (byActor[actorKey] || 0) + 1;
  }

  return {
    rejectedCount: rejected.length,
    byTenantWorkspace,
    byActor,
    proof: proofFor({ surfaceId, rejected })
  };
}

function incrementCounter(target, key, amount = 1) {
  const counterKey = typeof key === 'string' && key ? key : 'unknown';
  target[counterKey] = (target[counterKey] || 0) + amount;
}

function normalizeAnalyticsHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .slice(-MAX_ANALYTICS_HISTORY_SNAPSHOTS)
    .map((snapshot, index) => ({
      snapshotId: typeof snapshot.snapshotId === 'string' && snapshot.snapshotId
        ? snapshot.snapshotId
        : `recovered-snapshot:${index}`,
      capturedAt: typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : null,
      epoch: Number.isSafeInteger(snapshot.epoch) && snapshot.epoch >= 0 ? snapshot.epoch : 0,
      subjectCount: Number.isSafeInteger(snapshot.subjectCount) && snapshot.subjectCount >= 0
        ? snapshot.subjectCount
        : 0,
      trustedSubjectCount: Number.isSafeInteger(snapshot.trustedSubjectCount) && snapshot.trustedSubjectCount >= 0
        ? snapshot.trustedSubjectCount
        : 0,
      rejectedCommandCount: Number.isSafeInteger(snapshot.rejectedCommandCount) && snapshot.rejectedCommandCount >= 0
        ? snapshot.rejectedCommandCount
        : 0,
      commandTotalCount: Number.isSafeInteger(snapshot.commandTotalCount) && snapshot.commandTotalCount >= 0
        ? snapshot.commandTotalCount
        : 0,
      recallEligibleSubjectCount: Number.isSafeInteger(snapshot.recallEligibleSubjectCount) && snapshot.recallEligibleSubjectCount >= 0
        ? snapshot.recallEligibleSubjectCount
        : 0,
      reviewRequiredSubjectCount: Number.isSafeInteger(snapshot.reviewRequiredSubjectCount) && snapshot.reviewRequiredSubjectCount >= 0
        ? snapshot.reviewRequiredSubjectCount
        : 0,
      evidenceItemCount: Number.isSafeInteger(snapshot.evidenceItemCount) && snapshot.evidenceItemCount >= 0
        ? snapshot.evidenceItemCount
        : 0,
      exportSequence: Number.isSafeInteger(snapshot.exportSequence) && snapshot.exportSequence >= 0
        ? snapshot.exportSequence
        : index + 1,
      degraded: Boolean(snapshot.degraded),
      delta: snapshot.delta && typeof snapshot.delta === 'object' ? snapshot.delta : null,
      proof: typeof snapshot.proof === 'string' ? snapshot.proof : null
    }));
}

function buildTrustDistribution(subjects) {
  const distribution = Object.fromEntries([...TRUST_LEVELS].map((trustLevel) => [trustLevel, 0]));

  for (const record of Object.values(subjects)) {
    incrementCounter(distribution, TRUST_LEVELS.has(record.trustLevel) ? record.trustLevel : 'unknown');
  }

  return distribution;
}

function buildTimelineEvents(audit, commands) {
  const commandsById = new Map(commands.map((command) => [command.commandId, command]));

  return audit.slice(-MAX_TIMELINE_EVENTS).map((entry, index) => {
    const command = commandsById.get(entry.commandId) || {};
    const eventKind = entry.error ? 'rejected' : entry.duplicate ? 'duplicate' : entry.applied ? 'applied' : 'observed';

    return {
      eventId: `${entry.commandId}:${entry.afterEpoch}:${index}`,
      commandId: entry.commandId,
      type: entry.type,
      subjectId: typeof command.subjectId === 'string' && command.subjectId.trim()
        ? command.subjectId.trim()
        : null,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      actorId: entry.actorId,
      eventKind,
      beforeEpoch: entry.beforeEpoch,
      afterEpoch: entry.afterEpoch,
      errorKind: commandFailureKind(entry.error),
      proof: proofFor({
        commandId: entry.commandId,
        eventKind,
        beforeEpoch: entry.beforeEpoch,
        afterEpoch: entry.afterEpoch,
        error: entry.error
      })
    };
  });
}

function buildSubjectAnalyticsCounters(recoveredSubjects, currentSubjects) {
  const counters = {
    total: Object.keys(currentSubjects).length,
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    revoked: 0,
    byTrustLevel: Object.fromEntries([...TRUST_LEVELS].map((trustLevel) => [trustLevel, 0])),
    byTransition: {},
    byTenantWorkspace: {},
    evidenceItemCount: 0,
    evidenceBackedTrustedCount: 0,
    missingEvidenceTrustedCount: 0,
    recallEligibleSubjectCount: 0,
    reviewRequiredSubjectCount: 0
  };

  for (const record of Object.values(currentSubjects)) {
    const previous = recoveredSubjects[record.subjectKey] || null;
    const previousTrustLevel = previous?.trustLevel || 'new';
    const currentTrustLevel = TRUST_LEVELS.has(record.trustLevel) ? record.trustLevel : 'unknown';
    const transitionKey = `${previousTrustLevel}->${currentTrustLevel}`;
    const tenantWorkspaceKey = `${record.tenantId}/${record.workspaceId}`;
    const evidenceItemCount = record.evidenceItems?.length || 0;

    incrementCounter(counters.byTrustLevel, currentTrustLevel);
    incrementCounter(counters.byTransition, transitionKey);
    incrementCounter(counters.byTenantWorkspace, tenantWorkspaceKey);
    counters.evidenceItemCount += evidenceItemCount;
    if (!previous) counters.created += 1;
    else if (previous.recordProof !== record.recordProof || previous.revision !== record.revision) counters.updated += 1;
    else counters.unchanged += 1;
    if (currentTrustLevel === 'untrusted') counters.revoked += 1;
    if (record.recallPolicy?.canUseForMemoryRecall) counters.recallEligibleSubjectCount += 1;
    if (record.integrity?.requiresReview) counters.reviewRequiredSubjectCount += 1;
    if (TRUST_RANK[currentTrustLevel] >= TRUST_RANK.trusted && evidenceItemCount > 0) counters.evidenceBackedTrustedCount += 1;
    if (TRUST_RANK[currentTrustLevel] >= TRUST_RANK.trusted && evidenceItemCount === 0) counters.missingEvidenceTrustedCount += 1;
  }

  for (const subjectKey of Object.keys(recoveredSubjects)) {
    if (!currentSubjects[subjectKey]) {
      counters.removed += 1;
      incrementCounter(counters.byTransition, `${recoveredSubjects[subjectKey].trustLevel || 'unknown'}->removed`);
    }
  }

  return {
    ...counters,
    proof: proofFor({ surfaceId, counters })
  };
}

function buildAnalyticsSnapshotDelta(history, snapshot) {
  const previous = history.length > 0 ? history[history.length - 1] : null;
  const delta = previous
    ? {
      fromSnapshotId: previous.snapshotId,
      toSnapshotId: snapshot.snapshotId,
      epochDelta: snapshot.epoch - previous.epoch,
      subjectCountDelta: snapshot.subjectCount - previous.subjectCount,
      trustedSubjectCountDelta: snapshot.trustedSubjectCount - previous.trustedSubjectCount,
      rejectedCommandCountDelta: snapshot.rejectedCommandCount - previous.rejectedCommandCount,
      commandTotalCountDelta: snapshot.commandTotalCount - previous.commandTotalCount,
      recallEligibleSubjectCountDelta: snapshot.recallEligibleSubjectCount - previous.recallEligibleSubjectCount,
      reviewRequiredSubjectCountDelta: snapshot.reviewRequiredSubjectCount - previous.reviewRequiredSubjectCount,
      healthTransition: `${previous.degraded ? 'degraded' : 'healthy'}->${snapshot.degraded ? 'degraded' : 'healthy'}`
    }
    : {
      fromSnapshotId: null,
      toSnapshotId: snapshot.snapshotId,
      epochDelta: snapshot.epoch,
      subjectCountDelta: snapshot.subjectCount,
      trustedSubjectCountDelta: snapshot.trustedSubjectCount,
      rejectedCommandCountDelta: snapshot.rejectedCommandCount,
      commandTotalCountDelta: snapshot.commandTotalCount,
      recallEligibleSubjectCountDelta: snapshot.recallEligibleSubjectCount,
      reviewRequiredSubjectCountDelta: snapshot.reviewRequiredSubjectCount,
      healthTransition: `none->${snapshot.degraded ? 'degraded' : 'healthy'}`
    };

  return {
    ...delta,
    proof: proofFor({ surfaceId, delta })
  };
}

function buildTimelineReportingState({ timeline, audit, currentState, now }) {
  const byEventKind = {};
  const byErrorKind = {};
  const byTenantWorkspace = {};
  const latestEvent = timeline.length > 0 ? timeline[timeline.length - 1] : null;

  for (const event of timeline) {
    incrementCounter(byEventKind, event.eventKind);
    incrementCounter(byTenantWorkspace, `${event.tenantId}/${event.workspaceId}`);
    if (event.errorKind) {
      incrementCounter(byErrorKind, event.errorKind);
    }
  }

  return {
    format: 'aios.trustMetadata.timelineReporting.v1',
    generatedAt: now,
    retainedEventCount: timeline.length,
    sourceAuditCount: audit.length,
    truncated: audit.length > timeline.length,
    cursor: proofFor({
      surfaceId,
      epoch: currentState.epoch,
      latestEventId: latestEvent?.eventId || null,
      retainedEventCount: timeline.length
    }),
    latestEventId: latestEvent?.eventId || null,
    byEventKind,
    byErrorKind,
    byTenantWorkspace,
    routes: {
      timelineRoute: '/memory-manager/trust-metadata/analytics/timeline',
      summaryRoute: '/memory-manager/trust-metadata/analytics/summary',
      historyRoute: '/memory-manager/trust-metadata/analytics/history'
    },
    proof: proofFor({ surfaceId, timeline, byEventKind, byErrorKind, currentEpoch: currentState.epoch })
  };
}

function ratioPercent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 10000) / 100;
}

function buildAnalyticsTrendReport({ history, snapshot, subjectCounters, commandCounters, timelineReporting, operationalHealth, now }) {
  const retainedWindow = history.slice(-Math.min(history.length, MAX_ANALYTICS_HISTORY_SNAPSHOTS));
  const first = retainedWindow[0] || snapshot;
  const last = retainedWindow[retainedWindow.length - 1] || snapshot;
  const rejectedDelta = last.rejectedCommandCount - first.rejectedCommandCount;
  const commandDelta = last.commandTotalCount - first.commandTotalCount;
  const reviewDelta = last.reviewRequiredSubjectCount - first.reviewRequiredSubjectCount;
  const recallDelta = last.recallEligibleSubjectCount - first.recallEligibleSubjectCount;
  const degradedSnapshotCount = retainedWindow.filter((entry) => entry.degraded).length;
  const riskSignals = [];

  if (operationalHealth.degraded) {
    riskSignals.push({
      signalId: 'operational-health-degraded',
      severity: 'high',
      message: operationalHealth.degradedReason || 'trust metadata writes are degraded',
      route: operationalHealth.degradedMode.recoveryRoute
    });
  }
  if (subjectCounters.missingEvidenceTrustedCount > 0) {
    riskSignals.push({
      signalId: 'trusted-subjects-missing-evidence',
      severity: 'medium',
      message: `${subjectCounters.missingEvidenceTrustedCount} trusted or pinned subjects are missing evidence`,
      route: '/memory-manager/trust-metadata/analytics/evidence-gaps'
    });
  }
  if (reviewDelta > 0) {
    riskSignals.push({
      signalId: 'review-backlog-growing',
      severity: 'medium',
      message: `review required subject count increased by ${reviewDelta} in the retained analytics window`,
      route: '/memory-manager/trust-metadata/analytics/review-backlog'
    });
  }
  if (commandCounters.rejected > 0 || rejectedDelta > 0) {
    riskSignals.push({
      signalId: 'command-rejections-observed',
      severity: commandCounters.rejected > 0 ? 'high' : 'medium',
      message: `${commandCounters.rejected} current command rejections; retained rejection delta ${rejectedDelta}`,
      route: '/memory-manager/trust-metadata/validation-summary'
    });
  }

  const status = riskSignals.some((signal) => signal.severity === 'high')
    ? 'attention-required'
    : riskSignals.length > 0
      ? 'watch'
      : 'stable';
  const exportRecords = [
    {
      dataset: 'trendReport',
      recordId: snapshot.snapshotId,
      mediaType: 'application/vnd.aios.trust-metadata.analytics-trend+json;version=1',
      checksum: proofFor({ surfaceId, snapshotId: snapshot.snapshotId, riskSignals, retainedWindow }),
      route: '/memory-manager/trust-metadata/analytics/trend-report'
    },
    {
      dataset: 'history',
      recordId: `${first.snapshotId}:${last.snapshotId}`,
      mediaType: 'application/vnd.aios.trust-metadata.analytics-history+jsonl;version=1',
      checksum: proofFor({ surfaceId, retainedWindow }),
      route: '/memory-manager/trust-metadata/analytics/history'
    }
  ];

  return {
    format: 'aios.trustMetadata.analyticsTrendReport.v1',
    generatedAt: now,
    status,
    window: {
      retainedSnapshotCount: retainedWindow.length,
      firstSnapshotId: first.snapshotId,
      latestSnapshotId: last.snapshotId,
      firstCapturedAt: first.capturedAt,
      latestCapturedAt: last.capturedAt,
      degradedSnapshotCount,
      proof: proofFor({ surfaceId, first, last, degradedSnapshotCount })
    },
    deltas: {
      epochDelta: last.epoch - first.epoch,
      subjectCountDelta: last.subjectCount - first.subjectCount,
      trustedSubjectCountDelta: last.trustedSubjectCount - first.trustedSubjectCount,
      rejectedCommandCountDelta: rejectedDelta,
      commandTotalCountDelta: commandDelta,
      reviewRequiredSubjectCountDelta: reviewDelta,
      recallEligibleSubjectCountDelta: recallDelta,
      evidenceItemCountDelta: last.evidenceItemCount - first.evidenceItemCount,
      proof: proofFor({ surfaceId, firstSnapshotId: first.snapshotId, latestSnapshotId: last.snapshotId, rejectedDelta, commandDelta, reviewDelta, recallDelta })
    },
    rates: {
      currentRejectedCommandRatePercent: ratioPercent(commandCounters.rejected, commandCounters.total),
      retainedRejectedCommandRatePercent: ratioPercent(rejectedDelta, commandDelta),
      reviewRequiredSubjectRatePercent: ratioPercent(snapshot.reviewRequiredSubjectCount, snapshot.subjectCount),
      recallEligibleSubjectRatePercent: ratioPercent(snapshot.recallEligibleSubjectCount, snapshot.subjectCount),
      evidenceBackedTrustedRatePercent: ratioPercent(subjectCounters.evidenceBackedTrustedCount, snapshot.trustedSubjectCount),
      timelineErrorEventRatePercent: ratioPercent(
        Object.values(timelineReporting.byErrorKind).reduce((total, count) => total + count, 0),
        timelineReporting.retainedEventCount
      )
    },
    riskSignals: riskSignals.map((signal) => ({
      ...signal,
      proof: proofFor({ surfaceId, signal, snapshotId: snapshot.snapshotId })
    })),
    routes: {
      trendReportRoute: '/memory-manager/trust-metadata/analytics/trend-report',
      riskSignalsRoute: '/memory-manager/trust-metadata/analytics/risk-signals',
      evidenceGapsRoute: '/memory-manager/trust-metadata/analytics/evidence-gaps',
      reviewBacklogRoute: '/memory-manager/trust-metadata/analytics/review-backlog'
    },
    exportRecords,
    proof: proofFor({ surfaceId, status, snapshot, riskSignals, exportRecords })
  };
}

function buildAnalyticsExportPackage({ exportSummary, snapshot, history, timeline, subjectCounters, timelineReporting, trendReport, now }) {
  const exportId = proofFor({
    surfaceId,
    snapshotId: snapshot.snapshotId,
    historyCount: history.length,
    timelineCursor: timelineReporting.cursor,
    subjectCountersProof: subjectCounters.proof,
    trendReportProof: trendReport.proof
  });

  return {
    format: 'aios.trustMetadata.analyticsExportPackage.v1',
    exportId,
    generatedAt: now,
    mediaTypes: ANALYTICS_EXPORT_FORMATS.map((format) => `application/vnd.aios.trust-metadata.analytics-${format};version=1`),
    datasets: ANALYTICS_EXPORT_DATASETS,
    manifest: {
      summary: {
        recordCount: 1,
        proof: exportSummary.proof
      },
      history: {
        recordCount: history.length,
        latestSnapshotId: snapshot.snapshotId,
        proof: proofFor({ surfaceId, history })
      },
      timeline: {
        recordCount: timeline.length,
        cursor: timelineReporting.cursor,
        truncated: timelineReporting.truncated,
        proof: timelineReporting.proof
      },
      subjectTransitions: {
        recordCount: Object.keys(subjectCounters.byTransition).length,
        proof: subjectCounters.proof
      },
      trendReport: {
        recordCount: 1,
        status: trendReport.status,
        riskSignalCount: trendReport.riskSignals.length,
        exportRecords: trendReport.exportRecords,
        proof: trendReport.proof
      }
    },
    integrity: {
      snapshotProof: snapshot.proof,
      exportSummaryProof: exportSummary.proof,
      timelineProof: timelineReporting.proof,
      subjectCountersProof: subjectCounters.proof,
      trendReportProof: trendReport.proof,
      proof: proofFor({ surfaceId, exportSummary, snapshot, timelineReporting, subjectCounters, trendReport })
    },
    proof: proofFor({ surfaceId, exportId, generatedAt: now })
  };
}

function buildAnalyticsReport({ recoveredState, currentState, commands, audit, operationalHealth, now }) {
  const commandCounters = {
    total: commands.length,
    applied: 0,
    duplicate: 0,
    rejected: 0,
    byType: {},
    byOutcome: {},
    byActor: {},
    byTenantWorkspace: {}
  };

  for (const entry of audit) {
    const outcome = entry.error ? 'rejected' : entry.duplicate ? 'duplicate' : entry.applied ? 'applied' : 'observed';
    if (entry.applied) commandCounters.applied += 1;
    if (entry.duplicate) commandCounters.duplicate += 1;
    if (entry.error) commandCounters.rejected += 1;
    incrementCounter(commandCounters.byType, entry.type);
    incrementCounter(commandCounters.byOutcome, outcome);
    incrementCounter(commandCounters.byActor, entry.actorId || 'unknown-actor');
    incrementCounter(commandCounters.byTenantWorkspace, `${entry.tenantId}/${entry.workspaceId}`);
  }

  const trustDistribution = buildTrustDistribution(currentState.subjects);
  const subjectCounters = buildSubjectAnalyticsCounters(recoveredState.subjects, currentState.subjects);
  const subjectCount = Object.keys(currentState.subjects).length;
  const trustedSubjectCount = trustDistribution.trusted + trustDistribution.pinned;
  const rejectedCommandCount = commandCounters.rejected;
  const baseHistory = normalizeAnalyticsHistory(recoveredState.analyticsHistory || []);
  const exportSequence = baseHistory.length > 0
    ? Math.max(...baseHistory.map((entry) => entry.exportSequence || 0)) + 1
    : 1;
  const snapshotId = proofFor({
    surfaceId,
    epoch: currentState.epoch,
    subjectCount,
    trustedSubjectCount,
    rejectedCommandCount,
    commandTotalCount: commandCounters.total,
    exportSequence,
    now
  });
  const snapshotBase = {
    snapshotId,
    capturedAt: now,
    epoch: currentState.epoch,
    subjectCount,
    trustedSubjectCount,
    rejectedCommandCount,
    commandTotalCount: commandCounters.total,
    recallEligibleSubjectCount: subjectCounters.recallEligibleSubjectCount,
    reviewRequiredSubjectCount: subjectCounters.reviewRequiredSubjectCount,
    evidenceItemCount: subjectCounters.evidenceItemCount,
    exportSequence,
    degraded: operationalHealth.degraded
  };
  const snapshotDelta = buildAnalyticsSnapshotDelta(baseHistory, snapshotBase);
  const snapshot = {
    ...snapshotBase,
    delta: snapshotDelta,
    proof: proofFor({ surfaceId, epoch: currentState.epoch, audit, trustDistribution, subjectCounters, snapshotDelta })
  };
  const history = normalizeAnalyticsHistory([
    ...baseHistory,
    snapshot
  ]);
  const timeline = buildTimelineEvents(audit, commands);
  const timelineReporting = buildTimelineReportingState({
    timeline,
    audit,
    currentState,
    now
  });
  const trendReport = buildAnalyticsTrendReport({
    history,
    snapshot,
    subjectCounters,
    commandCounters,
    timelineReporting,
    operationalHealth,
    now
  });
  const exportSummary = {
    snapshotId: proofFor({
      surfaceId,
      epoch: currentState.epoch,
      subjectCount,
      trustedSubjectCount,
      rejectedCommandCount,
      now
    }),
    format: 'aios.trustMetadata.analytics.v1',
    generatedAt: now,
    surfaceId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    epoch: currentState.epoch,
    status: operationalHealth.status,
    counters: commandCounters,
    subjectCounters,
    trustDistribution,
    latestSnapshotId: snapshot.snapshotId,
    timelineEventCount: timeline.length,
    historySnapshotCount: history.length,
    timelineCursor: timelineReporting.cursor,
    trendStatus: trendReport.status,
    riskSignalCount: trendReport.riskSignals.length,
    exportRecords: trendReport.exportRecords,
    exportDatasets: ANALYTICS_EXPORT_DATASETS,
    proof: proofFor({ surfaceId, commandCounters, subjectCounters, trustDistribution, timeline, history, trendReport })
  };
  const exportPackage = buildAnalyticsExportPackage({
    exportSummary,
    snapshot,
    history,
    timeline,
    subjectCounters,
    timelineReporting,
    trendReport,
    now
  });

  return {
    counters: commandCounters,
    subjectCounters,
    trustDistribution,
    history,
    snapshot,
    timeline,
    timelineReporting,
    trendReport,
    exportSummary,
    exportPackage,
    reporting: {
      reportKey: `${surfaceGroup}.${surfaceName}.analytics`,
      sink: 'hosted-kernel.memory-manager.trust-metadata.analytics',
      exportReady: true,
      exportFormats: ANALYTICS_EXPORT_FORMATS,
      exportDatasets: ANALYTICS_EXPORT_DATASETS,
      exportPackageId: exportPackage.exportId,
      retainedSnapshotLimit: MAX_ANALYTICS_HISTORY_SNAPSHOTS,
      retainedTimelineLimit: MAX_TIMELINE_EVENTS,
      timelineCursor: timelineReporting.cursor,
      trendStatus: trendReport.status,
      riskSignalCount: trendReport.riskSignals.length,
      riskSignalsRoute: trendReport.routes.riskSignalsRoute,
      proof: proofFor({ surfaceId, snapshot, exportSummary, exportPackage, timelineReporting, trendReport })
    }
  };
}

function buildUserVisiblePreview({ commands, audit, currentState, operationalHealth, now }) {
  const commandsById = new Map(commands.map((command) => [command.commandId, command]));
  const previews = audit.map((entry) => {
    const command = commandsById.get(entry.commandId) || {};
    const subjectId = typeof command.subjectId === 'string' && command.subjectId.trim()
      ? command.subjectId.trim()
      : null;
    const subjectKey = subjectId ? scopedSubjectKey(entry, subjectId) : null;
    const resultingSubject = subjectKey ? currentState.subjects[subjectKey] || null : null;
    const errorKind = commandFailureKind(entry.error);
    const acceptanceStatus = entry.error
      ? 'rejected'
      : entry.duplicate
        ? 'already-accepted'
        : entry.applied
          ? 'accepted'
          : 'observed';

    return {
      commandId: entry.commandId,
      type: entry.type,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      actorId: entry.actorId,
      subjectId,
      subjectKey,
      acceptanceStatus,
      userVisible: true,
      appliedEpoch: entry.applied ? entry.afterEpoch : null,
      beforeEpoch: entry.beforeEpoch,
      afterEpoch: entry.afterEpoch,
      validation: {
        valid: !entry.error,
        errorKind,
        message: entry.error,
        requiredFix: entry.error ? actionForFailure(errorKind, command) : null
      },
      resultingTrustLevel: resultingSubject?.trustLevel || null,
      resultingRevision: resultingSubject?.revision || null,
      previewText: entry.error
        ? `${entry.type} rejected for ${entry.tenantId}/${entry.workspaceId}`
        : subjectId
          ? `${entry.type} ${acceptanceStatus} for ${subjectId}`
          : `${entry.type} ${acceptanceStatus}`,
      proof: proofFor({
        commandId: entry.commandId,
        acceptanceStatus,
        subjectKey,
        afterEpoch: entry.afterEpoch,
        error: entry.error
      })
    };
  });

  const validationSummary = previews.reduce((summary, preview) => {
    summary.total += 1;
    incrementCounter(summary.byAcceptanceStatus, preview.acceptanceStatus);
    if (!preview.validation.valid) {
      summary.invalid += 1;
      incrementCounter(summary.byErrorKind, preview.validation.errorKind);
    }
    if (preview.type === 'upsertSubjectTrust' && !preview.subjectId) {
      summary.missingSubjectIds += 1;
    }
    return summary;
  }, {
    total: 0,
    invalid: 0,
    missingSubjectIds: 0,
    byAcceptanceStatus: {},
    byErrorKind: {}
  });

  const blockers = [];
  if (operationalHealth.degraded) {
    blockers.push({
      code: 'trust-metadata-degraded',
      message: operationalHealth.degradedReason || 'trust metadata command processing degraded',
      action: 'resolve rejected commands before enabling trust metadata writes'
    });
  }
  if (validationSummary.missingSubjectIds > 0) {
    blockers.push({
      code: 'missing-subject-id',
      message: 'one or more trust metadata commands cannot be accepted without a subjectId',
      action: 'add subjectId to each upsertSubjectTrust or revokeSubjectTrust command'
    });
  }

  const acceptedCount = validationSummary.byAcceptanceStatus.accepted || 0;
  const duplicateCount = validationSummary.byAcceptanceStatus['already-accepted'] || 0;
  const rejectedCount = validationSummary.byAcceptanceStatus.rejected || 0;
  const nextSteps = [];
  if (rejectedCount > 0) {
    nextSteps.push({
      stepId: 'repair-rejected-commands',
      label: 'Repair rejected trust metadata commands',
      commandIds: previews.filter((preview) => preview.acceptanceStatus === 'rejected').map((preview) => preview.commandId),
      routeHint: 'memory-manager.trust-metadata.validation',
      proof: proofFor({ surfaceId, rejectedCount, now })
    });
  }
  if (acceptedCount > 0 || duplicateCount > 0) {
    nextSteps.push({
      stepId: 'persist-accepted-state',
      label: 'Persist accepted trust metadata checkpoint',
      commandIds: previews
        .filter((preview) => preview.acceptanceStatus === 'accepted' || preview.acceptanceStatus === 'already-accepted')
        .map((preview) => preview.commandId),
      routeHint: 'memory-manager.trust-metadata.checkpoint',
      proof: proofFor({ surfaceId, acceptedCount, duplicateCount, epoch: currentState.epoch })
    });
  }
  if (!operationalHealth.degraded && rejectedCount === 0) {
    nextSteps.push({
      stepId: 'publish-preview-accepted',
      label: 'Publish accepted trust metadata preview to clients',
      commandIds: previews.map((preview) => preview.commandId),
      routeHint: 'memory-manager.trust-metadata.preview',
      proof: proofFor({ surfaceId, previews, status: operationalHealth.status })
    });
  }

  return {
    generatedAt: now,
    format: 'aios.trustMetadata.previewAcceptance.v1',
    previewCount: previews.length,
    previews,
    validationSummary: {
      ...validationSummary,
      valid: validationSummary.invalid === 0,
      proof: proofFor({ surfaceId, validationSummary })
    },
    acceptance: {
      acceptedCommandCount: acceptedCount,
      duplicateCommandCount: duplicateCount,
      rejectedCommandCount: rejectedCount,
      canAcceptAll: rejectedCount === 0,
      requiresUserReview: rejectedCount > 0 || operationalHealth.degraded,
      proof: proofFor({ surfaceId, acceptedCount, duplicateCount, rejectedCount })
    },
    readiness: {
      status: blockers.length === 0 ? 'ready-for-client-consumption' : 'blocked',
      writeEnabled: operationalHealth.writeEnabled && blockers.length === 0,
      previewEnabled: true,
      blockers,
      proof: proofFor({ surfaceId, blockers, epoch: currentState.epoch })
    },
    nextSteps,
    routeContract: {
      previewRoute: '/memory-manager/trust-metadata/preview',
      acceptanceRoute: '/memory-manager/trust-metadata/acceptance',
      previewDecisionRoute: '/memory-manager/trust-metadata/preview-decision',
      readinessRoute: '/memory-manager/trust-metadata/readiness',
      validationRoute: '/memory-manager/trust-metadata/validation-summary',
      nextStepsRoute: '/memory-manager/trust-metadata/next-steps',
      proof: proofFor({ surfaceId, currentStateEpoch: currentState.epoch, previewCount: previews.length })
    },
    proof: proofFor({ surfaceId, previews, operationalHealth, nextSteps })
  };
}

function buildPreviewDecisionContract({ previewAcceptance, clientWorkflowHandoff, currentState, operationalHealth, now }) {
  const decisionItems = previewAcceptance.previews.map((preview) => {
    const blocking = preview.acceptanceStatus === 'rejected' || !preview.validation.valid;
    const alreadyAccepted = preview.acceptanceStatus === 'already-accepted';
    const recommendedDecision = blocking
      ? 'reject'
      : alreadyAccepted
        ? 'defer'
        : 'accept';
    const allowedDecisions = blocking
      ? ['reject', 'defer']
      : alreadyAccepted
        ? ['defer', 'accept']
        : ['accept', 'defer'];

    return {
      decisionItemId: proofFor({ surfaceId, commandId: preview.commandId, previewProof: preview.proof }),
      commandId: preview.commandId,
      subjectKey: preview.subjectKey,
      acceptanceStatus: preview.acceptanceStatus,
      recommendedDecision,
      allowedDecisions,
      blocking,
      requiresComment: blocking,
      validationMessage: preview.validation.message,
      explanation: blocking
        ? preview.validation.requiredFix || 'command requires review before acceptance'
        : alreadyAccepted
          ? 'command was already accepted; defer to keep the current checkpoint unchanged'
          : `accepting will publish ${preview.type} at trust metadata epoch ${currentState.epoch}`,
      proof: proofFor({ surfaceId, previewProof: preview.proof, recommendedDecision, allowedDecisions })
    };
  });
  const defaultAcceptedCommandIds = decisionItems
    .filter((item) => item.recommendedDecision === 'accept')
    .map((item) => item.commandId);
  const defaultRejectedCommandIds = decisionItems
    .filter((item) => item.recommendedDecision === 'reject')
    .map((item) => item.commandId);
  const defaultDeferredCommandIds = decisionItems
    .filter((item) => item.recommendedDecision === 'defer')
    .map((item) => item.commandId);
  const blockingDecisionCount = decisionItems.filter((item) => item.blocking).length;
  const canSubmitWithoutReview = blockingDecisionCount === 0 && !previewAcceptance.acceptance.requiresUserReview;
  const submissionMode = canSubmitWithoutReview
    ? 'auto-accept-ready'
    : operationalHealth.degraded
      ? 'read-only-review'
      : 'explicit-review-required';

  return {
    format: 'aios.trustMetadata.previewDecisionContract.v1',
    generatedAt: now,
    route: previewAcceptance.routeContract.previewDecisionRoute,
    method: 'POST',
    mediaType: 'application/vnd.aios.trust-metadata.preview-decision+json;version=1',
    idempotencyKey: clientWorkflowHandoff.resumeToken,
    submissionMode,
    canSubmitWithoutReview,
    decisionItems,
    defaults: {
      acceptCommandIds: defaultAcceptedCommandIds,
      rejectCommandIds: defaultRejectedCommandIds,
      deferCommandIds: defaultDeferredCommandIds,
      checkpointAfterAccept: defaultAcceptedCommandIds.length > 0 && clientWorkflowHandoff.request.wantsCheckpoint
    },
    validation: {
      totalDecisionCount: decisionItems.length,
      blockingDecisionCount,
      commentRequiredCommandIds: decisionItems.filter((item) => item.requiresComment).map((item) => item.commandId),
      readinessStatus: previewAcceptance.readiness.status,
      healthStatus: operationalHealth.status,
      proof: proofFor({ surfaceId, decisionItems, readiness: previewAcceptance.readiness.status })
    },
    submitTemplate: {
      requestId: clientWorkflowHandoff.request.requestId,
      clientId: clientWorkflowHandoff.request.clientId,
      resumeToken: clientWorkflowHandoff.resumeToken,
      decisions: decisionItems.map((item) => ({
        commandId: item.commandId,
        decision: item.recommendedDecision,
        comment: item.requiresComment ? '' : null,
        proof: item.proof
      }))
    },
    proof: proofFor({
      surfaceId,
      route: previewAcceptance.routeContract.previewDecisionRoute,
      resumeToken: clientWorkflowHandoff.resumeToken,
      defaultAcceptedCommandIds,
      defaultRejectedCommandIds,
      defaultDeferredCommandIds
    })
  };
}

function normalizePreviewDecisionSubmission(input = {}, clientRequest) {
  const runtime = input.clientRuntime && typeof input.clientRuntime === 'object' ? input.clientRuntime : {};
  const source = input.previewDecisionSubmission && typeof input.previewDecisionSubmission === 'object'
    ? input.previewDecisionSubmission
    : input.clientDecision && typeof input.clientDecision === 'object'
      ? input.clientDecision
      : runtime.previewDecision && typeof runtime.previewDecision === 'object'
        ? runtime.previewDecision
        : {};
  const decisions = Array.isArray(source.decisions)
    ? source.decisions
      .map((decision, index) => {
        const item = decision && typeof decision === 'object' ? decision : {};
        const commandId = typeof item.commandId === 'string' && item.commandId.trim()
          ? item.commandId.trim()
          : null;
        const requestedDecision = typeof item.decision === 'string' && item.decision.trim()
          ? item.decision.trim()
          : 'defer';

        if (!commandId) {
          return null;
        }

        return {
          decisionId: typeof item.decisionId === 'string' && item.decisionId.trim()
            ? item.decisionId.trim()
            : proofFor({ surfaceId, requestId: clientRequest.requestId, commandId, index }),
          commandId,
          decision: PREVIEW_DECISIONS.has(requestedDecision) ? requestedDecision : 'defer',
          requestedDecision,
          comment: typeof item.comment === 'string' ? item.comment.trim() : null,
          proof: typeof item.proof === 'string' && item.proof.trim() ? item.proof.trim() : null
        };
      })
      .filter(Boolean)
    : [];

  return {
    format: 'aios.trustMetadata.previewDecisionSubmission.v1',
    submitted: decisions.length > 0 || Boolean(source.resumeToken || source.continuationToken),
    requestId: normalizeBoundaryPart(source.requestId || clientRequest.requestId, clientRequest.requestId),
    clientId: normalizeBoundaryPart(source.clientId || clientRequest.clientId, clientRequest.clientId),
    resumeToken: typeof source.resumeToken === 'string' && source.resumeToken.trim()
      ? source.resumeToken.trim()
      : null,
    continuationToken: typeof source.continuationToken === 'string' && source.continuationToken.trim()
      ? source.continuationToken.trim()
      : null,
    checkpointAfterAccept: source.checkpointAfterAccept === true,
    decisions,
    proof: proofFor({ surfaceId, clientRequest, decisions, resumeToken: source.resumeToken, continuationToken: source.continuationToken })
  };
}

function reconcilePreviewDecisionSubmission({ submission, previewDecisionContract, clientWorkflowHandoff, now }) {
  const expectedByCommandId = new Map(previewDecisionContract.decisionItems.map((item) => [item.commandId, item]));
  const decisionsByCommandId = new Map();

  for (const decision of submission.decisions) {
    decisionsByCommandId.set(decision.commandId, decision);
  }

  const acceptedCommandIds = [];
  const rejectedCommandIds = [];
  const deferredCommandIds = [];
  const issues = [];
  const reconciledDecisions = [];

  if (submission.submitted && submission.resumeToken && submission.resumeToken !== clientWorkflowHandoff.resumeToken) {
    issues.push({
      code: 'resume-token-mismatch',
      severity: 'blocking',
      message: 'preview decision resumeToken does not match the hosted-kernel handoff token',
      expectedToken: clientWorkflowHandoff.resumeToken,
      providedToken: submission.resumeToken
    });
  }

  for (const decision of submission.decisions) {
    if (!expectedByCommandId.has(decision.commandId)) {
      issues.push({
        code: 'unknown-command-decision',
        severity: 'blocking',
        message: 'preview decision references a command outside the current trust metadata preview',
        commandId: decision.commandId
      });
      continue;
    }

    const expected = expectedByCommandId.get(decision.commandId);
    const allowed = expected.allowedDecisions.includes(decision.decision);
    if (!PREVIEW_DECISIONS.has(decision.requestedDecision) || !allowed) {
      issues.push({
        code: 'decision-not-allowed',
        severity: expected.blocking ? 'blocking' : 'review',
        message: `decision ${decision.requestedDecision} is not allowed for command ${decision.commandId}`,
        commandId: decision.commandId,
        allowedDecisions: expected.allowedDecisions
      });
    }
    if (expected.requiresComment && decision.decision === 'reject' && !decision.comment) {
      issues.push({
        code: 'decision-comment-required',
        severity: 'review',
        message: 'rejected preview decisions require an operator comment',
        commandId: decision.commandId
      });
    }

    const effectiveDecision = allowed ? decision.decision : expected.recommendedDecision;
    if (effectiveDecision === 'accept') acceptedCommandIds.push(decision.commandId);
    if (effectiveDecision === 'reject') rejectedCommandIds.push(decision.commandId);
    if (effectiveDecision === 'defer') deferredCommandIds.push(decision.commandId);

    reconciledDecisions.push({
      ...decision,
      effectiveDecision,
      allowed,
      requiredCommentSatisfied: !expected.requiresComment || Boolean(decision.comment),
      expectedDecisionItemId: expected.decisionItemId,
      proof: proofFor({ surfaceId, decision, effectiveDecision, expectedProof: expected.proof })
    });
  }

  for (const expected of previewDecisionContract.decisionItems) {
    if (!decisionsByCommandId.has(expected.commandId) && submission.submitted) {
      deferredCommandIds.push(expected.commandId);
    }
  }

  const blocking = issues.some((issue) => issue.severity === 'blocking');
  const reviewRequired = issues.length > 0 || rejectedCommandIds.length > 0 || deferredCommandIds.length > 0;
  const status = !submission.submitted
    ? 'awaiting-client-decision'
    : blocking
      ? 'blocked'
      : reviewRequired
        ? 'decision-review-required'
        : 'decisions-adopted';
  const nextRoute = blocking || reviewRequired
    ? CLIENT_HANDOFF_ROUTES.review
    : submission.checkpointAfterAccept && acceptedCommandIds.length > 0
      ? CLIENT_HANDOFF_ROUTES.checkpoint
      : clientWorkflowHandoff.route;

  return {
    format: 'aios.trustMetadata.previewDecisionReconciliation.v1',
    generatedAt: now,
    status,
    submitted: submission.submitted,
    requestId: submission.requestId,
    clientId: submission.clientId,
    acceptedCommandIds: [...new Set(acceptedCommandIds)],
    rejectedCommandIds: [...new Set(rejectedCommandIds)],
    deferredCommandIds: [...new Set(deferredCommandIds)],
    reconciledDecisions,
    issues: issues.map((issue) => ({
      ...issue,
      proof: proofFor({ surfaceId, issue, requestId: submission.requestId })
    })),
    handoffEffect: {
      route: nextRoute,
      checkpointAfterAccept: submission.checkpointAfterAccept && acceptedCommandIds.length > 0 && !blocking,
      canResumeWrites: !blocking && rejectedCommandIds.length === 0,
      proof: proofFor({ surfaceId, status, nextRoute, acceptedCommandIds, rejectedCommandIds, deferredCommandIds })
    },
    proof: proofFor({ surfaceId, submission, status, issues, nextRoute })
  };
}

function buildClientWorkflowHandoff({ clientRequest, commands, audit, currentState, previewAcceptance, operationalHealth, analytics, now }) {
  const commandIdsInBatch = commands.map((command) => command.commandId);
  const requestedSet = new Set(clientRequest.requestedCommandIds);
  const scopedAudit = requestedSet.size > 0
    ? audit.filter((entry) => requestedSet.has(entry.commandId))
    : audit.filter((entry) => entry.tenantId === clientRequest.tenantId && entry.workspaceId === clientRequest.workspaceId);
  const scopedCommandIds = scopedAudit.map((entry) => entry.commandId);
  const missingCommandIds = clientRequest.requestedCommandIds.filter((commandId) => !commandIdsInBatch.includes(commandId));
  const rejectedCommandIds = scopedAudit.filter((entry) => entry.error).map((entry) => entry.commandId);
  const acceptedCommandIds = scopedAudit
    .filter((entry) => entry.applied || entry.duplicate)
    .map((entry) => entry.commandId);
  const pendingCommandIds = commandIdsInBatch
    .filter((commandId) => requestedSet.size === 0 || requestedSet.has(commandId))
    .filter((commandId) => !scopedCommandIds.includes(commandId));
  const hasWritableState = operationalHealth.writeEnabled && previewAcceptance.readiness.writeEnabled;
  const productWorkflowBlocked = !clientRequest.productWorkflow.valid
    || (clientRequest.productWorkflow.approvalRequired && rejectedCommandIds.length > 0);
  const phase = rejectedCommandIds.length > 0 || missingCommandIds.length > 0
    ? 'client-review-required'
    : productWorkflowBlocked
      ? 'client-review-required'
    : pendingCommandIds.length > 0
      ? 'client-reconcile-required'
      : acceptedCommandIds.length > 0 && hasWritableState
        ? 'client-checkpoint-ready'
        : hasWritableState
          ? 'client-resume-ready'
          : 'client-readonly-resume';
  const route = phase === 'client-review-required'
    ? CLIENT_HANDOFF_ROUTES.review
    : phase === 'client-reconcile-required'
      ? CLIENT_HANDOFF_ROUTES.reconcile
      : phase === 'client-checkpoint-ready'
        ? CLIENT_HANDOFF_ROUTES.checkpoint
        : clientRequest.returnRoute || CLIENT_HANDOFF_ROUTES.resume;
  const resumeToken = proofFor({
    surfaceId,
    requestId: clientRequest.requestId,
    clientId: clientRequest.clientId,
    tenantId: clientRequest.tenantId,
    workspaceId: clientRequest.workspaceId,
    epoch: currentState.epoch,
    phase,
    scopedCommandIds,
    rejectedCommandIds,
    missingCommandIds
  });

  return {
    format: 'aios.trustMetadata.clientWorkflowHandoff.v1',
    generatedAt: now,
    request: clientRequest,
    phase,
    route,
    resumeToken,
    clientStatePatch: {
      trustMetadataEpoch: currentState.epoch,
      readinessStatus: previewAcceptance.readiness.status,
      healthStatus: operationalHealth.status,
      acceptedCommandIds,
      rejectedCommandIds,
      missingCommandIds,
      pendingCommandIds,
      previewProof: previewAcceptance.proof,
      analyticsSnapshotId: analytics.snapshot.snapshotId,
      productWorkflow: {
        provider: clientRequest.productWorkflow.provider,
        stage: clientRequest.productWorkflow.stage,
        workflowId: clientRequest.productWorkflow.workflowId,
        campaignId: clientRequest.productWorkflow.campaignId,
        audienceId: clientRequest.productWorkflow.audienceId,
        segmentId: clientRequest.productWorkflow.segmentId,
        stateKey: clientRequest.productWorkflow.stateKey,
        validation: clientRequest.productWorkflow.validation,
        proof: clientRequest.productWorkflow.proof
      }
    },
    workflowActions: [
      ...(clientRequest.productWorkflow.validation.length > 0 ? [{
        actionId: 'repair-product-workflow-context',
        route: CLIENT_HANDOFF_ROUTES.review,
        commandIds: scopedCommandIds,
        required: true,
        validation: clientRequest.productWorkflow.validation
      }] : []),
      ...(clientRequest.productWorkflow.approvalRequired && rejectedCommandIds.length > 0 ? [{
        actionId: 'resolve-product-approval-before-campaign-handoff',
        route: CLIENT_HANDOFF_ROUTES.review,
        commandIds: rejectedCommandIds,
        required: true,
        provider: clientRequest.productWorkflow.provider,
        workflowId: clientRequest.productWorkflow.workflowId
      }] : []),
      ...(missingCommandIds.length > 0 ? [{
        actionId: 'resubmit-missing-client-commands',
        route: CLIENT_HANDOFF_ROUTES.reconcile,
        commandIds: missingCommandIds,
        required: true
      }] : []),
      ...(rejectedCommandIds.length > 0 ? [{
        actionId: 'review-rejected-trust-commands',
        route: CLIENT_HANDOFF_ROUTES.review,
        commandIds: rejectedCommandIds,
        required: true
      }] : []),
      ...(acceptedCommandIds.length > 0 && clientRequest.wantsCheckpoint ? [{
        actionId: 'checkpoint-client-trust-state',
        route: CLIENT_HANDOFF_ROUTES.checkpoint,
        commandIds: acceptedCommandIds,
        required: false
      }] : [])
    ],
    integration: {
      sink: 'hosted-kernel.memory-manager.trust-metadata.client-workflow',
      routes: CLIENT_HANDOFF_ROUTES,
      continuationToken: clientRequest.continuationToken || resumeToken,
      canResumeWrites: hasWritableState
        && rejectedCommandIds.length === 0
        && missingCommandIds.length === 0
        && !productWorkflowBlocked,
      canRenderPreview: clientRequest.wantsPreview,
      productWorkflowStateKey: clientRequest.productWorkflow.stateKey,
      proof: proofFor({ surfaceId, phase, route, resumeToken, hasWritableState, productWorkflow: clientRequest.productWorkflow.proof })
    },
    productWorkflow: clientRequest.productWorkflow,
    proof: proofFor({ surfaceId, clientRequest, phase, route, resumeToken, scopedAudit, productWorkflow: clientRequest.productWorkflow.proof })
  };
}

function buildClientRuntimeAdoption({
  clientRequest,
  clientRuntimeState,
  clientWorkflowHandoff,
  previewDecisionContract,
  previewDecisionSubmission,
  previewAcceptance,
  providerServiceContract,
  currentState,
  operationalHealth,
  analytics,
  now
}) {
  const patch = clientWorkflowHandoff.clientStatePatch;
  const previewDecisionReconciliation = reconcilePreviewDecisionSubmission({
    submission: previewDecisionSubmission,
    previewDecisionContract,
    clientWorkflowHandoff,
    now
  });
  const adoptedState = {
    format: clientRuntimeState.format,
    clientId: clientRuntimeState.clientId,
    requestId: clientRuntimeState.requestId,
    sessionId: clientRuntimeState.sessionId,
    tenantId: clientRuntimeState.tenantId,
    workspaceId: clientRuntimeState.workspaceId,
    trustMetadataEpoch: patch.trustMetadataEpoch,
    readinessStatus: patch.readinessStatus,
    healthStatus: patch.healthStatus,
    acceptedCommandIds: appendUnique(clientRuntimeState.acceptedCommandIds, patch.acceptedCommandIds),
    rejectedCommandIds: appendUnique(clientRuntimeState.rejectedCommandIds, patch.rejectedCommandIds),
    missingCommandIds: appendUnique(clientRuntimeState.missingCommandIds, patch.missingCommandIds),
    pendingCommandIds: normalizeStringList(patch.pendingCommandIds),
    decisionAcceptedCommandIds: appendUnique([], previewDecisionReconciliation.acceptedCommandIds),
    decisionRejectedCommandIds: appendUnique([], previewDecisionReconciliation.rejectedCommandIds),
    decisionDeferredCommandIds: appendUnique([], previewDecisionReconciliation.deferredCommandIds),
    previewDecisionStatus: previewDecisionReconciliation.status,
    lastResumeToken: clientWorkflowHandoff.resumeToken,
    previewProof: patch.previewProof,
    analyticsSnapshotId: patch.analyticsSnapshotId,
    productWorkflow: patch.productWorkflow,
    proof: proofFor({ surfaceId, clientRuntimeState, patch, phase: clientWorkflowHandoff.phase, previewDecisionReconciliation })
  };
  const conflicts = [];

  if (clientRuntimeState.trustMetadataEpoch !== null && clientRuntimeState.trustMetadataEpoch > currentState.epoch) {
    conflicts.push({
      code: 'client-epoch-ahead-of-kernel',
      severity: 'blocking',
      message: 'client runtime state references a newer trust metadata epoch than the hosted kernel',
      clientEpoch: clientRuntimeState.trustMetadataEpoch,
      kernelEpoch: currentState.epoch
    });
  }
  if (clientRuntimeState.lastResumeToken && clientRequest.continuationToken && clientRuntimeState.lastResumeToken !== clientRequest.continuationToken) {
    conflicts.push({
      code: 'continuation-token-mismatch',
      severity: 'review',
      message: 'client continuation token differs from the last adopted trust metadata resume token',
      expectedToken: clientRuntimeState.lastResumeToken,
      providedToken: clientRequest.continuationToken
    });
  }
  for (const issue of previewDecisionReconciliation.issues) {
    conflicts.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      commandId: issue.commandId || null
    });
  }
  for (const issue of clientRequest.productWorkflow.validation) {
    conflicts.push({
      code: issue,
      severity: 'blocking',
      message: 'product workflow handoff metadata is incomplete for trust metadata adoption',
      provider: clientRequest.productWorkflow.provider,
      workflowId: clientRequest.productWorkflow.workflowId,
      campaignId: clientRequest.productWorkflow.campaignId,
      audienceId: clientRequest.productWorkflow.audienceId
    });
  }

  const blocked = conflicts.some((conflict) => conflict.severity === 'blocking');
  const route = blocked
    ? CLIENT_HANDOFF_ROUTES.reconcile
    : previewDecisionReconciliation.handoffEffect.route;

  return {
    format: 'aios.trustMetadata.clientRuntimeAdoption.v1',
    generatedAt: now,
    status: blocked
      ? 'blocked'
      : operationalHealth.degraded || previewAcceptance.acceptance.requiresUserReview
        ? 'requires-client-review'
        : 'adopted',
    request: {
      requestId: clientRequest.requestId,
      clientId: clientRequest.clientId,
      sessionId: clientRequest.sessionId,
      tenantId: clientRequest.tenantId,
      workspaceId: clientRequest.workspaceId
    },
    previousState: clientRuntimeState,
    patch,
    adoptedState,
    previewDecisionReconciliation,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      proof: proofFor({ surfaceId, conflict, requestId: clientRequest.requestId })
    })),
    handoff: {
      phase: blocked ? 'client-reconcile-required' : clientWorkflowHandoff.phase,
      route,
      resumeToken: clientWorkflowHandoff.resumeToken,
      continuationToken: clientWorkflowHandoff.integration.continuationToken,
      canResumeWrites: !blocked
        && clientWorkflowHandoff.integration.canResumeWrites
        && previewDecisionReconciliation.handoffEffect.canResumeWrites,
      providerHandoffRoute: providerServiceContract.externalHandoffState.route,
      productWorkflowStateKey: clientRequest.productWorkflow.stateKey,
      proof: proofFor({ surfaceId, route, resumeToken: clientWorkflowHandoff.resumeToken, blocked, previewDecisionReconciliation: previewDecisionReconciliation.proof, productWorkflow: clientRequest.productWorkflow.proof })
    },
    exportBinding: {
      analyticsSnapshotId: analytics.snapshot.snapshotId,
      previewProof: previewAcceptance.proof,
      providerSyncCursor: providerServiceContract.syncMetadata.syncCursor,
      productWorkflow: clientRequest.productWorkflow,
      proof: proofFor({ surfaceId, snapshot: analytics.snapshot.snapshotId, provider: providerServiceContract.syncMetadata.syncCursor, productWorkflow: clientRequest.productWorkflow.proof })
    },
    proof: proofFor({ surfaceId, adoptedState, conflicts, route, now })
  };
}

function buildClientRouteDataContracts({
  previewAcceptance,
  previewDecisionContract,
  clientWorkflowHandoff,
  clientRuntimeAdoption,
  providerServiceContract,
  currentState,
  operationalHealth,
  analytics,
  now
}) {
  const acceptedPreviewIds = previewAcceptance.previews
    .filter((preview) => preview.acceptanceStatus === 'accepted' || preview.acceptanceStatus === 'already-accepted')
    .map((preview) => preview.commandId);
  const rejectedPreviewIds = previewAcceptance.previews
    .filter((preview) => preview.acceptanceStatus === 'rejected')
    .map((preview) => preview.commandId);
  const routePayloads = {
    preview: {
      route: previewAcceptance.routeContract.previewRoute,
      method: 'GET',
      mediaType: 'application/vnd.aios.trust-metadata.preview+json;version=1',
      cache: {
        etag: previewAcceptance.proof,
        maxAgeSeconds: operationalHealth.degraded ? 0 : 30,
        variesBy: ['tenantId', 'workspaceId', 'epoch']
      },
      body: {
        generatedAt: now,
        epoch: currentState.epoch,
        previews: previewAcceptance.previews,
        previewCount: previewAcceptance.previewCount,
        proof: previewAcceptance.proof
      }
    },
    acceptance: {
      route: previewAcceptance.routeContract.acceptanceRoute,
      method: 'POST',
      mediaType: 'application/vnd.aios.trust-metadata.acceptance+json;version=1',
      idempotencyKey: clientWorkflowHandoff.resumeToken,
      body: {
        acceptedCommandIds: acceptedPreviewIds,
        rejectedCommandIds: rejectedPreviewIds,
        canAcceptAll: previewAcceptance.acceptance.canAcceptAll,
        requiresUserReview: previewAcceptance.acceptance.requiresUserReview,
        checkpointRoute: CLIENT_HANDOFF_ROUTES.checkpoint,
        proof: previewAcceptance.acceptance.proof
      }
    },
    previewDecision: {
      route: previewDecisionContract.route,
      method: previewDecisionContract.method,
      mediaType: previewDecisionContract.mediaType,
      idempotencyKey: previewDecisionContract.idempotencyKey,
      body: {
        submissionMode: previewDecisionContract.submissionMode,
        canSubmitWithoutReview: previewDecisionContract.canSubmitWithoutReview,
        decisionItems: previewDecisionContract.decisionItems,
        defaults: previewDecisionContract.defaults,
        validation: previewDecisionContract.validation,
        submitTemplate: previewDecisionContract.submitTemplate,
        proof: previewDecisionContract.proof
      }
    },
    readiness: {
      route: previewAcceptance.routeContract.readinessRoute,
      method: 'GET',
      mediaType: 'application/vnd.aios.trust-metadata.readiness+json;version=1',
      body: {
        status: previewAcceptance.readiness.status,
        writeEnabled: previewAcceptance.readiness.writeEnabled,
        healthStatus: operationalHealth.status,
        clientPhase: clientWorkflowHandoff.phase,
        providerSyncRequired: providerServiceContract.syncMetadata.syncRequired,
        analyticsSnapshotId: analytics.snapshot.snapshotId,
        blockers: previewAcceptance.readiness.blockers,
        proof: previewAcceptance.readiness.proof
      }
    },
    validationSummary: {
      route: previewAcceptance.routeContract.validationRoute,
      method: 'GET',
      mediaType: 'application/vnd.aios.trust-metadata.validation-summary+json;version=1',
      body: {
        ...previewAcceptance.validationSummary,
        rejectedCommandIds: rejectedPreviewIds,
        actionableErrors: operationalHealth.actionableErrors,
        proof: previewAcceptance.validationSummary.proof
      }
    },
    nextSteps: {
      route: previewAcceptance.routeContract.nextStepsRoute,
      method: 'GET',
      mediaType: 'application/vnd.aios.trust-metadata.next-steps+json;version=1',
      body: {
        steps: previewAcceptance.nextSteps,
        defaultRoute: clientWorkflowHandoff.route,
        workflowActions: clientWorkflowHandoff.workflowActions,
        adoptionRoute: CLIENT_HANDOFF_ROUTES.adopt,
        providerHandoffRoute: providerServiceContract.externalHandoffState.route,
        proof: proofFor({ surfaceId, nextSteps: previewAcceptance.nextSteps, phase: clientWorkflowHandoff.phase })
      }
    },
    clientRuntimeAdoption: {
      route: CLIENT_HANDOFF_ROUTES.adopt,
      method: 'POST',
      mediaType: 'application/vnd.aios.trust-metadata.client-runtime-adoption+json;version=1',
      idempotencyKey: clientWorkflowHandoff.resumeToken,
      body: {
        status: clientRuntimeAdoption.status,
        previousStateProof: clientRuntimeAdoption.previousState.proof,
        patch: clientRuntimeAdoption.patch,
        adoptedState: clientRuntimeAdoption.adoptedState,
        conflicts: clientRuntimeAdoption.conflicts,
        previewDecisionReconciliation: clientRuntimeAdoption.previewDecisionReconciliation,
        handoff: clientRuntimeAdoption.handoff,
        proof: clientRuntimeAdoption.proof
      }
    }
  };

  return {
    format: 'aios.trustMetadata.clientRouteDataContracts.v1',
    generatedAt: now,
    routes: Object.fromEntries(Object.entries(routePayloads).map(([key, value]) => [key, value.route])),
    payloads: routePayloads,
    acceptanceCursor: clientWorkflowHandoff.resumeToken,
    proof: proofFor({
      surfaceId,
      previewProof: previewAcceptance.proof,
      previewDecisionProof: previewDecisionContract.proof,
      handoffProof: clientWorkflowHandoff.proof,
      adoptionProof: clientRuntimeAdoption.proof,
      providerProof: providerServiceContract.proof
    })
  };
}

function normalizeProviderRuntime(input = {}) {
  const source = input.providerRuntime && typeof input.providerRuntime === 'object'
    ? input.providerRuntime
    : input.providerContract && typeof input.providerContract === 'object'
      ? input.providerContract
      : input.provider && typeof input.provider === 'object'
        ? input.provider
        : {};
  const scope = normalizeScope({
    tenantId: source.tenantId || input.tenantId,
    workspaceId: source.workspaceId || input.workspaceId
  });
  const requestedCapabilities = normalizeStringList(source.requestedCapabilities || source.capabilities);
  const lastSyncedEpoch = Number.isSafeInteger(source.lastSyncedEpoch) && source.lastSyncedEpoch >= 0
    ? source.lastSyncedEpoch
    : null;

  return {
    providerId: normalizeBoundaryPart(source.providerId || source.serviceId, 'hosted-kernel-memory-provider'),
    serviceId: normalizeBoundaryPart(source.serviceId || source.providerId, 'memory-manager.trust-metadata'),
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    requestedCapabilities: requestedCapabilities.length > 0 ? requestedCapabilities : PROVIDER_CAPABILITIES,
    lastSyncedEpoch,
    lastSyncProof: typeof source.lastSyncProof === 'string' && source.lastSyncProof.trim()
      ? source.lastSyncProof.trim()
      : null,
    acceptsExternalHandoff: source.acceptsExternalHandoff !== false,
    wantsAnalyticsExport: source.wantsAnalyticsExport !== false,
    proof: proofFor({ surfaceId, scope, requestedCapabilities, lastSyncedEpoch })
  };
}

function normalizeProviderOperationRequest(input = {}, providerRuntime) {
  const source = input.providerRequest && typeof input.providerRequest === 'object'
    ? input.providerRequest
    : input.providerRuntime?.request && typeof input.providerRuntime.request === 'object'
      ? input.providerRuntime.request
      : {};
  const requestedSyncMode = typeof source.syncMode === 'string' && PROVIDER_SYNC_MODES.has(source.syncMode)
    ? source.syncMode
    : providerRuntime.lastSyncedEpoch === null
      ? 'checkpoint'
      : 'delta';
  const requestedSinceEpoch = Number.isSafeInteger(source.sinceEpoch) && source.sinceEpoch >= 0
    ? source.sinceEpoch
    : providerRuntime.lastSyncedEpoch;
  const maxSubjectKeys = boundedInteger(
    source.maxSubjectKeys,
    MAX_PROVIDER_SYNC_SUBJECT_KEYS,
    { min: 1, max: MAX_PROVIDER_SYNC_SUBJECT_KEYS }
  );

  return {
    format: 'aios.trustMetadata.providerOperationRequest.v1',
    requestId: normalizeBoundaryPart(source.requestId || input.requestId, `provider:${providerRuntime.providerId}`),
    providerId: providerRuntime.providerId,
    serviceId: providerRuntime.serviceId,
    tenantId: providerRuntime.tenantId,
    workspaceId: providerRuntime.workspaceId,
    syncMode: requestedSyncMode,
    sinceEpoch: requestedSinceEpoch,
    maxSubjectKeys,
    includeAnalytics: source.includeAnalytics !== false && providerRuntime.wantsAnalyticsExport,
    includeExternalHandoff: source.includeExternalHandoff !== false && providerRuntime.acceptsExternalHandoff,
    callbackRoute: typeof source.callbackRoute === 'string' && source.callbackRoute.trim()
      ? source.callbackRoute.trim()
      : null,
    proof: proofFor({ surfaceId, providerRuntime, source, requestedSyncMode, requestedSinceEpoch, maxSubjectKeys })
  };
}

function buildProviderRouteDataContracts({
  providerRuntime,
  providerRequest,
  currentState,
  operationalHealth,
  lifecycleControls,
  subjectContracts,
  clientWorkflowHandoff,
  analytics,
  availableCapabilityState,
  negotiatedCapabilities,
  deniedCapabilities,
  syncRequired,
  syncCursor,
  now
}) {
  const scopedSubjectKeys = Object.values(currentState.subjects)
    .filter((record) => record.tenantId === providerRuntime.tenantId && record.workspaceId === providerRuntime.workspaceId)
    .map((record) => record.subjectKey)
    .sort();
  const syncSubjectKeys = providerRequest.syncMode === 'metadata-only'
    ? []
    : scopedSubjectKeys.slice(0, providerRequest.maxSubjectKeys);
  const omittedSubjectCount = Math.max(0, scopedSubjectKeys.length - syncSubjectKeys.length);
  const canExportAnalytics = providerRequest.includeAnalytics
    && negotiatedCapabilities.includes('trustMetadata.analyticsExport');
  const canExternalHandoff = providerRequest.includeExternalHandoff
    && providerRuntime.acceptsExternalHandoff
    && negotiatedCapabilities.includes('trustMetadata.clientHandoff');

  const payloads = {
    negotiate: {
      route: PROVIDER_SERVICE_ROUTES.negotiate,
      method: 'POST',
      mediaType: 'application/vnd.aios.trust-metadata.provider-negotiate+json;version=1',
      idempotencyKey: providerRequest.requestId,
      body: {
        request: providerRequest,
        serviceId: providerRuntime.serviceId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        availableCapabilities: Object.entries(availableCapabilityState)
          .filter(([, available]) => available)
          .map(([capability]) => capability),
        negotiatedCapabilities,
        deniedCapabilities,
        proof: proofFor({ surfaceId, providerRequest, negotiatedCapabilities, deniedCapabilities })
      }
    },
    sync: {
      route: PROVIDER_SERVICE_ROUTES.sync,
      method: 'POST',
      mediaType: 'application/vnd.aios.trust-metadata.provider-sync+json;version=1',
      idempotencyKey: syncCursor,
      body: {
        syncRequired,
        syncMode: providerRequest.syncMode,
        fromEpoch: providerRequest.sinceEpoch,
        toEpoch: currentState.epoch,
        syncCursor,
        checkpointProof: currentState.checkpointProof,
        subjectContractsProof: subjectContracts.proof,
        subjectKeys: syncSubjectKeys,
        omittedSubjectCount,
        lifecycleRevision: lifecycleControls.revision,
        writeBarrierActive: !operationalHealth.writeEnabled,
        proof: proofFor({ surfaceId, providerRequest, syncSubjectKeys, syncCursor, currentEpoch: currentState.epoch })
      }
    },
    export: {
      route: PROVIDER_SERVICE_ROUTES.export,
      method: 'GET',
      mediaType: 'application/vnd.aios.trust-metadata.provider-export+json;version=1',
      cache: {
        etag: analytics.exportSummary.proof,
        maxAgeSeconds: operationalHealth.degraded ? 0 : 60,
        variesBy: ['providerId', 'tenantId', 'workspaceId', 'epoch']
      },
      body: {
        exportReady: canExportAnalytics,
        analyticsSnapshotId: analytics.snapshot.snapshotId,
        exportSummary: canExportAnalytics ? analytics.exportSummary : null,
        exportPackage: canExportAnalytics ? analytics.exportPackage : null,
        timelineReporting: canExportAnalytics ? analytics.timelineReporting : null,
        trendReport: canExportAnalytics ? analytics.trendReport : null,
        reportingSink: analytics.reporting.sink,
        deniedReason: canExportAnalytics ? null : 'analytics export capability was not negotiated',
        proof: proofFor({
          surfaceId,
          canExportAnalytics,
          snapshotId: analytics.snapshot.snapshotId,
          exportPackageId: analytics.exportPackage.exportId,
          timelineCursor: analytics.timelineReporting.cursor,
          trendStatus: analytics.trendReport.status
        })
      }
    },
    handoff: {
      route: PROVIDER_SERVICE_ROUTES.handoff,
      method: 'POST',
      mediaType: 'application/vnd.aios.trust-metadata.provider-handoff+json;version=1',
      idempotencyKey: clientWorkflowHandoff.resumeToken,
      body: {
        enabled: canExternalHandoff,
        phase: clientWorkflowHandoff.phase,
        clientRoute: clientWorkflowHandoff.route,
        clientResumeToken: clientWorkflowHandoff.resumeToken,
        continuationToken: clientWorkflowHandoff.integration.continuationToken,
        callbackRoute: providerRequest.callbackRoute,
        canResumeWrites: canExternalHandoff
          && clientWorkflowHandoff.integration.canResumeWrites
          && negotiatedCapabilities.includes('trustMetadata.write'),
        proof: proofFor({ surfaceId, canExternalHandoff, clientWorkflowHandoff: clientWorkflowHandoff.proof })
      }
    }
  };

  return {
    format: 'aios.trustMetadata.providerRouteDataContracts.v1',
    generatedAt: now,
    request: providerRequest,
    routes: Object.fromEntries(Object.entries(payloads).map(([key, value]) => [key, value.route])),
    payloads,
    syncSubjectCount: syncSubjectKeys.length,
    omittedSubjectCount,
    proof: proofFor({ surfaceId, providerRequest, routes: PROVIDER_SERVICE_ROUTES, syncCursor })
  };
}

function buildProviderServiceContract({
  providerRuntime,
  providerRequest,
  currentState,
  operationalHealth,
  lifecycleControls,
  subjectContracts,
  clientWorkflowHandoff,
  analytics,
  now
}) {
  const availableCapabilityState = {
    'trustMetadata.read': true,
    'trustMetadata.write': operationalHealth.writeEnabled,
    'trustMetadata.revoke': operationalHealth.writeEnabled,
    'trustMetadata.checkpoint': true,
    'trustMetadata.lifecycle': lifecycleControls.mode !== 'disabled',
    'trustMetadata.analyticsExport': analytics.reporting.exportReady,
    'trustMetadata.clientHandoff': providerRuntime.acceptsExternalHandoff
  };
  const negotiatedCapabilities = providerRuntime.requestedCapabilities
    .filter((capability) => PROVIDER_CAPABILITIES.includes(capability) && availableCapabilityState[capability]);
  const deniedCapabilities = providerRuntime.requestedCapabilities
    .filter((capability) => !PROVIDER_CAPABILITIES.includes(capability) || !availableCapabilityState[capability])
    .map((capability) => ({
      capability,
      reason: PROVIDER_CAPABILITIES.includes(capability)
        ? 'capability is unavailable in current trust metadata runtime state'
        : 'capability is not part of the trust metadata provider contract',
      proof: proofFor({ surfaceId, capability, availableCapabilityState })
    }));
  const syncRequired = providerRuntime.lastSyncedEpoch === null || providerRuntime.lastSyncedEpoch < currentState.epoch;
  const syncCursor = proofFor({
    surfaceId,
    providerId: providerRuntime.providerId,
    epoch: currentState.epoch,
    checkpointProof: currentState.checkpointProof,
    subjectContractsProof: subjectContracts.proof
  });
  const normalizedProviderRequest = providerRequest || normalizeProviderOperationRequest({ providerRuntime }, providerRuntime);
  const routeDataContracts = buildProviderRouteDataContracts({
    providerRuntime,
    providerRequest: normalizedProviderRequest,
    currentState,
    operationalHealth,
    lifecycleControls,
    subjectContracts,
    clientWorkflowHandoff,
    analytics,
    availableCapabilityState,
    negotiatedCapabilities,
    deniedCapabilities,
    syncRequired,
    syncCursor,
    now
  });

  return {
    format: 'aios.trustMetadata.providerServiceContract.v1',
    generatedAt: now,
    provider: providerRuntime,
    service: {
      serviceId: providerRuntime.serviceId,
      surfaceId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tenantId: providerRuntime.tenantId,
      workspaceId: providerRuntime.workspaceId,
      routes: PROVIDER_SERVICE_ROUTES
    },
    capabilityNegotiation: {
      requestedCapabilities: providerRuntime.requestedCapabilities,
      availableCapabilities: Object.entries(availableCapabilityState)
        .filter(([, available]) => available)
        .map(([capability]) => capability),
      negotiatedCapabilities,
      deniedCapabilities,
      writeBarrierActive: !operationalHealth.writeEnabled,
      proof: proofFor({ surfaceId, providerRuntime, availableCapabilityState, negotiatedCapabilities })
    },
    requestContract: normalizedProviderRequest,
    syncMetadata: {
      syncRequired,
      currentEpoch: currentState.epoch,
      providerLastSyncedEpoch: providerRuntime.lastSyncedEpoch,
      syncCursor,
      checkpointProof: currentState.checkpointProof,
      subjectContractsProof: subjectContracts.proof,
      analyticsSnapshotId: analytics.snapshot.snapshotId,
      lifecycleRevision: lifecycleControls.revision,
      pendingActionId: lifecycleControls.nextAction.actionId,
      lifecycleScheduleStatus: lifecycleControls.scheduleReadiness.status,
      lifecycleNextEligibleRunAt: lifecycleControls.scheduleReadiness.nextEligibleRunAt,
      proof: proofFor({ surfaceId, syncRequired, syncCursor, epoch: currentState.epoch })
    },
    externalHandoffState: {
      enabled: providerRuntime.acceptsExternalHandoff,
      phase: clientWorkflowHandoff.phase,
      route: PROVIDER_SERVICE_ROUTES.handoff,
      clientResumeToken: clientWorkflowHandoff.resumeToken,
      continuationToken: clientWorkflowHandoff.integration.continuationToken,
      canResumeWrites: clientWorkflowHandoff.integration.canResumeWrites
        && negotiatedCapabilities.includes('trustMetadata.write'),
      exportReady: providerRuntime.wantsAnalyticsExport && negotiatedCapabilities.includes('trustMetadata.analyticsExport'),
      proof: proofFor({ surfaceId, providerRuntime, clientWorkflowHandoff: clientWorkflowHandoff.proof })
    },
    routeDataContracts,
    proof: proofFor({ surfaceId, providerRuntime, negotiatedCapabilities, syncCursor })
  };
}

function normalizeProviderSyncAcknowledgement(input = {}, providerRuntime) {
  const source = input.providerSyncAcknowledgement && typeof input.providerSyncAcknowledgement === 'object'
    ? input.providerSyncAcknowledgement
    : input.providerSyncAck && typeof input.providerSyncAck === 'object'
      ? input.providerSyncAck
      : input.providerRuntime?.syncAcknowledgement && typeof input.providerRuntime.syncAcknowledgement === 'object'
        ? input.providerRuntime.syncAcknowledgement
        : {};
  const acknowledgedCapabilities = normalizeStringList(source.acknowledgedCapabilities || source.capabilities);

  return {
    format: 'aios.trustMetadata.providerSyncAcknowledgement.v1',
    submitted: Object.keys(source).length > 0,
    acknowledgementId: normalizeBoundaryPart(source.acknowledgementId || source.ackId, `provider-ack:${providerRuntime.providerId}`),
    providerId: normalizeBoundaryPart(source.providerId, providerRuntime.providerId),
    serviceId: normalizeBoundaryPart(source.serviceId, providerRuntime.serviceId),
    tenantId: normalizeBoundaryPart(source.tenantId, providerRuntime.tenantId),
    workspaceId: normalizeBoundaryPart(source.workspaceId, providerRuntime.workspaceId),
    acknowledgedEpoch: Number.isSafeInteger(source.acknowledgedEpoch) && source.acknowledgedEpoch >= 0
      ? source.acknowledgedEpoch
      : null,
    syncCursor: typeof source.syncCursor === 'string' && source.syncCursor.trim()
      ? source.syncCursor.trim()
      : null,
    syncProof: typeof source.syncProof === 'string' && source.syncProof.trim()
      ? source.syncProof.trim()
      : null,
    checkpointProof: typeof source.checkpointProof === 'string' && source.checkpointProof.trim()
      ? source.checkpointProof.trim()
      : null,
    subjectContractsProof: typeof source.subjectContractsProof === 'string' && source.subjectContractsProof.trim()
      ? source.subjectContractsProof.trim()
      : null,
    analyticsSnapshotId: typeof source.analyticsSnapshotId === 'string' && source.analyticsSnapshotId.trim()
      ? source.analyticsSnapshotId.trim()
      : null,
    acknowledgedCapabilities,
    handoffAccepted: source.handoffAccepted === true,
    receivedAt: typeof source.receivedAt === 'string' && !Number.isNaN(Date.parse(source.receivedAt))
      ? source.receivedAt
      : null,
    proof: proofFor({ surfaceId, providerRuntime, source, acknowledgedCapabilities })
  };
}

function reconcileProviderSyncAcknowledgement({ acknowledgement, providerServiceContract, analytics, now }) {
  const sync = providerServiceContract.syncMetadata;
  const negotiation = providerServiceContract.capabilityNegotiation;
  const expectedScope = providerServiceContract.provider;
  const issues = [];

  if (!acknowledgement.submitted) {
    issues.push({
      code: 'provider-ack-missing',
      severity: sync.syncRequired ? 'review' : 'info',
      message: sync.syncRequired
        ? 'provider has not acknowledged the required trust metadata sync'
        : 'provider sync acknowledgement is optional because no sync is required'
    });
  }
  if (acknowledgement.submitted && acknowledgement.providerId !== expectedScope.providerId) {
    issues.push({
      code: 'provider-id-mismatch',
      severity: 'blocking',
      message: 'provider acknowledgement was submitted for a different providerId',
      expected: expectedScope.providerId,
      received: acknowledgement.providerId
    });
  }
  if (acknowledgement.submitted && (acknowledgement.tenantId !== expectedScope.tenantId || acknowledgement.workspaceId !== expectedScope.workspaceId)) {
    issues.push({
      code: 'provider-scope-mismatch',
      severity: 'blocking',
      message: 'provider acknowledgement does not match the negotiated tenant/workspace boundary',
      expected: `${expectedScope.tenantId}/${expectedScope.workspaceId}`,
      received: `${acknowledgement.tenantId}/${acknowledgement.workspaceId}`
    });
  }
  if (acknowledgement.submitted && acknowledgement.acknowledgedEpoch !== sync.currentEpoch) {
    issues.push({
      code: 'provider-epoch-drift',
      severity: 'review',
      message: 'provider acknowledged a trust metadata epoch different from the hosted kernel epoch',
      expectedEpoch: sync.currentEpoch,
      acknowledgedEpoch: acknowledgement.acknowledgedEpoch
    });
  }
  if (acknowledgement.submitted && acknowledgement.syncCursor !== sync.syncCursor) {
    issues.push({
      code: 'provider-sync-cursor-mismatch',
      severity: 'blocking',
      message: 'provider acknowledgement cursor does not match the generated sync cursor',
      expectedCursor: sync.syncCursor,
      receivedCursor: acknowledgement.syncCursor
    });
  }
  if (acknowledgement.submitted && acknowledgement.subjectContractsProof !== sync.subjectContractsProof) {
    issues.push({
      code: 'provider-subject-contract-proof-mismatch',
      severity: 'review',
      message: 'provider acknowledgement does not bind to the current subject contract proof',
      expectedProof: sync.subjectContractsProof,
      receivedProof: acknowledgement.subjectContractsProof
    });
  }

  const missingCapabilities = negotiation.negotiatedCapabilities
    .filter((capability) => !acknowledgement.acknowledgedCapabilities.includes(capability));
  if (acknowledgement.submitted && missingCapabilities.length > 0) {
    issues.push({
      code: 'provider-capability-ack-incomplete',
      severity: 'review',
      message: 'provider acknowledgement omitted negotiated trust metadata capabilities',
      missingCapabilities
    });
  }

  const blocking = issues.some((issue) => issue.severity === 'blocking');
  const review = issues.some((issue) => issue.severity === 'review');
  const status = !acknowledgement.submitted
    ? sync.syncRequired ? 'awaiting-provider-ack' : 'ack-not-required'
    : blocking
      ? 'blocked'
      : review
        ? 'review-required'
        : 'accepted';
  const handoffReady = status === 'accepted'
    && providerServiceContract.externalHandoffState.enabled
    && (!providerServiceContract.externalHandoffState.canResumeWrites || acknowledgement.handoffAccepted);

  return {
    format: 'aios.trustMetadata.providerSyncReconciliation.v1',
    generatedAt: now,
    status,
    acknowledgement,
    accepted: status === 'accepted',
    handoffReady,
    committedProviderState: status === 'accepted'
      ? {
        providerId: acknowledgement.providerId,
        serviceId: acknowledgement.serviceId,
        tenantId: acknowledgement.tenantId,
        workspaceId: acknowledgement.workspaceId,
        lastSyncedEpoch: acknowledgement.acknowledgedEpoch,
        lastSyncCursor: acknowledgement.syncCursor,
        lastSyncProof: acknowledgement.syncProof || sync.proof,
        analyticsSnapshotId: acknowledgement.analyticsSnapshotId || analytics.snapshot.snapshotId,
        acknowledgedCapabilities: acknowledgement.acknowledgedCapabilities,
        handoffAccepted: acknowledgement.handoffAccepted
      }
      : null,
    issues: issues.map((issue) => ({
      ...issue,
      proof: proofFor({ surfaceId, acknowledgementId: acknowledgement.acknowledgementId, issue })
    })),
    nextAction: status === 'accepted'
      ? {
        actionId: handoffReady ? 'publish-provider-handoff' : 'record-provider-sync',
        route: handoffReady ? providerServiceContract.externalHandoffState.route : PROVIDER_SERVICE_ROUTES.sync,
        required: false
      }
      : {
        actionId: blocking ? 'repair-provider-acknowledgement' : 'request-provider-sync-acknowledgement',
        route: PROVIDER_SERVICE_ROUTES.sync,
        required: providerServiceContract.syncMetadata.syncRequired || blocking
      },
    proof: proofFor({ surfaceId, status, acknowledgement, syncCursor: sync.syncCursor, issues })
  };
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

function proofFor(event) {
  let hash = 2166136261;
  const text = stableStringify(event);

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizePersistedState(persistedState = {}) {
  const subjects = {};
  const sourceSubjects = persistedState?.subjects && typeof persistedState.subjects === 'object'
    ? persistedState.subjects
    : {};
  const commandLedger = normalizeCommandLedger(persistedState);
  const ledgerCommandIds = commandLedger.map((entry) => entry.commandId);
  const appliedCommandIds = Array.isArray(persistedState?.appliedCommandIds)
    ? [...new Set([
      ...persistedState.appliedCommandIds.filter((id) => typeof id === 'string' && id),
      ...ledgerCommandIds
    ])]
    : ledgerCommandIds;

  for (const [subjectId, record] of Object.entries(sourceSubjects)) {
    if (!subjectId || !record || typeof record !== 'object') {
      continue;
    }

    const scope = normalizeScope(record);
    const rawSubjectId = typeof record.subjectId === 'string' && record.subjectId.trim()
      ? record.subjectId.trim()
      : subjectId.split('/').pop();
    const trustLevel = TRUST_LEVELS.has(record.trustLevel) ? record.trustLevel : 'unknown';
    const subjectKey = scopedSubjectKey(scope, rawSubjectId);
    subjects[subjectKey] = shapeSubjectRecord({
      subjectId: rawSubjectId,
      subjectKey,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      trustLevel,
      lastUpdatedAt: typeof record.lastUpdatedAt === 'string' ? record.lastUpdatedAt : null,
      revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : null,
      reason: typeof record.reason === 'string' ? record.reason : null,
      evidence: normalizeStringList(record.evidence),
      evidenceItems: normalizeEvidenceItems(record.evidenceItems || record.evidence, {
        actorId: record.lastActorId,
        commandId: record.lastCommandId,
        now: record.lastUpdatedAt
      }),
      revision: Number.isSafeInteger(record.revision) && record.revision > 0 ? record.revision : 1,
      lastActorId: typeof record.lastActorId === 'string' ? record.lastActorId : null,
      lastCommandId: typeof record.lastCommandId === 'string' ? record.lastCommandId : null
    });
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    epoch: Number.isSafeInteger(persistedState?.epoch) && persistedState.epoch >= 0 ? persistedState.epoch : 0,
    appliedCommandIds,
    commandLedger,
    subjects,
    checkpointProof: typeof persistedState?.checkpointProof === 'string' ? persistedState.checkpointProof : null,
    analyticsHistory: normalizeAnalyticsHistory(persistedState?.analyticsHistory),
    lifecycleControls: normalizeLifecycleControls(persistedState?.lifecycleControls)
  };
}

function persistableSubjectRecord(record) {
  const evidenceItems = normalizeEvidenceItems(record.evidenceItems || record.evidence, {
    actorId: record.lastActorId,
    commandId: record.lastCommandId,
    now: record.lastUpdatedAt
  });

  return {
    subjectId: record.subjectId,
    subjectKey: record.subjectKey,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    trustLevel: TRUST_LEVELS.has(record.trustLevel) ? record.trustLevel : 'unknown',
    lastUpdatedAt: normalizeIsoTimestamp(record.lastUpdatedAt),
    revokedAt: normalizeIsoTimestamp(record.revokedAt),
    reason: typeof record.reason === 'string' ? record.reason : null,
    evidence: evidenceUrisFromItems(evidenceItems),
    evidenceItems,
    revision: Number.isSafeInteger(record.revision) && record.revision > 0 ? record.revision : 1,
    lastActorId: typeof record.lastActorId === 'string' ? record.lastActorId : null,
    lastCommandId: typeof record.lastCommandId === 'string' ? record.lastCommandId : null,
    recordProof: record.recordProof || proofFor({
      surfaceId,
      subjectKey: record.subjectKey,
      trustLevel: record.trustLevel,
      revision: record.revision,
      evidenceItems
    })
  };
}

function buildCanonicalPersistedState(currentState) {
  const subjects = Object.fromEntries(
    Object.values(currentState.subjects)
      .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey))
      .map((record) => [record.subjectKey, persistableSubjectRecord(record)])
  );
  const commandLedger = normalizeCommandLedger({ commandLedger: currentState.commandLedger });
  const appliedCommandIds = [...new Set(commandLedger
    .filter((entry) => entry.status === 'applied' || entry.status === 'duplicate' || entry.status === 'rejected')
    .map((entry) => entry.commandId))];
  const persisted = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    epoch: currentState.epoch,
    appliedCommandIds,
    commandLedger,
    subjects,
    checkpointProof: currentState.checkpointProof,
    analyticsHistory: normalizeAnalyticsHistory(currentState.analyticsHistory),
    lifecycleControls: normalizeLifecycleControls(currentState.lifecycleControls)
  };

  return {
    ...persisted,
    stateProof: proofFor({ surfaceId, persisted })
  };
}

function buildRestartRecoveryCommands({ recoveryState, operationalHealth, now }) {
  const retryCommands = operationalHealth.actionableErrors
    .filter((failure) => failure.retryable && !failure.exhausted)
    .map((failure) => ({
      commandId: failure.commandId,
      type: failure.type,
      tenantId: failure.tenantId,
      workspaceId: failure.workspaceId,
      retryAttempt: failure.retryAttempt + 1,
      earliestRetryAt: addMinutesIso(now, Math.ceil((failure.nextRetryDelayMs || 0) / 60000)) || now,
      route: recoveryState.recoveryRoute,
      idempotencyKey: failure.commandId,
      proof: proofFor({ surfaceId, failure, nextAttempt: failure.retryAttempt + 1 })
    }));
  const reviewCommands = operationalHealth.actionableErrors
    .filter((failure) => !failure.retryable || failure.exhausted)
    .map((failure) => ({
      commandId: failure.commandId,
      type: failure.type,
      tenantId: failure.tenantId,
      workspaceId: failure.workspaceId,
      route: '/memory-manager/trust-metadata/recovery/review',
      reason: failure.message,
      action: failure.action,
      proof: proofFor({ surfaceId, failure, route: '/memory-manager/trust-metadata/recovery/review' })
    }));

  return {
    format: 'aios.trustMetadata.restartRecoveryCommands.v1',
    generatedAt: now,
    retryCommands,
    reviewCommands,
    proof: proofFor({ surfaceId, retryCommands, reviewCommands, restartStatus: recoveryState.restartStatus })
  };
}

function buildStatePersistenceEnvelope({
  recoveredState,
  currentState,
  recoveryState,
  operationalHealth,
  subjectContracts,
  lifecycleControls,
  analytics,
  providerServiceContract,
  clientWorkflowHandoff,
  audit,
  now
}) {
  const canonicalState = buildCanonicalPersistedState(currentState);
  const recoveryCommands = buildRestartRecoveryCommands({ recoveryState, operationalHealth, now });
  const appliedAuditCommandIds = audit.filter((entry) => entry.applied || entry.duplicate).map((entry) => entry.commandId);
  const rejectedAuditCommandIds = audit.filter((entry) => entry.error).map((entry) => entry.commandId);
  const hasCheckpoint = typeof canonicalState.checkpointProof === 'string' && canonicalState.checkpointProof.length > 0;
  const checkpointRequired = recoveryState.checkpointRequired || !hasCheckpoint;
  const restartSafe = recoveryState.restartSafe
    && operationalHealth.writeEnabled
    && recoveryCommands.retryCommands.length === 0
    && recoveryCommands.reviewCommands.length === 0;
  const persistStatus = checkpointRequired
    ? 'checkpoint-required'
    : restartSafe
      ? 'persisted-restart-safe'
      : recoveryCommands.retryCommands.length > 0
        ? 'persisted-retry-required'
        : 'persisted-review-required';

  return {
    format: 'aios.trustMetadata.statePersistenceEnvelope.v1',
    generatedAt: now,
    persistStatus,
    restartSafe,
    canonicalState,
    manifest: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      epoch: canonicalState.epoch,
      subjectCount: Object.keys(canonicalState.subjects).length,
      commandLedgerEntryCount: canonicalState.commandLedger.length,
      analyticsSnapshotCount: canonicalState.analyticsHistory.length,
      lifecycleRevision: lifecycleControls.revision,
      checkpointProof: canonicalState.checkpointProof,
      stateProof: canonicalState.stateProof,
      subjectContractsProof: subjectContracts.proof,
      analyticsSnapshotId: analytics.snapshot.snapshotId,
      providerSyncCursor: providerServiceContract.syncMetadata.syncCursor,
      clientResumeToken: clientWorkflowHandoff.resumeToken,
      proof: proofFor({ surfaceId, canonicalState, subjectContractsProof: subjectContracts.proof })
    },
    restartSemantics: {
      status: recoveryState.restartStatus,
      checkpointRequired,
      writeModeAfterRestart: restartSafe ? 'read-write-trust-metadata' : 'read-only-trust-metadata',
      duplicateCommandBehavior: 'skip-already-applied-by-commandLedger',
      rejectedCommandBehavior: recoveryCommands.retryCommands.length > 0
        ? 'retry-with-same-command-id-and-incremented-retryAttempt'
        : recoveryCommands.reviewCommands.length > 0
          ? 'manual-review-before-write-resume'
          : 'none',
      appliedAuditCommandIds,
      rejectedAuditCommandIds,
      recoveryRoute: recoveryState.recoveryRoute,
      proof: proofFor({ surfaceId, recoveryState, appliedAuditCommandIds, rejectedAuditCommandIds, restartSafe })
    },
    recoveryCommands,
    routeContract: {
      persistRoute: '/memory-manager/trust-metadata/state/persist',
      restoreRoute: '/memory-manager/trust-metadata/state/restore',
      restartStatusRoute: '/memory-manager/trust-metadata/state/restart-status',
      recoveryCommandsRoute: '/memory-manager/trust-metadata/state/recovery-commands',
      proof: proofFor({ surfaceId, persistStatus, epoch: canonicalState.epoch })
    },
    proof: proofFor({ surfaceId, canonicalStateProof: canonicalState.stateProof, persistStatus, recoveryCommands })
  };
}

function normalizeCommand(command = {}, index = 0) {
  const commandId = typeof command.commandId === 'string' && command.commandId
    ? command.commandId
    : `transient:${index}`;
  const type = typeof command.type === 'string' ? command.type : 'checkpoint';
  const scope = normalizeScope(command);

  return {
    ...command,
    commandId,
    type,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    valid: KNOWN_COMMANDS.has(type),
    reason: KNOWN_COMMANDS.has(type) ? null : `unsupported command type: ${type}`
  };
}

function applyCommand(state, command, now) {
  if (state.appliedCommandIds.includes(command.commandId)) {
    const previousLedgerEntry = findCommandLedgerEntry(state, command.commandId);
    if (canRetryRejectedLedgerEntry(previousLedgerEntry, command)) {
      const retainedCommandIds = state.appliedCommandIds.filter((commandId) => commandId !== command.commandId);
      return applyCommand({
        ...state,
        appliedCommandIds: retainedCommandIds
      }, command, now);
    }

    return {
      state,
      applied: false,
      duplicate: true,
      error: previousLedgerEntry?.status === 'rejected' ? previousLedgerEntry.error : null,
      actor: previousLedgerEntry?.actorId ? { actorId: previousLedgerEntry.actorId } : null,
      previousLedgerEntry
    };
  }

  if (!command.valid) {
    return { state, applied: false, duplicate: false, error: command.reason };
  }

  const healthBarrier = buildHealthBarrier({ state, command });
  if (healthBarrier.blocked) {
    return {
      state,
      applied: false,
      duplicate: false,
      error: healthBarrier.reason,
      actor: normalizeActor(command.actor),
      healthBarrier,
      skipLedger: true
    };
  }

  const authorization = authorizeBoundary(command, {
    tenantId: command.tenantId,
    workspaceId: command.workspaceId
  });

  if (!authorization.allowed) {
    return {
      state: { ...state, appliedCommandIds: [...state.appliedCommandIds, command.commandId] },
      applied: false,
      duplicate: false,
      error: authorization.reason,
      actor: authorization.actor
    };
  }

  const next = {
    ...state,
    epoch: state.epoch + 1,
    appliedCommandIds: [...state.appliedCommandIds, command.commandId]
  };

  if (command.type === 'checkpoint') {
    next.checkpointProof = proofFor({ surfaceId, epoch: next.epoch, subjects: next.subjects });
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  if (command.type === 'configureLifecycleSettings') {
    const settingsValidation = validateLifecycleSettings(command.settings);
    const scheduleValidation = command.schedule === undefined
      ? { valid: true, schedule: state.lifecycleControls.schedule, errors: [], proof: null }
      : validateLifecycleSchedule(command.schedule, { now, requireFuture: true });
    const errors = [...settingsValidation.errors, ...scheduleValidation.errors];
    if (errors.length > 0) {
      return {
        state: { ...state, appliedCommandIds: next.appliedCommandIds },
        applied: false,
        duplicate: false,
        error: errors.join('; '),
        actor: authorization.actor
      };
    }

    next.lifecycleControls = normalizeLifecycleControls({
      ...state.lifecycleControls,
      settings: settingsValidation.settings,
      schedule: scheduleValidation.schedule,
      lastUpdatedAt: now,
      lastActorId: authorization.actor?.actorId || null,
      lastCommandId: command.commandId,
      revision: state.lifecycleControls.revision + 1
    });
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  if (command.type === 'enableTrustLifecycle') {
    const scheduleValidation = command.schedule === undefined
      ? { valid: true, schedule: state.lifecycleControls.schedule, errors: [], proof: null }
      : validateLifecycleSchedule(command.schedule, { now, requireFuture: true });
    if (!scheduleValidation.valid) {
      return {
        state: { ...state, appliedCommandIds: next.appliedCommandIds },
        applied: false,
        duplicate: false,
        error: scheduleValidation.errors.join('; '),
        actor: authorization.actor
      };
    }

    next.lifecycleControls = normalizeLifecycleControls({
      ...state.lifecycleControls,
      enabled: true,
      disabledReason: null,
      schedule: scheduleValidation.schedule,
      lastUpdatedAt: now,
      lastActorId: authorization.actor?.actorId || null,
      lastCommandId: command.commandId,
      revision: state.lifecycleControls.revision + 1
    });
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  if (command.type === 'disableTrustLifecycle') {
    next.lifecycleControls = normalizeLifecycleControls({
      ...state.lifecycleControls,
      enabled: false,
      disabledReason: typeof command.reason === 'string' && command.reason.trim()
        ? command.reason.trim()
        : 'disabled by hosted kernel lifecycle command',
      lastUpdatedAt: now,
      lastActorId: authorization.actor?.actorId || null,
      lastCommandId: command.commandId,
      revision: state.lifecycleControls.revision + 1
    });
    if (state.lifecycleControls.settings.checkpointBeforeDisable) {
      next.checkpointProof = proofFor({ surfaceId, epoch: next.epoch, lifecycleControls: next.lifecycleControls, subjects: next.subjects });
    }
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  if (command.type === 'scheduleLifecycleSweep') {
    const scheduleValidation = validateLifecycleSchedule(command.schedule, { now, requireFuture: true });
    if (!scheduleValidation.valid) {
      return {
        state: { ...state, appliedCommandIds: next.appliedCommandIds },
        applied: false,
        duplicate: false,
        error: scheduleValidation.errors.join('; '),
        actor: authorization.actor
      };
    }

    next.lifecycleControls = normalizeLifecycleControls({
      ...state.lifecycleControls,
      schedule: scheduleValidation.schedule,
      lastUpdatedAt: now,
      lastActorId: authorization.actor?.actorId || null,
      lastCommandId: command.commandId,
      revision: state.lifecycleControls.revision + 1
    });
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  const subjectId = typeof command.subjectId === 'string' && command.subjectId.trim()
    ? command.subjectId.trim()
    : null;

  if (!subjectId) {
    return {
      state: { ...state, appliedCommandIds: next.appliedCommandIds },
      applied: false,
      duplicate: false,
      error: 'subjectId is required'
    };
  }

  const subjectKey = scopedSubjectKey(command, subjectId);
  const previous = state.subjects[subjectKey] || {
    subjectId,
    subjectKey,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    trustLevel: 'unknown',
    lastUpdatedAt: null,
    revokedAt: null,
    reason: null,
    evidence: [],
    evidenceItems: [],
    revision: 0
  };
  const boundaryError = subjectBoundaryViolation(command, state.subjects[subjectKey]);
  if (boundaryError) {
    return {
      state: { ...state, appliedCommandIds: next.appliedCommandIds },
      applied: false,
      duplicate: false,
      error: boundaryError,
      actor: authorization.actor
    };
  }

  if (command.type === 'revokeSubjectTrust') {
    next.subjects = {
      ...state.subjects,
      [subjectKey]: shapeSubjectRecord({
        ...previous,
        subjectKey,
        tenantId: command.tenantId,
        workspaceId: command.workspaceId,
        trustLevel: 'untrusted',
        revokedAt: now,
        lastUpdatedAt: now,
        reason: typeof command.reason === 'string' ? command.reason : 'revoked by hosted kernel command',
        revision: previous.revision + 1,
        lastActorId: authorization.actor?.actorId || null,
        lastCommandId: command.commandId
      })
    };
    return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
  }

  const requestedTrust = TRUST_LEVELS.has(command.trustLevel) ? command.trustLevel : 'provisional';
  const evidenceItems = Array.isArray(command.evidence)
    ? normalizeEvidenceItems(command.evidence, {
      actorId: authorization.actor?.actorId || null,
      commandId: command.commandId,
      now
    })
    : previous.evidenceItems || [];
  next.subjects = {
    ...state.subjects,
    [subjectKey]: shapeSubjectRecord({
      subjectId,
      subjectKey,
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      trustLevel: requestedTrust,
      lastUpdatedAt: now,
      revokedAt: null,
      reason: typeof command.reason === 'string' ? command.reason : previous.reason,
      evidence: evidenceUrisFromItems(evidenceItems),
      evidenceItems,
      revision: previous.revision + 1,
      lastActorId: authorization.actor?.actorId || null,
      lastCommandId: command.commandId
    })
  };

  return { state: next, applied: true, duplicate: false, error: null, actor: authorization.actor };
}

export function shapeTrustMetadataState(input = {}) {
  const now = input.now || new Date().toISOString();
  const clientRequest = normalizeClientRuntimeRequest(input);
  const clientRuntimeState = normalizeClientRuntimeState(input, clientRequest);
  const providerRuntime = normalizeProviderRuntime(input);
  const providerRequest = normalizeProviderOperationRequest(input, providerRuntime);
  const recoveredState = normalizePersistedState(input.persistedState);
  const commands = Array.isArray(input.commands) ? input.commands.map(normalizeCommand) : [];
  const audit = [];
  let currentState = recoveredState;

  for (const command of commands) {
    const beforeEpoch = currentState.epoch;
    const result = applyCommand(currentState, command, now);
    currentState = result.state;
    const ledgerEntry = commandLedgerEntryFor({
      command,
      result,
      beforeEpoch,
      afterEpoch: currentState.epoch,
      now
    });
    if (!result.skipLedger) {
      currentState = withCommandLedgerEntry(currentState, ledgerEntry);
    }
    audit.push({
      commandId: command.commandId,
      type: command.type,
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      actorId: result.actor?.actorId || null,
      applied: result.applied,
      duplicate: result.duplicate,
      error: result.error,
      beforeEpoch,
      afterEpoch: currentState.epoch,
      replayDisposition: result.skipLedger ? 'blocked-by-health-barrier' : ledgerEntry.replayDisposition,
      commandLedgerProof: result.skipLedger ? null : ledgerEntry.proof,
      healthBarrier: result.healthBarrier
        ? {
          blocked: result.healthBarrier.blocked,
          reason: result.healthBarrier.reason,
          blockerCommandIds: result.healthBarrier.blockers.map((failure) => failure.commandId),
          proof: result.healthBarrier.proof
        }
        : null,
      proof: proofFor({ commandId: command.commandId, beforeEpoch, afterEpoch: currentState.epoch, error: result.error })
    });
  }

  const recoveredSubjectCount = Object.keys(recoveredState.subjects).length;
  const trustedSubjectCount = Object.values(currentState.subjects)
    .filter((record) => record.trustLevel === 'trusted' || record.trustLevel === 'pinned')
    .length;
  const hasCommandErrors = audit.some((entry) => entry.error);
  const tenantWorkspacePairs = [...new Set(Object.values(currentState.subjects)
    .map((record) => `${record.tenantId}/${record.workspaceId}`))]
    .sort();
  const boundaryRejectedCount = audit.filter((entry) => entry.error && entry.error.includes('boundary')).length;
  const permissionRejectedCount = audit.filter((entry) => entry.error && entry.error.includes('permission')).length;
  const operationalHealth = buildOperationalHealth(audit, commands, currentState);
  const recoveryState = buildRecoveryState({
    recoveredState,
    currentState,
    audit,
    now
  });
  const rejectedBoundaryAudit = summarizeBoundaryAudit(audit);
  const analytics = buildAnalyticsReport({
    recoveredState,
    currentState,
    commands,
    audit,
    operationalHealth,
    now
  });
  currentState = {
    ...currentState,
    analyticsHistory: analytics.history
  };
  const lifecycleControls = buildLifecycleRuntimeState({
    lifecycleControls: currentState.lifecycleControls,
    operationalHealth,
    currentState,
    now
  });
  currentState = {
    ...currentState,
    lifecycleControls
  };
  const subjectContracts = buildSubjectContracts(currentState.subjects);
  const previewAcceptance = buildUserVisiblePreview({
    commands,
    audit,
    currentState,
    operationalHealth,
    now
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    clientRequest,
    commands,
    audit,
    currentState,
    previewAcceptance,
    operationalHealth,
    analytics,
    now
  });
  const previewDecisionContract = buildPreviewDecisionContract({
    previewAcceptance,
    clientWorkflowHandoff,
    currentState,
    operationalHealth,
    now
  });
  const previewDecisionSubmission = normalizePreviewDecisionSubmission(input, clientRequest);
  const providerServiceContract = buildProviderServiceContract({
    providerRuntime,
    providerRequest,
    currentState,
    operationalHealth,
    lifecycleControls,
    subjectContracts,
    clientWorkflowHandoff,
    analytics,
    now
  });
  const providerSyncAcknowledgement = normalizeProviderSyncAcknowledgement(input, providerRuntime);
  const providerSyncReconciliation = reconcileProviderSyncAcknowledgement({
    acknowledgement: providerSyncAcknowledgement,
    providerServiceContract,
    analytics,
    now
  });
  const clientRuntimeAdoption = buildClientRuntimeAdoption({
    clientRequest,
    clientRuntimeState,
    clientWorkflowHandoff,
    previewDecisionContract,
    previewDecisionSubmission,
    previewAcceptance,
    providerServiceContract,
    currentState,
    operationalHealth,
    analytics,
    now
  });
  const clientRouteDataContracts = buildClientRouteDataContracts({
    previewAcceptance,
    previewDecisionContract,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    providerServiceContract,
    currentState,
    operationalHealth,
    analytics,
    now
  });
  const statePersistence = buildStatePersistenceEnvelope({
    recoveredState,
    currentState,
    recoveryState,
    operationalHealth,
    subjectContracts,
    lifecycleControls,
    analytics,
    providerServiceContract,
    clientWorkflowHandoff,
    audit,
    now
  });
  const mailchimpCampaignContinuity = buildMailchimpCampaignContinuityContract({
    productWorkflow: clientRequest.productWorkflow,
    clientRequest,
    currentState,
    operationalHealth,
    recoveryState,
    now
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status: recoveryState.restartStatus !== 'restart-safe'
      ? recoveryState.restartStatus
      : operationalHealth.degraded
        ? 'degraded'
        : hasCommandErrors
        ? 'recoverable-command-errors'
        : 'ready',
    restartSafe: statePersistence.restartSafe,
    recovered: {
      fromPersistedState: Boolean(input.persistedState),
      subjectCount: recoveredSubjectCount,
      commandWatermark: recoveredState.appliedCommandIds.length,
      commandLedgerEntryCount: recoveredState.commandLedger.length,
      persistedRejectedCommandIds: recoveryState.persistedRejectedCommandIds,
      checkpointProof: recoveredState.checkpointProof,
      analyticsSnapshotCount: recoveredState.analyticsHistory.length
    },
    state: currentState,
    summary: {
      subjectCount: Object.keys(currentState.subjects).length,
      trustedSubjectCount,
      appliedCommandCount: audit.filter((entry) => entry.applied).length,
      duplicateCommandCount: audit.filter((entry) => entry.duplicate).length,
      rejectedCommandCount: audit.filter((entry) => entry.error).length,
      tenantWorkspaceCount: tenantWorkspacePairs.length,
      boundaryRejectedCount,
      permissionRejectedCount,
      recallEligibleSubjectCount: subjectContracts.recallEligibleSubjectKeys.length,
      reviewRequiredSubjectCount: subjectContracts.reviewRequiredSubjectKeys.length,
      evidenceItemCount: subjectContracts.evidenceItemCount,
      lifecycleMode: lifecycleControls.mode,
      lifecycleNextAction: lifecycleControls.nextAction.actionId,
      lifecycleScheduleStatus: lifecycleControls.scheduleReadiness.status,
      lifecycleCanRunScheduledSweep: lifecycleControls.scheduleReadiness.canRunNow,
      lifecycleCandidateSubjectCount: lifecycleControls.candidateSubjectKeys.length,
      operationalHealthStatus: operationalHealth.status,
      operationalWriteBarrierActive: operationalHealth.degradedMode.active,
      operationalRetryableFailureCount: operationalHealth.counters.retryableFailureCount,
      operationalManualRecoveryFailureCount: operationalHealth.counters.manualRecoveryFailureCount,
      operationalPersistedFailureCount: operationalHealth.failureSources.persistedLedgerFailureCount,
      operationalRecoveryRoute: operationalHealth.degradedMode.recoveryRoute,
      providerNegotiatedCapabilityCount: providerServiceContract.capabilityNegotiation.negotiatedCapabilities.length,
      providerSyncRequired: providerServiceContract.syncMetadata.syncRequired,
      providerSyncAcknowledgementStatus: providerSyncReconciliation.status,
      providerSyncAcknowledgementIssueCount: providerSyncReconciliation.issues.length,
      providerSyncAcknowledgementAccepted: providerSyncReconciliation.accepted,
      providerExternalHandoffReady: providerSyncReconciliation.handoffReady,
      providerRouteContractCount: Object.keys(providerServiceContract.routeDataContracts.routes).length,
      providerSyncSubjectCount: providerServiceContract.routeDataContracts.syncSubjectCount,
      clientRouteContractCount: Object.keys(clientRouteDataContracts.routes).length,
      previewDecisionSubmissionMode: previewDecisionContract.submissionMode,
      previewDecisionBlockingCount: previewDecisionContract.validation.blockingDecisionCount,
      previewDecisionReconciliationStatus: clientRuntimeAdoption.previewDecisionReconciliation.status,
      previewDecisionReconciledCount: clientRuntimeAdoption.previewDecisionReconciliation.reconciledDecisions.length,
      previewDecisionIssueCount: clientRuntimeAdoption.previewDecisionReconciliation.issues.length,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeConflictCount: clientRuntimeAdoption.conflicts.length,
      acceptanceCursor: clientRouteDataContracts.acceptanceCursor,
      statePersistenceStatus: statePersistence.persistStatus,
      statePersistenceRestartSafe: statePersistence.restartSafe,
      statePersistenceCheckpointRequired: statePersistence.restartSemantics.checkpointRequired,
      statePersistenceRecoveryCommandCount: statePersistence.recoveryCommands.retryCommands.length
        + statePersistence.recoveryCommands.reviewCommands.length,
      statePersistenceManifestEpoch: statePersistence.manifest.epoch,
      recoveryRestartStatus: recoveryState.restartStatus,
      recoveryRetryableCommandCount: recoveryState.retryableCommandIds.length,
      recoveryManualReviewCommandCount: recoveryState.manualReviewCommandIds.length,
      analyticsSubjectCreatedCount: analytics.subjectCounters.created,
      analyticsSubjectUpdatedCount: analytics.subjectCounters.updated,
      analyticsSubjectTransitionCount: Object.keys(analytics.subjectCounters.byTransition).length,
      analyticsTimelineRetainedEventCount: analytics.timelineReporting.retainedEventCount,
      analyticsTimelineTruncated: analytics.timelineReporting.truncated,
      analyticsTrendStatus: analytics.trendReport.status,
      analyticsRiskSignalCount: analytics.trendReport.riskSignals.length,
      analyticsExportPackageId: analytics.exportPackage.exportId
    },
    recoveryState,
    lifecycleControls,
    subjectContracts,
    analytics: {
      counters: analytics.counters,
      subjectCounters: analytics.subjectCounters,
      trustDistribution: analytics.trustDistribution,
      snapshot: analytics.snapshot,
      history: analytics.history,
      timelineReporting: analytics.timelineReporting,
      trendReport: analytics.trendReport,
      exportPackage: analytics.exportPackage
    },
    previewAcceptance,
    previewDecisionContract,
    previewDecisionSubmission,
    clientWorkflowHandoff,
    clientRuntimeState,
    clientRuntimeAdoption,
    providerServiceContract,
    providerSyncAcknowledgement,
    providerSyncReconciliation,
    providerRouteDataContracts: providerServiceContract.routeDataContracts,
    clientRouteDataContracts,
    statePersistence,
    mailchimpCampaignContinuity,
    validationSummary: previewAcceptance.validationSummary,
    readiness: previewAcceptance.readiness,
    nextSteps: previewAcceptance.nextSteps,
    timeline: analytics.timeline,
    reporting: analytics.reporting,
    exportSummary: analytics.exportSummary,
    exportPackage: analytics.exportPackage,
    operationalHealth,
    boundary: {
      defaultTenantId: DEFAULT_TENANT_ID,
      defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
      tenantWorkspacePairs,
      enforced: true,
      workspaceWildcard: WORKSPACE_WILDCARD,
      rejected: rejectedBoundaryAudit
    },
    auditHandoff: {
      sink: 'hosted-kernel.memory-manager.trust-metadata',
      rejectedCommandIds: audit.filter((entry) => entry.error).map((entry) => entry.commandId),
      healthStatus: operationalHealth.status,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      writeBarrierActive: operationalHealth.degradedMode.active,
      healthFailureSources: operationalHealth.failureSources,
      healthRecoveryRoute: operationalHealth.degradedMode.recoveryRoute,
      nextRetryDelayMs: operationalHealth.nextRetryDelayMs,
      boundaryRejectedCount,
      permissionRejectedCount,
      rejectedByTenantWorkspace: rejectedBoundaryAudit.byTenantWorkspace,
      rejectedByActor: rejectedBoundaryAudit.byActor,
      analyticsExportProof: analytics.exportSummary.proof,
      analyticsExportPackageId: analytics.exportPackage.exportId,
      analyticsTimelineCursor: analytics.timelineReporting.cursor,
      analyticsTrendStatus: analytics.trendReport.status,
      analyticsRiskSignalCount: analytics.trendReport.riskSignals.length,
      analyticsRiskSignalsRoute: analytics.trendReport.routes.riskSignalsRoute,
      analyticsExportRecordChecksums: analytics.trendReport.exportRecords.map((record) => record.checksum),
      latestAnalyticsSnapshotId: analytics.snapshot.snapshotId,
      subjectContractsProof: subjectContracts.proof,
      recallEligibleSubjectCount: subjectContracts.recallEligibleSubjectKeys.length,
      reviewRequiredSubjectCount: subjectContracts.reviewRequiredSubjectKeys.length,
      lifecycleMode: lifecycleControls.mode,
      lifecycleNextAction: lifecycleControls.nextAction.actionId,
      lifecycleScheduleStatus: lifecycleControls.scheduleReadiness.status,
      lifecycleCanRunScheduledSweep: lifecycleControls.scheduleReadiness.canRunNow,
      lifecycleNextEligibleRunAt: lifecycleControls.scheduleReadiness.nextEligibleRunAt,
      lifecycleProof: lifecycleControls.proof,
      previewAcceptanceProof: previewAcceptance.proof,
      previewDecisionProof: previewDecisionContract.proof,
      previewDecisionSubmissionMode: previewDecisionContract.submissionMode,
      previewDecisionBlockingCount: previewDecisionContract.validation.blockingDecisionCount,
      previewDecisionReconciliationStatus: clientRuntimeAdoption.previewDecisionReconciliation.status,
      previewDecisionReconciliationProof: clientRuntimeAdoption.previewDecisionReconciliation.proof,
      previewDecisionIssueCount: clientRuntimeAdoption.previewDecisionReconciliation.issues.length,
      readinessStatus: previewAcceptance.readiness.status,
      clientWorkflowPhase: clientWorkflowHandoff.phase,
      clientResumeToken: clientWorkflowHandoff.resumeToken,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeAdoptionProof: clientRuntimeAdoption.proof,
      clientRuntimeConflictCount: clientRuntimeAdoption.conflicts.length,
      providerId: providerServiceContract.provider.providerId,
      providerSyncRequired: providerServiceContract.syncMetadata.syncRequired,
      providerSyncCursor: providerServiceContract.syncMetadata.syncCursor,
      providerNegotiatedCapabilities: providerServiceContract.capabilityNegotiation.negotiatedCapabilities,
      providerRequestProof: providerServiceContract.requestContract.proof,
      providerSyncAcknowledgementStatus: providerSyncReconciliation.status,
      providerSyncAcknowledgementProof: providerSyncReconciliation.proof,
      providerSyncAcknowledgementIssueCount: providerSyncReconciliation.issues.length,
      providerSyncCommittedState: providerSyncReconciliation.committedProviderState,
      providerSyncNextAction: providerSyncReconciliation.nextAction,
      providerExternalHandoffReady: providerSyncReconciliation.handoffReady,
      providerRouteDataContractsProof: providerServiceContract.routeDataContracts.proof,
      providerSyncSubjectCount: providerServiceContract.routeDataContracts.syncSubjectCount,
      providerSyncOmittedSubjectCount: providerServiceContract.routeDataContracts.omittedSubjectCount,
      providerExternalHandoffProof: providerServiceContract.externalHandoffState.proof,
      clientRouteDataContractsProof: clientRouteDataContracts.proof,
      clientRouteContractCount: Object.keys(clientRouteDataContracts.routes).length,
      statePersistenceStatus: statePersistence.persistStatus,
      statePersistenceRestartSafe: statePersistence.restartSafe,
      statePersistenceProof: statePersistence.proof,
      persistedStateProof: statePersistence.canonicalState.stateProof,
      statePersistenceManifestProof: statePersistence.manifest.proof,
      statePersistenceRestartStatusRoute: statePersistence.routeContract.restartStatusRoute,
      statePersistenceRecoveryCommandCount: statePersistence.recoveryCommands.retryCommands.length
        + statePersistence.recoveryCommands.reviewCommands.length,
      statePersistenceCheckpointRequired: statePersistence.restartSemantics.checkpointRequired,
      mailchimpCampaignContinuityApplies: mailchimpCampaignContinuity.applies,
      mailchimpCampaignContinuityDisposition: mailchimpCampaignContinuity.auditDisposition,
      mailchimpCampaignContinuityRestartSafe: mailchimpCampaignContinuity.restartSafe,
      mailchimpCampaignContinuityProof: mailchimpCampaignContinuity.proof,
      mailchimpCampaignContinuityReplayKey: mailchimpCampaignContinuity.replayKey,
      mailchimpCampaignContinuitySubjectCount: mailchimpCampaignContinuity.scopedSubjectKeys.length,
      mailchimpCampaignContinuityBlockedReasons: mailchimpCampaignContinuity.handoff.blockedReasons,
      recoveryRestartStatus: recoveryState.restartStatus,
      recoveryRetryableCommandIds: recoveryState.retryableCommandIds,
      recoveryManualReviewCommandIds: recoveryState.manualReviewCommandIds,
      recoveryRoute: recoveryState.recoveryRoute,
      commandLedgerEntryCount: currentState.commandLedger.length,
      proof: proofFor({ surfaceId, audit, tenantWorkspacePairs })
    },
    audit,
    proof: proofFor({ surfaceId, schemaVersion: CURRENT_SCHEMA_VERSION, state: currentState, audit })
  };
}

export function describeTrustMetadataSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const shaped = shapeTrustMetadataState({ ...input, now });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel trust metadata state contract',
    stateContract: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      commandTypes: [...KNOWN_COMMANDS],
      trustLevels: [...TRUST_LEVELS],
      idempotencyKey: 'commandId',
      scopeFields: ['tenantId', 'workspaceId', 'actor.actorId', 'actor.roles', 'actor.permissions'],
      subjectProvenanceFields: ['lastActorId', 'lastCommandId', 'revision'],
      persistedFields: ['schemaVersion', 'epoch', 'appliedCommandIds', 'commandLedger', 'subjects', 'checkpointProof', 'analyticsHistory', 'lifecycleControls'],
      statePersistenceFields: ['format', 'generatedAt', 'persistStatus', 'restartSafe', 'canonicalState', 'manifest', 'restartSemantics', 'recoveryCommands', 'routeContract', 'proof'],
      mailchimpCampaignContinuityFields: ['format', 'generatedAt', 'applies', 'provider', 'stage', 'tenantId', 'workspaceId', 'campaignId', 'audienceId', 'segmentId', 'workflowId', 'stateKey', 'scopedSubjectKeys', 'missingIdentifiers', 'restartSafe', 'auditDisposition', 'replayKey', 'handoff', 'exportRecord', 'proof'],
      mailchimpCampaignContinuityHandoffFields: ['route', 'resumeToken', 'blockedReasons'],
      mailchimpCampaignContinuityExportFields: ['dataset', 'recordId', 'tenantId', 'workspaceId', 'subjectCount', 'checksum'],
      canonicalPersistedStateFields: ['schemaVersion', 'epoch', 'appliedCommandIds', 'commandLedger', 'subjects', 'checkpointProof', 'analyticsHistory', 'lifecycleControls', 'stateProof'],
      statePersistenceManifestFields: ['schemaVersion', 'epoch', 'subjectCount', 'commandLedgerEntryCount', 'analyticsSnapshotCount', 'lifecycleRevision', 'checkpointProof', 'stateProof', 'subjectContractsProof', 'analyticsSnapshotId', 'providerSyncCursor', 'clientResumeToken', 'proof'],
      restartSemanticsFields: ['status', 'checkpointRequired', 'writeModeAfterRestart', 'duplicateCommandBehavior', 'rejectedCommandBehavior', 'appliedAuditCommandIds', 'rejectedAuditCommandIds', 'recoveryRoute', 'proof'],
      restartRecoveryCommandFields: ['format', 'generatedAt', 'retryCommands', 'reviewCommands', 'proof'],
      statePersistenceRouteFields: ['persistRoute', 'restoreRoute', 'restartStatusRoute', 'recoveryCommandsRoute', 'proof'],
      commandLedgerFields: ['format', 'commandId', 'type', 'tenantId', 'workspaceId', 'actorId', 'status', 'error', 'errorKind', 'retryable', 'restartSafe', 'exhausted', 'retryAttempt', 'idempotencyKey', 'replayDisposition', 'proof'],
      recoveryStateFields: ['format', 'generatedAt', 'recoveredEpoch', 'currentEpoch', 'ledgerEntryCount', 'persistedRejectedCommandIds', 'retryableCommandIds', 'manualReviewCommandIds', 'replayedCommandIds', 'restartStatus', 'restartSafe', 'checkpointRequired', 'recoveryRoute', 'proof'],
      subjectRecordFields: ['subjectKey', 'trustLevel', 'evidenceItems', 'integrity', 'recallPolicy', 'routeContract', 'recordProof'],
      subjectIntegrityFields: ['format', 'subjectKey', 'trustRank', 'evidenceCount', 'provenanceComplete', 'recallEligible', 'requiresReview', 'warnings', 'proof'],
      subjectContractsFields: ['format', 'subjectCount', 'recallEligibleSubjectKeys', 'reviewRequiredSubjectKeys', 'evidenceItemCount', 'fields', 'proof'],
      operationalHealthFields: ['status', 'degraded', 'retrying', 'mode', 'writeEnabled', 'readEnabled', 'retryPolicy', 'failureSources', 'degradedMode', 'counters', 'nextRetryDelayMs', 'actionableErrors', 'proof'],
      operationalHealthFailureSourceFields: ['currentBatchFailureCount', 'persistedLedgerFailureCount', 'proof'],
      operationalHealthDegradedModeFields: ['active', 'reason', 'allowedCommandTypes', 'blockedCommandTypes', 'recoveryRoute', 'proof'],
      operationalActionableErrorFields: ['commandId', 'type', 'tenantId', 'workspaceId', 'actorId', 'kind', 'retryable', 'retryAttempt', 'maxRetryAttempts', 'nextRetryDelayMs', 'exhausted', 'message', 'action', 'proof'],
      lifecycleControlsFields: ['format', 'enabled', 'mode', 'settings', 'schedule', 'scheduleReadiness', 'candidateCounts', 'candidateSubjectKeys', 'nextAction', 'routeContract', 'proof'],
      lifecycleSettingsFields: ['staleAfterDays', 'reviewCadenceHours', 'retentionDays', 'maxSubjectsPerSweep', 'evidenceRequiredForTrusted', 'autoDisableOnDegraded', 'checkpointBeforeDisable'],
      lifecycleScheduleFields: ['enabled', 'nextRunAt', 'lastRunAt', 'intervalMinutes', 'minLeadTimeMinutes', 'timezone', 'pausedUntil', 'pauseReason'],
      lifecycleScheduleReadinessFields: ['format', 'status', 'enabled', 'paused', 'pausedUntil', 'pauseReason', 'due', 'canRunNow', 'blockedReason', 'nextEligibleRunAt', 'candidateSubjectCount', 'sweepCommandTemplate', 'proof'],
      lifecycleNextActionFields: ['actionId', 'route', 'required', 'reason', 'proof'],
      analyticsFields: ['counters', 'subjectCounters', 'trustDistribution', 'snapshot', 'history', 'timelineReporting', 'trendReport', 'exportPackage'],
      analyticsSubjectCounterFields: ['total', 'created', 'updated', 'unchanged', 'removed', 'revoked', 'byTrustLevel', 'byTransition', 'byTenantWorkspace', 'evidenceItemCount', 'evidenceBackedTrustedCount', 'missingEvidenceTrustedCount', 'recallEligibleSubjectCount', 'reviewRequiredSubjectCount', 'proof'],
      analyticsSnapshotFields: ['snapshotId', 'capturedAt', 'epoch', 'subjectCount', 'trustedSubjectCount', 'rejectedCommandCount', 'commandTotalCount', 'recallEligibleSubjectCount', 'reviewRequiredSubjectCount', 'evidenceItemCount', 'exportSequence', 'degraded', 'delta', 'proof'],
      analyticsSnapshotDeltaFields: ['fromSnapshotId', 'toSnapshotId', 'epochDelta', 'subjectCountDelta', 'trustedSubjectCountDelta', 'rejectedCommandCountDelta', 'commandTotalCountDelta', 'recallEligibleSubjectCountDelta', 'reviewRequiredSubjectCountDelta', 'healthTransition', 'proof'],
      analyticsTrendReportFields: ['format', 'generatedAt', 'status', 'window', 'deltas', 'rates', 'riskSignals', 'routes', 'exportRecords', 'proof'],
      analyticsTrendWindowFields: ['retainedSnapshotCount', 'firstSnapshotId', 'latestSnapshotId', 'firstCapturedAt', 'latestCapturedAt', 'degradedSnapshotCount', 'proof'],
      analyticsTrendDeltaFields: ['epochDelta', 'subjectCountDelta', 'trustedSubjectCountDelta', 'rejectedCommandCountDelta', 'commandTotalCountDelta', 'reviewRequiredSubjectCountDelta', 'recallEligibleSubjectCountDelta', 'evidenceItemCountDelta', 'proof'],
      analyticsTrendRateFields: ['currentRejectedCommandRatePercent', 'retainedRejectedCommandRatePercent', 'reviewRequiredSubjectRatePercent', 'recallEligibleSubjectRatePercent', 'evidenceBackedTrustedRatePercent', 'timelineErrorEventRatePercent'],
      analyticsRiskSignalFields: ['signalId', 'severity', 'message', 'route', 'proof'],
      analyticsExportRecordFields: ['dataset', 'recordId', 'mediaType', 'checksum', 'route'],
      previewAcceptanceFields: ['generatedAt', 'format', 'previewCount', 'previews', 'validationSummary', 'acceptance', 'readiness', 'nextSteps', 'routeContract', 'proof'],
      previewDecisionContractFields: ['format', 'generatedAt', 'route', 'method', 'mediaType', 'idempotencyKey', 'submissionMode', 'canSubmitWithoutReview', 'decisionItems', 'defaults', 'validation', 'submitTemplate', 'proof'],
      previewDecisionItemFields: ['decisionItemId', 'commandId', 'subjectKey', 'acceptanceStatus', 'recommendedDecision', 'allowedDecisions', 'blocking', 'requiresComment', 'validationMessage', 'explanation', 'proof'],
      previewDecisionSubmissionFields: ['format', 'submitted', 'requestId', 'clientId', 'resumeToken', 'continuationToken', 'checkpointAfterAccept', 'decisions', 'proof'],
      previewDecisionReconciliationFields: ['format', 'generatedAt', 'status', 'submitted', 'requestId', 'clientId', 'acceptedCommandIds', 'rejectedCommandIds', 'deferredCommandIds', 'reconciledDecisions', 'issues', 'handoffEffect', 'proof'],
      clientWorkflowHandoffFields: ['format', 'generatedAt', 'request', 'phase', 'route', 'resumeToken', 'clientStatePatch', 'workflowActions', 'integration', 'proof'],
      clientRuntimeStateFields: ['format', 'clientId', 'requestId', 'sessionId', 'tenantId', 'workspaceId', 'trustMetadataEpoch', 'acceptedCommandIds', 'rejectedCommandIds', 'lastResumeToken', 'proof'],
      clientRuntimeAdoptionFields: ['format', 'generatedAt', 'status', 'request', 'previousState', 'patch', 'adoptedState', 'previewDecisionReconciliation', 'conflicts', 'handoff', 'exportBinding', 'proof'],
      providerServiceContractFields: ['format', 'generatedAt', 'provider', 'service', 'capabilityNegotiation', 'requestContract', 'syncMetadata', 'externalHandoffState', 'routeDataContracts', 'proof'],
      providerOperationRequestFields: ['format', 'requestId', 'providerId', 'serviceId', 'tenantId', 'workspaceId', 'syncMode', 'sinceEpoch', 'maxSubjectKeys', 'includeAnalytics', 'includeExternalHandoff', 'callbackRoute', 'proof'],
      clientRouteDataContractsFields: ['format', 'generatedAt', 'routes', 'payloads', 'acceptanceCursor', 'proof'],
      providerRouteDataContractsFields: ['format', 'generatedAt', 'request', 'routes', 'payloads', 'syncSubjectCount', 'omittedSubjectCount', 'proof'],
      clientRoutePayloadFields: ['route', 'method', 'mediaType', 'cache', 'idempotencyKey', 'body'],
      providerRoutePayloadFields: ['route', 'method', 'mediaType', 'cache', 'idempotencyKey', 'body'],
      providerNegotiateRouteBodyFields: ['request', 'serviceId', 'schemaVersion', 'availableCapabilities', 'negotiatedCapabilities', 'deniedCapabilities', 'proof'],
      providerSyncRouteBodyFields: ['syncRequired', 'syncMode', 'fromEpoch', 'toEpoch', 'syncCursor', 'checkpointProof', 'subjectContractsProof', 'subjectKeys', 'omittedSubjectCount', 'lifecycleRevision', 'writeBarrierActive', 'proof'],
      providerExportRouteBodyFields: ['exportReady', 'analyticsSnapshotId', 'exportSummary', 'exportPackage', 'timelineReporting', 'trendReport', 'reportingSink', 'deniedReason', 'proof'],
      providerHandoffRouteBodyFields: ['enabled', 'phase', 'clientRoute', 'clientResumeToken', 'continuationToken', 'callbackRoute', 'canResumeWrites', 'proof'],
      previewRouteBodyFields: ['generatedAt', 'epoch', 'previews', 'previewCount', 'proof'],
      acceptanceRouteBodyFields: ['acceptedCommandIds', 'rejectedCommandIds', 'canAcceptAll', 'requiresUserReview', 'checkpointRoute', 'proof'],
      previewDecisionRouteBodyFields: ['submissionMode', 'canSubmitWithoutReview', 'decisionItems', 'defaults', 'validation', 'submitTemplate', 'proof'],
      readinessRouteBodyFields: ['status', 'writeEnabled', 'healthStatus', 'clientPhase', 'providerSyncRequired', 'analyticsSnapshotId', 'blockers', 'proof'],
      validationSummaryRouteBodyFields: ['total', 'invalid', 'missingSubjectIds', 'byAcceptanceStatus', 'byErrorKind', 'rejectedCommandIds', 'actionableErrors', 'proof'],
      nextStepsRouteBodyFields: ['steps', 'defaultRoute', 'workflowActions', 'adoptionRoute', 'providerHandoffRoute', 'proof'],
      clientRuntimeAdoptionRouteBodyFields: ['status', 'previousStateProof', 'patch', 'adoptedState', 'conflicts', 'previewDecisionReconciliation', 'handoff', 'proof'],
      providerCapabilityNegotiationFields: ['requestedCapabilities', 'availableCapabilities', 'negotiatedCapabilities', 'deniedCapabilities', 'writeBarrierActive', 'proof'],
      providerSyncMetadataFields: ['syncRequired', 'currentEpoch', 'providerLastSyncedEpoch', 'syncCursor', 'checkpointProof', 'subjectContractsProof', 'analyticsSnapshotId', 'lifecycleRevision', 'pendingActionId', 'lifecycleScheduleStatus', 'lifecycleNextEligibleRunAt', 'proof'],
      providerExternalHandoffFields: ['enabled', 'phase', 'route', 'clientResumeToken', 'continuationToken', 'canResumeWrites', 'exportReady', 'proof'],
      commandPreviewFields: ['commandId', 'type', 'tenantId', 'workspaceId', 'actorId', 'subjectId', 'acceptanceStatus', 'validation', 'resultingTrustLevel', 'previewText', 'proof'],
      previewDecisionDefaultsFields: ['acceptCommandIds', 'rejectCommandIds', 'deferCommandIds', 'checkpointAfterAccept'],
      readinessFields: ['status', 'writeEnabled', 'previewEnabled', 'blockers', 'proof'],
      nextStepFields: ['stepId', 'label', 'commandIds', 'routeHint', 'proof'],
      timelineFields: ['eventId', 'commandId', 'type', 'subjectId', 'eventKind', 'beforeEpoch', 'afterEpoch', 'errorKind', 'proof'],
      timelineReportingFields: ['format', 'generatedAt', 'retainedEventCount', 'sourceAuditCount', 'truncated', 'cursor', 'latestEventId', 'byEventKind', 'byErrorKind', 'byTenantWorkspace', 'routes', 'proof'],
      reportingFields: ['reportKey', 'sink', 'exportReady', 'exportFormats', 'exportDatasets', 'exportPackageId', 'retainedSnapshotLimit', 'retainedTimelineLimit', 'timelineCursor', 'trendStatus', 'riskSignalCount', 'riskSignalsRoute', 'proof'],
      exportSummaryFields: ['format', 'generatedAt', 'surfaceId', 'schemaVersion', 'epoch', 'status', 'counters', 'subjectCounters', 'trustDistribution', 'latestSnapshotId', 'timelineEventCount', 'historySnapshotCount', 'timelineCursor', 'trendStatus', 'riskSignalCount', 'exportRecords', 'exportDatasets', 'proof'],
      exportPackageFields: ['format', 'exportId', 'generatedAt', 'mediaTypes', 'datasets', 'manifest', 'integrity', 'proof'],
      auditHandoffFields: ['rejectedCommandIds', 'rejectedByTenantWorkspace', 'rejectedByActor', 'analyticsExportProof', 'latestAnalyticsSnapshotId', 'subjectContractsProof', 'recallEligibleSubjectCount', 'reviewRequiredSubjectCount', 'lifecycleScheduleStatus', 'lifecycleNextEligibleRunAt', 'previewAcceptanceProof', 'readinessStatus', 'clientRuntimeAdoptionProof', 'statePersistenceProof', 'persistedStateProof', 'proof']
    },
    status: shaped.status,
    restartSafe: shaped.restartSafe,
    recovered: shaped.recovered,
    summary: shaped.summary,
    recoveryState: shaped.recoveryState,
    lifecycleControls: shaped.lifecycleControls,
    subjectContracts: shaped.subjectContracts,
    analytics: shaped.analytics,
    previewAcceptance: shaped.previewAcceptance,
    previewDecisionContract: shaped.previewDecisionContract,
    previewDecisionSubmission: shaped.previewDecisionSubmission,
    clientWorkflowHandoff: shaped.clientWorkflowHandoff,
    clientRuntimeState: shaped.clientRuntimeState,
    clientRuntimeAdoption: shaped.clientRuntimeAdoption,
    providerServiceContract: shaped.providerServiceContract,
    providerRouteDataContracts: shaped.providerRouteDataContracts,
    clientRouteDataContracts: shaped.clientRouteDataContracts,
    statePersistence: shaped.statePersistence,
    mailchimpCampaignContinuity: shaped.mailchimpCampaignContinuity,
    validationSummary: shaped.validationSummary,
    readiness: shaped.readiness,
    nextSteps: shaped.nextSteps,
    timeline: shaped.timeline,
    reporting: shaped.reporting,
    exportSummary: shaped.exportSummary,
    exportPackage: shaped.exportPackage,
    operationalHealth: shaped.operationalHealth,
    boundary: shaped.boundary,
    state: shaped.state,
    auditHandoff: shaped.auditHandoff,
    audit: shaped.audit,
    proof: shaped.proof,
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeTrustMetadataSurface;
