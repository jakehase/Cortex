const CONTRACT_VERSION = 'aios.cli-run-dry.v1';

const DEFAULT_ADAPTER_STATUS = Object.freeze({
  name: 'cli-run-dry',
  state: 'available',
  recovered: false,
  handoff: 'none',
});

const CLAIM_KEY_ORDER = Object.freeze([
  'acceptance',
  'capabilities',
  'client',
  'claim',
  'job',
  'memory',
  'nextSteps',
  'persistence',
  'preview',
  'provider',
  'readiness',
  'recovery',
  'status',
  'tenant',
  'validationSummary',
  'verifier',
  'version',
]);

const MAILCHIMP_PROVIDER = 'mailchimp';
const MAILCHIMP_SERVICE_CAPABILITIES = Object.freeze({
  audience: Object.freeze(['mailchimp.audience.read', 'mailchimp.member.preview', 'mailchimp.sync.status']),
  campaign: Object.freeze(['mailchimp.campaign.read', 'mailchimp.report.preview', 'mailchimp.sync.status']),
  template: Object.freeze(['mailchimp.template.read', 'mailchimp.asset.preview', 'mailchimp.sync.status']),
});

const MAILCHIMP_OPERATION_CAPABILITIES = Object.freeze({
  archive: Object.freeze(['mailchimp.member.archive.preview']),
  export: Object.freeze(['mailchimp.export.preview']),
  preview: Object.freeze(['mailchimp.preview']),
  sync: Object.freeze(['mailchimp.sync.preview']),
  upsert: Object.freeze(['mailchimp.member.upsert.preview']),
});

const TENANT_ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze(['provider.mailchimp.audience.read', 'provider.mailchimp.campaign.read', 'provider.mailchimp.template.read', 'tenant.audit.read', 'tenant.workspace.read']),
  operator: Object.freeze(['provider.mailchimp.audience.read', 'provider.mailchimp.campaign.read', 'provider.mailchimp.template.read', 'tenant.audit.read', 'tenant.workspace.read', 'tenant.workflow.resume']),
  editor: Object.freeze(['provider.mailchimp.audience.read', 'provider.mailchimp.campaign.read', 'provider.mailchimp.template.read', 'tenant.audit.read', 'tenant.workspace.read', 'tenant.workflow.resume', 'tenant.preview.accept']),
  admin: Object.freeze(['provider.mailchimp.audience.read', 'provider.mailchimp.campaign.read', 'provider.mailchimp.template.read', 'tenant.audit.read', 'tenant.workspace.read', 'tenant.workflow.resume', 'tenant.preview.accept', 'tenant.boundary.override']),
});

const MAILCHIMP_OPERATION_PERMISSIONS = Object.freeze({
  archive: Object.freeze(['tenant.workspace.read', 'tenant.preview.accept']),
  export: Object.freeze(['tenant.workspace.read', 'tenant.preview.accept']),
  preview: Object.freeze(['tenant.workspace.read']),
  sync: Object.freeze(['tenant.workspace.read', 'tenant.workflow.resume']),
  upsert: Object.freeze(['tenant.workspace.read', 'tenant.preview.accept']),
});

export class CliRunDryContractError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'CliRunDryContractError';
    this.issues = issues;
  }
}

export function normalizeCliRunDrySource(source) {
  if (typeof source !== 'string') {
    throw new CliRunDryContractError('cli-run-dry source must be a string', [
      { code: 'source.type', expected: 'string', received: typeof source },
    ]);
  }

  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .join('\n');
}

export function parseCliRunDrySource(source) {
  const normalized = normalizeCliRunDrySource(source);
  const fields = new Map();

  if (normalized.length === 0) {
    return fields;
  }

  for (const [index, line] of normalized.split('\n').entries()) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new CliRunDryContractError('cli-run-dry source line must use key: value syntax', [
        { code: 'source.syntax', line: index + 1, value: line },
      ]);
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (!/^[a-z][a-z0-9.-]*$/.test(key)) {
      throw new CliRunDryContractError('cli-run-dry source key is not deterministic', [
        { code: 'source.key', line: index + 1, key },
      ]);
    }

    if (fields.has(key)) {
      throw new CliRunDryContractError('cli-run-dry source key must be unique', [
        { code: 'source.duplicate', line: index + 1, key },
      ]);
    }

    fields.set(key, value);
  }

  return fields;
}

export function compileCliRunDryContract(source, options = {}) {
  const fields = parseCliRunDrySource(source);
  const adapterStatus = normalizeAdapterStatus(options.adapterStatus);
  const job = buildJobContract(fields, options);
  const provider = buildProviderContract(fields, options, job, adapterStatus);
  const client = buildClientRuntimeContract(fields, options, job, provider, adapterStatus);
  const tenant = buildTenantBoundaryContract(fields, options, provider, client);
  const capabilities = buildCapabilityContract(fields, options, provider, tenant);
  const memory = buildMemoryContract(fields, options, provider, tenant);
  const verifier = buildVerifierContract(fields, options, job, capabilities, memory, provider, client, tenant);
  const recovery = buildRecoveryContract(fields, adapterStatus, verifier, provider, client, tenant);
  const persistence = buildPersistenceContract(fields, options, job, provider, client, recovery, verifier, tenant);
  const status = buildStatusHandoff(adapterStatus, recovery, verifier, provider, client, persistence, tenant);
  const preview = buildPreviewContract(job, capabilities, memory, provider, status, client, persistence, tenant);
  const acceptance = buildAcceptanceContract(job, capabilities, memory, provider, recovery, status, preview, client, persistence, tenant);
  const readiness = buildReadinessContract(acceptance, provider, recovery, status, client, persistence, tenant);
  const nextSteps = buildNextStepContract(provider, recovery, status, readiness, acceptance, client, persistence, tenant);
  const validationSummary = buildValidationSummaryContract(job, capabilities, memory, provider, verifier, status, acceptance, readiness, nextSteps, client, persistence, tenant);
  const claim = buildClaimContract(job, capabilities, memory, verifier, recovery, status, provider, acceptance, readiness, client, persistence, tenant);
  const contract = orderContractKeys({
    version: CONTRACT_VERSION,
    job,
    client,
    capabilities,
    memory,
    provider,
    tenant,
    verifier,
    recovery,
    persistence,
    status,
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    claim,
  });

  const issues = validateCliRunDryContract(contract);
  if (issues.length > 0) {
    throw new CliRunDryContractError('compiled cli-run-dry contract failed validation', issues);
  }

  return contract;
}

export function validateCliRunDryContract(contract) {
  const issues = [];

  if (!isPlainObject(contract)) {
    return [{ code: 'contract.type', expected: 'object' }];
  }

  requireString(contract.version, 'version', issues);
  requireString(contract.job?.id, 'job.id', issues);
  requireString(contract.job?.command, 'job.command', issues);
  requireArray(contract.job?.args, 'job.args', issues);
  requireString(contract.job?.mode, 'job.mode', issues);
  requireArray(contract.capabilities?.required, 'capabilities.required', issues);
  requireArray(contract.capabilities?.provided, 'capabilities.provided', issues);
  requireString(contract.client?.request?.id, 'client.request.id', issues);
  requireString(contract.client?.request?.source, 'client.request.source', issues);
  requireString(contract.client?.workflow?.id, 'client.workflow.id', issues);
  requireString(contract.client?.workflow?.step, 'client.workflow.step', issues);
  requireString(contract.client?.workflow?.state, 'client.workflow.state', issues);
  requireString(contract.client?.handoff?.state, 'client.handoff.state', issues);
  requireArray(contract.memory?.reads, 'memory.reads', issues);
  requireArray(contract.memory?.writes, 'memory.writes', issues);
  requireString(contract.provider?.name, 'provider.name', issues);
  requireString(contract.provider?.service, 'provider.service', issues);
  requireString(contract.provider?.operation, 'provider.operation', issues);
  requireString(contract.provider?.sync?.mode, 'provider.sync.mode', issues);
  requireArray(contract.provider?.negotiation?.required, 'provider.negotiation.required', issues);
  requireArray(contract.provider?.negotiation?.provided, 'provider.negotiation.provided', issues);
  requireArray(contract.provider?.negotiation?.missing, 'provider.negotiation.missing', issues);
  requireString(contract.tenant?.id, 'tenant.id', issues);
  requireString(contract.tenant?.workspace?.id, 'tenant.workspace.id', issues);
  requireString(contract.tenant?.actor?.role, 'tenant.actor.role', issues);
  requireArray(contract.tenant?.permissions?.required, 'tenant.permissions.required', issues);
  requireArray(contract.tenant?.permissions?.provided, 'tenant.permissions.provided', issues);
  requireArray(contract.tenant?.permissions?.missing, 'tenant.permissions.missing', issues);
  requireString(contract.tenant?.isolation?.state, 'tenant.isolation.state', issues);
  requireString(contract.tenant?.audit?.eventId, 'tenant.audit.eventId', issues);
  requireArray(contract.verifier?.checks, 'verifier.checks', issues);
  requireString(contract.recovery?.strategy, 'recovery.strategy', issues);
  requireString(contract.persistence?.stateKey, 'persistence.stateKey', issues);
  requireString(contract.persistence?.commandKey, 'persistence.commandKey', issues);
  requireString(contract.persistence?.statusKey, 'persistence.statusKey', issues);
  requireString(contract.persistence?.mode, 'persistence.mode', issues);
  requireString(contract.persistence?.restore?.state, 'persistence.restore.state', issues);
  requireString(contract.persistence?.restore?.resumeToken, 'persistence.restore.resumeToken', issues);
  requireArray(contract.persistence?.records, 'persistence.records', issues);
  requireString(contract.status?.state, 'status.state', issues);
  requireString(contract.preview?.id, 'preview.id', issues);
  requireString(contract.preview?.summary, 'preview.summary', issues);
  requireArray(contract.preview?.sections, 'preview.sections', issues);
  requireString(contract.acceptance?.decision, 'acceptance.decision', issues);
  requireArray(contract.acceptance?.criteria, 'acceptance.criteria', issues);
  requireString(contract.readiness?.state, 'readiness.state', issues);
  requireArray(contract.validationSummary?.blockingIssues, 'validationSummary.blockingIssues', issues);
  requireArray(contract.validationSummary?.warnings, 'validationSummary.warnings', issues);
  requireArray(contract.nextSteps, 'nextSteps', issues);
  requireString(contract.claim?.id, 'claim.id', issues);

  if (contract.version !== CONTRACT_VERSION) {
    issues.push({ code: 'version.unsupported', expected: CONTRACT_VERSION, received: contract.version });
  }

  if (contract.job?.mode !== 'dry-run') {
    issues.push({ code: 'job.mode', expected: 'dry-run', received: contract.job?.mode });
  }

  if (contract.memory?.writes?.length > 0) {
    issues.push({ code: 'memory.writes', expected: 'no writes during dry-run', received: contract.memory.writes });
  }

  validateClientRuntimeContract(contract, issues);
  validatePersistenceContract(contract, issues);
  validateTenantBoundaryContract(contract, issues);

  if (contract.status?.state === 'blocked' && contract.recovery?.handoff !== 'adapter') {
    issues.push({ code: 'status.handoff', expected: 'adapter handoff when blocked' });
  }

  if (contract.provider?.name === MAILCHIMP_PROVIDER) {
    validateMailchimpProviderContract(contract, issues);
  }

  validatePreviewAcceptanceContract(contract, issues);

  return issues;
}

