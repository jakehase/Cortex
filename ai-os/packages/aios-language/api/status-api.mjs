const DEFAULT_PROVIDER_ID = 'mailchimp';
const DEFAULT_SERVICE = 'marketing-status';
const DEFAULT_API_VERSION = '2026-07';
const DEFAULT_REGION = 'us';

const STATUS_STATES = new Set([
  'unknown',
  'queued',
  'syncing',
  'healthy',
  'degraded',
  'recovering',
  'failed',
]);

const CAPABILITY_CATALOG = Object.freeze({
  listStatus: Object.freeze({
    contract: 'mailchimp.status.list',
    requires: Object.freeze(['audienceId']),
    produces: Object.freeze(['memberCount', 'lastChangedAt', 'syncCursor']),
  }),
  campaignStatus: Object.freeze({
    contract: 'mailchimp.status.campaign',
    requires: Object.freeze(['campaignId']),
    produces: Object.freeze(['sendState', 'deliveryState', 'lastChangedAt']),
  }),
  automationStatus: Object.freeze({
    contract: 'mailchimp.status.automation',
    requires: Object.freeze(['workflowId']),
    produces: Object.freeze(['workflowState', 'queueDepth', 'lastChangedAt']),
  }),
  webhookHealth: Object.freeze({
    contract: 'mailchimp.status.webhook',
    requires: Object.freeze(['webhookId']),
    produces: Object.freeze(['deliveryState', 'lastFailureAt', 'retryAfterSeconds']),
  }),
});

const RECOVERABLE_STATUSES = new Set(['queued', 'syncing', 'degraded', 'recovering', 'failed']);

function asRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function cleanToken(value) {
  return String(value ?? '').trim();
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

function hashContract(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mc-status-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeState(state) {
  const token = cleanToken(state || 'unknown').toLowerCase();
  return STATUS_STATES.has(token) ? token : 'unknown';
}

function normalizeProvider(provider = {}) {
  const raw = provider && typeof provider === 'object' ? provider : {};
  const id = cleanToken(raw.id || raw.providerId || DEFAULT_PROVIDER_ID).toLowerCase();
  const service = cleanToken(raw.service || raw.serviceName || DEFAULT_SERVICE).toLowerCase();
  const region = cleanToken(raw.region || raw.dataCenter || DEFAULT_REGION).toLowerCase();
  const apiVersion = cleanToken(raw.apiVersion || raw.version || DEFAULT_API_VERSION);
  const accountId = cleanToken(raw.accountId || raw.mailchimpAccountId || 'unbound-account');
  return { id, service, region, apiVersion, accountId };
}

function normalizeCapabilities(requestedCapabilities) {
  const requested = Array.isArray(requestedCapabilities) && requestedCapabilities.length > 0
    ? requestedCapabilities
    : Object.keys(CAPABILITY_CATALOG);
  const accepted = [];
  const rejected = [];
  for (const capability of requested) {
    const token = cleanToken(capability);
    if (Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, token)) {
      accepted.push(token);
    } else if (token) {
      rejected.push({ capability: token, reason: 'unsupported_mailchimp_status_capability' });
    }
  }
  return {
    accepted: Object.freeze([...new Set(accepted)].sort()),
    rejected: Object.freeze(rejected.sort((a, b) => a.capability.localeCompare(b.capability))),
  };
}

function normalizeSyncMetadata(sync = {}) {
  const raw = sync && typeof sync === 'object' ? sync : {};
  const cursor = cleanToken(raw.cursor || raw.syncCursor || '');
  const sourceUpdatedAt = cleanToken(raw.sourceUpdatedAt || raw.lastChangedAt || raw.updatedAt || '');
  const requestedAt = cleanToken(raw.requestedAt || raw.observedAt || '');
  const retryAfterSeconds = Number.isFinite(Number(raw.retryAfterSeconds))
    ? Math.max(0, Math.floor(Number(raw.retryAfterSeconds)))
    : 0;
  const batchSize = Number.isFinite(Number(raw.batchSize))
    ? Math.max(1, Math.floor(Number(raw.batchSize)))
    : 100;
  return {
    cursor: cursor || null,
    sourceUpdatedAt: sourceUpdatedAt || null,
    requestedAt: requestedAt || null,
    retryAfterSeconds,
    batchSize,
  };
}

function normalizeClientRuntime(runtime = {}) {
  const raw = runtime && typeof runtime === 'object' ? runtime : {};
  const request = raw.request && typeof raw.request === 'object' ? raw.request : {};
  const client = raw.client && typeof raw.client === 'object' ? raw.client : {};
  const workflow = raw.workflow && typeof raw.workflow === 'object' ? raw.workflow : {};
  const requestId = cleanToken(raw.requestId || request.id || request.requestId || '');
  const sessionId = cleanToken(raw.sessionId || client.sessionId || client.id || '');
  const actorId = cleanToken(raw.actorId || client.actorId || client.userId || '');
  const workflowId = cleanToken(raw.workflowId || workflow.id || workflow.workflowId || '');
  const continuationId = cleanToken(raw.continuationId || workflow.continuationId || '');
  const surface = cleanToken(raw.surface || client.surface || 'mailchimp-status');
  const locale = cleanToken(raw.locale || client.locale || 'en-US');
  const channel = cleanToken(raw.channel || workflow.channel || 'api');
  const intent = cleanToken(raw.intent || workflow.intent || 'status-handoff');
  const route = cleanToken(raw.route || workflow.route || '/mailchimp/status');
  return Object.freeze({
    requestId: requestId || null,
    sessionId: sessionId || null,
    actorId: actorId || null,
    workflowId: workflowId || null,
    continuationId: continuationId || null,
    surface,
    locale,
    channel,
    intent,
    route,
  });
}

function buildMemoryContract(provider, syncMetadata, state) {
  return {
    namespace: `provider.${provider.id}.${provider.service}.status`,
    partitionKey: `${provider.accountId}:${provider.region}`,
    retention: state === 'healthy' ? 'ephemeral' : 'recoverable',
    cursor: syncMetadata.cursor,
    fields: Object.freeze([
      'provider.id',
      'provider.accountId',
      'provider.region',
      'status.state',
      'sync.cursor',
      'sync.sourceUpdatedAt',
      'runtime.requestId',
      'runtime.sessionId',
      'runtime.workflowId',
      'handoff.externalState',
    ]),
  };
}

function buildKernelJob(provider, capabilities, syncMetadata, state) {
  const recoveryEligible = RECOVERABLE_STATUSES.has(state);
  return {
    queue: 'aios.provider.status',
    kind: 'provider.status.sync',
    provider: provider.id,
    service: provider.service,
    region: provider.region,
    priority: state === 'failed' ? 'high' : 'normal',
    idempotencyKey: hashContract({
      accountId: provider.accountId,
      capabilities: capabilities.accepted,
      cursor: syncMetadata.cursor,
      provider: provider.id,
      region: provider.region,
      service: provider.service,
    }),
    recovery: {
      eligible: recoveryEligible,
      retryAfterSeconds: recoveryEligible ? syncMetadata.retryAfterSeconds : 0,
      handoffReason: recoveryEligible ? `mailchimp_status_${state}` : 'mailchimp_status_terminal_healthy',
    },
  };
}

function buildVerifier(provider, capabilities, syncMetadata, state) {
  return {
    name: 'mailchimp.status.contract.verifier',
    deterministic: true,
    checks: Object.freeze([
      { code: 'provider_is_mailchimp', pass: provider.id === DEFAULT_PROVIDER_ID },
      { code: 'has_account_binding', pass: provider.accountId !== 'unbound-account' },
      { code: 'has_status_capability', pass: capabilities.accepted.length > 0 },
      { code: 'known_status_state', pass: STATUS_STATES.has(state) },
      { code: 'sync_batch_positive', pass: syncMetadata.batchSize > 0 },
    ]),
  };
}

function summarizeVerifier(verifier) {
  const failed = verifier.checks.filter((check) => !check.pass).map((check) => check.code);
  return {
    pass: failed.length === 0,
    failed,
  };
}

function buildExternalHandoff(provider, capabilities, syncMetadata, state, verifierSummary) {
  const externalState = state === 'healthy' && verifierSummary.pass ? 'ready' : 'needs_reconciliation';
  return {
    adapter: 'mailchimp',
    providerStatusEndpoint: `/providers/${provider.id}/${provider.service}/status`,
    externalState,
    statusHandoff: {
      claimState: state,
      cursor: syncMetadata.cursor,
      retryAfterSeconds: syncMetadata.retryAfterSeconds,
      acceptedCapabilities: capabilities.accepted,
      rejectedCapabilities: capabilities.rejected,
    },
  };
}

function buildRuntimeHandoff(provider, clientRuntime, syncMetadata, state, readiness, validationSummary) {
  const resumeToken = hashContract({
    accountId: provider.accountId,
    actorId: clientRuntime.actorId,
    continuationId: clientRuntime.continuationId,
    cursor: syncMetadata.cursor,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    state,
    workflowId: clientRuntime.workflowId,
  });
  const blocking = validationSummary.blockingCount > 0;
  const pending = readiness.ready ? [] : validationSummary.issues.map((issue) => issue.code);
  return Object.freeze({
    resumeToken,
    request: Object.freeze({
      id: clientRuntime.requestId,
      route: clientRuntime.route,
      surface: clientRuntime.surface,
      locale: clientRuntime.locale,
    }),
    client: Object.freeze({
      sessionId: clientRuntime.sessionId,
      actorId: clientRuntime.actorId,
      channel: clientRuntime.channel,
    }),
    workflow: Object.freeze({
      id: clientRuntime.workflowId,
      continuationId: clientRuntime.continuationId,
      intent: clientRuntime.intent,
      state: readiness.status,
      resumeAction: readiness.ready ? 'resume-mailchimp-status-workflow' : 'show-mailchimp-status-review',
    }),
    userVisible: Object.freeze({
      blocking,
      status: readiness.userVisibleState,
      message: blocking
        ? 'Mailchimp status needs account or capability review before handoff can continue.'
        : readiness.ready
          ? 'Mailchimp status handoff is ready to continue.'
          : 'Mailchimp status handoff is available for review.',
      pendingIssueCodes: Object.freeze(pending),
    }),
  });
}

function buildClaims(provider, capabilities, syncMetadata, state, verifierSummary) {
  return Object.freeze([
    {
      type: 'provider-status',
      subject: `${provider.id}:${provider.accountId}`,
      predicate: state,
      evidence: {
        apiVersion: provider.apiVersion,
        region: provider.region,
        sourceUpdatedAt: syncMetadata.sourceUpdatedAt,
        verifierPass: verifierSummary.pass,
      },
    },
    {
      type: 'capability-negotiation',
      subject: `${provider.id}:${provider.service}`,
      predicate: capabilities.rejected.length === 0 ? 'fully-negotiated' : 'partially-negotiated',
      evidence: {
        accepted: capabilities.accepted,
        rejected: capabilities.rejected,
      },
    },
  ]);
}

function statusLabelFor(state) {
  const labels = {
    unknown: 'Unknown',
    queued: 'Queued',
    syncing: 'Syncing',
    healthy: 'Healthy',
    degraded: 'Degraded',
    recovering: 'Recovering',
    failed: 'Failed',
  };
  return labels[state] || labels.unknown;
}

function describeCapability(capability) {
  const definition = CAPABILITY_CATALOG[capability];
  return Object.freeze({
    capability,
    contract: definition.contract,
    requires: definition.requires,
    produces: definition.produces,
    previewLabel: `${capability} -> ${definition.contract}`,
  });
}

function buildValidationSummary(provider, capabilities, syncMetadata, state, verifierSummary) {
  const issues = [];
  if (provider.id !== DEFAULT_PROVIDER_ID) {
    issues.push({
      severity: 'blocking',
      code: 'provider_is_not_mailchimp',
      field: 'provider.id',
      message: 'Status API preview only accepts Mailchimp provider status sources.',
      nextStepId: 'bind-mailchimp-provider',
    });
  }
  if (provider.accountId === 'unbound-account') {
    issues.push({
      severity: 'blocking',
      code: 'missing_mailchimp_account',
      field: 'provider.accountId',
      message: 'Bind a Mailchimp account before accepting the status handoff.',
      nextStepId: 'bind-mailchimp-provider',
    });
  }
  if (capabilities.accepted.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'no_supported_status_capabilities',
      field: 'capabilities',
      message: 'Request at least one supported Mailchimp status capability.',
      nextStepId: 'choose-status-capability',
    });
  }
  for (const rejected of capabilities.rejected) {
    issues.push({
      severity: 'warning',
      code: 'unsupported_status_capability',
      field: `capabilities.${rejected.capability}`,
      message: `${rejected.capability} is not part of the deterministic Mailchimp status catalog.`,
      nextStepId: 'review-rejected-capabilities',
    });
  }
  if (state === 'unknown') {
    issues.push({
      severity: 'warning',
      code: 'unknown_status_state',
      field: 'state',
      message: 'Status state was normalized to unknown; recovery will request reconciliation.',
      nextStepId: 'refresh-provider-status',
    });
  }
  if (RECOVERABLE_STATUSES.has(state) && syncMetadata.retryAfterSeconds === 0) {
    issues.push({
      severity: 'info',
      code: 'missing_retry_window',
      field: 'sync.retryAfterSeconds',
      message: 'No retry window was supplied; recovery can run immediately.',
      nextStepId: 'confirm-retry-policy',
    });
  }
  if (!syncMetadata.cursor && state !== 'healthy') {
    issues.push({
      severity: 'info',
      code: 'missing_sync_cursor',
      field: 'sync.cursor',
      message: 'No sync cursor was supplied; reconciliation will start from provider status metadata.',
      nextStepId: 'refresh-provider-status',
    });
  }
  const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return Object.freeze({
    pass: verifierSummary.pass && blockingCount === 0,
    issueCount: issues.length,
    blockingCount,
    warningCount,
    infoCount: issues.length - blockingCount - warningCount,
    issues: Object.freeze(issues),
  });
}

