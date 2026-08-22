export const surfaceId = "aios_audit-recovery_append-only-log_072";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "append-only-log";

const REQUIRED_ENTRY_FIELDS = ['id', 'timestamp', 'actor', 'action', 'digest'];
const DEFAULT_ACCEPTANCE_POLICY = {
  minEntries: 1,
  requireMonotonicTimestamps: true,
  requireDigestChain: true,
  allowPreviewWithoutAcceptance: true
};
const WORKFLOW_ROUTES = {
  preview: '/kernel/audit-recovery/append-only-log/preview',
  accept: '/kernel/audit-recovery/append-only-log/accept',
  validate: '/kernel/audit-recovery/append-only-log/validate',
  proof: '/kernel/audit-recovery/append-only-log/proof'
};
const KNOWN_CLIENT_VIEWS = new Set(['preview', 'acceptance', 'proof', 'repair']);
const KNOWN_COMMANDS = new Set(['preview', 'accept', 'recover', 'export-proof']);
const ACCEPTANCE_ROLES = new Set(['owner', 'admin', 'kernel-admin', 'audit-admin', 'recovery-operator']);
const ACCEPTANCE_PERMISSIONS = new Set([
  'audit.append-only.accept',
  'audit.appendOnly.accept',
  'audit.recovery.accept',
  'kernel.audit.accept'
]);
const PROOF_PERMISSIONS = new Set([
  'audit.append-only.export-proof',
  'audit.appendOnly.exportProof',
  'audit.recovery.export-proof',
  'kernel.audit.exportProof'
]);
const PROOF_ROLES = new Set(['owner', 'admin', 'kernel-admin', 'audit-admin', 'auditor', 'recovery-operator']);
const BOUNDARY_AUDIT_PERMISSIONS = new Set([
  'audit.append-only.boundary.read',
  'audit.appendOnly.boundaryRead',
  'audit.recovery.boundary.read',
  'kernel.audit.boundaryRead'
]);
const PROVIDER_CAPABILITIES = {
  preview: 'append-only-log.preview',
  validate: 'append-only-log.validate',
  verifyDigestChain: 'append-only-log.digest-chain.verify',
  persistCheckpoint: 'append-only-log.checkpoint.persist',
  appendEntries: 'append-only-log.entries.append',
  exportProof: 'append-only-log.proof.export',
  signProof: 'append-only-log.proof.sign',
  syncCursor: 'append-only-log.sync.cursor',
  externalHandoff: 'append-only-log.handoff.external'
};
const HOSTED_KERNEL_PROVIDER_CAPABILITIES = Object.values(PROVIDER_CAPABILITIES);
const SYNC_MODES = new Set(['manual', 'batch', 'stream']);
const PROVIDER_HANDOFF_STATES = new Set(['none', 'queued', 'in_progress', 'waiting_external', 'completed', 'failed']);
const PROVIDER_CONSISTENCY_MODES = new Set(['strong', 'bounded-staleness', 'eventual']);
const PROVIDER_DELIVERY_GUARANTEES = new Set(['at-most-once', 'at-least-once', 'exactly-once']);
const PROVIDER_AUTH_MODES = new Set(['hosted-kernel', 'service-token', 'signed-request', 'mtls']);
const PROVIDER_REQUIRED_STRONG_COMMANDS = new Set(['accept', 'export-proof']);
const DEFAULT_CLIENT_CONTINUATION_TTL_MS = 10 * 60 * 1000;
const LIFECYCLE_MODES = new Set(['enabled', 'disabled', 'maintenance']);
const SCHEDULE_CADENCES = new Set(['manual', 'hourly', 'daily', 'weekly']);
const SCHEDULE_CADENCE_INTERVAL_MINUTES = {
  hourly: 60,
  daily: 1440,
  weekly: 10080
};
const LIFECYCLE_COMMANDS = new Set([
  'none',
  'enable',
  'disable',
  'enter-maintenance',
  'exit-maintenance',
  'schedule',
  'pause-schedule',
  'resume-schedule',
  'configure'
]);
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  mode: 'enabled',
  scheduleCadence: 'manual',
  scheduleEnabled: false,
  maxBatchEntries: 500,
  retentionDays: 90
};
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000
};
const OPERATIONAL_FAILURE_PHASES = new Set([
  'read',
  'validate',
  'journal',
  'checkpoint',
  'accepted-snapshot',
  'proof-export',
  'provider-sync',
  'handoff',
  'unknown'
]);
const HOSTED_KERNEL_RUNTIME_FAILURES = {
  storage_unavailable: {
    retryable: true,
    dependency: 'audit-storage',
    action: 'restore_audit_storage_then_retry',
    route: WORKFLOW_ROUTES.validate
  },
  writer_unavailable: {
    retryable: true,
    dependency: 'append-only-writer',
    action: 'resume_writer_or_use_preview_only_degraded_mode',
    route: WORKFLOW_ROUTES.accept
  },
  read_only_storage: {
    retryable: true,
    dependency: 'audit-storage',
    action: 'clear_read_only_storage_state_before_acceptance',
    route: WORKFLOW_ROUTES.accept
  },
  proof_signer_unavailable: {
    retryable: true,
    dependency: 'proof-signer',
    action: 'restore_proof_signer_before_export',
    route: WORKFLOW_ROUTES.proof
  },
  provider_handoff_not_ready: {
    retryable: true,
    dependency: 'external-handoff',
    action: 'wait_for_provider_handoff_acknowledgement',
    route: WORKFLOW_ROUTES.validate
  },
  provider_sync_cursor_stale: {
    retryable: false,
    dependency: 'provider-sync',
    action: 'refresh_provider_sync_cursor_before_acceptance',
    route: WORKFLOW_ROUTES.validate
  },
  command_lease_active: {
    retryable: true,
    dependency: 'command-journal',
    action: 'wait_for_active_writer_or_retry_after_lease',
    route: WORKFLOW_ROUTES.accept
  },
  interrupted_command_resume: {
    retryable: true,
    dependency: 'command-journal',
    action: 'resume_persisted_command_from_recorded_write_phase',
    route: WORKFLOW_ROUTES.accept
  },
  digest_repair_required: {
    retryable: false,
    dependency: 'audit-evidence',
    action: 'repair_evidence_and_resubmit_validation',
    route: WORKFLOW_ROUTES.validate
  }
};
const NON_RETRYABLE_ISSUE_CODES = new Set([
  'acceptance_actor_missing',
  'acceptance_permission_denied',
  'boundary_access_redacted',
  'duplicate_entry_id',
  'invalid_client_resume_route',
  'proof_permission_denied',
  'stale_client_resume_digest',
  'stale_client_resume_entry_count',
  'tenant_boundary_violation',
  'workspace_binding_access_denied',
  'workspace_tenant_boundary_violation',
  'workspace_tenant_binding_missing',
  'workspace_boundary_violation'
]);
const REPAIRABLE_ISSUE_CODES = new Set([
  'missing_required_field',
  'invalid_timestamp',
  'missing_previous_digest',
  'timestamp_regression',
  'digest_chain_mismatch',
  'insufficient_entries',
  'missing_entry_tenant_scope',
  'missing_entry_workspace_scope'
]);
const COMMAND_TERMINAL_STATUSES = new Set(['completed', 'accepted', 'proof_exported', 'failed_final']);
const COMMAND_IN_FLIGHT_STATUSES = new Set(['pending', 'started', 'checkpoint_written', 'snapshot_written']);
const COMMAND_WRITE_PHASES = new Set([
  'journal',
  'checkpoint',
  'accepted-snapshot',
  'proof-export',
  'completed'
]);
const BOUNDARY_COMMAND_PERMISSIONS = {
  accept: ACCEPTANCE_PERMISSIONS,
  exportProof: PROOF_PERMISSIONS,
  readBoundary: BOUNDARY_AUDIT_PERMISSIONS
};
const MAILCHIMP_EVENT_ACTIONS = new Set([
  'mailchimp.campaign.create',
  'mailchimp.campaign.update',
  'mailchimp.campaign.schedule',
  'mailchimp.campaign.send',
  'mailchimp.campaign.pause',
  'mailchimp.campaign.cancel',
  'mailchimp.template.update',
  'mailchimp.list.segment.update',
  'mailchimp.audience.sync'
]);
const MAILCHIMP_DELIVERY_COMMANDS = new Set(['accept', 'export-proof']);
const MAILCHIMP_REQUIRED_AUDIT_FIELDS = ['campaignId', 'audienceId'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringList(value) {
  return asArray(value)
    .map((item) => asTrimmedString(item))
    .filter(Boolean);
}

function normalizeCommandName(value) {
  const text = asTrimmedString(value);
  if (!text) return null;
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) return false;
  }
  return null;
}

function asBoundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isValidTimestamp(value) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function minutesAfter(timestamp, minutes) {
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs) || !Number.isInteger(minutes)) return null;
  return new Date(baseMs + minutes * 60 * 1000).toISOString();
}

function millisecondsAfter(timestamp, milliseconds) {
  const baseMs = Date.parse(timestamp);
  if (!Number.isFinite(baseMs) || !Number.isInteger(milliseconds)) return null;
  return new Date(baseMs + milliseconds).toISOString();
}