export function createCliRunDrySelfCheck(source = 'job: self-check\ncommand: noop') {
  try {
    const contract = compileCliRunDryContract(source);
    return {
      ok: true,
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      issues: [],
      status: contract.status,
      readiness: contract.readiness,
      nextSteps: contract.nextSteps,
    };
  } catch (error) {
    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      issues: error instanceof CliRunDryContractError ? error.issues : [{ code: 'selfcheck.error', message: error.message }],
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
      readiness: { state: 'blocked', score: 0, reason: 'selfcheck-error' },
      nextSteps: [{ action: 'inspect-source', label: 'Inspect source contract', reason: 'selfcheck-error', target: 'source' }],
    };
  }
}

export function createMailchimpCliRunDrySelfCheck(options = {}) {
  const source = [
    'job: mailchimp-self-check',
    'command: preview',
    'provider: mailchimp',
    'service: audience',
    'operation: sync',
    'sync-cursor: self-check-cursor',
  ].join('\n');

  try {
    const contract = compileCliRunDryContract(source, {
      ...options,
      providerCapabilities: sortUnique([
        ...splitList(options.providerCapabilities ?? options.mailchimpCapabilities ?? ''),
        'mailchimp.audience.read',
        'mailchimp.member.preview',
        'mailchimp.sync.preview',
        'mailchimp.sync.status',
      ]),
    });

    return {
      ok: true,
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      provider: contract.provider,
      issues: [],
      status: contract.status,
      readiness: contract.readiness,
      nextSteps: contract.nextSteps,
    };
  } catch (error) {
    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      provider: { name: MAILCHIMP_PROVIDER, service: 'audience', operation: 'sync' },
      issues: error instanceof CliRunDryContractError ? error.issues : [{ code: 'mailchimp.selfcheck.error', message: error.message }],
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
      readiness: { state: 'blocked', score: 0, reason: 'mailchimp-selfcheck-error' },
      nextSteps: [{ action: 'inspect-mailchimp-source', label: 'Inspect Mailchimp dry run source', reason: 'mailchimp-selfcheck-error', target: 'source' }],
    };
  }
}

export function createCliRunDryPreview(source, options = {}) {
  try {
    const contract = compileCliRunDryContract(source, options);
    return {
      ok: true,
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      preview: contract.preview,
      acceptance: contract.acceptance,
      readiness: contract.readiness,
      validationSummary: contract.validationSummary,
      nextSteps: contract.nextSteps,
      status: contract.status,
    };
  } catch (error) {
    const issues = error instanceof CliRunDryContractError ? error.issues : [{ code: 'preview.error', message: error.message }];

    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      preview: {
        id: 'preview_uncompiled',
        summary: 'Dry run preview could not be compiled.',
        sections: [],
        tone: 'critical',
      },
      acceptance: {
        decision: 'blocked',
        accepted: false,
        requiresOperatorAcceptance: true,
        criteria: issues.map((issue, index) => ({
          id: stableId('criterion', ['compile-error', String(index), issue.code || 'unknown']),
          label: issue.code || 'compile error',
          state: 'blocked',
          required: true,
          evidence: issue.path || issue.line || issue.message || 'compile-error',
        })),
      },
      readiness: { state: 'blocked', score: 0, reason: 'compile-error' },
      validationSummary: {
        ok: false,
        checkedContract: false,
        blockingIssues: issues,
        warnings: [],
        counters: { checks: 0, criteria: issues.length, nextSteps: 1 },
      },
      nextSteps: [{ action: 'inspect-source', label: 'Inspect source contract', reason: 'compile-error', target: 'source' }],
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
    };
  }
}

export function createCliRunDryWorkflowHandoff(source, options = {}) {
  try {
    const contract = compileCliRunDryContract(source, options);

    return {
      ok: true,
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      request: contract.client.request,
      workflow: contract.client.workflow,
      handoff: contract.client.handoff,
      status: contract.status,
      readiness: contract.readiness,
      nextSteps: contract.nextSteps.filter((step) => [
        'continue-workflow',
        'handoff-to-adapter',
        'resume-client-workflow',
      ].includes(step.action)),
    };
  } catch (error) {
    const issues = error instanceof CliRunDryContractError ? error.issues : [{ code: 'workflow-handoff.error', message: error.message }];

    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      request: null,
      workflow: { id: null, step: null, state: 'blocked', intent: 'dry-run-preview', continuationToken: null },
      handoff: {
        state: 'pending',
        target: 'runtime',
        reason: 'compile-error',
        resumeToken: null,
        checkpoints: [{ id: 'compile-contract', label: 'Compile dry run contract', state: 'blocked', evidence: issues[0]?.code || 'compile-error' }],
      },
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
      readiness: { state: 'blocked', score: 0, reason: 'compile-error' },
      nextSteps: [{ action: 'inspect-source', label: 'Inspect source contract', reason: 'compile-error', target: 'source' }],
      issues,
    };
  }
}

export function createCliRunDryTenantBoundaryPreview(source, options = {}) {
  try {
    const contract = compileCliRunDryContract(source, options);

    return {
      ok: contract.tenant.isolation.state === 'allowed',
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      tenant: contract.tenant,
      status: contract.status,
      readiness: contract.readiness,
      nextSteps: contract.nextSteps.filter((step) => [
        'review-tenant-boundary',
        'grant-tenant-permissions',
        'restore-dry-run-state',
        'handoff-to-adapter',
      ].includes(step.action)),
    };
  } catch (error) {
    const issues = error instanceof CliRunDryContractError ? error.issues : [{ code: 'tenant-boundary.error', message: error.message }];

    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      tenant: {
        id: 'tenant-uncompiled',
        workspace: { id: 'workspace-uncompiled', allowed: false, allowedWorkspaces: [] },
        actor: { id: 'actor-uncompiled', role: 'viewer' },
        permissions: { required: [], provided: [], missing: [] },
        isolation: { state: 'blocked', reason: 'compile-error', issues },
        audit: { eventId: stableId('tenant-audit', issues.map((issue) => issue.code || 'compile-error')), records: [] },
      },
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
      readiness: { state: 'blocked', score: 0, reason: 'compile-error' },
      nextSteps: [{ action: 'inspect-source', label: 'Inspect source contract', reason: 'compile-error', target: 'source' }],
      issues,
    };
  }
}

export function createCliRunDryPersistedState(source, options = {}) {
  try {
    const contract = compileCliRunDryContract(source, options);

    return {
      ok: true,
      version: CONTRACT_VERSION,
      contractId: contract.claim.id,
      request: contract.client.request,
      workflow: contract.client.workflow,
      persistence: contract.persistence,
      status: contract.status,
      recovery: contract.recovery,
      nextSteps: contract.nextSteps.filter((step) => [
        'persist-dry-run-state',
        'restore-dry-run-state',
        'resume-client-workflow',
        'handoff-to-adapter',
      ].includes(step.action)),
    };
  } catch (error) {
    const issues = error instanceof CliRunDryContractError ? error.issues : [{ code: 'persistence.error', message: error.message }];

    return {
      ok: false,
      version: CONTRACT_VERSION,
      contractId: null,
      request: null,
      workflow: { id: null, step: null, state: 'blocked', intent: 'dry-run-preview', continuationToken: null },
      persistence: {
        stateKey: 'cli-run-dry.uncompiled',
        commandKey: 'cli-run-dry.uncompiled.command',
        statusKey: 'cli-run-dry.uncompiled.status',
        mode: 'read-through',
        restartSafe: false,
        restore: {
          state: 'blocked',
          canResume: false,
          resumeToken: 'none',
          reason: 'compile-error',
          checkpoint: 'compile-contract',
        },
        records: [],
        digest: stableId('persistence', ['compile-error', ...issues.map((issue) => issue.code || 'unknown')]),
      },
      status: { ...DEFAULT_ADAPTER_STATUS, state: 'blocked', handoff: 'runtime' },
      recovery: {
        strategy: 'handoff',
        handoff: 'adapter',
        reason: 'compile-error',
        adapter: DEFAULT_ADAPTER_STATUS.name,
        external: { target: DEFAULT_ADAPTER_STATUS.name, required: true, state: 'pending', reason: 'compile-error', metadata: {} },
        resume: { state: 'pending', target: 'runtime', reason: 'compile-error', resumeToken: null, checkpoints: [] },
      },
      nextSteps: [{ action: 'inspect-source', label: 'Inspect source contract', reason: 'compile-error', target: 'source' }],
      issues,
    };
  }
}

function buildJobContract(fields, options) {
  const command = fieldOrOption(fields, options, 'command', 'noop');
  const args = splitList(fieldOrOption(fields, options, 'args', ''));
  const idSeed = fieldOrOption(fields, options, 'job', command);

  return {
    id: stableId('job', [idSeed, command, ...args]),
    command,
    args,
    mode: 'dry-run',
    timeoutMs: toPositiveInteger(fieldOrOption(fields, options, 'timeout-ms', 30000), 30000),
  };
}

function buildCapabilityContract(fields, options, provider, tenant) {
  const required = splitList(fieldOrOption(fields, options, 'requires', 'kernel.job,adapter.status'));
  const provided = splitList(fieldOrOption(fields, options, 'provides', 'contract.preview'));
  const providerRequired = provider?.negotiation?.required || [];
  const providerProvided = provider?.negotiation?.provided || [];
  const tenantRequired = tenant?.capabilities?.required || [];
  const tenantProvided = tenant?.capabilities?.provided || [];

  return {
    required: sortUnique([...required, ...providerRequired, ...tenantRequired]),
    provided: sortUnique([...provided, ...providerProvided, ...tenantProvided]),
    negotiated: provider?.negotiation || {
      provider: 'generic',
      required: [],
      provided: [],
      missing: [],
      state: 'satisfied',
    },
  };
}

function buildMemoryContract(fields, options, provider, tenant) {
  const reads = splitList(fieldOrOption(fields, options, 'reads', 'kernel.status'));
  const providerReads = provider?.sync?.memoryKeys || [];
  const tenantReads = tenant?.memoryKeys || [];

  return {
    reads: sortUnique([...reads, ...providerReads, ...tenantReads]),
    writes: [],
    policy: 'read-only',
  };
}