function buildAcceptanceContract(state, capabilities, verifierSummary, validationSummary, handoff) {
  const hasBlockingIssues = validationSummary.blockingCount > 0;
  const executionAccepted = verifierSummary.pass && !hasBlockingIssues && state === 'healthy';
  const recoveryAccepted = verifierSummary.pass && !hasBlockingIssues && RECOVERABLE_STATUSES.has(state);
  const previewAccepted = verifierSummary.pass && capabilities.accepted.length > 0 && !hasBlockingIssues;
  const mode = executionAccepted ? 'accept-ready'
    : recoveryAccepted ? 'accept-with-recovery'
      : previewAccepted ? 'preview-only'
        : 'blocked';
  return Object.freeze({
    accepted: executionAccepted || recoveryAccepted,
    mode,
    previewAccepted,
    executionAccepted,
    recoveryAccepted,
    handoffAccepted: handoff.externalState === 'ready' || recoveryAccepted,
    requiredCapabilityCount: capabilities.accepted.length,
    rejectedCapabilityCount: capabilities.rejected.length,
    blockingReasons: Object.freeze(validationSummary.issues
      .filter((issue) => issue.severity === 'blocking')
      .map((issue) => issue.code)),
  });
}

function buildReadinessContract(state, syncMetadata, acceptance, validationSummary) {
  const status = acceptance.executionAccepted ? 'ready'
    : acceptance.recoveryAccepted ? 'recovery-ready'
      : validationSummary.blockingCount > 0 ? 'blocked'
        : 'preview';
  const reasons = [];
  if (acceptance.executionAccepted) {
    reasons.push('mailchimp_status_healthy');
  }
  if (acceptance.recoveryAccepted) {
    reasons.push(`mailchimp_status_${state}_recoverable`);
  }
  if (validationSummary.blockingCount > 0) {
    reasons.push('blocking_validation_issues');
  }
  if (validationSummary.warningCount > 0) {
    reasons.push('non_blocking_validation_warnings');
  }
  return Object.freeze({
    status,
    ready: status === 'ready' || status === 'recovery-ready',
    userVisibleState: statusLabelFor(state),
    retryAfterSeconds: acceptance.recoveryAccepted ? syncMetadata.retryAfterSeconds : 0,
    reasons: Object.freeze(reasons),
  });
}

