export const surfaceId = "aios_audit-recovery_resume-token_076";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "resume-token";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;
const REQUIRED_TOKEN_FIELDS = ['tokenId', 'issuedAt', 'scope', 'checkpointId'];
const MAX_HISTORY_SNAPSHOTS = 25;
const HISTORY_TREND_WINDOW_SIZE = 10;
const EXPORT_TIMELINE_LIMIT = 12;
const LIFECYCLE_COMMANDS = new Set([
  'inspect',
  'enable',
  'disable',
  'pause',
  'resume',
  'rotate-token',
  'update-settings',
  'schedule-resume',
  'cancel-schedule'
]);
const MIN_SCHEDULE_DELAY_MS = 5_000;
const MAX_SCHEDULE_DELAY_MS = 24 * 60 * 60 * 1000;
const MIN_CONFIGURED_SCHEDULE_DELAY_MS = 1_000;
const SYNC_STALE_AFTER_MS = 10 * 60 * 1000;
const CLIENT_HEARTBEAT_STALE_AFTER_MS = 90_000;
const RESTART_LOCK_STALE_AFTER_MS = 2 * 60 * 1000;
const RESUME_LEASE_TTL_MS = 45_000;
const RESUME_LEASE_RENEW_WITHIN_MS = 10_000;
const RESUME_CLAIM_STALE_AFTER_MS = 2 * 60 * 1000;
const MAX_COMMAND_LEDGER_ENTRIES = 30;
const MAX_RECOVERY_JOURNAL_ENTRIES = 20;
const DURABLE_COMMIT_STAGES = new Set(['prepared', 'checkpoint-written', 'committed', 'published']);
const TERMINAL_COMMAND_STATUSES = new Set(['committed', 'succeeded', 'completed', 'applied']);
const ACTIVE_COMMAND_STATUSES = new Set(['pending', 'running', 'in-flight', 'locked']);
const ACTIVE_RESUME_CLAIM_STATUSES = new Set(['claimed', 'pending', 'running', 'in-flight', 'locked']);
const REJECTED_RESUME_CLAIM_STATUSES = new Set(['rejected', 'revoked', 'cancelled', 'expired']);
const LIFECYCLE_MUTABLE_CONTROLS = new Set([
  'enabled',
  'paused',
  'autoResumeEnabled',
  'scheduleEnabled',
  'scheduleRequiresApproval',
  'allowPastDueSchedule',
  'maxScheduleDelayMs',
  'manualApprovalRequired'
]);
const MAX_PROVIDER_SERVICES = 12;
const PROVIDER_CONTRACT_VERSIONS = new Set(['v1', 'v2']);
const DEFAULT_PROVIDER_PROOF_FORMAT = 'audit-proof.v1';
const DEFAULT_EXTERNAL_EXPORT_TARGET = 'external-provider';
const MAILCHIMP_EXPORT_TARGET = 'mailchimp';
const MAILCHIMP_HANDOFF_TARGETS = new Set(['audience', 'campaign', 'automation', 'journey']);
const MAILCHIMP_RESUME_MODES = new Set(['preview-only', 'sync-members', 'replay-campaign-events', 'resume-automation']);
const MAILCHIMP_REQUIRED_ACKS = ['mailchimp-target', 'consent-boundary', 'proof-export'];
const MAX_PROVIDER_SEQUENCE_DRIFT = 1;
const MAX_HANDOFF_COMMIT_AGE_MS = 5 * 60 * 1000;
const OPERATIONAL_SEVERITY_RANK = new Map([
  ['healthy', 0],
  ['degraded', 1],
  ['recoverable', 2],
  ['blocking', 3]
]);
const PROVIDER_CAPABILITY_ALIASES = new Map([
  ['validate', 'resume-token.validate'],
  ['resume-token', 'resume-token.validate'],
  ['checkpoint', 'checkpoint.read'],
  ['proof', 'audit.proof.write'],
  ['audit', 'audit.proof.write'],
  ['handoff', 'external-handoff.write'],
  ['mailchimp', 'mailchimp.handoff.write'],
  ['mailchimp-audience', 'mailchimp.audience.sync'],
  ['mailchimp-campaign', 'mailchimp.campaign.replay'],
  ['schedule', 'resume.schedule.write'],
  ['rotate', 'resume-token.rotate']
]);
const CLIENT_HANDOFF_MODES = new Set(['auto', 'local', 'external']);
const MAX_CLIENT_WORKFLOW_ACTIONS = 16;
const CLIENT_WORKFLOW_ACTION_ALIASES = new Map([
  ['ack', 'acknowledge-preview'],
  ['accept', 'acknowledge-preview'],
  ['accept-preview', 'acknowledge-preview'],
  ['flush', 'flush-state'],
  ['sync-state', 'flush-state'],
  ['handoff', 'open-external-handoff'],
  ['external-handoff', 'open-external-handoff'],
  ['resume', 'resume-checkpoint'],
  ['renew', 'renew-lease'],
  ['retry-resume', 'retry']
]);
const CLIENT_WORKFLOW_ACTION_TYPES = new Set([
  'acknowledge-preview',
  'flush-state',
  'open-external-handoff',
  'resume-checkpoint',
  'renew-lease',
  'retry',
  'cancel-schedule'
]);
const CLIENT_STATE_EXPORT_TARGETS = new Set(['browser', 'hosted-kernel', 'external-provider', 'audit-log']);
const MAX_WORKSPACE_LANES = 10;
const MAX_CHECKPOINT_PREFIXES_PER_LANE = 8;
const ROLE_PERMISSION_GRANTS = new Map([
  ['owner', ['resume-token.inspect', 'resume-token.resume', 'resume-token.rotate', 'resume.schedule.write', 'external-handoff.write', 'audit.proof.write', 'resume-token.cross-workspace']],
  ['admin', ['resume-token.inspect', 'resume-token.resume', 'resume-token.rotate', 'resume.schedule.write', 'external-handoff.write', 'audit.proof.write', 'resume-token.cross-workspace']],
  ['operator', ['resume-token.inspect', 'resume-token.resume', 'resume.schedule.write', 'external-handoff.write', 'audit.proof.write']],
  ['auditor', ['resume-token.inspect', 'audit.proof.write']],
  ['viewer', ['resume-token.inspect']]
]);
const PERMISSION_ALIASES = new Map([
  ['inspect', 'resume-token.inspect'],
  ['read', 'resume-token.inspect'],
  ['resume', 'resume-token.resume'],
  ['run', 'resume-token.resume'],
  ['rotate', 'resume-token.rotate'],
  ['schedule', 'resume.schedule.write'],
  ['handoff', 'external-handoff.write'],
  ['audit', 'audit.proof.write'],
  ['proof', 'audit.proof.write'],
  ['cross-workspace', 'resume-token.cross-workspace'],
  ['workspace-escalation', 'resume-token.cross-workspace']
]);

function toIsoString(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: String(entry.id || `resume-token-evidence-${index + 1}`),
      kind: String(entry.kind || 'runtime-signal'),
      ok: entry.ok !== false,
      detail: typeof entry.detail === 'string' ? entry.detail : undefined
    }));
}

function normalizeHistorySnapshots(input, fallbackNow) {
  const rawSnapshots = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : [];

  return rawSnapshots
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .slice(-MAX_HISTORY_SNAPSHOTS)
    .map((snapshot, index) => {
      const status = snapshot.status || snapshot.mode || (snapshot.ok === false ? 'blocked' : 'ready');
      const token = snapshot.resumeToken || snapshot.token || {};
      const timestamp = toIsoString(snapshot.generatedAt || snapshot.timestamp || snapshot.at, fallbackNow);
      const failureCodes = Array.isArray(snapshot.failureCodes)
        ? snapshot.failureCodes
        : Array.isArray(snapshot.errors)
          ? snapshot.errors.map((error) => error?.code || error).filter(Boolean)
          : [];

      return {
        id: String(snapshot.id || `resume-token-history-${index + 1}`),
        timestamp,
        status: String(status),
        ok: snapshot.ok !== false && !['blocked', 'failed', 'unhealthy'].includes(String(status)),
        tokenId: snapshot.tokenId || token.tokenId || null,
        checkpointId: snapshot.checkpointId || token.checkpointId || null,
        retryAttempts: Number.isFinite(Number(snapshot.retryAttempts))
          ? Math.max(0, Number(snapshot.retryAttempts))
          : 0,
        evidenceCount: Number.isFinite(Number(snapshot.evidenceCount))
          ? Math.max(0, Number(snapshot.evidenceCount))
          : 0,
        failureCodes: failureCodes.map(String)
      };
    });
}

function normalizeCapability(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROVIDER_CAPABILITY_ALIASES.get(normalized) || normalized;
}

function normalizeStringList(value) {
  const entries = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ''
      ? []
      : [value];

  return [...new Set(entries.map((entry) => String(entry).trim()).filter(Boolean))];
}

function normalizePermission(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PERMISSION_ALIASES.get(normalized) || normalized;
}

function normalizeClientWorkflowActionType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CLIENT_WORKFLOW_ACTION_ALIASES.get(normalized) || normalized;
}

function checkpointMatchesPrefix(checkpointId, prefix) {
  if (!prefix) {
    return false;
  }
  const normalizedCheckpoint = String(checkpointId || '');
  const normalizedPrefix = String(prefix);
  return normalizedCheckpoint === normalizedPrefix
    || normalizedCheckpoint.startsWith(normalizedPrefix)
    || normalizedCheckpoint.startsWith(`${normalizedPrefix}:`)
    || normalizedCheckpoint.startsWith(`${normalizedPrefix}/`);
}

function incrementCounter(counter, key, by = 1) {
  const normalizedKey = String(key || 'unknown');
  counter[normalizedKey] = (counter[normalizedKey] || 0) + by;
}

function normalizeProviderServices(provider, requiredCapabilities, nowMs) {
  const serviceInput = Array.isArray(provider.services)
    ? provider.services
    : Array.isArray(provider.serviceContracts)
      ? provider.serviceContracts
      : provider.serviceContract && typeof provider.serviceContract === 'object'
        ? [provider.serviceContract]
        : [];

  return serviceInput
    .filter((service) => service && typeof service === 'object')
    .slice(0, MAX_PROVIDER_SERVICES)
    .map((service, index) => {
      const capabilities = normalizeStringList(service.capabilities || service.scopes).map(normalizeCapability);
      const declaredRequiredCapabilities = normalizeStringList(service.requiredCapabilities).map(normalizeCapability);
      const serviceCapabilitySet = new Set(capabilities);
      const required = service.required === true
        || declaredRequiredCapabilities.length > 0;
      const serviceRequiredCapabilities = declaredRequiredCapabilities.length > 0
        ? declaredRequiredCapabilities
        : required
          ? [...requiredCapabilities]
          : [];
      const missingCapabilities = required
        ? serviceRequiredCapabilities.filter((capability) => (
            serviceCapabilitySet.has(capability)
            || serviceCapabilitySet.has(`${capability}:write`)
            || serviceCapabilitySet.has(`${capability}:read`)
          ) === false)
        : [];
      const syncInput = service.sync && typeof service.sync === 'object' ? service.sync : {};
      const lastSyncedAtMs = Date.parse(syncInput.lastSyncedAt || service.lastSyncedAt || '');
      const freshnessMs = Number.isNaN(lastSyncedAtMs) ? null : nowMs - lastSyncedAtMs;
      const syncState = syncInput.conflict === true
        ? 'conflict'
        : freshnessMs === null
          ? 'unknown'
          : freshnessMs > SYNC_STALE_AFTER_MS
            ? 'stale'
            : 'fresh';

      return {
        id: String(service.id || service.serviceId || `${provider.id || provider.providerId || 'provider'}-service-${index + 1}`),
        kind: String(service.kind || service.type || 'resume-token-service'),
        endpoint: service.endpoint || service.url || provider.endpoint || null,
        available: service.available !== false && service.ok !== false,
        required,
        capabilities,
        requiredCapabilities: serviceRequiredCapabilities,
        missingCapabilities,
        contractVersion: String(service.contractVersion || service.version || provider.contractVersion || 'v1'),
        handoffModes: normalizeStringList(service.handoffModes || service.modes).map((mode) => mode.toLowerCase()),
        proofFormats: normalizeStringList(service.proofFormats || service.auditProofFormats),
        exportTargets: normalizeStringList(service.exportTargets || service.stateExportTargets).map((target) => target.toLowerCase()),
        sync: {
          state: syncState,
          cursor: syncInput.cursor || service.cursor || null,
          sequence: Number.isFinite(Number(syncInput.sequence ?? service.sequence))
            ? Number(syncInput.sequence ?? service.sequence)
            : null,
          lastSyncedAt: Number.isNaN(lastSyncedAtMs) ? null : new Date(lastSyncedAtMs).toISOString(),
          freshnessMs
        }
      };
    });
}

function normalizeProviderNegotiation(provider, services, requiredCapabilities, handoffEnabled, integration) {
  const providerContractVersion = String(provider.contractVersion || provider.version || 'v1');
  const requestedContractVersion = String(
    provider.requiredContractVersion
    || integration.requiredContractVersion
    || integration.contractVersion
    || providerContractVersion
  );
  const supportedContractVersions = normalizeStringList(
    provider.supportedContractVersions
    || provider.contractVersions
    || providerContractVersion
  );
  const providerModes = normalizeStringList(provider.handoffModes || provider.modes).map((mode) => mode.toLowerCase());
  const serviceModes = services.flatMap((service) => normalizeStringList(service.handoffModes || service.modes))
    .map((mode) => mode.toLowerCase());
  const declaredCapabilities = normalizeStringList(provider.capabilities || provider.scopes).map(normalizeCapability);
  const serviceCapabilities = services.flatMap((service) => service.capabilities);
  const hasExternalHandoffCapability = [...declaredCapabilities, ...serviceCapabilities].includes('external-handoff.write');
  const supportedHandoffModes = [...new Set([
    ...(providerModes.length > 0 || serviceModes.length > 0
      ? []
      : ['hosted-kernel', ...(handoffEnabled && hasExternalHandoffCapability ? ['external-provider'] : [])]),
    ...providerModes,
    ...serviceModes
  ])];
  const requestedHandoffMode = handoffEnabled ? 'external-provider' : 'hosted-kernel';
  const proofFormats = normalizeStringList(
    provider.proofFormats
    || provider.auditProofFormats
    || services.flatMap((service) => normalizeStringList(service.proofFormats || service.auditProofFormats))
  );
  const requestedProofFormat = String(integration.proofFormat || integration.auditProofFormat || DEFAULT_PROVIDER_PROOF_FORMAT);
  const exportTargets = normalizeStringList(
    provider.exportTargets
    || provider.stateExportTargets
    || services.flatMap((service) => normalizeStringList(service.exportTargets || service.stateExportTargets))
  ).map((target) => target.toLowerCase());
  const requestedExportTarget = String(integration.exportTarget || DEFAULT_EXTERNAL_EXPORT_TARGET).toLowerCase();
  const syncInput = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
  const sequence = Number(syncInput.sequence ?? provider.sequence);
  const remoteSequence = Number(syncInput.remoteSequence ?? provider.remoteSequence);
  const acknowledgedSequence = Number(syncInput.acknowledgedSequence ?? provider.acknowledgedSequence);
  const sequenceDrift = Number.isFinite(sequence) && Number.isFinite(remoteSequence)
    ? Math.max(0, remoteSequence - sequence)
    : null;
  const writeAcknowledged = !Number.isFinite(acknowledgedSequence)
    || !Number.isFinite(sequence)
    || acknowledgedSequence >= sequence;
  const blockingReasons = [];

  if (!PROVIDER_CONTRACT_VERSIONS.has(requestedContractVersion)) {
    blockingReasons.push('provider_contract_version_unsupported_by_kernel');
  }
  if (supportedContractVersions.length > 0 && !supportedContractVersions.includes(requestedContractVersion)) {
    blockingReasons.push('provider_contract_version_not_offered');
  }
  if (handoffEnabled && supportedHandoffModes.length > 0 && !supportedHandoffModes.includes(requestedHandoffMode)) {
    blockingReasons.push('provider_contract_handoff_mode_not_supported');
  }
  if (proofFormats.length > 0 && !proofFormats.includes(requestedProofFormat)) {
    blockingReasons.push('provider_contract_proof_format_not_supported');
  }
  if (handoffEnabled && exportTargets.length > 0 && !exportTargets.includes(requestedExportTarget)) {
    blockingReasons.push('provider_contract_export_target_not_supported');
  }
  if (sequenceDrift !== null && sequenceDrift > MAX_PROVIDER_SEQUENCE_DRIFT) {
    blockingReasons.push('provider_contract_remote_sequence_ahead');
  }
  if (!writeAcknowledged) {
    blockingReasons.push('provider_contract_write_not_acknowledged');
  }

  return {
    schema: 'aios.audit-recovery.resume-token.provider-negotiation.v1',
    requestedContractVersion,
    providerContractVersion,
    supportedContractVersions,
    contractVersionAccepted: PROVIDER_CONTRACT_VERSIONS.has(requestedContractVersion)
      && (supportedContractVersions.length === 0 || supportedContractVersions.includes(requestedContractVersion)),
    requestedHandoffMode,
    supportedHandoffModes,
    handoffModeAccepted: !handoffEnabled
      || supportedHandoffModes.length === 0
      || supportedHandoffModes.includes(requestedHandoffMode),
    requestedProofFormat,
    proofFormats,
    proofFormatAccepted: proofFormats.length === 0 || proofFormats.includes(requestedProofFormat),
    requestedExportTarget,
    exportTargets,
    exportTargetAccepted: !handoffEnabled
      || exportTargets.length === 0
      || exportTargets.includes(requestedExportTarget),
    sequence,
    remoteSequence: Number.isFinite(remoteSequence) ? remoteSequence : null,
    acknowledgedSequence: Number.isFinite(acknowledgedSequence) ? acknowledgedSequence : null,
    sequenceDrift,
    writeAcknowledged,
    writeBarrierOpen: blockingReasons.every((reason) => ![
      'provider_contract_remote_sequence_ahead',
      'provider_contract_write_not_acknowledged'
    ].includes(reason)),
    requiredCapabilities: [...requiredCapabilities],
    accepted: blockingReasons.length === 0,
    blockingReasons,
    nextAction: blockingReasons.length > 0
      ? blockingReasons.includes('provider_contract_remote_sequence_ahead')
        ? 'pull_provider_sync_before_handoff'
        : blockingReasons.includes('provider_contract_write_not_acknowledged')
          ? 'await_provider_write_acknowledgement'
          : 'negotiate_provider_contract'
      : 'provider_contract_negotiated'
  };
}

function buildProviderCapabilityFit(requiredCapabilities, capabilitySet) {
  const required = [...requiredCapabilities];
  const granted = required.filter((capability) => capabilitySet.has(capability));
  const missing = required.filter((capability) => !capabilitySet.has(capability));
  const coverage = required.length === 0
    ? 1
    : Number((granted.length / required.length).toFixed(4));

  return {
    schema: 'aios.audit-recovery.resume-token.provider-capability-fit.v1',
    requiredCount: required.length,
    grantedCount: granted.length,
    missingCount: missing.length,
    coverage,
    granted,
    missing,
    state: missing.length === 0
      ? 'complete'
      : granted.length > 0
        ? 'partial'
        : 'missing',
    nextAction: missing.length === 0
      ? 'retain_provider_capability_grants'
      : 'negotiate_required_provider_capabilities'
  };
}

function normalizeProviderHandoffCommit(provider, services, validation, handoffInput, integration, nowMs) {
  const commitInput = provider.handoffCommit && typeof provider.handoffCommit === 'object'
    ? provider.handoffCommit
    : provider.externalHandoff && typeof provider.externalHandoff === 'object'
      ? provider.externalHandoff
      : provider.handoff && typeof provider.handoff === 'object'
        ? provider.handoff
        : {};
  const providerId = String(provider.id || provider.providerId || 'resume-token-provider');
  const providerSync = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
  const handoffEnabled = handoffInput.enabled === true || Boolean(handoffInput.targetProviderId);
  const required = handoffEnabled && commitInput.required !== false;
  const sequence = Number(commitInput.sequence ?? providerSync.sequence ?? provider.sequence);
  const remoteSequence = Number(commitInput.remoteSequence ?? providerSync.remoteSequence ?? provider.remoteSequence);
  const payloadVersion = Number(commitInput.payloadVersion ?? commitInput.version ?? sequence);
  const payloadRef = commitInput.payloadRef
    || commitInput.stateRef
    || commitInput.exportRef
    || handoffInput.payloadRef
    || handoffInput.stateRef
    || null;
  const checksum = commitInput.checksum
    || commitInput.stateChecksum
    || commitInput.payloadChecksum
    || handoffInput.checksum
    || null;
  const receiptRef = commitInput.receiptRef
    || commitInput.ackRef
    || commitInput.acknowledgementRef
    || handoffInput.receiptRef
    || null;
  const proofRef = commitInput.proofRef
    || commitInput.auditProofRef
    || commitInput.receiptProofRef
    || integration.proofRef
    || null;
  const committedAtMs = Date.parse(commitInput.committedAt || commitInput.updatedAt || commitInput.acknowledgedAt || '');
  const expiresAtMs = Date.parse(commitInput.expiresAt || validation.expiresAt || '');
  const ageMs = Number.isNaN(committedAtMs) ? null : Math.max(0, nowMs - committedAtMs);
  const acknowledged = commitInput.acknowledged === true
    || ['acknowledged', 'committed', 'synced'].includes(String(commitInput.state || commitInput.status || '').toLowerCase())
    || Boolean(receiptRef);
  const serviceCommitRefs = services
    .filter((service) => service.required)
    .map((service) => ({
      serviceId: service.id,
      cursor: service.sync.cursor,
      sequence: service.sync.sequence,
      syncState: service.sync.state,
      exportTargets: service.exportTargets,
      proofFormats: service.proofFormats
    }));
  const blockers = [];

  if (required && !payloadRef) {
    blockers.push('handoff_commit_payload_ref_missing');
  }
  if (required && !checksum) {
    blockers.push('handoff_commit_checksum_missing');
  }
  if (required && !acknowledged) {
    blockers.push('handoff_commit_not_acknowledged');
  }
  if (required && !proofRef) {
    blockers.push('handoff_commit_proof_ref_missing');
  }
  if (required && !Number.isFinite(payloadVersion)) {
    blockers.push('handoff_commit_payload_version_invalid');
  }
  if (required && ageMs !== null && ageMs > MAX_HANDOFF_COMMIT_AGE_MS) {
    blockers.push('handoff_commit_stale');
  }
  if (required && !Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs) {
    blockers.push('handoff_commit_expired');
  }

  return {
    schema: 'aios.audit-recovery.resume-token.provider-handoff-commit.v1',
    providerId,
    required,
    state: !required
      ? 'not-required'
      : blockers.length === 0
        ? 'committed'
        : acknowledged
          ? 'incomplete'
          : 'awaiting-acknowledgement',
    ready: !required || blockers.length === 0,
    blockers,
    payload: {
      ref: payloadRef,
      version: Number.isFinite(payloadVersion) ? payloadVersion : null,
      checksum,
      exportTarget: String(integration.exportTarget || DEFAULT_EXTERNAL_EXPORT_TARGET).toLowerCase(),
      proofFormat: String(integration.proofFormat || integration.auditProofFormat || DEFAULT_PROVIDER_PROOF_FORMAT)
    },
    receipt: {
      acknowledged,
      ref: receiptRef,
      proofRef,
      committedAt: Number.isNaN(committedAtMs) ? null : new Date(committedAtMs).toISOString(),
      ageMs,
      maxAgeMs: MAX_HANDOFF_COMMIT_AGE_MS
    },
    syncCommit: {
      cursor: commitInput.cursor || providerSync.cursor || provider.cursor || null,
      sequence: Number.isFinite(sequence) ? sequence : null,
      remoteSequence: Number.isFinite(remoteSequence) ? remoteSequence : null,
      expiresAt: Number.isNaN(expiresAtMs) ? null : new Date(expiresAtMs).toISOString(),
      serviceRefs: serviceCommitRefs
    },
    proofSubjects: [
      `handoff-commit:${providerId}`,
      `payload:${payloadRef || 'missing'}`,
      `checksum:${checksum || 'missing'}`,
      `receipt:${receiptRef || 'missing'}`
    ],
    nextAction: blockers.length === 0
      ? 'commit_external_handoff_payload'
      : blockers.includes('handoff_commit_not_acknowledged')
        ? 'await_external_handoff_acknowledgement'
        : 'repair_external_handoff_commit'
  };
}

function normalizeMailchimpResumeTargetType(value) {
  const targetType = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  return MAILCHIMP_HANDOFF_TARGETS.has(targetType) ? targetType : 'audience';
}

function normalizeMailchimpResumeMode(value, targetType) {
  const mode = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  if (MAILCHIMP_RESUME_MODES.has(mode)) return mode;
  if (targetType === 'campaign') return 'replay-campaign-events';
  if (targetType === 'automation' || targetType === 'journey') return 'resume-automation';
  return 'preview-only';
}

function normalizeMailchimpResumeContract(provider, handoffInput, integration, token, validation, nowMs) {
  const providerMailchimp = provider.mailchimp && typeof provider.mailchimp === 'object'
    ? provider.mailchimp
    : provider.mailchimpHandoff && typeof provider.mailchimpHandoff === 'object'
      ? provider.mailchimpHandoff
      : {};
  const handoffMailchimp = handoffInput.mailchimp && typeof handoffInput.mailchimp === 'object'
    ? handoffInput.mailchimp
    : {};
  const integrationMailchimp = integration.mailchimp && typeof integration.mailchimp === 'object'
    ? integration.mailchimp
    : {};
  const source = { ...integrationMailchimp, ...providerMailchimp, ...handoffMailchimp };
  const providerText = `${provider.id || ''} ${provider.providerId || ''} ${provider.type || ''} ${provider.kind || ''}`.toLowerCase();
  const requested = source.enabled === true
    || source.requested === true
    || handoffInput.exportTarget === MAILCHIMP_EXPORT_TARGET
    || integration.exportTarget === MAILCHIMP_EXPORT_TARGET
    || providerText.includes('mailchimp')
    || typeof source.audienceId === 'string'
    || typeof source.campaignId === 'string';
  const targetType = normalizeMailchimpResumeTargetType(source.targetType || source.target);
  const mode = normalizeMailchimpResumeMode(source.mode || source.resumeMode || source.exportMode, targetType);
  const audienceId = String(source.audienceId || source.listId || '').trim() || null;
  const campaignId = String(source.campaignId || source.campaign || '').trim() || null;
  const automationId = String(source.automationId || source.journeyId || '').trim() || null;
  const dataCenter = String(source.dataCenter || source.dc || '').trim().toLowerCase() || null;
  const requiredAcks = normalizeStringList(source.requiredAcknowledgements || source.requiredAcks);
  const acceptedAcks = normalizeStringList(source.acceptedAcknowledgements || source.acceptedAcks || source.acknowledgements);
  const finalRequiredAcks = requiredAcks.length > 0 ? requiredAcks : MAILCHIMP_REQUIRED_ACKS;
  const missingAcknowledgements = requested
    ? finalRequiredAcks.filter((ack) => !acceptedAcks.includes(ack))
    : [];
  const exportFields = normalizeStringList(source.exportFields || source.fields);
  const mergeFieldMap = source.mergeFieldMap && typeof source.mergeFieldMap === 'object'
    ? Object.keys(source.mergeFieldMap)
        .sort()
        .reduce((mapped, key) => {
          const value = source.mergeFieldMap[key];
          if (typeof value === 'string' && value.trim()) mapped[key] = value.trim();
          return mapped;
        }, {})
    : {};
  const blockers = [];
  const warnings = [];
  const expiresAtMs = Date.parse(validation.expiresAt || '');

  if (requested && targetType === 'audience' && !audienceId) blockers.push('mailchimp_audience_id_missing');
  if (requested && targetType === 'campaign' && !campaignId) blockers.push('mailchimp_campaign_id_missing');
  if (requested && (targetType === 'automation' || targetType === 'journey') && !automationId) {
    blockers.push('mailchimp_automation_id_missing');
  }
  if (requested && mode === 'sync-members' && !audienceId) blockers.push('mailchimp_member_sync_requires_audience');
  if (requested && mode === 'replay-campaign-events' && !campaignId) blockers.push('mailchimp_campaign_replay_requires_campaign');
  if (requested && mode !== 'preview-only' && missingAcknowledgements.length > 0) {
    blockers.push('mailchimp_acceptance_acknowledgement_missing');
  }
  if (requested && !Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs) blockers.push('mailchimp_resume_token_expired');
  if (requested && source.requiresMarketingConsent !== false && mode !== 'preview-only') {
    warnings.push('mailchimp_marketing_consent_required');
  }
  if (requested && source.suppressUnsubscribed === false) warnings.push('mailchimp_unsubscribed_suppression_disabled');

  return {
    schema: 'aios.audit-recovery.resume-token.mailchimp-resume-contract.v1',
    requested,
    ready: requested && blockers.length === 0,
    state: !requested
      ? 'not-requested'
      : blockers.length > 0
        ? 'blocked'
        : warnings.length > 0
          ? 'ready-with-warnings'
          : 'ready',
    target: {
      type: targetType,
      audienceId,
      campaignId,
      automationId,
      dataCenter
    },
    mode,
    export: {
      target: MAILCHIMP_EXPORT_TARGET,
      fields: exportFields,
      mergeFieldMap,
      checkpointId: token?.checkpointId || null,
      tokenId: token?.tokenId || null
    },
    consentBoundary: {
      requiresMarketingConsent: source.requiresMarketingConsent !== false,
      suppressUnsubscribed: source.suppressUnsubscribed !== false,
      doubleOptIn: source.doubleOptIn === true
    },
    acknowledgements: {
      required: finalRequiredAcks,
      accepted: acceptedAcks,
      missing: missingAcknowledgements
    },
    blockers,
    warnings,
    nextAction: !requested
      ? 'retain_kernel_resume_contract'
      : blockers.length > 0
        ? missingAcknowledgements.length > 0
          ? 'collect_mailchimp_preview_acceptance'
          : 'repair_mailchimp_resume_contract'
        : 'dispatch_mailchimp_resume_handoff',
    proofSubjects: [
      `mailchimp:${targetType}`,
      `audience:${audienceId || 'missing'}`,
      `campaign:${campaignId || 'missing'}`,
      `mode:${mode}`,
      `checkpoint:${token?.checkpointId || 'unknown'}`
    ]
  };
}

