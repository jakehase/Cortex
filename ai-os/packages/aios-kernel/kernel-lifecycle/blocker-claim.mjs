export const surfaceId = "aios_kernel-lifecycle_blocker-claim_004";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "blocker-claim";

const REQUIRED_CLAIM_FIELDS = ['claimId', 'blockerId', 'owner', 'reason'];
const TRANSIENT_FAILURES = new Set(['timeout', 'host_unreachable', 'lease_conflict', 'proof_pending']);
const TERMINAL_FAILURES = new Set(['invalid_claim', 'missing_owner', 'stale_blocker', 'policy_denied']);
const LIFECYCLE_MODES = new Set(['manual', 'automatic', 'scheduled']);
const SCHEDULE_CADENCES = new Set(['on-demand', 'once', 'hourly', 'daily', 'weekly']);
const HEALTH_SEVERITIES = new Set(['info', 'warning', 'critical']);
const HEALTH_SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };
const HEALTH_DEPENDENCY_KINDS = new Set(['claim-store', 'lease-manager', 'audit-ledger', 'provider-sync', 'operator-channel', 'unknown']);
const HANDOFF_TARGET_KINDS = new Set(['provider-endpoint', 'ticket-queue', 'incident-channel', 'kernel-route']);
const HANDOFF_RECEIPT_STATES = new Set(['missing', 'pending', 'accepted', 'rejected']);
const CLIENT_INTENTS = new Set(['preview', 'claim', 'retry', 'handoff', 'export', 'audit']);
const CLIENT_CHANNELS = new Set(['web', 'cli', 'api', 'system']);
const CLIENT_HANDOFF_PREFERENCES = new Set(['local-first', 'external-first', 'external-required']);
const SETTINGS_CONTROL_COMMANDS = new Set([
  'enable-lifecycle',
  'disable-lifecycle',
  'enable-claiming',
  'disable-claiming',
  'enable-mutation',
  'disable-mutation',
  'update-schedule',
  'clear-schedule'
]);
const REQUIRED_PROVIDER_CAPABILITIES = ['claim-sync', 'audit-proof'];
const OPTIONAL_PROVIDER_CAPABILITIES = ['external-handoff', 'retry-schedule', 'health-mirror'];
const MAILCHIMP_PROVIDER_CAPABILITIES = ['claim-sync', 'audit-proof', 'external-handoff', 'health-mirror'];
const MAILCHIMP_AUDIENCE_HANDOFF_EVENTS = ['audience.sync', 'campaign.send', 'webhook.replay'];
const PROVIDER_SYNC_MODES = new Set(['pull', 'push', 'bidirectional']);
const PROVIDER_AUTH_SCHEMES = new Set(['none', 'signed-request', 'service-token', 'mtls']);
const PROVIDER_CONSISTENCY_LEVELS = new Set(['best-effort', 'read-your-writes', 'strict']);
const PROVIDER_MAX_SYNC_LAG_MS = 5 * 60 * 1000;
const PROVIDER_HANDOFF_ACK_DEADLINE_MS = 15 * 60 * 1000;
const PROVIDER_SYNC_FRESHNESS_BLOCKERS = {
  invalidTimestamp: 'sync_timestamp_invalid',
  futureTimestamp: 'sync_timestamp_future',
  lagExceeded: 'sync_metadata_stale',
  explicitlyStale: 'sync_marked_stale'
};
const MAX_RETRY_ATTEMPTS = 5;
const PERSISTED_STATES = new Set(['accepted', 'blocked', 'retrying', 'handoff-pending', 'completed', 'paused']);
const TERMINAL_PERSISTED_STATES = new Set(['completed', 'blocked']);
const INFLIGHT_PERSISTED_STATES = new Set(['accepted', 'retrying', 'handoff-pending']);
const PERSISTED_COMMAND_STATES = new Set(['pending', 'committed', 'replayed', 'failed']);
const EXPORT_FORMATS = new Set(['json', 'csv', 'ndjson']);
const ROLE_PERMISSIONS = {
  owner: ['blocker:read', 'blocker:claim', 'blocker:mutate', 'blocker:handoff', 'blocker:audit'],
  maintainer: ['blocker:read', 'blocker:claim', 'blocker:mutate', 'blocker:audit'],
  responder: ['blocker:read', 'blocker:claim', 'blocker:audit'],
  auditor: ['blocker:read', 'blocker:audit'],
  observer: ['blocker:read']
};
const REQUIRED_BOUNDARY_PERMISSIONS = ['blocker:read', 'blocker:claim', 'blocker:mutate'];

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: asNonEmptyString(entry.id) || `evidence-${index + 1}`,
      type: asNonEmptyString(entry.type) || 'runtime-observation',
      source: asNonEmptyString(entry.source) || 'hosted-kernel',
      at: asNonEmptyString(entry.at) || null,
      ok: entry.ok !== false
    }));
}

function normalizeHealthChecks(checks) {
  if (!Array.isArray(checks)) {
    return [];
  }

  return checks
    .filter((check) => check && typeof check === 'object')
    .map((check, index) => {
      const name = asNonEmptyString(check.name) || `dependency-${index + 1}`;
      const ok = check.ok === true;
      const required = check.required !== false;
      const rawSeverity = asNonEmptyString(check.severity);
      const rawKind = asNonEmptyString(check.kind) || asNonEmptyString(check.dependencyKind);
      const staleAfterMs = asNonNegativeInteger(check.staleAfterMs, 0);

      return {
        name,
        ok,
        required,
        kind: HEALTH_DEPENDENCY_KINDS.has(rawKind) ? rawKind : 'unknown',
        severity: HEALTH_SEVERITIES.has(rawSeverity)
          ? rawSeverity
          : ok
            ? 'info'
            : required
              ? 'critical'
              : 'warning',
        message: asNonEmptyString(check.message),
        action: asNonEmptyString(check.action),
        observedAt: asNonEmptyString(check.observedAt) || asNonEmptyString(check.checkedAt) || null,
        staleAfterMs,
        retryAfterMs: asNonNegativeInteger(check.retryAfterMs, 0),
        observedLatencyMs: asNonNegativeInteger(check.observedLatencyMs ?? check.latencyMs, 0),
        degradedModeAllowed: check.degradedModeAllowed !== false
      };
    });
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => asNonEmptyString(item)).filter(Boolean))];
}

function isMailchimpProvider(provider) {
  return [
    provider.providerId,
    provider.service,
    provider.endpoint,
    provider.serviceContract?.serviceKey,
    provider.serviceContract?.schemaVersion,
    provider.mailchimp?.accountId
  ].some((value) => String(value || '').toLowerCase().includes('mailchimp'));
}

function normalizeMailchimpProviderContract(provider, contract, handoff) {
  const rawMailchimp = provider.mailchimp && typeof provider.mailchimp === 'object'
    ? provider.mailchimp
    : contract.mailchimp && typeof contract.mailchimp === 'object'
      ? contract.mailchimp
      : {};
  const accountId = asNonEmptyString(rawMailchimp.accountId)
    || asNonEmptyString(rawMailchimp.dc)
    || asNonEmptyString(provider.mailchimpAccountId);
  const audienceIds = normalizeStringList(rawMailchimp.audienceIds || rawMailchimp.lists || provider.audienceIds);
  const requestedEvents = normalizeStringList(rawMailchimp.events || rawMailchimp.handoffEvents || handoff.events);
  const acceptedEvents = requestedEvents.length
    ? requestedEvents.filter((event) => MAILCHIMP_AUDIENCE_HANDOFF_EVENTS.includes(event))
    : [];

  return {
    product: 'mailchimp',
    detected: Boolean(accountId || audienceIds.length || requestedEvents.length || isMailchimpProvider({
      ...provider,
      serviceContract: contract
    })),
    accountId: accountId || null,
    audienceIds,
    requestedEvents,
    acceptedEvents,
    rejectedEvents: requestedEvents.filter((event) => !MAILCHIMP_AUDIENCE_HANDOFF_EVENTS.includes(event)),
    webhookRoute: asNonEmptyString(rawMailchimp.webhookRoute)
      || asNonEmptyString(contract.webhookRoute)
      || asNonEmptyString(handoff.webhookRoute)
      || asNonEmptyString(provider.webhookRoute),
    webhookSecretRef: asNonEmptyString(rawMailchimp.webhookSecretRef)
      || asNonEmptyString(rawMailchimp.secretRef)
      || asNonEmptyString(provider.webhookSecretRef),
    requiresExternalHandoff: handoff.requested === true || acceptedEvents.some((event) => event !== 'audience.sync')
  };
}

function normalizeBoundaryContext(input) {
  const rawBoundary = input.boundary && typeof input.boundary === 'object'
    ? input.boundary
    : input.tenantContext && typeof input.tenantContext === 'object'
      ? input.tenantContext
      : {};
  const rawWorkspace = input.workspaceScope && typeof input.workspaceScope === 'object'
    ? input.workspaceScope
    : input.workspace && typeof input.workspace === 'object'
      ? input.workspace
      : {};
  const rawPrincipal = input.principal && typeof input.principal === 'object'
    ? input.principal
    : input.actor && typeof input.actor === 'object'
      ? input.actor
      : {};
  const roles = normalizeStringList(rawPrincipal.roles || input.roles);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const permissions = [...new Set([...normalizeStringList(rawPrincipal.permissions || input.permissions), ...rolePermissions])];
  const tenantId = asNonEmptyString(rawBoundary.tenantId) || asNonEmptyString(input.tenantId);
  const workspaceId = asNonEmptyString(rawWorkspace.workspaceId)
    || asNonEmptyString(rawBoundary.workspaceId)
    || asNonEmptyString(input.workspaceId);
  const claimTenantId = asNonEmptyString(input.claimTenantId)
    || asNonEmptyString(rawBoundary.claimTenantId)
    || tenantId;
  const claimWorkspaceId = asNonEmptyString(input.claimWorkspaceId)
    || asNonEmptyString(rawBoundary.claimWorkspaceId)
    || workspaceId;
  const allowedWorkspaces = normalizeStringList(rawWorkspace.allowedWorkspaces || rawBoundary.allowedWorkspaces);
  const allowedTenantHandoffs = normalizeStringList(rawBoundary.allowedTenantHandoffs || rawBoundary.handoffTenantAllowlist);
  const handoffTenantId = asNonEmptyString(rawBoundary.handoffTenantId) || asNonEmptyString(input.handoffTenantId);
  const workspaceAllowed = !workspaceId || allowedWorkspaces.length === 0 || allowedWorkspaces.includes(workspaceId);
  const tenantMatches = !tenantId || !claimTenantId || tenantId === claimTenantId;
  const workspaceMatches = !workspaceId || !claimWorkspaceId || workspaceId === claimWorkspaceId;
  const handoffTenantAllowed = !handoffTenantId
    || handoffTenantId === tenantId
    || allowedTenantHandoffs.includes(handoffTenantId);

  return {
    tenantId,
    workspaceId,
    claimTenantId,
    claimWorkspaceId,
    workspaceAllowed,
    tenantMatches,
    workspaceMatches,
    handoffTenantId,
    handoffTenantAllowed,
    allowedWorkspaces,
    allowedTenantHandoffs,
    principal: {
      id: asNonEmptyString(rawPrincipal.id) || asNonEmptyString(rawPrincipal.actorId) || asNonEmptyString(input.owner),
      roles,
      permissions
    },
    permissionChecks: {
      canRead: permissions.includes('blocker:read'),
      canClaim: permissions.includes('blocker:claim'),
      canMutate: permissions.includes('blocker:mutate'),
      canHandoff: permissions.includes('blocker:handoff'),
      canAudit: permissions.includes('blocker:audit')
    }
  };
}

function buildBoundaryValidation(boundary) {
  const errors = [];

  if (!boundary.tenantId) {
    errors.push({
      code: 'missing_tenant_scope',
      field: 'tenantContext.tenantId',
      message: 'Hosted-kernel blocker claims require an explicit tenant boundary.',
      action: 'Attach tenantContext.tenantId before evaluating or mutating the blocker claim.'
    });
  }

  if (!boundary.workspaceId) {
    errors.push({
      code: 'missing_workspace_scope',
      field: 'workspaceScope.workspaceId',
      message: 'Hosted-kernel blocker claims require an explicit workspace boundary.',
      action: 'Attach workspaceScope.workspaceId so lifecycle state cannot cross workspace ownership.'
    });
  }

  if (!boundary.principal.id) {
    errors.push({
      code: 'missing_principal',
      field: 'principal.id',
      message: 'Blocker claim mutation requires an authenticated principal.',
      action: 'Provide principal.id with roles or permissions for the hosted-kernel operator.'
    });
  }

  if (!boundary.tenantMatches) {
    errors.push({
      code: 'tenant_scope_mismatch',
      field: 'claimTenantId',
      message: 'Incoming blocker claim tenant does not match the active hosted-kernel tenant boundary.',
      action: 'Route the claim through the matching tenant boundary or create a tenant-approved handoff.'
    });
  }

  if (!boundary.workspaceMatches) {
    errors.push({
      code: 'workspace_scope_mismatch',
      field: 'claimWorkspaceId',
      message: 'Incoming blocker claim workspace does not match the active workspace boundary.',
      action: 'Route the claim through the matching workspace or request a workspace-scoped handoff.'
    });
  }

  if (!boundary.workspaceAllowed) {
    errors.push({
      code: 'workspace_not_allowed',
      field: 'workspaceScope.allowedWorkspaces',
      message: 'Principal is not allowed to operate in the requested workspace boundary.',
      action: 'Add the workspace to allowedWorkspaces or use a principal assigned to this workspace.'
    });
  }

  REQUIRED_BOUNDARY_PERMISSIONS
    .filter((permission) => !boundary.principal.permissions.includes(permission))
    .forEach((permission) => {
      errors.push({
        code: 'missing_boundary_permission',
        field: 'principal.permissions',
        message: `Principal is missing required blocker-claim permission ${permission}.`,
        action: `Grant ${permission} through a role or direct permission before enabling lifecycle mutation.`
      });
    });

  if (boundary.handoffTenantId && !boundary.handoffTenantAllowed) {
    errors.push({
      code: 'handoff_tenant_not_allowed',
      field: 'tenantContext.allowedTenantHandoffs',
      message: 'External handoff targets a tenant outside the approved boundary.',
      action: 'Add the handoff tenant to allowedTenantHandoffs or keep the blocker claim under local tenant control.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    requiredPermissions: REQUIRED_BOUNDARY_PERMISSIONS,
    isolationMode: boundary.tenantId && boundary.workspaceId ? 'tenant-workspace' : 'unscoped-safe-mode',
    safeToMutate: errors.length === 0
  };
}

function asNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function addMillisecondsToTimestamp(value, deltaMs) {
  const baseMs = parseTimestampMs(value);

  return baseMs === null ? null : new Date(baseMs + deltaMs).toISOString();
}

function buildTimestampFreshness(value, now, maxAgeMs) {
  const supplied = value !== undefined && value !== null && value !== '';
  const timestampMs = parseTimestampMs(value);
  const nowMs = parseTimestampMs(now);
  const valid = !supplied || timestampMs !== null;
  const ageMs = supplied && valid && nowMs !== null
    ? nowMs - timestampMs
    : null;
  const future = Number.isFinite(ageMs) && ageMs < 0;
  const stale = Number.isFinite(ageMs) && Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && ageMs > maxAgeMs;

  return {
    supplied,
    valid,
    observedAt: supplied && valid ? new Date(timestampMs).toISOString() : null,
    ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
    maxAgeMs: Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? maxAgeMs : null,
    future,
    stale,
    status: !valid
      ? 'invalid'
      : future
        ? 'future'
        : stale
          ? 'stale'
          : supplied
            ? 'fresh'
            : 'missing'
  };
}

function buildProviderSyncFreshness(provider, now) {
  const timestamp = buildTimestampFreshness(provider.sync.lastSyncedAt, now, provider.sync.maxLagMs);
  const blockers = [
    timestamp.supplied && !timestamp.valid ? PROVIDER_SYNC_FRESHNESS_BLOCKERS.invalidTimestamp : null,
    timestamp.future ? PROVIDER_SYNC_FRESHNESS_BLOCKERS.futureTimestamp : null,
    timestamp.stale ? PROVIDER_SYNC_FRESHNESS_BLOCKERS.lagExceeded : null,
    provider.sync.stale ? PROVIDER_SYNC_FRESHNESS_BLOCKERS.explicitlyStale : null
  ].filter(Boolean);
  const nextAction = blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.invalidTimestamp)
    ? 'repair-provider-sync-timestamp'
    : blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.futureTimestamp)
      ? 'wait-for-provider-clock-or-resync'
      : blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.lagExceeded) ||
        blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.explicitlyStale)
        ? 'refresh-provider-sync'
        : 'none';

  return {
    contractVersion: 1,
    providerId: provider.providerId,
    serviceKey: provider.serviceContract.serviceKey,
    cursor: provider.sync.cursor || null,
    watermark: provider.sync.watermark || null,
    lastSyncedAt: timestamp.observedAt,
    freshness: timestamp,
    blockers,
    current: blockers.length === 0,
    nextAction
  };
}

function normalizePersistedState(input) {
  const raw = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const rawStatus = asNonEmptyString(raw.status) || asNonEmptyString(raw.state);
  const commandReceipts = Array.isArray(raw.commandReceipts) ? raw.commandReceipts : [];
  const pendingCommands = Array.isArray(raw.pendingCommands) ? raw.pendingCommands : [];
  const lastCommand = raw.lastCommand && typeof raw.lastCommand === 'object' ? raw.lastCommand : {};
  const journal = raw.journal && typeof raw.journal === 'object' ? raw.journal : {};
  const lease = raw.lease && typeof raw.lease === 'object'
    ? raw.lease
    : raw.stateLease && typeof raw.stateLease === 'object'
      ? raw.stateLease
      : {};

  return {
    status: PERSISTED_STATES.has(rawStatus) ? rawStatus : 'paused',
    version: asNonNegativeInteger(raw.version, 0),
    claimId: asNonEmptyString(raw.claimId),
    blockerId: asNonEmptyString(raw.blockerId),
    owner: asNonEmptyString(raw.owner),
    updatedAt: asNonEmptyString(raw.updatedAt) || asNonEmptyString(raw.persistedAt) || null,
    recoveryEpoch: asNonNegativeInteger(raw.recoveryEpoch, 0),
    restartCount: asNonNegativeInteger(raw.restartCount, 0),
    dirty: raw.dirty === true,
    recoveredFromJournal: raw.recoveredFromJournal === true,
    journal: {
      durable: journal.durable !== false,
      cursor: asNonEmptyString(journal.cursor) || asNonEmptyString(raw.journalCursor),
      lastEntryId: asNonEmptyString(journal.lastEntryId),
      checksum: asNonEmptyString(journal.checksum),
      sequence: asNonNegativeInteger(journal.sequence ?? raw.journalSequence, 0),
      committedThrough: asNonNegativeInteger(journal.committedThrough ?? raw.journalCommittedThrough, 0),
      replayFrom: asNonNegativeInteger(journal.replayFrom ?? raw.journalReplayFrom, 0)
    },
    lease: {
      token: asNonEmptyString(lease.token) || asNonEmptyString(raw.leaseToken),
      holder: asNonEmptyString(lease.holder),
      version: asNonNegativeInteger(lease.version ?? raw.leaseVersion, 0),
      fencingToken: asNonEmptyString(lease.fencingToken),
      expiresAt: asNonEmptyString(lease.expiresAt)
    },
    lastCommand: {
      idempotencyKey: asNonEmptyString(lastCommand.idempotencyKey),
      command: asNonEmptyString(lastCommand.command),
      state: asNonEmptyString(lastCommand.state) || 'unknown',
      at: asNonEmptyString(lastCommand.at)
    },
    commandReceipts: commandReceipts
      .filter((receipt) => receipt && typeof receipt === 'object')
      .map((receipt, index) => ({
        idempotencyKey: asNonEmptyString(receipt.idempotencyKey) || `receipt-${index + 1}`,
        command: asNonEmptyString(receipt.command) || 'unknown-command',
        state: asNonEmptyString(receipt.state) || 'committed',
        at: asNonEmptyString(receipt.at)
      })),
    pendingCommands: pendingCommands
      .filter((command) => command && typeof command === 'object')
      .map((command, index) => {
        const rawCommandState = asNonEmptyString(command.state);

        return {
          idempotencyKey: asNonEmptyString(command.idempotencyKey) || `pending-${index + 1}`,
          command: asNonEmptyString(command.command) || 'unknown-command',
          state: PERSISTED_COMMAND_STATES.has(rawCommandState) ? rawCommandState : 'pending',
          at: asNonEmptyString(command.at),
          requestedBy: asNonEmptyString(command.requestedBy)
        };
      })
  };
}

function buildRestartRecovery({ persistedState, claim, clientRequest, now }) {
  const identityMismatch = Boolean(
    (persistedState.claimId && claim.claimId && persistedState.claimId !== claim.claimId)
    || (persistedState.blockerId && claim.blockerId && persistedState.blockerId !== claim.blockerId)
  );
  const terminal = TERMINAL_PERSISTED_STATES.has(persistedState.status);
  const inflight = INFLIGHT_PERSISTED_STATES.has(persistedState.status);
  const journalGap = persistedState.journal.sequence > persistedState.journal.committedThrough;
  const journalCursorMissing = journalGap && !persistedState.journal.cursor;
  const pendingCommandCount = persistedState.pendingCommands.filter((command) => command.state === 'pending').length;
  const leaseExpired = parseTimestampMs(persistedState.lease.expiresAt) !== null
    && parseTimestampMs(now) !== null
    && parseTimestampMs(persistedState.lease.expiresAt) <= parseTimestampMs(now);
  const leaseConflict = clientRequest.stateLease.required
    && persistedState.lease.token
    && clientRequest.stateLease.token
    && persistedState.lease.token !== clientRequest.stateLease.token;
  const staleClientLease = clientRequest.stateLease.required
    && persistedState.lease.version > 0
    && clientRequest.stateLease.version > 0
    && clientRequest.stateLease.version < persistedState.lease.version;
  const replayRequired = !identityMismatch && (
    persistedState.dirty
    || journalGap
    || pendingCommandCount > 0
    || (inflight && !persistedState.lastCommand.at)
  );
  const restartSafe = !identityMismatch
    && !leaseConflict
    && !staleClientLease
    && !leaseExpired
    && !journalCursorMissing
    && !persistedState.dirty
    && persistedState.journal.durable
    && (!inflight || persistedState.recoveredFromJournal);
  const blockers = [
    ...(identityMismatch ? ['identity_mismatch'] : []),
    ...(leaseConflict ? ['lease_token_conflict'] : []),
    ...(staleClientLease ? ['stale_client_lease'] : []),
    ...(leaseExpired ? ['persisted_lease_expired'] : []),
    ...(journalCursorMissing ? ['journal_cursor_missing'] : []),
    ...(!persistedState.journal.durable ? ['journal_not_durable'] : []),
    ...(persistedState.dirty ? ['dirty_state'] : []),
    ...(journalGap ? ['journal_gap'] : []),
    ...(pendingCommandCount > 0 ? ['pending_commands'] : [])
  ];

  return {
    checkedAt: now,
    status: persistedState.status,
    restartSafe,
    replayRequired,
    terminal,
    inflight,
    journalGap,
    journalCursorMissing,
    pendingCommandCount,
    leaseExpired,
    leaseConflict,
    staleClientLease,
    blockers,
    recoveryEpoch: persistedState.recoveryEpoch + (replayRequired ? 1 : 0),
    reason: identityMismatch
      ? 'Persisted blocker-claim identity does not match the incoming claim.'
      : leaseConflict
        ? 'Client state lease does not match the persisted hosted-kernel lease.'
        : staleClientLease
          ? 'Client state lease version is older than the persisted hosted-kernel lease version.'
          : journalCursorMissing
            ? 'Persisted blocker-claim journal has unapplied entries but no replay cursor.'
      : replayRequired
        ? 'Persisted blocker-claim state needs journal replay before command mutation.'
        : terminal
          ? 'Persisted blocker-claim state is terminal and can be reported without mutation.'
          : 'Persisted blocker-claim state is restart-safe for hosted-kernel command evaluation.'
  };
}