function buildNextSteps(provider, capabilities, syncMetadata, state, acceptance, validationSummary) {
  const steps = [];
  if (provider.accountId === 'unbound-account' || provider.id !== DEFAULT_PROVIDER_ID) {
    steps.push({
      id: 'bind-mailchimp-provider',
      label: 'Connect Mailchimp account',
      action: 'open-provider-connection',
      target: provider.id,
      blocking: true,
    });
  }
  if (capabilities.accepted.length === 0) {
    steps.push({
      id: 'choose-status-capability',
      label: 'Choose a supported status capability',
      action: 'edit-capabilities',
      target: 'capabilities',
      blocking: true,
    });
  }
  if (capabilities.rejected.length > 0) {
    steps.push({
      id: 'review-rejected-capabilities',
      label: 'Review unsupported capabilities',
      action: 'review-capability-negotiation',
      target: 'capabilities.rejected',
      blocking: false,
    });
  }
  if (state === 'unknown' || (!syncMetadata.cursor && state !== 'healthy')) {
    steps.push({
      id: 'refresh-provider-status',
      label: 'Refresh Mailchimp status snapshot',
      action: 'run-status-sync',
      target: provider.accountId,
      blocking: false,
    });
  }
  if (RECOVERABLE_STATUSES.has(state)) {
    steps.push({
      id: 'accept-recovery-handoff',
      label: acceptance.recoveryAccepted ? 'Accept recovery handoff' : 'Prepare recovery handoff',
      action: 'accept-status-handoff',
      target: syncMetadata.cursor || provider.accountId,
      blocking: validationSummary.blockingCount > 0,
    });
  }
  if (validationSummary.issueCount === 0 && acceptance.executionAccepted) {
    steps.push({
      id: 'accept-status-preview',
      label: 'Accept status contract',
      action: 'accept-status-contract',
      target: provider.accountId,
      blocking: false,
    });
  }
  return Object.freeze(steps);
}