function buildHistorySnapshotDigest(historySnapshots, nowMs) {
  const ordered = [...historySnapshots].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const recentWindow = ordered.slice(-HISTORY_TREND_WINDOW_SIZE);
  const statusCounts = {};
  const checkpointCounts = {};
  const failureCodeCounts = {};
  let latestFailure = null;
  let latestSuccess = null;
  let currentStreakKind = null;
  let currentStreakCount = 0;

  for (const snapshot of ordered) {
    incrementCounter(statusCounts, snapshot.status);
    if (snapshot.checkpointId) {
      incrementCounter(checkpointCounts, snapshot.checkpointId);
    }
    for (const code of snapshot.failureCodes) {
      incrementCounter(failureCodeCounts, code);
    }

    if (snapshot.ok) {
      latestSuccess = snapshot;
    } else {
      latestFailure = snapshot;
    }
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const snapshot = ordered[index];
    const streakKind = snapshot.ok ? 'success' : 'failure';
    if (currentStreakKind === null) {
      currentStreakKind = streakKind;
    }
    if (streakKind !== currentStreakKind) {
      break;
    }
    currentStreakCount += 1;
  }

  const recentFailures = recentWindow.filter((snapshot) => snapshot.ok === false);
  const newest = ordered[ordered.length - 1] || null;
  const oldest = ordered[0] || null;
  const repeatedFailureCodes = Object.entries(failureCodeCounts)
    .filter(([, count]) => count > 1)
    .map(([code, count]) => ({ code, count }));
  const repeatedCheckpoints = Object.entries(checkpointCounts)
    .filter(([, count]) => count > 1)
    .map(([checkpointId, count]) => ({ checkpointId, count }));
  const latestFailureAtMs = latestFailure ? Date.parse(latestFailure.timestamp) : null;
  const latestSuccessAtMs = latestSuccess ? Date.parse(latestSuccess.timestamp) : null;
  const recoveredAfterFailure = latestFailureAtMs !== null
    && latestSuccessAtMs !== null
    && latestSuccessAtMs > latestFailureAtMs;

  return {
    schema: 'aios.audit-recovery.resume-token.history-digest.v1',
    windowSize: HISTORY_TREND_WINDOW_SIZE,
    totalSnapshots: ordered.length,
    newestSnapshotId: newest?.id || null,
    oldestSnapshotAt: oldest?.timestamp || null,
    newestSnapshotAt: newest?.timestamp || null,
    latestFailureAt: latestFailure?.timestamp || null,
    latestSuccessAt: latestSuccess?.timestamp || null,
    latestFailureCodes: latestFailure?.failureCodes || [],
    statusCounts,
    checkpointCounts,
    failureCodeCounts,
    repeatedFailureCodes,
    repeatedCheckpoints,
    currentStreak: {
      kind: currentStreakKind || 'none',
      count: currentStreakCount
    },
    recentWindow: {
      size: recentWindow.length,
      failureCount: recentFailures.length,
      successCount: recentWindow.length - recentFailures.length,
      failureRate: recentWindow.length === 0
        ? 0
        : Number((recentFailures.length / recentWindow.length).toFixed(4)),
      regression: recentWindow.length > 1
        && recentWindow[recentWindow.length - 1].ok === false
        && recentWindow[0].ok === true
    },
    recovery: {
      recoveredAfterFailure,
      sinceLastFailureMs: latestFailureAtMs === null ? null : Math.max(0, nowMs - latestFailureAtMs),
      successAfterLatestFailureMs: recoveredAfterFailure ? latestSuccessAtMs - latestFailureAtMs : null
    }
  };
}

function normalizeProviderContracts(request, lifecycle, validation, nowMs, token = null) {
  const integration = request.integration && typeof request.integration === 'object' ? request.integration : {};
  const contractInput = request.providerContracts || request.providers || integration.providers || [];
  const providerEntries = Array.isArray(contractInput) ? contractInput : [contractInput];
  const requestedCapabilities = Array.isArray(request.requiredCapabilities)
    ? request.requiredCapabilities
    : Array.isArray(integration.requiredCapabilities)
      ? integration.requiredCapabilities
      : [];
  const requiredCapabilities = new Set([
    'resume-token.validate',
    'checkpoint.read',
    'audit.proof.write',
    ...requestedCapabilities.map(normalizeCapability).filter(Boolean)
  ]);

  if (lifecycle.schedule.enabled) {
    requiredCapabilities.add('resume.schedule.write');
  }
  if (lifecycle.command === 'rotate-token' || validation.expired) {
    requiredCapabilities.add('resume-token.rotate');
  }

  const handoffInput = request.externalHandoff && typeof request.externalHandoff === 'object'
    ? request.externalHandoff
    : integration.externalHandoff && typeof integration.externalHandoff === 'object'
      ? integration.externalHandoff
      : {};
  if (handoffInput.enabled === true || handoffInput.targetProviderId) {
    requiredCapabilities.add('external-handoff.write');
  }
  const mailchimpRequested = handoffInput.exportTarget === MAILCHIMP_EXPORT_TARGET
    || integration.exportTarget === MAILCHIMP_EXPORT_TARGET
    || (handoffInput.mailchimp && typeof handoffInput.mailchimp === 'object')
    || (integration.mailchimp && typeof integration.mailchimp === 'object');
  if (mailchimpRequested) {
    requiredCapabilities.add('mailchimp.handoff.write');
    requiredCapabilities.add('external-handoff.write');
  }
  const handoffEnabled = handoffInput.enabled === true || Boolean(handoffInput.targetProviderId) || mailchimpRequested;

  const providers = providerEntries
    .filter((provider) => provider && typeof provider === 'object')
    .map((provider, index) => {
      const capabilities = Array.isArray(provider.capabilities)
        ? provider.capabilities.map(normalizeCapability).filter(Boolean)
        : [];
      const services = normalizeProviderServices(provider, requiredCapabilities, nowMs);
      const serviceCapabilities = services.flatMap((service) => service.capabilities);
      const capabilitySet = new Set([...capabilities, ...serviceCapabilities]);
      const capabilityFit = buildProviderCapabilityFit(requiredCapabilities, capabilitySet);
      const missingCapabilities = [...requiredCapabilities].filter((capability) => !capabilitySet.has(capability));
      const syncInput = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
      const lastSyncedAtMs = Date.parse(syncInput.lastSyncedAt || provider.lastSyncedAt || '');
      const syncFreshnessMs = Number.isNaN(lastSyncedAtMs) ? null : nowMs - lastSyncedAtMs;
      const serviceSyncConflict = services.some((service) => service.required && service.sync.state === 'conflict');
      const serviceSyncStale = services.some((service) => service.required && service.sync.state === 'stale');
      const serviceSyncUnknown = services.some((service) => service.required && service.sync.state === 'unknown');
      const negotiation = normalizeProviderNegotiation(provider, services, requiredCapabilities, handoffEnabled, integration);
      const handoffCommit = normalizeProviderHandoffCommit(provider, services, validation, handoffInput, integration, nowMs);
      const mailchimp = normalizeMailchimpResumeContract(provider, handoffInput, integration, token, validation, nowMs);
      if (mailchimp.requested) {
        for (const capability of ['mailchimp.handoff.write']) {
          if (!capabilitySet.has(capability) && !missingCapabilities.includes(capability)) {
            missingCapabilities.push(capability);
          }
        }
      }
      const serviceBlockingCount = services.filter((service) => (
        service.required && (
          service.available === false
          || service.missingCapabilities.length > 0
          || service.sync.state === 'conflict'
        )
      )).length;
      const syncState = syncInput.conflict === true || serviceSyncConflict
        ? 'conflict'
        : syncFreshnessMs === null || serviceSyncUnknown
          ? 'unknown'
          : syncFreshnessMs > SYNC_STALE_AFTER_MS || serviceSyncStale
            ? 'stale'
            : 'fresh';

      return {
        id: String(provider.id || provider.providerId || `resume-token-provider-${index + 1}`),
        type: String(provider.type || provider.kind || 'hosted-kernel-provider'),
        endpoint: provider.endpoint ? String(provider.endpoint) : null,
        tenantId: provider.tenantId || provider.tenant?.id || null,
        workspaceId: provider.workspaceId || provider.workspace?.id || null,
        available: provider.available !== false && provider.ok !== false,
        required: provider.required !== false,
        capabilities,
        serviceCapabilities,
        capabilityFit,
        missingCapabilities,
        negotiation,
        handoffCommit,
        mailchimp,
        serviceBlockingCount,
        services,
        contractVersion: String(provider.contractVersion || provider.version || 'v1'),
        sync: {
          state: syncState,
          cursor: syncInput.cursor || provider.cursor || null,
          sequence: Number.isFinite(Number(syncInput.sequence ?? provider.sequence))
            ? Number(syncInput.sequence ?? provider.sequence)
            : null,
          lastSyncedAt: Number.isNaN(lastSyncedAtMs) ? null : new Date(lastSyncedAtMs).toISOString(),
          freshnessMs: syncFreshnessMs
        }
      };
    });

  const selectedProviderId = handoffInput.targetProviderId
    || integration.selectedProviderId
    || request.selectedProviderId
    || providers.find((provider) => (
      provider.available
      && provider.missingCapabilities.length === 0
      && provider.negotiation.accepted
    ))?.id
    || null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || null;
  const blockingProviders = providers.filter((provider) => (
    provider.required && (
      provider.available === false
      || provider.missingCapabilities.length > 0
      || provider.negotiation.accepted === false
      || provider.handoffCommit.ready === false
      || (provider.mailchimp.requested && provider.mailchimp.ready === false)
      || provider.serviceBlockingCount > 0
      || provider.sync.state === 'conflict'
    )
  ));
  const handoffState = !handoffEnabled
    ? 'not-requested'
    : !selectedProvider
      ? 'awaiting-provider'
        : selectedProvider.available === false
          ? 'provider-unavailable'
          : selectedProvider.missingCapabilities.length > 0
            ? 'capability-mismatch'
            : selectedProvider.serviceBlockingCount > 0
              ? 'service-contract-blocked'
              : selectedProvider.handoffCommit.ready === false
              ? 'handoff-commit-blocked'
              : selectedProvider.mailchimp.requested && selectedProvider.mailchimp.ready === false
                ? 'mailchimp-contract-blocked'
              : selectedProvider.negotiation.accepted === false
                ? 'contract-negotiation-blocked'
              : selectedProvider.negotiation.writeBarrierOpen === false
                ? 'write-barrier-closed'
          : selectedProvider.sync.state === 'conflict'
            ? 'sync-conflict'
            : selectedProvider.sync.state === 'stale'
              ? 'sync-stale'
              : 'ready';
  const selectedServices = selectedProvider?.services || [];
  const handoffManifestId = `${surfaceId}:handoff:${selectedProviderId || 'kernel'}:${validation.expiresAt || 'unbounded'}`;
  const handoffManifest = {
    schema: 'aios.audit-recovery.resume-token.external-handoff-manifest.v1',
    id: handoffManifestId,
    state: handoffState,
    mode: handoffEnabled ? 'external-provider' : 'hosted-kernel',
    providerId: selectedProviderId,
    targetRef: handoffInput.targetRef || handoffInput.externalRef || null,
    correlationId: handoffInput.correlationId || handoffInput.externalCorrelationId || null,
    requiredCapabilities: [...requiredCapabilities],
    grantedCapabilities: selectedProvider ? [...new Set([
      ...selectedProvider.capabilities,
      ...selectedProvider.serviceCapabilities
    ])] : [],
    missingCapabilities: selectedProvider?.missingCapabilities || [...requiredCapabilities],
    negotiation: selectedProvider?.negotiation || null,
    handoffCommit: selectedProvider?.handoffCommit || null,
    mailchimp: selectedProvider?.mailchimp || null,
    syncCursor: selectedProvider?.sync.cursor || null,
    syncSequence: selectedProvider?.sync.sequence || null,
    syncState: selectedProvider?.sync.state || 'unselected',
    serviceRefs: selectedServices.map((service) => ({
      id: service.id,
      kind: service.kind,
      endpoint: service.endpoint,
      contractVersion: service.contractVersion,
      required: service.required,
      available: service.available,
      handoffModes: service.handoffModes,
      proofFormats: service.proofFormats,
      exportTargets: service.exportTargets,
      syncState: service.sync.state,
      cursor: service.sync.cursor,
      missingCapabilities: service.missingCapabilities
    })),
    proofSubjects: [
      `provider:${selectedProviderId || 'unselected'}`,
      `resume-token-expires:${validation.expiresAt || 'unknown'}`,
      ...(selectedProvider?.handoffCommit.proofSubjects || []),
      ...(selectedProvider?.mailchimp.proofSubjects || []),
      ...selectedServices.filter((service) => service.required).map((service) => `service:${service.id}`)
    ],
    transferable: handoffState === 'ready',
    nextAction: handoffState === 'ready'
      ? 'emit_external_handoff_manifest'
      : handoffState === 'not-requested'
        ? 'retain_resume_context_in_kernel'
        : 'repair_external_handoff_manifest'
  };

  return {
    schema: 'aios.audit-recovery.resume-token.provider-contract.v1',
    requiredCapabilities: [...requiredCapabilities],
    selectedProviderId,
    providers,
    blockingProviderCount: blockingProviders.length,
    sync: {
      staleAfterMs: SYNC_STALE_AFTER_MS,
      freshestProviderId: providers
        .filter((provider) => provider.sync.freshnessMs !== null)
        .sort((left, right) => left.sync.freshnessMs - right.sync.freshnessMs)[0]?.id || null,
      degraded: providers.some((provider) => provider.sync.state === 'stale' || provider.sync.state === 'unknown'),
      conflict: providers.some((provider) => provider.sync.state === 'conflict')
    },
    handoffCommit: {
      required: handoffEnabled,
      readyProviderIds: providers
        .filter((provider) => provider.handoffCommit.ready)
        .map((provider) => provider.id),
      blockedProviderIds: providers
        .filter((provider) => provider.handoffCommit.ready === false)
        .map((provider) => provider.id),
      blockerCodes: [...new Set(providers.flatMap((provider) => provider.handoffCommit.blockers))]
    },
    mailchimp: {
      requested: providers.some((provider) => provider.mailchimp.requested),
      readyProviderIds: providers
        .filter((provider) => provider.mailchimp.requested && provider.mailchimp.ready)
        .map((provider) => provider.id),
      blockedProviderIds: providers
        .filter((provider) => provider.mailchimp.requested && provider.mailchimp.ready === false)
        .map((provider) => provider.id),
      blockerCodes: [...new Set(providers.flatMap((provider) => provider.mailchimp.blockers))],
      warningCodes: [...new Set(providers.flatMap((provider) => provider.mailchimp.warnings))]
    },
    negotiation: {
      requestedContractVersions: [...new Set(providers.map((provider) => provider.negotiation.requestedContractVersion))],
      requestedHandoffMode: handoffEnabled ? 'external-provider' : 'hosted-kernel',
      requestedProofFormat: String(integration.proofFormat || integration.auditProofFormat || DEFAULT_PROVIDER_PROOF_FORMAT),
      requestedExportTarget: String(integration.exportTarget || DEFAULT_EXTERNAL_EXPORT_TARGET).toLowerCase(),
      acceptedProviderIds: providers.filter((provider) => provider.negotiation.accepted).map((provider) => provider.id),
      blockedProviderIds: providers.filter((provider) => !provider.negotiation.accepted).map((provider) => provider.id),
      writeBarrierBlockedProviderIds: providers
        .filter((provider) => provider.negotiation.writeBarrierOpen === false)
        .map((provider) => provider.id)
    },
    handoff: {
      enabled: handoffEnabled,
      state: handoffState,
      targetProviderId: selectedProviderId,
      externalCorrelationId: handoffInput.correlationId || handoffInput.externalCorrelationId || null,
      manifest: handoffManifest,
      nextAction: handoffState === 'ready'
        ? 'handoff_resume_context'
        : handoffState === 'not-requested'
          ? 'retain_resume_context_in_kernel'
          : 'repair_provider_contract'
    }
  };
}

function normalizeTenantBoundary(request, token, lifecycle, providerContract, now) {
  const boundaryInput = request.boundary && typeof request.boundary === 'object'
    ? request.boundary
    : request.scope && typeof request.scope === 'object'
      ? request.scope
      : {};
  const tenantInput = request.tenant && typeof request.tenant === 'object' ? request.tenant : {};
  const workspaceInput = request.workspace && typeof request.workspace === 'object' ? request.workspace : {};
  const authInput = request.auth && typeof request.auth === 'object' ? request.auth : {};
  const principalInput = request.principal && typeof request.principal === 'object'
    ? request.principal
    : authInput.principal && typeof authInput.principal === 'object'
      ? authInput.principal
      : {};
  const tokenTenantId = token?.tenantId || token?.tenant?.id || null;
  const tokenWorkspaceId = token?.workspaceId || token?.workspace?.id || null;
  const tokenCheckpointId = token?.checkpointId || null;
  const requestedTenantId = boundaryInput.tenantId || tenantInput.id || request.tenantId || tokenTenantId || null;
  const requestedWorkspaceId = boundaryInput.workspaceId || workspaceInput.id || request.workspaceId || tokenWorkspaceId || null;
  const allowedTenantIds = normalizeStringList(boundaryInput.allowedTenantIds || tenantInput.allowedTenantIds || authInput.allowedTenantIds);
  const allowedWorkspaceIds = normalizeStringList(boundaryInput.allowedWorkspaceIds || workspaceInput.allowedWorkspaceIds || authInput.allowedWorkspaceIds);
  const laneInput = Array.isArray(boundaryInput.workspaceLanes)
    ? boundaryInput.workspaceLanes
    : Array.isArray(boundaryInput.allowedWorkspaceLanes)
      ? boundaryInput.allowedWorkspaceLanes
      : Array.isArray(workspaceInput.lanes)
        ? workspaceInput.lanes
        : Array.isArray(authInput.workspaceLanes)
          ? authInput.workspaceLanes
          : [];
  const workspaceLanes = laneInput
    .filter((lane) => lane && typeof lane === 'object')
    .slice(0, MAX_WORKSPACE_LANES)
    .map((lane, index) => {
      const laneTenantId = lane.tenantId || lane.tenant?.id || requestedTenantId || null;
      const laneWorkspaceId = lane.workspaceId || lane.workspace?.id || lane.id || requestedWorkspaceId || null;
      const checkpointPrefixes = normalizeStringList(
        lane.checkpointPrefixes
        || lane.allowedCheckpointPrefixes
        || lane.checkpointPrefix
      ).slice(0, MAX_CHECKPOINT_PREFIXES_PER_LANE);
      const requiredLanePermissions = normalizeStringList(lane.requiredPermissions || lane.permissions)
        .map(normalizePermission);
      const checkpointAllowed = checkpointPrefixes.length === 0
        || checkpointPrefixes.some((prefix) => checkpointMatchesPrefix(tokenCheckpointId, prefix));

      return {
        id: String(lane.id || lane.laneId || `${laneWorkspaceId || 'workspace'}-lane-${index + 1}`),
        tenantId: laneTenantId ? String(laneTenantId) : null,
        workspaceId: laneWorkspaceId ? String(laneWorkspaceId) : null,
        checkpointPrefixes,
        requiredPermissions: requiredLanePermissions,
        required: lane.required === true || lane.enforced === true,
        allowExternalHandoff: lane.allowExternalHandoff !== false,
        auditSinkRef: lane.auditSinkRef || lane.auditRef || null,
        checkpointAllowed
      };
    });
  const roles = normalizeStringList(principalInput.roles || authInput.roles || request.roles).map((role) => role.toLowerCase());
  const explicitPermissions = normalizeStringList(principalInput.permissions || authInput.permissions || request.permissions).map(normalizePermission);
  const grantedPermissions = new Set(explicitPermissions);
  for (const role of roles) {
    for (const permission of ROLE_PERMISSION_GRANTS.get(role) || []) {
      grantedPermissions.add(permission);
    }
  }

  const requiredPermissions = new Set(['resume-token.inspect', 'audit.proof.write']);
  if (lifecycle.command === 'rotate-token') {
    requiredPermissions.add('resume-token.rotate');
  } else if (lifecycle.schedule.enabled) {
    requiredPermissions.add('resume.schedule.write');
  } else if (lifecycle.command !== 'inspect') {
    requiredPermissions.add('resume-token.resume');
  }
  if (providerContract.handoff.enabled) {
    requiredPermissions.add('external-handoff.write');
  }

  const matchingWorkspaceLanes = workspaceLanes.filter((lane) => (
    (!lane.tenantId || !requestedTenantId || lane.tenantId === String(requestedTenantId))
    && (!lane.workspaceId || !requestedWorkspaceId || lane.workspaceId === String(requestedWorkspaceId))
  ));
  const selectedWorkspaceLane = matchingWorkspaceLanes.find((lane) => lane.checkpointAllowed)
    || matchingWorkspaceLanes[0]
    || null;
  if (selectedWorkspaceLane) {
    for (const permission of selectedWorkspaceLane.requiredPermissions) {
      requiredPermissions.add(permission);
    }
  }

  const errors = [];
  const warnings = [];
  const enforcePermissions = boundaryInput.enforcePermissions === true
    || authInput.enforcePermissions === true
    || Boolean(principalInput.id || explicitPermissions.length > 0 || roles.length > 0);
  const requireBoundary = boundaryInput.required === true || request.requireTenantBoundary === true;
  const requireWorkspaceLane = boundaryInput.requireWorkspaceLane === true
    || workspaceInput.requireLane === true
    || workspaceLanes.some((lane) => lane.required);
  const crossWorkspaceRequested = Boolean(tokenWorkspaceId && requestedWorkspaceId && String(tokenWorkspaceId) !== String(requestedWorkspaceId));
  const crossWorkspaceAllowed = boundaryInput.allowCrossWorkspace === true
    && grantedPermissions.has('resume-token.cross-workspace');

  if (requireBoundary && !requestedTenantId) {
    errors.push('tenant_boundary_tenant_missing');
  } else if (!requestedTenantId) {
    warnings.push('tenant_boundary_tenant_unknown');
  }
  if (requireBoundary && !requestedWorkspaceId) {
    errors.push('tenant_boundary_workspace_missing');
  } else if (!requestedWorkspaceId) {
    warnings.push('tenant_boundary_workspace_unknown');
  }
  if (tokenTenantId && requestedTenantId && String(tokenTenantId) !== String(requestedTenantId)) {
    errors.push('tenant_boundary_token_tenant_mismatch');
  }
  if (crossWorkspaceRequested && !crossWorkspaceAllowed) {
    errors.push('tenant_boundary_token_workspace_mismatch');
  } else if (crossWorkspaceRequested) {
    warnings.push('tenant_boundary_cross_workspace_escalated');
  }
  if (allowedTenantIds.length > 0 && requestedTenantId && !allowedTenantIds.includes(String(requestedTenantId))) {
    errors.push('tenant_boundary_tenant_not_allowed');
  }
  if (allowedWorkspaceIds.length > 0 && requestedWorkspaceId && !allowedWorkspaceIds.includes(String(requestedWorkspaceId))) {
    errors.push('tenant_boundary_workspace_not_allowed');
  }

  const providerScopeViolations = providerContract.providers
    .filter((provider) => (
      (provider.tenantId && requestedTenantId && String(provider.tenantId) !== String(requestedTenantId))
      || (provider.workspaceId && requestedWorkspaceId && String(provider.workspaceId) !== String(requestedWorkspaceId))
    ))
    .map((provider) => provider.id);
  if (providerScopeViolations.length > 0) {
    errors.push('tenant_boundary_provider_scope_mismatch');
  }

  if (requireWorkspaceLane && !selectedWorkspaceLane) {
    errors.push('tenant_boundary_workspace_lane_missing');
  }
  if (selectedWorkspaceLane && selectedWorkspaceLane.checkpointAllowed === false) {
    errors.push('tenant_boundary_checkpoint_outside_workspace_lane');
  }
  if (
    selectedWorkspaceLane
    && providerContract.handoff.enabled
    && selectedWorkspaceLane.allowExternalHandoff === false
  ) {
    errors.push('tenant_boundary_workspace_lane_handoff_denied');
  }

  const missingPermissions = [...requiredPermissions].filter((permission) => !grantedPermissions.has(permission));
  if (enforcePermissions && missingPermissions.length > 0) {
    errors.push('tenant_boundary_permission_denied');
  } else if (!enforcePermissions) {
    warnings.push('tenant_boundary_permissions_not_enforced');
  }

  return {
    schema: 'aios.audit-recovery.resume-token.tenant-boundary.v1',
    tenantId: requestedTenantId ? String(requestedTenantId) : null,
    workspaceId: requestedWorkspaceId ? String(requestedWorkspaceId) : null,
    tokenTenantId: tokenTenantId ? String(tokenTenantId) : null,
    tokenWorkspaceId: tokenWorkspaceId ? String(tokenWorkspaceId) : null,
    isolation: {
      required: requireBoundary,
      allowedTenantIds,
      allowedWorkspaceIds,
      providerScopeViolations,
      workspaceLanes,
      selectedWorkspaceLaneId: selectedWorkspaceLane?.id || null,
      checkpointAllowedByLane: selectedWorkspaceLane?.checkpointAllowed ?? null,
      crossTenantAllowed: false,
      crossWorkspaceAllowed,
      crossWorkspaceRequested
    },
    principal: {
      id: principalInput.id || authInput.principalId || null,
      type: String(principalInput.type || authInput.principalType || 'operator'),
      roles,
      permissions: [...grantedPermissions],
      requiredPermissions: [...requiredPermissions],
      missingPermissions,
      enforced: enforcePermissions
    },
    auditHandoff: {
      generatedAt: now,
      boundaryRef: `${requestedTenantId || 'unknown-tenant'}:${requestedWorkspaceId || 'unknown-workspace'}`,
      subjectRef: principalInput.id || authInput.principalId || 'unknown-principal',
      workspaceLaneRef: selectedWorkspaceLane?.id || null,
      auditSinkRef: selectedWorkspaceLane?.auditSinkRef || boundaryInput.auditSinkRef || null,
      escalationRef: crossWorkspaceRequested
        ? `${tokenWorkspaceId || 'unknown-token-workspace'}->${requestedWorkspaceId || 'unknown-request-workspace'}`
        : null,
      proofSubjects: [
        `tenant:${requestedTenantId || 'unknown'}`,
        `workspace:${requestedWorkspaceId || 'unknown'}`,
        `checkpoint:${tokenCheckpointId || 'unknown'}`,
        `workspace-lane:${selectedWorkspaceLane?.id || 'unselected'}`
      ],
      canEmitProof: errors.length === 0 && grantedPermissions.has('audit.proof.write'),
      nextAction: errors.length > 0
        ? 'repair_tenant_permission_boundary'
        : 'attach_boundary_proof_to_resume_handoff'
    },
    errors,
    warnings
  };
}