function buildTenantBoundaryContract(fields, options, provider, client) {
  const tenantId = normalizeTenantIdentifier(fieldOrOption(fields, options, 'tenant-id', 'tenant-default'), 'tenant-default');
  const workspaceId = normalizeTenantIdentifier(fieldOrOption(fields, options, 'workspace-id', fieldOrOption(fields, options, 'workspace', 'workspace-default')), 'workspace-default');
  const sourceTenantId = normalizeTenantIdentifier(fieldOrOption(fields, options, 'source-tenant-id', tenantId), tenantId);
  const actorId = normalizeClientIdentifier(fieldOrOption(fields, options, 'actor-id', fieldOrOption(fields, options, 'user-id', 'actor-cli')), 'actor-cli');
  const role = normalizeTenantRole(fieldOrOption(fields, options, 'role', 'operator'));
  const allowedWorkspaces = normalizeAllowedWorkspaces(fieldOrOption(fields, options, 'allowed-workspaces', workspaceId), workspaceId);
  const rolePermissions = TENANT_ROLE_PERMISSIONS[role] || TENANT_ROLE_PERMISSIONS.viewer;
  const explicitPermissions = splitList(fieldOrOption(fields, options, 'permissions', options.permissionGrants || ''));
  const requiredPermissions = tenantRequiredPermissions(provider);
  const providedPermissions = sortUnique([...rolePermissions, ...explicitPermissions]);
  const missingPermissions = requiredPermissions.filter((permission) => !providedPermissions.includes(permission));
  const workspaceAllowed = allowedWorkspaces.includes(workspaceId) || allowedWorkspaces.includes('*');
  const sameTenant = sourceTenantId === tenantId;
  const issues = [];

  if (!sameTenant) {
    issues.push({ code: 'tenant.mismatch', expected: tenantId, received: sourceTenantId });
  }

  if (!workspaceAllowed) {
    issues.push({ code: 'tenant.workspace.denied', workspaceId, allowedWorkspaces });
  }

  for (const permission of missingPermissions) {
    issues.push({ code: 'tenant.permission.missing', permission, role });
  }

  const isolationState = issues.length === 0 ? 'allowed' : 'blocked';
  const scopeKey = stableStateKey('tenant', [tenantId, workspaceId, provider.name, provider.service, provider.sync?.resource || provider.service]);
  const eventId = stableId('tenant-audit', [
    tenantId,
    workspaceId,
    sourceTenantId,
    actorId,
    role,
    client.request.id,
    provider.name,
    provider.service,
    provider.operation,
    isolationState,
    ...issues.map((issue) => issue.code),
  ]);

  return {
    id: tenantId,
    workspace: {
      id: workspaceId,
      sourceTenantId,
      allowed: workspaceAllowed && sameTenant,
      allowedWorkspaces,
      scopeKey,
    },
    actor: {
      id: actorId,
      role,
      source: client.request.source,
    },
    permissions: {
      required: requiredPermissions,
      provided: providedPermissions,
      missing: missingPermissions,
    },
    capabilities: {
      required: requiredPermissions.map((permission) => `permission.${permission}`),
      provided: providedPermissions.map((permission) => `permission.${permission}`),
    },
    memoryKeys: sortUnique([
      `tenant.${tenantId}.workspace.${workspaceId}.policy`,
      `tenant.${tenantId}.audit.${eventId}`,
    ]),
    isolation: {
      state: isolationState,
      reason: tenantIsolationReason(issues),
      issues,
      dryRunOnly: true,
      crossTenantAllowed: false,
    },
    handoff: {
      target: client.runtime.adapter,
      required: isolationState !== 'allowed',
      state: isolationState === 'allowed' ? 'none' : 'pending',
      reason: isolationState === 'allowed' ? 'tenant-boundary-allowed' : tenantIsolationReason(issues),
      metadata: {
        tenantId,
        workspaceId,
        actorId,
        role,
        auditEventId: eventId,
      },
    },
    audit: {
      eventId,
      scopeKey,
      records: [
        tenantAuditRecord('request', client.request.id, 'bound'),
        tenantAuditRecord('workspace', workspaceId, workspaceAllowed ? 'allowed' : 'denied'),
        tenantAuditRecord('permissions', role, missingPermissions.length === 0 ? 'satisfied' : missingPermissions.join(',')),
        tenantAuditRecord('provider', `${provider.name}.${provider.service}.${provider.operation}`, isolationState),
      ],
    },
  };
}

function buildClientRuntimeContract(fields, options, job, provider, adapterStatus) {
  const requestSeed = [
    job.id,
    job.command,
    provider.name,
    provider.service,
    provider.operation,
    provider.sync?.resource || provider.service,
  ];
  const fallbackRequestId = stableId('request', requestSeed);
  const requestId = normalizeClientIdentifier(fieldOrOption(fields, options, 'request-id', fallbackRequestId), fallbackRequestId);
  const source = normalizeToken(fieldOrOption(fields, options, 'client-source', 'cli'), 'cli');
  const surface = normalizeToken(fieldOrOption(fields, options, 'surface', 'cli-run-dry'), 'cli-run-dry');
  const correlationId = normalizeClientIdentifier(fieldOrOption(fields, options, 'correlation-id', requestId), requestId);
  const idempotencyKey = normalizeClientIdentifier(
    fieldOrOption(fields, options, 'idempotency-key', stableId('idem', [requestId, job.id])),
    stableId('idem', [requestId, job.id]),
  );
  const route = normalizeRouteSegments(fieldOrOption(fields, options, 'route', 'cli-run-dry'));
  const workflowId = normalizeClientIdentifier(
    fieldOrOption(fields, options, 'workflow-id', stableId('workflow', [requestId, provider.name, provider.service])),
    stableId('workflow', [requestId, provider.name, provider.service]),
  );
  const workflowStep = normalizeWorkflowStep(fieldOrOption(fields, options, 'workflow-step', `${provider.operation}-preview`));
  const workflowIntent = normalizeWorkflowIntent(fieldOrOption(fields, options, 'workflow-intent', mailchimpWorkflowIntent(provider)));
  const incomingContinuation = normalizeClientIdentifier(fieldOrOption(fields, options, 'continuation-token', ''), null);
  const providerMissing = provider.negotiation?.missing || [];
  const adapterNeedsHandoff = adapterStatus.state !== 'available';
  const providerNeedsHandoff = provider.handoff?.required === true;
  const handoffPending = adapterNeedsHandoff || providerNeedsHandoff;
  const workflowState = handoffPending ? 'handoff-pending' : 'preview-ready';
  const handoffReason = clientHandoffReason(adapterStatus, providerMissing, provider);
  const resumeToken = handoffPending
    ? stableId('resume', [
      requestId,
      workflowId,
      workflowStep,
      job.id,
      provider.sync?.resource || provider.service,
      handoffReason,
      incomingContinuation || 'new',
    ])
    : incomingContinuation;
  const checkpoints = buildClientWorkflowCheckpoints({
    requestId,
    workflowId,
    workflowStep,
    adapterStatus,
    provider,
    providerMissing,
    resumeToken,
    handoffPending,
  });
  const label = provider.name === MAILCHIMP_PROVIDER
    ? `Mailchimp ${provider.service} ${provider.operation}`
    : `${provider.name} ${provider.operation}`;

  return {
    request: {
      id: requestId,
      source,
      surface,
      correlationId,
      idempotencyKey,
      route,
    },
    workflow: {
      id: workflowId,
      step: workflowStep,
      intent: workflowIntent,
      state: workflowState,
      continuationToken: incomingContinuation,
    },
    runtime: {
      contract: CONTRACT_VERSION,
      dryRun: true,
      adapter: adapterStatus.name,
      adapterState: adapterStatus.state,
      provider: provider.name,
      service: provider.service,
      operation: provider.operation,
      resource: provider.sync?.resource || provider.service,
    },
    handoff: {
      state: handoffPending ? 'pending' : 'not-needed',
      target: adapterStatus.name,
      reason: handoffPending ? handoffReason : 'workflow-ready',
      resumeToken,
      checkpoints,
    },
    userVisible: {
      label,
      statusLabel: handoffPending ? 'Needs adapter handoff' : 'Ready for preview',
      actionLabel: handoffPending ? `Resume ${label} handoff` : `Continue ${label} preview`,
    },
  };
}

function buildVerifierContract(fields, options, job, capabilities, memory, provider, client, tenant) {
  const checks = splitList(fieldOrOption(fields, options, 'checks', 'schema,capabilities,memory,recovery,provider'));
  const providerChecks = provider?.name === MAILCHIMP_PROVIDER ? ['mailchimp.sync', 'mailchimp.handoff', 'client.workflow'] : [];
  const tenantChecks = ['tenant.scope', 'tenant.permissions', 'tenant.audit'];
  const sortedChecks = sortUnique([...checks, ...providerChecks, ...tenantChecks]);
  const digestInput = stableJson({ job, capabilities, memory, provider, client, tenant, checks: sortedChecks });

  return {
    checks: sortedChecks,
    deterministicDigest: stableId('verifier', [digestInput]),
    failureMode: 'block-and-handoff',
  };
}

function buildRecoveryContract(fields, adapterStatus, verifier, provider, client, tenant) {
  const requestedStrategy = fields.get('recovery') || 'handoff';
  const adapterUnavailable = adapterStatus.state !== 'available';
  const providerRequiresHandoff = provider?.handoff?.required === true;
  const clientRequiresResume = client?.handoff?.state === 'pending';
  const tenantRequiresHandoff = tenant?.handoff?.required === true;
  const verifierRequiresHandoff = verifier.failureMode === 'block-and-handoff';
  const strategy = adapterUnavailable || providerRequiresHandoff || clientRequiresResume || tenantRequiresHandoff || verifierRequiresHandoff ? requestedStrategy : 'none';

  return {
    strategy,
    handoff: strategy === 'none' ? 'none' : 'adapter',
    reason: recoveryReason(adapterUnavailable, providerRequiresHandoff, clientRequiresResume, tenantRequiresHandoff),
    adapter: adapterStatus.name,
    external: provider?.handoff || {
      target: adapterStatus.name,
      required: false,
      state: 'none',
      reason: 'no-provider-handoff',
      metadata: {},
    },
    resume: client?.handoff || {
      state: 'not-needed',
      target: adapterStatus.name,
      reason: 'no-client-handoff',
      resumeToken: null,
      checkpoints: [],
    },
    tenant: tenant?.handoff || {
      target: adapterStatus.name,
      required: false,
      state: 'none',
      reason: 'tenant-boundary-allowed',
      metadata: {},
    },
  };
}