function buildPreviewContract(provider, capabilities, syncMetadata, state, acceptance, readiness, validationSummary, nextSteps) {
  return Object.freeze({
    title: 'Mailchimp status preview',
    providerLabel: `${provider.id}/${provider.service}/${provider.region}`,
    accountLabel: provider.accountId,
    statusLabel: statusLabelFor(state),
    state,
    readiness: readiness.status,
    accepted: acceptance.accepted,
    externalState: readiness.ready ? 'actionable' : 'review_required',
    capabilityPreview: Object.freeze(capabilities.accepted.map(describeCapability)),
    rejectedCapabilityPreview: capabilities.rejected,
    syncPreview: {
      cursor: syncMetadata.cursor,
      sourceUpdatedAt: syncMetadata.sourceUpdatedAt,
      retryAfterSeconds: readiness.retryAfterSeconds,
      batchSize: syncMetadata.batchSize,
    },
    validationBadge: validationSummary.blockingCount > 0 ? 'blocked'
      : validationSummary.warningCount > 0 ? 'needs-review'
        : 'validated',
    nextStepIds: Object.freeze(nextSteps.map((step) => step.id)),
  });
}

export function compileMailchimpStatusContract(source = {}) {
  const input = asRecord(source, 'source');
  const provider = normalizeProvider(input.provider);
  const state = normalizeState(input.state || input.status || input.providerState);
  const capabilities = normalizeCapabilities(input.capabilities || input.requestedCapabilities);
  const syncMetadata = normalizeSyncMetadata(input.sync || input.syncMetadata);
  const clientRuntime = normalizeClientRuntime(input.runtime || input.clientRuntime || input.requestContext);
  const memory = buildMemoryContract(provider, syncMetadata, state);
  const kernelJob = buildKernelJob(provider, capabilities, syncMetadata, state);
  const verifier = buildVerifier(provider, capabilities, syncMetadata, state);
  const verifierSummary = summarizeVerifier(verifier);
  const handoff = buildExternalHandoff(provider, capabilities, syncMetadata, state, verifierSummary);
  const claims = buildClaims(provider, capabilities, syncMetadata, state, verifierSummary);
  const validationSummary = buildValidationSummary(provider, capabilities, syncMetadata, state, verifierSummary);
  const acceptance = buildAcceptanceContract(state, capabilities, verifierSummary, validationSummary, handoff);
  const readiness = buildReadinessContract(state, syncMetadata, acceptance, validationSummary);
  const nextSteps = buildNextSteps(provider, capabilities, syncMetadata, state, acceptance, validationSummary);
  const runtimeHandoff = buildRuntimeHandoff(
    provider,
    clientRuntime,
    syncMetadata,
    state,
    readiness,
    validationSummary,
  );
  const preview = buildPreviewContract(
    provider,
    capabilities,
    syncMetadata,
    state,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
  );
  const contract = {
    contractVersion: 'aios.status-api.v1',
    provider,
    state,
    clientRuntime,
    capabilities,
    syncMetadata,
    kernelJob,
    memory,
    verifier,
    verifierSummary,
    handoff,
    claims,
    validationSummary,
    acceptance,
    readiness,
    runtimeHandoff,
    nextSteps,
    preview,
  };
  return Object.freeze({
    ...contract,
    contractId: hashContract(contract),
  });
}