function normalizeClientRuntimeState(request, token, nowMs) {
  const clientInput = request.client && typeof request.client === 'object'
    ? request.client
    : request.clientState && typeof request.clientState === 'object'
      ? request.clientState
      : {};
  const runtimeInput = request.runtime && typeof request.runtime === 'object'
    ? request.runtime
    : clientInput.runtime && typeof clientInput.runtime === 'object'
      ? clientInput.runtime
      : {};
  const workflowInput = request.workflow && typeof request.workflow === 'object'
    ? request.workflow
    : clientInput.workflow && typeof clientInput.workflow === 'object'
      ? clientInput.workflow
      : {};
  const pendingMutationsInput = Array.isArray(clientInput.pendingMutations)
    ? clientInput.pendingMutations
    : Array.isArray(runtimeInput.pendingMutations)
      ? runtimeInput.pendingMutations
      : [];
  const pendingMutations = pendingMutationsInput
    .filter((mutation) => mutation && typeof mutation === 'object')
    .slice(0, 20)
    .map((mutation, index) => ({
      id: String(mutation.id || mutation.mutationId || `client-mutation-${index + 1}`),
      kind: String(mutation.kind || mutation.type || 'runtime-state'),
      checkpointId: mutation.checkpointId ? String(mutation.checkpointId) : null,
      durable: mutation.durable === true || mutation.flushed === true || mutation.synced === true,
      requiresFlush: mutation.requiresFlush !== false && mutation.durable !== true && mutation.flushed !== true
    }));
  const actionInput = Array.isArray(workflowInput.actions)
    ? workflowInput.actions
    : Array.isArray(clientInput.actions)
      ? clientInput.actions
      : Array.isArray(runtimeInput.actions)
        ? runtimeInput.actions
        : Array.isArray(request.clientActions)
          ? request.clientActions
          : [];
  const workflowActions = actionInput
    .filter((action) => action && typeof action === 'object')
    .slice(0, MAX_CLIENT_WORKFLOW_ACTIONS)
    .map((action, index) => {
      const type = normalizeClientWorkflowActionType(action.type || action.kind || action.action);
      const required = action.required === true || action.blocking === true;
      const acknowledged = action.acknowledged === true
        || action.completed === true
        || action.done === true
        || action.state === 'done'
        || action.state === 'completed';

      return {
        id: String(action.id || action.actionId || `client-workflow-action-${index + 1}`),
        type,
        supported: CLIENT_WORKFLOW_ACTION_TYPES.has(type),
        label: String(action.label || type.replaceAll('-', ' ')),
        route: action.route || action.href || null,
        targetRef: action.targetRef || action.providerId || action.checkpointId || null,
        required,
        acknowledged,
        durable: action.durable === true || action.persisted === true,
        reasonCode: action.reasonCode || action.reason || null,
        nextAction: CLIENT_WORKFLOW_ACTION_TYPES.has(type)
          ? type.replaceAll('-', '_')
          : 'repair_client_workflow_action'
      };
    });
  const stateExportInput = workflowInput.stateExport && typeof workflowInput.stateExport === 'object'
    ? workflowInput.stateExport
    : clientInput.stateExport && typeof clientInput.stateExport === 'object'
      ? clientInput.stateExport
      : runtimeInput.stateExport && typeof runtimeInput.stateExport === 'object'
        ? runtimeInput.stateExport
        : request.stateExport && typeof request.stateExport === 'object'
          ? request.stateExport
          : {};
  const exportTargets = normalizeStringList(stateExportInput.targets || stateExportInput.target)
    .map((target) => target.toLowerCase());
  const supportedExportTargets = exportTargets.filter((target) => CLIENT_STATE_EXPORT_TARGETS.has(target));
  const unsupportedExportTargets = exportTargets.filter((target) => !CLIENT_STATE_EXPORT_TARGETS.has(target));
  const exportVersion = Number(stateExportInput.version ?? stateExportInput.sequence ?? 0);
  const exportRequired = stateExportInput.required === true || workflowInput.exportRequired === true;
  const heartbeatAtMs = Date.parse(runtimeInput.lastHeartbeatAt || clientInput.lastHeartbeatAt || request.clientHeartbeatAt || '');
  const heartbeatFreshnessMs = Number.isNaN(heartbeatAtMs) ? null : nowMs - heartbeatAtMs;
  const requestedMode = String(workflowInput.handoffMode || request.handoffMode || 'auto');
  const handoffMode = CLIENT_HANDOFF_MODES.has(requestedMode) ? requestedMode : 'auto';
  const focusCheckpointId = String(workflowInput.checkpointId || clientInput.checkpointId || token?.checkpointId || '');
  const unflushedMutations = pendingMutations.filter((mutation) => (
    mutation.requiresFlush
    && (!mutation.checkpointId || !focusCheckpointId || mutation.checkpointId === focusCheckpointId)
  ));
  const previewAcknowledged = clientInput.previewAcknowledged === true
    || workflowInput.previewAcknowledged === true
    || request.previewAcknowledged === true;
  const unsupportedActions = workflowActions.filter((action) => !action.supported);
  const unresolvedRequiredActions = workflowActions.filter((action) => action.required && !action.acknowledged);
  const actionTicketId = String(
    workflowInput.ticketId
    || clientInput.ticketId
    || `${surfaceId}:client:${clientInput.sessionId || runtimeInput.sessionId || 'anonymous'}:${focusCheckpointId || token?.checkpointId || 'unknown-checkpoint'}`
  );
  const errors = [];
  const warnings = [];

  if (runtimeInput.online === false || clientInput.online === false) {
    errors.push('client_runtime_offline');
  }
  if (heartbeatFreshnessMs === null) {
    warnings.push('client_runtime_heartbeat_unknown');
  } else if (heartbeatFreshnessMs > CLIENT_HEARTBEAT_STALE_AFTER_MS) {
    errors.push('client_runtime_heartbeat_stale');
  }
  if (unflushedMutations.length > 0) {
    errors.push('client_runtime_pending_mutations');
  }
  if (unsupportedActions.length > 0) {
    errors.push('client_runtime_workflow_action_unsupported');
  }
  if (unresolvedRequiredActions.length > 0) {
    errors.push('client_runtime_required_action_unresolved');
  }
  if (!CLIENT_HANDOFF_MODES.has(requestedMode)) {
    warnings.push('client_runtime_handoff_mode_unsupported');
  }
  if (exportRequired && supportedExportTargets.length === 0) {
    errors.push('client_runtime_state_export_target_missing');
  }
  if (unsupportedExportTargets.length > 0) {
    warnings.push('client_runtime_state_export_target_unsupported');
  }
  if (!Number.isFinite(exportVersion) || exportVersion < 0) {
    errors.push('client_runtime_state_export_version_invalid');
  }

  return {
    schema: 'aios.audit-recovery.resume-token.client-runtime.v1',
    sessionId: clientInput.sessionId || runtimeInput.sessionId || null,
    requestId: request.requestId || clientInput.requestId || null,
    route: String(workflowInput.route || clientInput.route || '/audit-recovery/resume-token'),
    intent: String(workflowInput.intent || request.intent || 'resume-checkpoint'),
    handoffMode,
    focusCheckpointId: focusCheckpointId || null,
    online: runtimeInput.online !== false && clientInput.online !== false,
    focused: runtimeInput.focused !== false && clientInput.focused !== false,
    previewAcknowledged,
    heartbeat: {
      lastSeenAt: Number.isNaN(heartbeatAtMs) ? null : new Date(heartbeatAtMs).toISOString(),
      freshnessMs: heartbeatFreshnessMs,
      staleAfterMs: CLIENT_HEARTBEAT_STALE_AFTER_MS
    },
    pendingMutations,
    unflushedMutationCount: unflushedMutations.length,
    workflowActions,
    unresolvedRequiredActionCount: unresolvedRequiredActions.length,
    stateExport: {
      required: exportRequired,
      ready: errors.length === 0 && (!exportRequired || supportedExportTargets.length > 0),
      version: Number.isFinite(exportVersion) ? exportVersion : null,
      cursor: stateExportInput.cursor || runtimeInput.cursor || clientInput.cursor || null,
      targets: supportedExportTargets,
      unsupportedTargets: unsupportedExportTargets,
      refs: supportedExportTargets.map((target) => ({
        target,
        ref: stateExportInput.refs?.[target] || stateExportInput.ref || null,
        checkpointId: focusCheckpointId || token?.checkpointId || null,
        durable: target !== 'browser' || stateExportInput.browserDurable === true
      }))
    },
    handoffTicket: {
      schema: 'aios.audit-recovery.resume-token.client-handoff-ticket.v1',
      id: actionTicketId,
      checkpointId: focusCheckpointId || token?.checkpointId || null,
      route: String(workflowInput.route || clientInput.route || '/audit-recovery/resume-token'),
      requiredActionIds: unresolvedRequiredActions.map((action) => action.id),
      requiredActionsResolved: unresolvedRequiredActions.length === 0,
      exportTargets: supportedExportTargets,
      nextAction: unresolvedRequiredActions.length > 0
        ? unresolvedRequiredActions[0].nextAction
        : exportRequired && supportedExportTargets.length === 0
          ? 'select_client_state_export_target'
          : 'present_resume_handoff_step'
    },
    canReleaseControl: errors.length === 0,
    nextAction: errors.length > 0
      ? unflushedMutations.length > 0
        ? 'flush_client_checkpoint_state'
        : unresolvedRequiredActions.length > 0
          ? unresolvedRequiredActions[0].nextAction
          : unsupportedActions.length > 0
            ? 'repair_client_workflow_action'
        : 'restore_client_runtime_session'
      : 'client_runtime_ready_for_handoff',
    errors,
    warnings
  };
}

function buildWorkflowHandoff(request, lifecycle, providerContract, previewAcceptance, clientRuntime, validation, tenantBoundary) {
  const workflowInput = request.workflow && typeof request.workflow === 'object' ? request.workflow : {};
  const externalPreferred = clientRuntime.handoffMode === 'external'
    || (clientRuntime.handoffMode === 'auto' && providerContract.handoff.enabled);
  const destination = externalPreferred
    ? {
        kind: 'external-provider',
        providerId: providerContract.handoff.targetProviderId,
        correlationId: providerContract.handoff.externalCorrelationId
      }
    : {
        kind: 'hosted-kernel',
        providerId: null,
        correlationId: workflowInput.correlationId || request.correlationId || null
      };
  const blockers = [
    ...clientRuntime.errors,
    ...(previewAcceptance.acceptance.blocking ? ['preview_acceptance_required'] : []),
    ...tenantBoundary.errors,
    ...(validation.valid ? [] : validation.errors),
    ...(lifecycle.canResumeNow ? [] : lifecycle.errors),
    ...(externalPreferred && !['ready', 'not-requested', 'sync-stale'].includes(providerContract.handoff.state)
      ? [`external_handoff_${providerContract.handoff.state.replaceAll('-', '_')}`]
      : [])
  ];
  const state = blockers.length > 0
    ? 'blocked'
    : lifecycle.schedule.enabled && !lifecycle.schedule.due
      ? 'scheduled'
      : externalPreferred
        ? 'ready-for-external-handoff'
        : 'ready-for-kernel-resume';
  const nextAction = blockers.length > 0
    ? clientRuntime.errors.length > 0
      ? clientRuntime.nextAction
      : previewAcceptance.acceptance.blocking
        ? previewAcceptance.acceptance.nextAction
        : tenantBoundary.errors.length > 0
          ? tenantBoundary.auditHandoff.nextAction
        : externalPreferred
          ? providerContract.handoff.nextAction
          : lifecycle.nextAction
    : state === 'scheduled'
      ? 'wait_until_scheduled_resume'
      : externalPreferred
        ? 'handoff_resume_context'
        : 'resume_from_checkpoint';

  return {
    schema: 'aios.audit-recovery.resume-token.workflow-handoff.v1',
    state,
    destination,
    clientRoute: clientRuntime.route,
    checkpointId: clientRuntime.focusCheckpointId,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    clientHandoffTicket: clientRuntime.handoffTicket,
    stateExport: {
      ready: clientRuntime.stateExport.ready,
      required: clientRuntime.stateExport.required,
      targets: clientRuntime.stateExport.targets,
      refCount: clientRuntime.stateExport.refs.length
    },
    requiredClientActions: clientRuntime.workflowActions
      .filter((action) => action.required)
      .map((action) => ({
        id: action.id,
        type: action.type,
        acknowledged: action.acknowledged,
        nextAction: action.nextAction
      })),
    blockers,
    requiresClientAck: previewAcceptance.acceptance.required && !clientRuntime.previewAcknowledged,
    nextAction,
    visibleStep: {
      id: state === 'blocked' ? 'repair-runtime-state' : state,
      label: state === 'blocked'
        ? 'Resolve resume blockers'
        : externalPreferred
          ? 'Hand off resume context'
          : 'Resume hosted kernel',
      route: clientRuntime.route,
      primaryAction: nextAction,
      ticketId: clientRuntime.handoffTicket.id
    }
  };
}

function normalizeMailchimpRuntimeHandoffGate(request, providerContract, previewAcceptance, clientRuntime, workflowHandoff, tenantBoundary, now) {
  const inputGate = request.mailchimpRuntimeHandoffGate && typeof request.mailchimpRuntimeHandoffGate === 'object'
    ? request.mailchimpRuntimeHandoffGate
    : request.recoveryCheckpointMailchimpGate && typeof request.recoveryCheckpointMailchimpGate === 'object'
      ? request.recoveryCheckpointMailchimpGate
      : request.mailchimpGate && typeof request.mailchimpGate === 'object'
        ? request.mailchimpGate
        : {};
  const manifest = providerContract.handoff.manifest.mailchimp || null;
  const requested = inputGate.requested === true
    || manifest?.requested === true
    || Boolean(manifest?.target);
  const target = inputGate.target && typeof inputGate.target === 'object'
    ? inputGate.target
    : manifest?.target || null;
  const exportInput = inputGate.export && typeof inputGate.export === 'object' ? inputGate.export : {};
  const acceptedAcks = normalizeStringList(
    inputGate.clientRuntime?.acceptedAcknowledgements
    || inputGate.acceptance?.acknowledgements
    || clientRuntime.workflowActions
      .filter((action) => action.acknowledged)
      .map((action) => action.id)
  );
  const requiredAcks = normalizeStringList(
    inputGate.clientRuntime?.requiredAcknowledgements
    || inputGate.acceptance?.requiredAcknowledgements
    || manifest?.acknowledgements.required
  );
  const manifestMissingAcks = manifest?.acknowledgements.missing || [];
  const missingAcknowledgements = [
    ...manifestMissingAcks,
    ...requiredAcks.filter((ack) => !acceptedAcks.includes(ack))
  ];
  const checkpointIds = normalizeStringList(
    inputGate.checkpointIds
    || inputGate.dispatchPayload?.checkpointIds
    || inputGate.checkpointId
    || clientRuntime.focusCheckpointId
  );
  const providerId = String(inputGate.providerId || manifest?.providerId || providerContract.selectedProviderId || '');
  const projectionId = String(inputGate.projectionId || inputGate.dispatchPayload?.projectionId || manifest?.projectionId || '');
  const digest = String(inputGate.proof?.digest || inputGate.proofDigest || '');
  const upstreamBlockers = normalizeStringList(inputGate.blockers);
  const upstreamWarnings = normalizeStringList(inputGate.warnings);
  const localBlockers = [
    requested && !providerId ? 'mailchimp_runtime_provider_missing' : '',
    requested && providerContract.handoff.state !== 'ready' ? `mailchimp_runtime_handoff_${providerContract.handoff.state.replaceAll('-', '_')}` : '',
    requested && previewAcceptance.acceptance.blocking ? 'mailchimp_runtime_preview_acceptance_blocked' : '',
    requested && clientRuntime.canReleaseControl === false ? 'mailchimp_runtime_client_state_blocked' : '',
    requested && tenantBoundary.errors.length > 0 ? 'mailchimp_runtime_tenant_boundary_blocked' : '',
    requested && missingAcknowledgements.length > 0 ? 'mailchimp_runtime_acknowledgement_missing' : '',
    requested && checkpointIds.length === 0 ? 'mailchimp_runtime_checkpoint_missing' : ''
  ].filter(Boolean);
  const blockers = [...new Set([...upstreamBlockers, ...localBlockers])];
  const warnings = [...new Set([
    ...upstreamWarnings,
    ...(manifest?.warnings || []),
    manifest?.consentBoundary?.requiresMarketingConsent && manifest.mode !== 'preview-only'
      ? 'mailchimp_runtime_marketing_consent_required'
      : '',
    providerContract.sync.degraded ? 'mailchimp_runtime_provider_sync_degraded' : ''
  ].filter(Boolean))];
  const ready = requested && blockers.length === 0;
  const state = !requested
    ? 'not-requested'
    : blockers.length > 0
      ? 'blocked'
      : warnings.length > 0
        ? 'ready-with-warnings'
        : 'ready';
  const gateDigest = digest || `${surfaceId}:mailchimp-runtime:${providerId || 'unselected'}:${checkpointIds.join('|') || 'none'}:${state}`;

  return {
    schema: 'aios.audit-recovery.resume-token.mailchimp-runtime-handoff-gate.v1',
    generatedAt: now,
    requested,
    ready,
    state,
    providerId: providerId || null,
    projectionId: projectionId || null,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    checkpointIds,
    target,
    mode: String(inputGate.mode || exportInput.mode || manifest?.mode || 'preview-only'),
    acceptance: {
      accepted: inputGate.acceptance?.accepted === true || previewAcceptance.acceptance.accepted,
      state: previewAcceptance.acceptance.state,
      digest: inputGate.acceptance?.digest || inputGate.acceptanceDigest || null,
      missingAcknowledgements,
      acceptedBy: inputGate.acceptance?.acceptedBy || previewAcceptance.acceptance.acceptedBy || null,
      acceptedAt: inputGate.acceptance?.acceptedAt || previewAcceptance.acceptance.acceptedAt || null
    },
    clientRuntime: {
      sessionId: clientRuntime.sessionId,
      route: clientRuntime.route,
      canReleaseControl: clientRuntime.canReleaseControl,
      stateExportReady: clientRuntime.stateExport.ready,
      handoffTicketId: clientRuntime.handoffTicket.id,
      missingAcknowledgements
    },
    dispatch: ready
      ? {
          providerId: providerId || providerContract.selectedProviderId,
          checkpointIds,
          ticketId: clientRuntime.handoffTicket.id,
          destination: workflowHandoff.destination,
          exportTarget: 'mailchimp',
          stateExportRefs: clientRuntime.stateExport.refs,
          proofDigest: gateDigest
        }
      : null,
    blockers,
    warnings,
    nextAction: !requested
      ? 'retain_kernel_resume_contract'
      : blockers.includes('mailchimp_runtime_acknowledgement_missing')
        ? 'collect_mailchimp_preview_acceptance'
        : blockers.includes('mailchimp_runtime_client_state_blocked')
          ? clientRuntime.nextAction
          : blockers.includes('mailchimp_runtime_preview_acceptance_blocked')
            ? previewAcceptance.acceptance.nextAction
            : blockers.length > 0
              ? 'repair_mailchimp_runtime_handoff_gate'
              : 'dispatch_mailchimp_resume_handoff',
    proof: {
      algorithm: 'sha256',
      digest: gateDigest,
      covers: ['provider', 'checkpointIds', 'acceptance', 'clientRuntime', 'tenantBoundary', 'blockers']
    }
  };
}

function validateResumeToken(token, nowMs) {
  const errors = [];
  const warnings = [];

  if (!token || typeof token !== 'object') {
    return {
      valid: false,
      expired: false,
      expiresAt: null,
      errors: ['resume_token_missing'],
      warnings
    };
  }

  for (const field of REQUIRED_TOKEN_FIELDS) {
    if (token[field] === undefined || token[field] === null || token[field] === '') {
      errors.push(`resume_token_${field}_missing`);
    }
  }

  const issuedAtMs = Date.parse(token.issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    errors.push('resume_token_issuedAt_invalid');
  }

  const expiresAtMs = Number.isNaN(issuedAtMs) ? null : issuedAtMs + TOKEN_TTL_MS;
  const expired = expiresAtMs !== null && expiresAtMs <= nowMs;
  if (expired) {
    errors.push('resume_token_expired');
  } else if (expiresAtMs !== null && expiresAtMs - nowMs < 60_000) {
    warnings.push('resume_token_expires_within_60s');
  }

  if (token.scope && !['hosted-kernel', 'audit-recovery', 'resume-token'].includes(token.scope)) {
    errors.push('resume_token_scope_unsupported');
  }

  return {
    valid: errors.length === 0,
    expired,
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    errors,
    warnings
  };
}

function normalizeResumeGuard(request, token, validation, persistedState, tenantBoundary, providerContract, nowMs) {
  const guardInput = request.resumeGuard && typeof request.resumeGuard === 'object'
    ? request.resumeGuard
    : request.resumeClaim && typeof request.resumeClaim === 'object'
      ? request.resumeClaim
      : {};
  const requested = guardInput.required === true
    || guardInput.enabled === true
    || request.requireResumeGuard === true
    || providerContract.handoff.enabled
    || lifecycleCommandRequiresResumeGuard(request.command || request.action);
  const tokenId = String(guardInput.tokenId || token?.tokenId || '');
  const checkpointId = String(guardInput.checkpointId || token?.checkpointId || persistedState.snapshot.checkpointId || '');
  const guardTenantId = guardInput.tenantId || token?.tenantId || tenantBoundary.tenantId;
  const guardWorkspaceId = guardInput.workspaceId || token?.workspaceId || tenantBoundary.workspaceId;
  const issuedAt = toIsoString(guardInput.issuedAt || token?.issuedAt || nowMs, nowMs);
  const expiresAt = guardInput.expiresAt
    ? toIsoString(guardInput.expiresAt, nowMs)
    : validation.expiresAt;
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const expectedCheckpointIds = normalizeStringList([
    token?.checkpointId,
    persistedState.snapshot.checkpointId,
    persistedState.restart.checkpointId,
    ...(Array.isArray(guardInput.allowedCheckpointIds) ? guardInput.allowedCheckpointIds : [])
  ]).filter(Boolean);
  const providerHandoffReady = !providerContract.handoff.enabled
    || providerContract.handoff.state === 'ready'
    || providerContract.handoff.manifest.transferable === true;
  const resumeClaim = normalizeResumeClaim(guardInput, request, token, persistedState, tenantBoundary, nowMs);
  const blockers = [];
  const warnings = [];

  if (requested && !tokenId) blockers.push('resume_guard_token_id_missing');
  if (requested && !checkpointId) blockers.push('resume_guard_checkpoint_missing');
  if (validation.valid !== true) blockers.push('resume_guard_token_invalid');
  if (expectedCheckpointIds.length > 0 && checkpointId && !expectedCheckpointIds.includes(checkpointId)) {
    blockers.push('resume_guard_checkpoint_mismatch');
  }
  if (guardTenantId && tenantBoundary.tenantId && String(guardTenantId) !== String(tenantBoundary.tenantId)) {
    blockers.push('resume_guard_tenant_mismatch');
  }
  if (guardWorkspaceId && tenantBoundary.workspaceId && String(guardWorkspaceId) !== String(tenantBoundary.workspaceId)) {
    blockers.push('resume_guard_workspace_mismatch');
  }
  if (Number.isFinite(issuedAtMs) && issuedAtMs > nowMs) blockers.push('resume_guard_issued_at_in_future');
  if (expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) blockers.push('resume_guard_expired');
  if (providerContract.handoff.enabled && !providerHandoffReady) blockers.push('resume_guard_handoff_not_transferable');
  if (persistedState.restart.safeToReplay !== true) blockers.push('resume_guard_persisted_state_not_replay_safe');
  if (persistedState.writeBarrier.open !== true) blockers.push('resume_guard_write_barrier_closed');
  if (tenantBoundary.errors.length > 0) blockers.push('resume_guard_boundary_blocked');
  for (const blocker of resumeClaim.blockers) blockers.push(blocker);
  if (tenantBoundary.warnings.length > 0) warnings.push('resume_guard_boundary_warning');
  if (providerContract.sync.degraded) warnings.push('resume_guard_provider_sync_degraded');
  for (const warning of resumeClaim.warnings) warnings.push(warning);
  if (expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs - nowMs < 60_000 && expiresAtMs > nowMs) {
    warnings.push('resume_guard_expires_within_60s');
  }

  const proofSubjects = [
    `token:${tokenId || 'missing'}`,
    `checkpoint:${checkpointId || 'missing'}`,
    `tenant:${guardTenantId || 'unknown'}`,
    `workspace:${guardWorkspaceId || 'unknown'}`,
    `handoff:${providerContract.handoff.state}`,
    `restart:${persistedState.restart.status}`
  ];

  return {
    schema: 'aios.audit-recovery.resume-token.resume-guard.v1',
    requested,
    state: !requested
      ? 'not-required'
      : blockers.length > 0
        ? 'blocked'
        : warnings.length > 0
          ? 'ready-with-warnings'
          : 'ready',
    ready: !requested || blockers.length === 0,
    tokenId: tokenId || null,
    checkpointId: checkpointId || null,
    tenantId: guardTenantId ? String(guardTenantId) : null,
    workspaceId: guardWorkspaceId ? String(guardWorkspaceId) : null,
    issuedAt,
    expiresAt,
    expectedCheckpointIds,
    providerHandoffReady,
    replaySafe: persistedState.restart.safeToReplay === true,
    writeBarrierOpen: persistedState.writeBarrier.open === true,
    claim: resumeClaim,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    proofSubjects: [...proofSubjects, ...resumeClaim.proofSubjects],
    proofDigest: String(guardInput.proofDigest || `${tokenId}:${checkpointId}:${expiresAt || 'unbounded'}`),
    nextAction: blockers.length > 0
      ? blockers.includes('resume_guard_token_invalid') || blockers.includes('resume_guard_expired')
        ? 'issue_fresh_resume_token'
        : blockers.includes('resume_guard_handoff_not_transferable')
          ? 'repair_external_handoff_manifest'
          : blockers.some((blocker) => blocker.startsWith('resume_claim_'))
            ? resumeClaim.nextAction
          : 'repair_resume_guard'
      : 'resume_guard_ready'
  };
}

function lifecycleCommandRequiresResumeGuard(command) {
  const normalized = String(command || '').trim().toLowerCase();
  return ['resume', 'resume-checkpoint', 'recover', 'handoff', 'open-external-handoff'].includes(normalized);
}

function normalizeResumeClaim(guardInput, request, token, persistedState, tenantBoundary, nowMs) {
  const claimInput = guardInput.claim && typeof guardInput.claim === 'object'
    ? guardInput.claim
    : request.claim && typeof request.claim === 'object'
      ? request.claim
      : {};
  const ownerId = String(
    claimInput.ownerId
    || claimInput.holderId
    || request.operatorId
    || tenantBoundary.principal.id
    || 'hosted-kernel'
  );
  const tokenId = String(claimInput.tokenId || guardInput.tokenId || token?.tokenId || '');
  const checkpointId = String(claimInput.checkpointId || guardInput.checkpointId || token?.checkpointId || persistedState.snapshot.checkpointId || '');
  const commandId = String(claimInput.commandId || claimInput.idempotencyKey || persistedState.commandId || '');
  const claimId = String(claimInput.id || claimInput.claimId || `${commandId || 'unknown-command'}:${tokenId || 'missing-token'}:${checkpointId || 'missing-checkpoint'}`);
  const claimedAt = toIsoString(claimInput.claimedAt || claimInput.acquiredAt || claimInput.issuedAt || nowMs, nowMs);
  const claimedAtMs = Date.parse(claimedAt);
  const ageMs = Number.isNaN(claimedAtMs) ? null : Math.max(0, nowMs - claimedAtMs);
  const status = String(claimInput.status || claimInput.state || (Object.keys(claimInput).length > 0 ? 'claimed' : 'implicit')).toLowerCase();
  const claimLedgerInput = Array.isArray(guardInput.claimLedger)
    ? guardInput.claimLedger
    : Array.isArray(request.resumeClaims)
      ? request.resumeClaims
      : Array.isArray(request.claims)
        ? request.claims
        : [];
  const claimLedger = claimLedgerInput
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_COMMAND_LEDGER_ENTRIES)
    .map((entry, index) => {
      const entryClaimedAtMs = Date.parse(entry.claimedAt || entry.acquiredAt || entry.updatedAt || entry.timestamp || '');
      const entryStatus = String(entry.status || entry.state || 'claimed').toLowerCase();

      return {
        id: String(entry.id || entry.claimId || `resume-claim-${index + 1}`),
        commandId: entry.commandId || entry.idempotencyKey ? String(entry.commandId || entry.idempotencyKey) : null,
        tokenId: entry.tokenId ? String(entry.tokenId) : null,
        checkpointId: entry.checkpointId ? String(entry.checkpointId) : null,
        ownerId: entry.ownerId || entry.holderId ? String(entry.ownerId || entry.holderId) : null,
        status: entryStatus,
        claimedAt: Number.isNaN(entryClaimedAtMs) ? null : new Date(entryClaimedAtMs).toISOString(),
        ageMs: Number.isNaN(entryClaimedAtMs) ? null : Math.max(0, nowMs - entryClaimedAtMs)
      };
    });
  const matchingClaim = claimLedger.find((entry) => entry.id === claimId || (entry.commandId && entry.commandId === commandId)) || null;
  const conflictingClaim = claimLedger.find((entry) => (
    ACTIVE_RESUME_CLAIM_STATUSES.has(entry.status)
    && entry.ownerId
    && entry.ownerId !== ownerId
    && (entry.ageMs === null || entry.ageMs <= RESUME_CLAIM_STALE_AFTER_MS)
    && (!entry.checkpointId || !checkpointId || entry.checkpointId === checkpointId)
  )) || null;
  const blockers = [];
  const warnings = [];

  if (!claimId) blockers.push('resume_claim_id_missing');
  if (!ownerId) blockers.push('resume_claim_owner_missing');
  if (claimInput.commandId && commandId !== persistedState.commandId) blockers.push('resume_claim_command_mismatch');
  if (claimInput.tokenId && token?.tokenId && tokenId !== String(token.tokenId)) blockers.push('resume_claim_token_mismatch');
  if (claimInput.checkpointId && token?.checkpointId && checkpointId !== String(token.checkpointId)) blockers.push('resume_claim_checkpoint_mismatch');
  if (claimInput.tenantId && tenantBoundary.tenantId && String(claimInput.tenantId) !== String(tenantBoundary.tenantId)) {
    blockers.push('resume_claim_tenant_mismatch');
  }
  if (claimInput.workspaceId && tenantBoundary.workspaceId && String(claimInput.workspaceId) !== String(tenantBoundary.workspaceId)) {
    blockers.push('resume_claim_workspace_mismatch');
  }
  if (Number.isNaN(claimedAtMs)) blockers.push('resume_claim_claimed_at_invalid');
  if (Number.isFinite(claimedAtMs) && claimedAtMs > nowMs) blockers.push('resume_claim_claimed_at_in_future');
  if (ageMs !== null && ageMs > RESUME_CLAIM_STALE_AFTER_MS) warnings.push('resume_claim_stale');
  if (REJECTED_RESUME_CLAIM_STATUSES.has(status)) blockers.push('resume_claim_status_rejected');
  if (matchingClaim && REJECTED_RESUME_CLAIM_STATUSES.has(matchingClaim.status)) {
    blockers.push('resume_claim_prior_status_rejected');
  }
  if (matchingClaim && matchingClaim.ownerId && matchingClaim.ownerId !== ownerId) blockers.push('resume_claim_owner_mismatch');
  if (conflictingClaim) blockers.push('resume_claim_conflict');
  if (persistedState.commandAlreadyApplied) warnings.push('resume_claim_command_already_applied');

  const state = persistedState.commandAlreadyApplied
    ? 'already-applied'
    : blockers.length > 0
      ? 'blocked'
      : warnings.includes('resume_claim_stale')
        ? 'stale'
        : matchingClaim
          ? 'reclaimed'
          : status === 'implicit'
            ? 'implicit'
            : 'claimed';

  return {
    schema: 'aios.audit-recovery.resume-token.resume-claim.v1',
    id: claimId || null,
    state,
    status,
    commandId: commandId || null,
    tokenId: tokenId || null,
    checkpointId: checkpointId || null,
    ownerId: ownerId || null,
    claimedAt,
    ageMs,
    staleAfterMs: RESUME_CLAIM_STALE_AFTER_MS,
    replayDisposition: persistedState.commandAlreadyApplied
      ? 'return-cached-result'
      : blockers.length > 0
        ? 'reject-claim'
        : 'admit-single-use-resume',
    matchingPriorClaimId: matchingClaim?.id || null,
    conflictingClaimId: conflictingClaim?.id || null,
    ledgerCount: claimLedger.length,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    proofSubjects: [
      `claim:${claimId || 'missing'}`,
      `owner:${ownerId || 'missing'}`,
      `command:${commandId || 'missing'}`,
      `checkpoint:${checkpointId || 'missing'}`
    ],
    nextAction: blockers.length > 0
      ? blockers.includes('resume_claim_conflict')
        ? 'wait_for_active_resume_claim_or_reclaim'
        : 'repair_resume_claim'
      : persistedState.commandAlreadyApplied
        ? 'return_cached_resume_result'
        : 'commit_resume_claim'
  };
}