function buildPersistenceContract(fields, options, job, provider, client, recovery, verifier, tenant) {
  const namespace = normalizePersistenceNamespace(fieldOrOption(fields, options, 'state-namespace', 'cli-run-dry'));
  const requestedMode = normalizePersistenceMode(fieldOrOption(fields, options, 'state-mode', 'read-through'));
  const revision = normalizeStateRevision(fieldOrOption(fields, options, 'state-revision', '1'));
  const persistedState = normalizePersistedState(fieldOrOption(fields, options, 'persisted-state', 'new'));
  const previousResumeToken = normalizeClientIdentifier(fieldOrOption(fields, options, 'previous-resume-token', ''), null);
  const restartAttempt = toNonNegativeInteger(fieldOrOption(fields, options, 'restart-attempt', 0), 0);
  const providerResource = provider.sync?.resource || provider.service || provider.name;
  const stateKey = normalizeStateKey(
    fieldOrOption(fields, options, 'state-key', ''),
    stableStateKey(namespace, [client.workflow.id, client.workflow.step, provider.name, providerResource]),
  );
  const commandKey = stableStateKey(namespace, ['command', client.request.idempotencyKey, job.id]);
  const statusKey = stableStateKey(namespace, ['status', client.workflow.id, providerResource]);
  const pendingResumeToken = client.handoff?.resumeToken || previousResumeToken || 'none';
  const canResume = client.handoff?.state === 'pending' && Boolean(client.handoff.resumeToken);
  const restoreState = persistenceRestoreState({ persistedState, canResume, previousResumeToken, recovery });
  const checkpoint = persistenceCheckpoint(client, provider, recovery, persistedState);
  const records = [
    persistenceRecord('request', client.request.id, client.request.idempotencyKey, 'read'),
    persistenceRecord('workflow', client.workflow.id, `${client.workflow.step}:${client.workflow.state}`, 'read'),
    persistenceRecord('status', statusKey, recovery.reason, 'read'),
    persistenceRecord('tenant-boundary', tenant.audit.eventId, tenant.isolation.reason, 'read'),
  ];

  if (provider.name === MAILCHIMP_PROVIDER) {
    records.push(persistenceRecord('mailchimp-resource', providerResource, provider.sync?.cursor || provider.sync?.since || provider.sync?.mode, 'read'));
  }

  if (canResume || previousResumeToken) {
    records.push(persistenceRecord('resume', pendingResumeToken, checkpoint, canResume ? 'restore' : 'read'));
  }

  const snapshot = {
    requestId: client.request.id,
    workflowId: client.workflow.id,
    workflowStep: client.workflow.step,
    workflowState: client.workflow.state,
    provider: provider.name,
    service: provider.service,
    operation: provider.operation,
    resource: providerResource,
    tenant: tenant.id,
    workspace: tenant.workspace.id,
    actorRole: tenant.actor.role,
    boundaryState: tenant.isolation.state,
    auditEvent: tenant.audit.eventId,
    adapter: recovery.adapter,
    recoveryReason: recovery.reason,
    revision,
    restartAttempt,
  };
  const digest = stableId('persistence', [
    stateKey,
    commandKey,
    statusKey,
    requestedMode,
    restoreState,
    pendingResumeToken,
    stableJson(snapshot),
    verifier.deterministicDigest,
    tenant.audit.eventId,
  ]);

  return {
    namespace,
    stateKey,
    commandKey,
    statusKey,
    mode: requestedMode,
    revision,
    restartSafe: restoreState !== 'blocked',
    idempotency: {
      key: client.request.idempotencyKey,
      command: job.command,
      duplicatePolicy: 'return-existing-preview',
      conflictPolicy: 'block-on-command-mismatch',
    },
    restore: {
      state: restoreState,
      canResume,
      resumeToken: pendingResumeToken,
      previousResumeToken: previousResumeToken || null,
      reason: persistenceRestoreReason(restoreState, recovery, persistedState),
      checkpoint,
      restartAttempt,
    },
    records,
    snapshot,
    tenant: {
      id: tenant.id,
      workspaceId: tenant.workspace.id,
      isolationState: tenant.isolation.state,
      auditEventId: tenant.audit.eventId,
    },
    digest,
  };
}

function buildStatusHandoff(adapterStatus, recovery, verifier, provider, client, persistence, tenant) {
  const tenantBlocked = tenant?.isolation?.state !== 'allowed';
  const blocked = adapterStatus.state !== 'available' || provider?.handoff?.required === true || client?.handoff?.state === 'pending' || tenantBlocked;

  return {
    state: blocked ? 'blocked' : 'ready',
    adapterState: adapterStatus.state,
    recovered: Boolean(adapterStatus.recovered),
    handoff: blocked ? recovery.handoff : 'none',
    verifierDigest: verifier.deterministicDigest,
    externalHandoff: provider?.handoff || {
      target: adapterStatus.name,
      required: false,
      state: 'none',
      reason: 'no-provider-handoff',
      metadata: {},
    },
    clientState: client?.workflow?.state || 'unknown',
    tenantState: tenant?.isolation?.state || 'unknown',
    tenantAuditEvent: tenant?.audit?.eventId || null,
    resumeToken: blocked ? client?.handoff?.resumeToken || null : null,
    persistenceState: persistence?.restore?.state || 'unknown',
    stateKey: persistence?.stateKey || null,
    commandKey: persistence?.commandKey || null,
    restartSafe: Boolean(persistence?.restartSafe),
    userVisible: client?.userVisible || {
      label: 'Dry run',
      statusLabel: blocked ? 'Needs handoff' : 'Ready',
      actionLabel: blocked ? 'Review handoff' : 'Accept preview',
    },
  };
}

function buildPreviewContract(job, capabilities, memory, provider, status, client, persistence, tenant) {
  const missing = provider?.negotiation?.missing || [];
  const serviceLabel = provider?.name === MAILCHIMP_PROVIDER ? `Mailchimp ${provider.service}` : provider?.service || provider?.name || 'generic';
  const operationLabel = provider?.operation || 'preview';
  const summary = status.state === 'ready'
    ? `${serviceLabel} ${operationLabel} dry run is ready for preview.`
    : `${serviceLabel} ${operationLabel} dry run needs ${status.handoff === 'adapter' ? 'adapter handoff' : 'operator review'}.`;

  return {
    id: stableId('preview', [job.id, provider.name, provider.service, provider.operation, status.state, ...missing]),
    title: `${serviceLabel} ${operationLabel} dry run`,
    summary,
    tone: status.state === 'ready' ? 'success' : 'attention',
    command: {
      value: job.command,
      args: job.args,
      mode: job.mode,
      timeoutMs: job.timeoutMs,
    },
    provider: {
      name: provider.name,
      service: provider.service,
      operation: provider.operation,
      resource: provider.sync?.resource || provider.service,
      syncMode: provider.sync?.mode || 'none',
    },
    client: {
      requestId: client.request.id,
      workflowId: client.workflow.id,
      workflowStep: client.workflow.step,
      workflowState: client.workflow.state,
      resumeToken: status.resumeToken,
      statusLabel: client.userVisible.statusLabel,
    },
    tenant: {
      id: tenant.id,
      workspaceId: tenant.workspace.id,
      isolationState: tenant.isolation.state,
      auditEventId: tenant.audit.eventId,
    },
    sections: [
      previewSection('capabilities', 'Capability negotiation', capabilities.required.length, missing.length === 0 ? 'ready' : 'needs-handoff'),
      previewSection('memory', 'Read-only memory plan', memory.reads.length, memory.writes.length === 0 ? 'ready' : 'blocked'),
      previewSection('tenant-boundary', 'Tenant workspace boundary', tenant.isolation.issues.length, tenant.isolation.state),
      previewSection('workflow', 'Client workflow handoff', client.handoff.state === 'pending' ? 1 : 0, client.workflow.state),
      previewSection('persistence', 'Restart-safe state snapshot', persistence.restartSafe ? 1 : 0, persistence.restore.state),
      previewSection('status', 'Adapter status handoff', status.handoff === 'none' ? 0 : 1, status.state),
    ],
  };
}

function buildAcceptanceContract(job, capabilities, memory, provider, recovery, status, preview, client, persistence, tenant) {
  const missing = provider?.negotiation?.missing || [];
  const criteria = [
    acceptanceCriterion('dry-run-mode', 'Job compiles in dry-run mode', job.mode === 'dry-run', job.mode),
    acceptanceCriterion('read-only-memory', 'Memory plan has no writes', memory.writes.length === 0, `${memory.writes.length} writes`),
    acceptanceCriterion('capabilities-negotiated', 'Required capabilities are available', missing.length === 0, missing.length === 0 ? 'satisfied' : missing.join(',')),
    acceptanceCriterion('tenant-workspace-allowed', 'Tenant workspace is inside allowed boundary', tenant.workspace.allowed, tenant.workspace.id),
    acceptanceCriterion('tenant-permissions-satisfied', 'Actor role grants required dry-run permissions', tenant.permissions.missing.length === 0, tenant.permissions.missing.length === 0 ? 'satisfied' : tenant.permissions.missing.join(',')),
    acceptanceCriterion('tenant-audit-bound', 'Tenant audit event is bound to the contract', tenant.audit.eventId.length > 0 && tenant.audit.records.length > 0, tenant.audit.eventId),
    acceptanceCriterion('adapter-ready', 'Adapter status is available', status.adapterState === 'available', status.adapterState),
    acceptanceCriterion('handoff-explainable', 'Recovery handoff has an explainable target', status.handoff === 'none' || recovery.handoff === 'adapter', recovery.handoff),
    acceptanceCriterion('client-request-stable', 'Client request has deterministic resume state', client.request.id.length > 0 && client.workflow.id.length > 0, client.request.id),
    acceptanceCriterion('workflow-handoff-resumable', 'Workflow handoff carries a resume token when pending', client.handoff.state !== 'pending' || Boolean(client.handoff.resumeToken), client.handoff.resumeToken || client.handoff.state),
    acceptanceCriterion('persistence-state-keyed', 'Dry run state has deterministic persistence keys', persistence.stateKey.length > 0 && persistence.commandKey.length > 0, persistence.stateKey),
    acceptanceCriterion('persistence-restart-safe', 'Persisted status can be safely replayed after restart', persistence.restartSafe, persistence.restore.state),
    acceptanceCriterion('idempotent-command-bound', 'Idempotency key is bound to persisted command state', persistence.idempotency.key === client.request.idempotencyKey, persistence.commandKey),
    acceptanceCriterion('preview-renderable', 'Preview contract includes user-visible sections', preview.sections.length > 0, `${preview.sections.length} sections`),
  ];
  const requiredFailures = criteria.filter((criterion) => criterion.required && criterion.state !== 'passed');

  return {
    decision: requiredFailures.length === 0 ? 'accepted' : status.handoff === 'adapter' ? 'needs-handoff' : 'blocked',
    accepted: requiredFailures.length === 0,
    requiresOperatorAcceptance: requiredFailures.length > 0 || provider?.handoff?.required === true,
    criteria,
    evidenceDigest: stableId('acceptance', criteria.map((criterion) => `${criterion.id}:${criterion.state}:${criterion.evidence}`)),
  };
}