function firstTrimmedString(...values) {
  for (const value of values) {
    const stringValue = asTrimmedString(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function normalizeActorId(actor) {
  if (typeof actor === 'string') return asTrimmedString(actor);
  if (actor && typeof actor === 'object') {
    return firstTrimmedString(actor.id, actor.actorId, actor.userId, actor.serviceAccountId);
  }
  return null;
}

function hasAnyPermission(actual, allowed) {
  return actual.some((permission) => allowed.has(permission));
}

function normalizeWorkspaceTenantBindings(value) {
  const source = value && typeof value === 'object' ? value : null;
  if (!source) return [];
  const rows = Array.isArray(source)
    ? source
    : Object.entries(source).map(([workspaceId, tenantId]) => ({ workspaceId, tenantId }));
  const bindingsByWorkspace = new Map();

  rows.forEach((row) => {
    const workspaceId = firstTrimmedString(row.workspaceId, row.workspace, row.projectId);
    const tenantId = firstTrimmedString(row.tenantId, row.tenant, row.orgId, row.organizationId);
    if (workspaceId && tenantId && !bindingsByWorkspace.has(workspaceId)) {
      bindingsByWorkspace.set(workspaceId, { workspaceId, tenantId });
    }
  });

  return Array.from(bindingsByWorkspace.values());
}

function resolveBoundTenantForWorkspace(workspaceTenantBindings, workspaceId) {
  if (!workspaceId) return null;
  const binding = workspaceTenantBindings.find((item) => item.workspaceId === workspaceId);
  return binding ? binding.tenantId : null;
}

function normalizeEntry(entry, index) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    index,
    id: asTrimmedString(source.id),
    timestamp: asTrimmedString(source.timestamp),
    actor: asTrimmedString(source.actor),
    action: asTrimmedString(source.action),
    digest: asTrimmedString(source.digest),
    previousDigest: asTrimmedString(source.previousDigest),
    proof: source.proof && typeof source.proof === 'object' ? source.proof : null,
    route: asTrimmedString(source.route),
    acceptedAt: asTrimmedString(source.acceptedAt),
    tenantId: firstTrimmedString(source.tenantId, source.tenant, source.orgId, source.organizationId),
    workspaceId: firstTrimmedString(source.workspaceId, source.workspace, source.projectId),
    scopeId: firstTrimmedString(source.scopeId, source.boundaryId)
  };
}

function normalizeRequestState(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const session = input.session && typeof input.session === 'object' ? input.session : {};
  const requestedView = asTrimmedString(client.view || request.view || input.view);
  const continuationToken = asTrimmedString(request.continuationToken || client.continuationToken || input.continuationToken);
  const clientRequestId = asTrimmedString(request.id || request.requestId || client.requestId || session.requestId);
  const runtimeId = asTrimmedString(client.runtimeId || request.runtimeId || session.runtimeId);

  return {
    clientRequestId,
    continuationToken,
    runtimeId,
    requestedView: KNOWN_CLIENT_VIEWS.has(requestedView) ? requestedView : null,
    actor: normalizeActorId(request.actor) || normalizeActorId(client.actor) || normalizeActorId(session.actor),
    sourceRoute: asTrimmedString(request.route || client.route || input.route),
    handoffTarget: asTrimmedString(request.handoffTarget || client.handoffTarget),
    clientCapabilities: asArray(client.capabilities || request.capabilities)
      .map((capability) => asTrimmedString(capability))
      .filter(Boolean),
    optimisticAccept: Boolean(request.optimisticAccept || client.optimisticAccept)
  };
}

function normalizeMailchimpCampaignEnvelope(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const product = input.product && typeof input.product === 'object' ? input.product : {};
  const mailchimp = input.mailchimp && typeof input.mailchimp === 'object'
    ? input.mailchimp
    : product.mailchimp && typeof product.mailchimp === 'object'
      ? product.mailchimp
      : request.mailchimp && typeof request.mailchimp === 'object'
        ? request.mailchimp
        : client.mailchimp && typeof client.mailchimp === 'object'
          ? client.mailchimp
          : {};
  const campaign = mailchimp.campaign && typeof mailchimp.campaign === 'object' ? mailchimp.campaign : {};
  const audience = mailchimp.audience && typeof mailchimp.audience === 'object' ? mailchimp.audience : {};
  const template = mailchimp.template && typeof mailchimp.template === 'object' ? mailchimp.template : {};
  const schedule = mailchimp.schedule && typeof mailchimp.schedule === 'object' ? mailchimp.schedule : {};
  const enabled = asBoolean(mailchimp.enabled ?? product.mailchimpEnabled ?? request.mailchimpEnabled);
  const campaignId = firstTrimmedString(campaign.id, campaign.campaignId, mailchimp.campaignId, request.campaignId);
  const audienceId = firstTrimmedString(audience.id, audience.audienceId, audience.listId, mailchimp.audienceId, mailchimp.listId, request.audienceId);
  const templateId = firstTrimmedString(template.id, template.templateId, mailchimp.templateId, request.templateId);
  const scheduledAt = firstTrimmedString(schedule.scheduledAt, schedule.sendAt, mailchimp.scheduledAt, request.scheduledAt);
  const archiveUrl = firstTrimmedString(campaign.archiveUrl, mailchimp.archiveUrl, request.archiveUrl);
  const operation = normalizeCommandName(
    mailchimp.operation
    || campaign.operation
    || request.mailchimpOperation
    || product.operation
  );
  const evidenceRefs = normalizeStringList([
    ...(Array.isArray(mailchimp.evidenceRefs) ? mailchimp.evidenceRefs : []),
    campaignId ? `mailchimp:campaign:${campaignId}` : null,
    audienceId ? `mailchimp:audience:${audienceId}` : null,
    templateId ? `mailchimp:template:${templateId}` : null,
    archiveUrl
  ]);
  const present = enabled === true
    || Boolean(campaignId || audienceId || templateId || scheduledAt || operation || archiveUrl || evidenceRefs.length);

  return {
    type: 'AppendOnlyAuditRecoveryMailchimpCampaignEnvelope.v1',
    present,
    enabled: enabled !== false,
    campaignId,
    audienceId,
    templateId,
    scheduledAt,
    archiveUrl,
    operation,
    evidenceRefs,
    requiredFields: MAILCHIMP_REQUIRED_AUDIT_FIELDS,
    proofScope: campaignId && audienceId
      ? `mailchimp:${audienceId}:${campaignId}`
      : null,
    routeHint: present ? '/kernel/audit-recovery/mailchimp/campaign-audit' : null
  };
}

function normalizeClientResumeEnvelope(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const resume = request.resume && typeof request.resume === 'object'
    ? request.resume
    : client.resume && typeof client.resume === 'object'
      ? client.resume
      : input.resume && typeof input.resume === 'object'
        ? input.resume
        : {};
  const expectedRoute = firstTrimmedString(resume.route, resume.expectedRoute, request.resumeRoute, client.resumeRoute);
  const expectedEntryCount = Number.isInteger(resume.entryCount)
    ? resume.entryCount
    : Number.isInteger(resume.expectedEntryCount)
      ? resume.expectedEntryCount
      : null;

  return {
    type: 'AppendOnlyAuditRecoveryClientResumeEnvelope.v1',
    token: firstTrimmedString(
      resume.token,
      resume.continuationToken,
      request.continuationToken,
      client.continuationToken,
      input.continuationToken
    ),
    expectedLatestDigest: firstTrimmedString(
      resume.latestDigest,
      resume.expectedLatestDigest,
      resume.digest,
      request.expectedLatestDigest,
      client.expectedLatestDigest
    ),
    expectedEntryCount,
    expectedRoute,
    requestedAt: firstTrimmedString(resume.requestedAt, resume.createdAt, request.requestedAt),
    issuedByRuntimeId: firstTrimmedString(resume.runtimeId, resume.issuedByRuntimeId, client.runtimeId, request.runtimeId),
    clientRequestId: firstTrimmedString(resume.clientRequestId, request.requestId, client.requestId, request.id),
    nonce: firstTrimmedString(resume.nonce, resume.resumeNonce),
    expiresAt: firstTrimmedString(resume.expiresAt, resume.expiration, request.continuationExpiresAt, client.continuationExpiresAt),
    expectedRuntimeId: firstTrimmedString(resume.expectedRuntimeId, resume.runtimeId, client.runtimeId, request.runtimeId),
    expectedClientRequestId: firstTrimmedString(resume.expectedClientRequestId, resume.clientRequestId, request.requestId, client.requestId),
    expectedWorkflowState: firstTrimmedString(resume.workflowState, resume.expectedWorkflowState),
    expectedFingerprint: firstTrimmedString(resume.fingerprint, resume.expectedFingerprint, resume.continuationFingerprint)
  };
}

function buildClientContinuationFingerprint({
  latestDigest,
  entryCount,
  route,
  workflowState,
  runtimeId,
  clientRequestId,
  storageKey
}) {
  return [
    surfaceId,
    latestDigest || 'pending',
    Number.isInteger(entryCount) ? entryCount : 'unknown-count',
    route || 'unrouted',
    workflowState || 'unknown-state',
    runtimeId || 'unbound-runtime',
    clientRequestId || 'unbound-request',
    storageKey || 'unpersisted'
  ].join('|');
}

function buildClientContinuationCheckpoint({
  latestEntry,
  persistedStateShape,
  requestState,
  validation,
  workflowHandoff,
  now
}) {
  const issuedAtMs = Date.parse(now);
  const expiresAt = Number.isFinite(issuedAtMs)
    ? new Date(issuedAtMs + DEFAULT_CLIENT_CONTINUATION_TTL_MS).toISOString()
    : null;
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const route = workflowHandoff.route;
  const workflowState = workflowHandoff.state;
  const fingerprint = buildClientContinuationFingerprint({
    latestDigest,
    entryCount: validation.entries.length,
    route,
    workflowState,
    runtimeId: requestState.runtimeId,
    clientRequestId: requestState.clientRequestId,
    storageKey: persistedStateShape.storageKey
  });

  return {
    type: 'AppendOnlyAuditRecoveryClientContinuationCheckpoint.v1',
    issuedAt: now,
    expiresAt,
    ttlMs: DEFAULT_CLIENT_CONTINUATION_TTL_MS,
    fingerprint,
    state: {
      latestDigest,
      entryCount: validation.entries.length,
      route,
      workflowState,
      runtimeId: requestState.runtimeId,
      clientRequestId: requestState.clientRequestId,
      storageKey: persistedStateShape.storageKey
    },
    expiresOn: ['digest-change', 'entry-count-change', 'route-change', 'workflow-state-change', 'runtime-change', 'state-storage-key-change']
  };
}

function validateClientResumeEnvelope(validation, resumeEnvelope, continuationCheckpoint = null, now = null) {
  if (!resumeEnvelope.token && !resumeEnvelope.expectedLatestDigest && resumeEnvelope.expectedEntryCount === null && !resumeEnvelope.expectedRoute) {
    return validation;
  }

  const issues = [...validation.issues];
  const latestEntry = validation.entries[validation.entries.length - 1] || null;
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const knownRoutes = new Set(Object.values(WORKFLOW_ROUTES));
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'client.resume', ...issue });

  if (resumeEnvelope.expectedRoute && !knownRoutes.has(resumeEnvelope.expectedRoute)) {
    addIssue({
      code: 'invalid_client_resume_route',
      severity: 'error',
      actual: resumeEnvelope.expectedRoute,
      expected: Array.from(knownRoutes),
      message: 'Client resume route is not a hosted-kernel append-only workflow route.'
    });
  }
  if (resumeEnvelope.expectedLatestDigest && latestDigest && resumeEnvelope.expectedLatestDigest !== latestDigest) {
    addIssue({
      code: 'stale_client_resume_digest',
      severity: 'error',
      expected: latestDigest,
      actual: resumeEnvelope.expectedLatestDigest,
      message: 'Client resume token was issued for a different append-only digest.'
    });
  }
  if (resumeEnvelope.expectedEntryCount !== null && resumeEnvelope.expectedEntryCount !== validation.entries.length) {
    addIssue({
      code: 'stale_client_resume_entry_count',
      severity: 'error',
      expected: validation.entries.length,
      actual: resumeEnvelope.expectedEntryCount,
      message: 'Client resume token was issued for a different append-only entry count.'
    });
  }
  if (resumeEnvelope.expiresAt) {
    const expiresAtMs = Date.parse(resumeEnvelope.expiresAt);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(expiresAtMs)) {
      addIssue({
        code: 'invalid_client_resume_expiry',
        severity: 'error',
        actual: resumeEnvelope.expiresAt,
        message: 'Client resume expiry must be an ISO timestamp.'
      });
    } else if (Number.isFinite(nowMs) && expiresAtMs <= nowMs) {
      addIssue({
        code: 'expired_client_resume_token',
        severity: 'error',
        actual: resumeEnvelope.expiresAt,
        message: 'Client resume token expired before this append-only recovery request.'
      });
    }
  }
  if (continuationCheckpoint) {
    if (resumeEnvelope.expectedWorkflowState && resumeEnvelope.expectedWorkflowState !== continuationCheckpoint.state.workflowState) {
      addIssue({
        code: 'stale_client_resume_workflow_state',
        severity: 'error',
        expected: continuationCheckpoint.state.workflowState,
        actual: resumeEnvelope.expectedWorkflowState,
        message: 'Client resume token was issued for a different workflow state.'
      });
    }
    if (resumeEnvelope.expectedRuntimeId && continuationCheckpoint.state.runtimeId
      && resumeEnvelope.expectedRuntimeId !== continuationCheckpoint.state.runtimeId) {
      addIssue({
        code: 'stale_client_resume_runtime',
        severity: 'error',
        expected: continuationCheckpoint.state.runtimeId,
        actual: resumeEnvelope.expectedRuntimeId,
        message: 'Client resume token was issued for a different runtime.'
      });
    }
    if (resumeEnvelope.expectedClientRequestId && continuationCheckpoint.state.clientRequestId
      && resumeEnvelope.expectedClientRequestId !== continuationCheckpoint.state.clientRequestId) {
      addIssue({
        code: 'stale_client_resume_request',
        severity: 'error',
        expected: continuationCheckpoint.state.clientRequestId,
        actual: resumeEnvelope.expectedClientRequestId,
        message: 'Client resume token was issued for a different client request.'
      });
    }
    if (resumeEnvelope.expectedFingerprint && resumeEnvelope.expectedFingerprint !== continuationCheckpoint.fingerprint) {
      addIssue({
        code: 'stale_client_resume_fingerprint',
        severity: 'error',
        expected: continuationCheckpoint.fingerprint,
        actual: resumeEnvelope.expectedFingerprint,
        message: 'Client resume fingerprint no longer matches the hosted-kernel continuation checkpoint.'
      });
    }
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function normalizeProviderContract(input) {
  const integration = input.integration && typeof input.integration === 'object' ? input.integration : {};
  const provider = input.provider && typeof input.provider === 'object'
    ? input.provider
    : integration.provider && typeof integration.provider === 'object'
      ? integration.provider
      : {};
  const sync = provider.sync && typeof provider.sync === 'object'
    ? provider.sync
    : integration.sync && typeof integration.sync === 'object'
      ? integration.sync
      : input.sync && typeof input.sync === 'object'
        ? input.sync
        : {};
  const handoff = provider.handoff && typeof provider.handoff === 'object'
    ? provider.handoff
    : integration.handoff && typeof integration.handoff === 'object'
      ? integration.handoff
      : input.handoff && typeof input.handoff === 'object'
        ? input.handoff
        : {};
  const declaredCapabilities = normalizeStringList(
    provider.capabilities || integration.capabilities || input.providerCapabilities
  );
  const syncModeInput = asTrimmedString(sync.mode || sync.syncMode);
  const handoffStateInput = asTrimmedString(handoff.state || handoff.status);
  const serviceLevel = provider.serviceLevel && typeof provider.serviceLevel === 'object'
    ? provider.serviceLevel
    : provider.contract && typeof provider.contract === 'object'
      ? provider.contract
      : integration.serviceLevel && typeof integration.serviceLevel === 'object'
        ? integration.serviceLevel
        : integration.contract && typeof integration.contract === 'object'
          ? integration.contract
          : {};
  const requestedConsistency = asTrimmedString(
    serviceLevel.consistency || serviceLevel.consistencyMode || sync.consistency
  );
  const requestedDelivery = asTrimmedString(
    serviceLevel.deliveryGuarantee || serviceLevel.delivery || sync.deliveryGuarantee
  );
  const requestedAuthMode = asTrimmedString(
    serviceLevel.authMode || serviceLevel.authentication || provider.authMode || integration.authMode
  );
  const providerPresent = Boolean(
    provider.id
    || provider.providerId
    || provider.service
    || integration.providerId
    || declaredCapabilities.length > 0
  );

  return {
    type: 'AppendOnlyAuditRecoveryProviderContract.v1',
    present: providerPresent,
    providerId: firstTrimmedString(provider.id, provider.providerId, integration.providerId) || 'hosted-kernel',
    service: firstTrimmedString(provider.service, provider.name, integration.service) || 'hosted-kernel-audit-recovery',
    apiVersion: firstTrimmedString(provider.apiVersion, provider.version, integration.apiVersion) || 'v1',
    endpointRoute: firstTrimmedString(provider.endpointRoute, provider.route, integration.endpointRoute),
    offeredCapabilities: providerPresent
      ? Array.from(new Set(declaredCapabilities))
      : HOSTED_KERNEL_PROVIDER_CAPABILITIES,
    sync: {
      mode: SYNC_MODES.has(syncModeInput) ? syncModeInput : 'manual',
      requestedMode: syncModeInput,
      cursor: firstTrimmedString(sync.cursor, sync.replayCursor, sync.afterDigest),
      highWatermark: firstTrimmedString(sync.highWatermark, sync.highWatermarkDigest),
      lastSyncedDigest: firstTrimmedString(sync.lastSyncedDigest, sync.digest),
      lastSyncedAt: firstTrimmedString(sync.lastSyncedAt, sync.syncedAt),
      externalBatchId: firstTrimmedString(sync.externalBatchId, sync.batchId),
      supportsIncremental: asBoolean(sync.supportsIncremental) !== false
    },
    externalHandoff: {
      state: PROVIDER_HANDOFF_STATES.has(handoffStateInput) ? handoffStateInput : 'none',
      requestedState: handoffStateInput,
      target: firstTrimmedString(handoff.target, handoff.system, handoff.queue, integration.handoffTarget),
      correlationId: firstTrimmedString(handoff.correlationId, handoff.externalId, integration.correlationId),
      callbackRoute: firstTrimmedString(handoff.callbackRoute, handoff.callbackUrl),
      acknowledgedAt: firstTrimmedString(handoff.acknowledgedAt, handoff.completedAt)
    },
    serviceLevel: {
      contract: 'AppendOnlyAuditRecoveryProviderServiceLevel.v1',
      requestedConsistency,
      consistency: PROVIDER_CONSISTENCY_MODES.has(requestedConsistency) ? requestedConsistency : 'strong',
      requestedDeliveryGuarantee: requestedDelivery,
      deliveryGuarantee: PROVIDER_DELIVERY_GUARANTEES.has(requestedDelivery) ? requestedDelivery : 'exactly-once',
      requestedAuthMode,
      authMode: PROVIDER_AUTH_MODES.has(requestedAuthMode) ? requestedAuthMode : 'hosted-kernel',
      maxBatchEntries: asBoundedInteger(
        serviceLevel.maxBatchEntries ?? sync.maxBatchEntries,
        DEFAULT_LIFECYCLE_SETTINGS.maxBatchEntries,
        1,
        5000
      ),
      ackDeadlineMs: asBoundedInteger(serviceLevel.ackDeadlineMs ?? handoff.ackDeadlineMs, 30000, 1000, 300000),
      leaseTtlMs: asBoundedInteger(serviceLevel.leaseTtlMs ?? serviceLevel.leaseTimeoutMs, 120000, 5000, 900000),
      replayWindowMinutes: asBoundedInteger(
        serviceLevel.replayWindowMinutes ?? sync.replayWindowMinutes,
        SCHEDULE_CADENCE_INTERVAL_MINUTES.hourly,
        1,
        SCHEDULE_CADENCE_INTERVAL_MINUTES.weekly
      ),
      requiresSignedHandoff: asBoolean(
        serviceLevel.requiresSignedHandoff ?? handoff.requiresSignature ?? handoff.requiresSignedHandoff
      ) === true,
      externalStateKey: firstTrimmedString(
        serviceLevel.externalStateKey,
        serviceLevel.stateKey,
        handoff.stateKey,
        sync.externalStateKey
      )
    }
  };
}

function requiredProviderCapabilities(command, accepted) {
  if (command === 'export-proof' || accepted) {
    return [
      PROVIDER_CAPABILITIES.verifyDigestChain,
      PROVIDER_CAPABILITIES.exportProof,
      PROVIDER_CAPABILITIES.signProof
    ];
  }
  if (command === 'accept') {
    return [
      PROVIDER_CAPABILITIES.validate,
      PROVIDER_CAPABILITIES.verifyDigestChain,
      PROVIDER_CAPABILITIES.persistCheckpoint,
      PROVIDER_CAPABILITIES.appendEntries
    ];
  }
  if (command === 'recover') {
    return [PROVIDER_CAPABILITIES.validate, PROVIDER_CAPABILITIES.syncCursor];
  }
  return [PROVIDER_CAPABILITIES.preview, PROVIDER_CAPABILITIES.validate];
}

function buildProviderNegotiation({
  commandSemantics,
  latestEntry,
  now,
  providerContract,
  requestState,
  validation
}) {
  const offered = new Set(providerContract.offeredCapabilities);
  const clientRequested = new Set(requestState.clientCapabilities);
  const required = requiredProviderCapabilities(commandSemantics.command, commandSemantics.command === 'export-proof');
  const missingRequired = required.filter((capability) => !offered.has(capability));
  const unsupportedClientCapabilities = Array.from(clientRequested)
    .filter((capability) => !offered.has(capability) && !HOSTED_KERNEL_PROVIDER_CAPABILITIES.includes(capability));
  const syncDigestMatches = !providerContract.sync.lastSyncedDigest
    || !latestEntry
    || providerContract.sync.lastSyncedDigest === latestEntry.digest;
  const strongConsistencyRequired = PROVIDER_REQUIRED_STRONG_COMMANDS.has(commandSemantics.command);
  const consistencySatisfied = !strongConsistencyRequired
    || providerContract.serviceLevel.consistency === 'strong'
    || (providerContract.serviceLevel.consistency === 'bounded-staleness' && syncDigestMatches);
  const deliverySatisfied = commandSemantics.command !== 'accept'
    || providerContract.serviceLevel.deliveryGuarantee !== 'at-most-once';
  const handoffRequired = Boolean(providerContract.externalHandoff.target)
    || clientRequested.has(PROVIDER_CAPABILITIES.externalHandoff);
  const handoffReady = !handoffRequired
    || ['queued', 'in_progress', 'waiting_external', 'completed'].includes(providerContract.externalHandoff.state);
  const signedHandoffSatisfied = !providerContract.serviceLevel.requiresSignedHandoff
    || offered.has(PROVIDER_CAPABILITIES.signProof)
    || providerContract.serviceLevel.authMode === 'signed-request'
    || providerContract.serviceLevel.authMode === 'mtls';
  const externalStateKey = providerContract.serviceLevel.externalStateKey
    || providerContract.sync.externalBatchId
    || providerContract.externalHandoff.correlationId
    || commandSemantics.idempotencyKey;
  const status = validation.errorCount > 0
    ? 'blocked_by_validation'
    : missingRequired.length > 0
      ? 'missing_provider_capability'
      : !syncDigestMatches
        ? 'sync_cursor_stale'
        : !handoffReady
          ? 'handoff_not_acknowledged'
          : !consistencySatisfied || !deliverySatisfied || !signedHandoffSatisfied
            ? 'service_contract_incompatible'
            : 'negotiated';

  return {
    type: 'AppendOnlyAuditRecoveryProviderNegotiation.v1',
    status,
    provider: providerContract,
    requiredCapabilities: required,
    optionalCapabilities: [
      PROVIDER_CAPABILITIES.syncCursor,
      PROVIDER_CAPABILITIES.externalHandoff
    ],
    acceptedCapabilities: required.filter((capability) => offered.has(capability)),
    missingRequiredCapabilities: missingRequired,
    unsupportedClientCapabilities,
    syncMetadata: {
      contract: 'AppendOnlyAuditRecoverySyncMetadata.v1',
      mode: providerContract.sync.mode,
      cursor: providerContract.sync.cursor,
      highWatermark: providerContract.sync.highWatermark || (latestEntry ? latestEntry.digest : null),
      latestDigest: latestEntry ? latestEntry.digest : null,
      lastSyncedDigest: providerContract.sync.lastSyncedDigest,
      syncDigestMatches,
      supportsIncremental: providerContract.sync.supportsIncremental,
      externalBatchId: providerContract.sync.externalBatchId
    },
    serviceContract: {
      contract: 'AppendOnlyAuditRecoveryProviderServiceNegotiation.v1',
      providerId: providerContract.providerId,
      service: providerContract.service,
      apiVersion: providerContract.apiVersion,
      endpointRoute: providerContract.endpointRoute,
      authMode: providerContract.serviceLevel.authMode,
      consistency: providerContract.serviceLevel.consistency,
      deliveryGuarantee: providerContract.serviceLevel.deliveryGuarantee,
      maxBatchEntries: providerContract.serviceLevel.maxBatchEntries,
      ackDeadlineMs: providerContract.serviceLevel.ackDeadlineMs,
      leaseTtlMs: providerContract.serviceLevel.leaseTtlMs,
      replayWindowMinutes: providerContract.serviceLevel.replayWindowMinutes,
      strongConsistencyRequired,
      consistencySatisfied,
      deliverySatisfied,
      signedHandoffRequired: providerContract.serviceLevel.requiresSignedHandoff,
      signedHandoffSatisfied,
      externalStateKey,
      idempotencyScope: [
        surfaceId,
        providerContract.providerId,
        commandSemantics.command,
        latestEntry ? latestEntry.digest : 'pending'
      ].join(':')
    },
    externalHandoffState: {
      contract: 'AppendOnlyAuditRecoveryExternalHandoffState.v1',
      required: handoffRequired,
      ready: handoffReady,
      target: providerContract.externalHandoff.target,
      state: providerContract.externalHandoff.state,
      correlationId: providerContract.externalHandoff.correlationId
        || commandSemantics.idempotencyKey,
      externalStateKey,
      ackDeadlineAt: handoffRequired
        ? millisecondsAfter(now, providerContract.serviceLevel.ackDeadlineMs)
        : null,
      leaseExpiresAt: handoffRequired
        ? millisecondsAfter(now, providerContract.serviceLevel.leaseTtlMs)
        : null,
      callbackRoute: providerContract.externalHandoff.callbackRoute,
      acknowledgedAt: providerContract.externalHandoff.acknowledgedAt,
      resumeRoute: status === 'negotiated' ? WORKFLOW_ROUTES.accept : WORKFLOW_ROUTES.validate
    },
    negotiatedAt: now
  };
}

function validateProviderNegotiation(validation, providerNegotiation, acceptanceRequested) {
  const issues = [...validation.issues];
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'provider', ...issue });

  if (providerNegotiation.provider.sync.requestedMode && !SYNC_MODES.has(providerNegotiation.provider.sync.requestedMode)) {
    addIssue({
      code: 'invalid_provider_sync_mode',
      severity: 'error',
      actual: providerNegotiation.provider.sync.requestedMode,
      expected: Array.from(SYNC_MODES),
      message: 'Append-only audit provider sync mode is not supported.'
    });
  }
  if (providerNegotiation.provider.externalHandoff.requestedState
    && !PROVIDER_HANDOFF_STATES.has(providerNegotiation.provider.externalHandoff.requestedState)) {
    addIssue({
      code: 'invalid_provider_handoff_state',
      severity: 'error',
      actual: providerNegotiation.provider.externalHandoff.requestedState,
      expected: Array.from(PROVIDER_HANDOFF_STATES),
      message: 'Append-only audit provider handoff state is not supported.'
    });
  }
  if (providerNegotiation.provider.serviceLevel.requestedConsistency
    && !PROVIDER_CONSISTENCY_MODES.has(providerNegotiation.provider.serviceLevel.requestedConsistency)) {
    addIssue({
      code: 'invalid_provider_consistency_mode',
      severity: 'error',
      actual: providerNegotiation.provider.serviceLevel.requestedConsistency,
      expected: Array.from(PROVIDER_CONSISTENCY_MODES),
      message: 'Append-only audit provider consistency mode is not supported.'
    });
  }
  if (providerNegotiation.provider.serviceLevel.requestedDeliveryGuarantee
    && !PROVIDER_DELIVERY_GUARANTEES.has(providerNegotiation.provider.serviceLevel.requestedDeliveryGuarantee)) {
    addIssue({
      code: 'invalid_provider_delivery_guarantee',
      severity: 'error',
      actual: providerNegotiation.provider.serviceLevel.requestedDeliveryGuarantee,
      expected: Array.from(PROVIDER_DELIVERY_GUARANTEES),
      message: 'Append-only audit provider delivery guarantee is not supported.'
    });
  }
  if (providerNegotiation.provider.serviceLevel.requestedAuthMode
    && !PROVIDER_AUTH_MODES.has(providerNegotiation.provider.serviceLevel.requestedAuthMode)) {
    addIssue({
      code: 'invalid_provider_auth_mode',
      severity: 'error',
      actual: providerNegotiation.provider.serviceLevel.requestedAuthMode,
      expected: Array.from(PROVIDER_AUTH_MODES),
      message: 'Append-only audit provider auth mode is not supported.'
    });
  }
  if (acceptanceRequested && !providerNegotiation.serviceContract.consistencySatisfied) {
    addIssue({
      code: 'provider_consistency_too_weak',
      severity: 'error',
      expected: 'strong consistency or bounded-staleness with matching sync digest',
      actual: providerNegotiation.serviceContract.consistency,
      message: 'Provider service contract cannot accept append-only recovery without a strong digest read.'
    });
  }
  if (acceptanceRequested && !providerNegotiation.serviceContract.deliverySatisfied) {
    addIssue({
      code: 'provider_delivery_too_weak',
      severity: 'error',
      expected: 'at-least-once or exactly-once',
      actual: providerNegotiation.serviceContract.deliveryGuarantee,
      message: 'Provider service contract cannot accept append-only recovery with at-most-once delivery.'
    });
  }
  if (acceptanceRequested && !providerNegotiation.serviceContract.signedHandoffSatisfied) {
    addIssue({
      code: 'provider_signed_handoff_unavailable',
      severity: 'error',
      expected: [PROVIDER_CAPABILITIES.signProof, 'signed-request', 'mtls'],
      actual: providerNegotiation.serviceContract.authMode,
      message: 'Provider requires signed handoff but no signing capability or signed transport is negotiated.'
    });
  }
  if (acceptanceRequested && providerNegotiation.missingRequiredCapabilities.length > 0) {
    addIssue({
      code: 'provider_capability_missing',
      severity: 'error',
      expected: providerNegotiation.requiredCapabilities,
      actual: providerNegotiation.provider.offeredCapabilities,
      message: 'Provider cannot accept append-only audit recovery without required capabilities.'
    });
  }
  if (acceptanceRequested && !providerNegotiation.syncMetadata.syncDigestMatches) {
    addIssue({
      code: 'provider_sync_cursor_stale',
      severity: 'error',
      expected: providerNegotiation.syncMetadata.latestDigest,
      actual: providerNegotiation.syncMetadata.lastSyncedDigest,
      message: 'Provider sync metadata does not match the latest append-only digest.'
    });
  }
  if (acceptanceRequested && providerNegotiation.externalHandoffState.required && !providerNegotiation.externalHandoffState.ready) {
    addIssue({
      code: 'provider_handoff_not_ready',
      severity: 'error',
      actual: providerNegotiation.externalHandoffState.state,
      message: 'External provider handoff must be queued, active, waiting, or completed before acceptance.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function normalizeBoundaryContext(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const session = input.session && typeof input.session === 'object' ? input.session : {};
  const actorSource = request.actor && typeof request.actor === 'object'
    ? request.actor
    : client.actor && typeof client.actor === 'object'
      ? client.actor
      : session.actor && typeof session.actor === 'object'
        ? session.actor
        : {};
  const scopeSource = input.scope && typeof input.scope === 'object' ? input.scope : {};
  const roles = normalizeStringList(actorSource.roles || actorSource.role ? actorSource.roles || [actorSource.role] : session.roles)
    .map((role) => role.toLowerCase());
  const permissions = normalizeStringList(
    actorSource.permissions || request.permissions || client.permissions || session.permissions
  );
  const tenantId = firstTrimmedString(
    scopeSource.tenantId,
    request.tenantId,
    client.tenantId,
    session.tenantId,
    actorSource.tenantId,
    input.tenantId
  );
  const workspaceId = firstTrimmedString(
    scopeSource.workspaceId,
    request.workspaceId,
    client.workspaceId,
    session.workspaceId,
    actorSource.workspaceId,
    input.workspaceId
  );
  const allowedTenantIds = normalizeStringList(
    scopeSource.allowedTenantIds || request.allowedTenantIds || client.allowedTenantIds || session.allowedTenantIds
  );
  const allowedWorkspaceIds = normalizeStringList(
    scopeSource.allowedWorkspaceIds || request.allowedWorkspaceIds || client.allowedWorkspaceIds || session.allowedWorkspaceIds
  );
  const workspaceTenantBindings = normalizeWorkspaceTenantBindings(
    scopeSource.workspaceTenantBindings
    || scopeSource.workspaceTenantMap
    || request.workspaceTenantBindings
    || client.workspaceTenantBindings
    || session.workspaceTenantBindings
  );
  const requireWorkspaceTenantBinding = asBoolean(
    scopeSource.requireWorkspaceTenantBinding
    ?? request.requireWorkspaceTenantBinding
    ?? client.requireWorkspaceTenantBinding
    ?? session.requireWorkspaceTenantBinding
  );
  const roleCanAccept = roles.some((role) => ACCEPTANCE_ROLES.has(role));
  const roleCanExportProof = roles.some((role) => PROOF_ROLES.has(role));
  const permissionCanAccept = hasAnyPermission(permissions, ACCEPTANCE_PERMISSIONS);
  const permissionCanExportProof = hasAnyPermission(permissions, PROOF_PERMISSIONS) || permissionCanAccept;
  const permissionCanReadBoundary = hasAnyPermission(permissions, BOUNDARY_AUDIT_PERMISSIONS)
    || permissionCanAccept
    || permissionCanExportProof;
  const resolvedTenantIds = Array.from(new Set([
    ...allowedTenantIds,
    ...workspaceTenantBindings.map((binding) => binding.tenantId)
  ]));
  const resolvedWorkspaceIds = Array.from(new Set([
    ...allowedWorkspaceIds,
    ...workspaceTenantBindings.map((binding) => binding.workspaceId)
  ]));

  return {
    tenantId,
    workspaceId,
    allowedTenantIds: tenantId ? Array.from(new Set([tenantId, ...resolvedTenantIds])) : resolvedTenantIds,
    allowedWorkspaceIds: workspaceId ? Array.from(new Set([workspaceId, ...resolvedWorkspaceIds])) : resolvedWorkspaceIds,
    workspaceTenantBindings,
    requireWorkspaceTenantBinding: requireWorkspaceTenantBinding === null
      ? workspaceTenantBindings.length > 0
      : requireWorkspaceTenantBinding,
    actorId: normalizeActorId(actorSource)
      || normalizeActorId(request.actor)
      || normalizeActorId(client.actor)
      || normalizeActorId(session.actor),
    roles,
    permissions,
    canAccept: roleCanAccept || permissionCanAccept,
    canExportProof: roleCanExportProof || permissionCanExportProof,
    canReadBoundary: roleCanAccept || roleCanExportProof || permissionCanReadBoundary,
    enforced: Boolean(
      tenantId
      || workspaceId
      || allowedTenantIds.length > 0
      || allowedWorkspaceIds.length > 0
      || workspaceTenantBindings.length > 0
    )
  };
}

function normalizePersistedState(input) {
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const checkpoint = persisted.checkpoint && typeof persisted.checkpoint === 'object' ? persisted.checkpoint : {};
  const acceptedSnapshot = persisted.acceptedSnapshot && typeof persisted.acceptedSnapshot === 'object'
    ? persisted.acceptedSnapshot
    : {};
  const commandJournal = asArray(persisted.commandJournal || persisted.commands)
    .map((command) => command && typeof command === 'object' ? command : {})
    .map((command) => ({
      idempotencyKey: asTrimmedString(command.idempotencyKey || command.key || command.commandId),
      command: asTrimmedString(command.command),
      status: asTrimmedString(command.status),
      latestDigest: asTrimmedString(command.latestDigest),
      entryCount: Number.isInteger(command.entryCount) ? command.entryCount : null,
      storageKey: asTrimmedString(command.storageKey),
      startedAt: asTrimmedString(command.startedAt || command.createdAt),
      completedAt: asTrimmedString(command.completedAt || command.finishedAt),
      resultMode: asTrimmedString(command.resultMode),
      recoveryAction: asTrimmedString(command.recoveryAction),
      writePhase: asTrimmedString(command.writePhase || command.phase),
      attempt: Number.isInteger(command.attempt) && command.attempt > 0 ? command.attempt : 1,
      leaseToken: asTrimmedString(command.leaseToken || command.lockToken),
      lockedUntil: asTrimmedString(command.lockedUntil || command.leaseExpiresAt),
      lastHeartbeatAt: asTrimmedString(command.lastHeartbeatAt || command.heartbeatAt),
      lastErrorCode: asTrimmedString(command.lastErrorCode || command.errorCode)
    }))
    .filter((command) => command.idempotencyKey);

  return {
    checkpoint: {
      latestDigest: asTrimmedString(checkpoint.latestDigest || persisted.latestDigest),
      entryCount: Number.isInteger(checkpoint.entryCount) ? checkpoint.entryCount : null,
      acceptedAt: asTrimmedString(checkpoint.acceptedAt || persisted.acceptedAt),
      mode: asTrimmedString(checkpoint.mode || persisted.mode)
    },
    acceptedSnapshot: {
      latestDigest: asTrimmedString(acceptedSnapshot.latestDigest),
      entryCount: Number.isInteger(acceptedSnapshot.entryCount) ? acceptedSnapshot.entryCount : null,
      acceptedAt: asTrimmedString(acceptedSnapshot.acceptedAt),
      requestedBy: asTrimmedString(acceptedSnapshot.requestedBy),
      proofRoute: asTrimmedString(acceptedSnapshot.proofRoute)
    },
    commandJournal
  };
}

function normalizeLifecycleControls(input) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const lifecycle = input.lifecycle && typeof input.lifecycle === 'object'
    ? input.lifecycle
    : settings.lifecycle && typeof settings.lifecycle === 'object'
      ? settings.lifecycle
      : input.controls && typeof input.controls === 'object' && input.controls.lifecycle && typeof input.controls.lifecycle === 'object'
        ? input.controls.lifecycle
        : {};
  const schedule = lifecycle.schedule && typeof lifecycle.schedule === 'object'
    ? lifecycle.schedule
    : input.schedule && typeof input.schedule === 'object'
      ? input.schedule
      : settings.schedule && typeof settings.schedule === 'object'
        ? settings.schedule
        : {};
  const requestedMode = asTrimmedString(lifecycle.mode || settings.mode);
  const enabledInput = asBoolean(lifecycle.enabled ?? settings.enabled);
  const mode = LIFECYCLE_MODES.has(requestedMode)
    ? requestedMode
    : enabledInput === false
      ? 'disabled'
      : DEFAULT_LIFECYCLE_SETTINGS.mode;
  const enabled = mode === 'disabled' ? false : enabledInput !== false;
  const cadenceInput = asTrimmedString(schedule.cadence || lifecycle.scheduleCadence || settings.scheduleCadence);
  const cadence = SCHEDULE_CADENCES.has(cadenceInput)
    ? cadenceInput
    : DEFAULT_LIFECYCLE_SETTINGS.scheduleCadence;
  const scheduleEnabledInput = asBoolean(schedule.enabled ?? lifecycle.scheduleEnabled ?? settings.scheduleEnabled);
  const intervalMinutes = asBoundedInteger(schedule.intervalMinutes, null, 5, 10080);
  const nextRunAt = asTrimmedString(schedule.nextRunAt || lifecycle.nextRunAt);
  const lastRunAt = asTrimmedString(schedule.lastRunAt || lifecycle.lastRunAt);

  return {
    type: 'AppendOnlyAuditRecoveryLifecycleSettings.v1',
    enabled,
    mode: enabled ? mode : 'disabled',
    disabledReason: asTrimmedString(lifecycle.disabledReason || lifecycle.reason || settings.disabledReason),
    maintenanceReason: asTrimmedString(lifecycle.maintenanceReason || settings.maintenanceReason),
    schedule: {
      enabled: scheduleEnabledInput === null ? cadence !== 'manual' : scheduleEnabledInput,
      cadence,
      intervalMinutes,
      nextRunAt,
      lastRunAt,
      timezone: asTrimmedString(schedule.timezone || lifecycle.timezone || settings.timezone) || 'UTC'
    },
    limits: {
      maxBatchEntries: asBoundedInteger(
        lifecycle.maxBatchEntries ?? settings.maxBatchEntries,
        DEFAULT_LIFECYCLE_SETTINGS.maxBatchEntries,
        1,
        5000
      ),
      retentionDays: asBoundedInteger(
        lifecycle.retentionDays ?? settings.retentionDays,
        DEFAULT_LIFECYCLE_SETTINGS.retentionDays,
        1,
        3650
      )
    },
    requested: {
      mode: requestedMode,
      cadence: cadenceInput,
      enabled: enabledInput,
      scheduleEnabled: scheduleEnabledInput
    }
  };
}

function normalizeLifecycleCommand(input, lifecycle) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const controls = input.controls && typeof input.controls === 'object' ? input.controls : {};
  const commandSource = input.lifecycleCommand && typeof input.lifecycleCommand === 'object'
    ? input.lifecycleCommand
    : controls.lifecycleCommand && typeof controls.lifecycleCommand === 'object'
      ? controls.lifecycleCommand
      : lifecycle.command && typeof lifecycle.command === 'object'
        ? lifecycle.command
        : {};
  const requestedCommand = normalizeCommandName(
    commandSource.command
    || commandSource.action
    || request.lifecycleCommand
    || input.lifecycleCommand
  );
  const requestedMode = asTrimmedString(commandSource.mode || commandSource.targetMode);
  const requestedCadence = asTrimmedString(commandSource.cadence || commandSource.scheduleCadence);
  const requestedScheduleEnabled = asBoolean(commandSource.scheduleEnabled ?? commandSource.schedule?.enabled);
  const command = LIFECYCLE_COMMANDS.has(requestedCommand) ? requestedCommand : requestedCommand ? 'configure' : 'none';
  const reason = firstTrimmedString(
    commandSource.reason,
    commandSource.disabledReason,
    commandSource.maintenanceReason,
    lifecycle.disabledReason,
    lifecycle.maintenanceReason
  );
  const targetMode = command === 'enable' || command === 'exit-maintenance'
    ? 'enabled'
    : command === 'disable'
      ? 'disabled'
      : command === 'enter-maintenance'
        ? 'maintenance'
        : LIFECYCLE_MODES.has(requestedMode)
          ? requestedMode
          : lifecycle.mode;
  const scheduleEnabled = command === 'pause-schedule'
    ? false
    : command === 'resume-schedule' || command === 'schedule'
      ? true
      : requestedScheduleEnabled;
  const targetCadence = SCHEDULE_CADENCES.has(requestedCadence)
    ? requestedCadence
    : lifecycle.schedule.cadence;

  return {
    type: 'AppendOnlyAuditRecoveryLifecycleCommand.v1',
    command,
    requestedCommand,
    targetMode,
    reason,
    schedule: {
      enabled: scheduleEnabled,
      cadence: targetCadence,
      nextRunAt: firstTrimmedString(commandSource.nextRunAt, commandSource.schedule?.nextRunAt),
      intervalMinutes: asBoundedInteger(
        commandSource.intervalMinutes ?? commandSource.schedule?.intervalMinutes,
        lifecycle.schedule.intervalMinutes,
        5,
        10080
      )
    },
    requestedBy: firstTrimmedString(
      commandSource.requestedBy,
      commandSource.actor,
      request.requestedBy,
      normalizeActorId(request.actor)
    ),
    effective: {
      modeWouldChange: targetMode !== lifecycle.mode,
      scheduleWouldChange: scheduleEnabled !== null && scheduleEnabled !== lifecycle.schedule.enabled,
      cadenceWouldChange: targetCadence !== lifecycle.schedule.cadence
    }
  };
}