function buildAnalyticsExportModel(validation, dependencyHealth, retryState, historySnapshots, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, historyDigest, nowMs) {
  const generatedAt = new Date(nowMs).toISOString();
  const domainRows = [
    {
      id: 'token',
      state: validation.valid ? 'valid' : 'invalid',
      blockingCount: validation.errors.length,
      warningCount: validation.warnings.length,
      nextAction: validation.expired ? 'request_fresh_resume_token' : validation.valid ? 'retain_resume_token' : 'halt_resume_and_reissue_token'
    },
    {
      id: 'dependencies',
      state: dependencyHealth.some((dependency) => dependency.required && dependency.ok === false) ? 'blocked' : dependencyHealth.some((dependency) => dependency.ok === false) ? 'degraded' : 'ready',
      blockingCount: dependencyHealth.filter((dependency) => dependency.required && dependency.ok === false).length,
      warningCount: dependencyHealth.filter((dependency) => dependency.required === false && dependency.ok === false).length,
      nextAction: dependencyHealth.some((dependency) => dependency.required && dependency.ok === false) ? retryState.nextAction : 'continue_dependency_health_tracking'
    },
    {
      id: 'providers',
      state: providerContract.blockingProviderCount > 0 || providerContract.sync.conflict ? 'blocked' : providerContract.sync.degraded ? 'degraded' : 'ready',
      blockingCount: providerContract.blockingProviderCount,
      warningCount: providerContract.providers.filter((provider) => provider.sync.state === 'stale' || provider.sync.state === 'unknown').length,
      nextAction: providerContract.handoff.nextAction
    },
    {
      id: 'client-runtime',
      state: clientRuntime.canReleaseControl ? 'ready' : 'blocked',
      blockingCount: clientRuntime.errors.length,
      warningCount: clientRuntime.warnings.length,
      nextAction: clientRuntime.nextAction
    },
    {
      id: 'workflow-handoff',
      state: workflowHandoff.state,
      blockingCount: workflowHandoff.blockers.length,
      warningCount: workflowHandoff.requiresClientAck ? 1 : 0,
      nextAction: workflowHandoff.nextAction
    },
    {
      id: 'persistence',
      state: persistedState.status,
      blockingCount: persistedState.errors.length,
      warningCount: persistedState.warnings.length,
      nextAction: persistedState.restart.nextAction
    },
    {
      id: 'resume-lease',
      state: resumeLease.state,
      blockingCount: resumeLease.errors.length,
      warningCount: resumeLease.warnings.length,
      nextAction: resumeLease.nextAction
    },
    {
      id: 'tenant-boundary',
      state: tenantBoundary.errors.length > 0 ? 'blocked' : 'scoped',
      blockingCount: tenantBoundary.errors.length,
      warningCount: tenantBoundary.warnings.length,
      nextAction: tenantBoundary.auditHandoff.nextAction
    }
  ];
  const blockedDomains = domainRows.filter((row) => row.blockingCount > 0);
  const warningDomains = domainRows.filter((row) => row.warningCount > 0);
  const historyRows = historySnapshots.slice(-EXPORT_TIMELINE_LIMIT).map((snapshot, index) => ({
    sequence: index + 1,
    snapshotId: snapshot.id,
    at: snapshot.timestamp,
    state: snapshot.ok ? 'success' : 'failure',
    status: snapshot.status,
    tokenId: snapshot.tokenId,
    checkpointId: snapshot.checkpointId,
    retryAttempts: snapshot.retryAttempts,
    evidenceCount: snapshot.evidenceCount,
    failureCodes: snapshot.failureCodes
  }));
  const providerRows = providerContract.providers.map((provider, index) => ({
    sequence: index + 1,
    providerId: provider.id,
    state: provider.available
      && provider.missingCapabilities.length === 0
      && provider.serviceBlockingCount === 0
      && provider.negotiation.accepted
      ? provider.sync.state
      : 'blocked',
    required: provider.required,
    serviceCount: provider.services.length,
    blockingServiceCount: provider.serviceBlockingCount,
    missingCapabilityCount: provider.missingCapabilities.length,
    negotiationAccepted: provider.negotiation.accepted,
    negotiationBlockingReasons: provider.negotiation.blockingReasons,
    requestedContractVersion: provider.negotiation.requestedContractVersion,
    requestedProofFormat: provider.negotiation.requestedProofFormat,
    requestedExportTarget: provider.negotiation.requestedExportTarget,
    writeBarrierOpen: provider.negotiation.writeBarrierOpen,
    sequenceDrift: provider.negotiation.sequenceDrift,
    capabilityCoverage: provider.capabilityFit.coverage,
    capabilityFitState: provider.capabilityFit.state,
    handoffCommitState: provider.handoffCommit.state,
    handoffCommitReady: provider.handoffCommit.ready,
    handoffCommitBlockers: provider.handoffCommit.blockers,
    handoffCommitPayloadRef: provider.handoffCommit.payload.ref,
    handoffCommitReceiptRef: provider.handoffCommit.receipt.ref,
    handoffCommitSequence: provider.handoffCommit.syncCommit.sequence,
    syncState: provider.sync.state,
    selected: provider.id === providerContract.selectedProviderId
  }));
  const exportReady = blockedDomains.length === 0 && clientRuntime.stateExport.ready;

  return {
    schema: 'aios.audit-recovery.resume-token.analytics-export.v1',
    generatedAt,
    state: exportReady ? 'ready' : blockedDomains.length > 0 ? 'blocked' : 'waiting-for-client-export',
    exportReady,
    dimensions: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      checkpointId: clientRuntime.focusCheckpointId || resumeLease.checkpointId,
      tokenId: resumeLease.tokenId,
      commandId: persistedState.commandId,
      lifecycleCommand: lifecycle.command,
      lifecycleState: lifecycle.state,
      destinationKind: workflowHandoff.destination.kind,
      providerId: workflowHandoff.destination.providerId || providerContract.selectedProviderId,
      clientSessionId: clientRuntime.sessionId
    },
    counters: {
      domainCount: domainRows.length,
      blockedDomainCount: blockedDomains.length,
      warningDomainCount: warningDomains.length,
      providerExportRowCount: providerRows.length,
      historyExportRowCount: historyRows.length,
      totalBlockingCount: domainRows.reduce((count, row) => count + row.blockingCount, 0),
      totalWarningCount: domainRows.reduce((count, row) => count + row.warningCount, 0)
    },
    historySnapshotWindow: {
      limit: EXPORT_TIMELINE_LIMIT,
      totalSnapshots: historyDigest.totalSnapshots,
      exportedSnapshots: historyRows.length,
      newestSnapshotAt: historyDigest.newestSnapshotAt,
      currentStreak: historyDigest.currentStreak,
      recentFailureRate: historyDigest.recentWindow.failureRate,
      regressionDetected: historyDigest.recentWindow.regression
    },
    domainRows,
    providerRows,
    historyRows,
    summary: {
      primaryBlockedDomain: blockedDomains[0]?.id || null,
      primaryWarningDomain: warningDomains[0]?.id || null,
      nextAction: blockedDomains[0]?.nextAction
        || (clientRuntime.stateExport.ready ? workflowHandoff.nextAction : clientRuntime.nextAction),
      proofSubjects: [
        `analytics-export:${persistedState.commandId}`,
        `checkpoint:${clientRuntime.focusCheckpointId || resumeLease.checkpointId || 'unknown'}`,
        `tenant:${tenantBoundary.tenantId || 'unknown'}`,
        `destination:${workflowHandoff.destination.kind}`,
        `history-window:${historyRows.length}`
      ]
    }
  };
}

function buildAnalytics(validation, dependencyHealth, retryState, evidence, historySnapshots, nowMs, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease) {
  const dependencyFailures = dependencyHealth.filter((dependency) => dependency.ok === false);
  const historicalFailures = historySnapshots.filter((snapshot) => snapshot.ok === false);
  const historyDigest = buildHistorySnapshotDigest(historySnapshots, nowMs);
  const exportModel = buildAnalyticsExportModel(validation, dependencyHealth, retryState, historySnapshots, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, historyDigest, nowMs);
  const uniqueCheckpoints = new Set(
    historySnapshots
      .map((snapshot) => snapshot.checkpointId)
      .filter(Boolean)
  );

  return {
    counters: {
      validationErrorCount: validation.errors.length,
      validationWarningCount: validation.warnings.length,
      dependencyFailureCount: dependencyFailures.length,
      requiredDependencyFailureCount: dependencyFailures.filter((dependency) => dependency.required !== false).length,
      evidenceCount: evidence.length,
      retryAttempts: retryState.attempts,
      historySnapshotCount: historySnapshots.length,
      historicalFailureCount: historicalFailures.length,
      uniqueCheckpointCount: uniqueCheckpoints.size,
      lifecycleErrorCount: lifecycle.errors.length,
      lifecycleWarningCount: lifecycle.warnings.length,
      scheduleDelayMs: lifecycle.schedule.delayMs,
      lifecycleAllowedCommandCount: lifecycle.settingsPolicy.allowedCommands.length,
      lifecycleDeniedCommandCount: lifecycle.settingsPolicy.deniedCommands.length,
      lifecycleAcceptedControlChangeCount: lifecycle.settingsPolicy.changeSet.accepted.length,
      lifecycleRejectedControlChangeCount: lifecycle.settingsPolicy.changeSet.rejected.length,
      providerCount: providerContract.providers.length,
      providerBlockingCount: providerContract.blockingProviderCount,
      providerServiceCount: providerContract.providers.reduce((count, provider) => count + provider.services.length, 0),
      providerServiceBlockingCount: providerContract.providers.reduce((count, provider) => count + provider.serviceBlockingCount, 0),
      providerNegotiatedCount: providerContract.negotiation.acceptedProviderIds.length,
      providerNegotiationBlockedCount: providerContract.negotiation.blockedProviderIds.length,
      providerWriteBarrierBlockedCount: providerContract.negotiation.writeBarrierBlockedProviderIds.length,
      providerHandoffCommitReadyCount: providerContract.handoffCommit.readyProviderIds.length,
      providerHandoffCommitBlockedCount: providerContract.handoffCommit.blockedProviderIds.length,
      providerHandoffCommitBlockerCodeCount: providerContract.handoffCommit.blockerCodes.length,
      requiredCapabilityCount: providerContract.requiredCapabilities.length,
      clientPendingMutationCount: clientRuntime.pendingMutations.length,
      clientUnflushedMutationCount: clientRuntime.unflushedMutationCount,
      clientWorkflowActionCount: clientRuntime.workflowActions.length,
      clientRequiredWorkflowActionCount: clientRuntime.workflowActions.filter((action) => action.required).length,
      clientUnresolvedRequiredActionCount: clientRuntime.unresolvedRequiredActionCount,
      clientStateExportTargetCount: clientRuntime.stateExport.targets.length,
      workflowHandoffBlockerCount: workflowHandoff.blockers.length,
      persistedCommandCount: persistedState.ledger.count,
      persistedErrorCount: persistedState.errors.length,
      persistedWarningCount: persistedState.warnings.length,
      resumeLeaseErrorCount: resumeLease.errors.length,
      resumeLeaseWarningCount: resumeLease.warnings.length,
      tenantBoundaryErrorCount: tenantBoundary.errors.length,
      tenantBoundaryWarningCount: tenantBoundary.warnings.length,
      missingPermissionCount: tenantBoundary.principal.missingPermissions.length,
      providerScopeViolationCount: tenantBoundary.isolation.providerScopeViolations.length,
      workspaceLaneCount: tenantBoundary.isolation.workspaceLanes.length,
      workspaceLanePermissionCount: tenantBoundary.isolation.workspaceLanes
        .reduce((count, lane) => count + lane.requiredPermissions.length, 0),
      workspaceLaneCheckpointPrefixCount: tenantBoundary.isolation.workspaceLanes
        .reduce((count, lane) => count + lane.checkpointPrefixes.length, 0),
      historyCurrentStreakCount: historyDigest.currentStreak.count,
      historyDistinctFailureCodeCount: Object.keys(historyDigest.failureCodeCounts).length,
      historyRepeatedFailureCodeCount: historyDigest.repeatedFailureCodes.length,
      historyRepeatedCheckpointCount: historyDigest.repeatedCheckpoints.length,
      historyRecentFailureCount: historyDigest.recentWindow.failureCount,
      analyticsBlockedDomainCount: exportModel.counters.blockedDomainCount,
      analyticsWarningDomainCount: exportModel.counters.warningDomainCount,
      analyticsHistoryExportRowCount: exportModel.counters.historyExportRowCount,
      analyticsProviderExportRowCount: exportModel.counters.providerExportRowCount
    },
    rates: {
      historicalFailureRate: historySnapshots.length === 0
        ? 0
        : Number((historicalFailures.length / historySnapshots.length).toFixed(4)),
      recentHistoryFailureRate: historyDigest.recentWindow.failureRate
    },
    flags: {
      hasExpiredToken: validation.expired,
      hasRecentFailure: historicalFailures.some((snapshot) => nowMs - Date.parse(snapshot.timestamp) < TOKEN_TTL_MS),
      exhaustedRetries: retryState.retryable === false,
      lifecycleDisabled: lifecycle.enabled === false,
      lifecyclePaused: lifecycle.paused === true,
      lifecycleScheduled: lifecycle.schedule.enabled === true,
      lifecycleCommandAllowed: lifecycle.settingsPolicy.commandAllowed,
      lifecycleAutoResumeEnabled: lifecycle.settingsPolicy.autoResumeEnabled,
      lifecycleSchedulePolicyEnabled: lifecycle.settingsPolicy.scheduleEnabled,
      lifecycleScheduleApprovalPending: lifecycle.settingsPolicy.scheduleRequiresApproval
        && !lifecycle.settingsPolicy.approvalGranted,
      lifecycleSettingsChangePending: lifecycle.state === 'settings-update-pending',
      lifecycleSettingsRevisionConflict: lifecycle.errors.includes('lifecycle_settings_revision_conflict'),
      manualApprovalPending: lifecycle.manualApprovalRequired && !lifecycle.approvalGranted,
      providerSyncDegraded: providerContract.sync.degraded,
      providerNegotiationBlocked: providerContract.negotiation.blockedProviderIds.length > 0,
      providerWriteBarrierBlocked: providerContract.negotiation.writeBarrierBlockedProviderIds.length > 0,
      providerHandoffCommitBlocked: providerContract.handoffCommit.blockedProviderIds.length > 0,
      externalHandoffReady: providerContract.handoff.state === 'ready',
      externalHandoffManifestReady: providerContract.handoff.manifest.transferable,
      clientRuntimeReady: clientRuntime.canReleaseControl,
      clientStateExportReady: clientRuntime.stateExport.ready,
      clientRequiredActionsResolved: clientRuntime.handoffTicket.requiredActionsResolved,
      workflowHandoffReady: workflowHandoff.state === 'ready-for-external-handoff'
        || workflowHandoff.state === 'ready-for-kernel-resume',
      restartSafe: persistedState.status === 'restart-safe' || persistedState.status === 'idempotent-replay',
      idempotentReplay: persistedState.commandAlreadyApplied,
      resumeLeaseReady: resumeLease.canProceed,
      resumeLeaseRenewalRequired: resumeLease.renewal.required,
      tenantBoundaryReady: tenantBoundary.errors.length === 0,
      auditBoundaryProofReady: tenantBoundary.auditHandoff.canEmitProof,
      workspaceLaneSelected: Boolean(tenantBoundary.isolation.selectedWorkspaceLaneId),
      workspaceLaneCheckpointAllowed: tenantBoundary.isolation.checkpointAllowedByLane !== false,
      crossWorkspaceEscalated: tenantBoundary.isolation.crossWorkspaceRequested
        && tenantBoundary.isolation.crossWorkspaceAllowed,
      historyRegressionDetected: historyDigest.recentWindow.regression,
      historyRecoveredAfterFailure: historyDigest.recovery.recoveredAfterFailure
    },
    history: historyDigest,
    exportModel
  };
}

function normalizeCheckpointPreviewHandoff(request, token, providerContract, nowMs) {
  const handoffInput = request.previewResumeTokenHandoff && typeof request.previewResumeTokenHandoff === 'object'
    ? request.previewResumeTokenHandoff
    : request.checkpointPreviewHandoff && typeof request.checkpointPreviewHandoff === 'object'
      ? request.checkpointPreviewHandoff
      : request.previewAcceptanceExportManifest && typeof request.previewAcceptanceExportManifest === 'object'
        ? {
            manifest: request.previewAcceptanceExportManifest,
            acceptance: request.previewAcceptanceExportManifest.routeHandoff,
            checkpointIds: request.previewAcceptanceExportManifest.rows?.map((row) => row.checkpointId)
          }
        : {};
  const present = Object.keys(handoffInput).length > 0;
  const manifestInput = handoffInput.manifest && typeof handoffInput.manifest === 'object'
    ? handoffInput.manifest
    : {};
  const acceptanceInput = handoffInput.acceptance && typeof handoffInput.acceptance === 'object'
    ? handoffInput.acceptance
    : {};
  const routeInput = handoffInput.routeContract && typeof handoffInput.routeContract === 'object'
    ? handoffInput.routeContract
    : {};
  const adoptionInput = handoffInput.clientStateAdoption && typeof handoffInput.clientStateAdoption === 'object'
    ? handoffInput.clientStateAdoption
    : {};
  const resumeTokenInput = handoffInput.resumeToken && typeof handoffInput.resumeToken === 'object'
    ? handoffInput.resumeToken
    : {};
  const checkpointIds = normalizeStringList(
    handoffInput.checkpointIds
    || handoffInput.selectedCheckpointIds
    || manifestInput.checkpointIds
    || manifestInput.selectedCheckpointIds
  );
  const checkpointId = String(
    handoffInput.checkpointId
    || resumeTokenInput.checkpointId
    || checkpointIds[0]
    || token?.checkpointId
    || ''
  );
  const tokenId = String(resumeTokenInput.tokenId || handoffInput.tokenId || token?.tokenId || '');
  const tenantId = handoffInput.tenantId ? String(handoffInput.tenantId) : null;
  const workspaceId = handoffInput.workspaceId ? String(handoffInput.workspaceId) : null;
  const manifestId = String(manifestInput.manifestId || handoffInput.manifestId || '');
  const manifestDigest = String(manifestInput.digest || handoffInput.manifestDigest || handoffInput.proof?.digest || '');
  const acceptanceDigest = String(acceptanceInput.digest || acceptanceInput.acceptanceDigest || handoffInput.acceptanceDigest || '');
  const acceptedAt = acceptanceInput.acceptedAt
    ? toIsoString(acceptanceInput.acceptedAt, nowMs)
    : handoffInput.generatedAt
      ? toIsoString(handoffInput.generatedAt, nowMs)
      : null;
  const acceptedBy = acceptanceInput.acceptedBy ? String(acceptanceInput.acceptedBy) : null;
  const accepted = handoffInput.accepted === true
    || handoffInput.state === 'accepted'
    || acceptanceInput.accepted === true
    || Boolean(acceptedBy && acceptedAt && acceptanceDigest);
  const manifestReady = manifestInput.ready === true
    || handoffInput.ready === true
    || handoffInput.state === 'accepted';
  const canAdoptClientState = adoptionInput.canAdopt !== false;
  const requiredStateExportTargets = normalizeStringList(
    adoptionInput.requiredStateExportTargets
    || adoptionInput.stateExportTargets
    || ['browser', 'hosted-kernel']
  ).map((target) => target.toLowerCase());
  const unsupportedStateExportTargets = requiredStateExportTargets
    .filter((target) => !CLIENT_STATE_EXPORT_TARGETS.has(target));
  const requestedProviderId = routeInput.targetProviderId || handoffInput.targetProviderId || null;
  const providerMismatch = requestedProviderId
    && providerContract.selectedProviderId
    && requestedProviderId !== providerContract.selectedProviderId;
  const blockers = [];
  const warnings = [];

  if (present && !accepted) blockers.push('checkpoint_preview_handoff_not_accepted');
  if (present && !manifestReady) blockers.push('checkpoint_preview_manifest_not_ready');
  if (present && !manifestId) blockers.push('checkpoint_preview_manifest_id_missing');
  if (present && !manifestDigest) blockers.push('checkpoint_preview_manifest_digest_missing');
  if (present && !acceptanceDigest) blockers.push('checkpoint_preview_acceptance_digest_missing');
  if (present && !checkpointId) blockers.push('checkpoint_preview_checkpoint_missing');
  if (present && token?.checkpointId && checkpointId && checkpointId !== String(token.checkpointId)) {
    blockers.push('checkpoint_preview_token_checkpoint_mismatch');
  }
  if (present && resumeTokenInput.tokenId && token?.tokenId && tokenId !== String(token.tokenId)) {
    blockers.push('checkpoint_preview_token_id_mismatch');
  }
  if (present && providerMismatch) blockers.push('checkpoint_preview_provider_mismatch');
  if (present && !canAdoptClientState) blockers.push('checkpoint_preview_client_state_not_adoptable');
  if (unsupportedStateExportTargets.length > 0) blockers.push('checkpoint_preview_state_export_target_unsupported');
  if (present && !acceptedBy) warnings.push('checkpoint_preview_acceptor_unknown');
  if (present && routeInput.destination === 'mailchimp' && providerContract.mailchimp.requested !== true) {
    warnings.push('checkpoint_preview_mailchimp_destination_without_provider_request');
  }

  const proofSubjects = present
    ? [
        `checkpoint-preview:${handoffInput.handoffId || manifestId || 'unidentified'}`,
        `manifest:${manifestId || 'missing'}`,
        `acceptance:${acceptanceDigest || 'missing'}`,
        `checkpoint:${checkpointId || 'missing'}`,
        `client-state:${canAdoptClientState ? 'adoptable' : 'blocked'}`
      ]
    : [];

  return {
    schema: 'aios.audit-recovery.resume-token.checkpoint-preview-handoff.v1',
    present,
    state: !present
      ? 'not-present'
      : blockers.length > 0
        ? 'blocked'
        : warnings.length > 0
          ? 'accepted-with-warnings'
          : 'accepted',
    accepted: present && accepted && blockers.length === 0,
    handoffId: handoffInput.handoffId || null,
    tenantId,
    workspaceId,
    checkpointId: checkpointId || null,
    checkpointIds,
    tokenId: tokenId || null,
    manifest: {
      manifestId: manifestId || null,
      ready: manifestReady,
      digest: manifestDigest || null,
      selectedCheckpointCount: Number.isFinite(Number(manifestInput.selectedCheckpointCount))
        ? Number(manifestInput.selectedCheckpointCount)
        : checkpointIds.length
    },
    acceptance: {
      accepted,
      acceptedBy,
      acceptedAt,
      digest: acceptanceDigest || null
    },
    routeContract: {
      sourceRoute: routeInput.sourceRoute || null,
      resumeRouteAction: routeInput.resumeRouteAction || null,
      continuationAction: routeInput.continuationAction || null,
      destination: routeInput.destination || (providerContract.handoff.enabled ? 'external-provider' : 'hosted-kernel'),
      targetProviderId: requestedProviderId,
      providerMatches: !providerMismatch
    },
    clientStateAdoption: {
      canAdopt: canAdoptClientState && blockers.length === 0,
      viewStateKey: adoptionInput.viewStateKey || null,
      requiredStateExportTargets,
      unsupportedStateExportTargets,
      pendingMutationIds: normalizeStringList(adoptionInput.pendingMutationIds),
      missingAcknowledgements: normalizeStringList(adoptionInput.missingAcknowledgements),
      nextAction: blockers.length > 0
        ? 'repair_checkpoint_preview_handoff'
        : 'adopt_checkpoint_preview_handoff'
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    proofSubjects,
    proofDigest: present
      ? String(handoffInput.proof?.digest || `${manifestDigest}:${acceptanceDigest}:${checkpointId}`)
      : null
  };
}

function computeRetryState(input) {
  const requestedAttempts = Number(input.retryAttempts ?? input.attempts ?? 0);
  const attempts = Number.isFinite(requestedAttempts) ? Math.max(0, requestedAttempts) : 0;
  const cappedAttempts = Math.min(attempts, MAX_RETRY_ATTEMPTS);
  const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** cappedAttempts));
  const retryable = attempts < MAX_RETRY_ATTEMPTS;

  return {
    attempts,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    retryable,
    backoffMs: retryable ? backoffMs : 0,
    nextAction: retryable ? 'retry_resume_after_backoff' : 'escalate_manual_recovery'
  };
}