function buildReadinessContract(acceptance, provider, recovery, status, client, persistence, tenant) {
  const passed = acceptance.criteria.filter((criterion) => criterion.state === 'passed').length;
  const total = acceptance.criteria.length || 1;
  const score = Math.round((passed / total) * 100);
  const missing = provider?.negotiation?.missing || [];
  const state = acceptance.accepted ? 'ready' : status.handoff === 'adapter' ? 'needs-handoff' : 'blocked';

  return {
    state,
    score,
    reason: readinessReason(state, status, missing),
    handoffTarget: status.handoff === 'adapter' ? recovery.adapter : null,
    missingCapabilities: missing,
    tenant: {
      id: tenant.id,
      workspaceId: tenant.workspace.id,
      state: tenant.isolation.state,
      missingPermissions: tenant.permissions.missing,
      auditEventId: tenant.audit.eventId,
    },
    workflow: {
      id: client.workflow.id,
      step: client.workflow.step,
      state: client.workflow.state,
      resumeToken: status.resumeToken,
      stateKey: persistence.stateKey,
      restoreState: persistence.restore.state,
    },
  };
}

function buildNextStepContract(provider, recovery, status, readiness, acceptance, client, persistence, tenant) {
  const steps = [];
  const missing = provider?.negotiation?.missing || [];

  if (readiness.state === 'ready') {
    steps.push(nextStep('accept-preview', 'Accept dry run preview', 'all-required-criteria-passed', 'acceptance'));
    steps.push(nextStep('persist-dry-run-state', 'Persist dry run state snapshot', persistence.digest, persistence.stateKey));
    steps.push(nextStep('open-status', 'Open adapter status', 'status-ready', 'status'));
    steps.push(nextStep('continue-workflow', client.userVisible.actionLabel, client.workflow.step, client.workflow.id));
    return steps;
  }

  if (status.adapterState !== 'available') {
    steps.push(nextStep('recover-adapter', 'Recover adapter status', `adapter-${status.adapterState}`, recovery.adapter));
  }

  if (missing.length > 0) {
    steps.push(nextStep('provide-capabilities', 'Provide missing Mailchimp capabilities', missing.join(','), 'provider.capabilities'));
  }

  if (tenant.isolation.state !== 'allowed') {
    steps.push(nextStep('review-tenant-boundary', 'Review tenant workspace boundary', tenant.isolation.reason, tenant.audit.eventId));
  }

  if (tenant.permissions.missing.length > 0) {
    steps.push(nextStep('grant-tenant-permissions', 'Grant required tenant permissions', tenant.permissions.missing.join(','), tenant.actor.id));
  }

  if (status.handoff === 'adapter') {
    steps.push(nextStep('handoff-to-adapter', 'Send recovery handoff to adapter', recovery.reason, recovery.adapter));
  }

  if (client.handoff.state === 'pending') {
    steps.push(nextStep('restore-dry-run-state', 'Restore persisted dry run state', persistence.restore.reason, persistence.stateKey));
    steps.push(nextStep('resume-client-workflow', client.userVisible.actionLabel, client.handoff.resumeToken, client.workflow.id));
  }

  for (const criterion of acceptance.criteria.filter((entry) => entry.state !== 'passed')) {
    steps.push(nextStep(`resolve-${criterion.id}`, criterion.label, criterion.evidence, 'acceptance.criteria'));
  }

  return dedupeNextSteps(steps);
}

function buildValidationSummaryContract(job, capabilities, memory, provider, verifier, status, acceptance, readiness, nextSteps, client, persistence, tenant) {
  const warnings = [];

  if (status.state !== 'ready') {
    warnings.push({ code: 'status.not-ready', state: status.state, handoff: status.handoff });
  }

  if (provider.negotiation?.missing?.length > 0) {
    warnings.push({ code: 'provider.capabilities.missing', missing: provider.negotiation.missing });
  }

  if (client.handoff.state === 'pending') {
    warnings.push({ code: 'client.workflow.handoff.pending', workflowId: client.workflow.id, resumeToken: client.handoff.resumeToken });
  }

  if (persistence.restore.state !== 'ready') {
    warnings.push({ code: 'persistence.restore.not-ready', stateKey: persistence.stateKey, restoreState: persistence.restore.state });
  }

  if (tenant.isolation.state !== 'allowed') {
    warnings.push({ code: 'tenant.boundary.blocked', tenantId: tenant.id, workspaceId: tenant.workspace.id, reason: tenant.isolation.reason });
  }

  if (tenant.permissions.missing.length > 0) {
    warnings.push({ code: 'tenant.permissions.missing', missing: tenant.permissions.missing, actorRole: tenant.actor.role });
  }

  return {
    ok: acceptance.accepted && readiness.state === 'ready' && client.workflow.state === 'preview-ready',
    checkedContract: true,
    digest: stableId('validation', [job.id, verifier.deterministicDigest, acceptance.evidenceDigest, readiness.state, client.request.id, client.workflow.state, persistence.digest, tenant.audit.eventId]),
    blockingIssues: acceptance.criteria
      .filter((criterion) => criterion.required && criterion.state !== 'passed')
      .map((criterion) => ({ code: `acceptance.${criterion.id}`, evidence: criterion.evidence })),
    warnings,
    counters: {
      checks: verifier.checks.length,
      requiredCapabilities: capabilities.required.length,
      memoryReads: memory.reads.length,
      criteria: acceptance.criteria.length,
      nextSteps: nextSteps.length,
      workflowCheckpoints: client.handoff.checkpoints.length,
      persistenceRecords: persistence.records.length,
      tenantIssues: tenant.isolation.issues.length,
      tenantAuditRecords: tenant.audit.records.length,
    },
  };
}

function buildClaimContract(job, capabilities, memory, verifier, recovery, status, provider, acceptance, readiness, client, persistence, tenant) {
  const fingerprint = stableId('claim', [
    job.id,
    stableJson(client),
    stableJson(capabilities),
    stableJson(memory),
    stableJson(provider),
    stableJson(persistence),
    stableJson(tenant),
    verifier.deterministicDigest,
    recovery.strategy,
    status.state,
    acceptance.evidenceDigest,
    readiness.state,
  ]);

  return {
    id: fingerprint,
    subject: job.id,
    predicate: 'compiles-to-dry-run-contract',
    evidence: verifier.deterministicDigest,
    provider: provider?.name || 'generic',
    acceptance: acceptance.decision,
    readiness: readiness.state,
    request: client.request.id,
    workflow: client.workflow.id,
    persistence: persistence.stateKey,
    tenant: tenant.id,
    workspace: tenant.workspace.id,
    audit: tenant.audit.eventId,
  };
}

function buildProviderContract(fields, options, job, adapterStatus) {
  const providerName = normalizeToken(fieldOrOption(fields, options, 'provider', 'generic'), 'generic');

  if (providerName !== MAILCHIMP_PROVIDER) {
    return buildGenericProviderContract(providerName, fields, options, job, adapterStatus);
  }

  return buildMailchimpProviderContract(fields, options, job, adapterStatus);
}

function buildGenericProviderContract(providerName, fields, options, job, adapterStatus) {
  const service = normalizeToken(fieldOrOption(fields, options, 'service', providerName), providerName);
  const operation = normalizeToken(fieldOrOption(fields, options, 'operation', 'preview'), 'preview');

  return {
    name: providerName,
    service,
    operation,
    sync: {
      mode: 'none',
      cursor: null,
      since: null,
      resource: `${providerName}.${service}`,
      memoryKeys: [],
      metadata: {},
    },
    negotiation: {
      provider: providerName,
      required: [],
      provided: [],
      missing: [],
      state: 'satisfied',
    },
    handoff: {
      target: adapterStatus.name,
      required: false,
      state: 'none',
      reason: 'generic-provider',
      metadata: { job: job.id },
    },
  };
}

function buildMailchimpProviderContract(fields, options, job, adapterStatus) {
  const service = normalizeMailchimpService(fieldOrOption(fields, options, 'service', 'audience'));
  const operation = normalizeMailchimpOperation(fieldOrOption(fields, options, 'operation', 'sync'));
  const datacenter = normalizeMailchimpDatacenter(fieldOrOption(fields, options, 'datacenter', ''));
  const audienceId = normalizeOptionalIdentifier(fieldOrOption(fields, options, 'audience-id', ''));
  const campaignId = normalizeOptionalIdentifier(fieldOrOption(fields, options, 'campaign-id', ''));
  const templateId = normalizeOptionalIdentifier(fieldOrOption(fields, options, 'template-id', ''));
  const cursor = normalizeSyncCursor(fieldOrOption(fields, options, 'sync-cursor', ''));
  const since = normalizeSyncSince(fieldOrOption(fields, options, 'sync-since', ''));
  const syncMode = normalizeMailchimpSyncMode(fieldOrOption(fields, options, 'sync-mode', cursor ? 'incremental' : 'snapshot'));
  const resourceId = mailchimpResourceId(service, { audienceId, campaignId, templateId });
  const required = mailchimpRequiredCapabilities(service, operation, syncMode);
  const provided = mailchimpProvidedCapabilities(options, adapterStatus);
  const missing = required.filter((capability) => !provided.includes(capability));
  const handoffRequired = adapterStatus.state !== 'available' || missing.length > 0;

  return {
    name: MAILCHIMP_PROVIDER,
    service,
    operation,
    sync: {
      mode: syncMode,
      cursor,
      since,
      resource: resourceId,
      memoryKeys: mailchimpMemoryKeys(service, resourceId),
      metadata: compactObject({
        audienceId,
        campaignId,
        templateId,
        datacenter,
      }),
    },
    negotiation: {
      provider: MAILCHIMP_PROVIDER,
      required,
      provided,
      missing,
      state: missing.length === 0 ? 'satisfied' : 'missing-capabilities',
    },
    handoff: {
      target: adapterStatus.name,
      required: handoffRequired,
      state: handoffRequired ? 'pending' : 'none',
      reason: handoffRequired ? mailchimpHandoffReason(adapterStatus, missing) : 'mailchimp-capabilities-satisfied',
      metadata: compactObject({
        job: job.id,
        datacenter,
        resource: resourceId,
        missing: missing.length > 0 ? missing.join(',') : null,
        syncMode,
      }),
    },
  };
}