function validateLifecycleCommand(validation, lifecycleCommand, acceptanceRequested) {
  const issues = [...validation.issues];
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'lifecycle.command', ...issue });

  if (lifecycleCommand.requestedCommand && !LIFECYCLE_COMMANDS.has(lifecycleCommand.requestedCommand)) {
    addIssue({
      code: 'invalid_lifecycle_command',
      severity: 'error',
      actual: lifecycleCommand.requestedCommand,
      expected: Array.from(LIFECYCLE_COMMANDS).filter((command) => command !== 'none'),
      message: 'Append-only audit recovery lifecycle command is not supported.'
    });
  }
  if (['disable', 'enter-maintenance'].includes(lifecycleCommand.command) && !lifecycleCommand.reason) {
    addIssue({
      code: 'missing_lifecycle_command_reason',
      severity: acceptanceRequested ? 'error' : 'warning',
      message: 'Lifecycle disable and maintenance commands require an operator reason.'
    });
  }
  if (['schedule', 'resume-schedule'].includes(lifecycleCommand.command)
    && lifecycleCommand.schedule.cadence === 'manual') {
    addIssue({
      code: 'scheduled_command_requires_cadence',
      severity: 'error',
      expected: Array.from(SCHEDULE_CADENCES).filter((cadence) => cadence !== 'manual'),
      actual: lifecycleCommand.schedule.cadence,
      message: 'Automatic lifecycle scheduling requires hourly, daily, or weekly cadence.'
    });
  }
  if (lifecycleCommand.command === 'schedule' && !lifecycleCommand.schedule.nextRunAt) {
    addIssue({
      code: 'missing_scheduled_next_run',
      severity: 'warning',
      message: 'Scheduled append-only recovery should include nextRunAt; hosted kernel will derive it from cadence when possible.'
    });
  }
  if (lifecycleCommand.command === 'resume-schedule' && !lifecycleCommand.schedule.nextRunAt) {
    addIssue({
      code: 'missing_resumed_schedule_next_run',
      severity: 'warning',
      message: 'Resumed append-only recovery schedule should include nextRunAt for deterministic hosted-kernel execution.'
    });
  }
  if (lifecycleCommand.schedule.nextRunAt && !isValidTimestamp(lifecycleCommand.schedule.nextRunAt)) {
    addIssue({
      code: 'invalid_lifecycle_command_next_run_at',
      severity: 'error',
      field: 'lifecycle.command.schedule.nextRunAt',
      message: 'Lifecycle command nextRunAt must be a valid timestamp.'
    });
  }
  if (lifecycleCommand.command === 'pause-schedule' && lifecycleCommand.schedule.enabled !== false) {
    addIssue({
      code: 'pause_schedule_noop',
      severity: 'warning',
      message: 'Pause schedule command does not carry an enabled=false transition.'
    });
  }
  if (lifecycleCommand.command === 'enable' && lifecycleCommand.targetMode !== 'enabled') {
    addIssue({
      code: 'enable_command_target_conflict',
      severity: 'error',
      expected: 'enabled',
      actual: lifecycleCommand.targetMode,
      message: 'Enable command must target enabled lifecycle mode.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function validateLifecycleSettings(validation, lifecycle, acceptanceRequested) {
  const issues = [...validation.issues];
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'lifecycle', ...issue });
  const nextRunMs = lifecycle.schedule.nextRunAt ? Date.parse(lifecycle.schedule.nextRunAt) : null;
  const lastRunMs = lifecycle.schedule.lastRunAt ? Date.parse(lifecycle.schedule.lastRunAt) : null;

  if (lifecycle.requested.mode && !LIFECYCLE_MODES.has(lifecycle.requested.mode)) {
    addIssue({
      code: 'invalid_lifecycle_mode',
      severity: 'error',
      actual: lifecycle.requested.mode,
      expected: Array.from(LIFECYCLE_MODES),
      message: 'Append-only audit recovery lifecycle mode is not supported.'
    });
  }
  if (lifecycle.requested.cadence && !SCHEDULE_CADENCES.has(lifecycle.requested.cadence)) {
    addIssue({
      code: 'invalid_schedule_cadence',
      severity: 'error',
      actual: lifecycle.requested.cadence,
      expected: Array.from(SCHEDULE_CADENCES),
      message: 'Append-only audit recovery schedule cadence is not supported.'
    });
  }
  if (!lifecycle.enabled && !lifecycle.disabledReason) {
    addIssue({
      code: 'missing_disabled_reason',
      severity: acceptanceRequested ? 'error' : 'warning',
      message: 'Disabled append-only recovery must include disabledReason before acceptance.'
    });
  }
  if (acceptanceRequested && !lifecycle.enabled) {
    addIssue({
      code: 'lifecycle_disabled',
      severity: 'error',
      message: 'Append-only audit recovery is disabled and cannot accept a checkpoint.'
    });
  }
  if (acceptanceRequested && lifecycle.mode === 'maintenance') {
    addIssue({
      code: 'lifecycle_maintenance',
      severity: 'error',
      message: 'Append-only audit recovery is in maintenance mode and cannot accept a checkpoint.'
    });
  }
  if (lifecycle.schedule.enabled && lifecycle.schedule.cadence === 'manual') {
    addIssue({
      code: 'manual_schedule_enabled',
      severity: 'warning',
      message: 'Manual cadence ignores automatic schedule enablement.'
    });
  }
  if (!lifecycle.enabled && lifecycle.schedule.enabled) {
    addIssue({
      code: 'disabled_lifecycle_schedule_enabled',
      severity: acceptanceRequested ? 'error' : 'warning',
      message: 'Disabled append-only recovery cannot run an automatic schedule.'
    });
  }
  if (lifecycle.mode === 'maintenance' && lifecycle.schedule.enabled) {
    addIssue({
      code: 'maintenance_schedule_enabled',
      severity: 'warning',
      message: 'Maintenance mode pauses automatic append-only recovery scheduling.'
    });
  }
  if (lifecycle.schedule.nextRunAt && !Number.isFinite(nextRunMs)) {
    addIssue({
      code: 'invalid_next_run_at',
      severity: 'error',
      field: 'lifecycle.schedule.nextRunAt',
      message: 'Scheduled append-only recovery nextRunAt must be a valid timestamp.'
    });
  }
  if (lifecycle.schedule.lastRunAt && !Number.isFinite(lastRunMs)) {
    addIssue({
      code: 'invalid_last_run_at',
      severity: 'warning',
      field: 'lifecycle.schedule.lastRunAt',
      message: 'Scheduled append-only recovery lastRunAt could not be parsed.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function validateMailchimpCampaignEnvelope(validation, mailchimpCampaign, commandSemantics) {
  if (!mailchimpCampaign.present) return validation;

  const issues = [...validation.issues];
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'mailchimp.campaign', ...issue });
  const deliveryCommand = MAILCHIMP_DELIVERY_COMMANDS.has(commandSemantics.command);

  if (!mailchimpCampaign.enabled && deliveryCommand) {
    addIssue({
      code: 'mailchimp_campaign_audit_disabled',
      severity: 'error',
      message: 'Mailchimp campaign audit recovery must be enabled before delivery proof can be accepted.'
    });
  }
  if (!mailchimpCampaign.campaignId) {
    addIssue({
      code: 'mailchimp_campaign_id_missing',
      severity: deliveryCommand ? 'error' : 'warning',
      message: 'Mailchimp campaign audit entries require campaignId to bind append-only proof.'
    });
  }
  if (!mailchimpCampaign.audienceId) {
    addIssue({
      code: 'mailchimp_audience_id_missing',
      severity: deliveryCommand ? 'error' : 'warning',
      message: 'Mailchimp campaign audit entries require audienceId or listId to bind delivery scope.'
    });
  }
  if (mailchimpCampaign.scheduledAt && !isValidTimestamp(mailchimpCampaign.scheduledAt)) {
    addIssue({
      code: 'mailchimp_campaign_schedule_invalid',
      severity: 'error',
      actual: mailchimpCampaign.scheduledAt,
      message: 'Mailchimp campaign scheduledAt must be a valid timestamp.'
    });
  }
  if (mailchimpCampaign.operation && !MAILCHIMP_EVENT_ACTIONS.has(`mailchimp.${mailchimpCampaign.operation}`) && !MAILCHIMP_EVENT_ACTIONS.has(mailchimpCampaign.operation)) {
    addIssue({
      code: 'mailchimp_campaign_operation_unknown',
      severity: 'warning',
      actual: mailchimpCampaign.operation,
      expected: Array.from(MAILCHIMP_EVENT_ACTIONS),
      message: 'Mailchimp campaign operation is not in the hosted audit recovery action catalog.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function buildMailchimpCampaignBoundaryGate({
  boundaryContext,
  commandSemantics,
  mailchimpCampaign,
  providerNegotiation
}) {
  if (!mailchimpCampaign.present) {
    return {
      contract: 'AppendOnlyAuditRecoveryMailchimpCampaignBoundaryGate.v1',
      present: false,
      status: 'not_applicable',
      allowed: true,
      failClosed: false,
      blockers: [],
      disclosure: 'not_applicable',
      proofPartition: null,
      handoffScope: null,
      requiredPermissions: []
    };
  }

  const deliveryCommand = MAILCHIMP_DELIVERY_COMMANDS.has(commandSemantics.command);
  const requiredPermissionSet = commandSemantics.command === 'export-proof'
    ? BOUNDARY_COMMAND_PERMISSIONS.exportProof
    : BOUNDARY_COMMAND_PERMISSIONS.accept;
  const requiredPermissions = Array.from(requiredPermissionSet);
  const permissionAllowed = commandSemantics.command === 'export-proof'
    ? boundaryContext.canExportProof
    : boundaryContext.canAccept;
  const tenantAllowed = !boundaryContext.allowedTenantIds.length
    || !boundaryContext.tenantId
    || boundaryContext.allowedTenantIds.includes(boundaryContext.tenantId);
  const workspaceAllowed = !boundaryContext.allowedWorkspaceIds.length
    || !boundaryContext.workspaceId
    || boundaryContext.allowedWorkspaceIds.includes(boundaryContext.workspaceId);
  const boundTenantId = resolveBoundTenantForWorkspace(
    boundaryContext.workspaceTenantBindings,
    boundaryContext.workspaceId
  );
  const workspaceBindingSatisfied = !boundaryContext.requireWorkspaceTenantBinding
    || Boolean(boundTenantId && boundTenantId === boundaryContext.tenantId);
  const proofPartition = [
    boundaryContext.tenantId || 'unbound-tenant',
    boundaryContext.workspaceId || 'unbound-workspace',
    mailchimpCampaign.audienceId || 'unbound-audience',
    mailchimpCampaign.campaignId || 'unbound-campaign'
  ].join(':');
  const providerStateKey = providerNegotiation.externalHandoffState.externalStateKey
    || providerNegotiation.externalHandoffState.correlationId
    || commandSemantics.idempotencyKey;
  const blockers = [
    deliveryCommand && !permissionAllowed ? {
      code: 'mailchimp_delivery_permission_denied',
      field: 'actor.permissions',
      severity: 'error',
      expected: requiredPermissions,
      message: 'Mailchimp campaign delivery requires append-only acceptance or proof export permission.'
    } : null,
    !boundaryContext.tenantId ? {
      code: 'mailchimp_delivery_tenant_missing',
      field: 'scope.tenantId',
      severity: deliveryCommand ? 'error' : 'warning',
      message: 'Mailchimp campaign delivery proof must be bound to a tenant before acceptance.'
    } : null,
    !boundaryContext.workspaceId ? {
      code: 'mailchimp_delivery_workspace_missing',
      field: 'scope.workspaceId',
      severity: deliveryCommand ? 'error' : 'warning',
      message: 'Mailchimp campaign delivery proof must be bound to a workspace before acceptance.'
    } : null,
    !tenantAllowed ? {
      code: 'mailchimp_delivery_tenant_not_allowed',
      field: 'scope.allowedTenantIds',
      severity: 'error',
      actual: boundaryContext.tenantId,
      expected: boundaryContext.allowedTenantIds,
      message: 'Mailchimp campaign delivery tenant is outside the actor boundary.'
    } : null,
    !workspaceAllowed ? {
      code: 'mailchimp_delivery_workspace_not_allowed',
      field: 'scope.allowedWorkspaceIds',
      severity: 'error',
      actual: boundaryContext.workspaceId,
      expected: boundaryContext.allowedWorkspaceIds,
      message: 'Mailchimp campaign delivery workspace is outside the actor boundary.'
    } : null,
    !workspaceBindingSatisfied ? {
      code: 'mailchimp_delivery_workspace_tenant_binding_missing',
      field: 'scope.workspaceTenantBindings',
      severity: 'error',
      actual: {
        workspaceId: boundaryContext.workspaceId,
        tenantId: boundaryContext.tenantId,
        boundTenantId
      },
      message: 'Mailchimp campaign delivery requires workspace-to-tenant binding before proof handoff.'
    } : null
  ].filter(Boolean);
  const hardBlockers = blockers.filter((blocker) => blocker.severity === 'error');
  const allowed = hardBlockers.length === 0;

  return {
    contract: 'AppendOnlyAuditRecoveryMailchimpCampaignBoundaryGate.v1',
    present: true,
    status: allowed ? 'allowed' : 'blocked',
    allowed,
    failClosed: !allowed,
    command: commandSemantics.command,
    deliveryCommand,
    requiredPermissions,
    permissionAllowed,
    actorId: boundaryContext.actorId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    tenantAllowed,
    workspaceAllowed,
    workspaceTenantBinding: {
      required: boundaryContext.requireWorkspaceTenantBinding,
      workspaceId: boundaryContext.workspaceId,
      tenantId: boundaryContext.tenantId,
      boundTenantId,
      satisfied: workspaceBindingSatisfied
    },
    proofPartition,
    handoffScope: {
      product: 'mailchimp',
      campaignId: mailchimpCampaign.campaignId,
      audienceId: mailchimpCampaign.audienceId,
      proofScope: mailchimpCampaign.proofScope,
      providerStateKey,
      externalStateKey: `${proofPartition}:${providerStateKey}`,
      disclosure: boundaryContext.canReadBoundary ? 'scoped-identifiers' : 'redacted-boundary'
    },
    blockers,
    blockerCodes: blockers.map((blocker) => blocker.code),
    disclosure: boundaryContext.canReadBoundary ? 'full_boundary_gate' : 'redacted_boundary_gate'
  };
}

function buildMailchimpCampaignDeliveryContract({
  accepted,
  boundaryContext,
  commandSemantics,
  latestEntry,
  mailchimpCampaign,
  now,
  providerNegotiation,
  validation
}) {
  if (!mailchimpCampaign.present) {
    return {
      type: 'AppendOnlyAuditRecoveryMailchimpCampaignDeliveryContract.v1',
      present: false,
      status: 'not_applicable',
      readyForAcceptance: true,
      readyForProofExport: true,
      blockingReasons: [],
      warnings: []
    };
  }

  const providerReady = providerNegotiation.status === 'negotiated';
  const appendOnlyReady = validation.errorCount === 0 && Boolean(latestEntry?.digest);
  const boundaryGate = buildMailchimpCampaignBoundaryGate({
    boundaryContext,
    commandSemantics,
    mailchimpCampaign,
    providerNegotiation
  });
  const fieldBlockers = [
    mailchimpCampaign.enabled ? null : 'mailchimp_campaign_audit_disabled',
    mailchimpCampaign.campaignId ? null : 'mailchimp_campaign_id_missing',
    mailchimpCampaign.audienceId ? null : 'mailchimp_audience_id_missing',
    mailchimpCampaign.scheduledAt && !isValidTimestamp(mailchimpCampaign.scheduledAt)
      ? 'mailchimp_campaign_schedule_invalid'
      : null
  ].filter(Boolean);
  const providerBlockers = [
    providerReady ? null : providerNegotiation.status,
    ...providerNegotiation.missingRequiredCapabilities.map((capability) => `missing:${capability}`),
    providerNegotiation.syncMetadata.syncDigestMatches ? null : 'provider_sync_cursor_stale',
    providerNegotiation.externalHandoffState.required && !providerNegotiation.externalHandoffState.ready
      ? 'provider_handoff_not_ready'
      : null
  ].filter(Boolean);
  const proofRefs = [
    ...mailchimpCampaign.evidenceRefs,
    latestEntry?.digest ? `append-only:digest:${latestEntry.digest}` : null,
    boundaryContext.tenantId ? `tenant:${boundaryContext.tenantId}` : null,
    boundaryContext.workspaceId ? `workspace:${boundaryContext.workspaceId}` : null
  ].filter(Boolean);
  const blockingReasons = [...new Set([
    ...fieldBlockers,
    ...providerBlockers,
    ...boundaryGate.blockerCodes,
    ...(appendOnlyReady ? [] : ['append_only_validation_not_ready'])
  ])];
  const readyForAcceptance = blockingReasons.length === 0;
  const deliveryId = mailchimpCampaign.proofScope
    || `mailchimp:${mailchimpCampaign.audienceId || 'unbound-audience'}:${mailchimpCampaign.campaignId || 'unbound-campaign'}`;

  return {
    type: 'AppendOnlyAuditRecoveryMailchimpCampaignDeliveryContract.v1',
    present: true,
    status: readyForAcceptance
      ? accepted
        ? 'accepted'
        : 'ready_for_acceptance'
      : 'blocked',
    deliveryId,
    campaignId: mailchimpCampaign.campaignId,
    audienceId: mailchimpCampaign.audienceId,
    templateId: mailchimpCampaign.templateId,
    operation: mailchimpCampaign.operation,
    scheduledAt: mailchimpCampaign.scheduledAt,
    archiveUrl: mailchimpCampaign.archiveUrl,
    boundaryGate,
    readyForAcceptance,
    readyForProofExport: accepted && readyForAcceptance,
    blockingReasons,
    warnings: [
      mailchimpCampaign.operation ? null : 'mailchimp_operation_not_declared',
      mailchimpCampaign.templateId ? null : 'mailchimp_template_not_bound',
      providerNegotiation.externalHandoffState.required ? null : 'external_handoff_not_requested'
    ].filter(Boolean),
    providerHandoff: {
      required: true,
      providerId: providerNegotiation.provider.providerId,
      target: providerNegotiation.externalHandoffState.target || 'mailchimp-campaign-audit',
      state: providerNegotiation.externalHandoffState.state,
      ready: providerNegotiation.externalHandoffState.ready,
      correlationId: providerNegotiation.externalHandoffState.correlationId,
      externalStateKey: providerNegotiation.externalHandoffState.externalStateKey
        || `${deliveryId}:${commandSemantics.idempotencyKey}`,
      callbackRoute: providerNegotiation.externalHandoffState.callbackRoute,
      ackDeadlineAt: providerNegotiation.externalHandoffState.ackDeadlineAt,
      leaseExpiresAt: providerNegotiation.externalHandoffState.leaseExpiresAt
    },
    proofManifest: {
      contract: 'AppendOnlyAuditRecoveryMailchimpCampaignProofManifest.v1',
      generatedAt: now,
      latestDigest: latestEntry?.digest || null,
      latestEntryId: latestEntry?.id || null,
      entryCount: validation.entries.length,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      proofPartition: boundaryGate.proofPartition,
      handoffScope: boundaryGate.handoffScope,
      proofScope: mailchimpCampaign.proofScope,
      proofRefs,
      requiredAuditFields: mailchimpCampaign.requiredFields,
      idempotencyKey: `${commandSemantics.idempotencyKey}:mailchimp:${deliveryId}`
    },
    routeContract: {
      route: mailchimpCampaign.routeHint,
      method: accepted ? 'POST' : 'PATCH',
      enabled: readyForAcceptance,
      disabledReasons: blockingReasons,
      bodyContract: 'AppendOnlyAuditRecoveryMailchimpCampaignDeliveryRequest.v1',
      body: {
        campaignId: mailchimpCampaign.campaignId,
        audienceId: mailchimpCampaign.audienceId,
        templateId: mailchimpCampaign.templateId,
        latestDigest: latestEntry?.digest || null,
        proofScope: mailchimpCampaign.proofScope,
        proofPartition: boundaryGate.proofPartition,
        idempotencyKey: `${commandSemantics.idempotencyKey}:mailchimp:${deliveryId}`
      }
    }
  };
}

function buildMailchimpCampaignAcceptanceHandoff({
  accepted,
  acceptanceRequested,
  clientReadinessSummary,
  commandSemantics,
  latestEntry,
  mailchimpCampaign,
  mailchimpDeliveryContract,
  now,
  proofReceipt,
  requestState,
  validation,
  workflowHandoff
}) {
  if (!mailchimpCampaign.present) {
    return {
      type: 'AppendOnlyAuditRecoveryMailchimpCampaignAcceptanceHandoff.v1',
      present: false,
      status: 'not_applicable',
      ready: true,
      routeContract: null,
      nextStep: null,
      validationSummary: {
        status: 'not_applicable',
        errorCount: 0,
        warningCount: 0,
        issueCodes: []
      }
    };
  }

  const mailchimpIssueCodes = validation.issues
    .filter((issue) => issue.field === 'mailchimp' || String(issue.code || '').startsWith('mailchimp_'))
    .map((issue) => issue.code);
  const proofManifest = mailchimpDeliveryContract.proofManifest || {};
  const providerHandoff = mailchimpDeliveryContract.providerHandoff || {};
  const expectedProofScope = mailchimpCampaign.campaignId && mailchimpCampaign.audienceId
    ? `mailchimp:${mailchimpCampaign.audienceId}:${mailchimpCampaign.campaignId}`
    : null;
  const scopeBlockers = [
    expectedProofScope && mailchimpCampaign.proofScope && expectedProofScope !== mailchimpCampaign.proofScope
      ? 'mailchimp_proof_scope_mismatch'
      : null,
    proofManifest.proofScope && mailchimpCampaign.proofScope && proofManifest.proofScope !== mailchimpCampaign.proofScope
      ? 'mailchimp_proof_manifest_scope_mismatch'
      : null,
    proofManifest.latestDigest && latestEntry?.digest && proofManifest.latestDigest !== latestEntry.digest
      ? 'mailchimp_proof_manifest_digest_stale'
      : null,
    proofManifest.entryCount !== undefined && proofManifest.entryCount !== validation.entries.length
      ? 'mailchimp_proof_manifest_entry_count_stale'
      : null,
    providerHandoff.externalStateKey ? null : 'mailchimp_provider_handoff_state_key_missing'
  ].filter(Boolean);
  const blockingReasons = [...new Set([
    ...mailchimpDeliveryContract.blockingReasons,
    ...mailchimpIssueCodes.filter((code) => !mailchimpDeliveryContract.blockingReasons.includes(code)),
    ...scopeBlockers,
    ...(proofReceipt.canExport || !accepted ? [] : ['proof_export_not_ready'])
  ])];
  const ready = mailchimpDeliveryContract.readyForAcceptance
    && validation.errorCount === 0
    && scopeBlockers.length === 0
    && Boolean(latestEntry?.digest)
    && workflowHandoff.state !== 'repair'
    && workflowHandoff.state !== 'blocked';
  const status = accepted
    ? 'accepted'
    : ready
      ? acceptanceRequested
        ? 'acceptance_requested'
        : 'ready_for_acceptance'
      : 'blocked';
  const nextStep = ready
    ? {
        id: accepted ? 'export-mailchimp-campaign-proof' : 'accept-mailchimp-campaign-audit',
        label: accepted ? 'Export Mailchimp campaign proof' : 'Accept Mailchimp campaign audit',
        route: accepted ? WORKFLOW_ROUTES.proof : WORKFLOW_ROUTES.accept,
        routeAction: accepted
          ? 'route.auditRecovery.appendOnlyLog.exportMailchimpProof'
          : 'route.auditRecovery.appendOnlyLog.acceptMailchimpCampaignAudit',
        reason: accepted
          ? 'Mailchimp campaign audit has been accepted and can be exported as proof.'
          : 'Mailchimp campaign audit is ready for operator acceptance.'
      }
      : {
        id: 'repair-mailchimp-campaign-audit',
        label: 'Repair Mailchimp campaign audit',
        route: WORKFLOW_ROUTES.validate,
        routeAction: 'route.auditRecovery.appendOnlyLog.validateMailchimpCampaignAudit',
        reason: blockingReasons[0] || 'Mailchimp campaign audit is blocked before acceptance.'
      };
  const idempotencyKey = `${commandSemantics.idempotencyKey}:mailchimp-acceptance:${mailchimpDeliveryContract.deliveryId}`;
  const persistedHandoffState = {
    contract: 'AppendOnlyAuditRecoveryMailchimpPersistedHandoffState.v1',
    stateKey: providerHandoff.externalStateKey || `${idempotencyKey}:state`,
    idempotencyKey,
    restartSafeStatus: accepted
      ? 'accepted-proof-exportable'
      : ready
        ? 'acceptance-resumable'
        : 'repair-required',
    replayPolicy: accepted
      ? 'return-accepted-handoff'
      : ready
        ? 'retry-same-idempotency-key'
        : 'block-until-scope-and-provider-contracts-repair',
    nextAction: accepted
      ? 'export-proof'
      : ready
        ? 'accept-campaign-audit'
        : 'repair-campaign-audit',
    digest: latestEntry?.digest || null,
    entryCount: validation.entries.length,
    proofScope: mailchimpCampaign.proofScope,
    expectedProofScope,
    deliveryId: mailchimpDeliveryContract.deliveryId,
    providerState: providerHandoff.state || 'unknown',
    providerCorrelationId: providerHandoff.correlationId || null,
    providerLeaseExpiresAt: providerHandoff.leaseExpiresAt || null,
    route: nextStep.route,
    routeAction: nextStep.routeAction,
    blockingReasons,
    scopeIntegrity: {
      valid: scopeBlockers.length === 0,
      blockers: scopeBlockers,
      proofManifestDigest: proofManifest.latestDigest || null,
      proofManifestEntryCount: proofManifest.entryCount ?? null
    }
  };
  const routeBody = {
    requestId: requestState.clientRequestId,
    runtimeId: requestState.runtimeId,
    continuationToken: requestState.continuationToken,
    campaignId: mailchimpCampaign.campaignId,
    audienceId: mailchimpCampaign.audienceId,
    templateId: mailchimpCampaign.templateId,
    latestDigest: latestEntry?.digest || null,
    entryCount: validation.entries.length,
    proofScope: mailchimpCampaign.proofScope,
    proofContract: proofReceipt.proofContract,
    providerHandoffState: providerHandoff.state,
    externalStateKey: providerHandoff.externalStateKey,
    idempotencyKey,
    persistedHandoffState
  };

  return {
    type: 'AppendOnlyAuditRecoveryMailchimpCampaignAcceptanceHandoff.v1',
    present: true,
    generatedAt: now,
    status,
    ready,
    accepted,
    acceptanceRequested,
    campaign: {
      campaignId: mailchimpCampaign.campaignId,
      audienceId: mailchimpCampaign.audienceId,
      templateId: mailchimpCampaign.templateId,
      operation: mailchimpCampaign.operation,
      scheduledAt: mailchimpCampaign.scheduledAt,
      proofScope: mailchimpCampaign.proofScope
    },
    validationSummary: {
      status: validation.errorCount > 0 ? 'blocked' : validation.warningCount > 0 ? 'warnings' : 'passed',
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      issueCodes: [...new Set(mailchimpIssueCodes)],
      blockingReasons,
      firstBlockingReason: blockingReasons[0] || null
    },
    readiness: {
      summaryStatus: clientReadinessSummary.status,
      activeRoute: clientReadinessSummary.activeRoute,
      recommendedRoute: clientReadinessSummary.recommendedRoute,
      providerReady: providerHandoff.ready,
      proofReady: proofReceipt.canExport || !accepted,
      appendOnlyReady: Boolean(latestEntry?.digest) && validation.errorCount === 0,
      scopeIntegrityReady: scopeBlockers.length === 0,
      restartSafeStatus: persistedHandoffState.restartSafeStatus
    },
    persistedHandoffState,
    preview: {
      title: `Mailchimp campaign ${mailchimpCampaign.campaignId || 'unbound-campaign'}`,
      subtitle: `Audience ${mailchimpCampaign.audienceId || 'unbound-audience'}`,
      evidenceRefs: mailchimpCampaign.evidenceRefs,
      latestDigest: latestEntry?.digest || null,
      providerHandoff,
      persistedHandoffState
    },
    nextStep,
    routeContract: {
      route: nextStep.route,
      method: accepted ? 'GET' : ready ? 'POST' : 'PATCH',
      enabled: ready || accepted,
      disabledReasons: ready || accepted ? [] : blockingReasons,
      bodyContract: 'AppendOnlyAuditRecoveryMailchimpCampaignAcceptanceRequest.v1',
      body: routeBody
    }
  };
}

function buildMailchimpClientRuntimeAdoption({
  accepted,
  clientResume,
  mailchimpAcceptanceHandoff,
  mailchimpDeliveryContract,
  now,
  requestState,
  workflowHandoffDecision
}) {
  if (!mailchimpAcceptanceHandoff.present) {
    return {
      type: 'AppendOnlyAuditRecoveryMailchimpClientRuntimeAdoption.v1',
      present: false,
      status: 'not_applicable',
      canAdopt: true,
      blockedReasons: [],
      routeContract: null
    };
  }

  const routeContract = mailchimpAcceptanceHandoff.routeContract;
  const blockedReasons = [
    ...mailchimpAcceptanceHandoff.validationSummary.blockingReasons,
    ...(clientResume.canSubmit ? [] : clientResume.blockedBy.map((issue) => issue.code)),
    ...(workflowHandoffDecision.submitPolicy.allowed ? [] : workflowHandoffDecision.blockedBy.map((issue) => issue.code))
  ];
  const uniqueBlockedReasons = [...new Set(blockedReasons.filter(Boolean))];
  const canAdopt = routeContract.enabled
    && clientResume.canSubmit
    && workflowHandoffDecision.submitPolicy.allowed
    && uniqueBlockedReasons.length === 0;
  const status = canAdopt
    ? accepted ? 'proof_runtime_adoptable' : 'acceptance_runtime_adoptable'
    : uniqueBlockedReasons.length > 0 ? 'blocked' : 'awaiting_client_resume';
  const handoffExternalStateKey = mailchimpDeliveryContract.providerHandoff.externalStateKey
    || routeContract.body.externalStateKey
    || routeContract.body.idempotencyKey;

  return {
    type: 'AppendOnlyAuditRecoveryMailchimpClientRuntimeAdoption.v1',
    present: true,
    generatedAt: now,
    status,
    canAdopt,
    campaignId: mailchimpAcceptanceHandoff.campaign.campaignId,
    audienceId: mailchimpAcceptanceHandoff.campaign.audienceId,
    product: 'mailchimp',
    runtimeBinding: {
      clientRequestId: requestState.clientRequestId,
      runtimeId: requestState.runtimeId,
      continuationToken: clientResume.token,
      continuationFingerprint: clientResume.expectedState.fingerprint,
      continuationExpiresAt: clientResume.expectedState.expiresAt,
      handoffExternalStateKey,
      providerHandoffState: mailchimpDeliveryContract.providerHandoff.state,
      route: routeContract.route,
      method: routeContract.method,
      idempotencyKey: routeContract.body.idempotencyKey
    },
    clientStatePatch: {
      mailchimpCampaignAudit: {
        status,
        canAdopt,
        campaignId: mailchimpAcceptanceHandoff.campaign.campaignId,
        audienceId: mailchimpAcceptanceHandoff.campaign.audienceId,
        templateId: mailchimpAcceptanceHandoff.campaign.templateId,
        proofScope: mailchimpAcceptanceHandoff.campaign.proofScope,
        latestDigest: routeContract.body.latestDigest,
        entryCount: routeContract.body.entryCount,
        nextRoute: routeContract.route,
        nextAction: mailchimpAcceptanceHandoff.nextStep,
        continuationToken: clientResume.token,
        blockedReasons: uniqueBlockedReasons
      }
    },
    routeContract: {
      route: '/kernel/audit-recovery/append-only-log/runtime/mailchimp/adopt',
      method: 'PATCH',
      requestContract: 'AppendOnlyAuditRecoveryMailchimpRuntimeAdoptionRequest.v1',
      responseContract: 'AppendOnlyAuditRecoveryMailchimpClientRuntimeAdoption.v1',
      enabled: canAdopt,
      disabledReasons: uniqueBlockedReasons,
      body: {
        ...routeContract.body,
        continuationToken: clientResume.token,
        continuationFingerprint: clientResume.expectedState.fingerprint,
        handoffExternalStateKey,
        adoptionStatus: status
      }
    }
  };
}

function buildLifecycleExecutionPlan({ lifecycle, lifecycleCommand, now, validation }) {
  const lifecycleIssueCodes = new Set([
    'invalid_lifecycle_mode',
    'invalid_schedule_cadence',
    'missing_disabled_reason',
    'lifecycle_disabled',
    'lifecycle_maintenance',
    'invalid_next_run_at',
    'disabled_lifecycle_schedule_enabled',
    'invalid_lifecycle_command',
    'missing_lifecycle_command_reason',
    'scheduled_command_requires_cadence',
    'invalid_lifecycle_command_next_run_at',
    'enable_command_target_conflict'
  ]);
  const blockedBy = validation.issues
    .filter((issue) => issue.severity === 'error' && lifecycleIssueCodes.has(issue.code))
    .map((issue) => ({
      code: issue.code,
      field: issue.field,
      message: issue.message
    }));
  const commandApplies = lifecycleCommand.command !== 'none' && blockedBy.length === 0;
  const cadence = commandApplies ? lifecycleCommand.schedule.cadence : lifecycle.schedule.cadence;
  const cadenceInterval = SCHEDULE_CADENCE_INTERVAL_MINUTES[cadence] || null;
  const derivedNextRunAt = commandApplies
    && ['schedule', 'resume-schedule'].includes(lifecycleCommand.command)
    && !lifecycleCommand.schedule.nextRunAt
    && cadenceInterval
      ? minutesAfter(now, cadenceInterval)
      : null;
  const scheduleEnabled = commandApplies && lifecycleCommand.schedule.enabled !== null
    ? lifecycleCommand.schedule.enabled
    : lifecycle.schedule.enabled;
  const targetMode = commandApplies ? lifecycleCommand.targetMode : lifecycle.mode;
  const effective = {
    enabled: targetMode !== 'disabled',
    mode: targetMode,
    disabledReason: targetMode === 'disabled'
      ? lifecycleCommand.reason || lifecycle.disabledReason
      : null,
    maintenanceReason: targetMode === 'maintenance'
      ? lifecycleCommand.reason || lifecycle.maintenanceReason
      : null,
    schedule: {
      ...lifecycle.schedule,
      enabled: targetMode === 'enabled' ? scheduleEnabled : false,
      cadence,
      intervalMinutes: lifecycleCommand.schedule.intervalMinutes ?? lifecycle.schedule.intervalMinutes,
      nextRunAt: lifecycleCommand.schedule.nextRunAt
        || derivedNextRunAt
        || (scheduleEnabled ? lifecycle.schedule.nextRunAt : null)
    },
    limits: lifecycle.limits
  };
  const transitions = [];
  const addTransition = (field, from, to) => {
    if (from !== to) {
      transitions.push({
        field,
        from,
        to,
        command: lifecycleCommand.command,
        requestedBy: lifecycleCommand.requestedBy
      });
    }
  };

  addTransition('mode', lifecycle.mode, effective.mode);
  addTransition('enabled', lifecycle.enabled, effective.enabled);
  addTransition('schedule.enabled', lifecycle.schedule.enabled, effective.schedule.enabled);
  addTransition('schedule.cadence', lifecycle.schedule.cadence, effective.schedule.cadence);
  addTransition('schedule.nextRunAt', lifecycle.schedule.nextRunAt, effective.schedule.nextRunAt);
  addTransition('schedule.intervalMinutes', lifecycle.schedule.intervalMinutes, effective.schedule.intervalMinutes);

  return {
    type: 'AppendOnlyAuditRecoveryLifecycleExecutionPlan.v1',
    commandApplies,
    writeRequired: transitions.length > 0,
    blockedBy,
    effective,
    transitions,
    scheduleControl: {
      canEnable: effective.mode === 'enabled' && effective.schedule.cadence !== 'manual',
      canPause: effective.schedule.enabled,
      cadenceIntervalMinutes: cadenceInterval,
      derivedNextRunAt,
      nextRunSource: lifecycleCommand.schedule.nextRunAt
        ? 'command'
        : derivedNextRunAt
          ? 'derived_from_cadence'
          : effective.schedule.nextRunAt
            ? 'settings'
            : 'none'
    },
    enableDisableControl: {
      canEnable: effective.mode !== 'enabled',
      canDisable: effective.mode !== 'disabled',
      canEnterMaintenance: effective.mode !== 'maintenance',
      reasonRequiredFor: ['disable', 'enter-maintenance']
    },
    persistence: {
      contract: 'AppendOnlyAuditRecoveryLifecycleSettings.v1',
      operation: transitions.length > 0 ? 'upsert-lifecycle-settings' : 'none',
      precondition: lifecycleCommand.command === 'none'
        ? 'no lifecycle command requested'
        : 'command validation passed before hosted-kernel settings write'
    }
  };
}

function normalizeOperationalInputs(input) {
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const storage = input.storage && typeof input.storage === 'object' ? input.storage : {};
  const retry = input.retry && typeof input.retry === 'object' ? input.retry : {};
  const health = input.operationalHealth && typeof input.operationalHealth === 'object' ? input.operationalHealth : {};
  const observedFailures = asArray(input.failures || health.failures || runtime.failures || storage.failures)
    .map((failure) => failure && typeof failure === 'object' ? failure : {})
    .map((failure) => {
      const code = asTrimmedString(failure.code || failure.reason || failure.type);
      const phase = asTrimmedString(failure.phase || failure.stage) || 'unknown';
      const knownFailure = code ? HOSTED_KERNEL_RUNTIME_FAILURES[code] : null;
      const retryAfterMs = asBoundedInteger(
        failure.retryAfterMs ?? failure.backoffMs,
        null,
        0,
        DEFAULT_RETRY_POLICY.maxDelayMs * 4
      );

      return {
        contract: 'AppendOnlyAuditRecoveryRuntimeFailure.v1',
        code,
        phase: OPERATIONAL_FAILURE_PHASES.has(phase) ? phase : 'unknown',
        requestedPhase: phase,
        message: asTrimmedString(failure.message || failure.detail),
        retryable: typeof failure.retryable === 'boolean'
          ? failure.retryable
          : knownFailure
            ? knownFailure.retryable
            : null,
        dependency: asTrimmedString(failure.dependency) || (knownFailure ? knownFailure.dependency : 'hosted-kernel'),
        observedAt: asTrimmedString(failure.observedAt || failure.timestamp),
        retryAfterMs,
        terminal: asBoolean(failure.terminal) === true,
        known: Boolean(knownFailure)
      };
    })
    .filter((failure) => failure.code);
  const invalidFailureSignals = observedFailures
    .filter((failure) => (
      !failure.known
      || !OPERATIONAL_FAILURE_PHASES.has(failure.requestedPhase)
      || (failure.observedAt && !isValidTimestamp(failure.observedAt))
    ))
    .map((failure) => ({
      code: failure.code,
      phase: failure.requestedPhase,
      observedAt: failure.observedAt,
      reason: !failure.known
        ? 'unknown_failure_code'
        : !OPERATIONAL_FAILURE_PHASES.has(failure.requestedPhase)
          ? 'unknown_failure_phase'
          : 'invalid_observed_at'
    }));

  return {
    storageReachable: storage.reachable !== false && runtime.storageReachable !== false,
    writerAvailable: storage.writerAvailable !== false && runtime.writerAvailable !== false,
    proofSignerAvailable: runtime.proofSignerAvailable !== false,
    readOnly: Boolean(storage.readOnly || runtime.readOnly),
    degradedModeRequested: Boolean(runtime.degradedMode || health.degradedMode || input.degradedMode),
    currentAttempt: Number.isInteger(retry.attempt) && retry.attempt > 0 ? retry.attempt : 1,
    maxAttempts: Number.isInteger(retry.maxAttempts) && retry.maxAttempts > 0
      ? retry.maxAttempts
      : DEFAULT_RETRY_POLICY.maxAttempts,
    baseDelayMs: Number.isInteger(retry.baseDelayMs) && retry.baseDelayMs > 0
      ? retry.baseDelayMs
      : DEFAULT_RETRY_POLICY.baseDelayMs,
    maxDelayMs: Number.isInteger(retry.maxDelayMs) && retry.maxDelayMs > 0
      ? retry.maxDelayMs
      : DEFAULT_RETRY_POLICY.maxDelayMs,
    observedFailures,
    invalidFailureSignals
  };
}

function compareIso(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return leftMs - rightMs;
}

function buildTimestampIntegrity(entries, issues) {
  const invalidTimestampIndexes = new Set(
    issues
      .filter((issue) => issue.code === 'invalid_timestamp' && Number.isInteger(issue.entryIndex))
      .map((issue) => issue.entryIndex)
  );
  const regressionIndexes = new Set(
    issues
      .filter((issue) => issue.code === 'timestamp_regression' && Number.isInteger(issue.entryIndex))
      .map((issue) => issue.entryIndex)
  );
  const parseableTimes = entries
    .map((entry) => ({
      entryIndex: entry.index,
      timestamp: entry.timestamp,
      epochMs: Date.parse(entry.timestamp)
    }))
    .filter((item) => Number.isFinite(item.epochMs));
  const firstObserved = parseableTimes.length > 0
    ? parseableTimes.reduce((first, item) => item.epochMs < first.epochMs ? item : first, parseableTimes[0])
    : null;
  const lastObserved = parseableTimes.length > 0
    ? parseableTimes.reduce((last, item) => item.epochMs > last.epochMs ? item : last, parseableTimes[0])
    : null;
  const status = invalidTimestampIndexes.size > 0
    ? 'invalid'
    : regressionIndexes.size > 0
      ? 'non_monotonic'
      : parseableTimes.length === entries.length
        ? 'verified'
        : 'unverified';

  return {
    contract: 'AppendOnlyAuditRecoveryTimestampIntegrity.v1',
    status,
    parseableCount: parseableTimes.length,
    invalidCount: invalidTimestampIndexes.size,
    regressionCount: regressionIndexes.size,
    firstObservedAt: firstObserved ? firstObserved.timestamp : null,
    firstObservedEntryIndex: firstObserved ? firstObserved.entryIndex : null,
    lastObservedAt: lastObserved ? lastObserved.timestamp : null,
    lastObservedEntryIndex: lastObserved ? lastObserved.entryIndex : null,
    invalidEntryIndexes: Array.from(invalidTimestampIndexes),
    regressionEntryIndexes: Array.from(regressionIndexes),
    acceptanceBlocking: invalidTimestampIndexes.size > 0 || regressionIndexes.size > 0
  };
}

function validateEntries(entries, policy) {
  const issues = [];
  const normalized = entries.map(normalizeEntry);
  const seenIds = new Set();

  normalized.forEach((entry, index) => {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!entry[field]) {
        issues.push({
          code: 'missing_required_field',
          severity: 'error',
          entryIndex: index,
          field,
          message: `Audit entry ${index} is missing ${field}.`
        });
      }
    }

    if (entry.id && seenIds.has(entry.id)) {
      issues.push({
        code: 'duplicate_entry_id',
        severity: 'error',
        entryIndex: index,
        field: 'id',
        message: `Audit entry id ${entry.id} appears more than once.`
      });
    }
      if (entry.id) seenIds.add(entry.id);

    if (entry.timestamp && !isValidTimestamp(entry.timestamp)) {
      issues.push({
        code: 'invalid_timestamp',
        severity: 'error',
        entryIndex: index,
        field: 'timestamp',
        actual: entry.timestamp,
        message: `Audit entry ${index} timestamp must be parseable before append-only acceptance.`
      });
    }

    if (policy.requireMonotonicTimestamps && index > 0) {
      const previous = normalized[index - 1];
      const delta = compareIso(entry.timestamp, previous.timestamp);
      if (delta !== null && delta < 0) {
        issues.push({
          code: 'timestamp_regression',
          severity: 'error',
          entryIndex: index,
          field: 'timestamp',
          message: `Audit entry ${index} timestamp is earlier than entry ${index - 1}.`
        });
      }
    }

    if (policy.requireDigestChain && index > 0) {
      const previous = normalized[index - 1];
      if (entry.previousDigest && previous.digest && entry.previousDigest !== previous.digest) {
        issues.push({
          code: 'digest_chain_mismatch',
          severity: 'error',
          entryIndex: index,
          field: 'previousDigest',
          expected: previous.digest,
          actual: entry.previousDigest,
          message: `Audit entry ${index} does not point at the previous digest.`
        });
      }
      if (!entry.previousDigest) {
        issues.push({
          code: 'missing_previous_digest',
          severity: 'warning',
          entryIndex: index,
          field: 'previousDigest',
          message: `Audit entry ${index} cannot prove append-only continuity without previousDigest.`
        });
      }
    }
  });

  if (normalized.length < policy.minEntries) {
    issues.push({
      code: 'insufficient_entries',
      severity: 'error',
      entryIndex: null,
      field: 'entries',
      message: `Append-only preview requires at least ${policy.minEntries} audit entry.`
    });
  }

  return {
    entries: normalized,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    timestampIntegrity: buildTimestampIntegrity(normalized, issues)
  };
}

function validateBoundaryContext(validation, boundaryContext, acceptanceRequested) {
  const issues = [...validation.issues];
  const allowedTenantIds = new Set(boundaryContext.allowedTenantIds);
  const allowedWorkspaceIds = new Set(boundaryContext.allowedWorkspaceIds);

  validation.entries.forEach((entry) => {
    const boundTenantId = resolveBoundTenantForWorkspace(boundaryContext.workspaceTenantBindings, entry.workspaceId);

    if (boundaryContext.enforced && !entry.tenantId && boundaryContext.tenantId) {
      issues.push({
        code: 'missing_entry_tenant_scope',
        severity: 'error',
        entryIndex: entry.index,
        field: 'tenantId',
        expected: boundaryContext.tenantId,
        message: `Audit entry ${entry.index} must carry tenantId for scoped recovery.`
      });
    }
    if (entry.tenantId && allowedTenantIds.size > 0 && !allowedTenantIds.has(entry.tenantId)) {
      issues.push({
        code: 'tenant_boundary_violation',
        severity: 'error',
        entryIndex: entry.index,
        field: 'tenantId',
        expected: Array.from(allowedTenantIds),
        actual: entry.tenantId,
        message: `Audit entry ${entry.index} belongs to a tenant outside this recovery scope.`
      });
    }
    if (boundaryContext.enforced && !entry.workspaceId && boundaryContext.workspaceId) {
      issues.push({
        code: 'missing_entry_workspace_scope',
        severity: 'error',
        entryIndex: entry.index,
        field: 'workspaceId',
        expected: boundaryContext.workspaceId,
        message: `Audit entry ${entry.index} must carry workspaceId for scoped recovery.`
      });
    }
    if (entry.workspaceId && allowedWorkspaceIds.size > 0 && !allowedWorkspaceIds.has(entry.workspaceId)) {
      issues.push({
        code: 'workspace_boundary_violation',
        severity: 'error',
        entryIndex: entry.index,
        field: 'workspaceId',
        expected: Array.from(allowedWorkspaceIds),
        actual: entry.workspaceId,
        message: `Audit entry ${entry.index} belongs to a workspace outside this recovery scope.`
      });
    }
    if (entry.workspaceId && boundaryContext.requireWorkspaceTenantBinding && !boundTenantId) {
      issues.push({
        code: 'workspace_tenant_binding_missing',
        severity: 'error',
        entryIndex: entry.index,
        field: 'workspaceId',
        expected: boundaryContext.workspaceTenantBindings.map((binding) => binding.workspaceId),
        actual: entry.workspaceId,
        message: `Audit entry ${entry.index} workspace is not present in the tenant binding table for scoped recovery.`
      });
    }
    if (entry.workspaceId && entry.tenantId && boundTenantId && entry.tenantId !== boundTenantId) {
      issues.push({
        code: 'workspace_tenant_boundary_violation',
        severity: 'error',
        entryIndex: entry.index,
        field: 'tenantId',
        expected: boundTenantId,
        actual: entry.tenantId,
        message: `Audit entry ${entry.index} tenantId does not match the bound tenant for its workspace.`
      });
    }
    if (entry.workspaceId && boundaryContext.tenantId && boundTenantId && boundaryContext.tenantId !== boundTenantId) {
      issues.push({
        code: 'workspace_tenant_boundary_violation',
        severity: 'error',
        entryIndex: entry.index,
        field: 'workspaceId',
        expected: boundaryContext.tenantId,
        actual: boundTenantId,
        message: `Audit entry ${entry.index} workspace is bound to a different tenant than the recovery scope.`
      });
    }
  });

  if (acceptanceRequested && !boundaryContext.actorId) {
    issues.push({
      code: 'acceptance_actor_missing',
      severity: 'error',
      entryIndex: null,
      field: 'actor',
      message: 'Acceptance requires a resolved actorId for hosted-kernel boundary audit handoff.'
    });
  }

  if (acceptanceRequested && !boundaryContext.canAccept) {
    issues.push({
      code: 'acceptance_permission_denied',
      severity: 'error',
      entryIndex: null,
      field: 'permissions',
      expected: Array.from(ACCEPTANCE_PERMISSIONS),
      message: 'Actor lacks permission to accept append-only audit recovery state.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function buildBoundaryAccessPlan(boundaryContext, entries, requestState) {
  const allowedTenantIds = new Set(boundaryContext.allowedTenantIds);
  const allowedWorkspaceIds = new Set(boundaryContext.allowedWorkspaceIds);
  const commandPermissions = Object.fromEntries(
    Object.entries(BOUNDARY_COMMAND_PERMISSIONS).map(([command, permissions]) => [
      command,
      Array.from(permissions).map((permission) => ({
        permission,
        granted: boundaryContext.permissions.includes(permission)
      }))
    ])
  );
  const entryScopes = entries.map((entry) => {
    const boundTenantId = resolveBoundTenantForWorkspace(boundaryContext.workspaceTenantBindings, entry.workspaceId);
    const tenantAllowed = !entry.tenantId || allowedTenantIds.size === 0 || allowedTenantIds.has(entry.tenantId);
    const workspaceAllowed = !entry.workspaceId || allowedWorkspaceIds.size === 0 || allowedWorkspaceIds.has(entry.workspaceId);
    const bindingAllowed = !entry.workspaceId
      || !boundaryContext.requireWorkspaceTenantBinding
      || (boundTenantId && (!entry.tenantId || entry.tenantId === boundTenantId));
    const canReveal = boundaryContext.canReadBoundary && tenantAllowed && workspaceAllowed && bindingAllowed;

    return {
      entryIndex: entry.index,
      entryId: entry.id,
      tenantId: canReveal ? entry.tenantId : null,
      workspaceId: canReveal ? entry.workspaceId : null,
      scopeKey: canReveal
        ? `${entry.tenantId || 'tenant-unscoped'}:${entry.workspaceId || 'workspace-unscoped'}`
        : 'redacted',
      boundTenantId: canReveal ? boundTenantId : null,
      tenantAllowed,
      workspaceAllowed,
      bindingAllowed: Boolean(bindingAllowed),
      visibleToActor: canReveal,
      redactionReason: canReveal
        ? null
        : !boundaryContext.canReadBoundary
          ? 'boundary_read_permission_missing'
          : !tenantAllowed
            ? 'tenant_outside_actor_scope'
            : !workspaceAllowed
              ? 'workspace_outside_actor_scope'
              : 'workspace_tenant_binding_failed'
    };
  });
  const hiddenEntryCount = entryScopes.filter((scope) => !scope.visibleToActor).length;
  const requestedProof = requestState.requestedView === 'proof' || requestState.sourceRoute === WORKFLOW_ROUTES.proof;

  return {
    type: 'AppendOnlyAuditRecoveryBoundaryAccessPlan.v1',
    actorId: boundaryContext.actorId,
    requestedRoute: requestState.sourceRoute,
    requestedView: requestState.requestedView,
    enforced: boundaryContext.enforced,
    scopeKey: `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`,
    accessMode: hiddenEntryCount > 0
      ? 'redacted'
      : boundaryContext.enforced
        ? 'scoped'
        : 'unscoped',
    commandGates: {
      accept: {
        allowed: boundaryContext.canAccept,
        source: boundaryContext.canAccept
          ? boundaryContext.roles.some((role) => ACCEPTANCE_ROLES.has(role)) ? 'role' : 'permission'
          : 'none',
        permissions: commandPermissions.accept
      },
      exportProof: {
        allowed: boundaryContext.canExportProof,
        requested: requestedProof,
        source: boundaryContext.canExportProof
          ? boundaryContext.roles.some((role) => PROOF_ROLES.has(role)) ? 'role' : 'permission'
          : 'none',
        permissions: commandPermissions.exportProof
      },
      readBoundary: {
        allowed: boundaryContext.canReadBoundary,
        source: boundaryContext.canReadBoundary
          ? boundaryContext.roles.some((role) => ACCEPTANCE_ROLES.has(role) || PROOF_ROLES.has(role)) ? 'role' : 'permission'
          : 'none',
        permissions: commandPermissions.readBoundary
      }
    },
    entryScopes,
    redaction: {
      applied: hiddenEntryCount > 0,
      hiddenEntryCount,
      exposedEntryCount: entryScopes.length - hiddenEntryCount,
      reasonCodes: Array.from(new Set(entryScopes.map((scope) => scope.redactionReason).filter(Boolean)))
    },
    auditHandoff: {
      contract: 'AppendOnlyAuditRecoveryBoundaryAccessAuditEvent.v1',
      target: 'hosted-kernel-boundary-audit',
      route: WORKFLOW_ROUTES.validate,
      includePermissionSnapshot: boundaryContext.canReadBoundary,
      includeEntryScopes: boundaryContext.canReadBoundary,
      immutableEvidence: true
    }
  };
}

function validateBoundaryAccessPlan(validation, boundaryAccessPlan, { acceptanceRequested, proofRequested }) {
  const issues = [...validation.issues];
  const addIssue = (issue) => issues.push({ entryIndex: null, field: 'boundary.accessPlan', ...issue });

  if ((acceptanceRequested || proofRequested) && boundaryAccessPlan.redaction.applied) {
    addIssue({
      code: 'boundary_access_redacted',
      severity: 'error',
      actual: boundaryAccessPlan.redaction.reasonCodes,
      message: 'Accepting or exporting proof requires fully visible tenant/workspace boundary evidence.'
    });
  }
  if (proofRequested && !boundaryAccessPlan.commandGates.exportProof.allowed) {
    addIssue({
      code: 'proof_permission_denied',
      severity: 'error',
      expected: Array.from(PROOF_PERMISSIONS),
      message: 'Actor lacks permission to export append-only recovery proof for this boundary.'
    });
  }
  if (boundaryAccessPlan.entryScopes.some((scope) => scope.workspaceAllowed && !scope.bindingAllowed)) {
    addIssue({
      code: 'workspace_binding_access_denied',
      severity: 'error',
      message: 'Workspace scope cannot be exposed because its tenant binding failed boundary access checks.'
    });
  }

  return {
    ...validation,
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length
  };
}

function buildPreview(validation) {
  const lastEntry = validation.entries[validation.entries.length - 1] || null;
  return {
    visible: true,
    entryCount: validation.entries.length,
    latestDigest: lastEntry ? lastEntry.digest : null,
    latestTimestamp: lastEntry ? lastEntry.timestamp : null,
    latestAction: lastEntry ? lastEntry.action : null,
    issueCount: validation.issues.length,
    timestampIntegrity: validation.timestampIntegrity,
    rows: validation.entries.slice(-5).map((entry) => ({
      index: entry.index,
      id: entry.id,
      timestamp: entry.timestamp,
      timestampValid: entry.timestamp ? isValidTimestamp(entry.timestamp) : false,
      actor: entry.actor,
      action: entry.action,
      digest: entry.digest,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      continuity: entry.index === 0 ? 'genesis' : entry.previousDigest ? 'linked' : 'unproven'
    }))
  };
}

function incrementCounter(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function toRankedCounts(counter, limit = 5) {
  return Object.entries(counter)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function normalizeAnalyticsHistory(input) {
  const persisted = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  return asArray(input.analyticsHistory || input.historySnapshots || persisted.analyticsHistory || persisted.historySnapshots)
    .map((snapshot) => snapshot && typeof snapshot === 'object' ? snapshot : {})
    .map((snapshot) => ({
      capturedAt: asTrimmedString(snapshot.capturedAt || snapshot.generatedAt || snapshot.checkedAt),
      latestDigest: asTrimmedString(snapshot.latestDigest || snapshot.digest),
      genesisDigest: asTrimmedString(snapshot.genesisDigest),
      entryCount: Number.isInteger(snapshot.entryCount) ? snapshot.entryCount : null,
      errorCount: Number.isInteger(snapshot.errorCount) ? snapshot.errorCount : 0,
      warningCount: Number.isInteger(snapshot.warningCount) ? snapshot.warningCount : 0,
      accepted: Boolean(snapshot.accepted),
      mode: asTrimmedString(snapshot.mode || snapshot.status),
      command: normalizeCommandName(snapshot.command),
      commandStatus: asTrimmedString(snapshot.commandStatus || snapshot.status),
      lifecycleStatus: asTrimmedString(snapshot.lifecycleStatus),
      operationalStatus: asTrimmedString(snapshot.operationalStatus),
      exportReady: Boolean(snapshot.exportReady),
      storageKey: asTrimmedString(snapshot.storageKey),
      scopeKey: asTrimmedString(snapshot.scopeKey),
      route: asTrimmedString(snapshot.route)
    }))
    .filter((snapshot) => snapshot.capturedAt || snapshot.latestDigest || snapshot.entryCount !== null)
    .slice(-9);
}

function buildAnalyticsTimelineEvents({
  currentSnapshot,
  historySnapshots,
  lifecycleState,
  now,
  operationalHealth,
  statePersistence,
  validation
}) {
  const historicalEvents = historySnapshots.map((snapshot, index) => ({
    id: `history-${index}`,
    type: 'history_snapshot',
    occurredAt: snapshot.capturedAt,
    route: snapshot.route || WORKFLOW_ROUTES.preview,
    status: snapshot.mode || 'snapshot',
    digest: snapshot.latestDigest,
    entryCount: snapshot.entryCount,
    severity: snapshot.errorCount > 0 ? 'error' : snapshot.warningCount > 0 ? 'warning' : 'info'
  }));
  const validationEvents = validation.issues.slice(0, 12).map((issue, index) => ({
    id: `validation-${index}`,
    type: 'validation_issue',
    occurredAt: now,
    route: REPAIRABLE_ISSUE_CODES.has(issue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept,
    status: issue.code,
    digest: currentSnapshot.latestDigest,
    entryCount: currentSnapshot.entryCount,
      severity: issue.severity,
      entryIndex: issue.entryIndex
  }));
  const timestampIntegrityEvent = validation.timestampIntegrity.status === 'verified'
    ? null
    : {
        id: 'timestamp-integrity-current',
        type: 'timestamp_integrity',
        occurredAt: now,
        route: WORKFLOW_ROUTES.validate,
        status: validation.timestampIntegrity.status,
        digest: currentSnapshot.latestDigest,
        entryCount: currentSnapshot.entryCount,
        severity: validation.timestampIntegrity.acceptanceBlocking ? 'error' : 'warning',
        invalidEntryIndexes: validation.timestampIntegrity.invalidEntryIndexes,
        regressionEntryIndexes: validation.timestampIntegrity.regressionEntryIndexes
      };
  const writeEvents = statePersistence.requiredWrites.map((write, index) => ({
    id: `write-${index}`,
    type: 'required_write',
    occurredAt: now,
    route: write.id === 'accepted-snapshot' ? WORKFLOW_ROUTES.accept : WORKFLOW_ROUTES.validate,
    status: write.operation,
    digest: currentSnapshot.latestDigest,
    entryCount: currentSnapshot.entryCount,
    severity: statePersistence.status === 'write_blocked' ? 'error' : 'info',
    storageKey: write.storageKey,
    contract: write.contract
  }));
  const runtimeEvents = operationalHealth.actionableErrors.slice(0, 8).map((error, index) => ({
    id: `runtime-${index}`,
    type: 'runtime_signal',
    occurredAt: now,
    route: error.route,
    status: error.code,
    digest: currentSnapshot.latestDigest,
    entryCount: currentSnapshot.entryCount,
    severity: error.severity,
    action: error.action
  }));
  const lifecycleEvent = {
    id: 'lifecycle-current',
    type: 'lifecycle_state',
    occurredAt: now,
    route: lifecycleState.nextAction.route,
    status: lifecycleState.status,
    digest: currentSnapshot.latestDigest,
    entryCount: currentSnapshot.entryCount,
    severity: lifecycleState.blockedBy.some((issue) => issue.severity === 'error') ? 'error' : 'info',
    dueAt: lifecycleState.nextAction.dueAt
  };

  return [
    ...historicalEvents,
    lifecycleEvent,
    ...(timestampIntegrityEvent ? [timestampIntegrityEvent] : []),
    ...validationEvents,
    ...writeEvents,
    ...runtimeEvents
  ]
    .filter((event) => event.occurredAt || event.digest || event.entryCount !== null)
    .slice(-40);
}

function buildAnalyticsReporting({
  accepted,
  boundaryContext,
  commandSemantics,
  historySnapshots,
  lifecycleState,
  latestEntry,
  now,
  operationalHealth,
  persistedStateShape,
  statePersistence,
  validation
}) {
  const actionCounts = {};
  const actorCounts = {};
  const routeCounts = {};
  const commandStatusCounts = {};
  const continuityCounts = { genesis: 0, linked: 0, unproven: 0 };
  const issueCounts = {};
  const boundaryIssueCodes = new Set([
    'acceptance_actor_missing',
    'boundary_access_redacted',
    'tenant_boundary_violation',
    'workspace_tenant_boundary_violation',
    'workspace_tenant_binding_missing',
    'workspace_boundary_violation',
    'missing_entry_tenant_scope',
    'missing_entry_workspace_scope',
    'acceptance_permission_denied',
    'proof_permission_denied',
    'workspace_binding_access_denied'
  ]);

  validation.entries.forEach((entry) => {
    incrementCounter(actionCounts, entry.action || 'unknown_action');
    incrementCounter(actorCounts, entry.actor || 'unknown_actor');
    incrementCounter(routeCounts, entry.route || 'unrouted');
    if (entry.index === 0) {
      continuityCounts.genesis += 1;
    } else if (entry.previousDigest) {
      continuityCounts.linked += 1;
    } else {
      continuityCounts.unproven += 1;
    }
  });
  validation.issues.forEach((issue) => incrementCounter(issueCounts, issue.code));
  historySnapshots.forEach((snapshot) => {
    incrementCounter(commandStatusCounts, snapshot.commandStatus || snapshot.mode || 'snapshot');
  });
  incrementCounter(commandStatusCounts, commandSemantics.status);

  const currentSnapshot = {
    capturedAt: now,
    latestDigest: latestEntry ? latestEntry.digest : null,
    genesisDigest: validation.entries[0] ? validation.entries[0].digest : null,
    entryCount: validation.entries.length,
    errorCount: validation.errorCount,
    warningCount: validation.warningCount,
    accepted,
    mode: accepted ? 'accepted' : validation.errorCount > 0 ? 'needs_repair' : 'preview',
    command: commandSemantics.command,
    commandStatus: commandSemantics.status,
    lifecycleStatus: lifecycleState.status,
    operationalStatus: operationalHealth.status,
    exportReady: accepted || persistedStateShape.acceptedSnapshot.reusable,
    storageKey: persistedStateShape.storageKey,
    scopeKey: `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`,
    route: accepted ? WORKFLOW_ROUTES.proof : validation.errorCount > 0 ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept,
    timestampIntegrityStatus: validation.timestampIntegrity.status,
    timestampIntegrityBlocking: validation.timestampIntegrity.acceptanceBlocking
  };
  const timeline = [...historySnapshots, currentSnapshot];
  const timelineEvents = buildAnalyticsTimelineEvents({
    currentSnapshot,
    historySnapshots,
    lifecycleState,
    now,
    operationalHealth,
    statePersistence,
    validation
  });
  const previousSnapshot = timeline.length > 1 ? timeline[timeline.length - 2] : null;
  const entryDelta = previousSnapshot && previousSnapshot.entryCount !== null
    ? currentSnapshot.entryCount - previousSnapshot.entryCount
    : currentSnapshot.entryCount;
  const errorDelta = previousSnapshot ? currentSnapshot.errorCount - previousSnapshot.errorCount : currentSnapshot.errorCount;
  const warningDelta = previousSnapshot ? currentSnapshot.warningCount - previousSnapshot.warningCount : currentSnapshot.warningCount;
  const reportStatus = validation.errorCount > 0
    ? 'blocked'
    : operationalHealth.status === 'unhealthy'
      ? 'attention_required'
      : accepted || persistedStateShape.acceptedSnapshot.reusable
        ? 'export_ready'
        : 'collecting_acceptance';

  return {
    type: 'AppendOnlyAuditRecoveryAnalyticsReport.v1',
    counters: {
      entriesTotal: validation.entries.length,
      acceptedEntries: accepted ? validation.entries.length : 0,
      scopedEntries: validation.entries.filter((entry) => entry.tenantId || entry.workspaceId).length,
      uniqueActors: Object.keys(actorCounts).length,
      uniqueActions: Object.keys(actionCounts).length,
      errorsTotal: validation.errorCount,
      warningsTotal: validation.warningCount,
      repairableIssues: validation.issues.filter((issue) => REPAIRABLE_ISSUE_CODES.has(issue.code)).length,
      boundaryIssues: validation.issues.filter((issue) => boundaryIssueCodes.has(issue.code)).length,
      timestampInvalidEntries: validation.timestampIntegrity.invalidCount,
      timestampRegressionEntries: validation.timestampIntegrity.regressionCount,
      timestampParseableEntries: validation.timestampIntegrity.parseableCount,
      runtimeFailures: operationalHealth.signals.observedFailureCount,
      malformedRuntimeSignals: operationalHealth.signals.malformedSignalCount,
      pendingWrites: statePersistence.requiredWrites.length,
      historySnapshots: historySnapshots.length,
      exportReadySnapshots: timeline.filter((snapshot) => snapshot.exportReady || snapshot.accepted).length,
      continuity: continuityCounts
    },
    breakdowns: {
      actions: toRankedCounts(actionCounts, 8),
      actors: toRankedCounts(actorCounts, 8),
      routes: toRankedCounts(routeCounts, 8),
      issues: toRankedCounts(issueCounts, 8),
      commandStatuses: toRankedCounts(commandStatusCounts, 8)
    },
    timeline: {
      snapshotSchema: 'AppendOnlyAuditRecoveryAnalyticsSnapshot.v1',
      eventSchema: 'AppendOnlyAuditRecoveryTimelineEvent.v1',
      current: currentSnapshot,
      history: timeline,
      events: timelineEvents,
      timestampIntegrity: validation.timestampIntegrity,
      deltaFromPrevious: {
        entryCount: entryDelta,
        errorCount: errorDelta,
        warningCount: warningDelta,
        latestDigestChanged: previousSnapshot
          ? previousSnapshot.latestDigest !== currentSnapshot.latestDigest
          : Boolean(currentSnapshot.latestDigest)
      }
    },
    exportSummary: {
      schema: 'AppendOnlyAuditRecoveryExportSummary.v1',
      ready: reportStatus === 'export_ready' && boundaryContext.canExportProof && Boolean(latestEntry && latestEntry.digest),
      route: WORKFLOW_ROUTES.proof,
      command: commandSemantics.command === 'export-proof' ? commandSemantics.command : 'export-proof',
      idempotencyKey: commandSemantics.idempotencyKey,
      formats: [
        { id: 'proof-json', mediaType: 'application/json', contract: 'AppendOnlyAuditRecoveryProof.v1' },
        { id: 'summary-jsonl', mediaType: 'application/x-ndjson', contract: 'AppendOnlyAuditRecoveryTimelineEvent.v1' }
      ],
      manifest: {
        surfaceId,
        generatedAt: now,
        storageKey: persistedStateShape.storageKey,
        latestDigest: latestEntry ? latestEntry.digest : null,
        genesisDigest: validation.entries[0] ? validation.entries[0].digest : null,
        entryCount: validation.entries.length,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        appendOnly: validation.errorCount === 0,
        timestampIntegrity: validation.timestampIntegrity.status
      },
      artifactPlan: {
        json: {
          contract: 'AppendOnlyAuditRecoveryAnalyticsReport.v1',
          includes: ['counters', 'breakdowns', 'timeline.current', 'timeline.events', 'exportSummary.manifest']
        },
        ndjson: {
          contract: 'AppendOnlyAuditRecoveryTimelineEvent.v1',
          rowCount: timelineEvents.length,
          stableFields: ['id', 'type', 'occurredAt', 'route', 'status', 'digest', 'entryCount', 'severity']
        },
        csv: {
          contract: 'AppendOnlyAuditRecoveryAnalyticsCounterRow.v1',
          headers: ['metric', 'value', 'scopeKey', 'latestDigest', 'generatedAt']
        }
      }
    },
    reportingState: {
      status: reportStatus,
      primaryMetric: accepted ? 'accepted_entries' : validation.errorCount > 0 ? 'blocking_errors' : 'preview_entries',
      rollupKey: currentSnapshot.scopeKey,
      route: reportStatus === 'blocked' ? WORKFLOW_ROUTES.validate : reportStatus === 'export_ready' ? WORKFLOW_ROUTES.proof : WORKFLOW_ROUTES.accept,
      dashboardCards: [
        { id: 'entries', label: 'Entries', value: validation.entries.length, trend: entryDelta },
        { id: 'errors', label: 'Errors', value: validation.errorCount, trend: errorDelta },
        { id: 'warnings', label: 'Warnings', value: validation.warningCount, trend: warningDelta },
        { id: 'writes', label: 'Pending writes', value: statePersistence.requiredWrites.length, trend: null },
        { id: 'continuity', label: 'Linked entries', value: continuityCounts.linked, trend: null }
      ],
      alerts: validation.issues
        .filter((issue) => issue.severity === 'error')
        .slice(0, 5)
        .map((issue) => ({
          code: issue.code,
          entryIndex: issue.entryIndex,
          route: REPAIRABLE_ISSUE_CODES.has(issue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept
        })),
      exportControls: {
        enabled: reportStatus === 'export_ready' && boundaryContext.canExportProof,
        disabledReasons: reportStatus === 'export_ready' && boundaryContext.canExportProof
          ? []
          : [
              ...(reportStatus !== 'export_ready' ? [reportStatus] : []),
              ...(!boundaryContext.canExportProof ? ['proof_permission_denied'] : [])
            ],
        defaultFormat: 'proof-json',
        availableFormats: ['proof-json', 'summary-jsonl', 'counter-csv']
      }
    }
  };
}

function buildNextSteps(validation, accepted) {
  if (validation.errorCount > 0) {
    return [{
      id: 'repair-log-contract',
      label: 'Repair audit log contract',
      reason: 'Blocking validation errors prevent accepting this append-only view.',
      route: WORKFLOW_ROUTES.validate,
      requiredInputs: ['entries[].id', 'entries[].timestamp', 'entries[].actor', 'entries[].action', 'entries[].digest']
    }];
  }

  if (!accepted) {
    return [{
      id: 'accept-preview',
      label: 'Accept append-only preview',
      reason: 'Validation passed and the hosted kernel can persist the recovery proof.',
      route: WORKFLOW_ROUTES.accept,
      requiredInputs: ['acceptance.requestedBy', 'acceptance.reason']
    }];
  }

  return [{
    id: 'export-proof',
    label: 'Export recovery proof',
    reason: 'Accepted append-only state is ready for recovery workflows and client display.',
    route: WORKFLOW_ROUTES.proof,
    requiredInputs: ['proof.latestDigest', 'proof.entryCount']
  }];
}

function summarizeValidationForClient(validation) {
  const severityRank = { error: 0, warning: 1, info: 2 };
  const issues = [...validation.issues].sort((left, right) => (
    (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3)
    || String(left.code).localeCompare(String(right.code))
    || (left.entryIndex ?? Number.MAX_SAFE_INTEGER) - (right.entryIndex ?? Number.MAX_SAFE_INTEGER)
  ));
  const grouped = issues.reduce((groups, issue) => {
    const key = issue.severity || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push({
      code: issue.code,
      entryIndex: issue.entryIndex,
      field: issue.field,
      message: issue.message,
      repairable: REPAIRABLE_ISSUE_CODES.has(issue.code),
      route: REPAIRABLE_ISSUE_CODES.has(issue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept
    });
    return groups;
  }, {});
  const primaryIssue = issues[0] || null;

  return {
    type: 'AppendOnlyAuditRecoveryClientValidationSummary.v1',
    status: validation.errorCount > 0 ? 'blocked' : validation.warningCount > 0 ? 'warnings' : 'passed',
    headline: validation.errorCount > 0
      ? `${validation.errorCount} blocking validation issue${validation.errorCount === 1 ? '' : 's'}`
      : validation.warningCount > 0
        ? `${validation.warningCount} validation warning${validation.warningCount === 1 ? '' : 's'}`
        : 'Append-only validation passed',
    entryCount: validation.entries.length,
    errorCount: validation.errorCount,
    warningCount: validation.warningCount,
    timestampIntegrity: validation.timestampIntegrity,
    primaryIssue: primaryIssue
      ? {
          code: primaryIssue.code,
          severity: primaryIssue.severity,
          entryIndex: primaryIssue.entryIndex,
          field: primaryIssue.field,
          message: primaryIssue.message,
          route: REPAIRABLE_ISSUE_CODES.has(primaryIssue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept
        }
      : null,
    issueGroups: {
      errors: grouped.error || [],
      warnings: grouped.warning || [],
      informational: grouped.info || []
    }
  };
}

function buildClientReadinessSummary({
  accepted,
  acceptanceRequested,
  boundary,
  clientResume,
  lifecycleState,
  operationalHealth,
  preview,
  proofReceipt,
  providerNegotiation,
  readiness,
  validation,
  workflowHandoff
}) {
  const validationDisplay = summarizeValidationForClient(validation);
  const blockingCodes = validationDisplay.issueGroups.errors.map((issue) => issue.code);
  const proofBlockedBy = proofReceipt.blockedBy || [];
  const providerBlockedBy = [
    ...(providerNegotiation.status === 'negotiated' ? [] : [providerNegotiation.status]),
    ...providerNegotiation.missingRequiredCapabilities.map((capability) => `missing:${capability}`)
  ];
  const operationalBlockedBy = [
    ...(operationalHealth.degradedMode.writeBlocked ? ['write_blocked'] : []),
    ...(operationalHealth.degradedMode.proofExportBlocked ? ['proof_export_blocked'] : []),
    ...(operationalHealth.retry.exhausted ? ['retry_exhausted'] : [])
  ];
  const stages = [
    {
      id: 'preview',
      label: 'Preview',
      route: WORKFLOW_ROUTES.preview,
      ready: readiness.readyForClientPreview,
      status: readiness.readyForClientPreview ? 'ready' : 'blocked',
      blockingReasons: readiness.readyForClientPreview ? [] : ['preview_disabled_by_lifecycle'],
      evidence: {
        entryCount: preview.entryCount,
        latestDigest: preview.latestDigest,
        issueCount: preview.issueCount
      }
    },
    {
      id: 'validation',
      label: 'Validation',
      route: WORKFLOW_ROUTES.validate,
      ready: validation.errorCount === 0,
      status: validationDisplay.status,
      blockingReasons: blockingCodes,
      evidence: {
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        primaryIssue: validationDisplay.primaryIssue
      }
    },
    {
      id: 'acceptance',
      label: 'Acceptance',
      route: WORKFLOW_ROUTES.accept,
      ready: !accepted
        && validation.errorCount === 0
        && lifecycleState.canAcceptNow
        && providerNegotiation.status === 'negotiated'
        && operationalHealth.degradedMode.writeBlocked === false,
      status: accepted ? 'complete' : acceptanceRequested ? 'requested' : 'available',
      blockingReasons: [
        ...(accepted ? ['already_accepted'] : []),
        ...blockingCodes,
        ...(!lifecycleState.canAcceptNow ? ['lifecycle_not_accepting'] : []),
        ...providerBlockedBy,
        ...(operationalHealth.degradedMode.writeBlocked ? ['write_blocked'] : []),
        ...(!boundary.canAccept ? ['acceptance_permission_denied'] : [])
      ],
      evidence: {
        requested: acceptanceRequested,
        canAcceptBoundary: boundary.canAccept,
        lifecycleStatus: lifecycleState.status,
        providerStatus: providerNegotiation.status
      }
    },
    {
      id: 'proof',
      label: 'Proof',
      route: WORKFLOW_ROUTES.proof,
      ready: proofReceipt.canExport,
      status: proofReceipt.status,
      blockingReasons: proofBlockedBy,
      evidence: {
        proofContract: proofReceipt.proofContract,
        latestDigest: proofReceipt.manifest.latestDigest,
        signerAvailable: proofReceipt.signerRequest.signerAvailable
      }
    },
    {
      id: 'resume',
      label: 'Resume',
      route: clientResume.resumeRequest.route,
      ready: clientResume.canSubmit,
      status: clientResume.status,
      blockingReasons: clientResume.blockedBy.map((issue) => issue.code),
      evidence: {
        token: clientResume.token,
        expiresOnDigestChange: clientResume.expiresOnDigestChange,
        pendingInputs: clientResume.pendingInputs
      }
    }
  ];
  const blockedStages = stages.filter((stage) => !stage.ready && stage.status !== 'complete');
  const firstBlocked = blockedStages[0] || null;

  return {
    type: 'AppendOnlyAuditRecoveryClientReadinessSummary.v1',
    status: readiness.status,
    ready: blockedStages.length === 0 || (accepted && proofReceipt.canExport),
    activeRoute: workflowHandoff.route,
    activeView: workflowHandoff.state,
    stages,
    validation: validationDisplay,
    operationalBlockers: operationalBlockedBy,
    providerBlockers: providerBlockedBy,
    firstBlockedStage: firstBlocked
      ? {
          id: firstBlocked.id,
          route: firstBlocked.route,
          blockingReasons: firstBlocked.blockingReasons
        }
      : null,
    recommendedRoute: firstBlocked
      ? firstBlocked.route
      : proofReceipt.canExport
        ? WORKFLOW_ROUTES.proof
        : accepted
          ? WORKFLOW_ROUTES.proof
          : WORKFLOW_ROUTES.accept,
    routeContracts: {
      preview: 'AppendOnlyAuditRecoveryPreviewPanel.v1',
      validate: 'AppendOnlyAuditRecoveryClientValidationSummary.v1',
      accept: 'AppendOnlyAuditRecoveryAcceptancePanel.v1',
      proof: proofReceipt.proofContract,
      resume: clientResume.resumeRequest.bodyContract
    }
  };
}

function buildClientWorkflowContract({
  accepted,
  acceptanceRequested,
  boundary,
  clientResume,
  clientReadinessSummary,
  commandSemantics,
  lifecycleState,
  nextSteps,
  operationalHealth,
  preview,
  proofReceipt,
  providerNegotiation,
  readiness,
  validation,
  workflowHandoff
}) {
  const validationDisplay = summarizeValidationForClient(validation);
  const blockingCodes = validationDisplay.issueGroups.errors.map((issue) => issue.code);
  const acceptEnabled = !accepted
    && validation.errorCount === 0
    && lifecycleState.canAcceptNow
    && boundary.canAccept
    && providerNegotiation.status === 'negotiated'
    && !operationalHealth.degradedMode.writeBlocked;
  const proofEnabled = readiness.readyForProofExport && operationalHealth.degradedMode.proofExportBlocked === false;
  const activeStep = nextSteps[0] || null;

  return {
    type: 'AppendOnlyAuditRecoveryClientWorkflow.v1',
    activeView: workflowHandoff.state,
    activeRoute: workflowHandoff.route,
    resume: clientResume,
    validationDisplay,
    readinessSummary: clientReadinessSummary,
    previewPanel: {
      contract: 'AppendOnlyAuditRecoveryPreviewPanel.v1',
      visible: preview.visible,
      status: validation.errorCount > 0 ? 'needs_repair' : accepted ? 'accepted' : 'ready_for_acceptance',
      summary: `${preview.entryCount} append-only entr${preview.entryCount === 1 ? 'y' : 'ies'}; latest digest ${preview.latestDigest || 'pending'}`,
      latest: {
        digest: preview.latestDigest,
        timestamp: preview.latestTimestamp,
        action: preview.latestAction
      },
      issueCount: preview.issueCount,
      timestampIntegrity: preview.timestampIntegrity,
      rows: preview.rows
    },
    acceptancePanel: {
      contract: 'AppendOnlyAuditRecoveryAcceptancePanel.v1',
      requested: acceptanceRequested,
      accepted,
      enabled: acceptEnabled,
      route: WORKFLOW_ROUTES.accept,
      method: 'POST',
      command: 'accept',
      idempotencyKey: commandSemantics.idempotencyKey,
      requiredInputs: ['acceptance.requestedBy', 'acceptance.reason'],
      disabledReasons: acceptEnabled
        ? []
        : [
            ...(accepted ? ['already_accepted'] : []),
            ...(validation.errorCount > 0 ? blockingCodes : []),
            ...(!boundary.canAccept ? ['acceptance_permission_denied'] : []),
            ...(!lifecycleState.canAcceptNow ? ['lifecycle_not_accepting'] : []),
            ...(providerNegotiation.status !== 'negotiated' ? [providerNegotiation.status] : []),
            ...(operationalHealth.degradedMode.writeBlocked ? ['write_blocked'] : [])
          ]
    },
    routePayloads: {
      preview: {
        route: WORKFLOW_ROUTES.preview,
        method: 'GET',
        responseContract: 'AppendOnlyAuditRecoveryPreviewPanel.v1',
        ready: readiness.readyForClientPreview
      },
      validate: {
        route: WORKFLOW_ROUTES.validate,
        method: 'POST',
        bodyContract: 'AppendOnlyAuditRecoveryValidationRequest',
        responseContract: 'AppendOnlyAuditRecoveryClientValidationSummary.v1',
        ready: workflowHandoff.state === 'repair' || validation.warningCount > 0,
        repairableIssueCodes: validation.issues
          .filter((issue) => REPAIRABLE_ISSUE_CODES.has(issue.code))
          .map((issue) => issue.code)
      },
      accept: {
        route: WORKFLOW_ROUTES.accept,
        method: 'POST',
        bodyContract: 'AppendOnlyAuditRecoveryAcceptanceRequest',
        responseContract: 'AppendOnlyAuditRecoveryAcceptancePanel.v1',
        ready: acceptEnabled
      },
      proof: {
        route: WORKFLOW_ROUTES.proof,
        method: 'POST',
        bodyContract: 'AppendOnlyAuditRecoveryProofRequest',
        responseContract: proofReceipt.proofContract,
        receiptContract: proofReceipt.type,
        ready: proofEnabled,
        blockedBy: proofReceipt.blockedBy
      }
    },
    nextAction: activeStep
      ? {
          id: activeStep.id,
          label: activeStep.label,
          reason: activeStep.reason,
          route: activeStep.route,
          requiredInputs: activeStep.requiredInputs,
          canSubmit: activeStep.route === WORKFLOW_ROUTES.accept
            ? acceptEnabled
            : activeStep.route === WORKFLOW_ROUTES.proof
              ? proofEnabled
              : true
        }
      : null
  };
}

function buildWorkflowHandoffDecision({
  accepted,
  clientResume,
  clientWorkflow,
  lifecycleState,
  now,
  operationalHealth,
  proofReceipt,
  providerNegotiation,
  readiness,
  statePersistence,
  validation,
  workflowHandoff
}) {
  const validationErrors = validation.issues.filter((issue) => issue.severity === 'error');
  const providerBlocked = providerNegotiation.status !== 'negotiated';
  const writeBlocked = operationalHealth.degradedMode.writeBlocked;
  const proofBlocked = operationalHealth.degradedMode.proofExportBlocked || proofReceipt.blockedBy.length > 0;
  const blockedCodes = Array.from(new Set([
    ...workflowHandoff.blockedBy.map((issue) => issue.code),
    ...validationErrors.map((issue) => issue.code),
    ...(providerBlocked ? [providerNegotiation.status] : []),
    ...(writeBlocked ? ['write_blocked'] : []),
    ...(accepted && proofBlocked ? proofReceipt.blockedBy : []),
    ...(!readiness.restartSafe ? [statePersistence.restartSafeStatus] : [])
  ].filter(Boolean)));
  const primaryRoute = validationErrors.length > 0
    ? WORKFLOW_ROUTES.validate
    : accepted
      ? WORKFLOW_ROUTES.proof
      : clientWorkflow.acceptancePanel.enabled
        ? WORKFLOW_ROUTES.accept
        : workflowHandoff.route;
  const primaryCommand = primaryRoute === WORKFLOW_ROUTES.proof
    ? 'export-proof'
    : primaryRoute === WORKFLOW_ROUTES.accept
      ? 'accept'
      : validationErrors.length > 0
        ? 'recover'
        : 'preview';
  const submitAllowed = blockedCodes.length === 0
    && (primaryRoute !== WORKFLOW_ROUTES.accept || clientWorkflow.acceptancePanel.enabled)
    && (primaryRoute !== WORKFLOW_ROUTES.proof || proofReceipt.canExport);
  const operatorPrompt = validationErrors.length > 0
    ? 'Repair audit evidence before continuing.'
    : providerBlocked
      ? 'Resolve provider negotiation before continuing.'
      : writeBlocked
        ? 'Restore hosted-kernel audit writes before acceptance.'
        : accepted && proofReceipt.canExport
          ? 'Export the accepted recovery proof.'
          : clientWorkflow.acceptancePanel.enabled
            ? 'Accept the append-only preview.'
            : 'Continue from the current hosted-kernel workflow state.';

  return {
    type: 'AppendOnlyAuditRecoveryWorkflowHandoffDecision.v1',
    decidedAt: now,
    state: workflowHandoff.state,
    route: primaryRoute,
    target: workflowHandoff.target,
    command: primaryCommand,
    status: submitAllowed
      ? 'ready'
      : validationErrors.length > 0
        ? 'repair_required'
        : providerBlocked
          ? 'provider_blocked'
          : writeBlocked || proofBlocked
            ? 'runtime_blocked'
            : 'awaiting_input',
    operatorPrompt,
    submitPolicy: {
      method: primaryRoute === WORKFLOW_ROUTES.preview ? 'GET' : 'POST',
      allowed: submitAllowed,
      idempotent: primaryCommand !== 'preview',
      idempotencyKey: clientWorkflow.acceptancePanel.idempotencyKey,
      requiresRestartSafeState: true,
      restartSafe: readiness.restartSafe,
      restartSafeStatus: statePersistence.restartSafeStatus
    },
    preflight: {
      validationPassed: validation.errorCount === 0,
      lifecycleAccepting: lifecycleState.canAcceptNow,
      providerNegotiated: providerNegotiation.status === 'negotiated',
      writesAvailable: !writeBlocked,
      proofExportable: proofReceipt.canExport,
      resumeSubmittable: clientResume.canSubmit
    },
    resume: {
      token: clientResume.token,
      route: clientResume.resumeRequest.route,
      bodyContract: clientResume.resumeRequest.bodyContract,
      pendingInputs: clientResume.pendingInputs,
      canSubmit: clientResume.canSubmit
    },
    outboundPayload: {
      contract: primaryRoute === WORKFLOW_ROUTES.validate
        ? 'AppendOnlyAuditRecoveryValidationRequest'
        : primaryRoute === WORKFLOW_ROUTES.accept
          ? 'AppendOnlyAuditRecoveryAcceptanceRequest'
          : primaryRoute === WORKFLOW_ROUTES.proof
            ? proofReceipt.proofContract
            : 'AppendOnlyAuditRecoveryPreviewPanel.v1',
      route: primaryRoute,
      command: primaryCommand,
      expectedLatestDigest: proofReceipt.manifest.latestDigest,
      expectedEntryCount: validation.entries.length,
      storageKey: statePersistence.committedView.storageKey,
      continuationToken: clientResume.token
    },
    blockedBy: blockedCodes.map((code) => ({ code, route: primaryRoute }))
  };
}

function buildOperatorRemediationPacket({
  clientReadinessSummary,
  commandSemantics,
  lifecycleState,
  now,
  operationalHealth,
  proofReceipt,
  providerNegotiation,
  readiness,
  statePersistence,
  validation,
  workflowHandoffDecision
}) {
  const issueActions = validation.issues
    .filter((issue) => issue.severity === 'error' || REPAIRABLE_ISSUE_CODES.has(issue.code))
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      entryIndex: issue.entryIndex,
      field: issue.field,
      route: REPAIRABLE_ISSUE_CODES.has(issue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept,
      repairable: REPAIRABLE_ISSUE_CODES.has(issue.code),
      message: issue.message
    }));
  const providerActions = [
    ...providerNegotiation.missingRequiredCapabilities.map((capability) => ({
      code: `missing_provider_capability:${capability}`,
      severity: 'error',
      route: WORKFLOW_ROUTES.validate,
      owner: 'provider',
      action: 'negotiate-provider-capability',
      capability
    })),
    ...(providerNegotiation.status !== 'negotiated'
      ? [{
          code: providerNegotiation.status,
          severity: 'error',
          route: WORKFLOW_ROUTES.validate,
          owner: 'provider',
          action: providerNegotiation.status === 'sync_cursor_stale'
            ? 'refresh-sync-cursor'
            : providerNegotiation.status === 'handoff_not_acknowledged'
              ? 'acknowledge-external-handoff'
              : 'repair-provider-contract'
        }]
      : [])
  ];
  const healthActions = operationalHealth.actionableErrors.map((error) => ({
    code: error.code,
    severity: error.severity,
    route: error.route,
    owner: error.dependency || 'hosted-kernel',
    action: error.action,
    retryable: error.retryable,
    retryAfterMs: operationalHealth.retry.nextDelayMs,
    degradedMode: operationalHealth.degradedMode.recoveryMode
  }));
  const restartActions = readiness.restartSafe
    ? []
    : [{
        code: statePersistence.restartSafeStatus,
        severity: 'error',
        route: WORKFLOW_ROUTES.accept,
        owner: 'command-journal',
        action: statePersistence.restartRecovery.action,
        resumeWriteFrom: statePersistence.restartRecovery.resumeWriteFrom,
        replayFromEntryIndex: statePersistence.restartRecovery.replayFromEntryIndex
      }];
  const actions = [...issueActions, ...providerActions, ...healthActions, ...restartActions];
  const blockingActionCodes = [...new Set(actions
    .filter((action) => action.severity === 'error')
    .map((action) => action.code))];
  const nextRetryAt = operationalHealth.retry.nextDelayMs
    ? millisecondsAfter(now, operationalHealth.retry.nextDelayMs)
    : null;
  const canSelfRecover = blockingActionCodes.length === 0
    || actions.every((action) => action.retryable || action.repairable);
  const commandRoute = workflowHandoffDecision.route;

  return {
    type: 'AppendOnlyAuditRecoveryOperatorRemediationPacket.v1',
    generatedAt: now,
    status: workflowHandoffDecision.status === 'ready'
      ? 'ready'
      : canSelfRecover
        ? 'recoverable'
        : 'operator_action_required',
    primaryRoute: commandRoute,
    primaryCommand: workflowHandoffDecision.command,
    operatorPrompt: workflowHandoffDecision.operatorPrompt,
    blockingActionCodes,
    canSelfRecover,
    degradedMode: {
      active: operationalHealth.degradedMode.active,
      recoveryMode: operationalHealth.degradedMode.recoveryMode,
      fallbackRoute: operationalHealth.degradedMode.fallbackRoute,
      allowedOperations: operationalHealth.degradedMode.allowedOperations
    },
    retryPlan: {
      strategy: operationalHealth.retry.strategy,
      safeToRetry: operationalHealth.retry.safeToRetry,
      exhausted: operationalHealth.retry.exhausted,
      currentAttempt: operationalHealth.retry.currentAttempt,
      maxAttempts: operationalHealth.retry.maxAttempts,
      nextDelayMs: operationalHealth.retry.nextDelayMs,
      nextRetryAt,
      reason: operationalHealth.retry.reason
    },
    readiness: {
      status: readiness.status,
      restartSafe: readiness.restartSafe,
      firstBlockedStage: clientReadinessSummary.firstBlockedStage,
      recommendedRoute: clientReadinessSummary.recommendedRoute
    },
    proofGate: {
      canExport: proofReceipt.canExport,
      status: proofReceipt.status,
      blockedBy: proofReceipt.blockedBy,
      latestDigest: proofReceipt.manifest.latestDigest
    },
    lifecycleGate: {
      status: lifecycleState.status,
      canAcceptNow: lifecycleState.canAcceptNow,
      nextAction: lifecycleState.nextAction
    },
    commandReplay: {
      command: commandSemantics.command,
      status: commandSemantics.status,
      idempotencyKey: commandSemantics.idempotencyKey,
      restartSafeStatus: statePersistence.restartSafeStatus,
      requiredWriteCount: statePersistence.requiredWrites.length,
      replayAction: statePersistence.restartRecovery.action
    },
    actions,
    submitPolicy: workflowHandoffDecision.submitPolicy
  };
}

function buildClientResumeContract({
  continuationCheckpoint,
  commandSemantics,
  latestEntry,
  now,
  persistedStateShape,
  requestState,
  resumeEnvelope,
  validation,
  workflowHandoff
}) {
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const latestTimestamp = latestEntry ? latestEntry.timestamp : null;
  const staleIssues = validation.issues.filter((issue) => (
    issue.code === 'stale_client_resume_digest'
    || issue.code === 'stale_client_resume_entry_count'
    || issue.code === 'invalid_client_resume_route'
    || issue.code === 'invalid_client_resume_expiry'
    || issue.code === 'expired_client_resume_token'
    || issue.code === 'stale_client_resume_workflow_state'
    || issue.code === 'stale_client_resume_runtime'
    || issue.code === 'stale_client_resume_request'
    || issue.code === 'stale_client_resume_fingerprint'
  ));
  const issuedToken = resumeEnvelope.token
    || requestState.continuationToken
    || [
      surfaceId,
      workflowHandoff.state,
      requestState.clientRequestId || requestState.runtimeId || 'anonymous',
      latestDigest || 'pending'
    ].join(':');
  const resumeRoute = resumeEnvelope.expectedRoute && Object.values(WORKFLOW_ROUTES).includes(resumeEnvelope.expectedRoute)
    ? resumeEnvelope.expectedRoute
    : workflowHandoff.route;
  const handoffStatus = staleIssues.length > 0
    ? 'stale'
    : validation.errorCount > 0 && workflowHandoff.state !== 'repair'
      ? 'blocked'
      : workflowHandoff.canContinue
        ? 'ready'
        : 'awaiting_input';
  const requiredBody = {
    contract: workflowHandoff.resume.bodyContract,
    continuationToken: issuedToken,
    clientRequestId: requestState.clientRequestId || resumeEnvelope.clientRequestId,
    runtimeId: requestState.runtimeId || resumeEnvelope.issuedByRuntimeId,
    idempotencyKey: commandSemantics.idempotencyKey,
    expectedLatestDigest: latestDigest,
    expectedEntryCount: validation.entries.length,
    route: resumeRoute,
    expectedWorkflowState: workflowHandoff.state,
    expectedFingerprint: continuationCheckpoint?.fingerprint || null,
    expiresAt: continuationCheckpoint?.expiresAt || null
  };

  return {
    type: 'AppendOnlyAuditRecoveryClientResumeContract.v1',
    status: handoffStatus,
    token: issuedToken,
    issuedAt: now,
    expiresOnDigestChange: true,
    checkpoint: continuationCheckpoint,
    expectedState: {
      latestDigest,
      latestTimestamp,
      entryCount: validation.entries.length,
      checkpointStorageKey: persistedStateShape.storageKey,
      workflowState: workflowHandoff.state,
      route: resumeRoute,
      fingerprint: continuationCheckpoint?.fingerprint || null,
      expiresAt: continuationCheckpoint?.expiresAt || null
    },
    submittedState: {
      token: resumeEnvelope.token,
      latestDigest: resumeEnvelope.expectedLatestDigest,
      entryCount: resumeEnvelope.expectedEntryCount,
      route: resumeEnvelope.expectedRoute,
      requestedAt: resumeEnvelope.requestedAt,
      runtimeId: resumeEnvelope.issuedByRuntimeId,
      nonce: resumeEnvelope.nonce,
      workflowState: resumeEnvelope.expectedWorkflowState,
      fingerprint: resumeEnvelope.expectedFingerprint,
      expiresAt: resumeEnvelope.expiresAt
    },
    resumeRequest: {
      method: workflowHandoff.resume.method,
      route: resumeRoute,
      bodyContract: workflowHandoff.resume.bodyContract,
      body: requiredBody
    },
    handoffTarget: workflowHandoff.target,
    canSubmit: handoffStatus === 'ready',
    pendingInputs: workflowHandoff.pendingInputs,
    blockedBy: [
      ...workflowHandoff.blockedBy,
      ...staleIssues.map((issue) => ({
        code: issue.code,
        entryIndex: issue.entryIndex,
        field: issue.field,
        expected: issue.expected,
        actual: issue.actual
      }))
    ]
  };
}

function selectWorkflowView(validation, accepted, requestState) {
  if (validation.errorCount > 0) return 'repair';
  if (accepted) return 'proof';
  if (requestState.requestedView === 'acceptance' || requestState.optimisticAccept) return 'acceptance';
  return requestState.requestedView || 'preview';
}

function buildWorkflowHandoff(validation, accepted, requestState, latestEntry) {
  const view = selectWorkflowView(validation, accepted, requestState);
  const routeByView = {
    preview: WORKFLOW_ROUTES.preview,
    acceptance: WORKFLOW_ROUTES.accept,
    proof: WORKFLOW_ROUTES.proof,
    repair: WORKFLOW_ROUTES.validate
  };
  const blockingIssues = validation.issues.filter((issue) => issue.severity === 'error');
  const pendingInputs = [];

  if (view === 'repair') {
    pendingInputs.push(...REQUIRED_ENTRY_FIELDS.map((field) => `entries[].${field}`));
  } else if (view === 'acceptance' && !accepted) {
    pendingInputs.push('acceptance.requestedBy');
  } else if (view === 'proof' && !(latestEntry && latestEntry.digest)) {
    pendingInputs.push('proof.latestDigest');
  }

  return {
    state: view,
    route: routeByView[view],
    sourceRoute: requestState.sourceRoute,
    target: requestState.handoffTarget || (accepted ? 'recovery-proof-export' : 'hosted-kernel-client'),
    continuationToken: requestState.continuationToken,
    clientRequestId: requestState.clientRequestId,
    runtimeId: requestState.runtimeId,
    actor: requestState.actor,
    canContinue: blockingIssues.length === 0 && pendingInputs.length === 0,
    pendingInputs,
    blockedBy: blockingIssues.map((issue) => ({
      code: issue.code,
      entryIndex: issue.entryIndex,
      field: issue.field
    })),
    resume: {
      method: 'POST',
      route: routeByView[view],
      bodyContract: view === 'repair'
        ? 'AppendOnlyAuditRecoveryValidationRequest'
        : view === 'acceptance'
          ? 'AppendOnlyAuditRecoveryAcceptanceRequest'
          : 'AppendOnlyAuditRecoveryProofRequest'
    }
  };
}

function buildIdempotencyKey(requestState, command, latestEntry) {
  const digestPart = latestEntry && latestEntry.digest ? latestEntry.digest : 'no-digest';
  const requestPart = requestState.clientRequestId || requestState.continuationToken || requestState.runtimeId || 'anonymous';
  return `${surfaceId}:${command}:${requestPart}:${digestPart}`;
}

function findJournalCommand(persistedState, idempotencyKey) {
  return persistedState.commandJournal.find((command) => command.idempotencyKey === idempotencyKey) || null;
}

function findCompletedCommand(persistedState, idempotencyKey) {
  const command = findJournalCommand(persistedState, idempotencyKey);
  return command && COMMAND_TERMINAL_STATUSES.has(command.status) ? command : null;
}

function buildPersistedCommandReplayPlan({ command, entryCount, idempotencyKey, latestDigest, now, persistedState }) {
  const journalCommand = findJournalCommand(persistedState, idempotencyKey);
  const sameDigestCommands = persistedState.commandJournal.filter((item) => (
    item.idempotencyKey !== idempotencyKey
    && item.command === command
    && item.latestDigest === latestDigest
    && item.entryCount === entryCount
  ));
  const phase = journalCommand && COMMAND_WRITE_PHASES.has(journalCommand.writePhase)
    ? journalCommand.writePhase
    : journalCommand
      ? 'journal'
      : 'none';
  const lockExpired = Boolean(
    journalCommand
    && journalCommand.lockedUntil
    && Number.isFinite(Date.parse(journalCommand.lockedUntil))
    && Date.parse(journalCommand.lockedUntil) <= Date.parse(now)
  );
  const terminal = Boolean(journalCommand && COMMAND_TERMINAL_STATUSES.has(journalCommand.status));
  const inFlight = Boolean(journalCommand && COMMAND_IN_FLIGHT_STATUSES.has(journalCommand.status));
  const digestConflict = Boolean(
    journalCommand
    && latestDigest
    && journalCommand.latestDigest
    && journalCommand.latestDigest !== latestDigest
  );
  const entryCountConflict = Boolean(
    journalCommand
    && Number.isInteger(journalCommand.entryCount)
    && journalCommand.entryCount !== entryCount
  );
  const status = !journalCommand
    ? 'new_command'
    : digestConflict || entryCountConflict
      ? 'conflict'
      : terminal
        ? 'terminal_replay'
        : inFlight && lockExpired
          ? 'interrupted_replay'
          : inFlight
            ? 'in_flight'
            : 'unknown_journal_state';
  const resumeWriteFrom = phase === 'completed' || terminal
    ? null
    : phase === 'accepted-snapshot'
      ? 'proof-export'
      : phase === 'checkpoint'
        ? 'accepted-snapshot'
        : 'checkpoint';

  return {
    type: 'AppendOnlyAuditRecoveryCommandReplayPlan.v1',
    status,
    idempotencyKey,
    command,
    latestDigest,
    entryCount,
    journalCommand,
    terminal,
    inFlight,
    lockExpired,
    digestConflict,
    entryCountConflict,
    sameDigestCommandKeys: sameDigestCommands.map((item) => item.idempotencyKey),
    resumeWriteFrom,
    restartAction: status === 'terminal_replay'
      ? 'return_prior_result'
      : status === 'interrupted_replay'
        ? `resume_from_${resumeWriteFrom}`
        : status === 'in_flight'
          ? 'wait_for_active_writer_or_retry_after_lease'
          : status === 'conflict'
            ? 'reject_conflicting_idempotency_reuse'
            : 'start_new_command',
    priorResult: journalCommand
      ? {
          status: journalCommand.status,
          resultMode: journalCommand.resultMode,
          recoveryAction: journalCommand.recoveryAction,
          storageKey: journalCommand.storageKey,
          completedAt: journalCommand.completedAt,
          writePhase: journalCommand.writePhase,
          attempt: journalCommand.attempt,
          lastErrorCode: journalCommand.lastErrorCode
        }
      : null
  };
}

function buildPersistedStateShape({
  accepted,
  acceptanceRequested,
  boundaryContext,
  input,
  latestEntry,
  now,
  persistedState,
  validation
}) {
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const checkpointMatches = Boolean(
    persistedState.checkpoint.latestDigest
    && latestDigest
    && persistedState.checkpoint.latestDigest === latestDigest
  );
  const acceptedSnapshotMatches = Boolean(
    persistedState.acceptedSnapshot.latestDigest
    && latestDigest
    && persistedState.acceptedSnapshot.latestDigest === latestDigest
  );
  const restartStatus = validation.errorCount > 0
    ? 'repair_required'
    : accepted || acceptedSnapshotMatches
      ? 'accepted_snapshot_available'
      : checkpointMatches
        ? 'checkpoint_replay_required'
        : persistedState.checkpoint.latestDigest
          ? 'checkpoint_stale'
          : 'cold_start';
  const acceptedAt = accepted
    ? now
    : acceptedSnapshotMatches
      ? persistedState.acceptedSnapshot.acceptedAt
      : null;

  return {
    schema: 'AppendOnlyAuditRecoveryPersistedState.v1',
    storageKey: [
      surfaceId,
      boundaryContext.tenantId || 'tenant-unscoped',
      boundaryContext.workspaceId || 'workspace-unscoped',
      latestDigest || 'pending'
    ].join(':'),
    restartStatus,
    scope: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      scopeKey: `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`,
      enforced: boundaryContext.enforced
    },
    checkpoint: {
      latestDigest,
      entryCount: validation.entries.length,
      acceptedAt,
      mode: accepted || acceptedSnapshotMatches ? 'accepted' : validation.errorCount > 0 ? 'needs_repair' : 'preview',
      source: checkpointMatches ? 'persisted' : 'rebuilt_from_evidence'
    },
    acceptedSnapshot: {
      reusable: acceptedSnapshotMatches && validation.errorCount === 0,
      latestDigest: accepted || acceptedSnapshotMatches ? latestDigest : null,
      entryCount: accepted || acceptedSnapshotMatches ? validation.entries.length : null,
      acceptedAt,
      requestedBy: accepted
        ? String(input.acceptance.requestedBy)
        : persistedState.acceptedSnapshot.requestedBy,
      proofRoute: accepted || acceptedSnapshotMatches ? WORKFLOW_ROUTES.proof : null
    },
    replayCursor: {
      nextEntryIndex: validation.errorCount > 0 ? null : validation.entries.length,
      latestDigest,
      canResumeAppend: validation.errorCount === 0 && Boolean(latestDigest)
    },
    observed: {
      hadPersistedCheckpoint: Boolean(persistedState.checkpoint.latestDigest),
      hadAcceptedSnapshot: Boolean(persistedState.acceptedSnapshot.latestDigest),
      acceptanceRequested
    }
  };
}

function buildCommandSemantics({
  accepted,
  boundaryContext,
  latestEntry,
  now,
  persistedState,
  requestState,
  validation
}) {
  const command = validation.errorCount > 0
    ? 'recover'
    : accepted
      ? 'export-proof'
      : requestState.requestedView === 'acceptance' || requestState.optimisticAccept
        ? 'accept'
        : 'preview';
  const idempotencyKey = buildIdempotencyKey(requestState, command, latestEntry);
  const replayPlan = buildPersistedCommandReplayPlan({
    command,
    entryCount: validation.entries.length,
    idempotencyKey,
    latestDigest: latestEntry ? latestEntry.digest : null,
    now,
    persistedState
  });
  const completed = replayPlan.status === 'terminal_replay' ? replayPlan.journalCommand : null;
  const status = replayPlan.status === 'conflict'
    ? 'conflict'
    : replayPlan.status === 'in_flight'
      ? 'in_flight'
      : replayPlan.status === 'interrupted_replay'
        ? 'resume_required'
        : completed
          ? 'replayed'
          : validation.errorCount > 0
            ? 'blocked'
            : accepted
              ? 'completed'
              : 'pending';

  return {
    type: 'AppendOnlyAuditRecoveryCommand.v1',
    command,
    idempotencyKey,
    status,
    replayedFromJournal: Boolean(completed),
    safeToRetry: !['completed', 'replayed', 'conflict', 'in_flight'].includes(status),
    latestDigest: latestEntry ? latestEntry.digest : null,
    boundaryKey: `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`,
    resultMode: completed ? completed.resultMode : null,
    acceptedCompletionAt: completed ? completed.completedAt : null,
    replayPlan,
    allowedCommands: Array.from(KNOWN_COMMANDS),
    conflictPolicy: 'same idempotencyKey returns prior terminal result; interrupted writes resume from the recorded writePhase; digest or entry-count reuse is rejected'
  };
}

function buildStatePersistenceEnvelope({
  accepted,
  acceptanceRequested,
  commandSemantics,
  latestEntry,
  now,
  persistedState,
  persistedStateShape,
  validation
}) {
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const commandReplay = commandSemantics.replayPlan;
  const replayedCommand = commandReplay.status === 'terminal_replay'
    ? commandReplay.journalCommand
    : findCompletedCommand(persistedState, commandSemantics.idempotencyKey);
  const validationBlocked = validation.errorCount > 0;
  const commandConflict = commandReplay.status === 'conflict';
  const activeCommandLease = commandReplay.status === 'in_flight';
  const interruptedReplay = commandReplay.status === 'interrupted_replay';
  const commandWriteBlocked = validationBlocked || commandConflict || activeCommandLease;
  const checkpointAlreadyWritten = interruptedReplay
    && ['checkpoint', 'accepted-snapshot', 'proof-export'].includes(commandReplay.journalCommand.writePhase);
  const snapshotAlreadyWritten = interruptedReplay
    && ['accepted-snapshot', 'proof-export'].includes(commandReplay.journalCommand.writePhase);
  const checkpointWriteRequired = !commandWriteBlocked
    && !persistedStateShape.acceptedSnapshot.reusable
    && persistedStateShape.checkpoint.source !== 'persisted'
    && !checkpointAlreadyWritten;
  const acceptanceWriteRequired = accepted
    && !persistedStateShape.acceptedSnapshot.reusable
    && !snapshotAlreadyWritten
    && !commandWriteBlocked;
  const commandStatus = replayedCommand
    ? 'replayed'
    : commandConflict
      ? 'conflict'
      : activeCommandLease
        ? 'in_flight'
        : interruptedReplay
          ? 'started'
    : validationBlocked
      ? 'blocked'
      : accepted || commandSemantics.command === 'export-proof'
        ? 'completed'
        : 'pending';
  const journalEntry = {
    contract: 'AppendOnlyAuditRecoveryCommandJournalEntry.v1',
    idempotencyKey: commandSemantics.idempotencyKey,
    command: commandSemantics.command,
    status: commandStatus,
    latestDigest,
    entryCount: validation.entries.length,
    storageKey: persistedStateShape.storageKey,
    startedAt: replayedCommand ? replayedCommand.startedAt : now,
    completedAt: commandStatus === 'completed'
      ? now
      : replayedCommand
        ? replayedCommand.completedAt
        : null,
    writePhase: commandStatus === 'completed'
      ? 'completed'
      : interruptedReplay
        ? commandReplay.journalCommand.writePhase
        : checkpointWriteRequired
          ? 'journal'
          : acceptanceWriteRequired
            ? 'checkpoint'
            : 'journal',
    attempt: interruptedReplay && commandReplay.journalCommand
      ? commandReplay.journalCommand.attempt + 1
      : 1,
    leaseToken: interruptedReplay && commandReplay.journalCommand
      ? commandReplay.journalCommand.leaseToken
      : null,
    lockedUntil: interruptedReplay && commandReplay.journalCommand
      ? commandReplay.journalCommand.lockedUntil
      : null,
    lastHeartbeatAt: interruptedReplay && commandReplay.journalCommand
      ? commandReplay.journalCommand.lastHeartbeatAt
      : null,
    resultMode: accepted
      ? 'accepted_snapshot'
      : persistedStateShape.acceptedSnapshot.reusable
        ? 'accepted_snapshot_reuse'
        : validationBlocked
          ? 'validation_blocked'
          : 'checkpoint_preview',
    recoveryAction: validationBlocked
      ? 'repair_then_replay_validation'
      : accepted || persistedStateShape.acceptedSnapshot.reusable
        ? 'reuse_snapshot_then_export_proof'
        : 'replay_checkpoint_then_accept'
  };
  const requiredWrites = [];

  if (!replayedCommand && !interruptedReplay && !commandConflict && !activeCommandLease) {
    requiredWrites.push({
      id: 'journal-command',
      operation: 'append-if-absent',
      contract: journalEntry.contract,
      idempotencyKey: commandSemantics.idempotencyKey,
      status: journalEntry.status,
      storageKey: persistedStateShape.storageKey
    });
  }
  if (interruptedReplay) {
    requiredWrites.push({
      id: 'resume-command',
      operation: 'update-if-match',
      contract: journalEntry.contract,
      idempotencyKey: commandSemantics.idempotencyKey,
      storageKey: persistedStateShape.storageKey,
      precondition: `writePhase=${commandReplay.journalCommand.writePhase}`,
      resumeWriteFrom: commandReplay.resumeWriteFrom,
      previousAttempt: commandReplay.journalCommand.attempt,
      nextAttempt: journalEntry.attempt
    });
  }
  if (checkpointWriteRequired) {
    requiredWrites.push({
      id: 'checkpoint',
      operation: 'upsert',
      contract: persistedStateShape.schema,
      storageKey: persistedStateShape.storageKey,
      precondition: 'latestDigest matches validated append-only chain',
      latestDigest,
      entryCount: validation.entries.length
    });
  }
  if (acceptanceWriteRequired) {
    requiredWrites.push({
      id: 'accepted-snapshot',
      operation: 'upsert',
      contract: 'AppendOnlyAuditRecoveryAcceptedSnapshot.v1',
      storageKey: persistedStateShape.storageKey,
      precondition: 'checkpoint write has latestDigest and acceptance is authorized',
      acceptedAt: now,
      latestDigest,
      entryCount: validation.entries.length
    });
  }

  const restartSafeStatus = validationBlocked
    ? 'not_restart_safe_validation_blocked'
    : commandConflict
      ? 'not_restart_safe_idempotency_conflict'
      : activeCommandLease
        ? 'restart_pending_active_writer'
        : interruptedReplay
          ? 'restart_safe_resume_required'
          : replayedCommand || persistedStateShape.acceptedSnapshot.reusable
      ? 'restart_safe_idempotent_replay'
      : accepted
        ? 'restart_safe_after_snapshot_write'
        : checkpointWriteRequired
          ? 'restart_safe_after_checkpoint_write'
          : 'restart_safe_checkpoint_available';

  return {
    type: 'AppendOnlyAuditRecoveryStatePersistenceEnvelope.v1',
    status: commandConflict
      ? 'write_conflict'
      : activeCommandLease
        ? 'write_deferred_active_lease'
        : requiredWrites.length === 0
          ? 'no_write_required'
          : validationBlocked
            ? 'write_blocked'
            : 'writes_required',
    restartSafeStatus,
    idempotencyKey: commandSemantics.idempotencyKey,
    commandReplay,
    journalEntry,
    requiredWrites,
    committedView: {
      storageKey: persistedStateShape.storageKey,
      checkpoint: persistedStateShape.checkpoint,
      acceptedSnapshot: persistedStateShape.acceptedSnapshot,
      replayCursor: persistedStateShape.replayCursor,
      journaledCommandCount: persistedState.commandJournal.length + (replayedCommand ? 0 : 1)
    },
    restartRecovery: {
      route: validationBlocked
        ? WORKFLOW_ROUTES.validate
        : accepted || persistedStateShape.acceptedSnapshot.reusable
          ? WORKFLOW_ROUTES.proof
          : WORKFLOW_ROUTES.accept,
      action: journalEntry.recoveryAction,
      canResumeWithoutRevalidation: validation.errorCount === 0 && Boolean(latestDigest),
      replayFromEntryIndex: persistedStateShape.replayCursor.nextEntryIndex,
      resumeDigest: latestDigest,
      acceptanceRequested,
      replayedFromJournal: Boolean(replayedCommand),
      commandReplayStatus: commandReplay.status,
      resumeWriteFrom: commandReplay.resumeWriteFrom
    }
  };
}

function classifyFailureState({ accepted, commandSemantics, operational, persistedShape, validation }) {
  if (validation.errorCount > 0) return 'validation_blocked';
  if (commandSemantics.status === 'conflict') return 'idempotency_conflict';
  if (commandSemantics.status === 'in_flight') return 'active_command_lease';
  if (commandSemantics.status === 'resume_required') return 'interrupted_command_resume';
  if (!operational.storageReachable) return 'storage_unavailable';
  if (!operational.writerAvailable || operational.readOnly) return 'write_degraded';
  if (accepted && !operational.proofSignerAvailable) return 'proof_signer_unavailable';
  if (commandSemantics.status === 'replayed') return 'idempotent_replay';
  if (persistedShape.restartStatus === 'checkpoint_stale') return 'checkpoint_stale';
  return 'healthy';
}

function buildRetryBackoff({ commandSemantics, failureState, now, operational, validation }) {
  const hasNonRetryableIssue = validation.issues.some((issue) => NON_RETRYABLE_ISSUE_CODES.has(issue.code));
  const retryableFailure = [
    'storage_unavailable',
    'write_degraded',
    'proof_signer_unavailable',
    'checkpoint_stale',
    'interrupted_command_resume'
  ]
    .includes(failureState);
  const retryableObservedFailure = operational.observedFailures.some((failure) => failure.retryable !== false);
  const canRetry = !hasNonRetryableIssue
    && commandSemantics.safeToRetry
    && operational.currentAttempt < operational.maxAttempts
    && (retryableFailure || retryableObservedFailure);
  const attemptExponent = Math.max(0, operational.currentAttempt - 1);
  const declaredRetryAfterMs = operational.observedFailures
    .map((failure) => failure.retryAfterMs)
    .filter((delay) => Number.isInteger(delay) && delay >= 0)
    .sort((left, right) => right - left)[0] ?? null;
  const exponentialDelayMs = Math.min(operational.maxDelayMs, operational.baseDelayMs * (2 ** attemptExponent));
  const nextDelayMs = canRetry
    ? Math.max(exponentialDelayMs, declaredRetryAfterMs ?? 0)
    : null;
  const retryReason = hasNonRetryableIssue
    ? 'non_retryable_validation_issue'
    : !commandSemantics.safeToRetry
      ? 'command_not_safe_to_retry'
      : operational.currentAttempt >= operational.maxAttempts
        ? 'attempts_exhausted'
        : canRetry
          ? declaredRetryAfterMs !== null ? 'observed_failure_retry_after' : 'exponential_backoff'
          : 'no_retryable_failure';

  return {
    strategy: 'exponential_backoff_with_idempotency_key',
    currentAttempt: operational.currentAttempt,
    maxAttempts: operational.maxAttempts,
    nextDelayMs,
    retryAfterMs: nextDelayMs,
    safeToRetry: canRetry,
    idempotencyKey: commandSemantics.idempotencyKey,
    exhausted: !canRetry && operational.currentAttempt >= operational.maxAttempts,
    reason: retryReason,
    retryWindow: {
      notBefore: nextDelayMs === null ? null : millisecondsAfter(now, nextDelayMs),
      delaySource: declaredRetryAfterMs !== null ? 'observed_failure' : 'policy',
      baseDelayMs: operational.baseDelayMs,
      maxDelayMs: operational.maxDelayMs
    },
    blockedBy: hasNonRetryableIssue
      ? validation.issues.filter((issue) => NON_RETRYABLE_ISSUE_CODES.has(issue.code)).map((issue) => issue.code)
      : []
  };
}

function buildActionableErrors({ failureState, operational, validation }) {
  const validationErrors = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      entryIndex: issue.entryIndex,
      field: issue.field,
      action: REPAIRABLE_ISSUE_CODES.has(issue.code)
        ? 'repair_evidence_and_resubmit_validation'
        : 'resolve_scope_or_permission_before_retry',
      route: REPAIRABLE_ISSUE_CODES.has(issue.code) ? WORKFLOW_ROUTES.validate : WORKFLOW_ROUTES.accept
    }));
  const runtimeErrors = operational.observedFailures.map((failure) => {
    const knownFailure = HOSTED_KERNEL_RUNTIME_FAILURES[failure.code];
    return {
      code: failure.code,
      severity: failure.retryable === false || failure.terminal ? 'error' : 'warning',
      message: failure.message || `Hosted kernel reported ${failure.code}.`,
      phase: failure.phase,
      requestedPhase: failure.requestedPhase,
      dependency: failure.dependency,
      observedAt: failure.observedAt,
      retryAfterMs: failure.retryAfterMs,
      action: knownFailure
        ? knownFailure.action
        : failure.retryable === false || failure.terminal
          ? 'operator_intervention_required'
          : 'retry_with_backoff',
      route: knownFailure ? knownFailure.route : WORKFLOW_ROUTES.validate
    };
  });
  const malformedRuntimeSignals = operational.invalidFailureSignals.map((signal) => ({
    code: `invalid_operational_failure_signal:${signal.code}`,
    severity: 'warning',
    message: `Hosted-kernel operational failure signal is malformed: ${signal.reason}.`,
    phase: signal.phase,
    observedAt: signal.observedAt,
    action: 'repair_runtime_failure_signal_contract',
    route: WORKFLOW_ROUTES.validate
  }));

  if (failureState === 'healthy' || failureState === 'idempotent_replay') {
    return [...validationErrors, ...runtimeErrors, ...malformedRuntimeSignals];
  }

  return [
    {
      code: failureState,
      severity: ['checkpoint_stale', 'active_command_lease', 'interrupted_command_resume'].includes(failureState)
        ? 'warning'
        : 'error',
      message: `Append-only audit recovery is in ${failureState}.`,
      action: failureState === 'idempotency_conflict'
        ? 'submit_with_new_idempotency_key_or_original_digest'
        : failureState === 'active_command_lease'
          ? 'wait_for_active_writer_or_retry_after_lease'
          : failureState === 'interrupted_command_resume'
            ? 'resume_persisted_command_from_recorded_write_phase'
            : failureState === 'storage_unavailable'
              ? 'restore_audit_storage_then_retry'
              : failureState === 'proof_signer_unavailable'
                ? 'restore_proof_signer_before_export'
                : failureState === 'write_degraded'
                  ? 'resume_writer_or_use_preview_only_degraded_mode'
                  : 'repair_evidence_and_resubmit_validation',
      route: failureState === 'proof_signer_unavailable' ? WORKFLOW_ROUTES.proof : WORKFLOW_ROUTES.validate
    },
    ...validationErrors,
    ...runtimeErrors,
    ...malformedRuntimeSignals
  ];
}

function buildDegradedModePolicy({ accepted, commandSemantics, failureState, operational, retry }) {
  const writesBlocked = failureState === 'write_degraded'
    || failureState === 'storage_unavailable'
    || failureState === 'active_command_lease'
    || failureState === 'idempotency_conflict';
  const proofBlocked = failureState === 'proof_signer_unavailable';
  const previewAllowed = failureState !== 'storage_unavailable' || operational.observedFailures.length === 0;

  return {
    active: operational.degradedModeRequested
      || writesBlocked
      || proofBlocked
      || failureState === 'checkpoint_stale'
      || failureState === 'interrupted_command_resume',
    previewOnly: !accepted && (writesBlocked || operational.degradedModeRequested),
    proofExportBlocked: proofBlocked,
    writeBlocked: writesBlocked,
    allowedOperations: {
      preview: previewAllowed,
      validate: true,
      accept: !writesBlocked && commandSemantics.status !== 'conflict',
      exportProof: accepted && !proofBlocked && failureState !== 'storage_unavailable'
    },
    fallbackRoute: writesBlocked || failureState === 'checkpoint_stale'
      ? WORKFLOW_ROUTES.validate
      : proofBlocked
        ? WORKFLOW_ROUTES.proof
        : WORKFLOW_ROUTES.preview,
    recoveryMode: retry.safeToRetry
      ? 'retry_scheduled'
      : retry.exhausted
        ? 'operator_escalation'
        : writesBlocked || proofBlocked
          ? 'dependency_repair_required'
          : 'normal'
  };
}

function buildOperationalSignalSummary(operational) {
  const byDependency = {};
  operational.observedFailures.forEach((failure) => {
    incrementCounter(byDependency, failure.dependency);
  });

  return {
    contract: 'AppendOnlyAuditRecoveryOperationalSignalSummary.v1',
    observedFailureCount: operational.observedFailures.length,
    malformedSignalCount: operational.invalidFailureSignals.length,
    dependenciesImpacted: toRankedCounts(byDependency, 6),
    failures: operational.observedFailures.map((failure) => ({
      code: failure.code,
      phase: failure.phase,
      dependency: failure.dependency,
      retryable: failure.retryable,
      observedAt: failure.observedAt,
      retryAfterMs: failure.retryAfterMs,
      terminal: failure.terminal,
      known: failure.known
    })),
    invalidSignals: operational.invalidFailureSignals
  };
}

function buildOperationalHealth({ accepted, commandSemantics, input, now, persistedShape, validation }) {
  const operational = normalizeOperationalInputs(input);
  const failureState = classifyFailureState({ accepted, commandSemantics, operational, persistedShape, validation });
  const retry = buildRetryBackoff({ commandSemantics, failureState, now, operational, validation });
  const degradedMode = buildDegradedModePolicy({ accepted, commandSemantics, failureState, operational, retry });
  const actionableErrors = buildActionableErrors({ failureState, operational, validation });
  const signalSummary = buildOperationalSignalSummary(operational);

  return {
    type: 'AppendOnlyAuditRecoveryOperationalHealth.v1',
    status: failureState === 'healthy' || failureState === 'idempotent_replay'
      ? 'healthy'
      : degradedMode.active
        ? 'degraded'
        : 'unhealthy',
    failureState,
    degradedMode,
    dependencies: {
      storageReachable: operational.storageReachable,
      writerAvailable: operational.writerAvailable,
      proofSignerAvailable: operational.proofSignerAvailable,
      readOnly: operational.readOnly
    },
    signals: signalSummary,
    retry,
    actionableErrors
  };
}

function buildLifecycleState({ accepted, commandSemantics, lifecycle, lifecycleCommand, now, operationalHealth, validation }) {
  const lifecyclePlan = buildLifecycleExecutionPlan({ lifecycle, lifecycleCommand, now, validation });
  const effectiveLifecycle = lifecyclePlan.effective;
  const nextRunMs = effectiveLifecycle.schedule.nextRunAt ? Date.parse(effectiveLifecycle.schedule.nextRunAt) : null;
  const nowMs = Date.parse(now);
  const scheduleDue = effectiveLifecycle.schedule.enabled
    && Number.isFinite(nextRunMs)
    && Number.isFinite(nowMs)
    && nextRunMs <= nowMs;
  const settingIssues = validation.issues.filter((issue) => (
    issue.code === 'invalid_lifecycle_mode'
    || issue.code === 'invalid_schedule_cadence'
    || issue.code === 'missing_disabled_reason'
    || issue.code === 'lifecycle_disabled'
    || issue.code === 'lifecycle_maintenance'
    || issue.code === 'invalid_next_run_at'
    || issue.code === 'invalid_last_run_at'
    || issue.code === 'manual_schedule_enabled'
    || issue.code === 'disabled_lifecycle_schedule_enabled'
    || issue.code === 'maintenance_schedule_enabled'
    || issue.code === 'invalid_lifecycle_command'
    || issue.code === 'missing_lifecycle_command_reason'
    || issue.code === 'scheduled_command_requires_cadence'
    || issue.code === 'missing_scheduled_next_run'
    || issue.code === 'missing_resumed_schedule_next_run'
    || issue.code === 'invalid_lifecycle_command_next_run_at'
    || issue.code === 'pause_schedule_noop'
    || issue.code === 'enable_command_target_conflict'
  ));
  const blockingSettingIssues = settingIssues.filter((issue) => issue.severity === 'error');
  const lifecycleCommandPending = lifecyclePlan.writeRequired;
  const status = blockingSettingIssues.length > 0
    ? 'invalid_settings'
    : lifecycleCommandPending
      ? 'command_pending'
      : !effectiveLifecycle.enabled
        ? 'disabled'
        : effectiveLifecycle.mode === 'maintenance'
          ? 'maintenance'
          : validation.errorCount > 0
          ? 'blocked'
          : accepted
            ? 'accepted'
            : scheduleDue
              ? 'due'
              : effectiveLifecycle.schedule.enabled
                ? 'scheduled'
                : 'manual';
  const nextAction = lifecycleCommandPending
    ? {
        id: `apply-${lifecycleCommand.command}`,
        command: lifecycleCommand.command,
        route: WORKFLOW_ROUTES.validate,
        label: 'Apply lifecycle command',
        reason: lifecycleCommand.reason || `Lifecycle command ${lifecycleCommand.command} is pending validation.`,
        dueAt: effectiveLifecycle.schedule.nextRunAt || null
      }
    : !effectiveLifecycle.enabled
      ? {
          id: 'enable-lifecycle',
          command: 'enable',
          route: WORKFLOW_ROUTES.validate,
          label: 'Enable append-only recovery',
          reason: effectiveLifecycle.disabledReason || 'Recovery is disabled by lifecycle settings.',
          dueAt: null
        }
    : effectiveLifecycle.mode === 'maintenance'
      ? {
          id: 'exit-maintenance',
          command: 'configure',
          route: WORKFLOW_ROUTES.validate,
          label: 'Exit maintenance mode',
          reason: effectiveLifecycle.maintenanceReason || 'Recovery is paused for maintenance.',
          dueAt: null
        }
      : blockingSettingIssues.length > 0
        ? {
            id: 'repair-lifecycle-settings',
            command: 'configure',
            route: WORKFLOW_ROUTES.validate,
            label: 'Repair lifecycle settings',
            reason: blockingSettingIssues[0].message,
            dueAt: null
          }
        : validation.errorCount > 0
          ? {
              id: 'repair-evidence',
              command: 'recover',
              route: WORKFLOW_ROUTES.validate,
              label: 'Repair audit evidence',
              reason: 'Validation errors block lifecycle advancement.',
              dueAt: null
            }
          : accepted
            ? {
                id: 'export-proof',
                command: 'export-proof',
                route: WORKFLOW_ROUTES.proof,
                label: 'Export recovery proof',
                reason: 'Accepted append-only state is ready for proof export.',
                dueAt: null
              }
            : scheduleDue
              ? {
                  id: 'run-scheduled-acceptance',
                  command: 'accept',
                  route: WORKFLOW_ROUTES.accept,
                  label: 'Run scheduled acceptance',
                  reason: 'The configured append-only recovery schedule is due.',
                  dueAt: effectiveLifecycle.schedule.nextRunAt
                }
              : {
              id: effectiveLifecycle.schedule.enabled ? 'wait-for-schedule' : 'manual-acceptance',
                  command: effectiveLifecycle.schedule.enabled ? 'preview' : commandSemantics.command,
                  route: effectiveLifecycle.schedule.enabled ? WORKFLOW_ROUTES.preview : WORKFLOW_ROUTES.accept,
                  label: effectiveLifecycle.schedule.enabled ? 'Wait for scheduled recovery' : 'Accept append-only preview',
                  reason: effectiveLifecycle.schedule.enabled
                    ? 'No scheduled lifecycle run is due yet.'
                    : 'Manual lifecycle mode requires an explicit acceptance command.',
                  dueAt: effectiveLifecycle.schedule.nextRunAt
                };

  return {
    ...effectiveLifecycle,
    status,
    configured: lifecycle,
    executionPlan: lifecyclePlan,
    lifecycleCommand,
    scheduleDue,
    canAcceptNow: effectiveLifecycle.enabled
      && effectiveLifecycle.mode === 'enabled'
      && !['disable', 'enter-maintenance', 'pause-schedule'].includes(lifecycleCommand.command)
      && validation.errorCount === 0
      && operationalHealth.degradedMode.writeBlocked === false,
    canAutoAccept: effectiveLifecycle.enabled
      && effectiveLifecycle.mode === 'enabled'
      && effectiveLifecycle.schedule.enabled
      && scheduleDue
      && !lifecycleCommandPending
      && validation.errorCount === 0
      && operationalHealth.status === 'healthy',
    blockedBy: settingIssues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      field: issue.field,
      message: issue.message
    })),
    nextAction,
    auditEvent: {
      type: 'AppendOnlyAuditRecoveryLifecycleDecision.v1',
      decidedAt: now,
      status,
      command: nextAction.command,
      idempotencyKey: commandSemantics.idempotencyKey,
      scheduleCadence: effectiveLifecycle.schedule.cadence,
      nextRunAt: effectiveLifecycle.schedule.nextRunAt,
      transitionCount: lifecyclePlan.transitions.length,
      settingsWriteRequired: lifecyclePlan.writeRequired,
      lifecycleCommand: {
        command: lifecycleCommand.command,
        targetMode: lifecycleCommand.targetMode,
        requestedBy: lifecycleCommand.requestedBy,
        scheduleCadence: lifecycleCommand.schedule.cadence,
        scheduleEnabled: lifecycleCommand.schedule.enabled
      }
    }
  };
}

function buildRecoveryPaths({ boundaryContext, persistedShape, commandSemantics, validation }) {
  const scope = {
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    enforced: boundaryContext.enforced
  };
  const replayPlan = commandSemantics.replayPlan;

  if (replayPlan.status === 'conflict') {
    return [{
      id: 'reject-conflicting-command',
      status: 'blocked',
      route: WORKFLOW_ROUTES.validate,
      reason: 'The idempotency key was previously used for a different digest or entry count.',
      command: commandSemantics.command,
      idempotencyKey: commandSemantics.idempotencyKey,
      scope,
      conflict: {
        expectedLatestDigest: replayPlan.journalCommand ? replayPlan.journalCommand.latestDigest : null,
        actualLatestDigest: replayPlan.latestDigest,
        expectedEntryCount: replayPlan.journalCommand ? replayPlan.journalCommand.entryCount : null,
        actualEntryCount: replayPlan.entryCount
      }
    }];
  }

  if (replayPlan.status === 'in_flight') {
    return [{
      id: 'wait-for-command-lease',
      status: 'pending',
      route: WORKFLOW_ROUTES.accept,
      reason: 'A matching persisted command is still leased by an active hosted-kernel writer.',
      command: commandSemantics.command,
      idempotencyKey: commandSemantics.idempotencyKey,
      scope,
      lease: {
        token: replayPlan.journalCommand ? replayPlan.journalCommand.leaseToken : null,
        lockedUntil: replayPlan.journalCommand ? replayPlan.journalCommand.lockedUntil : null,
        lastHeartbeatAt: replayPlan.journalCommand ? replayPlan.journalCommand.lastHeartbeatAt : null
      }
    }];
  }

  if (replayPlan.status === 'interrupted_replay') {
    return [{
      id: 'resume-interrupted-command',
      status: 'ready',
      route: replayPlan.resumeWriteFrom === 'proof-export' ? WORKFLOW_ROUTES.proof : WORKFLOW_ROUTES.accept,
      reason: 'An expired persisted command lease can resume from the last recorded write phase.',
      command: commandSemantics.command,
      idempotencyKey: commandSemantics.idempotencyKey,
      scope,
      resumeWriteFrom: replayPlan.resumeWriteFrom,
      previousWritePhase: replayPlan.journalCommand ? replayPlan.journalCommand.writePhase : null,
      attempt: replayPlan.journalCommand ? replayPlan.journalCommand.attempt + 1 : 1
    }];
  }

  if (validation.errorCount > 0) {
    return [{
      id: 'repair-then-replay',
      status: 'blocked',
      route: WORKFLOW_ROUTES.validate,
      reason: 'Persisted recovery cannot resume until append-only validation errors are repaired.',
      command: 'recover',
      idempotencyKey: commandSemantics.idempotencyKey,
      scope
    }];
  }

  if (persistedShape.acceptedSnapshot.reusable) {
    return [{
      id: 'reuse-accepted-snapshot',
      status: 'ready',
      route: WORKFLOW_ROUTES.proof,
      reason: 'Persisted accepted snapshot matches the latest digest and can be reused after restart.',
      command: 'export-proof',
      idempotencyKey: commandSemantics.idempotencyKey,
      scope
    }];
  }

  return [{
    id: 'persist-checkpoint',
    status: commandSemantics.status === 'replayed' ? 'ready' : 'pending',
    route: WORKFLOW_ROUTES.accept,
    reason: 'Validated evidence should be written as a checkpoint before proof export.',
    command: commandSemantics.command,
    idempotencyKey: commandSemantics.idempotencyKey,
    scope
  }];
}

function buildBoundaryAuditHandoff(boundaryContext, boundaryAccessPlan, validation, accepted) {
  const boundaryIssues = validation.issues.filter((issue) => (
    issue.code === 'acceptance_actor_missing'
    || issue.code === 'boundary_access_redacted'
    || issue.code === 'tenant_boundary_violation'
    || issue.code === 'workspace_tenant_boundary_violation'
    || issue.code === 'workspace_tenant_binding_missing'
    || issue.code === 'workspace_boundary_violation'
    || issue.code === 'missing_entry_tenant_scope'
    || issue.code === 'missing_entry_workspace_scope'
    || issue.code === 'acceptance_permission_denied'
    || issue.code === 'proof_permission_denied'
    || issue.code === 'workspace_binding_access_denied'
  ));
  const scopeKey = `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`;
  const permissionSnapshot = {
    contract: 'AppendOnlyAuditRecoveryBoundaryPermissionSnapshot.v1',
    redacted: !boundaryContext.canReadBoundary,
    actorId: boundaryContext.actorId,
    roles: boundaryContext.canReadBoundary ? boundaryContext.roles : [],
    permissions: boundaryContext.canReadBoundary ? boundaryContext.permissions : [],
    commandGates: boundaryAccessPlan.commandGates
  };

  return {
    type: 'AppendOnlyAuditRecoveryBoundaryProof.v1',
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    scopeKey,
    actorId: boundaryContext.actorId,
    roles: permissionSnapshot.roles,
    permissions: permissionSnapshot.permissions,
    permissionSnapshot,
    allowedTenantIds: boundaryContext.allowedTenantIds,
    allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
    workspaceTenantBindings: boundaryContext.workspaceTenantBindings,
    requireWorkspaceTenantBinding: boundaryContext.requireWorkspaceTenantBinding,
    accessPlan: boundaryAccessPlan,
    enforced: boundaryContext.enforced,
    canAccept: boundaryContext.canAccept,
    canExportProof: boundaryContext.canExportProof && accepted,
    canReadBoundary: boundaryContext.canReadBoundary,
    status: boundaryIssues.length > 0 ? 'blocked' : accepted ? 'accepted' : 'preview',
    decision: {
      contract: 'AppendOnlyAuditRecoveryBoundaryDecision.v1',
      actorResolved: Boolean(boundaryContext.actorId),
      acceptanceGate: boundaryContext.canAccept ? 'authorized' : 'missing_accept_permission',
      proofGate: boundaryContext.canExportProof ? 'authorized' : 'missing_proof_permission',
      scopeGate: boundaryIssues.length > 0 ? 'blocked' : boundaryAccessPlan.accessMode,
      auditRoute: boundaryIssues.length > 0 ? WORKFLOW_ROUTES.validate : accepted ? WORKFLOW_ROUTES.proof : WORKFLOW_ROUTES.preview
    },
    handoff: {
      contract: 'AppendOnlyAuditRecoveryBoundaryAuditHandoff.v1',
      route: WORKFLOW_ROUTES.validate,
      target: 'hosted-kernel-boundary-audit',
      scopeKey,
      issueCount: boundaryIssues.length,
      bindingCount: boundaryContext.workspaceTenantBindings.length,
      includePermissionSnapshot: boundaryContext.canReadBoundary,
      accessPlanContract: boundaryAccessPlan.type,
      redactionApplied: boundaryAccessPlan.redaction.applied,
      hiddenEntryCount: boundaryAccessPlan.redaction.hiddenEntryCount,
      immutableEvidence: true
    },
    blockedBy: boundaryIssues.map((issue) => ({
      code: issue.code,
      entryIndex: issue.entryIndex,
      field: issue.field,
      expected: issue.expected,
      actual: issue.actual
    }))
  };
}

function buildProofReceipt({
  accepted,
  boundary,
  boundaryContext,
  commandSemantics,
  latestEntry,
  now,
  operationalHealth,
  persistedStateShape,
  providerNegotiation,
  readiness,
  validation
}) {
  const latestDigest = latestEntry ? latestEntry.digest : null;
  const genesisEntry = validation.entries[0] || null;
  const providerReady = providerNegotiation.status === 'negotiated'
    && providerNegotiation.missingRequiredCapabilities.length === 0;
  const signerReady = !operationalHealth.degradedMode.proofExportBlocked;
  const canExport = accepted
    && readiness.readyForProofExport
    && providerReady
    && signerReady
    && boundary.canExportProof;
  const blockingIssues = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const blockedBy = canExport
    ? []
    : [
        ...(!accepted ? ['not_accepted'] : []),
        ...(!latestDigest ? ['missing_latest_digest'] : []),
        ...(!boundary.canExportProof ? ['proof_permission_denied'] : []),
        ...(!providerReady ? [providerNegotiation.status] : []),
        ...(providerNegotiation.missingRequiredCapabilities.length > 0
          ? providerNegotiation.missingRequiredCapabilities.map((capability) => `missing:${capability}`)
          : []),
        ...(!signerReady ? ['proof_signer_unavailable'] : []),
        ...blockingIssues
      ];

  return {
    type: 'AppendOnlyAuditRecoveryProofReceipt.v1',
    status: canExport ? 'exportable' : accepted ? 'blocked' : 'preview',
    canExport,
    route: WORKFLOW_ROUTES.proof,
    method: 'POST',
    mediaType: 'application/json',
    proofContract: 'AppendOnlyAuditRecoveryProof.v1',
    idempotencyKey: commandSemantics.idempotencyKey,
    issuedAt: canExport ? now : null,
    generatedAt: now,
    blockedBy: Array.from(new Set(blockedBy)),
    manifest: {
      surfaceId,
      storageKey: persistedStateShape.storageKey,
      latestDigest,
      genesisDigest: genesisEntry ? genesisEntry.digest : null,
      entryCount: validation.entries.length,
      acceptedAt: persistedStateShape.acceptedSnapshot.acceptedAt,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      scopeKey: boundary.scopeKey,
      boundaryAccessMode: boundary.accessPlan.accessMode,
      boundaryRedactionApplied: boundary.accessPlan.redaction.applied,
      workspaceTenantBindings: boundaryContext.workspaceTenantBindings,
      requireWorkspaceTenantBinding: boundaryContext.requireWorkspaceTenantBinding,
      appendOnly: validation.errorCount === 0,
      providerId: providerNegotiation.provider.providerId,
      providerApiVersion: providerNegotiation.provider.apiVersion,
      providerServiceContract: providerNegotiation.serviceContract.contract,
      providerExternalStateKey: providerNegotiation.serviceContract.externalStateKey,
      providerConsistency: providerNegotiation.serviceContract.consistency,
      providerDeliveryGuarantee: providerNegotiation.serviceContract.deliveryGuarantee,
      timestampIntegrity: validation.timestampIntegrity.status,
      timestampRange: {
        firstObservedAt: validation.timestampIntegrity.firstObservedAt,
        firstObservedEntryIndex: validation.timestampIntegrity.firstObservedEntryIndex,
        lastObservedAt: validation.timestampIntegrity.lastObservedAt,
        lastObservedEntryIndex: validation.timestampIntegrity.lastObservedEntryIndex
      }
    },
    chain: {
      algorithm: 'digest-chain',
      continuity: validation.errorCount === 0 ? 'verified' : 'failed',
      timestampIntegrity: validation.timestampIntegrity,
      firstEntryId: genesisEntry ? genesisEntry.id : null,
      lastEntryId: latestEntry ? latestEntry.id : null,
      requiredFields: REQUIRED_ENTRY_FIELDS,
      warningCodes: validation.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.code)
    },
    signerRequest: {
      requiredCapability: PROVIDER_CAPABILITIES.signProof,
      providerCapabilityAccepted: providerNegotiation.acceptedCapabilities.includes(PROVIDER_CAPABILITIES.signProof),
      signerAvailable: signerReady,
      subjectDigest: latestDigest,
      scopeKey: `${boundaryContext.tenantId || 'tenant-unscoped'}:${boundaryContext.workspaceId || 'workspace-unscoped'}`,
      boundaryAccessPlan: boundary.accessPlan.type,
      requiresUnredactedBoundary: true,
      boundaryRedactionApplied: boundary.accessPlan.redaction.applied
    },
    auditDecision: {
      accepted,
      command: commandSemantics.command,
      commandStatus: commandSemantics.status,
      boundaryStatus: boundary.status,
      boundaryAccessMode: boundary.accessPlan.accessMode,
      providerStatus: providerNegotiation.status,
      operationalStatus: operationalHealth.status
    }
  };
}