function normalizeLifecycleSettings(request, nowMs) {
  const settings = request.lifecycleSettings && typeof request.lifecycleSettings === 'object'
    ? request.lifecycleSettings
    : request.settings && typeof request.settings === 'object'
      ? request.settings
      : {};
  const controls = settings.controls && typeof settings.controls === 'object' ? settings.controls : {};
  const scheduleInput = settings.schedule && typeof settings.schedule === 'object'
    ? settings.schedule
    : request.schedule && typeof request.schedule === 'object'
      ? request.schedule
      : {};
  const errors = [];
  const warnings = [];
  const requestedCommand = String(request.command || settings.command || 'inspect');
  const command = LIFECYCLE_COMMANDS.has(requestedCommand) ? requestedCommand : 'inspect';
  const allowedCommands = new Set(normalizeStringList(
    controls.allowedCommands
    || settings.allowedCommands
    || request.allowedLifecycleCommands
  ).map((entry) => entry.toLowerCase()).filter((entry) => LIFECYCLE_COMMANDS.has(entry)));
  const deniedCommands = normalizeStringList(
    controls.deniedCommands
    || settings.deniedCommands
    || request.deniedLifecycleCommands
  ).map((entry) => entry.toLowerCase()).filter((entry) => LIFECYCLE_COMMANDS.has(entry));
  const scheduleControls = controls.schedule && typeof controls.schedule === 'object'
    ? controls.schedule
    : settings.scheduleControls && typeof settings.scheduleControls === 'object'
      ? settings.scheduleControls
      : {};
  const changeSetInput = request.lifecycleChangeSet && typeof request.lifecycleChangeSet === 'object'
    ? request.lifecycleChangeSet
    : settings.changeSet && typeof settings.changeSet === 'object'
      ? settings.changeSet
      : controls.changeSet && typeof controls.changeSet === 'object'
        ? controls.changeSet
        : request.controlChanges && typeof request.controlChanges === 'object'
          ? request.controlChanges
          : {};
  const requestedControlChanges = changeSetInput.controls && typeof changeSetInput.controls === 'object'
    ? changeSetInput.controls
    : changeSetInput;
  const currentSettingsRevision = Number(settings.revision ?? controls.revision ?? request.settingsRevision ?? 0);
  const expectedSettingsRevision = Number(
    changeSetInput.expectedRevision
    ?? changeSetInput.ifRevision
    ?? request.expectedSettingsRevision
  );
  const lockedControls = new Set(normalizeStringList(
    controls.lockedControls
    || settings.lockedControls
    || request.lockedLifecycleControls
  ));
  const revisionConflict = Number.isFinite(expectedSettingsRevision)
    && Number.isFinite(currentSettingsRevision)
    && expectedSettingsRevision !== currentSettingsRevision;
  const acceptedControlChanges = {};
  const rejectedControlChanges = [];

  for (const [key, rawValue] of Object.entries(requestedControlChanges || {})) {
    if (['expectedRevision', 'ifRevision', 'reason', 'requestedBy', 'controls'].includes(key)) {
      continue;
    }
    if (!LIFECYCLE_MUTABLE_CONTROLS.has(key)) {
      rejectedControlChanges.push({ key, reason: 'unsupported_control' });
      continue;
    }
    if (lockedControls.has(key)) {
      rejectedControlChanges.push({ key, reason: 'locked_control' });
      continue;
    }
    if (revisionConflict) {
      rejectedControlChanges.push({ key, reason: 'settings_revision_conflict' });
      continue;
    }

    if (key === 'maxScheduleDelayMs') {
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        rejectedControlChanges.push({ key, reason: 'numeric_control_invalid' });
      } else {
        acceptedControlChanges[key] = numericValue;
      }
      continue;
    }

    if (typeof rawValue !== 'boolean') {
      rejectedControlChanges.push({ key, reason: 'boolean_control_invalid' });
    } else {
      acceptedControlChanges[key] = rawValue;
    }
  }

  if (revisionConflict) {
    errors.push('lifecycle_settings_revision_conflict');
  }
  if (rejectedControlChanges.some((change) => change.reason === 'unsupported_control')) {
    errors.push('lifecycle_settings_control_unsupported');
  }
  if (rejectedControlChanges.some((change) => change.reason === 'locked_control')) {
    errors.push('lifecycle_settings_control_locked');
  }
  if (rejectedControlChanges.some((change) => change.reason.endsWith('_invalid'))) {
    errors.push('lifecycle_settings_control_invalid');
  }

  const effectiveEnabledControl = acceptedControlChanges.enabled ?? controls.enabled ?? settings.enabled;
  const effectivePausedControl = acceptedControlChanges.paused ?? controls.paused ?? settings.paused;
  const effectiveAutoResumeControl = acceptedControlChanges.autoResumeEnabled ?? controls.autoResumeEnabled ?? settings.autoResumeEnabled;
  const effectiveScheduleEnabledControl = acceptedControlChanges.scheduleEnabled
    ?? scheduleControls.enabled
    ?? controls.scheduleEnabled
    ?? settings.scheduleEnabled;
  const effectiveScheduleRequiresApprovalControl = acceptedControlChanges.scheduleRequiresApproval
    ?? scheduleControls.requiresApproval
    ?? controls.scheduleRequiresApproval
    ?? settings.scheduleRequiresApproval;
  const effectiveAllowPastDueScheduleControl = acceptedControlChanges.allowPastDueSchedule
    ?? scheduleControls.allowPastDue
    ?? controls.allowPastDueSchedule
    ?? settings.allowPastDueSchedule;
  const effectiveManualApprovalRequiredControl = acceptedControlChanges.manualApprovalRequired
    ?? controls.manualApprovalRequired
    ?? settings.manualApprovalRequired;
  const effectiveMaxScheduleDelayControl = acceptedControlChanges.maxScheduleDelayMs
    ?? scheduleControls.maxDelayMs
    ?? controls.maxScheduleDelayMs
    ?? settings.maxScheduleDelayMs;
  const autoResumeEnabled = effectiveAutoResumeControl !== false;
  const scheduleControlEnabled = effectiveScheduleEnabledControl !== false;
  const scheduleRequiresApproval = effectiveScheduleRequiresApprovalControl === true;
  const allowPastDueSchedule = effectiveAllowPastDueScheduleControl === true;
  const configuredMaxDelayMs = Number(effectiveMaxScheduleDelayControl);
  const maxScheduleDelayMs = Number.isFinite(configuredMaxDelayMs)
    ? Math.max(MIN_CONFIGURED_SCHEDULE_DELAY_MS, Math.min(MAX_SCHEDULE_DELAY_MS, configuredMaxDelayMs))
    : MAX_SCHEDULE_DELAY_MS;
  const commandDenied = deniedCommands.includes(command)
    || (allowedCommands.size > 0 && !allowedCommands.has(command));

  if (!LIFECYCLE_COMMANDS.has(requestedCommand)) {
    errors.push('lifecycle_command_unsupported');
  }
  if (commandDenied) {
    errors.push('lifecycle_command_denied_by_policy');
  }
  if (Number.isFinite(configuredMaxDelayMs) && configuredMaxDelayMs < MIN_CONFIGURED_SCHEDULE_DELAY_MS) {
    warnings.push('lifecycle_policy_max_schedule_delay_raised_to_minimum');
  }
  if (Number.isFinite(configuredMaxDelayMs) && configuredMaxDelayMs > MAX_SCHEDULE_DELAY_MS) {
    warnings.push('lifecycle_policy_max_schedule_delay_capped');
  }

  const enabled = command === 'enable'
    ? true
    : command === 'disable'
      ? false
      : effectiveEnabledControl !== false;
  const paused = command === 'pause'
    ? true
    : command === 'resume'
      ? false
      : effectivePausedControl === true;
  const auditRequired = controls.auditRequired !== false;
  const manualApprovalRequired = effectiveManualApprovalRequiredControl === true;
  const approvalGranted = request.approvalGranted === true || settings.approvalGranted === true;
  const resumeCommandRequested = ['resume', 'schedule-resume'].includes(command);
  const commandRequiresResumeCapacity = ['resume', 'schedule-resume', 'rotate-token'].includes(command);

  if (!enabled && commandRequiresResumeCapacity) {
    errors.push('lifecycle_resume_disabled');
  }
  if (paused && commandRequiresResumeCapacity) {
    errors.push('lifecycle_resume_paused');
  }
  if (!autoResumeEnabled && resumeCommandRequested) {
    errors.push('lifecycle_auto_resume_disabled');
  }
  if (manualApprovalRequired && !approvalGranted) {
    errors.push('lifecycle_manual_approval_required');
  }

  const requestedRunAt = scheduleInput.nextRunAt || scheduleInput.runAt || scheduleInput.after;
  const requestedDelayMs = Number(scheduleInput.delayMs ?? scheduleInput.afterMs);
  const hasRelativeDelay = Number.isFinite(requestedDelayMs);
  const scheduleEnabled = command === 'cancel-schedule'
    ? false
    : command === 'schedule-resume' || scheduleInput.enabled === true || Boolean(requestedRunAt) || hasRelativeDelay;
  let nextRunAt = null;
  let delayMs = null;

  if (scheduleEnabled) {
    if (!scheduleControlEnabled) {
      errors.push('lifecycle_schedule_disabled_by_policy');
    }
    if (scheduleRequiresApproval && !approvalGranted) {
      errors.push('lifecycle_schedule_approval_required');
    }
    const parsedRunAt = requestedRunAt
      ? Date.parse(requestedRunAt)
      : hasRelativeDelay
        ? nowMs + requestedDelayMs
        : NaN;
    if (Number.isNaN(parsedRunAt)) {
      errors.push('lifecycle_schedule_nextRunAt_invalid');
    } else {
      delayMs = parsedRunAt - nowMs;
      nextRunAt = new Date(parsedRunAt).toISOString();
      if (hasRelativeDelay && requestedDelayMs < 0) {
        errors.push('lifecycle_schedule_delay_negative');
      }
      if (!allowPastDueSchedule && delayMs < MIN_SCHEDULE_DELAY_MS) {
        errors.push('lifecycle_schedule_too_soon');
      }
      if (delayMs > maxScheduleDelayMs) {
        errors.push('lifecycle_schedule_too_far');
      }
    }
  }

  const scheduleDue = scheduleEnabled && delayMs !== null && delayMs <= 0;
  const settingsPolicy = {
    schema: 'aios.audit-recovery.resume-token.lifecycle-settings-policy.v1',
    revision: Number.isFinite(currentSettingsRevision) ? currentSettingsRevision : null,
    nextRevision: Object.keys(acceptedControlChanges).length > 0 && !revisionConflict
      ? (Number.isFinite(currentSettingsRevision) ? currentSettingsRevision + 1 : null)
      : Number.isFinite(currentSettingsRevision) ? currentSettingsRevision : null,
    allowedCommands: allowedCommands.size > 0 ? [...allowedCommands] : [...LIFECYCLE_COMMANDS],
    deniedCommands,
    commandAllowed: !commandDenied,
    lockedControls: [...lockedControls],
    changeSet: {
      schema: 'aios.audit-recovery.resume-token.lifecycle-control-change-set.v1',
      requestedBy: changeSetInput.requestedBy || request.operatorId || request.principal?.id || null,
      reason: changeSetInput.reason || request.reason || null,
      expectedRevision: Number.isFinite(expectedSettingsRevision) ? expectedSettingsRevision : null,
      accepted: Object.entries(acceptedControlChanges).map(([key, value]) => ({ key, value })),
      rejected: rejectedControlChanges,
      applied: rejectedControlChanges.length === 0 && Object.keys(acceptedControlChanges).length > 0,
      nextAction: rejectedControlChanges.length > 0
        ? revisionConflict
          ? 'reload_lifecycle_settings_before_update'
          : 'repair_lifecycle_settings_change_set'
        : Object.keys(acceptedControlChanges).length > 0
          ? 'persist_lifecycle_settings_change_set'
          : 'retain_lifecycle_settings'
    },
    autoResumeEnabled,
    scheduleEnabled: scheduleControlEnabled,
    scheduleRequiresApproval,
    approvalGranted,
    allowPastDueSchedule,
    minScheduleDelayMs: MIN_SCHEDULE_DELAY_MS,
    maxScheduleDelayMs,
    configuredMaxScheduleDelayMs: Number.isFinite(configuredMaxDelayMs) ? configuredMaxDelayMs : null,
    proofSubjects: [
      `lifecycle-command:${command}`,
      `settings-revision:${Number.isFinite(currentSettingsRevision) ? currentSettingsRevision : 'unknown'}`,
      `auto-resume:${autoResumeEnabled ? 'enabled' : 'disabled'}`,
      `schedule-policy:${scheduleControlEnabled ? 'enabled' : 'disabled'}`,
      `approval:${approvalGranted ? 'granted' : 'pending'}`
    ],
    nextAction: rejectedControlChanges.length > 0
      ? revisionConflict
        ? 'reload_lifecycle_settings_before_update'
        : 'repair_lifecycle_settings_change_set'
      : command === 'update-settings' && Object.keys(acceptedControlChanges).length > 0
        ? 'persist_lifecycle_settings_change_set'
      : commandDenied
      ? 'select_allowed_lifecycle_command'
      : !autoResumeEnabled && resumeCommandRequested
        ? 'enable_auto_resume_or_use_inspect'
        : scheduleEnabled && !scheduleControlEnabled
          ? 'enable_lifecycle_scheduling'
          : scheduleEnabled && scheduleRequiresApproval && !approvalGranted
            ? 'grant_schedule_resume_approval'
            : 'apply_lifecycle_command'
  };
  const state = !enabled
    ? 'disabled'
    : paused
      ? 'paused'
      : command === 'rotate-token'
        ? 'rotation-required'
      : command === 'update-settings' && Object.keys(acceptedControlChanges).length > 0
        ? 'settings-update-pending'
      : scheduleEnabled && !scheduleDue
        ? 'scheduled'
        : 'enabled';
  const nextAction = errors.length > 0
    ? settingsPolicy.nextAction === 'apply_lifecycle_command'
      ? 'repair_lifecycle_settings'
      : settingsPolicy.nextAction
    : command === 'update-settings'
      ? settingsPolicy.changeSet.nextAction
    : command === 'rotate-token'
      ? 'issue_replacement_resume_token'
      : state === 'disabled'
        ? 'enable_lifecycle_resume'
      : state === 'paused'
        ? 'resume_lifecycle_controls'
      : state === 'scheduled'
        ? 'wait_until_scheduled_resume'
        : 'resume_from_checkpoint';

  if (auditRequired && request.auditSinkOk === false) {
    warnings.push('lifecycle_audit_required_but_sink_degraded');
  }

  return {
    command,
    requestedCommand,
    state,
    enabled,
    paused,
    auditRequired,
    manualApprovalRequired,
    approvalGranted,
    settingsPolicy,
    controlChangeSet: settingsPolicy.changeSet,
    schedule: {
      enabled: scheduleEnabled,
      nextRunAt,
      delayMs,
      due: scheduleDue
    },
    canResumeNow: errors.length === 0 && ![
      'disabled',
      'paused',
      'scheduled',
      'rotation-required',
      'settings-update-pending'
    ].includes(state),
    nextAction,
    errors,
    warnings
  };
}