function validateMailchimpProviderContract(contract, issues) {
  const provider = contract.provider;
  const validServices = Object.keys(MAILCHIMP_SERVICE_CAPABILITIES);
  const validOperations = Object.keys(MAILCHIMP_OPERATION_CAPABILITIES);

  if (!validServices.includes(provider.service)) {
    issues.push({ code: 'provider.mailchimp.service', expected: validServices, received: provider.service });
  }

  if (!validOperations.includes(provider.operation)) {
    issues.push({ code: 'provider.mailchimp.operation', expected: validOperations, received: provider.operation });
  }

  if (!['incremental', 'snapshot', 'status'].includes(provider.sync.mode)) {
    issues.push({ code: 'provider.mailchimp.sync.mode', expected: ['incremental', 'snapshot', 'status'], received: provider.sync.mode });
  }

  if (provider.sync.mode === 'incremental' && provider.sync.cursor === null && provider.sync.since === null) {
    issues.push({ code: 'provider.mailchimp.sync.anchor', expected: 'sync-cursor or sync-since for incremental sync' });
  }

  if (!provider.sync.resource.startsWith(`${MAILCHIMP_PROVIDER}.${provider.service}`)) {
    issues.push({ code: 'provider.mailchimp.resource', expected: `${MAILCHIMP_PROVIDER}.${provider.service}`, received: provider.sync.resource });
  }

  for (const capability of provider.negotiation.required) {
    if (!contract.capabilities.required.includes(capability)) {
      issues.push({ code: 'provider.mailchimp.capability.required', capability });
    }
  }

  for (const capability of provider.negotiation.provided) {
    if (!contract.capabilities.provided.includes(capability)) {
      issues.push({ code: 'provider.mailchimp.capability.provided', capability });
    }
  }

  if (provider.negotiation.missing.length > 0 && provider.handoff.required !== true) {
    issues.push({ code: 'provider.mailchimp.handoff.required', expected: true });
  }

  if (provider.handoff.required === true && contract.status.externalHandoff?.state !== 'pending') {
    issues.push({ code: 'provider.mailchimp.status.handoff', expected: 'pending', received: contract.status.externalHandoff?.state });
  }
}

function validateClientRuntimeContract(contract, issues) {
  const client = contract.client;
  const validWorkflowStates = ['preview-ready', 'handoff-pending'];
  const validHandoffStates = ['not-needed', 'pending'];

  if (!isPlainObject(client)) {
    issues.push({ code: 'client.type', expected: 'object' });
    return;
  }

  requireArray(client.request?.route, 'client.request.route', issues);
  requireString(client.request?.correlationId, 'client.request.correlationId', issues);
  requireString(client.request?.idempotencyKey, 'client.request.idempotencyKey', issues);
  requireString(client.workflow?.intent, 'client.workflow.intent', issues);
  requireString(client.runtime?.contract, 'client.runtime.contract', issues);
  requireString(client.runtime?.adapter, 'client.runtime.adapter', issues);
  requireString(client.runtime?.provider, 'client.runtime.provider', issues);
  requireString(client.handoff?.target, 'client.handoff.target', issues);
  requireString(client.handoff?.reason, 'client.handoff.reason', issues);
  requireArray(client.handoff?.checkpoints, 'client.handoff.checkpoints', issues);
  requireString(client.userVisible?.label, 'client.userVisible.label', issues);
  requireString(client.userVisible?.statusLabel, 'client.userVisible.statusLabel', issues);
  requireString(client.userVisible?.actionLabel, 'client.userVisible.actionLabel', issues);

  if (client.runtime?.contract !== CONTRACT_VERSION) {
    issues.push({ code: 'client.runtime.contract', expected: CONTRACT_VERSION, received: client.runtime?.contract });
  }

  if (client.runtime?.dryRun !== true) {
    issues.push({ code: 'client.runtime.dryRun', expected: true, received: client.runtime?.dryRun });
  }

  if (client.workflow?.state && !validWorkflowStates.includes(client.workflow.state)) {
    issues.push({ code: 'client.workflow.state', expected: validWorkflowStates, received: client.workflow.state });
  }

  if (client.handoff?.state && !validHandoffStates.includes(client.handoff.state)) {
    issues.push({ code: 'client.handoff.state', expected: validHandoffStates, received: client.handoff.state });
  }

  if (client.workflow?.state === 'handoff-pending' && client.handoff?.state !== 'pending') {
    issues.push({ code: 'client.workflow.handoff', expected: 'pending handoff for handoff-pending workflow' });
  }

  if (client.handoff?.state === 'pending' && !client.handoff.resumeToken) {
    issues.push({ code: 'client.handoff.resumeToken', expected: 'resume token for pending handoff' });
  }

  if (client.handoff?.state === 'not-needed' && contract.status?.resumeToken !== null) {
    issues.push({ code: 'client.handoff.resumeToken.ready', expected: null, received: contract.status?.resumeToken });
  }

  if (client.runtime?.adapterState !== contract.status?.adapterState) {
    issues.push({ code: 'client.runtime.adapterState', expected: contract.status?.adapterState, received: client.runtime?.adapterState });
  }

  if (client.runtime?.provider !== contract.provider?.name) {
    issues.push({ code: 'client.runtime.provider', expected: contract.provider?.name, received: client.runtime?.provider });
  }

  for (const [index, checkpoint] of (client.handoff?.checkpoints || []).entries()) {
    requireString(checkpoint.id, `client.handoff.checkpoints.${index}.id`, issues);
    requireString(checkpoint.label, `client.handoff.checkpoints.${index}.label`, issues);
    requireString(checkpoint.state, `client.handoff.checkpoints.${index}.state`, issues);

    if (!['passed', 'pending', 'blocked'].includes(checkpoint.state)) {
      issues.push({ code: 'client.handoff.checkpoint.state', expected: ['passed', 'pending', 'blocked'], received: checkpoint.state });
    }
  }
}

function validatePersistenceContract(contract, issues) {
  const persistence = contract.persistence;
  const validModes = ['read-through', 'restore-first', 'status-only'];
  const validRestoreStates = ['ready', 'resume-pending', 'replay-existing', 'blocked'];
  const validRecordIntents = ['read', 'restore'];

  if (!isPlainObject(persistence)) {
    issues.push({ code: 'persistence.type', expected: 'object' });
    return;
  }

  requireString(persistence.namespace, 'persistence.namespace', issues);
  requireString(persistence.revision, 'persistence.revision', issues);
  requireString(persistence.digest, 'persistence.digest', issues);
  requireString(persistence.idempotency?.key, 'persistence.idempotency.key', issues);
  requireString(persistence.idempotency?.command, 'persistence.idempotency.command', issues);
  requireString(persistence.idempotency?.duplicatePolicy, 'persistence.idempotency.duplicatePolicy', issues);
  requireString(persistence.idempotency?.conflictPolicy, 'persistence.idempotency.conflictPolicy', issues);
  requireString(persistence.restore?.reason, 'persistence.restore.reason', issues);
  requireString(persistence.restore?.checkpoint, 'persistence.restore.checkpoint', issues);
  requireString(persistence.snapshot?.requestId, 'persistence.snapshot.requestId', issues);
  requireString(persistence.snapshot?.workflowId, 'persistence.snapshot.workflowId', issues);
  requireString(persistence.snapshot?.provider, 'persistence.snapshot.provider', issues);
  requireString(persistence.snapshot?.resource, 'persistence.snapshot.resource', issues);

  if (!validModes.includes(persistence.mode)) {
    issues.push({ code: 'persistence.mode', expected: validModes, received: persistence.mode });
  }

  if (!validRestoreStates.includes(persistence.restore?.state)) {
    issues.push({ code: 'persistence.restore.state', expected: validRestoreStates, received: persistence.restore?.state });
  }

  if (typeof persistence.restartSafe !== 'boolean') {
    issues.push({ code: 'persistence.restartSafe', expected: 'boolean', received: typeof persistence.restartSafe });
  }

  if (typeof persistence.restore?.canResume !== 'boolean') {
    issues.push({ code: 'persistence.restore.canResume', expected: 'boolean', received: typeof persistence.restore?.canResume });
  }

  if (!Number.isInteger(persistence.restore?.restartAttempt) || persistence.restore.restartAttempt < 0) {
    issues.push({ code: 'persistence.restore.restartAttempt', expected: 'non-negative integer', received: persistence.restore?.restartAttempt });
  }

  if (persistence.idempotency?.key !== contract.client?.request?.idempotencyKey) {
    issues.push({ code: 'persistence.idempotency.key', expected: contract.client?.request?.idempotencyKey, received: persistence.idempotency?.key });
  }

  if (persistence.snapshot?.requestId !== contract.client?.request?.id) {
    issues.push({ code: 'persistence.snapshot.requestId', expected: contract.client?.request?.id, received: persistence.snapshot?.requestId });
  }

  if (persistence.snapshot?.workflowId !== contract.client?.workflow?.id) {
    issues.push({ code: 'persistence.snapshot.workflowId', expected: contract.client?.workflow?.id, received: persistence.snapshot?.workflowId });
  }

  if (contract.status?.stateKey !== persistence.stateKey) {
    issues.push({ code: 'persistence.status.stateKey', expected: persistence.stateKey, received: contract.status?.stateKey });
  }

  if (contract.status?.commandKey !== persistence.commandKey) {
    issues.push({ code: 'persistence.status.commandKey', expected: persistence.commandKey, received: contract.status?.commandKey });
  }

  if (contract.status?.restartSafe !== persistence.restartSafe) {
    issues.push({ code: 'persistence.status.restartSafe', expected: persistence.restartSafe, received: contract.status?.restartSafe });
  }

  if (persistence.restore?.state === 'resume-pending' && !persistence.restore?.canResume) {
    issues.push({ code: 'persistence.restore.resume', expected: 'canResume=true for resume-pending restore' });
  }

  if (persistence.restore?.state === 'resume-pending' && persistence.restore?.resumeToken === 'none') {
    issues.push({ code: 'persistence.restore.resumeToken', expected: 'resume token for resume-pending restore' });
  }

  for (const [index, record] of (persistence.records || []).entries()) {
    requireString(record.kind, `persistence.records.${index}.kind`, issues);
    requireString(record.key, `persistence.records.${index}.key`, issues);
    requireString(record.intent, `persistence.records.${index}.intent`, issues);
    requireString(record.evidence, `persistence.records.${index}.evidence`, issues);

    if (!validRecordIntents.includes(record.intent)) {
      issues.push({ code: 'persistence.record.intent', expected: validRecordIntents, received: record.intent });
    }
  }
}