function buildRuntimeContracts(
  requestState,
  boundary,
  providerNegotiation,
  clientResume,
  workflowHandoffDecision,
  proofReceipt,
  statePersistence,
  clientReadinessSummary
) {
  return {
    requestState: {
      type: 'AppendOnlyAuditRecoveryRuntimeState',
      fields: {
        clientRequestId: 'string|null',
        continuationToken: 'string|null',
        runtimeId: 'string|null',
        requestedView: 'preview|acceptance|proof|repair|null',
        actor: 'string|null',
        sourceRoute: 'string|null',
        handoffTarget: 'string|null',
        optimisticAccept: 'boolean',
        boundary: 'AppendOnlyAuditRecoveryBoundaryProof.v1'
      },
      value: {
        ...requestState,
        boundary
      }
    },
    clientResume: {
      type: 'AppendOnlyAuditRecoveryClientResumeContract.v1',
      fields: {
        status: 'ready|awaiting_input|blocked|stale',
        token: 'string',
        expiresOnDigestChange: 'boolean',
        expectedState: '{ latestDigest: string|null, entryCount: number, checkpointStorageKey: string, workflowState: string, route: string }',
        submittedState: '{ token: string|null, latestDigest: string|null, entryCount: number|null, route: string|null }',
        resumeRequest: '{ method: string, route: string, bodyContract: string, body: object }',
        canSubmit: 'boolean',
        pendingInputs: 'string[]',
        blockedBy: 'Array<{ code: string, entryIndex: number|null, field: string|null, expected?: unknown, actual?: unknown }>'
      },
      value: clientResume
    },
    clientReadinessSummary: {
      type: 'AppendOnlyAuditRecoveryClientReadinessSummary.v1',
      fields: {
        status: 'disabled|maintenance|invalid_settings|blocked|unhealthy|degraded|ready_replayed|ready|awaiting_acceptance',
        ready: 'boolean',
        activeRoute: 'string',
        activeView: 'preview|acceptance|proof|repair',
        stages: 'Array<{ id: string, label: string, route: string, ready: boolean, status: string, blockingReasons: string[], evidence: object }>',
        validation: 'AppendOnlyAuditRecoveryClientValidationSummary.v1',
        operationalBlockers: 'string[]',
        providerBlockers: 'string[]',
        firstBlockedStage: '{ id: string, route: string, blockingReasons: string[] }|null',
        recommendedRoute: 'string',
        routeContracts: '{ preview: string, validate: string, accept: string, proof: string, resume: string }'
      },
      value: clientReadinessSummary
    },
    handoff: {
      type: 'AppendOnlyAuditRecoveryWorkflowHandoff',
      fields: {
        state: 'preview|acceptance|proof|repair',
        route: 'string',
        target: 'string',
        resumeEnvelope: 'AppendOnlyAuditRecoveryClientResumeContract.v1',
        canContinue: 'boolean',
        pendingInputs: 'string[]',
        blockedBy: 'Array<{ code: string, entryIndex: number|null, field: string|null }>'
      }
    },
    workflowHandoffDecision: {
      type: 'AppendOnlyAuditRecoveryWorkflowHandoffDecision.v1',
      fields: {
        status: 'ready|repair_required|provider_blocked|runtime_blocked|awaiting_input',
        route: 'string',
        command: 'preview|accept|recover|export-proof',
        operatorPrompt: 'string',
        submitPolicy: '{ method: string, allowed: boolean, idempotent: boolean, idempotencyKey: string, restartSafe: boolean, restartSafeStatus: string }',
        preflight: '{ validationPassed: boolean, lifecycleAccepting: boolean, providerNegotiated: boolean, writesAvailable: boolean, proofExportable: boolean, resumeSubmittable: boolean }',
        resume: '{ token: string, route: string, bodyContract: string, pendingInputs: string[], canSubmit: boolean }',
        outboundPayload: '{ contract: string, route: string, command: string, expectedLatestDigest: string|null, expectedEntryCount: number, storageKey: string, continuationToken: string }',
        blockedBy: 'Array<{ code: string, route: string }>'
      },
      value: workflowHandoffDecision
    },
    operatorRemediationPacket: {
      type: 'AppendOnlyAuditRecoveryOperatorRemediationPacket.v1',
      fields: {
        status: 'ready|recoverable|operator_action_required',
        primaryRoute: 'string',
        primaryCommand: 'preview|accept|recover|export-proof',
        operatorPrompt: 'string',
        blockingActionCodes: 'string[]',
        canSelfRecover: 'boolean',
        degradedMode: '{ active: boolean, recoveryMode: string, fallbackRoute: string, allowedOperations: object }',
        retryPlan: '{ strategy: string, safeToRetry: boolean, exhausted: boolean, currentAttempt: number, maxAttempts: number, nextDelayMs: number|null, nextRetryAt: string|null, reason: string }',
        readiness: '{ status: string, restartSafe: boolean, firstBlockedStage: object|null, recommendedRoute: string }',
        proofGate: '{ canExport: boolean, status: string, blockedBy: string[], latestDigest: string|null }',
        lifecycleGate: '{ status: string, canAcceptNow: boolean, nextAction: object }',
        commandReplay: '{ command: string, status: string, idempotencyKey: string, restartSafeStatus: string, requiredWriteCount: number, replayAction: string }',
        actions: 'Array<{ code: string, severity: string, route: string, action?: string, owner?: string, retryable?: boolean, repairable?: boolean }>',
        submitPolicy: 'AppendOnlyAuditRecoveryWorkflowHandoffDecision.v1.submitPolicy'
      }
    },
    persistedState: {
      type: 'AppendOnlyAuditRecoveryPersistedState.v1',
      fields: {
        storageKey: 'string',
        restartStatus: 'cold_start|checkpoint_stale|checkpoint_replay_required|accepted_snapshot_available|repair_required',
        checkpoint: '{ latestDigest: string|null, entryCount: number, acceptedAt: string|null, mode: string, source: string }',
        acceptedSnapshot: '{ reusable: boolean, latestDigest: string|null, entryCount: number|null, acceptedAt: string|null }',
        replayCursor: '{ nextEntryIndex: number|null, latestDigest: string|null, canResumeAppend: boolean }'
      }
    },
    statePersistence: {
      type: 'AppendOnlyAuditRecoveryStatePersistenceEnvelope.v1',
      fields: {
        status: 'no_write_required|write_blocked|writes_required|write_conflict|write_deferred_active_lease',
        restartSafeStatus: 'not_restart_safe_validation_blocked|not_restart_safe_idempotency_conflict|restart_pending_active_writer|restart_safe_resume_required|restart_safe_idempotent_replay|restart_safe_after_snapshot_write|restart_safe_after_checkpoint_write|restart_safe_checkpoint_available',
        idempotencyKey: 'string',
        commandReplay: 'AppendOnlyAuditRecoveryCommandReplayPlan.v1',
        journalEntry: 'AppendOnlyAuditRecoveryCommandJournalEntry.v1',
        requiredWrites: 'Array<{ id: string, operation: string, contract: string, storageKey: string, idempotencyKey?: string, precondition?: string }>',
        committedView: '{ storageKey: string, checkpoint: object, acceptedSnapshot: object, replayCursor: object, journaledCommandCount: number }',
        restartRecovery: '{ route: string, action: string, canResumeWithoutRevalidation: boolean, replayFromEntryIndex: number|null, resumeDigest: string|null, acceptanceRequested: boolean, replayedFromJournal: boolean, commandReplayStatus: string, resumeWriteFrom: string|null }'
      },
      value: statePersistence
    },
    boundary: {
      type: 'AppendOnlyAuditRecoveryBoundaryProof.v1',
      fields: {
        tenantId: 'string|null',
        workspaceId: 'string|null',
        scopeKey: 'string',
        actorId: 'string|null',
        roles: 'string[]',
        permissions: 'string[]',
        allowedTenantIds: 'string[]',
        allowedWorkspaceIds: 'string[]',
        workspaceTenantBindings: 'Array<{ workspaceId: string, tenantId: string }>',
        requireWorkspaceTenantBinding: 'boolean',
        accessPlan: 'AppendOnlyAuditRecoveryBoundaryAccessPlan.v1',
        permissionSnapshot: 'AppendOnlyAuditRecoveryBoundaryPermissionSnapshot.v1',
        enforced: 'boolean',
        canAccept: 'boolean',
        canExportProof: 'boolean',
        canReadBoundary: 'boolean',
        status: 'preview|accepted|blocked',
        decision: 'AppendOnlyAuditRecoveryBoundaryDecision.v1',
        handoff: 'AppendOnlyAuditRecoveryBoundaryAuditHandoff.v1'
      }
    },
    command: {
      type: 'AppendOnlyAuditRecoveryCommand.v1',
      fields: {
        command: 'preview|accept|recover|export-proof',
        idempotencyKey: 'string',
        status: 'pending|completed|blocked|replayed|resume_required|in_flight|conflict',
        safeToRetry: 'boolean',
        replayPlan: 'AppendOnlyAuditRecoveryCommandReplayPlan.v1',
        conflictPolicy: 'string'
      }
    },
    providerContract: {
      type: 'AppendOnlyAuditRecoveryProviderNegotiation.v1',
      fields: {
        status: 'negotiated|missing_provider_capability|sync_cursor_stale|handoff_not_acknowledged|service_contract_incompatible|blocked_by_validation',
        provider: 'AppendOnlyAuditRecoveryProviderContract.v1',
        requiredCapabilities: 'string[]',
        acceptedCapabilities: 'string[]',
        missingRequiredCapabilities: 'string[]',
        syncMetadata: 'AppendOnlyAuditRecoverySyncMetadata.v1',
        serviceContract: 'AppendOnlyAuditRecoveryProviderServiceNegotiation.v1',
        externalHandoffState: 'AppendOnlyAuditRecoveryExternalHandoffState.v1'
      },
      value: providerNegotiation
    },
    proofReceipt: {
      type: 'AppendOnlyAuditRecoveryProofReceipt.v1',
      fields: {
        status: 'preview|blocked|exportable',
        canExport: 'boolean',
        route: 'string',
        proofContract: 'AppendOnlyAuditRecoveryProof.v1',
        idempotencyKey: 'string',
        manifest: '{ surfaceId: string, storageKey: string, latestDigest: string|null, genesisDigest: string|null, entryCount: number, tenantId: string|null, workspaceId: string|null, scopeKey: string, boundaryAccessMode: string, boundaryRedactionApplied: boolean, workspaceTenantBindings: Array<{ workspaceId: string, tenantId: string }>, appendOnly: boolean }',
        chain: '{ algorithm: "digest-chain", continuity: "verified"|"failed", firstEntryId: string|null, lastEntryId: string|null, requiredFields: string[], warningCodes: string[] }',
        signerRequest: '{ requiredCapability: string, providerCapabilityAccepted: boolean, signerAvailable: boolean, subjectDigest: string|null, scopeKey: string, boundaryAccessPlan: string, requiresUnredactedBoundary: boolean }',
        blockedBy: 'string[]'
      },
      value: proofReceipt
    },
    operationalHealth: {
      type: 'AppendOnlyAuditRecoveryOperationalHealth.v1',
      fields: {
        status: 'healthy|degraded|unhealthy',
        failureState: 'healthy|validation_blocked|idempotency_conflict|active_command_lease|interrupted_command_resume|storage_unavailable|write_degraded|proof_signer_unavailable|checkpoint_stale|idempotent_replay',
        degradedMode: '{ active: boolean, previewOnly: boolean, proofExportBlocked: boolean, writeBlocked: boolean, allowedOperations: object, fallbackRoute: string, recoveryMode: string }',
        dependencies: '{ storageReachable: boolean, writerAvailable: boolean, proofSignerAvailable: boolean, readOnly: boolean }',
        signals: 'AppendOnlyAuditRecoveryOperationalSignalSummary.v1',
        retry: '{ strategy: string, currentAttempt: number, maxAttempts: number, nextDelayMs: number|null, safeToRetry: boolean, retryWindow: object, reason: string }',
        actionableErrors: 'Array<{ code: string, severity: string, message: string, action: string, route: string }>'
      }
    },
    lifecycle: {
      type: 'AppendOnlyAuditRecoveryLifecycleSettings.v1',
      fields: {
        enabled: 'boolean',
        mode: 'enabled|disabled|maintenance',
        disabledReason: 'string|null',
        schedule: '{ enabled: boolean, cadence: "manual"|"hourly"|"daily"|"weekly", intervalMinutes: number|null, nextRunAt: string|null, timezone: string }',
        limits: '{ maxBatchEntries: number, retentionDays: number }',
        status: 'manual|scheduled|due|command_pending|accepted|blocked|invalid_settings|maintenance|disabled',
        lifecycleCommand: 'AppendOnlyAuditRecoveryLifecycleCommand.v1',
        canAcceptNow: 'boolean',
        canAutoAccept: 'boolean',
        nextAction: '{ id: string, command: string, route: string, label: string, reason: string, dueAt: string|null }',
        auditEvent: 'AppendOnlyAuditRecoveryLifecycleDecision.v1'
      }
    },
    analyticsReport: {
      type: 'AppendOnlyAuditRecoveryAnalyticsReport.v1',
      fields: {
        counters: '{ entriesTotal: number, acceptedEntries: number, scopedEntries: number, uniqueActors: number, uniqueActions: number, errorsTotal: number, warningsTotal: number, timestampInvalidEntries: number, timestampRegressionEntries: number, timestampParseableEntries: number, runtimeFailures: number, pendingWrites: number, historySnapshots: number }',
        breakdowns: '{ actions: Array<{ key: string, count: number }>, actors: Array<{ key: string, count: number }>, routes: Array<{ key: string, count: number }>, issues: Array<{ key: string, count: number }>, commandStatuses: Array<{ key: string, count: number }> }',
        timeline: '{ current: AppendOnlyAuditRecoveryAnalyticsSnapshot.v1, history: AppendOnlyAuditRecoveryAnalyticsSnapshot.v1[], events: AppendOnlyAuditRecoveryTimelineEvent.v1[], timestampIntegrity: AppendOnlyAuditRecoveryTimestampIntegrity.v1, deltaFromPrevious: object }',
        exportSummary: 'AppendOnlyAuditRecoveryExportSummary.v1',
        reportingState: '{ status: string, primaryMetric: string, route: string, dashboardCards: Array<{ id: string, label: string, value: number, trend: number|null }>, alerts: Array<object>, exportControls: object }'
      }
    }
  };
}