function normalizePersistedResumeState(request, lifecycle, token, nowMs) {
  const persistedInput = request.persistedState && typeof request.persistedState === 'object'
    ? request.persistedState
    : request.persistence && typeof request.persistence === 'object'
      ? request.persistence
      : request.recoveryState && typeof request.recoveryState === 'object'
        ? request.recoveryState
        : {};
  const snapshotInput = persistedInput.snapshot && typeof persistedInput.snapshot === 'object'
    ? persistedInput.snapshot
    : persistedInput;
  const ledgerInput = Array.isArray(persistedInput.commandLedger)
    ? persistedInput.commandLedger
    : Array.isArray(persistedInput.commands)
      ? persistedInput.commands
      : Array.isArray(snapshotInput.commands)
        ? snapshotInput.commands
        : [];
  const journalInput = Array.isArray(persistedInput.recoveryJournal)
    ? persistedInput.recoveryJournal
    : Array.isArray(persistedInput.journal)
      ? persistedInput.journal
      : Array.isArray(snapshotInput.journal)
        ? snapshotInput.journal
        : [];
  const commandId = String(
    request.commandId
    || request.idempotencyKey
    || persistedInput.commandId
    || `${lifecycle.command}:${token?.tokenId || 'missing-token'}:${token?.checkpointId || 'missing-checkpoint'}`
  );
  const ledger = ledgerInput
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_COMMAND_LEDGER_ENTRIES)
    .map((entry, index) => {
      const updatedAtMs = Date.parse(entry.updatedAt || entry.completedAt || entry.startedAt || entry.timestamp || '');
      const startedAtMs = Date.parse(entry.startedAt || entry.timestamp || '');
      const status = String(entry.status || (entry.completedAt ? 'committed' : 'pending'));

      return {
        id: String(entry.id || entry.commandId || entry.idempotencyKey || `resume-token-command-${index + 1}`),
        command: String(entry.command || entry.type || lifecycle.command),
        status,
        tokenId: entry.tokenId ? String(entry.tokenId) : null,
        checkpointId: entry.checkpointId ? String(entry.checkpointId) : null,
        resultRef: entry.resultRef || entry.resultId || null,
        startedAt: Number.isNaN(startedAtMs) ? null : new Date(startedAtMs).toISOString(),
        updatedAt: Number.isNaN(updatedAtMs) ? null : new Date(updatedAtMs).toISOString(),
        ageMs: Number.isNaN(updatedAtMs) ? null : Math.max(0, nowMs - updatedAtMs)
      };
    });
  const journal = journalInput
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_RECOVERY_JOURNAL_ENTRIES)
    .map((entry, index) => {
      const sequence = Number(entry.sequence ?? entry.version ?? index + 1);
      const recordedAtMs = Date.parse(entry.recordedAt || entry.updatedAt || entry.timestamp || '');
      const stage = String(entry.stage || entry.kind || 'unknown');
      const commandRef = String(entry.commandId || entry.idempotencyKey || commandId);

      return {
        id: String(entry.id || entry.journalId || `resume-token-journal-${index + 1}`),
        sequence: Number.isFinite(sequence) ? sequence : index + 1,
        commandId: commandRef,
        stage,
        durable: entry.durable === true || DURABLE_COMMIT_STAGES.has(stage),
        checksum: entry.checksum || entry.stateChecksum || entry.payloadChecksum || null,
        cursor: entry.cursor || entry.durableCursor || null,
        resultRef: entry.resultRef || entry.payloadRef || entry.stateRef || null,
        recordedAt: Number.isNaN(recordedAtMs) ? null : new Date(recordedAtMs).toISOString(),
        ageMs: Number.isNaN(recordedAtMs) ? null : Math.max(0, nowMs - recordedAtMs)
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
  const matchingCommand = ledger.find((entry) => entry.id === commandId) || null;
  const activeCommand = ledger.find((entry) => (
    ACTIVE_COMMAND_STATUSES.has(entry.status)
    && entry.ageMs !== null
    && entry.ageMs <= RESTART_LOCK_STALE_AFTER_MS
  )) || null;
  const committedReplay = matchingCommand && TERMINAL_COMMAND_STATUSES.has(matchingCommand.status);
  const staleLock = ledger.find((entry) => (
    ACTIVE_COMMAND_STATUSES.has(entry.status)
    && (entry.ageMs === null || entry.ageMs > RESTART_LOCK_STALE_AFTER_MS)
  )) || null;
  const latestJournalEntry = journal[journal.length - 1] || null;
  const commandJournal = journal.filter((entry) => entry.commandId === commandId);
  const latestCommandJournalEntry = commandJournal[commandJournal.length - 1] || null;
  const durableJournalEntry = [...commandJournal].reverse().find((entry) => entry.durable) || null;
  const snapshotTokenId = snapshotInput.tokenId || snapshotInput.resumeTokenId || snapshotInput.token?.tokenId || null;
  const snapshotCheckpointId = snapshotInput.checkpointId || snapshotInput.token?.checkpointId || null;
  const snapshotVersion = Number(snapshotInput.version ?? snapshotInput.sequence ?? persistedInput.version ?? 0);
  const durableCursor = snapshotInput.cursor || persistedInput.cursor || persistedInput.durableCursor || null;
  const snapshotChecksum = snapshotInput.checksum || snapshotInput.stateChecksum || persistedInput.checksum || null;
  const writeBarrierInput = persistedInput.writeBarrier && typeof persistedInput.writeBarrier === 'object'
    ? persistedInput.writeBarrier
    : snapshotInput.writeBarrier && typeof snapshotInput.writeBarrier === 'object'
      ? snapshotInput.writeBarrier
      : {};
  const writeBarrierSequence = Number(writeBarrierInput.sequence ?? writeBarrierInput.fencingToken ?? snapshotVersion);
  const writeBarrierAcknowledgedSequence = Number(writeBarrierInput.acknowledgedSequence ?? writeBarrierInput.ackSequence);
  const writeBarrierRequired = writeBarrierInput.required === true || Boolean(writeBarrierInput.ref || writeBarrierInput.checksum);
  const writeBarrierOpen = !writeBarrierRequired
    || (
      writeBarrierInput.closed !== true
      && (!Number.isFinite(writeBarrierAcknowledgedSequence)
        || !Number.isFinite(writeBarrierSequence)
        || writeBarrierAcknowledgedSequence >= writeBarrierSequence)
    );
  const snapshotShape = {
    hasToken: Boolean(snapshotTokenId),
    hasCheckpoint: Boolean(snapshotCheckpointId),
    hasCursor: Boolean(durableCursor),
    hasChecksum: Boolean(snapshotChecksum),
    hasJournal: journal.length > 0
  };
  const errors = [];
  const warnings = [];

  if (Object.keys(persistedInput).length === 0) {
    warnings.push('persisted_state_absent');
  }
  if (snapshotTokenId && token?.tokenId && String(snapshotTokenId) !== String(token.tokenId)) {
    errors.push('persisted_state_token_mismatch');
  }
  if (snapshotCheckpointId && token?.checkpointId && String(snapshotCheckpointId) !== String(token.checkpointId)) {
    errors.push('persisted_state_checkpoint_mismatch');
  }
  if (activeCommand && activeCommand.id !== commandId) {
    errors.push('persisted_command_active_lock');
  }
  if (staleLock) {
    warnings.push('persisted_command_stale_lock_recoverable');
  }
  if (!Number.isFinite(snapshotVersion) || snapshotVersion < 0) {
    errors.push('persisted_state_version_invalid');
  }
  if (writeBarrierRequired && !writeBarrierOpen) {
    errors.push('persisted_state_write_barrier_closed');
  }
  if (writeBarrierRequired && !writeBarrierInput.ref && !writeBarrierInput.checksum) {
    errors.push('persisted_state_write_barrier_ref_missing');
  }
  if (latestJournalEntry && Number.isFinite(snapshotVersion) && latestJournalEntry.sequence < snapshotVersion) {
    warnings.push('persisted_state_journal_lags_snapshot');
  }
  if (journal.length > 0 && !latestJournalEntry?.durable) {
    warnings.push('persisted_state_latest_journal_not_durable');
  }
  if (snapshotVersion > 0 && !durableCursor && !durableJournalEntry) {
    warnings.push('persisted_state_durable_cursor_missing');
  }

  const status = committedReplay
    ? 'idempotent-replay'
    : errors.length > 0
      ? 'blocked'
      : staleLock
        ? 'recovering'
        : durableCursor || durableJournalEntry || snapshotVersion > 0 || ledger.length > 0
          ? 'restart-safe'
          : 'volatile';
  const recoveryPath = committedReplay
    ? 'return-cached-result'
    : staleLock
      ? 'resume-from-stale-lock'
      : durableJournalEntry
        ? 'resume-from-durable-journal'
        : durableCursor
          ? 'resume-from-durable-cursor'
          : snapshotVersion > 0
            ? 'resume-from-snapshot-version'
            : 'start-new-command';
  const deterministicOutcome = {
    schema: 'aios.audit-recovery.resume-token.command-outcome.v1',
    commandId,
    status: committedReplay
      ? 'already-applied'
      : errors.length > 0
        ? 'blocked'
        : activeCommand
          ? 'locked'
          : staleLock
            ? 'recoverable-lock'
            : 'admissible',
    resultRef: matchingCommand?.resultRef || durableJournalEntry?.resultRef || null,
    replayResultFrom: committedReplay
      ? 'command-ledger'
      : durableJournalEntry
        ? 'recovery-journal'
        : null,
    sideEffectsAllowed: !committedReplay && errors.length === 0 && !activeCommand,
    proofSubjects: [
      `command:${commandId}`,
      `snapshot:${Number.isFinite(snapshotVersion) ? snapshotVersion : 'invalid'}`,
      `journal:${latestCommandJournalEntry?.id || 'none'}`,
      `barrier:${writeBarrierOpen ? 'open' : 'closed'}`
    ]
  };

  return {
    schema: 'aios.audit-recovery.resume-token.persisted-state.v1',
    status,
    commandId,
    commandAlreadyApplied: Boolean(committedReplay),
    lastAppliedCommandId: persistedInput.lastAppliedCommandId || snapshotInput.lastAppliedCommandId || null,
    durableCursor,
    recoveryPath,
    deterministicOutcome,
    snapshot: {
      version: Number.isFinite(snapshotVersion) ? snapshotVersion : null,
      tokenId: snapshotTokenId ? String(snapshotTokenId) : null,
      checkpointId: snapshotCheckpointId ? String(snapshotCheckpointId) : null,
      checksum: snapshotChecksum,
      shape: snapshotShape,
      updatedAt: toIsoString(snapshotInput.updatedAt || persistedInput.updatedAt || nowMs, nowMs)
    },
    writeBarrier: {
      required: writeBarrierRequired,
      open: writeBarrierOpen,
      ref: writeBarrierInput.ref || writeBarrierInput.barrierRef || null,
      sequence: Number.isFinite(writeBarrierSequence) ? writeBarrierSequence : null,
      acknowledgedSequence: Number.isFinite(writeBarrierAcknowledgedSequence)
        ? writeBarrierAcknowledgedSequence
        : null,
      checksum: writeBarrierInput.checksum || null,
      nextAction: writeBarrierOpen
        ? 'persist_under_open_write_barrier'
        : 'recover_or_acknowledge_persisted_write_barrier'
    },
    journal: {
      limit: MAX_RECOVERY_JOURNAL_ENTRIES,
      count: journal.length,
      latest: latestJournalEntry,
      latestForCommand: latestCommandJournalEntry,
      durableForCommand: durableJournalEntry,
      entries: journal
    },
    ledger: {
      limit: MAX_COMMAND_LEDGER_ENTRIES,
      count: ledger.length,
      latest: ledger[ledger.length - 1] || null,
      matchingCommand,
      activeCommand,
      staleLock,
      entries: ledger
    },
    restart: {
      staleAfterMs: RESTART_LOCK_STALE_AFTER_MS,
      safeToReplay: errors.length === 0 && !activeCommand && writeBarrierOpen,
      recoveryPath,
      nextAction: committedReplay
        ? 'return_cached_resume_result'
        : errors.length > 0
          ? 'repair_persisted_resume_state'
          : staleLock
            ? 'recover_stale_resume_command'
            : 'persist_resume_command_then_continue'
    },
    errors,
    warnings
  };
}

function normalizeResumeLease(request, lifecycle, token, clientRuntime, persistedState, tenantBoundary, nowMs) {
  const leaseInput = request.resumeLease && typeof request.resumeLease === 'object'
    ? request.resumeLease
    : request.lease && typeof request.lease === 'object'
      ? request.lease
      : request.executionLease && typeof request.executionLease === 'object'
        ? request.executionLease
        : {};
  const requestedOwner = String(
    leaseInput.ownerId
    || leaseInput.holderId
    || clientRuntime.sessionId
    || tenantBoundary.principal.id
    || 'hosted-kernel'
  );
  const holderId = leaseInput.holderId || leaseInput.ownerId || null;
  const leaseIssuedAt = toIsoString(leaseInput.issuedAt || leaseInput.acquiredAt || nowMs, nowMs);
  const issuedAtMs = Date.parse(leaseIssuedAt);
  const leaseExpiresAtMs = Date.parse(leaseInput.expiresAt || '');
  const expiresAtMs = Number.isNaN(leaseExpiresAtMs)
    ? issuedAtMs + RESUME_LEASE_TTL_MS
    : leaseExpiresAtMs;
  const fencingToken = Number(leaseInput.fencingToken ?? leaseInput.sequence ?? persistedState.snapshot.version ?? 0);
  const minFencingToken = Number(leaseInput.minFencingToken ?? persistedState.snapshot.version ?? 0);
  const operationRequiresLease = ['resume', 'rotate-token'].includes(lifecycle.command)
    || (lifecycle.command === 'schedule-resume' && lifecycle.schedule.due);
  const present = Object.keys(leaseInput).length > 0 || Boolean(clientRuntime.sessionId);
  const errors = [];
  const warnings = [];

  if (operationRequiresLease && !present) {
    errors.push('resume_lease_missing');
  }
  if (holderId && String(holderId) !== requestedOwner) {
    errors.push('resume_lease_owner_mismatch');
  }
  if (expiresAtMs <= nowMs) {
    errors.push('resume_lease_expired');
  }
  if (!Number.isFinite(fencingToken) || fencingToken < minFencingToken) {
    errors.push('resume_lease_fencing_token_stale');
  }
  if (persistedState.ledger.activeCommand && persistedState.ledger.activeCommand.id !== persistedState.commandId) {
    errors.push('resume_lease_conflicts_with_active_command');
  }
  if (expiresAtMs - nowMs <= RESUME_LEASE_RENEW_WITHIN_MS && expiresAtMs > nowMs) {
    warnings.push('resume_lease_renewal_due');
  }
  if (!holderId && present) {
    warnings.push('resume_lease_holder_inferred');
  }

  const state = errors.length > 0
    ? 'blocked'
    : !operationRequiresLease
      ? 'not-required'
      : warnings.includes('resume_lease_renewal_due')
        ? 'renewal-required'
        : 'held';

  return {
    schema: 'aios.audit-recovery.resume-token.lease.v1',
    state,
    required: operationRequiresLease,
    present,
    holderId: holderId ? String(holderId) : requestedOwner,
    requestedOwner,
    tokenId: token?.tokenId || null,
    checkpointId: token?.checkpointId || null,
    commandId: persistedState.commandId,
    fencing: {
      token: Number.isFinite(fencingToken) ? fencingToken : null,
      minimum: Number.isFinite(minFencingToken) ? minFencingToken : null,
      source: leaseInput.fencingToken !== undefined || leaseInput.sequence !== undefined
        ? 'request'
        : 'persisted-snapshot'
    },
    issuedAt: leaseIssuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlMs: Math.max(0, expiresAtMs - issuedAtMs),
    remainingMs: Math.max(0, expiresAtMs - nowMs),
    renewal: {
      renewWithinMs: RESUME_LEASE_RENEW_WITHIN_MS,
      required: warnings.includes('resume_lease_renewal_due'),
      nextAction: warnings.includes('resume_lease_renewal_due')
        ? 'renew_resume_execution_lease'
        : 'retain_current_resume_execution_lease'
    },
    canProceed: errors.length === 0 && (!operationRequiresLease || present),
    nextAction: errors.length > 0
      ? errors.includes('resume_lease_expired')
        ? 'acquire_fresh_resume_execution_lease'
        : 'repair_resume_execution_lease'
      : warnings.includes('resume_lease_renewal_due')
        ? 'renew_resume_execution_lease'
        : operationRequiresLease
          ? 'commit_resume_under_execution_lease'
          : 'continue_without_execution_lease',
    errors,
    warnings
  };
}

function buildTimeline(now, validation, dependencyHealth, retryState, historySnapshots, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease) {
  const nowMs = Date.parse(now);
  const historyDigest = buildHistorySnapshotDigest(historySnapshots, nowMs);
  const timeline = historySnapshots.map((snapshot) => ({
    at: snapshot.timestamp,
    kind: 'history-snapshot',
    status: snapshot.status,
    checkpointId: snapshot.checkpointId,
    tokenId: snapshot.tokenId,
    failureCodes: snapshot.failureCodes
  }));

  timeline.push({
    at: now,
    kind: 'history-digest',
    status: historyDigest.recentWindow.regression
      ? 'regression-detected'
      : historyDigest.currentStreak.kind === 'failure'
        ? 'failure-streak'
        : historyDigest.currentStreak.kind === 'success'
          ? 'success-streak'
          : 'empty',
    snapshotCount: historyDigest.totalSnapshots,
    currentStreak: historyDigest.currentStreak,
    recentFailureRate: historyDigest.recentWindow.failureRate,
    latestFailureAt: historyDigest.latestFailureAt,
    repeatedFailureCodes: historyDigest.repeatedFailureCodes,
    nextAction: historyDigest.recentWindow.regression
      ? 'review_recent_resume_regression'
      : historyDigest.currentStreak.kind === 'failure'
        ? 'prioritize_latest_resume_failure'
        : 'retain_history_for_audit_export'
  });

  timeline.push({
    at: now,
    kind: 'current-validation',
    status: validation.valid ? 'token-valid' : 'token-invalid',
    failureCodes: validation.errors
  });

  for (const dependency of dependencyHealth) {
    timeline.push({
      at: now,
      kind: 'dependency-health',
      status: dependency.ok === false ? 'unhealthy' : 'healthy',
      dependency: dependency.name,
      required: dependency.required !== false
    });
  }

  timeline.push({
    at: now,
    kind: 'lifecycle-control',
    status: lifecycle.state,
    command: lifecycle.command,
    policy: {
      commandAllowed: lifecycle.settingsPolicy.commandAllowed,
      autoResumeEnabled: lifecycle.settingsPolicy.autoResumeEnabled,
      scheduleEnabled: lifecycle.settingsPolicy.scheduleEnabled,
      scheduleRequiresApproval: lifecycle.settingsPolicy.scheduleRequiresApproval,
      nextAction: lifecycle.settingsPolicy.nextAction
    },
    nextAction: lifecycle.nextAction,
    failureCodes: lifecycle.errors
  });

  if (lifecycle.schedule.enabled && lifecycle.schedule.nextRunAt) {
    timeline.push({
      at: lifecycle.schedule.nextRunAt,
      kind: 'scheduled-resume',
      status: lifecycle.schedule.due ? 'due' : 'pending',
      delayMs: lifecycle.schedule.delayMs,
      nextAction: lifecycle.schedule.due ? 'resume_from_checkpoint' : 'wait_until_scheduled_resume'
    });
  }

  if (retryState.retryable) {
    timeline.push({
      at: now,
      kind: 'retry-window',
      status: 'scheduled',
      backoffMs: retryState.backoffMs,
      nextAction: retryState.nextAction
    });
  }

  for (const provider of providerContract.providers) {
    timeline.push({
      at: now,
      kind: 'provider-contract',
      status: provider.available && provider.missingCapabilities.length === 0 && provider.negotiation.accepted
        ? 'negotiated'
        : 'blocked',
      providerId: provider.id,
      providerType: provider.type,
      missingCapabilities: provider.missingCapabilities,
      negotiationAccepted: provider.negotiation.accepted,
      negotiationReasons: provider.negotiation.blockingReasons,
      requestedContractVersion: provider.negotiation.requestedContractVersion,
      requestedHandoffMode: provider.negotiation.requestedHandoffMode,
      writeBarrierOpen: provider.negotiation.writeBarrierOpen,
      sequenceDrift: provider.negotiation.sequenceDrift,
      capabilityCoverage: provider.capabilityFit.coverage,
      handoffCommitState: provider.handoffCommit.state,
      handoffCommitReady: provider.handoffCommit.ready,
      handoffCommitBlockers: provider.handoffCommit.blockers,
      handoffCommitPayloadRef: provider.handoffCommit.payload.ref,
      handoffCommitReceiptRef: provider.handoffCommit.receipt.ref,
      serviceCount: provider.services.length,
      serviceBlockingCount: provider.serviceBlockingCount,
      syncState: provider.sync.state
    });
  }

  timeline.push({
    at: now,
    kind: 'external-handoff',
    status: providerContract.handoff.state,
    providerId: providerContract.handoff.targetProviderId,
    manifestId: providerContract.handoff.manifest.id,
    transferable: providerContract.handoff.manifest.transferable,
    handoffCommitState: providerContract.handoff.manifest.handoffCommit?.state || null,
    handoffCommitReady: providerContract.handoff.manifest.handoffCommit?.ready ?? null,
    handoffCommitBlockers: providerContract.handoff.manifest.handoffCommit?.blockers || [],
    serviceRefs: providerContract.handoff.manifest.serviceRefs.map((service) => service.id),
    nextAction: providerContract.handoff.nextAction
  });

  timeline.push({
    at: now,
    kind: 'client-runtime',
    status: clientRuntime.canReleaseControl ? 'ready' : 'blocked',
    sessionId: clientRuntime.sessionId,
    route: clientRuntime.route,
    unflushedMutationCount: clientRuntime.unflushedMutationCount,
    workflowActionCount: clientRuntime.workflowActions.length,
    unresolvedRequiredActionCount: clientRuntime.unresolvedRequiredActionCount,
    stateExportTargets: clientRuntime.stateExport.targets,
    handoffTicketId: clientRuntime.handoffTicket.id,
    failureCodes: clientRuntime.errors,
    nextAction: clientRuntime.nextAction
  });

  timeline.push({
    at: now,
    kind: 'workflow-handoff',
    status: workflowHandoff.state,
    destination: workflowHandoff.destination.kind,
    providerId: workflowHandoff.destination.providerId,
    clientHandoffTicketId: workflowHandoff.clientHandoffTicket.id,
    requiredClientActionCount: workflowHandoff.requiredClientActions.length,
    stateExportReady: workflowHandoff.stateExport.ready,
    blockerCount: workflowHandoff.blockers.length,
    nextAction: workflowHandoff.nextAction
  });

  timeline.push({
    at: now,
    kind: 'tenant-boundary',
    status: tenantBoundary.errors.length > 0 ? 'blocked' : 'scoped',
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principalId: tenantBoundary.principal.id,
    missingPermissions: tenantBoundary.principal.missingPermissions,
    providerScopeViolations: tenantBoundary.isolation.providerScopeViolations,
    selectedWorkspaceLaneId: tenantBoundary.isolation.selectedWorkspaceLaneId,
    checkpointAllowedByLane: tenantBoundary.isolation.checkpointAllowedByLane,
    crossWorkspaceRequested: tenantBoundary.isolation.crossWorkspaceRequested,
    crossWorkspaceAllowed: tenantBoundary.isolation.crossWorkspaceAllowed,
    failureCodes: tenantBoundary.errors,
    nextAction: tenantBoundary.auditHandoff.nextAction
  });

  timeline.push({
    at: now,
    kind: 'persisted-state',
    status: persistedState.status,
    commandId: persistedState.commandId,
      durableCursor: persistedState.durableCursor,
      snapshotVersion: persistedState.snapshot.version,
      recoveryPath: persistedState.recoveryPath,
      writeBarrierOpen: persistedState.writeBarrier.open,
      journalEntryCount: persistedState.journal.count,
      failureCodes: persistedState.errors,
      nextAction: persistedState.restart.nextAction
  });

  timeline.push({
    at: now,
    kind: 'resume-execution-lease',
    status: resumeLease.state,
    holderId: resumeLease.holderId,
    commandId: resumeLease.commandId,
    checkpointId: resumeLease.checkpointId,
    fencingToken: resumeLease.fencing.token,
    expiresAt: resumeLease.expiresAt,
    failureCodes: resumeLease.errors,
    nextAction: resumeLease.nextAction
  });

  return timeline.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function buildActionableErrors(validation, dependencyHealth, retryState, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, resumeGuard, mailchimpRuntimeGate = null) {
  const errors = [];

  for (const code of lifecycle.errors) {
    errors.push({
      code,
      severity: code === 'lifecycle_schedule_too_soon' ? 'recoverable' : 'blocking',
      action: lifecycle.nextAction
    });
  }

  for (const code of validation.errors) {
    errors.push({
      code,
      severity: code === 'resume_token_expired' ? 'recoverable' : 'blocking',
      action: code === 'resume_token_expired'
        ? 'request_fresh_resume_token'
        : 'halt_resume_and_reissue_token'
    });
  }

  for (const dependency of dependencyHealth) {
    if (dependency.ok === false) {
      errors.push({
        code: `dependency_${dependency.name}_unhealthy`,
        severity: dependency.required === false ? 'degraded' : 'blocking',
        action: dependency.required === false
          ? 'continue_with_degraded_audit_trail'
          : retryState.nextAction
      });
    }
  }

  for (const provider of providerContract.providers) {
    if (provider.required && provider.available === false) {
      errors.push({
        code: `provider_${provider.id}_unavailable`,
        severity: 'blocking',
        action: 'repair_provider_contract'
      });
    }
    if (provider.required && provider.missingCapabilities.length > 0) {
      errors.push({
        code: `provider_${provider.id}_capability_mismatch`,
        severity: 'blocking',
        action: 'negotiate_required_provider_capabilities'
      });
    }
    if (provider.required && provider.negotiation.accepted === false) {
      for (const reason of provider.negotiation.blockingReasons) {
        errors.push({
          code: `provider_${provider.id}_${reason}`,
          severity: reason === 'provider_contract_remote_sequence_ahead'
            || reason === 'provider_contract_write_not_acknowledged'
            ? 'recoverable'
            : 'blocking',
          action: provider.negotiation.nextAction
        });
      }
    }
    if (provider.required && provider.handoffCommit.ready === false) {
      for (const blocker of provider.handoffCommit.blockers) {
        errors.push({
          code: `provider_${provider.id}_${blocker}`,
          severity: blocker === 'handoff_commit_not_acknowledged' || blocker === 'handoff_commit_stale'
            ? 'recoverable'
            : 'blocking',
          action: provider.handoffCommit.nextAction
        });
      }
    }
    if (provider.required && provider.sync.state === 'conflict') {
      errors.push({
        code: `provider_${provider.id}_sync_conflict`,
        severity: 'blocking',
        action: 'resolve_external_handoff_sync'
      });
    }
    for (const service of provider.services) {
      if (service.required && service.available === false) {
        errors.push({
          code: `provider_${provider.id}_service_${service.id}_unavailable`,
          severity: 'blocking',
          action: 'repair_required_provider_service_contract'
        });
      }
      if (service.required && service.missingCapabilities.length > 0) {
        errors.push({
          code: `provider_${provider.id}_service_${service.id}_capability_mismatch`,
          severity: 'blocking',
          action: 'negotiate_required_provider_service_capabilities'
        });
      }
      if (service.required && service.sync.state === 'conflict') {
        errors.push({
          code: `provider_${provider.id}_service_${service.id}_sync_conflict`,
          severity: 'blocking',
          action: 'resolve_provider_service_sync_conflict'
        });
      }
    }
  }

  if (providerContract.handoff.enabled && providerContract.handoff.state !== 'ready') {
    errors.push({
      code: `external_handoff_${providerContract.handoff.state.replaceAll('-', '_')}`,
      severity: providerContract.handoff.state === 'sync-stale' ? 'degraded' : 'blocking',
      action: providerContract.handoff.nextAction
    });
  }

  if (mailchimpRuntimeGate?.requested && !mailchimpRuntimeGate.ready) {
    for (const blocker of mailchimpRuntimeGate.blockers) {
      errors.push({
        code: blocker,
        severity: blocker.includes('acknowledgement') || blocker.includes('client_state')
          ? 'recoverable'
          : 'blocking',
        action: mailchimpRuntimeGate.nextAction
      });
    }
  }

  for (const code of clientRuntime.errors) {
    errors.push({
      code,
      severity: 'blocking',
      action: clientRuntime.nextAction
    });
  }

  if (workflowHandoff.blockers.length > 0 && workflowHandoff.blockers.some((code) => code.startsWith('external_handoff_'))) {
    errors.push({
      code: 'workflow_handoff_destination_blocked',
      severity: 'blocking',
      action: workflowHandoff.nextAction
    });
  }

  for (const code of persistedState.errors) {
    errors.push({
      code,
      severity: code === 'persisted_command_active_lock' ? 'recoverable' : 'blocking',
      action: persistedState.restart.nextAction
    });
  }

  for (const code of resumeLease.errors) {
    errors.push({
      code,
      severity: code === 'resume_lease_expired' ? 'recoverable' : 'blocking',
      action: resumeLease.nextAction
    });
  }

  for (const code of resumeGuard.blockers) {
    errors.push({
      code,
      severity: code === 'resume_guard_expired'
        || code === 'resume_guard_handoff_not_transferable'
        || code === 'resume_claim_conflict'
        ? 'recoverable'
        : 'blocking',
      action: resumeGuard.nextAction
    });
  }

  for (const code of tenantBoundary.errors) {
    const action = code === 'tenant_boundary_workspace_lane_missing'
      ? 'select_allowed_workspace_lane'
      : code === 'tenant_boundary_checkpoint_outside_workspace_lane'
        ? 'request_checkpoint_scoped_resume_token'
        : code === 'tenant_boundary_workspace_lane_handoff_denied'
          ? 'route_resume_through_hosted_kernel'
          : code === 'tenant_boundary_token_workspace_mismatch'
            ? 'escalate_cross_workspace_resume_boundary'
            : tenantBoundary.auditHandoff.nextAction;
    errors.push({
      code,
      severity: 'blocking',
      action
    });
  }

  return errors;
}

function buildOperationalRecoveryPlan(actionableErrors, domains, retryState, workflowHandoff, providerContract, resumeLease, now) {
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'blocking');
  const recoverableErrors = actionableErrors.filter((error) => error.severity === 'recoverable');
  const degradedErrors = actionableErrors.filter((error) => error.severity === 'degraded');
  const impairedDomains = domains.filter((domain) => domain.severity !== 'healthy');
  const failureBuckets = {
    validation: actionableErrors.filter((error) => error.code.startsWith('resume_token_')),
    dependency: actionableErrors.filter((error) => error.code.startsWith('dependency_')),
    provider: actionableErrors.filter((error) => error.code.startsWith('provider_') || error.code.startsWith('external_handoff_')),
    client: actionableErrors.filter((error) => error.code.startsWith('client_runtime_') || error.code.startsWith('workflow_')),
    persistence: actionableErrors.filter((error) => error.code.startsWith('persisted_') || error.code.startsWith('resume_lease_') || error.code.startsWith('resume_guard_')),
    boundary: actionableErrors.filter((error) => error.code.startsWith('tenant_boundary_') || error.code === 'preview_acceptance_required')
  };
  const retryableCodes = recoverableErrors.map((error) => error.code);
  const firstRetryable = recoverableErrors[0] || (blockingErrors.length > 0 && retryState.retryable ? blockingErrors[0] : null);
  const retryBlockedBy = blockingErrors
    .filter((error) => !retryableCodes.includes(error.code))
    .map((error) => error.code);
  const retryAfterMs = firstRetryable && retryState.retryable && retryBlockedBy.length === 0
    ? retryState.backoffMs
    : 0;
  const remediationPhases = Object.entries(failureBuckets)
    .filter(([, bucketErrors]) => bucketErrors.length > 0)
    .map(([domain, bucketErrors], index) => {
      const primary = bucketErrors[0];
      const hasBlocking = bucketErrors.some((error) => error.severity === 'blocking');
      const hasRecoverable = bucketErrors.some((error) => error.severity === 'recoverable');

      return {
        id: `resume-token-recovery-${domain}`,
        order: index + 1,
        domain,
        state: hasBlocking ? 'blocked' : hasRecoverable ? 'retryable' : 'degraded',
        primaryCode: primary.code,
        reasonCodes: [...new Set(bucketErrors.map((error) => error.code))],
        actions: [...new Set(bucketErrors.map((error) => error.action))],
        nextAction: primary.action,
        requiresOperator: hasBlocking || domain === 'boundary',
        canRetryAfterPhase: hasRecoverable && !hasBlocking
      };
    });
  const nextPhase = remediationPhases.find((phase) => phase.state === 'blocked')
    || remediationPhases.find((phase) => phase.state === 'retryable')
    || remediationPhases[0]
    || null;
  const degradedAdmitted = blockingErrors.length === 0 && (
    degradedErrors.length > 0
    || impairedDomains.some((domain) => domain.severity === 'degraded')
    || providerContract.handoff.state === 'sync-stale'
  );

  return {
    schema: 'aios.audit-recovery.resume-token.operational-recovery-plan.v1',
    generatedAt: now,
    planId: `${surfaceId}:recovery-plan:${workflowHandoff.clientHandoffTicket.id}`,
    state: blockingErrors.length > 0
      ? 'blocked'
      : retryAfterMs > 0
        ? 'retry-scheduled'
        : degradedAdmitted
          ? 'degraded-admitted'
          : actionableErrors.length > 0
            ? 'operator-attention'
            : 'clear',
    nextPhase,
    remediationPhases,
    retryGate: {
      eligible: retryAfterMs > 0,
      attempts: retryState.attempts,
      maxAttempts: retryState.maxAttempts,
      blockedBy: retryBlockedBy,
      backoffMs: retryAfterMs,
      retryAt: retryAfterMs > 0 ? new Date(Date.parse(now) + retryAfterMs).toISOString() : null,
      nextAction: retryAfterMs > 0
        ? retryState.nextAction
        : retryState.retryable
          ? 'repair_blocking_failures_before_retry'
          : 'escalate_manual_recovery'
    },
    degradedGate: {
      admitted: degradedAdmitted,
      reasonCodes: [
        ...degradedErrors.map((error) => error.code),
        ...impairedDomains.filter((domain) => domain.severity === 'degraded').flatMap((domain) => domain.warnings)
      ],
      destination: workflowHandoff.destination.kind,
      providerId: workflowHandoff.destination.providerId,
      leaseRequired: resumeLease.required,
      nextAction: degradedAdmitted
        ? workflowHandoff.nextAction
        : 'do_not_enter_degraded_resume_mode'
    },
    proofSubjects: [
      `workflow-ticket:${workflowHandoff.clientHandoffTicket.id}`,
      `handoff:${workflowHandoff.state}`,
      `provider:${providerContract.selectedProviderId || 'hosted-kernel'}`,
      `lease:${resumeLease.state}`,
      `phase:${nextPhase?.id || 'none'}`
    ],
    operatorAction: nextPhase?.nextAction || (retryAfterMs > 0 ? retryState.nextAction : 'resume_health_clear')
  };
}

function normalizePreviewAcceptance(request, validation, lifecycle, providerContract, token, now) {
  const previewInput = request.preview && typeof request.preview === 'object' ? request.preview : {};
  const acceptanceInput = request.acceptance && typeof request.acceptance === 'object'
    ? request.acceptance
    : previewInput.acceptance && typeof previewInput.acceptance === 'object'
      ? previewInput.acceptance
      : {};
  const checkpointPreviewHandoff = normalizeCheckpointPreviewHandoff(request, token, providerContract, now);
  const affectedScopes = [
    token?.scope || 'unknown-scope',
    token?.checkpointId ? `checkpoint:${token.checkpointId}` : 'checkpoint:unknown',
    providerContract.handoff.enabled
      ? `provider:${providerContract.handoff.targetProviderId || 'unselected'}`
      : 'kernel:local-resume'
  ];
  const warningCodes = [
    ...validation.warnings,
    ...lifecycle.warnings,
    ...(providerContract.sync.degraded ? ['provider_sync_degraded'] : []),
    ...(providerContract.handoff.state === 'sync-stale' ? ['external_handoff_sync_stale'] : []),
    ...providerContract.mailchimp.warningCodes
  ];
  const required = acceptanceInput.required === true
    || previewInput.acceptanceRequired === true
    || lifecycle.manualApprovalRequired === true
    || checkpointPreviewHandoff.present;
  const accepted = acceptanceInput.accepted === true
    || request.previewAccepted === true
    || checkpointPreviewHandoff.accepted;
  const acceptedAt = accepted
    ? toIsoString(
        acceptanceInput.acceptedAt
        || request.previewAcceptedAt
        || checkpointPreviewHandoff.acceptance.acceptedAt
        || now,
        now
      )
    : null;
  const acceptedBy = accepted
    ? String(
        acceptanceInput.acceptedBy
        || request.previewAcceptedBy
        || checkpointPreviewHandoff.acceptance.acceptedBy
        || 'unknown-operator'
      )
    : null;
  const previewId = String(
    previewInput.id
    || checkpointPreviewHandoff.handoffId
    || `${surfaceId}:preview:${token?.tokenId || 'missing-token'}`
  );
  const mailchimpManifest = providerContract.handoff.manifest.mailchimp;
  const mailchimpAcceptanceRequired = Boolean(mailchimpManifest?.requested && mailchimpManifest.acknowledgements.missing.length > 0);
  const acceptanceRequired = required || mailchimpAcceptanceRequired;
  const acceptanceBlocking = acceptanceRequired && (!accepted || checkpointPreviewHandoff.blockers.length > 0);

  return {
    schema: 'aios.audit-recovery.resume-token.preview-acceptance.v1',
    preview: {
      id: previewId,
      generatedAt: now,
      title: token?.checkpointId
        ? `Resume checkpoint ${token.checkpointId}`
        : 'Resume checkpoint unavailable',
      intent: providerContract.handoff.enabled
        ? mailchimpManifest?.requested
          ? 'mailchimp_resume_handoff'
          : 'external_provider_handoff'
        : lifecycle.schedule.enabled
          ? 'scheduled_kernel_resume'
          : 'hosted_kernel_resume',
      affectedScopes,
      warningCodes,
      token: {
        tokenId: token?.tokenId || null,
        checkpointId: token?.checkpointId || null,
        scope: token?.scope || null,
        expiresAt: validation.expiresAt
      }
    },
    mailchimp: mailchimpManifest
      ? {
          requested: mailchimpManifest.requested,
          state: mailchimpManifest.state,
          target: mailchimpManifest.target,
          mode: mailchimpManifest.mode,
          consentBoundary: mailchimpManifest.consentBoundary,
          acknowledgements: mailchimpManifest.acknowledgements,
          blockers: mailchimpManifest.blockers,
          warnings: mailchimpManifest.warnings,
          nextAction: mailchimpManifest.nextAction,
          proofSubjects: mailchimpManifest.proofSubjects
        }
      : {
          requested: false,
          state: 'not-requested',
          target: null,
          mode: 'preview-only',
          consentBoundary: null,
          acknowledgements: { required: [], accepted: [], missing: [] },
          blockers: [],
          warnings: [],
          nextAction: 'retain_kernel_resume_contract',
          proofSubjects: []
        },
    checkpointPreviewHandoff,
    acceptance: {
      required: acceptanceRequired,
      accepted,
      state: !acceptanceRequired
        ? 'not-required'
        : checkpointPreviewHandoff.blockers.length > 0
          ? 'checkpoint-preview-handoff-blocked'
        : accepted
          ? 'accepted'
        : mailchimpAcceptanceRequired
          ? 'awaiting-mailchimp-acknowledgement'
          : 'awaiting-acceptance',
      acceptedAt,
      acceptedBy,
      blocking: acceptanceBlocking,
      requiredAcknowledgements: mailchimpManifest?.acknowledgements.required || [],
      missingAcknowledgements: accepted && checkpointPreviewHandoff.blockers.length === 0
        ? []
        : [
            ...(mailchimpManifest?.acknowledgements.missing || []),
            ...checkpointPreviewHandoff.blockers
          ],
      nextAction: acceptanceBlocking
        ? checkpointPreviewHandoff.blockers.length > 0
          ? checkpointPreviewHandoff.clientStateAdoption.nextAction
          : mailchimpAcceptanceRequired
          ? 'collect_mailchimp_preview_acceptance'
          : 'present_resume_preview_for_acceptance'
        : 'continue_resume_readiness_checks'
    }
  };
}

function buildValidationSummary(validation, lifecycle, dependencyHealth, providerContract, previewAcceptance, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, resumeGuard) {
  const checks = [
    {
      id: 'resume-token',
      label: 'Resume token',
      status: validation.valid ? 'pass' : 'fail',
      codes: validation.errors,
      warnings: validation.warnings
    },
    {
      id: 'lifecycle-controls',
      label: 'Lifecycle controls',
      status: lifecycle.errors.length === 0 ? 'pass' : 'fail',
      codes: lifecycle.errors,
      warnings: lifecycle.warnings
    },
    {
      id: 'dependencies',
      label: 'Kernel dependencies',
      status: dependencyHealth.some((dependency) => dependency.required && dependency.ok === false)
        ? 'fail'
        : dependencyHealth.some((dependency) => dependency.ok === false)
          ? 'warn'
          : 'pass',
      codes: dependencyHealth
        .filter((dependency) => dependency.ok === false)
        .map((dependency) => `dependency_${dependency.name}_unhealthy`),
      warnings: dependencyHealth
        .filter((dependency) => dependency.ok === false && dependency.required === false)
        .map((dependency) => `dependency_${dependency.name}_degraded`)
    },
    {
      id: 'provider-contract',
      label: 'Provider contract',
      status: providerContract.blockingProviderCount > 0 || providerContract.sync.conflict ? 'fail' : providerContract.sync.degraded ? 'warn' : 'pass',
      codes: providerContract.providers
        .filter((provider) => provider.required && (
          provider.available === false
          || provider.missingCapabilities.length > 0
          || provider.negotiation.accepted === false
          || provider.handoffCommit.ready === false
          || provider.serviceBlockingCount > 0
          || provider.sync.state === 'conflict'
        ))
        .flatMap((provider) => provider.handoffCommit.ready === false
          ? provider.handoffCommit.blockers.map((blocker) => `provider_${provider.id}_${blocker}`)
          : provider.mailchimp.requested && provider.mailchimp.ready === false
          ? provider.mailchimp.blockers.map((blocker) => `provider_${provider.id}_${blocker}`)
          : provider.negotiation.accepted === false
          ? provider.negotiation.blockingReasons.map((reason) => `provider_${provider.id}_${reason}`)
          : [`provider_${provider.id}_blocked`]),
      warnings: providerContract.providers
        .filter((provider) => provider.sync.state === 'stale' || provider.sync.state === 'unknown')
        .map((provider) => `provider_${provider.id}_sync_${provider.sync.state}`)
    },
    {
      id: 'preview-acceptance',
      label: 'Preview acceptance',
      status: previewAcceptance.acceptance.blocking ? 'fail' : 'pass',
      codes: previewAcceptance.acceptance.blocking ? ['preview_acceptance_required'] : [],
      warnings: []
    },
    {
      id: 'client-runtime',
      label: 'Client runtime',
      status: clientRuntime.errors.length > 0 ? 'fail' : clientRuntime.warnings.length > 0 ? 'warn' : 'pass',
      codes: clientRuntime.errors,
      warnings: clientRuntime.warnings
    },
    {
      id: 'workflow-handoff',
      label: 'Workflow handoff',
      status: workflowHandoff.state === 'blocked' ? 'fail' : 'pass',
      codes: workflowHandoff.state === 'blocked' ? workflowHandoff.blockers : [],
      warnings: workflowHandoff.requiresClientAck ? ['workflow_handoff_requires_client_ack'] : []
    },
    {
      id: 'persisted-state',
      label: 'Persisted state',
      status: persistedState.errors.length > 0
        ? persistedState.errors.includes('persisted_command_active_lock') && persistedState.errors.length === 1
          ? 'warn'
          : 'fail'
        : persistedState.warnings.length > 0
          ? 'warn'
          : 'pass',
      codes: persistedState.errors,
      warnings: persistedState.warnings
    },
    {
      id: 'resume-lease',
      label: 'Resume lease',
      status: resumeLease.errors.length > 0
        ? resumeLease.errors.includes('resume_lease_expired') && resumeLease.errors.length === 1
          ? 'warn'
          : 'fail'
        : resumeLease.warnings.length > 0
          ? 'warn'
          : 'pass',
      codes: resumeLease.errors,
      warnings: resumeLease.warnings
    },
    {
      id: 'resume-guard',
      label: 'Resume guard',
      status: resumeGuard.blockers.length > 0
        ? 'fail'
        : resumeGuard.warnings.length > 0
          ? 'warn'
          : 'pass',
      codes: resumeGuard.blockers,
      warnings: resumeGuard.warnings
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant boundary',
      status: tenantBoundary.errors.length > 0
        ? 'fail'
        : tenantBoundary.warnings.length > 0
          ? 'warn'
          : 'pass',
      codes: tenantBoundary.errors,
      warnings: tenantBoundary.warnings
    }
  ];
  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');

  return {
    schema: 'aios.audit-recovery.resume-token.validation-summary.v1',
    status: failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'pass',
    failedCheckCount: failed.length,
    warningCheckCount: warned.length,
    checks,
    blockingCodes: failed.flatMap((check) => check.codes),
    warningCodes: checks.flatMap((check) => check.warnings)
  };
}

function buildReadinessContract(ok, mode, recoveryNextAction, actionableErrors, validationSummary, previewAcceptance, providerContract, lifecycle, tenantBoundary, resumeLease, resumeGuard, mailchimpRuntimeGate = null) {
  const idempotentReplay = mode === 'idempotent-replay';
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'blocking');
  const nextSteps = blockingErrors.length > 0
    ? blockingErrors.map((error, index) => ({
        id: `resume-token-next-step-${index + 1}`,
        reasonCode: error.code,
        action: error.action,
        priority: index + 1,
        explain: `Resolve ${error.code} before hosted-kernel resume can proceed.`
      }))
    : [{
        id: 'resume-token-next-step-1',
        reasonCode: idempotentReplay ? 'resume_command_already_applied' : ok ? 'resume_ready' : validationSummary.blockingCodes[0] || 'resume_not_ready',
        action: recoveryNextAction,
        priority: 1,
        explain: idempotentReplay
          ? 'The requested resume command was already committed; return the persisted result instead of replaying side effects.'
          : ok
          ? 'All required resume-token gates passed for the selected checkpoint.'
          : 'Resume remains pending until readiness checks pass.'
      }];

  return {
    schema: 'aios.audit-recovery.resume-token.readiness.v1',
    status: ok ? mode : 'blocked',
    canResumeNow: ok && !idempotentReplay,
    requiresAcceptance: previewAcceptance.acceptance.required,
    acceptanceState: previewAcceptance.acceptance.state,
    mailchimpRuntimeGate: mailchimpRuntimeGate
      ? {
          requested: mailchimpRuntimeGate.requested,
          ready: mailchimpRuntimeGate.ready,
          state: mailchimpRuntimeGate.state,
          providerId: mailchimpRuntimeGate.providerId,
          checkpointIds: mailchimpRuntimeGate.checkpointIds,
          nextAction: mailchimpRuntimeGate.nextAction,
          blockerCount: mailchimpRuntimeGate.blockers.length,
          blockers: mailchimpRuntimeGate.blockers,
          proofDigest: mailchimpRuntimeGate.proof.digest
        }
      : null,
    selectedProviderId: providerContract.selectedProviderId,
    lifecycleState: lifecycle.state,
    lifecyclePolicy: {
      revision: lifecycle.settingsPolicy.revision,
      nextRevision: lifecycle.settingsPolicy.nextRevision,
      commandAllowed: lifecycle.settingsPolicy.commandAllowed,
      autoResumeEnabled: lifecycle.settingsPolicy.autoResumeEnabled,
      scheduleEnabled: lifecycle.settingsPolicy.scheduleEnabled,
      scheduleRequiresApproval: lifecycle.settingsPolicy.scheduleRequiresApproval,
      changeSetApplied: lifecycle.settingsPolicy.changeSet.applied,
      rejectedControlChangeCount: lifecycle.settingsPolicy.changeSet.rejected.length,
      nextAction: lifecycle.settingsPolicy.nextAction
    },
    resumeLeaseState: resumeLease.state,
    resumeLeaseHolderId: resumeLease.holderId,
    resumeLeaseExpiresAt: resumeLease.expiresAt,
    resumeGuard: {
      state: resumeGuard.state,
      ready: resumeGuard.ready,
      checkpointId: resumeGuard.checkpointId,
      claimState: resumeGuard.claim.state,
      claimReplayDisposition: resumeGuard.claim.replayDisposition,
      claimId: resumeGuard.claim.id,
      claimOwnerId: resumeGuard.claim.ownerId,
      conflictingClaimId: resumeGuard.claim.conflictingClaimId,
      blockerCount: resumeGuard.blockers.length,
      blockers: resumeGuard.blockers,
      nextAction: resumeGuard.nextAction
    },
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    boundaryStatus: tenantBoundary.errors.length > 0 ? 'blocked' : 'scoped',
    workspaceLaneId: tenantBoundary.isolation.selectedWorkspaceLaneId,
    checkpointAllowedByWorkspaceLane: tenantBoundary.isolation.checkpointAllowedByLane,
    crossWorkspaceEscalation: {
      requested: tenantBoundary.isolation.crossWorkspaceRequested,
      allowed: tenantBoundary.isolation.crossWorkspaceAllowed,
      ref: tenantBoundary.auditHandoff.escalationRef
    },
    validationStatus: validationSummary.status,
    nextAction: recoveryNextAction,
    nextSteps
  };
}

function buildOperatorRecoveryDecision({ ok, mode, recoveryNextAction, actionableErrors, readiness, operationalHealth, lifecycle, providerContract, tenantBoundary, resumeLease, resumeGuard, persistedState, now }) {
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'blocking');
  const retryableErrors = actionableErrors.filter((error) => error.retryable === true || error.severity === 'recoverable');
  const boundaryBlocked = tenantBoundary.errors.length > 0 || readiness.boundaryStatus === 'blocked';
  const providerBlocked = providerContract.blockingProviderCount > 0
    || providerContract.handoff.state === 'sync-conflict'
    || providerContract.handoff.state === 'handoff-commit-blocked'
    || providerContract.handoff.state === 'contract-negotiation-blocked';
  const leaseBlocked = resumeLease.canProceed === false;
  const guardBlocked = resumeGuard.ready === false;
  const persistedBlocked = persistedState.restart.safeToReplay === false;
  const primaryDomain = boundaryBlocked
    ? 'tenant-boundary'
    : providerBlocked
      ? 'provider-contract'
      : leaseBlocked
        ? 'resume-lease'
        : guardBlocked
          ? 'resume-guard'
          : persistedBlocked
            ? 'persisted-state'
            : blockingErrors[0]?.code || 'readiness';
  const nextAction = ok
    ? (mode === 'idempotent-replay' ? 'return_persisted_resume_result' : recoveryNextAction)
    : boundaryBlocked
      ? 'repair_tenant_workspace_boundary'
      : providerBlocked
        ? providerContract.handoff.nextAction
        : leaseBlocked
          ? resumeLease.nextAction
          : guardBlocked
            ? resumeGuard.nextAction
            : persistedBlocked
              ? persistedState.restart.nextAction
              : recoveryNextAction;
  const blockedReasons = [
    ...blockingErrors.map((error) => error.code),
    ...tenantBoundary.errors,
    ...resumeLease.errors,
    ...resumeGuard.blockers,
    ...providerContract.handoff.manifest.missingCapabilities.map((capability) => `capability_missing:${capability}`),
    ...(persistedBlocked ? persistedState.restart.blockers : [])
  ];

  return {
    schema: 'aios.audit-recovery.resume-token.operator-recovery-decision.v1',
    generatedAt: now,
    state: ok
      ? (mode === 'idempotent-replay' ? 'replay-complete' : 'resume-ready')
      : retryableErrors.length > 0
        ? 'retryable-blocked'
        : 'blocked',
    primaryDomain,
    nextAction,
    canResumeNow: readiness.canResumeNow,
    retryable: retryableErrors.length > 0 && operationalHealth.retryPolicy.exhausted !== true,
    retryAfterAt: operationalHealth.retryPolicy.nextRetryAt,
    blockedReasons: [...new Set(blockedReasons)],
    operatorMessage: operationalHealth.operatorMessage,
    lifecycle: {
      command: lifecycle.command,
      state: lifecycle.state,
      nextAction: lifecycle.nextAction,
      scheduleDue: lifecycle.schedule.due,
      scheduleNextRunAt: lifecycle.schedule.nextRunAt,
      policyRevision: lifecycle.settingsPolicy.revision
    },
    provider: {
      selectedProviderId: providerContract.selectedProviderId,
      handoffState: providerContract.handoff.state,
      handoffNextAction: providerContract.handoff.nextAction,
      blockingProviderCount: providerContract.blockingProviderCount,
      syncConflict: providerContract.sync.conflict,
      syncDegraded: providerContract.sync.degraded
    },
    boundary: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      status: readiness.boundaryStatus,
      workspaceLaneId: readiness.workspaceLaneId,
      crossWorkspaceRequested: readiness.crossWorkspaceEscalation.requested,
      crossWorkspaceAllowed: readiness.crossWorkspaceEscalation.allowed,
      errors: tenantBoundary.errors
    },
    resumeLease: {
      state: resumeLease.state,
      canProceed: resumeLease.canProceed,
      holderId: resumeLease.holderId,
      expiresAt: resumeLease.expiresAt,
      nextAction: resumeLease.nextAction
    },
    resumeGuard: {
      state: resumeGuard.state,
      ready: resumeGuard.ready,
      checkpointId: resumeGuard.checkpointId,
      claimState: resumeGuard.claim.state,
      claimReplayDisposition: resumeGuard.claim.replayDisposition,
      nextAction: resumeGuard.nextAction
    },
    proofSubjects: [
      `mode:${mode}`,
      `primary-domain:${primaryDomain}`,
      `tenant:${tenantBoundary.tenantId || 'unknown'}`,
      `workspace:${tenantBoundary.workspaceId || 'unknown'}`,
      `next-action:${nextAction}`
    ]
  };
}