function validateTenantBoundaryContract(contract, issues) {
  const tenant = contract.tenant;
  const validRoles = Object.keys(TENANT_ROLE_PERMISSIONS);
  const validIsolationStates = ['allowed', 'blocked'];
  const validHandoffStates = ['none', 'pending'];

  if (!isPlainObject(tenant)) {
    issues.push({ code: 'tenant.type', expected: 'object' });
    return;
  }

  requireString(tenant.workspace?.sourceTenantId, 'tenant.workspace.sourceTenantId', issues);
  requireString(tenant.workspace?.scopeKey, 'tenant.workspace.scopeKey', issues);
  requireArray(tenant.workspace?.allowedWorkspaces, 'tenant.workspace.allowedWorkspaces', issues);
  requireString(tenant.actor?.id, 'tenant.actor.id', issues);
  requireString(tenant.actor?.source, 'tenant.actor.source', issues);
  requireArray(tenant.capabilities?.required, 'tenant.capabilities.required', issues);
  requireArray(tenant.capabilities?.provided, 'tenant.capabilities.provided', issues);
  requireArray(tenant.memoryKeys, 'tenant.memoryKeys', issues);
  requireString(tenant.isolation?.reason, 'tenant.isolation.reason', issues);
  requireArray(tenant.isolation?.issues, 'tenant.isolation.issues', issues);
  requireString(tenant.handoff?.target, 'tenant.handoff.target', issues);
  requireString(tenant.handoff?.state, 'tenant.handoff.state', issues);
  requireString(tenant.handoff?.reason, 'tenant.handoff.reason', issues);
  requireArray(tenant.audit?.records, 'tenant.audit.records', issues);

  if (!validRoles.includes(tenant.actor?.role)) {
    issues.push({ code: 'tenant.actor.role', expected: validRoles, received: tenant.actor?.role });
  }

  if (!validIsolationStates.includes(tenant.isolation?.state)) {
    issues.push({ code: 'tenant.isolation.state', expected: validIsolationStates, received: tenant.isolation?.state });
  }

  if (!validHandoffStates.includes(tenant.handoff?.state)) {
    issues.push({ code: 'tenant.handoff.state', expected: validHandoffStates, received: tenant.handoff?.state });
  }

  if (typeof tenant.workspace?.allowed !== 'boolean') {
    issues.push({ code: 'tenant.workspace.allowed', expected: 'boolean', received: typeof tenant.workspace?.allowed });
  }

  if (typeof tenant.handoff?.required !== 'boolean') {
    issues.push({ code: 'tenant.handoff.required', expected: 'boolean', received: typeof tenant.handoff?.required });
  }

  if (tenant.id !== tenant.workspace?.sourceTenantId && tenant.isolation?.state !== 'blocked') {
    issues.push({ code: 'tenant.mismatch.state', expected: 'blocked', received: tenant.isolation?.state });
  }

  if (tenant.workspace?.allowed === false && tenant.isolation?.state !== 'blocked') {
    issues.push({ code: 'tenant.workspace.state', expected: 'blocked', received: tenant.isolation?.state });
  }

  if (tenant.permissions?.missing?.length > 0 && tenant.isolation?.state !== 'blocked') {
    issues.push({ code: 'tenant.permissions.state', expected: 'blocked', received: tenant.isolation?.state });
  }

  if (tenant.isolation?.state === 'blocked' && tenant.handoff?.required !== true) {
    issues.push({ code: 'tenant.handoff.required', expected: true, received: tenant.handoff?.required });
  }

  if (tenant.audit?.eventId !== contract.status?.tenantAuditEvent) {
    issues.push({ code: 'tenant.status.audit', expected: tenant.audit?.eventId, received: contract.status?.tenantAuditEvent });
  }

  for (const capability of tenant.capabilities?.required || []) {
    if (!contract.capabilities?.required?.includes(capability)) {
      issues.push({ code: 'tenant.capability.required', capability });
    }
  }

  for (const memoryKey of tenant.memoryKeys || []) {
    if (!contract.memory?.reads?.includes(memoryKey)) {
      issues.push({ code: 'tenant.memory.read', memoryKey });
    }
  }

  for (const [index, record] of (tenant.audit?.records || []).entries()) {
    requireString(record.kind, `tenant.audit.records.${index}.kind`, issues);
    requireString(record.key, `tenant.audit.records.${index}.key`, issues);
    requireString(record.state, `tenant.audit.records.${index}.state`, issues);
  }
}

function validatePreviewAcceptanceContract(contract, issues) {
  const validPreviewTones = ['success', 'attention', 'critical'];
  const validReadinessStates = ['ready', 'needs-handoff', 'blocked'];
  const validAcceptanceDecisions = ['accepted', 'needs-handoff', 'blocked'];

  if (contract.preview?.tone && !validPreviewTones.includes(contract.preview.tone)) {
    issues.push({ code: 'preview.tone', expected: validPreviewTones, received: contract.preview.tone });
  }

  for (const [index, section] of (contract.preview?.sections || []).entries()) {
    requireString(section.id, `preview.sections.${index}.id`, issues);
    requireString(section.label, `preview.sections.${index}.label`, issues);
    requireString(section.state, `preview.sections.${index}.state`, issues);

    if (!Number.isInteger(section.count) || section.count < 0) {
      issues.push({ code: 'preview.section.count', path: `preview.sections.${index}.count`, received: section.count });
    }
  }

  if (contract.acceptance?.decision && !validAcceptanceDecisions.includes(contract.acceptance.decision)) {
    issues.push({ code: 'acceptance.decision', expected: validAcceptanceDecisions, received: contract.acceptance.decision });
  }

  if (typeof contract.acceptance?.accepted !== 'boolean') {
    issues.push({ code: 'acceptance.accepted', expected: 'boolean', received: typeof contract.acceptance?.accepted });
  }

  if (typeof contract.acceptance?.requiresOperatorAcceptance !== 'boolean') {
    issues.push({
      code: 'acceptance.requiresOperatorAcceptance',
      expected: 'boolean',
      received: typeof contract.acceptance?.requiresOperatorAcceptance,
    });
  }

  for (const [index, criterion] of (contract.acceptance?.criteria || []).entries()) {
    requireString(criterion.id, `acceptance.criteria.${index}.id`, issues);
    requireString(criterion.label, `acceptance.criteria.${index}.label`, issues);
    requireString(criterion.state, `acceptance.criteria.${index}.state`, issues);

    if (!['passed', 'blocked'].includes(criterion.state)) {
      issues.push({ code: 'acceptance.criteria.state', expected: ['passed', 'blocked'], received: criterion.state });
    }

    if (typeof criterion.required !== 'boolean') {
      issues.push({ code: 'acceptance.criteria.required', path: `acceptance.criteria.${index}.required` });
    }
  }

  if (contract.readiness?.state && !validReadinessStates.includes(contract.readiness.state)) {
    issues.push({ code: 'readiness.state', expected: validReadinessStates, received: contract.readiness.state });
  }

  if (!Number.isInteger(contract.readiness?.score) || contract.readiness.score < 0 || contract.readiness.score > 100) {
    issues.push({ code: 'readiness.score', expected: 'integer between 0 and 100', received: contract.readiness?.score });
  }

  if (contract.readiness?.state === 'ready' && contract.acceptance?.accepted !== true) {
    issues.push({ code: 'readiness.acceptance', expected: 'accepted readiness requires accepted criteria' });
  }

  if (contract.validationSummary?.ok !== (contract.readiness?.state === 'ready' && contract.acceptance?.accepted === true)) {
    issues.push({ code: 'validationSummary.ok', expected: 'matches readiness and acceptance' });
  }

  for (const [index, step] of (contract.nextSteps || []).entries()) {
    requireString(step.action, `nextSteps.${index}.action`, issues);
    requireString(step.label, `nextSteps.${index}.label`, issues);
    requireString(step.reason, `nextSteps.${index}.reason`, issues);
    requireString(step.target, `nextSteps.${index}.target`, issues);
  }
}

function previewSection(id, label, count, state) {
  return {
    id,
    label,
    count,
    state,
  };
}

function acceptanceCriterion(id, label, passed, evidence) {
  return {
    id,
    label,
    state: passed ? 'passed' : 'blocked',
    required: true,
    evidence: String(evidence || (passed ? 'passed' : 'blocked')),
  };
}

function readinessReason(state, status, missing) {
  if (state === 'ready') {
    return 'all-required-criteria-passed';
  }

  if (missing.length > 0) {
    return 'missing-provider-capabilities';
  }

  if (status.adapterState !== 'available') {
    return `adapter-${status.adapterState}`;
  }

  return status.handoff === 'adapter' ? 'adapter-handoff-required' : 'operator-review-required';
}

function nextStep(action, label, reason, target) {
  return {
    action,
    label,
    reason: String(reason || action),
    target: String(target || 'contract'),
  };
}