function buildRecoveryPlan({ persistedState, recovery, claim, clientRequest, now }) {
  const replayFrom = persistedState.journal.replayFrom > 0
    ? persistedState.journal.replayFrom
    : Math.min(persistedState.journal.committedThrough + 1, persistedState.journal.sequence);
  const replayTo = persistedState.journal.sequence;
  const leaseRenewalRequired = recovery.leaseConflict
    || recovery.staleClientLease
    || recovery.leaseExpired
    || (clientRequest.stateLease.required && !clientRequest.stateLease.token);
  const commands = [
    {
      command: 'replay-journal',
      enabled: recovery.replayRequired && !recovery.journalCursorMissing,
      idempotencyKey: `${surfaceId}:${claim.claimId || 'unassigned-claim'}:${persistedState.version}:replay:${replayFrom}-${replayTo}`,
      reason: recovery.journalGap
        ? `Replay persisted blocker-claim journal entries ${replayFrom} through ${replayTo}.`
        : 'Replay pending blocker-claim command receipts before accepting new mutation.'
    },
    {
      command: 'renew-state-lease',
      enabled: leaseRenewalRequired,
      idempotencyKey: `${surfaceId}:${claim.claimId || 'unassigned-claim'}:${persistedState.version}:lease:${clientRequest.stateLease.version}`,
      reason: recovery.leaseConflict
        ? 'Renew the client state lease because the persisted lease token differs.'
        : recovery.staleClientLease
          ? 'Renew the client state lease because its version is behind persisted state.'
          : recovery.leaseExpired
            ? 'Renew the persisted hosted-kernel state lease before mutation.'
            : 'Confirm the requested state lease before applying blocker-claim mutation.'
    },
    {
      command: 'compact-command-receipts',
      enabled: persistedState.commandReceipts.length > 25 && !recovery.replayRequired,
      idempotencyKey: `${surfaceId}:${claim.claimId || 'unassigned-claim'}:${persistedState.version}:compact-receipts`,
      reason: 'Compact persisted blocker-claim command receipts after restart-safe recovery.'
    }
  ];
  const enabledCommands = commands.filter((command) => command.enabled);

  return {
    contractVersion: 1,
    generatedAt: now,
    restartStatus: recovery.restartSafe
      ? 'restart-safe'
      : recovery.replayRequired
        ? 'replay-required'
        : recovery.terminal
          ? 'terminal'
          : 'operator-review',
    replayRange: recovery.replayRequired
      ? {
          cursor: persistedState.journal.cursor || null,
          from: replayFrom,
          to: replayTo,
          pendingCommands: recovery.pendingCommandCount
        }
      : null,
    lease: {
      persistedVersion: persistedState.lease.version,
      requestedVersion: clientRequest.stateLease.version,
      holder: persistedState.lease.holder || clientRequest.stateLease.holder,
      expiresAt: persistedState.lease.expiresAt || clientRequest.stateLease.expiresAt || null,
      renewalRequired: leaseRenewalRequired
    },
    blockers: recovery.blockers,
    nextRecoveryCommand: enabledCommands[0]?.command || (recovery.restartSafe ? 'none' : 'operator-remediation'),
    commands
  };
}

function buildCommandIdempotency({ command, claim, persistedState, recovery }) {
  const idempotencyKey = command.idempotencyKey || [
    surfaceId,
    claim.claimId || 'unassigned-claim',
    claim.blockerId || 'unassigned-blocker',
    command.command,
    persistedState.version
  ].join(':');
  const matchingReceipt = persistedState.commandReceipts.find((receipt) => receipt.idempotencyKey === idempotencyKey);
  const terminalReplay = recovery.terminal && command.command !== 'pause-claim';

  return {
    ...command,
    idempotencyKey,
    idempotent: true,
    replay: Boolean(matchingReceipt),
    persistedReceiptState: matchingReceipt?.state || null,
    enabled: command.enabled && recovery.restartSafe && !recovery.replayRequired && !terminalReplay,
    restartSafe: recovery.restartSafe && !recovery.replayRequired,
    reason: matchingReceipt
      ? `Command ${command.command} already has persisted receipt ${matchingReceipt.state}.`
      : terminalReplay
        ? 'Persisted terminal blocker-claim state prevents duplicate lifecycle mutation.'
        : !recovery.restartSafe
          ? recovery.reason
        : recovery.replayRequired
          ? recovery.reason
          : command.reason
  };
}

function normalizeLifecycleSettings(input) {
  const raw = input.lifecycleSettings && typeof input.lifecycleSettings === 'object'
    ? input.lifecycleSettings
    : input.settings && typeof input.settings === 'object'
      ? input.settings
      : {};
  const rawMode = asNonEmptyString(raw.mode);
  const schedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};

  return {
    enabled: asBoolean(raw.enabled, true),
    claimingEnabled: asBoolean(raw.claimingEnabled, true),
    mutationEnabled: asBoolean(raw.mutationEnabled ?? raw.allowMutation, true),
    mode: LIFECYCLE_MODES.has(rawMode) ? rawMode : 'manual',
    pauseReason: asNonEmptyString(raw.pauseReason),
    requireEvidence: asBoolean(raw.requireEvidence, true),
    requireHealthChecks: asBoolean(raw.requireHealthChecks, true),
    requireManualApproval: asBoolean(raw.requireManualApproval, false),
    approvalTicket: asNonEmptyString(raw.approvalTicket),
    autoRetryEnabled: asBoolean(raw.autoRetryEnabled ?? raw.autoRetry, false),
    schedule: {
      enabled: asBoolean(schedule.enabled, rawMode === 'scheduled'),
      timezone: asNonEmptyString(schedule.timezone) || 'UTC',
      windowStart: asNonEmptyString(schedule.windowStart),
      windowEnd: asNonEmptyString(schedule.windowEnd),
      nextRunAt: asNonEmptyString(schedule.nextRunAt),
      cadence: SCHEDULE_CADENCES.has(asNonEmptyString(schedule.cadence))
        ? asNonEmptyString(schedule.cadence)
        : 'on-demand',
      maxClaimsPerWindow: asNonNegativeInteger(schedule.maxClaimsPerWindow, 0),
      dispatchedInWindow: asNonNegativeInteger(schedule.dispatchedInWindow, 0),
      manualOverrideAllowed: schedule.manualOverrideAllowed === true
    }
  };
}

function normalizeSettingsControlRequest(input, clientRequest) {
  const raw = input.settingsControl && typeof input.settingsControl === 'object'
    ? input.settingsControl
    : input.lifecycleControlRequest && typeof input.lifecycleControlRequest === 'object'
      ? input.lifecycleControlRequest
      : input.lifecycleCommand && typeof input.lifecycleCommand === 'object'
        ? input.lifecycleCommand
        : {};
  const rawCommand = asNonEmptyString(raw.command) || asNonEmptyString(raw.action) || clientRequest.requestedCommand;
  const schedulePatch = raw.schedule && typeof raw.schedule === 'object'
    ? raw.schedule
    : raw.schedulePatch && typeof raw.schedulePatch === 'object'
      ? raw.schedulePatch
      : {};
  const rawCadence = asNonEmptyString(schedulePatch.cadence);

  return {
    contractVersion: 1,
    requested: SETTINGS_CONTROL_COMMANDS.has(rawCommand),
    command: SETTINGS_CONTROL_COMMANDS.has(rawCommand) ? rawCommand : null,
    requestedBy: asNonEmptyString(raw.requestedBy) || clientRequest.stateLease.holder,
    reason: asNonEmptyString(raw.reason) || asNonEmptyString(raw.pauseReason),
    approvalTicket: asNonEmptyString(raw.approvalTicket),
    effectiveAt: asNonEmptyString(raw.effectiveAt),
    idempotencyKey: asNonEmptyString(raw.idempotencyKey),
    dryRun: raw.dryRun === true,
    schedulePatch: {
      enabled: typeof schedulePatch.enabled === 'boolean' ? schedulePatch.enabled : null,
      timezone: asNonEmptyString(schedulePatch.timezone),
      windowStart: asNonEmptyString(schedulePatch.windowStart),
      windowEnd: asNonEmptyString(schedulePatch.windowEnd),
      nextRunAt: asNonEmptyString(schedulePatch.nextRunAt),
      cadence: rawCadence,
      cadenceAccepted: !rawCadence || SCHEDULE_CADENCES.has(rawCadence),
      maxClaimsPerWindow: Number.isInteger(schedulePatch.maxClaimsPerWindow) && schedulePatch.maxClaimsPerWindow >= 0
        ? schedulePatch.maxClaimsPerWindow
        : null,
      resetDispatchedInWindow: schedulePatch.resetDispatchedInWindow === true
    }
  };
}