function buildClientPreviewContract(request, ok, token, validationSummary, previewAcceptance, readiness, workflowHandoff, providerContract, clientRuntime, lifecycle, tenantBoundary, resumeLease, actionableErrors, now, mailchimpRuntimeGate = null) {
  const routeInput = request.route && typeof request.route === 'object' ? request.route : {};
  const uiInput = request.ui && typeof request.ui === 'object' ? request.ui : {};
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'blocking');
  const validationSections = validationSummary.checks.map((check, index) => ({
    id: check.id,
    order: index + 1,
    label: check.label,
    state: check.status === 'pass'
      ? 'ready'
      : check.status === 'warn'
        ? 'attention'
        : 'blocked',
    codeCount: check.codes.length,
    warningCount: check.warnings.length,
    primaryCode: check.codes[0] || check.warnings[0] || null,
    explain: check.status === 'pass'
      ? `${check.label} is ready for resume.`
      : check.status === 'warn'
        ? `${check.label} can continue with operator attention.`
        : `${check.label} must be repaired before resume.`
  }));
  const primaryBlocker = blockingErrors[0] || null;
  const clientActions = readiness.nextSteps.map((step) => ({
    id: step.id,
    label: step.action.replaceAll('_', ' '),
    action: step.action,
    reasonCode: step.reasonCode,
    priority: step.priority,
    disabled: step.action === 'resume_from_checkpoint' && !readiness.canResumeNow,
    explain: step.explain
  }));
  const acceptanceRequired = previewAcceptance.acceptance.required;
  const acceptanceMissing = previewAcceptance.acceptance.blocking && !clientRuntime.previewAcknowledged;
  const acceptRoute = String(routeInput.acceptRoute || uiInput.acceptRoute || `${clientRuntime.route}/accept`);
  const refreshRoute = String(routeInput.refreshRoute || uiInput.refreshRoute || clientRuntime.route);
  const destinationLabel = workflowHandoff.destination.kind === 'external-provider'
    ? `External provider ${workflowHandoff.destination.providerId || 'unselected'}`
    : 'Hosted kernel';
  const mailchimp = providerContract.handoff.manifest.mailchimp || {
    requested: false,
    state: 'not-requested',
    target: null,
    mode: 'preview-only',
    acknowledgements: { required: [], accepted: [], missing: [] },
    consentBoundary: null,
    nextAction: 'retain_kernel_resume_contract',
    proofSubjects: []
  };

  return {
    schema: 'aios.audit-recovery.resume-token.client-preview.v1',
    generatedAt: now,
    route: {
      current: clientRuntime.route,
      refresh: refreshRoute,
      accept: acceptRoute,
      method: 'POST',
      responseKey: 'previewAcceptance'
    },
    header: {
      title: previewAcceptance.preview.title,
      subtitle: `${destinationLabel} resume for checkpoint ${token?.checkpointId || 'unknown'}`,
      status: ok
        ? readiness.canResumeNow
          ? 'ready'
          : 'complete'
        : primaryBlocker
          ? 'blocked'
          : 'attention',
      statusCode: primaryBlocker?.code || validationSummary.warningCodes[0] || (ok ? 'resume_ready' : 'resume_pending'),
      generatedAt: previewAcceptance.preview.generatedAt
    },
    acceptance: {
      required: acceptanceRequired,
      state: previewAcceptance.acceptance.state,
      accepted: previewAcceptance.acceptance.accepted,
      acceptedAt: previewAcceptance.acceptance.acceptedAt,
      acceptedBy: previewAcceptance.acceptance.acceptedBy,
      missing: acceptanceMissing,
      disabledReason: acceptanceMissing ? null : acceptanceRequired ? 'preview_already_accepted' : 'acceptance_not_required',
      submit: {
        route: acceptRoute,
        method: 'POST',
        body: {
          previewId: previewAcceptance.preview.id,
          tokenId: token?.tokenId || null,
          checkpointId: token?.checkpointId || null,
          accepted: true,
          acceptedAt: now
        }
      }
    },
    resumeControl: {
      enabled: readiness.canResumeNow,
      mode: readiness.status,
      action: readiness.nextAction,
      destination: workflowHandoff.destination,
      disabledReasons: [
        ...blockingErrors.map((error) => error.code),
        ...(readiness.canResumeNow ? [] : validationSummary.blockingCodes.filter((code) => !blockingErrors.some((error) => error.code === code)))
      ],
      schedule: {
        enabled: lifecycle.schedule.enabled,
        nextRunAt: lifecycle.schedule.nextRunAt,
        due: lifecycle.schedule.due,
        policyEnabled: lifecycle.settingsPolicy.scheduleEnabled,
        requiresApproval: lifecycle.settingsPolicy.scheduleRequiresApproval,
        maxDelayMs: lifecycle.settingsPolicy.maxScheduleDelayMs
      },
      policy: {
        revision: lifecycle.settingsPolicy.revision,
        nextRevision: lifecycle.settingsPolicy.nextRevision,
        commandAllowed: lifecycle.settingsPolicy.commandAllowed,
        autoResumeEnabled: lifecycle.settingsPolicy.autoResumeEnabled,
        deniedCommands: lifecycle.settingsPolicy.deniedCommands,
        lockedControls: lifecycle.settingsPolicy.lockedControls,
        acceptedControlChanges: lifecycle.settingsPolicy.changeSet.accepted,
        rejectedControlChanges: lifecycle.settingsPolicy.changeSet.rejected,
        nextAction: lifecycle.settingsPolicy.nextAction
      },
      lease: {
        state: resumeLease.state,
        holderId: resumeLease.holderId,
        expiresAt: resumeLease.expiresAt,
        renewalRequired: resumeLease.renewal.required
      }
    },
    workflow: {
      ticket: clientRuntime.handoffTicket,
      actions: clientRuntime.workflowActions.map((action) => ({
        id: action.id,
        type: action.type,
        label: action.label,
        route: action.route,
        required: action.required,
        acknowledged: action.acknowledged,
        disabled: action.supported === false,
        reasonCode: action.reasonCode,
        nextAction: action.nextAction
      })),
      stateExport: {
        required: clientRuntime.stateExport.required,
        ready: clientRuntime.stateExport.ready,
        cursor: clientRuntime.stateExport.cursor,
        targets: clientRuntime.stateExport.targets,
        refs: clientRuntime.stateExport.refs
      }
    },
    validation: {
      status: validationSummary.status,
      failedCheckCount: validationSummary.failedCheckCount,
      warningCheckCount: validationSummary.warningCheckCount,
      sections: validationSections
    },
    mailchimpHandoff: {
      requested: mailchimp.requested,
      state: mailchimp.state,
      ready: mailchimp.ready,
      target: mailchimp.target,
      mode: mailchimp.mode,
      consentBoundary: mailchimp.consentBoundary,
      acknowledgementRequired: mailchimp.acknowledgements.missing.length > 0,
      missingAcknowledgements: mailchimp.acknowledgements.missing,
      nextAction: mailchimp.nextAction,
      proofSubjects: mailchimp.proofSubjects
    },
    mailchimpRuntimeGate: mailchimpRuntimeGate
      ? {
          requested: mailchimpRuntimeGate.requested,
          ready: mailchimpRuntimeGate.ready,
          state: mailchimpRuntimeGate.state,
          providerId: mailchimpRuntimeGate.providerId,
          checkpointIds: mailchimpRuntimeGate.checkpointIds,
          mode: mailchimpRuntimeGate.mode,
          acceptance: mailchimpRuntimeGate.acceptance,
          dispatch: mailchimpRuntimeGate.dispatch,
          blockers: mailchimpRuntimeGate.blockers,
          warnings: mailchimpRuntimeGate.warnings,
          nextAction: mailchimpRuntimeGate.nextAction,
          proofDigest: mailchimpRuntimeGate.proof.digest
        }
      : null,
    context: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      checkpointId: token?.checkpointId || null,
      tokenId: token?.tokenId || null,
      providerId: providerContract.selectedProviderId,
      handoffState: providerContract.handoff.state,
      handoffCommitState: providerContract.handoff.manifest.handoffCommit?.state || null,
      handoffCommitReady: providerContract.handoff.manifest.handoffCommit?.ready ?? null,
      handoffCommitBlockers: providerContract.handoff.manifest.handoffCommit?.blockers || [],
      mailchimpHandoffState: mailchimp.state,
      mailchimpRuntimeGateState: mailchimpRuntimeGate?.state || 'not-requested',
      mailchimpRuntimeGateReady: mailchimpRuntimeGate?.ready || false,
      mailchimpRuntimeGateNextAction: mailchimpRuntimeGate?.nextAction || null,
      mailchimpHandoffTargetType: mailchimp.target?.type || null,
      mailchimpAudienceId: mailchimp.target?.audienceId || null,
      mailchimpCampaignId: mailchimp.target?.campaignId || null,
      mailchimpResumeMode: mailchimp.mode,
      mailchimpMissingAcknowledgements: mailchimp.acknowledgements.missing,
      capabilityCoverage: providerContract.providers
        .find((provider) => provider.id === providerContract.selectedProviderId)?.capabilityFit.coverage ?? null,
      clientSessionId: clientRuntime.sessionId,
      workspaceLaneId: tenantBoundary.isolation.selectedWorkspaceLaneId,
      checkpointAllowedByWorkspaceLane: tenantBoundary.isolation.checkpointAllowedByLane,
      crossWorkspaceEscalationRef: tenantBoundary.auditHandoff.escalationRef,
      resumeClaimId: readiness.resumeGuard.claimId,
      resumeClaimState: readiness.resumeGuard.claimState,
      resumeClaimReplayDisposition: readiness.resumeGuard.claimReplayDisposition,
      resumeClaimConflictingClaimId: readiness.resumeGuard.conflictingClaimId
    },
    nextSteps: clientActions,
    proofSubjects: [
      `preview:${previewAcceptance.preview.id}`,
      `checkpoint:${token?.checkpointId || 'unknown'}`,
      `route:${clientRuntime.route}`,
      `client-ticket:${clientRuntime.handoffTicket.id}`,
      `tenant:${tenantBoundary.tenantId || 'unknown'}`,
      `workspace-lane:${tenantBoundary.isolation.selectedWorkspaceLaneId || 'unselected'}`,
      ...mailchimp.proofSubjects
    ]
  };
}

function buildOperationalHealth(ok, validation, dependencyHealth, retryState, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, actionableErrors, now) {
  const domains = [
    {
      id: 'resume-token',
      severity: validation.valid ? 'healthy' : validation.expired ? 'recoverable' : 'blocking',
      state: validation.valid ? 'valid' : validation.expired ? 'expired' : 'invalid',
      codes: validation.errors,
      warnings: validation.warnings,
      nextAction: validation.expired ? 'request_fresh_resume_token' : 'halt_resume_and_reissue_token'
    },
    {
      id: 'dependencies',
      severity: dependencyHealth.some((dependency) => dependency.required && dependency.ok === false)
        ? 'blocking'
        : dependencyHealth.some((dependency) => dependency.ok === false)
          ? 'degraded'
          : 'healthy',
      state: dependencyHealth.every((dependency) => dependency.ok !== false) ? 'available' : 'impaired',
      codes: dependencyHealth
        .filter((dependency) => dependency.ok === false)
        .map((dependency) => `dependency_${dependency.name}_unhealthy`),
      warnings: dependencyHealth
        .filter((dependency) => dependency.ok === false && dependency.required === false)
        .map((dependency) => `dependency_${dependency.name}_degraded`),
      nextAction: dependencyHealth.some((dependency) => dependency.required && dependency.ok === false)
        ? retryState.nextAction
        : 'continue_with_degraded_audit_trail'
    },
    {
      id: 'providers',
      severity: providerContract.blockingProviderCount > 0 || providerContract.sync.conflict
        ? 'blocking'
        : providerContract.sync.degraded || providerContract.handoff.state === 'sync-stale'
          ? 'degraded'
          : 'healthy',
      state: providerContract.handoff.enabled ? providerContract.handoff.state : 'kernel-only',
      codes: providerContract.providers
        .filter((provider) => provider.required && (
          provider.available === false
          || provider.missingCapabilities.length > 0
          || provider.negotiation.accepted === false
          || provider.handoffCommit.ready === false
          || provider.sync.state === 'conflict'
        ))
        .flatMap((provider) => provider.handoffCommit.ready === false
          ? provider.handoffCommit.blockers.map((blocker) => `provider_${provider.id}_${blocker}`)
          : provider.mailchimp.requested && provider.mailchimp.ready === false
          ? provider.mailchimp.blockers.map((blocker) => `provider_${provider.id}_${blocker}`)
          : provider.negotiation.accepted === false
          ? provider.negotiation.blockingReasons.map((reason) => `provider_${provider.id}_${reason}`)
          : [`provider_${provider.id}_blocked`]),
      warnings: providerContract.providers
        .filter((provider) => provider.sync.state === 'stale' || provider.sync.state === 'unknown')
        .map((provider) => `provider_${provider.id}_sync_${provider.sync.state}`),
      nextAction: providerContract.handoff.nextAction
    },
    {
      id: 'client-runtime',
      severity: clientRuntime.errors.length > 0 ? 'blocking' : clientRuntime.warnings.length > 0 ? 'degraded' : 'healthy',
      state: clientRuntime.canReleaseControl ? 'release-ready' : 'requires-client-repair',
      codes: clientRuntime.errors,
      warnings: clientRuntime.warnings,
      nextAction: clientRuntime.nextAction
    },
    {
      id: 'workflow-handoff',
      severity: workflowHandoff.state === 'blocked' ? 'blocking' : workflowHandoff.requiresClientAck ? 'recoverable' : 'healthy',
      state: workflowHandoff.state,
      codes: workflowHandoff.blockers,
      warnings: workflowHandoff.requiresClientAck ? ['workflow_handoff_requires_client_ack'] : [],
      nextAction: workflowHandoff.nextAction
    },
    {
      id: 'persisted-state',
      severity: persistedState.errors.length > 0
        ? persistedState.errors.includes('persisted_command_active_lock') && persistedState.errors.length === 1
          ? 'recoverable'
          : 'blocking'
        : persistedState.warnings.length > 0
          ? 'degraded'
          : 'healthy',
      state: persistedState.status,
      codes: persistedState.errors,
      warnings: persistedState.warnings,
      nextAction: persistedState.restart.nextAction
    },
    {
      id: 'resume-lease',
      severity: resumeLease.errors.length > 0
        ? resumeLease.errors.includes('resume_lease_expired') && resumeLease.errors.length === 1
          ? 'recoverable'
          : 'blocking'
        : resumeLease.warnings.length > 0
          ? 'degraded'
          : 'healthy',
      state: resumeLease.state,
      codes: resumeLease.errors,
      warnings: resumeLease.warnings,
      nextAction: resumeLease.nextAction
    },
    {
      id: 'tenant-boundary',
      severity: tenantBoundary.errors.length > 0 ? 'blocking' : tenantBoundary.warnings.length > 0 ? 'degraded' : 'healthy',
      state: tenantBoundary.errors.length > 0 ? 'boundary-blocked' : 'scoped',
      codes: tenantBoundary.errors,
      warnings: tenantBoundary.warnings,
      nextAction: tenantBoundary.auditHandoff.nextAction
    },
    {
      id: 'lifecycle',
      severity: lifecycle.errors.length > 0 ? 'blocking' : lifecycle.warnings.length > 0 ? 'degraded' : 'healthy',
      state: lifecycle.state,
      codes: lifecycle.errors,
      warnings: lifecycle.warnings,
      nextAction: lifecycle.nextAction
    }
  ];
  const worstSeverity = domains.reduce((current, domain) => (
    OPERATIONAL_SEVERITY_RANK.get(domain.severity) > OPERATIONAL_SEVERITY_RANK.get(current)
      ? domain.severity
      : current
  ), 'healthy');
  const blockingErrors = actionableErrors.filter((error) => error.severity === 'blocking');
  const recoverableErrors = actionableErrors.filter((error) => error.severity === 'recoverable');
  const degradedErrors = actionableErrors.filter((error) => error.severity === 'degraded');
  const retryAfterMs = blockingErrors.length > 0 && retryState.retryable ? retryState.backoffMs : 0;
  const canOperateDegraded = ok && worstSeverity === 'degraded';
  const recoveryPlan = buildOperationalRecoveryPlan(actionableErrors, domains, retryState, workflowHandoff, providerContract, resumeLease, now);
  const failureState = ok
    ? canOperateDegraded
      ? 'operational-degraded'
      : 'operational'
    : blockingErrors.length > 0
      ? 'blocked'
      : recoverableErrors.length > 0 || retryState.retryable
        ? 'retryable'
        : 'degraded-only';

  return {
    schema: 'aios.audit-recovery.resume-token.operational-health.v1',
    generatedAt: now,
    status: ok ? (canOperateDegraded ? 'degraded' : 'healthy') : worstSeverity,
    failureState,
    degradedMode: {
      active: canOperateDegraded || degradedErrors.length > 0 || domains.some((domain) => domain.severity === 'degraded'),
      reasonCodes: [
        ...degradedErrors.map((error) => error.code),
        ...domains.filter((domain) => domain.severity === 'degraded').flatMap((domain) => domain.warnings)
      ],
      allowed: blockingErrors.length === 0,
      nextAction: blockingErrors.length === 0 ? 'continue_with_degraded_resume_contract' : 'repair_blocking_resume_health'
    },
    retryPolicy: {
      attempts: retryState.attempts,
      maxAttempts: retryState.maxAttempts,
      retryable: retryState.retryable && (blockingErrors.length > 0 || recoverableErrors.length > 0),
      backoffMs: retryAfterMs,
      nextRetryAt: retryAfterMs > 0 ? new Date(Date.parse(now) + retryAfterMs).toISOString() : null,
      exhausted: retryState.retryable === false,
      nextAction: retryAfterMs > 0 ? retryState.nextAction : 'do_not_retry_without_state_change'
    },
    recoveryPlan,
    domains,
    primaryError: actionableErrors[0] || null,
    errorBudget: {
      blocking: blockingErrors.length,
      recoverable: recoverableErrors.length,
      degraded: degradedErrors.length,
      warning: domains.reduce((count, domain) => count + domain.warnings.length, 0)
    },
    operatorMessage: blockingErrors.length > 0
      ? `Resume blocked by ${blockingErrors[0].code}; ${blockingErrors[0].action}.`
      : recoverableErrors.length > 0
        ? `Resume can retry after recovery action ${recoverableErrors[0].action}.`
        : canOperateDegraded
          ? 'Resume can proceed with degraded operational guarantees.'
          : 'Resume-token operational health is clear.'
  };
}

function buildReportingState(ok, token, analytics, timeline, actionableErrors, readiness, operationalHealth, workflowHandoff, now) {
  const blockingCodes = actionableErrors
    .filter((error) => error.severity === 'blocking')
    .map((error) => error.code);
  const reportableTimeline = timeline
    .slice(-EXPORT_TIMELINE_LIMIT)
    .map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      kind: event.kind,
      status: event.status,
      nextAction: event.nextAction || null
    }));
  const historyDigest = analytics.history;
  const exportState = ok
    ? 'ready'
    : blockingCodes.length > 0
      ? 'blocked'
      : operationalHealth.failureState === 'retryable'
        ? 'retryable'
        : 'attention';

  return {
    schema: 'aios.audit-recovery.resume-token.reporting.v1',
    generatedAt: now,
    status: exportState === 'ready' ? 'exportable' : 'requires-attention',
    exportState,
    summary: `${ok ? 'Resume permitted' : 'Resume blocked'} for checkpoint ${token?.checkpointId || 'unknown'}`,
    counters: analytics.counters,
    trend: {
      currentStreak: historyDigest.currentStreak,
      recentFailureRate: analytics.rates.recentHistoryFailureRate,
      regressionDetected: analytics.flags.historyRegressionDetected,
      recoveredAfterFailure: analytics.flags.historyRecoveredAfterFailure,
      latestFailureAt: historyDigest.latestFailureAt,
      latestFailureCodes: historyDigest.latestFailureCodes
    },
    readiness: {
      status: readiness.status,
      canResumeNow: readiness.canResumeNow,
      nextAction: readiness.nextAction,
      nextStepCount: readiness.nextSteps.length
    },
    handoff: {
      state: workflowHandoff.state,
      destinationKind: workflowHandoff.destination.kind,
      providerId: workflowHandoff.destination.providerId,
      blockerCount: workflowHandoff.blockers.length
    },
    auditExport: {
      includeProof: true,
      includeTimeline: true,
      timelineLimit: EXPORT_TIMELINE_LIMIT,
      analyticsExportReady: analytics.exportModel.exportReady,
      analyticsExportState: analytics.exportModel.state,
      analyticsExportRowCount: analytics.exportModel.counters.historyExportRowCount
        + analytics.exportModel.counters.providerExportRowCount
        + analytics.exportModel.counters.domainCount,
      blockingCodes,
      primaryErrorCode: operationalHealth.primaryError?.code || null,
      operatorMessage: operationalHealth.operatorMessage
    },
    analyticsExport: {
      schema: analytics.exportModel.schema,
      state: analytics.exportModel.state,
      exportReady: analytics.exportModel.exportReady,
      dimensions: analytics.exportModel.dimensions,
      counters: analytics.exportModel.counters,
      blockedDomains: analytics.exportModel.domainRows
        .filter((row) => row.blockingCount > 0)
        .map((row) => row.id),
      warningDomains: analytics.exportModel.domainRows
        .filter((row) => row.warningCount > 0)
        .map((row) => row.id),
      nextAction: analytics.exportModel.summary.nextAction,
      proofSubjects: analytics.exportModel.summary.proofSubjects
    },
    timeline: {
      totalEvents: timeline.length,
      exportedEvents: reportableTimeline.length,
      events: reportableTimeline
    }
  };
}