function dedupeNextSteps(steps) {
  const seen = new Set();
  const deduped = [];

  for (const step of steps) {
    const key = `${step.action}:${step.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(step);
    }
  }

  return deduped;
}

function buildClientWorkflowCheckpoints(context) {
  const checkpoints = [
    workflowCheckpoint('request-normalized', 'Client request normalized', 'passed', context.requestId),
    workflowCheckpoint('workflow-bound', 'Workflow step bound', 'passed', `${context.workflowId}:${context.workflowStep}`),
    workflowCheckpoint(
      'adapter-state',
      'Adapter state captured',
      context.adapterStatus.state === 'available' ? 'passed' : 'pending',
      context.adapterStatus.state,
    ),
    workflowCheckpoint(
      'provider-negotiated',
      'Provider capabilities negotiated',
      context.providerMissing.length === 0 ? 'passed' : 'pending',
      context.providerMissing.length === 0 ? 'satisfied' : context.providerMissing.join(','),
    ),
  ];

  if (context.handoffPending) {
    checkpoints.push(workflowCheckpoint('resume-token-issued', 'Resume token issued', context.resumeToken ? 'passed' : 'blocked', context.resumeToken));
  }

  if (context.provider.name === MAILCHIMP_PROVIDER) {
    checkpoints.push(workflowCheckpoint(
      'mailchimp-resource-bound',
      'Mailchimp resource bound',
      context.provider.sync?.resource ? 'passed' : 'blocked',
      context.provider.sync?.resource || 'missing-resource',
    ));
  }

  return checkpoints;
}

function workflowCheckpoint(id, label, state, evidence) {
  return {
    id,
    label,
    state,
    evidence: String(evidence || state),
  };
}

function mailchimpWorkflowIntent(provider) {
  if (provider.name !== MAILCHIMP_PROVIDER) {
    return 'dry-run-preview';
  }

  if (provider.operation === 'sync') {
    return `${provider.service}-sync-preview`;
  }

  if (provider.operation === 'export') {
    return `${provider.service}-export-preview`;
  }

  return `${provider.service}-${provider.operation}-dry-run`;
}

function clientHandoffReason(adapterStatus, missing, provider) {
  if (adapterStatus.state !== 'available') {
    return `adapter-${adapterStatus.state}`;
  }

  if (missing.length > 0) {
    return provider.name === MAILCHIMP_PROVIDER ? 'missing-mailchimp-capabilities' : 'missing-provider-capabilities';
  }

  if (provider.handoff?.required === true) {
    return provider.handoff.reason || 'provider-handoff-required';
  }

  return 'workflow-ready';
}

function mailchimpRequiredCapabilities(service, operation, syncMode) {
  const serviceCapabilities = MAILCHIMP_SERVICE_CAPABILITIES[service] || MAILCHIMP_SERVICE_CAPABILITIES.audience;
  const operationCapabilities = MAILCHIMP_OPERATION_CAPABILITIES[operation] || MAILCHIMP_OPERATION_CAPABILITIES.preview;
  const syncCapabilities = syncMode === 'status' ? ['mailchimp.sync.status'] : ['mailchimp.sync.preview'];

  return sortUnique([...serviceCapabilities, ...operationCapabilities, ...syncCapabilities]);
}

function mailchimpProvidedCapabilities(options, adapterStatus) {
  const explicit = splitList(options.providerCapabilities ?? options.mailchimpCapabilities ?? '');
  const adapterCapabilities = splitList(adapterStatus.capabilities || '');
  const defaultPreviewCapabilities = [
    'mailchimp.audience.read',
    'mailchimp.campaign.read',
    'mailchimp.preview',
    'mailchimp.sync.preview',
    'mailchimp.sync.status',
    'mailchimp.template.read',
  ];

  return sortUnique([...defaultPreviewCapabilities, ...adapterCapabilities, ...explicit]);
}

function mailchimpMemoryKeys(service, resourceId) {
  return sortUnique([
    `provider.mailchimp.${service}.status`,
    `provider.${resourceId}.cursor`,
    `provider.${resourceId}.handoff`,
  ]);
}

function mailchimpResourceId(service, ids) {
  const serviceId = {
    audience: ids.audienceId,
    campaign: ids.campaignId,
    template: ids.templateId,
  }[service];

  return serviceId ? `${MAILCHIMP_PROVIDER}.${service}.${serviceId}` : `${MAILCHIMP_PROVIDER}.${service}`;
}

function normalizeMailchimpService(value) {
  const token = normalizeToken(value, 'audience');
  return hasOwn(MAILCHIMP_SERVICE_CAPABILITIES, token) ? token : 'audience';
}

function normalizeMailchimpOperation(value) {
  const token = normalizeToken(value, 'sync');
  return hasOwn(MAILCHIMP_OPERATION_CAPABILITIES, token) ? token : 'sync';
}

function normalizeMailchimpSyncMode(value) {
  const token = normalizeToken(value, 'snapshot');
  return ['incremental', 'snapshot', 'status'].includes(token) ? token : 'snapshot';
}

function normalizeMailchimpDatacenter(value) {
  const token = String(value || '').trim().toLowerCase();
  return /^us[0-9]+$/.test(token) ? token : null;
}

function normalizeOptionalIdentifier(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{3,128}$/.test(token) ? token : null;
}

function normalizeSyncCursor(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_./:=+-]{3,256}$/.test(token) ? token : null;
}

function normalizeSyncSince(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/.test(token) ? token : null;
}

function normalizeClientIdentifier(value, fallback) {
  const token = String(value || '').trim();
  if (/^[A-Za-z0-9_.:-]{3,160}$/.test(token)) {
    return token;
  }

  return fallback;
}

function normalizeRouteSegments(value) {
  const segments = splitList(value)
    .map((segment) => normalizeToken(segment, ''))
    .filter(Boolean);

  return segments.length > 0 ? sortUnique(segments) : ['cli-run-dry'];
}

function normalizeWorkflowStep(value) {
  return normalizeToken(value, 'preview');
}

function normalizeWorkflowIntent(value) {
  return normalizeToken(value, 'dry-run-preview');
}

function normalizeToken(value, fallback) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9.-]*$/.test(token) ? token : fallback;
}

function mailchimpHandoffReason(adapterStatus, missing) {
  if (adapterStatus.state !== 'available') {
    return `adapter-${adapterStatus.state}`;
  }

  if (missing.length > 0) {
    return 'missing-mailchimp-capabilities';
  }

  return 'mailchimp-capabilities-satisfied';
}

function recoveryReason(adapterUnavailable, providerRequiresHandoff, clientRequiresResume, tenantRequiresHandoff) {
  if (adapterUnavailable) {
    return 'adapter-unavailable';
  }

  if (tenantRequiresHandoff) {
    return 'tenant-boundary-blocked';
  }

  if (providerRequiresHandoff) {
    return 'provider-handoff-required';
  }

  if (clientRequiresResume) {
    return 'client-workflow-resume-required';
  }

  return 'dry-run-verifier-failure-safe';
}

function tenantRequiredPermissions(provider) {
  const operationPermissions = provider?.name === MAILCHIMP_PROVIDER
    ? MAILCHIMP_OPERATION_PERMISSIONS[provider.operation] || MAILCHIMP_OPERATION_PERMISSIONS.preview
    : ['tenant.workspace.read'];
  const providerPermission = provider?.name === MAILCHIMP_PROVIDER ? [`provider.${MAILCHIMP_PROVIDER}.${provider.service}.read`] : [];

  return sortUnique(['tenant.audit.read', ...operationPermissions, ...providerPermission]);
}

function normalizeTenantIdentifier(value, fallback) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.:-]{1,96}$/.test(token) ? token : fallback;
}

function normalizeTenantRole(value) {
  const token = normalizeToken(value, 'viewer');
  return hasOwn(TENANT_ROLE_PERMISSIONS, token) ? token : 'viewer';
}

function normalizeAllowedWorkspaces(value, fallback) {
  const workspaces = splitList(value)
    .map((workspace) => workspace === '*' ? '*' : normalizeTenantIdentifier(workspace, ''))
    .filter(Boolean);

  return workspaces.length > 0 ? sortUnique(workspaces) : [fallback];
}

function tenantIsolationReason(issues) {
  if (issues.length === 0) {
    return 'tenant-boundary-allowed';
  }

  if (issues.some((issue) => issue.code === 'tenant.mismatch')) {
    return 'tenant-mismatch';
  }

  if (issues.some((issue) => issue.code === 'tenant.workspace.denied')) {
    return 'workspace-outside-allowed-boundary';
  }

  if (issues.some((issue) => issue.code === 'tenant.permission.missing')) {
    return 'missing-tenant-permissions';
  }

  return 'tenant-boundary-blocked';
}

function tenantAuditRecord(kind, key, state) {
  return {
    kind,
    key: String(key || kind),
    state: String(state || 'recorded'),
  };
}

function persistenceRecord(kind, key, evidence, intent) {
  return {
    kind,
    key: String(key || kind),
    intent,
    evidence: String(evidence || intent),
  };
}

function persistenceRestoreState(context) {
  if (context.recovery.reason === 'dry-run-verifier-failure-safe') {
    return context.previousResumeToken ? 'replay-existing' : 'ready';
  }

  if (context.recovery.handoff === 'adapter' && context.canResume) {
    return 'resume-pending';
  }

  if (context.persistedState === 'completed' || context.persistedState === 'ready') {
    return 'replay-existing';
  }

  if (context.recovery.handoff === 'adapter' || context.persistedState === 'blocked') {
    return 'blocked';
  }

  if (context.previousResumeToken) {
    return 'replay-existing';
  }

  return 'ready';
}

function persistenceRestoreReason(restoreState, recovery, persistedState) {
  if (restoreState === 'resume-pending') {
    return recovery.reason || 'adapter-resume-required';
  }

  if (restoreState === 'replay-existing') {
    return persistedState === 'new' ? 'previous-resume-token-present' : `persisted-${persistedState}`;
  }

  if (restoreState === 'blocked') {
    return recovery.reason || 'persisted-state-blocked';
  }

  return 'fresh-dry-run-state';
}

function persistenceCheckpoint(client, provider, recovery, persistedState) {
  if (client.handoff?.state === 'pending') {
    return 'client-handoff';
  }

  if (provider.handoff?.required === true) {
    return provider.name === MAILCHIMP_PROVIDER ? 'mailchimp-provider-handoff' : 'provider-handoff';
  }

  if (recovery.handoff === 'adapter') {
    return 'adapter-recovery';
  }

  if (persistedState !== 'new') {
    return `persisted-${persistedState}`;
  }

  return 'preview-ready';
}

function normalizePersistenceNamespace(value) {
  const token = normalizeToken(value, 'cli-run-dry');
  return token.split('.').slice(0, 4).join('.');
}

function normalizePersistenceMode(value) {
  const token = normalizeToken(value, 'read-through');
  return ['read-through', 'restore-first', 'status-only'].includes(token) ? token : 'read-through';
}

function normalizePersistedState(value) {
  const token = normalizeToken(value, 'new');
  return ['new', 'ready', 'completed', 'blocked'].includes(token) ? token : 'new';
}

function normalizeStateRevision(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(token) ? token : '1';
}

function normalizeStateKey(value, fallback) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_.:/-]{6,220}$/.test(token) ? token : fallback;
}

function stableStateKey(namespace, parts) {
  const cleanParts = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);

  return `${namespace}:${cleanParts.join(':')}`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''));
}

function normalizeAdapterStatus(adapterStatus = {}) {
  const merged = { ...DEFAULT_ADAPTER_STATUS, ...adapterStatus };
  const state = ['available', 'degraded', 'offline'].includes(merged.state) ? merged.state : 'degraded';

  return {
    name: String(merged.name || DEFAULT_ADAPTER_STATUS.name),
    state,
    recovered: Boolean(merged.recovered),
    handoff: String(merged.handoff || DEFAULT_ADAPTER_STATUS.handoff),
    capabilities: splitList(merged.capabilities || ''),
  };
}

function fieldOrOption(fields, options, key, fallback) {
  if (fields.has(key)) return fields.get(key);
  const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return options[camelKey] ?? options[key] ?? fallback;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sortUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stableId(prefix, parts) {
  const input = parts.join('\u001f');
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return `${prefix}_${hash.toString(36).padStart(7, '0')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function orderContractKeys(contract) {
  return Object.fromEntries(CLAIM_KEY_ORDER.filter((key) => key in contract).map((key) => [key, contract[key]]));
}

function requireString(value, path, issues) {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ code: 'required.string', path });
  }
}

function requireArray(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push({ code: 'required.array', path });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export const cliRunDryContractVersion = CONTRACT_VERSION;

export default {
  CliRunDryContractError,
  cliRunDryContractVersion,
  compileCliRunDryContract,
  createCliRunDryPersistedState,
  createCliRunDryPreview,
  createCliRunDrySelfCheck,
  createCliRunDryTenantBoundaryPreview,
  createCliRunDryWorkflowHandoff,
  createMailchimpCliRunDrySelfCheck,
  normalizeCliRunDrySource,
  parseCliRunDrySource,
  validateCliRunDryContract,
};