function buildSettingsControlValidation(controlRequest, boundary, settings) {
  const errors = [];
  const disablingCommand = controlRequest.command === 'disable-lifecycle'
    || controlRequest.command === 'disable-claiming'
    || controlRequest.command === 'disable-mutation';

  if (!controlRequest.requested) {
    return {
      ok: true,
      errors,
      commandReady: false,
      requiresMutationPermission: false
    };
  }

  if (!boundary.permissionChecks.canMutate) {
    errors.push({
      code: 'settings_control_permission_missing',
      field: 'principal.permissions',
      message: 'Lifecycle settings control commands require blocker mutation permission.',
      action: 'Grant blocker:mutate to the principal before changing blocker-claim lifecycle controls.'
    });
  }

  if (!controlRequest.requestedBy) {
    errors.push({
      code: 'settings_control_actor_missing',
      field: 'settingsControl.requestedBy',
      message: 'Lifecycle settings control commands require an accountable operator id.',
      action: 'Provide settingsControl.requestedBy or principal.id before applying lifecycle control changes.'
    });
  }

  if (disablingCommand && !controlRequest.reason) {
    errors.push({
      code: 'settings_control_reason_missing',
      field: 'settingsControl.reason',
      message: 'Disabling lifecycle, claiming, or mutation controls requires an operator reason.',
      action: 'Add settingsControl.reason so the hosted-kernel audit trail explains the control change.'
    });
  }

  if (settings.requireManualApproval && !controlRequest.approvalTicket) {
    errors.push({
      code: 'settings_control_approval_missing',
      field: 'settingsControl.approvalTicket',
      message: 'Lifecycle settings require manual approval before control changes can be applied.',
      action: 'Attach the approval ticket that authorizes this lifecycle settings command.'
    });
  }

  if (controlRequest.effectiveAt && parseTimestampMs(controlRequest.effectiveAt) === null) {
    errors.push({
      code: 'settings_control_invalid_effective_at',
      field: 'settingsControl.effectiveAt',
      message: 'Lifecycle settings control effectiveAt must be a parseable timestamp.',
      action: 'Provide settingsControl.effectiveAt as an ISO timestamp or remove it for immediate application.'
    });
  }

  if ((controlRequest.command === 'update-schedule' || controlRequest.command === 'clear-schedule') && settings.mode !== 'scheduled') {
    errors.push({
      code: 'settings_control_schedule_mode_required',
      field: 'lifecycleSettings.mode',
      message: 'Schedule control commands can only apply while lifecycleSettings.mode is scheduled.',
      action: 'Switch lifecycleSettings.mode to scheduled before updating or clearing schedule controls.'
    });
  }

  if (!controlRequest.schedulePatch.cadenceAccepted) {
    errors.push({
      code: 'settings_control_invalid_cadence',
      field: 'settingsControl.schedule.cadence',
      message: 'Lifecycle schedule cadence is not supported.',
      action: `Use one of ${[...SCHEDULE_CADENCES].join(', ')} for settingsControl.schedule.cadence.`
    });
  }

  if (controlRequest.schedulePatch.nextRunAt && parseTimestampMs(controlRequest.schedulePatch.nextRunAt) === null) {
    errors.push({
      code: 'settings_control_invalid_next_run',
      field: 'settingsControl.schedule.nextRunAt',
      message: 'Lifecycle schedule control nextRunAt must be a parseable timestamp.',
      action: 'Provide settingsControl.schedule.nextRunAt as an ISO timestamp.'
    });
  }

  if (controlRequest.schedulePatch.windowStart && parseScheduleWindowMinute(controlRequest.schedulePatch.windowStart) === null) {
    errors.push({
      code: 'settings_control_invalid_window_start',
      field: 'settingsControl.schedule.windowStart',
      message: 'Lifecycle schedule control windowStart must use HH:mm 24-hour time.',
      action: 'Set settingsControl.schedule.windowStart to a value such as 09:00.'
    });
  }

  if (controlRequest.schedulePatch.windowEnd && parseScheduleWindowMinute(controlRequest.schedulePatch.windowEnd) === null) {
    errors.push({
      code: 'settings_control_invalid_window_end',
      field: 'settingsControl.schedule.windowEnd',
      message: 'Lifecycle schedule control windowEnd must use HH:mm 24-hour time.',
      action: 'Set settingsControl.schedule.windowEnd to a value such as 17:00.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    commandReady: errors.length === 0,
    requiresMutationPermission: true
  };
}

function buildSettingsControlPlan({ controlRequest, controlValidation, settings, scheduleControl, claim, boundary, now }) {
  const basePatch = {
    enabled: settings.enabled,
    claimingEnabled: settings.claimingEnabled,
    mutationEnabled: settings.mutationEnabled,
    pauseReason: settings.pauseReason || null,
    schedule: settings.schedule
  };
  const schedulePatch = controlRequest.command === 'clear-schedule'
    ? {
        enabled: false,
        nextRunAt: null,
        windowStart: null,
        windowEnd: null,
        dispatchedInWindow: 0
      }
    : {
        ...(controlRequest.schedulePatch.enabled !== null ? { enabled: controlRequest.schedulePatch.enabled } : {}),
        ...(controlRequest.schedulePatch.timezone ? { timezone: controlRequest.schedulePatch.timezone } : {}),
        ...(controlRequest.schedulePatch.nextRunAt ? { nextRunAt: controlRequest.schedulePatch.nextRunAt } : {}),
        ...(controlRequest.schedulePatch.cadenceAccepted && controlRequest.schedulePatch.cadence ? { cadence: controlRequest.schedulePatch.cadence } : {}),
        ...(controlRequest.schedulePatch.windowStart ? { windowStart: controlRequest.schedulePatch.windowStart } : {}),
        ...(controlRequest.schedulePatch.windowEnd ? { windowEnd: controlRequest.schedulePatch.windowEnd } : {}),
        ...(controlRequest.schedulePatch.maxClaimsPerWindow !== null ? { maxClaimsPerWindow: controlRequest.schedulePatch.maxClaimsPerWindow } : {}),
        ...(controlRequest.schedulePatch.resetDispatchedInWindow ? { dispatchedInWindow: 0 } : {})
      };
  const patchByCommand = {
    'enable-lifecycle': { enabled: true, pauseReason: null },
    'disable-lifecycle': { enabled: false, pauseReason: controlRequest.reason },
    'enable-claiming': { claimingEnabled: true },
    'disable-claiming': { claimingEnabled: false },
    'enable-mutation': { mutationEnabled: true },
    'disable-mutation': { mutationEnabled: false },
    'update-schedule': { schedule: { ...settings.schedule, ...schedulePatch } },
    'clear-schedule': { schedule: { ...settings.schedule, ...schedulePatch } }
  };
  const statePatch = controlRequest.command ? patchByCommand[controlRequest.command] || {} : {};
  const enabled = controlRequest.requested && controlValidation.ok;
  const idempotencyKey = controlRequest.idempotencyKey || [
    surfaceId,
    claim.claimId || 'unassigned-claim',
    claim.blockerId || 'unassigned-blocker',
    'settings-control',
    controlRequest.command || 'none',
    boundary.principal.id || 'unassigned-operator'
  ].join(':');

  return {
    contractVersion: 1,
    requested: controlRequest.requested,
    command: controlRequest.command,
    enabled,
    dryRun: controlRequest.dryRun,
    requestedBy: controlRequest.requestedBy,
    effectiveAt: controlRequest.effectiveAt || now,
    idempotencyKey: controlRequest.requested ? idempotencyKey : null,
    currentState: basePatch,
    statePatch,
    resultingState: {
      ...basePatch,
      ...statePatch,
      schedule: statePatch.schedule || basePatch.schedule
    },
    scheduleImpact: {
      previousNextRunAt: settings.schedule.nextRunAt || null,
      nextRunAt: statePatch.schedule?.nextRunAt || settings.schedule.nextRunAt || null,
      previousAction: scheduleControl.nextAction,
      clearsWindow: controlRequest.command === 'clear-schedule',
      resetsWindowDispatchCount: controlRequest.schedulePatch.resetDispatchedInWindow || controlRequest.command === 'clear-schedule'
    },
    auditRecord: controlRequest.requested
      ? {
          recordType: 'blocker-claim-settings-control',
          surfaceId,
          claimId: claim.claimId,
          blockerId: claim.blockerId,
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          actor: controlRequest.requestedBy,
          command: controlRequest.command,
          reason: controlRequest.reason || null,
          approvalTicket: controlRequest.approvalTicket || null,
          dryRun: controlRequest.dryRun,
          generatedAt: now
        }
      : null,
    errors: controlValidation.errors
  };
}

function normalizeClientRequest(input, boundary) {
  const raw = input.clientRequest && typeof input.clientRequest === 'object'
    ? input.clientRequest
    : input.requestContext && typeof input.requestContext === 'object'
      ? input.requestContext
      : input.clientState && typeof input.clientState === 'object'
        ? input.clientState
        : {};
  const rawIntent = asNonEmptyString(raw.intent) || asNonEmptyString(input.intent);
  const rawChannel = asNonEmptyString(raw.channel) || asNonEmptyString(input.channel);
  const rawPreference = asNonEmptyString(raw.handoffPreference) || asNonEmptyString(raw.workflowHandoffPreference);
  const lease = raw.stateLease && typeof raw.stateLease === 'object'
    ? raw.stateLease
    : raw.lease && typeof raw.lease === 'object'
      ? raw.lease
      : {};
  const workflow = raw.workflowHandoff && typeof raw.workflowHandoff === 'object'
    ? raw.workflowHandoff
    : {};

  return {
    contractVersion: 1,
    requestId: asNonEmptyString(raw.requestId) || asNonEmptyString(input.requestId),
    correlationId: asNonEmptyString(raw.correlationId) || asNonEmptyString(input.correlationId),
    sessionId: asNonEmptyString(raw.sessionId) || asNonEmptyString(input.sessionId),
    channel: CLIENT_CHANNELS.has(rawChannel) ? rawChannel : 'api',
    intent: CLIENT_INTENTS.has(rawIntent) ? rawIntent : 'preview',
    requestedCommand: asNonEmptyString(raw.requestedCommand) || asNonEmptyString(input.requestedCommand),
    optimisticMutation: raw.optimisticMutation === true,
    visibleWorkflow: raw.visibleWorkflow !== false,
    handoffPreference: CLIENT_HANDOFF_PREFERENCES.has(rawPreference) ? rawPreference : 'local-first',
    returnRoute: asNonEmptyString(raw.returnRoute) || `${surfaceGroup}/${surfaceName}/preview`,
    stateLease: {
      required: lease.required === true || raw.requireStateLease === true,
      token: asNonEmptyString(lease.token) || asNonEmptyString(raw.stateLeaseToken),
      version: asNonNegativeInteger(lease.version, 0),
      expiresAt: asNonEmptyString(lease.expiresAt),
      holder: asNonEmptyString(lease.holder) || boundary.principal.id
    },
    workflowHandoff: {
      successRoute: asNonEmptyString(workflow.successRoute) || `${surfaceGroup}/${surfaceName}/accepted`,
      blockedRoute: asNonEmptyString(workflow.blockedRoute) || `${surfaceGroup}/${surfaceName}/blocked`,
      handoffRoute: asNonEmptyString(workflow.handoffRoute) || `${surfaceGroup}/${surfaceName}/handoff`,
      includeAuditProof: workflow.includeAuditProof !== false,
      includeOperatorActions: workflow.includeOperatorActions !== false
    }
  };
}

function buildStateLeaseStatus(clientRequest, now) {
  const expiresAtMs = parseTimestampMs(clientRequest.stateLease.expiresAt);
  const nowMs = parseTimestampMs(now);
  const hasExpiry = Boolean(clientRequest.stateLease.expiresAt);
  const invalidExpiry = hasExpiry && expiresAtMs === null;
  const expired = expiresAtMs !== null && nowMs !== null && expiresAtMs <= nowMs;
  const expiresInMs = expiresAtMs !== null && nowMs !== null
    ? Math.max(0, expiresAtMs - nowMs)
    : null;
  const missingRequiredToken = clientRequest.stateLease.required && !clientRequest.stateLease.token;
  const ready = !missingRequiredToken && !invalidExpiry && !expired;
  const blockers = [
    ...(missingRequiredToken ? ['missing_client_state_lease'] : []),
    ...(invalidExpiry ? ['invalid_client_state_lease_expiry'] : []),
    ...(expired ? ['expired_client_state_lease'] : [])
  ];

  return {
    required: clientRequest.stateLease.required,
    ready,
    tokenPresent: Boolean(clientRequest.stateLease.token),
    version: clientRequest.stateLease.version,
    holder: clientRequest.stateLease.holder,
    expiresAt: clientRequest.stateLease.expiresAt || null,
    expiresInMs,
    stale: expired,
    blockers,
    status: ready
      ? clientRequest.stateLease.required
        ? 'lease-ready'
        : 'lease-not-required'
      : expired
        ? 'lease-expired'
        : invalidExpiry
          ? 'lease-invalid'
          : 'lease-missing'
  };
}

function buildClientRequestValidation(clientRequest, boundary, now) {
  const errors = [];
  const stateLease = buildStateLeaseStatus(clientRequest, now);

  if ((clientRequest.intent === 'claim' || clientRequest.intent === 'retry') && clientRequest.optimisticMutation && !clientRequest.requestId) {
    errors.push({
      code: 'missing_client_request_id',
      field: 'clientRequest.requestId',
      message: 'Optimistic blocker-claim mutation requires a stable client request id.',
      action: 'Attach clientRequest.requestId so hosted-kernel command receipts can be reconciled with client state.'
    });
  }

  if (stateLease.blockers.includes('missing_client_state_lease')) {
    errors.push({
      code: 'missing_client_state_lease',
      field: 'clientRequest.stateLease.token',
      message: 'Client state lease is required before this blocker claim can mutate lifecycle state.',
      action: 'Acquire a hosted-kernel state lease and include stateLease.token with the claim request.'
    });
  }

  if (stateLease.blockers.includes('invalid_client_state_lease_expiry')) {
    errors.push({
      code: 'invalid_client_state_lease_expiry',
      field: 'clientRequest.stateLease.expiresAt',
      message: 'Client state lease expiry must be a parseable timestamp.',
      action: 'Refresh the hosted-kernel state lease and include stateLease.expiresAt as an ISO timestamp.'
    });
  }

  if (stateLease.blockers.includes('expired_client_state_lease')) {
    errors.push({
      code: 'expired_client_state_lease',
      field: 'clientRequest.stateLease.expiresAt',
      message: 'Client state lease has expired and cannot authorize lifecycle mutation.',
      action: 'Renew the hosted-kernel state lease before retrying the blocker claim mutation.'
    });
  }

  if (clientRequest.intent === 'handoff' && !boundary.permissionChecks.canHandoff) {
    errors.push({
      code: 'client_handoff_permission_missing',
      field: 'clientRequest.intent',
      message: 'Client requested external workflow handoff without blocker handoff permission.',
      action: 'Grant blocker:handoff to the principal or change clientRequest.intent to preview or claim.'
    });
  }

  if (clientRequest.handoffPreference === 'external-required' && !boundary.permissionChecks.canHandoff) {
    errors.push({
      code: 'client_external_handoff_required_but_unauthorized',
      field: 'clientRequest.handoffPreference',
      message: 'Client requires external handoff, but the principal cannot dispatch handoff routes.',
      action: 'Use an authorized principal for external handoff or allow local-first hosted-kernel control.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    stateLease,
    stateLeaseReady: stateLease.ready,
    mutationRequested: clientRequest.intent === 'claim' || clientRequest.intent === 'retry',
    handoffRequired: clientRequest.intent === 'handoff' || clientRequest.handoffPreference === 'external-required'
  };
}

function normalizeProviderContracts(input) {
  const rawProviders = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.providers)
      ? input.providers
      : [];

  return rawProviders
    .filter((provider) => provider && typeof provider === 'object')
    .map((provider, index) => {
      const sync = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
      const handoff = provider.handoff && typeof provider.handoff === 'object' ? provider.handoff : {};
      const contract = provider.contract && typeof provider.contract === 'object' ? provider.contract : {};
      const callbacks = contract.callbacks && typeof contract.callbacks === 'object' ? contract.callbacks : {};
      const capabilities = normalizeStringList(provider.capabilities);
      const rawSyncMode = asNonEmptyString(sync.mode) || asNonEmptyString(provider.syncMode) || 'pull';
      const rawAuthScheme = asNonEmptyString(contract.authScheme) || asNonEmptyString(provider.authScheme);
      const rawConsistency = asNonEmptyString(contract.consistency) || asNonEmptyString(provider.consistency);
      const rawHandoffTargetKind = asNonEmptyString(handoff.targetKind) || asNonEmptyString(provider.handoffTargetKind);
      const rawReceiptState = asNonEmptyString(handoff.receiptState) || asNonEmptyString(provider.handoffReceiptState);
      const lastSyncedAt = asNonEmptyString(sync.lastSyncedAt) || asNonEmptyString(provider.lastSyncedAt);
      const acknowledgementCursor = asNonEmptyString(sync.acknowledgementCursor)
        || asNonEmptyString(sync.ackCursor)
        || asNonEmptyString(provider.acknowledgementCursor);
      const maxLagMs = asNonNegativeInteger(sync.maxLagMs ?? provider.maxSyncLagMs, PROVIDER_MAX_SYNC_LAG_MS);
      const serviceContract = {
        contractVersion: 1,
        serviceKey: asNonEmptyString(contract.serviceKey)
          || `${asNonEmptyString(provider.service) || 'hosted-kernel-lifecycle'}:${asNonEmptyString(provider.version) || 'unversioned'}`,
        schemaVersion: asNonEmptyString(contract.schemaVersion) || asNonEmptyString(provider.schemaVersion) || 'blocker-claim-provider.v1',
        authScheme: PROVIDER_AUTH_SCHEMES.has(rawAuthScheme) ? rawAuthScheme : 'signed-request',
        consistency: PROVIDER_CONSISTENCY_LEVELS.has(rawConsistency) ? rawConsistency : 'read-your-writes',
        acceptsReplay: contract.acceptsReplay !== false,
        acceptsIdempotencyKey: contract.acceptsIdempotencyKey !== false,
        requiresAuditProof: contract.requiresAuditProof !== false,
        callbackRoutes: {
          acknowledgement: asNonEmptyString(callbacks.acknowledgement)
            || asNonEmptyString(contract.acknowledgementRoute)
            || asNonEmptyString(provider.acknowledgementRoute),
          failure: asNonEmptyString(callbacks.failure)
            || asNonEmptyString(contract.failureRoute)
            || asNonEmptyString(provider.failureRoute),
          health: asNonEmptyString(callbacks.health)
            || asNonEmptyString(contract.healthRoute)
            || asNonEmptyString(provider.healthRoute)
        },
        advertisedCapabilities: capabilities,
        optionalCapabilities: OPTIONAL_PROVIDER_CAPABILITIES.filter((capability) => capabilities.includes(capability))
      };
      const handoffContract = {
        requested: handoff.requested === true || provider.externalHandoff === true,
        target: asNonEmptyString(handoff.target) || asNonEmptyString(provider.handoffTarget),
        targetKind: HANDOFF_TARGET_KINDS.has(rawHandoffTargetKind) ? rawHandoffTargetKind : 'provider-endpoint',
        tenantId: asNonEmptyString(handoff.tenantId) || asNonEmptyString(provider.handoffTenantId),
        workspaceId: asNonEmptyString(handoff.workspaceId) || asNonEmptyString(provider.handoffWorkspaceId),
        dispatchMode: asNonEmptyString(handoff.dispatchMode) || 'operator-confirmed',
        payloadVersion: asNonEmptyString(handoff.payloadVersion) || 'blocker-claim-handoff.v1',
        requiresReceipt: handoff.requiresReceipt !== false,
        state: asNonEmptyString(handoff.state) || 'local-only',
        receiptId: asNonEmptyString(handoff.receiptId),
        receiptState: HANDOFF_RECEIPT_STATES.has(rawReceiptState) ? rawReceiptState : 'missing',
        webhookRoute: asNonEmptyString(handoff.webhookRoute) || asNonEmptyString(provider.webhookRoute)
      };
      const mailchimp = normalizeMailchimpProviderContract(provider, serviceContract, handoffContract);

      return {
        providerId: asNonEmptyString(provider.providerId) || asNonEmptyString(provider.id) || `provider-${index + 1}`,
        service: asNonEmptyString(provider.service) || 'hosted-kernel-lifecycle',
        version: asNonEmptyString(provider.version) || 'unversioned',
        endpoint: asNonEmptyString(provider.endpoint),
        capabilities,
        missingRequiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !capabilities.includes(capability)),
        serviceContract,
        sync: {
          cursor: asNonEmptyString(sync.cursor) || asNonEmptyString(provider.cursor),
          lastSyncedAt,
          mode: PROVIDER_SYNC_MODES.has(rawSyncMode) ? rawSyncMode : 'pull',
          modeAccepted: PROVIDER_SYNC_MODES.has(rawSyncMode),
          stale: sync.stale === true,
          watermark: asNonEmptyString(sync.watermark) || asNonEmptyString(provider.watermark),
          acknowledgementCursor,
          maxLagMs,
          sequence: asNonNegativeInteger(sync.sequence ?? provider.syncSequence, 0),
          acknowledgedSequence: asNonNegativeInteger(sync.acknowledgedSequence ?? provider.acknowledgedSequence, 0),
          pendingMutations: asNonNegativeInteger(sync.pendingMutations ?? provider.pendingMutations, 0),
          initialSyncAllowed: sync.initialSyncAllowed === true || provider.initialSyncAllowed === true,
          proofDigest: asNonEmptyString(sync.proofDigest) || asNonEmptyString(provider.proofDigest)
        },
        handoff: handoffContract,
        mailchimp
      };
    });
}

function buildProviderSyncStatus(provider, lifecycleSettings, now) {
  const syncFreshness = buildProviderSyncFreshness(provider, now);
  const lagExceeded = syncFreshness.blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.lagExceeded);
  const ackRequired = provider.serviceContract.consistency !== 'best-effort'
    || lifecycleSettings.mode === 'automatic'
    || provider.handoff.requested;
  const cursorReady = Boolean(provider.sync.cursor || provider.sync.initialSyncAllowed);
  const acknowledgementReady = !ackRequired
    || Boolean(provider.sync.acknowledgementCursor)
    || provider.sync.acknowledgedSequence >= provider.sync.sequence;
  const proofReady = !provider.serviceContract.requiresAuditProof || Boolean(provider.sync.proofDigest);
  const stale = !syncFreshness.current;
  const ready = provider.sync.modeAccepted
    && cursorReady
    && acknowledgementReady
    && proofReady
    && !stale
    && provider.sync.pendingMutations === 0;

  return {
    contractVersion: 1,
    providerId: provider.providerId,
    serviceKey: provider.serviceContract.serviceKey,
    mode: provider.sync.mode,
    modeAccepted: provider.sync.modeAccepted,
    cursorReady,
    acknowledgementReady,
    proofReady,
    stale,
    syncAgeMs: syncFreshness.freshness.ageMs,
    maxLagMs: provider.sync.maxLagMs,
    lagExceeded,
    syncFreshness,
    sequence: provider.sync.sequence,
    acknowledgedSequence: provider.sync.acknowledgedSequence,
    sequenceBehind: provider.sync.sequence > provider.sync.acknowledgedSequence,
    pendingMutations: provider.sync.pendingMutations,
    initialSyncAllowed: provider.sync.initialSyncAllowed,
    consistency: provider.serviceContract.consistency,
    ready,
    blockers: [
      ...(!provider.sync.modeAccepted ? ['unsupported_sync_mode'] : []),
      ...(!cursorReady ? ['sync_cursor_missing'] : []),
      ...(!acknowledgementReady ? ['sync_acknowledgement_missing'] : []),
      ...(!proofReady ? ['sync_audit_proof_digest_missing'] : []),
      ...syncFreshness.blockers,
      ...(provider.sync.pendingMutations > 0 ? ['sync_pending_mutations'] : [])
    ]
  };
}

function buildProviderServiceCommitment(provider, syncStatus, now) {
  const externalStateClaimed = provider.handoff.requested || provider.handoff.state !== 'local-only';
  const mailchimpExternalRequired = provider.mailchimp.detected && provider.mailchimp.requiresExternalHandoff;
  const receiptDeadlineAt = provider.handoff.requiresReceipt
    ? addMillisecondsToTimestamp(now, PROVIDER_HANDOFF_ACK_DEADLINE_MS)
    : null;
  const capabilityGaps = [
    ...provider.missingRequiredCapabilities,
    ...(provider.mailchimp.detected
      ? MAILCHIMP_PROVIDER_CAPABILITIES.filter((capability) => !provider.capabilities.includes(capability))
      : []),
    ...(externalStateClaimed && !provider.capabilities.includes('external-handoff') ? ['external-handoff'] : []),
    ...(syncStatus.stale && !provider.capabilities.includes('health-mirror') ? ['health-mirror'] : [])
  ];
  const contractGaps = [
    ...(!provider.endpoint ? ['endpoint'] : []),
    ...(!provider.serviceContract.acceptsIdempotencyKey ? ['idempotency-key'] : []),
    ...(provider.serviceContract.requiresAuditProof && !provider.sync.proofDigest ? ['audit-proof-digest'] : []),
    ...(provider.serviceContract.consistency === 'strict' && !provider.sync.acknowledgementCursor ? ['strict-acknowledgement-cursor'] : []),
    ...((externalStateClaimed || mailchimpExternalRequired) && !provider.handoff.target ? ['handoff-target'] : []),
    ...(externalStateClaimed && provider.handoff.requiresReceipt && provider.handoff.receiptState === 'rejected' ? ['accepted-handoff-receipt'] : [])
  ];
  const callbackGaps = [
    ...(externalStateClaimed && !provider.serviceContract.callbackRoutes.acknowledgement ? ['acknowledgement-callback'] : []),
    ...(externalStateClaimed && !provider.serviceContract.callbackRoutes.failure ? ['failure-callback'] : []),
    ...(provider.capabilities.includes('health-mirror') && !provider.serviceContract.callbackRoutes.health ? ['health-callback'] : []),
    ...(provider.mailchimp.detected && !provider.mailchimp.webhookRoute ? ['mailchimp-webhook-route'] : []),
    ...(provider.mailchimp.detected && !provider.mailchimp.webhookSecretRef ? ['mailchimp-webhook-secret-ref'] : []),
    ...(provider.mailchimp.rejectedEvents.length > 0 ? ['mailchimp-unsupported-handoff-event'] : [])
  ];
  const ready = syncStatus.ready
    && capabilityGaps.length === 0
    && contractGaps.length === 0
    && callbackGaps.length === 0;

  return {
    contractVersion: 1,
    providerId: provider.providerId,
    serviceKey: provider.serviceContract.serviceKey,
    schemaVersion: provider.serviceContract.schemaVersion,
    endpoint: provider.endpoint || null,
    ready,
    externalStateClaimed,
    capabilityNegotiation: {
      required: REQUIRED_PROVIDER_CAPABILITIES,
      optionalAdvertised: provider.serviceContract.optionalCapabilities,
      advertised: provider.serviceContract.advertisedCapabilities,
      gaps: Array.from(new Set(capabilityGaps))
    },
    serviceLevel: {
      authScheme: provider.serviceContract.authScheme,
      consistency: provider.serviceContract.consistency,
      acceptsReplay: provider.serviceContract.acceptsReplay,
      acceptsIdempotencyKey: provider.serviceContract.acceptsIdempotencyKey,
      requiresAuditProof: provider.serviceContract.requiresAuditProof
    },
    syncCheckpoint: {
      mode: syncStatus.mode,
      cursor: provider.sync.cursor || null,
      watermark: provider.sync.watermark || null,
      lastSyncedAt: syncStatus.syncFreshness.lastSyncedAt,
      freshness: syncStatus.syncFreshness.freshness,
      sequence: syncStatus.sequence,
      acknowledgedSequence: syncStatus.acknowledgedSequence,
      acknowledgementCursor: provider.sync.acknowledgementCursor || null,
      proofDigest: provider.sync.proofDigest || null,
      pendingMutations: syncStatus.pendingMutations,
      stale: syncStatus.stale,
      nextAction: syncStatus.syncFreshness.nextAction,
      blockers: syncStatus.blockers
    },
    externalHandoffState: externalStateClaimed
      ? {
          target: provider.handoff.target || null,
          targetKind: provider.handoff.targetKind,
          state: provider.handoff.state,
          receiptState: provider.handoff.receiptState,
          receiptId: provider.handoff.receiptId || null,
          receiptDeadlineAt,
          requiresReceipt: provider.handoff.requiresReceipt,
          payloadVersion: provider.handoff.payloadVersion,
          callbacks: provider.serviceContract.callbackRoutes
        }
      : null,
    mailchimp: provider.mailchimp.detected
      ? {
          accountId: provider.mailchimp.accountId,
          audienceIds: provider.mailchimp.audienceIds,
          acceptedEvents: provider.mailchimp.acceptedEvents,
          rejectedEvents: provider.mailchimp.rejectedEvents,
          webhookRoute: provider.mailchimp.webhookRoute || null,
          webhookSecretRefPresent: Boolean(provider.mailchimp.webhookSecretRef),
          requiresExternalHandoff: mailchimpExternalRequired,
          readyForAudienceSync: provider.mailchimp.audienceIds.length > 0 &&
            Boolean(provider.mailchimp.webhookRoute) &&
            Boolean(provider.mailchimp.webhookSecretRef) &&
            syncStatus.ready
        }
      : null,
    integrationGaps: {
      capabilities: Array.from(new Set(capabilityGaps)),
      contract: contractGaps,
      callbacks: callbackGaps
    }
  };
}

function buildProviderNegotiation(providerContracts, lifecycleSettings, now) {
  const blockingIssues = [];
  const accepted = [];
  const syncStatuses = [];
  const serviceCommitments = [];

  providerContracts.forEach((provider) => {
    const syncStatus = buildProviderSyncStatus(provider, lifecycleSettings, now);
    const serviceCommitment = buildProviderServiceCommitment(provider, syncStatus, now);
    syncStatuses.push(syncStatus);
    serviceCommitments.push(serviceCommitment);

    if (!provider.endpoint) {
      blockingIssues.push({
        code: 'provider_missing_endpoint',
        field: `providerContracts.${provider.providerId}.endpoint`,
        message: `${provider.providerId} must expose an endpoint before hosted-kernel lifecycle sync can be enabled.`,
        action: 'Add the provider endpoint or remove the provider contract from this claim.'
      });
    }

    provider.missingRequiredCapabilities.forEach((capability) => {
      blockingIssues.push({
        code: 'provider_missing_capability',
        field: `providerContracts.${provider.providerId}.capabilities`,
        message: `${provider.providerId} does not advertise required capability ${capability}.`,
        action: `Negotiate ${capability} with the provider before accepting this blocker claim.`
      });
    });

    if (!syncStatus.modeAccepted) {
      blockingIssues.push({
        code: 'provider_sync_mode_unsupported',
        field: `providerContracts.${provider.providerId}.sync.mode`,
        message: `${provider.providerId} requested an unsupported blocker-claim sync mode.`,
        action: `Use one of ${[...PROVIDER_SYNC_MODES].join(', ')} for provider sync mode.`
      });
    }

    if (!syncStatus.cursorReady) {
      blockingIssues.push({
        code: 'provider_sync_cursor_missing',
        field: `providerContracts.${provider.providerId}.sync.cursor`,
        message: `${provider.providerId} must provide a sync cursor or explicitly allow initial sync.`,
        action: 'Attach sync.cursor from the provider ledger or set sync.initialSyncAllowed for first-time hosted-kernel onboarding.'
      });
    }

    if (!syncStatus.acknowledgementReady) {
      blockingIssues.push({
        code: 'provider_sync_acknowledgement_missing',
        field: `providerContracts.${provider.providerId}.sync.acknowledgementCursor`,
        message: `${provider.providerId} has not acknowledged the latest blocker-claim sync contract.`,
        action: 'Wait for acknowledgementCursor or acknowledgedSequence before mutating lifecycle state through this provider.'
      });
    }

    if (!syncStatus.proofReady) {
      blockingIssues.push({
        code: 'provider_sync_audit_proof_missing',
        field: `providerContracts.${provider.providerId}.sync.proofDigest`,
        message: `${provider.providerId} requires audit-proof sync but did not return a proof digest.`,
        action: 'Refresh provider sync until sync.proofDigest is present for the blocker-claim audit ledger.'
      });
    }

    if (syncStatus.stale && lifecycleSettings.mode !== 'manual') {
      blockingIssues.push({
        code: 'provider_sync_lag_exceeded',
        field: `providerContracts.${provider.providerId}.sync.lastSyncedAt`,
        message: `${provider.providerId} sync metadata exceeds the allowed hosted-kernel lag window.`,
        action: syncStatus.syncFreshness.nextAction === 'repair-provider-sync-timestamp'
          ? 'Repair provider sync.lastSyncedAt so the hosted-kernel can compare freshness before lifecycle mutation.'
          : syncStatus.syncFreshness.nextAction === 'wait-for-provider-clock-or-resync'
            ? 'Wait for provider clock convergence or refresh sync metadata with a timestamp not later than the hosted-kernel clock.'
            : `Refresh provider sync metadata within ${syncStatus.maxLagMs}ms before lifecycle mutation.`,
        freshness: syncStatus.syncFreshness
      });
    }

    if (provider.sync.pendingMutations > 0) {
      blockingIssues.push({
        code: 'provider_sync_pending_mutations',
        field: `providerContracts.${provider.providerId}.sync.pendingMutations`,
        message: `${provider.providerId} still has pending blocker-claim sync mutations.`,
        action: 'Allow pending provider mutations to drain before dispatching another blocker-claim state change.'
      });
    }

    if (provider.handoff.requested && !provider.capabilities.includes('external-handoff')) {
      blockingIssues.push({
        code: 'provider_handoff_unsupported',
        field: `providerContracts.${provider.providerId}.handoff`,
        message: `${provider.providerId} cannot receive external blocker-claim handoff.`,
        action: 'Advertise external-handoff or keep the claim under local hosted-kernel control.'
      });
    }

    if (provider.handoff.requested && !provider.handoff.target) {
      blockingIssues.push({
        code: 'provider_handoff_target_missing',
        field: `providerContracts.${provider.providerId}.handoff.target`,
        message: `${provider.providerId} requested external handoff without a target.`,
        action: 'Set handoff.target to the external lifecycle queue, ticket, or service route that will receive the claim.'
      });
    }

    if (provider.handoff.requested && provider.handoff.requiresReceipt && provider.handoff.receiptState === 'rejected') {
      blockingIssues.push({
        code: 'provider_handoff_receipt_rejected',
        field: `providerContracts.${provider.providerId}.handoff.receiptState`,
        message: `${provider.providerId} rejected the latest external blocker-claim handoff receipt.`,
        action: 'Resolve the rejected handoff receipt or route the blocker claim back to local hosted-kernel control.'
      });
    }

    if (provider.handoff.requested && !provider.serviceContract.callbackRoutes.acknowledgement) {
      blockingIssues.push({
        code: 'provider_handoff_ack_callback_missing',
        field: `providerContracts.${provider.providerId}.contract.callbacks.acknowledgement`,
        message: `${provider.providerId} requested external handoff without an acknowledgement callback route.`,
        action: 'Add a provider acknowledgement callback so hosted-kernel handoff state can be reconciled after dispatch.'
      });
    }

    if (provider.handoff.requested && !provider.serviceContract.callbackRoutes.failure) {
      blockingIssues.push({
        code: 'provider_handoff_failure_callback_missing',
        field: `providerContracts.${provider.providerId}.contract.callbacks.failure`,
        message: `${provider.providerId} requested external handoff without a failure callback route.`,
        action: 'Add a provider failure callback so rejected external handoffs can return to hosted-kernel control.'
      });
    }

    if (provider.capabilities.includes('health-mirror') && !provider.serviceContract.callbackRoutes.health) {
      blockingIssues.push({
        code: 'provider_health_callback_missing',
        field: `providerContracts.${provider.providerId}.contract.callbacks.health`,
        message: `${provider.providerId} advertises health-mirror without a health callback route.`,
        action: 'Add a provider health callback or remove health-mirror from advertised optional capabilities.'
      });
    }

    if (provider.mailchimp.detected) {
      MAILCHIMP_PROVIDER_CAPABILITIES
        .filter((capability) => !provider.capabilities.includes(capability))
        .forEach((capability) => {
          blockingIssues.push({
            code: 'mailchimp_provider_capability_missing',
            field: `providerContracts.${provider.providerId}.capabilities`,
            message: `${provider.providerId} must advertise ${capability} for Mailchimp blocker-claim handoff.`,
            action: `Negotiate ${capability} before accepting Mailchimp audience or campaign lifecycle claims.`
          });
        });

      if (!provider.mailchimp.accountId) {
        blockingIssues.push({
          code: 'mailchimp_account_missing',
          field: `providerContracts.${provider.providerId}.mailchimp.accountId`,
          message: `${provider.providerId} did not declare the Mailchimp account or datacenter boundary.`,
          action: 'Attach mailchimp.accountId so external handoff state is scoped to the correct Mailchimp account.'
        });
      }

      if (provider.mailchimp.requiresExternalHandoff && !provider.handoff.target) {
        blockingIssues.push({
          code: 'mailchimp_handoff_target_missing',
          field: `providerContracts.${provider.providerId}.handoff.target`,
          message: `${provider.providerId} needs a Mailchimp handoff target for mutating audience or campaign work.`,
          action: 'Set handoff.target to the Mailchimp sync worker, ticket queue, or provider endpoint.'
        });
      }

      if (!provider.mailchimp.webhookRoute || !provider.mailchimp.webhookSecretRef) {
        blockingIssues.push({
          code: 'mailchimp_webhook_contract_incomplete',
          field: `providerContracts.${provider.providerId}.mailchimp.webhookRoute`,
          message: `${provider.providerId} must provide a Mailchimp webhook route and secret reference for external reconciliation.`,
          action: 'Add mailchimp.webhookRoute and mailchimp.webhookSecretRef before accepting the blocker claim preview.'
        });
      }

      provider.mailchimp.rejectedEvents.forEach((event) => {
        blockingIssues.push({
          code: 'mailchimp_handoff_event_unsupported',
          field: `providerContracts.${provider.providerId}.mailchimp.events`,
          message: `${provider.providerId} requested unsupported Mailchimp handoff event ${event}.`,
          action: `Use one of ${MAILCHIMP_AUDIENCE_HANDOFF_EVENTS.join(', ')}.`
        });
      });
    }

    if (provider.sync.stale && lifecycleSettings.mode === 'automatic') {
      blockingIssues.push({
        code: 'provider_sync_stale',
        field: `providerContracts.${provider.providerId}.sync.lastSyncedAt`,
        message: `${provider.providerId} sync metadata is stale for automatic lifecycle mode.`,
        action: 'Refresh provider sync metadata before automatic blocker-claim mutation.',
        freshness: syncStatus.syncFreshness
      });
    }

    if (serviceCommitment.ready) {
      accepted.push(provider.providerId);
    }
  });

  return {
    requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    optionalCapabilities: OPTIONAL_PROVIDER_CAPABILITIES,
    providerCount: providerContracts.length,
    acceptedProviders: accepted,
    serviceCommitments,
    committedProviderIds: serviceCommitments.filter((commitment) => commitment.ready).map((commitment) => commitment.providerId),
    externalStateProviderIds: serviceCommitments.filter((commitment) => commitment.externalStateClaimed).map((commitment) => commitment.providerId),
    syncStatuses,
    syncReadyProviders: syncStatuses.filter((status) => status.ready).map((status) => status.providerId),
    syncBlockedProviders: syncStatuses.filter((status) => !status.ready).map((status) => status.providerId),
    syncFreshness: {
      currentProviderCount: syncStatuses.filter((status) => status.syncFreshness.current).length,
      invalidTimestampProviderIds: syncStatuses
        .filter((status) => status.syncFreshness.blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.invalidTimestamp))
        .map((status) => status.providerId),
      futureTimestampProviderIds: syncStatuses
        .filter((status) => status.syncFreshness.blockers.includes(PROVIDER_SYNC_FRESHNESS_BLOCKERS.futureTimestamp))
        .map((status) => status.providerId),
      staleProviderIds: syncStatuses
        .filter((status) => status.syncFreshness.blockers.some((blocker) => (
          blocker === PROVIDER_SYNC_FRESHNESS_BLOCKERS.lagExceeded ||
          blocker === PROVIDER_SYNC_FRESHNESS_BLOCKERS.explicitlyStale
        )))
        .map((status) => status.providerId),
      nextActions: Array.from(new Set(syncStatuses
        .map((status) => status.syncFreshness.nextAction)
        .filter((action) => action && action !== 'none')))
    },
    blockingIssues,
    ready: blockingIssues.length === 0,
    mode: providerContracts.length > 0 ? 'negotiated-provider-contract' : 'local-hosted-kernel-only'
  };
}

function parseScheduleWindowMinute(value) {
  const raw = asNonEmptyString(value);
  const match = raw?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getZonedMinuteOfDay(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone
    }).formatToParts(new Date(now));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    return Number.isInteger(hour) && Number.isInteger(minute)
      ? (hour % 24) * 60 + minute
      : null;
  } catch {
    return null;
  }
}