export function previewMailchimpStatusContract(source = {}) {
  const contract = compileMailchimpStatusContract(source);
  return Object.freeze({
    contractId: contract.contractId,
    preview: contract.preview,
    acceptance: contract.acceptance,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
    validationSummary: contract.validationSummary,
    nextSteps: contract.nextSteps,
  });
}

export function negotiateMailchimpStatusCapabilities(requestedCapabilities = []) {
  return normalizeCapabilities(requestedCapabilities);
}

export function recoverMailchimpStatusHandoff(source = {}) {
  const contract = compileMailchimpStatusContract(source);
  return Object.freeze({
    contractId: contract.contractId,
    job: contract.kernelJob,
    handoff: contract.handoff,
    verifier: contract.verifierSummary,
    memory: contract.memory,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
    acceptance: contract.acceptance,
    validationSummary: contract.validationSummary,
    nextSteps: contract.nextSteps,
  });
}

export function selfCheckMailchimpStatusApi() {
  const contract = compileMailchimpStatusContract({
    provider: { accountId: 'self-check-account' },
    state: 'degraded',
    capabilities: ['listStatus', 'webhookHealth', 'unknownStatus'],
    sync: { cursor: 'cursor-1', retryAfterSeconds: 30, batchSize: 25 },
    runtime: {
      requestId: 'req-self-check',
      sessionId: 'session-self-check',
      workflowId: 'workflow-self-check',
      continuationId: 'continue-self-check',
    },
  });
  return Object.freeze({
    pass: contract.provider.id === DEFAULT_PROVIDER_ID
      && contract.capabilities.accepted.includes('listStatus')
      && contract.capabilities.rejected.length === 1
      && contract.kernelJob.recovery.eligible
      && contract.handoff.externalState === 'needs_reconciliation'
      && contract.acceptance.recoveryAccepted
      && contract.readiness.status === 'recovery-ready'
      && contract.runtimeHandoff.workflow.resumeAction === 'resume-mailchimp-status-workflow'
      && contract.runtimeHandoff.request.id === 'req-self-check'
      && contract.preview.validationBadge === 'needs-review'
      && contract.nextSteps.some((step) => step.id === 'accept-recovery-handoff')
      && contract.verifierSummary.pass,
    contractId: contract.contractId,
    acceptedCapabilities: contract.capabilities.accepted,
    rejectedCapabilities: contract.capabilities.rejected,
    readiness: contract.readiness.status,
    validationBadge: contract.preview.validationBadge,
  });
}

export const mailchimpStatusApi = Object.freeze({
  capabilityCatalog: CAPABILITY_CATALOG,
  compile: compileMailchimpStatusContract,
  negotiateCapabilities: negotiateMailchimpStatusCapabilities,
  preview: previewMailchimpStatusContract,
  recoverHandoff: recoverMailchimpStatusHandoff,
  normalizeRuntime: normalizeClientRuntime,
  selfCheck: selfCheckMailchimpStatusApi,
});

export default mailchimpStatusApi;