function buildExportSummary(state) {
  const blockingCodes = state.errors
    .filter((error) => error.severity === 'blocking')
    .map((error) => error.code);

  return {
    schema: 'aios.audit-recovery.resume-token.export.v1',
    exportId: `${surfaceId}:${state.proof.tokenId || 'missing-token'}:${state.generatedAt}`,
    generatedAt: state.generatedAt,
    surface: {
      id: surfaceId,
      group: surfaceGroup,
      name: surfaceName
    },
    resume: {
      canResume: state.recovery.canResume,
      checkpointId: state.recovery.checkpointId,
      nextAction: state.recovery.nextAction,
      mode: state.mode
    },
    lifecycle: {
      command: state.lifecycle.command,
      state: state.lifecycle.state,
      enabled: state.lifecycle.enabled,
      policy: {
        schema: state.lifecycle.settingsPolicy.schema,
        revision: state.lifecycle.settingsPolicy.revision,
        nextRevision: state.lifecycle.settingsPolicy.nextRevision,
        commandAllowed: state.lifecycle.settingsPolicy.commandAllowed,
        autoResumeEnabled: state.lifecycle.settingsPolicy.autoResumeEnabled,
        scheduleEnabled: state.lifecycle.settingsPolicy.scheduleEnabled,
        scheduleRequiresApproval: state.lifecycle.settingsPolicy.scheduleRequiresApproval,
        allowPastDueSchedule: state.lifecycle.settingsPolicy.allowPastDueSchedule,
        lockedControls: state.lifecycle.settingsPolicy.lockedControls,
        changeSet: state.lifecycle.settingsPolicy.changeSet,
        maxScheduleDelayMs: state.lifecycle.settingsPolicy.maxScheduleDelayMs,
        nextAction: state.lifecycle.settingsPolicy.nextAction
      },
      scheduleNextRunAt: state.lifecycle.schedule.nextRunAt,
      nextAction: state.lifecycle.nextAction
    },
    providerContract: {
      schema: state.providerContract.schema,
      selectedProviderId: state.providerContract.selectedProviderId,
      requiredCapabilities: state.providerContract.requiredCapabilities,
      negotiation: state.providerContract.negotiation,
      handoffState: state.providerContract.handoff.state,
      handoffNextAction: state.providerContract.handoff.nextAction,
      handoffCommit: {
        required: state.providerContract.handoffCommit.required,
        readyProviderIds: state.providerContract.handoffCommit.readyProviderIds,
        blockedProviderIds: state.providerContract.handoffCommit.blockedProviderIds,
        blockerCodes: state.providerContract.handoffCommit.blockerCodes
      },
      handoffManifest: {
        schema: state.providerContract.handoff.manifest.schema,
        id: state.providerContract.handoff.manifest.id,
        state: state.providerContract.handoff.manifest.state,
        mode: state.providerContract.handoff.manifest.mode,
        transferable: state.providerContract.handoff.manifest.transferable,
        serviceRefCount: state.providerContract.handoff.manifest.serviceRefs.length,
        negotiation: state.providerContract.handoff.manifest.negotiation,
        handoffCommit: state.providerContract.handoff.manifest.handoffCommit,
        syncState: state.providerContract.handoff.manifest.syncState,
        syncCursor: state.providerContract.handoff.manifest.syncCursor,
        nextAction: state.providerContract.handoff.manifest.nextAction
      },
      syncDegraded: state.providerContract.sync.degraded,
      syncConflict: state.providerContract.sync.conflict
    },
    mailchimpRuntimeGate: state.mailchimpRuntimeGate
      ? {
          schema: state.mailchimpRuntimeGate.schema,
          requested: state.mailchimpRuntimeGate.requested,
          ready: state.mailchimpRuntimeGate.ready,
          state: state.mailchimpRuntimeGate.state,
          providerId: state.mailchimpRuntimeGate.providerId,
          checkpointIds: state.mailchimpRuntimeGate.checkpointIds,
          mode: state.mailchimpRuntimeGate.mode,
          blockerCount: state.mailchimpRuntimeGate.blockers.length,
          warningCount: state.mailchimpRuntimeGate.warnings.length,
          nextAction: state.mailchimpRuntimeGate.nextAction,
          dispatchable: Boolean(state.mailchimpRuntimeGate.dispatch),
          proofDigest: state.mailchimpRuntimeGate.proof.digest
        }
      : null,
    counters: state.analytics.counters,
    analyticsExport: {
      schema: state.analytics.exportModel.schema,
      generatedAt: state.analytics.exportModel.generatedAt,
      state: state.analytics.exportModel.state,
      exportReady: state.analytics.exportModel.exportReady,
      dimensions: state.analytics.exportModel.dimensions,
      counters: state.analytics.exportModel.counters,
      historySnapshotWindow: state.analytics.exportModel.historySnapshotWindow,
      domainRows: state.analytics.exportModel.domainRows,
      providerRows: state.analytics.exportModel.providerRows,
      historyRows: state.analytics.exportModel.historyRows,
      nextAction: state.analytics.exportModel.summary.nextAction,
      proofSubjects: state.analytics.exportModel.summary.proofSubjects
    },
    historyDigest: {
      schema: state.analytics.history.schema,
      currentStreak: state.analytics.history.currentStreak,
      recentFailureRate: state.analytics.rates.recentHistoryFailureRate,
      latestFailureAt: state.analytics.history.latestFailureAt,
      latestFailureCodes: state.analytics.history.latestFailureCodes,
      repeatedFailureCodes: state.analytics.history.repeatedFailureCodes,
      repeatedCheckpoints: state.analytics.history.repeatedCheckpoints
    },
    blockingCodes,
    validation: {
      schema: state.validationSummary.schema,
      status: state.validationSummary.status,
      failedCheckCount: state.validationSummary.failedCheckCount,
      warningCheckCount: state.validationSummary.warningCheckCount
    },
    readiness: {
      schema: state.readiness.schema,
      status: state.readiness.status,
      canResumeNow: state.readiness.canResumeNow,
      requiresAcceptance: state.readiness.requiresAcceptance,
      nextAction: state.readiness.nextAction
    },
    operationalHealth: {
      schema: state.operationalHealth.schema,
      status: state.operationalHealth.status,
      failureState: state.operationalHealth.failureState,
      degradedModeActive: state.operationalHealth.degradedMode.active,
      degradedModeAllowed: state.operationalHealth.degradedMode.allowed,
      retryable: state.operationalHealth.retryPolicy.retryable,
      backoffMs: state.operationalHealth.retryPolicy.backoffMs,
      nextRetryAt: state.operationalHealth.retryPolicy.nextRetryAt,
      recoveryPlanSchema: state.operationalHealth.recoveryPlan.schema,
      recoveryPlanId: state.operationalHealth.recoveryPlan.planId,
      recoveryPlanState: state.operationalHealth.recoveryPlan.state,
      recoveryPhaseCount: state.operationalHealth.recoveryPlan.remediationPhases.length,
      recoveryNextPhase: state.operationalHealth.recoveryPlan.nextPhase?.id || null,
      recoveryOperatorAction: state.operationalHealth.recoveryPlan.operatorAction,
      retryGateEligible: state.operationalHealth.recoveryPlan.retryGate.eligible,
      retryGateBlockedBy: state.operationalHealth.recoveryPlan.retryGate.blockedBy,
      degradedGateAdmitted: state.operationalHealth.recoveryPlan.degradedGate.admitted,
      primaryErrorCode: state.operationalHealth.primaryError?.code || null,
      operatorMessage: state.operationalHealth.operatorMessage
    },
    persistedState: {
      schema: state.persistedState.schema,
      status: state.persistedState.status,
      commandId: state.persistedState.commandId,
      commandAlreadyApplied: state.persistedState.commandAlreadyApplied,
      durableCursor: state.persistedState.durableCursor,
      snapshotVersion: state.persistedState.snapshot.version,
      snapshotChecksum: state.persistedState.snapshot.checksum,
      recoveryPath: state.persistedState.recoveryPath,
      writeBarrierOpen: state.persistedState.writeBarrier.open,
      writeBarrierNextAction: state.persistedState.writeBarrier.nextAction,
      journalEntryCount: state.persistedState.journal.count,
      latestJournalStage: state.persistedState.journal.latest?.stage || null,
      deterministicOutcomeStatus: state.persistedState.deterministicOutcome.status,
      safeToReplay: state.persistedState.restart.safeToReplay,
      nextAction: state.persistedState.restart.nextAction
    },
    resumeLease: {
      schema: state.resumeLease.schema,
      state: state.resumeLease.state,
      required: state.resumeLease.required,
      holderId: state.resumeLease.holderId,
      commandId: state.resumeLease.commandId,
      fencingToken: state.resumeLease.fencing.token,
      expiresAt: state.resumeLease.expiresAt,
      remainingMs: state.resumeLease.remainingMs,
      canProceed: state.resumeLease.canProceed,
      nextAction: state.resumeLease.nextAction
    },
    resumeGuard: {
      schema: state.resumeGuard.schema,
      state: state.resumeGuard.state,
      ready: state.resumeGuard.ready,
      checkpointId: state.resumeGuard.checkpointId,
      blockerCount: state.resumeGuard.blockers.length,
      warningCount: state.resumeGuard.warnings.length,
      claim: {
        schema: state.resumeGuard.claim.schema,
        id: state.resumeGuard.claim.id,
        state: state.resumeGuard.claim.state,
        ownerId: state.resumeGuard.claim.ownerId,
        replayDisposition: state.resumeGuard.claim.replayDisposition,
        conflictingClaimId: state.resumeGuard.claim.conflictingClaimId,
        blockerCount: state.resumeGuard.claim.blockers.length,
        warningCount: state.resumeGuard.claim.warnings.length
      },
      nextAction: state.resumeGuard.nextAction
    },
    clientRuntime: {
      schema: state.clientRuntime.schema,
      sessionId: state.clientRuntime.sessionId,
      route: state.clientRuntime.route,
      canReleaseControl: state.clientRuntime.canReleaseControl,
      unflushedMutationCount: state.clientRuntime.unflushedMutationCount,
      workflowActionCount: state.clientRuntime.workflowActions.length,
      unresolvedRequiredActionCount: state.clientRuntime.unresolvedRequiredActionCount,
      stateExportReady: state.clientRuntime.stateExport.ready,
      stateExportTargets: state.clientRuntime.stateExport.targets,
      handoffTicketId: state.clientRuntime.handoffTicket.id,
      nextAction: state.clientRuntime.nextAction
    },
    tenantBoundary: {
      schema: state.tenantBoundary.schema,
      tenantId: state.tenantBoundary.tenantId,
      workspaceId: state.tenantBoundary.workspaceId,
      principalId: state.tenantBoundary.principal.id,
      requiredPermissions: state.tenantBoundary.principal.requiredPermissions,
      missingPermissions: state.tenantBoundary.principal.missingPermissions,
      providerScopeViolations: state.tenantBoundary.isolation.providerScopeViolations,
      workspaceLaneCount: state.tenantBoundary.isolation.workspaceLanes.length,
      selectedWorkspaceLaneId: state.tenantBoundary.isolation.selectedWorkspaceLaneId,
      checkpointAllowedByWorkspaceLane: state.tenantBoundary.isolation.checkpointAllowedByLane,
      crossWorkspaceRequested: state.tenantBoundary.isolation.crossWorkspaceRequested,
      crossWorkspaceAllowed: state.tenantBoundary.isolation.crossWorkspaceAllowed,
      crossWorkspaceEscalationRef: state.tenantBoundary.auditHandoff.escalationRef,
      auditSinkRef: state.tenantBoundary.auditHandoff.auditSinkRef,
      canEmitProof: state.tenantBoundary.auditHandoff.canEmitProof,
      nextAction: state.tenantBoundary.auditHandoff.nextAction
    },
    workflowHandoff: {
      schema: state.workflowHandoff.schema,
      state: state.workflowHandoff.state,
      destination: state.workflowHandoff.destination,
      visibleStep: state.workflowHandoff.visibleStep,
      clientHandoffTicketId: state.workflowHandoff.clientHandoffTicket.id,
      requiredClientActionCount: state.workflowHandoff.requiredClientActions.length,
      stateExportReady: state.workflowHandoff.stateExport.ready,
      blockerCount: state.workflowHandoff.blockers.length,
      nextAction: state.workflowHandoff.nextAction
    },
    preview: {
      schema: state.previewAcceptance.schema,
      previewId: state.previewAcceptance.preview.id,
      acceptanceState: state.previewAcceptance.acceptance.state,
      acceptanceNextAction: state.previewAcceptance.acceptance.nextAction
    },
    clientPreview: {
      schema: state.clientPreview.schema,
      route: state.clientPreview.route.current,
      acceptRoute: state.clientPreview.route.accept,
      status: state.clientPreview.header.status,
      statusCode: state.clientPreview.header.statusCode,
      resumeEnabled: state.clientPreview.resumeControl.enabled,
      disabledReasons: state.clientPreview.resumeControl.disabledReasons,
      workflowActionCount: state.clientPreview.workflow.actions.length,
      stateExportTargets: state.clientPreview.workflow.stateExport.targets,
      validationStatus: state.clientPreview.validation.status,
      nextStepCount: state.clientPreview.nextSteps.length
    },
    reporting: {
      schema: state.reporting.schema,
      status: state.reporting.status,
      exportState: state.reporting.exportState,
      trend: state.reporting.trend,
      analyticsExport: state.reporting.analyticsExport,
      auditExport: state.reporting.auditExport,
      timeline: state.reporting.timeline
    },
    evidenceCount: state.proof.evidenceCount,
    timelineEventCount: state.timeline.length
  };
}

export function describeResumeTokenSurface(input = {}) {
  const request = input && typeof input === 'object' ? input : {};
  const token = request.resumeToken || request.token;
  const now = toIsoString(request.now, Date.now());
  const nowMs = Date.parse(now);
  const evidence = normalizeEvidence(request.evidence);
  const historySnapshots = normalizeHistorySnapshots(request, now);
  const validation = validateResumeToken(token, nowMs);
  const retryState = computeRetryState(request);
  const lifecycle = normalizeLifecycleSettings(request, nowMs);
  const persistedState = normalizePersistedResumeState(request, lifecycle, token, nowMs);
  const providerContract = normalizeProviderContracts(request, lifecycle, validation, nowMs, token);
  const tenantBoundary = normalizeTenantBoundary(request, token, lifecycle, providerContract, now);
  const resumeGuard = normalizeResumeGuard(request, token, validation, persistedState, tenantBoundary, providerContract, nowMs);
  const dependencyHealth = [
    {
      name: 'checkpoint-store',
      ok: request.checkpointStoreOk !== false,
      required: true
    },
    {
      name: 'audit-sink',
      ok: request.auditSinkOk !== false,
      required: false
    }
  ];
  const dependencyBlocking = dependencyHealth.some((dependency) => dependency.required && dependency.ok === false);
  const providerBlocking = providerContract.blockingProviderCount > 0
    || (providerContract.handoff.enabled && !['ready', 'sync-stale'].includes(providerContract.handoff.state));
  const degraded = dependencyHealth.some((dependency) => dependency.required === false && dependency.ok === false);
  const providerDegraded = providerContract.sync.degraded || providerContract.handoff.state === 'sync-stale';
  const previewAcceptance = normalizePreviewAcceptance(request, validation, lifecycle, providerContract, token, now);
  const clientRuntime = normalizeClientRuntimeState(request, token, nowMs);
  const workflowHandoff = buildWorkflowHandoff(request, lifecycle, providerContract, previewAcceptance, clientRuntime, validation, tenantBoundary);
  const mailchimpRuntimeGate = normalizeMailchimpRuntimeHandoffGate(
    request,
    providerContract,
    previewAcceptance,
    clientRuntime,
    workflowHandoff,
    tenantBoundary,
    now
  );
  const resumeLease = normalizeResumeLease(request, lifecycle, token, clientRuntime, persistedState, tenantBoundary, nowMs);
  const validationSummary = buildValidationSummary(validation, lifecycle, dependencyHealth, providerContract, previewAcceptance, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, resumeGuard);
  const actionableErrors = buildActionableErrors(validation, dependencyHealth, retryState, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, resumeGuard, mailchimpRuntimeGate);
  if (previewAcceptance.acceptance.blocking) {
    actionableErrors.push({
      code: 'preview_acceptance_required',
      severity: 'blocking',
      action: previewAcceptance.acceptance.nextAction
    });
  }
  const replayCompleted = persistedState.commandAlreadyApplied;
  const ok = replayCompleted || (validation.valid
    && !dependencyBlocking
    && !providerBlocking
    && !previewAcceptance.acceptance.blocking
    && clientRuntime.canReleaseControl
    && workflowHandoff.state !== 'blocked'
    && lifecycle.canResumeNow
    && persistedState.restart.safeToReplay
    && resumeLease.canProceed
    && resumeGuard.ready
    && (!mailchimpRuntimeGate.requested || mailchimpRuntimeGate.ready)
    && tenantBoundary.errors.length === 0);
  const effectiveMode = replayCompleted
    ? 'idempotent-replay'
    : ok
      ? (degraded || providerDegraded ? 'degraded' : 'ready')
      : 'blocked';
  const analytics = buildAnalytics(validation, dependencyHealth, retryState, evidence, historySnapshots, nowMs, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease);
  const timeline = buildTimeline(now, validation, dependencyHealth, retryState, historySnapshots, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease);
  const recoveryNextAction = replayCompleted
    ? persistedState.restart.nextAction
    : ok
      ? workflowHandoff.nextAction
    : actionableErrors[0]?.action || providerContract.handoff.nextAction || lifecycle.nextAction || retryState.nextAction;
  const readiness = buildReadinessContract(ok, effectiveMode, recoveryNextAction, actionableErrors, validationSummary, previewAcceptance, providerContract, lifecycle, tenantBoundary, resumeLease, resumeGuard, mailchimpRuntimeGate);
  const clientPreview = buildClientPreviewContract(request, ok, token, validationSummary, previewAcceptance, readiness, workflowHandoff, providerContract, clientRuntime, lifecycle, tenantBoundary, resumeLease, actionableErrors, now, mailchimpRuntimeGate);
  const operationalHealth = buildOperationalHealth(ok, validation, dependencyHealth, retryState, lifecycle, providerContract, clientRuntime, workflowHandoff, persistedState, tenantBoundary, resumeLease, actionableErrors, now);
  const operatorRecoveryDecision = buildOperatorRecoveryDecision({
    ok,
    mode: effectiveMode,
    recoveryNextAction,
    actionableErrors,
    readiness,
    operationalHealth,
    lifecycle,
    providerContract,
    tenantBoundary,
    resumeLease,
    resumeGuard,
    persistedState,
    now
  });
  const reporting = buildReportingState(ok, token, analytics, timeline, actionableErrors, readiness, operationalHealth, workflowHandoff, now);

  const state = {
    ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel resume-token health and recovery contract',
    mode: effectiveMode,
    health: {
      status: ok ? (replayCompleted || (!degraded && !providerDegraded) ? 'healthy' : 'degraded') : 'unhealthy',
      validation,
      dependencies: dependencyHealth,
      retry: retryState,
      operational: operationalHealth,
      lifecycle,
      providerContract,
      mailchimpRuntimeGate,
      clientRuntime,
      workflowHandoff,
      persistedState,
      resumeLease,
      resumeGuard,
      tenantBoundary
    },
    lifecycle,
    persistedState,
    resumeLease,
    resumeGuard,
    providerContract,
    mailchimpRuntimeGate,
    tenantBoundary,
    clientRuntime,
    workflowHandoff,
    previewAcceptance,
    clientPreview,
    validationSummary,
    readiness,
    operationalHealth,
    recovery: {
      canResume: ok && !replayCompleted,
      checkpointId: token?.checkpointId || null,
      degradedMode: degraded || providerDegraded,
      nextAction: recoveryNextAction,
      operatorDecision: operatorRecoveryDecision,
      scheduledAt: lifecycle.schedule.nextRunAt,
      scheduleDue: lifecycle.schedule.due,
      handoff: providerContract.handoff,
      providerId: providerContract.selectedProviderId,
      resumeLease: {
        state: resumeLease.state,
        holderId: resumeLease.holderId,
        fencingToken: resumeLease.fencing.token,
        expiresAt: resumeLease.expiresAt,
        nextAction: resumeLease.nextAction
      },
      resumeGuard: {
        state: resumeGuard.state,
        ready: resumeGuard.ready,
        checkpointId: resumeGuard.checkpointId,
        claim: {
          id: resumeGuard.claim.id,
          state: resumeGuard.claim.state,
          replayDisposition: resumeGuard.claim.replayDisposition,
          ownerId: resumeGuard.claim.ownerId,
          conflictingClaimId: resumeGuard.claim.conflictingClaimId,
          nextAction: resumeGuard.claim.nextAction
        },
        blockers: resumeGuard.blockers,
        nextAction: resumeGuard.nextAction
      },
      workflowHandoff
    },
    proof: {
      tokenId: token?.tokenId || null,
      expiresAt: validation.expiresAt,
      evidenceCount: evidence.length,
      failureCount: actionableErrors.length,
      historySnapshotCount: historySnapshots.length,
      lifecycleState: lifecycle.state,
      lifecycleCommand: lifecycle.command,
      lifecycleSettingsPolicySchema: lifecycle.settingsPolicy.schema,
      lifecycleSettingsRevision: lifecycle.settingsPolicy.revision,
      lifecycleSettingsNextRevision: lifecycle.settingsPolicy.nextRevision,
      lifecycleCommandAllowed: lifecycle.settingsPolicy.commandAllowed,
      lifecycleAllowedCommands: lifecycle.settingsPolicy.allowedCommands,
      lifecycleDeniedCommands: lifecycle.settingsPolicy.deniedCommands,
      lifecycleLockedControls: lifecycle.settingsPolicy.lockedControls,
      lifecycleAcceptedControlChanges: lifecycle.settingsPolicy.changeSet.accepted,
      lifecycleRejectedControlChanges: lifecycle.settingsPolicy.changeSet.rejected,
      lifecycleSettingsChangeSetApplied: lifecycle.settingsPolicy.changeSet.applied,
      lifecycleSettingsChangeSetNextAction: lifecycle.settingsPolicy.changeSet.nextAction,
      lifecycleAutoResumeEnabled: lifecycle.settingsPolicy.autoResumeEnabled,
      lifecycleSchedulePolicyEnabled: lifecycle.settingsPolicy.scheduleEnabled,
      lifecycleScheduleRequiresApproval: lifecycle.settingsPolicy.scheduleRequiresApproval,
      lifecycleScheduleMaxDelayMs: lifecycle.settingsPolicy.maxScheduleDelayMs,
      lifecycleSettingsProofSubjects: lifecycle.settingsPolicy.proofSubjects,
      providerContractSchema: providerContract.schema,
      tenantBoundarySchema: tenantBoundary.schema,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      principalId: tenantBoundary.principal.id,
      boundaryRef: tenantBoundary.auditHandoff.boundaryRef,
      requiredPermissions: tenantBoundary.principal.requiredPermissions,
      missingPermissions: tenantBoundary.principal.missingPermissions,
      providerScopeViolations: tenantBoundary.isolation.providerScopeViolations,
      workspaceLaneCount: tenantBoundary.isolation.workspaceLanes.length,
      selectedWorkspaceLaneId: tenantBoundary.isolation.selectedWorkspaceLaneId,
      workspaceLaneCheckpointAllowed: tenantBoundary.isolation.checkpointAllowedByLane,
      crossWorkspaceRequested: tenantBoundary.isolation.crossWorkspaceRequested,
      crossWorkspaceAllowed: tenantBoundary.isolation.crossWorkspaceAllowed,
      crossWorkspaceEscalationRef: tenantBoundary.auditHandoff.escalationRef,
      boundaryAuditSinkRef: tenantBoundary.auditHandoff.auditSinkRef,
      boundaryProofSubjects: tenantBoundary.auditHandoff.proofSubjects,
      auditBoundaryProofReady: tenantBoundary.auditHandoff.canEmitProof,
      requiredCapabilities: providerContract.requiredCapabilities,
      selectedProviderId: providerContract.selectedProviderId,
      providerNegotiationRequestedHandoffMode: providerContract.negotiation.requestedHandoffMode,
      providerNegotiationRequestedProofFormat: providerContract.negotiation.requestedProofFormat,
      providerNegotiationRequestedExportTarget: providerContract.negotiation.requestedExportTarget,
      providerNegotiationAcceptedProviderIds: providerContract.negotiation.acceptedProviderIds,
      providerNegotiationBlockedProviderIds: providerContract.negotiation.blockedProviderIds,
      providerWriteBarrierBlockedProviderIds: providerContract.negotiation.writeBarrierBlockedProviderIds,
      providerHandoffCommitReadyProviderIds: providerContract.handoffCommit.readyProviderIds,
      providerHandoffCommitBlockedProviderIds: providerContract.handoffCommit.blockedProviderIds,
      providerHandoffCommitBlockerCodes: providerContract.handoffCommit.blockerCodes,
      selectedProviderNegotiationAccepted: providerContract.handoff.manifest.negotiation?.accepted ?? null,
      selectedProviderWriteBarrierOpen: providerContract.handoff.manifest.negotiation?.writeBarrierOpen ?? null,
      selectedProviderSequenceDrift: providerContract.handoff.manifest.negotiation?.sequenceDrift ?? null,
      selectedProviderCapabilityCoverage: providerContract.providers
        .find((provider) => provider.id === providerContract.selectedProviderId)?.capabilityFit.coverage ?? null,
      selectedProviderHandoffCommitState: providerContract.handoff.manifest.handoffCommit?.state || null,
      selectedProviderHandoffCommitReady: providerContract.handoff.manifest.handoffCommit?.ready ?? null,
      selectedProviderHandoffCommitPayloadRef: providerContract.handoff.manifest.handoffCommit?.payload.ref || null,
      selectedProviderHandoffCommitReceiptRef: providerContract.handoff.manifest.handoffCommit?.receipt.ref || null,
      mailchimpHandoffRequested: providerContract.mailchimp.requested,
      mailchimpHandoffReadyProviderIds: providerContract.mailchimp.readyProviderIds,
      mailchimpHandoffBlockedProviderIds: providerContract.mailchimp.blockedProviderIds,
      mailchimpHandoffBlockerCodes: providerContract.mailchimp.blockerCodes,
      mailchimpRuntimeGateSchema: mailchimpRuntimeGate.schema,
      mailchimpRuntimeGateRequested: mailchimpRuntimeGate.requested,
      mailchimpRuntimeGateReady: mailchimpRuntimeGate.ready,
      mailchimpRuntimeGateState: mailchimpRuntimeGate.state,
      mailchimpRuntimeGateProviderId: mailchimpRuntimeGate.providerId,
      mailchimpRuntimeGateCheckpointIds: mailchimpRuntimeGate.checkpointIds,
      mailchimpRuntimeGateBlockers: mailchimpRuntimeGate.blockers,
      mailchimpRuntimeGateWarnings: mailchimpRuntimeGate.warnings,
      mailchimpRuntimeGateDispatchable: Boolean(mailchimpRuntimeGate.dispatch),
      mailchimpRuntimeGateProofDigest: mailchimpRuntimeGate.proof.digest,
      mailchimpSelectedState: providerContract.handoff.manifest.mailchimp?.state || 'not-requested',
      mailchimpSelectedTargetType: providerContract.handoff.manifest.mailchimp?.target.type || null,
      mailchimpSelectedAudienceId: providerContract.handoff.manifest.mailchimp?.target.audienceId || null,
      mailchimpSelectedCampaignId: providerContract.handoff.manifest.mailchimp?.target.campaignId || null,
      mailchimpSelectedResumeMode: providerContract.handoff.manifest.mailchimp?.mode || null,
      mailchimpMissingAcknowledgements: providerContract.handoff.manifest.mailchimp?.acknowledgements.missing || [],
      externalHandoffState: providerContract.handoff.state,
      externalHandoffManifestId: providerContract.handoff.manifest.id,
      externalHandoffManifestReady: providerContract.handoff.manifest.transferable,
      externalHandoffServiceRefs: providerContract.handoff.manifest.serviceRefs.map((service) => service.id),
      externalHandoffSyncCursor: providerContract.handoff.manifest.syncCursor,
      externalHandoffSyncSequence: providerContract.handoff.manifest.syncSequence,
      syncConflict: providerContract.sync.conflict,
      clientSessionId: clientRuntime.sessionId,
      clientCanReleaseControl: clientRuntime.canReleaseControl,
      clientWorkflowActionCount: clientRuntime.workflowActions.length,
      clientUnresolvedRequiredActionCount: clientRuntime.unresolvedRequiredActionCount,
      clientStateExportReady: clientRuntime.stateExport.ready,
      clientStateExportTargets: clientRuntime.stateExport.targets,
      clientHandoffTicketId: clientRuntime.handoffTicket.id,
      clientHandoffRequiredActionIds: clientRuntime.handoffTicket.requiredActionIds,
      workflowHandoffState: workflowHandoff.state,
      workflowHandoffStateExportReady: workflowHandoff.stateExport.ready,
      persistedStateStatus: persistedState.status,
      persistedCommandId: persistedState.commandId,
      persistedCommandAlreadyApplied: persistedState.commandAlreadyApplied,
      persistedSafeToReplay: persistedState.restart.safeToReplay,
      persistedSnapshotVersion: persistedState.snapshot.version,
      persistedRecoveryPath: persistedState.recoveryPath,
      persistedWriteBarrierOpen: persistedState.writeBarrier.open,
      persistedJournalEntryCount: persistedState.journal.count,
      persistedDeterministicOutcomeStatus: persistedState.deterministicOutcome.status,
      persistedDeterministicOutcomeProofSubjects: persistedState.deterministicOutcome.proofSubjects,
      resumeLeaseSchema: resumeLease.schema,
      resumeLeaseState: resumeLease.state,
      resumeLeaseHolderId: resumeLease.holderId,
      resumeLeaseRequired: resumeLease.required,
      resumeLeaseFencingToken: resumeLease.fencing.token,
      resumeLeaseExpiresAt: resumeLease.expiresAt,
      resumeLeaseCanProceed: resumeLease.canProceed,
      resumeGuardState: resumeGuard.state,
      resumeGuardReady: resumeGuard.ready,
      resumeGuardCheckpointId: resumeGuard.checkpointId,
      resumeClaimSchema: resumeGuard.claim.schema,
      resumeClaimId: resumeGuard.claim.id,
      resumeClaimState: resumeGuard.claim.state,
      resumeClaimReplayDisposition: resumeGuard.claim.replayDisposition,
      resumeClaimOwnerId: resumeGuard.claim.ownerId,
      resumeClaimConflictingClaimId: resumeGuard.claim.conflictingClaimId,
      resumeClaimBlockers: resumeGuard.claim.blockers,
      resumeClaimWarnings: resumeGuard.claim.warnings,
      resumeGuardBlockers: resumeGuard.blockers,
      resumeGuardWarnings: resumeGuard.warnings,
      resumeGuardProofSubjects: resumeGuard.proofSubjects,
      resumeGuardNextAction: resumeGuard.nextAction,
      operationalHealthSchema: operationalHealth.schema,
      operationalStatus: operationalHealth.status,
      operationalFailureState: operationalHealth.failureState,
      retryBackoffMs: operationalHealth.retryPolicy.backoffMs,
      nextRetryAt: operationalHealth.retryPolicy.nextRetryAt,
      degradedModeActive: operationalHealth.degradedMode.active,
      operationalRecoveryPlanId: operationalHealth.recoveryPlan.planId,
      operationalRecoveryPlanState: operationalHealth.recoveryPlan.state,
      operationalRecoveryNextPhase: operationalHealth.recoveryPlan.nextPhase?.id || null,
      operationalRecoveryOperatorAction: operationalHealth.recoveryPlan.operatorAction,
      operationalRecoveryProofSubjects: operationalHealth.recoveryPlan.proofSubjects,
      retryGateEligible: operationalHealth.recoveryPlan.retryGate.eligible,
      retryGateBlockedBy: operationalHealth.recoveryPlan.retryGate.blockedBy,
      degradedGateAdmitted: operationalHealth.recoveryPlan.degradedGate.admitted,
      operatorRecoveryDecisionState: operatorRecoveryDecision.state,
      operatorRecoveryDecisionDomain: operatorRecoveryDecision.primaryDomain,
      operatorRecoveryDecisionNextAction: operatorRecoveryDecision.nextAction,
      operatorRecoveryDecisionRetryable: operatorRecoveryDecision.retryable,
      operatorRecoveryDecisionBlockedReasons: operatorRecoveryDecision.blockedReasons,
      operatorMessage: operationalHealth.operatorMessage,
      historyDigestSchema: analytics.history.schema,
      historyCurrentStreak: analytics.history.currentStreak,
      historyRecentFailureRate: analytics.rates.recentHistoryFailureRate,
      historyLatestFailureAt: analytics.history.latestFailureAt,
      historyLatestFailureCodes: analytics.history.latestFailureCodes,
      historyRegressionDetected: analytics.flags.historyRegressionDetected,
      historyRecoveredAfterFailure: analytics.flags.historyRecoveredAfterFailure,
      clientPreviewSchema: clientPreview.schema,
      clientPreviewRoute: clientPreview.route.current,
      clientPreviewAcceptRoute: clientPreview.route.accept,
      clientPreviewStatus: clientPreview.header.status,
      clientPreviewResumeEnabled: clientPreview.resumeControl.enabled,
      clientPreviewDisabledReasons: clientPreview.resumeControl.disabledReasons,
      clientPreviewWorkflowActionCount: clientPreview.workflow.actions.length,
      clientPreviewProofSubjects: clientPreview.proofSubjects
    },
    analytics,
    history: {
      limit: MAX_HISTORY_SNAPSHOTS,
      digest: analytics.history,
      snapshots: historySnapshots,
      latest: historySnapshots[historySnapshots.length - 1] || null
    },
    timeline,
    reporting,
    errors: actionableErrors,
    evidence
  };

  return {
    ...state,
    export: buildExportSummary(state)
  };
}

export default describeResumeTokenSurface;