function buildScheduleControl(settings, now) {
  const nextRunAtMs = parseTimestampMs(settings.schedule.nextRunAt);
  const nowMs = parseTimestampMs(now);
  const windowStartMinute = parseScheduleWindowMinute(settings.schedule.windowStart);
  const windowEndMinute = parseScheduleWindowMinute(settings.schedule.windowEnd);
  const hasWindow = windowStartMinute !== null || windowEndMinute !== null;
  const windowConfigured = windowStartMinute !== null && windowEndMinute !== null;
  const zonedMinute = getZonedMinuteOfDay(now, settings.schedule.timezone);
  const inWindow = !windowConfigured
    ? true
    : windowStartMinute <= windowEndMinute
      ? zonedMinute >= windowStartMinute && zonedMinute <= windowEndMinute
      : zonedMinute >= windowStartMinute || zonedMinute <= windowEndMinute;
  const quotaRemaining = settings.schedule.maxClaimsPerWindow === 0
    ? null
    : Math.max(0, settings.schedule.maxClaimsPerWindow - settings.schedule.dispatchedInWindow);
  const due = settings.mode === 'scheduled'
    && settings.schedule.enabled
    && nextRunAtMs !== null
    && nowMs !== null
    && nextRunAtMs <= nowMs;
  const runnableNow = due
    && inWindow
    && (quotaRemaining === null || quotaRemaining > 0);
  const holdReasons = [
    ...(!settings.enabled ? ['lifecycle_disabled'] : []),
    ...(!settings.schedule.enabled ? ['schedule_disabled'] : []),
    ...(settings.mode !== 'scheduled' ? ['mode_not_scheduled'] : []),
    ...(settings.schedule.nextRunAt && nextRunAtMs === null ? ['invalid_next_run_at'] : []),
    ...(hasWindow && !windowConfigured ? ['incomplete_schedule_window'] : []),
    ...(windowConfigured && zonedMinute === null ? ['invalid_schedule_timezone'] : []),
    ...(windowConfigured && !inWindow ? ['outside_schedule_window'] : []),
    ...(quotaRemaining === 0 ? ['schedule_quota_exhausted'] : []),
    ...(settings.schedule.enabled && nextRunAtMs !== null && nowMs !== null && nextRunAtMs > nowMs ? ['waiting_for_next_run'] : [])
  ];

  return {
    enabled: settings.schedule.enabled,
    mode: settings.mode,
    cadence: settings.schedule.cadence,
    timezone: settings.schedule.timezone,
    nextRunAt: settings.schedule.nextRunAt || null,
    due,
    runnableNow,
    manualOverrideAllowed: settings.schedule.manualOverrideAllowed,
    window: {
      configured: windowConfigured,
      start: settings.schedule.windowStart || null,
      end: settings.schedule.windowEnd || null,
      active: inWindow,
      currentMinute: zonedMinute
    },
    quota: {
      maxClaimsPerWindow: settings.schedule.maxClaimsPerWindow,
      dispatchedInWindow: settings.schedule.dispatchedInWindow,
      remaining: quotaRemaining
    },
    holdReasons,
    nextAction: runnableNow
      ? 'claim-blocker'
      : settings.schedule.manualOverrideAllowed && settings.enabled
        ? 'manual-override'
        : holdReasons.includes('waiting_for_next_run')
          ? 'wait-for-schedule'
          : holdReasons[0] || 'operator-remediation'
  };
}