export function describeAppendOnlyLogSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const policy = {
    ...DEFAULT_ACCEPTANCE_POLICY,
    ...(input.policy && typeof input.policy === 'object' ? input.policy : {})
  };
  const requestState = normalizeRequestState(input);
  const boundaryContext = normalizeBoundaryContext(input);
  const acceptanceRequested = Boolean(input.acceptance && input.acceptance.requestedBy);
  const lifecycleControls = normalizeLifecycleControls(input);
  const lifecycleCommand = normalizeLifecycleCommand(input, lifecycleControls);
  const mailchimpCampaign = normalizeMailchimpCampaignEnvelope(input);
  let validation = validateBoundaryContext(
    validateEntries(asArray(input.evidence), policy),
    boundaryContext,
    acceptanceRequested
  );
  const boundaryAccessPlan = buildBoundaryAccessPlan(boundaryContext, validation.entries, requestState);
  validation = validateBoundaryAccessPlan(validation, boundaryAccessPlan, {
    acceptanceRequested,
    proofRequested: requestState.requestedView === 'proof' || requestState.sourceRoute === WORKFLOW_ROUTES.proof
  });
  validation = validateLifecycleCommand(
    validateLifecycleSettings(validation, lifecycleControls, acceptanceRequested),
    lifecycleCommand,
    acceptanceRequested
  );
  const latestEntry = validation.entries[validation.entries.length - 1] || null;
  const clientResumeEnvelope = normalizeClientResumeEnvelope(input);
  validation = validateClientResumeEnvelope(validation, clientResumeEnvelope);
  const persistedState = normalizePersistedState(input);
  const providerContract = normalizeProviderContract(input);
  const providerCommand = validation.errorCount > 0
    ? 'recover'
    : acceptanceRequested || requestState.requestedView === 'acceptance' || requestState.optimisticAccept
      ? 'accept'
      : requestState.requestedView === 'proof'
        ? 'export-proof'
        : 'preview';
  const providerProbeCommand = {
    command: providerCommand,
    idempotencyKey: buildIdempotencyKey(requestState, providerCommand, latestEntry),
    status: validation.errorCount > 0 ? 'blocked' : 'pending'
  };
  validation = validateMailchimpCampaignEnvelope(validation, mailchimpCampaign, providerProbeCommand);
  let providerNegotiation = buildProviderNegotiation({
    commandSemantics: providerProbeCommand,
    latestEntry,
    now,
    providerContract,
    requestState,
    validation
  });
  validation = validateProviderNegotiation(validation, providerNegotiation, acceptanceRequested);
  const mailchimpProbeContract = buildMailchimpCampaignDeliveryContract({
    accepted: false,
    boundaryContext,
    commandSemantics: providerProbeCommand,
    latestEntry,
    mailchimpCampaign,
    now,
    providerNegotiation,
    validation
  });
  if (acceptanceRequested && !mailchimpProbeContract.readyForAcceptance) {
    const issues = [
      ...validation.issues,
      ...mailchimpProbeContract.blockingReasons.map((reason) => ({
        code: reason,
        severity: 'error',
        entryIndex: null,
        field: 'mailchimp.deliveryContract',
        message: `Mailchimp campaign delivery contract is blocked: ${reason}.`
      }))
    ];
    validation = {
      ...validation,
      issues,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length
    };
  }
  const accepted = acceptanceRequested && validation.errorCount === 0;
  const preview = buildPreview(validation);
  const workflowHandoff = buildWorkflowHandoff(validation, accepted, requestState, latestEntry);
  const persistedStateShape = buildPersistedStateShape({
    accepted,
    acceptanceRequested,
    boundaryContext,
    input,
    latestEntry,
    now,
    persistedState,
    validation
  });
  const continuationCheckpoint = buildClientContinuationCheckpoint({
    latestEntry,
    persistedStateShape,
    requestState,
    validation,
    workflowHandoff,
    now
  });
  validation = validateClientResumeEnvelope(validation, clientResumeEnvelope, continuationCheckpoint, now);
  const commandSemantics = buildCommandSemantics({
    accepted,
    boundaryContext,
    latestEntry,
    now,
    persistedState,
    requestState,
    validation
  });
  const statePersistence = buildStatePersistenceEnvelope({
    accepted,
    acceptanceRequested,
    commandSemantics,
    latestEntry,
    now,
    persistedState,
    persistedStateShape,
    validation
  });
  const clientResume = buildClientResumeContract({
    continuationCheckpoint,
    commandSemantics,
    latestEntry,
    now,
    persistedStateShape,
    requestState,
    resumeEnvelope: clientResumeEnvelope,
    validation,
    workflowHandoff
  });
  providerNegotiation = buildProviderNegotiation({
    commandSemantics,
    latestEntry,
    now,
    providerContract,
    requestState,
    validation
  });
  const mailchimpDeliveryContract = buildMailchimpCampaignDeliveryContract({
    accepted,
    boundaryContext,
    commandSemantics,
    latestEntry,
    mailchimpCampaign,
    now,
    providerNegotiation,
    validation
  });
  const recoveryPaths = buildRecoveryPaths({
    boundaryContext,
    persistedShape: persistedStateShape,
    commandSemantics,
    validation
  });
  const boundary = buildBoundaryAuditHandoff(boundaryContext, boundaryAccessPlan, validation, accepted);
  const operationalHealth = buildOperationalHealth({
    accepted,
    commandSemantics,
    input,
    now,
    persistedShape: persistedStateShape,
    validation
  });
  const lifecycleState = buildLifecycleState({
    accepted,
    commandSemantics,
    lifecycle: lifecycleControls,
    lifecycleCommand,
    now,
    operationalHealth,
    validation
  });
  const analyticsReport = buildAnalyticsReporting({
    accepted,
    boundaryContext,
    commandSemantics,
    historySnapshots: normalizeAnalyticsHistory(input),
    lifecycleState,
    latestEntry,
    now,
    operationalHealth,
    persistedStateShape,
    statePersistence,
    validation
  });
  const readiness = {
    readyForRecovery: accepted && lifecycleState.enabled && validation.errorCount === 0,
    readyForClientPreview: lifecycleState.enabled && (policy.allowPreviewWithoutAcceptance || accepted),
    readyForProofExport: lifecycleState.enabled
      && boundary.canExportProof
      && Boolean(latestEntry && latestEntry.digest)
      && providerNegotiation.status === 'negotiated'
      && operationalHealth.degradedMode.proofExportBlocked === false
      && (!mailchimpDeliveryContract.present || mailchimpDeliveryContract.readyForProofExport),
    readyForWorkflowHandoff: workflowHandoff.canContinue || workflowHandoff.state === 'repair',
    readyForLifecycleAcceptance: lifecycleState.canAcceptNow,
    readyForScheduledAcceptance: lifecycleState.canAutoAccept,
    readyForProviderSync: providerNegotiation.status === 'negotiated'
      && providerNegotiation.syncMetadata.syncDigestMatches,
    readyForExternalHandoff: providerNegotiation.externalHandoffState.ready,
    readyForMailchimpDelivery: mailchimpDeliveryContract.readyForAcceptance,
    restartSafe: statePersistence.restartSafeStatus.startsWith('restart_safe')
      && !['write_blocked', 'write_conflict', 'write_deferred_active_lease'].includes(statePersistence.status),
    restartSafeStatus: statePersistence.restartSafeStatus,
    status: lifecycleState.status === 'disabled'
      ? 'disabled'
      : lifecycleState.status === 'maintenance'
        ? 'maintenance'
        : lifecycleState.status === 'invalid_settings'
          ? 'invalid_settings'
          : validation.errorCount > 0
            ? 'blocked'
            : operationalHealth.status === 'unhealthy'
              ? 'unhealthy'
              : operationalHealth.status === 'degraded'
                ? 'degraded'
                : commandSemantics.status === 'replayed'
                  ? 'ready_replayed'
                  : accepted || persistedStateShape.acceptedSnapshot.reusable
                    ? 'ready'
                    : 'awaiting_acceptance'
  };
  const nextSteps = buildNextSteps(validation, accepted);
  const proofReceipt = buildProofReceipt({
    accepted,
    boundary,
    boundaryContext,
    commandSemantics,
    latestEntry,
    now,
    operationalHealth,
    persistedStateShape,
    providerNegotiation,
    readiness,
    validation
  });
  const clientReadinessSummary = buildClientReadinessSummary({
    accepted,
    acceptanceRequested,
    boundary,
    clientResume,
    lifecycleState,
    operationalHealth,
    preview,
    proofReceipt,
    providerNegotiation,
    readiness,
    validation,
    workflowHandoff
  });
  const mailchimpAcceptanceHandoff = buildMailchimpCampaignAcceptanceHandoff({
    accepted,
    acceptanceRequested,
    clientReadinessSummary,
    commandSemantics,
    latestEntry,
    mailchimpCampaign,
    mailchimpDeliveryContract,
    now,
    proofReceipt,
    requestState,
    validation,
    workflowHandoff
  });
  const clientWorkflow = buildClientWorkflowContract({
    accepted,
    acceptanceRequested,
    boundary,
    clientResume,
    clientReadinessSummary,
    commandSemantics,
    lifecycleState,
    nextSteps,
    operationalHealth,
    preview,
    proofReceipt,
    providerNegotiation,
    readiness,
    validation,
    workflowHandoff
  });
  const workflowHandoffDecision = buildWorkflowHandoffDecision({
    accepted,
    clientResume,
    clientWorkflow,
    lifecycleState,
    now,
    operationalHealth,
    proofReceipt,
    providerNegotiation,
    readiness,
    statePersistence,
    validation,
    workflowHandoff
  });
  const operatorRemediationPacket = buildOperatorRemediationPacket({
    clientReadinessSummary,
    commandSemantics,
    lifecycleState,
    now,
    operationalHealth,
    proofReceipt,
    providerNegotiation,
    readiness,
    statePersistence,
    validation,
    workflowHandoffDecision
  });
  const mailchimpRuntimeAdoption = buildMailchimpClientRuntimeAdoption({
    accepted,
    clientResume,
    mailchimpAcceptanceHandoff,
    mailchimpDeliveryContract,
    now,
    requestState,
    workflowHandoffDecision
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel append-only audit recovery contract',
    mode: accepted ? 'accepted' : validation.errorCount > 0 ? 'needs_repair' : 'preview',
    requestState,
    boundary,
    lifecycle: lifecycleState,
    mailchimpCampaign,
    mailchimpDeliveryContract,
    mailchimpAcceptanceHandoff,
    mailchimpRuntimeAdoption,
    operationalHealth,
    analyticsReport,
    persistedState: persistedStateShape,
    statePersistence,
    command: commandSemantics,
    providerNegotiation,
    evidence: validation.entries,
    preview,
    acceptance: {
      requested: acceptanceRequested,
      accepted,
      acceptedAt: accepted ? now : null,
      requestedBy: input.acceptance && input.acceptance.requestedBy ? String(input.acceptance.requestedBy) : null,
      reason: input.acceptance && input.acceptance.reason ? String(input.acceptance.reason) : null,
      blockedBy: accepted ? [] : validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)
    },
    workflowHandoff,
    workflowHandoffDecision,
    operatorRemediationPacket,
    clientResume,
    readiness,
    readinessSummary: clientReadinessSummary,
    clientWorkflow,
    validationSummary: {
      checkedAt: now,
      entryCount: validation.entries.length,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      timestampIntegrity: validation.timestampIntegrity,
      issues: validation.issues
    },
    proof: {
      ...proofReceipt,
      algorithm: proofReceipt.chain.algorithm,
      entryCount: proofReceipt.manifest.entryCount,
      latestDigest: proofReceipt.manifest.latestDigest,
      genesisDigest: proofReceipt.manifest.genesisDigest,
      appendOnly: proofReceipt.manifest.appendOnly,
      timestampIntegrity: proofReceipt.manifest.timestampIntegrity,
      timestampRange: proofReceipt.manifest.timestampRange,
      tenantScoped: boundaryContext.enforced,
      tenantId: proofReceipt.manifest.tenantId,
      workspaceId: proofReceipt.manifest.workspaceId,
      scopeKey: proofReceipt.manifest.scopeKey,
      boundaryAccessMode: proofReceipt.manifest.boundaryAccessMode,
      boundaryRedactionApplied: proofReceipt.manifest.boundaryRedactionApplied,
      workspaceTenantBindings: proofReceipt.manifest.workspaceTenantBindings,
      requireWorkspaceTenantBinding: proofReceipt.manifest.requireWorkspaceTenantBinding,
      providerContract: proofReceipt.manifest.providerId,
      syncMetadata: providerNegotiation.syncMetadata,
      serviceContract: providerNegotiation.serviceContract,
      externalHandoffState: providerNegotiation.externalHandoffState,
      productScope: mailchimpCampaign.present ? mailchimpCampaign.proofScope : null,
      mailchimpCampaign,
      mailchimpDeliveryContract,
      mailchimpRuntimeAdoption,
      warnings: proofReceipt.chain.warningCodes
    },
    recoveryPaths,
    nextSteps,
    clientContracts: {
      previewRoute: WORKFLOW_ROUTES.preview,
      acceptanceRoute: WORKFLOW_ROUTES.accept,
      validationRoute: WORKFLOW_ROUTES.validate,
      proofRoute: WORKFLOW_ROUTES.proof,
      requiredEvidenceFields: REQUIRED_ENTRY_FIELDS,
      timestampIntegrityContract: 'AppendOnlyAuditRecoveryTimestampIntegrity.v1',
      accepts: {
        evidence: 'Array<AppendOnlyAuditEntry>',
        acceptance: '{ requestedBy: string, reason?: string }',
        policy: '{ minEntries?: number, requireMonotonicTimestamps?: boolean, requireDigestChain?: boolean }',
        scope: '{ tenantId?: string, workspaceId?: string, allowedTenantIds?: string[], allowedWorkspaceIds?: string[], workspaceTenantBindings?: Array<{ workspaceId: string, tenantId: string }>, requireWorkspaceTenantBinding?: boolean }',
        lifecycle: 'AppendOnlyAuditRecoveryLifecycleSettings.v1',
        lifecycleCommand: 'AppendOnlyAuditRecoveryLifecycleCommand.v1',
        mailchimp: 'AppendOnlyAuditRecoveryMailchimpCampaignEnvelope.v1',
        mailchimpDeliveryContract: 'AppendOnlyAuditRecoveryMailchimpCampaignDeliveryContract.v1',
        mailchimpAcceptanceHandoff: 'AppendOnlyAuditRecoveryMailchimpCampaignAcceptanceHandoff.v1',
        mailchimpRuntimeAdoption: 'AppendOnlyAuditRecoveryMailchimpClientRuntimeAdoption.v1',
        settings: '{ lifecycle?: AppendOnlyAuditRecoveryLifecycleSettings.v1 }',
        controls: '{ lifecycle?: AppendOnlyAuditRecoveryLifecycleSettings.v1, lifecycleCommand?: AppendOnlyAuditRecoveryLifecycleCommand.v1 }',
        provider: 'AppendOnlyAuditRecoveryProviderContract.v1',
        integration: '{ provider?: AppendOnlyAuditRecoveryProviderContract.v1, sync?: AppendOnlyAuditRecoverySyncMetadata.v1, handoff?: AppendOnlyAuditRecoveryExternalHandoffState.v1 }',
        request: 'AppendOnlyAuditRecoveryRuntimeState',
        client: '{ view?: "preview"|"acceptance"|"proof"|"repair", requestId?: string, runtimeId?: string, capabilities?: string[], resume?: AppendOnlyAuditRecoveryClientResumeEnvelope.v1 }',
        resume: 'AppendOnlyAuditRecoveryClientResumeEnvelope.v1',
        operationalHealth: '{ failures?: AppendOnlyAuditRecoveryRuntimeFailure.v1[], degradedMode?: boolean }',
        failures: 'AppendOnlyAuditRecoveryRuntimeFailure.v1[]',
        retry: '{ attempt?: number, maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number }',
        workflowHandoffDecision: 'AppendOnlyAuditRecoveryWorkflowHandoffDecision.v1',
        operatorRemediationPacket: 'AppendOnlyAuditRecoveryOperatorRemediationPacket.v1'
      },
      providerCapabilities: {
        supported: HOSTED_KERNEL_PROVIDER_CAPABILITIES,
        serviceLevel: {
          contract: 'AppendOnlyAuditRecoveryProviderServiceLevel.v1',
          consistencyModes: Array.from(PROVIDER_CONSISTENCY_MODES),
          deliveryGuarantees: Array.from(PROVIDER_DELIVERY_GUARANTEES),
          authModes: Array.from(PROVIDER_AUTH_MODES),
          acceptanceRequires: {
            consistency: 'strong or bounded-staleness with matching sync digest',
            deliveryGuarantee: 'at-least-once or exactly-once',
            signedHandoff: 'signProof capability, signed-request auth, or mtls auth when required'
          }
        },
        requiredByCommand: {
          preview: requiredProviderCapabilities('preview', false),
          accept: requiredProviderCapabilities('accept', false),
          recover: requiredProviderCapabilities('recover', false),
          exportProof: requiredProviderCapabilities('export-proof', true)
        }
      },
      runtime: buildRuntimeContracts(
        requestState,
        boundary,
        providerNegotiation,
        clientResume,
        workflowHandoffDecision,
        proofReceipt,
        statePersistence,
        clientReadinessSummary
      ),
      workflow: {
        type: 'AppendOnlyAuditRecoveryClientWorkflow.v1',
        activeView: 'preview|acceptance|proof|repair',
        routePayloads: {
          preview: 'AppendOnlyAuditRecoveryPreviewPanel.v1',
          validate: 'AppendOnlyAuditRecoveryClientValidationSummary.v1',
          accept: 'AppendOnlyAuditRecoveryAcceptancePanel.v1',
          proof: 'AppendOnlyAuditRecoveryProof.v1',
          readiness: 'AppendOnlyAuditRecoveryClientReadinessSummary.v1'
        },
        productHandoffs: {
          mailchimpCampaignAcceptance: 'AppendOnlyAuditRecoveryMailchimpCampaignAcceptanceHandoff.v1'
        },
        value: clientWorkflow
      }
    }
  };
}

export default describeAppendOnlyLogSurface;