function buildSettingsValidation(settings, evidence, healthChecks, scheduleControl) {
  const errors = [];

  if (!settings.enabled && !settings.pauseReason) {
    errors.push({
      code: 'missing_pause_reason',
      field: 'lifecycleSettings.pauseReason',
      message: 'Disabled lifecycle controls require a pause reason.',
      action: 'Add pauseReason so hosted-kernel operators can audit why blocker claims are paused.'
    });
  }

  if (settings.mode === 'scheduled' && settings.schedule.enabled && !settings.schedule.nextRunAt) {
    errors.push({
      code: 'missing_schedule_next_run',
      field: 'lifecycleSettings.schedule.nextRunAt',
      message: 'Scheduled blocker-claim mode requires the next scheduled run time.',
      action: 'Provide schedule.nextRunAt or switch lifecycleSettings.mode to manual.'
    });
  }

  if (settings.mode === 'scheduled' && !settings.schedule.enabled) {
    errors.push({
      code: 'scheduled_mode_disabled_schedule',
      field: 'lifecycleSettings.schedule.enabled',
      message: 'Scheduled lifecycle mode requires schedule controls to be enabled.',
      action: 'Enable lifecycleSettings.schedule.enabled or switch lifecycleSettings.mode to manual.'
    });
  }

  if (settings.schedule.nextRunAt && parseTimestampMs(settings.schedule.nextRunAt) === null) {
    errors.push({
      code: 'invalid_schedule_next_run',
      field: 'lifecycleSettings.schedule.nextRunAt',
      message: 'Scheduled blocker-claim nextRunAt must be a parseable timestamp.',
      action: 'Provide an ISO timestamp for schedule.nextRunAt so clients can compute the next claim action.'
    });
  }

  if (settings.schedule.windowStart && parseScheduleWindowMinute(settings.schedule.windowStart) === null) {
    errors.push({
      code: 'invalid_schedule_window_start',
      field: 'lifecycleSettings.schedule.windowStart',
      message: 'Scheduled blocker-claim windowStart must use HH:mm 24-hour time.',
      action: 'Set schedule.windowStart to a value such as 09:00 or remove the schedule window.'
    });
  }

  if (settings.schedule.windowEnd && parseScheduleWindowMinute(settings.schedule.windowEnd) === null) {
    errors.push({
      code: 'invalid_schedule_window_end',
      field: 'lifecycleSettings.schedule.windowEnd',
      message: 'Scheduled blocker-claim windowEnd must use HH:mm 24-hour time.',
      action: 'Set schedule.windowEnd to a value such as 17:00 or remove the schedule window.'
    });
  }

  if ((settings.schedule.windowStart && !settings.schedule.windowEnd) || (!settings.schedule.windowStart && settings.schedule.windowEnd)) {
    errors.push({
      code: 'incomplete_schedule_window',
      field: 'lifecycleSettings.schedule',
      message: 'Scheduled blocker-claim windows require both windowStart and windowEnd.',
      action: 'Provide both schedule window bounds or remove the partial window configuration.'
    });
  }

  if (settings.schedule.maxClaimsPerWindow > 0 && settings.schedule.dispatchedInWindow > settings.schedule.maxClaimsPerWindow) {
    errors.push({
      code: 'schedule_window_quota_exceeded',
      field: 'lifecycleSettings.schedule.dispatchedInWindow',
      message: 'Scheduled blocker-claim dispatch count exceeds the configured window quota.',
      action: 'Reset dispatchedInWindow for a new window or raise maxClaimsPerWindow after operator review.'
    });
  }

  if (scheduleControl.holdReasons.includes('invalid_schedule_timezone')) {
    errors.push({
      code: 'invalid_schedule_timezone',
      field: 'lifecycleSettings.schedule.timezone',
      message: 'Scheduled blocker-claim timezone is not supported by the runtime.',
      action: 'Use a valid IANA timezone such as UTC or America/New_York.'
    });
  }

  if (settings.requireEvidence && evidence.length === 0) {
    errors.push({
      code: 'missing_required_evidence',
      field: 'evidence',
      message: 'Lifecycle settings require blocker-claim evidence before mutation.',
      action: 'Attach at least one evidence item proving the blocker state before enabling lifecycle mutation.'
    });
  }

  if (settings.requireHealthChecks && healthChecks.length === 0) {
    errors.push({
      code: 'missing_required_health_checks',
      field: 'healthChecks',
      message: 'Lifecycle settings require dependency health checks before mutation.',
      action: 'Report hosted-kernel dependency checks before submitting the blocker claim.'
    });
  }

  if (settings.requireManualApproval && !settings.approvalTicket) {
    errors.push({
      code: 'missing_manual_approval',
      field: 'lifecycleSettings.approvalTicket',
      message: 'Manual approval is required before this blocker claim can mutate lifecycle state.',
      action: 'Attach the approval ticket or disable requireManualApproval for this workflow.'
    });
  }

  if (settings.mode === 'manual' && settings.autoRetryEnabled) {
    errors.push({
      code: 'manual_mode_auto_retry_conflict',
      field: 'lifecycleSettings.autoRetryEnabled',
      message: 'Manual lifecycle mode cannot automatically retry blocker claims.',
      action: 'Disable autoRetryEnabled or switch mode to automatic for retry-driven recovery.'
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    scheduleReady: scheduleControl.runnableNow || settings.mode !== 'scheduled',
    scheduleHoldReasons: scheduleControl.holdReasons
  };
}

function buildOperationalHealth({ healthChecks, now }) {
  const nowMs = parseTimestampMs(now);
  const checks = healthChecks.map((check) => {
    const observedAtMs = parseTimestampMs(check.observedAt);
    const ageMs = nowMs !== null && observedAtMs !== null ? Math.max(0, nowMs - observedAtMs) : null;
    const stale = check.staleAfterMs > 0 && ageMs !== null && ageMs > check.staleAfterMs;
    const failed = !check.ok;
    const blocking = check.required && (failed || stale) && (!check.degradedModeAllowed || check.severity === 'critical');
    const degraded = check.required && (failed || stale) && !blocking;

    return {
      ...check,
      ageMs,
      stale,
      failed,
      blocking,
      degraded,
      status: blocking
        ? 'blocking'
        : degraded
          ? 'degraded'
          : failed || stale
            ? 'warning'
            : 'healthy'
    };
  });
  const requiredChecks = checks.filter((check) => check.required);
  const blockingChecks = checks.filter((check) => check.blocking);
  const degradedChecks = checks.filter((check) => check.degraded);
  const warningChecks = checks.filter((check) => !check.required && (check.failed || check.stale));
  const highestSeverity = checks.reduce((highest, check) => (
    HEALTH_SEVERITY_RANK[check.severity] > HEALTH_SEVERITY_RANK[highest] ? check.severity : highest
  ), 'info');
  const nextRetryAfterMs = checks
    .filter((check) => check.required && (check.failed || check.stale) && check.retryAfterMs > 0)
    .reduce((delay, check) => Math.max(delay, check.retryAfterMs), 0);

  return {
    status: blockingChecks.length > 0
      ? 'blocked'
      : degradedChecks.length > 0
        ? 'degraded'
        : warningChecks.length > 0
          ? 'warning'
          : 'healthy',
    ready: blockingChecks.length === 0 && degradedChecks.length === 0,
    mutationSafe: blockingChecks.length === 0 && degradedChecks.length === 0,
    degradedModeAvailable: blockingChecks.length === 0 && degradedChecks.length > 0,
    highestSeverity,
    nextRetryAfterMs,
    requiredChecksFailed: checks
      .filter((check) => check.required && check.failed)
      .map((check) => check.name),
    requiredChecksStale: checks
      .filter((check) => check.required && check.stale)
      .map((check) => check.name),
    counts: {
      total: checks.length,
      required: requiredChecks.length,
      blocking: blockingChecks.length,
      degraded: degradedChecks.length,
      warnings: warningChecks.length,
      stale: checks.filter((check) => check.stale).length,
      failed: checks.filter((check) => check.failed).length
    },
    issues: checks
      .filter((check) => check.failed || check.stale)
      .map((check) => ({
        code: check.stale ? 'dependency_health_stale' : check.required ? 'dependency_unhealthy' : 'dependency_warning',
        field: `healthChecks.${check.name}`,
        dependency: check.name,
        kind: check.kind,
        severity: check.severity,
        required: check.required,
        blocking: check.blocking,
        retryAfterMs: check.retryAfterMs,
        message: check.message || (
          check.stale
            ? `${check.name} health observation is stale.`
            : `${check.name} is unhealthy.`
        ),
        action: check.action || (
          check.stale
            ? `Refresh ${check.name} health before mutating this blocker claim.`
            : `Restore ${check.name} or mark it optional before retrying this blocker claim.`
        )
      })),
    checks
  };
}

function buildValidation(input, boundaryValidation) {
  const missing = REQUIRED_CLAIM_FIELDS.filter((field) => !asNonEmptyString(input[field]));
  const invalidAttempt = input.attempt !== undefined && (!Number.isInteger(input.attempt) || input.attempt < 0);
  const errors = [
    ...missing.map((field) => ({
      code: `missing_${field}`,
      field,
      message: `Blocker claim requires ${field}.`,
      action: `Provide a non-empty ${field} before submitting the hosted-kernel blocker claim.`
    }))
  ];

  if (invalidAttempt) {
    errors.push({
      code: 'invalid_attempt',
      field: 'attempt',
      message: 'Retry attempt must be a non-negative integer.',
      action: 'Reset attempt to 0 for a new claim or increment from the previous failure state.'
    });
  }

  return {
    ok: errors.length === 0 && boundaryValidation.ok,
    requiredFields: REQUIRED_CLAIM_FIELDS,
    missingFields: missing,
    errors
  };
}

function classifyFailure(input, validation, boundaryValidation, operationalHealth) {
  const requested = asNonEmptyString(input.failureCode);

  if (!boundaryValidation.ok) {
    return {
      state: 'blocked',
      code: 'boundary_denied',
      retryable: false,
      reason: 'Claim cannot enter hosted-kernel lifecycle because tenant, workspace, or permission boundaries are invalid.'
    };
  }

  if (!validation.ok) {
    return {
      state: 'blocked',
      code: 'invalid_claim',
      retryable: false,
      reason: 'Claim cannot enter hosted-kernel lifecycle because required fields are invalid.'
    };
  }

  if (operationalHealth.status === 'blocked') {
    return {
      state: 'blocked',
      code: requested || 'dependency_blocking',
      retryable: operationalHealth.nextRetryAfterMs > 0,
      reason: `${operationalHealth.counts.blocking} required hosted-kernel dependency check(s) are blocking lifecycle mutation.`
    };
  }

  if (TERMINAL_FAILURES.has(requested)) {
    return {
      state: 'blocked',
      code: requested,
      retryable: false,
      reason: 'Failure is terminal and requires operator correction before a new claim can proceed.'
    };
  }

  if (operationalHealth.status === 'degraded') {
    return {
      state: 'degraded',
      code: requested || 'dependency_unhealthy',
      retryable: true,
      reason: `${operationalHealth.counts.degraded} required hosted-kernel dependency check(s) allow read-only degraded mode.`
    };
  }

  if (requested && TRANSIENT_FAILURES.has(requested)) {
    return {
      state: 'retrying',
      code: requested,
      retryable: true,
      reason: 'Transient hosted-kernel failure can be retried with backoff.'
    };
  }

  return {
    state: 'claimable',
    code: requested || null,
    retryable: false,
    reason: operationalHealth.status === 'warning'
      ? 'Blocker claim is valid; optional hosted-kernel dependency warnings are recorded for audit.'
      : 'Blocker claim is valid and required hosted-kernel dependencies are healthy.'
  };
}

function buildRetryPolicy(input, failure, operationalHealth) {
  const attempt = Number.isInteger(input.attempt) && input.attempt >= 0 ? input.attempt : 0;
  const retryable = failure.retryable && attempt < MAX_RETRY_ATTEMPTS;
  const requestedRetryAfterMs = asNonNegativeInteger(input.retryAfterMs, 0);
  const dependencyRetryAfterMs = operationalHealth.nextRetryAfterMs;
  const exponentialDelayMs = retryable ? Math.min(30000, 1000 * 2 ** attempt) : 0;
  const delayMs = retryable ? Math.max(exponentialDelayMs, requestedRetryAfterMs, dependencyRetryAfterMs) : 0;

  return {
    retryable,
    attempt,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    backoff: {
      strategy: 'exponential',
      delayMs,
      nextAttemptAllowed: retryable,
      source: dependencyRetryAfterMs > exponentialDelayMs || requestedRetryAfterMs > exponentialDelayMs
        ? 'retry-after'
        : 'attempt-exponential',
      requestedRetryAfterMs,
      dependencyRetryAfterMs
    },
    exhausted: failure.retryable && attempt >= MAX_RETRY_ATTEMPTS
  };
}

function normalizeFailureObservations(input) {
  const rawFailureState = input.failureState && typeof input.failureState === 'object' ? input.failureState : {};
  const rawLastFailure = input.lastFailure && typeof input.lastFailure === 'object' ? input.lastFailure : {};
  const rawObservations = Array.isArray(input.failureObservations)
    ? input.failureObservations
    : Array.isArray(input.failures)
      ? input.failures
      : [];
  const configuredFailure = {
    code: asNonEmptyString(input.failureCode) || asNonEmptyString(rawFailureState.code) || asNonEmptyString(rawLastFailure.code),
    state: asNonEmptyString(rawFailureState.state) || asNonEmptyString(rawLastFailure.state),
    message: asNonEmptyString(rawFailureState.message) || asNonEmptyString(rawLastFailure.message),
    action: asNonEmptyString(rawFailureState.action) || asNonEmptyString(rawLastFailure.action),
    at: asNonEmptyString(rawFailureState.at) || asNonEmptyString(rawLastFailure.at),
    source: asNonEmptyString(rawFailureState.source) || asNonEmptyString(rawLastFailure.source) || 'claim-input',
    retryable: rawFailureState.retryable === true || rawLastFailure.retryable === true
  };
  const observations = rawObservations
    .filter((observation) => observation && typeof observation === 'object')
    .map((observation, index) => ({
      id: asNonEmptyString(observation.id) || `failure-observation-${index + 1}`,
      source: asNonEmptyString(observation.source) || 'hosted-kernel',
      code: asNonEmptyString(observation.code) || 'unknown_failure',
      state: asNonEmptyString(observation.state) || 'observed',
      message: asNonEmptyString(observation.message),
      action: asNonEmptyString(observation.action),
      at: asNonEmptyString(observation.at) || null,
      retryable: observation.retryable === true,
      providerId: asNonEmptyString(observation.providerId),
      dependency: asNonEmptyString(observation.dependency),
      attempt: asNonNegativeInteger(observation.attempt, 0)
    }));

  return configuredFailure.code
    ? [{
        id: 'configured-failure',
        source: configuredFailure.source,
        code: configuredFailure.code,
        state: configuredFailure.state || 'configured',
        message: configuredFailure.message,
        action: configuredFailure.action,
        at: configuredFailure.at || null,
        retryable: configuredFailure.retryable,
        providerId: null,
        dependency: null,
        attempt: asNonNegativeInteger(input.attempt, 0)
      }, ...observations]
    : observations;
}

function buildFailureStateContract({ input, now, validation, settingsValidation, boundaryValidation, providerNegotiation, clientRequestValidation, failure, retryPolicy, operationalHealth }) {
  const observations = normalizeFailureObservations(input);
  const derivedCauses = [
    ...validation.errors.map((error) => ({ source: 'claim-validation', code: error.code, field: error.field, message: error.message, action: error.action, retryable: false })),
    ...settingsValidation.errors.map((error) => ({ source: 'lifecycle-settings', code: error.code, field: error.field, message: error.message, action: error.action, retryable: false })),
    ...boundaryValidation.errors.map((error) => ({ source: 'boundary-validation', code: error.code, field: error.field, message: error.message, action: error.action, retryable: false })),
    ...clientRequestValidation.errors.map((error) => ({ source: 'client-request', code: error.code, field: error.field, message: error.message, action: error.action, retryable: false })),
    ...providerNegotiation.blockingIssues.map((error) => ({
      source: 'provider-negotiation',
      code: error.code,
      field: error.field,
      message: error.message,
      action: error.action,
      retryable: error.code.includes('sync_') || error.code.includes('callback')
    })),
    ...operationalHealth.issues.map((issue) => ({
      source: 'operational-health',
      code: issue.code,
      field: issue.field,
      dependency: issue.dependency,
      message: issue.message,
      action: issue.action,
      retryable: issue.retryAfterMs > 0,
      retryAfterMs: issue.retryAfterMs,
      blocking: issue.blocking
    }))
  ];
  const allCodes = [...new Set([
    ...observations.map((observation) => observation.code),
    ...derivedCauses.map((cause) => cause.code),
    failure.code
  ].filter(Boolean))];
  const terminalCodes = allCodes.filter((code) => TERMINAL_FAILURES.has(code));
  const transientCodes = allCodes.filter((code) => TRANSIENT_FAILURES.has(code));
  const nextRetryAt = retryPolicy.backoff.delayMs > 0
    ? addMillisecondsToTimestamp(now, retryPolicy.backoff.delayMs)
    : null;
  const providerBlocked = providerNegotiation.blockingIssues.length > 0;
  const validationBlocked = !validation.ok || !settingsValidation.ok || !boundaryValidation.ok || !clientRequestValidation.ok;
  const healthBlocked = operationalHealth.status === 'blocked';
  const retryBlocked = failure.retryable && !retryPolicy.retryable;
  const recoveryMode = terminalCodes.length > 0 || failure.state === 'blocked' && !failure.retryable
    ? 'operator-remediation'
    : retryPolicy.retryable
      ? 'retry-after-backoff'
      : failure.state === 'degraded' || operationalHealth.status === 'degraded'
        ? 'degraded-readonly'
        : validationBlocked
          ? 'correct-payload'
          : providerBlocked
            ? 'repair-provider-contract'
            : 'observe';

  return {
    contractVersion: 1,
    generatedAt: now,
    state: failure.state,
    code: failure.code,
    reason: failure.reason,
    retryable: failure.retryable,
    category: terminalCodes.length > 0
      ? 'terminal'
      : transientCodes.length > 0 || retryPolicy.retryable
        ? 'transient'
        : healthBlocked
          ? 'dependency'
          : validationBlocked
            ? 'validation'
            : providerBlocked
              ? 'provider'
              : 'none',
    recoveryMode,
    mutationBlocked: failure.state !== 'claimable' || validationBlocked || providerBlocked || healthBlocked || retryBlocked,
    degradedMode: {
      active: failure.state === 'degraded' || operationalHealth.status === 'degraded',
      allowed: operationalHealth.degradedModeAvailable && terminalCodes.length === 0,
      readOnly: failure.state === 'degraded' || operationalHealth.status !== 'healthy',
      reason: operationalHealth.status === 'degraded'
        ? 'Required dependency health allows read-only blocker-claim handling while mutation is paused.'
        : null
    },
    retry: {
      ...retryPolicy,
      nextRetryAt,
      blockedReason: retryPolicy.exhausted
        ? 'retry_attempts_exhausted'
        : failure.retryable && !retryPolicy.retryable
          ? 'retry_not_currently_allowed'
          : null
    },
    observations,
    derivedCauses,
    auditProof: {
      proofType: 'blocker-claim-failure-state',
      sourceSurfaceId: surfaceId,
      generatedAt: now,
      causeCount: derivedCauses.length,
      observationCount: observations.length,
      terminalCodes,
      transientCodes,
      healthIssueCount: operationalHealth.issues.length,
      providerIssueCount: providerNegotiation.blockingIssues.length,
      validationIssueCount: validation.errors.length + settingsValidation.errors.length + boundaryValidation.errors.length + clientRequestValidation.errors.length
    },
    operatorActions: derivedCauses
      .slice(0, 6)
      .map((cause) => ({
        code: cause.code,
        source: cause.source,
        field: cause.field || null,
        dependency: cause.dependency || null,
        action: cause.action || 'Review the blocker-claim failure state before retrying mutation.'
      }))
  };
}

function buildActionableErrors(validation, settingsValidation, settingsControlValidation, boundaryValidation, providerNegotiation, clientRequestValidation, failure, retryPolicy, operationalHealth) {
  const healthErrors = operationalHealth.issues.map((issue) => ({
    code: issue.code,
    field: issue.field,
    dependency: issue.dependency,
    severity: issue.severity,
    blocking: issue.blocking,
    retryAfterMs: issue.retryAfterMs,
    message: issue.message,
    action: issue.action
  }));

  const retryErrors = retryPolicy.exhausted
    ? [{
        code: 'retry_exhausted',
        field: 'attempt',
        message: `Retry attempts exhausted after ${retryPolicy.attempt} attempt(s).`,
        action: 'Escalate the blocker claim with the latest failure proof before retrying again.'
      }]
    : [];

  const failureError = failure.state === 'blocked' && validation.ok
    ? [{
        code: failure.code,
        field: 'failureCode',
        message: failure.reason,
        action: 'Create a corrected claim payload or clear the terminal failure code after remediation.'
      }]
    : [];

  return [
    ...validation.errors,
    ...settingsValidation.errors,
    ...settingsControlValidation.errors,
    ...boundaryValidation.errors,
    ...providerNegotiation.blockingIssues,
    ...clientRequestValidation.errors,
    ...healthErrors,
    ...retryErrors,
    ...failureError
  ];
}

function buildLifecycleCommands({ settings, scheduleControl, settingsControlPlan, failure, retryPolicy, validation, settingsValidation, actionableErrors, proof }) {
  const controlsOpen = settings.enabled && settings.claimingEnabled && settings.mutationEnabled;
  const scheduleGateOpen = settings.mode !== 'scheduled'
    || scheduleControl.runnableNow
    || (scheduleControl.manualOverrideAllowed && proof.principalPermissions.canMutate);
  const mutationReady = controlsOpen
    && scheduleGateOpen
    && validation.ok
    && settingsValidation.ok
    && actionableErrors.length === 0
    && proof.canMutateKernelLifecycle;
  const retryReady = settings.autoRetryEnabled
    && retryPolicy.retryable
    && settingsValidation.ok
    && proof.boundaryComplete
    && proof.principalPermissions.canClaim;
  const scheduledReady = settings.mode === 'scheduled'
    && settings.schedule.enabled
    && settingsValidation.ok
    && proof.boundaryComplete
    && proof.principalPermissions.canMutate
    && scheduleControl.runnableNow;
  const controlsMutable = proof.boundaryComplete && proof.principalPermissions.canMutate;
  const blockedReason = !settings.enabled
    ? settings.pauseReason || 'Lifecycle controls are disabled.'
    : !settings.claimingEnabled
      ? 'Blocker claiming is disabled by lifecycle settings.'
      : !settings.mutationEnabled
        ? 'Lifecycle mutation is disabled by settings.'
        : settings.mode === 'scheduled' && !scheduleGateOpen
          ? `Scheduled lifecycle is held by ${scheduleControl.holdReasons[0] || 'schedule gate'}.`
        : actionableErrors[0]?.message || failure.reason;

  const commands = [
    {
      command: 'claim-blocker',
      enabled: mutationReady,
      reason: mutationReady ? 'Claim can mutate hosted-kernel lifecycle state.' : blockedReason
    },
    {
      command: 'retry-claim',
      enabled: retryReady && controlsOpen,
      reason: retryReady ? `Retry allowed after ${retryPolicy.backoff.delayMs}ms backoff.` : 'Retry is not enabled for the current lifecycle state.'
    },
    {
      command: 'schedule-claim',
      enabled: scheduledReady && controlsOpen && settingsValidation.ok,
      reason: scheduledReady
        ? `Scheduled blocker-claim run is due at ${settings.schedule.nextRunAt}.`
        : scheduleControl.holdReasons.includes('waiting_for_next_run')
          ? `Waiting for scheduled blocker-claim run at ${settings.schedule.nextRunAt}.`
          : 'Scheduling is inactive or held for this blocker claim.'
    },
    {
      command: 'enable-claiming',
      enabled: !settings.claimingEnabled && settings.enabled && controlsMutable,
      reason: !settings.claimingEnabled
        ? 'Claiming can be re-enabled by an operator with mutation permission.'
        : 'Blocker claiming is already enabled.'
    },
    {
      command: 'disable-claiming',
      enabled: settings.claimingEnabled && settings.enabled && controlsMutable,
      reason: settings.claimingEnabled
        ? 'Claiming can be disabled while preserving read-only blocker proof.'
        : 'Blocker claiming is already disabled.'
    },
    {
      command: 'manual-override-schedule',
      enabled: settings.mode === 'scheduled'
        && scheduleControl.manualOverrideAllowed
        && !scheduleControl.runnableNow
        && controlsOpen
        && controlsMutable
        && settingsValidation.ok,
      reason: scheduleControl.manualOverrideAllowed
        ? `Schedule override is available while held by ${scheduleControl.holdReasons[0] || 'schedule gate'}.`
        : 'Schedule override is not allowed for this blocker claim.'
    },
    {
      command: 'pause-claim',
      enabled: settings.enabled && proof.boundaryComplete && proof.principalPermissions.canMutate,
      reason: settings.enabled && proof.boundaryComplete
        ? 'Lifecycle controls can be paused for operator review.'
        : settings.enabled
          ? 'Pause command requires a valid tenant/workspace boundary with mutation permission.'
          : 'Lifecycle controls are already paused.'
    },
    {
      command: 'apply-settings-control',
      enabled: settingsControlPlan.enabled && proof.boundaryComplete && proof.principalPermissions.canMutate,
      reason: settingsControlPlan.enabled
        ? `Apply lifecycle settings command ${settingsControlPlan.command}.`
        : settingsControlPlan.requested
          ? settingsControlPlan.errors[0]?.message || 'Lifecycle settings control command is not ready.'
          : 'No lifecycle settings control command was requested.',
      idempotencyKey: settingsControlPlan.idempotencyKey,
      controlCommand: settingsControlPlan.command,
      statePatch: settingsControlPlan.statePatch,
      auditRecord: settingsControlPlan.auditRecord
    }
  ];

  const nextAction = commands.find((command) => (
    command.enabled && !['pause-claim', 'disable-claiming'].includes(command.command)
  ))?.command || commands.find((command) => command.enabled)?.command || 'operator-remediation';

  return {
    controlsOpen,
    scheduleGateOpen,
    mutationReady,
    nextAction,
    scheduleControl,
    commands
  };
}

function normalizeHistorySnapshots(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .map((snapshot, index) => ({
      sequence: Number.isInteger(snapshot.sequence) && snapshot.sequence >= 0 ? snapshot.sequence : index + 1,
      at: asNonEmptyString(snapshot.at) || asNonEmptyString(snapshot.generatedAt) || null,
      claimId: asNonEmptyString(snapshot.claimId),
      blockerId: asNonEmptyString(snapshot.blockerId),
      owner: asNonEmptyString(snapshot.owner),
      state: asNonEmptyString(snapshot.state) || 'unknown',
      decision: asNonEmptyString(snapshot.decision) || 'unknown',
      retryable: snapshot.retryable === true,
      proofCount: Number.isInteger(snapshot.proofCount) && snapshot.proofCount >= 0 ? snapshot.proofCount : 0,
      errorCount: Number.isInteger(snapshot.errorCount) && snapshot.errorCount >= 0 ? snapshot.errorCount : 0,
      providerMode: asNonEmptyString(snapshot.providerMode) || 'unknown',
      providerReady: snapshot.providerReady === true,
      handoffState: asNonEmptyString(snapshot.handoffState) || 'unknown',
      handoffDispatchable: snapshot.handoffDispatchable === true,
      restartStatus: asNonEmptyString(snapshot.restartStatus) || 'unknown',
      replayRequired: snapshot.replayRequired === true,
      mutationReady: snapshot.mutationReady === true,
      clientIntent: asNonEmptyString(snapshot.clientIntent) || 'unknown',
      clientRoute: asNonEmptyString(snapshot.clientRoute),
      nextAction: asNonEmptyString(snapshot.nextAction) || 'unknown',
      scheduleAction: asNonEmptyString(snapshot.scheduleAction) || 'unknown',
      requiredChecksFailed: Array.isArray(snapshot.requiredChecksFailed)
        ? snapshot.requiredChecksFailed.filter((name) => asNonEmptyString(name)).map((name) => name.trim())
        : []
    }));
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildCurrentSnapshot({ now, claim, failure, retryPolicy, actionableErrors, healthChecks, evidence, audit, providerNegotiation, externalHandoff, persistedStatus, lifecycleControl, clientRequest }) {
  return {
    sequence: 0,
    at: now,
    claimId: claim.claimId,
    blockerId: claim.blockerId,
    owner: claim.owner,
    state: failure.state,
    decision: audit.decision,
    retryable: retryPolicy.retryable,
    proofCount: evidence.length,
    errorCount: actionableErrors.length,
    providerMode: providerNegotiation.mode,
    providerReady: providerNegotiation.ready,
    handoffState: externalHandoff.state,
    handoffDispatchable: externalHandoff.dispatchable,
    restartStatus: persistedStatus.restartStatus,
    replayRequired: persistedStatus.replayRequired,
    mutationReady: lifecycleControl.mutationReady,
    clientIntent: clientRequest.intent,
    clientRoute: clientRequest.returnRoute,
    nextAction: lifecycleControl.nextAction,
    scheduleAction: lifecycleControl.scheduleControl.nextAction,
    requiredChecksFailed: healthChecks.filter((check) => check.required && !check.ok).map((check) => check.name)
  };
}

function buildTimeline(historySnapshots, currentSnapshot) {
  const events = [...historySnapshots, currentSnapshot].map((snapshot, index) => ({
    id: `${snapshot.claimId || 'claim'}:${snapshot.at || 'undated'}:${index + 1}`,
    at: snapshot.at,
    sequence: snapshot.sequence || index + 1,
    state: snapshot.state,
    decision: snapshot.decision,
    retryable: snapshot.retryable,
    proofCount: snapshot.proofCount,
    errorCount: snapshot.errorCount,
    providerMode: snapshot.providerMode,
    providerReady: snapshot.providerReady,
    handoffState: snapshot.handoffState,
    handoffDispatchable: snapshot.handoffDispatchable,
    restartStatus: snapshot.restartStatus,
    replayRequired: snapshot.replayRequired,
    mutationReady: snapshot.mutationReady,
    clientIntent: snapshot.clientIntent,
    clientRoute: snapshot.clientRoute,
    nextAction: snapshot.nextAction,
    scheduleAction: snapshot.scheduleAction,
    requiredChecksFailed: snapshot.requiredChecksFailed
  }));

  return events.sort((left, right) => {
    if (left.at && right.at && left.at !== right.at) {
      return left.at.localeCompare(right.at);
    }

    return left.sequence - right.sequence;
  });
}

function buildStateTransitions(timeline) {
  return timeline.slice(1).map((event, index) => {
    const previous = timeline[index];

    return {
      fromState: previous.state,
      toState: event.state,
      fromDecision: previous.decision,
      toDecision: event.decision,
      at: event.at,
      sequence: event.sequence,
      changed: previous.state !== event.state || previous.decision !== event.decision,
      mutationBecameReady: !previous.mutationReady && event.mutationReady,
      replayBecameRequired: !previous.replayRequired && event.replayRequired
    };
  });
}

function buildAnalytics({ historySnapshots, currentSnapshot, evidence, healthChecks, actionableErrors, retryPolicy }) {
  const allSnapshots = [...historySnapshots, currentSnapshot];
  const failedRequiredChecks = healthChecks.filter((check) => check.required && !check.ok);
  const retryableSnapshots = allSnapshots.filter((snapshot) => snapshot.retryable);
  const rejectedSnapshots = allSnapshots.filter((snapshot) => snapshot.decision === 'reject-claim');
  const orderedSnapshots = [...allSnapshots].sort((left, right) => {
    const leftMs = parseTimestampMs(left.at);
    const rightMs = parseTimestampMs(right.at);

    if (leftMs !== null && rightMs !== null && leftMs !== rightMs) {
      return leftMs - rightMs;
    }

    return left.sequence - right.sequence;
  });
  const transitions = buildStateTransitions(orderedSnapshots);
  const changedTransitions = transitions.filter((transition) => transition.changed);
  const totalErrors = allSnapshots.reduce((sum, snapshot) => sum + snapshot.errorCount, 0);
  const totalProofs = allSnapshots.reduce((sum, snapshot) => sum + snapshot.proofCount, 0);

  return {
    counters: {
      snapshots: allSnapshots.length,
      priorSnapshots: historySnapshots.length,
      evidence: evidence.length,
      healthChecks: healthChecks.length,
      requiredHealthChecksFailed: failedRequiredChecks.length,
      actionableErrors: actionableErrors.length,
      retryableDecisions: retryableSnapshots.length,
      rejectedDecisions: rejectedSnapshots.length,
      retryExhausted: retryPolicy.exhausted ? 1 : 0,
      providerReadySnapshots: allSnapshots.filter((snapshot) => snapshot.providerReady).length,
      handoffDispatchableSnapshots: allSnapshots.filter((snapshot) => snapshot.handoffDispatchable).length,
      replayRequiredSnapshots: allSnapshots.filter((snapshot) => snapshot.replayRequired).length,
      mutationReadySnapshots: allSnapshots.filter((snapshot) => snapshot.mutationReady).length,
      stateTransitions: transitions.length,
      changedTransitions: changedTransitions.length
    },
    byState: countBy(allSnapshots, (snapshot) => snapshot.state),
    byDecision: countBy(allSnapshots, (snapshot) => snapshot.decision),
    byProviderMode: countBy(allSnapshots, (snapshot) => snapshot.providerMode),
    byHandoffState: countBy(allSnapshots, (snapshot) => snapshot.handoffState),
    byRestartStatus: countBy(allSnapshots, (snapshot) => snapshot.restartStatus),
    byClientIntent: countBy(allSnapshots, (snapshot) => snapshot.clientIntent),
    transitionSummary: {
      stable: changedTransitions.length === 0,
      changedTransitions: changedTransitions.length,
      mutationBecameReady: transitions.filter((transition) => transition.mutationBecameReady).length,
      replayBecameRequired: transitions.filter((transition) => transition.replayBecameRequired).length,
      latestTransition: transitions[transitions.length - 1] || null
    },
    aggregates: {
      averageErrorsPerSnapshot: allSnapshots.length > 0 ? Number((totalErrors / allSnapshots.length).toFixed(2)) : 0,
      averageProofsPerSnapshot: allSnapshots.length > 0 ? Number((totalProofs / allSnapshots.length).toFixed(2)) : 0,
      firstObservedAt: orderedSnapshots[0]?.at || null,
      latestObservedAt: orderedSnapshots[orderedSnapshots.length - 1]?.at || null
    },
    latest: {
      state: currentSnapshot.state,
      decision: currentSnapshot.decision,
      retryable: currentSnapshot.retryable,
      proofCount: currentSnapshot.proofCount,
      errorCount: currentSnapshot.errorCount,
      providerMode: currentSnapshot.providerMode,
      handoffState: currentSnapshot.handoffState,
      restartStatus: currentSnapshot.restartStatus,
      mutationReady: currentSnapshot.mutationReady,
      nextAction: currentSnapshot.nextAction
    }
  };
}

function parseTimestampMs(value) {
  const timestamp = asNonEmptyString(value);
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeReportingSettings(input) {
  const raw = input.reporting && typeof input.reporting === 'object'
    ? input.reporting
    : input.analyticsExport && typeof input.analyticsExport === 'object'
      ? input.analyticsExport
      : {};
  const formats = normalizeStringList(raw.formats || raw.exportFormats)
    .filter((format) => EXPORT_FORMATS.has(format));

  return {
    enabled: asBoolean(raw.enabled, true),
    reportId: asNonEmptyString(raw.reportId) || asNonEmptyString(input.reportId),
    requestedBy: asNonEmptyString(raw.requestedBy) || asNonEmptyString(input.exportRequestedBy),
    includeTimelineRows: asBoolean(raw.includeTimelineRows, true),
    includeErrorDetails: asBoolean(raw.includeErrorDetails, true),
    staleAfterMs: asNonNegativeInteger(raw.staleAfterMs, 24 * 60 * 60 * 1000),
    formats: formats.length > 0 ? formats : ['json'],
    label: asNonEmptyString(raw.label) || 'blocker-claim-lifecycle-report'
  };
}

function buildTimelineRows(timeline) {
  return timeline.map((event, index) => ({
    row: index + 1,
    eventId: event.id,
    at: event.at,
    sequence: event.sequence,
    state: event.state,
    decision: event.decision,
    retryable: event.retryable,
    proofCount: event.proofCount,
    errorCount: event.errorCount,
    providerMode: event.providerMode,
    providerReady: event.providerReady,
    handoffState: event.handoffState,
    handoffDispatchable: event.handoffDispatchable,
    restartStatus: event.restartStatus,
    replayRequired: event.replayRequired,
    mutationReady: event.mutationReady,
    clientIntent: event.clientIntent,
    clientRoute: event.clientRoute,
    nextAction: event.nextAction,
    scheduleAction: event.scheduleAction,
    requiredChecksFailed: event.requiredChecksFailed.join(',')
  }));
}

function buildReportingSummaryRows(analytics) {
  return [
    { metric: 'snapshots', value: analytics.counters.snapshots, group: 'volume' },
    { metric: 'actionableErrors', value: analytics.counters.actionableErrors, group: 'quality' },
    { metric: 'requiredHealthChecksFailed', value: analytics.counters.requiredHealthChecksFailed, group: 'health' },
    { metric: 'mutationReadySnapshots', value: analytics.counters.mutationReadySnapshots, group: 'lifecycle' },
    { metric: 'replayRequiredSnapshots', value: analytics.counters.replayRequiredSnapshots, group: 'recovery' },
    { metric: 'handoffDispatchableSnapshots', value: analytics.counters.handoffDispatchableSnapshots, group: 'handoff' },
    { metric: 'changedTransitions', value: analytics.counters.changedTransitions, group: 'timeline' },
    { metric: 'averageErrorsPerSnapshot', value: analytics.aggregates.averageErrorsPerSnapshot, group: 'aggregate' },
    { metric: 'averageProofsPerSnapshot', value: analytics.aggregates.averageProofsPerSnapshot, group: 'aggregate' }
  ];
}

function buildReportingState({ now, settings, timeline, analytics, actionableErrors, providerNegotiation, externalHandoff, persistedStatus, operationalHealth }) {
  const nowMs = parseTimestampMs(now);
  const latestAtMs = parseTimestampMs(timeline[timeline.length - 1]?.at);
  const latestAgeMs = nowMs !== null && latestAtMs !== null ? Math.max(0, nowMs - latestAtMs) : null;
  const stale = latestAgeMs !== null && latestAgeMs > settings.staleAfterMs;
  const alerts = [
    ...(stale ? [{
      code: 'reporting_snapshot_stale',
      severity: 'warning',
      message: `Latest blocker-claim timeline event is older than ${settings.staleAfterMs}ms.`
    }] : []),
    ...(analytics.counters.actionableErrors > 0 ? [{
      code: 'reporting_actionable_errors_present',
      severity: 'error',
      message: `${analytics.counters.actionableErrors} blocker-claim issue(s) require operator action before mutation.`
    }] : []),
    ...(!providerNegotiation.ready ? [{
      code: 'reporting_provider_contract_blocked',
      severity: 'error',
      message: 'Provider negotiation is not ready for hosted-kernel blocker-claim sync.'
    }] : []),
    ...(persistedStatus.replayRequired ? [{
      code: 'reporting_replay_required',
      severity: 'warning',
      message: 'Persisted blocker-claim journal replay is required before lifecycle mutation.'
    }] : []),
    ...(externalHandoff.state === 'handoff-blocked' ? [{
      code: 'reporting_handoff_blocked',
      severity: 'warning',
      message: 'External blocker-claim handoff was requested but is not ready.'
    }] : []),
    ...(operationalHealth.status === 'blocked' ? [{
      code: 'reporting_operational_health_blocked',
      severity: 'error',
      message: 'Required hosted-kernel dependency health is blocking blocker-claim mutation.'
    }] : []),
    ...(operationalHealth.status === 'degraded' ? [{
      code: 'reporting_operational_health_degraded',
      severity: 'warning',
      message: 'Hosted-kernel dependency health allows read-only degraded blocker-claim handling.'
    }] : [])
  ];
  const timelineRows = settings.includeTimelineRows ? buildTimelineRows(timeline) : [];
  const summaryRows = buildReportingSummaryRows(analytics);

  return {
    enabled: settings.enabled,
    reportId: settings.reportId || `${surfaceId}:${timeline[timeline.length - 1]?.eventId || 'no-events'}`,
    label: settings.label,
    generatedAt: now,
    requestedBy: settings.requestedBy,
    freshness: {
      latestEventAt: timeline[timeline.length - 1]?.at || null,
      latestAgeMs,
      staleAfterMs: settings.staleAfterMs,
      stale
    },
    exportManifest: {
      formats: settings.formats,
      ready: settings.enabled && alerts.every((alert) => alert.severity !== 'error'),
      recordCount: timelineRows.length + summaryRows.length,
      timelineRecordCount: timelineRows.length,
      summaryRecordCount: summaryRows.length,
      includesErrors: settings.includeErrorDetails,
      includesTimelineRows: settings.includeTimelineRows,
      datasets: [
        'summary',
        ...(settings.includeTimelineRows ? ['timeline'] : []),
        ...(settings.includeErrorDetails ? ['errors'] : [])
      ]
    },
    counters: {
      ...analytics.counters,
      timelineRows: timelineRows.length,
      alerts: alerts.length,
      errorAlerts: alerts.filter((alert) => alert.severity === 'error').length,
      warningAlerts: alerts.filter((alert) => alert.severity === 'warning').length
    },
    operationalHealth: {
      status: operationalHealth.status,
      mutationSafe: operationalHealth.mutationSafe,
      degradedModeAvailable: operationalHealth.degradedModeAvailable,
      requiredChecksFailed: operationalHealth.requiredChecksFailed,
      requiredChecksStale: operationalHealth.requiredChecksStale,
      nextRetryAfterMs: operationalHealth.nextRetryAfterMs
    },
    alerts,
    summaryRows,
    timelineRows,
    errorDetails: settings.includeErrorDetails
      ? actionableErrors.map((error, index) => ({
          row: index + 1,
          code: error.code,
          field: error.field,
          action: error.action
        }))
      : []
  };
}

function buildProviderHandoffBoundary({ provider, boundary }) {
  const targetTenantId = provider.handoff.tenantId || boundary.handoffTenantId || boundary.tenantId;
  const targetWorkspaceId = provider.handoff.workspaceId || boundary.workspaceId;
  const crossTenant = Boolean(targetTenantId && boundary.tenantId && targetTenantId !== boundary.tenantId);
  const crossWorkspace = Boolean(targetWorkspaceId && boundary.workspaceId && targetWorkspaceId !== boundary.workspaceId);
  const tenantAllowed = !crossTenant || boundary.allowedTenantHandoffs.includes(targetTenantId);
  const workspaceAllowed = !crossWorkspace || boundary.allowedWorkspaces.includes(targetWorkspaceId);
  const hasDispatchPermission = boundary.permissionChecks.canHandoff;
  const ready = hasDispatchPermission && tenantAllowed && workspaceAllowed;
  const violations = [
    ...(!hasDispatchPermission ? [{
      code: 'missing_handoff_permission',
      field: 'principal.permissions',
      message: 'Principal cannot dispatch external blocker-claim handoff.'
    }] : []),
    ...(!tenantAllowed ? [{
      code: 'provider_handoff_tenant_scope_denied',
      field: `providerContracts.${provider.providerId}.handoff.tenantId`,
      message: 'Provider handoff targets a tenant outside the approved tenant handoff allowlist.'
    }] : []),
    ...(!workspaceAllowed ? [{
      code: 'provider_handoff_workspace_scope_denied',
      field: `providerContracts.${provider.providerId}.handoff.workspaceId`,
      message: 'Provider handoff targets a workspace outside the active workspace scope.'
    }] : [])
  ];

  return {
    ready,
    targetTenantId,
    targetWorkspaceId,
    crossTenant,
    crossWorkspace,
    tenantAllowed,
    workspaceAllowed,
    hasDispatchPermission,
    isolationMode: crossTenant
      ? 'approved-cross-tenant-handoff'
      : crossWorkspace
        ? 'approved-cross-workspace-handoff'
        : 'same-boundary-handoff',
    violations
  };
}

function buildHandoffAuditRecord({ claim, audit, provider, boundaryScope, boundary }) {
  const disclosureFields = [
    'claimId',
    'blockerId',
    'tenantId',
    'workspaceId',
    'decision',
    'actor',
    'proofCount'
  ];
  const sourceRef = [
    surfaceId,
    claim.claimId || 'unassigned-claim',
    claim.blockerId || 'unassigned-blocker',
    provider.providerId,
    boundaryScope.targetTenantId || 'unscoped-tenant',
    boundaryScope.targetWorkspaceId || 'unscoped-workspace',
    audit.decision
  ].join(':');

  return {
    contractVersion: 1,
    recordType: 'blocker-claim-handoff-audit',
    sourceSurfaceId: surfaceId,
    providerId: provider.providerId,
    sourceTenantId: boundary.tenantId,
    sourceWorkspaceId: boundary.workspaceId,
    targetTenantId: boundaryScope.targetTenantId,
    targetWorkspaceId: boundaryScope.targetWorkspaceId,
    isolationMode: boundaryScope.isolationMode,
    disclosure: {
      mode: boundaryScope.crossTenant ? 'tenant-minimized' : 'workspace-scoped',
      fields: disclosureFields,
      redactedFields: boundaryScope.crossTenant ? ['owner', 'reason', 'evidence'] : ['evidence']
    },
    proofRef: {
      id: sourceRef,
      decision: audit.decision,
      actor: audit.actor,
      proofCount: audit.proofCount
    },
    violations: boundaryScope.violations.map((violation) => violation.code),
    handoffAllowed: boundaryScope.ready
  };
}

function buildExternalHandoff({ claim, audit, providerContracts, providerNegotiation, lifecycleControl, boundary }) {
  const requestedProviders = providerContracts.filter((provider) => provider.handoff.requested);
  const providerRoutes = requestedProviders.map((provider) => {
    const accepted = providerNegotiation.acceptedProviders.includes(provider.providerId);
    const syncStatus = providerNegotiation.syncStatuses.find((status) => status.providerId === provider.providerId)
      || buildProviderSyncStatus(provider, { mode: 'manual' }, null);
    const serviceCommitment = providerNegotiation.serviceCommitments.find((commitment) => commitment.providerId === provider.providerId);
    const capabilityReady = provider.capabilities.includes('external-handoff');
    const targetReady = Boolean(provider.handoff.target);
    const boundaryScope = buildProviderHandoffBoundary({ provider, boundary });
    const auditHandoff = buildHandoffAuditRecord({ claim, audit, provider, boundaryScope, boundary });
    const boundaryReady = boundaryScope.ready && boundary.handoffTenantAllowed;
    const receiptAccepted = !provider.handoff.requiresReceipt
      || provider.handoff.receiptState === 'accepted'
      || (provider.handoff.receiptState === 'pending' && provider.handoff.receiptId);
    const ready = accepted && capabilityReady && targetReady && boundaryReady && receiptAccepted;
    const missing = [
      ...(!accepted ? ['provider_contract_not_accepted'] : []),
      ...(!capabilityReady ? ['missing_external_handoff_capability'] : []),
      ...(!targetReady ? ['missing_handoff_target'] : []),
      ...boundaryScope.violations.map((violation) => violation.code),
      ...(!boundary.handoffTenantAllowed ? ['handoff_tenant_not_allowed'] : []),
      ...(!receiptAccepted ? ['handoff_receipt_not_accepted'] : [])
    ];

    return {
      providerId: provider.providerId,
      service: provider.service,
      version: provider.version,
      target: provider.handoff.target,
      targetKind: provider.handoff.targetKind,
      dispatchMode: provider.handoff.dispatchMode,
      payloadVersion: provider.handoff.payloadVersion,
      tenantId: boundaryScope.targetTenantId,
      workspaceId: boundaryScope.targetWorkspaceId,
      state: provider.handoff.state,
      receiptId: provider.handoff.receiptId,
      receiptState: provider.handoff.receiptState,
      requiresReceipt: provider.handoff.requiresReceipt,
      serviceContract: provider.serviceContract,
      serviceCommitment,
      syncStatus,
      boundaryScope,
      auditHandoff,
      ready,
      missing,
      dispatchEnvelope: ready
        ? {
            route: `${surfaceGroup}/${surfaceName}/external-handoff`,
            providerId: provider.providerId,
            target: provider.handoff.target,
            targetKind: provider.handoff.targetKind,
            payloadVersion: provider.handoff.payloadVersion,
            claimRef: {
              claimId: claim.claimId,
              blockerId: claim.blockerId,
              tenantId: boundary.tenantId,
              workspaceId: boundary.workspaceId,
              targetTenantId: boundaryScope.targetTenantId,
              targetWorkspaceId: boundaryScope.targetWorkspaceId
            },
            auditRef: {
              decision: audit.decision,
              actor: audit.actor,
              proofCount: audit.proofCount,
              handoffProofId: auditHandoff.proofRef.id
            },
            providerContract: {
              serviceKey: provider.serviceContract.serviceKey,
              schemaVersion: provider.serviceContract.schemaVersion,
              authScheme: provider.serviceContract.authScheme,
              consistency: provider.serviceContract.consistency,
              syncMode: syncStatus.mode,
              syncCursor: provider.sync.cursor || null,
              acknowledgementCursor: provider.sync.acknowledgementCursor || null,
              proofDigest: provider.sync.proofDigest || null,
              idempotent: provider.serviceContract.acceptsIdempotencyKey,
              callbacks: provider.serviceContract.callbackRoutes
            },
            mailchimp: provider.mailchimp.detected
              ? {
                  accountId: provider.mailchimp.accountId,
                  audienceIds: provider.mailchimp.audienceIds,
                  events: provider.mailchimp.acceptedEvents,
                  webhookRoute: provider.mailchimp.webhookRoute || null,
                  webhookSecretRefPresent: Boolean(provider.mailchimp.webhookSecretRef),
                  requiresExternalHandoff: provider.mailchimp.requiresExternalHandoff
                }
              : null,
            serviceCommitment,
            boundaryContract: {
              isolationMode: boundaryScope.isolationMode,
              crossTenant: boundaryScope.crossTenant,
              crossWorkspace: boundaryScope.crossWorkspace,
              disclosure: auditHandoff.disclosure
            },
            auditHandoff
          }
        : null
    };
  });
  const readyProviders = providerRoutes.filter((provider) => provider.ready);
  const blockedProviders = providerRoutes.filter((provider) => !provider.ready);
  const dispatchRequired = requestedProviders.length > 0 && lifecycleControl.mutationReady;
  const dispatchable = dispatchRequired && readyProviders.length > 0;

  return {
    requested: requestedProviders.length > 0,
    dispatchRequired,
    dispatchable,
    state: dispatchable
      ? 'handoff-ready'
      : requestedProviders.length > 0
        ? 'handoff-blocked'
        : 'local-control',
    claimRef: {
      claimId: claim.claimId,
      blockerId: claim.blockerId,
      decision: audit.decision,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId
    },
    counts: {
      requestedProviders: requestedProviders.length,
      readyProviders: readyProviders.length,
      blockedProviders: blockedProviders.length
    },
    providers: providerRoutes,
    dispatchBatch: {
      batchId: `${surfaceId}:${claim.claimId || 'unassigned-claim'}:${claim.blockerId || 'unassigned-blocker'}:handoff`,
      mode: readyProviders.length > 1 ? 'fanout' : 'single-provider',
      readyProviderIds: readyProviders.map((provider) => provider.providerId),
      blockedProviderIds: blockedProviders.map((provider) => provider.providerId),
      serviceCommitmentIds: readyProviders
        .filter((provider) => provider.serviceCommitment)
        .map((provider) => provider.serviceCommitment.serviceKey),
      boundaryScopes: readyProviders.map((provider) => ({
        providerId: provider.providerId,
        tenantId: provider.boundaryScope.targetTenantId,
        workspaceId: provider.boundaryScope.targetWorkspaceId,
        isolationMode: provider.boundaryScope.isolationMode
      })),
      envelopes: readyProviders.map((provider) => provider.dispatchEnvelope)
    },
    auditHandoffRecords: providerRoutes.map((provider) => provider.auditHandoff),
    pendingReasons: [
      ...providerNegotiation.blockingIssues.map((issue) => issue.code),
      ...blockedProviders.flatMap((provider) => provider.missing),
      ...(!lifecycleControl.mutationReady && requestedProviders.length > 0 ? ['lifecycle_mutation_not_ready'] : [])
    ]
  };
}

function normalizeScopeMatcherMailchimpReadiness(input) {
  const source = input.scopeMatcherMailchimpReadiness && typeof input.scopeMatcherMailchimpReadiness === 'object'
    ? input.scopeMatcherMailchimpReadiness
    : input.mailchimpReadinessExportDataset && typeof input.mailchimpReadinessExportDataset === 'object'
      ? input.mailchimpReadinessExportDataset
      : input.scopeMatcher?.mailchimpReadinessExportDataset && typeof input.scopeMatcher.mailchimpReadinessExportDataset === 'object'
        ? input.scopeMatcher.mailchimpReadinessExportDataset
        : input.scopeMatcher?.reporting?.mailchimpReadinessExport && typeof input.scopeMatcher.reporting.mailchimpReadinessExport === 'object'
          ? input.scopeMatcher.reporting.mailchimpReadinessExport
          : {};
  const rows = Array.isArray(source.exportRows)
    ? source.exportRows
    : Array.isArray(source.rows)
      ? source.rows
      : [];
  const normalizedRows = rows
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => {
      const requestedScope = asNonEmptyString(row.requestedScope) || `mailchimp-scope-${index + 1}`;
      const state = asNonEmptyString(row.scopeState) || asNonEmptyString(row.state) || 'unknown';
      const handoffState = asNonEmptyString(row.handoffState) || 'not_required';
      const deniedReasons = normalizeStringList(row.deniedReasons || row.reasons || row.blockers);
      const decision = asNonEmptyString(row.decision) || (state === 'ready' ? 'allow' : 'deny');

      return {
        requestedScope,
        decision,
        state,
        handoffState,
        mutatingScope: row.mutatingScope === true,
        providerIds: normalizeStringList(row.providerIds),
        readyProviderIds: normalizeStringList(row.readyProviderIds),
        blockedProviderIds: normalizeStringList(row.blockedProviderIds),
        requiredHandoffEvents: normalizeStringList(row.requiredHandoffEvents),
        deniedReasons,
        nextAction: asNonEmptyString(row.nextAction),
        resumeWhen: asNonEmptyString(row.resumeWhen)
      };
    });
  const blockedRows = normalizedRows.filter((row) => (
    row.decision === 'deny' ||
    row.state === 'blocked' ||
    row.handoffState === 'blocked' ||
    row.deniedReasons.length > 0
  ));
  const mutatingRows = normalizedRows.filter((row) => row.mutatingScope);
  const reasonCounts = blockedRows.reduce((counts, row) => {
    row.deniedReasons.forEach((reason) => {
      counts[reason] = (counts[reason] || 0) + 1;
    });
    return counts;
  }, {});
  const nextActions = Array.from(new Set([
    ...normalizeStringList(source.nextActions),
    ...blockedRows.map((row) => row.nextAction)
  ].filter(Boolean))).sort();

  return {
    contractVersion: 1,
    sourceContract: asNonEmptyString(source.contract) || 'hosted-kernel.scope-matcher.mailchimp-readiness-export-dataset.v1',
    supplied: Object.keys(source).length > 0,
    detected: source.detected === true || normalizedRows.length > 0,
    state: asNonEmptyString(source.state) || (blockedRows.length ? 'blocked' : normalizedRows.length ? 'ready' : 'not-required'),
    canAccept: source.canAccept === true || (normalizedRows.length > 0 && blockedRows.length === 0),
    dataset: asNonEmptyString(source.dataset),
    rowCount: Number.isInteger(source.rowCount) ? source.rowCount : normalizedRows.length,
    readyScopeCount: Number.isInteger(source.readyScopeCount)
      ? source.readyScopeCount
      : normalizedRows.filter((row) => row.decision === 'allow' && row.handoffState !== 'blocked').length,
    blockedScopeCount: Number.isInteger(source.blockedScopeCount) ? source.blockedScopeCount : blockedRows.length,
    mutatingScopeCount: Number.isInteger(source.mutatingScopeCount) ? source.mutatingScopeCount : mutatingRows.length,
    requiredHandoffEventCount: Number.isInteger(source.requiredHandoffEventCount)
      ? source.requiredHandoffEventCount
      : normalizedRows.reduce((count, row) => count + row.requiredHandoffEvents.length, 0),
    reasonCounts: source.reasonCounts && typeof source.reasonCounts === 'object' ? source.reasonCounts : reasonCounts,
    nextActions,
    resumeWhen: asNonEmptyString(source.resumeWhen) || blockedRows.find((row) => row.resumeWhen)?.resumeWhen || null,
    blockedScopes: blockedRows.map((row) => row.requestedScope),
    rows: normalizedRows
  };
}

function buildMailchimpWorkflowHandoffSummary({ providerContracts, providerNegotiation, externalHandoff, clientWorkflow, validationSummary, claim, scopeMatcherMailchimp, now }) {
  const mailchimpProviders = providerContracts.filter((provider) => provider.mailchimp.detected);
  const mailchimpRoutes = externalHandoff.providers.filter((provider) => (
    mailchimpProviders.some((candidate) => candidate.providerId === provider.providerId)
  ));
  const serviceCommitments = providerNegotiation.serviceCommitments.filter((commitment) => commitment.mailchimp);
  const readyRoutes = mailchimpRoutes.filter((route) => route.ready);
  const blockedRoutes = mailchimpRoutes.filter((route) => !route.ready);
  const unsupportedEvents = Array.from(new Set(mailchimpProviders.flatMap((provider) => provider.mailchimp.rejectedEvents))).sort();
  const audienceIds = Array.from(new Set(mailchimpProviders.flatMap((provider) => provider.mailchimp.audienceIds))).sort();
  const acceptedEvents = Array.from(new Set(mailchimpProviders.flatMap((provider) => provider.mailchimp.acceptedEvents))).sort();
  const providerBlockers = Array.from(new Set([
    ...(scopeMatcherMailchimp.detected && !scopeMatcherMailchimp.canAccept ? ['scope_matcher_mailchimp_readiness_blocked'] : []),
    ...Object.keys(scopeMatcherMailchimp.reasonCounts),
    ...blockedRoutes.flatMap((route) => route.missing),
    ...providerNegotiation.blockingIssues
      .filter((issue) => issue.code.startsWith('mailchimp_') || String(issue.field || '').includes('.mailchimp.'))
      .map((issue) => issue.code),
    ...serviceCommitments.flatMap((commitment) => [
      ...commitment.integrationGaps.capabilities,
      ...commitment.integrationGaps.contract,
      ...commitment.integrationGaps.callbacks
    ].filter((gap) => String(gap).includes('mailchimp') || gap === 'external-handoff'))
  ])).sort();
  const nextActions = Array.from(new Set([
    ...providerBlockers.map((blocker) => {
      if (blocker === 'scope_matcher_mailchimp_readiness_blocked') return 'review-mailchimp-scope-readiness';
      if (blocker.includes('webhook')) return 'complete-mailchimp-webhook-contract';
      if (blocker.includes('secret')) return 'attach-mailchimp-webhook-secret';
      if (blocker.includes('capability')) return 'negotiate-mailchimp-provider-capabilities';
      if (blocker.includes('handoff-target') || blocker === 'handoff-target') return 'configure-mailchimp-handoff-target';
      if (blocker.includes('unsupported')) return 'remove-unsupported-mailchimp-handoff-events';
      if (blocker.includes('sync')) return 'refresh-mailchimp-provider-sync';
      return 'review-mailchimp-provider-contract';
    }),
    ...scopeMatcherMailchimp.nextActions,
    ...(readyRoutes.length ? ['dispatch-mailchimp-blocker-claim-handoff'] : [])
  ])).sort();
  const upstreamBlocked = scopeMatcherMailchimp.detected && !scopeMatcherMailchimp.canAccept;
  const state = mailchimpProviders.length === 0 && !scopeMatcherMailchimp.detected
    ? 'not-required'
    : upstreamBlocked
      ? 'blocked'
      : readyRoutes.length > 0 && blockedRoutes.length === 0 && validationSummary.blocked === 0
      ? 'ready'
      : readyRoutes.length > 0
        ? 'partial'
        : 'blocked';

  return {
    contractVersion: 1,
    generatedAt: now,
    product: 'mailchimp',
    detected: mailchimpProviders.length > 0 || scopeMatcherMailchimp.detected,
    scopeMatcherReadiness: {
      supplied: scopeMatcherMailchimp.supplied,
      detected: scopeMatcherMailchimp.detected,
      state: scopeMatcherMailchimp.state,
      canAccept: scopeMatcherMailchimp.canAccept,
      dataset: scopeMatcherMailchimp.dataset || null,
      rowCount: scopeMatcherMailchimp.rowCount,
      readyScopeCount: scopeMatcherMailchimp.readyScopeCount,
      blockedScopeCount: scopeMatcherMailchimp.blockedScopeCount,
      mutatingScopeCount: scopeMatcherMailchimp.mutatingScopeCount,
      requiredHandoffEventCount: scopeMatcherMailchimp.requiredHandoffEventCount,
      blockedScopes: scopeMatcherMailchimp.blockedScopes,
      reasonCounts: scopeMatcherMailchimp.reasonCounts,
      resumeWhen: scopeMatcherMailchimp.resumeWhen
    },
    state,
    claimRef: {
      claimId: claim.claimId,
      blockerId: claim.blockerId
    },
    providerCount: mailchimpProviders.length,
    readyProviderIds: readyRoutes.map((route) => route.providerId),
    blockedProviderIds: blockedRoutes.map((route) => route.providerId),
    audienceIds,
    acceptedEvents,
    unsupportedEvents,
    providerBlockers,
    nextActions,
    clientRoute: {
      state: clientWorkflow.state,
      route: state === 'ready'
        ? clientWorkflow.routes.handoff
        : clientWorkflow.routes.blocked,
      returnRoute: clientWorkflow.routes.returnRoute,
      resumeWhen: state === 'ready'
        ? 'mailchimp_handoff_dispatched'
        : upstreamBlocked && scopeMatcherMailchimp.resumeWhen
          ? scopeMatcherMailchimp.resumeWhen
        : providerBlockers.includes('mailchimp_webhook_contract_incomplete')
          ? 'mailchimp_webhook_contract_complete'
          : providerBlockers.includes('mailchimp_handoff_target_missing') || providerBlockers.includes('handoff-target')
            ? 'mailchimp_handoff_target_configured'
            : 'mailchimp_provider_contract_ready'
    },
    dispatchBatch: {
      ready: (state === 'ready' || state === 'partial') && !upstreamBlocked,
      batchId: `${surfaceId}:${claim.claimId || 'unassigned-claim'}:mailchimp-handoff`,
      envelopes: readyRoutes
        .map((route) => route.dispatchEnvelope)
        .filter(Boolean)
        .map((envelope) => ({
          providerId: envelope.providerId,
          target: envelope.target,
          payloadVersion: envelope.payloadVersion,
          accountId: envelope.mailchimp?.accountId || null,
          audienceIds: envelope.mailchimp?.audienceIds || [],
          events: envelope.mailchimp?.events || [],
          webhookRoute: envelope.mailchimp?.webhookRoute || null,
          claimRef: envelope.claimRef,
          providerContract: envelope.providerContract
        }))
    },
    routePayload: {
      route: `${surfaceGroup}/${surfaceName}/mailchimp-handoff`,
      method: 'POST',
      requiredFields: ['claimId', 'blockerId', 'providerId', 'accountId', 'audienceIds'],
      disabledReasons: state === 'blocked' ? providerBlockers : []
    }
  };
}

function buildClientWorkflowHandoff({ clientRequest, clientRequestValidation, lifecycleControl, persistedStatus, externalHandoff, reporting, validationSummary, now }) {
  const enabledCommand = lifecycleControl.commands.find((command) => command.enabled && command.command === lifecycleControl.nextAction)
    || lifecycleControl.commands.find((command) => command.enabled);
  const externalRequired = clientRequestValidation.handoffRequired;
  const externalReady = externalHandoff.dispatchable;
  const mutationReady = lifecycleControl.mutationReady && clientRequestValidation.ok;
  const blocked = !clientRequestValidation.ok || persistedStatus.replayRequired || validationSummary.issueCount > 0;
  const routeState = blocked
    ? 'blocked'
    : externalRequired
      ? externalReady
        ? 'handoff-ready'
        : 'handoff-waiting'
      : mutationReady
        ? 'accepted'
        : 'preview-only';
  const nextRoute = routeState === 'accepted'
    ? clientRequest.workflowHandoff.successRoute
    : routeState === 'handoff-ready'
      ? clientRequest.workflowHandoff.handoffRoute
      : routeState === 'blocked'
        ? clientRequest.workflowHandoff.blockedRoute
        : clientRequest.returnRoute;
  const readyHandoffProviders = externalHandoff.providers.filter((provider) => provider.ready);
  const pendingReceiptProviders = readyHandoffProviders.filter((provider) => (
    provider.requiresReceipt && provider.receiptState !== 'accepted'
  ));
  const providerReceiptDeadlines = readyHandoffProviders
    .map((provider) => provider.serviceCommitment?.externalHandoffState?.receiptDeadlineAt)
    .filter(Boolean)
    .sort();
  const receiptRequired = externalReady && pendingReceiptProviders.length > 0;
  const workflowCommitMode = blocked
    ? 'blocked-remediation'
    : externalRequired
      ? externalReady
        ? 'external-dispatch'
        : 'await-provider-route'
      : mutationReady
        ? 'local-acceptance'
        : 'preview-sync';
  const statePatchAction = externalReady && externalRequired
    ? 'dispatch-external-handoff'
    : enabledCommand?.command || 'operator-remediation';
  const handoffReceipt = {
    required: receiptRequired,
    state: !externalReady
      ? 'not-dispatched'
      : receiptRequired
        ? 'awaiting-provider-receipt'
        : 'receipt-satisfied',
    expectedBy: providerReceiptDeadlines[0] || (
      receiptRequired ? addMillisecondsToTimestamp(now, PROVIDER_HANDOFF_ACK_DEADLINE_MS) : null
    ),
    providerIds: readyHandoffProviders.map((provider) => provider.providerId),
    pendingProviderIds: pendingReceiptProviders.map((provider) => provider.providerId),
    acceptedProviderIds: readyHandoffProviders
      .filter((provider) => !provider.requiresReceipt || provider.receiptState === 'accepted')
      .map((provider) => provider.providerId),
    callbackRoutes: readyHandoffProviders.map((provider) => ({
      providerId: provider.providerId,
      acknowledgement: provider.serviceContract.callbackRoutes.acknowledgement || null,
      failure: provider.serviceContract.callbackRoutes.failure || null
    }))
  };
  const transitionCheckpoint = [
    surfaceId,
    clientRequest.requestId || clientRequest.correlationId || clientRequest.sessionId || 'anonymous-client',
    clientRequest.intent,
    routeState,
    lifecycleControl.nextAction,
    persistedStatus.version
  ].join(':');

  return {
    contractVersion: 1,
    route: `${surfaceGroup}/${surfaceName}/client-workflow`,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    sessionId: clientRequest.sessionId,
    channel: clientRequest.channel,
    intent: clientRequest.intent,
    visible: clientRequest.visibleWorkflow,
    state: routeState,
    nextRoute,
    workflowHandoff: clientRequest.workflowHandoff,
    nextCommand: statePatchAction,
    transition: {
      mode: workflowCommitMode,
      fromRoute: clientRequest.returnRoute,
      toRoute: nextRoute,
      checkpoint: transitionCheckpoint,
      idempotencyKey: enabledCommand?.idempotencyKey || transitionCheckpoint,
      recoverable: persistedStatus.restartSafe && !persistedStatus.replayRequired,
      visible: clientRequest.visibleWorkflow,
      requiresClientAck: workflowCommitMode === 'external-dispatch' || workflowCommitMode === 'local-acceptance'
    },
    stateLease: {
      required: clientRequest.stateLease.required,
      ready: clientRequestValidation.stateLeaseReady,
      status: clientRequestValidation.stateLease.status,
      blockers: clientRequestValidation.stateLease.blockers,
      version: clientRequest.stateLease.version,
      holder: clientRequest.stateLease.holder,
      expiresAt: clientRequest.stateLease.expiresAt || null,
      expiresInMs: clientRequestValidation.stateLease.expiresInMs
    },
    userVisibleHandoff: {
      required: externalRequired,
      preference: clientRequest.handoffPreference,
      dispatchable: externalReady,
      providerIds: externalHandoff.dispatchBatch.readyProviderIds,
      blockedProviderIds: externalHandoff.dispatchBatch.blockedProviderIds,
      pendingReasons: externalHandoff.pendingReasons,
      auditProofIncluded: clientRequest.workflowHandoff.includeAuditProof && reporting.exportManifest.ready,
      operatorActionsIncluded: clientRequest.workflowHandoff.includeOperatorActions,
      receipt: handoffReceipt
    },
    clientStatePatch: {
      claimStatus: mutationReady ? 'accepted' : routeState,
      nextAction: statePatchAction,
      idempotencyKey: enabledCommand?.idempotencyKey || null,
      reportId: reporting.reportId,
      replayRequired: persistedStatus.replayRequired,
      restartStatus: persistedStatus.restartStatus,
      recoveryAction: persistedStatus.nextRecoveryCommand,
      stateLeaseStatus: clientRequestValidation.stateLease.status,
      stateLeaseBlockers: clientRequestValidation.stateLease.blockers,
      validationIssueCount: validationSummary.issueCount,
      workflowMode: workflowCommitMode,
      workflowCheckpoint: transitionCheckpoint,
      workflowNextRoute: nextRoute,
      handoffReceiptState: handoffReceipt.state,
      handoffReceiptExpectedBy: handoffReceipt.expectedBy
    },
    errors: clientRequestValidation.errors
  };
}

function buildPersistedStatus({ persistedState, recovery, recoveryPlan, lifecycleControl }) {
  const commands = lifecycleControl.commands.map((command) => command.command);
  const enabledCommands = lifecycleControl.commands.filter((command) => command.enabled).map((command) => command.command);

  return {
    status: persistedState.status,
    version: persistedState.version,
    updatedAt: persistedState.updatedAt,
    restartCount: persistedState.restartCount,
    recoveryEpoch: recovery.recoveryEpoch,
    restartSafe: recovery.restartSafe,
    restartStatus: recoveryPlan.restartStatus,
    replayRequired: recovery.replayRequired,
    terminal: recovery.terminal,
    inflight: recovery.inflight,
    blockers: recovery.blockers,
    dirty: persistedState.dirty,
    recoveredFromJournal: persistedState.recoveredFromJournal,
    journal: {
      durable: persistedState.journal.durable,
      cursor: persistedState.journal.cursor,
      sequence: persistedState.journal.sequence,
      committedThrough: persistedState.journal.committedThrough,
      gap: recovery.journalGap
    },
    lease: {
      holder: persistedState.lease.holder,
      version: persistedState.lease.version,
      expiresAt: persistedState.lease.expiresAt,
      conflict: recovery.leaseConflict,
      staleClientLease: recovery.staleClientLease
    },
    lastCommand: persistedState.lastCommand,
    commands,
    enabledCommands,
    recoveryCommands: recoveryPlan.commands,
    nextRecoveryCommand: recoveryPlan.nextRecoveryCommand,
    nextAction: enabledCommands.includes(lifecycleControl.nextAction) ? lifecycleControl.nextAction : (
      recoveryPlan.nextRecoveryCommand !== 'none'
        ? recoveryPlan.nextRecoveryCommand
        : recovery.terminal
          ? 'report-persisted-state'
          : 'operator-remediation'
    ),
    reason: recovery.reason
  };
}

function buildIdempotentLifecycleControl({ lifecycleControl, claim, persistedState, recovery }) {
  const commands = lifecycleControl.commands.map((command) => buildCommandIdempotency({
    command,
    claim,
    persistedState,
    recovery
  }));
  const nextAction = commands.find((command) => command.enabled)?.command || (
    recovery.replayRequired ? 'recover-persisted-state' : lifecycleControl.nextAction
  );

  return {
    ...lifecycleControl,
    mutationReady: lifecycleControl.mutationReady && !recovery.replayRequired && !recovery.terminal,
    nextAction,
    commands,
    idempotency: {
      persistedVersion: persistedState.version,
      replayedCommands: commands.filter((command) => command.replay).map((command) => command.command),
      blockedByRecovery: recovery.replayRequired,
      blockedByTerminalState: recovery.terminal
    }
  };
}

function summarizeValidationGroups({ validation, settingsValidation, settingsControlValidation, boundaryValidation, providerNegotiation, clientRequestValidation, operationalHealth, recovery, externalHandoff, actionableErrors }) {
  const groups = [
    { key: 'claim', label: 'Claim fields', ok: validation.ok, issueCount: validation.errors.length },
    { key: 'settings', label: 'Lifecycle settings', ok: settingsValidation.ok, issueCount: settingsValidation.errors.length },
    { key: 'settings-control', label: 'Lifecycle control command', ok: settingsControlValidation.ok, issueCount: settingsControlValidation.errors.length },
    { key: 'boundary', label: 'Tenant/workspace boundary', ok: boundaryValidation.ok, issueCount: boundaryValidation.errors.length },
    { key: 'providers', label: 'Provider contracts', ok: providerNegotiation.ready, issueCount: providerNegotiation.blockingIssues.length },
    { key: 'client', label: 'Client request state', ok: clientRequestValidation.ok, issueCount: clientRequestValidation.errors.length },
    { key: 'health', label: 'Hosted-kernel health', ok: operationalHealth.mutationSafe, issueCount: operationalHealth.issues.length },
    { key: 'recovery', label: 'Persisted recovery', ok: recovery.restartSafe && !recovery.replayRequired, issueCount: recovery.blockers.length },
    { key: 'handoff', label: 'External handoff', ok: externalHandoff.state !== 'handoff-blocked', issueCount: externalHandoff.pendingReasons.length }
  ];

  return {
    ok: actionableErrors.length === 0 && groups.every((group) => group.ok),
    issueCount: actionableErrors.length,
    blockingIssueCount: actionableErrors.filter((error) => error.blocking !== false).length,
    groups,
    providerSyncFreshness: providerNegotiation.syncFreshness,
    topIssues: actionableErrors.slice(0, 5).map((error) => ({
      code: error.code,
      field: error.field,
      message: error.message,
      action: error.action
    }))
  };
}

function buildExplainableNextSteps({ lifecycleControl, retryPolicy, persistedStatus, externalHandoff, clientWorkflow, validationSummary, reporting, failure }) {
  const enabledCommand = lifecycleControl.commands.find((command) => command.enabled && command.command === lifecycleControl.nextAction)
    || lifecycleControl.commands.find((command) => command.enabled);
  const firstIssue = validationSummary.topIssues[0];
  const steps = [];

  if (persistedStatus.nextRecoveryCommand && persistedStatus.nextRecoveryCommand !== 'none') {
    steps.push({
      id: persistedStatus.nextRecoveryCommand,
      label: 'Recover persisted state',
      priority: 'critical',
      command: persistedStatus.nextRecoveryCommand,
      enabled: true,
      reason: persistedStatus.reason,
      data: {
        recoveryEpoch: persistedStatus.recoveryEpoch,
        persistedVersion: persistedStatus.version,
        restartStatus: persistedStatus.restartStatus,
        blockers: persistedStatus.blockers
      }
    });
  }

  if (enabledCommand) {
    steps.push({
      id: enabledCommand.command,
      label: enabledCommand.command.replaceAll('-', ' '),
      priority: lifecycleControl.mutationReady ? 'primary' : 'secondary',
      command: enabledCommand.command,
      enabled: true,
      reason: enabledCommand.reason,
      data: { idempotencyKey: enabledCommand.idempotencyKey || null, replay: enabledCommand.replay === true }
    });
  }

  if (externalHandoff.dispatchable) {
    steps.push({
      id: 'dispatch-external-handoff',
      label: 'Dispatch external handoff',
      priority: 'secondary',
      command: 'dispatch-external-handoff',
      enabled: true,
      reason: `${externalHandoff.counts.readyProviders} provider handoff route(s) are ready.`,
      data: externalHandoff.dispatchBatch
    });
  }

  if (clientWorkflow?.visible && clientWorkflow.state === 'handoff-waiting') {
    steps.push({
      id: 'prepare-client-handoff',
      label: 'Prepare workflow handoff',
      priority: 'critical',
      command: 'operator-remediation',
      enabled: false,
      reason: 'Client requested external handoff, but no provider route is currently dispatchable.',
      data: clientWorkflow.userVisibleHandoff
    });
  }

  if (retryPolicy.retryable && !enabledCommand) {
    steps.push({
      id: 'wait-for-retry-window',
      label: 'Wait for retry window',
      priority: 'secondary',
      command: 'retry-claim',
      enabled: false,
      reason: `Retry is blocked until ${retryPolicy.backoff.delayMs}ms backoff is satisfied.`,
      data: retryPolicy.backoff
    });
  }

  if (firstIssue) {
    steps.push({
      id: 'resolve-validation-issue',
      label: 'Resolve validation issue',
      priority: 'critical',
      command: 'operator-remediation',
      enabled: false,
      reason: firstIssue.message || failure.reason,
      data: firstIssue
    });
  }

  if (reporting.exportManifest.ready) {
    steps.push({
      id: 'export-audit-proof',
      label: 'Export audit proof',
      priority: 'secondary',
      command: 'export-audit-proof',
      enabled: true,
      reason: `Audit report ${reporting.reportId} is ready for ${reporting.exportManifest.formats.join(', ')} export.`,
      data: {
        reportId: reporting.reportId,
        formats: reporting.exportManifest.formats,
        recordCount: reporting.exportManifest.recordCount
      }
    });
  }

  return {
    recommendedAction: steps[0]?.command || 'operator-remediation',
    explanation: steps[0]?.reason || failure.reason,
    steps
  };
}

function buildClientPreviewContract({ claim, boundary, audit, health, lifecycleControl, persistedStatus, externalHandoff, clientRequest, clientWorkflow, validationSummary, nextSteps, proof, reporting, mailchimpWorkflowHandoff }) {
  const acceptanceCommand = lifecycleControl.commands.find((command) => command.enabled && command.command === lifecycleControl.nextAction)
    || lifecycleControl.commands.find((command) => command.enabled);
  const readinessChecks = [
    { key: 'claim', label: 'Claim valid', ready: proof.validClaim },
    { key: 'evidence', label: 'Evidence attached', ready: proof.evidenceComplete },
    { key: 'health', label: 'Kernel dependencies ready', ready: proof.operationalHealthReady && health.operational.mutationSafe },
    { key: 'boundary', label: 'Boundary authorized', ready: proof.boundaryComplete },
    { key: 'client-lease', label: 'Client state lease ready', ready: proof.clientStateLeaseReady },
    { key: 'schedule', label: 'Schedule gate open', ready: proof.scheduleReady },
    { key: 'provider', label: 'Provider contract ready', ready: proof.providerContractComplete },
    { key: 'recovery', label: 'Restart recovery ready', ready: persistedStatus.restartSafe && !persistedStatus.replayRequired },
    { key: 'handoff', label: 'Handoff ready or not required', ready: externalHandoff.state !== 'handoff-blocked' }
  ];
  const blockingReadiness = readinessChecks.filter((check) => !check.ready).map((check) => check.key);
  const acceptanceState = lifecycleControl.mutationReady
    ? 'accepted'
    : persistedStatus.replayRequired
      ? 'recovery-required'
      : validationSummary.issueCount > 0
        ? 'needs-remediation'
        : 'held';

  return {
    contractVersion: 1,
    route: `${surfaceGroup}/${surfaceName}/preview`,
    generatedAt: audit.generatedAt || proof.generatedAt,
    preview: {
      title: claim.claimId
        ? `Blocker claim ${claim.claimId}`
        : 'Unassigned blocker claim',
      subtitle: claim.blockerId
        ? `${claim.blockerId} requested by ${claim.owner || 'unassigned owner'}`
        : 'Missing blocker identity',
      state: acceptanceState,
      decision: audit.decision,
      readOnly: !lifecycleControl.mutationReady,
      healthStatus: health.status,
      nextAction: nextSteps.recommendedAction,
      scheduleAction: lifecycleControl.scheduleControl.nextAction,
      route: `${surfaceGroup}/${surfaceName}`,
      clientRoute: clientWorkflow.nextRoute
    },
    acceptance: {
      accepted: lifecycleControl.mutationReady,
      state: acceptanceState,
      command: acceptanceCommand?.command || null,
      idempotencyKey: acceptanceCommand?.idempotencyKey || null,
      reason: nextSteps.explanation,
      actor: audit.actor,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId
    },
    readiness: {
      ready: blockingReadiness.length === 0 && lifecycleControl.mutationReady,
      blocking: blockingReadiness,
      checks: readinessChecks,
      persisted: {
        status: persistedStatus.status,
        restartSafe: persistedStatus.restartSafe,
        replayRequired: persistedStatus.replayRequired
      },
      reportReady: reporting.exportManifest.ready
    },
    request: {
      requestId: clientRequest.requestId,
      correlationId: clientRequest.correlationId,
      channel: clientRequest.channel,
      intent: clientRequest.intent,
      optimisticMutation: clientRequest.optimisticMutation,
      stateLeaseReady: clientWorkflow.stateLease.ready,
      stateLeaseStatus: clientWorkflow.stateLease.status,
      workflowMode: clientWorkflow.transition.mode,
      workflowCheckpoint: clientWorkflow.transition.checkpoint,
      requiresClientAck: clientWorkflow.transition.requiresClientAck,
      handoffReceiptState: clientWorkflow.userVisibleHandoff.receipt.state
    },
    mailchimpWorkflowHandoff: mailchimpWorkflowHandoff.detected
      ? {
          contractVersion: mailchimpWorkflowHandoff.contractVersion,
          state: mailchimpWorkflowHandoff.state,
          scopeMatcherReadiness: mailchimpWorkflowHandoff.scopeMatcherReadiness,
          providerCount: mailchimpWorkflowHandoff.providerCount,
          readyProviderIds: mailchimpWorkflowHandoff.readyProviderIds,
          blockedProviderIds: mailchimpWorkflowHandoff.blockedProviderIds,
          audienceIds: mailchimpWorkflowHandoff.audienceIds,
          acceptedEvents: mailchimpWorkflowHandoff.acceptedEvents,
          unsupportedEvents: mailchimpWorkflowHandoff.unsupportedEvents,
          nextActions: mailchimpWorkflowHandoff.nextActions,
          route: mailchimpWorkflowHandoff.routePayload.route,
          disabledReasons: mailchimpWorkflowHandoff.routePayload.disabledReasons
        }
      : null,
    workflowHandoff: clientWorkflow,
    scheduleControl: lifecycleControl.scheduleControl,
    validationSummary,
    nextSteps
  };
}

function buildRouteResponseContracts({ claim, boundary, clientContract, clientWorkflow, lifecycleControl, settingsControlPlan, providerNegotiation, externalHandoff, validationSummary, nextSteps, reporting, persistedStatus, failureStateContract, mailchimpWorkflowHandoff }) {
  const acceptanceStatus = clientContract.acceptance.accepted
    ? 202
    : persistedStatus.replayRequired
      ? 409
      : validationSummary.issueCount > 0
        ? 422
        : 200;
  const readinessStatus = clientContract.readiness.ready ? 200 : 503;
  const validationStatus = validationSummary.ok ? 200 : 422;
  const nextStepStatus = nextSteps.steps.some((step) => step.enabled) ? 200 : 409;
  const baseRef = {
    claimId: claim.claimId,
    blockerId: claim.blockerId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId
  };
  const clientPatch = {
    ...clientWorkflow.clientStatePatch,
    previewState: clientContract.preview.state,
    acceptanceState: clientContract.acceptance.state,
    readinessReady: clientContract.readiness.ready,
    nextRoute: clientWorkflow.nextRoute
  };
  const routes = [
    {
      key: 'preview',
      route: clientContract.route,
      method: 'GET',
      status: 200,
      cache: 'no-store',
      visible: true,
      ref: baseRef,
      body: {
        preview: clientContract.preview,
        readiness: clientContract.readiness,
        validationSummary,
        nextSteps
      },
      clientPatch
    },
    {
      key: 'mailchimp-handoff',
      route: `${surfaceGroup}/${surfaceName}/mailchimp-handoff`,
      method: 'POST',
      status: !mailchimpWorkflowHandoff.detected
        ? 204
        : mailchimpWorkflowHandoff.state === 'ready' || mailchimpWorkflowHandoff.state === 'partial'
          ? 202
          : 409,
      cache: 'no-store',
      visible: mailchimpWorkflowHandoff.detected,
      ref: baseRef,
      body: mailchimpWorkflowHandoff,
      clientPatch: {
        ...clientPatch,
        mailchimpHandoffState: mailchimpWorkflowHandoff.state,
        mailchimpReadyProviderIds: mailchimpWorkflowHandoff.readyProviderIds,
        mailchimpBlockedProviderIds: mailchimpWorkflowHandoff.blockedProviderIds,
        mailchimpNextActions: mailchimpWorkflowHandoff.nextActions
      }
    },
    {
      key: 'acceptance',
      route: `${surfaceGroup}/${surfaceName}/accepted`,
      method: 'POST',
      status: acceptanceStatus,
      cache: 'no-store',
      visible: clientWorkflow.visible,
      ref: baseRef,
      body: {
        acceptance: clientContract.acceptance,
        command: clientContract.acceptance.command,
        idempotencyKey: clientContract.acceptance.idempotencyKey,
        persistedStatus: clientContract.readiness.persisted
      },
      clientPatch: {
        ...clientPatch,
        claimStatus: clientContract.acceptance.accepted ? 'accepted' : clientWorkflow.clientStatePatch.claimStatus
      }
    },
    {
      key: 'readiness',
      route: `${surfaceGroup}/${surfaceName}/readiness`,
      method: 'GET',
      status: readinessStatus,
      cache: 'no-store',
      visible: true,
      ref: baseRef,
      body: {
        readiness: clientContract.readiness,
        lifecycle: {
          controlsOpen: lifecycleControl.controlsOpen,
          mutationReady: lifecycleControl.mutationReady,
          nextAction: lifecycleControl.nextAction
        },
        providerSyncFreshness: providerNegotiation.syncFreshness,
        providerSyncBlockedProviders: providerNegotiation.syncBlockedProviders,
        providerSyncFreshnessActions: providerNegotiation.syncFreshness.nextActions
      },
      clientPatch: {
        ...clientPatch,
        providerSyncBlockedCount: providerNegotiation.syncBlockedProviders.length,
        providerSyncFreshnessActions: providerNegotiation.syncFreshness.nextActions
      }
    },
    {
      key: 'provider-sync',
      route: `${surfaceGroup}/${surfaceName}/provider-sync`,
      method: 'GET',
      status: providerNegotiation.syncBlockedProviders.length > 0 ? 409 : 200,
      cache: 'no-store',
      visible: providerNegotiation.providerCount > 0,
      ref: baseRef,
      body: {
        ready: providerNegotiation.syncBlockedProviders.length === 0,
        freshness: providerNegotiation.syncFreshness,
        readyProviders: providerNegotiation.syncReadyProviders,
        blockedProviders: providerNegotiation.syncBlockedProviders,
        statuses: providerNegotiation.syncStatuses.map((status) => ({
          providerId: status.providerId,
          ready: status.ready,
          stale: status.stale,
          blockers: status.blockers,
          freshness: status.syncFreshness,
          pendingMutations: status.pendingMutations
        }))
      },
      clientPatch: {
        ...clientPatch,
        providerSyncReady: providerNegotiation.syncBlockedProviders.length === 0,
        providerSyncBlockedProviders: providerNegotiation.syncBlockedProviders,
        providerSyncFreshnessActions: providerNegotiation.syncFreshness.nextActions
      }
    },
    {
      key: 'recovery',
      route: `${surfaceGroup}/${surfaceName}/recovery`,
      method: 'POST',
      status: persistedStatus.restartSafe && !persistedStatus.replayRequired ? 200 : 409,
      cache: 'no-store',
      visible: persistedStatus.nextRecoveryCommand !== 'none' || persistedStatus.blockers.length > 0,
      ref: baseRef,
      body: {
        status: persistedStatus.restartStatus,
        restartSafe: persistedStatus.restartSafe,
        replayRequired: persistedStatus.replayRequired,
        nextRecoveryCommand: persistedStatus.nextRecoveryCommand,
        blockers: persistedStatus.blockers,
        journal: persistedStatus.journal,
        lease: persistedStatus.lease,
        recoveryCommands: persistedStatus.recoveryCommands
      },
      clientPatch: {
        ...clientPatch,
        restartStatus: persistedStatus.restartStatus,
        recoveryAction: persistedStatus.nextRecoveryCommand
      }
    },
    {
      key: 'validation-summary',
      route: `${surfaceGroup}/${surfaceName}/validation-summary`,
      method: 'GET',
      status: validationStatus,
      cache: 'no-store',
      visible: validationSummary.issueCount > 0,
      ref: baseRef,
      body: validationSummary,
      clientPatch: {
        ...clientPatch,
        validationIssueCount: validationSummary.issueCount,
        blockingIssueCount: validationSummary.blockingIssueCount
      }
    },
    {
      key: 'failure-state',
      route: `${surfaceGroup}/${surfaceName}/failure-state`,
      method: 'GET',
      status: failureStateContract.mutationBlocked
        ? failureStateContract.retry.retryable
          ? 429
          : 409
        : 200,
      cache: 'no-store',
      visible: failureStateContract.mutationBlocked || failureStateContract.observations.length > 0,
      ref: baseRef,
      body: {
        state: failureStateContract.state,
        code: failureStateContract.code,
        category: failureStateContract.category,
        reason: failureStateContract.reason,
        mutationBlocked: failureStateContract.mutationBlocked,
        recoveryMode: failureStateContract.recoveryMode,
        degradedMode: failureStateContract.degradedMode,
        retry: failureStateContract.retry,
        operatorActions: failureStateContract.operatorActions,
        auditProof: failureStateContract.auditProof
      },
      clientPatch: {
        ...clientPatch,
        failureState: failureStateContract.state,
        failureCategory: failureStateContract.category,
        failureRecoveryMode: failureStateContract.recoveryMode,
        failureRetryable: failureStateContract.retryable,
        failureNextRetryAt: failureStateContract.retry.nextRetryAt,
        failureMutationBlocked: failureStateContract.mutationBlocked
      }
    },
    {
      key: 'next-steps',
      route: `${surfaceGroup}/${surfaceName}/next-steps`,
      method: 'GET',
      status: nextStepStatus,
      cache: 'no-store',
      visible: true,
      ref: baseRef,
      body: nextSteps,
      clientPatch: {
        ...clientPatch,
        nextAction: nextSteps.recommendedAction
      }
    },
    {
      key: 'settings-control',
      route: `${surfaceGroup}/${surfaceName}/settings-control`,
      method: 'POST',
      status: settingsControlPlan.requested
        ? settingsControlPlan.enabled
          ? settingsControlPlan.dryRun
            ? 200
            : 202
          : 422
        : 204,
      cache: 'no-store',
      visible: settingsControlPlan.requested,
      ref: baseRef,
      body: {
        requested: settingsControlPlan.requested,
        command: settingsControlPlan.command,
        enabled: settingsControlPlan.enabled,
        dryRun: settingsControlPlan.dryRun,
        idempotencyKey: settingsControlPlan.idempotencyKey,
        effectiveAt: settingsControlPlan.effectiveAt,
        statePatch: settingsControlPlan.statePatch,
        resultingState: settingsControlPlan.resultingState,
        scheduleImpact: settingsControlPlan.scheduleImpact,
        auditRecord: settingsControlPlan.auditRecord,
        errors: settingsControlPlan.errors
      },
      clientPatch: {
        ...clientPatch,
        settingsControlCommand: settingsControlPlan.command,
        settingsControlReady: settingsControlPlan.enabled,
        settingsControlDryRun: settingsControlPlan.dryRun,
        settingsControlIdempotencyKey: settingsControlPlan.idempotencyKey
      }
    },
    {
      key: 'provider-contracts',
      route: `${surfaceGroup}/${surfaceName}/provider-contracts`,
      method: 'GET',
      status: providerNegotiation.ready ? 200 : providerNegotiation.providerCount > 0 ? 409 : 204,
      cache: 'no-store',
      visible: providerNegotiation.providerCount > 0,
      ref: baseRef,
      body: {
        mode: providerNegotiation.mode,
        ready: providerNegotiation.ready,
        requiredCapabilities: providerNegotiation.requiredCapabilities,
        optionalCapabilities: providerNegotiation.optionalCapabilities,
        acceptedProviders: providerNegotiation.acceptedProviders,
        committedProviderIds: providerNegotiation.committedProviderIds,
        externalStateProviderIds: providerNegotiation.externalStateProviderIds,
        serviceCommitments: providerNegotiation.serviceCommitments,
        syncReadyProviders: providerNegotiation.syncReadyProviders,
        syncBlockedProviders: providerNegotiation.syncBlockedProviders,
        syncStatuses: providerNegotiation.syncStatuses,
        blockingIssues: providerNegotiation.blockingIssues
      },
      clientPatch: {
        ...clientPatch,
        providerMode: providerNegotiation.mode,
        providerReady: providerNegotiation.ready,
        providerAcceptedCount: providerNegotiation.acceptedProviders.length,
        providerCommittedCount: providerNegotiation.committedProviderIds.length,
        providerExternalStateCount: providerNegotiation.externalStateProviderIds.length,
        providerSyncBlockedCount: providerNegotiation.syncBlockedProviders.length
      }
    },
    {
      key: 'handoff',
      route: clientWorkflow.workflowHandoff?.handoffRoute || `${surfaceGroup}/${surfaceName}/handoff`,
      method: 'POST',
      status: externalHandoff.dispatchable ? 202 : externalHandoff.requested ? 409 : 204,
      cache: 'no-store',
      visible: clientWorkflow.userVisibleHandoff.required || externalHandoff.requested,
      ref: baseRef,
      body: {
        state: externalHandoff.state,
        dispatchable: externalHandoff.dispatchable,
        batch: externalHandoff.dispatchBatch,
        providerCommitments: externalHandoff.providers
          .map((provider) => provider.serviceCommitment)
          .filter(Boolean),
        auditHandoffRecords: externalHandoff.auditHandoffRecords,
        pendingReasons: externalHandoff.pendingReasons
      },
      clientPatch
    },
    {
      key: 'audit-proof',
      route: `${surfaceGroup}/${surfaceName}/audit-proof`,
      method: 'GET',
      status: reporting.exportManifest.ready ? 200 : 409,
      cache: 'private',
      visible: clientWorkflow.workflowHandoff?.includeAuditProof !== false,
      ref: baseRef,
      body: {
        reportId: reporting.reportId,
        exportManifest: reporting.exportManifest,
        alerts: reporting.alerts,
        handoffAuditRecords: externalHandoff.auditHandoffRecords
      },
      clientPatch: {
        ...clientPatch,
        reportId: reporting.reportId
      }
    },
    {
      key: 'analytics-report',
      route: `${surfaceGroup}/${surfaceName}/analytics-report`,
      method: 'GET',
      status: reporting.enabled ? 200 : 204,
      cache: 'private',
      visible: reporting.enabled,
      ref: baseRef,
      body: {
        reportId: reporting.reportId,
        generatedAt: reporting.generatedAt,
        freshness: reporting.freshness,
        exportManifest: reporting.exportManifest,
        counters: reporting.counters,
        operationalHealth: reporting.operationalHealth,
        summaryRows: reporting.summaryRows,
        timelineRows: reporting.timelineRows,
        errorDetails: reporting.errorDetails
      },
      clientPatch: {
        ...clientPatch,
        analyticsReportId: reporting.reportId,
        analyticsExportReady: reporting.exportManifest.ready,
        analyticsRecordCount: reporting.exportManifest.recordCount
      }
    }
  ];

  return {
    contractVersion: 1,
    routePrefix: `${surfaceGroup}/${surfaceName}`,
    selectedRoute: clientWorkflow.nextRoute,
    selectedKey: routes.find((route) => route.route === clientWorkflow.nextRoute)?.key || clientWorkflow.state,
    visibleRoutes: routes.filter((route) => route.visible).map((route) => route.key),
    blockedRoutes: routes
      .filter((route) => route.status >= 400)
      .map((route) => ({ key: route.key, status: route.status })),
    clientPatch,
    routes
  };
}

function buildExportSummary({ claim, boundary, health, failure, failureStateContract, retryPolicy, audit, proof, analytics, reporting, timeline, lifecycleControl, settingsControlPlan, providerNegotiation, externalHandoff, clientWorkflow, mailchimpWorkflowHandoff, persistedStatus, clientContract, routeContracts }) {
  return {
    exportVersion: 1,
    surfaceId,
    route: audit.route,
    claimId: claim.claimId,
    blockerId: claim.blockerId,
    owner: claim.owner,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    principalId: boundary.principal.id,
    decision: audit.decision,
    state: failure.state,
    failureCategory: failureStateContract.category,
    failureRecoveryMode: failureStateContract.recoveryMode,
    failureMutationBlocked: failureStateContract.mutationBlocked,
    failureObservationCount: failureStateContract.observations.length,
    failureDerivedCauseCount: failureStateContract.derivedCauses.length,
    failureAuditProofType: failureStateContract.auditProof.proofType,
    healthStatus: health.status,
    operationalHealthStatus: health.operational.status,
    operationalMutationSafe: health.operational.mutationSafe,
    operationalHealthIssues: health.operational.issues.length,
    nextHealthRetryAfterMs: health.operational.nextRetryAfterMs,
    retryable: retryPolicy.retryable,
    retryAttempt: retryPolicy.attempt,
    proofReady: proof.validClaim && proof.evidenceComplete && proof.dependencyHealthComplete,
    nextAction: lifecycleControl.nextAction,
    scheduleNextAction: lifecycleControl.scheduleControl.nextAction,
    scheduleRunnableNow: lifecycleControl.scheduleControl.runnableNow,
    scheduleHoldReasons: lifecycleControl.scheduleControl.holdReasons,
    mutationReady: lifecycleControl.mutationReady,
    settingsControlRequested: settingsControlPlan.requested,
    settingsControlCommand: settingsControlPlan.command,
    settingsControlReady: settingsControlPlan.enabled,
    settingsControlDryRun: settingsControlPlan.dryRun,
    settingsControlEffectiveAt: settingsControlPlan.effectiveAt,
    settingsControlIdempotencyKey: settingsControlPlan.idempotencyKey,
    settingsControlPatch: settingsControlPlan.statePatch,
    settingsControlScheduleImpact: settingsControlPlan.scheduleImpact,
    persistedStatus: persistedStatus.status,
    restartStatus: persistedStatus.restartStatus,
    restartSafe: persistedStatus.restartSafe,
    replayRequired: persistedStatus.replayRequired,
    recoveryEpoch: persistedStatus.recoveryEpoch,
    nextRecoveryCommand: persistedStatus.nextRecoveryCommand,
    recoveryBlockers: persistedStatus.blockers,
    journalSequence: persistedStatus.journal.sequence,
    journalCommittedThrough: persistedStatus.journal.committedThrough,
    leaseVersion: persistedStatus.lease.version,
    leaseConflict: persistedStatus.lease.conflict,
    providerMode: providerNegotiation.mode,
    providerReady: providerNegotiation.ready,
    providerCommittedCount: providerNegotiation.committedProviderIds.length,
    providerExternalStateCount: providerNegotiation.externalStateProviderIds.length,
    providerServiceCommitmentGaps: providerNegotiation.serviceCommitments.flatMap((commitment) => [
      ...commitment.integrationGaps.capabilities.map((gap) => `${commitment.providerId}:capability:${gap}`),
      ...commitment.integrationGaps.contract.map((gap) => `${commitment.providerId}:contract:${gap}`),
      ...commitment.integrationGaps.callbacks.map((gap) => `${commitment.providerId}:callback:${gap}`)
    ]),
    providerSyncReadyCount: providerNegotiation.syncReadyProviders.length,
    providerSyncBlockedCount: providerNegotiation.syncBlockedProviders.length,
    providerSyncBlockers: providerNegotiation.syncStatuses.flatMap((status) => (
      status.blockers.map((blocker) => `${status.providerId}:${blocker}`)
    )),
    externalHandoffState: externalHandoff.state,
    externalHandoffDispatchable: externalHandoff.dispatchable,
    externalHandoffReadyProviders: externalHandoff.counts.readyProviders,
    externalHandoffBlockedProviders: externalHandoff.counts.blockedProviders,
    externalHandoffBoundaryScopes: externalHandoff.providers.map((provider) => ({
      providerId: provider.providerId,
      tenantId: provider.boundaryScope.targetTenantId,
      workspaceId: provider.boundaryScope.targetWorkspaceId,
      isolationMode: provider.boundaryScope.isolationMode,
      allowed: provider.boundaryScope.ready,
      serviceKey: provider.serviceContract.serviceKey,
      syncReady: provider.syncStatus.ready
    })),
    externalHandoffAuditRecordCount: externalHandoff.auditHandoffRecords.length,
    mailchimpHandoffDetected: mailchimpWorkflowHandoff.detected,
    mailchimpHandoffState: mailchimpWorkflowHandoff.state,
    mailchimpHandoffProviderCount: mailchimpWorkflowHandoff.providerCount,
    mailchimpHandoffReadyProviderCount: mailchimpWorkflowHandoff.readyProviderIds.length,
    mailchimpHandoffBlockedProviderCount: mailchimpWorkflowHandoff.blockedProviderIds.length,
    mailchimpHandoffAudienceCount: mailchimpWorkflowHandoff.audienceIds.length,
    mailchimpHandoffAcceptedEvents: mailchimpWorkflowHandoff.acceptedEvents,
    mailchimpHandoffUnsupportedEvents: mailchimpWorkflowHandoff.unsupportedEvents,
    mailchimpHandoffNextActions: mailchimpWorkflowHandoff.nextActions,
    mailchimpHandoffRoute: mailchimpWorkflowHandoff.routePayload.route,
    mailchimpScopeMatcherSupplied: mailchimpWorkflowHandoff.scopeMatcherReadiness.supplied,
    mailchimpScopeMatcherState: mailchimpWorkflowHandoff.scopeMatcherReadiness.state,
    mailchimpScopeMatcherCanAccept: mailchimpWorkflowHandoff.scopeMatcherReadiness.canAccept,
    mailchimpScopeMatcherDataset: mailchimpWorkflowHandoff.scopeMatcherReadiness.dataset,
    mailchimpScopeMatcherRowCount: mailchimpWorkflowHandoff.scopeMatcherReadiness.rowCount,
    mailchimpScopeMatcherBlockedScopeCount: mailchimpWorkflowHandoff.scopeMatcherReadiness.blockedScopeCount,
    mailchimpScopeMatcherBlockedScopes: mailchimpWorkflowHandoff.scopeMatcherReadiness.blockedScopes,
    mailchimpScopeMatcherResumeWhen: mailchimpWorkflowHandoff.scopeMatcherReadiness.resumeWhen,
    clientIntent: clientWorkflow.intent,
    clientWorkflowState: clientWorkflow.state,
    clientWorkflowMode: clientWorkflow.transition.mode,
    clientWorkflowNextRoute: clientWorkflow.nextRoute,
    clientWorkflowCheckpoint: clientWorkflow.transition.checkpoint,
    clientWorkflowRecoverable: clientWorkflow.transition.recoverable,
    clientWorkflowRequiresAck: clientWorkflow.transition.requiresClientAck,
    clientStateLeaseReady: clientWorkflow.stateLease.ready,
    clientStateLeaseStatus: clientWorkflow.stateLease.status,
    clientStateLeaseExpiresInMs: clientWorkflow.stateLease.expiresInMs,
    clientStateLeaseBlockers: clientWorkflow.stateLease.blockers,
    clientHandoffReceiptState: clientWorkflow.userVisibleHandoff.receipt.state,
    clientHandoffReceiptExpectedBy: clientWorkflow.userVisibleHandoff.receipt.expectedBy,
    clientHandoffReceiptPendingProviders: clientWorkflow.userVisibleHandoff.receipt.pendingProviderIds,
    previewState: clientContract.preview.state,
    previewNextAction: clientContract.preview.nextAction,
    acceptanceState: clientContract.acceptance.state,
    acceptedForMutation: clientContract.acceptance.accepted,
    readinessBlocking: clientContract.readiness.blocking,
    routeContractVersion: routeContracts.contractVersion,
    selectedClientRoute: routeContracts.selectedRoute,
    visibleClientRoutes: routeContracts.visibleRoutes,
    blockedClientRoutes: routeContracts.blockedRoutes,
    validationIssueCount: clientContract.validationSummary.issueCount,
    boundaryMode: proof.boundaryMode,
    boundaryOk: proof.boundaryComplete,
    counters: analytics.counters,
    analyticsDimensions: {
      byState: analytics.byState,
      byDecision: analytics.byDecision,
      byProviderMode: analytics.byProviderMode,
      byHandoffState: analytics.byHandoffState,
      byRestartStatus: analytics.byRestartStatus,
      byClientIntent: analytics.byClientIntent
    },
    analyticsAggregates: analytics.aggregates,
    analyticsTransitionSummary: analytics.transitionSummary,
    reporting: {
      reportId: reporting.reportId,
      label: reporting.label,
      exportReady: reporting.exportManifest.ready,
      formats: reporting.exportManifest.formats,
      recordCount: reporting.exportManifest.recordCount,
      timelineRecordCount: reporting.exportManifest.timelineRecordCount,
      summaryRecordCount: reporting.exportManifest.summaryRecordCount,
      datasets: reporting.exportManifest.datasets,
      alertCount: reporting.counters.alerts,
      stale: reporting.freshness.stale,
      operationalHealthStatus: reporting.operationalHealth.status
    },
    timelineRange: {
      firstAt: timeline[0]?.at || null,
      latestAt: timeline[timeline.length - 1]?.at || null,
      eventCount: timeline.length
    }
  };
}

export function describeBlockerClaimSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = normalizeEvidence(input.evidence);
  const healthChecks = normalizeHealthChecks(input.healthChecks);
  const operationalHealth = buildOperationalHealth({ healthChecks, now });
  const lifecycleSettings = normalizeLifecycleSettings(input);
  const scheduleControl = buildScheduleControl(lifecycleSettings, now);
  const settingsValidation = buildSettingsValidation(lifecycleSettings, evidence, healthChecks, scheduleControl);
  const boundary = normalizeBoundaryContext(input);
  const boundaryValidation = buildBoundaryValidation(boundary);
  const clientRequest = normalizeClientRequest(input, boundary);
  const clientRequestValidation = buildClientRequestValidation(clientRequest, boundary, now);
  const settingsControlRequest = normalizeSettingsControlRequest(input, clientRequest);
  const settingsControlValidation = buildSettingsControlValidation(settingsControlRequest, boundary, lifecycleSettings);
  const providerContracts = normalizeProviderContracts(input);
  const providerNegotiation = buildProviderNegotiation(providerContracts, lifecycleSettings, now);
  const historySnapshots = normalizeHistorySnapshots(input.historySnapshots || input.history);
  const reportingSettings = normalizeReportingSettings(input);
  const validation = buildValidation(input, boundaryValidation);
  const failure = classifyFailure(input, validation, boundaryValidation, operationalHealth);
  const retryPolicy = buildRetryPolicy(input, failure, operationalHealth);
  const failureStateContract = buildFailureStateContract({
    input,
    now,
    validation,
    settingsValidation,
    boundaryValidation,
    providerNegotiation,
    clientRequestValidation,
    failure,
    retryPolicy,
    operationalHealth
  });
  const actionableErrors = buildActionableErrors(validation, settingsValidation, settingsControlValidation, boundaryValidation, providerNegotiation, clientRequestValidation, failure, retryPolicy, operationalHealth);
  const lifecycleControlsOpen = lifecycleSettings.enabled && lifecycleSettings.claimingEnabled && lifecycleSettings.mutationEnabled;
  const claim = {
    claimId: asNonEmptyString(input.claimId),
    blockerId: asNonEmptyString(input.blockerId),
    owner: asNonEmptyString(input.owner),
    reason: asNonEmptyString(input.reason),
    kernelState: asNonEmptyString(input.kernelState) || 'hosted-kernel-startup',
    requestedTransition: asNonEmptyString(input.requestedTransition) || 'claim-blocker',
    tenantId: boundary.claimTenantId,
    workspaceId: boundary.claimWorkspaceId
  };
  const persistedState = normalizePersistedState(input);
  const recovery = buildRestartRecovery({
    persistedState,
    claim,
    clientRequest,
    now
  });
  const recoveryPlan = buildRecoveryPlan({
    persistedState,
    recovery,
    claim,
    clientRequest,
    now
  });
  const settingsControlPlan = buildSettingsControlPlan({
    controlRequest: settingsControlRequest,
    controlValidation: settingsControlValidation,
    settings: lifecycleSettings,
    scheduleControl,
    claim,
    boundary,
    now
  });
  const degraded = failure.state === 'degraded'
    || operationalHealth.status === 'blocked'
    || operationalHealth.status === 'degraded'
    || retryPolicy.exhausted
    || !lifecycleControlsOpen
    || recovery.replayRequired
    || !recovery.restartSafe
    || !boundaryValidation.ok;
  const health = {
    status: !lifecycleControlsOpen
      ? 'paused'
      : operationalHealth.status === 'blocked'
        ? 'unhealthy'
        : degraded
          ? 'degraded'
          : actionableErrors.length === 0
            ? 'healthy'
            : 'unhealthy',
    checks: operationalHealth.checks,
    requiredChecksFailed: operationalHealth.requiredChecksFailed,
    requiredChecksStale: operationalHealth.requiredChecksStale,
    operational: {
      status: operationalHealth.status,
      ready: operationalHealth.ready,
      mutationSafe: operationalHealth.mutationSafe,
      degradedModeAvailable: operationalHealth.degradedModeAvailable,
      highestSeverity: operationalHealth.highestSeverity,
      nextRetryAfterMs: operationalHealth.nextRetryAfterMs,
      counts: operationalHealth.counts,
      issues: operationalHealth.issues
    }
  };
  const audit = {
    route: `${surfaceGroup}/${surfaceName}`,
    actor: boundary.principal.id || claim.owner || 'unassigned',
    decision: !lifecycleControlsOpen
      ? 'hold-claim'
      : actionableErrors.length === 0
        ? 'accept-claim'
        : retryPolicy.retryable
          ? 'retry-with-backoff'
          : 'reject-claim',
    proofCount: evidence.length,
    settingsOk: settingsValidation.ok,
    boundaryOk: boundaryValidation.ok,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    providerOk: providerNegotiation.ready,
    providerMode: providerNegotiation.mode,
    clientRequestId: clientRequest.requestId,
    clientIntent: clientRequest.intent,
    clientChannel: clientRequest.channel
  };
  const proof = {
    generatedAt: now,
    validClaim: validation.ok,
    evidenceComplete: evidence.length > 0,
    dependencyHealthComplete: healthChecks.length > 0,
    settingsComplete: settingsValidation.ok,
    boundaryComplete: boundaryValidation.ok,
    boundaryMode: boundaryValidation.isolationMode,
    principalPermissions: {
      canRead: boundary.permissionChecks.canRead,
      canClaim: boundary.permissionChecks.canClaim,
      canMutate: boundary.permissionChecks.canMutate,
      canHandoff: boundary.permissionChecks.canHandoff,
      canAudit: boundary.permissionChecks.canAudit
    },
    providerContractComplete: providerNegotiation.ready,
    acceptedProviders: providerNegotiation.acceptedProviders,
    committedProviders: providerNegotiation.committedProviderIds,
    externalStateProviders: providerNegotiation.externalStateProviderIds,
    providerServiceCommitments: providerNegotiation.serviceCommitments.map((commitment) => ({
      providerId: commitment.providerId,
      serviceKey: commitment.serviceKey,
      ready: commitment.ready,
      externalStateClaimed: commitment.externalStateClaimed,
      capabilityGaps: commitment.integrationGaps.capabilities,
      contractGaps: commitment.integrationGaps.contract,
      callbackGaps: commitment.integrationGaps.callbacks
    })),
    providerSyncComplete: providerNegotiation.syncBlockedProviders.length === 0,
    providerSyncReadyProviders: providerNegotiation.syncReadyProviders,
    providerSyncBlockedProviders: providerNegotiation.syncBlockedProviders,
    clientRequestComplete: clientRequestValidation.ok,
    clientStateLeaseReady: clientRequestValidation.stateLeaseReady,
    clientHandoffRequired: clientRequestValidation.handoffRequired,
    operationalHealthReady: operationalHealth.ready,
    operationalHealthStatus: operationalHealth.status,
    scheduleReady: lifecycleSettings.mode !== 'scheduled'
      || scheduleControl.runnableNow,
    scheduleOverrideAvailable: lifecycleSettings.mode === 'scheduled'
      && scheduleControl.manualOverrideAllowed
      && !scheduleControl.runnableNow,
    scheduleNextAction: scheduleControl.nextAction,
    canMutateKernelLifecycle: lifecycleControlsOpen
      && validation.ok
      && settingsValidation.ok
      && boundaryValidation.safeToMutate
      && clientRequestValidation.ok
      && operationalHealth.mutationSafe
      && (lifecycleSettings.mode !== 'scheduled' || scheduleControl.runnableNow)
      && actionableErrors.length === 0
      && !degraded
      && recovery.restartSafe
  };
  const baseLifecycleControl = buildLifecycleCommands({
    settings: lifecycleSettings,
    scheduleControl,
    settingsControlPlan,
    failure,
    retryPolicy,
    validation,
    settingsValidation,
    actionableErrors,
    proof
  });
  const lifecycleControl = buildIdempotentLifecycleControl({
    lifecycleControl: baseLifecycleControl,
    claim,
    persistedState,
    recovery
  });
  const persistedStatus = buildPersistedStatus({
    persistedState,
    recovery,
    recoveryPlan,
    lifecycleControl
  });
  const externalHandoff = buildExternalHandoff({
    claim,
    audit,
    providerContracts,
    providerNegotiation,
    lifecycleControl,
    boundary
  });
  const currentSnapshot = buildCurrentSnapshot({
    now,
    claim,
    failure,
    retryPolicy,
    actionableErrors,
    healthChecks,
    evidence,
    audit,
    providerNegotiation,
    externalHandoff,
    persistedStatus,
    lifecycleControl,
    clientRequest
  });
  const timeline = buildTimeline(historySnapshots, currentSnapshot);
  const analytics = buildAnalytics({
    historySnapshots,
    currentSnapshot,
    evidence,
    healthChecks,
    actionableErrors,
    retryPolicy
  });
  const reporting = buildReportingState({
    now,
    settings: reportingSettings,
    timeline,
    analytics,
    actionableErrors,
    providerNegotiation,
    externalHandoff,
    persistedStatus,
    operationalHealth
  });
  const validationSummary = summarizeValidationGroups({
    validation,
    settingsValidation,
    settingsControlValidation,
    boundaryValidation,
    providerNegotiation,
    clientRequestValidation,
    operationalHealth,
    recovery,
    externalHandoff,
    actionableErrors
  });
  const clientWorkflow = buildClientWorkflowHandoff({
    clientRequest,
    clientRequestValidation,
    lifecycleControl,
    persistedStatus,
    externalHandoff,
    reporting,
    validationSummary,
    now
  });
  const scopeMatcherMailchimp = normalizeScopeMatcherMailchimpReadiness(input);
  const mailchimpWorkflowHandoff = buildMailchimpWorkflowHandoffSummary({
    providerContracts,
    providerNegotiation,
    externalHandoff,
    clientWorkflow,
    validationSummary,
    claim,
    scopeMatcherMailchimp,
    now
  });
  const nextSteps = buildExplainableNextSteps({
    lifecycleControl,
    retryPolicy,
    persistedStatus,
    externalHandoff,
    clientWorkflow,
    validationSummary,
    reporting,
    failure
  });
  const clientContract = buildClientPreviewContract({
    claim,
    boundary,
    audit,
    health,
    lifecycleControl,
    persistedStatus,
    externalHandoff,
    clientRequest,
    clientWorkflow,
    validationSummary,
    nextSteps,
    proof,
    reporting,
    mailchimpWorkflowHandoff
  });
  const routeContracts = buildRouteResponseContracts({
    claim,
    boundary,
    clientContract,
    clientWorkflow,
    lifecycleControl,
    settingsControlPlan,
    providerNegotiation,
    externalHandoff,
    validationSummary,
    nextSteps,
    reporting,
    mailchimpWorkflowHandoff,
    persistedStatus,
    failureStateContract
  });

  return {
    ok: lifecycleControl.mutationReady,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel blocker-claim operational health contract',
    claim,
    boundary,
    health,
    validation: {
      ...validation,
      settings: settingsValidation,
      boundary: {
        ok: boundaryValidation.ok,
        isolationMode: boundaryValidation.isolationMode,
        requiredPermissions: boundaryValidation.requiredPermissions,
        errors: boundaryValidation.errors
      },
      provider: {
        ok: providerNegotiation.ready,
        requiredCapabilities: providerNegotiation.requiredCapabilities,
        syncReadyProviders: providerNegotiation.syncReadyProviders,
        syncBlockedProviders: providerNegotiation.syncBlockedProviders,
        committedProviderIds: providerNegotiation.committedProviderIds,
        externalStateProviderIds: providerNegotiation.externalStateProviderIds,
        serviceCommitments: providerNegotiation.serviceCommitments,
        syncStatuses: providerNegotiation.syncStatuses,
        errors: providerNegotiation.blockingIssues
      }
    },
    lifecycleSettings,
    settingsControlRequest,
    settingsControlValidation,
    settingsControlPlan,
    scheduleControl,
    clientRequest,
    clientRequestValidation,
    clientWorkflow,
    scopeMatcherMailchimp,
    mailchimpWorkflowHandoff,
    providerContracts,
    providerNegotiation,
    externalHandoff,
    lifecycleControl,
    preview: clientContract.preview,
    acceptance: clientContract.acceptance,
    readiness: clientContract.readiness,
    validationSummary,
    nextSteps,
    clientContract,
    routeContracts,
    persistedState,
    persistedStatus,
    recoveryPlan,
    recovery,
    failureState: failureStateContract,
    retryPolicy,
    reportingSettings,
    degradedMode: {
      active: degraded,
      readOnly: degraded,
      reason: degraded
        ? recovery.replayRequired
          ? 'Hosted-kernel blocker claims remain observable while persisted journal replay recovers mutation state.'
          : !boundaryValidation.ok
            ? 'Hosted-kernel blocker claims remain read-only until tenant, workspace, and permission boundaries are valid.'
          : 'Hosted-kernel blocker claims remain observable, but mutation should pause until health or retry state recovers.'
        : null
    },
    actionableErrors,
    audit,
    proof,
    history: {
      snapshots: historySnapshots,
      current: currentSnapshot
    },
    timeline,
    analytics,
    reporting,
    exportSummary: buildExportSummary({
      claim,
      boundary,
      health,
      failure,
      failureStateContract,
      retryPolicy,
      audit,
      proof,
      analytics,
      reporting,
      timeline,
      lifecycleControl,
      settingsControlPlan,
      providerNegotiation,
      externalHandoff,
      mailchimpWorkflowHandoff,
      clientWorkflow,
      persistedStatus,
      clientContract,
      routeContracts
    }),
    evidence
  };
}

export default describeBlockerClaimSurface;
